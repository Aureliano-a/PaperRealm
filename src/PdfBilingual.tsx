import { useState } from "react";
import { tr, trFormat } from "./i18n";
import type { PdfTranslation } from "./pdfTranslation";
import { saveFile } from "./export";

export default function PdfBilingual({
  data,
  view,
  title,
  onSave,
  onError,
}: {
  data: PdfTranslation;
  view: "parallel" | "translated";
  title: string;
  onSave: (index: number, value: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(-1),
    [draft, setDraft] = useState(""),
    [saving, setSaving] = useState(false);
  async function save() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(editing, draft.trim());
      setEditing(-1);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  async function exportData() {
    try {
      await saveFile(
        title.replace(/[\\/:*?"<>|]/g, "_") +
          `-${data.page}-${data.target}.txt`,
        data.pairs
          .map((p) =>
            view === "parallel"
              ? p.source.trim() + "\n" + p.translation.trim()
              : p.translation.trim(),
          )
          .join("\n\n"),
      );
    } catch (e) {
      onError(String(e));
    }
  }
  return (
    <article
      className={`pr-pdf-bilingual ${view === "translated" ? "translation-only" : ""}`}
    >
      <header>
        <div>
          <h2>{title}</h2>
          <p>{trFormat("第 {0} 页 · {1}", data.page, data.target)}</p>
        </div>
        <button onClick={() => void exportData()}>{tr("导出对照文本")}</button>
      </header>
      {data.pairs.map((pair, i) => (
        <section className="pr-pdf-pair" key={i}>
          {view === "parallel" && (
            <div className="pr-pdf-source" dir="auto">
              <small>{trFormat("原文第 {0} 句", i + 1)}</small>
              <p>{pair.source}</p>
            </div>
          )}
          <div
            className="pr-pdf-target"
            lang={
              (
                {
                  简体中文: "zh-CN",
                  English: "en",
                  日本語: "ja",
                  Español: "es",
                  Русский: "ru",
                } as Record<string, string>
              )[data.target]
            }
            dir="auto"
          >
            <div className="pr-pdf-pair-tools">
              <small>{trFormat("译文第 {0} 句", i + 1)}</small>
              <button
                disabled={saving}
                onClick={() => {
                  setEditing(i);
                  setDraft(pair.translation);
                }}
              >
                {tr("编辑")}
              </button>
            </div>
            {editing === i ? (
              <>
                <textarea
                  aria-label={trFormat("编辑第 {0} 句译文", i + 1)}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  disabled={!draft.trim() || saving}
                  onClick={() => void save()}
                >
                  {saving ? tr("保存中…") : tr("保存")}
                </button>
                <button disabled={saving} onClick={() => setEditing(-1)}>
                  {tr("取消")}
                </button>
              </>
            ) : (
              <p>{pair.translation}</p>
            )}
          </div>
        </section>
      ))}
    </article>
  );
}
