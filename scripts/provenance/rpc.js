"use strict";

const { OFFICIAL_RPC_URL } = require("./constants");
const {
  ProvenanceError,
  bigintToHex,
  invariant,
  parseBlockArgument,
} = require("./utils");

const READ_ONLY_RPC_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
]);

function resolveRpcConfig() {
  const configured = process.env.BASE_SEPOLIA_RPC_URL;
  const endpoint = configured || OFFICIAL_RPC_URL;

  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ProvenanceError(
      "BAD_RPC_CONFIGURATION",
      "Base Sepolia RPC URL is invalid"
    );
  }
  invariant(
    parsed.protocol === "https:" || parsed.protocol === "http:",
    "BAD_RPC_CONFIGURATION",
    "Base Sepolia RPC URL must use HTTP or HTTPS"
  );

  return {
    endpoint,
    source: configured ? "BASE_SEPOLIA_RPC_URL" : "official-fallback",
  };
}

class RpcClient {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.timeoutMs = options.timeoutMs || 20_000;
    this.nextId = 1;
  }

  async request(method, params = []) {
    invariant(
      READ_ONLY_RPC_METHODS.has(method),
      "RPC_METHOD_FORBIDDEN",
      `RPC method ${String(
        method
      )} is not allowed by read-only provenance tooling`
    );

    const id = this.nextId;
    this.nextId += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(this.endpoint, {
        body: JSON.stringify({ id, jsonrpc: "2.0", method, params }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
    } catch {
      throw new ProvenanceError(
        "RPC_TRANSPORT_FAILED",
        `RPC request ${method} failed`
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ProvenanceError(
        "RPC_HTTP_FAILED",
        `RPC request ${method} returned HTTP ${response.status}`
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ProvenanceError(
        "RPC_RESPONSE_INVALID",
        `RPC request ${method} returned invalid JSON`
      );
    }

    if (!payload || payload.id !== id || payload.jsonrpc !== "2.0") {
      throw new ProvenanceError(
        "RPC_RESPONSE_INVALID",
        `RPC request ${method} returned a bad envelope`
      );
    }
    if (payload.error) {
      const rpcCode =
        typeof payload.error.code === "number"
          ? ` (${payload.error.code})`
          : "";
      throw new ProvenanceError(
        "RPC_ERROR",
        `RPC request ${method} failed${rpcCode}`
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, "result")) {
      throw new ProvenanceError(
        "RPC_RESPONSE_INVALID",
        `RPC request ${method} omitted its result`
      );
    }
    return payload.result;
  }
}

async function pinBlock(rpc, requestedBlock) {
  let blockTag = parseBlockArgument(requestedBlock);
  if (blockTag === "latest") {
    const latest = await rpc.request("eth_blockNumber");
    invariant(
      typeof latest === "string" && /^0x[0-9a-fA-F]+$/.test(latest),
      "BAD_BLOCK_RESPONSE",
      "RPC returned an invalid latest block number"
    );
    blockTag = bigintToHex(BigInt(latest));
  }

  const block = await rpc.request("eth_getBlockByNumber", [blockTag, false]);
  invariant(
    block && block.number && block.hash,
    "BLOCK_NOT_FOUND",
    "Pinned block was not found"
  );
  invariant(
    BigInt(block.number) === BigInt(blockTag),
    "BLOCK_MISMATCH",
    "RPC returned a different block than requested"
  );
  invariant(
    typeof block.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(block.hash),
    "BAD_BLOCK_RESPONSE",
    "Pinned block hash is invalid"
  );

  return {
    hash: block.hash.toLowerCase(),
    number: BigInt(block.number),
    tag: bigintToHex(BigInt(block.number)),
    timestamp: BigInt(block.timestamp),
  };
}

async function mapConcurrent(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, () =>
      consume()
    )
  );
  return output;
}

module.exports = {
  READ_ONLY_RPC_METHODS,
  RpcClient,
  mapConcurrent,
  pinBlock,
  resolveRpcConfig,
};
