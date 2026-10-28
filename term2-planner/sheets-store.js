// Google Sheets as the app's store, through the viewer's "Google Sheets" connector (mcp capability).
// Reads are watches that poll every 30 s; writes look the row up by id right before writing,
// so rows sorted or moved by hand in the sheet still get the right update.
import * as F from "./sheet-format.js";

export const SHEET_ID = "1SFIS0R62vjTSnPIYoBVLcEw4-rKZJm6psjAdRca_CyU";
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
export const SERVER = "Google Sheets";
const POLL_MS = 30000;
const RANGES = {
  classes: "'ห้องเรียน'!A2:AD",
  topics: "'เรื่อง'!A2:C",
  sequences: "'ลำดับมาตรฐาน'!A2:Z",
};
const LAST_COL = { "ห้องเรียน": "AD", "เรื่อง": "C" };

const rowsOf = (result) => result?.payload?.values ?? [];

export function createSheetsStore(mcp) {
  const call = (tool, input, options) => mcp.callTool(SERVER, tool, { spreadsheetId: SHEET_ID, ...input }, options);

  async function rowNumberOf(tab, id) {
    const ids = rowsOf(await call("get_values", { range: `'${tab}'!A:A` }, { cache: false }));
    const i = ids.findIndex((r, k) => k > 0 && String(r?.[0] ?? "").trim() === id);
    return i > 0 ? i + 1 : null;
  }

  async function upsert(tab, id, row) {
    const n = await rowNumberOf(tab, id);
    if (n) await call("update_values", { range: `'${tab}'!A${n}:${LAST_COL[tab]}${n}`, values: [row] });
    else await call("append_values", { range: `'${tab}'!A1`, values: [row] });
  }

  return {
    // onData({classes, topics, sequences}) fires once all three tabs have arrived, then on every change.
    watch(onData, onError) {
      const latest = {};
      const emit = () => {
        if (!("classes" in latest && "topics" in latest && "sequences" in latest)) return;
        const topics = F.rowsToTopics(latest.topics);
        onData({
          topics,
          sequences: F.rowsToSequences(latest.sequences, topics),
          classes: F.rowsToClasses(latest.classes, topics),
        });
      };
      const stops = Object.entries(RANGES).map(([key, range]) =>
        mcp.watchTool(SERVER, "get_values", { spreadsheetId: SHEET_ID, range }, (ev) => {
          if (ev.type === "error") return onError(ev.error);
          latest[key] = rowsOf(ev.result);
          emit();
        }, { refetchInterval: POLL_MS }),
      );
      return () => stops.forEach((stop) => stop());
    },
    refresh: () => mcp.invalidate(SERVER, "get_values").catch(() => {}),
    // One direct read: the only path that can show the viewer the connector's consent prompt.
    allow: () => call("get_values", { range: RANGES.topics }, { cache: false }),
    saveClass: (cls, topicsById) => upsert("ห้องเรียน", cls.id, F.classToRow(cls, topicsById, Date.now())),
    saveTopic: (topic) => upsert("เรื่อง", topic.id, F.topicToRow(topic)),
    async deleteClass(id) {
      const n = await rowNumberOf("ห้องเรียน", id);
      if (n) await call("update_values", { range: `'ห้องเรียน'!A${n}:AD${n}`, values: [Array(F.CLASS_HEADER.length).fill("")] });
    },
  };
}
