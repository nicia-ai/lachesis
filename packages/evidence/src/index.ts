export {
  auditM3aOfflineDesign,
  type M3aAuditIssue,
  type M3aOfflineAuditReport,
  type M3aSubstrateMetrics,
  type M3aTaskScore,
} from "./audit.js";
export {
  type EvidenceCitation,
  evidenceCitationSchema,
  type EvidenceEdge,
  evidenceEdgeSchema,
  type EvidenceFact,
  evidenceFactSchema,
  type EvidenceNeighborhood,
  evidenceNeighborhoodSchema,
  type EvidencePath,
  evidencePathSchema,
  type EvidenceQuery,
  evidenceQuerySchema,
  type EvidenceSelectionReference,
  evidenceSelectionReferenceSchema,
  type EvidenceSource,
  type EvidenceSourceFailure,
  evidenceSourceFailureSchema,
  type EvidenceSourceIdentity,
  evidenceSourceIdentitySchema,
  referenceEvidenceSelection,
  selectEvidence,
} from "./contract.js";
export {
  M3A_CORPUS_PROTOCOL,
  M3A_DETERMINISTIC_CORPUS,
  M3A_REFERENCE_GRAPH,
  type M3aTask,
  m3aTaskSchema,
} from "./corpus.js";
export {
  createInMemoryGraphEvidenceSource,
  type EvidenceGraph,
  evidenceGraphSchema,
} from "./graph.js";
export {
  createMatchedTextChunks,
  createMatchedTextEvidenceSource,
  type TextEvidenceChunk,
  textEvidenceChunkSchema,
} from "./text.js";
