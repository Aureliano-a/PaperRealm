import { restoreXfa } from "./pdfXfa";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  PdfAnnotation,
  PdfFormRecord,
  PdfFormValue,
  PdfFieldObject,
} from "./pdfTypes";
import { get, put } from "./db";
import { tr } from "./i18n";

export const formKey = (a: Pick<PdfAnnotation, "id" | "fieldName">) =>
  a.fieldName ? "name:" + a.fieldName : "id:" + a.id;
export const emptyForms = (bookId: string): PdfFormRecord => ({
  version: 1,
  bookId,
  values: {},
  updated: 0,
});
export function validForms(
  value: unknown,
  bookId: string,
): value is PdfFormRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as PdfFormRecord;
  return (
    v.version === 1 &&
    v.bookId === bookId &&
    typeof v.updated === "number" &&
    !!v.values &&
    typeof v.values === "object" &&
    !Array.isArray(v.values) &&
    Object.keys(v.values).length <= 5000 &&
    (v.formatted === undefined ||
      (!!v.formatted &&
        typeof v.formatted === "object" &&
        !Array.isArray(v.formatted) &&
        Object.keys(v.formatted).length <= 5000 &&
        Object.values(v.formatted).every(
          (s) => typeof s === "string" && s.length <= 200000,
        ))) &&
    Object.entries(v.values).every(
      ([key, val]) =>
        /^(name:|id:)/.test(key) &&
        key.length <= 2000 &&
        (typeof val === "string"
          ? val.length <= 200000
          : Array.isArray(val) &&
            val.length <= 1000 &&
            val.every((s) => typeof s === "string" && s.length <= 20000)),
    )
  );
}
export async function loadForms(bookId: string) {
  const value = await get<unknown>("pdf-forms:" + bookId);
  if (value === undefined) return emptyForms(bookId);
  if (!validForms(value, bookId))
    throw Error(tr("表单记录损坏，请先导出备份。"));
  return value;
}
export async function storeForms(data: PdfFormRecord) {
  if (!validForms(data, data.bookId)) throw Error(tr("表单数据格式无效"));
  await put("pdf-forms:" + data.bookId, data);
}
export function formValue(
  a: PdfAnnotation,
  record: PdfFormRecord,
): PdfFormValue {
  const saved = record.values[formKey(a)];
  if (saved !== undefined) return saved;
  if (typeof a.fieldValue === "boolean")
    return a.fieldValue ? a.exportValue || a.buttonValue || "Yes" : "Off";
  return a.fieldValue ?? (a.multiSelect ? [] : "");
}
export function canFill(a: PdfAnnotation) {
  return (
    !a.password &&
    !a.readOnly &&
    (a.fieldType === "Tx" ||
      a.fieldType === "Ch" ||
      (a.fieldType === "Btn" && (a.checkBox || a.radioButton)))
  );
}
// Synchronize all widgets of a named field, including widgets on unmounted pages.
export function applyForms(
  pdf: PDFDocumentProxy,
  fields: Record<string, PdfFieldObject[]>,
  record: PdfFormRecord,
) {
  if (pdf.isPureXfa) {
    restoreXfa(pdf, record);
    return;
  }
  for (const [name, widgets] of Object.entries(fields))
    for (const field of widgets) {
      if (field.password || field.type === "signature") continue;
      const key = formKey({ id: field.id, fieldName: field.name || name }),
        value = record.values[key];
      if (value === undefined) {
        pdf.annotationStorage.remove(field.id);
        continue;
      }
      if (["checkbox", "radiobutton"].includes(field.type))
        pdf.annotationStorage.setValue(field.id, {
          value: value === field.exportValues,
        });
      else if (["text", "combobox", "listbox"].includes(field.type))
        pdf.annotationStorage.setValue(field.id, {
          value,
          formattedValue: record.formatted?.[field.id] ?? null,
        });
    }
}
