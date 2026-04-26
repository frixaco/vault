import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("versions", {
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
  node: () => process.versions.node,
});
