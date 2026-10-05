# Git project identity evidence

`git-project inspect` reads bounded private JSON stdin `{capsule,binding,worktree_root?,mode?}`. `mode` is read or write and defaults to read. It uses the local Git probe internally; packets cannot supply probes, clocks, volume proofs or authority. Exit zero includes valid held evidence; malformed input returns a fixed error and nonzero exit. No remote operation or Git mutation is performed.

Approved portable capsules and private host bindings determine primary paths and access. Linked worktrees require exact fresh Git inventory membership, matching common directory, HEAD/branch and inventory generation. External linked paths are supported. Local probing rereads identity to reject drift and excludes ambient Git redirection and global/system Git config. Output contains finite reasons, symbolic identity and fingerprints, never private paths or credentials.

The injected library seam accepts trusted bounded volume observations. The public CLI deliberately has no volume observer yet: required declared volume bindings remain held. No-origin repositories remain held pending a portable approved local identity contract. Undeclared volumes are not discovered.

A verified result is source identity evidence. It grants no execution or lease authority, does not certify a clean working tree or authenticate external observations. Source/ISA/task fingerprints, capacity reservations and owner grant/atomic claim checks are required separately before Hands execution. Existing Superset admission is unchanged.
