import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { AttachmentsMigrationResult } from "./media-types.js";
import type { NotesChangedEvent } from "./note-events.js";
import type {
  NoteContentSearchResponse,
  NoteSearchResponse,
  NoteTitleSearchResponse,
  SearchScope,
} from "./search-types.js";

export type TabMenuAction = "close" | "close-others" | "close-right" | null;

contextBridge.exposeInMainWorld("vault", {
  migrateAttachments: () =>
    ipcRenderer.invoke("attachments:migrate") as Promise<AttachmentsMigrationResult>,
  onNotesChanged: (callback: (event: NotesChangedEvent) => void) => {
    const listener = (_event: IpcRendererEvent, payload: NotesChangedEvent) => {
      callback(payload);
    };
    ipcRenderer.on("notes:changed", listener);
    return () => ipcRenderer.removeListener("notes:changed", listener);
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
  openPopup: (url: string) => ipcRenderer.invoke("links:open-popup", url) as Promise<void>,
  openTabMenu: (payload: { hasOthers: boolean; hasRight: boolean }) =>
    ipcRenderer.invoke("tabs:menu", payload) as Promise<TabMenuAction>,
  searchNotes: (payload: { query: string; scope: SearchScope }) =>
    ipcRenderer.invoke("notes:search", payload) as Promise<NoteSearchResponse>,
  searchNoteTitles: (payload: { query: string }) =>
    ipcRenderer.invoke("notes:search-titles", payload) as Promise<NoteTitleSearchResponse>,
  searchNoteContent: (payload: { query: string }) =>
    ipcRenderer.invoke("notes:search-content", payload) as Promise<NoteContentSearchResponse>,
  trackNoteSearchSelection: (payload: { notePath: string; query: string }) =>
    ipcRenderer.invoke("notes:search-track", payload) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
});
