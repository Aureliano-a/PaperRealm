import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  decode,
  chapters,
  paginate,
  pageAt,
  restore,
  progress,
} from "../src/engine";
import { convert } from "../src/conversion";
import { get, put } from "../src/db";
import { useStore } from "../src/store";
import { defaults } from "../src/types";
import { normalizePrefs, readerWidth, isDark } from "../src/reading";
const layout = {
  width: 440,
  height: 610,
  size: 22,
  lineHeight: 1.8,
  spacing: 1,
  paragraph: 12,
};
const text =
  "第一章 窗边\n\n" +
  "风吹过窗前，故事慢慢展开。中文 English 2026 混排。\n".repeat(180) +
  "第二章 雨声\n" +
  "风与雨之间，我们再次相遇。\n".repeat(90);
describe("TXT decoding", () => {
  it("decodes UTF-8 and strips BOM", () =>
    expect(decode(new TextEncoder().encode("\uFEFF第一章\r\n你好")).text).toBe(
      "第一章\n你好",
    ));
  it("decodes GBK and GB18030", () => {
    const b = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    expect(decode(b).text).toBe("你好");
    expect(decode(b, "gbk").text).toBe("你好");
  });
  it("decodes UTF-16 LE and BE BOM", () => {
    expect(
      decode(new Uint8Array([255, 254, 0x60, 0x4f, 0x7d, 0x59])).text,
    ).toBe("你好");
    expect(
      decode(new Uint8Array([254, 255, 0x4f, 0x60, 0x59, 0x7d])).text,
    ).toBe("你好");
  });
  it("rejects empty, invalid and binary input", () => {
    expect(() => decode(new Uint8Array())).toThrow();
    expect(() => decode(new Uint8Array([0xff]), "utf-8")).toThrow();
    expect(() => decode(new Uint8Array([0, 0, 0, 0]), "utf-8")).toThrow();
  });
});
describe("Chinese layout and original anchors", () => {
  it("recognizes numbered Chinese and English chapters without ordinary sentences", () => {
    expect(
      chapters(
        "第一章 开始\n正文\nChapter 2 Rain\n第三回 风来\n后记\n正文",
      ).map((x) => x.title),
    ).toEqual(["第一章 开始", "Chapter 2 Rain", "第三回 风来", "后记"]);
  });
  it("paginates without lost or repeated non-newline text", () => {
    const p = paginate(text, layout);
    expect(p.length).toBeGreaterThan(10);
    expect(
      p
        .flatMap((p) => p.lines)
        .map((l) => l.text)
        .join(""),
    ).toBe(text.replace(/\n/g, ""));
    expect(
      p.every((v) =>
        v.lines.every(
          (l) => l.y + layout.size * layout.lineHeight <= layout.height,
        ),
      ),
    ).toBe(true);
  });
  it("restores offset after font-size and viewport repagination", () => {
    const p = paginate(text, layout);
    const offset = p[4].start;
    const larger = paginate(text, { ...layout, size: 30, width: 330 });
    expect(larger.length).toBeGreaterThan(p.length);
    const at = pageAt(larger, offset);
    expect(larger[at].start).toBeLessThanOrEqual(offset);
    expect(larger[at + 1].start).toBeGreaterThan(offset);
  });
  it("uses font measured widths", () => {
    const latin = "Hello world. ".repeat(100);
    expect(
      paginate(latin, layout, { H: 40, e: 40, l: 40, o: 40 }).length,
    ).toBeGreaterThan(paginate(latin, layout).length);
  });
  it("starts chapters on a fresh reading page", () => {
    const input = "第一章 开始\n短正文。\n第二章 相遇\n故事继续。";
    const pages = paginate(input, layout);
    expect(pages).toHaveLength(2);
    expect(pages[1].lines[0].text).toBe("第二章 相遇");
    expect(pages[1].start).toBe(input.indexOf("第二章"));
  });
  it("recovers a context anchor after text insertions", () => {
    expect(restore("序言\n" + text, 50, text.slice(50, 98))).toBe(53);
  });
  it("bounds a single column across small and 4K viewports", () => {
    expect(readerWidth(760, 100)).toBeLessThan(760);
    expect(readerWidth(3840, 130)).toBe(1000);
    expect(readerWidth(1920, 100)).toBe(800);
  });
  it("keeps astral characters intact", () => {
    const p = paginate("山😀海".repeat(100), layout);
    expect(
      p
        .flatMap((x) => x.lines)
        .map((x) => x.text)
        .join(""),
    ).toBe("山😀海".repeat(100));
  });
});
describe("OpenCC conversion", () => {
  it("supports all five modes and leaves input untouched", () => {
    const s = "汉语与阅读";
    expect(convert(s, "original")).toBe(s);
    for (const mode of ["t", "tw", "hk"])
      expect(convert(s, mode)).toContain("漢語");
    expect(convert("漢語與閱讀", "cn")).toBe(s);
    expect(s).toBe("汉语与阅读");
  });
});
describe("Local database and state", () => {
  beforeEach(async () => {
    await put("books", []);
    await put("prefs", defaults);
    useStore.setState({ books: [], prefs: defaults, error: "" });
  });
  it("persists book, bookmark, style and statistics across initialization", async () => {
    await useStore
      .getState()
      .importFiles([new File([text], "测试.txt")], "auto");
    const b = useStore.getState().books[0];
    expect(b.chapters.length).toBe(2);
    await useStore.getState().patch(b.id, {
      offset: 150,
      context: text.slice(150, 198),
      seconds: 120,
      visited: [0],
      daily: { "2026-10-24": 120 },
      style: { ...b.style, color: "#112233" },
      marks: [
        {
          id: "mark",
          kind: "bookmark",
          offset: 150,
          context: text.slice(150, 198),
          note: "测试",
          created: 1,
        },
      ],
    });
    useStore.setState({ books: [] });
    await useStore.getState().init();
    const loaded = useStore.getState().books[0];
    expect(loaded.offset).toBe(150);
    expect(loaded.style.color).toBe("#112233");
    expect(loaded.seconds).toBe(120);
    expect(loaded.marks[0].offset).toBe(150);
    expect(loaded.daily["2026-10-24"]).toBe(120);
  });
  it("deduplicates content without resetting existing progress", async () => {
    await useStore
      .getState()
      .importFiles([new File([text], "first.txt")], "auto");
    const id = useStore.getState().books[0].id;
    await useStore.getState().patch(id, { offset: 300 });
    await useStore
      .getState()
      .importFiles([new File([text], "different-name.txt")], "auto");
    expect(useStore.getState().books).toHaveLength(1);
    expect(useStore.getState().books[0].offset).toBe(300);
  });
  it("handles bad extension and empty files without adding records", async () => {
    await useStore
      .getState()
      .importFiles(
        [new File(["abc"], "wrong.pdf"), new File([], "empty.txt")],
        "auto",
      );
    expect(useStore.getState().books).toHaveLength(0);
    expect(useStore.getState().error).toContain("只接受");
  });
  it("exports and restores a valid backup and rejects invalid input", async () => {
    await expect(useStore.getState().restoreBackup({})).rejects.toThrow();
    await put("test", { value: 1 });
    expect(await get("test")).toEqual({ value: 1 });
  });
  it("has explicit completion status", () =>
    expect(progress({ text: "abc", offset: 0, done: true })).toBe(100));
});
describe("larger texts and backup round trips", () => {
  it("paginates a 5 MB UTF-8 Chinese text without losing characters", () => {
    const large = "长夜读书，文字自有回响。\n".repeat(140000);
    const pages = paginate(large, layout);
    expect(pages.length).toBeGreaterThan(1000);
    expect(
      pages.reduce(
        (n, p) => n + p.lines.reduce((m, l) => m + l.text.length, 0),
        0,
      ),
    ).toBe(large.replace(/\n/g, "").length);
  });
  it("restores a valid full backup into an empty library", async () => {
    useStore.setState({ books: [], prefs: defaults });
    await put("books", []);
    await useStore
      .getState()
      .importFiles(
        [new File(["第一章 新故事\n原始中文。"], "备份.txt")],
        "utf-8",
      );
    const book = useStore.getState().books[0];
    await useStore.getState().patch(book.id, { done: true });
    const backup = {
      version: 1,
      books: useStore.getState().books,
      prefs: defaults,
    };
    expect(backup.books[0].completedAt).toBeGreaterThan(0);
    useStore.setState({ books: [] });
    await useStore.getState().restoreBackup(backup);
    expect(useStore.getState().books[0].text).toContain("原始中文");
    await useStore.getState().reinterpret(book.id, "utf-8");
    expect(useStore.getState().books[0].encoding).toBe("utf-8");
    await expect(
      useStore.getState().restoreBackup({
        version: 1,
        books: [{ id: "bad", text: "bad", marks: [], chapters: [] }],
      }),
    ).rejects.toThrow();
  });
});

describe("reader upgrade and custom appearance", () => {
  it("migrates double mode and loose spacing without losing other preferences", () => {
    const value = normalizePrefs({
      mode: "double",
      spacing: 4,
      font: "custom",
      size: 24,
      readingVersion: 1,
    });
    expect(value.mode).toBe("single");
    expect(value.spacing).toBe(0);
    expect(value.font).toBe("custom");
    expect(value.size).toBe(24);
    expect(value.readingVersion).toBe(2);
  });
  it("retains continuous mode and new custom colors on repeated normalization", () => {
    const value = normalizePrefs({
      ...defaults,
      mode: "scroll",
      readerBackground: "#152637",
      spacing: -0.25,
    });
    expect(normalizePrefs(value)).toEqual(value);
    expect(isDark(value.readerBackground)).toBe(true);
    expect(isDark("#faf7f0")).toBe(false);
  });
  it("persists migration while preserving books, original offsets and bookmarks", async () => {
    const saved = useStore.getState().books;
    await put("prefs", {
      mode: "double",
      spacing: 2,
      readingVersion: 1,
      presets: [{ name: "旧预设", values: { mode: "double", spacing: 3 } }],
    });
    await useStore.getState().init();
    expect(
      useStore.getState().books.map((b) => [b.id, b.offset, b.marks]),
    ).toEqual(saved.map((b) => [b.id, b.offset, b.marks]));
    const updated = await get<any>("prefs");
    expect(updated.mode).toBe("single");
    expect(updated.spacing).toBe(0);
    expect(updated.presets[0].values.mode).toBe("single");
    await useStore.getState().setPrefs({
      readerBackground: "#123456",
      customPaper: "#abcdef",
      customInk: "#334455",
      spacing: 0.25,
    });
    await useStore.getState().init();
    expect(useStore.getState().prefs.readerBackground).toBe("#123456");
    expect(useStore.getState().prefs.customPaper).toBe("#abcdef");
    expect(useStore.getState().prefs.spacing).toBe(0.25);
  });
});
