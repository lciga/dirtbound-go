CREATE TABLE IF NOT EXISTS schema_migrations (
 version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, username text NOT NULL DEFAULT '', pseudo text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credentials (
 login text PRIMARY KEY, account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
 salt text NOT NULL, hash text NOT NULL, iterations integer NOT NULL CHECK(iterations > 0)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 expires bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);
CREATE TABLE IF NOT EXISTS circuits (
 id text PRIMARY KEY, name text NOT NULL, data text NOT NULL, shape text NOT NULL,
 author text NOT NULL, owner text REFERENCES accounts(id), date text NOT NULL
);
CREATE INDEX IF NOT EXISTS circuits_date_idx ON circuits(date DESC, id);
CREATE INDEX IF NOT EXISTS circuits_owner_idx ON circuits(owner, date DESC);
CREATE TABLE IF NOT EXISTS circuit_stars (
 circuit_id text NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
 account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 PRIMARY KEY(circuit_id, account_id)
);
CREATE TABLE IF NOT EXISTS lap_records (
 track_key text NOT NULL, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name text NOT NULL, time double precision NOT NULL CHECK(time >= 1 AND time <= 86400),
 car text NOT NULL, color integer NOT NULL, ghost jsonb NOT NULL, date text NOT NULL,
 PRIMARY KEY(track_key, account_id)
);
CREATE INDEX IF NOT EXISTS laps_ranking_idx ON lap_records(track_key, time, account_id);
CREATE INDEX IF NOT EXISTS laps_account_idx ON lap_records(account_id, date DESC);
CREATE TABLE IF NOT EXISTS data_imports (
 name text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now(), source_sha256 text NOT NULL
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
