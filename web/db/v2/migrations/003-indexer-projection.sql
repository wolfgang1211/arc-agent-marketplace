-- Truthful pinned-reader projections. No event-derived policy or fabricated parties.
CREATE TABLE IF NOT EXISTS v2_policy_projection (
  chain_id BIGINT NOT NULL,
  marketplace TEXT NOT NULL,
  scope TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  policy_key TEXT NOT NULL DEFAULT '',
  source_block NUMERIC(78,0) NOT NULL,
  source_hash TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (chain_id, marketplace, scope, account, policy_key)
);

-- Account/operator state_version is not a chain-reader field; preserve honest NULL.
ALTER TABLE v2_operator_projection ALTER COLUMN state_version DROP NOT NULL;
ALTER TABLE v2_operator_projection ALTER COLUMN state_version DROP DEFAULT;
ALTER TABLE v2_credit_projection ALTER COLUMN state_version DROP NOT NULL;
ALTER TABLE v2_credit_projection ALTER COLUMN state_version DROP DEFAULT;
