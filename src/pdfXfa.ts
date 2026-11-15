import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfFormRecord } from "./pdfTypes";

export type XfaNode = {
  name: string;
  value?: string;
  attributes?: Record<string, any>;
  children?: XfaNode[];
};
export function xfaFields(pdf: PDFDocumentProxy) {
  const fields = new Map<string, { password: boolean }>(),
    stack = [pdf.allXfaHtml as XfaNode | null];
  let visited = 0;
  while (stack.length && visited++ < 200000) {
    const node = stack.pop();
    if (!node) continue;
    const attrs = node.attributes;
    if (typeof attrs?.dataId === "string")
      fields.set(attrs.dataId, { password: attrs.type === "password" });
    for (const child of node.children || []) stack.push(child);
  }
  return fields;
}
export function restoreXfa(pdf: PDFDocumentProxy, record: PdfFormRecord) {
  const fields = xfaFields(pdf);
  for (const id of fields.keys()) pdf.annotationStorage.remove(id);
  for (const [key, value] of Object.entries(record.values)) {
    const id = key.slice(3);
    if (key.startsWith("id:") && fields.has(id) && !fields.get(id)?.password)
      pdf.annotationStorage.setValue(id, { value });
  }
  pdf.annotationStorage.resetModified();
}
export function collectXfa(pdf: PDFDocumentProxy) {
  const fields = xfaFields(pdf),
    values: PdfFormRecord["values"] = {},
    raw = pdf.annotationStorage.getAll() as Record<
      string,
      { value?: unknown }
    > | null;
  for (const [id, entry] of Object.entries(raw || {})) {
    if (!fields.has(id) || fields.get(id)?.password) continue;
    const value = entry.value;
    if (
      typeof value === "string" ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"))
    )
      values["id:" + id] = value;
  }
  return values;
}
export function safeXfaTree(source: XfaNode) {
  const root = structuredClone(source),
    stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const a = node.attributes;
    if (a) {
      for (const key of Object.keys(a))
        if (/^on/i.test(key) || ["formaction", "srcdoc"].includes(key))
          delete a[key];
      if (
        a.src &&
        !/^(blob:|data:image\/(png|jpeg|gif|webp);)/i.test(String(a.src))
      )
        delete a.src;
      if (
        node.name !== "a" &&
        a.href &&
        !/^(#|blob:|data:image\/(png|jpeg|gif|webp);)/i.test(String(a.href))
      )
        delete a.href;
      if (a.style && typeof a.style === "object")
        for (const [key, val] of Object.entries(a.style))
          if (typeof val === "string" && /url\s*\(/i.test(val))
            delete a.style[key];
      if (node.name === "form") a.action = "";
    }
    node.children = (node.children || []).filter(
      (n) =>
        n &&
        !["script", "iframe", "object", "embed", "link", "style"].includes(
          n.name.toLowerCase(),
        ),
    );
    for (const child of node.children) stack.push(child);
  }
  return root;
}
