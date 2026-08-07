# Future trusted-host readiness requirements

Protocol: `lachesis-m9b13f1-future-trusted-host-readiness-requirements/1`

This is a static requirements document, not an implementation or detailed
runtime schema. No listed control currently exists or has passed.

A future package must use a new protocol identity and version and a new
implementation. It may not import, activate, reuse, or use as readiness evidence
the M9b.13e.1, M9b.13e.2, or M9b.13e.3 runtime modules.

It must bind and implement authoritative expectations; an authoritative
collector and verifier; exact controller, runtime, helper, and scanner
identities; a startup gate; process census and topology; pre-effect admission;
effect-bound monitoring; terminal accounting; durable anti-replay authority;
platform and manifest binding; descriptor-bound hash and parse; ELF AArch64 and
signed Node identity; trailing and concatenated tar rejection; exact evidence
receipts; terminal framing; ordinary-race controls; and zero-effect stop and
quarantine.

The future package must pass offline tests and independent hostile review.
Materialization requires a separately reviewed binding, and acquisition requires
a separate authorization issued only after a pass.
