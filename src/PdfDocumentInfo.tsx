import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { tr, trFormat } from "./i18n";
import { saveFile } from "./export";

type Details = { fields: [string, string][]; permissions: number[] | null };
const fieldNames: [string, string][] = [
  ["Title", "标题"],
  ["Author", "作者"],
  ["Subject", "主题"],
  ["Keywords", "关键词"],
  ["Creator", "创建程序"],
  ["Producer", "PDF 生成器"],
  ["CreationDate", "创建日期（文档声明）"],
  ["ModDate", "修改日期（文档声明）"],
  ["PDFFormatVersion", "PDF 版本"],
];
const permissionNames: [number, string][] = [
  [4, "打印"],
  [2048, "高质量打印"],
  [16, "复制文字"],
  [32, "修改批注"],
  [256, "填写表单"],
  [8, "修改文档"],
  [1024, "组合页面"],
];
export default function PdfDocumentInfo({
  pdf,
  title,
  length,
  labels,
}: {
  pdf: PDFDocumentProxy;
  title: string;
  length: number;
  labels: string[];
}) {
  const [details, setDetails] = useState<Details | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setDetails(null);
    setError("");
    void Promise.all([pdf.getMetadata(), pdf.getPermissions()])
      .then(([meta, permissions]) => {
        if (!active) return;
        const info = meta.info as Record<string, unknown>;
        setDetails({
          fields: fieldNames.flatMap(([key, label]) => {
            const value = info?.[key];
            return typeof value === "string" && value
              ? [[label, value.slice(0, 4000)] as [string, string]]
              : [];
          }),
          permissions,
        });
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [pdf]);
  return (
    <>
      <h3>{tr("文档信息")}</h3>
      <p>
        {trFormat("共 {0} 页", pdf.numPages)} ·{" "}
        {length ? (length / 1048576).toFixed(2) + " MiB" : "—"}
      </p>
      <p>{tr(pdf.isPureXfa ? "XFA 表单文档" : "标准 PDF 页面")}</p>
      <p>{trFormat("原始页码标签：{0} 个", labels.length)}</p>
      {error && <p role="alert">{error}</p>}
      {!details && !error && <p role="status">{tr("正在加载…")}</p>}
      {details && (
        <>
          <dl className="pr-pdf-document-info">
            {details.fields.map(([name, value]) => (
              <div key={name}>
                <dt>{tr(name)}</dt>
                <dd dir="auto">{value}</dd>
              </div>
            ))}
          </dl>
          <h4>{tr("文档声明的权限")}</h4>
          <p>{tr("权限信息来自 PDF；证书信任状态请查看数字签名面板。")}</p>
          <dl className="pr-pdf-document-info">
            {permissionNames.map(([flag, name]) => (
              <div key={flag}>
                <dt>{tr(name)}</dt>
                <dd>
                  {tr(
                    details.permissions === null ||
                      details.permissions.includes(flag)
                      ? "允许"
                      : "未授权",
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <button
            onClick={() =>
              void saveFile(
                title.replace(/[\\/:*?"<>|]/g, "_") + "-document-info.json",
                JSON.stringify(
                  {
                    version: 1,
                    title,
                    pages: pdf.numPages,
                    bytes: length,
                    metadata: Object.fromEntries(details.fields),
                    permissionFlags: details.permissions,
                    pageLabels: labels,
                    signatureAssessment: "not-performed-by-this-report",
                  },
                  null,
                  2,
                ),
              ).catch((e) => setError(String(e)))
            }
          >
            {tr("导出文档信息")}
          </button>
        </>
      )}
    </>
  );
}
