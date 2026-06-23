// api/execute-order.js
// Queues an order for execution: creates order_posts rows and sets status → 'queued'.
// The SureThing posting task picks these up, posts via Composio Reddit, and updates URLs.
// POST /api/execute-order { order_id, token }   (token = ADMIN_TOKEN)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(table, filter, select = '*') {
  const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&select=${select}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table}: ${await res.text()}`);
  return (await res.json())[0];
}

async function sbPatch(table, filter, data) {
  const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase patch ${table}: ${await res.text()}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { order_id, token } = req.body;

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

  // Fetch order
  const orders = await sbGet('orders', { id: order_id });
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });
  const order = orders[0];

  if (order.status === 'executing' || order.status === 'completed') {
    return res.status(409).json({ error: `Order already ${order.status}` });
  }

  // Fetch content rows
  const content = await sbGet('order_content', { order_id });
  if (!content.length || !content[0].rows?.length) {
    return res.status(400).json({ error: 'No content rows found for this order' });
  }
  const rows = content[0].rows;
  const orderImageUrl = content[0].image_url || null;  // global image for all posts

  // Create order_posts if they don't already exist
  const existingPosts = await sbGet('order_posts', { order_id });
  if (!existingPosts.length) {
    for (let i = 0; i < rows.length; i++) {
      const rowImageUrl = rows[i].image_url || orderImageUrl || null;
      await sbInsert('order_posts', {
        order_id: order.id,
        row_index: i,
        target: rows[i].target || '',
        content: rows[i].content || '',
        post_type: rowImageUrl ? 'image' : 'text',
        image_url: rowImageUrl,
        status: 'queued',
      });
    }
  } else {
    // Reset any failed posts back to queued
    await sbPatch('order_posts', { order_id, status: 'failed' }, { status: 'queued', error_msg: null });
  }

  // Update order status → queued
  await sbPatch('orders', { id: order_id }, { status: 'queued' });

  return res.json({
    success: true,
    order_id,
    queued_rows: rows.length,
    message: 'Order queued for execution. SureThing posting task will pick it up.',
  });
}
