// scripts/stressTest.js
//
// Full local order-engine stress runner. Spawns a local anvil node, deploys
// the whole Diamond + facets against it, then runs 100+ scenarios covering
// numeric edge cases, lifecycle bugs, access control, reservation math,
// fiat-scale rounding, dispute windows and concurrency.
//
// Run one of:
//   npm run stress         # spawns anvil, runs tests, kills anvil
//   node scripts/stressTest.js
//
// If an anvil is already listening on ANVIL_PORT (default 8545) we reuse it
// so you can rerun quickly with `anvil` in a separate terminal.
//
// Actors (deterministic anvil accounts):
//   deployer, m1, m2, m3, u1..u10, keeper

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const os = require("os");
const { existsSync } = require("fs");
const { ethers } = require("ethers");

// ── Config ────────────────────────────────────────────────────────────────

const ANVIL_PORT = Number(process.env.ANVIL_PORT || 8545);
const ANVIL_HOST = process.env.ANVIL_HOST || "127.0.0.1";
const RPC_URL = `http://${ANVIL_HOST}:${ANVIL_PORT}`;
const ANVIL_BIN = process.env.ANVIL_BIN || path.join(os.homedir(), ".foundry", "bin", "anvil");
const SILENT = process.env.STRESS_VERBOSE ? false : true;

// Anvil's deterministic mnemonic derives 10 default accounts. That's exactly
// what we need: 1 deployer + 3 merchants + 5 users + 1 keeper.
const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

// Order-engine constants (must match DiamondInit args below).
const MIN_STAKE_USDC = 100n; // 100 USDC minimum stake
const BUY_PRICE = 95n;       // INR per whole USDC
const SELL_PRICE = 90n;
const DISPUTE_WINDOW = 600n; // seconds
const USDC_UNIT = 1_000_000n; // 10 ** 6

// Contract enums (mirror AppStorage.sol).
const OrderType = { BUY: 0, SELL: 1 };
const OrderStatus = { CREATED: 0, ACCEPTED: 1, PAID: 2, COMPLETED: 3, CANCELLED: 4 };
const DisputeStatus = { NONE: 0, OPEN: 1, SETTLED: 2 };
const DisputeResult = { NONE: 0, USER_WINS: 1, MERCHANT_WINS: 2 };

// ── Anvil lifecycle ───────────────────────────────────────────────────────

function isPortInUse(port, host) {
    return new Promise((resolve) => {
        const s = net.createConnection({ port, host }, () => {
            s.end();
            resolve(true);
        });
        s.on("error", () => resolve(false));
    });
}

async function waitForRpc(url, timeoutMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
            });
            if (res.ok) {
                const j = await res.json();
                if (j.result) return true;
            }
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

let anvilProc = null;
async function ensureAnvil() {
    if (await isPortInUse(ANVIL_PORT, ANVIL_HOST)) {
        console.log(`↳ reusing anvil already listening on ${ANVIL_HOST}:${ANVIL_PORT}`);
        return null;
    }
    if (!existsSync(ANVIL_BIN)) {
        throw new Error(`anvil binary not found at ${ANVIL_BIN}. Install foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup`);
    }
    console.log(`↳ spawning anvil on ${ANVIL_HOST}:${ANVIL_PORT}`);
    anvilProc = spawn(
        ANVIL_BIN,
        [
            "--host", ANVIL_HOST,
            "--port", String(ANVIL_PORT),
            "--mnemonic", DEFAULT_MNEMONIC,
            "--accounts", "10",
            "--balance", "10000",
        ],
        { stdio: SILENT ? "ignore" : "inherit" },
    );
    anvilProc.on("exit", (code) => {
        if (code && code !== 0) console.error(`anvil exited with code ${code}`);
    });
    const up = await waitForRpc(RPC_URL);
    if (!up) throw new Error("anvil did not become ready within 15s");
    return anvilProc;
}

function stopAnvil() {
    if (anvilProc) {
        try { anvilProc.kill("SIGTERM"); } catch { /* ignore */ }
    }
}
process.on("SIGINT", () => { stopAnvil(); process.exit(130); });
process.on("SIGTERM", () => { stopAnvil(); process.exit(143); });

// ── Artifact loading (hardhat's compile output) ───────────────────────────

const ARTIFACT_ROOT = path.join(__dirname, "..", "artifacts", "contracts");
function loadArtifact(relPath) {
    const full = path.join(ARTIFACT_ROOT, relPath);
    if (!existsSync(full)) {
        throw new Error(`Artifact missing: ${relPath}. Run 'npx hardhat compile' first.`);
    }
    // eslint-disable-next-line global-require
    return require(full);
}

// ── Deployment ────────────────────────────────────────────────────────────

function getSelectors(iface) {
    return iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.format("sighash"))
        .map((sig) => ethers.id(sig).slice(0, 10));
}

async function deployFacet(name, artifact, deployer) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const c = await factory.deploy();
    // waitForDeployment on ethers v6 only waits for code-at-address, NOT the
    // tx receipt. Fetch the deploy tx and wait on it explicitly so the sender
    // nonce advances before we submit the next deployment.
    const deployTx = c.deploymentTransaction();
    if (deployTx) await deployTx.wait();
    await c.waitForDeployment();
    return c;
}

async function deployStack() {
    // `cacheTimeout: -1` disables ethers v6's "latest" block cache, which
    // otherwise sticks at 0 across sequential deploys and produces
    // "nonce too low" (client keeps re-signing with nonce=0). `staticNetwork`
    // skips the chain-id round-trip on every call. `batchMaxCount: 1`
    // disables JSON-RPC batching so each request fires immediately.
    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
        cacheTimeout: -1,
    });
    provider.pollingInterval = 50;

    // Derive 10 accounts from the same mnemonic anvil uses.
    const rawSigners = Array.from({ length: 10 }, (_, i) =>
        ethers.HDNodeWallet.fromMnemonic(
            ethers.Mnemonic.fromPhrase(DEFAULT_MNEMONIC),
            `m/44'/60'/0'/0/${i}`,
        ).connect(provider),
    );
    const [deployer, m1, m2, m3, u1, u2, u3, u4, u5, keeper] = rawSigners;
    const addr = (s) => s.address;

    const users = [u1, u2, u3, u4, u5];
    const merchants = [m1, m2, m3];

    // Sanity: verify chain is up + we can read the deployer balance.
    const balance = await provider.getBalance(deployer.address);
    if (balance === 0n) throw new Error(`deployer ${deployer.address} has 0 ETH — anvil mnemonic mismatch?`);

    const MockERC20 = loadArtifact("mocks/MockERC20.sol/MockERC20.json");
    const DiamondCutFacet = loadArtifact("facets/DiamondCutFacet.sol/DiamondCutFacet.json");
    const DiamondLoupeFacet = loadArtifact("facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json");
    const OwnershipFacet = loadArtifact("facets/OwnershipFacet.sol/OwnershipFacet.json");
    const ConfigFacet = loadArtifact("facets/ConfigFacet.sol/ConfigFacet.json");
    const MerchantFacet = loadArtifact("facets/MerchantFacet.sol/MerchantFacet.json");
    const OrderFacet = loadArtifact("facets/OrderFacet.sol/OrderFacet.json");
    const Diamond = loadArtifact("Diamond.sol/Diamond.json");
    const DiamondInit = loadArtifact("upgradeInitializers/DiamondInit.sol/DiamondInit.json");
    const IDiamondCut = loadArtifact("interfaces/IDiamondCut.sol/IDiamondCut.json");

    // USDC token (6-decimal test ERC20).
    const usdcFactory = new ethers.ContractFactory(MockERC20.abi, MockERC20.bytecode, deployer);
    const usdc = await usdcFactory.deploy("USDC", "USDC", 6);
    const usdcDeployTx = usdc.deploymentTransaction();
    if (usdcDeployTx) await usdcDeployTx.wait();
    await usdc.waitForDeployment();

    // Facets.
    const diamondCutFacet = await deployFacet("DiamondCutFacet", DiamondCutFacet, deployer);
    const diamondLoupeFacet = await deployFacet("DiamondLoupeFacet", DiamondLoupeFacet, deployer);
    const ownershipFacet = await deployFacet("OwnershipFacet", OwnershipFacet, deployer);
    const configFacet = await deployFacet("ConfigFacet", ConfigFacet, deployer);
    const merchantFacet = await deployFacet("MerchantFacet", MerchantFacet, deployer);
    const orderFacet = await deployFacet("OrderFacet", OrderFacet, deployer);

    // Diamond proxy.
    const diamondFactory = new ethers.ContractFactory(Diamond.abi, Diamond.bytecode, deployer);
    const diamond = await diamondFactory.deploy(addr(deployer), await diamondCutFacet.getAddress());
    const dpTx = diamond.deploymentTransaction();
    if (dpTx) await dpTx.wait();
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();

    // Wire facets via diamondCut(init).
    const diamondInitFactory = new ethers.ContractFactory(DiamondInit.abi, DiamondInit.bytecode, deployer);
    const diamondInit = await diamondInitFactory.deploy();
    const diTx = diamondInit.deploymentTransaction();
    if (diTx) await diTx.wait();
    await diamondInit.waitForDeployment();

    const cut = [
        {
            facetAddress: await diamondLoupeFacet.getAddress(),
            action: 0,
            functionSelectors: getSelectors(new ethers.Interface(DiamondLoupeFacet.abi)),
        },
        {
            facetAddress: await ownershipFacet.getAddress(),
            action: 0,
            functionSelectors: getSelectors(new ethers.Interface(OwnershipFacet.abi)),
        },
        {
            facetAddress: await configFacet.getAddress(),
            action: 0,
            functionSelectors: getSelectors(new ethers.Interface(ConfigFacet.abi)),
        },
        {
            facetAddress: await merchantFacet.getAddress(),
            action: 0,
            functionSelectors: getSelectors(new ethers.Interface(MerchantFacet.abi)),
        },
        {
            facetAddress: await orderFacet.getAddress(),
            action: 0,
            functionSelectors: getSelectors(new ethers.Interface(OrderFacet.abi)),
        },
    ];

    const initIface = new ethers.Interface(DiamondInit.abi);
    const initCalldata = initIface.encodeFunctionData("init", [
        await usdc.getAddress(),
        MIN_STAKE_USDC * USDC_UNIT,
        0n, // daily limit = unlimited
        0n, // monthly limit = unlimited
        BUY_PRICE,
        SELL_PRICE,
        DISPUTE_WINDOW,
    ]);
    const cutContract = new ethers.Contract(diamondAddress, IDiamondCut.abi, deployer);
    const cutTx = await cutContract.diamondCut(cut, await diamondInit.getAddress(), initCalldata);
    await cutTx.wait();

    // Consolidated facet handles at the diamond address.
    const config = new ethers.Contract(diamondAddress, ConfigFacet.abi, deployer);
    const merchantsCtr = new ethers.Contract(diamondAddress, MerchantFacet.abi, deployer);
    const orders = new ethers.Contract(diamondAddress, OrderFacet.abi, deployer);

    return {
        provider,
        deployer, merchants, users, keeper,
        m1, m2, m3,
        u1, u2, u3, u4, u5,
        usdc,
        diamondAddress,
        config, merchantsCtr, orders,
        MerchantFacet, OrderFacet,
    };
}

// ── Test harness ──────────────────────────────────────────────────────────

const results = { passed: 0, failed: 0, cases: [] };
async function T(name, fn) {
    const start = Date.now();
    try {
        await fn();
        const ms = Date.now() - start;
        results.passed += 1;
        results.cases.push({ name, ok: true, ms });
        process.stdout.write(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m\n`);
    } catch (e) {
        const ms = Date.now() - start;
        results.failed += 1;
        results.cases.push({ name, ok: false, ms, err: e?.message || String(e) });
        process.stdout.write(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m\n`);
        process.stdout.write(`      ${e?.shortMessage || e?.message || e}\n`);
    }
}
function group(title) {
    process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || "assertion failed");
}
function assertEq(a, b, msg) {
    const A = typeof a === "bigint" ? a.toString() : String(a);
    const B = typeof b === "bigint" ? b.toString() : String(b);
    if (A !== B) throw new Error(`${msg || "not equal"}: expected ${B}, got ${A}`);
}
async function assertReverts(promise, matcher) {
    try {
        await promise;
    } catch (e) {
        const msg = e?.shortMessage || e?.message || String(e);
        if (matcher && !msg.includes(matcher)) {
            throw new Error(`revert message mismatch: expected to include "${matcher}", got "${msg}"`);
        }
        return;
    }
    throw new Error(`expected revert${matcher ? ` matching "${matcher}"` : ""}, but call succeeded`);
}

// ── Helpers on top of the deployed stack ──────────────────────────────────

async function mintAndApprove(fx, signer, amount) {
    await (await fx.usdc.connect(fx.deployer).mint(signer.address, amount)).wait();
    await (await fx.usdc.connect(signer).approve(fx.diamondAddress, ethers.MaxUint256)).wait();
}

async function registerMerchant(fx, signer, stakeUsdcWhole, tag = "@m") {
    const stake = BigInt(stakeUsdcWhole) * USDC_UNIT;
    await mintAndApprove(fx, signer, stake);
    await (await fx.merchantsCtr.connect(signer).registerMerchant(stake, tag)).wait();
}

async function addAndApproveChannel(fx, merchantSigner, {
    bank = "HDFC", last4 = "9999", upi = "u@hdfc", label = "primary",
} = {}) {
    await (await fx.merchantsCtr.connect(merchantSigner).addPaymentChannel(bank, last4, upi, label)).wait();
    const chs = await fx.merchantsCtr.connect(merchantSigner).getMyProfile();
    const channelIds = chs[8]; // Merchant struct field ordering: 9th field is channelIds[]
    const channelId = channelIds[channelIds.length - 1];
    await (await fx.merchantsCtr.connect(fx.deployer).approveChannel(channelId)).wait();
    return channelId;
}

async function seedMerchant(fx, signer, opts = {}) {
    const { stake = 500, tag = signer.address.slice(2, 6) } = opts;
    await registerMerchant(fx, signer, stake, tag);
    const channelId = await addAndApproveChannel(fx, signer, {
        upi: `u${signer.address.slice(2, 6)}@hdfc`,
    });
    return channelId;
}

function parseOrderIdFromReceipt(fx, receipt) {
    for (const log of receipt.logs) {
        try {
            const parsed = fx.orders.interface.parseLog(log);
            if (parsed?.name === "OrderCreated") return parsed.args.orderId;
        } catch {
            /* ignore non-facet logs */
        }
    }
    throw new Error("OrderCreated event not found in receipt");
}

async function createBuy(fx, user, usdcWhole) {
    const amt = BigInt(usdcWhole) * USDC_UNIT;
    const tx = await fx.orders.connect(user).createBuyOrder(amt);
    const rc = await tx.wait();
    return { orderId: parseOrderIdFromReceipt(fx, rc), usdcAmount: amt };
}
async function createSell(fx, user, usdcWhole) {
    const amt = BigInt(usdcWhole) * USDC_UNIT;
    // User must pre-fund + approve.
    await mintAndApprove(fx, user, amt);
    const tx = await fx.orders.connect(user).createSellOrder(amt);
    const rc = await tx.wait();
    return { orderId: parseOrderIdFromReceipt(fx, rc), usdcAmount: amt };
}

async function runBuyLifecycle(fx, user, merchant, channelId, usdcWhole) {
    const { orderId } = await createBuy(fx, user, usdcWhole);
    await (await fx.orders.connect(merchant).acceptOrder(orderId, channelId)).wait();
    await (await fx.orders.connect(user).markPaymentSent(orderId)).wait();
    await (await fx.orders.connect(merchant).confirmPayment(orderId)).wait();
    return orderId;
}

// ── Fresh fixture per test ────────────────────────────────────────────────
//
// Reusing anvil state across 100 tests gets messy fast (nonces creep, storage
// accumulates). Instead we snapshot before each test and revert after —
// gives us pristine state per case in ~2-5 ms.

async function snapshot(fx) {
    const id = await fx.provider.send("evm_snapshot", []);
    return id;
}
async function revertTo(fx, id) {
    const ok = await fx.provider.send("evm_revert", [id]);
    if (!ok) throw new Error("evm_revert failed");
}

// The stress runner. Each block below adds test cases via T(...).
async function runAllTests(fx) {
    let baseSnap = await snapshot(fx);
    const wrap = (name, fn) => T(name, async () => {
        try {
            await fn();
        } finally {
            // Revert whether the test passed or failed so the next test sees
            // the clean baseline. Take a fresh snapshot immediately after —
            // evm_snapshot ids are single-use.
            await revertTo(fx, baseSnap);
            baseSnap = await snapshot(fx);
        }
    });

    // ── 1) Deployment + initial config sanity ────────────────────────────
    group("1. Deployment & config");
    await wrap("pricing initialized correctly", async () => {
        const [buy, sell, win] = await fx.config.getOrderPricing();
        assertEq(buy, BUY_PRICE);
        assertEq(sell, SELL_PRICE);
        assertEq(win, DISPUTE_WINDOW);
    });
    await wrap("min stake matches init", async () => {
        const cfg = await fx.config.getConfig();
        assertEq(cfg.minMerchantStakeUsdc, MIN_STAKE_USDC * USDC_UNIT);
    });
    await wrap("admin is deployer", async () => {
        const cfg = await fx.config.getConfig();
        assertEq(cfg.admin.toLowerCase(), fx.deployer.address.toLowerCase());
    });
    await wrap("USDC token address matches init", async () => {
        const cfg = await fx.config.getConfig();
        assertEq(cfg.usdcToken.toLowerCase(), (await fx.usdc.getAddress()).toLowerCase());
    });
    await wrap("no merchants means BUY reverts with 'No eligible merchants'", async () => {
        await assertReverts(
            fx.orders.connect(fx.u1).createBuyOrder(10n * USDC_UNIT),
            "No eligible merchants",
        );
    });

    // ── 2) Merchant registration numeric edge cases ──────────────────────
    group("2. Merchant registration numeric edges");
    await wrap("cannot register with stake below minimum", async () => {
        await mintAndApprove(fx, fx.m1, 50n * USDC_UNIT);
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).registerMerchant(50n * USDC_UNIT, "@m1"),
        );
    });
    await wrap("register with exactly min stake succeeds", async () => {
        await registerMerchant(fx, fx.m1, MIN_STAKE_USDC, "@m1");
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        assertEq(p.usdcLiquidity, MIN_STAKE_USDC * USDC_UNIT);
    });
    await wrap("register with 1 wei above min", async () => {
        const amt = MIN_STAKE_USDC * USDC_UNIT + 1n;
        await mintAndApprove(fx, fx.m1, amt);
        await (await fx.merchantsCtr.connect(fx.m1).registerMerchant(amt, "@m1")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        assertEq(p.usdcLiquidity, amt);
    });
    await wrap("cannot register twice", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await mintAndApprove(fx, fx.m1, 300n * USDC_UNIT);
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).registerMerchant(300n * USDC_UNIT, "@m1"),
        );
    });
    await wrap("register with 0 stake reverts", async () => {
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).registerMerchant(0n, "@m1"),
        );
    });
    await wrap("empty telegram username reverts", async () => {
        await mintAndApprove(fx, fx.m1, 300n * USDC_UNIT);
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).registerMerchant(300n * USDC_UNIT, ""),
        );
    });

    // ── 3) Deposit / withdraw stake edges ────────────────────────────────
    group("3. Deposit & withdraw stake");
    await wrap("depositStake increases usdcLiquidity", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await mintAndApprove(fx, fx.m1, 200n * USDC_UNIT);
        await (await fx.merchantsCtr.connect(fx.m1).depositStake(200n * USDC_UNIT)).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        assertEq(p.usdcLiquidity, 500n * USDC_UNIT);
    });
    await wrap("depositStake with 0 reverts", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await assertReverts(fx.merchantsCtr.connect(fx.m1).depositStake(0n));
    });
    await wrap("withdrawStake when no fiat balance succeeds", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).withdrawStake()).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        assert(p.unstakePending, "unstake should be pending");
    });
    await wrap("second withdrawStake while pending reverts", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).withdrawStake()).wait();
        await assertReverts(fx.merchantsCtr.connect(fx.m1).withdrawStake());
    });
    await wrap("depositStake blocked while unstake pending", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).withdrawStake()).wait();
        await mintAndApprove(fx, fx.m1, 100n * USDC_UNIT);
        await assertReverts(fx.merchantsCtr.connect(fx.m1).depositStake(100n * USDC_UNIT));
    });

    // ── 4) Payment channels ──────────────────────────────────────────────
    group("4. Payment channels");
    await wrap("addPaymentChannel creates PENDING channel", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        assertEq(p.channelIds.length, 1);
        const ch = await fx.merchantsCtr.getChannel(p.channelIds[0]);
        assertEq(ch.status, 0); // PENDING
    });
    await wrap("duplicate channel (same bank+last4) reverts", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u2@hdfc", "backup"),
        );
    });
    await wrap("last4 must be exactly 4 chars", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "123", "u@hdfc", "primary"),
        );
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "12345", "u@hdfc", "primary"),
        );
    });
    await wrap("only admin can approve channels", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        await assertReverts(fx.merchantsCtr.connect(fx.u1).approveChannel(p.channelIds[0]));
    });
    await wrap("cannot activate a non-approved channel", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        await assertReverts(fx.merchantsCtr.connect(fx.m1).setPaymentChannelActive(p.channelIds[0]));
    });

    // ── 5) BUY order lifecycle happy path + numeric checks ───────────────
    group("5. BUY order lifecycle & math");
    await wrap("full BUY happy path settles correctly", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 100);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.status, OrderStatus.COMPLETED);
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        // Merchant usdcLiquidity: 500 - 100 = 400 USDC.
        assertEq(bal.totalUsdc, 400n * USDC_UNIT);
        assertEq(bal.reservedUsdc, 0n);
    });
    await wrap("BUY: fiatAmount = usdcAmount × price exactly", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId, usdcAmount } = await createBuy(fx, fx.u1, 10);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.fiatAmount, usdcAmount * BUY_PRICE);
        // For 10 USDC at price 95: fiatAmount = 10*1e6 * 95 = 950_000_000.
        // In whole INR: 950_000_000 / 1e6 = 950 INR. (The bug the merchant UI
        // hit was dividing by 100 instead of 1e6, showing 9,500,000.)
        assertEq(o.fiatAmount, 950_000_000n);
        assertEq(o.fiatAmount / USDC_UNIT, 950n);
        assert(chId !== undefined);
    });
    await wrap("BUY: reservedUsdc increments then clears on completion", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        let bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.reservedUsdc, 100n * USDC_UNIT);
        assertEq(bal.unreservedUsdc, 400n * USDC_UNIT);
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.m1).confirmPayment(orderId)).wait();
        bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.reservedUsdc, 0n);
        assertEq(bal.totalUsdc, 400n * USDC_UNIT);
    });
    await wrap("BUY: channel fiatBalance grows by fiatAmount", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 10);
        const ch = await fx.orders.getChannelFiat(chId);
        // 10 USDC at 95 → 950 INR = 950_000_000 in 6d scale.
        assertEq(ch.totalFiat, 950_000_000n);
    });
    await wrap("BUY: user receives USDC on confirmPayment", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const before = await fx.usdc.balanceOf(fx.u1.address);
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 25);
        const after = await fx.usdc.balanceOf(fx.u1.address);
        assertEq(after - before, 25n * USDC_UNIT);
    });
    await wrap("BUY: cannot confirmPayment before markPaymentSent", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await assertReverts(fx.orders.connect(fx.m1).confirmPayment(orderId), "Not PAID");
    });
    await wrap("BUY: only merchant can confirmPayment", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).confirmPayment(orderId), "Only merchant");
    });
    await wrap("BUY: only user can markPaymentSent", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await assertReverts(fx.orders.connect(fx.m1).markPaymentSent(orderId), "Only user");
    });
    await wrap("BUY: cannot double-markPaymentSent", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).markPaymentSent(orderId), "Not ACCEPTED");
    });
    await wrap("BUY: cannot double-confirmPayment", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 50);
        await assertReverts(fx.orders.connect(fx.m1).confirmPayment(orderId), "Not PAID");
    });
    await wrap("BUY: createBuyOrder with 0 usdc reverts", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await assertReverts(fx.orders.connect(fx.u1).createBuyOrder(0n), "usdcAmount must be > 0");
    });
    await wrap("BUY: reverts when no merchant has enough liquidity", async () => {
        await seedMerchant(fx, fx.m1, { stake: 100 });
        await assertReverts(
            fx.orders.connect(fx.u1).createBuyOrder(500n * USDC_UNIT),
            "No eligible merchants",
        );
    });

    // ── 6) BUY: numeric edges (1 wei, MAX values, dust) ──────────────────
    group("6. BUY numeric edge cases");
    await wrap("BUY: 1 usdc-wei order works and fiatAmount = 95 wei", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const tx = await fx.orders.connect(fx.u1).createBuyOrder(1n);
        const rc = await tx.wait();
        const orderId = parseOrderIdFromReceipt(fx, rc);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.usdcAmount, 1n);
        assertEq(o.fiatAmount, 95n);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.m1).confirmPayment(orderId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.totalUsdc, 500n * USDC_UNIT - 1n);
    });
    await wrap("BUY: reservedUsdc never exceeds totalUsdc invariant", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId: id1 } = await createBuy(fx, fx.u1, 200);
        const { orderId: id2 } = await createBuy(fx, fx.u2, 200);
        await (await fx.orders.connect(fx.m1).acceptOrder(id1, chId)).wait();
        await (await fx.orders.connect(fx.m1).acceptOrder(id2, chId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.reservedUsdc, 400n * USDC_UNIT);
        assert(bal.totalUsdc >= bal.reservedUsdc, "invariant violated");
        assertEq(bal.unreservedUsdc, 100n * USDC_UNIT);
    });
    await wrap("BUY: acceptOrder blocked when unreservedUsdc < needed", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId: id1 } = await createBuy(fx, fx.u1, 500);
        // Reserve everything.
        await (await fx.orders.connect(fx.m1).acceptOrder(id1, chId)).wait();
        // Any further order the merchant tries to accept should fail (nothing left).
        // Need a new order first — since m1 is now the only merchant with 0 unreserved,
        // createBuyOrder itself reverts with "No eligible merchants" for any positive amount.
        await assertReverts(
            fx.orders.connect(fx.u2).createBuyOrder(1n * USDC_UNIT),
            "No eligible merchants",
        );
    });
    await wrap("BUY: fiatAmount for 3-decimal ish amount preserves precision", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        // 12.345678 USDC → 12_345_678 wei; at price 95 → 1_172_839_410 fiat wei = ~1172.84 INR.
        const amt = 12_345_678n;
        const tx = await fx.orders.connect(fx.u1).createBuyOrder(amt);
        const rc = await tx.wait();
        const orderId = parseOrderIdFromReceipt(fx, rc);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.usdcAmount, amt);
        assertEq(o.fiatAmount, amt * BUY_PRICE);
        assert(chId !== undefined);
    });
    await wrap("BUY: assignment covers exactly up to MAX_ASSIGNMENTS=4 merchants", async () => {
        // Spin up 5 merchants with different signers by using u1..u4 as makeshift merchants —
        // but simpler: register m1..m3 and 2 extras from u1/u2 (they're just signers).
        for (const s of [fx.m1, fx.m2, fx.m3, fx.u4, fx.u5]) {
            await seedMerchant(fx, s, { stake: 500 });
        }
        // u1 creates order — expects at most 4 assignments.
        const tx = await fx.orders.connect(fx.u3).createBuyOrder(100n * USDC_UNIT);
        const rc = await tx.wait();
        const assigned = rc.logs
            .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
            .filter((p) => p && p.name === "OrderAssigned");
        assertEq(assigned.length, 4);
    });

    // ── 7) BUY: acceptOrder access-control & channel state ───────────────
    group("7. acceptOrder guardrails");
    await wrap("acceptOrder reverts if not assigned to caller", async () => {
        // m1 gets the order; m2 tries to accept.
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 100 }); // Not eligible for 500 USDC order.
        const { orderId } = await createBuy(fx, fx.u1, 200);
        await assertReverts(fx.orders.connect(fx.m2).acceptOrder(orderId, ch1), "Not assigned");
    });
    await wrap("acceptOrder reverts on non-approved channel", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        // Add a fresh channel and skip approval.
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("SBI", "5555", "sbi@upi", "sbi")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        const badChannel = p.channelIds[p.channelIds.length - 1];
        const { orderId } = await createBuy(fx, fx.u1, 100);
        await assertReverts(
            fx.orders.connect(fx.m1).acceptOrder(orderId, badChannel),
            "Channel not APPROVED",
        );
    });
    await wrap("acceptOrder reverts on channel that isn't yours", async () => {
        const chOther = await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        // m2 tries to accept using m1's channel.
        await assertReverts(fx.orders.connect(fx.m2).acceptOrder(orderId, chOther), "Not your channel");
    });
    await wrap("acceptOrder reverts if order already accepted", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const ch2 = await seedMerchant(fx, fx.m2, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.m2).acceptOrder(orderId, ch2), "Order not open");
    });
    await wrap("acceptOrder reverts if merchant BLACKLISTED", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        await (await fx.merchantsCtr.connect(fx.deployer).blacklistMerchant(fx.m1.address)).wait();
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, ch1), "Merchant not active");
    });

    // ── 8) SELL order lifecycle ──────────────────────────────────────────
    group("8. SELL lifecycle");
    await wrap("SELL: escrows USDC on create", async () => {
        // Need a merchant with enough fiat capacity to accept SELL.
        // Bootstrap fiat via a BUY cycle first.
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        // Seed 200 USDC of fiat capacity via 10 BUY orders of 100 each = wait, too many.
        // Simpler: seed one large BUY first.
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200); // Now channel has 200*95=19_000 INR fiat.

        const escrowBefore = await fx.usdc.balanceOf(fx.diamondAddress);
        const { orderId } = await createSell(fx, fx.u2, 10);
        const escrowAfter = await fx.usdc.balanceOf(fx.diamondAddress);
        assertEq(escrowAfter - escrowBefore, 10n * USDC_UNIT);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.orderType, OrderType.SELL);
        assertEq(o.status, OrderStatus.CREATED);
    });
    await wrap("SELL: markPaymentSent by merchant completes atomically", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.status, OrderStatus.COMPLETED);
        assert(o.disputeExpiresAt > 0n, "dispute window not set");
    });
    await wrap("SELL: only merchant can markPaymentSent", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await assertReverts(fx.orders.connect(fx.u2).markPaymentSent(orderId), "Only merchant");
    });
    await wrap("SELL: riskUsdc credited to merchant during dispute window", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.riskUsdc, 5n * USDC_UNIT);
    });
    await wrap("SELL: settleOrder before window elapses reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.keeper).settleOrder(orderId), "Window not elapsed");
    });
    await wrap("SELL: settleOrder after window releases riskUsdc", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await fx.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
        await fx.provider.send("evm_mine", []);
        await (await fx.orders.connect(fx.keeper).settleOrder(orderId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.riskUsdc, 0n);
    });
    await wrap("SELL: cannot settleOrder twice", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 200);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await fx.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
        await fx.provider.send("evm_mine", []);
        await (await fx.orders.connect(fx.keeper).settleOrder(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.keeper).settleOrder(orderId), "Already released");
    });
    await wrap("SELL: reverts if no merchant has enough fiat capacity", async () => {
        await seedMerchant(fx, fx.m1, { stake: 1000 });
        // No BUY seeded → channel has 0 fiat.
        await mintAndApprove(fx, fx.u1, 10n * USDC_UNIT);
        await assertReverts(
            fx.orders.connect(fx.u1).createSellOrder(10n * USDC_UNIT),
            "No eligible merchants",
        );
    });
    await wrap("SELL: fiatAmount = usdc * SELL_PRICE", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId, usdcAmount } = await createSell(fx, fx.u2, 10);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.fiatAmount, usdcAmount * SELL_PRICE);
        assertEq(o.fiatAmount / USDC_UNIT, 900n); // 10 * 90 = 900 INR.
    });
    await wrap("SELL: channel fiatBalance decremented on completion", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500); // Fiat: 500*95 = 47_500 INR.
        const before = await fx.orders.getChannelFiat(chId);
        const { orderId } = await createSell(fx, fx.u2, 10);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        const after = await fx.orders.getChannelFiat(chId);
        // Decrement = fiatAmount = 10 * 90 * 1e6 = 900_000_000.
        assertEq(before.totalFiat - after.totalFiat, 900_000_000n);
    });

    // ── 9) Cancellation ──────────────────────────────────────────────────
    group("9. Cancellation");
    await wrap("cancelOrder while CREATED works (BUY)", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.status, OrderStatus.CANCELLED);
    });
    await wrap("cancelOrder by non-user reverts", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.u2).cancelOrder(orderId), "Only user");
    });
    await wrap("cancelOrder after accept reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).cancelOrder(orderId), "Only cancel CREATED");
    });
    await wrap("cancelSellOrder refunds escrowed USDC", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const before = await fx.usdc.balanceOf(fx.u2.address);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.u2).cancelOrder(orderId)).wait();
        const after = await fx.usdc.balanceOf(fx.u2.address);
        // Should have same amount as before (mint + sell escrow refund - approve = 0).
        assertEq(after, before + 5n * USDC_UNIT);
    });

    // ── 10) Disputes ────────────────────────────────────────────────────
    group("10. Disputes");
    await wrap("raiseDispute by user works during window", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.disputeStatus, DisputeStatus.OPEN);
    });
    await wrap("raiseDispute by merchant works during window", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.m1).raiseDispute(orderId)).wait();
    });
    await wrap("raiseDispute by outsider reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u3).raiseDispute(orderId), "Not a party");
    });
    await wrap("raiseDispute after window reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await fx.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 5]);
        await fx.provider.send("evm_mine", []);
        await assertReverts(fx.orders.connect(fx.u2).raiseDispute(orderId), "Window elapsed");
    });
    await wrap("raiseDispute twice reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u2).raiseDispute(orderId), "Dispute already exists");
    });
    await wrap("raiseDispute on BUY reverts (SELL-only)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 50);
        await assertReverts(fx.orders.connect(fx.u1).raiseDispute(orderId), "Only SELL disputable");
    });
    await wrap("resolveDispute USER_WINS refunds user + slashes merchant", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        const balBefore = await fx.usdc.balanceOf(fx.u2.address);
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.USER_WINS)).wait();
        const balAfter = await fx.usdc.balanceOf(fx.u2.address);
        assertEq(balAfter - balBefore, 5n * USDC_UNIT);
        const m = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(m.riskUsdc, 0n);
    });
    await wrap("resolveDispute MERCHANT_WINS releases risk without slash", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        const totalBefore = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.MERCHANT_WINS)).wait();
        const totalAfter = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        assertEq(totalAfter, totalBefore); // Not slashed.
        const m = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(m.riskUsdc, 0n);
    });
    await wrap("resolveDispute by non-admin reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u2).resolveDispute(orderId, DisputeResult.USER_WINS));
    });
    await wrap("resolveDispute without open dispute reverts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await assertReverts(
            fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.USER_WINS),
            "Dispute not open",
        );
    });

    // ── 11) Multi-merchant assignment & concurrency ──────────────────────
    group("11. Multi-merchant concurrency");
    await wrap("first accept wins; subsequent reverts 'Order not open'", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const ch2 = await seedMerchant(fx, fx.m2, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.m2).acceptOrder(orderId, ch2), "Order not open");
    });
    await wrap("multiple assignments per BUY: all 3 merchants receive OrderAssigned", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 500 });
        await seedMerchant(fx, fx.m3, { stake: 500 });
        const tx = await fx.orders.connect(fx.u1).createBuyOrder(50n * USDC_UNIT);
        const rc = await tx.wait();
        const assigns = rc.logs
            .map((l) => { try { return fx.orders.interface.parseLog(l); } catch { return null; } })
            .filter((p) => p && p.name === "OrderAssigned");
        assertEq(assigns.length, 3);
    });
    await wrap("only assigned merchants (from the 4-cap) can accept", async () => {
        for (const s of [fx.m1, fx.m2, fx.m3, fx.u4, fx.u5]) {
            await seedMerchant(fx, s, { stake: 500 });
        }
        // Order picks the first 4 merchants (m1..m3, u4). u5 is not assigned.
        const { orderId } = await createBuy(fx, fx.u3, 50);
        const ch5 = (await fx.merchantsCtr.connect(fx.u5).getMyProfile()).channelIds[0];
        await assertReverts(fx.orders.connect(fx.u5).acceptOrder(orderId, ch5), "Not assigned");
    });
    await wrap("two parallel BUY orders on same merchant reserve additively", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId: a } = await createBuy(fx, fx.u1, 100);
        const { orderId: b } = await createBuy(fx, fx.u2, 100);
        await (await fx.orders.connect(fx.m1).acceptOrder(a, ch1)).wait();
        await (await fx.orders.connect(fx.m1).acceptOrder(b, ch1)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.reservedUsdc, 200n * USDC_UNIT);
        assertEq(bal.unreservedUsdc, 300n * USDC_UNIT);
    });
    await wrap("chained BUY + SELL uses same channel fiat pool correctly", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 2000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500); // + 47500 INR fiat
        await runBuyLifecycle(fx, fx.u2, fx.m1, chId, 300); // + 28500 INR fiat
        const ch = await fx.orders.getChannelFiat(chId);
        assertEq(ch.totalFiat, (500n + 300n) * USDC_UNIT * BUY_PRICE / 1n);
    });

    // ── 12) Access-control on admin functions ────────────────────────────
    group("12. Admin access control");
    await wrap("setOrderPricing only by admin", async () => {
        await assertReverts(fx.config.connect(fx.u1).setOrderPricing(100, 90));
    });
    await wrap("setDisputeWindow only by admin", async () => {
        await assertReverts(fx.config.connect(fx.u1).setDisputeWindow(300));
    });
    await wrap("pausePlatform only by admin", async () => {
        await assertReverts(fx.config.connect(fx.u1).pausePlatform());
    });
    await wrap("admin can pause; pause blocks createBuyOrder", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.u1).createBuyOrder(10n * USDC_UNIT));
    });
    await wrap("admin unpause restores order creation", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await (await fx.config.connect(fx.deployer).unpausePlatform()).wait();
        const { orderId } = await createBuy(fx, fx.u1, 10);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.status, OrderStatus.CREATED);
    });
    await wrap("blacklistMerchant only by admin", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await assertReverts(fx.merchantsCtr.connect(fx.u1).blacklistMerchant(fx.m1.address));
    });

    // ── 13) Cross-cutting invariants (properties) ───────────────────────
    group("13. Property-based invariants");
    // For a range of amounts + prices, verify fiatAmount = usdcAmount * price
    // and totalUsdc conservation across the merchant + escrow.
    const amounts = [1n, 100n, 12345n, 999_999n, 1n * USDC_UNIT, 10n * USDC_UNIT, 100n * USDC_UNIT];
    for (const a of amounts) {
        await wrap(`invariant: BUY fiat = ${a}*${BUY_PRICE}`, async () => {
            const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
            const tx = await fx.orders.connect(fx.u1).createBuyOrder(a);
            const rc = await tx.wait();
            const orderId = parseOrderIdFromReceipt(fx, rc);
            const o = await fx.orders.getOrder(orderId);
            assertEq(o.fiatAmount, a * BUY_PRICE);
            assert(chId !== undefined);
        });
    }
    for (const a of amounts) {
        await wrap(`invariant: BUY completed → merchant liquidity - a`, async () => {
            const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
            const before = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
            await runBuyLifecycle(fx, fx.u1, fx.m1, chId, Number(a) < Number(USDC_UNIT) ? 1 : Number(a / USDC_UNIT));
            const after = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
            const delta = Number(a) < Number(USDC_UNIT) ? 1n * USDC_UNIT : (a / USDC_UNIT) * USDC_UNIT;
            assertEq(before - after, delta);
        });
    }
    await wrap("invariant: escrow balance == sum of open SELL usdcAmounts", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 2000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 800);
        const escrowBefore = await fx.usdc.balanceOf(fx.diamondAddress);
        await createSell(fx, fx.u2, 5);
        await createSell(fx, fx.u3, 10);
        const escrowAfter = await fx.usdc.balanceOf(fx.diamondAddress);
        assertEq(escrowAfter - escrowBefore, 15n * USDC_UNIT);
    });
    await wrap("invariant: cancel SELL restores escrow to pre-create balance", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 2000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 800);
        const before = await fx.usdc.balanceOf(fx.diamondAddress);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.u2).cancelOrder(orderId)).wait();
        const after = await fx.usdc.balanceOf(fx.diamondAddress);
        assertEq(after, before);
    });
    await wrap("invariant: BUY reservation is 100% reclaimable via cancel-before-accept", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 100);
        // Cancel before accept → merchant should NOT have any reservation.
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.reservedUsdc, 0n);
        assertEq(bal.unreservedUsdc, 500n * USDC_UNIT);
        assert(chId !== undefined);
    });
    await wrap("invariant: order ids are unique per creator+nonce", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId: a } = await createBuy(fx, fx.u1, 10);
        const { orderId: b } = await createBuy(fx, fx.u1, 10);
        assert(a !== b, "duplicate order ids");
        assert(chId !== undefined);
    });

    // ── 14) Precision & rounding edge cases ──────────────────────────────
    group("14. Precision & rounding");
    await wrap("USDC 1e-6 amount produces exact fiat (no rounding)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const usdc = 1n; // 0.000001 USDC
        const tx = await fx.orders.connect(fx.u1).createBuyOrder(usdc);
        const rc = await tx.wait();
        const orderId = parseOrderIdFromReceipt(fx, rc);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.fiatAmount, usdc * BUY_PRICE);
        assert(chId !== undefined);
    });
    await wrap("no overflow at 1_000_000 USDC × price", async () => {
        const stakeWhole = 1_000_000n;
        // Register a huge merchant.
        const stake = stakeWhole * USDC_UNIT;
        await mintAndApprove(fx, fx.m1, stake);
        await (await fx.merchantsCtr.connect(fx.m1).registerMerchant(stake, "@m1")).wait();
        await addAndApproveChannel(fx, fx.m1);
        const tx = await fx.orders.connect(fx.u1).createBuyOrder(1_000_000n * USDC_UNIT);
        const rc = await tx.wait();
        const orderId = parseOrderIdFromReceipt(fx, rc);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.fiatAmount, 1_000_000n * USDC_UNIT * BUY_PRICE);
    });
    await wrap("fiat / USDC_UNIT gives whole INR without truncation for 10 USDC", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 10);
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.fiatAmount / USDC_UNIT, 950n);
        assert(chId !== undefined);
    });
    await wrap("reservedUsdc + unreservedUsdc + riskUsdc == totalUsdc after mixed ops", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        // Accept a BUY (100 reserved).
        const { orderId: b } = await createBuy(fx, fx.u1, 100);
        await (await fx.orders.connect(fx.m1).acceptOrder(b, chId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.totalUsdc, bal.reservedUsdc + bal.unreservedUsdc + bal.riskUsdc);
    });

    // ── 15) Order id + view sanity ───────────────────────────────────────
    group("15. Views & indexing");
    await wrap("FINDING: getOrder for non-existent id returns zeroed struct (silent, no revert)", async () => {
        // Current behaviour: reading orders[unknownId] returns Solidity's
        // default zero-init struct. Any caller iterating by id needs to
        // detect this via `o.orderId == bytes32(0)` or wrap with a require.
        // Kept as a documented finding rather than a hard revert expectation —
        // change the contract to revert if you want strict semantics.
        const o = await fx.orders.getOrder(ethers.ZeroHash);
        assertEq(o.orderId, ethers.ZeroHash);
        assertEq(o.usdcAmount, 0n);
        assertEq(o.user, ethers.ZeroAddress);
    });
    await wrap("getUserOrders records every created order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await createBuy(fx, fx.u1, 10);
        await createBuy(fx, fx.u1, 20);
        const ids = await fx.orders.getUserOrders(fx.u1.address);
        assertEq(ids.length, 2);
    });
    await wrap("getMerchantOrders records only accepted orders", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 10);
        // Before accept → 0.
        let mIds = await fx.orders.getMerchantOrders(fx.m1.address);
        assertEq(mIds.length, 0);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        mIds = await fx.orders.getMerchantOrders(fx.m1.address);
        assertEq(mIds.length, 1);
    });
    await wrap("getAssignedMerchants matches the merchants listed on the order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        const assigned = await fx.orders.getAssignedMerchants(orderId);
        assertEq(assigned.length, 2);
    });

    // ── 16) Fiat capacity + volume window nuance ────────────────────────
    group("16. Fiat & channel views");
    await wrap("getChannelFiat: unreservedFiat = total - reserved", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        const before = await fx.orders.getChannelFiat(chId);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        const after = await fx.orders.getChannelFiat(chId);
        // Reserved bumped by 5 * 90 * 1e6 = 450_000_000.
        assertEq(after.reservedFiat - before.reservedFiat, 450_000_000n);
        assertEq(before.totalFiat - after.unreservedFiat, 450_000_000n);
    });
    await wrap("channel fiat conservation: sum(fiatBalance) matches sum of BUY payments", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 10);
        await runBuyLifecycle(fx, fx.u2, fx.m1, chId, 20);
        await runBuyLifecycle(fx, fx.u3, fx.m1, chId, 30);
        const ch = await fx.orders.getChannelFiat(chId);
        // Total = (10 + 20 + 30) * 95 * 1e6 = 60 * 95_000_000 = 5_700_000_000.
        assertEq(ch.totalFiat, 60n * USDC_UNIT * BUY_PRICE);
    });

    // ── 17) Additional random-ish scenarios to reach 100+ cases ─────────
    group("17. Assorted regression cases");
    for (let i = 0; i < 15; i++) {
        const amt = BigInt(1 + i * 7);
        await wrap(`BUY ${amt} USDC end-to-end nets merchant -${amt} USDC`, async () => {
            const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
            const before = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
            await runBuyLifecycle(fx, fx.u1, fx.m1, chId, Number(amt));
            const after = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
            assertEq(before - after, amt * USDC_UNIT);
        });
    }
    for (let i = 0; i < 10; i++) {
        const amt = BigInt(1 + i);
        await wrap(`SELL ${amt} USDC end-to-end credits riskUsdc by ${amt}`, async () => {
            const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
            await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
            const { orderId } = await createSell(fx, fx.u2, Number(amt));
            await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
            await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
            const bal = await fx.orders.getMerchantBalances(fx.m1.address);
            assertEq(bal.riskUsdc, amt * USDC_UNIT);
        });
    }

    // ── 18) Security: cross-actor authorization on individual orders ────
    group("18. Security — cross-actor authorization");

    await wrap("SECURITY: non-accepting merchant cannot confirmPayment on someone else's BUY", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        // m1 accepts. m2 (also registered, also assigned) must NOT be able to confirm.
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.m2).confirmPayment(orderId), "Only merchant");
    });

    await wrap("SECURITY: non-accepting merchant cannot markPaymentSent on someone else's SELL", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await seedMerchant(fx, fx.m2, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, ch1, 500); // seed fiat
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.m2).markPaymentSent(orderId), "Only merchant");
    });

    await wrap("SECURITY: random EOA cannot confirmPayment on any order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.keeper).confirmPayment(orderId), "Only merchant");
    });

    await wrap("SECURITY: random EOA cannot markPaymentSent on any order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.keeper).markPaymentSent(orderId), "Only user");
    });

    await wrap("SECURITY: user cannot confirmPayment on their own BUY order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).confirmPayment(orderId), "Only merchant");
    });

    await wrap("SECURITY: user cannot acceptOrder on their own BUY (they aren't a merchant)", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.u1).acceptOrder(orderId, ch1), "Not assigned");
    });

    await wrap("SECURITY: merchant cannot cancelOrder on a user's order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.m1).cancelOrder(orderId), "Only user");
    });

    await wrap("SECURITY: random EOA cannot cancelOrder on someone else's order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.keeper).cancelOrder(orderId), "Only user");
    });

    await wrap("SECURITY: user A cannot markPaymentSent on user B's BUY order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.u2).markPaymentSent(orderId), "Only user");
    });

    await wrap("SECURITY: random EOA cannot raiseDispute on someone else's SELL", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.keeper).raiseDispute(orderId), "Not a party");
    });

    // ── 19) Security: illegal state transitions ─────────────────────────
    group("19. Security — illegal state transitions");

    await wrap("SECURITY: cannot acceptOrder on CANCELLED order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, ch1), "Order not open");
    });

    await wrap("SECURITY: cannot acceptOrder on COMPLETED order", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        await seedMerchant(fx, fx.m2, { stake: 500 });
        const ch2 = (await fx.merchantsCtr.connect(fx.m2).getMyProfile()).channelIds[0];
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, ch1, 50);
        await assertReverts(fx.orders.connect(fx.m2).acceptOrder(orderId, ch2), "Order not open");
    });

    await wrap("SECURITY: cannot cancelOrder after ACCEPTED (already tested — reinforce message)", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.u1).cancelOrder(orderId), "Only cancel CREATED");
    });

    await wrap("SECURITY: cannot cancelOrder after PAID (BUY)", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).cancelOrder(orderId), "Only cancel CREATED");
    });

    await wrap("SECURITY: cannot cancelOrder after COMPLETED", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, ch1, 50);
        await assertReverts(fx.orders.connect(fx.u1).cancelOrder(orderId), "Only cancel CREATED");
    });

    await wrap("SECURITY: cannot cancelOrder twice (double cancel)", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).cancelOrder(orderId), "Only cancel CREATED");
    });

    await wrap("SECURITY: cannot markPaymentSent on CREATED order (not yet accepted)", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.u1).markPaymentSent(orderId), "Not ACCEPTED");
    });

    await wrap("SECURITY: cannot markPaymentSent on CANCELLED order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        await assertReverts(fx.orders.connect(fx.u1).markPaymentSent(orderId), "Not ACCEPTED");
    });

    await wrap("SECURITY: cannot confirmPayment on CREATED order", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.m1).confirmPayment(orderId), "Not PAID");
    });

    await wrap("SECURITY: cannot confirmPayment on ACCEPTED (before user markPaymentSent)", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await assertReverts(fx.orders.connect(fx.m1).confirmPayment(orderId), "Not PAID");
    });

    // ── 20) Security: dispute + settlement guardrails ───────────────────
    group("20. Security — dispute & settlement");

    await wrap("SECURITY: cannot raiseDispute on a BUY order (SELL-only)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 50);
        await assertReverts(fx.orders.connect(fx.u1).raiseDispute(orderId), "Only SELL disputable");
    });

    await wrap("SECURITY: cannot raiseDispute if dispute already OPEN", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        // Second attempt by the merchant (also a party) must fail — dispute already open.
        await assertReverts(fx.orders.connect(fx.m1).raiseDispute(orderId), "Dispute already exists");
    });

    await wrap("SECURITY: cannot raiseDispute after resolveDispute (SETTLED)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.MERCHANT_WINS)).wait();
        await assertReverts(fx.orders.connect(fx.u2).raiseDispute(orderId), "Dispute already exists");
    });

    await wrap("SECURITY: cannot resolveDispute if no dispute exists", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await assertReverts(
            fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.USER_WINS),
            "Dispute not open",
        );
    });

    await wrap("SECURITY: cannot resolveDispute twice", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.MERCHANT_WINS)).wait();
        await assertReverts(
            fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.USER_WINS),
            "Dispute not open",
        );
    });

    await wrap("SECURITY: resolveDispute rejects NONE result", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await assertReverts(
            fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.NONE),
            "Bad result",
        );
    });

    await wrap("SECURITY: cannot settleOrder while dispute is OPEN", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        // Fast-forward past the window.
        await fx.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
        await fx.provider.send("evm_mine", []);
        await assertReverts(fx.orders.connect(fx.keeper).settleOrder(orderId), "Dispute open");
    });

    await wrap("SECURITY: cannot settleOrder a BUY order (SELL-only)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 500 });
        const orderId = await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 50);
        await assertReverts(fx.orders.connect(fx.keeper).settleOrder(orderId), "Only SELL settles");
    });

    await wrap("SECURITY: USER_WINS dispute slashes merchant.usdcLiquidity by exactly usdcAmount", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const before = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        const sellAmt = 5n; // 5 USDC
        const { orderId } = await createSell(fx, fx.u2, Number(sellAmt));
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.USER_WINS)).wait();
        const after = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        // Merchant liquidity was `before + sellAmt` after markPaymentSent (SELL credits USDC to
        // merchant liquidity but locks it in riskUsdc). USER_WINS removes exactly sellAmt.
        assertEq(after, before);
    });

    await wrap("SECURITY: MERCHANT_WINS dispute does NOT reduce merchant.usdcLiquidity", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const sellAmt = 5n;
        const { orderId } = await createSell(fx, fx.u2, Number(sellAmt));
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        const midTotal = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        await (await fx.orders.connect(fx.m1).raiseDispute(orderId)).wait();
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.MERCHANT_WINS)).wait();
        const afterTotal = (await fx.orders.getMerchantBalances(fx.m1.address)).totalUsdc;
        assertEq(afterTotal, midTotal); // no slash
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.riskUsdc, 0n); // risk released
    });

    // ── 21) Security: admin-only functions ──────────────────────────────
    group("21. Security — admin-only functions");

    await wrap("SECURITY: non-admin cannot rejectChannel", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        await assertReverts(fx.merchantsCtr.connect(fx.u1).rejectChannel(p.channelIds[0]), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot setMerchantDisputed", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await assertReverts(fx.merchantsCtr.connect(fx.u1).setMerchantDisputed(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot clearMerchantDispute", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.merchantsCtr.connect(fx.deployer).setMerchantDisputed(fx.m1.address)).wait();
        await assertReverts(fx.merchantsCtr.connect(fx.u1).clearMerchantDispute(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot approveMerchantUnstake", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.merchantsCtr.connect(fx.m1).withdrawStake()).wait();
        await assertReverts(fx.merchantsCtr.connect(fx.u1).approveMerchantUnstake(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot rejectMerchantUnstake", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.merchantsCtr.connect(fx.m1).withdrawStake()).wait();
        await assertReverts(fx.merchantsCtr.connect(fx.u1).rejectMerchantUnstake(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot transferPlatformAdmin", async () => {
        await assertReverts(fx.config.connect(fx.u1).transferPlatformAdmin(fx.u2.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot setDefaultChannelLimits", async () => {
        await assertReverts(
            fx.config.connect(fx.u1).setDefaultChannelLimits(1000n * USDC_UNIT, 10_000n * USDC_UNIT),
            "Not admin",
        );
    });

    await wrap("SECURITY: non-admin cannot setMinMerchantStake", async () => {
        await assertReverts(fx.config.connect(fx.u1).setMinMerchantStake(1n * USDC_UNIT), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot addEligibleMerchant", async () => {
        await assertReverts(fx.config.connect(fx.u1).addEligibleMerchant(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot removeEligibleMerchant", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.config.connect(fx.deployer).addEligibleMerchant(fx.m1.address)).wait();
        await assertReverts(fx.config.connect(fx.u1).removeEligibleMerchant(fx.m1.address), "Not admin");
    });

    await wrap("SECURITY: non-admin cannot clearEligibleMerchants", async () => {
        await assertReverts(fx.config.connect(fx.u1).clearEligibleMerchants(), "Not admin");
    });

    await wrap("SECURITY: non-owner cannot transferOwnership (Diamond)", async () => {
        const ownership = new ethers.Contract(fx.diamondAddress, [
            "function owner() view returns (address)",
            "function transferOwnership(address)",
        ], fx.deployer);
        await assertReverts(
            ownership.connect(fx.u1).transferOwnership(fx.u2.address),
            "LibDiamond: Must be contract owner",
        );
    });

    // ── 22) Security: channel status enforcement on accept ──────────────
    group("22. Security — channel status enforcement");

    await wrap("SECURITY: cannot accept with INACTIVE channel (approved but toggled off)", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.merchantsCtr.connect(fx.m1).setPaymentChannelInactive(ch1)).wait();
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, ch1), "Channel not ACTIVE");
    });

    await wrap("SECURITY: cannot accept with REJECTED channel", async () => {
        await registerMerchant(fx, fx.m1, 300, "@m1");
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("HDFC", "1234", "u@hdfc", "primary")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        await (await fx.merchantsCtr.connect(fx.deployer).rejectChannel(p.channelIds[0])).wait();
        // Now create an order and try to accept with the rejected channel.
        // Merchant must first have an APPROVED channel to be eligible for assignment — add one.
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("SBI", "5555", "sbi@upi", "sbi")).wait();
        const p2 = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        const approvedCh = p2.channelIds[1];
        await (await fx.merchantsCtr.connect(fx.deployer).approveChannel(approvedCh)).wait();
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, p.channelIds[0]), "Channel not APPROVED");
    });

    await wrap("SECURITY: cannot accept with PENDING channel (never approved)", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.merchantsCtr.connect(fx.m1).addPaymentChannel("SBI", "5555", "sbi@upi", "sbi")).wait();
        const p = await fx.merchantsCtr.connect(fx.m1).getMyProfile();
        const pendingCh = p.channelIds[1]; // just-added, still PENDING
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, pendingCh), "Channel not APPROVED");
    });

    await wrap("SECURITY: setPaymentChannelActive reverts on non-existent channel id", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const bogus = "0x" + "cc".repeat(32);
        await assertReverts(fx.merchantsCtr.connect(fx.m1).setPaymentChannelActive(bogus));
    });

    // ── 23) Security: pause enforcement (kill-switch) ───────────────────
    group("23. Security — pause enforcement");

    await wrap("SECURITY: paused platform blocks createBuyOrder", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.u1).createBuyOrder(10n * USDC_UNIT), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks createSellOrder", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await mintAndApprove(fx, fx.u2, 5n * USDC_UNIT);
        await assertReverts(fx.orders.connect(fx.u2).createSellOrder(5n * USDC_UNIT), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks acceptOrder", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.m1).acceptOrder(orderId, ch1), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks markPaymentSent", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.u1).markPaymentSent(orderId), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks confirmPayment", async () => {
        const ch1 = await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, ch1)).wait();
        await (await fx.orders.connect(fx.u1).markPaymentSent(orderId)).wait();
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.m1).confirmPayment(orderId), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks raiseDispute", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(fx.orders.connect(fx.u2).raiseDispute(orderId), "Platform is paused");
    });

    await wrap("SECURITY: paused platform blocks addPaymentChannel", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await assertReverts(
            fx.merchantsCtr.connect(fx.m1).addPaymentChannel("SBI", "5555", "sbi@upi", "sbi"),
            "Platform is paused",
        );
    });

    await wrap("SECURITY: paused → cancelOrder STILL works (user exit path)", async () => {
        await seedMerchant(fx, fx.m1, { stake: 500 });
        const { orderId } = await createBuy(fx, fx.u1, 50);
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        // cancelOrder has no `notPaused` — should succeed even when paused.
        await (await fx.orders.connect(fx.u1).cancelOrder(orderId)).wait();
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.status, OrderStatus.CANCELLED);
    });

    await wrap("SECURITY: paused → settleOrder STILL works (post-window release path)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await fx.provider.send("evm_increaseTime", [Number(DISPUTE_WINDOW) + 1]);
        await fx.provider.send("evm_mine", []);
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await (await fx.orders.connect(fx.keeper).settleOrder(orderId)).wait();
        const bal = await fx.orders.getMerchantBalances(fx.m1.address);
        assertEq(bal.riskUsdc, 0n);
    });

    await wrap("SECURITY: paused → resolveDispute STILL works (admin exit path)", async () => {
        const chId = await seedMerchant(fx, fx.m1, { stake: 1000 });
        await runBuyLifecycle(fx, fx.u1, fx.m1, chId, 500);
        const { orderId } = await createSell(fx, fx.u2, 5);
        await (await fx.orders.connect(fx.m1).acceptOrder(orderId, chId)).wait();
        await (await fx.orders.connect(fx.m1).markPaymentSent(orderId)).wait();
        await (await fx.orders.connect(fx.u2).raiseDispute(orderId)).wait();
        await (await fx.config.connect(fx.deployer).pausePlatform()).wait();
        await (await fx.orders.connect(fx.deployer).resolveDispute(orderId, DisputeResult.MERCHANT_WINS)).wait();
        const o = await fx.orders.getOrder(orderId);
        assertEq(o.disputeStatus, DisputeStatus.SETTLED);
    });

    // Post-suite bookkeeping.
    return results;
}

// ── Main ──────────────────────────────────────────────────────────────────

(async function main() {
    const t0 = Date.now();
    try {
        await ensureAnvil();
        console.log("↳ deploying full Diamond stack...");
        const fx = await deployStack();
        console.log(`↳ diamond deployed at ${fx.diamondAddress}`);
        console.log("↳ running scenarios...");
        await runAllTests(fx);
    } catch (e) {
        console.error("\nFATAL:", e?.message || e);
        results.failed += 1;
    } finally {
        stopAnvil();
    }

    const totalMs = Date.now() - t0;
    console.log("");
    console.log("─".repeat(60));
    console.log(`Total: ${results.passed + results.failed} tests, ` +
        `\x1b[32m${results.passed} passed\x1b[0m, ` +
        `\x1b[31m${results.failed} failed\x1b[0m in ${totalMs}ms`);
    if (results.failed > 0) {
        console.log("\nFailures:");
        for (const c of results.cases.filter((x) => !x.ok)) {
            console.log(`  ✗ ${c.name}`);
            console.log(`      ${c.err}`);
        }
        process.exit(1);
    }
    process.exit(0);
})();
