export function resolvePdfPage(
  input: string,
  labels: string[],
  count: number,
): number | null {
  const value = input.trim();
  if (!value) return null;
  // # always means the physical page; labels may themselves contain numbers.
  if (/^#\d+$/.test(value)) {
    const page = Number(value.slice(1));
    return Number.isSafeInteger(page) && page >= 1 && page <= count
      ? page
      : null;
  }
  const matches = labels.flatMap((label, i) =>
    label === value ? [i + 1] : [],
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  if (!/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= count ? page : null;
}

import type { PdfPosition } from "./pdfTypes";
export function validPdfPosition(value: unknown): value is PdfPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as PdfPosition;
  return (
    Number.isSafeInteger(p.page) &&
    p.page >= 1 &&
    p.page <= 1000000 &&
    [p.x, p.y].every(
      (v) => v === undefined || (Number.isFinite(v) && Math.abs(v) < 1e9),
    ) &&
    !!p.view &&
    ["single", "spread", "scroll"].includes(p.view.mode) &&
    ["manual", "width", "page"].includes(p.view.fit) &&
    Number.isFinite(p.view.scale) &&
    p.view.scale >= 0.05 &&
    p.view.scale <= 4 &&
    [0, 90, 180, 270].includes(p.view.rotation) &&
    [undefined, "original", "parallel", "translated"].includes(
      p.view.translationView,
    )
  );
}
export type PdfPageHistory = { back: PdfPosition[]; forward: PdfPosition[] };
export function pushPdfPage(
  history: PdfPageHistory,
  current: PdfPosition,
  next: number,
) {
  if (current.page === next) return;
  history.back.push(current);
  if (history.back.length > 100) history.back.shift();
  history.forward = [];
}
