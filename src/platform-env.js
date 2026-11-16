const { Platform, normalizePath, requestUrl } = require("obsidian");

/**
 * 跨平台运行时环境探测、POSIX 路径工具、Vault 二进制文件适配与多端同步防损守卫
 * 同时兼容：
 *   - Windows / macOS / Linux Obsidian 桌面端（Electron + Node.js）
 *   - Android / iOS Obsidian 移动端（Capacitor WebView，无 Node fs/path/child_process/electron/Buffer）
 *   - CDP 隔离沙箱移动端仿真测试模式（window.__BANGUMI_FORCE_MOBILE_ENV__ === true）
 */

function isForcedMobileTestEnv() {
  return typeof window !== "undefined" && Boolean(window.__BANGUMI_FORCE_MOBILE_ENV__);
}

function tryRequireNode(modName) {
  if (isForcedMobileTestEnv()) return null;
  if (Platform && Platform.isMobile) return null;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(modName);
    if (!mod) return null;
    if (modName === "fs" && typeof mod.existsSync !== "function") return null;
    if (modName === "child_process" && typeof mod.spawn !== "function") return null;
    return mod;
  } catch (_) {
    return null;
  }
}

function isMobileEnv() {
  if (isForcedMobileTestEnv()) return true;
  if (Platform && Platform.isMobile) return true;
  return !tryRequireNode("fs");
}

function isDesktopNodeAvailable() {
  return !isMobileEnv() && Boolean(tryRequireNode("fs"));
}

// ==================== 纯 JS 跨平台 POSIX 路径与 URI 工具（不依赖 Node path） ====================

function normalizeUnicodeNfc(str) {
  const s = String(str ?? "");
  if (!s) return "";
  try {
    return typeof s.normalize === "function" ? s.normalize("NFC") : s;
  } catch (_) {
    return s;
  }
}

function toPosixPath(rawPath) {
  const s = String(rawPath || "").trim();
  if (!s) return "";
  if (s.startsWith("\\\\")) {
    return "//" + s.slice(2).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  }
  return s.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/**
 * 将任意本地绝对路径（Windows 盘符、Windows UNC 网络盘、macOS /Users|/Volumes、Linux /home|/mnt）
 * 安全转换为标准 RFC 8089 file:// URL（自动编码 #、?、空格、百分号与 CJK 字符）
 */
function toSafeFileUrl(rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) return raw;

  const urlMod = tryRequireNode("url");
  const pathMod = tryRequireNode("path");
  if (urlMod && typeof urlMod.pathToFileURL === "function" && pathMod) {
    try {
      return urlMod.pathToFileURL(pathMod.normalize(raw)).href;
    } catch (_) {}
  }

  const encodeSeg = (seg) =>
    encodeURIComponent(seg)
      .replace(/%3A/gi, ":")
      .replace(/!/g, "%21");

  const backslashUnc = raw.startsWith("\\\\");
  const slashNorm = raw.replace(/\\/g, "/");
  if (backslashUnc || slashNorm.startsWith("//")) {
    const body = slashNorm.replace(/^\/+/, "");
    const parts = body.split("/").filter(Boolean);
    if (parts.length === 0) return "";
    const host = parts[0];
    const rest = parts.slice(1).map(encodeSeg).join("/");
    return `file://${host}/${rest}`;
  }
  if (/^[A-Za-z]:\//.test(slashNorm)) {
    const drive = slashNorm.slice(0, 2);
    const rest = slashNorm
      .slice(3)
      .split("/")
      .map((seg) => (seg ? encodeSeg(seg) : ""))
      .join("/");
    return `file:///${drive}/${rest}`;
  }
  if (slashNorm.startsWith("/")) {
    const rest = slashNorm
      .slice(1)
      .split("/")
      .map((seg) => (seg ? encodeSeg(seg) : ""))
      .join("/");
    return `file:///${rest}`;
  }
  return "file:///" + encodeURI(slashNorm).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/**
 * 用于写入 Markdown 链接 `[打开本地动画文件夹](file:///...)` 的安全 URL：
 * 额外转义圆括号与方括号，防止文件夹名含 `(01-12Fin...)` 或 `[SubGroup]` 截断 Markdown 链接语法
 */
function toMarkdownSafeFileUrl(rawPath) {
  const href = toSafeFileUrl(rawPath);
  if (!href) return "";
  return href
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D");
}

/**
 * 将仓库外本地绝对媒体路径转换为 Obsidian 渲染层可加载的 URL（兼容 Windows 盘符、UNC、macOS 与 Linux）
 */
function toExternalLocalMediaUrl(rawPath, cacheBustToken = "") {
  const raw = String(rawPath || "").trim();
  if (!raw) return "";
  const appendBust = (u) => {
    if (!u || !cacheBustToken) return u;
    return `${u}${u.includes("?") ? "&" : "?"}_v=${encodeURIComponent(String(cacheBustToken))}`;
  };
  if (/^(?:https?:|data:|app:|capacitor:|blob:|file:)/i.test(raw)) {
    return appendBust(raw);
  }
  const prefix = typeof Platform?.resourcePathPrefix === "string" ? Platform.resourcePathPrefix : "";
  if (prefix && isDesktopNodeAvailable()) {
    const pathMod = tryRequireNode("path");
    const norm = pathMod ? pathMod.normalize(raw) : raw;
    const slash = norm.replace(/\\/g, "/");
    const encoded = encodeURI(slash)
      .replace(/#/g, "%23")
      .replace(/\?/g, "%3F");
    if (/^[A-Za-z]:\//.test(slash)) {
      return appendBust(prefix.replace(/\/+$/, "/") + encoded);
    }
    if (slash.startsWith("/") && !slash.startsWith("//")) {
      return appendBust(prefix.replace(/\/+$/, "") + encoded);
    }
  }
  const fileHref = toSafeFileUrl(raw);
  return fileHref ? appendBust(fileHref) : appendBust(raw);
}

/**
 * 兼容 Electron 32+ / Obsidian 1.7+ 获取 `<input type="file">` 选中文件的真实本地路径
 */
function getNativeFilePathCrossPlatform(file) {
  if (!file || !isDesktopNodeAvailable()) return "";
  try {
    if (typeof file.path === "string" && file.path.trim()) {
      return file.path.trim();
    }
    const electron = tryRequireNode("electron");
    if (electron?.webUtils && typeof electron.webUtils.getPathForFile === "function") {
      const resolved = electron.webUtils.getPathForFile(file);
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved.trim();
      }
    }
  } catch (_) {}
  return "";
}

/**
 * 跨平台桌面原生文件夹选择器（支持空文件夹、Win11 现代资源管理器对话框、macOS Finder 与 Linux，无需手敲路径）
 */
async function pickNativeFolderOnDesktop(options = {}) {
  if (!isDesktopNodeAvailable()) return "";
  const title = String(options.title || "选择文件夹").replace(/["'\r\n]/g, " ");
  const initialDir = String(options.initialDir || "").trim();

  // 1. 尝试旧版 Electron remote.dialog（如可用）
  try {
    const electron = tryRequireNode("electron");
    const remote = electron?.remote || tryRequireNode("@electron/remote");
    if (remote?.dialog && typeof remote.dialog.showOpenDialog === "function") {
      const res = await remote.dialog.showOpenDialog({
        title,
        defaultPath: initialDir || undefined,
        properties: ["openDirectory", "createDirectory"]
      });
      if (res && !res.canceled && Array.isArray(res.filePaths) && res.filePaths[0]) {
        return res.filePaths[0];
      }
      if (res && res.canceled) return "";
    }
  } catch (_) {}

  const cp = tryRequireNode("child_process");
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const plat = typeof process !== "undefined" ? process.platform : "";

  const execFileAsync = (cmd, args, timeoutMs = 120000) =>
    new Promise((resolve) => {
      if (!cp || typeof cp.execFile !== "function") {
        resolve({ ok: false, stdout: "" });
        return;
      }
      try {
        cp.execFile(
          cmd,
          args,
          { encoding: "utf8", windowsHide: true, timeout: timeoutMs },
          (err, stdout) => {
            if (err) {
              resolve({ ok: false, stdout: String(stdout || "") });
              return;
            }
            resolve({ ok: true, stdout: String(stdout || "") });
          }
        );
      } catch (_) {
        resolve({ ok: false, stdout: "" });
      }
    });

  // 2. Windows 现代原生文件夹选择框（支持选择空目录，强制 UTF-8 杜绝中文乱码）
  if (plat === "win32" && cp) {
    const safeInit =
      initialDir && fsMod && fsMod.existsSync(initialDir)
        ? pathMod.normalize(initialDir).replace(/'/g, "''")
        : "";
    const psScript = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog;",
      `$dlg.Description = '${title.replace(/'/g, "''")}';`,
      "$dlg.ShowNewFolderButton = $true;",
      "try { $dlg.AutoUpgradeEnabled = $true } catch {};",
      safeInit ? `$dlg.SelectedPath = '${safeInit}';` : "",
      "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }"
    ]
      .filter(Boolean)
      .join(" ");
    const winRes = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", psScript]);
    if (winRes.ok) {
      const picked = winRes.stdout.trim().split(/\r?\n/).pop()?.trim() || "";
      return picked;
    }
  }

  // 3. macOS Finder 原生文件夹选择框
  if (plat === "darwin" && cp) {
    const safeInit = initialDir && fsMod && fsMod.existsSync(initialDir) ? initialDir.replace(/"/g, '\\"') : "";
    const osa = safeInit
      ? `POSIX path of (choose folder with prompt "${title}" default location (POSIX file "${safeInit}"))`
      : `POSIX path of (choose folder with prompt "${title}")`;
    const macRes = await execFileAsync("osascript", ["-e", osa]);
    if (macRes.ok) {
      return macRes.stdout.trim().replace(/\/+$/, "");
    }
    return "";
  }

  // 4. Linux Zenity / KDialog 原生文件夹选择框
  if (plat === "linux" && cp) {
    const zenRes = await execFileAsync("zenity", ["--file-selection", "--directory", `--title=${title}`]);
    if (zenRes.ok && zenRes.stdout.trim()) {
      return zenRes.stdout.trim();
    }
    const kdRes = await execFileAsync("kdialog", ["--getexistingdirectory", initialDir || "."]);
    if (kdRes.ok && kdRes.stdout.trim()) {
      return kdRes.stdout.trim();
    }
  }

  // 5. 兜底：HTML5 webkitdirectory（当目录内有文件时提取根目录）
  if (typeof document !== "undefined") {
    return await new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.setAttribute("webkitdirectory", "");
      inp.setAttribute("directory", "");
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val || "");
      };
      inp.onchange = () => {
        const first = inp.files && inp.files[0];
        const full = getNativeFilePathCrossPlatform(first);
        if (!full || !pathMod) {
          done("");
          return;
        }
        const rel = String(first.webkitRelativePath || "").replace(/\\/g, "/");
        const segs = rel.split("/").filter(Boolean);
        let dir = pathMod.dirname(full);
        for (let i = 0; i < Math.max(0, segs.length - 2); i++) {
          dir = pathMod.dirname(dir);
        }
        done(dir);
      };
      inp.oncancel = () => done("");
      inp.click();
    });
  }

  return "";
}

function normalizeVaultRelPath(rawPath) {
  const posix = toPosixPath(rawPath).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!posix) return "";
  try {
    return typeof normalizePath === "function" ? normalizePath(posix) : posix;
  } catch (_) {
    return posix;
  }
}

function posixJoin(...parts) {
  const filtered = parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, "/"));
  if (filtered.length === 0) return "";
  const joined = filtered
    .map((seg, idx) => {
      if (idx === 0) return seg.replace(/\/+$/, "");
      return seg.replace(/^\/+/, "").replace(/\/+$/, "");
    })
    .filter(Boolean)
    .join("/");
  return joined.replace(/\/{2,}/g, "/");
}

function posixBasename(p, ext = "") {
  const clean = toPosixPath(p).replace(/\/+$/, "");
  if (!clean) return "";
  const idx = clean.lastIndexOf("/");
  const base = idx >= 0 ? clean.slice(idx + 1) : clean;
  if (ext && base.toLowerCase().endsWith(String(ext).toLowerCase())) {
    return base.slice(0, base.length - ext.length);
  }
  return base;
}

function posixDirname(p) {
  const clean = toPosixPath(p).replace(/\/+$/, "");
  if (!clean) return "";
  const idx = clean.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";
  return clean.slice(0, idx);
}

function posixExtname(p) {
  const base = posixBasename(p);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

function extnameLower(p) {
  return posixExtname(p).toLowerCase();
}

function joinPosixPath(...parts) {
  return posixJoin(...parts);
}

function posixRelative(fromPath, toPath) {
  const fromClean = toPosixPath(fromPath).replace(/\/+$/, "");
  const toClean = toPosixPath(toPath).replace(/\/+$/, "");
  if (!fromClean) return toClean.replace(/^\/+/, "");
  if (toClean.toLowerCase() === fromClean.toLowerCase()) return "";
  const prefix = fromClean.toLowerCase() + "/";
  if (toClean.toLowerCase().startsWith(prefix)) {
    return toClean.slice(prefix.length);
  }
  return toClean;
}

/**
 * 跨平台 path 适配器：桌面端优先走原生 Node path，移动端/沙箱无 Node 环境下自动回退纯 JS POSIX 实现
 */
const crossPlatformPath = {
  get sep() {
    const np = tryRequireNode("path");
    return np ? np.sep : "/";
  },
  join(...args) {
    const np = tryRequireNode("path");
    return np ? np.join(...args) : posixJoin(...args);
  },
  basename(p, ext) {
    const np = tryRequireNode("path");
    return np ? np.basename(String(p || ""), ext) : posixBasename(p, ext);
  },
  dirname(p) {
    const np = tryRequireNode("path");
    return np ? np.dirname(String(p || "")) : posixDirname(p);
  },
  extname(p) {
    const np = tryRequireNode("path");
    return np ? np.extname(String(p || "")) : posixExtname(p);
  },
  normalize(p) {
    const np = tryRequireNode("path");
    return np ? np.normalize(String(p || "")) : toPosixPath(p);
  },
  resolve(...args) {
    const np = tryRequireNode("path");
    return np ? np.resolve(...args) : posixJoin(...args);
  },
  relative(fromP, toP) {
    const np = tryRequireNode("path");
    return np ? np.relative(String(fromP || ""), String(toP || "")) : posixRelative(fromP, toP);
  },
  isAbsolute(p) {
    const np = tryRequireNode("path");
    if (np) return np.isAbsolute(String(p || ""));
    const s = String(p || "").trim();
    return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("/") || s.startsWith("\\\\");
  }
};

/**
 * 跨平台安全 fs 代理：桌面端直通原生 Node fs；移动端 existsSync 安全返回 false，其余操作抛友好提示
 */
const crossPlatformFs = new Proxy(
  {},
  {
    get(_target, prop) {
      const nfs = tryRequireNode("fs");
      if (nfs && prop in nfs) {
        const val = nfs[prop];
        return typeof val === "function" ? val.bind(nfs) : val;
      }
      if (prop === "existsSync") return () => false;
      if (prop === "readdirSync") return () => [];
      if (prop === "watch") return undefined;
      return () => {
        throw new Error(`当前移动端环境不支持本地磁盘接口 fs.${String(prop)}`);
      };
    }
  }
);

/**
 * 判断路径是否为桌面端外部绝对盘符路径（如 D:\ACG\..., C:/Users/..., \\NAS\..., /mnt/...）
 * 多端同步铁律：在手机端遇到桌面端外部路径时一律视为只读元数据，绝不扫描或清空！
 */
function isDesktopExternalPath(rawPath) {
  const s = String(rawPath || "").trim();
  if (!s) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (s.startsWith("\\\\")) return true;
  if (/^\/(Users|home|mnt|Volumes|media|var|opt)\//i.test(s)) return true;
  return false;
}

// ==================== 二进制转换（兼容无 Node Buffer 的移动端 WebView） ====================

function toArrayBuffer(data) {
  if (!data) return new ArrayBuffer(0);
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return new Uint8Array(data).buffer;
}

function toNodeBufferOrUint8(data) {
  const ab = toArrayBuffer(data);
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function" && !isForcedMobileTestEnv()) {
    return Buffer.from(ab);
  }
  return new Uint8Array(ab);
}

// ==================== Vault 与插件目录跨端读写适配层 ====================

function getPluginRelDir(plugin) {
  const app = plugin?.app;
  const configDir = toPosixPath(app?.vault?.configDir || ".obsidian").replace(/\/+$/, "");
  const pluginId = String(plugin?.manifest?.id || "bangumi-manager").trim();
  const manifestDir = toPosixPath(plugin?.manifest?.dir || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (manifestDir) return manifestDir;
  return `${configDir}/plugins/${pluginId}`;
}

async function ensureAdapterFolderExists(app, relDirPath) {
  const adapter = app?.vault?.adapter;
  if (!adapter || !relDirPath) return;
  const clean = normalizeVaultRelPath(relDirPath);
  if (!clean) return;
  const segments = clean.split("/").filter(Boolean);
  let cur = "";
  for (const seg of segments) {
    cur = cur ? `${cur}/${seg}` : seg;
    try {
      // eslint-disable-next-line no-await-in-loop
      const exists = await adapter.exists(cur);
      if (!exists && typeof adapter.mkdir === "function") {
        // eslint-disable-next-loop no-await-in-loop
        await adapter.mkdir(cur);
      }
    } catch (_) {
      // ignore if already exists
    }
  }
}

async function pluginAssetExists(plugin, subRelPath) {
  const adapter = plugin?.app?.vault?.adapter;
  const fullRel = posixJoin(getPluginRelDir(plugin), subRelPath);
  if (adapter && typeof adapter.exists === "function") {
    try {
      return await adapter.exists(fullRel);
    } catch (_) {}
  }
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  const basePath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : "";
  if (fs && path && basePath) {
    try {
      return fs.existsSync(path.join(basePath, fullRel));
    } catch (_) {}
  }
  return false;
}

async function readPluginAssetBinary(plugin, subRelPath) {
  const adapter = plugin?.app?.vault?.adapter;
  const fullRel = posixJoin(getPluginRelDir(plugin), subRelPath);
  if (adapter && typeof adapter.readBinary === "function") {
    return await adapter.readBinary(fullRel);
  }
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  const basePath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : "";
  if (fs && path && basePath) {
    const buf = fs.readFileSync(path.join(basePath, fullRel));
    return toArrayBuffer(buf);
  }
  throw new Error(`无法读取插件资源文件: ${fullRel}`);
}

async function writePluginAssetBinary(plugin, subRelPath, binaryData) {
  const app = plugin?.app;
  const adapter = app?.vault?.adapter;
  const fullRel = posixJoin(getPluginRelDir(plugin), subRelPath);
  const parentRel = posixDirname(fullRel);
  const ab = toArrayBuffer(binaryData);
  if (adapter && typeof adapter.writeBinary === "function") {
    await ensureAdapterFolderExists(app, parentRel);
    await adapter.writeBinary(fullRel, ab);
    return fullRel;
  }
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  const basePath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : "";
  if (fs && path && basePath) {
    const absTarget = path.join(basePath, fullRel);
    fs.mkdirSync(path.dirname(absTarget), { recursive: true });
    fs.writeFileSync(absTarget, toNodeBufferOrUint8(ab));
    return fullRel;
  }
  throw new Error(`无法写入插件资源文件: ${fullRel}`);
}

async function removePluginAsset(plugin, subRelPath) {
  const adapter = plugin?.app?.vault?.adapter;
  const fullRel = posixJoin(getPluginRelDir(plugin), subRelPath);
  if (adapter && typeof adapter.exists === "function" && typeof adapter.remove === "function") {
    try {
      if (await adapter.exists(fullRel)) {
        await adapter.remove(fullRel);
        return true;
      }
    } catch (_) {}
  }
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  const basePath = typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : "";
  if (fs && path && basePath) {
    const abs = path.join(basePath, fullRel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  }
  return false;
}

function getVaultResourceUrl(app, vaultRelPath) {
  const clean = normalizeVaultRelPath(vaultRelPath);
  if (!clean || !app?.vault) return "";
  const abstract = app.vault.getAbstractFileByPath(clean);
  if (abstract && typeof app.vault.getResourcePath === "function") {
    try {
      return app.vault.getResourcePath(abstract);
    } catch (_) {}
  }
  if (typeof app.vault.adapter?.getResourcePath === "function") {
    try {
      return app.vault.adapter.getResourcePath(clean);
    } catch (_) {}
  }
  return "";
}

async function vaultFileExists(app, vaultRelPath) {
  const clean = normalizeVaultRelPath(vaultRelPath);
  if (!clean || !app?.vault) return false;
  if (app.vault.getAbstractFileByPath(clean)) return true;
  if (typeof app.vault.adapter?.exists === "function") {
    try {
      return await app.vault.adapter.exists(clean);
    } catch (_) {}
  }
  return false;
}

async function writeVaultBinaryFile(app, vaultRelPath, binaryData) {
  const clean = normalizeVaultRelPath(vaultRelPath);
  if (!clean || !app?.vault) throw new Error("无效的仓库相对路径");
  const parentDir = posixDirname(clean);
  if (parentDir) {
    await ensureAdapterFolderExists(app, parentDir);
    if (!app.vault.getAbstractFileByPath(parentDir) && typeof app.vault.createFolder === "function") {
      try {
        await app.vault.createFolder(parentDir);
      } catch (_) {}
    }
  }
  const ab = toArrayBuffer(binaryData);
  const existing = app.vault.getAbstractFileByPath(clean);
  if (existing && typeof app.vault.modifyBinary === "function") {
    await app.vault.modifyBinary(existing, ab);
    return clean;
  }
  if (typeof app.vault.adapter?.writeBinary === "function") {
    await app.vault.adapter.writeBinary(clean, ab);
    return clean;
  }
  if (typeof app.vault.createBinary === "function") {
    await app.vault.createBinary(clean, ab);
    return clean;
  }
  throw new Error(`无法写入二进制文件: ${clean}`);
}

// ==================== 多端同步防损坏铁律守卫 ====================

/**
 * 判断当前是否允许执行「缺失磁盘图片自动从 JSON 对账剔除」。
 * 防损铁律：
 *   1. 移动端（Android / iOS）严禁自动剔除：手机用户普遍采用选择性同步或按需延迟下载大体积画册目录，
 *      若手机启动时自动清理缺失记录，同步回电脑后会把用户的画册典藏清空！
 *   2. 即使在桌面端，若画册目录本身尚未同步到本地（目录不存在），或者原本记录了 >= 2 幅作品但磁盘上
 *      突然 1 幅都找不到（典型同步盘未挂载或正在全量重同步），也一律拒绝自动清空！
 */
async function canSafelyAutoReconcileVaultFolder(app, folderRelPath, trackedCount = 0) {
  if (isMobileEnv()) return false;
  if (!app?.vault) return false;
  const cleanFolder = normalizeVaultRelPath(folderRelPath);
  if (!cleanFolder) return false;

  const folderExists = await vaultFileExists(app, cleanFolder);
  if (!folderExists) return false;

  if (trackedCount >= 2 && typeof app.vault.adapter?.list === "function") {
    try {
      const listed = await app.vault.adapter.list(cleanFolder);
      const fileCount = Array.isArray(listed?.files) ? listed.files.length : 0;
      const subCount = Array.isArray(listed?.folders) ? listed.folders.length : 0;
      if (fileCount === 0 && subCount === 0) {
        // 整个目录突然变成纯空目录，极可能是选择性同步未拉取完成，拒绝静默批量删记录
        return false;
      }
    } catch (_) {
      return false;
    }
  }
  return true;
}

/**
 * 跨平台拉取远程二进制资源（优先使用 Obsidian requestUrl 绕过移动端 CORS 限制，对 i.pixiv.re 遵循免 Referer 规则）
 */
async function fetchBinaryCrossPlatform(url, options = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) throw new Error("空下载链接");
  const isPixivReverseProxy = /i\.pixiv\.re|pixiv\.cat|pximg\.org/i.test(targetUrl);
  const needPixivReferer = !isPixivReverseProxy && /pximg\.net|pixiv\.net/i.test(targetUrl);

  const headers = Object.assign({}, options.headers || {});
  if (isPixivReverseProxy) {
    delete headers.Referer;
    delete headers.referer;
  } else if (needPixivReferer && !headers.Referer && !headers.referer) {
    headers.Referer = "https://www.pixiv.net/";
  }

  // 反代在渲染进程支持无 Referer fetch 时优先走 fetch（更快且不带多余头）
  if (isPixivReverseProxy && typeof window !== "undefined" && typeof window.fetch === "function") {
    try {
      const resp = await window.fetch(targetUrl, {
        method: "GET",
        referrerPolicy: "no-referrer",
        credentials: "omit"
      });
      if (resp.ok) {
        return await resp.arrayBuffer();
      }
    } catch (_) {
      // 回退至 requestUrl
    }
  }

  if (typeof requestUrl === "function") {
    const resp = await requestUrl({
      url: targetUrl,
      method: "GET",
      headers,
      throw: false
    });
    if (resp && resp.status >= 200 && resp.status < 300 && resp.arrayBuffer) {
      return resp.arrayBuffer;
    }
    throw new Error(`HTTP ${resp?.status || "ERR"} (${targetUrl})`);
  }

  const resp = await fetch(targetUrl, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} (${targetUrl})`);
  return await resp.arrayBuffer();
}

function getPluginAssetResourceUrl(plugin, subRelPath) {
  const adapter = plugin?.app?.vault?.adapter;
  const fullRel = posixJoin(getPluginRelDir(plugin), subRelPath);
  if (adapter && typeof adapter.getResourcePath === "function") {
    try {
      return adapter.getResourcePath(fullRel);
    } catch (_) {}
  }
  return "";
}

module.exports = {
  isForcedMobileTestEnv,
  tryRequireNode,
  isMobileEnv,
  isDesktopNodeAvailable,
  normalizeUnicodeNfc,
  toPosixPath,
  toSafeFileUrl,
  toMarkdownSafeFileUrl,
  toExternalLocalMediaUrl,
  getNativeFilePathCrossPlatform,
  pickNativeFolderOnDesktop,
  normalizeVaultRelPath,
  posixJoin,
  joinPosixPath,
  posixBasename,
  posixDirname,
  posixExtname,
  extnameLower,
  posixRelative,
  crossPlatformPath,
  crossPlatformFs,
  isDesktopExternalPath,
  toArrayBuffer,
  toNodeBufferOrUint8,
  getPluginRelDir,
  getPluginAssetResourceUrl,
  ensureAdapterFolderExists,
  pluginAssetExists,
  readPluginAssetBinary,
  writePluginAssetBinary,
  removePluginAsset,
  getVaultResourceUrl,
  vaultFileExists,
  writeVaultBinaryFile,
  canSafelyAutoReconcileVaultFolder,
  fetchBinaryCrossPlatform
};
