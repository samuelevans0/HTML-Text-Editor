// Build a faithful preview of a page: resolve its relative CSS/image/font refs to
// blob: URLs read from the picked folder, and neutralize the site's own scripts.
// Operates on a CLONE of the source-of-truth doc (which already carries data-edit-id),
// so editId stamping is preserved in the preview. Browser-only.
import { resolvePath } from "./paths.js";

export async function buildPreview(fs, pagePath, cleanDoc) {
  const clone = cleanDoc.cloneNode(true);
  const urls = [];

  const objUrl = async (ref, fromPath) => {
    if (!ref) return null;
    const r = resolvePath(fromPath, ref);
    if (!r || r.external || !r.path || !(await fs.exists(r.path))) return null;
    const blob = await fs.readBytes(r.path);
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  };

  // Neutralize scripts (kept as elements so the editId sequence is unchanged).
  for (const s of clone.querySelectorAll("script")) {
    s.setAttribute("type", "javascript/blocked");
    s.removeAttribute("src");
    s.textContent = "";
  }

  // Simple single-URL attributes.
  for (const el of clone.querySelectorAll("img[src], source[src], video[poster], audio[src]")) {
    const attr = el.tagName === "VIDEO" ? "poster" : "src";
    const u = await objUrl(el.getAttribute(attr), pagePath);
    if (u) el.setAttribute(attr, u);
  }

  // srcset (img/source): rewrite each candidate URL, keep descriptors.
  for (const el of clone.querySelectorAll("img[srcset], source[srcset]")) {
    const parts = el.getAttribute("srcset").split(",");
    const rewritten = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [url, ...desc] = trimmed.split(/\s+/);
      const u = await objUrl(url, pagePath);
      rewritten.push((u || url) + (desc.length ? " " + desc.join(" ") : ""));
    }
    el.setAttribute("srcset", rewritten.join(", "));
  }

  // Stylesheets -> inline <style> with url() rewritten one level deep.
  for (const link of clone.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const r = resolvePath(pagePath, link.getAttribute("href"));
    if (!r || r.external || !r.path || !(await fs.exists(r.path))) continue;
    let css = await fs.readText(r.path);
    css = await rewriteCssUrls(css, fs, r.path, urls);
    const style = clone.ownerDocument.createElement("style");
    style.setAttribute("data-from", link.getAttribute("href"));
    style.textContent = css;
    link.replaceWith(style);
  }

  // Inline style="...url()..." attributes.
  for (const el of clone.querySelectorAll('[style*="url("]')) {
    el.setAttribute("style", await rewriteCssUrls(el.getAttribute("style"), fs, pagePath, urls));
  }

  const html = "<!DOCTYPE html>" + clone.documentElement.outerHTML;
  return { html, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

async function rewriteCssUrls(css, fs, fromPath, urls) {
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const refs = [];
  let m;
  while ((m = re.exec(css)) !== null) refs.push({ token: m[0], ref: m[2] });
  let out = css;
  for (const { token, ref } of refs) {
    const r = resolvePath(fromPath, ref);
    if (!r || r.external || !r.path || !(await fs.exists(r.path))) continue;
    const blob = await fs.readBytes(r.path);
    const u = URL.createObjectURL(blob);
    urls.push(u);
    out = out.split(token).join(`url("${u}")`);
  }
  return out;
}
