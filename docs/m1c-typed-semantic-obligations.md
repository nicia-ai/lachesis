# M1c: Typed Semantic Obligations

## Frozen M1b finding

M1b is complete and remains immutable at commit
`faa357193d0f96f807b906e2aa39abc132c00d2a`. Its held-out run is a valid
partial-success/negative result; M1c does not reinterpret, rerun, or overwrite
its manifests, records, reports, or ledgers.

The decisive M1b result is that syntax is no longer the bottleneck:

- 204/204 responses parsed.
- 156/156 feasible proposals compiled on the first attempt across every method.
- No repair was required.
- The preregistered semantic-success gate passed.
- The remaining errors concerned task intent and feasibility recognition.

The observed failures were concrete: a dead `map_exclaim`, an approval operation
present on only one select branch, a constant reset that ignored the input and
changed `remaining`, and a chain of checkpoints offered in place of a forbidden
recursive transition.

The honest conclusion is:

> Typed computation-only proposals made plan generation structurally reliable
> and predictable, but the system still needs typed semantic obligations to
> reject valid-looking plans that do not satisfy task intent. Compiler-guided
> repair was not exercised because the constrained language eliminated all
> compiler failures.

TypeGraph remains deferred. The next necessary layer is semantic plan
verification, not knowledge-graph integration.

## Trust boundary

M1c keeps model authority narrow:

- The model proposes registered operator topology and arguments.
- The task contract supplies public input declarations and typed semantic
  obligations.
- The catalog supplies operation semantics, including whether an operation is
  trusted to change state.
- Runtime policy supplies capabilities and resource limits.
- The analyzer computes graph provenance and resource requirements.
- The compiler checks requirements and obligations against trusted inputs.

Hidden evaluation inputs, expected outputs, effect results, and semantic scores
remain outside every initial and repair request.

## Compiler obligations

The public `SemanticObligation` union supports:

- `rootDependsOnInput`
- `requiresOperation`
- `operationDominatesRoot`
- `requiresStateChange`
- `requiresEffect`

Normalization rejects every node that cannot reach the declared root. Analysis
records the root's contributing nodes, public input dependencies, registered
operation dependencies, effects, state-changing operations, and dominators.
Obligation failures use `SEMANTIC_OBLIGATION_FAILED` diagnostics with repair
locations, so the existing two-turn bounded repair loop can consume them.

Verified obligations are canonicalized, deduplicated, and stored in the
executable artifact. `planHash` remains the syntax-only plan identity. A
separate branded `semanticContractHash` covers the plan hash, catalog
fingerprint, canonical trusted policy, and canonical obligations. The contract
hash and obligations flow through executable inspection, run traces, effect
request/replay identity, generation records, and benchmark records.

`stateChanging` is trusted catalog metadata. It defaults to `false`; an
operation is never inferred to change state merely because its implementation
could return a different value.

## Typed infeasibility witnesses

An M1c `unplannable` response carries exactly one typed witness:

- `missingOperation`
- `deniedCapability`
- `insufficientBudget`

The controller accepts a witness only when it is relevant to a public task
obligation and is proven by the exact language manifest and trusted policy.
Budget minima are derived from the referenced operation kind and frozen
operation bounds. Invalid or irrelevant witnesses produce
`INVALID_INFEASIBILITY_WITNESS` and are eligible for bounded repair; they are
not credited as abstentions.

## Repair experiment

Repair is a separate experiment, not an incidental comparison between two
independently sampled proposals.

1. Begin with an offline reference plan that compiles and passes its hidden
   properties.
2. Apply a preregistered deterministic mutation such as root redirection or
   unary-operation bypass.
3. Digest that one mutated proposal.
4. Bind both the no-repair and compiler-guided-repair arms to that exact digest.
5. Evaluate repair only if the shared proposal fails compilation or a typed
   semantic obligation.
6. If it passes, report `repair-unnecessary`; do not count it as a repair
   failure.

`prepareSharedRepairTrial` enforces the shared digest and exposes eligibility
before any model call. The versioned M1c repair manifest persists the mutation,
proposal digest, eligibility, and both arm bindings. Runtime validation
recomputes the proposal digest before adapter dispatch. Records distinguish
`eligible`, `repaired`, `failed`, and `repair-unnecessary`; reports reject
mismatched arm identities.

## Fresh typed-obligations corpus

`loadM1cPreregisteredCorpus` defines a new 17-case corpus: seven development and
ten held-out cases, with 11 plannable and six unplannable classifications. Each
split independently covers `missingOperation`, `deniedCapability`, and
`insufficientBudget`. Its case IDs are disjoint from every inspected M1b
held-out ID. The corpus includes new multi-operation, branch-dominance,
state-transition, effect, and infeasibility-recognition tasks.

The held-out content is subject to a counts-only validity audit while prompts
and scorers are under development. Offline witnesses prove all 11 plannable
cases compile and pass hidden properties; typed infeasibility witnesses prove
all six unplannable cases.

## Controlled M1c phases

M1c has a separate content-addressed campaign and independent `m1c-development`
and `m1c-heldout` pools. No M1b ledger or acknowledgement can authorize it. The
preregistered campaign ceilings are $30 development and $60 held-out, with
cumulative provider subcaps of $15 OpenAI/$12 Anthropic for development and
$35
OpenAI/$25 Anthropic for held-out. These are ceilings, not authority to
spend. Its versioned phases are:

- `m1c-protocol-probe`: one feasible and one typed-unplannable case over both
  direct providers, exactly four initial calls.
- `m1c-repair`: four deterministic shared-proposal trials over both providers;
  zero independently sampled initial calls and at most 16 bounded repair calls.
- `m1c-calibration`: seven development cases and the existing three functional-
  IR strategies over both providers.
- `m1c-heldout`: ten held-out cases, two repetitions, and the same six-method
  matrix.

The protocol identifies its representation as functional IR. CodeMode is not
implemented, included, or claimed. Materialization does not itself authorize
live execution; the new campaign digest and pool cap require a separate direct
acknowledgement after offline review. No TypeGraph integration is included.

Every phase cap is derived from the immutable method matrix, frozen pricing,
per-method token limits, repetitions, and maximum bounded calls. The resulting
conservative ceilings are 1,129,600 µUSD for the protocol probe, 4,518,400 µUSD
for repair, 19,768,000 µUSD for calibration, and 56,480,000 µUSD for held-out.
The three development phases cumulatively fit their new campaign pool and
provider subcaps.
