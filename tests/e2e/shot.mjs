// Visual smoke: screenshot the welcome screen and the fixture loaded in the editor.
import puppeteer from "puppeteer";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = pathToFileURL(join(root, "editor.html")).href + "?test=1";
const fixDir = join(root, "tests", "fixtures", "site");

const files = {};
for (const name of ["index.html", "about.html", "styles.css", "logo.svg"]) {
  files[name] = await readFile(join(fixDir, name), "utf8");
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction("window.EDITOR_TEST !== undefined", { timeout: 10000 });
  await page.screenshot({ path: join(root, "docs", "shot-welcome.png") });

  await page.evaluate((f) => window.EDITOR_TEST.open(f), files);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(root, "docs", "shot-loaded.png") });
  console.log("wrote docs/shot-welcome.png and docs/shot-loaded.png");
} finally {
  await browser.close();
}
