-- UNAPPLIED SHADOW DDL SCAFFOLDING under the 2026-07-29 Council REJECT.
-- Do not run this file against an external or production database. It creates
-- no value-state migration, chain action, transaction authority, or bank fact.

BEGIN;

-- Shadow-only state for the 2026-07-29 Council REJECT disposition.
-- None of these rows authorize a transaction or represent bank/custody truth.

CREATE TABLE IF NOT EXISTS shadow_policy_version (
  policy_hash CHAR(66) PRIMARY KEY
    CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  schema_version TEXT NOT NULL,
  helper_build_hash CHAR(66) NOT NULL
    CHECK (helper_build_hash ~ '^0x[0-9a-f]{64}$'),
  council_bill_sha256 CHAR(64) NOT NULL CHECK (
    council_bill_sha256 =
      '4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916'
  ),
  canonical_policy TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  simulation_report_hash CHAR(64) CHECK (
    simulation_report_hash IS NULL
    OR simulation_report_hash ~ '^[0-9a-f]{64}$'
  ),
  fixture_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (fixture_only),
  action_authorization BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (action_authorization = FALSE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS economic_operator_service_state (
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  fiat_currency TEXT NOT NULL,
  payment_rail_group TEXT NOT NULL,
  order_side TEXT NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
  domain_epoch CHAR(66) NOT NULL
    CHECK (domain_epoch ~ '^0x[0-9a-f]{64}$'),
  operator_id CHAR(66) NOT NULL
    CHECK (operator_id ~ '^0x[0-9a-f]{64}$'),
  failure_domain_id CHAR(66) NOT NULL
    CHECK (failure_domain_id ~ '^0x[0-9a-f]{64}$'),
  accepted_usdc NUMERIC(78, 0) NOT NULL DEFAULT 0
    CHECK (accepted_usdc >= 0),
  virtual_finish_q NUMERIC(78, 0) NOT NULL DEFAULT 0
    CHECK (virtual_finish_q >= 0),
  domain_version BIGINT NOT NULL DEFAULT 1 CHECK (domain_version > 0),
  updated_block NUMERIC(78, 0) NOT NULL CHECK (updated_block >= 0),
  updated_block_hash CHAR(66) NOT NULL
    CHECK (updated_block_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    chain_id,
    fiat_currency,
    payment_rail_group,
    order_side,
    domain_epoch,
    operator_id
  )
);

CREATE TABLE IF NOT EXISTS canonical_acceptance (
  acceptance_event_id CHAR(66) PRIMARY KEY
    CHECK (acceptance_event_id ~ '^0x[0-9a-f]{64}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  fiat_currency TEXT NOT NULL,
  payment_rail_group TEXT NOT NULL,
  order_side TEXT NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
  domain_epoch CHAR(66) NOT NULL
    CHECK (domain_epoch ~ '^0x[0-9a-f]{64}$'),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash CHAR(66) NOT NULL
    CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  order_id CHAR(66) NOT NULL
    CHECK (order_id ~ '^0x[0-9a-f]{64}$'),
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  decision_id CHAR(66) NOT NULL
    CHECK (decision_id ~ '^0x[0-9a-f]{64}$'),
  operator_id CHAR(66) NOT NULL
    CHECK (operator_id ~ '^0x[0-9a-f]{64}$'),
  accepted_usdc NUMERIC(78, 0) NOT NULL CHECK (accepted_usdc > 0),
  domain_floor_q NUMERIC(78, 0) NOT NULL CHECK (domain_floor_q >= 0),
  state_version_before BIGINT NOT NULL CHECK (state_version_before > 0),
  state_version_after BIGINT NOT NULL
    CHECK (state_version_after = state_version_before + 1),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (
    chain_id,
    fiat_currency,
    payment_rail_group,
    order_side,
    domain_epoch,
    order_id,
    round
  )
);

CREATE TABLE IF NOT EXISTS open_offer_slot (
  slot_id CHAR(66) PRIMARY KEY
    CHECK (slot_id ~ '^0x[0-9a-f]{64}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  fiat_currency TEXT NOT NULL,
  payment_rail_group TEXT NOT NULL,
  order_side TEXT NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
  domain_epoch CHAR(66) NOT NULL
    CHECK (domain_epoch ~ '^0x[0-9a-f]{64}$'),
  order_id CHAR(66) NOT NULL
    CHECK (order_id ~ '^0x[0-9a-f]{64}$'),
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  decision_id CHAR(66) NOT NULL
    CHECK (decision_id ~ '^0x[0-9a-f]{64}$'),
  operator_id CHAR(66) NOT NULL
    CHECK (operator_id ~ '^0x[0-9a-f]{64}$'),
  merchant CHAR(42) NOT NULL
    CHECK (merchant ~ '^0x[0-9a-f]{40}$'),
  channel_id CHAR(66) NOT NULL
    CHECK (channel_id ~ '^0x[0-9a-f]{64}$'),
  usdc_amount NUMERIC(78, 0) NOT NULL CHECK (usdc_amount > 0),
  opened_sequence NUMERIC(78, 0) NOT NULL CHECK (opened_sequence >= 0),
  status TEXT NOT NULL CHECK (status IN ('live', 'released')),
  release_reason TEXT,
  release_event_id CHAR(66) CHECK (
    release_event_id IS NULL
    OR release_event_id ~ '^0x[0-9a-f]{64}$'
  ),
  opened_block NUMERIC(78, 0) NOT NULL CHECK (opened_block >= 0),
  opened_block_hash CHAR(66) NOT NULL
    CHECK (opened_block_hash ~ '^0x[0-9a-f]{64}$'),
  released_block NUMERIC(78, 0),
  released_block_hash CHAR(66) CHECK (
    released_block_hash IS NULL
    OR released_block_hash ~ '^0x[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (
    chain_id,
    fiat_currency,
    payment_rail_group,
    order_side,
    domain_epoch,
    order_id,
    round,
    operator_id
  ),
  CHECK (
    (status = 'live' AND release_reason IS NULL
      AND release_event_id IS NULL AND released_block IS NULL
      AND released_block_hash IS NULL)
    OR
    (status = 'released' AND release_reason IS NOT NULL
      AND release_event_id IS NOT NULL AND released_block IS NOT NULL
      AND released_block_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS open_offer_slot_live_operator_idx
  ON open_offer_slot (
    chain_id,
    fiat_currency,
    payment_rail_group,
    order_side,
    domain_epoch,
    operator_id,
    opened_sequence
  )
  WHERE status = 'live';

CREATE TABLE IF NOT EXISTS selection_history_event (
  event_id CHAR(66) PRIMARY KEY
    CHECK (event_id ~ '^0x[0-9a-f]{64}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  operator_id CHAR(66) NOT NULL
    CHECK (operator_id ~ '^0x[0-9a-f]{64}$'),
  fiat_currency TEXT NOT NULL,
  payment_rail_group TEXT NOT NULL,
  order_side TEXT NOT NULL CHECK (order_side IN ('BUY', 'SELL')),
  domain_epoch CHAR(66) NOT NULL
    CHECK (domain_epoch ~ '^0x[0-9a-f]{64}$'),
  decision_id CHAR(66) NOT NULL
    CHECK (decision_id ~ '^0x[0-9a-f]{64}$'),
  order_id CHAR(66) NOT NULL
    CHECK (order_id ~ '^0x[0-9a-f]{64}$'),
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  sequence NUMERIC(78, 0) NOT NULL CHECK (sequence >= 0),
  event_kind TEXT NOT NULL CHECK (
    event_kind IN (
      'RANK_ZERO_ASSIGNED',
      'RANK_ZERO_MISSED',
      'ACCEPTED',
      'RESPONDED'
    )
  ),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash CHAR(66) NOT NULL
    CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (
    chain_id,
    fiat_currency,
    payment_rail_group,
    order_side,
    domain_epoch,
    operator_id,
    sequence,
    event_kind
  )
);

CREATE TABLE IF NOT EXISTS shadow_selection_trace (
  trace_id CHAR(66) PRIMARY KEY
    CHECK (trace_id ~ '^0x[0-9a-f]{64}$'),
  decision_id CHAR(66) CHECK (
    decision_id IS NULL OR decision_id ~ '^0x[0-9a-f]{64}$'
  ),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  order_id CHAR(66) NOT NULL
    CHECK (order_id ~ '^0x[0-9a-f]{64}$'),
  round NUMERIC(78, 0) NOT NULL CHECK (round >= 0),
  sequence NUMERIC(78, 0) NOT NULL CHECK (sequence >= 0),
  state_block NUMERIC(78, 0) NOT NULL CHECK (state_block >= 0),
  state_block_hash CHAR(66) NOT NULL
    CHECK (state_block_hash ~ '^0x[0-9a-f]{64}$'),
  policy_hash CHAR(66) NOT NULL
    CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  helper_build_hash CHAR(66) NOT NULL
    CHECK (helper_build_hash ~ '^0x[0-9a-f]{64}$'),
  universe_count INTEGER NOT NULL CHECK (universe_count >= 0),
  universe_root CHAR(66) NOT NULL
    CHECK (universe_root ~ '^0x[0-9a-f]{64}$'),
  eligibility_prestate_root CHAR(66) NOT NULL
    CHECK (eligibility_prestate_root ~ '^0x[0-9a-f]{64}$'),
  output_root CHAR(66) NOT NULL
    CHECK (output_root ~ '^0x[0-9a-f]{64}$'),
  witness_content_id CHAR(66) NOT NULL
    CHECK (witness_content_id ~ '^0x[0-9a-f]{64}$'),
  canonical_witness TEXT NOT NULL CHECK (length(canonical_witness) > 0),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) > 0),
  service_status TEXT NOT NULL
    CHECK (service_status IN ('SHADOW_DECISION', 'NO_SERVICE')),
  no_service_reason TEXT CHECK (
    no_service_reason IS NULL OR no_service_reason IN (
      'READINESS_GATE',
      'FAILURE_DOMAIN_GATE',
      'NO_FOUR_ELIGIBLE_OPERATORS'
    )
  ),
  selected_operator_ids CHAR(66)[] NOT NULL
    DEFAULT ARRAY[]::CHAR(66)[],
  capability TEXT NOT NULL
    CHECK (capability = 'TRANSACTION_DISABLED_SHADOW_ONLY'),
  action_authorization BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (action_authorization = FALSE),
  forecast_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (forecast_only),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_id, order_id, round, sequence),
  CHECK (
    (service_status = 'SHADOW_DECISION'
      AND decision_id = trace_id
      AND no_service_reason IS NULL
      AND cardinality(selected_operator_ids) = 4
      AND array_position(selected_operator_ids, NULL) IS NULL
      AND selected_operator_ids[1] ~ '^0x[0-9a-f]{64}$'
      AND selected_operator_ids[2] ~ '^0x[0-9a-f]{64}$'
      AND selected_operator_ids[3] ~ '^0x[0-9a-f]{64}$'
      AND selected_operator_ids[4] ~ '^0x[0-9a-f]{64}$'
      AND selected_operator_ids[1] <> selected_operator_ids[2]
      AND selected_operator_ids[1] <> selected_operator_ids[3]
      AND selected_operator_ids[1] <> selected_operator_ids[4]
      AND selected_operator_ids[2] <> selected_operator_ids[3]
      AND selected_operator_ids[2] <> selected_operator_ids[4]
      AND selected_operator_ids[3] <> selected_operator_ids[4])
    OR
    (service_status = 'NO_SERVICE'
      AND decision_id IS NULL
      AND no_service_reason IS NOT NULL
      AND cardinality(selected_operator_ids) = 0)
  )
);

COMMIT;
