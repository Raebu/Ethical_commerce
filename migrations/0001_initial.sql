-- D1 / SQLite initial schema. Apply via Wrangler migrations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS stores (
 id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 slug TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 theme_color TEXT NOT NULL DEFAULT '#256b59',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS store_members (
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
 PRIMARY KEY(store_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON store_members(user_id);

CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 country TEXT NOT NULL DEFAULT '',
 website TEXT NOT NULL DEFAULT '',
 risk_notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_store ON suppliers(store_id);

CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
 slug TEXT NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',
 price_minor INTEGER NOT NULL DEFAULT 0 CHECK(price_minor>=0),
 currency TEXT NOT NULL DEFAULT 'GBP',
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(store_id,slug)
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id,status);
CREATE INDEX IF NOT EXISTS idx_products_public ON products(status,updated_at);

CREATE TABLE IF NOT EXISTS evidence (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
 supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 issuer TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL DEFAULT '',
 details TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'supplier_declared' CHECK(status IN ('supplier_declared','evidence_checked','independently_verified','rejected')),
 checked_by TEXT REFERENCES users(id),
 checked_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_product ON evidence(product_id);

CREATE TABLE IF NOT EXISTS passport_claims (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 facet TEXT NOT NULL CHECK(facet IN ('origin','workers','environment','animals','safety','durability','commercial')),
 statement TEXT NOT NULL,
 evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_claims_product ON passport_claims(product_id);

CREATE TABLE IF NOT EXISTS trace_events (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 stage TEXT NOT NULL CHECK(stage IN ('source','process','manufacture','package','transport','warehouse','retail','repair','reuse')),
 actor_name TEXT NOT NULL,
 place TEXT NOT NULL DEFAULT '',
 happened_at TEXT NOT NULL,
 evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trace_product ON trace_events(product_id,happened_at);

CREATE TABLE IF NOT EXISTS listing_jobs (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('csv','ebay','amazon','etsy','shopify','woocommerce','tiktok')),
 status TEXT NOT NULL DEFAULT 'needs_connection' CHECK(status IN ('needs_connection','export_ready','queued','published','failed')),
 external_ref TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(product_id,channel)
);
CREATE INDEX IF NOT EXISTS idx_jobs_store ON listing_jobs(store_id);

CREATE TABLE IF NOT EXISTS complaints (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
 category TEXT NOT NULL CHECK(category IN ('worker_welfare','product_safety','misleading_claim','animal_welfare','environment','other')),
 message TEXT NOT NULL,
 contact_email TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved')),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_complaints_store ON complaints(store_id,status);

CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 resource_type TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '',
 previous_hash TEXT NOT NULL DEFAULT '',
 event_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_store ON audit_events(store_id,created_at);

-- Deny automatic payment processing and external publication until explicit provider integrations pass review.
