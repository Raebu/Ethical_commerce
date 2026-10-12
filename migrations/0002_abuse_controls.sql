-- Protective request counters. Apply through Wrangler remote migration before the Worker deploys.
-- Only pseudonymous SHA-256 bucket keys are stored; no raw IP addresses or email addresses.
CREATE TABLE IF NOT EXISTS abuse_counters (
 bucket TEXT PRIMARY KEY,
 hits INTEGER NOT NULL DEFAULT 1 CHECK(hits >= 0),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_counters_expires ON abuse_counters(expires_at);
