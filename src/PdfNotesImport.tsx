import { useState, useRef, useEffect } from "react";
import type { PdfNote } from "./pdfTypes";
import { tr, trFormat } from "./i18n";

function isNote(value: unknown, pages: number): value is PdfNote {
  if (!value || typeof value !== "object") return false;
  const n = value as PdfNote;
  return (
    typeof n.id === "string" &&
    n.id.length > 0 &&
    n.id.length <= 200 &&
    Number.isSafeInteger(n.page) &&
    n.page >= 1 &&
    n.page <= pages &&
    typeof n.text === "string" &&
    typeof n.note === "string" &&
    n.text.length + n.note.length <= 100000 &&
    typeof n.color === "string" &&
    /^#[\da-f]{6}$/i.test(n.color) &&
    Number.isFinite(n.created) &&
    n.created >= 0 &&
    n.created <= 8640000000000000 &&
    Array.isArray(n.rects) &&
    n.rects.length <= 2000 &&
    n.rects.every(
      (r) =>
        Array.isArray(r) &&
        r.length === 4 &&
        r.every((v) => Number.isFinite(v) && Math.abs(v) < 1e9),
    )
  );
}
export default function PdfNotesImport({
  bookId,
  title,
  pages,
  existing,
  onImport,
}: {
  bookId: string;
  title: string;
  pages: number;
  existing: PdfNote[];
  onImport: (notes: PdfNote[]) => Promise<void>;
}) {
  const [pending, setPending] = useState<{
    notes: PdfNote[];
    skipped: number;
    mismatch: boolean;
    title: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const readToken = useRef(0);
  useEffect(
    () => () => {
      readToken.current++;
    },
    [],
  );
  async function read(file?: File) {
    if (!file) return;
    const token = ++readToken.current;
    setPending(null);
    setAcknowledged(false);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error(tr("摘录文件不能超过 5 MB。"));
      const data = JSON.parse(await file.text());
      if (token !== readToken.current) return;
      if (
        !data ||
        data.format !== "PaperRealm PDF notes v1" ||
        !Array.isArray(data.notes) ||
        data.notes.length > 2000
      )
        throw Error(tr("不是受支持的 PDF 摘录文件。"));
      const ids = new Set(existing.map((n) => n.id));
      const notes: PdfNote[] = [];
      let skipped = 0,
        geometry = 0;
      for (const value of data.notes) {
        if (!isNote(value, pages) || ids.has(value.id)) {
          skipped++;
          continue;
        }
        ids.add(value.id);
        geometry += value.rects.length;
        if (geometry > 20000)
          throw Error(tr("摘录数据过多，请先导出 Markdown 或 JSON。"));
        // Whitelist fields; do not copy arbitrary imported object properties.
        notes.push({
          id: value.id,
          page: value.page,
          text: value.text,
          note: value.note,
          color: value.color,
          created: value.created,
          rects: value.rects,
        });
      }
      if (!notes.length)
        throw Error(tr("没有可导入的新摘录；可能全部重复或无效。"));
      setPending({
        notes,
        skipped,
        mismatch:
          typeof data.sourceId === "string"
            ? data.sourceId !== bookId
            : data.title !== title,
        title: typeof data.title === "string" ? data.title.slice(0, 500) : "—",
      });
    } catch (e) {
      if (token !== readToken.current) return;
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  return (
    <section className="pr-pdf-notes-import">
      <label>
        {tr("导入摘录 JSON")}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            void read(file);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <>
          <p dir="auto">{pending.title}</p>
          <p>
            {trFormat(
              "将新增 {0} 条摘录，跳过 {1} 条重复或无效记录。",
              pending.notes.length,
              pending.skipped,
            )}
          </p>
          <p>{tr("仅合并新记录，不覆盖现有摘录。请确认文件属于当前 PDF。")}</p>
          {pending.mismatch && (
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              {tr("来源信息不同，我确认这些摘录属于当前 PDF。")}
            </label>
          )}
          {pending.notes.slice(0, 3).map((n) => (
            <p key={n.id} dir="auto">
              {trFormat("第 {0} 页", n.page)} · {n.text.slice(0, 200)}
            </p>
          ))}
          <button
            disabled={busy || (pending.mismatch && !acknowledged)}
            onClick={() => {
              setBusy(true);
              setError("");
              void onImport(pending.notes)
                .then(() => setPending(null))
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {tr(busy ? "保存中…" : "确认合并摘录")}
          </button>
          <button disabled={busy} onClick={() => setPending(null)}>
            {tr("取消")}
          </button>
        </>
      )}
    </section>
  );
}
