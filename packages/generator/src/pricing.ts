import {
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const pricingEntrySchema = z
  .strictObject({
    id: z.string().min(1),
    billingProvider: z.string().min(1),
    route: z.string().min(1),
    model: z.string().min(1),
    inputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    cachedInputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    cacheWriteInputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    outputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    effectiveFrom: z.iso.date(),
    effectiveUntil: z.iso.date().nullable(),
    sourceUrl: z.url(),
  })
  .readonly();

export type PricingEntry = z.infer<typeof pricingEntrySchema>;

export const pricingSnapshotSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    capturedAt: z.iso.datetime({ offset: true }),
    currency: z.literal("USD"),
    entries: z.array(pricingEntrySchema).min(1).readonly(),
    digest: z.string().min(1),
  })
  .readonly();

export type PricingSnapshot = z.infer<typeof pricingSnapshotSchema>;

export type PricingSnapshotInput = Readonly<{
  capturedAt: string;
  entries: ReadonlyArray<PricingEntry>;
}>;

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function schemaDiagnostics(error: z.ZodError): Diagnostics {
  return error.issues.map((issue) =>
    diagnostic(
      "INVALID_WIRE_SCHEMA",
      `Invalid pricing snapshot: ${issue.message}`,
      {
        path: issue.path.map((part) =>
          typeof part === "symbol" ? String(part) : part,
        ),
      },
    ),
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

export async function createPricingSnapshot(
  input: PricingSnapshotInput,
): Promise<Result<PricingSnapshot, Diagnostics>> {
  const entries = input.entries.toSorted((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const duplicateId = duplicate(entries.map((entry) => entry.id));
  if (duplicateId !== undefined) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Duplicate pricing entry ${duplicateId}.`,
        ),
      ],
    };
  }
  const body = {
    formatVersion: "1" as const,
    capturedAt: input.capturedAt,
    currency: "USD" as const,
    entries,
  };
  const parsed = pricingSnapshotSchema
    .unwrap()
    .omit({ digest: true })
    .safeParse(body);
  if (!parsed.success)
    return { ok: false, error: schemaDiagnostics(parsed.error) };
  const digest = await digestValue(parsed.data);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  const snapshot = pricingSnapshotSchema.parse({
    ...parsed.data,
    digest: digest.value,
  });
  deepFreeze(snapshot);
  return { ok: true, value: snapshot };
}

export async function verifyPricingSnapshot(
  value: unknown,
): Promise<Result<PricingSnapshot, Diagnostics>> {
  const parsed = pricingSnapshotSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false, error: schemaDiagnostics(parsed.error) };
  const duplicateId = duplicate(parsed.data.entries.map((entry) => entry.id));
  if (duplicateId !== undefined) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Duplicate pricing entry ${duplicateId}.`,
        ),
      ],
    };
  }
  const { digest: expected, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  if (digest.value !== expected) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Pricing snapshot failed its content digest.",
        ),
      ],
    };
  }
  deepFreeze(parsed.data);
  return { ok: true, value: parsed.data };
}

function tokenCharge(tokens: number, rate: number): number {
  return Math.ceil((tokens * rate) / 1_000_000);
}

export function calculateCostUsdMicros(
  entry: PricingEntry,
  usage: Readonly<{
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
  }>,
): Result<number, Diagnostic> {
  const values = [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.cacheWriteInputTokens,
    usage.outputTokens,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    usage.cachedInputTokens + usage.cacheWriteInputTokens > usage.inputTokens
  ) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Token usage must contain nonnegative safe integers and cached input cannot exceed total input.",
      ),
    };
  }
  const uncachedInputTokens =
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens;
  const cost =
    tokenCharge(uncachedInputTokens, entry.inputUsdMicrosPerMillionTokens) +
    tokenCharge(
      usage.cachedInputTokens,
      entry.cachedInputUsdMicrosPerMillionTokens,
    ) +
    tokenCharge(
      usage.cacheWriteInputTokens,
      entry.cacheWriteInputUsdMicrosPerMillionTokens,
    ) +
    tokenCharge(usage.outputTokens, entry.outputUsdMicrosPerMillionTokens);
  return Number.isSafeInteger(cost)
    ? { ok: true, value: cost }
    : {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "Calculated model cost exceeds the safe integer range.",
        ),
      };
}

export function calculateMaximumCostUsdMicros(
  entry: PricingEntry,
  inputTokens: number,
  outputTokens: number,
): Result<number, Diagnostic> {
  const maximumInputRate = Math.max(
    entry.inputUsdMicrosPerMillionTokens,
    entry.cachedInputUsdMicrosPerMillionTokens,
    entry.cacheWriteInputUsdMicrosPerMillionTokens,
  );
  return calculateCostUsdMicros(
    { ...entry, inputUsdMicrosPerMillionTokens: maximumInputRate },
    {
      inputTokens,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens,
    },
  );
}
