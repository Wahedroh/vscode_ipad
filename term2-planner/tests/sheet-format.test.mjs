import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASS_HEADER, MAX_TERM2, classToRow, rowToClass, rowsToClasses,
  topicToRow, rowsToTopics, sequencesToRows, rowsToSequences, nameIndex,
} from "../sheet-format.js";
import { topicName } from "../logic.js";

const topics = [
  { id: "polynomials-1", name: "พหุนาม (1)", details: ["บวกลบ", "คูณหาร"] },
  { id: "roots-1", name: "รูท (1)", details: [] },
];
const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
const cls = {
  id: "c08", teacher: "นบีละห์", school: "พีระยา", room: "ม.1/5", grade: "ม.1", courseType: "เพิ่มเติม",
  term1End: { topicId: "polynomials-1", status: "partial", note: "ได้แค่บวกลบ" },
  term2TopicIds: ["roots-1"], needsReview: true, updatedAt: 0,
};

test("class header has 10 fixed columns and room for term 2 topics", () => {
  assert.equal(CLASS_HEADER.length, 10 + MAX_TERM2);
  assert.deepEqual(CLASS_HEADER.slice(0, 10), ["รหัส", "ครู", "โรงเรียน", "ห้อง", "ประเภท", "จบเทอม 1", "สถานะ", "หมายเหตุ", "ต้องตรวจ", "แก้ล่าสุด"]);
  assert.equal(CLASS_HEADER[10], "เทอม 2 เรื่องที่ 1");
});

test("classToRow writes names, padded to the full width", () => {
  const row = classToRow(cls, byId, 1793191444884);
  assert.equal(row.length, CLASS_HEADER.length);
  assert.deepEqual(row.slice(0, 9), ["c08", "นบีละห์", "พีระยา", "ม.1/5", "เพิ่มเติม", "พหุนาม (1)", "ยังไม่จบ", "ได้แค่บวกลบ", true]);
  assert.equal(typeof row[9], "string");
  assert.equal(row[10], "รูท (1)");
  assert.equal(row[11], "");
});

test("rowToClass reverses classToRow", () => {
  const back = rowToClass(classToRow(cls, byId, 1), nameIndex(topics));
  assert.deepEqual(back, cls);
});

test("rowToClass accepts sheet-typed booleans and short rows", () => {
  const idx = nameIndex(topics);
  assert.equal(rowToClass(["c1", "", "", "", "เพิ่มเติม", "", "", "", "TRUE"], idx).needsReview, true);
  assert.equal(rowToClass(["c1", "", "", "", "เพิ่มเติม", "", "", "", "FALSE"], idx).needsReview, false);
  const short = rowToClass(["c2", "ครูเอ"], idx);
  assert.equal(short.teacher, "ครูเอ");
  assert.deepEqual(short.term2TopicIds, []);
  assert.equal(short.term1End.status, "done");
});

test("unknown topic names typed in the sheet keep their name", () => {
  const c = rowToClass(["c3", "", "", "", "เพิ่มเติม", "สถิติเบื้องต้น", "จบแล้ว", "", false, "", "สถิติเบื้องต้น", " รูท (1) "], nameIndex(topics));
  assert.equal(c.term1End.topicId, "name:สถิติเบื้องต้น");
  assert.deepEqual(c.term2TopicIds, ["name:สถิติเบื้องต้น", "roots-1"]);
  assert.equal(topicName(byId, "name:สถิติเบื้องต้น"), "สถิติเบื้องต้น");
});

test("rowsToClasses skips rows without an id", () => {
  const rows = [classToRow(cls, byId, 1), ["", "ลบแล้ว"], [], classToRow({ ...cls, id: "c09" }, byId, 1)];
  assert.deepEqual(rowsToClasses(rows, topics).map((c) => c.id), ["c08", "c09"]);
});

test("topics round-trip with details on separate lines", () => {
  assert.deepEqual(topicToRow(topics[0]), ["polynomials-1", "พหุนาม (1)", "บวกลบ\nคูณหาร"]);
  assert.deepEqual(rowsToTopics(topics.map(topicToRow)), topics);
  assert.deepEqual(rowsToTopics([["", "เรื่องใหม่", ""], ["x", "", ""]]), [{ id: "name:เรื่องใหม่", name: "เรื่องใหม่", details: [] }]);
});

test("sequences round-trip through names", () => {
  const seq = { "เพิ่มเติม": { 1: ["polynomials-1"], 2: ["roots-1", "polynomials-1"] } };
  const rows = sequencesToRows(seq, byId);
  assert.deepEqual(rows, [["เพิ่มเติม", 1, "พหุนาม (1)"], ["เพิ่มเติม", 2, "รูท (1)", "พหุนาม (1)"]]);
  assert.deepEqual(rowsToSequences(rows.map((r) => r.map(String)), topics), { "เพิ่มเติม": { 1: ["polynomials-1"], 2: ["roots-1", "polynomials-1"] } });
});
