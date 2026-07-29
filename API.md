# P2PFlow Smart Contract — Full API Reference

> Companion to [README.md](README.md). The README explains the **generic Diamond
> pattern**. This document is the **actual, current API** of the deployed system —
> every enum, struct, function, event, modifier, script and env var, exactly as it
> exists in `contracts/`.
>
> Solidity: `0.8.24`, optimizer `runs: 200`. OpenZeppelin `^5.0.0` (`SafeERC20`).

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Facet topology & deployed selectors](#2-facet-topology--deployed-selectors)
3. [AppStorage — enums, structs, storage layout](#3-appstorage--enums-structs-storage-layout)
4. [Modifiers](#4-modifiers)
5. [LibMerchants (utility library)](#5-libmerchants-utility-library)
6. [DiamondInit (one-shot initializer)](#6-diamondinit-one-shot-initializer)
7. [ConfigFacet](#7-configfacet)
8. [MerchantFacet](#8-merchantfacet)
   - [Registration & USDC liquidity](#81-registration--usdc-liquidity)
   - [Merchant availability](#82-merchant-availability)
   - [Payment channels](#83-payment-channels)
   - [Admin: channels & merchants](#84-admin-channels--merchants)
   - [Views](#85-views)
9. [OwnershipFacet (ERC-173)](#9-ownershipfacet-erc-173)
10. [DiamondCutFacet (upgrade entrypoint)](#10-diamondcutfacet-upgrade-entrypoint)
11. [DiamondLoupeFacet (introspection)](#11-diamondloupefacet-introspection)
12. [State machines](#12-state-machines)
    - [Merchant account status](#121-merchant-account-status)
    - [Payment channel status](#122-payment-channel-status)
    - [Unstake lifecycle](#123-unstake-lifecycle)
13. [Deploy script](#13-deploy-script)
14. [Upgrade script](#14-upgrade-script)
15. [Smoke test script](#15-smoke-test-script)
16. [Environment variables](#16-environment-variables)
17. [Test suite](#17-test-suite)
18. [Two-role model: Diamond owner vs. Platform admin](#18-two-role-model-diamond-owner-vs-platform-admin)
19. [Security invariants & known limitations](#19-security-invariants--known-limitations)
20. [Frontend integration cheatsheet](#20-frontend-integration-cheatsheet)

---

## 1. Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│                       Diamond (proxy)                            │
│                       — permanent address —                      │
│                                                                  │
│  fallback() → selectorToFacet[msg.sig] → delegatecall(facet)     │
└─────────────┬────────────────────┬─────────────────┬─────────────┘
              │                    │                 │
              ▼                    ▼                 ▼
     ┌─────────────────┐  ┌────────────────┐  ┌───────────────┐
     │ DiamondCutFacet │  │  ConfigFacet   │  │ MerchantFacet │
     │  (upgrade)      │  │  (platform     │  │  (merchants,  │
     │                 │  │   config)      │  │   channels,   │
     └─────────────────┘  └────────────────┘  │   USDC stake) │
                                              └───────────────┘
     ┌────────────────────┐  ┌──────────────────┐
     │ DiamondLoupeFacet  │  │ OwnershipFacet   │
     │  (introspect)      │  │  (ERC-173)       │
     └────────────────────┘  └──────────────────┘

Shared state (delegatecall → single storage):
  • Slot 0            → AppStorage (business state, via `s`)
  • keccak256 slot    → LibDiamond.DiamondStorage (routing table + owner)
```

- **Diamond owner** (ERC-173) — the only address that can call `diamondCut()`.
- **Platform admin** — a separate role stored in `AppStorage.config.admin`; guards
  every merchant-management function via the `onlyAdmin` modifier.
- **USDC** — the only ERC-20 the contract touches. Address is set once in
  `DiamondInit.init()`.

---

## 2. Facet topology & deployed selectors

The Diamond is bootstrapped with **five** facets (constructor registers
`DiamondCutFacet`; the initial `diamondCut()` adds the other four):

| Facet                  | File                                                         | Purpose |
| ---------------------- | ------------------------------------------------------------ | ------- |
| `DiamondCutFacet`      | [DiamondCutFacet.sol](contracts/facets/DiamondCutFacet.sol)   | `diamondCut()` — the upgrade entrypoint |
| `DiamondLoupeFacet`    | [DiamondLoupeFacet.sol](contracts/facets/DiamondLoupeFacet.sol) | EIP-2535 introspection + ERC-165 |
| `OwnershipFacet`       | [OwnershipFacet.sol](contracts/facets/OwnershipFacet.sol)     | ERC-173 owner / transferOwnership |
| `ConfigFacet`          | [ConfigFacet.sol](contracts/facets/ConfigFacet.sol)           | Platform-wide config + pause + platform-admin transfer |
| `MerchantFacet`        | [MerchantFacet.sol](contracts/facets/MerchantFacet.sol)       | All merchant + channel logic + admin actions on them |

Not registered as a facet:

- [DiamondInit.sol](contracts/upgradeInitializers/DiamondInit.sol) — delegatecalled
  exactly once during the initial `diamondCut()` to set ERC-165 flags and initial
  `PlatformConfig`.

---

## 3. AppStorage — enums, structs, storage layout

File: [contracts/shared/AppStorage.sol](contracts/shared/AppStorage.sol)

### Enums

```solidity
enum MerchantAccountStatus { ACTIVE, INACTIVE, BLACKLISTED, DISPUTED }
enum MerchantAvailability  { ONLINE, OFFLINE }
enum ChannelStatus         { PENDING, APPROVED, REJECTED, TERMINATED }
enum ChannelAvailability   { ACTIVE, INACTIVE }
```

Numeric values are `0, 1, 2, ...` in declaration order. `MerchantAccountStatus`
has no `DORMANT` on-chain (the test file lists `DORMANT: 4` for future use, but
the contract enum has only four variants).

### Merchant

```solidity
struct Merchant {
    address wallet;                       // canonical merchant address (msg.sender at register)
    MerchantAccountStatus accountStatus;  // admin-controlled, except INACTIVE (self-triggered by withdrawStake)
    MerchantAvailability  availability;   // merchant-toggled when ACTIVE
    uint256 usdcLiquidity;                // total USDC custodied here (stake + top-ups)
    bool    unstakePending;               // true after withdrawStake(), until admin resolves
    uint256 unstakeRequestedAmount;       // snapshot of usdcLiquidity at withdrawStake() time
    string  telegramUsername;             // required, non-empty
    uint256 registeredAt;                 // block.timestamp
    bytes32[] channelIds;                 // all channels ever added (incl. TERMINATED/REJECTED)
}
```

### PaymentChannel

```solidity
struct PaymentChannel {
    bytes32 channelId;                    // = keccak256("CHANNEL" | wallet | index | chainId)
    address merchant;
    string  bankName;                     // raw, human-readable
    string  accountLast4;                 // MUST be exactly 4 ASCII digits
    string  upiId;                        // non-empty
    string  label;                        // non-empty
    ChannelStatus       status;           // PENDING → APPROVED | REJECTED | TERMINATED
    ChannelAvailability availability;
    uint256 fiatBalance;                  // 6-dec USDC-equivalent fiat balance
    uint256 appliedAt;
    uint256 reviewedAt;
}
```

### PlatformConfig

```solidity
struct PlatformConfig {
    address admin;
    address usdcToken;
    bool    paused;
    uint256 minMerchantStakeUsdc;         // 6-decimal USDC (raw units)
    bool    initialized;                  // guards against re-running DiamondInit.init()
}
```

### AppStorage (root — slot 0)

```solidity
struct AppStorage {
    PlatformConfig config;
    mapping(address => Merchant) merchants;
    address[] merchantList;
    mapping(bytes32 => PaymentChannel) channels;
    mapping(bytes32 => bool) channelDuplicateGuard;  // key = keccak256(wallet | normBankName | last4)
    uint256 _reentrancyStatus;                       // 0=unset, 1=not entered, 2=entered
}
```

**Layout rule:** every facet inherits `Modifiers`, whose first (and only) state
variable is `AppStorage internal s;`. That pins `s` to slot 0 in every facet so
they all agree on the layout. Never declare state anywhere else.

---

## 4. Modifiers

File: [AppStorage.sol](contracts/shared/AppStorage.sol) (bottom of the file)

```solidity
contract Modifiers {
    AppStorage internal s;

    modifier onlyAdmin() {
        require(msg.sender == s.config.admin, "Not admin");
        _;
    }

    modifier notPaused() {
        require(!s.config.paused, "Platform is paused");
        _;
    }

    modifier nonReentrant() {
        require(s._reentrancyStatus != 2, "ReentrancyGuard: reentrant call");
        s._reentrancyStatus = 2;
        _;
        s._reentrancyStatus = 1;
    }
}
```

Notes:

- `nonReentrant` is **Diamond-safe** — the lock lives in `AppStorage` so every
  facet that delegatecalls the Diamond shares the same guard.
- `DiamondInit.init()` primes `_reentrancyStatus = 1` so the first guarded call
  doesn't pay the cold-slot `0 → 2` SSTORE.
- `onlyAdmin` checks the **platform admin** (`s.config.admin`), NOT the Diamond
  owner. See [§18](#18-two-role-model-diamond-owner-vs-platform-admin).

---

## 5. LibMerchants (utility library)

File: [contracts/libraries/LibMerchants.sol](contracts/libraries/LibMerchants.sol)

Pure helpers used by `MerchantFacet`. All `internal`, so they're inlined into
the facet at compile time.

| Function | Behavior |
| --- | --- |
| `generateChannelId(address wallet, uint256 channelCount, uint256 chainId) → bytes32` | `keccak256(abi.encodePacked("CHANNEL", wallet, channelCount, chainId))`. Deterministic per (wallet, index, chain). |
| `normalizeBankName(string raw) → bytes` | Trims ASCII whitespace (`0x20 0x09 0x0a 0x0d`) from both ends, then lowercases ASCII `A-Z`. Non-ASCII bytes pass through. Used to build the duplicate guard key so `"SBI"`, `"sbi"`, and `" SBI "` collide. |
| `isAllAsciiDigits(string raw) → bool` | True iff every byte is `0x30-0x39`. Empty string returns `true`. Used to validate `accountLast4`. |

---

## 6. DiamondInit (one-shot initializer)

File: [contracts/upgradeInitializers/DiamondInit.sol](contracts/upgradeInitializers/DiamondInit.sol)

```solidity
function init(address _usdcToken, uint256 _minMerchantStakeUsdc) external
```

Called via `delegatecall` from the initial `diamondCut()`. Reverts if already
initialized or if `_usdcToken == address(0)`.

Effects:

- Registers ERC-165 flags for `IERC165`, `IDiamondCut`, `IDiamondLoupe`, `IERC173`.
- Sets `s.config.usdcToken`, `s.config.minMerchantStakeUsdc`, `s.config.paused = false`.
- **Sets `s.config.admin = msg.sender`** — the account that called `diamondCut()`
  becomes the platform admin. This is normally the Diamond owner but doesn't have
  to be.
- Sets `s.config.initialized = true`.
- Primes `s._reentrancyStatus = 1`.

`init()` cannot be called again from anywhere.

---

## 7. ConfigFacet

File: [contracts/facets/ConfigFacet.sol](contracts/facets/ConfigFacet.sol)

Platform-wide read + admin surface.

### Events

```solidity
event PlatformPaused(address indexed by);
event PlatformUnpaused(address indexed by);
event MinMerchantStakeUpdated(uint256 newMinStakeUsdc);
event PlatformAdminTransferred(address indexed previousAdmin, address indexed newAdmin);
```

### Functions

| Function | Access | Description |
| --- | --- | --- |
| `getConfig() → PlatformConfig` | public view | Returns the full `PlatformConfig` struct. |
| `pausePlatform()` | `onlyAdmin` | Flips `paused = true`. Blocks every `notPaused` function. |
| `unpausePlatform()` | `onlyAdmin` | Flips `paused = false`. |
| `setMinMerchantStake(uint256 minStakeUsdc)` | `onlyAdmin` | Sets the minimum USDC (6-dec) required at `registerMerchant()` and to `goOnline()`. |
| `transferPlatformAdmin(address newAdmin)` | `onlyAdmin` | Hands the admin role to a new address. Reverts on `address(0)`. **This is orthogonal to Diamond ownership.** |

There is **no getter** for the individual fields — read `getConfig()` and pick
what you need.

---

## 8. MerchantFacet

File: [contracts/facets/MerchantFacet.sol](contracts/facets/MerchantFacet.sol)

Uses `SafeERC20` for all USDC movements. All USDC amounts are raw 6-decimal
units (i.e. `1 USDC == 1_000_000`).

### Events

```solidity
event MerchantRegistered(address indexed wallet, uint256 usdcLiquidity);
event UsdcDeposited(address indexed wallet, uint256 amount);
event UsdcWithdrawn(address indexed wallet, uint256 amount);
event UnstakeRequested(address indexed wallet, uint256 amount);
event UnstakeRequestRejected(address indexed wallet);
event AvailabilityChanged(address indexed wallet, MerchantAvailability availability);
event ChannelAdded(bytes32 indexed channelId, address indexed wallet);
event ChannelApproved(bytes32 indexed channelId, address indexed wallet);
event ChannelRejected(bytes32 indexed channelId, address indexed wallet);
event ChannelAvailabilityChanged(bytes32 indexed channelId, address indexed wallet, ChannelAvailability availability);
event FiatMigrated(bytes32 indexed fromChannelId, bytes32 indexed toChannelId, address indexed wallet, uint256 amount);
event ChannelTerminated(bytes32 indexed channelId, address indexed wallet);
event MerchantBlacklisted(address indexed wallet);
event MerchantDisputed(address indexed wallet);
event MerchantDisputeCleared(address indexed wallet);
```

---

### 8.1 Registration & USDC liquidity

#### `registerMerchant(uint256 stakeAmount, string telegramUsername)`

Modifiers: `notPaused`, `nonReentrant`.

Preconditions:

- Caller isn't already registered (`s.merchants[msg.sender].wallet == 0`).
- `stakeAmount >= s.config.minMerchantStakeUsdc`.
- `telegramUsername` non-empty.
- Caller has approved the Diamond for `stakeAmount` USDC.

Effects:

- Pulls `stakeAmount` USDC from caller via `safeTransferFrom`.
- Creates `Merchant { wallet, ACTIVE, ONLINE, usdcLiquidity=stakeAmount, telegramUsername, registeredAt=now }`.
- Appends to `s.merchantList`.
- Emits `MerchantRegistered`.

#### `depositStake(uint256 amount)`

Modifiers: `notPaused`, `nonReentrant`.

Preconditions:

- Caller is a merchant.
- Account status is `ACTIVE`.
- No unstake pending.
- `amount > 0` and caller has approved the Diamond.

Effects: pulls USDC, adds to `usdcLiquidity`, emits `UsdcDeposited`.

#### `withdrawStake()`

**No modifiers** — callable even when paused (safety valve). Not `nonReentrant`
because it makes no external calls.

Preconditions:

- Caller is a merchant.
- Account status is `ACTIVE`.
- No unstake pending.
- `usdcLiquidity > 0`.

Effects (immediate, no USDC movement yet):

- `unstakePending = true`
- `unstakeRequestedAmount = usdcLiquidity`  ← **full balance, not a partial amount**
- `accountStatus = INACTIVE`
- `availability = OFFLINE`
- Emits `UnstakeRequested`.

Admin then resolves via `approveMerchantUnstake` or `rejectMerchantUnstake`.

---

### 8.2 Merchant availability

Both require the caller to be a registered merchant.

| Function | Modifiers | Extra checks | Effect |
| --- | --- | --- | --- |
| `goOnline()` | `notPaused` | account is `ACTIVE`; `usdcLiquidity >= minMerchantStakeUsdc` | `availability = ONLINE` + event |
| `goOffline()` | none | none | `availability = OFFLINE` + event |

`goOffline()` is intentionally always callable (even when paused, even if the
account is `DISPUTED` / `BLACKLISTED`) so a merchant can always disappear.

---

### 8.3 Payment channels

#### `addPaymentChannel(string bankName, string accountLast4, string upiId, string label)`

Modifier: `notPaused`.

Preconditions:

- Caller is a merchant.
- Account status is `ACTIVE`.
- `bankName`, `upiId`, `label` non-empty.
- `accountLast4` is **exactly 4 ASCII digits** (validated via `LibMerchants.isAllAsciiDigits`).
- No duplicate: `keccak256(msg.sender | normalizeBankName(bankName) | accountLast4)` not
  already present in `channelDuplicateGuard`.

Effects:

- Marks the duplicate-guard key.
- Generates `channelId = LibMerchants.generateChannelId(msg.sender, m.channelIds.length, block.chainid)`.
- Creates `PaymentChannel { PENDING, INACTIVE, fiatBalance=0, appliedAt=now, reviewedAt=0, ... }`.
- Pushes `channelId` onto the merchant's `channelIds`.
- Emits `ChannelAdded`.

#### `setPaymentChannelActive(bytes32 channelId)`

Modifier: `notPaused`. Requires caller-owned channel with `status == APPROVED`.
Sets `availability = ACTIVE`. Emits `ChannelAvailabilityChanged`.

#### `setPaymentChannelInactive(bytes32 channelId)`

No `notPaused` (always callable). Same ownership + APPROVED check. Sets
`availability = INACTIVE`.

#### `migrateAndTerminate(bytes32 fromChannelId, bytes32 toChannelId)`

Modifier: `notPaused`.

Preconditions:

- Caller is a merchant, `ACTIVE`.
- `fromChannelId != toChannelId`.
- Both channels are caller-owned and `APPROVED`.

Effects:

- Moves `chFrom.fiatBalance` into `chTo.fiatBalance` (if > 0) — emits `FiatMigrated`.
- Marks `chFrom.status = TERMINATED`, `chFrom.availability = INACTIVE`.
- **Frees the duplicate guard** for `(wallet, normalizeBankName(fromBank), fromLast4)`
  so the same bank + last-4 can be re-added later.
- Emits `ChannelTerminated`.

Note: there is no standalone `terminateChannel` — termination is only via
migrate-then-terminate.

---

### 8.4 Admin: channels & merchants

All guarded by `onlyAdmin`.

| Function | Preconditions | Effects / events |
| --- | --- | --- |
| `approveChannel(bytes32 channelId)` | channel exists, `PENDING` | `status=APPROVED`, `availability=ACTIVE`, `reviewedAt=now`; `ChannelApproved` |
| `rejectChannel(bytes32 channelId)` | channel exists, `PENDING` | `status=REJECTED`, `availability=INACTIVE`, `reviewedAt=now`; frees duplicate guard; `ChannelRejected` |
| `approveMerchantUnstake(address wallet)` | merchant exists, `unstakePending=true`, `INACTIVE`, `usdcLiquidity >= requested` | Decrements `usdcLiquidity`, clears unstake flags, `accountStatus=ACTIVE`, transfers USDC out via `safeTransfer`; `UsdcWithdrawn`. Uses `nonReentrant`. |
| `rejectMerchantUnstake(address wallet)` | merchant exists, `unstakePending=true` | Clears unstake flags, `accountStatus=ACTIVE`. **Availability is not restored** — merchant must call `goOnline()`. `UnstakeRequestRejected` |
| `blacklistMerchant(address wallet)` | merchant exists, not already `BLACKLISTED` | Cancels any pending unstake, `accountStatus=BLACKLISTED`, `availability=OFFLINE`; `MerchantBlacklisted` |
| `setMerchantDisputed(address wallet)` | merchant exists, `ACTIVE` | `accountStatus=DISPUTED`, `availability=OFFLINE`; `MerchantDisputed` |
| `clearMerchantDispute(address wallet)` | merchant exists, `DISPUTED` | `accountStatus=ACTIVE`; `MerchantDisputeCleared` (availability not restored) |

**There is no un-blacklist function.** Blacklisting is terminal on-chain.

---

### 8.5 Views

| Function | Returns |
| --- | --- |
| `getMyProfile() → Merchant` | `s.merchants[msg.sender]` |
| `getMerchant(address wallet) → Merchant` | Full struct (zeroed if not registered) |
| `getAllMerchants() → address[]` | The `merchantList` array |
| `getChannel(bytes32 channelId) → PaymentChannel` | Full struct (zeroed if unknown) |
| `getMerchantChannels(address wallet) → PaymentChannel[]` | All of the merchant's channels (any status) |
| `getMyChannels() → PaymentChannel[]` | Same, for `msg.sender` (calls `this.getMerchantChannels` — costs one extra hop) |
| `getPendingChannels() → bytes32[]` | Every channel across the platform whose `status == PENDING`. **O(N·M) — walks every merchant and every channel each call.** |

`getPendingChannels()` is intended for the admin UI. It will get expensive as
merchants + channels grow; consider an off-chain indexer past a few thousand.

---

## 9. OwnershipFacet (ERC-173)

File: [contracts/facets/OwnershipFacet.sol](contracts/facets/OwnershipFacet.sol)

```solidity
function owner() external view returns (address);
function transferOwnership(address _newOwner) external;
```

State: stored in `LibDiamond.DiamondStorage.contractOwner` (keccak256 slot — not
AppStorage). `transferOwnership` requires `msg.sender == owner`. `LibDiamond`
emits `OwnershipTransferred(previousOwner, newOwner)` on every change (including
during `Diamond`'s constructor from `address(0)` → deployer).

---

## 10. DiamondCutFacet (upgrade entrypoint)

File: [contracts/facets/DiamondCutFacet.sol](contracts/facets/DiamondCutFacet.sol)

```solidity
function diamondCut(
    IDiamondCut.FacetCut[] calldata _diamondCut,
    address _init,
    bytes calldata _calldata
) external;
```

Guarded by `LibDiamond.enforceIsContractOwner()`. Delegates to
`LibDiamond.diamondCut` which:

1. Iterates `_diamondCut` and dispatches Add / Replace / Remove.
   - **Add** requires each selector to be currently unassigned.
   - **Replace** requires selectors to already exist and NOT already point at the
     same facet.
   - **Remove** requires `facetAddress == address(0)`; cannot remove immutable
     functions defined on the Diamond itself.
2. Emits `DiamondCut(_diamondCut, _init, _calldata)`.
3. If `_init != address(0)`, delegatecalls `_init._calldata`; bubbles up any
   revert (custom error: `InitializationFunctionReverted(address, bytes)`).

Uses **swap-and-pop** on the internal arrays so `facetAddresses[]` and
`facetFunctionSelectors[].functionSelectors` stay compact.

---

## 11. DiamondLoupeFacet (introspection)

File: [contracts/facets/DiamondLoupeFacet.sol](contracts/facets/DiamondLoupeFacet.sol)

All view functions, all EIP-2535 + ERC-165:

```solidity
struct Facet { address facetAddress; bytes4[] functionSelectors; }

function facets()                          external view returns (Facet[] memory);
function facetFunctionSelectors(address)   external view returns (bytes4[] memory);
function facetAddresses()                  external view returns (address[] memory);
function facetAddress(bytes4 selector)     external view returns (address);        // 0x0 if not registered
function supportsInterface(bytes4)         external view returns (bool);           // ERC-165
```

Interfaces flagged `true` after deploy (set in `DiamondInit`):
`IERC165`, `IDiamondCut`, `IDiamondLoupe`, `IERC173`.

---

## 12. State machines

### 12.1 Merchant account status

```
    registerMerchant()
          │
          ▼
   ┌───────────┐  withdrawStake()      ┌────────────┐
   │  ACTIVE   │ ────────────────────▶ │  INACTIVE  │
   │           │ ◀─── approveMerchantUnstake() ────│
   │           │ ◀─── rejectMerchantUnstake()  ────│
   └─────┬─────┘                        └──────┬────┘
         │                                     │
         │ blacklistMerchant()                 │ blacklistMerchant()
         │                                     │  (cancels unstake)
         ▼                                     ▼
   ┌─────────────┐                     ┌─────────────┐
   │ BLACKLISTED │  ◀── terminal ──▶   │ BLACKLISTED │
   └─────────────┘                     └─────────────┘

         │
         │ setMerchantDisputed()   (from ACTIVE only)
         ▼
   ┌───────────┐   clearMerchantDispute()
   │  DISPUTED │ ────────────────────────▶ ACTIVE
   └───────────┘
```

Availability (`ONLINE` / `OFFLINE`) is a **separate** dimension, freely toggled
by the merchant with `goOnline` / `goOffline` while `ACTIVE`. Blacklisting and
disputing both force `OFFLINE`.

### 12.2 Payment channel status

```
   addPaymentChannel()
          │
          ▼
   ┌───────────┐  approveChannel()    ┌────────────┐  migrateAndTerminate()   ┌────────────┐
   │  PENDING  │ ──────────────────▶  │  APPROVED  │ ──────────────────────▶  │ TERMINATED │
   │           │                      │            │  (bal moved to target)   │            │
   └─────┬─────┘                      └────────────┘                          └────────────┘
         │
         │ rejectChannel()    (also frees duplicate guard)
         ▼
   ┌────────────┐
   │  REJECTED  │
   └────────────┘
```

Channel availability (`ACTIVE` / `INACTIVE`) applies only while `APPROVED` and
is toggled by the merchant.

### 12.3 Unstake lifecycle

```
Merchant.usdcLiquidity = X

   withdrawStake()               approveMerchantUnstake()
        │                                    │
        ▼                                    ▼
  unstakePending = true              transfers X USDC out
  unstakeRequestedAmount = X    ┌──▶ usdcLiquidity -= X
  accountStatus = INACTIVE      │    unstakePending = false
  availability = OFFLINE        │    accountStatus = ACTIVE
                                │    (availability stays OFFLINE)
                                │
   rejectMerchantUnstake() ─────┘
                                     unstakePending = false
                                     accountStatus = ACTIVE
                                     (availability stays OFFLINE — merchant must goOnline())
```

---

## 13. Local-only deployment simulation

File: [scripts/deploy.js](scripts/deploy.js). The current council bill is
`REJECT` (SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`).
Only an ephemeral, non-forked in-process Hardhat simulation is permitted:

```bash
npm run deploy:local
```

Sequence:

1. Deploy `DiamondCutFacet`, `DiamondLoupeFacet`, `OwnershipFacet`, `ConfigFacet`, `MerchantFacet`.
2. Deploy `Diamond(deployer, DiamondCutFacet.address)` → the Diamond now has just `diamondCut()`.
3. Deploy `DiamondInit`.
4. Build one `FacetCut[]` adding all four business facets, encode
   `DiamondInit.init(USDC_ADDRESS, MIN_MERCHANT_STAKE)`.
5. Call `diamondCut(cut, DiamondInit, initCalldata)` → registers selectors and
   sets initial config.
6. Write `deployed-addresses.json` at the repo root with all facet + Diamond + init addresses.

Defaults if env vars are missing:

- `USDC_ADDRESS = 0x052FA28895F1dd4A8fdF7c373c9dB6F35F1604e9` (Circle Sepolia test USDC).
- `MIN_MERCHANT_STAKE_USDC = "300000000"` → 300 USDC (6-decimal raw).

Post-conditions:

- Diamond owner = deployer.
- Platform admin = deployer (set inside `DiamondInit.init()` from `msg.sender`).

---

`deploy:sepolia`, `deploy:base-sepolia`, and mock-USDC testnet deployment exit
at `scripts/councilGate.js` before environment, signer, or network access.

## 14. Dormant upgrade script

File: [scripts/upgrade.js](scripts/upgrade.js). This is historical local
scaffolding, not an approved upgrade path. Packaged remote upgrade commands are
disabled. A direct invocation accepts only the non-forked in-process `hardhat`
network using the default deterministic development accounts; it rejects
`localhost`, custom signer arrays, non-development mnemonics, and forks before
input or signer access.

Supported historical facet names:

`DiamondCutFacet, DiamondLoupeFacet, OwnershipFacet, ConfigFacet, MerchantFacet`.

For each named facet:

1. Redeploy fresh bytecode.
2. Compute its function selectors.
3. Ask `DiamondLoupe.facetAddress(selector)` per selector to split into
   **existing** (→ `Replace`) vs **new** (→ `Add`).
4. Push the resulting FacetCut entries.

After the loop it executes a single `diamondCut(cut, ZeroAddress, "0x")` — no
`_init` step, so upgrades must not rely on new initialization logic without a
separate initializer contract.

Persists updated addresses back to `deployed-addresses.json` (writes only the
lower-cased key like `merchantFacet`; other keys are left intact).

Caveats:

- The script never emits `Remove` cuts. If a facet drops functions between
  versions, the old selectors keep pointing at the previously deployed facet
  (still reachable at the old address on-chain, still routable through the
  Diamond). Remove them manually with a `Remove` cut when needed.
- `Replace` requires the new facet address to differ from the current one — the
  script always deploys a new instance, so this is naturally satisfied.

---

## 15. Live smoke script

The legacy script is disabled at the council gate before environment, Hardhat,
RPC, or payment-data access. It no longer prints Telegram, bank, account-last4,
UPI, or label fields. Use the redacted transaction-disabled tools under
`scripts/provenance/` for approved pinned-block read-only evidence.

---

## 16. Environment boundary

File: [.env.example](.env.example). No environment variable is required for
compile, tests, or local simulation. Hardhat does not call dotenv, does not
declare a remote network, and does not wire any private key. The example file
intentionally contains no variable assignment. Optional public RPC input for
the transaction-disabled provenance CLIs is documented in
`scripts/provenance/README.md`; it is never a signer input.

---

## 17. Test suite

File: [test/diamond.test.js](test/diamond.test.js). Run:

```bash
npm test
```

Coverage (per `describe` / `it` in the file):

- **Diamond bootstrap** — five facets registered, loupe resolves `facets()` selector.
- **ConfigFacet** — pause/unpause, min-stake update, platform-admin transfer, `onlyAdmin` gating.
- **MerchantFacet — registration & liquidity** — stake pull, min-stake enforcement,
  telegram required, single-registration guard, deposit, withdraw request lifecycle,
  approve/reject unstake.
- **MerchantFacet — availability** — go online/offline; min-liquidity guard on `goOnline`.
- **MerchantFacet — channels** — add / approve / reject; last-4 validation
  (length + all-digits); duplicate guard behavior including case & whitespace
  normalization; migrate-and-terminate; fiat migration; duplicate-guard release
  on reject/terminate.
- **MerchantFacet — admin actions** — blacklist / dispute / clear-dispute
  transitions and pending-unstake cancellation on blacklist.
- **Security fixes** — reentrancy attempts via `ReentrancyAttacker` and
  `ReentrantMaliciousERC20`; misbehaving token via `BadReturnERC20`.
- **DiamondInit** — cannot be re-initialized; requires non-zero USDC.

Helpers imported: `MockERC20`, `BadReturnERC20`, `ReentrancyAttacker`,
`ReentrantMaliciousERC20` (all under [contracts/mocks/](contracts/mocks/)).

---

## 18. Two-role model: Diamond owner vs. Platform admin

There are two distinct privileged roles. Confusing them will lock you out.

| Role | Storage | Set by | Guarded functions |
| --- | --- | --- | --- |
| **Diamond owner** (ERC-173) | `LibDiamond.DiamondStorage.contractOwner` (keccak256 slot) | `Diamond` constructor → deployer; changed via `OwnershipFacet.transferOwnership` | `DiamondCutFacet.diamondCut` — upgrades, add/remove/replace facets |
| **Platform admin** | `AppStorage.config.admin` (slot 0) | `DiamondInit.init` → `msg.sender` at initial cut; changed via `ConfigFacet.transferPlatformAdmin` | Every `onlyAdmin` function: pause/unpause, min-stake, approve/reject channel, approve/reject unstake, blacklist, dispute, clear dispute |

At deploy time both roles land on the deployer address, but they diverge as soon
as you transfer either one. `transferOwnership` does **not** move the platform
admin, and vice versa.

---

## 19. Security invariants & known limitations

**Invariants the code enforces:**

- USDC never leaves the Diamond except in `approveMerchantUnstake` (`safeTransfer`
  to `wallet` for exactly `unstakeRequestedAmount`).
- `usdcLiquidity` accounting is monotonic: increased only by
  `registerMerchant`/`depositStake`, decreased only by `approveMerchantUnstake`,
  always matched 1:1 with the corresponding USDC ERC-20 movement.
- Reentrancy is blocked across all facets by the shared `AppStorage._reentrancyStatus`
  slot, primed at init to `1` so the first `nonReentrant` call doesn't pay a cold
  slot.
- `DiamondInit.init()` can only run once (guarded by `s.config.initialized`).
- Channel `accountLast4` is exactly 4 ASCII digits; bank-name comparisons use a
  normalized (trimmed + lowercased-ASCII) key so `"SBI"`, `"sbi"`, `" SBI "` all
  collide in the duplicate guard.

**Known limitations / footguns:**

- **`withdrawStake` is all-or-nothing.** It snapshots the *entire* current
  liquidity. No partial withdrawal API exists — merchants who want to pull only
  part of their liquidity have no on-chain path today.
- **`getPendingChannels()` is O(merchants × channels)** per call — fine for
  early deployments, will need an off-chain indexer at scale.
- **No un-blacklist.** `blacklistMerchant` is terminal on-chain.
- **`rejectMerchantUnstake` and `clearMerchantDispute` don't restore availability.**
  The merchant is back to `ACTIVE` but must call `goOnline()` themselves.
- **USDC token address is immutable after init.** There's no `setUsdcToken`
  facet. Swapping the escrow token requires a targeted facet upgrade.
- **`TREASURY` env var is inert.** No fees are collected or routed in the
  current facets.
- **Upgrade script does not emit `Remove` cuts.** Selectors dropped between
  versions keep pointing at previously deployed bytecode until manually removed.
- **ERC-20 assumption.** The system assumes a 6-decimal USDC-like token. Using
  a token with different decimals will silently produce wrong on-screen numbers
  everywhere (contract accounting stays consistent, but every `min stake`,
  `fiatBalance`, etc. is interpreted with 6 decimals downstream).
- **No pull-payment for direct ERC-20 sends.** If someone accidentally sends
  USDC (or any ERC-20) directly to the Diamond without going through
  `registerMerchant`/`depositStake`, there's no rescue function.

---

## 20. Frontend integration cheatsheet

Minimal ABI slices you need per feature:

- **Read config**: `ConfigFacet.getConfig() → PlatformConfig`.
- **Register**: `USDC.approve(diamond, stake)` → `MerchantFacet.registerMerchant(stake, telegramUsername)`.
- **Top up**: `USDC.approve(diamond, amount)` → `MerchantFacet.depositStake(amount)`.
- **Withdraw** (merchant side): `MerchantFacet.withdrawStake()` (no args, full liquidity).
- **Withdraw** (admin side): `MerchantFacet.approveMerchantUnstake(wallet)` or
  `rejectMerchantUnstake(wallet)`.
- **Online/offline**: `MerchantFacet.goOnline()` / `goOffline()`.
- **Add channel**: `MerchantFacet.addPaymentChannel(bankName, accountLast4, upiId, label)`.
- **Channel review** (admin): `MerchantFacet.approveChannel(channelId)` / `rejectChannel(channelId)`.
- **Channel availability** (merchant): `setPaymentChannelActive(channelId)` / `setPaymentChannelInactive(channelId)`.
- **Migrate + close**: `MerchantFacet.migrateAndTerminate(fromId, toId)`.
- **Admin ops**: `blacklistMerchant`, `setMerchantDisputed`, `clearMerchantDispute`.
- **Pause / config**: `ConfigFacet.pausePlatform`, `unpausePlatform`,
  `setMinMerchantStake`, `transferPlatformAdmin`.
- **Introspection**: `IDiamondLoupe.facets()`, `facetAddress(bytes4)`,
  `supportsInterface(bytes4)`.

Call every business function against the **Diamond address** — never the
individual facet addresses. Facet addresses are only useful for verification
via the loupe or for deployment scripting.

Amount encoding: all USDC-denominated numbers on the wire are 6-decimal raw
integers. `1 USDC == 1_000_000n` in ethers v6.
