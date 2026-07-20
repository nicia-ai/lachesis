import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";
import {
  type M5EvidenceSnapshot,
  m5EvidenceSnapshotIdentitySchema,
  type M5EvidenceStore,
  type M5EvidenceStoreFailure,
  m5EvidenceStoreIdentitySchema,
} from "@nicia-ai/lachesis-evidence";

import type {
  TypeGraphAdapterFailure,
  TypeGraphEvidenceRepository,
} from "./contract.js";

function failure(
  code: M5EvidenceStoreFailure["code"],
  message: string,
): M5EvidenceStoreFailure {
  return { code, message };
}

function mapFailure(error: TypeGraphAdapterFailure): M5EvidenceStoreFailure {
  switch (error.code) {
    case "SNAPSHOT_MISMATCH":
      return failure("SNAPSHOT_MISMATCH", error.message);
    case "REPOSITORY_CLOSED":
      return failure("STORE_CLOSED", error.message);
    case "INVALID_SOURCE_GRAPH":
    case "SOURCE_IDENTITY_MISMATCH":
    case "SCHEMA_VERSION_MISMATCH":
    case "MISSING_REFERENCE":
    case "ADAPTER_CAPABILITY_VIOLATION":
    case "TYPEGRAPH_OPERATION_FAILED":
    case "IDENTITY_FAILURE":
      return failure("STORE_OPERATION_FAILED", error.message);
  }
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Adapts an optional M4c TypeGraph repository to the portable M5 evidence-store
 * contract. TypeGraph identities remain storage audit metadata.
 */
export async function createM5TypeGraphEvidenceStore(
  repository: TypeGraphEvidenceRepository,
): Promise<Result<M5EvidenceStore, M5EvidenceStoreFailure>> {
  const storeDigest = await digestValue({
    adapter: repository.identity,
    initialRecordedAt: repository.initialRecordedAt,
  });
  if (!storeDigest.ok)
    return err(
      failure(
        "STORE_OPERATION_FAILED",
        "TypeGraph runtime store cannot be identified.",
      ),
    );
  const identity = m5EvidenceStoreIdentitySchema.parse({
    id: "m5-typegraph-evidence",
    version: "1",
    implementation: repository.identity.version,
    storeDigest: storeDigest.value,
  });
  return ok({
    identity,
    snapshot: async (coordinate, signal) => {
      if (isAborted(signal))
        return err(failure("CANCELLED", "TypeGraph snapshot was cancelled."));
      const selected = await repository.snapshot(coordinate);
      if (!selected.ok) return err(mapFailure(selected.error));
      if (isAborted(signal))
        return err(failure("CANCELLED", "TypeGraph snapshot was cancelled."));
      const snapshot: M5EvidenceSnapshot = {
        graph: selected.value.graph,
        identity: m5EvidenceSnapshotIdentitySchema.parse({
          store: identity,
          coordinate: selected.value.identity.coordinate,
          sourceSnapshotDigest: selected.value.identity.sourceGraphDigest,
          storageSnapshotDigest: selected.value.identity.storageSnapshotDigest,
        }),
      };
      return ok(snapshot);
    },
  });
}
