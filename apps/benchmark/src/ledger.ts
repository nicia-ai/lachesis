import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import type {
  BenchmarkBudgetController,
  BenchmarkBudgetReservation,
  BenchmarkBudgetSettlement,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

import type { CampaignManifest, PhaseManifest } from "./protocol.js";

const fileErrorSchema = z.object({ code: z.string() });
const poolIdSchema = z.enum([
  "m1b-development",
  "m1b-heldout-pilot",
  "m1c-development",
  "m1c-heldout",
]);

const commonEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  campaignDigest: z.string().min(1),
  previousDigest: z.string().nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});

const ledgerEventBodySchema = z.discriminatedUnion("kind", [
  commonEventSchema.extend({
    kind: z.literal("campaign-opened"),
    campaignId: z.string().min(1),
  }),
  commonEventSchema.extend({
    kind: z.literal("manifest-registered"),
    phaseManifestDigest: z.string().min(1),
    experimentDigest: z.string().min(1),
    phase: z.enum([
      "transport-probe",
      "smoke",
      "calibration",
      "heldout",
      "m1c-protocol-probe",
      "m1c-repair",
      "m1c-calibration",
      "m1c-heldout",
    ]),
    budgetPoolId: poolIdSchema,
    storageNamespace: z.string().min(1),
  }),
  commonEventSchema.extend({
    kind: z.literal("reserved"),
    reservationKey: z.string().min(1),
    phaseManifestDigest: z.string().min(1),
    experimentDigest: z.string().min(1),
    budgetPoolId: poolIdSchema,
    billingProvider: z.string().min(1),
    maximumCostUsdMicros: z.number().int().nonnegative(),
  }),
  commonEventSchema.extend({
    kind: z.literal("settled"),
    reservationKey: z.string().min(1),
    actualCostUsdMicros: z.number().int().nonnegative(),
    conservative: z.boolean(),
    accountingBasis: z
      .enum(["provider-reported", "authorized-conservative", "not-dispatched"])
      .optional(),
  }),
]);

const ledgerEventSchema = ledgerEventBodySchema.and(
  z.object({ digest: z.string().min(1) }),
);

const ledgerHeadSchema = z.strictObject({
  campaignDigest: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  eventDigest: z.string().min(1),
});

type LedgerEvent = z.infer<typeof ledgerEventSchema>;
type LedgerEventBody = z.infer<typeof ledgerEventBodySchema>;
type PoolId = z.infer<typeof poolIdSchema>;
type NewLedgerEvent = LedgerEventBody extends infer Event
  ? Event extends LedgerEventBody
    ? Omit<
        Event,
        "sequence" | "campaignDigest" | "previousDigest" | "recordedAt"
      >
    : never
  : never;

type ReservationState = Readonly<{
  event: Extract<LedgerEvent, Readonly<{ kind: "reserved" }>>;
  settlement?: Extract<LedgerEvent, Readonly<{ kind: "settled" }>> | undefined;
}>;

type LedgerState = Readonly<{
  events: ReadonlyArray<LedgerEvent>;
  manifests: ReadonlyMap<
    string,
    Extract<LedgerEvent, Readonly<{ kind: "manifest-registered" }>>
  >;
  reservations: ReadonlyMap<string, ReservationState>;
}>;

export type BudgetPoolStatus = Readonly<{
  id: PoolId;
  consumedUsdMicros: number;
  remainingUsdMicros: number;
  observedProviderBillingUsdMicros: number;
  authorizedConservativeUsdMicros: number;
  unsettledReservationUsdMicros: number;
  notDispatchedSettlements: number;
  accountingByProvider: ReadonlyArray<
    Readonly<{
      billingProvider: string;
      consumedUsdMicros: number;
      observedProviderBillingUsdMicros: number;
      authorizedConservativeUsdMicros: number;
      unsettledReservationUsdMicros: number;
      notDispatchedSettlements: number;
    }>
  >;
  providers: ReadonlyArray<
    Readonly<{
      billingProvider: string;
      consumedUsdMicros: number;
      remainingUsdMicros: number;
      observedProviderBillingUsdMicros: number;
      authorizedConservativeUsdMicros: number;
      unsettledReservationUsdMicros: number;
      notDispatchedSettlements: number;
    }>
  >;
}>;

export type CampaignLock = Readonly<{
  path: string;
  release: () => Promise<void>;
}>;

function storageError(action: string, error: unknown): Diagnostic {
  return diagnostic(
    "INTERNAL_INVARIANT_VIOLATION",
    `Unable to ${action} campaign ledger: ${error instanceof Error ? error.message : String(error)}.`,
  );
}

function isCode(error: unknown, code: string): boolean {
  const parsed = fileErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === code;
}

async function readOptional(
  path: string,
): Promise<Result<string | undefined, Diagnostic>> {
  try {
    return { ok: true, value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    return isCode(error, "ENOENT")
      ? { ok: true, value: undefined }
      : { ok: false, error: storageError("read", error) };
  }
}

async function parseLedger(
  ledgerPath: string,
  headPath: string,
  campaign: CampaignManifest,
): Promise<Result<LedgerState, Diagnostic>> {
  const [ledgerText, headText] = await Promise.all([
    readOptional(ledgerPath),
    readOptional(headPath),
  ]);
  if (!ledgerText.ok) return ledgerText;
  if (!headText.ok) return headText;
  if (ledgerText.value === undefined && headText.value === undefined) {
    return {
      ok: true,
      value: { events: [], manifests: new Map(), reservations: new Map() },
    };
  }
  if (ledgerText.value === undefined || headText.value === undefined) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Campaign ledger or its durable head is missing.",
      ),
    };
  }
  if (!ledgerText.value.endsWith("\n")) {
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", "Campaign ledger is truncated."),
    };
  }
  const events: Array<LedgerEvent> = [];
  const lines = ledgerText.value.split("\n").filter((line) => line.length > 0);
  let previousDigest: string | null = null;
  for (const [sequence, line] of lines.entries()) {
    const json = parseJson(line);
    if (!json.ok) return json;
    const parsed = ledgerEventSchema.safeParse(json.value);
    if (!parsed.success) {
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Campaign ledger contains an invalid event.",
        ),
      };
    }
    const { digest, ...body } = parsed.data;
    const computed = await digestValue(body);
    if (
      !computed.ok ||
      computed.value !== digest ||
      parsed.data.sequence !== sequence ||
      parsed.data.previousDigest !== previousDigest ||
      parsed.data.campaignDigest !== campaign.campaignDigest
    ) {
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Campaign ledger is corrupted, reordered, or belongs to another campaign.",
        ),
      };
    }
    events.push(parsed.data);
    previousDigest = digest;
  }
  const headJson = parseJson(headText.value);
  if (!headJson.ok) return headJson;
  const head = ledgerHeadSchema.safeParse(headJson.value);
  const last = events.at(-1);
  if (
    !head.success ||
    last === undefined ||
    head.data.campaignDigest !== campaign.campaignDigest ||
    head.data.sequence !== last.sequence ||
    head.data.eventDigest !== last.digest
  ) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Campaign ledger head detects truncated or mismatched history.",
      ),
    };
  }
  const manifests = new Map<
    string,
    Extract<LedgerEvent, Readonly<{ kind: "manifest-registered" }>>
  >();
  const reservations = new Map<string, ReservationState>();
  for (const event of events) {
    if (event.kind === "manifest-registered") {
      const prior = manifests.get(event.storageNamespace);
      if (prior !== undefined) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "Campaign ledger registers a storage namespace more than once.",
          ),
        };
      }
      manifests.set(event.storageNamespace, event);
    } else if (event.kind === "reserved") {
      if (reservations.has(event.reservationKey)) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "Campaign ledger contains a duplicate reservation.",
          ),
        };
      }
      reservations.set(event.reservationKey, { event });
    } else if (event.kind === "settled") {
      const reservation = reservations.get(event.reservationKey);
      if (reservation === undefined || reservation.settlement !== undefined) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "Campaign ledger contains an unmatched or duplicate settlement.",
          ),
        };
      }
      reservations.set(event.reservationKey, {
        ...reservation,
        settlement: event,
      });
    }
  }
  return { ok: true, value: { events, manifests, reservations } };
}

async function appendEvent(
  ledgerPath: string,
  headPath: string,
  campaign: CampaignManifest,
  state: LedgerState,
  event: NewLedgerEvent,
): Promise<Result<LedgerState, Diagnostic>> {
  const prior = state.events.at(-1);
  const body = ledgerEventBodySchema.parse({
    ...event,
    sequence: state.events.length,
    campaignDigest: campaign.campaignDigest,
    previousDigest: prior?.digest ?? null,
    recordedAt: new Date().toISOString(),
  });
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const complete = ledgerEventSchema.parse({ ...body, digest: digest.value });
  const canonical = canonicalizeJson(complete);
  const head = canonicalizeJson({
    campaignDigest: campaign.campaignDigest,
    sequence: complete.sequence,
    eventDigest: complete.digest,
  });
  if (!canonical.ok) return canonical;
  if (!head.ok) return head;
  try {
    await mkdir(dirname(ledgerPath), { recursive: true });
    await appendFile(ledgerPath, `${canonical.value}\n`, {
      encoding: "utf8",
      flush: true,
    });
    const temporaryHead = `${headPath}.tmp`;
    await writeFile(temporaryHead, `${head.value}\n`, "utf8");
    await rename(temporaryHead, headPath);
    const handle = await open(headPath, "r");
    await handle.sync();
    await handle.close();
  } catch (error: unknown) {
    return { ok: false, error: storageError("append to", error) };
  }
  return parseLedger(ledgerPath, headPath, campaign);
}

function chargedCost(reservation: ReservationState): number {
  return (
    reservation.settlement?.actualCostUsdMicros ??
    reservation.event.maximumCostUsdMicros
  );
}

function settlementBasis(
  settlement: Extract<LedgerEvent, Readonly<{ kind: "settled" }>>,
): "provider-reported" | "authorized-conservative" | "not-dispatched" {
  return (
    settlement.accountingBasis ??
    (settlement.conservative ? "authorized-conservative" : "provider-reported")
  );
}

function accountingSummary(
  reservations: ReadonlyArray<ReservationState>,
): Readonly<{
  observedProviderBillingUsdMicros: number;
  authorizedConservativeUsdMicros: number;
  unsettledReservationUsdMicros: number;
  notDispatchedSettlements: number;
}> {
  return reservations.reduce(
    (summary, reservation) => {
      const settlement = reservation.settlement;
      if (settlement === undefined) {
        return {
          ...summary,
          unsettledReservationUsdMicros:
            summary.unsettledReservationUsdMicros +
            reservation.event.maximumCostUsdMicros,
        };
      }
      switch (settlementBasis(settlement)) {
        case "provider-reported":
          return {
            ...summary,
            observedProviderBillingUsdMicros:
              summary.observedProviderBillingUsdMicros +
              settlement.actualCostUsdMicros,
          };
        case "authorized-conservative":
          return {
            ...summary,
            authorizedConservativeUsdMicros:
              summary.authorizedConservativeUsdMicros +
              settlement.actualCostUsdMicros,
          };
        case "not-dispatched":
          return {
            ...summary,
            notDispatchedSettlements: summary.notDispatchedSettlements + 1,
          };
      }
    },
    {
      observedProviderBillingUsdMicros: 0,
      authorizedConservativeUsdMicros: 0,
      unsettledReservationUsdMicros: 0,
      notDispatchedSettlements: 0,
    },
  );
}

function poolStatus(
  campaign: CampaignManifest,
  state: LedgerState,
  poolId: PoolId,
): BudgetPoolStatus {
  const pool = campaign.budgetPools.find((item) => item.id === poolId);
  if (pool === undefined) throw new Error(`Missing campaign pool ${poolId}.`);
  const reservations = [...state.reservations.values()].filter(
    (item) => item.event.budgetPoolId === poolId,
  );
  const consumedUsdMicros = reservations.reduce(
    (total, item) => total + chargedCost(item),
    0,
  );
  const accounting = accountingSummary(reservations);
  const accountingByProvider = [
    ...new Set(reservations.map((item) => item.event.billingProvider)),
  ]
    .toSorted()
    .map((billingProvider) => {
      const providerReservations = reservations.filter(
        (item) => item.event.billingProvider === billingProvider,
      );
      return {
        billingProvider,
        consumedUsdMicros: providerReservations.reduce(
          (total, item) => total + chargedCost(item),
          0,
        ),
        ...accountingSummary(providerReservations),
      };
    });
  return {
    id: poolId,
    consumedUsdMicros,
    remainingUsdMicros: Math.max(0, pool.maxCostUsdMicros - consumedUsdMicros),
    ...accounting,
    accountingByProvider,
    providers: pool.providerCostCaps.map((providerCap) => {
      const providerReservations = reservations.filter(
        (item) => item.event.billingProvider === providerCap.billingProvider,
      );
      const consumed = providerReservations.reduce(
        (total, item) => total + chargedCost(item),
        0,
      );
      return {
        billingProvider: providerCap.billingProvider,
        consumedUsdMicros: consumed,
        remainingUsdMicros: Math.max(
          0,
          providerCap.maxCostUsdMicros - consumed,
        ),
        ...accountingSummary(providerReservations),
      };
    }),
  };
}

export async function acquireCampaignLock(
  path: string,
  staleAfterMs = 15 * 60 * 1000,
): Promise<Result<CampaignLock, Diagnostic>> {
  const lockPath = `${path}.lock`;
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error: unknown) {
    return {
      ok: false,
      error: storageError("prepare lock directory for", error),
    };
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(
        `${lockPath}/owner.json`,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return {
        ok: true,
        value: {
          path: lockPath,
          async release() {
            try {
              await unlink(`${lockPath}/owner.json`);
              await rmdir(lockPath);
            } catch (error: unknown) {
              if (!isCode(error, "ENOENT")) throw error;
            }
          },
        },
      };
    } catch (error: unknown) {
      if (!isCode(error, "EEXIST"))
        return { ok: false, error: storageError("acquire", error) };
      const information = await stat(lockPath);
      if (Date.now() - information.mtimeMs <= staleAfterMs) {
        return {
          ok: false,
          error: diagnostic(
            "BUDGET_EXCEEDED",
            "Campaign budget is locked by another active process.",
          ),
        };
      }
      try {
        await rename(
          lockPath,
          `${lockPath}.stale-${Date.now()}-${process.pid}`,
        );
      } catch (renameError: unknown) {
        if (isCode(renameError, "ENOENT")) continue;
        return {
          ok: false,
          error: storageError("preserve stale lock", renameError),
        };
      }
    }
  }
  return {
    ok: false,
    error: diagnostic(
      "BUDGET_EXCEEDED",
      "Campaign lock could not be acquired after stale-lock recovery.",
    ),
  };
}

export type CampaignLedger = Readonly<{
  status: (poolId: PoolId) => BudgetPoolStatus;
  registerManifest: (
    manifest: PhaseManifest,
  ) => Promise<Result<void, Diagnostic>>;
  budgetController: (
    manifest: PhaseManifest,
    onReservation?: (status: BudgetPoolStatus, provider: string) => void,
  ) => BenchmarkBudgetController;
}>;

export async function inspectCampaignLedger(
  input: Readonly<{
    path: string;
    campaign: CampaignManifest;
  }>,
): Promise<Result<ReadonlyArray<BudgetPoolStatus>, Diagnostic>> {
  const state = await parseLedger(
    input.path,
    `${input.path}.head`,
    input.campaign,
  );
  if (!state.ok) return state;
  return {
    ok: true,
    value: input.campaign.budgetPools.map((pool) =>
      poolStatus(input.campaign, state.value, pool.id),
    ),
  };
}

export async function openCampaignLedger(
  input: Readonly<{
    path: string;
    campaign: CampaignManifest;
  }>,
): Promise<Result<CampaignLedger, Diagnostic>> {
  const headPath = `${input.path}.head`;
  let state = await parseLedger(input.path, headPath, input.campaign);
  if (!state.ok) return state;
  if (state.value.events.length === 0) {
    state = await appendEvent(
      input.path,
      headPath,
      input.campaign,
      state.value,
      {
        kind: "campaign-opened",
        campaignId: input.campaign.campaignId,
      },
    );
    if (!state.ok) return state;
  }
  const update = async (
    event: NewLedgerEvent,
  ): Promise<Result<void, Diagnostic>> => {
    if (!state.ok) return state;
    const appended = await appendEvent(
      input.path,
      headPath,
      input.campaign,
      state.value,
      event,
    );
    if (!appended.ok) return appended;
    state = appended;
    return { ok: true, value: undefined };
  };
  const status = (poolId: PoolId): BudgetPoolStatus => {
    if (!state.ok) throw new Error(state.error.message);
    return poolStatus(input.campaign, state.value, poolId);
  };
  const registerManifest = async (
    manifest: PhaseManifest,
  ): Promise<Result<void, Diagnostic>> => {
    if (!state.ok) return state;
    const prior = state.value.manifests.get(manifest.storageNamespace);
    if (prior !== undefined) {
      return prior.phaseManifestDigest === manifest.phaseManifestDigest
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: diagnostic(
              "INVALID_WIRE_SCHEMA",
              "A phase manifest cannot change after campaign execution begins.",
            ),
          };
    }
    return update({
      kind: "manifest-registered",
      phaseManifestDigest: manifest.phaseManifestDigest,
      experimentDigest: manifest.experimentDigest,
      phase: manifest.phase,
      budgetPoolId: manifest.budgetPoolId,
      storageNamespace: manifest.storageNamespace,
    });
  };
  return {
    ok: true,
    value: {
      status,
      registerManifest,
      budgetController(manifest, onReservation) {
        const reservationKey = async (
          reservation: BenchmarkBudgetReservation,
        ): Promise<Result<string, Diagnostic>> =>
          digestValue({
            campaignDigest: input.campaign.campaignDigest,
            phaseManifestDigest: manifest.phaseManifestDigest,
            benchmarkRecordKey: reservation.benchmarkRecordKey,
            methodId: reservation.methodId,
            attemptIndex: reservation.attemptIndex,
          });
        return {
          async reserve(reservation) {
            if (!state.ok) return state;
            const registered = await registerManifest(manifest);
            if (!registered.ok) return registered;
            const key = await reservationKey(reservation);
            if (!key.ok) return key;
            if (state.value.reservations.has(key.value)) {
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "A previously dispatched request cannot be reserved or charged twice.",
                ),
              };
            }
            const current = status(manifest.budgetPoolId);
            const provider = current.providers.find(
              (item) => item.billingProvider === reservation.billingProvider,
            );
            if (
              reservation.maximumCostUsdMicros > current.remainingUsdMicros ||
              (provider !== undefined &&
                reservation.maximumCostUsdMicros > provider.remainingUsdMicros)
            ) {
              return {
                ok: false,
                error: diagnostic(
                  "BUDGET_EXCEEDED",
                  "Worst-case campaign reservation exceeds the remaining pool or provider allowance.",
                ),
              };
            }
            onReservation?.(current, reservation.billingProvider);
            return update({
              kind: "reserved",
              reservationKey: key.value,
              phaseManifestDigest: manifest.phaseManifestDigest,
              experimentDigest: reservation.experimentDigest,
              budgetPoolId: manifest.budgetPoolId,
              billingProvider: reservation.billingProvider,
              maximumCostUsdMicros: reservation.maximumCostUsdMicros,
            });
          },
          async settle(settlement: BenchmarkBudgetSettlement) {
            if (!state.ok) return state;
            const key = await reservationKey(settlement);
            if (!key.ok) return key;
            const reservation = state.value.reservations.get(key.value);
            if (
              reservation === undefined ||
              reservation.settlement !== undefined
            ) {
              return {
                ok: false,
                error: diagnostic(
                  "INVALID_WIRE_SCHEMA",
                  "Campaign settlement is missing its unique reservation or was already recorded.",
                ),
              };
            }
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
