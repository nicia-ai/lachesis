import { typedFailureExample } from "./common.mjs";

const failure = await typedFailureExample();
if (failure.code !== "CANCELLED") process.exitCode = 1;
