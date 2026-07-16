import { z } from "zod";

export const DIAGNOSTIC_CODES = [
  "MALFORMED_JSON",
  "INVALID_WIRE_SCHEMA",
  "UNSUPPORTED_PLAN_VERSION",
  "DUPLICATE_NODE_ID",
  "MISSING_ROOT",
  "MISSING_NODE_REFERENCE",
  "GRAPH_CYCLE",
  "DEAD_NODE",
  "UNKNOWN_SCHEMA",
  "UNKNOWN_OPERATION",
  "OPERATION_KIND_MISMATCH",
  "TYPE_MISMATCH",
  "INVALID_REDUCER",
  "BRANCH_TYPE_MISMATCH",
  "UNDECLARED_EFFECT",
  "DENIED_CAPABILITY",
  "UNBOUNDED_CARDINALITY",
  "UNBOUNDED_RECURSION",
  "NON_DECREASING_RECURSION_MEASURE",
  "BUDGET_EXCEEDED",
  "SEMANTIC_OBLIGATION_FAILED",
  "INVALID_INFEASIBILITY_WITNESS",
  "RUNTIME_SCHEMA_VIOLATION",
  "MISSING_REPLAY_RESULT",
  "REPLAY_REQUEST_MISMATCH",
  "REPLAY_OUTPUT_MISMATCH",
  "INVALID_EXECUTABLE_PLAN",
  "CATALOG_REFERENCE_MISMATCH",
  "INTERNAL_INVARIANT_VIOLATION",
] as const;

export const diagnosticCodeSchema = z.enum(DIAGNOSTIC_CODES);
export type DiagnosticCode = z.infer<typeof diagnosticCodeSchema>;

export type DiagnosticLocation = Readonly<{
  nodeId?: string | undefined;
  path?: ReadonlyArray<string | number> | undefined;
}>;

export type DiagnosticReference = Readonly<{
  kind: "schema" | "operation" | "catalog" | "effectRequest";
  id: string;
  version?: string | undefined;
}>;

export type DiagnosticValue = Readonly<{
  schema?: Readonly<{ id: string; version: string }> | undefined;
  reference?: DiagnosticReference | undefined;
  value?: string | number | boolean | undefined;
}>;

export type DiagnosticLimit = Readonly<{
  resource: string;
  limit: number;
  actual: number;
}>;

export type DiagnosticContext = Readonly<{
  expected?: DiagnosticValue | undefined;
  actual?: DiagnosticValue | undefined;
  limit?: DiagnosticLimit | undefined;
  repair?: DiagnosticLocation | undefined;
}>;

export type Diagnostic = Readonly<{
  code: DiagnosticCode;
  message: string;
  location: DiagnosticLocation;
  details: ReadonlyArray<
    Readonly<{ key: string; value: string | number | boolean }>
  >;
  expected?: DiagnosticValue | undefined;
  actual?: DiagnosticValue | undefined;
  limit?: DiagnosticLimit | undefined;
  repair?: DiagnosticLocation | undefined;
}>;

export type Diagnostics = ReadonlyArray<Diagnostic>;

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  location: DiagnosticLocation = {},
  details: Diagnostic["details"] = [],
  context: DiagnosticContext = {},
): Diagnostic {
  return { code, message, location, details, ...context };
}
