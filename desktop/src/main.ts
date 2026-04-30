import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import { ExternalLinkPopupService } from "./link-popup-service.js";
import { openTabMenu } from "./native-menu-service.js";
import { wireNoteFileEvents } from "./note-event-broadcaster.js";
import { registerNoteIpcHandlers } from "./notes-ipc.js";
import { migrateAttachmentsToNoteAssets } from "./media-migration.js";
import { createVaultMediaProtocolHandler, registerVaultMediaScheme } from "./media-protocol.js";
import { VaultSession } from "./vault-session.js";
import { createMainWindow } from "./window-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vaultSession = new VaultSession({
  ignoredDirectoryNames: [".vault"],
  wireNoteEvents: wireNoteFileEvents,
});
const linkPopupService = new ExternalLinkPopupService();
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
  const vaultPath = vaultSession.getActivePath();
  if (!vaultPath) throw new Error("No vault is open");
  return migrateAttachmentsToNoteAssets({ notesRoot: vaultPath });
}

function closeWindow(event: Electron.IpcMainInvokeEvent) {
  BrowserWindow.fromWebContents(event.sender)?.close();
}

async function openLinkPopup(event: Electron.IpcMainInvokeEvent, rawUrl: string) {
  return linkPopupService.open(event, rawUrl);
}

async function chooseVaultDirectory(event: Electron.IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: Electron.OpenDialogOptions = {
    buttonLabel: "Choose",
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
    title: "Choose Vault Directory",
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  const directoryPath = result.filePaths[0];
  if (result.canceled || !directoryPath) return null;

  return vaultSession.inspectDirectory(directoryPath, { create: true });
}

app.whenReady().then(async () => {
  protocol.handle("vault-media", createVaultMediaProtocolHandler(vaultSession));
  registerNoteIpcHandlers({
    contentSearch: vaultSession,
    noteFiles: vaultSession,
    titleSearch: vaultSession,
  });
  ipcMain.handle("vault:choose-directory", chooseVaultDirectory);
  ipcMain.handle("vault:inspect-directory", (_, directoryPath: string) =>
    vaultSession.inspectDirectory(directoryPath),
  );
  ipcMain.handle("vault:open", (_, payload: { path: string }) => vaultSession.open(payload.path));
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
  void vaultSession.close();
});
