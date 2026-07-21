import { privateFileRecordReplayExample } from "./common.mjs";

const result = await privateFileRecordReplayExample();
if (
  result.completed.resultDigest !== result.replayed.resultDigest ||
  result.permissions.artifacts.some((artifact) => artifact.mode !== 0o600)
)
  process.exitCode = 1;
