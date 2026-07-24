# M8b.0 machine-report contract

The normative proposed JSON Schema is
[`m8b0-machine-report.schema.json`](m8b0-machine-report.schema.json). The schema
and verifier are private design prototypes; they are not public exports.

## Envelope

Protocol: `lachesis-catalog-command-report/1`.

Top-level fields:

- `command`: command ID, command protocol version, and a deterministic command
  identity derived from normalized semantic inputs and flags;
- `inputs`: logical labels, kinds, and content digests, never ambient paths;
- `status`: `success`, `review-required`, `rejected`, `invalid`, `incomplete`,
  or `internal-error`;
- `completeness`: `complete` or `partial`;
- `outcomeExitCode`: the semantic result before shell/container wrapping;
- `diagnostics.controller`: bounded command/input/integrity diagnostics with
  stable codes and artifact/field localization;
- `diagnostics.validationAttempts`: zero or more validation/compilation
  attempts, each retaining its complete diagnostic array;
- `diagnostics.conformance`: zero or more matched comparison records, each
  containing exactly one verified conformant report identity or one verified
  structured conformance diagnostic;
- `migrations`: comparison-local dispositions and immutable outcome history;
- `summary`: counts derived from detailed records;
- `artifacts`: logical artifact IDs, semantic digests, media types, and raw-byte
  checksums;
- `redaction`: applied policy and omitted field classes;
- `integrity`: canonicalization and digest algorithm; and
- `reportDigest`: SHA-256 of the canonical envelope without `reportDigest`.

## Cardinality

Kernel plan/catalog validation returns diagnostic arrays. The envelope stores
the array under one `validationAttempt` and does not split it into fictional
independent commands.

Catalog conformance produces a matched assessment. Each conformance record
stores either:

- `result: conformant`, a non-null `reportIdentity`, and `diagnostic: null`; or
- `result: rejected`, `reportIdentity: null`, and one non-null diagnostic.

The section arrays permit multiple attempts/comparisons without collapsing their
native result shapes.

## Summary derivation

`summary` is not authoritative input. Producers derive it after detailed records
are complete; verifiers recompute it before checking the report digest. Counts
are:

- controller diagnostics;
- validation attempts;
- validation diagnostics across those attempts;
- conformance records;
- conformant records;
- declaration-repairable diagnostics;
- genuinely non-equivalent diagnostics;
- insufficient-evidence diagnostics; and
- migration records.

A count mismatch is an identity failure even when `reportDigest` was recomputed
by a malicious or broken producer.

## Migration dispositions

The five presentation categories are:

1. `identity-only`;
2. `declaration-review`;
3. `declaration-repairable`;
4. `genuine-non-substitution`; and
5. `invalid-or-unverifiable`.

Every guidance object fixes `autoAccepted` to `false`. `review-declaration` is
conditional and requires a written `safetyCondition`. `genuine-non-substitution`
structurally requires `do-not-substitute`.

`outcomes[0]` must be `initial`. At most one later `post-repair` outcome may be
appended; phases must be unique. A repair never overwrites the initial
assessment.

## Determinism and identities

Serialization uses `lachesis-canonical-json/1` with exactly one trailing LF.
Object keys sort lexically; array order is protocol-significant. Producers sort
set-like inputs before report construction.

Command identity is the digest of:

```json
{
  "protocol": "lachesis-catalog-command-identity/1",
  "command": "catalog.compare",
  "version": "1",
  "inputs": ["<ordered logical identity records>"],
  "options": ["<normalized semantic options only>"]
}
```

Report destinations, absolute paths, wall time, process ID, hostname, and
environment do not participate. Artifact `digest` identifies canonical semantic
content; `checksum.value` identifies exact raw bytes.

## Redaction

Reports must omit:

- credentials, tokens, environment variables, argv values not already normalized
  as public command options, and crash data;
- absolute paths, home directories, temporary paths, and host identities;
- source code, function bodies, arbitrary catalog values, and unbounded
  diagnostic inputs;
- provider/model request or response content; and
- stack traces in normal reports.

Diagnostics may contain registered IDs, versions, roles, boundaries,
obligations, resource limits, stable codes, and content digests. Unexpected
errors render a stable controller code and keep the stack trace on local stderr
only.

## Forward compatibility

Version 1 is strict: unknown fields and unknown protocol strings reject. New
optional semantics require protocol `/2`; they must not be silently ignored by
v1 verifiers. Human renderers may display an unsupported-protocol message but
must return exit `20`.

Stable diagnostic codes remain native kernel or conformance codes. The envelope
does not translate them into a smaller lossy enum.
