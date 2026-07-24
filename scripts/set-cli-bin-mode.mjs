import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

await chmod(resolve(import.meta.dirname, "../apps/cli/dist/cli.js"), 0o755);
