// Stage the Windows x64 sidecars. --latest repins the shared FFmpeg and ffprobe archive.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = join(dirname(script), "..");
const binDir = join(root, "src-tauri", "binaries");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Frame sidecars require Windows x64");
}
const triple = "x86_64-pc-windows-msvc";

const mb = (p) => (statSync(p).size / 1048576).toFixed(0);

const YTDLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const FFMPEG_WIN_VERSION = "9.0.2";
const FFMPEG_WIN_SHA256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
const FFMPEG_WIN_ZIP = `ffmpeg-${FFMPEG_WIN_VERSION}-essentials_build.zip`;
const FFMPEG_WIN_TAG = `ffmpeg-${FFMPEG_WIN_SHA256.slice(0, 12)}`;
// Tried in order; all three serve the same zip, which the pinned SHA-256 checks.
const FFMPEG_WIN_URLS = [
  `https://github.com/crazyrabbit0/harbor-deps/releases/download/${FFMPEG_WIN_TAG}/${FFMPEG_WIN_ZIP}`,
  `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_WIN_VERSION}/${FFMPEG_WIN_ZIP}`,
  `https://www.gyan.dev/ffmpeg/builds/packages/${FFMPEG_WIN_ZIP}`,
];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const OVERRIDE = {
  "yt-dlp": process.env.HARBOR_YTDLP_URL,
  ffmpeg: process.env.HARBOR_FFMPEG_URL,
  ffprobe: process.env.HARBOR_FFPROBE_URL,
};

const ENVVAR = {
  "yt-dlp": "HARBOR_YTDLP_URL",
  ffmpeg: "HARBOR_FFMPEG_URL",
  ffprobe: "HARBOR_FFPROBE_URL",
};

const dlCache = new Map();
async function download(url) {
  if (dlCache.has(url)) return dlCache.get(url);
  console.log(`[binaries] fetching ${url}`);
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "*/*" },
  });
  if (!res.ok) throw new Error(`download failed (${res.status} ${res.statusText})`);
  const buf = Buffer.from(await res.arrayBuffer());
  dlCache.set(url, buf);
  return buf;
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function findMember(dir, name) {
  let best = null;
  let bestSize = -1;
  for (const p of walk(dir, [])) {
    if (basename(p) !== name) continue;
    const size = statSync(p).size;
    if (size > bestSize) {
      best = p;
      bestSize = size;
    }
  }
  return best;
}

function extractMember(buf, member, dest) {
  const tmp = mkdtempSync(join(tmpdir(), "harbor-bin-"));
  try {
    const archive = join(tmp, "archive.zip");
    writeFileSync(archive, buf);
    const outDir = join(tmp, "out");
    mkdirSync(outDir, { recursive: true });
    execFileSync("tar.exe", ["-xf", archive, "-C", outDir], { stdio: "inherit" });
    const found = findMember(outDir, member);
    if (!found) throw new Error(`could not find ${member} inside archive`);
    copyFileSync(found, dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let pinnedZip;
function fetchPinnedZip(override) {
  pinnedZip ??= (async () => {
    for (const url of override ? [override] : FFMPEG_WIN_URLS) {
      try {
        const buf = await download(url);
        const got = sha256(buf);
        if (got !== FFMPEG_WIN_SHA256)
          throw new Error(`checksum mismatch (expected ${FFMPEG_WIN_SHA256}, got ${got})`);
        return buf;
      } catch (err) {
        console.error(`[binaries] ${url}: ${err.message}`);
      }
    }
    throw new Error(`no source served ${FFMPEG_WIN_ZIP} with the pinned SHA-256`);
  })();
  return pinnedZip;
}

// Repins the Windows ffmpeg/ffprobe to gyan.dev's newest release; the zip still has to be uploaded to harbor-deps.
async function pinLatest() {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch("https://api.github.com/repos/GyanD/codexffmpeg/releases/latest", {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`release lookup failed (${res.status} ${res.statusText})`);
  const release = await res.json();
  const version = release.tag_name;
  const zip = `ffmpeg-${version}-essentials_build.zip`;
  const asset = release.assets.find((a) => a.name === zip);
  if (!asset) throw new Error(`no ${zip} in GyanD/codexffmpeg ${version}`);
  const buf = await download(asset.browser_download_url);
  const sha = sha256(buf);
  const source = readFileSync(script, "utf8");
  const pinned = source
    .replace(/^const FFMPEG_WIN_VERSION = "[^"]+";/m, `const FFMPEG_WIN_VERSION = "${version}";`)
    .replace(/^const FFMPEG_WIN_SHA256 = "[0-9a-f]{64}";/m, `const FFMPEG_WIN_SHA256 = "${sha}";`);
  if (pinned.includes(FFMPEG_WIN_SHA256) && sha !== FFMPEG_WIN_SHA256)
    throw new Error("could not rewrite the pin");
  writeFileSync(script, pinned);
  const archive = join(tmpdir(), zip);
  writeFileSync(archive, buf);
  console.log(`[binaries] pinned ${zip} (SHA-256 ${sha})`);
  console.log(
    `[binaries] publish it: gh release create ffmpeg-${sha.slice(0, 12)} "${archive}" --repo crazyrabbit0/harbor-deps --title "ffmpeg ${version} (gyan.dev essentials)"`,
  );
  console.log(
    "[binaries] then delete src-tauri/binaries/ffmpeg-*.exe and ffprobe-*.exe and re-run",
  );
}

if (process.argv.includes("--latest")) {
  try {
    await pinLatest();
    process.exit(0);
  } catch (err) {
    console.error(`[binaries] ${err.message}`);
    process.exit(1);
  }
}

function hint(name) {
  const lines = [
    `[binaries] fix: set ${ENVVAR[name]} to a mirror URL, or drop a working`,
    `[binaries]      ${name}-${triple}.exe into src-tauri/binaries/ by hand.`,
  ];
  if (name === "yt-dlp")
    lines.push("[binaries]      source: github.com/yt-dlp/yt-dlp/releases/latest");
  else lines.push("[binaries]      source: checksum-pinned gyan.dev essentials zip");
  return lines.join("\n");
}

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

let ok = true;
for (const name of ["yt-dlp", "ffmpeg", "ffprobe"]) {
  const dest = join(binDir, `${name}-${triple}.exe`);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[binaries] ${name}-${triple}.exe already present (${mb(dest)} MB)`);
    continue;
  }
  try {
    if (name === "yt-dlp")
      writeFileSync(dest, await download(OVERRIDE[name] ?? YTDLP + "/yt-dlp.exe"));
    else extractMember(await fetchPinnedZip(OVERRIDE[name]), name + ".exe", dest);
    console.log(`[binaries] wrote ${name}-${triple}.exe (${mb(dest)} MB)`);
  } catch (err) {
    console.error(`[binaries] ${name} failed: ${err.message}`);
    console.error(hint(name));
    ok = false;
  }
}

if (!ok) {
  console.error("[binaries] one or more sidecars are missing; see messages above");
  process.exit(1);
}
console.log(`[binaries] all sidecars ready for ${triple}`);
