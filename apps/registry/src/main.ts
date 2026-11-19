import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  prepareEntry,
  type PrepareRequest,
  sealEntry,
  toRepositoryPath,
  verifyRegistry,
  type VerifyReport,
  writeManifest,
} from "./commands.js";
import { type RegistryError, registryError } from "./errors.js";
import { openRepository, type Repository } from "./git.js";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export type CliIo = Readonly<{
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}>;

const USAGE = `Usage:
  lachesis-registry manifest <package-directory>
  lachesis-registry prepare genesis --study <s> --principal <p> --public-key <key.pub>
      --tsa <name>=<url> --tsa <name>=<url> [--external-root <label>=<sha256>]
  lachesis-registry prepare registration --study <s> --revision <r> --manifest <path> --authorizes <phase>
  lachesis-registry prepare result --study <s> --revision <r> --manifest <path> --reports-on <sequence>
  lachesis-registry seal --study <s> --key <ssh-private-key> [--no-push]
  lachesis-registry verify [--study <s>] [--revision <rev>] [--offline] [--json]`;

const COMMANDS = ["manifest", "prepare", "seal", "verify"] as const;
const PREPARE_KINDS = ["genesis", "registration", "result"] as const;

class UsageError extends Error {}

function oneOf<T extends string>(
  allowed: ReadonlyArray<T>,
  value: string | undefined,
  label: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined)
    throw new UsageError(`${label} must be one of ${allowed.join(", ")}.`);
  return match;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0)
    throw new UsageError(`${flag} is required.`);
  return value;
}

function pairs(
  values: ReadonlyArray<string> | undefined,
  flag: string,
): ReadonlyArray<readonly [string, string]> {
  return (values ?? []).map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new UsageError(`${flag} expects key=value.`);
    return [value.slice(0, separator), value.slice(separator + 1)] as const;
  });
}

function reportErrors(io: CliIo, errors: ReadonlyArray<RegistryError>): number {
  for (const error of errors) io.stderr(`${error.code}: ${error.message}\n`);
  return EXIT_FAILED;
}

function repositoryPath(
  repository: Repository,
  io: CliIo,
  path: string,
): string {
  const resolved = toRepositoryPath(repository, io.cwd, path);
  if (!resolved.ok) throw new UsageError(resolved.error.message);
  return resolved.value;
}

function prepareRequest(
  repository: Repository,
  io: CliIo,
  args: ReadonlyArray<string>,
): PrepareRequest {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      study: { type: "string" },
      principal: { type: "string" },
      "public-key": { type: "string" },
      tsa: { type: "string", multiple: true },
      "external-root": { type: "string", multiple: true },
      revision: { type: "string" },
      manifest: { type: "string" },
      authorizes: { type: "string" },
      "reports-on": { type: "string" },
    },
  });
  const study = required(values.study, "--study");
  const kind = oneOf(PREPARE_KINDS, positionals[0], "prepare kind");
  switch (kind) {
    case "genesis":
      return {
        kind,
        study,
        principal: required(values.principal, "--principal"),
        publicKeyPath: resolve(
          io.cwd,
          required(values["public-key"], "--public-key"),
        ),
        authorities: pairs(values.tsa, "--tsa").map(([name, url]) => ({
          name,
          url,
        })),
        externalRoots: pairs(values["external-root"], "--external-root").map(
          ([label, sha256]) => ({ label, sha256 }),
        ),
      };
    case "registration":
      return {
        kind,
        study,
        revision: required(values.revision, "--revision"),
        manifestPath: repositoryPath(
          repository,
          io,
          required(values.manifest, "--manifest"),
        ),
        authorizes: required(values.authorizes, "--authorizes"),
      };
    case "result": {
      const reportsOn = Number(required(values["reports-on"], "--reports-on"));
      if (!Number.isSafeInteger(reportsOn) || reportsOn < 0)
        throw new UsageError("--reports-on must be a nonnegative integer.");
      return {
        kind,
        study,
        revision: required(values.revision, "--revision"),
        manifestPath: repositoryPath(
          repository,
          io,
          required(values.manifest, "--manifest"),
        ),
        reportsOn,
      };
    }
  }
}

function renderReport(report: VerifyReport): string {
  const lines = [`revision ${report.revision}`];
  for (const study of report.studies) {
    lines.push(
      `${study.study}: ${study.entries.length} sealed, ${study.pending} pending, signer ${study.signerFingerprint ?? "none"}`,
    );
    for (const entry of study.entries)
      lines.push(
        `  ${String(entry.sequence).padStart(4, "0")} ${entry.kind}${entry.revision === undefined ? "" : ` ${entry.revision}`} ${entry.timestamps
          .map((timestamp) => `${timestamp.authority}@${timestamp.time}`)
          .join(" ")}`,
      );
  }
  for (const name of report.witnessesChecked)
    lines.push(`witness ${name}: checked`);
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  lines.push(
    report.errors.length === 0
      ? "OK"
      : `FAILED (${report.errors.length} errors)`,
  );
  return `${lines.join("\n")}\n`;
}

async function dispatch(
  command: string | undefined,
  args: ReadonlyArray<string>,
  io: CliIo,
): Promise<number> {
  const repository = await openRepository(io.cwd);
  if (!repository.ok) return reportErrors(io, [repository.error]);
  switch (oneOf(COMMANDS, command, "command")) {
    case "manifest": {
      const { positionals } = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
      });
      const directory = repositoryPath(
        repository.value,
        io,
        required(positionals[0], "<package-directory>"),
      );
      const written = await writeManifest(repository.value, directory);
      if (!written.ok) return reportErrors(io, written.error);
      io.stdout(`${written.value}\n`);
      return EXIT_OK;
    }
    case "prepare": {
      const prepared = await prepareEntry(
        repository.value,
        prepareRequest(repository.value, io, args),
      );
      if (!prepared.ok) return reportErrors(io, prepared.error);
      io.stdout(`${prepared.value}\n`);
      return EXIT_OK;
    }
    case "seal": {
      const { values } = parseArgs({
        args: [...args],
        strict: true,
        options: {
          study: { type: "string" },
          key: { type: "string" },
          "no-push": { type: "boolean" },
        },
      });
      const sealed = await sealEntry(repository.value, {
        study: required(values.study, "--study"),
        privateKeyPath: resolve(io.cwd, required(values.key, "--key")),
        push: values["no-push"] !== true,
      });
      if (!sealed.ok) return reportErrors(io, sealed.error);
      io.stdout(
        `sealed ${sealed.value.entryPath} ${sealed.value.timestamps
          .map((timestamp) => `${timestamp.authority}@${timestamp.time}`)
          .join(" ")}\n`,
      );
      return sealed.value.pushErrors.length === 0
        ? EXIT_OK
        : reportErrors(io, sealed.value.pushErrors);
    }
    case "verify": {
      const { values } = parseArgs({
        args: [...args],
        strict: true,
        options: {
          study: { type: "string" },
          revision: { type: "string" },
          offline: { type: "boolean" },
          json: { type: "boolean" },
        },
      });
      const verified = await verifyRegistry(repository.value, {
        revision: values.revision ?? "HEAD",
        study: values.study,
        offline: values.offline === true,
      });
      if (!verified.ok) return reportErrors(io, verified.error);
      io.stdout(
        values.json === true
          ? `${JSON.stringify(verified.value, undefined, 2)}\n`
          : renderReport(verified.value),
      );
      return verified.value.errors.length === 0
        ? EXIT_OK
        : reportErrors(io, verified.value.errors);
    }
  }
}

export async function runCli(
  argv: ReadonlyArray<string>,
  io: CliIo,
): Promise<number> {
  const [command, ...args] = argv;
  try {
    const cwd = await realpath(io.cwd);
    return await dispatch(command, args, { ...io, cwd });
  } catch (error: unknown) {
    if (
      error instanceof UsageError ||
      (error instanceof TypeError && "code" in error)
    ) {
      io.stderr(`USAGE: ${error.message}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    const message = error instanceof Error ? error.message : "unknown failure";
    return reportErrors(io, [registryError("TOOL_FAILURE", message)]);
  }
}
