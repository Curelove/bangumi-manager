const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const outputDirectory = path.resolve("dist");

fs.mkdirSync(outputDirectory, {
  recursive: true
});

esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["es2020"],
  outfile: path.join(outputDirectory, "main.js"),
  external: [
    "obsidian",
    "electron",
    "fs",
    "path"
  ],
  sourcemap: false,
  minify: true,
  treeShaking: true,
  legalComments: "none",
  logLevel: "info"
}).then(() => {
  const distMain = path.join(outputDirectory, "main.js");
  fs.copyFileSync(
    "manifest.json",
    path.join(outputDirectory, "manifest.json")
  );
  fs.copyFileSync(
    distMain,
    path.resolve("main.js")
  );

  const bytes = fs.statSync(distMain).size;
  const kb = Math.round(bytes / 1024);

  console.log("已完成压缩单文件构建：dist/main.js & main.js (" + kb + " KB)");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
