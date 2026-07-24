# M8b.1 implementation status

Bound design commit: `b65be65842f7346da1374b29a2bd76cf70c4cbbe`

## Stage 1 — private internal CLI contract library

Status: `complete-offline-pass`

Implemented privately under `apps/cli/src/internal`:

- strict `lachesis-catalog-command-report/1` schemas;
- hostile-value rejection and canonical JSON with one trailing newline;
- semantic ordering, derived summaries, derived status, and frozen exit
  precedence;
- report and nested conformance-diagnostic identity verification;
- exact external artifact checksum and semantic-digest verification; and
- deterministic terminal-safe human rendering.

The existing `lachesis` command entrypoint, command names, arguments, outputs,
and exit behavior are unchanged. The CLI package remains private. No dependency,
package version, package export, or public API changed.

## Later stages

- Stage 2: private catalog manifest command — complete offline.
- Stage 2a: descriptor, source-binding, and output-path hardening — complete
  offline.
- Stage 3: private structural catalog comparison — complete offline.
- Stage 4: semantic conformance wiring and transaction hardening — complete
  offline.
- Stage 5: detached report verification and tested CI contract — complete
  offline.
- Stage 5.1: detached command-identity verification, nested-report closure, and
  single-output transaction finalization — complete offline.
- Stage 6: registry-only product gate — not started.

Stage 1 does not authorize or imply any later stage, publication, provider
operation, or research work.
