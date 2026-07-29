BEGIN;

CREATE TABLE IF NOT EXISTS chain_cursor (
  chain_id BIGINT PRIMARY KEY CHECK (chain_id > 0),
  next_block NUMERIC(78, 0) NOT NULL CHECK (next_block >= 0),
  version BIGINT NOT NULL CHECK (version > 0),
  checkpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (jsonb_typeof(checkpoints) = 'array')
);

CREATE TABLE IF NOT EXISTS canonical_chain_event (
  event_id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash CHAR(66) NOT NULL,
  transaction_hash CHAR(66) NOT NULL,
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  contract_address CHAR(42) NOT NULL,
  topics JSONB NOT NULL,
  event_data TEXT NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_id, block_hash, transaction_hash, log_index),
  CHECK (jsonb_typeof(topics) = 'array')
);

CREATE INDEX IF NOT EXISTS canonical_chain_event_scan_idx
  ON canonical_chain_event (chain_id, block_number, transaction_index, log_index);

CREATE TABLE IF NOT EXISTS order_job (
  job_key TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  order_id CHAR(66) NOT NULL,
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('scheduled', 'leased', 'succeeded', 'dead-letter')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_id, order_id, round),
  CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR
    (status <> 'leased' AND lease_owner IS NULL
      AND lease_token IS NULL AND lease_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS order_job_due_idx
  ON order_job (available_at, sequence)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS order_job_expired_lease_idx
  ON order_job (lease_until, sequence)
  WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS assignment_decision (
  decision_id CHAR(66) PRIMARY KEY,
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  diamond_address CHAR(42) NOT NULL,
  order_id CHAR(66) NOT NULL,
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  snapshot_block NUMERIC(78, 0) NOT NULL CHECK (snapshot_block >= 0),
  snapshot_block_hash CHAR(66) NOT NULL,
  policy_hash CHAR(66) NOT NULL,
  helper_build_version TEXT NOT NULL,
  canonical_payload JSONB NOT NULL,
  initial_state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (chain_id, order_id, round),
  CHECK (initial_state IN (
    'computed',
    'shadowed',
    'simulation-failed',
    'simulated',
    'send-blocked',
    'submitted',
    'confirmed',
    'reverted',
    'superseded'
  ))
);

CREATE TABLE IF NOT EXISTS candidate_evaluation (
  decision_id CHAR(66) NOT NULL
    REFERENCES assignment_decision(decision_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  merchant CHAR(42) NOT NULL,
  channel_id CHAR(66),
  eligibility_code TEXT NOT NULL,
  required_value NUMERIC(78, 0) NOT NULL CHECK (required_value >= 0),
  available_value NUMERIC(78, 0) NOT NULL CHECK (available_value >= 0),
  source TEXT NOT NULL CHECK (source IN ('snapshot', 'contract')),
  detail TEXT,
  PRIMARY KEY (decision_id, ordinal)
);

CREATE INDEX IF NOT EXISTS candidate_evaluation_reason_idx
  ON candidate_evaluation (eligibility_code, decision_id);

CREATE TABLE IF NOT EXISTS decision_state_event (
  event_id TEXT PRIMARY KEY,
  decision_id CHAR(66) NOT NULL
    REFERENCES assignment_decision(decision_id) ON DELETE RESTRICT,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  reason_code TEXT NOT NULL,
  transaction_attempt_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (decision_id, sequence)
);

CREATE INDEX IF NOT EXISTS decision_state_event_decision_idx
  ON decision_state_event (decision_id, sequence);

CREATE TABLE IF NOT EXISTS nonce_owner (
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  signer CHAR(42) NOT NULL,
  owner_id TEXT,
  fencing_token TEXT,
  lease_until TIMESTAMPTZ,
  next_nonce NUMERIC(78, 0) NOT NULL CHECK (next_nonce >= 0),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chain_id, signer),
  CHECK (
    (owner_id IS NULL AND fencing_token IS NULL AND lease_until IS NULL)
    OR
    (owner_id IS NOT NULL AND fencing_token IS NOT NULL
      AND lease_until IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS tx_attempt (
  attempt_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  signer CHAR(42) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL CHECK (nonce >= 0),
  unsigned_transaction JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'prepared',
    'signing-failed',
    'submitted',
    'broadcast-unknown',
    'confirmed',
    'reverted',
    'reorged',
    'replaced'
  )),
  transaction_hash CHAR(66),
  replaces_attempt_id TEXT REFERENCES tx_attempt(attempt_id) ON DELETE RESTRICT,
  receipt_block_number NUMERIC(78, 0),
  receipt_block_hash CHAR(66),
  failure_code TEXT,
  version BIGINT NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (chain_id, signer, nonce, attempt_id)
);

CREATE INDEX IF NOT EXISTS tx_attempt_nonce_idx
  ON tx_attempt (chain_id, signer, nonce, created_at);

CREATE INDEX IF NOT EXISTS tx_attempt_pending_idx
  ON tx_attempt (updated_at)
  WHERE status IN ('submitted', 'broadcast-unknown', 'reorged');

CREATE TABLE IF NOT EXISTS scheduled_work (
  work_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('active', 'leased', 'completed', 'dead')
  ),
  expires_at TIMESTAMPTZ,
  retry_at TIMESTAMPTZ,
  expiry_handled BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR
    (status <> 'leased' AND lease_owner IS NULL
      AND lease_token IS NULL AND lease_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS scheduled_work_expiry_idx
  ON scheduled_work (expires_at, sequence)
  WHERE status = 'active' AND expiry_handled = FALSE;

CREATE INDEX IF NOT EXISTS scheduled_work_retry_idx
  ON scheduled_work (retry_at, sequence)
  WHERE status = 'active';

COMMIT;
