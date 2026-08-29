# M9b.13k.5 verification

The authoritative focused verification used Node 24.20.0 under the exact
checked-in loopback-only sandbox profile. The pure schema/state-model suite
passed 60/60. The preserved M9b.13k.4, 4a, 4b, and 4c suites plus M9b.13k.5
passed 165/165. All four predecessor checksum manifests verified.

Focused coverage passed repository thresholds: 94.75% statements (325/343),
90.72% branches (225/248), 100% functions (40/40), and 95.71% lines (313/327).
The property test ran 128 generated request-count/replay cases. The exhaustive
matrix examined all 440 state/event pairs and every one of the 37 allowed
transition specifications.

The complete serialized workspace run passed 1,608/1,610. Its only failures were
accepted unrelated baselines: M9b.13d.1 freezes Darwin 25.5.0 while this host
reports 25.6.0, and M9b.13k.2 attempts a nested sandbox inside the already
enforced sandbox and exits 71. All M9b.13k.5 and preserved-ledger tests passed.
Focused coverage is the authoritative coverage result; a redundant complete
coverage run was not repeated because the same accepted complete-suite failures
prevent a clean aggregate gate.

Strict package TypeScript and build passed under explicit Node 24. Workspace
typecheck/build, Node and Workers smokes, CLI valid/invalid exits 0/1,
changed-source lint, source safety, unsafe-escape checks, public API audit, and
formatting passed. Global lint reproduced only the two historical M9b.13h
project-service errors.

The sandbox allowed IPv4 and IPv6 loopback and returned immediate `EPERM` for
numeric non-loopback IPv4, numeric non-loopback IPv6, and direct DNS UDP. No
external endpoint was contacted.

The disposition is:

`m9b13k5-offline-controller-integration-design-ready-for-independent-review`
