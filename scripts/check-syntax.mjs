import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSourceTree } from "./source-tree.mjs";
import {
  outputPath,
  projectRoot,
  validateClassicScriptSyntax,
  validateSourceFragment,
} from "./userscript.mjs";

const { sourceFragments } = await readSourceTree();

for (const fragment of sourceFragments) {
  validateSourceFragment(fragment.content, fragment.filename);
}

const outputName = path.relative(projectRoot, outputPath);
validateClassicScriptSyntax(await readFile(outputPath, "utf8"), outputName);
console.log(
  `${sourceFragments.length} source files and ${outputName} have valid classic-script syntax.`,
);
