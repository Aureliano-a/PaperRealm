import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Book } from "./types";
import { readBinarySource } from "./binarySource";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { get } from "./db";

type CoverUpdate = Pick<Book, "coverImage" | "pdfCover">;
const CANDIDATE_PAGES = 5;

async function paintPage(page: PDFPageProxy, width: number, height: number) {
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(width / original.width, height / original.height),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: width < 100 });
  if (!context) throw Error("无法生成封面");
  try {
    await page.render({
      canvasContext: context,
      viewport,
      background: "#ffffff",
      annotationMode: 0,
    }).promise;
    return { canvas, context };
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
}

export async function renderPdfCover(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  if (pdf.isPureXfa) throw Error("XFA 页面暂不生成图片封面");
  const { canvas } = await paintPage(await pdf.getPage(pageNumber), 320, 480);
  try {
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function visualFeatures(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const pixels = context.getImageData(0, 0, width, height).data;
  const left = Math.floor(width * 0.08),
    right = Math.ceil(width * 0.92);
  const top = Math.floor(height * 0.06),
    bottom = Math.ceil(height * 0.94);
  let dark = 0,
    light = 0,
    color = 0,
    bands = 0,
    wasLine = false;
  const area = (right - left) * (bottom - top);
  for (let y = top; y < bottom; y++) {
    let rowDark = 0;
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      const tone = (r * 3 + g * 6 + b) / 10;
      if (tone < 178) rowDark++;
      if (tone > 218) light++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35) color++;
    }
    dark += rowDark;
    const isLine = rowDark >= Math.max(2, (right - left) * 0.085);
    if (isLine && !wasLine) bands++;
    wasLine = isLine;
  }
  return { dark: dark / area, light: light / area, color: color / area, bands };
}

async function scorePage(page: PDFPageProxy, title: string) {
  const viewport = page.getViewport({ scale: 1 });
  const text = await page.getTextContent().catch(() => null);
  const runs =
    text?.items.flatMap((item) =>
      "str" in item && item.str.trim() ? [item] : [],
    ) ?? [];
  const words = runs
    .map((item) => item.str)
    .join(" ")
    .trim();
  const leading = runs
    .slice(0, 14)
    .map((item) => item.str)
    .join(" ")
    .trim();
  if (
    /^(?:table of contents\b|contents\s*$|copyright\b|目录|目次|版权页|índice\b|оглавление\b)/iu.test(
      leading,
    )
  )
    return null;
  const lines = new Set(
    runs.map((item) =>
      Math.round(item.transform[5] / Math.max(1, viewport.height / 160)),
    ),
  );
  if (words.length > 620 || lines.size > 15) return null;
  const largest = runs.reduce(
    (max, item) =>
      Math.max(max, Math.hypot(item.transform[2], item.transform[3])),
    0,
  );
  const titleSized =
    largest > Math.min(viewport.width, viewport.height) * 0.037;
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const name = normalize(title);
  const titleMatch = name.length >= 3 && normalize(words).includes(name);
  const { canvas, context } = await paintPage(page, 96, 144);
  try {
    const visual = visualFeatures(context, canvas.width, canvas.height);
    if (visual.dark < 0.004 && visual.color < 0.08) return null;
    const hasArtwork =
      visual.color > 0.12 &&
      visual.dark > 0.014 &&
      (visual.light > 0.015 || visual.dark < 0.94);
    const scannedTitle =
      !words &&
      visual.bands >= 2 &&
      visual.bands <= 9 &&
      visual.dark >= 0.018 &&
      visual.dark < 0.23 &&
      visual.light > 0.6;
    const monochromeArtwork =
      !words &&
      visual.bands <= 8 &&
      visual.dark >= 0.23 &&
      visual.dark < 0.96 &&
      visual.light > 0.045;
    if (!(
      titleSized ||
      titleMatch ||
      hasArtwork ||
      scannedTitle ||
      monochromeArtwork
    ))
      return null;
    if (!words && visual.bands > 12 && visual.color < 0.12) return null;
    return (
      (titleMatch ? 3.5 : 0) +
      (titleSized ? 3 : 0) +
      (hasArtwork ? 3.2 : 0) +
      (scannedTitle ? 1.8 : 0) +
      (monochromeArtwork ? 2 : 0) -
      lines.size * 0.06
    );
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function identifyPdfCover(
  pdf: PDFDocumentProxy,
  title: string,
): Promise<CoverUpdate> {
  let best: { page: number; score: number } | undefined;
  if (!pdf.isPureXfa) {
    let inspected = 0;
    let failure: unknown;
    for (let n = 1; n <= Math.min(pdf.numPages, CANDIDATE_PAGES); n++) {
      try {
        const score = await scorePage(await pdf.getPage(n), title);
        inspected++;
        if (score === null) continue;
        const ranked = score - (n - 1) * 0.25;
        if (ranked >= 0.75 && (!best || ranked > best.score))
          best = { page: n, score: ranked };
      } catch (error) {
        failure = error;
      }
    }
    if (!inspected && failure) throw failure;
  }
  if (!best)
    return { coverImage: undefined, pdfCover: { source: "generated" } };
  return {
    coverImage: await renderPdfCover(pdf, best.page),
    pdfCover: { source: "auto", page: best.page },
  };
}

const pending = new Map<string, Promise<CoverUpdate>>();
let coverQueue: Promise<unknown> = Promise.resolve();
export function loadPdfCover(id: string, title: string): Promise<CoverUpdate> {
  const active = pending.get(id);
  if (active) return active;
  const task = coverQueue
    .catch(() => {})
    .then(async () => {
      const source = isTauri()
        ? await invoke<{ legacyLength?: number; length?: number }>(
            "db_source_info",
            { id },
          )
        : await get<string | { length?: number; legacyLength?: number }>(
            "source:" + id,
          );
      const length =
        typeof source === "string"
          ? source.length * 0.75
          : (source?.length ?? (source?.legacyLength || 0) * 0.75);
      if (length > 32 * 1024 * 1024)
        throw Error("大文件封面延后生成，以节省内存");
      const bytes = await readBinarySource(id);
      const { default: pdfjs } = await import("./pdfEngine");
      const loading = pdfjs.getDocument({
        data: bytes,
        enableXfa: true,
        isEvalSupported: false,
        canvasMaxAreaInBytes: 16 * 1024 * 1024,
      });
      try {
        return await identifyPdfCover(await loading.promise, title);
      } finally {
        await loading.destroy();
      }
    });
  coverQueue = task;
  pending.set(id, task);
  void task.finally(() => pending.delete(id)).catch(() => {});
  return task;
}
