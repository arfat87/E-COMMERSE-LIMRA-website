import crypto from "crypto";
import Razorpay from "razorpay";
import { supabase } from "./lib/supabase.js";
import dotenv from "dotenv";
dotenv.config();

const getKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || "";
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || "";

export default async function handler(req, res) {
  // CORS is handled globally by server.js — no duplication needed here
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing required signature verification fields" });
  }

  try {
    const keySecret = getKeySecret();
    const keyId = getKeyId();

    if (!keySecret || !keyId) {
      return res.status(500).json({ error: 'Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env file.' });
    }

    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Signature mismatch. Verification failed." });
    }

    try {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const orderDetails = await razorpay.orders.fetch(razorpay_order_id);
      const amountInRupees = orderDetails.amount / 100;
      const amount = Number(amountInRupees) || 0;

      await supabase.from("verified_payments").upsert({
        utr: String(razorpay_payment_id).trim(),
        amount: amount,
        status: "success",
        created_at: new Date().toISOString()
      });
    } catch (dbErr) {
      console.warn("[Payment Logged Notice]:", dbErr.message);
    }

    return res.status(200).json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    console.error("[Signature Verification Error]:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
