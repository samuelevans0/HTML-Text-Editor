// Pure in-folder path resolution. Resolves an href (relative to the current page)
// to a normalized path inside the picked site folder, or flags it external/invalid.
const EXTERNAL = /^(https?:|\/\/|mailto:|tel:|sms:|data:|javascript:)/i;

export function dirname(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
export function extname(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}
export function isHtml(path) {
  const e = extname(path);
  return e === ".html" || e === ".htm";
}
export function joinPath(dir, rel) {
  return (dir ? dir + "/" : "") + rel;
}

export function resolvePath(fromPath, href) {
  if (!href) return null;
  let h = href.split("#")[0].split("?")[0];
  if (h === "") return null;
  if (EXTERNAL.test(href)) return { external: true };

  let dir;
  if (h.startsWith("/")) { dir = ""; h = h.replace(/^\/+/, ""); }
  else { dir = dirname(fromPath); }

  const segs = dir ? dir.split("/") : [];
  for (const part of h.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (segs.length === 0) return null; segs.pop(); }
    else segs.push(part);
  }
  let path = segs.join("/");
  const cleaned = href.split("#")[0].split("?")[0];
  if (cleaned.endsWith("/") || extname(path) === "") {
    path = (path ? path + "/" : "") + "index.html";
  }
  if (path.startsWith("..")) return null;
  return { path };
}
