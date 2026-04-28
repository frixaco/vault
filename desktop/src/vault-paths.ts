import path from "node:path";

export function assertInsideDirectory(rootPath: string, filePath: string) {
  if (!isInsideDirectory(rootPath, filePath)) {
    throw new Error("Path is outside the vault");
  }
}

export function isInsideDirectory(rootPath: string, filePath: string) {
  const relativePath = path.relative(rootPath, filePath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function isMarkdownFile(filePath: string) {
  return filePath.toLowerCase().endsWith(".md");
}

export function normalizeVaultPath(vaultPath: string) {
  return vaultPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

export function normalizeNotePath(notePath: string) {
  return normalizeVaultPath(notePath.replace(/\.md$/i, ""));
}

export function normalizeNoteFilePath(relativePath: string) {
  const normalizedPath = normalizeVaultPath(relativePath);
  if (!isMarkdownFile(normalizedPath)) return null;

  return normalizedPath.replace(/\.md$/i, "");
}

export function resolveNoteFilePath(notesRoot: string, notePath: string) {
  const normalizedPath = normalizeNotePath(notePath).split("/").join(path.sep);
  const filePath = path.resolve(notesRoot, `${normalizedPath}.md`);
  assertInsideDirectory(notesRoot, filePath);
  return filePath;
}

export function resolveNoteDirectoryPath(notesRoot: string, notePath: string) {
  const normalizedPath = normalizeNotePath(notePath).split("/").join(path.sep);
  const directoryPath = path.resolve(notesRoot, normalizedPath);
  assertInsideDirectory(notesRoot, directoryPath);
  return directoryPath;
}

export function relativeVaultPath(rootPath: string, filePath: string) {
  const relativePath = path.relative(rootPath, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  return normalizeVaultPath(relativePath);
}
