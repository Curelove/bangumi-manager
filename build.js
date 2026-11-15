const esbuild = require("esbuild");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SESSION_COOLDOWN_MS = 20 * 60 * 1000;
const MAX_AUTO_SNAPSHOTS = 15;

function formatStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    folder:
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    human:
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

function sha256Short(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12).toUpperCase();
}

function collectSrcFiles(srcDir, curDir = srcDir, out = []) {
  if (!fs.existsSync(curDir)) return out;
  for (const it of fs.readdirSync(curDir, { withFileTypes: true })) {
    const full = path.join(curDir, it.name);
    if (it.isDirectory()) {
      collectSrcFiles(srcDir, full, out);
    } else if (it.isFile()) {
      const rel = path.relative(srcDir, full).replace(/\\/g, "/");
      out.push({ destRel: `src/${rel}`, srcAbs: full });
    }
  }
  return out;
}

function backupPreBuildIfNeeded() {
  try {
    const rootMain = path.resolve("main.js");
    const rootManifest = path.resolve("manifest.json");
    if (!fs.existsSync(rootMain) || !fs.existsSync(rootManifest)) return;

    const autoRoot = path.resolve("backups", "auto");
    fs.mkdirSync(autoRoot, { recursive: true });

    const existing = fs
      .readdirSync(autoRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();

    let latestMeta = null;
    if (existing.length > 0) {
      const metaPath = path.join(autoRoot, existing[0], ".snapshot-meta.json");
      if (fs.existsSync(metaPath)) {
        latestMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      }
      if (
        latestMeta &&
        typeof latestMeta.createdAtMs === "number" &&
        Date.now() - latestMeta.createdAtMs < SESSION_COOLDOWN_MS
      ) {
        return;
      }
    }

    const mainBuf = fs.readFileSync(rootMain);
    const mainSha12 = sha256Short(mainBuf);
    if (latestMeta && latestMeta.mainJsSha12 === mainSha12) {
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(rootManifest, "utf8").replace(/^\uFEFF/, ""));
    const now = new Date();
    const { folder, human } = formatStamp(now);
    const snapDir = path.join(autoRoot, folder);
    if (fs.existsSync(snapDir)) return;
    fs.mkdirSync(snapDir, { recursive: true });

    fs.copyFileSync(rootManifest, path.join(snapDir, "manifest.json"));
    fs.copyFileSync(rootMain, path.join(snapDir, "main.js"));
    if (fs.existsSync("styles.css")) {
      fs.copyFileSync("styles.css", path.join(snapDir, "styles.css"));
    }
    if (fs.existsSync("package.json")) {
      fs.copyFileSync("package.json", path.join(snapDir, "package.json"));
    }
    if (fs.existsSync("build.js")) {
      fs.copyFileSync("build.js", path.join(snapDir, "build.js"));
    }

    const srcFiles = collectSrcFiles(path.resolve("src"));
    for (const f of srcFiles) {
      const dest = path.join(snapDir, f.destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.srcAbs, dest);
    }

    const infoText = [
      `插件名称: ${manifest.name || manifest.id} (${manifest.id})`,
      `清单版本: ${manifest.version || "unknown"}`,
      `备份时间: ${human}`,
      `备份类型: 构建前自动快照 (build.js)`,
      `构建产物: main.js (${Math.round(mainBuf.length / 1024)} KB, SHA256前12位: ${mainSha12})`,
      `直接替换对比方法:`,
      `  将本目录顶层的 main.js 与 manifest.json 直接复制到 Obsidian 仓库的`,
      `  .obsidian\\plugins\\${manifest.id}\\ 目录下覆盖即可测试该版本（切勿覆盖目标仓库里的 data.json）。`,
      "",
    ].join("\r\n");
    fs.writeFileSync(path.join(snapDir, "BACKUP-INFO.txt"), infoText, "utf8");
    fs.writeFileSync(
      path.join(snapDir, ".snapshot-meta.json"),
      JSON.stringify(
        {
          pluginId: manifest.id,
          version: manifest.version || null,
          kind: "repo",
          pluginRoot: path.resolve("."),
          triggerReason: "build.js:pre-build",
          createdAt: human,
          createdAtMs: now.getTime(),
          mainJsBytes: mainBuf.length,
          mainJsSha12: mainSha12,
        },
        null,
        2
      ),
      "utf8"
    );

    const after = fs
      .readdirSync(autoRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();
    for (let i = MAX_AUTO_SNAPSHOTS; i < after.length; i++) {
      fs.rmSync(path.join(autoRoot, after[i]), { recursive: true, force: true });
    }
    console.log("已自动归档构建前版本快照：backups/auto/" + folder + " (SHA256=" + mainSha12 + ")");
  } catch (err) {
    console.warn("构建前快照归档跳过：", err.message);
  }
}

function updateLatestCurrentSnapshot(distMain) {
  try {
    const rootManifest = path.resolve("manifest.json");
    const manifest = JSON.parse(fs.readFileSync(rootManifest, "utf8").replace(/^\uFEFF/, ""));
    const latestDir = path.resolve("backups", "latest-current");
    fs.mkdirSync(latestDir, { recursive: true });
    fs.copyFileSync(rootManifest, path.join(latestDir, "manifest.json"));
    fs.copyFileSync(distMain, path.join(latestDir, "main.js"));
    if (fs.existsSync("styles.css")) {
      fs.copyFileSync("styles.css", path.join(latestDir, "styles.css"));
    }
    const buf = fs.readFileSync(distMain);
    const sha12 = sha256Short(buf);
    const { human } = formatStamp(new Date());
    const infoText = [
      `插件名称: ${manifest.name || manifest.id} (${manifest.id})`,
      `清单版本: ${manifest.version || "unknown"}`,
      `更新时间: ${human}`,
      `当前最新构建产物: main.js (${Math.round(buf.length / 1024)} KB, SHA256前12位: ${sha12})`,
      `用途说明: 用历史备份替换测试完旧版后，直接复制本目录下的 main.js 与 manifest.json 覆盖回 .obsidian\\plugins\\${manifest.id}\\ 即可恢复当前最新版。`,
      "",
    ].join("\r\n");
    fs.writeFileSync(path.join(latestDir, "BACKUP-INFO.txt"), infoText, "utf8");
  } catch (err) {
    console.warn("刷新 backups/latest-current 跳过：", err.message);
  }
}

backupPreBuildIfNeeded();

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
  updateLatestCurrentSnapshot(distMain);

  const bytes = fs.statSync(distMain).size;
  const kb = Math.round(bytes / 1024);

  console.log("已完成压缩单文件构建：dist/main.js & main.js & backups/latest-current (" + kb + " KB)");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
