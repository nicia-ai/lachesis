import { z } from "zod";

import { operationReferenceSchema, schemaReferenceSchema } from "./wire.js";

const semanticRoleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/)
  .brand<"SemanticRoleId">();

export const semanticRoleReferenceSchema = z
  .strictObject({
    id: semanticRoleIdSchema,
    version: z.string().min(1).max(64),
  })
  .readonly();

export type SemanticRoleReference = z.infer<typeof semanticRoleReferenceSchema>;

const schemaRoleDeclarationSchema = z
  .strictObject({
    kind: z.literal("schema"),
    role: semanticRoleReferenceSchema,
    schema: schemaReferenceSchema,
    obligations: z
      .strictObject({ mutuallyAcceptsConformanceValues: z.literal(true) })
      .readonly(),
  })
  .readonly();

const deterministicOperationObligationsSchema = z
  .strictObject({
    deterministic: z.literal(true),
    totalOnConformanceValues: z.literal(true),
    pointwiseEquivalent: z.literal(true),
  })
  .readonly();

const operationRoleBase = {
  role: semanticRoleReferenceSchema,
  operation: operationReferenceSchema,
};

const functionRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("function"),
    obligations: deterministicOperationObligationsSchema,
  })
  .readonly();

const predicateRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("predicate"),
    obligations: deterministicOperationObligationsSchema,
  })
  .readonly();

const fixedPointStepRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("fixedPointStep"),
    obligations: deterministicOperationObligationsSchema.unwrap().extend({
      sameSchema: z.literal(true),
    }),
  })
  .readonly();

const measureRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("measure"),
    obligations: deterministicOperationObligationsSchema.unwrap().extend({
      nonnegativeSafeInteger: z.literal(true),
    }),
  })
  .readonly();

const reducerRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("reducer"),
    obligations: deterministicOperationObligationsSchema.unwrap().extend({
      identity: z.literal(true),
      associative: z.boolean(),
      commutative: z.boolean(),
      idempotent: z.boolean(),
    }),
  })
  .readonly();

const effectRoleDeclarationSchema = z
  .strictObject({
    ...operationRoleBase,
    kind: z.literal("effect"),
    obligations: z
      .strictObject({
        sameEffectClass: z.literal(true),
        sameCapability: z.literal(true),
        sameReplayability: z.literal(true),
        sameStateChangeSemantics: z.literal(true),
        sameResourceBounds: z.literal(true),
      })
      .readonly(),
  })
  .readonly();

export const operationRoleDeclarationSchema = z.discriminatedUnion("kind", [
  functionRoleDeclarationSchema,
  predicateRoleDeclarationSchema,
  reducerRoleDeclarationSchema,
  effectRoleDeclarationSchema,
  fixedPointStepRoleDeclarationSchema,
  measureRoleDeclarationSchema,
]);

export type OperationRoleDeclaration = z.infer<
  typeof operationRoleDeclarationSchema
>;
export type SchemaRoleDeclaration = z.infer<typeof schemaRoleDeclarationSchema>;

export const catalogSemanticRolesSchema = z
  .strictObject({
    protocol: z.literal("lachesis-catalog-semantic-roles/1"),
    schemas: z.array(schemaRoleDeclarationSchema).max(10_000).readonly(),
    operations: z.array(operationRoleDeclarationSchema).max(10_000).readonly(),
  })
  .readonly();

export type CatalogSemanticRoles = z.infer<typeof catalogSemanticRolesSchema>;
export type CatalogSemanticRolesInput = z.input<
  typeof catalogSemanticRolesSchema
>;
