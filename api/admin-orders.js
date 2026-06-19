// api/admin-orders.js
// Internal admin API — returns orders with content rows as JSON.
// Protected by ADMIN_TOKEN env var.
// GET  /api/admin-orders?token=xxx           → all orders (most recent first)
// GET  /api/admin-orders?token=xxx&id=xxx    → single order with posts
// CORS-friendly: admin.html on GitHub Pages calls this.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token, id } = req.query;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Single order detail
  if (id) {
    const orders = await sbFetch(`orders?id=eq.${encodeURIComponent(id)}&select=*`);
    const content = await sbFetch(`order_content?order_id=eq.${encodeURIComponent(id)}&select=*`);
    const posts = await sbFetch(`order_posts?order_id=eq.${encodeURIComponent(id)}&select=*&order=row_index.asc`);
    return res.json({ order: orders[0] || null, content: content[0] || null, posts });
  }

  // All orders
  const orders = await sbFetch('orders?select=*&order=created_at.desc&limit=100');

  // Enrich with content + post counts
  const enriched = await Promise.all(orders.map(async (order) => {
    const content = await sbFetch(`order_content?order_id=eq.${encodeURIComponent(order.id)}&select=rows,content_type`);
    const posts = await sbFetch(`order_posts?order_id=eq.${encodeURIComponent(order.id)}&select=status`);
    const done = posts.filter(p => p.status === 'done').length;
    return {
      ...order,
      content_rows: content[0]?.rows || null,
      content_type: content[0]?.content_type || null,
      posts_total: posts.length,
      posts_done: done,
    };
  }));

  return res.json({ orders: enriched });
}
