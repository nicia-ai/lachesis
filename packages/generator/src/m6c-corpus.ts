import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const hostileSchema = z
  .strictObject({
    id: z.string().regex(/^m6c-hostile-[a-z0-9-]+$/),
    mutation: z.enum([
      "schema-domain",
      "function-output",
      "predicate-decision",
      "reducer-law",
      "fixed-point-step",
      "measure-value",
      "effect-contract",
      "role-version",
    ]),
    expected: z.literal("non-conformant"),
  })
  .readonly();

const corpusSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m6c-cross-catalog-corpus/1"),
    provenance: z.literal("fresh-synthetic-development-only"),
    positiveCatalogPairs: z.literal(1),
    hostile: z.array(hostileSchema).length(8).readonly(),
  })
  .readonly();

export type M6cOfflineConformanceCorpus = z.infer<typeof corpusSchema>;

const CORPUS = corpusSchema.parse({
  protocol: "lachesis-m6c-cross-catalog-corpus/1",
  provenance: "fresh-synthetic-development-only",
  positiveCatalogPairs: 1,
  hostile: [
    {
      id: "m6c-hostile-schema-domain",
      mutation: "schema-domain",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-function-output",
      mutation: "function-output",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-predicate-decision",
      mutation: "predicate-decision",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-reducer-law",
      mutation: "reducer-law",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-fixed-point-step",
      mutation: "fixed-point-step",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-measure-value",
      mutation: "measure-value",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-effect-contract",
      mutation: "effect-contract",
      expected: "non-conformant",
    },
    {
      id: "m6c-hostile-role-version",
      mutation: "role-version",
      expected: "non-conformant",
    },
  ],
});

export function loadM6cOfflineConformanceCorpus(): M6cOfflineConformanceCorpus {
  return structuredClone(CORPUS);
}

const hostileOutcomeSchema = z
  .strictObject({ caseId: z.string(), acceptedAsEquivalent: z.boolean() })
  .readonly();

export type M6cFalseEquivalenceAudit = Readonly<{
  protocol: "lachesis-m6c-false-equivalence-audit/1";
  hostileCaseCount: 8;
  acceptedHostileCollisions: number;
  passed: boolean;
  auditDigest: string;
}>;

export async function auditM6cFalseEquivalence(
  inputs: ReadonlyArray<unknown>,
): Promise<Result<M6cFalseEquivalenceAudit, Diagnostic>> {
  const parsed = z.array(hostileOutcomeSchema).length(8).safeParse(inputs);
  const expected = new Set(CORPUS.hostile.map((item) => item.id));
  if (
    !parsed.success ||
    new Set(parsed.data.map((item) => item.caseId)).size !== 8 ||
    parsed.data.some((item) => !expected.has(item.caseId))
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M6c audit must cover every hostile cross-catalog case exactly once.",
      ),
    };
  const acceptedHostileCollisions = parsed.data.filter(
    (item) => item.acceptedAsEquivalent,
  ).length;
  const body = {
    protocol: "lachesis-m6c-false-equivalence-audit/1" as const,
    hostileCaseCount: 8 as const,
    acceptedHostileCollisions,
    passed: acceptedHostileCollisions === 0,
  };
  const digest = await digestValue(body);
  return digest.ok
    ? { ok: true, value: Object.freeze({ ...body, auditDigest: digest.value }) }
    : digest;
}
