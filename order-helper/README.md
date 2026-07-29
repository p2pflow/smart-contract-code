# P2PFlow Order Helper

This directory contains a dependency-light, independently testable,
shadow-first TypeScript service for deterministic off-chain order assignment.
It is intentionally separate from the Solidity build.

Current scope:

- fail-closed runtime and risk-policy validation;
- finalized event scanning with durable cursor/reorg abstractions;
- idempotent leased queue and retry/sweeper abstractions;
- candidate and authoritative eligibility types;
- deterministic selection and decision commitments;
- append-only decision/transaction persistence interfaces and SQL migrations;
- nonce ownership, simulation, replacement, and receipt reconciliation;
- structured secret-safe logging and Prometheus health endpoints;
- replay and deterministic simulation CLIs;
- in-memory adapters for tests plus PostgreSQL/Redis/KMS interface contracts.

The default is shadow mode. No concrete KMS, RPC assignment ABI, subgraph, or
production database is claimed. Broadcasting is denied unless an injected
gate authorizes it, and the shipped runtime keeps that gate closed. See
[contract-integration.md](./docs/contract-integration.md) for the evidence gap.

## Local verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run simulate
```

The simulator, replay CLI, shadow processor, and any future canary adapter use
the same selection package. Simulator seed and policy identity are explicit,
so a report can be reproduced byte-for-byte.

## Configuration

Copy names from `.env.example` into the workload's secret/config manager. Do
not commit a populated `.env`. Startup errors name missing variables but never
include their values. Base Sepolia (`84532`) is the only supported chain in
this workstream; mainnet and production sending are intentionally unsupported.

Functional testnet defaults are not financial approval. Missing order bounds,
price deviation, stake, timeout, dispute, policy identity, or safety-buffer
values stop startup.
