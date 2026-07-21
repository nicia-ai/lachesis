import { performance } from "node:perf_hooks";

import {
  createMemoryRecordingStore,
  replay,
  run,
} from "@nicia-ai/lachesis-runtime";

import { loadTestFixture } from "../examples/m5-alpha/common.mjs";

const fixture = await loadTestFixture();
const recordingStore = createMemoryRecordingStore();
const signal = new AbortController().signal;

const recordCount = 128;
const recordStarted = performance.now();
const recorded = await Promise.all(
  Array.from({ length: recordCount }, (_, index) =>
    run({
      executablePlan: fixture.executablePlan,
      publicTaskContract: {
        ...fixture.task,
        version: `load-${index.toString().padStart(3, "0")}`,
      },
      inputValues: new Map(),
      trustedPolicy: fixture.policy,
      evidenceStore: fixture.evidenceStore,
      snapshot: {
        validAt: "2026-03-01T00:00:00.000Z",
        recordedAt: null,
      },
      oracle: fixture.oracle,
      recordingStore,
      signal,
    }),
  ),
);
const recordElapsedMs = performance.now() - recordStarted;
if (recorded.some((result) => !result.ok))
  throw new Error("Offline record-volume load failed.");
if (recordingStore.artifacts().length !== recordCount)
  throw new Error("Offline record-volume identities collided.");

const replayStarted = performance.now();
const replayed = await Promise.all(
  recordingStore.artifacts().map((artifact) =>
    replay({
      executablePlan: fixture.executablePlan,
      publicTaskContract: artifact.publicTaskContract,
      trustedPolicy: fixture.policy,
      artifactDigest: artifact.artifactDigest,
      recordingStore,
      signal,
    }),
  ),
);
const replayElapsedMs = performance.now() - replayStarted;
if (replayed.some((result) => !result.ok))
  throw new Error("Offline replay-throughput load failed.");

const concurrency = 32;
const duplicateStore = createMemoryRecordingStore();
const concurrencyStarted = performance.now();
const duplicateResults = await Promise.all(
  Array.from({ length: concurrency }, () =>
    run({
      executablePlan: fixture.executablePlan,
      publicTaskContract: fixture.task,
      inputValues: new Map(),
      trustedPolicy: fixture.policy,
      evidenceStore: fixture.evidenceStore,
      snapshot: {
        validAt: "2026-03-01T00:00:00.000Z",
        recordedAt: null,
      },
      oracle: fixture.oracle,
      recordingStore: duplicateStore,
      signal,
    }),
  ),
);
const concurrencyElapsedMs = performance.now() - concurrencyStarted;
if (duplicateResults.some((result) => !result.ok))
  throw new Error("Offline concurrent duplicate execution failed.");
if (duplicateStore.artifacts().length !== 1)
  throw new Error("Concurrent duplicate artifacts did not converge.");

process.stdout.write(
  `${JSON.stringify(
    {
      formatVersion: "1",
      kind: "m5c-descriptive-offline-load-baseline",
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      recordVolume: {
        records: recordCount,
        elapsedMs: Math.round(recordElapsedMs * 1000) / 1000,
      },
      replayThroughput: {
        records: replayed.length,
        elapsedMs: Math.round(replayElapsedMs * 1000) / 1000,
      },
      concurrency: {
        requested: concurrency,
        completed: duplicateResults.length,
        contentAddressedArtifacts: duplicateStore.artifacts().length,
        elapsedMs: Math.round(concurrencyElapsedMs * 1000) / 1000,
      },
      claimBoundary:
        "descriptive local baseline only; not a production-scale performance claim",
    },
    null,
    2,
  )}\n`,
);
