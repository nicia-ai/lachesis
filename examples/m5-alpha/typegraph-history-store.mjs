import { hostTypeGraphExample } from "./common.mjs";

const result = await hostTypeGraphExample();
if (result.result.answer.values[0] !== "Mira") process.exitCode = 1;
