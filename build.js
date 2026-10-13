const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const isReleaseBuild =
  process.argv.includes("--release");

const outputDirectory = path.resolve("dist");

fs.mkdirSync(outputDirectory, {
  recursive: true
});

esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(outputDirectory, "main.js"),
  external: [
    "obsidian",
    "electron",
    "fs",
    "path"
  ],
  sourcemap: false,
  minify: isReleaseBuild,
  treeShaking: true,
  legalComments: "none",
  logLevel: "info"
}).then(() => {
  fs.copyFileSync(
    "manifest.json",
    path.join(outputDirectory, "manifest.json")
  );

  console.log(
    isReleaseBuild
      ? "已完成压缩发布构建：dist/main.js"
      : "已完成可读开发构建：dist/main.js"
  );
}).catch(() => {
  process.exit(1);
});
