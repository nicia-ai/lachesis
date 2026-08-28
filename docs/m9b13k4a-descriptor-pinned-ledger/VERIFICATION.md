# Verification and disposition

The corrected Darwin-native suite passed 31/31 inside the exact checked-in
loopback-only sandbox. It includes the six correction families, 100 genuine
two-process same-root barriers with exactly one winner per race, every preserved
crash boundary, framing tears and garbage, rollback, symlink/hardlink and
namespace replacement, executable substitution and timeout, cross-process
reopen, and deterministic native builds. IPv4 and IPv6 loopback succeeded;
numeric IPv4, numeric IPv6, and direct DNS UDP probes failed immediately with
`EPERM`. No external service was contacted.

Focused corrected-wrapper coverage passed repository thresholds: 91% statements,
85.97% branches, 94.11% functions, and 92.11% lines. Clang strict compilation,
clang-format, ASan/UBSan create/snapshot/audit, workspace typecheck and build,
changed-file format/lint, Node/Workers smokes, CLI valid/invalid smokes, source
safety, secret scan, public-API audit, both predecessor manifests, and
`git diff --check` passed.

Baseline drift is not concealed. Complete single-worker tests and coverage each
reached 1,500/1,501; the only failure, reproduced in isolation, is a historical
M9b.13d1 fixture expecting Darwin `25.5.0` on the current `25.6.0` host. Global
formatting reports 19 untouched predecessor files. Global lint reports two
historical M9b.13h project-service errors. The frozen generator package digest
also remains mismatched. None intersects M9b.13k.4a, and none was rewritten.

The exact disposition is:

`m9b13k4a-corrected-descriptor-ledger-ready-for-independent-review`

This authorizes only another independent adversarial read-only review. M9b
remains NO-GO. It does not authorize controller integration, activation,
credentials, OSF, non-loopback networking, publication, provider calls, or push.
