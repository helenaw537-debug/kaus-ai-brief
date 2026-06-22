// api/order-report.js
// Customer-facing order report: returns order summary + post statuses by token.
// The Stripe session ID (token) is the auth — only the paying customer has it.
// GET /api/order-report?token=cs_live_xxx

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter, select = '*', extra = '') {
  const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&select=${select}${extra}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const orders = await sbGet('orders', { token });
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });

  const order = orders[0];
  const posts = await sbGet('order_posts', { order_id: order.id }, '*', '&order=row_index.asc');

  const totalQty = (order.posts_qty || 0) + (order.comments_qty || 0);
  const doneCount = posts.filter(p => p.status === 'done' || p.status === 'posted').length;
  const failedCount = posts.filter(p => p.status === 'failed').length;

  return res.json({
    order: {
      token: order.token,
      client_name: order.client_name,
      company: order.company,
      package_type: order.package_type,
      posts_qty: order.posts_qty,
      comments_qty: order.comments_qty,
      order_price: order.order_price,
      status: order.status,
      lang: order.lang,
      created_at: order.created_at,
    },
    summary: {
      total: posts.length || totalQty,
      done: doneCount,
      failed: failedCount,
      queued: posts.filter(p => p.status === 'queued').length,
      in_progress: posts.filter(p => p.status === 'executing' || p.status === 'in_progress').length,
    },
    posts: posts.map(p => ({
      row_index: p.row_index,
      target: p.target,
      content_preview: (p.content || '').slice(0, 120) + (p.content?.length > 120 ? '…' : ''),
      post_url: p.post_url || null,
      status: p.status,
      posted_at: p.posted_at || null,
      error_msg: p.status === 'failed' ? (p.error_msg || 'Failed') : null,
    })),
  });
}
