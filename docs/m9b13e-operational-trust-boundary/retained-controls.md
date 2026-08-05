# M9b.13e retained controls

The trusted-host amendment removes only the claim of resistance to a malicious
process already running as the operational UID. It does not weaken the hostile
external-byte boundary or scientific-isolation controls.

Exact platform and manifest binding, ELF AArch64 validation against signed Node
release evidence, trailing tar rejection, terminal framing before sealing,
descriptor reuse for hashing and parsing within one trusted process, exact
provenance/SPDX binding, and digest verification immediately before every
consequential use remain mandatory.

The temporary-publication identity checks from finding 1 remain defense in
depth. They protect correctness and expose ordinary races, but are not claimed
to defeat a malicious same-UID peer. Finding 6 is split: exact acquired-evidence
identities remain mandatory; descriptor-bound Darwin helper execution against a
malicious same-UID pathname replacement is no longer required.

The operational session must be clean and controlled, use a dedicated private
root, have no unrelated process under its UID, verify code and tool digests
before startup, use an exact signed descriptor graph, contain no credentials,
freeze network allowlists and bounds, use zero retries, quarantine ambiguity,
rehash before scan/export/import/use, retain append-only receipts, never execute
an acquired image, independently verify the result, quarantine or destroy
partial state, and account for every process and effect.

Pathname hashing is not represented as protection against a malicious same-UID
process. Such a process is explicitly outside the amended threat model.
