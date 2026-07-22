# Changelog

## 0.1.0-alpha.3

- Dependency-only synchronized release with the alpha.3 kernel and evidence
  packages; no runtime API or behavior change.

## 0.1.0-alpha.2

- Dependency-only synchronized release with `@nicia-ai/lachesis` and
  `@nicia-ai/lachesis-evidence`; no runtime API or behavior changes.

## 0.1.0-alpha.1

- Introduces the ESM-only public alpha facade for plan compilation, lexical
  evidence execution, typed results, deterministic provenance, recording, and
  exact replay.
- Adds a Node-only private file recording store with atomic, content-addressed
  writes and strict ownership and permission checks.
- Keeps provider dispatch and TypeGraph storage optional and outside the
  portable entrypoint.
