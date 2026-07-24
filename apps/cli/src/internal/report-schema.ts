import {
  diagnosticCodeSchema,
  semanticRoleReferenceSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const REPORT_PROTOCOL = "lachesis-catalog-command-report/1" as const;
export const REPORT_CANONICALIZATION = "lachesis-canonical-json/1" as const;
export const REPORT_REDACTION_POLICY = "lachesis-report-redaction/1" as const;

export const reportSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const reportIdentitySchema = z
  .strictObject({
    kind: z.enum([
      "catalog",
      "catalog-manifest",
      "conformance-suite",
      "plan",
      "policy",
      "report",
    ]),
    label: z.string().min(1),
    digest: reportSha256Schema,
  })
  .readonly();

const diagnosticLocationSchema = z
  .strictObject({
    nodeId: z.string().min(1).optional(),
    path: z
      .array(z.union([z.string(), z.number()]))
      .readonly()
      .optional(),
  })
  .readonly();

const diagnosticValueSchema = z
  .strictObject({
    schema: z
      .strictObject({ id: z.string().min(1), version: z.string().min(1) })
      .readonly()
      .optional(),
    reference: z
      .strictObject({
        kind: z.enum(["schema", "operation", "catalog", "effectRequest"]),
        id: z.string().min(1),
        version: z.string().min(1).optional(),
      })
      .readonly()
      .optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .readonly();

const compilationDiagnosticSchema = z
  .strictObject({
    code: diagnosticCodeSchema,
    message: z.string().min(1),
    location: diagnosticLocationSchema,
    details: z
      .array(
        z
          .strictObject({
            key: z.string().min(1),
            value: z.union([z.string(), z.number(), z.boolean()]),
          })
          .readonly(),
      )
      .readonly(),
    expected: diagnosticValueSchema.optional(),
    actual: diagnosticValueSchema.optional(),
    limit: z
      .strictObject({
        resource: z.string().min(1),
        limit: z.number(),
        actual: z.number(),
      })
      .readonly()
      .optional(),
    repair: diagnosticLocationSchema.optional(),
  })
  .readonly();

const validationAttemptSchema = z
  .strictObject({
    attemptIdentity: reportSha256Schema,
    subject: reportIdentitySchema,
    result: z.enum(["accepted", "rejected"]),
    diagnostics: z.array(compilationDiagnosticSchema).readonly(),
  })
  .superRefine((attempt, context) => {
    if (
      (attempt.result === "accepted" && attempt.diagnostics.length !== 0) ||
      (attempt.result === "rejected" && attempt.diagnostics.length === 0)
    )
      context.addIssue({
        code: "custom",
        message: "Validation result and diagnostic cardinality disagree.",
      });
  })
  .readonly();

export const catalogDiagnosticOutcomeSchema = z.enum([
  "declaration-repairable",
  "genuinely-non-equivalent",
  "insufficient-evidence",
]);

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

const reviewDeclarationActionSchema = z
  .strictObject({
    kind: z.literal("review-declaration"),
    mechanical: z.literal(false),
    side: z.enum(["left", "right", "both"]),
    operation: z.enum(["add-role", "align-role-version", "align-obligations"]),
    role: semanticRoleReferenceSchema.nullable(),
    patchDescription: z.string().min(1),
    safetyCondition: z.string().min(1),
  })
  .readonly();

const editSuiteActionSchema = z
  .strictObject({
    kind: z.literal("edit-suite"),
    mechanical: z.literal(true),
    operation: z.enum(["add-fixture", "remove-duplicate-fixture"]),
    role: semanticRoleReferenceSchema.nullable(),
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

const diagnosticEvidenceSchema = z
  .strictObject({
    leftCatalogFingerprint: reportSha256Schema,
    rightCatalogFingerprint: reportSha256Schema,
    leftManifestDigest: reportSha256Schema,
    rightManifestDigest: reportSha256Schema,
    fixtureDigest: reportSha256Schema.nullable(),
    inputDigest: reportSha256Schema.nullable(),
    leftValueDigest: reportSha256Schema.nullable(),
    rightValueDigest: reportSha256Schema.nullable(),
  })
  .readonly();

export const catalogConformanceDiagnosticSchema = z
  .strictObject({
    protocol: z.literal("lachesis-catalog-conformance-diagnostic/1"),
    code: catalogDiagnosticCodeSchema,
    outcome: catalogDiagnosticOutcomeSchema,
    side: z.enum(["left", "right", "both", "suite"]),
    role: semanticRoleReferenceSchema.nullable(),
    boundary: z.string().min(1),
    obligation: z.string().min(1),
    explanation: z.string().min(1),
    action: catalogRepairActionSchema,
    evidence: diagnosticEvidenceSchema,
    diagnosticDigest: reportSha256Schema,
    recordDigest: reportSha256Schema,
  })
  .superRefine((value, context) => {
    if (
      value.outcome === "declaration-repairable" &&
      value.action.kind !== "review-declaration"
    )
      context.addIssue({
        code: "custom",
        message:
          "Declaration-repairable diagnostics require conditional declaration review.",
      });
    if (
      value.outcome === "genuinely-non-equivalent" &&
      value.action.kind !== "do-not-substitute"
    )
      context.addIssue({
        code: "custom",
        message:
          "Genuine semantic differences require do-not-substitute guidance.",
      });
    if (
      value.outcome === "insufficient-evidence" &&
      value.action.kind !== "edit-suite" &&
      value.action.kind !== "no-safe-repair"
    )
      context.addIssue({
        code: "custom",
        message:
          "Insufficient evidence may only request suite evidence or preserve rejection.",
      });
  })
  .readonly();

const conformanceRecordSchema = z
  .strictObject({
    recordIdentity: reportSha256Schema,
    comparisonIdentity: reportSha256Schema,
    result: z.enum(["conformant", "rejected"]),
    reportIdentity: reportSha256Schema.nullable(),
    diagnostic: catalogConformanceDiagnosticSchema.nullable(),
  })
  .superRefine((record, context) => {
    if (
      (record.result === "conformant" &&
        (record.reportIdentity === null || record.diagnostic !== null)) ||
      (record.result === "rejected" &&
        (record.reportIdentity !== null || record.diagnostic === null))
    )
      context.addIssue({
        code: "custom",
        message: "Conformance result must preserve its native cardinality.",
      });
  })
  .readonly();

export const controllerDiagnosticCodeSchema = z.enum([
  "INVALID_CATALOG",
  "INVALID_MANIFEST",
  "INVALID_POLICY",
  "INVALID_SUITE",
  "INVALID_REPORT",
  "UNSUPPORTED_PROTOCOL",
  "IDENTITY_MISMATCH",
  "CHECKSUM_MISMATCH",
  "INCOMPLETE_EXECUTION",
  "INTERNAL_CONTROLLER_FAILURE",
]);

const controllerDiagnosticSchema = z
  .strictObject({
    code: controllerDiagnosticCodeSchema,
    message: z.string().min(1),
    location: z
      .strictObject({
        artifactId: z.string().min(1).optional(),
        fieldPath: z.array(z.union([z.string(), z.number()])).readonly(),
      })
      .readonly(),
  })
  .readonly();

export type ControllerDiagnosticCode = z.infer<
  typeof controllerDiagnosticCodeSchema
>;

const migrationGuidanceSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("recompile-and-retain"),
      conditional: z.literal(false),
      autoAccepted: z.literal(false),
      explanation: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("review-required"),
      conditional: z.literal(true),
      autoAccepted: z.literal(false),
      explanation: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("review-declaration"),
      conditional: z.literal(true),
      autoAccepted: z.literal(false),
      explanation: z.string().min(1),
      safetyCondition: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("do-not-substitute"),
      conditional: z.literal(false),
      autoAccepted: z.literal(false),
      explanation: z.string().min(1),
      violatedObligation: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("invalid-or-unverifiable"),
      conditional: z.literal(false),
      autoAccepted: z.literal(false),
      explanation: z.string().min(1),
    })
    .readonly(),
]);

const migrationOutcomeSchema = z
  .strictObject({
    phase: z.enum(["initial", "post-repair"]),
    assessmentIdentity: reportSha256Schema,
    disposition: z.enum([
      "compatible",
      "review-required",
      "declaration-repairable",
      "genuinely-non-equivalent",
      "invalid-or-unverifiable",
    ]),
  })
  .readonly();

const migrationRecordSchema = z
  .strictObject({
    comparisonIdentity: reportSha256Schema,
    category: z.enum([
      "identity-only",
      "declaration-review",
      "declaration-repairable",
      "genuine-non-substitution",
      "invalid-or-unverifiable",
    ]),
    outcomes: z.array(migrationOutcomeSchema).min(1).max(2).readonly(),
    guidance: migrationGuidanceSchema,
  })
  .superRefine((record, context) => {
    const phases = record.outcomes.map((outcome) => outcome.phase);
    const initialDisposition = record.outcomes[0]?.disposition;
    if (phases[0] !== "initial" || new Set(phases).size !== phases.length)
      context.addIssue({
        code: "custom",
        message:
          "Migration outcomes must retain one initial outcome and at most one separate post-repair outcome.",
      });
    const matchesCategory =
      (record.category === "identity-only" &&
        record.guidance.kind === "recompile-and-retain" &&
        initialDisposition === "compatible") ||
      (record.category === "declaration-review" &&
        record.guidance.kind === "review-required" &&
        initialDisposition === "review-required") ||
      (record.category === "declaration-repairable" &&
        record.guidance.kind === "review-declaration" &&
        initialDisposition === "declaration-repairable") ||
      (record.category === "genuine-non-substitution" &&
        record.guidance.kind === "do-not-substitute" &&
        initialDisposition === "genuinely-non-equivalent") ||
      (record.category === "invalid-or-unverifiable" &&
        record.guidance.kind === "invalid-or-unverifiable" &&
        initialDisposition === "invalid-or-unverifiable");
    if (!matchesCategory)
      context.addIssue({
        code: "custom",
        message:
          "Migration category, initial outcome, and guidance do not agree.",
      });
  })
  .readonly();

const artifactSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum([
      "catalog-manifest",
      "conformance-report",
      "diagnostic-record",
      "command-report",
    ]),
    mediaType: z.literal("application/json"),
    digest: reportSha256Schema,
    checksum: z
      .strictObject({
        algorithm: z.literal("sha256"),
        value: reportSha256Schema,
      })
      .readonly(),
  })
  .readonly();

const summarySchema = z
  .strictObject({
    controllerDiagnostics: z.number().int().nonnegative(),
    validationAttempts: z.number().int().nonnegative(),
    validationDiagnostics: z.number().int().nonnegative(),
    conformanceRecords: z.number().int().nonnegative(),
    conformant: z.number().int().nonnegative(),
    declarationRepairable: z.number().int().nonnegative(),
    genuinelyNonEquivalent: z.number().int().nonnegative(),
    insufficientEvidence: z.number().int().nonnegative(),
    migrationRecords: z.number().int().nonnegative(),
  })
  .readonly();

const reportBodyObjectSchema = z
  .strictObject({
    protocol: z.literal(REPORT_PROTOCOL),
    command: z
      .strictObject({
        id: z.enum(["catalog.manifest", "catalog.compare", "report.verify"]),
        version: z.literal("1"),
        commandIdentity: reportSha256Schema,
      })
      .readonly(),
    inputs: z.array(reportIdentitySchema).readonly(),
    status: z.enum([
      "success",
      "review-required",
      "rejected",
      "invalid",
      "incomplete",
      "internal-error",
    ]),
    completeness: z.enum(["complete", "partial"]),
    outcomeExitCode: z.union([
      z.literal(0),
      z.literal(10),
      z.literal(11),
      z.literal(12),
      z.literal(13),
      z.literal(20),
      z.literal(21),
      z.literal(22),
      z.literal(23),
      z.literal(70),
    ]),
    diagnostics: z
      .strictObject({
        controller: z.array(controllerDiagnosticSchema).readonly(),
        validationAttempts: z.array(validationAttemptSchema).readonly(),
        conformance: z.array(conformanceRecordSchema).readonly(),
      })
      .readonly(),
    migrations: z.array(migrationRecordSchema).readonly(),
    summary: summarySchema,
    artifacts: z.array(artifactSchema).readonly(),
    redaction: z
      .strictObject({
        policy: z.literal(REPORT_REDACTION_POLICY),
        applied: z.literal(true),
        omittedFields: z.array(z.string().min(1)).readonly(),
      })
      .readonly(),
    integrity: z
      .strictObject({
        canonicalization: z.literal(REPORT_CANONICALIZATION),
        digestAlgorithm: z.literal("sha256"),
      })
      .readonly(),
  })
  .superRefine((report, context) => {
    const unique = (
      values: ReadonlyArray<string>,
      path: ReadonlyArray<string>,
      label: string,
    ): void => {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          message: `Duplicate ${label} is not permitted.`,
          path: [...path],
        });
    };
    unique(
      report.inputs.map((input) => `${input.kind}:${input.label}`),
      ["inputs"],
      "input identity",
    );
    unique(
      report.diagnostics.validationAttempts.map(
        (attempt) => attempt.attemptIdentity,
      ),
      ["diagnostics", "validationAttempts"],
      "validation attempt identity",
    );
    unique(
      report.diagnostics.conformance.map((record) => record.recordIdentity),
      ["diagnostics", "conformance"],
      "conformance record identity",
    );
    unique(
      report.migrations.map((migration) => migration.comparisonIdentity),
      ["migrations"],
      "migration comparison identity",
    );
    unique(
      report.artifacts.map((artifact) => artifact.id),
      ["artifacts"],
      "artifact identity",
    );
    for (const migration of report.migrations) {
      if (migration.category !== "identity-only") continue;
      const hasConformance = report.diagnostics.conformance.some(
        (record) =>
          record.comparisonIdentity === migration.comparisonIdentity &&
          record.result === "conformant",
      );
      if (!hasConformance)
        context.addIssue({
          code: "custom",
          message:
            "Identity-only compatibility requires an explicit conformant record.",
          path: ["migrations"],
        });
    }
  });

export const commandReportBodySchema = reportBodyObjectSchema.readonly();
export const commandReportSchema = reportBodyObjectSchema
  .safeExtend({ reportDigest: reportSha256Schema })
  .readonly();
export const commandReportInputSchema = z
  .strictObject({
    protocol: reportBodyObjectSchema.shape.protocol,
    command: reportBodyObjectSchema.shape.command,
    inputs: reportBodyObjectSchema.shape.inputs,
    completeness: reportBodyObjectSchema.shape.completeness,
    diagnostics: reportBodyObjectSchema.shape.diagnostics,
    migrations: reportBodyObjectSchema.shape.migrations,
    artifacts: reportBodyObjectSchema.shape.artifacts,
    redaction: reportBodyObjectSchema.shape.redaction,
    integrity: reportBodyObjectSchema.shape.integrity,
  })
  .readonly();

export type CatalogConformanceDiagnostic = z.infer<
  typeof catalogConformanceDiagnosticSchema
>;
export type CommandReport = z.infer<typeof commandReportSchema>;
export type CommandReportBody = z.infer<typeof commandReportBodySchema>;
export type CommandReportInput = z.infer<typeof commandReportInputSchema>;
export type CommandReportStatus = CommandReportBody["status"];
export type ReportExitCode = CommandReportBody["outcomeExitCode"];
