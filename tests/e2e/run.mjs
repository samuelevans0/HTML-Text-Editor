// Headless integration test: drives the real load -> edit -> navigate -> save path
// through a browser (the File System Access picker is replaced by an in-memory fs
// behind ?test=1). Uses Puppeteer resolved from the parent Websites/node_modules.
import puppeteer from "puppeteer";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = pathToFileURL(join(root, "editor.html")).href + "?test=1";

// tiny 1x1 png
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const CSS = "body{font-family:sans-serif}h1{color:#234}\n";
const IDX = [
  "<!DOCTYPE html>", "<html>", "<head>", '<meta charset="utf-8">',
  "<title>Home</title>", '<link rel="stylesheet" href="styles.css">', "</head>",
  "<body>", "<h1>Welcome</h1>",
  '<p>Hello world. <a href="about.html">About us</a></p>',
  '<img src="images/logo.png" alt="logo">',
  '<nav><a href="about.html">Go to About</a></nav>', "</body>", "</html>", "",
].join("\n");
const ABT = [
  "<!DOCTYPE html>", "<html>", "<head>", '<meta charset="utf-8">',
  "<title>About</title>", '<link rel="stylesheet" href="styles.css">', "</head>",
  "<body>", "<h1>About</h1>", "<p>We are a team.</p>",
  '<a href="index.html">Home</a>', "</body>", "</html>", "",
].join("\n");

const files = { "index.html": IDX, "about.html": ABT, "styles.css": CSS, "images/logo.png": "OLDPNG" };

let failures = 0;
function check(name, cond) {
  if (cond) console.log("  PASS  " + name);
  else { console.log("  FAIL  " + name); failures++; }
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("  PAGEERROR:", e.message); failures++; });
  page.on("console", (m) => { if (m.type() === "error") console.log("  console.error:", m.text()); });

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction("window.EDITOR_TEST !== undefined", { timeout: 10000 });

  // open the in-memory site
  const startPath = await page.evaluate((f) => window.EDITOR_TEST.open(f), files);
  check("starts on index.html", startPath === "index.html");

  // edit heading on index
  await page.evaluate(() => window.EDITOR_TEST.editText(6, "Welcome home"));
  // edit a nested link's href via Alt-click (prompt overridden)
  await page.evaluate(() => { window.prompt = () => "contact.html"; });
  await page.evaluate(() => window.EDITOR_TEST.clickLink(8, true));
  // replace the logo image (referenced once -> overwrite in place)
  await page.evaluate((b64) => window.EDITOR_TEST.replaceImage(9, b64, "logo.png"), PNG_B64);

  // navigate to about.html by clicking the nav link, then edit its heading
  await page.evaluate(() => window.EDITOR_TEST.clickLink(11, false));
  await page.waitForFunction('window.EDITOR_TEST.current() === "about.html"', { timeout: 5000 });
  check("navigated to about.html", true);
  await page.evaluate(() => window.EDITOR_TEST.editText(6, "About Our Team"));

  const dirtyBefore = await page.evaluate(() => window.EDITOR_TEST.dirty());
  check("dirty before save", dirtyBefore === true);

  const result = await page.evaluate(() => window.EDITOR_TEST.save());
  check("saved 2 pages", result.savedPages.length === 2);
  check("saved 1 image", result.savedImages.length === 1);
  check("no skipped edits", result.skipped.length === 0);

  const idx2 = await page.evaluate(() => window.EDITOR_TEST.getText("index.html"));
  const abt2 = await page.evaluate(() => window.EDITOR_TEST.getText("about.html"));
  const css2 = await page.evaluate(() => window.EDITOR_TEST.getText("styles.css"));

  // index: only the heading and the in-paragraph link href changed
  check("index heading edited", idx2.includes("<h1>Welcome home</h1>"));
  check("index old heading gone", !idx2.includes("<h1>Welcome</h1>"));
  check("index link href patched", idx2.includes('<p>Hello world. <a href="contact.html">About us</a></p>'));
  check("index nav link untouched", idx2.includes('<nav><a href="about.html">Go to About</a></nav>'));
  check("index head untouched", idx2.includes('<link rel="stylesheet" href="styles.css">'));
  check("index img src untouched (overwrite-in-place)", idx2.includes('<img src="images/logo.png" alt="logo">'));

  // about: only the heading changed
  check("about heading edited", abt2.includes("<h1>About Our Team</h1>"));
  check("about body untouched", abt2.includes("<p>We are a team.</p>"));
  check("about old heading gone", !abt2.includes("<h1>About</h1>"));

  // styles.css never touched
  check("styles.css byte-identical", css2 === CSS);

  // image bytes replaced
  const imgLen = await page.evaluate(() => window.EDITOR_TEST._fs._map.get("images/logo.png").length);
  check("logo.png bytes replaced", imgLen !== 6 && imgLen > 60);

  const dirtyAfter = await page.evaluate(() => window.EDITOR_TEST.dirty());
  check("clean after save", dirtyAfter === false);
} finally {
  await browser.close();
}

if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
console.log("\nAll integration checks passed.");
