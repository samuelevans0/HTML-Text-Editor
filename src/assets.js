// Build a faithful preview of a page: resolve its relative CSS/image/font refs to
// blob: URLs read from the picked folder, and neutralize the site's own scripts.
// Operates on a CLONE of the source-of-truth doc (which already carries data-edit-id),
// so editId stamping is preserved in the preview. Browser-only.
import { resolvePath, extname } from "./paths.js";

const MIME = {
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".bmp": "image/bmp", ".css": "text/css", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm",
};

function typedUrl(blob, path, urls) {
  // getFile() usually sets a type from the extension, but raw Blobs (and some
  // edge cases) don't — <img> won't render SVG without image/svg+xml, so be explicit.
  const want = MIME[extname(path)] || "";
  const typed = blob.type ? blob : (want ? new Blob([blob], { type: want }) : blob);
  const u = URL.createObjectURL(typed);
  urls.push(u);
  return u;
}

export async function buildPreview(fs, pagePath, cleanDoc) {
  const clone = cleanDoc.cloneNode(true);
  const urls = [];

  const objUrl = async (ref, fromPath) => {
    if (!ref) return null;
    const r = resolvePath(fromPath, ref);
    if (!r || r.external || !r.path || !(await fs.exists(r.path))) return null;
    const blob = await fs.readBytes(r.path);
    return typedUrl(blob, r.path, urls);
  };

  // Inject a guard script first so site scripts can't navigate away or submit forms.
  // Using a non-module IIFE so it runs synchronously before any deferred site scripts.
  const guard = clone.createElement("script");
  guard.textContent = "(function(){window.open=function(){return null;};document.addEventListener('submit',function(e){e.preventDefault();},true);try{var _n=function(){};history.pushState=_n;history.replaceState=_n;}catch(e){}})();";
  const head = clone.querySelector("head");
  if (head) head.insertBefore(guard, head.firstChild);
  else clone.documentElement.insertBefore(guard, clone.documentElement.firstChild);

  // Rewrite local script src -> blob URLs so scripts load from srcdoc.
  // (Relative src would fail since srcdoc has no base URL; absolute CDN src loads fine as-is.)
  for (const s of clone.querySelectorAll("script[src]")) {
    const u = await objUrl(s.getAttribute("src"), pagePath);
    if (u) s.setAttribute("src", u);
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
    const style = clone.createElement("style");
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
    const u = typedUrl(blob, r.path, urls);
    out = out.split(token).join(`url("${u}")`);
  }
  return out;
}
