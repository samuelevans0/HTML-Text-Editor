// In-iframe editing layer. The preview iframe is same-origin (srcdoc), so the host
// calls wireEditor() directly with the iframe's document. It marks text editable,
// wires image replacement and link handling, and reports edits to the host by
// data-edit-id. It never writes files — it only emits edit records.
import { collectEditables, SINGLE_LINE_TAGS } from "./editable.js";
import { sanitizeInner } from "./sanitize.js";

const EDITOR_CSS = `
[data-edit-id][contenteditable]{outline:2px dashed rgba(59,130,246,0);outline-offset:3px;border-radius:3px;cursor:text;transition:outline-color .12s,background .12s;}
[data-edit-id][contenteditable]:hover{outline-color:rgba(59,130,246,.55);background:rgba(59,130,246,.06);}
[data-edit-id][contenteditable]:focus{outline:2px solid #3b82f6;background:rgba(59,130,246,.10);}
img[data-edit-id]{cursor:copy;}
img[data-edit-id]:hover{outline:3px solid #3b82f6;outline-offset:-3px;}
img[data-crop-active]{cursor:grab;outline:2px solid #3b82f6;outline-offset:-2px;}
img[data-crop-active]:active{cursor:grabbing;}
.__crop-hint{position:fixed;bottom:.9rem;left:50%;transform:translateX(-50%);background:rgba(15,17,21,.88);color:#e7e9ee;font:600 .78rem/-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:.45rem .9rem;border-radius:8px;pointer-events:none;white-space:nowrap;z-index:9999;border:1px solid rgba(255,255,255,.12);}
.__resize-handle{position:absolute;width:14px;height:14px;background:#fff;border:2px solid #3b82f6;border-radius:3px;cursor:se-resize;z-index:9999;box-shadow:0 1px 4px rgba(0,0,0,.3);}
a[href]{cursor:alias;}
`;

export function wireEditor(doc, cb) {
  const origText = new Map(); // editId -> original textContent (identity check value)

  const style = doc.createElement("style");
  style.textContent = EDITOR_CSS;
  doc.head.appendChild(style);
  try { doc.execCommand("styleWithCSS", false, false); } catch {}

  // Editable text blocks.
  for (const el of collectEditables(doc)) {
    if (!el.hasAttribute("data-edit-id")) continue;
    const editId = Number(el.getAttribute("data-edit-id"));
    origText.set(editId, el.textContent);
    const single = SINGLE_LINE_TAGS.has(el.tagName);
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!single) doc.execCommand("insertLineBreak");
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData || (doc.defaultView && doc.defaultView.clipboardData);
      const t = cd ? cd.getData("text/plain") : "";
      doc.execCommand("insertText", false, t.replace(/\r?\n/g, " "));
    });
    el.addEventListener("input", () => {
      cb.onDirty();
      cb.onEdit({ editId, kind: "text", originalContent: origText.get(editId), replacement: sanitizeInner(el) });
    });
  }

  // Capture original text for every link too (href edits need the identity value).
  for (const a of doc.querySelectorAll("a[data-edit-id]")) {
    const editId = Number(a.getAttribute("data-edit-id"));
    if (!origText.has(editId)) origText.set(editId, a.textContent);
  }

  // Image replacement: click or drop a file.
  for (const img of doc.querySelectorAll("img[data-edit-id]")) {
    img.addEventListener("click", (e) => { e.preventDefault(); chooseImage(img, cb); });
  }
  doc.addEventListener("dragover", (e) => {
    if (e.target.closest && e.target.closest("img[data-edit-id]")) e.preventDefault();
  });
  doc.addEventListener("drop", (e) => {
    const img = e.target.closest && e.target.closest("img[data-edit-id]");
    if (!img) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) applyImage(img, f, cb);
  });

  // Links: plain click navigates; Alt-click edits the destination URL.
  doc.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (e.altKey) {
      cb.onEditLink({ href, commit: (next) => commitHref(a, next, doc, cb, origText) });
    } else {
      cb.onNavigate(href);
    }
  }, true);

  // Bold / italic shortcuts.
  doc.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); doc.execCommand("bold"); }
      if (k === "i") { e.preventDefault(); doc.execCommand("italic"); }
    }
  });

  // Re-capture the identity snapshot from the live DOM. Call after a successful
  // save so the just-saved content becomes the new baseline. Without this, the
  // snapshot keeps the pre-edit text and re-editing the same element in one
  // session fails the identity check with a false "content drift".
  function resyncIdentity() {
    origText.clear();
    for (const el of collectEditables(doc)) {
      if (!el.hasAttribute("data-edit-id")) continue;
      origText.set(Number(el.getAttribute("data-edit-id")), el.textContent);
    }
    for (const a of doc.querySelectorAll("a[data-edit-id]")) {
      const editId = Number(a.getAttribute("data-edit-id"));
      if (!origText.has(editId)) origText.set(editId, a.textContent);
    }
  }

  return {
    revoke() { style.remove(); },
    // Apply an image file to a specific img element (used by Tauri drag-drop handler).
    applyImageAt(img, file) { applyImage(img, file, cb); },
    // Re-baseline the identity snapshot after a save (see resyncIdentity above).
    resyncIdentity,
  };
}

function chooseImage(img, cb) {
  const doc = img.ownerDocument;
  const inp = doc.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = () => { const f = inp.files[0]; if (f) applyImage(img, f, cb); };
  inp.click();
}

// Merge CSS property updates into an existing inline style string, preserving other props.
function mergeStyle(existing, updates) {
  const props = Object.create(null);
  for (const decl of (existing || "").split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const k = decl.slice(0, colon).trim();
    const v = decl.slice(colon + 1).trim();
    if (k) props[k] = v;
  }
  for (const [k, v] of Object.entries(updates)) props[k] = v;
  return Object.entries(props).map(([k, v]) => `${k}:${v}`).join(";");
}

function applyImage(img, file, cb) {
  const editId = Number(img.getAttribute("data-edit-id"));
  const u = URL.createObjectURL(file);
  img.setAttribute("src", u);

  // Apply object-fit cover with the original inline styles preserved.
  const origStyle = img.getAttribute("style") || "";
  const newStyle = mergeStyle(origStyle, { "object-fit": "cover", "object-position": "50% 50%" });
  img.setAttribute("style", newStyle);

  cb.onDirty();
  cb.onEdit({ editId, kind: "image", file, originalSrc: img.getAttribute("data-original-src") || "" });
  cb.onEdit({ editId, kind: "attr", attrName: "style", originalContent: "", value: newStyle });

  enterCropMode(img, editId, origStyle, cb);
}

// Interactive crop adjustment: drag the replaced image to pan object-position.
// Also adds a resize handle in the bottom-right corner.
function enterCropMode(img, editId, origStyle, cb) {
  // Mark for CSS
  img.dataset.cropActive = "1";
  const doc = img.ownerDocument;

  // Show a brief hint
  const hint = doc.createElement("div");
  hint.className = "__crop-hint";
  hint.textContent = "Drag to adjust crop • Drag corner to resize";
  doc.body.appendChild(hint);
  setTimeout(() => hint.remove(), 3500);

  // Build resize handle
  const handle = doc.createElement("div");
  handle.className = "__resize-handle";
  doc.body.appendChild(handle);

  function positionHandle() {
    const r = img.getBoundingClientRect();
    const win = doc.defaultView;
    handle.style.left = (r.right + win.scrollX - 8) + "px";
    handle.style.top = (r.bottom + win.scrollY - 8) + "px";
  }

  positionHandle();
  const win = doc.defaultView;
  win.addEventListener("scroll", positionHandle);
  win.addEventListener("resize", positionHandle);

  // Resize via handle drag
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sw = img.offsetWidth, sh = img.offsetHeight;
    const onMove = (e) => {
      img.setAttribute("width", Math.max(20, Math.round(sw + e.clientX - sx)));
      img.setAttribute("height", Math.max(20, Math.round(sh + e.clientY - sy)));
      positionHandle();
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      const w = img.getAttribute("width");
      const h = img.getAttribute("height");
      if (w) cb.onEdit({ editId, kind: "attr", attrName: "width", originalContent: "", value: w });
      if (h) cb.onEdit({ editId, kind: "attr", attrName: "height", originalContent: "", value: h });
    };
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
  });

  // Crop pan via drag on the image itself
  let dragging = false, sx = 0, sy = 0, ox = 50, oy = 50;

  function parsePos(s) {
    const m = (s || "50% 50%").match(/([\d.]+)%\s+([\d.]+)%/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
  }

  img.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    [ox, oy] = parsePos(img.style.objectPosition);
    img.style.cursor = "grabbing";
  });

  doc.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = img.getBoundingClientRect();
    const nx = Math.max(0, Math.min(100, ox - (e.clientX - sx) / rect.width * 100));
    const ny = Math.max(0, Math.min(100, oy - (e.clientY - sy) / rect.height * 100));
    img.style.objectPosition = `${nx.toFixed(1)}% ${ny.toFixed(1)}%`;
  });

  doc.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    img.style.cursor = "";
    const pos = img.style.objectPosition || "50% 50%";
    const [nx, ny] = parsePos(pos);
    const updated = mergeStyle(origStyle, { "object-fit": "cover", "object-position": `${nx.toFixed(1)}% ${ny.toFixed(1)}%` });
    img.setAttribute("style", updated);
    cb.onEdit({ editId, kind: "attr", attrName: "style", originalContent: "", value: updated });
    positionHandle();
  });
}

function commitHref(a, next, doc, cb, origText) {
  const current = a.getAttribute("href") || "";
  if (next == null || next === current) return;
  a.setAttribute("href", next);
  cb.onDirty();
  const block = a.closest("[contenteditable]");
  if (block && block !== a) {
    // Link nested in an editable block: the block's text edit captures the new href.
    const bid = Number(block.getAttribute("data-edit-id"));
    cb.onEdit({ editId: bid, kind: "text", originalContent: origText.get(bid), replacement: sanitizeInner(block) });
  } else {
    // Standalone link: href lives in the start tag -> attribute edit.
    const aid = Number(a.getAttribute("data-edit-id"));
    const oc = origText.has(aid) ? origText.get(aid) : a.textContent;
    cb.onEdit({ editId: aid, kind: "attr", attrName: "href", originalContent: oc, value: next });
  }
}
