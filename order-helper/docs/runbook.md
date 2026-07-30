# Order Helper operations runbook

## Read this first

Current state:

- Shadow mode is the default and only approved operating posture.
- Live transaction sending is rejected at configuration and unavailable.
- An external report reproduced and pinned the legacy Diamond baseline, but no
  Order Helper facet/interface is deployed or verified by this package.
- The Council bill adopted 2026-07-29 is unanimous REJECT. It authorizes only
  transaction-disabled, non-signing, read-only/offline shadow work.
- No mainnet or production endpoint, account, key, database, queue, subgraph,
  or deployment is provided or implied.

The Docker/Kubernetes files are examples. Shipped `main.ts` always uses
`UnconfiguredShadowComponents`: it starts health endpoints, keeps `/readyz` at
503, and runs no scanner, queue, or processor. No environment injection makes
this image operational. A separately built read-only integration would have to
wire those adapters in code. No signer adapter or key reference may be injected
under the current disposition.

## Service states

| State | `/healthz` | `/readyz` | Meaning |
| --- | --- | --- | --- |
| Starting | 503 | 503 | Process exists but initialization is incomplete |
| Future integrated shadow ready | 200 | 200 | Separately implemented read-only dependencies are usable; sending remains impossible |
| Future integrated shadow degraded | 200 | 200 | Optional dependency degraded; authoritative shadow path still works |
| Required dependency failed | 200 | 503 | Process is alive but must not receive work |
| Live configuration | N/A | N/A | Startup rejects it before any dependency or worker starts |
| Stopping | 503 | 503 | Drain is in progress |

`/metrics` uses Prometheus text format. Restrict all three endpoints to health
and monitoring callers. They intentionally contain no configuration or secret
values.

## Future read-only integration startup

These steps apply only to a separately built read-only integration. They do not
describe capabilities of the shipped entrypoint.

1. Confirm the environment is an isolated Base Sepolia test environment.
2. Confirm transaction sending is false and helper mode is shadow.
3. Inject reviewed configuration by name. Never print values or run commands
   that dump the process environment.
4. Wire reviewed read-only adapters for scanner, projection, authoritative RPC
   reads, decision ledger, and queue into distinct code.
5. Do not add a signing adapter.
6. Start that integration and wait for `/healthz` to pass.
7. Check `/readyz`; a failing required check is a hard stop. Use its stable code
   to select the procedure below.
8. Confirm `/metrics` is scrapeable only from the approved monitoring path.
9. Verify the scanner cursor advances at finalized blocks and decisions are
   recorded as shadow decisions with no transaction attempt.

Never use `.env` inspection as a diagnostic step. The checked-in
`.env.example` contains names and deliberately invalid examples only.

## Future custom-integration readiness checks

These checks are design guidance, not shipped integrations. A future read-only
integration should expose stable names and bounded codes:

- `database`: migrations current and a read/write lease probe succeeds;
- `queue`: idempotency store and lease ownership are usable;
- `scanner`: durable finalized cursor is within the approved lag;
- `rpc_primary` and `rpc_fallback`: chain ID and finalized block hash are
  consistent within policy;
- `projection`: broad discovery is available or the tested local fallback is
  complete;
- `decision_ledger`: append/read verification succeeds;
- `policy_identity`: reviewed policy/build identity is loaded;
- `contract_interface`: disabled/failing; later verification is necessary but
  cannot enable this build;
- `signer`: prohibited in this build; later value-moving code requires all 14
  ordered gates and a new Council PASS.

Checks return codes, not raw provider errors or endpoints.

## Future custom-integration metrics

The current runtime registers only process-up and transaction-sending-disabled
gauges. The following are design requirements for a separately implemented
read-only integration, using low-cardinality labels only:

- scanner finalized height and lag;
- queue ready/delayed/leased depth;
- jobs and decisions by bounded outcome/reason category;
- RPC calls by provider class, method class, and outcome;
- dependency latency histograms;
- decision/receipt/reorg/retry totals;
- nonce lease age and pending-attempt count;
- readiness and send-gate state;
- last successful scan, decision, and reconciliation timestamps.

Never label by order, merchant, channel, transaction, decision, address, block
hash, endpoint, error message, tenant, or payment identifier. Put replayable
public identifiers in the access-controlled decision ledger.

## RPC outage or disagreement

1. Close transaction sending and keep it closed.
2. Mark the affected provider unhealthy and stop selecting it for new pinned
   snapshots.
3. Compare chain ID, finalized height, and finalized block hash through the
   independently operated fallback.
4. If providers disagree beyond the approved tolerance, fail readiness and
   stop new decisions. Do not choose one by convenience.
5. Continue finalized scanning only after a single canonical checkpoint is
   established.
6. Reconcile each pending transaction by nonce, hash, receipt block hash, and
   canonical block membership before doing further nonce work.
7. Record provider class, timing, and error category only.
8. Resume shadow decisions after cursor and block-hash reconciliation. Any
   future live design requires distinct code, all gates, and a new PASS.

Never broadcast the same nonce blindly to multiple providers.

## Subgraph outage or lag

1. Treat the subgraph as discovery-only; do not weaken authoritative checks.
2. Use the tested local event projection or bounded on-chain discovery
   fallback if it is complete at the pinned block.
3. If broad discovery cannot be proven complete enough for the required
   decision, record a bounded unavailable reason and retry later.
4. Keep existing user orders cancellable through the contract/UI path.
5. Alert on lag and exclusion totals without logging query bodies or endpoint
   details.
6. Backfill from the durable finalized cursor after recovery, then compare
   sampled projection state to RPC views.

Do not treat a cached subgraph row as authorization.

## Database, queue, or lease failure

1. Fail readiness and stop accepting new jobs.
2. Do not replace durable uniqueness with an in-process flag.
3. Determine whether a job lease expired, was released, or remains owned using
   the store's monotonic timestamps and fencing token.
4. Reconcile the decision ledger and chain state before redelivery.
5. On recovery, allow duplicate delivery; uniqueness and expected-round checks
   must make it harmless.
6. Verify queue depth, oldest job age, cursor, and decision/attempt counts
   without printing payloads or connection strings.

## Reorg and restart

1. Mark decisions and receipts above the finalized checkpoint provisional.
2. On block-hash mismatch, stop new decisions and rewind the scanner cursor to
   the last matching finalized checkpoint.
3. Replay canonical logs into idempotent handlers.
4. Mark orphaned decisions/attempts without deleting the audit trail.
5. For each open order, reread the authoritative order and expected round.
6. Requeue only when the order remains open and the idempotency key is not
   durably completed.
7. Reconcile virtual/fairness state from accepted canonical events; do not
   commit provisional offers as accepted volume.
8. Resume shadow mode first and compare replay output before considering a
   canary.

Restart procedure:

1. Close readiness and drain current handlers.
2. Persist cursor, lease, decision, and attempt state.
3. Stop the HTTP server after the worker drain.
4. Start with sending disabled.
5. Reconcile the durable cursor and every pending attempt before claiming
   readiness.

## Nonce and replacement incident

This repository models nonce and transaction behavior through interfaces and
unsigned/hash/receipt fixtures. It has no signer or broadcaster implementation.

Only in distinct code after all ordered gates and a new Council PASS, once a
verified broadcaster exists:

1. One fenced nonce owner serializes assignment writes for the signer.
2. Before allocating a nonce, reconcile confirmed, pending, replaced, dropped,
   and externally consumed nonces.
3. Persist the unsigned semantic request and every attempt before broadcast.
4. A fee replacement must use the same nonce and same still-valid semantic
   decision. It must not silently change candidates, round, state block,
   deadline, policy identity, chain, Diamond, or selector.
5. If the decision is stale or the order/round changed, do not replace it.
   Resolve the nonce state, record the terminal reason, and compute a fresh
   decision only if the order remains open.
6. Never infer success from a submitted hash. Require a canonical receipt and
   the expected event.
7. Never send two different semantic transactions with one nonce.

Current tests use unsigned requests, derived-hash evidence, and receipt
fixtures only. They include no signer/broadcaster and produce no network
write.

## Future-only KMS/HSM unavailable

Tabletop design only: the current build has no KMS reference, adapter, key, or
signer check. This procedure requires distinct code and a new Council PASS.

1. Keep or return the service to shadow mode.
2. Fail the signer readiness check; do not load a file/CI/browser key as a
   workaround.
3. Confirm the denial is identity/policy/service related using KMS audit
   metadata, not by exporting or printing key data.
4. If recovery exceeds the approved window, begin the cold-standby rotation
   procedure after operator review.
5. Reconcile nonce and pending-attempt state before using a new signer.

## Future-only suspected key or workload compromise

Tabletop design only: the current build has no helper key, assigner role, KMS
workload, or deployed helper facet.

1. Contain the workload and prevent further signing/broadcast.
2. Pause helper-managed assignment through the separately secured authorized
   path if the verified contract supports it.
3. Revoke the assigner on-chain through the verified role procedure.
4. Disable the compromised workload identity/KMS authorization.
5. Preserve decision, KMS audit, nonce, transaction, receipt, deployment, and
   access logs. Do not delete or rewrite history.
6. Reconcile every nonce and assignment event from the last known-good point.
7. Determine whether contract-side eligibility rejected unauthorized work and
   whether accepted orders need normal resolution.
8. Prepare a distinct standby key. Propose, accept, verify address/role, and
   revoke the old key; never copy private material.
9. Resume shadow mode only after containment review. A live canary requires
   fresh approval and all gates.

Any future helper key must not authorize upgrades, admin changes, disputes,
revenue actions, custody transfers, or arbitrary calls.

## Future-only incident containment priorities

1. Stop new writes.
2. Preserve user cancellation/refund and accepted-order resolution paths.
3. Pause/revoke rather than attempting destructive database or chain rollback.
4. Preserve immutable evidence.
5. Reconcile canonical chain state and off-chain ledgers.
6. Restore shadow processing.
7. Reauthorize a time-bounded canary only after review.

Do not rerun an initializer, reset a nonce ledger, delete decision history, or
zero mappings as a rollback technique.

## Future-only key rotation and revocation tabletop

No signer test doubles are shipped. Current tests cover only nonce/receipt
state. A later authorized implementation must build this tabletop explicitly.

1. A future harness injects primary/standby public identifiers only.
2. Stop job intake and reconcile pending attempts.
3. Simulate proposal of standby, acceptance by standby, address verification,
   and revocation of primary.
4. Verify an old-signer request is rejected and a standby request remains
   blocked by the transaction send gate.
5. Verify logs and metrics contain categories only, not signer references,
   transaction payloads, or endpoints.
6. Record drill time, build identity, test results, reviewer, and remediation.

## Canary gates

The bill's complete ordered 14 gates and a new no-critical-objection vote are
mandatory. This checklist is non-exhaustive, cannot authorize a canary, and
cannot toggle this build live even if every item is complete.

A distinct later implementation must include at least:

- a new Council PASS superseding the unanimous REJECT, with implementation and
  tests for all binding amendments;
- exact deployed source/storage provenance and independent review;
- verified Base Sepolia ABI, selectors, bytecode, address, and start block;
- verified assignment/revoke/pause behavior and chain-side eligibility;
- signed financial/risk configuration with no placeholders;
- deterministic replay and shadow/on-chain differential agreement;
- required simulation volume and approved fairness results;
- successful RPC/subgraph outage, restart, reorg, duplicate, lease, signer
  denial, rotation, nonce replacement, and incident containment drills;
- least-privilege KMS/HSM workload identity and signer balance limits;
- dashboards/alerts and user cancellation/refund validation;
- explicit time-bounded canary approval.

No configuration gate exists in this build. Future code may expose gates only
after the evidence and new PASS exist; a true boolean must never manufacture
evidence.

## Deployment and rollback

Use an immutable image digest, non-root/read-only filesystem, dropped Linux
capabilities, disabled service-account token mounting, restricted monitoring
ingress, and the checked-in deny-all egress policy for this exact no-adapter
scaffold. A future reviewed read-only integration needs a narrowly scoped
environment-specific replacement. Kubernetes Secret and ConfigMap objects are
supplied outside this repository; manifests reference names and keys only.

No previous operational helper image or on-chain helper write exists today. In
a future authorized deployment, rollback means deploy the previous reviewed
image in shadow mode and replay from a durable canonical checkpoint. It never
means reversing chain storage or deleting decisions; any on-chain write needs a
reviewed forward fix after fork verification.

## Evidence to attach to an incident or drill

- UTC start/end and responders;
- helper build and policy identity;
- last matching finalized block/cursor;
- bounded dependency status/error codes;
- affected job/decision/attempt counts;
- canonical transaction and event references in the secured ledger;
- containment, reconciliation, recovery, and reviewer decisions;
- confirmation that no secret/PII values entered the evidence.
