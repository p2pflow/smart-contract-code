import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "../..");
const shouldWrite = process.argv.includes("--write");
const logoPaths = [
  "p2pflow-user-ui/public/images/logo.jpg",
  "p2pflow-merchant-ui/public/images/logo.jpg",
].map((relativePath) => path.join(workspaceDirectory, relativePath));
const removableMarkers = new Set([0xe1, 0xed]);
const localPathPatterns = [
  /[A-Za-z]:\\Users\\/i,
  /\/(?:home|Users)\//,
  /file:\/\//i,
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function displayPath(filePath) {
  return path.relative(workspaceDirectory, filePath);
}

function sanitizeJpeg(source, filePath) {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error(displayPath(filePath) + " is not a JPEG");
  }

  const retained = [source.subarray(0, 2)];
  let cursor = 2;
  let removed = 0;
  let originalScan = null;

  while (cursor < source.length) {
    const markerStart = cursor;
    if (source[cursor] !== 0xff) {
      throw new Error(displayPath(filePath) + " has malformed JPEG markers");
    }
    while (source[cursor] === 0xff) cursor += 1;
    const marker = source[cursor];
    cursor += 1;

    if (marker === 0xda) {
      originalScan = source.subarray(markerStart);
      retained.push(originalScan);
      cursor = source.length;
      break;
    }
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      retained.push(source.subarray(markerStart, cursor));
      continue;
    }
    if (cursor + 2 > source.length) {
      throw new Error(displayPath(filePath) + " has a truncated JPEG segment");
    }

    const segmentLength = source.readUInt16BE(cursor);
    const segmentEnd = cursor + segmentLength;
    if (segmentLength < 2 || segmentEnd > source.length) {
      throw new Error(displayPath(filePath) + " has an invalid JPEG segment");
    }
    if (removableMarkers.has(marker)) {
      removed += 1;
    } else {
      retained.push(source.subarray(markerStart, segmentEnd));
    }
    cursor = segmentEnd;
  }

  if (originalScan === null) {
    throw new Error(displayPath(filePath) + " has no JPEG scan");
  }
  const sanitized = Buffer.concat(retained);
  const sanitizedScanOffset = sanitized.indexOf(originalScan);
  if (sanitizedScanOffset < 0 || !sanitized.subarray(sanitizedScanOffset).equals(originalScan)) {
    throw new Error(displayPath(filePath) + " pixel payload changed");
  }
  return { sanitized, removed };
}

const finalDigests = new Set();
for (const filePath of logoPaths) {
  const source = await readFile(filePath);
  const binaryText = source.toString("latin1");
  const containsLocalPath = localPathPatterns.some((pattern) => pattern.test(binaryText));
  const { sanitized, removed } = sanitizeJpeg(source, filePath);
  const relativePath = displayPath(filePath);

  if (shouldWrite && (removed > 0 || containsLocalPath)) {
    await writeFile(filePath, sanitized);
    console.log("Sanitized non-rendering JPEG metadata: " + relativePath);
  } else if (!shouldWrite && (removed > 0 || containsLocalPath)) {
    throw new Error(relativePath + " contains authoring metadata or a local filesystem path");
  }
  finalDigests.add(digest(shouldWrite ? sanitized : source));
}

if (finalDigests.size !== 1) {
  throw new Error("Shared UI logo bytes drifted across applications");
}
console.log("Workspace image privacy verified: no XMP, Photoshop metadata, or local filesystem paths");
