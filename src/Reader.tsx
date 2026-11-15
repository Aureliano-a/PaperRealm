import { trFormat } from "./i18n";
import { tr } from "./i18n";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookOpen,
  Search,
  Quote,
  Maximize,
  Focus,
  X,
  Check,
  Palette,
  SlidersHorizontal,
  RotateCcw,
  Languages,
  Volume2,
  PanelLeft,
  Minus,
  Square,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition, type PhysicalSize } from "@tauri-apps/api/dpi";
import { useStore, trackExtraWrite } from "./store";
import {
  fonts,
  themes,
  defaults,
  type Book,
  type Page,
  type Layout,
  type Prefs,
} from "./types";
import { pageAt, restore, progress } from "./engine";
import { convert } from "./conversion";
import { isDark, readingPalettes } from "./reading";
import "./reader.css";
import { TranslationPanel } from "./ReaderServices";
import { useNarration, VoicePanel } from "./Narration";
import { useLocalReadestFonts } from "./local-readest-fonts";
import { FontOptions } from "./FontOptions";
import { get, put } from "./db";
import { saveFile } from "./export";
import { Dictionary } from "./Dictionary";
import { applySavedCorrections, joinedTranslation, readAligned, sentenceAnchor, translateAligned, type AlignedPair } from "./translationAlignment";
import { AlignedSentence } from "./AlignedSentence";
import PaperFlip, { type PaperFlipHandle } from "./PaperFlip";
const pageCache = new Map<string, Page[]>();
export default function Reader({
  book,
  onBack,
}: {
  book: Book;
  onBack: () => void;
}) {
  useLocalReadestFonts();
  const { prefs: globalPrefs, patch } = useStore();
  const prefs = { ...globalPrefs, ...book.readingPrefs };
  const setPrefs = async (values: Partial<Prefs>) => {
    await patch(book.id, { readingPrefs: { ...useStore.getState().books.find(b => b.id === book.id)?.readingPrefs, ...values } });
  };
  useEffect(() => {
    if (book.readingPrefs?.referenceLayoutVersion !== 2) void setPrefs({ mode: "single", columnsOnWide: true, font: "readestWenKaiScreen", size: 16, weight: 400, lineHeight: 1.65, spacing: 0, paragraph: 10, bookSize: 100, readerBackground: "#8b765b", theme: "custom", customPaper: "#8b765b", customInk: "#ffdaa4", referenceLayoutVersion: 2 });
  }, [book.id]);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hoverEdge, setHoverEdge] = useState<"top" | "bottom" | "">("");
  const [controlsFocused, setControlsFocused] = useState(false);
  const [windowNotice, setWindowNotice] = useState("");
  const footerRef = useRef<HTMLElement>(null);
  const [footerHeight, setFooterHeight] = useState(84);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const update = () => setFooterHeight(Math.ceil(footer.offsetHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  const originalWindow = useRef<{ size: PhysicalSize; position: PhysicalPosition; maximized: boolean; fullscreen: boolean } | null>(null);
  const windowSetup = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    windowSetup.current = (async () => {
      const win = getCurrentWindow();
      const [monitor, maximized, fullscreen, size, position] = await Promise.all([currentMonitor(), win.isMaximized(), win.isFullscreen(), win.innerSize(), win.outerPosition()]);
      if (cancelled || !monitor) return;
      const area = monitor.workArea, scale = monitor.scaleFactor;
      const availableWidth = Math.floor(area.size.width / scale), availableHeight = Math.floor(area.size.height / scale);
      const width = Math.min(800, Math.max(760, Math.floor(availableWidth * 0.90)));
      const height = Math.min(availableHeight, Math.max(600, Math.round(width * 0.75)));
      if (!fullscreen && !maximized && size.width <= width * scale && size.height <= height * scale) return;
      originalWindow.current = { size, position, maximized, fullscreen };
      if (fullscreen) await win.setFullscreen(false);
      if (maximized) await win.unmaximize();
      if (cancelled) return;
      const targetWidth = maximized || fullscreen ? width : Math.min(width, Math.floor(size.width / scale));
      const targetHeight = maximized || fullscreen ? height : Math.min(height, Math.floor(size.height / scale));
      await win.setSize(new LogicalSize(targetWidth, targetHeight));
      const x = Math.round(area.position.x + (area.size.width - targetWidth * scale) / 2);
      const y = Math.round(area.position.y + (area.size.height - targetHeight * scale) / 2);
      await win.setPosition(new PhysicalPosition(x, y));
    })().catch(() => { if (!cancelled) setWindowNotice("无法自动缩小阅读窗口，请从窗口边缘手动调整大小。"); });
    return () => { cancelled = true; };
  }, []);
  async function returnToLibrary() {
    await windowSetup.current;
    const saved = originalWindow.current;
    if (saved && isTauri()) {
      try {
        const win = getCurrentWindow();
        if (await win.isFullscreen()) await win.setFullscreen(false);
        if (saved.fullscreen) await win.setFullscreen(true);
        else if (saved.maximized) await win.maximize();
        else { if (await win.isMaximized()) await win.unmaximize(); await win.setSize(saved.size); await win.setPosition(saved.position); }
      } catch { /* The reader remains usable if the operating system rejects a window change. */ }
      originalWindow.current = null;
    }
    onBack();
  }
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [panel, setPanel] = useState(""),
    [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const [selection, setSelection] = useState<{
      text: string;
      offset: number;
    } | null>(null),
    [note, setNote] = useState("");
  const [markColor, setMarkColor] = useState("#e8c964");
  const [markStyle, setMarkStyle] = useState<"highlight" | "underline">("highlight");
  const [ruler, setRuler] = useState(false), [autoScroll, setAutoScroll] = useState(false), [rulerY, setRulerY] = useState(100);
  const [paragraphFocus, setParagraphFocus] = useState(false), [activeParagraph, setActiveParagraph] = useState<{start:number;end:number} | null>(null), [hideTools, setHideTools] = useState(false);
  const [dictionaryQuery, setDictionaryQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [translationText, setTranslationText] = useState("");
  const [translationRange, setTranslationRange] = useState<{ pageStart: number; pageEnd: number; start: number; end: number } | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showTranslation, setShowTranslation] = useState(true);
  const [compareTranslation, setCompareTranslation] = useState(false);
  const [translationSettings, setTranslationSettings] = useState({ base: "https://api.deepseek.com", target: book.translationTarget || "简体中文", auto: true });
  const [autoActive, setAutoActive] = useState(false);
  const [autoBusy, setAutoBusy] = useState("");
  const [autoError, setAutoError] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const [curlActive, setCurlActive] = useState(0), [curlFailed, setCurlFailed] = useState(false);
  const flipRef = useRef<PaperFlipHandle>(null), backgroundImage = useRef<HTMLImageElement | null>(null);
  useEffect(() => { if (prefs.simulatedFlip === false) { setCurlFailed(false); setCurlActive(0); } }, [prefs.simulatedFlip]);
  useEffect(() => {
    backgroundImage.current = null;
    if (prefs.paperBackground !== "soft" && prefs.paperBackground !== "vintage") return;
    const image = new Image(); let active = true;
    image.onload = () => { if (active) backgroundImage.current = image; };
    image.src = prefs.paperBackground === "soft" ? "/backgrounds/soft-paper.svg" : "/backgrounds/vintage-paper.svg";
    return () => { active = false; image.onload = null; };
  }, [prefs.paperBackground]);
  const cacheWrites = useRef<Promise<void>>(Promise.resolve());
  const translationCacheKey = (settings: {base: string; target: string}) => `translations:${book.id}:${book.encoding}:${settings.base}:${settings.target}`;
  function rememberTranslation(key: string, text: string, settings = translationSettings) {
    const id = translationCacheKey(settings);
    cacheWrites.current = cacheWrites.current.catch(() => {}).then(async () => {
      const old = (await get<Record<string, string>>(id)) || {};
      if (!key.startsWith("partial:")) delete old[`partial:${key}`];
      await put(id, { ...old, [key]: text });
    });
    trackExtraWrite(cacheWrites.current);
    void cacheWrites.current.catch(() => setAutoError("译文保存失败，请检查磁盘空间。"));
  }
  const translationGeneration = useRef(0);
  function saveGeneratedPairs(pageStart: number, pageEnd: number, pairs: AlignedPair[], settings: {base: string; target: string}) {
    const cacheId = translationCacheKey(settings), pageKey = `${pageStart}:${pageEnd}`;
    const job = cacheWrites.current.catch(() => {}).then(async () => {
      const record = (await get<Record<string, string>>(cacheId)) || {};
      const corrected = applySavedCorrections(pairs, pageStart, record);
      const aligned = JSON.stringify(corrected), translated = joinedTranslation(corrected);
      delete record[`partial:${pageKey}`];
      await put(cacheId, { ...record, [pageKey]: translated, [`aligned:${pageKey}`]: aligned });
      return { aligned, translated };
    });
    cacheWrites.current = job.then(() => {});
    trackExtraWrite(cacheWrites.current);
    return job;
  }
  async function saveAlignedEdit(page: Page, sentence: number, source: string, text: string) {
    const cacheId = translationCacheKey(translationSettings), pageKey = `${page.start}:${page.end}`;
    const generation = translationGeneration.current;
    let updated: { aligned: string; translated: string; anchor: string; correction: string } | undefined;
    cacheWrites.current = cacheWrites.current.catch(() => {}).then(async () => {
      const record = (await get<Record<string, string>>(cacheId)) || {};
      const pairs = readAligned(record[`aligned:${pageKey}`]);
      if (!pairs || !pairs[sentence] || pairs[sentence].source !== source) throw Error("译文已发生变化，请重新打开页面。");
      const anchor = sentenceAnchor(pairs, sentence, page.start);
      pairs[sentence] = { ...pairs[sentence], translation: text };
      const correction = JSON.stringify({ source: anchor.source, translation: text });
      record[anchor.key] = correction;
      const corrected = applySavedCorrections(pairs, page.start, record);
      updated = { aligned: JSON.stringify(corrected), translated: joinedTranslation(corrected), anchor: anchor.key, correction };
      delete record[`partial:${pageKey}`];
      await put(cacheId, { ...record, [pageKey]: updated.translated, [`aligned:${pageKey}`]: updated.aligned });
    });
    trackExtraWrite(cacheWrites.current);
    await cacheWrites.current;
    if (updated && generation === translationGeneration.current) {
      const result = updated;
      setTranslations(old => { const next = { ...old, [pageKey]: result.translated, [`aligned:${pageKey}`]: result.aligned, [result.anchor]: result.correction }; delete next[`partial:${pageKey}`]; return next; });
    }
  }
  const narrationRef = useRef<{status: string; stop: () => void} | null>(null);
  const body = useRef<HTMLDivElement>(null),
    current = useRef(book);
  const pendingScroll = useRef<number | null>(null),
    audio = useRef<AudioContext | null>(null);
  current.current = book;
  const scrolling = prefs.mode === "scroll";
  const sidebarDocked = sidebarOpen && !focus && size.w >= 1000;
  const availableWidth = size.w - (sidebarDocked ? 300 : 0);
  const twoColumns = !scrolling && prefs.columnsOnWide !== false && availableWidth >= 760;
  const occupiedWidth = Math.max(280, Math.floor((availableWidth - 24) * Math.max(50, Math.min(100, prefs.bookSize || 100)) / 100));
  const pageWidth = twoColumns ? Math.floor((occupiedWidth - 8) / 2) : occupiedWidth;
  const paddingX = Math.min(14, Math.max(8, Math.round(pageWidth * .025))), paddingY = scrolling ? 12 : 6;
  const menusVisible = (hoverEdge !== "" || controlsFocused) && !focus && !hideTools;
  const menuTopInset = menusVisible ? 18 : 0;
  const usableHeight = size.h - 38 - menuTopInset - (menusVisible ? footerHeight + 4 : 26);
  const pageHeight = scrolling
    ? 760
    : Math.max(180, Math.floor(usableHeight * Math.max(50, Math.min(100, prefs.textHeightPercent || 100)) / 100));
  const layout = useMemo<Layout>(
    () => ({
      width: pageWidth - paddingX * 2,
      height: pageHeight - paddingY - (scrolling ? paddingY : 2),
      size: prefs.size,
      lineHeight: prefs.lineHeight,
      spacing: prefs.spacing,
      paragraph: prefs.paragraph,
    }),
    [
      pageWidth,
      paddingX,
      pageHeight,
      paddingY,
      prefs.size,
      prefs.lineHeight,
      prefs.spacing,
      prefs.paragraph,
    ],
  );
  const palette =
    prefs.theme === "custom"
      ? { paper: prefs.customPaper, ink: prefs.customInk }
      : themes[prefs.theme] || themes.ivory;
  const selectedFont = fonts[prefs.font]?.css || fonts.QingKai.css;
  const font = selectedFont;
  const bookDirection = useMemo(() => {
    const sample = book.text.slice(0, 10000);
    const rtl = (sample.match(/[\u0590-\u08ff]/g) || []).length;
    const ltr = (sample.match(/[A-Za-z\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
    return rtl > ltr ? "rtl" : "ltr";
  }, [book.text]);
  const currentPageIndex = pageAt(pages, restore(book.text, book.offset, book.context));
  const index = twoColumns ? currentPageIndex - currentPageIndex % 2 : currentPageIndex;
  const chapterIndex = book.chapters.reduce(
      (a, c, i) => (c.offset <= book.offset ? i : a),
      0,
    ),
    chapter = book.chapters[chapterIndex];
  const marked = book.marks.some(
    (m) => m.kind === "bookmark" && pageAt(pages, m.offset) === index,
  );
  const metrics = useMemo(() => {
    const offsets = [0];
    for (const p of pages) {
      const last = p.lines[p.lines.length - 1];
      offsets.push(
        offsets[offsets.length - 1] +
          (last?.y || 0) +
          prefs.size * prefs.lineHeight +
          prefs.paragraph +
          paddingY * 2,
      );
    }
    return offsets;
  }, [pages, prefs.size, prefs.lineHeight, prefs.paragraph, paddingY]);
  const visibleStart = Math.max(0, index - 3),
    visibleEnd = Math.min(pages.length, index + 5);
  useEffect(() => {
    let active = true;
    setCacheReady(false);
    void cacheWrites.current.catch(() => {}).then(() => get<Record<string, string>>(translationCacheKey(translationSettings)))
      .then(saved => { if (active) { setTranslations(saved || {}); setCacheReady(true); } })
      .catch(() => { if (active) { setAutoError("读取译文失败。"); setCacheReady(true); } });
    return () => { active = false; };
  }, [book.id, book.encoding, translationSettings.base, translationSettings.target]);
  useEffect(() => {
    if (!autoActive || loading || !cacheReady || !pages[index] || autoBusy || !apiKey.trim() || !isTauri()) return;
    const page = pages.slice(index, index + (twoColumns ? 3 : 2)).find(candidate => {
      const k = `${candidate.start}:${candidate.end}`;
      return translations[k] === undefined || (compareTranslation && !readAligned(translations[`aligned:${k}`]));
    });
    if (!page) return;
    const key = `${page.start}:${page.end}`;
    if (translations[key] !== undefined && (!compareTranslation || readAligned(translations[`aligned:${key}`]))) return;
    const generation = translationGeneration.current;
    const text = book.text.slice(page.start, page.end);
    if (!text.trim()) return;
    setAutoBusy(key);
    setAutoError("");
    void translateAligned(translationSettings.base, apiKey, translationSettings.target, text)
      .then(async result => {
        if (generation !== translationGeneration.current) return;
        const { translated, aligned } = await saveGeneratedPairs(page.start, page.end, result, translationSettings);
        if (generation === translationGeneration.current) setTranslations(old => { const next = { ...old, [key]: translated, [`aligned:${key}`]: aligned }; delete next[`partial:${key}`]; return next; });
      })
      .catch(e => {
        if (generation === translationGeneration.current) {
          setAutoError("自动翻译暂停：" + String(e).replaceAll(apiKey, "[密钥]"));
          setAutoActive(false);
        }
      })
      .finally(() => { if (generation === translationGeneration.current) setAutoBusy(""); });
  }, [autoActive, autoBusy, apiKey, book.text, index, loading, cacheReady, pages, translations, translationSettings, compareTranslation, twoColumns]);
  useEffect(() => () => { translationGeneration.current++; }, []);
  useEffect(() => {
    const resize = () => setSize({ w: innerWidth, h: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!autoScroll || !scrolling) return;
    const timer = window.setInterval(() => { if (body.current) body.current.scrollTop += 2; }, 60);
    return () => window.clearInterval(timer);
  }, [autoScroll, scrolling]);
  useEffect(() => {
    if (!book.firstOpened)
      void patch(book.id, {
        firstOpened: Date.now(),
        lastRead: Date.now(),
        visited: [0],
      });
  }, [book.id]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    const cacheKey = JSON.stringify([
      book.id,
      book.text.length,
      book.encoding,
      prefs.customFontRevision,
      layout,
      font,
      prefs.weight,
    ]);
    const cached = pageCache.get(cacheKey);
    setError("");
    if (cached) {
      setPages(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const worker = new Worker(
      new URL("./pagination.worker.ts", import.meta.url),
      { type: "module" },
    );
    const fail = (message: string) => {
      if (!cancelled) {
        setError(message);
        setLoading(false);
      }
    };
    worker.onerror = () => fail("排版暂时失败，请返回书库后重新打开。");
    void (async () => {
      try {
        if (prefs.font === "readestWenKaiScreen") {
          const loaded = await document.fonts.load(`400 ${prefs.size}px "PaperRealm WenKaiScreen"`, "汉字阅读");
          if (!loaded.length || loaded.some(face => face.status !== "loaded")) throw Error("屏幕版字体未能加载");
        } else await document.fonts.load(`${prefs.weight} ${prefs.size}px ${font}`, "汉A Русский العربية");
        if (cancelled) return;
        const c = document.createElement("canvas").getContext("2d")!;
        c.font = `${prefs.weight} ${prefs.size}px ${font}`;
        const widths: Record<string, number> = {
          defaultCJK: c.measureText("汉").width,
        };
        for (let code = 32; code < 127; code++)
          widths[String.fromCharCode(code)] = c.measureText(
            String.fromCharCode(code),
          ).width;
        if (/[A-Za-z\u0400-\u08ff]/.test(book.text)) {
          const words = new Set<string>();
          for (const paragraph of book.text.split("\n")) if (/[\u0590-\u08ff]/.test(paragraph) || (/[A-Za-z\u0400-\u052f]/.test(paragraph) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(paragraph))) {
            for (const match of paragraph.matchAll(/\S+\s*|\s+/gu)) {
              const token = match[0];
              if (!words.has(token)) { words.add(token); widths[`word:${token}`] = c.measureText(token).width; }
            }
          }
        }
        worker.onmessage = (e) => {
          if (cancelled) return;
          if (e.data.error) {
            fail("排版失败：" + e.data.error);
            return;
          }
          pageCache.set(cacheKey, e.data.pages);
          if (pageCache.size > 4)
            pageCache.delete(pageCache.keys().next().value!);
          setPages(e.data.pages);
          setLoading(false);
        };
        worker.postMessage({ id: 1, text: book.text, layout, widths });
      } catch {
        fail(prefs.font === "readestWenKaiScreen" ? "霞鹜文楷屏幕版加载失败，请尝试重新安装本版本或在阅读外观中切换字体。" : "字体加载失败，请更换字体后重试。");
      }
    })();
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [
    book.id,
    book.text,
    book.encoding,
    layout,
    font,
    prefs.weight,
    prefs.size,
    prefs.customFontRevision,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || loading) return;
      const b = current.current,
        day = new Date().toLocaleDateString("sv-SE");
      void patch(b.id, {
        seconds: b.seconds + 10,
        daily: { ...b.daily, [day]: (b.daily[day] || 0) + 10 },
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [book.id, loading]);
  function scrollToOffset(offset: number) {
    if (!body.current) return;
    const at = pageAt(pages, offset);
    const line = pages[at]?.lines.find((line) => line.end > offset);
    body.current.scrollTop = (metrics[at] || 0) + (line?.y || 0) + paddingY;
  }
  useLayoutEffect(() => {
    if (scrolling && !loading) scrollToOffset(book.offset);
  }, [scrolling, loading, pages]);
  useLayoutEffect(() => {
    if (scrolling && pendingScroll.current !== null && body.current) {
      scrollToOffset(pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [book.offset, scrolling, metrics]);
  function go(offset: number, navigate = true, fromSpeech = false) {
    if (navigate && !fromSpeech && narrationRef.current?.status !== "stopped") narrationRef.current?.stop();
    if (navigate && scrolling) {
      pendingScroll.current = offset;
      if (body.current) scrollToOffset(pendingScroll.current);
      if (offset === book.offset) pendingScroll.current = null;
    }
    const visited = book.chapters.reduce(
      (a, c, i) => (c.offset <= offset ? i : a),
      0,
    );
    void patch(book.id, {
      offset,
      context: book.text.slice(offset, offset + 48),
      lastRead: Date.now(),
      visited: Array.from(new Set([...book.visited, visited])),
    });
  }
  function playSound() {
    if (!prefs.sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      const ctx = audio.current,
        buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * 0.025 * (1 - i / data.length);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
    } catch {
      /* Optional sound must not interrupt reading. */
    }
  }
  const simulatedFlip = prefs.simulatedFlip !== false && !scrolling && !prefs.lowPower && !curlFailed && bookDirection !== "rtl";
  function canTurn(dir: number) { return !loading && !!pages.length && (dir < 0 ? index > 0 : index + (twoColumns ? 2 : 1) < pages.length); }
  function commitTurn(dir: number) {
    if (!canTurn(dir)) return;
    const next = Math.max(0, Math.min(pages.length - 1, index + dir * (twoColumns ? 2 : 1)));
    if (next === index) return;
    go(pages[next].start);
    playSound();
    if (next + (twoColumns ? 1 : 0) >= pages.length - 1) void patch(book.id, { done: true });
  }
  function turn(dir: number) {
    if (loading || !pages.length) return;
    if (!scrolling && showTranslation) {
      const candidates = Array.from(body.current?.querySelectorAll<HTMLElement>(".translated-reading") || []);
      if (dir < 0) candidates.reverse();
      const translated = candidates.find(el => dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 3 : el.scrollTop > 3);
      if (translated && (dir > 0 ? translated.scrollTop + translated.clientHeight < translated.scrollHeight - 3 : translated.scrollTop > 3)) {
        translated.scrollBy({ top: dir * Math.max(80, translated.clientHeight * 0.85), behavior: "smooth" });
        return;
      }
    }
    if (!canTurn(dir)) return;
    if (simulatedFlip && flipRef.current) flipRef.current.turn(dir);
    else commitTurn(dir);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        selection
      )
        return;
      if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); setPanel("search"); return; }
      if (e.ctrlKey && e.key.toLowerCase() === "b") { e.preventDefault(); bookmark(); return; }
      if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.altKey) { setPanel(p => p === "toc" ? "" : "toc"); return; }
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.altKey) { setPanel(p => p === "marks" ? "" : "marks"); return; }
      if (["ArrowRight", "PageDown", " "].includes(e.key) || e.code === "Numpad6") {
        e.preventDefault();
        turn((e.key === "ArrowRight" || e.code === "Numpad6") && bookDirection === "rtl" ? -1 : 1);
      }
      if (["ArrowLeft", "PageUp"].includes(e.key) || e.code === "Numpad4") {
        e.preventDefault();
        turn((e.key === "ArrowLeft" || e.code === "Numpad4") && bookDirection === "rtl" ? 1 : -1);
      }
      if (e.key === "Escape") {
        setFocus(false);
        setPanel("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, pages, scrolling, loading, selection, prefs.sound, book.marks, showTranslation, twoColumns, simulatedFlip, bookDirection]);
  function bookmark() {
    const existing = book.marks.find(
        (m) => m.kind === "bookmark" && pageAt(pages, m.offset) === index,
      ),
      offset = pages[index]?.start ?? book.offset;
    void patch(book.id, {
      marks: existing
        ? book.marks.filter((m) => m.id !== existing.id)
        : [
            ...book.marks,
            {
              id: crypto.randomUUID(),
              offset,
              context: book.text.slice(offset, offset + 48),
              note: "",
              kind: "bookmark",
              created: Date.now(),
            },
          ],
    });
  }
  function capture() {
    const s = window.getSelection();
    if (!s || s.isCollapsed) return;
    const range = s.getRangeAt(0),
      el =
        range.startContainer.parentElement?.closest<HTMLElement>(
          "[data-offset]",
        ),
      endEl =
        range.endContainer.parentElement?.closest<HTMLElement>("[data-offset]");
    if (!el || !endEl || !body.current?.contains(el)) return;
    const inLine = (line: HTMLElement, node: Node, at: number) => {
      const r = document.createRange(); r.selectNodeContents(line); r.setEnd(node, at); return r.toString().length;
    };
    const original = prefs.conversion === "original",
      offset = Number(el.dataset.offset) + (original ? inLine(el, range.startContainer, range.startOffset) : 0),
      end = original
        ? Number(endEl.dataset.offset) + inLine(endEl, range.endContainer, range.endOffset)
        : Number(endEl.dataset.end);
    setSelection({ text: book.text.slice(offset, end), offset });
    setNote("");
  }
  function saveQuote() {
    if (!selection) return;
    void patch(book.id, {
      marks: [
        ...book.marks,
        {
          id: crypto.randomUUID(),
          offset: selection.offset,
          context: selection.text,
          note,
          kind: "quote",
          color: markColor,
          style: markStyle,
          created: Date.now(),
        },
      ],
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }
  function exportNotes(format: "md" | "txt") {
    const notes = book.marks.filter(m => m.kind === "quote").sort((a,b) => a.offset-b.offset);
    const text = `${format === "md" ? "# " : ""}${book.title}\n\n作者：${book.author}\n\n` + notes.map(m => {
      const chapter = [...book.chapters].reverse().find(c => c.offset <= m.offset)?.title || "正文";
      const quote = format === "md" ? `> ${m.context.replace(/\n/g,"\n> ")}` : m.context;
      return `${format === "md" ? "## " : ""}${chapter}\n\n${quote}\n\n${m.note ? `批注：${m.note}\n\n` : ""}`;
    }).join("\n");
    void saveFile(book.title.replace(/[\\/:*?"<>|]/g,"_") + `-摘录.${format}`, text).catch(() => setAutoError("导出失败，请检查保存位置。"));
  }
  async function full() {
    try {
      if (isTauri()) await getCurrentWindow().setFullscreen(!fullscreen);
      else if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      setFullscreen(!fullscreen);
    } catch {
      setError("无法切换全屏，请尝试最大化窗口。");
    }
  }
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const list: { offset: number; text: string }[] = [];
    let pos = 0;
    while (list.length < 100) {
      pos = book.text.indexOf(query, pos);
      if (pos < 0) break;
      list.push({
        offset: pos,
        text: book.text.slice(Math.max(0, pos - 12), pos + 70),
      });
      pos += query.length;
    }
    return list;
  }, [book.text, query]);
  const display = (text: string) => {
    const s = convert(text, prefs.conversion);
    return prefs.punctuation === "full"
      ? s.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：")
      : s;
  };
  function renderLine(line: import("./types").Line) {
    const marks = book.marks.filter(m => m.kind === "quote" && m.offset < line.end && m.offset + m.context.length > line.start);
    const rendered = display(line.text);
    if (!marks.length || rendered.length !== line.text.length) return rendered;
    const boundaries = new Set([0, line.text.length]);
    for (const m of marks) { boundaries.add(Math.max(0, m.offset - line.start)); boundaries.add(Math.min(line.text.length, m.offset + m.context.length - line.start)); }
    const points = [...boundaries].sort((a,b) => a-b);
    return points.slice(0,-1).map((start, i) => {
      const end = points[i+1], mark = marks.find(m => m.offset <= line.start + start && m.offset + m.context.length >= line.start + end);
      const fragment = rendered.slice(start, end);
      return mark ? <span key={start} title={mark.note || "阅读标记"} style={mark.style === "underline" ? { textDecoration: `underline 2px ${mark.color || "#e8c964"}`, textUnderlineOffset: 4 } : { background: (mark.color || "#e8c964") + "70", borderRadius: 2 }}>{fragment}</span> : <span key={start}>{fragment}</span>;
    });
  }
  function pageTexture(pageNumber: number, side: "left" | "right") {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(pageWidth * ratio); canvas.height = Math.ceil(pageHeight * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("无法绘制书页纹理");
    ctx.scale(ratio, ratio); ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, pageWidth, pageHeight);
    const image = backgroundImage.current, root = body.current?.closest(".reader")?.getBoundingClientRect();
    const stage = body.current?.querySelector(".single-reading")?.getBoundingClientRect();
    if (image && root && stage && root.width && root.height) {
      const x = stage.left + (twoColumns && side === "right" ? pageWidth + 8 : 0);
      const sx = (x - root.left) / root.width * image.naturalWidth, sy = (stage.top - root.top) / root.height * image.naturalHeight;
      const sw = pageWidth / root.width * image.naturalWidth, sh = pageHeight / root.height * image.naturalHeight;
      if (sx >= 0 && sy >= 0 && sx + sw <= image.naturalWidth + 1 && sy + sh <= image.naturalHeight + 1) ctx.drawImage(image, sx, sy, sw, sh, 0, 0, pageWidth, pageHeight);
    }
    const page = pages[pageNumber]; if (!page) return canvas;
    ctx.fillStyle = palette.ink; ctx.textBaseline = "top";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${prefs.spacing}px`;
    const key = `${page.start}:${page.end}`;
    const partial = !autoActive && translations[`partial:${key}`];
    const aligned = readAligned(translations[`aligned:${key}`]);
    const pairs = aligned && applySavedCorrections(aligned, page.start, translations);
    const translated = partial || (pairs ? joinedTranslation(pairs) : translations[key]);
    if (showTranslation && translated !== undefined) {
      const visible = body.current?.querySelector<HTMLElement>(`[data-page="${pageNumber}"] .translated-reading`);
      let y = paddingY - (visible?.scrollTop || 0);
      ctx.font = `11px "Microsoft YaHei", sans-serif`; ctx.globalAlpha = .7; ctx.fillText(compareTranslation ? "逐句对照" : "译文", paddingX, y); ctx.globalAlpha = 1; y += 28;
      const drawText = (text: string, small = false) => {
        ctx.font = `${prefs.weight} ${prefs.size * (small ? .9 : 1)}px ${font}`;
        ctx.globalAlpha = small ? .72 : 1;
        const lineHeight = prefs.size * prefs.lineHeight, maxWidth = pageWidth - paddingX * 2;
        let line = "";
        for (const ch of Array.from(text)) {
          if (ch === "\n" || (line && ctx.measureText(line + ch).width > maxWidth)) {
            if (y > -lineHeight && y < pageHeight) ctx.fillText(line, paddingX, y);
            y += lineHeight; line = ch === "\n" ? "" : ch;
          } else line += ch;
        }
        if (line) { if (y > -lineHeight && y < pageHeight) ctx.fillText(line, paddingX, y); y += lineHeight; }
        ctx.globalAlpha = 1;
      };
      if (compareTranslation && pairs && !partial) for (const pair of pairs) { drawText(pair.source, true); drawText(pair.translation); y += prefs.size * .5; }
      else drawText(translated);
      return canvas;
    }
    for (const line of page.lines) {
      const x = paddingX + (line.indent ? prefs.size * 2 : 0), y = paddingY + line.y;
      ctx.font = `${line.title ? 600 : prefs.weight} ${prefs.size * (line.title ? 1.3 : 1)}px ${font}`;
      const rendered = display(line.text);
      if (rendered.length === line.text.length) for (const mark of book.marks) {
        if (mark.kind !== "quote" || mark.offset >= line.end || mark.offset + mark.context.length <= line.start) continue;
        const a = Math.max(0, mark.offset - line.start), b = Math.min(rendered.length, mark.offset + mark.context.length - line.start);
        const x0 = x + ctx.measureText(rendered.slice(0,a)).width, width = ctx.measureText(rendered.slice(a,b)).width;
        ctx.save(); ctx.fillStyle = mark.color || "#e8c964"; ctx.globalAlpha = mark.style === "underline" ? .9 : .4;
        ctx.fillRect(x0, mark.style === "underline" ? y + prefs.size * 1.1 : y, width, mark.style === "underline" ? 2 : prefs.size * prefs.lineHeight); ctx.restore();
      }
      ctx.fillStyle = palette.ink; ctx.fillText(rendered, x, y);
    }
    return canvas;
  }
  const pageNode = (p: Page, i: number) => {
    const cachedPairs = readAligned(translations[`aligned:${p.start}:${p.end}`]);
    const pagePairs = cachedPairs && applySavedCorrections(cachedPairs, p.start, translations);
    return (
    <article
      key={i}
      data-page={i}
      className="reading-page"
      aria-label={trFormat("正文第 {0} 页", i + 1)}
      style={{
        width: pageWidth,
        height: scrolling ? metrics[i + 1] - metrics[i] : pageHeight,
        fontFamily: font,
        fontSize: prefs.size,
        fontWeight: prefs.weight,
        letterSpacing: prefs.spacing,
      }}
    >
      {showTranslation && (translations[`${p.start}:${p.end}`] !== undefined || (!autoActive && translations[`partial:${p.start}:${p.end}`] !== undefined)) ? (
        <div className="translated-reading" style={{ padding: `${paddingY}px ${paddingX}px`, lineHeight: prefs.lineHeight }}>
          <div className="translated-label">{compareTranslation ? tr("逐句对照") : tr("译文")} · <button onClick={() => setShowTranslation(false)}>{"" + tr("显示原文") + ""}</button> · <button onClick={() => setCompareTranslation(v => !v)}>{compareTranslation ? tr("仅显示译文") : tr("逐句对照")}</button></div>
          {compareTranslation && (autoActive || !translations[`partial:${p.start}:${p.end}`]) && pagePairs ? <div className="aligned-pairs"><div className="aligned-heading"><span>{"" + tr("原文 / 译文 · 点击“编辑”可修正译文") + ""}</span><button onClick={() => { void saveFile(book.title.replace(/[\\/:*?"<>|]/g, "_") + `-第${i + 1}页逐句对照.txt`, pagePairs.map(pair => `原文：${pair.source.trim()}\n译文：${pair.translation.trim()}`).join("\n\n")).catch(() => setAutoError("导出失败，请检查保存位置。")); }}>{"" + tr("导出本页对照") + ""}</button></div>{pagePairs.map((pair, n) => <AlignedSentence key={n} pair={pair} index={n} save={text => saveAlignedEdit(p, n, pair.source, text)} />)}</div> : <>{compareTranslation && <div className="alignment-hint">{"" + tr("此页尚无逐句对照数据。") + ""}{autoActive ? tr("正在准备逐句翻译。") : <button onClick={() => openTranslation(book.text.slice(p.start, p.end), p.start)}>{"" + tr("重新翻译此页以生成对照") + ""}</button>}</div>}<div>{(!autoActive && translations[`partial:${p.start}:${p.end}`]) || (pagePairs ? joinedTranslation(pagePairs) : translations[`${p.start}:${p.end}`])}</div></>}
        </div>
      ) : p.lines.map((line) => (
        <div
          dir={line.direction || "ltr"}
          className={"text-line " + (line.title ? "chapter-line " : "") + (narration.range && narration.range.start < line.end && narration.range.end > line.start ? "spoken-line " : "") + (paragraphFocus && activeParagraph && line.start >= activeParagraph.start && line.start < activeParagraph.end ? "active-paragraph" : "")}
          onMouseEnter={() => { if (paragraphFocus) setActiveParagraph({ start: book.text.lastIndexOf("\n", Math.max(0,line.start-1)) + 1, end: (() => { const e=book.text.indexOf("\n", line.start); return e < 0 ? book.text.length : e; })() }); }}
          data-offset={line.start}
          data-end={line.end}
          key={line.start}
          style={{
            position: "absolute",
            top: paddingY + line.y,
            left: line.direction === "rtl" ? paddingX : paddingX + (line.indent ? prefs.size * 2 : 0),
            right: line.direction === "rtl" ? paddingX + (line.indent ? prefs.size * 2 : 0) : paddingX - 14,
            textAlign: line.direction === "rtl" ? "right" : "left",
            unicodeBidi: "isolate",
            letterSpacing: line.direction === "rtl" ? 0 : prefs.spacing,
            lineHeight: prefs.size * prefs.lineHeight + "px",
            whiteSpace: "pre",
          }}
        >
          {renderLine(line)}
        </div>
      ))}
    </article>
  ); };
  const narration = useNarration(book, (offset) => go(offset, true, true), values => { void patch(book.id, values); });
  narrationRef.current = narration;
  const openTranslation = (text: string, start?: number) => {
    const page = pages[start === undefined ? index : pageAt(pages, start)];
    if (!page) return;
    const first = start ?? page.start, end = start === undefined ? page.end : start + text.length;
    if (first < page.start || end > page.end) { window.alert("请选择同一页内的文字进行翻译。"); return; }
    setTranslationRange({ pageStart: page.start, pageEnd: page.end, start: first, end });
    setTranslationText(text);
    setPanel("translation");
  };
  const toggle = (name: string) => setPanel(panel === name ? "" : name),
    dark = isDark(prefs.readerBackground);
  return (
    <div
      className={`reader reader-modern readest-layout ${prefs.paperBackground === "soft" ? "paper-soft" : prefs.paperBackground === "vintage" ? "paper-vintage" : palette.paper.toLowerCase() === "#8b765b" ? "paper-grain" : ""} ${sidebarOpen ? "sidebar-open" : ""} ${sidebarDocked ? "sidebar-docked" : ""} ${hoverEdge === "top" ? "show-top" : ""} ${hoverEdge === "bottom" ? "show-bottom" : ""} ${menusVisible ? "menus-expanded" : ""} ${focus || hideTools ? "focus-mode" : ""} ${prefs.animation && !prefs.lowPower ? "reader-motion" : ""}`}
      onMouseMove={e => { if (curlActive) return; const bounds = e.currentTarget.getBoundingClientRect(); const y = e.clientY - bounds.top; setHoverEdge(y < 70 ? "top" : y > bounds.height - 120 ? "bottom" : ""); }}
      onMouseLeave={() => { if (!curlActive) setHoverEdge(""); }}
      onFocusCapture={e => { const target = e.target as HTMLElement; if (target.closest(".reader-top, .reader-footer") && target.matches(":focus-visible")) setControlsFocused(true); }}
      onBlurCapture={e => { const next = e.relatedTarget as HTMLElement | null; if (!next?.closest?.(".reader-top, .reader-footer")) setControlsFocused(false); }}
      style={
        {
          "--reader-bg": prefs.readerBackground,
          "--reader-paper": palette.paper,
          "--reader-ink": palette.ink,
          "--reader-ui": palette.ink,
          "--reader-panel": palette.paper.toLowerCase() === "#8b765b" ? "#302b25" : dark ? "#25313b" : "#fcfbf7",
          "--reader-line": dark ? "#ffffff18" : "#334a371c",
          "--reader-hover": palette.paper.toLowerCase() === "#8b765b" ? "#30291f66" : dark ? "#ffffff0d" : "#3c514b0b",
          "--reader-accent": palette.paper.toLowerCase() === "#8b765b" ? "#ffdaa4" : dark ? "#c2d5b1" : "#567355",
          colorScheme: dark ? "dark" : "light",
        } as CSSProperties
      }
    >
      <div aria-hidden="true" className="reader-brightness-overlay" style={{ opacity: 1 - Math.max(30, Math.min(100, prefs.readerBrightness ?? 100)) / 100 }} />
      {(prefs.paperBackground === "soft" || prefs.paperBackground === "vintage") && <div aria-hidden="true" className={`paper-ambient ${prefs.paperBackgroundMotion !== false && !prefs.lowPower ? "paper-ambient-moving" : ""}`} />}
      {sidebarOpen && !focus && <aside className="reading-sidebar" aria-label={tr("阅读目录")}>
        <div className="reading-sidebar-book"><strong title={book.title}>{book.title}</strong><span>{book.author || "佚名"}</span></div>
        <div className="reading-sidebar-chapters">
          {book.chapters.map((c, i) => <div key={c.offset}>
            <button className={i === chapterIndex ? "reading-chapter current" : "reading-chapter"} aria-current={i === chapterIndex ? "location" : undefined} onClick={() => { go(c.offset); if (size.w < 1000) setSidebarOpen(false); }}><span>{c.title}</span><small>{pages.length ? pageAt(pages, c.offset) + 1 : ""}</small></button>
            {i === chapterIndex && <button className="reading-current-position" onClick={() => { go(book.offset); if (size.w < 1000) setSidebarOpen(false); }}><BookOpen size={16}/><span>{"" + tr("当前位置") + ""}</span><small>{Math.min(index + 1, pages.length)}</small></button>}
          </div>)}
        </div>
      </aside>}
      <header className="reader-top">
        <button onClick={() => setSidebarOpen(v => !v)} title={tr(sidebarOpen ? "收起目录" : "打开目录")} aria-label={tr(sidebarOpen ? "收起目录" : "打开目录")}><PanelLeft size={19}/></button>
        <button onClick={() => void returnToLibrary()} aria-label={tr("返回书库")} title={tr("返回书库")}><BookOpen size={19}/></button>
        <button onClick={() => { setPanel("search"); if (size.w < 1000) setSidebarOpen(false); }} aria-label={tr("搜索原文")} title={tr("搜索原文")}><Search size={19}/></button>
        <button onClick={bookmark} aria-label={tr(marked ? "移除书签" : "添加书签")} title={tr(marked ? "移除书签" : "添加书签")}><Bookmark size={19} fill={marked ? "currentColor" : "none"}/></button>
        <button onClick={() => openTranslation(book.text.slice(pages[index]?.start ?? book.offset, pages[index]?.end ?? book.offset))} aria-label={tr("翻译当前页")} title={tr("翻译当前页")}><Languages size={19}/></button>
        <div className="reader-title" data-tauri-drag-region>
          <b>{book.title}</b>
        </div>
        <div className="row">
          <button onClick={() => { toggle("appearance"); if (size.w < 1000) setSidebarOpen(false); }} title={tr("阅读外观")} aria-label={tr("阅读外观")}><SlidersHorizontal size={18}/></button>
          <button className="paper-quick-theme" title={tr("应用参考图的棕金羊皮配色")} onClick={() => void setPrefs({ paperBackground: "plain", readerBackground: "#8b765b", theme: "custom", customPaper: "#8b765b", customInk: "#ffdaa4" })}>{"" + tr("棕金纸") + ""}</button>
          <button
            title={tr("专注模式")}
            aria-label={tr("专注模式")}
            onClick={() => {
              setFocus(!focus);
              setPanel("");
            }}
          >
            <Focus size={18} />
          </button>
          <button title={tr("全屏")} aria-label={tr("全屏")} onClick={() => void full()}>
            <Maximize size={18} />
          </button>
          {isTauri() && <><button title={tr("最小化")} aria-label={tr("最小化")} onClick={() => void getCurrentWindow().minimize()}><Minus size={17}/></button><button title={tr("最大化")} aria-label={tr("最大化")} onClick={() => void getCurrentWindow().toggleMaximize()}><Square size={14}/></button><button title={tr("关闭")} aria-label={tr("关闭")} onClick={() => void getCurrentWindow().close()}><X size={18}/></button></>}
        </div>
      </header>
      <div className="reader-location">
        <button onClick={() => setSidebarOpen(v => !v)}>
          {chapter?.title}
          <ChevronRight size={13} />
        </button>
        <span>{"" + tr("已读") + " "}{progress(book)}%</span>
        {autoActive && <button className="translation-status" onClick={() => { translationGeneration.current++; setAutoActive(false); setAutoBusy(""); }}> {autoBusy ? tr("正在自动翻译…") : tr("自动翻译已开启")} {" " + tr("· 关闭") + ""}</button>}
        {autoError && <button className="translation-status" onClick={() => openTranslation(book.text.slice(pages[index]?.start ?? book.offset, pages[index]?.end ?? book.offset))}>{autoError} {" " + tr("· 重试") + ""}</button>}
        {windowNotice && <button className="translation-status" onClick={() => setWindowNotice("")} title={tr("点击关闭提示")}>{windowNotice} {" " + tr("· 关闭") + ""}</button>}
        {curlFailed && <button className="translation-status" onClick={() => setCurlFailed(false)} title={tr("重新尝试仿真翻页")}>{"" + tr("图形翻页不可用，已切换普通翻页 · 重试") + ""}</button>}
      </div>
      <div className="reader-body">
        <div
          className={`reading-stage ${scrolling ? "scroll-stage" : ""}`}
          style={{ paddingTop: menuTopInset }}
          ref={body}
          onMouseMove={e => { if (ruler) setRulerY(e.clientY); }}
          onClick={e => { if (hideTools && !panel && window.getSelection()?.isCollapsed && !(e.target as HTMLElement).closest("button, input, textarea, select") && (e.target as HTMLElement).closest(".reading-page")) setHideTools(false); }}
          onMouseUp={capture}
          onScroll={(e) => {
            if (!scrolling || loading || pendingScroll.current !== null) return;
            const y = e.currentTarget.scrollTop + 1;
            let lo = 0,
              hi = pages.length - 1;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (metrics[mid] <= y) lo = mid;
              else hi = mid - 1;
            }
            const p = pages[lo];
            if (p) {
              const localY = y - metrics[lo] - paddingY;
              const line = p.lines.find(
                (line) => line.y + prefs.size * prefs.lineHeight > localY,
              );
              const offset = line?.start ?? p.start;
              if (offset !== book.offset) go(offset, false);
            }
          }}
        >
          {ruler && <div className="reading-ruler" style={{ top: rulerY }} />}
          {loading && !pages.length ? (
            <div className="loading">{"" + tr("正在整理文字…") + ""}</div>
          ) : error ? (
            <div className="reader-error" role="alert">
              {tr(error)}
            </div>
          ) : scrolling ? (
            <div
              className="scroll-pages" dir={bookDirection}
              style={{
                background: palette.paper,
                paddingTop: metrics[visibleStart],
                paddingBottom: metrics[pages.length] - metrics[visibleEnd],
                width: pageWidth,
              }}
            >
              {pages
                .slice(visibleStart, visibleEnd)
                .map((p, i) => pageNode(p, visibleStart + i))}
            </div>
          ) : (
            <div dir={bookDirection} className={`single-reading ${twoColumns ? "two-columns" : ""}`} key={index}>
              {(() => {
                const first = curlActive ? (twoColumns ? (curlActive > 0 ? index : index - 2) : index + curlActive) : index;
                const second = curlActive ? (curlActive > 0 ? index + 3 : index + 1) : index + 1;
                return <>{pages[first] ? pageNode(pages[first], first) : <div style={{ width:pageWidth, height:pageHeight, flexShrink:0 }} />}{twoColumns && (pages[second] ? pageNode(pages[second], second) : <div style={{ width:pageWidth, height:pageHeight, flexShrink:0 }} />)}</>;
              })()}
              {simulatedFlip && <PaperFlip ref={flipRef} pageWidth={pageWidth} height={pageHeight} spread={twoColumns}
                canTurn={canTurn} onTurn={commitTurn} onActive={setCurlActive}
                front={dir => pageTexture(twoColumns && dir > 0 ? index + 1 : index, dir > 0 ? "right" : "left")}
                back={dir => pageTexture(index + (twoColumns ? (dir > 0 ? 2 : -1) : dir), dir > 0 ? "left" : "right")}
                onError={() => { setCurlActive(0); setCurlFailed(true); }} />}
            </div>
          )}
        </div>
        {panel && (
          <button
            className="reader-drawer-shade"
            aria-label={tr("收起面板")}
            onClick={() => setPanel("")}
          />
        )}
        {panel && (
          <aside
            className={`reader-panel ${["appearance", "translation", "voice", "dictionary", "aids"].includes(panel) ? "appearance-panel" : ""}`}
            aria-label={tr(panel === "appearance" ? "阅读外观面板" : "阅读导航面板")}
          >
            <header>
              <div>
                <small>
                  {panel === "appearance"
                    ? "YOUR READING SPACE"
                    : "BETWEEN THE LINES"}
                </small>
                <b>
                  {tr(
                    {
                      toc: "章节目录",
                      search: "全文搜索",
                      marks: "书签与摘录",
                      appearance: "阅读外观",
                      translation: "DeepSeek 翻译",
                      voice: "语音朗读",
                      dictionary: "离线词典",
                      aids: "阅读辅助",
                    }[panel] || "")
                  }
                </b>
              </div>
              <button aria-label={tr("关闭面板")} onClick={() => setPanel("")}>
                <X size={18} />
              </button>
            </header>
            {panel === "toc" &&
              book.chapters.map((c, i) => (
                <button
                  key={c.offset}
                  className={i === chapterIndex ? "current" : ""}
                  onClick={() => go(c.offset)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {c.title}
                </button>
              ))}
            {panel === "search" && (
              <>
                <input
                  autoFocus
                  placeholder={tr("搜索原文，最多显示 100 条")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <p>
                  {query
                    ? trFormat("找到 {0}{1} 处结果", results.length, results.length === 100 ? "+" : "")
                    : tr("输入关键词，找回故事里的片段。")}
                </p>
                {results.map((r) => (
                  <button key={r.offset} onClick={() => go(r.offset)}>
                    {r.text}
                  </button>
                ))}
              </>
            )}
            {panel === "marks" && (
              <>
                <button onClick={() => exportNotes("md")}>{"" + tr("导出摘录与批注 Markdown") + ""}</button>
                <button onClick={() => exportNotes("txt")}>{"" + tr("导出摘录与批注 TXT") + ""}</button>
                {!book.marks.length && (
                  <p>{"" + tr("点击底栏书签保存当前位置，或选择正文收藏摘录。") + ""}</p>
                )}
                {book.marks.map((m) => (
                  <div className="mark-item" key={m.id}>
                    <button onClick={() => go(m.offset)}>
                      {m.kind === "quote" ? "“ " : "⌑ "}
                      {m.context}
                      <small>{m.note}</small>
                    </button>
                    <button
                      aria-label={tr("删除记录")}
                      onClick={() =>
                        void patch(book.id, {
                          marks: book.marks.filter((x) => x.id !== m.id),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
            {panel === "voice" && <VoicePanel narration={narration} />}
            {panel === "dictionary" && <Dictionary initial={dictionaryQuery} />}
            {panel === "aids" && <div className="service-panel"><p>{"" + tr("让阅读节奏更适合你。") + ""}</p><button onClick={() => setRuler(v => !v)}>{ruler ? tr("关闭") : tr("开启")}{"" + tr("阅读标尺") + ""}</button><button onClick={() => setParagraphFocus(v => !v)}>{paragraphFocus ? tr("关闭") : tr("开启")}{"" + tr("当前段落突出显示") + ""}</button><button onClick={() => { if (!scrolling) void setPrefs({ mode: "scroll" }); setAutoScroll(v => !v); }}>{autoScroll ? tr("停止") : tr("开始")}{"" + tr("自动滚动") + ""}</button><button onClick={() => { setHideTools(true); setPanel(""); }}>{"" + tr("隐藏工具栏（点击正文恢复）") + ""}</button></div>}
            {panel === "translation" && (
              <TranslationPanel
                initial={translationText}
                wholePage={translationRange ? book.text.slice(translationRange.pageStart, translationRange.pageEnd) : ""}
                apiKey={apiKey}
                setApiKey={setApiKey}
                settings={translationSettings}
                onStartAuto={(settings) => {
                  translationGeneration.current++; setAutoBusy(""); setAutoError(""); setCacheReady(false); setTranslations({});
                  const generation = translationGeneration.current;
                  void patch(book.id, { translationTarget: settings.target });
                  setTranslationSettings(settings); setAutoActive(true); setShowTranslation(true); setPanel("");
                  if (settings.base === translationSettings.base && settings.target === translationSettings.target) {
                    void cacheWrites.current.catch(() => {}).then(() => get<Record<string, string>>(translationCacheKey(settings))).then(saved => { if (generation === translationGeneration.current) { setTranslations(saved || {}); setCacheReady(true); } }).catch(() => { if (generation === translationGeneration.current) { setAutoError("读取译文失败。"); setCacheReady(true); } });
                  }
                }}
                onClear={() => {
                  translationGeneration.current++; setAutoActive(false); setAutoBusy(""); setTranslations({});
                  const key = translationCacheKey(translationSettings);
                  cacheWrites.current = cacheWrites.current.catch(() => {}).then(() => put(key, {}));
                  trackExtraWrite(cacheWrites.current);
                  void cacheWrites.current.catch(() => setAutoError("清除译文失败，请检查磁盘。"));
                }}
                onApply={(translated, settings, fullPage, aligned) => {
                  if (!translationRange) return;
                  translationGeneration.current++;
                  setAutoBusy("");
                  setAutoError("");
                  const { pageStart, pageEnd, start, end } = translationRange;
                  const merged = fullPage ? translated : book.text.slice(pageStart, start) + translated + book.text.slice(end, pageEnd);
                  const sameSettings = settings.base === translationSettings.base && settings.target === translationSettings.target;
                  const cacheKey = `${fullPage || (start === pageStart && end === pageEnd) ? "" : "partial:"}${pageStart}:${pageEnd}`;
                  if (!sameSettings || aligned) setCacheReady(false);
                  if (aligned) {
                    const generation = translationGeneration.current;
                    void saveGeneratedPairs(pageStart, pageEnd, aligned, settings).then(result => {
                      if (generation !== translationGeneration.current) return;
                      setTranslations(current => { const next = { ...(sameSettings ? current : {}), [cacheKey]: result.translated, [`aligned:${pageStart}:${pageEnd}`]: result.aligned }; delete next[`partial:${cacheKey}`]; return next; });
                      if (sameSettings) setCacheReady(true);
                    }).catch(() => { if (generation === translationGeneration.current) { setAutoError("译文保存失败，请检查磁盘空间。"); setAutoActive(false); if (sameSettings) setCacheReady(true); } });
                  } else {
                    setTranslations(current => ({ ...(sameSettings ? current : {}), [cacheKey]: merged }));
                    rememberTranslation(cacheKey, merged, settings);
                  }
                  void patch(book.id, { translationTarget: settings.target });
                  setTranslationSettings(settings);
                  setAutoActive(settings.auto);
                  setShowTranslation(true);
                  setPanel("");
                }}
              />
            )}
            {panel === "appearance" && (
              <ReaderAppearance
                prefs={prefs}
                setPrefs={setPrefs}
                palette={palette}
              />
            )}
          </aside>
        )}
      </div>
      <footer ref={footerRef} className="reader-footer">
        <div className="reader-bottom">
          <div className="reader-tools">
            <button
              aria-label={tr("目录")}
              title={tr("目录")}
              className={sidebarOpen ? "active" : ""}
              onClick={() => { setSidebarOpen(v => !v); setPanel(""); }}
            >
              <BookOpen size={18} />
            </button>
            <button
              aria-label={tr("搜索")}
              title={tr("搜索")}
              className={panel === "search" ? "active" : ""}
              onClick={() => toggle("search")}
            >
              <Search size={18} />
            </button>
            <button
              aria-label={marked ? "移除书签" : "添加书签"}
              aria-pressed={marked}
              title={marked ? "移除书签" : "添加书签"}
              onClick={bookmark}
              disabled={loading}
            >
              <Bookmark size={18} fill={marked ? "currentColor" : "none"} />
            </button>
            <button
              aria-label={tr("语音朗读")}
              title={tr("语音朗读")}
              onClick={() => toggle("voice")}
            >
              <Volume2 size={18} />
            </button>
            <button aria-label={tr("阅读辅助")} title={tr("阅读辅助")} onClick={() => toggle("aids")}><Focus size={18}/></button>
            <button aria-label={tr("离线词典")} title={tr("离线词典")} onClick={() => { setDictionaryQuery(""); toggle("dictionary"); }}><BookOpen size={18}/></button>
            <button
              aria-label={tr("翻译当前页")}
              title={tr("DeepSeek 翻译当前页")}
              onClick={() =>
                openTranslation(
                  book.text.slice(
                    pages[index]?.start ?? book.offset,
                    pages[index]?.end ?? book.offset,
                  ),
                )
              }
            >
              <Languages size={18} />
            </button>
            {pages[index] && (translations[`${pages[index].start}:${pages[index].end}`] !== undefined || (!autoActive && translations[`partial:${pages[index].start}:${pages[index].end}`] !== undefined)) && !showTranslation && <button aria-label={tr("显示译文")} title={tr("显示译文")} onClick={() => setShowTranslation(true)}>{"" + tr("译文") + ""}</button>}
            <button
              aria-label={tr("书签与摘录")}
              title={tr("书签与摘录")}
              className={panel === "marks" ? "active" : ""}
              onClick={() => toggle("marks")}
            >
              <Quote size={18} />
            </button>
          </div>
          <div className="page-nav">
            <button
              aria-label={tr("上一页")}
              disabled={index <= 0 || loading}
              onClick={() => turn(-1)}
            >
              <ChevronLeft size={19} />
            </button>
            <span>
              {Math.min(index + 1, pages.length)} / {pages.length}
            </span>
            <button
              aria-label={tr("下一页")}
              disabled={index + (twoColumns ? 1 : 0) >= pages.length - 1 || loading}
              onClick={() => turn(1)}
            >
              <ChevronRight size={19} />
            </button>
          </div>
          <div className="reader-tools">
            <select
              aria-label={tr("阅读模式")}
              value={scrolling ? "scroll" : prefs.columnsOnWide !== false ? "columns" : "single"}
              onChange={(e) => void setPrefs({ mode: e.target.value === "scroll" ? "scroll" : "single", ...(e.target.value !== "scroll" ? { columnsOnWide: e.target.value === "columns" } : {}) })}
            >
              <option value="single">{"" + tr("单栏分页") + ""}</option>
              <option value="columns">{"" + tr("双栏分页") + ""}</option>
              <option value="scroll">{"" + tr("连续阅读") + ""}</option>
            </select>
            <button
              className={
                "appearance-trigger " + (panel === "appearance" ? "active" : "")
              }
              aria-label={tr("阅读外观")}
              onClick={() => toggle("appearance")}
            >
              <SlidersHorizontal size={17} />
              <span>{"" + tr("外观") + ""}</span>
            </button>
          </div>
        </div>
        <div className="read-progress">
          <input
            aria-label={tr("阅读进度")}
            type="range"
            min="0"
            max={Math.max(0, pages.length - 1)}
            value={index}
            onChange={(e) => go(pages[Number(e.target.value)]?.start || 0)}
          />
        </div>
        <div className="chapter-shortcuts">
          <button
            disabled={chapterIndex === 0}
            onClick={() => go(book.chapters[chapterIndex - 1].offset)}
          >
            {"" + tr("上一章") + " "}</button>
          <span>
            {"" + tr("第") + " "}{chapterIndex + 1} / {book.chapters.length} {" " + tr("章 · 已阅读") + ""}{" "}
            {Math.floor(book.seconds / 60)} {" " + tr("分钟") + " "}</span>
          <button
            disabled={chapterIndex === book.chapters.length - 1}
            onClick={() => go(book.chapters[chapterIndex + 1].offset)}
          >
            {"" + tr("下一章") + " "}</button>
        </div>
      </footer>
      {!loading && !error && <div className="reading-corner-status" aria-label={trFormat("第 {0} 页，共 {1} 页，已读 {2}%", Math.min(currentPageIndex + 1, pages.length), pages.length, progress(book))}>{Math.min(currentPageIndex + 1, pages.length)} / {pages.length} <span>·</span> {progress(book)}%</div>}
      {narration.status !== "stopped" && <div className="voice-mini"><button onClick={() => narration.skip(-1)}>{"" + tr("上一句") + ""}</button><button onClick={narration.pause}>{narration.status === "paused" ? tr("继续") : tr("暂停")}</button><button onClick={() => narration.skip(1)}>{"" + tr("下一句") + ""}</button><button onClick={narration.stop}>{"" + tr("停止") + ""}</button></div>}
      {focus && (
        <button className="exit-focus" onClick={() => setFocus(false)}>
          {"" + tr("退出专注 · Esc") + " "}</button>
      )}
      {selection && (
        <div className="modal-shade">
          <div className="modal">
            <h2>
              <Quote />
              {"" + tr("收藏此刻") + " "}</h2>
            <blockquote>{selection.text.slice(0, 1000)}</blockquote>
            <textarea
              placeholder={tr("写下你的批注（可选）")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mark-options"><span>{"" + tr("正文标记") + ""}</span><select aria-label={tr("标记样式")} value={markStyle} onChange={e => setMarkStyle(e.target.value as "highlight" | "underline")}><option value="highlight">{"" + tr("高亮") + ""}</option><option value="underline">{"" + tr("下划线") + ""}</option></select><input aria-label={tr("标记颜色")} type="color" value={markColor} onChange={e => setMarkColor(e.target.value)}/></div>
            <div className="row">
              <button onClick={() => setSelection(null)}>{"" + tr("取消") + ""}</button>
              <button onClick={() => { setDictionaryQuery(selection.text); setSelection(null); window.getSelection()?.removeAllRanges(); setPanel("dictionary"); }}>{"" + tr("查词") + ""}</button>
              <button
                onClick={() => {
                  openTranslation(selection.text, selection.offset);
                  setSelection(null);
                  window.getSelection()?.removeAllRanges();
                }}
              >
                {"" + tr("翻译选中文字") + " "}</button>
              <button className="primary" onClick={saveQuote}>
                <Check size={16} />
                {"" + tr("保存摘录") + " "}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ReaderAppearance({
  prefs,
  setPrefs,
  palette,
}: {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
  palette: { paper: string; ink: string };
}) {
  useLocalReadestFonts();
  const applyColor = (
    key: "readerBackground" | "customPaper" | "customInk",
    color: string,
  ) =>
    void setPrefs(
      key === "readerBackground"
        ? { readerBackground: color }
        : {
            theme: "custom",
            customPaper: palette.paper,
            customInk: palette.ink,
            [key]: color,
          },
    );
  return (
    <div className="appearance-content">
      <section>
        <h3><Palette size={15} />{"" + tr("纸张背景") + ""}</h3>
        <div className="paper-background-options">
          {([
            { key: "plain", name: "纯色", image: "" },
            { key: "soft", name: "柔光纸", image: "/backgrounds/soft-paper.svg" },
            { key: "vintage", name: "古典羊皮", image: "/backgrounds/vintage-paper.svg" },
          ] as const).map(item => <button key={item.key} aria-label={trFormat("纸张背景：{0}", item.name)} aria-pressed={(prefs.paperBackground || "plain") === item.key} onClick={() => void setPrefs(item.key === "plain" ? { paperBackground: "plain" } : { paperBackground: item.key, readerBackground: "#e9dbbf", theme: "custom", customPaper: "#f6e6ca", customInk: "#3c3025" })}>
            <span className="paper-background-swatch" style={{ backgroundImage: item.image ? `url(${item.image})` : undefined, backgroundColor: item.image ? "#e8d6b7" : palette.paper, color: item.image ? "#3c3025" : palette.ink }}>{"" + tr("文") + ""}</span><span>{item.name}</span>
          </button>)}
        </div>
        <label className="paper-motion-setting"><span><b>{"" + tr("柔和动态光影") + ""}</b><small>{prefs.lowPower ? tr("低性能模式下自动暂停") : tr("缓慢变化，不影响文字阅读")}</small></span><input type="checkbox" aria-label={tr("柔和动态光影")} checked={prefs.paperBackgroundMotion !== false} onChange={e => void setPrefs({ paperBackgroundMotion: e.target.checked })}/></label>
        <p className="appearance-hint">{"" + tr("两种图片可离线使用；关闭动态后仍显示静态纸张。") + ""}</p>
      </section>
      <section>
        <h3>{"" + tr("翻页效果") + ""}</h3>
        <label className="paper-motion-setting"><span><b>{"" + tr("仿真翻页") + ""}</b><small>{prefs.lowPower ? tr("低性能模式下使用普通翻页") : prefs.mode === "scroll" ? tr("连续阅读使用普通滚动") : tr("拖动左右页边，或使用方向键翻页")}</small></span><input type="checkbox" aria-label={tr("仿真翻页")} checked={prefs.simulatedFlip !== false} onChange={e => void setPrefs({ simulatedFlip: e.target.checked })}/></label>
        <p className="appearance-hint">{"" + tr("拖动不到一半会回弹；关闭后使用普通分页。") + ""}</p>
      </section>
      <section>
        <h3>
          <Palette size={15} />
          {"" + tr("阅读配色") + " "}</h3>
        <div className="reading-palette-grid">
          {readingPalettes.map((p) => (
            <button
              key={p.name}
              aria-label={trFormat("配色：{0}", p.name)}
              aria-pressed={
                (!prefs.paperBackground || prefs.paperBackground === "plain") && prefs.readerBackground === p.background &&
                palette.paper === p.paper
              }
              onClick={() =>
                void setPrefs({
                  paperBackground: "plain",
                  readerBackground: p.background,
                  theme: "custom",
                  customPaper: p.paper,
                  customInk: p.ink,
                })
              }
            >
              <i style={{ background: p.background, color: p.ink }}>
                <span style={{ background: p.paper }}>Aa</span>
              </i>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="reader-color-fields">
          {(
            [
              {
                key: "readerBackground",
                name: "界面背景",
                value: prefs.readerBackground,
              },
              { key: "customPaper", name: "正文底色", value: palette.paper },
              { key: "customInk", name: "文字颜色", value: palette.ink },
            ] as const
          ).map((c) => (
            <label key={c.key}>
              <span>{tr(c.name)}</span>
              <code>{c.value.toUpperCase()}</code>
              <input
                type="color"
                aria-label={tr(c.name)}
                value={c.value}
                onChange={(e) => applyColor(c.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
      <section>
        <h3>{"" + tr("舒适排版") + ""}</h3>
        <label className="reader-range"><span>{tr("阅读亮度")}<b>{prefs.readerBrightness ?? 100}%</b></span>
          <input aria-label={tr("阅读亮度")} type="range" min="30" max="100" step="1" value={prefs.readerBrightness ?? 100} onChange={e => void setPrefs({ readerBrightness: Number(e.target.value) })} />
        </label>
        <label className="reader-field">
          {"" + tr("阅读字体") + " "}<select
            value={prefs.font}
            onChange={(e) => void setPrefs({ font: e.target.value })}
          >
            <FontOptions />
          </select>
        </label>
        {[
          { key: "size", label: "字号", min: 16, max: 32, step: 1, unit: "px" },
          {
            key: "spacing",
            label: "字间距",
            min: -0.5,
            max: 2,
            step: 0.25,
            unit: "px",
          },
          {
            key: "lineHeight",
            label: "行距",
            min: 1.4,
            max: 2.2,
            step: 0.05,
            unit: "",
          },
          {
            key: "bookSize",
            label: "正文宽度占比",
            min: 50,
            max: 100,
            step: 5,
            unit: "%",
          },
          { key: "textHeightPercent", label: "正文高度占比", min: 50, max: 100, step: 5, unit: "%" },
        ].map((s) => (
          <label className="reader-range" key={s.key}>
            <span>
              {tr(s.label)}
              <b>
                {s.key === "bookSize" ? Math.max(50, Math.min(100, prefs.bookSize)) : prefs[s.key as keyof Prefs] as number}
                {s.unit}
              </b>
            </span>
            <input
              aria-label={tr(s.label)}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={s.key === "bookSize" ? Math.max(50, Math.min(100, prefs.bookSize)) : prefs[s.key as keyof Prefs] as number}
              onChange={(e) =>
                void setPrefs({ [s.key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <button
          className="reader-reset"
          onClick={() =>
            void setPrefs({
              size: defaults.size,
              spacing: 0,
              lineHeight: defaults.lineHeight,
              paragraph: defaults.paragraph,
              bookSize: 100,
              textHeightPercent: 100,
            })
          }
        >
          <RotateCcw size={14} />
          {"" + tr("恢复舒适排版") + " "}</button>
      </section>
      <section>
        <label className="reader-field">
          {"" + tr("简繁转换") + " "}<select
            aria-label={tr("简繁转换")}
            value={prefs.conversion}
            onChange={(e) =>
              void setPrefs({
                conversion: e.target.value as Prefs["conversion"],
              })
            }
          >
            <option value="original">{"" + tr("保持原文") + ""}</option>
            <option value="cn">{"" + tr("简体中文") + ""}</option>
            <option value="t">{"" + tr("通用繁体") + ""}</option>
            <option value="tw">{"" + tr("台湾繁体") + ""}</option>
            <option value="hk">{"" + tr("香港繁体") + ""}</option>
          </select>
        </label>
      </section>
      <p className="appearance-hint">
        {"" + tr("修改即时保存，下次打开仍是你喜欢的样子。") + " "}</p>
    </div>
  );
}
