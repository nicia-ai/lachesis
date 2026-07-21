import { err, type Result } from "@nicia-ai/lachesis";
import {
  type M5EvidenceStore,
  type M5EvidenceStoreFailure,
  validateEvidenceGraph,
} from "@nicia-ai/lachesis-evidence";
import {
  auditPrivateSqliteFile,
  preparePrivateSqliteFile,
  type PrivateSqliteAudit,
} from "@nicia-ai/lachesis-runtime/node";
import { createLocalSqliteStore } from "@nicia-ai/typegraph/sqlite/local";

import {
  type TypeGraphAdapterFailure,
  type TypeGraphEvidenceRepository,
} from "./contract.js";
import { createM5TypeGraphEvidenceStore } from "./m5.js";
import {
  createTypeGraphEvidenceRepository,
  TYPEGRAPH_EVIDENCE_SCHEMA,
} from "./store.js";

export type M5ManagedSqliteEvidenceStore = Readonly<{
  store: M5EvidenceStore;
  repository: TypeGraphEvidenceRepository;
  permissionAudit: () => Promise<
    Result<PrivateSqliteAudit | null, TypeGraphAdapterFailure>
  >;
  close: () => Promise<void>;
}>;

export type M5ManagedSqliteEvidenceStoreFailure =
  TypeGraphAdapterFailure | M5EvidenceStoreFailure;

function permissionFailure(message: string): TypeGraphAdapterFailure {
  return { code: "ADAPTER_CAPABILITY_VIOLATION", message };
}

async function preparePrivatePath(
  path: string | undefined,
): Promise<Result<void, TypeGraphAdapterFailure>> {
  if (path === undefined) return { ok: true, value: undefined };
  const prepared = await preparePrivateSqliteFile(path);
  return prepared.ok
    ? { ok: true, value: undefined }
    : { ok: false, error: permissionFailure(prepared.error.message) };
}

async function auditPrivatePath(
  path: string | undefined,
): Promise<Result<PrivateSqliteAudit | null, TypeGraphAdapterFailure>> {
  if (path === undefined) return { ok: true, value: null };
  const audited = await auditPrivateSqliteFile(path);
  return audited.ok
    ? audited
    : { ok: false, error: permissionFailure(audited.error.message) };
}

/**
 * Creates an M4c repository backed by TypeGraph's managed local SQLite store.
 * This convenience entrypoint is Node-only; the main package accepts any
 * compatible TypeGraph HistoryStore, including Cloudflare-backed stores.
 */
export async function createTypeGraphSqliteEvidenceRepository(
  input: Readonly<{
    graphInput: unknown;
    path?: string;
  }>,
): Promise<Result<TypeGraphEvidenceRepository, TypeGraphAdapterFailure>> {
  const validated = validateEvidenceGraph(input.graphInput);
  if (!validated.ok)
    return err({
      code: "INVALID_SOURCE_GRAPH",
      message: validated.error.message,
    });
  const prepared = await preparePrivatePath(input.path);
  if (!prepared.ok) return prepared;
  try {
    const store = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
      ...(input.path === undefined ? {} : { path: input.path }),
      store: { history: true },
    });
    const repository = await createTypeGraphEvidenceRepository({
      graphInput: input.graphInput,
      store,
      backendIdentity: { id: "typegraph-local-sqlite", version: "0.38.0" },
    });
    if (!repository.ok) return repository;
    const permissionAudit = await auditPrivatePath(input.path);
    if (!permissionAudit.ok) {
      await repository.value.close();
      return permissionAudit;
    }
    return repository;
  } catch (error) {
    return err({
      code: "TYPEGRAPH_OPERATION_FAILED",
      message:
        error instanceof Error
          ? `TypeGraph local SQLite initialization failed: ${error.name}: ${error.message}`
          : "TypeGraph local SQLite initialization failed.",
    });
  }
}

/** Node-only managed-SQLite convenience for the portable M5 runtime. */
export async function createM5TypeGraphSqliteEvidenceStore(
  input: Readonly<{
    graphInput: unknown;
    path?: string;
  }>,
): Promise<
  Result<M5ManagedSqliteEvidenceStore, M5ManagedSqliteEvidenceStoreFailure>
> {
  const repository = await createTypeGraphSqliteEvidenceRepository(input);
  if (!repository.ok) return repository;
  const store = await createM5TypeGraphEvidenceStore(repository.value);
  if (!store.ok) {
    await repository.value.close();
    return store;
  }
  return {
    ok: true,
    value: {
      store: store.value,
      repository: repository.value,
      permissionAudit: () => auditPrivatePath(input.path),
      close: () => repository.value.close(),
    },
  };
}
