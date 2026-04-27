import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");
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
}

function listExampleNotes() {
  return new Promise<string[]>((resolve, reject) => {
    const notesPath = path.join(appRoot, "example-notes");
    const filesBinaryPath = getFilesBinaryPath();
    const child = spawn(filesBinaryPath, [notesPath], {
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
        .map((filePath) => normalizeNotePath(notesPath, filePath))
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

app.whenReady().then(() => {
  ipcMain.handle("notes:list", listExampleNotes);
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
