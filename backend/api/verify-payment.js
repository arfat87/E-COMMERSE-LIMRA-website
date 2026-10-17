import crypto from "crypto";
import Razorpay from "razorpay";
import { supabase } from "./lib/supabase.js";
import { checkRateLimit } from "./lib/rate-limiter.js";
import dotenv from "dotenv";
dotenv.config();

const getKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || "";
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || "";

/**
 * Validates HMAC SHA-256 signature using timing-safe comparison
 * to protect against side-channel timing attacks.
 */
function verifySignatureTimingSafe(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId || !signature || !secret) {
    return false;
  }

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const sigBuffer = Buffer.from(String(signature).trim(), "utf8");
  const genBuffer = Buffer.from(generatedSignature, "utf8");

  if (sigBuffer.length !== genBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, genBuffer);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  // 1. Rate limit payment verification attempts to prevent brute force
  const rateCheck = checkRateLimit(req, { windowMs: 60000, maxRequests: 30, keyPrefix: "verify-pay" });
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Too many payment verification attempts. Please wait ${rateCheck.resetInSeconds} seconds.`
    });
  }

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    order_id,
    amount: clientAmount
  } = req.body || {};

  // 2. Validate presence of required verification tokens
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      success: false,
      error: "Missing required signature verification fields (razorpay_order_id, razorpay_payment_id, razorpay_signature)."
    });
  }

  const cleanOrderId = String(razorpay_order_id).trim();
  const cleanPaymentId = String(razorpay_payment_id).trim();
  const cleanSignature = String(razorpay_signature).trim();
  const isProduction = process.env.NODE_ENV === "production";

  // 3. Prevent payment simulation in production environment
  const isSimulationPayload =
    cleanOrderId.startsWith("order_test_sim_") ||
    cleanPaymentId.startsWith("pay_sim_") ||
    cleanSignature === "simulated_valid_signature";

  if (isSimulationPayload) {
    if (isProduction || process.env.ALLOW_PAYMENT_SIMULATION !== "true") {
      return res.status(400).json({
        success: false,
        error: "Payment simulation is strictly disabled. Real payment signature verification required."
      });
    }

    // Only allow simulation in explicit dev mode with flag enabled
    try {
      await supabase.from("verified_payments").upsert({
        utr: cleanPaymentId,
        amount: Number(clientAmount) || 0,
        status: "success",
        order_id: order_id || null,
        created_at: new Date().toISOString()
      });
    } catch (e) {}

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully (Dev Simulator Mode)",
      is_simulated: true,
      payment_id: cleanPaymentId,
      order_id: order_id || null
    });
  }

  // 4. Server-Side Secret Configuration Check
  const keySecret = getKeySecret();
  const keyId = getKeyId();

  if (!keySecret || !keyId) {
    return res.status(500).json({
      success: false,
      error: "Razorpay credentials are not configured on the server."
    });
  }

  // 5. Signature Verification with Timing-Safe Comparison
  const isValidSignature = verifySignatureTimingSafe(cleanOrderId, cleanPaymentId, cleanSignature, keySecret);
  if (!isValidSignature) {
    return res.status(400).json({
      success: false,
      error: "Invalid Razorpay payment signature. Verification failed."
    });
  }

  try {
    // 6. Gateway Query & Status Validation
    let gatewayAmountInRupees = null;
    let gatewayCurrency = "INR";
    let gatewayStatus = "captured";

    try {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      let paymentRecord = null;

      try {
        paymentRecord = await razorpay.payments.fetch(cleanPaymentId);
      } catch (payFetchErr) {
        // Fallback: fetch order details if payment fetch fails
        try {
          const orderRecord = await razorpay.orders.fetch(cleanOrderId);
          if (orderRecord) {
            gatewayAmountInRupees = orderRecord.amount / 100;
            gatewayCurrency = orderRecord.currency || "INR";
          }
        } catch (ordFetchErr) {
          console.warn("[Razorpay Fetch Warning]:", ordFetchErr.message);
        }
      }

      if (paymentRecord) {
        gatewayAmountInRupees = paymentRecord.amount / 100;
        gatewayCurrency = paymentRecord.currency || "INR";
        gatewayStatus = paymentRecord.status; // 'captured', 'authorized', etc.

        // Verify currency
        if (gatewayCurrency !== "INR") {
          return res.status(400).json({
            success: false,
            error: `Payment currency mismatch. Expected INR, got ${gatewayCurrency}.`
          });
        }

        // Verify status
        if (!["captured", "authorized"].includes(gatewayStatus)) {
          return res.status(400).json({
            success: false,
            error: `Payment is not in a captured state (current status: ${gatewayStatus}).`
          });
        }
      }
    } catch (gwErr) {
      console.warn("[Gateway Fetch Notice]:", gwErr.message);
    }

    // 7. Check Replay Attacks & Existing Verification in verified_payments
    const { data: existingPayments } = await supabase
      .from("verified_payments")
      .select("*")
      .eq("utr", cleanPaymentId)
      .limit(1);

    const existingPayment = existingPayments && existingPayments.length > 0 ? existingPayments[0] : null;

    if (existingPayment) {
      // If payment exists and is already linked to a different order, reject replay
      if (order_id && existingPayment.order_id && existingPayment.order_id !== order_id) {
        return res.status(409).json({
          success: false,
          error: "Payment reference has already been claimed for another order."
        });
      }
    }

    // 8. Order Association & Amount Matching (if order_id provided)
    let internalOrder = null;
    if (order_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(order_id));
      let orderQuery = supabase.from("orders").select("id, order_number, total_amount, payment_status, txn_ref");
      if (isUuid) {
        orderQuery = orderQuery.eq("id", order_id);
      } else {
        orderQuery = orderQuery.eq("order_number", Number(order_id) || 0);
      }

      const { data: orderData, error: orderErr } = await orderQuery.maybeSingle();

      if (orderErr || !orderData) {
        return res.status(404).json({
          success: false,
          error: "Associated internal order not found."
        });
      }

      internalOrder = orderData;

      // Idempotency check: If order is already paid with this exact payment id
      if (internalOrder.payment_status === "paid" && internalOrder.txn_ref === cleanPaymentId) {
        return res.status(200).json({
          success: true,
          message: "Payment already verified and settled for this order.",
          already_paid: true,
          payment_id: cleanPaymentId,
          order_id: internalOrder.id
        });
      }

      // If already paid with a different transaction reference
      if (internalOrder.payment_status === "paid" && internalOrder.txn_ref && internalOrder.txn_ref !== cleanPaymentId) {
        return res.status(409).json({
          success: false,
          error: "Order is already settled under a different transaction reference."
        });
      }

      // Verify amount consistency if gateway amount was resolved
      if (gatewayAmountInRupees !== null) {
        const orderTotal = Number(internalOrder.total_amount) || 0;
        if (Math.abs(gatewayAmountInRupees - orderTotal) > 0.05) {
          return res.status(400).json({
            success: false,
            error: `Payment amount (₹${gatewayAmountInRupees}) does not match order total (₹${orderTotal}).`
          });
        }
      }
    }

    // 9. Record Verified Payment in verified_payments Cache
    const verifiedAmount =
      gatewayAmountInRupees !== null
        ? gatewayAmountInRupees
        : internalOrder
        ? Number(internalOrder.total_amount)
        : Number(clientAmount) || 0;

    await supabase.from("verified_payments").upsert({
      utr: cleanPaymentId,
      amount: verifiedAmount,
      status: "success",
      order_id: internalOrder ? internalOrder.id : (existingPayment?.order_id || null),
      created_at: existingPayment?.created_at || new Date().toISOString()
    });

    // 10. Update internal order state atomically if order_id was provided
    if (internalOrder) {
      const prevStatus = internalOrder.payment_status || "unpaid";
      await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          payment_method: "online",
          txn_ref: cleanPaymentId,
          updated_at: new Date().toISOString()
        })
        .eq("id", internalOrder.id);

      // Audit trail in payment_history
      try {
        await supabase.from("payment_history").insert({
          order_id: internalOrder.id,
          previous_status: prevStatus,
          new_status: "paid",
          change_reason: `Razorpay payment signature verified (Payment ID: ${cleanPaymentId}, Order ID: ${cleanOrderId})`,
          changed_by: "system_razorpay_verifier",
          created_at: new Date().toISOString()
        });
      } catch (histErr) {
        console.warn("[Payment History Audit Notice]:", histErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Payment signature verified and recorded successfully.",
      payment_id: cleanPaymentId,
      order_id: internalOrder ? internalOrder.id : null,
      amount: verifiedAmount
    });
  } catch (error) {
    console.error("[Payment Verification Handler Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error during verification."
    });
  }
}
