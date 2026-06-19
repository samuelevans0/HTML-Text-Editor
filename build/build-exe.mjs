// Build a standalone, no-Node helper binary via Node SEA.
// Bundles the SEA entry, generates a SEA blob, copies node(.exe), and injects the blob.
import { build as esbuild } from "esbuild";
import { inject } from "postject";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => join(root, p);

// 1. ensure editor.html is built
execFileSync(process.execPath, [out("build/assemble.mjs")], { stdio: "inherit" });

// 2. bundle the SEA entry (server uses only node builtins -> nothing external pulled in)
await esbuild({
  entryPoints: [out("build/sea-main.mjs")],
  bundle: true, platform: "node", format: "cjs", target: "node20",
  outfile: out("build/sea-bundle.cjs"),
});

// 3. SEA config + blob
writeFileSync(out("build/sea-config.json"), JSON.stringify({
  main: "build/sea-bundle.cjs", output: "build/sea-prep.blob", disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ["--experimental-sea-config", out("build/sea-config.json")],
  { stdio: "inherit", cwd: root });

// 4. copy the node binary -> helper(.exe)
const exeName = process.platform === "win32" ? "helper.exe" : "helper";
const exePath = out(exeName);
copyFileSync(process.execPath, exePath);

// 5. inject the blob
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const opts = { sentinelFuse: fuse };
if (process.platform === "darwin") opts.machoSegmentName = "NODE_SEA";
await inject(exePath, "NODE_SEA_BLOB", readFileSync(out("build/sea-prep.blob")), opts);

// 6. cleanup temp artifacts
for (const f of ["build/sea-bundle.cjs", "build/sea-prep.blob", "build/sea-config.json"]) {
  try { rmSync(out(f)); } catch {}
}
console.log(`Built ${exeName} (${(statSync(exePath).size / 1048576).toFixed(0)} MB)`);
