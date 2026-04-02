import esbuild from "esbuild";
import process from "node:process";

const isProd = process.argv.includes("production");

const context = await esbuild.context({
  banner: {
    js: "/* eslint-disable */",
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "child_process",
    "fs",
    "os",
    "path"
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  loader: {
    ".png": "dataurl",
  },
  sourcemap: isProd ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (isProd) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
