// Frame-exact capture of reel.html → PNG frames → H.264 MP4 with the soundtrack.
// Zero dependencies: Bun's server, a local Chromium in headless mode, and ffmpeg.
//
//   bun scripts/capture.ts                  full 900-frame render → out/temperance-showreel.mp4
//   bun scripts/capture.ts --workers 6      split the frame range across 6 headless browsers
//   bun scripts/capture.ts --frames 60,180  stills only → out/stills/f_00060.png …
//   add --vertical for the 1080×1920 social cut → out/temperance-showreel-9x16.mp4
//   add --keep-frames to keep the PNG frames after a successful encode (deleted by default)
//
// Google Fonts are proxied through the local server and cached in .cache/fonts/, so browser
// profiles are throwaway temp dirs and re-renders start warm (and work offline once cached).
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "out");
const FONT_CACHE = join(ROOT, ".cache", "fonts");
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const argFrames = arg("--frames");
const VERTICAL = process.argv.includes("--vertical");
const KEEP_FRAMES = process.argv.includes("--keep-frames");
const WORKERS = argFrames ? 1 : Number(arg("--workers") || 5);
const TOTAL = 900;
const FRAME_DIR = join(OUT, (argFrames ? "stills" : "frames") + (VERTICAL ? "-9x16" : ""));
const PORT = VERTICAL ? 47322 : 47321;

const BROWSER = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((p): p is string => !!p && existsSync(p));
if (!BROWSER) throw new Error("No Chromium-family browser found; set CHROME_BIN");

rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });
// Profiles from older versions of this script lived here (~120 MB per worker).
rmSync(join(OUT, ".browser-profile"), { recursive: true, force: true });
const PROFILES = mkdtempSync(join(tmpdir(), "te-capture-"));

// ── font proxy: fonts.googleapis.com / fonts.gstatic.com → .cache/fonts ──
// Ask for woff2, the format Chrome would get.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const inflight = new Map<string, Promise<void>>();
/** Serve `file` from the cache, fetching `remote` once if it is missing. */
async function cached(file: string, remote: string, transform?: (body: string) => string): Promise<Response> {
  if (!(await Bun.file(file).exists())) {
    if (!inflight.has(file)) {
      inflight.set(
        file,
        (async () => {
          const res = await fetch(remote, { headers: { "User-Agent": UA } });
          if (!res.ok) throw new Error(`font fetch ${res.status}: ${remote}`);
          mkdirSync(dirname(file), { recursive: true });
          await Bun.write(file, transform ? transform(await res.text()) : await res.arrayBuffer());
        })().finally(() => inflight.delete(file)),
      );
    }
    await inflight.get(file);
  }
  const type = file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".ttf") ? "font/ttf" : undefined;
  return new Response(Bun.file(file), type ? { headers: { "Content-Type": type } } : undefined);
}

let written = 0;
const seen = new Set<number>();
let finished = 0;
let fontLogged = false;
let fontFetches = 0;
const t0 = performance.now();
const done = Promise.withResolvers<void>();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/frame") {
      const i = Number(url.searchParams.get("i"));
      await Bun.write(join(FRAME_DIR, `f_${String(i).padStart(5, "0")}.png`), await req.arrayBuffer());
      written++;
      seen.add(i);
      if (!argFrames && seen.size === TOTAL) done.resolve();
      if (written % 60 === 0) console.log(`  ${written} frames · ${((performance.now() - t0) / 1000).toFixed(1)}s`);
      return new Response("ok");
    }
    if (req.method === "POST" && url.pathname === "/log") {
      const text = await req.text();
      if (!fontLogged || text.includes("MISSING")) console.log(text.replace(/^/gm, "  [page] "));
      fontLogged = true;
      return new Response("ok");
    }
    if (req.method === "POST" && url.pathname === "/done") {
      if (++finished === WORKERS && argFrames) done.resolve();
      return new Response("ok");
    }
    if (url.pathname === "/gfonts/css2") {
      const file = join(FONT_CACHE, `css-${Bun.hash(url.search).toString(16)}.css`);
      if (!(await Bun.file(file).exists())) fontFetches++;
      return cached(file, `https://fonts.googleapis.com/css2${url.search}`, (css) =>
        css.replaceAll("https://fonts.gstatic.com/", "/gstatic/"),
      );
    }
    if (url.pathname.startsWith("/gstatic/")) {
      const rel = url.pathname.slice("/gstatic/".length);
      if (rel.includes("..")) return new Response("bad path", { status: 400 });
      const file = join(FONT_CACHE, "gstatic", rel);
      if (!(await Bun.file(file).exists())) fontFetches++;
      return cached(file, `https://fonts.gstatic.com/${rel}`);
    }
    if (url.pathname === "/" || url.pathname === "/reel.html") {
      // Point the page's Google Fonts stylesheet at the local caching proxy.
      const html = (await Bun.file(join(ROOT, "reel.html")).text()).replace(
        "https://fonts.googleapis.com/css2",
        "/gfonts/css2",
      );
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const file = Bun.file(join(ROOT, decodeURIComponent(url.pathname)));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const chunk = Math.ceil(TOTAL / WORKERS);
const browsers = Array.from({ length: WORKERS }, (_, w) => {
  const range = argFrames ? `&frames=${argFrames}` : `&from=${w * chunk}&to=${Math.min(TOTAL, (w + 1) * chunk)}`;
  return Bun.spawn(
    [
      BROWSER,
      "--headless=new",
      `--user-data-dir=${join(PROFILES, String(w))}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      VERTICAL ? "--window-size=1080,1920" : "--window-size=1920,1080",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `http://localhost:${PORT}/reel.html?capture=1${range}${VERTICAL ? "&aspect=9x16" : ""}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
});

console.log(`capturing ${argFrames ? `frames ${argFrames}` : `${TOTAL} frames on ${WORKERS} workers`} via ${BROWSER.split("/").pop()}`);
const timeout = setTimeout(() => done.reject(new Error("capture timed out after 30 min")), 30 * 60_000);
try {
  await done.promise;
} finally {
  clearTimeout(timeout);
  for (const b of browsers) b.kill();
  await Promise.all(browsers.map((b) => b.exited));
  server.stop(true);
  rmSync(PROFILES, { recursive: true, force: true });
}
console.log(
  `captured ${seen.size} unique frames (${written} writes) in ${((performance.now() - t0) / 1000).toFixed(1)}s · ` +
    (fontFetches ? `fetched ${fontFetches} font files into .cache/fonts` : "fonts served from .cache/fonts"),
);

if (!argFrames) {
  if (seen.size !== TOTAL) throw new Error(`expected ${TOTAL} unique frames, got ${seen.size}`);
  const mp4 = join(OUT, VERTICAL ? "temperance-showreel-9x16.mp4" : "temperance-showreel.mp4");
  const ff = Bun.spawnSync(
    [
      "ffmpeg", "-y", "-loglevel", "error",
      "-framerate", "60", "-i", join(FRAME_DIR, "f_%05d.png"),
      "-i", join(ROOT, "public", "soundtrack.wav"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-tune", "film",
      "-c:a", "aac", "-b:a", "256k",
      "-shortest", "-movflags", "+faststart",
      mp4,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  // On failure the frames stay on disk so the encode can be retried or debugged.
  if (ff.exitCode !== 0) throw new Error(`ffmpeg exited ${ff.exitCode}; frames kept in ${FRAME_DIR}`);
  console.log(`wrote ${mp4}`);
  if (KEEP_FRAMES) console.log(`kept frames in ${FRAME_DIR}`);
  else rmSync(FRAME_DIR, { recursive: true, force: true });
}
