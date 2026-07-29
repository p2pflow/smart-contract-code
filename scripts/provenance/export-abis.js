#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildBaselineManifest } = require("./artifacts");
const {
  controlledFailure,
  invariant,
  outputJson,
  parseArgs,
  stableStringify,
} = require("./utils");

function usage() {
  return [
    "Usage: node scripts/provenance/export-abis.js [--out-dir DIR] [--out FILE]",
    "",
    "Strictly verifies exact-aa6 local runtime hashes, then prints a deterministic",
    "ABI bundle. --out-dir additionally writes one <Contract>.abi.json per baseline",
    "contract plus manifest.json. No directory is written unless explicitly supplied.",
  ].join("\n");
}

function abiBundle() {
  const baseline = buildBaselineManifest();
  return {
    baseline: baseline.baseline,
    contracts: baseline.contracts.map((contract) => ({
      abi: contract.abi,
      abiHash: contract.abiHash,
      contractName: contract.contractName,
      runtimeHash: contract.bytecode.runtimeHash,
      sourceName: contract.sourceName,
    })),
    kind: "p2pflow-aa6-abi-artifacts",
    ok: true,
    schemaVersion: 1,
  };
}

function writeBundle(bundle, outputDirectory) {
  const directory = path.resolve(process.cwd(), outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const manifestContracts = [];
  const writtenFiles = [];

  for (const contract of bundle.contracts) {
    invariant(
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(contract.contractName),
      "BAD_CONTRACT_NAME",
      "Contract name cannot be used as an ABI filename"
    );
    const filename = `${contract.contractName}.abi.json`;
    fs.writeFileSync(
      path.join(directory, filename),
      stableStringify(contract.abi),
      {
        encoding: "utf8",
        mode: 0o600,
      }
    );
    manifestContracts.push({
      abiHash: contract.abiHash,
      contractName: contract.contractName,
      file: filename,
      runtimeHash: contract.runtimeHash,
      sourceName: contract.sourceName,
    });
    writtenFiles.push(filename);
  }

  const manifest = {
    baseline: bundle.baseline,
    contracts: manifestContracts,
    kind: "p2pflow-aa6-abi-export-manifest",
    schemaVersion: 1,
  };
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    stableStringify(manifest),
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
  writtenFiles.push("manifest.json");
  return writtenFiles;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["help"],
    value: ["out", "out-dir"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const bundle = abiBundle();
  if (args["out-dir"])
    bundle.writtenFiles = writeBundle(bundle, args["out-dir"]);
  outputJson(bundle, args.out);
}

try {
  main();
} catch (error) {
  controlledFailure(error);
}
