import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PdfFormRecord } from "./pdfTypes";
import { tr, trFormat } from "./i18n";
export default function PdfFormSubmit({
  record,
  title,
  onClose,
}: {
  record: PdfFormRecord;
  title: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(""),
    [format, setFormat] = useState("json"),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      status: number;
      body: string;
      truncated: boolean;
    } | null>(null);
  const fields = Object.fromEntries(
    Object.entries(record.values).map(([key, value]) => [
      key.replace(/^(name:|id:)/, ""),
      value,
    ]),
  );
  const encoded = new URLSearchParams();
  for (const [name, value] of Object.entries(fields))
    for (const text of Array.isArray(value) ? value : [value])
      encoded.append(name, text);
  const body =
    format === "json"
      ? JSON.stringify({ title, fields }, null, 2)
      : encoded.toString();
  function check() {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      )
        throw Error(tr("提交地址必须为不含账号密码的 HTTPS 地址。"));
      if (new TextEncoder().encode(body).length > 1024 * 1024)
        throw Error(tr("提交数据不能超过 1 MB。"));
      setError("");
      setReview(true);
    } catch (e) {
      setError(String(e));
    }
  }
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<{
        status: number;
        body: string;
        truncated: boolean;
      }>("submit_pdf_form", { url, body, format });
      setResult(result);
      setReview(false);
    } catch (e) {
      setError(
        tr("表单提交未完成，请检查地址、网络和服务器要求。") + " " + String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busy) onClose();
        }
      }}
      className="pr-pdf-selection pr-pdf-submit"
      role="dialog"
      aria-label={tr("提交表单")}
    >
      <h3>{tr("提交表单")}</h3>
      <p>
        {tr("仅发送下方已保存字段，不发送整个 PDF。请确认接收地址和内容。")}
      </p>
      <label>
        {tr("接收地址")}
        <input
          type="url"
          value={url}
          disabled={review || busy}
          onChange={(e) => {
            setUrl(e.target.value);
            setResult(null);
          }}
          placeholder="https://"
        />
      </label>
      <label>
        {tr("提交格式")}
        <select
          value={format}
          disabled={review || busy}
          onChange={(e) => {
            setFormat(e.target.value);
            setResult(null);
          }}
        >
          <option value="json">JSON</option>
          <option value="urlencoded">URL encoded</option>
        </select>
      </label>
      <p>{trFormat("字段数量：{0}", Object.keys(fields).length)}</p>
      <pre>{body}</pre>
      {error && <p role="alert">{error}</p>}
      {review ? (
        <>
          <p>{tr("点击确认发送后，字段内容将通过网络发送至上述地址。")}</p>
          <button disabled={busy} onClick={() => void send()}>
            {busy ? tr("发送中…") : tr("确认发送")}
          </button>
          <button disabled={busy} onClick={() => setReview(false)}>
            {tr("返回编辑")}
          </button>
        </>
      ) : (
        <button
          disabled={busy || !url.trim() || !Object.keys(fields).length}
          onClick={check}
        >
          {tr("检查并预览提交")}
        </button>
      )}
      {result && (
        <div role="status">
          <p>{trFormat("服务器返回 HTTP {0}", result.status)}</p>
          <pre>{result.body}</pre>
          {result.truncated && <p>{tr("响应过长，仅显示前 64 KB。")}</p>}
        </div>
      )}
      <button disabled={busy} onClick={onClose}>
        {tr("关闭")}
      </button>
    </section>
  );
}
