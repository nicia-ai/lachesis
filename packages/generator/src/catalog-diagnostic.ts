import {
  canonicalizeJson,
  type Catalog,
  type CatalogSemanticRoles,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  readCatalog,
  type Result,
  type SemanticRoleReference,
  semanticRoleReferenceSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  catalogConformanceReportSchema,
  type CatalogConformanceSuite,
  catalogConformanceSuiteSchema,
  conformCatalogsOffline,
} from "./catalog-conformance.js";

export const catalogDiagnosticOutcomeSchema = z.enum([
  "declaration-repairable",
  "genuinely-non-equivalent",
  "insufficient-evidence",
]);
export type CatalogDiagnosticOutcome = z.infer<
  typeof catalogDiagnosticOutcomeSchema
>;

export const catalogDiagnosticCodeSchema = z.enum([
  "MISSING_ROLE_DECLARATION",
  "ROLE_VERSION_MISMATCH",
  "INCOMPATIBLE_OBLIGATIONS",
  "INCOMPLETE_FIXTURE_EVIDENCE",
  "DUPLICATE_FIXTURE_EVIDENCE",
  "SCHEMA_BOUNDARY_MISMATCH",
  "OPERATION_SIGNATURE_MISMATCH",
  "CAPABILITY_MISMATCH",
  "EFFECT_CONTRACT_MISMATCH",
  "ORDERING_SEMANTICS_MISMATCH",
  "STATE_TRANSITION_MISMATCH",
  "OUTPUT_SEMANTICS_MISMATCH",
  "UNRESOLVED_CONFORMANCE_FAILURE",
]);
export type CatalogDiagnosticCode = z.infer<typeof catalogDiagnosticCodeSchema>;

const roleSchema = semanticRoleReferenceSchema.nullable();
const sideSchema = z.enum(["left", "right", "both", "suite"]);

const reviewDeclarationActionSchema = z
  .strictObject({
    kind: z.literal("review-declaration"),
    mechanical: z.literal(false),
    side: z.enum(["left", "right", "both"]),
    operation: z.enum(["add-role", "align-role-version", "align-obligations"]),
    role: roleSchema,
    patchDescription: z.string().min(1),
    safetyCondition: z.string().min(1),
  })
  .readonly();

const editSuiteActionSchema = z
  .strictObject({
    kind: z.literal("edit-suite"),
    mechanical: z.literal(true),
    operation: z.enum(["add-fixture", "remove-duplicate-fixture"]),
    role: roleSchema,
    patchDescription: z.string().min(1),
  })
  .readonly();

const doNotSubstituteActionSchema = z
  .strictObject({
    kind: z.literal("do-not-substitute"),
    mechanical: z.literal(false),
    violatedObligation: z.string().min(1),
    reason: z.string().min(1),
  })
  .readonly();

const noSafeRepairActionSchema = z
  .strictObject({
    kind: z.literal("no-safe-repair"),
    mechanical: z.literal(false),
    reason: z.string().min(1),
  })
  .readonly();

export const catalogRepairActionSchema = z.discriminatedUnion("kind", [
  reviewDeclarationActionSchema,
  editSuiteActionSchema,
  doNotSubstituteActionSchema,
  noSafeRepairActionSchema,
]);
export type CatalogRepairAction = z.infer<typeof catalogRepairActionSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const diagnosticEvidenceSchema = z
  .strictObject({
    leftCatalogFingerprint: sha256Schema,
    rightCatalogFingerprint: sha256Schema,
    leftManifestDigest: sha256Schema,
    rightManifestDigest: sha256Schema,
    fixtureDigest: sha256Schema.nullable(),
    inputDigest: sha256Schema.nullable(),
    leftValueDigest: sha256Schema.nullable(),
    rightValueDigest: sha256Schema.nullable(),
  })
  .readonly();

export const catalogConformanceDiagnosticSchema = z
  .strictObject({
    protocol: z.literal("lachesis-catalog-conformance-diagnostic/1"),
    code: catalogDiagnosticCodeSchema,
    outcome: catalogDiagnosticOutcomeSchema,
    side: sideSchema,
    role: roleSchema,
    boundary: z.string().min(1),
    obligation: z.string().min(1),
    explanation: z.string().min(1),
    action: catalogRepairActionSchema,
    evidence: diagnosticEvidenceSchema,
    diagnosticDigest: sha256Schema,
    recordDigest: sha256Schema,
  })
  .readonly();
export type CatalogConformanceDiagnostic = z.infer<
  typeof catalogConformanceDiagnosticSchema
>;

const conformantAssessmentSchema = z
  .strictObject({
    kind: z.literal("conformant"),
    report: catalogConformanceReportSchema,
  })
  .readonly();
const rejectedAssessmentSchema = z
  .strictObject({
    kind: z.literal("rejected"),
    diagnostic: catalogConformanceDiagnosticSchema,
  })
  .readonly();

export const catalogDiagnosticAssessmentSchema = z.discriminatedUnion("kind", [
  conformantAssessmentSchema,
  rejectedAssessmentSchema,
]);
export type CatalogDiagnosticAssessment = z.infer<
  typeof catalogDiagnosticAssessmentSchema
>;

type CatalogState = ReturnType<typeof readCatalog>;
type Operation =
  CatalogState["operations"] extends ReadonlyMap<string, infer O> ? O : never;
type RoleReference = SemanticRoleReference;

const manifestPolicy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 10_000,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 1_000,
    maxParallelism: 1,
  },
} as const;

function key(reference: Readonly<{ id: string; version: string }>): string {
  return `${reference.id}@${reference.version}`;
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

function roleIdentity(reference: RoleReference | null): unknown {
  return reference === null
    ? null
    : { id: reference.id, version: reference.version };
}

type DiagnosticCore = Readonly<{
  code: CatalogDiagnosticCode;
  outcome: CatalogDiagnosticOutcome;
  side: "left" | "right" | "both" | "suite";
  role: RoleReference | null;
  boundary: string;
  obligation: string;
  explanation: string;
  action: CatalogRepairAction;
  inputDigest: string | null;
  leftValueDigest: string | null;
  rightValueDigest: string | null;
}>;

async function digestOrNull(value: unknown): Promise<string | null> {
  if (value === undefined) return null;
  const digest = await digestValue(value);
  return digest.ok ? digest.value : null;
}

async function makeDiagnostic(
  core: DiagnosticCore,
  context: Readonly<{
    left: Catalog;
    right: Catalog;
    suite: CatalogConformanceSuite | null;
  }>,
): Promise<Result<CatalogConformanceDiagnostic, Diagnostic>> {
  const [leftManifest, rightManifest, fixtureDigest] = await Promise.all([
    createPlanLanguageManifest(context.left, manifestPolicy),
    createPlanLanguageManifest(context.right, manifestPolicy),
    context.suite === null
      ? Promise.resolve(null)
      : digestOrNull(context.suite),
  ]);
  if (!leftManifest.ok || !rightManifest.ok)
    return {
      ok: false,
      error: diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        "Catalog diagnostic manifests could not be constructed.",
      ),
    };
  const identityBody = {
    protocol: "lachesis-catalog-conformance-diagnostic-identity/1" as const,
    code: core.code,
    outcome: core.outcome,
    side: core.side,
    role: roleIdentity(core.role),
    boundary: core.boundary,
    obligation: core.obligation,
    action: core.action,
    inputDigest: core.inputDigest,
    leftValueDigest: core.leftValueDigest,
    rightValueDigest: core.rightValueDigest,
  };
  const diagnosticDigest = await digestValue(identityBody);
  if (!diagnosticDigest.ok) return diagnosticDigest;
  const evidence = {
    leftCatalogFingerprint: leftManifest.value.catalogFingerprint,
    rightCatalogFingerprint: rightManifest.value.catalogFingerprint,
    leftManifestDigest: leftManifest.value.manifestDigest,
    rightManifestDigest: rightManifest.value.manifestDigest,
    fixtureDigest,
    inputDigest: core.inputDigest,
    leftValueDigest: core.leftValueDigest,
    rightValueDigest: core.rightValueDigest,
  };
  const body = {
    protocol: "lachesis-catalog-conformance-diagnostic/1" as const,
    code: core.code,
    outcome: core.outcome,
    side: core.side,
    role: core.role,
    boundary: core.boundary,
    obligation: core.obligation,
    explanation: core.explanation,
    action: core.action,
    evidence,
    diagnosticDigest: diagnosticDigest.value,
  };
  const recordDigest = await digestValue(body);
  return recordDigest.ok
    ? {
        ok: true,
        value: catalogConformanceDiagnosticSchema.parse({
          ...body,
          recordDigest: recordDigest.value,
        }),
      }
    : recordDigest;
}

function declarations(state: CatalogState): CatalogSemanticRoles | null {
  return state.semanticRoles ?? null;
}

function allRoleReferences(
  roles: CatalogSemanticRoles,
): ReadonlyArray<RoleReference> {
  return [
    ...roles.schemas.map((item) => item.role),
    ...roles.operations.map((item) => item.role),
  ];
}

function roleById(
  roles: CatalogSemanticRoles,
): ReadonlyMap<string, RoleReference> {
  return new Map(allRoleReferences(roles).map((role) => [role.id, role]));
}

function schemaRoleByRegistration(
  roles: CatalogSemanticRoles,
): ReadonlyMap<string, string> {
  return new Map(
    roles.schemas.map((item) => [key(item.schema), key(item.role)]),
  );
}

function operationByRole(
  state: CatalogState,
  roles: CatalogSemanticRoles,
  role: RoleReference,
): Operation | undefined {
  const declaration = roles.operations.find(
    (item) => key(item.role) === key(role),
  );
  return declaration === undefined
    ? undefined
    : state.operations.get(key(declaration.operation));
}

function operationSchemaRoleKeys(
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

function invoke(
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
      return {
        ok: false,
        error: diagnostic(
          "SEMANTIC_OBLIGATION_FAILED",
          "Operation is not pointwise invokable.",
        ),
      };
  }
}

function reduce(
  operation: Operation,
  accumulator: unknown,
  element: unknown,
): Result<unknown, Diagnostic> {
  return operation.kind === "reducer"
    ? operation.reduce(accumulator, element)
    : {
        ok: false,
        error: diagnostic(
          "SEMANTIC_OBLIGATION_FAILED",
          "Operation is not a reducer.",
        ),
      };
}

function sameMembersDifferentOrder(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const canonicalItems = (items: ReadonlyArray<unknown>): string | null => {
    const values: Array<string> = [];
    for (const item of items) {
      const canonical = canonicalizeJson(item);
      if (!canonical.ok) return null;
      values.push(canonical.value);
    }
    return values.toSorted().join("\u0000");
  };
  const leftItems = canonicalItems(left);
  const rightItems = canonicalItems(right);
  return leftItems !== null && leftItems === rightItems;
}

function nonSubstitutionAction(obligation: string): CatalogRepairAction {
  return {
    kind: "do-not-substitute",
    mechanical: false,
    violatedObligation: obligation,
    reason:
      "The catalogs are semantically different on the supplied domain. Do not align metadata or substitute operations.",
  };
}

async function semanticMismatch(
  input: Readonly<{
    code: CatalogDiagnosticCode;
    role: RoleReference;
    boundary: string;
    obligation: string;
    explanation: string;
    left: Catalog;
    right: Catalog;
    suite: CatalogConformanceSuite;
    fixtureInput?: unknown;
    leftValue?: unknown;
    rightValue?: unknown;
  }>,
): Promise<Result<CatalogConformanceDiagnostic, Diagnostic>> {
  const [inputDigest, leftValueDigest, rightValueDigest] = await Promise.all([
    digestOrNull(input.fixtureInput),
    digestOrNull(input.leftValue),
    digestOrNull(input.rightValue),
  ]);
  return makeDiagnostic(
    {
      code: input.code,
      outcome: "genuinely-non-equivalent",
      side: "both",
      role: input.role,
      boundary: input.boundary,
      obligation: input.obligation,
      explanation: input.explanation,
      action: nonSubstitutionAction(input.obligation),
      inputDigest,
      leftValueDigest,
      rightValueDigest,
    },
    input,
  );
}

async function diagnoseRejected(
  input: Readonly<{
    left: Catalog;
    right: Catalog;
    suite: unknown;
  }>,
): Promise<Result<CatalogConformanceDiagnostic, Diagnostic>> {
  const parsedSuite = catalogConformanceSuiteSchema.safeParse(input.suite);
  if (!parsedSuite.success)
    return makeDiagnostic(
      {
        code: "INCOMPLETE_FIXTURE_EVIDENCE",
        outcome: "insufficient-evidence",
        side: "suite",
        role: null,
        boundary: "suite-schema",
        obligation: "valid-complete-fixture-suite",
        explanation:
          "The conformance suite is invalid, so semantic equivalence cannot be evaluated.",
        action: {
          kind: "no-safe-repair",
          mechanical: false,
          reason:
            "Validate the suite schema and preserve rejection until complete evidence is supplied.",
        },
        inputDigest: null,
        leftValueDigest: null,
        rightValueDigest: null,
      },
      { ...input, suite: null },
    );
  const suite = parsedSuite.data;
  const leftState = readCatalog(input.left);
  const rightState = readCatalog(input.right);
  const leftRoles = declarations(leftState);
  const rightRoles = declarations(rightState);
  if (leftRoles === null || rightRoles === null) {
    const side =
      leftRoles === null && rightRoles === null
        ? "both"
        : leftRoles === null
          ? "left"
          : "right";
    return makeDiagnostic(
      {
        code: "MISSING_ROLE_DECLARATION",
        outcome: "declaration-repairable",
        side,
        role: suite.fixtures.at(0)?.role ?? null,
        boundary: "catalog-semantic-role-declarations",
        obligation: "declared-versioned-role-set",
        explanation:
          "A catalog has no semantic-role declaration, so its registrations cannot be aligned safely.",
        action: {
          kind: "review-declaration",
          mechanical: false,
          side,
          operation: "add-role",
          role: suite.fixtures.at(0)?.role ?? null,
          patchDescription:
            "Add explicit mappings for every suite role to the intended registered schemas and operations, then rerun conformance.",
          safetyCondition:
            "Only add a mapping after the catalog author attests that the registration implements the written role contract.",
        },
        inputDigest: null,
        leftValueDigest: null,
        rightValueDigest: null,
      },
      { ...input, suite },
    );
  }
  const leftById = roleById(leftRoles);
  const rightById = roleById(rightRoles);
  const allRoleIds = [
    ...new Set([...leftById.keys(), ...rightById.keys()]),
  ].toSorted();
  for (const roleId of allRoleIds) {
    const leftRole = leftById.get(roleId);
    const rightRole = rightById.get(roleId);
    if (leftRole === undefined || rightRole === undefined) {
      const present = leftRole ?? rightRole;
      if (present === undefined) continue;
      const side = leftRole === undefined ? "left" : "right";
      return makeDiagnostic(
        {
          code: "MISSING_ROLE_DECLARATION",
          outcome: "declaration-repairable",
          side,
          role: present,
          boundary: `role:${roleId}`,
          obligation: "complete-versioned-role-set",
          explanation: `The ${side} catalog is missing the declared role ${key(present)}.`,
          action: {
            kind: "review-declaration",
            mechanical: false,
            side,
            operation: "add-role",
            role: present,
            patchDescription: `Map ${key(present)} to the intended ${side} registration and regenerate the manifest.`,
            safetyCondition:
              "Do not add the role merely to obtain a pass; the author must attest semantic compatibility first.",
          },
          inputDigest: null,
          leftValueDigest: null,
          rightValueDigest: null,
        },
        { ...input, suite },
      );
    }
    if (leftRole.version !== rightRole.version) {
      return makeDiagnostic(
        {
          code: "ROLE_VERSION_MISMATCH",
          outcome: "declaration-repairable",
          side: "both",
          role: leftRole,
          boundary: `role-version:${roleId}`,
          obligation: "exact-role-version",
          explanation: `Role ${roleId} declares versions ${leftRole.version} and ${rightRole.version}.`,
          action: {
            kind: "review-declaration",
            mechanical: false,
            side: "both",
            operation: "align-role-version",
            role: leftRole,
            patchDescription:
              "Select the written role-contract version each catalog actually implements, update only a stale declaration, and regenerate both manifests.",
            safetyCondition:
              "If the versions intentionally denote different semantics, do not edit metadata and do not substitute.",
          },
          inputDigest: null,
          leftValueDigest: null,
          rightValueDigest: null,
        },
        { ...input, suite },
      );
    }
  }
  const fixtureKeys = suite.fixtures.map((fixture) => key(fixture.role));
  const duplicateKey = fixtureKeys.find(
    (fixtureKey, index) => fixtureKeys.indexOf(fixtureKey) !== index,
  );
  if (duplicateKey !== undefined) {
    const fixture = suite.fixtures.find(
      (item) => key(item.role) === duplicateKey,
    );
    return makeDiagnostic(
      {
        code: "DUPLICATE_FIXTURE_EVIDENCE",
        outcome: "insufficient-evidence",
        side: "suite",
        role: fixture?.role ?? null,
        boundary: `duplicate-fixture:${duplicateKey}`,
        obligation: "exactly-one-fixture-per-role",
        explanation: `Role ${duplicateKey} has more than one fixture.`,
        action: {
          kind: "edit-suite",
          mechanical: true,
          operation: "remove-duplicate-fixture",
          role: fixture?.role ?? null,
          patchDescription: `Retain one reviewed fixture for ${duplicateKey} and remove duplicate entries without changing values.`,
        },
        inputDigest: null,
        leftValueDigest: null,
        rightValueDigest: null,
      },
      { ...input, suite },
    );
  }
  const declaredKeys = allRoleReferences(leftRoles).map(key).toSorted();
  const missingFixtureKey = declaredKeys.find(
    (roleKey) => !fixtureKeys.includes(roleKey),
  );
  if (missingFixtureKey !== undefined) {
    const role = allRoleReferences(leftRoles).find(
      (item) => key(item) === missingFixtureKey,
    );
    return makeDiagnostic(
      {
        code: "INCOMPLETE_FIXTURE_EVIDENCE",
        outcome: "insufficient-evidence",
        side: "suite",
        role: role ?? null,
        boundary: `missing-fixture:${missingFixtureKey}`,
        obligation: "complete-role-evidence",
        explanation: `No fixture supplies evidence for ${missingFixtureKey}.`,
        action: {
          kind: "edit-suite",
          mechanical: true,
          operation: "add-fixture",
          role: role ?? null,
          patchDescription: `Add one boundary-focused fixture for ${missingFixtureKey}; do not infer equivalence until it passes.`,
        },
        inputDigest: null,
        leftValueDigest: null,
        rightValueDigest: null,
      },
      { ...input, suite },
    );
  }
  const leftSchemaRegistrations = schemaRoleByRegistration(leftRoles);
  const rightSchemaRegistrations = schemaRoleByRegistration(rightRoles);
  for (const fixture of suite.fixtures) {
    if (fixture.kind === "schema") {
      const leftRegistration = leftRoles.schemas.find(
        (item) => key(item.role) === key(fixture.role),
      );
      const rightRegistration = rightRoles.schemas.find(
        (item) => key(item.role) === key(fixture.role),
      );
      if (leftRegistration === undefined || rightRegistration === undefined)
        continue;
      const leftSchema = leftState.schemas.get(key(leftRegistration.schema));
      const rightSchema = rightState.schemas.get(key(rightRegistration.schema));
      if (leftSchema === undefined || rightSchema === undefined) continue;
      for (const value of fixture.values) {
        const leftAccepted = leftSchema.parse(value).ok;
        const rightAccepted = rightSchema.parse(value).ok;
        if (!leftAccepted || !rightAccepted)
          return semanticMismatch({
            code: "SCHEMA_BOUNDARY_MISMATCH",
            role: fixture.role,
            boundary: `schema-value:${fixture.values.indexOf(value)}`,
            obligation: "mutual-schema-acceptance",
            explanation: `Schema role ${key(fixture.role)} does not mutually accept a supplied boundary value.`,
            left: input.left,
            right: input.right,
            suite,
            fixtureInput: value,
            leftValue: leftAccepted,
            rightValue: rightAccepted,
          });
      }
      continue;
    }
    const leftOperation = operationByRole(leftState, leftRoles, fixture.role);
    const rightOperation = operationByRole(
      rightState,
      rightRoles,
      fixture.role,
    );
    if (leftOperation === undefined || rightOperation === undefined) continue;
    if (
      leftOperation.kind !== fixture.kind ||
      rightOperation.kind !== fixture.kind ||
      !canonicalEqual(
        operationSchemaRoleKeys(leftOperation, leftSchemaRegistrations),
        operationSchemaRoleKeys(rightOperation, rightSchemaRegistrations),
      )
    )
      return semanticMismatch({
        code: "OPERATION_SIGNATURE_MISMATCH",
        role: fixture.role,
        boundary: "operation-signature",
        obligation: "role-aligned-operation-signature",
        explanation: `Operation role ${key(fixture.role)} has incompatible kinds or schema roles.`,
        left: input.left,
        right: input.right,
        suite,
        leftValue: {
          kind: leftOperation.kind,
          schemas: operationSchemaRoleKeys(
            leftOperation,
            leftSchemaRegistrations,
          ),
        },
        rightValue: {
          kind: rightOperation.kind,
          schemas: operationSchemaRoleKeys(
            rightOperation,
            rightSchemaRegistrations,
          ),
        },
      });
    if (
      leftOperation.semantics.stateChanging !==
      rightOperation.semantics.stateChanging
    )
      return semanticMismatch({
        code: "STATE_TRANSITION_MISMATCH",
        role: fixture.role,
        boundary: "state-change-semantics",
        obligation: "same-state-change-semantics",
        explanation: `Operation role ${key(fixture.role)} disagrees on state-changing semantics.`,
        left: input.left,
        right: input.right,
        suite,
        leftValue: leftOperation.semantics.stateChanging,
        rightValue: rightOperation.semantics.stateChanging,
      });
    if (fixture.kind === "effect") {
      if (leftOperation.kind !== "effect" || rightOperation.kind !== "effect")
        continue;
      if (leftOperation.capability !== rightOperation.capability)
        return semanticMismatch({
          code: "CAPABILITY_MISMATCH",
          role: fixture.role,
          boundary: "effect-capability",
          obligation: "same-capability",
          explanation: `Effect role ${key(fixture.role)} requires different capabilities.`,
          left: input.left,
          right: input.right,
          suite,
          leftValue: leftOperation.capability,
          rightValue: rightOperation.capability,
        });
      const leftContract = {
        effectName: leftOperation.effectName,
        replayable: leftOperation.replayable,
        maxTokens: leftOperation.maxTokens,
        maxWallClockMs: leftOperation.maxWallClockMs,
        maxOutputItems: leftOperation.maxOutputItems ?? null,
      };
      const rightContract = {
        effectName: rightOperation.effectName,
        replayable: rightOperation.replayable,
        maxTokens: rightOperation.maxTokens,
        maxWallClockMs: rightOperation.maxWallClockMs,
        maxOutputItems: rightOperation.maxOutputItems ?? null,
      };
      if (!canonicalEqual(leftContract, rightContract))
        return semanticMismatch({
          code: "EFFECT_CONTRACT_MISMATCH",
          role: fixture.role,
          boundary: "effect-contract",
          obligation: "same-effect-contract",
          explanation: `Effect role ${key(fixture.role)} has a different class, replayability, or resource bound.`,
          left: input.left,
          right: input.right,
          suite,
          leftValue: leftContract,
          rightValue: rightContract,
        });
      continue;
    }
    if (fixture.kind === "reducer") {
      if (leftOperation.kind !== "reducer" || rightOperation.kind !== "reducer")
        continue;
      if (
        !canonicalEqual(leftOperation.laws, rightOperation.laws) ||
        !canonicalEqual(leftOperation.identity, rightOperation.identity)
      )
        return semanticMismatch({
          code: "INCOMPATIBLE_OBLIGATIONS",
          role: fixture.role,
          boundary: "reducer-identity-and-laws",
          obligation: "same-reducer-obligations",
          explanation: `Reducer role ${key(fixture.role)} declares incompatible identity or law obligations.`,
          left: input.left,
          right: input.right,
          suite,
          leftValue: {
            identity: leftOperation.identity,
            laws: leftOperation.laws,
          },
          rightValue: {
            identity: rightOperation.identity,
            laws: rightOperation.laws,
          },
        });
      for (const accumulator of fixture.values)
        for (const element of fixture.values) {
          const leftValue = reduce(leftOperation, accumulator, element);
          const rightValue = reduce(rightOperation, accumulator, element);
          if (
            !leftValue.ok ||
            !rightValue.ok ||
            !canonicalEqual(leftValue.value, rightValue.value)
          )
            return semanticMismatch({
              code: "OUTPUT_SEMANTICS_MISMATCH",
              role: fixture.role,
              boundary: "reducer-output",
              obligation: "pointwise-reducer-equivalence",
              explanation: `Reducer role ${key(fixture.role)} produces different outputs.`,
              left: input.left,
              right: input.right,
              suite,
              fixtureInput: { accumulator, element },
              leftValue: leftValue.ok ? leftValue.value : { failed: true },
              rightValue: rightValue.ok ? rightValue.value : { failed: true },
            });
        }
      continue;
    }
    for (const fixtureInput of fixture.inputs) {
      const leftValue = invoke(leftOperation, fixtureInput);
      const rightValue = invoke(rightOperation, fixtureInput);
      if (
        !leftValue.ok ||
        !rightValue.ok ||
        !canonicalEqual(leftValue.value, rightValue.value)
      ) {
        const code =
          fixture.kind === "fixedPointStep"
            ? "STATE_TRANSITION_MISMATCH"
            : leftValue.ok &&
                rightValue.ok &&
                sameMembersDifferentOrder(leftValue.value, rightValue.value)
              ? "ORDERING_SEMANTICS_MISMATCH"
              : "OUTPUT_SEMANTICS_MISMATCH";
        const boundary =
          code === "STATE_TRANSITION_MISMATCH"
            ? "state-transition-output"
            : code === "ORDERING_SEMANTICS_MISMATCH"
              ? "output-order"
              : "pointwise-output";
        return semanticMismatch({
          code,
          role: fixture.role,
          boundary,
          obligation:
            code === "STATE_TRANSITION_MISMATCH"
              ? "same-state-transition"
              : code === "ORDERING_SEMANTICS_MISMATCH"
                ? "same-output-order"
                : "pointwise-output-equivalence",
          explanation: `Operation role ${key(fixture.role)} produces semantically different results.`,
          left: input.left,
          right: input.right,
          suite,
          fixtureInput,
          leftValue: leftValue.ok ? leftValue.value : { failed: true },
          rightValue: rightValue.ok ? rightValue.value : { failed: true },
        });
      }
    }
  }
  return makeDiagnostic(
    {
      code: "UNRESOLVED_CONFORMANCE_FAILURE",
      outcome: "insufficient-evidence",
      side: "both",
      role: null,
      boundary: "unresolved-conformance-boundary",
      obligation: "complete-diagnostic-evidence",
      explanation:
        "Conformance rejected but the structured diagnostic could not localize a safe cause.",
      action: {
        kind: "no-safe-repair",
        mechanical: false,
        reason:
          "Preserve rejection and collect more evidence; do not substitute or edit semantic metadata.",
      },
      inputDigest: null,
      leftValueDigest: null,
      rightValueDigest: null,
    },
    { ...input, suite },
  );
}

/** Runs unchanged finite conformance and adds a typed fail-closed rejection diagnosis. */
export async function diagnoseCatalogsOffline(
  input: Readonly<{
    left: Catalog;
    right: Catalog;
    suite: unknown;
  }>,
): Promise<Result<CatalogDiagnosticAssessment, Diagnostic>> {
  const suite = catalogConformanceSuiteSchema.safeParse(input.suite);
  if (!suite.success) {
    const diagnosed = await diagnoseRejected(input);
    return diagnosed.ok
      ? { ok: true, value: { kind: "rejected", diagnostic: diagnosed.value } }
      : diagnosed;
  }
  const conformance = await conformCatalogsOffline({
    left: input.left,
    right: input.right,
    suite: suite.data,
  });
  if (conformance.ok)
    return {
      ok: true,
      value: { kind: "conformant", report: conformance.value },
    };
  const diagnosed = await diagnoseRejected(input);
  return diagnosed.ok
    ? { ok: true, value: { kind: "rejected", diagnostic: diagnosed.value } }
    : diagnosed;
}

/** Deterministic one-line rendering for logs and CI annotations. */
export function renderCatalogConformanceDiagnostic(
  value: CatalogConformanceDiagnostic,
): string {
  const role = value.role === null ? "none" : key(value.role);
  return [
    value.code,
    `outcome=${value.outcome}`,
    `side=${value.side}`,
    `role=${role}`,
    `boundary=${value.boundary}`,
    `obligation=${value.obligation}`,
    value.explanation,
    `action=${value.action.kind}`,
    `diagnostic=${value.diagnosticDigest}`,
  ].join(" | ");
}

/** Verifies both semantic diagnostic identity and observation-record identity. */
export async function verifyCatalogConformanceDiagnostic(
  value: unknown,
): Promise<Result<CatalogConformanceDiagnostic, Diagnostic>> {
  const parsed = catalogConformanceDiagnosticSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Catalog conformance diagnostic is invalid.",
      ),
    };
  const { recordDigest, diagnosticDigest, ...bodyWithoutDigests } = parsed.data;
  const identityBody = {
    protocol: "lachesis-catalog-conformance-diagnostic-identity/1" as const,
    code: parsed.data.code,
    outcome: parsed.data.outcome,
    side: parsed.data.side,
    role: roleIdentity(parsed.data.role),
    boundary: parsed.data.boundary,
    obligation: parsed.data.obligation,
    action: parsed.data.action,
    inputDigest: parsed.data.evidence.inputDigest,
    leftValueDigest: parsed.data.evidence.leftValueDigest,
    rightValueDigest: parsed.data.evidence.rightValueDigest,
  };
  const [expectedDiagnostic, expectedRecord] = await Promise.all([
    digestValue(identityBody),
    digestValue({
      ...bodyWithoutDigests,
      diagnosticDigest,
    }),
  ]);
  return expectedDiagnostic.ok &&
    expectedRecord.ok &&
    expectedDiagnostic.value === diagnosticDigest &&
    expectedRecord.value === recordDigest
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: diagnostic(
          "SEMANTIC_OBLIGATION_FAILED",
          "Catalog conformance diagnostic identity is invalid.",
        ),
      };
}
