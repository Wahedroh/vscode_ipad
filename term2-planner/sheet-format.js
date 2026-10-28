// Pure mapping between Google Sheets rows and app records. Sheets hold topic NAMES so people can
// read and edit them directly; names the topic list doesn't know become "name:<text>" ids.
import { normalizeClass } from "./logic.js";

export const MAX_TERM2 = 20;
export const CLASS_HEADER = [
  "รหัส", "ครู", "โรงเรียน", "ห้อง", "ประเภท", "จบเทอม 1", "สถานะ", "หมายเหตุ", "ต้องตรวจ", "แก้ล่าสุด",
  ...Array.from({ length: MAX_TERM2 }, (_, i) => `เทอม 2 เรื่องที่ ${i + 1}`),
];
export const TOPIC_HEADER = ["รหัส", "ชื่อเรื่อง", "รายละเอียด (บรรทัดละข้อ)"];
export const SEQUENCE_HEADER = ["ประเภท", "เทอม", "เรื่อง (เรียงตามลำดับ)"];

const cell = (v) => (v === undefined || v === null ? "" : String(v).trim());
const name = (topicsById, id) => topicsById[id]?.name ?? (id.startsWith("name:") ? id.slice(5) : id);

export function nameIndex(topics) {
  return new Map(topics.map((t) => [t.name.trim(), t.id]));
}

const idFor = (idx, text) => (text ? idx.get(text) ?? "name:" + text : "");

export function classToRow(cls, topicsById, now) {
  const t2 = cls.term2TopicIds.slice(0, MAX_TERM2).map((id) => name(topicsById, id));
  return [
    cls.id, cls.teacher, cls.school, cls.room, cls.courseType,
    cls.term1End.topicId ? name(topicsById, cls.term1End.topicId) : "",
    cls.term1End.status === "partial" ? "ยังไม่จบ" : "จบแล้ว",
    cls.term1End.note, cls.needsReview,
    new Date(now).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }),
    ...t2, ...Array(MAX_TERM2 - t2.length).fill(""),
  ];
}

export function rowToClass(row, idx) {
  const r = (i) => cell(row[i]);
  const review = row[8];
  return normalizeClass({
    id: r(0), teacher: r(1), school: r(2), room: r(3), courseType: r(4),
    term1End: { topicId: idFor(idx, r(5)), status: r(6) === "ยังไม่จบ" ? "partial" : "done", note: r(7) },
    needsReview: review === true || ["TRUE", "ใช่"].includes(cell(review).toUpperCase()),
    term2TopicIds: row.slice(10, 10 + MAX_TERM2).map(cell).filter(Boolean).map((t) => idFor(idx, t)),
  });
}

export function rowsToClasses(rows, topics) {
  const idx = nameIndex(topics);
  return rows.filter((row) => cell(row?.[0])).map((row) => rowToClass(row, idx));
}

export function topicToRow(t) {
  return [t.id, t.name, t.details.join("\n")];
}

export function rowsToTopics(rows) {
  return rows
    .filter((row) => cell(row?.[1]))
    .map((row) => ({
      id: cell(row[0]) || "name:" + cell(row[1]),
      name: cell(row[1]),
      details: cell(row[2]).split("\n").map((s) => s.trim()).filter(Boolean),
    }));
}

export function sequencesToRows(sequences, topicsById) {
  return Object.entries(sequences).flatMap(([type, terms]) =>
    ["1", "2"].filter((t) => terms[t]).map((t) => [type, Number(t), ...terms[t].map((id) => name(topicsById, id))]),
  );
}

export function rowsToSequences(rows, topics) {
  const idx = nameIndex(topics);
  const out = {};
  for (const row of rows) {
    const type = cell(row?.[0]);
    const term = cell(row?.[1]);
    if (!type || !["1", "2"].includes(term)) continue;
    out[type] ??= {};
    out[type][term] = row.slice(2).map(cell).filter(Boolean).map((t) => idFor(idx, t));
  }
  return out;
}
