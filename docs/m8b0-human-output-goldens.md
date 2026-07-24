# M8b.0 human and manifest-diff output

Human output is deterministic, color-free text on stderr. It is explanatory; the
JSON report is authoritative.

## 1. Identity-only compatible change

```text
catalog.compare: compatible (exit 0)
left  northstar.incident/catalog@1  fingerprint=fad0ba67…
right northstar.incident/catalog@2  fingerprint=396dba14…

IDENTITY-ONLY
  Catalog and manifest identities changed.
  The supplied finite conformance suite passed 4 schema roles, 9 operation
  roles, and 25 values.

Guidance: retain both manifests and the verified report, then recompile plans
against the candidate fingerprint.
```

This is not universal semantic-equivalence evidence.

## 2. Declaration review required

```text
catalog.compare: review-required (exit 10)
boundary semantic-role-declarations

DECLARATION REVIEW REQUIRED
  Manifest role declarations changed, but no conformance suite was supplied.

Guidance: inspect the written role contracts and rerun with --suite.
Not accepted automatically.
```

## 3. Conditionally repairable declaration

```text
catalog.compare: declaration-repairable (exit 11)
ROLE_VERSION_MISMATCH
role       northstar.role/record-incident-decision@1
boundary   role-version:northstar.role/record-incident-decision
obligation exact-role-version

CONDITIONAL DECLARATION REPAIR
  Review which written role version each catalog actually implements.

Safety condition: if the versions intentionally denote different semantics,
do not edit metadata and do not substitute.
Not accepted automatically.
```

The CLI says “review,” never “fix,” “corrected,” or “equivalent.”

## 4. Genuine semantic non-substitution

```text
catalog.compare: rejected (exit 12)
CAPABILITY_MISMATCH
role       northstar.role/record-incident-decision@1
boundary   effect-capability
obligation same-capability

DO NOT SUBSTITUTE
  The operations require different capabilities. Metadata changes cannot
  manufacture equivalence.
```

No repair command is printed.

## 5. Invalid or unverifiable input

```text
catalog.compare: invalid (exit 20)
INVALID OR UNVERIFIABLE
  Candidate manifest does not equal the manifest regenerated from its bound
  catalog and policy.

No compatibility decision was made.
```

## Golden artifacts

Executable prototype goldens live under
[`studies/m8b0-cli-contract/goldens`](../studies/m8b0-cli-contract/goldens).
They cover compatible, declaration-repairable, genuinely non-equivalent, and
multi-diagnostic compilation-rejection reports. Tests verify canonical bytes,
human rendering, exit codes, cardinality, report identities, summary derivation,
repair safety, and initial/post-repair separation.
