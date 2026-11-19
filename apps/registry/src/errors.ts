export const REGISTRY_ERROR_CODES = [
  "USAGE",
  "TOOL_FAILURE",
  "MALFORMED_DOCUMENT",
  "NON_CANONICAL",
  "UNEXPECTED_FILE",
  "CHAIN_BROKEN",
  "SIGNATURE_INVALID",
  "TIMESTAMP_INVALID",
  "CONTENT_MISMATCH",
  "HISTORY_REWRITTEN",
  "WITNESS_DIVERGED",
  "STATE_CONFLICT",
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

export type RegistryError = Readonly<{
  code: RegistryErrorCode;
  message: string;
}>;

export function registryError(
  code: RegistryErrorCode,
  message: string,
): RegistryError {
  return { code, message };
}
