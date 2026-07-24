import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { digestValue, type Result } from "@nicia-ai/lachesis";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

import {
  type CommandReport,
  type CommandReportInput,
  commandReportSchema,
  createCommandReport,
  renderMigrationGuidance,
  serializeCommandReport,
} from "./contract.js";

type Failure = Readonly<{ code: string; message: string }>;

function unwrap<T, E extends Failure>(result: Result<T, E>, label: string): T {
  if (!result.ok)
    throw new Error(`${label}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function identity(label: string): Promise<string> {
  return unwrap(await digestValue({ protocol: "m8b0-golden/1", label }), label);
}

const declarationDiagnostic: CatalogConformanceDiagnostic =
  catalogConformanceDiagnosticSchema.parse({
    protocol: "lachesis-catalog-conformance-diagnostic/1",
    code: "ROLE_VERSION_MISMATCH",
    outcome: "declaration-repairable",
    side: "both",
    role: {
      id: "northstar.role/record-incident-decision",
      version: "1",
    },
    boundary: "role-version:northstar.role/record-incident-decision",
    obligation: "exact-role-version",
    explanation:
      "Role northstar.role/record-incident-decision declares versions 1 and 2.",
    action: {
      kind: "review-declaration",
      mechanical: false,
      side: "both",
      operation: "align-role-version",
      role: {
        id: "northstar.role/record-incident-decision",
        version: "1",
      },
      patchDescription:
        "Select the written role-contract version each catalog actually implements, update only a stale declaration, and regenerate both manifests.",
      safetyCondition:
        "If the versions intentionally denote different semantics, do not edit metadata and do not substitute.",
    },
    evidence: {
      leftCatalogFingerprint:
        "fad0ba672c93d6dc32644e3f8d3762132a28803dddd4c5b8a862463bc6132d24",
      rightCatalogFingerprint:
        "6d763aaafd4cfaceca7a1db8e18958d23ea78a249e9a8ae66dd238e1ec2304ed",
      leftManifestDigest:
        "e55e8d3e50e00ff280285a913685d4370934fc407b81609a8056dd84354caf09",
      rightManifestDigest:
        "b25e1fd6ae1d827f0c0e2f478237d02b670b2c10025297c33180275a54141989",
      fixtureDigest:
        "b26a9eed2e9b57f9c4acc1fb4c061ba5069907e4543a5271f538e6123db4af06",
      inputDigest: null,
      leftValueDigest: null,
      rightValueDigest: null,
    },
    diagnosticDigest:
      "f994fd2163fcd225aad7e87c5b8415e7bb6effb81c9629a4a35b3dc670b4689d",
    recordDigest:
      "c29c175830947fff35a9c6f1e48a46b59e71d13e12ff398815689afe440f614f",
  });

const genuineDiagnostic: CatalogConformanceDiagnostic =
  catalogConformanceDiagnosticSchema.parse({
    protocol: "lachesis-catalog-conformance-diagnostic/1",
    code: "CAPABILITY_MISMATCH",
    outcome: "genuinely-non-equivalent",
    side: "both",
    role: {
      id: "northstar.role/record-incident-decision",
      version: "1",
    },
    boundary: "effect-capability",
    obligation: "same-capability",
    explanation:
      "Effect role northstar.role/record-incident-decision@1 requires different capabilities.",
    action: {
      kind: "do-not-substitute",
      mechanical: false,
      violatedObligation: "same-capability",
      reason:
        "The catalogs are semantically different on the supplied domain. Do not align metadata or substitute operations.",
    },
    evidence: {
      leftCatalogFingerprint:
        "fad0ba672c93d6dc32644e3f8d3762132a28803dddd4c5b8a862463bc6132d24",
      rightCatalogFingerprint:
        "9342496c98e8d7b05b41578b26f7f79353b11322001a4b1aada21e1127cc4315",
      leftManifestDigest:
        "e55e8d3e50e00ff280285a913685d4370934fc407b81609a8056dd84354caf09",
      rightManifestDigest:
        "acb6311b1e9baae8f5314c16232ad19ac241961c14cca72b82406f31467839f0",
      fixtureDigest:
        "b26a9eed2e9b57f9c4acc1fb4c061ba5069907e4543a5271f538e6123db4af06",
      inputDigest: null,
      leftValueDigest:
        "59e9c2b6575f46fe9146eb864791f0570532e4623394723369a1908ac4d4add1",
      rightValueDigest:
        "f9749400da806249ceb7ef2b8350bd742700a64233910dc20bd025f5d0b3f538",
    },
    diagnosticDigest:
      "0360dd44ee95f718272d177f706650a75d233274af202f4b6d82da22062caa4c",
    recordDigest:
      "f679f391fad9eb874a2921e3f362ba1a3e4683f6178f0488995129f3562d57a3",
  });

async function base(
  id: CommandReportInput["command"]["id"],
  status: CommandReportInput["status"],
): Promise<
  Pick<
    CommandReportInput,
    | "artifacts"
    | "command"
    | "completeness"
    | "inputs"
    | "protocol"
    | "redaction"
    | "status"
    | "integrity"
  >
> {
  return {
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id,
      version: "1",
      commandIdentity: await identity(`command:${id}:${status}`),
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
    status,
    completeness: "complete",
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

async function report(
  input: CommandReportInput,
  label: string,
): Promise<CommandReport> {
  return unwrap(await createCommandReport(input), label);
}

async function compatible(): Promise<CommandReport> {
  const comparisonIdentity = await identity("comparison:compatible");
  return report(
    {
      ...(await base("catalog.compare", "success")),
      diagnostics: {
        controller: [],
        validationAttempts: [],
        conformance: [
          {
            recordIdentity: await identity("record:compatible"),
            comparisonIdentity,
            result: "conformant",
            reportIdentity: await identity("conformance:compatible"),
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
              assessmentIdentity: await identity("assessment:compatible"),
              disposition: "compatible",
            },
          ],
          guidance: {
            kind: "recompile-and-retain",
            conditional: false,
            autoAccepted: false,
            explanation:
              "The finite conformance suite passed; retain both manifests and recompile against the candidate fingerprint.",
          },
        },
      ],
    },
    "compatible report",
  );
}

async function declarationRepairable(): Promise<CommandReport> {
  const comparisonIdentity = await identity("comparison:declaration");
  return report(
    {
      ...(await base("catalog.compare", "review-required")),
      diagnostics: {
        controller: [],
        validationAttempts: [],
        conformance: [
          {
            recordIdentity: declarationDiagnostic.recordDigest,
            comparisonIdentity,
            result: "rejected",
            reportIdentity: null,
            diagnostic: declarationDiagnostic,
          },
        ],
      },
      migrations: [
        {
          comparisonIdentity,
          category: "declaration-repairable",
          outcomes: [
            {
              phase: "initial",
              assessmentIdentity: declarationDiagnostic.recordDigest,
              disposition: "declaration-repairable",
            },
          ],
          guidance: {
            kind: "review-declaration",
            conditional: true,
            autoAccepted: false,
            explanation:
              "Review the written role version; metadata may change only if the declaration is stale.",
            safetyCondition:
              "If role versions intentionally denote different semantics, preserve rejection and do not substitute.",
          },
        },
      ],
    },
    "declaration report",
  );
}

async function genuinelyNonEquivalent(): Promise<CommandReport> {
  const comparisonIdentity = await identity("comparison:genuine");
  return report(
    {
      ...(await base("catalog.compare", "rejected")),
      diagnostics: {
        controller: [],
        validationAttempts: [],
        conformance: [
          {
            recordIdentity: genuineDiagnostic.recordDigest,
            comparisonIdentity,
            result: "rejected",
            reportIdentity: null,
            diagnostic: genuineDiagnostic,
          },
        ],
      },
      migrations: [
        {
          comparisonIdentity,
          category: "genuine-non-substitution",
          outcomes: [
            {
              phase: "initial",
              assessmentIdentity: genuineDiagnostic.recordDigest,
              disposition: "genuinely-non-equivalent",
            },
          ],
          guidance: {
            kind: "do-not-substitute",
            conditional: false,
            autoAccepted: false,
            explanation:
              "Capabilities differ across the effect boundary; metadata changes cannot make these operations equivalent.",
            violatedObligation: "same-capability",
          },
        },
      ],
    },
    "genuine report",
  );
}

async function compilationRejected(): Promise<CommandReport> {
  return report(
    {
      ...(await base("catalog.manifest", "rejected")),
      diagnostics: {
        controller: [],
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
                message:
                  "Required capability incident.decision.mock is not allowed by trusted policy.",
                location: {},
                details: [
                  {
                    key: "boundary",
                    value: "capability:incident.decision.mock",
                  },
                ],
              },
              {
                code: "BUDGET_EXCEEDED",
                message: "Maximum effect calls 1 exceeds trusted limit 0.",
                location: {},
                details: [],
                limit: { resource: "effect calls", limit: 0, actual: 1 },
              },
            ],
          },
        ],
        conformance: [],
      },
      migrations: [],
    },
    "compilation report",
  );
}

const outputRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(outputRoot, "../..");
const goldenRoot = resolve(outputRoot, "goldens");
await mkdir(goldenRoot, { recursive: true });

const reports = [
  ["compatible", await compatible()],
  ["declaration-repairable", await declarationRepairable()],
  ["genuinely-non-equivalent", await genuinelyNonEquivalent()],
  ["compilation-rejected", await compilationRejected()],
] as const;

for (const [name, generated] of reports) {
  const serialized = unwrap(
    serializeCommandReport(generated),
    `${name} serialization`,
  );
  await Promise.all([
    writeFile(resolve(goldenRoot, `${name}.json`), serialized, "utf8"),
    writeFile(
      resolve(goldenRoot, `${name}.txt`),
      renderMigrationGuidance(generated),
      "utf8",
    ),
  ]);
}

const jsonSchema = z.toJSONSchema(commandReportSchema, {
  target: "draft-2020-12",
});
await writeFile(
  resolve(repositoryRoot, "docs/m8b0-machine-report.schema.json"),
  `${JSON.stringify(jsonSchema, null, 2)}\n`,
  "utf8",
);
