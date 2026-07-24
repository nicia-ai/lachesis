# Changelog

## 0.1.0-alpha.4

- Corrects canonical JSON and identity-bearing plan, manifest, execution,
  recording, and replay boundaries so valid own keys are never silently lost.
- Preserves the alpha.3 public export surface and canonical protocol identity.

## 0.1.0-alpha.3

- Adds public external-catalog author guidance for versioned semantic roles and
  finite cross-catalog conformance. No kernel export or runtime behavior
  changes.

## 0.1.0-alpha.2

- Adds optional trusted, versioned catalog semantic-role declarations to the
  fingerprinted catalog boundary without changing the plan wire format.
- Validates role-specific schema, operation-kind, reducer-law, effect-authority,
  and bounded fixed-point obligations without adding backend dependencies.

## 0.1.0-alpha.1

- Publishes the portable typed plan compiler/runtime as a stable alpha API.
- Binds executable plans to catalog, policy, resource, and semantic-contract
  identities.
- Supports Node 24 and Cloudflare Workers through the same ESM export.
