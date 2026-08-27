import { type Result } from "@nicia-ai/lachesis";

import { type M9b13k3Failure,m9b13k3Failure } from "./protocol.js";

export const M9B13K3_PATH_IDENTITY_PROTOCOL =
  "lachesis-m9b13k3-path-identity-feasibility/1" as const;

export type M9b13k3PathIdentityFeasibility = Readonly<{
  protocol: typeof M9B13K3_PATH_IDENTITY_PROTOCOL;
  descriptorRelativeSqliteOpen: false;
  auditToOpenIdentityPinned: false;
  decision: "m9b13k3-path-identity-no-go";
  reason: "node-database-sync-accepts-pathnames-not-open-descriptors";
}>;

/**
 * Records the platform boundary without pretending that a pre-open lstat audit
 * closes the replacement window before DatabaseSync opens a pathname.
 */
export function inspectM9b13k3PathIdentityFeasibility(): M9b13k3PathIdentityFeasibility {
  return Object.freeze({
    protocol: M9B13K3_PATH_IDENTITY_PROTOCOL,
    descriptorRelativeSqliteOpen: false,
    auditToOpenIdentityPinned: false,
    decision: "m9b13k3-path-identity-no-go",
    reason: "node-database-sync-accepts-pathnames-not-open-descriptors",
  });
}

export function requireM9b13k3PathIdentityGuarantee(): Result<
  never,
  M9b13k3Failure
> {
  return m9b13k3Failure(
    "ledger",
    "m9b13k3-path-identity-unavailable-with-node-database-sync",
  );
}
