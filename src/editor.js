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
    img.addEventListener("click", (e) => { e.preventDefault(); chooseImage(img, doc, cb); });
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

  return { revoke() { style.remove(); } };
}

function chooseImage(img, doc, cb) {
  const inp = doc.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = () => { const f = inp.files[0]; if (f) applyImage(img, f, cb); };
  inp.click();
}

function applyImage(img, file, cb) {
  const u = URL.createObjectURL(file);
  img.setAttribute("src", u); // preview only; saved bytes come from the File
  cb.onDirty();
  cb.onEdit({
    editId: Number(img.getAttribute("data-edit-id")),
    kind: "image",
    file,
    originalSrc: img.getAttribute("data-original-src") || "",
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
