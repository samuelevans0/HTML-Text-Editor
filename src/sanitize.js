// Turn a contenteditable element's messy innerHTML into a minimal, predictable
// inner-HTML string: text + a small allowlist of inline tags. Drops editor cruft
// (<div>, inline styles, class churn) so saved diffs stay clean.
const KEEP_TAGS = { B: "b", STRONG: "strong", I: "i", EM: "em" };

function escText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitizeInner(element) {
  let out = "";
  for (const node of element.childNodes) {
    if (node.nodeType === 3) { out += escText(node.nodeValue); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (tag === "BR") { out += "<br>"; continue; }
    if (KEEP_TAGS[tag]) { out += `<${KEEP_TAGS[tag]}>${sanitizeInner(node)}</${KEEP_TAGS[tag]}>`; continue; }
    if (tag === "A") {
      const href = node.getAttribute("href") || "#";
      out += `<a href="${escAttr(href)}">${sanitizeInner(node)}</a>`;
      continue;
    }
    out += sanitizeInner(node); // unwrap unknown elements
  }
  return out;
}
