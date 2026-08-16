import { readFile } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const BASE_SEPOLIA_CHAIN_ID = 84_532;
const BASE_SEPOLIA_CHAIN_HEX = "0x14a34";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const TRANSACTION_HASH = /^0x(?!0{64}$)[0-9a-fA-F]{64}$/u;
const SENSITIVE_KEY = /(?:private.?key|mnemonic|seed|secret|password|credential|bearer|signature)/iu;
const RECEIPT_ORDER_PATH = /^\/orders\/0x(?!0{64}$)[0-9a-fA-F]{64}$/u;

export const PRODUCTION_UI_ACTION_SELECTORS = Object.freeze({
  user: Object.freeze({
    amount: Object.freeze({ role: "textbox", name: "USDC amount" }),
    buySubmit: Object.freeze({ role: "button", name: "Create buy order" }),
    sellReview: Object.freeze({ role: "button", name: "Review sell order" }),
    payout: Object.freeze({ role: "textbox", name: "UPI ID" }),
    sellSubmit: Object.freeze({ role: "button", name: "Approve exact amount & create order" }),
  }),
  merchant: Object.freeze({
    assignment: Object.freeze({ role: "button", name: "Accept assignment" }),
    rejectAssignment: Object.freeze({ role: "button", name: "Reject assignment" }),
    markFiatSent: Object.freeze({ role: "button", name: "I sent the fiat payment" }),
    confirmFiatReceived: Object.freeze({ role: "button", name: "I received the fiat payment" }),
    dispute: Object.freeze({ role: "button", name: "Open dispute" }),
  }),
  admin: Object.freeze({
    approveMerchant: Object.freeze({ role: "button", name: "Approve merchant" }),
    approveChannel: Object.freeze({ role: "button", name: "Approve" }),
    pause: Object.freeze({ role: "button", name: "Pause protocol" }),
    unpause: Object.freeze({ role: "button", name: "Unpause protocol" }),
    settleDispute: Object.freeze({ role: "button", name: "Settle trade" }),
    cancelDispute: Object.freeze({ role: "button", name: "Cancel trade" }),
    recoverOrder: Object.freeze({ role: "button", name: "Recover expired order" }),
  }),
});

const APP_DEFAULTS = Object.freeze({
  user: Object.freeze({
    protectedPath: "/buy",
    loginHeading: "Trade USDC with a verified wallet session",
    connectLabel: "Connect wallet",
    signInLabel: null,
  }),
  merchant: Object.freeze({
    protectedPath: "/assignments",
    loginHeading: "Merchant operations, secured by your wallet",
    connectLabel: "Connect merchant wallet",
    signInLabel: "Sign in securely",
  }),
  admin: Object.freeze({
    protectedPath: "/operations",
    loginHeading: "Verify your operations wallet",
    connectLabel: "Connect operations wallet",
    signInLabel: "Create secure session",
  }),
});

const FORWARDED_METHOD = /^(?:eth_(?:blockNumber|call|chainId|estimateGas|feeHistory|gasPrice|getBalance|getBlockByHash|getBlockByNumber|getBlockReceipts|getCode|getLogs|getStorageAt|getTransactionByHash|getTransactionCount|getTransactionReceipt|maxPriorityFeePerGas|sendTransaction|sign|signTypedData(?:_v[1-4])?|syncing)|net_(?:listening|peerCount|version)|personal_sign|web3_clientVersion)$/u;

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function record(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
}

function assertNoSensitiveKeys(value, path = "options") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`BROWSER_OPTIONS_SENSITIVE_FIELD:${path}.${key}`);
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

function loopbackUrl(value, { httpsOnly = false, code }) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(code);
  }
  const loopback = isLoopbackHost(parsed.hostname);
  const protocolAllowed = httpsOnly ? parsed.protocol === "https:" : ["http:", "https:"].includes(parsed.protocol);
  if (
    !loopback || !protocolAllowed || parsed.username !== "" || parsed.password !== "" ||
    parsed.search !== "" || parsed.hash !== ""
  ) throw new Error(code);
  return parsed;
}

function isLoopbackNetworkRequest(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return true;
  return isLoopbackHost(parsed.hostname);
}

function pathValue(value, code) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("?")) {
    throw new Error(code);
  }
  return value;
}

function textValue(value, code) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) throw new Error(code);
  return value;
}

function normalizeRoute(value, appIndex, routeIndex) {
  const input = record(value, `BROWSER_ROUTE_INVALID:${appIndex}:${routeIndex}`);
  return Object.freeze({
    path: pathValue(input.path, `BROWSER_ROUTE_PATH_INVALID:${appIndex}:${routeIndex}`),
    expectedText: textValue(input.expectedText, `BROWSER_ROUTE_TEXT_INVALID:${appIndex}:${routeIndex}`),
  });
}

function normalizeApplication(value, index) {
  const input = record(value, `BROWSER_APPLICATION_INVALID:${index}`);
  const defaults = APP_DEFAULTS[input.kind];
  if (!defaults) throw new Error(`BROWSER_APPLICATION_KIND_INVALID:${index}`);
  const base = loopbackUrl(input.baseUrl, { httpsOnly: true, code: `BROWSER_APPLICATION_URL_INVALID:${index}` });
  if (base.pathname !== "/") throw new Error(`BROWSER_APPLICATION_URL_INVALID:${index}`);
  if (!ADDRESS.test(input.account ?? "")) throw new Error(`BROWSER_APPLICATION_ACCOUNT_INVALID:${index}`);
  if (!Array.isArray(input.routes) || input.routes.length === 0) {
    throw new Error(`BROWSER_APPLICATION_ROUTES_REQUIRED:${index}`);
  }
  const id = input.id ?? input.kind;
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,40}$/u.test(id)) {
    throw new Error(`BROWSER_APPLICATION_ID_INVALID:${index}`);
  }
  const signInLabel = input.signInLabel === undefined ? defaults.signInLabel : input.signInLabel;
  if (input.financialActions !== undefined && typeof input.financialActions !== "boolean") {
    throw new Error(`BROWSER_FINANCIAL_ACTIONS_INVALID:${index}`);
  }
  return Object.freeze({
    id,
    kind: input.kind,
    baseUrl: base.origin,
    account: input.account.toLowerCase(),
    protectedPath: pathValue(input.protectedPath ?? defaults.protectedPath, `BROWSER_PROTECTED_PATH_INVALID:${index}`),
    loginHeading: textValue(input.loginHeading ?? defaults.loginHeading, `BROWSER_LOGIN_HEADING_INVALID:${index}`),
    connectLabel: textValue(input.connectLabel ?? defaults.connectLabel, `BROWSER_CONNECT_LABEL_INVALID:${index}`),
    signInLabel: signInLabel === null
      ? null
      : textValue(signInLabel, `BROWSER_SIGN_IN_LABEL_INVALID:${index}`),
    financialActions: input.financialActions === true,
    routes: Object.freeze(input.routes.map((route, routeIndex) => normalizeRoute(route, index, routeIndex))),
  });
}

function requiredAddress(accounts, key) {
  const value = accounts[key];
  if (!ADDRESS.test(value ?? "")) throw new Error(`BROWSER_ACCOUNT_REQUIRED:${key}`);
  return value;
}

function expandConvenienceOptions(value) {
  const input = record(value, "BROWSER_OPTIONS_INVALID");
  if (input.applications !== undefined || input.urls === undefined) return input;
  const urls = record(input.urls, "BROWSER_URLS_INVALID");
  const descriptor = input.descriptor === undefined ? {} : record(input.descriptor, "BROWSER_DESCRIPTOR_INVALID");
  if (descriptor.chainId !== undefined && descriptor.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error("BROWSER_DESCRIPTOR_CHAIN_INVALID");
  }
  const suppliedAccounts = input.accounts === undefined ? {} : record(input.accounts, "BROWSER_ACCOUNTS_INVALID");
  const descriptorAccounts = descriptor.accounts === undefined ? {} : record(descriptor.accounts, "BROWSER_DESCRIPTOR_ACCOUNTS_INVALID");
  const accounts = { ...descriptorAccounts, ...suppliedAccounts };
  return {
    ...input,
    applications: [
      {
        id: "user",
        kind: "user",
        baseUrl: urls.user,
        account: requiredAddress(accounts, "user"),
        protectedPath: "/buy",
        financialActions: true,
        routes: [{ path: "/buy", expectedText: "Buy USDC" }],
      },
      {
        id: "merchant",
        kind: "merchant",
        baseUrl: urls.merchant,
        account: requiredAddress(accounts, "merchant"),
        protectedPath: "/assignments",
        routes: [{ path: "/", expectedText: "Live operations" }],
      },
      {
        id: "admin-operator",
        kind: "admin",
        baseUrl: urls.admin,
        account: requiredAddress(accounts, "operator"),
        protectedPath: "/operations",
        routes: [{ path: "/operations", expectedText: "Operations health" }],
      },
      {
        id: "admin-pauser",
        kind: "admin",
        baseUrl: urls.admin,
        account: requiredAddress(accounts, "pauser"),
        protectedPath: "/safety",
        routes: [{ path: "/safety", expectedText: "Protocol safety" }],
      },
      {
        id: "admin-dispute-resolver",
        kind: "admin",
        baseUrl: urls.admin,
        account: requiredAddress(accounts, "disputeResolver"),
        protectedPath: "/orders",
        routes: [{ path: "/orders", expectedText: "Orders and disputes" }],
      },
    ],
  };
}

export function normalizeBrowserJourneyOptions(value) {
  assertNoSensitiveKeys(value);
  const input = expandConvenienceOptions(value);
  if (input.chainId !== undefined && input.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error("BROWSER_CHAIN_ID_INVALID");
  }
  const rpc = loopbackUrl(input.rpcUrl, { httpsOnly: false, code: "BROWSER_RPC_URL_INVALID" });
  if (!Array.isArray(input.applications) || input.applications.length === 0) {
    throw new Error("BROWSER_APPLICATIONS_REQUIRED");
  }
  const ids = new Set();
  const applications = input.applications.map((app, index) => {
    const normalized = normalizeApplication(app, index);
    if (ids.has(normalized.id)) throw new Error(`BROWSER_APPLICATION_DUPLICATE:${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    throw new Error("BROWSER_TIMEOUT_INVALID");
  }
  const browser = input.browser === undefined ? {} : record(input.browser, "BROWSER_LAUNCH_OPTIONS_INVALID");
  if (browser.headless !== undefined && typeof browser.headless !== "boolean") {
    throw new Error("BROWSER_HEADLESS_INVALID");
  }
  if (browser.executablePath !== undefined && (typeof browser.executablePath !== "string" || browser.executablePath === "")) {
    throw new Error("BROWSER_EXECUTABLE_PATH_INVALID");
  }
  const executor = input.executorUrl === undefined
    ? null
    : loopbackUrl(input.executorUrl, { httpsOnly: true, code: "BROWSER_EXECUTOR_URL_INVALID" });
  if (input.coordinatedActionDriver !== undefined && typeof input.coordinatedActionDriver !== "function") {
    throw new Error("BROWSER_COORDINATED_ACTION_DRIVER_INVALID");
  }
  if (input.onPrivatePayout !== undefined && typeof input.onPrivatePayout !== "function") {
    throw new Error("BROWSER_PRIVATE_PAYOUT_OBSERVER_INVALID");
  }
  return Object.freeze({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    chainHex: BASE_SEPOLIA_CHAIN_HEX,
    rpcUrl: rpc.toString(),
    executorOrigin: executor?.origin ?? null,
    coordinatedActionDriver: input.coordinatedActionDriver ?? null,
    onPrivatePayout: input.onPrivatePayout ?? null,
    timeoutMs,
    browser: Object.freeze({
      headless: browser.headless !== false,
      ...(browser.executablePath ? { executablePath: browser.executablePath } : {}),
    }),
    applications: Object.freeze(applications),
  });
}

function rpcFailure(payload) {
  const error = new Error(payload?.message || "LOCAL_RPC_ERROR");
  if (Number.isInteger(payload?.code)) error.code = payload.code;
  if (payload?.data !== undefined) error.data = payload.data;
  return error;
}

function addressFromTransaction(params) {
  const value = Array.isArray(params) ? params[0] : null;
  return value && typeof value === "object" && typeof value.from === "string" ? value.from.toLowerCase() : null;
}

function signingAddress(method, params) {
  if (!Array.isArray(params)) return null;
  if (method === "personal_sign") {
    return params.find((item) => typeof item === "string" && ADDRESS.test(item))?.toLowerCase() ?? null;
  }
  return typeof params[0] === "string" && ADDRESS.test(params[0]) ? params[0].toLowerCase() : null;
}

async function requestLocalRpc(requestContext, rpcUrl, method, params = []) {
  const response = await requestContext.post(rpcUrl, {
    headers: { "content-type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  if (!response.ok()) throw new Error("LOCAL_RPC_HTTP_ERROR");
  const payload = await response.json();
  if (payload.error) throw rpcFailure(payload.error);
  if (!("result" in payload)) throw new Error("LOCAL_RPC_RESPONSE_INVALID");
  return payload.result;
}

async function forwardLocalRpc({ requestContext, rpcUrl, account, confirmationDepth, method, params }) {
  if (!FORWARDED_METHOD.test(method)) throw new Error("EIP1193_METHOD_NOT_ALLOWED");
  if (method === "eth_sendTransaction" && addressFromTransaction(params) !== account) {
    throw new Error("EIP1193_TRANSACTION_ACCOUNT_MISMATCH");
  }
  if ((method === "personal_sign" || method.startsWith("eth_sign")) && signingAddress(method, params) !== account) {
    throw new Error("EIP1193_SIGNING_ACCOUNT_MISMATCH");
  }
  const result = await requestLocalRpc(
    requestContext,
    rpcUrl,
    method,
    Array.isArray(params) ? params : [],
  );
  if (method === "eth_sendTransaction") {
    if (!TRANSACTION_HASH.test(result ?? "")) throw new Error("LOCAL_RPC_TRANSACTION_HASH_INVALID");
    for (let index = 0; index < confirmationDepth; index += 1) {
      await requestLocalRpc(requestContext, rpcUrl, "evm_mine");
    }
  }
  return result;
}

/**
 * Install the only browser seam used by the system test. It lives in a fresh
 * Playwright document before application code and delegates to an unlocked,
 * loopback-only JSON-RPC node. No key material enters the browser or options.
 */
export async function installTestEip1193Provider(page, options) {
  const account = options.account.toLowerCase();
  const rpcUrl = options.rpcUrl;
  const confirmationDepth = options.confirmationDepth ?? 12;
  if (confirmationDepth !== 12) throw new Error("EIP1193_CONFIRMATION_DEPTH_INVALID");
  await page.exposeBinding("__p2pflowSystemRpc", async (_source, request) => {
    const input = record(request, "EIP1193_REQUEST_INVALID");
    return forwardLocalRpc({
      requestContext: page.context().request,
      rpcUrl,
      account,
      confirmationDepth,
      method: input.method,
      params: input.params,
    }).then((result) => {
      if (input.method === "eth_sendTransaction") options.onTransaction?.();
      return result;
    });
  });
  await page.addInitScript(({ injectedAccount, chainHex, chainId }) => {
    const listeners = new Map();
    const announce = () => {
      const detail = Object.freeze({
        info: Object.freeze({
          uuid: "350670db-19fa-4704-a166-e52e178b59d2",
          name: "MetaMask",
          icon: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
          rdns: "io.metamask",
        }),
        provider,
      });
      globalThis.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    };
    const emit = (event, value) => {
      for (const listener of listeners.get(event) ?? []) listener(value);
    };
    const provider = {
      isMetaMask: true,
      selectedAddress: injectedAccount,
      chainId: chainHex,
      networkVersion: String(chainId),
      isConnected: () => true,
      enable: async () => [injectedAccount],
      request: async ({ method, params = [] } = {}) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [injectedAccount];
        if (method === "eth_chainId") return chainHex;
        if (method === "net_version") return String(chainId);
        if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") {
          return [{ parentCapability: "eth_accounts", caveats: [] }];
        }
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
          const requested = params?.[0]?.chainId?.toLowerCase();
          if (requested !== chainHex) {
            const error = new Error("Unsupported test chain");
            error.code = 4902;
            throw error;
          }
          provider.chainId = chainHex;
          provider.networkVersion = String(chainId);
          emit("chainChanged", chainHex);
          return null;
        }
        if (method === "wallet_revokePermissions") return null;
        return globalThis.__p2pflowSystemRpc({ method, params });
      },
      on: (event, listener) => {
        const registered = listeners.get(event) ?? new Set();
        registered.add(listener);
        listeners.set(event, registered);
        return provider;
      },
      once: (event, listener) => {
        const wrapper = (value) => {
          provider.removeListener(event, wrapper);
          listener(value);
        };
        return provider.on(event, wrapper);
      },
      removeListener: (event, listener) => {
        listeners.get(event)?.delete(listener);
        return provider;
      },
      removeAllListeners: (event) => {
        if (event === undefined) listeners.clear();
        else listeners.delete(event);
        return provider;
      },
      _metamask: Object.freeze({ isUnlocked: async () => true }),
    };
    Object.defineProperty(provider, "providers", { value: Object.freeze([provider]) });
    Object.defineProperty(globalThis, "ethereum", { value: provider, configurable: false, writable: false });
    Object.defineProperty(globalThis, "__P2PFLOW_SYSTEM_TEST_EIP1193__", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    globalThis.addEventListener("eip6963:requestProvider", announce);
    queueMicrotask(announce);
  }, { injectedAccount: account, chainHex: BASE_SEPOLIA_CHAIN_HEX, chainId: BASE_SEPOLIA_CHAIN_ID });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactLabel(value) {
  return new RegExp(`^${escapeRegExp(value)}$`, "iu");
}

function safeDiagnostic(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/0x[0-9a-fA-F]{40,}/gu, "[REDACTED_HEX]")
    .replace(/https?:\/\/[^\s)]+/gu, "[REDACTED_URL]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 240);
}

async function step(evidence, name, operation) {
  const startedAt = Date.now();
  try {
    const detail = await operation();
    evidence.steps.push({ name, status: "passed", durationMs: Date.now() - startedAt, ...(detail ?? {}) });
    return detail;
  } catch (error) {
    evidence.steps.push({
      name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      diagnostic: safeDiagnostic(error),
    });
    throw error;
  }
}

async function assertProductionDocument(page) {
  const markers = await page.locator("script[src]").evaluateAll((scripts) => scripts.map((script) => script.src));
  if (markers.length === 0 || !markers.some((source) => /\/assets\/[^/]+\.js(?:$|\?)/u.test(source))) {
    throw new Error("PRODUCTION_ASSET_MARKER_MISSING");
  }
  if (markers.some((source) => source.includes("/@vite/client") || source.includes("/src/"))) {
    throw new Error("DEVELOPMENT_ENTRYPOINT_DETECTED");
  }
  const injected = await page.evaluate(() => globalThis.__P2PFLOW_SYSTEM_TEST_EIP1193__ === true);
  if (!injected) throw new Error("TEST_EIP1193_PROVIDER_MISSING");
  return { hashedModuleAssets: markers.filter((source) => /\/assets\//u.test(source)).length };
}

async function connectInjectedWallet(page, app, timeoutMs) {
  await page.getByRole("button", { name: exactLabel(app.connectLabel) }).first().click();
  const wallet = page.getByText("MetaMask", { exact: true }).first();
  await wallet.waitFor({ state: "visible", timeout: timeoutMs });
  await wallet.click();
  if (app.signInLabel !== null) {
    const signIn = page.getByRole("button", { name: exactLabel(app.signInLabel) }).first();
    await signIn.waitFor({ state: "visible", timeout: timeoutMs });
    await signIn.click();
  }
  await page.waitForFunction(() => globalThis.ethereum?.selectedAddress !== null, undefined, { timeout: timeoutMs });
}

async function assertRoute(page, baseUrl, route, timeoutMs) {
  await page.goto(new URL(route.path, baseUrl).href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.getByText(route.expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
  const current = new URL(page.url());
  if (current.pathname !== route.path) throw new Error(`ROLE_ROUTE_REDIRECTED:${route.path}:${current.pathname}`);
  return { path: route.path, expectedText: route.expectedText };
}

function actionLocator(page, selector) {
  return page.getByRole(selector.role, { name: exactLabel(selector.name) }).first();
}

async function waitForReceiptOrderRoute(page, timeoutMs) {
  await page.waitForURL((url) => RECEIPT_ORDER_PATH.test(url.pathname), { timeout: timeoutMs });
  const pathname = new URL(page.url()).pathname;
  if (!RECEIPT_ORDER_PATH.test(pathname)) throw new Error("RECEIPT_ORDER_NAVIGATION_INVALID");
  return pathname.slice("/orders/".length).toLowerCase();
}

function syntheticPrivatePayout() {
  return `p2p${Date.now().toString(36)}${String.fromCharCode(64)}bank`;
}

async function sellRecoveryDiagnostic(page, rpcUrl) {
  try {
    const recovery = await page.evaluate(() => {
      for (let index = 0; index < globalThis.localStorage.length; index += 1) {
        const key = globalThis.localStorage.key(index);
        if (!key?.startsWith("p2pflow:tx-recovery:v1")) continue;
        const parsed = JSON.parse(globalThis.localStorage.getItem(key));
        if (parsed?.kind === "SELL_WORKFLOW") {
          return { phase: parsed.phase, transactionHash: parsed.transactionHash };
        }
      }
      return null;
    });
    if (recovery === null || typeof recovery.phase !== "string" || !/^[A-Z_]+$/u.test(recovery.phase)) return "none";
    if (!TRANSACTION_HASH.test(recovery.transactionHash ?? "")) return `phase=${recovery.phase},receipt=none`;
    const receipt = await requestLocalRpc(
      page.context().request,
      rpcUrl,
      "eth_getTransactionReceipt",
      [recovery.transactionHash],
    );
    const blockNumber = receipt?.blockNumber === undefined ? null : Number.parseInt(receipt.blockNumber, 16);
    return `phase=${recovery.phase},receiptBlock=${Number.isSafeInteger(blockNumber) ? String(blockNumber) : "invalid"}`;
  } catch {
    return "unavailable";
  }
}

async function assertPrivatePayoutEphemeral(page, payout, destinations, executorOrigin) {
  if (
    destinations.length === 0 || destinations.some(({ method, origin, pathname }) => (
      method !== "POST" || origin !== executorOrigin || pathname !== "/v1/payment-references"
    ))
  ) throw new Error("PRIVATE_PAYOUT_NETWORK_BOUNDARY_INVALID");
  const persisted = await page.evaluate((value) => {
    const values = [
      globalThis.location.href,
      JSON.stringify(globalThis.history.state),
      ...Object.keys(globalThis.localStorage),
      ...Object.values(globalThis.localStorage),
      ...Object.keys(globalThis.sessionStorage),
      ...Object.values(globalThis.sessionStorage),
    ];
    return values.some((candidate) => String(candidate).includes(value));
  }, payout);
  if (persisted) throw new Error("PRIVATE_PAYOUT_PERSISTED_IN_BROWSER");
}

async function runUserFinancialActions(page, app, options, evidence) {
  if (options.executorOrigin === null) throw new Error("FINANCIAL_ACTION_EXECUTOR_REQUIRED");
  const selectors = PRODUCTION_UI_ACTION_SELECTORS.user;
  const transactionStart = evidence.browserSignals.walletTransactions;

  await page.goto(new URL("/buy", app.baseUrl).href, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
  await page.getByRole("heading", { name: "Buy USDC" }).waitFor({ state: "visible", timeout: options.timeoutMs });
  await actionLocator(page, selectors.amount).fill("1");
  await actionLocator(page, selectors.buySubmit).click({ timeout: options.timeoutMs });
  const buyOrderId = await waitForReceiptOrderRoute(page, options.timeoutMs);
  const afterBuy = evidence.browserSignals.walletTransactions;
  if (afterBuy - transactionStart !== 1) throw new Error("BUY_BROWSER_TRANSACTION_COUNT_INVALID");
  evidence.actions.push(Object.freeze({
    action: "create-buy",
    initiatedBy: "browser",
    receiptConfirmed: true,
    orderNavigation: "receipt-derived",
    walletTransactions: 1,
  }));

  await page.goto(new URL("/sell", app.baseUrl).href, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
  await page.getByRole("heading", { name: "Sell USDC" }).waitFor({ state: "visible", timeout: options.timeoutMs });
  await actionLocator(page, selectors.amount).fill("1");
  await actionLocator(page, selectors.sellReview).click({ timeout: options.timeoutMs });
  await page.waitForURL((url) => url.pathname === "/sell/review", { timeout: options.timeoutMs });
  await page.getByRole("heading", { name: "Review exact SELL approval" })
    .waitFor({ state: "visible", timeout: options.timeoutMs });

  const payout = syntheticPrivatePayout();
  options.onPrivatePayout?.(payout);
  const destinations = [];
  const observePrivateRequest = (request) => {
    if (!request.postData()?.includes(payout)) return;
    const target = new URL(request.url());
    destinations.push({ method: request.method(), origin: target.origin, pathname: target.pathname });
  };
  page.on("request", observePrivateRequest);
  try {
    await actionLocator(page, selectors.payout).fill(payout);
    await actionLocator(page, selectors.sellSubmit).click({ timeout: options.timeoutMs });
    let sellOrderId;
    try {
      sellOrderId = await Promise.race([
        waitForReceiptOrderRoute(page, options.timeoutMs),
        page.getByRole("alert").first().waitFor({ state: "visible", timeout: options.timeoutMs }).then(async () => {
          const alert = await page.getByRole("alert").first().textContent() ?? "SELL action failed";
          if (alert.includes(payout)) throw new Error("PRIVATE_PAYOUT_LEAKED_IN_ERROR");
          throw new Error(`SELL_UI_ERROR:${safeDiagnostic(alert)}`);
        }),
      ]);
    } catch (error) {
      const alerts = await page.getByRole("alert").allTextContents().catch(() => []);
      if (alerts.some((alert) => alert.includes(payout))) throw new Error("PRIVATE_PAYOUT_LEAKED_IN_ERROR");
      const alertDiagnostic = alerts.length === 0 ? "none" : alerts.map((alert) => safeDiagnostic(alert)).join("|");
      const recoveryDiagnostic = await sellRecoveryDiagnostic(page, options.rpcUrl);
      throw new Error(
        `SELL_RECEIPT_NAVIGATION_FAILED:path=${new URL(page.url()).pathname}:alerts=${alertDiagnostic}:recovery=${recoveryDiagnostic}:cause=${safeDiagnostic(error)}`,
      );
    }
    if (sellOrderId === buyOrderId) throw new Error("RECEIPT_ORDER_IDS_NOT_UNIQUE");
    const sellTransactions = evidence.browserSignals.walletTransactions - afterBuy;
    if (sellTransactions < 2 || sellTransactions > 3) throw new Error("SELL_BROWSER_TRANSACTION_COUNT_INVALID");
    await assertPrivatePayoutEphemeral(page, payout, destinations, options.executorOrigin);
    evidence.actions.push(Object.freeze({
      action: "create-sell",
      initiatedBy: "browser",
      receiptConfirmed: true,
      orderNavigation: "receipt-derived",
      privatePayoutPersisted: false,
      walletTransactions: sellTransactions,
    }));
    return Object.freeze({ buyOrderId, sellOrderId });
  } finally {
    page.off("request", observePrivateRequest);
  }
}

function normalizeCoordinatedActions(value, applicationId) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("COORDINATED_ACTION_EVIDENCE_INVALID");
  return value.map((item) => {
    const input = record(item, "COORDINATED_ACTION_EVIDENCE_INVALID");
    if (typeof input.action !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(input.action)) {
      throw new Error("COORDINATED_ACTION_EVIDENCE_INVALID");
    }
    if (!["browser", "orchestrator"].includes(input.initiatedBy) || typeof input.receiptConfirmed !== "boolean") {
      throw new Error("COORDINATED_ACTION_EVIDENCE_INVALID");
    }
    return Object.freeze({
      action: input.action,
      initiatedBy: input.initiatedBy,
      receiptConfirmed: input.receiptConfirmed,
      application: applicationId,
    });
  });
}

async function runApplication(browser, options, app) {
  const evidence = {
    application: app.id,
    kind: app.kind,
    origin: app.baseUrl,
    status: "running",
    interactionLevel: "rendered",
    actions: [],
    steps: [],
    browserSignals: {
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      blockedExternalRequests: 0,
      blockedExternalWebSockets: 0,
      executorRequests: 0,
      walletTransactions: 0,
    },
  };
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    if (isLoopbackNetworkRequest(route.request().url())) {
      await route.continue();
      return;
    }
    evidence.browserSignals.blockedExternalRequests += 1;
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", async (webSocket) => {
    const target = new URL(webSocket.url());
    if (["ws:", "wss:"].includes(target.protocol) && isLoopbackHost(target.hostname)) {
      webSocket.connectToServer();
      return;
    }
    evidence.browserSignals.blockedExternalWebSockets += 1;
    await webSocket.close({ code: 1008, reason: "External network disabled by system test" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  page.on("console", (message) => {
    if (message.type() === "error") evidence.browserSignals.consoleErrors += 1;
  });
  page.on("pageerror", () => { evidence.browserSignals.pageErrors += 1; });
  page.on("requestfailed", () => { evidence.browserSignals.failedRequests += 1; });
  page.on("request", (request) => {
    if (options.executorOrigin !== null && new URL(request.url()).origin === options.executorOrigin) {
      evidence.browserSignals.executorRequests += 1;
    }
  });
  try {
    await installTestEip1193Provider(page, {
      rpcUrl: options.rpcUrl,
      account: app.account,
      confirmationDepth: 12,
      onTransaction: () => { evidence.browserSignals.walletTransactions += 1; },
    });
    await step(evidence, "protected-route-redirect", async () => {
      await page.goto(new URL(app.protectedPath, app.baseUrl).href, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      await page.getByRole("heading", { name: app.loginHeading }).waitFor({ state: "visible", timeout: options.timeoutMs });
      if (new URL(page.url()).pathname !== "/login") throw new Error("UNAUTHENTICATED_ROUTE_NOT_GUARDED");
      return { requestedPath: app.protectedPath, redirectedPath: "/login" };
    });
    await step(evidence, "production-bundle-boundary", () => assertProductionDocument(page));
    await step(evidence, "injected-wallet-session", async () => {
      await connectInjectedWallet(page, app, options.timeoutMs);
      await page.waitForURL((url) => url.pathname !== "/login", { timeout: options.timeoutMs });
      if (options.executorOrigin !== null && evidence.browserSignals.executorRequests === 0) {
        throw new Error("EXECUTOR_SESSION_BOUNDARY_NOT_OBSERVED");
      }
      return { provider: "playwright-init-script-eip1193", chainId: BASE_SEPOLIA_CHAIN_ID };
    });
    for (const route of app.routes) {
      await step(evidence, `role-route:${route.path}`, () => assertRoute(page, app.baseUrl, route, options.timeoutMs));
    }
    let browserActionState = null;
    if (app.kind === "user" && app.financialActions) {
      await step(evidence, "financial-actions:buy-and-sell-create", async () => {
        browserActionState = await runUserFinancialActions(page, app, options, evidence);
        return { actionsConfirmed: 2 };
      });
      evidence.interactionLevel = "financial-action";
    }
    if (options.coordinatedActionDriver !== null) {
      let coordinated = [];
      await step(evidence, "coordinated-actions", async () => {
        coordinated = normalizeCoordinatedActions(await options.coordinatedActionDriver(Object.freeze({
          applicationId: app.id,
          kind: app.kind,
          page,
          selectors: PRODUCTION_UI_ACTION_SELECTORS[app.kind],
          timeoutMs: options.timeoutMs,
          browserActionState,
        })), app.id);
        return { actionCount: coordinated.length };
      });
      evidence.actions.push(...coordinated);
      if (coordinated.some((action) => action.initiatedBy === "browser")) {
        evidence.interactionLevel = "financial-action";
      } else if (coordinated.length > 0 && evidence.interactionLevel === "rendered") {
        evidence.interactionLevel = "orchestrated";
      }
    }
    if (evidence.browserSignals.pageErrors > 0) throw new Error("BROWSER_PAGE_ERRORS_DETECTED");
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = safeDiagnostic(error);
  } finally {
    await context.close();
  }
  return evidence;
}

export class ProductionBrowserJourneyError extends Error {
  constructor(evidence) {
    super("PRODUCTION_BROWSER_JOURNEY_FAILED");
    this.name = "ProductionBrowserJourneyError";
    this.evidence = evidence;
  }
}

/**
 * Run browser evidence against already-served Vite production builds. The
 * caller owns the HTTPS static servers, runtime document, executor, GraphQL,
 * and isolated chain lifecycle. A programmatic caller may supply
 * `coordinatedActionDriver({ applicationId, kind, page, selectors,
 * timeoutMs, browserActionState })`; it returns only redacted action records
 * shaped as `{ action, initiatedBy: "browser" | "orchestrator",
 * receiptConfirmed }`. Callers coordinate cross-role ordering in their own
 * closure. JSON/CLI runs intentionally cannot install this callback.
 */
export async function runProductionBrowserJourneys(rawOptions) {
  const options = normalizeBrowserJourneyOptions(rawOptions);
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch(options.browser);
  const evidence = {
    kind: "p2pflow-production-browser-evidence",
    version: 2,
    startedAt,
    completedAt: null,
    status: "running",
    chainId: BASE_SEPOLIA_CHAIN_ID,
    browser: { name: "chromium", version: browser.version(), headless: options.browser.headless },
    applications: [],
  };
  try {
    evidence.applications.push(...await Promise.all(
      options.applications.map((app) => runApplication(browser, options, app)),
    ));
  } finally {
    await browser.close();
    evidence.completedAt = new Date().toISOString();
  }
  evidence.status = evidence.applications.every((app) => app.status === "passed") ? "passed" : "failed";
  evidence.coverage = Object.freeze({
    browserDrivenActions: evidence.applications.flatMap((app) => app.actions
      .filter((action) => action.initiatedBy === "browser")
      .map((action) => `${app.application}:${action.action}`)),
    orchestratedActions: evidence.applications.flatMap((app) => app.actions
      .filter((action) => action.initiatedBy === "orchestrator")
      .map((action) => `${app.application}:${action.action}`)),
    renderedOnlyApplications: evidence.applications
      .filter((app) => app.interactionLevel === "rendered")
      .map((app) => app.application),
  });
  if (evidence.status !== "passed") throw new ProductionBrowserJourneyError(evidence);
  return evidence;
}

export async function loadBrowserJourneyOptions(configPath) {
  if (
    typeof configPath !== "string" || !isAbsolute(configPath) ||
    extname(configPath).toLowerCase() !== ".json"
  ) throw new Error("BROWSER_CONFIG_PATH_REQUIRED");
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function cli() {
  const configFlag = process.argv.indexOf("--config");
  if (configFlag === -1 || !process.argv[configFlag + 1]) throw new Error("usage: browser-production.mjs --config <absolute-json-path>");
  const raw = await loadBrowserJourneyOptions(process.argv[configFlag + 1]);
  try {
    const evidence = await runProductionBrowserJourneys(raw);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    if (error instanceof ProductionBrowserJourneyError) {
      process.stdout.write(`${JSON.stringify(error.evidence, null, 2)}\n`);
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    process.stderr.write(`${safeDiagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
