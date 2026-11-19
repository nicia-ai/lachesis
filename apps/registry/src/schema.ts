import { z } from "zod";

export const ENTRY_PROTOCOL = "lachesis-registry-entry/1";
export const MANIFEST_PROTOCOL = "lachesis-registry-manifest/1";
export const WITNESSES_PROTOCOL = "lachesis-registry-witnesses/1";
export const SIGNATURE_NAMESPACE = "lachesis-registry";

export const REGISTRY_DIRECTORY = "registry";
export const TSA_DIRECTORY = "registry/tsa";
export const WITNESSES_PATH = "registry/witnesses.json";
export const PENDING_DIRECTORY_NAME = "pending";
export const MANIFEST_FILE_NAME = "MANIFEST.json";
export const MINIMUM_TIMESTAMP_AUTHORITIES = 2;

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/);
export const repositoryPathSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
  .refine(
    (path) => path.split("/").every((part) => part !== "." && part !== ".."),
    "Path segments may not be . or ..",
  );
const principalSchema = z.string().regex(/^[A-Za-z0-9._@-]{1,64}$/);
export const publicKeySchema = z
  .string()
  .regex(/^(?:ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/);

const timestampAuthoritySchema = z
  .strictObject({
    name: slugSchema,
    url: z.url({ protocol: /^https?$/ }),
    caBundleSha256: sha256Schema,
  })
  .readonly();
export type TimestampAuthority = z.infer<typeof timestampAuthoritySchema>;

const entryBase = {
  protocol: z.literal(ENTRY_PROTOCOL),
  study: slugSchema,
  sequence: z.number().int().nonnegative(),
};

const boundContent = {
  revision: slugSchema,
  manifestPath: repositoryPathSchema,
  manifestSha256: sha256Schema,
  sourceCommit: commitSchema,
};

const genesisEntrySchema = z
  .strictObject({
    ...entryBase,
    kind: z.literal("genesis"),
    parentEntrySha256: z.null(),
    signer: z
      .strictObject({ principal: principalSchema, publicKey: publicKeySchema })
      .readonly(),
    timestampAuthorities: z
      .array(timestampAuthoritySchema)
      .min(MINIMUM_TIMESTAMP_AUTHORITIES)
      .readonly()
      .refine(
        (authorities) =>
          new Set(authorities.map((authority) => authority.name)).size ===
          authorities.length,
        "Timestamp authority names must be unique.",
      ),
    externalRoots: z
      .array(
        z
          .strictObject({
            label: z.string().min(1).max(200),
            sha256: sha256Schema,
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();

const registrationEntrySchema = z
  .strictObject({
    ...entryBase,
    ...boundContent,
    kind: z.literal("registration"),
    parentEntrySha256: sha256Schema,
    authorizes: slugSchema,
  })
  .readonly();

const resultEntrySchema = z
  .strictObject({
    ...entryBase,
    ...boundContent,
    kind: z.literal("result"),
    parentEntrySha256: sha256Schema,
    reportsOn: z.number().int().nonnegative(),
  })
  .readonly();

export const entrySchema = z.discriminatedUnion("kind", [
  genesisEntrySchema,
  registrationEntrySchema,
  resultEntrySchema,
]);
export type RegistryEntry = z.infer<typeof entrySchema>;
export type GenesisEntry = z.infer<typeof genesisEntrySchema>;
export type BoundEntry = Exclude<RegistryEntry, GenesisEntry>;

const manifestFileSchema = z
  .strictObject({
    path: repositoryPathSchema,
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .readonly();
export type ManifestFile = z.infer<typeof manifestFileSchema>;

export const manifestSchema = z
  .strictObject({
    protocol: z.literal(MANIFEST_PROTOCOL),
    files: z.array(manifestFileSchema).min(1).readonly(),
  })
  .readonly();
export type Manifest = z.infer<typeof manifestSchema>;

export const witnessesSchema = z
  .strictObject({
    protocol: z.literal(WITNESSES_PROTOCOL),
    witnesses: z
      .array(
        z
          .strictObject({
            name: slugSchema,
            url: z.string().min(1),
            branch: z.string().regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();
export type Witness = z.infer<typeof witnessesSchema>["witnesses"][number];
