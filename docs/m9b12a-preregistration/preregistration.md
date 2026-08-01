# M9b.12a corrected offline preregistration

Decision: `corrected-preregistration-package-ready-for-independent-review`

Status: immutable superseding offline draft; not externally registered.

Protocol: `lachesis-m9b12a-offline-preregistration-package@1.0.0`.

Preregistration digest:
`79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831`.

M9b.12a supersedes the unregistered M9b.12 package at commit
`b9f13c7b215624eb651caf3b038b77976247c9a3`, tree
`30144b30de282d63371f9afedeb7d5ac43cfa739`, and digest
`f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5`. The original
bytes and checksum manifest remain unchanged. Its append-only status is
`superseded-unregistered-retired-corpus-policy-incomplete`.

## Sole correction

M9b.12a explicitly classifies access to retired or previously contaminated study
material as a fail-closed quarantine event. No scientific, population, analysis,
model, envelope, financial, operational-sequence, or authorization field
changes.

## Research question and arms

Does a TypeScript/JavaScript CodeMode harness that lets the model author and
locally execute an evidence-adaptive retrieval program improve first-attempt
grounded task success over a matched static one-shot retrieval harness operating
on the same external corpus snapshot?

The discovered arm uses one model call to author a closed retrieval AST,
executes it locally with bounded evidence-derived adaptation, and uses a second
model call to answer from visible evidence. The static arm uses one model call
to author one static query, performs one-shot local retrieval, and uses a second
model call to answer from visible evidence. Both receive the same local
validation and arm-blind evaluation. Local retrieval cannot call a model or
provider.

Each arm has exactly two inference calls; each pair has four inference calls and
four count requests. Model, reasoning effort, retriever, corpus snapshot,
aggregate retrieval/read/byte limits, answer schema, and evaluator are matched.
Sessions are independent, arm order is deterministically randomized, retries are
zero, and campaign concurrency is one.

## Population, endpoint, and analysis

Eight task families crossed with 1x, 8x, and 32x scales form 24 cells. The probe
has one pair per cell (24); the primary has seven per cell (168). The campaign
has 192 pairs, 768 count requests, 768 inference calls, and at most 1,536
provider HTTP requests. Development, probe, and primary remain disjoint across
fixtures, cases, documents, entities, answers, supporting facts, templates,
surface forms, snapshots, seeds, and source provenance.

The primary paired binary endpoint remains first-attempt semantically supported
end-to-end success. It requires every frozen authoring, compilation/query,
retrieval, answer, semantic, evidence, citation, provenance, evaluator, and
first-attempt integrity stage. Failures, abstentions, truncations, ambiguous
effects, and halted pairs remain failures; repair and retry remain prohibited.

The primary test remains the treatment-favorable exact one-sided conditional
McNemar test at alpha 1/20 using integer/rational arithmetic over the exact
opaque 168-case inventory. No subset, missing-pair deletion, replacement, or
enrichment is permitted. All 24 family-by-scale cells retain equal weight. The
complete 24-pair probe and frozen M9b.3f gate remain prerequisites with no
qualitative override or relaxed threshold.

## Retired-material boundary

A retired corpus includes any corpus, inventory, packet set, topology, hidden
reference, constructor output, materialization, or derived study artifact that
was used earlier, exposed, contaminated, quarantined, superseded, partially
constructed in a failed attempt, accessed by an excluded identity, or derived
from such material.

Retired namespaces must be absent before a study role starts. They cannot be
mounted, addressable, enumerable, searchable, or reachable through history,
caches, temporary storage, archives, logs, shell history, environment variables,
or parent workspaces. A denylist inside the role is insufficient. The bootstrap
boundary cannot disclose retired paths or identities.

Study roles cannot mount, open, list, search, hash, compare, copy, inspect,
traverse, import, reconstruct, derive from, or use retired material for
freshness comparison. Snippets, filenames, identifiers, ordering, metadata,
contents, and structural summaries are forbidden. Only minimum opaque
commitments containing the public frozen aggregate counts are permitted; they
cannot reveal identity, order, content, or structure.

Suspected or confirmed access stops the attempt before provider effects,
quarantines the role/session and every produced or derived artifact, permanently
forbids reuse, excludes the observer from later influential roles, records the
incident append-only, requires independent assessment, and requires fresh role
identities, environment, seed, and corpus construction for any restart. Missing
observer identity, incomplete exposure inventory, or unknown noninterference
forbids reuse. Manual cleanup, selective deletion, renaming, or a claim of
harmless exposure cannot restore eligibility.

## Financial and authority boundary

The M9b.11 moderate inference ceiling remains
$342.097920; count shadow
contingency $117.964800; operational ceiling
$460.062720; prospective provider
hard cap $500.000000; headroom $39.937280. The
project must begin at zero spend, counting is not claimed contractually free,
the provider cap may lag, ambiguity consumes the full reservation, and overage
halts.

This package grants no registration, corpus/gold creation, project, credential,
provider, count, inference, probe, primary, budget, campaign, publication,
release, or push authority. It contains no retired or future corpus identity or
content. This AI-assisted preparation is not a professional security audit,
penetration test, or compliance assessment.
