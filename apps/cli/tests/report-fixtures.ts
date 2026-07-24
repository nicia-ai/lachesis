import { digestValue } from "@nicia-ai/lachesis";

import {
  type ArtifactBinding,
  createCommandReport,
} from "../src/internal/report-contract.js";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
  type CommandReport,
  type CommandReportInput,
  type ReportExitCode,
} from "../src/internal/report-schema.js";

type Fixture = Readonly<{
  report: CommandReport;
  artifacts: ReadonlyArray<ArtifactBinding>;
}>;

async function identity(label: string): Promise<string> {
  const result = await digestValue({
    protocol: "lachesis-m8b1-report-fixture/1",
    label,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function rawSha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function diagnostic(
  outcome:
    | "declaration-repairable"
    | "genuinely-non-equivalent"
    | "insufficient-evidence",
): Promise<CatalogConformanceDiagnostic> {
  const shared = {
    protocol: "lachesis-catalog-conformance-diagnostic/1" as const,
    side: "both" as const,
    role: { id: "harbor.role/route-shipment", version: "1" },
    evidence: {
      leftCatalogFingerprint: await identity(`${outcome}:left-catalog`),
      rightCatalogFingerprint: await identity(`${outcome}:right-catalog`),
      leftManifestDigest: await identity(`${outcome}:left-manifest`),
      rightManifestDigest: await identity(`${outcome}:right-manifest`),
      fixtureDigest: await identity(`${outcome}:fixture`),
      inputDigest: null,
      leftValueDigest: null,
      rightValueDigest: null,
    },
  };
  const body =
    outcome === "declaration-repairable"
      ? {
          ...shared,
          code: "ROLE_VERSION_MISMATCH" as const,
          outcome,
          boundary: "role-version:harbor.role/route-shipment",
          obligation: "exact-role-version",
          explanation:
            "The declarations name different versions of the route-shipment role.",
          action: {
            kind: "review-declaration" as const,
            mechanical: false as const,
            side: "both" as const,
            operation: "align-role-version" as const,
            role: { id: "harbor.role/route-shipment", version: "1" },
            patchDescription:
              "Review which written role version each operation implements.",
            safetyCondition:
              "If the versions intentionally differ, preserve rejection and do not substitute.",
          },
        }
      : outcome === "genuinely-non-equivalent"
        ? {
            ...shared,
            code: "CAPABILITY_MISMATCH" as const,
            outcome,
            boundary: "effect-capability",
            obligation: "same-capability",
            explanation:
              "The operations require different effect capabilities.",
            action: {
              kind: "do-not-substitute" as const,
              mechanical: false as const,
              violatedObligation: "same-capability",
              reason:
                "Metadata changes cannot manufacture capability equivalence.",
            },
          }
        : {
            ...shared,
            code: "UNRESOLVED_CONFORMANCE_FAILURE" as const,
            outcome,
            boundary: "unresolved-conformance-boundary",
            obligation: "complete-diagnostic-evidence",
            explanation:
              "The supplied fixtures cannot localize a safe equivalence decision.",
            action: {
              kind: "no-safe-repair" as const,
              mechanical: false as const,
              reason:
                "Preserve rejection and collect independent fixture evidence.",
            },
          };
  const diagnosticDigest = await digestValue({
    protocol: "lachesis-catalog-conformance-diagnostic-identity/1",
    code: body.code,
    outcome: body.outcome,
    side: body.side,
    role: body.role,
    boundary: body.boundary,
    obligation: body.obligation,
    action: body.action,
    inputDigest: body.evidence.inputDigest,
    leftValueDigest: body.evidence.leftValueDigest,
    rightValueDigest: body.evidence.rightValueDigest,
  });
  if (!diagnosticDigest.ok) throw new Error(diagnosticDigest.error.message);
  const recordDigest = await digestValue({
    ...body,
    diagnosticDigest: diagnosticDigest.value,
  });
  if (!recordDigest.ok) throw new Error(recordDigest.error.message);
  return catalogConformanceDiagnosticSchema.parse({
    ...body,
    diagnosticDigest: diagnosticDigest.value,
    recordDigest: recordDigest.value,
  });
}

async function base(
  commandId: CommandReportInput["command"]["id"] = "catalog.compare",
): Promise<CommandReportInput> {
  return {
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id: commandId,
      version: "1",
      commandIdentity: await identity(`command:${commandId}`),
    },
    inputs: [
      {
        kind: "catalog",
        label: "left",
        digest: await identity("catalog:left"),
      },
      {
        kind: "catalog",
        label: "right",
        digest: await identity("catalog:right"),
      },
    ],
    completeness: "complete",
    diagnostics: {
      controller: [],
      validationAttempts: [],
      conformance: [],
    },
    migrations: [],
    artifacts: [],
    redaction: {
      policy: "lachesis-report-redaction/1",
      applied: true,
      omittedFields: [
        "absolute-paths",
        "environment",
        "secrets",
        "unbounded-source-values",
      ],
    },
    integrity: {
      canonicalization: "lachesis-canonical-json/1",
      digestAlgorithm: "sha256",
    },
  };
}

async function build(
  input: CommandReportInput,
  artifacts: ReadonlyArray<ArtifactBinding> = [],
): Promise<Fixture> {
  const result = await createCommandReport(input);
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return { report: result.value, artifacts };
}

async function success(): Promise<Fixture> {
  const input = await base();
  const comparisonIdentity = await identity("comparison:success");
  const artifactBytes = new TextEncoder().encode(
    '{"protocol":"finite-conformance-result/1","result":"conformant"}\n',
  );
  const artifactValue = {
    protocol: "finite-conformance-result/1",
    result: "conformant",
  };
  const artifactDigest = await digestValue(artifactValue);
  if (!artifactDigest.ok) throw new Error(artifactDigest.error.message);
  const artifactId = "conformance-result";
  return build(
    {
      ...input,
      diagnostics: {
        ...input.diagnostics,
        conformance: [
          {
            recordIdentity: await identity("record:success"),
            comparisonIdentity,
            result: "conformant",
            reportIdentity: artifactDigest.value,
            diagnostic: null,
          },
        ],
      },
      migrations: [
        {
          comparisonIdentity,
          category: "identity-only",
          outcomes: [
            {
              phase: "initial",
              assessmentIdentity: await identity("assessment:success"),
              disposition: "compatible",
            },
          ],
          guidance: {
            kind: "recompile-and-retain",
            conditional: false,
            autoAccepted: false,
            explanation:
              "The supplied finite conformance suite passed after an identity change.",
          },
        },
      ],
      artifacts: [
        {
          id: artifactId,
          kind: "conformance-report",
          mediaType: "application/json",
          digest: artifactDigest.value,
          checksum: {
            algorithm: "sha256",
            value: await rawSha256(artifactBytes),
          },
        },
      ],
    },
    [{ id: artifactId, bytes: artifactBytes }],
  );
}

async function reviewRequired(): Promise<Fixture> {
  const input = await base();
  const comparisonIdentity = await identity("comparison:review");
  return build({
    ...input,
    migrations: [
      {
        comparisonIdentity,
        category: "declaration-review",
        outcomes: [
          {
            phase: "initial",
            assessmentIdentity: await identity("assessment:review"),
            disposition: "review-required",
          },
        ],
        guidance: {
          kind: "review-required",
          conditional: true,
          autoAccepted: false,
          explanation:
            "Declarations changed without a bound conformance suite.",
        },
      },
    ],
  });
}

async function rejected(
  outcome:
    | "declaration-repairable"
    | "genuinely-non-equivalent"
    | "insufficient-evidence",
): Promise<Fixture> {
  const input = await base();
  const comparisonIdentity = await identity(`comparison:${outcome}`);
  const nested = await diagnostic(outcome);
  const category =
    outcome === "declaration-repairable"
      ? ("declaration-repairable" as const)
      : outcome === "genuinely-non-equivalent"
        ? ("genuine-non-substitution" as const)
        : ("invalid-or-unverifiable" as const);
  const guidance =
    outcome === "declaration-repairable"
      ? ({
          kind: "review-declaration",
          conditional: true,
          autoAccepted: false,
          explanation:
            "Review the declared role version against the written contract.",
          safetyCondition:
            "Only change a stale declaration; otherwise preserve rejection.",
        } as const)
      : outcome === "genuinely-non-equivalent"
        ? ({
            kind: "do-not-substitute",
            conditional: false,
            autoAccepted: false,
            explanation:
              "The capability obligation differs and metadata cannot repair it.",
            violatedObligation: "same-capability",
          } as const)
        : ({
            kind: "invalid-or-unverifiable",
            conditional: false,
            autoAccepted: false,
            explanation:
              "The available evidence is insufficient for substitution.",
          } as const);
  const disposition =
    outcome === "insufficient-evidence"
      ? ("invalid-or-unverifiable" as const)
      : outcome;
  return build({
    ...input,
    diagnostics: {
      ...input.diagnostics,
      conformance: [
        {
          recordIdentity: nested.recordDigest,
          comparisonIdentity,
          result: "rejected",
          reportIdentity: null,
          diagnostic: nested,
        },
      ],
    },
    migrations: [
      {
        comparisonIdentity,
        category,
        outcomes: [
          {
            phase: "initial",
            assessmentIdentity: await identity(`assessment:${outcome}`),
            disposition,
          },
        ],
        guidance,
      },
    ],
  });
}

async function controllerExit(exitCode: 20 | 22 | 23 | 70): Promise<Fixture> {
  const input = await base(
    exitCode === 22 ? "report.verify" : "catalog.manifest",
  );
  const code =
    exitCode === 20
      ? ("INVALID_MANIFEST" as const)
      : exitCode === 22
        ? ("CHECKSUM_MISMATCH" as const)
        : exitCode === 23
          ? ("INCOMPLETE_EXECUTION" as const)
          : ("INTERNAL_CONTROLLER_FAILURE" as const);
  return build({
    ...input,
    completeness: exitCode === 23 ? "partial" : "complete",
    diagnostics: {
      ...input.diagnostics,
      controller: [
        {
          code,
          message:
            exitCode === 20
              ? "The manifest is invalid."
              : exitCode === 22
                ? "The bound artifact checksum differs."
                : exitCode === 23
                  ? "Verification did not complete."
                  : "The controller invariant failed.",
          location: {
            artifactId: "candidate",
            fieldPath: [],
          },
        },
      ],
    },
  });
}

async function compilationRejected(): Promise<Fixture> {
  const input = await base("catalog.manifest");
  return build({
    ...input,
    diagnostics: {
      ...input.diagnostics,
      validationAttempts: [
        {
          attemptIdentity: await identity("attempt:compilation"),
          subject: {
            kind: "plan",
            label: "candidate-plan",
            digest: await identity("plan:candidate"),
          },
          result: "rejected",
          diagnostics: [
            {
              code: "DENIED_CAPABILITY",
              message: "The plan requests an unavailable capability.",
              location: { nodeId: "reserve-carrier", path: ["capability"] },
              details: [{ key: "capability", value: "carrier.write" }],
            },
            {
              code: "BUDGET_EXCEEDED",
              message: "The plan exceeds its effect-call budget.",
              location: { nodeId: "reserve-carrier", path: ["budget"] },
              details: [{ key: "resource", value: "effectCalls" }],
              limit: { resource: "effectCalls", limit: 1, actual: 2 },
            },
          ],
        },
      ],
    },
  });
}

export const semanticExitCodes = [
  0, 10, 11, 12, 13, 20, 21, 22, 23, 70,
] as const satisfies ReadonlyArray<ReportExitCode>;

export async function createExitFixture(
  exitCode: (typeof semanticExitCodes)[number],
): Promise<Fixture> {
  switch (exitCode) {
    case 0:
      return success();
    case 10:
      return reviewRequired();
    case 11:
      return rejected("declaration-repairable");
    case 12:
      return rejected("genuinely-non-equivalent");
    case 13:
      return rejected("insufficient-evidence");
    case 20:
    case 22:
    case 23:
    case 70:
      return controllerExit(exitCode);
    case 21:
      return compilationRejected();
  }
}
