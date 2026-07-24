# M8b.0 implementation plan and decision

## Atomic M8b.1 stages

Each stage is independently reviewable and retains the existing plan commands.

1. **Internal contract library**
   - Move the reviewed report schema, canonical serializer, summary derivation,
     exit precedence, and safe renderer into private CLI modules.
   - Add property tests for insertion-order independence and mutation rejection.
   - Do not add commands or package exports.

2. **Catalog manifest**
   - Add strict locator parsing and trusted compiled-ESM loading.
   - Implement `catalog manifest --check`, `--out`, and source-bound `--verify`.
   - Add atomic file output, redaction, packed-consumer fixtures, and Node smoke
     tests.

3. **Structural catalog comparison**
   - Add `catalog compare` without a suite.
   - Report identity-only changes and declaration-review-required changes.
   - It must never claim semantic compatibility and normally exits 10.

4. **Semantic conformance**
   - Add the generator dependency and lazy loading for `--suite`.
   - Preserve one detailed record per declaration/role/boundary decision.
   - Exercise declaration-repairable, genuinely non-equivalent, and
     insufficient-evidence paths with hostile fixtures.

5. **Report verification and CI contract**
   - Add detached `report verify`.
   - Verify envelope, nested identities, artifacts, summary, and exit
     derivation.
   - Add shell and GitHub Actions examples that fail on exits 11–13 and
     distinguish exit 10 by explicit policy.

6. **Registry-only product gate**
   - Pack the CLI and its public dependencies.
   - Start from an empty directory with no workspace or repository access.
   - Verify Node 24 ESM, strict TypeScript 6 consumers, deterministic output, no
     forbidden dependency leakage, and measured cold-install/start times.
   - Submit publication, version, and documentation changes for separate review.

No stage may silently widen the report schema, accept automatic repair, or add
kernel/generator exports to make CLI implementation easier.

## Acceptance gates

- Every command emits exactly one protocol report after successful argument
  parsing.
- Canonical reports are byte-identical across repeated and reordered-input
  tests.
- All nested identities and referenced artifacts verify.
- Detailed records, not claimed counters, determine summaries and exit codes.
- Every genuine difference renders `do-not-substitute`.
- Every declaration repair is conditional and retains its initial rejected
  outcome.
- Existing CLI commands, Node/Workers package smokes, strict typecheck, lint,
  tests, coverage, build, format, and unsafe-escape audits pass.
- A packed registry-only consumer succeeds with no private or workspace
  dependency.

## Decision

**GO for M8b.1 internal implementation** using the existing CLI and current
alpha.3 public APIs.

The evidence supports the proposed contract, not publication. Publication,
making the CLI package public, any version bump, and any new public export
remain **NO-GO without separate review**.
