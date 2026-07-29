# V2 Initializer Calldata Record

Status: **COUNCIL REJECT 5–0 — BLOCKED PROCEDURE ONLY; NO V2 CALLDATA**

The controlling council bill, SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`, is a
unanimous 5–0 REJECT. It forbids a Diamond cut, initializer, authoritative migration,
transaction signing, broadcast, and on-chain state change. It also forbids treating
this architecture as authority for a value-moving testnet canary.

There is no reviewed v2 initializer implementation, final ABI, deployed initializer
address, reconciled migration snapshot, council PASS bill, or signed financial
configuration. Consequently this document intentionally does not publish or imply
executable v2 calldata. Only synthetic, transaction-disabled schema and golden-vector
scaffolding is permitted.

## Historical initializer — decode only, never replay

The original Base Sepolia initialization occurred in:

| Item        | Historical value                                                     |
| ----------- | -------------------------------------------------------------------- |
| Diamond     | `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A`                         |
| Initializer | `0x2CC9130bf944a5c010063817C2cC3D24D18210C0`                         |
| Block       | `44,359,818`                                                         |
| Block hash  | `0xb8aa31dac6e43032fcc3cc45e347e4135e2582f609d57e5adde59bfde207d439` |
| Transaction | `0x6144084a2cf1571ad7ec5d9751664294e57d3c2fee52ed3fe17fa59faa4794fb` |
| Function    | `init(address,uint256,uint256,uint256,uint256,uint256,uint256)`      |
| Selector    | `0x4b3e9232`                                                         |

Exact historical calldata:

```text
0x4b3e9232000000000000000000000000a50e77ae17f290cfb0e2f29b4f2d9d0071cb6d630000000000000000000000000000000000000000000000000000000011e1a3000000000000000000000000000000000000000000000000000000000023c3460000000000000000000000000000000000000000000000000000000001718c7e00000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000005a0000000000000000000000000000000000000000000000000000000000000258
```

| Argument                          | Decoded value                                |
| --------------------------------- | -------------------------------------------- |
| `_usdcToken`                      | `0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63` |
| `_minMerchantStakeUsdc`           | `300,000,000`                                |
| `_defaultChannelDailyLimitUsdc`   | `600,000,000`                                |
| `_defaultChannelMonthlyLimitUsdc` | `6,200,000,000`                              |
| `_buyPriceInrPerUsdc`             | `95`                                         |
| `_sellPriceInrPerUsdc`            | `90`                                         |
| `_disputeWindowSeconds`           | `600`                                        |

This calldata is historical evidence only. `s.config.initialized == true`; the
original initializer must never be used as `_init`, called directly through the
Diamond, registered as a facet, or invoked from a new initializer.

## V2 design boundary

Only after every reconsideration gate and a future council PASS could a final v2
initializer be considered. Any such future initializer would have to:

- be a new contract with a distinct, append-only one-shot version guard;
- leave the original `PlatformConfig.initialized` field unchanged;
- write only storage proven to begin at root slot `22` or later;
- preserve every legacy root, nested field, enum, selector, and tuple;
- bind configuration to the council PASS bill and signed risk review;
- bind accounting initialization to the Phase 1 reconciliation snapshot;
- emit enough non-sensitive events to reproduce the migration;
- be executed exactly once as the initializer of the reviewed atomic Diamond cut;
- revert the whole cut on any invalid input or accounting invariant;
- reject replay and partial/batch replay.

The actual function name, canonical parameter order, Solidity widths, array/batch
encoding, and migration commitment are implementation outputs. They must be derived
from the final compiled ABI, not copied from this planning table.

## Candidate field provenance table

The architecture plan identifies the following inputs or initialized fields. A final
initializer may group them into structs or split bounded reconciliation imports, but
every value needs the listed authority. “Observed chain state” is not financial
approval.

| Candidate field                                 | Kind                                           | Sole acceptable source                                                                               | Current value |
| ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| V2 initialization version/guard                 | version                                        | Final reviewed implementation                                                                        | unresolved    |
| Chain ID and Diamond binding                    | typed identity                                 | Runtime assertion plus signed release record                                                         | unresolved    |
| Old layout/selector/codehash manifest           | `bytes32` commitment                           | Exact aa6/live machine manifest                                                                      | unresolved    |
| Expected legacy prestate                        | typed commitment                               | Pinned candidate-block state manifest                                                                | unresolved    |
| New build manifest hash                         | `bytes32`                                      | Final compiled and reviewed build bundle                                                             | unresolved    |
| New policy manifest hash                        | `bytes32`                                      | Future PASS bill plus canonical governed policy                                                      | unresolved    |
| `orderAssigner`                                 | address                                        | Approved helper-key/KMS role record                                                                  | unresolved    |
| `assignmentPolicyHash`                          | `bytes32`                                      | Hash of canonical, signed helper-policy JSON                                                         | unresolved    |
| `assignmentTtl`                                 | duration                                       | Council PASS bill plus signed operations/risk config                                                 | unresolved    |
| `acceptanceLeaseStep`                           | duration                                       | Council PASS bill plus signed operations/risk config                                                 | unresolved    |
| `maxStateAgeBlocks`                             | block count                                    | Council PASS bill plus provider/reorg review                                                         | unresolved    |
| `maxPendingOffersPerMerchant`                   | count                                          | Council PASS bill plus capacity/load review                                                          | unresolved    |
| `revenueReconciler`                             | address                                        | Approved independent reconciliation role record                                                      | unresolved    |
| `buyPriceE6`                                    | E6 price                                       | Deterministic conversion from the legacy price at the candidate block, then signed price/risk review | unresolved    |
| `sellPriceE6`                                   | E6 price                                       | Deterministic conversion from the legacy price at the candidate block, then signed price/risk review | unresolved    |
| `quoteValidFor`                                 | duration                                       | Signed price/risk review                                                                             | unresolved    |
| `fiatRailQuantum`                               | fiat atoms                                     | Signed rail/currency specification                                                                   | unresolved    |
| `buySafetyBufferBps`                            | basis points                                   | Signed custody/risk review                                                                           | unresolved    |
| `fiatSweepBufferBps`                            | basis points                                   | Signed treasury/risk review                                                                          | unresolved    |
| `maxPriceDeviationBps`                          | basis points                                   | Signed oracle/risk review                                                                            | unresolved    |
| `maxActiveAcceptedOrdersPerMerchant`            | count                                          | Signed capacity/risk review                                                                          | unresolved    |
| `minBuySafetyBufferUsdc`                        | token atoms                                    | Signed custody/risk review                                                                           | unresolved    |
| `minFiatSweepBuffer`                            | fiat atoms                                     | Signed treasury/risk review                                                                          | unresolved    |
| Migration epoch/root                            | typed version and commitment                   | Final migration state-machine specification and signed Phase 1 dataset                               | unresolved    |
| Expected aggregate totals                       | typed accounting totals                        | Signed Phase 1 reconstruction and conservation proof                                                 | unresolved    |
| Imported totals/cursor/status/finalization      | append-only migration state                    | Final reviewed migration implementation                                                              | unresolved    |
| Per-record source/import commitment and version | bounded import identity                        | Canonical Phase 1 record set and replay-safe migration schema                                        | unresolved    |
| Reconciliation snapshot/root                    | `bytes32` or implementation-defined commitment | Canonical Phase 1 import signed by reconciliation reviewers                                          | unresolved    |
| Per-merchant principal targets                  | bounded import                                 | Phase 1 reconciliation dataset                                                                       | unresolved    |
| Per-channel principal/reservation/sweep state   | bounded import                                 | Phase 1 reconciliation dataset                                                                       | unresolved    |
| Per-channel reconciliation-required flags       | bounded import                                 | Phase 1 reconciliation exceptions                                                                    | unresolved    |
| Legacy-order cutoff/cutover marker              | block/order marker                             | Candidate block plus final migration design                                                          | unresolved    |

The architecture plan’s launch values are recommendations, not authorization. Do not
substitute them for a council bill, signed risk configuration, or reconciliation
record.

For legacy prices, the planned deterministic unit conversion is:

```text
v2PriceE6 = legacyIntegerPriceAtCandidateBlock * 1,000,000
```

The generator must read the legacy values at the pinned candidate block, require them
to be nonzero and equal to the signed input record, check multiplication bounds, and
then require explicit approval of the resulting E6 values. It must not silently
hardcode the values observed in the Phase 0 snapshot.

## Canonical input document

No live input may be resolved into calldata under the current REJECT. For synthetic
tests, use unmistakable dummy values and a generator that refuses signing and
broadcast. A future approved generator would first require a non-secret,
machine-readable document with all fields resolved and signed. The exact schema would
follow the final ABI and contain at least:

```text
schemaVersion: <reviewed integer>
chainId: 84532
diamond: 0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A
candidateBlock:
  number: <resolved>
  hash: <resolved>
sourceCommit: <resolved>
compilerLongVersion: 0.8.24+commit.e11b9ed9
councilBillHash: <resolved>
policyDocumentHash: <resolved>
reconciliationSnapshotRoot: <resolved>
initializer:
  contractName: <resolved>
  artifactHash: <resolved>
  runtimeHash: <resolved>
  address: <resolved only after authorized deployment>
  functionSignature: <derived from final ABI>
values:
  <one typed entry for every final ABI argument>
```

Addresses must be checksummed. Integers must be base-10 strings in the input document
and encoded as exact unsigned integers, never JavaScript floating-point numbers.
Arrays and reconciliation batches must use a specified canonical ordering and reject
duplicates.

## Blocked deterministic generation procedure

0. Refuse live-value encoding while the council verdict is REJECT. Current scaffolding
   may operate only on synthetic fixtures and must expose no signing or broadcast path.
1. After a future council PASS, require the exact candidate source commit and a clean
   release worktree.
2. Compile with the locked compiler/settings and hash the final initializer artifact,
   creation bytecode, runtime bytecode, and ABI.
3. Load exactly one initializer function from that artifact. Reject overloaded or
   ambiguous initialization entrypoints.
4. Validate `chainId == 84532` and the exact Diamond address.
5. Pin the candidate block by number and hash; reject a provider returning a
   different hash.
6. Verify the live aa6 runtime, 6 facets, 63 selectors, roots `0–21`, owner, admin,
   token, configuration, custody, and state counts before using any observed value.
7. Verify the council bill is PASS and the input document accounts for every binding
   amendment.
8. Verify the signed Phase 1 reconciliation root and every aggregate import total.
9. Resolve each ABI argument only from the canonical input document. Reject missing,
   extra, zero-forbidden, duplicate, out-of-range, or defaulted values.
10. Encode with the final artifact’s ABI encoder.
11. Decode the generated bytes with the same ABI and compare every typed value with
    the canonical input document.
12. Hash the calldata and store both bytes and hash in the signed release bundle.
13. Simulate the exact cut plus initializer on the pinned OP fork. Assert all writes,
    events, principal invariants, custody invariants, and replay failure.
14. Have an independent reviewer decode the bytes with a separate tool and sign the
    selector, field table, calldata hash, initializer address, cut hash, block hash,
    and simulation report.

Under the current bill, steps that would resolve or encode live v2 values remain
disabled. Any permitted scaffolding must use synthetic values, be offline/read-only,
load no deployer key, expose no signer or broadcast transport, infer nothing from an
`.env` default, and print no RPC credential. A future generator would remain
offline/read-only after gathering pinned public state.

## Required generated record

Only after every binding amendment, implementation, reconciliation, test/fork/shadow
gate, independent review, governance approval, and a new council PASS could this
section be populated:

| Output                                     | Value                    |
| ------------------------------------------ | ------------------------ |
| Final v2 initializer function signature    | `<unresolved>`           |
| Function selector                          | `<unresolved>`           |
| Initializer artifact/ABI/runtime hashes    | `<unresolved>`           |
| Authorized deployed initializer address    | `<unresolved>`           |
| Canonical input document hash              | `<unresolved>`           |
| Reconciliation snapshot/root               | `<unresolved>`           |
| Exact calldata                             | `<intentionally absent>` |
| Calldata keccak256                         | `<unresolved>`           |
| Independent decoded field table            | `<unresolved>`           |
| Exact cut manifest hash                    | `<unresolved>`           |
| Fork block/hash and simulation report hash | `<unresolved>`           |
| Replay-revert test                         | `<unresolved>`           |
| Approvals                                  | `<unresolved>`           |

Until every cell is resolved, every gate in
[`BASE_SEPOLIA_V2_UPGRADE_RUNBOOK.md`](BASE_SEPOLIA_V2_UPGRADE_RUNBOOK.md) is PASS,
and a new council vote returns PASS, the correct `_init` and `_calldata` for a
Diamond cut remain **undefined**.
