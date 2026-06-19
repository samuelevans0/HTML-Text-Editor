// Minimal-diff engine. Pure string-in / string-out (no DOM, no browser).
// Uses parse5 (the WHATWG parser browsers/jsdom use) so source offsets line up
// with the live DOM the user edits, including implied <tbody>, optional </li>, etc.
import { parse } from "parse5";

export function isElement(node) {
  return node && typeof node.tagName === "string";
}

// The element's original text content (concatenation of descendant #text values).
export function nodeText(node) {
  let out = "";
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeName === "#text") out += c.value;
      else walk(c);
    }
  })(node);
  return out;
}

// Parse with source locations and stamp each element (preorder) with an integer editId.
export function parseSource(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const byEditId = new Map();
  let id = 0;
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (isElement(c)) {
        c._editId = id;
        byEditId.set(id, c);
        id++;
      }
      walk(c);
    }
  })(document);
  return { document, byEditId };
}

// [start, end) of an element's inner content, or null for void/self-closing.
export function innerRange(node) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.startTag) return null;
  const start = loc.startTag.endOffset;
  const end = loc.endTag ? loc.endTag.startOffset : loc.endOffset;
  return [start, end];
}

// [start, end) of a whole attribute token (e.g. `href="x"`), or null.
export function attrToken(node, name) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.attrs) return null;
  const a = loc.attrs[name.toLowerCase()];
  if (!a) return null;
  return [a.startOffset, a.endOffset];
}

// Apply non-overlapping splices to text, right-to-left so offsets stay valid.
export function applySplices(text, splices) {
  const sorted = [...splices].sort((a, b) => b.range[0] - a.range[0]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].range; // larger start
    const cur = sorted[i].range;
    if (cur[1] > prev[0]) throw new Error("overlapping splices");
  }
  let out = text;
  for (const { range, replacement } of sorted) {
    out = out.slice(0, range[0]) + replacement + out.slice(range[1]);
  }
  return out;
}

// Preorder tagName list — text/attr edits never change which elements exist.
export function elementTagSequence(html) {
  const { byEditId } = parseSource(html);
  return [...byEditId.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n.tagName);
}

export function sanityCheck(originalHtml, newHtml) {
  const a = elementTagSequence(originalHtml);
  const b = elementTagSequence(newHtml);
  if (a.length !== b.length) {
    return { ok: false, reason: `element count changed ${a.length} -> ${b.length}` };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { ok: false, reason: `element ${i} changed ${a[i]} -> ${b[i]}` };
  }
  return { ok: true };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Public API: produce minimally-patched HTML from a list of edit records.
// Each edit: { editId, kind:"text"|"attr", originalContent, ... }
//   text: { replacement }   attr: { attrName, value }
// Returns { newHtml, applied:number[], skipped:[{editId,reason}] }.
export function buildSave(originalHtml, edits) {
  const { byEditId } = parseSource(originalHtml);
  const splices = [];
  const applied = [];
  const skipped = [];

  for (const edit of edits) {
    const node = byEditId.get(edit.editId);
    if (!node) { skipped.push({ editId: edit.editId, reason: "element not found" }); continue; }
    if (nodeText(node) !== edit.originalContent) {
      skipped.push({ editId: edit.editId, reason: "content drift (identity check failed)" });
      continue;
    }
    if (edit.kind === "text") {
      const range = innerRange(node);
      if (!range) { skipped.push({ editId: edit.editId, reason: "no inner range" }); continue; }
      if (originalHtml.slice(range[0], range[1]) === edit.replacement) continue; // no-op
      splices.push({ range, replacement: edit.replacement });
      applied.push(edit.editId);
    } else if (edit.kind === "attr") {
      const range = attrToken(node, edit.attrName);
      if (!range) { skipped.push({ editId: edit.editId, reason: "attribute not found" }); continue; }
      const replacement = `${edit.attrName}="${escapeAttr(edit.value)}"`;
      if (originalHtml.slice(range[0], range[1]) === replacement) continue; // no-op
      splices.push({ range, replacement });
      applied.push(edit.editId);
    } else {
      skipped.push({ editId: edit.editId, reason: "unknown edit kind" });
    }
  }

  let newHtml;
  try {
    newHtml = applySplices(originalHtml, splices);
  } catch (e) {
    return { newHtml: originalHtml, applied: [], skipped: [{ editId: -1, reason: e.message }] };
  }
  const sane = sanityCheck(originalHtml, newHtml);
  if (!sane.ok) {
    return { newHtml: originalHtml, applied: [], skipped: [{ editId: -1, reason: "sanity: " + sane.reason }] };
  }
  return { newHtml, applied, skipped };
}
