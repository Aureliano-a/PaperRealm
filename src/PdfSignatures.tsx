import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { tr, trFormat } from "./i18n";
import type { PdfFieldObject, PdfSignatureResult } from "./pdfTypes";
import { saveFile } from "./export";
const errors: Record<string, string> = {
  SIG_RANGE: "签名字节范围无效或超过校验限制。",
  SIG_LIMIT: "签名数据超过 128 MB 校验限制。",
  SIG_CMS: "签名编码不受支持或已损坏。",
  SIG_SUBFILTER: "此签名格式暂不支持校验。",
  SIG_BUSY: "已有签名校验正在运行，请稍候。",
  SIG_CONTENTS_MISMATCH: "签名内容与原文件排除区不匹配，无法确认。",
  SIG_SOURCE: "本地 PDF 副本无法读取。",
};
export default function PdfSignatures({
  bookId,
  title,
  fields,
  onLocate,
  ready = true,
  metadataError,
}: {
  bookId: string;
  title: string;
  fields: Record<string, PdfFieldObject[]>;
  onLocate: (page: number) => void;
  ready?: boolean;
  metadataError?: string;
}) {
  const signatures = Object.entries(fields).flatMap(([name, items]) =>
    items
      .filter((f) => f.type === "signature")
      .map((f) => ({ ...f, name: f.name || name })),
  );
  const [results, setResults] = useState<Record<string, PdfSignatureResult>>(
      {},
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState<Record<string, string>>({});
  async function verify(field: PdfFieldObject) {
    if (!field.signature?.cms || !Array.isArray(field.signature.ranges)) return;
    setBusy(field.id);
    setError((e) => ({ ...e, [field.id]: "" }));
    try {
      const result = await invoke<PdfSignatureResult>("verify_pdf_signature", {
        id: bookId,
        ranges: field.signature.ranges,
        cms: field.signature.cms,
        subfilter: field.signature.subfilter || "",
      });
      setResults((old) => ({ ...old, [field.id]: result }));
    } catch (e) {
      const text = String(e);
      setError((old) => ({ ...old, [field.id]: tr(errors[text] || text) }));
    } finally {
      setBusy("");
    }
  }
  if (!ready || metadataError)
    return (
      <>
        <h3>{tr("数字签名")}</h3>
        <p role={metadataError ? "alert" : "status"}>
          {metadataError || tr("正在读取签名字段…")}
        </p>
      </>
    );
  return (
    <>
      <h3>{tr("数字签名")}</h3>
      <p>
        {tr(
          "分别检查签名数据、当前文件覆盖范围和 Windows 证书链。仅使用本机及缓存信息，不联网。",
        )}
      </p>
      <p>
        {tr(
          "不验证可信时间戳、签名用途、算法强度、长期有效性或修改许可；不等于完整 PAdES 验证。",
        )}
      </p>
      {!signatures.length && <p>{tr("没有找到签名字段。")}</p>}
      {signatures.map((f) => {
        const r = results[f.id],
          sig = f.signature;
        const canVerify =
          !!sig?.cms &&
          Array.isArray(sig.ranges) &&
          sig.ranges.length === 4 &&
          sig.ranges.every((v) => Number.isSafeInteger(v) && v >= 0);
        return (
          <article key={f.id}>
            <h4>{f.name}</h4>
            {typeof f.page === "number" && f.page >= 0 ? (
              <button onClick={() => onLocate(f.page! + 1)}>
                {trFormat("第 {0} 页", f.page + 1)}
              </button>
            ) : (
              <p>{tr("无可见页面位置")}</p>
            )}
            {!sig?.present ? (
              <p>{tr("未签署的签名字段")}</p>
            ) : (
              <>
                <p>{sig.name || tr("未提供签名者名称")}</p>
                {sig.reason && <p>{sig.reason}</p>}
                {sig.date && (
                  <small>
                    {tr("文档声明时间")} · {sig.date}
                  </small>
                )}
                <button
                  disabled={!!busy || !isTauri() || !canVerify}
                  onClick={() => void verify(f)}
                >
                  {busy === f.id ? tr("正在校验…") : tr("校验签名")}
                </button>
                {!canVerify && <p>{tr("签名元数据无法读取或超出限制。")}</p>}
              </>
            )}
            {error[f.id] && <p role="alert">{error[f.id]}</p>}
            {r && (
              <div className="pr-pdf-signature-result">
                <p>
                  {tr("签名数据")}：
                  {r.cryptoValid
                    ? tr("密码学校验通过")
                    : tr("未通过或算法不受支持")}
                  {r.cryptoError && " · " + r.cryptoError}
                </p>
                <p>
                  {tr("文件覆盖")}：
                  {r.coversCurrent
                    ? tr("覆盖当前文件")
                    : tr("仅覆盖历史版本，后续内容未校验")}
                </p>
                {r.cryptoValid && (
                  <>
                    <p>
                      {tr("证书链")}：
                      {r.chainTrusted
                        ? tr("当前时间下基础证书链检查通过")
                        : tr("未建立受信任证书链")}
                      {!r.chainTrusted && " · " + r.chainError}
                    </p>
                    <p>
                      {tr("缓存吊销检查")}：
                      {tr(
                        r.revocation === "revoked"
                          ? "发现吊销记录"
                          : r.revocation === "clear_cached"
                            ? "缓存检查未发现吊销"
                            : "状态未知，缺少有效缓存",
                      )}
                    </p>
                    <p>
                      {tr("证书持有人")}：{r.subject}
                    </p>
                    <p>
                      {tr("签发者")}：{r.issuer}
                    </p>
                    {r.notAfter && (
                      <p>
                        {tr("证书到期")}：
                        {new Date(r.notAfter).toLocaleString()}
                      </p>
                    )}
                    {r.notBefore ? <p>{tr("证书生效")}：{new Date(r.notBefore).toLocaleString()}</p> : null}
                    <details>
                      <summary>{tr("证书详情")}</summary>
                      <p style={{ overflowWrap: "anywhere" }}>{tr("证书序列号")}：{r.certificateSerial || "—"}</p>
                      <p style={{ overflowWrap: "anywhere" }}>SHA-256：{r.certificateSha256 || "—"}</p>
                      <p>{tr("指纹用于核对证书身份，不代表该证书受信任。")}</p>
                      {r.certificateDer && <button onClick={() => {
                        try {
                          const bytes = Uint8Array.from(atob(r.certificateDer!), c => c.charCodeAt(0));
                          void saveFile(title.replace(/[\\/:*?"<>|]/g, "_") + "-signer.cer",
                            new Blob([bytes], { type: "application/pkix-cert" }))
                            .catch(e => setError(old => ({ ...old, [f.id]: String(e) })));
                        } catch (e) { setError(old => ({ ...old, [f.id]: String(e) })); }
                      }}>{tr("导出签名者证书")}</button>}
                    </details>
                  </>
                )}
                <button
                  onClick={() =>
                    void saveFile(
                      title.replace(/[\\/:*?"<>|]/g, "_") +
                        "-signature-report.json",
                      JSON.stringify(
                        {
                          version: 1,
                          title,
                          sourceId: bookId,
                          subfilter: sig?.subfilter,
                          ranges: sig?.ranges,
                          field: f.name,
                          checkedAt: new Date().toISOString(),
                          result: r,
                          limitations: tr(
                            "仅本机缓存检查，不验证时间戳或长期有效性。",
                          ),
                        },
                        null,
                        2,
                      ),
                    ).catch((e) =>
                      setError((old) => ({ ...old, [f.id]: String(e) })),
                    )
                  }
                >
                  {tr("导出校验报告")}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
