# Genuine and synthetic EINTR evidence

M9b.13k.4b distinguishes production retry behavior, deterministic synthetic
conformance injection, and genuine asynchronous signal interruption.

The production helper contains the real retry loops but is compiled without
`M9B13K4B_CONFORMANCE`. Its normalized bytes do not contain the synthetic
failure environment name, and the wrapper rejects synthetic failure options for
a production capability.

The separately identified conformance helper is compiled with
`-DM9B13K4B_CONFORMANCE=1`. It reports helper variant, received signals, actual
syscall `EINTR` returns, synthetic failures, and synthetic partial bytes in its
private invocation receipt.

Genuine asynchronous `SIGUSR1` tests interrupt:

- a blocked barrier read;
- `flock` while an external process retains the authoritative log lock;
- a blocked stdin payload read before append admission.

Each returns `receivedSignalCount: 1` and `actualEintrCount: 1`, then completes
without duplicate append or corruption.

Darwin regular-file writes cannot be deterministically signal-interrupted. The
conformance-only partial-progress harness therefore returns three controlled
bytes, then one synthetic `EINTR`, then resumes the same production write
helper. Header, payload, and footer cases each report three partial bytes and
one synthetic failure. Audit validates the final record, and the canonical
payload occurs exactly once. This evidence is synthetic and is never described
as a genuine signal interruption.
