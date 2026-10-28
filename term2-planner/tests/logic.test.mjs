import { test } from "node:test";
import assert from "node:assert/strict";
import {
  topicName, groupByTeacher, filterClasses, term1Rows, pickerGroups,
  addTopic, moveTopic, removeTopicAt, slugifyTopic,
} from "../logic.js";

const deepFreeze = (o) => {
  if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};

const cls = (over) => ({
  id: "c", teacher: "", school: "", room: "", grade: "ม.1", courseType: "เพิ่มเติม",
  term1End: { topicId: "", status: "done", note: "" }, term2TopicIds: [], needsReview: false, updatedAt: 0,
  ...over,
});

const sequences = deepFreeze({
  "เพิ่มเติม": {
    "1": ["counting-numbers", "polynomials-1", "equations-1", "geometry-2d-3d", "compass-construction"],
    "2": ["ratio-percent", "linear-word-problems", "roots-1", "two-variable-equations", "two-variable-word-problems"],
  },
});
const topics = deepFreeze([
  "counting-numbers", "polynomials-1", "equations-1", "geometry-2d-3d", "compass-construction",
  "ratio-percent", "linear-word-problems", "roots-1", "two-variable-equations", "two-variable-word-problems",
  "polynomials-3",
].map((id) => ({ id, name: id === "roots-1" ? "รูท (1)" : id, details: [] })));

test("topicName returns name or fallback", () => {
  assert.equal(topicName({ a: { name: "เอ" } }, "a"), "เอ");
  assert.equal(topicName({}, "x"), "(ไม่พบเรื่อง)");
});

test("groupByTeacher puts unassigned first and sorts rooms", () => {
  const input = deepFreeze([
    cls({ id: "1", teacher: "ฮากีม", school: "พีระยา", room: "ม.1" }),
    cls({ id: "2", teacher: "", school: "x", room: "ม.1" }),
    cls({ id: "3", teacher: "ฟุรกอน", school: "จรว.", room: "ม.1" }),
    cls({ id: "4", teacher: "ฮากีม", school: "ดฟก", room: "ม.1" }),
    cls({ id: "5", teacher: "ฮากีม", school: "ดฟก", room: "ม.1/2" }),
  ]);
  const g = groupByTeacher(input);
  assert.deepEqual(g.map((x) => x.teacher), ["ยังไม่ระบุครู", "ฟุรกอน", "ฮากีม"]);
  assert.deepEqual(g[2].classes.map((c) => c.id), ["4", "5", "1"]);
});

test("filterClasses review and courseType", () => {
  const input = deepFreeze([cls({ id: "1", needsReview: true }), cls({ id: "2", courseType: "พื้นฐาน" })]);
  assert.deepEqual(filterClasses(input, "review").map((c) => c.id), ["1"]);
  assert.deepEqual(filterClasses(input, "พื้นฐาน").map((c) => c.id), ["2"]);
  assert.equal(filterClasses(input, "all").length, 2);
});

test("term1Rows marks done/partial/untaught", () => {
  const rows = term1Rows(deepFreeze(["a", "b", "c", "d"]), { topicId: "b", status: "partial" });
  assert.deepEqual(rows.map((r) => r.state), ["done", "partial", "untaught", "untaught"]);
  assert.deepEqual(term1Rows(["a", "b"], { topicId: "a", status: "done" }).map((r) => r.state), ["end", "untaught"]);
  assert.deepEqual(term1Rows(["a", "b"], { topicId: "zzz", status: "done" }).map((r) => r.state), ["untaught", "untaught"]);
});

test("pickerGroups splits leftover, standard, other", () => {
  const c = deepFreeze(cls({ term1End: { topicId: "polynomials-1", status: "partial", note: "" }, term2TopicIds: ["ratio-percent"] }));
  const g = pickerGroups(c, sequences, topics, "");
  assert.deepEqual(g.map((x) => x.key), ["leftover", "standard", "other"]);
  assert.equal(g[0].title, "เทอม 1 ที่ยังไม่ได้สอน");
  assert.equal(g[1].title, "เทอม 2 มาตรฐาน (เพิ่มเติม)");
  assert.equal(g[2].title, "เรื่องอื่นทั้งหมด");
  assert.deepEqual(g[0].items.map((i) => i.id), ["polynomials-1", "equations-1", "geometry-2d-3d", "compass-construction"]);
  assert.deepEqual(g[1].items.map((i) => i.id), sequences["เพิ่มเติม"]["2"]);
  assert.equal(g[1].items[0].selected, true);
  assert.equal(g[1].items[1].selected, false);
  assert.deepEqual(g[2].items.map((i) => i.id), ["counting-numbers", "polynomials-3"]);
  const q = pickerGroups(c, sequences, topics, " รูท ");
  assert.deepEqual(q.map((x) => x.key), ["standard"]);
  assert.deepEqual(q[0].items.map((i) => i.id), ["roots-1"]);
});

test("addTopic does not duplicate", () => {
  const l = deepFreeze(["a"]);
  assert.deepEqual(addTopic(l, "a"), ["a"]);
  assert.deepEqual(addTopic(l, "b"), ["a", "b"]);
});

test("moveTopic swaps and ignores out of range", () => {
  const l = deepFreeze(["a", "b", "c"]);
  assert.deepEqual(moveTopic(l, 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveTopic(l, 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveTopic(l, 2, 1), ["a", "b", "c"]);
  assert.deepEqual(moveTopic(l, 2, -1), ["a", "c", "b"]);
});

test("removeTopicAt removes index", () => {
  assert.deepEqual(removeTopicAt(deepFreeze(["a", "b"]), 0), ["b"]);
});

test("slugifyTopic avoids collisions", () => {
  const a = slugifyTopic("สถิติ", new Set());
  assert.match(a, /^t-[0-9a-z]+(-\d+)?$/);
  const taken = new Set([a, a + "-2"]);
  for (let i = 0; i < 5; i++) {
    const b = slugifyTopic("สถิติ", taken);
    assert.equal(taken.has(b), false);
    taken.add(b);
  }
});
