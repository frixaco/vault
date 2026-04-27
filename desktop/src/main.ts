import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const notesRoot = path.join(appRoot, "example-notes");
const filesBinaryName = process.platform === "win32" ? "files.exe" : "files";
const titleBarOptions =
  process.platform === "darwin"
    ? {
        titleBarStyle: "hidden" as const,
      }
    : {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: {
          color: "#fbfbf8",
          symbolColor: "#1f2937",
          height: 32,
        },
      };

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: "Vault",
    ...titleBarOptions,
    backgroundColor: "#fbfbf8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: false,
    },
  });

  window.loadFile(path.join(__dirname, "../dist-renderer/index.html"));

  if (!app.isPackaged) {
    enableDevReload(window);
  }
}

function enableDevReload(window: BrowserWindow) {
  const rendererDir = path.join(__dirname, "../dist-renderer");
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

function listExampleNotes() {
  return new Promise<string[]>((resolve, reject) => {
    const filesBinaryPath = getFilesBinaryPath();
    const child = spawn(filesBinaryPath, [notesRoot], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Unable to start files helper at ${filesBinaryPath}. Run pnpm build-files before starting the desktop app. ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `files exited with code ${code}`));
        return;
      }

      const notes = stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((filePath) => filePath.toLowerCase().endsWith(".md"))
        .map((filePath) => normalizeNotePath(notesRoot, filePath))
        .filter((notePath) => notePath.length > 0)
        .sort((left, right) => left.localeCompare(right));

      resolve(notes);
    });
  });
}

function getFilesBinaryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", filesBinaryName);
  }

  return path.join(appRoot, "build", "files", "bin", filesBinaryName);
}

function normalizeNotePath(notesPath: string, filePath: string) {
  const relativePath = path.relative(notesPath, filePath);
  const normalizedPath = relativePath.split(path.sep).join("/");
  return normalizedPath.replace(/\.md$/i, "");
}

function resolveNoteFile(notePath: string) {
  const normalizedPath = notePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(path.sep);
  const filePath = path.resolve(notesRoot, `${normalizedPath}.md`);
  const relativePath = path.relative(notesRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Note path is outside the vault");
  }

  return filePath;
}

async function openNote(_: Electron.IpcMainInvokeEvent, notePath: string) {
  return readFile(resolveNoteFile(notePath), "utf8");
}

function closeWindow(event: Electron.IpcMainInvokeEvent) {
  BrowserWindow.fromWebContents(event.sender)?.close();
}

type TabMenuAction = "close" | "close-others" | "close-right" | null;

function openTabMenu(
  event: Electron.IpcMainInvokeEvent,
  payload: { hasOthers: boolean; hasRight: boolean },
) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return Promise.resolve<TabMenuAction>(null);
  }

  return new Promise<TabMenuAction>((resolve) => {
    let chosen: TabMenuAction = null;
    const menu = Menu.buildFromTemplate([
      {
        label: "Close",
        click: () => {
          chosen = "close";
        },
      },
      {
        label: "Close Others",
        enabled: payload.hasOthers,
        click: () => {
          chosen = "close-others";
        },
      },
      {
        label: "Close All to the Right",
        enabled: payload.hasRight,
        click: () => {
          chosen = "close-right";
        },
      },
    ]);
    menu.popup({
      window,
      callback: () => resolve(chosen),
    });
  });
}

app.whenReady().then(() => {
  ipcMain.handle("notes:list", listExampleNotes);
  ipcMain.handle("notes:open", openNote);
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
