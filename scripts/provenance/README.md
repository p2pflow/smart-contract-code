# P2PFlow provenance tooling

These scripts are deterministic, read-only provenance and accounting tools for the
exact `aa6f802` Base Sepolia generation. They contain no deployment, initializer,
Diamond-cut calldata, signing, broadcasting, or transaction code. The council gate
is `REJECTED_NO_EXECUTION`; selector differences are metadata only.

The RPC boundary permits only `eth_chainId`, `eth_blockNumber`,
`eth_getBlockByNumber`, `eth_getCode`, and `eth_call`; every other method fails before
network access. This safety claim is scoped to `scripts/provenance`. The recovered
repository still contains pre-existing deploy/upgrade scripts and external-network
package commands. They are outside this tooling, are dormant under the council
REJECT, and were not invoked or represented as approved by this workstream.

## Fixed live target

- Chain ID: `84532`
- Diamond: `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A`
- Default RPC, used only when `BASE_SEPOLIA_RPC_URL` is absent:
  `https://sepolia.base.org`

Live commands reject any other chain or target and pin one block before reading.
Output says only whether the environment-provided or official fallback RPC was used;
the RPC URL itself is never emitted. The scripts do not load `.env` or Hardhat config.
Payment-channel strings are decoded only as required by the legacy tuple and are
never included in output.

## Exact runtime baseline

| Contract          | Expected deployed-bytecode hash                                      |
| ----------------- | -------------------------------------------------------------------- |
| Diamond           | `0x054daffcd2719790d6adf588677a3d33d1fed526c9f7df652982639c082fb2ac` |
| DiamondCutFacet   | `0x2424f646578e3de36e604b7e34216ce8897386fa839098c3c5b3ea673bc45882` |
| DiamondLoupeFacet | `0x5014f72ae8c67eb0e572ea963fb29fa738ac907030beb07fc05ec4a2ae9d9fa2` |
| OwnershipFacet    | `0x17ec3cbff6f1fc9cee7a73c2088afd37c239942643991f82bf5c915983e2cca9` |
| ConfigFacet       | `0xcfcc9996adf72d0bebab17b5695c21a14aa325057a3255ad4764b3242dde5a27` |
| MerchantFacet     | `0x30cc890cbb1341416dd68abfdf11802579ababd6a56ffdd0601dc96d0cfa2541` |
| OrderFacet        | `0xa31a0fef91f6d951ef4aff395a1273e6331248aff54bdd82342570168df354a6` |

## Commands

All commands print stable-key-order JSON by default. A file is written only when an
explicit `--out`, `--out-dir`, or other output path is supplied.

### Local ABI, selector, and runtime manifest

```bash
node scripts/provenance/local-manifest.js
node scripts/provenance/local-manifest.js --all --out manifest.json
node scripts/provenance/local-manifest.js --current --out current-manifest.json
```

The strict default and `--all` modes verify all seven exact-aa6 runtime hashes before
emitting the baseline. Every contract entry embeds its complete Hardhat ABI, ABI hash,
creation/runtime hash, functions/selectors, events, and errors. Thus the local manifest
is itself a combined ABI artifact. `--current` is the generic post-change inventory and
does not claim that new artifacts are aa6.

### Individual ABI artifacts

```bash
node scripts/provenance/export-abis.js
node scripts/provenance/export-abis.js --out-dir generated/aa6-abis
```

The default prints the deterministic seven-contract ABI bundle. `--out-dir` writes
seven individual `<Contract>.abi.json` files plus `manifest.json`; each manifest entry
contains the ABI hash and expected runtime hash. Export is strict and fails if mutable
local artifacts no longer reproduce exact aa6.

### AppStorage report

```bash
node scripts/provenance/storage-layout.js
node scripts/provenance/storage-layout.js --build-info artifacts/build-info/<id>.json
```

This locates `contracts/shared/AppStorage.sol:Modifiers.s`, requires it at slot 0,
attests the build-info against all seven aa6 runtime hashes, and reports:

- 19 AppStorage roots;
- four reachable nested structs and every field slot/offset/type;
- eight reachable enums and exact ordinals;
- compiler version/settings and source hash;
- 22 allocated slots, with `eligibleMerchantIndex` as the final root at slot `21`.

The committed baseline is `baseline/aa6-storage-layout.json`.

### Append-only storage gate

```bash
node scripts/provenance/storage-diff.js
node scripts/provenance/storage-diff.js --current current-layout.json
node scripts/provenance/storage-diff.js --build-info artifacts/build-info/<id>.json
```

The default compares current build-info with the committed aa6 baseline. It fails if
any baseline root, nested-struct field, field type/slot/offset, or enum member/ordinal
changes or disappears. New top-level AppStorage roots are allowed only after occupied
baseline storage and are listed with the exact new final slot. New structs/enums are
reported. Exit status is `2` for an incompatible layout.

The standalone `storage-layout.js` command remains strict-aa6. Only the diff reader
uses non-attesting current-build mode, so it can inspect a later build without
weakening the baseline command.

### Selector diff and collision gate

```bash
node scripts/provenance/selector-diff.js
node scripts/provenance/selector-diff.js --current current-manifest.json
node scripts/provenance/selector-diff.js --fail-on-change
```

This compares current facet artifacts to the embedded exact-aa6 6-facet/63-selector
baseline. It reports metadata-only `Add`, `Replace`, and `Remove` records, unchanged
selectors, runtime-driven replacements, and duplicate/hash collisions. It never
encodes or executes a Diamond cut. Collisions exit `2`; `--fail-on-change` also exits
`2` when any otherwise valid selector change exists.

### Live snapshot

```bash
node scripts/provenance/live-snapshot.js
node scripts/provenance/live-snapshot.js --block 44796609 --out snapshot.json
```

The command verifies the chain, authorized Diamond, all six facet addresses, all 63
selectors, and all seven live runtime hashes at one pinned block. It then reads only
public owner/config/pricing/limit/count/token-custody state. Immutable minimal aa6 read
fragments keep this forensic command usable even after a later local compile replaces
Hardhat artifacts.

### Custody reconciliation

```bash
node scripts/provenance/custody-reconcile.js --block 44796609
```

The exact aa6 tuple gates are 11 Merchant fields, 18 PaymentChannel fields, 20 Order
fields, and seven `OrderCreated` inputs (no later `orderNumber`). The reconciliation
checks:

- configured ERC-20 balance at the Diamond equals total merchant `usdcLiquidity`
  plus uncompleted SELL escrow;
- stored `reservedUsdc`, `riskUsdc`, and `reservedFiat` equal amounts derived from
  the complete order set;
- merchant/channel/order identities and ownership links are consistent;
- reserved/risk partitions do not exceed their parent balances;
- merchant, channel, and order lists contain no duplicate roots.

Accounting mismatches are emitted in full sanitized JSON and exit with status `2`.
Chain, target, selector, and runtime mismatches fail before accounting begins.

## Exit codes

- `0`: requested verification/reconciliation passed.
- `1`: invalid input, wrong chain/target/hash, RPC failure, decode failure, or missing evidence.
- `2`: a well-formed comparison found an incompatible storage/selector/accounting state.

No command in this directory sends a transaction or changes chain state.
