import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const metadataStart = "// ==UserScript==\n";
const metadataEnd = "// ==/UserScript==\n";

export const projectRoot = path.resolve(scriptsDirectory, "..");
export const sourceRoot = path.join(projectRoot, "src");
export const metadataPath = path.join(sourceRoot, "metadata.txt");
export const outputPath = path.join(projectRoot, "script.user.js");

export function normalizeLineEndings(content) {
  return content.replace(/\r\n?/g, "\n");
}

export function parseUserscriptMetadata(content) {
  const normalized = normalizeLineEndings(content);

  if (!normalized.startsWith(metadataStart)) {
    throw new Error("Userscript metadata block must begin on the first line.");
  }

  const endIndex = normalized.indexOf(metadataEnd, metadataStart.length);

  if (endIndex < 0) {
    throw new Error("Userscript metadata block is missing or malformed.");
  }

  const body = normalized.slice(metadataStart.length, endIndex);
  const metadata = new Map();

  for (const line of body.split("\n")) {
    const entry = line.match(/^\/\/\s+@(?<key>\S+)\s+(?<value>.*)$/);

    if (entry?.groups) {
      metadata.set(entry.groups.key, entry.groups.value.trim());
    }
  }

  return metadata;
}

function validateMetadataFields(metadata, expectedVersion) {
  const requiredFields = [
    "name",
    "namespace",
    "version",
    "description",
    "match",
    "grant",
    "license",
  ];

  for (const field of requiredFields) {
    if (!metadata.get(field)) {
      throw new Error(`Required userscript metadata @${field} is missing.`);
    }
  }

  if (metadata.get("version") !== expectedVersion) {
    throw new Error(
      [
        `Userscript @version ${metadata.get("version")}`,
        `does not match package version ${expectedVersion}.`,
      ].join(" "),
    );
  }
}

export function validateMetadataFile(content, expectedVersion) {
  const normalized = normalizeLineEndings(content);
  const metadata = parseUserscriptMetadata(normalized);
  const endIndex = normalized.indexOf(metadataEnd, metadataStart.length);

  if (endIndex + metadataEnd.length !== normalized.length) {
    throw new Error("src/metadata.txt must contain only the metadata block.");
  }

  validateMetadataFields(metadata, expectedVersion);
  return normalized;
}

export function validateClassicScriptSyntax(content, filename = "userscript.js") {
  const normalized = normalizeLineEndings(content);
  new Script(normalized, { filename });
  return normalized;
}

export function combineClassFragments(className, fragments) {
  const prefix = `class ${className} {\n`;
  const suffix = `}\n`;
  const bodies = fragments.map(({ filename, content }) => {
    const normalized = normalizeLineEndings(content);

    if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) {
      throw new Error(
        `${filename} must contain exactly one class ${className} declaration.`,
      );
    }

    validateClassicScriptSyntax(normalized, filename);
    return normalized.slice(prefix.length, -suffix.length);
  });

  return `${prefix}${bodies.join("")}${suffix}`;
}

export function validateSourceFragment(content, filename) {
  const normalized = normalizeLineEndings(content);

  if (!normalized.endsWith("\n")) {
    throw new Error(`${filename} must end with a newline.`);
  }

  if (/^\/\/ ==\/?UserScript==\s*$/m.test(normalized)) {
    throw new Error(`${filename} must not contain a userscript metadata block.`);
  }

  validateClassicScriptSyntax(normalized, filename);
  return normalized;
}

function indentSource(content) {
  return content
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");
}

export function assembleUserscript({
  metadataContent,
  sourceFragments,
  expectedVersion,
}) {
  const metadata = validateMetadataFile(
    metadataContent,
    expectedVersion,
  ).trimEnd();
  const body = sourceFragments
    .map(({ filename, content }) =>
      indentSource(validateSourceFragment(content, filename).trimEnd()),
    )
    .join("\n\n");
  const output = `${metadata}\n\n(() => {\n  "use strict";\n\n${body}\n})();\n`;

  return validateUserscript(output, expectedVersion, "script.user.js");
}

export function validateUserscript(
  content,
  expectedVersion,
  filename = "userscript.js",
) {
  const normalized = normalizeLineEndings(content);
  const metadata = parseUserscriptMetadata(normalized);

  validateMetadataFields(metadata, expectedVersion);

  if (!normalized.endsWith("\n")) {
    throw new Error("Userscript must end with a newline.");
  }

  validateClassicScriptSyntax(normalized, filename);
  return normalized;
}
