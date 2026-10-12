-- Commercial foundations. This migration does NOT enable public transactions.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE stores ADD COLUMN sales_paused INTEGER NOT NULL DEFAULT 1 CHECK(sales_paused IN (0,1));

CREATE TABLE IF NOT EXISTS email_challenges (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_challenge_user ON email_challenges(user_id);

CREATE TABLE IF NOT EXISTS merchant_compliance (
 store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
 legal_seller_name TEXT NOT NULL DEFAULT '',
 trading_address TEXT NOT NULL DEFAULT '',
 contact_email TEXT NOT NULL DEFAULT '',
 company_registration TEXT NOT NULL DEFAULT '',
 return_policy_url TEXT NOT NULL DEFAULT '',
 shipping_policy_url TEXT NOT NULL DEFAULT '',
 terms_url TEXT NOT NULL DEFAULT '',
 privacy_url TEXT NOT NULL DEFAULT '',
 cancellation_notice TEXT NOT NULL DEFAULT '',
 consumer_terms_accepted_at TEXT,
 stripe_account_id TEXT UNIQUE,
 stripe_details_submitted INTEGER NOT NULL DEFAULT 0,
 stripe_charges_enabled INTEGER NOT NULL DEFAULT 0,
 stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,
 stripe_reviewed_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 client_key_hash TEXT NOT NULL UNIQUE,
 access_token_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','cancelled','fulfilled','refunded','partially_refunded')),
 currency TEXT NOT NULL DEFAULT 'GBP' CHECK(currency='GBP'),
 subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor>=0),
 stripe_session_id TEXT UNIQUE,
 stripe_payment_intent_id TEXT,
 stripe_connected_account TEXT NOT NULL,
 customer_email TEXT NOT NULL DEFAULT '',
 session_expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status,session_expires_at);

CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 product_name TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>=1 AND quantity<=100),
 unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor>=0),
 UNIQUE(order_id,product_id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE TRIGGER IF NOT EXISTS trg_reserve_stock_before_insert BEFORE INSERT ON order_items
BEGIN
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM products p JOIN orders o ON o.store_id=p.store_id
    WHERE o.id=NEW.order_id AND p.id=NEW.product_id AND p.status='published'
      AND p.currency='GBP' AND p.price_minor=NEW.unit_price_minor AND p.stock>=NEW.quantity
 ) THEN RAISE(ABORT,'insufficient_stock_or_changed_price') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_reserve_stock_after_insert AFTER INSERT ON order_items
BEGIN
 UPDATE products SET stock=stock-NEW.quantity,updated_at=datetime('now') WHERE id=NEW.product_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_release_cancelled_order AFTER UPDATE OF status ON orders
WHEN OLD.status='pending_payment' AND NEW.status='cancelled'
BEGIN
 UPDATE products SET stock=stock+(
  SELECT quantity FROM order_items WHERE order_id=NEW.id AND product_id=products.id
 ) WHERE id IN (SELECT product_id FROM order_items WHERE order_id=NEW.id);
END;

CREATE TABLE IF NOT EXISTS stripe_events (
 event_id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL,
 connected_account TEXT NOT NULL DEFAULT '',
 received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_fulfillment (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 supplier_id TEXT REFERENCES suppliers(id),
 status TEXT NOT NULL DEFAULT 'awaiting_action' CHECK(status IN ('awaiting_action','supplier_requested','supplier_accepted','dispatched','delivered','issue')),
 carrier TEXT NOT NULL DEFAULT '',
 tracking_reference TEXT NOT NULL DEFAULT '',
 tracking_url TEXT NOT NULL DEFAULT '',
 seller_notes TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(order_id)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_store ON order_fulfillment(store_id,status);

CREATE TABLE IF NOT EXISTS consumer_requests (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('cancellation','return','refund','fault','complaint')),
 details TEXT NOT NULL,
 contact_email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_review','accepted','rejected','resolved')),
 resolution_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consumer_requests_store ON consumer_requests(store_id,status);

CREATE TABLE IF NOT EXISTS channel_connections (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('woocommerce','shopify')),
 base_url TEXT NOT NULL,
 encrypted_credentials TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'configured' CHECK(status IN ('configured','verified','disabled')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(store_id,channel)
);

CREATE TABLE IF NOT EXISTS approved_verifiers (
 id TEXT PRIMARY KEY,
 legal_name TEXT NOT NULL,
 registry_url TEXT NOT NULL,
 accreditation_reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','suspended')),
 approved_by TEXT REFERENCES users(id),
 approved_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS independent_assessments (
 id TEXT PRIMARY KEY,
 evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
 verifier_id TEXT NOT NULL REFERENCES approved_verifiers(id),
 verdict TEXT NOT NULL CHECK(verdict IN ('verified','rejected','revoked')),
 report_url TEXT NOT NULL,
 report_reference TEXT NOT NULL,
 valid_until TEXT,
 reviewed_by TEXT REFERENCES users(id),
 reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_evidence ON independent_assessments(evidence_id,reviewed_at);
