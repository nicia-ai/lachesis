import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nicia-ai/lachesis": new URL(
        "./packages/kernel/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: [
        "packages/kernel/src/**/*.ts",
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
