// Visual smoke for server mode: screenshot the site picker.
import puppeteer from "puppeteer";
import { start } from "../../server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const base = join(root, "tests", "fixtures");
const { server, port } = await start({ base, port: 0, open: false });

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(root, "docs", "shot-server-picker.png") });
  console.log("wrote docs/shot-server-picker.png");
} finally {
  await browser.close();
  server.close();
}
