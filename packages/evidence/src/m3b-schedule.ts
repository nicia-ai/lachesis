import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const m3bArmSchema = z.enum([
  "lexical-facts",
  "graph-facts",
  "graph-adjacency",
  "graph-typed",
]);

export type M3bArm = z.infer<typeof m3bArmSchema>;

const armOrderSchema = z
  .tuple([m3bArmSchema, m3bArmSchema, m3bArmSchema, m3bArmSchema])
  .readonly();

const scheduleEntrySchema = z
  .strictObject({
    unitDigest: z.string().regex(/^[a-f0-9]{64}$/),
    caseId: z.string().min(1),
    caseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.string().min(1),
    model: z.string().min(1),
    repetition: z.number().int().nonnegative(),
    sequenceIndex: z.number().int().min(0).max(3),
    order: armOrderSchema,
  })
  .readonly();

export const m3bWilliamsScheduleSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    algorithm: z.literal(
      "sha256-provider-repetition-balanced-williams-four-arm-v1",
    ),
    entries: z.array(scheduleEntrySchema).min(1).readonly(),
    scheduleDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .readonly();

export type M3bScheduleEntry = z.infer<typeof scheduleEntrySchema>;
export type M3bWilliamsSchedule = z.infer<typeof m3bWilliamsScheduleSchema>;

export const M3B_WILLIAMS_SEQUENCES: ReadonlyArray<M3bScheduleEntry["order"]> =
  Object.freeze([
    ["lexical-facts", "graph-facts", "graph-typed", "graph-adjacency"],
    ["graph-facts", "graph-adjacency", "lexical-facts", "graph-typed"],
    ["graph-adjacency", "graph-typed", "graph-facts", "lexical-facts"],
    ["graph-typed", "lexical-facts", "graph-adjacency", "graph-facts"],
  ]);

type ScheduleCase = Readonly<{ id: string; digest: string }>;
type ScheduleProvider = Readonly<{ provider: string; model: string }>;

function providerKey(provider: ScheduleProvider): string {
  return `${provider.provider}\u0000${provider.model}`;
}

export async function createM3bWilliamsSchedule(
  input: Readonly<{
    cases: ReadonlyArray<ScheduleCase>;
    providers: ReadonlyArray<ScheduleProvider>;
    repetitions: number;
  }>,
): Promise<Result<M3bWilliamsSchedule, Diagnostic>> {
  if (
    input.cases.length === 0 ||
    input.providers.length === 0 ||
    !Number.isSafeInteger(input.repetitions) ||
    input.repetitions <= 0
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M3b scheduling requires cases, providers, and positive repetitions.",
      ),
    };
  const providers = input.providers.toSorted((left, right) =>
    providerKey(left).localeCompare(providerKey(right)),
  );
  if (new Set(providers.map(providerKey)).size !== providers.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M3b scheduling requires unique provider/model pairs.",
      ),
    };
  const entries: Array<M3bScheduleEntry> = [];
  for (const provider of providers)
    for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
      const seeded = [];
      for (const benchmarkCase of input.cases) {
        const unit = {
          caseId: benchmarkCase.id,
          caseDigest: benchmarkCase.digest,
          provider: provider.provider,
          model: provider.model,
          repetition,
        };
        const digest = await digestValue(unit);
        if (!digest.ok) return digest;
        seeded.push({ ...unit, unitDigest: digest.value });
      }
      const ordered = seeded.toSorted((left, right) =>
        left.unitDigest.localeCompare(right.unitDigest),
      );
      const offset =
        Number.parseInt(ordered[0]?.unitDigest.slice(0, 2) ?? "0", 16) % 4;
      for (const [index, unit] of ordered.entries()) {
        const sequenceIndex = (index + offset) % 4;
        const order = M3B_WILLIAMS_SEQUENCES[sequenceIndex];
        if (order === undefined)
          return {
            ok: false,
            error: diagnostic(
              "INTERNAL_INVARIANT_VIOLATION",
              "M3b Williams sequence assignment failed.",
            ),
          };
        entries.push({ ...unit, sequenceIndex, order });
      }
    }
  const body = {
    formatVersion: "1" as const,
    algorithm:
      "sha256-provider-repetition-balanced-williams-four-arm-v1" as const,
    entries: entries.toSorted((left, right) =>
      left.unitDigest.localeCompare(right.unitDigest),
    ),
  };
  const digest = await digestValue(body);
  return digest.ok
    ? {
        ok: true,
        value: m3bWilliamsScheduleSchema.parse({
          ...body,
          scheduleDigest: digest.value,
        }),
      }
    : digest;
}

export type M3bScheduleAudit = Readonly<{
  strata: number;
  positionImbalanceMaximum: number;
  predecessorImbalanceMaximum: number;
  passed: boolean;
}>;

export function auditM3bWilliamsSchedule(
  schedule: M3bWilliamsSchedule,
): M3bScheduleAudit {
  const strata = new Map<string, Array<M3bScheduleEntry>>();
  for (const entry of schedule.entries) {
    const key = `${entry.provider}\u0000${entry.model}\u0000${entry.repetition}`;
    const values = strata.get(key) ?? [];
    values.push(entry);
    strata.set(key, values);
  }
  let positionImbalanceMaximum = 0;
  let predecessorImbalanceMaximum = 0;
  for (const entries of strata.values()) {
    const positions = new Map<string, number>();
    const predecessors = new Map<string, number>();
    for (const entry of entries) {
      for (const [position, arm] of entry.order.entries())
        positions.set(
          `${position}:${arm}`,
          (positions.get(`${position}:${arm}`) ?? 0) + 1,
        );
      for (let position = 1; position < entry.order.length; position += 1) {
        const prior = entry.order[position - 1];
        const current = entry.order[position];
        if (prior !== undefined && current !== undefined)
          predecessors.set(
            `${prior}:${current}`,
            (predecessors.get(`${prior}:${current}`) ?? 0) + 1,
          );
      }
    }
    const positionValues = [...positions.values()];
    const predecessorValues = [...predecessors.values()];
    const expectedFloor = Math.floor(entries.length / 4);
    positionImbalanceMaximum = Math.max(
      positionImbalanceMaximum,
      ...positionValues.map((value) => Math.abs(value - expectedFloor)),
    );
    predecessorImbalanceMaximum = Math.max(
      predecessorImbalanceMaximum,
      ...predecessorValues.map((value) => Math.abs(value - expectedFloor)),
    );
  }
  return {
    strata: strata.size,
    positionImbalanceMaximum,
    predecessorImbalanceMaximum,
    passed: positionImbalanceMaximum <= 1 && predecessorImbalanceMaximum <= 1,
  };
}
