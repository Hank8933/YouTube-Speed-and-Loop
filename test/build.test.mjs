import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sourceFiles } from "../scripts/source-manifest.mjs";
import {
  readSourceTree,
  validateSourceManifest,
} from "../scripts/source-tree.mjs";
import {
  assembleUserscript,
  normalizeLineEndings,
  outputPath,
  parseUserscriptMetadata,
  validateClassicScriptSyntax,
  validateMetadataFile,
  validateSourceFragment,
  validateUserscript,
} from "../scripts/userscript.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const sourceTree = await readSourceTree();
const assembled = assembleUserscript({
  ...sourceTree,
  expectedVersion: packageJson.version,
});
const output = await readFile(outputPath, "utf8");

test("generated userscript matches the source manifest", () => {
  assert.equal(normalizeLineEndings(output), assembled);
});

test("source manifest covers every JavaScript source file", async () => {
  assert.deepEqual(await validateSourceManifest(), sourceFiles);
  assert.equal(new Set(sourceFiles).size, sourceFiles.length);
});

test("every source fragment has classic-script syntax", () => {
  for (const fragment of sourceTree.sourceFragments) {
    assert.doesNotThrow(() =>
      validateSourceFragment(fragment.content, fragment.filename),
    );
  }
});

test("userscript metadata matches package version", () => {
  const metadata = parseUserscriptMetadata(sourceTree.metadataContent);

  assert.equal(metadata.get("version"), packageJson.version);
  assert.equal(metadata.get("grant"), "none");
  assert.equal(metadata.get("license"), "MIT");
});

test("metadata file validation accepts the current metadata", () => {
  assert.doesNotThrow(() =>
    validateMetadataFile(sourceTree.metadataContent, packageJson.version),
  );
});

test("assembled userscript validation accepts the current output", () => {
  assert.doesNotThrow(() =>
    validateUserscript(assembled, packageJson.version, "script.user.js"),
  );
});

test("source files are assembled in manifest order", () => {
  let previousIndex = -1;

  for (const fragment of sourceTree.sourceFragments) {
    const indented = fragment.content
      .trimEnd()
      .split("\n")
      .map((line) => (line ? `  ${line}` : ""))
      .join("\n");
    const index = assembled.indexOf(indented, previousIndex + 1);

    assert.ok(index > previousIndex, `${fragment.filename} is out of order.`);
    previousIndex = index;
  }
});

test("classic-script validation rejects module-only syntax", () => {
  assert.throws(
    () => validateClassicScriptSyntax("export {};\n", "module-only.js"),
    SyntaxError,
  );
});

test("source fragments reject embedded metadata", () => {
  assert.throws(
    () =>
      validateSourceFragment(
        "// ==UserScript==\n// ==/UserScript==\n",
        "src/example.js",
      ),
    /must not contain a userscript metadata block/,
  );
});

test("line endings are normalized deterministically", () => {
  assert.equal(normalizeLineEndings("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("metadata parser rejects a missing header", () => {
  assert.throws(
    () => parseUserscriptMetadata("console.log('missing metadata');\n"),
    /must begin on the first line/,
  );
});

test("metadata parser rejects content before the header", () => {
  assert.throws(
    () =>
      parseUserscriptMetadata(
        `// unexpected prefix\n${sourceTree.metadataContent}`,
      ),
    /must begin on the first line/,
  );
});

test("metadata file rejects content after the metadata block", () => {
  assert.throws(
    () =>
      validateMetadataFile(
        `${sourceTree.metadataContent}console.log('unexpected');\n`,
        packageJson.version,
      ),
    /must contain only the metadata block/,
  );
});

test("validation rejects a release-version mismatch", () => {
  assert.throws(
    () => validateMetadataFile(sourceTree.metadataContent, "9.9.9"),
    /does not match package version/,
  );
});

test("source fragment validation rejects a missing final newline", () => {
  assert.throws(
    () => validateSourceFragment("const value = 1;", "src/example.js"),
    /must end with a newline/,
  );
});
