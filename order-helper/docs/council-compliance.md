# Council disposition and implementation boundary

The binding Council bill adopted 2026-07-29 by a unanimous 5–0 vote has SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`
and verdict **REJECT**.

The byte-verifiable adopted artifact is checked in as
[`COUNCIL_BILL.md`](./COUNCIL_BILL.md); its file SHA-256 is the exact value
above. Constants and prose are not substitutes for verifying those bytes.

This repository does not interpret REJECT as a canary approval. The bill
forbids transaction signing, private-key use, broadcasting, on-chain state
changes, assignment that can lead to value movement, the proposed cut and
initializer, merchant/channel/order/reservation/risk/principal/gross-fiat
value-state migration, and authoritative bank reconciliation. It permits only
transaction-disabled, non-signing, read-only/offline work: reconstruction, deterministic replay,
simulations, formulas and golden vectors, invariant scaffolding, and shadow
output that cannot authorize or trigger an action.

## Enforced boundary

- Configuration requires the exact bill hash and `COUNCIL_VERDICT=REJECT`.
- Only `HELPER_MODE=shadow` and `ENABLE_TRANSACTION_SENDING=false` are valid.
- Claims that the contract interface, helper deployment, or canary are
  verified are rejected at startup.
- The shipped runtime has no signing or broadcasting adapter and its send
  metric is always zero.
- Deployment examples inject no key reference.
- The selector, simulator, and replay CLI produce offline-only traces. A
  decision is evidence for review, not transaction authorization.
- Each trace stores a canonical, content-addressed selection witness containing
  normalized input, complete universe, eligibility prestates, exclusions, and
  output. The policy hash is derived from the exact canonical policy witness,
  which embeds this REJECT disposition; it is not accepted as a caller label.
- Provider-supplied free-form eligibility detail is removed before a witness or
  ledger row is formed. State events use only opaque 32-byte identifiers and
  fixed reason codes; arbitrary event metadata is not accepted.
- PostgreSQL, Redis, RPC, and KMS remain interfaces; no working external
  endpoint or credential integration is claimed.

## Binding amendments represented in shadow scaffolding

The experimental selection package models:

- one opaque economic-operator identity across wallets/channels;
- additive, idempotent accepted service and monotone acceptance-time virtual
  finish rebasing;
- reversible open-offer exposure separate from accepted service;
- a complete finalized candidate universe with count/root and canonical
  channel collapse;
- a typed, versioned decision trace and canonical replay witness with block
  hash, domain/epoch, derived policy and build identities, complete
  universe/prestate/output material, ordered ranks, and lease schedule;
- half-open lease timing and quote-runway rejection;
- explicit exact-four no-service plus parameterized `4 + F` readiness;
- event-sourced nonresponse, bounded expansion, rotation/concentration, and a
  domain-separated final tie-break;
- operator-level re-entry clamping and secondary inventory ordering; and
- global and comparable-exposure fairness, unresolved orders, rank exposure,
  capacity binding, and nonresponse as separate simulation measures.

All liveness, concentration, readiness-reserve, offer-weight, lease, TTL,
inventory, cooldown, and fairness threshold values are explicit experimental
fixture inputs. They are not Council-approved production constants.

## Deliberately absent

There is no deployed helper facet, assignment ABI/selector, contract-side
canonical-envelope recomputation, operator credential issuer, KMS/HSM signer,
broadcaster, subgraph endpoint, production database/queue, applied external or
value-state migration, executable sweep/top-up, dispute accounting, or
value-moving canary. The checked-in SQL is unapplied shadow-persistence DDL
scaffolding only.

The Council-admitted exact live generation is commit `aa6f802…`; its recovered
storage roots end at 21, so future top-level fields must begin at 22. The
admitted block `44,795,931` public snapshot reconciles `588,000,000` USDC atoms
of custody to liabilities with zero delta, but does not establish bank facts or
authorize a cut. The checked-in subgraph's event topic and `getOrder` tuple do
not match the live target and must not be deployed as-is.

Direct rail rounding, zero-SELL rejection, reservation-safe sweep, and freeze
predicates exist only as pure offline formula/golden-vector scaffolding. They
are not an authoritative ledger, an executable reconciliation/sweep path, or
permission to move value. The service does not invent risk values, bank facts,
FX policy, rail-rounding authority, sweep permission, or reconciliation
identities.

Any value-moving work requires a new Council vote after every reconsideration
gate in the bill is met. Changing booleans or policy fixtures cannot override
this boundary.
