import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from "electron";
import { FffNoteSearch } from "./fff-search.js";
import { serveMediaFile } from "./media-response.js";
import { migrateAttachmentsToNoteAssets } from "./media-migration.js";
import type { SearchScope } from "./search-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
const notesRoot = path.join(appRoot, "example-notes");
const vaultDataRoot = path.join(notesRoot, ".vault");
const vaultAssetsRoot = path.join(vaultDataRoot, "assets");
const noteSearch = new FffNoteSearch(notesRoot, vaultDataRoot);
const filesBinaryName = process.platform === "win32" ? "files.exe" : "files";
const titleBarOptions =
  process.platform === "darwin"
    ? {
        titleBarStyle: "hidden" as const,
        trafficLightPosition: { x: 16, y: 15 },
      }
    : {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: {
          color: "#fbfbf8",
          symbolColor: "#1f2937",
          height: 40,
        },
      };

protocol.registerSchemesAsPrivileged([
  {
    scheme: "vault-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 540,
    title: "Vault",
    // ...titleBarOptions,

    titleBarStyle: "hidden" as const,
    trafficLightPosition: { x: 16, y: 15 },

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

function assertInsideDirectory(rootPath: string, filePath: string) {
  const relativePath = path.relative(rootPath, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path is outside the vault");
  }
}

async function fileExists(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function getNoteAssetDirectory(notePath: string) {
  if (!notePath) {
    throw new Error("Media needs a note path");
  }

  const noteFilePath = resolveNoteFile(notePath);
  const noteAssetPath = path
    .relative(notesRoot, noteFilePath)
    .replace(/\.md$/i, "")
    .split(path.sep)
    .filter(Boolean);

  return path.join(vaultAssetsRoot, ...noteAssetPath);
}

function normalizeMediaPath(mediaPath: string) {
  return mediaPath
    .replace(/^[/\\]+/, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(path.sep);
}

async function resolveMediaFile(notePath: string, mediaPath: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(mediaPath)) {
    throw new Error("External media paths are not served by the vault");
  }

  const normalizedMediaPath = normalizeMediaPath(mediaPath);
  if (!normalizedMediaPath) {
    throw new Error("Media path is empty");
  }

  const baseDirectory = mediaPath.startsWith("/")
    ? vaultAssetsRoot
    : getNoteAssetDirectory(notePath);
  const filePath = path.resolve(baseDirectory, normalizedMediaPath);
  assertInsideDirectory(vaultAssetsRoot, filePath);
  if (await fileExists(filePath)) return filePath;

  throw new Error("Media file was not found");
}

async function openNote(_: Electron.IpcMainInvokeEvent, notePath: string) {
  return readFile(resolveNoteFile(notePath), "utf8");
}

function searchNotes(
  _: Electron.IpcMainInvokeEvent,
  payload: { query: string; scope: SearchScope },
) {
  return noteSearch.search(payload.query, payload.scope);
}

function searchNoteTitles(_: Electron.IpcMainInvokeEvent, payload: { query: string }) {
  return noteSearch.searchTitles(payload.query);
}

function searchNoteContent(_: Electron.IpcMainInvokeEvent, payload: { query: string }) {
  return noteSearch.searchContent(payload.query);
}

function trackNoteSearchSelection(
  _: Electron.IpcMainInvokeEvent,
  payload: { notePath: string; query: string },
) {
  return noteSearch.trackSelection(payload.query, payload.notePath);
}

function resolveNoteDirectory(notePath: string) {
  const normalizedPath = notePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(path.sep);
  const directoryPath = path.resolve(notesRoot, normalizedPath);
  assertInsideDirectory(notesRoot, directoryPath);

  if (directoryPath === notesRoot) {
    throw new Error("The vault root cannot be moved");
  }

  return directoryPath;
}

function getMoveTargetPath(notePath: string, isFolder: boolean) {
  return isFolder ? resolveNoteDirectory(notePath) : resolveNoteFile(notePath);
}

async function moveNote(
  _: Electron.IpcMainInvokeEvent,
  payload: { destinationPath: string; isFolder: boolean; sourcePath: string },
) {
  const sourcePath = getMoveTargetPath(payload.sourcePath, payload.isFolder);
  const destinationPath = getMoveTargetPath(payload.destinationPath, payload.isFolder);

  if (sourcePath === destinationPath) return;
  if (await pathExists(destinationPath)) {
    throw new Error(`Destination already exists: "${payload.destinationPath}"`);
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rename(sourcePath, destinationPath);
}

async function openMedia(request: Request) {
  try {
    const url = new URL(request.url);
    const mediaPath = url.searchParams.get("path");

    if (!mediaPath) {
      return new Response("Missing media path", { status: 400 });
    }

    const filePath = await resolveMediaFile(url.searchParams.get("note") ?? "", mediaPath);
    return serveMediaFile(request, filePath);
  } catch (mediaError: unknown) {
    const message = mediaError instanceof Error ? mediaError.message : String(mediaError);
    return new Response(message, { status: 404 });
  }
}

function migrateAttachments() {
  return migrateAttachmentsToNoteAssets({ notesRoot });
}

function closeWindow(event: Electron.IpcMainInvokeEvent) {
  BrowserWindow.fromWebContents(event.sender)?.close();
}

function parsePopupUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can be opened in popup windows");
  }
  return url;
}

async function openLinkPopup(event: Electron.IpcMainInvokeEvent, rawUrl: string) {
  const url = parsePopupUrl(rawUrl);
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const popup = new BrowserWindow({
    width: 550,
    height: 360,
    minWidth: 320,
    minHeight: 220,
    parent,
    title: url.hostname,
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let wasClosed = false;

  popup.on("closed", () => {
    wasClosed = true;
  });

  popup.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(parsePopupUrl(url).toString());
    } catch {
      // Ignore non-web popup requests from external pages.
    }
    return { action: "deny" };
  });

  try {
    await popup.loadURL(url.toString());
  } catch (error) {
    if (wasClosed || popup.isDestroyed()) return;
    throw error;
  }
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
  protocol.handle("vault-media", openMedia);
  ipcMain.handle("attachments:migrate", migrateAttachments);
  ipcMain.handle("notes:list", listExampleNotes);
  ipcMain.handle(
    "notes:move",
    (event, payload: { destinationPath: string; isFolder: boolean; sourcePath: string }) =>
      moveNote(event, payload),
  );
  ipcMain.handle("notes:open", openNote);
  ipcMain.handle("notes:search", searchNotes);
  ipcMain.handle("notes:search-titles", searchNoteTitles);
  ipcMain.handle("notes:search-content", searchNoteContent);
  ipcMain.handle("notes:search-track", trackNoteSearchSelection);
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
  noteSearch.dispose();
});
