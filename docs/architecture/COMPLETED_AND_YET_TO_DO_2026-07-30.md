# P2PFlow — Completed and Yet To Do

Date: 2026-07-30

Branch policy: `codex` only

Implementation head before this handoff: `ae77313d779e5f6862699c0cb2a57ef82f827147`

## Executive status

The overnight session completed the approved research, safety hardening,
transaction-disabled helper, provisional subgraph, and read-only UI work. It
did **not** complete the full architecture plan.

The mechanism council voted **REJECT, 5–0** on the exact bill whose SHA-256 is:

`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`

That decision authorizes offline calculation, read-only UI/indexing work, and
transaction-disabled scaffolding only. It prohibits private-key use, signing,
broadcasting, mock-USDC funding, faucet mutation, Diamond cuts, migration,
subgraph deployment, and every other value-moving action.

Consequently, the session is complete as a bounded implementation and audit
run, while the architecture plan remains partial and gated.

## Completed in this session

### 1. Research and provenance

- Correlated the historical deployed source with commit `aa6f802…`.
- Verified six facets, 63 selectors, Solidity 0.8.24, optimizer 200, Paris EVM,
  and legacy storage roots 0–21.
- Reconciled the pinned custody snapshot to 588 USDC of custody and 588 USDC
  of recorded liabilities at that snapshot.
- Produced deterministic fairness and accounting simulations, golden vectors,
  counterexamples, and public P2P.me evidence boundaries.
- Distinguished public P2P.me behavior from its private, unverifiable merchant
  ranking logic.

### 2. Independent council

- Convened five formal seats across fairness, mechanism criticism,
  Solidity/storage, accounting, and reliability/Sybil/privacy.
- Recorded proposals, objections, amendments, cross-examination, and separate
  ballots.
- Reached a unanimous 5–0 `REJECT` decision for value-moving use.
- Compiled the rejection into contract scripts and all three UIs so public
  environment flags cannot reopen write paths.

### 3. Contract safety and verification

- Added deployed-source, selector, storage, and regression evidence.
- Preserved legacy behavior fixes and the 187-scenario stress suite.
- Gated deployment, mock-token deployment, upgrade, smoke, and mutation scripts
  before signer, RPC, or environment access.
- Pinned the local Hardhat simulation boundary and removed remote/private-key
  wiring from normal validation.
- Quarantined historical live-deployment instructions.
- Final recorded checks:

  - full Hardhat suite: 115 passing;
  - focused council gate: 8 passing;
  - owned local stress run: 187/187 passing;
  - deploy, mock-USDC deploy, and upgrade commands: expected fail-closed.

### 4. Transaction-disabled order helper

- Integrated deterministic exact-four selection, canonical decision envelopes,
  fail-closed eligibility, progressive leases, finalized/reorg-aware scanning,
  replay controls, and a blocked transaction manager.
- Froze the normalized helper source digest:

  `51e6e5b52e512b7eaf3c101e7a8ad213009a748d96922d4295a22354e5d80358`

- Passed 120/120 tests, including two sequential 100,000-order runs with a
  deep comparison of complete reports.
- Recorded deterministic trace root:

  `0x2c0084f9067cff38c92bddeabc41a988864fdfe85e3e34e2435fdac11f4b26eb`

- The helper remains explicitly transaction-disabled and is not a production
  assignment service.

### 5. User, merchant, and admin UIs

- Reworked all three clients around the canonical Base Sepolia target.
- Added app-owned email/OTP wallet entry surfaces and removed general-purpose
  wallet-management, send/receive, key-export, funding, and full-address copy
  affordances.
- Compiled the council rejection into every write precondition.
- Added exact public build-time allowlists, CSP generation, source-map
  rejection, asset credential scans, and hardened production containers.
- Added read-only lifecycle, merchant ranking/lease, fairness, accounting, and
  operations views.
- Final recorded checks:

  - user UI: 43/43 tests plus typecheck, lint, build, and asset scan;
  - merchant UI: 68/68 tests plus lint, build, and asset scan;
  - admin UI: 27/27 tests plus lint, build, and asset scan.

### 6. Subgraph scaffolding

- Kept the default manifest legacy-only.
- Isolated v2 entities and handlers in a clearly provisional, non-deployable
  manifest.
- Added duplicate/range/ownership/status/accounting guards and release gates.
- Passed legacy and provisional tests, code generation, builds, syntax, and
  negative deployment/authentication/prepare gates.
- No subgraph was deployed.

### 7. Browser/runtime preparation

- Prepared exact source archives for the three pushed UI commits.
- Installed Playwright 1.62.0 and Chromium Headless Shell
  151.0.7922.34/revision 1234 in an isolated temporary cache.
- Installed the required local Chromium runtime libraries.
- Defined a strict public-only UI environment allowlist without displaying
  values.
- Built two offline harness generations and subjected them to adversarial
  review.
- Stage A passed 204 offline tests and 28 syntax checks but was rejected for
  live use.
- Stage B expanded to 63 tests and remained structurally non-launchable. The
  user-requested session close interrupted an in-progress CORS/header refactor;
  its final measured state is:

  - all source and test files parse;
  - offline non-launchability/tree scan passes;
  - 50/63 unit tests pass and 13 fail;
  - no remediation candidate, controller resolution, final candidate, browser
    run, mailbox, OTP, wallet address, or live artifact exists.

## Plan phase status

| Plan phase | Status | Meaning |
| --- | --- | --- |
| Phase 0 — provenance and exit gates | Partial | Strong source/custody evidence exists; bank reconciliation, fairness, regression, and approval gates are not all closed. |
| Phase 1 — reconstruction and freeze | Blocked | Channel/bank reconstruction, freeze, target calculation, and import did not occur. |
| Phase 2 — on-chain v2 foundations | Not started / blocked | Required v2 facets, storage, roles, rounds, leases, principal accounting, and limits are absent. |
| Phase 3 — helper | Partial | Deterministic offline helper exists; production adapters, live shadow evidence, and transaction authority do not. |
| Phase 4 — subgraph and UIs | Partial | Provisional/read-only implementations exist; deployment, backfill, live browser E2E, and writes do not. |
| Phase 5 — migration and canary | Blocked | Council rejection and incomplete prerequisite phases prohibit it. |
| Phase 6 — rollout | Not started / blocked | No production rollout, SLA, monitoring, or rollback evidence exists. |

The plan definition of done therefore has zero fully satisfied end-to-end
outcomes. Offline provenance, deterministic helper calculation, and read-only
client/indexer behavior provide partial evidence only.

## Yet to do, in mandatory order

### Gate 1 — close Phase 0 and Phase 1 evidence

1. Reconcile bank-side evidence and every channel liability.
2. Complete historical reconstruction, freeze evidence, target calculations,
   and import vectors.
3. Resolve the subgraph ABI/event discrepancy and establish stable finalized
   cutover evidence.
4. Resolve fairness regressions, concurrent-order behavior, capacity weighting,
   and operator/wallet Sybil resistance.
5. Bind signed reviewer identities and immutable release inputs.

### Gate 2 — obtain a new council decision

1. Draft a new exact bill incorporating the resolved evidence and algorithm.
2. Repeat independent mechanism, accounting, storage, reliability, privacy, and
   migration review.
3. Require an explicit unanimous or policy-required `PASS` before implementing
   or enabling any value-moving path.

The existing rejected bill cannot be reinterpreted as approval.

### Gate 3 — implement and verify on-chain v2

1. Add the planned v2 Diamond storage roots without altering roots 0–21.
2. Implement assignment, revenue/principal accounting, rounds, leases,
   availability, reservations, limits, and reconciliation facets/libraries.
3. Enforce exactly four helper assignments and all plan invariants on-chain.
4. Add migration/unstake/reservation/dispute safety and property/fuzz tests.
5. Repeat selector, storage-layout, custody, solvency, and upgrade review.

### Gate 4 — productionize the helper

1. Add reviewed production RPC, database, Redis, KMS, queue, and observability
   adapters.
2. Run non-signing shadow cohorts against finalized data.
3. Prove replay, failover, nonce, reorg, queue, latency, fairness, and SLA
   behavior at production scale.
4. Keep transaction authority disabled until the new council bill passes.

### Gate 5 — finalize and deploy indexing

1. Generate the final ABI from the reviewed deployed cut.
2. Bind initializer calldata, pre-cut selector state, block hash, confirmation
   depth, source commit, and reviewer attestation.
3. Run production-equivalent mapping, Graph Store, pagination, backfill, and
   rebuild-parity tests.
4. Deploy only after the new council and release gates pass.

### Gate 6 — complete the browser and wallet validation

1. Repair the 13 interrupted Stage-B unit failures.
2. Bind the complete Playwright plus `playwright-core` closure.
3. Bind the entire Chromium support tree, not only its executable.
4. Complete immutable runtime/OS trust and sandbox-capability evidence.
5. Seal one exact candidate and obtain independent protocol, runtime, and
   UI/matrix `PASS` votes.
6. Only then run temporary-mail OTP login for user, merchant, and admin,
   capture the three public wallet addresses in the approved aggregate
   artifact, validate desktop/mobile/logout/no-restore behavior, and delete
   every mailbox.

### Gate 7 — value-moving E2E, migration, and rollout

Mock-USDC funding, faucet changes, signatures, deployments, migration, canary,
and end-to-end order settlement are still prohibited. They may be performed
only after a new council approval and the preceding gates are satisfied.

## Claims that must not be made

- The complete plan or definition of done is complete.
- The council approved the algorithm or any value movement.
- On-chain v2 exact-four, principal accounting, rounds, leases, or migration
  are implemented or deployed.
- The helper is production-ready.
- The v2 subgraph is deployed or backfilled.
- Live OTP login, wallet acquisition, mock-USDC funding, or full lifecycle E2E
  passed.
- The private P2P.me ranking algorithm was replicated.

The implemented result is a substantial, tested, fail-closed foundation. The
remaining work is intentionally explicit so a later session can resume without
weakening the council or security boundary.
