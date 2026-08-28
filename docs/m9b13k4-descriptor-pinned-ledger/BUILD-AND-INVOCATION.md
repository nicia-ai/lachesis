# Helper build and invocation identity

The build uses `/usr/bin/xcrun clang` with fixed arguments
`-std=c17 -Os -Wall -Wextra -Werror`. The Apple linker emits a per-output UUID
and an ad-hoc signature, so raw first-pass builds differ. The reviewed
normalization removes the signature, replaces the single `LC_UUID` payload with
the first 16 bytes of the helper-source SHA-256, and ad-hoc signs with the fixed
identifier `org.nicia.lachesis.m9b13k4-ledger`. Two independent output paths
then produce byte-identical, executable Mach-O files.

The build receipt binds helper source, compiler version, SDK path, target
architecture, flags, linked libraries, executable length/hash/device/inode, and
the normalization protocol. The implementation inventory additionally binds the
TypeScript caller and message-schema source, emitted JavaScript and
declarations, build protocol, and normalized executable bytes.

The capability returned by the build is backed by a closure-private `WeakMap`.
Ordinary objects and structural clones cannot invoke the wrapper. Each spawn
uses the exact capability-bound path and arguments without a shell, a sanitized
environment containing only the fixed `PATH` and explicit conformance fault
controls, bounded stdin/stdout/stderr, a five-second deadline, kill-and-reap on
timeout, and strict one-line output parsing. Unexpected stderr, extra output,
malformed fields, abnormal exits, and helper replacement reject.

Path execution remains subject to the trusted controlled-host assumption. The
checks detect substitution immediately before or during a completed invocation;
they do not claim adversarial same-UID atomicity across the kernel's pathname
execution step.
