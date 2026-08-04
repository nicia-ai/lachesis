# M9b.13c offline OCI acquisition boundary

M9b.13c implements executable, synthetic enforcement for the seven M9b.13b
review findings but seals `acquisition-boundary-no-go` because two essential
offline dependency closures are unavailable.

No independent OCI-layout SBOM scanner is installed or present in the workspace
dependency closure. The local comparator is deterministic but cannot derive an
inventory independently from image layers, so it is not accepted as equivalent
evidence.

Node 24 exposes useful path and descriptor primitives, but not the complete
directory-file-descriptor-relative `openat`/no-clobber rename and mount-identity
surface needed to claim race-resistant destination admission. No local helper is
selected or built.

Accordingly, the prospective authorization is withheld. No network runner is
activated, no output root is created, and M9b.13 remains a materialization
NO-GO. M9b.13b remains byte-identical and retains its original independent
review disposition.

The private implementation provides fully intercepted tests for HTTPS and
network isolation, scoped anonymous bearer responses, Git object reconstruction,
streaming byte counters, GPG status parsing, exact quarantine, evidence/SBOM
semantics, and synthetic destination identity failures. These checks reduce the
remaining correction surface but do not overcome the two dependency blockers.
