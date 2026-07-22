import { z } from "zod";

export const mutationClassSchema = z.enum([
  "none",
  "schema-boundary",
  "predicate-boundary",
  "reducer-behavior",
  "role-version",
]);

export const adjudicationEntrySchema = z
  .strictObject({
    caseId: z.string().regex(/^blind-[0-9]{2}$/),
    expected: z.enum(["equivalent", "non-equivalent"]),
    mutationClass: mutationClassSchema,
    rationale: z.string().min(1),
  })
  .readonly();

export type AdjudicationEntry = z.infer<typeof adjudicationEntrySchema>;

const SEALED_ADJUDICATION = z
  .array(adjudicationEntrySchema)
  .length(12)
  .readonly()
  .parse([
    {
      caseId: "blind-01",
      expected: "equivalent",
      mutationClass: "none",
      rationale:
        "The two warehouse author modules agree on every frozen boundary and reducer obligation.",
    },
    {
      caseId: "blind-02",
      expected: "equivalent",
      mutationClass: "none",
      rationale:
        "The two transit author modules agree on every frozen boundary and reducer obligation.",
    },
    {
      caseId: "blind-03",
      expected: "equivalent",
      mutationClass: "none",
      rationale:
        "The two support author modules agree on every frozen boundary and reducer obligation.",
    },
    {
      caseId: "blind-04",
      expected: "non-equivalent",
      mutationClass: "schema-boundary",
      rationale:
        "The hostile warehouse schema rejects the valid upper-capacity boundary 1000.",
    },
    {
      caseId: "blind-05",
      expected: "non-equivalent",
      mutationClass: "predicate-boundary",
      rationale:
        "The hostile warehouse predicate excludes the reorder boundary 10.",
    },
    {
      caseId: "blind-06",
      expected: "non-equivalent",
      mutationClass: "reducer-behavior",
      rationale:
        "The hostile warehouse reducer selects minimum rather than maximum demand.",
    },
    {
      caseId: "blind-07",
      expected: "non-equivalent",
      mutationClass: "schema-boundary",
      rationale:
        "The hostile transit schema rejects the declared upper delay boundary 7200.",
    },
    {
      caseId: "blind-08",
      expected: "non-equivalent",
      mutationClass: "predicate-boundary",
      rationale:
        "The hostile transit predicate excludes the service-alert boundary 300.",
    },
    {
      caseId: "blind-09",
      expected: "non-equivalent",
      mutationClass: "role-version",
      rationale:
        "The hostile transit catalog declares a distinct role protocol version.",
    },
    {
      caseId: "blind-10",
      expected: "non-equivalent",
      mutationClass: "schema-boundary",
      rationale:
        "The hostile support schema rejects the valid priority boundary 0.",
    },
    {
      caseId: "blind-11",
      expected: "non-equivalent",
      mutationClass: "predicate-boundary",
      rationale:
        "The hostile support predicate excludes escalation priority 4.",
    },
    {
      caseId: "blind-12",
      expected: "non-equivalent",
      mutationClass: "reducer-behavior",
      rationale:
        "The hostile support reducer selects minimum rather than maximum priority.",
    },
  ]);

/** Labels are loaded only after blinded outcomes have been finalized. */
export function loadSealedAdjudication(): ReadonlyArray<AdjudicationEntry> {
  return structuredClone(SEALED_ADJUDICATION);
}
