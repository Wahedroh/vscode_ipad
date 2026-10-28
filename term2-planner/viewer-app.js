// Read-only page for teachers, served by the sheet's Apps Script web app (apps-script/Code.gs).
// Bundled into viewer/index.html by tools/build-viewer.mjs; data comes from google.script.run.getData().
import * as L from "./logic.js";
import * as F from "./sheet-format.js";
import { esc, summaryTableHtml, exportPng } from "./summary.js";

const POLL_MS = 30000;
const state = {
  status: "loading", // loading | ready | error
  stale: false,
  updatedAt: null,
  classes: [],
  topics: [],
  view: "list",
  filter: "all",
  exporting: false,
  preview: null, // {url}
  notice: "",
};
const app = document.getElementById("app");
const topicsById = () => Object.fromEntries(state.topics.map((t) => [t.id, t]));
const FILTERS = [["all", "ทั้งหมด"], ...L.COURSE_TYPES.map((t) => [t, t])];
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>`;

function load() {
  google.script.run.withSuccessHandler(apply).withFailureHandler(failed).getData();
}

function apply(data) {
  const topics = F.rowsToTopics(data.topics || []);
  state.topics = topics;
  state.classes = F.rowsToClasses(data.classes || [], topics);
  state.status = "ready";
  state.stale = false;
  state.updatedAt = new Date();
  render();
}

function failed(e) {
  console.error("getData", e);
  if (state.status === "ready") state.stale = true;
  else state.status = "error";
  render();
}

function header() {
  const tab = (key, label) =>
    `<button class="tab" role="tab" data-action="view" data-view="${key}" aria-selected="${state.view === key}">${label}</button>`;
  const when = state.updatedAt ? ` · อัปเดต ${state.updatedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : "";
  return `<header class="top">
    <div><h1>เนื้อหาคณิตศาสตร์เทอม 2</h1><p class="muted small">ปีการศึกษา 2569 · ม.1 · ดูอย่างเดียว${when}</p></div>
    <div class="top-actions">${state.status === "ready" ? `<button class="btn" data-action="refresh">${ICON_REFRESH}รีเฟรช</button>` : ""}
    <div class="tabs" role="tablist">${tab("list", "ห้องเรียน")}${tab("summary", "สรุป")}</div></div>
  </header>`;
}

function listView() {
  const byId = topicsById();
  const chips = FILTERS.map(
    ([key, label]) => `<button class="chip" data-action="filter" data-filter="${esc(key)}" aria-pressed="${state.filter === key}">${label}</button>`,
  ).join("");
  const groups = L.groupByTeacher(L.filterClasses(state.classes, state.filter))
    .map(
      (g) => `<section class="group"><div class="group-head"><h2>${esc(g.teacher)}</h2><span class="muted small">${g.classes.length} ห้อง</span></div>
      <div class="rows">${g.classes
        .map((c) => {
          const end = esc(L.topicName(byId, c.term1End.topicId)) + (c.term1End.status === "partial" ? ` <span class="pill">ยังไม่จบ</span>` : "");
          const t2 = c.term2TopicIds.map((id, k) => `<span><b>${k + 1}.</b>${esc(L.topicName(byId, id))}</span>`).join("");
          return `<div class="row view-row" data-class-id="${esc(c.id)}">
            <span class="where">${esc(c.school)} · ${esc(c.room)} <span class="muted small">· ${esc(c.courseType)}</span></span>
            <span class="meta"><span>จบเทอม 1: ${end}</span>${c.term1End.note ? `<span>${esc(c.term1End.note)}</span>` : ""}</span>
            <div class="t2"><span class="label">เทอม 2</span><div class="topics">${t2 || `<span class="muted">ยังไม่ได้กำหนด</span>`}</div></div>
          </div>`;
        })
        .join("")}</div></section>`,
    )
    .join("");
  return `<div class="chips" role="group" aria-label="กรองห้อง">${chips}</div>${groups || `<p class="empty">ไม่มีห้องที่ตรงกับตัวกรองนี้</p>`}`;
}

function summaryView() {
  return `<div class="toolbar"><p class="muted small" style="margin:0">${state.classes.length} ห้อง</p>
      <button class="btn primary" data-action="export" ${state.exporting ? "disabled" : ""}>${state.exporting ? "กำลังสร้างภาพ…" : "บันทึกเป็น PNG"}</button></div>
    ${state.notice ? `<div class="alert" role="status"><span>${esc(state.notice)}</span></div>` : ""}
    ${summaryTableHtml(state.classes, topicsById())}`;
}

function previewView() {
  if (!state.preview) return "";
  return `<div class="dialog-backdrop" data-action="close-preview"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
    <div class="sheet-head" style="margin:0"><h2 id="preview-title">ภาพสรุปเทอม 2</h2>
      <button class="btn icon-btn" data-action="close-preview" aria-label="ปิดภาพ">${ICON_X}</button></div>
    <p class="muted small" style="margin:0">แตะค้างที่ภาพ (หรือคลิกขวา) เพื่อบันทึกภาพ</p>
    <div class="dialog-body"><img class="preview-img" src="${state.preview.url}" alt="ตารางสรุปเนื้อหาเทอม 2 รายครู"></div>
  </div>`;
}

function body() {
  if (state.status === "loading") return `<p class="muted">กำลังโหลดข้อมูล…</p>`;
  if (state.status === "error")
    return `<div class="notice"><h2>โหลดข้อมูลไม่ได้</h2><p class="muted">ตรวจสัญญาณอินเทอร์เน็ต แล้วลองใหม่อีกครั้ง</p>
      <div class="toolbar" style="justify-content:flex-start"><button class="btn" data-action="retry">ลองใหม่</button></div></div>`;
  const stale = state.stale ? `<div class="alert" role="status"><span>อัปเดตข้อมูลไม่ได้ชั่วคราว ข้อมูลที่เห็นอาจไม่ใช่ล่าสุด</span></div>` : "";
  return stale + (state.view === "summary" ? summaryView() : listView());
}

function render() {
  app.innerHTML = header() + body() + previewView();
}

async function startExport() {
  state.exporting = true;
  state.notice = "";
  render();
  try {
    if (typeof window.html2canvas !== "function") throw new Error("html2canvas not loaded");
    const blob = await exportPng(state.classes, topicsById());
    state.preview = { url: URL.createObjectURL(blob) };
  } catch (e) {
    console.error("export", e);
    state.notice = "สร้างภาพไม่สำเร็จ ลองโหลดหน้านี้ใหม่แล้วกดอีกครั้ง";
  } finally {
    state.exporting = false;
    render();
  }
}

function closePreview() {
  if (state.preview) URL.revokeObjectURL(state.preview.url);
  state.preview = null;
  render();
}

app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "view") { state.view = el.dataset.view; render(); }
  else if (a === "filter") { state.filter = el.dataset.filter; render(); }
  else if (a === "refresh") load();
  else if (a === "retry") { state.status = "loading"; render(); load(); }
  else if (a === "export") startExport();
  else if (a === "close-preview") closePreview();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && state.preview) closePreview(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.status === "ready") load(); });
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);

render();
load();
