# Base Sepolia V2 Diamond Upgrade Runbook

Status: **COUNCIL REJECT 5–0 — DORMANT CONTINGENCY ONLY**

Target: Base Sepolia chain `84532`, Diamond
`0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A`

This is a dormant gate specification, not a deployment instruction. The controlling
council bill, SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`,
was adopted unanimously 5–0 with verdict **REJECT**. It independently prohibits
every facet/initializer deployment, Diamond cut, migration, signature, broadcast,
and on-chain state change. Mainnet and production are out of scope.

No later section becomes executable merely because its technical checks can be
performed. A future council PASS under the same no-critical-objection rule, after
every binding amendment and reconsideration gate, is a prerequisite to any
value-moving work.

## Non-negotiable rules

1. Never run the original `DiamondInit` again. The live
   `s.config.initialized` flag is already true.
2. Never insert or reorder an existing `AppStorage` root, nested struct field, enum
   item, selector tuple, or event tuple.
3. Append new roots only after verified root slot `21`, beginning at slot `22`.
4. Preserve the 20-field legacy `Order` tuple. It has no `orderNumber`.
5. Do not derive financial migration values from gross `fiatBalance` alone.
6. Do not guess a role address, limit, price, buffer, timeout, rail quantum, or
   migration total.
7. A cut must be generated as an exact Add/Replace/Remove selector diff and reviewed
   against the 63-selector baseline.
8. The existing `scripts/upgrade.js` is **not an approved upgrade path**. It
   auto-classifies only selectors present in newly deployed facets, does not remove
   dropped legacy selectors, supplies no migration initializer, and can seed
   financial values from environment defaults.
9. Never log RPC credentials, environment contents, private keys, or payment data.
10. If any preflight value differs from the signed evidence pack, stop.
11. Do not deploy the checked-in subgraph against this Diamond until its ABI and
    mappings use the byte-proven seven-field `OrderCreated` event and 20-field
    `getOrder` tuple and a full start-block replay matches direct-chain totals.

## Council-controlled work boundary

Permitted now, only when transaction-disabled and non-signing:

- read-only source, runtime, selector, storage, state, and custody provenance;
- offline deterministic replay and simulation with no external state change;
- formula, golden-vector, property, fuzz-like, and invariant scaffolding;
- non-authoritative accounting reconstruction research; and
- shadow allocator output that is technically unable to sign, broadcast, authorize,
  reserve, accept, settle, sweep, top up, or migrate.

Forbidden by the current bill:

- any production or testnet value-moving canary;
- any Diamond cut, initializer, authoritative migration, or configuration write;
- assignment that can lead to acceptance, reservation, settlement, token transfer,
  sweep, top-up, or migration;
- representing an unreconciled entry as authoritative bank cash; and
- transaction signing, private-key use, broadcast, or any on-chain state change.

The binding-amendment categories are fairness/determinism/liveness; solvency, custody,
and limits; accounting, FX, disputes, and reconciliation; Diamond storage,
initialization, compatibility, and migration; and reliability, Sybil resistance,
spam control, failure containment, and privacy. All remain conditions precedent to
reconsideration, not approved semantics.

## Hard gates

The current REJECT means these rows cannot authorize execution. They are the minimum
evidence required before a new council vote; passing them is necessary, not sufficient.
For any future reconsideration they must describe one candidate commit and pinned
candidate block.

| Gate                            | Required evidence                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 provenance              | Signed source/runtime/selector/storage/fork record matching [`../provenance/PHASE0_BASELINE_2026-07-29.md`](../provenance/PHASE0_BASELINE_2026-07-29.md)                        |
| Council policy                  | Current verdict is REJECT 5–0. A later bill must PASS under the same no-critical-objection rule after every binding amendment is implemented and tested                         |
| Normative specification         | Final arithmetic, state machine, decision encoding, operator identity, dispute, accounting, FX, and privacy rules                                                               |
| Phase 1 reconciliation          | Every active channel is reconciled from order history and secured bank/merchant evidence, or frozen                                                                             |
| Principal snapshot              | Reviewed per-channel import, totals, final snapshot or Merkle root, and zero unexplained deficit                                                                                |
| Storage review                  | Machine diff proves all legacy roots, nested fields, offsets, types, and enum ordinals unchanged                                                                                |
| ABI/selector review             | Full ABI artifacts and exact Add/Replace/Remove manifest; no collision or unexplained selector                                                                                  |
| Test suite                      | Compile plus all unit, regression, storage, selector, replay, exact-four, lease, capacity, unstake, migration, dispute, rounding, invariant, and fuzz-like tests pass           |
| Fork simulation                 | Complete atomic cut and initializer simulated at the candidate block; legacy orders and containment actions exercised                                                           |
| Security review                 | Independent Diamond/storage review and custody/accounting/dispute/rounding audit findings closed                                                                                |
| Independent replicas and shadow | At least two deterministic replicas agree; 10,000 transaction-disabled shadow decisions have zero unexplained divergence                                                        |
| Exact-target subgraph           | Correct ABI/event/tuple, deterministic full start-block replay against direct-chain totals, and pinned deployed artifact hash                                                   |
| Route readiness                 | At least four order-capable approved economic operators remain after removal of any governed set of `F` correlated failure domains, for every enabled route/notional band       |
| Sybil/privacy/legal             | Governed privacy-preserving operator credential, spam/user-escape controls, legacy PII disposition, and independent privacy/legal approval                                      |
| Operations review               | Helper/reconciler threat model, keys, two-step rotations, pause/revoke drills, monitoring, and bank-reconciliation procedures approved                                          |
| Ownership/config preflight      | Current owner, admin, token, pause state, prices, limits, order state, signer authority, and chain ID match the signed pack                                                     |
| Release approval                | Named approvers sign the exact source commit, build hashes, facet addresses, initializer address/calldata hash, cut hash, policy hash, reconciliation root, and candidate block |

Current disposition: the council verdict is REJECT, and the normative specification,
Phase 1 reconciliation, binding-amendment implementation, full suites, replicas,
10,000-decision shadow record, route readiness, audits, governance, and release
preflight are incomplete. Therefore **NO CUT, NO DEPLOY, NO SIGNING, NO BROADCAST,
and NO ON-CHAIN STATE CHANGE**.

## Required evidence bundle

Freeze one directory or signed release bundle containing:

- source commit and clean-worktree status;
- compiler long version and complete settings;
- baseline and proposed storage-layout JSON plus a reviewed diff;
- baseline and proposed ABI files with hashes;
- baseline and proposed selector manifests with explicit Add/Replace/Remove actions;
- creation and runtime bytecode hashes for every proposed facet and initializer;
- council bill hash and amendment-to-test traceability;
- canonical helper-policy JSON and `assignmentPolicyHash`;
- Phase 1 reconciliation import, totals, exceptions, approvals, and snapshot root;
- deterministic initializer input document, calldata, decoded round trip, and hash;
- fork block number/hash, simulation transcript, state diff, event diff, and test counts;
- corrected exact-target subgraph ABI/mapping, full replay evidence, direct-chain
  total comparison, and deployed artifact hash;
- owner/admin/role/config preflight captured at the candidate block;
- audit reports and closure evidence;
- execution, containment, monitoring, and communications owners.

Do not include bank strings, UPI identifiers, private keys, RPC URLs containing
credentials, or raw environment files.

## Stage 1 — read-only candidate evidence

1. Record the candidate Git commit. Require a clean worktree except for generated,
   reviewed release artifacts.
2. Compile with the locked Solidity version and settings. Reject any unexpected
   compiler download, setting change, metadata change, or unlinked library.
3. Re-run the local aa6 manifest. All seven baseline runtime attestations must still
   pass before comparing the proposed build.
4. Generate the complete storage diff. Existing roots `0–21` and all nested layouts
   must be byte-for-byte compatible. New roots must begin at `22`.
5. Generate ABI and selector artifacts deterministically. Confirm legacy selectors
   and tuple layouts, especially `getOrder(bytes32)`, are unchanged.
6. Map every council amendment and audit finding to its implementation and test.

Any mismatch stops the release.

## Stage 2 — future reconciliation and migration evidence (dormant)

This stage cannot initialize, migrate, or authorize bank cash under the current bill.
Only non-authoritative reconstruction research is permitted, using access-controlled
off-chain evidence.

1. Select a historical reconciliation cutoff in the secured offline dataset.
2. Replay indexed order history for each channel.
3. Compare reconstructed gross fiat with secured bank and merchant evidence.
4. Classify merchant fiat principal, gross fiat, protocol equity or deficit, and
   prior swept amounts.
5. Calculate each proposed merchant principal target in the non-authoritative
   reconstruction output as reconciled liquid USDC plus reconciled fiat principal.
6. Flag every unaudited or mismatched channel in that output as
   reconciliation-required and ineligible for future activation.
7. Canonicalize the import, bound it into reviewed batches, and produce a final
   snapshot or Merkle root with aggregate cross-checks.
8. Have independent reviewers sign the exact import hash/root.

Do not replace this process with a spread formula. Existing gross fiat does not prove
principal.

## Stage 3 — future cut-manifest requirements (dormant)

For every function selector:

1. Start from the exact 63-selector live manifest.
2. Compute the proposed selector from the canonical ABI signature.
3. Classify it as:
   - Add only if the live loupe returns the zero address;
   - Replace only if it is currently routed and the reviewed design intentionally
     changes its implementation;
   - Remove only if an explicit compatibility decision authorizes removal.
4. Reject duplicate selectors, selector collisions, empty selector arrays, and
   unexpected facet ownership.
5. Preserve all legacy selectors unless the signed plan explicitly removes one.
6. Bind the ordered cut array to its keccak256 hash and include a human-readable
   facet/signature/action table.

The generated cut must name exact deployed facet addresses. Before deployment those
address cells remain unresolved; before execution they must match verified runtime
hashes. Never use `scripts/upgrade.js` to infer this cut.

## Stage 4 — future v2 initializer requirements (dormant)

The current bill forbids generating live v2 initializer or migration calldata. The
blocked procedure in
[`V2_INITIALIZER_CALLDATA.md`](V2_INITIALIZER_CALLDATA.md) may be used only for
synthetic schema/golden-vector scaffolding until a future council PASS. Any future
completed record must:

- use a new initializer contract and a new append-only version guard;
- derive its function selector from the final compiled ABI;
- populate only reviewed values and reconciled snapshot commitments;
- preserve legacy configuration units and use explicit v2 fields for E6 pricing;
- decode back to exactly the signed field table;
- succeed once and fail on replay in local and fork tests;
- never call, route, or delegatecall the original `DiamondInit`.

The initializer and cut execute atomically in one `diamondCut` transaction. A failed
initializer must revert the entire cut.

## Stage 5 — transaction-disabled fork rehearsal

Pin the authorized Base Sepolia target at a recorded block and verify its block hash
with more than one provider for sensitive reads. This is a disposable local
simulation only: no signing, broadcast, external state change, or value-moving
canary. Under the current REJECT, baseline reproduction and synthetic candidate
fixtures are permitted; live v2 values, authoritative reconciliation imports, and
executable external payloads are not. The following is a future reconsideration
checklist.

The rehearsal must:

1. Assert chain ID `84532`, target Diamond, owner, admin, token, live facet addresses,
   63 selectors, and all runtime hashes before impersonating any role.
2. Capture pre-cut raw roots, representative nested storage, public reads, token
   custody, aggregate liabilities, open escrow, reservations, risk, and every
   in-flight order class.
3. Reproduce the intended pause/drain/freeze state.
4. Deploy the exact candidate bytecode only inside the disposable fork.
5. Simulate the exact ordered cut and exact v2 initializer calldata.
6. Assert one-shot initialization and replay failure.
7. Assert post-cut loupe routing equals the proposed manifest.
8. Assert roots `0–21`, legacy tuples, enums, representative merchant/channel/order
   reads, and legacy completion/cancellation/dispute paths are preserved.
9. Import the exact reconciliation snapshot and prove all principal and custody
   invariants.
10. Run exact-four, replay, lease, stale-block, capacity, rounding, dispute,
    unstake, migration, pause, signer-revoke, and containment scenarios.
11. Exercise a reviewed reverse-selector or forward-fix containment plan. Do not
    pretend that restoring code reverses storage already written.
12. Archive exact pass/fail counts and the state/event diff.

Any unexplained state change, log, rounding delta, selector, storage write, or custody
delta blocks execution.

## Stage 6 — future live preflight (dormant)

Immediately before any broadcast:

1. Re-read chain ID and block hash.
2. Re-run exact runtime, loupe, selector, storage-root, custody, and state-count
   checks at one pinned block.
3. Confirm the Diamond owner is the approved execution authority and the proposed
   sender can execute the cut. Confirm platform admin and operational roles
   separately; never assume they are the same.
4. Confirm the target is Base Sepolia and not mainnet or production.
5. Confirm new orders are paused and unsafe in-flight states have been settled,
   drained, or explicitly covered by the reviewed migration.
6. Confirm current configuration equals the signed input document. Abort on any
   drift.
7. Confirm every proposed facet and initializer creation/runtime hash matches the
   signed build. At this pre-deployment gate, addresses remain unresolved.
8. Decode the unsigned cut template and initializer values again. Its address cells
   remain unresolved until the authorized deployments; all other fields must match
   the signed release bundle.
9. Obtain the approval that would permit Base Sepolia facet/initializer deployment
   only after a future council PASS, without exposing signer material.

No approval may be carried forward from an earlier block after configuration,
ownership, implementation, reconciliation, or code changes.

## Stage 7 — future execution (prohibited)

Execution is prohibited by the current REJECT regardless of technical test results.
Only after all reconsideration gates and a new council PASS could a release owner,
under a separately approved release, proceed without printing secrets:

1. deploy only the signed facet and initializer creation bytecode, then record the
   transaction hashes, receipts, addresses, code hashes, and source-verification
   results;
2. resolve the cut manifest address cells and prove each deployed runtime matches its
   signed hash;
3. repeat chain ID, block hash, target runtime/loupe, owner, admin, pause,
   configuration, custody, and in-flight-state preflight; stop on any drift;
4. decode the final transaction payload and obtain approval over the exact ordered
   cut hash, initializer address, initializer calldata/hash, and current preflight;
5. execute the one approved `diamondCut`, then record its transaction hash, receipt
   block/hash, and emitted `DiamondCut` and v2 initialization/migration events.

There must be one reviewed v2 initialization call. Never split an atomic cut and
required initializer into separate transactions, and never call the original
initializer.

## Stage 8 — future post-cut verification (dormant)

Before unpausing or enabling helper writes:

1. Verify receipt success and canonical block inclusion.
2. Re-read the full loupe and compare all selectors/facets with the signed manifest.
3. Verify every facet and initializer runtime hash.
4. Re-run raw storage and legacy ABI regression reads.
5. Verify the v2 version guard, roles, policy hash, prices/units, limits, buffers, and
   reconciliation root.
6. Reconcile token custody, merchant liquid USDC, user escrow, protocol balances,
   fiat principal, reservations, risk, and deficit flags.
7. Confirm legacy orders remain on legacy paths and new orders are helper-managed.
8. Keep helper transaction sending disabled until shadow/fork comparisons and
   monitoring are green.
9. Exercise pause, assigner revoke, reconciler rotation, and user SELL cancellation.
10. Publish the sanitized ABI, selector manifest, storage diff, initializer-calldata
    record, policy hash, transaction hashes, known trust assumptions, and monitoring
    links.

Unpause and canary activation require a separate signed decision and soak criteria.

## Containment and rollback

The first response to a defect is pause new orders and revoke the helper, not a
destructive storage rewrite.

- Preserve cancellation/refund for unaccepted SELL orders.
- Preserve resolution paths for accepted orders even when a merchant later becomes
  offline, disputed, or blacklisted.
- Keep the exact pre-upgrade facet artifacts and selector manifest.
- Restore old facets only after a fork proves compatibility with every new storage
  write. Prefer a reviewed forward fix after initialization or migration has written
  state.
- Never rerun initialization, zero mappings, reorder storage, or replay migration
  batches as a rollback.
- Treat any unexplained custody or principal delta as an incident; pause and preserve
  evidence.

## Execution record template

Leave every value unresolved until produced by the final gated release:

| Record                              | Value                     |
| ----------------------------------- | ------------------------- |
| Candidate source commit             | `<unresolved>`            |
| Candidate block number/hash         | `<unresolved>`            |
| Council bill hash                   | `<unresolved>`            |
| Reconciliation snapshot/root        | `<unresolved>`            |
| Policy document hash                | `<unresolved>`            |
| Storage-diff hash                   | `<unresolved>`            |
| ABI bundle hash                     | `<unresolved>`            |
| Selector/cut manifest hash          | `<unresolved>`            |
| New facet addresses/runtime hashes  | `<unresolved>`            |
| V2 initializer address/runtime hash | `<unresolved>`            |
| V2 initializer calldata/hash        | `<unresolved>`            |
| Fork report hash and test counts    | `<unresolved>`            |
| Audit approvals                     | `<unresolved>`            |
| Deployment transactions             | `<none — not authorized>` |
| Diamond cut transaction             | `<none — not authorized>` |
