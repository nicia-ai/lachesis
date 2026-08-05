# M9b.13e threat-model lineage

The immutable OSF registration does not require resistance to a malicious
process already running as the acquisition UID. Registration `63sh5` instead
places the controller host operating system and privileged operator inside the
trusted computing base and expressly excludes malicious or compromised
privileged host/operator and kernel/hypervisor compromise.

The registered package was submitted at `2026-08-02T19:19:33.924946Z`, approved
at `2026-08-02T20:03:47.850242Z`, and contains 27 immutable version-one files.
Its preregistration digest is
`097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4`; its manifest
digest is `5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189`.

## Where the stronger attacker entered

M9b.13 added local readiness controls for private roots, dedicated roles, and
filesystem drift after registration. M9b.13c then made directory-relative,
race-resistant destination admission a blocking local dependency. M9b.13d
attempted to implement that closure. Its independent review made the attacker
explicit by reproducing a same-effective-UID swap and treating it as within the
submitted M9b.13d threat model. M9b.13d.1 preserved that local attacker and
returned NO-GO when Darwin could not execute verified helper bytes through an
inherited descriptor.

Therefore the same-UID condition is a later local defense-in-depth requirement,
not a registered scientific claim. Removing it from the acquisition threat model
does not reinterpret the OSF bytes. It does require a transparent prospective
operational amendment to the later local readiness regime before corpus
construction.

Scientific validity requirements—freshness, contamination prevention, arm
blindness, hidden-gold isolation, paired allocation, provider accounting,
replay, and the registered analysis—remain mandatory. The estimand, population,
allocation, settings, budget, isolation, quarantine, and analysis cannot change
without a separate externally reviewed scientific supplement.
