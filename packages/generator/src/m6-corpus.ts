import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const positiveCaseSchema = z
  .strictObject({
    id: z.string().regex(/^m6-positive-[a-z0-9-]+$/),
    relation: z.enum([
      "alpha-renaming",
      "task-literal-change",
      "cross-surface-domain",
      "within-envelope-cardinality",
      "storage-order-permutation",
      "evidence-snapshot-content-change",
    ]),
    expected: z.literal("equivalent-strategy"),
  })
  .readonly();

const hostileCaseSchema = z
  .strictObject({
    id: z.string().regex(/^m6-hostile-[a-z0-9-]+$/),
    mutation: z.enum([
      "semantic-obligation",
      "state-change-requirement",
      "effect-class",
      "reducer-law",
      "recursion-measure",
      "necessary-decomposition",
      "ordered-branch-semantics",
      "authority-widening",
      "evidence-sufficiency",
      "outside-envelope",
      "ambiguous-match",
      "identity-tamper",
    ]),
    expected: z.literal("rejected-or-fallback"),
  })
  .readonly();

const m6OfflineCorpusSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m6-offline-strategy-corpus/1"),
    provenance: z.literal("fresh-synthetic-development-only"),
    positive: z.array(positiveCaseSchema).length(6).readonly(),
    hostile: z.array(hostileCaseSchema).length(12).readonly(),
  })
  .readonly();

export type M6OfflineStrategyCorpus = z.infer<typeof m6OfflineCorpusSchema>;

const CORPUS = m6OfflineCorpusSchema.parse({
  protocol: "lachesis-m6-offline-strategy-corpus/1",
  provenance: "fresh-synthetic-development-only",
  positive: [
    {
      id: "m6-positive-alpha-renaming",
      relation: "alpha-renaming",
      expected: "equivalent-strategy",
    },
    {
      id: "m6-positive-task-literal-change",
      relation: "task-literal-change",
      expected: "equivalent-strategy",
    },
    {
      id: "m6-positive-cross-surface-domain",
      relation: "cross-surface-domain",
      expected: "equivalent-strategy",
    },
    {
      id: "m6-positive-within-envelope-cardinality",
      relation: "within-envelope-cardinality",
      expected: "equivalent-strategy",
    },
    {
      id: "m6-positive-storage-order-permutation",
      relation: "storage-order-permutation",
      expected: "equivalent-strategy",
    },
    {
      id: "m6-positive-evidence-snapshot-change",
      relation: "evidence-snapshot-content-change",
      expected: "equivalent-strategy",
    },
  ],
  hostile: [
    {
      id: "m6-hostile-semantic-obligation",
      mutation: "semantic-obligation",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-state-change",
      mutation: "state-change-requirement",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-effect-class",
      mutation: "effect-class",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-reducer-law",
      mutation: "reducer-law",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-recursion-measure",
      mutation: "recursion-measure",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-decomposition",
      mutation: "necessary-decomposition",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-ordered-branches",
      mutation: "ordered-branch-semantics",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-authority-widening",
      mutation: "authority-widening",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-evidence-sufficiency",
      mutation: "evidence-sufficiency",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-outside-envelope",
      mutation: "outside-envelope",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-ambiguous-match",
      mutation: "ambiguous-match",
      expected: "rejected-or-fallback",
    },
    {
      id: "m6-hostile-identity-tamper",
      mutation: "identity-tamper",
      expected: "rejected-or-fallback",
    },
  ],
});

export function loadM6OfflineStrategyCorpus(): M6OfflineStrategyCorpus {
  return structuredClone(CORPUS);
}

const hostileOutcomeSchema = z
  .strictObject({
    caseId: z.string(),
    acceptedAsEquivalent: z.boolean(),
  })
  .readonly();

export type M6FalseEquivalenceAudit = Readonly<{
  protocol: "lachesis-m6-false-equivalence-audit/1";
  hostileCaseCount: 12;
  acceptedHostileCollisions: number;
  passed: boolean;
  auditDigest: string;
}>;

export async function auditM6FalseEquivalence(
  inputs: ReadonlyArray<unknown>,
): Promise<Result<M6FalseEquivalenceAudit, Diagnostic>> {
  const parsed = z.array(hostileOutcomeSchema).length(12).safeParse(inputs);
  const expectedIds = new Set(CORPUS.hostile.map((item) => item.id));
  if (
    !parsed.success ||
    new Set(parsed.data.map((item) => item.caseId)).size !== 12 ||
    parsed.data.some((item) => !expectedIds.has(item.caseId))
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "False-equivalence audit must cover every hostile M6 case exactly once.",
      ),
    };
  const acceptedHostileCollisions = parsed.data.filter(
    (item) => item.acceptedAsEquivalent,
  ).length;
  const body = {
    protocol: "lachesis-m6-false-equivalence-audit/1" as const,
    hostileCaseCount: 12 as const,
    acceptedHostileCollisions,
    passed: acceptedHostileCollisions === 0,
  };
  const digest = await digestValue(body);
  return digest.ok
    ? { ok: true, value: Object.freeze({ ...body, auditDigest: digest.value }) }
    : digest;
}
