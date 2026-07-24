# M8b.0 exit-code contract

| Code | Stable class                 | Meaning                                                                                | Safe CI default                                       |
| ---: | ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
|    0 | success                      | Valid manifest, identical inputs, compatible finite conformance, or verified report    | Pass                                                  |
|   10 | review-required              | Structurally valid identity/declaration change without sufficient semantic evidence    | Fail unless CI explicitly routes to author review     |
|   11 | declaration-repairable       | Conditional declaration repair; never accepted automatically                           | Fail                                                  |
|   12 | genuinely-non-equivalent     | Semantic obligation differs; do not substitute                                         | Fail                                                  |
|   13 | insufficient-evidence        | Valid inputs but no defensible equivalence decision                                    | Fail                                                  |
|   20 | invalid-input                | Invalid catalog, policy, manifest, suite, report shape, or unsupported protocol        | Fail                                                  |
|   21 | compilation-policy-rejection | Plan/validation attempt rejected by structural, semantic, capability, or budget checks | Fail                                                  |
|   22 | identity-mismatch            | Report/nested identity, manifest digest, or artifact checksum mismatch                 | Fail and investigate integrity                        |
|   23 | incomplete                   | Missing artifact, interruption, timeout, or partial controller result                  | Fail; safe resume may rerun the same command identity |
|   64 | usage                        | Unknown command/flag, invalid locator, or missing/mutually exclusive option            | Fail; no report is emitted                            |
|   70 | internal-controller-failure  | Unexpected invariant or controller failure                                             | Fail and investigate                                  |

Precedence when several conditions appear:

1. internal controller failure (`70`);
2. incomplete result (`23`);
3. identity mismatch (`22`);
4. invalid input (`20`);
5. genuine non-equivalence (`12`);
6. insufficient evidence (`13`);
7. declaration-repairable (`11`);
8. compilation/policy rejection (`21`);
9. review required (`10`);
10. success (`0`).

The private prototype derives codes from detailed records and rejects an
envelope whose recorded code does not match. Process wrappers must preserve the
code; signals and operating-system launch failures are outside this contract.
