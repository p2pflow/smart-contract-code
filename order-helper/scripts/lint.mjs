import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (![".ts", ".mjs"].includes(extname(entry.name))) continue;
    const text = await readFile(path, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        findings.push(`${relative(root, path)}:${index + 1}: trailing whitespace`);
      }
      if (/\bconsole\.(log|debug)\s*\(/.test(line)) {
        findings.push(`${relative(root, path)}:${index + 1}: unsafe console output`);
      }
      if (/\bany\b/.test(line) && !line.trimStart().startsWith("//")) {
        findings.push(`${relative(root, path)}:${index + 1}: explicit any is forbidden`);
      }
    });
  }
}

await walk(join(root, "src"));
await walk(join(root, "test")).catch((error) => {
  if (error?.code !== "ENOENT") throw error;
});

if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exitCode = 1;
}
