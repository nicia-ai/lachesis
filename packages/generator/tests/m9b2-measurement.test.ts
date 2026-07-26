import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import { createM9aCorpus, inspectM9aCorpus } from "../src/m9a-corpus.js";
import {
  M9A_MODEL_VISIBLE_GRAMMAR,
  type M9aCitationConfinedAnswer,
} from "../src/m9a-retrieval.js";
import type {
  M9b0BoundModelRequest,
  M9b0OfflineModel,
} from "../src/m9b0-comparison.js";
import {
  createM9b1ArmStore,
  type M9b1AtomicPersistence,
  type M9b1AuthoringModel,
  type M9b1ExternalEvaluator,
  m9b1InternalArmRecordSchema,
  m9b1InternalVerifyTerminalRecord,
  runM9b1OfflineProgramDiscovery,
} from "../src/m9b1-discovery.js";
import {
  analyzeM9b2ProspectivePower,
  auditM9b2EvaluatorConformance,
  auditM9b2SplitDisjointness,
  auditM9cInferenceUnits,
  classifyM9b2PrimaryEndpoint,
  createM9b2OfflineEvaluator,
  designM9b2Measurement,
  inspectM9b2PreparedCase,
  loadM9b2MeasurementSnapshot,
  M9B2_CORPUS_SCALES,
  M9B2_EVALUATOR_IDENTITY,
  M9B2_MEASUREMENT_PROTOCOL,
  M9B2_PRIMARY_ENDPOINT,
  M9B2_TASK_FAMILIES,
  type M9b2EvaluationScore,
  m9b2EvaluationScoreSchema,
  type M9b2EvaluatorConformanceFixture,
  m9b2EvaluatorConformanceReportSchema,
  m9b2HiddenExpectationSchema,
  m9b2InternalInspectSupportingFacts,
  m9b2PowerScenarioSchema,
  type M9b2PreparedSuite,
  m9b2PrimaryEndpointSchema,
  type M9b2PublicDevelopmentCase,
  type M9cPairedMeasurementVerification,
  measureM9b2VerifiedTerminalRecord,
  prepareM9b2DevelopmentSuite,
  reportM9cPairedDescriptives,
  serializeM9b2MeasurementSnapshot,
  verifyM9b2EvaluatorConformanceReport,
  verifyM9b2MeasurementDesign,
  verifyM9b2PowerReport,
  verifyM9b2SplitDisjointnessAudit,
  verifyM9b2TerminalMeasurementRecord,
  verifyM9cPairedDescriptiveReport,
} from "../src/m9b2-measurement.js";
import { strictJsonValueSchema } from "../src/strict-json.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "./fixtures/m9b2-development.js";
import { M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS } from "./fixtures/m9b2-hidden.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(
      `Expected successful test result: ${JSON.stringify(result.error)}`,
    );
  return result.value;
}

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing M9b.2 test fixture.");
  return value;
}

function splitIdentity(offset: number): Readonly<{
  fixtureIdentity: string;
  entityIdentities: ReadonlyArray<string>;
  sourceLineageIdentities: ReadonlyArray<string>;
  exactTaskTemplateIdentity: string;
  normalizedTaskTemplateIdentity: string;
  exactRelevantFactWordingIdentities: ReadonlyArray<string>;
  answerValueIdentities: ReadonlyArray<string>;
  corpusContentIdentity: string;
  documentContentIdentities: ReadonlyArray<string>;
  semanticContractIdentity: string;
  taskFamily: "lookup";
  solutionStrategyClass: string;
}> {
  const digest = (value: number): string =>
    value.toString(16).padStart(64, "0");
  return {
    fixtureIdentity: digest(offset),
    entityIdentities: [digest(offset + 1)],
    sourceLineageIdentities: [digest(offset + 10)],
    exactTaskTemplateIdentity: digest(offset + 2),
    normalizedTaskTemplateIdentity: digest(offset + 3),
    exactRelevantFactWordingIdentities: [digest(offset + 4)],
    answerValueIdentities: [digest(offset + 5)],
    corpusContentIdentity: digest(offset + 6),
    documentContentIdentities: [digest(offset + 7), digest(offset + 8)],
    semanticContractIdentity: digest(offset + 9),
    taskFamily: "lookup",
    solutionStrategyClass: "shared-lookup-strategy",
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

async function independentPreparedSuite(
  waves = 1,
): Promise<
  Readonly<{ suite: M9b2PreparedSuite; caseIds: ReadonlyArray<string> }>
> {
  const expectationsById = new Map(
    M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.map((expectation) => [
      expectation.caseId,
      expectation,
    ]),
  );
  const publicCases = Array.from({ length: waves }, (_value, wave) =>
    M9B2_PUBLIC_DEVELOPMENT_CASES.map((publicCase) => ({
      ...publicCase,
      id: `${publicCase.id}-wave-${String(wave + 1)}`,
      task: `${publicCase.task} Lineage ${publicCase.id} wave ${String(wave + 1)}.`,
      corpus: {
        ...publicCase.corpus,
        id: `${publicCase.corpus.id}-wave-${String(wave + 1)}`,
      },
    })),
  ).flat();
  const suite = unwrap(
    await prepareM9b2DevelopmentSuite({
      publicCases,
      hiddenExpectations: publicCases.map((publicCase, index) => {
        const original = required(M9B2_PUBLIC_DEVELOPMENT_CASES[index % 24]);
        const expectation = required(expectationsById.get(original.id));
        return {
          ...expectation,
          caseId: publicCase.id,
          normalizedTaskTemplate: `${expectation.normalizedTaskTemplate} lineage-${publicCase.id}`,
          entityLineageIds: expectation.entityLineageIds.map(
            (identity) => `${identity}-${publicCase.id}`,
          ),
          sourceLineageIds: expectation.sourceLineageIds.map(
            (identity) => `${identity}-${publicCase.id}`,
          ),
          supportingFacts: expectation.supportingFacts.map((fact) => ({
            ...fact,
            sourceLineageId: `${fact.sourceLineageId}-${publicCase.id}`,
          })),
        };
      }),
    }),
  );
  return Object.freeze({
    suite,
    caseIds: Object.freeze(publicCases.map((publicCase) => publicCase.id)),
  });
}

async function disjointPreparedSuite(
  lineage: string,
): Promise<
  Readonly<{ suite: M9b2PreparedSuite; caseIds: ReadonlyArray<string> }>
> {
  const expectationsById = new Map(
    M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.map((expectation) => [
      expectation.caseId,
      expectation,
    ]),
  );
  const publicCases = M9B2_PUBLIC_DEVELOPMENT_CASES.map((publicCase) => {
    const expectation = required(expectationsById.get(publicCase.id));
    return {
      ...publicCase,
      id: `${publicCase.id}-${lineage}`,
      task: `${publicCase.task} ${lineage}.`,
      corpus: {
        ...publicCase.corpus,
        id: `${publicCase.corpus.id}-${lineage}`,
        documents: publicCase.corpus.documents.map((document) => {
          const facts = expectation.supportingFacts.filter(
            (fact) => fact.documentId === document.id,
          );
          const text = facts.reduce(
            (current, fact) =>
              current.replace(fact.exactText, `${fact.exactText} ${lineage}`),
            document.text,
          );
          return {
            ...document,
            title: `${document.title} ${lineage}`,
            text: `${text} ${lineage}-content`,
          };
        }),
      },
    };
  });
  const suite = unwrap(
    await prepareM9b2DevelopmentSuite({
      publicCases,
      hiddenExpectations: publicCases.map((publicCase, index) => {
        const original = required(M9B2_PUBLIC_DEVELOPMENT_CASES[index]);
        const expectation = required(expectationsById.get(original.id));
        return {
          ...expectation,
          caseId: publicCase.id,
          acceptedAnswers: expectation.acceptedAnswers.map(
            (answer) => `${answer} ${lineage}`,
          ),
          normalizedTaskTemplate: `${expectation.normalizedTaskTemplate} ${lineage}`,
          entityLineageIds: expectation.entityLineageIds.map(
            (identity) => `${identity}-${lineage}`,
          ),
          sourceLineageIds: expectation.sourceLineageIds.map(
            (identity) => `${identity}-${lineage}`,
          ),
          supportingFacts: expectation.supportingFacts.map((fact) => ({
            ...fact,
            sourceLineageId: `${fact.sourceLineageId}-${lineage}`,
            exactText: `${fact.exactText} ${lineage}`,
          })),
        };
      }),
    }),
  );
  return Object.freeze({
    suite,
    caseIds: Object.freeze(publicCases.map((publicCase) => publicCase.id)),
  });
}

function memoryArmPersistence(): M9b1AtomicPersistence {
  let content: string | undefined;
  let revision = 0;
  return {
    read: () =>
      Promise.resolve({
        ok: true,
        value:
          content === undefined
            ? undefined
            : { revision: String(revision), content },
      }),
    writeAtomic: ({ expectedRevision, content: next }) => {
      const expected = content === undefined ? null : String(revision);
      if (expectedRevision !== expected)
        throw new Error("Unexpected M9b.2 fixture revision.");
      content = next;
      revision += 1;
      return Promise.resolve({
        ok: true,
        value: { revision: String(revision) },
      });
    },
  };
}

function authoredModel(
  arm: "discovered-program" | "static-one-shot",
  source: string = M9A_MODEL_VISIBLE_GRAMMAR.template,
): M9b1AuthoringModel {
  return {
    identity: { id: "m9b2-offline-model", version: "1" },
    complete: (request) => {
      const output =
        arm === "discovered-program"
          ? { source }
          : { query: "Harbor Light Observatory reopened visitors" };
      const serialized = unwrap(canonicalizeJson(output));
      return Promise.resolve({
        ok: true,
        value: {
          output,
          usage: {
            inputTokens: request.reservation.inputTokens,
            outputTokens: new TextEncoder().encode(serialized).byteLength,
            wallClockMs: 1,
            costUsdMicros: 0,
          },
        },
      });
    },
  };
}

function executionModel(
  citation: M9aCitationConfinedAnswer["citations"][number],
  fail = false,
): M9b0OfflineModel {
  return {
    identity: { id: "m9b2-offline-model", version: "1" },
    complete: (request: M9b0BoundModelRequest) => {
      if (fail)
        return Promise.resolve({
          ok: false,
          error: {
            kind: "invalid-input" as const,
            message: "Injected execution failure.",
          },
        });
      const output =
        request.phase === "decompose"
          ? ["Harbor Light Observatory reopened visitors"]
          : { claim: "September 2017", citations: [citation] };
      const serialized = unwrap(canonicalizeJson(output));
      return Promise.resolve({
        ok: true,
        value: {
          output,
          usage: {
            inputTokens: request.reservation.inputTokens,
            outputTokens: new TextEncoder().encode(serialized).byteLength,
            wallClockMs: 1,
            costUsdMicros: 0,
          },
        },
      });
    },
  };
}

type EffectCounter = { modelCalls: number; evaluatorCalls: number };

async function pairedMeasurementVerifications(
  suite: M9b2PreparedSuite,
  caseIds: ReadonlyArray<string>,
  counter: EffectCounter,
): Promise<ReadonlyArray<M9cPairedMeasurementVerification>> {
  const fallbackCitation = required(
    required(
      m9b2InternalInspectSupportingFacts(suite, required(caseIds[0])),
    )[0],
  ).chunk;
  return Promise.all(
    caseIds.map(async (caseId) => {
      const inspection = required(inspectM9b2PreparedCase(suite, caseId));
      const corpus = unwrap(
        await createM9aCorpus(inspection.publicCase.corpus),
      );
      const snapshot = required(inspectM9aCorpus(corpus));
      const countedAuthoring = (
        arm: "discovered-program" | "static-one-shot",
      ): M9b1AuthoringModel => {
        const base = authoredModel(arm);
        return {
          ...base,
          complete: (request, signal) => {
            counter.modelCalls += 1;
            return base.complete(request, signal);
          },
        };
      };
      const countedExecution = (): M9b0OfflineModel => {
        const base = executionModel(fallbackCitation, true);
        return {
          ...base,
          complete: (request, signal) => {
            counter.modelCalls += 1;
            return base.complete(request, signal);
          },
        };
      };
      const countedEvaluator = (): M9b1ExternalEvaluator => {
        const base = unwrap(createM9b2OfflineEvaluator(suite, caseId));
        return {
          ...base,
          evaluate: (input, signal) => {
            counter.evaluatorCalls += 1;
            return base.evaluate(input, signal);
          },
        };
      };
      const comparison = unwrap(
        await runM9b1OfflineProgramDiscovery({
          corpus,
          task: inspection.publicCase.task,
          model: { id: "m9b2-offline-model", version: "1" },
          authoringSessionFactories: {
            discoveredProgram: () => countedAuthoring("discovered-program"),
            staticQuery: () => countedAuthoring("static-one-shot"),
          },
          executionSessionFactories: {
            discoveredProgram: () => countedExecution(),
            staticQuery: () => countedExecution(),
          },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          evaluatorSessionFactories: {
            discoveredProgram: () => countedEvaluator(),
            staticQuery: () => countedEvaluator(),
          },
          executionOrder: "discovered-first",
          store: createM9b1ArmStore(memoryArmPersistence()),
        }),
      );
      const taskDigest = unwrap(await digestValue(inspection.publicCase.task));
      const verification = async (
        arm: typeof comparison.discovered,
        expectedArm: "discovered-program" | "static-one-shot",
      ) => {
        const response = required(arm.record.authoringResponse);
        const programIdentity =
          response.kind === "program"
            ? response.sourceDigest
            : response.derivedSourceDigest;
        const verifiedRecord = unwrap(
          await m9b1InternalVerifyTerminalRecord(arm.record, {
            task: inspection.publicCase.task,
            taskDigest,
            corpusSnapshotDigest: snapshot.snapshotDigest,
            model: { id: "m9b2-offline-model", version: "1" },
            evaluator: M9B2_EVALUATOR_IDENTITY,
            executionOrder: "discovered-first",
          }),
        );
        return {
          suite,
          caseId,
          verifiedRecord,
          expected: {
            arm: expectedArm,
            sourceArmRecordDigest: arm.record.recordDigest,
            comparisonDigest: comparison.comparisonDigest,
            model: { id: "m9b2-offline-model", version: "1" },
            evaluator: M9B2_EVALUATOR_IDENTITY,
            programIdentity,
          },
        } as const;
      };
      return {
        caseId,
        discovered: await verification(
          comparison.discovered,
          "discovered-program",
        ),
        static: await verification(comparison.staticControl, "static-one-shot"),
      };
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
  const supportingFacts = required(
    m9b2InternalInspectSupportingFacts(suite, caseId),
  );
  const requiredFacts = expectation.requiredSupportingFactSets[0] ?? [];
  return {
    answer: required(expectation.acceptedAnswers[0]),
    citations: requiredFacts.map(
      (factId) =>
        required(supportingFacts.find((fact) => fact.factId === factId)).chunk,
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
): ReadonlyArray<M9b2EvaluatorConformanceFixture> {
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
    expect("measureM9b2VerifiedTerminalRecord" in generatorFacade).toBe(false);
    expect("auditM9cInferenceUnits" in generatorFacade).toBe(false);
    expect("verifyM9cPairedDescriptiveReport" in generatorFacade).toBe(false);
    expect("verifyM9b2SplitDisjointnessAudit" in generatorFacade).toBe(false);
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
        expect(inspection.splitIdentity.fixtureIdentity).toMatch(
          /^[a-f0-9]{64}$/u,
        );
      }
    }
  });

  it("rejects invalid taxonomy while permitting independent problems across scale", async () => {
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
        requiredSupportingFactSets: [],
        allowedSupportingFactIds: [],
        supportingFacts: [],
      }).success,
    ).toBe(false);
    expect(
      m9b2HiddenExpectationSchema.safeParse({
        caseId: "invalid-abstention-gold",
        responseKind: "abstain",
        acceptedAnswers: ["Insufficient evidence"],
        requiredSupportingFactSets: [["some-fact"]],
        allowedSupportingFactIds: ["some-fact"],
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
    ).toMatchObject({ ok: true });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: [
          { ...firstExpectation, acceptedAnswers: ["Different"] },
          ...M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.slice(1),
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: [
          {
            ...firstExpectation,
            requiredSupportingFactSets: [["unknown-fact"]],
            allowedSupportingFactIds: ["unknown-fact"],
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

  it("gives no evidence credit to an irrelevant chunk in the correct document", async () => {
    const padding = "Irrelevant observatory background. ".repeat(40);
    const publicCases = M9B2_PUBLIC_DEVELOPMENT_CASES.map((item) =>
      item.family !== "lookup"
        ? item
        : {
            ...item,
            corpus: {
              ...item.corpus,
              documents: item.corpus.documents.map((document) =>
                document.id === "harbor-light-bulletin"
                  ? { ...document, text: `${padding}${document.text}` }
                  : document,
              ),
            },
          },
    );
    const suite = unwrap(
      await prepareM9b2DevelopmentSuite({
        publicCases,
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    );
    const caseId = "m9b2-dev-lookup-1x";
    const inspection = required(inspectM9b2PreparedCase(suite, caseId));
    const relevantChunk = required(
      required(m9b2InternalInspectSupportingFacts(suite, caseId))[0],
    ).chunk;
    const irrelevantChunk = required(
      inspection.chunks.find(
        (chunk) =>
          chunk.document.documentId === relevantChunk.document.documentId &&
          chunk.id !== relevantChunk.id,
      ),
    );
    expect(
      await evaluate(suite, caseId, {
        answer: "September 2017",
        citations: [irrelevantChunk],
      }),
    ).toMatchObject({
      responseCorrect: true,
      requiredEvidenceRecallBasisPoints: 0,
      supportingEvidencePrecisionBasisPoints: 0,
      semanticSupported: false,
      failureReasons: ["missing-required-evidence", "unsupported-citation"],
    });
    expect(
      await evaluate(suite, caseId, {
        answer: "September 2017",
        citations: [relevantChunk],
      }),
    ).toMatchObject({ semanticSupported: true });
    const irrelevantChunks = inspection.chunks.filter(
      (chunk) =>
        chunk.document.documentId === relevantChunk.document.documentId &&
        chunk.id !== relevantChunk.id,
    );
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: irrelevantChunks.length - 1 }),
        async (index) => {
          const score = await evaluate(suite, caseId, {
            answer: "September 2017",
            citations: [required(irrelevantChunks[index])],
          });
          expect(score.requiredEvidenceRecallBasisPoints).toBe(0);
          expect(score.supportingEvidencePrecisionBasisPoints).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
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

  it("passes deterministic evaluator conformance without authorizing advancement", async () => {
    const suite = await preparedSuite();
    const fixtures = reliabilityFixtures(suite);
    const report = unwrap(await auditM9b2EvaluatorConformance(suite, fixtures));
    expect(report).toMatchObject({
      fixtureCount: 16,
      expectedAgreementBasisPoints: 10_000,
      repeatabilityBasisPoints: 10_000,
      passed: true,
      classification: "deterministic-evaluator-conformance-only",
      campaignAdvancementAuthorized: false,
    });
    expect(
      await verifyM9b2EvaluatorConformanceReport(suite, fixtures, report),
    ).toMatchObject({ ok: true });
    expect(
      await verifyM9b2EvaluatorConformanceReport(suite, fixtures, {
        ...report,
        reportDigest: "0".repeat(64),
      }),
    ).toMatchObject({ ok: false });
    expect(
      m9b2EvaluatorConformanceReportSchema.safeParse({
        ...report,
        passed: false,
      }).success,
    ).toBe(false);
    expect(await auditM9b2EvaluatorConformance(suite, [])).toMatchObject({
      ok: false,
    });
    expect(
      await auditM9b2EvaluatorConformance(
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
      await auditM9b2EvaluatorConformance(suite, alteredFixtures),
    ).toMatchObject({
      ok: true,
      value: { passed: false, campaignAdvancementAuthorized: false },
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

  it("derives a replay-bound terminal measurement with zero external effects", async () => {
    const suite = await preparedSuite();
    const caseId = "m9b2-dev-lookup-1x";
    const publicCase = developmentCase(caseId);
    const corpus = unwrap(await createM9aCorpus(publicCase.corpus));
    const snapshot = required(inspectM9aCorpus(corpus));
    const citation = required(
      required(m9b2InternalInspectSupportingFacts(suite, caseId))[0],
    ).chunk;
    let evaluatorCalls = 0;
    const evaluatorFactory = (): M9b1ExternalEvaluator => {
      const base = unwrap(createM9b2OfflineEvaluator(suite, caseId));
      return {
        ...base,
        evaluate: (input, signal) => {
          evaluatorCalls += 1;
          return base.evaluate(input, signal);
        },
      };
    };
    const comparison = unwrap(
      await runM9b1OfflineProgramDiscovery({
        corpus,
        task: publicCase.task,
        model: { id: "m9b2-offline-model", version: "1" },
        authoringSessionFactories: {
          discoveredProgram: () => authoredModel("discovered-program"),
          staticQuery: () => authoredModel("static-one-shot"),
        },
        executionSessionFactories: {
          discoveredProgram: () => executionModel(citation),
          staticQuery: () => executionModel(citation),
        },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        evaluatorSessionFactories: {
          discoveredProgram: () => evaluatorFactory(),
          staticQuery: () => evaluatorFactory(),
        },
        executionOrder: "discovered-first",
        store: createM9b1ArmStore(memoryArmPersistence()),
      }),
    );
    const arm = comparison.discovered;
    const taskDigest = unwrap(await digestValue(publicCase.task));
    const verified = unwrap(
      await m9b1InternalVerifyTerminalRecord(arm.record, {
        task: publicCase.task,
        taskDigest,
        corpusSnapshotDigest: snapshot.snapshotDigest,
        model: { id: "m9b2-offline-model", version: "1" },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        executionOrder: "discovered-first",
      }),
    );
    const response = required(arm.record.authoringResponse);
    if (response.kind !== "program") throw new Error("Expected program arm.");
    const callsBeforeMeasurement = evaluatorCalls;
    const measured = unwrap(
      await measureM9b2VerifiedTerminalRecord({
        suite,
        caseId,
        verifiedRecord: verified,
        expected: {
          arm: "discovered-program",
          sourceArmRecordDigest: arm.record.recordDigest,
          comparisonDigest: comparison.comparisonDigest,
          model: { id: "m9b2-offline-model", version: "1" },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          programIdentity: response.sourceDigest,
        },
      }),
    );
    expect(measured).toMatchObject({
      primary: { terminalStage: "evaluated", success: true },
      evaluation: { semanticSupported: true },
      usage: {
        planning: { actual: { kind: "known" } },
        execution: { actual: { kind: "known" } },
      },
      secondary: {
        retrievedEvidenceRecallBasisPoints: { kind: "known", value: 10_000 },
        citationValidityBasisPoints: { kind: "known", value: 10_000 },
        bytesRead: { kind: "known" },
        retrievalCalls: { kind: "known", value: 2 },
        modelCalls: { kind: "known", value: 3 },
        compilationAccepted: true,
      },
    });
    expect(evaluatorCalls).toBe(callsBeforeMeasurement);
    const measurementVerification = {
      suite,
      caseId: measured.caseId,
      verifiedRecord: verified,
      expected: {
        sourceArmRecordDigest: arm.record.recordDigest,
        comparisonDigest: comparison.comparisonDigest,
        arm: measured.arm,
        model: { id: "m9b2-offline-model", version: "1" },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        programIdentity: response.sourceDigest,
      },
    } as const;
    expect(
      await verifyM9b2TerminalMeasurementRecord(
        measured,
        measurementVerification,
      ),
    ).toMatchObject({ ok: true });
    const serializedSnapshot = unwrap(
      await serializeM9b2MeasurementSnapshot(
        [measured],
        [measurementVerification],
      ),
    );
    expect(
      unwrap(
        await loadM9b2MeasurementSnapshot(serializedSnapshot, [
          measurementVerification,
        ]),
      ),
    ).toEqual([measured]);
    expect(evaluatorCalls).toBe(callsBeforeMeasurement);
    expect(
      await measureM9b2VerifiedTerminalRecord({
        suite,
        caseId,
        verifiedRecord: verified,
        expected: {
          arm: "discovered-program",
          sourceArmRecordDigest: arm.record.recordDigest,
          comparisonDigest: "0".repeat(64),
          model: { id: "m9b2-offline-model", version: "1" },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          programIdentity: response.sourceDigest,
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyM9b2TerminalMeasurementRecord(
        {
          ...measured,
          model: { id: "forged-model", version: "1" },
        },
        measurementVerification,
      ),
    ).toMatchObject({ ok: false });
    const { recordDigest: _measurementDigest, ...measurementBody } = measured;
    void _measurementDigest;
    const rekeyedBody = {
      ...measurementBody,
      evaluator: { id: "forged-evaluator", version: "1" },
    };
    const rekeyedMeasurement = {
      ...rekeyedBody,
      recordDigest: unwrap(await digestValue(rekeyedBody)),
    };
    expect(
      await verifyM9b2TerminalMeasurementRecord(
        rekeyedMeasurement,
        measurementVerification,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await serializeM9b2MeasurementSnapshot(
        [rekeyedMeasurement],
        [measurementVerification],
      ),
    ).toMatchObject({ ok: false });
    const parsedSnapshot = unwrap(parseJson(serializedSnapshot));
    if (
      typeof parsedSnapshot !== "object" ||
      parsedSnapshot === null ||
      Array.isArray(parsedSnapshot)
    )
      throw new Error("Expected a measurement snapshot object.");
    const { snapshotDigest: _snapshotDigest, ...snapshotBody } = parsedSnapshot;
    void _snapshotDigest;
    const forgedSnapshotBody = {
      ...snapshotBody,
      records: [rekeyedMeasurement],
    };
    const forgedSnapshot = unwrap(
      canonicalizeJson({
        ...forgedSnapshotBody,
        snapshotDigest: unwrap(await digestValue(forgedSnapshotBody)),
      }),
    );
    expect(
      await loadM9b2MeasurementSnapshot(forgedSnapshot, [
        measurementVerification,
      ]),
    ).toMatchObject({ ok: false });
    const oldRecordBody = {
      ...measurementBody,
      protocol: "lachesis-m9b2a-terminal-measurement-record/1",
      measurementProtocol: {
        id: M9B2_MEASUREMENT_PROTOCOL.id,
        version: "1.1.0",
      },
    };
    expect(
      await verifyM9b2TerminalMeasurementRecord(
        {
          ...oldRecordBody,
          recordDigest: unwrap(await digestValue(oldRecordBody)),
        },
        measurementVerification,
      ),
    ).toMatchObject({ ok: false });
    const oldSnapshot = unwrap(
      canonicalizeJson({
        protocol: "lachesis-m9b2a-atomic-measurement-store/1",
        records: [measured],
      }),
    );
    expect(
      await loadM9b2MeasurementSnapshot(oldSnapshot, [measurementVerification]),
    ).toMatchObject({ ok: false });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async (suffix) => {
        const propertyBody = {
          ...measurementBody,
          programIdentity: suffix.toString(16).padStart(64, "0"),
        };
        expect(
          await verifyM9b2TerminalMeasurementRecord(
            {
              ...propertyBody,
              recordDigest: unwrap(await digestValue(propertyBody)),
            },
            measurementVerification,
          ),
        ).toMatchObject({ ok: false });
      }),
      { numRuns: 20 },
    );
    const knownPlanning = measured.usage.planning.actual;
    if (knownPlanning.kind !== "known")
      throw new Error("Expected known planning usage.");
    const alteredMeasurementBodies = [
      {
        ...measurementBody,
        primary: {
          ...measured.primary,
          semanticSupported: false,
          success: false,
        },
      },
      {
        ...measurementBody,
        evaluation: {
          ...required(measured.evaluation),
          responseCorrect: false,
          semanticSupported: false,
          failureReasons: ["answer-mismatch" as const],
        },
      },
      {
        ...measurementBody,
        authoringRequestDigest: "1".repeat(64),
      },
      {
        ...measurementBody,
        executionRequestDigests: ["2".repeat(64)],
      },
      {
        ...measurementBody,
        evaluationAttemptDigest: "3".repeat(64),
      },
      {
        ...measurementBody,
        runAnswerDigest: "4".repeat(64),
      },
      {
        ...measurementBody,
        usage: {
          ...measured.usage,
          planning: {
            ...measured.usage.planning,
            actual: {
              ...knownPlanning,
              wallClockMs: knownPlanning.wallClockMs + 1,
            },
          },
        },
      },
      {
        ...measurementBody,
        usage: {
          ...measured.usage,
          planning: {
            ...measured.usage.planning,
            requestDigest: "6".repeat(64),
          },
          execution: {
            ...measured.usage.execution,
            requestDigests: ["7".repeat(64)],
          },
        },
      },
      {
        ...measurementBody,
        secondary: {
          ...measured.secondary,
          compilationAccepted: false,
        },
      },
      {
        ...measurementBody,
        secondary: {
          ...measured.secondary,
          bytesRead: { kind: "known" as const, value: 0 },
        },
      },
    ];
    for (const alteredBody of alteredMeasurementBodies) {
      const altered = {
        ...alteredBody,
        recordDigest: unwrap(await digestValue(alteredBody)),
      };
      expect(
        await verifyM9b2TerminalMeasurementRecord(
          altered,
          measurementVerification,
        ),
      ).toMatchObject({ ok: false });
      expect(
        await serializeM9b2MeasurementSnapshot(
          [altered],
          [measurementVerification],
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      await loadM9b2MeasurementSnapshot(serializedSnapshot, [
        {
          ...measurementVerification,
          expected: {
            ...measurementVerification.expected,
            comparisonDigest: "5".repeat(64),
          },
        },
      ]),
    ).toMatchObject({ ok: false });
    expect(evaluatorCalls).toBe(callsBeforeMeasurement);

    const { recordDigest: _originalDigest, ...recordBody } = arm.record;
    void _originalDigest;
    const planningResponse = required(arm.record.authoringResponse);
    const forgedPlanningBody = {
      ...recordBody,
      authoringResponse: {
        ...planningResponse,
        usage: {
          ...planningResponse.usage,
          wallClockMs: planningResponse.usage.wallClockMs + 1,
        },
      },
    };
    const forgedPlanningRecord = m9b1InternalArmRecordSchema.parse({
      ...forgedPlanningBody,
      recordDigest: unwrap(await digestValue(forgedPlanningBody)),
    });
    const forgedPlanningToken = unwrap(
      await m9b1InternalVerifyTerminalRecord(forgedPlanningRecord, {
        task: publicCase.task,
        taskDigest,
        corpusSnapshotDigest: snapshot.snapshotDigest,
        model: { id: "m9b2-offline-model", version: "1" },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        executionOrder: "discovered-first",
      }),
    );
    expect(
      await measureM9b2VerifiedTerminalRecord({
        suite,
        caseId,
        verifiedRecord: forgedPlanningToken,
        expected: {
          arm: "discovered-program",
          sourceArmRecordDigest: arm.record.recordDigest,
          comparisonDigest: comparison.comparisonDigest,
          model: { id: "m9b2-offline-model", version: "1" },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          programIdentity: response.sourceDigest,
        },
      }),
    ).toMatchObject({ ok: false });

    if (arm.record.outcome.status !== "success")
      throw new Error("Expected successful outcome.");
    const persistedScore = m9b2EvaluationScoreSchema.parse(
      unwrap(parseJson(arm.record.outcome.evaluationAttempt.serializedOutput)),
    );
    const forgedScore = {
      ...persistedScore,
      responseCorrect: false,
      semanticSupported: false,
      failureReasons: ["answer-mismatch" as const],
    };
    const serializedForgedScore = unwrap(canonicalizeJson(forgedScore));
    const forgedEvaluationAttempt = {
      ...arm.record.outcome.evaluationAttempt,
      serializedOutput: serializedForgedScore,
      outputDigest: unwrap(await digestValue(forgedScore)),
    };
    const forgedEvaluationBody = {
      ...recordBody,
      outcome: {
        ...arm.record.outcome,
        evaluationAttempt: forgedEvaluationAttempt,
      },
    };
    const forgedEvaluationRecord = m9b1InternalArmRecordSchema.parse({
      ...forgedEvaluationBody,
      recordDigest: unwrap(await digestValue(forgedEvaluationBody)),
    });
    const forgedEvaluationToken = unwrap(
      await m9b1InternalVerifyTerminalRecord(forgedEvaluationRecord, {
        task: publicCase.task,
        taskDigest,
        corpusSnapshotDigest: snapshot.snapshotDigest,
        model: { id: "m9b2-offline-model", version: "1" },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        executionOrder: "discovered-first",
      }),
    );
    expect(
      await measureM9b2VerifiedTerminalRecord({
        suite,
        caseId,
        verifiedRecord: forgedEvaluationToken,
        expected: {
          arm: "discovered-program",
          sourceArmRecordDigest: forgedEvaluationRecord.recordDigest,
          comparisonDigest: comparison.comparisonDigest,
          model: { id: "m9b2-offline-model", version: "1" },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          programIdentity: response.sourceDigest,
        },
      }),
    ).toMatchObject({ ok: false });

    const wrongAnswer = { answer: "1999", citations: [citation] };
    const wrongEvaluationInput = {
      task: publicCase.task,
      answer: wrongAnswer,
    };
    const wrongInputAttempt = {
      ...arm.record.outcome.evaluationAttempt,
      serializedInput: unwrap(canonicalizeJson(wrongEvaluationInput)),
      inputDigest: unwrap(await digestValue(wrongEvaluationInput)),
    };
    const wrongAnswerBody = {
      ...recordBody,
      outcome: {
        ...arm.record.outcome,
        evaluationAttempt: wrongInputAttempt,
      },
    };
    const wrongAnswerRecord = m9b1InternalArmRecordSchema.parse({
      ...wrongAnswerBody,
      recordDigest: unwrap(await digestValue(wrongAnswerBody)),
    });
    expect(
      await m9b1InternalVerifyTerminalRecord(wrongAnswerRecord, {
        task: publicCase.task,
        taskDigest,
        corpusSnapshotDigest: snapshot.snapshotDigest,
        model: { id: "m9b2-offline-model", version: "1" },
        evaluator: M9B2_EVALUATOR_IDENTITY,
        executionOrder: "discovered-first",
      }),
    ).toMatchObject({ ok: false });
  });

  it("derives every first-attempt terminal stage from verified M9b.1b records", async () => {
    const suite = await preparedSuite();
    const caseId = "m9b2-dev-lookup-1x";
    const publicCase = developmentCase(caseId);
    const citation = required(
      required(m9b2InternalInspectSupportingFacts(suite, caseId))[0],
    ).chunk;
    const cases = [
      {
        expectedStage: "authoring-rejected",
        source: "",
        executionFails: false,
        evaluationFails: false,
      },
      {
        expectedStage: "compile-rejected",
        source:
          "export default async function main(input, ops) { return globalThis; }",
        executionFails: false,
        evaluationFails: false,
      },
      {
        expectedStage: "execution-failed",
        source: M9A_MODEL_VISIBLE_GRAMMAR.template,
        executionFails: true,
        evaluationFails: false,
      },
      {
        expectedStage: "evaluation-failed",
        source: M9A_MODEL_VISIBLE_GRAMMAR.template,
        executionFails: false,
        evaluationFails: true,
      },
    ] as const;
    for (const fixture of cases) {
      const corpus = unwrap(await createM9aCorpus(publicCase.corpus));
      const snapshot = required(inspectM9aCorpus(corpus));
      const successfulEvaluator = unwrap(
        createM9b2OfflineEvaluator(suite, caseId),
      );
      const failedEvaluator: M9b1ExternalEvaluator = {
        identity: M9B2_EVALUATOR_IDENTITY,
        evaluate: () =>
          Promise.resolve({
            ok: false as const,
            error: {
              kind: "invalid-input" as const,
              message: "Injected evaluation failure.",
            },
          }),
      };
      const evaluatorFactory = () =>
        fixture.evaluationFails ? failedEvaluator : successfulEvaluator;
      const comparison = unwrap(
        await runM9b1OfflineProgramDiscovery({
          corpus,
          task: publicCase.task,
          model: { id: "m9b2-offline-model", version: "1" },
          authoringSessionFactories: {
            discoveredProgram: () =>
              authoredModel("discovered-program", fixture.source),
            staticQuery: () => authoredModel("static-one-shot"),
          },
          executionSessionFactories: {
            discoveredProgram: () =>
              executionModel(citation, fixture.executionFails),
            staticQuery: () => executionModel(citation),
          },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          evaluatorSessionFactories: {
            discoveredProgram: evaluatorFactory,
            staticQuery: () =>
              unwrap(createM9b2OfflineEvaluator(suite, caseId)),
          },
          executionOrder: "discovered-first",
          store: createM9b1ArmStore(memoryArmPersistence()),
        }),
      );
      const record = comparison.discovered.record;
      const verified = unwrap(
        await m9b1InternalVerifyTerminalRecord(record, {
          task: publicCase.task,
          taskDigest: unwrap(await digestValue(publicCase.task)),
          corpusSnapshotDigest: snapshot.snapshotDigest,
          model: { id: "m9b2-offline-model", version: "1" },
          evaluator: M9B2_EVALUATOR_IDENTITY,
          executionOrder: "discovered-first",
        }),
      );
      const response = record.authoringResponse;
      const programIdentity =
        response === null
          ? null
          : response.kind === "program"
            ? response.sourceDigest
            : response.derivedSourceDigest;
      expect(
        await measureM9b2VerifiedTerminalRecord({
          suite,
          caseId,
          verifiedRecord: verified,
          expected: {
            arm: "discovered-program",
            sourceArmRecordDigest: record.recordDigest,
            comparisonDigest: comparison.comparisonDigest,
            model: { id: "m9b2-offline-model", version: "1" },
            evaluator: M9B2_EVALUATOR_IDENTITY,
            programIdentity,
          },
        }),
      ).toMatchObject({
        ok: true,
        value: {
          primary: { terminalStage: fixture.expectedStage, success: false },
        },
      });
    }
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
    expect(report.scenarios[0]?.requiredPairedCases).toEqual({
      kind: "known",
      pairedCases: 168,
    });
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
      allocation: altered.allocation,
      independenceAssumption: altered.independenceAssumption,
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
    ).toMatchObject({ ok: false });
    expect(
      await analyzeM9b2ProspectivePower({
        scenarios: [
          {
            id: "all-discordances-favor-discovery",
            discoveredOnlyRateBasisPoints: 10_000,
            staticOnlyRateBasisPoints: 0,
          },
        ],
        practicalPairedCaseCeiling: 24,
      }),
    ).toMatchObject({ ok: true });
  });

  it("enforces disjoint development and eventual held-out identities", async () => {
    const development = await disjointPreparedSuite("development-lineage");
    const heldout = await disjointPreparedSuite("heldout-lineage");
    const auditInput = {
      developmentSuite: development.suite,
      developmentCaseIds: development.caseIds,
      heldoutSuite: heldout.suite,
      heldoutCaseIds: heldout.caseIds,
    } as const;
    const audit = unwrap(await auditM9b2SplitDisjointness(auditInput));
    expect(audit).toMatchObject({
      protocol: "lachesis-m9b2c-split-disjointness-audit/4",
      developmentCount: 24,
      heldoutCount: 24,
      passed: true,
    });
    expect(audit.developmentSuiteDigest).not.toBe(audit.heldoutSuiteDigest);
    expect(audit.developmentCases.map((value) => value.caseId)).toEqual(
      [...development.caseIds].toSorted(),
    );
    expect(audit.heldoutCases.map((value) => value.caseId)).toEqual(
      [...heldout.caseIds].toSorted(),
    );
    expect(audit.allowedOverlap.taskFamilies).toEqual(M9B2_TASK_FAMILIES);
    expect(
      await verifyM9b2SplitDisjointnessAudit(auditInput, audit),
    ).toMatchObject({ ok: true });
    const { auditDigest: _auditDigest, ...auditBody } = audit;
    void _auditDigest;
    const forgedAuditBody = {
      ...auditBody,
      developmentSuiteDigest: "e".repeat(64),
      developmentCases: audit.developmentCases.slice(1),
      developmentCount: audit.developmentCount - 1,
    };
    expect(
      await verifyM9b2SplitDisjointnessAudit(auditInput, {
        ...forgedAuditBody,
        auditDigest: unwrap(await digestValue(forgedAuditBody)),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await auditM9b2SplitDisjointness({
        developmentSuite: development.suite,
        developmentCaseIds: development.caseIds,
        heldoutSuite: development.suite,
        heldoutCaseIds: development.caseIds,
      }),
    ).toMatchObject({ ok: false });
    const clusteredDevelopment = await preparedSuite();
    const overlappingHeldout = await independentPreparedSuite();
    expect(
      await auditM9b2SplitDisjointness({
        developmentSuite: clusteredDevelopment,
        developmentCaseIds: M9B2_PUBLIC_DEVELOPMENT_CASES.map(
          (value) => value.id,
        ),
        heldoutSuite: overlappingHeldout.suite,
        heldoutCaseIds: overlappingHeldout.caseIds,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await auditM9b2SplitDisjointness({
        developmentSuite: development.suite,
        developmentCaseIds: [...development.caseIds, "unknown-case"],
        heldoutSuite: heldout.suite,
        heldoutCaseIds: heldout.caseIds,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await auditM9b2SplitDisjointness({
        developmentIdentities: [splitIdentity(1)],
        heldoutIdentities: [splitIdentity(20)],
      }),
    ).toMatchObject({ ok: false });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100_000 }), async (offset) => {
        expect(
          await auditM9b2SplitDisjointness({
            developmentIdentities: [splitIdentity(offset)],
            heldoutIdentities: [splitIdentity(offset + 100_000)],
          }),
        ).toMatchObject({ ok: false });
      }),
      { numRuns: 20 },
    );
  });

  it("freezes independent M9c cases and reserves clustered scale variants for M9d", async () => {
    const independent = await independentPreparedSuite();
    expect(
      await auditM9cInferenceUnits(independent.suite, independent.caseIds),
    ).toMatchObject({
      ok: true,
      value: {
        estimand: {
          inferenceUnit: "one-semantically-independent-paired-case",
          scaleRole: "preregistered-stratum",
          clusteredScaleVariants: "reserved-for-m9d",
        },
        cellWeight: { numerator: 1, denominator: 24 },
        casesPerCell: 1,
      },
    });
    const effectCounter: EffectCounter = { modelCalls: 0, evaluatorCalls: 0 };
    const pairs = await pairedMeasurementVerifications(
      independent.suite,
      independent.caseIds,
      effectCounter,
    );
    const effectsBeforeReporting = { ...effectCounter };
    const descriptive = unwrap(
      await reportM9cPairedDescriptives(independent.suite, pairs),
    );
    expect(descriptive.claimScope).toBe(
      "family-and-scale-stratified-descriptive-results-only-no-additional-superiority-claims",
    );
    expect(descriptive.byFamily.map((value) => value.stratum)).toContain(
      "lookup",
    );
    expect(descriptive.byScale.map((value) => value.stratum)).toContain("1x");
    expect(descriptive.sourcePairs).toHaveLength(24);
    expect(
      descriptive.sourcePairs.every(
        (pair) => !pair.discovered.success && !pair.static.success,
      ),
    ).toBe(true);
    expect(
      await verifyM9cPairedDescriptiveReport(
        independent.suite,
        pairs,
        descriptive,
      ),
    ).toMatchObject({ ok: true });
    expect(effectCounter).toEqual(effectsBeforeReporting);
    const { reportDigest: _reportDigest, ...descriptiveBody } = descriptive;
    void _reportDigest;
    const forgedSourcePairs = descriptive.sourcePairs.map((pair) => ({
      ...pair,
      discovered: { ...pair.discovered, success: !pair.discovered.success },
      static: { ...pair.static, success: !pair.static.success },
    }));
    const forgedBody = {
      ...descriptiveBody,
      equalCellWeightedRiskDifferenceBasisPoints: 10_000,
      sourcePairs: forgedSourcePairs,
    };
    expect(
      await verifyM9cPairedDescriptiveReport(independent.suite, pairs, {
        ...forgedBody,
        reportDigest: unwrap(await digestValue(forgedBody)),
      }),
    ).toMatchObject({ ok: false });
    const firstPair = required(descriptive.sourcePairs[0]);
    for (const sourcePairMutation of [
      {
        ...firstPair,
        suiteDigest: "9".repeat(64),
      },
      {
        ...firstPair,
        comparisonDigest: "a".repeat(64),
      },
      {
        ...firstPair,
        taskDigest: "b".repeat(64),
      },
      {
        ...firstPair,
        corpusSnapshotDigest: "c".repeat(64),
      },
      {
        ...firstPair,
        discovered: {
          ...firstPair.discovered,
          measurementRecordDigest: "d".repeat(64),
        },
      },
    ]) {
      const alteredBody = {
        ...descriptiveBody,
        sourcePairs: [sourcePairMutation, ...descriptive.sourcePairs.slice(1)],
      };
      expect(
        await verifyM9cPairedDescriptiveReport(independent.suite, pairs, {
          ...alteredBody,
          reportDigest: unwrap(await digestValue(alteredBody)),
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await reportM9cPairedDescriptives(independent.suite, [
        { ...required(pairs[0]), static: required(pairs[1]).static },
        ...pairs.slice(1),
      ]),
    ).toMatchObject({ ok: false });
    expect(
      await reportM9cPairedDescriptives(independent.suite, [
        { ...required(pairs[0]), static: required(pairs[0]).discovered },
        ...pairs.slice(1),
      ]),
    ).toMatchObject({ ok: false });
    expect(effectCounter).toEqual(effectsBeforeReporting);
    const clustered = await preparedSuite();
    expect(
      await auditM9cInferenceUnits(
        clustered,
        M9B2_PUBLIC_DEVELOPMENT_CASES.map((value) => value.id),
      ),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await auditM9cInferenceUnits(
        independent.suite,
        independent.caseIds.map((caseId, index) => ({
          caseId,
          semanticProblemIdentity: index.toString(16).padStart(64, "0"),
        })),
      ),
    ).toMatchObject({ ok: false });

    const twoWaves = await independentPreparedSuite(2);
    expect(
      await auditM9cInferenceUnits(twoWaves.suite, twoWaves.caseIds),
    ).toMatchObject({
      ok: true,
      value: { caseCount: 48, casesPerCell: 2 },
    });
    const invalidTotal = twoWaves.caseIds.slice(0, -1);
    expect(
      await auditM9cInferenceUnits(twoWaves.suite, invalidTotal),
    ).toMatchObject({ ok: false });
    const threeWaves = await independentPreparedSuite(3);
    const overrepresentedLookup = [
      ...threeWaves.caseIds
        .filter((caseId) => !caseId.includes("wave-3"))
        .filter((caseId) => caseId !== "m9b2-dev-join-1x-wave-2"),
      "m9b2-dev-lookup-1x-wave-3",
    ];
    expect(overrepresentedLookup).toHaveLength(48);
    expect(
      await auditM9cInferenceUnits(threeWaves.suite, overrepresentedLookup),
    ).toMatchObject({ ok: false });
  });
});
