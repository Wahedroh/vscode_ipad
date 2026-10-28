// In-memory stand-in for the artifact runtime: window.claude.use("mcp" | "downloads").
// "mcp" fakes the Google Sheets connector over an in-memory spreadsheet.
// Configure with window.__mockInit = {sheets, mcpNull, useRejects, watchError, downloadsNull} before this script runs.
(() => {
  const init = window.__mockInit || {};
  const tabs = new Map(Object.entries(structuredClone(init.sheets || { "ห้องเรียน": [["รหัส"]], "เรื่อง": [["รหัส", "ชื่อเรื่อง"]], "ลำดับมาตรฐาน": [["ประเภท"]] })));
  const mock = { tabs, failNextWrite: false, failWrites: 0, saved: [], writes: 0, watchError: init.watchError || null, calls: [] };
  window.__mock = mock;

  const col = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const parse = (range) => {
    const m = /^'(.+)'!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
    if (!m) throw { code: "tool_error", message: "bad range " + range };
    if (!tabs.has(m[1])) throw { code: "tool_error", message: "Unable to parse range: " + range };
    return { tab: tabs.get(m[1]), c0: col(m[2]), r0: m[3] ? +m[3] - 1 : 0, c1: m[4] ? col(m[4]) : col(m[2]), r1: m[5] ? +m[5] - 1 : Infinity };
  };
  const trimRow = (r) => { const out = [...r]; while (out.length && (out.at(-1) === "" || out.at(-1) == null)) out.pop(); return out; };
  // Google returns booleans as "TRUE"/"FALSE" strings and drops trailing empty cells and rows.
  const shown = (v) => (v === true ? "TRUE" : v === false ? "FALSE" : v == null ? "" : String(v));
  const getValues = ({ range }) => {
    const { tab, c0, r0, c1, r1 } = parse(range);
    const rows = tab.slice(r0, r1 === Infinity ? undefined : r1 + 1).map((r) => trimRow(r.slice(c0, c1 + 1).map(shown)));
    while (rows.length && rows.at(-1).length === 0) rows.pop();
    return { range, values: rows };
  };
  const setRows = (tab, r0, c0, values) => {
    values.forEach((row, i) => {
      tab[r0 + i] ??= [];
      row.forEach((v, j) => { if (v !== null) tab[r0 + i][c0 + j] = v; });
    });
  };
  const write = async (fn) => {
    await new Promise((r) => setTimeout(r, 5));
    if (mock.failWrites > 0) { mock.failWrites--; throw { code: "server_unavailable", message: "mock failure", retryable: true }; }
    if (mock.failNextWrite) { mock.failNextWrite = false; throw { code: "server_unavailable", message: "mock failure", retryable: true }; }
    mock.writes++;
    return fn();
  };
  const tools = {
    get_values: async (input) => getValues(input),
    update_values: (input) => write(() => { const { tab, c0, r0 } = parse(input.range); setRows(tab, r0, c0, input.values); return { status: "success" }; }),
    append_values: (input) => write(() => {
      const { tab } = parse(input.range);
      let last = tab.length;
      while (last > 0 && trimRow((tab[last - 1] || []).map(shown)).length === 0) last--;
      setRows(tab, last, 0, input.values);
      return { status: "success" };
    }),
  };
  const result = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload) }], payload });

  const watchers = new Set();
  const deliver = (w) => setTimeout(async () => {
    if (!watchers.has(w)) return;
    if (mock.watchError) return w.handler({ type: "error", error: { code: mock.watchError, server: "Google Sheets", message: "mock" } });
    try { w.handler({ type: "data", result: result(await tools[w.tool](w.input)) }); }
    catch (e) { w.handler({ type: "error", error: e }); }
  }, 0);
  mock.tick = () => watchers.forEach(deliver); // simulates the 30 s poll
  mock.setCell = (tabName, row, c, v) => { const t = tabs.get(tabName); t[row] ??= []; t[row][c] = v; };

  const mcp = {
    callTool: async (server, tool, input) => {
      mock.calls.push(tool);
      if (server !== "Google Sheets" || !tools[tool]) throw { code: "not_in_manifest", message: tool };
      if (tool === "get_values" && mock.watchError === "approval_required") mock.watchError = null; // the user allowed it
      return result(await tools[tool](input));
    },
    watchTool: (server, tool, input, handler) => {
      const w = { tool, input, handler };
      watchers.add(w);
      deliver(w);
      return () => watchers.delete(w);
    },
    invalidate: async () => { mock.tick(); },
  };

  // Read-side helpers for tests, decoded independently of the app's own format module.
  const topicId = (name) => (tabs.get("เรื่อง") || []).slice(1).find((r) => r[1] === name)?.[0] ?? "name:" + name;
  const decode = (r) => ({
    id: r[0], teacher: r[1] ?? "", school: r[2] ?? "", room: r[3] ?? "", courseType: r[4] ?? "",
    term1End: { topicId: r[5] ? topicId(r[5]) : "", status: r[6] === "ยังไม่จบ" ? "partial" : "done", note: r[7] ?? "" },
    needsReview: r[8] === true || r[8] === "TRUE",
    term2TopicIds: (r.slice(10) || []).filter(Boolean).map(topicId),
  });
  const classRows = () => (tabs.get("ห้องเรียน") || []).slice(1).filter((r) => r && r[0]);
  mock.docs = {
    get: (path) => {
      const [kind, id] = path.split("/");
      if (kind === "classes") { const r = classRows().find((x) => x[0] === id); return r && decode(r); }
      const t = (tabs.get("เรื่อง") || []).slice(1).find((x) => x[0] === id);
      return t && { id: t[0], name: t[1] };
    },
    has: (path) => mock.docs.get(path) !== undefined,
    keys: () => classRows().map((r) => "classes/" + r[0]),
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
      if (name === "mcp" && init.useRejects) throw { code: "capability_disabled", message: "mock" };
      if (name === "mcp") return init.mcpNull ? null : mcp;
      if (name === "downloads") return init.downloadsNull ? null : downloads;
      return null;
    },
  };
})();
