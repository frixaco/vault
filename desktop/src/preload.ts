import { contextBridge, ipcRenderer } from "electron";

export type TabMenuAction = "close" | "close-others" | "close-right" | null;

contextBridge.exposeInMainWorld("vault", {
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<string[]>,
  openNote: (path: string) => ipcRenderer.invoke("notes:open", path) as Promise<string>,
  openTabMenu: (payload: { hasOthers: boolean; hasRight: boolean }) =>
    ipcRenderer.invoke("tabs:menu", payload) as Promise<TabMenuAction>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
});
