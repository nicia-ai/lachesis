# Disclosure and role isolation

The canonical influence-bearing roles are constructor, materializer, study
operator, author, evaluator, adjudicator, analyst, auditor, campaign controller,
runtime controller, control-plane bootstrap, and credential custodian.

No role may access a retired namespace or receive retired locators, identifiers,
filenames, snippets, content, metadata, ordering, or structural mappings. An
observer exposed to any such value is excluded from all later influence-bearing
roles. There is no role-local cleanup or reassignment exception.

Auditor and bootstrap inputs may contain only approved minimum opaque public
counts. Counts cannot be paired with identity, order, content, or mappings.
Bootstrap control cannot disclose or propagate retired locators or identities.

The public package may contain protocol identities, immutable predecessor
commit/tree/digest bindings, aggregate counts, construction rules, analysis and
gates, and financial/security controls. It must not contain retired corpus
locators or identifiers, future case/document/packet identities, hidden gold,
expected citations, construction seeds, credentials, secrets, private paths,
personal identifiers, or custody details that weaken security.
