// Browser entry: boot the app once the DOM is ready.
// (parse5 is pulled in transitively via app.js -> pages.js -> htmlSource.js.)
import { bootApp } from "./app.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}
