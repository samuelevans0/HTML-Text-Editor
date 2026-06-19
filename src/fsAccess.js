// Thin wrapper over a FileSystemDirectoryHandle: resolve in-folder paths to file
// handles and read/write text or bytes. Browser-only (Chrome/Edge).
import { dirname } from "./paths.js";

export function supported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickRoot() {
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export function createFs(rootHandle) {
  async function dirHandleFor(path, create) {
    const parts = path.split("/").filter(Boolean);
    let dir = rootHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }
  async function getFileHandle(path, { create = false } = {}) {
    const dir = await dirHandleFor(dirname(path), create);
    const name = path.split("/").pop();
    return dir.getFileHandle(name, { create });
  }
  const api = {
    rootHandle,
    getFileHandle,
    async readText(path) {
      return (await (await getFileHandle(path)).getFile()).text();
    },
    async readBytes(path) {
      return (await getFileHandle(path)).getFile();
    },
    async writeText(path, text) {
      const fh = await getFileHandle(path, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    },
    async writeBytes(path, blob) {
      const fh = await getFileHandle(path, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    },
    async exists(path) {
      try { await getFileHandle(path); return true; } catch { return false; }
    },
    async uniqueName(dirPath, baseName) {
      const dot = baseName.lastIndexOf(".");
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : "";
      let name = baseName, i = 0;
      while (await api.exists((dirPath ? dirPath + "/" : "") + name)) {
        i++; name = `${stem}-${i}${ext}`;
      }
      return name;
    },
  };
  return api;
}
