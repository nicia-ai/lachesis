import { type Result } from "@nicia-ai/lachesis";
import {
  type EvidenceGraph,
  type EvidenceSource,
  type M4EvidenceView,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const TYPEGRAPH_PACKAGE_VERSION = "0.38.0";
export const M4C_TYPEGRAPH_ADAPTER_VERSION = "m4c-typegraph-evidence-adapter/1";
export const M4C_TYPEGRAPH_SCHEMA_VERSION = "1";

export const typeGraphBackendIdentitySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1),
  })
  .readonly();

export const typeGraphSnapshotCoordinateSchema = z
  .strictObject({
    validAt: z.iso.datetime().nullable(),
    recordedAt: z.iso.datetime().nullable(),
  })
  .readonly();

export const typeGraphAdapterIdentitySchema = z
  .strictObject({
    id: z.literal("lachesis-m4c-typegraph-evidence"),
    version: z.literal(M4C_TYPEGRAPH_ADAPTER_VERSION),
    typeGraphPackageVersion: z.literal(TYPEGRAPH_PACKAGE_VERSION),
    schemaVersion: z.literal(M4C_TYPEGRAPH_SCHEMA_VERSION),
    backend: typeGraphBackendIdentitySchema,
    schemaDigest: sha256Schema,
    adapterDigest: sha256Schema,
  })
  .readonly();

export const typeGraphSnapshotIdentitySchema = z
  .strictObject({
    adapter: typeGraphAdapterIdentitySchema,
    coordinate: typeGraphSnapshotCoordinateSchema,
    sourceGraphDigest: sha256Schema,
    storageSnapshotDigest: sha256Schema,
  })
  .readonly();

export const typeGraphAdapterFailureSchema = z
  .strictObject({
    code: z.enum([
      "INVALID_SOURCE_GRAPH",
      "SOURCE_IDENTITY_MISMATCH",
      "SCHEMA_VERSION_MISMATCH",
      "SNAPSHOT_MISMATCH",
      "MISSING_REFERENCE",
      "ADAPTER_CAPABILITY_VIOLATION",
      "TYPEGRAPH_OPERATION_FAILED",
      "IDENTITY_FAILURE",
      "REPOSITORY_CLOSED",
    ]),
    message: z.string().min(1),
  })
  .readonly();

export type TypeGraphSnapshotCoordinate = z.infer<
  typeof typeGraphSnapshotCoordinateSchema
>;
export type TypeGraphBackendIdentity = z.infer<
  typeof typeGraphBackendIdentitySchema
>;
export type TypeGraphAdapterIdentity = z.infer<
  typeof typeGraphAdapterIdentitySchema
>;
export type TypeGraphSnapshotIdentity = z.infer<
  typeof typeGraphSnapshotIdentitySchema
>;
export type TypeGraphAdapterFailure = z.infer<
  typeof typeGraphAdapterFailureSchema
>;

export type TypeGraphEvidenceSnapshot = Readonly<{
  graph: EvidenceGraph;
  identity: TypeGraphSnapshotIdentity;
}>;

export type TypeGraphEvidenceRepository = Readonly<{
  identity: TypeGraphAdapterIdentity;
  initialRecordedAt: string;
  snapshot: (
    coordinate?: TypeGraphSnapshotCoordinate,
  ) => Promise<Result<TypeGraphEvidenceSnapshot, TypeGraphAdapterFailure>>;
  source: (
    view: M4EvidenceView,
    coordinate?: TypeGraphSnapshotCoordinate,
  ) => Promise<Result<EvidenceSource, TypeGraphAdapterFailure>>;
  assertSnapshot: (
    expectedStorageSnapshotDigest: string,
    coordinate?: TypeGraphSnapshotCoordinate,
  ) => Promise<Result<TypeGraphEvidenceSnapshot, TypeGraphAdapterFailure>>;
  retractFact: (
    factId: string,
  ) => Promise<Result<string, TypeGraphAdapterFailure>>;
  close: () => Promise<void>;
}>;

export const CURRENT_TYPEGRAPH_SNAPSHOT: TypeGraphSnapshotCoordinate =
  typeGraphSnapshotCoordinateSchema.parse({
    validAt: null,
    recordedAt: null,
  });
