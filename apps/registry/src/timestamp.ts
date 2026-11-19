import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "@nicia-ai/lachesis";

import { type RegistryError, registryError } from "./errors.js";
import {
  decodeText,
  runChecked,
  runProcess,
  withTemporaryDirectory,
} from "./process.js";
import type { TimestampAuthority } from "./schema.js";

const TSA_QUERY_CONTENT_TYPE = "application/timestamp-query";
const TSA_REPLY_CONTENT_TYPE = "application/timestamp-reply";
const TSA_TIMEOUT_MS = 30_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function timestampError(message: string): Result<never, RegistryError> {
  return { ok: false, error: registryError("TIMESTAMP_INVALID", message) };
}

/** Sends an RFC 3161 query for a SHA-256 digest and returns the raw response. */
export async function requestTimestamp(
  authority: TimestampAuthority,
  digestHex: string,
): Promise<Result<Uint8Array, RegistryError>> {
  const query = await withTemporaryDirectory(async (directory) => {
    const queryPath = join(directory, "query.tsq");
    const created = await runChecked(
      "openssl",
      [
        "ts",
        "-query",
        "-digest",
        digestHex,
        "-sha256",
        "-cert",
        "-out",
        queryPath,
      ],
      { cwd: directory },
    );
    return created.ok
      ? { ok: true as const, value: new Uint8Array(await readFile(queryPath)) }
      : created;
  });
  if (!query.ok) return query;
  try {
    const response = await fetch(authority.url, {
      method: "POST",
      headers: { "content-type": TSA_QUERY_CONTENT_TYPE },
      body: query.value,
      signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
    });
    if (
      !response.ok ||
      response.headers
        .get("content-type")
        ?.startsWith(TSA_REPLY_CONTENT_TYPE) !== true
    )
      return timestampError(
        `${authority.name} answered HTTP ${response.status} with ${response.headers.get("content-type") ?? "no content type"}.`,
      );
    return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown failure";
    return timestampError(`${authority.name} request failed: ${message}`);
  }
}

export function parseTimestampTime(text: string): Date | undefined {
  const match =
    /^Time stamp: ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)? (\d{4}) GMT$/m.exec(
      text,
    );
  if (match === null) return undefined;
  const [, month, day, hour, minute, second, fraction, year] = match;
  const monthIndex = MONTHS.findIndex((name) => name === month);
  if (monthIndex < 0) return undefined;
  return new Date(
    Date.UTC(
      Number(year),
      monthIndex,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number((fraction ?? "0").padEnd(3, "0")),
    ),
  );
}

/** Verifies a stored RFC 3161 response against a digest and a pinned CA bundle. */
export function verifyTimestamp(
  response: Uint8Array,
  digestHex: string,
  caBundle: Uint8Array,
): Promise<Result<Date, RegistryError>> {
  return withTemporaryDirectory(async (directory) => {
    const responsePath = join(directory, "response.tsr");
    const caPath = join(directory, "ca.pem");
    await writeFile(responsePath, response);
    await writeFile(caPath, caBundle);
    const verified = await runProcess(
      "openssl",
      [
        "ts",
        "-verify",
        "-digest",
        digestHex,
        "-in",
        responsePath,
        "-CAfile",
        caPath,
      ],
      { cwd: directory },
    );
    if (!verified.ok) return verified;
    if (verified.value.status !== 0)
      return timestampError(
        "Timestamp does not verify for this digest and CA bundle.",
      );
    const described = await runChecked(
      "openssl",
      ["ts", "-reply", "-in", responsePath, "-text"],
      { cwd: directory },
    );
    if (!described.ok) return described;
    const text = decodeText(described.value);
    const time = parseTimestampTime(text);
    if (!/^Status: Granted\.$/m.test(text) || time === undefined)
      return timestampError("Timestamp response is not a granted token.");
    return { ok: true, value: time };
  });
}
