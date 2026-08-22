import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "docs", "architecture", "diagram-pack");
const canonicalPdf = path.join(root, "docs", "architecture", "P2PFLOW_ARCHITECTURE_DIAGRAM_PACK.pdf");
const check = process.argv.includes("--check");
const temporaryDirectory = check
  ? fs.mkdtempSync(path.join(os.tmpdir(), "p2pflow-diagram-pack-"))
  : null;
const outputDirectory = check ? path.join(temporaryDirectory, "diagram-pack") : sourceDirectory;
const outputPdf = check
  ? path.join(temporaryDirectory, path.basename(canonicalPdf))
  : canonicalPdf;
const reproduciblePdfDate = "D:20260820000000+00'00'";

const diagrams = [
  {
    stem: "01-system-context",
    title: "1 · Production system context",
    caption: "Three static clients, one v2 Diamond authority, one executor process, PostgreSQL durability, and a public Goldsky projection.",
  },
  {
    stem: "02-buy-sell-lifecycle",
    title: "2 · BUY and SELL lifecycle",
    caption: "The complete custody and settlement journeys, including private reference boundaries, off-chain fiat, and exact-once terminal recovery.",
  },
  {
    stem: "03-diamond-contract",
    title: "3 · v2 Diamond smart contract",
    caption: "EIP-2535 selector routing, governance and marketplace facets, shared v2 storage, custody libraries, official USDC, and canonical events.",
  },
  {
    stem: "04-executor-internals",
    title: "4 · Single executor internals",
    caption: "The HTTP security boundary, domain services, canonical scanner, durable jobs, transaction coordination, one DB pool, and separately gated signing.",
  },
  {
    stem: "05-finality-recovery",
    title: "5 · Finality and recovery",
    caption: "Browser journals and executor automation converge on the same zero-based 12-block rule, with durable ambiguity and fail-closed reorg handling.",
  },
];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function normalizePdf(file) {
  const rendered = fs.readFileSync(file).toString("latin1");
  const generatedDates = rendered.match(/D:\d{14}[+-]\d{2}'\d{2}'/gu) ?? [];
  if (generatedDates.length !== 2) {
    throw new Error(`Expected exactly two generated PDF timestamps, found ${generatedDates.length}`);
  }
  fs.writeFileSync(
    file,
    Buffer.from(rendered.replaceAll(/D:\d{14}[+-]\d{2}'\d{2}'/gu, reproduciblePdfDate), "latin1"),
  );
}

function compareExact(actual, expected, label) {
  if (!fs.existsSync(expected)) throw new Error(`Missing canonical ${label}: ${path.relative(root, expected)}`);
  if (!fs.readFileSync(actual).equals(fs.readFileSync(expected))) {
    throw new Error(`${label} differs from the checked-in canonical artifact`);
  }
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const diagram of diagrams) {
  const source = path.join(sourceDirectory, `${diagram.stem}.dot`);
  const output = path.join(outputDirectory, `${diagram.stem}.png`);
  execFileSync("dot", ["-Tpng", "-Gdpi=180", source, "-o", output], { stdio: "inherit" });
}

const pages = diagrams.map((diagram) => {
  const png = path.join(outputDirectory, `${diagram.stem}.png`);
  const encoded = fs.readFileSync(png).toString("base64");
  return `<section class="page">
    <header><h1>${diagram.title}</h1><p>${diagram.caption}</p></header>
    <div class="frame"><img alt="${diagram.title}" src="data:image/png;base64,${encoded}"></div>
    <footer><span>P2PFlow architecture diagram pack</span><span>As-built release design · no live deployment asserted</span></footer>
  </section>`;
}).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 16in 9in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #071321; color: #f4f8ff; font-family: Arial, Helvetica, sans-serif; }
.page { width: 16in; height: 9in; padding: 8mm 10mm 6mm; display: grid; grid-template-rows: 18mm 1fr 7mm; break-after: page; page-break-after: always; background: #071321; overflow: hidden; }
.page:last-child { break-after: auto; page-break-after: auto; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; border-bottom: .45mm solid #1f455c; }
h1 { margin: 0; color: #f4f8ff; font-size: 18pt; line-height: 1.05; letter-spacing: -.2px; }
header p { width: 48%; margin: 0; text-align: right; color: #a8bad4; font-size: 8.7pt; line-height: 1.25; }
.frame { min-height: 0; display: flex; align-items: center; justify-content: center; padding: 3.5mm 0 2mm; }
.frame img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
footer { display: flex; align-items: end; justify-content: space-between; border-top: .3mm solid #1f455c; padding-top: 1.7mm; color: #7189a1; font-size: 7.4pt; letter-spacing: .15px; }
</style></head><body>${pages}</body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1684, height: 1190 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: outputPdf,
    width: "16in",
    height: "9in",
    printBackground: true,
    preferCSSPageSize: true,
  });
} finally {
  await browser.close();
}
normalizePdf(outputPdf);

if (check) {
  try {
    for (const diagram of diagrams) {
      compareExact(
        path.join(outputDirectory, `${diagram.stem}.png`),
        path.join(sourceDirectory, `${diagram.stem}.png`),
        `${diagram.stem}.png`,
      );
    }
    compareExact(outputPdf, canonicalPdf, path.basename(canonicalPdf));
    console.log(`Verified five deterministic PNGs and PDF sha256:${sha256(canonicalPdf)}`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
} else {
  for (const diagram of diagrams) {
    const file = path.join(outputDirectory, `${diagram.stem}.png`);
    console.log(`${path.relative(root, file)} sha256:${sha256(file)}`);
  }
  console.log(`${path.relative(root, outputPdf)} sha256:${sha256(outputPdf)}`);
}
