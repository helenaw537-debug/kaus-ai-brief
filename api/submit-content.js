// api/submit-content.js
// Receives content submission from content.html
// Saves to Supabase order_content table, updates order status → 'ready'
// Sends notification email to hello@kaus-ai.com + confirmation to client via Zoho SMTP

import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseUpdate(table, match, data) {
  const params = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase update failed: ${err}`);
  }
}

async function supabaseInsert(table, row) {
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert failed: ${err}`);
  }
  return res.json();
}

async function supabaseGet(table, match, select = '*') {
  const params = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&select=${select}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.eu',
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_EMAIL,
      pass: process.env.ZOHO_PASSWORD,
    },
  });
  await transporter.sendMail({
    from: `Kaus <${process.env.ZOHO_EMAIL}>`,
    to,
    subject,
    html,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, post_content, subreddits, comment_targets, comment_direction, image_url } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  // Fetch order
  const orders = await supabaseGet('orders', { token }, 'id,token,email,client_name,company,package_type,posts_qty,comments_qty,status');
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });
  const order = orders[0];

  if (order.status === 'ready' || order.status === 'processing') {
    return res.status(409).json({ error: 'Content already submitted' });
  }

  // Save content
  try {
    await supabaseInsert('order_content', {
      order_id: order.id,
      order_token: token,
      post_content: post_content || null,       // raw text: each post separated by ---
      subreddits: subreddits || null,            // newline-separated subreddit names/URLs
      comment_targets: comment_targets || null,  // newline-separated Reddit thread URLs
      comment_direction: comment_direction || null,
      image_url: image_url || null,              // Supabase Storage public URL for post image
      submitted_at: new Date().toISOString(),
    });

    await supabaseUpdate('orders', { token }, { status: 'ready' });
  } catch (err) {
    console.error('Save error:', err.message);
    return res.status(500).json({ error: 'Save failed' });
  }

  // Notify hello@kaus-ai.com
  await sendEmail({
    to: 'hello@kaus-ai.com',
    subject: `📥 内容已提交 — ${order.company || order.client_name}，可以开始发帖`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="font-size:18px">客户已提交内容 — 自动发帖启动中</h2>
        <p><strong>客户：</strong>${order.client_name} / ${order.company}</p>
        <p><strong>套餐：</strong>${order.package_type} — ${order.posts_qty}篇帖子 + ${order.comments_qty}条评论</p>
        ${post_content ? `<p><strong>帖子内容：</strong><br/><pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px;overflow:auto">${post_content.slice(0, 800)}</pre></p>` : ''}
        ${subreddits ? `<p><strong>目标版块：</strong><pre style="background:#f5f5f5;padding:8px;border-radius:6px;font-size:12px">${subreddits}</pre></p>` : ''}
        ${comment_targets ? `<p><strong>评论目标链接：</strong><pre style="background:#f5f5f5;padding:8px;border-radius:6px;font-size:12px">${comment_targets}</pre></p>` : ''}
        ${comment_direction ? `<p><strong>评论方向：</strong>${comment_direction}</p>` : ''}
        <p style="color:#666;font-size:12px">订单 ID: ${token}</p>
      </div>
    `,
  });

  // Confirm to client
  await sendEmail({
    to: order.email,
    subject: '✅ Kaus — 内容已收到，开始发帖',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="font-size:20px">内容已收到 🚀</h2>
        <p>我们的算法正在匹配最适合的账号，将在 <strong>24小时内</strong> 开始发帖。</p>
        <p>每日会发送发帖进度报告到你的邮箱。如有问题，请微信联系我们。</p>
      </div>
    `,
  });

  return res.status(200).json({ success: true });
}
