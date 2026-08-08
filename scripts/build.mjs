import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  normalizeLineEndings,
  outputPath,
  projectRoot,
  sourcePath,
  validateUserscript,
} from "./userscript.mjs";

const checkOnly = process.argv.includes("--check");
const packagePath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const source = validateUserscript(
  await readFile(sourcePath, "utf8"),
  packageJson.version,
  path.relative(projectRoot, sourcePath),
);

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

  console.log(
    `${path.relative(projectRoot, outputPath)} generated from ${path.relative(projectRoot, sourcePath)}.`,
  );
}
