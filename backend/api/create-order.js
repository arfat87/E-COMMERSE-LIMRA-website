import Razorpay from "razorpay";
import { supabase } from "./lib/supabase.js";
import { checkRateLimit } from "./lib/rate-limiter.js";
import { calculateOrderBilling, safeNum } from "./lib/billing-engine.js";
import dotenv from "dotenv";
dotenv.config();

const getKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || "";
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  // 1. Rate limiting check
  const rateCheck = checkRateLimit(req, { windowMs: 60000, maxRequests: 30, keyPrefix: "rzp-create" });
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Too many payment initialization requests. Please wait ${rateCheck.resetInSeconds} seconds.`
    });
  }

  const { amount, currency = "INR", receipt = "receipt_1", order_id, items, customerPhone } = req.body || {};

  // 2. Strict Currency Validation (Razorpay India standard)
  const cleanCurrency = String(currency).trim().toUpperCase();
  if (cleanCurrency !== "INR") {
    return res.status(400).json({ success: false, error: "Only INR currency is supported for payments." });
  }

  let trustedAmountInPaise = 0;
  let internalOrder = null;

  try {
    // 3. Trusted Server-Side Amount Resolution
    if (order_id) {
      // 3.1 Fetch existing order from database
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(order_id));
      let query = supabase.from("orders").select("id, order_number, total_amount, payment_status, status");
      if (isUuid) {
        query = query.eq("id", order_id);
      } else {
        query = query.eq("order_number", Number(order_id) || 0);
      }

      const { data: orderData, error: orderErr } = await query.maybeSingle();

      if (orderErr || !orderData) {
        return res.status(404).json({ success: false, error: "Referenced order not found." });
      }

      if (orderData.payment_status === "paid") {
        return res.status(400).json({ success: false, error: "This order has already been paid and settled." });
      }

      if (orderData.status === "cancelled") {
        return res.status(400).json({ success: false, error: "Cannot initialize payment for a cancelled order." });
      }

      internalOrder = orderData;
      trustedAmountInPaise = Math.round(Number(orderData.total_amount) * 100);
      if (amount !== undefined && amount !== null) {
        const clientPaise = Math.round(Number(amount));
        if (Math.abs(trustedAmountInPaise - clientPaise) > 100) {
          return res.status(400).json({
            success: false,
            error: "Payment amount does not match authoritative order total."
          });
        }
      }
    } else if (items && Array.isArray(items) && items.length > 0) {
      // 3.2 Compute trusted total from item list with server-authoritative pricing
      const menuItemIds = items
        .map(it => it.menu_item_id ? Number(it.menu_item_id) : null)
        .filter(Boolean);

      const comboIds = items
        .map(it => {
          if (it.combo_id) return Number(it.combo_id);
          if (typeof it.id === 'string' && it.id.startsWith('combo-')) {
            const parsed = parseInt(it.id.replace('combo-', ''), 10);
            return !isNaN(parsed) ? parsed : null;
          }
          return null;
        })
        .filter(Boolean);

      const overridesMap = new Map();
      if (menuItemIds.length > 0) {
        try {
          const { data: dbOverrides } = await supabase
            .from("menu_overrides")
            .select("id, price, available")
            .in("id", menuItemIds);
          if (dbOverrides) dbOverrides.forEach(ov => overridesMap.set(Number(ov.id), ov));
        } catch (ovErr) {}
      }

      const combosMap = new Map();
      if (comboIds.length > 0) {
        try {
          const { data: dbCombos } = await supabase
            .from("combos")
            .select("id, price, available")
            .in("id", comboIds);
          if (dbCombos) dbCombos.forEach(c => combosMap.set(Number(c.id), c));
        } catch (cErr) {}
      }

      const validatedItems = [];
      for (const item of items) {
        const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
        let price = Math.max(0, Number(item.price || item.unit_price) || 0);
        const mId = item.menu_item_id ? Number(item.menu_item_id) : null;
        const cId = item.combo_id ? Number(item.combo_id) : (typeof item.id === 'string' && item.id.startsWith('combo-') ? parseInt(item.id.replace('combo-', ''), 10) : null);

        if (mId && overridesMap.has(mId)) {
          const ov = overridesMap.get(mId);
          if (ov.available === false) {
            return res.status(400).json({ success: false, error: `Item '${item.name || "Item"}' is sold out.` });
          }
          if (ov.price !== undefined && ov.price !== null) price = Number(ov.price);
        }

        if (cId && combosMap.has(cId)) {
          const cb = combosMap.get(cId);
          if (cb.available === false) {
            return res.status(400).json({ success: false, error: `Combo '${item.name || "Combo"}' is sold out.` });
          }
          if (cb.price !== undefined && cb.price !== null) price = Number(cb.price);
        }

        validatedItems.push({
          name: item.name || item.item_name || "Item",
          quantity: qty,
          unit_price: price,
          gst_applicable: item.gst_applicable !== false
        });
      }

      // Check coupon if provided
      let verifiedCoupon = null;
      const couponCode = (req.body?.coupon_code || req.body?.couponCode || "").trim().toUpperCase();
      if (couponCode) {
        try {
          const { data: cData } = await supabase
            .from("coupons")
            .select("*")
            .eq("code", couponCode)
            .eq("active", true)
            .maybeSingle();
          if (cData && (!cData.expiry_date || new Date(cData.expiry_date) > new Date())) {
            verifiedCoupon = cData;
          }
        } catch (cErr) {}
      }

      const deliveryFee = safeNum(req.body?.deliveryFee ?? req.body?.delivery_fee, 0);
      const hasTax = req.body?.include_tax || req.body?.tax || req.body?.cgstRate !== undefined || (typeof req.body?.notes === 'string' && req.body.notes.includes('GST')) || Boolean(req.body?.order_id);
      
      const billingWithTax = calculateOrderBilling({
        items: validatedItems,
        deliveryFee,
        coupon: verifiedCoupon,
        cgstRate: 2.5,
        sgstRate: 2.5
      });

      const billingBase = calculateOrderBilling({
        items: validatedItems,
        deliveryFee,
        coupon: verifiedCoupon,
        cgstRate: 0,
        sgstRate: 0
      });

      const clientPaise = (amount !== undefined && amount !== null) ? Math.round(Number(amount)) : null;

      if (hasTax || (clientPaise !== null && Math.abs(Math.round(billingWithTax.grandTotal * 100) - clientPaise) <= 100)) {
        trustedAmountInPaise = Math.round(billingWithTax.grandTotal * 100);
      } else {
        trustedAmountInPaise = Math.round(billingBase.grandTotal * 100);
      }
    } else if (amount !== undefined && amount !== null) {
      // 3.3 Validate numeric amount bounds
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount < 100) {
        return res.status(400).json({ success: false, error: "Amount must be at least 100 paise (₹1.00)." });
      }
      if (numAmount > 5000000) {
        return res.status(400).json({ success: false, error: "Amount exceeds maximum permitted transaction limit." });
      }
      trustedAmountInPaise = Math.round(numAmount);
    } else {
      return res.status(400).json({ success: false, error: "Valid order_id, items, or amount is required." });
    }

    if (trustedAmountInPaise < 100) {
      return res.status(400).json({ success: false, error: "Payment amount must be at least 100 paise (₹1.00)." });
    }

    const keyId = getKeyId();
    const keySecret = getKeySecret();
    const isProduction = process.env.NODE_ENV === "production";

    // 4. Missing Credentials Handling
    if (!keyId || !keySecret) {
      if (isProduction || process.env.ALLOW_PAYMENT_SIMULATION !== "true") {
        console.error("[Razorpay Error]: Missing API credentials in production mode.");
        return res.status(500).json({
          success: false,
          error: "Payment gateway credentials are not configured on the server."
        });
      }

      // Safe dev simulator mode (only when explicitly enabled in non-production)
      console.warn("[Razorpay Dev]: Credentials unconfigured; activating test simulator mode.");
      return res.status(200).json({
        success: true,
        order_id: "order_test_sim_" + Date.now(),
        amount: trustedAmountInPaise,
        currency: "INR",
        key_id: "rzp_test_simulated",
        is_simulated: true,
        message: "Razorpay running in Dev Test Simulator Mode."
      });
    }

    // 5. Razorpay Gateway Order Creation
    try {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const cleanReceipt = String(
        receipt || (internalOrder ? `rec_${internalOrder.order_number}` : `rec_${Date.now().toString().slice(-8)}`)
      ).slice(0, 40);

      const notes = {};
      if (internalOrder) notes.order_id = String(internalOrder.id);
      if (customerPhone) notes.customer_phone = String(customerPhone).slice(0, 15);

      const rzpOrder = await razorpay.orders.create({
        amount: trustedAmountInPaise,
        currency: "INR",
        receipt: cleanReceipt,
        notes
      });

      return res.status(200).json({
        success: true,
        order_id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        key_id: keyId,
        is_simulated: false
      });
    } catch (rzpErr) {
      console.error("[Razorpay Gateway Order Creation Error]:", rzpErr?.error || rzpErr?.message);

      // In non-production, fallback to simulator if test credentials expired
      if (!isProduction && process.env.ALLOW_PAYMENT_SIMULATION === "true") {
        console.warn("[Razorpay Notice]: Falling back to test simulator mode.");
        return res.status(200).json({
          success: true,
          order_id: "order_test_sim_" + Date.now(),
          amount: trustedAmountInPaise,
          currency: "INR",
          key_id: keyId || "rzp_test_simulated",
          is_simulated: true,
          message: "Razorpay keys inactive; running in Dev Test Simulator Mode."
        });
      }

      const errorMsg =
        rzpErr?.error?.description ||
        rzpErr?.description ||
        rzpErr?.message ||
        "Razorpay order creation failed at gateway.";
      return res.status(502).json({ success: false, error: errorMsg });
    }
  } catch (error) {
    console.error("[Create Order Handler Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error during order creation."
    });
  }
}
