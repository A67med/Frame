import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Frame sidecars require Windows x64");
}
const triple = "x86_64-pc-windows-msvc";

const sizeMb = (p) => (statSync(p).size / 1048576).toFixed(0);

let ok = true;
for (const name of ["ffmpeg", "ffprobe"]) {
  const dest = join(binDir, `${name}-${triple}.exe`);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[ffmpeg] ${name}-${triple}.exe already present (${sizeMb(dest)} MB)`);
    continue;
  }
  const src = join(binDir, `${name}.exe`);
  if (!existsSync(src) || statSync(src).size === 0) {
    console.error(`[ffmpeg] missing ${src}`);
    console.error(`[ffmpeg] Drop a STATIC ${name}.exe into src-tauri/binaries/ then re-run.`);
    console.error(`[ffmpeg]   Windows: gyan.dev essentials build (static).`);
    ok = false;
    continue;
  }
  copyFileSync(src, dest);
  console.log(`[ffmpeg] ${name}.exe -> ${name}-${triple}.exe (${sizeMb(dest)} MB)`);
}

if (!ok) process.exit(1);
