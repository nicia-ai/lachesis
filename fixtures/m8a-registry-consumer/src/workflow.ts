import {
  compilePlan,
  createInMemoryEvidenceStore,
  createMemoryRecordingStore,
  createMockOracleInterpreter,
  createOracleEffectIdentity,
  createRecordingOracleInterpreter,
  type ExecutablePlan,
  inspectExecutablePlan,
  type OracleEffect,
  replay,
  type Result,
  run,
  type RuntimeResult,
  type TrustedPolicy,
} from "@nicia-ai/lachesis-runtime";

import { createIncidentCatalog, type IncidentCatalog } from "./catalog.js";

type Failure = Readonly<{ code: string; message: string }>;

function unwrap<T, E extends Failure>(result: Result<T, E>, label: string): T {
  if (!result.ok)
    throw new Error(`${label}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const planBudget = {
  maxEffectCalls: 1,
  maxCollectionItems: 8,
  maxRecursionDepth: 0,
  maxTokens: 64,
  maxWallClockMs: 250,
  maxParallelism: 1,
} as const;

function validPlan(
  catalog: IncidentCatalog,
): Readonly<Record<string, unknown>> {
  const refs = catalog.references;
  return {
    formatVersion: "1",
    catalog: { id: "northstar.incident/catalog", version: "1" },
    root: "decision",
    nodes: [
      {
        id: "request",
        op: "input",
        inputKey: "request",
        schema: refs.requestSchema,
      },
      {
        id: "normalized",
        op: "invoke",
        source: "request",
        function: refs.normalize,
      },
      {
        id: "critical",
        op: "invoke",
        source: "normalized",
        function: refs.critical,
      },
      {
        id: "escalation",
        op: "invoke",
        source: "normalized",
        function: refs.escalate,
      },
      {
        id: "routine",
        op: "invoke",
        source: "normalized",
        function: refs.review,
      },
      {
        id: "routed",
        op: "select",
        condition: "critical",
        whenTrue: "escalation",
        whenFalse: "routine",
      },
      {
        id: "checkpoint",
        op: "checkpoint",
        source: "routed",
        label: "incident-route-selected",
      },
      {
        id: "decision",
        op: "effect",
        source: "checkpoint",
        effect: refs.decide,
      },
    ],
    budget: planBudget,
    allowedCapabilities: [catalog.decisionCapability],
    metadata: { name: "northstar-incident-decision", revision: "1" },
  };
}

function invalidStructuralPlan(
  catalog: IncidentCatalog,
): Readonly<Record<string, unknown>> {
  const refs = catalog.references;
  return {
    formatVersion: "1",
    catalog: { id: "northstar.incident/catalog", version: "1" },
    root: "mismatched-branch",
    nodes: [
      {
        id: "request",
        op: "input",
        inputKey: "request",
        schema: refs.requestSchema,
      },
      {
        id: "critical",
        op: "invoke",
        source: "request",
        function: refs.critical,
      },
      {
        id: "action",
        op: "constant",
        schema: refs.actionSchema,
        value: "page-primary-oncall",
      },
      {
        id: "mismatched-branch",
        op: "select",
        condition: "critical",
        whenTrue: "request",
        whenFalse: "action",
      },
    ],
    budget: planBudget,
    allowedCapabilities: [],
  };
}

function trustedPolicy(
  planHash: string,
  semanticContractHash: string,
  catalog: IncidentCatalog,
): TrustedPolicy {
  return {
    id: "northstar-incident-policy",
    version: "1",
    expectedPlanHash: planHash,
    expectedSemanticContractHash: semanticContractHash,
    providerProfile: {
      id: "northstar-offline-mock",
      version: "1",
      provider: "openai",
    },
    oracleInputName: "request",
    oracleEffectName: catalog.decisionEffectName,
    oracleCapability: catalog.decisionCapability,
    evidence: { kind: "lexical-default" },
    budget: {
      maxCalls: 1,
      maxInputTokens: 128,
      maxOutputTokens: 64,
      maxTotalTokens: 192,
      maxWallClockMs: 250,
      maxConcurrency: 1,
    },
  };
}

const task = {
  id: "northstar-incident-decision",
  version: "1",
  instruction:
    "Select the registered response action for incident inc-482 from visible evidence.",
  taskClass: "negative-control",
  answerContract: {
    role: "evidence-values",
    cardinality: 1,
    ordering: "scalar",
    anchorSubject: "inc-482",
    derivation: "same-subject-fact-set",
    requiredFactPredicates: ["recommended-action"],
    answerSource: "last-object",
    minimumSupportingFacts: 1,
    sufficiencyRule:
      "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
  },
  evidenceLimits: {
    maxFacts: 8,
    maxCitations: 8,
    maxEdges: 4,
    maxPaths: 4,
    maxHops: 2,
    maxSerializedBytes: 16_000,
    maxSerializedTokenUpperBound: 16_000,
  },
} as const;

const graph = {
  id: "northstar-incident-registry",
  version: "1",
  citations: [
    {
      id: "citation-inc-482",
      source: "northstar-incident-registry",
      locator: "incidents/inc-482/revision-7",
      observedAt: "2026-07-23T00:00:00.000Z",
    },
  ],
  facts: [
    {
      id: "fact-inc-482-severity",
      statement: "Incident inc-482 has declared severity SEV-1.",
      subject: "inc-482",
      predicate: "severity",
      object: "SEV-1",
      citationIds: ["citation-inc-482"],
      validFrom: "2026-07-23T00:00:00.000Z",
      validUntil: null,
      recordedFrom: "2026-07-23T00:00:00.000Z",
      recordedUntil: null,
    },
    {
      id: "fact-inc-482-action",
      statement: "Incident inc-482 requires action page-primary-oncall.",
      subject: "inc-482",
      predicate: "recommended-action",
      object: "page-primary-oncall",
      citationIds: ["citation-inc-482"],
      validFrom: "2026-07-23T00:00:00.000Z",
      validUntil: null,
      recordedFrom: "2026-07-23T00:00:00.000Z",
      recordedUntil: null,
    },
    {
      id: "fact-inc-482-service",
      statement: "Incident inc-482 affects checkout-api.",
      subject: "inc-482",
      predicate: "service",
      object: "checkout-api",
      citationIds: ["citation-inc-482"],
      validFrom: "2026-07-23T00:00:00.000Z",
      validUntil: null,
      recordedFrom: "2026-07-23T00:00:00.000Z",
      recordedUntil: null,
    },
  ],
  edges: [],
} as const;

function diagnosticView(
  caseId: string,
  result: Awaited<ReturnType<typeof compilePlan>>,
  localization: Readonly<{
    operation: string;
    role: string;
    boundary: string;
  }>,
  guidance: string,
): Readonly<Record<string, unknown>> {
  if (result.ok) throw new Error(`${caseId} unexpectedly compiled.`);
  const diagnostic = result.error[0];
  if (diagnostic === undefined)
    throw new Error(`${caseId} returned no diagnostic.`);
  return {
    caseId,
    code: diagnostic.code,
    message: diagnostic.message,
    location: diagnostic.location,
    repair: diagnostic.repair ?? null,
    limit: diagnostic.limit ?? null,
    localization,
    guidance,
  };
}

export async function compileAdoptionPlans(): Promise<
  Readonly<{
    catalog: IncidentCatalog;
    executablePlan: ExecutablePlan;
    policy: TrustedPolicy;
    negatives: ReadonlyArray<Readonly<Record<string, unknown>>>;
    planSummary: NonNullable<ReturnType<typeof inspectExecutablePlan>>;
  }>
> {
  const catalog = createIncidentCatalog("baseline");
  const policyInput = {
    allowedCapabilities: [catalog.decisionCapability],
    budget: planBudget,
  };
  const obligations = [
    { kind: "rootDependsOnInput", inputKey: "request" },
    { kind: "requiresEffect", effectName: catalog.decisionEffectName },
    { kind: "requiresStateChange" },
    { kind: "operationDominatesRoot", operation: catalog.references.decide },
  ] as const;
  const compiled = await compilePlan(
    JSON.stringify(validPlan(catalog)),
    catalog.catalog,
    policyInput,
    obligations,
  );
  if (!compiled.ok) {
    const first = compiled.error[0];
    throw new Error(
      first === undefined
        ? "valid plan: empty diagnostics"
        : `valid plan: ${first.code}: ${first.message}`,
    );
  }
  const executablePlan = compiled.value;
  const planSummary = inspectExecutablePlan(executablePlan);
  if (planSummary === undefined)
    throw new Error("Plan summary is unavailable.");
  const policy = trustedPolicy(
    planSummary.planHash,
    planSummary.semanticContractHash,
    catalog,
  );
  const [structural, semantic, capability, budget] = await Promise.all([
    compilePlan(
      JSON.stringify(invalidStructuralPlan(catalog)),
      catalog.catalog,
      policyInput,
      [],
    ),
    compilePlan(
      JSON.stringify(validPlan(catalog)),
      catalog.catalog,
      policyInput,
      [
        ...obligations,
        {
          kind: "requiresOperation",
          operation: catalog.references.canonicalAction,
        },
      ],
    ),
    compilePlan(
      JSON.stringify(validPlan(catalog)),
      catalog.catalog,
      { allowedCapabilities: [], budget: planBudget },
      obligations,
    ),
    compilePlan(
      JSON.stringify(validPlan(catalog)),
      catalog.catalog,
      {
        allowedCapabilities: [catalog.decisionCapability],
        budget: { ...planBudget, maxEffectCalls: 0 },
      },
      obligations,
    ),
  ]);
  return {
    catalog,
    executablePlan,
    policy,
    planSummary,
    negatives: [
      diagnosticView(
        "invalid-structural-plan",
        structural,
        {
          operation: "select",
          role: "northstar.role/incident-decision-request",
          boundary: "mismatched-branch:whenTrue/whenFalse",
        },
        "Align both select branches to the same registered output schema.",
      ),
      diagnosticView(
        "semantic-obligation-failure",
        semantic,
        {
          operation: `${catalog.references.canonicalAction.id}@${catalog.references.canonicalAction.version}`,
          role: "northstar.role/canonical-action",
          boundary: "root-dependency:requiresOperation",
        },
        "Add the required operation to the root dependency graph or remove the obligation only if the public contract was wrong.",
      ),
      diagnosticView(
        "denied-capability",
        capability,
        {
          operation: `${catalog.references.decide.id}@${catalog.references.decide.version}`,
          role: "northstar.role/record-incident-decision",
          boundary: `capability:${catalog.decisionCapability}`,
        },
        "Grant only the named incident.decision.mock capability in trusted policy when this effect is intended.",
      ),
      diagnosticView(
        "insufficient-budget",
        budget,
        {
          operation: `${catalog.references.decide.id}@${catalog.references.decide.version}`,
          role: "northstar.role/record-incident-decision",
          boundary: "budget:maxEffectCalls",
        },
        "Raise maxEffectCalls to the analyzed requirement or simplify the plan; never hide an unknown or exceeded bound.",
      ),
    ],
  };
}

async function deterministicEffect(invocationCounter: {
  value: number;
}): Promise<OracleEffect> {
  const identity = unwrap(
    await createOracleEffectIdentity({
      id: "northstar-deterministic-incident-effect",
      version: "1",
      implementation: "registry-consumer-fixture/1",
    }),
    "effect identity",
  );
  const effect: OracleEffect = {
    identity,
    invoke: (request, context) => {
      invocationCounter.value += 1;
      const action = request.evidence.facts.find(
        (fact) =>
          fact.subject === "inc-482" && fact.predicate === "recommended-action",
      );
      const output =
        action === undefined
          ? {
              outcome: "insufficient-evidence" as const,
              answerValues: [],
              supportingFactIds: [],
            }
          : {
              outcome: "answered" as const,
              answerValues: [action.object],
              supportingFactIds: [action.id],
            };
      return Promise.resolve({
        ok: true,
        value: {
          wireText: JSON.stringify(output),
          replayResultId: `northstar/${context.requestDigest}`,
          usage: { inputTokens: 32, outputTokens: 8, wallClockMs: 1 },
        },
      });
    },
  };
  return effect;
}

function assertRuntimeResult(result: RuntimeResult): void {
  if (
    result.answer.outcome !== "answered" ||
    result.answer.values[0] !== "page-primary-oncall"
  )
    throw new Error("The runtime answer is incorrect.");
  if (
    result.citations.length !== 1 ||
    result.citations[0]?.id !== "citation-inc-482"
  )
    throw new Error("The runtime citation set is incorrect.");
  if (
    !result.provenance.supportingFactIds.includes("fact-inc-482-action") ||
    !result.provenance.citationIds.includes("citation-inc-482")
  )
    throw new Error("The runtime provenance is incomplete.");
}

export async function runAdoptionRuntime(
  prepared: Awaited<ReturnType<typeof compileAdoptionPlans>>,
): Promise<Readonly<Record<string, unknown>>> {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "northstar-memory-evidence",
      version: "1",
      snapshots: [{ recordedAt: "2026-07-23T00:00:00.000Z", graph }],
    }),
    "evidence store",
  );
  const counter = { value: 0 };
  const seedStore = createMemoryRecordingStore();
  const effect = await deterministicEffect(counter);
  const seed = unwrap(
    await run({
      executablePlan: prepared.executablePlan,
      publicTaskContract: task,
      inputValues: new Map(),
      trustedPolicy: prepared.policy,
      evidenceStore,
      snapshot: {
        validAt: "2026-07-23T00:00:00.000Z",
        recordedAt: null,
      },
      oracle: createRecordingOracleInterpreter(effect),
      recordingStore: seedStore,
      signal: new AbortController().signal,
    }),
    "seed record",
  );
  const seedArtifact = seedStore
    .artifacts()
    .find((artifact) => artifact.artifactDigest === seed.artifactDigest);
  if (seedArtifact === undefined)
    throw new Error("The seed replay artifact is unavailable.");
  const mock = unwrap(
    await createMockOracleInterpreter({
      identity: seedArtifact.oracle.identity,
      fixtures: [
        {
          request: seedArtifact.oracle.request,
          result: { kind: "success", value: seedArtifact.oracle.wireResult },
        },
      ],
    }),
    "mock interpreter",
  );
  const recordingStore = createMemoryRecordingStore();
  const completed = unwrap(
    await run({
      executablePlan: prepared.executablePlan,
      publicTaskContract: task,
      inputValues: new Map(),
      trustedPolicy: prepared.policy,
      evidenceStore,
      snapshot: {
        validAt: "2026-07-23T00:00:00.000Z",
        recordedAt: null,
      },
      oracle: mock,
      recordingStore,
      signal: new AbortController().signal,
    }),
    "mock run",
  );
  assertRuntimeResult(completed.result);
  const callsBeforeReplay = counter.value;
  const replayed = unwrap(
    await replay({
      executablePlan: prepared.executablePlan,
      publicTaskContract: task,
      trustedPolicy: prepared.policy,
      artifactDigest: completed.artifactDigest,
      recordingStore,
      signal: new AbortController().signal,
    }),
    "replay",
  );
  assertRuntimeResult(replayed);
  if (
    callsBeforeReplay !== counter.value ||
    replayed.resultDigest !== completed.result.resultDigest ||
    replayed.planIdentity.planHash !== completed.result.planIdentity.planHash ||
    replayed.planIdentity.semanticContractHash !==
      completed.result.planIdentity.semanticContractHash ||
    replayed.planIdentity.catalogFingerprint !==
      completed.result.planIdentity.catalogFingerprint
  )
    throw new Error("Replay was not exact and zero-effect.");
  return {
    answer: completed.result.answer,
    citations: completed.result.citations,
    provenance: completed.result.provenance,
    artifactDigest: completed.artifactDigest,
    resultDigest: completed.result.resultDigest,
    reconstructionDigest: completed.result.reconstructionDigest,
    planIdentity: completed.result.planIdentity,
    replay: {
      resultDigest: replayed.resultDigest,
      exactIdentityMatch: true,
      additionalEffectInvocations: counter.value - callsBeforeReplay,
    },
    mockEffectInvocations: counter.value,
  };
}
