import {
  canonicalizeJson,
  canonicalizeSemanticObligations,
  type Catalog,
  type CompilationPolicy,
  compilePlanJson,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ExecutablePlan,
  inspectExecutablePlan,
  type NodeId,
  type OperationReference,
  readCatalog,
  type Result,
  semanticObligationSchema,
  type WireNode,
  wireNodeSchema,
  type WirePlan,
  wirePlanSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { strictJsonValueSchema } from "./strict-json.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const trajectoryShapeHashSchema =
  sha256Schema.brand<"TrajectoryShapeHash">();
export const strategyContractHashSchema =
  sha256Schema.brand<"StrategyContractHash">();
export const strategyTemplateHashSchema =
  sha256Schema.brand<"StrategyTemplateHash">();
export const strategyLifecycleEventHashSchema =
  sha256Schema.brand<"StrategyLifecycleEventHash">();
export const exactStrategyInstantiationHashSchema =
  sha256Schema.brand<"ExactStrategyInstantiationHash">();

export type TrajectoryShapeHash = z.infer<typeof trajectoryShapeHashSchema>;
export type StrategyContractHash = z.infer<typeof strategyContractHashSchema>;
export type StrategyTemplateHash = z.infer<typeof strategyTemplateHashSchema>;
export type StrategyLifecycleEventHash = z.infer<
  typeof strategyLifecycleEventHashSchema
>;
export type ExactStrategyInstantiationHash = z.infer<
  typeof exactStrategyInstantiationHashSchema
>;

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/);

export const publicTaskClassSchema = z
  .strictObject({
    protocol: z.literal("lachesis-public-task-class/1"),
    semanticRole: identifierSchema,
    inputSchemaRoles: z.array(identifierSchema).max(64).readonly(),
    outputSchemaRole: identifierSchema,
    semanticObligationKinds: z
      .array(
        z.enum([
          "requiresOperation",
          "operationDominatesRoot",
          "rootDependsOnInput",
          "requiresStateChange",
          "requiresEffect",
        ]),
      )
      .max(64)
      .readonly(),
    evidenceSufficiencyContract: sha256Schema,
  })
  .readonly();

export type PublicTaskClass = z.infer<typeof publicTaskClassSchema>;

export const oracleObservationContractSchema = z
  .strictObject({
    protocol: z.literal("lachesis-oracle-observation-contract/1"),
    leafRole: identifierSchema,
    promptTemplateDigest: sha256Schema,
    inputSchema: z.strictObject({ id: identifierSchema, version: z.string() }),
    outputSchema: z.strictObject({ id: identifierSchema, version: z.string() }),
    evidenceKinds: z.array(identifierSchema).max(64).readonly(),
    maximumSerializedInputBytes: z.number().int().nonnegative(),
    maximumSerializedOutputBytes: z.number().int().nonnegative(),
    maximumDeclaredTokens: z.number().int().nonnegative(),
    tokenEstimatorIdentity: identifierSchema.nullable(),
    effectClass: identifierSchema,
    requiredSemanticOutputObligations: z
      .array(identifierSchema)
      .max(64)
      .readonly(),
  })
  .readonly();

export type OracleObservationContract = z.infer<
  typeof oracleObservationContractSchema
>;

export const strategyValidationEnvelopeSchema = z
  .strictObject({
    minimumInputCardinality: z.number().int().nonnegative(),
    maximumInputCardinality: z.number().int().nonnegative(),
    maximumSerializedTaskBytes: z.number().int().nonnegative(),
    evidenceSufficiencyContract: sha256Schema,
    observationContractDigests: z.array(sha256Schema).max(64).readonly(),
  })
  .refine(
    (value) => value.minimumInputCardinality <= value.maximumInputCardinality,
    { message: "Minimum cardinality must not exceed maximum cardinality." },
  )
  .readonly();

export type StrategyValidationEnvelope = z.infer<
  typeof strategyValidationEnvelopeSchema
>;

const strategyParameterConstraintSchema = z
  .strictObject({
    maximumSerializedBytes: z.number().int().nonnegative(),
    maximumCollectionItems: z.number().int().nonnegative().nullable(),
    maximumStringLength: z.number().int().nonnegative().nullable(),
  })
  .readonly();

export const strategyParameterSlotSchema = z
  .strictObject({
    name: identifierSchema,
    target: z
      .strictObject({
        kind: z.literal("constantValue"),
        nodeId: identifierSchema,
      })
      .readonly(),
    schema: z.strictObject({ id: identifierSchema, version: z.string() }),
    constraints: strategyParameterConstraintSchema,
  })
  .readonly();

export type StrategyParameterSlot = z.infer<typeof strategyParameterSlotSchema>;

const slottedConstantNodeSchema = wireNodeSchema.options[1]
  .unwrap()
  .omit({ value: true })
  .extend({
    value: z.discriminatedUnion("kind", [
      z
        .strictObject({
          kind: z.literal("literal"),
          value: strictJsonValueSchema,
        })
        .readonly(),
      z
        .strictObject({ kind: z.literal("slot"), slot: identifierSchema })
        .readonly(),
    ]),
  })
  .readonly();

const planSkeletonNodeSchema = z.discriminatedUnion("op", [
  wireNodeSchema.options[0],
  slottedConstantNodeSchema,
  wireNodeSchema.options[2],
  wireNodeSchema.options[3],
  wireNodeSchema.options[4],
  wireNodeSchema.options[5],
  wireNodeSchema.options[6],
  wireNodeSchema.options[7],
  wireNodeSchema.options[8],
  wireNodeSchema.options[9],
]);

export const planSkeletonSchema = wirePlanSchema
  .unwrap()
  .omit({ allowedCapabilities: true, budget: true })
  .extend({
    nodes: z.array(planSkeletonNodeSchema).min(1).max(10_000).readonly(),
  })
  .readonly();

export type PlanSkeleton = z.infer<typeof planSkeletonSchema>;

const capabilityCeilingSchema = z
  .strictObject({
    allowedCapabilities: z.array(identifierSchema).max(256).readonly(),
    budget: wirePlanSchema.unwrap().shape.budget,
  })
  .readonly();

export const strategyPromotionEvidenceSchema = z
  .strictObject({
    protocol: z.literal("lachesis-strategy-promotion-evidence/1"),
    validationCaseDigests: z.array(sha256Schema).min(1).max(10_000).readonly(),
    firstAttemptCompileSuccesses: z.number().int().nonnegative(),
    firstAttemptSemanticSuccesses: z.number().int().nonnegative(),
    falseEquivalenceAudit: z.literal("pass"),
    capabilityBudgetAudit: z.literal("pass"),
    crossLengthCoverage: z.boolean(),
    crossDomainCoverage: z.boolean(),
    providerModelCompatibility: z.array(identifierSchema).max(64).readonly(),
    validationProtocolDigest: sha256Schema,
  })
  .superRefine((value, context) => {
    const count = value.validationCaseDigests.length;
    if (new Set(value.validationCaseDigests).size !== count)
      context.addIssue({
        code: "custom",
        message: "Validation case identities must be unique.",
      });
    if (value.firstAttemptCompileSuccesses > count)
      context.addIssue({
        code: "custom",
        message: "Compile successes cannot exceed validation cases.",
      });
    if (value.firstAttemptSemanticSuccesses > count)
      context.addIssue({
        code: "custom",
        message: "Semantic successes cannot exceed validation cases.",
      });
  })
  .readonly();

export type StrategyPromotionEvidence = z.infer<
  typeof strategyPromotionEvidenceSchema
>;

const strategyTemplateBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-strategy-template/1"),
    trajectoryShapeHash: trajectoryShapeHashSchema,
    strategyContractHash: strategyContractHashSchema,
    taskClass: publicTaskClassSchema,
    planSkeleton: planSkeletonSchema,
    parameterSlots: z.array(strategyParameterSlotSchema).max(256).readonly(),
    semanticObligations: z.array(semanticObligationSchema).max(256).readonly(),
    capabilityCeiling: capabilityCeilingSchema,
    catalogFingerprint: sha256Schema,
    leafContracts: z.array(oracleObservationContractSchema).max(64).readonly(),
    validationEnvelope: strategyValidationEnvelopeSchema,
    candidateEvidence: strategyPromotionEvidenceSchema,
  })
  .readonly();

export const strategyTemplateSchema = strategyTemplateBodySchema
  .unwrap()
  .extend({ templateHash: strategyTemplateHashSchema })
  .readonly();

export type StrategyTemplate = z.infer<typeof strategyTemplateSchema>;

export type StrategyParameterBinding = Readonly<{
  name: string;
  value: unknown;
}>;

export type NormalizedStrategyPlan = Readonly<{
  trajectoryShapeHash: TrajectoryShapeHash;
  strategyContractHash: StrategyContractHash;
  trajectoryShapeCanonical: string;
  strategyContractCanonical: string;
}>;

function referenceKey(
  reference: Readonly<{ id: string; version: string }>,
): string {
  return `${reference.id}@${reference.version}`;
}

function operationForNode(node: WireNode): OperationReference | undefined {
  switch (node.op) {
    case "invoke":
      return node.function;
    case "map":
      return node.operation;
    case "filter":
      return node.predicate;
    case "fold":
      return node.reducer;
    case "effect":
      return node.effect;
    case "boundedFix":
      return node.step;
    case "input":
    case "constant":
    case "select":
    case "checkpoint":
      return undefined;
  }
}

function dependencyIds(node: WireNode): ReadonlyArray<NodeId> {
  switch (node.op) {
    case "input":
    case "constant":
      return [];
    case "invoke":
    case "map":
    case "filter":
    case "fold":
    case "effect":
    case "checkpoint":
      return [node.source];
    case "select":
      return [node.condition, node.whenTrue, node.whenFalse];
    case "boundedFix":
      return [node.seed];
  }
}

type CanonicalDescriptor = Readonly<{
  op: WireNode["op"];
  dependencies: ReadonlyArray<number>;
  detail: unknown;
}>;

type CanonicalNode = Readonly<{
  role: number;
  shape: CanonicalDescriptor;
  contract: CanonicalDescriptor;
}>;

function canonicalNode(
  node: WireNode,
  role: number,
  dependencies: ReadonlyArray<number>,
  catalog: Catalog,
): CanonicalNode {
  const state = readCatalog(catalog);
  const operationReference = operationForNode(node);
  const operation =
    operationReference === undefined
      ? undefined
      : state.operations.get(referenceKey(operationReference));
  const base = { op: node.op, dependencies: [...dependencies] };
  const operationContract =
    operation === undefined
      ? null
      : operation.kind === "reducer"
        ? {
            reference: operationReference,
            kind: operation.kind,
            stateChanging: operation.semantics.stateChanging,
            laws: operation.laws,
            element: operation.element,
            accumulator: operation.accumulator,
          }
        : operation.kind === "effect"
          ? {
              reference: operationReference,
              kind: operation.kind,
              stateChanging: operation.semantics.stateChanging,
              input: operation.input,
              output: operation.output,
              effectClass: operation.effectName,
              replayable: operation.replayable,
            }
          : {
              reference: operationReference,
              kind: operation.kind,
              stateChanging: operation.semantics.stateChanging,
              input: operation.input,
              ...(operation.kind === "predicate" || operation.kind === "measure"
                ? {}
                : { output: operation.output }),
            };
  let shapeDetail: unknown;
  let contractDetail: unknown;
  switch (node.op) {
    case "input":
      shapeDetail = null;
      contractDetail = { schema: node.schema };
      break;
    case "constant":
      shapeDetail = null;
      contractDetail = { schema: node.schema };
      break;
    case "map":
      shapeDetail = {
        operationKind: node.operation.kind,
        reducerLaws: null,
        effectClass: operation?.kind === "effect" ? operation.effectName : null,
      };
      contractDetail = {
        shape: shapeDetail,
        operation: operationContract,
        outputCollectionSchema: node.outputCollectionSchema,
        parallelism: node.parallelism,
      };
      break;
    case "fold":
      shapeDetail = {
        reducerLaws: operation?.kind === "reducer" ? operation.laws : null,
      };
      contractDetail = { shape: shapeDetail, operation: operationContract };
      break;
    case "boundedFix": {
      const measure = state.operations.get(referenceKey(node.measure));
      shapeDetail = { boundedRecursion: true };
      contractDetail = {
        shape: shapeDetail,
        step: operationContract,
        measure:
          measure?.kind !== "measure"
            ? null
            : {
                reference: node.measure,
                kind: measure.kind,
                input: measure.input,
                stateChanging: measure.semantics.stateChanging,
              },
        maxIterations: node.maxIterations,
      };
      break;
    }
    case "select":
      shapeDetail = { branchOrder: ["condition", "true", "false"] };
      contractDetail = shapeDetail;
      break;
    case "checkpoint":
      shapeDetail = null;
      contractDetail = null;
      break;
    case "invoke":
    case "filter":
    case "effect":
      shapeDetail = {
        effectClass: operation?.kind === "effect" ? operation.effectName : null,
      };
      contractDetail = { shape: shapeDetail, operation: operationContract };
      break;
  }
  return {
    role,
    shape: { ...base, detail: shapeDetail },
    contract: { ...base, detail: contractDetail },
  };
}

function canonicalNodes(
  plan: WirePlan,
  catalog: Catalog,
): Result<ReadonlyArray<CanonicalNode>, Diagnostic> {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  const roles = new Map<string, number>();
  const result: Array<CanonicalNode> = [];
  const visiting = new Set<string>();
  function visit(nodeId: NodeId): Result<number, Diagnostic> {
    const existing = roles.get(nodeId);
    if (existing !== undefined) return { ok: true, value: existing };
    if (visiting.has(nodeId))
      return {
        ok: false,
        error: diagnostic(
          "GRAPH_CYCLE",
          "Strategy normalization found a cycle.",
        ),
      };
    const node = nodes.get(nodeId);
    if (node === undefined)
      return {
        ok: false,
        error: diagnostic(
          "MISSING_NODE_REFERENCE",
          "Strategy normalization found a dangling node reference.",
        ),
      };
    visiting.add(nodeId);
    const dependencyRoles: Array<number> = [];
    for (const dependency of dependencyIds(node)) {
      const visited = visit(dependency);
      if (!visited.ok) return visited;
      dependencyRoles.push(visited.value);
    }
    visiting.delete(nodeId);
    const role = result.length;
    roles.set(nodeId, role);
    result.push(canonicalNode(node, role, dependencyRoles, catalog));
    return { ok: true, value: role };
  }
  const root = visit(plan.root);
  return root.ok ? { ok: true, value: Object.freeze(result) } : root;
}

function sortedUnique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)].toSorted();
}

function canonicalTaskClass(taskClass: PublicTaskClass): PublicTaskClass {
  return publicTaskClassSchema.parse({
    ...taskClass,
    inputSchemaRoles: sortedUnique(taskClass.inputSchemaRoles),
    semanticObligationKinds: sortedUnique(taskClass.semanticObligationKinds),
  });
}

function canonicalObservationContract(
  contract: OracleObservationContract,
): OracleObservationContract {
  return oracleObservationContractSchema.parse({
    ...contract,
    evidenceKinds: sortedUnique(contract.evidenceKinds),
    requiredSemanticOutputObligations: sortedUnique(
      contract.requiredSemanticOutputObligations,
    ),
  });
}

function canonicalPromotionEvidence(
  promotionEvidence: StrategyPromotionEvidence,
): StrategyPromotionEvidence {
  return strategyPromotionEvidenceSchema.parse({
    ...promotionEvidence,
    validationCaseDigests: sortedUnique(
      promotionEvidence.validationCaseDigests,
    ),
    providerModelCompatibility: sortedUnique(
      promotionEvidence.providerModelCompatibility,
    ),
  });
}

function canonicalEnvelope(
  envelope: StrategyValidationEnvelope,
): StrategyValidationEnvelope {
  return strategyValidationEnvelopeSchema.parse({
    ...envelope,
    observationContractDigests: sortedUnique(
      envelope.observationContractDigests,
    ),
  });
}

function canonicalTemplateBody(
  body: z.infer<typeof strategyTemplateBodySchema>,
): z.infer<typeof strategyTemplateBodySchema> {
  return strategyTemplateBodySchema.parse({
    ...body,
    taskClass: canonicalTaskClass(body.taskClass),
    parameterSlots: [...body.parameterSlots].toSorted((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    ),
    semanticObligations: canonicalizeSemanticObligations(
      body.semanticObligations,
    ),
    capabilityCeiling: {
      ...body.capabilityCeiling,
      allowedCapabilities: sortedUnique(
        body.capabilityCeiling.allowedCapabilities,
      ),
    },
    leafContracts: body.leafContracts
      .map(canonicalObservationContract)
      .toSorted((left, right) =>
        left.leafRole < right.leafRole
          ? -1
          : left.leafRole > right.leafRole
            ? 1
            : 0,
      ),
    validationEnvelope: canonicalEnvelope(body.validationEnvelope),
    candidateEvidence: canonicalPromotionEvidence(body.candidateEvidence),
  });
}

/** Normalizes only a plan proven to be the source of the supplied executable. */
export async function normalizeSuccessfulStrategyPlan(
  input: Readonly<{
    plan: WirePlan;
    executablePlan: ExecutablePlan;
    catalog: Catalog;
    taskClass: PublicTaskClass;
    leafContracts?: ReadonlyArray<OracleObservationContract> | undefined;
  }>,
): Promise<Result<NormalizedStrategyPlan, Diagnostic>> {
  const parsedPlan = wirePlanSchema.safeParse(input.plan);
  const parsedTaskClass = publicTaskClassSchema.safeParse(input.taskClass);
  const parsedLeaves = z
    .array(oracleObservationContractSchema)
    .readonly()
    .safeParse(input.leafContracts ?? []);
  if (!parsedPlan.success || !parsedTaskClass.success || !parsedLeaves.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Invalid strategy normalization input.",
      ),
    };
  const executable = inspectExecutablePlan(input.executablePlan);
  if (executable === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Executable plan token is invalid.",
      ),
    };
  const planDigest = await digestValue(parsedPlan.data);
  if (!planDigest.ok) return planDigest;
  if (planDigest.value !== executable.planHash)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "The successful executable does not belong to the supplied plan.",
      ),
    };
  const manifest = await createPlanLanguageManifest(input.catalog, {
    allowedCapabilities: executable.allowedCapabilities,
    budget: executable.budget,
  });
  if (!manifest.ok) return manifest;
  if (manifest.value.catalogFingerprint !== executable.catalogFingerprint)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "The successful executable does not belong to the supplied catalog.",
      ),
    };
  const nodes = canonicalNodes(parsedPlan.data, input.catalog);
  if (!nodes.ok) return nodes;
  const leafRoles = parsedLeaves.data
    .map((leaf) => ({
      leafRole: leaf.leafRole,
      effectClass: leaf.effectClass,
    }))
    .toSorted((left, right) =>
      left.leafRole < right.leafRole
        ? -1
        : left.leafRole > right.leafRole
          ? 1
          : 0,
    );
  const shapeValue = {
    protocol: "lachesis-trajectory-shape/1",
    nodes: nodes.value.map((node) => ({ role: node.role, shape: node.shape })),
    rootRole: nodes.value.length - 1,
    leafRoles,
  };
  const shapeCanonical = canonicalizeJson(shapeValue);
  if (!shapeCanonical.ok) return shapeCanonical;
  const shapeDigest = await digestValue(shapeValue);
  if (!shapeDigest.ok) return shapeDigest;
  const obligations = canonicalizeSemanticObligations(
    executable.semanticObligations,
  );
  const contractValue = {
    protocol: "lachesis-strategy-contract/1",
    trajectoryShapeHash: shapeDigest.value,
    catalogFingerprint: executable.catalogFingerprint,
    nodes: nodes.value.map((node) => ({
      role: node.role,
      contract: node.contract,
    })),
    taskClass: canonicalTaskClass(parsedTaskClass.data),
    semanticObligations: obligations,
    leafContracts: parsedLeaves.data
      .map((leaf) => ({
        ...leaf,
        evidenceKinds: sortedUnique(leaf.evidenceKinds),
        requiredSemanticOutputObligations: sortedUnique(
          leaf.requiredSemanticOutputObligations,
        ),
      }))
      .toSorted((left, right) =>
        left.leafRole < right.leafRole
          ? -1
          : left.leafRole > right.leafRole
            ? 1
            : 0,
      ),
  };
  const contractCanonical = canonicalizeJson(contractValue);
  if (!contractCanonical.ok) return contractCanonical;
  const contractDigest = await digestValue(contractValue);
  if (!contractDigest.ok) return contractDigest;
  return {
    ok: true,
    value: Object.freeze({
      trajectoryShapeHash: trajectoryShapeHashSchema.parse(shapeDigest.value),
      strategyContractHash: strategyContractHashSchema.parse(
        contractDigest.value,
      ),
      trajectoryShapeCanonical: shapeCanonical.value,
      strategyContractCanonical: contractCanonical.value,
    }),
  };
}

function skeletonFromPlan(
  plan: WirePlan,
  slots: ReadonlyArray<StrategyParameterSlot>,
): Result<PlanSkeleton, Diagnostic> {
  const slotsByNode = new Map(slots.map((slot) => [slot.target.nodeId, slot]));
  if (slotsByNode.size !== slots.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Multiple slots target the same constant node.",
      ),
    };
  const names = new Set(slots.map((slot) => slot.name));
  if (names.size !== slots.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Strategy parameter slot names must be unique.",
      ),
    };
  const found = new Set<string>();
  const nodes = plan.nodes.map((node) => {
    if (node.op !== "constant") return node;
    const slot = slotsByNode.get(node.id);
    if (slot === undefined)
      return {
        ...node,
        value: { kind: "literal" as const, value: node.value },
      };
    found.add(node.id);
    return { ...node, value: { kind: "slot" as const, slot: slot.name } };
  });
  if (found.size !== slots.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Every strategy slot must target an existing constant node.",
      ),
    };
  const skeleton = planSkeletonSchema.safeParse({
    formatVersion: plan.formatVersion,
    catalog: plan.catalog,
    root: plan.root,
    nodes,
    ...(plan.metadata === undefined ? {} : { metadata: plan.metadata }),
  });
  return skeleton.success
    ? { ok: true, value: skeleton.data }
    : {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", "Plan skeleton is invalid."),
      };
}

/** Promotes a compiled source plan into a candidate artifact; lifecycle promotion is separate. */
export async function createStrategyTemplate(
  input: Readonly<{
    plan: WirePlan;
    executablePlan: ExecutablePlan;
    catalog: Catalog;
    taskClass: PublicTaskClass;
    parameterSlots: ReadonlyArray<StrategyParameterSlot>;
    leafContracts: ReadonlyArray<OracleObservationContract>;
    validationEnvelope: StrategyValidationEnvelope;
    candidateEvidence: StrategyPromotionEvidence;
  }>,
): Promise<Result<StrategyTemplate, Diagnostic>> {
  const normalized = await normalizeSuccessfulStrategyPlan({
    plan: input.plan,
    executablePlan: input.executablePlan,
    catalog: input.catalog,
    taskClass: canonicalTaskClass(input.taskClass),
    leafContracts: input.leafContracts,
  });
  if (!normalized.ok) return normalized;
  const parsedSlots = z
    .array(strategyParameterSlotSchema)
    .readonly()
    .safeParse(input.parameterSlots);
  const parsedEnvelope = strategyValidationEnvelopeSchema.safeParse(
    input.validationEnvelope,
  );
  const parsedEvidence = strategyPromotionEvidenceSchema.safeParse(
    input.candidateEvidence,
  );
  if (
    !parsedSlots.success ||
    !parsedEnvelope.success ||
    !parsedEvidence.success
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Invalid strategy template input.",
      ),
    };
  const summary = inspectExecutablePlan(input.executablePlan);
  if (summary === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Executable plan token is invalid.",
      ),
    };
  const skeleton = skeletonFromPlan(input.plan, parsedSlots.data);
  if (!skeleton.ok) return skeleton;
  const body = strategyTemplateBodySchema.safeParse({
    protocol: "lachesis-strategy-template/1",
    trajectoryShapeHash: normalized.value.trajectoryShapeHash,
    strategyContractHash: normalized.value.strategyContractHash,
    taskClass: canonicalTaskClass(input.taskClass),
    planSkeleton: skeleton.value,
    parameterSlots: parsedSlots.data.toSorted((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    ),
    semanticObligations: canonicalizeSemanticObligations(
      summary.semanticObligations,
    ),
    capabilityCeiling: {
      allowedCapabilities: sortedUnique(summary.allowedCapabilities),
      budget: summary.budget,
    },
    catalogFingerprint: summary.catalogFingerprint,
    leafContracts: input.leafContracts.map(canonicalObservationContract),
    validationEnvelope: canonicalEnvelope(parsedEnvelope.data),
    candidateEvidence: canonicalPromotionEvidence(parsedEvidence.data),
  });
  if (!body.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Constructed strategy template is invalid.",
      ),
    };
  const canonicalBody = canonicalTemplateBody(body.data);
  const digest = await digestValue(canonicalBody);
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: strategyTemplateSchema.parse({
      ...canonicalBody,
      templateHash: digest.value,
    }),
  };
}

export async function verifyStrategyTemplate(
  value: unknown,
): Promise<Result<StrategyTemplate, Diagnostic>> {
  const parsed = strategyTemplateSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Strategy template wire value is invalid.",
      ),
    };
  const { templateHash: claimed, ...body } = parsed.data;
  const canonicalBody = canonicalTemplateBody(body);
  const suppliedCanonical = canonicalizeJson(body);
  const normalizedCanonical = canonicalizeJson(canonicalBody);
  if (
    !suppliedCanonical.ok ||
    !normalizedCanonical.ok ||
    suppliedCanonical.value !== normalizedCanonical.value
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Strategy template fields are not in canonical order.",
      ),
    };
  const digest = await digestValue(canonicalBody);
  if (!digest.ok) return digest;
  return digest.value === claimed
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Strategy template identity is invalid.",
        ),
      };
}

function policyWithinCeiling(
  policy: CompilationPolicy,
  ceiling: z.infer<typeof capabilityCeilingSchema>,
): boolean {
  const allowed = new Set(ceiling.allowedCapabilities);
  return (
    policy.allowedCapabilities.every((capability) => allowed.has(capability)) &&
    policy.budget.maxEffectCalls <= ceiling.budget.maxEffectCalls &&
    policy.budget.maxCollectionItems <= ceiling.budget.maxCollectionItems &&
    policy.budget.maxRecursionDepth <= ceiling.budget.maxRecursionDepth &&
    policy.budget.maxTokens <= ceiling.budget.maxTokens &&
    policy.budget.maxWallClockMs <= ceiling.budget.maxWallClockMs &&
    policy.budget.maxParallelism <= ceiling.budget.maxParallelism
  );
}

function bindingConstraintFailure(
  value: unknown,
  slot: StrategyParameterSlot,
): string | undefined {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok) return "not-json";
  const bytes = new TextEncoder().encode(canonical.value).byteLength;
  if (bytes > slot.constraints.maximumSerializedBytes) return "serialized-size";
  if (
    slot.constraints.maximumCollectionItems !== null &&
    Array.isArray(value) &&
    value.length > slot.constraints.maximumCollectionItems
  )
    return "collection-items";
  if (
    slot.constraints.maximumStringLength !== null &&
    typeof value === "string" &&
    value.length > slot.constraints.maximumStringLength
  )
    return "string-length";
  return undefined;
}

export type StrategyBindingFailure = Readonly<{
  kind:
    | "invalid-template"
    | "missing-binding"
    | "duplicate-binding"
    | "extra-binding"
    | "type-incompatible-binding"
    | "constraint-violating-binding"
    | "authority-widening"
    | "catalog-mismatch"
    | "compile-rejected";
  slot?: string | undefined;
  diagnostics?: ReadonlyArray<Diagnostic> | undefined;
}>;

export type BoundStrategy = Readonly<{
  plan: WirePlan;
  executablePlan: ExecutablePlan;
  exactInstantiationHash: ExactStrategyInstantiationHash;
}>;

/** Binds only public constant values, then crosses the ordinary compilePlanJson boundary. */
export async function bindStrategyTemplate(
  input: Readonly<{
    template: StrategyTemplate;
    bindings: ReadonlyArray<StrategyParameterBinding>;
    catalog: Catalog;
    policy: CompilationPolicy;
  }>,
): Promise<Result<BoundStrategy, StrategyBindingFailure>> {
  const verified = await verifyStrategyTemplate(input.template);
  if (!verified.ok) return { ok: false, error: { kind: "invalid-template" } };
  if (!policyWithinCeiling(input.policy, verified.value.capabilityCeiling))
    return { ok: false, error: { kind: "authority-widening" } };
  const manifest = await createPlanLanguageManifest(
    input.catalog,
    input.policy,
  );
  if (!manifest.ok)
    return {
      ok: false,
      error: { kind: "compile-rejected", diagnostics: [manifest.error] },
    };
  if (manifest.value.catalogFingerprint !== verified.value.catalogFingerprint)
    return { ok: false, error: { kind: "catalog-mismatch" } };
  const values = new Map<string, unknown>();
  for (const binding of input.bindings) {
    if (values.has(binding.name))
      return {
        ok: false,
        error: { kind: "duplicate-binding", slot: binding.name },
      };
    values.set(binding.name, binding.value);
  }
  const slots = new Map(
    verified.value.parameterSlots.map((slot) => [slot.name, slot]),
  );
  for (const binding of input.bindings)
    if (!slots.has(binding.name))
      return {
        ok: false,
        error: { kind: "extra-binding", slot: binding.name },
      };
  const catalogState = readCatalog(input.catalog);
  for (const slot of verified.value.parameterSlots) {
    if (!values.has(slot.name))
      return { ok: false, error: { kind: "missing-binding", slot: slot.name } };
    const value = values.get(slot.name);
    const runtimeSchema = catalogState.schemas.get(referenceKey(slot.schema));
    if (!runtimeSchema?.parse(value).ok)
      return {
        ok: false,
        error: { kind: "type-incompatible-binding", slot: slot.name },
      };
    if (bindingConstraintFailure(value, slot) !== undefined)
      return {
        ok: false,
        error: { kind: "constraint-violating-binding", slot: slot.name },
      };
  }
  const nodes = verified.value.planSkeleton.nodes.map((node) => {
    if (node.op !== "constant") return node;
    const value =
      node.value.kind === "literal"
        ? node.value.value
        : values.get(node.value.slot);
    return { ...node, value };
  });
  const wire = wirePlanSchema.safeParse({
    ...verified.value.planSkeleton,
    nodes,
    allowedCapabilities: sortedUnique(input.policy.allowedCapabilities),
    budget: input.policy.budget,
  });
  if (!wire.success) return { ok: false, error: { kind: "invalid-template" } };
  const canonical = canonicalizeJson(wire.data);
  if (!canonical.ok)
    return {
      ok: false,
      error: { kind: "compile-rejected", diagnostics: [canonical.error] },
    };
  const compiled = await compilePlanJson(
    canonical.value,
    input.catalog,
    input.policy,
    verified.value.semanticObligations,
  );
  if (!compiled.ok)
    return {
      ok: false,
      error: { kind: "compile-rejected", diagnostics: compiled.error },
    };
  const summary = inspectExecutablePlan(compiled.value);
  if (summary === undefined)
    return { ok: false, error: { kind: "invalid-template" } };
  const bindingDigest = await digestValue(
    [...values.entries()]
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => ({ name, value })),
  );
  if (!bindingDigest.ok)
    return {
      ok: false,
      error: { kind: "compile-rejected", diagnostics: [bindingDigest.error] },
    };
  const exact = await digestValue({
    protocol: "lachesis-strategy-instantiation/1",
    templateHash: verified.value.templateHash,
    bindingDigest: bindingDigest.value,
    planHash: summary.planHash,
    semanticContractHash: summary.semanticContractHash,
    catalogFingerprint: summary.catalogFingerprint,
    policy: input.policy,
    semanticObligations: summary.semanticObligations,
  });
  if (!exact.ok)
    return {
      ok: false,
      error: { kind: "compile-rejected", diagnostics: [exact.error] },
    };
  return {
    ok: true,
    value: Object.freeze({
      plan: wire.data,
      executablePlan: compiled.value,
      exactInstantiationHash: exactStrategyInstantiationHashSchema.parse(
        exact.value,
      ),
    }),
  };
}

export const strategyLifecycleStatusSchema = z.enum([
  "candidate",
  "canary",
  "stable",
  "deprecated",
]);
export type StrategyLifecycleStatus = z.infer<
  typeof strategyLifecycleStatusSchema
>;

const lifecycleEventBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-strategy-lifecycle-event/1"),
    sequence: z.number().int().nonnegative(),
    templateHash: strategyTemplateHashSchema,
    previousEventHash: strategyLifecycleEventHashSchema.nullable(),
    from: strategyLifecycleStatusSchema.nullable(),
    to: strategyLifecycleStatusSchema,
    promotionEvidenceDigest: sha256Schema,
  })
  .readonly();

export const strategyLifecycleEventSchema = lifecycleEventBodySchema
  .unwrap()
  .extend({ eventHash: strategyLifecycleEventHashSchema })
  .readonly();
export type StrategyLifecycleEvent = z.infer<
  typeof strategyLifecycleEventSchema
>;

const strategyRegistryBrand: unique symbol = Symbol("StrategyRegistry");
export type StrategyRegistry = Readonly<{
  [strategyRegistryBrand]: "StrategyRegistry";
}>;
type RegistryState = Readonly<{
  templates: ReadonlyMap<StrategyTemplateHash, StrategyTemplate>;
  events: ReadonlyArray<StrategyLifecycleEvent>;
}>;
const registryStates = new WeakMap<StrategyRegistry, RegistryState>();

function storeRegistry(state: RegistryState): StrategyRegistry {
  const registry: StrategyRegistry = Object.freeze({
    [strategyRegistryBrand]: "StrategyRegistry",
  });
  registryStates.set(
    registry,
    Object.freeze({
      templates: new Map(state.templates),
      events: [...state.events],
    }),
  );
  return registry;
}

export function createStrategyRegistry(): StrategyRegistry {
  return storeRegistry({ templates: new Map(), events: [] });
}

function registryState(registry: StrategyRegistry): RegistryState | undefined {
  return registryStates.get(registry);
}

async function lifecycleEvent(
  input: z.input<typeof lifecycleEventBodySchema>,
): Promise<Result<StrategyLifecycleEvent, Diagnostic>> {
  const body = lifecycleEventBodySchema.safeParse(input);
  if (!body.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Lifecycle event body is invalid.",
      ),
    };
  const digest = await digestValue(body.data);
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: strategyLifecycleEventSchema.parse({
      ...body.data,
      eventHash: digest.value,
    }),
  };
}

export async function registerStrategyTemplate(
  input: Readonly<{
    registry: StrategyRegistry;
    template: StrategyTemplate;
  }>,
): Promise<Result<StrategyRegistry, Diagnostic>> {
  const state = registryState(input.registry);
  if (state === undefined)
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", "Registry token is invalid."),
    };
  const verified = await verifyStrategyTemplate(input.template);
  if (!verified.ok) return verified;
  if (state.templates.has(verified.value.templateHash))
    return { ok: true, value: input.registry };
  const evidence = await digestValue(verified.value.candidateEvidence);
  if (!evidence.ok) return evidence;
  const previous = state.events.at(-1)?.eventHash ?? null;
  const event = await lifecycleEvent({
    protocol: "lachesis-strategy-lifecycle-event/1",
    sequence: state.events.length,
    templateHash: verified.value.templateHash,
    previousEventHash: previous,
    from: null,
    to: "candidate",
    promotionEvidenceDigest: evidence.value,
  });
  if (!event.ok) return event;
  const templates = new Map(state.templates);
  templates.set(verified.value.templateHash, verified.value);
  return {
    ok: true,
    value: storeRegistry({ templates, events: [...state.events, event.value] }),
  };
}

function currentStatus(
  state: RegistryState,
  templateHash: StrategyTemplateHash,
): StrategyLifecycleStatus | undefined {
  return state.events.findLast((event) => event.templateHash === templateHash)
    ?.to;
}

function validTransition(
  from: StrategyLifecycleStatus,
  to: StrategyLifecycleStatus,
): boolean {
  return (
    (from === "candidate" && to === "canary") ||
    (from === "canary" && to === "stable") ||
    (from !== "deprecated" && to === "deprecated")
  );
}

export async function transitionStrategyTemplate(
  input: Readonly<{
    registry: StrategyRegistry;
    templateHash: StrategyTemplateHash;
    to: Exclude<StrategyLifecycleStatus, "candidate">;
    evidence: StrategyPromotionEvidence;
  }>,
): Promise<Result<StrategyRegistry, Diagnostic>> {
  const state = registryState(input.registry);
  const evidence = strategyPromotionEvidenceSchema.safeParse(input.evidence);
  if (state === undefined || !evidence.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Invalid lifecycle transition input.",
      ),
    };
  if (!state.templates.has(input.templateHash))
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", "Unknown strategy template."),
    };
  const from = currentStatus(state, input.templateHash);
  if (from === undefined || !validTransition(from, input.to))
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", "Invalid lifecycle transition."),
    };
  if (
    input.to === "stable" &&
    (evidence.data.validationCaseDigests.length < 2 ||
      evidence.data.firstAttemptCompileSuccesses !==
        evidence.data.validationCaseDigests.length ||
      evidence.data.firstAttemptSemanticSuccesses !==
        evidence.data.validationCaseDigests.length)
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Stable promotion requires at least two fully successful validation cases.",
      ),
    };
  const evidenceDigest = await digestValue(evidence.data);
  if (!evidenceDigest.ok) return evidenceDigest;
  const event = await lifecycleEvent({
    protocol: "lachesis-strategy-lifecycle-event/1",
    sequence: state.events.length,
    templateHash: input.templateHash,
    previousEventHash: state.events.at(-1)?.eventHash ?? null,
    from,
    to: input.to,
    promotionEvidenceDigest: evidenceDigest.value,
  });
  if (!event.ok) return event;
  return {
    ok: true,
    value: storeRegistry({
      templates: state.templates,
      events: [...state.events, event.value],
    }),
  };
}

export type StrategyPublicTaskFeatures = Readonly<{
  taskClass: PublicTaskClass;
  inputCardinality: number;
  serializedTaskBytes: number;
  evidenceSufficiencyContract: string;
  observationContractDigests: ReadonlyArray<string>;
}>;

export type StrategyMatch =
  | Readonly<{ kind: "matched"; template: StrategyTemplate }>
  | Readonly<{ kind: "strategy-miss" }>
  | Readonly<{
      kind: "outside-validation-envelope";
      templateHash: StrategyTemplateHash;
    }>
  | Readonly<{
      kind: "ambiguous-strategy-match";
      templateHashes: ReadonlyArray<StrategyTemplateHash>;
    }>;

async function taskClassIdentity(
  taskClass: PublicTaskClass,
): Promise<string | undefined> {
  const digest = await digestValue(canonicalTaskClass(taskClass));
  return digest.ok ? digest.value : undefined;
}

function insideEnvelope(
  features: StrategyPublicTaskFeatures,
  envelope: StrategyValidationEnvelope,
): boolean {
  return (
    features.inputCardinality >= envelope.minimumInputCardinality &&
    features.inputCardinality <= envelope.maximumInputCardinality &&
    features.serializedTaskBytes <= envelope.maximumSerializedTaskBytes &&
    features.evidenceSufficiencyContract ===
      envelope.evidenceSufficiencyContract &&
    sortedUnique(features.observationContractDigests).join("\u0000") ===
      sortedUnique(envelope.observationContractDigests).join("\u0000")
  );
}

/** Matches stable templates using public features only and never silently chooses among conflicts. */
export async function matchStrategyTemplate(
  registry: StrategyRegistry,
  features: StrategyPublicTaskFeatures,
): Promise<StrategyMatch> {
  const state = registryState(registry);
  const parsedTaskClass = publicTaskClassSchema.safeParse(features.taskClass);
  if (state === undefined || !parsedTaskClass.success)
    return { kind: "strategy-miss" };
  const requestedIdentity = await taskClassIdentity(parsedTaskClass.data);
  if (requestedIdentity === undefined) return { kind: "strategy-miss" };
  const classMatches: Array<StrategyTemplate> = [];
  for (const template of state.templates.values()) {
    if (currentStatus(state, template.templateHash) !== "stable") continue;
    const identity = await taskClassIdentity(template.taskClass);
    if (identity === requestedIdentity) classMatches.push(template);
  }
  if (classMatches.length === 0) return { kind: "strategy-miss" };
  const eligible = classMatches.filter((template) =>
    insideEnvelope(features, template.validationEnvelope),
  );
  if (eligible.length === 0) {
    const templateHash = classMatches
      .map((template) => template.templateHash)
      .toSorted()
      .at(0);
    return templateHash === undefined
      ? { kind: "strategy-miss" }
      : { kind: "outside-validation-envelope", templateHash };
  }
  if (eligible.length > 1)
    return {
      kind: "ambiguous-strategy-match",
      templateHashes: eligible
        .map((template) => template.templateHash)
        .toSorted(),
    };
  const template = eligible[0];
  return template === undefined
    ? { kind: "strategy-miss" }
    : { kind: "matched", template };
}

export type OfflinePlanner = Readonly<{
  discover: (
    features: StrategyPublicTaskFeatures,
  ) => Promise<Readonly<{ kind: "discovery-required" }>>;
}>;

export type TemplateFirstCompilation =
  | Readonly<{ kind: "template-hit"; bound: BoundStrategy }>
  | Readonly<{
      kind:
        | "strategy-miss"
        | "outside-validation-envelope"
        | "ambiguous-strategy-match"
        | "binding-rejected";
      planner: Readonly<{ kind: "discovery-required" }>;
      match?: StrategyMatch | undefined;
      bindingFailure?: StrategyBindingFailure | undefined;
    }>;

/** Entirely offline template-first compilation with an injected discovery effect. */
export async function compileTemplateFirst(
  input: Readonly<{
    registry: StrategyRegistry;
    features: StrategyPublicTaskFeatures;
    bindings: ReadonlyArray<StrategyParameterBinding>;
    catalog: Catalog;
    policy: CompilationPolicy;
    planner: OfflinePlanner;
  }>,
): Promise<TemplateFirstCompilation> {
  const match = await matchStrategyTemplate(input.registry, input.features);
  if (match.kind !== "matched") {
    const planner = await input.planner.discover(input.features);
    return { kind: match.kind, planner, match };
  }
  const bound = await bindStrategyTemplate({
    template: match.template,
    bindings: input.bindings,
    catalog: input.catalog,
    policy: input.policy,
  });
  if (!bound.ok) {
    const planner = await input.planner.discover(input.features);
    return {
      kind: "binding-rejected",
      planner,
      bindingFailure: bound.error,
    };
  }
  return { kind: "template-hit", bound: bound.value };
}

export const sanitizedStrategyTraceSchema = z
  .strictObject({
    traceDigest: sha256Schema,
    trajectoryShapeHash: trajectoryShapeHashSchema,
    strategyContractHash: strategyContractHashSchema,
    exactInstantiationHash: exactStrategyInstantiationHashSchema,
  })
  .readonly();
export type SanitizedStrategyTrace = z.infer<
  typeof sanitizedStrategyTraceSchema
>;

export type StrategyTraceMiningReport = Readonly<{
  protocol: "lachesis-strategy-trace-mining-report/1";
  traceCount: number;
  byTrajectoryShape: ReadonlyArray<
    Readonly<{
      identity: TrajectoryShapeHash;
      count: number;
      traceDigests: ReadonlyArray<string>;
    }>
  >;
  byStrategyContract: ReadonlyArray<
    Readonly<{
      identity: StrategyContractHash;
      count: number;
      traceDigests: ReadonlyArray<string>;
    }>
  >;
  byExactInstantiation: ReadonlyArray<
    Readonly<{
      identity: ExactStrategyInstantiationHash;
      count: number;
      traceDigests: ReadonlyArray<string>;
    }>
  >;
  reportDigest: string;
}>;

function groupTraceIdentities<T extends string>(
  traces: ReadonlyArray<SanitizedStrategyTrace>,
  identity: (trace: SanitizedStrategyTrace) => T,
): ReadonlyArray<
  Readonly<{ identity: T; count: number; traceDigests: ReadonlyArray<string> }>
> {
  const groups = new Map<T, Array<string>>();
  for (const trace of traces) {
    const key = identity(trace);
    const digests = groups.get(key) ?? [];
    digests.push(trace.traceDigest);
    groups.set(key, digests);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([groupIdentity, digests]) => ({
      identity: groupIdentity,
      count: digests.length,
      traceDigests: [...digests].toSorted(),
    }));
}

/** Groups bounded sanitized identities without prompts, values, evidence, or answers. */
export async function mineStrategyTraces(
  inputs: ReadonlyArray<unknown>,
): Promise<Result<StrategyTraceMiningReport, Diagnostic>> {
  const parsed = z
    .array(sanitizedStrategyTraceSchema)
    .max(100_000)
    .safeParse(inputs);
  if (!parsed.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Sanitized strategy traces are invalid.",
      ),
    };
  const body = {
    protocol: "lachesis-strategy-trace-mining-report/1" as const,
    traceCount: parsed.data.length,
    byTrajectoryShape: groupTraceIdentities(
      parsed.data,
      (trace) => trace.trajectoryShapeHash,
    ),
    byStrategyContract: groupTraceIdentities(
      parsed.data,
      (trace) => trace.strategyContractHash,
    ),
    byExactInstantiation: groupTraceIdentities(
      parsed.data,
      (trace) => trace.exactInstantiationHash,
    ),
  };
  const digest = await digestValue(body);
  return digest.ok
    ? {
        ok: true,
        value: Object.freeze({ ...body, reportDigest: digest.value }),
      }
    : digest;
}

export function inspectStrategyRegistry(registry: StrategyRegistry):
  | Readonly<{
      templates: ReadonlyArray<StrategyTemplate>;
      events: ReadonlyArray<StrategyLifecycleEvent>;
    }>
  | undefined {
  const state = registryState(registry);
  return state === undefined
    ? undefined
    : Object.freeze({
        templates: [...state.templates.values()].toSorted((left, right) =>
          left.templateHash < right.templateHash
            ? -1
            : left.templateHash > right.templateHash
              ? 1
              : 0,
        ),
        events: [...state.events],
      });
}
