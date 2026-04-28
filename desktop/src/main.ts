import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { FffNoteSearch } from "./fff-search.js";
import { ExternalLinkPopupService } from "./link-popup-service.js";
import { openTabMenu } from "./native-menu-service.js";
import { NoteFileService } from "./note-file-service.js";
import { VaultMediaResolver } from "./media-resolver.js";
import { migrateAttachmentsToNoteAssets } from "./media-migration.js";
import { createVaultMediaProtocolHandler, registerVaultMediaScheme } from "./media-protocol.js";
import type { NoteTitleSearchResponse, SearchScope, TitleSearchResult } from "./search-types.js";
import { getNoteDisplayParts, normalizeSearchText, parseSearchInput } from "./search-utils.js";
import { createMainWindow } from "./window-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const notesRoot = path.join(appRoot, "example-notes");
const vaultDataRoot = path.join(notesRoot, ".vault");
const vaultAssetsRoot = path.join(vaultDataRoot, "assets");
const noteFiles = new NoteFileService({
  ignoredDirectoryNames: [".vault"],
  notesRoot,
});
const noteSearch = new FffNoteSearch(notesRoot, vaultDataRoot);
const linkPopupService = new ExternalLinkPopupService();
const mediaResolver = new VaultMediaResolver({
  notesRoot,
  resolveNoteFile: (notePath) => noteFiles.resolveNoteFile(notePath),
  vaultAssetsRoot,
});
registerVaultMediaScheme();

function createWindow() {
  return createMainWindow({
    appIsPackaged: app.isPackaged,
    devRendererDir: path.join(__dirname, "../dist-renderer"),
    preloadPath: path.join(__dirname, "preload.cjs"),
    rendererIndexPath: path.join(__dirname, "../dist-renderer/index.html"),
  });
}

function listExampleNotes() {
  return noteFiles.listNotePaths();
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function openNote(_: Electron.IpcMainInvokeEvent, notePath: string) {
  return noteFiles.readNote(notePath);
}

function searchNotes(
  _: Electron.IpcMainInvokeEvent,
  payload: { query: string; scope: SearchScope },
) {
  return noteSearch.search(payload.query, payload.scope);
}

function searchNoteTitles(_: Electron.IpcMainInvokeEvent, payload: { query: string }) {
  return searchCachedNoteTitles(payload.query);
}

function searchNoteContent(_: Electron.IpcMainInvokeEvent, payload: { query: string }) {
  return noteSearch.searchContent(payload.query);
}

function trackNoteSearchSelection(
  _: Electron.IpcMainInvokeEvent,
  payload: { notePath: string; query: string },
) {
  return noteSearch.trackSelection(payload.query, payload.notePath);
}

function searchCachedNoteTitles(query: string): NoteTitleSearchResponse {
  const parsed = parseSearchInput(query, "all");
  if (parsed.scope === "content") {
    return { query: parsed.query, scope: parsed.scope, title: [] };
  }

  const normalizedQuery = normalizeSearchText(parsed.query);
  const words = normalizedQuery.split(" ").filter(Boolean);
  const title = noteFiles
    .listNoteMeta()
    .map((meta) => createTitleSearchCandidate(meta.path, parsed.query, words))
    .filter((result): result is TitleSearchResult & { score: number } => result !== null)
    .sort((left, right) => right.score - left.score || left.notePath.localeCompare(right.notePath))
    .slice(0, 80)
    .map(({ score: _score, ...result }) => result);

  return {
    query: parsed.query,
    scope: parsed.scope,
    title,
  };
}

function createTitleSearchCandidate(notePath: string, query: string, words: string[]) {
  const { directory, title } = getNoteDisplayParts(notePath);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedPath = normalizeSearchText(notePath);

  if (
    words.length > 0 &&
    !words.every((word) => normalizedTitle.includes(word) || normalizedPath.includes(word))
  ) {
    return null;
  }

  const normalizedQuery = normalizeSearchText(query);
  const exact = Boolean(normalizedQuery) && normalizedTitle === normalizedQuery;
  let score = 0;
  if (!normalizedQuery) score = 1;
  else if (exact) score = 1000;
  else if (normalizedTitle.startsWith(normalizedQuery)) score = 800;
  else if (normalizedTitle.includes(normalizedQuery)) score = 600;
  else score = 300 - Math.max(0, normalizedPath.length - normalizedQuery.length);

  return {
    directory,
    exact,
    id: `title:${notePath}`,
    notePath,
    score,
    title,
    type: "title" as const,
  };
}

async function moveNote(
  _: Electron.IpcMainInvokeEvent,
  payload: { destinationPath: string; isFolder: boolean; sourcePath: string },
) {
  if (payload.sourcePath === payload.destinationPath) return;

  const destinationPath = payload.isFolder
    ? noteFiles.resolveNoteDirectory(payload.destinationPath)
    : noteFiles.resolveNoteFile(payload.destinationPath);

  if (await pathExists(destinationPath)) {
    throw new Error(`Destination already exists: "${payload.destinationPath}"`);
  }

  await noteFiles.moveNote(payload);
}

function setOpenNotePaths(_: Electron.IpcMainInvokeEvent, payload: { paths: string[] }) {
  noteFiles.setOpenNotePaths(payload.paths);
}

function migrateAttachments() {
  return migrateAttachmentsToNoteAssets({ notesRoot });
}

function closeWindow(event: Electron.IpcMainInvokeEvent) {
  BrowserWindow.fromWebContents(event.sender)?.close();
}

function sendToAllWindows(channel: string, payload: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function wireNoteFileEvents() {
  noteFiles.onTreePatch((patch) => {
    sendToAllWindows("notes:tree-patch", patch);
  });
  noteFiles.onOpenNoteUpdated((event) => {
    sendToAllWindows("notes:open-note-updated", event);
  });
  noteFiles.onNoteDeleted((notePath) => {
    sendToAllWindows("notes:note-deleted", notePath);
  });
  noteFiles.onError((message) => {
    sendToAllWindows("notes:watch-error", message);
  });
}

async function openLinkPopup(event: Electron.IpcMainInvokeEvent, rawUrl: string) {
  return linkPopupService.open(event, rawUrl);
}

app.whenReady().then(async () => {
  protocol.handle("vault-media", createVaultMediaProtocolHandler(mediaResolver));
  wireNoteFileEvents();
  await noteFiles.start().catch((error: unknown) => {
    console.error("Unable to watch notes", error);
  });
  ipcMain.handle("attachments:migrate", migrateAttachments);
  ipcMain.handle("notes:list", listExampleNotes);
  ipcMain.handle(
    "notes:move",
    (event, payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) =>
      moveNote(event, payload),
  );
  ipcMain.handle("notes:open", openNote);
  ipcMain.handle("notes:set-open-paths", setOpenNotePaths);
  ipcMain.handle("notes:search", searchNotes);
  ipcMain.handle("notes:search-titles", searchNoteTitles);
  ipcMain.handle("notes:search-content", searchNoteContent);
  ipcMain.handle("notes:search-track", trackNoteSearchSelection);
  ipcMain.handle("links:open-popup", openLinkPopup);
  ipcMain.handle("tabs:menu", (event, payload: { hasOthers: boolean; hasRight: boolean }) =>
    openTabMenu(event, payload),
  );
  ipcMain.handle("window:close", closeWindow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void noteFiles.stop();
  noteSearch.dispose();
});
