import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  compileM4EvidenceView,
  type EvidenceGraph,
  evidenceGraphSchema,
  M4A_INITIAL_POLICY,
  M4A_PROVIDER_PROFILES,
  type M5PublicTaskContract,
  m5PublicTaskContractSchema,
  reconstructM4Provenance,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const M5B0_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-repository-history-development-pilot",
  version: "1",
  sourceSnapshotCommit: "1f1bc5f2de01cfb1a1121eca072756c6f1aa4983",
  liveGitHubAccess: false,
  developmentOnly: true,
});

const repositoryCommitSchema = z
  .strictObject({
    commit: commitSchema,
    parents: z.array(commitSchema).readonly(),
    committedAt: z.iso.datetime({ offset: true }),
    subject: z.string().min(1),
  })
  .readonly();

const repositoryDocumentSchema = z
  .strictObject({
    path: z.string().min(1),
    revision: commitSchema,
    blobObjectId: z.string().regex(/^[a-f0-9]{40,64}$/u),
    contentDigest: digestSchema,
    content: z.string().min(1),
  })
  .readonly();

const expectedOutcomeSchema = z.discriminatedUnion("outcome", [
  z
    .strictObject({
      outcome: z.literal("answered"),
      answerValues: z.array(z.string().min(1)).min(1).max(2).readonly(),
      supportingFactIds: z.array(identifierSchema).min(1).max(3).readonly(),
    })
    .readonly(),
  z
    .strictObject({
      outcome: z.literal("insufficient-evidence"),
      answerValues: z.tuple([]),
      supportingFactIds: z.tuple([]),
    })
    .readonly(),
]);

export const m5bPilotTaskSchema = z
  .strictObject({
    task: m5PublicTaskContractSchema,
    temporalLens: z
      .strictObject({
        validAt: z.iso.datetime().nullable(),
        recordedAt: z.iso.datetime().nullable(),
        rationale: z.string().min(1),
      })
      .readonly(),
    expected: expectedOutcomeSchema,
    audit: z
      .strictObject({
        independentlyValidated: z.literal(true),
        sourceDocumentPaths: z.array(z.string().min(1)).readonly(),
        sourceCommits: z.array(commitSchema).min(1).readonly(),
        probeRole: z.enum(["feasible", "insufficient-evidence"]).nullable(),
      })
      .readonly(),
    taskDigest: digestSchema,
  })
  .readonly();

export const m5bCorpusSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    protocol: z.literal("lachesis-repository-history-development-pilot/1"),
    sourceSnapshotCommit: commitSchema,
    sourceSnapshotRecordedAt: z.iso.datetime({ offset: true }),
    commits: z.array(repositoryCommitSchema).min(1).readonly(),
    documents: z.array(repositoryDocumentSchema).min(1).readonly(),
    graph: evidenceGraphSchema,
    tasks: z.array(m5bPilotTaskSchema).length(12).readonly(),
    audit: z
      .strictObject({
        taskCount: z.literal(12),
        answeredTaskCount: z.literal(11),
        insufficientEvidenceTaskCount: z.literal(1),
        categories: z
          .array(
            z.enum([
              "development-history",
              "architecture-provenance",
              "milestone-status",
              "temporal-change",
              "supersession",
              "multi-source-synthesis",
              "insufficient-evidence",
            ]),
          )
          .min(7)
          .readonly(),
        everyAnswerReconstructedOffline: z.literal(true),
        liveGitHubRequired: z.literal(false),
        benchmarkGeneralizationClaimed: z.literal(false),
      })
      .readonly(),
    corpusDigest: digestSchema,
  })
  .readonly();

export type M5bCorpus = z.infer<typeof m5bCorpusSchema>;
export type M5bPilotTask = z.infer<typeof m5bPilotTaskSchema>;

const DOCUMENT_PATHS = Object.freeze([
  "README.md",
  "docs/architecture.md",
  "docs/m2-results.md",
  "docs/m3-results.md",
  "docs/m3b2-protocol-correction.md",
  "docs/m4-results.md",
  "docs/m4a-evidence-compiler.md",
  "docs/m4c-typegraph-parity.md",
  "docs/m5a-evidence-runtime.md",
  "docs/roadmap.md",
  "packages/evidence/src/m4.ts",
  "packages/evidence/src/m5.ts",
  "packages/evidence-typegraph/src/m5.ts",
]);

type SemanticFactSpec = Readonly<{
  id: string;
  statement: string;
  subject: string;
  predicate: string;
  object: string;
  documentPath: string;
  needle: string;
  sourceCommit: string;
}>;

const SEMANTIC_FACTS: ReadonlyArray<SemanticFactSpec> = Object.freeze([
  {
    id: "m5b-fact-m2-formal-status",
    statement: "M2 closed as a complete formal failure.",
    subject: "milestone-m2",
    predicate: "formal-status",
    object: "complete-formal-fail",
    documentPath: "docs/m2-results.md",
    needle: "Status: `complete-formal-fail`",
    sourceCommit: "5f5b0a6ed6ca125351ad838fcf1bca75d11a0249",
  },
  {
    id: "m5b-fact-m2-comparison-boundary",
    statement:
      "M2 evaluated restricted capability TypeScript rather than conventional CodeMode.",
    subject: "milestone-m2",
    predicate: "comparison-boundary",
    object: "restricted capability TypeScript; not conventional CodeMode",
    documentPath: "docs/m2-results.md",
    needle: "conventional CodeMode or TypeGraph.",
    sourceCommit: "5f5b0a6ed6ca125351ad838fcf1bca75d11a0249",
  },
  {
    id: "m5b-fact-m2-primary-gate",
    statement: "M2 did not establish functional-IR non-inferiority.",
    subject: "milestone-m2",
    predicate: "primary-gate",
    object: "functional-IR non-inferiority failed",
    documentPath: "docs/m2-results.md",
    needle: "functional-IR non-inferiority under the frozen replicated rule",
    sourceCommit: "5f5b0a6ed6ca125351ad838fcf1bca75d11a0249",
  },
  {
    id: "m5b-fact-m3-formal-status",
    statement: "M3 closed as a complete formal failure.",
    subject: "milestone-m3",
    predicate: "formal-status",
    object: "complete-formal-fail",
    documentPath: "docs/m3-results.md",
    needle: "Status: `complete-formal-fail`",
    sourceCommit: "610af74a8c336760ee17fc0d4d39dda44d86d44d",
  },
  {
    id: "m5b-fact-m3-structural-gate",
    statement: "Every universal M3 structural-superiority conclusion failed.",
    subject: "milestone-m3",
    predicate: "structural-gate",
    object: "all universal structural-superiority contrasts failed",
    documentPath: "docs/m3-results.md",
    needle: "Every universal structural-superiority conclusion failed.",
    sourceCommit: "610af74a8c336760ee17fc0d4d39dda44d86d44d",
  },
  {
    id: "m5b-fact-m3-negative-control",
    statement: "M3 negative-control non-inferiority passed in all strata.",
    subject: "milestone-m3",
    predicate: "negative-control-gate",
    object: "negative-control non-inferiority passed in all four strata",
    documentPath: "docs/m3-results.md",
    needle: "passed non-inferiority in all four",
    sourceCommit: "610af74a8c336760ee17fc0d4d39dda44d86d44d",
  },
  {
    id: "m5b-fact-m3b2-status",
    statement: "M3b.2 is a historical complete semantic-gate failure.",
    subject: "protocol-m3b2",
    predicate: "protocol-status",
    object: "complete-semantic-gate-fail",
    documentPath: "docs/m3b2-protocol-correction.md",
    needle: "historical `complete-semantic-gate-fail`",
    sourceCommit: "625da3897077efcf46fcf19492b3b77843ffc55e",
  },
  {
    id: "m5b-fact-m3b2-successor",
    statement:
      "M3b.3 superseded M3b.2 with public executable answer obligations.",
    subject: "protocol-m3b2",
    predicate: "superseded-by",
    object: "M3b.3 public executable answer obligations",
    documentPath: "docs/m3b2-protocol-correction.md",
    needle: "public executable answer obligations",
    sourceCommit: "7841e4365ef6171d53eaf3c0e036148b6c3f8cdb",
  },
  {
    id: "m5b-fact-m4-initial-policy",
    statement:
      "M4a began with an initial provider-aware development hypothesis.",
    subject: "m4-evidence-policy",
    predicate: "status-before",
    object: "initial development hypothesis",
    documentPath: "docs/m4a-evidence-compiler.md",
    needle: "The initial version-1 development hypothesis is:",
    sourceCommit: "62de4bdd3a10f8db9c2254bf5dca42cd4c0fc0d4",
  },
  {
    id: "m5b-fact-m4-policy-rejected",
    statement: "The original M4a adaptive policy was development-rejected.",
    subject: "m4-evidence-policy",
    predicate: "status-after",
    object: "development-rejected",
    documentPath: "docs/m4-results.md",
    needle:
      "The original M4a adaptive policy is permanently `development-rejected`",
    sourceCommit: "523ed4d36ed3b0aead3011d7dc22187977783288",
  },
  {
    id: "m5b-fact-m4-formal-status",
    statement: "M4 closed with mixed conclusions.",
    subject: "milestone-m4",
    predicate: "formal-status",
    object: "complete-mixed",
    documentPath: "docs/m4-results.md",
    needle: "Status: M4 is closed as `complete-mixed`",
    sourceCommit: "523ed4d36ed3b0aead3011d7dc22187977783288",
  },
  {
    id: "m5b-fact-m4-production-default",
    statement: "Lexical evidence remains the M4 production default.",
    subject: "m4-production-evidence",
    predicate: "production-default",
    object: "lexical-facts",
    documentPath: "docs/m4-results.md",
    needle: "Lexical evidence therefore remains the production default.",
    sourceCommit: "523ed4d36ed3b0aead3011d7dc22187977783288",
  },
  {
    id: "m5b-fact-m4-typegraph-role",
    statement:
      "TypeGraph is optional storage, temporal, and provenance infrastructure.",
    subject: "typegraph",
    predicate: "architecture-role",
    object: "optional storage, temporal, and provenance infrastructure",
    documentPath: "docs/m4-results.md",
    needle: "additive rather than mandatory.",
    sourceCommit: "523ed4d36ed3b0aead3011d7dc22187977783288",
  },
  {
    id: "m5b-fact-m4-typegraph-nonclaim",
    statement: "M4 made no TypeGraph model-quality claim.",
    subject: "typegraph",
    predicate: "model-quality-claim",
    object: "not established",
    documentPath: "docs/m4-results.md",
    needle: "No TypeGraph model-quality advantage.",
    sourceCommit: "523ed4d36ed3b0aead3011d7dc22187977783288",
  },
  {
    id: "m5b-fact-three-graph-separation",
    statement:
      "Lachesis separates plan/orchestration, knowledge/evidence, and run/provenance graphs.",
    subject: "lachesis-architecture",
    predicate: "graph-domains",
    object: "plan/orchestration; knowledge/evidence; run/provenance",
    documentPath: "docs/m5a-evidence-runtime.md",
    needle: "M5a preserves three graph domains:",
    sourceCommit: "1f1bc5f2de01cfb1a1121eca072756c6f1aa4983",
  },
  {
    id: "m5b-fact-m5a-status",
    statement:
      "M5a completed an offline production evidence-runtime vertical slice.",
    subject: "milestone-m5a",
    predicate: "implementation-status",
    object: "offline vertical slice complete",
    documentPath: "docs/m5a-evidence-runtime.md",
    needle: "Status: offline vertical slice complete.",
    sourceCommit: "1f1bc5f2de01cfb1a1121eca072756c6f1aa4983",
  },
  {
    id: "m5b-fact-m5a-live-dispatch",
    statement: "M5a did not implement live provider dispatch.",
    subject: "milestone-m5a",
    predicate: "live-provider-dispatch",
    object: "not implemented",
    documentPath: "docs/m5a-evidence-runtime.md",
    needle: "implements no live provider",
    sourceCommit: "1f1bc5f2de01cfb1a1121eca072756c6f1aa4983",
  },
]);

type TaskSpec = Readonly<{
  id: string;
  instruction: string;
  taskClass: M5PublicTaskContract["taskClass"];
  anchorSubject: string;
  predicates: ReadonlyArray<string>;
  answerSource: "terminal-objects" | "last-object" | "first-last-objects";
  ordering: "scalar" | "ordered" | "unordered";
  expectedFactIds: ReadonlyArray<string>;
  expectedValues: ReadonlyArray<string>;
  sourceDocumentPaths: ReadonlyArray<string>;
  sourceCommits: ReadonlyArray<string>;
  category:
    | "development-history"
    | "architecture-provenance"
    | "milestone-status"
    | "temporal-change"
    | "supersession"
    | "multi-source-synthesis"
    | "insufficient-evidence";
  probeRole: "feasible" | "insufficient-evidence" | null;
}>;

const TASKS: ReadonlyArray<TaskSpec> = Object.freeze([
  {
    id: "m5b-m5a-parent-commit",
    instruction:
      "Which commit is the first parent of the M5a offline evidence-runtime commit 1f1bc5f?",
    taskClass: "relational",
    anchorSubject: M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit,
    predicates: ["first-parent"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-commit-parent-1f1bc5f2de01"],
    expectedValues: ["523ed4d36ed3b0aead3011d7dc22187977783288"],
    sourceDocumentPaths: [],
    sourceCommits: [M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit],
    category: "development-history",
    probeRole: null,
  },
  {
    id: "m5b-m2-formal-status",
    instruction: "What is the frozen formal status of milestone M2?",
    taskClass: "negative-control",
    anchorSubject: "milestone-m2",
    predicates: ["formal-status"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-fact-m2-formal-status"],
    expectedValues: ["complete-formal-fail"],
    sourceDocumentPaths: ["docs/m2-results.md"],
    sourceCommits: ["5f5b0a6ed6ca125351ad838fcf1bca75d11a0249"],
    category: "milestone-status",
    probeRole: null,
  },
  {
    id: "m5b-m3-formal-status",
    instruction: "What is the frozen formal status of milestone M3?",
    taskClass: "negative-control",
    anchorSubject: "milestone-m3",
    predicates: ["formal-status"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-fact-m3-formal-status"],
    expectedValues: ["complete-formal-fail"],
    sourceDocumentPaths: ["docs/m3-results.md"],
    sourceCommits: ["610af74a8c336760ee17fc0d4d39dda44d86d44d"],
    category: "milestone-status",
    probeRole: null,
  },
  {
    id: "m5b-m4-formal-status",
    instruction: "What is the frozen formal status of milestone M4?",
    taskClass: "negative-control",
    anchorSubject: "milestone-m4",
    predicates: ["formal-status"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-fact-m4-formal-status"],
    expectedValues: ["complete-mixed"],
    sourceDocumentPaths: ["docs/m4-results.md"],
    sourceCommits: ["523ed4d36ed3b0aead3011d7dc22187977783288"],
    category: "milestone-status",
    probeRole: "feasible",
  },
  {
    id: "m5b-m4-production-default",
    instruction: "Which evidence view remains the production default after M4?",
    taskClass: "negative-control",
    anchorSubject: "m4-production-evidence",
    predicates: ["production-default"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-fact-m4-production-default"],
    expectedValues: ["lexical-facts"],
    sourceDocumentPaths: ["docs/m4-results.md"],
    sourceCommits: ["523ed4d36ed3b0aead3011d7dc22187977783288"],
    category: "architecture-provenance",
    probeRole: null,
  },
  {
    id: "m5b-typegraph-role-and-nonclaim",
    instruction:
      "What architectural role does TypeGraph have, and what model-quality conclusion was established?",
    taskClass: "relational",
    anchorSubject: "typegraph",
    predicates: ["architecture-role", "model-quality-claim"],
    answerSource: "terminal-objects",
    ordering: "ordered",
    expectedFactIds: [
      "m5b-fact-m4-typegraph-role",
      "m5b-fact-m4-typegraph-nonclaim",
    ],
    expectedValues: [
      "optional storage, temporal, and provenance infrastructure",
      "not established",
    ],
    sourceDocumentPaths: ["docs/m4-results.md"],
    sourceCommits: ["523ed4d36ed3b0aead3011d7dc22187977783288"],
    category: "multi-source-synthesis",
    probeRole: null,
  },
  {
    id: "m5b-three-graph-domains",
    instruction:
      "Which three graph domains does the M5a architecture keep separate?",
    taskClass: "negative-control",
    anchorSubject: "lachesis-architecture",
    predicates: ["graph-domains"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: ["m5b-fact-three-graph-separation"],
    expectedValues: ["plan/orchestration; knowledge/evidence; run/provenance"],
    sourceDocumentPaths: ["docs/m5a-evidence-runtime.md"],
    sourceCommits: [M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit],
    category: "architecture-provenance",
    probeRole: null,
  },
  {
    id: "m5b-m4-policy-before-after",
    instruction:
      "What was the M4 evidence policy status before evaluation and after the frozen M4 result?",
    taskClass: "non-relational",
    anchorSubject: "m4-evidence-policy",
    predicates: ["status-before", "status-after"],
    answerSource: "terminal-objects",
    ordering: "ordered",
    expectedFactIds: [
      "m5b-fact-m4-initial-policy",
      "m5b-fact-m4-policy-rejected",
    ],
    expectedValues: ["initial development hypothesis", "development-rejected"],
    sourceDocumentPaths: [
      "docs/m4a-evidence-compiler.md",
      "docs/m4-results.md",
    ],
    sourceCommits: [
      "62de4bdd3a10f8db9c2254bf5dca42cd4c0fc0d4",
      "523ed4d36ed3b0aead3011d7dc22187977783288",
    ],
    category: "temporal-change",
    probeRole: null,
  },
  {
    id: "m5b-m3b2-supersession",
    instruction:
      "What was M3b.2's status, and which protocol correction superseded it?",
    taskClass: "non-relational",
    anchorSubject: "protocol-m3b2",
    predicates: ["protocol-status", "superseded-by"],
    answerSource: "terminal-objects",
    ordering: "ordered",
    expectedFactIds: ["m5b-fact-m3b2-status", "m5b-fact-m3b2-successor"],
    expectedValues: [
      "complete-semantic-gate-fail",
      "M3b.3 public executable answer obligations",
    ],
    sourceDocumentPaths: ["docs/m3b2-protocol-correction.md"],
    sourceCommits: [
      "625da3897077efcf46fcf19492b3b77843ffc55e",
      "7841e4365ef6171d53eaf3c0e036148b6c3f8cdb",
    ],
    category: "supersession",
    probeRole: null,
  },
  {
    id: "m5b-m3-gates-synthesis",
    instruction:
      "Which universal M3 structural conclusion failed, and which negative-control gate passed?",
    taskClass: "relational",
    anchorSubject: "milestone-m3",
    predicates: ["structural-gate", "negative-control-gate"],
    answerSource: "terminal-objects",
    ordering: "ordered",
    expectedFactIds: [
      "m5b-fact-m3-structural-gate",
      "m5b-fact-m3-negative-control",
    ],
    expectedValues: [
      "all universal structural-superiority contrasts failed",
      "negative-control non-inferiority passed in all four strata",
    ],
    sourceDocumentPaths: ["docs/m3-results.md"],
    sourceCommits: ["610af74a8c336760ee17fc0d4d39dda44d86d44d"],
    category: "multi-source-synthesis",
    probeRole: null,
  },
  {
    id: "m5b-m5a-runtime-boundary",
    instruction:
      "What did M5a complete, and did it implement live provider dispatch?",
    taskClass: "relational",
    anchorSubject: "milestone-m5a",
    predicates: ["implementation-status", "live-provider-dispatch"],
    answerSource: "terminal-objects",
    ordering: "ordered",
    expectedFactIds: ["m5b-fact-m5a-status", "m5b-fact-m5a-live-dispatch"],
    expectedValues: ["offline vertical slice complete", "not implemented"],
    sourceDocumentPaths: ["docs/m5a-evidence-runtime.md"],
    sourceCommits: [M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit],
    category: "development-history",
    probeRole: null,
  },
  {
    id: "m5b-production-deployment-unknown",
    instruction: "Which commit deployed the M5b live pilot to production?",
    taskClass: "relational",
    anchorSubject: "m5b-production-deployment",
    predicates: ["deployment-commit"],
    answerSource: "last-object",
    ordering: "scalar",
    expectedFactIds: [],
    expectedValues: [],
    sourceDocumentPaths: [],
    sourceCommits: [M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit],
    category: "insufficient-evidence",
    probeRole: "insufficient-evidence",
  },
]);

function failure(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

function utcInstant(instant: string): string {
  return new Date(instant).toISOString();
}

async function git(
  repositoryRoot: string,
  args: ReadonlyArray<string>,
): Promise<Result<string, Diagnostic>> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: repositoryRoot,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ok: true, value: result.stdout };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Unable to materialize frozen repository history: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function loadCommits(
  repositoryRoot: string,
  sourceCommit: string,
): Promise<
  Result<ReadonlyArray<z.infer<typeof repositoryCommitSchema>>, Diagnostic>
> {
  const output = await git(repositoryRoot, [
    "log",
    "--format=%H%x09%P%x09%cI%x09%s",
    sourceCommit,
  ]);
  if (!output.ok) return output;
  const commits = output.value
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [commit, parents = "", committedAt, ...subjectParts] =
        line.split("\t");
      return {
        commit,
        parents: parents.length === 0 ? [] : parents.split(" "),
        committedAt,
        subject: subjectParts.join("\t"),
      };
    });
  const parsed = z.array(repositoryCommitSchema).safeParse(commits);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: failure("Frozen Git history is malformed.") };
}

async function loadDocuments(
  repositoryRoot: string,
  sourceCommit: string,
): Promise<
  Result<ReadonlyArray<z.infer<typeof repositoryDocumentSchema>>, Diagnostic>
> {
  const documents: Array<z.infer<typeof repositoryDocumentSchema>> = [];
  for (const path of DOCUMENT_PATHS) {
    const [content, objectId] = await Promise.all([
      git(repositoryRoot, ["show", `${sourceCommit}:${path}`]),
      git(repositoryRoot, ["rev-parse", `${sourceCommit}:${path}`]),
    ]);
    if (!content.ok) return content;
    if (!objectId.ok) return objectId;
    const contentDigest = await digestValue({ path, content: content.value });
    if (!contentDigest.ok) return contentDigest;
    documents.push(
      repositoryDocumentSchema.parse({
        path,
        revision: sourceCommit,
        blobObjectId: objectId.value.trim(),
        contentDigest: contentDigest.value,
        content: content.value,
      }),
    );
  }
  return { ok: true, value: documents };
}

function evidenceLimits(): M5PublicTaskContract["evidenceLimits"] {
  return {
    maxFacts: 12,
    maxCitations: 16,
    maxEdges: 8,
    maxPaths: 4,
    maxHops: 3,
    maxSerializedBytes: 32_000,
    maxSerializedTokenUpperBound: 32_000,
  };
}

function buildGraph(
  commits: ReadonlyArray<z.infer<typeof repositoryCommitSchema>>,
  documents: ReadonlyArray<z.infer<typeof repositoryDocumentSchema>>,
): Result<EvidenceGraph, Diagnostic> {
  const commitById = new Map(commits.map((commit) => [commit.commit, commit]));
  const documentByPath = new Map(
    documents.map((document) => [document.path, document]),
  );
  for (const fact of SEMANTIC_FACTS) {
    const document = documentByPath.get(fact.documentPath);
    if (!document?.content.includes(fact.needle))
      return {
        ok: false,
        error: failure(
          `Semantic fact ${fact.id} lacks its exact source witness.`,
        ),
      };
    if (!commitById.has(fact.sourceCommit))
      return {
        ok: false,
        error: failure(`Semantic fact ${fact.id} references an absent commit.`),
      };
  }
  const citations = [
    ...commits.map((commit) => ({
      id: `m5b-commit-${commit.commit.slice(0, 12)}`,
      source: "frozen-local-git-history",
      locator: `commit:${commit.commit}`,
      observedAt: utcInstant(commit.committedAt),
    })),
    ...documents.map((document) => ({
      id: `m5b-doc-${document.contentDigest.slice(0, 16)}`,
      source: "frozen-local-repository-document",
      locator: `${document.revision}:${document.path}`,
      observedAt: (() => {
        const instant =
          commitById.get(document.revision)?.committedAt ??
          commits[0]?.committedAt;
        return instant === undefined ? undefined : utcInstant(instant);
      })(),
    })),
  ];
  if (citations.some((citation) => citation.observedAt === undefined))
    return {
      ok: false,
      error: failure("Corpus citation time is unavailable."),
    };
  const commitFacts = commits.flatMap((commit) =>
    commit.parents.slice(0, 1).map((parent) => ({
      id: `m5b-commit-parent-${commit.commit.slice(0, 12)}`,
      statement: `Commit ${commit.commit} has first parent ${parent}.`,
      subject: commit.commit,
      predicate: "first-parent",
      object: parent,
      citationIds: [`m5b-commit-${commit.commit.slice(0, 12)}`],
      validFrom: utcInstant(commit.committedAt),
      validUntil: null,
      recordedFrom: utcInstant(commit.committedAt),
      recordedUntil: null,
    })),
  );
  const semanticFacts = SEMANTIC_FACTS.map((fact) => {
    const document = documentByPath.get(fact.documentPath);
    const commit = commitById.get(fact.sourceCommit);
    if (document === undefined || commit === undefined)
      throw new Error("Validated corpus source disappeared.");
    return {
      id: fact.id,
      statement: fact.statement,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      citationIds: [`m5b-doc-${document.contentDigest.slice(0, 16)}`],
      validFrom: utcInstant(commit.committedAt),
      validUntil: null,
      recordedFrom: utcInstant(commit.committedAt),
      recordedUntil: null,
    };
  });
  const graph = evidenceGraphSchema.safeParse({
    id: "m5b-frozen-lachesis-history",
    version: "1",
    citations,
    facts: [...commitFacts, ...semanticFacts],
    edges: [],
  });
  return graph.success
    ? { ok: true, value: graph.data }
    : { ok: false, error: failure("Frozen evidence graph is invalid.") };
}

async function buildTasks(
  graph: EvidenceGraph,
  commits: ReadonlyArray<z.infer<typeof repositoryCommitSchema>>,
): Promise<Result<ReadonlyArray<M5bPilotTask>, Diagnostic>> {
  const recordedAtValue = commits[0]?.committedAt;
  if (recordedAtValue === undefined)
    return { ok: false, error: failure("Corpus has no source snapshot time.") };
  const sourceSnapshotRecordedAt = utcInstant(recordedAtValue);
  const tasks: Array<M5bPilotTask> = [];
  for (const spec of TASKS) {
    const cardinality = spec.answerSource === "last-object" ? 1 : 2;
    const task = m5PublicTaskContractSchema.safeParse({
      id: spec.id,
      version: "1",
      instruction: spec.instruction,
      taskClass: spec.taskClass,
      answerContract: {
        role: "evidence-values",
        cardinality,
        ordering: spec.ordering,
        anchorSubject: spec.anchorSubject,
        derivation: "same-subject-fact-set",
        requiredFactPredicates: spec.predicates,
        answerSource: spec.answerSource,
        minimumSupportingFacts: spec.predicates.length,
        sufficiencyRule:
          "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
      },
      evidenceLimits: evidenceLimits(),
    });
    if (!task.success)
      return { ok: false, error: failure(`Task ${spec.id} is invalid.`) };
    const compiled = await compileM4EvidenceView({
      graphInput: graph,
      queryInput: {
        id: task.data.id,
        text: task.data.instruction,
        validAt: null,
        recordedAt: null,
        ...task.data.evidenceLimits,
      },
      providerProfileInput: M4A_PROVIDER_PROFILES.openai,
      taskProfileInput: {
        taskClass: task.data.taskClass,
        answerContract: task.data.answerContract,
      },
      policyInput: {
        ...M4A_INITIAL_POLICY,
        id: "m5b-corpus-audit-lexical",
        rules: M4A_INITIAL_POLICY.rules.map((rule) => ({
          ...rule,
          view: "lexical-facts",
        })),
      },
    });
    if (!compiled.ok)
      return {
        ok: false,
        error: failure(`Task ${spec.id} cannot compile evidence.`),
      };
    const expected =
      spec.expectedValues.length === 0
        ? {
            outcome: "insufficient-evidence" as const,
            answerValues: [] as const,
            supportingFactIds: [] as const,
          }
        : {
            outcome: "answered" as const,
            answerValues: spec.expectedValues,
            supportingFactIds: spec.expectedFactIds,
          };
    const reconstructed = await reconstructM4Provenance({
      compiledViewInput: compiled.value,
      oracleAnswerInput: expected,
    });
    if (!reconstructed.ok)
      return {
        ok: false,
        error: failure(`Task ${spec.id} failed its offline answer witness.`),
      };
    const body = {
      task: task.data,
      temporalLens: {
        validAt: null,
        recordedAt: null,
        rationale: `The current storage lens is pinned to the frozen repository graph whose source snapshot was recorded at ${sourceSnapshotRecordedAt}.`,
      },
      expected,
      audit: {
        independentlyValidated: true as const,
        sourceDocumentPaths: spec.sourceDocumentPaths,
        sourceCommits: spec.sourceCommits,
        probeRole: spec.probeRole,
      },
    };
    const taskDigest = await digestValue(body);
    if (!taskDigest.ok) return taskDigest;
    tasks.push(
      m5bPilotTaskSchema.parse({ ...body, taskDigest: taskDigest.value }),
    );
  }
  return { ok: true, value: tasks };
}

export async function materializeM5bCorpus(
  input: Readonly<{
    repositoryRoot: string;
    sourceSnapshotCommit?: string | undefined;
  }>,
): Promise<Result<M5bCorpus, Diagnostic>> {
  const sourceSnapshotCommit =
    input.sourceSnapshotCommit ?? M5B0_CORPUS_PROTOCOL.sourceSnapshotCommit;
  const parsedCommit = commitSchema.safeParse(sourceSnapshotCommit);
  if (!parsedCommit.success)
    return { ok: false, error: failure("Corpus source commit is invalid.") };
  const [commits, documents] = await Promise.all([
    loadCommits(input.repositoryRoot, parsedCommit.data),
    loadDocuments(input.repositoryRoot, parsedCommit.data),
  ]);
  if (!commits.ok) return commits;
  if (!documents.ok) return documents;
  const graph = buildGraph(commits.value, documents.value);
  if (!graph.ok) return graph;
  const tasks = await buildTasks(graph.value, commits.value);
  if (!tasks.ok) return tasks;
  const sourceSnapshotRecordedAt = commits.value[0]?.committedAt;
  if (sourceSnapshotRecordedAt === undefined)
    return { ok: false, error: failure("Corpus source commit is absent.") };
  const body = {
    formatVersion: "1" as const,
    protocol: "lachesis-repository-history-development-pilot/1" as const,
    sourceSnapshotCommit: parsedCommit.data,
    sourceSnapshotRecordedAt,
    commits: commits.value,
    documents: documents.value,
    graph: graph.value,
    tasks: tasks.value,
    audit: {
      taskCount: 12 as const,
      answeredTaskCount: 11 as const,
      insufficientEvidenceTaskCount: 1 as const,
      categories: [...new Set(TASKS.map((task) => task.category))].toSorted(),
      everyAnswerReconstructedOffline: true as const,
      liveGitHubRequired: false as const,
      benchmarkGeneralizationClaimed: false as const,
    },
  };
  const corpusDigest = await digestValue(body);
  if (!corpusDigest.ok) return corpusDigest;
  const parsed = m5bCorpusSchema.safeParse({
    ...body,
    corpusDigest: corpusDigest.value,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: failure("Materialized M5b corpus is invalid.") };
}

export async function validateM5bCorpus(
  input: unknown,
): Promise<Result<M5bCorpus, Diagnostic>> {
  const parsed = m5bCorpusSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: failure("M5b corpus schema is invalid.") };
  const { corpusDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  if (digest.value !== corpusDigest)
    return { ok: false, error: failure("M5b corpus digest is invalid.") };
  const canonical = canonicalizeJson(parsed.data);
  if (!canonical.ok) return canonical;
  const json = parseJson(canonical.value);
  if (!json.ok) return json;
  return { ok: true, value: parsed.data };
}
