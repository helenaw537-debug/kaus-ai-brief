// api/stripe-webhook.js
// Stripe webhook: on successful payment, save order to Supabase + send Resend emails
// Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, SITE_URL

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://kaus-site.vercel.app';

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

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: 'Kaus <orders@kaus-ai.com>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const m = session.metadata;
    const token = session.id; // Use Stripe session ID as order token
    const contentUrl = `${SITE_URL}/content?token=${token}`;

    // 1. Save order to Supabase
    try {
      await supabaseInsert('orders', {
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
        status: 'pending_content',
      });
    } catch (err) {
      console.error('Supabase save error:', err.message);
      // Don't fail the webhook — still send emails
    }

    // 2. Email to client: content submission link
    await sendEmail({
      to: session.customer_email,
      subject: '✅ Kaus — 付款成功，请填写发帖内容',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="font-size:20px">付款成功 🎉</h2>
          <p>感谢下单！现在只需填写你的发帖内容，我们的算法将自动开始匹配账号并发帖。</p>
          <p style="margin:24px 0">
            <a href="${contentUrl}" style="background:#D13239;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
              📋 填写发帖内容
            </a>
          </p>
          <p style="color:#666;font-size:14px">
            套餐: ${m.package_type === 'combined' ? `${m.posts_qty}篇帖子 + ${m.comments_qty}条评论` : m.package_type === 'posts' ? `${m.posts_qty}篇帖子` : `${m.comments_qty}条评论`}<br/>
            客户: ${m.client_name} / ${m.company}
          </p>
          <p style="color:#999;font-size:12px">链接：${contentUrl}</p>
        </div>
      `,
    });

    // 3. Internal notification to Helena
    await sendEmail({
      to: 'helena.w537@gmail.com',
      subject: `🛒 新订单 — ${m.company || m.client_name} (¥${m.order_price})`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="font-size:20px">新订单收到</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:6px 0;color:#666">客户</td><td>${m.client_name} / ${m.company}</td></tr>
            <tr><td style="padding:6px 0;color:#666">邮箱</td><td>${session.customer_email}</td></tr>
            <tr><td style="padding:6px 0;color:#666">微信</td><td>${m.wechat || '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#666">套餐</td><td>${m.package_type} — ${m.posts_qty}篇帖子 + ${m.comments_qty}条评论</td></tr>
            <tr><td style="padding:6px 0;color:#666">金额</td><td>¥${m.order_price}</td></tr>
            <tr><td style="padding:6px 0;color:#666">内容简介</td><td>${m.content_brief || '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#666">订单 ID</td><td><code>${token}</code></td></tr>
          </table>
          <p style="margin-top:16px">等待客户提交内容：<a href="${contentUrl}">${contentUrl}</a></p>
        </div>
      `,
    });

    console.log('Order processed:', token, session.customer_email);
  }

  res.json({ received: true });
}

export const config = { api: { bodyParser: false } };
