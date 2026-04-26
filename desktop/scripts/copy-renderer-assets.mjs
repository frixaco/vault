import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rendererDir = join(desktopDir, "dist-renderer");

await mkdir(rendererDir, { recursive: true });

await Promise.all([
  cp(join(desktopDir, "src", "index.html"), join(rendererDir, "index.html")),
  cp(join(desktopDir, "src", "styles.css"), join(rendererDir, "styles.css")),
]);
