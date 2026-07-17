# M3b.2: typed answer and diagnostic protocol correction

Status: historical `complete-semantic-gate-fail`. The executed probe, ledger,
report, and preregistration artifacts are immutable and must not be rerun.

M3b.2 is a deterministic protocol correction made after the M3b.1 protocol probe
and before calibration or held-out access. It leaves the four evidence arms,
corpus, models, reasoning settings, Williams schedule, transport retry policy,
contrasts, and prospective statistical gates unchanged.

## Typed model-visible contract

Every request contains the public instruction, a public answer shape, and the
normalized evidence context. It never contains the arm or source identity,
expected answer values, ground-truth citations, or scores. The response wire
shape is:

```json
{
  "outcome": "answered | insufficient-evidence",
  "answerValues": [],
  "citationIds": [],
  "pathIds": []
}
```

`answerValues` contains only scalar or ordered/unordered typed values described
by the public answer shape. Prose is not scored. An `insufficient-evidence`
outcome requires no answer values. Visible paths receive canonical IDs in the
model context; the model references those IDs and never reconstructs correlated
fact and edge arrays.

The provider JSON Schema and runtime wire validator accept exactly the same
structural language. Reference uniqueness, answer cardinality, visible-ID
membership, expected answer/citation correctness, and path utilization are
domain checks applied after the response envelope and all exposed usage have
been captured.

## Durable failure provenance

Every provider attempt records whether it failed before dispatch, during
transport, at provider-response handling, or during wire decoding. The durable
sanitized provenance includes provider status/error code and response ID when
available, finish reasons, usage availability, output presence, bounded output
digest and byte size, and Zod issue codes and paths. Domain-invalid wire outputs
remain usage-accounted records with an explicit `semantic-validation` stage;
they are not converted into opaque transport exceptions.

Only overload, timeout, and unavailability are retryable. A wire
`contract-mismatch` and every semantic failure are deterministic and never
receive a controller transport retry.

## Historical and next identities

The M3b.1 probe `a104cd5c...` is `complete-protocol-fail`. M3b.1 calibration
`a4e61610...` and held-out `9feb01a0...` are `superseded-unexecuted`. Controller
preflight rejects all three identities before credentials, reservations, ledger
mutation, or dispatch.

The M3b.2 probe completed 16 durable, non-opaque outputs but passed only 15/16
typed semantic outcomes. A lexical multi-hop response returned the visible
employer as the answer when the requested headquarters city was not visible.
Because M3b.2 exposed only a generic scalar shape, domain validation could not
reject that intermediate semantic role. Calibration and held-out identities are
`superseded-unexecuted`.

[M3b.3](./m3b3-semantic-obligations.md) replaces generic answer shapes with
public executable answer obligations and one bounded semantic repair. It
requires a fresh preregistration and exact authorization before any live call.
