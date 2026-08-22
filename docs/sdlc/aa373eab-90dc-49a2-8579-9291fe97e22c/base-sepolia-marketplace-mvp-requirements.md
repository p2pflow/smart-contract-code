# Requirements Discovery Document

**Artifact slug:** `base-sepolia-marketplace-mvp` (paired SDD: `base-sepolia-marketplace-mvp.md`; see [artifact-naming.md](../../../.cursor/sdlc-system/workflow/artifact-naming.md))  
**Workflow ID:** `aa373eab-90dc-49a2-8579-9291fe97e22c`  
**Date:** `2026-08-15T12:21:35.000Z`  
**Status:** READY_FOR_SDD  
**Work type:** `transformation`

## 1. Business objective

Transform the current P2PFlow prototypes into a coherent Base Sepolia MVP for users, approved merchants, and operators: a user must be able to create a real USDC/INR BUY or SELL order from a fresh multi-source quote, receive an auditable off-chain merchant assignment that is independently validated on-chain, complete a symmetric fiat-confirmation and USDC settlement lifecycle, and inspect accurate history. Merchants must be able to onboard, manage liquidity and availability, and fulfill assignments; authenticated operators must be able to administer merchants, prices, disputes, pause state, and automation health. Success means every launched action is backed by the Diamond, one modular executor, PostgreSQL, and the Goldsky read model; all affected builds and tests pass; no secret or plaintext payment detail reaches a public artifact; and no mainnet transaction or exposed deployer key is used.

## 2. Functional requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | The complete phase must target only Base Sepolia (`chainId 84532`) and Circle's official six-decimal Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`). One versioned deployment manifest must identify the chain, Diamond, facets, USDC, contract version, deployment transaction, and start block and must be consumed or generated into every contract, executor, subgraph, and UI configuration. | Must | initial intent; MDC |
| FR-2 | The off-chain system must be exactly one new modular executor application, one process/container artifact, and one deployment unit. Pricing, matching, confirmed-chain ingestion and recovery, transaction submission, durable jobs/outbox, sessions/API, payment-reference storage, health, and operational scheduling must be internal modules of that application; the existing merchant-UI `server.js` API must not remain a separately deployed backend. | Must | user; AGENTS.md |
| FR-3 | The executor pricing module must collect timestamped observations from multiple independent market/FX sources, reject missing, stale, malformed, and over-deviant observations, calculate explicit BUY and SELL INR/USDC prices with documented units and rounding, persist inputs and the derived decision, and support dry-run/shadow publication. | Must | initial intent; phase plan |
| FR-4 | The Diamond must expose authorized, monotonic price rounds containing BUY price, SELL price, round identifier, and publication timestamp. It must reject unauthorized publishers, zero/invalid prices, replayed or older rounds, prices outside configured deviation policy, stale prices at order creation, and orders whose executed price violates the user's quote/slippage bound. Emergency operator price controls must not bypass the same audit events and validity rules. | Must | acceptance criteria |
| FR-5 | Creating an order must validate a fresh price round and the user's bound, record the selected price and round, emit a canonical order-created event, and leave merchant assignment to a subsequent authorized executor action. A successfully mined receipt must be decoded to the real emitted order ID; a transaction hash must never be used as an order ID. | Must | initial intent; codebase reconnaissance |
| FR-6 | For each confirmed order-created event, the matching module must create one idempotent job, obtain candidate snapshots from the subgraph, combine them with current PostgreSQL in-flight reservations, filter by side/channel/capacity/caps, rank a small candidate set using an explainable least-recently-served/fair tie-break policy, persist the evidence and decision, reserve capacity atomically, and submit the exact ordered merchant/channel candidates. | Must | initial intent; phase plan |
| FR-7 | An authorized assignment entry point in the Diamond must revalidate order state, assigner role, candidate-count bound, duplicate candidates, registered merchant, approved/active/not-blacklisted account, online availability, merchant-channel ownership, approved and active channel, correct BUY/SELL support, and current USDC or fiat capacity before storing assignments. It must reject the complete action atomically when guardrails fail and must never scan an unbounded merchant registry. | Must | acceptance criteria; current `OrderFacet` gap |
| FR-8 | BUY and SELL must use the same explicit two-party fiat lifecycle: the fiat-paying party marks payment sent and the fiat-receiving party confirms receipt before USDC settlement. A payer's unilateral “sent” action must not complete settlement. Each transition must be actor-restricted, single-use, evented, and reject invalid or replayed state changes. | Must | acceptance criteria; current asymmetric SELL flow |
| FR-9 | Contract custody and accounting must conserve Diamond-held USDC across merchant deposits, user SELL escrow, BUY reservations, SELL reservations, completion, cancellation, rejection, expiry recovery, dispute resolution, and merchant withdrawal. Withdrawals must not consume reserved, risk-locked, disputed, or otherwise obligated balances; cancellation and dispute branches must release or return each reservation/escrow exactly once. | Must | acceptance criteria; security review |
| FR-10 | Merchant onboarding must support registration/stake, operator approval controls, availability, liquidity, and payment-channel lifecycle without placing bank name, account suffix, UPI ID, Telegram handle, or other payment/contact data in contract storage or public events. The Diamond/subgraph retain only opaque channel/payment-reference identifiers and eligibility metadata; authorized parties retrieve the sensitive value from the executor. | Must | business flows; privacy constraint |
| FR-11 | Solidity daily/monthly rolling business caps, setters, counters, and matching dependencies must be removed or made non-authoritative. The subgraph must materialize completed merchant volume in UTC calendar-day and calendar-month buckets, and the matcher must enforce configured caps using indexed completed totals plus transactionally reserved in-flight capacity. | Must | user; phase plan |
| FR-12 | Only minimal safety time rules may remain in the contract: price freshness and bounded order/assignment lifetime/recovery. The contract need not wake itself; the executor must submit any expiry/recovery transaction, while users and operators retain explicit safe cancellation/recovery paths. Complex rolling windows and automatic timeout trees are excluded. | Must | user; phase plan |
| FR-13 | The executor chain module must use WebSocket events only as low-latency wake-ups and confirmed HTTP log scans as the recovery authority. It must persist block number/hash cursors, replay an overlap window, detect reorganizations, orphan/rebuild affected derived jobs and reservations safely, and recover missed events after process or provider outages. | Must | acceptance criteria; MDC |
| FR-14 | Every executor side effect must use deterministic job/action identifiers and a PostgreSQL transaction outbox. Transaction attempts must be simulated, nonce-coordinated, persisted before broadcast, reconciled by receipt after timeout/restart, and classified as confirmed, reverted, retryable, or uncertain so a retry cannot silently submit the same financial action twice. | Must | acceptance criteria; coding standards |
| FR-15 | The executor HTTP module must issue single-use, expiring nonces, verify wallet signatures including expected address/domain/chain, create revocable short-lived sessions in Secure HttpOnly cookies, and enforce current Diamond roles server-side on merchant/operator endpoints. Wallet connection or localStorage flags alone must not authenticate a privileged request. | Must | initial intent; auth MDC |
| FR-16 | All three clients must centralize wallet reconnect and remote-state ownership, use TanStack Query caching and invalidation, prefer paginated subgraph/executor reads for projections, and reserve direct RPC calls for balances, exact authoritative state, receipt handling, and pre-write checks. Equivalent live queries must share cache keys and must not create redundant per-component polling loops. | Must | user concern; phase plan |
| FR-17 | A shared, strict, typed protocol package must provide the generated Diamond ABI/events, deployment manifest, chain/token constants, enums/statuses, amount and rounding helpers, transaction preparation, stable error mapping, and receipt decoding to the executor and three UIs. Superseded hand-written ABI/config copies must be deleted once consumers migrate. | Must | phase plan; P2P.me reference |
| FR-18 | The user UI must expose real Base Sepolia quote, BUY, SELL, assignment, payment-sent, payment-received confirmation, safe cancellation/dispute/recovery, and paginated order-history behavior. SELL approval must be exact or explicitly bounded and only requested for the escrowed amount; payment-reference submission must use the authenticated executor API. | Must | business flows; acceptance criteria |
| FR-19 | The merchant UI must expose real onboarding/stake/channel approval state, availability, liquidity/capacity, assignment inbox, accept/reject, payment-sent/payment-received confirmation, and activity history. Notifications and payment references must come from authorized durable executor APIs, not an in-memory unauthenticated UI server. | Must | business flows; current `server.js` gap |
| FR-20 | The admin UI must require a verified operator session and current on-chain role before exposing or executing merchant/channel decisions, price health/publication controls, order/dispute inspection and resolution, pause/emergency controls, or executor health. Directly routable unauthenticated admin pages and placeholder operations must be removed. | Must | initial intent; current admin reconnaissance |
| FR-21 | The Goldsky subgraph must align exactly with the final Diamond ABI and manifest and provide mutable current snapshots plus immutable transition/event records for platform configuration, merchants, opaque channels, price rounds, orders, assignments, disputes, and UTC daily/monthly merchant metrics. Every record must retain block/transaction/log provenance, list queries must use cursor pagination, and no plaintext or reversibly encoded payment data/session data may be indexed. | Must | acceptance criteria |
| FR-22 | The executor must expose readiness/liveness and authenticated operational views for chain/subgraph lag, price source health and age, job/outbox state, matching decisions/rejections, reservations, transaction uncertainty, and session denials. Pricing/matching writes must support an operator-controlled dry-run/shadow mode and emit redacted structured audit logs and alerts. | Must | deployment MDC |
| FR-23 | Deployment and upgrade tooling must fail unless the chain is Base Sepolia, the official USDC address has bytecode and six decimals, expected facet selectors and roles are installed, and the generated manifest agrees with every consumer. No script may silently fall back to a mock token or Ethereum Sepolia. No signing or deployment may occur until a replacement for the exposed deployer key is supplied. | Must | business constraints; current deploy script |
| FR-24 | The transformation must remove released demo/placeholder/development-mode surfaces, P2P.me branding, hardcoded statistics/balances, fake delays/success states, dead routes, browser secret variables, obsolete local authentication stores, legacy Sepolia/mock-USDC config, unused time-cap code, the merchant UI backend, and parallel ABI/config implementations when their real replacements are complete. | Must | user; entropy policy |
| FR-25 | Contract, executor, subgraph, shared-package, and UI verification must cover unit, negative, access-control, invariant, idempotency/restart/reorg, ABI compatibility, and end-to-end BUY/SELL journeys. The documented compile, lint, typecheck, test, codegen, and production-build commands for every modifiable repository must pass before the phase is considered complete. | Must | acceptance criteria; coding standards |

## 3. Non-functional requirements

| ID | Category | Requirement | Metric / verification |
|----|----------|-------------|-----------------------|
| NFR-1 | Security | Privileged contract functions and executor APIs must use explicit least-privilege roles; owner/admin, price updater, and assigner authority must be separable; pause and role rotation must be available. | Negative tests prove every unauthorized path reverts/returns 403; role manifest is verified at startup/deploy. |
| NFR-2 | Custody integrity | Token interactions must use SafeERC20, checks-effects-interactions, a Diamond-wide reentrancy guard, exact/bounded allowances, explicit six-decimal arithmetic, and invariant-preserving accounting. | Reentrancy, bad-token, allowance, rounding, cancellation, dispute, withdrawal, and conservation invariant suites pass. |
| NFR-3 | Privacy | Secrets and plaintext payment/contact data must not appear in Git history, Vite variables, browser bundles, contract state/events, subgraph entities, URLs, logs, metrics, or error bodies. Stored payment references and sessions must be encrypted at rest and access-audited. | Repository/bundle/log scans find zero prohibited values; privacy-focused API authorization tests pass. |
| NFR-4 | Price integrity | Publication requires a configurable quorum of at least two valid independent observations, source timestamps, bounded deviation, deterministic aggregation/rounding, monotonic rounds, and contract freshness/slippage enforcement. | Unit/property tests cover stale, missing, outlier, replay, deviation, rounding, and slippage cases; every published round has persisted evidence. |
| NFR-5 | Reliability | Confirmed-chain ingestion, jobs, reservations, and transaction attempts must survive process/database/provider restarts and missed WebSocket messages without losing or duplicating a financial action. | Automated restart, missed-log, duplicate-event, uncertain-receipt, and shallow-reorg scenarios converge to canonical chain state. |
| NFR-6 | Idempotency | Every event, job, matching decision, reservation, outbox action, and transaction intent must have a deterministic uniqueness key and safe terminal-state reconciliation. | Replaying each supported event/job at least twice produces one logical action and no double reservation or settlement. |
| NFR-7 | Consistency | The Diamond remains authoritative for custody, roles, state, and eligibility; subgraph and executor projections are explicitly eventually consistent and must be revalidated before financial writes. | Contract rejects stale/invalid submitted candidates in integration tests; UIs distinguish pending indexing from confirmed chain state. |
| NFR-8 | Performance | State-changing calls must accept bounded inputs (assignment candidates limited to 1–4) and contain no registry-wide scan; GraphQL and HTTP list endpoints must enforce cursor pagination and bounded page sizes. | Gas/complexity tests verify bounded candidate work; request tests reject excessive limits; no unbounded list loop is reachable in a write. |
| NFR-9 | Client efficiency | Remote state must be cached by stable keys with targeted post-receipt invalidation, and duplicate identical provider/subgraph calls during a freshness window must be coalesced. | Hook/integration tests assert one fetch per active query key and no always-on duplicate polling for the same resource. |
| NFR-10 | Observability | Logs must be structured and redacted and correlate request, session, event, job, order, price round, matching decision, reservation, and transaction IDs; health metrics must surface cursor/indexing lag and automation failure. | Health endpoints and metrics expose every MDC-listed signal; log tests prove redaction and correlation fields. |
| NFR-11 | Maintainability | The executor must remain one deployable with strict TypeScript module boundaries and one shared PostgreSQL transaction boundary; HTTP handlers must delegate chain/database work to typed services. | One container/build artifact and one process entry point exist; dependency/boundary checks and strict typecheck pass. |
| NFR-12 | Compatibility | Final ABI, event signatures, status values, units, addresses, and start block must be generated from one protocol source and validated across the subgraph, executor, and all clients. | ABI compatibility tests and manifest startup/build validation pass in all six modifiable repositories. |
| NFR-13 | Authentication | Nonces must be single-use and expiring; cookies must be Secure, HttpOnly, and appropriately SameSite-scoped; logout/revocation and wallet/role changes must invalidate privileged access; state-changing cookie requests require origin/CSRF protection. | Replay, expiry, wrong-chain, wrong-domain, role-removal, cookie-flag, origin, and CSRF tests pass. |
| NFR-14 | Release safety | Base Sepolia writes must default off until dry-run/shadow evidence, coordinated test results, manifest checks, and a non-exposed signer are available; database migrations must be reversible and Diamond rollback must be an additive cut/pause procedure. | No enabled write path boots without explicit flag and valid signer/roles; rehearsal and rollback runbooks pass on Base Sepolia. |
| NFR-15 | Verification | The target runtime is Node.js 24.x LTS, Solidity compilation uses 0.8.24 consistently, executor/shared TypeScript runs in strict mode, and all repository lockfiles remain deterministic. | CI and local commands in MDC pass from clean installs; generated artifacts have no uncommitted drift. |

## 3b. Technical baseline

| Item | Current | Target |
|------|---------|--------|
| Runtime / platform | Five existing repositories are on clean `codex-2` commits equal to local `origin/dev`; the executor repository does not yet exist. Node is not installed in the discovery environment. Shared integration is partly Base Sepolia, while docs/scripts retain Ethereum Sepolia and mock-token paths. | Solidity 0.8.24 and Node.js 24.x LTS across six modifiable repositories; local deterministic development plus Base Sepolia as the sole shared environment; one new executor repository/artifact. |
| Contract pricing | `ConfigFacet.setOrderPricing` stores two admin-set integer prices with no source evidence, round, freshness, deviation, or user slippage data. | Authorized round-based BUY/SELL prices published from persisted multi-source evidence with monotonicity, freshness, deviation, and per-order bounds. |
| Contract matching | `createBuyOrder`/`createSellOrder` synchronously iterate a whitelist or the full merchant list and choose the first four; BUY eligibility explicitly ignores online/offline status. | Order creation is independent from assignment; executor submits 1–4 exact ranked merchant/channel candidates and a dedicated authorized contract path revalidates every bounded guardrail. |
| Order/custody lifecycle | BUY requires payer sent then merchant confirm; SELL completes unilaterally when the merchant marks sent and moves value into a time-based risk bucket. Merchant withdrawal/accounting and stale tests show unresolved obligation risks. | Symmetric payer-sent/receiver-confirmed BUY and SELL transitions with single-release escrow/reservation accounting, safe cancellation/dispute/expiry recovery, and custody invariants. |
| Time/caps | AppStorage and `LibMerchants` contain rolling daily/30-day window state and setters, although the consume helper is not called by the order flow; dispute timing is extensive. | On-chain business-period caps removed; subgraph UTC day/month completed-volume buckets plus PostgreSQL in-flight reservations enforce caps; only price/order/assignment safety lifetimes remain. |
| Privacy | `MerchantFacet` stores bank name, account suffix, UPI ID, label, and Telegram handle publicly; the subgraph enriches and exposes them. The merchant UI server accepts/serves SELL UPI metadata from RAM without wallet authorization and permits wildcard CORS. | Only opaque channel/payment references are public; encrypted durable payment details live in executor/PostgreSQL and are disclosed only to authenticated order parties/operators under audited access. |
| Executor/backend | No P2PFlow executor exists. Merchant notifications/payment metadata are a second in-memory backend embedded in `p2pflow-merchant-ui/server.js`, with restart data loss. | Exactly one Fastify-based modular executor with PostgreSQL durable state, chain recovery, jobs/outbox, pricing, matching, sessions, payment references, notifications, health, and operations. |
| Subgraph | Base Sepolia manifest currently targets an older Diamond; 12 entity types model current snapshots/history but expose payment data, retain hardcoded prices/rolling windows, lack UTC daily/monthly merchant metric entities, and have no mapping tests. README still advertises Ethereum Sepolia. | ABI-aligned Goldsky projection with mutable snapshots, immutable transitions, price/assignment entities, UTC day/month metrics, block provenance, pagination, privacy, and mapping tests. |
| Clients | Three Vite apps duplicate ABI/config/helpers; public examples contain a mock USDC address and `VITE_*` secret variables. Wallet connection is treated as authentication, legacy auth state/tokens use localStorage, admin routes are unguarded, merchant app forces a fake three-second loader, and released routes include P2P.me branding/placeholders. | Shared typed protocol/config package, Base Sepolia manifest, wallet-backed HttpOnly sessions, controlled query caching, receipt-derived IDs, authenticated real user/merchant/admin routes, and no shipped browser secret or fake/demo state. |
| Tests/build | Contract tests cover many happy/security paths but `diamond.test.js` references removed functions/statuses (`creditChannelFiat`, `getPendingChannelCount`, `DORMANT`) and cannot match current facets. The UIs and P2PFlow subgraph have no test files. | Aligned unit/invariant/integration/E2E suites across all layers, clean compile/codegen/lint/typecheck/test/build commands, and coordinated ABI compatibility verification. |
| Reference architecture | P2P.me provides a typed SDK, receipt decoding, subgraph-first reads, BullMQ keeper patterns, and daily bucket examples, but its client chooses a circle and its executor only calls on-chain `assignMerchants(orderId)`; it has no reusable multi-source price publisher or backend session service. | Reuse patterns only: typed boundaries, durable event automation concepts, receipt decoding, and materialized metrics. P2PFlow's exact-candidate matching, pricing, session, privacy, and PostgreSQL reliability model are original and purpose-limited. |
| Artifacts to remove (estimate) | Static-price and on-chain router/whitelist paths; rolling cap fields/functions; plaintext payment fields; merchant UI `server.js`; per-UI ABI/config/auth/crypto copies; secret-prefixed Vite entries; Ethereum Sepolia/mock-token fallbacks; placeholder/deferred routes; stale tests and docs. | Superseded paths deleted in the same change that migrates their final consumer; only the shared protocol source, one executor backend, focused MVP routes, and Base Sepolia configuration remain. |

**Scope:** End-to-end working application — contract/storage/events, generated ABI and manifest, executor, database migrations, subgraph schema/mappings, three clients, configuration, tests, CI, operational documentation, and deletion of superseded implementations. Configuration-only changes are insufficient.

## 4. Repositories

Repository policy below is loaded from the verified live MDC files; it is not inferred from repository remotes.

### Involved

| Repo | Role | Discovery notes |
|------|------|-----------------|
| `p2pflow/p2pflow-smart-contract` | modifiable; primary coordination repo | EIP-2535 Diamond, Hardhat 2, OpenZeppelin 5, Solidity source under `contracts/`, scripts under `scripts/`, and Mocha tests under `test/`. Current static pricing, synchronous matching, asymmetric SELL completion, public payment data, rolling-cap remnants, and stale test/facet drift are directly affected. |
| `p2pflow/p2pflow-subgraph` | modifiable | Graph/Goldsky AssemblyScript mappings, GraphQL schema, Diamond ABI, and network manifest. Current Base Sepolia projection exposes payment data and lacks required UTC metric buckets/tests. |
| `p2pflow/p2pflow-user-ui` | modifiable | React 19/Vite 5/Thirdweb/TanStack Query user app. It has BUY/SELL pages and receipt decoding but duplicate protocol code, wallet-only auth, local payment data, browser secret variables, mock-token config, non-MVP routes, and P2P.me branding. |
| `p2pflow/p2pflow-merchant-ui` | modifiable | React 19/Vite 5 merchant app plus `server.js`. It has onboarding/order hooks but wallet-only guards, forced loader, duplicate ABI/config, and an unauthenticated volatile payment/notification backend that must move into the executor and be removed. |
| `p2pflow/p2pflow-admin-ui` | modifiable | React 18/Vite 5 admin dashboard. Root routes currently have no authentication guard, include numerous “coming soon” pages, expose browser-secret config keys, and duplicate contract/subgraph helpers. |
| `local/p2pflow-executor` | modifiable; new local repository | Not present at discovery and has no GitHub remote. Must be created as one strict-TypeScript, Fastify/PostgreSQL modular deployable containing every off-chain capability in scope. |

### Modifiable

- `p2pflow/p2pflow-smart-contract`
- `p2pflow/p2pflow-subgraph`
- `p2pflow/p2pflow-user-ui`
- `p2pflow/p2pflow-merchant-ui`
- `p2pflow/p2pflow-admin-ui`
- `local/p2pflow-executor`

### Read-only

- `p2pdotme/user-app-client` — React 19 reference for typed core/adapter separation, subgraph-first reads, receipt handling, and production UI patterns; its multi-currency/bridge/ZK/rewards scope is not part of this phase.
- `p2pdotme/p2pdotme-sdk` — TypeScript/viem/neverthrow/Zod reference for framework-neutral typed actions, prepared transactions, validation, error mapping, and receipt-derived order IDs. Its internal epsilon-greedy circle selection is not the P2PFlow matcher.
- `p2pdotme/executor` — BullMQ/Redis keeper reference for WebSocket wake-ups, recovery scans, pre-simulation, retries, nonce handling, dry-run, and health. Its assignment handler passes only `orderId` to on-chain matching, lacks PostgreSQL decision/session state, and is not a codebase to copy or modify.
- `p2pdotme/subgraph` — Graph reference for materialized order/merchant entities and UTC daily metrics. Its circles, scoring, rewards, referrals, insurance, and broad 54-entity model are intentionally excluded.

## 5. Constraints

- Base Sepolia (`84532`) is the only chain for this phase; no mainnet configuration or deployment is authorized.
- Existing P2PFlow repositories must remain on `codex-2`, which currently equals their local `origin/dev`; no old `codex` work may be merged.
- Build exactly one modular executor deployable. Pricing, matching, auth, scanner, transaction, payment-reference, notification, and operations modules cannot become separate services.
- Use Circle's official Base Sepolia USDC consistently. Existing mock-token addresses and permissive deployment fallbacks are not release configuration.
- Never read, print, stage, copy, or commit `/home/ubuntu/check/.env` or any credential. No private key, Thirdweb secret, Goldsky token, encryption secret, or privileged RPC credential may enter `VITE_*` or a browser bundle.
- The previously supplied deployer key was exposed in tool output and is invalid for further signing. Contract/executor writes and deployment remain disabled until it is replaced.
- P2P.me repositories under `/home/ubuntu/check/p2pme` are read-only architectural references and may not be changed, copied wholesale, or used as runtime dependencies.
- The Diamond is authoritative for custody, order state, roles, pause state, and current eligibility/liquidity; neither subgraph nor PostgreSQL may authorize a financial action by itself.
- Payment/UPI/contact data must remain off-chain, absent from public events/subgraph/browser logs, encrypted at rest, and disclosed only to an authenticated authorized party.
- Preserve unrelated user work and use remove-on-touch entropy policy: when a real path replaces a demo/legacy path, delete the superseded implementation, tests, routes, and environment keys.
- Fast MVP exclusions are binding: circles, reputation/scoring, rewards, referrals, bridges, multiple chains/tokens/fiat currencies, QR/PAY, insurance, governance, ML routing, and complex business timers.
- Jira and BugBot are disabled; the executor remote, final hosting, alert/APM vendor, and managed signer/KMS provider are not yet selected.

## 6. External dependencies

| System | Purpose | Integration style | Owner/team (if known) |
|--------|---------|-------------------|------------------------|
| Base Sepolia | Sole chain for Diamond state, USDC custody, events, and automation transactions | JSON-RPC HTTP plus WebSocket wake-ups; configurable confirmation/reorg policy | Base ecosystem; RPC provider |
| Circle Base Sepolia USDC | Six-decimal escrow, merchant liquidity, and settlement token | ERC-20 at the fixed official address; bytecode/decimals checked | Circle |
| Alchemy | Server-side Base Sepolia HTTP/WSS access | Injected executor/deployment secret; public clients receive only an approved public RPC strategy | External provider |
| Thirdweb | Wallet creation/connection and transaction signing in three UIs | Public client ID in browser; secret remains server-only if used | External provider |
| Goldsky | Hosted Graph indexing and query endpoint | Final ABI/manifest deployment; public query URL, server-only deployment token | External provider |
| PostgreSQL | Durable canonical cursors, jobs, outbox, decisions, reservations, sessions, payment references, and audit records | One executor-owned database and reversible migrations | Hosting TBD |
| Independent market/FX providers | USDC/USD and USD/INR or equivalent observations for BUY/SELL price derivation | Server-side HTTPS clients with timeouts, source timestamps, validation, quorum, and persisted evidence | Providers TBD |
| Secret manager / managed signer | Replacement deployer plus separated updater/assigner credentials | Server-side injected secrets or remote signing; never repository/browser | Vendor TBD |
| Alert/metrics platform | Operational notification and dashboards | Redacted structured logs, metrics scrape/export, and alert webhook | Vendor TBD |
| Domain/TLS hosting | Static UI origins and the executor API cookie/origin boundary | HTTPS with explicit allowed origins and Secure cookies | Vendor/domain TBD |

## 7. Assumptions

1. **A-1:** “Go live” for this workflow means a complete, externally testable Base Sepolia MVP; mainnet/production rollout is a later separately authorized phase.
2. **A-2:** Existing Base Sepolia test data and the old mock-USDC Diamond do not require migration. A new versioned deployment may be used to obtain a clean storage/event/privacy baseline after the signer is replaced.
3. **A-3:** The official Circle Base Sepolia USDC address is fixed as documented in MDC and exposes six decimals; no locally deployed mock token is an integration substitute.
4. **A-4:** The first matching policy is deterministic and explainable: eligibility and capacity first, then least recently served with a stable fair tie-break; randomized/ML/reputation routing is deferred.
5. **A-5:** Daily/monthly caps are UTC calendar buckets based on completed volume, and accepted/in-flight orders consume temporary PostgreSQL reservations until they complete or release.
6. **A-6:** The user and merchant wallets can sign a standards-based login challenge on Base Sepolia; the executor can verify both embedded and external wallet signatures.
7. **A-7:** Fiat transfer remains an off-chain human action. The MVP records explicit attestations by the payer and receiver but does not integrate a bank/UPI payment-status API.
8. **A-8:** One active executor deployment is sufficient for the MVP. Its internal scheduler/worker concurrency must still be safe under retries; horizontal active-writer coordination may use database locks if replicas are introduced later.
9. **A-9:** PostgreSQL is available to the executor and is the only new durable application datastore; a separately deployed Redis queue is not required for the MVP.
10. **A-10:** The subgraph can lag and may be rebuilt. Executor reservations and final contract revalidation close the consistency gap; indexed state never bypasses on-chain checks.
11. **A-11:** The SDD may choose exact configurable thresholds (confirmation depth, freshness, deviation, slippage defaults, expiry, session TTL, and retry bounds), but risky writes remain disabled until operators approve deployment values.
12. **A-12:** P2P.me's MIT licensing permits architectural study, but this workflow will implement P2PFlow-specific code and retain no runtime or maintenance dependency on those repositories.

## 8. Risks

| ID | Risk | Impact | Likelihood | Mitigation |
|----|------|--------|------------|------------|
| R-1 | The only supplied deployer key was exposed in tool output. | Unauthorized testnet control/signing and an invalid security rehearsal. | High until replaced | Treat signing as blocked, rotate/fund a replacement, use separate updater/assigner identities, verify roles and balances without printing secrets. |
| R-2 | Diamond AppStorage changes can corrupt existing layout when nested structs or prior fields move. | Permanent custody/state corruption. | High | Prefer a fresh Base Sepolia MVP deployment or append-only, storage-layout-reviewed migration; add layout regression and invariant tests before any cut. |
| R-3 | Current on-chain/subgraph history already contains public payment/contact values that cannot be erased from the chain. | Privacy leakage despite UI/schema cleanup. | High for old deployment | Do not reuse it as the final privacy baseline; deploy a clean Diamond/subgraph after rotation, never migrate PII, document legacy testnet exposure. |
| R-4 | Subgraph lag or stale merchant snapshots can over-assign capacity or caps. | Failed assignment transactions, poor UX, unfair routing. | Medium | Atomic PostgreSQL reservations, lag thresholds, current RPC preflight where necessary, and mandatory Diamond guardrail revalidation. |
| R-5 | Price sources can fail together, return stale data, or be manipulated. | Users transact at an unsafe rate or writes halt. | Medium | Independent source quorum, timestamps, outlier/deviation bounds, persisted evidence, on-chain freshness/slippage, alerts, pause/fail-closed policy. |
| R-6 | Reorgs, timeouts, nonce races, and crash-after-broadcast can create ambiguous automation state. | Duplicate or missing assignment/price/expiry writes. | Medium | Confirmed block/hash cursors, overlap replay, deterministic actions, transactional outbox, pre-simulation, nonce serialization, receipt reconciliation, uncertain state queue. |
| R-7 | Six repositories can drift in ABI, events, status enums, addresses, and deployment block. | Builds succeed independently but fail end to end. | High | One generated protocol package/manifest, compatibility tests, coordinated lockstep checks, fail-fast consumer validation. |
| R-8 | The existing test baseline is inconsistent and UIs/subgraph have no tests. | Regressions remain hidden and delivery estimates expand. | High | Repair baseline first, add tests with each replaced flow, prioritize custody/access/idempotency/E2E gates, record any environment-only blockers. |
| R-9 | Moving payment details from public state to an executor makes its auth, encryption, and retention controls security-critical. | Unauthorized disclosure of UPI/account data. | Medium | Per-order authorization, encrypted columns with managed key, minimal retention, access audit, redacted logs, CSRF/origin protection, focused security tests. |
| R-10 | Broad prototype cleanup and desired MVP behavior span contracts, backend, indexing, and three clients. | Scope/time pressure could leave parallel partial implementations. | High | Phase by vertical critical flow, enforce remove-on-touch, defer explicit non-MVP features, and do not label a route live before end-to-end verification. |
| R-11 | Final hosting, TLS domains, monitoring, secret manager, and executor GitHub remote are undecided. | Base Sepolia deployment/PR publication may be delayed after code is ready. | Medium | Keep providers behind configuration/interfaces, produce container/runbook locally, surface platform handoff; obtain remote and infrastructure before release rehearsal. |
| R-12 | INR/UPI marketplace operation may create legal, payments, sanctions, tax, consumer-protection, or data-retention obligations beyond software correctness. | A technically complete MVP may not be legally deployable to real users. | Medium/unknown | Keep this phase testnet-only, restrict test participants, obtain qualified legal/compliance review before any mainnet or real-fiat public launch. |
| R-13 | The discovery host currently lacks Node.js, so the observed baseline could not be compiled or tested during reconnaissance. | Unknown additional compile/lint failures and delayed verification. | High at discovery | Install/pin Node.js 24 LTS through an approved mechanism, use lockfiles, run clean baseline commands before implementation, record inherited failures separately. |

## 9. Open questions

The SDD may proceed using the assumptions above; these questions must be resolved before the indicated release capability is enabled.

1. **Q-1 (blocks all signing/deployment):** What replacement deployer/admin, price-updater, and assigner addresses will be used, and will signing use environment-injected test keys or a selected managed signer/KMS?
2. **Q-2 (blocks shared deployment):** Which hosting provider, public UI/API domains, TLS setup, PostgreSQL instance, secret manager, and alert/metrics destination will be used?
3. **Q-3 (blocks enabling automated price writes):** Which independent price/FX providers and exact quorum, spread, freshness, deviation, rounding, update cadence, and default user-slippage policies are approved?
4. **Q-4 (blocks enabling matching caps):** What per-merchant/per-channel daily and monthly cap values apply, do BUY and SELL share a cap, and are operator overrides needed in the MVP?
5. **Q-5 (blocks enabling automated recovery):** What exact price-age, unaccepted-order lifetime, assignment lifetime, fiat-confirmation recovery, and dispute durations are acceptable for the testnet MVP?
6. **Q-6 (blocks real payment-detail use):** What payment-reference fields, encryption/key owner, authorized viewer rules, retention period, deletion policy, and operator break-glass access are approved?
7. **Q-7 (release governance):** Who performs the independent contract/security review and who has authority to approve the Base Sepolia write flags after dry-run evidence?
8. **Q-8 (collaboration):** What GitHub organization/repository should receive `p2pflow-executor`, and are coordinated PRs required for all six repositories or is a local executor handoff acceptable initially?

## 10. Appendix

### 10.1 Explicitly out of scope

- Any Ethereum/Base mainnet deployment, transaction, or production-fiat public launch.
- P2P.me circles, client-side epsilon-greedy routing, reputation scoring, rewards, referrals, insurance, governance, cashback, campaigns, and B2B/PAY flows.
- Multiple chains, tokens, fiat currencies, bridges, gas sponsorship, QR payments, ZK identity, social verification, ML/fraud scoring, and advanced analytics.
- On-chain daily/monthly business counters, complex rolling time windows, and autonomous contract timers.
- Separate pricing, matching, auth, scanner, notification, or payment-data microservices.
- Publishing a broad external SDK; the phase needs one internal shared protocol package only.
- Migration of old testnet orders, merchants, payment data, or mock-token balances unless separately approved.

### 10.2 Glossary

- **Diamond:** The EIP-2535 proxy whose facets share authoritative application storage.
- **Executor:** The single modular off-chain deployable that owns all backend/automation capabilities in this phase.
- **Price round:** A monotonic, timestamped BUY/SELL price publication with off-chain source evidence and on-chain validity rules.
- **Exact candidates:** A bounded ordered set of merchant and channel identifiers chosen off-chain and revalidated by the Diamond.
- **Reservation:** Durable in-flight capacity held in PostgreSQL during matching and authoritative escrow/liquidity state held by the Diamond after acceptance.
- **Snapshot:** Mutable latest-state subgraph entity; **transition** means an immutable event-derived history record.
- **Canonical cursor:** Persisted confirmed block number and hash used to resume scans and detect reorgs.
- **Transaction outbox:** Durable intent/attempt ledger that makes database decisions and eventual chain submission recoverable.

### 10.3 Reference files reviewed

- Project control: `AGENTS.md`, `.cursor/project-context/*.mdc`, `.cursor/sdlc-system/state/aa373eab-90dc-49a2-8579-9291fe97e22c.json`, and `/home/ubuntu/check/P2PFLOW_MVP_PHASE_1_HIGH_LEVEL.md`.
- Contracts: `contracts/shared/AppStorage.sol`, `contracts/facets/ConfigFacet.sol`, `contracts/facets/MerchantFacet.sol`, `contracts/facets/OrderFacet.sol`, `contracts/libraries/LibMerchants.sol`, `contracts/libraries/LibOrders.sol`, `contracts/upgradeInitializers/DiamondInit.sol`, `scripts/deploy.js`, `hardhat.config.js`, `test/diamond.test.js`, and `test/orders.test.js`.
- Subgraph: `../p2pflow-subgraph/schema.graphql`, `subgraph.yaml`, `src/helpers.ts`, `src/mapping.ts`, ABI, package scripts, and network templates.
- Clients: each UI's `README.md`, `package.json`, `.env.example`, `src/App.jsx`, wallet/config/ABI hooks, subgraph hooks, auth stores/guards, and affected BUY/SELL/order/merchant/admin pages; additionally `../p2pflow-merchant-ui/server.js`.
- References: P2P.me repository READMEs/packages plus `p2pdotme-sdk/src/orders/internal/routing/routing.ts`, `p2pdotme-sdk/src/orders/actions/place-order.ts`, `executor/src/queue/handlers.ts`, executor listener/queue/helper structure, and subgraph merchant/daily-metric schema/mappings.

### 10.4 Discovery validation

- The full `workflowContext` in workflow state was compared with the live project, architecture, coding-standard, deployment, and business-flow MDC files before use; repository policy and constraints match.
- All five existing P2PFlow repositories are on `codex-2` at the same commit as their locally available `origin/dev` ref. The P2PFlow executor directory is absent and is therefore a new local repository.
- P2P.me repositories are present and on `main`; they were examined read-only.
- No workspace secret file was read, and no credential value is included in this document.
