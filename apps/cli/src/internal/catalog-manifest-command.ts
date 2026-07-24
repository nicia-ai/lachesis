import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import type { Catalog } from "@nicia-ai/lachesis";
import {
  canonicalizeJson,
  createPlanLanguageManifest,
  digestValue,
  manifestDigestSchema,
  parseJson,
  planBudgetSchema,
  readCatalog,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  createCommandReport,
  serializeCommandReport,
} from "./report-contract.js";
import { renderCommandReport } from "./report-renderer.js";
import type {
  CommandReportInput,
  ControllerDiagnosticCode,
  ReportExitCode,
} from "./report-schema.js";
import {
  atomicWriteBounded,
  type BoundBytes,
  readBoundedRegularFile,
  resolveProjectPath,
  sameBoundIdentity,
  type SecureFileHooks,
} from "./secure-files.js";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const locatorExport = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const policySchema = z
  .strictObject({
    allowedCapabilities: z.array(z.string().min(1)).max(256).readonly(),
    budget: planBudgetSchema,
  })
  .readonly();
const catalogSchema = z.custom<Catalog>().superRefine((value, context) => {
  try {
    readCatalog(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid Catalog token." });
  }
});
const moduleNamespaceSchema = z.custom<Readonly<Record<string, unknown>>>(
  (value) => value !== null && typeof value === "object",
);

type Mode =
  | Readonly<{ kind: "check" }>
  | Readonly<{ kind: "out"; path: string }>
  | Readonly<{ kind: "verify"; path: string }>;
type ParsedArguments = Readonly<{
  catalog: string;
  policy: string;
  projectRoot: string;
  report: string;
  replace: boolean;
  mode: Mode;
}>;
type Locator = Readonly<{
  exportName: string;
  path: string;
  moduleDigest: string;
  bindingDigest: string;
  source: BoundBytes;
}>;
type MachineSink = Readonly<{
  stdout(text: string): void;
  stderr(text: string): void;
}>;
type ProjectTarget = Awaited<ReturnType<typeof resolveProjectPath>>;
type ResolvedTargets = Readonly<{
  report?: ProjectTarget | undefined;
  mode?: ProjectTarget | undefined;
}>;

export type CatalogManifestCommandResult = Readonly<{
  exitCode: number;
  parsed: boolean;
}>;

export type CatalogManifestCommandTestHooks = SecureFileHooks &
  Readonly<{
    afterSourceAcquired?: ((path: string) => Promise<void>) | undefined;
    afterSourceDigest?: ((path: string) => Promise<void>) | undefined;
    beforeModuleImport?: ((path: string) => Promise<void>) | undefined;
    afterModuleImport?: ((path: string) => Promise<void>) | undefined;
    beforeExportLookup?:
      ((path: string, exportName: string) => Promise<void>) | undefined;
    onSourceAcquisition?: ((path: string) => void) | undefined;
    onModuleExecution?: ((path: string) => void) | undefined;
  }>;

function usageFailure(): CatalogManifestCommandResult {
  return { exitCode: 64, parsed: false };
}

function parseArguments(args: ReadonlyArray<string>): ParsedArguments | null {
  const singletons = new Map<string, string>();
  let check = false;
  let replace = false;
  const valueFlags = new Set([
    "--catalog",
    "--policy",
    "--project-root",
    "--report",
    "--out",
    "--verify",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--check") {
      if (check) return null;
      check = true;
      continue;
    }
    if (flag === "--replace") {
      if (replace) return null;
      replace = true;
      continue;
    }
    if (flag === undefined || !valueFlags.has(flag)) return null;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--") || singletons.has(flag))
      return null;
    singletons.set(flag, value);
    index += 1;
  }
  const catalog = singletons.get("--catalog");
  const policy = singletons.get("--policy");
  const report = singletons.get("--report");
  if (catalog === undefined || policy === undefined || report === undefined)
    return null;
  const outputPath = singletons.get("--out");
  const verifyPath = singletons.get("--verify");
  const modes: Array<Mode> = [
    ...(check ? [{ kind: "check" as const }] : []),
    ...(outputPath === undefined
      ? []
      : [{ kind: "out" as const, path: outputPath }]),
    ...(verifyPath === undefined
      ? []
      : [{ kind: "verify" as const, path: verifyPath }]),
  ];
  const mode = modes[0];
  if (
    modes.length !== 1 ||
    mode === undefined ||
    (replace && mode.kind !== "out")
  )
    return null;
  return {
    catalog,
    policy,
    projectRoot: singletons.get("--project-root") ?? process.cwd(),
    report,
    replace,
    mode,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveLocator(
  raw: string,
  projectRoot: string,
  acquisitions: Map<string, Promise<BoundBytes>>,
  hooks: CatalogManifestCommandTestHooks,
): Promise<Locator> {
  const parts = raw.split("#");
  const source = parts[0];
  const exportName = parts[1];
  if (
    parts.length !== 2 ||
    source === undefined ||
    source === "" ||
    exportName === undefined ||
    !locatorExport.test(exportName)
  )
    throw new Error("malformed-locator");
  if (
    isAbsolute(source) ||
    source.includes("://") ||
    (!source.startsWith("./") && !source.startsWith("../")) ||
    ![".js", ".mjs"].some((extension) => source.endsWith(extension))
  )
    throw new Error("unsupported-locator");
  const resolved = await resolveProjectPath(projectRoot, source);
  let acquisition = acquisitions.get(resolved.path);
  if (acquisition === undefined) {
    hooks.onSourceAcquisition?.(resolved.path);
    acquisition = (async () => {
      const acquired = await readBoundedRegularFile(
        resolved.path,
        MAX_SOURCE_BYTES,
        hooks,
      );
      await hooks.afterSourceAcquired?.(resolved.path);
      return acquired;
    })();
    acquisitions.set(resolved.path, acquisition);
  }
  const bound = await acquisition;
  const moduleDigest = await sha256(bound.bytes);
  await hooks.afterSourceDigest?.(resolved.path);
  const binding = await digestValue({
    protocol: "lachesis-catalog-module-locator/1",
    moduleDigest,
    exportName,
  });
  if (!binding.ok) throw new Error("locator-binding-failed");
  return {
    exportName,
    path: resolved.path,
    moduleDigest,
    bindingDigest: binding.value,
    source: bound,
  };
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
  catalog: Locator | undefined,
  policy: Locator | undefined,
  diagnostics: CommandReportInput["diagnostics"]["controller"],
  completeness: "complete" | "partial",
  artifact?: Readonly<{
    digest: string;
    checksum: string;
  }>,
) {
  const commandIdentity = await digestValue({
    protocol: "lachesis-catalog-manifest-command-identity/1",
    catalog: catalog?.bindingDigest ?? null,
    policy: policy?.bindingDigest ?? null,
  });
  if (!commandIdentity.ok) throw new Error("command-identity-failed");
  return createCommandReport({
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id: "catalog.manifest",
      version: "1",
      commandIdentity: commandIdentity.value,
    },
    inputs: [
      ...(catalog === undefined
        ? []
        : [
            {
              kind: "catalog" as const,
              label: "catalog-module",
              digest: catalog.moduleDigest,
            },
            {
              kind: "catalog" as const,
              label: "catalog-export-locator",
              digest: catalog.bindingDigest,
            },
          ]),
      ...(policy === undefined
        ? []
        : [
            {
              kind: "policy" as const,
              label: "policy-module",
              digest: policy.moduleDigest,
            },
            {
              kind: "policy" as const,
              label: "policy-export-locator",
              digest: policy.bindingDigest,
            },
          ]),
    ],
    completeness,
    diagnostics: {
      controller: diagnostics,
      validationAttempts: [],
      conformance: [],
    },
    migrations: [],
    artifacts:
      artifact === undefined
        ? []
        : [
            {
              id: "catalog-manifest",
              kind: "catalog-manifest",
              mediaType: "application/json",
              digest: artifact.digest,
              checksum: { algorithm: "sha256", value: artifact.checksum },
            },
          ],
    redaction: {
      policy: "lachesis-report-redaction/1",
      applied: true,
      omittedFields: [
        "absolute-paths",
        "environment",
        "module-export-values",
        "secrets",
      ],
    },
    integrity: {
      canonicalization: "lachesis-canonical-json/1",
      digestAlgorithm: "sha256",
    },
  });
}

async function emitReport(
  parsed: ParsedArguments,
  targets: ResolvedTargets,
  report: Awaited<ReturnType<typeof makeReport>>,
  sink: MachineSink,
  hooks: CatalogManifestCommandTestHooks,
): Promise<ReportExitCode> {
  if (!report.ok) return 70;
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return 70;
  if (parsed.report === "-") sink.stdout(serialized.value);
  else {
    if (targets.report === undefined) throw new Error("unsafe-output");
    await atomicWriteBounded(
      targets.report.root,
      targets.report.path,
      new TextEncoder().encode(serialized.value),
      MAX_ARTIFACT_BYTES,
      parsed.replace,
      hooks,
    );
  }
  sink.stderr(renderCommandReport(report.value));
  return report.value.outcomeExitCode;
}

async function emitAliasFailure(
  catalog: Locator | undefined,
  policy: Locator | undefined,
  sink: MachineSink,
): Promise<CatalogManifestCommandResult> {
  const report = await makeReport(
    catalog,
    policy,
    [
      controller(
        "INVALID_MANIFEST",
        "Input, artifact, and report targets must be distinct.",
      ),
    ],
    "complete",
  );
  if (!report.ok) return { parsed: true, exitCode: 70 };
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return { parsed: true, exitCode: 70 };
  sink.stdout(serialized.value);
  sink.stderr(renderCommandReport(report.value));
  return { parsed: true, exitCode: report.value.outcomeExitCode };
}

export async function runCatalogManifestCommand(
  args: ReadonlyArray<string>,
  sink: MachineSink,
  hooks: CatalogManifestCommandTestHooks = {},
): Promise<CatalogManifestCommandResult> {
  const parsed = parseArguments(args);
  if (parsed === null) return usageFailure();
  let targets: ResolvedTargets = {};
  let catalogLocator: Locator | undefined;
  let policyLocator: Locator | undefined;
  try {
    const reportTarget =
      parsed.report === "-"
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.report);
    const modeTarget =
      parsed.mode.kind === "check"
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.mode.path);
    targets = {
      ...(reportTarget === undefined ? {} : { report: reportTarget }),
      ...(modeTarget === undefined ? {} : { mode: modeTarget }),
    };
    if (reportTarget !== undefined && reportTarget.path === modeTarget?.path) {
      return await emitAliasFailure(undefined, undefined, sink);
    }
    const acquisitions = new Map<string, Promise<BoundBytes>>();
    const catalogPromise = resolveLocator(
      parsed.catalog,
      parsed.projectRoot,
      acquisitions,
      hooks,
    );
    const policyPromise = resolveLocator(
      parsed.policy,
      parsed.projectRoot,
      acquisitions,
      hooks,
    );
    [catalogLocator, policyLocator] = await Promise.all([
      catalogPromise,
      policyPromise,
    ]);
    const sourcePaths = new Set([catalogLocator.path, policyLocator.path]);
    if (
      (reportTarget !== undefined && sourcePaths.has(reportTarget.path)) ||
      (modeTarget !== undefined && sourcePaths.has(modeTarget.path))
    )
      return await emitAliasFailure(catalogLocator, policyLocator, sink);
    const modules = new Map<string, Promise<Record<string, unknown>>>();
    const verifySource = async (locator: Locator): Promise<void> => {
      const verified = await readBoundedRegularFile(
        locator.path,
        MAX_SOURCE_BYTES,
        hooks,
      );
      if (!sameBoundIdentity(locator.source, verified))
        throw new Error("module-source-identity-drift");
    };
    const load = (locator: Locator): Promise<Record<string, unknown>> => {
      const prior = modules.get(locator.path);
      if (prior !== undefined) return prior;
      const pending = (async () => {
        await hooks.beforeModuleImport?.(locator.path);
        await verifySource(locator);
        const moduleUrl = new URL(pathToFileURL(locator.path));
        moduleUrl.searchParams.set("lachesis-source", locator.moduleDigest);
        const value = await import(moduleUrl.href).then((module: unknown) =>
          moduleNamespaceSchema.parse(module),
        );
        hooks.onModuleExecution?.(locator.path);
        await hooks.afterModuleImport?.(locator.path);
        await verifySource(locator);
        return value;
      })();
      modules.set(locator.path, pending);
      return pending;
    };
    const [catalogModule, policyModule] = await Promise.all([
      load(catalogLocator),
      load(policyLocator),
    ]);
    await hooks.beforeExportLookup?.(
      catalogLocator.path,
      catalogLocator.exportName,
    );
    await verifySource(catalogLocator);
    if (
      !Object.prototype.hasOwnProperty.call(
        catalogModule,
        catalogLocator.exportName,
      )
    )
      throw new Error("missing-catalog-export");
    await hooks.beforeExportLookup?.(
      policyLocator.path,
      policyLocator.exportName,
    );
    await verifySource(policyLocator);
    if (
      !Object.prototype.hasOwnProperty.call(
        policyModule,
        policyLocator.exportName,
      )
    )
      throw new Error("missing-policy-export");
    const catalog = catalogSchema.safeParse(
      catalogModule[catalogLocator.exportName],
    );
    if (!catalog.success) {
      const report = await makeReport(
        catalogLocator,
        policyLocator,
        [controller("INVALID_CATALOG", "The catalog export is invalid.")],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emitReport(parsed, targets, report, sink, hooks),
      };
    }
    const policy = policySchema.safeParse(
      policyModule[policyLocator.exportName],
    );
    if (!policy.success) {
      const report = await makeReport(
        catalogLocator,
        policyLocator,
        [controller("INVALID_POLICY", "The compilation policy is invalid.")],
        "complete",
      );
      return {
        parsed: true,
        exitCode: await emitReport(parsed, targets, report, sink, hooks),
      };
    }
    const generated = await createPlanLanguageManifest(
      catalog.data,
      policy.data,
    );
    if (!generated.ok) throw new Error("manifest-generation-failed");
    const { manifestDigest, ...manifestBody } = generated.value;
    const recomputed = await digestValue(manifestBody);
    if (
      !recomputed.ok ||
      !manifestDigestSchema.safeParse(manifestDigest).success ||
      recomputed.value !== manifestDigest
    )
      throw new Error("manifest-invariant-failed");
    const canonical = canonicalizeJson(generated.value);
    if (!canonical.ok) throw new Error("manifest-canonicalization-failed");
    const manifestText = `${canonical.value}\n`;
    const manifestBytes = new TextEncoder().encode(manifestText);
    const artifactDigest = await digestValue(generated.value);
    if (!artifactDigest.ok) throw new Error("manifest-artifact-digest-failed");
    const artifact = {
      digest: artifactDigest.value,
      checksum: await sha256(manifestBytes),
    };
    if (parsed.mode.kind === "out") {
      if (targets.mode === undefined) throw new Error("unsafe-output");
      await atomicWriteBounded(
        targets.mode.root,
        targets.mode.path,
        manifestBytes,
        MAX_ARTIFACT_BYTES,
        parsed.replace,
        hooks,
      );
    }
    if (parsed.mode.kind === "verify") {
      if (targets.mode === undefined) throw new Error("unsafe-path");
      const supplied = await readBoundedRegularFile(
        targets.mode.path,
        MAX_ARTIFACT_BYTES,
        hooks,
      );
      const suppliedText = new TextDecoder("utf-8", { fatal: true }).decode(
        supplied.bytes,
      );
      const parsedManifest = parseJson(suppliedText);
      const suppliedDigest = parsedManifest.ok
        ? await digestValue(parsedManifest.value)
        : undefined;
      if (
        !parsedManifest.ok ||
        suppliedDigest === undefined ||
        !suppliedDigest.ok ||
        suppliedDigest.value !== artifact.digest ||
        suppliedText !== manifestText
      ) {
        const report = await makeReport(
          catalogLocator,
          policyLocator,
          [
            controller(
              "IDENTITY_MISMATCH",
              "The supplied manifest does not match its bound source.",
              "catalog-manifest",
            ),
          ],
          "complete",
          artifact,
        );
        return {
          parsed: true,
          exitCode: await emitReport(parsed, targets, report, sink, hooks),
        };
      }
    }
    const report = await makeReport(
      catalogLocator,
      policyLocator,
      [],
      "complete",
      parsed.mode.kind === "check" ? undefined : artifact,
    );
    return {
      parsed: true,
      exitCode: await emitReport(parsed, targets, report, sink, hooks),
    };
  } catch (error: unknown) {
    const incomplete =
      error instanceof Error &&
      ("code" in error ||
        [
          "bounded-read-rejected",
          "file-identity-drift",
          "module-source-identity-drift",
          "output-too-large",
          "parent-identity-drift",
          "target-identity-drift",
          "temporary-identity-drift",
          "unsafe-output",
          "unsafe-path",
        ].includes(error.message));
    const report = await makeReport(
      catalogLocator,
      policyLocator,
      [
        controller(
          incomplete ? "INCOMPLETE_EXECUTION" : "INVALID_CATALOG",
          incomplete
            ? "A bounded file operation could not be completed."
            : "The catalog module or locator is invalid.",
        ),
      ],
      incomplete ? "partial" : "complete",
    );
    try {
      return {
        parsed: true,
        exitCode: await emitReport(parsed, targets, report, sink, hooks),
      };
    } catch {
      if (!report.ok) return { parsed: true, exitCode: 70 };
      const serialized = serializeCommandReport(report.value);
      if (!serialized.ok) return { parsed: true, exitCode: 70 };
      sink.stdout(serialized.value);
      sink.stderr(renderCommandReport(report.value));
      return { parsed: true, exitCode: report.value.outcomeExitCode };
    }
  }
}
