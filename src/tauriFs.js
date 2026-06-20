// Tauri desktop fs adapter. Same interface as createFs() in fsAccess.js but backed
// by native Rust commands. Only call these functions when window.__TAURI__ is present.

function abs(rootPath, relPath) {
  // Rust std::fs accepts forward slashes on Windows; normalize to avoid mixing separators.
  const base = rootPath.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return base + "/" + relPath;
}

export function createTauriFs(rootPath) {
  const name = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const call = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

  return {
    rootHandle: {
      name,
      async *values() {
        const entries = await call("list_dir", { path: rootPath });
        for (const e of entries) {
          yield { kind: e.is_dir ? "directory" : "file", name: e.name };
        }
      },
    },
    async readText(relPath) {
      return call("read_text", { path: abs(rootPath, relPath) });
    },
    async readBytes(relPath) {
      const bytes = await call("read_bytes", { path: abs(rootPath, relPath) });
      return new Blob([new Uint8Array(bytes)]);
    },
    async writeText(relPath, text) {
      await call("write_text", { path: abs(rootPath, relPath), text });
    },
    async writeBytes(relPath, blob) {
      const buf = await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer();
      await call("write_bytes", {
        path: abs(rootPath, relPath),
        bytes: Array.from(new Uint8Array(buf)),
      });
    },
    async exists(relPath) {
      return call("path_exists", { path: abs(rootPath, relPath) });
    },
    async uniqueName(dirPath, baseName) {
      const dot = baseName.lastIndexOf(".");
      const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot > 0 ? baseName.slice(dot) : "";
      let nm = baseName, i = 0;
      while (await call("path_exists", { path: abs(rootPath, (dirPath ? dirPath + "/" : "") + nm) })) {
        i++; nm = `${stem}-${i}${ext}`;
      }
      return nm;
    },
  };
}

// Wraps a single .html file as a minimal single-file fs.
// Used when the user drags a standalone .html file onto the window.
export function createTauriSingleFileFs(filePath) {
  const name = filePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const call = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
  return {
    rootHandle: {
      name,
      async *values() { yield { kind: "file", name }; },
    },
    async readText() {
      return call("read_text", { path: filePath });
    },
    async readBytes() {
      const bytes = await call("read_bytes", { path: filePath });
      return new Blob([new Uint8Array(bytes)]);
    },
    async writeText(_p, text) {
      await call("write_text", { path: filePath, text });
    },
    async writeBytes(_p, blob) {
      const buf = await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer();
      await call("write_bytes", {
        path: filePath,
        bytes: Array.from(new Uint8Array(buf)),
      });
    },
    async exists(p) { return p === name; },
    async uniqueName(_dir, base) { return base; },
  };
}

export async function pickTauriFolder() {
  const result = await window.__TAURI__.dialog.open({ directory: true, multiple: false });
  if (!result) return null;
  const path = typeof result === "string" ? result : result[0];
  return createTauriFs(path);
}
