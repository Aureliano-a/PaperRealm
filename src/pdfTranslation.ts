import { validTranslationRecord } from "./readingDataValidation";
import { tr } from "./i18n";
import { get, put } from "./db";
import { trackExtraWrite } from "./store";
import { splitSentences, type AlignedPair } from "./translationAlignment";

export type PdfTranslation = {
  version: 1;
  page: number;
  target: string;
  source: string;
  pairs: AlignedPair[];
  updated: number;
};
export async function pdfTranslationKey(
  bookId: string,
  page: number,
  source: string,
  base: string,
  model: string,
  target: string,
) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([page, source, base, model, target]),
    ),
  );
  return (
    "translations:" +
    bookId +
    ":pdf-aligned:" +
    Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function readPdfTranslation(
  key: string,
  source: string,
): Promise<PdfTranslation | null> {
  const data = await get<PdfTranslation>(key);
  if (
    !data ||
    !validTranslationRecord(data) ||
    data.version !== 1 ||
    data.source !== source ||
    !Array.isArray(data.pairs) ||
    !data.pairs.length ||
    data.pairs.some(
      (p) => typeof p.source !== "string" || typeof p.translation !== "string",
    ) ||
    data.pairs.map((p) => p.source).join("") !== source
  )
    return null;
  return data;
}
export async function savePdfTranslation(key: string, value: PdfTranslation) {
  await trackExtraWrite(put(key, value));
}
export async function createPdfTranslation(
  source: string,
  base: string,
  apiKey: string,
  model: string,
  target: string,
  page: number,
  cancelled: () => boolean,
  onProgress: (done: number, total: number) => void,
): Promise<PdfTranslation> {
  if (source.length > 150_000)
    throw Error(tr("此页文字过多，请选择部分文字翻译。"));
  // Segment once and retain exact source strings. Never infer alignment from line counts.
  const sentences = splitSentences(source).flatMap((s) => {
    const parts: string[] = [];
    for (let i = 0; i < s.length; i += 5000) parts.push(s.slice(i, i + 5000));
    return parts;
  });
  const groups: string[][] = [];
  let group: string[] = [],
    length = 0;
  for (const sentence of sentences) {
    if (
      group.length &&
      (length + sentence.length > 5500 || group.length >= 100)
    ) {
      groups.push(group);
      group = [];
      length = 0;
    }
    group.push(sentence);
    length += sentence.length;
  }
  if (group.length) groups.push(group);
  const pairs: AlignedPair[] = [];
  // Pass explicit segments through the validated server command to keep batch boundaries stable.
  const { invoke } = await import("@tauri-apps/api/core");
  for (let i = 0; i < groups.length; i++) {
    if (cancelled()) throw Error(tr("翻译已取消"));
    const segments = groups[i],
      text = segments.join("");
    const result = await invoke<string>("translate_text", {
      baseUrl: base,
      apiKey,
      model,
      target,
      text,
      sentences: segments,
    });
    if (cancelled()) throw Error(tr("翻译已取消"));
    const values: unknown = JSON.parse(result);
    if (
      !Array.isArray(values) ||
      values.length !== segments.length ||
      values.some((v) => typeof v !== "string" || !v.trim())
    )
      throw Error(tr("逐句译文格式不完整，请重试。"));
    pairs.push(
      ...segments.map((s, n) => ({
        source: s,
        translation: values[n] as string,
      })),
    );
    onProgress(i + 1, groups.length);
  }
  if (pairs.map((p) => p.source).join("") !== source)
    throw Error(tr("原文对应校验失败，请重试。"));
  return { version: 1, page, target, source, pairs, updated: Date.now() };
}
