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
  fs.copyFileSync(
    "manifest.json",
    path.join(outputDirectory, "manifest.json")
  );

  const bytes = fs.statSync(path.join(outputDirectory, "main.js")).size;
  const kb = Math.round(bytes / 1024);

  console.log("已完成压缩单文件构建：dist/main.js (" + kb + " KB)");

  if (kb > 1100) {
    console.warn("警告：构建产物超过 1100 KB，请检查是否仍有废弃大体积文件被引用。");
  }
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
