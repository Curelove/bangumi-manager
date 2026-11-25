/**
 * 游戏典藏 · 全链路游玩时长追踪与 Windows 极轻原生后台守卫服务
 * -------------------------------------------------------------------------
 * 设计目标：
 * 1. 纯插件单包内嵌（BRAT / GitHub 仍仅需 main.js + manifest.json，无需额外下载外部程序）。
 * 2. Windows 桌面端可选启用独立原生后台守卫（由系统自带 .NET Framework csc.exe 本地编译，
 *    约 20 KB 无窗口 WinExe：0 MB 显存、裁减工作集后约 3–8 MB 内存、单实例互斥防僵尸进程）：
 *    - 关闭 Obsidian 期间照常监测已收录游戏，游戏启停与运行中每 60 秒安全存档点写入共享账本，
 *      无游戏运行时零磁盘写入，内置睡眠/休眠时间剔除与 15 秒退出防抖宽限期。
 *    - 玩到一半打开 Obsidian 或切入游戏典藏时，立即同步离线已完成记录并按真实进程启动时间
 *      实时展示「游玩中 · 已玩 XX 分钟」，关闭游戏后幂等转正绝不重复记账。
 *    - 公开版默认关闭后台守卫与开机自启，由用户在设置页或游戏典藏顶栏一键开启 / 停用卸载清理。
 * 3. 与「桌面侧边手札胶囊」完全解耦：关闭侧边浮窗不影响自动记时长；支持同时追踪多款运行中的游戏；
 *    关闭/重载 Obsidian 时自动落盘所有进行中的自动/手动/移动端计时，杜绝时长蒸发。
 * 4. 精准多进程识别（路径前缀优先 + 反作弊安全降级）：取消旧版 24 进程截断上限，剔除通用/辅助/反作弊
 *    与崩溃上报程序，补全全盘与注册表 Steam 库探测，支持单游戏可选自定义额外监测进程名。
 */

const { Notice } = require("obsidian");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv
} = require("./platform-env.js");

const WATCHER_VERSION = "1.0.0-bm096";
const WATCHER_EXE_NAME = "bm-game-watcher.exe";
const WATCHER_REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WATCHER_REG_VALUE = "BangumiManagerGameWatcher";
const DEFAULT_POLL_MS = 4000;

const DEFAULT_PLAYTIME_TRACKER_SETTINGS = {
  autoTrackExternalGames: true,
  backgroundWatcherEnabled: false,
  autoStartWithWindows: false,
  minSessionSeconds: 60,
  exitGraceSeconds: 15,
  pollIntervalMs: DEFAULT_POLL_MS,
  syncOnWindowFocus: true
};

const IGNORED_HELPER_EXES = new Set([
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "crashreportclient.exe",
  "crashhandler.exe",
  "crashhandler64.exe",
  "crashpad_handler.exe",
  "bugsplat.exe",
  "bugsplat64.exe",
  "bugreport.exe",
  "exceptionreport.exe",
  "feedback.exe",
  "cefsubproc.exe",
  "zfgamebrowser.exe",
  "minibrowser.exe",
  "browser.exe",
  "qtwebengineprocess.exe",
  "steamwebhelper.exe",
  "epicwebhelper.exe",
  "ue4prereqsetup_x64.exe",
  "ueprereqsetup_x64.exe",
  "unins000.exe",
  "unins001.exe",
  "uninstall.exe",
  "vc_redist.x64.exe",
  "vc_redist.x86.exe",
  "dxsetup.exe",
  "dotnetfx.exe",
  "steamerrorreporter.exe",
  "steamerrorreporter64.exe",
  "assistant.exe",
  "tinydl.exe",
  "crossproxy.exe",
  "crossliveupdate.exe",
  "leaguecrashhandler64.exe",
  "riotclientcrashhandler.exe",
  "riotclientservices.exe",
  "riotclientux.exe",
  "riotclientuxrender.exe",
  "fping.exe",
  "startup_runner.exe",
  "updateinstaller.exe",
  "updater.exe",
  "patcher.exe",
  "ace-helper.exe",
  "sguard64.exe",
  "sguardsvc64.exe",
  "diagnostic-assistant.exe",
  "diagnostic-assistant-launcher.exe",
  "tqmcenter.exe",
  "taslogin.exe",
  "tcls_core.exe",
  "beservice.exe",
  "bedaisy.exe",
  "easyanticheat.exe",
  "easyanticheat_eos.exe",
  "easyanticheat_setup.exe",
  "vgc.exe",
  "vgtray.exe",
  "wegame.exe",
  "tgp_daemon.exe",
  "rail.exe",
  "yxqxunyou.exe",
  "xunyou.exe",
  "config.exe",
  "setting.exe",
  "settings.exe",
  "setup.exe"
]);

const IGNORED_HELPER_RE = /(?:crash|bugrep|bugsplat|unins|卸载|redist|setup|update|patcher|reporter|feedback|diagnostic|webhelper|cefsubproc|anticheat|fping|tinydl|crossproxy|sguard|tqmcenter|taslogin|tcls_core|prereq|xunyou)/i;

const GENERIC_STUB_EXE_NAMES = new Set([
  "launcher.exe",
  "start.exe",
  "play.exe",
  "autorun.exe",
  "client.exe",
  "game.exe",
  "main.exe",
  "app.exe",
  "bootstrap.exe",
  "loader.exe",
  "runner.exe",
  "bin.exe",
  "nw.exe",
  "electron.exe"
]);

const SUBFOLDER_LAUNCHER_DIR_RE = /^(?:launcher|wegamelauncher|bin|binaries|win64|win32|x64|x86|game|client|tcls|leagueclient|app)$/i;

const SKIP_SCAN_SUBDIRS_RE = /^(?:redist|_commonredist|mono|directx|support|crash|logs?|temp|tmp|cache|shader|shaders|locales?|saved|movies?|videos?|music|audio|sound|voices?|textures?|assets?|streamingassets|il2cpp_data|cross|tenio|teniolog|tpf_ui|qbblinktrial|rail_files|riot client data|networkassist|xunyou)$/i;

const UNSAFE_SHARED_ROOT_NAMES = new Set([
  "",
  "desktop",
  "桌面",
  "downloads",
  "下载",
  "documents",
  "文档",
  "program files",
  "program files (x86)",
  "programdata",
  "windows",
  "users",
  "common",
  "steamapps",
  "steam",
  "steamlibrary",
  "wegameapps",
  "epic games",
  "games",
  "game",
  "游戏",
  "非steam游戏",
  "galgame",
  "galgames",
  "visual novels"
]);

function isWindowsDesktop() {
  return isDesktopNodeAvailable() && !isMobileEnv() && typeof process !== "undefined" && process.platform === "win32";
}

function clampInt(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePathLower(p) {
  return String(p || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function isSafeGameInstallRoot(dirPath) {
  if (!dirPath) return false;
  const norm = normalizePathLower(dirPath);
  if (!norm || norm.length <= 3) return false; // e.g. "c:" or "d:"
  if (/^[a-z]:\\?$/.test(norm)) return false;
  const parts = norm.split("\\").filter(Boolean);
  if (parts.length < 2) return false;
  const leaf = parts[parts.length - 1];
  if (UNSAFE_SHARED_ROOT_NAMES.has(leaf)) return false;
  // Also reject direct user profile root like C:\Users\name
  if (parts.length === 3 && parts[1] === "users") return false;
  return true;
}

function ensurePlaytimeTrackerSettings(plugin) {
  if (!plugin || !plugin.settings) {
    return Object.assign({}, DEFAULT_PLAYTIME_TRACKER_SETTINGS);
  }
  const existing =
    plugin.settings.gamePlaytimeTracker && typeof plugin.settings.gamePlaytimeTracker === "object"
      ? plugin.settings.gamePlaytimeTracker
      : null;

  // Migrate legacy autoDetectExternalProcess preference once without breaking existing users
  const legacyAuto =
    plugin.settings.gameCapsule && typeof plugin.settings.gameCapsule === "object"
      ? plugin.settings.gameCapsule.autoDetectExternalProcess !== false
      : true;

  const raw = existing || { autoTrackExternalGames: legacyAuto };
  const norm = {
    autoTrackExternalGames: raw.autoTrackExternalGames !== false,
    backgroundWatcherEnabled: Boolean(raw.backgroundWatcherEnabled),
    autoStartWithWindows: Boolean(raw.autoStartWithWindows),
    minSessionSeconds: clampInt(raw.minSessionSeconds, 0, 300, DEFAULT_PLAYTIME_TRACKER_SETTINGS.minSessionSeconds),
    exitGraceSeconds: clampInt(raw.exitGraceSeconds, 5, 60, DEFAULT_PLAYTIME_TRACKER_SETTINGS.exitGraceSeconds),
    pollIntervalMs: clampInt(raw.pollIntervalMs, 2000, 10000, DEFAULT_PLAYTIME_TRACKER_SETTINGS.pollIntervalMs),
    syncOnWindowFocus: raw.syncOnWindowFocus !== false
  };
  plugin.settings.gamePlaytimeTracker = norm;
  if (!plugin.settings.activeGameTimers || typeof plugin.settings.activeGameTimers !== "object") {
    plugin.settings.activeGameTimers = {};
  }
  return norm;
}

function parseExtraProcessNames(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
      .map((x) => (x.endsWith(".exe") ? x : `${x}.exe`));
  }
  const txt = String(raw || "").trim();
  if (!txt) return [];
  return txt
    .split(/[,，;\n\r|]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x.endsWith(".exe") ? x : `${x}.exe`));
}

/* ==================== Steam 全盘与注册表库目录解析 ==================== */

let _cachedSteamLibraries = null;
let _cachedSteamLibrariesAt = 0;

function findSteamLibraryDirs(fsMod, pathMod) {
  if (_cachedSteamLibraries && Date.now() - _cachedSteamLibrariesAt < 120000) {
    return _cachedSteamLibraries;
  }
  const candidates = new Set([
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam"
  ]);

  // 1. Read Windows Registry SteamPath
  if (isWindowsDesktop()) {
    try {
      const cp = tryRequireNode("child_process");
      if (cp && typeof cp.execFileSync === "function") {
        const out = cp.execFileSync(
          "reg.exe",
          ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
          { encoding: "utf8", windowsHide: true, timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }
        );
        const m = String(out || "").match(/SteamPath\s+REG_SZ\s+(.+)/i);
        if (m && m[1]) {
          candidates.add(m[1].trim().replace(/\//g, "\\"));
        }
      }
    } catch (_) {}
  }

  // 2. Probe all available drive letters C..Z for common Steam folders
  for (let code = 67; code <= 90; code++) {
    const drv = `${String.fromCharCode(code)}:\\`;
    try {
      if (!fsMod.existsSync(drv)) continue;
      candidates.add(pathMod.join(drv, "Steam"));
      candidates.add(pathMod.join(drv, "SteamLibrary"));
      candidates.add(pathMod.join(drv, "Games", "Steam"));
      candidates.add(pathMod.join(drv, "Program Files (x86)", "Steam"));
    } catch (_) {}
  }

  const libs = new Set();
  for (const root of candidates) {
    try {
      const saDirect = pathMod.join(root, "steamapps");
      if (fsMod.existsSync(saDirect)) {
        libs.add(saDirect);
      }
      const vdf = pathMod.join(saDirect, "libraryfolders.vdf");
      if (fsMod.existsSync(vdf)) {
        const txt = fsMod.readFileSync(vdf, "utf8");
        const matches = txt.matchAll(/"path"\s+"([^"]+)"/g);
        for (const m of matches) {
          const p = m[1].replace(/\\\\/g, "\\");
          const sa = pathMod.join(p, "steamapps");
          if (fsMod.existsSync(sa)) libs.add(sa);
        }
      }
    } catch (_) {}
  }

  _cachedSteamLibraries = Array.from(libs);
  _cachedSteamLibrariesAt = Date.now();
  return _cachedSteamLibraries;
}

/* ==================== 精准可执行目录与多进程解析（修复 24 上限与误触发） ==================== */

function collectDirectoryExecutables(fsMod, pathMod, dirPath, depth = 0, out = [], ignoredOut = new Set(), maxOut = 128) {
  if (!dirPath || depth > 3 || out.length >= maxOut) return out;
  try {
    const entries = fsMod.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      if (out.length >= maxOut) break;
      const fullPath = pathMod.join(dirPath, ent.name);
      const lower = ent.name.toLowerCase();
      if (ent.isFile() && lower.endsWith(".exe")) {
        if (IGNORED_HELPER_EXES.has(lower) || IGNORED_HELPER_RE.test(lower)) {
          ignoredOut.add(lower);
        } else {
          out.push({ name: lower, fullPath: normalizePathLower(fullPath) });
        }
      } else if (ent.isDirectory() && depth < 3 && !SKIP_SCAN_SUBDIRS_RE.test(ent.name)) {
        collectDirectoryExecutables(fsMod, pathMod, fullPath, depth + 1, out, ignoredOut, maxOut);
      }
    }
  } catch (_) {}
  return out;
}

function resolveInstallRootForExe(pathMod, targetExe, isEmulator) {
  if (!targetExe || isEmulator) return "";
  const dir = pathMod.dirname(targetExe);
  const dirBase = pathMod.basename(dir);
  const parentDir = pathMod.dirname(dir);
  let candidateRoot = dir;

  if (parentDir && parentDir !== dir && SUBFOLDER_LAUNCHER_DIR_RE.test(dirBase)) {
    candidateRoot = parentDir;
    const grandParent = pathMod.dirname(parentDir);
    if (/^(?:binaries|bin|engine)$/i.test(pathMod.basename(parentDir)) && grandParent && grandParent !== parentDir) {
      candidateRoot = grandParent;
    }
  }

  return isSafeGameInstallRoot(candidateRoot) ? `${normalizePathLower(candidateRoot)}\\` : "";
}

function resolveRawGamePathToExeOrSteamDir(fsMod, pathMod, rawPath) {
  const clean = String(rawPath || "").trim();
  if (!clean) return { kind: "none" };

  const resolveSteamAppId = (appId) => {
    const steamLibs = findSteamLibraryDirs(fsMod, pathMod);
    for (const sa of steamLibs) {
      const acf = pathMod.join(sa, `appmanifest_${appId}.acf`);
      if (fsMod.existsSync(acf)) {
        try {
          const acfTxt = fsMod.readFileSync(acf, "utf8");
          const mDir = acfTxt.match(/"installdir"\s+"([^"]+)"/i);
          if (mDir && mDir[1]) {
            const installFull = pathMod.join(sa, "common", mDir[1]);
            if (fsMod.existsSync(installFull)) {
              return { kind: "dir", dirPath: installFull, steamAppId: appId };
            }
          }
        } catch (_) {}
        break;
      }
    }
    return { kind: "steam_unresolved", steamAppId: appId };
  };

  const steamDirect = clean.match(/^steam:\/\/rungameid\/(\d+)/i);
  if (steamDirect) {
    return resolveSteamAppId(steamDirect[1]);
  }

  if (!fsMod.existsSync(clean)) {
    return { kind: "missing", rawPath: clean };
  }

  const ext = pathMod.extname(clean).toLowerCase();
  if (ext === ".exe") {
    return { kind: "exe", exePath: clean };
  }
  if (ext === ".lnk") {
    try {
      const electron = tryRequireNode("electron");
      if (electron?.shell && typeof electron.shell.readShortcutLink === "function") {
        const info = electron.shell.readShortcutLink(clean);
        if (info && info.target && fsMod.existsSync(info.target)) {
          if (pathMod.extname(info.target).toLowerCase() === ".exe") {
            return { kind: "exe", exePath: info.target };
          }
        }
      }
    } catch (_) {}
    return { kind: "shortcut_unresolved", rawPath: clean };
  }
  if (ext === ".url") {
    try {
      const txt = fsMod.readFileSync(clean, "utf8");
      const mUrl = txt.match(/^\s*URL\s*=\s*(.+)$/im);
      const urlStr = mUrl ? mUrl[1].trim() : "";
      const sm = urlStr.match(/^steam:\/\/rungameid\/(\d+)/i);
      if (sm) {
        return resolveSteamAppId(sm[1]);
      }
    } catch (_) {}
    return { kind: "url_unresolved", rawPath: clean };
  }

  return { kind: "other", rawPath: clean };
}

function buildSingleGameWatchDescriptor(fsMod, pathMod, game) {
  if (!game || !game.id) return null;
  const customNames = parseExtraProcessNames(game.extraProcessNames);
  const rawPath = String(game.exePath || "").trim();
  const isEmulator = game.launchMode === "emulator";

  const exactPathsSet = new Set();
  const fallbackNamesSet = new Set();
  const ignoredNamesSet = new Set();
  let installRoot = "";

  if (rawPath && fsMod && pathMod) {
    const resolved = resolveRawGamePathToExeOrSteamDir(fsMod, pathMod, rawPath);
    if (resolved.kind === "exe" && resolved.exePath) {
      const targetLower = normalizePathLower(resolved.exePath);
      const targetBase = pathMod.basename(targetLower);
      installRoot = resolveInstallRootForExe(pathMod, resolved.exePath, isEmulator);

      if (isEmulator) {
        exactPathsSet.add(targetLower);
        if (!GENERIC_STUB_EXE_NAMES.has(targetBase) && !IGNORED_HELPER_EXES.has(targetBase)) {
          fallbackNamesSet.add(targetBase);
        }
      } else {
        const collected = [];
        if (installRoot) {
          collectDirectoryExecutables(fsMod, pathMod, installRoot.replace(/\\+$/, ""), 0, collected, ignoredNamesSet, 128);
        } else {
          exactPathsSet.add(targetLower);
        }

        const nonGenericFound = collected.filter((x) => !GENERIC_STUB_EXE_NAMES.has(x.name));
        for (const item of collected) {
          // If the game folder has real dedicated game exes (e.g. LeagueClient.exe, League of Legends.exe),
          // skip generic stub names like launcher.exe / client.exe so we don't keep counting idle launcher stubs
          if (GENERIC_STUB_EXE_NAMES.has(item.name) && nonGenericFound.length > 0) {
            ignoredNamesSet.add(item.name);
            continue;
          }
          exactPathsSet.add(item.fullPath);
          if (!GENERIC_STUB_EXE_NAMES.has(item.name)) {
            fallbackNamesSet.add(item.name);
          }
        }

        // Always keep user's exact exePath if nothing else was found
        if (exactPathsSet.size === 0) {
          exactPathsSet.add(targetLower);
          if (!GENERIC_STUB_EXE_NAMES.has(targetBase)) {
            fallbackNamesSet.add(targetBase);
          }
        }
      }
    } else if (resolved.kind === "dir" && resolved.dirPath) {
      if (isSafeGameInstallRoot(resolved.dirPath)) {
        installRoot = `${normalizePathLower(resolved.dirPath)}\\`;
      }
      const collected = [];
      collectDirectoryExecutables(fsMod, pathMod, resolved.dirPath, 0, collected, ignoredNamesSet, 128);
      const nonGenericFound = collected.filter((x) => !GENERIC_STUB_EXE_NAMES.has(x.name));
      for (const item of collected) {
        if (GENERIC_STUB_EXE_NAMES.has(item.name) && nonGenericFound.length > 0) {
          ignoredNamesSet.add(item.name);
          continue;
        }
        exactPathsSet.add(item.fullPath);
        if (!GENERIC_STUB_EXE_NAMES.has(item.name)) {
          fallbackNamesSet.add(item.name);
        }
      }
    }
  }

  // Ensure custom names override ignored list
  for (const cn of customNames) {
    ignoredNamesSet.delete(cn);
    fallbackNamesSet.add(cn);
  }

  // Always add baseline ignored names so installRoot prefix match never triggers on helpers
  if (installRoot) {
    IGNORED_HELPER_EXES.forEach((h) => {
      if (!customNames.includes(h)) ignoredNamesSet.add(h);
    });
  }

  const exactPaths = Array.from(exactPathsSet);
  const fallbackNames = Array.from(fallbackNamesSet);
  const ignoredNames = Array.from(ignoredNamesSet);

  if (!installRoot && exactPaths.length === 0 && fallbackNames.length === 0 && customNames.length === 0) {
    return null;
  }

  const primaryLabels = Array.from(
    new Set([
      ...customNames,
      ...fallbackNames,
      ...exactPaths.map((p) => (pathMod ? pathMod.basename(p) : p))
    ])
  ).slice(0, 6);

  return {
    id: String(game.id),
    title: String(game.title || "未命名游戏"),
    installRoot,
    exactPaths,
    fallbackNames,
    customNames,
    ignoredNames,
    displaySummary: primaryLabels.join("、") + (fallbackNames.length > 6 ? ` 等 ${fallbackNames.length} 个` : "")
  };
}

function buildGameWatchDescriptors(plugin, forceRefresh = false) {
  const rt = getTrackerRuntime(plugin);
  const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];
  const sig = games
    .map((g) => `${g?.id || ""}|${g?.exePath || ""}|${g?.launchMode || ""}|${g?.extraProcessNames || ""}`)
    .join(";;");
  if (!forceRefresh && rt.descriptorSig === sig && Array.isArray(rt.descriptors)) {
    return rt.descriptors;
  }

  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const list = [];
  const byId = new Map();
  if (fsMod && pathMod) {
    for (const g of games) {
      const desc = buildSingleGameWatchDescriptor(fsMod, pathMod, g);
      if (desc) {
        list.push(desc);
        byId.set(desc.id, desc);
      }
    }
  }
  rt.descriptorSig = sig;
  rt.descriptors = list;
  rt.descriptorsById = byId;
  return list;
}

function describeGameWatchTargets(plugin, game) {
  if (!isDesktopNodeAvailable() || !game) return null;
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  if (!fsMod || !pathMod) return null;
  return buildSingleGameWatchDescriptor(fsMod, pathMod, game);
}

/* ==================== 共享数据目录与多仓库隔离路径 ==================== */

function getWatcherRootDir() {
  const pathMod = tryRequireNode("path");
  const osMod = tryRequireNode("os");
  if (!pathMod || !osMod) return "";
  const localAppData = (typeof process !== "undefined" && process.env && process.env.LOCALAPPDATA) || "";
  if (localAppData) {
    return pathMod.join(localAppData, "BangumiManager", "playtime-watcher");
  }
  return pathMod.join(osMod.homedir(), ".bangumi-manager", "playtime-watcher");
}

function getVaultBasePath(plugin) {
  try {
    const adapter = plugin?.app?.vault?.adapter;
    if (adapter && typeof adapter.getBasePath === "function") {
      return String(adapter.getBasePath() || "").trim();
    }
  } catch (_) {}
  return "";
}

function computeVaultHash(vaultBasePath) {
  const cryptoMod = tryRequireNode("crypto");
  const norm = normalizePathLower(vaultBasePath || "default-vault");
  if (cryptoMod && typeof cryptoMod.createHash === "function") {
    return cryptoMod.createHash("sha256").update(norm).digest("hex").slice(0, 12);
  }
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function getVaultLedgerPaths(plugin) {
  const pathMod = tryRequireNode("path");
  const root = getWatcherRootDir();
  if (!pathMod || !root) return null;
  const vaultPath = getVaultBasePath(plugin);
  const vaultName = (plugin?.app?.vault && typeof plugin.app.vault.getName === "function" && plugin.app.vault.getName()) || (vaultPath ? pathMod.basename(vaultPath) : "vault");
  const vaultId = computeVaultHash(vaultPath || vaultName);
  const vaultDir = pathMod.join(root, "vaults", vaultId);
  return {
    rootDir: root,
    exePath: pathMod.join(root, WATCHER_EXE_NAME),
    csPath: pathMod.join(root, "bm-game-watcher.cs"),
    versionPath: pathMod.join(root, "watcher-version.txt"),
    heartbeatPath: pathMod.join(root, "watcher-heartbeat.json"),
    stopSignalPath: pathMod.join(root, "stop.signal"),
    vaultId,
    vaultName,
    vaultPath,
    vaultDir,
    configPath: pathMod.join(vaultDir, "watch-config.json"),
    liveStatePath: pathMod.join(vaultDir, "live-state.json"),
    completedPath: pathMod.join(vaultDir, "completed-sessions.jsonl"),
    ackedPath: pathMod.join(vaultDir, "acked-sessions.json")
  };
}

/* ==================== 嵌入式纯 ASCII 原生 Win32 C# 极轻后台守卫源码 ==================== */
/* 编译命令: csc.exe /target:winexe /optimize+ /nologo /r:System.dll /out:bm-game-watcher.exe bm-game-watcher.cs
 * 特性:
 *  - 0 窗口 / 0 控制台 / 0 GPU / 0 显存
 *  - 仅依赖 mscorlib.dll + System.dll（无 System.Web.Extensions / 无外部包），裁减工作集后常驻内存约 3-8 MB
 *  - 单实例 Mutex 防僵尸进程 + 命名 EventWaitHandle 秒级响应配置重载与优雅停机
 *  - 原生 Win32 CreateToolhelp32Snapshot + QueryFullProcessImageNameW + GetProcessTimes（零 tasklist 子进程开销）
 *  - 自动剔除 Windows 睡眠/休眠间隙，支持多游戏并发、15 秒退出防抖、60 秒运行中防断电存档、开机断电自愈
 */
const WATCHER_CS_SOURCE = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace BangumiManagerWatcher {
    internal static class Native {
        public const uint TH32CS_SNAPPROCESS = 0x00000002;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct PROCESSENTRY32W {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct FILETIME {
            public uint dwLowDateTime;
            public uint dwHighDateTime;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetProcessTimes(IntPtr hProcess, out FILETIME lpCreationTime, out FILETIME lpExitTime, out FILETIME lpKernelTime, out FILETIME lpUserTime);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr dwMinimumWorkingSetSize, IntPtr dwMaximumWorkingSetSize);

        public static long FileTimeToUnixMs(FILETIME ft) {
            ulong raw = ((ulong)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
            if (raw <= 116444736000000000UL) return 0;
            return (long)((raw - 116444736000000000UL) / 10000UL);
        }

        public static void TrimMemory() {
            try {
                GC.Collect(GC.MaxGeneration, GCCollectionMode.Optimized, false);
                SetProcessWorkingSetSize(GetCurrentProcess(), new IntPtr(-1), new IntPtr(-1));
            } catch { }
        }
    }

    internal static class MiniJson {
        public static object Parse(string json) {
            if (string.IsNullOrEmpty(json)) return null;
            int idx = 0;
            return ParseValue(json, ref idx);
        }

        private static void SkipWs(string s, ref int i) {
            while (i < s.Length) {
                char c = s[i];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') i++;
                else break;
            }
        }

        private static object ParseValue(string s, ref int i) {
            SkipWs(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{') return ParseObject(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return ParseString(s, ref i);
            if (c == 't' && i + 4 <= s.Length && s.Substring(i, 4) == "true") { i += 4; return true; }
            if (c == 'f' && i + 5 <= s.Length && s.Substring(i, 5) == "false") { i += 5; return false; }
            if (c == 'n' && i + 4 <= s.Length && s.Substring(i, 4) == "null") { i += 4; return null; }
            return ParseNumber(s, ref i);
        }

        private static Dictionary<string, object> ParseObject(string s, ref int i) {
            var dict = new Dictionary<string, object>(StringComparer.Ordinal);
            i++; // '{'
            while (i < s.Length) {
                SkipWs(s, ref i);
                if (i >= s.Length) break;
                if (s[i] == '}') { i++; break; }
                if (s[i] == ',') { i++; continue; }
                string key = ParseString(s, ref i);
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                object val = ParseValue(s, ref i);
                if (key != null) dict[key] = val;
            }
            return dict;
        }

        private static List<object> ParseArray(string s, ref int i) {
            var list = new List<object>();
            i++; // '['
            while (i < s.Length) {
                SkipWs(s, ref i);
                if (i >= s.Length) break;
                if (s[i] == ']') { i++; break; }
                if (s[i] == ',') { i++; continue; }
                list.Add(ParseValue(s, ref i));
            }
            return list;
        }

        private static string ParseString(string s, ref int i) {
            if (i >= s.Length || s[i] != '"') return "";
            i++;
            var sb = new StringBuilder();
            while (i < s.Length) {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length) {
                    char esc = s[i++];
                    switch (esc) {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 <= s.Length) {
                                int code;
                                if (int.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) {
                                    sb.Append((char)code);
                                }
                                i += 4;
                            }
                            break;
                        default: sb.Append(esc); break;
                    }
                } else {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }

        private static object ParseNumber(string s, ref int i) {
            int start = i;
            bool isFloat = false;
            while (i < s.Length) {
                char c = s[i];
                if ((c >= '0' && c <= '9') || c == '-' || c == '+') {
                    i++;
                } else if (c == '.' || c == 'e' || c == 'E') {
                    isFloat = true;
                    i++;
                } else {
                    break;
                }
            }
            string raw = s.Substring(start, i - start);
            if (isFloat) {
                double d;
                if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
                return 0.0;
            }
            long l;
            if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) return l;
            double d2;
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out d2)) return d2;
            return 0L;
        }

        public static string Esc(string s) {
            if (string.IsNullOrEmpty(s)) return "\"\"";
            var sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            for (int i = 0; i < s.Length; i++) {
                char c = s[i];
                switch (c) {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static string GetStr(Dictionary<string, object> d, string k, string defVal = "") {
            object v;
            if (d != null && d.TryGetValue(k, out v) && v != null) return Convert.ToString(v, CultureInfo.InvariantCulture);
            return defVal;
        }

        public static long GetLong(Dictionary<string, object> d, string k, long defVal = 0) {
            object v;
            if (d != null && d.TryGetValue(k, out v) && v != null) {
                try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); } catch { }
            }
            return defVal;
        }

        public static double GetDouble(Dictionary<string, object> d, string k, double defVal = 0.0) {
            object v;
            if (d != null && d.TryGetValue(k, out v) && v != null) {
                try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { }
            }
            return defVal;
        }

        public static List<string> GetStrList(Dictionary<string, object> d, string k) {
            var res = new List<string>();
            object v;
            if (d != null && d.TryGetValue(k, out v) && v is List<object>) {
                foreach (object item in (List<object>)v) {
                    if (item != null) {
                        string s = Convert.ToString(item, CultureInfo.InvariantCulture).Trim().ToLowerInvariant();
                        if (!string.IsNullOrEmpty(s)) res.Add(s);
                    }
                }
            }
            return res;
        }
    }

    internal sealed class ProcSample {
        public uint Pid;
        public string NameLower;
        public string FullPathLower;
        public long StartMs;
    }

    internal sealed class GameTarget {
        public string Id;
        public string Title;
        public string InstallRoot;
        public HashSet<string> ExactPaths = new HashSet<string>(StringComparer.Ordinal);
        public HashSet<string> FallbackNames = new HashSet<string>(StringComparer.Ordinal);
        public HashSet<string> CustomNames = new HashSet<string>(StringComparer.Ordinal);
        public HashSet<string> IgnoredNames = new HashSet<string>(StringComparer.Ordinal);
    }

    internal sealed class ActiveSession {
        public string SessionId;
        public string GameId;
        public string Title;
        public long StartedAtMs;
        public long LastSeenAtMs;
        public long LastCheckpointMs;
        public long MissingSinceMs;
        public double AccumulatedSec;
        public string MatchedExe;
        public string MatchedPath;
        public uint Pid;
    }

    internal sealed class VaultState {
        public string VaultDir;
        public string VaultId;
        public string ConfigPath;
        public string LiveStatePath;
        public string CompletedPath;
        public string AckedPath;
        public DateTime ConfigLastWriteUtc;
        public int PollIntervalMs = 4000;
        public int ExitGraceSeconds = 15;
        public int MinSessionSeconds = 60;
        public List<GameTarget> Games = new List<GameTarget>();
        public Dictionary<string, ActiveSession> Active = new Dictionary<string, ActiveSession>(StringComparer.Ordinal);
        public bool LiveDirty;
    }

    internal static class Program {
        private const string Version = "__WATCHER_VERSION__";
        private const string MutexName = "Local\\BangumiManager_GameWatcher_Mutex_v1";
        private const string StopEventName = "Local\\BangumiManager_GameWatcher_Stop_v1";
        private const string ReloadEventName = "Local\\BangumiManager_GameWatcher_Reload_v1";

        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
        private static readonly HashSet<string> FastSkipSystemProcs = new HashSet<string>(StringComparer.Ordinal) {
            "system", "registry", "idle", "memory compression", "smss.exe", "csrss.exe",
            "wininit.exe", "services.exe", "lsass.exe", "svchost.exe", "fontdrvhost.exe",
            "winlogon.exe", "dwm.exe", "conhost.exe", "sihost.exe", "taskhostw.exe",
            "explorer.exe", "searchhost.exe", "shellexperiencehost.exe", "startmenuexperiencehost.exe",
            "runtimebroker.exe", "ctfmon.exe", "spoolsv.exe", "wmiprvse.exe", "audiodg.exe",
            "msmpeng.exe", "nissrv.exe", "securityhealthservice.exe", "smartscreen.exe",
            "backgroundtaskhost.exe", "applicationframehost.exe", "textinputhost.exe",
            "dllhost.exe", "msiexec.exe", "trustedinstaller.exe", "tiworker.exe",
            "chrome.exe", "msedge.exe", "msedgewebview2.exe", "firefox.exe", "obsidian.exe",
            "bm-game-watcher.exe"
        };

        private static readonly HashSet<string> GenericStubNames = new HashSet<string>(StringComparer.Ordinal) {
            "launcher.exe", "start.exe", "play.exe", "autorun.exe", "client.exe",
            "game.exe", "main.exe", "app.exe", "bootstrap.exe", "loader.exe",
            "runner.exe", "bin.exe", "nw.exe", "electron.exe"
        };

        private static volatile bool _stopRequested = false;
        private static volatile bool _suspendedRecently = false;
        private static EventWaitHandle _stopEvt = null;
        private static EventWaitHandle _reloadEvt = null;
        private static readonly List<VaultState> _vaults = new List<VaultState>();
        private static string _rootDir = "";
        private static long _daemonStartMs = 0;

        private static long NowMs() {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        private static string SafeId(string raw) {
            if (string.IsNullOrEmpty(raw)) return "g";
            var sb = new StringBuilder(raw.Length);
            for (int i = 0; i < raw.Length; i++) {
                char c = raw[i];
                if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') sb.Append(c);
                else sb.Append('_');
            }
            return sb.ToString();
        }

        private static void WriteAtomicText(string path, string content) {
            try {
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                string tmp = path + ".tmp." + Process.GetCurrentProcess().Id;
                File.WriteAllText(tmp, content, Utf8NoBom);
                if (File.Exists(path)) {
                    try {
                        File.Replace(tmp, path, null, true);
                    } catch {
                        File.Copy(tmp, path, true);
                        try { File.Delete(tmp); } catch { }
                    }
                } else {
                    File.Move(tmp, path);
                }
            } catch { }
        }

        private static void AppendLineSafe(string path, string line) {
            for (int attempt = 0; attempt < 3; attempt++) {
                try {
                    string dir = Path.GetDirectoryName(path);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    using (var fs = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    using (var sw = new StreamWriter(fs, Utf8NoBom)) {
                        sw.WriteLine(line);
                    }
                    return;
                } catch {
                    Thread.Sleep(40);
                }
            }
        }

        private static List<ProcSample> TakeProcessSnapshot(HashSet<string> customWhitelist, bool includeAllForOneshot) {
            var list = new List<ProcSample>(128);
            IntPtr hSnap = Native.CreateToolhelp32Snapshot(Native.TH32CS_SNAPPROCESS, 0);
            if (hSnap == IntPtr.Zero || hSnap == Native.INVALID_HANDLE_VALUE) return list;
            try {
                var pe = new Native.PROCESSENTRY32W();
                pe.dwSize = (uint)Marshal.SizeOf(typeof(Native.PROCESSENTRY32W));
                if (!Native.Process32FirstW(hSnap, ref pe)) return list;
                var pathBuf = new StringBuilder(1024);
                long now = NowMs();
                do {
                    string exeLower = (pe.szExeFile ?? "").Trim().ToLowerInvariant();
                    if (string.IsNullOrEmpty(exeLower)) continue;
                    if (!includeAllForOneshot && FastSkipSystemProcs.Contains(exeLower) && (customWhitelist == null || !customWhitelist.Contains(exeLower))) {
                        continue;
                    }
                    var sample = new ProcSample {
                        Pid = pe.th32ProcessID,
                        NameLower = exeLower,
                        FullPathLower = null,
                        StartMs = 0
                    };
                    if (pe.th32ProcessID > 4) {
                        IntPtr hProc = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pe.th32ProcessID);
                        if (hProc != IntPtr.Zero) {
                            try {
                                pathBuf.Length = 0;
                                uint size = (uint)pathBuf.Capacity;
                                if (Native.QueryFullProcessImageNameW(hProc, 0, pathBuf, ref size) && size > 0) {
                                    sample.FullPathLower = pathBuf.ToString(0, (int)size).Replace('/', '\\').ToLowerInvariant();
                                }
                                Native.FILETIME ftCreate, ftExit, ftKernel, ftUser;
                                if (Native.GetProcessTimes(hProc, out ftCreate, out ftExit, out ftKernel, out ftUser)) {
                                    long sMs = Native.FileTimeToUnixMs(ftCreate);
                                    if (sMs >= 1577836800000L && sMs <= now + 60000L) {
                                        sample.StartMs = sMs;
                                    }
                                }
                            } finally {
                                Native.CloseHandle(hProc);
                            }
                        }
                    }
                    list.Add(sample);
                } while (Native.Process32NextW(hSnap, ref pe));
            } finally {
                Native.CloseHandle(hSnap);
            }
            return list;
        }

        private static bool MatchesTarget(GameTarget target, ProcSample proc) {
            if (target.CustomNames.Contains(proc.NameLower)) return true;
            if (target.IgnoredNames.Contains(proc.NameLower)) return false;

            if (!string.IsNullOrEmpty(proc.FullPathLower)) {
                if (target.ExactPaths.Contains(proc.FullPathLower)) return true;
                if (!string.IsNullOrEmpty(target.InstallRoot) && proc.FullPathLower.StartsWith(target.InstallRoot, StringComparison.Ordinal)) {
                    if (!GenericStubNames.Contains(proc.NameLower)) return true;
                }
                return false;
            }

            // Anti-cheat protected process (OpenProcess ACCESS_DENIED): match curated non-generic fallback names
            return target.FallbackNames.Contains(proc.NameLower);
        }

        private static void ReloadAllVaultConfigs() {
            string vaultsRoot = Path.Combine(_rootDir, "vaults");
            if (!Directory.Exists(vaultsRoot)) return;
            var byDir = new Dictionary<string, VaultState>(StringComparer.OrdinalIgnoreCase);
            foreach (var v in _vaults) byDir[v.VaultDir] = v;

            string[] dirs;
            try { dirs = Directory.GetDirectories(vaultsRoot); } catch { return; }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string dir in dirs) {
                string cfgPath = Path.Combine(dir, "watch-config.json");
                if (!File.Exists(cfgPath)) continue;
                seen.Add(dir);
                DateTime mtime = File.GetLastWriteTimeUtc(cfgPath);
                VaultState vs;
                if (byDir.TryGetValue(dir, out vs)) {
                    if (vs.ConfigLastWriteUtc == mtime) continue;
                } else {
                    vs = new VaultState {
                        VaultDir = dir,
                        VaultId = Path.GetFileName(dir),
                        ConfigPath = cfgPath,
                        LiveStatePath = Path.Combine(dir, "live-state.json"),
                        CompletedPath = Path.Combine(dir, "completed-sessions.jsonl"),
                        AckedPath = Path.Combine(dir, "acked-sessions.json")
                    };
                    _vaults.Add(vs);
                    byDir[dir] = vs;
                }

                try {
                    string raw = File.ReadAllText(cfgPath, Utf8NoBom);
                    var root = MiniJson.Parse(raw) as Dictionary<string, object>;
                    if (root == null) continue;
                    vs.ConfigLastWriteUtc = mtime;
                    vs.PollIntervalMs = Math.Max(2000, Math.Min(10000, (int)MiniJson.GetLong(root, "pollIntervalMs", 4000)));
                    vs.ExitGraceSeconds = Math.Max(5, Math.Min(60, (int)MiniJson.GetLong(root, "exitGraceSeconds", 15)));
                    vs.MinSessionSeconds = Math.Max(0, Math.Min(300, (int)MiniJson.GetLong(root, "minSessionSeconds", 60)));

                    var games = new List<GameTarget>();
                    object gObj;
                    if (root.TryGetValue("games", out gObj) && gObj is List<object>) {
                        foreach (object item in (List<object>)gObj) {
                            var gd = item as Dictionary<string, object>;
                            if (gd == null) continue;
                            string id = MiniJson.GetStr(gd, "id", "");
                            if (string.IsNullOrEmpty(id)) continue;
                            var gt = new GameTarget {
                                Id = id,
                                Title = MiniJson.GetStr(gd, "title", ""),
                                InstallRoot = MiniJson.GetStr(gd, "installRoot", "").Replace('/', '\\').ToLowerInvariant()
                            };
                            foreach (string p in MiniJson.GetStrList(gd, "exactPaths")) gt.ExactPaths.Add(p.Replace('/', '\\'));
                            foreach (string n in MiniJson.GetStrList(gd, "fallbackNames")) gt.FallbackNames.Add(n);
                            foreach (string c in MiniJson.GetStrList(gd, "customNames")) gt.CustomNames.Add(c);
                            foreach (string ig in MiniJson.GetStrList(gd, "ignoredNames")) gt.IgnoredNames.Add(ig);
                            games.Add(gt);
                        }
                    }
                    vs.Games = games;
                } catch { }
            }
        }

        private static void RecoverCrashedLiveStates(List<ProcSample> initialProcs) {
            long now = NowMs();
            foreach (var vs in _vaults) {
                if (!File.Exists(vs.LiveStatePath)) continue;
                try {
                    string raw = File.ReadAllText(vs.LiveStatePath, Utf8NoBom);
                    var root = MiniJson.Parse(raw) as Dictionary<string, object>;
                    if (root == null) continue;
                    object actObj;
                    if (!root.TryGetValue("activeSessions", out actObj) || !(actObj is List<object>)) continue;

                    var targetMap = new Dictionary<string, GameTarget>(StringComparer.Ordinal);
                    foreach (var g in vs.Games) targetMap[g.Id] = g;

                    bool recoveredAny = false;
                    foreach (object item in (List<object>)actObj) {
                        var sd = item as Dictionary<string, object>;
                        if (sd == null) continue;
                        string gid = MiniJson.GetStr(sd, "gameId", "");
                        string sid = MiniJson.GetStr(sd, "sessionId", "");
                        long startedAtMs = MiniJson.GetLong(sd, "startedAtMs", 0);
                        long lastSeenAtMs = MiniJson.GetLong(sd, "lastSeenAtMs", 0);
                        double accSec = MiniJson.GetDouble(sd, "accumulatedSec", 0.0);
                        string exe = MiniJson.GetStr(sd, "matchedExe", "");
                        if (string.IsNullOrEmpty(gid) || startedAtMs <= 0 || lastSeenAtMs <= startedAtMs) continue;

                        if (accSec <= 0) accSec = (lastSeenAtMs - startedAtMs) / 1000.0;
                        bool stillRunning = false;
                        GameTarget gt;
                        if (targetMap.TryGetValue(gid, out gt)) {
                            foreach (var p in initialProcs) {
                                if (MatchesTarget(gt, p)) { stillRunning = true; break; }
                            }
                        }

                        if (stillRunning && (now - lastSeenAtMs) < 180000L) {
                            // Seamlessly resume across watcher restart without splitting
                            vs.Active[gid] = new ActiveSession {
                                SessionId = string.IsNullOrEmpty(sid) ? ("bw_" + SafeId(gid) + "_" + (startedAtMs / 1000)) : sid,
                                GameId = gid,
                                Title = gt != null ? gt.Title : MiniJson.GetStr(sd, "title", ""),
                                StartedAtMs = startedAtMs,
                                LastSeenAtMs = now,
                                LastCheckpointMs = now,
                                MissingSinceMs = 0,
                                AccumulatedSec = accSec + Math.Max(0, Math.Min(180, (now - lastSeenAtMs) / 1000.0)),
                                MatchedExe = exe
                            };
                            vs.LiveDirty = true;
                        } else if (accSec >= vs.MinSessionSeconds) {
                            FinalizeAndAppendSession(vs, new ActiveSession {
                                SessionId = string.IsNullOrEmpty(sid) ? ("bw_" + SafeId(gid) + "_" + (startedAtMs / 1000)) : sid,
                                GameId = gid,
                                StartedAtMs = startedAtMs,
                                LastSeenAtMs = lastSeenAtMs,
                                AccumulatedSec = accSec,
                                MatchedExe = exe
                            }, "watcher_recovered");
                            recoveredAny = true;
                        }
                    }
                    if (recoveredAny || vs.Active.Count == 0) {
                        WriteVaultLiveState(vs, now);
                    }
                } catch { }
            }
        }

        private static void FinalizeAndAppendSession(VaultState vs, ActiveSession ses, string sourceTag) {
            long durSec = (long)Math.Round(ses.AccumulatedSec);
            if (durSec < vs.MinSessionSeconds) return;
            long endMs = ses.LastSeenAtMs > ses.StartedAtMs ? ses.LastSeenAtMs : (ses.StartedAtMs + durSec * 1000L);
            var sb = new StringBuilder(256);
            sb.Append("{\"sessionId\":").Append(MiniJson.Esc(ses.SessionId));
            sb.Append(",\"gameId\":").Append(MiniJson.Esc(ses.GameId));
            sb.Append(",\"startedAtMs\":").Append(ses.StartedAtMs);
            sb.Append(",\"endedAtMs\":").Append(endMs);
            sb.Append(",\"durationSec\":").Append(durSec);
            sb.Append(",\"matchedExe\":").Append(MiniJson.Esc(ses.MatchedExe ?? ""));
            sb.Append(",\"source\":").Append(MiniJson.Esc(sourceTag));
            sb.Append('}');
            AppendLineSafe(vs.CompletedPath, sb.ToString());
        }

        private static void WriteVaultLiveState(VaultState vs, long nowMs) {
            var sb = new StringBuilder(512);
            sb.Append("{\"schema\":1,\"watcherVersion\":").Append(MiniJson.Esc(Version));
            sb.Append(",\"updatedAtMs\":").Append(nowMs);
            sb.Append(",\"activeSessions\":[");
            bool first = true;
            foreach (var ses in vs.Active.Values) {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"sessionId\":").Append(MiniJson.Esc(ses.SessionId));
                sb.Append(",\"gameId\":").Append(MiniJson.Esc(ses.GameId));
                sb.Append(",\"title\":").Append(MiniJson.Esc(ses.Title ?? ""));
                sb.Append(",\"startedAtMs\":").Append(ses.StartedAtMs);
                sb.Append(",\"lastSeenAtMs\":").Append(ses.LastSeenAtMs);
                sb.Append(",\"accumulatedSec\":").Append((long)Math.Round(ses.AccumulatedSec));
                sb.Append(",\"matchedExe\":").Append(MiniJson.Esc(ses.MatchedExe ?? ""));
                sb.Append(",\"pid\":").Append(ses.Pid);
                sb.Append('}');
            }
            sb.Append("]}");
            WriteAtomicText(vs.LiveStatePath, sb.ToString());
            vs.LiveDirty = false;
        }

        private static void WriteHeartbeat(long nowMs) {
            int activeTotal = 0;
            foreach (var v in _vaults) activeTotal += v.Active.Count;
            long ws = 0, priv = 0;
            int pid = 0;
            try {
                using (var cur = Process.GetCurrentProcess()) {
                    pid = cur.Id;
                    ws = cur.WorkingSet64;
                    priv = cur.PrivateMemorySize64;
                }
            } catch { }
            var sb = new StringBuilder(256);
            sb.Append("{\"version\":").Append(MiniJson.Esc(Version));
            sb.Append(",\"pid\":").Append(pid);
            sb.Append(",\"startedAtMs\":").Append(_daemonStartMs);
            sb.Append(",\"lastTickAtMs\":").Append(nowMs);
            sb.Append(",\"workingSetBytes\":").Append(ws);
            sb.Append(",\"privateBytes\":").Append(priv);
            sb.Append(",\"vaultCount\":").Append(_vaults.Count);
            sb.Append(",\"activeGameCount\":").Append(activeTotal);
            sb.Append('}');
            WriteAtomicText(Path.Combine(_rootDir, "watcher-heartbeat.json"), sb.ToString());
        }

        private static void CompactAckedCompletedSessions() {
            foreach (var vs in _vaults) {
                if (!File.Exists(vs.CompletedPath) || !File.Exists(vs.AckedPath)) continue;
                try {
                    string ackRaw = File.ReadAllText(vs.AckedPath, Utf8NoBom);
                    var ackObj = MiniJson.Parse(ackRaw) as Dictionary<string, object>;
                    if (ackObj == null) continue;
                    var ackIds = new HashSet<string>(MiniJson.GetStrList(ackObj, "ackedIds"), StringComparer.Ordinal);
                    if (ackIds.Count == 0) continue;

                    string[] lines = File.ReadAllLines(vs.CompletedPath, Utf8NoBom);
                    var kept = new List<string>();
                    int removed = 0;
                    foreach (string line in lines) {
                        string trimmed = (line ?? "").Trim();
                        if (string.IsNullOrEmpty(trimmed)) continue;
                        var parsed = MiniJson.Parse(trimmed) as Dictionary<string, object>;
                        string sid = parsed != null ? MiniJson.GetStr(parsed, "sessionId", "").ToLowerInvariant() : "";
                        if (!string.IsNullOrEmpty(sid) && ackIds.Contains(sid)) {
                            removed++;
                        } else {
                            kept.Add(trimmed);
                        }
                    }
                    if (removed > 0) {
                        WriteAtomicText(vs.CompletedPath, kept.Count > 0 ? (string.Join("\n", kept.ToArray()) + "\n") : "");
                    }
                } catch { }
            }
        }

        private static void FlushAllActiveOnShutdown() {
            long now = NowMs();
            foreach (var vs in _vaults) {
                if (vs.Active.Count == 0) continue;
                foreach (var ses in vs.Active.Values) {
                    FinalizeAndAppendSession(vs, ses, "watcher");
                }
                vs.Active.Clear();
                WriteVaultLiveState(vs, now);
            }
        }

        private static void WriteStdOutUtf8(string text) {
            try {
                byte[] bytes = Utf8NoBom.GetBytes(text ?? "");
                using (var stdout = Console.OpenStandardOutput()) {
                    stdout.Write(bytes, 0, bytes.Length);
                    stdout.Flush();
                }
            } catch { }
        }

        private static void RunOneshotSnapshot() {
            var procs = TakeProcessSnapshot(null, true);
            var sb = new StringBuilder(8192);
            sb.Append('[');
            for (int i = 0; i < procs.Count; i++) {
                if (i > 0) sb.Append(',');
                var p = procs[i];
                sb.Append("{\"pid\":").Append(p.Pid);
                sb.Append(",\"name\":").Append(MiniJson.Esc(p.NameLower));
                sb.Append(",\"path\":").Append(MiniJson.Esc(p.FullPathLower ?? ""));
                sb.Append(",\"startMs\":").Append(p.StartMs);
                sb.Append('}');
            }
            sb.Append(']');
            WriteStdOutUtf8(sb.ToString());
        }

        private static void SignalNamedEvent(string eventName) {
            try {
                using (var ev = EventWaitHandle.OpenExisting(eventName)) {
                    ev.Set();
                }
            } catch { }
        }

        [STAThread]
        public static int Main(string[] args) {
            if (args != null && args.Length > 0) {
                string cmd = args[0].Trim().ToLowerInvariant();
                if (cmd == "--oneshot-snapshot") {
                    RunOneshotSnapshot();
                    return 0;
                }
                if (cmd == "--signal-stop") {
                    SignalNamedEvent(StopEventName);
                    return 0;
                }
                if (cmd == "--signal-reload") {
                    SignalNamedEvent(ReloadEventName);
                    return 0;
                }
                if (cmd == "--version") {
                    WriteStdOutUtf8(Version);
                    return 0;
                }
            }

            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew)) {
                if (!createdNew) return 0;

                _rootDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                _daemonStartMs = NowMs();

                string stopFile = Path.Combine(_rootDir, "stop.signal");
                try { if (File.Exists(stopFile)) File.Delete(stopFile); } catch { }

                _stopEvt = new EventWaitHandle(false, EventResetMode.ManualReset, StopEventName);
                _reloadEvt = new EventWaitHandle(false, EventResetMode.AutoReset, ReloadEventName);
                try { _stopEvt.Reset(); } catch { }

                SystemEvents.SessionEnding += delegate {
                    _stopRequested = true;
                    FlushAllActiveOnShutdown();
                    try { _stopEvt.Set(); } catch { }
                };
                SystemEvents.PowerModeChanged += delegate (object s, PowerModeChangedEventArgs e) {
                    if (e.Mode == PowerModes.Suspend || e.Mode == PowerModes.Resume) {
                        _suspendedRecently = true;
                    }
                };
                AppDomain.CurrentDomain.ProcessExit += delegate {
                    FlushAllActiveOnShutdown();
                };

                ReloadAllVaultConfigs();
                var customWhitelist = CollectCustomWhitelist();
                var initProcs = TakeProcessSnapshot(customWhitelist, false);
                RecoverCrashedLiveStates(initProcs);
                Native.TrimMemory();
                WriteHeartbeat(_daemonStartMs);

                long prevTickMs = NowMs();
                long lastConfigCheckMs = prevTickMs;
                long lastHeartbeatMs = prevTickMs;
                long lastCompactMs = prevTickMs;
                long lastTrimMs = prevTickMs;
                var handles = new WaitHandle[] { _stopEvt, _reloadEvt };

                while (!_stopRequested) {
                    if (File.Exists(stopFile)) {
                        try { File.Delete(stopFile); } catch { }
                        break;
                    }

                    long now = NowMs();
                    int effectivePollMs = 4000;
                    foreach (var v in _vaults) {
                        if (v.PollIntervalMs < effectivePollMs) effectivePollMs = v.PollIntervalMs;
                    }

                    if (now - lastConfigCheckMs >= 12000L) {
                        ReloadAllVaultConfigs();
                        customWhitelist = CollectCustomWhitelist();
                        lastConfigCheckMs = now;
                    }

                    double tickDeltaSec = (now - prevTickMs) / 1000.0;
                    double maxNormalGapSec = Math.Max(60.0, (effectivePollMs / 1000.0) * 8.0);
                    if (_suspendedRecently || tickDeltaSec < 0 || tickDeltaSec > maxNormalGapSec) {
                        tickDeltaSec = 0.0;
                        _suspendedRecently = false;
                    }
                    prevTickMs = now;

                    var procs = TakeProcessSnapshot(customWhitelist, false);
                    bool anyStateChanged = false;

                    foreach (var vs in _vaults) {
                        var activeIdsNow = new HashSet<string>(StringComparer.Ordinal);
                        foreach (var target in vs.Games) {
                            ProcSample bestMatch = null;
                            foreach (var p in procs) {
                                if (MatchesTarget(target, p)) {
                                    if (bestMatch == null) {
                                        bestMatch = p;
                                    } else if (p.StartMs > 0 && (bestMatch.StartMs == 0 || p.StartMs < bestMatch.StartMs)) {
                                        bestMatch = p;
                                    }
                                }
                            }

                            if (bestMatch != null) {
                                activeIdsNow.Add(target.Id);
                                ActiveSession ses;
                                if (!vs.Active.TryGetValue(target.Id, out ses)) {
                                    long realStart = bestMatch.StartMs > 0 && (now - bestMatch.StartMs) <= 12L * 3600L * 1000L
                                        ? bestMatch.StartMs
                                        : now;
                                    double initSec = Math.Max(0.0, (now - realStart) / 1000.0);
                                    ses = new ActiveSession {
                                        SessionId = "bw_" + SafeId(target.Id) + "_" + (realStart / 1000L),
                                        GameId = target.Id,
                                        Title = target.Title,
                                        StartedAtMs = realStart,
                                        LastSeenAtMs = now,
                                        LastCheckpointMs = now,
                                        MissingSinceMs = 0,
                                        AccumulatedSec = initSec,
                                        MatchedExe = bestMatch.NameLower,
                                        MatchedPath = bestMatch.FullPathLower ?? "",
                                        Pid = bestMatch.Pid
                                    };
                                    vs.Active[target.Id] = ses;
                                    vs.LiveDirty = true;
                                    anyStateChanged = true;
                                } else {
                                    ses.AccumulatedSec += tickDeltaSec;
                                    ses.LastSeenAtMs = now;
                                    ses.MissingSinceMs = 0;
                                    ses.MatchedExe = bestMatch.NameLower;
                                    if (!string.IsNullOrEmpty(bestMatch.FullPathLower)) ses.MatchedPath = bestMatch.FullPathLower;
                                    ses.Pid = bestMatch.Pid;
                                    if (now - ses.LastCheckpointMs >= 60000L) {
                                        ses.LastCheckpointMs = now;
                                        vs.LiveDirty = true;
                                    }
                                }
                            }
                        }

                        // Check grace window for vanished games
                        var toFinalize = new List<string>();
                        foreach (var kv in vs.Active) {
                            if (activeIdsNow.Contains(kv.Key)) continue;
                            var ses = kv.Value;
                            if (ses.MissingSinceMs == 0) {
                                ses.MissingSinceMs = now;
                            }
                            if ((now - ses.MissingSinceMs) >= (long)vs.ExitGraceSeconds * 1000L) {
                                toFinalize.Add(kv.Key);
                            }
                        }
                        foreach (string gid in toFinalize) {
                            var ses = vs.Active[gid];
                            vs.Active.Remove(gid);
                            FinalizeAndAppendSession(vs, ses, "watcher");
                            vs.LiveDirty = true;
                            anyStateChanged = true;
                        }

                        if (vs.LiveDirty) {
                            WriteVaultLiveState(vs, now);
                        }
                    }

                    if (anyStateChanged || (now - lastHeartbeatMs) >= 60000L) {
                        WriteHeartbeat(now);
                        lastHeartbeatMs = now;
                    }

                    if (now - lastCompactMs >= 600000L) {
                        CompactAckedCompletedSessions();
                        lastCompactMs = now;
                    }

                    if (now - lastTrimMs >= 600000L) {
                        bool anyRunning = false;
                        foreach (var v in _vaults) if (v.Active.Count > 0) { anyRunning = true; break; }
                        if (!anyRunning) Native.TrimMemory();
                        lastTrimMs = now;
                    }

                    int sigIdx = WaitHandle.WaitAny(handles, effectivePollMs);
                    if (sigIdx == 0) break; // Stop signaled
                    if (sigIdx == 1) {
                        ReloadAllVaultConfigs();
                        customWhitelist = CollectCustomWhitelist();
                        lastConfigCheckMs = NowMs();
                    }
                }

                FlushAllActiveOnShutdown();
                try {
                    string hb = Path.Combine(_rootDir, "watcher-heartbeat.json");
                    if (File.Exists(hb)) File.Delete(hb);
                } catch { }
            }
            return 0;
        }

        private static HashSet<string> CollectCustomWhitelist() {
            var set = new HashSet<string>(StringComparer.Ordinal);
            foreach (var v in _vaults) {
                foreach (var g in v.Games) {
                    foreach (string c in g.CustomNames) set.Add(c);
                    foreach (string f in g.FallbackNames) set.Add(f);
                }
            }
            return set;
        }
    }
}
`;

/* ==================== C# 编译、生命周期控制与 Windows 开机自启 ==================== */

function findDotNetCscPath(fsMod) {
  if (!isWindowsDesktop() || !fsMod) return "";
  const winDir = (typeof process !== "undefined" && process.env && process.env.SystemRoot) || "C:\\Windows";
  const candidates = [
    `${winDir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`,
    `${winDir}\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe`
  ];
  for (const p of candidates) {
    try {
      if (fsMod.existsSync(p)) return p;
    } catch (_) {}
  }
  return "";
}

function readJsonFileSafe(fsMod, filePath) {
  try {
    if (!fsMod || !filePath || !fsMod.existsSync(filePath)) return null;
    const raw = fsMod.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(fsMod, pathMod, filePath, obj) {
  if (!fsMod || !pathMod || !filePath) return false;
  try {
    fsMod.mkdirSync(pathMod.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fsMod.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    try {
      fsMod.renameSync(tmp, filePath);
    } catch (_) {
      fsMod.copyFileSync(tmp, filePath);
      try { fsMod.unlinkSync(tmp); } catch (_2) {}
    }
    return true;
  } catch (_) {
    return false;
  }
}

function isPidAliveWindows(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 4) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    // EPERM means process exists but owned by another context
    return Boolean(err && err.code === "EPERM");
  }
}

function queryWindowsAutoStartEnabled() {
  if (!isWindowsDesktop()) return false;
  const cp = tryRequireNode("child_process");
  if (!cp || typeof cp.execFileSync !== "function") return false;
  try {
    const out = cp.execFileSync(
      "reg.exe",
      ["query", WATCHER_REG_KEY, "/v", WATCHER_REG_VALUE],
      { encoding: "utf8", windowsHide: true, timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }
    );
    return String(out || "").toLowerCase().includes(WATCHER_EXE_NAME.toLowerCase());
  } catch (_) {
    return false;
  }
}

function setWindowsAutoStart(enable, exePath) {
  if (!isWindowsDesktop()) return { ok: false, error: "仅支持 Windows 桌面端" };
  const cp = tryRequireNode("child_process");
  if (!cp || typeof cp.execFileSync !== "function") return { ok: false, error: "缺少系统调用能力" };
  try {
    if (enable) {
      if (!exePath) return { ok: false, error: "守卫程序尚未生成" };
      cp.execFileSync(
        "reg.exe",
        ["add", WATCHER_REG_KEY, "/v", WATCHER_REG_VALUE, "/t", "REG_SZ", "/d", `"${exePath}"`, "/f"],
        { encoding: "utf8", windowsHide: true, timeout: 3000, stdio: ["ignore", "pipe", "pipe"] }
      );
      return { ok: true, enabled: true };
    } else {
      try {
        cp.execFileSync(
          "reg.exe",
          ["delete", WATCHER_REG_KEY, "/v", WATCHER_REG_VALUE, "/f"],
          { encoding: "utf8", windowsHide: true, timeout: 3000, stdio: ["ignore", "pipe", "pipe"] }
        );
      } catch (_) {}
      return { ok: true, enabled: false };
    }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "写入启动项失败" };
  }
}

function getWatcherRuntimeStatus(plugin) {
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  const cfg = ensurePlaytimeTrackerSettings(plugin);
  const supported = isWindowsDesktop();
  const cscPath = supported ? findDotNetCscPath(fsMod) : "";

  if (!supported || !paths || !fsMod) {
    return {
      supported: false,
      compilerAvailable: false,
      installed: false,
      running: false,
      pid: 0,
      version: "",
      workingSetMB: 0,
      privateMB: 0,
      lastTickAtMs: 0,
      autoStartRegistered: false,
      trackedGameCount: 0,
      activeGames: [],
      exePath: ""
    };
  }

  const installed = fsMod.existsSync(paths.exePath);
  const hb = readJsonFileSafe(fsMod, paths.heartbeatPath);
  const hbFresh = Boolean(hb && hb.lastTickAtMs && (Date.now() - Number(hb.lastTickAtMs)) < 150000);
  const pidAlive = Boolean(hb && hb.pid && isPidAliveWindows(hb.pid));
  const running = Boolean(installed && pidAlive && hbFresh);
  const descriptors = buildGameWatchDescriptors(plugin);
  const rt = getTrackerRuntime(plugin);
  const activeGames = Array.from(rt.liveSessions.values()).map((s) => ({
    gameId: s.gameId,
    title: s.title || "",
    startedAtMs: s.startedAtMs,
    elapsedMinutes: Math.max(0, Math.round(getLiveSessionElapsedSeconds(s) / 60)),
    origin: s.origin || "watcher"
  }));

  return {
    supported: true,
    compilerAvailable: Boolean(cscPath),
    installed,
    running,
    pid: running ? Number(hb.pid) : 0,
    version: hb && hb.version ? String(hb.version) : "",
    workingSetMB: running && hb.workingSetBytes ? Number((hb.workingSetBytes / (1024 * 1024)).toFixed(1)) : 0,
    privateMB: running && hb.privateBytes ? Number((hb.privateBytes / (1024 * 1024)).toFixed(1)) : 0,
    lastTickAtMs: hb && hb.lastTickAtMs ? Number(hb.lastTickAtMs) : 0,
    autoStartRegistered: queryWindowsAutoStartEnabled(),
    trackedGameCount: descriptors.length,
    activeGames,
    lastSyncAtMs: rt.lastSyncAtMs || 0,
    exePath: paths.exePath,
    configEnabled: cfg.backgroundWatcherEnabled
  };
}

function signalWatcherSync(exePath, flag, stopSignalPath, fsMod) {
  const cp = tryRequireNode("child_process");
  if (flag === "--signal-stop" && stopSignalPath && fsMod) {
    try {
      fsMod.writeFileSync(stopSignalPath, String(Date.now()), "utf8");
    } catch (_) {}
  }
  if (cp && typeof cp.execFileSync === "function" && exePath && fsMod && fsMod.existsSync(exePath)) {
    try {
      cp.execFileSync(exePath, [flag], { windowsHide: true, timeout: 2500, stdio: "ignore" });
    } catch (_) {}
  }
}

async function stopBackgroundWatcher(plugin, opts = {}) {
  if (!isWindowsDesktop()) return { ok: true };
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  if (!paths || !fsMod) return { ok: false };

  const statusBefore = getWatcherRuntimeStatus(plugin);
  if (statusBefore.running || fsMod.existsSync(paths.heartbeatPath)) {
    signalWatcherSync(paths.exePath, "--signal-stop", paths.stopSignalPath, fsMod);
    // Wait up to 1.8s for graceful flush & exit
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (!statusBefore.pid || !isPidAliveWindows(statusBefore.pid)) break;
    }
    try {
      if (fsMod.existsSync(paths.stopSignalPath)) fsMod.unlinkSync(paths.stopSignalPath);
    } catch (_) {}
  }

  if (opts.removeAutoStart) {
    setWindowsAutoStart(false);
  }
  if (opts.removeBinary) {
    try {
      if (fsMod.existsSync(paths.exePath)) fsMod.unlinkSync(paths.exePath);
      if (fsMod.existsSync(paths.csPath)) fsMod.unlinkSync(paths.csPath);
      if (fsMod.existsSync(paths.versionPath)) fsMod.unlinkSync(paths.versionPath);
      if (fsMod.existsSync(paths.heartbeatPath)) fsMod.unlinkSync(paths.heartbeatPath);
    } catch (_) {}
  }
  return { ok: true };
}

async function ensureWatcherCompiled(plugin, forceRebuild = false) {
  if (!isWindowsDesktop()) return { ok: false, error: "后台守卫仅支持 Windows 桌面端" };
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const cp = tryRequireNode("child_process");
  if (!paths || !fsMod || !pathMod || !cp) return { ok: false, error: "缺少 Node 文件或进程能力" };

  fsMod.mkdirSync(paths.rootDir, { recursive: true });
  const installedVer = fsMod.existsSync(paths.versionPath)
    ? String(fsMod.readFileSync(paths.versionPath, "utf8") || "").trim()
    : "";

  if (!forceRebuild && fsMod.existsSync(paths.exePath) && installedVer === WATCHER_VERSION) {
    return { ok: true, exePath: paths.exePath, rebuilt: false };
  }

  const cscPath = findDotNetCscPath(fsMod);
  if (!cscPath) {
    return { ok: false, error: "未在本机找到 Windows 内置 .NET Framework 编译器 (csc.exe)" };
  }

  // Stop existing watcher before replacing exe binary
  const curStatus = getWatcherRuntimeStatus(plugin);
  if (curStatus.running) {
    await stopBackgroundWatcher(plugin, { removeAutoStart: false, removeBinary: false });
  }

  const sourceCode = WATCHER_CS_SOURCE.replace(/__WATCHER_VERSION__/g, WATCHER_VERSION);
  fsMod.writeFileSync(paths.csPath, sourceCode, "utf8");

  return new Promise((resolve) => {
    cp.execFile(
      cscPath,
      [
        "/nologo",
        "/target:winexe",
        "/optimize+",
        "/r:System.dll",
        `/out:${paths.exePath}`,
        paths.csPath
      ],
      { encoding: "utf8", windowsHide: true, timeout: 25000 },
      (err, stdout, stderr) => {
        if (err || !fsMod.existsSync(paths.exePath)) {
          resolve({
            ok: false,
            error: `本地编译守卫程序失败：${String(stderr || stdout || (err && err.message) || "未知错误").trim().slice(0, 280)}`
          });
          return;
        }
        try {
          fsMod.writeFileSync(paths.versionPath, WATCHER_VERSION, "utf8");
        } catch (_) {}
        resolve({ ok: true, exePath: paths.exePath, rebuilt: true });
      }
    );
  });
}

function writeVaultWatchConfig(plugin, forceRefresh = false) {
  if (!isDesktopNodeAvailable() || isMobileEnv()) return false;
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  if (!paths || !fsMod || !pathMod) return false;

  const cfg = ensurePlaytimeTrackerSettings(plugin);
  const descriptors = buildGameWatchDescriptors(plugin, forceRefresh);
  const payload = {
    schema: 1,
    vaultId: paths.vaultId,
    vaultName: paths.vaultName,
    vaultPath: paths.vaultPath,
    updatedAtMs: Date.now(),
    pollIntervalMs: cfg.pollIntervalMs,
    exitGraceSeconds: cfg.exitGraceSeconds,
    minSessionSeconds: cfg.minSessionSeconds,
    games: descriptors.map((d) => ({
      id: d.id,
      title: d.title,
      installRoot: d.installRoot,
      exactPaths: d.exactPaths,
      fallbackNames: d.fallbackNames,
      customNames: d.customNames,
      ignoredNames: d.ignoredNames
    }))
  };
  const ok = writeJsonAtomic(fsMod, pathMod, paths.configPath, payload);
  if (ok && isWindowsDesktop()) {
    const status = getWatcherRuntimeStatus(plugin);
    if (status.running) {
      signalWatcherSync(paths.exePath, "--signal-reload", null, fsMod);
    }
  }
  return ok;
}

async function startBackgroundWatcher(plugin, opts = {}) {
  if (!isWindowsDesktop()) return { ok: false, error: "后台守卫仅支持 Windows 桌面端" };
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  const cp = tryRequireNode("child_process");
  if (!paths || !fsMod || !cp) return { ok: false, error: "缺少系统调用能力" };

  writeVaultWatchConfig(plugin, true);

  const comp = await ensureWatcherCompiled(plugin, Boolean(opts.forceRebuild));
  if (!comp.ok) return comp;

  const st = getWatcherRuntimeStatus(plugin);
  if (st.running && st.version === WATCHER_VERSION && !opts.forceRestart) {
    signalWatcherSync(paths.exePath, "--signal-reload", null, fsMod);
    if (opts.autoStart !== undefined) {
      setWindowsAutoStart(Boolean(opts.autoStart), paths.exePath);
    }
    return { ok: true, alreadyRunning: true, status: getWatcherRuntimeStatus(plugin) };
  }

  if (st.running) {
    await stopBackgroundWatcher(plugin, { removeAutoStart: false, removeBinary: false });
  }

  try {
    if (fsMod.existsSync(paths.stopSignalPath)) fsMod.unlinkSync(paths.stopSignalPath);
  } catch (_) {}

  try {
    const child = cp.spawn(paths.exePath, [], {
      cwd: paths.rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch (err) {
    return { ok: false, error: `启动后台守卫失败：${err && err.message ? err.message : err}` };
  }

  // Wait briefly for first heartbeat
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 160));
    const cur = getWatcherRuntimeStatus(plugin);
    if (cur.running) {
      if (opts.autoStart !== undefined) {
        setWindowsAutoStart(Boolean(opts.autoStart), paths.exePath);
      }
      return { ok: true, started: true, status: getWatcherRuntimeStatus(plugin) };
    }
  }

  if (opts.autoStart !== undefined) {
    setWindowsAutoStart(Boolean(opts.autoStart), paths.exePath);
  }
  return { ok: true, started: true, status: getWatcherRuntimeStatus(plugin) };
}

/* ==================== 精确时长统计重算、防重合并与增删 ==================== */

function parseTsSafe(raw) {
  if (!raw) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function getSessionDurationMinutesExact(s) {
  if (!s) return 0;
  if (Number.isFinite(Number(s.durationSeconds)) && Number(s.durationSeconds) > 0) {
    return Number(s.durationSeconds) / 60;
  }
  if (s.minutes !== undefined && s.minutes !== null && Number.isFinite(Number(s.minutes))) {
    return Math.max(0, Number(s.minutes));
  }
  if (Number.isFinite(Number(s.durationHours)) && Number(s.durationHours) > 0) {
    return Number(s.durationHours) * 60;
  }
  return 0;
}

/**
 * 统一重算单部游戏的总时长、首次游玩时间与最近游玩时间：
 * - 根治 1 分钟 = 0.02 小时累加导致的舍入漂移
 * - 保留用户明确手填的早期历史遗留时长（legacyPlayMinutes），但不凭空捏造误差时长
 */
function recomputeGamePlaytimeSummary(game, opts = {}) {
  if (!game || typeof game !== "object") return;
  if (!Array.isArray(game.playSessions)) game.playSessions = [];

  // 1. Deduplicate by id / externalSessionId
  const seenIds = new Set();
  const deduped = [];
  for (const s of game.playSessions) {
    if (!s || typeof s !== "object") continue;
    const key = String(s.externalSessionId || s.id || "").trim();
    if (key && seenIds.has(key)) continue;
    if (key) seenIds.add(key);
    deduped.push(s);
  }
  deduped.sort((a, b) => {
    const tb = parseTsSafe(b.endedAt || b.startedAt || b.start || b.date);
    const ta = parseTsSafe(a.endedAt || a.startedAt || a.start || a.date);
    return tb - ta;
  });
  game.playSessions = deduped;

  // 2. Sum exact minutes across sessions
  const sumMinExact = deduped.reduce((acc, s) => acc + getSessionDurationMinutesExact(s), 0);

  // Preserve real untracked legacy hours ONLY if explicitly tracked or significantly (> 3 min) above session sum before mutation
  if (opts.preserveExplicitLegacy && game.legacyPlayMinutes === undefined) {
    const prevScalarMin = (Number(game.playHours) || 0) * 60;
    const oldRoundingSum = deduped.reduce((acc, s) => acc + (Number(s.durationHours) || 0) * 60, 0);
    const diffAboveBoth = prevScalarMin - Math.max(sumMinExact, oldRoundingSum);
    if (diffAboveBoth > 3) {
      game.legacyPlayMinutes = Math.round(diffAboveBoth);
    } else {
      game.legacyPlayMinutes = 0;
    }
  }

  const legacyMin = Math.max(0, Number(game.legacyPlayMinutes) || 0);
  if (opts.explicitTotalHours !== undefined && Number.isFinite(Number(opts.explicitTotalHours))) {
    const targetMin = Math.max(0, Number(opts.explicitTotalHours) * 60);
    game.legacyPlayMinutes = Math.max(0, Math.round(targetMin - sumMinExact));
    game.playHours = Number((Math.max(sumMinExact, targetMin) / 60).toFixed(2));
  } else {
    game.playHours = Number(((sumMinExact + legacyMin) / 60).toFixed(2));
  }

  // 3. Recalculate firstPlayedAt & lastPlayedAt accurately
  let earliest = 0;
  let latest = 0;
  for (const s of deduped) {
    const st = parseTsSafe(s.startedAt || s.start || s.date);
    const en = parseTsSafe(s.endedAt || s.startedAt || s.start || s.date);
    if (st > 0 && (!earliest || st < earliest)) earliest = st;
    if (en > 0 && en > latest) latest = en;
  }
  if (earliest > 0) game.firstPlayedAt = new Date(earliest).toISOString();
  else delete game.firstPlayedAt;

  if (latest > 0) game.lastPlayedAt = new Date(latest).toISOString();
  else delete game.lastPlayedAt;
}

function findOverlappingAutoSession(game, startedAtMs, endedAtMs) {
  if (!game || !Array.isArray(game.playSessions) || !startedAtMs || !endedAtMs) return null;
  const durMs = Math.max(1000, endedAtMs - startedAtMs);
  for (const s of game.playSessions) {
    if (!s) continue;
    const src = String(s.source || s.mode || "auto");
    if (src === "manual") continue;
    const sStart = parseTsSafe(s.startedAt || s.start);
    const sEnd = parseTsSafe(s.endedAt) || (sStart + getSessionDurationMinutesExact(s) * 60000);
    if (!sStart || !sEnd) continue;
    const startDiff = Math.abs(sStart - startedAtMs);
    const overlapStart = Math.max(sStart, startedAtMs);
    const overlapEnd = Math.min(sEnd, endedAtMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);
    const shorter = Math.max(1000, Math.min(durMs, sEnd - sStart));
    if (startDiff <= 45000 || overlapMs / shorter >= 0.6) {
      return s;
    }
  }
  return null;
}

async function commitGamePlaySession(plugin, game, payload, opts = {}) {
  if (!plugin || !game || !payload) return { committed: false };
  if (!Array.isArray(game.playSessions)) game.playSessions = [];

  const now = Date.now();
  const rawDurSec = Number(payload.durationSeconds);
  const startedAtMs = Number(payload.startedAtMs) || parseTsSafe(payload.startedAt) || (now - (rawDurSec > 0 ? rawDurSec * 1000 : 60000));
  const endedAtMs = Number(payload.endedAtMs) || parseTsSafe(payload.endedAt) || now;
  const durationSeconds = Number.isFinite(rawDurSec) && rawDurSec > 0
    ? Math.round(rawDurSec)
    : Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000));

  const source = String(payload.source || payload.mode || "auto");
  const cfg = ensurePlaytimeTrackerSettings(plugin);
  const minSec = opts.ignoreMinThreshold || source === "manual" || source === "timer"
    ? 1
    : Math.max(0, Number(cfg.minSessionSeconds) || 0);
  if (durationSeconds < minSec) {
    return { committed: false, reason: "below_min_threshold" };
  }

  const extId = String(payload.externalSessionId || payload.sessionId || "").trim();
  if (extId && game.playSessions.some((s) => s && (s.externalSessionId === extId || s.id === extId))) {
    return { committed: false, reason: "duplicate_id" };
  }

  // Deduplicate overlapping automatic / watcher / internal sessions
  if (source !== "manual") {
    const overlap = findOverlappingAutoSession(game, startedAtMs, endedAtMs);
    if (overlap) {
      const oldSec = Math.round(getSessionDurationMinutesExact(overlap) * 60);
      if (durationSeconds > oldSec + 30) {
        overlap.startedAt = new Date(Math.min(parseTsSafe(overlap.startedAt || overlap.start) || startedAtMs, startedAtMs)).toISOString();
        overlap.start = overlap.startedAt;
        overlap.endedAt = new Date(Math.max(parseTsSafe(overlap.endedAt) || endedAtMs, endedAtMs)).toISOString();
        overlap.durationSeconds = durationSeconds;
        overlap.minutes = Math.max(1, Math.round(durationSeconds / 60));
        overlap.durationHours = Number((durationSeconds / 3600).toFixed(2));
        if (extId && !overlap.externalSessionId) overlap.externalSessionId = extId;
        recomputeGamePlaytimeSummary(game, { preserveExplicitLegacy: true });
        if (!opts.deferSave) await persistGamePlaytimeChange(plugin, game);
        return { committed: true, merged: true, session: overlap };
      }
      if (extId && !overlap.externalSessionId) overlap.externalSessionId = extId;
      return { committed: false, reason: "duplicate_overlap" };
    }
  }

  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  const durationHours = Number((durationSeconds / 3600).toFixed(2));
  const startIso = new Date(startedAtMs).toISOString();
  const endIso = new Date(endedAtMs).toISOString();

  const entry = {
    id: extId || `ses-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    externalSessionId: extId || undefined,
    start: startIso,
    startedAt: startIso,
    endedAt: endIso,
    durationSeconds,
    minutes,
    durationHours,
    source,
    mode: source === "watcher" || source === "watcher_recovered" ? "watcher" : source,
    note: String(payload.note || "").trim()
  };
  if (!entry.externalSessionId) delete entry.externalSessionId;

  // Preserve any true legacy offset before inserting
  recomputeGamePlaytimeSummary(game, { preserveExplicitLegacy: true });
  game.playSessions.unshift(entry);
  recomputeGamePlaytimeSummary(game, { preserveExplicitLegacy: false });

  if (!opts.deferSave) {
    await persistGamePlaytimeChange(plugin, game);
  }
  return { committed: true, session: entry };
}

async function removeGamePlaySession(plugin, game, sessionId) {
  if (!plugin || !game || !sessionId) return false;
  if (!Array.isArray(game.playSessions)) return false;
  const before = game.playSessions.length;
  // Snapshot any true legacy offset BEFORE removal so deleting a session genuinely reduces total
  recomputeGamePlaytimeSummary(game, { preserveExplicitLegacy: true });
  game.playSessions = game.playSessions.filter((x) => x && x.id !== sessionId);
  if (game.playSessions.length === before) return false;
  recomputeGamePlaytimeSummary(game, { preserveExplicitLegacy: false });
  await persistGamePlaytimeChange(plugin, game);
  return true;
}

async function persistGamePlaytimeChange(plugin, game) {
  if (!plugin || !game) return;
  try {
    const mh = require("./multi-hall-archive-service.js");
    if (typeof mh.syncGameMarkdownNote === "function") {
      await mh.syncGameMarkdownNote(plugin, game);
    }
  } catch (_) {}
  try {
    if (typeof plugin.saveSettings === "function") {
      await plugin.saveSettings();
    }
  } catch (_) {}
}

/* ==================== 实时会话态、账本同步与多游戏监测引擎 ==================== */

function getTrackerRuntime(plugin) {
  if (!plugin._bmGamePlaytimeTrackerRuntime) {
    plugin._bmGamePlaytimeTrackerRuntime = {
      descriptorSig: "",
      descriptors: [],
      descriptorsById: new Map(),
      liveSessions: new Map(), // gameId -> { sessionId, gameId, title, startedAtMs, lastSeenAtMs, accumulatedSec, missingSinceMs, matchedExe, origin }
      pollTimer: null,
      pollingBusy: false,
      prevPollTickMs: 0,
      fsWatcher: null,
      fsWatchDebounce: null,
      windowFocusHandler: null,
      visibilityHandler: null,
      lastSyncAtMs: 0,
      syncBusy: false,
      listeners: new Set(),
      notifiedCapsuleGameIds: new Set(),
      internalLaunchMeta: new Map() // gameId -> { startedAtMs, mode, onSessionEnd }
    };
  }
  return plugin._bmGamePlaytimeTrackerRuntime;
}

function getLiveSessionElapsedSeconds(session, nowMs = Date.now()) {
  if (!session) return 0;
  if (session.origin === "watcher") {
    const baseSec = Number(session.accumulatedSec) || 0;
    const deltaSinceUpdate = session.lastSeenAtMs
      ? Math.max(0, Math.min(120, (nowMs - session.lastSeenAtMs) / 1000))
      : 0;
    return Math.max(0, Math.round(baseSec + deltaSinceUpdate));
  }
  if (Number.isFinite(Number(session.accumulatedSec)) && Number(session.accumulatedSec) > 0) {
    const delta = session.lastSeenAtMs
      ? Math.max(0, Math.min(120, (nowMs - session.lastSeenAtMs) / 1000))
      : 0;
    return Math.max(0, Math.round(Number(session.accumulatedSec) + delta));
  }
  if (session.startedAtMs > 0) {
    return Math.max(0, Math.round((nowMs - session.startedAtMs) / 1000));
  }
  return 0;
}

function getLiveGameSession(plugin, gameId) {
  if (!plugin || !gameId) return null;
  const rt = getTrackerRuntime(plugin);
  const live = rt.liveSessions.get(gameId);
  if (live) {
    const elapsedSeconds = getLiveSessionElapsedSeconds(live);
    return {
      gameId,
      title: live.title || "",
      startedAtMs: live.startedAtMs,
      elapsedSeconds,
      elapsedMinutes: Math.max(0, Math.round(elapsedSeconds / 60)),
      origin: live.origin || "auto",
      matchedExe: live.matchedExe || ""
    };
  }
  // Also reflect persisted manual/mobile/Steam active timers
  const timers = plugin?.settings?.activeGameTimers;
  if (timers && timers[gameId] && timers[gameId].startedAtMs) {
    const st = timers[gameId];
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - Number(st.startedAtMs)) / 1000));
    return {
      gameId,
      title: st.title || "",
      startedAtMs: Number(st.startedAtMs),
      elapsedSeconds,
      elapsedMinutes: Math.max(0, Math.round(elapsedSeconds / 60)),
      origin: "timer",
      matchedExe: ""
    };
  }
  return null;
}

function getAllLiveGameSessions(plugin) {
  const out = new Map();
  if (!plugin) return out;
  const rt = getTrackerRuntime(plugin);
  for (const gid of rt.liveSessions.keys()) {
    const info = getLiveGameSession(plugin, gid);
    if (info) out.set(gid, info);
  }
  const timers = plugin?.settings?.activeGameTimers || {};
  for (const gid of Object.keys(timers)) {
    if (!out.has(gid)) {
      const info = getLiveGameSession(plugin, gid);
      if (info) out.set(gid, info);
    }
  }
  return out;
}

function registerPlaytimeTrackerListener(plugin, fn) {
  if (!plugin || typeof fn !== "function") return () => {};
  const rt = getTrackerRuntime(plugin);
  rt.listeners.add(fn);
  return () => {
    rt.listeners.delete(fn);
  };
}

function emitPlaytimeTrackerUpdate(plugin, eventType, detail = {}) {
  const rt = getTrackerRuntime(plugin);
  for (const fn of Array.from(rt.listeners)) {
    try {
      fn(eventType, detail);
    } catch (_) {}
  }
  try {
    const capSvc = require("./game-floating-capsule-service.js");
    if (capSvc && typeof capSvc.notifyObsidianViewsUpdated === "function") {
      capSvc.notifyObsidianViewsUpdated(plugin, detail.gameId || null, "capsule");
    }
  } catch (_) {}
}

function notifyCapsuleOfLiveGameChanges(plugin, newlyStartedGameIds, newlyStoppedGameIds) {
  if (!plugin || !isDesktopNodeAvailable() || isMobileEnv()) return;
  try {
    const capSvc = require("./game-floating-capsule-service.js");
    if (!capSvc || !capSvc.isDesktopCapsuleSupported()) return;
    const capCfg = capSvc.ensureGameCapsuleSettings(plugin);
    const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];

    const rt = getTrackerRuntime(plugin);
    for (const gid of newlyStartedGameIds) {
      if (!capCfg.enabled) continue;
      if (!rt.internalLaunchMeta.has(gid) && capCfg.autoDetectExternalProcess === false) continue;
      const g = games.find((x) => x && x.id === gid);
      if (!g) continue;
      if (!capSvc.isCapsuleActiveForGame(plugin, gid)) {
        capSvc.activateGameSideCapsule(plugin, g, { source: "external" });
      }
    }

    for (const gid of newlyStoppedGameIds) {
      if (capSvc.isCapsuleActiveForGame(plugin, gid)) {
        // If another game is still running, switch capsule to it; otherwise smoothly retire
        const nextLiveId = Array.from(rt.liveSessions.keys()).find((id) => id !== gid);
        if (nextLiveId && capCfg.enabled) {
          const nextGame = games.find((x) => x && x.id === nextLiveId);
          if (nextGame) {
            capSvc.activateGameSideCapsule(plugin, nextGame, { source: "external" });
            continue;
          }
        }
        capSvc.deactivateGameSideCapsule(plugin, gid);
      }
    }
  } catch (_) {}
}

function formatShortDurationCn(totalSeconds) {
  const mins = Math.max(1, Math.round(totalSeconds / 60));
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

/**
 * 同步后台守卫写入的 completed-sessions.jsonl 与 live-state.json
 * 可在 Obsidian 启动、窗口聚焦、切入游戏典藏、文件变动通知或用户点「立即同步」时触发。
 */
async function syncFromBackgroundLedger(plugin, opts = {}) {
  if (!plugin || !isDesktopNodeAvailable() || isMobileEnv()) {
    return { syncedCount: 0, liveCount: 0 };
  }
  const rt = getTrackerRuntime(plugin);
  if (rt.syncBusy) {
    return { syncedCount: 0, liveCount: rt.liveSessions.size, skippedBusy: true };
  }
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  if (!paths || !fsMod || !pathMod) {
    return { syncedCount: 0, liveCount: 0 };
  }

  rt.syncBusy = true;
  let syncedCount = 0;
  const syncedSummary = [];
  const newlyStarted = [];
  const newlyStopped = [];

  try {
    const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];
    const gamesById = new Map(games.filter(Boolean).map((g) => [g.id, g]));

    // 1. Read completed-sessions.jsonl and merge any unacked sessions idempotently
    const ackDoc = readJsonFileSafe(fsMod, paths.ackedPath) || { ackedIds: [] };
    const ackSet = new Set(Array.isArray(ackDoc.ackedIds) ? ackDoc.ackedIds.map((x) => String(x).toLowerCase()) : []);
    let ackDirty = false;
    const touchedGames = new Set();

    if (fsMod.existsSync(paths.completedPath)) {
      const rawLines = fsMod.readFileSync(paths.completedPath, "utf8").split(/\r?\n/);
      for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        let rec = null;
        try {
          rec = JSON.parse(trimmed);
        } catch (_) {
          continue;
        }
        if (!rec || !rec.gameId) continue;
        const sid = String(rec.sessionId || "").trim();
        const sidLower = sid.toLowerCase();
        if (sidLower && ackSet.has(sidLower)) continue;

        const game = gamesById.get(rec.gameId);
        if (!game) {
          if (sidLower) {
            ackSet.add(sidLower);
            ackDirty = true;
          }
          continue;
        }

        const isRecovered = rec.source === "watcher_recovered";
        const res = await commitGamePlaySession(
          plugin,
          game,
          {
            externalSessionId: sid,
            startedAtMs: Number(rec.startedAtMs) || 0,
            endedAtMs: Number(rec.endedAtMs) || 0,
            durationSeconds: Number(rec.durationSec) || 0,
            source: "watcher",
            mode: "watcher",
            note: isRecovered ? "离线后台守卫异常恢复记录" : "离线后台守卫自动记录",
            matchedExe: rec.matchedExe || ""
          },
          { deferSave: true }
        );

        if (sidLower) {
          ackSet.add(sidLower);
          ackDirty = true;
        }
        if (res.committed) {
          syncedCount += 1;
          touchedGames.add(game);
          syncedSummary.push({
            title: game.title,
            seconds: Number(rec.durationSec) || 0
          });
        }
      }
    }

    if (touchedGames.size > 0) {
      const mh = require("./multi-hall-archive-service.js");
      for (const gm of touchedGames) {
        if (typeof mh.syncGameMarkdownNote === "function") {
          await mh.syncGameMarkdownNote(plugin, gm).catch(() => {});
        }
      }
      if (typeof plugin.saveSettings === "function") {
        await plugin.saveSettings().catch(() => {});
      }
    }

    if (ackDirty) {
      const arr = Array.from(ackSet).slice(-1200);
      writeJsonAtomic(fsMod, pathMod, paths.ackedPath, {
        updatedAtMs: Date.now(),
        ackedIds: arr
      });
    }

    // 2. Read live-state.json (only trust if watcher heartbeat is fresh!)
    const watcherStatus = getWatcherRuntimeStatus(plugin);
    const liveDoc = watcherStatus.running ? readJsonFileSafe(fsMod, paths.liveStatePath) : null;
    const watcherLiveIds = new Set();

    if (liveDoc && Array.isArray(liveDoc.activeSessions)) {
      for (const ls of liveDoc.activeSessions) {
        if (!ls || !ls.gameId) continue;
        const game = gamesById.get(ls.gameId);
        if (!game) continue;
        watcherLiveIds.add(ls.gameId);
        const existed = rt.liveSessions.has(ls.gameId);
        rt.liveSessions.set(ls.gameId, {
          sessionId: ls.sessionId || `bw_${ls.gameId}_${Math.floor((Number(ls.startedAtMs) || Date.now()) / 1000)}`,
          gameId: ls.gameId,
          title: game.title || ls.title || "",
          startedAtMs: Number(ls.startedAtMs) || Date.now(),
          lastSeenAtMs: Number(ls.lastSeenAtMs) || Date.now(),
          accumulatedSec: Number(ls.accumulatedSec) || 0,
          missingSinceMs: 0,
          matchedExe: ls.matchedExe || "",
          origin: "watcher"
        });
        if (!existed) newlyStarted.push(ls.gameId);
      }
    }

    // Remove watcher-origin live sessions that have ended
    for (const [gid, ses] of Array.from(rt.liveSessions.entries())) {
      if (ses.origin === "watcher" && !watcherLiveIds.has(gid)) {
        rt.liveSessions.delete(gid);
        newlyStopped.push(gid);
        // Trigger internal launch callback if any
        const launchMeta = rt.internalLaunchMeta.get(gid);
        if (launchMeta) {
          rt.internalLaunchMeta.delete(gid);
          if (typeof launchMeta.onSessionEnd === "function") {
            try { launchMeta.onSessionEnd(); } catch (_) {}
          }
        }
      }
    }

    rt.lastSyncAtMs = Date.now();

    if (newlyStarted.length > 0 || newlyStopped.length > 0) {
      notifyCapsuleOfLiveGameChanges(plugin, newlyStarted, newlyStopped);
    }

    if (syncedCount > 0 || newlyStarted.length > 0 || newlyStopped.length > 0) {
      emitPlaytimeTrackerUpdate(plugin, "sync", {
        syncedCount,
        liveCount: rt.liveSessions.size
      });
    }

    if (syncedCount > 0 && !opts.silentNotice && Notice) {
      if (syncedSummary.length === 1) {
        new Notice(
          `已自动同步离线游戏时长：《${syncedSummary[0].title}》+${formatShortDurationCn(syncedSummary[0].seconds)}`,
          5000
        );
      } else {
        const totalSec = syncedSummary.reduce((a, x) => a + x.seconds, 0);
        new Notice(
          `已自动同步 ${syncedCount} 条离线游戏记录（合计 +${formatShortDurationCn(totalSec)}）`,
          5000
        );
      }
    }
  } finally {
    rt.syncBusy = false;
  }

  return { syncedCount, liveCount: rt.liveSessions.size };
}

/* ==================== 进程快照查询（无后台守卫时也支持真实启动时间回溯） ==================== */

function queryProcessesRichDesktop(plugin) {
  return new Promise((resolve) => {
    const cp = tryRequireNode("child_process");
    const fsMod = tryRequireNode("fs");
    if (!cp || typeof cp.execFile !== "function") {
      resolve(null);
      return;
    }

    if (isWindowsDesktop()) {
      const paths = getVaultLedgerPaths(plugin);
      // Fast path: if compiled native watcher binary exists, use its --oneshot-snapshot (~35ms, full path + OS StartTime!)
      if (paths && fsMod && fsMod.existsSync(paths.exePath)) {
        cp.execFile(
          paths.exePath,
          ["--oneshot-snapshot"],
          { encoding: "utf8", windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout) => {
            if (!err && stdout) {
              try {
                const parsed = JSON.parse(stdout);
                if (Array.isArray(parsed)) {
                  resolve(parsed);
                  return;
                }
              } catch (_) {}
            }
            fallbackTasklistWin32(cp, resolve);
          }
        );
        return;
      }
      // Fallback: tasklist.exe (zero extra deps, fast; names only)
      fallbackTasklistWin32(cp, resolve);
      return;
    }

    // macOS / Linux fallback
    cp.execFile("ps", ["-A", "-o", "pid=,comm="], { encoding: "utf8", timeout: 3500 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const pathMod = tryRequireNode("path");
      const out = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        const rawComm = m[2].trim();
        out.push({
          pid: Number(m[1]),
          name: (pathMod ? pathMod.basename(rawComm) : rawComm).toLowerCase(),
          path: "",
          startMs: 0
        });
      }
      resolve(out);
    });
  });
}

function fallbackTasklistWin32(cp, resolve) {
  cp.execFile(
    "tasklist.exe",
    ["/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true, timeout: 3500, maxBuffer: 2 * 1024 * 1024 },
    (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const out = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line || line[0] !== '"') continue;
        const endQuote = line.indexOf('"', 1);
        if (endQuote > 1) {
          out.push({
            pid: 0,
            name: line.slice(1, endQuote).toLowerCase(),
            path: "",
            startMs: 0
          });
        }
      }
      resolve(out);
    }
  );
}

function matchDescriptorAgainstProcess(desc, proc) {
  const name = String(proc.name || "").toLowerCase();
  const fullPath = normalizePathLower(proc.path || "");
  if (!name) return false;
  if (desc.customNames && desc.customNames.includes(name)) return true;
  if (desc.ignoredNames && desc.ignoredNames.includes(name)) return false;

  if (fullPath) {
    if (desc.exactPaths && desc.exactPaths.includes(fullPath)) return true;
    if (desc.installRoot && fullPath.startsWith(desc.installRoot) && !GENERIC_STUB_EXE_NAMES.has(name)) {
      return true;
    }
    return false;
  }
  return Boolean(desc.fallbackNames && desc.fallbackNames.includes(name));
}

async function pollInAppGamesOnce(plugin) {
  if (!plugin || !isDesktopNodeAvailable() || isMobileEnv() || plugin.unloaded) return;
  const rt = getTrackerRuntime(plugin);
  if (rt.pollingBusy) return;

  const cfg = ensurePlaytimeTrackerSettings(plugin);
  const watcherStatus = getWatcherRuntimeStatus(plugin);

  // If external Windows background watcher is running & healthy, just keep ledger synced (zero duplicate polling!)
  if (watcherStatus.running) {
    await syncFromBackgroundLedger(plugin, { silentNotice: false });
    return;
  }

  if (!cfg.autoTrackExternalGames && rt.internalLaunchMeta.size === 0) return;

  const descriptors = buildGameWatchDescriptors(plugin);
  if (descriptors.length === 0) return;

  rt.pollingBusy = true;
  try {
    const procs = await queryProcessesRichDesktop(plugin);
    if (!procs) return;

    const now = Date.now();
    let tickDeltaSec = rt.prevPollTickMs > 0 ? (now - rt.prevPollTickMs) / 1000 : 0;
    const maxGap = Math.max(60, (cfg.pollIntervalMs / 1000) * 8);
    if (tickDeltaSec < 0 || tickDeltaSec > maxGap) tickDeltaSec = 0;
    rt.prevPollTickMs = now;

    const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];
    const gamesById = new Map(games.filter(Boolean).map((g) => [g.id, g]));

    const activeNowIds = new Set();
    const newlyStarted = [];
    const newlyStopped = [];

    for (const desc of descriptors) {
      let bestMatch = null;
      for (const p of procs) {
        if (matchDescriptorAgainstProcess(desc, p)) {
          if (!bestMatch || (p.startMs > 0 && (!bestMatch.startMs || p.startMs < bestMatch.startMs))) {
            bestMatch = p;
          }
        }
      }

      if (bestMatch) {
        activeNowIds.add(desc.id);
        let ses = rt.liveSessions.get(desc.id);
        if (!ses) {
          const launchMeta = rt.internalLaunchMeta.get(desc.id);
          const realStart =
            bestMatch.startMs > 0 && (now - bestMatch.startMs) <= 12 * 3600 * 1000
              ? bestMatch.startMs
              : launchMeta && launchMeta.startedAtMs
                ? launchMeta.startedAtMs
                : now;
          ses = {
            sessionId: `inapp_${desc.id}_${Math.floor(realStart / 1000)}`,
            gameId: desc.id,
            title: desc.title,
            startedAtMs: realStart,
            lastSeenAtMs: now,
            accumulatedSec: Math.max(0, (now - realStart) / 1000),
            missingSinceMs: 0,
            matchedExe: bestMatch.name,
            origin: launchMeta ? "internal" : "inapp"
          };
          rt.liveSessions.set(desc.id, ses);
          newlyStarted.push(desc.id);
        } else {
          ses.accumulatedSec += tickDeltaSec;
          ses.lastSeenAtMs = now;
          ses.missingSinceMs = 0;
          ses.matchedExe = bestMatch.name;
        }
      }
    }

    // Check grace window for exited games
    const graceMs = Math.max(5, Number(cfg.exitGraceSeconds) || 15) * 1000;
    for (const [gid, ses] of Array.from(rt.liveSessions.entries())) {
      if (ses.origin === "watcher") continue;
      if (activeNowIds.has(gid)) continue;
      if (!ses.missingSinceMs) {
        ses.missingSinceMs = now;
        continue;
      }
      if (now - ses.missingSinceMs >= graceMs) {
        rt.liveSessions.delete(gid);
        newlyStopped.push(gid);
        const launchMeta = rt.internalLaunchMeta.get(gid);
        if (launchMeta) rt.internalLaunchMeta.delete(gid);

        const game = gamesById.get(gid);
        if (game) {
          const isInternal = ses.origin === "internal";
          const noteLabel =
            launchMeta && launchMeta.mode === "emulator"
              ? "模拟器自动记录"
              : isInternal
                ? ""
                : "桌面快捷方式启动自动记录";
          await commitGamePlaySession(plugin, game, {
            externalSessionId: ses.sessionId,
            startedAtMs: ses.startedAtMs,
            endedAtMs: ses.lastSeenAtMs,
            durationSeconds: Math.round(ses.accumulatedSec),
            source: "auto",
            mode: "auto",
            note: noteLabel,
            matchedExe: ses.matchedExe
          });
        }
        if (launchMeta && typeof launchMeta.onSessionEnd === "function") {
          try { launchMeta.onSessionEnd(); } catch (_) {}
        }
      }
    }

    if (newlyStarted.length > 0 || newlyStopped.length > 0) {
      notifyCapsuleOfLiveGameChanges(plugin, newlyStarted, newlyStopped);
      emitPlaytimeTrackerUpdate(plugin, "inapp_poll", {
        started: newlyStarted,
        stopped: newlyStopped
      });
    }
  } finally {
    rt.pollingBusy = false;
  }
}

/**
 * 供 launchLocalGameProcess 登记插件内启动的游戏，避免与后台守卫双记、并在进程秒退交接时平滑承接
 */
function registerInternalGameLaunch(plugin, game, opts = {}) {
  if (!plugin || !game || !game.id) return { handledByWatcher: false };
  const rt = getTrackerRuntime(plugin);
  const now = Date.now();
  rt.internalLaunchMeta.set(game.id, {
    startedAtMs: opts.startedAtMs || now,
    mode: opts.mode || "exe",
    onSessionEnd: typeof opts.onSessionEnd === "function" ? opts.onSessionEnd : null
  });

  // Immediately push up-to-date watch config so watcher recognizes newly bound games
  writeVaultWatchConfig(plugin, false);
  const watcherStatus = getWatcherRuntimeStatus(plugin);
  if (watcherStatus.running) {
    return { handledByWatcher: true };
  }

  // Ensure in-app poll is alive even if autoTrackExternalGames is off
  ensureTrackerPollLoop(plugin);
  return { handledByWatcher: false };
}

function isBackgroundWatcherRunning(plugin) {
  return Boolean(getWatcherRuntimeStatus(plugin).running);
}

/* ==================== 启动、文件监听、窗口聚焦与卸载防丢落盘 ==================== */

function setupLedgerFsWatcher(plugin) {
  const rt = getTrackerRuntime(plugin);
  if (rt.fsWatcher) {
    try { rt.fsWatcher.close(); } catch (_) {}
    rt.fsWatcher = null;
  }
  if (!isDesktopNodeAvailable() || isMobileEnv()) return;
  const paths = getVaultLedgerPaths(plugin);
  const fsMod = tryRequireNode("fs");
  if (!paths || !fsMod) return;
  try {
    fsMod.mkdirSync(paths.vaultDir, { recursive: true });
    rt.fsWatcher = fsMod.watch(paths.vaultDir, { persistent: false }, (_evType, filename) => {
      const fn = String(filename || "").toLowerCase();
      if (!fn || fn.includes("live-state") || fn.includes("completed-sessions")) {
        if (rt.fsWatchDebounce) clearTimeout(rt.fsWatchDebounce);
        rt.fsWatchDebounce = setTimeout(() => {
          rt.fsWatchDebounce = null;
          if (!plugin.unloaded) {
            syncFromBackgroundLedger(plugin, { silentNotice: false }).catch(() => {});
          }
        }, 420);
      }
    });
    rt.fsWatcher.on("error", () => {});
  } catch (_) {}
}

function ensureTrackerPollLoop(plugin) {
  const rt = getTrackerRuntime(plugin);
  if (rt.pollTimer) return;
  const cfg = ensurePlaytimeTrackerSettings(plugin);
  const intervalMs = Math.max(2500, Number(cfg.pollIntervalMs) || DEFAULT_POLL_MS);
  rt.pollTimer = setInterval(() => {
    pollInAppGamesOnce(plugin).catch(() => {});
  }, intervalMs);
}

async function startPlaytimeTrackerService(plugin) {
  if (!plugin || isMobileEnv() || !isDesktopNodeAvailable()) return;
  const rt = getTrackerRuntime(plugin);
  const cfg = ensurePlaytimeTrackerSettings(plugin);

  // Sync watch-config.json for this vault so an already-installed watcher immediately knows current game list
  writeVaultWatchConfig(plugin, true);

  // If user enabled background watcher in settings, make sure it's compiled, up-to-date and running
  if (isWindowsDesktop() && cfg.backgroundWatcherEnabled) {
    startBackgroundWatcher(plugin, { autoStart: cfg.autoStartWithWindows }).catch(() => {});
  }

  // Immediately pull any offline sessions + currently running games from watcher ledger
  await syncFromBackgroundLedger(plugin, { silentNotice: false }).catch(() => {});

  // Watch vault ledger folder for instant reaction when games start/stop while Obsidian is open
  setupLedgerFsWatcher(plugin);

  // Bind window focus / visibility sync triggers
  if (typeof window !== "undefined" && !rt.windowFocusHandler) {
    rt.windowFocusHandler = () => {
      const c = ensurePlaytimeTrackerSettings(plugin);
      if (c.syncOnWindowFocus && !plugin.unloaded) {
        syncFromBackgroundLedger(plugin, { silentNotice: false }).catch(() => {});
        if (!isBackgroundWatcherRunning(plugin) && c.autoTrackExternalGames) {
          pollInAppGamesOnce(plugin).catch(() => {});
        }
      }
    };
    window.addEventListener("focus", rt.windowFocusHandler);
  }
  if (typeof document !== "undefined" && !rt.visibilityHandler) {
    rt.visibilityHandler = () => {
      if (document.visibilityState === "visible" && !plugin.unloaded) {
        const c = ensurePlaytimeTrackerSettings(plugin);
        if (c.syncOnWindowFocus) {
          syncFromBackgroundLedger(plugin, { silentNotice: false }).catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", rt.visibilityHandler);
  }

  refreshPlaytimeTrackerLifecycle(plugin);

  // On startup, if watcher isn't running, run one immediate in-app check so mid-game launches are caught right away
  if (!isBackgroundWatcherRunning(plugin) && cfg.autoTrackExternalGames) {
    // Opportunistically compile helper if not yet built? No, keep startup zero-overhead unless user enabled watcher!
    setTimeout(() => {
      if (!plugin.unloaded) pollInAppGamesOnce(plugin).catch(() => {});
    }, 900);
  }
}

function refreshPlaytimeTrackerLifecycle(plugin) {
  if (!plugin || isMobileEnv() || !isDesktopNodeAvailable()) return;
  const rt = getTrackerRuntime(plugin);
  const cfg = ensurePlaytimeTrackerSettings(plugin);

  writeVaultWatchConfig(plugin, true);

  if (rt.pollTimer) {
    clearInterval(rt.pollTimer);
    rt.pollTimer = null;
  }

  const watcherRunning = isBackgroundWatcherRunning(plugin);
  if (watcherRunning) {
    // Low-frequency fallback sync heartbeat (fs.watch handles immediate updates)
    rt.pollTimer = setInterval(() => {
      syncFromBackgroundLedger(plugin, { silentNotice: false }).catch(() => {});
    }, 15000);
  } else if (cfg.autoTrackExternalGames || rt.internalLaunchMeta.size > 0) {
    ensureTrackerPollLoop(plugin);
  }
}

/**
 * 插件卸载 / 关闭 Obsidian 时防丢落盘：
 * - 若后台守卫正在运行，无需截断（守卫会无缝继续记录直至游戏真正退出）。
 * - 若未开后台守卫但当前有插件内跟踪中的游戏，立即将已玩时长写入 completed-sessions.jsonl
 *   （避免同步异步冲突，下次打开 Obsidian 立即无损入账！）。
 */
function stopPlaytimeTrackerService(plugin) {
  if (!plugin) return;
  const rt = plugin._bmGamePlaytimeTrackerRuntime;
  if (!rt) return;

  if (rt.pollTimer) {
    clearInterval(rt.pollTimer);
    rt.pollTimer = null;
  }
  if (rt.fsWatchDebounce) {
    clearTimeout(rt.fsWatchDebounce);
    rt.fsWatchDebounce = null;
  }
  if (rt.fsWatcher) {
    try { rt.fsWatcher.close(); } catch (_) {}
    rt.fsWatcher = null;
  }
  if (typeof window !== "undefined" && rt.windowFocusHandler) {
    window.removeEventListener("focus", rt.windowFocusHandler);
    rt.windowFocusHandler = null;
  }
  if (typeof document !== "undefined" && rt.visibilityHandler) {
    document.removeEventListener("visibilitychange", rt.visibilityHandler);
    rt.visibilityHandler = null;
  }

  // Flush any non-watcher active in-app sessions safely into completed-sessions.jsonl so zero time evaporates on close!
  if (isDesktopNodeAvailable() && !isMobileEnv() && !isBackgroundWatcherRunning(plugin)) {
    const paths = getVaultLedgerPaths(plugin);
    const fsMod = tryRequireNode("fs");
    const pathMod = tryRequireNode("path");
    const cfg = ensurePlaytimeTrackerSettings(plugin);
    if (paths && fsMod && pathMod) {
      const now = Date.now();
      for (const ses of rt.liveSessions.values()) {
        if (!ses || ses.origin === "watcher") continue;
        const durSec = getLiveSessionElapsedSeconds(ses, now);
        if (durSec >= Math.max(15, Math.min(cfg.minSessionSeconds, 60))) {
          try {
            fsMod.mkdirSync(pathMod.dirname(paths.completedPath), { recursive: true });
            const line = JSON.stringify({
              sessionId: ses.sessionId,
              gameId: ses.gameId,
              startedAtMs: ses.startedAtMs,
              endedAtMs: now,
              durationSec: durSec,
              matchedExe: ses.matchedExe || "",
              source: "watcher_recovered"
            });
            fsMod.appendFileSync(paths.completedPath, `${line}\n`, "utf8");
          } catch (_) {}
        }
      }
    }
  }

  rt.liveSessions.clear();
  rt.internalLaunchMeta.clear();
}

async function uninstallBackgroundWatcherCompletely(plugin) {
  const cfg = ensurePlaytimeTrackerSettings(plugin);
  cfg.backgroundWatcherEnabled = false;
  cfg.autoStartWithWindows = false;
  await stopBackgroundWatcher(plugin, { removeAutoStart: true, removeBinary: true });
  if (plugin && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
  refreshPlaytimeTrackerLifecycle(plugin);
  emitPlaytimeTrackerUpdate(plugin, "watcher_uninstalled", {});
  return { ok: true };
}

module.exports = {
  WATCHER_VERSION,
  WATCHER_EXE_NAME,
  WATCHER_REG_VALUE,
  DEFAULT_PLAYTIME_TRACKER_SETTINGS,
  IGNORED_HELPER_EXES,
  GENERIC_STUB_EXE_NAMES,
  isWindowsDesktop,
  ensurePlaytimeTrackerSettings,
  parseExtraProcessNames,
  findSteamLibraryDirs,
  buildGameWatchDescriptors,
  describeGameWatchTargets,
  getVaultLedgerPaths,
  getWatcherRuntimeStatus,
  queryWindowsAutoStartEnabled,
  setWindowsAutoStart,
  ensureWatcherCompiled,
  writeVaultWatchConfig,
  startBackgroundWatcher,
  stopBackgroundWatcher,
  uninstallBackgroundWatcherCompletely,
  isBackgroundWatcherRunning,
  recomputeGamePlaytimeSummary,
  commitGamePlaySession,
  removeGamePlaySession,
  getLiveGameSession,
  getAllLiveGameSessions,
  registerPlaytimeTrackerListener,
  registerInternalGameLaunch,
  syncFromBackgroundLedger,
  startPlaytimeTrackerService,
  refreshPlaytimeTrackerLifecycle,
  stopPlaytimeTrackerService
};
