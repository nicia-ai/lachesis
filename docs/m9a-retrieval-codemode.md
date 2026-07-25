# M9a offline retrieval CodeMode vertical slice

Status: **experimental, internal, and entirely offline**.

M9a asks one infrastructure question:

> Can a harness discover and execute a better sequence of retrieval operations
> than one-shot RAG, using the same external corpus, search primitive, model
> boundary, and resource envelope?

This slice establishes only that the comparison can be expressed and executed
under those controls. It does not establish that either arm retrieves better
evidence or answers better. It makes no RLM-superiority, RAG-superiority,
model-quality, compositional-generalization, or production-readiness claim.

## Protocol decision

M9a defines `lachesis-m9a-retrieval-codemode@1.1.0`. It composes the existing
closed restricted-CodeMode parser and interpreter but does not change the
identity or behavior of the completed M2 protocol. In particular, M2 continues
to reject direct or mapped effect invocation where it rejected it before.

The M9a delta is explicit: `invoke` and `map` may dispatch a registered,
policy-authorized effect, and an operation that produces a collection must
declare a trusted maximum cardinality. Static analysis multiplies mapped effect
calls, tokens, and wall-clock bounds by that cardinality. Relevant unknown
bounds reject compilation.

Model-authored source is parsed with the TypeScript parser and lowered into the
same private closed AST. It is never evaluated by `eval`, `Function`, `vm`, a
module loader, a child process, or an ordinary JavaScript realm. The accepted
grammar remains one `async main(input, ops)`, single-declarator `const`
capability calls, and a final return. It has no imports, callbacks, loops,
helpers, ambient globals, arbitrary lambdas, or general recursion.

The implementation is deliberately absent from the package root exports and from
the stable runtime facade. Its internal source is
`packages/generator/src/m9a-retrieval.ts`. A prospective public surface would
need a separate API review; likely units are an immutable corpus builder, a
retrieval-program compiler, an executor, and a transcript inspector, all
explicitly marked experimental.

## Structural separation

M9a keeps six values separate:

1. A Lachesis executable plan. M9a does not create or alter one.
2. A model-authored retrieval program, held only by the private M9a artifact.
3. An immutable external document snapshot, held by an opaque corpus token.
4. Search results and read excerpts visible during one execution.
5. The submitted answer and its canonical chunk citations.
6. A run/retrieval/provenance transcript containing digests, operation classes,
   usage, and evidence identities.

Document and evidence relationships never become executable plan edges. The
corpus is substrate-neutral and has no TypeGraph dependency.

## External-knowledge contract

`lachesis-m9a-external-document-snapshot@1.0.0` validates corpus and document
identifiers, NFC-normalized text, uniqueness, and fixed document/corpus byte
limits. Documents are sorted by canonical ID before snapshot hashing. Each
document has a content digest. Text is split on Unicode-scalar boundaries into
fixed maximum UTF-8 byte windows; every chunk identity binds the corpus, full
snapshot digest, document digest, byte range, and chunk digest.

The reference search is deterministic BM25-style lexical scoring over those
chunks. Ties use canonical chunk identity. Every caller supplies a positive
`maxResults` no greater than the protocol maximum. Both comparison arms call
this exact implementation.

Read is a justified bounded batch operation because the model-visible
`read-search-results` capability consumes one bounded search result. It accepts
only canonical chunk identities returned by the bound snapshot, checks every
identity field, and rejects a total above the caller's explicit `maxBytes`.
Before dispatch, the capability walks hits in deterministic rank order and
greedily selects a ranked subset that fits both the remaining execution-byte
budget and the per-read ceiling. Oversized hits are skipped; an exhausted budget
produces an empty bounded read rather than dispatching an impossible request.
Search and read return typed failures and accept an `AbortSignal`.

## Registered capability catalog

The internal catalog contains distinct operations for:

- `decompose-query@1.0.0` — offline model-boundary decomposition;
- `search-corpus@1.0.0` — lexical corpus search;
- `read-search-results@1.0.0` — bounded canonical reads;
- `answer-evidence-slice@1.0.0` — leaf-model reasoning over assigned evidence;
- `synthesize-citation-confined-answer@1.0.0` — ordered deterministic
  aggregation;
- `submit-citation-confined-answer@1.0.0` — final citation confinement and
  submission;
- explicit task/question and singleton-list nominal conversions; and
- `prepare-retrieval-state`, `refine-next-query`, `remaining-retrieval-queries`,
  and `take-refined-queries` for bounded refinement.

Search, read, leaf-model, and submission effects use separate effect names,
capabilities, transcript categories, and usage entries. Leaf citations must come
from that leaf's assigned evidence. Final citations must have been read in the
same execution.

Citation confinement is not semantic grounding. A visible citation can still
contradict the submitted claim. The run and transcript therefore report
`citation-confinement-only` with semantic evaluation `external-not-performed`;
M9a performs no answer-correctness or abstention scoring.

The execution envelope independently limits source bytes, statically predicted
CodeMode operation calls, root-model calls, leaf-model calls, search calls, read
calls, returned hits, total bytes read, fixed-point iterations, tokens,
wall-clock time, and concurrency. Deterministic offline effects have a
known-zero monetary cost. Search-result and read-byte reservations are checked
before the corresponding corpus operation. Each root or leaf model call also
receives a maximum token, wall-clock, and zero-cost reservation that is admitted
before adapter dispatch. Reported usage is validated against that reservation
and reconciled to the aggregate counters afterward. Unknown collection or
recursion bounds fail compilation.

`boundedFix` is unchanged. The refinement state transition has the same nominal
input and output schema, its measure is a validated nonnegative pending-query
count, the source contains a literal hard limit, and the runtime proves that the
measure strictly decreases. The step refines query state only; it cannot hide a
search or read effect. Subsequent registered search operations execute the
refined queries explicitly.

## Offline comparison

`runM9aOfflineComparison` compiles and executes:

- the supplied sequenced-retrieval program; and
- a fixed one-shot RAG program that explicitly converts the task to one query,
  searches once, reads those hits, invokes the same leaf-model boundary, folds,
  and submits.

Both arms bind the same corpus snapshot, deterministic search implementation,
offline model adapter identity, and `M9A_DEFAULT_RESOURCE_ENVELOPE`. The caller
must provide a distinct model-session factory for each arm and an explicit
`sequenced-first` or `one-shot-first` order. Returning the same session object,
or sessions with different model identities, rejects. Each arm has an
independent model session, execution context, and transcript. The returned
comparison records the chosen order and reports raw functional evidence and
usage only; it contains no quality score or superiority decision. A future M9b
schedule must freeze a randomized or counterbalanced order before execution.

## Recording and replay

`lachesis-m9a-private-retrieval-replay@1.1.0` is a private, content-addressed
artifact. Unlike the default transcript, it intentionally contains exact effect
inputs, fetched evidence, and reduced outputs. It binds the retrieval protocol,
source and semantic-contract hashes, task, corpus snapshot, model identity,
ordered effects, usage, expected transcript digest, answer digest, and its own
artifact digest. Exact JSON values use the generator's non-transforming strict
JSON boundary, preserving root and nested hostile own keys such as `__proto__`.

Replay validates the complete artifact digest, recompiles the closed program,
checks source and semantic-contract identities, and interprets it with a replay
handler. The handler requires every operation, effect, input digest, output,
event, and usage record in exact order. It reconstructs read visibility,
citations, resource accounting, the default transcript, and the final result
identity. The replay API accepts neither a corpus nor a model, so successful
replay performs zero corpus, root-model, or leaf-model effects. Tampered source,
snapshot, effect output, usage, or result identity rejects.

## Development fixture

The development-only fixture covers direct lookup, multi-document join,
multi-hop resolution, temporal retraction, contradiction resolution, exhaustive
aggregation, insufficient evidence, and document-embedded prompt injection.
Expected answers and required support IDs live in a separate test-only module.
One synthetic join case is a functional expressiveness witness: precise
decomposed searches retrieve both official records while the matched one-shot
top-k query is crowded out by lexical distractors under the same search and byte
ceiling. This proves only that the substrate can express a useful trajectory; it
does not show that a real model will discover it.

The representative sequenced program is:

```ts
export default async function main(input, ops) {
  const questions = await ops.invoke("decompose-query@1.0.0", input.task);
  const searches = await ops.map("search-corpus@1.0.0", questions);
  const evidence = await ops.map("read-search-results@1.0.0", searches);
  const partials = await ops.map("answer-evidence-slice@1.0.0", evidence);
  const answer = await ops.fold(
    "synthesize-citation-confined-answer@1.0.0",
    partials,
  );
  const submitted = await ops.invoke(
    "submit-citation-confined-answer@1.0.0",
    answer,
  );
  return submitted;
}
```

The tests additionally execute a variant that passes decomposed questions
through `boundedFix` before search. All fixtures and model responses are local;
M9a performs no network access.
