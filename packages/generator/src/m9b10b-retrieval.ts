import {
  canonicalizeJson,
  type Catalog,
  type CompilationPolicy,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  definePredicate,
  defineReducer,
  defineSchema,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type CodeModeArtifact,
  type CodeModeArtifactSummary,
  type CodeModeEffectHandler,
  type CodeModeExecutionFailure,
  compileCodeModeWithDialect,
  executeCodeMode,
  inspectCodeModeArtifact,
} from "./codemode.js";
import {
  inspectM9aCorpus,
  type M9aCorpus,
  type M9aCorpusSnapshot,
  type M9aReadResult,
  m9aReadResultSchema,
  type M9aSearchResult,
  m9aSearchResultSchema,
  readM9aCorpus,
  searchM9aCorpus,
} from "./m9a-corpus.js";

export const M9B10B_RETRIEVAL_PROTOCOL = Object.freeze({
  id: "lachesis-m9b10b-selected-retrieval-codemode",
  version: "1.0.0",
  visibility: "internal-offline-conformance-only" as const,
  grammar: "closed-evidence-adaptive-retrieval-typescript/1" as const,
  execution:
    "closed AST interpreted locally with corpus search/read as the only effects" as const,
  claimBoundary:
    "offline expressiveness and integration evidence only; no provider/model call, retrieval-superiority, pricing, campaign activation, or live authority claim",
});

export const M9B10B_RETRIEVAL_LIMITS = Object.freeze({
  maximumSourceBytes: 14_400,
  maximumOperationCalls: 64,
  maximumSearchCalls: 2,
  maximumReadCalls: 2,
  maximumSearchResultsPerCall: 4,
  maximumReadBytesPerCall: 2_048,
  maximumTotalReadBytes: 4_096,
  maximumExtractedUtf8Bytes: 64,
  maximumQueryUtf8Bytes: 512,
  maximumBoundedFixLimit: 4,
});

const encoder = new TextEncoder();
const queryValidator = z
  .string()
  .min(1)
  .max(M9B10B_RETRIEVAL_LIMITS.maximumQueryUtf8Bytes)
  .refine((value) => value.normalize("NFC") === value)
  .refine(
    (value) =>
      encoder.encode(value).byteLength <=
      M9B10B_RETRIEVAL_LIMITS.maximumQueryUtf8Bytes,
  );
const boundedTextValidator = z
  .string()
  .max(128)
  .refine((value) => value.normalize("NFC") === value)
  .refine(
    (value) =>
      encoder.encode(value).byteLength <=
      M9B10B_RETRIEVAL_LIMITS.maximumExtractedUtf8Bytes,
  );
const textCollectionValidator = boundedTextValidator.array().max(4).readonly();
const queryStateValidator = z
  .strictObject({
    remaining: z
      .number()
      .int()
      .nonnegative()
      .max(M9B10B_RETRIEVAL_LIMITS.maximumBoundedFixLimit),
    query: queryValidator,
  })
  .readonly();

const taskSchema = defineSchema({
  id: "m9b10b-task",
  version: "1.0.0",
  description: "One public bounded retrieval task.",
  validator: z.string().min(1).max(2_048),
});
const querySchema = defineSchema({
  id: "m9b10b-query",
  version: "1.0.0",
  description: "One bounded untrusted search-query operand.",
  validator: queryValidator,
});
const boundedTextSchema = defineSchema({
  id: "m9b10b-bounded-text",
  version: "1.0.0",
  description: "Bounded NFC text that remains untrusted data.",
  validator: boundedTextValidator,
});
const boundedTextsSchema = defineCollectionSchema({
  id: "m9b10b-bounded-texts",
  version: "1.0.0",
  description: "At most four bounded untrusted text values.",
  validator: textCollectionValidator,
  element: boundedTextSchema,
  defaultMaxItems: 4,
});
const booleanSchema = defineSchema({
  id: "m9b10b-boolean",
  version: "1.0.0",
  description: "A bounded condition result.",
  validator: z.boolean(),
});
const countSchema = defineSchema({
  id: "m9b10b-count",
  version: "1.0.0",
  description: "A nonnegative collection count bounded by four.",
  validator: z.number().int().nonnegative().max(4),
});
const searchResultSchema = defineSchema({
  id: "m9b10b-search-result",
  version: "1.0.0",
  description: "A deterministic bounded corpus search result.",
  validator: m9aSearchResultSchema,
});
const readResultSchema = defineSchema({
  id: "m9b10b-read-result",
  version: "1.0.0",
  description: "A deterministic bounded corpus read result.",
  validator: m9aReadResultSchema,
});
const queryStateSchema = defineSchema({
  id: "m9b10b-query-state",
  version: "1.0.0",
  description: "Same-schema bounded deterministic query-template state.",
  validator: queryStateValidator,
});

function extractIntermediateIdentifier(read: M9aReadResult): string {
  const prefix = "INTERMEDIATE-ID[";
  const suffix = "]";
  for (const excerpt of read.excerpts) {
    const start = excerpt.text.indexOf(prefix);
    if (start < 0) continue;
    const valueStart = start + prefix.length;
    const end = excerpt.text.indexOf(suffix, valueStart);
    if (end < valueStart) continue;
    const candidate = excerpt.text.slice(valueStart, end).normalize("NFC");
    if (
      candidate.length > 0 &&
      boundedTextValidator.safeParse(candidate).success
    )
      return candidate;
  }
  return "missing-identifier";
}

const operations = Object.freeze([
  defineFunction({
    id: "task-query",
    version: "1.0.0",
    description: "Construct the first bounded query from only the public task.",
    input: taskSchema,
    output: querySchema,
    implementation: (task) => task.slice(0, 512).normalize("NFC"),
  }),
  defineEffect({
    id: "search",
    version: "1.0.0",
    description: "Search the bound snapshot for at most four chunks.",
    input: querySchema,
    output: searchResultSchema,
    effectName: "m9b10b.corpus.search",
    capability: "m9b10b.corpus.search",
    maxTokens: 0,
    maxWallClockMs: 100,
    replayable: true,
  }),
  defineEffect({
    id: "read",
    version: "1.0.0",
    description: "Read a deterministic byte-aware prefix of search hits.",
    input: searchResultSchema,
    output: readResultSchema,
    effectName: "m9b10b.corpus.read",
    capability: "m9b10b.corpus.read",
    maxTokens: 0,
    maxWallClockMs: 100,
    replayable: true,
  }),
  defineFunction({
    id: "search-count",
    version: "1.0.0",
    description: "Count a bounded search result.",
    input: searchResultSchema,
    output: countSchema,
    implementation: (result) => result.hits.length,
  }),
  defineFunction({
    id: "search-is-empty",
    version: "1.0.0",
    description: "Test whether a bounded search result is empty.",
    input: searchResultSchema,
    output: booleanSchema,
    implementation: (result) => result.hits.length === 0,
  }),
  defineFunction({
    id: "count-is-zero",
    version: "1.0.0",
    description: "Compare a bounded collection count with the literal zero.",
    input: countSchema,
    output: booleanSchema,
    implementation: (count) => count === 0,
  }),
  defineFunction({
    id: "evidence-contains-intermediate-id",
    version: "1.0.0",
    description: "Bounded literal containment test over visible excerpts.",
    input: readResultSchema,
    output: booleanSchema,
    implementation: (read) =>
      read.excerpts.some((excerpt) =>
        excerpt.text.includes("INTERMEDIATE-ID["),
      ),
  }),
  defineFunction({
    id: "extract-intermediate-id",
    version: "1.0.0",
    description:
      "Extract at most 64 UTF-8 bytes between the literal INTERMEDIATE-ID[ prefix and ] suffix.",
    input: readResultSchema,
    output: boundedTextSchema,
    implementation: extractIntermediateIdentifier,
  }),
  defineFunction({
    id: "text-equals-missing",
    version: "1.0.0",
    description: "Bounded literal equality test for the extraction sentinel.",
    input: boundedTextSchema,
    output: booleanSchema,
    implementation: (value) => value === "missing-identifier",
  }),
  defineFunction({
    id: "query-for-intermediate-id",
    version: "1.0.0",
    description:
      "Insert bounded untrusted evidence data into a fixed query template; it cannot select a capability.",
    input: boundedTextSchema,
    output: querySchema,
    implementation: (value) => `answer record ${value}`,
  }),
  defineFunction({
    id: "singleton-text",
    version: "1.0.0",
    description: "Create a known-bounded singleton text collection.",
    input: boundedTextSchema,
    output: boundedTextsSchema,
    implementation: (value) => [value],
    maxOutputItems: 1,
  }),
  defineFunction({
    id: "deduplicate-text",
    version: "1.0.0",
    description: "Deterministically deduplicate a bounded text set.",
    input: boundedTextsSchema,
    output: boundedTextsSchema,
    implementation: (values) => [...new Set(values)].toSorted(),
    maxOutputItems: 4,
  }),
  defineFunction({
    id: "normalize-query-term",
    version: "1.0.0",
    description: "Normalize one bounded text value without interpreting it.",
    input: boundedTextSchema,
    output: boundedTextSchema,
    implementation: (value) => value.trim().normalize("NFC"),
  }),
  definePredicate({
    id: "nonempty-text",
    version: "1.0.0",
    description: "A bounded predicate used only by collection selection.",
    input: boundedTextSchema,
    implementation: (value) => value.length > 0,
  }),
  defineReducer({
    id: "first-text",
    version: "1.0.0",
    description: "Select the first bounded text in deterministic order.",
    element: boundedTextSchema,
    accumulator: boundedTextSchema,
    identity: "missing-identifier",
    laws: { associative: false, commutative: false, idempotent: false },
    implementation: (current, value) =>
      current === "missing-identifier" ? value : current,
  }),
  defineFunction({
    id: "prepare-query-state",
    version: "1.0.0",
    description: "Prepare same-schema bounded deterministic iteration.",
    input: querySchema,
    output: queryStateSchema,
    implementation: (query) => ({ remaining: 1, query }),
  }),
  defineFixedPointStep({
    id: "advance-query-template",
    version: "1.0.0",
    description: "Advance same-schema query state with strict progress.",
    state: queryStateSchema,
    implementation: (state) => ({
      remaining: Math.max(0, state.remaining - 1),
      query: state.query,
    }),
  }),
  defineMeasure({
    id: "remaining-query-templates",
    version: "1.0.0",
    description: "Return the trusted nonnegative iteration measure.",
    input: queryStateSchema,
    implementation: (state) => state.remaining,
  }),
  defineFunction({
    id: "query-from-state",
    version: "1.0.0",
    description: "Read the query operand from bounded iteration state.",
    input: queryStateSchema,
    output: querySchema,
    implementation: (state) => state.query,
  }),
  defineFunction({
    id: "final-visible-evidence",
    version: "1.0.0",
    description: "Select the exact final visible evidence slice.",
    input: readResultSchema,
    output: readResultSchema,
    implementation: (read) => read,
  }),
]);

const schemas = Object.freeze([
  taskSchema.runtime,
  querySchema.runtime,
  boundedTextSchema.runtime,
  boundedTextsSchema.runtime,
  booleanSchema.runtime,
  countSchema.runtime,
  searchResultSchema.runtime,
  readResultSchema.runtime,
  queryStateSchema.runtime,
]);

const policy: CompilationPolicy = Object.freeze({
  allowedCapabilities: Object.freeze([
    "m9b10b.corpus.search",
    "m9b10b.corpus.read",
  ]),
  budget: Object.freeze({
    maxEffectCalls: 16,
    maxCollectionItems: 4,
    maxRecursionDepth: M9B10B_RETRIEVAL_LIMITS.maximumBoundedFixLimit,
    maxTokens: 0,
    maxWallClockMs: 1_000,
    maxParallelism: 1,
  }),
});

function createRetrievalCatalog(): Result<Catalog, ReadonlyArray<Diagnostic>> {
  return createCatalog({
    identity: {
      id: "lachesis.m9b10b.selected-retrieval-capabilities",
      version: "1.0.0",
    },
    schemas,
    operations,
  });
}

const artifactBrand: unique symbol = Symbol("M9b10bRetrievalArtifact");
export type M9b10bRetrievalArtifact = Readonly<{
  [artifactBrand]: "M9b10bRetrievalArtifact";
}>;

export type M9b10bRetrievalArtifactSummary = Readonly<{
  protocol: typeof M9B10B_RETRIEVAL_PROTOCOL;
  sourceDigest: string;
  compilationDigest: string;
  analysis: CodeModeArtifactSummary["analysis"];
}>;

type StoredArtifact = Readonly<{
  inner: CodeModeArtifact;
  source: string;
  summary: M9b10bRetrievalArtifactSummary;
}>;

const artifacts = new WeakMap<M9b10bRetrievalArtifact, StoredArtifact>();

export async function compileM9b10bRetrievalProgram(
  source: string,
): Promise<Result<M9b10bRetrievalArtifact, ReadonlyArray<Diagnostic>>> {
  if (
    encoder.encode(source).byteLength >
    M9B10B_RETRIEVAL_LIMITS.maximumSourceBytes
  )
    return {
      ok: false,
      error: [diagnostic("BUDGET_EXCEEDED", "M9b.10b source is oversized.")],
    };
  const catalog = createRetrievalCatalog();
  if (!catalog.ok) return catalog;
  const inner = await compileCodeModeWithDialect(
    {
      source,
      catalog: catalog.value,
      policy,
      taskInputs: [
        {
          name: "task",
          schema: { id: taskSchema.id, version: taskSchema.version },
          declaredBounds: [],
        },
      ],
      semanticObligations: [
        { kind: "requiresEffect", effectName: "m9b10b.corpus.search" },
        { kind: "requiresEffect", effectName: "m9b10b.corpus.read" },
      ],
    },
    {
      allowEffectInvoke: true,
      allowEffectMap: false,
      enforceRecursionLimit: true,
      requireKnownCollectionBounds: true,
    },
  );
  if (!inner.ok) return inner;
  const inspected = inspectCodeModeArtifact(inner.value);
  if (inspected === undefined)
    return {
      ok: false,
      error: [
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "M9b.10b compilation lost its closed-AST artifact.",
        ),
      ],
    };
  if (
    inspected.analysis.maximumOperationCalls >
    M9B10B_RETRIEVAL_LIMITS.maximumOperationCalls
  )
    return {
      ok: false,
      error: [
        diagnostic(
          "BUDGET_EXCEEDED",
          "M9b.10b operation bound exceeds the frozen profile.",
        ),
      ],
    };
  const sourceDigest = await digestValue({
    protocol: M9B10B_RETRIEVAL_PROTOCOL,
    source,
  });
  if (!sourceDigest.ok) return { ok: false, error: [sourceDigest.error] };
  const compilationDigest = await digestValue({
    protocol: M9B10B_RETRIEVAL_PROTOCOL,
    sourceDigest: sourceDigest.value,
    analysis: inspected.analysis,
  });
  if (!compilationDigest.ok)
    return { ok: false, error: [compilationDigest.error] };
  const summary = Object.freeze({
    protocol: M9B10B_RETRIEVAL_PROTOCOL,
    sourceDigest: sourceDigest.value,
    compilationDigest: compilationDigest.value,
    analysis: inspected.analysis,
  });
  const token: M9b10bRetrievalArtifact = Object.freeze({
    [artifactBrand]: "M9b10bRetrievalArtifact",
  });
  artifacts.set(token, { inner: inner.value, source, summary });
  return { ok: true, value: token };
}

export function inspectM9b10bRetrievalArtifact(
  artifact: M9b10bRetrievalArtifact,
): M9b10bRetrievalArtifactSummary | undefined {
  return artifacts.get(artifact)?.summary;
}

const searchEventSchema = z
  .strictObject({
    kind: z.literal("search"),
    callIndex: z.number().int().positive().max(2),
    query: queryValidator,
    result: m9aSearchResultSchema,
  })
  .readonly();
const readEventSchema = z
  .strictObject({
    kind: z.literal("read"),
    callIndex: z.number().int().positive().max(2),
    requestChunkIds: z.string().array().max(4).readonly(),
    result: m9aReadResultSchema,
  })
  .readonly();
export const m9b10bRetrievalEventSchema = z.discriminatedUnion("kind", [
  searchEventSchema,
  readEventSchema,
]);
export type M9b10bRetrievalEvent = z.infer<typeof m9b10bRetrievalEventSchema>;

export const m9b10bRetrievalRunSchema = z
  .strictObject({
    protocol: z.literal(M9B10B_RETRIEVAL_PROTOCOL.id),
    protocolVersion: z.literal(M9B10B_RETRIEVAL_PROTOCOL.version),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    compilationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    taskDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    events: m9b10bRetrievalEventSchema.array().min(2).max(4).readonly(),
    finalEvidence: m9aReadResultSchema,
    providerModelCalls: z.literal(0),
    transcriptDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    runDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .readonly();
export type M9b10bRetrievalRun = z.infer<typeof m9b10bRetrievalRunSchema>;

type MutableContext = {
  searchCalls: number;
  readCalls: number;
  readBytes: number;
  events: Array<M9b10bRetrievalEvent>;
};

function executionDiagnostic(message: string): Diagnostic {
  return diagnostic("RUNTIME_SCHEMA_VIOLATION", `M9b.10b: ${message}`);
}

function selectReadableHits(
  result: M9aSearchResult,
  maximumBytes: number,
): ReadonlyArray<M9aSearchResult["hits"][number]["chunk"]> {
  const selected: Array<M9aSearchResult["hits"][number]["chunk"]> = [];
  let bytes = 0;
  for (const hit of result.hits) {
    const nextBytes = hit.chunk.endByte - hit.chunk.startByte;
    if (bytes + nextBytes > maximumBytes) continue;
    selected.push(hit.chunk);
    bytes += nextBytes;
  }
  return Object.freeze(selected);
}

function createEffectHandler(
  corpus: M9aCorpus,
  context: MutableContext,
  signal: AbortSignal,
): CodeModeEffectHandler {
  return async (request) => {
    await Promise.resolve();
    if (signal.aborted)
      return { ok: false, error: executionDiagnostic("execution aborted") };
    if (request.effectName === "m9b10b.corpus.search") {
      const query = queryValidator.safeParse(request.input);
      if (!query.success)
        return {
          ok: false,
          error: executionDiagnostic("invalid search query"),
        };
      context.searchCalls += 1;
      if (context.searchCalls > M9B10B_RETRIEVAL_LIMITS.maximumSearchCalls)
        return {
          ok: false,
          error: executionDiagnostic("search limit exceeded"),
        };
      const result = searchM9aCorpus(
        corpus,
        {
          query: query.data,
          maxResults: M9B10B_RETRIEVAL_LIMITS.maximumSearchResultsPerCall,
        },
        signal,
      );
      if (!result.ok)
        return {
          ok: false,
          error: executionDiagnostic(`search failed: ${result.error.kind}`),
        };
      context.events.push({
        kind: "search",
        callIndex: context.searchCalls,
        query: query.data,
        result: result.value,
      });
      return {
        ok: true,
        value: { value: result.value, usage: { tokens: 0, wallClockMs: 0 } },
      };
    }
    if (request.effectName === "m9b10b.corpus.read") {
      const search = m9aSearchResultSchema.safeParse(request.input);
      if (!search.success)
        return { ok: false, error: executionDiagnostic("invalid read input") };
      context.readCalls += 1;
      if (context.readCalls > M9B10B_RETRIEVAL_LIMITS.maximumReadCalls)
        return { ok: false, error: executionDiagnostic("read limit exceeded") };
      const remaining =
        M9B10B_RETRIEVAL_LIMITS.maximumTotalReadBytes - context.readBytes;
      const maximumBytes = Math.min(
        remaining,
        M9B10B_RETRIEVAL_LIMITS.maximumReadBytesPerCall,
      );
      const chunks = selectReadableHits(search.data, maximumBytes);
      const result = readM9aCorpus(
        corpus,
        { chunks, maxBytes: maximumBytes },
        signal,
      );
      if (!result.ok)
        return {
          ok: false,
          error: executionDiagnostic(`read failed: ${result.error.kind}`),
        };
      context.readBytes += result.value.totalBytes;
      context.events.push({
        kind: "read",
        callIndex: context.readCalls,
        requestChunkIds: chunks.map((chunk) => chunk.id),
        result: result.value,
      });
      return {
        ok: true,
        value: { value: result.value, usage: { tokens: 0, wallClockMs: 0 } },
      };
    }
    return {
      ok: false,
      error: executionDiagnostic("forbidden capability requested"),
    };
  };
}

export type M9b10bRetrievalFailure = Readonly<{
  kind: "invalid-artifact" | "execution" | "invalid-output" | "digest-failure";
  failure?: CodeModeExecutionFailure | undefined;
  diagnostic?: Diagnostic | undefined;
}>;

async function digestRunBody(
  body: Omit<M9b10bRetrievalRun, "transcriptDigest" | "runDigest">,
): Promise<
  Result<Readonly<{ transcriptDigest: string; runDigest: string }>, Diagnostic>
> {
  const transcriptDigest = await digestValue({
    protocol: M9B10B_RETRIEVAL_PROTOCOL,
    events: body.events,
  });
  if (!transcriptDigest.ok) return transcriptDigest;
  const runDigest = await digestValue({
    ...body,
    transcriptDigest: transcriptDigest.value,
  });
  return runDigest.ok
    ? {
        ok: true,
        value: {
          transcriptDigest: transcriptDigest.value,
          runDigest: runDigest.value,
        },
      }
    : runDigest;
}

export async function executeM9b10bRetrievalProgram(
  artifact: M9b10bRetrievalArtifact,
  input: Readonly<{
    corpus: M9aCorpus;
    task: string;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9b10bRetrievalRun, M9b10bRetrievalFailure>> {
  const stored = artifacts.get(artifact);
  const snapshot = inspectM9aCorpus(input.corpus);
  if (stored === undefined || snapshot === undefined)
    return { ok: false, error: { kind: "invalid-artifact" } };
  const context: MutableContext = {
    searchCalls: 0,
    readCalls: 0,
    readBytes: 0,
    events: [],
  };
  const signal = input.signal ?? new AbortController().signal;
  const executed = await executeCodeMode(stored.inner, {
    inputs: new Map([["task", input.task]]),
    effectHandler: createEffectHandler(input.corpus, context, signal),
    timeoutMs: policy.budget.maxWallClockMs,
  });
  if (!executed.ok)
    return { ok: false, error: { kind: "execution", failure: executed.error } };
  const finalEvidence = m9aReadResultSchema.safeParse(executed.value.output);
  if (!finalEvidence.success)
    return {
      ok: false,
      error: {
        kind: "invalid-output",
        diagnostic: executionDiagnostic("program must return visible evidence"),
      },
    };
  const taskDigest = await digestValue({ task: input.task });
  if (!taskDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: taskDigest.error },
    };
  const body = {
    protocol: M9B10B_RETRIEVAL_PROTOCOL.id,
    protocolVersion: M9B10B_RETRIEVAL_PROTOCOL.version,
    sourceDigest: stored.summary.sourceDigest,
    compilationDigest: stored.summary.compilationDigest,
    taskDigest: taskDigest.value,
    snapshotDigest: snapshot.snapshotDigest,
    events: Object.freeze([...context.events]),
    finalEvidence: finalEvidence.data,
    providerModelCalls: 0 as const,
  };
  const digests = await digestRunBody(body);
  if (!digests.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: digests.error },
    };
  return {
    ok: true,
    value: m9b10bRetrievalRunSchema.parse({ ...body, ...digests.value }),
  };
}

export async function verifyM9b10bRetrievalRun(
  artifact: M9b10bRetrievalArtifact,
  snapshot: M9aCorpusSnapshot,
  task: string,
  run: M9b10bRetrievalRun,
): Promise<Result<M9b10bRetrievalRun, Diagnostic>> {
  const parsed = m9b10bRetrievalRunSchema.safeParse(run);
  const stored = artifacts.get(artifact);
  if (!parsed.success || stored === undefined)
    return { ok: false, error: executionDiagnostic("invalid replay artifact") };
  const taskDigest = await digestValue({ task });
  if (!taskDigest.ok) return taskDigest;
  const {
    transcriptDigest: ignoredTranscript,
    runDigest: ignoredRun,
    ...body
  } = parsed.data;
  void ignoredTranscript;
  void ignoredRun;
  const digests = await digestRunBody(body);
  if (
    !digests.ok ||
    parsed.data.sourceDigest !== stored.summary.sourceDigest ||
    parsed.data.compilationDigest !== stored.summary.compilationDigest ||
    parsed.data.taskDigest !== taskDigest.value ||
    parsed.data.snapshotDigest !== snapshot.snapshotDigest ||
    parsed.data.finalEvidence.snapshotDigest !== snapshot.snapshotDigest ||
    digests.value.transcriptDigest !== parsed.data.transcriptDigest ||
    digests.value.runDigest !== parsed.data.runDigest
  )
    return { ok: false, error: executionDiagnostic("replay lineage mismatch") };
  const canonical = canonicalizeJson(parsed.data);
  if (!canonical.ok) return canonical;
  return { ok: true, value: parsed.data };
}

export const M9B10B_ADAPTIVE_WITNESS_SOURCE = `export default async function main(input, ops) {
  const firstQuery = await ops.invoke("task-query@1.0.0", input.task);
  const firstSearch = await ops.invoke("search@1.0.0", firstQuery);
  const firstRead = await ops.invoke("read@1.0.0", firstSearch);
  const identifier = await ops.invoke("extract-intermediate-id@1.0.0", firstRead);
  const secondQuery = await ops.invoke("query-for-intermediate-id@1.0.0", identifier);
  const secondSearch = await ops.invoke("search@1.0.0", secondQuery);
  const secondRead = await ops.invoke("read@1.0.0", secondSearch);
  const visible = await ops.invoke("final-visible-evidence@1.0.0", secondRead);
  return visible;
}`;

export const M9B10B_ALGEBRA_WITNESS_SOURCE = `export default async function main(input, ops) {
  const firstQuery = await ops.invoke("task-query@1.0.0", input.task);
  const firstSearch = await ops.invoke("search@1.0.0", firstQuery);
  const count = await ops.invoke("search-count@1.0.0", firstSearch);
  const zeroCount = await ops.invoke("count-is-zero@1.0.0", count);
  const empty = await ops.invoke("search-is-empty@1.0.0", firstSearch);
  const firstRead = await ops.invoke("read@1.0.0", firstSearch);
  const hasIdentifier = await ops.invoke("evidence-contains-intermediate-id@1.0.0", firstRead);
  const identifier = await ops.invoke("extract-intermediate-id@1.0.0", firstRead);
  const missing = await ops.invoke("text-equals-missing@1.0.0", identifier);
  const singleton = await ops.invoke("singleton-text@1.0.0", identifier);
  const normalized = await ops.map("normalize-query-term@1.0.0", singleton);
  const selected = await ops.filter("nonempty-text@1.0.0", normalized);
  const deduplicated = await ops.invoke("deduplicate-text@1.0.0", selected);
  const folded = await ops.fold("first-text@1.0.0", deduplicated);
  const derived = await ops.invoke("query-for-intermediate-id@1.0.0", folded);
  const contentSelected = await ops.select(hasIdentifier, derived, firstQuery);
  const extractionSelected = await ops.select(missing, firstQuery, contentSelected);
  const state = await ops.invoke("prepare-query-state@1.0.0", extractionSelected);
  const advanced = await ops.boundedFix("advance-query-template@1.0.0", "remaining-query-templates@1.0.0", state, 2);
  const iterated = await ops.invoke("query-from-state@1.0.0", advanced);
  const emptinessSelected = await ops.select(empty, firstQuery, iterated);
  const chosen = await ops.select(zeroCount, firstQuery, emptinessSelected);
  const secondSearch = await ops.invoke("search@1.0.0", chosen);
  const secondRead = await ops.invoke("read@1.0.0", secondSearch);
  const visible = await ops.invoke("final-visible-evidence@1.0.0", secondRead);
  return visible;
}`;
