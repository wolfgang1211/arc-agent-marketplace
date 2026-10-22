-- Fork-aware indexer foundation. 001-core remains immutable; its index tables are legacy.
CREATE TABLE IF NOT EXISTS v2_indexer_blocks_fork (
  chain_id BIGINT NOT NULL,
  stream TEXT NOT NULL,
  block_number NUMERIC(78,0) NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  header JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_id, stream, block_number, block_hash),
  CHECK (block_number >= 0),
  CHECK (length(block_hash) = 66 AND block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  CHECK (length(parent_hash) = 66 AND parent_hash ~ '^0x[0-9a-fA-F]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_indexer_blocks_fork_canonical_height
  ON v2_indexer_blocks_fork (chain_id, stream, block_number) WHERE canonical;
CREATE UNIQUE INDEX IF NOT EXISTS v2_indexer_blocks_fork_hash
  ON v2_indexer_blocks_fork (chain_id, stream, block_hash);

CREATE TABLE IF NOT EXISTS v2_indexer_events_fork (
  chain_id BIGINT NOT NULL,
  stream TEXT NOT NULL,
  emitter TEXT NOT NULL,
  block_number NUMERIC(78,0) NOT NULL,
  block_hash TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  transaction_index INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  topics JSONB NOT NULL,
  data TEXT NOT NULL,
  decoded JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_name TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (chain_id, stream, emitter, block_hash, transaction_hash, log_index),
  CHECK (block_number >= 0),
  CHECK (transaction_index >= 0 AND log_index >= 0),
  CHECK (length(emitter) = 42 AND emitter ~ '^0x[0-9a-fA-F]{40}$'),
  CHECK (length(block_hash) = 66 AND block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  CHECK (length(transaction_hash) = 66 AND transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  CHECK (jsonb_typeof(topics) = 'array')
);
CREATE INDEX IF NOT EXISTS v2_indexer_events_fork_order
  ON v2_indexer_events_fork (chain_id, stream, block_number, transaction_index, log_index);

ALTER TABLE v2_jobs ALTER COLUMN state_version TYPE NUMERIC(78,0) USING state_version::numeric;
ALTER TABLE v2_operator_projection ALTER COLUMN state_version TYPE NUMERIC(78,0) USING state_version::numeric;
ALTER TABLE v2_credit_projection ALTER COLUMN state_version TYPE NUMERIC(78,0) USING state_version::numeric;
ALTER TABLE v2_jobs ADD CONSTRAINT v2_jobs_state_version_uint256 CHECK (state_version >= 0 AND state_version <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
ALTER TABLE v2_operator_projection ADD CONSTRAINT v2_operator_state_version_uint256 CHECK (state_version >= 0 AND state_version <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
ALTER TABLE v2_credit_projection ADD CONSTRAINT v2_credit_state_version_uint256 CHECK (state_version >= 0 AND state_version <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
