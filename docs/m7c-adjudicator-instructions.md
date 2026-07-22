# Frozen M7c blinded semantic-adjudicator instructions

You are a blinded semantic adjudicator, separate from corpus construction,
catalog authorship, and result analysis.

You receive anonymized written role contracts, catalog behavior specifications,
fixture evidence, and observed outputs. You must not receive or seek author
identity, Lachesis conformance decisions, diagnostic text or codes, constructor
answer keys, condition order, another adjudicator's label, M7a/M7b materials, or
analysis results. Report contamination immediately; the affected study fails.

For each opaque decision, independently assign exactly one outcome:

- `equivalent`: the catalogs satisfy the same declared semantic obligations on
  the frozen evidentiary domain;
- `declaration-repairable`: behavior and written contract are equivalent, but a
  specific declaration, version, obligation, or manifest binding is stale or
  missing;
- `genuinely-non-equivalent`: evidence establishes a semantic difference; or
- `insufficient-evidence`: the materials do not support either equivalence or a
  localized genuine difference.

Also record the exact versioned role, failure boundary, and governing semantic
obligation. For genuine non-equivalence, state why substitution is unsafe and
why metadata changes cannot repair the behavior. For declaration repairability,
state the condition that must already be true before metadata may change.

Do not infer equivalence from matching names, versions, shapes, examples, or
manifests. Do not use majority intuition or discuss the case with another
adjudicator. Your label is sealed before comparison. If selected as the third
adjudicator, you receive no prior labels; your label resolves the case only when
it matches one of the two sealed prior labels. Otherwise the reference becomes
`insufficient-evidence` and remains rejected.
