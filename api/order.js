// api/order.js
// Receives order from checkout form, stores it, triggers fulfillment auto-fill
// Wired to Stripe webhook in api/stripe-webhook.js

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subreddits, content, posts, comments, name, email, company, wechat } = req.body;

  // TODO: persist to Supabase / Google Sheet
  // TODO: send fulfillment email to helena with auto-fill link
  // TODO: send confirmation email to client

  console.log('New order:', { name, email, posts, comments, subreddits });

  return res.status(200).json({ success: true, message: 'Order received' });
}
