# M9b.13k threat model

## Authority

An OSF PAT with `osf.full_write` can write across the holder's account. The
provider does not confine it to project `bmsda`. The private controller,
activation binding, durable CAS ledger, URL policy, response schemas,
one-request budgets, and mandatory terminal revocation are the trust boundary.

## Protected assets

- The PAT value and every mutable byte buffer containing it.
- The non-secret but activation-bound token ID.
- Project and draft confinement.
- The exactly-once PUT and revocation budgets.
- The frozen 245-byte artifact identity.
- Durable dispatch history across interruption and restart.
- Complete URL values returned by OSF and Waterbutler.

## Principal threats and controls

| Threat                                                                                                              | Required control                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential recovery from environment, argv, stdin, files, clipboard, logs, errors, URLs, receipts, or serialization | One bounded anonymous FD3 read, immediate close, strict 64-character format, no fallback, token-redaction checks, mutable-buffer zeroization                            |
| Account-wide PAT used against another project or registration                                                       | Exact API host and path constructors, project `bmsda` and provider `osfstorage` invariants, rejection of registration `63sh5` and all unbound resources                 |
| Malicious upload or download link                                                                                   | HTTPS-only ASCII host allowlist, no userinfo/fragment/port/IP/punycode/suffix ambiguity, exact resource/provider path validation, domain-separated full-URL digest only |
| Duplicate upload after timeout, crash, interruption, malformed response, or restart                                 | Durable CAS reservation and pre-dispatch event, one PUT budget, terminal ambiguity, replay inspection before credential use, never redispatch a recorded PUT            |
| Hidden remote state through pagination                                                                              | Bounded complete traversal with page/record caps, cycle detection, three protected filename checks, exact post-upload inventory                                         |
| Redirect replay                                                                                                     | Every request binds `redirect=error`; any 3xx is terminal and Location is never consumed                                                                                |
| Oversized or malformed response                                                                                     | Per-class byte ceilings, parse through the kernel JSON boundary, Zod validation, exact status/entity/resource/provider/name/kind checks                                 |
| Token remains live after success or failure                                                                         | Normal and finally-style single revocation attempt plus separately controlled non-secret custodian verification; success is impossible without verified revocation      |
| Ledger or receipt tampering                                                                                         | Domain-separated canonical event digests, revision/root compare-and-swap, activation/request binding, hostile tamper tests, terminal security stop                      |
| Controller or SDK retries                                                                                           | Zero-retry transport contract, concurrency one, exact dispatch counters, hostile second-PUT and retry tests                                                             |

## Residual boundary

This phase is offline. It does not prove the OSF API, Waterbutler, browser
custodian, host kernel, runtime, or operator trustworthy. A later ceremony must
reproduce the exact source, tests, artifact, request ceilings, project/draft
binding, and revocation protocol before creating one temporary PAT. M9b remains
NO-GO.
