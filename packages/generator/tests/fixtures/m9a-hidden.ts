import { z } from "zod";

export const m9aHiddenExpectationSchema = z
  .strictObject({
    caseId: z.string().min(1),
    answerFragments: z.string().array().readonly(),
    requiredDocumentIds: z.string().array().readonly(),
  })
  .readonly();
export type M9aHiddenExpectation = z.infer<typeof m9aHiddenExpectationSchema>;

export const M9A_HIDDEN_EXPECTATIONS = m9aHiddenExpectationSchema
  .array()
  .readonly()
  .parse([
    {
      caseId: "m9a-dev-join",
      answerFragments: ["2020", "2022"],
      requiredDocumentIds: ["alpha-registry", "beta-registry"],
    },
  ]);
