-- Kaus order database — run this in your Supabase SQL Editor

-- Orders table: created by stripe-webhook on payment success
CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token             text UNIQUE NOT NULL,           -- Stripe checkout session ID
  stripe_session_id text,
  email             text NOT NULL,
  client_name       text,
  company           text,
  wechat            text,
  content_brief     text,
  package_type      text NOT NULL,                  -- combined | posts | comments
  posts_qty         int DEFAULT 0,
  comments_qty      int DEFAULT 0,
  order_price       numeric(10,2) DEFAULT 0,
  status            text DEFAULT 'pending_content', -- pending_content | ready | processing | completed
  created_at        timestamptz DEFAULT now()
);

-- Content table: created by submit-content on content.html submission
CREATE TABLE IF NOT EXISTS order_content (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid REFERENCES orders(id),
  order_token       text NOT NULL,
  post_content      text,       -- raw post text, separated by ---
  subreddits        text,       -- newline-separated subreddit names/URLs
  comment_targets   text,       -- newline-separated Reddit thread URLs
  comment_direction text,       -- optional comment guidance
  submitted_at      timestamptz DEFAULT now()
);

-- Enable Row Level Security (but allow service key full access)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_content ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes)
CREATE POLICY "service_full_access_orders" ON orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_full_access_content" ON order_content
  FOR ALL TO service_role USING (true) WITH CHECK (true);
