import {
  ArrowLeft,
  Settings2,
  Maximize,
  ListTree,
  PanelsTopLeft,
  Search,
  Bookmark,
  Highlighter,
  FilePenLine,
  MessageSquareText,
  Paperclip,
  ScanText,
  BadgeCheck,
  Info,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Languages,
  Volume2,
} from "lucide-react";
import { tr, trFormat } from "./i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PageViewport,
} from "pdfjs-dist";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pdfSource } from "./pdfSource";
import {
  createPdfTranslation,
  pdfTranslationKey,
  readPdfTranslation,
  savePdfTranslation,
  type PdfTranslation,
} from "./pdfTranslation";
import { pdfSearchMatch } from "./pdfSearch";
import { identifyPdfCover, renderPdfCover } from "./pdfCover";
import PdfBilingual from "./PdfBilingual";
import { useStore, trackExtraWrite } from "./store";
import { saveFile } from "./export";
import type { Book } from "./types";
import type {
  PdfNote,
  PdfSelection,
  PdfSettings,
  PdfAnnotation,
  PdfFormRecord,
  PdfFormValue,
  PdfFieldObject,
  PdfAttachment,
  PdfOcrRecord,
  PdfPosition,
} from "./pdfTypes";
import PdfPage from "./PdfPage";
import PdfSignatures from "./PdfSignatures";
import PdfDocumentInfo from "./PdfDocumentInfo";
import PdfNotesImport from "./PdfNotesImport";
import {
  resolvePdfPage,
  pushPdfPage,
  validPdfPosition,
  type PdfPageHistory,
} from "./pdfNavigation";
import { exportPdfHighlights } from "./pdfNoteExport";
import PdfFormSubmit from "./PdfFormSubmit";
import { calculatePdfForm } from "./pdfScripting";
import PdfOcrPanel from "./PdfOcrPanel";
import { readOcr } from "./pdfOcr";
import PdfAttachments, { PdfMediaPreview } from "./PdfAttachments";
import { collectXfa } from "./pdfXfa";
import { registerWritePreparation } from "./persistenceHooks";
import "./pdf-xfa.css";
import PdfNativeNotes from "./PdfNativeNotes";
import {
  applyForms,
  formKey,
  loadForms,
  storeForms,
  validForms,
  canFill,
} from "./pdfForms";
import "./pdf-reader.css";

const initialSettings = (book: Book): PdfSettings => ({
  mode: "single",
  fit: book.documentFit || "page",
  scale: book.documentScale || 1,
  rotation: book.documentRotation || 0,
  brightness: book.readingPrefs?.readerBrightness ?? 100,
  theme: "paper",
  voice: "",
  rate: 1,
  ...book.pdfSettings,
  ...(validPdfPosition(book.pdfPosition) ? book.pdfPosition.view : {}),
});
const message = (e: unknown) => tr(e instanceof Error ? e.message : String(e));
export default function PdfReader({
  book,
  onBack,
}: {
  book: Book;
  onBack: () => void;
}) {
  const language = useStore((s) => s.prefs.uiLanguage);
  const patch = useStore((s) => s.patch),
    stage = useRef<HTMLDivElement>(null),
    bookRef = useRef(book);
  bookRef.current = book;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [password, setPassword] = useState(""),
    [passwordPrompt, setPasswordPrompt] = useState("");
  const passwordCallback = useRef<((s: string) => void) | null>(null);
  const [settings, setSettings] = useState(() => initialSettings(book)),
    settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pageViews = useRef(
    new Map<
      number,
      { view: PageViewport; node: HTMLDivElement; rotation: number }
    >(),
  );
  const [layoutRevision, setLayoutRevision] = useState(0);
  const pendingPosition = useRef<PdfPosition | null>(
    validPdfPosition(book.pdfPosition) ? book.pdfPosition : null,
  );
  const lastPosition = useRef<PdfPosition | null>(pendingPosition.current);
  const navigationToken = useRef(0);
  const registerViewport = useCallback(
    (
      number: number,
      view: PageViewport | null,
      node: HTMLDivElement | null,
    ) => {
      if (view && node) {
        pageViews.current.set(number, {
          view,
          node,
          rotation: settingsRef.current.rotation,
        });
        setLayoutRevision((v) => v + 1);
      } else pageViews.current.delete(number);
    },
    [],
  );
  const [page, setPage] = useState(
      validPdfPosition(book.pdfPosition)
        ? book.pdfPosition.page
        : Math.max(1, Number(book.documentLocation) || 1),
    ),
    pageRef = useRef(page);
  pageRef.current = page;
  const [dims, setDims] = useState({ w: 1000, h: 700 }),
    [sizes, setSizes] = useState<Record<number, [number, number]>>({});
  const [sidebar, setSidebar] = useState<
    | "outline"
    | "search"
    | "bookmarks"
    | "notes"
    | "thumbnails"
    | "native"
    | "attachments"
    | "ocr"
    | "signatures"
    | "info"
    | ""
  >("");
  const [outline, setOutline] = useState<
    { title: string; dest: unknown; depth: number }[]
  >([]);
  const [pageLabels, setPageLabels] = useState<string[]>([]),
    [pageDraft, setPageDraft] = useState(String(page));
  const pageInput = useRef<HTMLInputElement>(null);
  const [outlineQuery, setOutlineQuery] = useState("");
  const pageHistory = useRef<PdfPageHistory>({ back: [], forward: [] });
  const [, updateHistory] = useState(0);
  useEffect(() => {
    setPageDraft(pageLabels[page - 1] || String(page));
  }, [page, pageLabels]);
  useEffect(() => {
    pageHistory.current = { back: [], forward: [] };
    setPageLabels([]);
    updateHistory((v) => v + 1);
  }, [book.id]);
  const [query, setQuery] = useState(""),
    [searchBusy, setSearchBusy] = useState(false),
    [searchStatus, setSearchStatus] = useState(""),
    [results, setResults] = useState<{ page: number; text: string }[]>([]);
  const searchToken = useRef(0),
    textCache = useRef(new Map<number, string>());
  const [selection, setSelection] = useState<PdfSelection | null>(null),
    [draft, setDraft] = useState(""),
    [color, setColor] = useState("#f0ce62"),
    [editId, setEditId] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [notice, setNotice] = useState(""),
    [scrollTop, setScrollTop] = useState(0),
    [scrollLeft, setScrollLeft] = useState(0),
    pendingPage = useRef<number | null>(
      validPdfPosition(book.pdfPosition)
        ? book.pdfPosition.page
        : Math.max(1, Number(book.documentLocation) || 1),
    );
  const [translationOpen, setTranslationOpen] = useState(false),
    [apiKey, setApiKey] = useState(""),
    [base, setBase] = useState("https://api.deepseek.com"),
    [model, setModel] = useState("DeepSeek-V4.1-Flash-1017"),
    [target, setTarget] = useState(book.translationTarget || "简体中文"),
    [autoTranslate, setAutoTranslate] = useState(false),
    [translated, setTranslated] = useState(""),
    [translating, setTranslating] = useState(false),
    [translationError, setTranslationError] = useState("");
  const translationToken = useRef(0);
  const [aligned, setAligned] = useState<PdfTranslation | null>(null),
    [alignedKey, setAlignedKey] = useState(""),
    [translationProgress, setTranslationProgress] = useState("");
  const [searchTerm, setSearchTerm] = useState(""),
    [externalUrl, setExternalUrl] = useState("");
  const translationView = settings.translationView || "original";
  const [selectionTranslation, setSelectionTranslation] = useState<{
    page: number;
    text: string;
  } | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [speaking, setSpeaking] = useState(false),
    [paused, setPaused] = useState(false),
    [continuousVoice, setContinuousVoice] = useState(false);
  const speechToken = useRef(0),
    continuousRef = useRef(continuousVoice);
  continuousRef.current = continuousVoice;
  const [showSettings, setShowSettings] = useState(false),
    [showText, setShowText] = useState(false),
    [pageText, setPageText] = useState("");
  const [chromeVisible, setChromeVisible] = useState(false),
    [menuFocused, setMenuFocused] = useState(false);
  const hideChromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    topChrome = useRef<HTMLDivElement>(null),
    bottomChrome = useRef<HTMLElement>(null);
  const [chromeSize, setChromeSize] = useState({ top: 100, bottom: 65 });
  function cancelChromeHide() {
    if (hideChromeTimer.current !== null) {
      clearTimeout(hideChromeTimer.current);
      hideChromeTimer.current = null;
    }
  }
  function scheduleChromeHide() {
    if (hideChromeTimer.current !== null) return;
    hideChromeTimer.current = setTimeout(() => {
      setChromeVisible(false);
      hideChromeTimer.current = null;
    }, 600);
  }
  useEffect(() => () => cancelChromeHide(), []);
  useEffect(() => {
    const update = () =>
      setChromeSize({
        top: topChrome.current?.offsetHeight || 100,
        bottom: bottomChrome.current?.offsetHeight || 65,
      });
    const observer = new ResizeObserver(update);
    if (topChrome.current) observer.observe(topChrome.current);
    if (bottomChrome.current) observer.observe(bottomChrome.current);
    update();
    return () => observer.disconnect();
  }, []);
  const [submitRecord, setSubmitRecord] = useState<PdfFormRecord | null>(null),
    [calculating, setCalculating] = useState(false);
  const calculationQueue = useRef<Promise<unknown>>(Promise.resolve()),
    scriptAbort = useRef(new AbortController());
  useEffect(() => {
    scriptAbort.current = new AbortController();
    return () => scriptAbort.current.abort();
  }, [book.id]);
  function queueCalculation(callback: () => Promise<void>) {
    const job = calculationQueue.current
      .catch(() => {})
      .then(async () => {
        if (scriptAbort.current.signal.aborted) throw Error(tr("计算已取消。"));
        setCalculating(true);
        try {
          await callback();
        } finally {
          setCalculating(false);
        }
      });
    calculationQueue.current = job.catch(() => {});
    return trackExtraWrite(job);
  }
  const [forms, setForms] = useState<PdfFormRecord | null>(null),
    formsRef = useRef<PdfFormRecord | null>(null),
    formQueue = useRef<Promise<void>>(Promise.resolve());
  const [fields, setFields] = useState<Record<string, PdfFieldObject[]>>({}),
    [formAllowed, setFormAllowed] = useState(true),
    [formsReady, setFormsReady] = useState(false),
    [fieldError, setFieldError] = useState(""),
    [exportingForms, setExportingForms] = useState(false);
  const [ocrPages, setOcrPages] = useState<Record<number, PdfOcrRecord>>({});
  const [media, setMedia] = useState<PdfAttachment | null>(null),
    [xfaDirty, setXfaDirty] = useState(false),
    xfaDirtyRef = useRef(false);
  const [pdfLength, setPdfLength] = useState(0),
    [formDialog, setFormDialog] = useState<"reset" | "import" | "">(""),
    [pendingForms, setPendingForms] = useState<PdfFormRecord | null>(null);
  const [focusAnnotation, setFocusAnnotation] = useState<{
    id: string;
    page: number;
    sequence: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    formsRef.current = null;
    setForms(null);
    void loadForms(book.id)
      .then((data) => {
        if (active) {
          formsRef.current = data;
          setForms(data);
        }
      })
      .catch((e) => {
        if (active) setNotice(message(e));
      });
    return () => {
      active = false;
    };
  }, [book.id]);
  useEffect(() => {
    if (!pdf) return;
    let active = true;
    setFormsReady(false);
    setFieldError("");
    void (async () => {
      try {
        const [objects, permissions, metadata] = await Promise.all([
          pdf.getFieldObjects(),
          pdf.getPermissions(),
          pdf.getMetadata(),
        ]);
        if (!active) return;
        const info = metadata.info as Record<string, unknown>;
        if (info.IsXFAPresent && !info.IsAcroFormPresent && !pdf.isPureXfa)
          setNotice(tr("此 XFA 文档未生成可交互页面。"));
        const values = (objects || {}) as Record<string, PdfFieldObject[]>;
        if (Object.values(values).reduce((n, v) => n + v.length, 0) > 5000)
          throw Error(tr("此 PDF 表单字段过多，暂不支持填写。"));
        setFields(values);
        setFormAllowed(
          !permissions || permissions.includes(256) || permissions.includes(32),
        );
        setFormsReady(true);
      } catch (e) {
        if (active) {
          setNotice(message(e));
          setFieldError(message(e));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [pdf]);
  const fieldMetadata = useMemo(
    () =>
      Object.fromEntries(
        Object.values(fields)
          .flat()
          .map((f) => [f.id, f]),
      ),
    [fields],
  );
  useLayoutEffect(() => {
    if (pdf && forms && formsReady && formAllowed)
      applyForms(pdf, fields, forms);
  }, [pdf, forms, fields, formsReady, formAllowed]);
  function writeForms(
    values:
      | Record<string, PdfFormValue>
      | ((current: PdfFormRecord) => Record<string, PdfFormValue>),
    formatted?: Record<string, string>,
  ) {
    const job = formQueue.current
      .catch(() => {})
      .then(async () => {
        const current = formsRef.current;
        if (!current || current.bookId !== book.id)
          throw Error(tr("表单记录尚未加载，无法保存。"));
        const next: PdfFormRecord = {
          version: 1,
          bookId: book.id,
          values: typeof values === "function" ? values(current) : values,
          formatted: formatted ?? current.formatted,
          updated: Math.max(Date.now(), current.updated + 1),
        };
        await storeForms(next);
        formsRef.current = next;
        setForms(next);
      });
    formQueue.current = job;
    return trackExtraWrite(job);
  }
  useEffect(() => {
    if (!pdf?.isPureXfa) return;
    const storage = pdf.annotationStorage,
      previous = storage.onSetModified,
      previousReset = storage.onResetModified;
    storage.onSetModified = () => {
      xfaDirtyRef.current = true;
      setXfaDirty(true);
      previous?.();
    };
    storage.onResetModified = () => {
      xfaDirtyRef.current = false;
      setXfaDirty(false);
      previousReset?.();
    };
    return () => {
      storage.onSetModified = previous;
      storage.onResetModified = previousReset;
    };
  }, [pdf]);
  async function saveXfa() {
    if (!pdf?.isPureXfa || !formAllowed || !formsReady) return;
    await writeForms(collectXfa(pdf));
    pdf.annotationStorage.resetModified();
    xfaDirtyRef.current = false;
    setXfaDirty(false);
  }
  useEffect(
    () =>
      registerWritePreparation(async () => {
        try {
          await calculationQueue.current;
          await formQueue.current;
          if (pdf?.isPureXfa && xfaDirtyRef.current) await saveXfa();
          if (pdf) await saveReadingPosition(true);
        } catch (e) {
          setNotice(message(e));
          throw e;
        }
      }),
    [pdf, book.id, formsReady, formAllowed],
  );
  async function leaveReader() {
    try {
      await calculationQueue.current;
      if (xfaDirtyRef.current) await saveXfa();
      await formQueue.current;
      await saveReadingPosition(true);
      onBack();
    } catch (e) {
      setNotice(message(e));
    }
  }
  function previewAttachment(file: PdfAttachment) {
    if (!(file.content instanceof Uint8Array)) {
      setNotice(tr("附件无法读取"));
      return;
    }
    if (file.content.byteLength > 32 * 1024 * 1024) {
      setNotice(tr("附件超过 32 MB，暂不导出。"));
      return;
    }
    setMedia(file);
  }
  async function saveForm(annotation: PdfAnnotation, value: PdfFormValue) {
    if (
      !formAllowed ||
      !formsReady ||
      fieldMetadata[annotation.id]?.password ||
      !canFill(annotation)
    )
      throw Error(tr("此字段不可填写。"));
    await queueCalculation(async () => {
      if (settingsRef.current.formScripts && pdf) {
        await formQueue.current.catch(() => {});
        const record = formsRef.current;
        if (!record) throw Error(tr("表单记录尚未加载，无法保存。"));
        const result = await calculatePdfForm(
          pdf,
          fields,
          record,
          language,
          {
            id: annotation.id,
            value,
            button: !!(annotation.checkBox || annotation.radioButton),
          },
          scriptAbort.current.signal,
        );
        await writeForms(result.values, {
          ...record.formatted,
          ...result.formatted,
        });
        if (result.notices.length || result.blockedActions.length)
          setNotice(
            [
              ...result.notices,
              ...result.blockedActions.map((action) =>
                trFormat("文档动作未执行：{0}", action),
              ),
            ].join("\n"),
          );
      } else
        await writeForms(
          (current) => ({ ...current.values, [formKey(annotation)]: value }),
          { ...formsRef.current?.formatted, [annotation.id]: "" },
        );
    });
  }
  async function executeFieldAction(annotation: PdfAnnotation) {
    if (!pdf || !settingsRef.current.formScripts || !formAllowed)
      throw Error(tr("请先在阅读设置中启用隔离表单计算。"));
    const actions = fieldMetadata[annotation.id]?.actions;
    if (
      !["Action", "MouseUp", "MouseDown"].some(
        (name) => actions?.[name]?.length,
      )
    )
      throw Error(tr("此按钮没有受支持的 JavaScript 动作。"));
    await queueCalculation(async () => {
      const record = formsRef.current;
      if (!record) return;
      const result = await calculatePdfForm(
        pdf,
        fields,
        record,
        language,
        { id: annotation.id, value: "", action: true },
        scriptAbort.current.signal,
      );
      await writeForms(result.values, {
        ...record.formatted,
        ...result.formatted,
      });
      if (result.notices.length || result.blockedActions.length)
        setNotice(
          [
            ...result.notices,
            ...result.blockedActions.map((action) =>
              trFormat("文档动作未执行：{0}", action),
            ),
          ].join("\n"),
        );
    });
  }
  async function recalculateForms() {
    try {
      await queueCalculation(async () => {
        if (!pdf || !formsRef.current) return;
        const result = await calculatePdfForm(
          pdf,
          fields,
          formsRef.current,
          language,
          undefined,
          scriptAbort.current.signal,
        );
        await writeForms(result.values, {
          ...formsRef.current.formatted,
          ...result.formatted,
        });
        setNotice(result.notices.join("\n") || tr("表单重新计算完成。"));
      });
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function openSubmit() {
    try {
      await calculationQueue.current;
      await formQueue.current;
      if (pdf?.isPureXfa && xfaDirtyRef.current) await saveXfa();
      if (formsRef.current) setSubmitRecord(structuredClone(formsRef.current));
    } catch (e) {
      setNotice(message(e));
    }
  }

  async function exportFormData() {
    try {
      if (pdf?.isPureXfa && xfaDirtyRef.current) await saveXfa();
      await calculationQueue.current;
      await formQueue.current;
      const current = formsRef.current;
      if (!current || current.bookId !== book.id)
        throw Error(tr("表单记录尚未加载，无法保存。"));
      await saveFile(
        book.title.replace(/[\\/:*?"<>|]/g, "_") + "-forms.json",
        JSON.stringify({ ...current, title: book.title }, null, 2),
      );
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function readFormImport(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error(tr("表单数据文件不能超过 5 MB。"));
      const data: unknown = JSON.parse(await file.text());
      if (!validForms(data, book.id))
        throw Error(tr("表单数据无效或不属于此文档。"));
      setPendingForms(data);
      setFormDialog("import");
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function exportFilledPdf() {
    if (!pdf || exportingForms) return;
    setExportingForms(true);
    try {
      if (!formAllowed || !formsReady)
        throw Error(tr("此 PDF 不允许填写表单。"));
      if (
        Object.values(fieldMetadata).some(
          (f) => f.type === "signature" && f.signature?.present,
        )
      )
        throw Error(tr("含数字签名的文档不另存填写副本，请导出表单数据。"));
      if (pdfLength > 32 * 1024 * 1024)
        throw Error(
          tr("为避免内存不足，超过 32 MB 的文档请导出表单 JSON 数据。"),
        );
      if (pdf?.isPureXfa && xfaDirtyRef.current) await saveXfa();
      await formQueue.current;
      const current = formsRef.current;
      if (!current || current.bookId !== book.id)
        throw Error(tr("表单记录尚未加载，无法保存。"));
      applyForms(pdf, fields, current);
      const bytes = await pdf.saveDocument();
      await saveFile(
        book.title.replace(/[\\/:*?"<>|]/g, "_") + "-filled.pdf",
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
      );
    } catch (e) {
      setNotice(message(e));
    } finally {
      setExportingForms(false);
    }
  }
  const notes = book.pdfNotes || [],
    legacyNotes = book.documentNotes || [];

  function change(values: Partial<PdfSettings>) {
    if (
      values.translationView &&
      pendingPosition.current &&
      (pendingPosition.current.view.translationView || "original") !==
        values.translationView
    )
      pendingPosition.current = null;
    if (
      values.translationView &&
      values.translationView !== settingsRef.current.translationView
    ) {
      pendingPage.current = pageRef.current;
      if (values.translationView !== "original")
        stage.current?.scrollTo({ top: 0, left: 0 });
    }
    const next = { ...settingsRef.current, ...values };
    if (
      !pendingPosition.current &&
      count &&
      (next.translationView || "original") === "original" &&
      (settingsRef.current.translationView || "original") === "original" &&
      ["mode", "fit", "scale", "rotation"].some(
        (key) =>
          key in values &&
          next[key as keyof PdfSettings] !==
            settingsRef.current[key as keyof PdfSettings],
      )
    ) {
      const anchor = capturePosition();
      anchor.view = {
        mode: next.mode,
        fit: next.fit,
        scale: next.scale,
        rotation: next.rotation,
        translationView: "original",
      };
      pendingPosition.current = anchor;
      pendingPage.current = anchor.page;
    }
    settingsRef.current = next;
    setSettings(next);
    void patch(book.id, { pdfSettings: next });
  }
  const stopSpeech = useCallback(() => {
    speechToken.current++;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setPaused(false);
  }, []);
  useEffect(() => {
    let active = true,
      opened = false,
      task: PDFDocumentLoadingTask | undefined;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const { default: engine } = await import("./pdfEngine");
        const source = await pdfSource(book.id, (e) => {
          if (active) {
            setError(trFormat("PDF 副本读取失败：{0}", message(e)));
            setLoading(false);
            void task?.destroy();
          }
        });
        if (!active) {
          source.range.abort();
          return;
        }
        setPdfLength(source.length);
        task = engine.getDocument({
          ...source,
          cMapUrl: new URL("/pdf-resources/cmaps/", location.href).href,
          cMapPacked: true,
          standardFontDataUrl: new URL(
            "/pdf-resources/standard_fonts/",
            location.href,
          ).href,
          isEvalSupported: false,
          enableXfa: true,
          canvasMaxAreaInBytes: 16 * 1024 * 1024,
        });
        task.onPassword = (callback: (s: string) => void, reason: number) => {
          if (!active) return;
          passwordCallback.current = callback;
          setPasswordPrompt(
            reason === 2 ? tr("密码不正确，请重试") : tr("此 PDF 需要密码"),
          );
        };
        const doc = await task.promise;
        if (!active) {
          await doc.destroy();
          return;
        }
        opened = true;
        setPdf(doc);
        if (
          pendingPosition.current &&
          pendingPosition.current.page > doc.numPages
        ) {
          pendingPosition.current = {
            ...pendingPosition.current,
            page: doc.numPages,
            x: undefined,
            y: undefined,
          };
          pendingPage.current = doc.numPages;
        }
        setPage((p) => Math.min(doc.numPages, p));
        setPasswordPrompt("");
        setLoading(false);
        void patch(book.id, { documentPageCount: doc.numPages });
        void doc
          .getPageLabels()
          .then((labels) => {
            if (active && labels?.length === doc.numPages)
              setPageLabels(
                labels.map((label) => (typeof label === "string" ? label : "")),
              );
          })
          .catch(() => {
            if (active) setNotice(tr("页码标签读取失败，仍可使用实际页码。"));
          });
        const first = await doc.getPage(1);
        if (!active) return;
        const v = first.getViewport({ scale: 1 });
        setSizes({ 1: [v.width, v.height] });
        if (!bookRef.current.coverImage && !bookRef.current.pdfCover)
          void identifyPdfCover(doc, bookRef.current.title)
            .then((cover) => {
              const current = useStore
                .getState()
                .books.find((item) => item.id === book.id);
              if (active && current && !current.coverImage && !current.pdfCover)
                void patch(book.id, (book) =>
                  book.coverImage || book.pdfCover ? {} : cover,
                );
            })
            .catch(() => {});
        try {
          const list = await doc.getOutline(),
            flat: { title: string; dest: unknown; depth: number }[] = [];
          const walk = (items: typeof list, depth: number) => {
            for (const item of items || []) {
              if (item.dest)
                flat.push({ title: item.title, dest: item.dest, depth });
              walk(item.items, depth + 1);
            }
          };
          walk(list, 0);
          if (active) setOutline(flat);
        } catch {
          if (active) setNotice(tr("目录读取失败，仍可使用页码导航。"));
        }
      } catch (e) {
        if (active) {
          setError(trFormat("无法打开 PDF：{0}", message(e)));
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      if (opened)
        void patch(book.id, {
          documentLocation: String(pageRef.current),
          ...(lastPosition.current
            ? { pdfPosition: lastPosition.current }
            : {}),
        });
      passwordCallback.current = null;
      searchToken.current++;
      navigationToken.current++;
      translationToken.current++;
      stopSpeech();
      void task?.destroy();
      textCache.current.clear();
    };
  }, [book.id, patch, stopSpeech]);
  useEffect(() => {
    if (!stage.current) return;
    const node = stage.current;
    const update = () => {
      if (
        !pendingPosition.current &&
        pageViews.current.size &&
        (settingsRef.current.translationView || "original") === "original"
      ) {
        pendingPosition.current = capturePosition();
        pendingPage.current = pendingPosition.current.page;
      }
      setDims({ w: node.clientWidth, h: node.clientHeight });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, [loading]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () =>
      setVoices(synth.getVoices().filter((v) => v.localService));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  const updateSize = useCallback(
    (number: number, w: number, h: number) =>
      setSizes((old) =>
        old[number]?.[0] === w && old[number]?.[1] === h
          ? old
          : { ...old, [number]: [w, h] },
      ),
    [],
  );
  const count = pdf?.numPages || 0;
  const baseSize = sizes[settings.mode === "scroll" ? 1 : page] ||
    sizes[1] || [612, 792];
  const reference =
    settings.rotation % 180 ? [baseSize[1], baseSize[0]] : baseSize;
  const scale =
    settings.fit === "manual"
      ? Math.max(0.1, Math.min(4, settings.scale))
      : Math.max(
          0.05,
          Math.min(
            4,
            settings.fit === "width"
              ? (dims.w - 48) /
                  (reference[0] * (settings.mode === "spread" ? 2 : 1))
              : Math.min(
                  (dims.w - 48) /
                    (reference[0] * (settings.mode === "spread" ? 2 : 1)),
                  (dims.h - 36) / reference[1],
                ),
          ),
        );
  // Scroll uses lightweight page heights; only a small visible range mounts canvas/text layers.
  const offsets = useMemo(() => {
    const values = [0];
    for (let i = 1; i <= count; i++) {
      const size = sizes[i] || sizes[1] || [612, 792];
      const height = (settings.rotation % 180 ? size[0] : size[1]) * scale;
      values.push(values[i - 1] + height + 24);
    }
    return values;
  }, [count, sizes, settings.rotation, scale]);
  const findAt = useCallback(
    (y: number) => {
      let lo = 0,
        hi = count - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (offsets[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [count, offsets],
  );
  const firstVisible = count ? findAt(scrollTop) : 0,
    lastVisible = count ? findAt(scrollTop + dims.h) : 0;
  const start = Math.max(0, firstVisible - 1),
    end = Math.min(count, lastVisible + 3);
  useEffect(() => {
    if (!pdf) return;
    let active = true;
    const numbers = [Math.max(1, page - 1), page, Math.min(count, page + 1)];
    void Promise.all([...new Set(numbers)].map((n) => readOcr(book.id, n)))
      .then((records) => {
        if (active)
          setOcrPages((old) =>
            Object.fromEntries(
              [
                ...Object.entries(old).filter(
                  ([key]) => !numbers.includes(Number(key)),
                ),
                ...records
                  .filter((r): r is PdfOcrRecord => !!r)
                  .map((r) => [String(r.page), r] as const),
              ].slice(-6),
            ),
          );
      })
      .catch((e) => {
        if (active) setNotice(message(e));
      });
    return () => {
      active = false;
    };
  }, [pdf, page, count, book.id]);
  function updateOcr(number: number, record: PdfOcrRecord | null) {
    textCache.current.delete(number);
    setOcrPages((old) => {
      const next = { ...old };
      if (record) next[number] = record;
      else delete next[number];
      return next;
    });
  }
  const previousOffsets = useRef<number[]>([]);
  const restoredOffsets = useRef<number[] | null>(null);
  function capturePosition(): PdfPosition {
    const current = settingsRef.current;
    const result: PdfPosition = {
      page: pageRef.current,
      view: {
        mode: current.mode,
        fit: current.fit,
        scale: current.scale,
        rotation: current.rotation,
        translationView: current.translationView || "original",
      },
    };
    const entry = pageViews.current.get(result.page),
      container = stage.current;
    if (entry && container && result.view.translationView === "original") {
      const bounds = entry.node.getBoundingClientRect(),
        outer = container.getBoundingClientRect();
      const point = entry.view.convertToPdfPoint(
        Math.max(0, Math.min(entry.view.width, outer.left + 12 - bounds.left)),
        Math.max(0, Math.min(entry.view.height, outer.top + 12 - bounds.top)),
      );
      [result.x, result.y] = point;
    }
    return result;
  }
  async function saveReadingPosition(requireCommit = false) {
    if (!pdf || pendingPosition.current) return;
    const position = capturePosition();
    lastPosition.current = position;
    const saved = await patch(book.id, {
      documentLocation: String(position.page),
      pdfPosition: position,
    });
    if (!saved && requireCommit)
      throw Error(tr("保存失败，请检查磁盘空间后重试。"));
  }
  useLayoutEffect(() => {
    const target = pendingPosition.current,
      container = stage.current;
    if (!target || !pdf || !container || target.page > count) return;
    if ((target.view.translationView || "original") !== "original") {
      pendingPosition.current = null;
      return;
    }
    const entry = pageViews.current.get(target.page);
    if (
      !entry ||
      Math.abs(entry.view.scale - scale) > 0.00001 ||
      entry.rotation !== settings.rotation ||
      settings.mode !== target.view.mode ||
      translationView !== "original"
    )
      return;
    const [x, y] = entry.view.convertToViewportPoint(
      target.x ?? entry.view.viewBox[0],
      target.y ?? entry.view.viewBox[3],
    );
    const bounds = entry.node.getBoundingClientRect(),
      outer = container.getBoundingClientRect();
    container.scrollTop += bounds.top - outer.top + Math.max(0, y) - 12;
    container.scrollLeft += bounds.left - outer.left + Math.max(0, x) - 12;
    pendingPosition.current = null;
    pendingPage.current = null;
    lastPosition.current = target;
    restoredOffsets.current = offsets;
    setScrollTop(container.scrollTop);
  }, [
    pdf,
    layoutRevision,
    scale,
    settings.mode,
    settings.rotation,
    translationView,
    count,
    offsets,
  ]);
  useLayoutEffect(() => {
    const previous = previousOffsets.current;
    previousOffsets.current = offsets;
    if (
      settings.mode !== "scroll" ||
      translationView !== "original" ||
      !stage.current ||
      pendingPage.current !== null ||
      previous.length !== offsets.length ||
      previous.length < 2 ||
      pendingPosition.current !== null ||
      restoredOffsets.current === offsets
    )
      return;
    const y = stage.current.scrollTop;
    let index = 0;
    while (index < previous.length - 2 && previous[index + 1] <= y) index++;
    const adjusted = (offsets[index] || 0) + y - previous[index];
    if (Math.abs(adjusted - y) > 1) {
      stage.current.scrollTop = adjusted;
      setScrollTop(adjusted);
    }
  }, [offsets, settings.mode, translationView]);
  useEffect(() => {
    if (
      settings.mode === "scroll" &&
      translationView === "original" &&
      pendingPage.current !== null &&
      stage.current &&
      count
    ) {
      stage.current.scrollTop =
        offsets[Math.min(count, pendingPage.current) - 1] || 0;
      pendingPage.current = null;
    }
  }, [settings.mode, count, offsets, translationView]);
  useEffect(() => {
    if (!pdf) return;
    const timer = window.setTimeout(() => void saveReadingPosition(), 500);
    return () => clearTimeout(timer);
  }, [pdf, page, book.id, patch]);
  useEffect(() => {
    if (!pdf) return;
    const timer = setTimeout(() => void saveReadingPosition(), 700);
    return () => clearTimeout(timer);
  }, [scrollTop, scrollLeft, settings, pdf]);
  useEffect(() => {
    if (!pdf) return;
    const timer = window.setInterval(() => {
      if (document.hidden || !document.hasFocus()) return;
      const current = useStore.getState().books.find((b) => b.id === book.id);
      if (!current) return;
      const day = new Date().toLocaleDateString("sv-SE");
      void patch(book.id, {
        seconds: current.seconds + 15,
        daily: { ...current.daily, [day]: (current.daily[day] || 0) + 15 },
      });
    }, 15000);
    return () => clearInterval(timer);
  }, [pdf, book.id, patch]);
  async function updatePdfCover(mode: "auto" | "manual") {
    if (!pdf || coverBusy) return;
    const selectedPage = page;
    setCoverBusy(true);
    try {
      const cover =
        mode === "auto"
          ? await identifyPdfCover(pdf, bookRef.current.title)
          : {
              coverImage: await renderPdfCover(pdf, selectedPage),
              pdfCover: { source: "manual" as const, page: selectedPage },
            };
      if (!(await patch(book.id, cover)))
        throw Error(tr("保存失败，请检查磁盘空间后重试。"));
      setNotice(
        cover.pdfCover && "page" in cover.pdfCover
          ? trFormat("已使用第 {0} 页作为封面。", cover.pdfCover.page)
          : tr("未识别到封面，已使用书库设计封面。"),
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setCoverBusy(false);
    }
  }

  function go(next: number, fromVoice = false, recordHistory = true) {
    if (!count || !Number.isFinite(next)) return;
    navigationToken.current++;
    if (!fromVoice) stopSpeech();
    const number = Math.max(1, Math.min(count, Math.trunc(next)));
    if (recordHistory && !fromVoice) {
      pushPdfPage(pageHistory.current, capturePosition(), number);
      updateHistory((v) => v + 1);
    }
    pageRef.current = number;
    pendingPosition.current = null;
    setPage(number);
    if (settings.mode === "scroll" && translationView === "original") {
      pendingPage.current = number;
      if (stage.current) {
        stage.current.scrollTop = offsets[number - 1];
        pendingPage.current = null;
      }
    } else stage.current?.scrollTo({ top: 0, left: 0 });
    setSelection(null);
    lastPosition.current = capturePosition();
  }
  function travelHistory(direction: "back" | "forward") {
    const history = pageHistory.current;
    const target = history[direction].pop();
    if (target === undefined) return;
    history[direction === "back" ? "forward" : "back"].push(capturePosition());
    restorePosition(target, false);
    updateHistory((v) => v + 1);
  }
  function restorePosition(target: PdfPosition, recordHistory = true) {
    if (!validPdfPosition(target) || target.page > count) return;
    const current = capturePosition();
    if (
      recordHistory &&
      current.page === target.page &&
      JSON.stringify(current) !== JSON.stringify(target)
    ) {
      pageHistory.current.back.push(current);
      if (pageHistory.current.back.length > 100)
        pageHistory.current.back.shift();
      pageHistory.current.forward = [];
    }
    go(target.page, false, recordHistory);
    pendingPosition.current = target;
    lastPosition.current = target;
    pendingPage.current = target.page;
    change(target.view);
    setLayoutRevision((v) => v + 1);
  }
  function commitPageDraft() {
    if (
      pageDraft === (pageLabels[pageRef.current - 1] || String(pageRef.current))
    )
      return;
    const target = resolvePdfPage(pageDraft, pageLabels, count);
    if (target === null) {
      setNotice(tr("页码无效或标签重复。可输入 # 加实际页码，例如 #12。"));
      setPageDraft(pageLabels[pageRef.current - 1] || String(pageRef.current));
    } else go(target);
  }
  function switchMode(mode: PdfSettings["mode"]) {
    pendingPage.current = page;
    change({ mode });
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).matches(
          "input,select,textarea,[contenteditable]",
        )
      )
        return;
      const step =
        settings.mode === "spread" && translationView === "original" ? 2 : 1;
      if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        travelHistory(event.key === "ArrowLeft" ? "back" : "forward");
        return;
      }
      if (
        ["ArrowRight", "PageDown", "ArrowDown"].includes(event.key) &&
        (settings.mode !== "scroll" || translationView !== "original")
      ) {
        event.preventDefault();
        go(pageRef.current + step);
      }
      if (
        ["ArrowLeft", "PageUp", "ArrowUp"].includes(event.key) &&
        (settings.mode !== "scroll" || translationView !== "original")
      ) {
        event.preventDefault();
        go(pageRef.current - step);
      }
      if (event.key === "Home") {
        event.preventDefault();
        go(1);
      }
      if (event.key === "End") {
        event.preventDefault();
        go(count);
      }
      if (event.key === "Tab") setChromeVisible(true);
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        setChromeVisible(true);
        setSidebar("search");
      }
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setChromeVisible(true);
        requestAnimationFrame(() => {
          pageInput.current?.focus();
          pageInput.current?.select();
        });
      }
      if (event.key === "Escape") {
        setSelection(null);
        setSidebar("");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  async function textFor(number: number) {
    const cached = textCache.current.get(number);
    if (cached !== undefined) return cached;
    if (!pdf) throw Error(tr("PDF 尚未打开"));
    const recognized = await readOcr(book.id, number);
    if (recognized) {
      textCache.current.set(number, recognized.text);
      if (textCache.current.size > 20)
        textCache.current.delete(textCache.current.keys().next().value!);
      return recognized.text;
    }
    const p = await pdf.getPage(number),
      content = await p.getTextContent();
    const value = content.items
      .map((item) =>
        "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
      )
      .join("")
      .trim();
    textCache.current.set(number, value);
    if (textCache.current.size > 20)
      textCache.current.delete(textCache.current.keys().next().value!);
    return value;
  }
  async function search() {
    if (!query.trim() || !pdf) return;
    const token = ++searchToken.current,
      term = query.trim(),
      found: { page: number; text: string }[] = [];
    setSearchBusy(true);
    setResults([]);
    setSearchTerm(query.trim());
    try {
      let hasText = false;
      for (let i = 1; i <= count; i++) {
        if (token !== searchToken.current) return;
        const text = await textFor(i);
        if (token !== searchToken.current) return;
        hasText ||= !!text;
        const at = pdfSearchMatch(text, term);
        if (at >= 0)
          found.push({
            page: i,
            text: text.slice(Math.max(0, at - 40), at + term.length + 80),
          });
        if (i % 10 === 0)
          setSearchStatus(trFormat("正在搜索 {0} / {1}", i, count));
        if (found.length >= 100) break;
      }
      setResults(found);
      setSearchStatus(
        !hasText
          ? tr("此文件没有可提取文字，扫描件需要 OCR。")
          : trFormat("找到 {0} 个页面", found.length) +
              (found.length === 100 ? tr("（最多显示 100 个）") : ""),
      );
    } catch (e) {
      if (token === searchToken.current) setSearchStatus(message(e));
    } finally {
      if (token === searchToken.current) setSearchBusy(false);
    }
  }
  async function navigateOutline(dest: unknown) {
    const token = ++navigationToken.current,
      document = pdf;
    if (!document) return;
    try {
      const values =
        typeof dest === "string" ? await document.getDestination(dest) : dest;
      if (!Array.isArray(values)) throw Error(tr("目录目标不可用"));
      const index =
        typeof values[0] === "number"
          ? values[0]
          : await document.getPageIndex(values[0]);
      if (!Number.isInteger(index) || index < 0 || index >= document.numPages)
        throw Error(tr("目录目标不可用"));
      const p = await document.getPage(index + 1);
      if (token !== navigationToken.current) return;
      const current = capturePosition();
      const target: PdfPosition = {
        page: index + 1,
        x: p.view[0],
        y: p.view[3],
        view: { ...current.view, translationView: "original" },
      };
      const kind = values[1]?.name;
      const number = (value: unknown): value is number =>
        typeof value === "number" && Number.isFinite(value);
      const viewport = p.getViewport({
        scale: 1,
        rotation: (p.rotate + target.view.rotation) % 360,
      });
      const clamp = (value: number) => Math.max(0.05, Math.min(4, value));
      if (kind === "XYZ") {
        target.x = number(values[2])
          ? values[2]
          : current.page === target.page
            ? current.x
            : p.view[0];
        target.y = number(values[3])
          ? values[3]
          : current.page === target.page
            ? current.y
            : p.view[3];
        if (number(values[4]) && values[4] > 0) {
          target.view.fit = "manual";
          target.view.scale = clamp(values[4]);
        }
      } else if (kind === "Fit") target.view.fit = "page";
      else if (kind === "FitH" || kind === "FitV") {
        target.view.fit = "manual";
        target.view.scale = clamp(
          kind === "FitH"
            ? (dims.w - 48) /
                (viewport.width * (target.view.mode === "spread" ? 2 : 1))
            : (dims.h - 36) / viewport.height,
        );
        if (kind === "FitH" && number(values[2])) target.y = values[2];
        if (kind === "FitV" && number(values[2])) target.x = values[2];
      } else if (
        kind === "FitR" &&
        values.slice(2, 6).length === 4 &&
        values.slice(2, 6).every(number)
      ) {
        const rect = viewport.convertToViewportRectangle(values.slice(2, 6));
        const width = Math.abs(rect[2] - rect[0]),
          height = Math.abs(rect[3] - rect[1]);
        if (!width || !height) throw Error(tr("目录目标不可用"));
        [target.x, target.y] = viewport.convertToPdfPoint(
          Math.min(rect[0], rect[2]),
          Math.min(rect[1], rect[3]),
        );
        target.view.fit = "manual";
        target.view.scale = clamp(
          Math.min((dims.w - 48) / width, (dims.h - 36) / height),
        );
      } else {
        target.view.fit = "page";
        setNotice(tr("此目标的边界适配暂不支持，已回退到目标页面。"));
      }
      if (!validPdfPosition(target)) throw Error(tr("目录目标不可用"));
      restorePosition(target);
    } catch (e) {
      if (token === navigationToken.current) setNotice(message(e));
    }
  }
  async function bookmark() {
    const location = String(page);
    const position = capturePosition();
    const saved = await patch(book.id, (book) => {
      const current = book.documentBookmarks || [];
      return {
        documentBookmarks: current.some((b) => b.location === location)
          ? current.filter((b) => b.location !== location)
          : [
              ...current,
              {
                location,
                label: trFormat("第 {0} 页", page),
                position,
              },
            ],
      };
    });
    if (!saved) setNotice(tr("保存失败，请检查磁盘空间后重试。"));
  }
  function choose(value: PdfSelection) {
    setSelection(value);
    setDraft("");
    setEditId("");
    setSidebar("");
  }
  async function saveNote() {
    if (!selection) return;
    const note: PdfNote = {
      id: editId || crypto.randomUUID(),
      page: selection.page,
      text: selection.text,
      note: draft,
      color,
      rects: selection.rects,
      created: Date.now(),
    };
    const saved = await patch(book.id, (current) => {
      const existing = current.pdfNotes || [];
      return {
        pdfNotes: editId
          ? existing.map((n) => (n.id === editId ? note : n))
          : [...existing, note],
      };
    });
    if (!saved) {
      setNotice(tr("保存失败，请检查磁盘空间后重试。"));
      return;
    }
    setSelection(null);
    setEditId("");
    setSidebar("notes");
  }
  async function exportNotes(format: "md" | "json" | "pdf") {
    if (format === "pdf") {
      if (!pdf || exportingForms) return;
      setExportingForms(true);
      try {
        if (!formsReady || fieldError)
          throw Error(tr("表单记录尚未加载，无法保存。"));
        if (
          Object.values(fieldMetadata).some(
            (f) => f.type === "signature" && f.signature?.present,
          )
        )
          throw Error(tr("含数字签名的文档不另存填写副本，请导出表单数据。"));
        if (!pdfLength || pdfLength > 32 * 1024 * 1024)
          throw Error(
            tr(
              "高亮 PDF 副本仅支持 32 MB 以内的文档，大文件请导出 Markdown 或 JSON。",
            ),
          );
        await calculationQueue.current;
        await formQueue.current;
        const result = await exportPdfHighlights(
          pdf,
          bookRef.current.pdfNotes || [],
        );
        const saved = await saveFile(
          book.title.replace(/[\\/:*?"<>|]/g, "_") + "-annotated.pdf",
          new Blob([result.bytes as BlobPart], { type: "application/pdf" }),
        );
        if (saved)
          setNotice(
            trFormat(
              "已导出 {0} 条高亮；跳过 {1} 条无坐标或无效摘录。",
              result.exported,
              result.skipped + (bookRef.current.documentNotes || []).length,
            ),
          );
      } catch (e) {
        setNotice(trFormat("导出失败：{0}", message(e)));
      } finally {
        setExportingForms(false);
      }
      return;
    }
    try {
      const data = bookRef.current.pdfNotes || [];
      const legacy = bookRef.current.documentNotes || [];
      const content =
        format === "json"
          ? JSON.stringify(
              {
                title: book.title,
                sourceId: book.id,
                format: "PaperRealm PDF notes v1",
                notes: data,
                legacyNotes: legacy,
              },
              null,
              2,
            )
          : "# " +
            book.title +
            "\n\n" +
            [
              ...data.map(
                (n) => `## 第 ${n.page} 页\n\n${n.text}\n\n批注：${n.note}\n`,
              ),
              ...legacy.map(
                (n) =>
                  `## 第 ${n.location} 页\n\n${n.text}\n\n批注：${n.note}\n`,
              ),
            ].join("\n");
      await saveFile(
        book.title.replace(/[\\/:*?"<>|]/g, "_") + "-摘录." + format,
        content,
      );
    } catch (e) {
      setNotice(trFormat("导出失败：{0}", message(e)));
    }
  }
  async function showPageText() {
    try {
      const text = await textFor(page);
      setPageText(text || tr("此页没有可提取文字，扫描件需要 OCR。"));
      setShowText(true);
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function speakFrom(number: number) {
    stopSpeech();
    const token = speechToken.current;
    setSpeaking(true);
    setPaused(false);
    try {
      const available =
        window.speechSynthesis?.getVoices().filter((v) => v.localService) || [];
      if (!available.length)
        throw Error(tr("没有本地声音，请先安装 Windows 语音包。"));
      for (let p = number; p <= count; p++) {
        const text = await textFor(p);
        if (token !== speechToken.current) return;
        if (!text) {
          if (p === number) throw Error(tr("此页没有可朗读的文字"));
          if (!continuousRef.current) break;
          continue;
        }
        go(p, true);
        const chunks =
          text.match(/[\s\S]{1,300}(?:[。！？.!?\n]|$)|[\s\S]{1,300}/g) || [];
        for (const chunk of chunks) {
          if (token !== speechToken.current) return;
          await new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(chunk);
            utterance.voice =
              available.find((v) => v.voiceURI === settingsRef.current.voice) ||
              available.find((v) =>
                v.lang.startsWith(
                  useStore.getState().prefs.uiLanguage.slice(0, 2),
                ),
              ) ||
              available[0];
            utterance.lang = utterance.voice.lang;
            utterance.rate = settingsRef.current.rate;
            utterance.onend = () => resolve();
            utterance.onerror = (event) =>
              event.error === "canceled" || event.error === "interrupted"
                ? resolve()
                : reject(Error(tr("朗读失败，请更换语音")));
            window.speechSynthesis.speak(utterance);
          });
        }
        if (!continuousRef.current) break;
      }
    } catch (e) {
      if (token === speechToken.current) setNotice(message(e));
    } finally {
      if (token === speechToken.current) setSpeaking(false);
    }
  }
  async function translate(number: number, text?: string) {
    if (!pdf) return;
    const token = ++translationToken.current;
    setTranslating(true);
    setTranslationError("");
    setTranslated("");
    setAligned(null);
    setTranslationProgress("");
    try {
      const source = text ?? (await textFor(number));
      if (!source.trim()) throw Error(tr("此页没有可提取文字"));
      const key = await pdfTranslationKey(
        book.id,
        number,
        source,
        base,
        model,
        target,
      );
      let result = await readPdfTranslation(key, source);
      if (token !== translationToken.current) return;
      if (!result) {
        if (!apiKey.trim()) throw Error(tr("请先填写 API 密钥"));
        if (!isTauri()) throw Error(tr("在线翻译请在桌面程序中使用"));
        result = await createPdfTranslation(
          source,
          base,
          apiKey,
          model,
          target,
          number,
          () => token !== translationToken.current,
          (done, total) =>
            setTranslationProgress(trFormat("翻译批次 {0} / {1}", done, total)),
        );
        if (token !== translationToken.current) return;
        await savePdfTranslation(key, result);
      }
      if (token === translationToken.current) {
        setAligned(result);
        setAlignedKey(key);
        setTranslated(result.pairs.map((p) => p.translation).join("\n"));
        change({ translationView: "parallel" });
      }
    } catch (e) {
      if (token === translationToken.current)
        setTranslationError(
          apiKey ? message(e).split(apiKey).join("[redacted]") : message(e),
        );
    } finally {
      if (token === translationToken.current) setTranslating(false);
    }
  }
  async function saveTranslationEdit(index: number, value: string) {
    if (!aligned || !alignedKey)
      throw Error(tr("译文已发生变化，请重新打开页面。"));
    const next = {
      ...aligned,
      pairs: aligned.pairs.map((p, i) =>
        i === index ? { ...p, translation: value } : p,
      ),
      updated: Date.now(),
    };
    const token = translationToken.current;
    await savePdfTranslation(alignedKey, next);
    if (token === translationToken.current) {
      setAligned(next);
      setTranslated(next.pairs.map((p) => p.translation).join("\n"));
    }
  }
  async function followLink(annotation: PdfAnnotation) {
    if (annotation.url) {
      try {
        const url = new URL(annotation.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error(tr("不支持此链接类型"));
        setExternalUrl(url.href);
      } catch (e) {
        setNotice(message(e));
      }
      return;
    }
    if (annotation.dest !== undefined && annotation.dest !== null) {
      await navigateOutline(annotation.dest);
      return;
    }
    if (annotation.action === "GoBack" || annotation.action === "GoForward") {
      travelHistory(annotation.action === "GoBack" ? "back" : "forward");
      return;
    }
    const actions: Record<string, number> = {
      FirstPage: 1,
      LastPage: count,
      NextPage: page + 1,
      PrevPage: page - 1,
    };
    if (annotation.action && actions[annotation.action])
      go(actions[annotation.action]);
    else setNotice(tr("不支持此链接类型"));
  }
  useEffect(() => {
    translationToken.current++;
    setTranslated("");
    setAligned(null);
    setTranslationError("");
    setTranslating(false);
  }, [page, pdf, base, model, target, ocrPages[page]?.created]);
  useEffect(() => {
    if (!autoTranslate || !pdf) return;
    const timer = setTimeout(() => void translate(page), 650);
    return () => clearTimeout(timer);
  }, [page, autoTranslate, pdf, base, model, target, ocrPages[page]?.created]);
  useEffect(() => {
    if (!pdf) return;
    let active = true;
    void (async () => {
      try {
        const source = await textFor(page),
          key = await pdfTranslationKey(
            book.id,
            page,
            source,
            base,
            model,
            target,
          ),
          cached = await readPdfTranslation(key, source);
        if (active && cached) {
          setAligned(cached);
          setAlignedKey(key);
          setTranslated(cached.pairs.map((p) => p.translation).join("\n"));
        }
      } catch (e) {
        if (active) setTranslationError(message(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [page, pdf, base, model, target, book.id, ocrPages[page]?.created]);
  useEffect(() => {
    if (selectionTranslation)
      void translate(selectionTranslation.page, selectionTranslation.text);
  }, [selectionTranslation]);
  async function fullscreen() {
    try {
      if (isTauri()) {
        const win = getCurrentWindow();
        await win.setFullscreen(!(await win.isFullscreen()));
      } else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      setNotice(message(e));
    }
  }
  const renderPage = (number: number) => (
    <PdfPage
      key={number}
      pdf={pdf!}
      page={number}
      scale={scale}
      onViewport={registerViewport}
      rotation={settings.rotation}
      onSize={updateSize}
      onSelection={choose}
      searchTerm={searchTerm}
      ocr={ocrPages[number]}
      onLink={followLink}
      onAttachment={previewAttachment}
      formRevision={formsReady && formAllowed ? forms?.updated || 1 : 0}
      fieldMetadata={fieldMetadata}
      formRecord={forms}
      onSaveForm={saveForm}
      onFieldAction={executeFieldAction}
      allowActions={!!settings.formScripts && formAllowed && formsReady}
      onSignature={() => {
        setChromeVisible(true);
        setSidebar("signatures");
      }}
      focusAnnotation={focusAnnotation}
      formAllowed={formAllowed && formsReady}
      notes={notes.filter((n) => n.page === number)}
    />
  );
  const thumbnailStart = Math.max(1, page - 1),
    thumbnailEnd = Math.min(count, page + 2);
  return (
    <div
      lang={language}
      className={`pr-pdf-reader pr-pdf-immersive ${chromeVisible || menuFocused ? "chrome-visible" : ""} ${settings.theme === "dark" ? "pr-dark" : ""}`}
      style={
        {
          "--pdf-chrome-height": `${chromeSize.top}px`,
          "--pdf-footer-height": `${chromeSize.bottom}px`,
        } as React.CSSProperties
      }
      onMouseMove={(event) => {
        if (event.buttons) return;
        const target = event.target as HTMLElement;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientY - bounds.top <= 32 ||
          target.closest(
            ".pr-pdf-chrome,.pr-pdf-footer,.pr-pdf-sidebar,.pr-pdf-translation",
          )
        ) {
          cancelChromeHide();
          setChromeVisible(true);
        } else scheduleChromeHide();
      }}
      onMouseLeave={scheduleChromeHide}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) {
          cancelChromeHide();
          setMenuFocused(true);
        }
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as HTMLElement | null;
        if (
          !next?.closest(
            ".pr-pdf-chrome,.pr-pdf-footer,.pr-pdf-sidebar,.pr-pdf-translation",
          )
        )
          setMenuFocused(false);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Tab") setChromeVisible(true);
        if (event.key === "Escape") {
          cancelChromeHide();
          setChromeVisible(false);
          setMenuFocused(false);
          setSidebar("");
          setShowSettings(false);
          setShowText(false);
          setMedia(null);
        }
      }}
    >
      <div ref={topChrome} className="pr-pdf-chrome">
        <header className="pr-pdf-header">
          <button className="pr-pdf-back" onClick={() => void leaveReader()}>
            <ArrowLeft size={17} />
            {tr("返回书库")}
          </button>
          <strong data-tauri-drag-region title={book.title}>
            {book.title}
          </strong>
          <span className="pr-format">PDF</span>
          <button
            aria-pressed={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 size={17} />
            {tr("阅读设置")}
          </button>
          <button onClick={fullscreen}>
            <Maximize size={17} />
            {tr("全屏")}
          </button>
          {isTauri() && (
            <>
              <button
                aria-label={tr("最小化")}
                onClick={() => void getCurrentWindow().minimize()}
              >
                −
              </button>
              <button
                aria-label={tr("最大化")}
                onClick={() => void getCurrentWindow().toggleMaximize()}
              >
                □
              </button>
              <button
                aria-label={tr("关闭")}
                onClick={() => void getCurrentWindow().close()}
              >
                ×
              </button>
            </>
          )}
        </header>
        <div className="pr-pdf-toolbar">
          <div className="pr-pdf-tabs">
            {(
              [
                ["outline", "目录", ListTree],
                ["thumbnails", "缩略图", PanelsTopLeft],
                ["search", "搜索", Search],
                ["bookmarks", "书签", Bookmark],
                ["notes", "摘录", Highlighter],
                ["native", "原生批注", MessageSquareText],
                ["attachments", "文档附件", Paperclip],
                ["ocr", "文字识别", ScanText],
                ["signatures", "数字签名", BadgeCheck],
                ["info", "文档信息", Info],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                aria-pressed={sidebar === id}
                onClick={() => setSidebar((v) => (v === id ? "" : id))}
              >
                <Icon size={16} />
                {tr(label)}
              </button>
            ))}
          </div>
          <div className="pr-pdf-tabs">
            <select
              aria-label={tr("翻译显示")}
              value={translationView}
              onChange={(e) =>
                change({
                  translationView: e.target
                    .value as PdfSettings["translationView"],
                })
              }
            >
              <option value="original">{tr("原始页面")}</option>
              <option value="parallel">{tr("逐句对照")}</option>
              <option value="translated">{tr("仅译文")}</option>
            </select>
            <button
              disabled={!pageHistory.current.back.length}
              onClick={() => travelHistory("back")}
              title="Alt+←"
            >
              {tr("导航后退")}
            </button>
            <button
              disabled={!pageHistory.current.forward.length}
              onClick={() => travelHistory("forward")}
              title="Alt+→"
            >
              {tr("导航前进")}
            </button>
            <select
              aria-label={tr("阅读模式")}
              value={settings.mode}
              onChange={(e) =>
                switchMode(e.target.value as PdfSettings["mode"])
              }
            >
              <option value="single">{"" + tr("单页") + ""}</option>
              <option value="spread">{"" + tr("双页") + ""}</option>
              <option value="scroll">{"" + tr("连续滚动") + ""}</option>
            </select>
            <button
              onClick={() =>
                change({ fit: "manual", scale: Math.max(0.1, scale - 0.1) })
              }
            >
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              onClick={() =>
                change({ fit: "manual", scale: Math.min(4, scale + 0.1) })
              }
            >
              ＋
            </button>
            <button
              aria-pressed={settings.fit === "width"}
              onClick={() => change({ fit: "width" })}
            >
              {"" + tr("适应宽度") + ""}
            </button>
            <button
              aria-pressed={settings.fit === "page"}
              onClick={() => change({ fit: "page" })}
            >
              {"" + tr("适应页面") + ""}
            </button>
            <button
              disabled={!pdf || pdf.isPureXfa || coverBusy}
              onClick={() => void updatePdfCover("manual")}
            >
              {tr("设为封面")}
            </button>
            <button
              disabled={!pdf || coverBusy}
              onClick={() => void updatePdfCover("auto")}
            >
              {tr(coverBusy ? "正在识别…" : "智能识别封面")}
            </button>
            <button
              onClick={() =>
                change({ rotation: (settings.rotation + 90) % 360 })
              }
            >
              <RotateCw size={16} />
              {tr("旋转")}
            </button>
          </div>
        </div>
        {showSettings && (
          <section className="pr-pdf-settings">
            <div className="pr-pdf-form-settings">
              <label>
                <input
                  type="checkbox"
                  checked={!!settings.formScripts}
                  disabled={pdf?.isPureXfa || !formsReady || !formAllowed}
                  onChange={(e) => change({ formScripts: e.target.checked })}
                />
                {tr("启用隔离表单计算")}
              </label>
              <button
                disabled={
                  calculating ||
                  !settings.formScripts ||
                  !pdf ||
                  pdf.isPureXfa ||
                  !formAllowed
                }
                onClick={() => void recalculateForms()}
              >
                {calculating ? tr("计算中…") : tr("重新计算")}
              </button>
              <button
                disabled={!formsReady || !forms || !formAllowed}
                onClick={() => void openSubmit()}
              >
                {tr("提交表单")}
              </button>
              <small>
                {tr(
                  "仅处理隔离计算、校验和格式化；网络、文件操作、定时动作不会执行。",
                )}
              </small>
              <strong>
                <FilePenLine size={16} />
                {tr("PDF 表单")}
              </strong>
              <span>
                {trFormat(
                  "已保存 {0} 个字段",
                  Object.keys(forms?.values || {}).length,
                )}
              </span>
              {pdf?.isPureXfa && (
                <button
                  disabled={!formsReady || !formAllowed || !xfaDirty}
                  onClick={() =>
                    void saveXfa().catch((e) => setNotice(message(e)))
                  }
                >
                  {tr("保存 XFA 输入")}
                  {xfaDirty ? " *" : ""}
                </button>
              )}
              <button disabled={!forms} onClick={() => void exportFormData()}>
                {tr("导出表单数据")}
              </button>
              <label className="pr-pdf-file-button">
                {tr("导入表单数据")}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    void readFormImport(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                disabled={
                  !forms || !Object.keys(forms.values).length || !formAllowed
                }
                onClick={() => setFormDialog("reset")}
              >
                {tr("还原表单")}
              </button>
              <button
                disabled={
                  !pdf ||
                  !formsReady ||
                  !formAllowed ||
                  exportingForms ||
                  !Object.keys(forms?.values || {}).length
                }
                onClick={() => void exportFilledPdf()}
              >
                {exportingForms ? tr("导出中…") : tr("另存填写副本")}
              </button>
              <small>
                {pdf?.isPureXfa
                  ? tr(
                      "XFA 可直接输入，保存输入后可恢复；脚本计算与提交暂不支持。",
                    )
                  : tr("点击页面上的字段标记填写，保存后自动恢复。")}
              </small>
            </div>
            <label>
              {"" + tr("亮度") + " "}
              {settings.brightness}%
              <input
                type="range"
                min="30"
                max="100"
                value={settings.brightness}
                onChange={(e) => change({ brightness: Number(e.target.value) })}
              />
            </label>
            <label>
              {"" + tr("背景") + ""}
              <select
                value={settings.theme}
                onChange={(e) =>
                  change({ theme: e.target.value as PdfSettings["theme"] })
                }
              >
                <option value="paper">{"" + tr("暖纸") + ""}</option>
                <option value="dark">{"" + tr("深夜") + ""}</option>
              </select>
            </label>
            <label>
              {"" + tr("本地声音") + ""}
              <select
                value={settings.voice}
                onChange={(e) => change({ voice: e.target.value })}
              >
                <option value="">{"" + tr("跟随界面语言") + ""}</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {"" + tr("语速") + ""}
              <input
                type="range"
                min=".5"
                max="2"
                step=".1"
                value={settings.rate}
                onChange={(e) => change({ rate: Number(e.target.value) })}
              />
              {settings.rate}×
            </label>
            <label>
              <input
                type="checkbox"
                checked={continuousVoice}
                onChange={(e) => setContinuousVoice(e.target.checked)}
              />
              {"" + tr("连续朗读后续页面") + ""}
            </label>
          </section>
        )}
      </div>
      {notice && (
        <div className="pr-pdf-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")}>{"" + tr("关闭") + ""}</button>
        </div>
      )}
      {error && (
        <div className="pr-pdf-notice" role="alert">
          {error}
        </div>
      )}
      {passwordPrompt && (
        <form
          className="pr-pdf-password"
          onSubmit={(e) => {
            e.preventDefault();
            passwordCallback.current?.(password);
            setPassword("");
            setPasswordPrompt("");
          }}
        >
          <label>
            {passwordPrompt}
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit">{"" + tr("解锁") + ""}</button>
          <button type="button" onClick={() => void leaveReader()}>
            {"" + tr("返回") + ""}
          </button>
        </form>
      )}
      <div className="pr-pdf-workspace">
        {sidebar && (
          <aside className="pr-pdf-sidebar">
            {sidebar === "signatures" && (
              <PdfSignatures
                bookId={book.id}
                title={book.title}
                fields={fields}
                ready={formsReady}
                metadataError={fieldError}
                onLocate={(number) => {
                  change({ translationView: "original" });
                  go(number);
                }}
              />
            )}
            {sidebar === "ocr" && pdf && (
              <PdfOcrPanel
                pdf={pdf}
                bookId={book.id}
                page={page}
                record={ocrPages[page]}
                onUpdate={updateOcr}
              />
            )}
            {sidebar === "attachments" && pdf && (
              <PdfAttachments
                pdf={pdf}
                length={pdfLength}
                onPreview={previewAttachment}
                onError={setNotice}
              />
            )}
            {sidebar === "info" && pdf && (
              <PdfDocumentInfo
                pdf={pdf}
                title={book.title}
                length={pdfLength}
                labels={pageLabels}
              />
            )}
            {sidebar === "native" && pdf && (
              <PdfNativeNotes
                pdf={pdf}
                page={page}
                title={book.title}
                onLocate={(targetPage, id) => {
                  if (targetPage !== page || translationView !== "original")
                    go(targetPage);
                  if (translationView !== "original")
                    change({ translationView: "original" });
                  setFocusAnnotation((previous) => ({
                    id,
                    page: targetPage,
                    sequence: (previous?.sequence ?? 0) + 1,
                  }));
                }}
              />
            )}
            {sidebar === "outline" && (
              <>
                <input
                  aria-label={tr("筛选目录")}
                  placeholder={tr("筛选目录")}
                  value={outlineQuery}
                  onChange={(e) => setOutlineQuery(e.target.value)}
                />
                {outline.length > 0 &&
                  !outline.some((item) =>
                    item.title
                      .toLocaleLowerCase()
                      .includes(outlineQuery.trim().toLocaleLowerCase()),
                  ) && <p>{tr("没有匹配的目录项。")}</p>}
              </>
            )}
            {sidebar === "outline" &&
              (outline.length ? (
                outline
                  .filter((item) =>
                    item.title
                      .toLocaleLowerCase()
                      .includes(outlineQuery.trim().toLocaleLowerCase()),
                  )
                  .map((item, i) => (
                    <button
                      key={i}
                      style={{ paddingInlineStart: 12 + item.depth * 12 }}
                      onClick={() => void navigateOutline(item.dest)}
                    >
                      {item.title}
                    </button>
                  ))
              ) : (
                <p>{"" + tr("此文件没有内置目录。") + ""}</p>
              ))}
            {sidebar === "thumbnails" && (
              <>
                <p>{"" + tr("当前页附近缩略图") + ""}</p>
                {Array.from(
                  { length: Math.max(0, thumbnailEnd - thumbnailStart + 1) },
                  (_, i) => thumbnailStart + i,
                ).map((n) => (
                  <button
                    className="pr-pdf-thumb"
                    key={n}
                    onClick={() => go(n)}
                  >
                    {pdf && (
                      <PdfPage
                        pdf={pdf}
                        page={n}
                        scale={0.15}
                        rotation={settings.rotation}
                        thumbnail
                      />
                    )}
                    <span>
                      {"" + tr("第") + " "}
                      {n} {" " + tr("页") + ""}
                      {pageLabels[n - 1] ? " · " + pageLabels[n - 1] : ""}
                    </span>
                  </button>
                ))}
                <button onClick={() => go(page - 6)}>
                  {"" + tr("前一组") + ""}
                </button>
                <button onClick={() => go(page + 6)}>
                  {"" + tr("后一组") + ""}
                </button>
              </>
            )}
            {sidebar === "search" && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void search();
                  }}
                >
                  <input
                    placeholder={tr("搜索 PDF 文字")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button disabled={searchBusy || !pdf}>
                    {"" + tr("搜索") + ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      searchToken.current++;
                      setSearchBusy(false);
                      setSearchStatus(tr("搜索已停止"));
                    }}
                  >
                    {"" + tr("停止") + ""}
                  </button>
                </form>
                <p aria-live="polite">{searchStatus}</p>
                {results.map((r) => (
                  <button
                    key={r.page}
                    onClick={() => {
                      change({ translationView: "original" });
                      go(r.page);
                    }}
                  >
                    <b>
                      {"" + tr("第") + " "}
                      {r.page} {" " + tr("页") + ""}
                    </b>
                    <span>{r.text}</span>
                  </button>
                ))}
              </>
            )}
            {sidebar === "bookmarks" && (
              <>
                <button onClick={() => void bookmark()}>
                  {"" + tr("添加／移除当前书签") + ""}
                </button>
                {book.documentBookmarks?.length ? (
                  book.documentBookmarks.map((b) => (
                    <button
                      key={b.location}
                      onClick={() =>
                        validPdfPosition(b.position)
                          ? restorePosition(b.position)
                          : go(Number(b.location))
                      }
                    >
                      {b.label}
                    </button>
                  ))
                ) : (
                  <p>{"" + tr("暂无书签。") + ""}</p>
                )}
              </>
            )}
            {sidebar === "notes" && (
              <>
                <PdfNotesImport
                  bookId={book.id}
                  title={book.title}
                  pages={count}
                  existing={notes}
                  onImport={async (imported) => {
                    let added = 0;
                    const saved = await patch(book.id, (book) => {
                      const current = book.pdfNotes || [];
                      const ids = new Set(current.map((n) => n.id));
                      const merged = imported.filter((n) => !ids.has(n.id));
                      added = merged.length;
                      return { pdfNotes: [...current, ...merged] };
                    });
                    if (!saved)
                      throw Error(tr("保存失败，请检查磁盘空间后重试。"));
                    setNotice(trFormat("已合并 {0} 条新摘录。", added));
                  }}
                />
                <div className="pr-pdf-tabs">
                  <button
                    disabled={exportingForms || !notes.length}
                    onClick={() => void exportNotes("pdf")}
                  >
                    {tr("导出高亮 PDF 副本")}
                  </button>
                  <button onClick={() => void exportNotes("md")}>
                    {"" + tr("导出 Markdown") + ""}
                  </button>
                  <button onClick={() => void exportNotes("json")}>
                    {"" + tr("导出坐标 JSON") + ""}
                  </button>
                </div>
                {!notes.length && !legacyNotes.length && (
                  <p>{"" + tr("选择页面文字后保存摘录。") + ""}</p>
                )}
                {notes.map((n) => (
                  <article key={n.id}>
                    <button onClick={() => go(n.page)}>
                      {"" + tr("第") + " "}
                      {n.page} {" " + tr("页 ·") + " "}
                      {n.text}
                    </button>
                    <p>{n.note}</p>
                    <button
                      onClick={() => {
                        setEditId(n.id);
                        setSelection({
                          page: n.page,
                          text: n.text,
                          rects: n.rects,
                        });
                        setDraft(n.note);
                        setColor(n.color);
                      }}
                    >
                      {"" + tr("编辑") + ""}
                    </button>
                    <button
                      onClick={() =>
                        void patch(book.id, {
                          pdfNotes: notes.filter((x) => x.id !== n.id),
                        })
                      }
                    >
                      {"" + tr("删除") + ""}
                    </button>
                  </article>
                ))}
                {legacyNotes.map((n) => (
                  <article key={n.id}>
                    <button onClick={() => go(Number(n.location))}>
                      {"" + tr("旧摘录 · 第") + " "}
                      {n.location} {" " + tr("页") + ""}
                    </button>
                    <p>{n.text}</p>
                    <p>{n.note}</p>
                    <button
                      onClick={() => {
                        setEditId("");
                        setSelection({
                          page: Number(n.location) || 1,
                          text: n.text,
                          rects: [],
                        });
                        setDraft(n.note);
                      }}
                    >
                      {"" + tr("复制到新批注") + ""}
                    </button>
                  </article>
                ))}
              </>
            )}
          </aside>
        )}
        <main
          ref={stage}
          className="pr-pdf-stage"
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop);
            setScrollLeft(e.currentTarget.scrollLeft);
            if (
              settings.mode === "scroll" &&
              translationView === "original" &&
              count &&
              !pendingPosition.current
            ) {
              const y = e.currentTarget.scrollTop;
              const number = findAt(y + 40) + 1;
              pageRef.current = number;
              setPage(number);
            }
            if (!pendingPosition.current)
              lastPosition.current = capturePosition();
          }}
        >
          {loading && !passwordPrompt && <p>{"" + tr("正在加载 PDF…") + ""}</p>}
          {pdf && translationView !== "original" && (
            <div
              className="pr-pdf-reflow"
              style={{ filter: `brightness(${settings.brightness}%)` }}
            >
              {aligned ? (
                <PdfBilingual
                  key={alignedKey}
                  data={aligned}
                  view={translationView}
                  title={book.title}
                  onSave={saveTranslationEdit}
                  onError={setNotice}
                />
              ) : (
                <div className="pr-pdf-empty">
                  <h3>{tr("逐句对照")}</h3>
                  <p>
                    {translating
                      ? tr("正在准备逐句翻译。")
                      : tr("此页尚无逐句对照数据。")}
                  </p>
                  <p>{translationProgress || translationError}</p>
                  <button
                    onClick={() => {
                      setChromeVisible(true);
                      setTranslationOpen(true);
                    }}
                  >
                    {tr("翻译设置")}
                  </button>
                  <button
                    onClick={() => change({ translationView: "original" })}
                  >
                    {tr("原始页面")}
                  </button>
                </div>
              )}
            </div>
          )}
          {pdf && translationView === "original" && (
            <div
              className="pr-pdf-paper-area"
              style={{ filter: `brightness(${settings.brightness}%)` }}
            >
              {settings.mode === "scroll" ? (
                <div
                  style={{
                    height: offsets[count],
                    position: "relative",
                    minWidth: "100%",
                  }}
                >
                  {Array.from(
                    { length: end - start },
                    (_, i) => start + i + 1,
                  ).map((n) => (
                    <div
                      key={n}
                      style={{
                        position: "absolute",
                        top: offsets[n - 1],
                        left: 0,
                        right: 0,
                        textAlign: "center",
                      }}
                    >
                      {renderPage(n)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pr-pdf-spread">
                  {renderPage(page)}
                  {settings.mode === "spread" &&
                    page < count &&
                    renderPage(page + 1)}
                </div>
              )}
            </div>
          )}
        </main>
        {translationOpen && (
          <aside className="pr-pdf-translation">
            <h3>
              {"" + tr("DeepSeek 翻译 · 第") + " "}
              {page} {" " + tr("页") + ""}
            </h3>
            <label>
              {"" + tr("API 地址") + ""}
              <input value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
            <label>
              {"" + tr("模型") + ""}
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label>
              {"" + tr("API 密钥") + ""}
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <label>
              {"" + tr("目标语言") + ""}
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {["简体中文", "English", "日本語", "Español", "Русский"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </label>
            <p>
              {"" +
                tr(
                  "启用翻译后会将所选文字或当前页文字发送到配置的服务。密钥仅保留在本次阅读内存中。",
                ) +
                ""}
            </p>
            <label>
              <input
                type="checkbox"
                checked={autoTranslate}
                onChange={(e) => setAutoTranslate(e.target.checked)}
              />
              {"" + tr("翻页后自动翻译") + ""}
            </label>
            <button disabled={translating} onClick={() => void translate(page)}>
              {translating ? tr("翻译中…") : tr("翻译当前页")}
            </button>
            {translating && (
              <>
                <p role="status">{translationProgress}</p>
                <button
                  onClick={() => {
                    translationToken.current++;
                    setTranslating(false);
                    setTranslationProgress("");
                  }}
                >
                  {tr("取消")}
                </button>
              </>
            )}
            {translationError && <p role="alert">{translationError}</p>}
            <div className="pr-pdf-translated" dir="auto">
              {translated && (
                <>
                  <p>{tr("逐句译文已保存，可在阅读区对照和编辑。")}</p>
                  <button
                    onClick={() => change({ translationView: "parallel" })}
                  >
                    {tr("逐句对照")}
                  </button>
                  <button
                    onClick={() => change({ translationView: "translated" })}
                  >
                    {tr("仅译文")}
                  </button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      {formDialog && (
        <section
          className="pr-pdf-selection"
          role="dialog"
          aria-label={tr(formDialog === "reset" ? "还原表单" : "导入表单数据")}
        >
          <h3>{tr(formDialog === "reset" ? "还原表单" : "导入表单数据")}</h3>
          <p>
            {tr(
              formDialog === "reset"
                ? "清除本地填写记录，恢复原始字段内容。"
                : "导入会替换此文档当前保存的表单数据。",
            )}
          </p>
          {pendingForms && formDialog === "import" && (
            <p>
              {trFormat(
                "将导入 {0} 个字段",
                Object.keys(pendingForms.values).length,
              )}
            </p>
          )}
          <button
            onClick={() =>
              void writeForms(
                formDialog === "reset" ? {} : pendingForms?.values || {},
                formDialog === "reset" ? {} : pendingForms?.formatted || {},
              )
                .then(() => {
                  setFormDialog("");
                  setPendingForms(null);
                })
                .catch((e) => setNotice(message(e)))
            }
          >
            {tr("确认")}
          </button>
          <button
            onClick={() => {
              setFormDialog("");
              setPendingForms(null);
            }}
          >
            {tr("取消")}
          </button>
        </section>
      )}
      {media && <PdfMediaPreview file={media} onClose={() => setMedia(null)} />}
      {externalUrl && (
        <section
          className="pr-pdf-selection"
          role="dialog"
          aria-label={tr("打开外部链接")}
        >
          <h3>{tr("打开外部链接")}</h3>
          <p className="pr-pdf-url">{externalUrl}</p>
          <button
            onClick={() =>
              void (async () => {
                try {
                  if (isTauri())
                    await invoke("open_pdf_link", { url: externalUrl });
                  else
                    window.open(externalUrl, "_blank", "noopener,noreferrer");
                  setExternalUrl("");
                } catch (e) {
                  setNotice(message(e));
                }
              })()
            }
          >
            {tr("在浏览器打开")}
          </button>
          <button onClick={() => setExternalUrl("")}>{tr("取消")}</button>
        </section>
      )}
      {selection && (
        <section
          className="pr-pdf-selection"
          role="dialog"
          aria-label={tr("摘录批注")}
        >
          <p>
            {"" + tr("第") + " "}
            {selection.page} {" " + tr("页 ·") + " "}
            {selection.text.slice(0, 350)}
          </p>
          <textarea
            aria-label={tr("批注内容")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr("添加批注")}
          />
          <label>
            {"" + tr("高亮颜色") + ""}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <button onClick={() => void saveNote()}>
            {"" + tr("保存高亮与批注") + ""}
          </button>
          <button
            onClick={() => {
              setChromeVisible(true);
              setTranslationOpen(true);
              setSelectionTranslation({
                page: selection.page,
                text: selection.text,
              });
              setSelection(null);
            }}
          >
            {"" + tr("翻译所选文字") + ""}
          </button>
          <button onClick={() => setSelection(null)}>
            {"" + tr("取消") + ""}
          </button>
        </section>
      )}
      {showText && (
        <section className="pr-pdf-selection">
          <button onClick={() => setShowText(false)}>
            {"" + tr("关闭文字") + ""}
          </button>
          <div className="pr-pdf-plain-text">{pageText}</div>
        </section>
      )}
      <footer ref={bottomChrome} className="pr-pdf-footer">
        <button
          disabled={!pdf || page <= 1}
          onClick={() =>
            go(
              pageRef.current -
                (settings.mode === "spread" && translationView === "original"
                  ? 2
                  : 1),
            )
          }
        >
          <ChevronLeft size={18} />
          {tr("上一页")}
        </button>
        <label>
          {"" + tr("页码") + ""}
          <input
            ref={pageInput}
            type="text"
            maxLength={128}
            aria-label={tr("页码或原始页码标签")}
            title={tr("输入页码或标签后按回车；#12 表示实际第 12 页。")}
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPageDraft();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setPageDraft(pageLabels[page - 1] || String(page));
              }
            }}
          />
        </label>
        <span>
          / {count} · {count ? Math.round((page / count) * 100) : 0}%
          {pageLabels[page - 1] && (
            <small> · {trFormat("实际第 {0} 页", page)}</small>
          )}
        </span>
        <button
          disabled={!pdf || page >= count}
          onClick={() =>
            go(
              pageRef.current +
                (settings.mode === "spread" && translationView === "original"
                  ? 2
                  : 1),
            )
          }
        >
          {tr("下一页")}
          <ChevronRight size={18} />
        </button>
        <button disabled={!pdf} onClick={() => void showPageText()}>
          {"" + tr("提取文字") + ""}
        </button>
        <button onClick={() => setTranslationOpen((v) => !v)}>
          <Languages size={16} />
          {tr("翻译")}
        </button>
        <button disabled={!pdf} onClick={() => void speakFrom(page)}>
          <Volume2 size={16} />
          {tr("朗读")}
        </button>
        {speaking && (
          <button
            onClick={() => {
              if (paused) window.speechSynthesis.resume();
              else window.speechSynthesis.pause();
              setPaused((v) => !v);
            }}
          >
            {paused ? tr("继续朗读") : tr("暂停")}
          </button>
        )}
        <button onClick={stopSpeech}>{"" + tr("停止朗读") + ""}</button>
        <button onClick={() => void patch(book.id, { done: !book.done })}>
          {book.done ? tr("标为未完成") : tr("标为读完")}
        </button>
      </footer>
    </div>
  );
}
