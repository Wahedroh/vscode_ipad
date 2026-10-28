// Summary table and PNG export, shared by the planner (app.js) and the teachers' read-only viewer.
import * as L from "./logic.js";

export const EXPORT_TITLE = "เนื้อหาคณิตศาสตร์เทอม 2 ปีการศึกษา 2569";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function summaryTableHtml(classes, topicsById) {
  const rows = L.groupByTeacher(classes)
    .flatMap((g) =>
      g.classes.map((c, i) => {
        const end = L.topicName(topicsById, c.term1End.topicId);
        const topics = c.term2TopicIds.map((id, k) => `<span><b>${k + 1}.</b>${esc(L.topicName(topicsById, id))}</span>`).join("");
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

export async function exportPng(classes, topicsById) {
  const root = document.createElement("div");
  root.id = "export-root";
  root.innerHTML = `<div class="export-head"><h1>${EXPORT_TITLE}</h1><span>ข้อมูล ณ ${new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}</span></div>${summaryTableHtml(classes, topicsById)}`;
  document.body.appendChild(root);
  try {
    // Wait only after the export surface is in the document, so faces it alone uses are loaded too.
    await document.fonts.ready;
    const canvas = await window.html2canvas(root, { scale: 2, backgroundColor: "#FFFFFF", logging: false });
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
  } finally {
    root.remove();
  }
}
