import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const planHashSchema = sha256Schema.brand<"PlanHash">();
export const catalogFingerprintSchema =
  sha256Schema.brand<"CatalogFingerprint">();
export const manifestDigestSchema = sha256Schema.brand<"ManifestDigest">();
export const valueDigestSchema = sha256Schema.brand<"ValueDigest">();
export const effectRequestHashSchema =
  sha256Schema.brand<"EffectRequestHash">();

export type PlanHash = z.infer<typeof planHashSchema>;
export type CatalogFingerprint = z.infer<typeof catalogFingerprintSchema>;
export type ManifestDigest = z.infer<typeof manifestDigestSchema>;
export type ValueDigest = z.infer<typeof valueDigestSchema>;
export type EffectRequestHash = z.infer<typeof effectRequestHashSchema>;
