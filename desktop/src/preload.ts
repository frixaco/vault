import { contextBridge, ipcRenderer } from "electron";
import type { AttachmentsMigrationResult } from "./media-types.js";

export type TabMenuAction = "close" | "close-others" | "close-right" | null;

contextBridge.exposeInMainWorld("vault", {
  migrateAttachments: () =>
    ipcRenderer.invoke("attachments:migrate") as Promise<AttachmentsMigrationResult>,
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<string[]>,
  moveNote: (payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) =>
    ipcRenderer.invoke("notes:move", payload) as Promise<void>,
  openNote: (path: string) => ipcRenderer.invoke("notes:open", path) as Promise<string>,
  openTabMenu: (payload: { hasOthers: boolean; hasRight: boolean }) =>
    ipcRenderer.invoke("tabs:menu", payload) as Promise<TabMenuAction>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
});
