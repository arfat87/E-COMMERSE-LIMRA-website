import crypto from "crypto";
import Razorpay from "razorpay";
import { queryInsforge } from "./lib/insforge.js";

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "DL98BCefLpezCsb3bdj5f2MW";
const KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_TBmsInWXVkKowt";

const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET
});

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") {
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

export default async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader("Access-Control-Allow-Credentials", true);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
    );
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing required signature verification fields" });
  }

  try {
    const generatedSignature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Signature mismatch. Verification failed." });
    }

    const orderDetails = await razorpay.orders.fetch(razorpay_order_id);
    const amountInRupees = orderDetails.amount / 100;

    const utr = sqlEscape(razorpay_payment_id);
    const amount = Number(amountInRupees) || 0;

    await queryInsforge(`
      INSERT INTO public.verified_payments (utr, amount, status, created_at)
      VALUES (${utr}, ${amount}, 'success', NOW())
      ON CONFLICT (utr) DO UPDATE SET status = 'success';
    `);

    return res.status(200).json({ success: true, message: "Signature verified and payment logged to InsForge PostgreSQL" });
  } catch (error) {
    console.error("Signature Verification Error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
