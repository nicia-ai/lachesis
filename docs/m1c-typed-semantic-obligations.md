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
before any model call. Research-gate evaluation likewise excludes ineligible
proposals and refuses to compare repair arms whose initial proposal differs.

## Fresh IR-versus-CodeMode corpus

`loadM1cPreregisteredCorpus` defines a new 13-case corpus: four development and
nine held-out cases, with 11 plannable and two unplannable classifications. Its
case IDs are disjoint from every inspected M1b held-out ID. The corpus includes
new multi-operation, branch-dominance, state-transition, effect, and missing-
operation tasks.

The held-out content is subject to a counts-only validity audit while prompts
and scorers are under development. Offline witnesses prove all 11 plannable
cases compile and pass hidden properties; typed infeasibility witnesses prove
both unplannable cases. No M1c live inference or CodeMode claim is authorized by
this implementation.
