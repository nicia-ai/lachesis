import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceContext,
  evidenceContextSchema,
  type EvidenceEdge,
  type EvidenceFact,
  type EvidenceNeighborhood,
  evidenceNeighborhoodSchema,
  type EvidencePath,
  evidenceQuerySchema,
  type EvidenceSource,
  referenceEvidenceSelection,
  selectEvidence,
} from "./contract.js";
import {
  type M3a1Category,
  type M3bAnswerContract,
  m3bAnswerContractSchema,
} from "./corpus.js";
import {
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
  type EvidenceGraph,
  evidenceGraphSchema,
  validateEvidenceGraph,
} from "./graph.js";
import { createMatchedTextEvidenceSource } from "./text.js";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const m4ProviderSchema = z.enum(["openai", "anthropic"]);
export const m4TaskClassSchema = z.enum([
  "relational",
  "non-relational",
  "negative-control",
]);
export const m4EvidenceViewSchema = z.enum([
  "lexical-facts",
  "graph-facts",
  "graph-adjacency",
  "graph-typed",
]);

export const m4ProviderProfileSchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    provider: m4ProviderSchema,
  })
  .readonly();

export const m4PublicTaskProfileSchema = z
  .strictObject({
    taskClass: m4TaskClassSchema,
    answerContract: m3bAnswerContractSchema,
  })
  .readonly();

const m4PolicyRuleSchema = z
  .strictObject({
    provider: m4ProviderSchema,
    taskClass: m4TaskClassSchema,
    view: m4EvidenceViewSchema,
  })
  .readonly();

export const m4EvidenceCompilerPolicySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    status: z.literal("development-hypothesis"),
    basis: z.literal("m3-development-evidence"),
    rules: z.array(m4PolicyRuleSchema).length(6).readonly(),
    experimentalControlView: z.literal("graph-facts"),
  })
  .superRefine((policy, context) => {
    const keys = policy.rules.map(
      (rule) => `${rule.provider}/${rule.taskClass}`,
    );
    const required = m4ProviderSchema.options.flatMap((provider) =>
      m4TaskClassSchema.options.map((taskClass) => `${provider}/${taskClass}`),
    );
    if (
      new Set(keys).size !== required.length ||
      required.some((key) => !keys.includes(key))
    )
      context.addIssue({
        code: "custom",
        message:
          "Policy must define exactly one rule for every provider/task class.",
        path: ["rules"],
      });
    if (policy.rules.some((rule) => rule.view === "graph-facts"))
      context.addIssue({
        code: "custom",
        message: "Graph facts are an experimental control, not a default view.",
        path: ["rules"],
      });
  })
  .readonly();

export type M4Provider = z.infer<typeof m4ProviderSchema>;
export type M4TaskClass = z.infer<typeof m4TaskClassSchema>;
export type M4EvidenceView = z.infer<typeof m4EvidenceViewSchema>;
export type M4ProviderProfile = z.infer<typeof m4ProviderProfileSchema>;
export type M4PublicTaskProfile = z.infer<typeof m4PublicTaskProfileSchema>;
export type M4EvidenceCompilerPolicy = z.infer<
  typeof m4EvidenceCompilerPolicySchema
>;

export function classifyM4TaskCategory(category: M3a1Category): M4TaskClass {
  switch (category) {
    case "negative-control":
      return "negative-control";
    case "temporal":
    case "retraction":
      return "non-relational";
    case "multi-hop":
    case "contradiction":
    case "provenance":
      return "relational";
  }
}

export const M4A_EVIDENCE_COMPILER_PROTOCOL = Object.freeze({
  id: "m4a-provider-aware-evidence-compiler",
  version: "2",
  status: "offline-development-policy",
  evidenceBasis: "m3-development-evidence",
  liveInferenceAuthorized: false,
  campaignMaterializationAuthorized: false,
  heldoutMaterializationAuthorized: false,
  typeGraphIntegrated: false,
});

export const M4A_PROVIDER_PROFILES: Readonly<
  Record<M4Provider, M4ProviderProfile>
> = Object.freeze({
  openai: m4ProviderProfileSchema.parse({
    id: "openai-evidence-view-profile",
    version: "1",
    provider: "openai",
  }),
  anthropic: m4ProviderProfileSchema.parse({
    id: "anthropic-evidence-view-profile",
    version: "1",
    provider: "anthropic",
  }),
});

export const M4A_INITIAL_POLICY: M4EvidenceCompilerPolicy =
  m4EvidenceCompilerPolicySchema.parse({
    id: "lachesis-m4-provider-aware-evidence-view",
    version: "1",
    status: "development-hypothesis",
    basis: "m3-development-evidence",
    rules: [
      {
        provider: "openai",
        taskClass: "relational",
        view: "graph-adjacency",
      },
      {
        provider: "openai",
        taskClass: "non-relational",
        view: "lexical-facts",
      },
      {
        provider: "openai",
        taskClass: "negative-control",
        view: "lexical-facts",
      },
      {
        provider: "anthropic",
        taskClass: "relational",
        view: "graph-typed",
      },
      {
        provider: "anthropic",
        taskClass: "non-relational",
        view: "lexical-facts",
      },
      {
        provider: "anthropic",
        taskClass: "negative-control",
        view: "lexical-facts",
      },
    ],
    experimentalControlView: "graph-facts",
  });

const m4FailureCodeSchema = z.enum([
  "INVALID_POLICY",
  "INVALID_PROVIDER",
  "INVALID_TASK_CLASS",
  "INVALID_GRAPH",
  "INVALID_QUERY",
  "SOURCE_FAILURE",
  "IDENTITY_FAILURE",
  "INVALID_COMPILED_VIEW",
  "INVALID_ORACLE_ANSWER",
  "SEMANTIC_OBLIGATION_FAILED",
]);

export const m4DiagnosticIssueSchema = z
  .strictObject({
    code: z.string().min(1),
    path: z
      .array(z.union([z.string(), z.number().int().nonnegative()]))
      .readonly(),
  })
  .readonly();

export const m4FailureSchema = z
  .strictObject({
    code: m4FailureCodeSchema,
    message: z.string().min(1),
    issues: z.array(m4DiagnosticIssueSchema).readonly(),
  })
  .readonly();

export type M4DiagnosticIssue = z.infer<typeof m4DiagnosticIssueSchema>;
export type M4Failure = z.infer<typeof m4FailureSchema>;

const m4CompiledViewEntrySchema = z
  .strictObject({
    view: m4EvidenceViewSchema,
    neighborhood: evidenceNeighborhoodSchema,
    neighborhoodDigest: sha256Schema,
  })
  .readonly();

const m4AvailableViewDigestSchema = z
  .strictObject({
    view: m4EvidenceViewSchema,
    neighborhoodDigest: sha256Schema,
  })
  .readonly();

const m4SelectorDescriptorSchema = z
  .strictObject({
    view: m4EvidenceViewSchema,
    selection: z.enum(["lexical", "graph"]),
    encoding: z.enum(["facts", "untyped-adjacency", "typed-relationships"]),
    implementation: z.string().min(1),
  })
  .readonly();

export const m4SelectorManifestSchema = z
  .array(m4SelectorDescriptorSchema)
  .length(4)
  .readonly();

export type M4SelectorManifest = z.infer<typeof m4SelectorManifestSchema>;

const m4EvidenceCompilerIdentityBodyObject = z.strictObject({
  protocol: z.literal("m4a-provider-aware-evidence-compiler/2"),
  policyDigest: sha256Schema.brand<"M4EvidencePolicyDigest">(),
  providerProfileDigest: sha256Schema.brand<"M4ProviderProfileDigest">(),
  taskContractDigest: sha256Schema.brand<"M4TaskContractDigest">(),
  selectorManifestDigest: sha256Schema.brand<"M4SelectorManifestDigest">(),
  sourceSnapshotDigest: sha256Schema.brand<"M4SourceSnapshotDigest">(),
  queryDigest: sha256Schema.brand<"M4EvidenceQueryDigest">(),
  provider: m4ProviderSchema,
  taskClass: m4TaskClassSchema,
  selectedView: m4EvidenceViewSchema,
  experimentalControlView: z.literal("graph-facts"),
  selectedNeighborhoodDigest:
    sha256Schema.brand<"M4SelectedNeighborhoodDigest">(),
  controlNeighborhoodDigest:
    sha256Schema.brand<"M4ControlNeighborhoodDigest">(),
  visibleViewDigest: sha256Schema.brand<"M4VisibleViewDigest">(),
  availableViewDigests: z
    .array(m4AvailableViewDigestSchema)
    .length(4)
    .readonly(),
});

const m4EvidenceCompilerIdentityBodySchema =
  m4EvidenceCompilerIdentityBodyObject.readonly();

export const m4EvidenceCompilerIdentitySchema =
  m4EvidenceCompilerIdentityBodyObject
    .extend({
      compilerAuditDigest: sha256Schema.brand<"M4CompilerAuditDigest">(),
    })
    .readonly();

export const m4CompiledEvidenceViewSchema = z
  .strictObject({
    policy: m4EvidenceCompilerPolicySchema,
    providerProfile: m4ProviderProfileSchema,
    taskProfile: m4PublicTaskProfileSchema,
    selectorManifest: m4SelectorManifestSchema,
    graph: evidenceGraphSchema,
    query: evidenceQuerySchema,
    identity: m4EvidenceCompilerIdentitySchema,
    views: z.array(m4CompiledViewEntrySchema).length(4).readonly(),
    selectedNeighborhood: evidenceNeighborhoodSchema,
    experimentalControlNeighborhood: evidenceNeighborhoodSchema,
    modelVisibleContext: evidenceContextSchema,
  })
  .superRefine((compiled, context) => {
    const expected = [
      "lexical-facts",
      "graph-facts",
      "graph-adjacency",
      "graph-typed",
    ];
    if (compiled.views.some((view, index) => view.view !== expected[index]))
      context.addIssue({
        code: "custom",
        message: "Compiled views must use the canonical complete view order.",
        path: ["views"],
      });
  })
  .readonly();

export type M4EvidenceCompilerIdentity = z.infer<
  typeof m4EvidenceCompilerIdentitySchema
>;
export type M4CompiledEvidenceView = z.infer<
  typeof m4CompiledEvidenceViewSchema
>;

const M4_VIEW_ORDER: ReadonlyArray<M4EvidenceView> = Object.freeze([
  "lexical-facts",
  "graph-facts",
  "graph-adjacency",
  "graph-typed",
]);

function selectorManifest(
  views: ReadonlyArray<z.infer<typeof m4CompiledViewEntrySchema>>,
): M4SelectorManifest {
  return m4SelectorManifestSchema.parse(
    views.map((view) => ({
      view: view.view,
      selection: view.neighborhood.source.selection,
      encoding: view.neighborhood.source.encoding,
      implementation: view.neighborhood.source.implementation,
    })),
  );
}

function viewMatchesSource(
  view: M4EvidenceView,
  neighborhood: EvidenceNeighborhood,
): boolean {
  switch (view) {
    case "lexical-facts":
      return (
        neighborhood.source.selection === "lexical" &&
        neighborhood.source.encoding === "facts"
      );
    case "graph-facts":
      return (
        neighborhood.source.selection === "graph" &&
        neighborhood.source.encoding === "facts"
      );
    case "graph-adjacency":
      return (
        neighborhood.source.selection === "graph" &&
        neighborhood.source.encoding === "untyped-adjacency"
      );
    case "graph-typed":
      return (
        neighborhood.source.selection === "graph" &&
        neighborhood.source.encoding === "typed-relationships"
      );
  }
}

function failure(
  code: M4Failure["code"],
  message: string,
  issues: ReadonlyArray<M4DiagnosticIssue> = [],
): M4Failure {
  return { code, message, issues };
}

function canonicalPolicy(
  policyInput: unknown,
): Result<M4EvidenceCompilerPolicy, M4Failure> {
  const parsed = m4EvidenceCompilerPolicySchema.safeParse(policyInput);
  if (!parsed.success)
    return err(
      failure("INVALID_POLICY", "Evidence compiler policy validation failed."),
    );
  return ok(
    m4EvidenceCompilerPolicySchema.parse({
      ...parsed.data,
      rules: parsed.data.rules.toSorted((left, right) =>
        `${left.provider}/${left.taskClass}`.localeCompare(
          `${right.provider}/${right.taskClass}`,
        ),
      ),
    }),
  );
}

function canonicalGraph(graph: EvidenceGraph): EvidenceGraph {
  return {
    ...graph,
    facts: graph.facts.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    citations: graph.citations.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    edges: graph.edges.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

async function digest(
  value: unknown,
  message: string,
): Promise<Result<string, M4Failure>> {
  const identified = await digestValue(value);
  if (!identified.ok) return err(failure("IDENTITY_FAILURE", message));
  const parsed = sha256Schema.safeParse(identified.value);
  return parsed.success
    ? ok(parsed.data)
    : err(failure("IDENTITY_FAILURE", message));
}

function sourceForView(
  graph: EvidenceGraph,
  view: M4EvidenceView,
): Result<EvidenceSource, M4Failure> {
  const source = (() => {
    switch (view) {
      case "lexical-facts":
        return createMatchedTextEvidenceSource(graph);
      case "graph-facts":
        return createGraphSelectedFactsEvidenceSource(graph);
      case "graph-adjacency":
        return createGraphSelectedAdjacencyEvidenceSource(graph);
      case "graph-typed":
        return createInMemoryGraphEvidenceSource(graph);
    }
  })();
  return source.ok
    ? ok(source.value)
    : err(failure("SOURCE_FAILURE", source.error.message));
}

export async function compileM4EvidenceView(
  input: Readonly<{
    graphInput: unknown;
    queryInput: unknown;
    providerProfileInput: unknown;
    taskProfileInput: unknown;
    policyInput?: unknown;
  }>,
): Promise<Result<M4CompiledEvidenceView, M4Failure>> {
  const providerProfile = m4ProviderProfileSchema.safeParse(
    input.providerProfileInput,
  );
  if (!providerProfile.success)
    return err(failure("INVALID_PROVIDER", "Provider validation failed."));
  const taskProfile = m4PublicTaskProfileSchema.safeParse(
    input.taskProfileInput,
  );
  if (!taskProfile.success)
    return err(failure("INVALID_TASK_CLASS", "Task class validation failed."));
  const query = evidenceQuerySchema.safeParse(input.queryInput);
  if (!query.success)
    return err(failure("INVALID_QUERY", "Evidence query validation failed."));
  const validatedGraph = validateEvidenceGraph(input.graphInput);
  if (!validatedGraph.ok)
    return err(failure("INVALID_GRAPH", validatedGraph.error.message));
  const policy = canonicalPolicy(input.policyInput ?? M4A_INITIAL_POLICY);
  if (!policy.ok) return policy;
  const graph = canonicalGraph(validatedGraph.value.graph);
  const rule = policy.value.rules.find(
    (candidate) =>
      candidate.provider === providerProfile.data.provider &&
      candidate.taskClass === taskProfile.data.taskClass,
  );
  if (rule === undefined)
    return err(
      failure("INVALID_POLICY", "Policy has no applicable provider/task rule."),
    );

  const views: Array<z.infer<typeof m4CompiledViewEntrySchema>> = [];
  for (const view of M4_VIEW_ORDER) {
    const source = sourceForView(graph, view);
    if (!source.ok) return source;
    const selected = await selectEvidence(source.value, query.data);
    if (!selected.ok)
      return err(failure("SOURCE_FAILURE", selected.error.message));
    const reference = await referenceEvidenceSelection(selected.value);
    if (!reference.ok)
      return err(failure("IDENTITY_FAILURE", reference.error.message));
    views.push({
      view,
      neighborhood: selected.value,
      neighborhoodDigest: reference.value.neighborhoodDigest,
    });
  }
  const selected = views.find((view) => view.view === rule.view);
  const control = views.find(
    (view) => view.view === policy.value.experimentalControlView,
  );
  if (selected === undefined || control === undefined)
    return err(
      failure("IDENTITY_FAILURE", "Compiled evidence view set is incomplete."),
    );

  const manifest = selectorManifest(views);
  const [
    policyDigest,
    providerProfileDigest,
    taskContractDigest,
    selectorManifestDigest,
    sourceSnapshotDigest,
    queryDigest,
    visibleViewDigest,
  ] = await Promise.all([
    digest(policy.value, "Evidence policy cannot be identified."),
    digest(providerProfile.data, "Provider profile cannot be identified."),
    digest(
      taskProfile.data.answerContract,
      "Task contract cannot be identified.",
    ),
    digest(manifest, "Selector manifest cannot be identified."),
    digest(graph, "Evidence graph cannot be identified."),
    digest(query.data, "Evidence query cannot be identified."),
    digest(
      selected.neighborhood.context,
      "Model-visible evidence context cannot be identified.",
    ),
  ]);
  if (!policyDigest.ok) return policyDigest;
  if (!providerProfileDigest.ok) return providerProfileDigest;
  if (!taskContractDigest.ok) return taskContractDigest;
  if (!selectorManifestDigest.ok) return selectorManifestDigest;
  if (!sourceSnapshotDigest.ok) return sourceSnapshotDigest;
  if (!queryDigest.ok) return queryDigest;
  if (!visibleViewDigest.ok) return visibleViewDigest;

  const body = m4EvidenceCompilerIdentityBodySchema.safeParse({
    protocol: "m4a-provider-aware-evidence-compiler/2",
    policyDigest: policyDigest.value,
    providerProfileDigest: providerProfileDigest.value,
    taskContractDigest: taskContractDigest.value,
    selectorManifestDigest: selectorManifestDigest.value,
    sourceSnapshotDigest: sourceSnapshotDigest.value,
    queryDigest: queryDigest.value,
    provider: providerProfile.data.provider,
    taskClass: taskProfile.data.taskClass,
    selectedView: rule.view,
    experimentalControlView: policy.value.experimentalControlView,
    selectedNeighborhoodDigest: selected.neighborhoodDigest,
    controlNeighborhoodDigest: control.neighborhoodDigest,
    visibleViewDigest: visibleViewDigest.value,
    availableViewDigests: views.map((view) => ({
      view: view.view,
      neighborhoodDigest: view.neighborhoodDigest,
    })),
  });
  if (!body.success)
    return err(
      failure(
        "IDENTITY_FAILURE",
        "Evidence compiler identity validation failed.",
      ),
    );
  const compilerAuditDigest = await digest(
    body.data,
    "Compiled evidence view cannot be identified.",
  );
  if (!compilerAuditDigest.ok) return compilerAuditDigest;
  const compiled = m4CompiledEvidenceViewSchema.safeParse({
    policy: policy.value,
    providerProfile: providerProfile.data,
    taskProfile: taskProfile.data,
    selectorManifest: manifest,
    graph,
    query: query.data,
    identity: { ...body.data, compilerAuditDigest: compilerAuditDigest.value },
    views,
    selectedNeighborhood: selected.neighborhood,
    experimentalControlNeighborhood: control.neighborhood,
    modelVisibleContext: selected.neighborhood.context,
  });
  return compiled.success
    ? ok(compiled.data)
    : err(
        failure(
          "IDENTITY_FAILURE",
          "Compiled evidence view validation failed.",
        ),
      );
}

export async function validateM4CompiledEvidenceView(
  compiledInput: unknown,
): Promise<Result<M4CompiledEvidenceView, M4Failure>> {
  const compiled = m4CompiledEvidenceViewSchema.safeParse(compiledInput);
  if (!compiled.success)
    return err(
      failure("INVALID_COMPILED_VIEW", "Compiled evidence view is invalid."),
    );
  if (
    compiled.data.views.some(
      (view) => !viewMatchesSource(view.view, view.neighborhood),
    )
  )
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Compiled evidence view labels do not match source identities.",
      ),
    );
  const validatedGraph = validateEvidenceGraph(compiled.data.graph);
  if (!validatedGraph.ok)
    return err(
      failure("INVALID_COMPILED_VIEW", "Compiled evidence graph is invalid."),
    );
  const graph = canonicalGraph(validatedGraph.value.graph);
  if (JSON.stringify(graph) !== JSON.stringify(compiled.data.graph))
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Compiled evidence graph must use canonical order.",
      ),
    );
  const canonical = canonicalPolicy(compiled.data.policy);
  if (!canonical.ok) return canonical;
  const selected = compiled.data.views.find(
    (view) => view.view === compiled.data.identity.selectedView,
  );
  const control = compiled.data.views.find(
    (view) => view.view === compiled.data.identity.experimentalControlView,
  );
  if (selected === undefined || control === undefined)
    return err(
      failure("INVALID_COMPILED_VIEW", "Compiled view references are missing."),
    );
  const viewDigests = await Promise.all(
    compiled.data.views.map(async (view) => ({
      view: view.view,
      digest: await digest(
        view.neighborhood,
        "Evidence neighborhood cannot be identified.",
      ),
    })),
  );
  const failedViewDigest = viewDigests.find((entry) => !entry.digest.ok);
  if (failedViewDigest !== undefined && !failedViewDigest.digest.ok)
    return failedViewDigest.digest;
  if (
    viewDigests.some(
      (entry, index) =>
        entry.digest.ok &&
        entry.digest.value !== compiled.data.views[index]?.neighborhoodDigest,
    )
  )
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Stored evidence view digests do not reconcile.",
      ),
    );
  for (const view of compiled.data.views) {
    const source = sourceForView(graph, view.view);
    if (!source.ok)
      return err(
        failure(
          "INVALID_COMPILED_VIEW",
          "Compiled evidence source cannot be reconstructed.",
        ),
      );
    const selectedFromGraph = await selectEvidence(
      source.value,
      compiled.data.query,
    );
    if (!selectedFromGraph.ok)
      return err(
        failure(
          "INVALID_COMPILED_VIEW",
          "Compiled evidence selection cannot be reconstructed.",
        ),
      );
    const selectionReference = await referenceEvidenceSelection(
      selectedFromGraph.value,
    );
    if (
      !selectionReference.ok ||
      selectionReference.value.neighborhoodDigest !== view.neighborhoodDigest
    )
      return err(
        failure(
          "INVALID_COMPILED_VIEW",
          "Compiled evidence view does not derive from its bound graph.",
        ),
      );
  }
  const availableViewDigests = viewDigests.flatMap((entry) =>
    entry.digest.ok
      ? [{ view: entry.view, neighborhoodDigest: entry.digest.value }]
      : [],
  );
  const manifest = selectorManifest(compiled.data.views);
  if (
    JSON.stringify(manifest) !== JSON.stringify(compiled.data.selectorManifest)
  )
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Compiled selector manifest does not match its evidence views.",
      ),
    );
  const [
    policyDigest,
    providerProfileDigest,
    taskContractDigest,
    selectorManifestDigest,
    sourceSnapshotDigest,
    queryDigest,
    visibleViewDigest,
  ] = await Promise.all([
    digest(canonical.value, "Evidence policy cannot be identified."),
    digest(
      compiled.data.providerProfile,
      "Provider profile cannot be identified.",
    ),
    digest(
      compiled.data.taskProfile.answerContract,
      "Task contract cannot be identified.",
    ),
    digest(manifest, "Selector manifest cannot be identified."),
    digest(graph, "Evidence graph cannot be identified."),
    digest(compiled.data.query, "Evidence query cannot be identified."),
    digest(
      compiled.data.modelVisibleContext,
      "Model-visible context cannot be identified.",
    ),
  ]);
  if (!policyDigest.ok) return policyDigest;
  if (!providerProfileDigest.ok) return providerProfileDigest;
  if (!taskContractDigest.ok) return taskContractDigest;
  if (!selectorManifestDigest.ok) return selectorManifestDigest;
  if (!sourceSnapshotDigest.ok) return sourceSnapshotDigest;
  if (!queryDigest.ok) return queryDigest;
  if (!visibleViewDigest.ok) return visibleViewDigest;
  const selectedDigest = availableViewDigests.find(
    (entry) => entry.view === compiled.data.identity.selectedView,
  );
  const controlDigest = availableViewDigests.find(
    (entry) => entry.view === compiled.data.identity.experimentalControlView,
  );
  if (selectedDigest === undefined || controlDigest === undefined)
    return err(
      failure("INVALID_COMPILED_VIEW", "Compiled view digests are incomplete."),
    );
  const applicableRule = canonical.value.rules.find(
    (rule) =>
      rule.provider === compiled.data.providerProfile.provider &&
      rule.taskClass === compiled.data.taskProfile.taskClass,
  );
  if (
    compiled.data.identity.provider !==
      compiled.data.providerProfile.provider ||
    compiled.data.identity.taskClass !== compiled.data.taskProfile.taskClass ||
    applicableRule?.view !== compiled.data.identity.selectedView
  )
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Compiled selected view does not match its policy rule.",
      ),
    );
  const body = m4EvidenceCompilerIdentityBodySchema.safeParse({
    protocol: compiled.data.identity.protocol,
    providerProfileDigest: providerProfileDigest.value,
    taskContractDigest: taskContractDigest.value,
    selectorManifestDigest: selectorManifestDigest.value,
    sourceSnapshotDigest: sourceSnapshotDigest.value,
    provider: compiled.data.identity.provider,
    taskClass: compiled.data.identity.taskClass,
    selectedView: compiled.data.identity.selectedView,
    experimentalControlView: compiled.data.identity.experimentalControlView,
    policyDigest: policyDigest.value,
    queryDigest: queryDigest.value,
    selectedNeighborhoodDigest: selectedDigest.neighborhoodDigest,
    controlNeighborhoodDigest: controlDigest.neighborhoodDigest,
    visibleViewDigest: visibleViewDigest.value,
    availableViewDigests,
  });
  if (!body.success)
    return err(
      failure("INVALID_COMPILED_VIEW", "Compiled identity validation failed."),
    );
  const compilerAuditDigest = await digest(
    body.data,
    "Compiled evidence view cannot be identified.",
  );
  if (!compilerAuditDigest.ok) return compilerAuditDigest;
  const selectedContextDigest = await digest(
    selected.neighborhood.context,
    "Selected evidence context cannot be identified.",
  );
  const selectedNeighborhoodDigest = await digest(
    compiled.data.selectedNeighborhood,
    "Selected evidence neighborhood cannot be identified.",
  );
  const controlNeighborhoodDigest = await digest(
    compiled.data.experimentalControlNeighborhood,
    "Control evidence neighborhood cannot be identified.",
  );
  if (!selectedContextDigest.ok) return selectedContextDigest;
  if (!selectedNeighborhoodDigest.ok) return selectedNeighborhoodDigest;
  if (!controlNeighborhoodDigest.ok) return controlNeighborhoodDigest;
  if (
    compilerAuditDigest.value !== compiled.data.identity.compilerAuditDigest ||
    selectedContextDigest.value !== visibleViewDigest.value ||
    selectedNeighborhoodDigest.value !== selectedDigest.neighborhoodDigest ||
    controlNeighborhoodDigest.value !== controlDigest.neighborhoodDigest ||
    JSON.stringify(compiled.data.identity.availableViewDigests) !==
      JSON.stringify(availableViewDigests)
  )
    return err(
      failure(
        "INVALID_COMPILED_VIEW",
        "Compiled evidence identities do not reconcile.",
      ),
    );
  return ok(compiled.data);
}

export const m4OracleAnswerSchema = z
  .strictObject({
    outcome: z.enum(["answered", "insufficient-evidence"]),
    answerValues: z.array(z.string().min(1)).max(2).readonly(),
    supportingFactIds: z.array(identifierSchema).max(64).readonly(),
  })
  .readonly();

export type M4OracleAnswer = z.infer<typeof m4OracleAnswerSchema>;

export const m4CanonicalEvidencePathSchema = z
  .strictObject({
    id: z.string().regex(/^m4-path-[0-9]{3}$/),
    factIds: z.array(identifierSchema).min(2).readonly(),
    edgeIds: z.array(identifierSchema).min(1).readonly(),
  })
  .readonly();

const m4ProvenanceLinkSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("answer-supported-by-fact"),
      answerIndex: z.number().int().nonnegative(),
      factId: identifierSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("fact-cited-by"),
      factId: identifierSchema,
      citationId: identifierSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("edge-cited-by"),
      edgeId: identifierSchema,
      citationId: identifierSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("support-connected-by-path"),
      fromFactId: identifierSchema,
      toFactId: identifierSchema,
      pathId: z.string().regex(/^m4-path-[0-9]{3}$/),
    })
    .readonly(),
]);

export const m4ProvenanceGraphSchema = z
  .strictObject({
    answerValues: z.array(z.string().min(1)).max(2).readonly(),
    supportingFactIds: z.array(identifierSchema).max(64).readonly(),
    edgeIds: z.array(identifierSchema).max(256).readonly(),
    citationIds: z.array(identifierSchema).max(128).readonly(),
    paths: z.array(m4CanonicalEvidencePathSchema).max(64).readonly(),
    links: z.array(m4ProvenanceLinkSchema).max(41_151).readonly(),
    graphDigest: sha256Schema.brand<"M4ProvenanceGraphDigest">(),
  })
  .readonly();

export const m4ProvenanceReconstructionSchema = z
  .strictObject({
    protocol: z.literal("m4b-deterministic-provenance-reconstruction/2"),
    visibleViewDigest: sha256Schema.brand<"M4VisibleViewDigest">(),
    taskContractDigest: sha256Schema.brand<"M4TaskContractDigest">(),
    reconstructionAlgorithmDigest:
      sha256Schema.brand<"M4ReconstructionAlgorithmDigest">(),
    oracleAnswerDigest: sha256Schema,
    provenance: m4ProvenanceGraphSchema,
    reconstructionDigest:
      sha256Schema.brand<"M4ProvenanceReconstructionDigest">(),
  })
  .readonly();

export type M4CanonicalEvidencePath = z.infer<
  typeof m4CanonicalEvidencePathSchema
>;
export type M4ProvenanceGraph = z.infer<typeof m4ProvenanceGraphSchema>;
export type M4ProvenanceReconstruction = z.infer<
  typeof m4ProvenanceReconstructionSchema
>;

export const M4B_PROVENANCE_PROTOCOL = Object.freeze({
  id: "m4b-deterministic-provenance-reconstruction",
  version: "2",
  oracleOutput: Object.freeze(["outcome", "answerValues", "supportingFactIds"]),
  runtimeDerived: Object.freeze([
    "citationIds",
    "edgeIds",
    "paths",
    "provenanceGraph",
  ]),
  liveInferenceAuthorized: false,
  heldoutMaterializationAuthorized: false,
  typeGraphIntegrated: false,
});

export const M4B_RECONSTRUCTION_ALGORITHM = Object.freeze({
  id: "m4-visible-evidence-provenance",
  version: "2",
  semanticDerivation: "public-contract-over-visible-facts",
  citationConstruction: "visible-support-and-visible-edge-provenance",
  pathAlgorithm: "directed-breadth-first-search",
  shortestPathTieBreak: "lexicographic-edge-id",
});

type VisibleDerivation = Readonly<{
  answerValues: ReadonlyArray<string>;
  supportingFactIds: ReadonlyArray<string>;
}>;

function pairwise<T>(values: ReadonlyArray<T>): ReadonlyArray<readonly [T, T]> {
  return values.flatMap((left, leftIndex) =>
    values.slice(leftIndex + 1).map((right) => [left, right] as const),
  );
}

function temporalKey(
  fact: EvidenceFact,
  field: "validFrom" | "recordedFrom",
): string {
  return fact[field] ?? fact.recordedFrom;
}

function visibleDerivations(
  context: EvidenceContext,
  contract: M3bAnswerContract,
): ReadonlyArray<VisibleDerivation> {
  const facts = context.facts;
  switch (contract.role) {
    case "headquarters-city": {
      const employers = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      return employers.flatMap((employer) =>
        facts
          .filter(
            (fact) =>
              fact.subject === employer.object &&
              fact.predicate === contract.requiredFactPredicates[1],
          )
          .map((headquarters) => ({
            answerValues: [headquarters.object],
            supportingFactIds: [employer.id, headquarters.id],
          })),
      );
    }
    case "release-status-change": {
      const statuses = facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .toSorted((left, right) =>
          temporalKey(left, "validFrom").localeCompare(
            temporalKey(right, "validFrom"),
          ),
        );
      return pairwise(statuses).map(([oldStatus, newStatus]) => ({
        answerValues: [oldStatus.object, newStatus.object],
        supportingFactIds: [oldStatus.id, newStatus.id],
      }));
    }
    case "conflicting-readings": {
      const readings = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      return pairwise(readings)
        .filter(([left, right]) => left.object !== right.object)
        .map(([left, right]) => ({
          answerValues: [left.object, right.object].toSorted(),
          supportingFactIds: [left.id, right.id],
        }));
    }
    case "independent-verifier": {
      const arrivals = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      const receipts = facts.filter(
        (fact) => fact.predicate === contract.requiredFactPredicates[1],
      );
      return arrivals.flatMap((arrival) =>
        receipts.map((receipt) => ({
          answerValues: [receipt.subject],
          supportingFactIds: [arrival.id, receipt.id],
        })),
      );
    }
    case "retracted-rule-change": {
      const rules = facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .toSorted((left, right) =>
          temporalKey(left, "recordedFrom").localeCompare(
            temporalKey(right, "recordedFrom"),
          ),
        );
      const notices = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[1],
      );
      return pairwise(rules).flatMap(([oldRule, newRule]) =>
        notices.map((notice) => ({
          answerValues: [oldRule.object, newRule.object],
          supportingFactIds: [oldRule.id, notice.id, newRule.id],
        })),
      );
    }
    case "owner":
      return facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .map((fact) => ({
          answerValues: [fact.object],
          supportingFactIds: [fact.id],
        }));
  }
}

function equalValues(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  unordered: boolean,
): boolean {
  const comparableLeft = unordered ? left.toSorted() : left;
  const comparableRight = unordered ? right.toSorted() : right;
  return (
    comparableLeft.length === comparableRight.length &&
    comparableLeft.every((value, index) => value === comparableRight[index])
  );
}

function shortestPath(
  edges: ReadonlyArray<EvidenceEdge>,
  fromFactId: string,
  toFactId: string,
): EvidencePath | undefined {
  const outgoing = new Map<string, Array<EvidenceEdge>>();
  for (const edge of edges) {
    const existing = outgoing.get(edge.fromFactId) ?? [];
    existing.push(edge);
    outgoing.set(edge.fromFactId, existing);
  }
  const queue: Array<string> = [fromFactId];
  const visited = new Set([fromFactId]);
  const predecessor = new Map<
    string,
    Readonly<{ previousFactId: string; edgeId: string }>
  >();
  while (queue.length > 0) {
    const currentFactId = queue.shift();
    if (currentFactId === undefined) break;
    for (const edge of (outgoing.get(currentFactId) ?? []).toSorted(
      (left, right) => left.id.localeCompare(right.id),
    )) {
      if (visited.has(edge.toFactId)) continue;
      visited.add(edge.toFactId);
      predecessor.set(edge.toFactId, {
        previousFactId: currentFactId,
        edgeId: edge.id,
      });
      if (edge.toFactId === toFactId) {
        const reversedFactIds = [toFactId];
        const reversedEdgeIds: Array<string> = [];
        let cursor = toFactId;
        while (cursor !== fromFactId) {
          const step = predecessor.get(cursor);
          if (step === undefined) return undefined;
          reversedEdgeIds.push(step.edgeId);
          reversedFactIds.push(step.previousFactId);
          cursor = step.previousFactId;
        }
        return {
          factIds: reversedFactIds.toReversed(),
          edgeIds: reversedEdgeIds.toReversed(),
        };
      }
      queue.push(edge.toFactId);
    }
  }
  return undefined;
}

function canonicalPaths(
  context: EvidenceContext,
  supportingFactIds: ReadonlyArray<string>,
): ReadonlyArray<M4CanonicalEvidencePath> {
  const paths = supportingFactIds.slice(0, -1).flatMap((fromFactId, index) => {
    const toFactId = supportingFactIds[index + 1];
    if (toFactId === undefined) return [];
    const path = shortestPath(context.edges, fromFactId, toFactId);
    return path === undefined ? [] : [path];
  });
  const unique = new Map(
    paths.map((path) => [
      `${path.factIds.join("/")}:${path.edgeIds.join("/")}`,
      path,
    ]),
  );
  return [...unique]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, path], index) => ({
      id: `m4-path-${String(index + 1).padStart(3, "0")}`,
      factIds: path.factIds,
      edgeIds: path.edgeIds,
    }));
}

export async function reconstructM4Provenance(
  input: Readonly<{
    compiledViewInput: unknown;
    oracleAnswerInput: unknown;
  }>,
): Promise<Result<M4ProvenanceReconstruction, M4Failure>> {
  const compiled = await validateM4CompiledEvidenceView(
    input.compiledViewInput,
  );
  if (!compiled.ok) return compiled;
  const contract = compiled.value.taskProfile.answerContract;
  const oracleAnswer = m4OracleAnswerSchema.safeParse(input.oracleAnswerInput);
  if (!oracleAnswer.success)
    return err(
      failure(
        "INVALID_ORACLE_ANSWER",
        "Reduced oracle answer validation failed.",
      ),
    );
  const derivations = visibleDerivations(
    compiled.value.modelVisibleContext,
    contract,
  );
  if (oracleAnswer.data.outcome === "insufficient-evidence") {
    const issues: Array<M4DiagnosticIssue> = [];
    if (oracleAnswer.data.answerValues.length > 0)
      issues.push({
        code: "abstention-has-answer-values",
        path: ["answerValues"],
      });
    if (oracleAnswer.data.supportingFactIds.length > 0)
      issues.push({
        code: "abstention-has-supporting-facts",
        path: ["supportingFactIds"],
      });
    if (derivations.length > 0)
      issues.push({
        code: "abstention-when-complete-derivation-visible",
        path: ["outcome"],
      });
    if (issues.length > 0)
      return err(
        failure(
          "SEMANTIC_OBLIGATION_FAILED",
          "Reduced oracle answer failed public obligations.",
          issues,
        ),
      );
  }

  let derivation: VisibleDerivation | undefined;
  if (oracleAnswer.data.outcome === "answered") {
    if (
      new Set(oracleAnswer.data.supportingFactIds).size !==
      oracleAnswer.data.supportingFactIds.length
    )
      return err(
        failure(
          "SEMANTIC_OBLIGATION_FAILED",
          "Supporting fact references must be unique.",
          [{ code: "duplicate-supporting-fact", path: ["supportingFactIds"] }],
        ),
      );
    derivation = derivations.find(
      (candidate) =>
        equalValues(
          candidate.supportingFactIds,
          oracleAnswer.data.supportingFactIds,
          true,
        ) &&
        equalValues(
          candidate.answerValues,
          oracleAnswer.data.answerValues,
          contract.ordering === "unordered",
        ),
    );
    if (derivation === undefined)
      return err(
        failure(
          "SEMANTIC_OBLIGATION_FAILED",
          "Answer values and supporting facts do not satisfy the public contract.",
          [
            {
              code: "answer-support-does-not-form-visible-derivation",
              path: ["supportingFactIds"],
            },
          ],
        ),
      );
  }

  const answerValues = derivation?.answerValues ?? [];
  const supportingFactIds = derivation?.supportingFactIds ?? [];
  const paths = canonicalPaths(
    compiled.value.modelVisibleContext,
    supportingFactIds,
  );
  const factIndex = new Map(
    compiled.value.modelVisibleContext.facts.map((fact) => [fact.id, fact]),
  );
  const edgeIndex = new Map(
    compiled.value.modelVisibleContext.edges.map((edge) => [edge.id, edge]),
  );
  const edgeIds = [
    ...new Set(paths.flatMap((path) => path.edgeIds)),
  ].toSorted();
  const factCitationIds = supportingFactIds.flatMap(
    (factId) => factIndex.get(factId)?.citationIds ?? [],
  );
  const edgeCitationIds = edgeIds.flatMap(
    (edgeId) => edgeIndex.get(edgeId)?.provenanceCitationIds ?? [],
  );
  const citationIds = [
    ...new Set([...factCitationIds, ...edgeCitationIds]),
  ].toSorted();
  const links: Array<z.infer<typeof m4ProvenanceLinkSchema>> = [
    ...answerValues.flatMap((_, answerIndex) =>
      supportingFactIds.map((factId) => ({
        kind: "answer-supported-by-fact" as const,
        answerIndex,
        factId,
      })),
    ),
    ...supportingFactIds.flatMap((factId) =>
      (factIndex.get(factId)?.citationIds ?? [])
        .toSorted()
        .map((citationId) => ({
          kind: "fact-cited-by" as const,
          factId,
          citationId,
        })),
    ),
    ...edgeIds.flatMap((edgeId) =>
      (edgeIndex.get(edgeId)?.provenanceCitationIds ?? [])
        .toSorted()
        .map((citationId) => ({
          kind: "edge-cited-by" as const,
          edgeId,
          citationId,
        })),
    ),
    ...paths.flatMap((path) => {
      const fromFactId = path.factIds[0];
      const toFactId = path.factIds.at(-1);
      return fromFactId === undefined || toFactId === undefined
        ? []
        : [
            {
              kind: "support-connected-by-path" as const,
              fromFactId,
              toFactId,
              pathId: path.id,
            },
          ];
    }),
  ];
  const graphBody = {
    answerValues,
    supportingFactIds,
    edgeIds,
    citationIds,
    paths,
    links,
  };
  const graphDigest = await digest(
    graphBody,
    "Provenance graph cannot be identified.",
  );
  if (!graphDigest.ok) return graphDigest;
  const provenance = m4ProvenanceGraphSchema.safeParse({
    ...graphBody,
    graphDigest: graphDigest.value,
  });
  if (!provenance.success)
    return err(
      failure("IDENTITY_FAILURE", "Provenance graph validation failed."),
    );
  const [
    taskContractDigest,
    reconstructionAlgorithmDigest,
    oracleAnswerDigest,
  ] = await Promise.all([
    digest(contract, "Task contract cannot be identified."),
    digest(
      M4B_RECONSTRUCTION_ALGORITHM,
      "Reconstruction algorithm cannot be identified.",
    ),
    digest(oracleAnswer.data, "Oracle answer cannot be identified."),
  ]);
  if (!taskContractDigest.ok) return taskContractDigest;
  if (!reconstructionAlgorithmDigest.ok) return reconstructionAlgorithmDigest;
  if (!oracleAnswerDigest.ok) return oracleAnswerDigest;
  const reconstructionBody = {
    protocol: "m4b-deterministic-provenance-reconstruction/2" as const,
    visibleViewDigest: compiled.value.identity.visibleViewDigest,
    taskContractDigest: taskContractDigest.value,
    reconstructionAlgorithmDigest: reconstructionAlgorithmDigest.value,
    oracleAnswerDigest: oracleAnswerDigest.value,
    provenance: provenance.data,
  };
  const reconstructionDigest = await digest(
    reconstructionBody,
    "Provenance reconstruction cannot be identified.",
  );
  if (!reconstructionDigest.ok) return reconstructionDigest;
  const reconstruction = m4ProvenanceReconstructionSchema.safeParse({
    ...reconstructionBody,
    reconstructionDigest: reconstructionDigest.value,
  });
  return reconstruction.success
    ? ok(reconstruction.data)
    : err(
        failure(
          "IDENTITY_FAILURE",
          "Provenance reconstruction validation failed.",
        ),
      );
}
