import type { Chapter, Layout, Page, Line } from "./types";
export function decode(
  bytes: Uint8Array,
  forced = "auto",
): { text: string; encoding: string } {
  if (!bytes.length) throw Error("文件为空，无法导入");
  if (bytes.length > 80 * 1024 * 1024)
    throw Error("单个文件上限为 80 MB，请先拆分文件");
  let encoding = forced;
  if (forced === "auto") {
    if (bytes[0] === 255 && bytes[1] === 254) encoding = "utf-16le";
    else if (bytes[0] === 254 && bytes[1] === 255) encoding = "utf-16be";
    else {
      let even = 0,
        odd = 0;
      for (let i = 0; i < Math.min(1000, bytes.length); i++)
        if (bytes[i] === 0) {
          if (i % 2) odd++;
          else even++;
        }
      if (odd > 30) encoding = "utf-16le";
      else if (even > 30) encoding = "utf-16be";
      else
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          encoding = "utf-8";
        } catch {
          encoding = "gb18030";
        }
    }
  }
  let text = new TextDecoder(encoding, { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  if (!text.trim()) throw Error("文件没有可阅读的文字");
  if ((text.match(/\x00/g) || []).length > text.length * 0.01)
    throw Error("不是有效的 TXT 文本，或编码选择不正确");
  return { text, encoding };
}
export function chapters(text: string): Chapter[] {
  const out: Chapter[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const title = line.trim();
    if (
      title.length < 90 &&
      /^(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇集]|序[章言幕]?|前言|引子|楔子|后记|尾声|终章|Chapter\s+\d+)(\s|[：:、.．]|$|[^\x00-\x7F])/i.test(
        title,
      )
    )
      out.push({ title, offset });
    offset += line.length + 1;
  }
  return out.length ? out : [{ title: "正文", offset: 0 }];
}
export function paginate(
  text: string,
  layout: Layout,
  widths: Record<string, number> = {},
): Page[] {
  const pages: Page[] = [];
  let lines: Line[] = [],
    y = 0,
    pageStart = 0;
  const lh = layout.size * layout.lineHeight;
  const finish = () => {
    if (lines.length) {
      pages.push({ start: pageStart, end: lines[lines.length - 1].end, lines });
      lines = [];
      y = 0;
    }
  };
  const chapterSet = new Set(chapters(text).map((c) => c.offset));
  let pos = 0;
  for (const para of text.split("\n")) {
    const firstStrong = para.match(/[A-Za-z\u3400-\u9fff\u3040-\u30ff\u0590-\u08ff]/)?.[0] || "";
    const direction = /[\u0590-\u08ff]/.test(firstStrong) ? "rtl" as const : "ltr" as const;
    const isArabic = /[\u0590-\u08ff]/.test(para);
    const useWordWrapping = isArabic || (/[A-Za-z\u0400-\u052f]/.test(para) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(para));
    const title = chapterSet.has(pos) && para.trim().length < 90;
    if (title && lines.length) finish();
    let i = 0,
      first = true;
    if (!para.length) {
      pos++;
      continue;
    }
    while (i < para.length) {
      if (y + lh > layout.height) finish();
      if (!lines.length) pageStart = pos + i;
      let start = i,
        w = first && !title ? layout.size * 2 : 0;
      while (i < para.length) {
        if (useWordWrapping) {
          const token = para.slice(i).match(/^\S+\s*|^\s+/u)?.[0];
          if (token && widths[`word:${token}`] !== undefined) {
            const cw = widths[`word:${token}`] + (isArabic ? 0 : Math.max(0, [...token].length - 1) * layout.spacing);
            if (w + cw > layout.width && i > start) break;
            if (w + cw <= layout.width) { w += cw; i += token.length; continue; }
          }
        }
        const ch = String.fromCodePoint(para.codePointAt(i)!);
        const cw =
          (widths[ch] ??
            (/[\x00-\x7F]/.test(ch)
              ? layout.size * 0.55
              : widths.defaultCJK || layout.size)) + layout.spacing;
        if (w + cw > layout.width && i > start) {
          if (
            /[，。！？；：、）》」』】…”’]/.test(ch) &&
            w + cw < layout.width + layout.size
          ) {
            i += ch.length;
          }
          break;
        }
        w += cw;
        i += ch.length;
      }
      if (i === start) i++;
      lines.push({
        text: para.slice(start, i),
        start: pos + start,
        end: pos + i,
        title,
        direction,
        indent: first && !title,
        y,
      });
      y += lh;
      first = false;
    }
    y += layout.paragraph;
    pos += para.length + 1;
  }
  finish();
  return pages;
}
export function pageAt(pages: Page[], offset: number) {
  let lo = 0,
    hi = pages.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (pages[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
export function anchor(text: string, offset: number) {
  return { textOffset: offset, context: text.slice(offset, offset + 48) };
}
export function restore(text: string, offset: number, context: string) {
  if (context && text.slice(offset, offset + context.length) !== context) {
    let found = text.indexOf(context, Math.max(0, offset - 4096)),
      best = -1;
    while (found >= 0 && found <= offset + 4096) {
      if (best < 0 || Math.abs(found - offset) < Math.abs(best - offset))
        best = found;
      found = text.indexOf(context, found + 1);
    }
    if (best >= 0) return best;
    const fallback = text.indexOf(context);
    if (fallback >= 0) return fallback;
  }
  return Math.max(0, Math.min(offset, text.length - 1));
}
export function progress(book: {
  offset: number;
  text: string;
  done: boolean;
  format?: string;
  documentPageCount?: number;
  documentLocation?: string;
}) {
  if(book.format==='pdf'&&book.documentPageCount) return book.done?100:Math.min(99,Math.max(0,Math.round((Number(book.documentLocation||1)-1)/Math.max(1,book.documentPageCount-1)*100)));
  return book.done
    ? 100
    : Math.min(
        99,
        Math.round((book.offset / Math.max(1, book.text.length)) * 100),
      );
}
