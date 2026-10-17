import crypto from "crypto";
import { supabase } from "./lib/supabase.js";
import dotenv from "dotenv";
dotenv.config();

const getWebhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || "";

/**
 * Validates Razorpay Webhook signature using raw request body
 * and timing-safe comparison to prevent timing attacks.
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
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

  const webhookSecret = getWebhookSecret();
  if (!webhookSecret) {
    console.error("[Webhook Error]: Webhook secret not configured on server.");
    return res.status(500).json({ success: false, error: "Webhook secret is unconfigured." });
  }

  const signature = req.headers["x-razorpay-signature"];
  if (!signature) {
    return res.status(400).json({ success: false, error: "Missing x-razorpay-signature header." });
  }

  // Raw body must be used for HMAC verification
  const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  if (!rawBody) {
    return res.status(400).json({ success: false, error: "Empty webhook payload body." });
  }

  const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("[Webhook Warning]: Received webhook with invalid signature.");
    return res.status(400).json({ success: false, error: "Invalid webhook signature." });
  }

  const eventPayload = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(rawBody);
  const eventName = eventPayload.event;
  console.log(`[Razorpay Webhook Event]: Received ${eventName}`);

  try {
    if (eventName === "payment.captured" || eventName === "order.paid") {
      const paymentEntity = eventPayload.payload?.payment?.entity || {};
      const orderEntity = eventPayload.payload?.order?.entity || {};

      const paymentId = paymentEntity.id;
      const razorpayOrderId = paymentEntity.order_id || orderEntity.id;
      const amountInPaise = paymentEntity.amount || orderEntity.amount || 0;
      const amountInRupees = amountInPaise / 100;
      const currency = paymentEntity.currency || orderEntity.currency || "INR";

      if (!paymentId) {
        return res.status(200).json({ status: "ok", message: "No payment ID in payload" });
      }

      // Check currency
      if (currency !== "INR") {
        console.warn(`[Webhook Warning]: Unexpected currency ${currency} for payment ${paymentId}`);
        return res.status(200).json({ status: "ok", message: "Ignored non-INR currency" });
      }

      // Identify internal order by notes or razorpay_order_id
      const internalOrderId =
        paymentEntity.notes?.order_id ||
        orderEntity.notes?.order_id ||
        null;

      // Check existing payment in verified_payments for idempotency
      const { data: existingRecords } = await supabase
        .from("verified_payments")
        .select("*")
        .eq("utr", paymentId)
        .limit(1);

      const existing = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null;

      // Upsert into verified_payments
      await supabase.from("verified_payments").upsert({
        utr: paymentId,
        amount: amountInRupees,
        status: "success",
        order_id: internalOrderId || existing?.order_id || null,
        created_at: existing?.created_at || new Date().toISOString()
      });

      // If internal order is known, update payment status idempotently
      if (internalOrderId) {
        const { data: orderData } = await supabase
          .from("orders")
          .select("id, payment_status, total_amount, txn_ref")
          .eq("id", internalOrderId)
          .maybeSingle();

        if (orderData && orderData.payment_status !== "paid") {
          await supabase
            .from("orders")
            .update({
              payment_status: "paid",
              payment_method: "online",
              txn_ref: paymentId,
              updated_at: new Date().toISOString()
            })
            .eq("id", internalOrderId);

          await supabase.from("payment_history").insert({
            order_id: internalOrderId,
            previous_status: orderData.payment_status || "unpaid",
            new_status: "paid",
            change_reason: `Razorpay webhook confirmation (${eventName}, Payment: ${paymentId})`,
            changed_by: "system_razorpay_webhook",
            created_at: new Date().toISOString()
          });
        }
      }

      return res.status(200).json({ status: "ok", message: "Payment processed idempotently" });
    }

    if (eventName === "payment.failed") {
      const paymentEntity = eventPayload.payload?.payment?.entity || {};
      const paymentId = paymentEntity.id;
      const internalOrderId = paymentEntity.notes?.order_id;
      const amountInRupees = (paymentEntity.amount || 0) / 100;

      if (paymentId) {
        await supabase.from("verified_payments").upsert({
          utr: paymentId,
          amount: amountInRupees,
          status: "failed",
          order_id: internalOrderId || null,
          created_at: new Date().toISOString()
        });

        if (internalOrderId) {
          const { data: orderData } = await supabase
            .from("orders")
            .select("id, payment_status")
            .eq("id", internalOrderId)
            .maybeSingle();

          if (orderData && orderData.payment_status === "unpaid") {
            await supabase.from("payment_history").insert({
              order_id: internalOrderId,
              previous_status: "unpaid",
              new_status: "failed",
              change_reason: `Razorpay webhook failure notice: ${paymentEntity.error_description || "Payment failed"}`,
              changed_by: "system_razorpay_webhook",
              created_at: new Date().toISOString()
            });
          }
        }
      }

      return res.status(200).json({ status: "ok", message: "Failed payment recorded" });
    }

    // Default acknowledgement for other events
    return res.status(200).json({ status: "ok", message: `Event ${eventName} ignored` });
  } catch (err) {
    console.error("[Webhook Processing Error]:", err);
    return res.status(500).json({ success: false, error: "Internal error processing webhook" });
  }
}
