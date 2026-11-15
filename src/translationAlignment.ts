import { invoke } from "@tauri-apps/api/core";
export type AlignedPair = { source: string; translation: string };
export function sentenceAnchor(pairs: AlignedPair[], index: number, pageStart: number) {
  const source = pairs[index].source;
  const start = pageStart + pairs.slice(0, index).reduce((n, pair) => n + pair.source.length, 0) + (source.match(/^\s*/)?.[0].length || 0);
  const content = source.trim();
  return { key: `edit:${start}:${start + content.length}`, source: content };
}
export function applySavedCorrections(pairs: AlignedPair[], pageStart: number, record: Record<string, string>) {
  return pairs.map((pair, index) => {
    const anchor = sentenceAnchor(pairs, index, pageStart);
    try {
      const correction = JSON.parse(record[anchor.key] || "null") as { source?: unknown; translation?: unknown } | null;
      return correction?.source === anchor.source && typeof correction.translation === "string" && correction.translation.trim()
        ? { ...pair, translation: correction.translation } : pair;
    } catch { return pair; }
  });
}
export function joinedTranslation(pairs: AlignedPair[]) {
  return pairs.map(pair => pair.translation.trim() + (pair.source.match(/\s+$/)?.[0] || "")).join("");
}

// Keep page-edge fragments intact; never infer correspondences from rendered lines.
export function splitSentences(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locales?: string, options?: { granularity: "sentence" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  const segments = Segmenter ? [...new Segmenter(undefined, { granularity: "sentence" }).segment(text)].map(x => x.segment) : (text.match(/[^。！？!?\n]+(?:[。！？!?]+[”’」』"']*|\n|$)|[。！？!?]+[”’」』"']*|\n+/g) || [text]);
  const result: string[] = []; let prefix = "";
  for (const segment of segments) {
    if (!segment.trim()) { if (result.length) result[result.length - 1] += segment; else prefix += segment; }
    else { result.push(prefix + segment); prefix = ""; }
  }
  return result;
}
export async function translateAligned(baseUrl: string, apiKey: string, target: string, text: string, model = "DeepSeek-V4.1-Flash-1017"): Promise<AlignedPair[]> {
  const sentences = splitSentences(text);
  if (!sentences.length || sentences.length > 200) throw Error("当前页句子过多，请调大字号或缩小阅读区域后重试。");
  const result = await invoke<string>("translate_text", { baseUrl, apiKey, model, target, text, sentences });
  const values: unknown = JSON.parse(result);
  if (!Array.isArray(values) || values.length !== sentences.length || values.some(v => typeof v !== "string" || !v.trim())) throw Error("逐句译文格式不完整，请重试。");
  return sentences.map((source, i) => ({ source, translation: values[i] as string }));
}
export function readAligned(value: string | undefined): AlignedPair[] | null {
  if (!value) return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!Array.isArray(data) || !data.length || !data.every(x => x && typeof x.source === "string" && typeof x.translation === "string" && x.source.trim() && x.translation.trim())) return null;
    return data as AlignedPair[];
  } catch { return null; }
}
