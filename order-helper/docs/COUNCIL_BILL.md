# P2PFlow Algorithm and Accounting Review Council Bill

Verdict: REJECT
Adopted: 2026-07-29
Docket: Algorithm, accounting, custody, storage, migration, reliability, Sybil resistance, and privacy
Effect: No value-moving authority; shadow/scaffolding authorization is narrowly limited below

## Enacting decision

The Council rejects the architecture in `docs/architecture/complete_plan.md` as authority for a production or value-moving system. This rejection covers:

- any production or testnet value-moving canary;
- any Diamond cut or initializer using this bill as its safety approval;
- order assignment that can lead to an acceptance, reservation, settlement, transfer, sweep, top-up, or migration;
- any migration of merchant, channel, order, reservation, risk, principal, or gross-fiat state;
- any reconciliation entry represented as authoritative bank cash; and
- any transaction signing, private-key use, broadcast, or on-chain state change.

The Council permits only transaction-disabled, non-signing, read-only/offline work: deterministic replay, source and state reconstruction, simulations, formula and golden-vector development, invariant scaffolding, and shadow helper output that cannot authorize or trigger an action. “Shadow” does not mean a small value-moving canary.

This disposition is unanimous, 5–0. It is not a finding that the design is incurable. It is a finding that critical objections remain unresolved and the required evidence does not yet exist.

## Voting-rule application

PASS requires no unresolved critical objection from the deterministic-fairness, storage/custody, or accounting seats. All three mandatory seats retain critical objections:

- Seat F: stale concurrent virtual-finish commits, incomplete decision commitments, Sybil-amplified wallet fairness, exact-four liveness, and timing ambiguity;
- Seat S: reserve-draining unstake, reservation-stranding migration, incomplete dispute custody, stale tests, and no proven append/migration on reconciled live state; and
- Seat A: incorrect rail rounding, reservation-unsafe sweeps, cash-fact ambiguity in disputes, replayable reconciliation references, and unsecured bank/channel ownership plus provisional equity classifications.

The statutory condition for PASS is therefore not met. Evidence urgency cannot substitute for these findings.

## Pinned evidence record

The Council reviewed the following in full or, for generated machine artifacts, the relevant complete source/result records:

| Evidence | Pin |
| --- | --- |
| Governing plan, `docs/architecture/complete_plan.md` | SHA-256 `a7bc60356ad8d2ca09f1b5a18cdc686d1ea52d7661155f193a54805d335d2a6f` |
| Companion architecture | SHA-256 `4c5535ac64eca3f174df8d07ccded44b68456cdc8896fa51958498ece10a07ba` |
| Checked-in smart-contract worktree | HEAD `bef6955a5eaaa03c0262020759f4535970d3b62d` |
| Security audit | SHA-256 `659acdc2846a60a51577eea8d862e4485d9463361e36421dc7eed20fdeaab073` |
| Controller provenance amendment | SHA-256 `3fc6809457d1124cae1cd0710ff2ff35d738a1d3efc783301d29909a6723cad2` |
| Consolidated research report | SHA-256 `086a249b4164df482667932a448887beda06e517c83ca37dac1f29775ccaf5f6` |
| Final provenance report / machine record | SHA-256 `4ec1921c393dfa87b6a2a3b21f5f2886b33427fca52664865bd396043739d23b` / `d1be9a66d2554ee71b09a0b454d6cea2b76ae2b1387bfb7a15d740f96a2f15a6` |
| Final fairness / accounting reports | SHA-256 `ae0b24eb4c39790e963fd0202c69177a0384e7636970d8e0bf28963a2bb1e4ee` / `bcb950915a9c7af017409907b1cc141458fd715236416025b1efc28cf430c898` |
| Final P2P.me report / source ledger | SHA-256 `b9390d14a255cc24c7cb76fe0ed70c419bc8a8256df62ab17c201d7404ac7e72` / `aa182292c796752227aa5e69f8545e5c1c5b085851e898e8f0ec37191efe8e39` |
| Exact deployed source generation | commit `aa6f802a9e233e9d9ed101b1d4a5209d25cc1d2a` |
| Controller deployment/fork pin | Base Sepolia `84532`, Diamond `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A`, block `44,795,919` |
| Consolidated public-state/custody pin | Same chain and Diamond, block `44,795,931`, hash `0x44c6326da3fa815bfa2516124e83cf8370b6a2f2ebbaa000b07ac4a0959c752b` |
| Compiler pin | Solidity `0.8.24+commit.e11b9ed9`, optimizer 200, EVM Paris |
| Fairness configuration | SHA-256 `2a377db783e2a19957f531d2fe897056e1d20b93d66c1631fd0f1bfb2778cee5` |
| Fairness result file | SHA-256 `1a639248a8e9ff1a8a195bf7f7edadb9d07d2631f041342329c141b3fb4141ac`; internal canonical payload hash `47130e5315219201e162dbc9ab070db4a67d668254aa63acccc09fa132333e3b` |
| Accounting report | SHA-256 `e4cc14a73f8ae036c94cf286cbe43cc2057dd7a6303b21f71e49f481894b0703` |
| Accounting result file | SHA-256 `7dc7b25a487329639fc72b8e0ce3632e997830bed6b40ad751284ba47798a075` |
| Public P2P.me comparator clones | subgraph `ef6145bcf44e6126ce89f1cbc1e6759a2ec8d9b9`; SDK `6268a48672437b2fb5364e3779a0dd28f2f8a2eb`; docs `8ad11db1d57cce6818ae81ff0329c2acfdd706b4`; executor `ab9ecc94349cc8fb2422f34a9c9e609e2ff2a817` |

The late controller amendment supersedes only the earlier assertion that the live `OrderFacet` could not be reproduced. The Diamond, all six deployed facet runtimes, and initializer runtime, including metadata, match the historical source generation. This is runtime-byte identity, not proof of creation bytecode or constructor arguments. The Council withdraws “missing exact live source” as an objection within that boundary.

That correction makes several objections stronger, not weaker. In the exact source:

- `approveMerchantUnstake` can transfer the full liquidity snapshot without checking `reservedUsdc` or `riskUsdc`;
- `migrateAndTerminate` moves `fiatBalance` but leaves `reservedFiat` on the terminated source channel;
- SELL `USER_WINS` returns USDC without classifying or reversing the off-chain fiat fact; and
- the recovered tests invoke functions and a `DORMANT` status absent from the exact source.

The exact recovered layout occupies AppStorage roots 0 through 21; any new top-level roots must begin at 22. This fact does not itself prove that the proposed nested structs, initializer, selector cut, or migration are safe.

The consolidated public-state snapshot closes a narrower issue at block `44,795,931`:

- the public state contained 2 merchants, 2 channels, and 19 orders: 12 completed, 7 cancelled, and 0 open;
- merchant liquidity liabilities totaled `588,000,000` USDC atoms, reserved USDC was zero, `45,000,000` risk atoms were a partition of liquidity rather than an added liability, and open SELL escrow was zero;
- observed Diamond USDC custody was `588,000,000` atoms, equal to the source-derived expected custody, with zero delta;
- gross channel fiat was ₹1,365 and reserved fiat was zero; completed on-chain history reconstructed both channel gross-fiat balances exactly; and
- at a provisional ₹90 accounting price, 12 USDC of fiat principal implies ₹1,080 required fiat and candidate protocol equity of ₹285, with each merchant’s candidate principal target equal to 300 USDC.

The Council therefore withdraws “no current pinned token-custody reconciliation” as a blanket objection. It does not find Phase 0 or Phase 1 exited. The snapshot does not establish bank balances, merchant ownership, prior off-chain sweeps or top-ups, a fresh cut-time state, lifecycle/fork regression, or independent sign-off. Both channels remain `reconciliationRequired` for migration.

The pinned subgraph is a separate verified blocker. Repository commit `1233b1d53c1db88d4dae7993a0a5cbe39c0bcfc3` is configured for the target Diamond/start block but carries the later `orderNumber` ABI generation. The live seven-field `OrderCreated` topic is `0xa4987aaabfd00247972c458bbf7a5183bae686b39c2d77a1c70f9a84497d5dec`; the repository’s eight-field topic is `0xfc46abc20de537ef9bcee69c7bdd579a48747a658e430c99817e955675b63c37`. Live `getOrder` returns 20 fields, while the repository expects 21. The checked-in subgraph must not be deployed or redeployed against this Diamond as-is; the identity of any currently hosted subgraph binary was not proven.

The public P2P.me comparator does not validate P2PFlow’s proposed WFQ. At the pinned SDK commit, pre-order **circle** routing uses `Math.random()` with bootstrap reserve and epsilon-greedy, score/capacity-weighted selection, then up to three on-chain eligibility retries. At the pinned executor commit, a single-concurrency worker pre-simulates and sends `assignMerchants(orderId)`; public merchant documentation describes the subsequent **merchant** assignment as deterministic and on-chain while stating that exact internal scoring criteria are not publicly documented. These are distinct layers. The artifacts neither disclose a private merchant-scoring formula nor prove that P2PFlow’s deterministic virtual-finish proposal reproduces it.

## Findings on the questions presented

### 1. Virtual finish, offers, re-entry, inventory, leases, and liveness

The unamended equations do not establish equal accepted-USDC allocation or liveness.

The strongest supported result is narrow: for a fixed set of continuously eligible, non-Sybil operators, complete canonical inputs, serialized immediate acceptance, no capacity/failure asymmetry, and a monotone least-finished update, accepted-volume lag is bounded by the largest accepted order. With equal order sizes, accepted counts differ by at most one.

The controlled 100,000-order serial/immediate run supports that restricted lemma:

- accepted-volume Jain index `0.999999996892`;
- no virtual-finish regression;
- maximum-minus-minimum accepted volume `320.11 USDC`, below the largest `500 USDC` order; and
- all orders accepted with four candidates.

The same artifact rejects the written literal concurrent commit:

- `28,089` virtual-finish regressions;
- accepted-volume Jain index `0.653019950612`;
- `20` unresolved orders; and
- in the 10/12-USDC B-then-A vector, a literal stored finish falls from `48,000,000` to `40,000,000`, while a current-state rebase reaches `88,000,000`.

Acceptance-time rebasing removes the regression but is not a complete fairness or liveness remedy. The heterogeneous run still records `24` unresolved orders and Jain `0.662801768707`; global Jain must also be separated from comparable-cohort fairness when capacities and availability differ.

Other conclusions:

- `openOfferWeight = 0.25` is a congestion heuristic. Four offers aggregate to one order-equivalent of load, but that does not prove rank-win probability or accepted-volume equality under progressive leases.
- The re-entry clamp can prevent dormant-wallet catch-up only if history is preserved at the economic-operator level. A new wallet cannot reset service history.
- The 50/50 inventory target is a corridor policy and remains a secondary tie-break, not a fairness theorem.
- A bare hash tie-break permits rank-0 clustering or grinding when the order identifier is influenceable. Rotation/concentration bounds must precede the final hash.
- Progressive leases reduce fastest-bot capture under assumptions; their 15/90-second values do not prove liveness.
- A fixed low-finish nonresponsive quartet can be repeatedly selected and keep a higher-finish responsive candidate out. Mandatory event-sourced miss handling and bounded cohort expansion are required.
- Exact-four is an availability policy. It must not be described as a liveness theorem.

### 2. Decision identifiers, ordering, replay, and reproducibility

`expectedRound + 1`, a direct caller, and a consumed `decisionId` can prevent a class of same-order replay. They do not make selection independently reproducible.

The plan does not normatively bind:

- ABI types and `abi.encode` versus packed serialization;
- state block hash in addition to block number;
- the complete paginated candidate universe;
- exclusions and channel reduction;
- virtual-finish, offer, cooldown, limit, deficit, inventory, and eligibility prestates;
- ordered candidate/channel/rank outputs and the lease schedule; or
- reorg replacement and independent replay behavior.

A nonzero caller-supplied hash is a label unless the contract recomputes its canonical envelope and an independent replica can reconstruct the committed inputs. Deterministic output from incomplete inputs is not a fairness proof.

### 3. Exact four, eligibility, soft offers, reservations, and limits

Hard acceptance-time checks and atomic reservations are necessary and can preserve local inequalities if every value-moving path respects them. The present evidence does not establish that global solvency survives all paths:

- the pinned allowlist/merchant evidence contains only two merchants, so exact-four cannot presently form a round;
- soft offers do not reserve collateral, so several orders can all appear assignable and later become infeasible;
- four merchants with capacity 100 can each receive eight soft 100-unit offers; after each accepts one, the other rounds can be doomed;
- the exact live unstake path can remove liquidity backing reservations/risk;
- the exact live channel migration can strand a fiat reservation;
- rolling-limit consumption semantics and window-boundary behavior are not implemented and proven for the proposed design; and
- accepted/paid stuck states lack a complete bounded resolver and cash-evidence taxonomy.

Soft offers may serve liveness telemetry only. They are never collateral. The acceptance transaction must perform every hard check, reserve exactly once, consume limits exactly once, and update the fairness ledger atomically before any external interaction.

### 4. Principal, gross fiat, equity, rounding, transitions, disputes, FX, and sweeps

The ownership split is directionally and dimensionally coherent when units are explicit:

```text
usdcLiquidity + sum(channel fiatPrincipalUsdc) = merchantPrincipalTargetUsdc
```

Gross fiat is a physical-bank ledger, not proof of merchant principal ownership. Protocol equity is state-derived and must separately attribute quote spread, rail adjustment, FX revaluation, top-up/capital, sweep, correction, reversal, and migration.

The plan’s rounding composition is wrong. A floor-returning `mulDiv` followed by `ceilRail` can undercharge a full rail quantum. With:

```text
U = 1,000 USDC atoms = 0.001 USDC
P = 90,000,001 micro-INR per USDC
q = 10,000 micro-INR
```

the plan yields ₹0.09, while the direct rational rail ceiling is ₹0.10.

The sweep equation is also unsafe when a SELL payout is locked. With:

```text
FP = RP = 10 USDC
reservedFiat = ₹950
grossFiat = ₹1,000
accounting price = ₹90
launch buffer = ₹10
```

an aggregate-backing-only cap permits a ₹90 sweep and leaves ₹910 against the ₹950 locked payout. The reservation-aware maximum is ₹40, leaving ₹960.

Additional findings:

- Rail ceiling is non-additive. Per-order spread can be zero while aggregate state-derived equity rises ₹0.01; a separate rail-adjustment attribution is mandatory.
- The plan’s ₹95/₹90 example sweeps ₹50, but the launch minimum buffer leaves only ₹40 sweepable unless a separately approved terminal-release rule applies.
- Snapshot safety is not future-FX safety. After the ₹40 sweep, a move from ₹90 to ₹92 creates a ₹10 deficit on 10 USDC of principal.
- `USER_WINS` identifies a legal result, not whether fiat did not move, was returned, left the channel, or moved partially. Each cash fact needs a distinct journal and restitution source.
- A paid-but-stuck BUY can be force-completed only on verified receipt; a refund/cancel path requires verified nonpayment or return.
- An `externalReferenceHash` argument without a consumed-reference registry is not idempotency.
- Sweeps and top-ups need immutable, domain-separated settlement identities and complete gross-flow attribution.

### 5. Storage append, initializer, compatibility, and migration

Exact live source recovery closes the source-provenance question. The required v2 safety evidence remains absent:

- no final machine-readable old-versus-new storage diff proving top-level append from root 22 and no nested-layout mutation;
- no one-time versioned initializer tied to chain, Diamond, baseline hash, policy/build manifests, and expected legacy values;
- no migration epoch/root, per-record import commitment, expected/imported aggregate totals, cursor, finalization, or rollback/abort state;
- no complete selector Add/Replace/Remove manifest with expected old facet/codehash and post-cut verification;
- no legacy-state truth table for every enum, zero value, partial order, reservation, risk, dispute, limit window, and channel status;
- the block `44,795,931` public token-liability snapshot reconciles, but there is no fresh cut-time snapshot tied to a proposed build and no secured bank reconstruction; and
- no full fork-cut rehearsal and independent audit of the actual proposed implementation.

The checked-in upgrade script’s Add/Replace-only behavior and zero initializer are not an adequate migration mechanism.

The checked-in subgraph’s event topic and return tuple are also incompatible with the byte-proven target. Indexing compatibility is a deployment dependency, not evidence that storage or accounting is safe.

## Binding amendments

These amendments are conditions precedent to reconsideration. They are not findings that an implementation exists.

### A. Fairness, determinism, and liveness

1. **Economic-operator domain.** Define the fairness unit and routing domain. All wallets and channels controlled by one approved economic operator share accepted-service history, virtual finish, offers, cooldowns, limits, and concurrency. Preserve history through wallet rotation and revocation.
2. **Accepted-service ledger.** Store accepted USDC additively and idempotently. In integer virtual units, acceptance must atomically apply an update equivalent to:

   ```text
   accepted_i += U
   ViQ := max(current ViQ, current governed domainFloorQ) + 4*U
   ```

   An assignment-time `commitFinish` is an audit forecast only and must never overwrite later accepted service. Use serialization, a domain version, or compare-and-swap.
3. **Separate offers.** Store reversible soft exposure separately from accepted service. `openOffer` equals the exact sum of live slots and releases once on accept, cancellation, expiry, ineligibility, or canonical reorg replacement.
4. **Canonical universe and witness.** Enumerate all candidates through complete pagination at one finalized block/hash. Canonically collapse channels, record the universe count and root, and forbid hidden “first N” truncation. Define versioned leaf schemas for operator, channel, eligibility, exclusion, cooldown, offer, limit, inventory, and fairness prestate. Retain a privacy-minimized, content-addressed, write-once witness long enough for independent replay; a root without its leaves proves integrity, not reproducibility.
5. **Canonical decision envelope.** Use typed, versioned encoding committing chain ID, Diamond, order, round, routing domain/epoch, state block number and hash, validity, quote, policy/build hashes, sequence, universe root/count, eligibility/prestate root, ordered candidates/channels/ranks, lease schedule, witness content identifier, and output root. The contract recomputes and consumes the envelope.
6. **Timing state machine.** Use half-open lease intervals and enforce:

   ```text
   validUntil <= quoteDeadline
   validUntil >= assignedAt + 3*leaseStep + minimumFinalAcceptanceWindow
   assignmentTTL >= 3*leaseStep + minimumFinalAcceptanceWindow
   ```

   `minimumFinalAcceptanceWindow` is a positive duration in seconds, governed from measured propagation, inclusion, confirmation, and operator-response SLOs. Its value and change process are policy; its units, positivity, and enforcement are binding. If the runway is unavailable, requote or cancel; do not create the round.
7. **Exact-four policy.** Either keep exact-four with an explicit no-service state and a readiness gate under which at least four order-capable economic operators remain after removal of any governed set of `F` correlated failure domains, for each enabled route and supported notional band, or legislate a separate variable-cardinality mechanism whose weight, leases, solvency exposure, and vectors depend on actual cardinality. No silent partial fallback.
8. **Bounded nonresponse recovery.** Rank-0 opportunity and misses are event-sourced. Use mandatory rotation, cooldown/exclusion rules, and bounded cohort expansion. A new round requires actual expiry or an on-chain-recorded all-ineligible condition.
9. **Anti-grinding.** Apply deterministic operator rotation/concentration bounds before a final domain-separated hash tie-break. Test adversarial order identifiers.
10. **Re-entry and inventory.** Clamp at the operator level to a monotone domain/epoch floor. Inventory remains a secondary tie-break; target ratios and tolerances are policy.

### B. Solvency, custody, and limits

11. **Atomic hard acceptance.** Recheck account/channel status, quote, lease, state age/hash, liquidity, principal, fiat, deficit, reconciliation, limits, concurrency, and migration flags at acceptance. Reserve and consume limits once in checks-effects-interactions order.
12. **No exposure escape.** Unstake, withdrawal, slash, channel migration, termination, or sweep must fail while any live order, offer, reservation, risk, dispute, principal, deficit, reconciliation, or migration exposure can be impaired.
13. **Custody floor.** Enforce:

   ```text
   actual USDC custody >= merchant token liabilities
                          + user escrow liabilities
                          + protocol token liabilities
   ```

   Track any surplus separately and make it non-spendable until reconciled. Pin canonical non-rebasing USDC and require exact transfer balance deltas, or explicitly account for received amounts.
14. **Limits.** Define daily/monthly window semantics, timezone, boundary inclusivity, cancellation release, dispute treatment, and migration behavior. Acceptance consumes a limit exactly once; assignment does not pretend to consume collateral.

### C. Accounting, FX, disputes, and reconciliation

15. **Direct rational rail rounding.** For USDC atoms `U`, price `P`, scale `D=1,000,000`, and rail quantum `q`:

   ```text
   BUY(U,P)      = q * ceil(U*P/(D*q))
   SELL(U,P)     = q * floor(U*P/(D*q))
   Required(U,P) = q * ceil(U*P/(D*q))
   ```

   Use full-precision multiplication, explicit modes, bounded inputs, and reject a zero-rounded SELL.
16. **Equity attribution.** State-derived equity is authoritative. Journal quote spread, aggregate rail adjustment, FX revaluation, top-up/capital, sweep, correction, reversal, and migration separately. Emit pre/post backing or the exact adjustment.
17. **Reservation-safe sweep.** With `R(x,p)=Required(x,p)`:

   ```text
   obligationFloor = max(
       R(FP, accountingOrStressPrice),
       reservedFiat + R(FP - reservedPrincipal, accountingOrStressPrice)
   )
   sweepable = max(grossFiat - obligationFloor - safetyBuffer, 0)
   ```

   No sweep during stale pricing, deficit, reconciliation-required state, unresolved cash treatment, or incomplete migration. A governed stress/high-water policy and delay are required.
18. **Dispute cash facts.** Separate legal winner from `FIAT_NOT_SENT_OR_RETURNED`, `FIAT_LEFT_CHANNEL`, and bounded partial movement. Bind an evidence commitment and restitution source. Each branch defines exact changes to gross fiat, fiat principal, merchant liquidity, risk, escrow, custody, and principal target.
19. **Replay-safe reconciliation.** Consume a high-entropy, globally domain-separated settlement identity binding chain, Diamond, kind, currency, channel, amount, and external system. Record immutable correction lineage. A reference affects state at most once.
20. **Gross-fiat identity.** Preserve:

   ```text
   Gclose = Gopen
            + BUY receipts + top-ups + reversals + migration-in + corrections-in
            - SELL payouts - sweeps - migration-out - corrections-out
   ```

   Preserve source-channel attribution. Excess top-up is capital/buffer, not trade spread.
21. **FX and deficit policy.** Pin source, freshness, deviation, accounting/stress price, high-water behavior, sweep delay, buffer, and deficit SLA. A price update that creates a deficit atomically freezes the affected channel.

### D. Diamond storage, initialization, compatibility, and migration

22. **Exact baseline.** Generate a machine-readable storage/selector/codehash manifest from commit `aa6f802…` and the pinned live Diamond. Preserve every existing root and nested member; append new top-level fields starting at root 22. No field insertion, deletion, reordering, or type change.
23. **Versioned initializer.** One-time initializer state must assert chain ID, Diamond, old layout/selector/codehash manifest, expected prestate, new policy/build hashes, and version. A second call and any wrong-baseline call revert without state change.
24. **Migration state machine.** Store migration epoch/root, expected aggregate totals, per-record source/import commitment and version, imported totals, cursor, status, and finalization. Keep routing/value movement paused. A partially imported record cannot become active.
25. **Conservation.** Migration conserves token custody, merchant liabilities, escrow, gross fiat, fiat principal, reservations, risk, limits, target, and cumulative flows. A record with any prohibited exposure cannot migrate.
26. **Selector cut.** Enumerate Add, Replace, and Remove; bind every selector to its expected old facet/codehash; reject collisions and stale assumptions; run post-cut loupe/codehash/initializer/storage sentinel checks.
27. **Legacy truth table.** Specify and test every existing enum value, zero/default, pending/approved/terminated channel, unstake state, partial order, reservation, risk, dispute, limit window, and duplicate guard. Tests must compile against and match the exact source generation.

### E. Reliability, Sybil resistance, and privacy

28. **Privacy-preserving operator credential.** Use a revocable, portable operator credential/nullifier without putting civil identity on-chain. Govern issuer, collusion, linkage, appeal, revocation, and rotation.
29. **Spam boundary.** Add bounded open orders per user plus a reviewed BUY bond/fee or authenticated rate limit. Create/cancel/expire/reorg transitions are idempotent and cannot leak offer counters.
30. **Verifiable allocator.** Run independent deterministic replicas and providers in shadow; alarm on trace-root divergence. Before production, provide either a verifiable/on-chain ranking proof or explicitly legislate a trusted allocator with signer revocation, censorship SLO, immutable commitments, and bounded user escape.
31. **Failure containment.** Require a finalized durable cursor, block-hash rewind, provider disagreement handling, nonce reconciliation, bounded retry/dead letter, KMS/signer failover, circuit breaker, accepted-order timeout, and user cancellation/refund independent of helper availability.
32. **Privacy minimization.** Add no plaintext bank, UPI, Telegram, or civil-identity data to calldata, storage, events, traces, logs, metrics, errors, backups, or decision ledgers. Use opaque high-entropy channel IDs and access-controlled encrypted off-chain data. Low-entropy hashes are not anonymization.
33. **Legacy privacy disposition.** Inventory irreversible existing plaintext, notify affected parties as legally required, plan handle/credential rotation, and obtain independent legal/privacy approval. Migration cannot erase public chain history.

## Implementation invariants

Any future implementation must make these executable and continuously checked:

1. USDC atoms and micro-INR are never added; every conversion binds a price, version, and time/block.
2. Direct rail bounds hold:

   ```text
   BUY*D >= U*P and (BUY-q)*D < U*P
   SELL*D <= U*P and (SELL+q)*D > U*P
   ```

3. `usdcLiquidity + sum(fiatPrincipalUsdc) == merchantPrincipalTargetUsdc`.
4. `reservedUsdc + riskUsdc <= usdcLiquidity`.
5. `reservedPrincipalUsdc <= fiatPrincipalUsdc`.
6. `reservedFiat <= grossFiat`.
7. Actual token custody never falls below classified token liabilities; unsolicited surplus never becomes principal.
8. Accepted-service totals and virtual finish are idempotent and monotonically nondecreasing under canonical acceptances.
9. A canonical acceptance increases accepted service exactly once; cancellation/expiry never erases it.
10. One order has at most one active round; rounds and deadlines are monotone; one decision ID is consumed once.
11. The privacy-minimized canonical witness leaves remain available under their content identifier, validate against the committed finalized block/hash and roots, and let an independent replica reproduce the candidate universe, exclusions, prestate, and output.
12. Open-offer exposure equals live slots and releases exactly once.
13. No acceptance occurs outside quote, lease, decision, state-age, or policy validity.
14. Hard reserves and limits are established before any external interaction and released or consumed exactly once.
15. Gross fiat satisfies the complete flow identity; every delta has one classified journal source.
16. Post-sweep gross fiat is at least the reservation-aware obligation floor plus buffer at the pinned governed price.
17. No sweep occurs while any freeze predicate is true.
18. Reconciliation identities and correction lineages are immutable and replay-safe.
19. Every dispute outcome identifies the verified fiat fact and funding source; no journal fabricates bank cash.
20. Migration conserves every aggregate and cannot activate a partial import.
21. An initializer/version/migration batch cannot be replayed.
22. User escape from an unaccepted order does not depend on helper, database, RPC, or signer availability.
23. Wallet splitting under one operator credential does not increase allocation weight, offers, limits, or concurrency.
24. No new raw payment or identity PII appears on-chain or in operational telemetry.
25. Every indexer event topic and return tuple exactly matches the byte-proven target ABI; deterministic replay from the configured start block has no unexplained omission or decode divergence.

## Required golden vectors and adversarial suites

### Fairness and determinism

- Two concurrent offers of 10 and 12 USDC from the same base, accepted B then A and A then B; both end at additive service 22, never regress, and duplicate acceptance is idempotent.
- Reproduce the admitted literal `48m -> 40m` failure and prove the amended path reaches `88m`.
- Equal-state candidate permutation yields one canonical order and cross-language decision hash.
- Order-ID/hash grinding over many identifiers cannot concentrate rank 0 beyond the governed bound.
- Four nonresponsive low-finish merchants plus a responsive higher-finish fifth cannot loop forever.
- Current two-merchant, three-merchant, four-merchant, and failure-domain-removal readiness states have explicit outcomes for each enabled route and notional band.
- Quote at `t=0`, assignment at `t=20`, rank-3 unlock at `t=65`, and quote expiry at `t=60` must reject or requote before creating an invalid round.
- For `validUntil - assignedAt - 3*leaseStep`, test one second below, exactly at, and one second above `minimumFinalAcceptanceWindow`; test zero and every governed parameter-change boundary.
- Every second around lease steps 0/15/30/45 and TTL 90 uses the specified half-open boundary.
- New entrant, returning operator, wallet rotation, dust-capacity domain-floor, and epoch changes preserve history without windfall.
- Multiple channels per operator, channel permutations, and complete pagination yield the same operator-level result.
- Same block number/different block hash, reorg, stale state, unavailable/malformed witness, altered witness leaf/root/content identifier, altered channel, altered rank, altered quote, duplicate decision, and one-bit manifest changes fail deterministically.
- Four merchants each with capacity 100 and eight soft 100-unit orders demonstrate that offers do not imply acceptability; no hard reserve is overdrawn.
- Daily/monthly boundaries, cancellation, dispute, and migration consume/release limits exactly once.
- Report global fairness, comparable-eligible-exposure fairness, eligibility time, capacity binding, rank exposure, nonresponse, and unresolved orders separately.
- Repeat at least 100,000 adversarial decisions and the required 10,000-decision independent transaction-disabled shadow gate.

### Accounting, custody, and disputes

- `U=1,000`, `P=90,000,001`, `q=10,000`: BUY and Required equal `100,000` micro-INR, not `90,000`.
- Exact rail boundary, one rational unit below, and one above for BUY, SELL, and Required.
- Same-price aligned and unaligned round trips bound dust by the declared rail rule.
- Add 1 USDC principal to 1 USDC at ₹90.000001 and attribute the ₹0.01 aggregate rail adjustment.
- ₹95/₹90, 100-USDC cycle: target stays 100 USDC; with launch minimum buffer, only ₹40 of ₹50 is swept unless a separate terminal-release policy applies.
- `FP=RP=10`, locked payout ₹950, gross ₹1,000, price ₹90: permit at most ₹40; reject ₹40.01/₹41.
- In the separate unreserved cycle with `G=₹950` and `FP=10`, a ₹40 sweep leaves ₹910; price ₹90→₹92 then records a ₹10 deficit and freezes the channel. This is not the `FP=RP`, locked-₹950 reservation vector above.
- SELL cancellation, merchant win, fiat-not-sent/returned user win, fiat-left-channel user win, partial movement, slash, and duplicate resolution each have exact journals.
- Paid-but-stuck BUY verified-receipt completion and verified-refund cancellation are mutually exclusive and replay-safe.
- Duplicate top-up/sweep/correction identity and same identity with changed amount/channel/kind fail before state change.
- Top-up below/equal/above deficit classifies excess as capital/buffer, not trade spread.
- Unsolicited token transfer, fee/short-receipt token, rebase-like behavior, and outbound transfer preserve liability coverage or reject.
- Unstake/withdrawal with each of reservation, risk, escrow, principal, order, dispute, offer, deficit, and reconciliation independently nonzero fails.
- Gross-fiat flow reconstruction closes exactly across BUY, SELL, top-up, sweep, reversal, correction, and migration.

### Storage, migration, reliability, Sybil, and privacy

- Sentinel values in every legacy root and representative nested member survive the cut and initializer.
- Wrong chain, Diamond, old manifest, policy/build hash, and second initializer call fail without writes.
- Every selector action and expected old codehash is checked; collisions, missing removals, and stale old facets fail.
- Each legacy enum/default/partial state is decoded identically before and after the cut.
- Migration with every exposure field independently nonzero fails; a clean batch conserves every aggregate; crash/retry cannot double import.
- Pinned fork cut, rollback/abort, restart at every batch boundary, and independent post-state reconstruction agree.
- Generate the subgraph ABI from the exact target source, replay the seven-field `OrderCreated` topic and 20-field `getOrder` tuple from the configured start block, and prove entity totals against direct chain reconstruction.
- One operator with one versus `k` wallets/channels receives one aggregate weight; credential rotation and revocation preserve service.
- Thousands of low-cost BUY create/cancel/reorg operations do not leak counters or violate honest-user escape SLOs.
- Omitted best candidate, permuted ranks, stale block, withheld transaction, stuck nonce, provider disagreement, KMS outage, queue duplicate, database loss, and multi-block reorg trigger deterministic recovery or safe stop.
- No raw bank/UPI/Telegram/civil-identity value appears in calldata, new storage, events, logs, traces, metrics, errors, backups, or decision records; low-entropy dictionary tests cannot recover a handle.

## Deployment and reconsideration gates

No gate may be waived by a favorable simulation alone. Reconsideration requires, in order:

1. final normative arithmetic, state-machine, decision-encoding, accounting, dispute, operator-identity, and privacy specifications;
2. machine-readable exact live baseline and reviewed append-only v2 layout beginning at root 22;
3. implementation of every binding amendment with matched tests;
4. fresh cut-time token-liability and secured bank/channel reconstruction tied to the proposed build, signed off independently;
5. complete selector/initializer/migration manifest and conservation proof;
6. unit, golden, property, stateful, fuzz, invariant, reorg, crash, Sybil, spam, and privacy suites with no unexplained failures;
7. full pinned fork-cut and migration rehearsal, including every legacy state class and restart boundary;
8. exact-target subgraph ABI/event/tuple correction and full deterministic replay against direct-chain totals, with the deployed artifact hash pinned;
9. at least two independent deterministic replicas producing identical decision/trace roots;
10. 10,000 consecutive representative transaction-disabled shadow decisions with zero unexplained divergence, zero stale/duplicate acceptance attempt, complete universe reconciliation, and published metrics;
11. capacity evidence that at least four order-capable approved economic operators remain after removal of any governed set of `F` correlated failure domains, for every enabled route and supported notional band, if exact-four is retained;
12. independent Solidity/Diamond storage, custody, accounting, financial-risk, mechanism, operational-security, and privacy review;
13. governance approval of every policy parameter and residual risk; and
14. a new Council vote under the same no-critical-objection rule.

Passing these gates is necessary, not automatically sufficient.

## Policy choices, not proven constants

This bill fixes the fairness unit as the approved economic operator and the allocation objective as accepted USDC. Wallet/credential splitting cannot multiply weight, and completed volume is separate risk/operations telemetry. The following remaining choices require governance and empirical/risk justification:

- exact four versus a separately specified variable cardinality;
- credential, related-control, rotation, and appeal rules that establish one economic operator without exposing civil identity;
- completed-volume, completion-rate, and settlement-quality telemetry and any hard risk/cooldown use that does not silently replace accepted-USDC fairness;
- offer weight `0.25`;
- lease step 15 seconds, TTL 90 seconds, quote life 60 seconds, and `minimumFinalAcceptanceWindow` in seconds;
- state age 20 blocks and confirmation/finality depth;
- maximum eight pending offers and one accepted order;
- re-entry cohort/epoch and cooldown/failure tiers;
- 50/50 BUY/SELL inventory target and tolerance;
- Jain thresholds 0.98/0.95 and which comparable cohort they measure;
- daily/monthly windows and order/concentration limits;
- correlated failure-domain taxonomy, the governed removable set `F`, route/notional coverage, and readiness reserve;
- BUY bond, fee, rate limit, and user escape SLO;
- credential issuer, appeal, revocation, portability, and privacy model;
- FX source, stress/high-water price, deviation, delay, deficit SLA, and loss bearer;
- sweep buffer 1%/₹10 and any terminal release;
- dispute evidence, partial-payment treatment, and restitution/slash authority; and
- retention, disclosure, reconciliation cadence, and dual-review controls.

Mathematically or mechanically testable requirements include unit separation, direct rail bounds, conservation, monotonic accepted-service updates, idempotency, replay rejection, candidate/output reproducibility, reservation coverage, migration conservation, and absence of new plaintext PII.

## Votes and minority opinions

### Final disposition

| Seat | Final verdict | Value-moving authority | Read-only/offline shadow |
| --- | --- | --- | --- |
| F — deterministic fairness author | REJECT | No | Yes |
| M — adversarial mechanism critic | REJECT | No | Yes |
| S — storage/custody | REJECT | No | Yes |
| A — accounting/rounding/FX/reconciliation | REJECT | No | Yes |
| R — reliability/Sybil/privacy | REJECT | No | Yes |

### Amendment motions

| Motion | F | M | S | A | R | Tally |
| --- | --- | --- | --- | --- | --- | --- |
| I — fairness and determinism amendments | Yes | Yes | No | Yes | No | 3–2 |
| II — accounting, custody, and storage amendments | Yes | Yes | No | Yes | No | 3–2 |
| III — reliability, Sybil, and privacy safeguards as a binding gate | Yes | Yes | No | Yes | No | 3–2 |
| IV — reject value movement; permit only disabled read-only/offline shadow/scaffolding | Yes | Yes | Yes | Yes | Yes | 5–0 |

Motions I–III are incorporated into this bill as conditions precedent by their 3–2 tallies. The tally is not represented as consensus or implementation certification.

After admission of the block `44,795,931` custody snapshot and verified subgraph blocker, every seat filed a supplemental addendum and expressly kept its verdict and Motion I–IV ballot unchanged.

Minority and qualified opinions:

- Seats S and R voted No on Motions I–III because the repairs are not implemented or proven. They accepted many provisions as the correct direction but refused to let proposed amendments read as passed safety evidence.
- Seat F rejects an improvised partial round. If exact-four is relaxed, a separate variable-cardinality mechanism must be legislated.
- Seat M supports bounded replacement/cohort expansion after nonresponse and requires global Jain to be separated from comparable-eligible-cohort metrics.
- Seat A modifies an unconditional custody equality into liabilities plus explicitly tracked surplus and rejects a blanket `USER_WINS` “exact inverse” without the verified fiat fact.
- Seat S accepts that a reviewed replacement can cure current source behavior in principle, but requires the pinned fork/storage/custody proof before any value movement.
- Seat R requires operator aggregation to use a privacy-preserving governed credential and rejects public raw candidate/payment identity traces.

There is no minority opinion favoring value-moving deployment.

## Evidence still missing

1. Final v2 source and a normative specification implementing every binding amendment.
2. Machine-readable live-to-v2 storage, ABI, selector, codehash, initializer, and policy/build manifests.
3. A fresh cut-time public-state/custody reconstruction tied to the proposed build and independently reproduced. The admitted block `44,795,931` snapshot currently reconciles `588,000,000` USDC atoms of custody to liabilities with zero delta, but is not migration or deployment authority.
4. Secured bank evidence and a channel-by-channel historical gross/principal/flow reconstruction.
5. A reviewed dispute cash-fact taxonomy, evidence standard, correction lineage, and loss/restitution policy.
6. A replay-safe reconciliation schema and complete migration state machine.
7. Complete candidate-universe pagination/block-hash protocol, versioned decision-witness leaf schemas, privacy-minimized content-addressed/WORM witness availability and retention, and cross-language decision encoding.
8. Operator credential, related-wallet linkage, rotation, revocation, appeal, and privacy governance.
9. Comparable-cohort fairness, nonresponsive-quartet, anti-grinding/rank-concentration, spam, outage, and user-escape results.
10. Justification for every policy parameter listed above.
11. A test suite that matches the exact recovered live source and a complete stateful/fuzz/invariant suite for v2.
12. Full pinned fork cut/migration/restart evidence and independent audits.
13. The required 10,000-decision independent transaction-disabled shadow record.
14. A corrected exact-target subgraph ABI/mapping, full start-block replay against direct-chain totals, and the actual hosted/deployed artifact identity.
15. A legacy payment-PII inventory, remediation decision, and independent legal/privacy approval.

Until this evidence is admitted and the critical seats affirmatively clear their objections, the verdict remains REJECT.
