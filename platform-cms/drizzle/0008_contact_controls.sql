-- Transient, scoped hash buckets only. No contact payload or raw IP is stored.
CREATE TABLE contact_rate_limits (
 bucket_key text PRIMARY KEY NOT NULL,
 window_start integer NOT NULL,
 attempts integer NOT NULL,
 expires_at integer NOT NULL
);
CREATE INDEX contact_rate_limits_expiry ON contact_rate_limits(expires_at);
