// App shell: chrome, folder open, page load/navigate, and Save All orchestration.
import { supported, pickRoot, createFs } from "./fsAccess.js";
import { createSession } from "./pages.js";
import { buildPreview } from "./assets.js";
import { wireEditor } from "./editor.js";
import { resolvePath, isHtml } from "./paths.js";
import { inServerMode, siteFromQuery, fetchSites, createServerFs } from "./serverFs.js";
import { createTauriFs, pickTauriFolder, pickTauriFile } from "./tauriFs.js";

const isTauri = typeof window !== "undefined" && typeof window.__TAURI__ !== "undefined";

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|avif|bmp|ico)$/i;
const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon" };

let fs = null;
let session = null;
let rootHandle = null;
let currentPath = null;
let currentRevoke = null;
let currentEditor = null; // result of wireEditor() — exposes applyImageAt()
const navStack = [];

// Pure: pick the helper site whose path contains a segment matching the dropped folder name.
export function matchSite(name, sites) {
  const segs = (s) => s.split("/");
  const last = (s) => segs(s).pop();
  let m = sites.find((s) => last(s) === name);
  if (m) return m;
  m = sites.find((s) => last(s).toLowerCase() === String(name).toLowerCase());
  if (m) return m;
  m = sites.find((s) => segs(s).includes(name));
  if (m) return m;
  const nl = String(name).toLowerCase();
  m = sites.find((s) => segs(s).some((p) => p.toLowerCase() === nl));
  return m || null;
}

// ---- tiny DOM helper ----
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

let els = {};

export function bootApp() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  els.pill = h("span", { class: "pill", id: "pill" }, "No folder open");
  els.home = h("button", { class: "btn ghost home-btn", id: "homeBtn", title: "Back to home screen", onclick: closeSession, hidden: "" }, "⌂ Home");
  els.back = h("button", { class: "btn ghost", id: "back", title: "Back", disabled: "", onclick: goBack }, "‹ Back");
  els.crumb = h("span", { class: "crumb", id: "crumb" }, "");
  els.hint = h("span", { class: "hint" }, "Click a link to open & edit it · Alt-click a link to change its address");
  els.pages = h("div", { class: "pages-menu", id: "pagesMenu", hidden: "" });
  els.open = isTauri ? buildOpenMenu() : h("button", { class: "btn go", onclick: openFolder }, "Open site folder");
  els.discard = h("button", { class: "btn ghost", disabled: "", onclick: discardCurrent }, "Discard page");
  els.save = h("button", { class: "btn primary", id: "save", disabled: "", onclick: saveAll },
    "Save All ", h("span", { class: "dot", id: "dot", hidden: "" }, "●"));

  els.bar = h("div", { class: "topbar" },
    h("div", { class: "brand" }, h("b", {}, "HTML Site Editor"), h("small", {}, "edit any static site")),
    els.pill, els.home, els.pages, els.back, els.crumb,
    h("span", { class: "spacer" }), els.hint,
    els.open, els.discard, els.save);

  els.frame = h("iframe", { id: "frame", title: "Page preview" });
  els.welcome = buildWelcome();
  els.stage = h("div", { class: "stage" }, els.frame, els.welcome);
  els.toast = h("div", { class: "toast", id: "toast" });

  app.append(els.bar, els.stage, els.toast);

  // Close pages dropdown when clicking outside it.
  document.addEventListener("click", (e) => {
    if (els.pages && !els.pages.contains(e.target)) els.pages.classList.remove("open");
  });

  if (isTauri) {
    // Native file access via Tauri — no server or browser API needed.
  } else if (inServerMode()) {
    bootServerMode();
  } else if (!supported()) {
    els.pill.textContent = "Needs the launcher";
    els.pill.className = "pill warn";
    showToast("To edit in <b>this</b> browser, start the helper: double-click <code>start.cmd</code>. (Chrome/Edge can also open <code>editor.html</code> directly.)", true);
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!els.save.disabled) saveAll();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (session && session.globalDirty()) { e.preventDefault(); e.returnValue = ""; }
  });
  installDragAndDrop();

  if (/[?&]test=1/.test(location.search)) installTestApi();
}

// ---- Tauri: single "Open" button with folder / file sub-menu ----
function buildOpenMenu() {
  const menu = h("div", { class: "open-menu" });
  const btn = h("button", { class: "btn go open-menu-trigger", onclick: (e) => { e.stopPropagation(); menu.classList.toggle("open"); } }, "Open ▾");
  const list = h("div", { class: "open-menu-list" },
    h("button", { class: "btn ghost open-menu-item", onclick: () => { menu.classList.remove("open"); openFolder(); } }, "📁 Open site folder"),
    h("button", { class: "btn ghost open-menu-item", onclick: () => { menu.classList.remove("open"); openFile(); } }, "📄 Open HTML file"));
  menu.append(btn, list);
  document.addEventListener("click", () => menu.classList.remove("open"));
  return menu;
}

function buildWelcome() {
  const openActions = isTauri
    ? h("div", { class: "welcome-actions" },
        h("button", { class: "btn primary big", onclick: openFolder }, "📁 Open site folder"),
        h("button", { class: "btn ghost big", onclick: openFile }, "📄 Open HTML file"))
    : h("button", { class: "btn primary big", onclick: openFolder }, "Open site folder");

  return h("div", { class: "welcome", id: "welcome" },
    h("div", { class: "welcome-card" },
      h("h1", {}, "Edit your website"),
      h("p", {}, "Open your site folder or a single HTML file, click any text to edit it, swap images, and follow links to edit other pages — then Save All writes everything back."),
      h("ol", {},
        h("li", { html: isTauri ? "Click <b>Open site folder</b> (or drag a folder / .html file onto the window)." : "Click <b>Open site folder</b> and choose the folder that holds your pages (e.g. <code>index.html</code>). Click <b>Allow</b>." }),
        h("li", { html: "Click text to edit · <b>Ctrl/Cmd+B/I</b> for bold/italic · click an image to replace it · drag an image file onto an image slot." }),
        h("li", { html: "Click a link to open and edit that page · use the <b>Pages</b> menu to jump to any page · <b>Alt-click</b> a link to change where it points." }),
        h("li", { html: "Click <b>Save All</b> (or <b>Ctrl/Cmd+S</b>). Only the bits you changed are written." })),
      isTauri ? null : h("p", { class: "hint", html: "In <b>Chrome/Edge</b> open this file directly. In <b>any</b> browser (Firefox, Safari, Brave…), start the helper with <code>start.cmd</code>." }),
      openActions));
}

// ---- server mode ----
async function bootServerMode() {
  els.pill.textContent = "Helper connected";
  els.pill.className = "pill ok";
  if (!isTauri) els.open.textContent = "Choose a site";
  const site = siteFromQuery();
  if (site) { await startSession(createServerFs(site), site); return; }
  await showSitePicker();
}

async function showSitePicker() {
  let data;
  try { data = await fetchSites(); }
  catch { showToast("Can't reach the local helper — is <code>start.cmd</code> running?", true); return; }
  if (currentRevoke) { currentRevoke(); currentRevoke = null; }
  els.frame.classList.remove("ready");
  els.welcome.style.display = "grid";
  const card = els.welcome.querySelector(".welcome-card");
  card.innerHTML = "";
  card.append(h("h1", {}, "Pick a site to edit"));
  if (!data.sites.length) {
    card.append(h("p", { html: `No site folders found under <code>${escapeHtml(data.base)}</code>.` }));
    return;
  }
  card.append(h("p", { class: "hint", html: `Folders under <b>${escapeHtml(data.base)}</b> — or drag one onto this window.` }));
  const list = h("div", { class: "site-list" });
  for (const s of data.sites) {
    list.append(h("button", { class: "btn go site-btn", onclick: () => startSession(createServerFs(s), s) }, s));
  }
  card.append(list);
}

// Wrap a single FileSystemFileHandle as a minimal fs (Chromium drag of a .html file).
function createSingleFileFs(fileHandle) {
  const name = fileHandle.name;
  return {
    rootHandle: {
      name,
      async *values() { yield { kind: "file", name }; },
    },
    async readText() { return (await fileHandle.getFile()).text(); },
    async readBytes() { return fileHandle.getFile(); },
    async writeText(p, t) {
      const w = await fileHandle.createWritable();
      await w.write(t); await w.close();
    },
    async writeBytes(p, b) {
      const w = await fileHandle.createWritable();
      await w.write(b instanceof Blob ? b : new Blob([b])); await w.close();
    },
    async exists(p) { return p === name; },
    async uniqueName(dir, base) { return base; },
  };
}

// ---- open ----
async function openFolder() {
  if (isTauri) {
    const tFs = await pickTauriFolder();
    if (!tFs) return;
    await startSession(tFs, tFs.rootHandle.name);
    return;
  }
  if (inServerMode()) return showSitePicker();
  if (!supported()) {
    showToast("This browser can't save files directly. Start the helper — double-click <code>start.cmd</code> — and use the link it opens.", true);
    return;
  }
  try {
    rootHandle = await pickRoot();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    showToast("Couldn't open the folder: " + (err && err.message), true);
    return;
  }
  await startSession(createFs(rootHandle), rootHandle.name);
}

// Open a single .html file (Tauri only): root the fs at the file's folder so CSS/images resolve.
async function openFile() {
  const filePath = await pickTauriFile();
  if (!filePath) return;
  await openTauriHtmlFile(filePath);
}

function splitPath(p) {
  const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const folder = p.slice(0, p.length - name.length).replace(/[\\/]+$/, "");
  return [folder, name];
}

async function openTauriHtmlFile(filePath) {
  const [folder, name] = splitPath(filePath);
  await startSession(createTauriFs(folder), name, name);
}

async function startSession(theFs, name, startPage) {
  fs = theFs;
  session = createSession(fs);
  navStack.length = 0;
  const start = startPage || await findStartPage(fs);
  if (!start) {
    showToast("That folder has no <code>.html</code> pages. Pick the folder that holds your website.", true);
    return null;
  }
  els.pill.textContent = "Editing: " + name;
  els.pill.className = "pill ok";
  els.home.hidden = false;
  await loadPage(start, false);
  await refreshPagesMenu();
  showToast("Opened <b>" + escapeHtml(name) + "</b>. Edit text, swap images, follow links, then Save All.");
  return start;
}

async function findStartPage(theFs) {
  const htmls = [];
  for await (const entry of theFs.rootHandle.values()) {
    if (entry.kind === "file" && /\.html?$/i.test(entry.name)) htmls.push(entry.name);
  }
  if (htmls.includes("index.html")) return "index.html";
  if (htmls.includes("index.htm")) return "index.htm";
  htmls.sort();
  return htmls[0] || null;
}

// Collect all HTML files in the fs root and rebuild the Pages dropdown.
async function refreshPagesMenu() {
  const htmls = [];
  try {
    for await (const entry of fs.rootHandle.values()) {
      if (entry.kind === "file" && /\.html?$/i.test(entry.name)) htmls.push(entry.name);
    }
  } catch { return; }
  htmls.sort();
  if (htmls.length < 2) { els.pages.hidden = true; return; }

  els.pages.innerHTML = "";
  const btn = h("button", {
    class: "btn ghost pages-trigger",
    onclick: (e) => { e.stopPropagation(); els.pages.classList.toggle("open"); },
  }, "Pages ▾");

  const list = h("div", { class: "pages-list" },
    ...htmls.map((name) =>
      h("button", {
        class: "btn ghost pages-item" + (name === currentPath ? " active" : ""),
        onclick: () => { els.pages.classList.remove("open"); loadPage(name, false); },
      }, name)));

  els.pages.append(btn, list);
  els.pages.hidden = false;
}

// Update the active page highlight in the Pages dropdown.
function updatePagesActive() {
  for (const item of els.pages.querySelectorAll(".pages-item")) {
    item.classList.toggle("active", item.textContent === currentPath);
  }
}

function closeSession() {
  if (session && session.globalDirty()) {
    if (!confirm("You have unsaved changes. Close anyway?")) return;
  }
  fs = null; session = null; currentPath = null; currentEditor = null;
  navStack.length = 0;
  if (currentRevoke) { currentRevoke(); currentRevoke = null; }
  els.frame.classList.remove("ready");
  els.frame.srcdoc = "";
  els.welcome.style.display = "grid";
  els.home.hidden = true;
  els.pages.hidden = true;
  els.pages.innerHTML = "";
  updateChrome();
}

// ---- load a page ----
async function loadPage(path, isBack) {
  let text;
  try {
    text = await fs.readText(path);
  } catch (err) {
    showToast("Couldn't open <code>" + escapeHtml(path) + "</code>: " + (err && err.message), true);
    return;
  }

  const cleanDoc = new DOMParser().parseFromString(text, "text/html");
  const page = session.ensure(path, text);
  stampEditIds(cleanDoc, path, page.imgSrcByEditId);

  if (currentRevoke) { currentRevoke(); currentRevoke = null; }
  const preview = await buildPreview(fs, path, cleanDoc);
  currentRevoke = preview.revoke;

  await new Promise((resolve) => {
    els.frame.onload = () => { els.frame.onload = null; resolve(); };
    els.frame.srcdoc = preview.html;
  });

  const idoc = els.frame.contentDocument;
  currentEditor = wireEditor(idoc, {
    onDirty: updateChrome,
    onEdit: (rec) => session.recordEdit(path, rec),
    onNavigate: (href) => navigate(path, href),
    onEditLink: ({ href, commit }) => {
      const next = window.prompt("Where should this link point?", href || "");
      if (next != null) commit(next);
    },
  });
  reapplyEdits(idoc, page);

  currentPath = path;
  if (!isBack) navStack.push(path);
  els.welcome.style.display = "none";
  els.frame.classList.add("ready");
  updateChrome();
  updatePagesActive();
}

function stampEditIds(rootDoc, pagePath, imgMap) {
  let id = 0;
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        c.setAttribute("data-edit-id", String(id));
        if (c.tagName === "IMG") {
          const src = c.getAttribute("src") || "";
          c.setAttribute("data-original-src", src);
          const r = resolvePath(pagePath, src);
          if (r && r.path) imgMap.set(id, r.path);
        }
        id++;
      }
      walk(c);
    }
  })(rootDoc);
}

function reapplyEdits(idoc, page) {
  for (const rec of page.edits.values()) {
    const el = idoc.querySelector(`[data-edit-id="${rec.editId}"]`);
    if (!el) continue;
    if (rec.kind === "text") el.innerHTML = rec.replacement;
    else if (rec.kind === "attr") el.setAttribute(rec.attrName, rec.value);
  }
  for (const [editId, img] of page.replacedImages) {
    const el = idoc.querySelector(`img[data-edit-id="${editId}"]`);
    if (el) el.setAttribute("src", URL.createObjectURL(img.file));
  }
}

// ---- navigation ----
function navigate(fromPath, href) {
  const r = resolvePath(fromPath, href);
  if (!r) {
    showToast("That link goes outside the open folder. To edit it too, open the parent folder instead.", true);
    return;
  }
  if (r.external) {
    showToast("That's an external link. Opening it in a new tab — it isn't part of this site.");
    window.open(href, "_blank", "noopener");
    return;
  }
  if (!isHtml(r.path)) { showToast("That link doesn't point to an editable page.", true); return; }
  loadPage(r.path, false);
}

function goBack() {
  if (navStack.length < 2) return;
  navStack.pop();
  const prev = navStack[navStack.length - 1];
  loadPage(prev, true);
}

// ---- save / discard ----
async function saveAll() {
  els.save.disabled = true;
  let result;
  try {
    result = await session.saveAll();
  } catch (err) {
    showToast("Save failed: " + (err && err.message) + ". Try Open again, or check the helper is running.", true);
    updateChrome();
    return null;
  }
  const parts = [];
  if (result.savedPages.length) parts.push(result.savedPages.length + " page" + (result.savedPages.length > 1 ? "s" : ""));
  if (result.savedImages.length) parts.push(result.savedImages.length + " image" + (result.savedImages.length > 1 ? "s" : ""));
  if (parts.length) showToast("Saved " + parts.join(" and ") + " to your folder.");
  else showToast("Nothing to save.");
  if (result.skipped.length) {
    const lines = result.skipped.map((s) => "• " + escapeHtml(s.path || "") + " (#" + s.editId + "): " + escapeHtml(s.reason)).join("<br>");
    showToast("Some edits were skipped to protect your files:<br>" + lines, true);
  }
  updateChrome();
  return result;
}

function discardCurrent() {
  if (!session || !currentPath) return;
  session.discard(currentPath);
  loadPage(currentPath, true);
  showToast("Reverted this page to its last saved version.");
}

// ---- drag and drop ----
function installDragAndDrop() {
  const overlay = h("div", { class: "drop-overlay", id: "dropOverlay" }, "Drop a site folder, .html file, or image onto an image slot");
  document.body.append(overlay);

  if (isTauri) {
    window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(async (event) => {
      const type = event.payload.type;
      if (type === "hover") { overlay.classList.add("show"); return; }
      if (type === "leave" || type === "cancelled") { overlay.classList.remove("show"); return; }
      if (type !== "drop") return;
      overlay.classList.remove("show");
      const paths = event.payload.paths;
      if (!paths || !paths.length) return;
      const p = paths[0];
      const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

      if (IMAGE_EXTS.test(name)) {
        await handleTauriImageDrop(p, name, event.payload.position);
        return;
      }
      if (/\.html?$/i.test(name)) {
        await openTauriHtmlFile(p);
      } else {
        await startSession(createTauriFs(p), name);
      }
    });
    return;
  }

  // Browser (non-Tauri) drag-and-drop handlers below.
  let sitesCache = null;
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; overlay.classList.add("show"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--depth <= 0) overlay.classList.remove("show"); });
  window.addEventListener("drop", async (e) => {
    e.preventDefault(); depth = 0; overlay.classList.remove("show");
    const item = e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items[0];
    if (!item) return;

    if (typeof item.getAsFileSystemHandle === "function") {
      let handle = null;
      try { handle = await item.getAsFileSystemHandle(); } catch {}
      if (handle && handle.kind === "directory") {
        if (handle.requestPermission) { try { await handle.requestPermission({ mode: "readwrite" }); } catch {} }
        await startSession(createFs(handle), handle.name);
        return;
      }
      if (handle && handle.kind === "file") {
        if (!/\.html?$/i.test(handle.name)) {
          showToast("Drop an <b>.html</b> file or a site folder.", true); return;
        }
        if (handle.requestPermission) { try { await handle.requestPermission({ mode: "readwrite" }); } catch {} }
        await startSession(createSingleFileFs(handle), handle.name);
        return;
      }
    }

    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      if (!inServerMode()) {
        showToast("Folder drag works in <b>Chrome/Edge</b>. In other browsers, start the helper (<code>start.cmd</code>) and pick a site from the list.", true);
        return;
      }
      try {
        if (!sitesCache) sitesCache = (await fetchSites()).sites;
        const match = matchSite(entry.name, sitesCache);
        if (match) { await startSession(createServerFs(match), match); return; }
      } catch {}
      showToast("Couldn't find <b>" + escapeHtml(entry.name) + "</b> under the helper's folder. Move it there, or pick it from the list.", true);
      return;
    }
    if (entry && entry.isFile) {
      showToast(inServerMode()
        ? "Single-file drag needs <b>Chrome/Edge</b>. In Firefox, pick a site from the list instead."
        : "File drag works in <b>Chrome/Edge</b>. Open <code>editor.html</code> in Chrome/Edge to drag files.", true);
      return;
    }
    showToast("Drop a site folder or <code>.html</code> file. (Chrome/Edge: any folder; Firefox/Brave: use the helper and pick from the list.)", true);
  });
}

// Route a Tauri image drop to the img element under the cursor, read bytes, apply.
async function handleTauriImageDrop(filePath, fileName, position) {
  if (!currentEditor || !els.frame.contentDocument) {
    showToast("Open a site first, then drop images onto an image slot.", true);
    return;
  }
  const iframeRect = els.frame.getBoundingClientRect();
  const x = (position ? position.x : 0) - iframeRect.left;
  const y = (position ? position.y : 0) - iframeRect.top;
  const el = els.frame.contentDocument.elementFromPoint(x, y);
  const img = el && el.closest("img[data-edit-id]");
  if (!img) {
    showToast("Drop the image directly onto an image slot in the page.", true);
    return;
  }
  try {
    const bytes = await window.__TAURI__.core.invoke("read_bytes", { path: filePath });
    const ext = fileName.split(".").pop().toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/*";
    const file = new File([new Uint8Array(bytes)], fileName, { type: mime });
    currentEditor.applyImageAt(img, file);
  } catch (err) {
    showToast("Couldn't read the image: " + (err && err.message), true);
  }
}

// ---- chrome state ----
function updateChrome() {
  const dirty = session && session.globalDirty();
  els.save.disabled = !dirty;
  document.getElementById("dot").hidden = !dirty;
  els.discard.disabled = !(session && currentPath && session.pages.get(currentPath) && session.pages.get(currentPath).dirty);
  els.back.disabled = navStack.length < 2;
  els.crumb.textContent = currentPath ? currentPath : "";
  const n = session ? session.dirtyPaths().length : 0;
  els.crumb.title = n ? n + " page(s) with unsaved changes" : "";
}

// ---- toast ----
function showToast(html, isErr) {
  els.toast.innerHTML = html;
  els.toast.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.className = "toast"; }, isErr ? 9000 : 4500);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- test harness (only with ?test=1) ----
function makeMemoryFs(files, name) {
  const map = new Map(Object.entries(files));
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const toBytes = (v) => (typeof v === "string" ? enc.encode(v) : v);
  const api = {
    rootHandle: {
      name,
      async *values() {
        for (const key of map.keys()) {
          if (!key.includes("/")) yield { kind: "file", name: key };
        }
      },
    },
    async readText(p) { const v = map.get(p); return typeof v === "string" ? v : dec.decode(v); },
    async readBytes(p) { return new Blob([toBytes(map.get(p))]); },
    async writeText(p, t) { map.set(p, t); },
    async writeBytes(p, blob) { map.set(p, new Uint8Array(await blob.arrayBuffer())); },
    async exists(p) { return map.has(p); },
    async uniqueName(dir, base) {
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let nm = base, i = 0;
      while (map.has((dir ? dir + "/" : "") + nm)) { i++; nm = `${stem}-${i}${ext}`; }
      return nm;
    },
    _map: map,
  };
  return api;
}

function installTestApi() {
  window.EDITOR_TEST = {
    async open(files) {
      const memFs = makeMemoryFs(files, "test-site");
      window.EDITOR_TEST._fs = memFs;
      await startSession(memFs, "test-site");
      return currentPath;
    },
    async getText(p) { return window.EDITOR_TEST._fs.readText(p); },
    current() { return currentPath; },
    idoc() { return els.frame.contentDocument; },
    editText(editId, html) {
      const el = els.frame.contentDocument.querySelector(`[data-edit-id="${editId}"]`);
      el.innerHTML = html;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    clickLink(editId, alt) {
      const el = els.frame.contentDocument.querySelector(`a[data-edit-id="${editId}"]`);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: !!alt }));
    },
    async replaceImage(editId, b64, fname) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fname, { type: "image/png" });
      const img = els.frame.contentDocument.querySelector(`img[data-edit-id="${editId}"]`);
      session.recordEdit(currentPath, { editId, kind: "image", file, originalSrc: img ? img.getAttribute("data-original-src") : "" });
      if (img) img.setAttribute("src", URL.createObjectURL(file));
      updateChrome();
    },
    async save() { return saveAll(); },
    dirty() { return session ? session.globalDirty() : false; },
  };
}
