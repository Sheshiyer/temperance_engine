# Source and third-party notices

Original visual renderer and procedural soundtrack: Temperance Engine public
repository, `package/showreel`, reused under the included MIT LICENSE. This thirty-second version retains that source and adds Phloem Opus5.5 scene refinements, with local capture/encoding. Original media is preserved.

Canvas2D is the browser drawing API; Chromium captures PNGs. Bun runs the local
server and scripts; FFmpeg encodes H.264/AAC and time-stretches the authored score.
These executables are required separately and are not redistributed here.

Font files in `assets/fonts/` were retrieved through the original capture cache
from Google Fonts. Families:
Cormorant Garamond, Space Grotesk, DM Mono. Their SIL Open Font License texts
are included in `licenses/`. `assets/fonts.css` records each original font filename
and unicode range. Retrieval date: 2026-11-02. The finite required font subsets
are bundled so capture and preview can load these fonts locally.

License sources:
- https://github.com/google/fonts/blob/main/ofl/cormorantgaramond/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/dmmono/OFL.txt

The credited product ecosystem is described separately in the companion tooling
inventory. Mentioning an integration does not assert execution or acceptance.
HyperFrames was evaluated but did not render this cut. React and GSAP belong to
the website, not this film's rendering dependencies.
