import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  createM9aCorpus,
  inspectM9aCorpus,
  type M9aChunkIdentity,
  m9aChunkIdentitySchema,
  m9aCorpusInputSchema,
  m9aInternalInspectChunkIdentities,
  type M9aRetrievalFailure,
} from "./m9a-corpus.js";
import {
  type M9aCitationConfinedAnswer,
  m9aCitationConfinedAnswerSchema,
} from "./m9a-retrieval.js";
import {
  type M9b1Arm,
  type M9b1ArmRecord,
  type M9b1ExternalEvaluator,
  m9b1InternalInspectVerifiedTerminalRecord,
  type M9b1VerifiedTerminalRecord,
} from "./m9b1-discovery.js";
import { strictJsonValueSchema } from "./strict-json.js";

export const M9B2_MEASUREMENT_PROTOCOL = Object.freeze({
  id: "lachesis-m9b2-offline-scientific-measurement",
  version: "1.1.0",
  visibility: "internal-offline-development-only" as const,
  claimBoundary:
    "offline fixture, evaluator, and prospective-power validation only; no model-quality, retrieval-superiority, generalization, live-provider, or production-readiness claim",
});

export const M9B2_EVALUATOR_IDENTITY = Object.freeze({
  id: "lachesis.m9b2.offline-arm-blind-evaluator",
  version: "1.1.0-development",
});

export const M9B2_PERSISTENCE_PROTOCOL = Object.freeze({
  record: "lachesis-m9b2a-terminal-measurement-record/1",
  store: "lachesis-m9b2a-atomic-measurement-store/1",
});

export const M9B2_PRIMARY_ENDPOINT =
  "first-attempt-semantically-supported-end-to-end-success" as const;

export const M9B2_TASK_FAMILIES = [
  "lookup",
  "join",
  "multi-hop",
  "temporal-retraction",
  "contradiction",
  "aggregation",
  "insufficient-evidence",
  "prompt-injection",
] as const;

export const M9B2_CORPUS_SCALES = ["1x", "8x", "32x"] as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const taskSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((task) => task.normalize("NFC") === task)
  .refine((task) => new TextEncoder().encode(task).byteLength <= 512);

export const m9b2TaskFamilySchema = z.enum(M9B2_TASK_FAMILIES);
export type M9b2TaskFamily = z.infer<typeof m9b2TaskFamilySchema>;
export const m9b2CorpusScaleSchema = z.enum(M9B2_CORPUS_SCALES);
export type M9b2CorpusScale = z.infer<typeof m9b2CorpusScaleSchema>;

export const m9b2PublicDevelopmentCaseSchema = z
  .strictObject({
    id: identifierSchema,
    split: z.literal("development"),
    family: m9b2TaskFamilySchema,
    scale: m9b2CorpusScaleSchema,
    strategyId: identifierSchema,
    task: taskSchema,
    corpus: m9aCorpusInputSchema,
  })
  .readonly();
export type M9b2PublicDevelopmentCase = z.infer<
  typeof m9b2PublicDevelopmentCaseSchema
>;

const documentIdSetSchema = identifierSchema.array().max(16).readonly();
const requiredEvidenceSetSchema = identifierSchema
  .array()
  .min(1)
  .max(8)
  .readonly();

export const m9b2HiddenExpectationSchema = z
  .strictObject({
    caseId: identifierSchema,
    responseKind: z.enum(["answer", "abstain"]),
    acceptedAnswers: z
      .string()
      .min(1)
      .max(512)
      .array()
      .min(1)
      .max(8)
      .readonly(),
    supportingFacts: z
      .strictObject({
        id: identifierSchema,
        documentId: identifierSchema,
        exactText: z.string().min(1).max(2_048),
      })
      .readonly()
      .array()
      .max(16)
      .readonly(),
    requiredSupportingFactSets: requiredEvidenceSetSchema
      .array()
      .max(4)
      .readonly(),
    allowedSupportingFactIds: documentIdSetSchema,
    entityLineageIds: identifierSchema.array().max(16).readonly(),
    normalizedTaskTemplate: z.string().min(1).max(2_048),
  })
  .superRefine((expectation, context) => {
    if (
      expectation.responseKind === "answer" &&
      expectation.requiredSupportingFactSets.length === 0
    )
      context.addIssue({
        code: "custom",
        message: "Answer expectations require supporting evidence.",
      });
    if (
      expectation.responseKind === "abstain" &&
      (expectation.requiredSupportingFactSets.length > 0 ||
        expectation.allowedSupportingFactIds.length > 0 ||
        expectation.supportingFacts.length > 0)
    )
      context.addIssue({
        code: "custom",
        message: "Abstention expectations cannot require supporting evidence.",
      });
  })
  .readonly();
export type M9b2HiddenExpectation = z.infer<typeof m9b2HiddenExpectationSchema>;

export const m9b2SplitIdentitySchema = z
  .strictObject({
    fixtureIdentity: digestSchema,
    entityIdentities: digestSchema.array().max(16).readonly(),
    exactTaskTemplateIdentity: digestSchema,
    normalizedTaskTemplateIdentity: digestSchema,
    exactRelevantFactWordingIdentities: digestSchema.array().max(16).readonly(),
    answerValueIdentities: digestSchema.array().max(8).readonly(),
    corpusContentIdentity: digestSchema,
    documentContentIdentities: digestSchema.array().min(1).max(64).readonly(),
    semanticContractIdentity: digestSchema,
    taskFamily: m9b2TaskFamilySchema,
    solutionStrategyClass: identifierSchema,
  })
  .readonly();
export type M9b2SplitIdentity = z.infer<typeof m9b2SplitIdentitySchema>;

const evaluatorFailureReasonSchema = z.enum([
  "answer-mismatch",
  "abstention-mismatch",
  "missing-required-evidence",
  "unsupported-citation",
  "invalid-citation",
]);

export const m9b2EvaluationScoreSchema = z
  .strictObject({
    protocol: z.literal(M9B2_MEASUREMENT_PROTOCOL.id),
    evaluatorVersion: z.literal(M9B2_EVALUATOR_IDENTITY.version),
    caseId: identifierSchema,
    family: m9b2TaskFamilySchema,
    scale: m9b2CorpusScaleSchema,
    expectedResponseKind: z.enum(["answer", "abstain"]),
    observedAbstention: z.boolean(),
    responseCorrect: z.boolean(),
    abstentionCorrect: z.boolean(),
    requiredEvidenceRecallBasisPoints: z.number().int().min(0).max(10_000),
    supportingEvidencePrecisionBasisPoints: z.number().int().min(0).max(10_000),
    citationValidityBasisPoints: z.number().int().min(0).max(10_000),
    semanticSupported: z.boolean(),
    failureReasons: evaluatorFailureReasonSchema.array().readonly(),
  })
  .readonly();
export type M9b2EvaluationScore = z.infer<typeof m9b2EvaluationScoreSchema>;

const preparedSuiteBrand: unique symbol = Symbol("M9b2PreparedSuite");
export type M9b2PreparedSuite = Readonly<{
  [preparedSuiteBrand]: "M9b2PreparedSuite";
}>;

type PreparedCase = Readonly<{
  publicCase: M9b2PublicDevelopmentCase;
  expectation: M9b2HiddenExpectation;
  splitIdentity: M9b2SplitIdentity;
  snapshotDigest: string;
  chunksById: ReadonlyMap<string, M9aChunkIdentity>;
  supportingFactsById: ReadonlyMap<string, M9b2SupportingFactIdentity>;
}>;

export const m9b2SupportingFactIdentitySchema = z
  .strictObject({
    factId: identifierSchema,
    snapshotDigest: digestSchema,
    documentId: identifierSchema,
    chunk: m9aChunkIdentitySchema,
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().positive(),
    exactTextDigest: digestSchema,
  })
  .refine((fact) => fact.endByte > fact.startByte)
  .readonly();
export type M9b2SupportingFactIdentity = z.infer<
  typeof m9b2SupportingFactIdentitySchema
>;

type StoredSuite = Readonly<{
  suiteDigest: string;
  cases: ReadonlyMap<string, PreparedCase>;
}>;

const suites = new WeakMap<M9b2PreparedSuite, StoredSuite>();

function invalid(message: string): Result<never, Diagnostic> {
  return { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", message) };
}

function retrievalFailure(
  kind: M9aRetrievalFailure["kind"],
  message: string,
): M9aRetrievalFailure {
  return { kind, message };
}

function normalizedAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[.!?]+$/u, "");
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

function unique(items: ReadonlyArray<unknown>): boolean {
  return new Set(items).size === items.length;
}

function basisPoints(numerator: number, denominator: number): number {
  return denominator === 0
    ? 10_000
    : Math.round((numerator * 10_000) / denominator);
}

function scaleRank(scale: M9b2CorpusScale): number {
  switch (scale) {
    case "1x":
      return 1;
    case "8x":
      return 8;
    case "32x":
      return 32;
  }
}

function exactChunkIdentity(
  left: M9aChunkIdentity,
  right: M9aChunkIdentity,
): boolean {
  return canonicalEqual(left, right);
}

function validateTaxonomy(
  cases: ReadonlyArray<M9b2PublicDevelopmentCase>,
  expectations: ReadonlyArray<M9b2HiddenExpectation>,
): Result<true, Diagnostic> {
  if (cases.length !== M9B2_TASK_FAMILIES.length * M9B2_CORPUS_SCALES.length)
    return invalid(
      "M9b.2 development fixtures require every family-scale cell.",
    );
  if (!unique(cases.map((item) => item.id)))
    return invalid("M9b.2 development case identities must be unique.");
  if (!unique(cases.map((item) => item.corpus.id)))
    return invalid("M9b.2 development corpus identities must be unique.");
  if (
    expectations.length !== cases.length ||
    !unique(expectations.map((item) => item.caseId))
  )
    return invalid(
      "M9b.2 hidden expectations require one unique entry per case.",
    );

  const expectationsByCase = new Map(
    expectations.map((expectation) => [expectation.caseId, expectation]),
  );
  for (const family of M9B2_TASK_FAMILIES) {
    const familyCases = cases
      .filter((item) => item.family === family)
      .toSorted(
        (left, right) => scaleRank(left.scale) - scaleRank(right.scale),
      );
    if (
      familyCases.length !== M9B2_CORPUS_SCALES.length ||
      familyCases.some(
        (item, index) => item.scale !== M9B2_CORPUS_SCALES[index],
      )
    )
      return invalid(
        `M9b.2 family ${family} does not contain 1x, 8x, and 32x.`,
      );
    const first = familyCases[0];
    if (first === undefined) return invalid("M9b.2 family fixture is missing.");
    if (
      familyCases.some(
        (item) =>
          item.strategyId !== first.strategyId || item.task !== first.task,
      )
    )
      return invalid(
        `M9b.2 family ${family} changes its task or solution strategy across scale.`,
      );
    const firstExpectation = expectationsByCase.get(first.id);
    if (firstExpectation === undefined)
      return invalid("M9b.2 hidden expectation is missing.");
    const expectationBody = {
      responseKind: firstExpectation.responseKind,
      acceptedAnswers: firstExpectation.acceptedAnswers,
      supportingFacts: firstExpectation.supportingFacts,
      requiredSupportingFactSets: firstExpectation.requiredSupportingFactSets,
      allowedSupportingFactIds: firstExpectation.allowedSupportingFactIds,
      entityLineageIds: firstExpectation.entityLineageIds,
      normalizedTaskTemplate: firstExpectation.normalizedTaskTemplate,
    };
    for (const item of familyCases) {
      const expectation = expectationsByCase.get(item.id);
      if (
        expectation === undefined ||
        !canonicalEqual(expectationBody, {
          responseKind: expectation.responseKind,
          acceptedAnswers: expectation.acceptedAnswers,
          supportingFacts: expectation.supportingFacts,
          requiredSupportingFactSets: expectation.requiredSupportingFactSets,
          allowedSupportingFactIds: expectation.allowedSupportingFactIds,
          entityLineageIds: expectation.entityLineageIds,
          normalizedTaskTemplate: expectation.normalizedTaskTemplate,
        })
      )
        return invalid(
          `M9b.2 family ${family} changes its semantic contract across scale.`,
        );
    }
  }
  return { ok: true, value: true };
}

/** Prepares development fixtures only; it does not freeze a final held-out corpus. */
export async function prepareM9b2DevelopmentSuite(
  input: Readonly<{
    publicCases: ReadonlyArray<unknown>;
    hiddenExpectations: ReadonlyArray<unknown>;
  }>,
): Promise<Result<M9b2PreparedSuite, Diagnostic>> {
  const cases = m9b2PublicDevelopmentCaseSchema
    .array()
    .readonly()
    .safeParse(input.publicCases);
  const expectations = m9b2HiddenExpectationSchema
    .array()
    .readonly()
    .safeParse(input.hiddenExpectations);
  if (!cases.success || !expectations.success)
    return invalid("M9b.2 development fixtures are invalid.");
  const taxonomy = validateTaxonomy(cases.data, expectations.data);
  if (!taxonomy.ok) return taxonomy;
  const expectationsByCase = new Map(
    expectations.data.map((expectation) => [expectation.caseId, expectation]),
  );
  const preparedCases: Array<readonly [string, PreparedCase]> = [];
  for (const publicCase of cases.data) {
    const expectation = expectationsByCase.get(publicCase.id);
    if (expectation === undefined)
      return invalid("M9b.2 hidden expectation is missing.");
    const documentsById = new Map(
      publicCase.corpus.documents.map((document) => [document.id, document]),
    );
    const supportingFactIds = expectation.supportingFacts.map(
      (fact) => fact.id,
    );
    const referencedFactIds = [
      ...expectation.allowedSupportingFactIds,
      ...expectation.requiredSupportingFactSets.flat(),
    ];
    const evidenceSetIdentities = expectation.requiredSupportingFactSets.map(
      (set) => [...set].toSorted().join("\u0000"),
    );
    if (
      !unique(expectation.acceptedAnswers.map(normalizedAnswer)) ||
      !unique(supportingFactIds) ||
      !unique(expectation.allowedSupportingFactIds) ||
      !unique(expectation.entityLineageIds) ||
      !unique(evidenceSetIdentities) ||
      expectation.requiredSupportingFactSets.some((set) => !unique(set)) ||
      expectation.supportingFacts.some(
        (fact) => !documentsById.has(fact.documentId),
      ) ||
      referencedFactIds.some((id) => !supportingFactIds.includes(id)) ||
      expectation.requiredSupportingFactSets.some((set) =>
        set.some((id) => !expectation.allowedSupportingFactIds.includes(id)),
      )
    )
      return invalid(
        `M9b.2 expectation ${expectation.caseId} references invalid evidence.`,
      );
    const corpus = await createM9aCorpus(publicCase.corpus);
    if (!corpus.ok)
      return invalid(`M9b.2 corpus ${publicCase.corpus.id} is invalid.`);
    const snapshot = inspectM9aCorpus(corpus.value);
    const chunks = m9aInternalInspectChunkIdentities(corpus.value);
    if (snapshot === undefined || chunks === undefined)
      return invalid("M9b.2 lost a prepared corpus identity.");
    const supportingFacts: Array<
      readonly [string, M9b2SupportingFactIdentity]
    > = [];
    for (const fact of expectation.supportingFacts) {
      const document = documentsById.get(fact.documentId);
      if (document === undefined)
        return invalid("M9b.2 supporting fact document is missing.");
      const characterStart = document.text.indexOf(fact.exactText);
      if (
        characterStart < 0 ||
        document.text.includes(fact.exactText, characterStart + 1)
      )
        return invalid(
          `M9b.2 supporting fact ${fact.id} must occur exactly once.`,
        );
      const startByte = new TextEncoder().encode(
        document.text.slice(0, characterStart),
      ).byteLength;
      const endByte =
        startByte + new TextEncoder().encode(fact.exactText).byteLength;
      const chunk = chunks.find(
        (candidate) =>
          candidate.document.documentId === fact.documentId &&
          candidate.startByte <= startByte &&
          candidate.endByte >= endByte,
      );
      const exactTextDigest = await digestValue(fact.exactText);
      if (chunk === undefined || !exactTextDigest.ok)
        return invalid(
          `M9b.2 supporting fact ${fact.id} must fit one exact snapshot chunk.`,
        );
      supportingFacts.push([
        fact.id,
        m9b2SupportingFactIdentitySchema.parse({
          factId: fact.id,
          snapshotDigest: snapshot.snapshotDigest,
          documentId: fact.documentId,
          chunk,
          startByte,
          endByte,
          exactTextDigest: exactTextDigest.value,
        }),
      ]);
    }
    const fixtureIdentity = await digestValue({
      id: publicCase.id,
      split: publicCase.split,
      family: publicCase.family,
      scale: publicCase.scale,
      strategyId: publicCase.strategyId,
    });
    const exactTaskTemplateIdentity = await digestValue(publicCase.task);
    const normalizedTaskTemplateIdentity = await digestValue(
      normalizedAnswer(expectation.normalizedTaskTemplate),
    );
    const entityIdentityResults = await Promise.all(
      expectation.entityLineageIds.map((value) => digestValue(value)),
    );
    const factWordingIdentityResults = await Promise.all(
      expectation.supportingFacts.map((fact) => digestValue(fact.exactText)),
    );
    const answerValueIdentityResults = await Promise.all(
      expectation.acceptedAnswers.map((answer) =>
        digestValue(normalizedAnswer(answer)),
      ),
    );
    const documentContentResults = await Promise.all(
      publicCase.corpus.documents.map((document) =>
        digestValue({ title: document.title, text: document.text }),
      ),
    );
    if (documentContentResults.some((result) => !result.ok))
      return invalid("M9b.2 document-content identity could not be derived.");
    const documentContentIdentities: Array<string> = [];
    for (const result of documentContentResults)
      if (result.ok) documentContentIdentities.push(result.value);
    const sortedDocumentContentIdentities =
      documentContentIdentities.toSorted();
    const corpusContentIdentity = await digestValue(
      sortedDocumentContentIdentities,
    );
    const semanticContractIdentity = await digestValue({
      responseKind: expectation.responseKind,
      acceptedAnswers: expectation.acceptedAnswers.map(normalizedAnswer),
      supportingFacts: supportingFacts.map((entry) => entry[1]),
      requiredSupportingFactSets: expectation.requiredSupportingFactSets,
      allowedSupportingFactIds: expectation.allowedSupportingFactIds,
    });
    if (
      !fixtureIdentity.ok ||
      !exactTaskTemplateIdentity.ok ||
      !normalizedTaskTemplateIdentity.ok ||
      entityIdentityResults.some((result) => !result.ok) ||
      factWordingIdentityResults.some((result) => !result.ok) ||
      answerValueIdentityResults.some((result) => !result.ok) ||
      !corpusContentIdentity.ok ||
      !semanticContractIdentity.ok
    )
      return invalid("M9b.2 development split identity could not be derived.");
    preparedCases.push([
      publicCase.id,
      Object.freeze({
        publicCase,
        expectation,
        splitIdentity: m9b2SplitIdentitySchema.parse({
          fixtureIdentity: fixtureIdentity.value,
          entityIdentities: entityIdentityResults.flatMap((result) =>
            result.ok ? [result.value] : [],
          ),
          exactTaskTemplateIdentity: exactTaskTemplateIdentity.value,
          normalizedTaskTemplateIdentity: normalizedTaskTemplateIdentity.value,
          exactRelevantFactWordingIdentities:
            factWordingIdentityResults.flatMap((result) =>
              result.ok ? [result.value] : [],
            ),
          answerValueIdentities: answerValueIdentityResults.flatMap((result) =>
            result.ok ? [result.value] : [],
          ),
          corpusContentIdentity: corpusContentIdentity.value,
          documentContentIdentities: sortedDocumentContentIdentities,
          semanticContractIdentity: semanticContractIdentity.value,
          taskFamily: publicCase.family,
          solutionStrategyClass: publicCase.strategyId,
        }),
        snapshotDigest: snapshot.snapshotDigest,
        chunksById: new Map(chunks.map((chunk) => [chunk.id, chunk])),
        supportingFactsById: new Map(supportingFacts),
      }),
    ]);
  }
  const suiteDigest = await digestValue({
    protocol: M9B2_MEASUREMENT_PROTOCOL,
    fixtureStatus: "development-only-not-final-corpus",
    publicCases: cases.data,
    hiddenExpectations: expectations.data,
  });
  if (!suiteDigest.ok) return suiteDigest;
  const token: M9b2PreparedSuite = Object.freeze({
    [preparedSuiteBrand]: "M9b2PreparedSuite",
  });
  suites.set(
    token,
    Object.freeze({
      suiteDigest: suiteDigest.value,
      cases: new Map(preparedCases),
    }),
  );
  return { ok: true, value: token };
}

export type M9b2PreparedCaseInspection = Readonly<{
  suiteDigest: string;
  publicCase: M9b2PublicDevelopmentCase;
  splitIdentity: M9b2SplitIdentity;
  snapshotDigest: string;
  chunks: ReadonlyArray<M9aChunkIdentity>;
}>;

/** @internal Test and offline-analysis inspection; it exposes no hidden gold. */
export function inspectM9b2PreparedCase(
  suite: M9b2PreparedSuite,
  caseId: string,
): M9b2PreparedCaseInspection | undefined {
  const stored = suites.get(suite);
  const prepared = stored?.cases.get(caseId);
  return stored === undefined || prepared === undefined
    ? undefined
    : Object.freeze({
        suiteDigest: stored.suiteDigest,
        publicCase: prepared.publicCase,
        splitIdentity: prepared.splitIdentity,
        snapshotDigest: prepared.snapshotDigest,
        chunks: Object.freeze([...prepared.chunksById.values()]),
      });
}

/** @internal Hidden-gold inspection used only by deterministic offline tests. */
export function m9b2InternalInspectSupportingFacts(
  suite: M9b2PreparedSuite,
  caseId: string,
): ReadonlyArray<M9b2SupportingFactIdentity> | undefined {
  const prepared = suites.get(suite)?.cases.get(caseId);
  return prepared === undefined
    ? undefined
    : Object.freeze([...prepared.supportingFactsById.values()]);
}

function scoreEvidence(
  prepared: PreparedCase,
  citedChunkIds: ReadonlySet<string>,
): Readonly<{ recall: number; precision: number }> {
  const citedFactIds = new Set(
    [...prepared.supportingFactsById.values()]
      .filter((fact) => citedChunkIds.has(fact.chunk.id))
      .map((fact) => fact.factId),
  );
  const recall =
    prepared.expectation.requiredSupportingFactSets.length === 0
      ? 10_000
      : Math.max(
          ...prepared.expectation.requiredSupportingFactSets.map((set) =>
            basisPoints(
              set.filter((factId) => citedFactIds.has(factId)).length,
              set.length,
            ),
          ),
        );
  const precision =
    citedChunkIds.size === 0
      ? prepared.expectation.responseKind === "abstain"
        ? 10_000
        : 0
      : basisPoints(
          [...citedChunkIds].filter((chunkId) =>
            prepared.expectation.allowedSupportingFactIds.some(
              (factId) =>
                prepared.supportingFactsById.get(factId)?.chunk.id === chunkId,
            ),
          ).length,
          citedChunkIds.size,
        );
  return { recall, precision };
}

function evaluatePreparedCase(
  prepared: PreparedCase,
  answer: M9aCitationConfinedAnswer,
): M9b2EvaluationScore {
  const normalized = normalizedAnswer(answer.answer);
  const accepted = prepared.expectation.acceptedAnswers.map(normalizedAnswer);
  const abstentions = [
    "insufficient evidence",
    "the available evidence is insufficient",
    "cannot determine from the available evidence",
  ];
  const observedAbstention = abstentions.includes(normalized);
  const responseCorrect = accepted.includes(normalized);
  const validCitations = answer.citations.filter((citation) => {
    const expected = prepared.chunksById.get(citation.id);
    return expected !== undefined && exactChunkIdentity(citation, expected);
  });
  const uniqueValidIds = new Set(validCitations.map((citation) => citation.id));
  const citationValidity =
    answer.citations.length === 0
      ? prepared.expectation.responseKind === "abstain"
        ? 10_000
        : 0
      : basisPoints(uniqueValidIds.size, answer.citations.length);
  const evidence = scoreEvidence(prepared, uniqueValidIds);
  const abstentionCorrect =
    (prepared.expectation.responseKind === "abstain") === observedAbstention;
  const semanticSupported =
    responseCorrect &&
    abstentionCorrect &&
    citationValidity === 10_000 &&
    evidence.recall === 10_000 &&
    evidence.precision === 10_000 &&
    (prepared.expectation.responseKind === "answer" ||
      answer.citations.length === 0);
  const failureReasons: Array<z.infer<typeof evaluatorFailureReasonSchema>> =
    [];
  if (!responseCorrect) failureReasons.push("answer-mismatch");
  if (!abstentionCorrect) failureReasons.push("abstention-mismatch");
  if (evidence.recall !== 10_000)
    failureReasons.push("missing-required-evidence");
  if (evidence.precision !== 10_000)
    failureReasons.push("unsupported-citation");
  if (citationValidity !== 10_000) failureReasons.push("invalid-citation");
  return m9b2EvaluationScoreSchema.parse({
    protocol: M9B2_MEASUREMENT_PROTOCOL.id,
    evaluatorVersion: M9B2_EVALUATOR_IDENTITY.version,
    caseId: prepared.publicCase.id,
    family: prepared.publicCase.family,
    scale: prepared.publicCase.scale,
    expectedResponseKind: prepared.expectation.responseKind,
    observedAbstention,
    responseCorrect,
    abstentionCorrect,
    requiredEvidenceRecallBasisPoints: evidence.recall,
    supportingEvidencePrecisionBasisPoints: evidence.precision,
    citationValidityBasisPoints: citationValidity,
    semanticSupported,
    failureReasons,
  });
}

/** Creates one case-bound, arm-blind, deterministic offline evaluator session. */
export function createM9b2OfflineEvaluator(
  suite: M9b2PreparedSuite,
  caseId: string,
): Result<M9b1ExternalEvaluator, Diagnostic> {
  const prepared = suites.get(suite)?.cases.get(caseId);
  if (prepared === undefined)
    return invalid("M9b.2 evaluator case is unknown.");
  return {
    ok: true,
    value: Object.freeze({
      identity: M9B2_EVALUATOR_IDENTITY,
      evaluate: (input, signal) => {
        if (signal.aborted)
          return Promise.resolve({
            ok: false,
            error: retrievalFailure(
              "aborted",
              "M9b.2 evaluation was cancelled before dispatch.",
            ),
          });
        if (input.task !== prepared.publicCase.task)
          return Promise.resolve({
            ok: false,
            error: retrievalFailure(
              "identity-mismatch",
              "M9b.2 evaluator task does not match its bound case.",
            ),
          });
        const answer = m9aCitationConfinedAnswerSchema.safeParse(input.answer);
        if (!answer.success)
          return Promise.resolve({
            ok: false,
            error: retrievalFailure(
              "invalid-input",
              "M9b.2 evaluator requires a citation-confined answer.",
            ),
          });
        return Promise.resolve({
          ok: true,
          value: strictJsonValueSchema.parse(
            evaluatePreparedCase(prepared, answer.data),
          ),
        });
      },
    }),
  };
}

export const m9b2EvaluatorConformanceFixtureSchema = z
  .strictObject({
    caseId: identifierSchema,
    answer: m9aCitationConfinedAnswerSchema,
    expectedSemanticSupported: z.boolean(),
    expectedFailureReasons: evaluatorFailureReasonSchema.array().readonly(),
  })
  .readonly();
export type M9b2EvaluatorConformanceFixture = z.infer<
  typeof m9b2EvaluatorConformanceFixtureSchema
>;

export const m9b2EvaluatorConformanceReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b2a-evaluator-conformance/1"),
    classification: z.literal("deterministic-evaluator-conformance-only"),
    fixtureCount: z.number().int().positive(),
    coveredFamilies: m9b2TaskFamilySchema.array().length(8).readonly(),
    expectedAgreementBasisPoints: z.number().int().min(0).max(10_000),
    repeatabilityBasisPoints: z.number().int().min(0).max(10_000),
    passed: z.boolean(),
    campaignAdvancementAuthorized: z.literal(false),
    nextRequiredGate: z.literal(
      "separately-frozen-independently-reviewed-gold-and-evaluator-validation",
    ),
    reportDigest: digestSchema,
  })
  .superRefine((report, context) => {
    const passed =
      report.expectedAgreementBasisPoints === 10_000 &&
      report.repeatabilityBasisPoints === 10_000;
    if (report.passed !== passed)
      context.addIssue({
        code: "custom",
        message: "M9b.2 evaluator conformance report is inconsistent.",
      });
  })
  .readonly();
export type M9b2EvaluatorConformanceReport = z.infer<
  typeof m9b2EvaluatorConformanceReportSchema
>;

export async function auditM9b2EvaluatorConformance(
  suite: M9b2PreparedSuite,
  values: ReadonlyArray<unknown>,
): Promise<Result<M9b2EvaluatorConformanceReport, Diagnostic>> {
  const fixtures = m9b2EvaluatorConformanceFixtureSchema
    .array()
    .min(16)
    .safeParse(values);
  const stored = suites.get(suite);
  if (!fixtures.success || stored === undefined)
    return invalid("M9b.2 evaluator conformance fixtures are invalid.");
  let agreements = 0;
  let repeats = 0;
  const covered = new Set<M9b2TaskFamily>();
  for (const fixture of fixtures.data) {
    const prepared = stored.cases.get(fixture.caseId);
    if (prepared === undefined)
      return invalid("M9b.2 conformance fixture references an unknown case.");
    covered.add(prepared.publicCase.family);
    const first = evaluatePreparedCase(prepared, fixture.answer);
    const second = evaluatePreparedCase(prepared, fixture.answer);
    if (
      first.semanticSupported === fixture.expectedSemanticSupported &&
      canonicalEqual(first.failureReasons, fixture.expectedFailureReasons)
    )
      agreements += 1;
    if (canonicalEqual(first, second)) repeats += 1;
  }
  const coveredFamilies = M9B2_TASK_FAMILIES.filter((family) =>
    covered.has(family),
  );
  if (coveredFamilies.length !== M9B2_TASK_FAMILIES.length)
    return invalid("M9b.2 conformance fixtures must cover every task family.");
  const expectedAgreementBasisPoints = basisPoints(
    agreements,
    fixtures.data.length,
  );
  const repeatabilityBasisPoints = basisPoints(repeats, fixtures.data.length);
  const passed =
    expectedAgreementBasisPoints === 10_000 &&
    repeatabilityBasisPoints === 10_000;
  const body = {
    protocol: "lachesis-m9b2a-evaluator-conformance/1" as const,
    classification: "deterministic-evaluator-conformance-only" as const,
    fixtureCount: fixtures.data.length,
    coveredFamilies,
    expectedAgreementBasisPoints,
    repeatabilityBasisPoints,
    passed,
    campaignAdvancementAuthorized: false as const,
    nextRequiredGate:
      "separately-frozen-independently-reviewed-gold-and-evaluator-validation" as const,
  };
  const reportDigest = await digestValue(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b2EvaluatorConformanceReportSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function verifyM9b2EvaluatorConformanceReport(
  suite: M9b2PreparedSuite,
  fixtures: ReadonlyArray<unknown>,
  value: unknown,
): Promise<Result<M9b2EvaluatorConformanceReport, Diagnostic>> {
  const parsed = m9b2EvaluatorConformanceReportSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.2 conformance report is invalid.");
  const recomputed = await auditM9b2EvaluatorConformance(suite, fixtures);
  return recomputed.ok && canonicalEqual(recomputed.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 conformance report does not replay from its fixtures.");
}

const firstAttemptStageSchema = z.enum([
  "authoring-rejected",
  "compile-rejected",
  "execution-failed",
  "evaluation-failed",
  "evaluated",
]);

export const m9b2PrimaryEndpointSchema = z
  .strictObject({
    endpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
    terminalStage: firstAttemptStageSchema,
    semanticSupported: z.boolean(),
    success: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.terminalStage !== "evaluated" && value.semanticSupported)
      context.addIssue({
        code: "custom",
        message: "M9b.2 cannot assign semantic support before evaluation.",
      });
    if (
      value.success !==
      (value.terminalStage === "evaluated" && value.semanticSupported)
    )
      context.addIssue({
        code: "custom",
        message:
          "M9b.2 primary endpoint must include every first-attempt stage.",
      });
  })
  .readonly();
export type M9b2PrimaryEndpoint = z.infer<typeof m9b2PrimaryEndpointSchema>;

export function classifyM9b2PrimaryEndpoint(
  input: Readonly<{
    terminalStage: z.infer<typeof firstAttemptStageSchema>;
    semanticSupported: boolean;
  }>,
): Result<M9b2PrimaryEndpoint, Diagnostic> {
  const parsed = m9b2PrimaryEndpointSchema.safeParse({
    endpoint: M9B2_PRIMARY_ENDPOINT,
    terminalStage: input.terminalStage,
    semanticSupported:
      input.terminalStage === "evaluated" && input.semanticSupported,
    success: input.terminalStage === "evaluated" && input.semanticSupported,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 primary endpoint input is invalid.");
}

const boundedUsageSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("known"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      wallClockMs: z.number().int().nonnegative(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unknown"),
      reason: z.literal("no-successful-boundary-receipt"),
    })
    .readonly(),
]);

const boundedMetricSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({ kind: z.literal("known"), value: z.number().int() })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unknown"),
      reason: z.literal("no-successful-execution-receipt"),
    })
    .readonly(),
]);

const measurementModelIdentitySchema = z
  .strictObject({ id: z.string().min(1), version: z.string().min(1) })
  .readonly();

const terminalMeasurementBodySchema = z
  .strictObject({
    protocol: z.literal(M9B2_PERSISTENCE_PROTOCOL.record),
    measurementProtocol: z
      .strictObject({
        id: z.literal(M9B2_MEASUREMENT_PROTOCOL.id),
        version: z.literal(M9B2_MEASUREMENT_PROTOCOL.version),
      })
      .readonly(),
    suiteDigest: digestSchema,
    caseId: identifierSchema,
    sourceArmRecordDigest: digestSchema,
    comparisonDigest: digestSchema,
    arm: z.enum(["discovered-program", "static-one-shot"]),
    taskDigest: digestSchema,
    corpusSnapshotDigest: digestSchema,
    model: measurementModelIdentitySchema,
    evaluator: measurementModelIdentitySchema,
    programIdentity: digestSchema.nullable(),
    authoringRequestDigest: digestSchema,
    executionRequestDigests: digestSchema.array().readonly(),
    evaluationAttemptDigest: digestSchema.nullable(),
    runAnswerDigest: digestSchema.nullable(),
    primary: m9b2PrimaryEndpointSchema,
    evaluation: m9b2EvaluationScoreSchema.nullable(),
    usage: z
      .strictObject({
        planning: z
          .strictObject({
            requestDigest: digestSchema,
            reservedInputTokens: z.number().int().nonnegative(),
            actual: boundedUsageSchema,
          })
          .readonly(),
        execution: z
          .strictObject({
            requestDigests: digestSchema.array().readonly(),
            reservedInputTokens: z.number().int().nonnegative(),
            actual: boundedUsageSchema,
          })
          .readonly(),
      })
      .readonly(),
    secondary: z
      .strictObject({
        retrievedEvidenceRecallBasisPoints: boundedMetricSchema,
        retrievedEvidencePrecisionBasisPoints: boundedMetricSchema,
        citationValidityBasisPoints: boundedMetricSchema,
        bytesRead: boundedMetricSchema,
        retrievalCalls: boundedMetricSchema,
        modelCalls: boundedMetricSchema,
        compilationAccepted: z.boolean(),
      })
      .readonly(),
  })
  .readonly();

export const m9b2TerminalMeasurementRecordSchema = terminalMeasurementBodySchema
  .unwrap()
  .safeExtend({ recordDigest: digestSchema })
  .readonly();
export type M9b2TerminalMeasurementRecord = z.infer<
  typeof m9b2TerminalMeasurementRecordSchema
>;
export type M9b2TerminalMeasurementBinding = Readonly<{
  suiteDigest: string;
  caseId: string;
  sourceArmRecordDigest: string;
  comparisonDigest: string;
  arm: M9b1Arm;
  taskDigest: string;
  corpusSnapshotDigest: string;
  model: Readonly<{ id: string; version: string }>;
  evaluator: Readonly<{ id: string; version: string }>;
  programIdentity: string | null;
}>;

function programIdentityOf(record: M9b1ArmRecord): string | null {
  if (record.authoringResponse === null) return null;
  return record.authoringResponse.kind === "program"
    ? record.authoringResponse.sourceDigest
    : record.authoringResponse.derivedSourceDigest;
}

/**
 * Derives one offline measurement only after M9b.1b has replay-verified the
 * complete terminal arm record. It performs no retrieval, model, or evaluator
 * dispatch.
 */
export async function measureM9b2VerifiedTerminalRecord(
  input: Readonly<{
    suite: M9b2PreparedSuite;
    caseId: string;
    verifiedRecord: M9b1VerifiedTerminalRecord;
    expected: Readonly<{
      arm: M9b1Arm;
      sourceArmRecordDigest: string;
      comparisonDigest: string;
      model: Readonly<{ id: string; version: string }>;
      evaluator: Readonly<{ id: string; version: string }>;
      programIdentity: string | null;
    }>;
  }>,
): Promise<Result<M9b2TerminalMeasurementRecord, Diagnostic>> {
  const prepared = suites.get(input.suite)?.cases.get(input.caseId);
  const stored = m9b1InternalInspectVerifiedTerminalRecord(
    input.verifiedRecord,
  );
  if (prepared === undefined || stored === undefined)
    return invalid(
      "M9b.2 requires a prepared case and verified M9b.1b record.",
    );
  const record = stored.result.record;
  const taskDigest = await digestValue(prepared.publicCase.task);
  const actualProgramIdentity = programIdentityOf(record);
  if (
    !taskDigest.ok ||
    stored.task !== prepared.publicCase.task ||
    record.taskDigest !== taskDigest.value ||
    record.corpusSnapshotDigest !== prepared.snapshotDigest ||
    record.arm !== input.expected.arm ||
    record.recordDigest !== input.expected.sourceArmRecordDigest ||
    record.comparisonDigest !== input.expected.comparisonDigest ||
    !canonicalEqual(record.model, input.expected.model) ||
    !canonicalEqual(record.evaluator, input.expected.evaluator) ||
    !canonicalEqual(record.evaluator, M9B2_EVALUATOR_IDENTITY) ||
    actualProgramIdentity !== input.expected.programIdentity
  )
    return invalid("M9b.2 verified terminal record is cross-bound.");

  const stage = (() => {
    switch (record.outcome.status) {
      case "authoring-rejected-first-attempt":
        return "authoring-rejected" as const;
      case "compile-rejected-first-attempt":
        return "compile-rejected" as const;
      case "execution-failure":
        return "execution-failed" as const;
      case "evaluation-failure":
        return "evaluation-failed" as const;
      case "success":
        return "evaluated" as const;
    }
  })();

  let evaluation: M9b2EvaluationScore | null = null;
  let evaluationAttemptDigest: string | null = null;
  let runAnswerDigest: string | null = null;
  if (
    record.outcome.status === "success" ||
    record.outcome.status === "evaluation-failure"
  ) {
    const attemptDigest = await digestValue(record.outcome.evaluationAttempt);
    const runAnswer = stored.result.run?.answer;
    const answerDigest =
      runAnswer === undefined ? undefined : await digestValue(runAnswer);
    if (!attemptDigest.ok || !answerDigest?.ok)
      return invalid("M9b.2 could not bind the persisted evaluation attempt.");
    evaluationAttemptDigest = attemptDigest.value;
    runAnswerDigest = answerDigest.value;
    if (record.outcome.status === "success") {
      const parsedOutput = parseJson(
        record.outcome.evaluationAttempt.serializedOutput,
      );
      const score = parsedOutput.ok
        ? m9b2EvaluationScoreSchema.safeParse(parsedOutput.value)
        : undefined;
      const answer = m9aCitationConfinedAnswerSchema.safeParse(
        stored.result.run?.answer,
      );
      if (
        score?.success !== true ||
        !answer.success ||
        score.data.caseId !== input.caseId
      )
        return invalid("M9b.2 persisted evaluator output is invalid.");
      const recomputed = evaluatePreparedCase(prepared, answer.data);
      if (!canonicalEqual(recomputed, score.data))
        return invalid(
          "M9b.2 persisted evaluation does not match the bound run answer.",
        );
      evaluation = score.data;
    }
  }
  const primary = classifyM9b2PrimaryEndpoint({
    terminalStage: stage,
    semanticSupported: evaluation?.semanticSupported ?? false,
  });
  if (!primary.ok) return primary;
  const planningActual =
    record.authoringResponse === null
      ? ({
          kind: "unknown",
          reason: "no-successful-boundary-receipt",
        } as const)
      : ({
          kind: "known",
          inputTokens: record.authoringResponse.usage.inputTokens,
          outputTokens: record.authoringResponse.usage.outputTokens,
          wallClockMs: record.authoringResponse.usage.wallClockMs,
        } as const);
  const executionActual =
    stored.result.run === undefined
      ? ({
          kind: "unknown",
          reason: "no-successful-boundary-receipt",
        } as const)
      : ({
          kind: "known",
          inputTokens: stored.result.run.transcript.retrievalUsage.inputTokens,
          outputTokens:
            stored.result.run.transcript.retrievalUsage.outputTokens,
          wallClockMs: stored.result.run.transcript.runtimeUsage.wallClockMs,
        } as const);
  const unknownExecutionMetric = {
    kind: "unknown" as const,
    reason: "no-successful-execution-receipt" as const,
  };
  const runUsage = stored.result.run?.transcript.retrievalUsage;
  const retrieved =
    stored.result.run === undefined
      ? undefined
      : scoreEvidence(
          prepared,
          new Set(
            stored.result.run.visibility.readResults.flatMap((result) =>
              result.excerpts.map((excerpt) => excerpt.chunk.id),
            ),
          ),
        );
  const modelCallCount =
    stored.result.run === undefined || record.authoringResponse === null
      ? undefined
      : 1 +
        stored.result.run.transcript.retrievalUsage.rootModelCalls +
        stored.result.run.transcript.retrievalUsage.leafModelCalls;
  const knownMetric = (value: number) => ({ kind: "known" as const, value });
  const body = terminalMeasurementBodySchema.parse({
    protocol: M9B2_PERSISTENCE_PROTOCOL.record,
    measurementProtocol: {
      id: M9B2_MEASUREMENT_PROTOCOL.id,
      version: M9B2_MEASUREMENT_PROTOCOL.version,
    },
    suiteDigest: suites.get(input.suite)?.suiteDigest,
    caseId: input.caseId,
    sourceArmRecordDigest: record.recordDigest,
    comparisonDigest: record.comparisonDigest,
    arm: record.arm,
    taskDigest: record.taskDigest,
    corpusSnapshotDigest: record.corpusSnapshotDigest,
    model: record.model,
    evaluator: record.evaluator,
    programIdentity: actualProgramIdentity,
    authoringRequestDigest: record.authoringRequest.requestDigest,
    executionRequestDigests: record.executionRequests.map(
      (request) => request.requestDigest,
    ),
    evaluationAttemptDigest,
    runAnswerDigest,
    primary: primary.value,
    evaluation,
    usage: {
      planning: {
        requestDigest: record.authoringRequest.requestDigest,
        reservedInputTokens: record.authoringRequest.reservation.inputTokens,
        actual: planningActual,
      },
      execution: {
        requestDigests: record.executionRequests.map(
          (request) => request.requestDigest,
        ),
        reservedInputTokens: record.executionRequests.reduce(
          (total, request) => total + request.reservation.inputTokens,
          0,
        ),
        actual: executionActual,
      },
    },
    secondary: {
      retrievedEvidenceRecallBasisPoints:
        retrieved === undefined
          ? unknownExecutionMetric
          : knownMetric(retrieved.recall),
      retrievedEvidencePrecisionBasisPoints:
        retrieved === undefined
          ? unknownExecutionMetric
          : knownMetric(retrieved.precision),
      citationValidityBasisPoints:
        evaluation === null
          ? unknownExecutionMetric
          : knownMetric(evaluation.citationValidityBasisPoints),
      bytesRead:
        runUsage === undefined
          ? unknownExecutionMetric
          : knownMetric(runUsage.readBytes),
      retrievalCalls:
        runUsage === undefined
          ? unknownExecutionMetric
          : knownMetric(runUsage.searchCalls + runUsage.readCalls),
      modelCalls:
        modelCallCount === undefined
          ? unknownExecutionMetric
          : knownMetric(modelCallCount),
      compilationAccepted: record.compilation?.status === "accepted",
    },
  });
  const recordDigest = await digestValue(body);
  return recordDigest.ok
    ? {
        ok: true,
        value: m9b2TerminalMeasurementRecordSchema.parse({
          ...body,
          recordDigest: recordDigest.value,
        }),
      }
    : recordDigest;
}

export async function verifyM9b2TerminalMeasurementRecord(
  value: unknown,
  binding: M9b2TerminalMeasurementBinding,
): Promise<Result<M9b2TerminalMeasurementRecord, Diagnostic>> {
  const parsed = m9b2TerminalMeasurementRecordSchema.safeParse(value);
  if (!parsed.success)
    return invalid("M9b.2 terminal measurement record is invalid.");
  const { recordDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  return digest.ok &&
    digest.value === recordDigest &&
    parsed.data.suiteDigest === binding.suiteDigest &&
    parsed.data.caseId === binding.caseId &&
    parsed.data.sourceArmRecordDigest === binding.sourceArmRecordDigest &&
    parsed.data.comparisonDigest === binding.comparisonDigest &&
    parsed.data.arm === binding.arm &&
    parsed.data.taskDigest === binding.taskDigest &&
    parsed.data.corpusSnapshotDigest === binding.corpusSnapshotDigest &&
    canonicalEqual(parsed.data.model, binding.model) &&
    canonicalEqual(parsed.data.evaluator, binding.evaluator) &&
    parsed.data.programIdentity === binding.programIdentity
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 terminal measurement record is cross-bound or altered.");
}

const measurementStoreSchema = z
  .strictObject({
    protocol: z.literal(M9B2_PERSISTENCE_PROTOCOL.store),
    records: m9b2TerminalMeasurementRecordSchema.array().readonly(),
  })
  .readonly();

/** @internal Canonical offline persistence snapshot; no stable facade export. */
export async function serializeM9b2MeasurementStore(
  values: ReadonlyArray<unknown>,
  bindings: ReadonlyArray<M9b2TerminalMeasurementBinding>,
): Promise<Result<string, Diagnostic>> {
  if (values.length !== bindings.length)
    return invalid("M9b.2 measurement store bindings are incomplete.");
  const records: Array<M9b2TerminalMeasurementRecord> = [];
  for (const [index, value] of values.entries()) {
    const binding = bindings[index];
    if (binding === undefined)
      return invalid("M9b.2 measurement store binding is missing.");
    const verified = await verifyM9b2TerminalMeasurementRecord(value, binding);
    if (!verified.ok) return verified;
    records.push(verified.value);
  }
  if (
    !unique(
      records.map(
        (record) => `${record.comparisonDigest}:${record.arm}:${record.caseId}`,
      ),
    )
  )
    return invalid("M9b.2 measurement store contains duplicate arm records.");
  return canonicalizeJson(
    measurementStoreSchema.parse({
      protocol: M9B2_PERSISTENCE_PROTOCOL.store,
      records: records.toSorted((left, right) =>
        `${left.comparisonDigest}:${left.arm}:${left.caseId}`.localeCompare(
          `${right.comparisonDigest}:${right.arm}:${right.caseId}`,
        ),
      ),
    }),
  );
}

/** @internal Exact canonical load validation for offline measurement records. */
export async function loadM9b2MeasurementStore(
  content: string,
  bindings: ReadonlyArray<M9b2TerminalMeasurementBinding>,
): Promise<Result<ReadonlyArray<M9b2TerminalMeasurementRecord>, Diagnostic>> {
  const parsed = parseJson(content);
  const store = parsed.ok
    ? measurementStoreSchema.safeParse(parsed.value)
    : undefined;
  if (!parsed.ok || store?.success !== true)
    return invalid("M9b.2 measurement store is invalid.");
  const canonical = canonicalizeJson(store.data);
  if (!canonical.ok || canonical.value !== content)
    return invalid("M9b.2 measurement store is not exact canonical JSON.");
  const reserialized = await serializeM9b2MeasurementStore(
    store.data.records,
    bindings,
  );
  return reserialized.ok && reserialized.value === content
    ? { ok: true, value: store.data.records }
    : invalid("M9b.2 measurement store records failed validation.");
}

export const m9b2PowerScenarioSchema = z
  .strictObject({
    id: identifierSchema,
    discoveredOnlyRateBasisPoints: z.number().int().min(0).max(10_000),
    staticOnlyRateBasisPoints: z.number().int().min(0).max(10_000),
  })
  .superRefine((scenario, context) => {
    if (
      scenario.discoveredOnlyRateBasisPoints +
        scenario.staticOnlyRateBasisPoints >
      10_000
    )
      context.addIssue({
        code: "custom",
        message: "Paired discordance probabilities cannot exceed one.",
      });
  })
  .readonly();
export type M9b2PowerScenario = z.infer<typeof m9b2PowerScenarioSchema>;

export const M9C_FROZEN_ESTIMAND = Object.freeze({
  inferenceUnit: "one-semantically-independent-paired-case" as const,
  endpoint: M9B2_PRIMARY_ENDPOINT,
  contrast:
    "discovered-program-minus-static-one-shot paired success probability" as const,
  weighting: "equal-weight-across-family-by-scale-cells" as const,
  scaleRole: "preregistered-stratum" as const,
  clusteredScaleVariants: "reserved-for-m9d" as const,
  stratifiedResults:
    "descriptive-only-no-additional-superiority-claims" as const,
});

export const m9cInferenceCaseSchema = z
  .strictObject({
    fixtureId: identifierSchema,
    family: m9b2TaskFamilySchema,
    scale: m9b2CorpusScaleSchema,
    semanticProblemIdentity: digestSchema,
  })
  .readonly();
export type M9cInferenceCase = z.infer<typeof m9cInferenceCaseSchema>;

export async function auditM9cInferenceUnits(
  values: ReadonlyArray<unknown>,
): Promise<
  Result<
    Readonly<{
      protocol: "lachesis-m9b2a-m9c-inference-unit-audit/1";
      estimand: typeof M9C_FROZEN_ESTIMAND;
      caseCount: number;
      cellWeight: Readonly<{ numerator: 1; denominator: 24 }>;
      passed: true;
      auditDigest: string;
    }>,
    Diagnostic
  >
> {
  const cases = m9cInferenceCaseSchema
    .array()
    .min(1)
    .max(10_000)
    .safeParse(values);
  if (!cases.success)
    return invalid("M9c inference-unit candidates are invalid.");
  if (
    !unique(cases.data.map((value) => value.fixtureId)) ||
    !unique(cases.data.map((value) => value.semanticProblemIdentity))
  )
    return invalid(
      "M9c requires semantically independent cases; clustered scale variants are reserved for M9d.",
    );
  const cells = new Set(
    cases.data.map((value) => `${value.family}:${value.scale}`),
  );
  if (cells.size !== M9B2_TASK_FAMILIES.length * M9B2_CORPUS_SCALES.length)
    return invalid("M9c requires every family-by-scale stratum.");
  const body = {
    protocol: "lachesis-m9b2a-m9c-inference-unit-audit/1" as const,
    estimand: M9C_FROZEN_ESTIMAND,
    cases: cases.data.toSorted((left, right) =>
      left.fixtureId.localeCompare(right.fixtureId),
    ),
    cellWeight: { numerator: 1 as const, denominator: 24 as const },
    passed: true as const,
  };
  const auditDigest = await digestValue(body);
  return auditDigest.ok
    ? {
        ok: true,
        value: {
          protocol: body.protocol,
          estimand: body.estimand,
          caseCount: cases.data.length,
          cellWeight: body.cellWeight,
          passed: true,
          auditDigest: auditDigest.value,
        },
      }
    : auditDigest;
}

const m9cPairedOutcomeSchema = m9cInferenceCaseSchema
  .unwrap()
  .safeExtend({ discoveredSuccess: z.boolean(), staticSuccess: z.boolean() })
  .readonly();

const descriptiveStratumSchema = z
  .strictObject({
    stratum: z.string().min(1),
    pairedCases: z.number().int().positive(),
    discoveredSuccessBasisPoints: z.number().int().min(0).max(10_000),
    staticSuccessBasisPoints: z.number().int().min(0).max(10_000),
    riskDifferenceBasisPoints: z.number().int().min(-10_000).max(10_000),
  })
  .readonly();

export const m9cDescriptiveReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b2a-m9c-descriptive-report/1"),
    estimand: strictJsonValueSchema,
    claimScope: z.literal(
      "family-and-scale-stratified-descriptive-results-only-no-additional-superiority-claims",
    ),
    pairedCases: z.number().int().positive(),
    equalCellWeightedRiskDifferenceBasisPoints: z
      .number()
      .int()
      .min(-10_000)
      .max(10_000),
    byFamily: descriptiveStratumSchema.array().length(8).readonly(),
    byScale: descriptiveStratumSchema.array().length(3).readonly(),
    reportDigest: digestSchema,
  })
  .readonly();
export type M9cDescriptiveReport = z.infer<typeof m9cDescriptiveReportSchema>;

function describeOutcomeStratum(
  stratum: string,
  values: ReadonlyArray<z.infer<typeof m9cPairedOutcomeSchema>>,
): z.infer<typeof descriptiveStratumSchema> {
  const discovered = values.filter((value) => value.discoveredSuccess).length;
  const staticSuccesses = values.filter((value) => value.staticSuccess).length;
  const discoveredBasisPoints = basisPoints(discovered, values.length);
  const staticBasisPoints = basisPoints(staticSuccesses, values.length);
  return descriptiveStratumSchema.parse({
    stratum,
    pairedCases: values.length,
    discoveredSuccessBasisPoints: discoveredBasisPoints,
    staticSuccessBasisPoints: staticBasisPoints,
    riskDifferenceBasisPoints: discoveredBasisPoints - staticBasisPoints,
  });
}

export async function reportM9cPairedDescriptives(
  values: ReadonlyArray<unknown>,
): Promise<Result<M9cDescriptiveReport, Diagnostic>> {
  const outcomes = m9cPairedOutcomeSchema
    .array()
    .min(24)
    .max(10_000)
    .safeParse(values);
  if (!outcomes.success)
    return invalid("M9c paired descriptive outcomes are invalid.");
  const independence = await auditM9cInferenceUnits(
    outcomes.data.map((value) => ({
      fixtureId: value.fixtureId,
      family: value.family,
      scale: value.scale,
      semanticProblemIdentity: value.semanticProblemIdentity,
    })),
  );
  if (!independence.ok) return independence;
  const cells = M9B2_TASK_FAMILIES.flatMap((family) =>
    M9B2_CORPUS_SCALES.map((scale) =>
      describeOutcomeStratum(
        `${family}:${scale}`,
        outcomes.data.filter(
          (value) => value.family === family && value.scale === scale,
        ),
      ),
    ),
  );
  const body = {
    protocol: "lachesis-m9b2a-m9c-descriptive-report/1" as const,
    estimand: strictJsonValueSchema.parse(M9C_FROZEN_ESTIMAND),
    claimScope:
      "family-and-scale-stratified-descriptive-results-only-no-additional-superiority-claims" as const,
    pairedCases: outcomes.data.length,
    equalCellWeightedRiskDifferenceBasisPoints: Math.round(
      cells.reduce((sum, cell) => sum + cell.riskDifferenceBasisPoints, 0) /
        cells.length,
    ),
    byFamily: M9B2_TASK_FAMILIES.map((family) =>
      describeOutcomeStratum(
        family,
        outcomes.data.filter((value) => value.family === family),
      ),
    ),
    byScale: M9B2_CORPUS_SCALES.map((scale) =>
      describeOutcomeStratum(
        scale,
        outcomes.data.filter((value) => value.scale === scale),
      ),
    ),
  };
  const reportDigest = await digestValue(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9cDescriptiveReportSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

const powerCaseBoundSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("known"),
      pairedCases: z.number().int().positive(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unknown"),
      reason: z.enum([
        "no-positive-assumed-effect",
        "exceeds-practical-ceiling",
      ]),
    })
    .readonly(),
]);

const powerScenarioResultSchema = z
  .strictObject({
    scenario: m9b2PowerScenarioSchema,
    assumedRiskDifferenceBasisPoints: z.number().int(),
    powerAtPracticalCeilingBasisPoints: z.number().int().min(0).max(10_000),
    requiredPairedCases: powerCaseBoundSchema,
  })
  .readonly();

export const m9b2PowerReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b2a-prospective-paired-power/2"),
    method: z.literal("exact-one-sided-conditional-mcnemar-scenario-analysis"),
    independenceAssumption: z.literal(
      "enforced-by-final-m9c-corpus-construction-one-semantic-problem-per-paired-case",
    ),
    familyAlphaBasisPoints: z.number().int().positive().max(5_000),
    targetPowerBasisPoints: z.number().int().positive().max(10_000),
    practicalPairedCaseCeiling: z.number().int().positive().max(2_000),
    empiricalPower: z
      .strictObject({
        kind: z.literal("unknown"),
        reason: z.literal("no-development-model-discordance-estimate"),
      })
      .readonly(),
    scenarios: powerScenarioResultSchema.array().min(1).max(16).readonly(),
    decision: z
      .strictObject({
        outcome: z.literal("no-go"),
        blockers: z
          .tuple([
            z.literal("no-development-model-discordance-estimate"),
            z.literal("final-heldout-corpus-not-materialized"),
            z.literal("provider-boundaries-not-frozen"),
          ])
          .readonly(),
      })
      .readonly(),
    reportDigest: digestSchema,
  })
  .readonly();
export type M9b2PowerReport = z.infer<typeof m9b2PowerReportSchema>;

function binomialDistribution(
  trials: number,
  probability: number,
): ReadonlyArray<number> {
  if (probability === 0)
    return Object.freeze([1, ...Array.from({ length: trials }, () => 0)]);
  if (probability === 1)
    return Object.freeze([...Array.from({ length: trials }, () => 0), 1]);
  const values = Array.from({ length: trials + 1 }, () => 0);
  const mode = Math.min(trials, Math.floor((trials + 1) * probability));
  values[mode] = 1;
  for (let successes = mode; successes > 0; successes -= 1) {
    const current = values[successes] ?? 0;
    values[successes - 1] =
      current *
      (successes / (trials - successes + 1)) *
      ((1 - probability) / probability);
  }
  for (let successes = mode; successes < trials; successes += 1) {
    const current = values[successes] ?? 0;
    values[successes + 1] =
      current *
      ((trials - successes) / (successes + 1)) *
      (probability / (1 - probability));
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze(values.map((value) => value / total));
}

function rejectionThreshold(discordances: number, alpha: number): number {
  const nullDistribution = binomialDistribution(discordances, 0.5);
  let tail = 0;
  let threshold = discordances + 1;
  for (let successes = discordances; successes >= 0; successes -= 1) {
    tail += nullDistribution[successes] ?? 0;
    if (tail <= alpha) threshold = successes;
  }
  return threshold;
}

function exactConditionalPowerByDiscordance(
  maximum: number,
  conditionalDiscoveredWinRate: number,
  alpha: number,
): ReadonlyArray<number> {
  return Object.freeze(
    Array.from({ length: maximum + 1 }, (_value, discordances) => {
      const threshold = rejectionThreshold(discordances, alpha);
      const alternative = binomialDistribution(
        discordances,
        conditionalDiscoveredWinRate,
      );
      return alternative
        .slice(threshold)
        .reduce((sum, probability) => sum + probability, 0);
    }),
  );
}

function scenarioPower(
  pairedCases: number,
  discordanceRate: number,
  conditionalPower: ReadonlyArray<number>,
): number {
  const discordances = binomialDistribution(pairedCases, discordanceRate);
  return discordances.reduce(
    (sum, probability, count) =>
      sum + probability * (conditionalPower[count] ?? 0),
    0,
  );
}

/** Scenario analysis only; empirical power remains explicitly unknown offline. */
export async function analyzeM9b2ProspectivePower(
  input: Readonly<{
    scenarios: ReadonlyArray<unknown>;
    familyAlphaBasisPoints?: number | undefined;
    targetPowerBasisPoints?: number | undefined;
    practicalPairedCaseCeiling?: number | undefined;
  }>,
): Promise<Result<M9b2PowerReport, Diagnostic>> {
  const scenarios = m9b2PowerScenarioSchema
    .array()
    .min(1)
    .max(16)
    .safeParse(input.scenarios);
  const settings = z
    .strictObject({
      familyAlphaBasisPoints: z.number().int().positive().max(5_000),
      targetPowerBasisPoints: z.number().int().positive().max(10_000),
      practicalPairedCaseCeiling: z.number().int().positive().max(2_000),
    })
    .safeParse({
      familyAlphaBasisPoints: input.familyAlphaBasisPoints ?? 500,
      targetPowerBasisPoints: input.targetPowerBasisPoints ?? 8_000,
      practicalPairedCaseCeiling: input.practicalPairedCaseCeiling ?? 480,
    });
  if (!scenarios.success || !settings.success)
    return invalid("M9b.2 prospective power inputs are invalid.");
  const alpha = settings.data.familyAlphaBasisPoints / 10_000;
  const target = settings.data.targetPowerBasisPoints / 10_000;
  const results = scenarios.data.map((scenario) => {
    const discoveredOnly = scenario.discoveredOnlyRateBasisPoints / 10_000;
    const staticOnly = scenario.staticOnlyRateBasisPoints / 10_000;
    const discordanceRate = discoveredOnly + staticOnly;
    const positiveEffect = discoveredOnly > staticOnly && discordanceRate > 0;
    const conditionalPower = positiveEffect
      ? exactConditionalPowerByDiscordance(
          settings.data.practicalPairedCaseCeiling,
          discoveredOnly / discordanceRate,
          alpha,
        )
      : Object.freeze(
          Array.from(
            { length: settings.data.practicalPairedCaseCeiling + 1 },
            () => 0,
          ),
        );
    const powerAtCeiling = positiveEffect
      ? scenarioPower(
          settings.data.practicalPairedCaseCeiling,
          discordanceRate,
          conditionalPower,
        )
      : 0;
    let requiredPairedCases: z.infer<typeof powerCaseBoundSchema> = {
      kind: "unknown",
      reason: positiveEffect
        ? "exceeds-practical-ceiling"
        : "no-positive-assumed-effect",
    };
    if (positiveEffect) {
      for (
        let pairedCases = 1;
        pairedCases <= settings.data.practicalPairedCaseCeiling;
        pairedCases += 1
      ) {
        if (
          scenarioPower(pairedCases, discordanceRate, conditionalPower) >=
          target
        ) {
          requiredPairedCases = { kind: "known", pairedCases };
          break;
        }
      }
    }
    return powerScenarioResultSchema.parse({
      scenario,
      assumedRiskDifferenceBasisPoints:
        scenario.discoveredOnlyRateBasisPoints -
        scenario.staticOnlyRateBasisPoints,
      powerAtPracticalCeilingBasisPoints: Math.min(
        10_000,
        Math.max(0, Math.round(powerAtCeiling * 10_000)),
      ),
      requiredPairedCases,
    });
  });
  const body = {
    protocol: "lachesis-m9b2a-prospective-paired-power/2" as const,
    method: "exact-one-sided-conditional-mcnemar-scenario-analysis" as const,
    independenceAssumption:
      "enforced-by-final-m9c-corpus-construction-one-semantic-problem-per-paired-case" as const,
    ...settings.data,
    empiricalPower: {
      kind: "unknown" as const,
      reason: "no-development-model-discordance-estimate" as const,
    },
    scenarios: results,
    decision: {
      outcome: "no-go" as const,
      blockers: [
        "no-development-model-discordance-estimate",
        "final-heldout-corpus-not-materialized",
        "provider-boundaries-not-frozen",
      ] as const,
    },
  };
  const reportDigest = await digestValue(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b2PowerReportSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function verifyM9b2PowerReport(
  value: unknown,
): Promise<Result<M9b2PowerReport, Diagnostic>> {
  const parsed = m9b2PowerReportSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.2 power report is invalid.");
  const recomputed = await analyzeM9b2ProspectivePower({
    scenarios: parsed.data.scenarios.map((result) => result.scenario),
    familyAlphaBasisPoints: parsed.data.familyAlphaBasisPoints,
    targetPowerBasisPoints: parsed.data.targetPowerBasisPoints,
    practicalPairedCaseCeiling: parsed.data.practicalPairedCaseCeiling,
  });
  return recomputed.ok && canonicalEqual(recomputed.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 power report does not replay from its scenarios.");
}

const measurementDesignBodySchema = z
  .strictObject({
    protocol: z.literal(M9B2_MEASUREMENT_PROTOCOL.id),
    version: z.literal(M9B2_MEASUREMENT_PROTOCOL.version),
    status: z.literal("offline-design-complete-m9b-no-go"),
    primaryEndpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
    taskFamilies: z
      .tuple([
        z.literal("lookup"),
        z.literal("join"),
        z.literal("multi-hop"),
        z.literal("temporal-retraction"),
        z.literal("contradiction"),
        z.literal("aggregation"),
        z.literal("insufficient-evidence"),
        z.literal("prompt-injection"),
      ])
      .readonly(),
    corpusScales: z
      .tuple([z.literal("1x"), z.literal("8x"), z.literal("32x")])
      .readonly(),
    answerNormalization: z.literal(
      "nfkc-lowercase-en-us-collapse-whitespace-strip-terminal-punctuation/1",
    ),
    semanticRule: z.literal(
      "exact-answer-or-abstention-plus-snapshot-chunk-bound-support/2",
    ),
    secondaryMetrics: z
      .tuple([
        z.literal("retrieved-evidence-recall"),
        z.literal("retrieved-evidence-precision"),
        z.literal("citation-validity"),
        z.literal("correct-abstention"),
        z.literal("bytes-read"),
        z.literal("retrieval-calls"),
        z.literal("model-calls"),
        z.literal("compilation-acceptance"),
        z.literal("input-tokens"),
        z.literal("output-tokens"),
        z.literal("reasoning-tokens"),
        z.literal("latency-ms"),
        z.literal("cost-usd-micros"),
      ])
      .readonly(),
    evaluatorConformanceGate: z
      .strictObject({
        classification: z.literal("deterministic-conformance-only"),
        minimumFixtureAgreementBasisPoints: z.literal(10_000),
        minimumRepeatabilityBasisPoints: z.literal(10_000),
        everyTaskFamilyRequired: z.literal(true),
        campaignAdvancementAuthorized: z.literal(false),
        independentGoldAndEvaluatorValidationRequired: z.literal(true),
      })
      .readonly(),
    inferenceDesign: z
      .strictObject({
        inferenceUnit: z.literal("one-semantically-independent-paired-case"),
        estimand: z.literal(
          "equal-cell-weighted-discovered-minus-static-first-attempt-success-probability",
        ),
        scaleRole: z.literal("preregistered-stratum"),
        clusteredScaleVariants: z.literal("reserved-for-m9d"),
        stratifiedResults: z.literal(
          "descriptive-only-no-additional-superiority-claims",
        ),
        familyScaleWeight: z
          .strictObject({ numerator: z.literal(1), denominator: z.literal(24) })
          .readonly(),
      })
      .readonly(),
    powerDesign: z
      .strictObject({
        method: z.literal(
          "exact-one-sided-conditional-mcnemar-scenario-analysis",
        ),
        independenceAssumption: z.literal(
          "enforced-by-final-m9c-corpus-construction",
        ),
        familyAlphaBasisPoints: z.literal(500),
        targetPowerBasisPoints: z.literal(8_000),
        practicalPairedCaseCeiling: z.literal(480),
        empiricalPower: z.literal(
          "unknown-until-development-model-discordance",
        ),
      })
      .readonly(),
    splitPolicy: z
      .strictObject({
        developmentNamespace: z.literal("m9b2-dev"),
        eventualHeldoutNamespace: z.literal("m9b2-heldout"),
        contentAndIdentityOverlapAllowed: z.literal(false),
        taskFamilyOverlapAllowed: z.literal(true),
        solutionStrategyClassOverlapAllowed: z.literal(true),
        finalHeldoutCorpusMaterialized: z.literal(false),
        finalCorpusIdentityFrozen: z.literal(false),
      })
      .readonly(),
    authority: z
      .strictObject({
        providerAdapterCreated: z.literal(false),
        liveCallsAuthorized: z.literal(false),
        campaignCreated: z.literal(false),
        preregistrationCreated: z.literal(false),
        superiorityClaimAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .readonly();

export const m9b2MeasurementDesignSchema = measurementDesignBodySchema
  .unwrap()
  .safeExtend({ designDigest: digestSchema })
  .readonly();
export type M9b2MeasurementDesign = z.infer<typeof m9b2MeasurementDesignSchema>;

/** Freezes only the offline scientific rules, never a final corpus identity. */
export async function designM9b2Measurement(): Promise<
  Result<M9b2MeasurementDesign, Diagnostic>
> {
  const body = measurementDesignBodySchema.parse({
    protocol: M9B2_MEASUREMENT_PROTOCOL.id,
    version: M9B2_MEASUREMENT_PROTOCOL.version,
    status: "offline-design-complete-m9b-no-go",
    primaryEndpoint: M9B2_PRIMARY_ENDPOINT,
    taskFamilies: M9B2_TASK_FAMILIES,
    corpusScales: M9B2_CORPUS_SCALES,
    answerNormalization:
      "nfkc-lowercase-en-us-collapse-whitespace-strip-terminal-punctuation/1",
    semanticRule:
      "exact-answer-or-abstention-plus-snapshot-chunk-bound-support/2",
    secondaryMetrics: [
      "retrieved-evidence-recall",
      "retrieved-evidence-precision",
      "citation-validity",
      "correct-abstention",
      "bytes-read",
      "retrieval-calls",
      "model-calls",
      "compilation-acceptance",
      "input-tokens",
      "output-tokens",
      "reasoning-tokens",
      "latency-ms",
      "cost-usd-micros",
    ],
    evaluatorConformanceGate: {
      classification: "deterministic-conformance-only",
      minimumFixtureAgreementBasisPoints: 10_000,
      minimumRepeatabilityBasisPoints: 10_000,
      everyTaskFamilyRequired: true,
      campaignAdvancementAuthorized: false,
      independentGoldAndEvaluatorValidationRequired: true,
    },
    inferenceDesign: {
      inferenceUnit: "one-semantically-independent-paired-case",
      estimand:
        "equal-cell-weighted-discovered-minus-static-first-attempt-success-probability",
      scaleRole: "preregistered-stratum",
      clusteredScaleVariants: "reserved-for-m9d",
      stratifiedResults: "descriptive-only-no-additional-superiority-claims",
      familyScaleWeight: { numerator: 1, denominator: 24 },
    },
    powerDesign: {
      method: "exact-one-sided-conditional-mcnemar-scenario-analysis",
      independenceAssumption: "enforced-by-final-m9c-corpus-construction",
      familyAlphaBasisPoints: 500,
      targetPowerBasisPoints: 8_000,
      practicalPairedCaseCeiling: 480,
      empiricalPower: "unknown-until-development-model-discordance",
    },
    splitPolicy: {
      developmentNamespace: "m9b2-dev",
      eventualHeldoutNamespace: "m9b2-heldout",
      contentAndIdentityOverlapAllowed: false,
      taskFamilyOverlapAllowed: true,
      solutionStrategyClassOverlapAllowed: true,
      finalHeldoutCorpusMaterialized: false,
      finalCorpusIdentityFrozen: false,
    },
    authority: {
      providerAdapterCreated: false,
      liveCallsAuthorized: false,
      campaignCreated: false,
      preregistrationCreated: false,
      superiorityClaimAuthorized: false,
    },
  });
  const designDigest = await digestValue(body);
  return designDigest.ok
    ? {
        ok: true,
        value: m9b2MeasurementDesignSchema.parse({
          ...body,
          designDigest: designDigest.value,
        }),
      }
    : designDigest;
}

export async function verifyM9b2MeasurementDesign(
  value: unknown,
): Promise<Result<M9b2MeasurementDesign, Diagnostic>> {
  const parsed = m9b2MeasurementDesignSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.2 measurement design is invalid.");
  const { designDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  return digest.ok && digest.value === designDigest
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 measurement design identity is invalid.");
}

export async function auditM9b2SplitDisjointness(
  input: Readonly<{
    developmentIdentities: ReadonlyArray<unknown>;
    heldoutIdentities: ReadonlyArray<unknown>;
  }>,
): Promise<
  Result<
    Readonly<{
      developmentCount: number;
      heldoutCount: number;
      forbiddenOverlapDimensions: ReadonlyArray<string>;
      allowedOverlap: Readonly<{
        taskFamilies: ReadonlyArray<M9b2TaskFamily>;
        solutionStrategyClasses: ReadonlyArray<string>;
      }>;
      auditDigest: string;
      passed: true;
    }>,
    Diagnostic
  >
> {
  const development = m9b2SplitIdentitySchema
    .array()
    .min(1)
    .max(10_000)
    .safeParse(input.developmentIdentities);
  const heldout = m9b2SplitIdentitySchema
    .array()
    .min(1)
    .max(10_000)
    .safeParse(input.heldoutIdentities);
  if (!development.success || !heldout.success)
    return invalid("M9b.2 split identities are invalid.");
  if (
    !unique(development.data.map((identity) => identity.fixtureIdentity)) ||
    !unique(heldout.data.map((identity) => identity.fixtureIdentity))
  )
    return invalid("M9b.2 split case identities contain duplicates.");
  const scalarDimensions = [
    "fixtureIdentity",
    "exactTaskTemplateIdentity",
    "normalizedTaskTemplateIdentity",
    "corpusContentIdentity",
    "semanticContractIdentity",
  ] as const;
  for (const dimension of scalarDimensions) {
    const developmentSet = new Set(
      development.data.map((identity) => identity[dimension]),
    );
    if (
      heldout.data.some((identity) => developmentSet.has(identity[dimension]))
    )
      return invalid(
        `M9b.2 development and held-out ${dimension} values overlap.`,
      );
  }
  const vectorDimensions = [
    "entityIdentities",
    "exactRelevantFactWordingIdentities",
    "answerValueIdentities",
    "documentContentIdentities",
  ] as const;
  for (const dimension of vectorDimensions) {
    const developmentSet = new Set(
      development.data.flatMap((identity) => identity[dimension]),
    );
    if (
      heldout.data.some((identity) =>
        identity[dimension].some((digest) => developmentSet.has(digest)),
      )
    )
      return invalid(
        `M9b.2 development and held-out ${dimension} values overlap.`,
      );
  }
  const forbiddenOverlapDimensions = Object.freeze([
    "fixtureIdentity",
    "entityIdentity",
    "exactTaskTemplateIdentity",
    "normalizedTaskTemplateIdentity",
    "exactRelevantFactWordingIdentity",
    "answerValueIdentity",
    "corpusContentIdentity",
    "documentContentIdentity",
    "semanticContractIdentity",
  ] as const);
  const developmentFamilies = new Set(
    development.data.map((identity) => identity.taskFamily),
  );
  const developmentStrategies = new Set(
    development.data.map((identity) => identity.solutionStrategyClass),
  );
  const allowedOverlap = {
    taskFamilies: M9B2_TASK_FAMILIES.filter(
      (family) =>
        developmentFamilies.has(family) &&
        heldout.data.some((identity) => identity.taskFamily === family),
    ),
    solutionStrategyClasses: [
      ...new Set(
        heldout.data
          .map((identity) => identity.solutionStrategyClass)
          .filter((strategy) => developmentStrategies.has(strategy)),
      ),
    ].toSorted(),
  };
  const body = {
    protocol: "lachesis-m9b2a-split-disjointness-audit/2",
    developmentIdentities: development.data.toSorted((left, right) =>
      left.fixtureIdentity.localeCompare(right.fixtureIdentity),
    ),
    heldoutIdentities: heldout.data.toSorted((left, right) =>
      left.fixtureIdentity.localeCompare(right.fixtureIdentity),
    ),
    forbiddenOverlapDimensions,
    allowedOverlap,
    passed: true as const,
  };
  const auditDigest = await digestValue(body);
  return auditDigest.ok
    ? {
        ok: true,
        value: {
          developmentCount: development.data.length,
          heldoutCount: heldout.data.length,
          forbiddenOverlapDimensions,
          allowedOverlap,
          auditDigest: auditDigest.value,
          passed: true,
        },
      }
    : auditDigest;
}
