import { Directory, File, Paths } from "expo-file-system";

export type MobileNoteMeta = {
  directory: string;
  excerpt: string;
  fileName: string;
  mtimeMs: number;
  path: string;
  size: number;
  title: string;
  updated: string;
};

export type MobileVault = {
  dataPath: string;
  notes: MobileNoteMeta[];
  notesPath: string;
};

export function getMobileVaultPaths() {
  const notesDirectory = getNotesDirectory();
  const dataDirectory = new Directory(Paths.document, ".VaultSearch");

  notesDirectory.create({ idempotent: true, intermediates: true });
  dataDirectory.create({ idempotent: true, intermediates: true });

  return {
    dataPath: toNativePath(dataDirectory.uri),
    notesPath: toNativePath(notesDirectory.uri),
  };
}

export async function initializeMobileVault(): Promise<MobileVault> {
  const paths = getMobileVaultPaths();
  const notes = await listMobileNotes();

  return {
    ...paths,
    notes,
  };
}

export async function listMobileNotes() {
  const notes: MobileNoteMeta[] = [];
  walkNoteDirectory(getNotesDirectory(), "", notes);
  return notes.sort((left, right) => {
    const byTime = right.mtimeMs - left.mtimeMs;
    return byTime === 0 ? left.path.localeCompare(right.path) : byTime;
  });
}

export async function readMobileNote(notePath: string) {
  const normalizedPath = normalizeNotePath(notePath);
  if (!normalizedPath) throw new Error("Note path is empty");

  const file = getNoteFile(normalizedPath);
  if (!file.exists) throw new Error("Note does not exist");

  return ensureNoteTitleLine(normalizedPath, await file.text());
}

export function resolveMobileMediaUri(notePath: string, mediaPath: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(mediaPath)) return mediaPath;

  const normalizedMediaPath = normalizeVaultPath(mediaPath.replace(/^[/\\]+/, ""));
  if (!normalizedMediaPath) return "";

  const baseDirectory = mediaPath.startsWith("/")
    ? getVaultAssetsDirectory()
    : getNoteAssetsDirectory(notePath);
  const file = new File(baseDirectory, ...normalizedMediaPath.split("/"));

  return file.exists ? encodeURI(file.uri) : "";
}

export async function createMobileNote(content: string) {
  if (!content.trim()) throw new Error("New note needs content before it can be saved");

  const { content: normalizedContent, title } = normalizeNoteContent(content);
  const notePath = getAvailableSiblingNotePath("", title);
  return writeMobileNote(notePath, normalizedContent);
}

export async function writeMobileNote(notePath: string, content: string) {
  const normalizedPath = normalizeNotePath(notePath);
  if (!normalizedPath) throw new Error("Note path is empty");

  const parsedNote = parseNoteContent(content, getRootNoteTitle(normalizedPath));
  const targetPath = getAvailableSiblingNotePath(normalizedPath, parsedNote.title);
  const normalizedContent = formatNoteContent(getRootNoteTitle(targetPath), parsedNote.body);
  const sourceFile = getNoteFile(normalizedPath);
  const targetFile = getNoteFile(targetPath);

  if (targetPath !== normalizedPath && sourceFile.exists) {
    ensureNoteParentDirectory(targetPath);
    sourceFile.move(targetFile);
  }

  if (!targetFile.exists) targetFile.create({ intermediates: true, overwrite: true });
  targetFile.write(normalizedContent);

  return {
    content: normalizedContent,
    path: targetPath,
  };
}

export function toNativePath(uri: string) {
  return decodeURI(uri.replace(/^file:\/\//, ""));
}

function walkNoteDirectory(
  directory: Directory,
  relativeDirectory: string,
  notes: MobileNoteMeta[],
) {
  if (!directory.exists) return;

  for (const entry of directory.list()) {
    if (entry instanceof Directory) {
      const childDirectory = joinVaultPath(relativeDirectory, entry.name);
      walkNoteDirectory(entry, childDirectory, notes);
      continue;
    }

    if (!(entry instanceof File) || !isMarkdownFile(entry.name)) continue;

    const fileName = entry.name.replace(/\.md$/i, "");
    const notePath = joinVaultPath(relativeDirectory, fileName);
    const normalizedPath = normalizeNotePath(notePath);
    if (!normalizedPath) continue;

    const info = entry.info();
    notes.push({
      directory: relativeDirectory,
      excerpt: "",
      fileName,
      mtimeMs: info.modificationTime ?? 0,
      path: normalizedPath,
      size: info.size ?? 0,
      title: fileName,
      updated: formatUpdatedTime(info.modificationTime ?? null),
    });
  }
}

function getNotesDirectory() {
  return new Directory(Paths.document, "VaultNotes");
}

function getNoteFile(notePath: string) {
  const segments = getSafeNotePathSegments(notePath);
  const fileName = `${segments.at(-1) ?? "Untitled"}.md`;
  const directorySegments = segments.slice(0, -1);
  const directory =
    directorySegments.length === 0
      ? getNotesDirectory()
      : new Directory(getNotesDirectory(), ...directorySegments);

  return new File(directory, fileName);
}

function getVaultAssetsDirectory() {
  return new Directory(getNotesDirectory(), ".vault", "assets");
}

function getNoteAssetsDirectory(notePath: string) {
  return new Directory(getVaultAssetsDirectory(), ...getSafeNotePathSegments(notePath));
}

function ensureNoteParentDirectory(notePath: string) {
  const segments = getSafeNotePathSegments(notePath).slice(0, -1);
  if (segments.length === 0) return;

  new Directory(getNotesDirectory(), ...segments).create({ idempotent: true, intermediates: true });
}

function getAvailableSiblingNotePath(currentNotePath: string, title: string) {
  const directoryPath = currentNotePath.split("/").slice(0, -1).join("/");
  const baseName = sanitizeRootNoteTitle(title);
  const basePath = directoryPath ? `${directoryPath}/${baseName}` : baseName;

  for (let index = 0; ; index += 1) {
    const notePath = index === 0 ? basePath : `${basePath} ${index}`;
    if (notePath === currentNotePath) return notePath;
    if (!getNoteFile(notePath).exists) return notePath;
  }
}

function getSafeNotePathSegments(notePath: string) {
  const normalizedPath = normalizeNotePath(notePath);
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid note path");
  }

  return segments;
}

function normalizeVaultPath(vaultPath: string) {
  return vaultPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

function normalizeNotePath(notePath: string) {
  return normalizeVaultPath(notePath.replace(/\.md$/i, ""));
}

function isMarkdownFile(filePath: string) {
  return filePath.toLowerCase().endsWith(".md");
}

function joinVaultPath(...segments: string[]) {
  return segments.filter(Boolean).join("/");
}

function normalizeNoteContent(content: string, fallbackTitle = "Untitled") {
  const { body, title } = parseNoteContent(content, fallbackTitle);
  return {
    content: formatNoteContent(sanitizeRootNoteTitle(title), body),
    title,
  };
}

function parseNoteContent(content: string, fallbackTitle = "Untitled") {
  const match = content.match(/^(.*?)(\r?\n|$)([\s\S]*)$/);
  const firstLine = match?.[1]?.trim() ?? "";
  const body = match?.[3] ?? "";
  const title = getTitleFromLine(firstLine) || fallbackTitle;

  return {
    body,
    title,
  };
}

function ensureNoteTitleLine(notePath: string, content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const title = getTitleFromLine(firstLine);
  if (title) return formatNoteContent(getRootNoteTitle(notePath), parseNoteContent(content).body);

  return `# ${getRootNoteTitle(notePath)}\n${content.trim() ? `\n${content}` : ""}`;
}

function formatNoteContent(title: string, body: string) {
  const normalizedTitle = `# ${title}`;
  return body.length > 0 ? `${normalizedTitle}\n${body}` : `${normalizedTitle}\n`;
}

function getTitleFromLine(line: string) {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function getRootNoteTitle(notePath: string) {
  return notePath.split("/").at(-1) ?? notePath;
}

function formatUpdatedTime(mtimeMs: number | null) {
  if (!mtimeMs) return "";

  const now = new Date();
  const updated = new Date(mtimeMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfUpdated = new Date(
    updated.getFullYear(),
    updated.getMonth(),
    updated.getDate(),
  ).getTime();
  const daysAgo = Math.round((startOfToday - startOfUpdated) / 86_400_000);

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) {
    return updated.toLocaleDateString(undefined, { weekday: "short" });
  }

  return updated.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sanitizeRootNoteTitle(title: string) {
  const sanitized = Array.from(title.normalize("NFKC"))
    .map((character) =>
      character.charCodeAt(0) < 32 || invalidRootNoteTitleCharacters.has(character)
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.md$/i, "")
    .trim()
    .slice(0, 120)
    .trim();

  return sanitized || "Untitled";
}

const invalidRootNoteTitleCharacters = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
