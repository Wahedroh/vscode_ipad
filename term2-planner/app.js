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
  confirm: null, // {title, text, ok, run}
  picker: null, // {query}
  exporting: false,
  preview: null, // {url, blob}
  notice: "",
  saveError: null,
};

// Edits not yet confirmed by the store; overlaid on every snapshot so a failed save never drops them.
const unsaved = new Map();
// Per-document write queue: one write in flight per class, latest value wins.
const queues = new Map();

let db = null;
let downloads = null;
const EXPORT_TITLE = "เนื้อหาคณิตศาสตร์เทอม 2 ปีการศึกษา 2569";
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
  return saveAlert() + (state.view === "summary" ? summaryView() : listView());
}

function summaryTable() {
  const byId = topicsById();
  const rows = L.groupByTeacher(state.classes)
    .flatMap((g) =>
      g.classes.map((c, i) => {
        const end = L.topicName(byId, c.term1End.topicId);
        const topics = c.term2TopicIds.map((id, k) => `<span><b>${k + 1}.</b>${esc(L.topicName(byId, id))}</span>`).join("");
        return `<tr class="${i === 0 ? "first" : ""}">
          <td class="teacher">${i === 0 ? esc(g.teacher) : ""}</td>
          <td>${esc(c.school)} · ${esc(c.room)}</td><td>${esc(c.courseType)}</td>
          <td>${esc(end)}${c.term1End.status === "partial" ? ` <span class="nowrap">(ยังไม่จบ)</span>` : ""}${c.term1End.note ? `<div class="muted small">${esc(c.term1End.note)}</div>` : ""}</td>
          <td><div class="topics">${topics || `<span class="muted">ยังไม่ได้เลือก</span>`}</div></td></tr>`;
      }),
    )
    .join("");
  return `<div class="table-wrap"><table class="sum">
    <thead><tr><th>ครู</th><th>โรงเรียน · ห้อง</th><th>ประเภท</th><th>จบเทอม 1</th><th>เนื้อหาเทอม 2</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function summaryView() {
  const pending = state.classes.filter((c) => c.needsReview || !c.teacher.trim()).length;
  return `${pending ? `<div class="alert"><span>มี ${pending} ห้องที่ยังต้องตรวจ ดูได้จากตัวกรอง "ต้องตรวจ" ในแท็บห้องเรียน</span></div>` : ""}
    <div class="toolbar"><p class="muted small" style="margin:0">${state.classes.length} ห้อง · ${L.groupByTeacher(state.classes).length} กลุ่มครู</p>
      <button class="btn primary" data-action="export" ${state.exporting ? "disabled" : ""}>${state.exporting ? "กำลังสร้างภาพ…" : "บันทึกเป็น PNG"}</button></div>
    ${state.notice ? `<div class="alert" role="status"><span>${esc(state.notice)}</span></div>` : ""}
    ${summaryTable()}`;
}

async function exportPng() {
  await document.fonts.ready;
  const root = document.createElement("div");
  root.id = "export-root";
  root.innerHTML = `<div class="export-head"><h1>${EXPORT_TITLE}</h1><span>ข้อมูล ณ ${new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}</span></div>${summaryTable()}`;
  document.body.appendChild(root);
  try {
    const canvas = await window.html2canvas(root, { scale: 2, backgroundColor: "#FFFFFF", logging: false });
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
  } finally {
    root.remove();
  }
}

async function startExport() {
  state.exporting = true;
  state.notice = "";
  render();
  try {
    if (typeof window.html2canvas !== "function") throw new Error("html2canvas not loaded");
    const blob = await exportPng();
    state.preview = { blob, url: URL.createObjectURL(blob) };
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

async function savePng() {
  try {
    await downloads.save({ filename: "term2-2569.png", data: state.preview.blob });
  } catch (e) {
    if (e?.code === "declined") return;
    console.error("download", e);
    state.notice = "บันทึกไฟล์ไม่สำเร็จ ลองแตะค้างที่ภาพเพื่อบันทึกแทน";
    closePreview();
  }
}

function previewView() {
  const p = state.preview;
  if (!p) return "";
  return `<div class="dialog-backdrop" data-action="close-preview"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
    <div class="sheet-head" style="margin:0"><h2 id="preview-title">ภาพสรุปเทอม 2</h2>
      <button class="btn icon-btn" data-action="close-preview" aria-label="ปิดภาพ">${ICON_X}</button></div>
    <p class="muted small" style="margin:0">แตะค้างที่ภาพเพื่อบันทึกลงรูปภาพ</p>
    <div class="dialog-body"><img class="preview-img" src="${p.url}" alt="ตารางสรุปเนื้อหาเทอม 2 รายครู"></div>
    ${downloads ? `<div class="toolbar" style="justify-content:flex-end"><button class="btn primary" data-action="download">ดาวน์โหลด</button></div>` : ""}
  </div>`;
}

const FILTERS = [["all", "ทั้งหมด"], ["review", "ต้องตรวจ"], ...L.COURSE_TYPES.map((t) => [t, t])];
const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

function saveAlert(inEditor = false) {
  if (!state.saveError || Boolean(editing()) !== inEditor) return "";
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
  document.getElementById("editor-close")?.focus();
}

function closeEditor() {
  const id = state.editingId;
  state.editingId = null;
  render();
  document.querySelector(`[data-class-id="${CSS.escape(id ?? "")}"]`)?.focus();
}

const editing = () => state.classes.find((c) => c.id === state.editingId);
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;
const STATE_LABEL = { done: "สอนแล้ว", end: "จบที่นี่", partial: "จบกลางเรื่อง", untaught: "ยังไม่ได้สอน" };

function infoSection(c) {
  const teachers = [...new Set(state.classes.map((x) => x.teacher.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  const types = L.COURSE_TYPES.map((t) => `<option ${t === c.courseType ? "selected" : ""}>${t}</option>`).join("");
  return `<section class="section"><h3>ข้อมูลห้อง</h3>
    <div class="field"><label for="f-teacher">ครู</label>
      <input class="input" id="f-teacher" list="teacher-list" data-field="teacher" value="${esc(c.teacher)}" autocomplete="off" placeholder="พิมพ์หรือเลือกชื่อครู">
      <datalist id="teacher-list">${teachers.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist></div>
    <div class="grid2">
      <div class="field"><label for="f-school">โรงเรียน</label><input class="input" id="f-school" data-field="school" value="${esc(c.school)}"></div>
      <div class="field"><label for="f-room">ห้อง</label><input class="input" id="f-room" data-field="room" value="${esc(c.room)}"></div>
    </div>
    <div class="field"><label for="f-type">ประเภทวิชา</label><select class="input" id="f-type" data-field="courseType">${types}</select></div>
    <label class="switch"><input type="checkbox" id="f-review" data-field="needsReview" ${c.needsReview ? "checked" : ""}> ต้องตรวจ (ยังไม่แน่ใจข้อมูลห้องนี้)</label>
  </section>`;
}

function term1Section(c) {
  const byId = topicsById();
  const seq = state.sequences[c.courseType]?.["1"] ?? [];
  const rows = L.term1Rows(seq, c.term1End);
  const steps = rows
    .map(
      (r) => `<li><button class="step" data-action="term1-topic" data-topic="${esc(r.topicId)}" data-state="${r.state}" aria-pressed="${r.topicId === c.term1End.topicId}">
        <span class="mark">${r.state === "done" || r.state === "end" ? ICON_CHECK : ""}</span>
        <span>${esc(L.topicName(byId, r.topicId))}</span><span class="state">${STATE_LABEL[r.state]}</span></button></li>`,
    )
    .join("");
  const seg = (v, label) => `<button data-action="term1-status" data-status="${v}" aria-pressed="${c.term1End.status === v}">${label}</button>`;
  return `<section class="section"><h3>จบเทอม 1 ที่</h3>
    <p class="muted small">แตะเรื่องสุดท้ายที่ห้องนี้สอนถึง</p>
    <ol class="steps">${steps || `<li class="empty">ยังไม่มีลำดับเนื้อหาเทอม 1 ของวิชา${esc(c.courseType)}</li>`}</ol>
    <div class="seg" role="group" aria-label="สถานะเรื่องสุดท้าย">${seg("done", "จบแล้ว")}${seg("partial", "ยังไม่จบ")}</div>
    <div class="field"><label for="f-note">หมายเหตุ</label><input class="input" id="f-note" data-field="note" value="${esc(c.term1End.note)}" placeholder="เช่น ถึงหารพหุนาม"></div>
  </section>`;
}

const ICON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`;

function term2Section(c) {
  const byId = topicsById();
  const n = c.term2TopicIds.length;
  const items = c.term2TopicIds
    .map((id, i) => {
      const name = esc(L.topicName(byId, id));
      return `<li><span class="n">${i + 1}.</span><span class="name">${name}</span>
        <button class="btn icon-btn" data-action="t2-move" data-index="${i}" data-delta="-1" aria-label="เลื่อนขึ้น: ${name}" ${i === 0 ? "disabled" : ""}>${ICON_UP}</button>
        <button class="btn icon-btn" data-action="t2-move" data-index="${i}" data-delta="1" aria-label="เลื่อนลง: ${name}" ${i === n - 1 ? "disabled" : ""}>${ICON_DOWN}</button>
        <button class="btn icon-btn" data-action="t2-remove" data-index="${i}" aria-label="เอาออก: ${name}">${ICON_X}</button></li>`;
    })
    .join("");
  const others = state.classes
    .filter((x) => x.id !== c.id)
    .sort((a, b) => (a.teacher || "~").localeCompare(b.teacher || "~", "th") || a.school.localeCompare(b.school, "th"))
    .map((x) => `<option value="${esc(x.id)}">${esc(x.teacher || "ยังไม่ระบุครู")} — ${esc(x.school)} ${esc(x.room)} (${x.term2TopicIds.length} เรื่อง)</option>`)
    .join("");
  return `<section class="section"><h3>เนื้อหาเทอม 2</h3>
    <ol class="order">${items || `<li class="empty">ยังไม่ได้เลือกเรื่อง</li>`}</ol>
    <button class="btn primary" data-action="open-picker">${ICON_PLUS}เพิ่มเรื่อง</button>
    <div class="field"><label for="f-copy">คัดลอกเนื้อหาเทอม 2 จากห้อง</label>
      <select class="input" id="f-copy" data-copy><option value="">เลือกห้อง…</option>${others}</select></div>
  </section>`;
}

function pickerView() {
  const c = editing();
  if (!state.picker || !c) return "";
  const q = state.picker.query;
  const groups = L.pickerGroups(c, state.sequences, state.topics, q);
  const byId = topicsById();
  const body = groups
    .map(
      (g) => `<div class="pick-group"><h3 class="label">${esc(g.title)}</h3>${g.items
        .map((it) => {
          const d = byId[it.id]?.details ?? [];
          return `<button class="pick" data-action="pick" data-topic="${esc(it.id)}" ${it.selected ? "disabled" : ""}>
            <span>${esc(it.name)}${it.selected ? ` <span class="muted small">· เลือกแล้ว</span>` : ""}</span>
            ${d.length ? `<span class="d">${esc(d.join(" · "))}</span>` : ""}</button>`;
        })
        .join("")}</div>`,
    )
    .join("");
  const exact = state.topics.some((t) => t.name === q.trim());
  const create = q.trim() && !exact
    ? `<button class="btn" data-action="create-topic">${ICON_PLUS}เพิ่ม "${esc(q.trim())}" เป็นเรื่องใหม่</button>`
    : "";
  return `<div class="dialog-backdrop" data-action="close-picker"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title">
    <div class="sheet-head" style="margin:0"><h2 id="picker-title">เลือกเรื่อง</h2>
      <button class="btn icon-btn" data-action="close-picker" aria-label="ปิดหน้าเลือกเรื่อง">${ICON_X}</button></div>
    <div class="field"><label for="picker-q">ค้นหาเรื่อง</label><input class="input" id="picker-q" type="search" value="${esc(q)}" autocomplete="off"></div>
    <div class="dialog-body">${body || `<p class="empty">ไม่พบเรื่องที่ค้นหา</p>`}${create}</div>
  </div>`;
}

async function createTopic(name) {
  const id = L.slugifyTopic(name, new Set(state.topics.map((t) => t.id)));
  const topic = { id, name, details: [] };
  state.topics = [...state.topics, topic];
  state.picker = { query: "" };
  const c = editing();
  saveClass({ ...c, term2TopicIds: L.addTopic(c.term2TopicIds, id) });
  try {
    await db.doc("topics/" + id).set(topic);
  } catch (e) {
    console.error("topic", e);
    state.saveError = { retry: () => db.doc("topics/" + id).set(topic).then(() => { state.saveError = null; render(); }) };
    render();
  }
}

function editorView() {
  const c = editing();
  if (!c) return "";
  return `<div class="sheet-backdrop" data-action="close-editor"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="editor-title">
    <div class="sheet-head"><div><h2 id="editor-title">${esc(c.school || "ห้องใหม่")} · ${esc(c.room)}</h2><p class="muted small" style="margin:0">${esc(c.teacher || "ยังไม่ระบุครู")}</p></div>
      <button class="btn icon-btn" id="editor-close" data-action="close-editor" aria-label="ปิด">${ICON_X}</button></div>
    ${saveAlert(true)}${infoSection(c)}${term1Section(c)}${term2Section(c)}
    <section class="section"><button class="btn danger" data-action="delete-class">ลบห้องนี้</button></section>
  </div>`;
}

function confirmView() {
  const k = state.confirm;
  if (!k) return "";
  return `<div class="dialog-backdrop" data-action="confirm-cancel"></div>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title">${esc(k.title)}</h2><p class="muted" style="margin:0">${esc(k.text)}</p>
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" data-action="confirm-cancel">ยกเลิก</button>
      <button class="btn ${k.danger ? "danger" : "primary"}" data-action="confirm-ok">${esc(k.ok)}</button></div>
  </div>`;
}

function askConfirm(opts) {
  state.confirm = opts;
  render();
  document.querySelector('[data-action="confirm-ok"]')?.focus();
}

async function deleteClass(id) {
  state.editingId = null;
  unsaved.delete(id);
  state.classes = state.classes.filter((c) => c.id !== id);
  render();
  try {
    await db.doc("classes/" + id).delete();
  } catch (e) {
    console.error("delete", e);
    state.saveError = { retry: () => deleteClass(id) };
    render();
  }
}

function updateEditing(patch) {
  const c = editing();
  if (c) saveClass({ ...c, ...patch });
}

app.addEventListener("input", (ev) => {
  if (ev.target.id === "picker-q" && state.picker) {
    state.picker = { query: ev.target.value };
    render();
  }
});

app.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-copy]") && ev.target.value) {
    const c = editing();
    const from = state.classes.find((x) => x.id === ev.target.value);
    ev.target.value = "";
    if (c && from)
      askConfirm({
        title: "แทนที่เนื้อหาเทอม 2 ของห้องนี้?",
        text: `เนื้อหาเทอม 2 ของห้องนี้จะถูกแทนที่ด้วย ${from.term2TopicIds.length} เรื่องจาก ${from.teacher || "ยังไม่ระบุครู"} — ${from.school} ${from.room}`,
        ok: "แทนที่",
        run: () => updateEditing({ term2TopicIds: [...from.term2TopicIds] }),
      });
    return;
  }
  const f = ev.target.dataset?.field;
  const c = editing();
  if (!f || !c) return;
  if (f === "needsReview") updateEditing({ needsReview: ev.target.checked });
  else if (f === "note") updateEditing({ term1End: { ...c.term1End, note: ev.target.value.trim() } });
  else updateEditing({ [f]: ev.target.value.trim() });
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.confirm) { state.confirm = null; render(); }
  else if (state.preview) closePreview();
  else if (state.picker) { state.picker = null; render(); }
  else if (state.editingId) closeEditor();
});

app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "view") { state.view = el.dataset.view; state.notice = ""; render(); }
  else if (a === "export") startExport();
  else if (a === "close-preview") closePreview();
  else if (a === "download") savePng();
  else if (a === "filter") { state.filter = el.dataset.filter; render(); }
  else if (a === "add-class") addClass();
  else if (a === "edit") openEditor(el.dataset.classId);
  else if (a === "retry") state.saveError?.retry();
  else if (a === "close-editor") closeEditor();
  else if (a === "open-picker") { state.picker = { query: "" }; render(); document.getElementById("picker-q")?.focus(); }
  else if (a === "close-picker") { state.picker = null; render(); }
  else if (a === "pick") { const c = editing(); updateEditing({ term2TopicIds: L.addTopic(c.term2TopicIds, el.dataset.topic) }); }
  else if (a === "create-topic") createTopic(state.picker.query.trim());
  else if (a === "t2-move") { const c = editing(); updateEditing({ term2TopicIds: L.moveTopic(c.term2TopicIds, +el.dataset.index, +el.dataset.delta) }); }
  else if (a === "t2-remove") { const c = editing(); updateEditing({ term2TopicIds: L.removeTopicAt(c.term2TopicIds, +el.dataset.index) }); }
  else if (a === "term1-topic") { const c = editing(); updateEditing({ term1End: { ...c.term1End, topicId: el.dataset.topic } }); }
  else if (a === "term1-status") { const c = editing(); updateEditing({ term1End: { ...c.term1End, status: el.dataset.status } }); }
  else if (a === "delete-class") {
    const id = state.editingId;
    askConfirm({ title: "ลบห้องนี้?", text: "ข้อมูลเทอม 1 และเทอม 2 ของห้องนี้จะหายไป", ok: "ลบ", danger: true, run: () => deleteClass(id) });
  } else if (a === "confirm-cancel") { state.confirm = null; render(); }
  else if (a === "confirm-ok") { const k = state.confirm; state.confirm = null; render(); k?.run(); }
});

function render() {
  // Keep whatever the user is typing (and the caret) across a full re-render.
  const active = document.activeElement;
  const keep = active?.id && app.contains(active) && "value" in active
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;
  app.innerHTML = header() + body() + editorView() + pickerView() + previewView() + confirmView();
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch {}
    }
  }
}

function markLoaded(key) {
  state.loaded[key] = true;
  if (Object.values(state.loaded).every(Boolean)) state.status = "ready";
  render();
}

async function boot() {
  render();
  window.claude?.use?.("downloads").then((d) => { downloads = d ?? null; render(); }, () => {});
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
