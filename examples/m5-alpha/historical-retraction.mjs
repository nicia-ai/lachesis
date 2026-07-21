import { historicalRetractionExample } from "./common.mjs";

const result = await historicalRetractionExample();
if (
  result.historical.values[0] !== "Mira" ||
  result.current.values[0] !== "Noor" ||
  result.replayed.values[0] !== "Mira" ||
  !result.snapshotMismatchFailedClosed
)
  process.exitCode = 1;
