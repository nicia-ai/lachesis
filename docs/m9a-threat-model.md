# M9a retrieval CodeMode threat model

Status: **experimental, offline, development-only**.

## Assets and authorities

The trusted controller owns the capability catalog, nominal schemas, semantic
obligations, resource envelope, corpus binding, and effect implementations. A
model-authored source program chooses only topology and registered operation
references. External documents and model outputs are untrusted data.

The protected assets are controller authority, corpus contents outside a
successful bounded read, hidden evaluation data, credentials, host APIs,
resource reservations, citation integrity, and provenance identity.

## Isolation boundaries

- The CodeMode parser accepts one closed function-shaped AST. Rejected syntax
  has no runtime meaning.
- The model program has no binding for imports, modules, filesystem,
  environment, network, clocks, randomness, callbacks, dynamic code, or ambient
  globals.
- The root decomposition effect receives the public task only. It receives no
  corpus, answer, support ID, case label, arm identity, alternative program, or
  hidden evaluation.
- Search receives one typed query. It returns identities and scores, not
  authoritative document content.
- Read accepts only exact content-addressed chunks from the bound snapshot.
- A leaf effect receives one subtask and its exact read excerpts. It cannot
  access sibling evidence or the corpus.
- Submission accepts only citations already present in the execution read set.
- The default transcript stores identities, classifications, digests, and
  usage—not raw document text or prompts.
- Exact evidence appears only in the explicitly private replay artifact.

## Threats and controls

| Threat                                   | Control                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Generated source escapes into JavaScript | Parse and interpret a closed AST; never evaluate source                              |
| Unknown or stale operation               | Exact `id@version` resolution against one catalog                                    |
| Hidden effect in fixed-point transition  | `fixedPointStep` is pure; search/read remain explicit effects                        |
| Unbounded fan-out                        | Every produced collection has a trusted maximum; unknown bounds reject               |
| Nonterminating refinement                | Same-schema state, nonnegative measure, literal limit, strict runtime decrease       |
| Prompt injection in a document           | Document text remains an excerpt value with no controller interpretation             |
| Search snippet used as support           | Only successful read excerpts enter the leaf and citation read set                   |
| Fabricated or sibling citation           | Leaf citation subset check and final execution read-set check                        |
| Cross-snapshot read                      | Full canonical chunk identity and snapshot-bound digest validation                   |
| Resource overrun                         | Static whole-program bounds plus per-class reservations before corpus/model dispatch |
| Raw data in default trace                | Default trace records digests and identities only                                    |
| Replay invokes live dependencies         | Replay API accepts neither corpus nor model and uses exact recorded effects          |
| Replay artifact tampering                | Artifact, event, request, output, usage, transcript, and answer digests              |

## Residual risks and nonclaims

M9a uses a small deterministic lexical reference search and deterministic local
model fixtures. It has no process-level sandbox because accepted source never
enters a JavaScript realm. An application-supplied offline model adapter remains
trusted to avoid its own ambient I/O; M9a does not expose that adapter to the
model-authored program.

The development fixture is synthetic. M9a provides infrastructure and functional
evidence only. It makes no statement about real-model discovery, answer quality,
comparative retrieval quality, prompt-injection robustness of a live model,
generalization, performance at scale, or production readiness.
