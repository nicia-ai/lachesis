# M9b.12 verification record

Decision: `preregistration-package-ready-awaiting-external-authorization`

The machine artifact exactly matched a fresh private-protocol rederivation. Its
digest is `f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5`.
All verification ran locally under Node 24.18.1 with no network, provider,
count, credential, corpus, registration, publication, or push effect.

## Passing evidence

- M9b.12 hostile/property suite: 14/14 tests.
- Focused M9 suite: 317/317 tests across 16 files.
- Complete repository suite: 760/760 tests across 48 files.
- Coverage: 90.01% statements, 80.99% branches, 97.45% functions, and 93.70%
  lines.
- Strict typecheck, type-aware lint, full build, Node and Workers smokes,
  formatting of changed files, and `git diff --check`: passed.
- Examples: 7/7; descriptive load smoke: 128 records; M8b.0 CLI smokes: 6/6.
- Source-safety, release-checksum, M8b-history, and public-API audits: passed.
- The generator facade remained at 317 exports with digest
  `bf6a0476cbf3643705da8133e3173cbce771d765c979a7b198b586e2b6bda830`.

## Historical expected failures

These gates fail on the accepted baseline and are not M9b.12 regressions:

- `pnpm audit:m7c-preregistration`: M7c public documentation binding differs.
- `pnpm audit:packages`: deterministic three-run packing completed, then the
  generator differed from its frozen alpha tarball digest.
- `pnpm verify:m8b1-stage4`: 63/63 focused tests passed, then the historical
  `nicia-ai-lachesis-cli-0.1.0.tgz` artifact was absent.

M9b.12 creates no live authority. The seven future authorization texts remain
proposals and must be issued separately, in order, with append-only identities.
