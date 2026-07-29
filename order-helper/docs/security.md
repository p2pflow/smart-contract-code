# Order Helper security model

## Current security posture

This service is shadow-first and Base Sepolia-only. Transaction sending is
disabled by default and is **not currently available**.

The target Order Helper contract ABI, selector set, storage provenance, runtime
bytecode, and Base Sepolia deployment have not been recovered and verified.
The checked-in contract history does not contain the target Order Helper
interface. Nothing in this service or its deployment examples claims that the
planned interface is deployed.

The required council bill was not available at the specified path during this
implementation. No PASS scope or binding amendment is assumed. The council
gate remains closed until an auditable PASS record exists and every binding
amendment is implemented and tested.

The current safe use is deterministic simulation, replay, shadow decisions,
and injected-adapter testing. Do not use mainnet or production services.

## Trust boundaries

| Boundary | Trusted for | Not trusted for |
| --- | --- | --- |
| Diamond contract | Final order state and transaction-time eligibility after the verified upgrade | Off-chain availability, fairness computation, or fiat truth |
| Order Helper | Deterministic shadow computation, durable processing, and auditable transaction preparation | Custody, bypassing contract checks, or changing admin/revenue state |
| RPC providers | Transporting reads and a controlled broadcast | Authorization or a single source of chain truth |
| Subgraph/local projection | Broad discovery and historical views | Final eligibility or ownership |
| PostgreSQL/Redis | Durable decisions, cursors, leases, and retry coordination | Alternate order ownership or authorization |
| KMS/HSM/Vault adapter | Signing a narrowly authorized transaction after policy enforcement | Selection policy, nonce selection, or contract administration |
| Operations endpoints | Process and bounded dependency state | Configuration values, endpoint identities, payment data, or key material |

The assigner identity must have only the assignment role and a limited gas
balance. It must never share Diamond owner, platform admin, dispute resolver,
or revenue reconciler privileges.

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

Secret-manager **reference names** are injected at runtime. Secret values are
resolved by their owning adapter and must not enter general configuration
objects or diagnostics.

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

This repository provides interfaces and injected test doubles only. It does
not claim a working KMS, HSM, Vault, workload identity, or cloud integration.

A future signer adapter must:

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

Live sending must fail closed unless all of these are independently evidenced:

1. The council record is PASS and the implemented scope contains every binding
   amendment.
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
evidence by themselves.

## Threats and controls

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

Before a canary, obtain independent reviews of:

- recovered Diamond storage/ABI and upgrade provenance;
- helper key-management and transaction restrictions;
- log/metric data classification and endpoint access;
- nonce/replacement and reorg handling;
- incident containment and key rotation drills;
- all council amendments and canary evidence.
