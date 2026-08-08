import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readSourceTree } from "./source-tree.mjs";
import {
  assembleUserscript,
  normalizeLineEndings,
  outputPath,
  projectRoot,
} from "./userscript.mjs";

const checkOnly = process.argv.includes("--check");
const packagePath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const sourceTree = await readSourceTree();
const source = assembleUserscript({
  ...sourceTree,
  expectedVersion: packageJson.version,
});

if (checkOnly) {
  let output = null;

  try {
    output = normalizeLineEndings(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (output === null) {
    console.error("script.user.js is missing. Run `npm run build`.");
    process.exitCode = 1;
  } else if (output !== source) {
    console.error(
      "script.user.js is out of date. Run `npm run build` and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("script.user.js is up to date.");
  }
} else {
  const temporaryPath = `${outputPath}.tmp`;

  try {
    await writeFile(temporaryPath, source, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  console.log("script.user.js assembled from the source manifest.");
}
