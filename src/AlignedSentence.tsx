import { trFormat } from "./i18n";
import { tr } from "./i18n";
import { useState } from "react";
import type { AlignedPair } from "./translationAlignment";

export function AlignedSentence({ pair, index, save }: { pair: AlignedPair; index: number; save: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(pair.translation);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function commit() {
    if (!draft.trim()) { setError("译文不能为空。"); return; }
    setBusy(true); setError("");
    try { await save(draft.trim()); setEditing(false); }
    catch { setError("保存失败，请检查磁盘空间后重试。"); }
    finally { setBusy(false); }
  }
  return <div className="aligned-pair">
    <div className="aligned-source" aria-label={trFormat("原文第 {0} 句", index + 1)}>{pair.source}</div>
    {editing ? <div className="aligned-edit"><textarea aria-label={trFormat("编辑第 {0} 句译文", index + 1)} value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus disabled={busy}/><div className="aligned-actions"><button disabled={busy} onClick={() => void commit()}>{busy ? tr("保存中…") : tr("保存译文")}</button><button disabled={busy} onClick={() => { setEditing(false); setError(""); }}>{"" + tr("取消") + ""}</button></div>{error && <p role="alert">{error}</p>}</div> : <div className="aligned-translation" aria-label={trFormat("译文第 {0} 句", index + 1)}>{pair.translation}<button className="aligned-edit-button" aria-label={trFormat("编辑第 {0} 句译文", index + 1)} onClick={() => { setDraft(pair.translation); setEditing(true); }}>{"" + tr("编辑") + ""}</button></div>}
  </div>;
}
