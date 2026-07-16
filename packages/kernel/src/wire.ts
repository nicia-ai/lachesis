import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/);
const versionSchema = z.string().min(1).max(64);

export const nodeIdSchema = identifierSchema.brand<"NodeId">();
export const schemaIdSchema = identifierSchema.brand<"SchemaId">();
export const operationIdSchema = identifierSchema.brand<"OperationId">();
export const catalogIdSchema = identifierSchema.brand<"CatalogId">();

export const schemaReferenceSchema = z
  .strictObject({ id: schemaIdSchema, version: versionSchema })
  .readonly();
export const operationReferenceSchema = z
  .strictObject({ id: operationIdSchema, version: versionSchema })
  .readonly();
export const catalogReferenceSchema = z
  .strictObject({ id: catalogIdSchema, version: versionSchema })
  .readonly();

const sourceSchema = z.strictObject({ source: nodeIdSchema }).readonly();

const inputNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("input"),
    inputKey: identifierSchema,
    schema: schemaReferenceSchema,
    maxItems: z.number().int().nonnegative().optional(),
  })
  .readonly();

const modelInputNodeSchema = inputNodeSchema
  .unwrap()
  .omit({ maxItems: true })
  .readonly();

const constantNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("constant"),
    schema: schemaReferenceSchema,
    value: z.json(),
  })
  .readonly();

const invokeNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("invoke"),
    ...sourceSchema.unwrap().shape,
    function: operationReferenceSchema,
  })
  .readonly();

const mapNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("map"),
    ...sourceSchema.unwrap().shape,
    operation: z
      .strictObject({
        kind: z.enum(["function", "effect"]),
        ...operationReferenceSchema.unwrap().shape,
      })
      .readonly(),
    outputCollectionSchema: schemaReferenceSchema,
    parallelism: z.number().int().positive(),
  })
  .readonly();

const filterNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("filter"),
    ...sourceSchema.unwrap().shape,
    predicate: operationReferenceSchema,
  })
  .readonly();

const foldNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("fold"),
    ...sourceSchema.unwrap().shape,
    reducer: operationReferenceSchema,
  })
  .readonly();

const selectNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("select"),
    condition: nodeIdSchema,
    whenTrue: nodeIdSchema,
    whenFalse: nodeIdSchema,
  })
  .readonly();

const effectNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("effect"),
    ...sourceSchema.unwrap().shape,
    effect: operationReferenceSchema,
  })
  .readonly();

const checkpointNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("checkpoint"),
    ...sourceSchema.unwrap().shape,
    label: identifierSchema,
  })
  .readonly();

const boundedFixNodeSchema = z
  .strictObject({
    id: nodeIdSchema,
    op: z.literal("boundedFix"),
    seed: nodeIdSchema,
    step: operationReferenceSchema,
    measure: operationReferenceSchema,
    maxIterations: z.number().int().positive(),
  })
  .readonly();

export const wireNodeSchema = z.discriminatedUnion("op", [
  inputNodeSchema,
  constantNodeSchema,
  invokeNodeSchema,
  mapNodeSchema,
  filterNodeSchema,
  foldNodeSchema,
  selectNodeSchema,
  effectNodeSchema,
  checkpointNodeSchema,
  boundedFixNodeSchema,
]);

/** Model-authored computation excludes runtime-supplied input bounds. */
export const modelPlanNodeSchema = z.discriminatedUnion("op", [
  modelInputNodeSchema,
  constantNodeSchema,
  invokeNodeSchema,
  mapNodeSchema,
  filterNodeSchema,
  foldNodeSchema,
  selectNodeSchema,
  effectNodeSchema,
  checkpointNodeSchema,
  boundedFixNodeSchema,
]);

export const planBudgetSchema = z
  .strictObject({
    maxEffectCalls: z.number().int().nonnegative(),
    maxCollectionItems: z.number().int().nonnegative(),
    maxRecursionDepth: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    maxWallClockMs: z.number().int().nonnegative(),
    maxParallelism: z.number().int().positive(),
  })
  .readonly();

export const wirePlanSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    catalog: catalogReferenceSchema,
    root: nodeIdSchema,
    nodes: z.array(wireNodeSchema).min(1).max(10_000).readonly(),
    budget: planBudgetSchema,
    allowedCapabilities: z.array(identifierSchema).max(256).readonly(),
    metadata: z
      .strictObject({
        name: z.string().min(1).max(256),
        revision: z.string().min(1).max(128),
      })
      .readonly()
      .optional(),
  })
  .readonly();

/** Untrusted model proposal: operator topology and arguments only. */
export const modelPlanProposalSchema = wirePlanSchema
  .unwrap()
  .omit({ budget: true, allowedCapabilities: true })
  .extend({
    nodes: z.array(modelPlanNodeSchema).min(1).max(10_000).readonly(),
  })
  .readonly();

export type NodeId = z.infer<typeof nodeIdSchema>;
export type SchemaReference = z.infer<typeof schemaReferenceSchema>;
export type OperationReference = z.infer<typeof operationReferenceSchema>;
export type CatalogReference = z.infer<typeof catalogReferenceSchema>;
export type PlanBudget = z.infer<typeof planBudgetSchema>;
export type WireNode = z.infer<typeof wireNodeSchema>;
export type WirePlan = z.infer<typeof wirePlanSchema>;
export type ModelPlanProposal = z.infer<typeof modelPlanProposalSchema>;
