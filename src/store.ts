import { preparePendingWrites } from "./persistenceHooks";
import {
  validTranslationRecord,
  validOcrRecord,
} from "./readingDataValidation";
import { validForms } from "./pdfForms";
import {
  importDesktopPdf,
  readBinarySource,
  writeBinarySource,
} from "./binarySource";
import { isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { get, put, keys, loadLibrary, saveLibrary } from "./db";
import { defaults, defaultStyle, type Book, type Prefs } from "./types";
import { chapters, decode, restore } from "./engine";
import { normalizePrefs } from "./reading";
type State = {
  books: Book[];
  prefs: Prefs;
  ready: boolean;
  error: string;
  busy: string;
  init: () => Promise<void>;
  patch: (
    id: string,
    patch: Partial<Book> | ((book: Book) => Partial<Book>),
  ) => Promise<boolean>;
  reinterpret: (id: string, encoding: string) => Promise<void>;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
  importFiles: (files: File[], encoding: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
  restoreBackup: (value: unknown) => Promise<void>;
};
let queue = Promise.resolve();
const extraWrites = new Set<Promise<unknown>>();
export function trackExtraWrite<T>(job: Promise<T>): Promise<T> {
  extraWrites.add(job);
  void job.then(
    () => extraWrites.delete(job),
    () => extraWrites.delete(job),
  );
  return job;
}
export const flushWrites = async () => {
  await preparePendingWrites();
  while (extraWrites.size) await Promise.all([...extraWrites]);
  await queue;
};
export async function exportExtraRecords(books: Book[]) {
  await flushWrites();
  const ids = new Set(books.map((b) => b.id));
  const allKeys = await keys();
  const selected = allKeys.filter(
    (key) =>
      key === "custom-font" ||
      key === "offline-dictionary" ||
      (key.startsWith("source:") && ids.has(key.slice(7))) ||
      (key.startsWith("source-part:") && ids.has(key.split(":")[1])) ||
      ((key.startsWith("translations:") ||
        key.startsWith("pdf-forms:") ||
        key.startsWith("pdf-ocr:")) &&
        ids.has(key.split(":")[1])),
  );
  const pairs = await Promise.all(
    selected.map(async (key) => [key, await get<unknown>(key)] as const),
  );
  return Object.fromEntries(pairs);
}
function enqueueWrite(write: () => Promise<void>) {
  const job = queue.catch(() => {}).then(write);
  queue = job;
  return job;
}
const persist = (key: string, value: unknown) =>
  enqueueWrite(() => put(key, value));
export const useStore = create<State>((set, getState) => {
  const updateLibrary = (update: (books: Book[]) => Book[]) =>
    enqueueWrite(async () => {
      const books = update(getState().books);
      await saveLibrary(books);
      set({ books });
    });
  let importing: Promise<void> | undefined;
  return {
    books: [],
    prefs: defaults,
    ready: false,
    error: "",
    busy: "",
    clearError: () => set({ error: "" }),
    init: async () => {
      try {
        const books = await loadLibrary();
        const saved = await get<Prefs>("prefs");
        const prefs = normalizePrefs(saved);
        if (saved && saved.readingVersion !== 2) await persist("prefs", prefs);
        set({ books, prefs, ready: true });
      } catch (e) {
        set({ error: "读取本地数据库失败：" + String(e), ready: true });
      }
    },
    patch: async (id, patch) => {
      try {
        await updateLibrary((current) => {
          if (!current.some((b) => b.id === id))
            throw Error("书籍已不在书库中");
          return current.map((b) => {
            if (b.id !== id) return b;
            const changes = typeof patch === "function" ? patch(b) : patch;
            const next = { ...b, ...changes };
            if (changes.done !== undefined)
              next.completedAt = changes.done
                ? b.completedAt || Date.now()
                : undefined;
            return next;
          });
        });
        return true;
      } catch (e) {
        set({ error: "保存失败，请检查磁盘空间后重试。" + " " + String(e) });
        return false;
      }
    },
    reinterpret: async (id, encoding) => {
      const bytes = await readBinarySource(id);
      const result = decode(bytes, encoding);
      const b = getState().books.find((b) => b.id === id)!;
      const offset = restore(result.text, b.offset, b.context);
      await put("content:" + id, result.text);
      const saved = await getState().patch(id, {
        ...result,
        chapters: chapters(result.text),
        offset,
        context: result.text.slice(offset, offset + 48),
        marks: b.marks.map((m) => ({
          ...m,
          offset: restore(result.text, m.offset, m.context),
        })),
      });
      if (!saved) throw Error("保存失败，请检查磁盘空间后重试。");
    },
    setPrefs: async (p) => {
      const prefs = normalizePrefs({ ...getState().prefs, ...p });
      set({ prefs });
      try {
        await persist("prefs", prefs);
      } catch (e) {
        set({ error: "设置保存失败：" + String(e) });
      }
    },
    importFiles: (files, encoding) => {
      const job = (importing ?? Promise.resolve()).then(async () => {
        set({ busy: "正在整理新藏书…" });
        const errors: string[] = [];
        try {
          for (const file of files) {
            try {
              if (!/\.(txt|epub|pdf)$/i.test(file.name))
                throw Error("仅支持 TXT、EPUB 和 PDF 文件");
              const ext = file.name.split(".").pop()!.toLowerCase();
              const format = ext as "txt" | "epub" | "pdf";
              const streamed =
                format === "pdf" && file.size > 32 * 1024 * 1024 && isTauri();
              const bytes = streamed
                ? null
                : new Uint8Array(await file.arrayBuffer());
              let text = "",
                enc: string = format,
                title = file.name
                  .replace(/\.(txt|epub|pdf)$/i, "")
                  .replace(/[_-]/g, " "),
                author = "佚名",
                coverImage: string | undefined;
              let pdfCover: Book["pdfCover"];
              const decoded =
                format === "txt" && bytes ? decode(bytes, encoding) : null;
              if (
                format === "pdf" &&
                bytes &&
                new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
              )
                throw Error("不是有效的 PDF 文件");
              const id = bytes
                ? Array.from(
                    new Uint8Array(
                      await crypto.subtle.digest(
                        "SHA-256",
                        decoded
                          ? new TextEncoder().encode(decoded.text)
                          : bytes,
                      ),
                    ),
                    (value) => value.toString(16).padStart(2, "0"),
                  ).join("")
                : await importDesktopPdf(file);
              if (getState().books.some((b) => b.id === id)) {
                errors.push(file.name + " 已在书库中，保留原有进度");
                continue;
              }
              if (bytes) await writeBinarySource(id, bytes);
              if (decoded) {
                text = decoded.text;
                enc = decoded.encoding;
              } else if (
                format === "pdf" &&
                bytes &&
                bytes.length <= 32 * 1024 * 1024
              ) {
                const { default: pdfjs } = await import("./pdfEngine");
                const task = pdfjs.getDocument({
                  data: bytes,
                  enableXfa: true,
                  useWorkerFetch: false,
                  isEvalSupported: false,
                  canvasMaxAreaInBytes: 16 * 1024 * 1024,
                });
                let pdf;
                try {
                  pdf = await task.promise;
                } catch (error) {
                  await task.destroy();
                  if ((error as Error).name !== "PasswordException")
                    throw error;
                }
                if (pdf)
                  try {
                    const meta = await pdf.getMetadata();
                    const info = meta.info as {
                      Title?: string;
                      Author?: string;
                    };
                    title = info.Title || title;
                    author = info.Author || author;
                    try {
                      const { identifyPdfCover } = await import("./pdfCover");
                      ({ coverImage, pdfCover } = await identifyPdfCover(
                        pdf,
                        title,
                      ));
                    } catch {
                      /* Keep the book import available when cover recognition fails. */
                    }
                  } finally {
                    await pdf.destroy();
                  }
              } else if (format === "epub" && bytes) {
                if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
                  throw Error("不是有效的 EPUB 文件");
                const { default: ePub } = await import("epubjs");
                const epub = ePub(
                  bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  ) as ArrayBuffer,
                );
                try {
                  await epub.ready;
                  const meta = await epub.loaded.metadata;
                  title = meta.title || title;
                  author = meta.creator || author;
                } finally {
                  epub.destroy();
                }
              }
              const palette = [
                "#355449",
                "#704b3c",
                "#535569",
                "#9b7950",
                "#4e6267",
              ];
              const book: Book = {
                id,
                format,
                coverImage,
                pdfCover,
                title,
                author,
                category: "未分类",
                tags: "",
                favorite: false,
                text,
                encoding: enc,
                fileName: file.name,
                created: Date.now(),
                offset: 0,
                context: text.slice(0, 48),
                seconds: 0,
                done: false,
                chapters: text ? chapters(text) : [],
                visited: [],
                marks: [],
                trail: [],
                daily: {},
                style: {
                  ...defaultStyle,
                  color: palette[getState().books.length % palette.length],
                  thickness: Math.max(
                    12,
                    Math.min(42, 12 + text.length / 12000),
                  ),
                },
              };
              await updateLibrary((books) =>
                books.some((item) => item.id === id) ? books : [...books, book],
              );
            } catch (e) {
              errors.push(file.name + "：" + String(e));
            }
          }
        } finally {
          set({ busy: "", error: errors.join("\n") });
        }
      });
      importing = job;
      return trackExtraWrite(job).finally(() => {
        if (importing === job) importing = undefined;
      });
    },
    remove: async (id) => {
      try {
        await updateLibrary((books) => books.filter((b) => b.id !== id));
      } catch (e) {
        set({ error: "删除失败：" + String(e) });
      }
    },
    restoreBackup: async (value) => {
      const v = value as {
        version: number;
        books: Book[];
        prefs: Prefs;
        extras?: Record<string, unknown>;
      };
      if (
        !v ||
        ![1, 2].includes(v.version) ||
        !Array.isArray(v.books) ||
        !v.books.every(
          (b) =>
            typeof b.text === "string" &&
            typeof b.id === "string" &&
            [
              "title",
              "author",
              "category",
              "tags",
              "encoding",
              "fileName",
              "context",
            ].every((k) => typeof b[k as keyof Book] === "string") &&
            Number.isFinite(b.offset) &&
            Number.isFinite(b.seconds) &&
            b.style &&
            typeof b.style.color === "string" &&
            b.daily &&
            typeof b.daily === "object" &&
            Array.isArray(b.visited) &&
            Array.isArray(b.trail) &&
            Array.isArray(b.marks) &&
            Array.isArray(b.chapters),
        )
      )
        throw Error("备份格式不正确");
      const ids = new Set(getState().books.map((b) => b.id));
      const newIds = new Set(
        v.books.filter((b) => !ids.has(b.id)).map((b) => b.id),
      );
      if (
        v.version === 2 &&
        v.extras &&
        typeof v.extras === "object" &&
        !Array.isArray(v.extras)
      ) {
        for (const [key, data] of Object.entries(v.extras)) {
          const bookData =
            (key.startsWith("source:") &&
              newIds.has(key.slice(7)) &&
              (typeof data === "string" ||
                (!!data &&
                  typeof data === "object" &&
                  (data as { version?: number }).version === 1))) ||
            (key.startsWith("source-part:") &&
              newIds.has(key.split(":")[1]) &&
              /^source-part:[a-f0-9]+:\d+$/.test(key) &&
              typeof data === "string") ||
            (key.startsWith("translations:") &&
              newIds.has(key.split(":")[1]) &&
              validTranslationRecord(data)) ||
            (key.startsWith("pdf-forms:") &&
              newIds.has(key.split(":")[1]) &&
              validForms(data, key.split(":")[1])) ||
            (key.startsWith("pdf-ocr:") &&
              newIds.has(key.split(":")[1]) &&
              validOcrRecord(data) &&
              data.page === Number(key.split(":")[2]));
          const auxiliary =
            (key === "custom-font" && typeof data === "string") ||
            (key === "offline-dictionary" &&
              Array.isArray(data) &&
              data.every(
                (x) =>
                  x &&
                  typeof x.word === "string" &&
                  typeof x.meaning === "string",
              ));
          if ((bookData || auxiliary) && (await get(key)) === undefined)
            await put(key, data);
        }
        const font = await get<string>("custom-font");
        if (font) {
          try {
            const face = new FontFace("UserFont", `url(${font})`);
            await face.load();
            document.fonts.add(face);
          } catch {
            /* Existing books remain readable with fallback fonts. */
          }
        }
      }
      await updateLibrary((books) => {
        const existing = new Set(books.map((book) => book.id));
        return [...books, ...v.books.filter((book) => !existing.has(book.id))];
      });
      const prefs = normalizePrefs(v.prefs);
      await persist("prefs", prefs);
      set({ prefs });
    },
  };
});
