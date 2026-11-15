import { useEffect, useState } from "react";
import type { PdfAnnotation, PdfFormRecord, PdfFormValue } from "./pdfTypes";
import { canFill, formValue } from "./pdfForms";
import { tr } from "./i18n";

export default function PdfFormEditor({
  annotation: a,
  record,
  onSave,
  onClose,
  onAction,
  allowActions = false,
  onSignature,
}: {
  annotation: PdfAnnotation;
  record: PdfFormRecord;
  onSave: (a: PdfAnnotation, value: PdfFormValue) => Promise<void>;
  onClose: () => void;
  onAction?: (a: PdfAnnotation) => Promise<void>;
  allowActions?: boolean;
  onSignature?: () => void;
}) {
  const [draft, setDraft] = useState<PdfFormValue>(() => formValue(a, record)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editable = canFill(a) && !a.password,
    label = a.alternativeText || a.fieldName || tr("未命名字段");
  const selected = Array.isArray(draft) ? draft : [draft],
    text = Array.isArray(draft) ? draft.join(", ") : draft;
  const empty = Array.isArray(draft)
    ? !draft.length
    : !draft.trim() || draft === "Off";
  useEffect(() => {
    setDraft(formValue(a, record));
    setError("");
  }, [record.updated, a.id]);
  async function save() {
    if (busy || !editable) return;
    if (a.required && empty) {
      setError(tr("此字段为必填项"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(a, draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? tr(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="pr-pdf-form-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h4>
        {label}
        {a.required ? " *" : ""}
      </h4>
      {a.fieldType === "Sig" ? (
        <>
          <p>{tr("请在数字签名面板查看信息并校验。")}</p>
          {onSignature && (
            <button
              type="button"
              onClick={() => {
                onSignature();
                onClose();
              }}
            >
              {tr("查看签名校验")}
            </button>
          )}
        </>
      ) : a.pushButton ? (
        <>
          <p>
            {tr(
              "支持的字段按钮动作在隔离引擎中执行，网络和文件动作不会自动执行。",
            )}
          </p>
          <button
            type="button"
            disabled={!allowActions || !onAction || busy}
            onClick={() => {
              if (!onAction) return;
              setBusy(true);
              setError("");
              void onAction(a)
                .then(onClose)
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? tr("执行中…") : tr("执行字段按钮")}
          </button>
          {!allowActions && (
            <small>{tr("请先在阅读设置中启用隔离表单计算。")}</small>
          )}
        </>
      ) : a.checkBox || a.radioButton ? (
        <label>
          <input
            disabled={!editable || busy}
            type={a.radioButton ? "radio" : "checkbox"}
            checked={draft === (a.exportValue || a.buttonValue || "Yes")}
            onChange={(e) =>
              setDraft(
                e.target.checked
                  ? a.exportValue || a.buttonValue || "Yes"
                  : "Off",
              )
            }
          />
          {a.exportValue || a.buttonValue || label}
        </label>
      ) : a.fieldType === "Ch" ? (
        <label>
          {tr("字段值")}
          <select
            disabled={!editable || busy}
            multiple={!!a.multiSelect}
            size={
              a.combo
                ? undefined
                : Math.min(8, Math.max(2, a.options?.length || 2))
            }
            value={a.multiSelect ? selected : selected[0] || ""}
            onChange={(e) =>
              setDraft(
                a.multiSelect
                  ? Array.from(e.target.selectedOptions, (o) => o.value)
                  : e.target.value,
              )
            }
          >
            {!a.multiSelect && <option value="">{tr("请选择")}</option>}
            {(a.options || []).map((o, i) => (
              <option key={i} value={o.exportValue}>
                {o.displayValue}
              </option>
            ))}
          </select>
        </label>
      ) : a.multiLine ? (
        <label>
          {tr("字段值")}
          <textarea
            readOnly={!editable}
            disabled={busy}
            maxLength={a.maxLen || 200000}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      ) : (
        <label>
          {tr("字段值")}
          <input
            type={a.password ? "password" : "text"}
            readOnly={!editable}
            disabled={busy}
            maxLength={a.maxLen || 200000}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      )}
      {!editable && a.fieldType !== "Sig" && (
        <small>
          {a.password ? tr("密码字段不保存。") : tr("此字段只读。")}
        </small>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="pr-pdf-form-actions">
        {editable && (
          <button type="submit" disabled={busy}>
            {busy ? tr("保存中…") : tr("保存字段")}
          </button>
        )}
        <button type="button" disabled={busy} onClick={onClose}>
          {tr("关闭")}
        </button>
      </div>
      {editable && (
        <small>{tr("点击保存字段后写入本地记录，原始 PDF 不会被修改。")}</small>
      )}
    </form>
  );
}
