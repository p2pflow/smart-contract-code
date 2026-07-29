"use strict";

const fs = require("fs");
const path = require("path");

class ProvenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProvenanceError";
    this.code = code;
  }
}

function invariant(condition, code, message) {
  if (!condition) {
    throw new ProvenanceError(code, message);
  }
}

function parseArgs(argv, specification = {}) {
  const result = { _: [] };
  const booleanOptions = new Set(specification.boolean || []);
  const valueOptions = new Set(specification.value || []);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const equalsAt = token.indexOf("=");
    const name = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    invariant(
      booleanOptions.has(name) || valueOptions.has(name),
      "UNKNOWN_ARGUMENT",
      `Unknown option --${name}`
    );

    if (booleanOptions.has(name)) {
      invariant(
        equalsAt === -1,
        "BAD_ARGUMENT",
        `--${name} does not take a value`
      );
      result[name] = true;
      continue;
    }

    const value = equalsAt === -1 ? argv[index + 1] : token.slice(equalsAt + 1);
    invariant(
      value !== undefined && value !== "",
      "BAD_ARGUMENT",
      `--${name} requires a value`
    );
    if (equalsAt === -1) index += 1;
    result[name] = value;
  }

  invariant(
    result._.length === 0,
    "UNKNOWN_ARGUMENT",
    `Unexpected argument ${result._[0]}`
  );
  return result;
}

function stableCopy(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stableCopy);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((copy, key) => {
        if (value[key] !== undefined) copy[key] = stableCopy(value[key]);
        return copy;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(stableCopy(value), null, 2)}\n`;
}

function outputJson(value, outPath) {
  const rendered = stableStringify(value);
  if (!outPath) {
    process.stdout.write(rendered);
    return;
  }

  const resolved = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, rendered, { encoding: "utf8", mode: 0o600 });
}

function readJson(filePath, code = "READ_FAILED") {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new ProvenanceError(code, `Unable to read ${safePath(filePath)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ProvenanceError(code, `Invalid JSON in ${safePath(filePath)}`);
  }
}

function safePath(filePath) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
    return relative;
  return path.basename(absolute);
}

function normalizeHex(value) {
  invariant(
    typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
    "INVALID_HEX",
    "Expected a hexadecimal value"
  );
  return value.toLowerCase();
}

function bigintToHex(value) {
  const parsed = BigInt(value);
  invariant(parsed >= 0n, "BAD_BLOCK", "Block number must not be negative");
  return `0x${parsed.toString(16)}`;
}

function parseBlockArgument(value) {
  if (value === undefined || value === "latest") return "latest";
  invariant(
    /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value),
    "BAD_BLOCK",
    "--block must be latest, decimal, or hexadecimal"
  );
  return bigintToHex(BigInt(value));
}

function controlledFailure(error) {
  const code =
    error instanceof ProvenanceError ? error.code : "UNEXPECTED_FAILURE";
  const message =
    error instanceof ProvenanceError
      ? error.message
      : "Unexpected provenance tooling failure";
  process.stderr.write(
    stableStringify({ error: { code, message }, ok: false })
  );
  process.exitCode = 1;
}

module.exports = {
  ProvenanceError,
  bigintToHex,
  controlledFailure,
  invariant,
  normalizeHex,
  outputJson,
  parseArgs,
  parseBlockArgument,
  readJson,
  safePath,
  stableCopy,
  stableStringify,
};
