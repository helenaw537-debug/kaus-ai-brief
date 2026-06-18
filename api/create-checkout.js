// api/create-checkout.js
// Creates a Stripe Checkout session from the zh.html order form
// Returns { url } — frontend redirects to Stripe hosted payment page

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SITE_URL = process.env.SITE_URL || 'https://kaus-site.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, company, wechat, content_brief, package_type, posts_qty, comments_qty, order_price } = req.body;

  if (!email || !order_price) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Convert RMB to cents (stripe uses smallest currency unit)
  // For CNY: 1 yuan = 100 fen
  const amountCents = Math.round(Number(order_price) * 100);

  let packageLabel = '帖子+评论套餐';
  if (package_type === 'posts') packageLabel = `发帖套餐 ${posts_qty}篇`;
  else if (package_type === 'comments') packageLabel = `评论套餐 ${comments_qty}条`;
  else packageLabel = `组合套餐 ${posts_qty}篇帖子 + ${comments_qty}条评论`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      // Accept card, Alipay, and WeChat Pay
      payment_method_types: ['card', 'alipay', 'wechat_pay'],
      line_items: [
        {
          price_data: {
            currency: 'cny',
            unit_amount: amountCents,
            product_data: {
              name: `Kaus Reddit 代发 — ${packageLabel}`,
              description: `客户: ${company || name}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        client_name: name,
        client_email: email,
        company: company || '',
        wechat: wechat || '',
        content_brief: (content_brief || '').slice(0, 500), // Stripe metadata limit
        package_type,
        posts_qty: String(posts_qty || 0),
        comments_qty: String(comments_qty || 0),
        order_price: String(order_price),
      },
      success_url: `${SITE_URL}/content?token={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/zh.html`,
      locale: 'zh',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
