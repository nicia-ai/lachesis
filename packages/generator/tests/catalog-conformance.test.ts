import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  catalogConformanceSuiteSchema,
  conformCatalogsOffline,
  verifyCatalogConformanceReport,
} from "../src/catalog-conformance.js";
import {
  auditM6cFalseEquivalence,
  loadM6cOfflineConformanceCorpus,
} from "../src/m6c-corpus.js";

type Variant =
  | "equivalent"
  | "schema-domain"
  | "function-output"
  | "predicate-decision"
  | "reducer-law"
  | "fixed-point-step"
  | "measure-value"
  | "effect-contract"
  | "role-version";

function makeCatalog(name: string, variant: Variant): Catalog {
  const prefix = `m6c/${name}`;
  const number = defineSchema({
    id: `${prefix}/number`,
    version: "1",
    description: "A conformance-domain nonnegative integer.",
    validator:
      variant === "schema-domain"
        ? z.number().int().positive()
        : z.number().int().nonnegative(),
  });
  const identity = defineFunction({
    id: `${prefix}/identity`,
    version: "1",
    description: "Return the input.",
    input: number,
    output: number,
    implementation: (value) =>
      variant === "function-output" ? value + 1 : value,
  });
  const even = definePredicate({
    id: `${prefix}/even`,
    version: "1",
    description: "Test parity.",
    input: number,
    implementation: (value) =>
      variant === "predicate-decision" ? value % 2 !== 0 : value % 2 === 0,
  });
  const maximum = defineReducer({
    id: `${prefix}/maximum`,
    version: "1",
    description: "Take the maximum.",
    element: number,
    accumulator: number,
    identity: variant === "schema-domain" ? 1 : 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: (accumulator, element) =>
      variant === "reducer-law"
        ? Math.min(accumulator, element)
        : Math.max(accumulator, element),
  });
  const decrement = defineFixedPointStep({
    id: `${prefix}/decrement`,
    version: "1",
    description: "Decrease toward zero.",
    state: number,
    implementation: (value) =>
      variant === "fixed-point-step" ? value : Math.max(0, value - 1),
  });
  const measure = defineMeasure({
    id: `${prefix}/measure`,
    version: "1",
    description: "Measure the state.",
    input: number,
    implementation: (value) =>
      variant === "measure-value" ? value + 1 : value,
  });
  const effect = defineEffect({
    id: `${prefix}/effect`,
    version: "1",
    description: "A declared, unimplemented effect.",
    input: number,
    output: number,
    effectName: "m6c.observe",
    capability:
      variant === "effect-contract" ? "m6c.observe.wide" : "m6c.observe",
    maxTokens: 0,
    maxWallClockMs: 10,
    replayable: true,
  });
  const roleVersion = variant === "role-version" ? "2" : "1";
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m6c.role/number", version: roleVersion },
        schema: { id: number.id, version: number.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "function",
        role: { id: "m6c.role/identity", version: roleVersion },
        operation: { id: identity.id, version: identity.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "predicate",
        role: { id: "m6c.role/even", version: roleVersion },
        operation: { id: even.id, version: even.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m6c.role/maximum", version: roleVersion },
        operation: { id: maximum.id, version: maximum.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          identity: true,
          associative: true,
          commutative: true,
          idempotent: true,
        },
      },
      {
        kind: "fixedPointStep",
        role: { id: "m6c.role/decrement", version: roleVersion },
        operation: { id: decrement.id, version: decrement.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          sameSchema: true,
        },
      },
      {
        kind: "measure",
        role: { id: "m6c.role/measure", version: roleVersion },
        operation: { id: measure.id, version: measure.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          nonnegativeSafeInteger: true,
        },
      },
      {
        kind: "effect",
        role: { id: "m6c.role/effect", version: roleVersion },
        operation: { id: effect.id, version: effect.version },
        obligations: {
          sameEffectClass: true,
          sameCapability: true,
          sameReplayability: true,
          sameStateChangeSemantics: true,
          sameResourceBounds: true,
        },
      },
    ],
  });
  const catalog = createCatalog({
    identity: { id: `${prefix}/catalog`, version: "1" },
    schemas: [number.runtime],
    operations: [identity, even, maximum, decrement, measure, effect],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error(catalog.error[0]?.message);
  return catalog.value;
}

const suite = catalogConformanceSuiteSchema.parse({
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: "m6c.role/number", version: "1" },
      values: [0, 1, 2, 3],
    },
    {
      kind: "function",
      role: { id: "m6c.role/identity", version: "1" },
      inputs: [0, 1, 2],
    },
    {
      kind: "predicate",
      role: { id: "m6c.role/even", version: "1" },
      inputs: [0, 1, 2],
    },
    {
      kind: "reducer",
      role: { id: "m6c.role/maximum", version: "1" },
      values: [0, 1, 2, 3],
    },
    {
      kind: "fixedPointStep",
      role: { id: "m6c.role/decrement", version: "1" },
      inputs: [0, 1, 2],
    },
    {
      kind: "measure",
      role: { id: "m6c.role/measure", version: "1" },
      inputs: [0, 1, 2],
    },
    { kind: "effect", role: { id: "m6c.role/effect", version: "1" } },
  ],
});

describe("M6c trusted cross-catalog conformance", () => {
  it("rejects dangling, duplicate, kind-incompatible, and false-law declarations", () => {
    const number = defineSchema({
      id: "m6c/invalid/number",
      version: "1",
      description: "A number.",
      validator: z.number().int().nonnegative(),
    });
    const functionOperation = defineFunction({
      id: "m6c/invalid/function",
      version: "1",
      description: "Identity.",
      input: number,
      output: number,
      implementation: (value) => value,
    });
    const reducer = defineReducer({
      id: "m6c/invalid/reducer",
      version: "1",
      description: "Maximum.",
      element: number,
      accumulator: number,
      identity: 0,
      laws: { associative: true, commutative: true, idempotent: true },
      implementation: Math.max,
    });
    const roles = catalogSemanticRolesSchema.parse({
      protocol: "lachesis-catalog-semantic-roles/1",
      schemas: [
        {
          kind: "schema",
          role: { id: "m6c.role/duplicate", version: "1" },
          schema: { id: number.id, version: number.version },
          obligations: { mutuallyAcceptsConformanceValues: true },
        },
        {
          kind: "schema",
          role: { id: "m6c.role/duplicate", version: "1" },
          schema: { id: "m6c/invalid/missing", version: "1" },
          obligations: { mutuallyAcceptsConformanceValues: true },
        },
      ],
      operations: [
        {
          kind: "predicate",
          role: { id: "m6c.role/wrong-kind", version: "1" },
          operation: {
            id: functionOperation.id,
            version: functionOperation.version,
          },
          obligations: {
            deterministic: true,
            totalOnConformanceValues: true,
            pointwiseEquivalent: true,
          },
        },
        {
          kind: "reducer",
          role: { id: "m6c.role/false-laws", version: "1" },
          operation: { id: reducer.id, version: reducer.version },
          obligations: {
            deterministic: true,
            totalOnConformanceValues: true,
            pointwiseEquivalent: true,
            identity: true,
            associative: false,
            commutative: true,
            idempotent: true,
          },
        },
        {
          kind: "effect",
          role: { id: "m6c.role/missing", version: "1" },
          operation: { id: "m6c/invalid/missing", version: "1" },
          obligations: {
            sameEffectClass: true,
            sameCapability: true,
            sameReplayability: true,
            sameStateChangeSemantics: true,
            sameResourceBounds: true,
          },
        },
      ],
    });
    const result = createCatalog({
      identity: { id: "m6c/invalid/catalog", version: "1" },
      schemas: [number.runtime],
      operations: [functionOperation, reducer],
      semanticRoles: roles,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.error.map((item) => item.code))).toEqual(
      new Set([
        "INVALID_WIRE_SCHEMA",
        "UNKNOWN_SCHEMA",
        "UNKNOWN_OPERATION",
        "OPERATION_KIND_MISMATCH",
        "INVALID_REDUCER",
      ]),
    );
  });

  it("accepts distinct catalogs only after every role-specific obligation passes", async () => {
    const result = await conformCatalogsOffline({
      left: makeCatalog("left", "equivalent"),
      right: makeCatalog("right", "equivalent"),
      suite,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checkedSchemaRoles).toBe(1);
    expect(result.value.checkedOperationRoles).toBe(6);
    expect(result.value.checkedValues).toBe(20);
    expect(result.value.leftCatalogFingerprint).not.toBe(
      result.value.rightCatalogFingerprint,
    );
    expect((await verifyCatalogConformanceReport(result.value)).ok).toBe(true);
    expect(
      (
        await verifyCatalogConformanceReport({
          ...result.value,
          checkedValues: result.value.checkedValues + 1,
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects every fresh adversarial non-equivalence fixture", async () => {
    const corpus = loadM6cOfflineConformanceCorpus();
    const left = makeCatalog("left", "equivalent");
    const outcomes = await Promise.all(
      corpus.hostile.map(async (fixture) => {
        const result = await conformCatalogsOffline({
          left,
          right: makeCatalog(fixture.mutation, fixture.mutation),
          suite,
        });
        return { caseId: fixture.id, acceptedAsEquivalent: result.ok };
      }),
    );
    const audit = await auditM6cFalseEquivalence(outcomes);
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.value).toMatchObject({
      hostileCaseCount: 8,
      acceptedHostileCollisions: 0,
      passed: true,
    });
  });

  it("rejects incomplete, duplicate, and absent declarations and fixtures", async () => {
    const catalog = makeCatalog("valid", "equivalent");
    const noRoles = createCatalog({
      identity: { id: "m6c/no-roles", version: "1" },
      schemas: [],
      operations: [],
    });
    expect(noRoles.ok).toBe(true);
    if (!noRoles.ok) return;
    const absent = await conformCatalogsOffline({
      left: catalog,
      right: noRoles.value,
      suite,
    });
    expect(absent.ok).toBe(false);
    const firstFixture = suite.fixtures.at(0);
    if (firstFixture === undefined) throw new Error("Missing fixture.");
    const duplicate = await conformCatalogsOffline({
      left: catalog,
      right: catalog,
      suite: { ...suite, fixtures: [...suite.fixtures, firstFixture] },
    });
    expect(duplicate.ok).toBe(false);
    const incomplete = await conformCatalogsOffline({
      left: catalog,
      right: catalog,
      suite: { ...suite, fixtures: suite.fixtures.slice(1) },
    });
    expect(incomplete.ok).toBe(false);
  });
});
