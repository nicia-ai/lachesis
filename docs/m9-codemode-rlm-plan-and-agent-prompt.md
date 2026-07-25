# M9 plan: TypeScript CodeMode RLM for external knowledge

## Decision

M9 should focus on a TypeScript CodeMode RLM for external knowledge, not graph
representation.

The model will write a restricted TypeScript retrieval program. Lachesis will
parse and interpret it—never `eval` it—and expose only typed, budgeted
operations over an immutable external corpus.

The primary research question is:

> Can a harness discover and execute a better sequence of retrieval operations
> than one-shot RAG, using the same external corpus, search primitive, model
> boundary, and resource envelope?

## M9a — Offline CodeMode RLM substrate

Build the safe execution layer without provider calls.

The root model should be able to produce a program structurally similar to:

```ts
export default async function main(input, ops) {
  const questions = await ops.invoke("decompose-query@1.0.0", input.task);
  const searches = await ops.map("search-corpus@1.0.0", questions);
  const evidence = await ops.map("read-search-results@1.0.0", searches);
  const partials = await ops.map("answer-evidence-slice@1.0.0", evidence);
  const answer = await ops.fold("synthesize-grounded-answer@1.0.0", partials);
  return answer;
}
```

For adaptive retrieval:

```ts
export default async function main(input, ops) {
  const state = await ops.invoke(
    "initialize-retrieval-state@1.0.0",
    input.task,
  );
  const completed = await ops.boundedFix(
    "retrieve-next-unresolved@1.0.0",
    "remaining-unresolved-count@1.0.0",
    state,
    8,
  );
  return completed;
}
```

This should reuse the existing restricted CodeMode architecture:

- TypeScript-shaped source.
- Parsed as a closed AST.
- Interpreted by Lachesis.
- No `eval`, `Function`, `vm`, imports, globals, network, filesystem, callbacks,
  arbitrary loops, or unbounded recursion.
- Retrieval and leaf-model calls are registered effects.
- `boundedFix` provides recursive behavior with a hard limit and a strictly
  decreasing measure.

M9a should provide:

- Immutable document-corpus snapshots.
- Deterministic search and bounded read operations.
- Content-addressed chunks.
- Retrieval transcripts.
- Leaf-call interfaces.
- Grounded final answers.
- Exact resource accounting.
- Zero-effect replay.
- Static one-shot RAG and iterative CodeMode paths using the same search
  primitive.

No live model-quality claim should come from M9a.

## M9b — Offline benchmark and protocol design

Build tasks that require genuinely different retrieval trajectories:

- Direct lookup.
- Multi-document join.
- Multi-hop resolution.
- Temporal change and retraction.
- Contradiction resolution.
- Exhaustive counting or aggregation.
- Typed insufficient evidence.
- Prompt injection embedded in external documents.

Generate scale variants at approximately:

- 1×
- 8×
- 32×

The important invariant is that the solution strategy stays structurally similar
while the external corpus grows.

The matched arms should be:

| Arm                 | Behavior                                                            |
| ------------------- | ------------------------------------------------------------------- |
| Static RAG          | One query, top-k retrieval, one answer call                         |
| Iterative retrieval | Multiple model-selected searches and reads                          |
| CodeMode RLM        | Model-generated typed decomposition program with bounded leaf calls |
| Calcified CodeMode  | Later reuse of a previously validated retrieval strategy            |

Initially, M9a only needs static RAG and CodeMode RLM. Calcification should
remain a later step so discovery is not confounded with reuse.

## M9c — Prospective provider study

Only after the offline substrate passes review:

- Construct a fresh natural external corpus.
- Freeze providers, models, prompts, budgets, pricing, and tasks.
- Preregister the matched comparison.
- Run a small protocol probe.
- Then run the authorized comparison.

The primary endpoint should be:

> First-attempt grounded end-to-end success.

Secondary endpoints:

- Required-evidence recall.
- Retrieved-evidence precision.
- Citation validity.
- Correct insufficient-evidence behavior.
- External bytes read.
- Search/read operations.
- Root and leaf model calls.
- Input/output/reasoning tokens.
- Latency and cost.
- Prompt-injection resistance.

Static RAG and CodeMode must use the exact same underlying search
implementation. Otherwise the experiment would test retriever quality rather
than harness quality.

## M9d — Calcification and length generalization

Only after M9c establishes that useful trajectories exist:

1. Discover strategies on short development tasks.
2. Normalize them into strategy identities.
3. Freeze stable templates.
4. Evaluate them on unseen 8–32× longer corpora.
5. Require zero discovery-planner calls on a template hit.
6. Compare against fresh strategy discovery.

This is where M6's trajectory equivalence and strategy registry become directly
useful.

## Critical trust boundaries

M9 should preserve these distinctions:

```text
Executable plan
    separate from
CodeMode retrieval program
    separate from
External knowledge snapshot
    separate from
Retrieved visible evidence
    separate from
Run/provenance graph
```

Required protections:

- External documents are always untrusted data.
- Document instructions cannot become controller instructions.
- Root planning sees the task and capability manifest, not the corpus.
- Search sees only its typed query.
- Leaf calls see only their assigned evidence.
- Final validation sees only fetched evidence.
- Unfetched evidence cannot be cited.
- No hidden answer, expected support, or benchmark label enters a request.
- Every search, read, and leaf call is reserved before dispatch.
- Search count, read bytes, leaf fan-out, recursion depth, time, tokens, and
  cost have hard ceilings.
- Replay invokes neither the corpus nor a model.
- Default traces contain identities and usage—not raw external data.
- Private replay artifacts may retain exact fetched evidence under the existing
  private-artifact policy.

This takes the useful part of the RLM design while avoiding an unrestricted
REPL. Lachesis can implement programmatic decomposition through its restricted
TypeScript capability algebra.

## Oversight sequence

1. A fresh implementation agent implements M9a completely offline.
2. Review its architecture, diff, tests, and claim boundary.
3. After review, implement the M9b benchmark and protocol.
4. No provider adapter, campaign, preregistration, or live call proceeds until
   the frozen design receives a separate review.

The implementation review should focus especially on:

- Whether both arms truly use the same retriever.
- Whether external text is prevented from becoming authority.
- Whether the CodeMode path has complete static cost bounds.
- Whether replay proves zero corpus and model effects.

---

# Fresh-agent implementation prompt

## Implement M9a: TypeScript CodeMode RLM for external-knowledge retrieval

You are working in:

`/Users/paul/orgs/nicia/lachesis`

Read `AGENTS.md` completely before making any change.

## Objective

Implement an entirely offline M9a vertical slice that tests whether Lachesis can
safely express and execute model-discovered sequences of retrieval operations
over an external document corpus.

The research question motivating this work is:

> Can a harness discover and execute a better sequence of retrieval operations
> than one-shot RAG, using the same external corpus, search primitive, model
> boundary, and resource envelope?

M9a is infrastructure and functional evidence only. It must not make a
model-quality, RLM-superiority, RAG-superiority, compositional-generalization,
or production-readiness claim.

## Architectural decision

Remain entirely in TypeScript/JavaScript.

Use Lachesis's restricted CodeMode architecture. Model-produced TypeScript-like
source must be parsed and interpreted as a closed AST. It must never be passed
to `eval`, `Function`, `vm`, a module loader, a child process, or an ordinary
JavaScript execution realm.

Do not add source strings, arbitrary callbacks, lambdas, or general recursion to
the Lachesis plan wire format.

Do not silently widen or reinterpret the existing M2 CodeMode protocol. Define a
separate, explicitly versioned M9 retrieval-CodeMode protocol, or compose the
existing protocol without changing its identity. Document the choice.

The model-visible program may use registered capability operations and bounded
iteration through the existing capability algebra. `boundedFix` remains the only
recursive mechanism and must retain:

- a same-schema state transition;
- a nonnegative measure;
- a hard iteration limit; and
- runtime proof of strict progress.

## Required conceptual separation

Keep these domains structurally distinct:

1. Lachesis executable plan.
2. Model-authored restricted CodeMode retrieval program.
3. External document/knowledge snapshot.
4. Search and read results made visible during this execution.
5. Final answer and citations.
6. Run/retrieval/provenance transcript.

Evidence or document relationships must not become executable plan edges.

Do not make TypeGraph mandatory. M9a should operate over a substrate-neutral
document corpus. TypeGraph integration, if ever desired, is later optional work.

## Placement and API scope

Prefer experimental implementation in `@nicia-ai/lachesis-generator`, with only
the minimum substrate-neutral evidence types placed elsewhere if architecture
requires it.

Do not widen `@nicia-ai/lachesis-runtime` or another stable-alpha facade.

Do not add public exports unless they are necessary for the offline vertical
slice and are explicitly classified experimental. Prefer keeping the first
implementation private/internal and documenting the prospective public shape.

Do not change package versions, release metadata, workflows, dist-tags, or
published artifacts.

## External-knowledge contract

Implement an immutable, content-addressed external document corpus with:

- corpus ID and version;
- snapshot digest;
- canonical document identities;
- canonical chunk or byte-range identities;
- bounded document and corpus sizes;
- deterministic ordering;
- strict input validation;
- explicit maximum search results;
- explicit maximum read bytes;
- cancellation support; and
- typed failures.

Provide deterministic offline operations equivalent to:

- `search`
- `read`
- optionally `batchRead` if justified
- retrieval transcript inspection

Use one deterministic search primitive for every benchmark arm. A simple,
documented lexical/BM25-style reference search is acceptable. The objective is
to compare retrieval sequencing, not lexical versus vector retrieval.

Do not introduce graph-native selection or reopen M3's graph-superiority
question.

## CodeMode retrieval capabilities

Provide a registered typed capability catalog sufficient to express:

- task decomposition;
- corpus search;
- bounded document/chunk reads;
- leaf reasoning over an assigned evidence slice;
- partial-result aggregation;
- final grounded submission; and
- bounded iterative retrieval through `boundedFix`.

Search/read operations and leaf-model operations must remain distinguishable in
usage and provenance.

A representative model-visible program should be able to express:

```ts
export default async function main(input, ops) {
  const questions = await ops.invoke("decompose-query@1.0.0", input.task);
  const searches = await ops.map("search-corpus@1.0.0", questions);
  const evidence = await ops.map("read-search-results@1.0.0", searches);
  const partials = await ops.map("answer-evidence-slice@1.0.0", evidence);
  const answer = await ops.fold("synthesize-grounded-answer@1.0.0", partials);
  return answer;
}
```

An adaptive case should be expressible as:

```ts
export default async function main(input, ops) {
  const state = await ops.invoke(
    "initialize-retrieval-state@1.0.0",
    input.task,
  );
  const completed = await ops.boundedFix(
    "retrieve-next-unresolved@1.0.0",
    "remaining-unresolved-count@1.0.0",
    state,
    8,
  );
  return completed;
}
```

These examples are illustrative. Fit the exact signatures to Lachesis's existing
type and capability model rather than weakening it.

## Root and leaf model boundaries

M9a must use injected deterministic mock/record model effects only.

The root discovery model may see:

- the public task;
- public input declarations;
- the retrieval capability manifest;
- public semantic obligations; and
- frozen resource limits.

It must not see:

- the corpus contents;
- hidden answers;
- expected citations;
- required evidence IDs;
- fixture labels;
- benchmark-arm identity;
- alternative programs; or
- hidden evaluation results.

A leaf model may see only:

- its bounded subtask;
- the exact evidence slice assigned to it;
- the reduced answer/support schema; and
- its local resource limits.

It must not gain direct corpus access or see sibling state.

External documents must be represented as untrusted data. Test that apparent
system instructions, tool instructions, prompt injections, and role-like text
inside documents remain document content and cannot alter controller authority.

## Static RAG baseline

Implement a matched static baseline using the exact same corpus and search
primitive:

1. one task-derived search query;
2. one bounded top-k result set;
3. bounded reads;
4. one answer effect;
5. the same answer and citation validator.

The static and CodeMode paths must share:

- snapshot;
- search implementation;
- answer contract;
- evidence/citation validator;
- total external-byte accounting; and
- comparable model/token/call budget representation.

M9a does not need live measurements. It must establish that the two arms differ
only in sequencing capability rather than retriever implementation.

## Grounding and provenance

Final outputs should remain reduced and typed, preferably containing:

- outcome: answered or insufficient evidence;
- answer values;
- supporting chunk/range identities.

The runtime, not the model, must reconstruct:

- document citations;
- retrieval transcript links;
- root/leaf call relationships;
- read-set provenance; and
- final run identity.

An answer may rely only on evidence actually returned by successful bounded read
operations. Search snippets alone must not become authoritative support unless
the contract explicitly classifies them as readable evidence.

Unfetched documents and hidden fixture references cannot validate an answer.

## Budgets and failure behavior

Define independently enforced ceilings for:

- root discovery calls;
- leaf calls;
- search calls;
- read calls;
- returned search results;
- bytes read;
- CodeMode operation calls;
- bounded-fix iterations;
- input tokens;
- output tokens;
- wall-clock time;
- concurrency; and
- monetary cost representation, which may remain known-zero for deterministic
  offline effects.

Unknown bounds must fail closed.

Every effect must be admitted against its complete reservation before execution.

Expected failures must use typed `Result` values. Preserve cancellation and
fail-closed behavior.

## Recording and replay

Produce a content-addressed execution artifact binding at least:

- CodeMode protocol and source hash;
- compiled CodeMode artifact identity;
- public task and semantic-contract identity;
- corpus snapshot identity;
- search/read transcript;
- exact fetched evidence identities;
- root and leaf effect identities;
- usage and budgets;
- reduced outputs;
- citations and provenance;
- final result identity.

Default traces must contain identities, stages, classifications, and usage—not
raw corpus contents, prompts, answers, credentials, or exceptions.

A private replay artifact may retain the exact selected evidence required for
replay.

Replay must:

- require exact identities;
- invoke no root model;
- invoke no leaf model;
- access no corpus;
- rerun semantic validation and provenance reconstruction; and
- fail on any plan, program, snapshot, transcript, evidence, output, usage, or
  reconstruction mismatch.

## Offline fixture

Create a small fresh development-only document corpus with cases covering:

- direct lookup;
- multi-document join;
- multi-hop decomposition;
- temporal update or retraction;
- contradiction resolution;
- exhaustive aggregation;
- insufficient evidence; and
- prompt injection embedded in a document.

Include at least one case in which a deterministic multi-step CodeMode program
can retrieve complete evidence but the matched one-shot top-k baseline cannot
under the same search primitive and evidence-byte ceiling.

This is a functional expressiveness fixture, not evidence that a real model will
discover the better program.

Keep hidden answers and required evidence in a physically or structurally
separate test-only namespace. Audit that neither root nor leaf requests contain
them.

Do not reuse inspected M3, M4, M5, M6, or M7 held-out material as prospective
scientific evidence.

## Required tests

Add behavioral, property, and hostile tests for at least:

### Code safety

- imports and globals rejected;
- filesystem, environment, network, time, randomness, and dynamic code rejected;
- loops, callbacks, closures, and unbounded recursion rejected;
- unknown operations and wrong versions rejected;
- malformed and overlarge source rejected;
- static resource bounds remain known.

### Knowledge isolation

- root program generation cannot inspect corpus contents;
- leaf calls see only assigned evidence;
- hidden answer/support labels never enter requests;
- unfetched evidence cannot validate an answer;
- prompt injection remains inert data;
- provider, representation, source, and benchmark-arm identities are absent from
  model-visible requests.

### Retrieval integrity

- search/read results are snapshot-bound and content-addressed;
- invalid, duplicate, stale, oversized, or cross-snapshot references reject;
- retrieval order and transcript identities are deterministic;
- source mutation changes the appropriate snapshot identity;
- citations refer only to fetched evidence;
- static and CodeMode arms use the same search implementation.

### Resource safety

- search, read, byte, leaf, iteration, token, time, concurrency, and cost limits
  fail before the violating effect;
- cancellation propagates;
- interrupted effects receive conservative deterministic accounting;
- `boundedFix` proves strict measure decrease.

### Replay

- successful replay performs zero model and corpus effects;
- tampered program, snapshot, search result, read set, output, usage, citation,
  or provenance identity rejects;
- repeated deterministic runs and reports are byte-identical.

Run fixed-seed property campaigns where appropriate and record the seed.

## Documentation

Create prospective documentation, likely:

- `docs/m9a-codemode-rlm-external-knowledge.md`
- `docs/m9a-threat-model.md`
- `docs/m9b-retrieval-study-design.md`

Document clearly:

- why this differs from conventional one-shot RAG;
- why it is RLM-like without unrestricted Python or JavaScript execution;
- the internal/external knowledge trust boundary;
- root versus leaf visibility;
- static RAG matching;
- budget matching;
- replay semantics;
- known limitations;
- exact nonclaims; and
- the proposed later live study.

The M9b design should outline, but not materialize:

- static RAG versus CodeMode RLM paired arms;
- fresh natural external corpora;
- approximately 1×, 8×, and 32× scale variants;
- first-attempt grounded end-to-end success as primary;
- evidence recall, precision, citations, abstention, bytes, calls, tokens, cost,
  and latency as secondary outcomes;
- separate future calcified-template evaluation;
- disjoint development and held-out corpora;
- prospective power calculation once a development discordance estimate exists;
- provider, pricing, authorization, and capacity requirements.

Do not create a final corpus, campaign, external preregistration, provider
identity, credential preflight, executable live state, or authorization text.

## Verification

Before completion, run the repository-required matrix from `AGENTS.md`,
including:

- formatting;
- strict TypeScript 6 typechecking;
- type-aware lint;
- focused tests;
- full tests with coverage;
- build;
- Node and Workers smokes where applicable;
- examples;
- package dry-runs or packed consumers affected by the change;
- public API inventory;
- source-safety and unsafe-type audits;
- historical checksum audits;
- JSON validation;
- `git diff --check`.

Do not relax existing gates or timeouts merely to obtain a pass.

## Stop conditions

Stop and report before implementation if the work would require:

- arbitrary JavaScript execution;
- `eval`, `Function`, `vm`, child processes, or a host module loader;
- changing the kernel wire format to carry code;
- general recursion;
- unknown resource bounds;
- widening stable runtime APIs;
- a provider credential or live call;
- network access for a role environment;
- a package version or publication change;
- weakening an existing security or type boundary.

If a narrower safe design is possible, implement that design and document the
tradeoff.

## Completion and Git behavior

Implement M9a entirely offline.

Do not push, publish, tag, open a PR, access credentials, or make provider
calls.

After the full verification matrix passes:

1. Review the complete diff.
2. Create one atomic local commit for M9a.
3. Leave the worktree clean.
4. Report:
   - commit;
   - architecture and protocol identities;
   - files changed;
   - tests and coverage;
   - functional static-RAG versus CodeMode fixture results;
   - boundary and hostile-test results;
   - public API delta, if any;
   - limitations and nonclaims;
   - M9b readiness decision; and
   - confirmation of zero provider calls, credentials, spend, campaigns,
     preregistrations, releases, or pushes.

Stop after M9a. Do not begin a live M9b/M9c experiment, calcification study,
preregistration, or release preparation.
