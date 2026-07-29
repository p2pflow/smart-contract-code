#!/usr/bin/env node
"use strict";

const path = require("path");
const { id } = require("ethers");
const { buildAllArtifactManifest } = require("./artifacts");
const {
  AA6_FUNCTION_SIGNATURES,
  PROJECT_ROOT,
  ROUTED_BASELINE,
} = require("./constants");
const {
  controlledFailure,
  invariant,
  outputJson,
  parseArgs,
  readJson,
} = require("./utils");

function usage() {
  return [
    "Usage: node scripts/provenance/selector-diff.js [--baseline FILE] [--current FILE | --artifacts DIR] [--fail-on-change] [--out FILE]",
    "",
    "Default baseline: embedded exact-aa6 selector/signature/runtime attestations.",
    "Default current input: artifacts/contracts. Output is metadata-only and",
    "transaction-disabled: it never creates Diamond cut calldata or sends a write.",
    "Selector collisions always exit 2; --fail-on-change also exits 2 for any diff.",
  ].join("\n");
}

function embeddedBaseline() {
  return ROUTED_BASELINE.map((entry) => ({
    address: entry.address,
    contractName: entry.contractName,
    functions: AA6_FUNCTION_SIGNATURES[entry.contractName].map((signature) => ({
      selector: id(signature).slice(0, 10).toLowerCase(),
      signature,
    })),
    runtimeHash: entry.runtimeHash,
    sourceName: entry.sourceName,
  }));
}

function normalizeFunction(fn, context) {
  if (typeof fn === "string") {
    const signature = fn.includes("(") ? fn : null;
    return {
      selector: signature
        ? id(signature).slice(0, 10).toLowerCase()
        : fn.toLowerCase(),
      signature,
    };
  }
  invariant(
    fn && typeof fn.selector === "string",
    "BAD_SELECTOR_MANIFEST",
    `${context} selector is missing`
  );
  const selector = fn.selector.toLowerCase();
  invariant(
    /^0x[0-9a-f]{8}$/.test(selector),
    "BAD_SELECTOR_MANIFEST",
    `${context} selector is invalid`
  );
  if (fn.signature) {
    invariant(
      id(fn.signature).slice(0, 10).toLowerCase() === selector,
      "BAD_SELECTOR_MANIFEST",
      `${context} signature does not hash to its selector`
    );
  }
  return { selector, signature: fn.signature || null };
}

function normalizeFacet(entry, context) {
  const contractName = entry.contractName || entry.name;
  invariant(
    contractName,
    "BAD_SELECTOR_MANIFEST",
    `${context} facet name is missing`
  );
  const rawFunctions = entry.functions || entry.selectors;
  invariant(
    Array.isArray(rawFunctions),
    "BAD_SELECTOR_MANIFEST",
    `${context} functions are missing`
  );
  return {
    address: entry.deployedAddress || entry.address || null,
    contractName,
    functions: rawFunctions.map((fn) =>
      normalizeFunction(fn, `${context}:${contractName}`)
    ),
    runtimeHash: entry.bytecode?.runtimeHash || entry.runtimeHash || null,
    sourceName: entry.sourceName || null,
  };
}

function facetsFromReport(report, context) {
  let entries;
  if (Array.isArray(report)) {
    entries = report;
  } else if (Array.isArray(report.contracts)) {
    entries = report.contracts.filter(
      (entry) =>
        entry.routed === true ||
        (entry.sourceName?.startsWith("contracts/facets/") &&
          entry.contractName?.endsWith("Facet"))
    );
  } else if (Array.isArray(report.allArtifacts)) {
    entries = report.allArtifacts.filter(
      (entry) =>
        entry.sourceName?.startsWith("contracts/facets/") &&
        entry.contractName?.endsWith("Facet") &&
        entry.bytecode?.runtimeBytes > 0
    );
  } else if (Array.isArray(report.facets)) {
    entries = report.facets;
  } else {
    invariant(
      false,
      "BAD_SELECTOR_MANIFEST",
      `${context} does not contain facets`
    );
  }
  return entries.map((entry, index) =>
    normalizeFacet(entry, `${context}[${index}]`)
  );
}

function occurrences(facets) {
  const bySelector = new Map();
  for (const facet of facets) {
    for (const fn of facet.functions) {
      const occurrence = {
        address: facet.address,
        contractName: facet.contractName,
        runtimeHash: facet.runtimeHash,
        selector: fn.selector,
        signature: fn.signature,
        sourceName: facet.sourceName,
      };
      if (!bySelector.has(fn.selector)) bySelector.set(fn.selector, []);
      bySelector.get(fn.selector).push(occurrence);
    }
  }
  return bySelector;
}

function collisionList(bySelector, side) {
  return [...bySelector.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([selector, entries]) => ({ entries, selector, side }))
    .sort((left, right) => left.selector.localeCompare(right.selector));
}

function implementationChanged(before, after) {
  if (before.contractName !== after.contractName) return "facet-owner-changed";
  if (
    before.address &&
    after.address &&
    before.address.toLowerCase() !== after.address.toLowerCase()
  ) {
    return "facet-address-changed";
  }
  if (
    before.runtimeHash &&
    after.runtimeHash &&
    before.runtimeHash !== after.runtimeHash
  ) {
    return "facet-runtime-changed";
  }
  return null;
}

function compareSelectors(baselineFacets, currentFacets) {
  const baselineOccurrences = occurrences(baselineFacets);
  const currentOccurrences = occurrences(currentFacets);
  const collisions = [
    ...collisionList(baselineOccurrences, "baseline"),
    ...collisionList(currentOccurrences, "current"),
  ];
  const collisionSelectors = new Set(collisions.map((item) => item.selector));

  const actions = { Add: [], Remove: [], Replace: [] };
  const unchanged = [];
  const signatureHashCollisions = [];
  const allSelectors = new Set([
    ...baselineOccurrences.keys(),
    ...currentOccurrences.keys(),
  ]);

  for (const selector of [...allSelectors].sort()) {
    if (collisionSelectors.has(selector)) continue;
    const before = baselineOccurrences.get(selector)?.[0] || null;
    const after = currentOccurrences.get(selector)?.[0] || null;
    if (!before) {
      actions.Add.push({
        selector,
        signature: after.signature,
        toFacet: after.contractName,
        toRuntimeHash: after.runtimeHash,
      });
      continue;
    }
    if (!after) {
      actions.Remove.push({
        fromFacet: before.contractName,
        selector,
        signature: before.signature,
      });
      continue;
    }
    if (
      before.signature &&
      after.signature &&
      before.signature !== after.signature
    ) {
      signatureHashCollisions.push({
        baseline: before,
        current: after,
        selector,
      });
      continue;
    }
    const reason = implementationChanged(before, after);
    if (reason) {
      actions.Replace.push({
        fromFacet: before.contractName,
        reason,
        selector,
        signature: after.signature || before.signature,
        toFacet: after.contractName,
        toRuntimeHash: after.runtimeHash,
      });
    } else {
      unchanged.push({
        facet: after.contractName,
        selector,
        signature: after.signature || before.signature,
      });
    }
  }

  const changedSelectorCount =
    actions.Add.length + actions.Remove.length + actions.Replace.length;
  const ok = collisions.length === 0 && signatureHashCollisions.length === 0;
  return {
    actions,
    calldataIncluded: false,
    changedSelectorCount,
    collisions,
    executableDiamondCutIncluded: false,
    ok,
    signatureHashCollisions,
    summary: {
      add: actions.Add.length,
      baselineFacetCount: baselineFacets.length,
      baselineSelectorCount: baselineOccurrences.size,
      collision: collisions.length + signatureHashCollisions.length,
      currentFacetCount: currentFacets.length,
      currentSelectorCount: currentOccurrences.size,
      remove: actions.Remove.length,
      replace: actions.Replace.length,
      unchanged: unchanged.length,
    },
    transactionDisabled: true,
    unchanged,
  };
}

function currentFacets(args) {
  if (args.current) {
    return facetsFromReport(
      readJson(
        path.resolve(process.cwd(), args.current),
        "CURRENT_SELECTOR_READ_FAILED"
      ),
      "Current manifest"
    );
  }
  const artifactRoot = path.resolve(
    PROJECT_ROOT,
    args.artifacts || "artifacts/contracts"
  );
  return facetsFromReport(
    { allArtifacts: buildAllArtifactManifest(artifactRoot) },
    "Current artifacts"
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["fail-on-change", "help"],
    value: ["artifacts", "baseline", "current", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  invariant(
    !(args.current && args.artifacts),
    "BAD_ARGUMENT",
    "Use either --current or --artifacts, not both"
  );

  const baselineFacets = args.baseline
    ? facetsFromReport(
        readJson(
          path.resolve(process.cwd(), args.baseline),
          "BASELINE_SELECTOR_READ_FAILED"
        ),
        "Baseline manifest"
      )
    : embeddedBaseline();
  const comparison = compareSelectors(baselineFacets, currentFacets(args));
  const changeGatePassed =
    !args["fail-on-change"] || comparison.changedSelectorCount === 0;
  const ok = comparison.ok && changeGatePassed;
  outputJson(
    {
      baseline: args.baseline ? "explicit-manifest" : "embedded-exact-aa6",
      comparison,
      councilGate: "REJECTED_NO_EXECUTION",
      kind: "p2pflow-selector-diff",
      metadataOnly: true,
      ok,
      schemaVersion: 1,
      transactionDisabled: true,
    },
    args.out
  );
  if (!ok) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    controlledFailure(error);
  }
}

module.exports = { compareSelectors, embeddedBaseline, facetsFromReport };
