# Future trusted-host readiness requirements

Protocol: `lachesis-m9b13f-future-trusted-host-readiness-requirements/1`

This is a static requirements document, not an implementation or detailed
runtime schema.

A future package must use a new protocol identity and version and a new
implementation. It may not import, activate, or reuse the M9b.13e.1, M9b.13e.2,
or M9b.13e.3 runtime modules.

It must bind and implement an authoritative expectation package; authoritative
collector and verifier; exact controller, runtime, helper, and scanner
identities; trusted-session startup gate; process census and topology;
pre-effect admission; effect-bound monitoring; terminal accounting; durable
anti-replay authority; exact platform and manifest; descriptor-bound hash and
parse; ELF AArch64 and signed Node-distribution identity; trailing and
concatenated tar rejection; exact acquired-evidence receipts; terminal framing
before seal; ordinary-race protections; and zero-effect stop and quarantine.

The package must pass offline tests and independent hostile review.
Materialization binding requires a separate review, and acquisition requires a
separate authorization issued only after a pass.
