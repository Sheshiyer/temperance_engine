# Bounded owner file snapshot

`readBoundedOwnerFile(path, maximumBytes)` returns owned raw bytes after opening a
canonical owner path read-only with no-follow and nonblocking flags. It admits
only regular files whose descriptor size fits the fixed caller ceiling (at most
4 MiB), before allocating content storage. Reads are positional and exact; a
one-byte probe detects growth. Descriptor metadata and final path identity must
remain consistent. All opened valid descriptors close in `finally`; errors use
fixed codes without raw paths or underlying exceptions.

Owners select fixed per-purpose ceilings and map errors to their existing public
semantics. The adapter parameter supports trusted synthetic tests, never request
or environment selection. Owners retain canonical root and ancestor confinement.
This helper does not establish file ownership, writer authorization, immunity to
malicious writers restoring metadata, or a wall deadline for synchronous file
operations. Output is raw bytes so decoding/digest compatibility stays with the
owner. Memory is bounded by the admitted file size plus one probe byte; parsing
and downstream object/result production require their own bounds.
