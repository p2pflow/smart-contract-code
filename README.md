# P2PFlow v2 smart contract

This repository is the canonical source for the P2PFlow v2 EIP-2535 Diamond, its generated protocol package, deterministic local verification, and read-only Base Sepolia preflight. It does not contain an enabled deployment command. `npm run deploy` and `npm run upgrade` deliberately fail.

## Protocol boundary

The Diamond composes access control, configuration, merchant, pricing, assignment, order, dispute, loupe, ownership, and upgrade facets over namespaced `AppStorage`. Custody uses six-decimal USDC accounting. BUY orders reserve merchant liquidity; SELL orders escrow user USDC. The contract enforces status transitions, quote freshness and user price bounds, bounded assignment candidates, exact reservation release, role separation, pause controls, and terminal-state idempotency.

`packages/protocol` is the only consumer boundary for ABIs, constants, status values, errors, deployment-manifest validation, call factories, receipt decoding, and protocol digests. Its explicit test-fixture subpath is not imported by production consumers. `scripts/vendor-protocol.mjs` reproducibly distributes one packed artifact to the subgraph, executor, and three UIs.

## Verification

Use Node 24.18.0 and npm 11.16.0.

```sh
npm --prefix packages/protocol ci --no-audit --no-fund
npm ci --no-audit --no-fund
npm run verify
```

The full gate compiles Solidity 0.8.24, checks generated artifacts, runs contract, invariant, storage-layout, gas, recovery, and package tests, verifies the local fail-closed fixture, and checks the reproducible package. From the six-repository workspace, run:

```sh
npm run verify:workspace
npm run verify:coordinated
npm run test:system
```

The system test creates a fresh local v2 Diamond and uses local test infrastructure only. Test mocks and the local fixture are intentionally retained but are forbidden in a shared runtime.

## Base Sepolia release boundary

The sole real-network command is read-only:

```sh
BASE_SEPOLIA_RPC_URL=https://reviewed-rpc.example \
  npm run preflight:base-sepolia -- --manifest /reviewed/base-sepolia-v2.json
```

It requires chain 84532, official Base Sepolia USDC, exact deployment and initialization receipts, bytecode hashes, facet selectors, protocol/storage identity, mutually distinct role holders, and a freshly paused Diamond. It never reads a local environment file and never signs or broadcasts.

Before any separately authorized deployment or enablement, every Q-1–Q-8 decision, a replacement signer set, independent contract review, reviewed shadow evidence, and explicit operator approval must be recorded. See `docs/runbooks/` and `docs/release/coordinated-base-sepolia-checklist.md`.

## Key paths

- `contracts/` — Diamond, facets, shared storage, libraries, v2 initializer, and test-only mocks.
- `packages/protocol/` — canonical generated consumer package and explicit test fixture.
- `scripts/preflight-v2.mjs` — fail-closed read-only deployment verification.
- `test/` — contract, invariant, gas, compatibility, and local system coverage.
- `docs/architecture/` — as-built system overview and user-facing guide.
- `docs/runbooks/` — operator, recovery, privacy, and signer procedures.

Never commit credentials, private settlement data, deployment secrets, or a real manifest containing unreviewed authority decisions.
