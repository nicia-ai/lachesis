# M8b.2b alpha.4 release preparation

Decision: `release-candidate-prepared-awaiting-separate-authorizations`.

The immutable package-source commit is
`635521f1d2e753095fca4fdbbafbf7ed2287efe1`. The separately committed
clean-runner ordering correction is `5e894a2df44cba074f8f9a1aa1cd2ce7240daa51`;
the release workflow still checks out the immutable package source. No push,
tag, GitHub release, npm publication, trusted-publisher configuration,
credential access, or dist-tag mutation occurred.

The release set is exactly six synchronized `0.1.0-alpha.4` packages. Kernel,
evidence, and generator are behavior-correction releases. Runtime and the
TypeGraph adapter are dependency-only synchronized republishes. The CLI is a
first experimental public alpha binary: ESM-only, Node `>=24 <25`, no supported
JavaScript import surface, no declaration promise, and no CommonJS support.

All internal Lachesis package edges are exact alpha.4 dependencies. The five
library export inventories are byte-identical in meaning to alpha.3; no public
export was added or removed. The CLI tarball contains an executable `lachesis`
entrypoint at mode `0755` and no declarations or export map.

Every package reproduced byte-identically over three packs from the source
commit. A fresh host consumer and a network-disabled, read-only Linux consumer
both installed the exact prospective set, compiled with TypeScript 6.0.3,
`strict: true`, and `skipLibCheck: false`, and ran manifest, finite comparison,
and detached verification without workspace imports, alpha.3 fallback,
credentials, or provider calls.

The full repository matrix passed: 443 default-parallel tests, 443 coverage
tests, coverage thresholds, build, strict typecheck, lint, format, Node and
Workers smokes, seven offline examples, packed-package audit, source-safety
audit, historical checksums, M7c frozen-documentation integrity, workflow static
validation, and `git diff --check`. The frozen M8b.2a ten-run default-parallel
stability audit independently reverified 10/10 passes.

The registry preflight observed alpha.4 absent for all six packages, the five
existing packages at `alpha=0.1.0-alpha.3` and `latest=0.1.0-alpha.1`, and the
CLI package absent. Current official npm behavior requires a package to exist
before trusted-publisher administration, so the CLI has a separately authorized
one-time token bootstrap plan. The existing five packages remain OIDC-only.

Finite suite evidence remains finite. Detached verification establishes
integrity, not semantic acceptance. This preparation makes no model-quality,
provider, TypeGraph-superiority, or compositional-generalization claim.
