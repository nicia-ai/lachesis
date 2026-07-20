import { err, type Result } from "@nicia-ai/lachesis";
import {
  type M5EvidenceStore,
  type M5EvidenceStoreFailure,
  validateEvidenceGraph,
} from "@nicia-ai/lachesis-evidence";
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
  close: () => Promise<void>;
}>;

export type M5ManagedSqliteEvidenceStoreFailure =
  TypeGraphAdapterFailure | M5EvidenceStoreFailure;

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
  try {
    const store = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
      ...(input.path === undefined ? {} : { path: input.path }),
      store: { history: true },
    });
    return await createTypeGraphEvidenceRepository({
      graphInput: input.graphInput,
      store,
      backendIdentity: { id: "typegraph-local-sqlite", version: "0.38.0" },
    });
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
      close: () => repository.value.close(),
    },
  };
}
