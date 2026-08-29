import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import { compareM9b13k4cInventoryIdentities } from "./implementation-order.js";

export const M9B13K4C_IMPLEMENTATION_PROTOCOL =
  "lachesis-m9b13k4c-source-build-bound-ledger-identity/4" as const;

const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();

export type M9b13k4cFailure = Readonly<{
  kind: "identity";
  reason: string;
  ambiguous: false;
}>;

export const m9b13k4cImplementationInventorySchema = z
  .strictObject({
    protocol: z.literal(M9B13K4C_IMPLEMENTATION_PROTOCOL),
    entries: z
      .array(
        z
          .strictObject({
            kind: z.enum([
              "native-source",
              "typescript-source",
              "javascript",
              "declaration",
              "build-protocol",
              "executable",
              "sandbox-profile",
              "hostile-test",
              "configuration",
            ]),
            path: z
              .string()
              .min(1)
              .regex(/^[A-Za-z0-9._/-]+$/u)
              .refine((path) => !path.startsWith("/") && !path.includes("..")),
            byteLength: z.number().int().nonnegative(),
            sha256: digestSchema,
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly();
export type M9b13k4cImplementationInventory = z.infer<
  typeof m9b13k4cImplementationInventorySchema
>;

function identityFailure(reason: string): Result<never, M9b13k4cFailure> {
  return { ok: false, error: { kind: "identity", reason, ambiguous: false } };
}

export function deriveM9b13k4cImplementationIdentity(value: unknown): Result<
  Readonly<{
    identity: string;
    canonicalInventory: M9b13k4cImplementationInventory;
  }>,
  M9b13k4cFailure
> {
  const parsed = m9b13k4cImplementationInventorySchema.safeParse(value);
  if (!parsed.success)
    return identityFailure("m9b13k4c-implementation-inventory-invalid");

  const identities = new Set<string>();
  for (const entry of parsed.data.entries) {
    const identity = `${entry.kind}\u0000${entry.path}`;
    if (identities.has(identity))
      return identityFailure("m9b13k4c-implementation-path-duplicate");
    identities.add(identity);
  }

  const entries = parsed.data.entries.toSorted(
    compareM9b13k4cInventoryIdentities,
  );
  const canonicalInventory = m9b13k4cImplementationInventorySchema.parse({
    protocol: M9B13K4C_IMPLEMENTATION_PROTOCOL,
    entries,
  });
  const canonical = canonicalizeJson(canonicalInventory);
  if (!canonical.ok)
    return identityFailure("m9b13k4c-implementation-not-canonical");
  const digest = createHash("sha256");
  digest.update(M9B13K4C_IMPLEMENTATION_PROTOCOL, "utf8");
  const bytes = new TextEncoder().encode(canonical.value);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength));
  digest.update(length);
  digest.update(bytes);
  return {
    ok: true,
    value: { identity: digest.digest("hex"), canonicalInventory },
  };
}
