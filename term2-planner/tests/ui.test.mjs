import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { toBatchOps } from "../tools/seed-batch.mjs";
import { CLASS_HEADER, TOPIC_HEADER, SEQUENCE_HEADER, classToRow, topicToRow, sequencesToRows } from "../sheet-format.js";

// Seed data laid out as the Google Sheet the app reads.
function sheetsFrom(seedData) {
  const ops = toBatchOps(seedData, 1);
  const classes = ops.filter((o) => o.path.startsWith("classes/")).map((o) => o.data);
  const byId = Object.fromEntries(seedData.topics.map((t) => [t.id, t]));
  return {
    "ห้องเรียน": [CLASS_HEADER, ...classes.map((c) => classToRow(c, byId, 1))],
    "เรื่อง": [TOPIC_HEADER, ...seedData.topics.map(topicToRow)],
    "ลำดับมาตรฐาน": [SEQUENCE_HEADER, ...sequencesToRows(seedData.sequences, byId)],
  };
}

const { chromium } = createRequire(import.meta.url)("playwright");

// html2canvas is loaded from cdnjs in production; tests serve the same npm release locally.
const vendorDir = fileURLToPath(new URL("./vendor/", import.meta.url));
const html2canvasPath = join(vendorDir, "package/dist/html2canvas.min.js");
const morphdomPath = join(vendorDir, "morphdom/package/dist/morphdom-umd.min.js");
if (!existsSync(morphdomPath)) {
  mkdirSync(join(vendorDir, "morphdom"), { recursive: true });
  execFileSync("npm", ["pack", "morphdom@2.7.4", "--silent", "--pack-destination", vendorDir]);
  execFileSync("tar", ["-xzf", join(vendorDir, "morphdom-2.7.4.tgz"), "-C", join(vendorDir, "morphdom")]);
}
if (!existsSync(html2canvasPath)) {
  mkdirSync(vendorDir, { recursive: true });
  execFileSync("npm", ["pack", "html2canvas@1.4.1", "--silent", "--pack-destination", vendorDir]);
  execFileSync("tar", ["-xzf", join(vendorDir, "html2canvas-1.4.1.tgz"), "-C", vendorDir]);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const seed = JSON.parse(readFileSync(join(root, "seed.json"), "utf8"));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
// Same skeleton the Artifact tool wraps around the page at publish time.
const skeleton = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^\/+/, "");
  try {
    const buf = await readFile(join(root, rel));
    res.writeHead(200, { "content-type": types[extname(rel)] || "application/octet-stream" });
    res.end(rel === "index.html" ? skeleton(buf.toString("utf8")) : buf);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
after(async () => { await browser.close(); server.close(); });

export async function openPage({ seed: withSeed = true, width = 390, init = {}, prepare } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5000);
  await page.route("**/morphdom-umd.min.js", (r) => r.fulfill({ path: morphdomPath, contentType: "text/javascript" }));
  await page.route("**/html2canvas.min.js", (r) => r.fulfill({ path: html2canvasPath, contentType: "text/javascript" }));
  const sheets = withSeed ? sheetsFrom(prepare ? prepare(structuredClone(seed)) : seed) : undefined;
  await page.addInitScript({ content: `window.__mockInit = ${JSON.stringify({ sheets, ...init })};` });
  await page.addInitScript({ path: join(root, "tests/mock-claude.js") });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  page.errors = errors;
  await page.goto(base);
  return page;
}

test("empty db shows ยังไม่มีข้อมูล", async () => {
  const page = await openPage({ seed: false });
  await page.getByText("ยังไม่มีข้อมูล").waitFor();
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("seeded db shows 26 class rows", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  assert.equal(await page.locator("[data-class-id]").count(), 26);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("use(db) null shows เปิดใน claude.ai", async () => {
  const page = await openPage({ init: { mcpNull: true } });
  await page.getByRole("heading", { name: /เปิดใน claude.ai/ }).waitFor();
  await page.close();
});

test("no horizontal scroll at 375px", async () => {
  const page = await openPage({ width: 375 });
  await page.locator("[data-class-id]").first().waitFor();
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= iw, `${sw} > ${iw}`);
  await page.close();
});

test("list groups by teacher", async () => {
  const page = await openPage();
  await page.getByRole("heading", { name: "นิราซฟัน มะแซ" }).waitFor();
  const row = page.locator('[data-class-id="c08"]');
  await row.getByText("ยังไม่จบ").waitFor();
  await row.getByText("เทอม 2: 5 เรื่อง").waitFor();
  await row.getByText("ต้องตรวจ").waitFor();
  await page.close();
});

test("filter ต้องตรวจ shows 20 rows", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.getByRole("button", { name: "ต้องตรวจ", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 20);
  await page.getByRole("button", { name: "พื้นฐาน", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 10);
  await page.close();
});

test("failed save keeps edit and retry succeeds", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => { window.__mock.failNextWrite = true; });
  await page.getByRole("button", { name: "เพิ่มห้อง" }).click();
  await page.getByRole("alert").getByText("บันทึกไม่สำเร็จ").waitFor();
  assert.equal(await page.evaluate(() => [...window.__mock.docs.keys()].filter((k) => k.startsWith("classes/")).length), 26);
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await page.waitForFunction(() => [...window.__mock.docs.keys()].filter((k) => k.startsWith("classes/")).length === 27);
  await page.getByRole("alert").waitFor({ state: "detached" });
  await page.close();
});

const stored = (page, id) => page.evaluate((id) => window.__mock.docs.get("classes/" + id), id);

async function openClass(page, id) {
  await page.locator(`[data-class-id="${id}"]`).click();
  await page.getByRole("dialog").waitFor();
}

test("edit teacher persists", async () => {
  const page = await openPage();
  await openClass(page, "c03");
  const input = page.getByLabel("ครู", { exact: true });
  await input.fill("ฮากีม มะแซ");
  await input.press("Tab");
  await page.waitForFunction(() => window.__mock.docs.get("classes/c03").teacher === "ฮากีม มะแซ");
  await page.getByRole("button", { name: "ปิด" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.close();
});

test("typing survives a background snapshot", async () => {
  const page = await openPage();
  await openClass(page, "c03");
  const input = page.getByLabel("หมายเหตุ");
  await input.fill("กำลังพิมพ์");
  await page.evaluate(() => window.__mock.tick());
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel("หมายเหตุ").inputValue(), "กำลังพิมพ์");
  await page.close();
});

test("set term1 end partial with note", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByRole("button", { name: /รูปเรขา 2 และ 3 มิติ/ }).click();
  await page.getByRole("button", { name: "ยังไม่จบ", exact: true }).click();
  const note = page.getByLabel("หมายเหตุ");
  await note.fill("ถึงปริซึม");
  await note.press("Tab");
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term1End.note === "ถึงปริซึม");
  assert.deepEqual((await stored(page, "c01")).term1End, { topicId: "geometry-2d-3d", status: "partial", note: "ถึงปริซึม" });
  await page.getByRole("button", { name: /สมการ \(1\)/ }).getByText("สอนแล้ว").waitFor();
  await page.close();
});

test("delete class after confirm", async () => {
  const page = await openPage();
  await openClass(page, "c05");
  await page.getByRole("button", { name: "ลบห้องนี้" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await page.waitForFunction(() => !window.__mock.docs.has("classes/c05"));
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 25);
  await page.close();
});

async function openPicker(page) {
  await page.getByRole("button", { name: "เพิ่มเรื่อง" }).click();
  await page.getByRole("dialog", { name: "เลือกเรื่อง" }).waitFor();
  return page.getByRole("dialog", { name: "เลือกเรื่อง" });
}

test("add topic from picker", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /^พหุนาม \(3\)/ }).click();
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term2TopicIds.length === 6);
  assert.equal((await stored(page, "c01")).term2TopicIds.at(-1), "polynomials-3");
  await picker.getByRole("button", { name: /^พหุนาม \(3\)/ }).waitFor();
  assert.equal(await picker.getByRole("button", { name: /^พหุนาม \(3\)/ }).isDisabled(), true);
  await page.close();
});

test("selected topic is disabled in picker and leftovers listed first", async () => {
  const page = await openPage();
  await openClass(page, "c08");
  const picker = await openPicker(page);
  assert.equal(await picker.getByRole("button", { name: /^รูท \(1\)/ }).isDisabled(), true);
  const headings = await picker.getByRole("heading").allTextContents();
  assert.deepEqual(headings.slice(0, 3), ["เลือกเรื่อง", "เทอม 1 ที่ยังไม่ได้สอน", "เทอม 2 มาตรฐาน (เพิ่มเติม)"]);
  await page.close();
});

test("move and remove topic persist order", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByRole("button", { name: "เลื่อนลง: อัตราส่วน สัดส่วนร้อยละ" }).click();
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term2TopicIds[1] === "ratio-percent");
  assert.equal(await page.getByRole("button", { name: "เลื่อนขึ้น: โจทย์ปัญหาสมการตัวแปรเดียว" }).isDisabled(), true);
  await page.getByRole("button", { name: "เอาออก: รูท (1)" }).click();
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term2TopicIds.length === 4);
  assert.deepEqual((await stored(page, "c01")).term2TopicIds, ["linear-word-problems", "ratio-percent", "two-variable-equations", "two-variable-word-problems"]);
  await page.close();
});

test("create new topic from search", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  const picker = await openPicker(page);
  await picker.getByLabel("ค้นหาเรื่อง").fill("สถิติ");
  await picker.getByRole("button", { name: 'เพิ่ม "สถิติ" เป็นเรื่องใหม่' }).click();
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term2TopicIds.length === 6);
  const newId = (await stored(page, "c01")).term2TopicIds.at(-1);
  assert.equal(await page.evaluate((id) => window.__mock.docs.get("topics/" + id)?.name, newId), "สถิติ");
  await page.close();
});

test("copy term2 from another class", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByLabel("คัดลอกเนื้อหาเทอม 2 จากห้อง").selectOption("c04");
  await page.getByRole("alertdialog").getByRole("button", { name: "แทนที่", exact: true }).click();
  await page.waitForFunction(() =>
    JSON.stringify(window.__mock.docs.get("classes/c01").term2TopicIds) === JSON.stringify(window.__mock.docs.get("classes/c04").term2TopicIds));
  await page.close();
});

const blobInfo = (page) =>
  page.evaluate(async () => {
    const src = document.querySelector('[aria-labelledby="preview-title"] img').src;
    const b = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(b);
    return { width: bmp.width, height: bmp.height, type: b.type };
  });

async function openSummary(page) {
  await page.locator("[data-class-id]").first().waitFor();
  await page.getByRole("tab", { name: "สรุป" }).click();
  await page.locator("table.sum").waitFor();
}

test("summary shows every class", async () => {
  const page = await openPage({ width: 1024 });
  await openSummary(page);
  assert.equal(await page.locator("table.sum tbody tr").count(), 26);
  await page.getByText("มี 20 ห้องที่ยังต้องตรวจ").waitFor();
  await page.close();
});

test("png export is 3200px wide", async () => {
  const page = await openPage({ width: 1024 });
  await openSummary(page);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  await page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" }).locator("img").waitFor();
  const info = await blobInfo(page);
  assert.equal(info.width, 3200);
  assert.ok(info.height > 0);
  assert.equal(info.type, "image/png");
  assert.equal(await page.locator("#export-root").count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("png export with 12 topics stays 3200px wide", async () => {
  const many = (s) => { s.classes[0].term2TopicIds = s.topics.slice(0, 12).map((t) => t.id); return s; };
  const page = await openPage({ width: 1024, prepare: many });
  await openSummary(page);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  await page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" }).locator("img").waitFor();
  assert.equal((await blobInfo(page)).width, 3200);
  await page.close();
});

test("download calls downloads.save", async () => {
  const page = await openPage({ width: 1024 });
  await openSummary(page);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  const dlg = page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" });
  await dlg.getByRole("button", { name: "ดาวน์โหลด" }).click();
  await page.waitForFunction(() => window.__mock.saved.length === 1);
  const saved = await page.evaluate(() => window.__mock.saved[0]);
  assert.equal(saved.filename, "term2-2569.png");
  assert.ok(saved.size > 1000);
  await page.close();
});

test("download button hidden when downloads unavailable", async () => {
  const page = await openPage({ width: 1024, init: { downloadsNull: true } });
  await openSummary(page);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  const dlg = page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" });
  await dlg.locator("img").waitFor();
  assert.equal(await dlg.getByRole("button", { name: "ดาวน์โหลด" }).count(), 0);
  await page.close();
});

test("retry after offline topic creation saves both class and topic", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.evaluate(() => { window.__mock.failWrites = 2; });
  const picker = await openPicker(page);
  await picker.getByLabel("ค้นหาเรื่อง").fill("สถิติ");
  await picker.getByRole("button", { name: 'เพิ่ม "สถิติ" เป็นเรื่องใหม่' }).click();
  await page.getByRole("alert").getByText("บันทึกไม่สำเร็จ").waitFor();
  await page.getByRole("button", { name: "ปิดหน้าเลือกเรื่อง" }).click();
  await page.getByRole("button", { name: "ลองใหม่" }).click();
  await page.getByRole("alert").waitFor({ state: "detached" });
  const ids = (await stored(page, "c01")).term2TopicIds;
  assert.equal(ids.length, 6);
  assert.equal(await page.evaluate((id) => window.__mock.docs.get("topics/" + id)?.name, ids.at(-1)), "สถิติ");
  await page.close();
});

test("tap after editing a field lands on its target", async () => {
  const page = await openPage();
  await openClass(page, "c03");
  await page.getByLabel("ครู", { exact: true }).fill("ฮากีม มะแซ");
  await page.getByLabel("โรงเรียน").click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "f-school");
  await page.getByLabel("โรงเรียน").fill("พีระยา 2");
  await page.getByRole("button", { name: "เพิ่มเรื่อง" }).click();
  await page.getByRole("dialog", { name: "เลือกเรื่อง" }).waitFor({ timeout: 1000 });
  await page.waitForFunction(() => window.__mock.docs.get("classes/c03").school === "พีระยา 2");
  await page.close();
});

test("editor keeps scroll position after removing a topic", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByRole("button", { name: "เอาออก: รูท (1)" }).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector(".sheet").scrollTop);
  assert.ok(before > 100, String(before));
  await page.getByRole("button", { name: "เอาออก: รูท (1)" }).click();
  await page.waitForFunction(() => window.__mock.docs.get("classes/c01").term2TopicIds.length === 4);
  const after = await page.evaluate(() => document.querySelector(".sheet").scrollTop);
  assert.ok(after > 100, String(after));
  await page.close();
});

test("mcp use() rejecting shows the open-in-claude notice instead of loading forever", async () => {
  const page = await openPage({ init: { useRejects: true } });
  await page.getByRole("heading", { name: /เปิดใน claude.ai/ }).waitFor();
  await page.close();
});

test("needs_reauth tells the user to reconnect Google Sheets", async () => {
  const page = await openPage({ init: { watchError: "needs_reauth" } });
  await page.getByRole("heading", { name: "เชื่อม Google Sheets ใหม่" }).waitFor();
  await page.getByText("Settings → Connectors").waitFor();
  await page.close();
});

test("server_not_connected tells the user to add Google Sheets", async () => {
  const page = await openPage({ init: { watchError: "server_not_connected" } });
  await page.getByRole("heading", { name: "ยังไม่ได้เชื่อม Google Sheets" }).waitFor();
  await page.close();
});

test("approval_required offers a button that loads the sheet", async () => {
  const page = await openPage({ init: { watchError: "approval_required" } });
  await page.getByRole("button", { name: "อนุญาตให้ใช้ Google Sheets" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 26);
  await page.close();
});

test("transient sheet error keeps the data and says it is stale", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => { window.__mock.watchError = "server_unavailable"; window.__mock.tick(); });
  await page.getByText("อัปเดตจาก Google Sheets ไม่ได้ชั่วคราว").waitFor();
  assert.equal(await page.locator("[data-class-id]").count(), 26);
  await page.close();
});

test("an edit made in the sheet shows up after the next refresh", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => { window.__mock.setCell("ห้องเรียน", 2, 1, "ครูใหม่"); window.__mock.tick(); });
  await page.getByRole("heading", { name: "ครูใหม่" }).waitFor();
  await page.close();
});

test("refresh button re-reads the sheet", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => window.__mock.setCell("ห้องเรียน", 1, 2, "บ้านตาลใหม่"));
  await page.getByRole("button", { name: "รีเฟรช" }).click();
  await page.getByText("บ้านตาลใหม่ · ม.1").waitFor();
  await page.close();
});

test("save finds the row by id even after rows were reordered in the sheet", async () => {
  const page = await openPage();
  await openClass(page, "c03");
  await page.evaluate(() => { const t = window.__mock.tabs.get("ห้องเรียน"); [t[1], t[3]] = [t[3], t[1]]; });
  const input = page.getByLabel("ครู", { exact: true });
  await input.fill("ครูย้ายแถว");
  await input.press("Tab");
  await page.waitForFunction(() => window.__mock.docs.get("classes/c03").teacher === "ครูย้ายแถว");
  assert.equal((await stored(page, "c01")).teacher, "นิราซฟัน มะแซ");
  assert.equal(await page.evaluate(() => window.__mock.tabs.get("ห้องเรียน")[1][0]), "c03");
  await page.close();
});

test("deleting a class clears its row in the sheet", async () => {
  const page = await openPage();
  await openClass(page, "c05");
  await page.getByRole("button", { name: "ลบห้องนี้" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await page.waitForFunction(() => !window.__mock.docs.has("classes/c05"));
  assert.deepEqual(await page.evaluate(() => window.__mock.tabs.get("ห้องเรียน")[5].filter(Boolean)), []);
  await page.close();
});

test("a sparse row typed into the sheet does not blank the page", async () => {
  const page = await openPage();
  await page.locator("[data-class-id]").first().waitFor();
  await page.evaluate(() => {
    window.__mock.setCell("ห้องเรียน", 27, 0, "c99");
    window.__mock.setCell("ห้องเรียน", 27, 2, "แปลก");
    window.__mock.setCell("ห้องเรียน", 27, 4, "ไม่มีประเภทนี้");
    window.__mock.tick();
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-class-id]").length === 27);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("closing the picker returns focus to its opener", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByRole("button", { name: "เพิ่มเรื่อง" }).click();
  await page.getByRole("dialog", { name: "เลือกเรื่อง" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "เลือกเรื่อง" }).waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "open-picker");
  await page.close();
});

test("tab stays inside the open dialog", async () => {
  const page = await openPage();
  await openClass(page, "c01");
  await page.getByRole("button", { name: "เพิ่มเรื่อง" }).click();
  await page.getByRole("dialog", { name: "เลือกเรื่อง" }).waitFor();
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[aria-labelledby="picker-title"]')), true);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[aria-labelledby="picker-title"]')), true);
  await page.close();
});

test("export waits for fonts after the export surface exists", async () => {
  const page = await openPage({ width: 1024 });
  await page.evaluate(() => {
    Object.defineProperty(document.fonts, "ready", {
      configurable: true,
      get() { window.__rootWhenFontsAwaited = !!document.getElementById("export-root"); return Promise.resolve(document.fonts); },
    });
  });
  await openSummary(page);
  await page.getByRole("button", { name: "บันทึกเป็น PNG" }).click();
  await page.getByRole("dialog", { name: "ภาพสรุปเทอม 2" }).locator("img").waitFor();
  assert.equal(await page.evaluate(() => window.__rootWhenFontsAwaited), true);
  await page.close();
});
