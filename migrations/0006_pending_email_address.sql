-- One-time schema extension for authenticated email-address verification and change.
-- Pending addresses never replace the login email until the bearer confirms the token.
ALTER TABLE email_challenges ADD COLUMN target_email TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_email_challenges_expiry ON email_challenges(expires_at);
