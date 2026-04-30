import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MediaLayoutService } from "./media-layout-service.js";
import { VaultMediaResolver } from "./media-resolver.js";
import { isMediaPath } from "./media-types.js";
import { NoteFileService } from "./note-file-service.js";
import type { MediaLayoutFile } from "./media-layout.js";
import type {
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
} from "./search-types.js";
import { VaultSharedNoteSearch } from "./vault-shared-search.js";

export interface VaultDirectorySummary {
  fileCount: number;
  folderCount: number;
  mediaCount: number;
  noteCount: number;
  path: string;
  unreadableCount: number;
}

export interface OpenVaultResult {
  notes: string[];
  summary: VaultDirectorySummary;
}

type ActiveVault = {
  mediaLayout: MediaLayoutService;
  mediaResolver: VaultMediaResolver;
  noteFiles: NoteFileService;
  noteSearch: VaultSharedNoteSearch;
  path: string;
  stopEvents: () => void;
};

type ResolveDirectoryOptions = {
  create?: boolean;
};

type VaultSessionOptions = {
  ignoredDirectoryNames?: string[];
  wireNoteEvents: (noteFiles: NoteFileService) => () => void;
};

export class VaultSession {
  private activeVault: ActiveVault | null = null;
  private readonly ignoredDirectoryNames: string[];

  constructor(private readonly options: VaultSessionOptions) {
    this.ignoredDirectoryNames = options.ignoredDirectoryNames ?? [];
  }

  async inspectDirectory(directoryPath: string, options: ResolveDirectoryOptions = {}) {
    return inspectVaultDirectory(directoryPath, options);
  }

  async open(directoryPath: string): Promise<OpenVaultResult> {
    const vaultPath = await resolveDirectory(directoryPath, { create: true });
    const vaultDataRoot = path.join(vaultPath, ".vault");
    const vaultAssetsRoot = path.join(vaultDataRoot, "assets");
    await mkdir(vaultAssetsRoot, { recursive: true });

    const noteFiles = new NoteFileService({
      ignoredDirectoryNames: this.ignoredDirectoryNames,
      notesRoot: vaultPath,
    });
    const noteSearch = new VaultSharedNoteSearch(vaultPath, vaultDataRoot);
    const mediaResolver = new VaultMediaResolver({
      notesRoot: vaultPath,
      resolveNoteFile: (notePath) => noteFiles.resolveNoteFile(notePath),
      vaultAssetsRoot,
    });
    const mediaLayout = new MediaLayoutService({
      notesRoot: vaultPath,
      resolveNoteFile: (notePath) => noteFiles.resolveNoteFile(notePath),
      vaultAssetsRoot,
    });
    const stopEvents = this.options.wireNoteEvents(noteFiles);

    try {
      await noteFiles.start();
    } catch (error) {
      stopEvents();
      noteSearch.dispose();
      throw error;
    }

    await this.close();
    this.activeVault = {
      mediaLayout,
      mediaResolver,
      noteFiles,
      noteSearch,
      path: vaultPath,
      stopEvents,
    };

    return {
      notes: noteFiles.listNotePaths(),
      summary: await inspectVaultDirectory(vaultPath),
    };
  }

  async close() {
    const activeVault = this.activeVault;
    this.activeVault = null;
    if (!activeVault) return;

    activeVault.stopEvents();
    await activeVault.noteFiles.stop();
    activeVault.noteSearch.dispose();
  }

  listNotePaths() {
    return this.requireActiveVault().noteFiles.listNotePaths();
  }

  listNoteMeta() {
    return this.requireActiveVault().noteFiles.listNoteMeta();
  }

  createNote(content: string) {
    return this.requireActiveVault().noteFiles.createNote(content);
  }

  moveNote(payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) {
    return this.requireActiveVault().noteFiles.moveNote(payload);
  }

  deleteNote(payload: { isFolder: boolean; sourcePath: string }) {
    return this.requireActiveVault().noteFiles.deleteNote(payload);
  }

  readNote(notePath: string) {
    return this.requireActiveVault().noteFiles.readNote(notePath);
  }

  writeNote(notePath: string, content: string) {
    return this.requireActiveVault().noteFiles.writeNote(notePath, content);
  }

  readMediaLayout(notePath: string) {
    return this.requireActiveVault().mediaLayout.readMediaLayout(notePath);
  }

  writeMediaLayout(notePath: string, layout: MediaLayoutFile) {
    return this.requireActiveVault().mediaLayout.writeMediaLayout(notePath, layout);
  }

  setOpenNotePaths(paths: string[]) {
    this.requireActiveVault().noteFiles.setOpenNotePaths(paths);
  }

  resolveNoteFile(notePath: string) {
    return this.requireActiveVault().noteFiles.resolveNoteFile(notePath);
  }

  resolveNoteDirectory(notePath: string) {
    return this.requireActiveVault().noteFiles.resolveNoteDirectory(notePath);
  }

  search(query: string, scope: SearchScope): Promise<NoteSearchResponse> {
    return this.requireActiveVault().noteSearch.search(query, scope);
  }

  searchTitles(query: string): Promise<NoteTitleSearchResponse> {
    return this.requireActiveVault().noteSearch.searchTitles(query);
  }

  searchContent(query: string): Promise<NoteContentSearchResponse> {
    return this.requireActiveVault().noteSearch.searchContent(query);
  }

  trackSelection(query: string, notePath: string) {
    return this.requireActiveVault().noteSearch.trackSelection(query, notePath);
  }

  resolveMediaFile(notePath: string, mediaPath: string) {
    return this.requireActiveVault().mediaResolver.resolveMediaFile(notePath, mediaPath);
  }

  getActivePath() {
    return this.activeVault?.path ?? null;
  }

  private requireActiveVault() {
    if (!this.activeVault) {
      throw new Error("No vault is open");
    }

    return this.activeVault;
  }
}

export async function inspectVaultDirectory(
  directoryPath: string,
  options: ResolveDirectoryOptions = {},
): Promise<VaultDirectorySummary> {
  const vaultPath = await resolveDirectory(directoryPath, options);
  const summary: VaultDirectorySummary = {
    fileCount: 0,
    folderCount: 0,
    mediaCount: 0,
    noteCount: 0,
    path: vaultPath,
    unreadableCount: 0,
  };

  await scanDirectory(vaultPath, summary);
  return summary;
}

async function resolveDirectory(directoryPath: string, options: ResolveDirectoryOptions = {}) {
  if (options.create) {
    await mkdir(directoryPath, { recursive: true });
  }

  const resolvedPath = await realpath(directoryPath);
  const directoryStat = await stat(resolvedPath);
  if (!directoryStat.isDirectory()) {
    throw new Error("Selected path is not a directory");
  }

  return resolvedPath;
}

async function scanDirectory(directoryPath: string, summary: VaultDirectorySummary) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    summary.unreadableCount += 1;
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".vault") continue;

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      summary.folderCount += 1;
      await scanDirectory(entryPath, summary);
      continue;
    }

    if (!entry.isFile()) continue;

    summary.fileCount += 1;
    if (entry.name.toLowerCase().endsWith(".md")) summary.noteCount += 1;
    if (isMediaPath(entry.name)) summary.mediaCount += 1;
  }
}
