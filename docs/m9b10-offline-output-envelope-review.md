# M9b.10 offline output-envelope review

M9b.10 remains **NO-GO**. Its deterministic decision is
`campaign-capacity-remains-no-go`.

This milestone composes the accepted M9b.9 exact-input-count report with three
prospective output envelopes. It performs no provider or token-count call,
accesses no credentials, constructs no corpus, and changes no population,
estimand, allocation, alpha, power target, model, reasoning mode, or retry
policy. It does not authorize preregistration preparation or any live effect.

## Why the accepted inference reservation is $613.416960

Every paired case contains four inference requests: discovered-program
authoring, static-query authoring, discovered grounded answering, and static
grounded answering. The accepted M9b.9 counted input maxima are 65,536 tokens
for each authoring request and 32,768 for each answer request. Conservative
input settlement uses the cache-write class at
$3.125 per million tokens.
Output uses $15 per million tokens. None of these
inputs crosses the frozen 272,000-token long-context threshold.

Across 192 pairs, input reservation is
$117.964800 and output reservation is
$495.452160. Output therefore accounts for
80.78% of the
$613.416960 inference
ceiling. Authoring output alone contributes $377.487360;
grounded-answer output contributes $117.964800.

The original campaign cap is also $117.964800. Exact-count input reservations
therefore consume the entire cap before any positive output allowance. Tighter
output ceilings materially reduce exposure, but output tuning alone cannot make
the accepted cap feasible.

## Frozen structural contracts

The prospective program contract remains restricted TypeScript compiled by the
existing closed-AST compiler before retrieval. M9b.10 adds a private structural
inspection seam over that already-compiled artifact; it does not evaluate or
load source. The maximum source is derived as:

```text
2,048 fixed wrapper/schema bytes
+ 14 bindings × 864 bytes per binding
+ 4 boundedFix levels × 64 grammar bytes
= 14,400 UTF-8 source bytes
```

Each compiled program is additionally limited to 14 bindings, 64 statically
bounded operation calls, expression depth 2, `boundedFix` limit 4, 64-byte
identifiers, 160-byte registered references, 128-byte canonical scalar literals,
and four operation arguments. JSON escaping and wrapper overhead give a
conservative prospective allowance of 28,813 visible structured-output tokens.
This is a controller allocation, not a claim of an exact local provider
tokenizer proof; if provider accounting cannot fit a valid structure, the
response truncates and fails. The source still has to satisfy every existing
capability, effect, progress, and semantic obligation before retrieval or model
execution.

Static planning returns exactly one printable NFC query of at most 512 UTF-8
bytes and no prose. Its conservative structured-output bound is 1,036 tokens.

Grounded answering returns either:

- one typed answer with at most eight 256-byte answer values, sixteen 96-byte
  supporting-fact IDs, and sixteen 96-byte citation IDs; or
- the exact typed `insufficient-evidence` outcome with empty evidence arrays.

The grounded structured-output bound is 8,192 tokens. IDs use a restricted ASCII
identity alphabet. All responses must be exact canonical JSON; surrounding prose
rejects.

Provider `max_output_tokens` includes visible output, provider formatting, and
nonvisible reasoning. The prospective envelopes reserve separate visible,
formatting, and reasoning maxima, but assume no fixed visible-to-reasoning
ratio. Reported components must fit inside the total provider ceiling.

## Frozen alternatives

| Design                    | Program authoring | Static query | Each grounded answer | Inference exposure | Exposure if count is unresolved |
| ------------------------- | ----------------: | -----------: | -------------------: | -----------------: | ------------------------------: |
| Accepted M9b.9            |            65,536 |       65,536 |               20,480 |        $613.416960 |                   $5,039.016960 |
| Moderate class-specific   |            40,960 |        4,096 |               16,384 |        $342.097920 |                   $4,767.697920 |
| Aggressive class-specific |            32,768 |        2,048 |               12,288 |        $289.013760 |                   $4,714.613760 |

Each class occurs 24 times in the probe, 168 times in the primary population,
and 192 times in the campaign. Its full-campaign inference contribution is:

| Design         | Program authoring | Static query | Discovered answer | Static answer |
| -------------- | ----------------: | -----------: | ----------------: | ------------: |
| Accepted M9b.9 |       $228.065280 |  $228.065280 |        $78.643200 |    $78.643200 |
| Moderate       |       $157.286400 |   $51.118080 |        $66.846720 |    $66.846720 |
| Aggressive     |       $133.693440 |   $45.219840 |        $55.050240 |    $55.050240 |

The moderate program ceiling contains 28,813 visible tokens, 2,048 formatting
tokens, and 10,099 reasoning tokens. Its static-query split is
1,036/1,012/2,048; each answer split is 8,192/2,048/6,144. The aggressive splits
are 28,813/1,024/2,931, 1,036/244/768, and 8,192/1,024/3,072 respectively.

The frozen 96-output development conformance fixture has zero ceiling violations
under the accepted and moderate designs. The aggressive design has two: one
output in each answer class. These are exact fixture observations, not estimated
population truncation probabilities; risk outside the frozen fixtures is
explicitly unknown.

Neither alternative changes the 24-pair probe, 168-pair primary population,
paired estimand, endpoint, or frozen 8,000-basis-point target-power design. The
primary endpoint remains first-attempt semantically supported end-to-end
success.

## First-attempt and probe gates

A truncated, incomplete, malformed, structurally oversized, or compilation-
rejected response is a terminal first-attempt endpoint failure. The exact raw
response and usage are retained. There is no retry, exclusion, replacement, or
post-hoc ceiling increase.

The frozen probe gate requires all 96 scheduled inference responses and permits
zero truncated or incomplete responses. Any such response halts before the
primary population. Once the probe begins, no output ceiling, population, or
schedule may change.

## Decision

The moderate design is the least aggressive envelope with zero violations in the
frozen development fixtures, but even if the count endpoint were proven free its
$342.097920 inference exposure exceeds the original cap by
$224.133120. The
aggressive design still exceeds it by
$171.048960 and already
shows two development-fixture truncations. With count pricing unresolved, the
complete exposures remain $4.767697920
and $4.714613760.

M9b.10 therefore does not select or activate either prospective design. A later
review may change a campaign cap or select a frozen envelope only before a
probe, after count pricing is authoritatively resolved. M9b remains NO-GO for
preregistration, corpus materialization, credentials, provider access, probes,
and live execution.

This is AI-assisted architecture and conformance evidence, not a professional
security audit, penetration test, compliance assessment, model-quality claim,
RLM/RAG superiority claim, or production-readiness claim.
