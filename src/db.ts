import { openDB } from "idb";
import { invoke, isTauri } from "@tauri-apps/api/core";
const db = () =>
  openDB("paperrealm-v1", 1, {
    upgrade(db) {
      db.createObjectStore("records");
    },
  });
const savedContent = new Set<string>();
export async function keys(): Promise<string[]> {
  if (isTauri()) return invoke<string[]>("db_keys");
  return (await (await db()).getAllKeys("records")).filter((k): k is string => typeof k === "string");
}
export async function get<T>(key: string): Promise<T | undefined> {
  if (isTauri()) {
    const value = await invoke<string | null>("db_get", { key });
    return value ? JSON.parse(value) : undefined;
  }
  return (await db()).get("records", key);
}
export async function put(key: string, value: unknown): Promise<void> {
  if (isTauri()) {
    await invoke("db_put", { key, value: JSON.stringify(value) });
    return;
  }
  const database = await db();
  const tx = database.transaction("records", "readwrite");
  await tx.store.put(value, key);
  await tx.done;
}
export async function saveLibrary(books: import("./types").Book[]) {
  for (const b of books) {
    if (!savedContent.has(b.id)) {
      await put("content:" + b.id, b.text);
      savedContent.add(b.id);
    }
  }
  await put(
    "books",
    books.map(({ text, ...metadata }) => metadata),
  );
}
export async function loadLibrary(): Promise<import("./types").Book[]> {
  const records = (await get<import("./types").Book[]>("books")) || [];
  return Promise.all(
    records.map(async (b) => {
      const text = b.text ?? (await get<string>("content:" + b.id));
      if (text === undefined) throw Error("书籍内容丢失：" + b.title);
      savedContent.add(b.id);
      return { ...b, text };
    }),
  );
}
