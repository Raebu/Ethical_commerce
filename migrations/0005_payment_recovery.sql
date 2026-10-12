-- Recovery worklist for payment-provider incidents that must never be silently
-- converted to cancellations, shipments, refunds or success receipts.
CREATE TABLE IF NOT EXISTS payment_incidents (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(reason IN (
  'unknown_checkout_result','checkout_persistence_failed','late_paid_after_cancel',
  'session_mismatch','missing_session_after_timeout'
 )),
 stripe_event_id TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','resolved')),
 ops_note TEXT NOT NULL DEFAULT '',
 reviewed_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(order_id,reason)
);
CREATE INDEX IF NOT EXISTS idx_payment_incidents_status ON payment_incidents(status,created_at);
