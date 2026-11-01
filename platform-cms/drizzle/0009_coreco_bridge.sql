-- Ephemeral replay protection, no identities, content or authentication secrets.
CREATE TABLE IF NOT EXISTS cms_coreco_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS cms_coreco_nonces_expiry ON cms_coreco_nonces(expires_at);
