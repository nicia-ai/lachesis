import { digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9A_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m9a-external-document-snapshot",
  version: "1.0.0",
  search: "deterministic-bm25-reference/1",
  chunking: "unicode-scalar-fixed-utf8-byte-window/1",
});

export const M9A_CORPUS_LIMITS = Object.freeze({
  maxDocuments: 64,
  maxDocumentBytes: 64 * 1024,
  maxCorpusBytes: 512 * 1024,
  maxChunkBytes: 1_024,
  maxChunksPerDocument: 256,
  maxQueryBytes: 512,
  maxSearchResults: 8,
  maxReadBytes: 4_096,
});

const identifierSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.normalize("NFC") === value, {
    message: "Text must already be NFC-normalized.",
  });

export const m9aDocumentInputSchema = z
  .strictObject({
    id: identifierSchema,
    title: canonicalTextSchema.max(256),
    text: canonicalTextSchema.max(M9A_CORPUS_LIMITS.maxDocumentBytes),
  })
  .readonly();
export type M9aDocumentInput = z.infer<typeof m9aDocumentInputSchema>;

export const m9aCorpusInputSchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1).max(64),
    documents: m9aDocumentInputSchema
      .array()
      .min(1)
      .max(M9A_CORPUS_LIMITS.maxDocuments)
      .readonly(),
  })
  .readonly();
export type M9aCorpusInput = z.infer<typeof m9aCorpusInputSchema>;

export const m9aDocumentIdentitySchema = z
  .strictObject({
    corpusId: identifierSchema,
    corpusVersion: z.string().min(1).max(64),
    snapshotDigest: digestSchema,
    documentId: identifierSchema,
    contentDigest: digestSchema,
  })
  .readonly();
export type M9aDocumentIdentity = z.infer<typeof m9aDocumentIdentitySchema>;

export const m9aChunkIdentitySchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    document: m9aDocumentIdentitySchema,
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().positive(),
    contentDigest: digestSchema,
  })
  .readonly()
  .refine((value) => value.endByte > value.startByte, {
    message: "Chunk endByte must be greater than startByte.",
  });
export type M9aChunkIdentity = z.infer<typeof m9aChunkIdentitySchema>;

export const m9aCorpusSnapshotSchema = z
  .strictObject({
    protocol: z.strictObject({
      id: z.literal(M9A_CORPUS_PROTOCOL.id),
      version: z.literal(M9A_CORPUS_PROTOCOL.version),
      search: z.literal(M9A_CORPUS_PROTOCOL.search),
      chunking: z.literal(M9A_CORPUS_PROTOCOL.chunking),
    }),
    corpusId: identifierSchema,
    corpusVersion: z.string().min(1).max(64),
    snapshotDigest: digestSchema,
    documentCount: z.number().int().positive(),
    corpusBytes: z.number().int().positive(),
    documents: m9aDocumentIdentitySchema.array().readonly(),
  })
  .readonly();
export type M9aCorpusSnapshot = z.infer<typeof m9aCorpusSnapshotSchema>;

export const m9aRetrievalFailureSchema = z
  .strictObject({
    kind: z.enum([
      "invalid-input",
      "duplicate-document",
      "limit-exceeded",
      "aborted",
      "unknown-document",
      "unknown-chunk",
      "identity-mismatch",
      "digest-failure",
    ]),
    message: z.string().min(1),
  })
  .readonly();
export type M9aRetrievalFailure = z.infer<typeof m9aRetrievalFailureSchema>;

export const m9aSearchRequestSchema = z
  .strictObject({
    query: canonicalTextSchema.max(M9A_CORPUS_LIMITS.maxQueryBytes),
    maxResults: z
      .number()
      .int()
      .positive()
      .max(M9A_CORPUS_LIMITS.maxSearchResults),
  })
  .readonly();
export type M9aSearchRequest = z.infer<typeof m9aSearchRequestSchema>;

export const m9aSearchHitSchema = z
  .strictObject({
    rank: z.number().int().positive(),
    score: z.number().nonnegative(),
    matchedTerms: z.string().array().readonly(),
    chunk: m9aChunkIdentitySchema,
  })
  .readonly();
export type M9aSearchHit = z.infer<typeof m9aSearchHitSchema>;

export const m9aSearchResultSchema = z
  .strictObject({
    snapshotDigest: digestSchema,
    query: canonicalTextSchema,
    maxResults: z.number().int().positive(),
    hits: m9aSearchHitSchema
      .array()
      .max(M9A_CORPUS_LIMITS.maxSearchResults)
      .readonly(),
  })
  .readonly();
export type M9aSearchResult = z.infer<typeof m9aSearchResultSchema>;

export const m9aReadRequestSchema = z
  .strictObject({
    chunks: m9aChunkIdentitySchema
      .array()
      .max(M9A_CORPUS_LIMITS.maxSearchResults)
      .readonly(),
    maxBytes: z.number().int().positive().max(M9A_CORPUS_LIMITS.maxReadBytes),
  })
  .readonly();
export type M9aReadRequest = z.infer<typeof m9aReadRequestSchema>;

export const m9aReadExcerptSchema = z
  .strictObject({
    chunk: m9aChunkIdentitySchema,
    text: z.string(),
    bytes: z.number().int().positive(),
  })
  .readonly();
export type M9aReadExcerpt = z.infer<typeof m9aReadExcerptSchema>;

export const m9aReadResultSchema = z
  .strictObject({
    snapshotDigest: digestSchema,
    excerpts: m9aReadExcerptSchema.array().readonly(),
    totalBytes: z.number().int().nonnegative(),
  })
  .readonly();
export type M9aReadResult = z.infer<typeof m9aReadResultSchema>;

const corpusBrand: unique symbol = Symbol("M9aCorpus");
export type M9aCorpus = Readonly<{ [corpusBrand]: "M9aCorpus" }>;

type StoredChunk = Readonly<{
  identity: M9aChunkIdentity;
  text: string;
  tokens: ReadonlyArray<string>;
}>;

type StoredCorpus = Readonly<{
  snapshot: M9aCorpusSnapshot;
  chunks: ReadonlyArray<StoredChunk>;
  chunksById: ReadonlyMap<string, StoredChunk>;
}>;

const corpora = new WeakMap<M9aCorpus, StoredCorpus>();
const encoder = new TextEncoder();

function failure(
  kind: M9aRetrievalFailure["kind"],
  message: string,
): M9aRetrievalFailure {
  return { kind, message };
}

function freezeArray<T>(items: ReadonlyArray<T>): ReadonlyArray<T> {
  return Object.freeze([...items]);
}

function tokenize(text: string): ReadonlyArray<string> {
  return freezeArray(
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

function splitText(
  text: string,
): ReadonlyArray<
  Readonly<{ startByte: number; endByte: number; text: string }>
> {
  const chunks: Array<
    Readonly<{ startByte: number; endByte: number; text: string }>
  > = [];
  let startByte = 0;
  let currentBytes = 0;
  let currentText = "";
  for (const scalar of text) {
    const scalarBytes = encoder.encode(scalar).byteLength;
    if (
      currentBytes > 0 &&
      currentBytes + scalarBytes > M9A_CORPUS_LIMITS.maxChunkBytes
    ) {
      chunks.push({
        startByte,
        endByte: startByte + currentBytes,
        text: currentText,
      });
      startByte += currentBytes;
      currentBytes = 0;
      currentText = "";
    }
    currentText += scalar;
    currentBytes += scalarBytes;
  }
  if (currentBytes > 0)
    chunks.push({
      startByte,
      endByte: startByte + currentBytes,
      text: currentText,
    });
  return chunks;
}

function sameChunkIdentity(
  left: M9aChunkIdentity,
  right: M9aChunkIdentity,
): boolean {
  return (
    left.id === right.id &&
    left.startByte === right.startByte &&
    left.endByte === right.endByte &&
    left.contentDigest === right.contentDigest &&
    left.document.corpusId === right.document.corpusId &&
    left.document.corpusVersion === right.document.corpusVersion &&
    left.document.snapshotDigest === right.document.snapshotDigest &&
    left.document.documentId === right.document.documentId &&
    left.document.contentDigest === right.document.contentDigest
  );
}

export async function createM9aCorpus(
  input: M9aCorpusInput,
): Promise<Result<M9aCorpus, M9aRetrievalFailure>> {
  const parsed = m9aCorpusInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: failure(
        "invalid-input",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      ),
    };
  const documents = [...parsed.data.documents].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const ids = new Set(documents.map((document) => document.id));
  if (ids.size !== documents.length)
    return {
      ok: false,
      error: failure("duplicate-document", "Document IDs must be unique."),
    };
  const byteLengths = documents.map(
    (document) => encoder.encode(document.text).byteLength,
  );
  const oversizedIndex = byteLengths.findIndex(
    (bytes) => bytes > M9A_CORPUS_LIMITS.maxDocumentBytes,
  );
  if (oversizedIndex >= 0)
    return {
      ok: false,
      error: failure(
        "limit-exceeded",
        `Document ${documents[oversizedIndex]?.id ?? "unknown"} exceeds the byte limit.`,
      ),
    };
  const corpusBytes = byteLengths.reduce((sum, bytes) => sum + bytes, 0);
  if (corpusBytes > M9A_CORPUS_LIMITS.maxCorpusBytes)
    return {
      ok: false,
      error: failure(
        "limit-exceeded",
        "Corpus exceeds the maximum UTF-8 byte size.",
      ),
    };
  const snapshotDigest = await digestValue({
    protocol: M9A_CORPUS_PROTOCOL,
    corpusId: parsed.data.id,
    corpusVersion: parsed.data.version,
    documents,
  });
  if (!snapshotDigest.ok)
    return {
      ok: false,
      error: failure("digest-failure", snapshotDigest.error.message),
    };
  const documentIdentities: Array<M9aDocumentIdentity> = [];
  const chunks: Array<StoredChunk> = [];
  for (const document of documents) {
    const documentDigest = await digestValue({
      id: document.id,
      title: document.title,
      text: document.text,
    });
    if (!documentDigest.ok)
      return {
        ok: false,
        error: failure("digest-failure", documentDigest.error.message),
      };
    const documentIdentity: M9aDocumentIdentity = Object.freeze({
      corpusId: parsed.data.id,
      corpusVersion: parsed.data.version,
      snapshotDigest: snapshotDigest.value,
      documentId: document.id,
      contentDigest: documentDigest.value,
    });
    documentIdentities.push(documentIdentity);
    const slices = splitText(document.text);
    if (slices.length > M9A_CORPUS_LIMITS.maxChunksPerDocument)
      return {
        ok: false,
        error: failure(
          "limit-exceeded",
          `Document ${document.id} exceeds the chunk-count limit.`,
        ),
      };
    for (const slice of slices) {
      const chunkDigest = await digestValue({
        document: documentIdentity,
        startByte: slice.startByte,
        endByte: slice.endByte,
        text: slice.text,
      });
      if (!chunkDigest.ok)
        return {
          ok: false,
          error: failure("digest-failure", chunkDigest.error.message),
        };
      const identity: M9aChunkIdentity = Object.freeze({
        id: `${document.id}:${slice.startByte}-${slice.endByte}:${chunkDigest.value}`,
        document: documentIdentity,
        startByte: slice.startByte,
        endByte: slice.endByte,
        contentDigest: chunkDigest.value,
      });
      chunks.push(
        Object.freeze({
          identity,
          text: slice.text,
          tokens: tokenize(`${document.title} ${slice.text}`),
        }),
      );
    }
  }
  const snapshot = Object.freeze({
    protocol: M9A_CORPUS_PROTOCOL,
    corpusId: parsed.data.id,
    corpusVersion: parsed.data.version,
    snapshotDigest: snapshotDigest.value,
    documentCount: documents.length,
    corpusBytes,
    documents: freezeArray(documentIdentities),
  });
  const validatedSnapshot = m9aCorpusSnapshotSchema.safeParse(snapshot);
  if (!validatedSnapshot.success)
    return {
      ok: false,
      error: failure(
        "invalid-input",
        validatedSnapshot.error.issues.map((issue) => issue.message).join("; "),
      ),
    };
  const token: M9aCorpus = Object.freeze({ [corpusBrand]: "M9aCorpus" });
  const frozenChunks = freezeArray(chunks);
  corpora.set(
    token,
    Object.freeze({
      snapshot: validatedSnapshot.data,
      chunks: frozenChunks,
      chunksById: new Map(
        frozenChunks.map((chunk) => [chunk.identity.id, chunk]),
      ),
    }),
  );
  return { ok: true, value: token };
}

export function inspectM9aCorpus(
  corpus: M9aCorpus,
): M9aCorpusSnapshot | undefined {
  return corpora.get(corpus)?.snapshot;
}

/** @internal Private measurement seam; not exported from the package facade. */
export function m9aInternalInspectChunkIdentities(
  corpus: M9aCorpus,
): ReadonlyArray<M9aChunkIdentity> | undefined {
  const stored = corpora.get(corpus);
  return stored === undefined
    ? undefined
    : freezeArray(stored.chunks.map((chunk) => chunk.identity));
}

export function searchM9aCorpus(
  corpus: M9aCorpus,
  request: M9aSearchRequest,
  signal: AbortSignal,
): Result<M9aSearchResult, M9aRetrievalFailure> {
  if (signal.aborted)
    return {
      ok: false,
      error: failure("aborted", "Search was cancelled before dispatch."),
    };
  const stored = corpora.get(corpus);
  if (stored === undefined)
    return {
      ok: false,
      error: failure("invalid-input", "Search requires a valid corpus token."),
    };
  const parsed = m9aSearchRequestSchema.safeParse(request);
  if (!parsed.success)
    return {
      ok: false,
      error: failure(
        "invalid-input",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      ),
    };
  if (
    encoder.encode(parsed.data.query).byteLength >
    M9A_CORPUS_LIMITS.maxQueryBytes
  )
    return {
      ok: false,
      error: failure("limit-exceeded", "Search query exceeds the byte limit."),
    };
  const queryTerms = [...new Set(tokenize(parsed.data.query))].toSorted();
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms)
    documentFrequency.set(
      term,
      stored.chunks.filter((chunk) => chunk.tokens.includes(term)).length,
    );
  const averageLength =
    stored.chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0) /
    stored.chunks.length;
  const scored: Array<
    Readonly<{
      score: number;
      matchedTerms: ReadonlyArray<string>;
      chunk: StoredChunk;
    }>
  > = [];
  for (const chunk of stored.chunks) {
    const frequencies = new Map<string, number>();
    for (const token of chunk.tokens)
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    let score = 0;
    const matchedTerms: Array<string> = [];
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0;
      if (frequency === 0) continue;
      matchedTerms.push(term);
      const containing = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(
        1 + (stored.chunks.length - containing + 0.5) / (containing + 0.5),
      );
      const denominator =
        frequency +
        1.2 *
          (1 -
            0.75 +
            0.75 * (chunk.tokens.length / Math.max(averageLength, 1)));
      score += inverseFrequency * ((frequency * 2.2) / denominator);
    }
    if (score > 0)
      scored.push({
        score: Number(score.toFixed(12)),
        matchedTerms: freezeArray(matchedTerms),
        chunk,
      });
  }
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.chunk.identity.id.localeCompare(right.chunk.identity.id),
  );
  const hits = scored.slice(0, parsed.data.maxResults).map((entry, index) =>
    Object.freeze({
      rank: index + 1,
      score: entry.score,
      matchedTerms: entry.matchedTerms,
      chunk: entry.chunk.identity,
    }),
  );
  return {
    ok: true,
    value: Object.freeze({
      snapshotDigest: stored.snapshot.snapshotDigest,
      query: parsed.data.query,
      maxResults: parsed.data.maxResults,
      hits: freezeArray(hits),
    }),
  };
}

export function readM9aCorpus(
  corpus: M9aCorpus,
  request: M9aReadRequest,
  signal: AbortSignal,
): Result<M9aReadResult, M9aRetrievalFailure> {
  if (signal.aborted)
    return {
      ok: false,
      error: failure("aborted", "Read was cancelled before dispatch."),
    };
  const stored = corpora.get(corpus);
  if (stored === undefined)
    return {
      ok: false,
      error: failure("invalid-input", "Read requires a valid corpus token."),
    };
  const parsed = m9aReadRequestSchema.safeParse(request);
  if (!parsed.success)
    return {
      ok: false,
      error: failure(
        "invalid-input",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      ),
    };
  const excerpts: Array<M9aReadExcerpt> = [];
  let totalBytes = 0;
  for (const requested of parsed.data.chunks) {
    const found = stored.chunksById.get(requested.id);
    if (found === undefined)
      return {
        ok: false,
        error: failure("unknown-chunk", `Unknown chunk ${requested.id}.`),
      };
    if (!sameChunkIdentity(requested, found.identity))
      return {
        ok: false,
        error: failure(
          "identity-mismatch",
          `Chunk identity ${requested.id} does not match the snapshot.`,
        ),
      };
    const bytes = found.identity.endByte - found.identity.startByte;
    totalBytes += bytes;
    if (totalBytes > parsed.data.maxBytes)
      return {
        ok: false,
        error: failure(
          "limit-exceeded",
          "Requested chunks exceed the explicit read-byte limit.",
        ),
      };
    excerpts.push(
      Object.freeze({
        chunk: found.identity,
        text: found.text,
        bytes,
      }),
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      snapshotDigest: stored.snapshot.snapshotDigest,
      excerpts: freezeArray(excerpts),
      totalBytes,
    }),
  };
}
