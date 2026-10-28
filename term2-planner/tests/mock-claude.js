// In-memory stand-in for the artifact runtime: window.claude.use("db" | "downloads").
// Configure with window.__mockInit = {ops, dbNull, downloadsNull} before this script runs.
(() => {
  const init = window.__mockInit || {};
  const docs = new Map();
  for (const o of init.ops || []) docs.set(o.path, structuredClone(o.data));
  const mock = { docs, failNextWrite: false, saved: [], writes: 0 };
  window.__mock = mock;

  const listeners = new Set();
  const segs = (p) => p.split("/");
  const snapDoc = (path) => {
    const data = docs.get(path);
    return { id: segs(path).at(-1), exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const snapCol = (col) => {
    const n = segs(col).length + 1;
    const list = [...docs.keys()].filter((p) => p.startsWith(col + "/") && segs(p).length === n).sort().map(snapDoc);
    return { docs: list, size: list.length, empty: list.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = () => listeners.forEach((l) => setTimeout(l.fire, 0));
  const listen = (fire) => { const l = { fire }; listeners.add(l); setTimeout(fire, 0); return () => listeners.delete(l); };
  const write = async (fn) => {
    await new Promise((r) => setTimeout(r, 5));
    if (mock.failNextWrite) { mock.failNextWrite = false; throw { code: "unavailable", message: "mock failure" }; }
    mock.writes++;
    fn();
    notify();
  };
  const doc = (path) => ({
    id: segs(path).at(-1), path,
    get: async () => snapDoc(path),
    set: (data) => write(() => docs.set(path, structuredClone(data))),
    update: (data) => write(() => {
      if (!docs.has(path)) throw { code: "invalid_argument", message: "missing" };
      docs.set(path, { ...docs.get(path), ...structuredClone(data) });
    }),
    delete: () => write(() => docs.delete(path)),
    onSnapshot: (next) => listen(() => next(snapDoc(path))),
  });
  const db = {
    doc,
    collection: (col) => ({
      path: col,
      doc: (id) => doc(col + "/" + (id || Math.random().toString(36).slice(2))),
      onSnapshot: (next) => listen(() => next(snapCol(col))),
      get: async () => snapCol(col),
    }),
  };
  const downloads = {
    save: async ({ filename, data }) => {
      mock.saved.push({ filename, size: data.size ?? data.length });
      return { status: "saved" };
    },
  };
  window.claude = {
    use: async (name) => {
      await new Promise((r) => setTimeout(r, 10));
      if (name === "db") return init.dbNull ? null : db;
      if (name === "downloads") return init.downloadsNull ? null : downloads;
      return null;
    },
  };
})();
