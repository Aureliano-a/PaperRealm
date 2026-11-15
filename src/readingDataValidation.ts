// Shared by backup restore and PDF cache loading; accepts historical string maps too.
import type { PdfOcrRecord } from "./pdfTypes";
export function validOcrRecord(value: unknown): value is PdfOcrRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as PdfOcrRecord;
  return (
    v.version === 1 &&
    Number.isInteger(v.page) &&
    v.page > 0 &&
    typeof v.text === "string" &&
    v.text.length <= 500000 &&
    typeof v.language === "string" &&
    v.language.length <= 64 &&
    Number.isFinite(v.created) &&
    Array.isArray(v.words) &&
    v.words.length <= 30000 &&
    v.words.every(
      (w) =>
        w &&
        typeof w.text === "string" &&
        Array.isArray(w.rect) &&
        w.rect.length === 4 &&
        w.rect.every(Number.isFinite),
    )
  );
}
export function validTranslationRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.values(value).every((v) => typeof v === "string")) return true;
  const data = value as {
    version?: unknown;
    page?: unknown;
    target?: unknown;
    source?: unknown;
    pairs?: unknown;
    updated?: unknown;
  };
  if (
    data.version !== 1 ||
    !Number.isInteger(data.page) ||
    Number(data.page) < 1 ||
    typeof data.target !== "string" ||
    typeof data.updated !== "number" ||
    typeof data.source !== "string" ||
    data.source.length > 150000 ||
    !Array.isArray(data.pairs) ||
    !data.pairs.length ||
    data.pairs.length > 5000
  )
    return false;
  const pairs = data.pairs as { source?: unknown; translation?: unknown }[];
  if (
    !pairs.every(
      (p) =>
        p &&
        typeof p.source === "string" &&
        typeof p.translation === "string" &&
        p.source.trim() &&
        p.translation.trim(),
    )
  )
    return false;
  return (
    pairs.map((p) => p.source).join("") === data.source &&
    pairs.reduce((n, p) => n + String(p.translation).length, 0) <= 2_000_000
  );
}
