// Build the repo copies of the showreel from the rendered masters in out/:
//   assets/showreel/temperance-showreel.mp4        1920×1080 web encode (CRF 24, ~5 MB)
//   assets/showreel/temperance-showreel-9x16.mp4   1080×1920 web encode
//   assets/showreel/poster.jpg                     six-scene contact sheet for the README
// Run `bun run render` and `bun run render:vertical` first.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "out");
const DEST = join(ROOT, "..", "..", "assets", "showreel");
const CUTS = ["temperance-showreel.mp4", "temperance-showreel-9x16.mp4"];
// One settled frame per scene: ignition, title, BUILD, routing (200 OK), VERIFIED, lockup.
const POSTER_FRAMES = [60, 200, 352, 630, 758, 860];

const ffmpeg = (args: string[]) => {
  const r = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", ...args], { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg exited ${r.exitCode}: ${args.join(" ")}`);
};

for (const cut of CUTS) {
  if (!existsSync(join(OUT, cut))) throw new Error(`missing out/${cut}; run bun run render and bun run render:vertical first`);
}
mkdirSync(DEST, { recursive: true });

for (const cut of CUTS) {
  ffmpeg([
    "-i", join(OUT, cut),
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-tune", "film",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    join(DEST, cut),
  ]);
}

// 3×2 contact sheet with ink gutters, from the landscape master.
const inputs = POSTER_FRAMES.flatMap((n) => ["-ss", (n / 60).toFixed(4), "-i", join(OUT, CUTS[0])]);
const cells = POSTER_FRAMES.map((_, i) => `[${i}:v]scale=636:358:flags=lanczos,pad=640:362:2:2:color=0x07090b[c${i}]`).join(";");
const stack = POSTER_FRAMES.map((_, i) => `[c${i}]`).join("") + "xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[out]";
ffmpeg([...inputs, "-filter_complex", `${cells};${stack}`, "-map", "[out]", "-frames:v", "1", "-q:v", "3", join(DEST, "poster.jpg")]);

for (const file of [...CUTS, "poster.jpg"]) {
  console.log(`${String(Bun.file(join(DEST, file)).size).padStart(9)}  assets/showreel/${file}`);
}
