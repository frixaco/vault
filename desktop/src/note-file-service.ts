import { mkdir, opendir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import watcher from "@parcel/watcher";
import type { NoteMeta, NotesTreePatchEvent, OpenNoteUpdatedEvent } from "./note-events.js";
import {
  isMarkdownFile,
  normalizeNoteFilePath,
  normalizeNotePath,
  relativeVaultPath,
  resolveNoteDirectoryPath,
  resolveNoteFilePath,
} from "./vault-paths.js";

type WatchEvent = {
  path: string;
  type: "create" | "delete" | "update";
};

type WatchSubscription = Awaited<ReturnType<typeof watcher.subscribe>>;

type NoteFileServiceOptions = {
  ignoredDirectoryNames?: string[];
  notesRoot: string;
};

type Listener<T> = (event: T) => void;

const FS_EVENT_BATCH_MS = 60;

export class NoteFileService {
  private readonly ignoredDirectoryNames: Set<string>;
  private readonly notes = new Map<string, NoteMeta>();
  private readonly openNotePaths = new Set<string>();
  private notesRoot: string;
  private readonly treePatchListeners = new Set<Listener<NotesTreePatchEvent>>();
  private readonly openNoteUpdatedListeners = new Set<Listener<OpenNoteUpdatedEvent>>();
  private readonly deletedNoteListeners = new Set<Listener<string>>();
  private readonly errorListeners = new Set<Listener<string>>();
  private queuedWatchEvents: WatchEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private subscription: WatchSubscription | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly options: NoteFileServiceOptions) {
    this.notesRoot = path.resolve(options.notesRoot);
    this.ignoredDirectoryNames = new Set(options.ignoredDirectoryNames ?? []);
  }

  async start() {
    if (this.subscription) return;
    if (this.starting) return this.starting;

    this.starting = this.startWatching();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.queuedWatchEvents = [];

    const subscription = this.subscription;
    this.subscription = null;
    await subscription?.unsubscribe();
  }

  onTreePatch(listener: Listener<NotesTreePatchEvent>) {
    this.treePatchListeners.add(listener);
    return () => this.treePatchListeners.delete(listener);
  }

  onOpenNoteUpdated(listener: Listener<OpenNoteUpdatedEvent>) {
    this.openNoteUpdatedListeners.add(listener);
    return () => this.openNoteUpdatedListeners.delete(listener);
  }

  onNoteDeleted(listener: Listener<string>) {
    this.deletedNoteListeners.add(listener);
    return () => this.deletedNoteListeners.delete(listener);
  }

  onError(listener: Listener<string>) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  listNotePaths() {
    return [...this.notes.keys()].sort((left, right) => left.localeCompare(right));
  }

  listNoteMeta() {
    return [...this.notes.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  setOpenNotePaths(paths: string[]) {
    this.openNotePaths.clear();
    for (const notePath of paths) {
      const normalizedPath = normalizeNotePath(notePath);
      if (normalizedPath) this.openNotePaths.add(normalizedPath);
    }
  }

  async readNote(notePath: string) {
    return ensureNoteTitleLine(notePath, await readFile(this.resolveNoteFile(notePath), "utf8"));
  }

  async createNote(content: string) {
    if (!content.trim()) {
      throw new Error("New note needs content before it can be saved");
    }

    const { content: normalizedContent, title } = normalizeNoteContent(content);
    const notePath = await this.getAvailableRootNotePath(title);
    return this.writeNote(notePath, normalizedContent);
  }

  async writeNote(notePath: string, content: string) {
    const normalizedPath = normalizeNotePath(notePath);
    if (!normalizedPath) {
      throw new Error("Note path is empty");
    }

    const parsedNote = parseNoteContent(content, getRootNoteTitle(normalizedPath));
    const targetPath = await this.getAvailableSiblingNotePath(normalizedPath, parsedNote.title);
    const normalizedContent = formatNoteContent(getRootNoteTitle(targetPath), parsedNote.body);
    const sourceFilePath = this.resolveNoteFile(normalizedPath);
    const filePath = this.resolveNoteFile(targetPath);

    if (targetPath !== normalizedPath) {
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(sourceFilePath, filePath);
        this.applyMovedPath(normalizedPath, targetPath, false);
      } catch (error) {
        const sourceExists = await pathExists(sourceFilePath);
        if (sourceExists) throw error;
      }
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, normalizedContent, "utf8");

    const meta = await this.readNoteMeta(filePath);
    if (!meta) return { content: normalizedContent, path: targetPath };

    const previous = this.notes.get(meta.path);
    this.notes.set(meta.path, meta);

    this.emitTreePatch({
      added: previous ? [] : [meta],
      removed: [],
      updated: previous ? [meta] : [],
    });

    return { content: normalizedContent, path: targetPath };
  }

  async moveNote(payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) {
    const sourcePath = normalizeNotePath(payload.sourcePath);
    const destinationPath = normalizeNotePath(payload.destinationPath);
    if (!sourcePath || !destinationPath || sourcePath === destinationPath) return;

    const sourceFilePath = payload.isFolder
      ? this.resolveNoteDirectory(sourcePath)
      : this.resolveNoteFile(sourcePath);
    const destinationFilePath = payload.isFolder
      ? this.resolveNoteDirectory(destinationPath)
      : this.resolveNoteFile(destinationPath);

    await mkdir(path.dirname(destinationFilePath), { recursive: true });
    await rename(sourceFilePath, destinationFilePath);
    this.applyMovedPath(sourcePath, destinationPath, payload.isFolder);
  }

  resolveNoteFile(notePath: string) {
    return resolveNoteFilePath(this.notesRoot, notePath);
  }

  resolveNoteDirectory(notePath: string) {
    const directoryPath = resolveNoteDirectoryPath(this.notesRoot, notePath);

    if (directoryPath === this.notesRoot) {
      throw new Error("The vault root cannot be moved");
    }

    return directoryPath;
  }

  private async getAvailableRootNotePath(title: string) {
    return this.getAvailableSiblingNotePath("", title);
  }

  private async getAvailableSiblingNotePath(currentNotePath: string, title: string) {
    const directoryPath = currentNotePath.split("/").slice(0, -1).join("/");
    const baseName = sanitizeRootNoteTitle(title);
    const basePath = directoryPath ? `${directoryPath}/${baseName}` : baseName;

    for (let index = 0; ; index += 1) {
      const notePath = index === 0 ? basePath : `${basePath} ${index}`;
      if (notePath === currentNotePath) return notePath;
      if (this.notes.has(notePath)) continue;

      try {
        await stat(this.resolveNoteFile(notePath));
      } catch {
        return notePath;
      }
    }
  }

  private async startWatching() {
    this.notesRoot = await realpath(this.options.notesRoot);
    await this.rebuildRegistry();
    this.subscription = await watcher.subscribe(
      this.notesRoot,
      (error, events) => {
        if (error) {
          this.emitError(error.message);
          return;
        }

        this.queueWatchEvents(events);
      },
      {
        ignore: [...this.ignoredDirectoryNames].map((directory) => `**/${directory}/**`),
      },
    );
  }

  private async rebuildRegistry() {
    this.notes.clear();
    const metas = await this.scanNotes();

    for (const meta of metas) {
      this.notes.set(meta.path, meta);
    }
  }

  private async scanNotes() {
    const metas: NoteMeta[] = [];
    await this.walkDirectory(this.notesRoot, metas, true);
    return metas.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async walkDirectory(directoryPath: string, metas: NoteMeta[], statFiles: boolean) {
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : String(error));
      return;
    }

    for await (const entry of directory) {
      if (entry.isDirectory() && this.ignoredDirectoryNames.has(entry.name)) continue;

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await this.walkDirectory(entryPath, metas, statFiles);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        const meta = statFiles
          ? await this.readNoteMeta(entryPath)
          : this.createNoteMeta(entryPath);
        if (meta) metas.push(meta);
      }
    }
  }

  private queueWatchEvents(events: WatchEvent[]) {
    const relevantEvents = events.filter((event) => !this.shouldIgnoreAbsolutePath(event.path));
    if (relevantEvents.length === 0) return;

    this.queuedWatchEvents.push(...relevantEvents);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushWatchEvents();
    }, FS_EVENT_BATCH_MS);
  }

  private async flushWatchEvents() {
    const events = this.queuedWatchEvents;
    this.queuedWatchEvents = [];
    if (events.length === 0) return;

    const paths = new Map<string, WatchEvent["type"]>();
    for (const event of events) {
      paths.set(event.path, event.type);
    }

    const added: NoteMeta[] = [];
    const updated: NoteMeta[] = [];
    const removed: string[] = [];
    const openNotesToRefresh = new Set<string>();

    for (const [absolutePath, eventType] of paths) {
      if (isMarkdownFile(absolutePath)) {
        const result = await this.applyMarkdownFileEvent(absolutePath, eventType);
        if (!result) continue;

        if (result.kind === "removed") {
          removed.push(result.path);
          this.emitNoteDeleted(result.path);
        } else if (result.kind === "added") {
          added.push(result.meta);
        } else {
          updated.push(result.meta);
        }

        if (this.openNotePaths.has(result.path) && result.kind !== "removed") {
          openNotesToRefresh.add(result.path);
        }
        continue;
      }

      if (eventType === "delete") {
        for (const notePath of this.removeNotesUnderDirectory(absolutePath)) {
          removed.push(notePath);
          this.emitNoteDeleted(notePath);
        }
      } else {
        const directoryPatch = await this.applyDirectoryEvent(absolutePath);
        added.push(...directoryPatch.added);
        updated.push(...directoryPatch.updated);
        for (const meta of [...directoryPatch.added, ...directoryPatch.updated]) {
          if (this.openNotePaths.has(meta.path)) openNotesToRefresh.add(meta.path);
        }
      }
    }

    this.emitTreePatch({ added, removed, updated });
    await this.refreshOpenNotes(openNotesToRefresh);
  }

  private async applyMarkdownFileEvent(absolutePath: string, eventType: WatchEvent["type"]) {
    const notePath = this.normalizeAbsoluteNotePath(absolutePath);
    if (!notePath) return null;

    if (eventType === "delete") {
      const removed = this.notes.delete(notePath);
      return removed ? ({ kind: "removed" as const, path: notePath } as const) : null;
    }

    const meta = await this.readNoteMeta(absolutePath);
    if (!meta) {
      const removed = this.notes.delete(notePath);
      return removed ? ({ kind: "removed" as const, path: notePath } as const) : null;
    }

    const previous = this.notes.get(meta.path);
    this.notes.set(meta.path, meta);

    if (!previous) return { kind: "added" as const, meta, path: meta.path };
    if (previous.mtimeMs === meta.mtimeMs && previous.size === meta.size) return null;
    return { kind: "updated" as const, meta, path: meta.path };
  }

  private async refreshOpenNotes(notePaths: Set<string>) {
    for (const notePath of notePaths) {
      try {
        const meta = this.notes.get(notePath);
        if (!meta) continue;

        this.emitOpenNoteUpdated({
          content: await this.readNote(notePath),
          mtimeMs: meta.mtimeMs,
          path: notePath,
          size: meta.size,
        });
      } catch (error) {
        this.emitError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async applyDirectoryEvent(directoryPath: string) {
    const added: NoteMeta[] = [];
    const updated: NoteMeta[] = [];
    const metas: NoteMeta[] = [];

    try {
      const directoryStat = await stat(directoryPath);
      if (!directoryStat.isDirectory()) return { added, updated };
    } catch {
      return { added, updated };
    }

    await this.walkDirectory(directoryPath, metas, true);
    for (const meta of metas) {
      const previous = this.notes.get(meta.path);
      this.notes.set(meta.path, meta);
      if (!previous) {
        added.push(meta);
      } else if (previous.mtimeMs !== meta.mtimeMs || previous.size !== meta.size) {
        updated.push(meta);
      }
    }

    return { added, updated };
  }

  private removeNotesUnderDirectory(directoryPath: string) {
    const normalizedDirectory = this.normalizeAbsoluteDirectoryPath(directoryPath);
    if (!normalizedDirectory) return [];

    const prefix = `${normalizedDirectory}/`;
    const removed: string[] = [];
    for (const notePath of this.notes.keys()) {
      if (notePath.startsWith(prefix)) {
        this.notes.delete(notePath);
        removed.push(notePath);
      }
    }

    return removed;
  }

  private applyMovedPath(sourcePath: string, destinationPath: string, isFolder: boolean) {
    if (!isFolder) {
      const previous = this.notes.get(sourcePath);
      this.notes.delete(sourcePath);
      const next = previous
        ? createNoteMeta(destinationPath, previous.birthtimeMs, previous.mtimeMs, previous.size)
        : createNoteMeta(destinationPath, Date.now(), Date.now(), 0);
      this.notes.set(destinationPath, next);
      this.emitTreePatch({ added: [next], removed: [sourcePath], updated: [] });
      return;
    }

    const removed: string[] = [];
    const added: NoteMeta[] = [];
    const sourcePrefix = `${sourcePath}/`;
    const movedEntries: Array<[string, NoteMeta]> = [];

    for (const entry of this.notes) {
      if (entry[0].startsWith(sourcePrefix)) movedEntries.push(entry);
    }

    for (const [notePath, meta] of movedEntries) {
      const nextPath = `${destinationPath}/${notePath.slice(sourcePrefix.length)}`;
      const next = createNoteMeta(nextPath, meta.birthtimeMs, meta.mtimeMs, meta.size);
      this.notes.delete(notePath);
      this.notes.set(nextPath, next);
      removed.push(notePath);
      added.push(next);
    }

    this.emitTreePatch({ added, removed, updated: [] });
  }

  private async readNoteMeta(filePath: string) {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return null;

      const notePath = this.normalizeAbsoluteNotePath(filePath);
      if (!notePath) return null;

      return createNoteMeta(notePath, fileStat.birthtimeMs, fileStat.mtimeMs, fileStat.size);
    } catch {
      return null;
    }
  }

  private createNoteMeta(filePath: string) {
    const notePath = this.normalizeAbsoluteNotePath(filePath);
    if (!notePath) return null;

    return createNoteMeta(notePath, 0, 0, 0);
  }

  private shouldIgnoreAbsolutePath(filePath: string) {
    const relativePath = relativeVaultPath(this.notesRoot, filePath);
    if (relativePath === null) return true;
    return relativePath.split("/").some((segment) => this.ignoredDirectoryNames.has(segment));
  }

  private normalizeAbsoluteNotePath(filePath: string) {
    const relativePath = relativeVaultPath(this.notesRoot, filePath);
    if (relativePath === null) return null;
    return normalizeNoteFilePath(relativePath);
  }

  private normalizeAbsoluteDirectoryPath(directoryPath: string) {
    return relativeVaultPath(this.notesRoot, directoryPath);
  }

  private emitTreePatch(event: NotesTreePatchEvent) {
    if (event.added.length === 0 && event.removed.length === 0 && event.updated.length === 0) {
      return;
    }

    for (const listener of this.treePatchListeners) listener(event);
  }

  private emitOpenNoteUpdated(event: OpenNoteUpdatedEvent) {
    for (const listener of this.openNoteUpdatedListeners) listener(event);
  }

  private emitNoteDeleted(notePath: string) {
    for (const listener of this.deletedNoteListeners) listener(notePath);
  }

  private emitError(message: string) {
    for (const listener of this.errorListeners) listener(message);
  }
}

function createNoteMeta(
  notePath: string,
  birthtimeMs: number,
  mtimeMs: number,
  size: number,
): NoteMeta {
  const segments = notePath.split("/");
  const fileName = segments.at(-1) ?? notePath;

  return {
    birthtimeMs,
    directory: segments.slice(0, -1).join("/"),
    fileName,
    mtimeMs,
    path: notePath,
    size,
    title: fileName,
  };
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
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
