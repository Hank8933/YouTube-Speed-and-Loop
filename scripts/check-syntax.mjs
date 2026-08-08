import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  outputPath,
  projectRoot,
  sourcePath,
  validateClassicScriptSyntax,
} from "./userscript.mjs";

for (const filePath of [sourcePath, outputPath]) {
  const filename = path.relative(projectRoot, filePath);
  validateClassicScriptSyntax(await readFile(filePath, "utf8"), filename);
  console.log(`${filename} has valid classic-script syntax.`);
}
