# P2PFlow Smart Contracts — EIP-2535 Diamond Proxy

> A complete from-scratch guide to understanding every file in this repo.
> Written for someone new to Diamond contracts.

---

## Table of Contents

1. [What Problem Does The Diamond Solve?](#1-what-problem-does-the-diamond-solve)
2. [The Core Idea — One Address, Many Contracts](#2-the-core-idea--one-address-many-contracts)
3. [How `delegatecall` Works](#3-how-delegatecall-works)
4. [File Structure](#4-file-structure)
5. [Interfaces — What They Are and Why](#5-interfaces--what-they-are-and-why)
   - [IDiamondCut](#idiamoncut)
   - [IDiamondLoupe](#idiamondloupe)
   - [IERC165](#ierc165)
   - [IERC173](#ierc173)
   - [IERC20](#ierc20)
6. [LibDiamond — The Engine](#6-libdiamond--the-engine)
7. [Diamond.sol — The Proxy](#7-diamondsol--the-proxy)
8. [DiamondCutFacet — The Upgrade Function](#8-diamondcutfacet--the-upgrade-function)
9. [DiamondLoupeFacet — The Inspector](#9-diamondloupefacet--the-inspector)
10. [OwnershipFacet — Who Controls This Diamond](#10-ownershipfacet--who-controls-this-diamond)
11. [AppStorage — Shared State Without Collisions](#11-appstorage--shared-state-without-collisions)
12. [DiamondInit — One-Time Setup](#12-diamondinit--one-time-setup)
13. [The Storage Collision Problem (Deep Dive)](#13-the-storage-collision-problem-deep-dive)
14. [Deployment Flow](#14-deployment-flow)
15. [How to Add a New Facet](#15-how-to-add-a-new-facet)
16. [Quick Reference — Who Does What](#16-quick-reference--who-does-what)

---

## 1. What Problem Does The Diamond Solve?

Normal Ethereum contracts have two hard limits:

**Limit 1 — 24KB size cap.**
Every smart contract has a maximum bytecode size of 24,576 bytes (EIP-170).
A real app like a P2P exchange has hundreds of functions. They don't fit.

**Limit 2 — No upgrades.**
Once a contract is deployed, its code is frozen. You can't fix bugs.
Traditional "proxy" patterns (like OpenZeppelin's TransparentProxy) let you upgrade
but only support ONE implementation contract — still hits the 24KB cap.

**The Diamond (EIP-2535) solves both:**
- Split your logic across many small contracts called **Facets**
- One proxy address routes calls to the right facet
- You can add, replace, or remove facets anytime (upgrade individual functions)
- No 24KB limit because each facet is its own contract

---

## 2. The Core Idea — One Address, Many Contracts

```
User / Frontend
      │
      │  calls someFunction() on ONE address
      ▼
  Diamond.sol  (the proxy — permanent address, ~50 lines)
      │
      │  looks up which Facet owns someFunction()
      │  in its internal routing table
      │
      ├──── DiamondCutFacet   → handles upgrades
      ├──── DiamondLoupeFacet → handles inspection
      ├──── OwnershipFacet    → handles owner()
      ├──── OrderFacet        → handles placeOrder(), acceptOrder()
      ├──── MerchantFacet     → handles registerMerchant()
      └──── ... (as many as you need)
```

From the outside world, there is only ONE contract: the Diamond.
Facets are invisible to users — they just see one address.

---

## 3. How `delegatecall` Works

This is the key mechanism. You must understand this.

**Normal `call`:**
```
ContractA calls ContractB.foo()
→ ContractB's foo() runs
→ ContractB's storage is read/written
→ msg.sender inside B = ContractA's address
```

**`delegatecall`:**
```
ContractA delegatecalls ContractB.foo()
→ ContractB's foo() runs   ← B's CODE
→ ContractA's storage is read/written  ← A's STORAGE
→ msg.sender inside B = the original caller (not A)
```

**In the Diamond:**
```
User calls Diamond.placeOrder(...)
→ Diamond's fallback() runs
→ Finds OrderFacet owns placeOrder()
→ delegatecall → OrderFacet.placeOrder()
→ OrderFacet's CODE runs
→ Diamond's STORAGE is written
→ msg.sender = the User (passed through correctly)
```

This means **ALL facets share ONE storage** — the Diamond's.
That's the power. And also the danger (see Section 13).

---

## 4. File Structure

```
smart-contracts/
│
├── contracts/
│   │
│   ├── Diamond.sol                      ← THE PROXY. Entry point. Never changes.
│   │
│   ├── interfaces/                      ← What each component promises to do
│   │   ├── IDiamondCut.sol              ← The upgrade interface
│   │   ├── IDiamondLoupe.sol            ← The inspection interface
│   │   ├── IERC165.sol                  ← Interface detection standard
│   │   ├── IERC173.sol                  ← Ownership standard
│   │   └── IERC20.sol                   ← Token standard (for USDC)
│   │
│   ├── libraries/
│   │   └── LibDiamond.sol               ← Core engine: routing table + cut logic
│   │
│   ├── facets/                          ← Logic contracts (the actual code)
│   │   ├── DiamondCutFacet.sol          ← Handles upgrades (add/replace/remove functions)
│   │   ├── DiamondLoupeFacet.sol        ← Handles inspection (what functions exist)
│   │   └── OwnershipFacet.sol           ← Handles owner() and transferOwnership()
│   │
│   ├── shared/
│   │   └── AppStorage.sol               ← ALL your app state lives here
│   │
│   └── upgradeInitializers/
│       └── DiamondInit.sol              ← Runs once at deployment to set initial state
│
├── scripts/
│   └── deploy.js                        ← Deployment script
│
├── test/
│   └── diamond.test.js                  ← Tests
│
├── hardhat.config.js
└── .env.example
```

---

## 5. Interfaces — What They Are and Why

An **interface** in Solidity is just a list of function signatures with no implementation.
It's a contract — it defines what something CAN do, not how it does it.

Think of it like a TypeScript `interface` or a Java `interface`.

### IDiamondCut

**File:** `contracts/interfaces/IDiamondCut.sol`
**Source:** Nick Mudge (EIP-2535 author) — https://github.com/mudgen/diamond-3-hardhat

This defines the upgrade mechanism. It has:

```solidity
enum FacetCutAction { Add, Replace, Remove }

struct FacetCut {
    address facetAddress;      // the facet contract to add/replace/remove
    FacetCutAction action;     // what to do
    bytes4[] functionSelectors; // which functions (4-byte selector = first 4 bytes of keccak256(sig))
}

function diamondCut(FacetCut[] calldata, address _init, bytes calldata) external;
```

When you call `diamondCut()`, you pass an array of cuts.
Each cut says: "take these function selectors and point them at this facet address."

**Why is it an interface?**
`Diamond.sol` doesn't implement `diamondCut()` itself — `DiamondCutFacet` does.
But the deploy script needs to call it on the Diamond's address.
So it casts the Diamond to `IDiamondCut` to call it.

---

### IDiamondLoupe

**File:** `contracts/interfaces/IDiamondLoupe.sol`
**Source:** Nick Mudge — https://github.com/mudgen/diamond-3-hardhat

A loupe is a small magnifying glass used to inspect real diamonds.
These functions let anyone inspect the Diamond contract:

```solidity
function facets() → all facets + their selectors
function facetFunctionSelectors(address) → selectors for one facet
function facetAddresses() → all facet addresses
function facetAddress(bytes4 selector) → which facet owns this selector
```

**EIP-2535 REQUIRES these.** Without them your contract is not a compliant Diamond.
Tools like Louper.dev (https://louper.dev) use these to visualize your Diamond.

---

### IERC165

**File:** `contracts/interfaces/IERC165.sol`
**Source:** https://eips.ethereum.org/EIPS/eip-165

One function:
```solidity
function supportsInterface(bytes4 interfaceId) external view returns (bool);
```

Any contract can call this to ask: "do you implement interface X?"
The `interfaceId` is the XOR of all function selectors in that interface.

The Diamond registers `true` for IDiamondCut, IDiamondLoupe, IERC173, IERC165
during `DiamondInit.init()`. This lets tools and other contracts verify compatibility.

---

### IERC173

**File:** `contracts/interfaces/IERC173.sol`
**Source:** https://eips.ethereum.org/EIPS/eip-173

The ownership standard. Two functions:
```solidity
function owner() external view returns (address);
function transferOwnership(address _newOwner) external;
```

`OwnershipFacet` implements this. The owner is the only one who can call `diamondCut()`
to upgrade the Diamond.

---

### IERC20

**File:** `contracts/interfaces/IERC20.sol`
**Source:** https://eips.ethereum.org/EIPS/eip-20

The standard token interface. USDC implements this.

Key functions your business facets will use:
```solidity
balanceOf(address) → how much USDC someone holds
approve(spender, amount) → user approves Diamond to spend their USDC
transferFrom(from, to, amount) → Diamond pulls USDC from user (after approval)
transfer(to, amount) → Diamond sends USDC to someone
```

The escrow flow:
```
1. User calls USDC.approve(diamondAddress, amount)
2. EscrowFacet calls USDC.transferFrom(user, diamondAddress, amount)  ← locks funds
3. EscrowFacet calls USDC.transfer(merchant, amount)  ← releases funds
```

---

## 6. LibDiamond — The Engine

**File:** `contracts/libraries/LibDiamond.sol`
**Source:** Nick Mudge — https://github.com/mudgen/diamond-3-hardhat

This is the most important file. It does three things:

### A. DiamondStorage — The Routing Table

```solidity
bytes32 constant DIAMOND_STORAGE_POSITION = keccak256("diamond.standard.diamond.storage");

struct DiamondStorage {
    mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;
    mapping(address => FacetFunctionSelectors) facetFunctionSelectors;
    address[] facetAddresses;
    mapping(bytes4 => bool) supportedInterfaces;
    address contractOwner;
}
```

The routing table is `selectorToFacetAndPosition`.
When `fallback()` runs, it does: `facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress`

This storage is stored at the keccak256 slot — far away from slot 0
so it never collides with `AppStorage`.

### B. `diamondCut()` — Modifying The Routing Table

Three internal functions:
- `addFunctions()` — registers new selectors → facet
- `replaceFunctions()` — swaps which facet owns a selector
- `removeFunctions()` — deletes a selector from the table

Uses **swap-and-pop** to keep arrays compact (no gaps, gas efficient).

### C. Owner Helpers

```solidity
function enforceIsContractOwner() internal view { ... }  // reverts if not owner
function setContractOwner(address) internal { ... }
function contractOwner() internal view returns (address) { ... }
```

### Why a Library?

Solidity `library` functions marked `internal` are **inlined** into the calling contract
at compile time. No separate deployment, no extra CALL opcode cost.
LibDiamond's code ends up inside Diamond.sol and DiamondCutFacet bytecode.

---

## 7. Diamond.sol — The Proxy

**File:** `contracts/Diamond.sol`
**Source:** Nick Mudge — https://github.com/mudgen/diamond-3-hardhat

This is the permanent address your users interact with. It has two parts:

### Constructor

```solidity
constructor(address _contractOwner, address _diamondCutFacet) {
    LibDiamond.setContractOwner(_contractOwner);

    // Register diamondCut() selector as the FIRST function
    // So we can immediately call it to add all other facets
    IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
    cut[0] = FacetCut({
        facetAddress: _diamondCutFacet,
        action: Add,
        functionSelectors: [IDiamondCut.diamondCut.selector]
    });
    LibDiamond.diamondCut(cut, address(0), "");
}
```

After construction, the Diamond has exactly ONE function: `diamondCut()`.
You use that immediately to register all your other facets.

### fallback()

```solidity
fallback() external payable {
    // Get DiamondStorage
    DiamondStorage storage ds = LibDiamond.diamondStorage();

    // Look up which facet owns the incoming function selector (msg.sig)
    address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
    require(facet != address(0), "Diamond: Function does not exist");

    // delegatecall — runs facet code in Diamond's storage context
    assembly {
        calldatacopy(0, 0, calldatasize())
        let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
        returndatacopy(0, 0, returndatasize())
        switch result
        case 0 { revert(0, returndatasize()) }
        default { return(0, returndatasize()) }
    }
}
```

Every single function call to the Diamond goes through here.
The assembly is used for efficiency — copies calldata, delegatecalls, forwards return data.

---

## 8. DiamondCutFacet — The Upgrade Function

**File:** `contracts/facets/DiamondCutFacet.sol`

```solidity
function diamondCut(FacetCut[] calldata _diamondCut, address _init, bytes calldata _calldata) external {
    LibDiamond.enforceIsContractOwner();  // only owner can upgrade
    LibDiamond.diamondCut(_diamondCut, _init, _calldata);
}
```

That's essentially it. It:
1. Checks the caller is the Diamond owner
2. Calls LibDiamond to update the routing table
3. Optionally delegatecalls `_init` with `_calldata` (for initialization after upgrade)

**How to add a new facet after deployment:**
```js
const cut = [{
  facetAddress: NewFacet.address,
  action: 0, // Add
  functionSelectors: getSelectors(NewFacet)
}];
await diamondCut.diamondCut(cut, address(0), "0x");
```

**How to upgrade a function:**
```js
const cut = [{
  facetAddress: NewFacetV2.address,
  action: 1, // Replace
  functionSelectors: ["0xabcdef12"] // the selector of the function to replace
}];
```

**How to remove a function:**
```js
const cut = [{
  facetAddress: "0x0000000000000000000000000000000000000000", // must be zero address
  action: 2, // Remove
  functionSelectors: ["0xabcdef12"]
}];
```

---

## 9. DiamondLoupeFacet — The Inspector

**File:** `contracts/facets/DiamondLoupeFacet.sol`

This facet is **required** by EIP-2535. It lets anyone inspect the Diamond:

```solidity
facets()                         → all facets + all their selectors
facetFunctionSelectors(address)  → selectors for one specific facet
facetAddresses()                 → list of all registered facet addresses
facetAddress(bytes4 selector)    → which facet handles this selector
supportsInterface(bytes4)        → ERC-165 check
```

**Practical use:**
- The Louper.dev tool reads these to show you a visual map of your Diamond
- Your frontend can call `facetAddress(selector)` to verify a facet is registered
- Hardhat tests use these to verify `diamondCut()` worked correctly

---

## 10. OwnershipFacet — Who Controls This Diamond

**File:** `contracts/facets/OwnershipFacet.sol`

Implements ERC-173 (the ownership standard):

```solidity
function owner() external view returns (address) {
    return LibDiamond.contractOwner();
}

function transferOwnership(address _newOwner) external {
    LibDiamond.enforceIsContractOwner();
    LibDiamond.setContractOwner(_newOwner);
}
```

The owner is stored inside `LibDiamond.DiamondStorage` (the keccak256 slot).
Only the owner can call `diamondCut()` to upgrade the Diamond.

---

## 11. AppStorage — Shared State Without Collisions

**File:** `contracts/shared/AppStorage.sol`

### The Problem

All facets share Diamond's storage via `delegatecall`.
In Solidity, state variables are assigned storage slots sequentially:

```
FacetA:
  uint256 x;   → slot 0
  address y;   → slot 1

FacetB:
  bool foo;    → slot 0  ← COLLISION with FacetA.x !
  uint256 bar; → slot 1  ← COLLISION with FacetA.y !
```

Both facets independently start from slot 0 — they **overwrite each other**.

### The Solution — AppStorage at Slot 0

Put ALL state into one struct. Every facet inherits `Modifiers` which declares:

```solidity
contract Modifiers {
    AppStorage internal s;  // Solidity assigns this to slot 0
}
```

Since every facet starts its storage layout with the EXACT same struct (`AppStorage`)
at slot 0, they all agree on what lives where. No collision.

```
Slot 0: s.usdcToken
Slot 1: s.treasury
Slot 2: s.platformFeeBps
Slot 3: s.paused
... and so on — same layout in every facet
```

### LibDiamond doesn't collide either

`LibDiamond.DiamondStorage` lives at:
```solidity
keccak256("diamond.standard.diamond.storage")
// = 0xc8fcad8db84d3cc18b4c41d551ea0ee66dd599cde068d998e57d5e09332c131c
```

That's slot `0xc8fcad...` — completely separate from slot 0 where AppStorage lives.

### How to use in a facet

```solidity
import "../shared/AppStorage.sol";

contract OrderFacet is Modifiers {
    function placeOrder(...) external notPaused {
        // `s` is AppStorage — available from Modifiers inheritance
        s.orders[orderId] = Order({...});
        s.allOrderIds.push(orderId);
        s.totalOrdersPlaced++;
    }
}
```

### Golden Rule

> **NEVER declare a state variable directly in a facet.**
> All state goes in `AppStorage`. Always.

If you add `uint256 myVar;` inside a facet, it occupies the same slot as something
in `AppStorage` and silently corrupts data. No compiler error. Just a broken app.

---

## 12. DiamondInit — One-Time Setup

**File:** `contracts/upgradeInitializers/DiamondInit.sol`

This is **NOT a facet**. It is never registered in the routing table.
It gets `delegatecall`ed exactly once during the initial `diamondCut()`.

```solidity
contract DiamondInit is Modifiers {
    function init(address _usdcToken, address _treasury, uint256 _platformFeeBps) external {
        // Register ERC-165 support flags
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;

        // Set initial app state via `s` (AppStorage at slot 0)
        s.usdcToken      = _usdcToken;
        s.treasury       = _treasury;
        s.platformFeeBps = _platformFeeBps;
        s.admin          = msg.sender;
        s.isAdmin[msg.sender] = true;
    }
}
```

Because it runs via `delegatecall`, everything it writes goes into Diamond's storage.
After `init()` returns, `DiamondInit` is forgotten — its address is never stored.

**In the deploy script:**
```js
const initCalldata = DiamondInit.interface.encodeFunctionData("init", [
    USDC_ADDRESS, TREASURY, 50
]);
await diamondCut.diamondCut(cut, DiamondInit.address, initCalldata);
//                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                Diamond will delegatecall this after the cut
```

---

## 13. The Storage Collision Problem (Deep Dive)

This section gives you a complete mental model.

### Naive (broken) approach

```solidity
contract FacetA {
    uint256 public counter;   // slot 0
    address public token;     // slot 1
}

contract FacetB {
    bool public paused;       // slot 0 — SAME AS counter!
}
```

When the Diamond delegatecalls FacetB, `paused` reads from slot 0.
But slot 0 holds FacetA's `counter` (a uint256).
Setting `paused = true` writes `1` into slot 0, changing `counter` to 1. **Silent bug.**

### How LibDiamond avoids it (Diamond Storage)

```solidity
bytes32 constant POSITION = keccak256("diamond.standard.diamond.storage");

function diamondStorage() internal pure returns (DiamondStorage storage ds) {
    assembly { ds.slot := POSITION }
}
```

`LibDiamond`'s data lives at slot `0xc8fcad...` — a giant random-looking number.
Practically impossible to collide with anything at slot 0, 1, 2...

### How your app state avoids it (AppStorage at Slot 0)

```solidity
contract Modifiers {
    AppStorage internal s;  // slot 0
    // NO other variables here, ever
}

contract FacetA is Modifiers {
    // starts layout with same AppStorage at slot 0
    // `s.counter` is always at the exact same sub-slot
}

contract FacetB is Modifiers {
    // starts layout with same AppStorage at slot 0
    // `s.paused` is always at the exact same sub-slot
}
```

Same struct → same layout → same slots → no collision.

### The one rule you must never break

Never add a state variable BEFORE `AppStorage internal s` in `Modifiers` or anything
`Modifiers` inherits from. If you do, `s` shifts off slot 0 in that facet and
it reads different data than other facets. Silent corruption.

---

## 14. Deployment Flow

```
Step 1: Deploy DiamondCutFacet
Step 2: Deploy DiamondLoupeFacet
Step 3: Deploy OwnershipFacet
Step 4: Deploy Diamond(owner, DiamondCutFacet.address)
         └─ Diamond now has ONE function: diamondCut()
Step 5: Deploy DiamondInit
Step 6: Build FacetCut array:
         [ { DiamondLoupeFacet, Add, [its selectors] },
           { OwnershipFacet,    Add, [its selectors] } ]
Step 7: Encode DiamondInit.init(usdcToken, treasury, feeBps) as calldata
Step 8: Call diamondCut(cuts, DiamondInit.address, initCalldata)
         └─ Registers Loupe + Ownership functions
         └─ delegatecalls DiamondInit.init() → sets initial app state
Step 9: Done. Diamond is live.
```

Run it:
```bash
cd smart-contracts
npm install
npx hardhat node                             # local blockchain
npm run deploy:local
```

---

## 15. How to Add a New Facet

When you build OrderFacet, MerchantFacet, etc.:

### Step 1 — Add state to AppStorage

Open `contracts/shared/AppStorage.sol`, add your fields to `AppStorage`:
```solidity
struct AppStorage {
    // ... existing fields ...

    // Orders
    mapping(bytes32 => Order) orders;
    bytes32[] allOrderIds;
}
```

### Step 2 — Write the facet

```solidity
// contracts/facets/OrderFacet.sol
import "../shared/AppStorage.sol";

contract OrderFacet is Modifiers {
    event OrderPlaced(bytes32 indexed orderId, address user);

    function placeOrder(uint256 amount) external notPaused returns (bytes32) {
        bytes32 orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp));
        s.orders[orderId] = Order({ orderId: orderId, user: msg.sender, ... });
        s.allOrderIds.push(orderId);
        emit OrderPlaced(orderId, msg.sender);
        return orderId;
    }
}
```

### Step 3 — Deploy and cut

```js
const OrderFacet = await ethers.deployContract("OrderFacet");
const cut = [{
    facetAddress: await OrderFacet.getAddress(),
    action: 0, // Add
    functionSelectors: getSelectors(OrderFacet),
}];
await diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");
```

### Step 4 — Call through Diamond

```js
const order = await ethers.getContractAt("OrderFacet", diamondAddress);
await order.placeOrder(1000000); // 1 USDC (6 decimals)
```

---

## 16. Quick Reference — Who Does What

| File | Type | Purpose |
|---|---|---|
| `Diamond.sol` | Proxy | Permanent address. Routes all calls via `fallback()`. Never upgraded. |
| `LibDiamond.sol` | Library | The routing table. Add/replace/remove selectors. Storage at keccak256 slot. |
| `DiamondCutFacet.sol` | Facet | Exposes `diamondCut()`. The upgrade mechanism. Owner only. |
| `DiamondLoupeFacet.sol` | Facet | Exposes inspection functions. Required by EIP-2535. |
| `OwnershipFacet.sol` | Facet | Exposes `owner()` and `transferOwnership()`. Implements ERC-173. |
| `AppStorage.sol` | Shared State | ALL app state lives here. Every facet inherits `Modifiers` to access `s`. |
| `DiamondInit.sol` | Initializer | Runs once at deploy via delegatecall. Sets ERC-165 flags + initial state. |
| `IDiamondCut.sol` | Interface | Defines the upgrade function signature + FacetCut struct. |
| `IDiamondLoupe.sol` | Interface | Defines the 4 inspection functions. |
| `IERC165.sol` | Interface | Standard interface detection. |
| `IERC173.sol` | Interface | Standard ownership (owner + transferOwnership). |
| `IERC20.sol` | Interface | Standard token (USDC). Used by escrow logic in business facets. |

| Concept | One-liner |
|---|---|
| `delegatecall` | Run their code, use my storage |
| Diamond Storage | State at keccak256 slot — LibDiamond's private space |
| App Storage | State at slot 0 via inherited struct — all facets share it |
| FacetCut | One upgrade operation: Add / Replace / Remove a set of functions |
| Selector | First 4 bytes of `keccak256("functionName(paramTypes)")` — how Solidity identifies functions |
| Loupe | Diamond inspection — reading what functions exist and where they point |
| DiamondInit | A one-shot initializer, not a permanent facet |

---

## References

- EIP-2535 Specification: https://eips.ethereum.org/EIPS/eip-2535
- Nick Mudge's Reference Implementation: https://github.com/mudgen/diamond-3-hardhat
- Nick Mudge's Blog (AppStorage pattern): https://dev.to/mudgen/appstorage-pattern-for-state-variables-in-solidity-1ki4
- Louper.dev (Diamond visualizer): https://louper.dev
- EIP-20 (USDC standard): https://eips.ethereum.org/EIPS/eip-20
- EIP-165 (Interface detection): https://eips.ethereum.org/EIPS/eip-165
- EIP-173 (Ownership): https://eips.ethereum.org/EIPS/eip-173
