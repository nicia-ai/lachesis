# M3b.2: typed answer and diagnostic protocol correction

Status: implemented offline. No M3b.2 provider call is authorized by this
document or by materialization.

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

Fresh M3b.2 identities bind the new prompt, typed output schema, scorer,
provider adapter, transport, source commit, and a separate content-addressed
storage namespace. After external preregistration, the only next live gate is a
fresh 16-record probe with at most one symmetric transport retry per record. The
probe must produce 16 non-opaque, durably classified outcomes, correct typed
answers or abstentions relative to visible evidence, passing results from both
providers on the prior graph-facts failure shape, and zero unauthorized calls or
identity mismatches. It does not authorize calibration or held-out inference.
