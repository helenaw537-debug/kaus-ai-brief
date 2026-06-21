// api/create-checkout.js
// Creates a Stripe Checkout session. Saves content rows to Supabase BEFORE payment.
// Returns { url } — frontend redirects to Stripe hosted payment page.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SITE_URL = process.env.SITE_URL || 'https://kaus-site.vercel.app';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function savePendingContent({ rows, content_type, lang }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pending_content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ rows, content_type, lang }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase pending_content insert failed: ${err}`);
  }
  const data = await res.json();
  return data[0]?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    name, email, company, wechat, content_brief,
    package_type, posts_qty, comments_qty, order_price,
    rows, content_type, lang,   // ← new: upload form content
  } = req.body;

  if (!email || !order_price) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Step 1: Save content rows to Supabase BEFORE payment
  let pendingContentId = null;
  if (rows && Array.isArray(rows) && rows.length > 0) {
    try {
      pendingContentId = await savePendingContent({
        rows,
        content_type: content_type || 'post',
        lang: lang || 'zh',
      });
    } catch (err) {
      console.error('Failed to save pending content:', err.message);
      // Don't block checkout — content can be re-submitted later
    }
  }

  // Step 2: Build package label
  const amountCents = Math.round(Number(order_price) * 100);
  const isZh = lang !== 'en';
  let packageLabel;
  if (isZh) {
    if (package_type === 'posts') packageLabel = `发帖套餐 ${posts_qty}篇`;
    else if (package_type === 'comments') packageLabel = `评论套餐 ${comments_qty}条`;
    else packageLabel = `组合套餐 ${posts_qty}篇帖子 + ${comments_qty}条评论`;
  } else {
    if (package_type === 'posts') packageLabel = `Post Package — ${posts_qty} posts`;
    else if (package_type === 'comments') packageLabel = `Comment Package — ${comments_qty} comments`;
    else packageLabel = `Combined — ${posts_qty} posts + ${comments_qty} comments`;
  }

  // Step 3: Create Stripe session
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'cny',
          unit_amount: amountCents,
          product_data: {
            name: `Kaus Reddit — ${packageLabel}`,
            description: company || name,
          },
        },
        quantity: 1,
      }],
      metadata: {
        client_name: name,
        client_email: email,
        company: company || '',
        wechat: wechat || '',
        content_brief: (content_brief || '').slice(0, 500),
        package_type,
        posts_qty: String(posts_qty || 0),
        comments_qty: String(comments_qty || 0),
        order_price: String(order_price),
        lang: lang || 'zh',
        pending_content_id: pendingContentId || '',  // link content to order after payment
        content_row_count: String(rows?.length || 0),
      },
      success_url: `${SITE_URL}/success.html?session={CHECKOUT_SESSION_ID}&lang=${lang || 'zh'}`,
      cancel_url: lang === 'en' ? `${SITE_URL}/en.html` : `${SITE_URL}/`,
      locale: lang === 'en' ? 'en' : 'zh',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
