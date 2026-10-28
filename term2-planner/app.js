import * as L from "./logic.js";

const state = {
  status: "loading", // loading | ready | nodb
  loaded: { classes: false, topics: false, config: false },
  classes: [],
  topics: [],
  sequences: {},
  view: "list",
  filter: "all",
  editingId: null,
  saveError: null,
};

// Edits not yet confirmed by the store; overlaid on every snapshot so a failed save never drops them.
const unsaved = new Map();
// Per-document write queue: one write in flight per class, latest value wins.
const queues = new Map();

let db = null;
const app = document.getElementById("app");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const topicsById = () => Object.fromEntries(state.topics.map((t) => [t.id, t]));

function header() {
  const tab = (key, label) =>
    `<button class="tab" role="tab" data-action="view" data-view="${key}" aria-selected="${state.view === key}">${label}</button>`;
  return `<header class="top">
    <div><h1>เนื้อหาคณิตศาสตร์เทอม 2</h1><p class="muted small">ปีการศึกษา 2569 · ม.1</p></div>
    <div class="tabs" role="tablist">${tab("list", "ห้องเรียน")}${tab("summary", "สรุป")}</div>
  </header>`;
}

function body() {
  if (state.status === "nodb")
    return `<div class="notice"><h2>เปิดใน claude.ai เพื่อใช้งาน</h2><p class="muted">หน้านี้เก็บข้อมูลในฐานข้อมูลของ Artifact ซึ่งใช้ได้เมื่อเปิดใน claude.ai และลงชื่อเข้าใช้แล้ว</p></div>`;
  if (state.status === "loading") return `<p class="muted">กำลังโหลด…</p>`;
  if (state.classes.length === 0)
    return saveAlert() + `<div class="notice"><h2>ยังไม่มีข้อมูล</h2><p class="muted">ยังไม่มีห้องเรียนในฐานข้อมูล กด "เพิ่มห้อง" เพื่อเริ่ม หรือให้ Claude นำเข้าข้อมูลเทอม 1</p></div>${listView()}`;
  return saveAlert() + listView();
}

const FILTERS = [["all", "ทั้งหมด"], ["review", "ต้องตรวจ"], ...L.COURSE_TYPES.map((t) => [t, t])];
const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

function saveAlert() {
  if (!state.saveError) return "";
  return `<div class="alert" role="alert"><span>บันทึกไม่สำเร็จ การแก้ไขยังอยู่ในหน้านี้ ลองบันทึกอีกครั้ง</span>
    <button class="btn" data-action="retry">ลองใหม่</button></div>`;
}

function term1Label(byId, end) {
  const name = L.topicName(byId, end.topicId);
  return end.status === "partial" ? `${esc(name)} <span class="pill">ยังไม่จบ</span>` : esc(name);
}

function listView() {
  const byId = topicsById();
  const shown = L.filterClasses(state.classes, state.filter);
  const chips = FILTERS.map(
    ([key, label]) => `<button class="chip" data-action="filter" data-filter="${esc(key)}" aria-pressed="${state.filter === key}">${label}</button>`,
  ).join("");
  const groups = L.groupByTeacher(shown)
    .map(
      (g) => `<section class="group"><div class="group-head"><h2>${esc(g.teacher)}</h2><span class="muted small">${g.classes.length} ห้อง</span></div>
      <div class="rows">${g.classes
        .map(
          (c) => `<button class="row" data-action="edit" data-class-id="${esc(c.id)}">
          <span class="where">${esc(c.school)} · ${esc(c.room)} <span class="muted small">· ${esc(c.courseType)}</span></span>
          ${c.needsReview ? `<span class="tag">ต้องตรวจ</span>` : "<span></span>"}
          <span class="meta"><span>จบ: ${term1Label(byId, c.term1End)}</span><span>เทอม 2: ${c.term2TopicIds.length} เรื่อง</span></span>
        </button>`,
        )
        .join("")}</div></section>`,
    )
    .join("");
  return `<div class="toolbar"><div class="chips" role="group" aria-label="กรองห้อง">${chips}</div>
    <button class="btn primary" data-action="add-class">${ICON_PLUS}เพิ่มห้อง</button></div>
    ${groups || `<p class="empty">ไม่มีห้องที่ตรงกับตัวกรองนี้</p>`}`;
}

function upsertLocal(cls) {
  const i = state.classes.findIndex((c) => c.id === cls.id);
  if (i < 0) state.classes = [...state.classes, cls];
  else state.classes = state.classes.map((c) => (c.id === cls.id ? cls : c));
}

async function saveClass(cls) {
  const rec = { ...cls, updatedAt: Date.now() };
  unsaved.set(rec.id, rec);
  upsertLocal(rec);
  render();
  const q = queues.get(rec.id) ?? { running: false, next: null };
  queues.set(rec.id, q);
  q.next = rec;
  if (q.running) return;
  q.running = true;
  try {
    while (q.next) {
      const r = q.next;
      q.next = null;
      await db.doc("classes/" + r.id).set(r);
      if (unsaved.get(r.id) === r) unsaved.delete(r.id);
    }
    if (unsaved.size === 0) state.saveError = null;
  } catch (e) {
    console.error("save", e);
    q.next = null;
    state.saveError = { retry: () => Promise.all([...unsaved.values()].map(saveClass)) };
  } finally {
    q.running = false;
    render();
  }
}

function newClassId() {
  const ids = new Set(state.classes.map((c) => c.id));
  let n = state.classes.length + 1;
  while (ids.has("c" + String(n).padStart(2, "0"))) n++;
  return "c" + String(n).padStart(2, "0");
}

function addClass() {
  const cls = {
    id: newClassId(), teacher: "", school: "", room: "ม.1", grade: "ม.1", courseType: "เพิ่มเติม",
    term1End: { topicId: "", status: "done", note: "" }, term2TopicIds: [], needsReview: true, updatedAt: 0,
  };
  state.editingId = cls.id;
  saveClass(cls);
}

function openEditor(id) {
  state.editingId = id;
  render();
}

app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "view") { state.view = el.dataset.view; render(); }
  else if (a === "filter") { state.filter = el.dataset.filter; render(); }
  else if (a === "add-class") addClass();
  else if (a === "edit") openEditor(el.dataset.classId);
  else if (a === "retry") state.saveError?.retry();
});

function render() {
  app.innerHTML = header() + body();
}

function markLoaded(key) {
  state.loaded[key] = true;
  if (Object.values(state.loaded).every(Boolean)) state.status = "ready";
  render();
}

async function boot() {
  render();
  db = (await window.claude?.use?.("db")) ?? null;
  if (!db) {
    state.status = "nodb";
    return render();
  }
  db.collection("classes").onSnapshot(
    (snap) => {
      const stored = snap.docs.map((d) => d.data());
      const ids = new Set(stored.map((c) => c.id));
      state.classes = [...stored.map((c) => unsaved.get(c.id) ?? c), ...[...unsaved.values()].filter((c) => !ids.has(c.id))];
      markLoaded("classes");
    },
    (e) => console.error("classes", e),
  );
  db.collection("topics").onSnapshot(
    (snap) => {
      state.topics = snap.docs.map((d) => d.data());
      markLoaded("topics");
    },
    (e) => console.error("topics", e),
  );
  db.doc("meta/config").onSnapshot(
    (snap) => {
      state.sequences = snap.exists ? snap.data().sequences ?? {} : {};
      markLoaded("config");
    },
    (e) => console.error("config", e),
  );
}

boot();
