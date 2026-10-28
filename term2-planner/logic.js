// Pure planning logic: no DOM, no db. Inputs are never mutated.

export const UNASSIGNED = "ยังไม่ระบุครู";
export const COURSE_TYPES = ["พื้นฐาน", "เพิ่มเติม", "เข้มข้น"];

export function topicName(topicsById, id) {
  return topicsById[id]?.name ?? "(ไม่พบเรื่อง)";
}

const th = (a, b) => a.localeCompare(b, "th");

export function groupByTeacher(classes) {
  const groups = new Map();
  for (const c of classes) {
    const key = c.teacher.trim() || UNASSIGNED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === UNASSIGNED ? -1 : b === UNASSIGNED ? 1 : th(a, b)))
    .map(([teacher, list]) => ({
      teacher,
      classes: [...list].sort((x, y) => th(x.school, y.school) || th(x.room, y.room)),
    }));
}

export function filterClasses(classes, filter) {
  if (filter === "review") return classes.filter((c) => c.needsReview);
  if (COURSE_TYPES.includes(filter)) return classes.filter((c) => c.courseType === filter);
  return [...classes];
}

export function term1Rows(sequence, end) {
  const at = sequence.indexOf(end.topicId);
  return sequence.map((topicId, i) => ({
    topicId,
    state: at < 0 || i > at ? "untaught" : i < at ? "done" : end.status === "partial" ? "partial" : "end",
  }));
}

export function pickerGroups(cls, sequences, topics, query) {
  const seq = sequences[cls.courseType] ?? { 1: [], 2: [] };
  const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
  const leftover = term1Rows(seq["1"] ?? [], cls.term1End)
    .filter((r) => r.state === "partial" || r.state === "untaught")
    .map((r) => r.topicId);
  const used = new Set();
  const take = (ids) => ids.filter((id) => byId[id] && !used.has(id) && used.add(id));
  const groups = [
    { key: "leftover", title: "เทอม 1 ที่ยังไม่ได้สอน", ids: take(leftover) },
    { key: "standard", title: `เทอม 2 มาตรฐาน (${cls.courseType})`, ids: take(seq["2"] ?? []) },
    { key: "other", title: "เรื่องอื่นทั้งหมด", ids: take(topics.map((t) => t.id)) },
  ];
  const q = query.trim();
  const selected = new Set(cls.term2TopicIds);
  return groups
    .map(({ key, title, ids }) => ({
      key,
      title,
      items: ids
        .filter((id) => !q || byId[id].name.includes(q))
        .map((id) => ({ id, name: byId[id].name, selected: selected.has(id) })),
    }))
    .filter((g) => g.items.length > 0);
}

export function addTopic(list, id) {
  return list.includes(id) ? [...list] : [...list, id];
}

export function moveTopic(list, index, delta) {
  const to = index + delta;
  const out = [...list];
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return out;
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

export function removeTopicAt(list, index) {
  return list.filter((_, i) => i !== index);
}

export function slugifyTopic(name, existingIds) {
  const base = "t-" + Date.now().toString(36);
  let id = base;
  for (let n = 2; existingIds.has(id); n++) id = `${base}-${n}`;
  return id;
}
