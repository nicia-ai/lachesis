import type { CommandReport } from "./report-schema.js";

function escapedCodePoint(character: string): string {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return "";
  return `\\u${codePoint.toString(16).padStart(4, "0")}`;
}

export function escapeTerminalText(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined &&
        (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))
        ? escapedCodePoint(character)
        : character;
    })
    .join("");
}

function location(
  value: Readonly<{
    artifactId?: string | undefined;
    fieldPath: ReadonlyArray<string | number>;
  }>,
): string {
  const artifact =
    value.artifactId === undefined
      ? ""
      : ` artifact=${escapeTerminalText(value.artifactId)}`;
  const path =
    value.fieldPath.length === 0
      ? ""
      : ` path=${escapeTerminalText(value.fieldPath.join("."))}`;
  return `${artifact}${path}`;
}

function validationLocation(
  value: Readonly<{
    nodeId?: string | undefined;
    path?: ReadonlyArray<string | number> | undefined;
  }>,
): string {
  const node =
    value.nodeId === undefined
      ? ""
      : ` operation=${escapeTerminalText(value.nodeId)}`;
  const path =
    value.path === undefined || value.path.length === 0
      ? ""
      : ` path=${escapeTerminalText(value.path.join("."))}`;
  return `${node}${path}`;
}

export function renderCommandReport(report: CommandReport): string {
  const lines = [
    `Lachesis catalog report: ${report.status} (exit ${report.outcomeExitCode})`,
    `command=${report.command.id} identity=${report.command.commandIdentity}`,
  ];

  if (report.outcomeExitCode === 22)
    lines.push(
      "INTEGRITY FAILURE: report, nested identity, or artifact verification failed.",
    );
  if (report.outcomeExitCode === 23)
    lines.push("INCOMPLETE: no compatibility decision was made.");
  if (report.outcomeExitCode === 20)
    lines.push("INVALID OR UNVERIFIABLE: no compatibility decision was made.");

  for (const diagnostic of report.diagnostics.controller) {
    lines.push(
      `${diagnostic.code}${location(diagnostic.location)}: ${escapeTerminalText(diagnostic.message)}`,
    );
  }
  for (const attempt of report.diagnostics.validationAttempts) {
    for (const diagnostic of attempt.diagnostics) {
      lines.push(
        `${diagnostic.code}${validationLocation(diagnostic.location)}: ${escapeTerminalText(diagnostic.message)}`,
      );
    }
  }
  for (const record of report.diagnostics.conformance) {
    const diagnostic = record.diagnostic;
    if (diagnostic === null) continue;
    const role =
      diagnostic.role === null
        ? "none"
        : `${escapeTerminalText(diagnostic.role.id)}@${escapeTerminalText(diagnostic.role.version)}`;
    lines.push(
      `${diagnostic.code} role=${role} boundary=${escapeTerminalText(diagnostic.boundary)} obligation=${escapeTerminalText(diagnostic.obligation)}`,
      `  ${escapeTerminalText(diagnostic.explanation)}`,
    );
    switch (diagnostic.action.kind) {
      case "review-declaration":
        lines.push(
          `  CONDITIONAL DECLARATION REPAIR: ${escapeTerminalText(diagnostic.action.patchDescription)}`,
          `  Safety condition: ${escapeTerminalText(diagnostic.action.safetyCondition)}`,
          "  Not accepted automatically.",
        );
        break;
      case "edit-suite":
        lines.push(
          `  INSUFFICIENT EVIDENCE: ${escapeTerminalText(diagnostic.action.patchDescription)}`,
          "  Preserve rejection until the added evidence is evaluated.",
        );
        break;
      case "do-not-substitute":
        lines.push(
          "  DO NOT SUBSTITUTE",
          `  ${escapeTerminalText(diagnostic.action.reason)}`,
        );
        break;
      case "no-safe-repair":
        lines.push(
          "  NO SAFE REPAIR",
          `  ${escapeTerminalText(diagnostic.action.reason)}`,
        );
        break;
    }
  }
  for (const migration of report.migrations) {
    switch (migration.guidance.kind) {
      case "recompile-and-retain":
        lines.push(
          `IDENTITY-ONLY ${migration.comparisonIdentity}: ${escapeTerminalText(migration.guidance.explanation)}`,
          "  This records a finite conformance result, not universal semantic compatibility.",
        );
        break;
      case "review-required":
        lines.push(
          `REVIEW REQUIRED ${migration.comparisonIdentity}: ${escapeTerminalText(migration.guidance.explanation)}`,
          "  Not accepted automatically.",
        );
        break;
      case "review-declaration":
        lines.push(
          `CONDITIONAL DECLARATION REPAIR ${migration.comparisonIdentity}: ${escapeTerminalText(migration.guidance.explanation)}`,
          `  Safety condition: ${escapeTerminalText(migration.guidance.safetyCondition)}`,
          "  Not accepted automatically.",
        );
        break;
      case "do-not-substitute":
        lines.push(
          `DO NOT SUBSTITUTE ${migration.comparisonIdentity}: ${escapeTerminalText(migration.guidance.explanation)}`,
          `  Violated obligation: ${escapeTerminalText(migration.guidance.violatedObligation)}`,
        );
        break;
      case "invalid-or-unverifiable":
        lines.push(
          `INVALID OR UNVERIFIABLE ${migration.comparisonIdentity}: ${escapeTerminalText(migration.guidance.explanation)}`,
        );
        break;
    }
  }
  return `${lines.join("\n")}\n`;
}
