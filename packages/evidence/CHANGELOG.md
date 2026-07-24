# Changelog

## 0.1.0-alpha.4

- Corrects arbitrary-JSON evidence boundaries to validate without reconstructing
  or silently removing identity-bearing own keys.
- Preserves the alpha.3 public export surface.

## 0.1.0-alpha.3

- Dependency-only synchronized release with `@nicia-ai/lachesis`; no evidence
  API or behavior change.

## 0.1.0-alpha.2

- Dependency-only synchronized release with `@nicia-ai/lachesis`; no evidence
  API or behavior changes.

## 0.1.0-alpha.1

- Publishes the portable evidence contracts and runtime substrate as an
  explicitly experimental low-level API.
- Adds lexical-default evidence compilation, reduced oracle output,
  visible-evidence validation, deterministic provenance, and exact replay.
- Enforces runtime oracle deadlines and validates adapter result and usage
  envelopes before execution accepts them.
