# Single-executor operations

Status: production-shaped operating procedure. Initial writes remain `OFF`.

## Supported topology

Run exactly one image built from `p2pflow-executor/Dockerfile`, with exactly one application entrypoint: `node dist/main.js`. That process owns HTTP, confirmed-block scanning, scheduling, jobs, outbox delivery, retention, and transaction reconciliation as internal modules. It owns one PostgreSQL pool with at least 10 connections.

Do not split modules into sidecars, run a second executor replica, or share active signer/nonce lanes between processes. PostgreSQL, ingress, secret management, backups, RPC, WSS wake-up, GraphQL, price sources, and managed signing are deployment infrastructure—not additional P2PFlow executors.

## Configuration preconditions

The Base Sepolia profile requires explicit deployment-owned inputs for:

- reviewed manifest and canonical protocol artifact digest;
- HTTPS RPC, `wss://` new-head wake-up, confirmed scan depth/range/reorg overlap, and GraphQL endpoint/lag ceiling;
- PostgreSQL URL, pool bound, migration directory, worker cadence, and shutdown timeout;
- exact HTTPS UI/API origins, cookie domain/URI, TTL/rate policy, and managed references for session hashing, payment encryption, raw transactions, and cursors;
- two distinct sources for each `USDC/USD` and `USD/INR` leg plus approved quorum, freshness, timeout, deviation, spread, and quote bounds;
- managed workload identity/provider endpoints and attested role-bound signer references when a module is not `off`;
- an explicit denylist containing every prohibited/exposed prior signer identity.

Raw private keys, filesystem keys, long-lived bearer tokens, wildcard credentialed CORS, a local fixture, non-HTTPS shared endpoints, and implicit defaults for Q-1–Q-7 are rejected.

## Start and observe

1. Confirm a current backup and restore rehearsal, then run migrations once under the advisory-locked migration runner.
2. Start one image with all three startup ceilings set to `off`.
3. Require `GET /health/live` to return 200. This proves only process liveness.
4. Require `GET /health/ready` to return 200 with every write mode `off`. A 503 reason is a stop condition.
5. Through an authenticated OPERATOR session, review `/v1/admin/operations/health`, scanner cursor/hash, Graph indexed height/errors, queue age/depth, outbox state, price-source quorum, database pool, signer attestation status, and audit delivery.
6. Confirm the public UIs load the same manifest digest and still disable writes while their configuration is absent or unsafe.

## Routine controls

- Keep alerts on readiness, scanner lag/reorg, Graph lag/errors, price quorum/deviation, job/outbox age, transaction uncertainty, nonce lane, managed-credential refresh, PostgreSQL saturation, backup age, and retention failures.
- Use the admin API/UI for mode changes and uncertainty resolution. Every mutation requires a current wallet-bound role, Origin/CSRF checks, an idempotency key, and exact optimistic version.
- Treat WSS as a wake hint only. The persisted HTTP confirmed-range scanner and canonical block hashes are authoritative.
- Drain with `SIGTERM`; require HTTP drain, worker completion, pool close, and process exit within the configured shutdown limit before replacing the image.
- Never infer readiness from successful matching or a UI page. Use health and canonical evidence.

## Stop conditions

Transition all durable module modes to `OFF` and stop promotion on any deep reorg, manifest/code/selector/role drift, token mismatch, independent source loss, signer attestation failure, nonce uncertainty, privacy incident, unresolved transaction, backup/retention failure, or loss of canonical/Graph agreement. The `OFF` transition takes the exclusive write fence and must complete before shutdown, rollback, or signer rotation.
