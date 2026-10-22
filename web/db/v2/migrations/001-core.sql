CREATE TABLE IF NOT EXISTS v2_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS v2_deployments (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  deployment_address TEXT NOT NULL,
  PRIMARY KEY (chain_id, marketplace),
  UNIQUE (chain_id, deployment_address)
);

CREATE TABLE IF NOT EXISTS v2_indexer_cursors (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  cursor TEXT NOT NULL,
  PRIMARY KEY (chain_id, marketplace)
);

CREATE TABLE IF NOT EXISTS v2_indexed_blocks (
  chain_id BIGINT NOT NULL,
  block_number NUMERIC(78,0) NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  PRIMARY KEY (chain_id, block_number),
  UNIQUE (chain_id, block_hash)
);

CREATE TABLE IF NOT EXISTS v2_chain_events (
  chain_id BIGINT NOT NULL,
  block_number NUMERIC(78,0) NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index BIGINT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS v2_jobs (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  job_id NUMERIC(78,0) NOT NULL,
  reward NUMERIC(78,0) NOT NULL,
  status TEXT NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  terms_hash TEXT NOT NULL,
  client TEXT NOT NULL,
  operator TEXT,
  resolver TEXT,
  source_block NUMERIC(78,0),
  source_hash TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, marketplace, job_id)
);

CREATE TABLE IF NOT EXISTS v2_job_documents (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  job_id NUMERIC(78,0) NOT NULL,
  version BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  content JSONB NOT NULL,
  visibility TEXT NOT NULL,
  UNIQUE (chain_id, marketplace, job_id, version)
);

CREATE TABLE IF NOT EXISTS v2_deliveries (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  job_id NUMERIC(78,0) NOT NULL,
  version BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  content JSONB NOT NULL,
  visibility TEXT NOT NULL,
  receipt_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (chain_id, marketplace, job_id, version)
);

CREATE TABLE IF NOT EXISTS v2_applications (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  job_id NUMERIC(78,0) NOT NULL,
  operator TEXT NOT NULL,
  digest TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  pitch TEXT NOT NULL,
  epoch NUMERIC(78,0) NOT NULL,
  op_nonce NUMERIC(78,0) NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  verification_block NUMERIC(78,0),
  verification_hash TEXT,
  UNIQUE (chain_id, marketplace, job_id, operator),
  UNIQUE (chain_id, marketplace, job_id, digest)
);

CREATE TABLE IF NOT EXISTS v2_auth_challenges (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  domain TEXT NOT NULL,
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS v2_sessions (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  origin TEXT NOT NULL,
  chain_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_audit_events (
  id TEXT PRIMARY KEY,
  actor_wallet TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS v2_idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS v2_operator_projection (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  operator TEXT NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, marketplace, operator)
);

CREATE TABLE IF NOT EXISTS v2_credit_projection (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  wallet TEXT NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  balance NUMERIC(78,0) NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, marketplace, wallet)
);

CREATE TABLE IF NOT EXISTS v2_reservations (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  wallet TEXT NOT NULL,
  amount NUMERIC(78,0) NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS v2_mutual_requests (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  requester TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE v2_jobs ADD CONSTRAINT v2_jobs_reward_nonnegative CHECK (reward >= 0);
ALTER TABLE v2_jobs ADD CONSTRAINT v2_jobs_state_version_nonnegative CHECK (state_version >= 0);
ALTER TABLE v2_jobs ADD CONSTRAINT v2_jobs_uint256 CHECK (job_id >= 0 AND job_id <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
ALTER TABLE v2_applications ADD CONSTRAINT v2_applications_uint256 CHECK (epoch >= 0 AND epoch <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
ALTER TABLE v2_applications ADD CONSTRAINT v2_applications_nonce_uint256 CHECK (op_nonce >= 0 AND op_nonce <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
