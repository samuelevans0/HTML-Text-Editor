// Generic detection of "editable text" — works on any site without a per-site
// whitelist. An editable text block is a leaf-ish element that directly contains
// text and whose element children are all inline formatting (not block containers).
export const INLINE_TAGS = new Set(
  "A B I EM STRONG SPAN SMALL SUP SUB U MARK BR ABBR CODE TIME WBR".split(" "));
export const SKIP_ANCESTORS = new Set(
  "SCRIPT STYLE HEAD SVG NOSCRIPT TEMPLATE TEXTAREA SELECT OPTION".split(" "));
export const SINGLE_LINE_TAGS = new Set(
  "H1 H2 H3 H4 H5 H6 A TH TD LI BUTTON LABEL FIGCAPTION DT DD".split(" "));

function hasDirectText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.nodeValue.trim() !== "") return true;
  }
  return false;
}
function onlyInlineChildren(el) {
  for (const c of el.children) {
    if (!INLINE_TAGS.has(c.tagName)) return false;
  }
  return true;
}
function inSkippedAncestor(el) {
  let p = el.parentElement;
  while (p) { if (SKIP_ANCESTORS.has(p.tagName)) return true; p = p.parentElement; }
  return false;
}

export function isEditableText(el) {
  if (!el || el.nodeType !== 1) return false;
  if (SKIP_ANCESTORS.has(el.tagName)) return false;
  if (inSkippedAncestor(el)) return false;
  return hasDirectText(el) && onlyInlineChildren(el);
}

export function collectEditables(root) {
  const out = [];
  for (const el of root.querySelectorAll("*")) {
    if (!isEditableText(el)) continue;
    // skip if nested inside another editable — the outer block owns its text
    let p = el.parentElement, nested = false;
    while (p) { if (isEditableText(p)) { nested = true; break; } p = p.parentElement; }
    if (!nested) out.push(el);
  }
  return out;
}
