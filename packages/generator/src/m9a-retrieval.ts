import {
  type Catalog,
  type CompilationPolicy,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  defineReducer,
  defineSchema,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  CODEMODE_PROTOCOL,
  type CodeModeArtifact,
  type CodeModeEffectHandler,
  type CodeModeExecutionFailure,
  type CodeModeExecutionResult,
  type CodeModeRuntimeUsage,
  type CodeModeStaticAnalysis,
  compileCodeModeWithDialect,
  executeCodeMode,
  inspectCodeModeArtifact,
} from "./codemode.js";
import {
  inspectM9aCorpus,
  M9A_CORPUS_LIMITS,
  type M9aChunkIdentity,
  m9aChunkIdentitySchema,
  type M9aCorpus,
  type M9aCorpusSnapshot,
  m9aCorpusSnapshotSchema,
  m9aReadExcerptSchema,
  type M9aReadResult,
  m9aReadResultSchema,
  type M9aRetrievalFailure,
  m9aRetrievalFailureSchema,
  type M9aSearchResult,
  m9aSearchResultSchema,
  readM9aCorpus,
  searchM9aCorpus,
} from "./m9a-corpus.js";
import { strictJsonValueSchema } from "./strict-json.js";

export const M9A_RETRIEVAL_CODEMODE_PROTOCOL = Object.freeze({
  id: "lachesis-m9a-retrieval-codemode",
  version: "1.1.0",
  grammar: "closed-retrieval-capability-typescript/1",
  composedInterpreter: Object.freeze({
    id: CODEMODE_PROTOCOL.id,
    version: CODEMODE_PROTOCOL.version,
  }),
  delta:
    "registered effects may be invoked directly and mapped over known-bounded collections",
  isolation:
    "source is parsed and interpreted as a closed AST and never enters eval, Function, vm, a module loader, a child process, or an ordinary JavaScript execution realm",
  claimBoundary:
    "offline infrastructure and citation-confinement evidence only; semantic correctness and grounding require external evaluation, which M9a does not perform, and no retrieval-quality or production-readiness claim is made",
});

export const M9A_PRIVATE_REPLAY_PROTOCOL = Object.freeze({
  id: "lachesis-m9a-private-retrieval-replay",
  version: "1.1.0",
  visibility:
    "private artifact containing exact effect inputs, fetched evidence, and reduced outputs",
});

export const M9A_MODEL_VISIBLE_GRAMMAR = Object.freeze({
  id: "lachesis-m9a-retrieval-codemode-model-visible-grammar",
  version: "1.1",
  template: `export default async function main(input, ops) {
  const questions = await ops.invoke("decompose-query@1.0.0", input.task);
  const searches = await ops.map("search-corpus@1.0.0", questions);
  const evidence = await ops.map("read-search-results@1.0.0", searches);
  const partials = await ops.map("answer-evidence-slice@1.0.0", evidence);
  const answer = await ops.fold("synthesize-citation-confined-answer@1.0.0", partials);
  const submitted = await ops.invoke("submit-citation-confined-answer@1.0.0", answer);
  return submitted;
}`,
  rules: Object.freeze([
    "The program is one default-exported async main(input, ops).",
    "The body contains only single const capability bindings and one final return.",
    "Values are input fields, prior bindings, or scalar JSON literals.",
    "All operation references are exact registered id@version string literals.",
    "invoke and map may dispatch only registered, authorized effects.",
    "Collections produced by operations require explicit trusted maximum bounds.",
    "boundedFix requires a registered same-schema fixedPointStep, a registered nonnegative measure, and a nonnegative literal hard limit.",
    "There are no imports, callbacks, loops, helper functions, ambient globals, or general recursion.",
  ]),
});

export const M9A_ONE_SHOT_RAG_SOURCE = `export default async function main(input, ops) {
  const query = await ops.invoke("task-as-question@1.0.0", input.task);
  const search = await ops.invoke("search-corpus@1.0.0", query);
  const evidence = await ops.invoke("read-search-results@1.0.0", search);
  const partial = await ops.invoke("answer-evidence-slice@1.0.0", evidence);
  const partials = await ops.invoke("as-partial-list@1.0.0", partial);
  const answer = await ops.fold("synthesize-citation-confined-answer@1.0.0", partials);
  const submitted = await ops.invoke("submit-citation-confined-answer@1.0.0", answer);
  return submitted;
}`;

export const M9A_DEFAULT_RESOURCE_ENVELOPE: CompilationPolicy = Object.freeze({
  allowedCapabilities: Object.freeze([
    "m9a.corpus.search",
    "m9a.corpus.read",
    "m9a.model.decompose",
    "m9a.model.answer",
    "m9a.answer.submit",
  ]),
  budget: Object.freeze({
    maxEffectCalls: 14,
    maxCollectionItems: 4,
    maxRecursionDepth: 4,
    maxTokens: 4_096,
    maxWallClockMs: 15_000,
    maxParallelism: 1,
  }),
});

export const M9A_EXECUTION_LIMITS = Object.freeze({
  maxSourceBytes: 32 * 1_024,
  maxOperationCalls: 64,
  maxRootModelCalls: 1,
  maxLeafModelCalls: 4,
  maxSearchCalls: 4,
  maxReadCalls: 4,
  maxReturnedSearchResults: 32,
  maxTotalReadBytes: M9A_CORPUS_LIMITS.maxReadBytes,
  maxInputTokens: 2_048,
  maxOutputTokens: 2_048,
  maxCostUsdMicros: 0,
});

export const M9A_MODEL_RESERVATIONS = Object.freeze({
  root: Object.freeze({
    maxInputTokens: 128,
    maxOutputTokens: 128,
    maxWallClockMs: 1_000,
    maxCostUsdMicros: 0,
  }),
  leaf: Object.freeze({
    maxInputTokens: 256,
    maxOutputTokens: 256,
    maxWallClockMs: 2_000,
    maxCostUsdMicros: 0,
  }),
});

const taskValidator = z.string().min(1).max(2_048);
const questionValidator = z.string().min(1).max(512);
const questionsValidator = questionValidator.array().min(1).max(4).readonly();
const evidenceSliceSchema = z
  .strictObject({
    question: questionValidator,
    excerpts: m9aReadExcerptSchema.array().readonly(),
  })
  .readonly();
export type M9aEvidenceSlice = z.infer<typeof evidenceSliceSchema>;

const partialAnswerSchema = z
  .strictObject({
    claim: z.string().min(1).max(4_096),
    citations: m9aChunkIdentitySchema.array().max(8).readonly(),
  })
  .readonly();
export type M9aPartialAnswer = z.infer<typeof partialAnswerSchema>;

export const m9aCitationConfinedAnswerSchema = z
  .strictObject({
    answer: z.string().max(16_384),
    citations: m9aChunkIdentitySchema.array().max(32).readonly(),
  })
  .readonly();
export type M9aCitationConfinedAnswer = z.infer<
  typeof m9aCitationConfinedAnswerSchema
>;

export const M9A_ANSWER_VALIDATION = Object.freeze({
  kind: "citation-confinement-only" as const,
  semanticEvaluation: "external-not-performed" as const,
});

const retrievalStateSchema = z
  .strictObject({
    remaining: z.number().int().nonnegative().max(4),
    pending: questionValidator.array().max(4).readonly(),
    refined: questionValidator.array().max(4).readonly(),
  })
  .readonly()
  .refine((state) => state.remaining === state.pending.length, {
    message: "remaining must equal the pending-query count",
  });
export type M9aRetrievalState = z.infer<typeof retrievalStateSchema>;

const taskSchema = defineSchema({
  id: "m9a-task",
  version: "1.0.0",
  description: "A bounded external-knowledge task.",
  validator: taskValidator,
});
const questionSchema = defineSchema({
  id: "m9a-question",
  version: "1.0.0",
  description: "One bounded retrieval question.",
  validator: questionValidator,
});
const questionsSchema = defineCollectionSchema({
  id: "m9a-questions",
  version: "1.0.0",
  description: "A known-bounded sequence of retrieval questions.",
  validator: questionsValidator,
  element: questionSchema,
  defaultMaxItems: 4,
});
const searchResultSchema = defineSchema({
  id: "m9a-search-result",
  version: "1.0.0",
  description: "Search hits without document contents.",
  validator: m9aSearchResultSchema,
});
const searchResultsSchema = defineCollectionSchema({
  id: "m9a-search-results",
  version: "1.0.0",
  description: "A known-bounded sequence of search results.",
  validator: m9aSearchResultSchema.array().max(4).readonly(),
  element: searchResultSchema,
  defaultMaxItems: 4,
});
const evidenceSchema = defineSchema({
  id: "m9a-evidence-slice",
  version: "1.0.0",
  description: "Document contents exposed by one bounded read.",
  validator: evidenceSliceSchema,
});
const evidenceSlicesSchema = defineCollectionSchema({
  id: "m9a-evidence-slices",
  version: "1.0.0",
  description: "A known-bounded sequence of evidence slices.",
  validator: evidenceSliceSchema.array().max(4).readonly(),
  element: evidenceSchema,
  defaultMaxItems: 4,
});
const partialSchema = defineSchema({
  id: "m9a-partial-answer",
  version: "1.0.0",
  description: "One leaf-model claim citing only assigned evidence.",
  validator: partialAnswerSchema,
});
const partialsSchema = defineCollectionSchema({
  id: "m9a-partial-answers",
  version: "1.0.0",
  description: "A known-bounded sequence of leaf-model answers.",
  validator: partialAnswerSchema.array().max(4).readonly(),
  element: partialSchema,
  defaultMaxItems: 4,
});
const citationConfinedAnswerSchema = defineSchema({
  id: "m9a-citation-confined-answer",
  version: "1.0.0",
  description:
    "A final answer with confined canonical citations and no semantic-correctness claim.",
  validator: m9aCitationConfinedAnswerSchema,
});
const retrievalStateRegistration = defineSchema({
  id: "m9a-retrieval-state",
  version: "1.0.0",
  description: "A same-schema bounded query-refinement state.",
  validator: retrievalStateSchema,
});

const operations = Object.freeze([
  defineFunction({
    id: "task-as-question",
    version: "1.0.0",
    description:
      "Explicitly convert the nominal task schema to the nominal question schema.",
    input: taskSchema,
    output: questionSchema,
    implementation: (task) => task,
  }),
  defineEffect({
    id: "decompose-query",
    version: "1.0.0",
    description: "Ask the offline model boundary for bounded subquestions.",
    input: taskSchema,
    output: questionsSchema,
    effectName: "m9a.model.decompose",
    capability: "m9a.model.decompose",
    maxTokens:
      M9A_MODEL_RESERVATIONS.root.maxInputTokens +
      M9A_MODEL_RESERVATIONS.root.maxOutputTokens,
    maxWallClockMs: 1_000,
    replayable: true,
    maxOutputItems: 4,
  }),
  defineEffect({
    id: "search-corpus",
    version: "1.0.0",
    description: "Search the bound immutable corpus snapshot.",
    input: questionSchema,
    output: searchResultSchema,
    effectName: "m9a.corpus.search",
    capability: "m9a.corpus.search",
    maxTokens: 0,
    maxWallClockMs: 100,
    replayable: true,
  }),
  defineEffect({
    id: "read-search-results",
    version: "1.0.0",
    description: "Read only canonical chunks returned by search.",
    input: searchResultSchema,
    output: evidenceSchema,
    effectName: "m9a.corpus.read",
    capability: "m9a.corpus.read",
    maxTokens: 0,
    maxWallClockMs: 100,
    replayable: true,
  }),
  defineEffect({
    id: "answer-evidence-slice",
    version: "1.0.0",
    description: "Run leaf reasoning over exactly one assigned evidence slice.",
    input: evidenceSchema,
    output: partialSchema,
    effectName: "m9a.model.answer",
    capability: "m9a.model.answer",
    maxTokens:
      M9A_MODEL_RESERVATIONS.leaf.maxInputTokens +
      M9A_MODEL_RESERVATIONS.leaf.maxOutputTokens,
    maxWallClockMs: 2_000,
    replayable: true,
  }),
  defineReducer({
    id: "synthesize-citation-confined-answer",
    version: "1.0.0",
    description:
      "Aggregate ordered leaf answers while preserving their confined citations.",
    element: partialSchema,
    accumulator: citationConfinedAnswerSchema,
    identity: { answer: "", citations: [] },
    laws: {
      associative: false,
      commutative: false,
      idempotent: false,
    },
    implementation: (answer, partial) => ({
      answer:
        answer.answer.length === 0
          ? partial.claim
          : `${answer.answer}\n${partial.claim}`,
      citations: [
        ...new Map(
          [...answer.citations, ...partial.citations].map((citation) => [
            citation.id,
            citation,
          ]),
        ).values(),
      ].toSorted((left, right) => left.id.localeCompare(right.id)),
    }),
  }),
  defineEffect({
    id: "submit-citation-confined-answer",
    version: "1.0.0",
    description:
      "Validate citation visibility and submit without claiming semantic support.",
    input: citationConfinedAnswerSchema,
    output: citationConfinedAnswerSchema,
    effectName: "m9a.answer.submit",
    capability: "m9a.answer.submit",
    maxTokens: 0,
    maxWallClockMs: 100,
    replayable: true,
  }),
  defineFunction({
    id: "as-partial-list",
    version: "1.0.0",
    description: "Place one partial answer into a singleton collection.",
    input: partialSchema,
    output: partialsSchema,
    implementation: (partial) => [partial],
    maxOutputItems: 1,
  }),
  defineFunction({
    id: "prepare-retrieval-state",
    version: "1.0.0",
    description: "Initialize a same-schema bounded query-refinement state.",
    input: questionsSchema,
    output: retrievalStateRegistration,
    implementation: (questions) => ({
      remaining: questions.length,
      pending: questions,
      refined: [],
    }),
  }),
  defineFixedPointStep({
    id: "refine-next-query",
    version: "1.0.0",
    description:
      "Refine one pending query without performing an implicit read.",
    state: retrievalStateRegistration,
    implementation: (state) => {
      const next = state.pending.at(0);
      if (next === undefined) return state;
      const pending = state.pending.slice(1);
      return {
        remaining: pending.length,
        pending,
        refined: [...state.refined, `${next} evidence`],
      };
    },
  }),
  defineMeasure({
    id: "remaining-retrieval-queries",
    version: "1.0.0",
    description: "Read the trusted nonnegative pending-query count.",
    input: retrievalStateRegistration,
    implementation: (state) => state.remaining,
  }),
  defineFunction({
    id: "take-refined-queries",
    version: "1.0.0",
    description: "Extract bounded refined queries after boundedFix.",
    input: retrievalStateRegistration,
    output: questionsSchema,
    implementation: (state) => state.refined,
    maxOutputItems: 4,
  }),
]);

export function createM9aCapabilityCatalog(): Result<
  Catalog,
  ReadonlyArray<Diagnostic>
> {
  return createCatalog({
    identity: {
      id: "lachesis.m9a.retrieval-capabilities",
      version: "1.1.0",
    },
    schemas: [
      taskSchema.runtime,
      questionSchema.runtime,
      questionsSchema.runtime,
      searchResultSchema.runtime,
      searchResultsSchema.runtime,
      evidenceSchema.runtime,
      evidenceSlicesSchema.runtime,
      partialSchema.runtime,
      partialsSchema.runtime,
      citationConfinedAnswerSchema.runtime,
      retrievalStateRegistration.runtime,
    ],
    operations,
  });
}

export const m9aModelUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
    costUsdMicros: z.literal(0),
  })
  .readonly();
export type M9aModelUsage = z.infer<typeof m9aModelUsageSchema>;

export const m9aModelReservationSchema = z
  .strictObject({
    maxInputTokens: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().nonnegative(),
    maxWallClockMs: z.number().int().nonnegative(),
    maxCostUsdMicros: z.literal(0),
  })
  .readonly();
export type M9aModelReservation = z.infer<typeof m9aModelReservationSchema>;

export type M9aOfflineModelResult<T> = Readonly<{
  value: T;
  usage: M9aModelUsage;
}>;

export type M9aOfflineModel = Readonly<{
  identity: Readonly<{ id: string; version: string }>;
  decompose: (
    task: string,
    signal: AbortSignal,
    reservation: M9aModelReservation,
  ) => Promise<
    Result<M9aOfflineModelResult<ReadonlyArray<string>>, M9aRetrievalFailure>
  >;
  answer: (
    evidence: M9aEvidenceSlice,
    signal: AbortSignal,
    reservation: M9aModelReservation,
  ) => Promise<
    Result<M9aOfflineModelResult<M9aPartialAnswer>, M9aRetrievalFailure>
  >;
}>;

export const m9aTranscriptEventSchema = z
  .strictObject({
    sequence: z.number().int().nonnegative(),
    category: z.enum([
      "root-model",
      "search",
      "read",
      "leaf-model",
      "submission",
    ]),
    operation: z.string().min(1),
    effectName: z.string().min(1),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    outputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidenceChunkIds: z.string().array().readonly(),
    itemCount: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    usage: m9aModelUsageSchema,
  })
  .readonly();
export type M9aTranscriptEvent = z.infer<typeof m9aTranscriptEventSchema>;

export const m9aRunTranscriptSchema = z
  .strictObject({
    protocol: z.strictObject({
      id: z.literal(M9A_RETRIEVAL_CODEMODE_PROTOCOL.id),
      version: z.literal(M9A_RETRIEVAL_CODEMODE_PROTOCOL.version),
    }),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    semanticContractHash: z.string().regex(/^[a-f0-9]{64}$/u),
    corpusSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    taskDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    model: z
      .strictObject({ id: z.string().min(1), version: z.string().min(1) })
      .readonly(),
    operationDependencies: z.string().array().readonly(),
    effectDependencies: z.string().array().readonly(),
    events: m9aTranscriptEventSchema.array().readonly(),
    runtimeUsage: z
      .strictObject({
        operationCalls: z.number().int().nonnegative(),
        effectCalls: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        wallClockMs: z.number().int().nonnegative(),
      })
      .readonly(),
    retrievalUsage: z
      .strictObject({
        rootModelCalls: z.number().int().nonnegative(),
        leafModelCalls: z.number().int().nonnegative(),
        searchCalls: z.number().int().nonnegative(),
        readCalls: z.number().int().nonnegative(),
        returnedSearchResults: z.number().int().nonnegative(),
        readBytes: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        costUsdMicros: z.literal(0),
      })
      .readonly(),
    answerValidation: z
      .strictObject({
        kind: z.literal(M9A_ANSWER_VALIDATION.kind),
        semanticEvaluation: z.literal(M9A_ANSWER_VALIDATION.semanticEvaluation),
      })
      .readonly(),
    answerDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    citationChunkIds: z.string().array().readonly(),
  })
  .readonly();
export type M9aRunTranscript = z.infer<typeof m9aRunTranscriptSchema>;

export const m9aPrivateReplayEntrySchema = z
  .strictObject({
    sequence: z.number().int().nonnegative(),
    operation: z.string().min(1),
    effectName: z.string().min(1),
    input: strictJsonValueSchema,
    output: strictJsonValueSchema,
    usage: m9aModelUsageSchema,
    event: m9aTranscriptEventSchema,
    readResult: m9aReadResultSchema.nullable(),
  })
  .readonly();
export type M9aPrivateReplayEntry = z.infer<typeof m9aPrivateReplayEntrySchema>;

const m9aPrivateReplayArtifactBodyObjectSchema = z.strictObject({
  protocol: z.strictObject({
    id: z.literal(M9A_PRIVATE_REPLAY_PROTOCOL.id),
    version: z.literal(M9A_PRIVATE_REPLAY_PROTOCOL.version),
  }),
  retrievalProtocol: z.strictObject({
    id: z.literal(M9A_RETRIEVAL_CODEMODE_PROTOCOL.id),
    version: z.literal(M9A_RETRIEVAL_CODEMODE_PROTOCOL.version),
  }),
  source: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  semanticContractHash: z.string().regex(/^[a-f0-9]{64}$/u),
  task: taskValidator,
  corpus: m9aCorpusSnapshotSchema,
  model: z
    .strictObject({ id: z.string().min(1), version: z.string().min(1) })
    .readonly(),
  entries: m9aPrivateReplayEntrySchema.array().readonly(),
  expectedTranscriptDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedAnswerDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedRunDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
const m9aPrivateReplayArtifactBodySchema =
  m9aPrivateReplayArtifactBodyObjectSchema.readonly();

export const m9aPrivateReplayArtifactSchema =
  m9aPrivateReplayArtifactBodyObjectSchema
    .extend({
      artifactDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .readonly();
export type M9aPrivateReplayArtifact = z.infer<
  typeof m9aPrivateReplayArtifactSchema
>;

export type M9aRetrievalVisibility = Readonly<{
  searchResults: ReadonlyArray<M9aSearchResult>;
  readResults: ReadonlyArray<M9aReadResult>;
}>;

export type M9aRetrievalRun = Readonly<{
  runDigest: string;
  answer: M9aCitationConfinedAnswer;
  answerValidation: typeof M9A_ANSWER_VALIDATION;
  visibility: M9aRetrievalVisibility;
  transcript: M9aRunTranscript;
  predictedUsage: CodeModeStaticAnalysis;
}>;

export type M9aRunFailure =
  | Readonly<{ kind: "invalid-artifact" }>
  | Readonly<{ kind: "invalid-comparison"; diagnostic: Diagnostic }>
  | Readonly<{ kind: "execution"; failure: CodeModeExecutionFailure }>
  | Readonly<{ kind: "invalid-output"; failure: M9aRetrievalFailure }>
  | Readonly<{ kind: "replay-mismatch"; diagnostic: Diagnostic }>
  | Readonly<{ kind: "digest-failure"; diagnostic: Diagnostic }>;

export type M9aCompileFailure = Readonly<{
  kind: "compile";
  diagnostics: ReadonlyArray<Diagnostic>;
}>;

const artifactBrand: unique symbol = Symbol("M9aRetrievalArtifact");
export type M9aRetrievalArtifact = Readonly<{
  [artifactBrand]: "M9aRetrievalArtifact";
}>;

export type M9aRetrievalArtifactSummary = Readonly<{
  protocol: typeof M9A_RETRIEVAL_CODEMODE_PROTOCOL;
  sourceHash: string;
  semanticContractHash: string;
  analysis: CodeModeStaticAnalysis;
}>;

type StoredArtifact = Readonly<{
  inner: CodeModeArtifact;
  source: string;
  summary: M9aRetrievalArtifactSummary;
}>;

const artifacts = new WeakMap<M9aRetrievalArtifact, StoredArtifact>();

export async function compileM9aRetrievalProgram(
  source: string,
): Promise<Result<M9aRetrievalArtifact, ReadonlyArray<Diagnostic>>> {
  if (
    new TextEncoder().encode(source).byteLength >
    M9A_EXECUTION_LIMITS.maxSourceBytes
  )
    return {
      ok: false,
      error: [
        diagnostic(
          "BUDGET_EXCEEDED",
          "M9a source exceeds the explicit source-byte limit.",
        ),
      ],
    };
  const catalog = createM9aCapabilityCatalog();
  if (!catalog.ok) return catalog;
  const inner = await compileCodeModeWithDialect(
    {
      source,
      catalog: catalog.value,
      policy: M9A_DEFAULT_RESOURCE_ENVELOPE,
      taskInputs: [
        {
          name: "task",
          schema: { id: taskSchema.id, version: taskSchema.version },
          declaredBounds: [],
        },
      ],
      semanticObligations: [
        { kind: "requiresEffect", effectName: "m9a.corpus.search" },
        { kind: "requiresEffect", effectName: "m9a.corpus.read" },
        { kind: "requiresEffect", effectName: "m9a.model.answer" },
        { kind: "requiresEffect", effectName: "m9a.answer.submit" },
      ],
    },
    {
      allowEffectInvoke: true,
      allowEffectMap: true,
      enforceRecursionLimit: true,
      requireKnownCollectionBounds: true,
    },
  );
  if (!inner.ok) return inner;
  const innerSummary = inspectCodeModeArtifact(inner.value);
  if (innerSummary === undefined)
    return {
      ok: false,
      error: [
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "M9a compilation lost its closed-interpreter artifact.",
        ),
      ],
    };
  if (
    innerSummary.analysis.maximumOperationCalls >
    M9A_EXECUTION_LIMITS.maxOperationCalls
  )
    return {
      ok: false,
      error: [
        diagnostic(
          "BUDGET_EXCEEDED",
          `M9a operation-call bound ${innerSummary.analysis.maximumOperationCalls} exceeds ${M9A_EXECUTION_LIMITS.maxOperationCalls}.`,
        ),
      ],
    };
  const sourceHash = await digestValue({
    protocol: M9A_RETRIEVAL_CODEMODE_PROTOCOL,
    source,
  });
  if (!sourceHash.ok) return { ok: false, error: [sourceHash.error] };
  const semanticContractHash = await digestValue({
    protocol: M9A_RETRIEVAL_CODEMODE_PROTOCOL,
    sourceHash: sourceHash.value,
    catalog: "lachesis.m9a.retrieval-capabilities@1.1.0",
    resourceEnvelope: M9A_DEFAULT_RESOURCE_ENVELOPE,
    obligations: innerSummary.semanticObligations,
  });
  if (!semanticContractHash.ok)
    return { ok: false, error: [semanticContractHash.error] };
  const artifact: M9aRetrievalArtifact = Object.freeze({
    [artifactBrand]: "M9aRetrievalArtifact",
  });
  artifacts.set(
    artifact,
    Object.freeze({
      inner: inner.value,
      source,
      summary: Object.freeze({
        protocol: M9A_RETRIEVAL_CODEMODE_PROTOCOL,
        sourceHash: sourceHash.value,
        semanticContractHash: semanticContractHash.value,
        analysis: innerSummary.analysis,
      }),
    }),
  );
  return { ok: true, value: artifact };
}

export function inspectM9aRetrievalArtifact(
  artifact: M9aRetrievalArtifact,
): M9aRetrievalArtifactSummary | undefined {
  return artifacts.get(artifact)?.summary;
}

type MutableExecutionContext = {
  events: Array<M9aTranscriptEvent>;
  searches: Array<M9aSearchResult>;
  reads: Array<M9aReadResult>;
  visibleChunkIds: Set<string>;
  replayEntries: Array<M9aPrivateReplayEntry>;
  modelReservations: {
    inputTokens: number;
    outputTokens: number;
  };
  resources: {
    rootModelCalls: number;
    leafModelCalls: number;
    searchCalls: number;
    readCalls: number;
    returnedSearchResults: number;
    readBytes: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: 0;
  };
};

function emptyExecutionContext(): MutableExecutionContext {
  return {
    events: [],
    searches: [],
    reads: [],
    visibleChunkIds: new Set(),
    replayEntries: [],
    modelReservations: {
      inputTokens: 0,
      outputTokens: 0,
    },
    resources: {
      rootModelCalls: 0,
      leafModelCalls: 0,
      searchCalls: 0,
      readCalls: 0,
      returnedSearchResults: 0,
      readBytes: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
    },
  };
}

function admissionFailure(resource: string): Diagnostic {
  return diagnostic(
    "BUDGET_EXCEEDED",
    `M9a ${resource} reservation exceeds the execution envelope.`,
  );
}

function zeroModelUsage(): M9aModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    wallClockMs: 0,
    costUsdMicros: 0,
  };
}

function codeModeUsage(
  usage: M9aModelUsage,
): Readonly<{ tokens: number; wallClockMs: number }> {
  return {
    tokens: usage.inputTokens + usage.outputTokens,
    wallClockMs: usage.wallClockMs,
  };
}

function reserveModelUsage(
  context: MutableExecutionContext,
  reservation: M9aModelReservation,
): Result<void, Diagnostic> {
  if (
    context.resources.inputTokens +
      context.modelReservations.inputTokens +
      reservation.maxInputTokens >
      M9A_EXECUTION_LIMITS.maxInputTokens ||
    context.resources.outputTokens +
      context.modelReservations.outputTokens +
      reservation.maxOutputTokens >
      M9A_EXECUTION_LIMITS.maxOutputTokens
  )
    return { ok: false, error: admissionFailure("model token or cost") };
  context.modelReservations.inputTokens += reservation.maxInputTokens;
  context.modelReservations.outputTokens += reservation.maxOutputTokens;
  return { ok: true, value: undefined };
}

function reconcileModelUsage(
  context: MutableExecutionContext,
  reservation: M9aModelReservation,
  usage: M9aModelUsage,
): Result<void, Diagnostic> {
  context.modelReservations.inputTokens -= reservation.maxInputTokens;
  context.modelReservations.outputTokens -= reservation.maxOutputTokens;
  if (
    usage.inputTokens > reservation.maxInputTokens ||
    usage.outputTokens > reservation.maxOutputTokens ||
    usage.wallClockMs > reservation.maxWallClockMs
  )
    return { ok: false, error: admissionFailure("reported model usage") };
  context.resources.inputTokens += usage.inputTokens;
  context.resources.outputTokens += usage.outputTokens;
  return context.resources.inputTokens > M9A_EXECUTION_LIMITS.maxInputTokens ||
    context.resources.outputTokens > M9A_EXECUTION_LIMITS.maxOutputTokens
    ? { ok: false, error: admissionFailure("model token or cost") }
    : { ok: true, value: undefined };
}

function accountRecordedModelUsage(
  context: MutableExecutionContext,
  usage: M9aModelUsage,
): Result<void, Diagnostic> {
  context.resources.inputTokens += usage.inputTokens;
  context.resources.outputTokens += usage.outputTokens;
  return context.resources.inputTokens > M9A_EXECUTION_LIMITS.maxInputTokens ||
    context.resources.outputTokens > M9A_EXECUTION_LIMITS.maxOutputTokens
    ? { ok: false, error: admissionFailure("recorded model token or cost") }
    : { ok: true, value: undefined };
}

function retrievalDiagnostic(failure: M9aRetrievalFailure): Diagnostic {
  return diagnostic("MISSING_REPLAY_RESULT", `M9a: ${failure.message}`);
}

function invalidOutput(message: string): M9aRetrievalFailure {
  return m9aRetrievalFailureSchema.parse({
    kind: "invalid-input",
    message,
  });
}

async function appendEvent(
  context: MutableExecutionContext,
  input: Readonly<{
    category: M9aTranscriptEvent["category"];
    operation: string;
    effectName: string;
    input: unknown;
    output: unknown;
    evidenceChunkIds: ReadonlyArray<string>;
    itemCount: number;
    bytes: number;
    usage: M9aModelUsage;
  }>,
): Promise<Result<void, Diagnostic>> {
  const inputDigest = await digestValue(input.input);
  if (!inputDigest.ok) return inputDigest;
  const outputDigest = await digestValue(input.output);
  if (!outputDigest.ok) return outputDigest;
  context.events.push(
    m9aTranscriptEventSchema.parse({
      sequence: context.events.length,
      category: input.category,
      operation: input.operation,
      effectName: input.effectName,
      inputDigest: inputDigest.value,
      outputDigest: outputDigest.value,
      evidenceChunkIds: input.evidenceChunkIds,
      itemCount: input.itemCount,
      bytes: input.bytes,
      usage: input.usage,
    }),
  );
  return { ok: true, value: undefined };
}

async function recordEffect(
  context: MutableExecutionContext,
  input: Readonly<{
    category: M9aTranscriptEvent["category"];
    operation: string;
    effectName: string;
    input: unknown;
    output: unknown;
    evidenceChunkIds: ReadonlyArray<string>;
    itemCount: number;
    bytes: number;
    usage: M9aModelUsage;
    readResult: M9aReadResult | null;
  }>,
): Promise<Result<void, Diagnostic>> {
  const recorded = await appendEvent(context, input);
  if (!recorded.ok) return recorded;
  const parsedInput = strictJsonValueSchema.safeParse(input.input);
  const parsedOutput = strictJsonValueSchema.safeParse(input.output);
  const event = context.events.at(-1);
  if (!parsedInput.success || !parsedOutput.success || event === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        "M9a could not serialize a validated effect for private replay.",
      ),
    };
  context.replayEntries.push(
    m9aPrivateReplayEntrySchema.parse({
      sequence: context.replayEntries.length,
      operation: input.operation,
      effectName: input.effectName,
      input: parsedInput.data,
      output: parsedOutput.data,
      usage: input.usage,
      event,
      readResult: input.readResult,
    }),
  );
  return { ok: true, value: undefined };
}

function combinedSignal(
  runtimeSignal: AbortSignal,
  externalSignal: AbortSignal | undefined,
): Readonly<{ signal: AbortSignal; cleanup: () => void }> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (runtimeSignal.aborted || externalSignal?.aborted === true)
    controller.abort();
  else {
    runtimeSignal.addEventListener("abort", abort, { once: true });
    externalSignal?.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      runtimeSignal.removeEventListener("abort", abort);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}

function createEffectHandler(
  corpus: M9aCorpus,
  model: M9aOfflineModel,
  context: MutableExecutionContext,
  externalSignal: AbortSignal | undefined,
): CodeModeEffectHandler {
  return async (request) => {
    const operation = `${request.operation.id}@${request.operation.version}`;
    const combined = combinedSignal(request.signal, externalSignal);
    try {
      if (combined.signal.aborted)
        return {
          ok: false,
          error: retrievalDiagnostic({
            kind: "aborted",
            message: "M9a effect dispatch was cancelled.",
          }),
        };
      switch (request.effectName) {
        case "m9a.model.decompose": {
          if (
            context.resources.rootModelCalls + 1 >
            M9A_EXECUTION_LIMITS.maxRootModelCalls
          )
            return {
              ok: false,
              error: admissionFailure("root-model call"),
            };
          const task = taskValidator.safeParse(request.input);
          if (!task.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Decomposition input failed validation."),
              ),
            };
          const reserved = reserveModelUsage(
            context,
            M9A_MODEL_RESERVATIONS.root,
          );
          if (!reserved.ok) return reserved;
          context.resources.rootModelCalls += 1;
          const result = await model.decompose(
            task.data,
            combined.signal,
            M9A_MODEL_RESERVATIONS.root,
          );
          if (!result.ok)
            return { ok: false, error: retrievalDiagnostic(result.error) };
          const questions = questionsValidator.safeParse(result.value.value);
          const usage = m9aModelUsageSchema.safeParse(result.value.usage);
          if (!questions.success || !usage.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Decomposition output failed validation."),
              ),
            };
          const accounted = reconcileModelUsage(
            context,
            M9A_MODEL_RESERVATIONS.root,
            usage.data,
          );
          if (!accounted.ok) return accounted;
          const recorded = await recordEffect(context, {
            category: "root-model",
            operation,
            effectName: request.effectName,
            input: task.data,
            output: questions.data,
            evidenceChunkIds: [],
            itemCount: questions.data.length,
            bytes: 0,
            usage: usage.data,
            readResult: null,
          });
          if (!recorded.ok) return recorded;
          return {
            ok: true,
            value: { value: questions.data, usage: codeModeUsage(usage.data) },
          };
        }
        case "m9a.corpus.search": {
          if (
            context.resources.searchCalls + 1 >
              M9A_EXECUTION_LIMITS.maxSearchCalls ||
            context.resources.returnedSearchResults +
              M9A_CORPUS_LIMITS.maxSearchResults >
              M9A_EXECUTION_LIMITS.maxReturnedSearchResults
          )
            return {
              ok: false,
              error: admissionFailure("search-call"),
            };
          context.resources.searchCalls += 1;
          const question = questionValidator.safeParse(request.input);
          if (!question.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Search input failed validation."),
              ),
            };
          const result = searchM9aCorpus(
            corpus,
            {
              query: question.data,
              maxResults: M9A_CORPUS_LIMITS.maxSearchResults,
            },
            combined.signal,
          );
          if (!result.ok)
            return { ok: false, error: retrievalDiagnostic(result.error) };
          context.resources.returnedSearchResults += result.value.hits.length;
          context.searches.push(result.value);
          const chunkIds = result.value.hits.map((hit) => hit.chunk.id);
          const recorded = await recordEffect(context, {
            category: "search",
            operation,
            effectName: request.effectName,
            input: question.data,
            output: result.value,
            evidenceChunkIds: chunkIds,
            itemCount: result.value.hits.length,
            bytes: 0,
            usage: zeroModelUsage(),
            readResult: null,
          });
          if (!recorded.ok) return recorded;
          return {
            ok: true,
            value: {
              value: result.value,
              usage: { tokens: 0, wallClockMs: 0 },
            },
          };
        }
        case "m9a.corpus.read": {
          const search = m9aSearchResultSchema.safeParse(request.input);
          if (!search.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Read input failed validation."),
              ),
            };
          const availableBytes = Math.min(
            M9A_CORPUS_LIMITS.maxReadBytes,
            M9A_EXECUTION_LIMITS.maxTotalReadBytes -
              context.resources.readBytes,
          );
          const selectedChunks: Array<M9aChunkIdentity> = [];
          let reservedBytes = 0;
          for (const hit of search.data.hits) {
            const hitBytes = hit.chunk.endByte - hit.chunk.startByte;
            if (reservedBytes + hitBytes > availableBytes) continue;
            selectedChunks.push(hit.chunk);
            reservedBytes += hitBytes;
          }
          if (
            context.resources.readCalls + 1 >
            M9A_EXECUTION_LIMITS.maxReadCalls
          )
            return {
              ok: false,
              error: admissionFailure("read-call or byte"),
            };
          context.resources.readCalls += 1;
          context.resources.readBytes += reservedBytes;
          const result = readM9aCorpus(
            corpus,
            {
              chunks: selectedChunks,
              maxBytes: Math.max(reservedBytes, 1),
            },
            combined.signal,
          );
          if (!result.ok)
            return { ok: false, error: retrievalDiagnostic(result.error) };
          context.reads.push(result.value);
          for (const excerpt of result.value.excerpts)
            context.visibleChunkIds.add(excerpt.chunk.id);
          const evidence = evidenceSliceSchema.parse({
            question: search.data.query,
            excerpts: result.value.excerpts,
          });
          const chunkIds = result.value.excerpts.map(
            (excerpt) => excerpt.chunk.id,
          );
          const recorded = await recordEffect(context, {
            category: "read",
            operation,
            effectName: request.effectName,
            input: search.data,
            output: evidence,
            evidenceChunkIds: chunkIds,
            itemCount: result.value.excerpts.length,
            bytes: result.value.totalBytes,
            usage: zeroModelUsage(),
            readResult: result.value,
          });
          if (!recorded.ok) return recorded;
          return {
            ok: true,
            value: {
              value: evidence,
              usage: { tokens: 0, wallClockMs: 0 },
            },
          };
        }
        case "m9a.model.answer": {
          if (
            context.resources.leafModelCalls + 1 >
            M9A_EXECUTION_LIMITS.maxLeafModelCalls
          )
            return {
              ok: false,
              error: admissionFailure("leaf-model call"),
            };
          const evidence = evidenceSliceSchema.safeParse(request.input);
          if (!evidence.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Leaf-model input failed validation."),
              ),
            };
          const reserved = reserveModelUsage(
            context,
            M9A_MODEL_RESERVATIONS.leaf,
          );
          if (!reserved.ok) return reserved;
          context.resources.leafModelCalls += 1;
          const result = await model.answer(
            evidence.data,
            combined.signal,
            M9A_MODEL_RESERVATIONS.leaf,
          );
          if (!result.ok)
            return { ok: false, error: retrievalDiagnostic(result.error) };
          const partial = partialAnswerSchema.safeParse(result.value.value);
          const usage = m9aModelUsageSchema.safeParse(result.value.usage);
          if (!partial.success || !usage.success)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Leaf-model output failed validation."),
              ),
            };
          const accounted = reconcileModelUsage(
            context,
            M9A_MODEL_RESERVATIONS.leaf,
            usage.data,
          );
          if (!accounted.ok) return accounted;
          const assigned = new Set(
            evidence.data.excerpts.map((excerpt) => excerpt.chunk.id),
          );
          if (
            partial.data.citations.some(
              (citation) => !assigned.has(citation.id),
            )
          )
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput(
                  "Leaf-model citations must come from its assigned evidence slice.",
                ),
              ),
            };
          const chunkIds = partial.data.citations.map(
            (citation) => citation.id,
          );
          const recorded = await recordEffect(context, {
            category: "leaf-model",
            operation,
            effectName: request.effectName,
            input: evidence.data,
            output: partial.data,
            evidenceChunkIds: chunkIds,
            itemCount: chunkIds.length,
            bytes: 0,
            usage: usage.data,
            readResult: null,
          });
          if (!recorded.ok) return recorded;
          return {
            ok: true,
            value: { value: partial.data, usage: codeModeUsage(usage.data) },
          };
        }
        case "m9a.answer.submit": {
          const answer = m9aCitationConfinedAnswerSchema.safeParse(
            request.input,
          );
          if (!answer.success || answer.data.answer.trim().length === 0)
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput("Submitted answer failed validation."),
              ),
            };
          if (
            answer.data.citations.some(
              (citation) => !context.visibleChunkIds.has(citation.id),
            )
          )
            return {
              ok: false,
              error: retrievalDiagnostic(
                invalidOutput(
                  "Final citations must refer to chunks read during this execution.",
                ),
              ),
            };
          const chunkIds = answer.data.citations.map((citation) => citation.id);
          const recorded = await recordEffect(context, {
            category: "submission",
            operation,
            effectName: request.effectName,
            input: answer.data,
            output: answer.data,
            evidenceChunkIds: chunkIds,
            itemCount: chunkIds.length,
            bytes: 0,
            usage: zeroModelUsage(),
            readResult: null,
          });
          if (!recorded.ok) return recorded;
          return {
            ok: true,
            value: {
              value: answer.data,
              usage: { tokens: 0, wallClockMs: 0 },
            },
          };
        }
        default:
          return {
            ok: false,
            error: diagnostic(
              "UNDECLARED_EFFECT",
              `M9a has no handler for ${request.effectName}.`,
            ),
          };
      }
    } finally {
      combined.cleanup();
    }
  };
}

async function finalizeM9aRun(
  stored: StoredArtifact,
  snapshot: M9aCorpusSnapshot,
  task: string,
  model: M9aOfflineModel["identity"],
  context: MutableExecutionContext,
  executed: CodeModeExecutionResult,
): Promise<Result<M9aRetrievalRun, M9aRunFailure>> {
  const answer = m9aCitationConfinedAnswerSchema.safeParse(executed.output);
  if (!answer.success)
    return {
      ok: false,
      error: {
        kind: "invalid-output",
        failure: invalidOutput(
          "Program output is not a citation-confined answer.",
        ),
      },
    };
  const taskDigest = await digestValue(task);
  if (!taskDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: taskDigest.error },
    };
  const answerDigest = await digestValue(answer.data);
  if (!answerDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: answerDigest.error },
    };
  const transcript = m9aRunTranscriptSchema.parse({
    protocol: {
      id: M9A_RETRIEVAL_CODEMODE_PROTOCOL.id,
      version: M9A_RETRIEVAL_CODEMODE_PROTOCOL.version,
    },
    sourceHash: stored.summary.sourceHash,
    semanticContractHash: stored.summary.semanticContractHash,
    corpusSnapshotDigest: snapshot.snapshotDigest,
    taskDigest: taskDigest.value,
    model,
    operationDependencies: stored.summary.analysis.operationDependencies,
    effectDependencies: stored.summary.analysis.effectDependencies,
    events: context.events,
    runtimeUsage: executed.usage,
    retrievalUsage: context.resources,
    answerValidation: M9A_ANSWER_VALIDATION,
    answerDigest: answerDigest.value,
    citationChunkIds: answer.data.citations.map((citation) => citation.id),
  });
  const runDigest = await digestValue({
    protocol: M9A_RETRIEVAL_CODEMODE_PROTOCOL,
    transcript,
    answer: answer.data,
  });
  if (!runDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: runDigest.error },
    };
  return {
    ok: true,
    value: Object.freeze({
      runDigest: runDigest.value,
      answer: answer.data,
      answerValidation: M9A_ANSWER_VALIDATION,
      visibility: Object.freeze({
        searchResults: Object.freeze([...context.searches]),
        readResults: Object.freeze([...context.reads]),
      }),
      transcript,
      predictedUsage: executed.predictedUsage,
    }),
  };
}

type M9aLiveSession = Readonly<{
  context: MutableExecutionContext;
  run: M9aRetrievalRun;
  snapshot: M9aCorpusSnapshot;
  stored: StoredArtifact;
}>;

async function executeM9aLiveSession(
  artifact: M9aRetrievalArtifact,
  input: Readonly<{
    corpus: M9aCorpus;
    task: string;
    model: M9aOfflineModel;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9aLiveSession, M9aRunFailure>> {
  const stored = artifacts.get(artifact);
  if (stored === undefined)
    return { ok: false, error: { kind: "invalid-artifact" } };
  const snapshot = inspectM9aCorpus(input.corpus);
  if (snapshot === undefined)
    return { ok: false, error: { kind: "invalid-artifact" } };
  const context = emptyExecutionContext();
  const executed = await executeCodeMode(stored.inner, {
    inputs: new Map([["task", input.task]]),
    effectHandler: createEffectHandler(
      input.corpus,
      input.model,
      context,
      input.signal,
    ),
    timeoutMs: M9A_DEFAULT_RESOURCE_ENVELOPE.budget.maxWallClockMs,
  });
  if (!executed.ok)
    return {
      ok: false,
      error: { kind: "execution", failure: executed.error },
    };
  const run = await finalizeM9aRun(
    stored,
    snapshot,
    input.task,
    input.model.identity,
    context,
    executed.value,
  );
  if (!run.ok) return run;
  return {
    ok: true,
    value: Object.freeze({
      context,
      run: run.value,
      snapshot,
      stored,
    }),
  };
}

export async function executeM9aRetrievalProgram(
  artifact: M9aRetrievalArtifact,
  input: Readonly<{
    corpus: M9aCorpus;
    task: string;
    model: M9aOfflineModel;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9aRetrievalRun, M9aRunFailure>> {
  const session = await executeM9aLiveSession(artifact, input);
  return session.ok
    ? { ok: true, value: session.value.run }
    : { ok: false, error: session.error };
}

function replayMismatch(message: string): M9aRunFailure {
  return {
    kind: "replay-mismatch",
    diagnostic: diagnostic("REPLAY_REQUEST_MISMATCH", `M9a replay: ${message}`),
  };
}

function replayArtifactBody(
  artifact: M9aPrivateReplayArtifact,
): z.infer<typeof m9aPrivateReplayArtifactBodySchema> {
  return {
    protocol: artifact.protocol,
    retrievalProtocol: artifact.retrievalProtocol,
    source: artifact.source,
    sourceHash: artifact.sourceHash,
    semanticContractHash: artifact.semanticContractHash,
    task: artifact.task,
    corpus: artifact.corpus,
    model: artifact.model,
    entries: artifact.entries,
    expectedTranscriptDigest: artifact.expectedTranscriptDigest,
    expectedAnswerDigest: artifact.expectedAnswerDigest,
    expectedRunDigest: artifact.expectedRunDigest,
  };
}

export async function executeM9aRetrievalProgramWithReplay(
  artifact: M9aRetrievalArtifact,
  input: Readonly<{
    corpus: M9aCorpus;
    task: string;
    model: M9aOfflineModel;
    signal?: AbortSignal | undefined;
  }>,
): Promise<
  Result<
    Readonly<{
      run: M9aRetrievalRun;
      replayArtifact: M9aPrivateReplayArtifact;
    }>,
    M9aRunFailure
  >
> {
  const session = await executeM9aLiveSession(artifact, input);
  if (!session.ok) return session;
  const expectedTranscriptDigest = await digestValue(
    session.value.run.transcript,
  );
  if (!expectedTranscriptDigest.ok)
    return {
      ok: false,
      error: {
        kind: "digest-failure",
        diagnostic: expectedTranscriptDigest.error,
      },
    };
  const body = m9aPrivateReplayArtifactBodySchema.parse({
    protocol: {
      id: M9A_PRIVATE_REPLAY_PROTOCOL.id,
      version: M9A_PRIVATE_REPLAY_PROTOCOL.version,
    },
    retrievalProtocol: {
      id: M9A_RETRIEVAL_CODEMODE_PROTOCOL.id,
      version: M9A_RETRIEVAL_CODEMODE_PROTOCOL.version,
    },
    source: session.value.stored.source,
    sourceHash: session.value.stored.summary.sourceHash,
    semanticContractHash: session.value.stored.summary.semanticContractHash,
    task: input.task,
    corpus: session.value.snapshot,
    model: input.model.identity,
    entries: session.value.context.replayEntries,
    expectedTranscriptDigest: expectedTranscriptDigest.value,
    expectedAnswerDigest: session.value.run.transcript.answerDigest,
    expectedRunDigest: session.value.run.runDigest,
  });
  const artifactDigest = await digestValue(body);
  if (!artifactDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: artifactDigest.error },
    };
  return {
    ok: true,
    value: Object.freeze({
      run: session.value.run,
      replayArtifact: m9aPrivateReplayArtifactSchema.parse({
        ...body,
        artifactDigest: artifactDigest.value,
      }),
    }),
  };
}

function createReplayEffectHandler(
  entries: ReadonlyArray<M9aPrivateReplayEntry>,
  context: MutableExecutionContext,
  consumed: Readonly<{ next: () => number }>,
): CodeModeEffectHandler {
  return async (request) => {
    const index = consumed.next();
    const entry = entries.at(index);
    const operation = `${request.operation.id}@${request.operation.version}`;
    if (
      entry?.sequence !== index ||
      entry.operation !== operation ||
      entry.effectName !== request.effectName
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_REQUEST_MISMATCH",
          `M9a replay effect ${index} does not match its recording.`,
        ),
      };
    const inputDigest = await digestValue(request.input);
    const recordedInputDigest = await digestValue(entry.input);
    if (
      !inputDigest.ok ||
      !recordedInputDigest.ok ||
      inputDigest.value !== entry.event.inputDigest ||
      recordedInputDigest.value !== entry.event.inputDigest ||
      request.signal.aborted
    )
      return {
        ok: false,
        error:
          inputDigest.ok && request.signal.aborted
            ? diagnostic("BUDGET_EXCEEDED", "M9a replay was aborted.")
            : diagnostic(
                "REPLAY_REQUEST_MISMATCH",
                `M9a replay input ${index} does not match its recording.`,
              ),
      };
    if (entry.event.category === "search") {
      const search = m9aSearchResultSchema.safeParse(entry.output);
      if (!search.success)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            `M9a replay search output ${index} is invalid.`,
          ),
        };
      context.searches.push(search.data);
      context.resources.searchCalls += 1;
      context.resources.returnedSearchResults += search.data.hits.length;
    }
    if (entry.event.category === "read") {
      if (entry.readResult === null)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            `M9a replay read output ${index} lost its private evidence.`,
          ),
        };
      context.reads.push(entry.readResult);
      context.resources.readCalls += 1;
      context.resources.readBytes += entry.readResult.totalBytes;
      for (const excerpt of entry.readResult.excerpts)
        context.visibleChunkIds.add(excerpt.chunk.id);
    }
    if (entry.event.category === "root-model")
      context.resources.rootModelCalls += 1;
    if (entry.event.category === "leaf-model")
      context.resources.leafModelCalls += 1;
    if (
      entry.event.category === "root-model" ||
      entry.event.category === "leaf-model"
    ) {
      const accounted = accountRecordedModelUsage(context, entry.usage);
      if (!accounted.ok)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            `M9a replay model usage ${index} exceeds the recorded envelope.`,
          ),
        };
    }
    if (
      context.resources.rootModelCalls >
        M9A_EXECUTION_LIMITS.maxRootModelCalls ||
      context.resources.leafModelCalls >
        M9A_EXECUTION_LIMITS.maxLeafModelCalls ||
      context.resources.searchCalls > M9A_EXECUTION_LIMITS.maxSearchCalls ||
      context.resources.readCalls > M9A_EXECUTION_LIMITS.maxReadCalls ||
      context.resources.returnedSearchResults >
        M9A_EXECUTION_LIMITS.maxReturnedSearchResults ||
      context.resources.readBytes > M9A_EXECUTION_LIMITS.maxTotalReadBytes
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          `M9a replay resource usage ${index} exceeds the recorded envelope.`,
        ),
      };
    const recorded = await appendEvent(context, {
      category: entry.event.category,
      operation,
      effectName: request.effectName,
      input: request.input,
      output: entry.output,
      evidenceChunkIds: entry.event.evidenceChunkIds,
      itemCount: entry.event.itemCount,
      bytes: entry.event.bytes,
      usage: entry.usage,
    });
    if (!recorded.ok) return recorded;
    const rebuilt = context.events.at(-1);
    const rebuiltDigest = await digestValue(rebuilt);
    const recordedDigest = await digestValue(entry.event);
    if (
      rebuilt === undefined ||
      !rebuiltDigest.ok ||
      !recordedDigest.ok ||
      rebuiltDigest.value !== recordedDigest.value
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          `M9a replay event ${index} does not reconstruct exactly.`,
        ),
      };
    context.replayEntries.push(entry);
    return {
      ok: true,
      value: { value: entry.output, usage: codeModeUsage(entry.usage) },
    };
  };
}

export async function replayM9aRetrievalProgram(
  artifactInput: unknown,
): Promise<Result<M9aRetrievalRun, M9aRunFailure>> {
  const artifact = m9aPrivateReplayArtifactSchema.safeParse(artifactInput);
  if (!artifact.success)
    return {
      ok: false,
      error: replayMismatch("artifact shape is invalid"),
    };
  const artifactDigest = await digestValue(replayArtifactBody(artifact.data));
  if (!artifactDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: artifactDigest.error },
    };
  if (artifactDigest.value !== artifact.data.artifactDigest)
    return {
      ok: false,
      error: replayMismatch("artifact digest does not match"),
    };
  const compiled = await compileM9aRetrievalProgram(artifact.data.source);
  if (!compiled.ok)
    return {
      ok: false,
      error: replayMismatch("recorded program no longer compiles"),
    };
  const stored = artifacts.get(compiled.value);
  if (
    stored?.summary.sourceHash !== artifact.data.sourceHash ||
    stored.summary.semanticContractHash !== artifact.data.semanticContractHash
  )
    return {
      ok: false,
      error: replayMismatch("program or semantic-contract identity changed"),
    };
  const context = emptyExecutionContext();
  let nextIndex = 0;
  const executed = await executeCodeMode(stored.inner, {
    inputs: new Map([["task", artifact.data.task]]),
    effectHandler: createReplayEffectHandler(artifact.data.entries, context, {
      next: () => {
        const current = nextIndex;
        nextIndex += 1;
        return current;
      },
    }),
    timeoutMs: M9A_DEFAULT_RESOURCE_ENVELOPE.budget.maxWallClockMs,
  });
  if (!executed.ok)
    return {
      ok: false,
      error: { kind: "execution", failure: executed.error },
    };
  if (nextIndex !== artifact.data.entries.length)
    return {
      ok: false,
      error: replayMismatch("recorded effects were not consumed exactly"),
    };
  const run = await finalizeM9aRun(
    stored,
    artifact.data.corpus,
    artifact.data.task,
    artifact.data.model,
    context,
    executed.value,
  );
  if (!run.ok) return run;
  const transcriptDigest = await digestValue(run.value.transcript);
  if (!transcriptDigest.ok)
    return {
      ok: false,
      error: { kind: "digest-failure", diagnostic: transcriptDigest.error },
    };
  if (
    transcriptDigest.value !== artifact.data.expectedTranscriptDigest ||
    run.value.transcript.answerDigest !== artifact.data.expectedAnswerDigest ||
    run.value.runDigest !== artifact.data.expectedRunDigest
  )
    return {
      ok: false,
      error: replayMismatch("reconstructed result identity does not match"),
    };
  return run;
}

export function inspectM9aRetrievalTranscript(
  run: M9aRetrievalRun,
): M9aRunTranscript {
  return run.transcript;
}

export type M9aComparisonArm = Readonly<{
  kind: "sequenced-retrieval" | "one-shot-rag";
  run: M9aRetrievalRun;
}>;

export type M9aComparisonArmKind = M9aComparisonArm["kind"];
export type M9aComparisonExecutionOrder = "sequenced-first" | "one-shot-first";
export type M9aModelSessionFactories = Readonly<{
  sequencedRetrieval: () => M9aOfflineModel;
  oneShotRag: () => M9aOfflineModel;
}>;

export type M9aOfflineComparison = Readonly<{
  protocol: typeof M9A_RETRIEVAL_CODEMODE_PROTOCOL;
  corpus: M9aCorpusSnapshot;
  resourceEnvelope: CompilationPolicy;
  executionOrder: Readonly<[M9aComparisonArmKind, M9aComparisonArmKind]>;
  sequenced: M9aComparisonArm;
  oneShot: M9aComparisonArm;
  claimBoundary: typeof M9A_RETRIEVAL_CODEMODE_PROTOCOL.claimBoundary;
}>;

export async function runM9aOfflineComparison(
  input: Readonly<{
    source: string;
    corpus: M9aCorpus;
    task: string;
    modelSessionFactories: M9aModelSessionFactories;
    executionOrder: M9aComparisonExecutionOrder;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9aOfflineComparison, M9aCompileFailure | M9aRunFailure>> {
  const [sequencedArtifact, oneShotArtifact] = await Promise.all([
    compileM9aRetrievalProgram(input.source),
    compileM9aRetrievalProgram(M9A_ONE_SHOT_RAG_SOURCE),
  ]);
  if (!sequencedArtifact.ok)
    return {
      ok: false,
      error: { kind: "compile", diagnostics: sequencedArtifact.error },
    };
  if (!oneShotArtifact.ok)
    return {
      ok: false,
      error: { kind: "compile", diagnostics: oneShotArtifact.error },
    };
  if (
    input.modelSessionFactories.sequencedRetrieval ===
    input.modelSessionFactories.oneShotRag
  )
    return {
      ok: false,
      error: {
        kind: "invalid-comparison",
        diagnostic: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "M9a comparison arms require distinct model-session factories.",
        ),
      },
    };
  const executionOrder: Readonly<[M9aComparisonArmKind, M9aComparisonArmKind]> =
    input.executionOrder === "sequenced-first"
      ? ["sequenced-retrieval", "one-shot-rag"]
      : ["one-shot-rag", "sequenced-retrieval"];
  const firstModel =
    executionOrder[0] === "sequenced-retrieval"
      ? input.modelSessionFactories.sequencedRetrieval()
      : input.modelSessionFactories.oneShotRag();
  const secondModel =
    executionOrder[1] === "sequenced-retrieval"
      ? input.modelSessionFactories.sequencedRetrieval()
      : input.modelSessionFactories.oneShotRag();
  const sequencedModel =
    executionOrder[0] === "sequenced-retrieval" ? firstModel : secondModel;
  const oneShotModel =
    executionOrder[0] === "one-shot-rag" ? firstModel : secondModel;
  if (
    sequencedModel === oneShotModel ||
    sequencedModel.identity.id !== oneShotModel.identity.id ||
    sequencedModel.identity.version !== oneShotModel.identity.version
  )
    return {
      ok: false,
      error: {
        kind: "invalid-comparison",
        diagnostic: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "M9a comparison arms require separate sessions with the same model identity.",
        ),
      },
    };
  let sequencedRun: M9aRetrievalRun | undefined;
  let oneShotRun: M9aRetrievalRun | undefined;
  for (const arm of executionOrder) {
    const executed = await executeM9aRetrievalProgram(
      arm === "sequenced-retrieval"
        ? sequencedArtifact.value
        : oneShotArtifact.value,
      {
        corpus: input.corpus,
        task: input.task,
        model: arm === "sequenced-retrieval" ? sequencedModel : oneShotModel,
        signal: input.signal,
      },
    );
    if (!executed.ok) return executed;
    if (arm === "sequenced-retrieval") sequencedRun = executed.value;
    else oneShotRun = executed.value;
  }
  if (sequencedRun === undefined || oneShotRun === undefined)
    return {
      ok: false,
      error: {
        kind: "invalid-comparison",
        diagnostic: diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "M9a comparison order did not execute both arms.",
        ),
      },
    };
  const corpus = inspectM9aCorpus(input.corpus);
  if (corpus === undefined)
    return { ok: false, error: { kind: "invalid-artifact" } };
  return {
    ok: true,
    value: Object.freeze({
      protocol: M9A_RETRIEVAL_CODEMODE_PROTOCOL,
      corpus,
      resourceEnvelope: M9A_DEFAULT_RESOURCE_ENVELOPE,
      executionOrder,
      sequenced: Object.freeze({
        kind: "sequenced-retrieval",
        run: sequencedRun,
      }),
      oneShot: Object.freeze({
        kind: "one-shot-rag",
        run: oneShotRun,
      }),
      claimBoundary: M9A_RETRIEVAL_CODEMODE_PROTOCOL.claimBoundary,
    }),
  };
}

export function summarizeM9aUsage(run: M9aRetrievalRun): CodeModeRuntimeUsage {
  return run.transcript.runtimeUsage;
}
