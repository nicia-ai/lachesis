import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  createM9aCorpus,
  inspectM9aCorpus,
  type M9aChunkIdentity,
  m9aCorpusInputSchema,
  m9aInternalInspectChunkIdentities,
  type M9aRetrievalFailure,
} from "./m9a-corpus.js";
import {
  type M9aCitationConfinedAnswer,
  m9aCitationConfinedAnswerSchema,
  type M9aModelUsage,
  m9aModelUsageSchema,
  type M9aRetrievalRun,
} from "./m9a-retrieval.js";
import type { M9b1ExternalEvaluator } from "./m9b1-discovery.js";
import { strictJsonValueSchema } from "./strict-json.js";

export const M9B2_MEASUREMENT_PROTOCOL = Object.freeze({
  id: "lachesis-m9b2-offline-scientific-measurement",
  version: "1.0.0",
  visibility: "internal-offline-development-only" as const,
  claimBoundary:
    "offline fixture, evaluator, and prospective-power validation only; no model-quality, retrieval-superiority, generalization, live-provider, or production-readiness claim",
});

export const M9B2_EVALUATOR_IDENTITY = Object.freeze({
  id: "lachesis.m9b2.offline-arm-blind-evaluator",
  version: "1.0.0-development",
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
    requiredEvidenceSets: requiredEvidenceSetSchema.array().max(4).readonly(),
    allowedSupportingDocumentIds: documentIdSetSchema,
  })
  .superRefine((expectation, context) => {
    if (
      expectation.responseKind === "answer" &&
      expectation.requiredEvidenceSets.length === 0
    )
      context.addIssue({
        code: "custom",
        message: "Answer expectations require supporting evidence.",
      });
    if (
      expectation.responseKind === "abstain" &&
      (expectation.requiredEvidenceSets.length > 0 ||
        expectation.allowedSupportingDocumentIds.length > 0)
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
    caseIdentity: digestSchema,
    normalizedTaskIdentity: digestSchema,
    corpusContentIdentity: digestSchema,
    documentContentIdentities: digestSchema.array().min(1).max(64).readonly(),
    semanticContractIdentity: digestSchema,
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
}>;

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
      requiredEvidenceSets: firstExpectation.requiredEvidenceSets,
      allowedSupportingDocumentIds:
        firstExpectation.allowedSupportingDocumentIds,
    };
    for (const item of familyCases) {
      const expectation = expectationsByCase.get(item.id);
      if (
        expectation === undefined ||
        !canonicalEqual(expectationBody, {
          responseKind: expectation.responseKind,
          acceptedAnswers: expectation.acceptedAnswers,
          requiredEvidenceSets: expectation.requiredEvidenceSets,
          allowedSupportingDocumentIds:
            expectation.allowedSupportingDocumentIds,
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
    const documentIds = publicCase.corpus.documents.map(
      (document) => document.id,
    );
    const referencedIds = [
      ...expectation.allowedSupportingDocumentIds,
      ...expectation.requiredEvidenceSets.flat(),
    ];
    const evidenceSetIdentities = expectation.requiredEvidenceSets.map((set) =>
      [...set].toSorted().join("\u0000"),
    );
    if (
      !unique(expectation.acceptedAnswers.map(normalizedAnswer)) ||
      !unique(expectation.allowedSupportingDocumentIds) ||
      !unique(evidenceSetIdentities) ||
      expectation.requiredEvidenceSets.some((set) => !unique(set)) ||
      referencedIds.some((id) => !documentIds.includes(id)) ||
      expectation.requiredEvidenceSets.some((set) =>
        set.some(
          (id) => !expectation.allowedSupportingDocumentIds.includes(id),
        ),
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
    const caseIdentity = await digestValue({
      id: publicCase.id,
      split: publicCase.split,
      family: publicCase.family,
      scale: publicCase.scale,
      strategyId: publicCase.strategyId,
    });
    const normalizedTaskIdentity = await digestValue(
      normalizedAnswer(publicCase.task),
    );
    const documentContentResults = await Promise.all(
      publicCase.corpus.documents.map((document) => digestValue(document.text)),
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
      requiredEvidenceSets: expectation.requiredEvidenceSets,
      allowedSupportingDocumentIds: expectation.allowedSupportingDocumentIds,
    });
    if (
      !caseIdentity.ok ||
      !normalizedTaskIdentity.ok ||
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
          caseIdentity: caseIdentity.value,
          normalizedTaskIdentity: normalizedTaskIdentity.value,
          corpusContentIdentity: corpusContentIdentity.value,
          documentContentIdentities: sortedDocumentContentIdentities,
          semanticContractIdentity: semanticContractIdentity.value,
        }),
        snapshotDigest: snapshot.snapshotDigest,
        chunksById: new Map(chunks.map((chunk) => [chunk.id, chunk])),
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

function scoreEvidence(
  expectation: M9b2HiddenExpectation,
  citedDocumentIds: ReadonlySet<string>,
): Readonly<{ recall: number; precision: number }> {
  const recall =
    expectation.requiredEvidenceSets.length === 0
      ? 10_000
      : Math.max(
          ...expectation.requiredEvidenceSets.map((set) =>
            basisPoints(
              set.filter((documentId) => citedDocumentIds.has(documentId))
                .length,
              set.length,
            ),
          ),
        );
  const precision =
    citedDocumentIds.size === 0
      ? expectation.responseKind === "abstain"
        ? 10_000
        : 0
      : basisPoints(
          [...citedDocumentIds].filter((documentId) =>
            expectation.allowedSupportingDocumentIds.includes(documentId),
          ).length,
          citedDocumentIds.size,
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
  const citedDocumentIds = new Set(
    validCitations.map((citation) => citation.document.documentId),
  );
  const evidence = scoreEvidence(prepared.expectation, citedDocumentIds);
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

export const m9b2ReliabilityFixtureSchema = z
  .strictObject({
    caseId: identifierSchema,
    answer: m9aCitationConfinedAnswerSchema,
    expectedSemanticSupported: z.boolean(),
    expectedFailureReasons: evaluatorFailureReasonSchema.array().readonly(),
  })
  .readonly();
export type M9b2ReliabilityFixture = z.infer<
  typeof m9b2ReliabilityFixtureSchema
>;

export const m9b2ReliabilityReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b2-evaluator-reliability/1"),
    fixtureCount: z.number().int().positive(),
    coveredFamilies: m9b2TaskFamilySchema.array().length(8).readonly(),
    expectedAgreementBasisPoints: z.number().int().min(0).max(10_000),
    repeatabilityBasisPoints: z.number().int().min(0).max(10_000),
    passed: z.boolean(),
    advancement: z.enum([
      "power-analysis-eligible",
      "stop-evaluator-unreliable",
    ]),
    reportDigest: digestSchema,
  })
  .superRefine((report, context) => {
    const passed =
      report.expectedAgreementBasisPoints === 10_000 &&
      report.repeatabilityBasisPoints === 10_000;
    if (
      report.passed !== passed ||
      report.advancement !==
        (passed ? "power-analysis-eligible" : "stop-evaluator-unreliable")
    )
      context.addIssue({
        code: "custom",
        message: "M9b.2 reliability decision is inconsistent with its gates.",
      });
  })
  .readonly();
export type M9b2ReliabilityReport = z.infer<typeof m9b2ReliabilityReportSchema>;

export async function auditM9b2EvaluatorReliability(
  suite: M9b2PreparedSuite,
  values: ReadonlyArray<unknown>,
): Promise<Result<M9b2ReliabilityReport, Diagnostic>> {
  const fixtures = m9b2ReliabilityFixtureSchema
    .array()
    .min(16)
    .safeParse(values);
  const stored = suites.get(suite);
  if (!fixtures.success || stored === undefined)
    return invalid("M9b.2 evaluator reliability fixtures are invalid.");
  let agreements = 0;
  let repeats = 0;
  const covered = new Set<M9b2TaskFamily>();
  for (const fixture of fixtures.data) {
    const prepared = stored.cases.get(fixture.caseId);
    if (prepared === undefined)
      return invalid("M9b.2 reliability fixture references an unknown case.");
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
    return invalid("M9b.2 reliability fixtures must cover every task family.");
  const expectedAgreementBasisPoints = basisPoints(
    agreements,
    fixtures.data.length,
  );
  const repeatabilityBasisPoints = basisPoints(repeats, fixtures.data.length);
  const passed =
    expectedAgreementBasisPoints === 10_000 &&
    repeatabilityBasisPoints === 10_000;
  const body = {
    protocol: "lachesis-m9b2-evaluator-reliability/1" as const,
    fixtureCount: fixtures.data.length,
    coveredFamilies,
    expectedAgreementBasisPoints,
    repeatabilityBasisPoints,
    passed,
    advancement: passed
      ? ("power-analysis-eligible" as const)
      : ("stop-evaluator-unreliable" as const),
  };
  const reportDigest = await digestValue(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b2ReliabilityReportSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function verifyM9b2ReliabilityReport(
  suite: M9b2PreparedSuite,
  fixtures: ReadonlyArray<unknown>,
  value: unknown,
): Promise<Result<M9b2ReliabilityReport, Diagnostic>> {
  const parsed = m9b2ReliabilityReportSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.2 reliability report is invalid.");
  const recomputed = await auditM9b2EvaluatorReliability(suite, fixtures);
  return recomputed.ok && canonicalEqual(recomputed.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 reliability report does not replay from its fixtures.");
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

export const m9b2RunMetricsSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b2-secondary-metrics/1"),
    caseId: identifierSchema,
    primary: m9b2PrimaryEndpointSchema,
    retrievedEvidenceRecallBasisPoints: z.number().int().min(0).max(10_000),
    retrievedEvidencePrecisionBasisPoints: z.number().int().min(0).max(10_000),
    citationValidityBasisPoints: z.number().int().min(0).max(10_000),
    bytesRead: z.number().int().nonnegative(),
    retrievalCalls: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    compilationAccepted: z.literal(true),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.literal(0),
    latencyMs: z.number().int().nonnegative(),
    costUsdMicros: z.literal(0),
  })
  .readonly();
export type M9b2RunMetrics = z.infer<typeof m9b2RunMetricsSchema>;

/** Extracts secondary metrics from a successful M9a run plus its planning receipt. */
export function measureM9b2SuccessfulRun(
  input: Readonly<{
    suite: M9b2PreparedSuite;
    caseId: string;
    run: M9aRetrievalRun;
    evaluation: M9b2EvaluationScore;
    planningUsage: M9aModelUsage;
  }>,
): Result<M9b2RunMetrics, Diagnostic> {
  const prepared = suites.get(input.suite)?.cases.get(input.caseId);
  const planningUsage = m9aModelUsageSchema.safeParse(input.planningUsage);
  const evaluation = m9b2EvaluationScoreSchema.safeParse(input.evaluation);
  if (
    prepared === undefined ||
    !planningUsage.success ||
    !evaluation.success ||
    evaluation.data.caseId !== input.caseId ||
    input.run.transcript.corpusSnapshotDigest !== prepared.snapshotDigest
  )
    return invalid("M9b.2 run metrics are cross-bound or invalid.");
  const readDocumentIds = new Set(
    input.run.visibility.readResults.flatMap((result) =>
      result.excerpts.map((excerpt) => excerpt.chunk.document.documentId),
    ),
  );
  const retrieved = scoreEvidence(prepared.expectation, readDocumentIds);
  const primary = classifyM9b2PrimaryEndpoint({
    terminalStage: "evaluated",
    semanticSupported: evaluation.data.semanticSupported,
  });
  if (!primary.ok) return primary;
  const usage = input.run.transcript.retrievalUsage;
  const parsed = m9b2RunMetricsSchema.safeParse({
    protocol: "lachesis-m9b2-secondary-metrics/1",
    caseId: input.caseId,
    primary: primary.value,
    retrievedEvidenceRecallBasisPoints: retrieved.recall,
    retrievedEvidencePrecisionBasisPoints: retrieved.precision,
    citationValidityBasisPoints: evaluation.data.citationValidityBasisPoints,
    bytesRead: usage.readBytes,
    retrievalCalls: usage.searchCalls + usage.readCalls,
    modelCalls: 1 + usage.rootModelCalls + usage.leafModelCalls,
    compilationAccepted: true,
    inputTokens: planningUsage.data.inputTokens + usage.inputTokens,
    outputTokens: planningUsage.data.outputTokens + usage.outputTokens,
    reasoningTokens: 0,
    latencyMs:
      planningUsage.data.wallClockMs +
      input.run.transcript.runtimeUsage.wallClockMs,
    costUsdMicros: 0,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : invalid("M9b.2 run metrics could not be constructed.");
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
    protocol: z.literal("lachesis-m9b2-prospective-paired-power/1"),
    method: z.literal("exact-one-sided-conditional-mcnemar-scenario-analysis"),
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
    protocol: "lachesis-m9b2-prospective-paired-power/1" as const,
    method: "exact-one-sided-conditional-mcnemar-scenario-analysis" as const,
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
      "exact-accepted-answer-or-abstention-plus-complete-valid-support/1",
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
    reliabilityGate: z
      .strictObject({
        minimumFixtureAgreementBasisPoints: z.literal(10_000),
        minimumRepeatabilityBasisPoints: z.literal(10_000),
        everyTaskFamilyRequired: z.literal(true),
      })
      .readonly(),
    powerDesign: z
      .strictObject({
        method: z.literal(
          "exact-one-sided-conditional-mcnemar-scenario-analysis",
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
      "exact-accepted-answer-or-abstention-plus-complete-valid-support/1",
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
    reliabilityGate: {
      minimumFixtureAgreementBasisPoints: 10_000,
      minimumRepeatabilityBasisPoints: 10_000,
      everyTaskFamilyRequired: true,
    },
    powerDesign: {
      method: "exact-one-sided-conditional-mcnemar-scenario-analysis",
      familyAlphaBasisPoints: 500,
      targetPowerBasisPoints: 8_000,
      practicalPairedCaseCeiling: 480,
      empiricalPower: "unknown-until-development-model-discordance",
    },
    splitPolicy: {
      developmentNamespace: "m9b2-dev",
      eventualHeldoutNamespace: "m9b2-heldout",
      contentAndIdentityOverlapAllowed: false,
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
      dimensions: ReadonlyArray<
        | "caseIdentity"
        | "normalizedTaskIdentity"
        | "corpusContentIdentity"
        | "documentContentIdentity"
        | "semanticContractIdentity"
      >;
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
    !unique(development.data.map((identity) => identity.caseIdentity)) ||
    !unique(heldout.data.map((identity) => identity.caseIdentity))
  )
    return invalid("M9b.2 split case identities contain duplicates.");
  const scalarDimensions = [
    "caseIdentity",
    "normalizedTaskIdentity",
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
  const developmentDocuments = new Set(
    development.data.flatMap((identity) => identity.documentContentIdentities),
  );
  if (
    heldout.data.some((identity) =>
      identity.documentContentIdentities.some((digest) =>
        developmentDocuments.has(digest),
      ),
    )
  )
    return invalid("M9b.2 development and held-out document content overlaps.");
  const dimensions = Object.freeze([
    "caseIdentity",
    "normalizedTaskIdentity",
    "corpusContentIdentity",
    "documentContentIdentity",
    "semanticContractIdentity",
  ] as const);
  const body = {
    protocol: "lachesis-m9b2-split-disjointness-audit/1",
    developmentIdentities: development.data.toSorted((left, right) =>
      left.caseIdentity.localeCompare(right.caseIdentity),
    ),
    heldoutIdentities: heldout.data.toSorted((left, right) =>
      left.caseIdentity.localeCompare(right.caseIdentity),
    ),
    dimensions,
    passed: true as const,
  };
  const auditDigest = await digestValue(body);
  return auditDigest.ok
    ? {
        ok: true,
        value: {
          developmentCount: development.data.length,
          heldoutCount: heldout.data.length,
          dimensions,
          auditDigest: auditDigest.value,
          passed: true,
        },
      }
    : auditDigest;
}
