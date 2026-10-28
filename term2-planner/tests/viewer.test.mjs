import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildViewer } from "../tools/build-viewer.mjs";
import { toBatchOps } from "../tools/seed-batch.mjs";
import { CLASS_HEADER, TOPIC_HEADER, SEQUENCE_HEADER, classToRow, topicToRow, sequencesToRows } from "../sheet-format.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const vendor = join(root, "tests/vendor/package/dist/html2canvas.min.js");
const seed = JSON.parse(readFileSync(join(root, "seed.json"), "utf8"));

// The three tabs as Apps Script's getDisplayValues() returns them: strings, header row included.
function tabs() {
  const classes = toBatchOps(seed, 1).filter((o) => o.path.startsWith("classes/")).map((o) => o.data);
  const byId = Object.fromEntries(seed.topics.map((t) => [t.id, t]));
  const str = (rows) => rows.map((r) => r.map((v) => (v === true ? "TRUE" : v === false ? "FALSE" : String(v))));
  return {
    "ห้องเรียน": str([CLASS_HEADER, ...classes.map((c) => classToRow(c, byId, 1))]),
    "เรื่อง": str([TOPIC_HEADER, ...seed.topics.map(topicToRow)]),
    "ลำดับมาตรฐาน": str([SEQUENCE_HEADER, ...sequencesToRows(seed.sequences, byId)]),
  };
}

const server = createServer(async (req, res) => {
  try {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(join(root, "viewer/index.html")));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
after(async () => { await browser.close(); server.close(); });

// Stand-in for google.script.run, answering getData() from in-memory tabs.
const mockRun = (fail) => `
  window.__tabs = ${JSON.stringify(tabs())};
  window.__fail = ${JSON.stringify(fail || null)};
  window.__calls = 0;
  const make = (ok, ko) => ({
    withSuccessHandler: (f) => make(f, ko),
    withFailureHandler: (f) => make(ok, f),
    getData: () => setTimeout(() => {
      window.__calls++;
      if (window.__fail) return ko && ko(new Error(window.__fail));
      const t = window.__tabs;
      ok({ classes: t["ห้องเรียน"].slice(1), topics: t["เรื่อง"].slice(1), sequences: t["ลำดับมาตรฐาน"].slice(1) });
    }, 5),
  });
  window.google = { script: { run: make() } };`;

async function openViewer({ width = 390, fail } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5000);
  if (existsSync(vendor)) await page.route("**/html2canvas.min.js", (r) => r.fulfill({ path: vendor, contentType: "text/javascript" }));
  await page.route("**/morphdom-umd.min.js", (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  await page.addInitScript({ content: mockRun(fail) });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e));
  await page.goto(base);
  return page;
}

test("committed viewer/index.html matches the build output", () => {
  assert.equal(readFileSync(join(root, "viewer/index.html"), "utf8"), buildViewer());
});

test("viewer lists every class grouped by teacher, read-only", async () => {
  const page = await openViewer();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 26);
  await page.getByRole("heading", { name: "นิราซฟัน มะแซ" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "เพิ่มห้อง" }).count(), 0);
  assert.equal(await page.locator('[data-action="edit"], input, select').count(), 0);
  const row = page.locator('[data-class-id="c01"]');
  await row.getByText("รูท (1)").waitFor();
  await row.getByText("สมการ (1)").waitFor();
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("viewer filter chips narrow the list", async () => {
  const page = await openViewer();
  await page.locator("[data-class-id]").first().waitFor();
  await page.getByRole("button", { name: "พื้นฐาน", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 10);
  await page.close();
});

test("refresh picks up changes made in the sheet", async () => {
  const page = await openViewer();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => { window.__tabs["ห้องเรียน"][1][1] = "ครูใหม่"; });
  await page.getByRole("button", { name: "รีเฟรช" }).click();
  await page.getByRole("heading", { name: "ครูใหม่" }).waitFor();
  await page.close();
});

test("load failure explains and offers retry", async () => {
  const page = await openViewer({ fail: "boom" });
  await page.getByRole("heading", { name: "โหลดข้อมูลไม่ได้" }).waitFor();
  await page.evaluate(() => { window.__fail = null; });
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 26);
  await page.close();
});

test("viewer summary exports a 3200px PNG", async () => {
  const page = await openViewer({ width: 1024 });
  await page.locator("[data-class-id]").first().waitFor();
  await page.getByRole("tab", { name: "สรุป" }).click();
  assert.equal(await page.locator("table.sum tbody tr").count(), 26);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  const img = page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" }).locator("img");
  await img.waitFor();
  const width = await page.evaluate(async () => {
    const b = await (await fetch(document.querySelector('[aria-labelledby="preview-title"] img').src)).blob();
    return (await createImageBitmap(b)).width;
  });
  assert.equal(width, 3200);
  await page.close();
});

test("no horizontal scroll at 375px", async () => {
  const page = await openViewer({ width: 375 });
  await page.locator("[data-class-id]").first().waitFor();
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= iw, `${sw} > ${iw}`);
  await page.close();
});

test("Code.gs getData returns the three tabs without headers", () => {
  const src = readFileSync(join(root, "apps-script/Code.gs"), "utf8");
  const t = tabs();
  const sheet = (name) => (t[name] ? { getDataRange: () => ({ getDisplayValues: () => t[name] }) } : null);
  const ctx = { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: sheet }) } };
  vm.runInNewContext(src, ctx);
  const data = ctx.getData();
  assert.equal(data.classes.length, 26);
  assert.equal(data.classes[0][0], "c01");
  assert.equal(data.topics.length, 24);
  assert.equal(data.sequences.length, 6);
});

test("Code.gs doGet serves the page fetched from GitHub and caches it", () => {
  const src = readFileSync(join(root, "apps-script/Code.gs"), "utf8");
  const fetched = [];
  const cache = new Map();
  const out = { setTitle() { return out; }, addMetaTag() { return out; }, setXFrameOptionsMode() { return out; } };
  const ctx = {
    UrlFetchApp: { fetch: (url) => { fetched.push(url); return { getContentText: () => "<p>page</p>", getResponseCode: () => 200 }; } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    HtmlService: { createHtmlOutput: (html) => { out.html = html; return out; }, XFrameOptionsMode: { ALLOWALL: "ALLOWALL" } },
  };
  vm.runInNewContext(src, ctx);
  ctx.doGet();
  ctx.doGet();
  assert.equal(out.html, "<p>page</p>");
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /^https:\/\/raw\.githubusercontent\.com\/Wahedroh\/vscode_ipad\/main\/term2-planner\/viewer\/index\.html$/);
});
