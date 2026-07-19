# P2PFlow Smart Contract Core Guide

This document explains the current smart-contract system as it exists today, how the Diamond is structured, how merchants/orders/payment channels flow, how matching works, what time-based actions can and cannot do on-chain, and what must be done before deploying to Base Sepolia with a mock USDC/faucet and subgraph.

Use this as the single reference before requesting contract changes.

---

## 1. High-Level Architecture

The protocol uses an EIP-2535 Diamond.

The Diamond is one proxy contract. It owns all storage and routes function calls to facet contracts using `delegatecall`.

Current core parts:

- `contracts/Diamond.sol` — the proxy and fallback router.
- `contracts/shared/AppStorage.sol` — the single shared storage layout used by all facets.
- `contracts/facets/DiamondCutFacet.sol` — upgrade function `diamondCut`.
- `contracts/facets/DiamondLoupeFacet.sol` — inspection functions for facets/selectors.
- `contracts/facets/OwnershipFacet.sol` — Diamond owner reads/transfers.
- `contracts/facets/ConfigFacet.sol` — platform admin config, pricing, whitelist.
- `contracts/facets/MerchantFacet.sol` — merchant registration, stake, channels, admin merchant controls.
- `contracts/facets/OrderFacet.sol` — BUY/SELL order creation, matching, acceptance, payment, completion, disputes.
- `contracts/upgradeInitializers/DiamondInit.sol` — initial Diamond storage initialization.

Important idea:

```text
User/Admin/Merchant calls Diamond address
    -> Diamond fallback looks up msg.sig
    -> delegatecall to owning facet
    -> facet code runs using Diamond storage
```

So even if a function lives in `OrderFacet`, all state is stored in the Diamond.

---

## 2. AppStorage: Enums, Structs, Variables

File: `contracts/shared/AppStorage.sol`

### 2.1 MerchantAccountStatus

```solidity
enum MerchantAccountStatus {
    ACTIVE,
    INACTIVE,
    BLACKLISTED,
    DISPUTED
}
```

Meaning:

- `ACTIVE` — merchant can operate and can be assigned orders.
- `INACTIVE` — merchant requested unstake; waiting for admin approve/reject.
- `BLACKLISTED` — admin blocked merchant.
- `DISPUTED` — merchant is under dispute and should not receive new orders.

Order matching checks `ACTIVE`. Any other status blocks assignment.

### 2.2 MerchantAvailability

```solidity
enum MerchantAvailability {
    ONLINE,
    OFFLINE
}
```

Meaning:

- Merchant-facing presence toggle.
- `goOnline()` requires account status `ACTIVE`. It no longer checks minimum liquidity.
- `goOffline()` only requires the caller to be a merchant.

Important current behavior:

- BUY matching currently ignores `ONLINE/OFFLINE` and only checks account status/liquidity.
- SELL matching checks channel availability, not merchant availability directly.
- If you want online/offline to control assignment, that requires a contract change.

### 2.3 ChannelStatus

```solidity
enum ChannelStatus {
    PENDING,
    APPROVED,
    REJECTED,
    TERMINATED
}
```

Meaning:

- `PENDING` — merchant submitted channel; admin has not reviewed.
- `APPROVED` — admin approved channel.
- `REJECTED` — admin rejected channel.
- `TERMINATED` — merchant migrated/closed channel.

### 2.4 ChannelAvailability

```solidity
enum ChannelAvailability {
    ACTIVE,
    INACTIVE
}
```

Meaning:

- Merchant toggles approved channels active/inactive.
- SELL matching requires channel `APPROVED` and `ACTIVE`.

### 2.5 OrderType

```solidity
enum OrderType {
    BUY,
    SELL
}
```

From user perspective:

- `BUY` — user wants USDC, pays INR off-chain to merchant.
- `SELL` — user gives USDC, receives INR off-chain from merchant.

### 2.6 OrderStatus

```solidity
enum OrderStatus {
    CREATED,
    ACCEPTED,
    PAID,
    COMPLETED,
    CANCELLED
}
```

Meaning:

- `CREATED` — order exists and was assigned to candidate merchants; none accepted yet.
- `ACCEPTED` — one merchant accepted and reserves required liquidity/fiat.
- `PAID` — BUY only: user marked INR sent; merchant still needs to confirm.
- `COMPLETED` — order is complete.
- `CANCELLED` — user cancelled before acceptance.

SELL skips visible `PAID` as a lasting state because merchant `markPaymentSent` completes SELL atomically.

### 2.7 DisputeStatus

```solidity
enum DisputeStatus {
    NONE,
    OPEN,
    SETTLED
}
```

Meaning:

- `NONE` — no dispute.
- `OPEN` — dispute raised and waiting for admin resolution.
- `SETTLED` — dispute resolved or risk window settled.

### 2.8 DisputeResult

```solidity
enum DisputeResult {
    NONE,
    USER_WINS,
    MERCHANT_WINS
}
```

Meaning:

- `USER_WINS` — user gets USDC returned; merchant liquidity is slashed.
- `MERCHANT_WINS` — merchant keeps USDC; risk is released.

### 2.9 Order Struct

```solidity
struct Order {
    bytes32 orderId;
    OrderType orderType;
    OrderStatus status;
    address user;
    address merchant;
    bytes32 channelId;
    uint256 usdcAmount;
    uint256 fiatAmount;
    uint256 price;
    uint256 createdAt;
    uint256 acceptedAt;
    uint256 paidAt;
    uint256 completedAt;
    uint256 cancelledAt;
    uint256 disputeExpiresAt;
    DisputeStatus disputeStatus;
    address disputeResolver;
    DisputeResult disputeResult;
    address[] assignedMerchants;
    bool riskReleased;
}
```

Notes:

- `merchant` is zero until accepted.
- `channelId` is zero until accepted.
- `usdcAmount` uses 6 decimals.
- `fiatAmount = usdcAmount * price`, still effectively 6-decimal scaled.
- `price` is INR per whole USDC as an integer.
- `disputeExpiresAt` is only set for completed SELL orders.
- `riskReleased` is relevant for SELL risk settlement.

### 2.10 Merchant Struct

```solidity
struct Merchant {
    address wallet;
    MerchantAccountStatus accountStatus;
    MerchantAvailability availability;
    uint256 usdcLiquidity;
    bool unstakePending;
    uint256 unstakeRequestedAmount;
    string telegramUsername;
    uint256 registeredAt;
    bytes32[] channelIds;
    uint256 reservedUsdc;
    uint256 riskUsdc;
}
```

Meaning:

- `usdcLiquidity` — total USDC custodied for merchant.
- `reservedUsdc` — USDC reserved for BUY orders accepted but not completed.
- `riskUsdc` — SELL completion credit still inside dispute window.
- `unreservedUsdc = usdcLiquidity - reservedUsdc - riskUsdc`.
- `unstakePending` and `unstakeRequestedAmount` track admin-reviewed full unstake.

### 2.11 PaymentChannel Struct

```solidity
struct PaymentChannel {
    bytes32 channelId;
    address merchant;
    string bankName;
    string accountLast4;
    string upiId;
    string label;
    ChannelStatus status;
    ChannelAvailability availability;
    uint256 fiatBalance;
    uint256 appliedAt;
    uint256 reviewedAt;
    uint256 __deprecated_dailyLimitUsdc;
    uint256 __deprecated_monthlyLimitUsdc;
    uint256 dailyVolumeUsed;
    uint256 dailyWindowStart;
    uint256 monthlyVolumeUsed;
    uint256 monthlyWindowStart;
    uint256 reservedFiat;
}
```

Meaning:

- `fiatBalance` is channel fiat balance in 6-decimal INR-equivalent units.
- `reservedFiat` is fiat committed to accepted SELL orders.
- `unreservedFiat = fiatBalance - reservedFiat`.
- The deprecated limit fields remain only to avoid storage layout shifts.
- Rolling-window usage exists in storage, but today `OrderFacet` does not call `LibMerchants.consumeChannelVolume`, so volume enforcement is not active in order flow yet.

### 2.12 PlatformConfig Struct

```solidity
struct PlatformConfig {
    address admin;
    address usdcToken;
    bool paused;
    uint256 minMerchantStakeUsdc;
    bool initialized;
}
```

Meaning:

- `admin` controls platform/admin functions.
- `usdcToken` is token contract used for stake/order escrow.
- `paused` blocks functions with `notPaused`.
- `minMerchantStakeUsdc` is the minimum stake required for registration. It is not checked by `goOnline` in the current development-test version.
- `initialized` prevents re-running DiamondInit.

### 2.13 AppStorage Variables

Main state variables:

- `config` — platform config.
- `merchants[address]` — merchant records by wallet.
- `merchantList` — registered merchant addresses.
- `channels[bytes32]` — payment channels by channel id.
- `channelDuplicateGuard[bytes32]` — prevents duplicate bank/account channel registrations.
- `_reentrancyStatus` — shared lock across facets.
- `defaultChannelDailyLimitUsdc`, `defaultChannelMonthlyLimitUsdc` — platform channel limits.
- `buyPriceInrPerUsdc`, `sellPriceInrPerUsdc` — hardcoded oracle prices.
- `disputeWindowSeconds` — post-completion SELL dispute window.
- `orderNonce` — deterministic order id nonce.
- `orders[bytes32]` — order records.
- `orderIds` — every order id.
- `userOrderIds[address]` — per-user order ids.
- `merchantOrderIds[address]` — per-merchant accepted order ids.
- `orderAssignmentIndex[orderId][merchant]` — O(1) assigned merchant lookup.
- `eligibleMerchants[]` — optional order-router whitelist.
- `eligibleMerchantIndex[address]` — 1-based whitelist index.

---

## 3. Diamond Core

### 3.1 `Diamond.sol`

The Diamond is the proxy contract.

Constructor:

1. Sets Diamond owner in `LibDiamond` storage.
2. Registers `diamondCut()` from `DiamondCutFacet`.

Fallback:

1. Reads `msg.sig`.
2. Finds facet address in `LibDiamond.DiamondStorage.selectorToFacetAndPosition`.
3. `delegatecall`s the facet.
4. Returns/reverts with facet result.

### 3.2 `DiamondCutFacet.sol`

Function:

- `diamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata)`

Purpose:

- Add, replace, or remove facet functions.
- Can optionally delegatecall an initializer after cut.
- Only Diamond owner can call.

### 3.3 `DiamondLoupeFacet.sol`

Functions:

- `facets()` — returns all facets and selectors.
- `facetFunctionSelectors(address)` — selectors owned by one facet.
- `facetAddresses()` — all facet addresses.
- `facetAddress(bytes4)` — facet for a selector.
- `supportsInterface(bytes4)` — ERC-165 support.

Purpose:

- Inspect the Diamond.
- Required by EIP-2535.

### 3.4 `OwnershipFacet.sol`

Functions:

- `owner()` — Diamond owner.
- `transferOwnership(address)` — owner-only transfer.

Important distinction:

- Diamond owner controls upgrades.
- Platform admin controls protocol/admin functions.
- They are both set to deployer during initial deployment, but can diverge.

---

## 4. ConfigFacet Functions

File: `contracts/facets/ConfigFacet.sol`

### Read Functions

- `getConfig()`
  - Returns `PlatformConfig`.
- `getChannelLimitDefaults()`
  - Returns platform default daily/monthly channel limits.
- `getOrderPricing()`
  - Returns `buyPriceInrPerUsdc`, `sellPriceInrPerUsdc`, `disputeWindowSeconds`.
- `getEligibleMerchants()`
  - Returns whitelist array.
- `isEligibleMerchant(address)`
  - Returns whether merchant is present in whitelist.

### Admin Write Functions

- `pausePlatform()`
  - Sets `paused = true`.
- `unpausePlatform()`
  - Sets `paused = false`.
- `setMinMerchantStake(uint256)`
  - Updates minimum merchant stake.
- `setDefaultChannelLimits(uint256 dailyUsdc, uint256 monthlyUsdc)`
  - Updates default per-channel ceilings.
  - Requires monthly >= daily if both nonzero.
- `transferPlatformAdmin(address newAdmin)`
  - Changes platform admin.
- `setOrderPricing(uint256 buyPrice, uint256 sellPrice)`
  - Updates hardcoded BUY/SELL prices.
  - If either price is 0, that order direction is disabled by creation checks.
- `setDisputeWindow(uint256 seconds)`
  - Updates dispute window for new SELL completions.
  - Existing `disputeExpiresAt` values are not changed.
- `addEligibleMerchant(address)`
  - Adds a registered merchant to whitelist.
  - Idempotent if already present.
- `removeEligibleMerchant(address)`
  - Removes merchant from whitelist using swap-pop.
  - No-op if absent.
- `clearEligibleMerchants()`
  - Clears whitelist.
  - Empty whitelist means all active merchants are considered by router.

---

## 5. MerchantFacet Functions

File: `contracts/facets/MerchantFacet.sol`

### 5.1 Registration and Stake

#### `registerMerchant(uint256 stakeAmount, string telegramUsername)`

Requirements:

- Caller is not already registered.
- `stakeAmount >= minMerchantStakeUsdc`.
- Telegram username is non-empty.
- Platform not paused.

Effects:

- Transfers USDC from caller to Diamond.
- Creates merchant record.
- Sets account status `ACTIVE`.
- Sets availability `ONLINE`.
- Sets `usdcLiquidity = stakeAmount`.
- Adds wallet to `merchantList`.

Events:

- `MerchantRegistered(wallet, stakeAmount)`.

#### `depositStake(uint256 amount)`

Requirements:

- Caller is registered.
- Account status is `ACTIVE`.
- No unstake pending.
- Amount > 0.
- Platform not paused.

Effects:

- Transfers USDC from caller to Diamond.
- Increases `usdcLiquidity`.

Events:

- `UsdcDeposited(wallet, amount)`.

#### `withdrawStake()`

Requirements:

- Caller is registered.
- Account status is `ACTIVE`.
- No unstake pending.
- `usdcLiquidity > 0`.

Effects:

- Does not transfer USDC immediately.
- Sets `unstakePending = true`.
- Sets `unstakeRequestedAmount = usdcLiquidity`.
- Sets account status `INACTIVE`.
- Sets availability `OFFLINE`.

Events:

- `UnstakeRequested(wallet, amount)`.

Why admin review?

- The contract snapshots full liquidity and blocks the merchant from assignments until admin approve/reject.

#### `approveMerchantUnstake(address wallet)`

Admin only.

Requirements:

- Merchant exists.
- `unstakePending == true`.
- Account status is `INACTIVE`.
- `unstakeRequestedAmount > 0` and liquidity is enough.

Effects:

- Decreases `usdcLiquidity` by requested amount.
- Clears unstake request.
- Sets account status back to `ACTIVE`.
- Transfers USDC to merchant wallet.

Events:

- `UsdcWithdrawn(wallet, amount)`.

Important current behavior:

- After full unstake, merchant becomes `ACTIVE` with lower or zero liquidity.
- `goOnline()` will still require the merchant account to be `ACTIVE`, but it does not check minimum liquidity in the current development-test version.

#### `rejectMerchantUnstake(address wallet)`

Admin only.

Effects:

- Clears unstake request.
- Sets account status back to `ACTIVE`.
- Does not transfer USDC.

Events:

- `UnstakeRequestRejected(wallet)`.

### 5.2 Availability

#### `goOnline()`

Requirements:

- Caller is registered.
- Account status is `ACTIVE`.
- Platform not paused.

Effects:

- Sets availability `ONLINE`.

Events:

- `AvailabilityChanged(wallet, ONLINE)`.

#### `goOffline()`

Requirements:

- Caller is registered.

Effects:

- Sets availability `OFFLINE`.

Events:

- `AvailabilityChanged(wallet, OFFLINE)`.

Important current matching note:

- The current order router does not fully use merchant `ONLINE/OFFLINE` as an assignment gate.
- If product decision is “offline merchants should never receive orders,” we must update `LibOrders.isBuyEligible` and SELL assignment logic to require `m.availability == ONLINE`.

### 5.3 Payment Channels

#### `addPaymentChannel(string bankName, string accountLast4, string upiId, string label)`

Requirements:

- Caller is registered.
- Account status is `ACTIVE`.
- Bank name non-empty after normalization.
- Account last4 is exactly 4 ASCII digits.
- UPI ID and label non-empty.
- Channel duplicate guard not already used.
- Platform not paused.

Duplicate guard key:

```solidity
keccak256(wallet, normalizedBankName, accountLast4)
```

Effects:

- Generates deterministic channel id:
  - `keccak256("CHANNEL", wallet, channelCount, chainId)`.
- Creates channel with status `PENDING` and availability `INACTIVE`.
- Adds channel id to merchant.

Events:

- `ChannelAdded(channelId, wallet)`.

#### `approveChannel(bytes32 channelId)`

Admin only.

Requirements:

- Channel exists.
- Channel status is `PENDING`.

Effects:

- Sets status `APPROVED`.
- Sets availability `ACTIVE`.
- Sets reviewed timestamp.

Events:

- `ChannelApproved(channelId, merchant)`.

#### `rejectChannel(bytes32 channelId)`

Admin only.

Requirements:

- Channel exists.
- Channel status is `PENDING`.

Effects:

- Sets status `REJECTED`.
- Sets availability `INACTIVE`.
- Clears duplicate guard so merchant can submit corrected details.

Events:

- `ChannelRejected(channelId, merchant)`.

#### `setPaymentChannelActive(bytes32 channelId)`

Merchant only.

Requirements:

- Caller owns channel.
- Merchant exists and account status is `ACTIVE`.
- Channel status is `APPROVED`.
- Platform not paused.

Effects:

- Sets channel availability `ACTIVE`.

Events:

- `ChannelAvailabilityChanged(channelId, wallet, ACTIVE)`.

#### `setPaymentChannelInactive(bytes32 channelId)`

Merchant only.

Requirements:

- Caller owns approved channel.

Effects:

- Sets channel availability `INACTIVE`.

Events:

- `ChannelAvailabilityChanged(channelId, wallet, INACTIVE)`.

#### `migrateAndTerminate(bytes32 fromChannelId, bytes32 toChannelId)`

Merchant only.

Requirements:

- Account status `ACTIVE`.
- Both channels belong to merchant.
- Both channels are `APPROVED`.
- Source and target differ.
- Platform not paused.

Effects:

- Moves all `fiatBalance` from source to target.
- Sets source status `TERMINATED` and availability `INACTIVE`.
- Clears source duplicate guard.

Events:

- `FiatMigrated` if amount > 0.
- `ChannelTerminated`.

### 5.4 Admin Merchant Controls

#### `blacklistMerchant(address wallet)`

Admin only.

Effects:

- Clears pending unstake if present.
- Sets account status `BLACKLISTED`.
- Sets availability `OFFLINE`.

Events:

- `MerchantBlacklisted(wallet)`.

#### `setMerchantDisputed(address wallet)`

Admin only.

Requirements:

- Merchant exists.
- Account status is `ACTIVE`.

Effects:

- Sets account status `DISPUTED`.
- Sets availability `OFFLINE`.

Events:

- `MerchantDisputed(wallet)`.

#### `clearMerchantDispute(address wallet)`

Admin only.

Requirements:

- Merchant is currently `DISPUTED`.

Effects:

- Sets account status back to `ACTIVE`.

Events:

- `MerchantDisputeCleared(wallet)`.

### 5.5 Merchant Views

- `getMyProfile()` — caller merchant profile.
- `getMerchant(address)` — profile by wallet.
- `getAllMerchants()` — registered merchant list.
- `getChannel(bytes32)` — channel data.
- `getChannelLimits(bytes32)` — platform default limits and projected reset times.
- `getMerchantChannels(address)` — all channels for merchant.
- `getMyChannels()` — caller channels.
- `getPendingChannels()` — all pending channel ids.

---

## 6. OrderFacet Functions

File: `contracts/facets/OrderFacet.sol`

### 6.1 BUY Order Creation

#### `createBuyOrder(uint256 usdcAmount)`

User wants USDC and will pay INR off-chain.

Requirements:

- Platform not paused.
- `usdcAmount > 0`.
- `buyPriceInrPerUsdc > 0`.
- At least one eligible merchant found.

Effects:

- Computes fiat amount:
  - `fiatAmount = usdcAmount * buyPriceInrPerUsdc`.
- Creates order with status `CREATED`.
- Assigns up to 4 merchants.
- Does not move USDC yet.

Events:

- `OrderCreated`.
- One `OrderAssigned` per assigned merchant.

### 6.2 SELL Order Creation

#### `createSellOrder(uint256 usdcAmount)`

User gives USDC and will receive INR off-chain.

Requirements:

- Platform not paused.
- `usdcAmount > 0`.
- `sellPriceInrPerUsdc > 0`.
- User approved Diamond to pull USDC.
- At least one eligible merchant/channel found.

Effects:

- Pulls USDC from user into Diamond.
- Computes fiat amount:
  - `fiatAmount = usdcAmount * sellPriceInrPerUsdc`.
- Creates order with status `CREATED`.
- Assigns up to 4 merchants with sell capacity.

If no merchants found:

- Reverts whole transaction, so USDC transfer is reverted too.

### 6.3 Merchant Acceptance

#### `acceptOrder(bytes32 orderId, bytes32 channelId)`

Requirements:

- Platform not paused.
- Order status is `CREATED`.
- Caller was assigned.
- Caller merchant account status is `ACTIVE`.
- Channel belongs to caller.
- Channel status is `APPROVED`.
- Channel availability is `ACTIVE`.

BUY acceptance:

- Requires merchant unreserved USDC >= order USDC.
- Increases merchant `reservedUsdc`.

SELL acceptance:

- Requires channel unreserved fiat >= order fiat.
- Increases channel `reservedFiat`.

Effects:

- Sets order status `ACCEPTED`.
- Sets `merchant`, `channelId`, `acceptedAt`.
- Pushes order to `merchantOrderIds`.

Events:

- `OrderAccepted`.

### 6.4 Payment Marking

#### `markPaymentSent(bytes32 orderId)`

For BUY:

- Caller must be user.
- Order must be `ACCEPTED`.
- Sets status `PAID`.
- Sets `paidAt`.
- Merchant later calls `confirmPayment`.

For SELL:

- Caller must be merchant.
- Order must be `ACCEPTED`.
- Sets `paidAt`.
- Completes order atomically through `_completeSellOrder`.

Events:

- `OrderPaid`.
- For SELL also `OrderCompleted`.

### 6.5 BUY Completion

#### `confirmPayment(bytes32 orderId)`

Merchant confirms INR received for BUY order.

Requirements:

- Platform not paused.
- Order type is `BUY`.
- Order status is `PAID`.
- Caller is accepted merchant.

Effects:

- Decreases merchant `reservedUsdc`.
- Decreases merchant `usdcLiquidity` by order USDC.
- Credits channel `fiatBalance` by order fiat amount.
- Sets order `COMPLETED`.
- Transfers USDC from Diamond to user.

Events:

- `OrderCompleted(orderId, merchant, completedAt, 0)`.

### 6.6 User Cancellation

#### `cancelOrder(bytes32 orderId)`

Requirements:

- Caller is order user.
- Order status is `CREATED`.

Effects:

- Sets status `CANCELLED`.
- Sets `cancelledAt`.
- If SELL, refunds escrowed USDC to user.

Events:

- `OrderCancelled`.

Current limitation:

- Only user can cancel.
- Only `CREATED` orders can be cancelled.
- No automatic deadline is enforced yet.

### 6.7 SELL Settlement

#### `settleOrder(bytes32 orderId)`

After a SELL order completes, merchant gets USDC credited into `riskUsdc`. That risk cannot be reused until dispute window expires or admin resolves dispute.

Requirements:

- Order type is `SELL`.
- Status is `COMPLETED`.
- `riskReleased == false`.
- Dispute is not open.
- Current timestamp >= `disputeExpiresAt`.

Effects:

- Decreases merchant `riskUsdc`.
- Sets `riskReleased = true`.
- If no dispute existed, sets dispute status `SETTLED`.

Events:

- `OrderRiskReleased`.

### 6.8 Disputes

#### `raiseDispute(bytes32 orderId)`

Requirements:

- Caller is the order user.
- Order type is `SELL`.
- Order status is `COMPLETED`.
- Dispute status is `NONE`.
- Risk not released.
- Current timestamp < `disputeExpiresAt`.

Effects today:

- Sets order dispute status `OPEN`.
- Sets merchant account status `DISPUTED` if currently `ACTIVE`.
- Sets merchant availability `OFFLINE`.
- Emits `MerchantDisputed` and `DisputeRaised`.

Why this matters:

- Order assignment requires merchant `ACTIVE` status.
- Once disputed, the merchant cannot be matched for new orders until dispute is resolved/cleared.

#### `resolveDispute(bytes32 orderId, DisputeResult result)`

Admin only.

Requirements:

- Result is `USER_WINS` or `MERCHANT_WINS`.
- Dispute is open.
- Risk not released.

MERCHANT_WINS:

- Decreases `riskUsdc`.
- Merchant keeps USDC.
- Marks risk released.

USER_WINS:

- Decreases `riskUsdc`.
- Decreases merchant `usdcLiquidity` by order USDC.
- Transfers USDC back to user.
- Marks risk released.

Common effects:

- Sets dispute status `SETTLED`.
- Sets resolver and result.
- If merchant was `DISPUTED`, sets merchant back to `ACTIVE`.
- Emits `MerchantDisputeCleared` and `DisputeResolved`.

### 6.9 Order Views

- `getOrder(bytes32)` — order struct.
- `getOrderIds()` — all order ids.
- `getUserOrders(address)` — user order ids.
- `getMerchantOrders(address)` — merchant accepted order ids.
- `getAssignedMerchants(bytes32)` — assignment list.
- `getMerchantBalances(address)` — total/reserved/risk/unreserved USDC.
- `getChannelFiat(bytes32)` — total/reserved/unreserved fiat.

---

## 7. Order Matching Rules

Matching happens when order is created.

The router assigns up to `LibOrders.MAX_ASSIGNMENTS`, currently 4 merchants.

### 7.1 Candidate Pool

Internal function: `_candidatePool()` in `OrderFacet`.

Rule:

```text
if eligibleMerchants.length > 0:
    iterate eligibleMerchants whitelist
else:
    iterate all merchantList
```

This means:

- Empty whitelist = all registered merchants are eligible candidates.
- Non-empty whitelist = only whitelisted merchants are considered.

Whitelist is managed by `ConfigFacet`.

### 7.2 BUY Matching

Internal function: `_assignBuyMerchants(orderId, usdcAmount)`.

For each candidate merchant:

```solidity
LibOrders.isBuyEligible(s.merchants[addr], usdcAmount)
```

`isBuyEligible` requires:

- Merchant account status is `ACTIVE`.
- Merchant unreserved USDC >= requested USDC.

Formula:

```text
unreservedUsdc = usdcLiquidity - reservedUsdc - riskUsdc
```

Current important note:

- BUY matching does **not** check `MerchantAvailability.ONLINE`.
- This was explicitly documented in `LibOrders.sol` as “ignore online/offline”.
- If product wants offline merchants excluded, change `isBuyEligible` to also require `m.availability == MerchantAvailability.ONLINE`.

### 7.3 SELL Matching

Internal function: `_assignSellMerchants(orderId, fiatAmount)`.

For each candidate merchant:

1. Merchant account status must be `ACTIVE`.
2. Merchant must have at least one SELL-eligible channel.

Channel eligibility uses `LibOrders.isSellEligibleChannel`.

Channel must satisfy:

- Channel status `APPROVED`.
- Channel availability `ACTIVE`.
- Channel unreserved fiat >= required fiat amount.

Formula:

```text
unreservedFiat = fiatBalance - reservedFiat
```

Current important note:

- SELL matching checks merchant `ACTIVE`, but not merchant `ONLINE`.
- It does check channel `ACTIVE`.
- If product wants offline merchants excluded from SELL too, change `_assignSellMerchants` to also require `m.availability == MerchantAvailability.ONLINE`.

### 7.4 First Accept Wins

Order creation assigns up to 4 merchants, but no merchant is locked until one accepts.

`acceptOrder` requires:

- Order status is still `CREATED`.
- Caller is in `orderAssignmentIndex[orderId]`.

The first assigned merchant who calls `acceptOrder` wins. The order becomes `ACCEPTED`, and later accept attempts revert because status is no longer `CREATED`.

---

## 8. Flow Walkthroughs

### 8.1 Merchant Registration Flow

```text
Merchant wallet approves USDC to Diamond
    -> registerMerchant(stakeAmount, telegramUsername)
    -> Diamond pulls stake USDC
    -> merchant account ACTIVE + ONLINE
    -> merchant can add payment channel
```

Steps:

1. Merchant must have test USDC.
2. Merchant approves Diamond to spend USDC.
3. Merchant calls `registerMerchant`.
4. Contract creates merchant profile.
5. Merchant can add payment channel.

Failure cases:

- Already registered.
- Stake below minimum.
- Telegram empty.
- USDC allowance/balance insufficient.
- Platform paused.

### 8.2 Payment Channel Flow

```text
Merchant adds channel
    -> channel PENDING + INACTIVE
Admin reviews
    -> approveChannel => APPROVED + ACTIVE
    -> rejectChannel => REJECTED + INACTIVE
Merchant can later toggle active/inactive
```

Steps:

1. Merchant calls `addPaymentChannel` with bank, last4, UPI, label.
2. Admin sees pending channel in admin/subgraph.
3. Admin approves or rejects.
4. Approved channel starts active.
5. Merchant can toggle channel active/inactive.

Important:

- SELL orders need channel fiat balance.
- BUY completion credits merchant channel fiat balance.
- Channel fiat balance represents off-chain fiat accounting in contract storage.

### 8.3 BUY Order Flow

User wants to buy USDC.

```text
User createBuyOrder(usdcAmount)
    -> contract computes fiat amount
    -> assigns up to 4 eligible merchants with enough unreserved USDC
Merchant accepts with approved active channel
    -> merchant reservedUsdc increases
User pays INR off-chain
User markPaymentSent(orderId)
    -> status PAID
Merchant confirms payment
Merchant confirmPayment(orderId)
    -> reservedUsdc decreases
    -> merchant usdcLiquidity decreases
    -> channel fiatBalance increases
    -> USDC transfers to user
    -> order COMPLETED
```

State transitions:

```text
CREATED -> ACCEPTED -> PAID -> COMPLETED
```

Cancellation:

- User can cancel only while `CREATED`.

No dispute window for BUY today.

### 8.4 SELL Order Flow

User wants to sell USDC.

```text
User approves USDC to Diamond
User createSellOrder(usdcAmount)
    -> Diamond pulls USDC from user
    -> computes fiat amount
    -> assigns merchants with approved active channels and enough unreserved fiat
Merchant accepts with channel
    -> channel reservedFiat increases
Merchant sends INR off-chain
Merchant markPaymentSent(orderId)
    -> reservedFiat decreases
    -> fiatBalance decreases
    -> merchant usdcLiquidity increases
    -> merchant riskUsdc increases
    -> order COMPLETED
    -> dispute window starts
```

State transitions:

```text
CREATED -> ACCEPTED -> COMPLETED
```

SELL dispute window:

- During dispute window, credited USDC is in `riskUsdc`.
- Risk USDC cannot be reused in matching because unreserved = total - reserved - risk.

After dispute window:

```text
settleOrder(orderId)
    -> riskUsdc decreases
    -> riskReleased = true
    -> disputeStatus SETTLED if no dispute
```

If dispute:

```text
raiseDispute(orderId)
    -> dispute OPEN
    -> merchant DISPUTED + OFFLINE
    -> no new assignments while DISPUTED
Admin resolveDispute(...)
    -> risk released
    -> user wins or merchant wins accounting
    -> merchant ACTIVE again
```

### 8.5 Merchant Unstake Flow

```text
Merchant withdrawStake()
    -> account INACTIVE
    -> availability OFFLINE
    -> unstakePending true
Admin review
    -> approveMerchantUnstake(wallet): transfer USDC to merchant
    -> rejectMerchantUnstake(wallet): restore account active, no transfer
```

Important:

- While `INACTIVE`, merchant cannot receive new assignments because matching requires `ACTIVE`.
- After approve, account becomes `ACTIVE`, but if liquidity is below min stake, `goOnline()` fails.

---

## 9. Time-Based Logic And Auto-Cancel

Question: Can a smart contract automatically cancel an order after 10 minutes if the user does not mark as paid?

Short answer:

```text
No, smart contracts do not execute by themselves.
```

Ethereum/Base contracts only run when someone sends a transaction. A contract can check time using `block.timestamp`, but some caller must trigger the function.

### 9.1 What Is Possible

You can implement time-based behavior like this:

1. Store a deadline in the order, for example:

```solidity
uint256 acceptExpiresAt;
uint256 paymentExpiresAt;
```

2. Add a public function callable by anyone:

```solidity
function cancelExpiredOrder(bytes32 orderId) external
```

3. Inside the function:

```solidity
require(block.timestamp >= deadline, "Not expired");
```

4. Release reservations/refund escrow and mark order cancelled.

5. Use one of these actors to call it:

- User clicking “Cancel expired order”.
- Merchant clicking “Release expired order”.
- Admin backend/keeper.
- Chainlink Automation.
- Gelato Automate.
- Any public keeper bot.

### 9.2 Current Contract Time-Based Features

Already implemented:

- SELL dispute window via `disputeExpiresAt`.
- `settleOrder(orderId)` can be called after dispute window expires.

Not implemented yet:

- Auto-cancel CREATED orders after assignment timeout.
- Auto-cancel ACCEPTED BUY if user does not mark paid within 10 minutes.
- Auto-cancel ACCEPTED SELL if merchant does not mark payment sent within 10 minutes.
- Auto-reassign expired orders. This is not required for now; keep reassignment out until product asks for it.

### 9.3 Recommended Timeout Design

Add to `Order` struct, appended carefully if storage layout allows:

```solidity
uint256 acceptExpiresAt;   // after CREATED
uint256 paymentExpiresAt;  // after ACCEPTED
```

Add config values:

```solidity
uint256 acceptTimeoutSeconds;
uint256 paymentTimeoutSeconds;
```

Suggested defaults:

- `acceptTimeoutSeconds = 10 minutes`.
- `paymentTimeoutSeconds = 10 minutes`.

New functions:

```solidity
function cancelExpiredOrder(bytes32 orderId) external nonReentrant
function setOrderTimeouts(uint256 acceptTimeout, uint256 paymentTimeout) external onlyAdmin
```

Expiration rules:

#### CREATED timeout

If no merchant accepts before `acceptExpiresAt`:

- Set status `CANCELLED`.
- If SELL, refund user escrowed USDC.
- Emit `OrderCancelled`.

#### ACCEPTED BUY payment timeout

If user does not call `markPaymentSent` before `paymentExpiresAt`:

- Release merchant `reservedUsdc`.
- Set status `CANCELLED`.
- Emit `OrderCancelled`.

#### ACCEPTED SELL merchant payment timeout

If merchant does not call `markPaymentSent` before `paymentExpiresAt`:

- Release channel `reservedFiat`.
- Refund user escrowed USDC.
- Set status `CANCELLED`.
- Emit `OrderCancelled`.

### 9.4 Key Point For Product

The contract can enforce deadlines, but it cannot wake itself up. A keeper or user/admin action must call the expiry function.

---

## 10. Current Base Sepolia Deployment Status

Base Sepolia is not fully configured yet.

Current `hardhat.config.js` has:

- `localhost`
- `sepolia`

Missing:

- `baseSepolia` or `base-sepolia` network config.
- Base Sepolia deploy script command.
- Base Sepolia mock USDC deployment script.
- Subgraph Base Sepolia config.

Base Sepolia values:

- Chain ID: `84532`.
- Network name used by many tooling systems: `base-sepolia`.
- Typical RPC env variable to add: `BASE_SEPOLIA_RPC_URL`.
- Block explorer: BaseScan Sepolia.

---

## 11. Mock USDC And Faucet Plan

Current mock token:

File: `contracts/mocks/MockERC20.sol`

```solidity
contract MockERC20 is ERC20 {
    constructor(string name, string symbol, uint8 decimals)
    function decimals() public view override returns (uint8)
    function mint(address to, uint256 amount) external
}
```

This mock is already a faucet-style token because `mint` is open to anyone.

For Base Sepolia testing, simplest plan:

1. Deploy `MockERC20("Mock USDC", "mUSDC", 6)` to Base Sepolia.
2. Use that address as `USDC_ADDRESS` when deploying the Diamond.
3. Let users/merchants mint test USDC using `mint(address,uint256)`.

Security note:

- Open mint is fine for Base Sepolia testnet.
- Do not use open mint token on production/mainnet.

Optional improvement:

- Add a `scripts/deployMockUsdc.js` script that deploys mock USDC and writes address to `deployed-addresses.json` or separate `deployments/base-sepolia.json`.
- Add a small faucet UI or script:

```text
npx hardhat run scripts/mintMockUsdc.js --network baseSepolia
```

---

## 12. Base Sepolia Contract Deployment Plan

### 12.1 Required Code/Config Changes

Add to `hardhat.config.js`:

```js
baseSepolia: {
  url: process.env.BASE_SEPOLIA_RPC_URL || "",
  accounts: (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY)
    ? [process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY]
    : [],
}
```

Add package scripts:

```json
"deploy:base-sepolia": "hardhat run scripts/deploy.js --network baseSepolia",
"upgrade:base-sepolia": "hardhat run scripts/upgrade.js --network baseSepolia"
```

Optional mock USDC script:

```json
"deploy:mock-usdc:base-sepolia": "hardhat run scripts/deployMockUsdc.js --network baseSepolia"
```

### 12.2 Env Variables

Required:

```env
BASE_SEPOLIA_RPC_URL=https://base-sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=...
USDC_ADDRESS=0x...mockUsdcOnBaseSepolia
```

Optional:

```env
MIN_MERCHANT_STAKE_USDC=300000000
DEFAULT_CHANNEL_DAILY_LIMIT_USDC=600000000
DEFAULT_CHANNEL_MONTHLY_LIMIT_USDC=6200000000
BUY_PRICE_INR_PER_USDC=95
SELL_PRICE_INR_PER_USDC=90
DISPUTE_WINDOW_SECONDS=600
```

### 12.3 Deployment Steps

```text
1. Deploy mock USDC on Base Sepolia.
2. Set USDC_ADDRESS to mock USDC address.
3. Deploy Diamond using deploy.js on baseSepolia.
4. Record Diamond address and deployment block.
5. Update subgraph config for Base Sepolia.
6. Deploy subgraph.
7. Update UIs env vars:
   - VITE_DIAMOND_ADDRESS
   - VITE_SEPOLIA_USDC_TOKEN_ADDRESS or rename to generic Base Sepolia USDC var later
   - VITE_SUBGRAPH_URL
   - VITE_ALCHEMY_RPC_URL can point to Base Sepolia RPC if code chain config is updated
```

Important UI note:

- Current UI config still defines Sepolia chain id in multiple places.
- Moving UI to Base Sepolia also requires changing chain config from Sepolia `11155111` to Base Sepolia `84532`.
- Do not only change RPC URL if the chain id remains Sepolia.

---

## 13. Subgraph Deployment Plan For Base Sepolia

Current subgraph:

- File: `p2pflow-subgraph/subgraph.yaml`
- Network: `sepolia`
- Address: `0x456850ff3Eb1bA5c3312fA97A47307992103855E`
- Start block: `11081997`

Current gap:

- `package.json` references `networks/sepolia.yaml`, but `networks/` folder does not exist.

### 13.1 Recommended Network Config Layout

Create:

```text
p2pflow-subgraph/networks/sepolia.yaml
p2pflow-subgraph/networks/base-sepolia.yaml
```

`networks/base-sepolia.yaml` should be same as `subgraph.yaml` except:

```yaml
network: base-sepolia
source:
  address: "<BASE_SEPOLIA_DIAMOND_ADDRESS>"
  startBlock: <BASE_SEPOLIA_DIAMOND_DEPLOYMENT_BLOCK>
```

### 13.2 Start Block

Use the Diamond deployment block.

Options:

- Read deployment transaction receipt block number.
- Use `scripts/findStartBlock.js` with `DIAMOND_ADDRESS` after deployment.

Example:

```bash
DIAMOND_ADDRESS=0x... npx hardhat run scripts/findStartBlock.js --network baseSepolia
```

### 13.3 ABI

Subgraph uses:

```text
p2pflow-subgraph/abis/Diamond.json
```

After contract changes/upgrades, ensure ABI includes all emitted events and callable view functions used by mapping helpers.

Especially important events:

- `MerchantRegistered`
- `UsdcDeposited`
- `UsdcWithdrawn`
- `UnstakeRequested`
- `UnstakeRequestRejected`
- `AvailabilityChanged`
- `ChannelAdded`
- `ChannelApproved`
- `ChannelRejected`
- `ChannelAvailabilityChanged`
- `FiatMigrated`
- `ChannelTerminated`
- `MerchantBlacklisted`
- `MerchantDisputed`
- `MerchantDisputeCleared`
- `PlatformPaused`
- `PlatformUnpaused`
- `MinMerchantStakeUpdated`
- `PlatformAdminTransferred`
- `DefaultChannelLimitsUpdated`
- `OrderPricingUpdated`
- `DisputeWindowUpdated`
- `EligibleMerchantAdded`
- `EligibleMerchantRemoved`
- `EligibleMerchantsCleared`
- `OrderCreated`
- `OrderAssigned`
- `OrderAccepted`
- `OrderPaid`
- `OrderCompleted`
- `OrderCancelled`
- `OrderRiskReleased`
- `DisputeRaised`
- `DisputeResolved`
- `OwnershipTransferred`

### 13.4 Goldsky Deployment

Current script:

```json
"deploy:goldsky": "goldsky subgraph deploy p2pflow-diamond/1.0.0 --path ."
```

For Base Sepolia, recommended:

```json
"prepare:goldsky:base-sepolia": "cp networks/base-sepolia.yaml subgraph.yaml",
"deploy:goldsky:base-sepolia": "goldsky subgraph deploy p2pflow-diamond/base-sepolia --path ."
```

Actual deployment sequence:

```bash
cd p2pflow-subgraph
npm run prepare:goldsky:base-sepolia
npm run codegen
npm run build
npm run deploy:goldsky:base-sepolia
```

---

## 14. Current Known Gaps / Decisions Needed

### 14.1 Online/Offline Matching

Current matching does not fully respect merchant `ONLINE/OFFLINE`.

Decision needed:

```text
Should OFFLINE merchants be excluded from all new assignments?
```

If yes:

- Update `LibOrders.isBuyEligible` to require `m.availability == MerchantAvailability.ONLINE`.
- Update `_assignSellMerchants` to skip merchants not `ONLINE`.

### 14.2 Auto-Cancel Deadlines

Decision needed:

```text
What exact deadlines should exist?
```

Possible deadlines:

- Merchant acceptance timeout from `CREATED`.
- User payment timeout for BUY after `ACCEPTED`.
- Merchant payment timeout for SELL after `ACCEPTED`.

Need design before coding because it affects storage and reservation release logic.

### 14.3 Reassignment

Current decision:

- Do not implement auto-reassignment for now.
- Keep current order matching and cancellation behavior until a keeper/timeout design is finalized.

Background notes for later:

If an assigned merchant does not accept, should order:

- auto-cancel after timeout?
- reassign to next merchants?
- stay open until user cancels?

Current behavior:

- Stays `CREATED` until accepted or user cancels.

### 14.4 Volume Limit Enforcement

Storage and library support exist for daily/monthly channel volume windows.

Current order flow does not call `LibMerchants.consumeChannelVolume`.

Decision needed:

- Should volume limits block accepts/completions now?
- Should they apply to BUY, SELL, or both?

### 14.5 Base Sepolia Variable Names

Current UI env names still say Sepolia/Alchemy in places.

Decision needed:

- Keep old names temporarily and point to Base Sepolia values?
- Or rename to generic names like:
  - `VITE_CHAIN_ID`
  - `VITE_RPC_URL`
  - `VITE_USDC_TOKEN_ADDRESS`

Renaming is cleaner but touches all UIs and Jenkins envs.

---

## 15. Recommended Next Implementation Order

Do this in order:

1. Decide whether offline merchants should be excluded from matching.
2. Decide exact timeout/cancel behavior.
3. Implement timeout storage and `cancelExpiredOrder` keeper function.
4. Add/adjust tests for timeout cancellation.
5. Add Base Sepolia network config to Hardhat.
6. Add mock USDC deploy/mint scripts.
7. Deploy mock USDC to Base Sepolia.
8. Deploy Diamond to Base Sepolia using mock USDC address.
9. Create Base Sepolia subgraph network config with address/start block.
10. Build/deploy subgraph.
11. Update UI envs and chain configs for Base Sepolia.

---

## 16. Quick Product Questions To Answer Before Coding Timeouts

1. Should offline merchants receive new assignments? Current code mostly allows it.
2. Should a `CREATED` order expire if nobody accepts in 10 minutes?
3. After a merchant accepts a BUY order, how long does user have to mark paid?
4. After a merchant accepts a SELL order, how long does merchant have to send INR and mark paid?
5. Who can call expiry cancellation: anyone, user only, merchant only, admin only, or keeper only?
6. Should expired orders be cancelled only? Current answer: no reassignment for now.
7. If reassignment is added later, should previous assigned merchants be blocked from reaccepting?
8. Should a merchant under a single order dispute be blocked globally, as currently implemented, or only have risk locked for that order?

Answering these will let us implement the timeout/order-router changes cleanly.