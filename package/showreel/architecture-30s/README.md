# Temperance Engine — 30-second editable review film

This landscape composition reuses the original public 15-second showreel's
Canvas2D artwork, title, emblem and procedural score. It adds slower pacing,
Koshas, advisory organs and selected installed Claude extensions. The new
callbacks/timeline are a locally authored review fallback. Connected Phloem
attempts did not deliver accepted creative source; S-tier creative authorship
remains pending. See SPEC.md and THIRD-PARTY-NOTICES.md.

Requirements: Bun, FFmpeg and a Chromium-family browser. No npm dependencies.
The font files and OFL notices are included. Landscape only, 1920×1080,
60 frames per second, 1800 frames / 30 seconds. No narrated speech.

```sh
bun scripts/preview.ts
# Open http://127.0.0.1:47333/reel.html

bun run sound
bun scripts/capture.ts --workers 1 --keep-frames
```

The sound command regenerates the original 15-second score, preserves that WAV,
then time-stretches it to 30 seconds. Do not run scripts/soundtrack.ts alone
before capture: that original synthesizer produces only 15 seconds.

Capture writes out/temperance-showreel.mp4. Use FFprobe to verify 1800 video
frames and 30-second video duration before discarding frames. The renderer
defaults to one browser and is bounded to at most two workers.

```sh
bun scripts/capture.ts --frames 180,450,800,1070,1380,1799
```

The still command writes out/stills. Preview controls: click or Space to toggle;
arrow keys step one frame; Shift+arrow steps 30 frames; ?f=1380 opens a frame.

The original routing/verification simulations are removed from this composition.
No rendered model/provider roster, synthetic429→200 success or128criteria metric
appears. Advisory roles are not proof of an accepted installation or callback.
This package does not include the owner's private profile, keys or memory.
