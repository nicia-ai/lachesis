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
import { z } from "zod";

import type { M5bCampaignManifest, M5bPhaseManifest } from "./m5b-manifests.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const providerSchema = z.enum(["openai", "anthropic"]);
const attemptTypeSchema = z.enum([
  "initial",
  "wire-repair",
  "semantic-repair",
  "transport-retry",
]);
const accountingBasisSchema = z.enum([
  "provider-reported",
  "not-dispatched",
  "authorized-conservative",
]);

const eventBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("campaign-opened") }),
  z.strictObject({
    kind: z.literal("manifest-registered"),
    phaseManifestDigest: digestSchema,
    experimentDigest: digestSchema,
    storageNamespace: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("reserved"),
    reservationKey: digestSchema,
    phaseManifestDigest: digestSchema,
    experimentDigest: digestSchema,
    recordKey: digestSchema,
    billingProvider: providerSchema,
    attemptType: attemptTypeSchema,
    attemptIndex: z.number().int().nonnegative(),
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

const headSchema = z
  .strictObject({
    campaignDigest: digestSchema,
    eventCount: z.number().int().nonnegative(),
    lastDigest: digestSchema.nullable(),
  })
  .readonly();

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

export type M5bAttemptType = z.infer<typeof attemptTypeSchema>;
export type M5bAccountingBasis = z.infer<typeof accountingBasisSchema>;

export type M5bBudgetStatus = Readonly<{
  maximumUsdMicros: number;
  consumedUsdMicros: number;
  remainingUsdMicros: number;
  eventCount: number;
  ledgerHead: string | null;
  observedProviderBillingUsdMicros: number;
  authorizedConservativeUsdMicros: number;
  unsettledReservationUsdMicros: number;
  providers: ReadonlyArray<
    Readonly<{
      billingProvider: "openai" | "anthropic";
      maximumUsdMicros: number;
      consumedUsdMicros: number;
      remainingUsdMicros: number;
    }>
  >;
}>;

export type M5bBudgetReservation = Readonly<{
  experimentDigest: string;
  recordKey: string;
  attemptIndex: number;
  billingProvider: "openai" | "anthropic";
  attemptType: M5bAttemptType;
  maximumCostUsdMicros: number;
}>;

export type M5bBudgetSettlement = M5bBudgetReservation &
  Readonly<{
    actualCostUsdMicros: number;
    conservative: boolean;
    accountingBasis: M5bAccountingBasis;
  }>;

export type M5bBudgetController = Readonly<{
  reserve: (
    reservation: M5bBudgetReservation,
  ) => Promise<Result<"reserved" | "previous-attempt-accounted", Diagnostic>>;
  settle: (
    settlement: M5bBudgetSettlement,
  ) => Promise<Result<void, Diagnostic>>;
}>;

export type M5bLedger = Readonly<{
  registerManifest: (
    manifest: M5bPhaseManifest,
  ) => Promise<Result<void, Diagnostic>>;
  status: () => M5bBudgetStatus;
  budgetController: (manifest: M5bPhaseManifest) => M5bBudgetController;
}>;

const fileErrorSchema = z.looseObject({ code: z.string() });

function failure(message: string): Diagnostic {
  return diagnostic("REPLAY_OUTPUT_MISMATCH", message);
}

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
          error: failure(
            `Unable to read M5b ledger: ${error instanceof Error ? error.name : "unknown-error"}.`,
          ),
        };
  }
}

async function parseLedger(
  path: string,
  campaign: M5bCampaignManifest,
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
      error: failure("M5b ledger or durable head is missing or truncated."),
    };
  const events: Array<LedgerEvent> = [];
  let previousDigest: string | null = null;
  for (const [index, line] of ledger.value
    .split("\n")
    .filter((candidate) => candidate.length > 0)
    .entries()) {
    const json = parseJson(line);
    if (!json.ok) return json;
    const parsed = eventSchema.safeParse(json.value);
    if (!parsed.success)
      return { ok: false, error: failure("M5b ledger event is invalid.") };
    const { digest, ...body } = parsed.data;
    const computed = await digestValue(body);
    if (
      !computed.ok ||
      computed.value !== digest ||
      parsed.data.index !== index ||
      parsed.data.previousDigest !== previousDigest
    )
      return {
        ok: false,
        error: failure("M5b ledger chain is corrupted or reordered."),
      };
    events.push(parsed.data);
    previousDigest = digest;
  }
  const headJson = parseJson(head.value);
  if (!headJson.ok) return headJson;
  const parsedHead = headSchema.safeParse(headJson.value);
  if (
    !parsedHead.success ||
    parsedHead.data.campaignDigest !== campaign.campaignDigest ||
    parsedHead.data.eventCount !== events.length ||
    parsedHead.data.lastDigest !== previousDigest
  )
    return {
      ok: false,
      error: failure("M5b durable head does not match its ledger chain."),
    };
  const manifests = new Map<string, string>();
  const reservations = new Map<string, ReservationState>();
  for (const event of events) {
    if (event.kind === "manifest-registered") {
      const prior = manifests.get(event.storageNamespace);
      if (prior !== undefined && prior !== event.phaseManifestDigest)
        return {
          ok: false,
          error: failure("M5b namespace was rebound to another manifest."),
        };
      manifests.set(event.storageNamespace, event.phaseManifestDigest);
    } else if (event.kind === "reserved") {
      if (reservations.has(event.reservationKey))
        return {
          ok: false,
          error: failure("M5b ledger contains a duplicate reservation."),
        };
      reservations.set(event.reservationKey, { reservation: event });
    } else if (event.kind === "settled") {
      const reservation = reservations.get(event.reservationKey);
      if (reservation === undefined || reservation.settlement !== undefined)
        return {
          ok: false,
          error: failure("M5b ledger contains an unmatched settlement."),
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
  campaign: M5bCampaignManifest,
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
      error: failure(
        `Unable to append M5b ledger: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
  return parseLedger(path, campaign);
}

function charged(state: ReservationState): number {
  return (
    state.settlement?.actualCostUsdMicros ??
    state.reservation.maximumCostUsdMicros
  );
}

function status(
  campaign: M5bCampaignManifest,
  state: LedgerState,
): M5bBudgetStatus {
  const reservations = [...state.reservations.values()];
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
      (reservation.settlement?.accountingBasis === "authorized-conservative"
        ? reservation.settlement.actualCostUsdMicros
        : 0),
    0,
  );
  const unsettledReservationUsdMicros = reservations.reduce(
    (total, reservation) =>
      total +
      (reservation.settlement === undefined
        ? reservation.reservation.maximumCostUsdMicros
        : 0),
    0,
  );
  return {
    maximumUsdMicros: campaign.budgetPool.maxCostUsdMicros,
    consumedUsdMicros,
    remainingUsdMicros:
      campaign.budgetPool.maxCostUsdMicros - consumedUsdMicros,
    eventCount: state.events.length,
    ledgerHead: state.events.at(-1)?.digest ?? null,
    observedProviderBillingUsdMicros,
    authorizedConservativeUsdMicros,
    unsettledReservationUsdMicros,
    providers: campaign.budgetPool.providerCostCaps.map((cap) => {
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
  };
}

async function reservationKey(
  campaign: M5bCampaignManifest,
  manifest: M5bPhaseManifest,
  reservation: M5bBudgetReservation,
): Promise<Result<string, Diagnostic>> {
  return digestValue({
    campaignDigest: campaign.campaignDigest,
    phaseManifestDigest: manifest.phaseManifestDigest,
    experimentDigest: reservation.experimentDigest,
    recordKey: reservation.recordKey,
    attemptIndex: reservation.attemptIndex,
    billingProvider: reservation.billingProvider,
    attemptType: reservation.attemptType,
    maximumCostUsdMicros: reservation.maximumCostUsdMicros,
  });
}

function quotaFor(
  manifest: M5bPhaseManifest,
  provider: "openai" | "anthropic",
  attemptType: M5bAttemptType,
): number | undefined {
  const quota = manifest.attemptQuotas.find(
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

export async function inspectM5bLedger(
  input: Readonly<{
    path: string;
    campaign: M5bCampaignManifest;
  }>,
): Promise<Result<M5bBudgetStatus, Diagnostic>> {
  const state = await parseLedger(input.path, input.campaign);
  return state.ok
    ? { ok: true, value: status(input.campaign, state.value) }
    : state;
}

export async function openM5bLedger(
  input: Readonly<{
    path: string;
    campaign: M5bCampaignManifest;
  }>,
): Promise<Result<M5bLedger, Diagnostic>> {
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
  const currentStatus = (): M5bBudgetStatus => {
    if (!state.ok) throw new Error(state.error.message);
    return status(input.campaign, state.value);
  };
  const registerManifest = async (
    manifest: M5bPhaseManifest,
  ): Promise<Result<void, Diagnostic>> => {
    if (!state.ok) return state;
    const prior = state.value.manifests.get(manifest.storageNamespace);
    if (prior !== undefined)
      return prior === manifest.phaseManifestDigest
        ? { ok: true, value: undefined }
        : { ok: false, error: failure("M5b namespace identity mismatch.") };
    const budget = currentStatus();
    const totalFits =
      manifest.theoreticalCeiling.maximumCostUsdMicros <=
      budget.remainingUsdMicros;
    const providersFit = manifest.theoreticalCeiling.providers.every(
      (ceiling) => {
        const provider = budget.providers.find(
          (candidate) => candidate.billingProvider === ceiling.billingProvider,
        );
        return (
          provider !== undefined &&
          ceiling.maximumCostUsdMicros <= provider.remainingUsdMicros
        );
      },
    );
    if (!totalFits || !providersFit)
      return {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "Complete M5b phase capacity does not fit before registration.",
        ),
      };
    return update({
      kind: "manifest-registered",
      phaseManifestDigest: manifest.phaseManifestDigest,
      experimentDigest: manifest.experimentDigest,
      storageNamespace: manifest.storageNamespace,
    });
  };
  return {
    ok: true,
    value: {
      registerManifest,
      status: currentStatus,
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
            const quota = quotaFor(
              manifest,
              reservation.billingProvider,
              reservation.attemptType,
            );
            const priorCount = [...state.value.reservations.values()].filter(
              (prior) =>
                prior.reservation.phaseManifestDigest ===
                  manifest.phaseManifestDigest &&
                prior.reservation.billingProvider ===
                  reservation.billingProvider &&
                prior.reservation.attemptType === reservation.attemptType,
            ).length;
            if (quota === undefined || priorCount >= quota)
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "M5b cohort attempt quota is exhausted before dispatch.",
                ),
              };
            const budget = currentStatus();
            const provider = budget.providers.find(
              (candidate) =>
                candidate.billingProvider === reservation.billingProvider,
            );
            if (
              reservation.maximumCostUsdMicros > budget.remainingUsdMicros ||
              provider === undefined ||
              reservation.maximumCostUsdMicros > provider.remainingUsdMicros
            )
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "M5b complete reservation exceeds remaining capacity.",
                ),
              };
            const appended = await update({
              kind: "reserved",
              reservationKey: key.value,
              phaseManifestDigest: manifest.phaseManifestDigest,
              experimentDigest: reservation.experimentDigest,
              recordKey: reservation.recordKey,
              billingProvider: reservation.billingProvider,
              attemptType: reservation.attemptType,
              attemptIndex: reservation.attemptIndex,
              maximumCostUsdMicros: reservation.maximumCostUsdMicros,
            });
            return appended.ok
              ? { ok: true, value: "reserved" as const }
              : appended;
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
                error: failure(
                  "M5b settlement is missing, duplicated, or exceeds reservation.",
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
