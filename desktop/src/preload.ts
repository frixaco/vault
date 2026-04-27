import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vault", {
  listNotes: () => ipcRenderer.invoke("notes:list") as Promise<string[]>,
});
