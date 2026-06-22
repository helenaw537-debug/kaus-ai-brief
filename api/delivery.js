// api/delivery.js
// Sends delivery confirmation email to the customer with all post URLs.
// Called by the SureThing posting task when all order_posts are done.
// POST /api/delivery { order_id, token }

import nodemailer from 'nodemailer';

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

async function sbPatch(table, filter, data) {
  const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(data),
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.eu',
    port: 465,
    secure: true,
    auth: { user: process.env.ZOHO_EMAIL, pass: process.env.ZOHO_PASSWORD },
  });
  await transporter.sendMail({
    from: `Kaus <${process.env.ZOHO_EMAIL}>`,
    to, subject, html,
  });
}

function buildDeliveryEmail({ order, posts, isZh, reportUrl }) {
  const pkgSummary = order.package_type === 'combined'
    ? (isZh ? `${order.posts_qty}篇帖子 + ${order.comments_qty}条评论` : `${order.posts_qty} posts + ${order.comments_qty} comments`)
    : order.package_type === 'posts'
    ? (isZh ? `${order.posts_qty}篇帖子` : `${order.posts_qty} posts`)
    : (isZh ? `${order.comments_qty}条评论` : `${order.comments_qty} comments`);

  const linksTable = posts.map((p, i) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ddd;color:#888">${i + 1}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:12px">${p.target || '—'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:12px">
        ${p.post_url ? `<a href="${p.post_url}" style="color:#D13239">${p.post_url}</a>` : (isZh ? '—' : '—')}
      </td>
      <td style="padding:6px 8px;border:1px solid #ddd;color:#888;font-size:12px">${p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '—'}</td>
    </tr>
  `).join('');

  const tableHeader = isZh
    ? `<tr style="background:#f5f5f5"><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">版块/目标</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">发帖链接</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">日期</th></tr>`
    : `<tr style="background:#f5f5f5"><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Subreddit / Target</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Post URL</th><th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Date</th></tr>`;

  if (isZh) {
    return `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111">
        <h2 style="font-size:20px">任务已完成 ✓</h2>
        <p>你的所有内容已成功发布。以下是发帖链接，请确认。</p>
        <table style="border-collapse:collapse;width:100%;margin:12px 0">
          <tr><td style="padding:5px 0;color:#666">套餐</td><td>${pkgSummary}</td></tr>
          <tr><td style="padding:5px 0;color:#666">客户</td><td>${order.client_name} / ${order.company}</td></tr>
          <tr><td style="padding:5px 0;color:#666">完成时间</td><td>${new Date().toLocaleDateString('zh-CN')}</td></tr>
        </table>
        <h3 style="font-size:15px;margin-bottom:8px">发帖链接（共 ${posts.length} 条）</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
          <thead>${tableHeader}</thead>
          <tbody>${linksTable}</tbody>
        </table>
        <p style="margin-top:20px;color:#666;font-size:14px">如有问题，请联系 <a href="mailto:hello@kaus-ai.com">hello@kaus-ai.com</a></p>
        ${reportUrl ? `<p style="margin-top:12px"><a href="${reportUrl}" style="background:#D13239;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">查看完整报告 →</a></p>` : ''}
      </div>
    `;
  }

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111">
      <h2 style="font-size:20px">All posts are live ✓</h2>
      <p>Your content has been successfully posted. Here are the links for your review.</p>
      <table style="border-collapse:collapse;width:100%;margin:12px 0">
        <tr><td style="padding:5px 0;color:#666">Package</td><td>${pkgSummary}</td></tr>
        <tr><td style="padding:5px 0;color:#666">Client</td><td>${order.client_name} / ${order.company}</td></tr>
        <tr><td style="padding:5px 0;color:#666">Completed</td><td>${new Date().toLocaleDateString('en-GB')}</td></tr>
      </table>
      <h3 style="font-size:15px;margin-bottom:8px">Post links (${posts.length} total)</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>${tableHeader}</thead>
        <tbody>${linksTable}</tbody>
      </table>
      <p style="margin-top:20px;color:#666;font-size:14px">Questions? <a href="mailto:hello@kaus-ai.com">hello@kaus-ai.com</a></p>
      ${reportUrl ? `<p style="margin-top:12px"><a href="${reportUrl}" style="background:#D13239;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">View full report →</a></p>` : ''}
    </div>
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { order_id, token } = req.body;
  if (!token || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

  const orders = await sbGet('orders', { id: order_id });
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });
  const order = orders[0];

  const posts = await sbGet('order_posts', { order_id }, '*', '&order=row_index.asc');
  const donePosts = posts.filter(p => p.status === 'done');

  const isZh = order.lang !== 'en';
  const siteUrl = process.env.SITE_URL || 'https://app.kaus-ai.com';
  const reportUrl = `${siteUrl}/report.html?token=${order.token}`;
  const html = buildDeliveryEmail({ order, posts: donePosts, isZh, reportUrl });

  try {
    await sendEmail({
      to: order.email,
      subject: isZh
        ? `✅ Kaus — 所有任务完成，共 ${donePosts.length} 条发帖链接`
        : `✅ Kaus — All ${donePosts.length} posts are live`,
      html,
    });

    await sbPatch('orders', { id: order_id }, { status: 'completed' });

    return res.json({ success: true, posts_sent: donePosts.length });
  } catch (err) {
    console.error('Delivery email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
