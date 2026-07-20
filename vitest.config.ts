import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@nicia-ai/lachesis-evidence-typegraph/sqlite",
        replacement: new URL(
          "./packages/evidence-typegraph/src/sqlite.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis-evidence-typegraph",
        replacement: new URL(
          "./packages/evidence-typegraph/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis-evidence",
        replacement: new URL(
          "./packages/evidence/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis-generator/node",
        replacement: new URL(
          "./packages/generator/src/node-store.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis-generator-ai-sdk",
        replacement: new URL(
          "./packages/generator-ai-sdk/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis-generator",
        replacement: new URL(
          "./packages/generator/src/index.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: "@nicia-ai/lachesis",
        replacement: new URL("./packages/kernel/src/index.ts", import.meta.url)
          .pathname,
      },
    ],
  },
  test: {
    coverage: {
      provider: "v8",
      include: [
        "packages/kernel/src/**/*.ts",
        "packages/evidence/src/**/*.ts",
        "packages/evidence-typegraph/src/**/*.ts",
        "packages/generator/src/**/*.ts",
        "apps/benchmark/src/controller.ts",
        "apps/benchmark/src/ledger.ts",
        "apps/benchmark/src/manifests.ts",
        "apps/benchmark/src/m3b1-*.ts",
        "apps/benchmark/src/protocol.ts",
        "apps/cli/src/example-catalog.ts",
      ],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 90,
        statements: 90,
        "packages/kernel/src/analyze.ts": { branches: 90 },
        "packages/kernel/src/check.ts": { branches: 90 },
        "packages/kernel/src/executor.ts": { branches: 90 },
      },
    },
  },
});
