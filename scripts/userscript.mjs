import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const metadataStart = "// ==UserScript==\n";
const metadataEnd = "// ==/UserScript==\n";

export const projectRoot = path.resolve(scriptsDirectory, "..");
export const sourcePath = path.join(projectRoot, "src", "userscript.js");
export const outputPath = path.join(projectRoot, "script.user.js");

export function normalizeLineEndings(content) {
  return content.replace(/\r\n?/g, "\n");
}

export function parseUserscriptMetadata(content) {
  const normalized = normalizeLineEndings(content);

  if (!normalized.startsWith(metadataStart)) {
    throw new Error(
      "Userscript metadata block must begin on the first line.",
    );
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

export function validateClassicScriptSyntax(content, filename = "userscript.js") {
  const normalized = normalizeLineEndings(content);
  new Script(normalized, { filename });
  return normalized;
}

export function validateUserscript(
  content,
  expectedVersion,
  filename = "userscript.js",
) {
  const normalized = normalizeLineEndings(content);
  const metadata = parseUserscriptMetadata(normalized);
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
      `Userscript @version ${metadata.get("version")} does not match package version ${expectedVersion}.`,
    );
  }

  if (!normalized.endsWith("\n")) {
    throw new Error("Userscript must end with a newline.");
  }

  validateClassicScriptSyntax(normalized, filename);
  return normalized;
}
