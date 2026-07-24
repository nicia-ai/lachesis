import { digestValue, parseJson, type Result } from "@nicia-ai/lachesis";

import {
  canonicalizeReportValue,
  type ReportContractFailure,
  serializeCanonicalReport,
  validateReportPlainData,
} from "./report-canonical.js";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
  type CommandReport,
  type CommandReportBody,
  commandReportBodySchema,
  type CommandReportInput,
  commandReportInputSchema,
  commandReportSchema,
  type CommandReportStatus,
  type ReportExitCode,
} from "./report-schema.js";

const invalidControllerCodes = new Set([
  "INVALID_CATALOG",
  "INVALID_MANIFEST",
  "INVALID_POLICY",
  "INVALID_SUITE",
  "INVALID_REPORT",
  "UNSUPPORTED_PROTOCOL",
]);

const integrityControllerCodes = new Set([
  "IDENTITY_MISMATCH",
  "CHECKSUM_MISMATCH",
]);

const forbiddenReportTextPatterns = [
  /(?:^|[\s"'=])\/(?:Users|home|private|tmp|var|etc)\//u,
  /(?:^|[\s"'=])[A-Za-z]:\\/u,
  /\b[A-Z][A-Z0-9_]{2,}=.+/u,
] as const;

export type ArtifactBinding = Readonly<{
  id: string;
  bytes: Uint8Array;
}>;

function contractFailure(
  code: ReportContractFailure["code"],
  message: string,
): Result<never, ReportContractFailure> {
  return { ok: false, error: { code, message } };
}

function canonicalKey(value: unknown): string {
  const canonical = canonicalizeReportValue(value);
  if (!canonical.ok)
    throw new TypeError(
      `Validated report value became non-canonical: ${canonical.error.message}`,
    );
  return canonical.value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonical(left: unknown, right: unknown): number {
  return compareText(canonicalKey(left), canonicalKey(right));
}

function normalizeBodyArrays(body: CommandReportBody): CommandReportBody {
  return {
    ...body,
    inputs: body.inputs.toSorted(compareCanonical),
    diagnostics: {
      controller: body.diagnostics.controller.toSorted(compareCanonical),
      validationAttempts: body.diagnostics.validationAttempts
        .map((attempt) => ({
          ...attempt,
          diagnostics: attempt.diagnostics.toSorted(compareCanonical),
        }))
        .toSorted((left, right) =>
          compareText(left.attemptIdentity, right.attemptIdentity),
        ),
      conformance: body.diagnostics.conformance.toSorted((left, right) => {
        const comparison = compareText(
          left.comparisonIdentity,
          right.comparisonIdentity,
        );
        return comparison === 0
          ? compareText(left.recordIdentity, right.recordIdentity)
          : comparison;
      }),
    },
    migrations: body.migrations
      .map((migration) => ({
        ...migration,
        outcomes: migration.outcomes.toSorted((left, right) =>
          left.phase === right.phase ? 0 : left.phase === "initial" ? -1 : 1,
        ),
      }))
      .toSorted((left, right) =>
        compareText(left.comparisonIdentity, right.comparisonIdentity),
      ),
    artifacts: body.artifacts.toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
    redaction: {
      ...body.redaction,
      omittedFields: body.redaction.omittedFields.toSorted((left, right) =>
        compareText(left, right),
      ),
    },
  };
}

function walkReportStrings(
  value: unknown,
  visit: (text: string) => boolean,
): boolean {
  if (typeof value === "string") return visit(value);
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value))
    return value.every((item) => walkReportStrings(item, visit));
  return Object.values(value).every((item) => walkReportStrings(item, visit));
}

function validateReportText(
  value: unknown,
): Result<true, ReportContractFailure> {
  const safe = walkReportStrings(value, (text) => {
    const hasControl = Array.from(text).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))
      );
    });
    return (
      !hasControl &&
      forbiddenReportTextPatterns.every((pattern) => !pattern.test(text))
    );
  });
  return safe
    ? { ok: true, value: true }
    : contractFailure(
        "INVALID_REPORT",
        "Report text contains a control sequence, ambient path, or environment-shaped value.",
      );
}

export function deriveReportSummary(
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

function hasControllerCode(
  report: Pick<CommandReportBody, "diagnostics">,
  codes: ReadonlySet<string>,
): boolean {
  return report.diagnostics.controller.some((diagnostic) =>
    codes.has(diagnostic.code),
  );
}

export function deriveReportExitCode(
  report: Pick<
    CommandReportBody,
    "completeness" | "diagnostics" | "migrations"
  >,
): ReportExitCode {
  if (
    report.diagnostics.controller.some(
      (diagnostic) => diagnostic.code === "INTERNAL_CONTROLLER_FAILURE",
    )
  )
    return 70;
  if (
    report.completeness === "partial" ||
    report.diagnostics.controller.some(
      (diagnostic) => diagnostic.code === "INCOMPLETE_EXECUTION",
    )
  )
    return 23;
  if (hasControllerCode(report, integrityControllerCodes)) return 22;
  if (hasControllerCode(report, invalidControllerCodes)) return 20;

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
  if (
    report.migrations.some(
      (migration) => migration.category === "declaration-review",
    )
  )
    return 10;
  return 0;
}

export function deriveReportStatus(
  report: Pick<
    CommandReportBody,
    "completeness" | "diagnostics" | "migrations"
  >,
): CommandReportStatus {
  const exitCode = deriveReportExitCode(report);
  switch (exitCode) {
    case 70:
      return "internal-error";
    case 23:
      return "incomplete";
    case 22:
    case 20:
      return "invalid";
    case 10:
      return "review-required";
    case 12:
    case 13:
    case 11:
    case 21:
      return "rejected";
    case 0:
      return "success";
  }
}

async function verifyConformanceDiagnosticIdentity(
  value: CatalogConformanceDiagnostic,
): Promise<Result<true, ReportContractFailure>> {
  const parsed = catalogConformanceDiagnosticSchema.safeParse(value);
  if (!parsed.success)
    return contractFailure(
      "NESTED_IDENTITY_MISMATCH",
      "Catalog conformance diagnostic is invalid.",
    );
  const { recordDigest, diagnosticDigest, ...bodyWithoutDigests } = parsed.data;
  const role =
    parsed.data.role === null
      ? null
      : { id: parsed.data.role.id, version: parsed.data.role.version };
  const [expectedDiagnostic, expectedRecord] = await Promise.all([
    digestValue({
      protocol: "lachesis-catalog-conformance-diagnostic-identity/1",
      code: parsed.data.code,
      outcome: parsed.data.outcome,
      side: parsed.data.side,
      role,
      boundary: parsed.data.boundary,
      obligation: parsed.data.obligation,
      action: parsed.data.action,
      inputDigest: parsed.data.evidence.inputDigest,
      leftValueDigest: parsed.data.evidence.leftValueDigest,
      rightValueDigest: parsed.data.evidence.rightValueDigest,
    }),
    digestValue({ ...bodyWithoutDigests, diagnosticDigest }),
  ]);
  return expectedDiagnostic.ok &&
    expectedRecord.ok &&
    expectedDiagnostic.value === diagnosticDigest &&
    expectedRecord.value === recordDigest
    ? { ok: true, value: true }
    : contractFailure(
        "NESTED_IDENTITY_MISMATCH",
        "Catalog conformance diagnostic identity is invalid.",
      );
}

function verifyMigrationEvidence(
  body: CommandReportBody,
): Result<true, ReportContractFailure> {
  for (const migration of body.migrations) {
    const related = body.diagnostics.conformance.filter(
      (record) =>
        record.comparisonIdentity === migration.comparisonIdentity &&
        record.diagnostic !== null,
    );
    if (
      migration.category === "declaration-repairable" &&
      !related.some(
        (record) => record.diagnostic?.outcome === "declaration-repairable",
      )
    )
      return contractFailure(
        "INVALID_REPORT",
        "Declaration-repairable migration lacks its detailed rejection.",
      );
    if (
      migration.category === "genuine-non-substitution" &&
      !related.some(
        (record) => record.diagnostic?.outcome === "genuinely-non-equivalent",
      )
    )
      return contractFailure(
        "INVALID_REPORT",
        "Genuine non-substitution migration lacks its detailed rejection.",
      );
  }
  return { ok: true, value: true };
}

function verifyExplicitNestedReferences(
  body: CommandReportBody,
): Result<true, ReportContractFailure> {
  for (const record of body.diagnostics.conformance) {
    if (record.result === "rejected") {
      if (record.diagnostic?.recordDigest !== record.recordIdentity)
        return contractFailure(
          "NESTED_IDENTITY_MISMATCH",
          "Rejected conformance record does not bind its diagnostic identity.",
        );
      continue;
    }
    const referenced = body.artifacts.some(
      (artifact) =>
        artifact.kind === "conformance-report" &&
        artifact.digest === record.reportIdentity,
    );
    if (!referenced)
      return contractFailure(
        "NESTED_IDENTITY_MISMATCH",
        "Conformant record does not explicitly reference its report artifact.",
      );
  }
  return { ok: true, value: true };
}

function parseAndNormalizeInput(
  value: unknown,
): Result<CommandReportInput, ReportContractFailure> {
  const plain = validateReportPlainData(value);
  if (!plain.ok) return plain;
  const text = validateReportText(value);
  if (!text.ok) return text;
  const parsed = commandReportInputSchema.safeParse(value);
  if (!parsed.success)
    return contractFailure("INVALID_REPORT", parsed.error.message);
  const provisionalBody = commandReportBodySchema.parse({
    ...parsed.data,
    status: "success",
    outcomeExitCode: 0,
    summary: deriveReportSummary(parsed.data),
  });
  const normalized = normalizeBodyArrays(provisionalBody);
  const normalizedInput = {
    protocol: normalized.protocol,
    command: normalized.command,
    inputs: normalized.inputs,
    completeness: normalized.completeness,
    diagnostics: normalized.diagnostics,
    migrations: normalized.migrations,
    artifacts: normalized.artifacts,
    redaction: normalized.redaction,
    integrity: normalized.integrity,
  };
  const reparsed = commandReportInputSchema.safeParse(normalizedInput);
  return reparsed.success
    ? { ok: true, value: reparsed.data }
    : contractFailure(
        "INVALID_REPORT",
        "Normalized command report input failed validation.",
      );
}

export async function createCommandReport(
  value: unknown,
): Promise<Result<CommandReport, ReportContractFailure>> {
  const input = parseAndNormalizeInput(value);
  if (!input.ok) return input;
  const bodyCandidate = {
    ...input.value,
    status: deriveReportStatus(input.value),
    outcomeExitCode: deriveReportExitCode(input.value),
    summary: deriveReportSummary(input.value),
  };
  const body = commandReportBodySchema.safeParse(bodyCandidate);
  if (!body.success)
    return contractFailure("INVALID_REPORT", body.error.message);
  const migrationEvidence = verifyMigrationEvidence(body.data);
  if (!migrationEvidence.ok) return migrationEvidence;
  const references = verifyExplicitNestedReferences(body.data);
  if (!references.ok) return references;
  for (const record of body.data.diagnostics.conformance) {
    if (record.diagnostic === null) continue;
    const nested = await verifyConformanceDiagnosticIdentity(record.diagnostic);
    if (!nested.ok) return nested;
  }
  const digest = await digestValue(body.data);
  if (!digest.ok)
    return contractFailure("INVALID_REPORT", digest.error.message);
  const report = commandReportSchema.safeParse({
    ...body.data,
    reportDigest: digest.value,
  });
  return report.success
    ? { ok: true, value: report.data }
    : contractFailure("INVALID_REPORT", report.error.message);
}

export async function verifyCommandReport(
  value: unknown,
): Promise<Result<CommandReport, ReportContractFailure>> {
  const plain = validateReportPlainData(value);
  if (!plain.ok) return plain;
  const text = validateReportText(value);
  if (!text.ok) return text;
  const parsed = commandReportSchema.safeParse(value);
  if (!parsed.success)
    return contractFailure("INVALID_REPORT", parsed.error.message);
  const { reportDigest, ...body } = parsed.data;
  const normalized = normalizeBodyArrays(body);
  const [actualOrder, expectedOrder] = [
    canonicalizeReportValue(body),
    canonicalizeReportValue(normalized),
  ];
  if (
    !actualOrder.ok ||
    !expectedOrder.ok ||
    actualOrder.value !== expectedOrder.value
  )
    return contractFailure(
      "SEMANTIC_ORDER_MISMATCH",
      "Detailed records are not in protocol semantic order.",
    );

  const actualSummary = canonicalizeReportValue(body.summary);
  const expectedSummary = canonicalizeReportValue(deriveReportSummary(body));
  if (
    !actualSummary.ok ||
    !expectedSummary.ok ||
    actualSummary.value !== expectedSummary.value
  )
    return contractFailure(
      "SUMMARY_MISMATCH",
      "Summary does not derive from the detailed records.",
    );
  if (body.status !== deriveReportStatus(body))
    return contractFailure(
      "STATUS_MISMATCH",
      "Status does not derive from the detailed outcome.",
    );
  if (body.outcomeExitCode !== deriveReportExitCode(body))
    return contractFailure(
      "EXIT_CODE_MISMATCH",
      "Exit code does not derive from the detailed outcome.",
    );
  const migrationEvidence = verifyMigrationEvidence(body);
  if (!migrationEvidence.ok) return migrationEvidence;
  const references = verifyExplicitNestedReferences(body);
  if (!references.ok) return references;
  for (const record of body.diagnostics.conformance) {
    if (record.diagnostic === null) continue;
    const nested = await verifyConformanceDiagnosticIdentity(record.diagnostic);
    if (!nested.ok) return nested;
  }
  const digest = await digestValue(body);
  if (!digest.ok || digest.value !== reportDigest)
    return contractFailure(
      "REPORT_DIGEST_MISMATCH",
      "Report identity does not match its canonical body.",
    );
  return { ok: true, value: parsed.data };
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyReportArtifactBindings(
  report: CommandReport,
  bindings: ReadonlyArray<ArtifactBinding>,
): Promise<Result<true, ReportContractFailure>> {
  const byId = new Map(bindings.map((binding) => [binding.id, binding]));
  if (byId.size !== bindings.length || byId.size !== report.artifacts.length)
    return contractFailure(
      "ARTIFACT_BINDING_MISMATCH",
      "Artifact bindings are missing, duplicated, or unexpected.",
    );
  for (const artifact of report.artifacts) {
    const binding = byId.get(artifact.id);
    if (binding === undefined)
      return contractFailure(
        "ARTIFACT_BINDING_MISMATCH",
        `Artifact ${artifact.id} is not bound.`,
      );
    const bytes = binding.bytes.slice();
    const checksum = await sha256Bytes(bytes);
    if (checksum !== artifact.checksum.value)
      return contractFailure(
        "ARTIFACT_BINDING_MISMATCH",
        `Artifact ${artifact.id} checksum does not match.`,
      );
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return contractFailure(
        "ARTIFACT_BINDING_MISMATCH",
        `Artifact ${artifact.id} is not UTF-8 JSON.`,
      );
    }
    const parsed = parseJson(decoded);
    if (!parsed.ok)
      return contractFailure(
        "ARTIFACT_BINDING_MISMATCH",
        `Artifact ${artifact.id} is not valid JSON.`,
      );
    const digest = await digestValue(parsed.value);
    if (!digest.ok || digest.value !== artifact.digest)
      return contractFailure(
        "ARTIFACT_BINDING_MISMATCH",
        `Artifact ${artifact.id} semantic digest does not match.`,
      );
  }
  return { ok: true, value: true };
}

export function serializeCommandReport(
  report: CommandReport,
): Result<string, ReportContractFailure> {
  return serializeCanonicalReport(report);
}
