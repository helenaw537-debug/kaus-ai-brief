-- Kaus order database — full schema v2
-- Run this in Supabase SQL Editor (safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- ── ORDERS ──────────────────────────────────────────────────────────────────
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
  status            text DEFAULT 'pending_content', -- pending_content | ready | queued | executing | completed
  lang              text DEFAULT 'zh',              -- zh | en (matches landing page language)
  pending_content_id uuid,                          -- links to pending_content before payment
  created_at        timestamptz DEFAULT now()
);

-- Add new columns to existing orders table (safe re-run)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lang text DEFAULT 'zh';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_content_id uuid;

-- ── PENDING CONTENT (pre-payment upload) ────────────────────────────────────
-- Saved when customer creates checkout session; linked to order after payment
CREATE TABLE IF NOT EXISTS pending_content (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rows         jsonb NOT NULL,       -- [{target: "r/SaaS", content: "..."}, ...]
  content_type text NOT NULL,        -- post | comment
  lang         text DEFAULT 'zh',
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz DEFAULT now() + interval '48 hours'
);

-- ── ORDER CONTENT (post-payment, linked to order) ────────────────────────────
-- Updated to support both old text-based and new rows-jsonb format
CREATE TABLE IF NOT EXISTS order_content (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid REFERENCES orders(id),
  order_token       text NOT NULL,
  rows              jsonb,           -- [{target, content}, ...] from upload form
  content_type      text,            -- post | comment
  post_content      text,            -- legacy: raw text (kept for backward compat)
  subreddits        text,            -- legacy
  comment_targets   text,            -- legacy
  comment_direction text,            -- legacy
  submitted_at      timestamptz DEFAULT now()
);

-- Add new columns to existing order_content (safe re-run)
ALTER TABLE order_content ADD COLUMN IF NOT EXISTS rows jsonb;
ALTER TABLE order_content ADD COLUMN IF NOT EXISTS content_type text;

-- ── ORDER POSTS (individual execution records) ───────────────────────────────
-- One row per Reddit post/comment to be executed
CREATE TABLE IF NOT EXISTS order_posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid REFERENCES orders(id),
  row_index    int NOT NULL,
  target       text,               -- r/SaaS or https://reddit.com/r/...
  content      text NOT NULL,      -- post text or comment text
  account_id   text,               -- Composio connection ID assigned
  post_url     text,               -- Reddit URL after execution
  post_id      text,               -- Reddit post/comment ID
  status       text DEFAULT 'queued',  -- queued | executing | done | failed
  error_msg    text,
  posted_at    timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_content   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_posts     ENABLE ROW LEVEL SECURITY;

-- Service role has full access (DROP IF EXISTS + CREATE is safe across PostgreSQL 14/15)
DROP POLICY IF EXISTS "service_full_access_orders"   ON orders;
CREATE POLICY "service_full_access_orders"   ON orders          FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_full_access_content"  ON order_content;
CREATE POLICY "service_full_access_content"  ON order_content   FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_full_access_pending"  ON pending_content;
CREATE POLICY "service_full_access_pending"  ON pending_content FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_full_access_posts"    ON order_posts;
CREATE POLICY "service_full_access_posts"    ON order_posts     FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_posts_status ON order_posts(status);
CREATE INDEX IF NOT EXISTS idx_order_posts_account ON order_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_order_posts_order ON order_posts(order_id);
