# M9b.13k.4b verification

The corrected focused suite passed 33/33 inside the exact checked-in
loopback-only sandbox. The preserved M9b.13k.4, M9b.13k.4a, and corrected
M9b.13k.4b suites passed 89/89. Focused coverage passed repository thresholds at
90.27% statements, 85.75% branches, 96.82% functions, and 92.12% lines.

The barrier lifecycle regressions return prompt deterministic failures before
readiness, never leave a promise pending, preserve append ambiguity only after
release, and tolerate repeated release and late events. The former invalid
namespace case completes before its 150 ms deadline with the native
namespace-admission rejection rather than timeout ambiguity.

Correctly encoded big-endian reserved-byte probes passed for all twelve
individual offsets and the combined mutation. Each failure was specifically
attributed to nonzero reserved bytes. The zero-reserved control succeeded.

Genuine asynchronous signals produced one received signal and one actual syscall
`EINTR` for barrier read, blocked `flock`, and blocked stdin read. Synthetic
partial-progress tests remained explicitly synthetic and proved exact
continuation after three bytes without duplicate payload or corrupt records.

Snapshot and audit each passed five exact externally lock-held pathname races.
Every run proved the inspector was blocked on the original log, replaced the
pathname with a different inode, and returned post-inspection identity ambiguity
after release.

Two independent production builds and two independent conformance builds were
byte-identical within each variant. The variants have different executable
hashes and fixed signing identifiers. The production executable contains no
synthetic failure environment name. Strict native warnings, clang-format, and
ASan/UBSan create/snapshot/append/audit passed.

Workspace typecheck and build, changed-source lint and formatting, Node/Workers
smokes, CLI valid/invalid smokes, source-safety, public-API, predecessor
manifests, identity mutations, and `git diff --check` passed. All executable
gates were run inside the sandbox.

Baseline drift is recorded exactly. Complete serialized tests and coverage each
reached 1,532/1,534. The two isolated failures are the frozen Darwin 25.5
fixture on kernel 25.6 and an older M9b.13k.2 test that attempts a nested
sandbox proof inside the already enforced k4b sandbox. Global lint retains two
historical M9b.13h project-service errors. None intersects the k4b paths.

The disposition is:

`m9b13k4b-corrected-descriptor-ledger-ready-for-independent-review`
