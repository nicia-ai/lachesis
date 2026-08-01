# M9b.12a verification

Decision: `corrected-preregistration-package-ready-for-independent-review`.

Node 24.18.1 was used throughout. This verification created no corpus, gold,
schedule instance, project, credential, count request, inference request,
provider call, external registration, publication, release, or push. It did not
access retired material.

## Append-only preservation

- Baseline commit: `b9f13c7b215624eb651caf3b038b77976247c9a3`.
- Baseline tree: `30144b30de282d63371f9afedeb7d5ac43cfa739`.
- Original preregistration digest:
  `f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5`.
- Original checksum-manifest digest:
  `437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c`.
- The original checksum manifest passes.
- The original package and M9b.12 source/test have an empty diff from the
  baseline.
- The six inherited M9b.12 human artifacts identified in `changed-artifacts.md`
  compare byte-identically.

## Corrected-package integrity

- Protocol: `lachesis-m9b12a-offline-preregistration-package@1.0.0`.
- Retired-material protocol: `lachesis-m9b12a-retired-corpus-quarantine@1.0.0`.
- Corrected preregistration digest:
  `79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831`.
- A fresh TypeScript compilation rederived the machine artifact with an exact
  canonical match.
- The source and test digests match `bindings.json`.
- Supersession commit, tree, package digest, and original-manifest digest match
  the independent baseline.
- Scientific topology, treatment, control, population, endpoint, analysis,
  model/envelope, financial totals, operational sequence, and authority remain
  unchanged.
- The corrected public package contains no retired or future corpus identity,
  case identity, content, hidden gold, expected citation, seed, packet, project,
  or credential.

## Verification matrix

- M9b.12a hostile suite: 10/10.
- Full focused M9 suite: 327/327 across 17 files.
- Full repository suite, serialized: 770/770 across 49 files.
- Coverage: 90.01% statements, 80.99% branches, 97.45% functions, and 93.70%
  lines.
- Tracked-repository plus M9b.12a formatting: passed.
- Strict typecheck, type-aware lint, build: passed.
- Node and Workers smokes: passed.
- Offline examples: 7/7.
- Load smoke: passed at 128 records; descriptive only.
- M8b0 CLI smokes: 6/6.
- Source-safety, public-API, release-checksum, and M8b-history audits: passed.
- `git diff --check`: passed.

The initial default-parallel full test run passed 768/770 and hit two existing
five-second timeouts in `apps/benchmark/tests/m5b.test.ts`. The complete
`--maxWorkers=1` rerun passed 770/770. The root `format:check` also observes the
pre-existing protected untracked `paper/README.md`; tracked files and all new
M9b.12a files pass formatting.

Three historical repository checks retain their known failures: the M7c public
documentation binding, the frozen alpha generator tarball digest, and the absent
historical unversioned CLI tarball after 63/63 M8b1-stage4 focused tests. These
are recorded in `verification.json`; none is introduced or changed by M9b.12a.

This result authorizes only independent review of the corrected offline package.
It authorizes no push, external registration, corpus materialization,
credential/provider access, or execution.
