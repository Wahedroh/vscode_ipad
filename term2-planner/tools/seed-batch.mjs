// Turns seed.json into ArtifactData batch ops. Run directly to print them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function toBatchOps(seed, now) {
  const classes = seed.classes.map((c, i) => {
    const id = "c" + String(i + 1).padStart(2, "0");
    return { op: "set", path: `classes/${id}`, data: { id, grade: "ม.1", ...c, updatedAt: now } };
  });
  const topics = seed.topics.map((t) => ({ op: "set", path: `topics/${t.id}`, data: t }));
  const config = { op: "set", path: "meta/config", data: { sequences: seed.sequences, schemaVersion: 1 } };
  return [...classes, ...topics, config];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8"));
  process.stdout.write(JSON.stringify(toBatchOps(seed, Date.now())));
}
