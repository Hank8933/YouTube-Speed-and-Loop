import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sourceEntries, sourceFiles } from "./source-manifest.mjs";
import {
  combineClassFragments,
  metadataPath,
  projectRoot,
  sourceRoot,
} from "./userscript.mjs";

async function listJavaScriptFiles(directory) {
  const result = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await listJavaScriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      result.push(path.relative(projectRoot, entryPath).split(path.sep).join("/"));
    }
  }

  return result;
}

export async function validateSourceManifest() {
  const duplicates = [
    ...new Set(
      sourceFiles.filter(
        (filename, index) => sourceFiles.indexOf(filename) !== index,
      ),
    ),
  ];

  if (duplicates.length > 0) {
    throw new Error(
      `Source manifest contains duplicate entries: ${duplicates.join(", ")}`,
    );
  }

  const discovered = (await listJavaScriptFiles(sourceRoot)).sort();
  const listed = [...sourceFiles].sort();

  if (JSON.stringify(discovered) !== JSON.stringify(listed)) {
    const unlisted = discovered.filter((filename) => !listed.includes(filename));
    const missing = listed.filter((filename) => !discovered.includes(filename));
    const details = [
      unlisted.length ? `unlisted files: ${unlisted.join(", ")}` : null,
      missing.length ? `missing files: ${missing.join(", ")}` : null,
    ].filter(Boolean);

    throw new Error(`Source manifest is incomplete (${details.join("; ")}).`);
  }

  return sourceFiles;
}

async function readSourceEntry(entry) {
  if (typeof entry === "string") {
    return {
      filename: entry,
      content: await readFile(path.join(projectRoot, entry), "utf8"),
    };
  }

  if (entry.type === "class-fragments") {
    const fragments = await Promise.all(
      entry.files.map(async (filename) => ({
        filename,
        content: await readFile(path.join(projectRoot, filename), "utf8"),
      })),
    );

    return {
      filename: entry.files.join(" + "),
      content: combineClassFragments(entry.className, fragments),
      sourceFiles: [...entry.files],
    };
  }

  throw new Error(`Unsupported source entry type: ${entry.type}`);
}

export async function readSourceTree() {
  await validateSourceManifest();

  return {
    metadataContent: await readFile(metadataPath, "utf8"),
    sourceFragments: await Promise.all(sourceEntries.map(readSourceEntry)),
  };
}
