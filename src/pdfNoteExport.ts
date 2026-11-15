import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfNote } from "./pdfTypes";
import { tr } from "./i18n";

// PDF.js 4.10.38 serialized highlight adapter; coordinates remain in PDF space.
// Temporary storage entries are removed even when saving fails.
export async function exportPdfHighlights(pdf: PDFDocumentProxy, notes: PdfNote[]) {
  if (pdf.isPureXfa) throw Error(tr("XFA 文档暂不支持写入高亮副本。"));
  const permissions = await pdf.getPermissions();
  if (permissions && !permissions.includes(32))
    throw Error(tr("此 PDF 不允许修改批注。"));
  const keys: string[] = [];
  let exported = 0, skipped = 0;
  const geometry = notes.reduce((n, item) => n + (item.rects?.length || 0), 0);
  const textLength = notes.reduce((n, item) => n + item.text.length + item.note.length, 0);
  if (notes.length > 2000 || geometry > 20000 || textLength > 4 * 1024 * 1024 ||
      notes.some(item => item.text.length + item.note.length > 99998))
    throw Error(tr("摘录数据过多，请先导出 Markdown 或 JSON。"));
  try {
    for (const note of notes) {
      if (!Number.isInteger(note.page) || note.page < 1 || note.page > pdf.numPages ||
          !note.rects?.length || note.rects.length > 2000) { skipped++; continue; }
      const page = await pdf.getPage(note.page);
      const [vx1, vy1, vx2, vy2] = page.view;
      const rects = note.rects.flatMap(r => {
        if (r.length !== 4 || !r.every(Number.isFinite)) return [];
        const left = Math.max(Math.min(vx1, vx2), Math.min(r[0], r[2]));
        const right = Math.min(Math.max(vx1, vx2), Math.max(r[0], r[2]));
        const bottom = Math.max(Math.min(vy1, vy2), Math.min(r[1], r[3]));
        const top = Math.min(Math.max(vy1, vy2), Math.max(r[1], r[3]));
        return right > left && top > bottom ? [[left, bottom, right, top]] : [];
      });
      if (!rects.length) { skipped++; continue; }
      const hex = /^#[\da-f]{6}$/i.test(note.color) ? note.color : "#ffd166";
      const key = "pdfjs_internal_editor_paperrealm_" + crypto.randomUUID();
      pdf.annotationStorage.setValue(key, {
        annotationType: 9, pageIndex: note.page - 1,
        color: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)),
        opacity: 0.35, rotation: 0, user: "PaperRealm",
        contents: [note.text, note.note].filter(Boolean).join("\n\n"),
        rect: [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])),
          Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))],
        quadPoints: rects.flatMap(([l, b, r, t]) => [l, t, r, t, l, b, r, b]),
        outlines: rects.map(([l, b, r, t]) => [l, t, r, t, r, b, l, b]),
      });
      keys.push(key);
      exported++;
    }
    if (!exported) throw Error(tr("没有可写入 PDF 的坐标摘录，请导出 Markdown 或 JSON。"));
    const bytes = await pdf.saveDocument();
    return { bytes, exported, skipped };
  } finally {
    for (const key of keys) pdf.annotationStorage.remove(key);
  }
}
