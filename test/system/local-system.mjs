import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createReadStream,
  existsSync,
} from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  Contract,
  Interface,
  JsonRpcProvider,
  id,
} from "ethers";

import {
  DIAMOND_ABI,
  USDC_ABI,
} from "../../packages/protocol/dist/index.js";
import { createDatabase } from "../../../p2pflow-executor/dist/db/index.js";

const SYSTEM_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SMART_ROOT = path.resolve(SYSTEM_DIRECTORY, "../..");
const WORKSPACE_ROOT = path.resolve(SMART_ROOT, "..");
const EXECUTOR_ROOT = path.join(WORKSPACE_ROOT, "p2pflow-executor");
const UI_ROOTS = Object.freeze({
  user: path.join(WORKSPACE_ROOT, "p2pflow-user-ui"),
  merchant: path.join(WORKSPACE_ROOT, "p2pflow-merchant-ui"),
  admin: path.join(WORKSPACE_ROOT, "p2pflow-admin-ui"),
});
const NODE_DIRECTORY = "/tmp/p2pflow-node";
const NODE_BINARY = path.join(NODE_DIRECTORY, "bin/node");
const NPM_CLI = path.join(NODE_DIRECTORY, "lib/node_modules/npm/bin/npm-cli.js");
const DEFAULT_POSTGRES_ROOT = "/tmp/p2pflow-pgroot";
const POSTGRES_BIN = process.env.P2PFLOW_POSTGRES_BIN_DIR
  ?? path.join(DEFAULT_POSTGRES_ROOT, "usr/lib/postgresql/14/bin");
const POSTGRES_SHARE = process.env.P2PFLOW_POSTGRES_SHARE_DIR
  ?? path.join(DEFAULT_POSTGRES_ROOT, "usr/share/postgresql/14");
const HARDHAT_CLI = path.join(SMART_ROOT, "node_modules/hardhat/internal/cli/cli.js");
const TEST_CLIENT_ID = "p2pflow_local_test_client";
const E6 = 1_000_000n;
const STATUS = Object.freeze([
  "CREATED", "ASSIGNED", "ACCEPTED", "FIAT_SENT", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED",
]);
const ORDER_TYPE = Object.freeze(["BUY", "SELL"]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

function processEnvironment(extra = {}) {
  return { ...process.env, PATH: `${path.join(NODE_DIRECTORY, "bin")}:${process.env.PATH ?? ""}`, ...extra };
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

function runningProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? processEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => { output = `${output}${chunk}`.slice(-262_144); };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, output: () => output };
}

async function completedProcess(command, args, options = {}) {
  const running = runningProcess(command, args, options);
  const [code, signal] = await once(running.child, "exit");
  if (code !== 0 || signal !== null) {
    throw new Error(`command failed (${String(code)}, ${String(signal)}): ${command} ${args.join(" ")}\n${running.output()}`);
  }
  return running.output();
}

async function stopProcess(running, signal = "SIGTERM") {
  if (!running || running.child.exitCode !== null || running.child.signalCode !== null) return;
  running.child.kill(signal);
  await Promise.race([
    once(running.child, "exit"),
    delay(5_000).then(() => {
      if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGKILL");
    }),
  ]);
}

async function waitFor(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let detail = "not attempted";
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
      detail = "predicate returned false";
    } catch (error) {
      if (error instanceof Error && error.message.includes("CHAIN_WRITES_DISABLED")) throw error;
      detail = error instanceof Error ? error.message : String(error);
    }
    await delay(75);
  }
  throw new Error(`${message}: ${detail}`);
}

async function listen(server, port = 0) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
}

async function requestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1_048_576) throw new Error("system fixture request exceeded one MiB");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw === "" ? {} : JSON.parse(raw);
}

function json(response, value, status = 200, origin = "*") {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "access-control-allow-credentials": origin === "*" ? "false" : "true",
    "access-control-allow-headers": "content-type,x-csrf-token,x-p2pflow-wallet",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-origin": origin,
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    vary: "origin",
  });
  response.end(body);
}

function jwt(audience) {
  const now = Math.floor(Date.now() / 1_000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part({
    aud: audience,
    exp: now + 300,
    iat: now,
    jti: `phase7-${String(now)}`,
    nbf: now - 1,
  })}.local-system-attestation`;
}

async function startPostgres(temporaryDirectory) {
  for (const executable of ["initdb", "pg_ctl"]) {
    if (!existsSync(path.join(POSTGRES_BIN, executable))) {
      throw new Error(`PostgreSQL executable missing: ${path.join(POSTGRES_BIN, executable)}`);
    }
  }
  const data = path.join(temporaryDirectory, "postgres-data");
  const socket = path.join(temporaryDirectory, "postgres-socket");
  const log = path.join(temporaryDirectory, "postgres.log");
  await completedProcess(path.join(POSTGRES_BIN, "initdb"), [
    "-D", data,
    "-L", POSTGRES_SHARE,
    "--username=postgres",
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await completedProcess("mkdir", ["-p", socket]);
  const port = await freePort();
  await completedProcess(path.join(POSTGRES_BIN, "pg_ctl"), [
    "-D", data,
    "-l", log,
    "-o", `-p ${String(port)} -k ${socket} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    "-w", "start",
  ]);
  return {
    databaseUrl: `postgresql://postgres@127.0.0.1:${String(port)}/postgres`,
    stop: () => completedProcess(path.join(POSTGRES_BIN, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]),
  };
}

async function startHardhat(temporaryDirectory) {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${String(port)}`;
  const running = runningProcess(NODE_BINARY, [HARDHAT_CLI, "node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: SMART_ROOT,
    env: processEnvironment(),
  });
  await waitFor(async () => {
    if (running.child.exitCode !== null) throw new Error(running.output());
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const body = await response.json();
    return body.result === "0x14a34";
  }, "Hardhat chainId 84532 did not start");
  const deploymentOutput = await completedProcess(NODE_BINARY, [
    HARDHAT_CLI,
    "run",
    "test/system/deploy-local-v2.js",
    "--network",
    "localhost",
  ], {
    cwd: SMART_ROOT,
    env: processEnvironment({
      P2PFLOW_HARDHAT_RPC_URL: rpcUrl,
      P2PFLOW_SYSTEM_RUNTIME_DIR: temporaryDirectory,
    }),
  });
  const line = deploymentOutput.split("\n").find((value) => value.startsWith("P2PFLOW_LOCAL_V2="));
  if (!line) throw new Error(`deployment descriptor missing\n${deploymentOutput}`);
  const descriptor = JSON.parse(line.slice("P2PFLOW_LOCAL_V2=".length));
  return { descriptor, provider: new JsonRpcProvider(rpcUrl, 84_532), rpcUrl, running };
}

async function createTls(temporaryDirectory) {
  const keyPath = path.join(temporaryDirectory, "local-system-key.pem");
  const certificatePath = path.join(temporaryDirectory, "local-system-certificate.pem");
  await completedProcess("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
    "-subj", "/CN=p2pflow-phase7-local",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
    "-keyout", keyPath,
    "-out", certificatePath,
  ]);
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certificatePath)]);
  return { certificatePath, key, cert };
}

function asString(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function graphOrder(order) {
  return {
    id: order.orderId,
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    status: order.status,
    user: order.user,
    merchant: order.merchant ? { id: order.merchant, wallet: order.merchant, status: "ACTIVE" } : null,
    channel: order.channelId ? { id: order.channelId, channelId: order.channelId, status: "APPROVED" } : null,
    usdcAmount: order.usdcAmount,
    fiatAmount: order.fiatAmountE6,
    fiatAmountE6: order.fiatAmountE6,
    selectedPriceE6: order.selectedPriceE6,
    price: order.selectedPriceE6,
    roundId: order.roundId,
    createdAt: order.createdAt,
    updatedAt: order.lastBlockTimestamp,
    orderDeadline: order.orderDeadline,
    acceptedAt: order.acceptedAt ?? null,
    acceptedRecoveryDeadline: order.acceptedRecoveryDeadline ?? null,
    fiatSentAt: order.fiatSentAt ?? null,
    paidAt: order.fiatSentAt ?? null,
    completedAt: order.completedAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
    expiredAt: order.expiredAt ?? null,
    assignmentEpoch: order.assignmentEpoch,
    assignmentDeadline: order.assignmentDeadline ?? null,
    custodyFinalized: ["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status),
    lastBlockNumber: order.lastBlockNumber,
    lastBlockTimestamp: order.lastBlockTimestamp,
    disputeStatus: order.dispute?.status ?? "NONE",
    disputeResult: order.dispute?.resolution ?? null,
    dispute: order.dispute ?? null,
    events: [],
  };
}

async function projectChain(provider, descriptor, toBlock) {
  const contractInterface = new Interface(DIAMOND_ABI);
  const logs = await provider.getLogs({
    address: descriptor.diamond,
    fromBlock: descriptor.deploymentBlock,
    toBlock,
  });
  const orders = new Map();
  const assignments = [];
  for (const log of logs) {
    let event;
    try { event = contractInterface.parseLog(log); } catch { continue; }
    if (!event) continue;
    const args = event.args;
    const orderId = typeof args.orderId === "string" ? args.orderId.toLowerCase() : null;
    if (event.name === "OrderCreated") {
      orders.set(orderId, {
        orderId,
        orderNumber: asString(args.orderNumber),
        orderType: ORDER_TYPE[Number(args.orderType)],
        status: "CREATED",
        user: args.user.toLowerCase(),
        merchant: null,
        channelId: null,
        usdcAmount: asString(args.usdcAmount),
        fiatAmountE6: asString(args.fiatAmountE6),
        selectedPriceE6: asString(args.selectedPriceE6),
        roundId: asString(args.roundId),
        createdAt: asString(args.createdAt),
        orderDeadline: asString(args.deadline),
        assignmentEpoch: "1",
        lastBlockNumber: asString(log.blockNumber),
        lastBlockTimestamp: asString(args.createdAt),
      });
      continue;
    }
    const order = orderId ? orders.get(orderId) : null;
    if (!order) continue;
    order.lastBlockNumber = asString(log.blockNumber);
    if (event.name === "OrderCandidatesAssigned") {
      order.status = "ASSIGNED";
      order.assignmentEpoch = asString(args.assignmentEpoch);
      order.assignmentDeadline = asString(args.assignmentDeadline);
      order.lastBlockTimestamp = asString(args.assignedAt);
      order.decisionDigest = args.decisionDigest;
    } else if (event.name === "OrderCandidateAssigned") {
      assignments.push({
        id: `${orderId}${Number(args.rank).toString(16).padStart(4, "0")}`,
        assignmentEpoch: asString(args.assignmentEpoch),
        rank: asString(args.rank),
        status: "ASSIGNED",
        decisionDigest: order.decisionDigest ?? `0x${"00".repeat(32)}`,
        assignmentDeadline: order.assignmentDeadline ?? "0",
        assignedAt: order.lastBlockTimestamp,
        terminalAt: null,
        merchant: args.merchant.toLowerCase(),
        channelId: args.channelId.toLowerCase(),
        orderId,
      });
    } else if (event.name === "OrderAccepted") {
      order.status = "ACCEPTED";
      order.merchant = args.merchant.toLowerCase();
      order.channelId = args.channelId.toLowerCase();
      order.acceptedAt = asString(args.acceptedAt);
      order.acceptedRecoveryDeadline = asString(args.recoveryDeadline);
      order.lastBlockTimestamp = asString(args.acceptedAt);
      for (const assignment of assignments.filter((item) => item.orderId === orderId)) {
        assignment.status = assignment.merchant === order.merchant ? "ACCEPTED" : "RELEASED";
        assignment.terminalAt = order.acceptedAt;
      }
    } else if (event.name === "FiatPaymentMarked") {
      order.status = "FIAT_SENT";
      order.fiatSentAt = asString(args.markedAt);
      order.lastBlockTimestamp = asString(args.markedAt);
    } else if (event.name === "OrderCompleted") {
      order.status = "COMPLETED";
      order.completedAt = asString(args.completedAt);
      order.lastBlockTimestamp = asString(args.completedAt);
    } else if (event.name === "OrderCancelled") {
      order.status = "CANCELLED";
      order.cancelledAt = asString(args.cancelledAt);
      order.lastBlockTimestamp = asString(args.cancelledAt);
    } else if (event.name === "OrderExpired") {
      order.status = "EXPIRED";
      order.expiredAt = asString(args.expiredAt);
      order.lastBlockTimestamp = asString(args.expiredAt);
    } else if (event.name === "DisputeRaised") {
      order.status = "DISPUTED";
      order.lastBlockTimestamp = asString(args.raisedAt);
      order.dispute = {
        id: orderId,
        status: "OPEN",
        resolution: null,
        priorOrderStatus: STATUS[Number(args.priorOrderStatus)],
        finalOrderStatus: null,
        openedBy: args.by.toLowerCase(),
        resolver: null,
        openedAt: asString(args.raisedAt),
        resolvedAt: null,
      };
    } else if (event.name === "DisputeResolved") {
      order.status = STATUS[Number(args.finalOrderStatus)];
      order.lastBlockTimestamp = asString(args.resolvedAt);
      order.dispute = {
        ...order.dispute,
        status: "RESOLVED",
        resolution: Number(args.resolution) === 0 ? "CANCEL_TRADE" : "SETTLE_TRADE",
        finalOrderStatus: order.status,
        resolver: args.resolver.toLowerCase(),
        resolvedAt: asString(args.resolvedAt),
      };
    }
  }
  return { assignments, orders: [...orders.values()].map(graphOrder) };
}

async function startGraphFixture(tls, provider, descriptor) {
  const server = https.createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
    if (request.method === "OPTIONS") return json(response, {}, 204);
    try {
      const body = await requestBody(request);
      const query = String(body.query ?? "");
      const variables = body.variables ?? {};
      const requestedBlock = typeof variables.block === "number"
        ? variables.block
        : typeof variables.block?.number === "number"
          ? variables.block.number
          : await provider.getBlockNumber();
      const block = await provider.getBlock(requestedBlock);
      if (!block?.hash) throw new Error("projection block unavailable");
      const projection = await projectChain(provider, descriptor, requestedBlock);
      const meta = { block: { number: String(requestedBlock), hash: block.hash }, hasIndexingErrors: false };
      const numericMeta = { block: { number: requestedBlock, hash: block.hash }, hasIndexingErrors: false };
      const orderById = (value) => projection.orders.find((order) => order.orderId === String(value).toLowerCase()) ?? null;
      const paginate = (items) => {
        const cursor = String(variables.cursor ?? "").toLowerCase();
        const limit = Number.isSafeInteger(variables.first) ? variables.first : items.length;
        return [...items]
          .sort((left, right) => left.id.toLowerCase().localeCompare(right.id.toLowerCase()))
          .filter((item) => item.id.toLowerCase() > cursor)
          .slice(0, limit);
      };
      let data;
      if (query.includes("OperatorPlatform")) {
        data = {
          platform: {
            id: "platform", chainId: "84532", diamond: descriptor.diamond.toLowerCase(),
            usdcToken: descriptor.usdc.toLowerCase(), initialized: true, paused: false,
            protocolVersion: "2", layoutVersion: "2", latestPriceRoundId: "1",
            totalMerchants: "1", totalChannels: "1", totalOrders: String(projection.orders.length),
            completedOrders: String(projection.orders.filter((order) => order.status === "COMPLETED").length),
            totalMerchantStakeUsdc: "100000000", totalMerchantLiquidityUsdc: "10000000000",
            totalReservedBuyUsdc: "0", totalSellEscrowUsdc: "0",
            lastBlockNumber: String(requestedBlock), lastBlockTimestamp: String(block.timestamp),
          },
          priceRounds: [{
            id: "0x01", roundId: "1", buyPriceE6: "95000000", sellPriceE6: "90000000",
            sourceObservedAt: String(block.timestamp), publishedAt: String(block.timestamp), sourceCount: "2",
            evidenceDigest: id("local-system-price"), publicationKind: "AUTOMATED",
            updater: descriptor.accounts.priceUpdater.toLowerCase(), blockNumber: String(requestedBlock),
          }],
          _meta: numericMeta,
        };
      } else if (query.includes("OperatorMerchants")) {
        data = { merchants: [{
          id: descriptor.accounts.merchant.toLowerCase(), wallet: descriptor.accounts.merchant.toLowerCase(),
          status: "ACTIVE", availability: "ONLINE", stakeUsdc: "100000000", liquidityUsdc: "10000000000",
          reservedUsdc: "0", disputeLockedUsdc: "0", reservedFiatE6: "0", availableUsdc: "10000000000",
          obligationCount: "0", registeredAt: "1", reviewedAt: "1", lastBlockNumber: String(requestedBlock),
        }], _meta: numericMeta };
      } else if (query.includes("OperatorChannels")) {
        data = { paymentChannels: [{
          id: descriptor.merchant.channelId.toLowerCase(), channelId: descriptor.merchant.channelId.toLowerCase(),
          status: "APPROVED", availability: "ACTIVE", sideMask: "3", fiatCapacityE6: "1000000000000",
          reservedFiatE6: "0", availableFiatE6: "1000000000000", obligationCount: "0",
          registeredAt: "1", reviewedAt: "1", lastBlockNumber: String(requestedBlock),
          merchant: { id: descriptor.accounts.merchant.toLowerCase(), wallet: descriptor.accounts.merchant.toLowerCase(), status: "ACTIVE" },
        }], _meta: numericMeta };
      } else if (query.includes("OperatorOrders")) {
        data = { orders: paginate(projection.orders), _meta: numericMeta };
      } else if (query.includes("OperatorDisputes")) {
        data = { disputes: paginate(projection.orders.filter((order) => order.dispute).map((order) => ({
          ...order.dispute,
          order: { id: order.id, orderId: order.orderId, orderNumber: order.orderNumber, orderType: order.orderType,
            status: order.status, user: order.user, merchant: order.merchant },
          lastBlockNumber: order.lastBlockNumber,
        }))), _meta: numericMeta };
      } else if (query.includes("ExecutorCandidates")) {
        data = { paymentChannels: [{
          id: descriptor.merchant.channelId.toLowerCase(), channelId: descriptor.merchant.channelId.toLowerCase(),
          status: "APPROVED", availability: "ACTIVE", sideMask: "3", fiatCapacityE6: "1000000000000",
          reservedFiatE6: "0", merchant: {
            id: descriptor.accounts.merchant.toLowerCase(), wallet: descriptor.accounts.merchant.toLowerCase(),
            status: "ACTIVE", availability: "ONLINE", liquidityUsdc: "10000000000", reservedUsdc: "0",
          },
        }] };
      } else if (query.includes("ExecutorCandidateMetrics")) {
        data = { merchantDailyMetrics: [], merchantMonthlyMetrics: [] };
      } else if (query.includes("ParticipantOrders")) {
        const address = String(variables.address ?? "").toLowerCase();
        data = {
          orders: paginate(projection.orders.filter((order) =>
            (order.user === address || order.merchant?.wallet === address) &&
            (!variables.status || order.status === variables.status))),
          _meta: meta,
        };
      } else if (query.includes("MerchantAssignments")) {
        const merchant = String(variables.merchant ?? "").toLowerCase();
        data = {
          assignments: paginate(projection.assignments.filter((item) =>
            item.merchant === merchant && (!variables.state || item.status === variables.state))).map((item) => ({
            ...item,
            merchant: undefined,
            order: orderById(item.orderId),
            channel: { channelId: item.channelId },
          })),
          _meta: meta,
        };
      } else if (query.includes("MerchantActivity")) {
        data = { merchantTransitions: [], _meta: meta };
      } else if (query.includes("MatchOrder")) {
        data = { order: orderById(variables.id) };
      } else if (query.includes("NotificationOrder")) {
        const order = orderById(variables.id);
        data = {
          order,
          assignments: projection.assignments.filter((item) => item.orderId === order?.orderId)
            .map((item) => ({ merchant: { wallet: item.merchant } })),
        };
      } else if (query.includes("MyOrders") || query.includes("MyActiveOrders") || query.includes("MyFinalOrders")) {
        const user = String(variables.user ?? "").toLowerCase();
        data = { orders: projection.orders.filter((order) => order.user === user) };
      } else if (query.includes("OrderById")) {
        data = { order: orderById(variables.id) };
      } else if (query.includes("PlatformSingleton")) {
        data = { platform: { id: "platform", usdcToken: descriptor.usdc, paused: false } };
      } else {
        data = { _meta: meta };
      }
      return json(response, { data });
    } catch (error) {
      return json(response, { errors: [{ message: error instanceof Error ? error.message : "fixture failure" }] }, 500);
    }
  });
  const port = await listen(server);
  return { server, url: `https://127.0.0.1:${String(port)}/graphql` };
}

async function startHttpsProxy(tls, target, { publicCors = false } = {}) {
  const destination = new URL(target);
  const server = https.createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS" && publicCors) {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-origin": origin ?? "*",
        vary: "origin",
      });
      return response.end();
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await new Promise((resolve, reject) => {
        const outgoing = http.request({
          hostname: destination.hostname,
          port: destination.port,
          method: request.method,
          path: request.url,
          headers: { ...request.headers, host: destination.host },
        }, resolve);
        outgoing.once("error", reject);
        if (chunks.length > 0) outgoing.write(Buffer.concat(chunks));
        outgoing.end();
      });
      const headers = { ...upstream.headers };
      delete headers.connection;
      delete headers["keep-alive"];
      delete headers["transfer-encoding"];
      if (publicCors) {
        headers["access-control-allow-origin"] = origin ?? "*";
        headers.vary = "origin";
      }
      response.writeHead(upstream.statusCode ?? 502, headers);
      upstream.pipe(response);
    } catch {
      json(response, { error: "local proxy unavailable" }, 502, publicCors ? (origin ?? "*") : "*");
    }
  });
  const port = await listen(server);
  return { server, url: `https://127.0.0.1:${String(port)}` };
}

async function startManagedFixtures(tls) {
  const audience = "p2pflow-phase7-local-system";
  const identity = https.createServer({ key: tls.key, cert: tls.cert }, (_request, response) => {
    json(response, { accessToken: jwt(audience) });
  });
  const identityPort = await listen(identity);
  const managedKey = Buffer.alloc(32, 0x53).toString("base64");
  const managed = https.createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
    try {
      if (request.method !== "POST" || !request.headers.authorization?.startsWith("Bearer ")) {
        return json(response, { error: "unauthorized" }, 401);
      }
      const body = await requestBody(request);
      if (body.operation === "attestCapabilities") {
        return json(response, {
          audience: body.audience,
          chainId: body.chainId,
          diamondAddress: body.diamondAddress,
          keyReferences: body.keyReferences,
          signers: body.signers,
          replayProtection: "bearer-jti+request-id+timestamp+body-sha256",
        });
      }
      if (body.operation === "deriveDataKey") {
        return json(response, { keyVersion: "phase7-local-v1", keyBase64: managedKey });
      }
      return json(response, { error: "unsupported operation" }, 400);
    } catch {
      return json(response, { error: "managed fixture failure" }, 500);
    }
  });
  const managedPort = await listen(managed);
  return {
    audience,
    identity,
    identityUrl: `https://127.0.0.1:${String(identityPort)}`,
    managed,
    managedUrl: `https://127.0.0.1:${String(managedPort)}`,
  };
}

async function buildProductionArtifacts() {
  await completedProcess(NODE_BINARY, [NPM_CLI, "run", "build", "--silent"], { cwd: EXECUTOR_ROOT });
  await Promise.all(Object.values(UI_ROOTS).map((root) =>
    completedProcess(NODE_BINARY, [NPM_CLI, "run", "build", "--silent"], { cwd: root })));
}

function safeStaticPath(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "https://local.invalid").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

async function startProductionUi(tls, root, runtimeDocument) {
  const dist = path.join(root, "dist");
  if (!existsSync(path.join(dist, "index.html"))) throw new Error(`production build missing for ${root}`);
  const server = https.createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
    if (request.url?.split("?", 1)[0] === "/p2pflow-runtime.json") {
      return json(response, runtimeDocument());
    }
    const candidate = safeStaticPath(dist, request.url ?? "/");
    const file = candidate && existsSync(candidate) ? candidate : path.join(dist, "index.html");
    const stat = await import("node:fs/promises").then(({ stat: readStat }) => readStat(file));
    const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, { "content-length": stat.size, "content-type": contentType });
    createReadStream(file).pipe(response);
  });
  const port = await listen(server);
  return { server, url: `https://127.0.0.1:${String(port)}` };
}

function executorEnvironment({
  allowedOrigins,
  databaseUrl,
  descriptor,
  directPort,
  graphUrl,
  managed,
  proxyUrl,
  rpcUrl,
  tls,
}) {
  const sessionHost = new URL(proxyUrl).host;
  return processEnvironment({
    NODE_ENV: "test",
    NODE_EXTRA_CA_CERTS: tls.certificatePath,
    EXECUTOR_PROFILE: "local",
    EXECUTOR_HOST: "127.0.0.1",
    EXECUTOR_PORT: String(directPort),
    EXECUTOR_DATABASE_URL: databaseUrl,
    EXECUTOR_DB_POOL_MAX: "10",
    EXECUTOR_MANIFEST_PATH: descriptor.manifestPath,
    EXECUTOR_CHAIN_SOURCE: "rpc",
    EXECUTOR_RPC_HTTP_URL: rpcUrl,
    EXECUTOR_GRAPH_ENDPOINT: graphUrl,
    EXECUTOR_GRAPH_MAX_LAG_BLOCKS: "25",
    EXECUTOR_CHAIN_CONFIRMATIONS: "12",
    EXECUTOR_CHAIN_REORG_OVERLAP_BLOCKS: "64",
    EXECUTOR_CHAIN_MAX_RANGE_BLOCKS: "500",
    EXECUTOR_PRICE_WRITE_MODE: "off",
    EXECUTOR_MATCH_WRITE_MODE: "off",
    EXECUTOR_RECOVERY_WRITE_MODE: "off",
    EXECUTOR_SESSION_DOMAIN: sessionHost,
    EXECUTOR_SESSION_URI: `${proxyUrl}/login`,
    EXECUTOR_ALLOWED_ORIGINS: allowedOrigins.join(","),
    EXECUTOR_SESSION_HASH_KEY_REF: "test-signer://phase7/session",
    EXECUTOR_PAYMENT_KEY_REF: "test-signer://phase7/payment",
    EXECUTOR_RAW_TX_KEY_REF: "test-signer://phase7/raw-transaction",
    EXECUTOR_CURSOR_KEY_REF: "test-signer://phase7/cursor",
    EXECUTOR_MANAGED_PROVIDER_ENDPOINT: managed.managedUrl,
    EXECUTOR_MANAGED_WORKLOAD_AUDIENCE: managed.audience,
    EXECUTOR_MANAGED_WORKLOAD_IDENTITY_ENDPOINT: managed.identityUrl,
    EXECUTOR_WORKER_POLL_MS: "25",
    EXECUTOR_SCANNER_INTERVAL_MS: "50",
    EXECUTOR_SHUTDOWN_TIMEOUT_MS: "5000",
  });
}

function startExecutor(environment) {
  return runningProcess(NODE_BINARY, ["dist/main.js"], { cwd: EXECUTOR_ROOT, env: environment });
}

async function waitExecutorReady(url, running) {
  const deadline = Date.now() + Number(process.env.P2PFLOW_SYSTEM_READY_TIMEOUT_MS ?? 30_000);
  let detail = "not attempted";
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) throw new Error(running.output().slice(-4_096));
    try {
      const response = await fetch(`${url}/health/ready`);
      if (response.status === 200) return response;
      detail = `${response.status} ${await response.text()}`;
      if (detail.includes("CHAIN_WRITES_DISABLED")) {
        throw new Error(`${detail}\n${running.output().slice(-8_192)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("CHAIN_WRITES_DISABLED")) throw error;
      detail = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`executor readiness deadline exceeded: ${detail}\n${running.output().slice(-4_096)}`);
}

async function mineConfirmations(provider, count = 12) {
  // Hardhat's bulk-mining shortcut intentionally omits fully valid metadata
  // for intermediate blocks. The production scanner verifies every parent
  // hash, so confirmations must be mined as real contiguous blocks here.
  for (let index = 0; index < count; index += 1) await provider.send("evm_mine", []);
}

async function refreshBrowserPriceRound(provider, descriptor) {
  const pricing = new Contract(
    descriptor.diamond,
    DIAMOND_ABI,
    await provider.getSigner(descriptor.accounts.priceUpdater),
  );
  const latest = await pricing.getLatestPriceRound();
  const roundId = latest.roundId + 1n;
  await (await pricing.publishPriceRound(
    roundId,
    latest.buyPriceE6,
    latest.sellPriceE6,
    BigInt(Math.floor(Date.now() / 1_000)),
    2,
    id(`phase7-browser-price-${String(roundId)}`),
    0,
  )).wait();
  await mineConfirmations(provider, 12);
}

async function waitExecutableQuote(executorUrl, running) {
  return waitFor(async () => {
    const response = await fetch(`${executorUrl}/v1/prices/quote?side=BUY&usdcAmount=1000000`);
    if (response.status !== 200) throw new Error(`quote status ${String(response.status)}`);
    const body = await response.json();
    if (body?.executable !== true) throw new Error("quote is not executable");
    return body;
  }, `fresh browser quote did not become executable${running === undefined ? "" : ` executor=${running.output().slice(-4_096)}`}`, 30_000);
}

function receiptOrderId(receipt, diamondAddress) {
  const contractInterface = new Interface(DIAMOND_ABI);
  const created = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== diamondAddress.toLowerCase()) return [];
    try {
      const event = contractInterface.parseLog(log);
      return event?.name === "OrderCreated" ? [event] : [];
    } catch { return []; }
  });
  assert.equal(created.length, 1, "receipt must contain exactly one Diamond OrderCreated event");
  return created[0].args.orderId.toLowerCase();
}

async function driveLifecycle(provider, descriptor) {
  const account = async (name) => provider.getSigner(descriptor.accounts[name]);
  const user = await account("user");
  const merchantSigner = await account("merchant");
  const assigner = await account("orderAssigner");
  const resolver = await account("disputeResolver");
  const orders = new Contract(descriptor.diamond, DIAMOND_ABI, user);
  const merchantOrders = orders.connect(merchantSigner);
  const assignment = orders.connect(assigner);
  const disputes = orders.connect(resolver);
  const usdc = new Contract(descriptor.usdc, USDC_ABI, user);
  const transactions = [];

  const create = async (side, amount) => {
    const round = await orders.getLatestPriceRound();
    const block = await provider.getBlock("latest");
    const validUntil = BigInt(block.timestamp + 120);
    if (side === "SELL") await (await usdc.approve(descriptor.diamond, amount)).wait();
    const transaction = side === "BUY"
      ? await orders.createBuyOrder(amount, round.roundId, round.buyPriceE6, validUntil)
      : await orders.createSellOrder(amount, round.roundId, round.sellPriceE6, validUntil);
    const transactionHash = transaction.hash.toLowerCase();
    const receipt = await transaction.wait();
    assert.equal(receipt.hash.toLowerCase(), transactionHash, "transaction response and receipt hash must agree");
    const orderId = receiptOrderId(receipt, descriptor.diamond);
    transactions.push({ hash: transactionHash, blockNumber: receipt.blockNumber, orderId, side });
    return { orderId, receipt, transactionHash };
  };
  const assign = async (orderId, label) => {
    const order = await orders.getOrder(orderId);
    await (await assignment.assignOrderCandidates(orderId, order.assignmentEpoch, [{
      merchant: descriptor.accounts.merchant,
      channelId: descriptor.merchant.channelId,
    }], id(`${label}-${orderId}`))).wait();
  };
  const accept = async (orderId) => {
    await (await merchantOrders.acceptOrder(orderId, descriptor.merchant.channelId)).wait();
  };

  const buy = await create("BUY", 5n * E6);
  await assign(buy.orderId, "buy");
  await accept(buy.orderId);
  await (await orders.markFiatSent(buy.orderId)).wait();
  await (await merchantOrders.confirmFiatReceived(buy.orderId)).wait();
  assert.equal(Number((await orders.getOrder(buy.orderId)).status), 4);

  const sell = await create("SELL", 4n * E6);
  await assign(sell.orderId, "sell");
  await accept(sell.orderId);
  await (await merchantOrders.markFiatSent(sell.orderId)).wait();
  await (await orders.confirmFiatReceived(sell.orderId)).wait();
  assert.equal(Number((await orders.getOrder(sell.orderId)).status), 4);

  const cancelled = await create("BUY", E6);
  await (await orders.cancelOrder(cancelled.orderId)).wait();
  assert.equal(Number((await orders.getOrder(cancelled.orderId)).status), 5);

  const disputed = await create("BUY", 2n * E6);
  await assign(disputed.orderId, "dispute");
  await accept(disputed.orderId);
  await (await orders.openDispute(disputed.orderId)).wait();
  await (await disputes.resolveDispute(disputed.orderId, 0)).wait();
  assert.equal(Number((await orders.getOrder(disputed.orderId)).status), 5);

  const recovered = await create("BUY", 3n * E6);
  await assign(recovered.orderId, "recovery");
  await accept(recovered.orderId);
  const accepted = await orders.getOrder(recovered.orderId);
  await provider.send("evm_setNextBlockTimestamp", [Number(accepted.acceptedRecoveryDeadline)]);
  await provider.send("evm_mine", []);
  await (await assignment.recoverExpiredOrder(recovered.orderId)).wait();
  assert.equal(Number((await orders.getOrder(recovered.orderId)).status), 6);

  return {
    outcomes: {
      buy: "COMPLETED",
      sell: "COMPLETED",
      cancelled: "CANCELLED",
      disputed: "CANCELLED",
      recovered: "EXPIRED",
    },
    orderIds: {
      buy: buy.orderId,
      sell: sell.orderId,
      cancelled: cancelled.orderId,
      disputed: disputed.orderId,
      recovered: recovered.orderId,
    },
    transactions,
    create,
  };
}

function createBarrier() {
  const barrier = Promise.withResolvers();
  barrier.promise.catch(() => undefined);
  return barrier;
}

function waitForBarrier(barrier, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} coordination deadline exceeded`)), timeoutMs);
    timer.unref?.();
    barrier.promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function shortOrderId(orderId) {
  return `${orderId.slice(0, 8)}…${orderId.slice(-6)}`;
}

function actionLocator(page, selector) {
  return page.getByRole(selector.role, { name: selector.name, exact: true }).first();
}

function createBrowserActionCoordinator(provider, descriptor) {
  const assignedBuy = createBarrier();
  const acceptedBuy = createBarrier();

  return async ({ applicationId, kind, page, selectors, timeoutMs, browserActionState }) => {
    if (kind === "user") {
      try {
        assert.ok(browserActionState?.buyOrderId, "browser BUY receipt-derived order ID is required");
        const orders = new Contract(
          descriptor.diamond,
          DIAMOND_ABI,
          await provider.getSigner(descriptor.accounts.orderAssigner),
        );
        const order = await orders.getOrder(browserActionState.buyOrderId);
        assert.equal(Number(order.status), 0, "browser BUY must still be CREATED before coordinated assignment");
        await (await orders.assignOrderCandidates(
          browserActionState.buyOrderId,
          order.assignmentEpoch,
          [{ merchant: descriptor.accounts.merchant, channelId: descriptor.merchant.channelId }],
          id("phase7-browser-buy-assignment"),
        )).wait();
        await mineConfirmations(provider, 12);
        assignedBuy.resolve(Object.freeze({ buyOrderId: browserActionState.buyOrderId }));
        return [{ action: "assign-browser-buy", initiatedBy: "orchestrator", receiptConfirmed: true }];
      } catch (error) {
        assignedBuy.reject(error);
        acceptedBuy.reject(error);
        throw error;
      }
    }

    if (applicationId === "merchant") {
      try {
        const { buyOrderId } = await waitForBarrier(assignedBuy, "merchant assignment", timeoutMs);
        await page.goto(new URL("/assignments", page.url()).href, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        const exactOrder = page.getByText(shortOrderId(buyOrderId), { exact: true }).first();
        const refresh = page.getByRole("button", { name: "Refresh inbox", exact: true }).first();
        await waitFor(async () => {
          if (await exactOrder.isVisible()) return true;
          if (await refresh.isVisible() && await refresh.isEnabled()) await refresh.click({ timeout: timeoutMs });
          return false;
        }, "browser merchant assignment did not appear after bounded projection refresh", timeoutMs);
        await exactOrder.click({ timeout: timeoutMs });
        const accept = actionLocator(page, selectors.assignment);
        await waitFor(
          async () => await accept.isVisible() && await accept.isEnabled(),
          "merchant accept action did not become available",
          timeoutMs,
        );
        await accept.click({ timeout: timeoutMs });
        const orders = new Contract(descriptor.diamond, DIAMOND_ABI, provider);
        await waitFor(
          async () => Number((await orders.getOrder(buyOrderId)).status) === 2,
          "browser merchant acceptance was not receipt-confirmed",
          timeoutMs,
        );
        acceptedBuy.resolve(Object.freeze({ buyOrderId }));
        return [{ action: "accept-browser-buy", initiatedBy: "browser", receiptConfirmed: true }];
      } catch (error) {
        acceptedBuy.reject(error);
        throw error;
      }
    }

    if (applicationId === "admin-dispute-resolver") {
      const { buyOrderId } = await waitForBarrier(acceptedBuy, "admin dispute", timeoutMs);
      const userOrders = new Contract(
        descriptor.diamond,
        DIAMOND_ABI,
        await provider.getSigner(descriptor.accounts.user),
      );
      await (await userOrders.openDispute(buyOrderId)).wait();
      await mineConfirmations(provider, 12);
      assert.equal(Number((await userOrders.getOrder(buyOrderId)).status), 7);

      await page.goto(new URL("/orders", page.url()).href, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      const cancel = actionLocator(page, selectors.cancelDispute);
      await waitFor(
        async () => await cancel.isVisible() && await cancel.isEnabled(),
        "admin dispute resolution did not become available",
        timeoutMs,
      );
      await cancel.click({ timeout: timeoutMs });
      await waitFor(
        async () => Number((await userOrders.getOrder(buyOrderId)).status) === 5,
        "browser admin dispute cancellation was not receipt-confirmed",
        timeoutMs,
      );
      return [
        { action: "open-browser-buy-dispute", initiatedBy: "orchestrator", receiptConfirmed: true },
        { action: "cancel-browser-buy-dispute", initiatedBy: "browser", receiptConfirmed: true },
      ];
    }

    return [];
  };
}

async function waitForCanonicalTransaction(
  database,
  transactionHash,
  canonical = true,
  context = {},
  running,
  timeoutMs = 30_000,
) {
  return waitFor(async () => {
    const result = await database.query(
      "SELECT event_id, canonical FROM chain_events WHERE transaction_hash = $1 ORDER BY log_index",
      [transactionHash],
    );
    if (result.rows.length > 0 && result.rows.every((row) => row.canonical === canonical)) return result.rows;
    const cursor = await database.query(
      "SELECT block_number::text, writes_disabled, halt_reason, updated_at::text FROM chain_cursors WHERE stream = 'diamond-v2'",
    );
    const created = await database.query(
      "SELECT block_number::text, transaction_hash FROM chain_events WHERE event_name = 'OrderCreated' ORDER BY chain_events.block_number",
    );
    if (cursor.rows[0]?.writes_disabled === true) throw new Error("CHAIN_WRITES_DISABLED");
    throw new Error(
      `context=${JSON.stringify(context)} cursor=${JSON.stringify(cursor.rows[0] ?? null)} observed=${JSON.stringify(result.rows)} created=${JSON.stringify(created.rows)}` +
      (running === undefined ? "" : ` executor=${running.output().slice(-8_192)}`),
    );
  }, `canonical transaction ${transactionHash} did not converge to ${String(canonical)}`, timeoutMs);
}

async function assertScannerScenarios({ database, descriptor, environment, executor, provider, proxyUrl, lifecycle }) {
  await mineConfirmations(provider, 12);
  for (const transaction of lifecycle.transactions) {
    await waitForCanonicalTransaction(database, transaction.hash, true, transaction);
  }
  const beforeReplay = await database.query("SELECT COUNT(*)::integer AS count FROM chain_events");
  await delay(250);
  const afterReplay = await database.query("SELECT COUNT(*)::integer AS count FROM chain_events");
  assert.equal(afterReplay.rows[0].count, beforeReplay.rows[0].count, "overlap replay must not duplicate events");

  await stopProcess(executor);
  const missed = await lifecycle.create("BUY", 7n * E6);
  await mineConfirmations(provider, 12);
  let active = startExecutor(environment);
  let handedOff = false;
  try {
    try {
      await waitExecutorReady(proxyUrl, active);
    } catch (error) {
      const cursor = await database.query(
        "SELECT block_number::text, writes_disabled, halt_reason, updated_at::text FROM chain_cursors WHERE stream = 'diamond-v2'",
      );
      throw new Error(`restart cursor=${JSON.stringify(cursor.rows[0] ?? null)} ${error instanceof Error ? error.message : String(error)}`);
    }
    await waitForCanonicalTransaction(database, missed.transactionHash, true, { stage: "missed" }, active);

    const snapshot = await provider.send("evm_snapshot", []);
    const orphaned = await lifecycle.create("BUY", 8n * E6);
    await mineConfirmations(provider, 12);
    await waitForCanonicalTransaction(database, orphaned.transactionHash, true, { stage: "orphan-before-revert" }, active);
    await stopProcess(active);
    active = undefined;
    assert.equal(await provider.send("evm_revert", [snapshot]), true);
    const replacement = await lifecycle.create("BUY", 9n * E6);
    await mineConfirmations(provider, 13);
    active = startExecutor(environment);
    try {
      await waitExecutorReady(proxyUrl, active);
    } catch (error) {
      const cursor = await database.query(
        "SELECT block_number::text, writes_disabled, halt_reason, updated_at::text FROM chain_cursors WHERE stream = 'diamond-v2'",
      );
      throw new Error(`reorg restart cursor=${JSON.stringify(cursor.rows[0] ?? null)} ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await waitForCanonicalTransaction(
        database,
        replacement.transactionHash,
        true,
        { stage: "replacement" },
        active,
        60_000,
      );
    } catch {
      const head = await provider.getBlockNumber();
      const confirmedHead = head - 12;
      const cursor = await database.query(
        "SELECT block_number::integer, block_hash, writes_disabled, halt_reason FROM chain_cursors WHERE stream = 'diamond-v2'",
      );
      const cursorRow = cursor.rows[0] ?? null;
      const canonicalCursorBlock = cursorRow === null ? null : await provider.getBlock(cursorRow.block_number);
      const events = await database.query(
        `SELECT canonical,
                lower(transaction_hash) = lower($2) AS is_replacement,
                lower(transaction_hash) = lower($3) AS is_orphan
         FROM chain_events WHERE block_number = $1 AND event_name = 'OrderCreated'
         ORDER BY event_id`,
        [replacement.receipt.blockNumber, replacement.transactionHash, orphaned.transactionHash],
      );
      const jobs = await database.query(
        `SELECT job_type, state, last_error_class,
                lower(event.transaction_hash) = lower($2) AS replacement_source,
                lower(event.transaction_hash) = lower($3) AS orphan_source,
                event.canonical
         FROM jobs JOIN chain_events event ON event.event_id = jobs.source_event_id
         WHERE event.block_number = $1 ORDER BY job_type, state`,
        [replacement.receipt.blockNumber, replacement.transactionHash, orphaned.transactionHash],
      );
      const activity = await database.query(
        `SELECT state, wait_event_type, wait_event, COUNT(*)::integer AS count
         FROM pg_stat_activity WHERE datname = current_database()
         GROUP BY state, wait_event_type, wait_event ORDER BY state, wait_event_type, wait_event`,
      );
      const health = await fetch(`${proxyUrl}/health/ready`).catch(() => null);
      throw new Error(`replacement canonical convergence failed diagnostics=${JSON.stringify({
        head,
        confirmedHead,
        replacementBlock: replacement.receipt.blockNumber,
        sameLogicalOrder: replacement.orderId === orphaned.orderId,
        cursor: cursorRow === null ? null : {
          blockNumber: cursorRow.block_number,
          writesDisabled: cursorRow.writes_disabled,
          haltReasonCode: cursorRow.halt_reason?.code ?? null,
          hashMatchesRpc: canonicalCursorBlock?.hash?.toLowerCase() === cursorRow.block_hash.toLowerCase(),
        },
        events: events.rows,
        jobs: jobs.rows,
        databaseActivity: activity.rows,
        readinessStatus: health?.status ?? null,
        processExited: active.child.exitCode !== null || active.child.signalCode !== null,
      })}`);
    }
    await waitForCanonicalTransaction(database, orphaned.transactionHash, false, { stage: "orphan-after-revert" }, active);
    const logical = await database.query(
      `SELECT transaction_hash, canonical FROM chain_events
       WHERE transaction_hash = ANY($1::text[]) AND event_name = 'OrderCreated'
       ORDER BY transaction_hash`,
      [[orphaned.transactionHash, replacement.transactionHash]],
    );
    assert.deepEqual(logical.rows.map((row) => row.canonical).sort(), [false, true]);
    assert.equal(descriptor.chainId, 84_532);
    handedOff = true;
    return { executor: active, missed: true, orphaned: true, replacement: true };
  } finally {
    if (!handedOff) await stopProcess(active).catch(() => undefined);
  }
}

async function runDurableUncertaintyAndReorgEvidence(databaseUrl) {
  const pattern = "real PostgreSQL (commits prepared bytes before broadcast|canonical scanner survives restart)";
  return completedProcess(NODE_BINARY, [
    "--test",
    `--test-name-pattern=${pattern}`,
    "test/postgres_phase5.test.mjs",
  ], {
    cwd: EXECUTOR_ROOT,
    env: processEnvironment({
      EXECUTOR_TEST_DATABASE_URL: databaseUrl,
      REQUIRE_POSTGRES_TESTS: "1",
    }),
  });
}

async function main() {
  if (!existsSync(NODE_BINARY) || !existsSync(HARDHAT_CLI)) {
    throw new Error("Phase 7 requires Node 24 under /tmp/p2pflow-node and installed Hardhat dependencies");
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "p2pflow-phase7-system."));
  const servers = [];
  let database;
  let executor;
  let hardhat;
  let postgres;
  const browserFocus = process.env.P2PFLOW_SYSTEM_BROWSER_FOCUS === "1";
  try {
    if (process.env.P2PFLOW_SYSTEM_SKIP_BUILD !== "1") await buildProductionArtifacts();
    postgres = await startPostgres(temporaryDirectory);
    const tls = await createTls(temporaryDirectory);
    hardhat = await startHardhat(temporaryDirectory);
    await mineConfirmations(hardhat.provider, 12);

    const graph = await startGraphFixture(tls, hardhat.provider, hardhat.descriptor);
    servers.push(graph.server);
    const managed = await startManagedFixtures(tls);
    servers.push(managed.identity, managed.managed);
    const rpcProxy = await startHttpsProxy(tls, hardhat.rpcUrl, { publicCors: true });
    servers.push(rpcProxy.server);

    const directPort = await freePort();
    const directExecutorUrl = `http://127.0.0.1:${String(directPort)}`;
    const executorProxy = await startHttpsProxy(tls, directExecutorUrl);
    servers.push(executorProxy.server);

    let runtimeDocument = null;
    const runtime = () => {
      if (runtimeDocument === null) throw new Error("runtime document not initialized");
      return runtimeDocument;
    };
    const applications = {};
    for (const [name, root] of Object.entries(UI_ROOTS)) {
      applications[name] = await startProductionUi(tls, root, runtime);
      servers.push(applications[name].server);
    }
    runtimeDocument = Object.freeze({
      executorApiUrl: executorProxy.url,
      manifest: JSON.parse(await readFile(hardhat.descriptor.manifestPath, "utf8")),
      rpcUrl: rpcProxy.url,
      subgraphUrl: graph.url,
      thirdwebClientId: TEST_CLIENT_ID,
    });

    const environment = executorEnvironment({
      allowedOrigins: Object.values(applications).map(({ url }) => url),
      databaseUrl: postgres.databaseUrl,
      descriptor: hardhat.descriptor,
      directPort,
      graphUrl: graph.url,
      managed,
      proxyUrl: executorProxy.url,
      rpcUrl: hardhat.rpcUrl,
      tls,
    });
    executor = startExecutor(environment);
    database = createDatabase({ databaseUrl: postgres.databaseUrl, dbPoolMax: 10 });
    try {
      await waitExecutorReady(directExecutorUrl, executor);
    } catch (error) {
      const cursors = await database.query(
        "SELECT stream, block_number::text, block_hash, writes_disabled, halt_reason FROM chain_cursors ORDER BY stream",
      ).catch(() => ({ rows: [] }));
      const blocks = await database.query(
        "SELECT block_number::text, block_hash, parent_hash, block_timestamp::text, canonical FROM chain_blocks ORDER BY block_number",
      ).catch(() => ({ rows: [] }));
      const jobs = await database.query(
        "SELECT job_type, state, last_error_class, COUNT(*)::integer AS count FROM jobs GROUP BY job_type, state, last_error_class ORDER BY job_type, state",
      ).catch(() => ({ rows: [] }));
      throw new Error(
        `CURSORS=${JSON.stringify(cursors.rows)}\nBLOCKS=${JSON.stringify(blocks.rows)}\nJOBS=${JSON.stringify(jobs.rows)}\n${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const lifecycle = browserFocus ? null : await driveLifecycle(hardhat.provider, hardhat.descriptor);
    let scanner = null;
    if (!browserFocus) {
      try {
        scanner = await assertScannerScenarios({
          database,
          descriptor: hardhat.descriptor,
          environment,
          executor,
          provider: hardhat.provider,
          proxyUrl: directExecutorUrl,
          lifecycle,
        });
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${executor.output().slice(-8_192)}`);
      }
      executor = scanner.executor;
    }

    await refreshBrowserPriceRound(hardhat.provider, hardhat.descriptor);
    await waitExecutableQuote(directExecutorUrl, executor);

    const { runProductionBrowserJourneys } = await import("./browser-production.mjs");
    let browserEvidence;
    let browserPrivatePayout = null;
    try {
      browserEvidence = await runProductionBrowserJourneys({
        accounts: hardhat.descriptor.accounts,
        coordinatedActionDriver: createBrowserActionCoordinator(hardhat.provider, hardhat.descriptor),
        descriptor: hardhat.descriptor,
        executorUrl: executorProxy.url,
        onPrivatePayout: (value) => {
          if (browserPrivatePayout !== null || typeof value !== "string" || value.length < 8 || value.length > 100) {
            throw new Error("BROWSER_PRIVATE_PAYOUT_OBSERVER_INVALID");
          }
          browserPrivatePayout = value;
        },
        rpcUrl: rpcProxy.url,
        timeoutMs: browserFocus ? 120_000 : 30_000,
        urls: Object.fromEntries(Object.entries(applications).map(([name, value]) => [name, value.url])),
      });
    } catch (error) {
      const orderCreatedTopic = new Interface(DIAMOND_ABI).getEvent("OrderCreated").topicHash;
      const [head, chainCreatedLogs, cursor, created, references, jobs] = await Promise.all([
        hardhat.provider.getBlockNumber(),
        hardhat.provider.getLogs({
          address: hardhat.descriptor.diamond,
          fromBlock: hardhat.descriptor.deploymentBlock,
          toBlock: "latest",
          topics: [orderCreatedTopic],
        }),
        database.query(
          "SELECT block_number::text, writes_disabled, halt_reason FROM chain_cursors WHERE stream = 'diamond-v2'",
        ),
        database.query(
          `SELECT block_number::text, canonical FROM chain_events
           WHERE event_name = 'OrderCreated' ORDER BY chain_events.block_number DESC LIMIT 12`,
        ),
        database.query(
          "SELECT state, target_type, COUNT(*)::integer AS count FROM payment_references GROUP BY state, target_type ORDER BY state, target_type",
        ),
        database.query(
          "SELECT job_type, state, last_error_class, COUNT(*)::integer AS count FROM jobs GROUP BY job_type, state, last_error_class ORDER BY job_type, state",
        ),
      ]);
      const browserFailures = Array.isArray(error?.evidence?.applications)
        ? error.evidence.applications.map((application) => ({
            application: application.application,
            status: application.status,
            failure: application.failure ?? null,
          }))
        : [];
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} diagnostics=${JSON.stringify({
          head,
          chainCreatedBlocks: chainCreatedLogs.map((log) => log.blockNumber),
          cursor: cursor.rows[0] ?? null,
          created: created.rows,
          references: references.rows,
          jobs: jobs.rows,
          browserFailures,
        })}`,
        { cause: error },
      );
    }

    if (browserFocus) {
      process.stdout.write(`${JSON.stringify({
        phase: 7,
        mode: "browser-focus",
        browser: browserEvidence,
      })}\n`);
      return;
    }

    const executorOutput = executor.output();
    assert.match(executorOutput, /"event":"http_request_completed"/u, "executor must emit structured HTTP audit evidence");
    assert.doesNotMatch(
      executorOutput,
      /__Host-p2pflow_session|x-csrf-token|csrfToken|authorization|private-payment|seed phrase/ui,
      "audit output must not contain session, signature, or payment material",
    );
    if (browserPrivatePayout === null) throw new Error("BROWSER_PRIVATE_PAYOUT_NOT_OBSERVED");
    if (executorOutput.includes(browserPrivatePayout)) throw new Error("BROWSER_PRIVATE_PAYOUT_LEAKED_IN_EXECUTOR_LOG");
    if (JSON.stringify(browserEvidence).includes(browserPrivatePayout)) {
      throw new Error("BROWSER_PRIVATE_PAYOUT_LEAKED_IN_EVIDENCE");
    }
    browserPrivatePayout = null;
    const chainEvidence = await database.query(
      `SELECT COUNT(*)::integer AS events,
              COUNT(*) FILTER (WHERE canonical)::integer AS canonical,
              COUNT(*) FILTER (WHERE NOT canonical)::integer AS orphaned
       FROM chain_events`,
    );
    assert.ok(chainEvidence.rows[0].events > 0);
    assert.ok(chainEvidence.rows[0].canonical > 0);
    assert.ok(chainEvidence.rows[0].orphaned > 0);

    await stopProcess(executor);
    executor = undefined;
    await database.close();
    database = undefined;
    const durableOutput = await runDurableUncertaintyAndReorgEvidence(postgres.databaseUrl);
    assert.match(durableOutput, /pass [2-9]|pass \d{2,}/u);

    process.stdout.write(`${JSON.stringify({
      phase: 7,
      system: "local-production-shaped",
      chainId: hardhat.descriptor.chainId,
      diamond: hardhat.descriptor.diamond,
      officialUsdc: hardhat.descriptor.usdc,
      oneExecutorAtATime: true,
      productionBuilds: Object.fromEntries(Object.entries(applications).map(([name, value]) => [name, value.url])),
      lifecycle: lifecycle.outcomes,
      scanner: { missed: scanner.missed, orphaned: scanner.orphaned, replacement: scanner.replacement },
      browser: browserEvidence,
      chainEvidence: chainEvidence.rows[0],
      durableUncertaintyAndReorg: true,
    })}\n`);
  } finally {
    if (database) await database.close().catch(() => undefined);
    await stopProcess(executor).catch(() => undefined);
    await Promise.all(servers.reverse().map((server) => closeServer(server).catch(() => undefined)));
    await stopProcess(hardhat?.running).catch(() => undefined);
    if (postgres) await postgres.stop().catch(() => undefined);
    if (temporaryDirectory.startsWith(`${os.tmpdir()}${path.sep}p2pflow-phase7-system.`)) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
