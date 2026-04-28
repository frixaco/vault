import { watch } from "node:fs";
import { BrowserWindow } from "electron";

export type MainWindowOptions = {
  appIsPackaged: boolean;
  devRendererDir: string;
  preloadPath: string;
  rendererIndexPath: string;
};

export function createMainWindow(options: MainWindowOptions) {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 540,
    title: "Vault",
    titleBarStyle: "hidden" as const,
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: "#fbfbf8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: options.preloadPath,
      sandbox: false,
    },
  });

  window.loadFile(options.rendererIndexPath);

  if (!options.appIsPackaged) {
    enableDevReload(window, options.devRendererDir);
  }

  return window;
}

function enableDevReload(window: BrowserWindow, rendererDir: string) {
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(rendererDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.reloadIgnoringCache();
      }
    }, 120);
  });
  window.on("closed", () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  });
}
