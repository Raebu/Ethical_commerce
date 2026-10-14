-- 0007: voluntary, merchant-declared transparency. No payments or certification.
-- Sensitive supplier notes and costs are never published without express per-record opt-in.
CREATE TABLE IF NOT EXISTS product_money_disclosures (
 id TEXT PRIMARY KEY,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('materials','manufacturing','logistics','platform','tax','retailer','other')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 100000000),
 note TEXT NOT NULL DEFAULT '',
 evidence_url TEXT NOT NULL DEFAULT '',
 public_consent INTEGER NOT NULL DEFAULT 0 CHECK(public_consent IN (0,1)),
 evidence_status TEXT NOT NULL DEFAULT 'merchant_declared' CHECK(evidence_status='merchant_declared'),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(product_id,category)
);
CREATE INDEX IF NOT EXISTS idx_money_public ON product_money_disclosures(product_id,public_consent);

CREATE TABLE IF NOT EXISTS supplier_public_profiles (
 supplier_id TEXT PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
 store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
 description TEXT NOT NULL DEFAULT '',
 categories TEXT NOT NULL DEFAULT '',
 evidence_url TEXT NOT NULL DEFAULT '',
 fulfillment_notes TEXT NOT NULL DEFAULT '',
 public_consent INTEGER NOT NULL DEFAULT 0 CHECK(public_consent IN (0,1)),
 evidence_status TEXT NOT NULL DEFAULT 'merchant_declared' CHECK(evidence_status='merchant_declared'),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_public ON supplier_public_profiles(public_consent,store_id);
