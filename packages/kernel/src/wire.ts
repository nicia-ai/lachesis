import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/);
export const nodeIdSchema = identifierSchema.brand<"NodeId">();
export const schemaIdSchema = identifierSchema.brand<"SchemaId">();
export const operationIdSchema = identifierSchema.brand<"OperationId">();

const versionedReferenceSchema = z.strictObject({
  id: identifierSchema,
  version: z.string().min(1).max(64),
});

const sourceSchema = z.strictObject({ source: nodeIdSchema });

const inputNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("input"),
  inputKey: identifierSchema,
  schema: versionedReferenceSchema,
  maxItems: z.number().int().nonnegative().optional(),
});

const constantNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("constant"),
  schema: versionedReferenceSchema,
  value: z.json(),
});

const invokeNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("invoke"),
  ...sourceSchema.shape,
  function: versionedReferenceSchema,
});

const mapNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("map"),
  ...sourceSchema.shape,
  operation: z.strictObject({
    kind: z.enum(["function", "effect"]),
    ...versionedReferenceSchema.shape,
  }),
  outputCollectionSchema: versionedReferenceSchema,
  parallelism: z.number().int().positive(),
});

const filterNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("filter"),
  ...sourceSchema.shape,
  predicate: versionedReferenceSchema,
});

const foldNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("fold"),
  ...sourceSchema.shape,
  reducer: versionedReferenceSchema,
});

const selectNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("select"),
  condition: nodeIdSchema,
  whenTrue: nodeIdSchema,
  whenFalse: nodeIdSchema,
});

const effectNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("effect"),
  ...sourceSchema.shape,
  effect: versionedReferenceSchema,
});

const checkpointNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("checkpoint"),
  ...sourceSchema.shape,
  label: identifierSchema,
});

const boundedFixNodeSchema = z.strictObject({
  id: nodeIdSchema,
  op: z.literal("boundedFix"),
  seed: nodeIdSchema,
  step: versionedReferenceSchema,
  measure: versionedReferenceSchema,
  maxIterations: z.number().int().positive(),
});

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

export const planBudgetSchema = z.strictObject({
  maxEffectCalls: z.number().int().nonnegative(),
  maxCollectionItems: z.number().int().nonnegative(),
  maxRecursionDepth: z.number().int().nonnegative(),
  maxTokens: z.number().int().nonnegative(),
  maxWallClockMs: z.number().int().nonnegative(),
  maxParallelism: z.number().int().positive(),
});

export const wirePlanSchema = z.strictObject({
  formatVersion: z.literal("1"),
  catalog: versionedReferenceSchema,
  root: nodeIdSchema,
  nodes: z.array(wireNodeSchema).min(1).max(10_000),
  budget: planBudgetSchema,
  allowedCapabilities: z.array(identifierSchema).max(256),
  metadata: z
    .strictObject({
      name: z.string().min(1).max(256),
      revision: z.string().min(1).max(128),
    })
    .optional(),
});

export type NodeId = z.infer<typeof nodeIdSchema>;
export type PlanBudget = z.infer<typeof planBudgetSchema>;
export type WireNode = z.infer<typeof wireNodeSchema>;
export type WirePlan = z.infer<typeof wirePlanSchema>;
export type VersionedReference = z.infer<typeof versionedReferenceSchema>;
