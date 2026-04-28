import { stat } from "node:fs/promises";
import path from "node:path";
import { assertInsideDirectory } from "./vault-paths.js";

export type MediaResolverOptions = {
  notesRoot: string;
  resolveNoteFile: (notePath: string) => string;
  vaultAssetsRoot: string;
};

export class VaultMediaResolver {
  constructor(private readonly options: MediaResolverOptions) {}

  async resolveMediaFile(notePath: string, mediaPath: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(mediaPath)) {
      throw new Error("External media paths are not served by the vault");
    }

    const normalizedMediaPath = normalizeMediaPath(mediaPath);
    if (!normalizedMediaPath) {
      throw new Error("Media path is empty");
    }

    const baseDirectory = mediaPath.startsWith("/")
      ? this.options.vaultAssetsRoot
      : this.getNoteAssetDirectory(notePath);
    const filePath = path.resolve(baseDirectory, normalizedMediaPath);
    assertInsideDirectory(this.options.vaultAssetsRoot, filePath);
    if (await fileExists(filePath)) return filePath;

    throw new Error("Media file was not found");
  }

  private getNoteAssetDirectory(notePath: string) {
    if (!notePath) {
      throw new Error("Media needs a note path");
    }

    const noteFilePath = this.options.resolveNoteFile(notePath);
    const noteAssetPath = path
      .relative(this.options.notesRoot, noteFilePath)
      .replace(/\.md$/i, "")
      .split(path.sep)
      .filter(Boolean);

    return path.join(this.options.vaultAssetsRoot, ...noteAssetPath);
  }
}

function normalizeMediaPath(mediaPath: string) {
  return mediaPath
    .replace(/^[/\\]+/, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(path.sep);
}

async function fileExists(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}
