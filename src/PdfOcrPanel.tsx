import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfOcrRecord } from "./pdfTypes";
import { clearOcr, recognizePdfPage } from "./pdfOcr";
import { saveFile } from "./export";
import { tr, trFormat } from "./i18n";
export default function PdfOcrPanel({
  pdf,
  bookId,
  page,
  record,
  onUpdate,
}: {
  pdf: PDFDocumentProxy;
  bookId: string;
  page: number;
  record?: PdfOcrRecord;
  onUpdate: (page: number, record: PdfOcrRecord | null) => void;
}) {
  const [languages, setLanguages] = useState<{ tag: string; name: string }[]>(
      [],
    ),
    [language, setLanguage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (isTauri())
      void invoke<{ tag: string; name: string }[]>("ocr_languages")
        .then((values) => {
          if (active)
            setLanguages(
              values.filter((v) => /^(zh|en|ja|es|ru)(-|$)/i.test(v.tag)),
            );
        })
        .catch((e) => {
          if (active)
            setError(
              tr("无法读取系统识别语言，请检查 Windows 语言组件。") +
                " " +
                String(e),
            );
        });
    return () => {
      active = false;
    };
  }, []);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    const number = page;
    try {
      const result = await recognizePdfPage(pdf, bookId, number, language);
      onUpdate(number, result);
      if (!result.text.trim())
        setError(tr("本页未识别到文字，请检查语言和扫描清晰度。"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>{trFormat("第 {0} 页文字识别", page)}</h3>
      <p>{tr("使用 Windows 本机识别，离线运行。识别结果可能存在错误。")}</p>
      <label>
        {tr("识别语言")}
        <select
          disabled={busy}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="">{tr("系统默认")}</option>
          {languages.map((v) => (
            <option key={v.tag} value={v.tag}>
              {v.name} · {v.tag}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !isTauri() || pdf.isPureXfa}
        onClick={() => void run()}
      >
        {busy ? tr("正在识别…") : tr("识别当前页")}
      </button>
      {error && <p role="alert">{error}</p>}
      {record && (
        <>
          <p>
            {trFormat(
              "已识别 {0} 字符 · {1}",
              record.text.length,
              record.language,
            )}
          </p>
          <p>{tr("识别文字已接入搜索、翻译和朗读。")}</p>
          <button
            onClick={() =>
              void saveFile(`page-${page}-ocr.txt`, record.text).catch((e) =>
                setError(String(e)),
              )
            }
          >
            {tr("导出识别文字")}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void clearOcr(bookId, page)
                .then(() => onUpdate(page, null))
                .catch((e) => setError(String(e)))
            }
          >
            {tr("清除此页识别")}
          </button>
          <div className="pr-pdf-ocr-result" dir="auto">
            {record.text}
          </div>
        </>
      )}
    </>
  );
}
