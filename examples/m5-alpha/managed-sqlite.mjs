import { managedSqliteExample } from "./common.mjs";

const result = await managedSqliteExample();
if (
  result.result.result.answer.values[0] !== "Mira" ||
  result.permissions?.artifacts.some((artifact) => artifact.mode !== 0o600)
)
  process.exitCode = 1;
