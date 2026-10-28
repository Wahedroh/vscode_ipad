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
    return `<div class="notice"><h2>ยังไม่มีข้อมูล</h2><p class="muted">ยังไม่มีห้องเรียนในฐานข้อมูล กด "เพิ่มห้อง" เพื่อเริ่ม หรือให้ Claude นำเข้าข้อมูลเทอม 1</p></div>${listView()}`;
  return listView();
}

function listView() {
  const byId = topicsById();
  return L.groupByTeacher(state.classes)
    .map(
      (g) => `<section class="group"><div class="group-head"><h2>${esc(g.teacher)}</h2></div>
      <div class="rows">${g.classes
        .map(
          (c) => `<button class="row" data-class-id="${esc(c.id)}">
          <span class="where">${esc(c.school)} · ${esc(c.room)}</span>
          <span class="meta"><span>จบ: ${esc(L.topicName(byId, c.term1End.topicId))}</span></span>
        </button>`,
        )
        .join("")}</div></section>`,
    )
    .join("");
}

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
      state.classes = snap.docs.map((d) => d.data());
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
