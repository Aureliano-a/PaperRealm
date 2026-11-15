import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { get, put } from "./db";
import { trackExtraWrite } from "./store";
import { validOcrRecord } from "./readingDataValidation";
import type { PdfOcrRecord } from "./pdfTypes";
import { tr } from "./i18n";
const key = (id: string, page: number) => `pdf-ocr:${id}:${page}`;
export async function readOcr(id: string, page: number) {
  const value = await get<unknown>(key(id, page));
  return validOcrRecord(value) && value.page === page ? value : null;
}
export async function clearOcr(id: string, page: number) {
  await trackExtraWrite(put(key(id, page), null));
}
export async function recognizePdfPage(
  pdf: PDFDocumentProxy,
  id: string,
  page: number,
  language: string,
) {
  if (!isTauri()) throw Error(tr("文字识别仅在 Windows 桌面程序中可用。"));
  if (pdf.isPureXfa) throw Error(tr("XFA 页面可直接提取文字，无需图片识别。"));
  const p = await pdf.getPage(page),
    base = p.getViewport({ scale: 1 }),
    scale = Math.min(
      2.5,
      2400 / Math.max(base.width, base.height),
      Math.sqrt(3_000_000 / (base.width * base.height)),
    ),
    view = p.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  try {
    await p.render({
      canvasContext: canvas.getContext("2d")!,
      viewport: view,
      background: "#ffffff",
    }).promise;
    const image = canvas.toDataURL("image/png").split(",")[1];
    if (image.length > 17 * 1024 * 1024)
      throw Error(tr("识别图片过大，请降低页面复杂度。"));
    canvas.width = 0;
    canvas.height = 0;
    const value = await invoke<{
      text: string;
      language: string;
      words: { text: string; rect: [number, number, number, number] }[];
    }>("ocr_image", { image, language }).catch((e) => {
      if (String(e).includes("OCR_BUSY"))
        throw Error(tr("已有文字识别任务正在运行，请稍候。"));
      throw Error(
        tr("识别失败，请检查 Windows 文字识别语言包。") + " " + String(e),
      );
    });
    const record: PdfOcrRecord = {
      version: 1,
      page,
      text: value.text,
      language: value.language,
      created: Date.now(),
      words: value.words.map((w) => {
        const [x, y, width, height] = w.rect,
          a = view.convertToPdfPoint(x, y),
          b = view.convertToPdfPoint(x + width, y + height);
        return { text: w.text, rect: [a[0], a[1], b[0], b[1]] };
      }),
    };
    if (!validOcrRecord(record)) throw Error(tr("文字识别结果无效。"));
    await trackExtraWrite(put(key(id, page), record));
    return record;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    p.cleanup();
  }
}
