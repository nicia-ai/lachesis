import {
  canonicalizeJson,
  type Catalog,
  type CatalogSemanticRoles,
  type Diagnostic,
  diagnostic,
  digestValue,
  fingerprintCatalog,
  readCatalog,
  type Result,
  semanticRoleReferenceSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const conformanceValuesSchema = z.array(z.json()).min(1).max(10_000).readonly();

const schemaFixtureSchema = z
  .strictObject({
    kind: z.literal("schema"),
    role: semanticRoleReferenceSchema,
    values: conformanceValuesSchema,
  })
  .readonly();

const pointwiseFixtureSchemas = [
  "function",
  "predicate",
  "fixedPointStep",
  "measure",
] as const;

const pointwiseFixtureSchema = z
  .strictObject({
    kind: z.enum(pointwiseFixtureSchemas),
    role: semanticRoleReferenceSchema,
    inputs: conformanceValuesSchema,
  })
  .readonly();

const reducerFixtureSchema = z
  .strictObject({
    kind: z.literal("reducer"),
    role: semanticRoleReferenceSchema,
    values: z.array(z.json()).min(3).max(10_000).readonly(),
  })
  .readonly();

const effectFixtureSchema = z
  .strictObject({
    kind: z.literal("effect"),
    role: semanticRoleReferenceSchema,
  })
  .readonly();

export const catalogConformanceFixtureSchema = z.discriminatedUnion("kind", [
  schemaFixtureSchema,
  pointwiseFixtureSchema,
  reducerFixtureSchema,
  effectFixtureSchema,
]);

export type CatalogConformanceFixture = z.infer<
  typeof catalogConformanceFixtureSchema
>;

export const catalogConformanceSuiteSchema = z
  .strictObject({
    protocol: z.literal("lachesis-cross-catalog-conformance-suite/1"),
    fixtures: z
      .array(catalogConformanceFixtureSchema)
      .min(1)
      .max(20_000)
      .readonly(),
  })
  .readonly();

export type CatalogConformanceSuite = z.infer<
  typeof catalogConformanceSuiteSchema
>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const catalogConformanceReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-cross-catalog-conformance-report/1"),
    leftCatalogFingerprint: sha256Schema,
    rightCatalogFingerprint: sha256Schema,
    declarationsDigest: sha256Schema,
    fixtureDigest: sha256Schema,
    checkedSchemaRoles: z.number().int().nonnegative(),
    checkedOperationRoles: z.number().int().nonnegative(),
    checkedValues: z.number().int().nonnegative(),
    passed: z.literal(true),
    reportDigest: sha256Schema,
  })
  .readonly();

export type CatalogConformanceReport = z.infer<
  typeof catalogConformanceReportSchema
>;

/** Verifies report structure and its canonical content-addressed identity. */
export async function verifyCatalogConformanceReport(
  value: unknown,
): Promise<Result<CatalogConformanceReport, Diagnostic>> {
  const parsed = catalogConformanceReportSchema.safeParse(value);
  if (!parsed.success)
    return fail("Cross-catalog conformance report is invalid.");
  const { reportDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  return digest.value === reportDigest
    ? { ok: true, value: parsed.data }
    : fail("Cross-catalog conformance report identity is invalid.");
}

type CatalogState = ReturnType<typeof readCatalog>;
type Operation =
  CatalogState["operations"] extends ReadonlyMap<string, infer O> ? O : never;

function key(reference: Readonly<{ id: string; version: string }>): string {
  return `${reference.id}@${reference.version}`;
}

function fail(message: string): Result<never, Diagnostic> {
  return {
    ok: false,
    error: diagnostic("SEMANTIC_OBLIGATION_FAILED", message),
  };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

function declarations(
  state: CatalogState,
): Result<CatalogSemanticRoles, Diagnostic> {
  return state.semanticRoles === undefined
    ? fail(`Catalog ${key(state.identity)} has no semantic-role declaration.`)
    : { ok: true, value: state.semanticRoles };
}

function roleSet(
  items: ReadonlyArray<
    Readonly<{ role: Readonly<{ id: string; version: string }> }>
  >,
): ReadonlyArray<string> {
  return items.map((item) => key(item.role)).toSorted();
}

function equalRoleSets(
  left: ReadonlyArray<
    Readonly<{ role: Readonly<{ id: string; version: string }> }>
  >,
  right: ReadonlyArray<
    Readonly<{ role: Readonly<{ id: string; version: string }> }>
  >,
): boolean {
  return roleSet(left).join("\u0000") === roleSet(right).join("\u0000");
}

function schemaRoleByRegistration(
  roles: CatalogSemanticRoles,
): ReadonlyMap<string, string> {
  return new Map(
    roles.schemas.map((item) => [key(item.schema), key(item.role)]),
  );
}

function schemaKindContract(
  schema: CatalogState["schemas"] extends ReadonlyMap<string, infer S>
    ? S
    : never,
  roles: ReadonlyMap<string, string>,
): unknown {
  return schema.kind.kind === "scalar"
    ? schema.kind
    : {
        kind: schema.kind.kind,
        elementRole: roles.get(key(schema.kind.element)) ?? null,
        defaultMaxItems: schema.kind.defaultMaxItems ?? null,
      };
}

function operationForRole(
  state: CatalogState,
  roles: CatalogSemanticRoles,
  role: string,
): Operation | undefined {
  const declaration = roles.operations.find((item) => key(item.role) === role);
  return declaration === undefined
    ? undefined
    : state.operations.get(key(declaration.operation));
}

function operationSchemaRoles(
  operation: Operation,
  schemas: ReadonlyMap<string, string>,
): ReadonlyArray<string | undefined> {
  if (operation.kind === "reducer")
    return [
      schemas.get(key(operation.element)),
      schemas.get(key(operation.accumulator)),
    ];
  if (operation.kind === "predicate" || operation.kind === "measure")
    return [schemas.get(key(operation.input))];
  return [
    schemas.get(key(operation.input)),
    schemas.get(key(operation.output)),
  ];
}

function sameOperationSchemaRoles(
  left: Operation,
  right: Operation,
  leftSchemas: ReadonlyMap<string, string>,
  rightSchemas: ReadonlyMap<string, string>,
): boolean {
  return (
    operationSchemaRoles(left, leftSchemas).join("\u0000") ===
    operationSchemaRoles(right, rightSchemas).join("\u0000")
  );
}

function pointwiseMetadata(operation: Operation): unknown {
  return operation.kind === "function"
    ? { maxOutputItems: operation.maxOutputItems ?? null }
    : null;
}

function invokePointwise(
  operation: Operation,
  input: unknown,
): Result<unknown, Diagnostic> {
  switch (operation.kind) {
    case "function":
    case "fixedPointStep":
      return operation.invoke(input);
    case "predicate":
      return operation.test(input);
    case "measure":
      return operation.measure(input);
    case "reducer":
    case "effect":
      return fail(`Operation ${key(operation)} is not pointwise invokable.`);
  }
}

function checkPointwise(
  role: string,
  left: Operation,
  right: Operation,
  inputs: ReadonlyArray<unknown>,
): Result<true, Diagnostic> {
  for (const input of inputs) {
    const leftFirst = invokePointwise(left, input);
    const leftSecond = invokePointwise(left, input);
    const rightFirst = invokePointwise(right, input);
    const rightSecond = invokePointwise(right, input);
    if (
      !leftFirst.ok ||
      !leftSecond.ok ||
      !rightFirst.ok ||
      !rightSecond.ok ||
      !canonicalEqual(leftFirst.value, leftSecond.value) ||
      !canonicalEqual(rightFirst.value, rightSecond.value) ||
      !canonicalEqual(leftFirst.value, rightFirst.value)
    )
      return fail(`Pointwise obligation failed for semantic role ${role}.`);
  }
  return { ok: true, value: true };
}

function reduce(
  operation: Operation,
  accumulator: unknown,
  element: unknown,
): Result<unknown, Diagnostic> {
  return operation.kind === "reducer"
    ? operation.reduce(accumulator, element)
    : fail(`Operation ${key(operation)} is not a reducer.`);
}

function reducerLaw(
  role: string,
  operation: Operation,
  values: ReadonlyArray<unknown>,
): Result<true, Diagnostic> {
  if (operation.kind !== "reducer") return fail(`${role} is not a reducer.`);
  for (const value of values) {
    const identity = reduce(operation, operation.identity, value);
    const deterministic = reduce(operation, operation.identity, value);
    if (
      !identity.ok ||
      !deterministic.ok ||
      !canonicalEqual(identity.value, value) ||
      !canonicalEqual(identity.value, deterministic.value)
    )
      return fail(
        `Identity or determinism obligation failed for reducer role ${role}.`,
      );
    if (operation.laws.idempotent) {
      const idempotent = reduce(operation, value, value);
      if (!idempotent.ok || !canonicalEqual(idempotent.value, value))
        return fail(`Idempotence obligation failed for reducer role ${role}.`);
    }
  }
  for (let index = 0; index + 2 < values.length; index += 1) {
    const first = values[index];
    const second = values[index + 1];
    const third = values[index + 2];
    if (operation.laws.commutative) {
      const forward = reduce(operation, first, second);
      const reverse = reduce(operation, second, first);
      if (
        !forward.ok ||
        !reverse.ok ||
        !canonicalEqual(forward.value, reverse.value)
      )
        return fail(
          `Commutativity obligation failed for reducer role ${role}.`,
        );
    }
    if (operation.laws.associative) {
      const leftInner = reduce(operation, first, second);
      const rightInner = reduce(operation, second, third);
      if (!leftInner.ok || !rightInner.ok)
        return fail(`Associativity setup failed for reducer role ${role}.`);
      const left = reduce(operation, leftInner.value, third);
      const right = reduce(operation, first, rightInner.value);
      if (!left.ok || !right.ok || !canonicalEqual(left.value, right.value))
        return fail(
          `Associativity obligation failed for reducer role ${role}.`,
        );
    }
  }
  return { ok: true, value: true };
}

function checkReducers(
  role: string,
  left: Operation,
  right: Operation,
  values: ReadonlyArray<unknown>,
): Result<true, Diagnostic> {
  if (left.kind !== "reducer" || right.kind !== "reducer")
    return fail(`Semantic role ${role} does not resolve to two reducers.`);
  if (
    !canonicalEqual(left.laws, right.laws) ||
    !canonicalEqual(left.identity, right.identity)
  )
    return fail(`Reducer metadata differs for semantic role ${role}.`);
  const leftLaw = reducerLaw(role, left, values);
  if (!leftLaw.ok) return leftLaw;
  const rightLaw = reducerLaw(role, right, values);
  if (!rightLaw.ok) return rightLaw;
  for (const accumulator of values)
    for (const element of values) {
      const leftValue = reduce(left, accumulator, element);
      const rightValue = reduce(right, accumulator, element);
      if (
        !leftValue.ok ||
        !rightValue.ok ||
        !canonicalEqual(leftValue.value, rightValue.value)
      )
        return fail(
          `Pointwise reducer obligation failed for semantic role ${role}.`,
        );
    }
  return { ok: true, value: true };
}

function effectContract(operation: Operation): unknown {
  return operation.kind === "effect"
    ? {
        effectName: operation.effectName,
        capability: operation.capability,
        replayable: operation.replayable,
        stateChanging: operation.semantics.stateChanging,
        maxTokens: operation.maxTokens,
        maxWallClockMs: operation.maxWallClockMs,
        maxOutputItems: operation.maxOutputItems ?? null,
      }
    : null;
}

/** Checks an application-supplied, finite, offline equivalence domain. */
export async function conformCatalogsOffline(
  input: Readonly<{
    left: Catalog;
    right: Catalog;
    suite: z.input<typeof catalogConformanceSuiteSchema>;
  }>,
): Promise<Result<CatalogConformanceReport, Diagnostic>> {
  const suite = catalogConformanceSuiteSchema.safeParse(input.suite);
  if (!suite.success)
    return fail("Cross-catalog conformance suite is invalid.");
  const leftState = readCatalog(input.left);
  const rightState = readCatalog(input.right);
  const leftDeclarations = declarations(leftState);
  if (!leftDeclarations.ok) return leftDeclarations;
  const rightDeclarations = declarations(rightState);
  if (!rightDeclarations.ok) return rightDeclarations;
  if (
    !equalRoleSets(
      leftDeclarations.value.schemas,
      rightDeclarations.value.schemas,
    ) ||
    !equalRoleSets(
      leftDeclarations.value.operations,
      rightDeclarations.value.operations,
    )
  )
    return fail(
      "Catalogs do not declare the same versioned semantic-role set.",
    );
  const fixtureRoles = suite.data.fixtures.map((fixture) => key(fixture.role));
  if (new Set(fixtureRoles).size !== fixtureRoles.length)
    return fail("Every conformance role must have exactly one fixture.");
  const declaredRoles = [
    ...roleSet(leftDeclarations.value.schemas),
    ...roleSet(leftDeclarations.value.operations),
  ].toSorted();
  if (fixtureRoles.toSorted().join("\u0000") !== declaredRoles.join("\u0000"))
    return fail(
      "Conformance fixtures must cover every declared role exactly once.",
    );
  const leftSchemasByRole = new Map(
    leftDeclarations.value.schemas.map((item) => [key(item.role), item]),
  );
  const rightSchemasByRole = new Map(
    rightDeclarations.value.schemas.map((item) => [key(item.role), item]),
  );
  const leftSchemaRoles = schemaRoleByRegistration(leftDeclarations.value);
  const rightSchemaRoles = schemaRoleByRegistration(rightDeclarations.value);
  let checkedValues = 0;
  for (const fixture of suite.data.fixtures) {
    const role = key(fixture.role);
    if (fixture.kind === "schema") {
      const leftDeclaration = leftSchemasByRole.get(role);
      const rightDeclaration = rightSchemasByRole.get(role);
      if (leftDeclaration === undefined || rightDeclaration === undefined)
        return fail(
          `Schema fixture ${role} does not resolve in both catalogs.`,
        );
      const leftSchema = leftState.schemas.get(key(leftDeclaration.schema));
      const rightSchema = rightState.schemas.get(key(rightDeclaration.schema));
      if (
        leftSchema === undefined ||
        rightSchema === undefined ||
        !canonicalEqual(
          schemaKindContract(leftSchema, leftSchemaRoles),
          schemaKindContract(rightSchema, rightSchemaRoles),
        )
      )
        return fail(`Schema kind obligation failed for semantic role ${role}.`);
      for (const value of fixture.values)
        if (!leftSchema.parse(value).ok || !rightSchema.parse(value).ok)
          return fail(
            `Mutual schema acceptance failed for semantic role ${role}.`,
          );
      checkedValues += fixture.values.length;
      continue;
    }
    const leftOperation = operationForRole(
      leftState,
      leftDeclarations.value,
      role,
    );
    const rightOperation = operationForRole(
      rightState,
      rightDeclarations.value,
      role,
    );
    if (
      leftOperation === undefined ||
      rightOperation === undefined ||
      leftOperation.kind !== fixture.kind ||
      rightOperation.kind !== fixture.kind ||
      leftOperation.semantics.stateChanging !==
        rightOperation.semantics.stateChanging ||
      !canonicalEqual(
        pointwiseMetadata(leftOperation),
        pointwiseMetadata(rightOperation),
      ) ||
      !sameOperationSchemaRoles(
        leftOperation,
        rightOperation,
        leftSchemaRoles,
        rightSchemaRoles,
      )
    )
      return fail(
        `Operation declaration obligation failed for semantic role ${role}.`,
      );
    if (fixture.kind === "effect") {
      if (
        !canonicalEqual(
          effectContract(leftOperation),
          effectContract(rightOperation),
        )
      )
        return fail(
          `Effect contract obligation failed for semantic role ${role}.`,
        );
      continue;
    }
    if (fixture.kind === "reducer") {
      const checked = checkReducers(
        role,
        leftOperation,
        rightOperation,
        fixture.values,
      );
      if (!checked.ok) return checked;
      checkedValues += fixture.values.length;
      continue;
    }
    const checked = checkPointwise(
      role,
      leftOperation,
      rightOperation,
      fixture.inputs,
    );
    if (!checked.ok) return checked;
    checkedValues += fixture.inputs.length;
  }
  const fingerprints = await Promise.all([
    fingerprintCatalog(input.left),
    fingerprintCatalog(input.right),
  ]);
  const leftFingerprint = fingerprints[0];
  const rightFingerprint = fingerprints[1];
  if (!leftFingerprint.ok || !rightFingerprint.ok)
    return fail("Catalog fingerprints could not be constructed.");
  const declarationDigest = await digestValue({
    left: leftDeclarations.value,
    right: rightDeclarations.value,
  });
  const fixtureDigest = await digestValue(suite.data);
  if (!declarationDigest.ok || !fixtureDigest.ok)
    return fail("Conformance inputs could not be content addressed.");
  const body = {
    protocol: "lachesis-cross-catalog-conformance-report/1" as const,
    leftCatalogFingerprint: leftFingerprint.value,
    rightCatalogFingerprint: rightFingerprint.value,
    declarationsDigest: declarationDigest.value,
    fixtureDigest: fixtureDigest.value,
    checkedSchemaRoles: leftDeclarations.value.schemas.length,
    checkedOperationRoles: leftDeclarations.value.operations.length,
    checkedValues,
    passed: true as const,
  };
  const reportDigest = await digestValue(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: catalogConformanceReportSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}
