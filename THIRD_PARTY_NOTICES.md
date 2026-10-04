# Third-Party Notices

Library: [docs/index.html](docs/index.html)

## OmniRoute

- Project: [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute)
- Reviewed source: commit `c1bdd91e7b9681e1056c4883b3e26cd0d416108b`
- License: MIT License
- Use in Temperance: attributed architectural inspiration for deterministic
  scoring, circuit state, plan envelopes, and observation telemetry. OmniRoute
  is not bundled and is not a runtime dependency.

Copyright (c) 2026 diegosouzapw

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## portless

- Project: [vercel-labs/portless](https://github.com/vercel-labs/portless)
- License: MIT License
- Use in Temperance: optional named `.localhost` URLs for Speculum, Vas, Athanor, and Mercurius (`scripts/apply-portless-organs.sh`, `package/router/organs.json`). Portless is not vendored and is not required to bind loopback ports.

Copyright (c) Vercel, Inc. and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Simplified Technical English (ASD-STE100 skill)

- Project: [0xpili/simplified-technical-english](https://github.com/0xpili/simplified-technical-english)
- Reviewed source: commit `1e148d670cba46685ad2b4c3f2354a637a7fdbbe`
- License: MIT License for the skill text and `scripts/ste_check.py` (text below)
- Use in Temperance: optional agent skill. `scripts/install-ste.sh` fetches it at
  the reviewed commit when the operator passes `--with-ste`; Temperance does not
  vendor it. `package/ste-check/` is a Temperance-owned bun/TypeScript port of
  `scripts/ste_check.py` and keeps its rule numbers and messages.
- ASD-STE100 notice: ASD-STE100 is a registered trade mark of ASD (AeroSpace and
  Defence Industries Association of Europe). The upstream
  `references/word-list.md` shows words from the ASD-STE100 dictionary, which
  is the property of ASD. Temperance never commits that word list; the checker
  reads it from the fetched upstream skill at runtime. The skill is not an
  official ASD product and does not certify ASD-STE100 compliance. The official
  specification is available free of charge at https://www.asd-ste100.org.

MIT License

Copyright (c) 2026 0xpili

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

NOTE: This license applies to the text of this skill and to its scripts.
The word list in references/word-list.md shows words from the ASD-STE100
dictionary, which is the property of ASD. Refer to NOTICE.md.
