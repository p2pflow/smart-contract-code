#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { keccak256, toUtf8Bytes } = require("ethers");
const { BASELINE_CONTRACTS, PROJECT_ROOT } = require("./constants");
const {
  controlledFailure,
  invariant,
  outputJson,
  parseArgs,
  readJson,
} = require("./utils");

const MODIFIERS_FQN = "contracts/shared/AppStorage.sol:Modifiers";

function usage() {
  return [
    "Usage: node scripts/provenance/storage-layout.js [--build-info FILE] [--out FILE]",
    "",
    "Finds Modifiers.s in Hardhat build-info, proves that build-info reproduces",
    "the exact aa6 runtime hashes, then emits AppStorage roots, reachable nested",
    "structs, and enum ordinals. No file is written unless --out is supplied.",
  ].join("\n");
}

function candidateBuildInfoPaths(explicitPath) {
  if (explicitPath) return [path.resolve(process.cwd(), explicitPath)];
  const directory = path.resolve(PROJECT_ROOT, "artifacts", "build-info");
  invariant(
    fs.existsSync(directory),
    "BUILD_INFO_MISSING",
    "Hardhat build-info directory is missing"
  );
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(directory, name));
}

function findModifiersLayout(buildInfo) {
  const contracts = buildInfo?.output?.contracts;
  if (!contracts || typeof contracts !== "object") return null;

  const [sourceName, contractName] = MODIFIERS_FQN.split(":");
  const contract = contracts[sourceName]?.[contractName];
  const layout = contract?.storageLayout;
  if (!layout || !Array.isArray(layout.storage) || !layout.types) return null;

  const roots = layout.storage.filter((entry) => entry.label === "s");
  if (roots.length !== 1) return null;
  const root = roots[0];
  const rootType = layout.types[root.type];
  if (!rootType || rootType.label !== "struct AppStorage") return null;
  return { contract, layout, root, rootType, sourceName };
}

function selectBuildInfo(explicitPath) {
  const matches = [];
  for (const filePath of candidateBuildInfoPaths(explicitPath)) {
    const buildInfo = readJson(filePath, "BUILD_INFO_READ_FAILED");
    const found = findModifiersLayout(buildInfo);
    if (found) matches.push({ buildInfo, filePath, ...found });
  }

  invariant(
    matches.length > 0,
    "APP_STORAGE_LAYOUT_MISSING",
    "Modifiers.s AppStorage was not found"
  );
  invariant(
    matches.length === 1,
    "AMBIGUOUS_BUILD_INFO",
    "More than one build-info file contains Modifiers.s AppStorage; pass --build-info"
  );
  return matches[0];
}

function verifyBuildInfoRuntime(buildInfo, strict = true) {
  return BASELINE_CONTRACTS.map((entry) => {
    const contract =
      buildInfo.output?.contracts?.[entry.sourceName]?.[entry.contractName];
    const object = contract?.evm?.deployedBytecode?.object;
    const available =
      typeof object === "string" && /^[0-9a-fA-F]+$/.test(object);
    invariant(
      available || !strict,
      "BUILD_INFO_BYTECODE_MISSING",
      `${entry.contractName} runtime is absent from build-info`
    );
    const runtimeHash = available ? keccak256(`0x${object}`) : null;
    invariant(
      !strict || runtimeHash === entry.runtimeHash,
      "BUILD_INFO_RUNTIME_HASH_MISMATCH",
      `${entry.contractName} build-info runtime does not match exact aa6`
    );
    return {
      available,
      contractName: entry.contractName,
      expectedAa6RuntimeHash: entry.runtimeHash,
      matchesAa6: runtimeHash === entry.runtimeHash,
      runtimeHash,
    };
  });
}

function collectReachableTypes(rootTypeId, types) {
  const reachable = new Set();
  function visit(typeId) {
    if (!typeId || reachable.has(typeId)) return;
    const definition = types[typeId];
    invariant(
      definition,
      "MISSING_STORAGE_TYPE",
      `Storage type ${typeId} is undefined`
    );
    reachable.add(typeId);
    if (definition.base) visit(definition.base);
    if (definition.key) visit(definition.key);
    if (definition.value) visit(definition.value);
    for (const member of definition.members || []) visit(member.type);
  }
  visit(rootTypeId);
  return reachable;
}

function typeSummary(typeId, types) {
  const type = types[typeId];
  invariant(
    type,
    "MISSING_STORAGE_TYPE",
    `Storage type ${typeId} is undefined`
  );
  const summary = {
    encoding: type.encoding,
    label: type.label,
    numberOfBytes: type.numberOfBytes,
    typeId,
  };
  if (type.base) summary.base = types[type.base]?.label || type.base;
  if (type.key) summary.key = types[type.key]?.label || type.key;
  if (type.value) summary.value = types[type.value]?.label || type.value;
  return summary;
}

function memberSummary(member, types, parentSlot = 0n) {
  const relativeSlot = BigInt(member.slot);
  return {
    absoluteSlot: (parentSlot + relativeSlot).toString(),
    astId: member.astId,
    label: member.label,
    offset: member.offset,
    relativeSlot: relativeSlot.toString(),
    type: typeSummary(member.type, types),
  };
}

function walkAst(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visitor);
    return;
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkAst(value, visitor);
  }
}

function enumDefinitions(buildInfo) {
  const byName = new Map();
  for (const [sourceName, source] of Object.entries(
    buildInfo.output?.sources || {}
  )) {
    walkAst(source.ast, (node) => {
      if (node.nodeType !== "EnumDefinition") return;
      byName.set(node.name, {
        astId: node.id,
        members: (node.members || []).map((member, ordinal) => ({
          astId: member.id,
          name: member.name,
          ordinal,
        })),
        name: node.name,
        sourceName,
      });
    });
  }
  return byName;
}

function sourceHash(buildInfo, sourceName) {
  const content = buildInfo.input?.sources?.[sourceName]?.content;
  invariant(
    typeof content === "string",
    "SOURCE_CONTENT_MISSING",
    "AppStorage source is missing"
  );
  return keccak256(toUtf8Bytes(content));
}

function buildReport(selected, options = {}) {
  const strictBaseline = options.verifyBaseline !== false;
  const { buildInfo, filePath, layout, root, rootType, sourceName } = selected;
  invariant(
    root.slot === "0" && root.offset === 0,
    "APP_STORAGE_ROOT_MOVED",
    "Modifiers.s is not at slot 0"
  );
  const reachable = collectReachableTypes(root.type, layout.types);
  const enumsByName = enumDefinitions(buildInfo);
  const rootSlot = BigInt(root.slot);

  const roots = rootType.members.map((member) =>
    memberSummary(member, layout.types, rootSlot)
  );
  const nestedStructs = [...reachable]
    .filter((typeId) => typeId !== root.type)
    .map((typeId) => ({ typeId, definition: layout.types[typeId] }))
    .filter(({ definition }) => definition.label.startsWith("struct "))
    .map(({ typeId, definition }) => ({
      label: definition.label,
      members: definition.members.map((member) =>
        memberSummary(member, layout.types)
      ),
      numberOfBytes: definition.numberOfBytes,
      slotCount: Math.ceil(Number(definition.numberOfBytes) / 32),
      typeId,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const enums = [...reachable]
    .map((typeId) => ({ typeId, definition: layout.types[typeId] }))
    .filter(({ definition }) => definition.label.startsWith("enum "))
    .map(({ typeId, definition }) => {
      const name = definition.label.slice("enum ".length);
      const ast = enumsByName.get(name);
      invariant(
        ast,
        "ENUM_AST_MISSING",
        `AST definition for ${name} is missing`
      );
      return {
        astId: ast.astId,
        members: ast.members,
        name,
        numberOfBytes: definition.numberOfBytes,
        sourceName: ast.sourceName,
        typeId,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const appStorageBytes = BigInt(rootType.numberOfBytes);
  invariant(
    appStorageBytes > 0n && appStorageBytes % 32n === 0n,
    "BAD_APP_STORAGE_SIZE",
    "AppStorage byte size is invalid"
  );
  const finalSlot = rootSlot + appStorageBytes / 32n - 1n;
  const lastRoot = roots.reduce((latest, current) =>
    BigInt(current.absoluteSlot) >= BigInt(latest.absoluteSlot)
      ? current
      : latest
  );

  return {
    appStorage: {
      finalAllocatedSlot: finalSlot,
      lastDeclaredRoot: {
        label: lastRoot.label,
        offset: lastRoot.offset,
        slot: lastRoot.absoluteSlot,
      },
      numberOfBytes: rootType.numberOfBytes,
      rootVariable: {
        astId: root.astId,
        contract: root.contract,
        label: root.label,
        offset: root.offset,
        slot: root.slot,
        typeId: root.type,
      },
      roots,
      slotCount: appStorageBytes / 32n,
    },
    baseline: strictBaseline ? "aa6f802" : undefined,
    baselineAttestation: strictBaseline ? "verified" : "not-requested",
    buildInfo: {
      compiler: {
        longVersion: buildInfo.solcLongVersion,
        settings: buildInfo.input?.settings,
        version: buildInfo.solcVersion,
      },
      file: path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/"),
      id: buildInfo.id,
      runtimeAttestations: verifyBuildInfoRuntime(buildInfo, strictBaseline),
      source: {
        keccak256: sourceHash(buildInfo, sourceName),
        name: sourceName,
      },
    },
    enums,
    kind: "p2pflow-app-storage-layout",
    nestedStructs,
    ok: true,
    schemaVersion: 1,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    boolean: ["help"],
    value: ["build-info", "out"],
  });
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  outputJson(buildReport(selectBuildInfo(args["build-info"])), args.out);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    controlledFailure(error);
  }
}

module.exports = {
  buildReport,
  selectBuildInfo,
};
