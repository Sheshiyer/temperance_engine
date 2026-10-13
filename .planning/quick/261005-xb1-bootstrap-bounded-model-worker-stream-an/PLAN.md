# xb1 — bounded model-worker capture bootstrap

Source-only standalone primitive; no model spawn, signal, wire join or installer.

Own model-worker-capture.py, focused inert tests, contract and this packet only.
Create an exclusive owner FIFO under a trusted private canonical directory; retain descriptor/path identity and a keeper writer until trusted terminal observation. Capture stdout events, stderr and exact final FIFO bytes with fixed 64 KiB frames, 4 MiB events, 1 MiB stderr, 256 KiB final and 5 MiB aggregate. Probe overflow before retention. A single caller-retained monotonic deadline governs capture, with at most 250 ms drain inside it. Terminal and cancellation callbacks are trusted synchronous seams, checked before/after, not preemptible. Require explicit final-write-completed observation, including successful-empty; EOF alone never supplies that evidence.

Transfer ownership of pipe descriptors; close local descriptors on all outcomes, check continuity before close/unlink. Held outcomes discard private bytes and never authorize replay/proof75. Original caller retains consumed budget slots and owns process birth/resource/cleanup policy. Test inert fragmentation, missing writer, caps, partial EOF, deadlines, cancellation, identity and closure. Independent integration review precedes publication. Actual Codex FIFO compatibility and native join remain unverified.
