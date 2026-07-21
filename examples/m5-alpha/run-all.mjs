import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const files = (await readdir(directory))
  .filter(
    (file) =>
      file.endsWith(".mjs") &&
      !["common.mjs", basename(import.meta.filename)].includes(file),
  )
  .toSorted();

for (const file of files) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, file)], {
      stdio: "inherit",
      env: {},
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (exitCode !== 0) throw new Error(`Offline example failed: ${file}.`);
}

process.stdout.write(
  `Verified ${files.length} offline public-alpha examples.\n`,
);
