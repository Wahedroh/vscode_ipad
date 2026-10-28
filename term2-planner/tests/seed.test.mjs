import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toBatchOps } from "../tools/seed-batch.mjs";

const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8"));
const topicIds = new Set(seed.topics.map((t) => t.id));

test("seed has 26 classes, 20 flagged for review", () => {
  assert.equal(seed.classes.length, 26);
  assert.equal(seed.classes.filter((c) => c.needsReview).length, 20);
});

test("seed has the 24 planned topics with unique ids", () => {
  assert.equal(seed.topics.length, 24);
  assert.equal(topicIds.size, 24);
});

test("every referenced topic exists", () => {
  for (const [type, terms] of Object.entries(seed.sequences)) {
    for (const id of [...terms["1"], ...terms["2"]]) assert.ok(topicIds.has(id), `${type}: ${id}`);
  }
  for (const c of seed.classes) {
    assert.ok(topicIds.has(c.term1End.topicId), c.school);
    for (const id of c.term2TopicIds) assert.ok(topicIds.has(id), `${c.school}: ${id}`);
  }
});

test("enums are valid", () => {
  for (const c of seed.classes) {
    assert.ok(["พื้นฐาน", "เพิ่มเติม", "เข้มข้น"].includes(c.courseType), c.courseType);
    assert.ok(["done", "partial"].includes(c.term1End.status), c.term1End.status);
  }
});

test("term 2 is prefilled from the course type sequence", () => {
  for (const c of seed.classes) assert.deepEqual(c.term2TopicIds, seed.sequences[c.courseType]["2"]);
});

test("spot-check rows from spec table", () => {
  const first = seed.classes[0];
  assert.equal(first.teacher, "นิราซฟัน มะแซ");
  assert.equal(first.school, "บ้านตาล");
  assert.equal(first.courseType, "เพิ่มเติม");
  assert.deepEqual(first.term1End, { topicId: "equations-1", status: "done", note: "" });
  assert.equal(seed.classes[7].term1End.note, "ได้แค่บวกลบพหุนาม");
  assert.equal(seed.classes[7].term1End.status, "partial");
  assert.equal(seed.classes[25].term1End.topicId, "decimals");
});

test("toBatchOps emits classes, topics and config", () => {
  const ops = toBatchOps(seed, 1);
  assert.equal(ops.length, 26 + seed.topics.length + 1);
  assert.equal(ops[0].path, "classes/c01");
  assert.equal(ops[0].op, "set");
  assert.equal(ops[0].data.grade, "ม.1");
  assert.equal(ops[0].data.id, "c01");
  assert.equal(ops[0].data.updatedAt, 1);
  assert.ok(ops.some((o) => o.path === "classes/c26"));
  assert.ok(ops.some((o) => o.path === "topics/roots-1"));
  const cfg = ops.find((o) => o.path === "meta/config");
  assert.deepEqual(cfg.data, { sequences: seed.sequences, schemaVersion: 1 });
});
