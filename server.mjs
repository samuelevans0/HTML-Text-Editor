// Local helper: serves the built editor.html and a small file API over 127.0.0.1,
// so any browser (Firefox, Safari, Brave, Mullvad, …) gets full in-place saving.
// Node built-ins only. Exported start() is used by tests; CLI block runs it directly.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const DENY = new Set(["node_modules", ".git", ".wrangler", ".claude", ".vscode", "HTML Text Editor"]);
const MIME = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain",
};
const mimeFor = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";

function makeHandler(BASE, port) {
  const safe = (site, path) => {
    const abs = resolve(BASE, site || "", path || "");
    if (abs !== BASE && !abs.startsWith(BASE + sep)) return null;
    return abs;
  };
  const originOk = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`;
  };

  async function listSites() {
    const out = [];
    async function walk(rel, depth) {
      if (depth > 4) return;
      let entries;
      try { entries = await readdir(join(BASE, rel), { withFileTypes: true }); } catch { return; }
      if (rel && entries.some((e) => e.isFile() && /\.html?$/i.test(e.name))) out.push(rel.split(sep).join("/"));
      for (const e of entries) if (e.isDirectory() && !DENY.has(e.name)) await walk(join(rel, e.name), depth + 1);
    }
    await walk("", 0);
    return out;
  }
  async function listFiles(root) {
    const files = [];
    async function walk(rel, depth) {
      if (depth > 8) return;
      let entries;
      try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) { if (!DENY.has(e.name)) await walk(join(rel, e.name), depth + 1); }
        else if (e.isFile()) files.push(join(rel, e.name).split(sep).join("/"));
      }
    }
    await walk("", 0);
    return files;
  }

  return async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain" }); res.end(body); };
    const json = (code, obj) => send(code, JSON.stringify(obj), "application/json");

    try {
      if (url.pathname === "/" || url.pathname === "/editor.html") {
        return send(200, await readFile(join(TOOL_DIR, "editor.html")), "text/html; charset=utf-8");
      }
      if (url.pathname.startsWith("/__api/")) {
        if (!originOk(req)) return send(403, "bad origin");
        const site = url.searchParams.get("site") || "";
        const path = url.searchParams.get("path") || "";

        if (url.pathname === "/__api/sites") {
          return json(200, { base: BASE.split(sep).pop(), sites: await listSites() });
        }
        if (url.pathname === "/__api/list") {
          const root = safe(site, "");
          if (!root) return send(403, "bad path");
          return json(200, { files: await listFiles(root) });
        }
        if (url.pathname === "/__api/read") {
          const abs = safe(site, path);
          if (!abs) return send(403, "bad path");
          try { return send(200, await readFile(abs), mimeFor(abs)); }
          catch { return send(404, "not found"); }
        }
        if (url.pathname === "/__api/write" && req.method === "PUT") {
          const abs = safe(site, path);
          if (!abs) return send(403, "bad path");
          const chunks = [];
          for await (const c of req) chunks.push(c);
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, Buffer.concat(chunks));
          return json(200, { ok: true });
        }
        return send(404, "no such api");
      }
      return send(404, "not found");
    } catch (e) {
      return send(500, "error: " + e.message);
    }
  };
}

export function start({ base, port = 7777, open = false } = {}) {
  const BASE = resolve(base);
  return new Promise((resolveP, rejectP) => {
    let tries = 0;
    const attempt = (p) => {
      const server = createServer();
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE" && p !== 0 && tries < 50) { tries++; attempt(p + 1); }
        else rejectP(err);
      });
      server.listen(p, "127.0.0.1", () => {
        const actual = server.address().port;
        server.removeAllListeners("error");
        server.on("request", makeHandler(BASE, actual));
        const url = `http://localhost:${actual}/`;
        if (open) openBrowser(url);
        resolveP({ server, port: actual, url, base: BASE });
      });
    };
    attempt(port);
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
}

// CLI: node server.mjs [baseDir] [port]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] || join(TOOL_DIR, "..");
  const port = Number(process.argv[3] || process.env.PORT || 7777);
  const { url, base: b } = await start({ base, port, open: !process.env.NO_OPEN });
  console.log(`HTML Site Editor helper serving ${b}\n  -> ${url}\nPress Ctrl+C to stop.`);
}
