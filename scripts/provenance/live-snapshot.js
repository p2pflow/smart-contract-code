#!/usr/bin/env node
"use strict";

const {
  confirmPinnedBlock,
  readPublicState,
  verifyLiveBaseline,
} = require("./live");
const { controlledFailure, outputJson, parseArgs } = require("./utils");

function usage() {
  return [
    "Usage: node scripts/provenance/live-snapshot.js [--block NUMBER] [--diamond ADDRESS] [--out FILE]",
    "",
    "Reads Base Sepolia only. BASE_SEPOLIA_RPC_URL is used when set; otherwise",
    "the sole fallback is https://sepolia.base.org. The selected block is pinned",
    "before all code, loupe, and state reads. RPC URLs and payment strings are never output.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["help"],
    value: ["block", "diamond", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const verified = await verifyLiveBaseline({
    block: args.block,
    diamond: args.diamond,
  });
  const state = await readPublicState(verified);
  await confirmPinnedBlock(verified);
  outputJson(
    {
      baseline: "aa6f802",
      block: {
        hash: verified.block.hash,
        number: verified.block.number,
        timestamp: verified.block.timestamp,
      },
      chainId: verified.chainId,
      code: verified.code,
      diamond: verified.diamond,
      facets: verified.facets,
      kind: "p2pflow-live-provenance-snapshot",
      ok: true,
      rpcSource: verified.rpcSource,
      sanitized: true,
      schemaVersion: 1,
      state,
    },
    args.out
  );
}

main().catch(controlledFailure);
