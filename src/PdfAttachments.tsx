import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { tr, trFormat } from "./i18n";
import { saveFile } from "./export";
import type { PdfAttachment } from "./pdfTypes";

export function cleanAttachmentName(name: string) {
  return (
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[<>:"|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 180) || "attachment.bin"
  );
}
export function mediaType(file: PdfAttachment) {
  const b = file.content,
    name = file.filename.toLowerCase();
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71)
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (String.fromCharCode(...b.subarray(0, 6)).startsWith("GIF8"))
    return "image/gif";
  if (String.fromCharCode(...b.subarray(0, 4)) === "RIFF") {
    const kind = String.fromCharCode(...b.subarray(8, 12));
    if (kind === "WAVE") return "audio/wav";
    if (kind === "WEBP") return "image/webp";
  }
  if (
    String.fromCharCode(...b.subarray(0, 4)) === "OggS" &&
    /\.ogg$/i.test(name)
  )
    return "audio/ogg";
  if (
    (String.fromCharCode(...b.subarray(0, 3)) === "ID3" ||
      (b[0] === 255 && (b[1] & 224) === 224)) &&
    /\.mp3$/i.test(name)
  )
    return "audio/mpeg";
  if (
    String.fromCharCode(...b.subarray(4, 8)) === "ftyp" &&
    /\.(mp4|m4v|m4a)$/i.test(name)
  )
    return /\.m4a$/i.test(name) ? "audio/mp4" : "video/mp4";
  if (
    b[0] === 26 &&
    b[1] === 69 &&
    b[2] === 223 &&
    b[3] === 163 &&
    /\.webm$/i.test(name)
  )
    return "video/webm";
  return "";
}
export async function exportAttachment(file: PdfAttachment) {
  if (file.content.byteLength > 32 * 1024 * 1024)
    throw Error(tr("附件超过 32 MB，暂不导出。"));
  await saveFile(
    cleanAttachmentName(file.filename),
    new Blob([file.content as BlobPart]),
  );
}
export function PdfMediaPreview({
  file,
  onClose,
}: {
  file: PdfAttachment;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    type = mediaType(file);
  useEffect(() => {
    if (!type || file.content.byteLength > 32 * 1024 * 1024) return;
    const object = URL.createObjectURL(
      new Blob([file.content as BlobPart], { type }),
    );
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [file, type]);
  return (
    <section className="pr-pdf-media" role="dialog" aria-label={tr("附件预览")}>
      <header>
        <strong>{cleanAttachmentName(file.filename)}</strong>
        <button onClick={onClose}>{tr("关闭")}</button>
      </header>
      {!type ? (
        <p>{tr("此附件格式仅支持另存，不支持内置预览。")}</p>
      ) : !url ? (
        <p>{tr("附件过大，无法预览。")}</p>
      ) : type.startsWith("image/") ? (
        <img
          src={url}
          alt={cleanAttachmentName(file.filename)}
          onError={() => setError(tr("预览失败"))}
        />
      ) : type.startsWith("audio/") ? (
        <audio
          src={url}
          controls
          onError={() =>
            setError(tr("系统不支持此媒体编码，请另存后使用播放器打开。"))
          }
        />
      ) : (
        <video
          src={url}
          controls
          onError={() =>
            setError(tr("系统不支持此媒体编码，请另存后使用播放器打开。"))
          }
        />
      )}
      <p role="status">{error}</p>
      <button
        onClick={() =>
          void exportAttachment(file).catch((e) => setError(String(e)))
        }
      >
        {tr("另存附件")}
      </button>
    </section>
  );
}
export default function PdfAttachments({
  pdf,
  length,
  onPreview,
  onError,
}: {
  pdf: PDFDocumentProxy;
  length: number;
  onPreview: (file: PdfAttachment) => void;
  onError: (message: string) => void;
}) {
  const [files, setFiles] = useState<PdfAttachment[]>([]),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFiles([]);
    setLoaded(false);
  }, [pdf]);
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      if (length > 32 * 1024 * 1024)
        throw Error(tr("大文档暂不读取全部附件，可通过页面附件标记另存。"));
      const values = (await pdf.getAttachments()) as Record<
        string,
        PdfAttachment
      > | null;
      setFiles(
        Object.values(values || {}).filter(
          (v) =>
            v &&
            typeof v.filename === "string" &&
            v.content instanceof Uint8Array,
        ),
      );
      setLoaded(true);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>{tr("文档附件")}</h3>
      <p>{tr("按需读取嵌入文件，不会自动打开或执行。")}</p>
      <button disabled={busy} onClick={() => void load()}>
        {busy ? tr("正在加载…") : tr("读取附件")}
      </button>
      {loaded && !files.length && <p>{tr("此文档没有目录附件。")}</p>}
      {files.slice(0, 250).map((file, i) => (
        <article key={i}>
          <b>{cleanAttachmentName(file.filename)}</b>
          <p>
            {trFormat(
              "大小 {0} MB",
              (file.content.byteLength / 1048576).toFixed(2),
            )}
          </p>
          <button onClick={() => onPreview(file)}>{tr("查看详情")}</button>
          <button
            onClick={() =>
              void exportAttachment(file).catch((e) => onError(String(e)))
            }
          >
            {tr("另存附件")}
          </button>
        </article>
      ))}
    </>
  );
}
