# M9b.13e topology comparison

## Recommended: trusted controlled host

Use the registered trusted-host model: trust the host kernel, acquisition
controller, installed runtime, and operator; require no malicious concurrent
process under the acquisition UID; continue treating every external byte as
hostile. Reverify content immediately before every consequential use and
quarantine anything incomplete, changed, or ambiguous. Make no claim against
local account compromise.

This is the narrowest topology that preserves the scientific design without
introducing a new platform supply chain. It is proportional to a retrieval
quality experiment rather than a local-adversary security evaluation.

## Dedicated local principal

A fresh non-login account, custodian-owned read-only tools, a private root,
process census, role separation, and an empty Docker configuration would add
useful defense in depth. It does not remove trust in root, the custodian, or the
kernel and adds account-lifecycle and custody requirements. It is not necessary
for the registered claim and this milestone creates no account.

## Isolated Linux acquisition runner

Linux arm64 could provide `openat2`, `fexecve` or `execveat`, and PID, user,
mount, and network namespaces. But it introduces identities and availability
requirements for the boot image, runner image, kernel, build provenance, SBOMs,
sandbox policy, digest-only export, artifact transfer, and recovery. Those are
recursive supply-chain dependencies, not a free security improvement. The
registered scientific claim does not justify that expansion.
