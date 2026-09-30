import Razorpay from 'razorpay';
import dotenv from 'dotenv';
dotenv.config();

const getKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '';
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

export default async function handler(req, res) {
  // CORS is handled globally by server.js — no duplication needed here
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { amount, currency = 'INR', receipt = 'receipt_1' } = req.body;

  if (!amount || amount < 100) {
    return res.status(400).json({ error: 'Amount must be at least 100 paise (₹1)' });
  }

  try {
    const key_id = getKeyId();
    const key_secret = getKeySecret();

    if (!key_id || !key_secret) {
      return res.status(500).json({ error: 'Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env file.' });
    }

    const razorpay = new Razorpay({ key_id, key_secret });

    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency,
      receipt
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: key_id
    });
  } catch (error) {
    console.error('Razorpay Order Creation Error:', error);
    const errorMsg = error?.error?.description || error?.description || error?.message || 'Razorpay order creation failed';
    return res.status(500).json({ error: errorMsg });
  }
}
