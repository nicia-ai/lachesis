import { recordReplayExample } from "./common.mjs";

const result = await recordReplayExample();
if (result.completed.resultDigest !== result.replayed.resultDigest)
  process.exitCode = 1;
