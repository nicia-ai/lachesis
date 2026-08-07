import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = "docs/m9b13h-staged-supplement-readiness";
const tests = JSON.parse(readFileSync(`${base}/hostile-tests.json`, "utf8"));
const manifest = JSON.parse(
  readFileSync(`${base}/external-archive-manifest.json`, "utf8"),
);
const expectedPaths = manifest.entries.map(({ archivePath }) => archivePath);
const expectedDigests = manifest.entries.map(({ rawSha256 }) => rawSha256);
const expectedArchiveDigest =
  "978c996fd5c55d559fa1c36a2f0eba2f7ef43e7fe27603c2dc7c74dc63f0201d";

const baseline = {
  mtime: 0,
  uid: 0,
  gid: 0,
  uname: "",
  gname: "",
  regularMode: "0644",
  directoryMode: "0755",
  paths: expectedPaths,
  digests: expectedDigests,
  paxRecords: 0,
  gnuExtensionRecords: 0,
  symlinks: 0,
  hardLinks: 0,
  specialEntries: 0,
  terminalZeroBlocks: 2,
  trailingBytes: 0,
  manifestArchiveDigest: expectedArchiveDigest,
  rebuildDigests: [
    expectedArchiveDigest,
    expectedArchiveDigest,
    expectedArchiveDigest,
  ],
  unexpectedLicenseArtifact: false,
  licenseOnlyAtSubmission: false,
  providerRename: false,
  providerFlattening: false,
  draftMetadataPrivate: true,
  viewOnlyLinks: 0,
  embargoEnd: "2030-08-01T00:00:00Z",
  draftCount: 1,
  stageAAttemptSubmission: false,
  submissionAuthorityPresent: true,
  approvalAuthorityPresent: true,
  cancellationAuthorityPresent: false,
  durableMonitoring: true,
  safetyMarginSeconds: 43200,
  terminalResponseAmbiguous: false,
  submissionAttemptCount: 1,
  registration63sh5Unchanged: true,
  scientificFinancialInvariantSha256:
    "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282",
};

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => structuredClone(value);
const normalized = (path) =>
  !path.startsWith("/") &&
  !path.includes("//") &&
  !path.split("/").includes("..") &&
  (path.startsWith("supplement/") ||
    path.startsWith("independent-review-receipt/"));

function classify(state) {
  if (state.terminalResponseAmbiguous) return "ambiguous-monitor-no-retry";
  const accepted =
    state.mtime === 0 &&
    state.uid === 0 &&
    state.gid === 0 &&
    state.uname === "" &&
    state.gname === "" &&
    state.regularMode === "0644" &&
    state.directoryMode === "0755" &&
    state.paths.length === 57 &&
    new Set(state.paths).size === 57 &&
    state.paths.every(normalized) &&
    same(state.paths, expectedPaths) &&
    same(state.digests, expectedDigests) &&
    state.paxRecords === 0 &&
    state.gnuExtensionRecords === 0 &&
    state.symlinks === 0 &&
    state.hardLinks === 0 &&
    state.specialEntries === 0 &&
    state.terminalZeroBlocks === 2 &&
    state.trailingBytes === 0 &&
    state.manifestArchiveDigest === expectedArchiveDigest &&
    state.rebuildDigests.length === 3 &&
    state.rebuildDigests.every((digest) => digest === expectedArchiveDigest) &&
    !state.unexpectedLicenseArtifact &&
    !state.licenseOnlyAtSubmission &&
    !state.providerRename &&
    !state.providerFlattening &&
    state.draftMetadataPrivate &&
    state.viewOnlyLinks === 0 &&
    Date.parse(state.embargoEnd) >= Date.parse("2030-08-01T00:00:00Z") &&
    state.draftCount === 1 &&
    !state.stageAAttemptSubmission &&
    state.submissionAuthorityPresent &&
    (state.approvalAuthorityPresent || state.cancellationAuthorityPresent) &&
    state.durableMonitoring &&
    state.safetyMarginSeconds >= 43200 &&
    state.submissionAttemptCount === 1 &&
    state.registration63sh5Unchanged &&
    state.scientificFinancialInvariantSha256 ===
      "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282";
  return accepted ? "accept" : "reject";
}

const mutations = {
  "change-one-header-mtime": (state) => (state.mtime = 1),
  "change-one-header-uid-gid-or-name": (state) => (state.uid = 1),
  "change-one-header-mode": (state) => (state.regularMode = "0600"),
  "swap-two-entries": (state) =>
    ([state.paths[0], state.paths[1]] = [state.paths[1], state.paths[0]]),
  "insert-pax-header": (state) => (state.paxRecords = 1),
  "insert-gnu-longname-or-sparse-entry": (state) =>
    (state.gnuExtensionRecords = 1),
  "remove-one-regular-file": (state) => {
    state.paths.pop();
    state.digests.pop();
  },
  "add-one-regular-file": (state) => {
    state.paths.push("supplement/extra");
    state.digests.push("0".repeat(64));
  },
  "repeat-one-path": (state) => (state.paths[1] = state.paths[0]),
  "flip-one-payload-byte": (state) => (state.digests[0] = "0".repeat(64)),
  "insert-parent-or-absolute-path": (state) => (state.paths[0] = "../outside"),
  "change-type-to-symlink": (state) => (state.symlinks = 1),
  "change-type-to-hardlink": (state) => (state.hardLinks = 1),
  "remove-or-change-required-prefix": (state) =>
    (state.paths[0] = "wrong/CHECKSUMS.sha256"),
  "change-manifest-archive-digest": (state) =>
    (state.manifestArchiveDigest = "0".repeat(64)),
  "supply-different-rebuild-digest": (state) =>
    (state.rebuildDigests[2] = "0".repeat(64)),
  "add-remove-or-mutate-terminal-zero-block": (state) =>
    (state.terminalZeroBlocks = 1),
  "draft-enumeration-adds-unbound-license-file": (state) =>
    (state.unexpectedLicenseArtifact = true),
  "license-lifecycle-defers-bytes-until-submit": (state) =>
    (state.licenseOnlyAtSubmission = true),
  "provider-renames-one-staged-object": (state) =>
    (state.providerRename = true),
  "provider-flattens-or-collides-staged-name": (state) =>
    (state.providerFlattening = true),
  "draft-metadata-visible-without-authentication": (state) =>
    (state.draftMetadataPrivate = false),
  "create-view-only-link": (state) => (state.viewOnlyLinks = 1),
  "embargo-before-2030-08-01": (state) =>
    (state.embargoEnd = "2030-07-31T23:59:59Z"),
  "draft-count-two": (state) => (state.draftCount = 2),
  "attempt-submit-during-stage-a": (state) =>
    (state.stageAAttemptSubmission = true),
  "stage-b-submission-authority-absent": (state) =>
    (state.submissionAuthorityPresent = false),
  "approval-and-cancellation-authorities-absent": (state) => {
    state.approvalAuthorityPresent = false;
    state.cancellationAuthorityPresent = false;
  },
  "monitoring-stops-before-terminal-state": (state) =>
    (state.durableMonitoring = false),
  "deadline-inside-required-safety-margin": (state) =>
    (state.safetyMarginSeconds = 43199),
  "approval-or-cancellation-response-ambiguous": (state) =>
    (state.terminalResponseAmbiguous = true),
  "submission-attempt-count-two": (state) => (state.submissionAttemptCount = 2),
  "change-original-registration-state": (state) =>
    (state.registration63sh5Unchanged = false),
  "change-invariant-or-scientific-financial-field": (state) =>
    (state.scientificFinancialInvariantSha256 = "0".repeat(64)),
};

assert.equal(tests.testCount, 34);
assert.equal(tests.tests.length, 34);
assert.equal(classify(clone(baseline)), "accept");
const outcomes = [];
for (const test of tests.tests) {
  assert.ok(Object.hasOwn(mutations, test.mutation), test.mutation);
  const state = clone(baseline);
  mutations[test.mutation](state);
  const actual = classify(state);
  assert.equal(actual, test.expected, test.id);
  outcomes.push(actual);
}

process.stdout.write(
  JSON.stringify(
    {
      result: "pass",
      baseline: "accept",
      testCount: outcomes.length,
      rejected: outcomes.filter((outcome) => outcome === "reject").length,
      ambiguousMonitorNoRetry: outcomes.filter(
        (outcome) => outcome === "ambiguous-monitor-no-retry",
      ).length,
      externalEffects: 0,
    },
    null,
    2,
  ) + "\n",
);
