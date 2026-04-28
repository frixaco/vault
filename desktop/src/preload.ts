import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { NotesTreePatchEvent, OpenNoteUpdatedEvent } from "./note-events.js";
import type { SearchScope } from "./search-types.js";
import type { TabMenuAction, VaultApi } from "./vault-api.js";

contextBridge.exposeInMainWorld("vault", {
  migrateAttachments: () =>
    ipcRenderer.invoke("attachments:migrate") as ReturnType<VaultApi["migrateAttachments"]>,
  createNote: (payload: { content: string }) =>
    ipcRenderer.invoke("notes:create", payload) as ReturnType<VaultApi["createNote"]>,
  onNotesTreePatch: (callback: (event: NotesTreePatchEvent) => void) => {
    const listener = (_event: IpcRendererEvent, payload: NotesTreePatchEvent) => {
      callback(payload);
    };
    ipcRenderer.on("notes:tree-patch", listener);
    return () => ipcRenderer.removeListener("notes:tree-patch", listener);
  },
  onOpenNoteUpdated: (callback: (event: OpenNoteUpdatedEvent) => void) => {
    const listener = (_event: IpcRendererEvent, payload: OpenNoteUpdatedEvent) => {
      callback(payload);
    };
    ipcRenderer.on("notes:open-note-updated", listener);
    return () => ipcRenderer.removeListener("notes:open-note-updated", listener);
  },
  onNoteDeleted: (callback: (notePath: string) => void) => {
    const listener = (_event: IpcRendererEvent, notePath: string) => {
      callback(notePath);
    };
    ipcRenderer.on("notes:note-deleted", listener);
    return () => ipcRenderer.removeListener("notes:note-deleted", listener);
  },
  onNotesWatchError: (callback: (message: string) => void) => {
    const listener = (_event: IpcRendererEvent, message: string) => {
      callback(message);
    };
    ipcRenderer.on("notes:watch-error", listener);
    return () => ipcRenderer.removeListener("notes:watch-error", listener);
  },
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<string[]>,
  moveNote: (payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) =>
    ipcRenderer.invoke("notes:move", payload) as Promise<void>,
  openNote: (path: string) => ipcRenderer.invoke("notes:open", path) as Promise<string>,
  saveNote: (payload: { content: string; path: string }) =>
    ipcRenderer.invoke("notes:save", payload) as Promise<void>,
  setOpenNotePaths: (payload: { paths: string[] }) =>
    ipcRenderer.invoke("notes:set-open-paths", payload) as Promise<void>,
  openPopup: (url: string) => ipcRenderer.invoke("links:open-popup", url) as Promise<void>,
  openTabMenu: (payload: { hasOthers: boolean; hasRight: boolean }) =>
    ipcRenderer.invoke("tabs:menu", payload) as Promise<TabMenuAction>,
  searchNotes: (payload: { query: string; scope: SearchScope }) =>
    ipcRenderer.invoke("notes:search", payload) as ReturnType<VaultApi["searchNotes"]>,
  searchNoteTitles: (payload: { query: string }) =>
    ipcRenderer.invoke("notes:search-titles", payload) as ReturnType<VaultApi["searchNoteTitles"]>,
  searchNoteContent: (payload: { query: string }) =>
    ipcRenderer.invoke("notes:search-content", payload) as ReturnType<
      VaultApi["searchNoteContent"]
    >,
  trackNoteSearchSelection: (payload: { notePath: string; query: string }) =>
    ipcRenderer.invoke("notes:search-track", payload) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
} satisfies VaultApi);
