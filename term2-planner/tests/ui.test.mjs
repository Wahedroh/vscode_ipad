import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { toBatchOps } from "../tools/seed-batch.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
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
  const ops = withSeed ? toBatchOps(prepare ? prepare(structuredClone(seed)) : seed, 1) : [];
  await page.addInitScript({ content: `window.__mockInit = ${JSON.stringify({ ops, ...init })};` });
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
  const page = await openPage({ init: { dbNull: true } });
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
  await page.evaluate(() => window.__mock.docs.set("topics/x", { id: "x", name: "x", details: [] }));
  await page.evaluate(() => window.claude.use("db").then((db) => db.doc("topics/y").set({ id: "y", name: "y", details: [] })));
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
