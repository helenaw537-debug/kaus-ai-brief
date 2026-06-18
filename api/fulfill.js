// api/fulfill.js
// Helena's internal fulfillment view — returns orders as JSON
// Protected by FULFILL_SECRET env var

export default function handler(req, res) {
  const { secret } = req.query;
  if (secret !== process.env.FULFILL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // TODO: fetch from Supabase orders table
  // Returns pre-filled bot config for each order
  const mockOrders = [
    {
      id: 'order_001',
      client: 'Kaus AI',
      email: 'client@kaus-ai.com',
      posts: 20,
      comments: 80,
      subreddits: 'r/SaaS, r/SEO',
      content: 'Sample content brief...',
      status: 'pending_setup',
      created_at: new Date().toISOString()
    }
  ];

  return res.status(200).json({ orders: mockOrders });
}
