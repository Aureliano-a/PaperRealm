import { version as appVersion } from "../package.json";
import { trFormat } from "./i18n";
import { tr } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  Library,
  Armchair,
  Type,
  Palette,
  Hourglass,
  Settings,
  Plus,
  Search,
  Grid2X2,
  List,
  Heart,
  MoreHorizontal,
  ArrowUpRight,
  ChevronRight,
  Sun,
  Moon,
  Leaf,
  CloudRain,
  Upload,
  Download,
  Check,
  X,
  Minus,
  Square,
  Bookmark,
  Trash2,
  PenLine,
  Volume2,
  VolumeX,
  FolderOpen,
  Sparkles,
  LayoutGrid,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore, flushWrites, exportExtraRecords } from "./store";
import { fonts, themes, type Book, type Prefs } from "./types";
import { progress } from "./engine";
import { get, put } from "./db";
import { saveFile, exportArt, exportShowcase } from "./export";
import { convert } from "./conversion";
import Reader from "./Reader";
import { useLocalReadestFonts } from "./local-readest-fonts";
import { setLanguage, uiLanguages } from "./i18n";
import { FontOptions } from "./FontOptions";
import { loadPdfCover } from "./pdfCover";
import DocumentReader from "./DocumentReader";
import PdfReader from "./PdfReader";
const sections = [
  ["library", "私人藏书室", Library],
  ["desk", "我的阅读书桌", Armchair],
  ["fonts", "字体实验室", Type],
  ["studio", "书籍工坊", Palette],
  ["memory", "阅读记忆馆", Hourglass],
  ["settings", "设置中心", Settings],
] as const;
const scenes = [
  { id: "afternoon", name: "午后书房", desc: "窗影轻移，木色温柔", icon: Sun },
  { id: "rain", name: "夜雨窗前", desc: "听雨落下，故事继续", icon: CloudRain },
  { id: "ink", name: "极简墨夜", desc: "让世界安静下来", icon: Moon },
  {
    id: "classic",
    name: "古典藏书室",
    desc: "旧书与时间的气息",
    icon: Library,
  },
];
const sample = Array.from(
  { length: 16 },
  (_, i) =>
    `第${i + 1}章 ${["窗边的书", "午后的光", "雨中的小城", "纸上的远方"][i % 4]}\n\n` +
    Array.from(
      { length: 12 },
      (_, j) =>
        `林知把书放在窗边。${i % 2 ? "雨水沿着玻璃慢慢落下，远处的街灯照亮了青石路。" : "午后的阳光越过树梢，在桌上留下柔软的影子。"}她喜欢翻动纸页的声音，也喜欢文字之间安静的空隙。这一天，她和陈远约好到南城书馆见面，寻找一封藏在旧书里的信。\n\n书里写着：“不必急着抵达远方，读过的每一行，都已经成为走过的路。”她停下来，记住了这句话。第 ${j + 1} 次读到这里，她仍然想象着故事之外的生活。\n`,
    ).join(""),
).join("\n");
export function Cover({
  book,
  large = false,
  onClick,
}: {
  book: Book;
  large?: boolean;
  onClick?: () => void;
}) {
  const s = book.style;
  useEffect(() => {
    if (book.format !== 'pdf' || book.coverImage || book.pdfCover) return;
    let active = true;
    void loadPdfCover(book.id, book.title).then(cover => {
      const store = useStore.getState();
      const current = store.books.find(item => item.id === book.id);
      if (active && current && !current.coverImage && !current.pdfCover)
        void store.patch(book.id, item => item.coverImage || item.pdfCover ? {} : cover);
    }).catch(()=>{});
    return () => { active = false; };
  }, [book.id, book.format, book.title, book.coverImage, book.pdfCover]);
  return (
    <div
      onClick={onClick}
      className={
        "book-cover " +
        s.pattern +
        " " +
        s.material +
        (s.vertical ? " vertical" : "") +
        (large ? " large" : "")
      }
      style={
        {
          "--cover": s.color,
          "--foil": s.gold ? "#e1c68e" : "#dedbd1",
          "--thickness": s.thickness + "px",
        } as React.CSSProperties
      }
    >
      {book.coverImage ? <img className="book-pdf-cover" src={book.coverImage} alt="" /> : <>
      <div className="cover-border" />
      <div className="cover-ornament" />
      <span className="cover-edition">{"" + tr("纸 境 藏 书") + ""}</span>
      <h3>{book.title}</h3>
      <p>{book.author}</p>
      <div className="cover-seal">{"" + tr("境") + ""}</div>
      <span className="cover-imprint">PAPERREALM</span>
      </>}
      <div className="book-pages" />
    </div>
  );
}
export default function App() {
  useEffect(() => {
    if (!isTauri()) return;
    let closing=false;
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();if(closing)return;closing=true;
      try {
        await flushWrites();
        await getCurrentWindow().destroy();
      } catch (error) {
        closing=false;
        useStore.setState({
          error: "数据写入失败，窗口暂未关闭。请先导出备份：" + String(error),
        });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  const {
    books,
    prefs,
    ready,
    error,
    busy,
    init,
    clearError,
    patch,
    remove,
    importFiles,
    setPrefs,
    restoreBackup,
  } = useStore();
  setLanguage(prefs.uiLanguage);
  useEffect(() => {
    document.documentElement.lang = ["zh-CN", "en", "ja", "es", "ru"].includes(prefs.uiLanguage) ? prefs.uiLanguage : "zh-CN";
    document.documentElement.dir = "ltr";
  }, [prefs.uiLanguage]);
  const [section, setSection] = useState("library"),
    [reading, setReading] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("全部藏书"),
    [query, setQuery] = useState(""),
    [view, setView] = useState("shelf"),
    [sort, setSort] = useState("recent"),
    [encoding, setEncoding] = useState("auto"),
    [edit, setEdit] = useState<Book | null>(null),
    [deleting, setDeleting] = useState<Book | null>(null),
    [toast, setToast] = useState(""),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    backup = useRef<HTMLInputElement>(null);
  const active =
    books.find((b) => b.id === selected) ||
    books.find((b) => b.id === prefs.deskBook) ||
    books[0];
  useEffect(() => {
    void init();
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    (async () => {
      const raw = await get<string>("custom-font");
      if (raw) {
        const f = new FontFace("UserFont", `url(${raw})`);
        await f.load();
        document.fonts.add(f);
      }
    })().catch(() => {});
  }, []);
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      setToast("操作失败：" + String(e));
    }
  }
  function read(b: Book) {
    setSelected(b.id);
    void patch(b.id, { lastRead: Date.now() });
    setReading(b.id);
  }
  const current = books.find((b) => b.id === reading);
  const matches = books.filter(
    (b) =>
      (!query ||
        [b.title, b.author, b.tags, b.text].some((v) => v.includes(query))) &&
      (filter === "全部藏书" ||
        (filter === "我的收藏" && b.favorite) ||
        (filter === "正在阅读" && !!b.firstOpened && !b.done) ||
        (filter === "已读完成" && b.done) ||
        (filter === "未开始" && !b.firstOpened)),
  );
  matches.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title, "zh-CN")
      : sort === "progress"
        ? progress(b) - progress(a)
        : (b.lastRead || b.created) - (a.lastRead || a.created),
  );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void importFiles(Array.from(e.dataTransfer.files), encoding);
      }}
    >
      {!current && <header className="titlebar">
        <div data-tauri-drag-region className="title-drag">
          <BookOpen size={15} />
          <span>
            PaperRealm <i>{"" + tr("纸境") + ""}</i>
          </span>
          <span className="title-tag">{"" + tr("让阅读，回到书本。") + ""}</span>
        </div>
        {isTauri() && (
          <div className="window-buttons">
            <button
              title={tr("最小化")}
              onClick={() => void getCurrentWindow().minimize()}
            >
              <Minus size={14} />
            </button>
            <button
              title={tr("最大化")}
              onClick={() => void getCurrentWindow().toggleMaximize()}
            >
              <Square size={12} />
            </button>
            <button
              title={tr("关闭")}
              onClick={() => void getCurrentWindow().close()}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>}
      <input
        ref={input}
        data-testid="import-input"
        hidden
        type="file"
        accept=".txt,.epub,.pdf"
        multiple
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []), encoding);
          e.target.value = "";
        }}
      />
      {current && current.format && current.format !== "txt" ? (
        current.format === 'pdf' ? <PdfReader book={current} onBack={() => setReading(null)} /> : <DocumentReader book={current} onBack={() => setReading(null)} />
      ) : current ? (
        <Reader
          key={current.id}
          book={current}
          onBack={() => setReading(null)}
        />
      ) : (
        <div className="app-body">
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-icon">
                <BookOpen size={25} />
              </div>
              <div>
                {"" + tr("纸境") + ""}<span>PAPERREALM</span>
              </div>
            </div>
            <p className="sidebar-label">{"" + tr("你的私人阅读空间") + ""}</p>
            <nav>
              {sections.map(([id, title, Icon]) => (
                <button
                  key={id}
                  className={section === id ? "active" : ""}
                  onClick={() => setSection(id)}
                >
                  <Icon size={19} />
                  {tr(title)}
                  {id === "library" && (
                    <span className="nav-count">{books.length}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="daily-quote">
                {"" + tr("“ 一卷在手，") + " "}<br />
                　{"" + tr("便是心安处。 ”") + " "}</div>
              <span className="offline">
                <i /> {" " + tr("完全离线 · 属于你的书房") + " "}</span>
              <div className="profile">
                <div>{"" + tr("境") + ""}</div>
                <span>
                  {"" + tr("纸境读者") + ""}<small>{"" + tr("在字里行间，与自己相遇") + ""}</small>
                </span>
              </div>
            </div>
          </aside>
          <main className={"main " + (section === "desk" ? "desk-main" : "")}>
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {section === "library" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR PRIVATE LIBRARY</span>
                      <h1>
                        {"" + tr("私人藏书室") + ""}<span>Library</span>
                      </h1>
                      <p>{"" + tr("把喜欢的故事，安放在这里。") + ""}</p>
                    </div>
                    <div className="row">
                      <select
                        aria-label={tr("导入编码")}
                        value={encoding}
                        onChange={(e) => setEncoding(e.target.value)}
                      >
                        <option value="auto">{"" + tr("自动识别编码") + ""}</option>
                        {[
                          "utf-8",
                          "gbk",
                          "gb18030",
                          "utf-16le",
                          "utf-16be",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <button
                        className="primary"
                        onClick={() => input.current?.click()}
                      >
                        <Plus size={17} /> {" " + tr("导入书籍") + " "}</button>
                    </div>
                  </div>
                  <section className="library-hero">
                    <div className="hero-copy">
                      <span className="eyebrow">
                        <span className="gold-dot" /> {" " + tr("给自己，一段安静的时光") + " "}</span>
                      <h2>
                        {active
                          ? tr("故事在这里，等你继续。")
                          : tr("从一本书，走进另一个世界。")}
                      </h2>
                      <p>
                        {active
                          ? `${active.title} · ${active.author}`
                          : tr("每一个 TXT，都值得被认真收藏。")}
                        <br />
                        {active
                          ? trFormat("已读 {0}% · 相伴 {1} 分钟", progress(active), Math.floor(active.seconds / 60))
                          : tr("导入你的第一本书，让文字拥有纸张的温度。")}
                      </p>
                      <button
                        className="hero-button"
                        onClick={() =>
                          active ? read(active) : input.current?.click()
                        }
                      >
                        {active ? tr("继续阅读") : tr("开启我的藏书室")}
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="hero-art">
                      {active ? (
                        <Cover book={active} />
                      ) : (
                        <div className="abstract-book">
                          <span>{"" + tr("纸境") + ""}</span>
                          <small>{"" + tr("一页一世界") + ""}</small>
                        </div>
                      )}
                      <div className="hero-orbit" />
                      <div className="plant">
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <div className="hero-caption">
                        A QUIET PLACE FOR YOUR STORIES
                      </div>
                    </div>
                  </section>
                  <div className="library-toolbar">
                    <div className="tabs">
                      {[
                        "全部藏书",
                        "正在阅读",
                        "未开始",
                        "已读完成",
                        "我的收藏",
                      ].map((f) => (
                        <button
                          className={filter === f ? "selected" : ""}
                          key={f}
                          onClick={() => setFilter(f)}
                        >
                          {tr(f)}
                          {f === "全部藏书" && <span>{books.length}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="view-switch">
                      {[
                        ["shelf", Library],
                        ["grid", Grid2X2],
                        ["list", List],
                      ].map(([id, Icon]) => {
                        const I = Icon as typeof Library;
                        return (
                          <button
                            key={String(id)}
                            title={
                              id === "shelf"
                                ? "书架视图"
                                : id === "grid"
                                  ? "网格视图"
                                  : "列表视图"
                            }
                            className={view === id ? "active" : ""}
                            onClick={() => setView(String(id))}
                          >
                            <I size={17} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="collection-tools">
                    <span>
                      {"" + tr("共") + " "}{matches.length} {" " + tr("本藏书") + ""}{" "}
                      <span className="muted">{"" + tr("/ 让每一次翻页都有意义") + ""}</span>
                    </span>
                    <div className="row">
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          placeholder={tr("搜索书名、标签或全文")}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label={tr("排序")}
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="recent">{"" + tr("最近阅读") + ""}</option>
                        <option value="title">{"" + tr("书名排序") + ""}</option>
                        <option value="progress">{"" + tr("阅读进度") + ""}</option>
                      </select>
                    </div>
                  </div>
                  {!matches.length ? (
                    <div className="empty">
                      <Library size={40} />
                      <h2>
                        {books.length
                          ? tr("没有找到符合条件的书")
                          : tr("书架已备好，静候你的第一本书")}
                      </h2>
                      <p>
                        {"" + tr("拖入 TXT 文件，或点击右上角导入。支持 UTF-8 / GBK / GB18030 / UTF-16。") + " "}</p>
                      {!books.length && (
                        <button
                          onClick={() =>
                            void importFiles(
                              [
                                new File(
                                  [sample],
                                  "窗边的书 · 纸境原创体验读本.txt",
                                  { type: "text/plain" },
                                ),
                              ],
                              "utf-8",
                            )
                          }
                        >
                          {"" + tr("添加原创体验读本") + " "}</button>
                      )}
                    </div>
                  ) : (
                    <div className={"collection " + view}>
                      {matches.map((b) => (
                        <article
                          className="book-card"
                          key={b.id}
                          onDoubleClick={() => read(b)}
                        >
                          <div className="book-display">
                            <Cover
                              book={b}
                              onClick={() => {
                                setSelected(b.id);
                                read(b);
                              }}
                            />
                            <button
                              className={
                                "favorite " + (b.favorite ? "is-favorite" : "")
                              }
                              title={tr("收藏")}
                              onClick={() =>
                                void patch(b.id, { favorite: !b.favorite })
                              }
                            >
                              <Heart
                                size={16}
                                fill={b.favorite ? "currentColor" : "none"}
                              />
                            </button>
                          </div>
                          <div className="book-info">
                            <div className="book-title">
                              <h3 onClick={() => read(b)}>{b.title}</h3>
                              <button
                                title={tr("编辑书籍")}
                                onClick={() => setEdit({ ...b })}
                              >
                                <MoreHorizontal size={18} />
                              </button>
                            </div>
                            <p>
                              {b.author} <span>· {b.category}</span>
                            </p>
                            <div className="book-progress">
                              <div>
                                <i style={{ width: progress(b) + "%" }} />
                              </div>
                              <span>
                                {b.done
                                  ? tr("已读完")
                                  : b.firstOpened
                                    ? progress(b) + "%"
                                    : tr("未开始")}
                              </span>
                            </div>
                            <div className="book-actions">
                              <button
                                onClick={() => {
                                  setSelected(b.id);
                                  void setPrefs({ deskBook: b.id });
                                  setSection("desk");
                                }}
                              >
                                {"" + tr("放到书桌") + " "}</button>
                              <button
                                onClick={() => {
                                  setSelected(b.id);
                                  setSection("studio");
                                }}
                              >
                                {"" + tr("装帧") + " "}</button>
                              <button
                                title={tr("删除书籍")}
                                onClick={() => setDeleting(b)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div className="library-foot">
                    <span>{"" + tr("✧ 文字有归处，心也有归处。") + ""}</span>
                    <button onClick={() => input.current?.click()}>
                      <Upload size={14} /> {" " + tr("拖拽 TXT 到窗口，添加新的故事") + " "}</button>
                  </div>
                </>
              )}
              {section === "desk" && (
                <Desk
                  book={active}
                  select={
                    <BookSelect
                      books={books}
                      active={active}
                      onChange={(id) => {
                        setSelected(id);
                        void setPrefs({ deskBook: id });
                      }}
                    />
                  }
                  read={() => active && read(active)}
                  onLibrary={() => setSection("library")}
                />
              )}
              {section === "fonts" && <FontLab run={run} toast={setToast} />}
              {section === "studio" && (
                <>
                  <Heading
                    eyebrow="THE ART OF BOOKBINDING"
                    title={tr("书籍工坊")}
                    desc={tr("让每一本书，都拥有自己的性格。")}
                  />
                  {active ? (
                    <Studio
                      book={active}
                      select={
                        <BookSelect
                          books={books}
                          active={active}
                          onChange={setSelected}
                        />
                      }
                      run={run}
                    />
                  ) : (
                    <EmptyBooks onClick={() => setSection("library")} />
                  )}
                </>
              )}
              {section === "memory" && (
                <>
                  <Heading
                    eyebrow="THE STORIES WE KEEP"
                    title={tr("阅读记忆馆")}
                    desc={tr("读过的时光，终会留下回响。")}
                  />
                  <Memory
                    books={books}
                    book={active}
                    select={
                      <BookSelect
                        books={books}
                        active={active}
                        onChange={setSelected}
                      />
                    }
                    read={read}
                    run={run}
                  />
                </>
              )}
              {section === "settings" && (
                <>
                  <Heading
                    eyebrow="MAKE YOURSELF AT HOME"
                    title={tr("设置中心")}
                    desc={tr("把纸境，调成你喜欢的样子。")}
                  />
                  <div className="settings-grid">
                    <section className="panel">
                      <h2>{"" + tr("界面语言") + ""}</h2>
                      <label className="field">{"" + tr("选择语言") + " "}<select value={prefs.uiLanguage} onChange={e => void setPrefs({ uiLanguage: e.target.value })}>
                          {uiLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                        </select>
                      </label>
                    </section>
                    <section className="panel">
                      <h2>{"" + tr("阅读与性能") + ""}</h2>
                      <Toggle
                        title={tr("阅读轻动效")}
                        detail={tr("单栏分页使用轻柔过渡，关闭后即时切换")}
                        value={prefs.animation}
                        change={(v) => void setPrefs({ animation: v })}
                      />
                      <Toggle
                        title={tr("翻页声音")}
                        detail={tr("本地合成轻柔纸声")}
                        value={prefs.sound}
                        change={(v) => void setPrefs({ sound: v })}
                      />
                      <Toggle
                        title={tr("低性能模式")}
                        detail={tr("关闭环境动画，保留基础阅读")}
                        value={prefs.lowPower}
                        change={(v) => void setPrefs({ lowPower: v })}
                      />
                      <label className="field">
                        {"" + tr("环境背景") + " "}<select
                          value={prefs.ambience}
                          onChange={(e) =>
                            void setPrefs({
                              ambience: e.target.value as Prefs["ambience"],
                            })
                          }
                        >
                          <option value="dynamic">{"" + tr("动态背景") + ""}</option>
                          <option value="static">{"" + tr("静态背景") + ""}</option>
                          <option value="off">{"" + tr("完全关闭") + ""}</option>
                        </select>
                      </label>
                      <Slider
                        title={tr("阅读宽度")}
                        value={prefs.bookSize}
                        min={70}
                        max={130}
                        suffix="%"
                        change={(v) => void setPrefs({ bookSize: v })}
                      />
                    </section>
                    <section className="panel">
                      <h2>{"" + tr("数据与备份") + ""}</h2>
                      <p>
                        {"" + tr("书籍导入后保存为本地副本，原文件始终保持不变。阅读进度、书签、摘录和主题随本地数据库保存。") + " "}</p>
                      <div className="stack">
                        <button
                          onClick={() =>
                            void run(async () =>
                              saveFile(
                                "纸境阅读备份.json",
                                JSON.stringify(
                                  { version: 2, books, prefs, extras: await exportExtraRecords(books) },
                                  null,
                                  2,
                                ),
                              ),
                            )
                          }
                        >
                          <Download size={16} /> {" " + tr("导出完整阅读数据") + " "}</button>
                        <button onClick={() => backup.current?.click()}>
                          <Upload size={16} /> {" " + tr("恢复备份（合并新书）") + " "}</button>
                        <input
                          ref={backup}
                          type="file"
                          hidden
                          accept=".json"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f)
                              void run(async () => {
                                await restoreBackup(JSON.parse(await f.text()));
                                setToast("已恢复备份，同 ID 书籍保留现有数据");
                              });
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <p className="hint">
                        {"" + tr("桌面存储：AppData / com.paperrealm.reader / paperrealm.sqlite3。浏览器预览使用独立 IndexedDB。") + " "}</p>
                    </section>
                    <section className="panel">
                      <h2>{"" + tr("简繁转换与导出") + ""}</h2>
                      <BookSelect
                        books={books}
                        active={active}
                        onChange={setSelected}
                      />
                      <p>{"" + tr("OpenCC 本地词典转换。书签和章节始终绑定原文偏移。") + ""}</p>
                      <select
                        value={prefs.conversion}
                        onChange={(e) =>
                          void setPrefs({
                            conversion: e.target.value as Prefs["conversion"],
                          })
                        }
                      >
                        <option value="original">{"" + tr("原文") + ""}</option>
                        <option value="cn">{"" + tr("简体中文") + ""}</option>
                        <option value="t">{"" + tr("通用繁体") + ""}</option>
                        <option value="tw">{"" + tr("台湾繁体") + ""}</option>
                        <option value="hk">{"" + tr("香港繁体") + ""}</option>
                      </select>
                      <button
                        disabled={!active}
                        onClick={() =>
                          active &&
                          void run(() =>
                            saveFile(
                              active.title + "-" + prefs.conversion + ".txt",
                              convert(active.text, prefs.conversion),
                            ),
                          )
                        }
                      >
                        <Download size={16} /> {" " + tr("另存转换后的 TXT") + " "}</button>
                    </section>
                    <section className="panel">
                      <h2>{"" + tr("关于纸境") + ""}</h2>
                      <div className="about-logo">
                        <BookOpen />
                        <b>{"" + tr("PaperRealm 纸境") + ""}</b>
                        <span>{appVersion}</span>
                      </div>
                      <p>{"" + tr("离线阅读 · 本地收藏 · 温柔地对待文字") + ""}</p>
                      <p className="hint">
                        {"" + tr("清楷为霞鹜文楷的字宽、字距适配版本，保留上游字形风格，不宣称原创字库。雅宋、静黑、柔光、夜读为字体与排版预设。") + " "}</p>
                      <details>
                        <summary>{"" + tr("字体与第三方许可") + ""}</summary>
                        <p>
                          {"" + tr("清楷 / 霞鹜文楷 / Klee：SIL OFL 1.1。React、Vite、Three.js、Zustand、Motion：MIT。OpenCC-JS：MIT，词典源自 OpenCC（Apache-2.0）。完整许可见交付源码 licenses 目录。") + " "}</p>
                      </details>
                    </section>
                  </div>
                </>
              )}
            </motion.div>
          </main>
        </div>
      )}
      {edit && (
        <div className="modal-shade">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (
                  edit.encoding !==
                  books.find((b) => b.id === edit.id)?.encoding
                )
                  await useStore.getState().reinterpret(edit.id, edit.encoding);
                const saved = await patch(edit.id, {
                  title: edit.title,
                  author: edit.author,
                  category: edit.category,
                  tags: edit.tags,
                });
                if (saved) setEdit(null);
              });
            }}
          >
            <h2>{"" + tr("整理藏书") + ""}</h2>
            {[
              ["title", "书名"],
              ["author", "作者"],
              ["category", "分类"],
              ["tags", "标签（用逗号分隔）"],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                {tr(label)}
                <input
                  required={key === "title"}
                  value={String(edit[key as keyof Book])}
                  onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="field">
              {"" + tr("重新解码原始副本") + " "}<select
                value={edit.encoding}
                onChange={(e) => setEdit({ ...edit, encoding: e.target.value })}
              >
                {["utf-8", "gbk", "gb18030", "utf-16le", "utf-16be"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </label>
            <p className="hint">
              {edit.fileName} · {edit.encoding} ·{" "}
              {edit.text.length.toLocaleString()} {" " + tr("字符") + " "}<br />
              {"" + tr("已保存完整副本，原文件丢失不影响阅读。") + " "}</p>
            <div className="row">
              <button type="button" onClick={() => setEdit(null)}>
                {"" + tr("取消") + " "}</button>
              <button className="primary">{"" + tr("保存修改") + ""}</button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div className="modal-shade">
          <div className="modal">
            <h2>{"" + tr("从书库移除《") + ""}{deleting.title}》？</h2>
            <p>
              {"" + tr("这将删除本应用中的阅读进度和记录，原始 TXT 文件不会被修改。建议先在设置中导出备份。") + " "}</p>
            <div className="row">
              <button onClick={() => setDeleting(null)}>{"" + tr("取消") + ""}</button>
              <button
                className="danger"
                onClick={() => {
                  void remove(deleting.id);
                  setDeleting(null);
                }}
              >
                {"" + tr("删除书库记录") + " "}</button>
            </div>
          </div>
        </div>
      )}
      {(error || busy || toast) && (
        <div className={"toast " + (error ? "error" : "")} role="status">
          <span>{error || busy || toast}</span>
          {error && (
            <button onClick={clearError}>
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {drag && (
        <div className="drop-overlay">
          <Upload size={48} />
          <h2>{"" + tr("把新的故事，放进纸境") + ""}</h2>
          <p>{"" + tr("松开鼠标，导入 TXT 文件") + ""}</p>
        </div>
      )}
      {!ready && <div className="loading-overlay">{"" + tr("正在打开你的书房…") + ""}</div>}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{tr(title)}</h1>
        <p>{tr(desc)}</p>
      </div>
    </div>
  );
}
function BookSelect({
  books,
  active,
  onChange,
}: {
  books: Book[];
  active?: Book;
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label={tr("选择书籍")}
      value={active?.id || ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {!books.length && <option>{"" + tr("请先导入书籍") + ""}</option>}
      {books.map((b) => (
        <option key={b.id} value={b.id}>
          {b.title}
        </option>
      ))}
    </select>
  );
}
function EmptyBooks({ onClick }: { onClick: () => void }) {
  return (
    <div className="empty">
      <BookOpen size={38} />
      <h2>{"" + tr("这里需要一本属于你的书") + ""}</h2>
      <button onClick={onClick}>{"" + tr("前往藏书室") + ""}</button>
    </div>
  );
}
function Slider({
  title,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  change,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  change: (v: number) => void;
}) {
  return (
    <label className="slider-field">
      <span>
        {tr(title)}
        <b>
          {value}
          {suffix}
        </b>
      </span>
      <input
        aria-label={tr(title)}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
}
function Toggle({
  title,
  detail,
  value,
  change,
}: {
  title: string;
  detail?: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <span>
        {tr(title)}
        <small>{detail ? tr(detail) : null}</small>
      </span>
      <button
        role="switch"
        aria-label={tr(title)}
        aria-checked={value}
        className={"toggle " + (value ? "on" : "")}
        onClick={() => change(!value)}
      >
        <i />
      </button>
    </div>
  );
}
function Desk({
  book,
  select,
  read,
  onLibrary,
}: {
  book?: Book;
  select: React.ReactNode;
  read: () => void;
  onLibrary: () => void;
}) {
  const { prefs, setPrefs, patch } = useStore();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!prefs.ambientSound) return;
    const a = new AudioContext();
    const buffer = a.createBuffer(1, a.sampleRate * 4, a.sampleRate),
      d = buffer.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      v = (v + Math.random() * 0.02 - 0.01) * 0.97;
      d[i] = v * 0.2;
    }
    const source = a.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(a.destination);
    source.start();
    return () => {
      source.stop();
      void a.close();
    };
  }, [prefs.ambientSound]);
  return (
    <div
      className={
        "desk scene-" +
        prefs.scene +
        " ambience-" +
        prefs.ambience +
        (prefs.lowPower ? " low-power" : "")
      }
    >
      <div className="desk-head">
        <div>
          <span className="eyebrow">YOUR READING RETREAT</span>
          <h1>{"" + tr("我的阅读书桌") + ""}</h1>
          <p>{"" + tr("把世界调小，把故事翻开。") + ""}</p>
        </div>
        {select}
      </div>
      <div className="desk-stage">
        <div className="window-light" />
        <div className="desk-window" />
        <div className="rain-lines" />
        <div className="desk-lamp">
          <i />
        </div>
        <div className="desk-table" />
        <div className="tea-cup" />
        <div className="desk-book-area">
          {book ? (
            <>
              <div
                className={opened ? "desk-open-book" : "desk-closed-book"}
                onClick={read}
              >
                {opened ? (
                  <>
                    <div>
                      <span>{book.title}</span>
                      <p>{book.text.slice(book.offset, book.offset + 140)}</p>
                    </div>
                    <div>
                      <p>
                        {book.text.slice(book.offset + 140, book.offset + 300)}
                      </p>
                    </div>
                  </>
                ) : (
                  <Cover book={book} large />
                )}
              </div>
              <button
                className="desk-open-toggle"
                onClick={() => setOpened(!opened)}
              >
                {opened ? tr("合上书本") : tr("打开书本")}
              </button>
            </>
          ) : (
            <button onClick={onLibrary}>
              <Plus /> {" " + tr("选择一本书，放到桌上") + " "}</button>
          )}
        </div>
        <div className="desk-caption">
          {book ? book.title : tr("你的故事，从这里开始")}
          <span>{book ? tr("点击书本，进入阅读") : tr("安静，留给文字。")}</span>
        </div>
      </div>
      <div className="desk-dock">
        <div>
          <BookOpen />
          <span>
            {"" + tr("当前阅读") + ""}<b>{book ? progress(book) + "%" : tr("尚未选书")}</b>
          </span>
        </div>
        <div>
          <Hourglass />
          <span>
            {"" + tr("相伴时光") + ""}<b>{Math.floor((book?.seconds || 0) / 60)} {" " + tr("分钟") + ""}</b>
          </span>
        </div>
        <label>
          {"" + tr("章节快捷入口") + " "}<select
            disabled={!book}
            value={
              book?.chapters.reduce(
                (a, c) => (c.offset <= (book?.offset || 0) ? c.offset : a),
                0,
              ) || 0
            }
            onChange={(e) => {
              if (book) {
                void patch(book.id, {
                  offset: Number(e.target.value),
                  context: book.text.slice(
                    Number(e.target.value),
                    Number(e.target.value) + 48,
                  ),
                });
                read();
              }
            }}
          >
            {book?.chapters.map((c) => (
              <option key={c.offset} value={c.offset}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {"" + tr("书签") + " "}<select
            defaultValue=""
            disabled={!book?.marks.length}
            onChange={(e) => {
              if (book && e.target.value) {
                const off = Number(e.target.value);
                void patch(book.id, {
                  offset: off,
                  context: book.text.slice(off, off + 48),
                });
                read();
              }
            }}
          >
            <option value="">
              {book?.marks.length ? tr("选择书签或摘录") : tr("还没有书签")}
            </option>
            {book?.marks.map((m) => (
              <option key={m.id} value={m.offset}>
                {m.context.slice(0, 24)}
              </option>
            ))}
          </select>
        </label>
        <button
          title={tr("环境音")}
          onClick={() => void setPrefs({ ambientSound: !prefs.ambientSound })}
        >
          {prefs.ambientSound ? <Volume2 /> : <VolumeX />}
        </button>
        <button onClick={onLibrary}>
          <Library size={18} />
        </button>
      </div>
      <div className="scene-options">
        {scenes.map((s) => (
          <button
            key={s.id}
            className={prefs.scene === s.id ? "selected" : ""}
            onClick={() => void setPrefs({ scene: s.id })}
          >
            <s.icon size={21} />
            <span>
              {tr(s.name)}
              <small>{tr(s.desc)}</small>
            </span>
            {prefs.scene === s.id && <Check size={16} />}
          </button>
        ))}
      </div>
      <div className="desk-controls">
        <Toggle
          title={tr("氛围动态")}
          value={prefs.ambience === "dynamic" && !prefs.lowPower}
          change={(v) => void setPrefs({ ambience: v ? "dynamic" : "static" })}
        />
        <span>{"" + tr("场景与纸张主题独立保存") + ""}</span>
      </div>
    </div>
  );
}
function FontLab({
  run,
  toast,
}: {
  run: (fn: () => Promise<unknown>) => Promise<void>;
  toast: (s: string) => void;
}) {
  useLocalReadestFonts();
  const { prefs, setPrefs } = useStore();
  const [name, setName] = useState("我的阅读配方");
  const custom = useRef<HTMLInputElement>(null);
  const p =
    prefs.theme === "custom"
      ? { paper: prefs.customPaper, ink: prefs.customInk }
      : themes[prefs.theme];
  return (
    <>
      <Heading
        eyebrow="FIND YOUR READING RHYTHM"
        title={tr("字体实验室")}
        desc={tr("在字形、留白与纸色之间，找到舒适的阅读节奏。")}
      />
      <div className="font-layout">
        <section className="panel font-controls">
          <h2>{"" + tr("字里行间") + ""}</h2>
          <label className="field">
            {"" + tr("阅读字体") + " "}<select
              value={prefs.font}
              onChange={(e) => void setPrefs({ font: e.target.value })}
            >
              <FontOptions />
            </select>
          </label>
          <button onClick={() => custom.current?.click()}>
            <Upload size={15} /> {" " + tr("导入本地字体") + " "}</button>
          <input
            hidden
            ref={custom}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void run(async () => {
                  if (file.size > 35 * 1024 * 1024)
                    throw Error("字体上限 35 MB");
                  const data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                  });
                  const f = new FontFace("UserFont", `url(${data})`);
                  await f.load();
                  document.fonts.add(f);
                  await put("custom-font", data);
                  await setPrefs({
                    font: "custom",
                    customFontRevision: Date.now(),
                  });
                  toast("自定义字体已保存");
                });
            }}
          />
          {[
            { title: "字号", key: "size", min: 16, max: 36, step: 1 },
            { title: "字重", key: "weight", min: 300, max: 700, step: 100 },
            {
              title: "行高",
              key: "lineHeight",
              min: 1.4,
              max: 2.4,
              step: 0.05,
            },
            { title: "字间距", key: "spacing", min: -0.5, max: 2, step: 0.25 },
            { title: "段落间距", key: "paragraph", min: 0, max: 28, step: 2 },
          ].map((s) => (
            <Slider
              key={s.key}
              title={s.title}
              min={s.min}
              max={s.max}
              step={s.step}
              value={prefs[s.key as keyof Prefs] as number}
              change={(v) => void setPrefs({ [s.key]: v })}
            />
          ))}
          <label className="field">
            {"" + tr("标点风格") + " "}<select
              value={prefs.punctuation}
              onChange={(e) =>
                void setPrefs({
                  punctuation: e.target.value as "original" | "full",
                })
              }
            >
              <option value="original">{"" + tr("保持原文") + ""}</option>
              <option value="full">{"" + tr("中文全角标点") + ""}</option>
            </select>
          </label>
          <div className="row">
            <input
              aria-label={tr("预设名称")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              onClick={() => {
                const { presets, ...values } = prefs;
                void setPrefs({
                  presets: [
                    ...presets.filter((p) => p.name !== name),
                    { name, values },
                  ],
                });
                toast("字体预设已保存");
              }}
            >
              <Check size={17} />
            </button>
          </div>
          {prefs.presets.length > 0 && (
            <select
              aria-label={tr("应用预设")}
              defaultValue=""
              onChange={(e) => {
                const v = prefs.presets.find((p) => p.name === e.target.value);
                if (v) void setPrefs(v.values);
              }}
            >
              <option value="">{"" + tr("应用保存的预设") + ""}</option>
              {prefs.presets.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          )}
        </section>
        <section>
          <div
            className="font-preview"
            style={{
              background: p.paper,
              color: p.ink,
              fontFamily: fonts[prefs.font]?.css,
              fontSize: prefs.size,
              fontWeight: prefs.weight,
              lineHeight: prefs.lineHeight,
              letterSpacing: prefs.spacing,
            }}
          >
            <span className="eyebrow">{"" + tr("纸境 · 排版样张") + ""}</span>
            <h2>{"" + tr("把时光，读成一首诗") + ""}</h2>
            <p style={{ marginBottom: prefs.paragraph }}>
              {"" + tr("窗外的风翻动树叶，窗内的人翻动书页。一杯茶，一盏灯，一本尚未读完的书，便是此刻恰到好处的世界。") + " "}</p>
            <p style={{ marginBottom: prefs.paragraph }}>
              {"" + tr("文字有自己的呼吸。行与行之间的留白，让思绪得以停泊；字与字之间的距离，让故事从容展开。") + " "}</p>
            <p>{"" + tr("“阅读，是随身携带的一座避难所。”") + ""}</p>
            <small>
              {"" + tr("春风有信，花开有期。 / A quiet moment, a world within.") + " "}</small>
          </div>
          <p className="hint">
            {"" + tr("清楷·正文 / 雅致：基于霞鹜文楷的字宽与字距适配。非原创字形；OFL 1.1。雅致版收紧字形并增加字距，适用于标题。") + " "}</p>
          <div className="theme-picker">
            {Object.entries(themes).map(([key, t]) => (
              <button
                key={key}
                className={prefs.theme === key ? "selected" : ""}
                onClick={() => void setPrefs({ theme: key })}
              >
                <i style={{ background: t.paper, color: t.ink }}>{"" + tr("文") + ""}</i>
                {t.name}
              </button>
            ))}
          </div>
          <div className="custom-colors">
            <label>
              {"" + tr("自定义纸张") + ""}{" "}
              <input
                type="color"
                value={prefs.customPaper}
                onChange={(e) =>
                  void setPrefs({
                    theme: "custom",
                    customPaper: e.target.value,
                  })
                }
              />
            </label>
            <label>
              {"" + tr("文字颜色") + ""}{" "}
              <input
                type="color"
                value={prefs.customInk}
                onChange={(e) =>
                  void setPrefs({ theme: "custom", customInk: e.target.value })
                }
              />
            </label>
          </div>
        </section>
      </div>
    </>
  );
}
function Studio({
  book,
  select,
  run,
}: {
  book: Book;
  select: React.ReactNode;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const { patch } = useStore();
  const update = (p: Partial<Book["style"]>) =>
    void patch(book.id, { style: { ...book.style, ...p } });
  return (
    <div className="studio-layout">
      <section className="studio-preview">
        <span className="eyebrow">{"" + tr("独属于这本书的装帧") + ""}</span>
        <Cover book={book} large />
        <div className="studio-shadow" />
        <p>
          {book.title}
          <small>
            {book.text.length.toLocaleString()} {" " + tr("字符 ·") + " "}{book.chapters.length}{" "}
            {"" + tr("章节") + " "}</small>
        </p>
      </section>
      <section className="panel studio-controls">
        {select}
        <h2>{"" + tr("封面与装帧") + ""}</h2>
        <label className="color-field">
          {"" + tr("封面颜色") + " "}<input
            type="color"
            value={book.style.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
        <label className="field">
          {"" + tr("封面纹样") + " "}<select
            value={book.style.pattern}
            onChange={(e) =>
              update({ pattern: e.target.value as Book["style"]["pattern"] })
            }
          >
            <option value="botanical">{"" + tr("植物枝叶") + ""}</option>
            <option value="arches">{"" + tr("拱廊几何") + ""}</option>
            <option value="stars">{"" + tr("星河微光") + ""}</option>
            <option value="plain">{"" + tr("素面留白") + ""}</option>
          </select>
        </label>
        <label className="field">
          {"" + tr("装帧材质") + " "}<select
            value={book.style.material}
            onChange={(e) =>
              update({ material: e.target.value as Book["style"]["material"] })
            }
          >
            <option value="cloth">{"" + tr("布面精装") + ""}</option>
            <option value="leather">{"" + tr("柔纹皮革") + ""}</option>
            <option value="paper">{"" + tr("纸质封面") + ""}</option>
          </select>
        </label>
        <Toggle
          title={tr("香槟金烫印")}
          value={book.style.gold}
          change={(v) => update({ gold: v })}
        />
        <Toggle
          title={tr("书名竖排")}
          value={book.style.vertical}
          change={(v) => update({ vertical: v })}
        />
        <Slider
          title={tr("书脊厚度")}
          min={10}
          max={45}
          value={Math.round(book.style.thickness)}
          suffix=" px"
          change={(v) => update({ thickness: v })}
        />
        <Slider
          title={tr("纸张纹理")}
          min={0}
          max={0.6}
          step={0.05}
          value={book.style.paperTexture}
          change={(v) => update({ paperTexture: v })}
        />
        <button
          onClick={() =>
            update({
              color: ["#405347", "#7e5147", "#50596c", "#756343", "#3f6468"][
                Math.floor(Math.random() * 5)
              ],
              pattern: ["botanical", "arches", "stars"][
                Math.floor(Math.random() * 3)
              ] as Book["style"]["pattern"],
              gold: true,
            })
          }
        >
          <Sparkles size={16} /> {" " + tr("灵感随机装帧") + " "}</button>
        <button
          className="primary"
          onClick={() => void run(() => exportArt(book))}
        >
          <Download size={16} /> {" " + tr("导出藏书封面 PNG") + " "}</button>
        <button onClick={() => void run(() => exportShowcase(book))}>
          <Download size={16} /> {" " + tr("导出书籍展示 PNG") + " "}</button>
        <p className="hint">
          <Check size={13} /> {" " + tr("所有修改自动保存到这本书。") + " "}</p>
      </section>
    </div>
  );
}
function Memory({
  books,
  book,
  select,
  read,
  run,
}: {
  books: Book[];
  book?: Book;
  select: React.ReactNode;
  read: (b: Book) => void;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const { patch } = useStore();
  const [trailName, setTrailName] = useState(""),
    [trailType, setTrailType] = useState<"人物" | "地点" | "关系">("人物"),
    [trailNote, setTrailNote] = useState(""),
    [search, setSearch] = useState("");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = d.toLocaleDateString("sv-SE");
    return {
      key,
      label: d.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      }),
      value: books.reduce((n, b) => n + (b.daily[key] || 0), 0) / 60,
    };
  });
  const max = Math.max(10, ...days.map((d) => d.value));
  const readEnd = book
    ? Math.max(
        book.offset,
        ...book.visited.map((i) => book.chapters[i]?.offset || 0),
      )
    : 0;
  const hits: { offset: number; text: string }[] = [];
  if (book && search) {
    let at = 0;
    while (hits.length < 40) {
      at = book.text.indexOf(search, at);
      if (at < 0 || at >= readEnd) break;
      hits.push({
        offset: at,
        text: book.text.slice(Math.max(0, at - 12), Math.min(readEnd, at + 55)),
      });
      at += search.length;
    }
  }
  return (
    <>
      <div className="stat-grid">
        {[
          ["收藏的故事", books.length, "本"],
          [
            "相伴的时光",
            Math.floor(books.reduce((s, b) => s + b.seconds, 0) / 60),
            "分钟",
          ],
          ["读完的世界", books.filter((b) => b.done).length, "本"],
          [
            "留下的片语",
            books.reduce(
              (s, b) => s + b.marks.filter((m) => m.kind === "quote").length,
              0,
            ),
            "则",
          ],
        ].map(([label, n, unit]) => (
          <div className="stat" key={label}>
            <span>{tr(String(label))}</span>
            <b>
              {n}
              <small>{tr(String(unit))}</small>
            </b>
          </div>
        ))}
      </div>
      <div className="memory-grid">
        <section className="panel">
          <h2>{"" + tr("最近七日 · 阅读节奏") + ""}</h2>
          <div className="chart">
            {days.map((d) => (
              <div key={d.key}>
                <span>{Math.round(d.value)} {" " + tr("分") + ""}</span>
                <i style={{ height: Math.max(3, (d.value / max) * 120) }} />
                <small>{d.label}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel capsule">
          <span className="eyebrow">READING TIME CAPSULE</span>
          <h2>{"" + tr("把这段时光，妥帖收藏。") + ""}</h2>
          {select}
          <p>
            {book
              ? `${book.title} · ${book.done ? tr("已完成") : tr("阅读中")}`
              : tr("导入并阅读一本书，留下你的故事。")}
          </p>
          <button
            disabled={!book}
            className="primary"
            onClick={() => book && void run(() => exportArt(book, true))}
          >
            <Download size={16} /> {" " + tr("生成阅读时光胶囊 PNG") + " "}</button>
        </section>
      </div>
      {book && (
        <>
          <div className="memory-grid">
            <section className="panel">
              <h2>{"" + tr("阅读足迹 ·") + " "}{book.title}</h2>
              <dl>
                <dt>{"" + tr("第一次翻开") + ""}</dt>
                <dd>
                  {book.firstOpened
                    ? new Date(book.firstOpened).toLocaleString("zh-CN")
                    : tr("尚未开始")}
                </dd>
                <dt>{"" + tr("最近阅读") + ""}</dt>
                <dd>
                  {book.lastRead
                    ? new Date(book.lastRead).toLocaleString("zh-CN")
                    : tr("尚未开始")}
                </dd>
                <dt>{"" + tr("读过章节") + ""}</dt>
                <dd>
                  {book.visited.length} / {book.chapters.length}
                </dd>
              </dl>
              <Toggle
                title={tr("已读完成")}
                value={book.done}
                change={(v) => void patch(book.id, { done: v })}
              />
              <button onClick={() => read(book)}>
                {"" + tr("回到这本书") + " "}<ChevronRight size={15} />
              </button>
            </section>
            <section className="panel">
              <h2>{"" + tr("收藏句子与批注") + ""}</h2>
              {!book.marks.length && (
                <p className="hint">{"" + tr("阅读时选择正文，可以保存摘录与批注。") + ""}</p>
              )}
              {book.marks.map((m) => (
                <div className="memory-quote" key={m.id}>
                  <blockquote
                    onClick={() => {
                      void patch(book.id, {
                        offset: m.offset,
                        context: book.text.slice(m.offset, m.offset + 48),
                      });
                      read(book);
                    }}
                  >
                    {m.context}
                  </blockquote>
                  <input
                    aria-label={tr("编辑批注")}
                    value={m.note}
                    placeholder={tr("添加批注")}
                    onChange={(e) =>
                      void patch(book.id, {
                        marks: book.marks.map((v) =>
                          v.id === m.id ? { ...v, note: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <div className="row">
                    <button
                      onClick={() =>
                        void patch(book.id, {
                          marks: [
                            m,
                            ...book.marks.filter((v) => v.id !== m.id),
                          ],
                        })
                      }
                    >
                      {"" + tr("用于纪念卡") + " "}</button>
                    <button
                      onClick={() =>
                        void patch(book.id, {
                          marks: book.marks.filter((v) => v.id !== m.id),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>
          <section className="panel story-trail">
            <h2>{"" + tr("故事足迹") + ""}</h2>
            <p className="hint">
              {"" + tr("检索范围严格截止当前阅读位置。人物、地点和关系由你确认并记录，不自动推断。") + " "}</p>
            <div className="row">
              <input
                placeholder={tr("在已读原文中检索人物或地点")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="trail-hits">
              {hits.map((h) => (
                <button
                  key={h.offset}
                  onClick={() => {
                    void patch(book.id, {
                      offset: h.offset,
                      context: book.text.slice(h.offset, h.offset + 48),
                    });
                    read(book);
                  }}
                >
                  {h.text}
                </button>
              ))}
            </div>
            <form
              className="trail-form"
              onSubmit={(e) => {
                e.preventDefault();
                void patch(book.id, {
                  trail: [
                    ...book.trail,
                    {
                      id: crypto.randomUUID(),
                      name: trailName,
                      type: trailType,
                      note: trailNote,
                      offset: book.offset,
                    },
                  ],
                });
                setTrailName("");
                setTrailNote("");
              }}
            >
              <input
                required
                placeholder={tr("人物 / 地点 / 关系名称")}
                value={trailName}
                onChange={(e) => setTrailName(e.target.value)}
              />
              <select
                value={trailType}
                onChange={(e) =>
                  setTrailType(e.target.value as typeof trailType)
                }
              >
                <option>{"" + tr("人物") + ""}</option>
                <option>{"" + tr("地点") + ""}</option>
                <option>{"" + tr("关系") + ""}</option>
              </select>
              <input
                placeholder={tr("你的记录，例如：林知与陈远是朋友")}
                value={trailNote}
                onChange={(e) => setTrailNote(e.target.value)}
              />
              <button className="primary">
                <Plus size={16} /> {" " + tr("建立索引") + " "}</button>
            </form>
            {book.trail
              .filter((t) => t.offset <= readEnd)
              .map((t) => (
                <div className="trail-record" key={t.id}>
                  <span>{t.type}</span>
                  <b>{t.name}</b>
                  <input
                    aria-label={tr("编辑故事记录")}
                    value={t.note}
                    onChange={(e) =>
                      void patch(book.id, {
                        trail: book.trail.map((v) =>
                          v.id === t.id ? { ...v, note: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      void patch(book.id, {
                        trail: book.trail.filter((v) => v.id !== t.id),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
          </section>
        </>
      )}
    </>
  );
}
