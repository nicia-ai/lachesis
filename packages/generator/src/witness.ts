import {
  type CompilationPolicy,
  type Diagnostic,
  diagnostic,
  type PlanLanguageManifest,
  type SemanticObligation,
} from "@nicia-ai/lachesis";

import {
  type UnplannableWitness,
  type UnplannableWitnessInput,
  unplannableWitnessSchema,
} from "./model.js";

function sameOperation(
  left: Readonly<{ id: string; version: string }>,
  right: Readonly<{ id: string; version: string }>,
): boolean {
  return left.id === right.id && left.version === right.version;
}

function operationIsRequired(
  witness: UnplannableWitness,
  manifest: PlanLanguageManifest,
  obligations: ReadonlyArray<SemanticObligation>,
): boolean {
  return obligations.some((obligation) => {
    if (
      obligation.kind === "requiresOperation" ||
      obligation.kind === "operationDominatesRoot"
    )
      return sameOperation(obligation.operation, witness.operation);
    if (obligation.kind !== "requiresEffect") return false;
    const operation = manifest.operations.find((candidate) =>
      sameOperation(candidate.reference, witness.operation),
    );
    return operation?.effect?.name === obligation.effectName;
  });
}

function requiredMinimum(
  witness: Extract<
    UnplannableWitness,
    Readonly<{ kind: "insufficientBudget" }>
  >,
  manifest: PlanLanguageManifest,
): number | undefined {
  const operation = manifest.operations.find((candidate) =>
    sameOperation(candidate.reference, witness.operation),
  );
  if (operation === undefined) return undefined;
  switch (witness.resource) {
    case "maxEffectCalls":
      return operation.kind === "effect" ? 1 : undefined;
    case "maxRecursionDepth":
      return operation.kind === "fixedPointStep" ? 1 : undefined;
    case "maxTokens":
      return operation.kind === "effect"
        ? operation.bounds.maxTokens
        : undefined;
    case "maxWallClockMs":
      return operation.kind === "effect"
        ? operation.bounds.maxWallClockMs
        : undefined;
  }
}

export function validateUnplannableWitness(
  witnessInput: UnplannableWitnessInput,
  manifest: PlanLanguageManifest,
  policy: CompilationPolicy,
  obligations: ReadonlyArray<SemanticObligation>,
): ReadonlyArray<Diagnostic> {
  const parsed = unplannableWitnessSchema.safeParse(witnessInput);
  if (!parsed.success)
    return [
      diagnostic(
        "INVALID_INFEASIBILITY_WITNESS",
        "Unplannable witness does not match the typed witness contract.",
        { path: ["witness"] },
        [],
        { repair: { path: ["witness"] } },
      ),
    ];
  const witness = parsed.data;
  const operation = manifest.operations.find((candidate) =>
    sameOperation(candidate.reference, witness.operation),
  );
  let valid = operationIsRequired(witness, manifest, obligations);
  if (witness.kind === "missingOperation")
    valid = valid && operation === undefined;
  else if (witness.kind === "deniedCapability")
    valid =
      valid &&
      operation?.kind === "effect" &&
      operation.effect?.capability === witness.capability &&
      !policy.allowedCapabilities.includes(witness.capability);
  else {
    const minimum = requiredMinimum(witness, manifest);
    valid =
      valid &&
      minimum !== undefined &&
      witness.requiredMinimum === minimum &&
      policy.budget[witness.resource] < minimum;
  }
  return valid
    ? []
    : [
        diagnostic(
          "INVALID_INFEASIBILITY_WITNESS",
          "Unplannable witness is not proven by the exact task obligations, language manifest, and trusted policy.",
          { path: ["witness"] },
          [{ key: "witnessKind", value: witness.kind }],
          { repair: { path: ["witness"] } },
        ),
      ];
}
