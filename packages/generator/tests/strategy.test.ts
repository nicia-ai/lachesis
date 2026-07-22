import {
  type Catalog,
  type CompilationPolicy,
  compilePlanJson,
  createCatalog,
  createReplayEffectHandler,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  definePredicate,
  defineReducer,
  defineSchema,
  type ExecutablePlan,
  executePlan,
  recordEffectResult,
  type ReplayEntry,
  type WirePlan,
  wirePlanSchema,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  auditM6FalseEquivalence,
  loadM6OfflineStrategyCorpus,
} from "../src/m6-corpus.js";
import {
  bindStrategyTemplate,
  compileTemplateFirst,
  createStrategyRegistry,
  createStrategyTemplate,
  inspectStrategyRegistry,
  matchStrategyTemplate,
  mineStrategyTraces,
  normalizeSuccessfulStrategyPlan,
  type OracleObservationContract,
  type PublicTaskClass,
  registerStrategyTemplate,
  type StrategyParameterSlot,
  type StrategyPromotionEvidence,
  strategyPromotionEvidenceSchema,
  type StrategyPublicTaskFeatures,
  type StrategyRegistry,
  type StrategyTemplate,
  strategyTemplateHashSchema,
  transitionStrategyTemplate,
  verifyStrategyTemplate,
} from "../src/strategy.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);

const textSchema = defineSchema({
  id: "m6/text",
  version: "1",
  description: "A public text value.",
  validator: z.string(),
});
const textsSchema = defineCollectionSchema({
  id: "m6/texts",
  version: "1",
  description: "A bounded list of text values.",
  validator: z.array(z.string()).readonly(),
  element: textSchema,
  defaultMaxItems: 4,
});
const booleanSchema = defineSchema({
  id: "m6/boolean",
  version: "1",
  description: "A branch condition.",
  validator: z.boolean(),
  semantic: "boolean",
});
const countSchema = defineSchema({
  id: "m6/count",
  version: "1",
  description: "A nonnegative countdown.",
  validator: z.number().int().nonnegative(),
});
const upper = defineFunction({
  id: "m6/upper",
  version: "1",
  description: "Uppercase text.",
  input: textSchema,
  output: textSchema,
  implementation: (value) => value.toUpperCase(),
});
const lower = defineFunction({
  id: "m6/lower",
  version: "1",
  description: "Lowercase text.",
  input: textSchema,
  output: textSchema,
  implementation: (value) => value.toLowerCase(),
  stateChanging: true,
});
const nonempty = definePredicate({
  id: "m6/nonempty",
  version: "1",
  description: "Keep nonempty text.",
  input: textSchema,
  implementation: (value) => value.length > 0,
});
const oracle = defineEffect({
  id: "m6/oracle",
  version: "1",
  description: "A bounded offline oracle.",
  input: textSchema,
  output: textSchema,
  effectName: "oracle.observe",
  capability: "oracle.invoke",
  maxTokens: 8,
  maxWallClockMs: 20,
  replayable: true,
});

function catalogWithOracle(effectClass = "oracle.observe"): Catalog {
  const effect =
    effectClass === "oracle.observe"
      ? oracle
      : defineEffect({
          id: "m6/oracle",
          version: "1",
          description: "A differently classified offline oracle.",
          input: textSchema,
          output: textSchema,
          effectName: effectClass,
          capability: "oracle.invoke",
          maxTokens: 8,
          maxWallClockMs: 20,
          replayable: true,
        });
  const created = createCatalog({
    identity: { id: "m6/catalog", version: "1" },
    schemas: [textSchema.runtime],
    operations: [upper, lower, effect],
  });
  if (!created.ok) throw new Error(created.error[0]?.message);
  return created.value;
}

const policy: CompilationPolicy = {
  allowedCapabilities: ["oracle.invoke"],
  budget: {
    maxEffectCalls: 1,
    maxCollectionItems: 1,
    maxRecursionDepth: 0,
    maxTokens: 8,
    maxWallClockMs: 20,
    maxParallelism: 1,
  },
};

function effectPlan(
  value: string,
  ids: Readonly<{ constant: string; effect: string }> = {
    constant: "source",
    effect: "observed",
  },
  metadataName = "offline observation",
): WirePlan {
  return wirePlanSchema.parse({
    formatVersion: "1",
    catalog: { id: "m6/catalog", version: "1" },
    root: ids.effect,
    nodes: [
      {
        id: ids.constant,
        op: "constant",
        schema: { id: "m6/text", version: "1" },
        value,
      },
      {
        id: ids.effect,
        op: "effect",
        source: ids.constant,
        effect: { id: "m6/oracle", version: "1" },
      },
    ],
    allowedCapabilities: policy.allowedCapabilities,
    budget: policy.budget,
    metadata: { name: metadataName, revision: "1" },
  });
}

async function compile(
  plan: WirePlan,
  catalog: Catalog,
): Promise<ExecutablePlan> {
  const compiled = await compilePlanJson(
    JSON.stringify(plan),
    catalog,
    policy,
    [{ kind: "requiresEffect", effectName: "oracle.observe" }],
  );
  if (!compiled.ok) throw new Error(compiled.error[0]?.message);
  return compiled.value;
}

const taskClass: PublicTaskClass = {
  protocol: "lachesis-public-task-class/1",
  semanticRole: "bounded-observation",
  inputSchemaRoles: ["subject-text"],
  outputSchemaRole: "observation-text",
  semanticObligationKinds: ["requiresEffect"],
  evidenceSufficiencyContract: HEX_A,
};

const observation: OracleObservationContract = {
  protocol: "lachesis-oracle-observation-contract/1",
  leafRole: "bounded-observer",
  promptTemplateDigest: HEX_B,
  inputSchema: { id: "m6/text", version: "1" },
  outputSchema: { id: "m6/text", version: "1" },
  evidenceKinds: ["public-text"],
  maximumSerializedInputBytes: 128,
  maximumSerializedOutputBytes: 128,
  maximumDeclaredTokens: 8,
  tokenEstimatorIdentity: null,
  effectClass: "oracle.observe",
  requiredSemanticOutputObligations: ["bounded-output"],
};

const slot: StrategyParameterSlot = {
  name: "subject",
  target: { kind: "constantValue", nodeId: "source" },
  schema: { id: "m6/text", version: "1" },
  constraints: {
    maximumSerializedBytes: 64,
    maximumCollectionItems: null,
    maximumStringLength: 32,
  },
};

const evidence: StrategyPromotionEvidence = {
  protocol: "lachesis-strategy-promotion-evidence/1",
  validationCaseDigests: [HEX_A, HEX_B],
  firstAttemptCompileSuccesses: 2,
  firstAttemptSemanticSuccesses: 2,
  falseEquivalenceAudit: "pass",
  capabilityBudgetAudit: "pass",
  crossLengthCoverage: true,
  crossDomainCoverage: true,
  providerModelCompatibility: ["offline/mock"],
  validationProtocolDigest: HEX_C,
};

const features: StrategyPublicTaskFeatures = {
  taskClass,
  inputCardinality: 2,
  serializedTaskBytes: 40,
  evidenceSufficiencyContract: HEX_A,
  observationContractDigests: [HEX_D],
};

async function templateAndRegistry(
  metadataName = "offline observation",
): Promise<
  Readonly<{
    template: StrategyTemplate;
    registry: StrategyRegistry;
    catalog: Catalog;
  }>
> {
  const catalog = catalogWithOracle();
  const plan = effectPlan("atlas", undefined, metadataName);
  const executablePlan = await compile(plan, catalog);
  const created = await createStrategyTemplate({
    plan,
    executablePlan,
    catalog,
    taskClass,
    parameterSlots: [slot],
    leafContracts: [{ ...observation, leafRole: "z-observer" }, observation],
    validationEnvelope: {
      minimumInputCardinality: 1,
      maximumInputCardinality: 4,
      maximumSerializedTaskBytes: 100,
      evidenceSufficiencyContract: HEX_A,
      observationContractDigests: [HEX_D],
    },
    candidateEvidence: evidence,
  });
  if (!created.ok) throw new Error(created.error.message);
  const registered = await registerStrategyTemplate({
    registry: createStrategyRegistry(),
    template: created.value,
  });
  if (!registered.ok) throw new Error(registered.error.message);
  const canary = await transitionStrategyTemplate({
    registry: registered.value,
    templateHash: created.value.templateHash,
    to: "canary",
    evidence,
  });
  if (!canary.ok) throw new Error(canary.error.message);
  const stable = await transitionStrategyTemplate({
    registry: canary.value,
    templateHash: created.value.templateHash,
    to: "stable",
    evidence,
  });
  if (!stable.ok) throw new Error(stable.error.message);
  return { template: created.value, registry: stable.value, catalog };
}

describe("M6 strategy normalization", () => {
  it("defines a fresh 6-positive/12-hostile corpus with zero hostile collisions", async () => {
    const corpus = loadM6OfflineStrategyCorpus();
    expect(corpus.provenance).toBe("fresh-synthetic-development-only");
    expect(corpus.positive).toHaveLength(6);
    expect(corpus.hostile).toHaveLength(12);
    const audit = await auditM6FalseEquivalence(
      corpus.hostile.map((item) => ({
        caseId: item.id,
        acceptedAsEquivalent: false,
      })),
    );
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.value.acceptedHostileCollisions).toBe(0);
    expect(audit.value.passed).toBe(true);
    const collision = await auditM6FalseEquivalence(
      corpus.hostile.map((item, index) => ({
        caseId: item.id,
        acceptedAsEquivalent: index === 0,
      })),
    );
    expect(collision.ok && !collision.value.passed).toBe(true);
    expect(
      (
        await auditM6FalseEquivalence(
          corpus.hostile.map(() => ({
            caseId: corpus.hostile[0]?.id ?? "missing",
            acceptedAsEquivalent: false,
          })),
        )
      ).ok,
    ).toBe(false);
  });

  it("is deterministic, alpha-invariant, storage-order invariant, and literal-free", async () => {
    const catalog = catalogWithOracle();
    const firstPlan = effectPlan("atlas");
    const renamedPlan = effectPlan("orchid", {
      constant: "renamed-input",
      effect: "renamed-leaf",
    });
    const reorderedPlan = wirePlanSchema.parse({
      ...renamedPlan,
      nodes: [...renamedPlan.nodes].toReversed(),
    });
    const first = await normalizeSuccessfulStrategyPlan({
      plan: firstPlan,
      executablePlan: await compile(firstPlan, catalog),
      catalog,
      taskClass,
      leafContracts: [observation],
    });
    const renamed = await normalizeSuccessfulStrategyPlan({
      plan: renamedPlan,
      executablePlan: await compile(renamedPlan, catalog),
      catalog,
      taskClass,
      leafContracts: [observation],
    });
    const reordered = await normalizeSuccessfulStrategyPlan({
      plan: reorderedPlan,
      executablePlan: await compile(reorderedPlan, catalog),
      catalog,
      taskClass,
      leafContracts: [observation],
    });
    expect(first.ok && renamed.ok && reordered.ok).toBe(true);
    if (!first.ok || !renamed.ok || !reordered.ok) return;
    expect(renamed.value.trajectoryShapeHash).toBe(
      first.value.trajectoryShapeHash,
    );
    expect(renamed.value.strategyContractHash).toBe(
      first.value.strategyContractHash,
    );
    expect(reordered.value.strategyContractHash).toBe(
      first.value.strategyContractHash,
    );
    expect(first.value.trajectoryShapeCanonical).not.toContain("atlas");
    expect(first.value.strategyContractCanonical).not.toContain("atlas");
    expect(first.value.trajectoryShapeCanonical).not.toContain("source");
  });

  it("keeps semantic task contracts and effect classes distinct", async () => {
    const plan = effectPlan("atlas");
    const catalog = catalogWithOracle();
    const executable = await compile(plan, catalog);
    const original = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan: executable,
      catalog,
      taskClass,
    });
    const otherTask = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan: executable,
      catalog,
      taskClass: {
        ...taskClass,
        semanticObligationKinds: ["requiresStateChange"],
      },
    });
    expect(original.ok && otherTask.ok).toBe(true);
    if (!original.ok || !otherTask.ok) return;
    expect(otherTask.value.trajectoryShapeHash).toBe(
      original.value.trajectoryShapeHash,
    );
    expect(otherTask.value.strategyContractHash).not.toBe(
      original.value.strategyContractHash,
    );

    const changedCatalog = catalogWithOracle("oracle.mutate");
    const changedPlan = effectPlan("atlas");
    const changedCompiled = await compilePlanJson(
      JSON.stringify(changedPlan),
      changedCatalog,
      policy,
      [{ kind: "requiresEffect", effectName: "oracle.mutate" }],
    );
    expect(changedCompiled.ok).toBe(true);
    if (!changedCompiled.ok) return;
    const changed = await normalizeSuccessfulStrategyPlan({
      plan: changedPlan,
      executablePlan: changedCompiled.value,
      catalog: changedCatalog,
      taskClass,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.trajectoryShapeHash).not.toBe(
      original.value.trajectoryShapeHash,
    );
    expect(changed.value.strategyContractHash).not.toBe(
      original.value.strategyContractHash,
    );
  });

  it("is sensitive to reducer laws, recursion measures, state traits, and ordered branches", async () => {
    const reducer = (commutative: boolean) =>
      defineReducer({
        id: "m6/concat",
        version: "1",
        description: "Concatenate text values.",
        element: textSchema,
        accumulator: textSchema,
        identity: "",
        laws: { associative: true, commutative, idempotent: false },
        implementation: (accumulator, element) => accumulator + element,
      });
    const reducerCatalog = (commutative: boolean): Catalog => {
      const created = createCatalog({
        identity: { id: "m6/reducer-catalog", version: "1" },
        schemas: [textSchema.runtime, textsSchema.runtime],
        operations: [reducer(commutative)],
      });
      if (!created.ok) throw new Error(created.error[0]?.message);
      return created.value;
    };
    const foldPlan = wirePlanSchema.parse({
      formatVersion: "1",
      catalog: { id: "m6/reducer-catalog", version: "1" },
      root: "fold",
      nodes: [
        {
          id: "values",
          op: "constant",
          schema: { id: "m6/texts", version: "1" },
          value: ["a", "b"],
        },
        {
          id: "fold",
          op: "fold",
          source: "values",
          reducer: { id: "m6/concat", version: "1" },
        },
      ],
      budget: { ...policy.budget, maxCollectionItems: 4 },
      allowedCapabilities: [],
    });
    const normalizeFold = async (catalog: Catalog) => {
      const executable = await compilePlanJson(
        JSON.stringify(foldPlan),
        catalog,
        {
          ...policy,
          allowedCapabilities: [],
          budget: { ...policy.budget, maxCollectionItems: 4 },
        },
      );
      if (!executable.ok) throw new Error(executable.error[0]?.message);
      return normalizeSuccessfulStrategyPlan({
        plan: foldPlan,
        executablePlan: executable.value,
        catalog,
        taskClass,
      });
    };
    const orderedReducer = await normalizeFold(reducerCatalog(false));
    const commutativeReducer = await normalizeFold(reducerCatalog(true));
    expect(orderedReducer.ok && commutativeReducer.ok).toBe(true);
    if (!orderedReducer.ok || !commutativeReducer.ok) return;
    expect(commutativeReducer.value.trajectoryShapeHash).not.toBe(
      orderedReducer.value.trajectoryShapeHash,
    );

    const step = defineFixedPointStep({
      id: "m6/decrement",
      version: "1",
      description: "Decrement toward zero.",
      state: countSchema,
      implementation: (value: number) => Math.max(0, value - 1),
      stateChanging: true,
    });
    const measureOne = defineMeasure({
      id: "m6/remaining",
      version: "1",
      description: "Direct remaining count.",
      input: countSchema,
      implementation: (value: number) => value,
    });
    const measureTwo = defineMeasure({
      id: "m6/remaining-scaled",
      version: "1",
      description: "Scaled remaining count.",
      input: countSchema,
      implementation: (value: number) => value * 2,
    });
    const recursionCatalogResult = createCatalog({
      identity: { id: "m6/recursion-catalog", version: "1" },
      schemas: [countSchema.runtime],
      operations: [step, measureOne, measureTwo],
    });
    if (!recursionCatalogResult.ok)
      throw new Error(recursionCatalogResult.error[0]?.message);
    const fixPlan = (measure: string) =>
      wirePlanSchema.parse({
        formatVersion: "1",
        catalog: { id: "m6/recursion-catalog", version: "1" },
        root: "fix",
        nodes: [
          {
            id: "seed",
            op: "constant",
            schema: { id: "m6/count", version: "1" },
            value: 2,
          },
          {
            id: "fix",
            op: "boundedFix",
            seed: "seed",
            step: { id: "m6/decrement", version: "1" },
            measure: { id: measure, version: "1" },
            maxIterations: 2,
          },
        ],
        budget: { ...policy.budget, maxRecursionDepth: 2 },
        allowedCapabilities: [],
      });
    const normalizeFix = async (plan: WirePlan) => {
      const recursionPolicy = {
        ...policy,
        allowedCapabilities: [],
        budget: { ...policy.budget, maxRecursionDepth: 2 },
      };
      const executable = await compilePlanJson(
        JSON.stringify(plan),
        recursionCatalogResult.value,
        recursionPolicy,
      );
      if (!executable.ok) throw new Error(executable.error[0]?.message);
      return normalizeSuccessfulStrategyPlan({
        plan,
        executablePlan: executable.value,
        catalog: recursionCatalogResult.value,
        taskClass,
      });
    };
    const firstFix = await normalizeFix(fixPlan("m6/remaining"));
    const secondFix = await normalizeFix(fixPlan("m6/remaining-scaled"));
    expect(firstFix.ok && secondFix.ok).toBe(true);
    if (!firstFix.ok || !secondFix.ok) return;
    expect(secondFix.value.trajectoryShapeHash).toBe(
      firstFix.value.trajectoryShapeHash,
    );
    expect(secondFix.value.strategyContractHash).not.toBe(
      firstFix.value.strategyContractHash,
    );

    const branchCatalogResult = createCatalog({
      identity: { id: "m6/branch-catalog", version: "1" },
      schemas: [textSchema.runtime, booleanSchema.runtime],
      operations: [upper, lower],
    });
    if (!branchCatalogResult.ok)
      throw new Error(branchCatalogResult.error[0]?.message);
    const branchPlan = (swapped: boolean) =>
      wirePlanSchema.parse({
        formatVersion: "1",
        catalog: { id: "m6/branch-catalog", version: "1" },
        root: "selected",
        nodes: [
          {
            id: "condition",
            op: "constant",
            schema: { id: "m6/boolean", version: "1" },
            value: true,
          },
          {
            id: "source",
            op: "constant",
            schema: { id: "m6/text", version: "1" },
            value: "MiXeD",
          },
          {
            id: "upper",
            op: "invoke",
            source: "source",
            function: { id: "m6/upper", version: "1" },
          },
          {
            id: "lower",
            op: "invoke",
            source: "source",
            function: { id: "m6/lower", version: "1" },
          },
          {
            id: "selected",
            op: "select",
            condition: "condition",
            whenTrue: swapped ? "lower" : "upper",
            whenFalse: swapped ? "upper" : "lower",
          },
        ],
        budget: policy.budget,
        allowedCapabilities: [],
      });
    const normalizeBranch = async (plan: WirePlan) => {
      const executable = await compilePlanJson(
        JSON.stringify(plan),
        branchCatalogResult.value,
        { ...policy, allowedCapabilities: [] },
      );
      if (!executable.ok) throw new Error(executable.error[0]?.message);
      return normalizeSuccessfulStrategyPlan({
        plan,
        executablePlan: executable.value,
        catalog: branchCatalogResult.value,
        taskClass,
      });
    };
    const normalBranch = await normalizeBranch(branchPlan(false));
    const swappedBranch = await normalizeBranch(branchPlan(true));
    expect(normalBranch.ok && swappedBranch.ok).toBe(true);
    if (!normalBranch.ok || !swappedBranch.ok) return;
    expect(swappedBranch.value.strategyContractHash).not.toBe(
      normalBranch.value.strategyContractHash,
    );
  });

  it("rejects a plan/executable mismatch and malformed normalization input", async () => {
    const catalog = catalogWithOracle();
    const first = effectPlan("a");
    const mismatch = await normalizeSuccessfulStrategyPlan({
      plan: effectPlan("b"),
      executablePlan: await compile(first, catalog),
      catalog,
      taskClass,
    });
    expect(mismatch.ok).toBe(false);
  });

  it("normalizes checkpoints while erasing their labels", async () => {
    const catalog = catalogWithOracle();
    const plan = wirePlanSchema.parse({
      ...effectPlan("checkpointed"),
      root: "saved",
      nodes: [
        {
          id: "source",
          op: "constant",
          schema: { id: "m6/text", version: "1" },
          value: "checkpointed",
        },
        {
          id: "saved",
          op: "checkpoint",
          source: "source",
          label: "private-label",
        },
      ],
    });
    const executable = await compilePlanJson(
      JSON.stringify(plan),
      catalog,
      policy,
    );
    expect(executable.ok).toBe(true);
    if (!executable.ok) return;
    const normalized = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan: executable.value,
      catalog,
      taskClass,
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.strategyContractCanonical).not.toContain(
      "private-label",
    );
  });

  it("normalizes input, map, and filter roles with trusted operation traits", async () => {
    const created = createCatalog({
      identity: { id: "m6/map-catalog", version: "1" },
      schemas: [textSchema.runtime, textsSchema.runtime],
      operations: [upper, nonempty],
    });
    if (!created.ok) throw new Error(created.error[0]?.message);
    const mapPolicy: CompilationPolicy = {
      ...policy,
      allowedCapabilities: [],
      budget: { ...policy.budget, maxCollectionItems: 4 },
    };
    const plan = wirePlanSchema.parse({
      formatVersion: "1",
      catalog: { id: "m6/map-catalog", version: "1" },
      root: "filtered",
      nodes: [
        {
          id: "public-values",
          op: "input",
          inputKey: "values",
          schema: { id: "m6/texts", version: "1" },
          maxItems: 4,
        },
        {
          id: "mapped",
          op: "map",
          source: "public-values",
          operation: { kind: "function", id: "m6/upper", version: "1" },
          outputCollectionSchema: { id: "m6/texts", version: "1" },
          parallelism: 1,
        },
        {
          id: "filtered",
          op: "filter",
          source: "mapped",
          predicate: { id: "m6/nonempty", version: "1" },
        },
      ],
      allowedCapabilities: [],
      budget: mapPolicy.budget,
    });
    const executable = await compilePlanJson(
      JSON.stringify(plan),
      created.value,
      mapPolicy,
    );
    expect(executable.ok).toBe(true);
    if (!executable.ok) return;
    const normalized = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan: executable.value,
      catalog: created.value,
      taskClass,
      leafContracts: [
        { ...observation, leafRole: "z-observer" },
        observation,
        observation,
      ],
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.trajectoryShapeCanonical).toContain('"op":"map"');
    expect(normalized.value.strategyContractCanonical).toContain(
      '"kind":"predicate"',
    );
  });
});

describe("M6 templates, lifecycle, matching, and binding", () => {
  it("binds a new domain literal through ordinary compilation without a planner call", async () => {
    const fixture = await templateAndRegistry();
    let plannerCalls = 0;
    const result = await compileTemplateFirst({
      registry: fixture.registry,
      features,
      bindings: [{ name: "subject", value: "unrelated-domain-value" }],
      catalog: fixture.catalog,
      policy,
      planner: {
        discover: () => {
          plannerCalls += 1;
          return Promise.resolve({ kind: "discovery-required" });
        },
      },
    });
    expect(result.kind).toBe("template-hit");
    expect(plannerCalls).toBe(0);
    if (result.kind !== "template-hit") return;
    expect(result.bound.plan.nodes[0]).toMatchObject({
      op: "constant",
      value: "unrelated-domain-value",
    });
  });

  it("rejects missing, duplicate, extra, incompatible, constrained, authority, and catalog bindings", async () => {
    const fixture = await templateAndRegistry();
    const cases = [
      await bindStrategyTemplate({ ...fixture, bindings: [], policy }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [
          { name: "subject", value: "x" },
          { name: "subject", value: "y" },
        ],
        policy,
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "extra", value: "x" }],
        policy,
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: 7 }],
        policy,
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x".repeat(40) }],
        policy,
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxTokens: 9 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxEffectCalls: 2 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxCollectionItems: 2 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxRecursionDepth: 1 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxWallClockMs: 21 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxParallelism: 2 },
        },
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: { ...policy, allowedCapabilities: ["untrusted-capability"] },
      }),
      await bindStrategyTemplate({
        ...fixture,
        catalog: catalogWithOracle("oracle.other"),
        bindings: [{ name: "subject", value: "x" }],
        policy,
      }),
      await bindStrategyTemplate({
        ...fixture,
        bindings: [{ name: "subject", value: "x" }],
        policy: {
          ...policy,
          budget: { ...policy.budget, maxTokens: 7 },
        },
      }),
    ];
    expect(
      cases.map((result) => (result.ok ? "ok" : result.error.kind)),
    ).toEqual([
      "missing-binding",
      "duplicate-binding",
      "extra-binding",
      "type-incompatible-binding",
      "constraint-violating-binding",
      "authority-widening",
      "authority-widening",
      "authority-widening",
      "authority-widening",
      "authority-widening",
      "authority-widening",
      "authority-widening",
      "catalog-mismatch",
      "compile-rejected",
    ]);
  });

  it("fails closed for task mismatch, envelope overflow, and ambiguous stable matches", async () => {
    const first = await templateAndRegistry("first");
    const miss = await matchStrategyTemplate(first.registry, {
      ...features,
      taskClass: { ...taskClass, semanticRole: "different-decomposition" },
    });
    const outside = await matchStrategyTemplate(first.registry, {
      ...features,
      inputCardinality: 5,
    });
    expect(miss.kind).toBe("strategy-miss");
    expect(outside.kind).toBe("outside-validation-envelope");

    const second = await templateAndRegistry("second");
    const registered = await registerStrategyTemplate({
      registry: first.registry,
      template: second.template,
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const canary = await transitionStrategyTemplate({
      registry: registered.value,
      templateHash: second.template.templateHash,
      to: "canary",
      evidence,
    });
    expect(canary.ok).toBe(true);
    if (!canary.ok) return;
    const stable = await transitionStrategyTemplate({
      registry: canary.value,
      templateHash: second.template.templateHash,
      to: "stable",
      evidence,
    });
    expect(stable.ok).toBe(true);
    if (!stable.ok) return;
    const ambiguous = await matchStrategyTemplate(stable.value, features);
    expect(ambiguous.kind).toBe("ambiguous-strategy-match");
    expect(inspectStrategyRegistry(stable.value)?.templates).toHaveLength(2);
  });

  it("keeps immutable lifecycle identities and detects template/evidence misuse", async () => {
    const fixture = await templateAndRegistry();
    const inspected = inspectStrategyRegistry(fixture.registry);
    expect(inspected?.events.map((event) => event.to)).toEqual([
      "candidate",
      "canary",
      "stable",
    ]);
    expect(
      new Set(inspected?.events.map((event) => event.eventHash)).size,
    ).toBe(3);
    const duplicate = await registerStrategyTemplate({
      registry: fixture.registry,
      template: fixture.template,
    });
    expect(duplicate.ok && duplicate.value === fixture.registry).toBe(true);
    const tampered = await verifyStrategyTemplate({
      ...fixture.template,
      catalogFingerprint: HEX_D,
    });
    expect(tampered.ok).toBe(false);
    const reordered = await verifyStrategyTemplate({
      ...fixture.template,
      candidateEvidence: {
        ...fixture.template.candidateEvidence,
        validationCaseDigests: [HEX_B, HEX_A],
      },
    });
    expect(reordered.ok).toBe(false);
    const invalidStable = await transitionStrategyTemplate({
      registry: fixture.registry,
      templateHash: fixture.template.templateHash,
      to: "stable",
      evidence,
    });
    expect(invalidStable.ok).toBe(false);
    const deprecated = await transitionStrategyTemplate({
      registry: fixture.registry,
      templateHash: fixture.template.templateHash,
      to: "deprecated",
      evidence,
    });
    expect(deprecated.ok).toBe(true);
    if (!deprecated.ok) return;
    expect((await matchStrategyTemplate(deprecated.value, features)).kind).toBe(
      "strategy-miss",
    );
    expect(fixture.template.templateHash).toBe(
      inspectStrategyRegistry(deprecated.value)?.templates[0]?.templateHash,
    );
  });

  it("invokes the injected planner only for typed fallback paths", async () => {
    const fixture = await templateAndRegistry();
    let calls = 0;
    const result = await compileTemplateFirst({
      registry: fixture.registry,
      features: { ...features, serializedTaskBytes: 101 },
      bindings: [{ name: "subject", value: "x" }],
      catalog: fixture.catalog,
      policy,
      planner: {
        discover: () => {
          calls += 1;
          return Promise.resolve({ kind: "discovery-required" });
        },
      },
    });
    expect(result.kind).toBe("outside-validation-envelope");
    expect(calls).toBe(1);
  });

  it("rejects hostile template construction, promotion, and binding inputs", async () => {
    expect(
      strategyPromotionEvidenceSchema.safeParse({
        ...evidence,
        validationCaseDigests: [HEX_A],
        firstAttemptCompileSuccesses: 2,
        firstAttemptSemanticSuccesses: 2,
      }).success,
    ).toBe(false);
    expect(
      strategyPromotionEvidenceSchema.safeParse({
        ...evidence,
        validationCaseDigests: [HEX_A, HEX_A],
      }).success,
    ).toBe(false);

    const catalog = catalogWithOracle();
    const plan = effectPlan("hostile");
    const executablePlan = await compile(plan, catalog);
    const duplicateTarget = await createStrategyTemplate({
      plan,
      executablePlan,
      catalog,
      taskClass,
      parameterSlots: [slot, { ...slot, name: "other" }],
      leafContracts: [observation],
      validationEnvelope: {
        minimumInputCardinality: 1,
        maximumInputCardinality: 2,
        maximumSerializedTaskBytes: 100,
        evidenceSufficiencyContract: HEX_A,
        observationContractDigests: [HEX_D],
      },
      candidateEvidence: evidence,
    });
    const duplicateName = await createStrategyTemplate({
      plan,
      executablePlan,
      catalog,
      taskClass,
      parameterSlots: [
        slot,
        { ...slot, target: { kind: "constantValue", nodeId: "missing" } },
      ],
      leafContracts: [observation],
      validationEnvelope: {
        minimumInputCardinality: 1,
        maximumInputCardinality: 2,
        maximumSerializedTaskBytes: 100,
        evidenceSufficiencyContract: HEX_A,
        observationContractDigests: [HEX_D],
      },
      candidateEvidence: evidence,
    });
    const missingTarget = await createStrategyTemplate({
      plan,
      executablePlan,
      catalog,
      taskClass,
      parameterSlots: [
        { ...slot, target: { kind: "constantValue", nodeId: "observed" } },
      ],
      leafContracts: [observation],
      validationEnvelope: {
        minimumInputCardinality: 1,
        maximumInputCardinality: 2,
        maximumSerializedTaskBytes: 100,
        evidenceSufficiencyContract: HEX_A,
        observationContractDigests: [HEX_D],
      },
      candidateEvidence: evidence,
    });
    expect(duplicateTarget.ok).toBe(false);
    expect(duplicateName.ok).toBe(false);
    expect(missingTarget.ok).toBe(false);

    const fixture = await templateAndRegistry();
    const invalidBound = await bindStrategyTemplate({
      template: {
        ...fixture.template,
        templateHash: strategyTemplateHashSchema.parse(HEX_D),
      },
      bindings: [{ name: "subject", value: "x" }],
      catalog: fixture.catalog,
      policy,
    });
    expect(invalidBound.ok ? "ok" : invalidBound.error.kind).toBe(
      "invalid-template",
    );

    let plannerCalls = 0;
    const bindingFallback = await compileTemplateFirst({
      registry: fixture.registry,
      features,
      bindings: [{ name: "subject", value: "x".repeat(40) }],
      catalog: fixture.catalog,
      policy,
      planner: {
        discover: () => {
          plannerCalls += 1;
          return Promise.resolve({ kind: "discovery-required" });
        },
      },
    });
    expect(bindingFallback.kind).toBe("binding-rejected");
    expect(plannerCalls).toBe(1);

    const unknown = await transitionStrategyTemplate({
      registry: fixture.registry,
      templateHash: strategyTemplateHashSchema.parse(HEX_D),
      to: "deprecated",
      evidence,
    });
    expect(unknown.ok).toBe(false);

    const registered = await registerStrategyTemplate({
      registry: createStrategyRegistry(),
      template: fixture.template,
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const canary = await transitionStrategyTemplate({
      registry: registered.value,
      templateHash: fixture.template.templateHash,
      to: "canary",
      evidence,
    });
    expect(canary.ok).toBe(true);
    if (!canary.ok) return;
    const insufficient = await transitionStrategyTemplate({
      registry: canary.value,
      templateHash: fixture.template.templateHash,
      to: "stable",
      evidence: {
        ...evidence,
        validationCaseDigests: [HEX_A],
        firstAttemptCompileSuccesses: 1,
        firstAttemptSemanticSuccesses: 1,
      },
    });
    expect(insufficient.ok).toBe(false);
  });

  it("rejects malformed public boundaries before registry use", async () => {
    expect((await verifyStrategyTemplate({})).ok).toBe(false);
    const catalog = catalogWithOracle();
    const plan = effectPlan("boundary");
    const executablePlan = await compile(plan, catalog);
    const invalidNormalization = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan,
      catalog,
      taskClass: { ...taskClass, semanticRole: "" },
      leafContracts: [{ ...observation, maximumSerializedInputBytes: -1 }],
    });
    expect(invalidNormalization.ok).toBe(false);
    const mismatchedCatalog = await normalizeSuccessfulStrategyPlan({
      plan,
      executablePlan,
      catalog: catalogWithOracle("oracle.different"),
      taskClass,
    });
    expect(mismatchedCatalog.ok).toBe(false);
    const invalidTemplateInput = await createStrategyTemplate({
      plan,
      executablePlan,
      catalog,
      taskClass,
      parameterSlots: [slot],
      leafContracts: [observation],
      validationEnvelope: {
        minimumInputCardinality: 3,
        maximumInputCardinality: 2,
        maximumSerializedTaskBytes: 100,
        evidenceSufficiencyContract: HEX_A,
        observationContractDigests: [HEX_D],
      },
      candidateEvidence: evidence,
    });
    expect(invalidTemplateInput.ok).toBe(false);
    const fixture = await templateAndRegistry();
    const invalidRegistration = await registerStrategyTemplate({
      registry: createStrategyRegistry(),
      template: {
        ...fixture.template,
        templateHash: strategyTemplateHashSchema.parse(HEX_D),
      },
    });
    expect(invalidRegistration.ok).toBe(false);
    const invalidTransition = await transitionStrategyTemplate({
      registry: fixture.registry,
      templateHash: fixture.template.templateHash,
      to: "deprecated",
      evidence: {
        ...evidence,
        validationCaseDigests: [HEX_A],
        firstAttemptCompileSuccesses: 2,
      },
    });
    expect(invalidTransition.ok).toBe(false);
    const invalidMatch = await matchStrategyTemplate(fixture.registry, {
      ...features,
      taskClass: { ...taskClass, semanticRole: "" },
    });
    expect(invalidMatch.kind).toBe("strategy-miss");
  });

  it("preserves an unslotted literal in a metadata-free skeleton", async () => {
    const catalog = catalogWithOracle();
    const plan = wirePlanSchema.parse({
      formatVersion: "1",
      catalog: { id: "m6/catalog", version: "1" },
      root: "saved",
      nodes: [
        {
          id: "source",
          op: "constant",
          schema: { id: "m6/text", version: "1" },
          value: "literal",
        },
        { id: "saved", op: "checkpoint", source: "source", label: "safe" },
      ],
      allowedCapabilities: [],
      budget: policy.budget,
    });
    const purePolicy = { ...policy, allowedCapabilities: [] };
    const executablePlan = await compilePlanJson(
      JSON.stringify(plan),
      catalog,
      purePolicy,
    );
    expect(executablePlan.ok).toBe(true);
    if (!executablePlan.ok) return;
    const template = await createStrategyTemplate({
      plan,
      executablePlan: executablePlan.value,
      catalog,
      taskClass,
      parameterSlots: [],
      leafContracts: [],
      validationEnvelope: {
        minimumInputCardinality: 0,
        maximumInputCardinality: 0,
        maximumSerializedTaskBytes: 0,
        evidenceSufficiencyContract: HEX_A,
        observationContractDigests: [],
      },
      candidateEvidence: evidence,
    });
    expect(template.ok).toBe(true);
    if (!template.ok) return;
    const bound = await bindStrategyTemplate({
      template: template.value,
      bindings: [],
      catalog,
      policy: purePolicy,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.plan.nodes[0]).toMatchObject({ value: "literal" });
  });
});

describe("M6 exact replay and trace mining", () => {
  it("binds replay to exact instantiation and replays with zero host effects", async () => {
    const fixture = await templateAndRegistry();
    const bound = await bindStrategyTemplate({
      template: fixture.template,
      bindings: [{ name: "subject", value: "replay-me" }],
      catalog: fixture.catalog,
      policy,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const entries: Array<ReplayEntry> = [];
    let hostEffects = 0;
    const recorded = await executePlan(bound.value.executablePlan, {
      inputs: new Map(),
      effectHandler: async (request) => {
        hostEffects += 1;
        const result = {
          value: "REPLAY-ME",
          replayResultId: "offline/1",
          usage: { tokens: 1, wallClockMs: 1 },
        };
        const entry = await recordEffectResult(request, result);
        if (entry.ok) entries.push(entry.value);
        return { ok: true, value: result };
      },
      clock: { now: () => "2026-07-21T00:00:00.000Z" },
      runIdProvider: { next: () => "m6-record" },
    });
    expect(recorded.ok).toBe(true);
    expect(hostEffects).toBe(1);
    const replayed = await executePlan(bound.value.executablePlan, {
      inputs: new Map(),
      effectHandler: createReplayEffectHandler(entries),
      clock: { now: () => "2026-07-21T00:00:00.000Z" },
      runIdProvider: { next: () => "m6-replay" },
    });
    expect(replayed.ok).toBe(true);
    expect(hostEffects).toBe(1);
    if (!recorded.ok || !replayed.ok) return;
    expect(replayed.value.output).toBe(recorded.value.output);
    expect(entries[0]?.semanticContractHash).toBe(
      recorded.value.trace.semanticContractHash,
    );
  });

  it("groups only bounded sanitized identities", async () => {
    const fixture = await templateAndRegistry();
    const first = await bindStrategyTemplate({
      template: fixture.template,
      bindings: [{ name: "subject", value: "a" }],
      catalog: fixture.catalog,
      policy,
    });
    const second = await bindStrategyTemplate({
      template: fixture.template,
      bindings: [{ name: "subject", value: "b" }],
      catalog: fixture.catalog,
      policy,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const report = await mineStrategyTraces([
      {
        traceDigest: HEX_A,
        trajectoryShapeHash: fixture.template.trajectoryShapeHash,
        strategyContractHash: fixture.template.strategyContractHash,
        exactInstantiationHash: first.value.exactInstantiationHash,
      },
      {
        traceDigest: HEX_B,
        trajectoryShapeHash: fixture.template.trajectoryShapeHash,
        strategyContractHash: fixture.template.strategyContractHash,
        exactInstantiationHash: second.value.exactInstantiationHash,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.traceCount).toBe(2);
    expect(report.value.byTrajectoryShape[0]?.count).toBe(2);
    expect(report.value.byStrategyContract[0]?.count).toBe(2);
    expect(report.value.byExactInstantiation).toHaveLength(2);
    expect(JSON.stringify(report.value)).not.toContain("replay-me");
    expect((await mineStrategyTraces([{ prompt: "private" }])).ok).toBe(false);
  });
});
