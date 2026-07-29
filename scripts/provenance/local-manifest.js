#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  buildAllArtifactManifest,
  buildBaselineManifest,
} = require("./artifacts");
const { PROJECT_ROOT } = require("./constants");
const { controlledFailure, outputJson, parseArgs } = require("./utils");

function usage() {
  return [
    "Usage: node scripts/provenance/local-manifest.js [--all|--current] [--artifacts DIR] [--out FILE]",
    "",
    "Default: validate and print the exact aa6 Diamond/facet ABI, selector, and bytecode manifest.",
    "--all: additionally inventory every Hardhat contract artifact below DIR.",
    "--current: inventory all current artifacts without asserting they are still aa6.",
    "No file is written unless --out is supplied.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["all", "current", "help"],
    value: ["artifacts", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = args.current
    ? {
        baselineValidation: "not-requested",
        kind: "p2pflow-current-artifact-manifest",
        ok: true,
        schemaVersion: 1,
      }
    : {
        kind: "p2pflow-local-artifact-manifest",
        ok: true,
        schemaVersion: 1,
        ...buildBaselineManifest(),
      };

  if (args.all || args.current) {
    const root = path.resolve(
      PROJECT_ROOT,
      args.artifacts || "artifacts/contracts"
    );
    report.allArtifacts = buildAllArtifactManifest(root);
    report.allArtifactCount = report.allArtifacts.length;
  }

  outputJson(report, args.out);
}

try {
  main();
} catch (error) {
  controlledFailure(error);
}
