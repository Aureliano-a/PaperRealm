// Ignore layout whitespace, including line breaks and spaces inserted between CJK glyph runs.
// Keep original UTF-16 offsets for a readable result excerpt.
export function pdfSearchText(value: string) {
  return value.replace(/\s+/gu, "").toLowerCase();
}
export function pdfSearchMatch(value: string, query: string): number {
  const term = pdfSearchText(query);
  if (!term) return -1;
  const offsets: number[] = [],
    parts: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (/\s/u.test(value[i])) continue;
    const lower = value[i].toLowerCase();
    parts.push(lower);
    for (let j = 0; j < lower.length; j++) offsets.push(i);
  }
  const found = parts.join("").indexOf(term);
  return found < 0 ? -1 : offsets[found];
}
