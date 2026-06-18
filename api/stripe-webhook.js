// api/stripe-webhook.js
// Stripe sends POST here on successful payment
// We parse the order, store it, and trigger fulfillment

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { subreddits, content, posts, comments, name, wechat } = session.metadata;

    // TODO: write to Supabase orders table
    // TODO: send Helena fulfillment email with pre-filled bot config
    // TODO: send client confirmation email

    console.log('Payment confirmed:', session.customer_email, { posts, comments });
  }

  res.json({ received: true });
}

export const config = { api: { bodyParser: false } }; // Required for Stripe signature verification
