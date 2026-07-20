export {
  CURRENT_TYPEGRAPH_SNAPSHOT,
  M4C_TYPEGRAPH_ADAPTER_VERSION,
  M4C_TYPEGRAPH_SCHEMA_VERSION,
  TYPEGRAPH_PACKAGE_VERSION,
  type TypeGraphAdapterFailure,
  typeGraphAdapterFailureSchema,
  type TypeGraphAdapterIdentity,
  typeGraphAdapterIdentitySchema,
  type TypeGraphBackendIdentity,
  typeGraphBackendIdentitySchema,
  type TypeGraphEvidenceRepository,
  type TypeGraphEvidenceSnapshot,
  type TypeGraphSnapshotCoordinate,
  typeGraphSnapshotCoordinateSchema,
  type TypeGraphSnapshotIdentity,
  typeGraphSnapshotIdentitySchema,
} from "./contract.js";
export {
  createTypeGraphEvidenceRepository,
  TYPEGRAPH_EVIDENCE_SCHEMA,
} from "./store.js";
