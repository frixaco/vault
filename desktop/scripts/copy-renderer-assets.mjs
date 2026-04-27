import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererDir = join(desktopDir, "dist-renderer");
const execFileAsync = promisify(execFile);

await mkdir(rendererDir, { recursive: true });

await Promise.all([
  cp(join(desktopDir, "src", "index.html"), join(rendererDir, "index.html")),
  execFileAsync(
    "pnpm",
    [
      "exec",
      "tailwindcss",
      "-i",
      join(desktopDir, "src", "styles.css"),
      "-o",
      join(rendererDir, "styles.css"),
      "--minify",
    ],
    {
      cwd: desktopDir,
      shell: process.platform === "win32",
    },
  ),
]);
