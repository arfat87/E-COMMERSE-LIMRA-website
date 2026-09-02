import Razorpay from 'razorpay';
import dotenv from 'dotenv';
dotenv.config();

const getKeyId = () => process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TBmsInWXVkKowt';
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || 'DL98BCefLpezCsb3bdj5f2MW';

export default async function handler(req, res) {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
