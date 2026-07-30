# Order Helper security model

## Current security posture

This service is shadow-only and Base Sepolia-only. Transaction sending is
invalid configuration and is **not available** under the binding Council
disposition.

An external report says the legacy baseline at block `44,795,919` was reproduced
from historical commit `aa6f802…`, including all six facet runtimes and 63
routed selectors. That baseline has no Order Helper facet, exact-four write
selector, round/policy commitment, authoritative helper eligibility view, or
signer-rotation interface. Nothing here claims that the planned interface is
deployed.

The Council bill adopted 2026-07-29 is a unanimous **REJECT**, SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`.
It permits only non-signing, transaction-disabled reconstruction, simulation,
replay, invariant scaffolding, and non-authorizing shadow output. See
`council-compliance.md`.

The current safe use is deterministic simulation, replay, shadow decisions,
and injected-adapter testing. Do not use mainnet or production services.

## Trust boundaries

| Boundary | Trusted for | Not trusted for |
| --- | --- | --- |
| Future verified helper interface on the Diamond | Final order state and transaction-time eligibility only after a separately reviewed upgrade | Off-chain availability, fairness computation, fiat truth, or current deployment evidence |
| Order Helper | Deterministic shadow computation and non-authorizing transaction-state evidence | Custody, signing, broadcasting, bypassing contract checks, or changing admin/revenue state |
| RPC providers | Transporting pinned read-only observations | Authorization, broadcasting, or a single source of chain truth |
| Subgraph/local projection | Broad discovery and historical views | Final eligibility or ownership |
| Future injected PostgreSQL/Redis adapters | Durable decisions, cursors, leases, and retry coordination after implementation | Alternate order ownership, authorization, or a capability supplied by this package |
| Future KMS/HSM/Vault boundary | Interface design only; no adapter or key reference is accepted now | Any signing, key use, selection policy, nonce selection, or administration |
| Operations endpoints | Process and bounded dependency state | Configuration values, endpoint identities, payment data, or key material |

A future assigner identity would require a new Council authorization and must
never share Diamond owner, platform admin, dispute resolver, or revenue
reconciler privileges.

## Protected data

Never put the following in source, images, manifests, logs, metrics, decision
ledgers, test fixtures, or support tickets:

- private keys, mnemonic phrases, raw signed transactions, bearer tokens,
  cookies, passwords, API keys, database/Redis credentials, or KMS credentials;
- full RPC, subgraph, database, Redis, or KMS endpoints when they contain
  tenant paths, query parameters, credentials, or private hostnames;
- bank account, UPI/VPA, beneficiary, phone, email, Telegram, or other payment
  and personal identifiers;
- plaintext bank reconciliation records or payment evidence.

Decision records may contain the minimum public chain identifiers needed for
replay. Metrics must never use order IDs, merchant addresses, channel IDs,
transaction hashes, endpoint strings, or error messages as labels.

Authoritative adapter prose is discarded before selection evidence is
canonicalized. Exclusions retain only fixed eligibility codes and bounded
numeric/block facts. Decision-state events accept only opaque 32-byte
identifiers and fixed reason codes; there is no arbitrary metadata column or
free-form detail field in the shadow ledger schema.

Secret-manager **reference names** may be supplied in configuration, but the
shipped runtime resolves none. A future owning adapter must keep secret values
out of general configuration objects and diagnostics.

## Logging and diagnostics

`src/operations/logger.ts` emits one JSON object per line. All caller fields
are placed under `data`; callers cannot replace the timestamp, level, service,
or event fields.

`src/operations/redaction.ts`:

- recursively redacts recognized secret and PII field names;
- summarizes endpoints as transport and network class, omitting host, port,
  path, query, fragment content, and credentials;
- removes common authorization, credential-query, email, and private-key
  patterns from free text;
- omits binary and map contents;
- bounds string, array, and object depth;
- handles errors and circular objects without serializing raw objects.

Redaction is defense in depth, not permission to log secrets. An opaque secret
placed in an unlabelled free-text field might not be recognizable. Code should
log stable event and error categories, never raw configuration, request
headers, transaction payloads, provider response bodies, or caught error
objects from third-party SDKs without first mapping them to an approved shape.

The Prometheus registry enforces declared label sets and sanitizes obvious
endpoint, authorization, email, long, and 32-byte hex values. Metric labels
must remain bounded enumerations such as mode, provider class, operation, and
outcome.

`/healthz` and `/readyz` expose only lifecycle, shadow/live mode, send-gate
state, bounded check names/codes, and latency. `/metrics` exposes only
registered numeric series. These endpoints should be reachable only from the
cluster health system and monitoring namespace.

## KMS/HSM boundary

This repository has only an inactive future KMS type. It provides no KMS test
double, key reference, adapter, HSM, Vault, workload identity, or cloud
integration.

Only after a new Council PASS and a separate reviewed implementation, a future
signer adapter would have to:

1. return the configured public assigner address without exporting key
   material;
2. accept only a typed, unsigned assignment request for the verified chain,
   Diamond, selector, decision ID, expected round, state block, and deadline;
3. verify the workload identity and approved environment before signing;
4. reject admin, upgrade, dispute, transfer, approval, arbitrary-call, and
   mainnet requests;
5. return only the signature or signed transaction required by the nonce
   manager;
6. support denial, disable, rotation, and audit-event testing through an
   injected adapter.

Primary and cold-standby keys must be separate. Rotation is a controlled
`propose -> accept -> verify -> revoke old` process after the target contract
implements and verifies that flow. Never copy a private key between key
systems.

## Live transaction gate

No environment values can enable this build. A distinct later implementation
must fail closed unless all of these are independently evidenced:

1. A new Council vote supersedes the current REJECT with PASS and the
   implemented scope contains every binding amendment.
2. The exact target source, storage layout, ABI, selector manifest, runtime
   bytecode, chain ID, and Base Sepolia address are independently verified.
3. The Order Helper facet is deployed and verified on Base Sepolia, and
   transaction-time contract eligibility is confirmed against the same ABI.
4. Required financial/risk configuration has signed approval and no value is
   missing, zero, stale, or a placeholder.
5. Shadow/replay comparison, failure drills, fairness tests, and authoritative
   eligibility differential tests meet the approved canary thresholds.
6. The dedicated KMS/HSM workload identity, least-privilege assigner role,
   balance limits, alerting, pause, revoke, and rotation procedures are tested.
7. An explicit, time-bounded canary approval is recorded.
8. `HELPER_MODE`, `ENABLE_TRANSACTION_SENDING`, and every independent send gate
   are enabled for Base Sepolia only.

One false or unknown condition closes the gate. Configuration booleans are not
evidence by themselves, and even complete evidence cannot toggle this build
live.

## Future required controls and current gaps

This table states requirements; it does not claim the controls are deployed.

| Threat or failure | Required control |
| --- | --- |
| Stolen assigner key | Low privilege, gas-only balance, workload identity, selector restriction, pause/revoke/rotate, chain-side eligibility |
| Malicious or biased helper | Canonical decisions, append-only ledger, deterministic replay, policy/build identity, fairness monitoring, signer revocation |
| Stale or compromised subgraph | Discovery only; pinned RPC snapshot and transaction-time contract validation |
| RPC equivocation/outage | Independent providers, finalized block-hash comparison, circuit breaker, one nonce owner, no blind dual broadcast |
| Replay or duplicate job | Durable idempotency key, expected round, validity deadline, decision identity, receipt reconciliation |
| Reorg/restart | Finalized scanner, durable cursor, block hashes, rewind/reconcile, provisional decisions before finality |
| Nonce gap/replacement race | Serialized nonce lease, pending-state reconciliation, same semantic transaction for replacement, no send to two providers blindly |
| Secret or PII disclosure | Structured allowlisted fields, recursive redaction, endpoint summaries, bounded metric labels, restricted diagnostics |
| KMS denial | Stop sends, keep shadow processing, alert, use approved standby rotation only |
| KMS compromise | Contain workload, pause/revoke assigner, preserve audit records, reconcile nonces/receipts, rotate only after review |
| Missing risk/config value | Startup validation and readiness failure; never substitute defaults for financial approval |
| Unverified contract/deployment | Shadow-only; send gate closed |

## Review requirements

The Council bill's complete ordered 14 gates and a new no-critical-objection
vote control. This non-exhaustive review subset cannot authorize a canary:

- recovered Diamond storage/ABI and upgrade provenance;
- helper key-management and transaction restrictions;
- log/metric data classification and endpoint access;
- nonce/replacement and reorg handling;
- incident containment and key rotation drills;
- all council amendments and canary evidence.
