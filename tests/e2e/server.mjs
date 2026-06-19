// Headless server-mode flow: real serverFs path over http://localhost (the same code
// every browser runs in server mode). Edits two pages, saves, asserts minimal diffs on disk.
import puppeteer from "puppeteer";
import { start } from "../../server.mjs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = await mkdtemp(join(tmpdir(), "hse2e-"));
await mkdir(join(base, "demo"), { recursive: true });
const IDX = `<!DOCTYPE html>\n<html><head><title>Home</title><link rel="stylesheet" href="styles.css"></head>\n<body>\n<h1>Welcome</h1>\n<p>Visit <a href="about.html">about</a>.</p>\n</body></html>\n`;
const ABT = `<!DOCTYPE html>\n<html><head><title>About</title></head>\n<body>\n<h1>About</h1>\n</body></html>\n`;
await writeFile(join(base, "demo", "index.html"), IDX);
await writeFile(join(base, "demo", "about.html"), ABT);
await writeFile(join(base, "demo", "styles.css"), "h1{color:#111}\n");

const { server, port } = await start({ base, port: 0, open: false });
const origin = `http://127.0.0.1:${port}`;

let failures = 0;
const check = (n, ok) => { console.log((ok ? "  PASS  " : "  FAIL  ") + n); if (!ok) failures++; };

const editH1 = (page, text) => page.evaluate((t) => {
  const d = document.getElementById("frame").contentDocument;
  const el = d.querySelector("h1");
  el.innerHTML = t; el.dispatchEvent(new Event("input", { bubbles: true }));
}, text);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("  PAGEERROR:", e.message); failures++; });
  page.on("console", (m) => { if (m.type() === "error") console.log("  console.error:", m.text()); });

  await page.goto(`${origin}/editor.html?site=demo`, { waitUntil: "load" });
  await page.waitForFunction('document.getElementById("frame") && document.getElementById("frame").classList.contains("ready")', { timeout: 10000 });
  check("auto-loaded site=demo (index.html)", true);

  await editH1(page, "Welcome home");

  await page.evaluate(() => {
    const d = document.getElementById("frame").contentDocument;
    d.querySelector('a[href="about.html"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForFunction('document.getElementById("crumb").textContent === "about.html"', { timeout: 5000 });
  check("navigated to about.html", true);

  await editH1(page, "About Us");

  await page.evaluate(() => document.getElementById("save").click());
  // wait for the real completion signal (the "Saved …" toast), not just the disabled button
  await page.waitForFunction('/Saved/.test(document.getElementById("toast").textContent)', { timeout: 5000 });

  const idx = await readFile(join(base, "demo", "index.html"), "utf8");
  const abt = await readFile(join(base, "demo", "about.html"), "utf8");
  const css = await readFile(join(base, "demo", "styles.css"), "utf8");
  check("index heading saved to disk", idx.includes("<h1>Welcome home</h1>"));
  check("index link untouched", idx.includes('<a href="about.html">about</a>'));
  check("about heading saved to disk", abt.includes("<h1>About Us</h1>"));
  check("styles.css byte-identical", css === "h1{color:#111}\n");
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
console.log("\nAll server-mode integration checks passed.");
