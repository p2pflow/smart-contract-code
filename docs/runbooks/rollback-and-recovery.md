# Rollback and recovery

Status: fail-closed incident procedure. Never “fix forward” by replaying an uncertain financial write.

## Immediate containment

1. Record UTC time, current commits/image digest, manifest/protocol digest, chain/Graph heights, affected module/action IDs, and privacy classification.
2. Through the authenticated operator control, transition `PRICING`, `MATCHING`, and `RECOVERY` to `OFF` with exact row versions. Wait for the exclusive write fence to drain.
3. Pause the Diamond only through the separately approved PAUSER authority when contract writes must stop. Do not use an exposed or replacement signer outside its assigned role.
4. Keep the confirmed scanner and evidence collection running if safe. Do not delete journals, cursor history, transaction attempts, audit rows, ciphertext tombstones, or canonical lineage.

## Application/image rollback

- Roll back only to a previously verified image that consumes the same protocol/storage boundary. Re-run coordinated digest and read-only preflight first.
- Drain the single process before replacement. Never overlap two executors or reuse a nonce lane across processes.
- Start the replacement with every startup ceiling `off`. Require liveness, readiness, migration checksum agreement, canonical cursor reconciliation, and operator health before considering shadow.
- A UI rollback must keep its runtime manifest and protocol package compatible. Pending wallet journals remain blocked until exact transaction evidence is reconciled; never clear them by version deployment.

## PostgreSQL rollback

Prefer forward-compatible application rollback with the current schema. A migration downgrade is exceptional and must use the checked-in migration runner.

1. Confirm all durable modes are `OFF`, the exclusive write fence is drained, and the canonical scanner is halted at a recorded cursor/hash.
2. Produce and verify a database backup/export. Set the runner's explicit backup confirmation; never bypass it.
3. Downgrade one reversible migration at a time. Checksum drift, active modes, unrepresentable lineage, or missing backup proof must abort.
4. Note that the CSRF migration clears transient previous-token hashes before downgrade. Ciphertext `DELETED` tombstones remain irreversible and must never be resurrected by rollback/replay.
5. Re-run migration-up, concurrency, restart, retention, reorg, and system tests against a restored copy before returning the incident database to service.

## Chain reorg and scanner recovery

- WSS is only a wake signal. Re-read confirmed blocks over HTTP using the configured 12-block depth and 64-block overlap.
- A shallow mismatch rolls back derived non-terminal jobs, reservations, projections, and receipt effects atomically from the first divergent block, then replays the new canonical lineage.
- A mismatch deeper than the retained overlap is a hard halt: keep writes `OFF`, preserve the database, expand investigation from a verified checkpoint, and require independent review before resuming.
- Duplicate and missed events must converge through canonical event IDs, generations, idempotency keys, and compare-and-swap state. Never edit rows manually to make the cursor advance.

## Transaction uncertainty

- A known hash is recovered only by fetching the exact transaction and receipt, checking sender/target/value/calldata, canonical block/hash, 12 confirmations, expected event, and authoritative postcondition.
- A missing hash cannot be proven by coincidental aggregate state. Block the lane for manual evidence; do not resubmit.
- Use the operator uncertainty endpoint only with a current role, CSRF, idempotency key, and evidence record. `NONCE_TOO_LOW`, provider timeout, or ambiguous send is not an ordinary retry.
- Reverted transactions may release their exact journal only after canonical finality. Successful writes clear journals only after reconciliation and an immediately preceding final receipt recheck.

## Exit criteria

Root cause is documented; affected custody/accounting invariants reconcile; no duplicate reservation/action exists; privacy impact is closed; backups/restores and alerts are green; clean CI/E2E/preflight pass on the chosen image; an independent reviewer approves the evidence. Resume in `SHADOW`, never directly in `ENABLED`.
