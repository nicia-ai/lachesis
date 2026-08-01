# M9b.12c offline preregistration package

Package: `lachesis-m9b12c-offline-preregistration-package@1.0.0`.

Quarantine: `lachesis-m9b12c-retired-corpus-quarantine@1.0.0`.

History: `lachesis-m9b12c-append-only-quarantine-history/1`.

Registration: `lachesis-m9b12c-append-only-external-registration/1`.

Status: offline immutable superseding draft, not externally registered.

Canonical preregistration digest:
`62cff37dae7332855b8f7a8f9583f5b5f0917adde2d9b2c019603fb101392fc3`.

## Narrow correction

M9b.12c changes only durable observer-quarantine history, atomic append and
startup revalidation, full terminal per-role assertions, supersession,
registration binding, and hostile tests. It preserves the accepted scientific,
financial, operational, security, and authority values from M9b.12b.

The evaluator receives an opaque repository capability rather than caller
history. Quarantine records are chained and committed by compare-and-swap. A
previously quarantined observer always receives
`observer-previously-quarantined`. Clean receipts bind the exact authoritative
head and fail revalidation after any intervening append.

## Supersession

The exact append-only order is M9b.12, M9b.12a, M9b.12b, then M9b.12c. Every
predecessor remains byte-identical, checksum-valid, unregistered, and superseded
under its recorded disposition.

## Effects and authority

No corpus, retired material, schedule instance, gold, credential, provider,
registry, network, or push effect exists. No external registration, corpus
materialization, provider access, count, inference, probe, primary, publication,
release, or push authority is granted.
