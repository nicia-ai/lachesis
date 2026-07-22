import {
  type CatalogConformanceSuite,
  catalogConformanceSuiteSchema,
  type CatalogDiagnosticCode,
  type CatalogDiagnosticOutcome,
} from "@nicia-ai/lachesis-generator";

import { createDiagnosticCatalog, type DiagnosticVariant } from "./catalogs.js";

export const diagnosticSuite: CatalogConformanceSuite =
  catalogConformanceSuiteSchema.parse({
    protocol: "lachesis-cross-catalog-conformance-suite/1",
    fixtures: [
      {
        kind: "schema",
        role: { id: "m7b.dev.role/number", version: "1" },
        values: [0, 1, 2, 5, 10],
      },
      {
        kind: "schema",
        role: { id: "m7b.dev.role/numbers", version: "1" },
        values: [[], [1], [1, 2, 3], [3, 2, 1]],
      },
      {
        kind: "function",
        role: { id: "m7b.dev.role/transform", version: "1" },
        inputs: [0, 1, 2, 5],
      },
      {
        kind: "function",
        role: { id: "m7b.dev.role/preserve-order", version: "1" },
        inputs: [[], [1], [1, 2, 3]],
      },
      {
        kind: "reducer",
        role: { id: "m7b.dev.role/peak", version: "1" },
        values: [0, 1, 2, 5, 10],
      },
      {
        kind: "fixedPointStep",
        role: { id: "m7b.dev.role/step", version: "1" },
        inputs: [0, 1, 2, 5],
      },
      { kind: "effect", role: { id: "m7b.dev.role/observe", version: "1" } },
    ],
  });

export type DiagnosticCase = Readonly<{
  caseId: string;
  variant: DiagnosticVariant;
  suite: CatalogConformanceSuite;
  expectedOutcome: CatalogDiagnosticOutcome;
  expectedCode: CatalogDiagnosticCode;
  expectedRoleId: string | null;
  expectedBoundary: string;
}>;

const definitions: ReadonlyArray<Omit<DiagnosticCase, "suite">> = [
  {
    caseId: "m7b-dev-01-missing-declarations",
    variant: "missing-declarations",
    expectedOutcome: "declaration-repairable",
    expectedCode: "MISSING_ROLE_DECLARATION",
    expectedRoleId: "m7b.dev.role/number",
    expectedBoundary: "catalog-semantic-role-declarations",
  },
  {
    caseId: "m7b-dev-02-role-version",
    variant: "role-version",
    expectedOutcome: "declaration-repairable",
    expectedCode: "ROLE_VERSION_MISMATCH",
    expectedRoleId: "m7b.dev.role/number",
    expectedBoundary: "role-version:m7b.dev.role/number",
  },
  {
    caseId: "m7b-dev-03-incomplete-evidence",
    variant: "baseline-b",
    expectedOutcome: "insufficient-evidence",
    expectedCode: "INCOMPLETE_FIXTURE_EVIDENCE",
    expectedRoleId: "m7b.dev.role/observe",
    expectedBoundary: "missing-fixture:m7b.dev.role/observe@1",
  },
  {
    caseId: "m7b-dev-04-obligations",
    variant: "incompatible-obligations",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "INCOMPATIBLE_OBLIGATIONS",
    expectedRoleId: "m7b.dev.role/peak",
    expectedBoundary: "reducer-identity-and-laws",
  },
  {
    caseId: "m7b-dev-05-capability",
    variant: "capability",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "CAPABILITY_MISMATCH",
    expectedRoleId: "m7b.dev.role/observe",
    expectedBoundary: "effect-capability",
  },
  {
    caseId: "m7b-dev-06-effect",
    variant: "effect-contract",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "EFFECT_CONTRACT_MISMATCH",
    expectedRoleId: "m7b.dev.role/observe",
    expectedBoundary: "effect-contract",
  },
  {
    caseId: "m7b-dev-07-ordering",
    variant: "ordering",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "ORDERING_SEMANTICS_MISMATCH",
    expectedRoleId: "m7b.dev.role/preserve-order",
    expectedBoundary: "output-order",
  },
  {
    caseId: "m7b-dev-08-state-transition",
    variant: "state-transition",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "STATE_TRANSITION_MISMATCH",
    expectedRoleId: "m7b.dev.role/step",
    expectedBoundary: "state-transition-output",
  },
  {
    caseId: "m7b-dev-09-output",
    variant: "output-semantics",
    expectedOutcome: "genuinely-non-equivalent",
    expectedCode: "OUTPUT_SEMANTICS_MISMATCH",
    expectedRoleId: "m7b.dev.role/transform",
    expectedBoundary: "pointwise-output",
  },
];

export function loadM7bDevelopmentCorpus(): ReadonlyArray<DiagnosticCase> {
  return definitions.map((definition) => ({
    ...definition,
    suite:
      definition.caseId === "m7b-dev-03-incomplete-evidence"
        ? {
            protocol: "lachesis-cross-catalog-conformance-suite/1",
            fixtures: diagnosticSuite.fixtures.slice(0, -1),
          }
        : diagnosticSuite,
  }));
}

export function catalogsFor(diagnosticCase: DiagnosticCase): Readonly<{
  left: ReturnType<typeof createDiagnosticCatalog>;
  right: ReturnType<typeof createDiagnosticCatalog>;
}> {
  return {
    left: createDiagnosticCatalog("baseline-a"),
    right: createDiagnosticCatalog(diagnosticCase.variant),
  };
}
