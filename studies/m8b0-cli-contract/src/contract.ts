import {
  canonicalizeJson,
  diagnosticCodeSchema,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  catalogConformanceDiagnosticSchema,
  verifyCatalogConformanceDiagnostic,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

function isJsonValue(value: unknown): value is JsonValue {
  return canonicalizeJson(value).ok;
}

/**
 * Takes a plain-data snapshot of output produced directly by Zod's JSON Schema
 * generator. Structured cloning removes Zod's non-enumerable runtime metadata
 * without invoking `toJSON`; strict canonical validation then rejects any
 * unexpected enumerable non-JSON value. This is not a general input sanitizer.
 */
export function snapshotZodJsonSchema(
  schema: z.ZodType,
  target?: "draft-2020-12",
): JsonValue {
  const generated =
    target === undefined
      ? z.toJSONSchema(schema)
      : z.toJSONSchema(schema, { target });
  const snapshot: unknown = structuredClone(generated);
  if (!isJsonValue(snapshot)) {
    throw new Error("Zod generated a non-JSON schema snapshot.");
  }
  return snapshot;
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z
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
    digest: sha256Schema,
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

const kernelDiagnosticSchema = z
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
    attemptIdentity: sha256Schema,
    subject: identitySchema,
    result: z.enum(["accepted", "rejected"]),
    diagnostics: z.array(kernelDiagnosticSchema).readonly(),
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

const conformanceRecordSchema = z
  .strictObject({
    recordIdentity: sha256Schema,
    comparisonIdentity: sha256Schema,
    result: z.enum(["conformant", "rejected"]),
    reportIdentity: sha256Schema.nullable(),
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

const controllerDiagnosticSchema = z
  .strictObject({
    code: z.enum([
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
    ]),
    message: z.string().min(1),
    location: z
      .strictObject({
        artifactId: z.string().min(1).optional(),
        fieldPath: z.array(z.union([z.string(), z.number()])).readonly(),
      })
      .readonly(),
  })
  .readonly();

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
    assessmentIdentity: sha256Schema,
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
    comparisonIdentity: sha256Schema,
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
    if (phases[0] !== "initial" || new Set(phases).size !== phases.length)
      context.addIssue({
        code: "custom",
        message:
          "Migration outcomes must retain one initial outcome and at most one separate post-repair outcome.",
      });
    if (
      record.category === "genuine-non-substitution" &&
      record.guidance.kind !== "do-not-substitute"
    )
      context.addIssue({
        code: "custom",
        message:
          "Genuine semantic differences require do-not-substitute guidance.",
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
    digest: sha256Schema,
    checksum: z
      .strictObject({
        algorithm: z.literal("sha256"),
        value: sha256Schema,
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

const reportBodyObjectSchema = z.strictObject({
  protocol: z.literal("lachesis-catalog-command-report/1"),
  command: z
    .strictObject({
      id: z.enum(["catalog.manifest", "catalog.compare", "report.verify"]),
      version: z.literal("1"),
      commandIdentity: sha256Schema,
    })
    .readonly(),
  inputs: z.array(identitySchema).readonly(),
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
      policy: z.literal("lachesis-report-redaction/1"),
      applied: z.literal(true),
      omittedFields: z.array(z.string().min(1)).readonly(),
    })
    .readonly(),
  integrity: z
    .strictObject({
      canonicalization: z.literal("lachesis-canonical-json/1"),
      digestAlgorithm: z.literal("sha256"),
    })
    .readonly(),
});
const reportBodySchema = reportBodyObjectSchema.readonly();

export const commandReportSchema = reportBodyObjectSchema
  .extend({ reportDigest: sha256Schema })
  .readonly();
export type CommandReport = z.infer<typeof commandReportSchema>;
export type CommandReportBody = z.infer<typeof reportBodySchema>;
export type CommandReportInput = Omit<
  CommandReportBody,
  "outcomeExitCode" | "summary"
>;

type ContractFailure = Readonly<{
  code: "INVALID_REPORT" | "SUMMARY_MISMATCH" | "REPORT_DIGEST_MISMATCH";
  message: string;
}>;

function derivedSummary(
  report: Pick<CommandReportBody, "diagnostics" | "migrations">,
): CommandReportBody["summary"] {
  const conformanceDiagnostics = report.diagnostics.conformance.flatMap(
    (record) => (record.diagnostic === null ? [] : [record.diagnostic]),
  );
  return {
    controllerDiagnostics: report.diagnostics.controller.length,
    validationAttempts: report.diagnostics.validationAttempts.length,
    validationDiagnostics: report.diagnostics.validationAttempts.reduce(
      (count, attempt) => count + attempt.diagnostics.length,
      0,
    ),
    conformanceRecords: report.diagnostics.conformance.length,
    conformant: report.diagnostics.conformance.filter(
      (record) => record.result === "conformant",
    ).length,
    declarationRepairable: conformanceDiagnostics.filter(
      (diagnostic) => diagnostic.outcome === "declaration-repairable",
    ).length,
    genuinelyNonEquivalent: conformanceDiagnostics.filter(
      (diagnostic) => diagnostic.outcome === "genuinely-non-equivalent",
    ).length,
    insufficientEvidence: conformanceDiagnostics.filter(
      (diagnostic) => diagnostic.outcome === "insufficient-evidence",
    ).length,
    migrationRecords: report.migrations.length,
  };
}

export function deriveOutcomeExitCode(
  report: Pick<
    CommandReportBody,
    "command" | "completeness" | "diagnostics" | "status"
  >,
): CommandReportBody["outcomeExitCode"] {
  const controllerCodes = report.diagnostics.controller.map(
    (diagnostic) => diagnostic.code,
  );
  if (
    report.status === "internal-error" ||
    controllerCodes.includes("INTERNAL_CONTROLLER_FAILURE")
  )
    return 70;
  if (report.completeness === "partial" || report.status === "incomplete")
    return 23;
  if (
    controllerCodes.includes("IDENTITY_MISMATCH") ||
    controllerCodes.includes("CHECKSUM_MISMATCH")
  )
    return 22;
  if (report.status === "invalid") return 20;
  const outcomes = report.diagnostics.conformance.flatMap((record) =>
    record.diagnostic === null ? [] : [record.diagnostic.outcome],
  );
  if (outcomes.includes("genuinely-non-equivalent")) return 12;
  if (outcomes.includes("insufficient-evidence")) return 13;
  if (outcomes.includes("declaration-repairable")) return 11;
  if (
    report.diagnostics.validationAttempts.some(
      (attempt) => attempt.result === "rejected",
    )
  )
    return 21;
  if (report.status === "review-required") return 10;
  return 0;
}

export async function createCommandReport(
  input: CommandReportInput,
): Promise<Result<CommandReport, ContractFailure>> {
  const body = reportBodySchema.safeParse({
    ...input,
    outcomeExitCode: deriveOutcomeExitCode(input),
    summary: derivedSummary(input),
  });
  if (!body.success)
    return {
      ok: false,
      error: { code: "INVALID_REPORT", message: body.error.message },
    };
  const digest = await digestValue(body.data);
  if (!digest.ok)
    return {
      ok: false,
      error: { code: "INVALID_REPORT", message: digest.error.message },
    };
  return commandReportSchema.safeParse({
    ...body.data,
    reportDigest: digest.value,
  }).success
    ? {
        ok: true,
        value: commandReportSchema.parse({
          ...body.data,
          reportDigest: digest.value,
        }),
      }
    : {
        ok: false,
        error: {
          code: "INVALID_REPORT",
          message: "Generated command report failed its schema.",
        },
      };
}

export async function verifyCommandReport(
  value: unknown,
): Promise<Result<CommandReport, ContractFailure>> {
  const parsed = commandReportSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: { code: "INVALID_REPORT", message: parsed.error.message },
    };
  const { reportDigest, ...body } = parsed.data;
  const actualSummary = canonicalizeJson(body.summary);
  const expectedSummary = canonicalizeJson(derivedSummary(body));
  if (
    !actualSummary.ok ||
    !expectedSummary.ok ||
    actualSummary.value !== expectedSummary.value
  )
    return {
      ok: false,
      error: {
        code: "SUMMARY_MISMATCH",
        message: "Summary does not derive from the detailed records.",
      },
    };
  if (body.outcomeExitCode !== deriveOutcomeExitCode(body))
    return {
      ok: false,
      error: {
        code: "INVALID_REPORT",
        message: "Exit code does not derive from the detailed outcome.",
      },
    };
  for (const record of body.diagnostics.conformance) {
    if (record.diagnostic === null) continue;
    const nested = await verifyCatalogConformanceDiagnostic(record.diagnostic);
    if (!nested.ok)
      return {
        ok: false,
        error: {
          code: "REPORT_DIGEST_MISMATCH",
          message: `Nested conformance diagnostic ${record.recordIdentity} failed identity verification.`,
        },
      };
  }
  const digest = await digestValue(body);
  if (!digest.ok || digest.value !== reportDigest)
    return {
      ok: false,
      error: {
        code: "REPORT_DIGEST_MISMATCH",
        message: "Report identity does not match its canonical body.",
      },
    };
  return { ok: true, value: parsed.data };
}

export function serializeCommandReport(
  report: CommandReport,
): Result<string, ContractFailure> {
  const canonical = canonicalizeJson(report);
  return canonical.ok
    ? { ok: true, value: `${canonical.value}\n` }
    : {
        ok: false,
        error: { code: "INVALID_REPORT", message: canonical.error.message },
      };
}

export function renderMigrationGuidance(report: CommandReport): string {
  const lines = [
    `Lachesis catalog report: ${report.status} (exit ${report.outcomeExitCode})`,
  ];
  for (const migration of report.migrations) {
    switch (migration.guidance.kind) {
      case "recompile-and-retain":
        lines.push(
          `IDENTITY-ONLY ${migration.comparisonIdentity}: ${migration.guidance.explanation}`,
        );
        break;
      case "review-required":
        lines.push(
          `REVIEW REQUIRED ${migration.comparisonIdentity}: ${migration.guidance.explanation} Not accepted automatically.`,
        );
        break;
      case "review-declaration":
        lines.push(
          `CONDITIONAL DECLARATION REPAIR ${migration.comparisonIdentity}: ${migration.guidance.explanation} Safety condition: ${migration.guidance.safetyCondition} Not accepted automatically.`,
        );
        break;
      case "do-not-substitute":
        lines.push(
          `DO NOT SUBSTITUTE ${migration.comparisonIdentity}: ${migration.guidance.explanation} Violated obligation: ${migration.guidance.violatedObligation}.`,
        );
        break;
      case "invalid-or-unverifiable":
        lines.push(
          `INVALID OR UNVERIFIABLE ${migration.comparisonIdentity}: ${migration.guidance.explanation}`,
        );
        break;
    }
  }
  return `${lines.join("\n")}\n`;
}
