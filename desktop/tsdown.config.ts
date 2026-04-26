import { defineConfig } from "tsdown";

export default defineConfig([
  {
    clean: true,
    deps: {
      neverBundle: ["electron"],
    },
    entry: ["src/main.ts"],
    format: "esm",
    minify: false,
    outDir: "dist-electron",
    platform: "node",
    sourcemap: false,
    target: "node22",
  },
  {
    clean: true,
    entry: ["src/renderer.tsx"],
    format: "esm",
    minify: true,
    outDir: "dist-renderer",
    platform: "browser",
    sourcemap: false,
    target: "chrome140",
  },
]);
