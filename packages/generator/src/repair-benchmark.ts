import {
  type Catalog,
  type CompilationPolicy,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ModelPlanProposal,
  modelPlanProposalSchema,
  nodeIdSchema,
  type Result,
  type SemanticObligation,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import type { TaskInput } from "./model.js";
import { compileModelPlanProposal } from "./pipeline.js";

export const deterministicPlanMutationSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({ kind: z.literal("redirectRoot"), root: nodeIdSchema })
    .readonly(),
  z
    .strictObject({ kind: z.literal("bypassUnaryNode"), nodeId: nodeIdSchema })
    .readonly(),
]);

export type DeterministicPlanMutation = z.infer<
  typeof deterministicPlanMutationSchema
>;
export type DeterministicPlanMutationInput = z.input<
  typeof deterministicPlanMutationSchema
>;

function mutationDiagnostic(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message, {
    path: ["deterministicMutation"],
  });
}

function replaceDependency(
  node: ModelPlanProposal["nodes"][number],
  target: string,
  replacement: ModelPlanProposal["root"],
): ModelPlanProposal["nodes"][number] {
  switch (node.op) {
    case "input":
    case "constant":
      return node;
    case "invoke":
    case "map":
    case "filter":
    case "fold":
    case "effect":
    case "checkpoint":
      return node.source === target ? { ...node, source: replacement } : node;
    case "select":
      return {
        ...node,
        condition: node.condition === target ? replacement : node.condition,
        whenTrue: node.whenTrue === target ? replacement : node.whenTrue,
        whenFalse: node.whenFalse === target ? replacement : node.whenFalse,
      };
    case "boundedFix":
      return node.seed === target ? { ...node, seed: replacement } : node;
  }
}

export function applyDeterministicPlanMutation(
  proposalInput: unknown,
  mutationInput: DeterministicPlanMutationInput,
): Result<ModelPlanProposal, Diagnostic> {
  const proposal = modelPlanProposalSchema.safeParse(proposalInput);
  if (!proposal.success)
    return {
      ok: false,
      error: mutationDiagnostic("Repair benchmark source proposal is invalid."),
    };
  const mutation = deterministicPlanMutationSchema.safeParse(mutationInput);
  if (!mutation.success)
    return {
      ok: false,
      error: mutationDiagnostic("Repair benchmark mutation is invalid."),
    };
  const parsedMutation = mutation.data;
  if (parsedMutation.kind === "redirectRoot") {
    if (!proposal.data.nodes.some((node) => node.id === parsedMutation.root))
      return {
        ok: false,
        error: mutationDiagnostic("Redirected root does not exist."),
      };
    return {
      ok: true,
      value: modelPlanProposalSchema.parse({
        ...proposal.data,
        root: parsedMutation.root,
      }),
    };
  }
  const target = proposal.data.nodes.find(
    (node) => node.id === parsedMutation.nodeId,
  );
  if (
    target === undefined ||
    target.op === "input" ||
    target.op === "constant" ||
    target.op === "select" ||
    target.op === "boundedFix"
  )
    return {
      ok: false,
      error: mutationDiagnostic(
        "Bypass mutation requires an existing unary computation node.",
      ),
    };
  const nodes = proposal.data.nodes
    .filter((node) => node.id !== target.id)
    .map((node) => replaceDependency(node, target.id, target.source));
  const candidate = modelPlanProposalSchema.safeParse({
    ...proposal.data,
    root: proposal.data.root === target.id ? target.source : proposal.data.root,
    nodes,
  });
  return candidate.success
    ? { ok: true, value: candidate.data }
    : {
        ok: false,
        error: mutationDiagnostic(
          "Deterministic mutation did not produce a model proposal.",
        ),
      };
}

export type SharedRepairTrial = Readonly<{
  initialProposal: ModelPlanProposal;
  initialProposalDigest: string;
  arms: Readonly<{
    withoutRepair: string;
    compilerGuidedRepair: string;
  }>;
  eligibility: "eligible" | "repair-unnecessary";
  diagnostics: ReadonlyArray<Diagnostic>;
}>;

export async function prepareSharedRepairTrial(
  input: Readonly<{
    validProposal: unknown;
    mutation: DeterministicPlanMutationInput;
    catalog: Catalog;
    policy: CompilationPolicy;
    taskInputs: ReadonlyArray<TaskInput>;
    semanticObligations: ReadonlyArray<SemanticObligation>;
  }>,
): Promise<Result<SharedRepairTrial, Diagnostic>> {
  const mutated = applyDeterministicPlanMutation(
    input.validProposal,
    input.mutation,
  );
  if (!mutated.ok) return mutated;
  const digest = await digestValue(mutated.value);
  if (!digest.ok) return digest;
  const compilation = await compileModelPlanProposal(
    mutated.value,
    input.catalog,
    input.policy,
    input.taskInputs,
    input.semanticObligations,
  );
  const eligibility =
    compilation.executablePlan === undefined
      ? "eligible"
      : "repair-unnecessary";
  return {
    ok: true,
    value: Object.freeze({
      initialProposal: mutated.value,
      initialProposalDigest: digest.value,
      arms: Object.freeze({
        withoutRepair: digest.value,
        compilerGuidedRepair: digest.value,
      }),
      eligibility,
      diagnostics: compilation.diagnostics,
    }),
  };
}
