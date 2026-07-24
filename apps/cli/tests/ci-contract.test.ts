import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = resolve(
  import.meta.dirname,
  "../../../examples/m8b1-ci/ci-exit-policy.sh",
);

function gate(
  code: string,
  allowReview = false,
): Readonly<{ status: number | null; stderr: string }> {
  const result = spawnSync("sh", [script, code], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      ...(allowReview ? { LACHESIS_ALLOW_REVIEW_REQUIRED: "1" } : {}),
    },
  });
  return { status: result.status, stderr: result.stderr };
}

describe("M8b.1 detached-verification CI exit policy", () => {
  it("accepts only success by default", () => {
    expect(gate("0").status).toBe(0);
    for (const code of ["10", "11", "12", "13", "20", "21", "22", "23", "70"])
      expect(gate(code).status).toBe(Number(code));
  });

  it("allows review-required only through an explicit repository policy", () => {
    expect(gate("10", true)).toMatchObject({ status: 0 });
    expect(gate("11", true).status).toBe(11);
    expect(gate("12", true).status).toBe(12);
    expect(gate("13", true).status).toBe(13);
  });

  it("rejects missing and unsupported exit values as usage failures", () => {
    expect(spawnSync("sh", [script]).status).toBe(64);
    expect(gate("9").status).toBe(64);
  });

  it("is executable as a checked-in POSIX example", async () => {
    expect((await stat(script)).mode & 0o111).not.toBe(0);
  });
});
