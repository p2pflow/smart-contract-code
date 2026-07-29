# P2PFlow Phase 0 Provenance Record

Status: **Phase 0 baseline proven; council REJECT controls; NO CUT / NO DEPLOY**

Evidence date: 2026-07-29 UTC

This record is deliberately sanitized. It contains public contract, build, routing, and
aggregate accounting evidence. It omits payment-channel strings, bank details, UPI
identifiers, Telegram usernames, merchant addresses, channel IDs, and order IDs.

## Target and evidence boundary

| Item                         | Verified value                                                       |
| ---------------------------- | -------------------------------------------------------------------- |
| Network                      | Base Sepolia                                                         |
| Chain ID                     | `84532`                                                              |
| Diamond                      | `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A`                         |
| Exact live-era source commit | `aa6f802a9e233e9d9ed101b1d4a5209d25cc1d2a`                           |
| First pinned evidence block  | `44,795,652`                                                         |
| First pinned block hash      | `0x877ff2d4b66d39215371b4b96bc4cf363e6dd839c11d686b97afaac085b82f79` |
| Independent fresh block      | `44,795,919`                                                         |
| Fresh block hash             | `0x5c0c97c9885ae9d6497d2bb44a807cc8646da44062269a07f21d3af165aa01c5` |
| Council consolidated block   | `44,795,931`                                                         |
| Consolidated block hash      | `0x44c6326da3fa815bfa2516124e83cf8370b6a2f2ebbaa000b07ac4a0959c752b` |

The first and consolidated snapshots were 279 blocks apart. The routed facets, runtime code,
public configuration, aggregate counts, custody reconciliation, and relevant
Diamond-cut logs did not change between them.

The current `origin/dev` tip, `a6808ff`, is **not** the deployed generation. It adds
an `orderNumber` field and changes the OrderFacet runtime. Upgrade work must use the
exact `aa6f802` baseline, not the branch tip.

## Controlling council disposition

The council bill adopted 2026-07-29, SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`, is a
unanimous 5–0 **REJECT**. It is the controlling policy gate. Exact source recovery
closed the missing-source objection but did not approve the architecture or any
value movement.

The bill pins the main-worktree plan at SHA-256
`a7bc60356ad8d2ca09f1b5a18cdc686d1ea52d7661155f193a54805d335d2a6f`.
The isolated worker copy hashes to
`0ae2cf93f923f9910a7a050dcbf3ee7023d3488785b46545858a1bbd7e1f2434`.
A read-only comparison found content-identical requirements with only Markdown title
metadata hard-break/blank-line formatting differences. The companion architecture
hash matches the bill exactly at
`4c5535ac64eca3f174df8d07ccded44b68456cdc8896fa51958498ece10a07ba`.
No main-worktree file was edited.

The bill forbids every production or testnet value-moving canary, Diamond cut,
initializer or migration, order assignment capable of leading to acceptance or
settlement, authoritative bank-cash entry, transaction signing, private-key use,
broadcast, and on-chain state change. It permits only transaction-disabled,
non-signing, read-only/offline provenance and reconstruction, deterministic replay,
simulation, formula/golden-vector/invariant scaffolding, and shadow output that is
technically unable to authorize or trigger action.

The unresolved gate categories are:

- fairness, deterministic decision commitments, economic-operator aggregation,
  exact-four availability, lease timing, anti-grinding, and nonresponse recovery;
- solvency, custody classification, acceptance reservations, exposure-safe unstake
  and migration, and exact-once limit semantics;
- direct rational rail rounding, reservation-safe sweeps, FX/deficit policy, dispute
  cash facts, replay-safe reconciliation, and complete gross-fiat attribution;
- versioned initialization, migration state machine/conservation, selector cut, and
  a legacy-state truth table on an append-only layout beginning at root 22; and
- reliability, independent reproducibility, Sybil/operator credentials, spam and
  user escape, failure containment, and legacy/new-data privacy governance.

The amended bill admits a public token-liability reconciliation at block
`44,795,931`, but expressly does not treat it as Phase 0/1 exit, migration evidence,
or deployment authority. Secured bank balances, channel ownership, historical
off-chain sweeps/top-ups, a cut-time build-tied snapshot, and independent sign-off
remain absent. Both channels therefore remain reconciliation-required.

The sanitized block-pinned
[live snapshot](../../reports/provenance/base-sepolia/block-44795931/live-snapshot.json)
has SHA-256 `0f0340251401bfd813de3d9f61078a1bff2bbb0a3eba55dc86b2865c7875598f`;
the [custody reconciliation](../../reports/provenance/base-sepolia/block-44795931/custody-reconciliation.json)
has SHA-256 `66e7a5b398b90404ea2c285b04e95e56522654969b46c7350b0d54ead87cf627`.

The amended bill also records a separate exact-target subgraph blocker. At the
council-pinned subgraph commit `1233b1d53c1db88d4dae7993a0a5cbe39c0bcfc3`,
the configured target uses the later eight-field `OrderCreated` / 21-field
`getOrder` generation, while the byte-proven target exposes seven and 20 fields.
The live seven-field topic is
`0xa4987aaabfd00247972c458bbf7a5183bae686b39c2d77a1c70f9a84497d5dec`; the
repository eight-field topic is `0xfc46abc20de537ef9bcee69c7bdd579a48747a658e430c99817e955675b63c37`.
That checked-in subgraph must not be deployed against this Diamond as-is. A corrected
ABI/mapping, deterministic start-block replay against direct-chain totals, and the
actual hosted artifact identity are required before reconsideration.

A new council vote under the same no-critical-objection rule is required after all
binding amendments and reconsideration evidence. Until then, later runbook stages
are dormant requirements, not executable instructions.

## Reproducible build attestation

The exact source reproduces all seven deployed runtimes byte-for-byte, including
Solidity metadata.

| Build setting          | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Solidity               | `0.8.24+commit.e11b9ed9`                                             |
| Optimizer              | enabled, 200 runs                                                    |
| EVM version            | `paris`                                                              |
| Via IR                 | false                                                                |
| Library linking        | none                                                                 |
| Remappings             | none                                                                 |
| AppStorage source hash | `0xf07c0ae67f2eaaed163f5fdc39eda1772f397f149e15acdf69b08d952b856e1d` |

| Runtime           | Deployed address                             | `keccak256(runtime bytecode)`                                        |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| Diamond           | `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A` | `0x054daffcd2719790d6adf588677a3d33d1fed526c9f7df652982639c082fb2ac` |
| DiamondCutFacet   | `0x13E3B3C63362B1cad5430c3745dC96130E7a5117` | `0x2424f646578e3de36e604b7e34216ce8897386fa839098c3c5b3ea673bc45882` |
| DiamondLoupeFacet | `0x3D50E8DF96e7F43a8570A9e54C42F8b559fffB58` | `0x5014f72ae8c67eb0e572ea963fb29fa738ac907030beb07fc05ec4a2ae9d9fa2` |
| OwnershipFacet    | `0x2c63a6234D1a587D7b160FF96fF703c1097f7b30` | `0x17ec3cbff6f1fc9cee7a73c2088afd37c239942643991f82bf5c915983e2cca9` |
| ConfigFacet       | `0xcF9510e42511014FaB632238Dbf5250562C61D83` | `0xcfcc9996adf72d0bebab17b5695c21a14aa325057a3255ad4764b3242dde5a27` |
| MerchantFacet     | `0x2C1e028064c18aD316Fa8Fa69d1B328cC219E97D` | `0x30cc890cbb1341416dd68abfdf11802579ababd6a56ffdd0601dc96d0cfa2541` |
| OrderFacet        | `0xCCA73B72b83FDccfBFe4294224c32ccc305df4Fb` | `0xa31a0fef91f6d951ef4aff395a1273e6331248aff54bdd82342570168df354a6` |

## Exact live routing

The loupe exposes 6 facets and 63 selectors. The selector-to-facet mapping below is
the immutable regression baseline for any proposed cut.

### DiamondCutFacet — 1 selector

| Selector     | Signature                                              |
| ------------ | ------------------------------------------------------ |
| `0x1f931c1c` | `diamondCut((address,uint8,bytes4[])[],address,bytes)` |

### DiamondLoupeFacet — 5 selectors

| Selector     | Signature                         |
| ------------ | --------------------------------- |
| `0x01ffc9a7` | `supportsInterface(bytes4)`       |
| `0x52ef6b2c` | `facetAddresses()`                |
| `0x7a0ed627` | `facets()`                        |
| `0xadfca15e` | `facetFunctionSelectors(address)` |
| `0xcdffacc6` | `facetAddress(bytes4)`            |

### OwnershipFacet — 2 selectors

| Selector     | Signature                    |
| ------------ | ---------------------------- |
| `0x8da5cb5b` | `owner()`                    |
| `0xf2fde38b` | `transferOwnership(address)` |

### ConfigFacet — 15 selectors

| Selector     | Signature                                  |
| ------------ | ------------------------------------------ |
| `0x09ec0f24` | `addEligibleMerchant(address)`             |
| `0x1a9ba7eb` | `unpausePlatform()`                        |
| `0x2f583d4b` | `getEligibleMerchants()`                   |
| `0x332226d0` | `setDisputeWindow(uint256)`                |
| `0x3397d9a2` | `transferPlatformAdmin(address)`           |
| `0x3551ac6c` | `clearEligibleMerchants()`                 |
| `0x64ec2ceb` | `setMinMerchantStake(uint256)`             |
| `0x6a96f84d` | `removeEligibleMerchant(address)`          |
| `0x6b78c29b` | `pausePlatform()`                          |
| `0x892b8a9c` | `setDefaultChannelLimits(uint256,uint256)` |
| `0x903eadc0` | `isEligibleMerchant(address)`              |
| `0xab211bd9` | `getOrderPricing()`                        |
| `0xbf284d84` | `getChannelLimitDefaults()`                |
| `0xc3f909d4` | `getConfig()`                              |
| `0xf7260e6e` | `setOrderPricing(uint256,uint256)`         |

### MerchantFacet — 24 selectors

| Selector     | Signature                                        |
| ------------ | ------------------------------------------------ |
| `0x0586296c` | `migrateAndTerminate(bytes32,bytes32)`           |
| `0x1dcad144` | `setPaymentChannelInactive(bytes32)`             |
| `0x1fee2a96` | `addPaymentChannel(string,string,string,string)` |
| `0x21527e50` | `getMyProfile()`                                 |
| `0x30321dcc` | `blacklistMerchant(address)`                     |
| `0x38a9f5df` | `rejectChannel(bytes32)`                         |
| `0x3d58ff4a` | `approveChannel(bytes32)`                        |
| `0x5b020623` | `getChannelLimits(bytes32)`                      |
| `0x66d3b61c` | `rejectMerchantUnstake(address)`                 |
| `0x6e5b676b` | `goOnline()`                                     |
| `0x8307d08b` | `getPendingChannels()`                           |
| `0x831c2b82` | `getChannel(bytes32)`                            |
| `0x8ce2df51` | `getAllMerchants()`                              |
| `0x8e0540de` | `setMerchantDisputed(address)`                   |
| `0xa6485ccd` | `goOffline()`                                    |
| `0xae180328` | `getMyChannels()`                                |
| `0xb00c52b0` | `registerMerchant(uint256,string)`               |
| `0xb2734eaf` | `getMerchant(address)`                           |
| `0xb4de411c` | `getMerchantChannels(address)`                   |
| `0xb7889c93` | `setPaymentChannelActive(bytes32)`               |
| `0xbb634d55` | `approveMerchantUnstake(address)`                |
| `0xbed9d861` | `withdrawStake()`                                |
| `0xcb82cc8f` | `depositStake(uint256)`                          |
| `0xd91b0a8d` | `clearMerchantDispute(address)`                  |

### OrderFacet — 16 selectors

| Selector     | Signature                       |
| ------------ | ------------------------------- |
| `0x1e3e148d` | `getChannelFiat(bytes32)`       |
| `0x3611d088` | `confirmPayment(bytes32)`       |
| `0x3af1b286` | `markPaymentSent(bytes32)`      |
| `0x3c81c4b8` | `createSellOrder(uint256)`      |
| `0x49085d8c` | `settleOrder(bytes32)`          |
| `0x4ebac543` | `getMerchantOrders(address)`    |
| `0x5778472a` | `getOrder(bytes32)`             |
| `0x63c69f08` | `getUserOrders(address)`        |
| `0x7372f2f1` | `getAssignedMerchants(bytes32)` |
| `0x7489ec23` | `cancelOrder(bytes32)`          |
| `0x84ce1bfc` | `createBuyOrder(uint256)`       |
| `0x9e0acf8f` | `getOrderIds()`                 |
| `0xb641237c` | `resolveDispute(bytes32,uint8)` |
| `0xd6039a61` | `acceptOrder(bytes32,bytes32)`  |
| `0xe14f5b7d` | `raiseDispute(bytes32)`         |
| `0xeb0817c5` | `getMerchantBalances(address)`  |

## Exact AppStorage roots

The compiler layout, exact source, and representative raw reads agree. `Modifiers.s`
begins at slot 0 and allocates 704 bytes across 22 root slots.

| Root slot(s) | Exact field                      |
| ------------ | -------------------------------- |
| `0–3`        | `config` (`PlatformConfig`)      |
| `4`          | `merchants`                      |
| `5`          | `merchantList`                   |
| `6`          | `channels`                       |
| `7`          | `channelDuplicateGuard`          |
| `8`          | `_reentrancyStatus`              |
| `9`          | `defaultChannelDailyLimitUsdc`   |
| `10`         | `defaultChannelMonthlyLimitUsdc` |
| `11`         | `buyPriceInrPerUsdc`             |
| `12`         | `sellPriceInrPerUsdc`            |
| `13`         | `disputeWindowSeconds`           |
| `14`         | `orderNonce`                     |
| `15`         | `orders`                         |
| `16`         | `orderIds`                       |
| `17`         | `userOrderIds`                   |
| `18`         | `merchantOrderIds`               |
| `19`         | `orderAssignmentIndex`           |
| `20`         | `eligibleMerchants`              |
| `21`         | `eligibleMerchantIndex`          |

Slot `21` is the final allocated root in the exact baseline. Slot `22` is therefore
the first root available for an append-only extension. This does not authorize an
extension by itself: every proposed build must prove that roots `0–21`, every nested
field, every enum ordinal, and every ABI tuple are unchanged.

Nested layout sizes are also fixed:

| Struct           | Slots |
| ---------------- | ----: |
| `PlatformConfig` |     4 |
| `Merchant`       |     9 |
| `PaymentChannel` |    17 |
| `Order`          |    16 |

No enum may be reordered or have an item inserted before an existing item.

## Legacy Order tuple correction

The live `getOrder(bytes32)` return tuple and stored `Order` have exactly 20 fields,
not 21. There is no live `orderNumber`.

| Field               | Relative slot | Byte offset |
| ------------------- | ------------: | ----------: |
| `orderId`           |             0 |           0 |
| `orderType`         |             1 |           0 |
| `status`            |             1 |           1 |
| `user`              |             1 |           2 |
| `merchant`          |             2 |           0 |
| `channelId`         |             3 |           0 |
| `usdcAmount`        |             4 |           0 |
| `fiatAmount`        |             5 |           0 |
| `price`             |             6 |           0 |
| `createdAt`         |             7 |           0 |
| `acceptedAt`        |             8 |           0 |
| `paidAt`            |             9 |           0 |
| `completedAt`       |            10 |           0 |
| `cancelledAt`       |            11 |           0 |
| `disputeExpiresAt`  |            12 |           0 |
| `disputeStatus`     |            13 |           0 |
| `disputeResolver`   |            13 |           1 |
| `disputeResult`     |            13 |          21 |
| `assignedMerchants` |            14 |           0 |
| `riskReleased`      |            15 |           0 |

Compatibility rule: preserve this tuple in this order and place all v2 metadata in
parallel append-only mappings or new v2 views.

## Deployment lineage

The deployment sequence was recovered from Base Sepolia receipts, creator nonces,
runtime code, and Diamond-cut logs:

| Event                                   |        Block | Block hash                                                           | Transaction                                                          |
| --------------------------------------- | -----------: | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Diamond creation                        | `44,359,816` | `0xd795b0bdd9f33cb348c471f2b55dc79817dcf1ec2d1b28c0ed3ac34e543578ba` | `0xdeb586b0d265fe6c89d81ee16e7da794810ef4f1c272b1db9983e7f7e473b60b` |
| Initial external cut and initialization | `44,359,818` | `0xb8aa31dac6e43032fcc3cc45e347e4135e2582f609d57e5adde59bfde207d439` | `0x6144084a2cf1571ad7ec5d9751664294e57d3c2fee52ed3fe17fa59faa4794fb` |

The historical initializer was
`0x2CC9130bf944a5c010063817C2cC3D24D18210C0`. Its runtime, the configured
token generation, the Diamond, and all six facets trace to the exact `aa6f802`
generation. The initial cut added the loupe, ownership, config, merchant, and order
facets; the constructor had already installed `diamondCut`.

Two hundred eighteen bounded log queries found only the constructor bootstrap cut
and the initial external cut through the pinned evidence block. No later Diamond cut
was found.

The original initializer calldata is preserved for historical decoding in
[`../deployment/V2_INITIALIZER_CALLDATA.md`](../deployment/V2_INITIALIZER_CALLDATA.md).
It is **not** reusable.

## Pinned live and fork reads

At the council consolidated block `44,795,931`, the exact baseline ABI decoded:

| Public state                                                 | Value                                        |
| ------------------------------------------------------------ | -------------------------------------------- |
| Owner and platform admin                                     | `0xA486891ED5Abd2C3B1bB2a20F36B9456e32c7866` |
| Configured token                                             | `0xa50e77Ae17F290Cfb0E2F29B4F2d9D0071Cb6D63` |
| Initialized                                                  | `true`                                       |
| Paused                                                       | `false`                                      |
| Minimum merchant stake                                       | `300,000,000` token atoms                    |
| Default daily channel limit                                  | `600,000,000` token atoms                    |
| Default monthly channel limit                                | `6,200,000,000` token atoms                  |
| Legacy BUY / SELL price                                      | `95` / `90`                                  |
| Dispute window                                               | `600` seconds                                |
| Aggregate merchants / channels / orders / eligible merchants | `2 / 2 / 19 / 2`                             |

A disposable Hardhat `3.11.1` OP-chain fork, pinned to block `44,795,919` and chain ID,
reproduced the Diamond runtime hash, 6 facets, 63 selectors, and all public counts.
The aggregate custody read was:

| Accounting check                           |   Token atoms |
| ------------------------------------------ | ------------: |
| Token custody at Diamond                   | `588,000,000` |
| Aggregate merchant liability               | `588,000,000` |
| Open SELL escrow                           |           `0` |
| Custody minus tracked liability and escrow |           `0` |
| Aggregate risk component                   |  `45,000,000` |

No aggregate reservation was open. The fork made no external writes and submitted no
transaction.

This custody equality is a Phase 0 token-ledger result. It does **not** reconstruct
how gross off-chain fiat balances divide into merchant principal, protocol spread,
FX equity, or deficit. That is the separate Phase 1 bank-reconciliation gate.

## Gate matrix

Status is as of this evidence record. A pass in Phase 0 is not permission to cut.

| Gate                                            | Status                    | Evidence or blocker                                                                                                                                      |
| ----------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture plan and inventory read            | PASS                      | Both architecture sources reviewed completely                                                                                                            |
| Exact deployed source generation                | PASS                      | `aa6f802` reproduces all runtimes including metadata                                                                                                     |
| Facet addresses and 63 selectors                | PASS                      | Loupe, ABI, and local manifest agree                                                                                                                     |
| Compiler and settings                           | PASS                      | Solidity `0.8.24`, optimizer 200, Paris                                                                                                                  |
| Exact AppStorage roots and nested layouts       | PASS                      | Roots `0–21`; representative raw reads agree                                                                                                             |
| Base Sepolia pinned reads and OP fork           | PASS                      | All pinned snapshots and fork agree                                                                                                                      |
| Token custody reconciliation                    | PASS                      | Aggregate delta is zero at the pinned block                                                                                                              |
| Regression/provenance/storage tooling           | PASS                      | 25 dedicated tests plus deterministic manifest, ABI, storage, selector, live-read, and custody gates pass                                                |
| Council-permitted offline vectors               | PASS                      | 28 non-authoritative tests cover direct rail math, reservation-safe caps, monotone accepted service, custody classification, and replay-envelope hashing |
| Council policy                                  | REJECT — CONTROLLING STOP | Unanimous 5–0 bill forbids value movement, cut, initializer/migration, signing, broadcast, and state change                                              |
| Phase 1 bank/principal reconstruction           | BLOCKED                   | Public history closes, but secured bank/ownership evidence is absent and both channels remain reconciliation-required                                    |
| Exact-target subgraph replay                    | BLOCKED                   | Checked-in subgraph ABI has the wrong event topic and return tuple; corrected replay and deployed artifact identity are absent                           |
| Value-moving v2 semantics/initializer           | PROHIBITED                | No policy implementation is authorized by the REJECT bill; only disabled scaffolding is permitted                                                        |
| Full unit/storage/selector/invariant/fuzz suite | BLOCKED                   | Requires final implementation                                                                                                                            |
| Complete fork cut simulation                    | BLOCKED                   | Requires final reviewed cut and migration snapshot                                                                                                       |
| Independent Diamond/storage and custody audit   | BLOCKED                   | Not completed                                                                                                                                            |
| Ownership/configuration/signer preflight        | BLOCKED                   | Must be repeated at the candidate cut block                                                                                                              |
| Diamond cut                                     | PROHIBITED                | All preceding gates have not passed                                                                                                                      |
| Base Sepolia deployment/broadcast               | PROHIBITED                | Council REJECT independently forbids it; later plan gates are also incomplete                                                                            |

## Local reproduction

These commands are read-only with respect to the chain:

```text
npx hardhat compile --force
node scripts/provenance/local-manifest.js
node scripts/provenance/export-abis.js
node scripts/provenance/storage-layout.js
node scripts/provenance/storage-diff.js
node scripts/provenance/selector-diff.js --fail-on-change
node scripts/provenance/live-snapshot.js --block 44795931
node scripts/provenance/custody-reconcile.js --block 44795931
```

The live snapshot tool rejects any chain other than `84532` and any Diamond other
than the target above. RPC URLs and payment strings are not emitted.
