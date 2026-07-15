import { z } from "zod";

export const DIAGNOSTIC_CODES = [
  "MALFORMED_JSON",
  "INVALID_WIRE_SCHEMA",
  "UNSUPPORTED_PLAN_VERSION",
  "DUPLICATE_NODE_ID",
  "MISSING_ROOT",
  "MISSING_NODE_REFERENCE",
  "GRAPH_CYCLE",
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
  "RUNTIME_SCHEMA_VIOLATION",
  "MISSING_REPLAY_RESULT",
  "INTERNAL_INVARIANT_VIOLATION",
] as const;

export const diagnosticCodeSchema = z.enum(DIAGNOSTIC_CODES);
export type DiagnosticCode = z.infer<typeof diagnosticCodeSchema>;

export type DiagnosticLocation = Readonly<{
  nodeId?: string | undefined;
  path?: ReadonlyArray<string | number> | undefined;
}>;

export type Diagnostic = Readonly<{
  code: DiagnosticCode;
  message: string;
  location: DiagnosticLocation;
  details: ReadonlyArray<
    Readonly<{ key: string; value: string | number | boolean }>
  >;
}>;

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  location: DiagnosticLocation = {},
  details: Diagnostic["details"] = [],
): Diagnostic {
  return { code, message, location, details };
}
