import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfFieldObject, PdfFormRecord, PdfFormValue } from "./pdfTypes";
import { formKey } from "./pdfForms";
import { tr } from "./i18n";
type Change = {
  id: string;
  value: PdfFormValue;
  button?: boolean;
  action?: boolean;
};
type Update = {
  id?: string;
  value?: unknown;
  formattedValue?: unknown;
  command?: string;
};
type Result = {
  ok: boolean;
  updates: Update[];
  notices: string[];
  error?: string;
};
export async function calculatePdfForm(
  pdf: PDFDocumentProxy,
  fields: Record<string, PdfFieldObject[]>,
  record: PdfFormRecord,
  language: string,
  change?: Change,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Error(tr("计算已取消。"));
  if (pdf.isPureXfa) throw Error(tr("XFA 脚本计算不受此引擎支持。"));
  const objects = structuredClone(fields),
    values: [string, PdfFormValue][] = [],
    byId = new Map<string, { field: PdfFieldObject; name: string }>();
  for (const list of Object.values(objects))
    for (const item of list) delete item.signature;
  for (const [name, items] of Object.entries(objects)) {
    const first = items.find(
      (f) => f.type && f.type !== "signature" && !f.password,
    );
    if (!first) continue;
    for (const field of items) byId.set(field.id, { field, name });
    const saved =
      record.values[formKey({ id: first.id, fieldName: first.name || name })];
    values.push([
      name,
      saved ??
        (typeof first.value === "boolean"
          ? first.value
            ? first.exportValues || "Yes"
            : "Off"
          : first.value || ""),
    ]);
  }
  const order =
    (await pdf.getCalculationOrderIds()) ||
    Object.values(objects)
      .flat()
      .filter((f) => f.actions?.Calculate?.length)
      .map((f) => f.id);
  const payload = {
    objects,
    values,
    change: change
      ? {
          ...change,
          value: change.button
            ? change.value === byId.get(change.id)?.field.exportValues
            : change.value,
        }
      : undefined,
    calculationOrder: order,
    actions: (await pdf.getJSActions()) || {},
    language,
    pages: pdf.numPages,
    filename: "document.pdf",
  };
  if (JSON.stringify(payload).length > 5 * 1024 * 1024)
    throw Error(tr("表单计算数据过大。"));
  if (signal?.aborted) throw Error(tr("计算已取消。"));
  const worker = new Worker(
    new URL("/pdf-resources/paperrealm.scripting.worker.mjs", location.href),
    { type: "module" },
  );
  let abort: () => void = () => {};
  const result = await new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error(tr("表单脚本超时，已终止。")));
    }, 3000);
    abort = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(Error(tr("计算已取消。")));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as Result);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      reject(Error(tr("表单计算引擎无法启动。") + " " + event.message));
    };
    worker.postMessage(payload);
  }).finally(() => {
    signal?.removeEventListener("abort", abort);
    worker.terminate();
  });
  if (!result.ok)
    throw Error(tr("文档校验或计算未通过。") + " " + (result.error || ""));
  const next = { ...record.values };
  if (change) {
    const entry = byId.get(change.id);
    if (entry)
      next[formKey({ id: change.id, fieldName: entry.name })] = change.value;
  }
  const formatted: Record<string, string> = {};
  for (const item of result.updates) {
    if (!item.id) continue;
    const entry = byId.get(item.id);
    if (!entry || entry.field.password || entry.field.type === "signature")
      continue;
    const key = formKey({ id: item.id, fieldName: entry.name });
    if (typeof item.value === "boolean") {
      if (item.value) next[key] = entry.field.exportValues || "Yes";
      else if (next[key] === entry.field.exportValues) next[key] = "Off";
    } else if (typeof item.value === "string" || typeof item.value === "number")
      next[key] = String(item.value);
    else if (
      Array.isArray(item.value) &&
      item.value.every((v) => typeof v === "string")
    )
      next[key] = item.value;
    if (typeof item.formattedValue === "string")
      formatted[item.id] = item.formattedValue;
    else if (item.formattedValue === null) formatted[item.id] = "";
  }
  return {
    values: next,
    formatted,
    notices: result.notices,
    blockedActions: result.updates
      .filter((item) => item.command && item.command !== "println")
      .map((item) => item.command!)
      .slice(0, 10),
  };
}
