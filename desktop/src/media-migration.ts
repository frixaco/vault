import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMediaPath } from "./media-types.js";
import type { AttachmentsMigrationResult } from "./media-types.js";

interface MigrationOptions {
  dryRun?: boolean;
  notesRoot?: string;
}

interface MarkdownImageTarget {
  suffix: string;
  target: string;
}

function toVaultPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function normalizeVaultPath(filePath: string) {
  return filePath
    .replace(/^[/\\]+/, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

function isExternalPath(filePath: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(filePath);
}

function assertInsideDirectory(rootPath: string, filePath: string) {
  const relativePath = path.relative(rootPath, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside ${rootPath}: ${filePath}`);
  }
}

function getNotePath(notesRoot: string, noteFilePath: string) {
  return toVaultPath(path.relative(notesRoot, noteFilePath)).replace(/\.md$/i, "");
}

function getNoteAssetDirectory(notesRoot: string, noteFilePath: string) {
  return path.join(
    notesRoot,
    ".vault",
    "assets",
    ...getNotePath(notesRoot, noteFilePath).split("/"),
  );
}

function parseObsidianMediaTarget(target: string) {
  const [mediaPath = "", ...labelParts] = target.split("|");

  return {
    label: labelParts.length > 0 ? labelParts.join("|") : "",
    mediaPath: mediaPath.trim(),
  };
}

function parseMarkdownImageTarget(rawTarget: string): MarkdownImageTarget {
  const trimmedTarget = rawTarget.trim();

  if (trimmedTarget.startsWith("<")) {
    const endIndex = trimmedTarget.indexOf(">");
    if (endIndex >= 0) {
      return {
        suffix: trimmedTarget.slice(endIndex + 1),
        target: trimmedTarget.slice(1, endIndex),
      };
    }
  }

  const match = trimmedTarget.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'))\s*$/);
  if (match) {
    return {
      suffix: match[2] ?? "",
      target: match[1]?.trim() ?? "",
    };
  }

  return {
    suffix: "",
    target: trimmedTarget,
  };
}

function formatMarkdownImageTarget(target: string, suffix: string) {
  const formattedTarget = /[\s()<>]/.test(target) ? `<${target}>` : target;
  return `${formattedTarget}${suffix}`;
}

function getLegacyAttachmentPath(mediaPath: string) {
  if (!mediaPath || isExternalPath(mediaPath) || !isMediaPath(mediaPath)) return null;

  const normalizedPath = normalizeVaultPath(mediaPath);
  if (!normalizedPath || normalizedPath.startsWith(".vault/assets/")) return null;

  const parts = normalizedPath.split("/");
  if (parts[0]?.toLowerCase() === "attachments") {
    return parts.slice(1).join("/");
  }

  return normalizedPath;
}

async function fileExists(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function getFileSize(filePath: string) {
  const fileStat = await stat(filePath);
  return fileStat.size;
}

async function getFileHash(filePath: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function filesHaveSameContent(firstPath: string, secondPath: string) {
  const [firstHash, secondHash] = await Promise.all([
    getFileHash(firstPath),
    getFileHash(secondPath),
  ]);
  return firstHash === secondHash;
}

async function listMarkdownFiles(directoryPath: string, ignoredDirectories = new Set([".vault"])) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await listMarkdownFiles(entryPath, ignoredDirectories)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function getDestinationPath(
  sourcePath: string,
  noteAssetsDirectory: string,
  preferredRelativePath: string,
  result: AttachmentsMigrationResult,
) {
  const preferredPath = path.resolve(noteAssetsDirectory, ...preferredRelativePath.split("/"));
  assertInsideDirectory(noteAssetsDirectory, preferredPath);

  if (!(await fileExists(preferredPath))) {
    return { destinationPath: preferredPath, relativePath: preferredRelativePath };
  }

  if (
    (await getFileSize(sourcePath)) === (await getFileSize(preferredPath)) &&
    (await filesHaveSameContent(sourcePath, preferredPath))
  ) {
    result.skippedExistingFiles += 1;
    return { destinationPath: preferredPath, relativePath: preferredRelativePath };
  }

  const parsedPath = path.parse(preferredRelativePath);

  for (let index = 2; index < 1000; index += 1) {
    const candidateRelativePath = normalizeVaultPath(
      path.join(parsedPath.dir, `${parsedPath.name} ${index}${parsedPath.ext}`),
    );
    const candidatePath = path.resolve(noteAssetsDirectory, ...candidateRelativePath.split("/"));
    assertInsideDirectory(noteAssetsDirectory, candidatePath);

    if (!(await fileExists(candidatePath))) {
      result.renamedFiles += 1;
      return {
        destinationPath: candidatePath,
        relativePath: candidateRelativePath,
      };
    }
  }

  throw new Error(`Could not find a collision-free destination for ${preferredRelativePath}`);
}

export async function migrateAttachmentsToNoteAssets(options: MigrationOptions = {}) {
  if (!options.notesRoot) {
    throw new Error("A notes root is required to migrate attachments");
  }

  const notesRoot = options.notesRoot;
  const attachmentsDirectory = path.join(notesRoot, "attachments");
  const noteAssetsRoot = path.join(notesRoot, ".vault", "assets");
  const result: AttachmentsMigrationResult = {
    attachmentsDirectory,
    copiedFiles: 0,
    dryRun: options.dryRun ?? false,
    missingFiles: [],
    noteAssetsRoot,
    notesChanged: 0,
    notesScanned: 0,
    referencesFound: 0,
    renamedFiles: 0,
    skippedExistingFiles: 0,
  };

  const noteFiles = await listMarkdownFiles(notesRoot);

  for (const noteFilePath of noteFiles) {
    result.notesScanned += 1;

    const content = await readFile(noteFilePath, "utf8");
    const noteAssetsDirectory = getNoteAssetDirectory(notesRoot, noteFilePath);
    const destinationByLegacyPath = new Map<string, string>();

    async function migrateReference(mediaPath: string) {
      const legacyRelativePath = getLegacyAttachmentPath(mediaPath);
      if (!legacyRelativePath) return null;

      result.referencesFound += 1;

      const existingDestination = destinationByLegacyPath.get(legacyRelativePath);
      if (existingDestination) return existingDestination;

      const sourcePath = path.resolve(attachmentsDirectory, ...legacyRelativePath.split("/"));
      assertInsideDirectory(attachmentsDirectory, sourcePath);

      if (!(await fileExists(sourcePath))) {
        result.missingFiles.push(`${getNotePath(notesRoot, noteFilePath)}: ${mediaPath}`);
        return null;
      }

      const destination = await getDestinationPath(
        sourcePath,
        noteAssetsDirectory,
        legacyRelativePath,
        result,
      );

      if (!result.dryRun && !(await fileExists(destination.destinationPath))) {
        await mkdir(path.dirname(destination.destinationPath), { recursive: true });
        await copyFile(sourcePath, destination.destinationPath);
        result.copiedFiles += 1;
      }

      destinationByLegacyPath.set(legacyRelativePath, destination.relativePath);
      return destination.relativePath;
    }

    const obsidianTargets = new Map<string, string | null>();
    const markdownTargets = new Map<string, string | null>();

    for (const match of content.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
      const rawTarget = match[1];
      if (!rawTarget) continue;
      const { mediaPath } = parseObsidianMediaTarget(rawTarget);
      if (!obsidianTargets.has(mediaPath)) {
        obsidianTargets.set(mediaPath, await migrateReference(mediaPath));
      }
    }

    for (const match of content.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const rawTarget = match[1];
      if (!rawTarget) continue;
      const { target } = parseMarkdownImageTarget(rawTarget);
      if (!markdownTargets.has(target)) {
        markdownTargets.set(target, await migrateReference(target));
      }
    }

    let nextContent = content.replace(/!\[\[([^\]\n]+)\]\]/g, (fullMatch, rawTarget: string) => {
      const { label, mediaPath } = parseObsidianMediaTarget(rawTarget);
      const migratedPath = obsidianTargets.get(mediaPath);
      if (!migratedPath) return fullMatch;

      return label ? `![[${migratedPath}|${label}]]` : `![[${migratedPath}]]`;
    });

    nextContent = nextContent.replace(
      /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
      (fullMatch, alt: string, rawTarget: string) => {
        const parsedTarget = parseMarkdownImageTarget(rawTarget);
        const migratedPath = markdownTargets.get(parsedTarget.target);
        if (!migratedPath) return fullMatch;

        return `![${alt}](${formatMarkdownImageTarget(migratedPath, parsedTarget.suffix)})`;
      },
    );

    if (nextContent !== content) {
      result.notesChanged += 1;
      if (!result.dryRun) {
        await writeFile(noteFilePath, nextContent);
      }
    }
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const notesRoot =
    getCliOptionValue("--notes-root") ??
    getCliOptionValue("--vault") ??
    process.env.VAULT_NOTES_ROOT;
  const result = await migrateAttachmentsToNoteAssets({ dryRun, notesRoot });
  console.log(JSON.stringify(result, null, 2));
}

function getCliOptionValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;

  return process.argv[index + 1] ?? null;
}
