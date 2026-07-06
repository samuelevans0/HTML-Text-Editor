// Multi-page edit session. Holds one record per visited page, keeps unsaved edits
// in memory across navigation, and writes every changed page (and replaced images)
// on Save All using the minimal-diff engine. Browser-only.
import { buildSave } from "./htmlSource.js";
import { dirname } from "./paths.js";

export function createSession(fs) {
  const pages = new Map();

  function ensure(path, originalText) {
    if (!pages.has(path)) {
      pages.set(path, {
        path,
        originalText,
        edits: new Map(),            // composite key -> edit record (text/attr)
        replacedImages: new Map(),   // editId -> { file, originalSrc }
        imgSrcByEditId: new Map(),   // editId -> resolved original src path (set at load)
        dirty: false,
      });
    }
    return pages.get(path);
  }

  function editKey(rec) {
    return rec.kind === "attr" ? `${rec.editId}:attr:${rec.attrName}` : `${rec.editId}:text`;
  }

  function recordEdit(path, rec) {
    const p = pages.get(path);
    if (!p) return;
    if (rec.kind === "image") p.replacedImages.set(rec.editId, rec);
    else p.edits.set(editKey(rec), rec);
    p.dirty = true;
  }

  function discard(path) {
    const p = pages.get(path);
    if (!p) return;
    p.edits.clear();
    p.replacedImages.clear();
    p.dirty = false;
  }

  function globalDirty() {
    return [...pages.values()].some((p) => p.dirty);
  }
  function dirtyPaths() {
    return [...pages.values()].filter((p) => p.dirty).map((p) => p.path);
  }

  function srcRefCount(resolvedPath) {
    let n = 0;
    for (const p of pages.values())
      for (const sp of p.imgSrcByEditId.values())
        if (sp === resolvedPath) n++;
    return n;
  }

  async function saveAll() {
    const result = { savedPages: [], savedImages: [], skipped: [], conflicts: [] };
    for (const page of pages.values()) {
      if (!page.dirty) continue;

      // Guard against clobbering changes made to the file outside the editor.
      // We patch against our in-memory baseline (page.originalText); if the file
      // on disk no longer matches it, someone/something edited it since we loaded.
      // Saving would overwrite those changes, so skip this page and report it.
      let onDisk = null;
      try { onDisk = await fs.readText(page.path); } catch { onDisk = null; }
      if (onDisk !== null && onDisk !== page.originalText) {
        result.conflicts.push({ path: page.path });
        continue;
      }

      const edits = [...page.edits.values()];

      // Resolve image replacements into file writes (+ src attr edits if a new file).
      for (const [editId, img] of page.replacedImages) {
        const origSrcPath = page.imgSrcByEditId.get(editId) || null;
        if (origSrcPath && srcRefCount(origSrcPath) === 1 && (await fs.exists(origSrcPath))) {
          await fs.writeBytes(origSrcPath, img.file); // overwrite in place: zero HTML diff
          result.savedImages.push(origSrcPath);
        } else {
          const dir = origSrcPath ? dirname(origSrcPath) : (dirname(page.path) ? dirname(page.path) + "/images" : "images");
          const base = (img.file.name || "image.jpg").split("/").pop();
          const name = await fs.uniqueName(dir, base);
          const newPath = (dir ? dir + "/" : "") + name;
          await fs.writeBytes(newPath, img.file);
          result.savedImages.push(newPath);
          const pageDir = dirname(page.path);
          const relSrc = pageDir && newPath.startsWith(pageDir + "/")
            ? newPath.slice(pageDir.length + 1)
            : (pageDir ? "/" + newPath : newPath);
          edits.push({ editId, kind: "attr", attrName: "src", originalContent: "", value: relSrc });
        }
      }

      const { newHtml, applied, skipped } = buildSave(page.originalText, edits);
      skipped.forEach((s) => result.skipped.push({ path: page.path, ...s }));

      const wroteImages = page.replacedImages.size > 0;
      if (applied.length || wroteImages) {
        if (applied.length) await fs.writeText(page.path, newHtml);
        page.originalText = newHtml;
        page.edits.clear();
        page.replacedImages.clear();
        page.dirty = false;
        result.savedPages.push(page.path);
      }
    }
    return result;
  }

  return { pages, ensure, recordEdit, discard, globalDirty, dirtyPaths, saveAll };
}
