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
    clean: false,
    deps: {
      neverBundle: ["electron"],
    },
    entry: ["src/preload.ts"],
    format: "cjs",
    minify: false,
    outDir: "dist-electron",
    platform: "node",
    sourcemap: false,
    target: "node22",
  },
  {
    clean: true,
    deps: {
      alwaysBundle: [/^@pierre\/trees/, /^@tiptap\/markdown/, /^marked/, /^preact/],
    },
    entry: ["src/renderer.tsx"],
    format: "esm",
    minify: true,
    outDir: "dist-renderer",
    platform: "browser",
    sourcemap: false,
    target: "chrome140",
  },
]);
