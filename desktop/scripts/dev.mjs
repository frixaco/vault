import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(desktopDir);
const srcDir = join(desktopDir, "src");
const rendererDir = join(desktopDir, "dist-renderer");
const electronDir = join(desktopDir, "dist-electron");
const filesBinaryName = process.platform === "win32" ? "files.exe" : "files";
const filesBinaryPath = join(desktopDir, "build", "files", "bin", filesBinaryName);
const assets = ["index.html", "styles.css"];

if (!existsSync(filesBinaryPath)) {
  console.log("[dev] files binary not found, building rust crate once");
  const result = spawnSync("pnpm", ["--workspace-root", "build-files"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const children = [];

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function copyAsset(name) {
  try {
    mkdirSync(rendererDir, { recursive: true });
    copyFileSync(join(srcDir, name), join(rendererDir, name));
    console.log(`[dev] copied ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[dev] copy ${name} failed:`, error.message);
    }
  }
}

function copyAssets() {
  for (const name of assets) {
    copyAsset(name);
  }
}

function restoreMissingAssets() {
  for (const name of assets) {
    if (!existsSync(join(rendererDir, name))) {
      copyAsset(name);
    }
  }
}

// 1. tsdown --watch (bundles main, preload, renderer)
const tsdown = spawn("pnpm", ["exec", "tsdown", "--watch"], {
  cwd: desktopDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
children.push(tsdown);
tsdown.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[dev] tsdown exited with ${code}`);
    shutdown(code);
  }
});

// 2. Copy + watch static renderer assets (index.html, styles.css)
for (const name of assets) {
  copyAsset(name);
  watch(join(srcDir, name), { persistent: true }, () => copyAsset(name));
}

let restoreAssetsTimer = null;
watch(rendererDir, { persistent: true }, () => {
  if (restoreAssetsTimer) clearTimeout(restoreAssetsTimer);
  restoreAssetsTimer = setTimeout(restoreMissingAssets, 50);
});

// 3. Once tsdown produced its first outputs, launch electron
let electronStarted = false;
const startElectron = () => {
  if (electronStarted) return;
  if (!existsSync(join(electronDir, "main.mjs"))) return;
  if (!existsSync(join(electronDir, "preload.cjs"))) return;
  if (!existsSync(join(rendererDir, "renderer.js"))) return;
  copyAssets();
  if (!existsSync(join(rendererDir, "index.html"))) return;
  electronStarted = true;
  console.log("[dev] starting electron");
  const electronBin = join(
    desktopDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
  const electron = spawn(electronBin, ["."], {
    cwd: desktopDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(electron);
  electron.on("exit", (code) => shutdown(code ?? 0));
};

const poll = setInterval(() => {
  startElectron();
  if (electronStarted) clearInterval(poll);
}, 300);
