# Coordinated Base Sepolia release checklist

This is an evidence checklist, not deployment authorization. The current implementation keeps the Diamond paused and executor writes `OFF`. No mainnet action is permitted.

## 1. Immutable candidate

- [ ] Record exact reviewed commit for smart contract, subgraph, user UI, merchant UI, admin UI, and executor.
- [ ] Resolve Q-8 with the approved executor GitHub remote and coordinated PR policy.
- [ ] Confirm clean review diffs contain no credential, private settlement value, generated drift, unrelated workspace file, or unreviewed manifest.
- [ ] Freeze canonical protocol package name/version/tarball SHA-256, protocol artifact digest, ABI digests, manifest digest, start block, and subgraph deployment identifier.
- [ ] Confirm production consumers contain no test-fixture literal/export/import or mock/legacy network fallback.

## 2. Decision and authority gates

- [ ] Q-1: replacement owner/admin/updater/assigner/operator/pauser/upgrader/resolver identities, custody, funding, and recovery approved; all identities distinct; exposed/prior identities denylisted.
- [ ] Q-2: HTTPS UI/API domains, exact origins, PostgreSQL/backup/restore, secret store, monitoring, alert delivery, and on-call owners approved.
- [ ] Q-3: named independent price providers and quorum/freshness/deviation/spread values approved.
- [ ] Q-4: merchant/channel/side daily and monthly cap policies approved; zero is not an implicit default.
- [ ] Q-5: order, assignment, accepted-recovery, quote-validity, and related safety durations approved.
- [ ] Q-6: private fields, key owner, access/break-glass, retention, backup expiry, deletion, and incident policy approved.
- [ ] Q-7: independent contract reviewer and enablement approver named; review has no open blocker, major, or minor finding.
- [ ] Q-8: executor publication target and coordinated PR/release policy approved.
- [ ] Managed signer attestations bind chain 84532, exact Diamond, address/reference/role, selector allowlist, zero value, and gas limits; no raw key exists in config/artifacts.

## 3. Clean verification

- [ ] Node 24.18.0/npm 11.16.0 and clean `npm ci` succeed in all six repositories plus the protocol package.
- [ ] Smart `npm run verify`, storage/security/invariant/gas coverage, package check, and local fixture preflight pass.
- [ ] Executor `npm run verify` and real `npm run test:postgres` pass against an isolated PostgreSQL instance, including migration down/up, restart, concurrency, reorg, retention, and one-process boundaries.
- [ ] Subgraph `npm run verify` passes codegen, mappings, Matchstick, manifest/start-block, and generated-artifact checks.
- [ ] User, merchant, and admin `npm run verify` pass lint, unit/render tests, production build, protocol, privacy, and bundle checks.
- [ ] Smart `npm run verify:coordinated` proves exact package/vendor/install/digest parity, no stale tarball, one executor/image/process/pool, mandatory cleanup, privacy, and release-doc gates.
- [ ] Fresh local system E2E passes BUY, SELL, merchant/channel setup, admin review, dispute, cancel/expiry recovery, restart/replay, duplicate/missed event, shallow reorg, and transaction uncertainty without duplicate custody effects.
- [ ] Container engine builds every Dockerfile, or the deterministic Dockerfile/static-context validator passes when no engine is available.
- [ ] Independent frozen-diff review records `GO`; all findings are closed and gates rerun on the reviewed bytes.

## 4. Read-only shared-environment evidence

- [ ] A fresh v2 manifest was produced only by the separately authorized deployment process and independently reviewed.
- [ ] `base-sepolia-preflight.md` passes against chain 84532 and official Base Sepolia USDC; Diamond remains paused.
- [ ] Goldsky build/deploy inputs use the exact canonical ABI, Diamond address, initialization start block, and reviewed deployment name. Endpoint health and `_meta` block/error response are recorded without a deployment token.
- [ ] All three runtime documents contain the same manifest plus exact HTTPS executor/subgraph/RPC URLs and public Thirdweb client ID; unsafe/missing configuration fails closed.
- [ ] One executor starts with all three ceilings/modes `OFF`; liveness/readiness, canonical cursor, Graph lag, database, backups, alerts, and privacy/audit delivery are healthy.

## 5. Shadow and enablement

- [ ] `shadow-mode-and-enablement.md` evidence covers representative BUY/SELL, pricing, matching, recovery, failures, restart/reorg, and confirms zero signing/nonce/broadcast/reservation.
- [ ] Independent reviewer accepts the shadow record against approved Q-3–Q-5 values.
- [ ] Change record names exact module, row version, ceiling, time window, operator, approver, commits/digests, rollback trigger, and incident owner.
- [ ] Backup/restore, `OFF` drain, pause, image rollback, signer rotation, privacy incident, and uncertainty recovery are rehearsed.
- [ ] Only the separately authorized operator may unpause or enable. Enable one module at a time; pricing before matching; recovery separately.

## 6. Post-change watch and rollback

- [ ] Observe canonical/Graph lag, source quorum, simulations, jobs/outbox, promotion scan, signer/nonce/receipt state, invariants, privacy/retention, and alerts for the approved watch window.
- [ ] On any threshold breach, transition affected/all modes to `OFF`, drain the write fence, pause if required, preserve evidence, and follow rollback/recovery.
- [ ] Publish only after Q-8 and coordinated checks. Never claim a URL/address/endpoint as live until independently observed from the reviewed environment.

## Required release record

The record contains approver/reviewer identities, UTC timestamps, all six commit hashes, image digest, protocol package/tarball/artifact/ABI/manifest digests, Diamond address, official USDC address, deployment/initialization blocks and receipts, subgraph identifier/endpoint/start block, runtime document digests, database backup proof, shadow evidence, mode versions, preflight output digest, CI/E2E results, and incident/rollback owners. Secrets and plaintext payment data are excluded.
