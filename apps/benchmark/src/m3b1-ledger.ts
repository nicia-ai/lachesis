import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import type { M3bAttemptType } from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

import type {
  M3b1CampaignManifest,
  M3b1PhaseManifest,
} from "./m3b1-manifests.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const accountingBasisSchema = z.enum([
  "provider-reported",
  "not-dispatched",
  "authorized-conservative",
]);
const attemptTypeSchema = z.enum([
  "initial",
  "wire-repair",
  "semantic-repair",
  "transport-retry",
]);
const eventBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("campaign-opened") }),
  z.strictObject({
    kind: z.literal("manifest-registered"),
    phaseManifestDigest: digestSchema,
    experimentDigest: digestSchema,
    budgetPoolId: z.enum(["m3b-development", "m3b-heldout"]),
    storageNamespace: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("reserved"),
    reservationKey: digestSchema,
    phaseManifestDigest: digestSchema,
    experimentDigest: digestSchema,
    budgetPoolId: z.enum(["m3b-development", "m3b-heldout"]),
    billingProvider: z.enum(["openai", "anthropic"]),
    attemptType: attemptTypeSchema.optional(),
    maximumCostUsdMicros: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("settled"),
    reservationKey: digestSchema,
    actualCostUsdMicros: z.number().int().nonnegative(),
    conservative: z.boolean(),
    accountingBasis: accountingBasisSchema,
  }),
]);
const eventSchema = eventBodySchema.and(
  z.strictObject({
    index: z.number().int().nonnegative(),
    previousDigest: digestSchema.nullable(),
    digest: digestSchema,
  }),
);
const headSchema = z.strictObject({
  campaignDigest: digestSchema,
  eventCount: z.number().int().nonnegative(),
  lastDigest: digestSchema.nullable(),
});

type LedgerEvent = z.infer<typeof eventSchema>;
type EventBody = z.infer<typeof eventBodySchema>;
type ReservationEvent = Extract<LedgerEvent, Readonly<{ kind: "reserved" }>>;
type SettlementEvent = Extract<LedgerEvent, Readonly<{ kind: "settled" }>>;
type ReservationState = Readonly<{
  reservation: ReservationEvent;
  settlement?: SettlementEvent | undefined;
}>;
type LedgerState = Readonly<{
  events: ReadonlyArray<LedgerEvent>;
  manifests: ReadonlyMap<string, string>;
  reservations: ReadonlyMap<string, ReservationState>;
}>;

export type M3b1BudgetStatus = Readonly<{
  poolId: "m3b-development" | "m3b-heldout";
  maximumUsdMicros: number;
  consumedUsdMicros: number;
  remainingUsdMicros: number;
  providers: ReadonlyArray<
    Readonly<{
      billingProvider: "openai" | "anthropic";
      maximumUsdMicros: number;
      consumedUsdMicros: number;
      remainingUsdMicros: number;
    }>
  >;
  observedProviderBillingUsdMicros: number;
  authorizedConservativeUsdMicros: number;
}>;

export type M3b1BudgetReservation = Readonly<{
  experimentDigest: string;
  recordKey: string;
  attemptIndex: number;
  billingProvider: "openai" | "anthropic";
  attemptType: M3bAttemptType;
  maximumCostUsdMicros: number;
}>;

export type M3b1BudgetSettlement = M3b1BudgetReservation &
  Readonly<{
    actualCostUsdMicros: number;
    conservative: boolean;
    accountingBasis: z.infer<typeof accountingBasisSchema>;
  }>;

export type M3b1BudgetController = Readonly<{
  reserve: (
    reservation: M3b1BudgetReservation,
  ) => Promise<Result<"reserved" | "previous-attempt-accounted", Diagnostic>>;
  settle: (
    settlement: M3b1BudgetSettlement,
  ) => Promise<Result<void, Diagnostic>>;
}>;

export type M3b1Ledger = Readonly<{
  registerManifest: (
    manifest: M3b1PhaseManifest,
  ) => Promise<Result<void, Diagnostic>>;
  status: (poolId: "m3b-development" | "m3b-heldout") => M3b1BudgetStatus;
  budgetController: (manifest: M3b1PhaseManifest) => M3b1BudgetController;
}>;

const fileErrorSchema = z.looseObject({ code: z.string() });

async function readOptional(
  path: string,
): Promise<Result<string | undefined, Diagnostic>> {
  try {
    return { ok: true, value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    const parsed = fileErrorSchema.safeParse(error);
    return parsed.success && parsed.data.code === "ENOENT"
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Unable to read M3b.1 ledger: ${error instanceof Error ? error.message : String(error)}.`,
          ),
        };
  }
}

async function parseLedger(
  path: string,
  campaign: M3b1CampaignManifest,
): Promise<Result<LedgerState, Diagnostic>> {
  const [ledger, head] = await Promise.all([
    readOptional(path),
    readOptional(`${path}.head`),
  ]);
  if (!ledger.ok) return ledger;
  if (!head.ok) return head;
  if (ledger.value === undefined && head.value === undefined)
    return {
      ok: true,
      value: { events: [], manifests: new Map(), reservations: new Map() },
    };
  if (
    ledger.value === undefined ||
    head.value === undefined ||
    !ledger.value.endsWith("\n")
  )
    return {
      ok: false,
      error: diagnostic(
        "REPLAY_OUTPUT_MISMATCH",
        "M3b.1 ledger or durable head is missing or truncated.",
      ),
    };
  const events: Array<LedgerEvent> = [];
  let prior: string | null = null;
  for (const [index, line] of ledger.value
    .split("\n")
    .filter((candidate) => candidate.length > 0)
    .entries()) {
    const json = parseJson(line);
    if (!json.ok) return json;
    const event = eventSchema.safeParse(json.value);
    if (!event.success)
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          "M3b.1 ledger contains an invalid event.",
        ),
      };
    const { digest, ...body } = event.data;
    const computed = await digestValue(body);
    if (
      !computed.ok ||
      computed.value !== digest ||
      event.data.index !== index ||
      event.data.previousDigest !== prior
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          "M3b.1 ledger chain is corrupted or reordered.",
        ),
      };
    events.push(event.data);
    prior = digest;
  }
  const headJson = parseJson(head.value);
  if (!headJson.ok) return headJson;
  const parsedHead = headSchema.safeParse(headJson.value);
  if (
    !parsedHead.success ||
    parsedHead.data.campaignDigest !== campaign.campaignDigest ||
    parsedHead.data.eventCount !== events.length ||
    parsedHead.data.lastDigest !== prior
  )
    return {
      ok: false,
      error: diagnostic(
        "REPLAY_OUTPUT_MISMATCH",
        "M3b.1 durable head does not match its ledger chain.",
      ),
    };
  const manifests = new Map<string, string>();
  const reservations = new Map<string, ReservationState>();
  for (const event of events) {
    if (event.kind === "manifest-registered") {
      const existing = manifests.get(event.storageNamespace);
      if (existing !== undefined && existing !== event.phaseManifestDigest)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            "M3b.1 storage namespace was rebound to another manifest.",
          ),
        };
      manifests.set(event.storageNamespace, event.phaseManifestDigest);
    } else if (event.kind === "reserved") {
      if (reservations.has(event.reservationKey))
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            "M3b.1 ledger contains a duplicate reservation.",
          ),
        };
      reservations.set(event.reservationKey, { reservation: event });
    } else if (event.kind === "settled") {
      const reservation = reservations.get(event.reservationKey);
      if (reservation === undefined || reservation.settlement !== undefined)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            "M3b.1 ledger contains an unmatched settlement.",
          ),
        };
      reservations.set(event.reservationKey, {
        ...reservation,
        settlement: event,
      });
    }
  }
  return { ok: true, value: { events, manifests, reservations } };
}

async function appendEvent(
  path: string,
  campaign: M3b1CampaignManifest,
  state: LedgerState,
  event: EventBody,
): Promise<Result<LedgerState, Diagnostic>> {
  const body = {
    ...event,
    index: state.events.length,
    previousDigest: state.events.at(-1)?.digest ?? null,
  };
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const complete = eventSchema.parse({ ...body, digest: digest.value });
  const canonical = canonicalizeJson(complete);
  const head = canonicalizeJson({
    campaignDigest: campaign.campaignDigest,
    eventCount: state.events.length + 1,
    lastDigest: digest.value,
  });
  if (!canonical.ok) return canonical;
  if (!head.ok) return head;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, `${canonical.value}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(`${path}.head`, `${head.value}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        `Unable to append M3b.1 ledger: ${error instanceof Error ? error.message : String(error)}.`,
      ),
    };
  }
  return parseLedger(path, campaign);
}

function charged(reservation: ReservationState): number {
  return (
    reservation.settlement?.actualCostUsdMicros ??
    reservation.reservation.maximumCostUsdMicros
  );
}

function poolStatus(
  campaign: M3b1CampaignManifest,
  state: LedgerState,
  poolId: "m3b-development" | "m3b-heldout",
): M3b1BudgetStatus {
  const pool = campaign.budgetPools.find(
    (candidate) => candidate.id === poolId,
  );
  if (pool === undefined) throw new Error(`Unknown M3b.1 pool ${poolId}.`);
  const reservations = [...state.reservations.values()].filter(
    (candidate) => candidate.reservation.budgetPoolId === poolId,
  );
  const consumedUsdMicros = reservations.reduce(
    (total, reservation) => total + charged(reservation),
    0,
  );
  const observedProviderBillingUsdMicros = reservations.reduce(
    (total, reservation) =>
      total +
      (reservation.settlement?.accountingBasis === "provider-reported"
        ? reservation.settlement.actualCostUsdMicros
        : 0),
    0,
  );
  const authorizedConservativeUsdMicros = reservations.reduce(
    (total, reservation) =>
      total +
      (reservation.settlement?.accountingBasis === "authorized-conservative" ||
      reservation.settlement === undefined
        ? charged(reservation)
        : 0),
    0,
  );
  return {
    poolId,
    maximumUsdMicros: pool.maxCostUsdMicros,
    consumedUsdMicros,
    remainingUsdMicros: pool.maxCostUsdMicros - consumedUsdMicros,
    providers: pool.providerCostCaps.map((cap) => {
      const providerConsumed = reservations
        .filter(
          (reservation) =>
            reservation.reservation.billingProvider === cap.billingProvider,
        )
        .reduce((total, reservation) => total + charged(reservation), 0);
      return {
        billingProvider: cap.billingProvider,
        maximumUsdMicros: cap.maxCostUsdMicros,
        consumedUsdMicros: providerConsumed,
        remainingUsdMicros: cap.maxCostUsdMicros - providerConsumed,
      };
    }),
    observedProviderBillingUsdMicros,
    authorizedConservativeUsdMicros,
  };
}

async function reservationKey(
  campaign: M3b1CampaignManifest,
  manifest: M3b1PhaseManifest,
  reservation: M3b1BudgetReservation,
): Promise<Result<string, Diagnostic>> {
  return digestValue({
    campaignDigest: campaign.campaignDigest,
    phaseManifestDigest: manifest.phaseManifestDigest,
    experimentDigest: reservation.experimentDigest,
    recordKey: reservation.recordKey,
    attemptIndex: reservation.attemptIndex,
    billingProvider: reservation.billingProvider,
    attemptType: reservation.attemptType,
  });
}

function quotaForAttempt(
  manifest: M3b1PhaseManifest,
  provider: "openai" | "anthropic",
  attemptType: M3bAttemptType,
): number | undefined {
  const quota = manifest.attemptQuotas.providers.find(
    (candidate) => candidate.provider === provider,
  );
  if (quota === undefined) return undefined;
  switch (attemptType) {
    case "initial":
      return quota.initial;
    case "wire-repair":
      return quota.wireRepair;
    case "semantic-repair":
      return quota.semanticRepair;
    case "transport-retry":
      return quota.transportRetry;
  }
}

export async function inspectM3b1Ledger(input: {
  readonly path: string;
  readonly campaign: M3b1CampaignManifest;
}): Promise<Result<ReadonlyArray<M3b1BudgetStatus>, Diagnostic>> {
  const state = await parseLedger(input.path, input.campaign);
  return state.ok
    ? {
        ok: true,
        value: input.campaign.budgetPools.map((pool) =>
          poolStatus(input.campaign, state.value, pool.id),
        ),
      }
    : state;
}

export async function openM3b1Ledger(input: {
  readonly path: string;
  readonly campaign: M3b1CampaignManifest;
}): Promise<Result<M3b1Ledger, Diagnostic>> {
  let state = await parseLedger(input.path, input.campaign);
  if (!state.ok) return state;
  if (state.value.events.length === 0) {
    state = await appendEvent(input.path, input.campaign, state.value, {
      kind: "campaign-opened",
    });
    if (!state.ok) return state;
  }
  const update = async (
    event: EventBody,
  ): Promise<Result<void, Diagnostic>> => {
    if (!state.ok) return state;
    const next = await appendEvent(
      input.path,
      input.campaign,
      state.value,
      event,
    );
    if (!next.ok) return next;
    state = next;
    return { ok: true, value: undefined };
  };
  const status = (
    poolId: "m3b-development" | "m3b-heldout",
  ): M3b1BudgetStatus => {
    if (!state.ok) throw new Error(state.error.message);
    return poolStatus(input.campaign, state.value, poolId);
  };
  const registerManifest = async (
    manifest: M3b1PhaseManifest,
  ): Promise<Result<void, Diagnostic>> => {
    if (!state.ok) return state;
    const prior = state.value.manifests.get(manifest.storageNamespace);
    if (prior !== undefined)
      return prior === manifest.phaseManifestDigest
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: diagnostic(
              "REPLAY_OUTPUT_MISMATCH",
              "M3b.1 storage namespace is already bound to another manifest.",
            ),
          };
    const current = status(manifest.budgetPoolId);
    const totalFits =
      manifest.theoreticalCeiling.maximumCostUsdMicros <=
      current.remainingUsdMicros;
    const providersFit = manifest.theoreticalCeiling.providers.every(
      (ceiling) => {
        const remaining = current.providers.find(
          (provider) => provider.billingProvider === ceiling.billingProvider,
        );
        return (
          remaining !== undefined &&
          ceiling.maximumCostUsdMicros <= remaining.remainingUsdMicros
        );
      },
    );
    if (!totalFits || !providersFit)
      return {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "The complete M3b.4 phase envelope does not fit the current campaign ledger before manifest registration.",
        ),
      };
    return update({
      kind: "manifest-registered",
      phaseManifestDigest: manifest.phaseManifestDigest,
      experimentDigest: manifest.experimentDigest,
      budgetPoolId: manifest.budgetPoolId,
      storageNamespace: manifest.storageNamespace,
    });
  };
  return {
    ok: true,
    value: {
      registerManifest,
      status,
      budgetController(manifest) {
        return {
          async reserve(reservation) {
            if (!state.ok) return state;
            const registered = await registerManifest(manifest);
            if (!registered.ok) return registered;
            const key = await reservationKey(
              input.campaign,
              manifest,
              reservation,
            );
            if (!key.ok) return key;
            if (state.value.reservations.has(key.value))
              return { ok: true, value: "previous-attempt-accounted" };
            const attemptQuota = quotaForAttempt(
              manifest,
              reservation.billingProvider,
              reservation.attemptType,
            );
            const attemptsAlreadyReserved = [
              ...state.value.reservations.values(),
            ].filter(
              (prior) =>
                prior.reservation.phaseManifestDigest ===
                  manifest.phaseManifestDigest &&
                prior.reservation.billingProvider ===
                  reservation.billingProvider &&
                prior.reservation.attemptType === reservation.attemptType,
            ).length;
            if (
              attemptQuota === undefined ||
              attemptsAlreadyReserved >= attemptQuota
            )
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "M3b.4 provider cohort attempt quota is exhausted before dispatch.",
                ),
              };
            const current = status(manifest.budgetPoolId);
            const provider = current.providers.find(
              (candidate) =>
                candidate.billingProvider === reservation.billingProvider,
            );
            if (
              reservation.maximumCostUsdMicros > current.remainingUsdMicros ||
              provider === undefined ||
              reservation.maximumCostUsdMicros > provider.remainingUsdMicros
            )
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "M3b.1 complete worst-case reservation exceeds the remaining operational pool.",
                ),
              };
            const appended = await update({
              kind: "reserved",
              reservationKey: key.value,
              phaseManifestDigest: manifest.phaseManifestDigest,
              experimentDigest: reservation.experimentDigest,
              budgetPoolId: manifest.budgetPoolId,
              billingProvider: reservation.billingProvider,
              attemptType: reservation.attemptType,
              maximumCostUsdMicros: reservation.maximumCostUsdMicros,
            });
            return appended.ok ? { ok: true, value: "reserved" } : appended;
          },
          async settle(settlement) {
            if (!state.ok) return state;
            const key = await reservationKey(
              input.campaign,
              manifest,
              settlement,
            );
            if (!key.ok) return key;
            const reservation = state.value.reservations.get(key.value);
            if (
              reservation === undefined ||
              reservation.settlement !== undefined ||
              settlement.actualCostUsdMicros >
                reservation.reservation.maximumCostUsdMicros
            )
              return {
                ok: false,
                error: diagnostic(
                  "REPLAY_OUTPUT_MISMATCH",
                  "M3b.1 settlement is missing, duplicated, or exceeds its reservation.",
                ),
              };
            return update({
              kind: "settled",
              reservationKey: key.value,
              actualCostUsdMicros: settlement.actualCostUsdMicros,
              conservative: settlement.conservative,
              accountingBasis: settlement.accountingBasis,
            });
          },
        };
      },
    },
  };
}
