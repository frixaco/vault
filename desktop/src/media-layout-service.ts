import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createEmptyMediaLayout,
  MEDIA_LAYOUT_FILE_NAME,
  MEDIA_LAYOUT_VERSION,
} from "./media-layout.js";
import type { MediaLayoutEntry, MediaLayoutFile } from "./media-layout.js";
import { assertInsideDirectory } from "./vault-paths.js";

type MediaLayoutServiceOptions = {
  notesRoot: string;
  resolveNoteFile: (notePath: string) => string;
  vaultAssetsRoot: string;
};

export class MediaLayoutService {
  constructor(private readonly options: MediaLayoutServiceOptions) {}

  async readMediaLayout(notePath: string): Promise<MediaLayoutFile> {
    const filePath = this.resolveLayoutFile(notePath);

    try {
      return parseMediaLayoutFile(await readFile(filePath, "utf8"), filePath);
    } catch (error) {
      if (isMissingFileError(error)) return createEmptyMediaLayout();
      throw error;
    }
  }

  async writeMediaLayout(notePath: string, layout: MediaLayoutFile): Promise<void> {
    const normalizedLayout = normalizeMediaLayoutFile(layout);
    const filePath = this.resolveLayoutFile(notePath);
    const directoryPath = path.dirname(filePath);
    const temporaryPath = path.join(directoryPath, `${MEDIA_LAYOUT_FILE_NAME}.tmp`);

    await mkdir(directoryPath, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(normalizedLayout, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  private resolveLayoutFile(notePath: string) {
    const noteFilePath = this.options.resolveNoteFile(notePath);
    const noteAssetPath = path
      .relative(this.options.notesRoot, noteFilePath)
      .replace(/\.md$/i, "")
      .split(path.sep)
      .filter(Boolean);
    const filePath = path.join(
      this.options.vaultAssetsRoot,
      ...noteAssetPath,
      MEDIA_LAYOUT_FILE_NAME,
    );

    assertInsideDirectory(this.options.vaultAssetsRoot, filePath);
    return filePath;
  }
}

function parseMediaLayoutFile(content: string, filePath: string) {
  try {
    return normalizeMediaLayoutFile(JSON.parse(content));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid media layout file at ${filePath}: ${reason}`);
  }
}

function normalizeMediaLayoutFile(value: unknown): MediaLayoutFile {
  if (!isRecord(value)) {
    throw new Error("Layout must be a JSON object");
  }

  if (value.version !== MEDIA_LAYOUT_VERSION) {
    throw new Error(`Unsupported media layout version: ${String(value.version)}`);
  }

  if (!Array.isArray(value.media)) {
    throw new Error("Layout media must be an array");
  }

  return {
    media: value.media.map(normalizeMediaLayoutEntry),
    version: MEDIA_LAYOUT_VERSION,
  };
}

function normalizeMediaLayoutEntry(value: unknown): MediaLayoutEntry {
  if (!isRecord(value)) {
    throw new Error("Media layout entry must be a JSON object");
  }

  if (value.kind !== "image" && value.kind !== "video") {
    throw new Error("Media layout kind must be image or video");
  }

  const target = normalizeNonEmptyString(value.target, "target");
  const fingerprint = normalizeNonEmptyString(value.fingerprint, "fingerprint");
  const updatedAt = normalizeNonEmptyString(value.updatedAt, "updatedAt");
  const occurrence = value.occurrence;
  const width = value.width;

  if (typeof occurrence !== "number" || !Number.isInteger(occurrence) || occurrence < 0) {
    throw new Error("Media layout occurrence must be a non-negative integer");
  }

  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    throw new Error("Media layout width must be a positive number");
  }

  return {
    fingerprint,
    kind: value.kind,
    occurrence,
    target,
    updatedAt,
    width: Math.round(width),
  };
}

function normalizeNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Media layout ${fieldName} must be a non-empty string`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown) {
  return isRecord(error) && error.code === "ENOENT";
}
