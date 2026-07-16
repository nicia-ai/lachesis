import {
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import type { FrozenPlanGenerationCase } from "./case.js";
import {
  type GenerationStrategy,
  type InferenceSettings,
  inferenceSettingsSchema,
  type ModelIdentity,
} from "./model.js";
import {
  type PricingSnapshot,
  pricingSnapshotSchema,
  verifyPricingSnapshot,
} from "./pricing.js";
import { generationStrategySchema, modelIdentitySchema } from "./records.js";
import {
  PORTABLE_TRANSPORT_COMPILER_VERSION,
  SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS,
} from "./transport.js";

export const benchmarkSplitSchema = z.enum([
  "development",
  "heldout-catalog",
  "heldout-operator-combination",
  "heldout-phrasing",
]);

export type BenchmarkSplit = z.infer<typeof benchmarkSplitSchema>;

const experimentCaseSchema = z
  .strictObject({
    id: z.string().min(1),
    caseDigest: z.string().min(1),
    split: benchmarkSplitSchema,
  })
  .readonly();

const experimentSplitSchema = z
  .strictObject({
    id: benchmarkSplitSchema,
    caseDigests: z.array(z.string().min(1)).readonly(),
    digest: z.string().min(1),
  })
  .readonly();

const experimentMethodSchema = z
  .strictObject({
    id: z.string().min(1),
    model: modelIdentitySchema,
    strategy: generationStrategySchema,
    inference: inferenceSettingsSchema,
    pricingEntryId: z.string().min(1),
    modelConfigurationDigest: z.string().min(1),
  })
  .readonly();

const experimentTransportSchemaBindingSchema = z
  .strictObject({
    caseDigest: z.string().min(1),
    methodId: z.string().min(1),
    manifestDigest: z.string().min(1),
    compilerVersion: z.string().min(1),
    schemaDigest: z.string().min(1),
  })
  .readonly();

const experimentCapsSchema = z
  .strictObject({
    maxCalls: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxTotalTokens: z.number().int().positive(),
    maxOutputTokensPerCall: z.number().int().positive(),
    maxCostUsdMicros: z.number().int().positive(),
    providerCostCaps: z
      .array(
        z
          .strictObject({
            billingProvider: z.string().min(1),
            maxCostUsdMicros: z.number().int().positive(),
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly();

const experimentVersionsSchema = z
  .strictObject({
    gitCommit: z.string().min(1),
    workspaceVersion: z.string().min(1),
    kernelVersion: z.string().min(1),
    generatorVersion: z.string().min(1),
  })
  .readonly();

export const experimentManifestSchema = z
  .strictObject({
    formatVersion: z.enum(["2", "3", "4"]),
    promptDigest: z.string().min(1),
    protocolDigest: z.string().min(1),
    cases: z.array(experimentCaseSchema).min(1).readonly(),
    caseSetDigest: z.string().min(1),
    splits: z.array(experimentSplitSchema).min(1).readonly(),
    methods: z.array(experimentMethodSchema).min(1).readonly(),
    transportSchemas: z
      .array(experimentTransportSchemaBindingSchema)
      .readonly()
      .optional(),
    pricingSnapshot: pricingSnapshotSchema,
    repetitions: z.number().int().positive(),
    caps: experimentCapsSchema,
    versions: experimentVersionsSchema,
    experimentDigest: z.string().min(1),
  })
  .readonly();

export type ExperimentCaps = z.infer<typeof experimentCapsSchema>;
export type ExperimentVersions = z.infer<typeof experimentVersionsSchema>;
export type ExperimentMethod = z.infer<typeof experimentMethodSchema>;
export type ExperimentTransportSchemaBinding = z.infer<
  typeof experimentTransportSchemaBindingSchema
>;
export type ExperimentManifest = z.infer<typeof experimentManifestSchema>;

export type ExperimentMethodInput = Readonly<{
  id: string;
  model: ModelIdentity;
  strategy: GenerationStrategy;
  inference: InferenceSettings;
  pricingEntryId: string;
}>;

export type ExperimentManifestInput = Readonly<{
  prompt: unknown;
  protocol: unknown;
  cases: ReadonlyArray<
    Readonly<{
      frozenCase: FrozenPlanGenerationCase;
      split: BenchmarkSplit;
    }>
  >;
  methods: ReadonlyArray<ExperimentMethodInput>;
  transportSchemas: ReadonlyArray<ExperimentTransportSchemaBinding>;
  pricingSnapshot: PricingSnapshot;
  repetitions: number;
  caps: ExperimentCaps;
  versions: ExperimentVersions;
}>;

const SPLITS: ReadonlyArray<BenchmarkSplit> = [
  "development",
  "heldout-catalog",
  "heldout-operator-combination",
  "heldout-phrasing",
];

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function schemaDiagnostics(error: z.ZodError): Diagnostics {
  return error.issues.map((issue) => {
    const path = issue.path.map((part) =>
      typeof part === "symbol" ? String(part) : part,
    );
    return diagnostic(
      "INVALID_WIRE_SCHEMA",
      `Invalid experiment manifest: ${issue.message}`,
      { path },
      [],
      { repair: { path } },
    );
  });
}

async function modelConfigurationDigest(
  method: ExperimentMethodInput,
  formatVersion: "2" | "3" | "4",
): Promise<Result<string, Diagnostic>> {
  const legacy = {
    model: method.model,
    temperature: method.inference.temperature,
    seed: method.inference.seed,
    reasoningSettings: method.inference.reasoningSettings,
    maxInputTokens: method.inference.maxInputTokens,
    maxOutputTokens: method.inference.maxOutputTokens,
  };
  return digestValue(
    formatVersion === "2"
      ? legacy
      : {
          ...legacy,
          structuredOutputMode: method.inference.structuredOutputMode,
          structuredOutputTransport: method.inference.structuredOutputTransport,
        },
  );
}

function transportBindingsAreValid(
  cases: ReadonlyArray<z.infer<typeof experimentCaseSchema>>,
  methods: ReadonlyArray<ExperimentMethodInput>,
  bindings: ReadonlyArray<ExperimentTransportSchemaBinding>,
  supportedCompilerVersions: ReadonlyArray<string> = [
    PORTABLE_TRANSPORT_COMPILER_VERSION,
  ],
): boolean {
  const expected = cases.flatMap((benchmarkCase) =>
    methods
      .filter((method) => method.strategy.constraint === "json-schema")
      .map((method) => `${benchmarkCase.caseDigest}\u0000${method.id}`),
  );
  const actual = bindings.map(
    (binding) => `${binding.caseDigest}\u0000${binding.methodId}`,
  );
  const compilerVersions = new Set(
    bindings.map((binding) => binding.compilerVersion),
  );
  return (
    duplicate(actual) === undefined &&
    expected.length === actual.length &&
    expected.every((key) => actual.includes(key)) &&
    compilerVersions.size === 1 &&
    [...compilerVersions].every((version) =>
      supportedCompilerVersions.includes(version),
    )
  );
}

function duplicate(values: ReadonlyArray<string>): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function sameStrings(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function methodModeIsValid(
  method: ExperimentMethodInput,
  requireTransport: boolean,
): boolean {
  const modeMatches =
    method.strategy.constraint === "unconstrained-json"
      ? method.inference.structuredOutputMode === "none"
      : method.inference.structuredOutputMode !== "none";
  return (
    modeMatches &&
    (!requireTransport ||
      method.inference.structuredOutputTransport !== undefined)
  );
}

function pricingBindingsAreValid(
  methods: ReadonlyArray<ExperimentMethodInput>,
  pricingSnapshot: PricingSnapshot,
  caps: ExperimentCaps,
): boolean {
  const entries = new Map(
    pricingSnapshot.entries.map((entry) => [entry.id, entry]),
  );
  const providers = new Set(
    caps.providerCostCaps.map((cap) => cap.billingProvider),
  );
  return methods.every((method) => {
    const entry = entries.get(method.pricingEntryId);
    return entry !== undefined && providers.has(entry.billingProvider);
  });
}

export async function createExperimentManifest(
  input: ExperimentManifestInput,
): Promise<Result<ExperimentManifest, Diagnostics>> {
  const duplicateCase = duplicate(
    input.cases.map((item) => item.frozenCase.case.id),
  );
  const duplicateMethod = duplicate(input.methods.map((method) => method.id));
  if (duplicateCase !== undefined || duplicateMethod !== undefined) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          duplicateCase === undefined
            ? `Duplicate experiment method ${duplicateMethod}.`
            : `Duplicate experiment case ${duplicateCase}.`,
        ),
      ],
    };
  }
  const invalidMode = input.methods.find(
    (method) => !methodModeIsValid(method, true),
  );
  if (invalidMode !== undefined) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Method ${invalidMode.id} has an incompatible structured-output mode.`,
        ),
      ],
    };
  }
  const pricing = await verifyPricingSnapshot(input.pricingSnapshot);
  if (!pricing.ok) return pricing;
  const duplicateProviderCap = duplicate(
    input.caps.providerCostCaps.map((cap) => cap.billingProvider),
  );
  if (
    duplicateProviderCap !== undefined ||
    !pricingBindingsAreValid(input.methods, pricing.value, input.caps)
  ) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          duplicateProviderCap === undefined
            ? "Every experiment method must reference a priced model with a provider cost cap."
            : `Duplicate provider cost cap ${duplicateProviderCap}.`,
        ),
      ],
    };
  }
  const cases = input.cases
    .map((item) => ({
      id: item.frozenCase.case.id,
      caseDigest: item.frozenCase.digest,
      split: item.split,
    }))
    .toSorted((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  const caseSetDigest = await digestValue(cases);
  if (!caseSetDigest.ok) return { ok: false, error: [caseSetDigest.error] };
  const promptDigest = await digestValue(input.prompt);
  if (!promptDigest.ok) return { ok: false, error: [promptDigest.error] };
  const protocolDigest = await digestValue(input.protocol);
  if (!protocolDigest.ok) return { ok: false, error: [protocolDigest.error] };
  const splits: Array<z.infer<typeof experimentSplitSchema>> = [];
  for (const id of SPLITS) {
    const caseDigests = cases
      .filter((item) => item.split === id)
      .map((item) => item.caseDigest)
      .toSorted();
    const digest = await digestValue({ id, caseDigests });
    if (!digest.ok) return { ok: false, error: [digest.error] };
    splits.push({ id, caseDigests, digest: digest.value });
  }
  const methods: Array<ExperimentMethod> = [];
  for (const method of input.methods) {
    const digest = await modelConfigurationDigest(method, "4");
    if (!digest.ok) return { ok: false, error: [digest.error] };
    methods.push({
      ...method,
      modelConfigurationDigest: digest.value,
    });
  }
  methods.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const transportSchemas = [...input.transportSchemas].toSorted(
    (left, right) => {
      const leftKey = `${left.caseDigest}\u0000${left.methodId}`;
      const rightKey = `${right.caseDigest}\u0000${right.methodId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    },
  );
  if (!transportBindingsAreValid(cases, methods, transportSchemas))
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment transport-schema bindings are incomplete or inconsistent.",
        ),
      ],
    };
  const formatVersion = "4";
  const body = {
    formatVersion,
    promptDigest: promptDigest.value,
    protocolDigest: protocolDigest.value,
    cases,
    caseSetDigest: caseSetDigest.value,
    splits,
    methods,
    transportSchemas,
    pricingSnapshot: pricing.value,
    repetitions: input.repetitions,
    caps: input.caps,
    versions: input.versions,
  };
  const parsed = experimentManifestSchema
    .unwrap()
    .omit({ experimentDigest: true })
    .safeParse(body);
  if (!parsed.success)
    return { ok: false, error: schemaDiagnostics(parsed.error) };
  const digest = await digestValue(parsed.data);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  const manifest = experimentManifestSchema.parse({
    ...parsed.data,
    experimentDigest: digest.value,
  });
  deepFreeze(manifest);
  return { ok: true, value: manifest };
}

export async function verifyExperimentManifest(
  value: unknown,
): Promise<Result<ExperimentManifest, Diagnostics>> {
  const parsed = experimentManifestSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false, error: schemaDiagnostics(parsed.error) };
  const { experimentDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  if (digest.value !== experimentDigest) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment manifest failed its content digest.",
        ),
      ],
    };
  }
  const pricing = await verifyPricingSnapshot(parsed.data.pricingSnapshot);
  if (!pricing.ok) return pricing;
  const duplicateCase = duplicate(parsed.data.cases.map((item) => item.id));
  const duplicateMethod = duplicate(parsed.data.methods.map((item) => item.id));
  const caseSetDigest = await digestValue(parsed.data.cases);
  if (!caseSetDigest.ok) return { ok: false, error: [caseSetDigest.error] };
  if (
    duplicateCase !== undefined ||
    duplicateMethod !== undefined ||
    caseSetDigest.value !== parsed.data.caseSetDigest
  ) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment manifest has inconsistent case or method identity.",
        ),
      ],
    };
  }
  for (const id of SPLITS) {
    const split = parsed.data.splits.find((item) => item.id === id);
    const expectedCaseDigests = parsed.data.cases
      .filter((item) => item.split === id)
      .map((item) => item.caseDigest)
      .toSorted();
    if (
      split === undefined ||
      !sameStrings(split.caseDigests, expectedCaseDigests)
    ) {
      return {
        ok: false,
        error: [
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Experiment split ${id} is inconsistent with its cases.`,
          ),
        ],
      };
    }
    const splitDigest = await digestValue({
      id,
      caseDigests: expectedCaseDigests,
    });
    if (!splitDigest.ok) return { ok: false, error: [splitDigest.error] };
    if (splitDigest.value !== split.digest) {
      return {
        ok: false,
        error: [
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Experiment split ${id} failed its content digest.`,
          ),
        ],
      };
    }
  }
  if (parsed.data.splits.length !== SPLITS.length) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment manifest must contain every split exactly once.",
        ),
      ],
    };
  }
  for (const method of parsed.data.methods) {
    if (
      !methodModeIsValid(
        method,
        parsed.data.formatVersion === "3" || parsed.data.formatVersion === "4",
      )
    ) {
      return {
        ok: false,
        error: [
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Method ${method.id} has an incompatible structured-output mode.`,
          ),
        ],
      };
    }
    const methodDigest = await modelConfigurationDigest(
      method,
      parsed.data.formatVersion,
    );
    if (!methodDigest.ok) return { ok: false, error: [methodDigest.error] };
    if (methodDigest.value !== method.modelConfigurationDigest) {
      return {
        ok: false,
        error: [
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Method ${method.id} failed its model-configuration digest.`,
          ),
        ],
      };
    }
  }
  if (
    parsed.data.formatVersion === "4" &&
    (parsed.data.transportSchemas === undefined ||
      !transportBindingsAreValid(
        parsed.data.cases,
        parsed.data.methods,
        parsed.data.transportSchemas,
        SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS,
      ))
  )
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment transport-schema bindings failed verification.",
        ),
      ],
    };
  if (
    duplicate(
      parsed.data.caps.providerCostCaps.map((cap) => cap.billingProvider),
    ) !== undefined ||
    !pricingBindingsAreValid(
      parsed.data.methods,
      pricing.value,
      parsed.data.caps,
    )
  ) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Experiment pricing or provider-cap bindings are inconsistent.",
        ),
      ],
    };
  }
  deepFreeze(parsed.data);
  return { ok: true, value: parsed.data };
}
