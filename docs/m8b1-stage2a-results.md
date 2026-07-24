# M8b.1 Stage 2a hardening results

Status: `complete-offline-pass`

Parent Stage 2 commit: `8c1a5e596511ccd35ff08e3da08c00e6061089fd`.

Stage 2a closes four filesystem and identity gaps without changing the private
command or report protocols:

- bounded inputs are opened with `O_RDONLY | O_NOFOLLOW`, read through one
  descriptor, checked before and after reading, bounded during every read, and
  reconciled with the path identity before the descriptor is closed exactly
  once;
- normalized module paths share one acquisition and one import, while
  descriptor-bound snapshots immediately before and after import and before
  export lookup must match the recorded bytes and file identity;
- output parents and every existing path component reject symlinks, and parent,
  target, and temporary-file identities are revalidated immediately before the
  atomic link or rename commit; and
- normalized manifest/report and verify/report aliases reject before source
  loading, while source/artifact and source/report aliases reject before module
  execution or filesystem mutation.

Deterministic hooks exercise growth, truncation, path replacement, symlink
swaps, source mutation after acquisition, after hashing, before import, after
import, and before export lookup, parent replacement before commit, nested
symlink escape, and normalized aliasing. Pre-import drift rejects before module
execution. Existing check, output, verification, replacement, report
determinism, redaction, exit-code, and packed registry-consumer behavior remains
unchanged.

`lachesis-canonical-json/1`, the command-report protocol, exit codes, versions,
public exports, and all historical M8 evidence remain unchanged. Stage 3 did not
begin.
