import { safeXfaTree, type XfaNode } from "./pdfXfa";
import { pdfSearchText } from "./pdfSearch";
import { tr } from "./i18n";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import type {
  PdfNote,
  PdfSelection,
  PdfAnnotation,
  PdfFormRecord,
  PdfFormValue,
  PdfFieldObject,
  PdfAttachment,
  PdfOcrRecord,
} from "./pdfTypes";
import PdfFormEditor from "./PdfFormEditor";

type Props = {
  pdf: PDFDocumentProxy;
  page: number;
  scale: number;
  rotation: number;
  thumbnail?: boolean;
  onViewport?: (
    page: number,
    view: PageViewport | null,
    node: HTMLDivElement | null,
  ) => void;
  notes?: PdfNote[];
  onSize?: (page: number, width: number, height: number) => void;
  onSelection?: (selection: PdfSelection) => void;
  searchTerm?: string;
  onLink?: (annotation: PdfAnnotation) => void;
  formRecord?: PdfFormRecord | null;
  onSaveForm?: (
    annotation: PdfAnnotation,
    value: PdfFormValue,
  ) => Promise<void>;
  ocr?: PdfOcrRecord;
  onAttachment?: (file: PdfAttachment) => void;
  onFieldAction?: (a: PdfAnnotation) => Promise<void>;
  allowActions?: boolean;
  onSignature?: () => void;
  formRevision?: number;
  formAllowed?: boolean;
  fieldMetadata?: Record<string, PdfFieldObject>;
  focusAnnotation?: { id: string; page: number; sequence: number } | null;
};
export default function PdfPage({
  pdf,
  page,
  scale,
  rotation,
  thumbnail = false,
  onViewport,
  notes = [],
  onSize,
  onSelection,
  searchTerm = "",
  onLink,
  formRecord,
  onSaveForm,
  ocr,
  onAttachment,
  onFieldAction,
  allowActions = false,
  onSignature,
  formRevision = 0,
  formAllowed = false,
  fieldMetadata,
  focusAnnotation,
}: Props) {
  const box = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null),
    xfa = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null),
    [error, setError] = useState("");
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]),
    [opened, setOpened] = useState(""),
    [textVersion, setTextVersion] = useState(0);
  const [matches, setMatches] = useState<
    { left: number; top: number; width: number; height: number }[]
  >([]);
  const located = useRef(0);
  useEffect(() => {
    if (!thumbnail && viewport?.scale === scale && box.current) {
      onViewport?.(page, viewport, box.current);
      return () => onViewport?.(page, null, null);
    }
  }, [page, viewport, scale, thumbnail, onViewport]);
  useEffect(() => {
    if (
      !focusAnnotation ||
      focusAnnotation.page !== page ||
      located.current === focusAnnotation.sequence ||
      !annotations.some((a) => a.id === focusAnnotation.id)
    )
      return;
    located.current = focusAnnotation.sequence;
    setOpened(focusAnnotation.id);
    const frame = requestAnimationFrame(() => {
      const element = Array.from(
        box.current?.querySelectorAll<HTMLElement>("[data-pdf-annotation]") ||
          [],
      ).find((e) => e.dataset.pdfAnnotation === focusAnnotation.id);
      element?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAnnotation, page, annotations]);
  useEffect(() => {
    let active = true,
      task: RenderTask | undefined,
      text: TextLayer | undefined,
      loadedPage: PDFPageProxy | undefined;
    const node = document.createElement("canvas"),
      textNode = document.createElement("div");
    void (async () => {
      try {
        const p = await pdf.getPage(page);
        loadedPage = p;
        if (!active) {
          p.cleanup();
          return;
        }
        const base = p.getViewport({ scale: 1 });
        onSize?.(page, base.width, base.height);
        const view = p.getViewport({
          scale,
          rotation: (p.rotate + rotation) % 360,
        });
        const dpr = thumbnail ? 1 : Math.min(2, window.devicePixelRatio || 1);
        // Bound raster memory while retaining the CSS page size and text layer.
        const ratio = Math.min(
          dpr,
          Math.sqrt(4_000_000 / Math.max(1, view.width * view.height)),
        );
        const raster = p.getViewport({
          scale: scale * ratio,
          rotation: (p.rotate + rotation) % 360,
        });
        node.width = Math.ceil(raster.width);
        node.height = Math.ceil(raster.height);
        task = p.render({
          canvasContext: node.getContext("2d")!,
          viewport: raster,
          background: "#ffffff",
          annotationMode: 3,
        });
        await task.promise;
        if (!active || !canvas.current || !layer.current) return;
        const target = canvas.current;
        target.width = node.width;
        target.height = node.height;
        target.style.width = `${view.width}px`;
        target.style.height = `${view.height}px`;
        target.getContext("2d")!.drawImage(node, 0, 0);
        setViewport(view);
        setError("");
        node.width = 0;
        node.height = 0;
        layer.current.replaceChildren();
        xfa.current?.replaceChildren();
        if (p.isPureXfa) {
          const { default: engine } = await import("./pdfEngine"),
            html = await p.getXfa();
          if (!active || !xfa.current || !html) return;
          const content = document.createElement("div");
          const service = {
            addLinkAttributes: (anchor: HTMLAnchorElement, url: string) => {
              anchor.href = "#";
              anchor.addEventListener("click", (event) => {
                event.preventDefault();
                onLink?.({ id: "xfa-link", subtype: "Link", rect: [], url });
              });
            },
          };
          engine.XfaLayer.render({
            viewport: view.clone({ dontFlip: true }),
            div: content,
            xfaHtml: safeXfaTree(html as XfaNode),
            annotationStorage: pdf.annotationStorage,
            linkService: service as Parameters<
              typeof engine.XfaLayer.render
            >[0]["linkService"],
          });
          content.addEventListener("submit", (event) => event.preventDefault());
          for (const control of content.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >("input,textarea,select,button"))
            if (
              thumbnail ||
              !formAllowed ||
              control instanceof HTMLButtonElement ||
              (control instanceof HTMLInputElement &&
                ["button", "submit", "reset", "password"].includes(
                  control.type,
                ))
            )
              control.disabled = true;
          xfa.current.replaceChildren(content);
          setTextVersion((v) => v + 1);
          return;
        }
        layer.current.style.setProperty("--scale-factor", String(scale));
        if (!thumbnail) {
          const { default: pdfjs } = await import("./pdfEngine");
          if (!active) return;
          if (ocr) {
            layer.current.style.width = `${view.width}px`;
            layer.current.style.height = `${view.height}px`;
            layer.current.setAttribute("data-main-rotation", "0");
            const context = target.getContext("2d")!;
            for (const word of ocr.words) {
              const r = view.convertToViewportRectangle(word.rect),
                left = Math.min(r[0], r[2]),
                top = Math.min(r[1], r[3]),
                right = Math.max(r[0], r[2]),
                bottom = Math.max(r[1], r[3]),
                angle = ((rotation % 360) + 360) % 360,
                odd = angle % 180 !== 0,
                height = odd ? right - left : bottom - top,
                width = odd ? bottom - top : right - left;
              if (height <= 0 || width <= 0) continue;
              const span = document.createElement("span");
              span.textContent =
                word.text + (/^(zh|ja)/i.test(ocr.language) ? "" : " ");
              span.style.left = `${angle === 90 || angle === 180 ? right : left}px`;
              span.style.top = `${angle === 180 || angle === 270 ? bottom : top}px`;
              span.style.font = `${height}px sans-serif`;
              span.style.lineHeight = "1";
              context.font = span.style.font;
              span.style.transform = `rotate(${angle}deg) scaleX(${width / Math.max(1, context.measureText(span.textContent).width)})`;
              layer.current.append(span);
            }
            setTextVersion((v) => v + 1);
          } else {
            textNode.style.setProperty("--scale-factor", String(scale));
            text = new pdfjs.TextLayer({
              textContentSource: p.streamTextContent(),
              container: textNode,
              viewport: view,
            });
            await text.render();
            if (active && layer.current) {
              layer.current.style.width = textNode.style.width;
              layer.current.style.height = textNode.style.height;
              layer.current.setAttribute(
                "data-main-rotation",
                String(view.rotation),
              );
              layer.current.replaceChildren(...Array.from(textNode.childNodes));
              setTextVersion((v) => v + 1);
            }
          }
          try {
            const items = await p.getAnnotations({ intent: "display" });
            if (active)
              setAnnotations(items.filter((a) => !a.noView && !a.hidden));
          } catch {
            if (active) setAnnotations([]);
          }
        }
      } catch (e) {
        if (active && (e as Error).name !== "RenderingCancelledException")
          setError(String(e));
      }
    })();
    return () => {
      active = false;
      task?.cancel();
      text?.cancel();
      node.width = 0;
      node.height = 0;
      void (task?.promise.catch(() => {}) || Promise.resolve())
        .then(() => loadedPage?.cleanup())
        .catch(() => {});
    };
  }, [
    pdf,
    page,
    scale,
    rotation,
    thumbnail,
    onSize,
    formRecord?.updated,
    formRevision,
    ocr?.created,
  ]);
  useEffect(() => {
    const term = pdfSearchText(searchTerm);
    if (!term || !layer.current || !box.current) {
      setMatches([]);
      return;
    }
    const container = pdf.isPureXfa ? xfa.current : layer.current;
    if (!container) return;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT),
      nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const positions: { node: Text; offset: number }[] = [],
      parts: string[] = [];
    for (const node of nodes) {
      for (let i = 0; i < node.length; i++) {
        const c = node.data[i];
        if (/\s/u.test(c)) continue;
        const lower = c.toLowerCase();
        for (let j = 0; j < lower.length; j++) {
          parts.push(lower[j]);
          positions.push({ node, offset: i });
        }
      }
    }
    const value = parts.join(""),
      bounds = box.current.getBoundingClientRect(),
      rectangles: {
        left: number;
        top: number;
        width: number;
        height: number;
      }[] = [];
    for (
      let at = value.indexOf(term), hits = 0;
      at >= 0 && hits < 200;
      at = value.indexOf(term, at + term.length), hits++
    ) {
      const start = positions[at],
        end = positions[at + term.length - 1];
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, Math.min(end.node.length, end.offset + 1));
      for (const r of Array.from(range.getClientRects()))
        if (r.width > 0 && r.height > 0)
          rectangles.push({
            left: r.left - bounds.left,
            top: r.top - bounds.top,
            width: r.width,
            height: r.height,
          });
    }
    setMatches(rectangles);
  }, [searchTerm, textVersion, viewport]);
  function select() {
    if (!viewport || !box.current || !onSelection) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const container = pdf.isPureXfa ? xfa.current : layer.current;
    if (
      !container?.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    )
      return;
    const text = selection.toString().trim();
    if (!text) return;
    const bounds = box.current.getBoundingClientRect();
    const rects: PdfNote["rects"] = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .slice(0, 300)
      .map((r) => {
        const a = viewport!.convertToPdfPoint(
          Math.max(0, r.left - bounds.left),
          Math.max(0, r.top - bounds.top),
        );
        const b = viewport!.convertToPdfPoint(
          Math.min(bounds.width, r.right - bounds.left),
          Math.min(bounds.height, r.bottom - bounds.top),
        );
        return [a[0], a[1], b[0], b[1]];
      });
    onSelection({ page, text, rects });
  }
  return (
    <div
      ref={box}
      className={`pr-pdf-page ${pdf.isPureXfa ? "pr-pdf-xfa-page" : ""}`}
      data-pdf-page={page}
      style={
        {
          width: viewport?.width,
          height: viewport?.height,
          minHeight: viewport ? undefined : 120,
          "--scale-factor": scale,
        } as CSSProperties
      }
    >
      <canvas ref={canvas} />
      <div ref={layer} className="pr-pdf-text" onMouseUp={select} />
      <div ref={xfa} className="pr-pdf-xfa" onMouseUp={select} />
      {viewport &&
        notes.flatMap((n) =>
          n.rects.map((rect, i) => {
            const r = viewport.convertToViewportRectangle(rect);
            return (
              <span
                key={`${n.id}:${i}`}
                className="pr-pdf-highlight"
                style={{
                  left: Math.min(r[0], r[2]),
                  top: Math.min(r[1], r[3]),
                  width: Math.abs(r[2] - r[0]),
                  height: Math.abs(r[3] - r[1]),
                  background: n.color,
                }}
              />
            );
          }),
        )}
      {matches.map((r, i) => (
        <span key={`match:${i}`} className="pr-pdf-search-hit" style={r} />
      ))}
      {viewport &&
        !thumbnail &&
        annotations.map((a) => {
          if (!Array.isArray(a.rect) || a.rect.length !== 4) return null;
          const r = viewport.convertToViewportRectangle(a.rect),
            style = {
              left: Math.min(r[0], r[2]),
              top: Math.min(r[1], r[3]),
              width: Math.max(10, Math.abs(r[2] - r[0])),
              height: Math.max(10, Math.abs(r[3] - r[1])),
            };
          const content = a.contentsObj?.str || "",
            title = a.titleObj?.str || a.fieldName || a.subtype;
          if (a.subtype === "Link")
            return (
              <button
                key={a.id}
                className="pr-pdf-link"
                data-pdf-annotation={a.id}
                style={style}
                aria-label={a.url || tr("跳转")}
                title={a.url || tr("跳转")}
                onClick={() => onLink?.(a)}
              />
            );
          if (a.subtype === "Popup") return null;
          const value =
            a.fieldType === "Sig"
              ? tr("数字签名（仅显示）")
              : Array.isArray(a.fieldValue)
                ? a.fieldValue.join(", ")
                : String(a.fieldValue ?? "");
          return (
            <div key={a.id}>
              <button
                className="pr-pdf-native-note"
                data-pdf-annotation={a.id}
                style={{ left: style.left, top: style.top }}
                title={
                  a.subtype === "Widget"
                    ? title
                    : title + " " + (content || value)
                }
                aria-label={title}
                onClick={() => setOpened(opened === a.id ? "" : a.id)}
              >
                ✎
              </button>
              {opened === a.id && (
                <section
                  className="pr-pdf-native-popup"
                  style={{
                    left: Math.min(
                      style.left,
                      Math.max(0, viewport.width - 260),
                    ),
                    top: Math.min(
                      style.top + 26,
                      Math.max(0, viewport.height - 180),
                    ),
                  }}
                >
                  {a.subtype === "Widget" ? (
                    formRecord && onSaveForm ? (
                      <PdfFormEditor
                        key={a.id}
                        annotation={{
                          ...a,
                          password:
                            !!fieldMetadata?.[a.id]?.password || a.password,
                          readOnly: !formAllowed || a.readOnly,
                        }}
                        record={formRecord}
                        onSave={onSaveForm}
                        onAction={onFieldAction}
                        allowActions={allowActions}
                        onSignature={onSignature}
                        onClose={() => setOpened("")}
                      />
                    ) : (
                      <>
                        <p>{tr("表单记录尚未加载，无法保存。")}</p>
                        <button onClick={() => setOpened("")}>
                          {tr("关闭")}
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <strong>{title}</strong>
                      <p dir="auto">
                        {content || value || tr("此批注没有文字内容。")}
                      </p>
                      {a.file && (
                        <button onClick={() => onAttachment?.(a.file!)}>
                          {tr("查看附件")}
                        </button>
                      )}
                      {a.subtype === "Widget" && (
                        <small>
                          {tr("表单内容仅供查看，不会修改原文件。")}
                        </small>
                      )}
                      <button onClick={() => setOpened("")}>
                        {tr("关闭")}
                      </button>
                    </>
                  )}
                </section>
              )}
            </div>
          );
        })}
      {error && (
        <div role="alert" className="pr-pdf-page-error">
          {"" + tr("第") + " "}
          {page} {" " + tr("页：") + ""}
          {error}
        </div>
      )}
    </div>
  );
}
