# M9b.13f.1 independent review

Decision: `m9b13f1-corrected-minimal-operational-supplement-review-no-go`

Append-only disposition: `reviewed-no-go-superseded-prospectively-by-m9b13f2`

## Blocking corrections

1. **P1, confidence 10/10 — canonical JSON was not normatively unique.**
   `BODY-PAYLOAD.json` and the author attestation named a compact sorted-key
   encoding without fixing RFC 8785 string escaping, number serialization,
   Unicode handling, or the accepted I-JSON domain. Ordinary `/` and escaped
   `\/` representations parsed to the same value but produced different body and
   signing-input digests. M9b.13f.2 must use RFC 8785, reject duplicate keys
   before parsing can collapse them, reject unsupported values, and define one
   enumerated unsigned-attestation projection.

2. **P1, confidence 10/10 — the future review-receipt contract omitted direct
   package, author-evidence, and review-evidence inventory bindings.** The
   contract required an opaque `review-evidence-digest`, an ambiguous singular
   `author-attestation-digest`, and no direct package-inventory canonical
   digest. M9b.13f.2 must require exact author key and attestation identities,
   final Git identity, reviewer identity and signature, exact decision, and a
   canonical per-artifact review-evidence inventory.

## Accepted independent reproductions

- Final M9b.13f.1 commit: `5673b77d50867ebf4dd202d00699429db989e41a`; tree:
  `7e350f1bff7f9e19cb3cb21c1fa292b9c7828adf`.
- Body protocol:
  `lachesis-m9b13f1-embargo-compatible-operational-supplement-body/1`; body
  digest: `56ffe1f5c1fa7e43a7ab37367b630efc60fa530a126dbb499532a378dacd663b`.
- `BODY-PAYLOAD.json` raw SHA-256:
  `b3e5c0787329f4e6c1771f2647d00513338a0272a6c34d27a1f8b701507294e6`.
- Complete checksum-manifest digest:
  `d71d22bfef0b8098173da6666ce3e1c970bb96494aa856edb2310318e4a1ef76`.
- Package-inventory canonical digest:
  `f8a12040854cbd4af07317e71b86b6deb60f78e85dac37bbf7cf71bd42febdff`.
- All 19 substantive payload artifacts and all 30 package artifacts were
  reproduced with exact byte lengths and hashes; every payload mutation changed
  or invalidated the body identity.
- The RFC 8410 Ed25519 public key, domain-separated author commitment, signed
  projection under the package's documented encoding, and signature verified.
- The exact 17-record historical NO-GO inventory, including `M9b.13a.review`,
  was reproduced against Git history.
- All 27 immutable registration archive identities, registration `63sh5`, the
  embargo through `2030-08-01T00:00:00Z`, and the 18-field scientific and
  financial digest
  `e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282` reproduced
  unchanged.
- Predecessor packages and review evidence remained byte-identical. No network,
  OSF, credential, provider, corpus, execution, analysis, publication, push,
  embargo, or M10 effect occurred.

This review grants no submission or operational authority. It created no
reviewer key or review receipt. M9b remains NO-GO.
