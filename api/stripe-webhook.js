// api/stripe-webhook.js
// Stripe webhook: on successful payment, save order + link pre-submitted content.
// Sends internal notification to Helena (with full content table) + confirmation to client.
// Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
//   SUPABASE_SERVICE_KEY, ZOHO_EMAIL, ZOHO_PASSWORD, SITE_URL

import Stripe from 'stripe';
import nodemailer from 'nodemailer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase helpers ─────────────────────────────────────────────────────────

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

async function sbGet(table, filter, select = '*') {
  const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&select=${select}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
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

// ── Email ────────────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: process.env.ZOHO_EMAIL, pass: process.env.ZOHO_PASSWORD },
  });
  await transporter.sendMail({
    from: `Kaus <${process.env.ZOHO_EMAIL}>`,
    to, subject, html,
  });
}

function contentTableHtml(rows, type) {
  if (!rows || !rows.length) return '<p style="color:#666">No content rows uploaded.</p>';
  const typeLabel = type === 'comment' ? 'Thread URL / Target' : 'Subreddit';
  return `
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:8px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">#</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">${typeLabel}</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Content</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr>
            <td style="padding:6px 8px;border:1px solid #ddd;color:#888">${i + 1}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:12px">${r.target || '—'}</td>
            <td style="padding:6px 8px;border:1px solid #ddd;font-size:12px">${(r.content || '').slice(0, 200)}${r.content?.length > 200 ? '…' : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="color:#888;font-size:12px;margin-top:6px">${rows.length} rows total</p>
  `;
}

// ── Raw body reader (required for Stripe signature verification) ─────────────

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Webhook handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data.object;
  const m = session.metadata;
  const token = session.id;
  const lang = m.lang || 'zh';
  const isZh = lang !== 'en';

  // 1. Save order to Supabase
  let order;
  try {
    order = await sbInsert('orders', {
      token,
      stripe_session_id: session.id,
      email: session.customer_email,
      client_name: m.client_name,
      company: m.company,
      wechat: m.wechat,
      content_brief: m.content_brief,
      package_type: m.package_type,
      posts_qty: parseInt(m.posts_qty) || 0,
      comments_qty: parseInt(m.comments_qty) || 0,
      order_price: parseFloat(m.order_price) || 0,
      lang,
      pending_content_id: m.pending_content_id || null,
      status: 'pending_content',
    });
  } catch (err) {
    console.error('Order save error:', err.message);
  }

  // 2. Link pre-submitted content to this order
  let contentRows = null;
  let contentType = null;
  if (m.pending_content_id && order?.id) {
    try {
      const pending = await sbGet('pending_content', { id: m.pending_content_id });
      if (pending.length) {
        const pc = pending[0];
        contentRows = pc.rows;
        contentType = pc.content_type;

        await sbInsert('order_content', {
          order_id: order.id,
          order_token: token,
          rows: pc.rows,
          content_type: pc.content_type,
          submitted_at: new Date().toISOString(),
        });

        // Create order_posts rows (status: queued)
        if (Array.isArray(pc.rows) && pc.rows.length > 0) {
          for (let i = 0; i < pc.rows.length; i++) {
            const row = pc.rows[i];
            await sbInsert('order_posts', {
              order_id: order.id,
              row_index: i,
              target: row.target || '',
              content: row.content || '',
              status: 'queued',
            });
          }
        }

        await sbPatch('orders', { id: order.id }, { status: 'ready' });
      }
    } catch (err) {
      console.error('Content link error:', err.message);
    }
  }

  // 3. Internal email to Helena — with full content table
  const totalQty = (parseInt(m.posts_qty) || 0) + (parseInt(m.comments_qty) || 0);
  let pkgSummary = m.package_type === 'combined'
    ? `${m.posts_qty} posts + ${m.comments_qty} comments`
    : m.package_type === 'posts' ? `${m.posts_qty} posts` : `${m.comments_qty} comments`;

  try {
    await sendEmail({
      to: 'hello@kaus-ai.com',
      subject: `🛒 New order — ${m.company || m.client_name} (¥${m.order_price}) — ${contentRows?.length || 0}/${totalQty} rows`,
      html: `
        <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111">
          <h2 style="font-size:18px;margin-bottom:16px">New order received</h2>
          <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
            <tr><td style="padding:5px 8px;color:#666;width:120px">Customer</td><td>${m.client_name} / ${m.company}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">Email</td><td>${session.customer_email}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">WeChat</td><td>${m.wechat || '—'}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">Package</td><td>${pkgSummary}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">Amount</td><td>¥${m.order_price}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">Language</td><td>${lang}</td></tr>
            <tr><td style="padding:5px 8px;color:#666">Order ID</td><td><code style="font-size:12px">${token}</code></td></tr>
          </table>
          <h3 style="font-size:15px;margin-bottom:8px">Content rows uploaded (${contentRows?.length || 0})</h3>
          ${contentTableHtml(contentRows, contentType)}
          ${m.content_brief ? `<p style="margin-top:12px"><strong>Brief:</strong> ${m.content_brief}</p>` : ''}
        </div>
      `,
    });
  } catch (err) {
    console.error('Internal email error:', err.message);
  }

  // 4. Client confirmation email — language-matched
  try {
    await sendEmail({
      to: session.customer_email,
      subject: isZh ? '✅ Kaus — 付款成功，任务开始处理' : '✅ Kaus — Payment received, work in progress',
      html: isZh ? `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="font-size:20px">付款成功</h2>
          <p>感谢下单！我们已收到你的内容，正在安排账号发帖。</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr><td style="padding:5px 0;color:#666">套餐</td><td>${pkgSummary}</td></tr>
            <tr><td style="padding:5px 0;color:#666">内容条数</td><td>${contentRows?.length || 0} 条</td></tr>
            <tr><td style="padding:5px 0;color:#666">客户</td><td>${m.client_name} / ${m.company}</td></tr>
          </table>
          <p>任务完成后，你将收到包含所有发帖链接的确认邮件。</p>
          <p style="color:#999;font-size:12px">如有问题，请联系 hello@kaus-ai.com</p>
        </div>
      ` : `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="font-size:20px">Payment received</h2>
          <p>Thanks for your order! We've received your content and are assigning accounts to start posting.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <tr><td style="padding:5px 0;color:#666">Package</td><td>${pkgSummary}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Content rows</td><td>${contentRows?.length || 0}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Client</td><td>${m.client_name} / ${m.company}</td></tr>
          </table>
          <p>Once all posts are live, you'll receive a delivery email with links to every post.</p>
          <p style="color:#999;font-size:12px">Questions? Email hello@kaus-ai.com</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Client email error:', err.message);
  }

  console.log('Order processed:', token, session.customer_email, `${contentRows?.length || 0} rows`);
  res.json({ received: true });
}
