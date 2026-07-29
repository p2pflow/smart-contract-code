#!/usr/bin/env node
"use strict";

const path = require("path");
const { keccak256, toUtf8Bytes } = require("ethers");
const { PROJECT_ROOT } = require("./constants");
const { buildReport, selectBuildInfo } = require("./storage-layout");
const {
  controlledFailure,
  invariant,
  outputJson,
  parseArgs,
  readJson,
  stableStringify,
} = require("./utils");

const DEFAULT_BASELINE = path.resolve(
  PROJECT_ROOT,
  "scripts/provenance/baseline/aa6-storage-layout.json"
);

function usage() {
  return [
    "Usage: node scripts/provenance/storage-diff.js [--baseline FILE] [--current FILE | --build-info FILE] [--out FILE]",
    "",
    "Default baseline: scripts/provenance/baseline/aa6-storage-layout.json",
    "Default current input: Modifiers.s from the sole Hardhat build-info file.",
    "Existing roots, nested fields, and enum ordinals must be identical. New",
    "AppStorage roots may only be appended. A violation exits with status 2.",
  ].join("\n");
}

function semanticType(type) {
  if (!type) return null;
  return {
    base: type.base,
    encoding: type.encoding,
    key: type.key,
    label: type.label,
    numberOfBytes: type.numberOfBytes,
    value: type.value,
  };
}

function semanticMember(member) {
  return {
    label: member.label,
    offset: member.offset,
    relativeSlot: member.relativeSlot,
    type: semanticType(member.type),
  };
}

function semanticRoot(root) {
  return {
    absoluteSlot: root.absoluteSlot,
    label: root.label,
    offset: root.offset,
    relativeSlot: root.relativeSlot,
    type: semanticType(root.type),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateLayout(report, context) {
  invariant(
    report && report.appStorage,
    "BAD_LAYOUT_REPORT",
    `${context} AppStorage is missing`
  );
  invariant(
    Array.isArray(report.appStorage.roots),
    "BAD_LAYOUT_REPORT",
    `${context} AppStorage roots are missing`
  );
  invariant(
    Array.isArray(report.nestedStructs) && Array.isArray(report.enums),
    "BAD_LAYOUT_REPORT",
    `${context} nested structs or enums are missing`
  );
  invariant(
    report.appStorage.rootVariable?.label === "s" &&
      report.appStorage.rootVariable?.slot === "0" &&
      report.appStorage.rootVariable?.offset === 0 &&
      report.appStorage.rootVariable?.contract ===
        "contracts/shared/AppStorage.sol:Modifiers" &&
      report.appStorage.rootVariable?.typeId?.includes("t_struct(AppStorage)"),
    "APP_STORAGE_ROOT_MOVED",
    `${context} Modifiers.s is not at slot 0 offset 0`
  );
}

function compareLayouts(baseline, current) {
  validateLayout(baseline, "Baseline");
  validateLayout(current, "Current");

  const violations = [];
  const baselineRoots = baseline.appStorage.roots;
  const currentRoots = current.appStorage.roots;

  if (currentRoots.length < baselineRoots.length) {
    violations.push({
      actual: currentRoots.length,
      category: "root-removed",
      expectedAtLeast: baselineRoots.length,
    });
  }

  for (let index = 0; index < baselineRoots.length; index += 1) {
    const before = baselineRoots[index];
    const after = currentRoots[index];
    if (!after || !same(semanticRoot(before), semanticRoot(after))) {
      violations.push({
        baseline: semanticRoot(before),
        category: "baseline-root-changed",
        current: after ? semanticRoot(after) : null,
        index,
      });
    }
  }

  const addedRoots = currentRoots.slice(baselineRoots.length).map(semanticRoot);
  const baselineFinalSlot = BigInt(baseline.appStorage.finalAllocatedSlot);
  const baselineLastRoot = baselineRoots[baselineRoots.length - 1];
  const lastTypeBytes = BigInt(baselineLastRoot.type.numberOfBytes);
  const lastOccupiedEnd =
    BigInt(baselineLastRoot.absoluteSlot) * 32n +
    BigInt(baselineLastRoot.offset) +
    (lastTypeBytes > 32n ? 32n : lastTypeBytes);

  for (const root of addedRoots) {
    const start = BigInt(root.absoluteSlot) * 32n + BigInt(root.offset);
    if (start < lastOccupiedEnd) {
      violations.push({
        baselineLastOccupiedByteExclusive: lastOccupiedEnd.toString(),
        category: "root-not-appended",
        root,
        startByte: start.toString(),
      });
    }
  }

  const baselineRootNames = new Set(baselineRoots.map((root) => root.label));
  for (const root of addedRoots) {
    if (baselineRootNames.has(root.label)) {
      violations.push({ category: "duplicate-root-label", root });
    }
    baselineRootNames.add(root.label);
  }

  const currentStructs = new Map(
    current.nestedStructs.map((item) => [item.label, item])
  );
  for (const before of baseline.nestedStructs) {
    const after = currentStructs.get(before.label);
    const beforeMembers = before.members.map(semanticMember);
    const afterMembers = after ? after.members.map(semanticMember) : null;
    if (
      !after ||
      before.numberOfBytes !== after.numberOfBytes ||
      !same(beforeMembers, afterMembers)
    ) {
      violations.push({
        baseline: {
          members: beforeMembers,
          numberOfBytes: before.numberOfBytes,
        },
        category: "baseline-nested-struct-changed",
        current: after
          ? { members: afterMembers, numberOfBytes: after.numberOfBytes }
          : null,
        label: before.label,
      });
    }
  }

  const baselineStructNames = new Set(
    baseline.nestedStructs.map((item) => item.label)
  );
  const addedStructs = current.nestedStructs
    .filter((item) => !baselineStructNames.has(item.label))
    .map((item) => ({
      label: item.label,
      members: item.members.map(semanticMember),
      numberOfBytes: item.numberOfBytes,
    }));

  const currentEnums = new Map(current.enums.map((item) => [item.name, item]));
  for (const before of baseline.enums) {
    const after = currentEnums.get(before.name);
    const beforeMembers = before.members.map(({ name, ordinal }) => ({
      name,
      ordinal,
    }));
    const afterMembers = after
      ? after.members.map(({ name, ordinal }) => ({ name, ordinal }))
      : null;
    if (
      !after ||
      before.numberOfBytes !== after.numberOfBytes ||
      !same(beforeMembers, afterMembers)
    ) {
      violations.push({
        baseline: {
          members: beforeMembers,
          numberOfBytes: before.numberOfBytes,
        },
        category: "baseline-enum-changed",
        current: after
          ? { members: afterMembers, numberOfBytes: after.numberOfBytes }
          : null,
        name: before.name,
      });
    }
  }

  const baselineEnumNames = new Set(baseline.enums.map((item) => item.name));
  const addedEnums = current.enums
    .filter((item) => !baselineEnumNames.has(item.name))
    .map((item) => ({
      members: item.members.map(({ name, ordinal }) => ({ name, ordinal })),
      name: item.name,
    }));

  const currentFinalSlot = BigInt(current.appStorage.finalAllocatedSlot);
  if (currentFinalSlot < baselineFinalSlot) {
    violations.push({
      baselineFinalSlot,
      category: "final-slot-regressed",
      currentFinalSlot,
    });
  }

  return {
    addedEnums,
    addedRoots,
    addedStructs,
    baselineFinalSlot,
    currentFinalSlot,
    finalSlotDelta: currentFinalSlot - baselineFinalSlot,
    ok: violations.length === 0,
    transactionDisabled: true,
    violations,
  };
}

function loadCurrent(args) {
  if (args.current)
    return readJson(
      path.resolve(process.cwd(), args.current),
      "CURRENT_LAYOUT_READ_FAILED"
    );
  const selected = selectBuildInfo(args["build-info"]);
  return buildReport(selected, { verifyBaseline: false });
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["help"],
    value: ["baseline", "build-info", "current", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  invariant(
    !(args.current && args["build-info"]),
    "BAD_ARGUMENT",
    "Use either --current or --build-info, not both"
  );

  const baselinePath = path.resolve(
    process.cwd(),
    args.baseline || DEFAULT_BASELINE
  );
  const baseline = readJson(baselinePath, "BASELINE_LAYOUT_READ_FAILED");
  const current = loadCurrent(args);
  const comparison = compareLayouts(baseline, current);
  outputJson(
    {
      baseline: {
        id: baseline.baseline || null,
        reportHash: keccak256(toUtf8Bytes(stableStringify(baseline).trimEnd())),
      },
      comparison,
      current: {
        baselineAttestation: current.baselineAttestation,
        buildInfoId: current.buildInfo?.id,
        reportHash: keccak256(toUtf8Bytes(stableStringify(current).trimEnd())),
      },
      kind: "p2pflow-storage-layout-diff",
      ok: comparison.ok,
      schemaVersion: 1,
      transactionDisabled: true,
    },
    args.out
  );
  if (!comparison.ok) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    controlledFailure(error);
  }
}

module.exports = { compareLayouts };
