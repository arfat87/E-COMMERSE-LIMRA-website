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
      console.warn('[Razorpay Notice]: Credentials unconfigured, activating Simulator Mode.');
      return res.status(200).json({
        order_id: 'order_test_sim_' + Date.now(),
        amount: Math.round(amount),
        currency,
        key_id: 'rzp_test_simulated',
        is_simulated: true,
        message: 'Razorpay credentials not set; running in Simulator Mode.'
      });
    }

    try {
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
        key_id: key_id,
        is_simulated: false
      });
    } catch (rzpErr) {
      console.warn('[Razorpay Notice - Falling back to Simulator]:', rzpErr?.error?.description || rzpErr?.message);
      // Fallback for expired / inactive test keys so checkout flow is never blocked
      return res.status(200).json({
        order_id: 'order_test_sim_' + Date.now(),
        amount: Math.round(amount),
        currency,
        key_id: key_id,
        is_simulated: true,
        message: 'Razorpay authentication failed or keys inactive; running in Test Simulator Mode.'
      });
    }
  } catch (error) {
    console.error('Razorpay Order Creation Error:', error);
    const errorMsg = error?.error?.description || error?.description || error?.message || 'Razorpay order creation failed';
    return res.status(500).json({ error: errorMsg });
  }
}
