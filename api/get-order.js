// api/get-order.js
// Returns order details by token (Stripe session ID) — used by content.html to prefill UI
// Public read: only non-sensitive fields returned

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?token=eq.${encodeURIComponent(token)}&select=token,client_name,company,package_type,posts_qty,comments_qty,order_price,status`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  if (!r.ok) return res.status(500).json({ error: 'DB error' });
  const rows = await r.json();
  if (!rows.length) return res.status(404).json({ error: 'Order not found' });

  // Don't expose email/wechat on public endpoint
  const { token: t, client_name, company, package_type, posts_qty, comments_qty, order_price, status } = rows[0];
  return res.status(200).json({ token: t, client_name, company, package_type, posts_qty, comments_qty, order_price, status });
}
