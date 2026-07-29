"use strict";

const fs = require("fs");
const path = require("path");
const {
  FunctionFragment,
  Interface,
  ErrorFragment,
  EventFragment,
  keccak256,
  toUtf8Bytes,
} = require("ethers");
const {
  BASELINE_CONTRACTS,
  PROJECT_ROOT,
  ROUTED_BASELINE,
} = require("./constants");
const { invariant, readJson, stableStringify } = require("./utils");

function artifactPath(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

function loadArtifact(entry) {
  const artifact = readJson(
    artifactPath(entry.artifact),
    "ARTIFACT_READ_FAILED"
  );
  invariant(
    artifact.contractName === entry.contractName &&
      artifact.sourceName === entry.sourceName,
    "ARTIFACT_IDENTITY_MISMATCH",
    `${entry.contractName} artifact identity does not match the aa6 baseline`
  );
  invariant(
    Array.isArray(artifact.abi),
    "BAD_ARTIFACT",
    `${entry.contractName} ABI is missing`
  );
  invariant(
    typeof artifact.deployedBytecode === "string",
    "BAD_ARTIFACT",
    `${entry.contractName} deployed bytecode is missing`
  );
  return artifact;
}

function abiInventory(abi) {
  const iface = new Interface(abi);
  const functions = iface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => {
      const parsed = FunctionFragment.from(fragment);
      return {
        inputs: parsed.inputs.map((input) => input.format("full")),
        mutability: parsed.stateMutability,
        outputs: parsed.outputs.map((output) => output.format("full")),
        selector: parsed.selector,
        signature: parsed.format("sighash"),
      };
    })
    .sort((left, right) => left.selector.localeCompare(right.selector));

  const events = iface.fragments
    .filter((fragment) => fragment.type === "event")
    .map((fragment) => {
      const parsed = EventFragment.from(fragment);
      return {
        anonymous: parsed.anonymous,
        signature: parsed.format("sighash"),
        topicHash: parsed.topicHash,
      };
    })
    .sort((left, right) => left.topicHash.localeCompare(right.topicHash));

  const errors = iface.fragments
    .filter((fragment) => fragment.type === "error")
    .map((fragment) => {
      const parsed = ErrorFragment.from(fragment);
      return {
        selector: parsed.selector,
        signature: parsed.format("sighash"),
      };
    })
    .sort((left, right) => left.selector.localeCompare(right.selector));

  return { errors, events, functions };
}

function manifestEntry(baseline) {
  const artifact = loadArtifact(baseline);
  const inventory = abiInventory(artifact.abi);
  const creationHash = keccak256(artifact.bytecode);
  const runtimeHash = keccak256(artifact.deployedBytecode);

  invariant(
    runtimeHash === baseline.runtimeHash,
    "LOCAL_RUNTIME_HASH_MISMATCH",
    `${baseline.contractName} runtime hash does not match the exact aa6 baseline`
  );

  if (baseline.routed) {
    invariant(
      inventory.functions.length === baseline.selectorCount,
      "LOCAL_SELECTOR_COUNT_MISMATCH",
      `${baseline.contractName} selector count does not match the exact aa6 baseline`
    );
  }

  return {
    abi: artifact.abi,
    abiHash: keccak256(toUtf8Bytes(stableStringify(artifact.abi).trimEnd())),
    artifact: baseline.artifact,
    bytecode: {
      creationBytes: (artifact.bytecode.length - 2) / 2,
      creationHash,
      runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
      runtimeHash,
    },
    contractName: baseline.contractName,
    deployedAddress: baseline.address,
    errors: inventory.errors,
    events: inventory.events,
    functions: inventory.functions,
    routed: baseline.routed,
    sourceName: baseline.sourceName,
  };
}

function buildBaselineManifest() {
  const contracts = BASELINE_CONTRACTS.map(manifestEntry);
  const routed = contracts.filter((entry) => entry.routed);
  const selectorOwners = new Map();

  for (const contract of routed) {
    for (const fn of contract.functions) {
      invariant(
        !selectorOwners.has(fn.selector),
        "LOCAL_SELECTOR_COLLISION",
        `Selector ${fn.selector} is present in more than one routed facet`
      );
      selectorOwners.set(fn.selector, {
        contractName: contract.contractName,
        signature: fn.signature,
      });
    }
  }

  invariant(
    routed.length === ROUTED_BASELINE.length && selectorOwners.size === 63,
    "LOCAL_ROUTING_MISMATCH",
    "The exact aa6 route set must contain 6 facets and 63 selectors"
  );

  return {
    baseline: "aa6f802",
    contracts,
    routing: {
      facetCount: routed.length,
      selectorCount: selectorOwners.size,
      selectors: [...selectorOwners.entries()]
        .map(([selector, owner]) => ({ selector, ...owner }))
        .sort((left, right) => left.selector.localeCompare(right.selector)),
    },
  };
}

function findArtifactFiles(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...findArtifactFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".json") &&
      !entry.name.endsWith(".dbg.json")
    ) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function buildAllArtifactManifest(directory) {
  const root = path.resolve(directory);
  invariant(
    fs.existsSync(root),
    "ARTIFACT_ROOT_MISSING",
    "Artifact directory does not exist"
  );

  return findArtifactFiles(root)
    .map((filePath) => {
      const artifact = readJson(filePath, "ARTIFACT_READ_FAILED");
      if (
        !artifact ||
        !Array.isArray(artifact.abi) ||
        typeof artifact.bytecode !== "string" ||
        typeof artifact.deployedBytecode !== "string"
      ) {
        return null;
      }
      const inventory = abiInventory(artifact.abi);
      return {
        abi: artifact.abi,
        abiHash: keccak256(
          toUtf8Bytes(stableStringify(artifact.abi).trimEnd())
        ),
        artifact: path
          .relative(PROJECT_ROOT, filePath)
          .split(path.sep)
          .join("/"),
        bytecode: {
          creationBytes: (artifact.bytecode.length - 2) / 2,
          creationHash: keccak256(artifact.bytecode),
          runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
          runtimeHash: keccak256(artifact.deployedBytecode),
        },
        contractName: artifact.contractName,
        errors: inventory.errors,
        events: inventory.events,
        functions: inventory.functions,
        sourceName: artifact.sourceName,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      `${left.sourceName}:${left.contractName}`.localeCompare(
        `${right.sourceName}:${right.contractName}`
      )
    );
}

module.exports = {
  abiInventory,
  buildAllArtifactManifest,
  buildBaselineManifest,
  loadArtifact,
  manifestEntry,
};
