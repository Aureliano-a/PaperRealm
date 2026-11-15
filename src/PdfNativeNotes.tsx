import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfAnnotation } from "./pdfTypes";
import { saveFile } from "./export";
import { tr, trFormat } from "./i18n";

const labels: Record<string, string> = {
  Text: "文字批注",
  FreeText: "自由文本",
  Highlight: "高亮",
  Underline: "下划线",
  Squiggly: "波浪线",
  StrikeOut: "删除线",
  Stamp: "图章",
  Ink: "手写笔迹",
  Square: "矩形",
  Circle: "椭圆",
  Line: "直线",
  Polygon: "多边形",
  PolyLine: "折线",
  Caret: "插入标记",
  FileAttachment: "文件附件",
  Widget: "表单字段",
};
const MAX_ROWS = 3000;
const PAGE_SIZE = 30;
const annotationLabel = (subtype: string) =>
  tr(
    Object.prototype.hasOwnProperty.call(labels, subtype)
      ? labels[subtype]
      : subtype,
  );

type NoteRow = {
  page: number;
  id: string;
  subtype: string;
  rect: number[];
  author: string;
  text: string;
  textTruncated: boolean;
  fieldType?: string;
};

async function readPage(pdf: PDFDocumentProxy, page: number, limit: number) {
  const proxy = await pdf.getPage(page);
  const annotations: (PdfAnnotation & {
    hidden?: boolean;
    noView?: boolean;
  })[] = await proxy.getAnnotations({ intent: "display" });
  const visible = annotations.filter(
    (a) =>
      !a.hidden && !a.noView && a.subtype !== "Link" && a.subtype !== "Popup",
  );
  return {
    truncated: visible.length > limit,
    rows: visible.slice(0, limit).map((a): NoteRow => ({
      page,
      id: a.id,
      subtype: a.subtype,
      rect:
        Array.isArray(a.rect) &&
        a.rect.length === 4 &&
        a.rect.every(Number.isFinite)
          ? a.rect
          : [],
      author: (a.titleObj?.str || a.fieldName || a.alternativeText || "").slice(
        0,
        256,
      ),
      text:
        a.subtype === "Widget" ? "" : (a.contentsObj?.str || "").slice(0, 2048),
      textTruncated:
        a.subtype !== "Widget" && (a.contentsObj?.str?.length ?? 0) > 2048,
      fieldType: a.fieldType,
    })),
  };
}

export default function PdfNativeNotes({
  pdf,
  page,
  title,
  onLocate,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  title: string;
  onLocate: (page: number, id: string) => void;
}) {
  const [current, setCurrent] = useState<{
    page: number;
    rows: NoteRow[];
    truncated: boolean;
  } | null>(null);
  const [pageError, setPageError] = useState("");
  const [scope, setScope] = useState<"page" | "range">("page");
  const [first, setFirst] = useState("1");
  const [last, setLast] = useState(String(Math.min(pdf.numPages, 1000)));
  const [rangeRows, setRangeRows] = useState<NoteRow[]>([]);
  const [progress, setProgress] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [report, setReport] = useState<{
    first: number;
    last: number;
    visited: number;
    failed: number;
    partial: boolean;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [index, setIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const scan = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scan.current?.abort();
      scan.current = null;
    };
  }, [pdf]);
  useEffect(() => {
    if (scope !== "page") return;
    let active = true;
    setCurrent(null);
    setPageError("");
    void readPage(pdf, page, MAX_ROWS)
      .then((result) => {
        if (active) setCurrent({ page, ...result });
      })
      .catch((error) => {
        if (active) setPageError(String(error));
      });
    return () => {
      active = false;
    };
  }, [pdf, page, scope]);

  async function scanRange() {
    if (scan.current) return;
    const start = Number(first),
      end = Number(last);
    setRangeError("");
    if (
      !/^\d+$/.test(first.trim()) ||
      !/^\d+$/.test(last.trim()) ||
      start < 1 ||
      end < start ||
      end > pdf.numPages ||
      end - start >= 1000
    ) {
      setRangeError(tr("请输入有效页码范围，每次最多扫描 1000 页。"));
      return;
    }
    const controller = new AbortController();
    scan.current = controller;
    setRangeRows([]);
    setReport(null);
    setIndex(0);
    const rows: NoteRow[] = [];
    let visited = 0,
      failed = 0,
      capped = false;
    const total = end - start + 1;
    for (let n = start; n <= end && !controller.signal.aborted; n++) {
      if (visited % 10 === 0)
        setProgress(trFormat("已扫描 {0} / {1} 页", visited, total));
      try {
        const result = await readPage(pdf, n, MAX_ROWS - rows.length);
        if (controller.signal.aborted) break;
        rows.push(...result.rows);
        capped = result.truncated;
      } catch {
        if (controller.signal.aborted) break;
        failed++;
      }
      visited++;
      if (capped) break;
    }
    if (scan.current !== controller) return;
    scan.current = null;
    setProgress("");
    setRangeRows(rows);
    setReport({
      first: start,
      last: end,
      visited,
      failed,
      partial: capped || visited < total || failed > 0,
    });
    if (capped) setRangeError(tr("已达到 3000 条批注上限，请缩小扫描范围。"));
  }

  const currentReady = current?.page === page;
  const rows =
    scope === "page" ? (currentReady ? current.rows : []) : rangeRows;
  const kinds = useMemo(
    () => [...new Set(rows.map((row) => row.subtype))].sort(),
    [rows],
  );
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (!type || type === row.subtype) &&
        (!term ||
          [
            row.author,
            row.text,
            row.subtype,
            annotationLabel(row.subtype),
            String(row.page),
          ].some((value) => value.toLocaleLowerCase().includes(term))),
    );
  }, [query, rows, type]);
  const lastIndex = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
  const shownIndex = Math.min(index, lastIndex);

  async function exportIndex() {
    setExporting(true);
    setExportError("");
    try {
      await saveFile(
        title.replace(/[\\/:*?"<>|]/g, "_") + "-annotation-index.json",
        JSON.stringify(
          {
            format: "PaperRealm PDF annotation index v1",
            title,
            scope,
            coverage:
              scope === "range"
                ? report
                : { page, partial: !!current?.truncated },
            records: matches,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      if (mounted.current) setExportError(String(error));
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

  return (
    <>
      <h3>{tr("原生批注")}</h3>
      <div className="pr-pdf-tabs">
        <button
          aria-pressed={scope === "page"}
          disabled={!!progress}
          onClick={() => {
            setScope("page");
            setType("");
            setIndex(0);
          }}
        >
          {trFormat("第 {0} 页", page)}
        </button>
        <button
          aria-pressed={scope === "range"}
          onClick={() => {
            setScope("range");
            setType("");
            setIndex(0);
          }}
        >
          {tr("按页码扫描")}
        </button>
      </div>
      {scope === "range" && (
        <>
          <div className="pr-pdf-native-range">
            <label>
              {tr("起始页")}
              <input
                inputMode="numeric"
                value={first}
                disabled={!!progress}
                onChange={(e) => setFirst(e.target.value)}
              />
            </label>
            <label>
              {tr("结束页")}
              <input
                inputMode="numeric"
                value={last}
                disabled={!!progress}
                onChange={(e) => setLast(e.target.value)}
              />
            </label>
          </div>
          {progress ? (
            <>
              <p role="status">{progress}</p>
              <button onClick={() => scan.current?.abort()}>
                {tr("停止扫描")}
              </button>
            </>
          ) : (
            <button onClick={() => void scanRange()}>{tr("扫描批注")}</button>
          )}
          {rangeError && <p role="alert">{rangeError}</p>}
          {report && (
            <p>
              {trFormat(
                "已读取 {0} 页，失败 {1} 页。",
                report.visited,
                report.failed,
              )}{" "}
              {report.partial && tr("当前是部分结果。")}
            </p>
          )}
        </>
      )}
      {scope === "page" && !currentReady && (
        <p role={pageError ? "alert" : "status"}>
          {pageError || tr("正在加载…")}
        </p>
      )}
      {scope === "page" && currentReady && current.truncated && (
        <p>{tr("已达到 3000 条批注上限，请缩小扫描范围。")}</p>
      )}
      {(scope === "page" ? currentReady : !!report) && (
        <>
          <label>
            {tr("搜索批注")}
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
            />
          </label>
          <label>
            {tr("批注类型")}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setIndex(0);
              }}
            >
              <option value="">{tr("全部")}</option>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {annotationLabel(kind)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!matches.length || exporting}
            onClick={() => void exportIndex()}
          >
            {tr("导出筛选结果 JSON")}
          </button>
          {exportError && <p role="alert">{exportError}</p>}
          <p>{trFormat("匹配 {0} 条批注", matches.length)}</p>
          {matches
            .slice(shownIndex * PAGE_SIZE, (shownIndex + 1) * PAGE_SIZE)
            .map((row) => (
              <article key={row.page + ":" + row.id}>
                <button
                  disabled={!row.rect.length}
                  onClick={() => onLocate(row.page, row.id)}
                >
                  <b>
                    {trFormat("第 {0} 页", row.page)} ·{" "}
                    {annotationLabel(row.subtype)}
                  </b>
                  {row.author && <span dir="auto">{row.author}</span>}
                </button>
                {row.text && (
                  <p dir="auto">
                    {row.text}
                    {row.textTruncated && "…"}
                  </p>
                )}
                {row.fieldType === "Sig" && (
                  <small>{tr("签名状态请在数字签名面板中校验。")}</small>
                )}
              </article>
            ))}
          {lastIndex > 0 && (
            <div className="pr-pdf-tabs">
              <button
                disabled={!shownIndex}
                onClick={() => setIndex(shownIndex - 1)}
              >
                {tr("上一页")}
              </button>
              <span>
                {shownIndex + 1} / {lastIndex + 1}
              </span>
              <button
                disabled={shownIndex >= lastIndex}
                onClick={() => setIndex(shownIndex + 1)}
              >
                {tr("下一页")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
