import { inMemoryMockExample } from "./common.mjs";

const result = await inMemoryMockExample();
if (result.result.answer.values[0] !== "Mira") process.exitCode = 1;
