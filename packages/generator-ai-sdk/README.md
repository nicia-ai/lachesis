# `@nicia-ai/lachesis-generator-ai-sdk`

Node-only live-provider adapters for Lachesis plan-generation experiments. The
package uses Vercel AI SDK 7 and keeps all provider SDKs outside both the kernel
and the portable generator core.

No request is made merely by importing this package. Live calls require an
explicit adapter and a benchmark experiment with pricing and budget caps.

## Routes

- `createOpenAiPlanAdapter()` uses OpenAI Responses with `gpt-5.6-terra`,
  `reasoningEffort: "low"`, no sampling override, no external tools, and an
  8,192-token output ceiling.
- `createAnthropicPlanAdapter()` is the primary Anthropic route. It uses direct
  Anthropic Messages with `claude-sonnet-5`, adaptive thinking, low effort, and
  the AI SDK's `jsonTool` structured-output transport. The `json` tool is an
  internal output mechanism, not a model-controlled external capability.
- `createM1bPrimaryAdapters()` constructs the matched direct OpenAI/Anthropic
  pair for a generation strategy.
- `createBedrockAnthropicPlanAdapter()` is an optional secondary route using AWS
  Bedrock with `us.anthropic.claude-sonnet-5`.

AWS Bedrock does not provide OpenAI's proprietary GPT-5.6 Terra model, so the
OpenAI adapter is direct. Both Anthropic constructors require
`acknowledgeAdaptiveThinking: true` and record adaptive/low thinking in the
experiment method.

All adapters use Vercel AI SDK `7.0.28`, disable SDK retries, omit external
tools and temperature when default sampling is requested, and return raw
response text plus provider-decoded structured output to the generator's central
parser. They capture exact returned model IDs, provider request/response IDs,
finish reasons, provider refusals, latency, and
input/cache-read/cache-write/output/ reasoning tokens where available.

Constrained requests receive a separately compiled, versioned JSON Schema with a
strict object root and internal outcome envelope. The adapter passes that schema
directly through the AI SDK's JSON-schema wrapper; it never asks the SDK to
derive provider schemas from the runtime Zod `GenerationOutcome`. The compiler
version and schema digest are request identities. Adapter preflight rejects a
non-portable schema before model construction or dispatch.

`M1B_PILOT_CAPS` freezes the requested $50/$25-per-provider, call, token, and
per-call limits. `createM1bPricingSnapshot()` creates the separately digested
pricing input. The benchmark runner reserves worst-case cost before invoking an
adapter and recomputes provider-reported usage cost from that snapshot
afterward. Pre-dispatch adapter failures settle at zero cost and tokens.
Dispatched failures without usage retain the authorized conservative
reservation.

The package does not launch a pilot or read credentials on import.
