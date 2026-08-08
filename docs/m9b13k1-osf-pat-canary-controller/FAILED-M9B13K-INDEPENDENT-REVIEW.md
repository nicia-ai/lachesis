# Failed M9b.13k independent review

The independent adversarial review of M9b.13k returned `FAIL`. M9b remains
`NO-GO`.

Reviewed identities:

- commit: `154e1cac4aa4e85075ae3b577bcc824607a34ad9`
- tree: `d2d3f5e386bbecb04be3f8e88616b4651d6275c6`
- implementation commit: `1709a66bbff33cfa6065ee8bdf442cb9be19ed83`
- package manifest SHA-256:
  `dcff1600481214910c7575173598f50d63cc3d800fcd6b5193a6dbcf4298cc73`

The review found seven P1 defects and one P2 evidence defect:

1. activation was self-authorized by ordinary caller-selected input;
2. credential, ledger, transport, clock, and custodian dependencies were
   caller-controlled;
3. deadlines and response ceilings were advisory rather than operational;
4. restart after a recorded PUT acquired another credential;
5. durable receipts and cumulative accounting did not substantiate effects;
6. the FD3-unavailable path could close an unrelated Node/libuv descriptor;
7. post-upload download identity was not reconciled to the returned object;
8. the 76-case evidence and repository coverage gate overstated coverage.

The old M9b.13k package is preserved byte-for-byte. Its readiness rationale is
superseded and must not be used as authority for a PAT ceremony, activation,
network request, OSF mutation, cleanup, retry, or publication.

M9b.13k.1 is a new append-only correction namespace. It does not reinterpret or
amend any M9b.13k artifact.
