import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { CachedTitleSearchProvider } from "./cached-title-search.js";
import { FffNoteSearch } from "./fff-search.js";
import { ExternalLinkPopupService } from "./link-popup-service.js";
import { openTabMenu } from "./native-menu-service.js";
import { registerNoteIpcHandlers } from "./notes-ipc.js";
import { NoteFileService } from "./note-file-service.js";
import { VaultMediaResolver } from "./media-resolver.js";
import { migrateAttachmentsToNoteAssets } from "./media-migration.js";
import { createVaultMediaProtocolHandler, registerVaultMediaScheme } from "./media-protocol.js";
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
const titleSearch = new CachedTitleSearchProvider(noteFiles);
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
  registerNoteIpcHandlers({ contentSearch: noteSearch, noteFiles, titleSearch });
  ipcMain.handle("attachments:migrate", migrateAttachments);
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
