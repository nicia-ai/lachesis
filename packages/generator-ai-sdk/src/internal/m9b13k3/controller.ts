import { type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K3_CONTROLLER_DEADLINE_MS,
  M9B13K3_RUNTIME_PROTOCOL,
  M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
  m9b13k3BoundDigestSchema,
  m9b13k3CustodianBindingSchema,
  m9b13k3DigestSchema,
  type M9b13k3Failure,
  m9b13k3Failure,
  m9b13k3TokenIdSchema,
} from "./protocol.js";
import {
  dispatchM9b13k3LoopbackRequest,
  isM9b13k3LoopbackTransportCapability,
  type M9b13k3LoopbackTransportCapability,
  type M9b13k3TransportResult,
} from "./transport.js";

const runtimeBindingSchema = z
  .strictObject({
    activationIdentity: m9b13k3BoundDigestSchema,
    runtimeIdentity: m9b13k3DigestSchema,
    tokenId: m9b13k3TokenIdSchema,
    custodian: m9b13k3CustodianBindingSchema,
  })
  .readonly();
export type M9b13k3RuntimeBinding = z.infer<typeof runtimeBindingSchema>;

const requestIntentSchema = z.discriminatedUnion("requestClass", [
  z.strictObject({ requestClass: z.literal("project-detail") }),
  z.strictObject({ requestClass: z.literal("token-detail") }),
  z.strictObject({ requestClass: z.literal("registrations") }),
  z.strictObject({ requestClass: z.literal("drafts") }),
  z.strictObject({ requestClass: z.literal("provider-root") }),
  z.strictObject({ requestClass: z.literal("inventory") }),
  z.strictObject({ requestClass: z.literal("upload") }),
  z.strictObject({ requestClass: z.literal("revoke-token") }),
  z.strictObject({
    requestClass: z.literal("download"),
    objectId: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/u),
  }),
]);

const runtimeBrand: unique symbol = Symbol("M9b13k3SyntheticRuntime");
export type M9b13k3SyntheticRuntime = Readonly<{
  [runtimeBrand]: "M9b13k3SyntheticRuntime";
}>;

type RuntimeState = {
  transport: M9b13k3LoopbackTransportCapability;
  binding: M9b13k3RuntimeBinding;
  credential: Uint8Array;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  requestTimeoutMs: number;
  closed: boolean;
};
const runtimes = new WeakMap<object, RuntimeState>();

export type M9b13k3LiveStop = Readonly<{
  protocol: typeof M9B13K3_RUNTIME_PROTOCOL;
  decision: "m9b13k3-live-activation-unavailable";
  authorityAvailable: false;
  transportCapabilitiesCreated: 0;
  credentialReads: 0;
  ledgerAccesses: 0;
  externalEffects: "none";
}>;

export function runM9b13k3LiveController(): Promise<M9b13k3LiveStop> {
  return Promise.resolve({
    protocol: M9B13K3_RUNTIME_PROTOCOL,
    decision: "m9b13k3-live-activation-unavailable",
    authorityAvailable: false,
    transportCapabilitiesCreated: 0,
    credentialReads: 0,
    ledgerAccesses: 0,
    externalEffects: "none",
  });
}

function validSyntheticCredential(credential: Uint8Array): boolean {
  const prefix = new TextEncoder().encode("M9B13K3SYNTHETICNONOSF");
  if (credential.byteLength !== 64) return false;
  for (const [index, byte] of prefix.entries())
    if (credential[index] !== byte) return false;
  return true;
}

export function createSyntheticM9b13k3Runtime(
  transportValue: unknown,
  bindingValue: unknown,
  credential: Uint8Array,
  requestTimeoutMs: number,
  controllerDeadlineMs: number,
): Result<M9b13k3SyntheticRuntime, M9b13k3Failure> {
  if (
    typeof transportValue !== "object" ||
    transportValue === null ||
    !isM9b13k3LoopbackTransportCapability(transportValue)
  )
    return m9b13k3Failure(
      "activation",
      "m9b13k3-synthetic-runtime-requires-loopback-capability",
    );
  const binding = runtimeBindingSchema.safeParse(bindingValue);
  if (
    !binding.success ||
    binding.data.custodian.mode !== "synthetic-conformance" ||
    binding.data.custodian.receiptProtocol !==
      M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL
  )
    return m9b13k3Failure(
      "activation",
      "m9b13k3-synthetic-runtime-binding-invalid",
    );
  if (!validSyntheticCredential(credential))
    return m9b13k3Failure(
      "credential",
      "m9b13k3-synthetic-credential-required",
    );
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 10_000 ||
    !Number.isSafeInteger(controllerDeadlineMs) ||
    controllerDeadlineMs < 1 ||
    controllerDeadlineMs > M9B13K3_CONTROLLER_DEADLINE_MS
  )
    return m9b13k3Failure("deadline", "m9b13k3-deadline-profile-invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, controllerDeadlineMs);
  timer.unref();
  const runtime: M9b13k3SyntheticRuntime = Object.freeze({
    [runtimeBrand]: "M9b13k3SyntheticRuntime",
  });
  runtimes.set(runtime, {
    transport: transportValue,
    binding: binding.data,
    credential: credential.slice(),
    controller,
    timer,
    requestTimeoutMs,
    closed: false,
  });
  credential.fill(0);
  return { ok: true, value: runtime };
}

export async function dispatchSyntheticM9b13k3LoopbackConformance(
  runtime: M9b13k3SyntheticRuntime,
  intentValue: unknown,
): Promise<Result<M9b13k3TransportResult, M9b13k3Failure>> {
  const state = runtimes.get(runtime);
  if (state === undefined || state.closed)
    return m9b13k3Failure("activation", "m9b13k3-runtime-invalid-or-closed");
  if (state.controller.signal.aborted)
    return m9b13k3Failure("deadline", "m9b13k3-controller-deadline-expired");
  const intent = requestIntentSchema.safeParse(intentValue);
  if (!intent.success)
    return m9b13k3Failure(
      "transport",
      "m9b13k3-request-intent-invalid-before-reservation",
    );
  return await dispatchM9b13k3LoopbackRequest(
    state.transport,
    Object.freeze({ ...intent.data }),
    state.binding.tokenId,
    state.credential,
    state.requestTimeoutMs,
    state.controller.signal,
  );
}

export function closeSyntheticM9b13k3Runtime(
  runtime: M9b13k3SyntheticRuntime,
): Result<void, M9b13k3Failure> {
  const state = runtimes.get(runtime);
  if (state === undefined)
    return m9b13k3Failure("activation", "m9b13k3-runtime-invalid");
  state.credential.fill(0);
  state.closed = true;
  clearTimeout(state.timer);
  state.controller.abort();
  return { ok: true, value: undefined };
}
