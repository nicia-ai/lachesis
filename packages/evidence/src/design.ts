export const M3A1_FACTORIAL_ARMS = Object.freeze([
  Object.freeze({
    id: "lexical-facts",
    selection: "lexical",
    encoding: "facts",
    question: "Baseline fact retrieval from matched rendered text.",
  }),
  Object.freeze({
    id: "graph-facts",
    selection: "graph",
    encoding: "facts",
    question: "Graph retrieval benefit without relationship exposure.",
  }),
  Object.freeze({
    id: "graph-adjacency",
    selection: "graph",
    encoding: "untyped-adjacency",
    question: "Adjacency benefit without typed relationship labels or paths.",
  }),
  Object.freeze({
    id: "graph-typed",
    selection: "graph",
    encoding: "typed-relationships",
    question: "Typed relationship and path benefit over identical graph facts.",
  }),
]);

export const M3A1_PROSPECTIVE_ANALYSIS = Object.freeze({
  id: "lachesis-m3a1-prospective-analysis",
  version: "1",
  status: "offline-design-only",
  primaryUnit: "one held-out case-provider pair in repetition one",
  confirmationUnit:
    "the same analysis repeated independently in repetition two",
  repetitionsArePooled: false,
  heldoutCases: 140,
  heldoutStructuralCasesPerProvider: 100,
  heldoutNegativeControlsPerProvider: 40,
  pairedSemanticNonInferiorityMargin: -0.1,
  pairedNegativeControlNonInferiorityMargin: -0.1,
  confidenceLevel: 0.95,
  interval: "Tango paired risk-difference interval",
  superiorityTest: "exact two-sided McNemar test",
  minimumDiscordantPairsForSuperiority: 20,
  sensitivity: Object.freeze({
    structuralZeroAdverseLowerBound: -0.03699349820698568,
    structuralFourAdverseLowerBound: -0.09837071435887923,
    structuralFiveAdverseLowerBound: -0.11175046923191914,
    negativeControlZeroAdverseLowerBound: -0.08762160119728665,
    rationale:
      "One hundred structural units keep up to four one-sided adverse pairs inside the frozen -0.10 margin; forty negative controls make an all-tie result inferentially eligible while the safety gate separately requires zero violations.",
  }),
  hypotheses: Object.freeze([
    "Graph-selected facts improve paired evidence recall over lexical facts on preregistered retrieval-advantage tasks.",
    "Untyped adjacency isolates connectivity value over identical graph-selected fact sets.",
    "Typed relationships and paths add semantic or citation value over identical graph-selected facts and adjacency.",
    "All graph arms remain non-inferior on negative controls under identical context and execution budgets.",
  ]),
  killGates: Object.freeze([
    "Any answer-bearing query leakage or query/public-instruction mismatch.",
    "Any factorial graph arm selects a different fact set from another graph encoding arm.",
    "Any context exceeds fact, citation, edge, path, byte, token-upper-bound, or hop limits.",
    "Any edge lacks independent provenance or any typed relationship is unsupported by its cited record.",
    "Graph benefit disappears when fact and serialized-context budgets are held equal.",
    "Any negative-control divergence, capability violation, or unauthorized execution.",
  ]),
});
