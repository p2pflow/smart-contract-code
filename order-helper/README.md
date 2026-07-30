# P2PFlow Order Helper

This directory contains a dependency-light, independently testable,
shadow-only TypeScript service for deterministic off-chain order assignment.
It is intentionally separate from the Solidity build.

The 2026-07-29 Council vote was unanimous 5–0 **REJECT** (bill SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`).
Only transaction-disabled, non-authorizing shadow work is in scope.

Current scope:

- fail-closed runtime and risk-policy validation;
- finalized event scanning with durable cursor/reorg abstractions;
- idempotent leased queue and retry/sweeper abstractions;
- candidate and authoritative eligibility types;
- deterministic selection, derived policy commitments, and content-addressed
  replay witnesses;
- append-only shadow decision and offline transaction-state interfaces plus
  unapplied SQL DDL scaffolding;
- in-memory nonce ownership, replacement, and receipt-reconciliation models;
- structured secret-safe logging and Prometheus health endpoints;
- replay and deterministic simulation CLIs;
- in-memory test adapters plus PostgreSQL/Redis contracts and an inactive
  future KMS type.

Shadow is the only accepted mode. No concrete KMS, RPC assignment ABI,
subgraph, or production database is claimed. The shipped runtime has no signer
or broadcaster dependency and rejects every live/send/verified/canary setting.
A later value-moving implementation would require all ordered reconsideration
gates and a new Council PASS; no injected gate or boolean can upgrade this
build. See [council-compliance.md](./docs/council-compliance.md) and
[contract-integration.md](./docs/contract-integration.md).

## Local verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run simulate
npm run replay:fixture > /tmp/order-helper-replay.json
npm run replay -- --input /tmp/order-helper-replay.json
```

The simulator, replay CLI, and shadow processor use the same selection package.
Simulator seed and policy identity are explicit, so a report can be reproduced
byte-for-byte. Generated fixtures and traces are synthetic, unapproved,
non-authorizing offline evidence. No canary adapter exists.

Final-rerun requirements are recorded in [verification.md](./docs/verification.md).
Selection invariants and fairness methodology are in
[fairness.md](./docs/fairness.md); pure accounting-vector scope is in
[accounting-invariants.md](./docs/accounting-invariants.md).

## Configuration

Copy names from `.env.example` into the workload's secret/config manager. Do
not commit a populated `.env`. Startup errors name missing variables but never
include their values. Base Sepolia (`84532`) is the only supported chain in
this workstream; mainnet and production sending are intentionally unsupported.

The example is deliberately non-startable: its Diamond and policy hashes are
zero and required risk values are absent. Fixture values are not financial
approval. Missing order bounds, price deviation, stake, timeout, dispute,
policy identity, or safety-buffer values stop startup.

The checked-in Kubernetes scaffold denies all egress because the shipped
runtime wires no external adapter. Its Docker build context includes only
package metadata, TypeScript configuration, build scripts, and source; neither
artifact enables a transaction or outbound dependency path.
