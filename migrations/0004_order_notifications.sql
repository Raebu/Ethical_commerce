-- Add an auditable, explicitly authorised fulfilment and notification layer.
-- No external contact or live sale is automatically enabled by this migration.
-- Snapshot supplier at checkout so later catalogue edits cannot reroute a paid order.
ALTER TABLE order_items ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);
CREATE TABLE IF NOT EXISTS supplier_order_settings (
 supplier_id TEXT PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 ordering_email TEXT NOT NULL DEFAULT '',
 merchant_confirmed_authorization INTEGER NOT NULL DEFAULT 0 CHECK(merchant_confirmed_authorization IN (0,1)),
 merchant_authorized_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_order_settings_store ON supplier_order_settings(store_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','requested','accepted','dispatched','delivered','issue','cancelled')),
 supplier_reference TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 request_idempotency_key TEXT UNIQUE,
 requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 requested_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(order_id,supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_store ON purchase_orders(store_id,status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order ON purchase_orders(order_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
 id TEXT PRIMARY KEY,
 purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 sku TEXT NOT NULL,
 product_name TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>=1 AND quantity<=100),
 UNIQUE(purchase_order_id,product_id)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
 id TEXT PRIMARY KEY,
 event_key TEXT NOT NULL UNIQUE,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
 purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
 recipient_email TEXT NOT NULL,
 template TEXT NOT NULL CHECK(template IN ('buyer_paid','seller_paid','buyer_tracking','seller_consumer_request','supplier_purchase_order','buyer_refund')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 retry_after INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0,
 provider_message_id TEXT,
 last_error_class TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox(status,retry_after,lease_until);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_store ON notification_outbox(store_id,created_at);
