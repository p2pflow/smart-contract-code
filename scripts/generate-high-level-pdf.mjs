import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "docs", "architecture", "P2PFLOW_BASE_SEPOLIA_MVP_HIGH_LEVEL.md");
const canonicalOutput = path.join(root, "docs", "architecture", "P2PFLOW_BASE_SEPOLIA_MVP_HIGH_LEVEL.pdf");
const check = process.argv.includes("--check");
const outputIndex = process.argv.indexOf("--output");
if (check && outputIndex !== -1) throw new Error("--check and --output are mutually exclusive");
if (outputIndex !== -1 && !process.argv[outputIndex + 1]) throw new Error("--output requires a path");
const temporaryDirectory = check
  ? fs.mkdtempSync(path.join(os.tmpdir(), "p2pflow-high-level-pdf-"))
  : null;
const output = check
  ? path.join(temporaryDirectory, path.basename(canonicalOutput))
  : outputIndex === -1
    ? canonicalOutput
    : path.resolve(process.cwd(), process.argv[outputIndex + 1]);
const reproduciblePdfDate = "D:20260816000000+00'00'";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(value) {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/gu, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '<a href="$2">$1</a>');
  return rendered;
}

function architectureSvg() {
  return `<figure class="diagram" aria-label="P2PFlow system topology">
  <svg viewBox="0 0 920 475" role="img" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111f38"/><stop offset="1" stop-color="#172d4d"/></linearGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#51d5c5"/></marker>
      <style>.n{fill:url(#panel);stroke:#51d5c5;stroke-width:2}.t{fill:#f4f8ff;font:600 17px Arial}.s{fill:#a8bad4;font:13px Arial}.a{stroke:#51d5c5;stroke-width:2;fill:none;marker-end:url(#arrow)}.d{stroke-dasharray:7 6}</style>
    </defs>
    <rect x="25" y="25" width="220" height="425" rx="24" fill="#0b1527" stroke="#2a4568"/>
    <text x="50" y="58" class="s">STATIC PRODUCTION UIs</text>
    <rect class="n" x="50" y="82" width="170" height="64" rx="13"/><text class="t" x="135" y="109" text-anchor="middle">User UI</text><text class="s" x="135" y="130" text-anchor="middle">wallet + orders</text>
    <rect class="n" x="50" y="172" width="170" height="64" rx="13"/><text class="t" x="135" y="199" text-anchor="middle">Merchant UI</text><text class="s" x="135" y="220" text-anchor="middle">liquidity + settlement</text>
    <rect class="n" x="50" y="262" width="170" height="64" rx="13"/><text class="t" x="135" y="289" text-anchor="middle">Operator UI</text><text class="s" x="135" y="310" text-anchor="middle">review + controls</text>
    <rect class="n" x="50" y="365" width="170" height="55" rx="13"/><text class="t" x="135" y="397" text-anchor="middle">Protocol package</text>
    <rect class="n" x="355" y="70" width="220" height="80" rx="15"/><text class="t" x="465" y="104" text-anchor="middle">v2 Diamond</text><text class="s" x="465" y="127" text-anchor="middle">custody + lifecycle authority</text>
    <rect class="n" x="355" y="205" width="220" height="80" rx="15"/><text class="t" x="465" y="239" text-anchor="middle">Single executor</text><text class="s" x="465" y="262" text-anchor="middle">API + scanner + workers</text>
    <rect class="n" x="355" y="345" width="220" height="70" rx="15"/><text class="t" x="465" y="376" text-anchor="middle">Goldsky subgraph</text><text class="s" x="465" y="398" text-anchor="middle">public read projection</text>
    <rect class="n" x="690" y="55" width="190" height="60" rx="13"/><text class="t" x="785" y="91" text-anchor="middle">Base Sepolia USDC</text>
    <rect class="n" x="690" y="160" width="190" height="60" rx="13"/><text class="t" x="785" y="196" text-anchor="middle">PostgreSQL</text>
    <rect class="n" x="690" y="265" width="190" height="60" rx="13"/><text class="t" x="785" y="291" text-anchor="middle">Price sources</text><text class="s" x="785" y="311" text-anchor="middle">two per market leg</text>
    <rect class="n" x="690" y="370" width="190" height="60" rx="13"/><text class="t" x="785" y="396" text-anchor="middle">Managed signers</text><text class="s" x="785" y="416" text-anchor="middle">approval-gated</text>
    <path class="a" d="M220 114C285 114 295 110 355 110"/><path class="a" d="M220 204C290 204 295 245 355 245"/><path class="a" d="M220 294C290 294 300 250 355 250"/><path class="a" d="M220 393C285 393 300 375 355 375"/>
    <path class="a" d="M575 110H690"/><path class="a" d="M575 245C625 245 640 190 690 190"/><path class="a" d="M575 245C630 245 640 295 690 295"/><path class="a d" d="M575 255C640 285 640 400 690 400"/><path class="a" d="M575 380C630 380 640 120 575 120"/>
  </svg><figcaption>One canonical contract boundary, one executor process, public projections, and separately gated managed signing.</figcaption></figure>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const parts = [];
  let code = null;
  let language = "";
  let list = null;
  let paragraph = [];
  let diagram = 0;
  const flushParagraph = () => {
    if (paragraph.length > 0) parts.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list !== null) parts.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    const fence = line.match(/^```([^\s]*)\s*$/u);
    if (fence) {
      flushParagraph(); closeList();
      if (code === null) { code = []; language = fence[1]; }
      else {
        if (language === "mermaid" && diagram++ === 0) parts.push(architectureSvg());
        else parts.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null; language = "";
      }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      parts.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/u);
    if (quote) { flushParagraph(); closeList(); parts.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    const unordered = line.match(/^\s*-\s+(.+)$/u);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/u);
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      if (list !== type) { closeList(); parts.push(`<${type}>`); list = type; }
      parts.push(`<li>${inline((unordered ?? ordered)[1])}</li>`);
      continue;
    }
    if (line.trim() === "") { flushParagraph(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph(); closeList();
  return parts.join("\n");
}

const body = markdownToHtml(fs.readFileSync(input, "utf8"));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 15mm 15mm 17mm; @bottom-right { content: "P2PFlow · " counter(page) " / " counter(pages); color:#60708a; font:9px Arial; } }
*{box-sizing:border-box} body{margin:0;color:#17243a;font:10.7pt/1.48 Arial,Helvetica,sans-serif} h1{margin:0 0 5mm;color:#092a45;font-size:28pt;line-height:1.05;letter-spacing:-.7px;border-bottom:3px solid #20b8a8;padding-bottom:4mm} h2{color:#0c3858;font-size:18pt;line-height:1.15;margin:8mm 0 3mm;break-after:avoid} h3{color:#14516f;font-size:13pt;margin:5mm 0 2mm;break-after:avoid} p{margin:0 0 3.2mm} ul,ol{margin:1mm 0 4mm;padding-left:6mm} li{margin:0 0 1.6mm;break-inside:avoid} blockquote{margin:4mm 0 6mm;padding:4mm 5mm;border-left:4px solid #20b8a8;background:#edf8f7;color:#28425a;font-weight:600} code{font:9.3pt "DejaVu Sans Mono",monospace;background:#edf2f7;border-radius:3px;padding:1px 3px} pre{white-space:pre-wrap;break-inside:avoid;background:#0d1c30;color:#e9f5ff;border-radius:8px;padding:4mm;font:8.5pt/1.45 "DejaVu Sans Mono",monospace;margin:3mm 0 5mm} pre code{background:none;padding:0}.diagram{margin:5mm 0 7mm;break-inside:avoid;background:#071321;border-radius:14px;padding:4mm}.diagram svg{display:block;width:100%;height:auto}.diagram figcaption{color:#b9cbe0;text-align:center;font-size:8.8pt;margin-top:2mm}a{color:#087d74;text-decoration:none}strong{color:#0b304d}h1+p{color:#58708b;font-weight:600}.cover-note{font-size:9pt;color:#60708a}
</style></head><body>${body}</body></html>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: output, format: "A4", printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}

const rendered = fs.readFileSync(output).toString("latin1");
const generatedDates = rendered.match(/D:\d{14}[+-]\d{2}'\d{2}'/gu) ?? [];
if (generatedDates.length !== 2) {
  throw new Error(`Expected exactly two generated PDF timestamps, found ${generatedDates.length}`);
}
fs.writeFileSync(
  output,
  Buffer.from(rendered.replaceAll(/D:\d{14}[+-]\d{2}'\d{2}'/gu, reproduciblePdfDate), "latin1"),
);

if (check) {
  try {
    const expected = fs.readFileSync(canonicalOutput);
    const actual = fs.readFileSync(output);
    if (!expected.equals(actual)) {
      throw new Error("Generated high-level PDF differs from the checked-in canonical artifact");
    }
    const digest = crypto.createHash("sha256").update(expected).digest("hex");
    console.log(`Verified deterministic high-level PDF sha256:${digest}`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
} else {
  console.log(`Generated ${path.relative(root, output)}`);
}
