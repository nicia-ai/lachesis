import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  Catalog,
  CompilationPolicy,
  PlanLanguageManifest,
} from "@nicia-ai/lachesis";
import {
  canonicalizeJson,
  createPlanLanguageManifest,
  digestValue,
  manifestDigestSchema,
  parseJson,
  planBudgetSchema,
  readCatalog,
} from "@nicia-ai/lachesis";
import type {
  CatalogConformanceDiagnostic,
  CatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
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
  type AtomicPairHooks,
  atomicWriteBounded,
  atomicWritePairBounded,
  type BoundBytes,
  readBoundedRegularFile,
  resolveProjectPath,
  sameBoundIdentity,
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
const suiteExportGateSchema = z.custom<Readonly<Record<string, unknown>>>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "protocol") &&
    Object.prototype.hasOwnProperty.call(value, "fixtures"),
);

type ParsedArguments = Readonly<{
  leftCatalog: string;
  leftPolicy: string;
  rightCatalog: string;
  rightPolicy: string;
  leftManifest?: string | undefined;
  rightManifest?: string | undefined;
  suite?: string | undefined;
  conformanceOut?: string | undefined;
  projectRoot: string;
  report: string;
  replace: boolean;
}>;
type MachineSink = Readonly<{
  stdout(text: string): void;
  stderr(text: string): void;
}>;
type ProjectTarget = Awaited<ReturnType<typeof resolveProjectPath>>;
type Locator = Readonly<{
  exportName: string;
  path: string;
  moduleDigest: string;
  bindingDigest: string;
  source: BoundBytes;
}>;
type ResolvedLocator = Readonly<{
  exportName: string;
  path: string;
}>;
type LoadedSide = Readonly<{
  catalogLocator: Locator;
  policyLocator: Locator;
  catalog: Catalog;
  policy: CompilationPolicy;
  manifest: PlanLanguageManifest;
  manifestText: string;
  manifestBytes: Uint8Array;
}>;
type SuiteContext = Readonly<{
  locator: Locator;
  digest: string;
}>;
type ChangeKind =
  | "catalog.identity"
  | "schema.added"
  | "schema.removed"
  | "schema.version"
  | "schema.kind"
  | "schema.description"
  | "schema.json-schema"
  | "operation.added"
  | "operation.removed"
  | "operation.version"
  | "operation.kind"
  | "operation.description"
  | "operation.signature.input"
  | "operation.signature.output"
  | "operation.signature.element"
  | "operation.signature.accumulator"
  | "operation.semantics.state-changing"
  | "operation.effect.name"
  | "operation.effect.capability"
  | "operation.effect.replayable"
  | "operation.bound.max-output-items"
  | "operation.bound.max-tokens"
  | "operation.bound.max-wall-clock-ms"
  | "operation.reducer-law.associative"
  | "operation.reducer-law.commutative"
  | "operation.reducer-law.idempotent"
  | "semantic-role.protocol"
  | "semantic-role.schema.added"
  | "semantic-role.schema.removed"
  | "semantic-role.schema.version"
  | "semantic-role.schema.target"
  | "semantic-role.schema.obligations"
  | "semantic-role.operation.added"
  | "semantic-role.operation.removed"
  | "semantic-role.operation.version"
  | "semantic-role.operation.kind"
  | "semantic-role.operation.target"
  | "semantic-role.operation.obligation"
  | "policy.capability.added"
  | "policy.capability.removed"
  | "policy.budget";
type StructuralChange = Readonly<{
  kind: ChangeKind;
  subject: string;
  leftDigest: string | null;
  rightDigest: string | null;
}>;
type ComparableDeclaration = Readonly<{
  reference: Readonly<{ id: string; version: string }>;
}>;
type SemanticRoleDeclaration = Readonly<{
  kind: string;
  role: Readonly<{ id: string; version: string }>;
  obligations: Readonly<Record<string, unknown>>;
  schema?: Readonly<{ id: string; version: string }> | undefined;
  operation?: Readonly<{ id: string; version: string }> | undefined;
}>;
type ConformanceRecord =
  CommandReportInput["diagnostics"]["conformance"][number];

export type CatalogCompareCommandResult = Readonly<{
  exitCode: number;
  parsed: boolean;
}>;

export type CatalogCompareCommandTestHooks = AtomicPairHooks &
  Readonly<{
    afterSourceAcquired?: ((path: string) => Promise<void>) | undefined;
    afterSourceDigest?: ((path: string) => Promise<void>) | undefined;
    beforeModuleImport?: ((path: string) => Promise<void>) | undefined;
    afterModuleImport?: ((path: string) => Promise<void>) | undefined;
    beforeExportLookup?:
      ((path: string, exportName: string) => Promise<void>) | undefined;
    onSourceAcquisition?: ((path: string) => void) | undefined;
    onModuleExecution?: ((path: string) => void) | undefined;
    onGeneratorLoad?: (() => void) | undefined;
    onDiagnosis?: (() => void) | undefined;
    transformNativeAssessment?: ((assessment: unknown) => unknown) | undefined;
  }>;

function usageFailure(): CatalogCompareCommandResult {
  return { parsed: false, exitCode: 64 };
}

function validLocator(raw: string): boolean {
  const parts = raw.split("#");
  const source = parts[0];
  const exportName = parts[1];
  return (
    parts.length === 2 &&
    source !== undefined &&
    source !== "" &&
    exportName !== undefined &&
    locatorExport.test(exportName) &&
    !isAbsolute(source) &&
    !source.includes("://") &&
    (source.startsWith("./") || source.startsWith("../")) &&
    [".js", ".mjs"].some((extension) => source.endsWith(extension))
  );
}

function parseArguments(args: ReadonlyArray<string>): ParsedArguments | null {
  const singletons = new Map<string, string>();
  let replace = false;
  const valueFlags = new Set([
    "--left-catalog",
    "--left-policy",
    "--right-catalog",
    "--right-policy",
    "--left-manifest",
    "--right-manifest",
    "--project-root",
    "--report",
    "--suite",
    "--conformance-out",
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
    if (value === undefined || value.startsWith("--") || singletons.has(flag))
      return null;
    singletons.set(flag, value);
    index += 1;
  }
  const leftCatalog = singletons.get("--left-catalog");
  const leftPolicy = singletons.get("--left-policy");
  const rightCatalog = singletons.get("--right-catalog");
  const rightPolicy = singletons.get("--right-policy");
  const report = singletons.get("--report");
  const suite = singletons.get("--suite");
  const conformanceOut = singletons.get("--conformance-out");
  if (
    leftCatalog === undefined ||
    leftPolicy === undefined ||
    rightCatalog === undefined ||
    rightPolicy === undefined ||
    report === undefined ||
    ![leftCatalog, leftPolicy, rightCatalog, rightPolicy].every(validLocator) ||
    (suite !== undefined && !validLocator(suite)) ||
    (suite === undefined) !== (conformanceOut === undefined) ||
    (suite !== undefined && report === "-")
  )
    return null;
  return {
    leftCatalog,
    leftPolicy,
    rightCatalog,
    rightPolicy,
    ...(singletons.has("--left-manifest")
      ? { leftManifest: singletons.get("--left-manifest") }
      : {}),
    ...(singletons.has("--right-manifest")
      ? { rightManifest: singletons.get("--right-manifest") }
      : {}),
    ...(suite === undefined ? {} : { suite }),
    ...(conformanceOut === undefined ? {} : { conformanceOut }),
    projectRoot: singletons.get("--project-root") ?? process.cwd(),
    report,
    replace,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveLocatorPath(
  raw: string,
  projectRoot: string,
): Promise<ResolvedLocator> {
  const parts = raw.split("#");
  const source = parts[0];
  const exportName = parts[1];
  if (source === undefined || exportName === undefined)
    throw new Error("invalid-locator");
  const resolved = await resolveProjectPath(projectRoot, source);
  return { path: resolved.path, exportName };
}

async function acquireLocator(
  resolved: ResolvedLocator,
  acquisitions: Map<string, Promise<BoundBytes>>,
  hooks: CatalogCompareCommandTestHooks,
): Promise<Locator> {
  let acquisition = acquisitions.get(resolved.path);
  if (acquisition === undefined) {
    hooks.onSourceAcquisition?.(resolved.path);
    acquisition = (async () => {
      const source = await readBoundedRegularFile(
        resolved.path,
        MAX_SOURCE_BYTES,
        hooks,
      );
      await hooks.afterSourceAcquired?.(resolved.path);
      return source;
    })();
    acquisitions.set(resolved.path, acquisition);
  }
  const source = await acquisition;
  const moduleDigest = await sha256(source.bytes);
  await hooks.afterSourceDigest?.(resolved.path);
  const binding = await digestValue({
    protocol: "lachesis-catalog-module-locator/1",
    moduleDigest,
    exportName: resolved.exportName,
  });
  if (!binding.ok) throw new Error("locator-binding-failed");
  return {
    ...resolved,
    source,
    moduleDigest,
    bindingDigest: binding.value,
  };
}

async function verifySource(
  locator: Locator,
  hooks: CatalogCompareCommandTestHooks,
): Promise<void> {
  const verified = await readBoundedRegularFile(
    locator.path,
    MAX_SOURCE_BYTES,
    hooks,
  );
  if (!sameBoundIdentity(locator.source, verified))
    throw new Error("module-source-identity-drift");
}

async function importModules(
  locators: ReadonlyArray<Locator>,
  hooks: CatalogCompareCommandTestHooks,
): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>> {
  const modules = new Map<string, Promise<Readonly<Record<string, unknown>>>>();
  const load = (
    locator: Locator,
  ): Promise<Readonly<Record<string, unknown>>> => {
    const prior = modules.get(locator.path);
    if (prior !== undefined) return prior;
    const pending = (async () => {
      await hooks.beforeModuleImport?.(locator.path);
      await verifySource(locator, hooks);
      const moduleUrl = new URL(pathToFileURL(locator.path));
      moduleUrl.searchParams.set("lachesis-source", locator.moduleDigest);
      const namespace = await import(moduleUrl.href).then((value: unknown) =>
        moduleNamespaceSchema.parse(value),
      );
      hooks.onModuleExecution?.(locator.path);
      await hooks.afterModuleImport?.(locator.path);
      await verifySource(locator, hooks);
      return namespace;
    })();
    modules.set(locator.path, pending);
    return pending;
  };
  await Promise.all(locators.map(load));
  return new Map(
    await Promise.all(
      [...modules].map(
        async ([path, pending]) => [path, await pending] as const,
      ),
    ),
  );
}

async function exported(
  locator: Locator,
  modules: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  hooks: CatalogCompareCommandTestHooks,
): Promise<unknown> {
  await hooks.beforeExportLookup?.(locator.path, locator.exportName);
  await verifySource(locator, hooks);
  const namespace = modules.get(locator.path);
  if (
    namespace === undefined ||
    !Object.prototype.hasOwnProperty.call(namespace, locator.exportName)
  )
    throw new Error("missing-export");
  return namespace[locator.exportName];
}

async function manifestFor(
  catalogLocator: Locator,
  policyLocator: Locator,
  modules: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  hooks: CatalogCompareCommandTestHooks,
): Promise<LoadedSide> {
  const [catalogValue, policyValue] = await Promise.all([
    exported(catalogLocator, modules, hooks),
    exported(policyLocator, modules, hooks),
  ]);
  const catalog = catalogSchema.safeParse(catalogValue);
  if (!catalog.success) throw new Error("invalid-catalog");
  const policy = policySchema.safeParse(policyValue);
  if (!policy.success) throw new Error("invalid-policy");
  const generated = await createPlanLanguageManifest(catalog.data, policy.data);
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
  return {
    catalogLocator,
    policyLocator,
    catalog: catalog.data,
    policy: policy.data,
    manifest: generated.value,
    manifestText,
    manifestBytes: new TextEncoder().encode(manifestText),
  };
}

async function valueDigest(value: unknown): Promise<string> {
  const digest = await digestValue(value);
  if (!digest.ok) throw new Error("comparison-digest-failed");
  return digest.value;
}

async function change(
  kind: ChangeKind,
  subject: string,
  left: unknown,
  right: unknown,
): Promise<StructuralChange | undefined> {
  const [leftDigest, rightDigest] = await Promise.all([
    valueDigest(left),
    valueDigest(right),
  ]);
  return leftDigest === rightDigest
    ? undefined
    : { kind, subject, leftDigest, rightDigest };
}

async function oneSidedChange(
  kind: ChangeKind,
  subject: string,
  side: "left" | "right",
  value: unknown,
): Promise<StructuralChange> {
  const digest = await valueDigest(value);
  return {
    kind,
    subject,
    leftDigest: side === "left" ? digest : null,
    rightDigest: side === "right" ? digest : null,
  };
}

function uniqueIds(values: ReadonlyArray<ComparableDeclaration>): boolean {
  return (
    new Set(values.map((value) => value.reference.id)).size === values.length
  );
}

async function compareDeclarations<T extends ComparableDeclaration>(
  left: ReadonlyArray<T>,
  right: ReadonlyArray<T>,
  prefix: "schema" | "operation",
  compareMatched: (
    left: T,
    right: T,
    subject: string,
  ) => Promise<ReadonlyArray<StructuralChange>>,
): Promise<ReadonlyArray<StructuralChange>> {
  const useId = uniqueIds(left) && uniqueIds(right);
  const key = (value: T): string =>
    useId
      ? value.reference.id
      : `${value.reference.id}@${value.reference.version}`;
  const leftMap = new Map(left.map((value) => [key(value), value]));
  const rightMap = new Map(right.map((value) => [key(value), value]));
  const changes: Array<StructuralChange> = [];
  for (const subject of new Set([...leftMap.keys(), ...rightMap.keys()])) {
    const leftValue = leftMap.get(subject);
    const rightValue = rightMap.get(subject);
    if (leftValue === undefined && rightValue !== undefined) {
      changes.push(
        await oneSidedChange(`${prefix}.added`, subject, "right", rightValue),
      );
    } else if (leftValue !== undefined && rightValue === undefined) {
      changes.push(
        await oneSidedChange(`${prefix}.removed`, subject, "left", leftValue),
      );
    } else if (leftValue !== undefined && rightValue !== undefined) {
      changes.push(...(await compareMatched(leftValue, rightValue, subject)));
    }
  }
  return changes;
}

async function appendChanged(
  changes: Array<StructuralChange>,
  kind: ChangeKind,
  subject: string,
  left: unknown,
  right: unknown,
): Promise<void> {
  const result = await change(kind, subject, left, right);
  if (result !== undefined) changes.push(result);
}

async function compareSchemas(
  left: PlanLanguageManifest["schemas"],
  right: PlanLanguageManifest["schemas"],
): Promise<ReadonlyArray<StructuralChange>> {
  return await compareDeclarations(
    left,
    right,
    "schema",
    async (leftSchema, rightSchema, subject) => {
      const changes: Array<StructuralChange> = [];
      await appendChanged(
        changes,
        "schema.version",
        subject,
        leftSchema.reference.version,
        rightSchema.reference.version,
      );
      await appendChanged(
        changes,
        "schema.kind",
        subject,
        leftSchema.kind,
        rightSchema.kind,
      );
      await appendChanged(
        changes,
        "schema.description",
        subject,
        leftSchema.description,
        rightSchema.description,
      );
      await appendChanged(
        changes,
        "schema.json-schema",
        subject,
        leftSchema.jsonSchema,
        rightSchema.jsonSchema,
      );
      return changes;
    },
  );
}

async function compareOperations(
  left: PlanLanguageManifest["operations"],
  right: PlanLanguageManifest["operations"],
): Promise<ReadonlyArray<StructuralChange>> {
  return await compareDeclarations(
    left,
    right,
    "operation",
    async (leftOperation, rightOperation, subject) => {
      const changes: Array<StructuralChange> = [];
      const fields: ReadonlyArray<readonly [ChangeKind, unknown, unknown]> = [
        [
          "operation.version",
          leftOperation.reference.version,
          rightOperation.reference.version,
        ],
        ["operation.kind", leftOperation.kind, rightOperation.kind],
        [
          "operation.description",
          leftOperation.description,
          rightOperation.description,
        ],
        [
          "operation.signature.input",
          leftOperation.input ?? null,
          rightOperation.input ?? null,
        ],
        [
          "operation.signature.output",
          leftOperation.output ?? null,
          rightOperation.output ?? null,
        ],
        [
          "operation.signature.element",
          leftOperation.element ?? null,
          rightOperation.element ?? null,
        ],
        [
          "operation.signature.accumulator",
          leftOperation.accumulator ?? null,
          rightOperation.accumulator ?? null,
        ],
        [
          "operation.semantics.state-changing",
          leftOperation.semantics.stateChanging,
          rightOperation.semantics.stateChanging,
        ],
        [
          "operation.effect.name",
          leftOperation.effect?.name ?? null,
          rightOperation.effect?.name ?? null,
        ],
        [
          "operation.effect.capability",
          leftOperation.effect?.capability ?? null,
          rightOperation.effect?.capability ?? null,
        ],
        [
          "operation.effect.replayable",
          leftOperation.effect?.replayable ?? null,
          rightOperation.effect?.replayable ?? null,
        ],
        [
          "operation.bound.max-output-items",
          leftOperation.bounds.maxOutputItems ?? null,
          rightOperation.bounds.maxOutputItems ?? null,
        ],
        [
          "operation.bound.max-tokens",
          leftOperation.bounds.maxTokens ?? null,
          rightOperation.bounds.maxTokens ?? null,
        ],
        [
          "operation.bound.max-wall-clock-ms",
          leftOperation.bounds.maxWallClockMs ?? null,
          rightOperation.bounds.maxWallClockMs ?? null,
        ],
        [
          "operation.reducer-law.associative",
          leftOperation.reducerLaws?.associative ?? null,
          rightOperation.reducerLaws?.associative ?? null,
        ],
        [
          "operation.reducer-law.commutative",
          leftOperation.reducerLaws?.commutative ?? null,
          rightOperation.reducerLaws?.commutative ?? null,
        ],
        [
          "operation.reducer-law.idempotent",
          leftOperation.reducerLaws?.idempotent ?? null,
          rightOperation.reducerLaws?.idempotent ?? null,
        ],
      ];
      for (const [kind, leftValue, rightValue] of fields)
        await appendChanged(changes, kind, subject, leftValue, rightValue);
      return changes;
    },
  );
}

async function compareRoleDeclarations(
  left: ReadonlyArray<SemanticRoleDeclaration>,
  right: ReadonlyArray<SemanticRoleDeclaration>,
  target: "schema" | "operation",
): Promise<ReadonlyArray<StructuralChange>> {
  const uniqueRoleIds = (values: ReadonlyArray<SemanticRoleDeclaration>) =>
    new Set(values.map((value) => value.role.id)).size === values.length;
  const useId = uniqueRoleIds(left) && uniqueRoleIds(right);
  const key = (value: SemanticRoleDeclaration): string =>
    useId ? value.role.id : `${value.role.id}@${value.role.version}`;
  const leftMap = new Map(left.map((value) => [key(value), value]));
  const rightMap = new Map(right.map((value) => [key(value), value]));
  const changes: Array<StructuralChange> = [];
  for (const subject of new Set([...leftMap.keys(), ...rightMap.keys()])) {
    const leftValue = leftMap.get(subject);
    const rightValue = rightMap.get(subject);
    if (leftValue === undefined && rightValue !== undefined) {
      changes.push(
        await oneSidedChange(
          `semantic-role.${target}.added`,
          subject,
          "right",
          rightValue,
        ),
      );
      continue;
    }
    if (leftValue !== undefined && rightValue === undefined) {
      changes.push(
        await oneSidedChange(
          `semantic-role.${target}.removed`,
          subject,
          "left",
          leftValue,
        ),
      );
      continue;
    }
    if (leftValue === undefined || rightValue === undefined) continue;
    await appendChanged(
      changes,
      `semantic-role.${target}.version`,
      subject,
      leftValue.role.version,
      rightValue.role.version,
    );
    if (target === "operation")
      await appendChanged(
        changes,
        "semantic-role.operation.kind",
        subject,
        leftValue.kind,
        rightValue.kind,
      );
    await appendChanged(
      changes,
      `semantic-role.${target}.target`,
      subject,
      target === "schema" ? leftValue.schema : leftValue.operation,
      target === "schema" ? rightValue.schema : rightValue.operation,
    );
    const obligationKeys = new Set([
      ...Object.keys(leftValue.obligations),
      ...Object.keys(rightValue.obligations),
    ]);
    for (const obligation of obligationKeys)
      await appendChanged(
        changes,
        target === "schema"
          ? "semantic-role.schema.obligations"
          : "semantic-role.operation.obligation",
        `${subject}:${obligation}`,
        leftValue.obligations[obligation] ?? null,
        rightValue.obligations[obligation] ?? null,
      );
  }
  return changes;
}

async function compareRoles(
  left: PlanLanguageManifest["semanticRoles"],
  right: PlanLanguageManifest["semanticRoles"],
): Promise<ReadonlyArray<StructuralChange>> {
  const changes: Array<StructuralChange> = [];
  await appendChanged(
    changes,
    "semantic-role.protocol",
    "semantic-roles",
    left?.protocol ?? null,
    right?.protocol ?? null,
  );
  changes.push(
    ...(await compareRoleDeclarations(
      left?.schemas ?? [],
      right?.schemas ?? [],
      "schema",
    )),
    ...(await compareRoleDeclarations(
      left?.operations ?? [],
      right?.operations ?? [],
      "operation",
    )),
  );
  return changes;
}

async function comparePolicy(
  left: CompilationPolicy,
  right: CompilationPolicy,
): Promise<ReadonlyArray<StructuralChange>> {
  const changes: Array<StructuralChange> = [];
  const counts = (
    values: ReadonlyArray<string>,
  ): ReadonlyMap<string, number> => {
    const result = new Map<string, number>();
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  };
  const leftCapabilities = counts(left.allowedCapabilities);
  const rightCapabilities = counts(right.allowedCapabilities);
  for (const capability of new Set([
    ...leftCapabilities.keys(),
    ...rightCapabilities.keys(),
  ])) {
    const leftCount = leftCapabilities.get(capability) ?? 0;
    const rightCount = rightCapabilities.get(capability) ?? 0;
    if (leftCount > rightCount)
      changes.push(
        await oneSidedChange("policy.capability.removed", capability, "left", {
          capability,
          count: leftCount - rightCount,
        }),
      );
    if (rightCount > leftCount)
      changes.push(
        await oneSidedChange("policy.capability.added", capability, "right", {
          capability,
          count: rightCount - leftCount,
        }),
      );
  }
  const budgetKeys = [
    "maxEffectCalls",
    "maxCollectionItems",
    "maxRecursionDepth",
    "maxTokens",
    "maxWallClockMs",
    "maxParallelism",
  ] as const;
  for (const key of budgetKeys)
    await appendChanged(
      changes,
      "policy.budget",
      key,
      left.budget[key],
      right.budget[key],
    );
  return changes;
}

async function structuralChanges(
  left: LoadedSide,
  right: LoadedSide,
): Promise<ReadonlyArray<StructuralChange>> {
  const changes: Array<StructuralChange> = [];
  await appendChanged(
    changes,
    "catalog.identity",
    "catalog",
    left.manifest.catalog,
    right.manifest.catalog,
  );
  changes.push(
    ...(await compareSchemas(left.manifest.schemas, right.manifest.schemas)),
    ...(await compareOperations(
      left.manifest.operations,
      right.manifest.operations,
    )),
    ...(await compareRoles(
      left.manifest.semanticRoles,
      right.manifest.semanticRoles,
    )),
    ...(await comparePolicy(left.policy, right.policy)),
  );
  return changes.toSorted((leftChange, rightChange) => {
    const leftKey = `${leftChange.kind}:${leftChange.subject}`;
    const rightKey = `${rightChange.kind}:${rightChange.subject}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function safeSubject(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return `utf8-${[...new TextEncoder().encode(value)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
}

async function migrations(
  changes: ReadonlyArray<StructuralChange>,
): Promise<CommandReportInput["migrations"]> {
  return await Promise.all(
    changes.map(async (item) => {
      const comparison = await digestValue({
        protocol: "lachesis-structural-catalog-change/1",
        ...item,
      });
      if (!comparison.ok) throw new Error("comparison-identity-failed");
      const assessment = await digestValue({
        protocol: "lachesis-structural-catalog-assessment/1",
        comparisonIdentity: comparison.value,
        phase: "initial",
        disposition: "review-required",
      });
      if (!assessment.ok) throw new Error("assessment-identity-failed");
      return {
        comparisonIdentity: comparison.value,
        category: "declaration-review" as const,
        outcomes: [
          {
            phase: "initial" as const,
            assessmentIdentity: assessment.value,
            disposition: "review-required" as const,
          },
        ],
        guidance: {
          kind: "review-required" as const,
          conditional: true as const,
          autoAccepted: false as const,
          explanation: `change=${item.kind}; subject=${safeSubject(item.subject)}; left=${item.leftDigest ?? "absent"}; right=${item.rightDigest ?? "absent"}; disposition=review-required. Structural evidence only; author review required.`,
        },
      };
    }),
  );
}

async function comparisonIdentity(
  leftManifestDigest: string,
  rightManifestDigest: string,
  suiteDigest: string,
): Promise<string> {
  const identity = await digestValue({
    protocol: "lachesis-catalog-command-report/1",
    command: "catalog.compare",
    version: "1",
    leftManifestDigest,
    rightManifestDigest,
    suiteDigest,
    mode: "finite-semantic-conformance",
  });
  if (!identity.ok) throw new Error("comparison-identity-failed");
  return identity.value;
}

async function assessmentIdentity(
  comparison: string,
  disposition:
    | "declaration-repairable"
    | "genuinely-non-equivalent"
    | "invalid-or-unverifiable",
): Promise<string> {
  const identity = await digestValue({
    protocol: "lachesis-catalog-semantic-assessment/1",
    comparisonIdentity: comparison,
    phase: "initial",
    disposition,
  });
  if (!identity.ok) throw new Error("assessment-identity-failed");
  return identity.value;
}

async function rejectedMigration(
  comparison: string,
  diagnostic: CatalogConformanceDiagnostic,
): Promise<CommandReportInput["migrations"][number]> {
  switch (diagnostic.outcome) {
    case "declaration-repairable": {
      if (diagnostic.action.kind !== "review-declaration")
        throw new Error("native-cardinality-failed");
      return {
        comparisonIdentity: comparison,
        category: "declaration-repairable",
        outcomes: [
          {
            phase: "initial",
            assessmentIdentity: await assessmentIdentity(
              comparison,
              "declaration-repairable",
            ),
            disposition: "declaration-repairable",
          },
        ],
        guidance: {
          kind: "review-declaration",
          conditional: true,
          autoAccepted: false,
          explanation: diagnostic.action.patchDescription,
          safetyCondition: diagnostic.action.safetyCondition,
        },
      };
    }
    case "genuinely-non-equivalent": {
      if (diagnostic.action.kind !== "do-not-substitute")
        throw new Error("native-cardinality-failed");
      return {
        comparisonIdentity: comparison,
        category: "genuine-non-substitution",
        outcomes: [
          {
            phase: "initial",
            assessmentIdentity: await assessmentIdentity(
              comparison,
              "genuinely-non-equivalent",
            ),
            disposition: "genuinely-non-equivalent",
          },
        ],
        guidance: {
          kind: "do-not-substitute",
          conditional: false,
          autoAccepted: false,
          explanation: diagnostic.action.reason,
          violatedObligation: diagnostic.action.violatedObligation,
        },
      };
    }
    case "insufficient-evidence":
      return {
        comparisonIdentity: comparison,
        category: "invalid-or-unverifiable",
        outcomes: [
          {
            phase: "initial",
            assessmentIdentity: await assessmentIdentity(
              comparison,
              "invalid-or-unverifiable",
            ),
            disposition: "invalid-or-unverifiable",
          },
        ],
        guidance: {
          kind: "invalid-or-unverifiable",
          conditional: false,
          autoAccepted: false,
          explanation: diagnostic.explanation,
        },
      };
  }
}

async function conformantRecord(
  comparison: string,
  report: CatalogConformanceReport,
): Promise<ConformanceRecord> {
  const identity = await digestValue({
    protocol: "lachesis-catalog-conformance-record/1",
    comparisonIdentity: comparison,
    result: "conformant",
    reportIdentity: report.reportDigest,
  });
  if (!identity.ok) throw new Error("native-cardinality-failed");
  return {
    recordIdentity: identity.value,
    comparisonIdentity: comparison,
    result: "conformant",
    reportIdentity: report.reportDigest,
    diagnostic: null,
  };
}

function rejectedRecord(
  comparison: string,
  diagnostic: CatalogConformanceDiagnostic,
): ConformanceRecord {
  return {
    recordIdentity: diagnostic.recordDigest,
    comparisonIdentity: comparison,
    result: "rejected",
    reportIdentity: null,
    diagnostic,
  };
}

function nativeReportBytes(report: CatalogConformanceReport): Uint8Array {
  const canonical = canonicalizeJson(report);
  if (!canonical.ok) throw new Error("native-canonicalization-failed");
  const bytes = new TextEncoder().encode(`${canonical.value}\n`);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error("output-too-large");
  return bytes;
}

async function loadGenerator(hooks: CatalogCompareCommandTestHooks) {
  hooks.onGeneratorLoad?.();
  return await import("@nicia-ai/lachesis-generator");
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
  locators: ReadonlyArray<Locator>,
  manifests: Readonly<
    Array<Readonly<{ side: "left" | "right"; digest: string }>>
  >,
  diagnostics: CommandReportInput["diagnostics"]["controller"],
  completeness: "complete" | "partial",
  migrationRecords: CommandReportInput["migrations"] = [],
) {
  const inputs: Array<CommandReportInput["inputs"][number]> = [];
  const labels = [
    "left-catalog",
    "left-policy",
    "right-catalog",
    "right-policy",
  ] as const;
  for (const [index, locator] of locators.entries()) {
    const label = labels[index];
    if (label === undefined) continue;
    inputs.push(
      {
        kind: label.endsWith("policy") ? "policy" : "catalog",
        label: `${label}-module`,
        digest: locator.moduleDigest,
      },
      {
        kind: label.endsWith("policy") ? "policy" : "catalog",
        label: `${label}-export-locator`,
        digest: locator.bindingDigest,
      },
    );
  }
  for (const manifest of manifests)
    inputs.push({
      kind: "catalog-manifest",
      label: `${manifest.side}-manifest`,
      digest: manifest.digest,
    });
  const commandIdentity = await digestValue({
    protocol: "lachesis-catalog-command-identity/1",
    command: "catalog.compare",
    version: "1",
    inputs: inputs
      .map((input) => ({
        kind: input.kind,
        label: input.label,
        digest: input.digest,
      }))
      .toSorted((left, right) =>
        left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
      ),
    options: ["structural-only"],
  });
  if (!commandIdentity.ok) throw new Error("command-identity-failed");
  return await createCommandReport({
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id: "catalog.compare",
      version: "1",
      commandIdentity: commandIdentity.value,
    },
    inputs,
    completeness,
    diagnostics: {
      controller: diagnostics,
      validationAttempts: [],
      conformance: [],
    },
    migrations: migrationRecords,
    artifacts: [],
    redaction: {
      policy: "lachesis-report-redaction/1",
      applied: true,
      omittedFields: [
        "absolute-paths",
        "environment",
        "module-export-values",
        "secrets",
        "source-code",
      ],
    },
    integrity: {
      canonicalization: "lachesis-canonical-json/1",
      digestAlgorithm: "sha256",
    },
  });
}

async function makeSuiteReport(
  locators: ReadonlyArray<Locator>,
  manifests: Readonly<
    Array<Readonly<{ side: "left" | "right"; digest: string }>>
  >,
  suiteDigest: string | undefined,
  diagnostics: CommandReportInput["diagnostics"]["controller"],
  completeness: "complete" | "partial",
  conformance: CommandReportInput["diagnostics"]["conformance"] = [],
  migrationRecords: CommandReportInput["migrations"] = [],
  artifacts: CommandReportInput["artifacts"] = [],
) {
  const inputs: Array<CommandReportInput["inputs"][number]> = [];
  const labels = [
    "left-catalog",
    "left-policy",
    "right-catalog",
    "right-policy",
    "conformance-suite",
  ] as const;
  for (const [index, locator] of locators.entries()) {
    const label = labels[index];
    if (label === undefined) continue;
    const kind =
      label === "conformance-suite"
        ? "conformance-suite"
        : label.endsWith("policy")
          ? "policy"
          : "catalog";
    inputs.push(
      {
        kind,
        label: `${label}-module`,
        digest: locator.moduleDigest,
      },
      {
        kind,
        label: `${label}-export-locator`,
        digest: locator.bindingDigest,
      },
    );
  }
  for (const manifest of manifests)
    inputs.push({
      kind: "catalog-manifest",
      label: `${manifest.side}-manifest`,
      digest: manifest.digest,
    });
  if (suiteDigest !== undefined)
    inputs.push({
      kind: "conformance-suite",
      label: "validated-conformance-suite",
      digest: suiteDigest,
    });
  const commandIdentity = await digestValue({
    protocol: "lachesis-catalog-command-identity/1",
    command: "catalog.compare",
    version: "1",
    inputs: inputs
      .map((input) => ({
        kind: input.kind,
        label: input.label,
        digest: input.digest,
      }))
      .toSorted((left, right) =>
        left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
      ),
    options: ["finite-semantic-conformance"],
  });
  if (!commandIdentity.ok) throw new Error("command-identity-failed");
  return await createCommandReport({
    protocol: "lachesis-catalog-command-report/1",
    command: {
      id: "catalog.compare",
      version: "1",
      commandIdentity: commandIdentity.value,
    },
    inputs,
    completeness,
    diagnostics: {
      controller: diagnostics,
      validationAttempts: [],
      conformance,
    },
    migrations: migrationRecords,
    artifacts,
    redaction: {
      policy: "lachesis-report-redaction/1",
      applied: true,
      omittedFields: [
        "absolute-paths",
        "environment",
        "module-export-values",
        "secrets",
        "source-code",
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
  reportTarget: ProjectTarget | undefined,
  report: Awaited<ReturnType<typeof makeReport>>,
  sink: MachineSink,
  hooks: CatalogCompareCommandTestHooks,
): Promise<ReportExitCode> {
  if (!report.ok) return 70;
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return 70;
  if (parsed.report === "-") sink.stdout(serialized.value);
  else {
    if (reportTarget === undefined) throw new Error("unsafe-output");
    await atomicWriteBounded(
      reportTarget.root,
      reportTarget.path,
      new TextEncoder().encode(serialized.value),
      MAX_ARTIFACT_BYTES,
      parsed.replace,
      hooks,
    );
  }
  sink.stderr(renderCommandReport(report.value));
  return report.value.outcomeExitCode;
}

async function emitSuitePair(
  parsed: ParsedArguments,
  reportTarget: ProjectTarget,
  conformanceTarget: ProjectTarget,
  report: Awaited<ReturnType<typeof makeSuiteReport>>,
  nativeBytes: Uint8Array,
  sink: MachineSink,
  hooks: CatalogCompareCommandTestHooks,
): Promise<ReportExitCode> {
  if (!report.ok) return 70;
  const conformance = report.value.diagnostics.conformance;
  const record = conformance[0];
  const artifact = report.value.artifacts[0];
  if (
    conformance.length !== 1 ||
    record?.result !== "conformant" ||
    record.reportIdentity === null ||
    report.value.artifacts.length !== 1 ||
    artifact?.kind !== "conformance-report" ||
    artifact.digest !== record.reportIdentity ||
    (await sha256(nativeBytes)) !== artifact.checksum.value
  )
    throw new Error("native-cardinality-failed");
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) throw new Error("command-serialization-failed");
  const reportBytes = new TextEncoder().encode(serialized.value);
  await atomicWritePairBounded(
    {
      root: conformanceTarget.root,
      path: conformanceTarget.path,
      bytes: nativeBytes,
      limit: MAX_ARTIFACT_BYTES,
    },
    {
      root: reportTarget.root,
      path: reportTarget.path,
      bytes: reportBytes,
      limit: MAX_ARTIFACT_BYTES,
    },
    parsed.replace,
    hooks,
  );
  sink.stderr(renderCommandReport(report.value));
  return report.value.outcomeExitCode;
}

async function verifySuppliedManifest(
  target: ProjectTarget,
  expected: LoadedSide,
  hooks: CatalogCompareCommandTestHooks,
): Promise<"match" | "invalid" | "mismatch"> {
  const supplied = await readBoundedRegularFile(
    target.path,
    MAX_ARTIFACT_BYTES,
    hooks,
  );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(supplied.bytes);
  } catch {
    return "invalid";
  }
  const parsed = parseJson(text);
  if (!parsed.ok) return "invalid";
  const canonical = canonicalizeJson(parsed.value);
  if (!canonical.ok) return "invalid";
  return `${canonical.value}\n` === expected.manifestText &&
    text === expected.manifestText
    ? "match"
    : "mismatch";
}

function incompleteError(error: unknown): boolean {
  return (
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
        "transaction-commit-incomplete",
        "unsafe-output",
        "unsafe-path",
      ].includes(error.message))
  );
}

function emitReportFallback(
  report: Awaited<ReturnType<typeof makeReport>>,
  sink: MachineSink,
): ReportExitCode {
  if (!report.ok) return 70;
  const serialized = serializeCommandReport(report.value);
  if (!serialized.ok) return 70;
  sink.stdout(serialized.value);
  sink.stderr(renderCommandReport(report.value));
  return report.value.outcomeExitCode;
}

export async function runCatalogCompareCommand(
  args: ReadonlyArray<string>,
  sink: MachineSink,
  hooks: CatalogCompareCommandTestHooks = {},
): Promise<CatalogCompareCommandResult> {
  const parsed = parseArguments(args);
  if (parsed === null) return usageFailure();
  const suiteMode = parsed.suite !== undefined;
  let reportTarget: ProjectTarget | undefined;
  let conformanceTarget: ProjectTarget | undefined;
  let locators: ReadonlyArray<Locator> = [];
  let manifestInputs: ReadonlyArray<
    Readonly<{ side: "left" | "right"; digest: string }>
  > = [];
  let suiteInput: SuiteContext | undefined;
  try {
    const baseResolvedLocators = await Promise.all([
      resolveLocatorPath(parsed.leftCatalog, parsed.projectRoot),
      resolveLocatorPath(parsed.leftPolicy, parsed.projectRoot),
      resolveLocatorPath(parsed.rightCatalog, parsed.projectRoot),
      resolveLocatorPath(parsed.rightPolicy, parsed.projectRoot),
    ]);
    const suiteResolvedLocator =
      parsed.suite === undefined
        ? undefined
        : await resolveLocatorPath(parsed.suite, parsed.projectRoot);
    const resolvedLocators =
      suiteResolvedLocator === undefined
        ? baseResolvedLocators
        : [...baseResolvedLocators, suiteResolvedLocator];
    reportTarget =
      parsed.report === "-"
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.report);
    conformanceTarget =
      parsed.conformanceOut === undefined
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.conformanceOut);
    const leftManifestTarget =
      parsed.leftManifest === undefined
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.leftManifest);
    const rightManifestTarget =
      parsed.rightManifest === undefined
        ? undefined
        : await resolveProjectPath(parsed.projectRoot, parsed.rightManifest);
    const sourcePaths = new Set(
      resolvedLocators.map((locator) => locator.path),
    );
    const artifactPaths = [
      reportTarget?.path,
      conformanceTarget?.path,
      leftManifestTarget?.path,
      rightManifestTarget?.path,
    ].filter((path): path is string => path !== undefined);
    const leftSources = new Set(
      baseResolvedLocators.slice(0, 2).map((locator) => locator.path),
    );
    const rightSources = new Set(
      baseResolvedLocators.slice(2, 4).map((locator) => locator.path),
    );
    const invalidSuiteSourceAlias =
      suiteResolvedLocator !== undefined &&
      ([...leftSources].some((path) => rightSources.has(path)) ||
        leftSources.has(suiteResolvedLocator.path) ||
        rightSources.has(suiteResolvedLocator.path));
    const invalidArtifactAlias =
      artifactPaths.some((path) => sourcePaths.has(path)) ||
      new Set(artifactPaths).size !== artifactPaths.length;
    if (invalidSuiteSourceAlias || invalidArtifactAlias) {
      const diagnostic = [
        controller(
          "INVALID_MANIFEST",
          "Source, manifest, conformance, and report targets must be distinct.",
        ),
      ];
      const report = suiteMode
        ? await makeSuiteReport([], [], undefined, diagnostic, "complete")
        : await makeReport([], [], diagnostic, "complete");
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    }
    const acquisitions = new Map<string, Promise<BoundBytes>>();
    locators = await Promise.all(
      resolvedLocators.map((locator) =>
        acquireLocator(locator, acquisitions, hooks),
      ),
    );
    const modules = await importModules(locators, hooks);
    const leftCatalogLocator = locators[0];
    const leftPolicyLocator = locators[1];
    const rightCatalogLocator = locators[2];
    const rightPolicyLocator = locators[3];
    const suiteLocator = locators[4];
    if (
      leftCatalogLocator === undefined ||
      leftPolicyLocator === undefined ||
      rightCatalogLocator === undefined ||
      rightPolicyLocator === undefined
    )
      throw new Error("locator-invariant-failed");
    const [left, right] = await Promise.all([
      manifestFor(leftCatalogLocator, leftPolicyLocator, modules, hooks),
      manifestFor(rightCatalogLocator, rightPolicyLocator, modules, hooks),
    ]);
    manifestInputs = [
      { side: "left", digest: left.manifest.manifestDigest },
      { side: "right", digest: right.manifest.manifestDigest },
    ];
    const supplied = await Promise.all([
      leftManifestTarget === undefined
        ? "match"
        : verifySuppliedManifest(leftManifestTarget, left, hooks),
      rightManifestTarget === undefined
        ? "match"
        : verifySuppliedManifest(rightManifestTarget, right, hooks),
    ]);
    if (supplied.includes("invalid")) {
      const diagnostic = [
        controller(
          "INVALID_MANIFEST",
          "A supplied catalog manifest is invalid.",
          "catalog-manifest",
        ),
      ];
      const report = suiteMode
        ? await makeSuiteReport(
            locators,
            manifestInputs,
            undefined,
            diagnostic,
            "complete",
          )
        : await makeReport(locators, manifestInputs, diagnostic, "complete");
      return {
        parsed: true,
        exitCode: suiteMode
          ? emitReportFallback(report, sink)
          : await emitReport(parsed, reportTarget, report, sink, hooks),
      };
    }
    if (supplied.includes("mismatch")) {
      const diagnostic = [
        controller(
          "IDENTITY_MISMATCH",
          "A supplied catalog manifest does not match its bound source.",
          "catalog-manifest",
        ),
      ];
      const report = suiteMode
        ? await makeSuiteReport(
            locators,
            manifestInputs,
            undefined,
            diagnostic,
            "complete",
          )
        : await makeReport(locators, manifestInputs, diagnostic, "complete");
      return {
        parsed: true,
        exitCode: suiteMode
          ? emitReportFallback(report, sink)
          : await emitReport(parsed, reportTarget, report, sink, hooks),
      };
    }
    if (!suiteMode) {
      const records = await migrations(await structuralChanges(left, right));
      const report = await makeReport(
        locators,
        manifestInputs,
        [],
        "complete",
        records,
      );
      return {
        parsed: true,
        exitCode: await emitReport(parsed, reportTarget, report, sink, hooks),
      };
    }
    if (
      suiteLocator === undefined ||
      conformanceTarget === undefined ||
      reportTarget === undefined
    )
      throw new Error("locator-invariant-failed");
    const suiteExport = await exported(suiteLocator, modules, hooks);
    const suiteGate = suiteExportGateSchema.safeParse(suiteExport);
    if (!suiteGate.success) {
      const report = await makeSuiteReport(
        locators,
        manifestInputs,
        undefined,
        [
          controller(
            "INVALID_SUITE",
            "The conformance suite export is invalid.",
            "conformance-suite",
          ),
        ],
        "complete",
      );
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    }
    let generator: Awaited<ReturnType<typeof loadGenerator>>;
    try {
      generator = await loadGenerator(hooks);
    } catch {
      throw new Error("generator-load-failed");
    }
    const validatedSuite = generator.catalogConformanceSuiteSchema.safeParse(
      suiteGate.data,
    );
    if (!validatedSuite.success) {
      const report = await makeSuiteReport(
        locators,
        manifestInputs,
        undefined,
        [
          controller(
            "INVALID_SUITE",
            "The conformance suite is schema-invalid.",
            "conformance-suite",
          ),
        ],
        "complete",
      );
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    }
    const suiteDigest = await digestValue(validatedSuite.data);
    if (!suiteDigest.ok) throw new Error("suite-digest-failed");
    suiteInput = { locator: suiteLocator, digest: suiteDigest.value };
    const policyMigrations = await migrations(
      await comparePolicy(left.policy, right.policy),
    );
    hooks.onDiagnosis?.();
    const diagnosed = await generator.diagnoseCatalogsOffline({
      left: left.catalog,
      right: right.catalog,
      suite: validatedSuite.data,
    });
    if (!diagnosed.ok) throw new Error("native-assessment-failed");
    const transformed =
      hooks.transformNativeAssessment?.(diagnosed.value) ?? diagnosed.value;
    const assessment =
      generator.catalogDiagnosticAssessmentSchema.safeParse(transformed);
    if (!assessment.success) throw new Error("native-cardinality-failed");
    const comparison = await comparisonIdentity(
      left.manifest.manifestDigest,
      right.manifest.manifestDigest,
      suiteDigest.value,
    );
    if (assessment.data.kind === "conformant") {
      const verified = await generator.verifyCatalogConformanceReport(
        assessment.data.report,
      );
      const native = assessment.data.report;
      if (
        !verified.ok ||
        native.leftCatalogFingerprint !== left.manifest.catalogFingerprint ||
        native.rightCatalogFingerprint !== right.manifest.catalogFingerprint ||
        native.fixtureDigest !== suiteDigest.value
      ) {
        const report = await makeSuiteReport(
          locators,
          manifestInputs,
          suiteDigest.value,
          [
            controller(
              "IDENTITY_MISMATCH",
              "The native conformance result does not match its bound inputs.",
              "native-conformance-report",
            ),
          ],
          "complete",
        );
        return {
          parsed: true,
          exitCode: emitReportFallback(report, sink),
        };
      }
      const nativeBytes = nativeReportBytes(native);
      const checksum = await sha256(nativeBytes);
      const record = await conformantRecord(comparison, native);
      const report = await makeSuiteReport(
        locators,
        manifestInputs,
        suiteDigest.value,
        [],
        "complete",
        [record],
        policyMigrations,
        [
          {
            id: "native-conformance-report",
            kind: "conformance-report",
            mediaType: "application/json",
            digest: native.reportDigest,
            checksum: { algorithm: "sha256", value: checksum },
          },
        ],
      );
      return {
        parsed: true,
        exitCode: await emitSuitePair(
          parsed,
          reportTarget,
          conformanceTarget,
          report,
          nativeBytes,
          sink,
          hooks,
        ),
      };
    }
    const native = assessment.data.diagnostic;
    const verified = await generator.verifyCatalogConformanceDiagnostic(native);
    if (
      !verified.ok ||
      native.evidence.leftCatalogFingerprint !==
        left.manifest.catalogFingerprint ||
      native.evidence.rightCatalogFingerprint !==
        right.manifest.catalogFingerprint ||
      native.evidence.fixtureDigest !== suiteDigest.value
    ) {
      const report = await makeSuiteReport(
        locators,
        manifestInputs,
        suiteDigest.value,
        [
          controller(
            "IDENTITY_MISMATCH",
            "The native conformance diagnostic does not match its bound inputs.",
            "native-conformance-diagnostic",
          ),
        ],
        "complete",
      );
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    }
    const record = rejectedRecord(comparison, native);
    const semanticMigration = await rejectedMigration(comparison, native);
    const report = await makeSuiteReport(
      locators,
      manifestInputs,
      suiteDigest.value,
      [],
      "complete",
      [record],
      [...policyMigrations, semanticMigration],
    );
    return {
      parsed: true,
      exitCode: await emitReport(parsed, reportTarget, report, sink, hooks),
    };
  } catch (error: unknown) {
    const incomplete = incompleteError(error);
    const errorMessage = error instanceof Error ? error.message : "";
    const invalidPolicy = errorMessage === "invalid-policy";
    const internal = [
      "assessment-identity-failed",
      "command-identity-failed",
      "comparison-digest-failed",
      "comparison-identity-failed",
      "command-serialization-failed",
      "generator-load-failed",
      "locator-binding-failed",
      "locator-invariant-failed",
      "manifest-artifact-digest-failed",
      "manifest-canonicalization-failed",
      "manifest-generation-failed",
      "manifest-invariant-failed",
      "native-assessment-failed",
      "native-canonicalization-failed",
      "native-cardinality-failed",
      "suite-digest-failed",
      "transaction-rollback-failed",
    ].includes(errorMessage);
    const diagnostic = [
      controller(
        internal
          ? "INTERNAL_CONTROLLER_FAILURE"
          : incomplete
            ? "INCOMPLETE_EXECUTION"
            : invalidPolicy
              ? "INVALID_POLICY"
              : "INVALID_CATALOG",
        incomplete
          ? "A bounded file operation could not be completed."
          : internal
            ? suiteMode
              ? "The semantic conformance controller failed an invariant."
              : "The structural comparison controller failed an invariant."
            : invalidPolicy
              ? "A policy export is invalid."
              : "A catalog module, export, or declaration is invalid.",
      ),
    ];
    const report = suiteMode
      ? await makeSuiteReport(
          locators,
          manifestInputs,
          suiteInput?.digest,
          diagnostic,
          incomplete ? "partial" : "complete",
        )
      : await makeReport(
          locators,
          manifestInputs,
          diagnostic,
          incomplete ? "partial" : "complete",
        );
    if (suiteMode)
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    try {
      return {
        parsed: true,
        exitCode: await emitReport(parsed, reportTarget, report, sink, hooks),
      };
    } catch {
      return {
        parsed: true,
        exitCode: emitReportFallback(report, sink),
      };
    }
  }
}
