import { err, type Result } from "@nicia-ai/lachesis";
import { validateEvidenceGraph } from "@nicia-ai/lachesis-evidence";
import { createLocalSqliteStore } from "@nicia-ai/typegraph/sqlite/local";

import {
  type TypeGraphAdapterFailure,
  type TypeGraphEvidenceRepository,
} from "./contract.js";
import {
  createTypeGraphEvidenceRepository,
  TYPEGRAPH_EVIDENCE_SCHEMA,
} from "./store.js";

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
