-- Generic document store: mirrors the Firestore-style shape the frontend already
-- expects (src/lib/platform.ts's Store/DocRef/ColRef), so the server can stay a thin
-- path -> JSON layer instead of a rigid relational schema.
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verified Google identities (populated on sign-in), used for the admin's
-- "N invited / M unresolved" display only — not the check-in security gate,
-- which is the SHA-256 email hash already carried on the event document.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
