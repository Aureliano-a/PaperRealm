import { get, put } from "./db";
import { invoke } from "@tauri-apps/api/core";
export type SourceParts = { version: 1; parts: number; length: number };
const CHUNK = 384 * 1024;
function encodePart(part: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < part.length; offset += 8192)
    binary += String.fromCharCode(...part.subarray(offset, offset + 8192));
  return btoa(binary);
}

// Read one bounded File slice at a time. Rust hashes the exact staged bytes
// and publishes the existing source descriptor and chunk keys atomically.
export async function importDesktopPdf(file: File): Promise<string> {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(header) !== "%PDF-")
    throw Error("不是有效的 PDF 文件");
  const token = crypto.randomUUID().replaceAll("-", "");
  try {
    for (
      let offset = 0, index = 0;
      offset < file.size;
      offset += CHUNK, index++
    ) {
      const part = new Uint8Array(
        await file.slice(offset, offset + CHUNK).arrayBuffer(),
      );
      await put(`pdf-import:${token}:${index}`, encodePart(part));
    }
    return await invoke<string>("db_finish_pdf_import", {
      token,
      length: file.size,
    });
  } catch (error) {
    await invoke("db_discard_pdf_import", { token }).catch(() => {
      // Startup removes staging records left after an interrupted import.
    });
    throw error;
  }
}
export async function writeBinarySource(id: string, bytes: Uint8Array) {
  const parts = Math.ceil(bytes.length / CHUNK);
  for (let index = 0; index < parts; index++) {
    const part = bytes.subarray(
      index * CHUNK,
      Math.min(bytes.length, (index + 1) * CHUNK),
    );
    await put(`source-part:${id}:${index}`, encodePart(part));
  }
  await put(`source:${id}`, {
    version: 1,
    parts,
    length: bytes.length,
  } satisfies SourceParts);
}
export async function readBinarySource(id: string): Promise<Uint8Array> {
  const source = await get<string | SourceParts>("source:" + id);
  if (!source) throw Error("本地文件副本丢失，请重新导入");
  if (typeof source === "string") {
    const binary = atob(source),
      bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (
    source.version !== 1 ||
    !Number.isSafeInteger(source.length) ||
    source.length < 0 ||
    !Number.isSafeInteger(source.parts) ||
    source.parts !== Math.ceil(source.length / CHUNK)
  )
    throw Error("文件分块记录损坏");
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.parts; index++) {
    const value = await get<string>(`source-part:${id}:${index}`);
    if (typeof value !== "string")
      throw Error("文件分块缺失，请恢复备份或重新导入");
    const binary = atob(value),
      offset = index * CHUNK;
    if (binary.length !== Math.min(CHUNK, source.length - offset))
      throw Error("文件分块长度不正确");
    for (let i = 0; i < binary.length; i++)
      bytes[offset + i] = binary.charCodeAt(i);
  }
  return bytes;
}
