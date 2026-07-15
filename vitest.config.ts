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
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
  },
});
