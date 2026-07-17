import { beforeAll, describe, expect, it } from "vitest";

import {
  auditM3bWilliamsSchedule,
  blindAuditM3bMaterialization,
  blindM3a1IntegrityAudit,
  calculateM3bPairedInterval,
  createDeterministicM3bOracle,
  createMemoryM3bStore,
  evaluateM3bStatistics,
  M3B_CONTRASTS,
  M3B_ORACLE_MODELS,
  M3B_PREREGISTERED_CORPUS,
  M3B_REFERENCE_GRAPH,
  type M3bAttemptProvenance,
  type M3bMaterializedPhase,
  type M3bOracle,
  type M3bOracleAttempt,
  type M3bOracleRequest,
  m3bOverallConclusionSchema,
  type M3bStatisticalObservation,
  materializeM3bPhase,
  runM3bWithOracles,
  validateM3bMaterialization,
} from "../src/index.js";

function provenance(
  category = "fixture",
  usageAvailable = true,
): M3bAttemptProvenance {
  return {
    stage: usageAvailable ? "wire-decoding" : "transport",
    category,
    providerStatusCode: null,
    providerErrorCode: null,
    providerResponseId: null,
    finishReason: usageAvailable ? "stop" : null,
    rawFinishReason: null,
    usageAvailable,
    outputPresent: usageAvailable,
    outputDigest: null,
    outputSizeBytes: null,
    outputTruncated: false,
    issues: [],
  };
}

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function successfulOutput(request: M3bOracleRequest): M3bOracleAttempt {
  const finalFact = request.evidence.facts.at(-1);
  return {
    kind: "success",
    output: {
      outcome: finalFact === undefined ? "insufficient-evidence" : "answered",
      answerValues: finalFact === undefined ? [] : [finalFact.object],
      citationIds: request.evidence.citations.map((citation) => citation.id),
      pathIds: request.evidence.paths.map((path) => path.id),
    },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      costUsdMicros: 10,
      latencyMs: 5,
    },
    provenance: provenance(),
  };
}

function recordedOracle(
  input: Readonly<{
    modelIndex: 0 | 1;
    requests: Array<M3bOracleRequest>;
    generate?: ((request: M3bOracleRequest) => M3bOracleAttempt) | undefined;
  }>,
): M3bOracle {
  const provider = input.modelIndex === 0 ? "openai" : "anthropic";
  const identity = M3B_ORACLE_MODELS.find(
    (candidate) => candidate.provider === provider,
  );
  if (identity === undefined) throw new Error(`Missing ${provider} fixture.`);
  return {
    identity,
    generate: (request) => {
      input.requests.push(request);
      return Promise.resolve(
        input.generate?.(request) ?? successfulOutput(request),
      );
    },
  };
}

describe("M3b offline execution infrastructure", () => {
  let probe: M3bMaterializedPhase;
  let calibration: M3bMaterializedPhase;
  let heldout: M3bMaterializedPhase;

  beforeAll(async () => {
    probe = unwrap(
      await materializeM3bPhase({
        phase: "m3b-protocol-probe",
        sourceCommit: "793a033d963921823d5bdde1ead6bcb74238a439",
      }),
    );
    calibration = unwrap(
      await materializeM3bPhase({
        phase: "m3b-calibration",
        sourceCommit: "793a033d963921823d5bdde1ead6bcb74238a439",
      }),
    );
    heldout = unwrap(
      await materializeM3bPhase({
        phase: "m3b-heldout",
        sourceCommit: "793a033d963921823d5bdde1ead6bcb74238a439",
      }),
    );
  }, 60_000);

  it("expands negative controls without changing the frozen M3a.1 corpus", () => {
    const audit = blindM3a1IntegrityAudit(
      M3B_REFERENCE_GRAPH,
      M3B_PREREGISTERED_CORPUS,
    );

    expect(audit).toMatchObject({
      tasks: 190,
      developmentCases: 30,
      heldoutCases: 160,
      heldoutStructuralCases: 100,
      heldoutNegativeControls: 60,
      answerBearingQueryLeaks: 0,
      invalidGroundTruthReferences: 0,
      passed: true,
    });
    const heldoutCases = M3B_PREREGISTERED_CORPUS.filter(
      (task) => task.split === "heldout",
    );
    expect(
      heldoutCases.filter((task) => task.retrievalAdvantageExpected),
    ).toHaveLength(60);
    expect(
      heldoutCases.filter((task) => task.relationshipEncodingExpected),
    ).toHaveLength(100);
  });

  it("materializes exact offline probe, calibration, and held-out matrices", () => {
    expect(blindAuditM3bMaterialization(probe)).toMatchObject({
      cases: 2,
      initialCalls: 16,
      maximumTransportRetries: 16,
      maximumCalls: 32,
      frozenNeighborhoods: 8,
      sharedPlanIdentities: 1,
      liveExecutionAuthorized: false,
      passed: true,
    });
    expect(blindAuditM3bMaterialization(calibration)).toMatchObject({
      cases: 30,
      initialCalls: 240,
      maximumTransportRetries: 240,
      maximumCalls: 480,
      frozenNeighborhoods: 120,
      passed: true,
    });
    expect(blindAuditM3bMaterialization(heldout)).toMatchObject({
      cases: 160,
      initialCalls: 2_560,
      maximumTransportRetries: 2_560,
      maximumCalls: 5_120,
      frozenNeighborhoods: 640,
      passed: true,
    });
    expect(probe.manifest.pool.id).toBe("m3b-development");
    expect(calibration.manifest.pool.id).toBe("m3b-development");
    expect(heldout.manifest.pool.id).toBe("m3b-heldout");
    expect(
      new Set([
        probe.manifest.experimentDigest,
        calibration.manifest.experimentDigest,
        heldout.manifest.experimentDigest,
      ]).size,
    ).toBe(3);
  });

  it("uses balanced four-arm Williams sequences in every stratum", () => {
    expect(auditM3bWilliamsSchedule(probe.manifest.schedule)).toMatchObject({
      strata: 2,
      positionImbalanceMaximum: 1,
      predecessorImbalanceMaximum: 1,
      passed: true,
    });
    expect(
      auditM3bWilliamsSchedule(calibration.manifest.schedule),
    ).toMatchObject({ strata: 2, passed: true });
    expect(auditM3bWilliamsSchedule(heldout.manifest.schedule)).toEqual({
      strata: 4,
      positionImbalanceMaximum: 0,
      predecessorImbalanceMaximum: 0,
      passed: true,
    });
  });

  it("executes one shared plan with arm-blinded requests and resumes safely", async () => {
    const openAiIdentity = M3B_ORACLE_MODELS.find(
      (model) => model.provider === "openai",
    );
    const anthropicIdentity = M3B_ORACLE_MODELS.find(
      (model) => model.provider === "anthropic",
    );
    if (openAiIdentity === undefined || anthropicIdentity === undefined)
      throw new Error("Missing deterministic M3b model identity.");
    const openAi = createDeterministicM3bOracle(openAiIdentity);
    const anthropic = createDeterministicM3bOracle(anthropicIdentity);
    const store = createMemoryM3bStore();
    const oracles = [openAi, anthropic];
    const first = unwrap(
      await runM3bWithOracles({ materialized: probe, oracles, store }),
    );

    expect(first).toMatchObject({
      dispatched: 16,
      resumed: 0,
      transportRetries: 0,
    });
    expect(new Set(first.records.map((record) => record.planHash)).size).toBe(
      1,
    );
    expect(
      new Set(first.records.map((record) => record.outputSchemaDigest)).size,
    ).toBe(1);
    const recordsByUnit = new Map<
      string,
      Array<(typeof first.records)[number]>
    >();
    for (const record of first.records) {
      const records = recordsByUnit.get(record.unitDigest) ?? [];
      records.push(record);
      recordsByUnit.set(record.unitDigest, records);
    }
    for (const records of recordsByUnit.values()) {
      expect(records).toHaveLength(4);
      expect(new Set(records.map((record) => record.planHash)).size).toBe(1);
      expect(
        new Set(records.map((record) => record.oraclePromptDigest)).size,
      ).toBe(1);
      expect(
        new Set(records.map((record) => record.outputSchemaDigest)).size,
      ).toBe(1);
      expect(
        new Set(records.map((record) => record.modelIdentityDigest)).size,
      ).toBe(1);
      expect(
        new Set(records.map((record) => record.neighborhoodDigest)).size,
      ).toBe(4);
    }
    expect(first.records.map((record) => record.semanticRepairCalls)).toEqual(
      Array.from({ length: 16 }, () => 0),
    );
    for (const request of [...openAi.requests(), ...anthropic.requests()]) {
      expect(Object.keys(request)).toEqual([
        "instruction",
        "answerShape",
        "evidence",
      ]);
      expect(JSON.stringify(request)).not.toMatch(
        /lexical-facts|graph-facts|graph-adjacency|graph-typed|implementation/,
      );
    }

    const callsBeforeResume =
      openAi.requests().length + anthropic.requests().length;
    const resumed = unwrap(
      await runM3bWithOracles({ materialized: probe, oracles, store }),
    );
    expect(resumed).toMatchObject({ dispatched: 0, resumed: 16 });
    expect(openAi.requests().length + anthropic.requests().length).toBe(
      callsBeforeResume,
    );
  });

  it("retries transport failures symmetrically inside each scheduled slot", async () => {
    const requests: [Array<M3bOracleRequest>, Array<M3bOracleRequest>] = [
      [],
      [],
    ];
    const toggles = [false, false];
    const oracles = ([0, 1] as const).map((modelIndex) =>
      recordedOracle({
        modelIndex,
        requests: requests[modelIndex],
        generate: (request) => {
          toggles[modelIndex] = !toggles[modelIndex];
          return toggles[modelIndex]
            ? {
                kind: "failure",
                code: "provider-overload",
                dispatchEvidence: "dispatched-usage-unknown",
                usage: null,
                provenance: provenance("provider-overload", false),
              }
            : successfulOutput(request);
        },
      }),
    );
    const result = unwrap(
      await runM3bWithOracles({
        materialized: probe,
        oracles,
        store: createMemoryM3bStore(),
      }),
    );

    expect(result.dispatched).toBe(16);
    expect(result.transportRetries).toBe(16);
    expect(result.records.every((record) => record.attempts.length === 2)).toBe(
      true,
    );
    expect(
      result.records.every((record) => record.terminalFailure === null),
    ).toBe(true);
  });

  it("keeps missing evidence in the primary estimand while scoring arm-visible paths", async () => {
    const answers = new Map(
      M3B_PREREGISTERED_CORPUS.map((task) => [
        task.instruction,
        task.expectedAnswer,
      ]),
    );
    const requests: Array<M3bOracleRequest> = [];
    const semanticOracle = (modelIndex: 0 | 1): M3bOracle =>
      recordedOracle({
        modelIndex,
        requests,
        generate: (request) => ({
          kind: "success",
          output: {
            outcome: request.evidence.facts.some(
              (fact) => fact.object === answers.get(request.instruction),
            )
              ? "answered"
              : "insufficient-evidence",
            answerValues: request.evidence.facts.some(
              (fact) => fact.object === answers.get(request.instruction),
            )
              ? [answers.get(request.instruction) ?? "unknown"]
              : [],
            citationIds: request.evidence.citations.map(
              (citation) => citation.id,
            ),
            pathIds: request.evidence.paths.map((path) => path.id),
          },
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            costUsdMicros: 0,
            latencyMs: 1,
          },
          provenance: provenance(),
        }),
      });
    const result = unwrap(
      await runM3bWithOracles({
        materialized: probe,
        oracles: [semanticOracle(0), semanticOracle(1)],
        store: createMemoryM3bStore(),
      }),
    );

    expect(result.records.every((record) => record.answerCorrect)).toBe(true);
    expect(result.records.every((record) => record.pathsCorrect)).toBe(true);
    expect(
      result.records
        .filter((record) => record.arm !== "lexical-facts")
        .every((record) => record.citationsCorrect),
    ).toBe(true);
    expect(
      result.records.every(
        (record) => record.endToEndSuccess === record.citationsCorrect,
      ),
    ).toBe(true);
  });

  it("keeps terminal failures in end-to-end results and conditional analysis secondary", async () => {
    const openAiRequests: Array<M3bOracleRequest> = [];
    const anthropicRequests: Array<M3bOracleRequest> = [];
    const result = unwrap(
      await runM3bWithOracles({
        materialized: probe,
        oracles: [
          recordedOracle({
            modelIndex: 0,
            requests: openAiRequests,
            generate: () => ({
              kind: "failure",
              code: "provider-timeout",
              dispatchEvidence: "dispatched-usage-unknown",
              usage: null,
              provenance: provenance("provider-timeout", false),
            }),
          }),
          recordedOracle({ modelIndex: 1, requests: anthropicRequests }),
        ],
        store: createMemoryM3bStore(),
      }),
    );
    const failed = result.records.filter(
      (record) => record.provider === "openai",
    );

    expect(failed).toHaveLength(8);
    expect(failed.every((record) => !record.endToEndSuccess)).toBe(true);
    expect(
      failed.every((record) => record.conditionalSemanticSuccess === null),
    ).toBe(true);
    expect(failed.every((record) => record.attempts.length === 2)).toBe(true);
  });

  it("persists usage and diagnostics before rejecting a domain-invalid wire output", async () => {
    const requests: Array<M3bOracleRequest> = [];
    const invalidSemanticOracle = (modelIndex: 0 | 1): M3bOracle =>
      recordedOracle({
        modelIndex,
        requests,
        generate: () => ({
          kind: "success",
          output: {
            outcome: "answered",
            answerValues: [],
            citationIds: ["missing-citation"],
            pathIds: ["missing-path"],
          },
          usage: {
            inputTokens: 73,
            outputTokens: 11,
            costUsdMicros: 19,
            latencyMs: 7,
          },
          provenance: provenance("accepted-wire-envelope", true),
        }),
      });
    const result = unwrap(
      await runM3bWithOracles({
        materialized: probe,
        oracles: [invalidSemanticOracle(0), invalidSemanticOracle(1)],
        store: createMemoryM3bStore(),
      }),
    );

    expect(result.transportRetries).toBe(0);
    expect(result.records).toHaveLength(16);
    expect(
      result.records.every(
        (record) =>
          record.validOutput &&
          !record.semanticValidationPassed &&
          record.terminalFailure === null &&
          record.attempts[0]?.kind === "success" &&
          record.attempts[0].usage.costUsdMicros === 19 &&
          record.attempts[0].provenance.category === "accepted-wire-envelope" &&
          record.semanticIssues.length > 0,
      ),
    ).toBe(true);
  });

  it("rejects identity tampering before oracle dispatch or store mutation", async () => {
    const requests: Array<M3bOracleRequest> = [];
    const tampered: M3bMaterializedPhase = {
      ...probe,
      manifest: {
        ...probe.manifest,
        experimentDigest: "0".repeat(64),
      },
    };
    const store = createMemoryM3bStore();
    const result = await runM3bWithOracles({
      materialized: tampered,
      oracles: [
        recordedOracle({ modelIndex: 0, requests }),
        recordedOracle({ modelIndex: 1, requests }),
      ],
      store,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    expect(requests).toEqual([]);
    expect(store.records()).toEqual([]);
    expect(await validateM3bMaterialization(tampered)).toMatchObject({
      ok: false,
    });

    const missingFrozenCase: M3bMaterializedPhase = {
      ...probe,
      cases: probe.cases.slice(1),
    };
    expect(
      await runM3bWithOracles({
        materialized: missingFrozenCase,
        oracles: [
          recordedOracle({ modelIndex: 0, requests }),
          recordedOracle({ modelIndex: 1, requests }),
        ],
        store,
      }),
    ).toMatchObject({ ok: false, error: { code: "REPLAY_OUTPUT_MISMATCH" } });
    expect(requests).toEqual([]);
    expect(store.records()).toEqual([]);
  });

  it("rejects a substituted record before redispatch or store mutation", async () => {
    const seed = unwrap(
      await runM3bWithOracles({
        materialized: probe,
        oracles: [
          recordedOracle({ modelIndex: 0, requests: [] }),
          recordedOracle({ modelIndex: 1, requests: [] }),
        ],
        store: createMemoryM3bStore(),
      }),
    );
    const substituted = seed.records[0];
    if (substituted === undefined)
      throw new Error("Missing M3b substitution fixture.");
    const requests: Array<M3bOracleRequest> = [];
    let writes = 0;
    const result = await runM3bWithOracles({
      materialized: probe,
      oracles: [
        recordedOracle({ modelIndex: 0, requests }),
        recordedOracle({ modelIndex: 1, requests }),
      ],
      store: {
        load: () => Promise.resolve({ ok: true, value: substituted }),
        save: () => {
          writes += 1;
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    expect(requests).toEqual([]);
    expect(writes).toBe(0);
  });

  it("rejects a changed model identity before oracle dispatch or store mutation", async () => {
    const requests: Array<M3bOracleRequest> = [];
    const changed = recordedOracle({ modelIndex: 0, requests });
    const store = createMemoryM3bStore();
    const result = await runM3bWithOracles({
      materialized: probe,
      oracles: [
        {
          ...changed,
          identity: {
            ...changed.identity,
            adapterVersion: "m3b-offline-unbound/tampered",
          },
        },
        recordedOracle({ modelIndex: 1, requests }),
      ],
      store,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    expect(requests).toEqual([]);
    expect(store.records()).toEqual([]);
  });

  it("keeps held-out ground truth and identities out of manifests and blind audits", () => {
    const manifestText = JSON.stringify(heldout.manifest);
    const first = M3B_PREREGISTERED_CORPUS.find(
      (task) => task.split === "heldout",
    );
    if (first === undefined) throw new Error("Missing M3b held-out fixture.");
    expect(manifestText).not.toContain(first.expectedAnswer);
    for (const factId of first.expectedFactIds)
      expect(manifestText).not.toContain(factId);

    expect(Object.keys(blindAuditM3bMaterialization(heldout))).toEqual([
      "phase",
      "cases",
      "initialCalls",
      "maximumTransportRetries",
      "maximumCalls",
      "frozenNeighborhoods",
      "queryLeaks",
      "invalidGroundTruthReferences",
      "schedulePositionImbalanceMaximum",
      "schedulePredecessorImbalanceMaximum",
      "sharedPlanIdentities",
      "liveExecutionAuthorized",
      "passed",
    ]);
  });

  it("freezes contrast-specific sample sizes and correct n=60 sensitivity", () => {
    expect(
      M3B_CONTRASTS.map((contrast) => [
        contrast.id,
        contrast.heldoutSamplePerProviderRepetition,
      ]),
    ).toEqual([
      ["retrieval-graph-facts-vs-lexical", 60],
      ["adjacency-vs-graph-facts", 100],
      ["typed-vs-adjacency", 100],
      ["negative-control-typed-vs-lexical", 60],
    ]);
    const sixty = unwrap(
      calculateM3bPairedInterval({
        sampleCount: 60,
        leftOnly: 0,
        rightOnly: 1,
      }),
    );
    const forty = unwrap(
      calculateM3bPairedInterval({
        sampleCount: 40,
        leftOnly: 0,
        rightOnly: 1,
      }),
    );
    expect(sixty.lowerBound).toBeCloseTo(-0.0886, 4);
    expect(forty.lowerBound).toBeCloseTo(-0.1288, 4);
  });

  it("encodes complete prospective decisions without pooling provider strata", () => {
    const retrieval: Array<M3bStatisticalObservation> = [];
    const negative: Array<M3bStatisticalObservation> = [];
    for (let index = 0; index < 60; index += 1) {
      for (const arm of [
        "lexical-facts",
        "graph-facts",
        "graph-adjacency",
        "graph-typed",
      ] as const) {
        const graphSucceeded = arm !== "lexical-facts" || index >= 20;
        retrieval.push({
          caseId: `retrieval-${index}`,
          provider: "openai",
          model: "fixture",
          repetition: 0,
          arm,
          retrievalAdvantageExpected: true,
          relationshipEncodingExpected: false,
          negativeControl: false,
          validOutput: true,
          endToEndSuccess: graphSucceeded,
          conditionalSemanticSuccess: graphSucceeded,
          pathUtilizationSuccess: arm === "graph-typed",
          safetyViolation: false,
        });
        negative.push({
          caseId: `negative-${index}`,
          provider: "openai",
          model: "fixture",
          repetition: 0,
          arm,
          retrievalAdvantageExpected: false,
          relationshipEncodingExpected: false,
          negativeControl: true,
          validOutput: true,
          endToEndSuccess: true,
          conditionalSemanticSuccess: true,
          pathUtilizationSuccess: false,
          safetyViolation: index === 0 && arm === "graph-typed",
        });
      }
    }
    const expected = [{ provider: "openai", model: "fixture", repetition: 0 }];
    const report = evaluateM3bStatistics([...retrieval, ...negative], expected);
    const retrievalConclusion = report.conclusion.contrasts.find(
      (conclusion) =>
        conclusion.contrast === "retrieval-graph-facts-vs-lexical",
    );
    const negativeConclusion = report.conclusion.contrasts.find(
      (conclusion) =>
        conclusion.contrast === "negative-control-typed-vs-lexical",
    );

    expect(retrievalConclusion).toMatchObject({
      decision: "structural-superiority",
      passed: true,
      strata: [
        {
          complete: true,
          correctDirection: true,
          minimumDiscordantPairsPassed: true,
          multiplicityPassed: true,
          passed: true,
        },
      ],
    });
    expect(negativeConclusion).toMatchObject({
      decision: "negative-control-non-inferiority",
      passed: true,
      strata: [{ complete: true, nonInferiorityPassed: true, passed: true }],
    });
    expect(report.conclusion).toMatchObject({
      safetyViolations: 1,
      zeroSafetyViolationsPassed: false,
      passed: false,
    });
    expect(
      m3bOverallConclusionSchema.safeParse(report.conclusion).success,
    ).toBe(true);
    expect(report.conclusion.contrasts).toHaveLength(4);
  });
});
