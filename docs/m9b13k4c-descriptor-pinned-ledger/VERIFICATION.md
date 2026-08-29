# M9b.13k.4c verification

The authoritative verification ran on Node 24.20.0 under the exact preserved
loopback-only sandbox profile. The corrected identity suite passed 16/16; the
preserved M9b.13k.4, M9b.13k.4a, and M9b.13k.4b suites passed 89/89; the
combined run passed 105/105.

Focused corrected-module coverage passed repository thresholds at 95.34%
statements (41/43), 90.00% branches (18/20), 100.00% functions (5/5), and 95.00%
lines (38/40).

Complete serialized tests passed 1,548/1,550. The only failures reproduced the
accepted baseline: a frozen Darwin 25.5 fixture on kernel 25.6 and the older
M9b.13k.2 nested-sandbox proof. Complete serialized coverage passed 1,547/1,550;
in addition to those two failures, instrumentation caused the older M9b.12f
rederivation to exceed its 5,000 ms timeout, suppressing the aggregate summary.
The ordinary serialized run passed M9b.12f.

Workspace typecheck and build, deterministic native builds, Node and Workers
smokes, CLI valid/invalid smokes, changed-source lint, source safety, unsafe
escape, public API, and all predecessor checksum manifests passed. Global lint
reproduced only two historical M9b.13h project-service errors.

Independent ordering, framing, permutation, and mutation checks passed. The
22-entry inventory identity is
`cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb`. Every
bound-entry mutation changed it, including the comparator source.

The sandbox allowed IPv4 and IPv6 loopback and denied non-loopback IPv4,
non-loopback IPv6, and direct DNS UDP with `EPERM`. No external endpoint was
contacted.

The disposition is:

`m9b13k4c-bytewise-identity-correction-ready-for-independent-review`
