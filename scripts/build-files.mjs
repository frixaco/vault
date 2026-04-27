import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestPath = join(repoRoot, "crates", "files", "Cargo.toml");
const stagedBinDir = join(repoRoot, "desktop", "build", "files", "bin");

const targets = {
  "linux-x64": { binaryName: "files", rustTarget: "x86_64-unknown-linux-gnu" },
  "mac-arm64": { binaryName: "files", rustTarget: "aarch64-apple-darwin" },
  "mac-x64": { binaryName: "files", rustTarget: "x86_64-apple-darwin" },
  "win-arm64": { binaryName: "files.exe", rustTarget: "aarch64-pc-windows-msvc" },
  "win-x64": { binaryName: "files.exe", rustTarget: "x86_64-pc-windows-msvc" },
};

const options = parseOptions(process.argv.slice(2));

await rm(stagedBinDir, { force: true, recursive: true });
await mkdir(stagedBinDir, { recursive: true });

if (options.target === "mac-universal") {
  await buildTarget("mac-arm64");
  await buildTarget("mac-x64");
  await run("lipo", [
    "-create",
    "-output",
    join(stagedBinDir, "files"),
    binaryPathForTarget("mac-arm64"),
    binaryPathForTarget("mac-x64"),
  ]);
} else if (options.target) {
  await buildTarget(options.target);
  await stageBinary(binaryPathForTarget(options.target), targets[options.target].binaryName);
} else {
  await run("cargo", ["build", "--release", "--manifest-path", manifestPath]);
  await stageBinary(binaryPathForHost(), platform() === "win32" ? "files.exe" : "files");
}

function parseOptions(argv) {
  const parsed = { target: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--target") {
      const target = argv[index + 1];
      if (!target) {
        throw new Error("Missing value for --target");
      }
      if (target !== "mac-universal" && !(target in targets)) {
        throw new Error(`Unknown files target: ${target}`);
      }
      parsed.target = target;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

async function buildTarget(targetName) {
  await run("cargo", [
    "build",
    "--release",
    "--manifest-path",
    manifestPath,
    "--target",
    targets[targetName].rustTarget,
  ]);
}

function binaryPathForTarget(targetName) {
  const target = targets[targetName];
  return join(
    repoRoot,
    "crates",
    "files",
    "target",
    target.rustTarget,
    "release",
    target.binaryName,
  );
}

function binaryPathForHost() {
  return join(
    repoRoot,
    "crates",
    "files",
    "target",
    "release",
    platform() === "win32" ? "files.exe" : "files",
  );
}

async function stageBinary(from, binaryName) {
  await cp(from, join(stagedBinDir, binaryName));
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}
