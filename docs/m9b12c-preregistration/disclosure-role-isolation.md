# Disclosure and role isolation

The canonical influence-bearing roles are constructor, materializer, study
operator, author, evaluator, adjudicator, analyst, auditor, campaign controller,
runtime controller, control-plane bootstrap, and credential custodian.

No role may access a retired namespace or receive retired locators, identifiers,
filenames, snippets, content, metadata, ordering, or structural mappings. An
observer exposed to any such value is permanently excluded from all later
influence-bearing roles under its canonical observer commitment.

Exclusion is not a caller assertion. The evaluator queries the opaque trusted
repository directly. A new role, session, derived inventory, controller, or
process does not remove the observer’s history. There is no role-local cleanup,
reassignment, expiration, rehabilitation, or reset exception.

Auditor and bootstrap inputs may contain only approved minimum opaque public
counts. Counts cannot be paired with identity, order, content, or mappings.
Bootstrap control cannot disclose or propagate retired locators or identities.

The public package may contain protocol identities, immutable predecessor
commit/tree/digest bindings, aggregate counts, construction rules, analysis and
gates, and financial/security controls. It must not contain retired corpus
locators or identifiers, future case/document/packet identities, hidden gold,
expected citations, construction seeds, credentials, secrets, private paths,
personal identifiers, or custody details that weaken security.
