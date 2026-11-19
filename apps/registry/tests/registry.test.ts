import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/core.js";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "../src/main.js";
import { requestTimestamp, verifyTimestamp } from "../src/timestamp.js";
import {
  cli,
  createRepository,
  createSshKey,
  execFileAsync,
  gitIn,
  startAuthority,
  type TestAuthority,
  UNAVAILABLE_PATH,
} from "./fixtures.js";

const STUDY = "m9";
const OSF_ROOT =
  "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4";
const TEST_TIMEOUT_MS = 60_000;

let root: string;
let alpha: TestAuthority;
let beta: TestAuthority;
let sponsorKey: string;
let intruderKey: string;
let repositoryCount = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "lachesis-registry-test-"));
  alpha = await startAuthority(root, "alpha");
  beta = await startAuthority(root, "beta");
  sponsorKey = await createSshKey(root, "sponsor");
  intruderKey = await createSshKey(root, "intruder");
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await alpha.close();
  await beta.close();
  await rm(root, { recursive: true, force: true });
});

async function newRepository(): Promise<
  Readonly<{ path: string; witness: string }>
> {
  repositoryCount += 1;
  return createRepository(root, `repo-${repositoryCount}`, [alpha, beta]);
}

function expectOk(
  run: Readonly<{ code: number; stdout: string; stderr: string }>,
): void {
  expect(
    run.stderr,
    `stderr was:\n${run.stderr}\nstdout was:\n${run.stdout}`,
  ).toBe("");
  expect(run.code).toBe(EXIT_OK);
}

async function sealGenesis(path: string): Promise<void> {
  expectOk(
    await cli(
      path,
      "prepare",
      "genesis",
      "--study",
      STUDY,
      "--principal",
      "sponsor",
      "--public-key",
      `${sponsorKey}.pub`,
      "--tsa",
      `alpha=${alpha.url}`,
      "--tsa",
      `beta=${beta.url}`,
      "--external-root",
      `osf-63sh5=${OSF_ROOT}`,
    ),
  );
  expectOk(await cli(path, "seal", "--study", STUDY, "--key", sponsorKey));
}

async function commitPackage(
  path: string,
  revision: string,
  body: string,
): Promise<string> {
  const directory = `studies/${STUDY}/registrations/${revision}`;
  await mkdir(join(path, directory), { recursive: true });
  await writeFile(join(path, directory, "protocol.md"), body);
  const manifest = await cli(path, "manifest", directory);
  expectOk(manifest);
  await gitIn(path, "add", directory);
  await gitIn(path, "commit", "--quiet", "--message", `package ${revision}`);
  return manifest.stdout.trim();
}

async function sealRegistration(path: string, revision: string): Promise<void> {
  const manifest = await commitPackage(path, revision, `# ${revision}\n`);
  expectOk(
    await cli(
      path,
      "prepare",
      "registration",
      "--study",
      STUDY,
      "--revision",
      revision,
      "--manifest",
      manifest,
      "--authorizes",
      "count-only-pricing-probe",
    ),
  );
  expectOk(await cli(path, "seal", "--study", STUDY, "--key", sponsorKey));
}

async function verifyCodes(
  path: string,
  ...flags: ReadonlyArray<string>
): Promise<ReadonlyArray<string>> {
  const run = await cli(path, "verify", ...flags);
  return [...run.stderr.matchAll(/^([A-Z_]+):/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("git-native registry", () => {
  it(
    "seals genesis, a registration and a result that verify against the witness",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      await sealRegistration(path, "m9b13f2");
      const result = await commitPackage(path, "probe-result", "D = 7\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "result",
          "--study",
          STUDY,
          "--revision",
          "probe-result",
          "--manifest",
          result,
          "--reports-on",
          "1",
        ),
      );
      expectOk(await cli(path, "seal", "--study", STUDY, "--key", sponsorKey));

      const verified = await cli(path, "verify", "--json");
      expectOk(verified);
      const report = verified.stdout;
      const { stdout: fingerprint } = await execFileAsync("ssh-keygen", [
        "-lf",
        `${sponsorKey}.pub`,
      ]);
      expect(report).toContain(fingerprint.split(" ")[1] ?? "missing");
      expect(report).toContain('"witnessesChecked": [\n    "bare"');
      expect(await gitIn(path, "tag", "--list", "registry/*")).toBe(
        ["registry/m9/0000", "registry/m9/0001", "registry/m9/0002"].join("\n"),
      );
      const text = await cli(path, "verify", "--study", STUDY);
      expect(text.stdout).toMatch(
        /0002 result probe-result alpha@\S+ beta@\S+/,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "seals an entry an agent prepared and committed from another checkout",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "agent-rev", "agent work\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "agent-rev",
          "--manifest",
          manifest,
          "--authorizes",
          "probe",
        ),
      );
      await gitIn(path, "add", "registry");
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--message",
        "agent: pending entry",
      );
      expectOk(await cli(path, "seal", "--study", STUDY, "--key", sponsorKey));
      const verified = await cli(path, "verify");
      expectOk(verified);
      expect(verified.stdout).toContain("m9: 2 sealed, 0 pending");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses to seal with a key other than the genesis signer and leaves no files",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "r1", "x\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "r1",
          "--manifest",
          manifest,
          "--authorizes",
          "probe",
        ),
      );
      const sealed = await cli(
        path,
        "seal",
        "--study",
        STUDY,
        "--key",
        intruderKey,
      );
      expect(sealed.code).toBe(EXIT_FAILED);
      expect(sealed.stderr).toContain(
        "SIGNATURE_INVALID: The signing key is not the genesis signer.",
      );
      expect(
        await gitIn(path, "status", "--porcelain", "--untracked-files=all"),
      ).toBe("?? registry/m9/pending/0001.json");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects an entry forged with another key even when its timestamps are genuine",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "forged", "forged\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "forged",
          "--manifest",
          manifest,
          "--authorizes",
          "primary",
        ),
      );
      const entryPath = join(path, "registry", STUDY, "0001.json");
      const pendingDirectory = join(path, "registry", STUDY, "pending");
      await writeFile(
        entryPath,
        await readFile(join(pendingDirectory, "0001.json")),
      );
      await rm(pendingDirectory, { recursive: true });
      await execFileAsync("ssh-keygen", [
        "-q",
        "-Y",
        "sign",
        "-f",
        intruderKey,
        "-n",
        "lachesis-registry",
        entryPath,
      ]);
      const digest = sha256Hex(new Uint8Array(await readFile(entryPath)));
      for (const authority of [alpha, beta]) {
        const token = await requestTimestamp(
          {
            name: authority.name,
            url: authority.url,
            caBundleSha256: "0".repeat(64),
          },
          digest,
        );
        if (!token.ok) throw new Error(token.error.message);
        await writeFile(`${entryPath}.${authority.name}.tsr`, token.value);
      }
      await gitIn(path, "add", "registry");
      await gitIn(path, "commit", "--quiet", "--message", "forged entry");
      expect(await verifyCodes(path, "--offline")).toEqual([
        "SIGNATURE_INVALID",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "detects a sealed entry modified or deleted by a later commit",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      await sealRegistration(path, "r1");
      await rm(join(path, "registry", STUDY, "0001.json"));
      await rm(join(path, "registry", STUDY, "0001.json.sig"));
      await rm(join(path, "registry", STUDY, "0001.json.alpha.tsr"));
      await rm(join(path, "registry", STUDY, "0001.json.beta.tsr"));
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "drop unfavorable registration",
      );
      const codes = await verifyCodes(path, "--offline");
      expect(codes).toContain("HISTORY_REWRITTEN");
      expect(codes.filter((code) => code === "HISTORY_REWRITTEN")).toHaveLength(
        4,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "detects a history rewrite through the witness",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      await sealRegistration(path, "r1");
      await gitIn(path, "reset", "--quiet", "--hard", "registry/m9/0000");
      expect(await verifyCodes(path, "--offline")).toEqual([]);
      const run = await cli(path, "verify");
      expect(run.code).toBe(EXIT_FAILED);
      expect(run.stderr).toContain(
        "WITNESS_DIVERGED: Witness bare (m9) has entries from 0001.json that this checkout lacks.",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "detects a witness that diverged or fell behind",
    async () => {
      const { path, witness } = await newRepository();
      await sealGenesis(path);
      await gitIn(
        path,
        "push",
        "--quiet",
        "--force",
        witness,
        "HEAD~1:refs/heads/main",
      );
      const run = await cli(path, "verify");
      expect(run.stderr).toContain(
        "WITNESS_DIVERGED: Witness bare (m9) is missing entries from 0000.json.",
      );
      const unreachable = join(root, "missing-witness.git");
      const configuration = await readFile(
        join(path, "registry", "witnesses.json"),
        "utf8",
      );
      await writeFile(
        join(path, "registry", "witnesses.json"),
        configuration.replace(witness, unreachable),
      );
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "move witness",
      );
      expect((await cli(path, "verify")).stderr).toContain(
        "WITNESS_DIVERGED: Witness bare is unreachable",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses to register a manifest that no longer matches the committed files",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "r1", "original\n");
      await writeFile(
        join(path, "studies", STUDY, "registrations", "r1", "protocol.md"),
        "edited\n",
      );
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "edit after manifest",
      );
      const prepared = await cli(
        path,
        "prepare",
        "registration",
        "--study",
        STUDY,
        "--revision",
        "r1",
        "--manifest",
        manifest,
        "--authorizes",
        "probe",
      );
      expect(prepared.code).toBe(EXIT_FAILED);
      expect(prepared.stderr).toContain(
        "CONTENT_MISMATCH: studies/m9/registrations/r1/protocol.md does not match the manifest.",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "aborts sealing and removes partial files when a pinned CA bundle rejects a token",
    async () => {
      const { path } = await newRepository();
      await writeFile(
        join(path, "registry", "tsa", "alpha.pem"),
        await readFile(beta.caPath),
      );
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "pin wrong CA",
      );
      expectOk(
        await cli(
          path,
          "prepare",
          "genesis",
          "--study",
          STUDY,
          "--principal",
          "sponsor",
          "--public-key",
          `${sponsorKey}.pub`,
          "--tsa",
          `alpha=${alpha.url}`,
          "--tsa",
          `beta=${beta.url}`,
        ),
      );
      const sealed = await cli(
        path,
        "seal",
        "--study",
        STUDY,
        "--key",
        sponsorKey,
      );
      expect(sealed.stderr).toContain(
        "TIMESTAMP_INVALID: Timestamp does not verify for this digest and CA bundle.",
      );
      expect(
        await gitIn(path, "status", "--porcelain", "--untracked-files=all"),
      ).toBe("?? registry/m9/pending/0000.json");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a token presented for a different digest",
    async () => {
      const digest = sha256Hex(new TextEncoder().encode("entry"));
      const token = await requestTimestamp(
        { name: "alpha", url: alpha.url, caBundleSha256: "0".repeat(64) },
        digest,
      );
      if (!token.ok) throw new Error(token.error.message);
      const bundle = new Uint8Array(await readFile(alpha.caPath));
      expect((await verifyTimestamp(token.value, digest, bundle)).ok).toBe(
        true,
      );
      const other = await verifyTimestamp(
        token.value,
        sha256Hex(new TextEncoder().encode("other")),
        bundle,
      );
      expect(other.ok ? "accepted" : other.error.code).toBe(
        "TIMESTAMP_INVALID",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects non-canonical pending entries, bad result targets and unexpected files",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "r1", "x\n");
      const prepared = await cli(
        path,
        "prepare",
        "result",
        "--study",
        STUDY,
        "--revision",
        "r1",
        "--manifest",
        manifest,
        "--reports-on",
        "0",
      );
      expect(prepared.stderr).toContain(
        "CHAIN_BROKEN: m9/0001.json must report on an earlier registration entry.",
      );

      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "r1",
          "--manifest",
          manifest,
          "--authorizes",
          "probe",
        ),
      );
      const pendingPath = join(path, "registry", STUDY, "pending", "0001.json");
      const canonical = await readFile(pendingPath, "utf8");
      await writeFile(pendingPath, `${canonical.trimEnd()} \n`);
      expect(
        (await cli(path, "seal", "--study", STUDY, "--key", sponsorKey)).stderr,
      ).toContain("NON_CANONICAL");

      await rm(join(path, "registry", STUDY, "pending"), { recursive: true });
      await writeFile(join(path, "registry", STUDY, "notes.txt"), "stray\n");
      await gitIn(path, "add", "registry");
      await gitIn(path, "commit", "--quiet", "--message", "stray file");
      expect(await verifyCodes(path, "--offline")).toEqual(["UNEXPECTED_FILE"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "blocks sealing over staged changes and a second pending entry",
    async () => {
      const { path } = await newRepository();
      expectOk(
        await cli(
          path,
          "prepare",
          "genesis",
          "--study",
          STUDY,
          "--principal",
          "sponsor",
          "--public-key",
          `${sponsorKey}.pub`,
          "--tsa",
          `alpha=${alpha.url}`,
          "--tsa",
          `beta=${beta.url}`,
        ),
      );
      const again = await cli(
        path,
        "prepare",
        "genesis",
        "--study",
        STUDY,
        "--principal",
        "sponsor",
        "--public-key",
        `${sponsorKey}.pub`,
        "--tsa",
        `alpha=${alpha.url}`,
        "--tsa",
        `beta=${beta.url}`,
      );
      expect(again.stderr).toContain("STATE_CONFLICT");
      await writeFile(join(path, "unrelated.txt"), "staged\n");
      await gitIn(path, "add", "unrelated.txt");
      expect(
        (await cli(path, "seal", "--study", STUDY, "--key", sponsorKey)).stderr,
      ).toContain("STATE_CONFLICT: The git index has staged changes");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports unavailable and unreachable timestamp authorities",
    async () => {
      const digest = sha256Hex(new TextEncoder().encode("entry"));
      const unavailable = await requestTimestamp(
        {
          name: "alpha",
          url: `${alpha.url.replace(/\/$/, "")}${UNAVAILABLE_PATH}`,
          caBundleSha256: "0".repeat(64),
        },
        digest,
      );
      expect(unavailable.ok ? "accepted" : unavailable.error.message).toBe(
        "alpha answered HTTP 503 with text/plain.",
      );
      const unreachable = await requestTimestamp(
        {
          name: "gone",
          url: "http://127.0.0.1:1/",
          caBundleSha256: "0".repeat(64),
        },
        digest,
      );
      expect(unreachable.ok ? "accepted" : unreachable.error.message).toMatch(
        /^gone request failed: /,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports committed entries that lack a signature or timestamps",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "r1", "x\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "r1",
          "--manifest",
          manifest,
          "--authorizes",
          "probe",
        ),
      );
      const pendingDirectory = join(path, "registry", STUDY, "pending");
      await writeFile(
        join(path, "registry", STUDY, "0001.json"),
        await readFile(join(pendingDirectory, "0001.json")),
      );
      await rm(pendingDirectory, { recursive: true });
      await gitIn(path, "add", "registry");
      await gitIn(path, "commit", "--quiet", "--message", "unsealed entry");
      expect(await verifyCodes(path, "--offline")).toEqual([
        "SIGNATURE_INVALID",
        "TIMESTAMP_INVALID",
        "TIMESTAMP_INVALID",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses entries before genesis, uncommitted CA bundles, unknown studies and malformed witnesses",
    async () => {
      const { path } = await newRepository();
      const manifest = await commitPackage(path, "early", "x\n");
      const early = await cli(
        path,
        "prepare",
        "registration",
        "--study",
        STUDY,
        "--revision",
        "early",
        "--manifest",
        manifest,
        "--authorizes",
        "probe",
      );
      expect(early.stderr).toContain(
        "CHAIN_BROKEN: Study m9 has no sealed genesis entry.",
      );

      await writeFile(
        join(path, "registry", "tsa", "gamma.pem"),
        await readFile(alpha.caPath),
      );
      const uncommitted = await cli(
        path,
        "prepare",
        "genesis",
        "--study",
        STUDY,
        "--principal",
        "sponsor",
        "--public-key",
        `${sponsorKey}.pub`,
        "--tsa",
        `alpha=${alpha.url}`,
        "--tsa",
        `gamma=${alpha.url}`,
      );
      expect(uncommitted.stderr).toContain(
        "CONTENT_MISMATCH: registry/tsa/gamma.pem must be committed first.",
      );
      await rm(join(path, "registry", "tsa", "gamma.pem"));

      await sealGenesis(path);
      expect((await cli(path, "verify", "--study", "other")).stderr).toContain(
        "USAGE: Study other is not registered.",
      );
      await writeFile(join(path, "registry", "witnesses.json"), "{}\n");
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "break witnesses",
      );
      expect(await verifyCodes(path)).toEqual(["MALFORMED_DOCUMENT"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a pending entry tampered with after preparation",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      const manifest = await commitPackage(path, "r1", "x\n");
      expectOk(
        await cli(
          path,
          "prepare",
          "registration",
          "--study",
          STUDY,
          "--revision",
          "r1",
          "--manifest",
          manifest,
          "--authorizes",
          "probe",
        ),
      );
      const pendingPath = join(path, "registry", STUDY, "pending", "0001.json");
      const original = await readFile(pendingPath, "utf8");
      const digest =
        /"manifestSha256":"([a-f0-9]{64})"/.exec(original)?.[1] ?? "";
      await writeFile(pendingPath, original.replace(digest, "f".repeat(64)));
      expect(
        (await cli(path, "seal", "--study", STUDY, "--key", sponsorKey)).stderr,
      ).toContain(
        "CONTENT_MISMATCH: m9/0001.json: manifest at the source commit does not match.",
      );
      await gitIn(path, "checkout", "--quiet", "-b", "side");
      await writeFile(join(path, "side.txt"), "side\n");
      await gitIn(path, "add", "side.txt");
      await gitIn(path, "commit", "--quiet", "--message", "side");
      const side = await gitIn(path, "rev-parse", "HEAD");
      await gitIn(path, "checkout", "--quiet", "main");
      await writeFile(
        pendingPath,
        original.replace(
          /"sourceCommit":"[a-f0-9]{40}"/,
          `"sourceCommit":"${side}"`,
        ),
      );
      expect(
        (await cli(path, "seal", "--study", STUDY, "--key", sponsorKey)).stderr,
      ).toContain(
        "CONTENT_MISMATCH: m9/0001.json: source commit is not in this history.",
      );
      await rm(pendingPath);
      expect(
        (await cli(path, "seal", "--study", STUDY, "--key", sponsorKey)).stderr,
      ).toContain(
        "STATE_CONFLICT: Expected exactly one entry in registry/m9/pending.",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses to extend a chain whose committed state does not verify",
    async () => {
      const { path } = await newRepository();
      await sealGenesis(path);
      await writeFile(join(path, "registry", STUDY, "0001.json"), "not json\n");
      await gitIn(path, "add", "registry");
      await gitIn(path, "commit", "--quiet", "--message", "garbage entry");
      expect(await verifyCodes(path, "--offline")).toEqual([
        "MALFORMED_DOCUMENT",
      ]);
      const manifest = await commitPackage(path, "r1", "x\n");
      const prepared = await cli(
        path,
        "prepare",
        "registration",
        "--study",
        STUDY,
        "--revision",
        "r1",
        "--manifest",
        manifest,
        "--authorizes",
        "probe",
      );
      expect(prepared.stderr).toContain(
        "MALFORMED_DOCUMENT: m9/0001.json is not JSON.",
      );
      expect(
        (await cli(path, "verify", "--revision", "no-such-revision")).stderr,
      ).toContain("CONTENT_MISMATCH: Commit no-such-revision does not exist.");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "seals without witnesses but warns, and reports a failed witness push",
    async () => {
      const { path, witness } = await newRepository();
      await rm(join(path, "registry", "witnesses.json"));
      await gitIn(
        path,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "no witnesses",
      );
      await sealGenesis(path);
      const verified = await cli(path, "verify");
      expectOk(verified);
      expect(verified.stdout).toContain(
        "warning: registry/witnesses.json is absent; no witnesses were checked.",
      );

      const { path: second } = await newRepository();
      await rm(witness, { recursive: true });
      const configuration = await readFile(
        join(second, "registry", "witnesses.json"),
        "utf8",
      );
      const missing = join(root, "never-created.git");
      await writeFile(
        join(second, "registry", "witnesses.json"),
        configuration.replace(/"url":"[^"]+"/, `"url":"${missing}"`),
      );
      await gitIn(
        second,
        "commit",
        "--quiet",
        "--all",
        "--message",
        "unreachable witness",
      );
      expectOk(
        await cli(
          second,
          "prepare",
          "genesis",
          "--study",
          STUDY,
          "--principal",
          "sponsor",
          "--public-key",
          `${sponsorKey}.pub`,
          "--tsa",
          `alpha=${alpha.url}`,
          "--tsa",
          `beta=${beta.url}`,
        ),
      );
      const sealed = await cli(
        second,
        "seal",
        "--study",
        STUDY,
        "--key",
        sponsorKey,
      );
      expect(sealed.code).toBe(EXIT_FAILED);
      expect(sealed.stdout).toMatch(/^sealed registry\/m9\/0000\.json alpha@/);
      expect(sealed.stderr).toContain("WITNESS_DIVERGED: Push to bare failed");
      expect(await verifyCodes(second, "--offline")).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports usage errors with a distinct exit code",
    async () => {
      const { path } = await newRepository();
      for (const argv of [
        [],
        ["publish"],
        ["prepare", "amendment", "--study", STUDY],
        ["seal", "--study", STUDY],
        ["verify", "--bogus"],
        [
          "prepare",
          "result",
          "--study",
          STUDY,
          "--revision",
          "r",
          "--manifest",
          "m",
          "--reports-on",
          "-1",
        ],
        ["manifest", "/"],
      ]) {
        const run = await cli(path, ...argv);
        expect({ argv, code: run.code }).toEqual({ argv, code: EXIT_USAGE });
        expect(run.stderr).toContain("Usage:");
      }
    },
    TEST_TIMEOUT_MS,
  );
});
