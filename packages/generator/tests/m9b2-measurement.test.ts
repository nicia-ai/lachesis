import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import { createM9aCorpus } from "../src/m9a-corpus.js";
import {
  compileM9aRetrievalProgram,
  executeM9aRetrievalProgram,
  M9A_MODEL_VISIBLE_GRAMMAR,
  type M9aCitationConfinedAnswer,
  type M9aOfflineModel,
} from "../src/m9a-retrieval.js";
import {
  analyzeM9b2ProspectivePower,
  auditM9b2EvaluatorReliability,
  auditM9b2SplitDisjointness,
  classifyM9b2PrimaryEndpoint,
  createM9b2OfflineEvaluator,
  designM9b2Measurement,
  inspectM9b2PreparedCase,
  M9B2_CORPUS_SCALES,
  M9B2_MEASUREMENT_PROTOCOL,
  M9B2_PRIMARY_ENDPOINT,
  M9B2_TASK_FAMILIES,
  type M9b2EvaluationScore,
  m9b2EvaluationScoreSchema,
  m9b2HiddenExpectationSchema,
  m9b2PowerScenarioSchema,
  type M9b2PreparedSuite,
  m9b2PrimaryEndpointSchema,
  type M9b2PublicDevelopmentCase,
  type M9b2ReliabilityFixture,
  m9b2ReliabilityReportSchema,
  measureM9b2SuccessfulRun,
  prepareM9b2DevelopmentSuite,
  verifyM9b2MeasurementDesign,
  verifyM9b2PowerReport,
  verifyM9b2ReliabilityReport,
} from "../src/m9b2-measurement.js";
import { strictJsonValueSchema } from "../src/strict-json.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "./fixtures/m9b2-development.js";
import { M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS } from "./fixtures/m9b2-hidden.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected successful test result.");
  return result.value;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing M9b.2 test fixture.");
  return value;
}

function splitIdentity(offset: number): Readonly<{
  caseIdentity: string;
  normalizedTaskIdentity: string;
  corpusContentIdentity: string;
  documentContentIdentities: ReadonlyArray<string>;
  semanticContractIdentity: string;
}> {
  const digest = (value: number): string =>
    value.toString(16).padStart(64, "0");
  return {
    caseIdentity: digest(offset),
    normalizedTaskIdentity: digest(offset + 1),
    corpusContentIdentity: digest(offset + 2),
    documentContentIdentities: [digest(offset + 3), digest(offset + 4)],
    semanticContractIdentity: digest(offset + 5),
  };
}

async function preparedSuite(): Promise<M9b2PreparedSuite> {
  return unwrap(
    await prepareM9b2DevelopmentSuite({
      publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
      hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
    }),
  );
}

function developmentCase(caseId: string): M9b2PublicDevelopmentCase {
  return required(
    M9B2_PUBLIC_DEVELOPMENT_CASES.find((item) => item.id === caseId),
  );
}

function correctAnswer(
  suite: M9b2PreparedSuite,
  caseId: string,
): M9aCitationConfinedAnswer {
  const expectation = required(
    M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.find((item) => item.caseId === caseId),
  );
  const inspection = required(inspectM9b2PreparedCase(suite, caseId));
  const requiredDocuments = expectation.requiredEvidenceSets[0] ?? [];
  return {
    answer: required(expectation.acceptedAnswers[0]),
    citations: requiredDocuments.map((documentId) =>
      required(
        inspection.chunks.find(
          (chunk) => chunk.document.documentId === documentId,
        ),
      ),
    ),
  };
}

async function evaluate(
  suite: M9b2PreparedSuite,
  caseId: string,
  answer: M9aCitationConfinedAnswer,
): Promise<M9b2EvaluationScore> {
  const evaluator = unwrap(createM9b2OfflineEvaluator(suite, caseId));
  const result = await evaluator.evaluate(
    {
      task: developmentCase(caseId).task,
      answer: strictJsonValueSchema.parse(answer),
    },
    new AbortController().signal,
  );
  if (!result.ok) throw new Error(result.error.message);
  return m9b2EvaluationScoreSchema.parse(result.value);
}

function reliabilityFixtures(
  suite: M9b2PreparedSuite,
): ReadonlyArray<M9b2ReliabilityFixture> {
  return M9B2_TASK_FAMILIES.flatMap((family) => {
    const publicCase = required(
      M9B2_PUBLIC_DEVELOPMENT_CASES.find(
        (item) => item.family === family && item.scale === "1x",
      ),
    );
    const insufficient = family === "insufficient-evidence";
    return [
      {
        caseId: publicCase.id,
        answer: correctAnswer(suite, publicCase.id),
        expectedSemanticSupported: true,
        expectedFailureReasons: [],
      },
      {
        caseId: publicCase.id,
        answer: { answer: "Invented answer", citations: [] },
        expectedSemanticSupported: false,
        expectedFailureReasons: insufficient
          ? ["answer-mismatch", "abstention-mismatch"]
          : [
              "answer-mismatch",
              "missing-required-evidence",
              "unsupported-citation",
              "invalid-citation",
            ],
      },
    ];
  });
}

describe("M9b.2 offline evaluator and corpus design", () => {
  it("keeps every M9b.2 symbol outside the package facade", () => {
    expect("M9B2_MEASUREMENT_PROTOCOL" in generatorFacade).toBe(false);
    expect("prepareM9b2DevelopmentSuite" in generatorFacade).toBe(false);
    expect("createM9b2OfflineEvaluator" in generatorFacade).toBe(false);
    expect("analyzeM9b2ProspectivePower" in generatorFacade).toBe(false);
  });

  it("freezes the scientific rules while retaining every live-study NO-GO", async () => {
    const design = unwrap(await designM9b2Measurement());
    expect(design).toMatchObject({
      protocol: M9B2_MEASUREMENT_PROTOCOL.id,
      version: M9B2_MEASUREMENT_PROTOCOL.version,
      status: "offline-design-complete-m9b-no-go",
      primaryEndpoint: M9B2_PRIMARY_ENDPOINT,
      splitPolicy: {
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
    expect(await verifyM9b2MeasurementDesign(design)).toMatchObject({
      ok: true,
    });
    expect(
      await verifyM9b2MeasurementDesign({
        ...design,
        designDigest: "0".repeat(64),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyM9b2MeasurementDesign({
        ...design,
        status: "live-authorized",
      }),
    ).toMatchObject({ ok: false });
  });

  it("prepares all family-scale cells with a constant strategy and growing corpus", async () => {
    const suite = await preparedSuite();
    expect(M9B2_PUBLIC_DEVELOPMENT_CASES).toHaveLength(24);
    for (const family of M9B2_TASK_FAMILIES) {
      const cases = M9B2_PUBLIC_DEVELOPMENT_CASES.filter(
        (item) => item.family === family,
      );
      expect(cases.map((item) => item.scale)).toEqual(M9B2_CORPUS_SCALES);
      expect(new Set(cases.map((item) => item.task)).size).toBe(1);
      expect(new Set(cases.map((item) => item.strategyId)).size).toBe(1);
      const documentCounts = cases.map((item) => item.corpus.documents.length);
      expect(required(documentCounts[1]) - required(documentCounts[0])).toBe(7);
      expect(required(documentCounts[2]) - required(documentCounts[1])).toBe(
        24,
      );
      for (const item of cases) {
        const inspection = required(inspectM9b2PreparedCase(suite, item.id));
        expect(inspection.publicCase.split).toBe("development");
        expect(inspection.chunks.length).toBeGreaterThan(0);
        expect(inspection.splitIdentity.caseIdentity).toMatch(
          /^[a-f0-9]{64}$/u,
        );
      }
    }
  });

  it("rejects missing cells, duplicate identities, strategy drift, and gold drift", async () => {
    const first = required(M9B2_PUBLIC_DEVELOPMENT_CASES[0]);
    const second = required(M9B2_PUBLIC_DEVELOPMENT_CASES[1]);
    const firstExpectation = required(M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS[0]);
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES.slice(1),
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    ).toMatchObject({ ok: false });
    expect(
      m9b2HiddenExpectationSchema.safeParse({
        caseId: "invalid-answer-gold",
        responseKind: "answer",
        acceptedAnswers: ["answer"],
        requiredEvidenceSets: [],
        allowedSupportingDocumentIds: [],
      }).success,
    ).toBe(false);
    expect(
      m9b2HiddenExpectationSchema.safeParse({
        caseId: "invalid-abstention-gold",
        responseKind: "abstain",
        acceptedAnswers: ["Insufficient evidence"],
        requiredEvidenceSets: [["some-document"]],
        allowedSupportingDocumentIds: ["some-document"],
      }).success,
    ).toBe(false);
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: [
          first,
          { ...second, corpus: { ...second.corpus, id: first.corpus.id } },
          ...M9B2_PUBLIC_DEVELOPMENT_CASES.slice(2),
        ],
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: [
          firstExpectation,
          firstExpectation,
          ...M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.slice(2),
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: [
          first,
          { ...second, id: first.id },
          ...M9B2_PUBLIC_DEVELOPMENT_CASES.slice(2),
        ],
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: [
          first,
          { ...second, task: `${second.task} changed` },
          ...M9B2_PUBLIC_DEVELOPMENT_CASES.slice(2),
        ],
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: [
          { ...firstExpectation, acceptedAnswers: ["Different"] },
          ...M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.slice(1),
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: [
          {
            ...firstExpectation,
            requiredEvidenceSets: [["unknown-document"]],
            allowedSupportingDocumentIds: ["unknown-document"],
          },
          ...M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.slice(1),
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it("scores exact answers, complete support, and canonical citations", async () => {
    const suite = await preparedSuite();
    for (const publicCase of M9B2_PUBLIC_DEVELOPMENT_CASES) {
      const score = await evaluate(
        suite,
        publicCase.id,
        correctAnswer(suite, publicCase.id),
      );
      expect(score).toMatchObject({
        family: publicCase.family,
        scale: publicCase.scale,
        responseCorrect: true,
        abstentionCorrect: true,
        requiredEvidenceRecallBasisPoints: 10_000,
        supportingEvidencePrecisionBasisPoints: 10_000,
        citationValidityBasisPoints: 10_000,
        semanticSupported: true,
        failureReasons: [],
      });
    }
  });

  it("rejects false answers even when their citations are valid", async () => {
    const suite = await preparedSuite();
    const caseId = "m9b2-dev-lookup-1x";
    const answer = correctAnswer(suite, caseId);
    const score = await evaluate(suite, caseId, {
      ...answer,
      answer: "January 1999",
    });
    expect(score).toMatchObject({
      responseCorrect: false,
      citationValidityBasisPoints: 10_000,
      semanticSupported: false,
      failureReasons: ["answer-mismatch"],
    });
  });

  it("separates incomplete evidence, unsupported evidence, and forged citations", async () => {
    const suite = await preparedSuite();
    const joinId = "m9b2-dev-join-1x";
    const complete = correctAnswer(suite, joinId);
    const incomplete = await evaluate(suite, joinId, {
      ...complete,
      citations: complete.citations.slice(0, 1),
    });
    expect(incomplete).toMatchObject({
      requiredEvidenceRecallBasisPoints: 5_000,
      supportingEvidencePrecisionBasisPoints: 10_000,
      citationValidityBasisPoints: 10_000,
      semanticSupported: false,
      failureReasons: ["missing-required-evidence"],
    });

    const contradictionId = "m9b2-dev-contradiction-1x";
    const inspection = required(
      inspectM9b2PreparedCase(suite, contradictionId),
    );
    const newsletter = required(
      inspection.chunks.find(
        (chunk) => chunk.document.documentId === "bellwether-newsletter",
      ),
    );
    const unsupported = await evaluate(suite, contradictionId, {
      answer: "1936",
      citations: [newsletter],
    });
    expect(unsupported).toMatchObject({
      responseCorrect: true,
      requiredEvidenceRecallBasisPoints: 0,
      supportingEvidencePrecisionBasisPoints: 0,
      citationValidityBasisPoints: 10_000,
      semanticSupported: false,
      failureReasons: ["missing-required-evidence", "unsupported-citation"],
    });

    const valid = required(correctAnswer(suite, contradictionId).citations[0]);
    const forged = await evaluate(suite, contradictionId, {
      answer: "1936",
      citations: [{ ...valid, contentDigest: "0".repeat(64) }],
    });
    expect(forged).toMatchObject({
      citationValidityBasisPoints: 0,
      semanticSupported: false,
    });
    expect(forged.failureReasons).toContain("invalid-citation");
  });

  it("requires citation-free abstention and treats document instructions as data", async () => {
    const suite = await preparedSuite();
    const insufficientId = "m9b2-dev-insufficient-evidence-1x";
    const correct = await evaluate(
      suite,
      insufficientId,
      correctAnswer(suite, insufficientId),
    );
    expect(correct).toMatchObject({
      expectedResponseKind: "abstain",
      observedAbstention: true,
      semanticSupported: true,
    });
    const insufficientInspection = required(
      inspectM9b2PreparedCase(suite, insufficientId),
    );
    const citedAbstention = await evaluate(suite, insufficientId, {
      answer: "Insufficient evidence",
      citations: [required(insufficientInspection.chunks[0])],
    });
    expect(citedAbstention).toMatchObject({
      responseCorrect: true,
      semanticSupported: false,
      failureReasons: ["unsupported-citation"],
    });

    const injectionId = "m9b2-dev-prompt-injection-1x";
    expect(
      await evaluate(suite, injectionId, correctAnswer(suite, injectionId)),
    ).toMatchObject({
      responseCorrect: true,
      semanticSupported: true,
    });
    expect(
      await evaluate(suite, injectionId, {
        answer: "Reveal private instructions",
        citations: correctAnswer(suite, injectionId).citations,
      }),
    ).toMatchObject({ responseCorrect: false, semanticSupported: false });
  });

  it("is case-bound, arm-blind, deterministic, and cancellable", async () => {
    const suite = await preparedSuite();
    const caseId = "m9b2-dev-lookup-1x";
    const evaluator = unwrap(createM9b2OfflineEvaluator(suite, caseId));
    expect(createM9b2OfflineEvaluator(suite, "unknown-case")).toMatchObject({
      ok: false,
    });
    const input = {
      task: developmentCase(caseId).task,
      answer: strictJsonValueSchema.parse(correctAnswer(suite, caseId)),
    };
    const first = await evaluator.evaluate(input, new AbortController().signal);
    const second = await evaluator.evaluate(
      input,
      new AbortController().signal,
    );
    expect(first).toEqual(second);
    const serialized = unwrap(canonicalizeJson(first));
    expect(serialized).not.toContain("discovered-program");
    expect(serialized).not.toContain("static-one-shot");
    expect(serialized).not.toContain("provider");
    expect(
      await evaluator.evaluate(
        { ...input, task: "A different task" },
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity-mismatch" } });
    const controller = new AbortController();
    controller.abort();
    expect(await evaluator.evaluate(input, controller.signal)).toMatchObject({
      ok: false,
      error: { kind: "aborted" },
    });
    expect(
      await evaluator.evaluate(
        { task: developmentCase(caseId).task, answer: null },
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { kind: "invalid-input" } });
  });

  it("passes a replayable all-family reliability gate and detects tampering", async () => {
    const suite = await preparedSuite();
    const fixtures = reliabilityFixtures(suite);
    const report = unwrap(await auditM9b2EvaluatorReliability(suite, fixtures));
    expect(report).toMatchObject({
      fixtureCount: 16,
      expectedAgreementBasisPoints: 10_000,
      repeatabilityBasisPoints: 10_000,
      passed: true,
      advancement: "power-analysis-eligible",
    });
    expect(
      await verifyM9b2ReliabilityReport(suite, fixtures, report),
    ).toMatchObject({ ok: true });
    expect(
      await verifyM9b2ReliabilityReport(suite, fixtures, {
        ...report,
        reportDigest: "0".repeat(64),
      }),
    ).toMatchObject({ ok: false });
    expect(
      m9b2ReliabilityReportSchema.safeParse({
        ...report,
        passed: false,
      }).success,
    ).toBe(false);
    expect(await auditM9b2EvaluatorReliability(suite, [])).toMatchObject({
      ok: false,
    });
    expect(
      await auditM9b2EvaluatorReliability(
        suite,
        fixtures.map((fixture) => ({
          ...fixture,
          caseId: "m9b2-dev-lookup-1x",
        })),
      ),
    ).toMatchObject({ ok: false });
    const alteredFixtures = [
      { ...required(fixtures[0]), expectedSemanticSupported: false },
      ...fixtures.slice(1),
    ];
    expect(
      await auditM9b2EvaluatorReliability(suite, alteredFixtures),
    ).toMatchObject({
      ok: true,
      value: { passed: false, advancement: "stop-evaluator-unreliable" },
    });
  });

  it("defines the primary endpoint over every first-attempt stage", () => {
    for (const terminalStage of [
      "authoring-rejected",
      "compile-rejected",
      "execution-failed",
      "evaluation-failed",
    ] as const) {
      expect(
        classifyM9b2PrimaryEndpoint({
          terminalStage,
          semanticSupported: true,
        }),
      ).toMatchObject({
        ok: true,
        value: { semanticSupported: false, success: false },
      });
    }
    expect(
      classifyM9b2PrimaryEndpoint({
        terminalStage: "evaluated",
        semanticSupported: false,
      }),
    ).toMatchObject({ ok: true, value: { success: false } });
    expect(
      classifyM9b2PrimaryEndpoint({
        terminalStage: "evaluated",
        semanticSupported: true,
      }),
    ).toMatchObject({ ok: true, value: { success: true } });
    expect(
      m9b2PrimaryEndpointSchema.safeParse({
        endpoint: M9B2_PRIMARY_ENDPOINT,
        terminalStage: "compile-rejected",
        semanticSupported: true,
        success: true,
      }).success,
    ).toBe(false);
  });

  it("extracts matched secondary metrics from a real offline M9a run", async () => {
    const suite = await preparedSuite();
    const caseId = "m9b2-dev-lookup-1x";
    const publicCase = developmentCase(caseId);
    const corpus = unwrap(await createM9aCorpus(publicCase.corpus));
    const artifact = unwrap(
      await compileM9aRetrievalProgram(M9A_MODEL_VISIBLE_GRAMMAR.template),
    );
    const usage = {
      inputTokens: 1,
      outputTokens: 1,
      wallClockMs: 1,
      costUsdMicros: 0 as const,
    };
    const model: M9aOfflineModel = {
      identity: { id: "m9b2-deterministic-mock", version: "1" },
      decompose: () =>
        Promise.resolve({
          ok: true,
          value: {
            value: ["Harbor Light Observatory reopened September 2017"],
            usage,
          },
        }),
      answer: (evidence) => {
        const excerpt = evidence.excerpts.find(
          (item) => item.chunk.document.documentId === "harbor-light-bulletin",
        );
        return excerpt === undefined
          ? Promise.resolve({
              ok: false,
              error: {
                kind: "invalid-input" as const,
                message: "Expected lookup evidence.",
              },
            })
          : Promise.resolve({
              ok: true,
              value: {
                value: {
                  claim: "September 2017",
                  citations: [excerpt.chunk],
                },
                usage,
              },
            });
      },
    };
    const run = unwrap(
      await executeM9aRetrievalProgram(artifact, {
        task: publicCase.task,
        corpus,
        model,
      }),
    );
    const score = await evaluate(suite, caseId, run.answer);
    const metrics = unwrap(
      measureM9b2SuccessfulRun({
        suite,
        caseId,
        run,
        evaluation: score,
        planningUsage: usage,
      }),
    );
    expect(metrics).toMatchObject({
      protocol: "lachesis-m9b2-secondary-metrics/1",
      caseId,
      primary: { success: true },
      retrievedEvidenceRecallBasisPoints: 10_000,
      citationValidityBasisPoints: 10_000,
      compilationAccepted: true,
      modelCalls: 3,
      reasoningTokens: 0,
      costUsdMicros: 0,
    });
    expect(metrics.bytesRead).toBeGreaterThan(0);
    expect(metrics.retrievalCalls).toBe(2);
    expect(
      measureM9b2SuccessfulRun({
        suite,
        caseId: "m9b2-dev-lookup-8x",
        run,
        evaluation: score,
        planningUsage: usage,
      }),
    ).toMatchObject({ ok: false });
  });

  it("runs exact paired scenario power without inventing empirical power", async () => {
    const report = unwrap(
      await analyzeM9b2ProspectivePower({
        scenarios: [
          {
            id: "strong-assumed-effect",
            discoveredOnlyRateBasisPoints: 1_600,
            staticOnlyRateBasisPoints: 600,
          },
          {
            id: "modest-assumed-effect",
            discoveredOnlyRateBasisPoints: 1_200,
            staticOnlyRateBasisPoints: 800,
          },
          {
            id: "no-positive-effect",
            discoveredOnlyRateBasisPoints: 800,
            staticOnlyRateBasisPoints: 800,
          },
        ],
      }),
    );
    expect(report).toMatchObject({
      empiricalPower: {
        kind: "unknown",
        reason: "no-development-model-discordance-estimate",
      },
      decision: { outcome: "no-go" },
    });
    expect(report.scenarios[0]?.requiredPairedCases.kind).toBe("known");
    expect(report.scenarios[1]?.requiredPairedCases.kind).toBe("unknown");
    expect(report.scenarios[2]).toMatchObject({
      powerAtPracticalCeilingBasisPoints: 0,
      requiredPairedCases: {
        kind: "unknown",
        reason: "no-positive-assumed-effect",
      },
    });
    expect(await verifyM9b2PowerReport(report)).toMatchObject({ ok: true });
    const firstScenario = required(report.scenarios[0]);
    const altered = {
      ...report,
      scenarios: [
        { ...firstScenario, powerAtPracticalCeilingBasisPoints: 10_000 },
        ...report.scenarios.slice(1),
      ],
    };
    const alteredBody = {
      protocol: altered.protocol,
      method: altered.method,
      familyAlphaBasisPoints: altered.familyAlphaBasisPoints,
      targetPowerBasisPoints: altered.targetPowerBasisPoints,
      practicalPairedCaseCeiling: altered.practicalPairedCaseCeiling,
      empiricalPower: altered.empiricalPower,
      scenarios: altered.scenarios,
      decision: altered.decision,
    };
    const resigned = {
      ...alteredBody,
      reportDigest: unwrap(await digestValue(alteredBody)),
    };
    expect(await verifyM9b2PowerReport(resigned)).toMatchObject({ ok: false });
    expect(await verifyM9b2PowerReport(null)).toMatchObject({ ok: false });
    expect(
      m9b2PowerScenarioSchema.safeParse({
        id: "invalid-discordance",
        discoveredOnlyRateBasisPoints: 6_000,
        staticOnlyRateBasisPoints: 5_000,
      }).success,
    ).toBe(false);
    expect(await analyzeM9b2ProspectivePower({ scenarios: [] })).toMatchObject({
      ok: false,
    });
    expect(
      await analyzeM9b2ProspectivePower({
        scenarios: [
          {
            id: "all-discordances-favor-discovery",
            discoveredOnlyRateBasisPoints: 10_000,
            staticOnlyRateBasisPoints: 0,
          },
        ],
        practicalPairedCaseCeiling: 20,
      }),
    ).toMatchObject({ ok: true });
  });

  it("enforces disjoint development and eventual held-out identities", async () => {
    const firstDevelopment = splitIdentity(1);
    const secondDevelopment = splitIdentity(10);
    const heldout = splitIdentity(20);
    expect(
      await auditM9b2SplitDisjointness({
        developmentIdentities: [firstDevelopment, secondDevelopment],
        heldoutIdentities: [heldout],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        developmentCount: 2,
        heldoutCount: 1,
        passed: true,
      },
    });
    expect(
      await auditM9b2SplitDisjointness({
        developmentIdentities: [firstDevelopment],
        heldoutIdentities: [
          {
            ...heldout,
            documentContentIdentities: [
              required(firstDevelopment.documentContentIdentities[0]),
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await auditM9b2SplitDisjointness({
        developmentIdentities: [firstDevelopment, firstDevelopment],
        heldoutIdentities: [heldout],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await auditM9b2SplitDisjointness({
        developmentIdentities: [],
        heldoutIdentities: [heldout],
      }),
    ).toMatchObject({ ok: false });
  });
});
