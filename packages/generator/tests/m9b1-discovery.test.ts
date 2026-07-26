import {
  canonicalizeJson,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import { createM9aCorpus, type M9aCorpus } from "../src/m9a-corpus.js";
import {
  M9A_MODEL_VISIBLE_GRAMMAR,
  m9aPrivateReplayArtifactSchema,
} from "../src/m9a-retrieval.js";
import {
  type M9b0BoundModelRequest,
  type M9b0OfflineModel,
} from "../src/m9b0-comparison.js";
import {
  createM9b1ArmStore,
  inspectM9b1AuthoringRequest,
  M9B1_MATCHED_MODEL_ENVELOPE,
  M9B1_OFFLINE_DISCOVERY_PROTOCOL,
  type M9b1ArmRecord,
  type M9b1AtomicPersistence,
  type M9b1AuthoringModel,
  type M9b1BoundAuthoringRequest,
  type M9b1ExecutionOrder,
  type M9b1ExternalEvaluator,
  m9b1InternalArmRecordSchema,
  runM9b1OfflineProgramDiscovery,
} from "../src/m9b1-discovery.js";
import { strictJsonValueSchema } from "../src/strict-json.js";

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok)
    throw new Error(
      `Expected successful result: ${JSON.stringify(result.error)}`,
    );
  return result.value;
}

type MemoryPersistence = Readonly<{
  persistence: M9b1AtomicPersistence;
  writes: () => number;
  failWrite: (number: number | undefined) => void;
  transform: (
    transform: (
      records: ReadonlyArray<M9b1ArmRecord>,
    ) => Promise<ReadonlyArray<M9b1ArmRecord>>,
  ) => Promise<void>;
}>;

function memoryPersistence(): MemoryPersistence {
  let content: string | undefined;
  let revision = 0;
  let writes = 0;
  let failedWrite: number | undefined;
  return {
    persistence: {
      read: () =>
        Promise.resolve({
          ok: true,
          value:
            content === undefined
              ? undefined
              : { revision: String(revision), content },
        }),
      writeAtomic: ({ expectedRevision, content: next }) => {
        writes += 1;
        if (writes === failedWrite)
          return Promise.resolve({
            ok: false,
            error: diagnostic("BUDGET_EXCEEDED", "Injected write failure."),
          });
        const expected = content === undefined ? null : String(revision);
        if (expected !== expectedRevision)
          return Promise.resolve({
            ok: false,
            error: diagnostic(
              "REPLAY_REQUEST_MISMATCH",
              "Injected revision conflict.",
            ),
          });
        content = next;
        revision += 1;
        return Promise.resolve({
          ok: true,
          value: { revision: String(revision) },
        });
      },
    },
    writes: () => writes,
    failWrite: (number) => {
      failedWrite = number;
    },
    transform: async (transform) => {
      if (content === undefined) throw new Error("Expected persisted content.");
      const parsed = unwrap(parseJson(content));
      const snapshot = strictJsonValueSchema.parse(parsed);
      if (
        snapshot === null ||
        Array.isArray(snapshot) ||
        typeof snapshot !== "object" ||
        !("records" in snapshot) ||
        !Array.isArray(snapshot["records"])
      )
        throw new Error("Expected M9b.1 record store.");
      const records: Array<M9b1ArmRecord> = [];
      for (const record of snapshot["records"]) {
        records.push(m9b1InternalArmRecordSchema.parse(record));
      }
      content = unwrap(
        canonicalizeJson({
          protocol: "lachesis-m9b1-atomic-arm-store/1",
          records: await transform(records),
        }),
      );
      revision += 1;
    },
  };
}

async function corpusFixture(): Promise<M9aCorpus> {
  return unwrap(
    await createM9aCorpus({
      id: "m9b1-secret-corpus-id",
      version: "hidden-version",
      documents: [
        {
          id: "hidden-launch-record",
          title: "Hidden evaluator title",
          text: "SECRET_CORPUS_TEXT Project Alder launched in 2020.",
        },
      ],
    }),
  );
}

type AuthorOptions = Readonly<{
  requests?: Array<M9b1BoundAuthoringRequest> | undefined;
  source?: string | undefined;
  query?: string | undefined;
  calls?: (() => void) | undefined;
  fail?: boolean | undefined;
  invalidOutput?: boolean | undefined;
  overflowUsage?: boolean | undefined;
}>;

function authorModel(options: AuthorOptions = {}): M9b1AuthoringModel {
  return {
    identity: { id: "offline-model", version: "1" },
    complete: (request, signal) => {
      options.calls?.();
      options.requests?.push(request);
      if (signal.aborted)
        return Promise.resolve({
          ok: false,
          error: { kind: "aborted", message: "Aborted." },
        });
      if (options.fail === true)
        return Promise.resolve({
          ok: false,
          error: { kind: "invalid-input", message: "Authoring failed." },
        });
      const body = unwrap(inspectM9b1AuthoringRequest(request));
      const grammar =
        body !== null &&
        !Array.isArray(body) &&
        typeof body === "object" &&
        "grammar" in body &&
        body["grammar"] !== null &&
        !Array.isArray(body["grammar"]) &&
        typeof body["grammar"] === "object" &&
        "id" in body["grammar"]
          ? body["grammar"]["id"]
          : undefined;
      const output =
        options.invalidOutput === true
          ? null
          : grammar === "lachesis-m9b1-single-search-query-grammar"
            ? { query: options.query ?? "Project Alder launch year" }
            : { source: options.source ?? M9A_MODEL_VISIBLE_GRAMMAR.template };
      const serialized = unwrap(canonicalizeJson(output));
      return Promise.resolve({
        ok: true,
        value: {
          output,
          usage: {
            inputTokens: request.reservation.inputTokens,
            outputTokens:
              new TextEncoder().encode(serialized).byteLength +
              (options.overflowUsage === true ? 1 : 0),
            wallClockMs: 1,
            costUsdMicros: 0,
          },
        },
      });
    },
  };
}

type RuntimeOptions = Readonly<{
  requests?: Array<M9b0BoundModelRequest> | undefined;
  calls?: (() => void) | undefined;
  fail?: boolean | undefined;
}>;

function runtimeModel(options: RuntimeOptions = {}): M9b0OfflineModel {
  return {
    identity: { id: "offline-model", version: "1" },
    complete: (request) => {
      options.calls?.();
      options.requests?.push(request);
      if (options.fail === true)
        return Promise.resolve({
          ok: false,
          error: { kind: "invalid-input", message: "Runtime failed." },
        });
      const output =
        request.phase === "decompose"
          ? ["Project Alder launch year"]
          : { claim: "Project Alder launched in 2020.", citations: [] };
      const serialized = unwrap(canonicalizeJson(output));
      return Promise.resolve({
        ok: true,
        value: {
          output,
          usage: {
            inputTokens: request.reservation.inputTokens,
            outputTokens: new TextEncoder().encode(serialized).byteLength,
            wallClockMs: 1,
            costUsdMicros: 0,
          },
        },
      });
    },
  };
}

function evaluator(calls?: () => void, fail = false): M9b1ExternalEvaluator {
  return {
    identity: { id: "offline-evaluator", version: "1" },
    evaluate: () => {
      calls?.();
      if (fail)
        return Promise.resolve({
          ok: false,
          error: { kind: "invalid-input", message: "Evaluator failed." },
        });
      return Promise.resolve({
        ok: true,
        value: { disposition: "external-score-not-interpreted" },
      });
    },
  };
}

function comparisonInput(
  input: Readonly<{
    corpus: M9aCorpus;
    persistence: M9b1AtomicPersistence;
    discoveredAuthor?: () => M9b1AuthoringModel;
    staticAuthor?: () => M9b1AuthoringModel;
    discoveredRuntime?: () => M9b0OfflineModel;
    staticRuntime?: () => M9b0OfflineModel;
    discoveredEvaluator?: () => M9b1ExternalEvaluator;
    staticEvaluator?: () => M9b1ExternalEvaluator;
    order?: M9b1ExecutionOrder;
  }>,
) {
  return {
    corpus: input.corpus,
    task: "When did Project Alder launch?",
    model: { id: "offline-model", version: "1" },
    authoringSessionFactories: {
      discoveredProgram: input.discoveredAuthor ?? (() => authorModel()),
      staticQuery: input.staticAuthor ?? (() => authorModel()),
    },
    executionSessionFactories: {
      discoveredProgram: input.discoveredRuntime ?? (() => runtimeModel()),
      staticQuery: input.staticRuntime ?? (() => runtimeModel()),
    },
    evaluator: { id: "offline-evaluator", version: "1" },
    evaluatorSessionFactories: {
      discoveredProgram: input.discoveredEvaluator ?? (() => evaluator()),
      staticQuery: input.staticEvaluator ?? (() => evaluator()),
    },
    executionOrder: input.order ?? ("discovered-first" as const),
    store: createM9b1ArmStore(input.persistence),
  };
}

async function resignRecord(record: M9b1ArmRecord): Promise<M9b1ArmRecord> {
  const body = {
    protocol: record.protocol,
    comparisonDigest: record.comparisonDigest,
    arm: record.arm,
    corpusSnapshotDigest: record.corpusSnapshotDigest,
    taskDigest: record.taskDigest,
    model: record.model,
    matchedEnvelope: record.matchedEnvelope,
    authoringRequest: record.authoringRequest,
    authoringResponse: record.authoringResponse,
    compilation: record.compilation,
    executionRequests: record.executionRequests,
    outcome: record.outcome,
  };
  return { ...body, recordDigest: unwrap(await digestValue(body)) };
}

describe("M9b.1 offline program discovery", () => {
  it("does not widen the generator package facade", () => {
    expect("runM9b1OfflineProgramDiscovery" in generatorFacade).toBe(false);
    expect("M9B1_OFFLINE_DISCOVERY_PROTOCOL" in generatorFacade).toBe(false);
  });

  it("authors, compiles, executes, evaluates, and persists both matched arms", async () => {
    const persistence = memoryPersistence();
    const requests: Array<M9b1BoundAuthoringRequest> = [];
    const compared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus: await corpusFixture(),
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ requests }),
          staticAuthor: () => authorModel({ requests }),
        }),
      ),
    );
    expect(compared.protocol).toBe(M9B1_OFFLINE_DISCOVERY_PROTOCOL);
    expect(compared.matchedModelEnvelope).toBe(M9B1_MATCHED_MODEL_ENVELOPE);
    expect(compared.discovered.record.outcome.status).toBe("success");
    expect(compared.staticControl.record.outcome.status).toBe("success");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.reservation.maxInputTokens).toBe(
      requests[1]?.reservation.maxInputTokens,
    );
    expect(requests[0]?.reservation.maxOutputTokens).toBe(
      requests[1]?.reservation.maxOutputTokens,
    );
    expect(requests[0]?.reservation.maxWallClockMs).toBe(
      requests[1]?.reservation.maxWallClockMs,
    );
    expect(persistence.writes()).toBe(2);
  });

  it("exposes only task, frozen grammar, capabilities, and limits to authors", async () => {
    const persistence = memoryPersistence();
    const requests: Array<M9b1BoundAuthoringRequest> = [];
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus: await corpusFixture(),
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ requests }),
          staticAuthor: () => authorModel({ requests }),
        }),
      ),
    );
    for (const request of requests) {
      const serialized = request.serializedRequest;
      expect(serialized).toContain("When did Project Alder launch?");
      expect(serialized).not.toContain("SECRET_CORPUS_TEXT");
      expect(serialized).not.toContain("hidden-launch-record");
      expect(serialized).not.toContain("m9b1-secret-corpus-id");
      expect(serialized).not.toContain("offline-model");
      expect(serialized).not.toContain("offline-evaluator");
      expect(serialized).not.toContain("discovered-program");
      expect(serialized).not.toContain("static-one-shot");
      const body = unwrap(inspectM9b1AuthoringRequest(request));
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new Error("Expected authoring request object.");
      expect(Object.keys(body).toSorted()).toEqual([
        "capabilities",
        "grammar",
        "protocol",
        "resourceLimits",
        "task",
      ]);
    }
    expect(requests[0]?.serializedRequest).not.toContain(
      "const questions = await",
    );
  });

  it("uses exactly one bounded planner-authored query in the static source", async () => {
    const persistence = memoryPersistence();
    const compared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus: await corpusFixture(),
          persistence: persistence.persistence,
          staticAuthor: () => authorModel({ query: "Alder 2020" }),
        }),
      ),
    );
    const response = compared.staticControl.record.authoringResponse;
    expect(response).toMatchObject({ kind: "query", query: "Alder 2020" });
    if (response?.kind !== "query") throw new Error("Expected query response.");
    expect(response.query).toBe("Alder 2020");
    expect(
      compared.staticControl.record.outcome.status === "success"
        ? compared.staticControl.record.outcome.replayArtifact.task
        : undefined,
    ).toBe("Alder 2020");
    expect(response.derivedSource.match(/search-corpus/g)).toHaveLength(1);
  });

  it("records malformed, forbidden, and oversized programs before retrieval", async () => {
    const cases = [
      "export default function nope() {}",
      `export default async function main(input, ops) {
  const stolen = await ops.invoke("forbidden-network@1.0.0", input.task);
  return stolen;
}`,
      `export default async function main(input, ops) {${" ".repeat(33_000)}return input.task;}`,
    ];
    for (const source of cases) {
      const persistence = memoryPersistence();
      let runtimeCalls = 0;
      const compared = unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus: await corpusFixture(),
            persistence: persistence.persistence,
            discoveredAuthor: () => authorModel({ source }),
            discoveredRuntime: () => {
              runtimeCalls += 1;
              return runtimeModel();
            },
          }),
        ),
      );
      expect(compared.discovered.record.outcome.status).toBe(
        "compile-rejected-first-attempt",
      );
      expect(compared.discovered.record.compilation?.status).toBe(
        "rejected-first-attempt",
      );
      expect(runtimeCalls).toBe(0);
      const resumed = unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus: await corpusFixture(),
            persistence: persistence.persistence,
          }),
        ),
      );
      expect(resumed.discovered.resumed).toBe(true);
    }
  });

  it("never executes generated source in an ordinary JavaScript realm", async () => {
    const marker = "__m9b1_ordinary_realm_marker__";
    expect(Reflect.has(globalThis, marker)).toBe(false);
    const persistence = memoryPersistence();
    const source = `globalThis.${marker} = true; export default async function main(input, ops) { return input.task; }`;
    const compared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus: await corpusFixture(),
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ source }),
        }),
      ),
    );
    expect(compared.discovered.record.outcome.status).toBe(
      "compile-rejected-first-attempt",
    );
    expect(Reflect.has(globalThis, marker)).toBe(false);
  });

  it("isolates sessions so counterbalanced order cannot leak call state", async () => {
    for (const order of [
      "discovered-first",
      "static-first",
    ] satisfies ReadonlyArray<M9b1ExecutionOrder>) {
      const persistence = memoryPersistence();
      const perSessionCalls: Array<number> = [];
      const isolatedAuthor = () => {
        let calls = 0;
        return authorModel({
          calls: () => {
            calls += 1;
            perSessionCalls.push(calls);
          },
        });
      };
      const compared = unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus: await corpusFixture(),
            persistence: persistence.persistence,
            discoveredAuthor: () => isolatedAuthor(),
            staticAuthor: () => isolatedAuthor(),
            order,
          }),
        ),
      );
      expect(compared.discovered.record.outcome.status).toBe("success");
      expect(compared.staticControl.record.outcome.status).toBe("success");
      expect(perSessionCalls).toEqual([1, 1]);
    }
  });

  it("retains authoring rejection as a first-attempt terminal result", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    const compared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ invalidOutput: true }),
        }),
      ),
    );
    expect(compared.discovered.record.outcome).toMatchObject({
      status: "authoring-rejected-first-attempt",
      failure: { kind: "authoring" },
    });
    let effects = 0;
    const resumed = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ calls: () => (effects += 1) }),
          staticAuthor: () => authorModel({ calls: () => (effects += 1) }),
        }),
      ),
    );
    expect(resumed.discovered.resumed).toBe(true);
    expect(resumed.staticControl.resumed).toBe(true);
    expect(effects).toBe(0);
  });

  it("retains execution and evaluator failures with zero-effect resume", async () => {
    for (const stage of ["execution", "evaluation"] as const) {
      const persistence = memoryPersistence();
      const corpus = await corpusFixture();
      const compared = unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus,
            persistence: persistence.persistence,
            discoveredRuntime: () =>
              runtimeModel({ fail: stage === "execution" }),
            discoveredEvaluator: () =>
              evaluator(undefined, stage === "evaluation"),
          }),
        ),
      );
      expect(compared.discovered.record.outcome.status).toBe(
        stage === "execution" ? "execution-failure" : "evaluation-failure",
      );
      let effects = 0;
      const resumed = unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus,
            persistence: persistence.persistence,
            discoveredRuntime: () =>
              runtimeModel({ calls: () => (effects += 1) }),
            staticRuntime: () => runtimeModel({ calls: () => (effects += 1) }),
            discoveredEvaluator: () => evaluator(() => (effects += 1)),
            staticEvaluator: () => evaluator(() => (effects += 1)),
          }),
        ),
      );
      expect(resumed.discovered.resumed).toBe(true);
      expect(effects).toBe(0);
    }
  });

  it("fails closed when factories return shared or cross-identity sessions", async () => {
    const corpus = await corpusFixture();
    const sharedAuthor = authorModel();
    const authorPersistence = memoryPersistence();
    const authorCompared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: authorPersistence.persistence,
          discoveredAuthor: () => sharedAuthor,
          staticAuthor: () => sharedAuthor,
        }),
      ),
    );
    expect(authorCompared.staticControl.record.outcome).toMatchObject({
      status: "authoring-rejected-first-attempt",
      failure: { kind: "authoring" },
    });

    const sharedRuntime = runtimeModel();
    const runtimePersistence = memoryPersistence();
    const runtimeCompared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: runtimePersistence.persistence,
          discoveredRuntime: () => sharedRuntime,
          staticRuntime: () => sharedRuntime,
        }),
      ),
    );
    expect(runtimeCompared.staticControl.record.outcome).toMatchObject({
      status: "execution-failure",
      failure: { kind: "execution" },
    });

    const sharedEvaluator = evaluator();
    const evaluatorPersistence = memoryPersistence();
    const evaluatorCompared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: evaluatorPersistence.persistence,
          discoveredEvaluator: () => sharedEvaluator,
          staticEvaluator: () => sharedEvaluator,
        }),
      ),
    );
    expect(evaluatorCompared.staticControl.record.outcome).toMatchObject({
      status: "evaluation-failure",
      failure: { kind: "evaluation" },
    });

    const identityPersistence = memoryPersistence();
    const wrongIdentity = authorModel();
    const changedIdentity: M9b1AuthoringModel = {
      ...wrongIdentity,
      identity: { id: "other-model", version: "1" },
    };
    const identityCompared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: identityPersistence.persistence,
          discoveredAuthor: () => changedIdentity,
        }),
      ),
    );
    expect(identityCompared.discovered.record.outcome.status).toBe(
      "authoring-rejected-first-attempt",
    );
  });

  it("rejects aliased factories before creating a session", async () => {
    const persistence = memoryPersistence();
    const aliased = () => authorModel();
    const candidate = comparisonInput({
      corpus: await corpusFixture(),
      persistence: persistence.persistence,
    });
    const compared = await runM9b1OfflineProgramDiscovery({
      ...candidate,
      authoringSessionFactories: {
        discoveredProgram: aliased,
        staticQuery: aliased,
      },
    });
    expect(compared).toMatchObject({ ok: false, error: { kind: "preflight" } });
    expect(persistence.writes()).toBe(0);
  });

  it("makes terminal record saves idempotent and refuses replacement", async () => {
    const persistence = memoryPersistence();
    const input = comparisonInput({
      corpus: await corpusFixture(),
      persistence: persistence.persistence,
    });
    const compared = unwrap(await runM9b1OfflineProgramDiscovery(input));
    const savedAgain = await input.store.save(compared.discovered.record);
    expect(savedAgain.ok).toBe(true);
    const altered = await resignRecord({
      ...compared.discovered.record,
      taskDigest: "0".repeat(64),
    });
    const replaced = await input.store.save(altered);
    expect(replaced).toMatchObject({ ok: false });
  });

  it("rejects a re-digested retained failure payload digest", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ fail: true }),
        }),
      ),
    );
    await persistence.transform((records) =>
      Promise.all(
        records.map(async (record) => {
          if (record.outcome.status !== "authoring-rejected-first-attempt")
            return record;
          return resignRecord({
            ...record,
            outcome: {
              ...record.outcome,
              failure: {
                ...record.outcome.failure,
                payloadDigest: "0".repeat(64),
              },
            },
          });
        }),
      ),
    );
    const resumed = await runM9b1OfflineProgramDiscovery(
      comparisonInput({ corpus, persistence: persistence.persistence }),
    );
    expect(resumed).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects outer, compile-diagnostic, and terminal-stage record corruption", async () => {
    for (const mutation of ["outer", "compile", "stage"] as const) {
      const persistence = memoryPersistence();
      const corpus = await corpusFixture();
      unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({
            corpus,
            persistence: persistence.persistence,
            discoveredAuthor: () =>
              authorModel(
                mutation === "compile"
                  ? { source: "export default function invalid() {}" }
                  : {},
              ),
          }),
        ),
      );
      await persistence.transform((records) =>
        Promise.all(
          records.map(async (record) => {
            if (record.arm !== "discovered-program") return record;
            if (mutation === "outer")
              return { ...record, recordDigest: "0".repeat(64) };
            if (
              mutation === "compile" &&
              record.compilation?.status === "rejected-first-attempt"
            )
              return resignRecord({
                ...record,
                compilation: {
                  ...record.compilation,
                  diagnostics: {
                    ...record.compilation.diagnostics,
                    digest: "0".repeat(64),
                  },
                },
              });
            return resignRecord({ ...record, authoringResponse: null });
          }),
        ),
      );
      const resumed = await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      );
      expect(resumed).toMatchObject({ ok: false, error: { kind: "storage" } });
    }
  });

  it("rejects a response cross-bound from the other arm", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      ),
    );
    await persistence.transform((records) => {
      const staticRecord = records.find(
        (record) => record.arm === "static-one-shot",
      );
      if (staticRecord?.authoringResponse?.kind !== "query")
        throw new Error("Expected static query response.");
      return Promise.all(
        records.map((record) =>
          record.arm === "discovered-program"
            ? resignRecord({
                ...record,
                authoringResponse: staticRecord.authoringResponse,
              })
            : Promise.resolve(record),
        ),
      );
    });
    const resumed = await runM9b1OfflineProgramDiscovery(
      comparisonInput({ corpus, persistence: persistence.persistence }),
    );
    expect(resumed).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects an invalid persisted store envelope", async () => {
    const content = unwrap(
      canonicalizeJson({ protocol: "forged", records: [] }),
    );
    const persistence: M9b1AtomicPersistence = {
      read: () =>
        Promise.resolve({
          ok: true,
          value: { revision: "1", content },
        }),
      writeAtomic: () =>
        Promise.resolve({ ok: true, value: { revision: "2" } }),
    };
    const loaded = await createM9b1ArmStore(persistence).load(
      "0".repeat(64),
      "discovered-program",
    );
    expect(loaded.ok).toBe(false);

    const malformedStore = createM9b1ArmStore({
      read: () =>
        Promise.resolve({
          ok: true,
          value: { revision: "1", content: "{" },
        }),
      writeAtomic: persistence.writeAtomic,
    });
    expect(
      (await malformedStore.load("0".repeat(64), "discovered-program")).ok,
    ).toBe(false);

    const failedRead = createM9b1ArmStore({
      read: () =>
        Promise.resolve({
          ok: false,
          error: diagnostic("BUDGET_EXCEEDED", "Read failed."),
        }),
      writeAtomic: persistence.writeAtomic,
    });
    expect(
      (await failedRead.load("0".repeat(64), "discovered-program")).ok,
    ).toBe(false);
  });

  it("rejects malformed canonical request and response receipts", async () => {
    for (const mutation of ["request", "response", "shape"] as const) {
      const persistence = memoryPersistence();
      const corpus = await corpusFixture();
      unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({ corpus, persistence: persistence.persistence }),
        ),
      );
      await persistence.transform((records) =>
        Promise.all(
          records.map((record) => {
            if (record.arm !== "discovered-program")
              return Promise.resolve(record);
            if (mutation === "request")
              return resignRecord({
                ...record,
                authoringRequest: {
                  ...record.authoringRequest,
                  requestDigest: "0".repeat(64),
                },
              });
            if (record.authoringResponse?.kind !== "program")
              throw new Error("Expected program response.");
            return resignRecord({
              ...record,
              authoringResponse: {
                ...record.authoringResponse,
                serializedOutput: mutation === "response" ? "{" : "null",
              },
            });
          }),
        ),
      );
      const resumed = await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      );
      expect(resumed).toMatchObject({ ok: false, error: { kind: "storage" } });
    }
  });

  it("rejects authoring usage that does not reconcile to canonical output", async () => {
    const persistence = memoryPersistence();
    const compared = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus: await corpusFixture(),
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ overflowUsage: true }),
        }),
      ),
    );
    expect(compared.discovered.record.outcome.status).toBe(
      "authoring-rejected-first-attempt",
    );
  });

  it("resumes both terminal records with zero model, retrieval, or evaluator effects", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      ),
    );
    let effects = 0;
    const resumed = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: persistence.persistence,
          discoveredAuthor: () => authorModel({ calls: () => (effects += 1) }),
          staticAuthor: () => authorModel({ calls: () => (effects += 1) }),
          discoveredRuntime: () =>
            runtimeModel({ calls: () => (effects += 1) }),
          staticRuntime: () => runtimeModel({ calls: () => (effects += 1) }),
          discoveredEvaluator: () => evaluator(() => (effects += 1)),
          staticEvaluator: () => evaluator(() => (effects += 1)),
        }),
      ),
    );
    expect(resumed.discovered.resumed).toBe(true);
    expect(resumed.staticControl.resumed).toBe(true);
    expect(effects).toBe(0);
    expect(persistence.writes()).toBe(2);
  });

  it("preserves the first atomic arm when the second save fails", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    persistence.failWrite(2);
    const first = await runM9b1OfflineProgramDiscovery(
      comparisonInput({ corpus, persistence: persistence.persistence }),
    );
    expect(first).toMatchObject({ ok: false, error: { kind: "storage" } });
    persistence.failWrite(undefined);
    let authorCalls = 0;
    const resumed = unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({
          corpus,
          persistence: persistence.persistence,
          discoveredAuthor: () =>
            authorModel({ calls: () => (authorCalls += 1) }),
          staticAuthor: () => authorModel({ calls: () => (authorCalls += 1) }),
        }),
      ),
    );
    expect(resumed.discovered.resumed).toBe(true);
    expect(resumed.staticControl.resumed).toBe(false);
    expect(authorCalls).toBe(1);
  });

  it("rejects a self-consistently re-digested hidden authoring request", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      ),
    );
    await persistence.transform((records) =>
      Promise.all(
        records.map(async (record, index) => {
          if (index !== 0) return record;
          const body = unwrap(
            parseJson(record.authoringRequest.serializedRequest),
          );
          if (body === null || Array.isArray(body) || typeof body !== "object")
            throw new Error("Expected request body.");
          const altered = { ...body, hiddenAnswer: "2020" };
          const serializedRequest = unwrap(canonicalizeJson(altered));
          const changed = {
            ...record,
            authoringRequest: {
              ...record.authoringRequest,
              serializedRequest,
              requestDigest: unwrap(await digestValue(altered)),
              reservation: {
                ...record.authoringRequest.reservation,
                inputTokens: new TextEncoder().encode(serializedRequest)
                  .byteLength,
              },
            },
          };
          return resignRecord(changed);
        }),
      ),
    );
    const resumed = await runM9b1OfflineProgramDiscovery(
      comparisonInput({ corpus, persistence: persistence.persistence }),
    );
    expect(resumed).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects a re-digested record cross-bound to a different public task", async () => {
    const persistence = memoryPersistence();
    const corpus = await corpusFixture();
    unwrap(
      await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      ),
    );
    await persistence.transform((records) =>
      Promise.all(
        records.map((record) =>
          record.arm === "discovered-program"
            ? resignRecord({ ...record, taskDigest: "0".repeat(64) })
            : Promise.resolve(record),
        ),
      ),
    );
    const resumed = await runM9b1OfflineProgramDiscovery(
      comparisonInput({ corpus, persistence: persistence.persistence }),
    );
    expect(resumed).toMatchObject({ ok: false, error: { kind: "resume" } });
  });

  it("rejects self-consistent source/query, compilation, run, and replay tampering", async () => {
    const mutations = [
      "source",
      "query",
      "compilation",
      "run",
      "replay",
      "evaluation",
    ] as const;
    for (const mutation of mutations) {
      const persistence = memoryPersistence();
      const corpus = await corpusFixture();
      unwrap(
        await runM9b1OfflineProgramDiscovery(
          comparisonInput({ corpus, persistence: persistence.persistence }),
        ),
      );
      await persistence.transform((records) =>
        Promise.all(
          records.map(async (record) => {
            const targetsStatic = mutation === "query";
            if (
              (targetsStatic && record.arm !== "static-one-shot") ||
              (!targetsStatic && record.arm !== "discovered-program")
            )
              return record;
            if (
              mutation === "source" &&
              record.authoringResponse?.kind === "program"
            ) {
              const source = `${record.authoringResponse.source}\n `;
              const output = { source };
              const serializedOutput = unwrap(canonicalizeJson(output));
              const changed = {
                ...record,
                authoringResponse: {
                  ...record.authoringResponse,
                  source,
                  sourceDigest: unwrap(await digestValue(source)),
                  serializedOutput,
                  outputDigest: unwrap(await digestValue(output)),
                  usage: {
                    ...record.authoringResponse.usage,
                    outputTokens: new TextEncoder().encode(serializedOutput)
                      .byteLength,
                  },
                },
              };
              return resignRecord(changed);
            }
            if (
              mutation === "query" &&
              record.authoringResponse?.kind === "query"
            ) {
              const query = `${record.authoringResponse.query} altered`;
              const output = { query };
              const serializedOutput = unwrap(canonicalizeJson(output));
              return resignRecord({
                ...record,
                authoringResponse: {
                  ...record.authoringResponse,
                  query,
                  queryDigest: unwrap(await digestValue(query)),
                  serializedOutput,
                  outputDigest: unwrap(await digestValue(output)),
                  usage: {
                    ...record.authoringResponse.usage,
                    outputTokens: new TextEncoder().encode(serializedOutput)
                      .byteLength,
                  },
                },
              });
            }
            if (
              mutation === "compilation" &&
              record.compilation?.status === "accepted"
            )
              return resignRecord({
                ...record,
                compilation: {
                  ...record.compilation,
                  sourceHash: "0".repeat(64),
                },
              });
            if (
              mutation === "run" &&
              (record.outcome.status === "success" ||
                record.outcome.status === "evaluation-failure")
            )
              return resignRecord({
                ...record,
                outcome: { ...record.outcome, runDigest: "0".repeat(64) },
              });
            if (
              mutation === "replay" &&
              (record.outcome.status === "success" ||
                record.outcome.status === "evaluation-failure")
            ) {
              const replay = record.outcome.replayArtifact;
              const replayBody = {
                protocol: replay.protocol,
                retrievalProtocol: replay.retrievalProtocol,
                source: replay.source,
                sourceHash: replay.sourceHash,
                semanticContractHash: replay.semanticContractHash,
                task: replay.task,
                corpus: replay.corpus,
                model: replay.model,
                entries: replay.entries,
                expectedTranscriptDigest: replay.expectedTranscriptDigest,
                expectedAnswerDigest: replay.expectedAnswerDigest,
                expectedRunDigest: "0".repeat(64),
              };
              const replayArtifact = m9aPrivateReplayArtifactSchema.parse({
                ...replayBody,
                artifactDigest: unwrap(await digestValue(replayBody)),
              });
              return resignRecord({
                ...record,
                outcome: {
                  ...record.outcome,
                  runDigest: "0".repeat(64),
                  replayArtifact,
                },
              });
            }
            if (
              mutation === "evaluation" &&
              record.outcome.status === "success"
            )
              return resignRecord({
                ...record,
                outcome: {
                  ...record.outcome,
                  evaluation: {
                    ...record.outcome.evaluation,
                    outputDigest: "0".repeat(64),
                  },
                },
              });
            return record;
          }),
        ),
      );
      const resumed = await runM9b1OfflineProgramDiscovery(
        comparisonInput({ corpus, persistence: persistence.persistence }),
      );
      expect(resumed.ok).toBe(false);
    }
  });
});
