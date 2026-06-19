// App shell: chrome, folder open, page load/navigate, and Save All orchestration.
import { supported, pickRoot, createFs } from "./fsAccess.js";
import { createSession } from "./pages.js";
import { buildPreview } from "./assets.js";
import { wireEditor } from "./editor.js";
import { resolvePath, isHtml } from "./paths.js";

let fs = null;
let session = null;
let rootHandle = null;
let currentPath = null;
let currentRevoke = null;
const navStack = [];

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
  els.back = h("button", { class: "btn ghost", id: "back", title: "Back", disabled: "", onclick: goBack }, "‹ Back");
  els.crumb = h("span", { class: "crumb", id: "crumb" }, "");
  els.hint = h("span", { class: "hint" }, "Click a link to open & edit it · Alt-click a link to change its address");
  els.open = h("button", { class: "btn go", onclick: openFolder }, "Open site folder");
  els.discard = h("button", { class: "btn ghost", disabled: "", onclick: discardCurrent }, "Discard page");
  els.save = h("button", { class: "btn primary", id: "save", disabled: "", onclick: saveAll },
    "Save All ", h("span", { class: "dot", id: "dot", hidden: "" }, "●"));

  els.bar = h("div", { class: "topbar" },
    h("div", { class: "brand" }, h("b", {}, "HTML Site Editor"), h("small", {}, "edit any static site")),
    els.pill, els.back, els.crumb,
    h("span", { class: "spacer" }), els.hint,
    els.open, els.discard, els.save);

  els.frame = h("iframe", { id: "frame", title: "Page preview" });
  els.welcome = buildWelcome();
  els.stage = h("div", { class: "stage" }, els.frame, els.welcome);
  els.toast = h("div", { class: "toast", id: "toast" });

  app.append(els.bar, els.stage, els.toast);

  if (!supported()) {
    els.open.disabled = true;
    els.pill.textContent = "Unsupported browser";
    els.pill.className = "pill warn";
    showToast("This tool needs the File System Access API — please open it in <b>Chrome</b> or <b>Edge</b>.", true);
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
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  if (/[?&]test=1/.test(location.search)) installTestApi();
}

function buildWelcome() {
  return h("div", { class: "welcome", id: "welcome" },
    h("div", { class: "welcome-card" },
      h("h1", {}, "Edit your website"),
      h("p", {}, "Open your site folder, click any text to edit it, swap images, and follow links to edit other pages — then Save All writes everything back to the real files."),
      h("ol", {},
        h("li", { html: "Click <b>Open site folder</b> and choose the folder that holds your pages (e.g. <code>index.html</code>). Click <b>Allow</b>." }),
        h("li", { html: "Click text to edit · <b>Ctrl/Cmd+B/I</b> for bold/italic · click an image to replace it." }),
        h("li", { html: "Click a link to open and edit that page · <b>Alt-click</b> a link to change where it points." }),
        h("li", { html: "Click <b>Save All</b> (or <b>Ctrl/Cmd+S</b>). Only the bits you changed are written." })),
      h("p", { class: "hint", html: "Works in <b>Chrome</b> or <b>Edge</b>. Your files are read and written directly on your computer — nothing is uploaded." }),
      h("button", { class: "btn primary big", onclick: openFolder }, "Open site folder")));
}

// ---- open ----
async function openFolder() {
  try {
    rootHandle = await pickRoot();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    showToast("Couldn't open the folder: " + (err && err.message), true);
    return;
  }
  await startSession(createFs(rootHandle), rootHandle.name);
}

async function startSession(theFs, name) {
  fs = theFs;
  session = createSession(fs);
  navStack.length = 0;
  const start = await findStartPage(fs);
  if (!start) {
    showToast("That folder has no <code>.html</code> pages. Pick the folder that holds your website.", true);
    return null;
  }
  els.pill.textContent = "Editing: " + name;
  els.pill.className = "pill ok";
  await loadPage(start, false);
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
  wireEditor(idoc, {
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
  if (!r) { showToast("Can't open that link here.", true); return; }
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
  navStack.pop();                       // drop current
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
    showToast("Save failed: " + (err && err.message) + ". Try Open again and click Allow.", true);
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

// ---- test harness (only with ?test=1): in-memory fs so a headless browser can
// drive the real load/edit/navigate/save code path without the native picker. ----
function makeMemoryFs(files, name) {
  const map = new Map(Object.entries(files)); // path -> string | Uint8Array
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
