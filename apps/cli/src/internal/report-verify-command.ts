import { digestValue, parseJson } from "@nicia-ai/lachesis";

import {
  type ArtifactBinding,
  createCommandReport,
  serializeCommandReport,
  verifyDetachedCommandReport,
  verifyDetachedReportArtifactBindings,
} from "./report-contract.js";
import { renderCommandReport } from "./report-renderer.js";
import type {
  CommandReport,
  CommandReportInput,
  ControllerDiagnosticCode,
  ReportExitCode,
} from "./report-schema.js";
import {
  atomicWriteBounded,
  readBoundedRegularFile,
  resolveProjectPath,
  type SecureFileHooks,
} from "./secure-files.js";

const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const artifactIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

type ParsedArguments = Readonly<{
  input: string;
  artifacts: ReadonlyArray<Readonly<{ id: string; path: string }>>;
  projectRoot: string;
  report: string;
  replace: boolean;
}>;
type MachineSink = Readonly<{
  stdout(text: string): void;
  stderr(text: string): void;
}>;
type ProjectTarget = Awaited<ReturnType<typeof resolveProjectPath>>;

export type ReportVerifyCommandResult = Readonly<{
  exitCode: number;
  parsed: boolean;
}>;

export type ReportVerifyCommandTestHooks = SecureFileHooks;

function usageFailure(): ReportVerifyCommandResult {
  return { exitCode: 64, parsed: false };
}

function parseArtifact(
  value: string,
): Readonly<{ id: string; path: string }> | null {
  const separator = value.indexOf("=");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf("=") ||
    separator === value.length - 1
  )
    return null;
  const id = value.slice(0, separator);
  const path = value.slice(separator + 1);
  return artifactIdPattern.test(id) ? { id, path } : null;
}

function parseArguments(args: ReadonlyArray<string>): ParsedArguments | null {
  const singletons = new Map<string, string>();
  const artifacts: Array<Readonly<{ id: string; path: string }>> = [];
  let replace = false;
  const valueFlags = new Set([
    "--input",
    "--artifact",
    "--project-root",
    "--report",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--replace") {
      if (replace) return null;
      replace = true;
      continue;
    }
    if (flag === undefined || !valueFlags.has(flag)) return null;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return null;
    if (flag === "--artifact") {
      const parsed = parseArtifact(value);
      if (parsed === null) return null;
      artifacts.push(parsed);
    } else {
      if (singletons.has(flag)) return null;
      singletons.set(flag, value);
    }
    index += 1;
  }
  const input = singletons.get("--input");
  const report = singletons.get("--report");
  if (
    input === undefined ||
    report === undefined ||
    input === "-" ||
    (report === "-" && replace) ||
    new Set(artifacts.map((artifact) => artifact.id)).size !==
      artifacts.length ||
    new Set(artifacts.map((artifact) => artifact.path)).size !==
      artifacts.length
  )
    return null;
  return {
    input,
    artifacts,
    projectRoot: singletons.get("--project-root") ?? process.cwd(),
    report,
    replace,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function controller(
  code: ControllerDiagnosticCode,
  message: string,
  artifactId?: string,
): CommandReportInput["diagnostics"]["controller"][number] {
  return {
    code,
    message,
    location: {
      ...(artifactId === undefined ? {} : { artifactId }),
      fieldPath: [],
    },
  };
}

async function makeReport(
  inputChecksum: string | undefined,
  verified: CommandReport | undefined,
  artifactInputs: ReadonlyArray<
    Readonly<{
      id: string;
      kind: CommandReport["artifacts"][number]["kind"];
      digest: string;
    }>
  >,
  diagnostics: CommandReportInput["diagnostics"]["controller"],
  completeness: "complete" | "partial",
) {
  const identity = await digestValue({
    protocol: "lachesis-report-verify-command-identity/1",
    inputChecksum: verified === undefined ? (inputChecksum ?? null) : null,
    reportDigest: verified?.reportDigest ?? null,
    artifacts: artifactInputs
      .map((artifact) => ({ id: artifact.id, digest: artifact.digest }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  });
  if (!identity.ok) throw new Error("command-identity-failed");
  return createCommandReport({
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id: "report.verify",
      version: "1",
      commandIdentity: identity.value,
    },
    inputs: [
      ...(inputChecksum === undefined || verified !== undefined
        ? []
        : [
            {
              kind: "report" as const,
              label: "command-report-bytes",
              digest: inputChecksum,
            },
          ]),
      ...(verified === undefined
        ? []
        : [
            {
              kind: "report" as const,
              label: "command-report-identity",
              digest: verified.reportDigest,
            },
          ]),
      ...artifactInputs.map((artifact) => ({
        kind:
          artifact.kind === "catalog-manifest"
            ? ("catalog-manifest" as const)
            : ("report" as const),
        label: `artifact:${artifact.id}`,
        digest: artifact.digest,
      })),
    ],
    completeness,
    diagnostics: {
      controller: diagnostics,
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
        "artifact-bytes",
        "environment",
        "secrets",
      ],
    },
    integrity: {
      canonicalization: "lachesis-canonical-json/1",
      digestAlgorithm: "sha256",
    },
  });
}

async function emit(
  parsed: ParsedArguments,
  target: ProjectTarget | undefined,
  report: Awaited<ReturnType<typeof makeReport>>,
  sink: MachineSink,
  hooks: ReportVerifyCommandTestHooks,
): Promise<ReportExitCode> {
  if (!report.ok) return 70;
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return 70;
  if (parsed.report === "-") sink.stdout(serialized.value);
  else {
    if (target === undefined) throw new Error("unsafe-output");
    await atomicWriteBounded(
      target.root,
      target.path,
      new TextEncoder().encode(serialized.value),
      MAX_REPORT_BYTES,
      parsed.replace,
      hooks,
    );
  }
  sink.stderr(renderCommandReport(report.value));
  return report.value.outcomeExitCode;
}

function fallback(
  report: Awaited<ReturnType<typeof makeReport>>,
  sink: MachineSink,
): ReportVerifyCommandResult {
  if (!report.ok) return { parsed: true, exitCode: 70 };
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return { parsed: true, exitCode: 70 };
  sink.stdout(serialized.value);
  sink.stderr(renderCommandReport(report.value));
  return { parsed: true, exitCode: report.value.outcomeExitCode };
}

function unsupportedProtocol(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Reflect.get(value, "protocol") !== "lachesis-catalog-command-report/1"
  );
}

export async function runReportVerifyCommand(
  args: ReadonlyArray<string>,
  sink: MachineSink,
  hooks: ReportVerifyCommandTestHooks = {},
): Promise<ReportVerifyCommandResult> {
  const parsed = parseArguments(args);
  if (parsed === null) return usageFailure();
  let reportTarget: ProjectTarget | undefined;
  let inputChecksum: string | undefined;
  let verified: CommandReport | undefined;
  let artifactInputs: ReadonlyArray<
    Readonly<{
      id: string;
      kind: CommandReport["artifacts"][number]["kind"];
      digest: string;
    }>
  > = [];
  try {
    const inputTarget = await resolveProjectPath(
      parsed.projectRoot,
      parsed.input,
    );
    reportTarget =
      parsed.report === "-"
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.report);
    const resolvedArtifacts = await Promise.all(
      parsed.artifacts.map(async (artifact) => ({
        id: artifact.id,
        target: await resolveProjectPath(parsed.projectRoot, artifact.path),
      })),
    );
    const readPaths = [
      inputTarget.path,
      ...resolvedArtifacts.map((artifact) => artifact.target.path),
    ];
    if (
      new Set(readPaths).size !== readPaths.length ||
      (reportTarget !== undefined && readPaths.includes(reportTarget.path))
    ) {
      const result = await makeReport(
        undefined,
        undefined,
        [],
        [
          controller(
            "IDENTITY_MISMATCH",
            "Report and artifact paths must be distinct.",
          ),
        ],
        "complete",
      );
      return fallback(result, sink);
    }
    const input = await readBoundedRegularFile(
      inputTarget.path,
      MAX_REPORT_BYTES,
      hooks,
    );
    inputChecksum = await sha256(input.bytes);
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      const result = await makeReport(
        inputChecksum,
        undefined,
        [],
        [
          controller(
            "INVALID_REPORT",
            "The supplied report is not UTF-8 JSON.",
          ),
        ],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    }
    const json = parseJson(decoded);
    if (!json.ok) {
      const result = await makeReport(
        inputChecksum,
        undefined,
        [],
        [controller("INVALID_REPORT", "The supplied report is malformed.")],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    }
    const reportResult = await verifyDetachedCommandReport(json.value);
    if (!reportResult.ok) {
      const code = unsupportedProtocol(json.value)
        ? "UNSUPPORTED_PROTOCOL"
        : reportResult.error.code.includes("MISMATCH")
          ? "IDENTITY_MISMATCH"
          : "INVALID_REPORT";
      const result = await makeReport(
        inputChecksum,
        undefined,
        [],
        [controller(code, "The supplied report failed strict verification.")],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    }
    verified = reportResult.value;
    artifactInputs = verified.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      digest: artifact.digest,
    }));
    const expectedIds = new Set(
      verified.artifacts.map((artifact) => artifact.id),
    );
    const suppliedIds = new Set(
      resolvedArtifacts.map((artifact) => artifact.id),
    );
    const missing = [...expectedIds].some((id) => !suppliedIds.has(id));
    const unexpected = [...suppliedIds].some((id) => !expectedIds.has(id));
    if (missing || unexpected) {
      const result = await makeReport(
        inputChecksum,
        verified,
        artifactInputs,
        [
          controller(
            missing ? "INCOMPLETE_EXECUTION" : "IDENTITY_MISMATCH",
            missing
              ? "A required report artifact binding is missing."
              : "An unexpected report artifact binding was supplied.",
          ),
        ],
        missing ? "partial" : "complete",
      );
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    }
    const bindings: Array<ArtifactBinding> = [];
    for (const artifact of resolvedArtifacts.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const bound = await readBoundedRegularFile(
        artifact.target.path,
        MAX_ARTIFACT_BYTES,
        hooks,
      );
      bindings.push({ id: artifact.id, bytes: bound.bytes });
    }
    const artifacts = await verifyDetachedReportArtifactBindings(
      verified,
      bindings,
    );
    if (!artifacts.ok) {
      const result = await makeReport(
        inputChecksum,
        verified,
        artifactInputs,
        [
          controller(
            "CHECKSUM_MISMATCH",
            "A bound artifact failed checksum or semantic verification.",
          ),
        ],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    }
    const result = await makeReport(
      inputChecksum,
      verified,
      artifactInputs,
      [],
      "complete",
    );
    return {
      parsed: true,
      exitCode: await emit(parsed, reportTarget, result, sink, hooks),
    };
  } catch (error: unknown) {
    const incomplete =
      error instanceof Error &&
      ("code" in error ||
        [
          "bounded-read-rejected",
          "file-identity-drift",
          "output-too-large",
          "parent-identity-drift",
          "target-identity-drift",
          "temporary-identity-drift",
          "unsafe-output",
          "unsafe-path",
        ].includes(error.message));
    const result = await makeReport(
      inputChecksum,
      verified,
      artifactInputs,
      [
        controller(
          incomplete ? "INCOMPLETE_EXECUTION" : "INTERNAL_CONTROLLER_FAILURE",
          incomplete
            ? "A bounded verification operation could not be completed."
            : "The detached verifier encountered an internal failure.",
        ),
      ],
      incomplete ? "partial" : "complete",
    );
    try {
      return {
        parsed: true,
        exitCode: await emit(parsed, reportTarget, result, sink, hooks),
      };
    } catch {
      return fallback(result, sink);
    }
  }
}
