// Helper-backed filesystem: the same interface as fsAccess.createFs, over fetch.
// Used in any browser when the editor is served by the local helper (http://localhost).
const API = "/__api";

export function inServerMode() {
  return typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:");
}
export function siteFromQuery() {
  return new URLSearchParams(location.search).get("site");
}
export async function fetchSites(origin = "") {
  const r = await fetch(`${origin}${API}/sites`);
  if (!r.ok) throw new Error("sites " + r.status);
  return r.json();
}

export function createServerFs(site, origin = "") {
  const q = (path) => `site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}`;
  let listCache = null;

  async function ensureList() {
    if (listCache) return listCache;
    const r = await fetch(`${origin}${API}/list?site=${encodeURIComponent(site)}`);
    if (!r.ok) throw new Error("list " + r.status);
    listCache = new Set((await r.json()).files);
    return listCache;
  }

  const api = {
    rootHandle: {
      name: site,
      async *values() {
        const set = await ensureList();
        const top = new Map();
        for (const p of set) {
          const seg = p.split("/");
          if (seg.length === 1) top.set(seg[0], "file");
          else if (!top.has(seg[0])) top.set(seg[0], "directory");
        }
        for (const [name, kind] of top) yield { kind, name };
      },
    },
    async readText(path) {
      const r = await fetch(`${origin}${API}/read?${q(path)}`);
      if (!r.ok) throw new Error("read " + path + " " + r.status);
      return r.text();
    },
    async readBytes(path) {
      const r = await fetch(`${origin}${API}/read?${q(path)}`);
      if (!r.ok) throw new Error("read " + path + " " + r.status);
      return r.blob();
    },
    async writeText(path, text) {
      const r = await fetch(`${origin}${API}/write?${q(path)}`, { method: "PUT", body: text });
      if (!r.ok) throw new Error("write " + path + " " + r.status);
      (await ensureList()).add(path);
    },
    async writeBytes(path, blob) {
      const r = await fetch(`${origin}${API}/write?${q(path)}`, { method: "PUT", body: blob });
      if (!r.ok) throw new Error("write " + path + " " + r.status);
      (await ensureList()).add(path);
    },
    async exists(path) {
      return (await ensureList()).has(path);
    },
    async uniqueName(dir, base) {
      const set = await ensureList();
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let name = base, i = 0;
      while (set.has((dir ? dir + "/" : "") + name)) { i++; name = `${stem}-${i}${ext}`; }
      return name;
    },
  };
  return api;
}
