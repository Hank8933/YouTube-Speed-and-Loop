import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeLineEndings,
  outputPath,
  parseUserscriptMetadata,
  sourcePath,
  validateClassicScriptSyntax,
  validateUserscript,
} from "../scripts/userscript.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const source = await readFile(sourcePath, "utf8");
const output = await readFile(outputPath, "utf8");

test("generated userscript matches its source", () => {
  assert.equal(normalizeLineEndings(output), normalizeLineEndings(source));
});

test("userscript metadata matches package version", () => {
  const metadata = parseUserscriptMetadata(source);

  assert.equal(metadata.get("version"), packageJson.version);
  assert.equal(metadata.get("grant"), "none");
  assert.equal(metadata.get("license"), "MIT");
});

test("userscript validation accepts the current source", () => {
  assert.doesNotThrow(() =>
    validateUserscript(source, packageJson.version, "src/userscript.js"),
  );
});

test("classic-script validation rejects module-only syntax", () => {
  assert.throws(
    () => validateClassicScriptSyntax("export {};\n", "module-only.js"),
    SyntaxError,
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
    () => parseUserscriptMetadata(`// unexpected prefix\n${source}`),
    /must begin on the first line/,
  );
});

test("validation rejects a release-version mismatch", () => {
  assert.throws(
    () => validateUserscript(source, "9.9.9"),
    /does not match package version/,
  );
});

test("validation rejects a missing final newline", () => {
  assert.throws(
    () => validateUserscript(source.slice(0, -1), packageJson.version),
    /must end with a newline/,
  );
});
