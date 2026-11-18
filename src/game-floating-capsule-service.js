/**
 * 游戏典藏 · 桌面跨屏侧边半透明胶囊与防唤出任务栏悬浮手札服务
 * -------------------------------------------------------------------------
 * 核心能力：
 * 1. 纯插件内置（BRAT 仅下载 main.js + manifest.json 即可运行，无需外部独立安装包），
 *    桌面端基于 Obsidian 内置 @electron/remote.BrowserWindow 创建透明无边框置顶层，移动端自动安全静默。
 * 2. 智能生命周期：平时在 Obsidian 内未运行游戏时不挂载桌面窄条；当从插件内启动收录游戏 / 开启计时，
 *    或后台静默探测到用户直接从桌面快捷方式（.exe / .lnk / Steam .url）启动了已收录游戏时：
 *      - 若馆内正打开该游戏的手札面板，面板播放向屏幕侧边收拢凝结动效并无缝化作桌面侧边胶囊；
 *      - 若馆内未打开手札面板，屏幕旁侧平滑探出胶囊亮显提示（约 2 秒）后优雅退回窄条/全透明态；
 *      - 游戏退出或结束计时后，侧边胶囊平滑收拢退场。支持「预览侧边胶囊」随时调试外观与位置。
 * 3. 六大馆藏外观专属窄条与浮窗材质（跟随 / 暖色纸本 / 封面柔光 / 夜间影院 / 洛琪希手记 / 晴空画集），
 *    支持静默态不透明度（0% 全透明隐形 ～ 100%）与屏幕边缘间距（0px ～ 28px）实时无级调节。
 * 4. 全链路动效与跨多显示器拖拽磁吸：靠近浮起亮显、点击展开为手札浮窗、收拢回弹、跨屏拖拽与松手边缘弹簧吸附。
 * 5. 0ms 内存直连双向镜像同步：草稿输入、新增/编辑/删除手札、勾选/新增待办、攻略链接及进度/时长/评分与馆内实时同步。
 * 6. 全屏游戏防弹任务栏双层保护：非输入态保持 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW + screen-saver 置顶绝不抢焦点；
 *    输入打字态支持征求用户同意后临时自动收起系统任务栏（收起浮窗或退出时 100% 自动还原）。
 */

const { Notice } = require("obsidian");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv,
  toSafeFileUrl
} = require("./platform-env.js");
const { normalizeAppearance } = require("./v07-themes.js");

function readPluginAppearance(plugin) {
  const s = (plugin && plugin.settings) || {};
  let raw = s.archiveAppearance;
  if (!raw && s.archiveVisualTheme && s.archiveVisualTheme !== "obsidian") {
    raw = {
      theme: s.archiveVisualTheme,
      motion: s.archiveDynamicThemeMotion !== false,
      roxyArt: true
    };
  }
  return normalizeAppearance(raw);
}

const WIN_W = 476;
const WIN_H = 608;
const PROCESS_POLL_MS = 4600;

const DEFAULT_GAME_CAPSULE_SETTINGS = {
  enabled: true,
  autoEnabledV2: true,
  autoDetectExternalProcess: true,
  idleOpacity: 42, // 0 ~ 100（支持 0% 全透明隐形）
  edgeMargin: 6, // 0 ~ 28 px
  stripWidth: 6, // 4 ~ 14 px
  stripHeight: 84, // 52 ~ 148 px
  dockSide: "right", // "left" | "right"
  dockRatioY: 0.42, // 0.08 ~ 0.88
  dockDisplayId: null,
  taskbarPolicy: "ask", // "ask" | "auto_hide" | "keep_system"
  taskbarTempApplied: false
};

const IGNORED_HELPER_EXES = new Set([
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "crashreportclient.exe",
  "crashhandler.exe",
  "crashhandler64.exe",
  "bugsplat.exe",
  "bugsplat64.exe",
  "cefsubproc.exe",
  "zfgamebrowser.exe",
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
  "steamerrorreporter64.exe"
]);

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ensureGameCapsuleSettings(plugin) {
  if (!plugin || !plugin.settings) {
    return Object.assign({}, DEFAULT_GAME_CAPSULE_SETTINGS);
  }
  const raw =
    plugin.settings.gameCapsule && typeof plugin.settings.gameCapsule === "object"
      ? plugin.settings.gameCapsule
      : {};
  // v2 默认启用迁移：平时未运行游戏时不挂载桌面窗口；旧存档首次升级自动开启，之后完全尊重用户手动开关
  const migratedEnabled = raw.autoEnabledV2 ? Boolean(raw.enabled) : true;
  const norm = {
    enabled: migratedEnabled,
    autoEnabledV2: true,
    autoDetectExternalProcess: raw.autoDetectExternalProcess !== false,
    idleOpacity: Math.round(clampNum(raw.idleOpacity, 0, 100, DEFAULT_GAME_CAPSULE_SETTINGS.idleOpacity)),
    edgeMargin: Math.round(clampNum(raw.edgeMargin, 0, 28, DEFAULT_GAME_CAPSULE_SETTINGS.edgeMargin)),
    stripWidth: Math.round(clampNum(raw.stripWidth, 4, 14, DEFAULT_GAME_CAPSULE_SETTINGS.stripWidth)),
    stripHeight: Math.round(clampNum(raw.stripHeight, 52, 148, DEFAULT_GAME_CAPSULE_SETTINGS.stripHeight)),
    dockSide: raw.dockSide === "left" ? "left" : "right",
    dockRatioY: clampNum(raw.dockRatioY, 0.08, 0.88, DEFAULT_GAME_CAPSULE_SETTINGS.dockRatioY),
    dockDisplayId: raw.dockDisplayId !== undefined && raw.dockDisplayId !== null ? Number(raw.dockDisplayId) : null,
    taskbarPolicy:
      raw.taskbarPolicy === "auto_hide" || raw.taskbarPolicy === "keep_system" ? raw.taskbarPolicy : "ask",
    taskbarTempApplied: Boolean(raw.taskbarTempApplied)
  };
  plugin.settings.gameCapsule = norm;
  return norm;
}

function getElectronRemote() {
  if (!isDesktopNodeAvailable() || isMobileEnv()) return null;
  try {
    const electron = tryRequireNode("electron");
    const remote = (electron && electron.remote) || tryRequireNode("@electron/remote");
    if (remote && remote.BrowserWindow && remote.screen) {
      return remote;
    }
  } catch (_) {}
  return null;
}

function isDesktopCapsuleSupported() {
  return Boolean(getElectronRemote());
}

/* ==================== Windows 任务栏临时自动隐藏与无损还原守卫 ==================== */

const WIN32_TASKBAR_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BmTaskbarHelper {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct APPBARDATA {
    public int cbSize;
    public IntPtr hWnd;
    public uint uCallbackMessage;
    public uint uEdge;
    public RECT rc;
    public IntPtr lParam;
  }
  [DllImport("shell32.dll")]
  public static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  public static int GetState() {
    IntPtr h = FindWindow("System_TrayWnd", null);
    if (h == IntPtr.Zero) h = FindWindow("Shell_TrayWnd", null);
    if (h == IntPtr.Zero) return -1;
    APPBARDATA abd = new APPBARDATA();
    abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    abd.hWnd = h;
    return (int)SHAppBarMessage(4, ref abd);
  }
  public static int SetAutoHide(bool enable) {
    IntPtr h = FindWindow("System_TrayWnd", null);
    if (h == IntPtr.Zero) h = FindWindow("Shell_TrayWnd", null);
    if (h == IntPtr.Zero) return -1;
    APPBARDATA abd = new APPBARDATA();
    abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    abd.hWnd = h;
    int cur = (int)SHAppBarMessage(4, ref abd);
    int next = enable ? (cur | 1) : (cur & ~1);
    abd.lParam = (IntPtr)next;
    SHAppBarMessage(10, ref abd);
    return cur;
  }
}
"@
`;

function runPowerShellHidden(scriptBody, timeoutMs = 4500) {
  return new Promise((resolve) => {
    if (typeof process === "undefined" || process.platform !== "win32") {
      resolve({ ok: false, stdout: "" });
      return;
    }
    const cp = tryRequireNode("child_process");
    if (!cp || typeof cp.execFile !== "function") {
      resolve({ ok: false, stdout: "" });
      return;
    }
    try {
      const fullScript = `$ProgressPreference = 'SilentlyContinue'\n${scriptBody}`;
      const encoded = Buffer.from(fullScript, "utf16le").toString("base64");
      cp.execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
        { encoding: "utf8", windowsHide: true, timeout: timeoutMs },
        (err, stdout) => {
          resolve({ ok: !err, stdout: String(stdout || "").trim() });
        }
      );
    } catch (_) {
      resolve({ ok: false, stdout: "" });
    }
  });
}

const WIN32_GAME_WIN_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class BmGameWinHelper {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr dpiContext);

  public static string InspectAndRaise(long capHwndVal, string[] procNames) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
    HashSet<int> pidSet = new HashSet<int>();
    if (procNames != null) {
      foreach (string rawName in procNames) {
        if (string.IsNullOrWhiteSpace(rawName)) continue;
        try {
          Process[] arr = Process.GetProcessesByName(rawName);
          foreach (Process p in arr) { pidSet.Add(p.Id); }
        } catch {}
      }
    }
    IntPtr bestHwnd = IntPtr.Zero;
    long bestArea = 0;
    RECT bestRect = new RECT();
    IntPtr fg = GetForegroundWindow();
    bool bestIsFg = false;

    if (pidSet.Count > 0) {
      EnumWindows((hWnd, lParam) => {
        if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);
        if (!pidSet.Contains((int)pid)) return true;
        RECT r;
        if (!GetWindowRect(hWnd, out r)) return true;
        int w = r.Right - r.Left;
        int h = r.Bottom - r.Top;
        if (w < 480 || h < 320) return true;
        long area = (long)w * (long)h;
        bool isFg = (hWnd == fg);
        if ((isFg && !bestIsFg) || (isFg == bestIsFg && area > bestArea)) {
          bestHwnd = hWnd;
          bestArea = area;
          bestRect = r;
          bestIsFg = isFg;
        }
        return true;
      }, IntPtr.Zero);
    }

    if (capHwndVal > 0) {
      try {
        SetWindowPos(new IntPtr(capHwndVal), new IntPtr(-1), 0, 0, 0, 0, 0x0001u | 0x0002u | 0x0010u | 0x0040u);
      } catch {}
    }

    if (bestHwnd == IntPtr.Zero) return "NONE";
    return bestRect.Left + "," + bestRect.Top + "," + bestRect.Right + "," + bestRect.Bottom + "," + (bestIsFg ? "1" : "0");
  }
}
"@
`;

async function applyTempTaskbarAutoHideIfPermitted(plugin) {
  const cfg = ensureGameCapsuleSettings(plugin);
  if (cfg.taskbarPolicy !== "auto_hide") return;
  if (typeof process === "undefined" || process.platform !== "win32") return;
  const rt = getRuntime(plugin);
  if (rt.taskbarSuppressedNow) return;

  const res = await runPowerShellHidden(
    `${WIN32_TASKBAR_PS}\n$cur = [BmTaskbarHelper]::GetState();\nif ($cur -ge 0 -and (($cur -band 1) -eq 0)) { [void][BmTaskbarHelper]::SetAutoHide($true); Write-Output "APPLIED" } else { Write-Output "SKIP" }`
  );
  if (res.ok && res.stdout.includes("APPLIED")) {
    rt.taskbarSuppressedNow = true;
    cfg.taskbarTempApplied = true;
    plugin.saveSettings().catch(() => {});
  }
}

async function restoreTempTaskbarAutoHide(plugin, force = false) {
  const cfg = ensureGameCapsuleSettings(plugin);
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  const needRestore = Boolean((rt && rt.taskbarSuppressedNow) || cfg.taskbarTempApplied || force);
  if (!needRestore) return;
  if (rt) rt.taskbarSuppressedNow = false;
  if (cfg.taskbarTempApplied) {
    cfg.taskbarTempApplied = false;
    if (plugin && typeof plugin.saveSettings === "function") {
      plugin.saveSettings().catch(() => {});
    }
  }
  if (typeof process !== "undefined" && process.platform === "win32") {
    await runPowerShellHidden(`${WIN32_TASKBAR_PS}\n[void][BmTaskbarHelper]::SetAutoHide($false);`);
  }
}

/* ==================== 任务栏防弹出授权询问弹窗 ==================== */

function promptTaskbarPolicyIfNeeded(plugin, onSettled) {
  const cfg = ensureGameCapsuleSettings(plugin);
  if (cfg.taskbarPolicy !== "ask") {
    if (typeof onSettled === "function") onSettled(cfg.taskbarPolicy);
    return;
  }
  const ModalCls = globalThis.__BangumiManagerModal;
  if (!ModalCls || !plugin || !plugin.app) {
    if (typeof onSettled === "function") onSettled("keep_system");
    return;
  }

  class TaskbarConsentModal extends ModalCls {
    constructor(app) {
      super(app);
      this.decided = false;
    }
    onOpen() {
      const { contentEl, modalEl } = this;
      modalEl.addClass("bm-gcap-consent-modal");
      contentEl.empty();
      contentEl.style.maxWidth = "480px";

      contentEl.createEl("h3", {
        text: "全屏游戏展开手札时，是否隐藏底部系统任务栏？"
      });
      const p1 = contentEl.createEl("p", {
        text: "平时侧边胶囊静默贴边、悬停亮显、跨屏拖动，或展开浏览待办与攻略时，窗口采用无焦点置顶模式，不会打断全屏游戏，也不会唤出任务栏。"
      });
      p1.style.fontSize = "13px";
      p1.style.lineHeight = "1.6";
      p1.style.color = "var(--text-normal)";

      const p2 = contentEl.createEl("p", {
        text: "但当你点击输入框准备用输入法打字记手札的那几秒，Windows 系统可能会因焦点切换把底部任务栏顶出来。若你同意，插件会在展开打字期间临时将任务栏设为自动收起，并在收起手札或退出游戏时立即恢复你原本的系统设置。"
      });
      p2.style.fontSize = "13px";
      p2.style.lineHeight = "1.6";
      p2.style.color = "var(--text-muted)";

      const bar = contentEl.createDiv();
      bar.style.display = "flex";
      bar.style.justifyContent = "flex-end";
      bar.style.gap = "8px";
      bar.style.marginTop = "16px";
      bar.style.flexWrap = "wrap";

      const keepBtn = bar.createEl("button", {
        text: "不改动系统设置（允许任务栏浮现）"
      });
      keepBtn.onclick = async () => {
        this.decided = true;
        cfg.taskbarPolicy = "keep_system";
        await plugin.saveSettings();
        this.close();
        if (typeof onSettled === "function") onSettled("keep_system");
      };

      const allowBtn = bar.createEl("button", {
        cls: "mod-cta",
        text: "同意：打字时临时收起任务栏（推荐）"
      });
      allowBtn.onclick = async () => {
        this.decided = true;
        cfg.taskbarPolicy = "auto_hide";
        await plugin.saveSettings();
        this.close();
        if (typeof onSettled === "function") onSettled("auto_hide");
      };
    }
    onClose() {
      this.contentEl.empty();
      if (!this.decided && typeof onSettled === "function") {
        onSettled(cfg.taskbarPolicy);
      }
    }
  }

  new TaskbarConsentModal(plugin.app).open();
}

/* ==================== 本地封面与主题色解析 ==================== */

function resolveCapsuleCoverFileUrl(plugin, rawCover) {
  const raw = String(rawCover || "").trim();
  if (!raw) return "";
  if (/^(?:https?:|data:|file:)/i.test(raw)) return raw;
  const pathMod = tryRequireNode("path");
  const fsMod = tryRequireNode("fs");
  if (!pathMod || !fsMod) return "";
  const clean = raw.replace(/^\[\[|\]\]$/g, "").trim();
  if (fsMod.existsSync(clean)) {
    return toSafeFileUrl(clean);
  }
  try {
    const basePath =
      plugin?.app?.vault?.adapter && typeof plugin.app.vault.adapter.getBasePath === "function"
        ? plugin.app.vault.adapter.getBasePath()
        : "";
    if (basePath) {
      const joined = pathMod.join(basePath, clean);
      if (fsMod.existsSync(joined)) {
        return toSafeFileUrl(joined);
      }
      const f = plugin.app?.metadataCache?.getFirstLinkpathDest?.(clean, "");
      if (f && f.path) {
        const joined2 = pathMod.join(basePath, f.path);
        if (fsMod.existsSync(joined2)) return toSafeFileUrl(joined2);
      }
    }
  } catch (_) {}
  return "";
}

function seedHueFromTitle(title) {
  const s = String(title || "Game");
  let h = 212;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

/* ==================== 快捷方式 / Steam .url -> 可执行进程名缓存解析 ==================== */

function findSteamLibraryDirs(fsMod, pathMod) {
  const candidates = [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    "D:\\Steam",
    "E:\\Steam"
  ];
  const libs = new Set();
  for (const root of candidates) {
    try {
      const vdf = pathMod.join(root, "steamapps", "libraryfolders.vdf");
      if (fsMod.existsSync(vdf)) {
        libs.add(pathMod.join(root, "steamapps"));
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
  return Array.from(libs);
}

function collectFolderGameExes(fsMod, pathMod, dirPath, depth = 0, out = new Set(), maxOut = 24) {
  if (!dirPath || depth > 2 || out.size >= maxOut) return out;
  try {
    const entries = fsMod.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      if (out.size >= maxOut) break;
      const lower = ent.name.toLowerCase();
      if (ent.isFile() && lower.endsWith(".exe") && !IGNORED_HELPER_EXES.has(lower)) {
        out.add(lower);
      } else if (
        ent.isDirectory() &&
        depth < 2 &&
        !/^(?:redist|_commonredist|mono|directx|support|crash|logs|temp|shader)$/i.test(ent.name)
      ) {
        collectFolderGameExes(fsMod, pathMod, pathMod.join(dirPath, ent.name), depth + 1, out, maxOut);
      }
    }
  } catch (_) {}
  return out;
}

const SUBFOLDER_LAUNCHER_DIR_RE = /^(?:launcher|wegamelauncher|bin|binaries|win64|win32|x64|x86|game|client)$/i;
const GENERIC_STUB_EXE_NAMES = new Set(["launcher.exe", "start.exe", "play.exe", "autorun.exe"]);

function scanExecutableNeighborhood(fsMod, pathMod, targetExe, allowSiblings = true) {
  const found = new Set();
  if (!targetExe || !pathMod) return found;
  const base = pathMod.basename(targetExe).toLowerCase();
  if (base.endsWith(".exe") && !IGNORED_HELPER_EXES.has(base)) {
    found.add(base);
  }
  if (!allowSiblings || !fsMod) return found;
  const dir = pathMod.dirname(targetExe);
  collectFolderGameExes(fsMod, pathMod, dir, 0, found, 24);
  const dirBase = pathMod.basename(dir);
  const parentDir = pathMod.dirname(dir);
  if (parentDir && parentDir !== dir) {
    if (SUBFOLDER_LAUNCHER_DIR_RE.test(dirBase)) {
      collectFolderGameExes(fsMod, pathMod, parentDir, 0, found, 24);
      const grandParent = pathMod.dirname(parentDir);
      if (/^(?:binaries)$/i.test(pathMod.basename(parentDir)) && grandParent && grandParent !== parentDir) {
        collectFolderGameExes(fsMod, pathMod, grandParent, 0, found, 24);
      }
    }
  }
  return found;
}

function buildTrackableExeMap(plugin) {
  const rt = getRuntime(plugin);
  const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];
  const sig = games.map((g) => `${g?.id || ""}:${g?.exePath || ""}:${g?.romPath || ""}`).join("|");
  if (rt.exeMapSig === sig && rt.exeMap) return rt.exeMap;

  const map = new Map(); // exeLower -> game
  const byGameId = new Map(); // gameId -> Set<exeLower>
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const electron = tryRequireNode("electron");
  if (!fsMod || !pathMod) {
    rt.exeMapSig = sig;
    rt.exeMap = map;
    rt.exeSetByGame = byGameId;
    return map;
  }

  const addForGame = (g, exeSet) => {
    if (!g || !g.id || !exeSet) return;
    if (!byGameId.has(g.id)) byGameId.set(g.id, new Set());
    const bucket = byGameId.get(g.id);
    exeSet.forEach((exeName) => {
      bucket.add(exeName);
      // 避免通用的 launcher.exe 在外部静默扫描时误抢其他游戏，但有明确游戏名 exe 时优先绑定
      if (!map.has(exeName) && (!GENERIC_STUB_EXE_NAMES.has(exeName) || exeSet.size === 1)) {
        map.set(exeName, g);
      }
    });
  };

  let steamLibs = null;
  for (const g of games) {
    if (!g || !g.id) continue;
    const rawPath = String(g.exePath || "").trim();
    if (!rawPath) continue;

    const registerDirOrExe = (targetExe) => {
      if (!targetExe) return;
      const exeSet = scanExecutableNeighborhood(fsMod, pathMod, targetExe, g.launchMode !== "emulator");
      addForGame(g, exeSet);
    };

    const steamMatch = rawPath.match(/^steam:\/\/rungameid\/(\d+)/i);
    if (steamMatch) {
      const appId = steamMatch[1];
      if (!steamLibs) steamLibs = findSteamLibraryDirs(fsMod, pathMod);
      for (const sa of steamLibs) {
        const acf = pathMod.join(sa, `appmanifest_${appId}.acf`);
        if (fsMod.existsSync(acf)) {
          try {
            const acfTxt = fsMod.readFileSync(acf, "utf8");
            const mDir = acfTxt.match(/"installdir"\s+"([^"]+)"/i);
            if (mDir && mDir[1]) {
              const installFull = pathMod.join(sa, "common", mDir[1]);
              const exes = collectFolderGameExes(fsMod, pathMod, installFull, 0, new Set(), 24);
              addForGame(g, exes);
            }
          } catch (_) {}
          break;
        }
      }
      continue;
    }

    if (!fsMod.existsSync(rawPath)) continue;
    const ext = pathMod.extname(rawPath).toLowerCase();
    if (ext === ".exe") {
      registerDirOrExe(rawPath);
    } else if (ext === ".lnk") {
      try {
        if (electron?.shell && typeof electron.shell.readShortcutLink === "function") {
          const info = electron.shell.readShortcutLink(rawPath);
          if (info && info.target) registerDirOrExe(info.target);
        }
      } catch (_) {}
    } else if (ext === ".url") {
      try {
        const txt = fsMod.readFileSync(rawPath, "utf8");
        const mUrl = txt.match(/^\s*URL\s*=\s*(.+)$/im);
        const urlStr = mUrl ? mUrl[1].trim() : "";
        const sm = urlStr.match(/^steam:\/\/rungameid\/(\d+)/i);
        if (sm) {
          if (!steamLibs) steamLibs = findSteamLibraryDirs(fsMod, pathMod);
          for (const sa of steamLibs) {
            const acf = pathMod.join(sa, `appmanifest_${sm[1]}.acf`);
            if (fsMod.existsSync(acf)) {
              const acfTxt = fsMod.readFileSync(acf, "utf8");
              const mDir = acfTxt.match(/"installdir"\s+"([^"]+)"/i);
              if (mDir && mDir[1]) {
                const installFull = pathMod.join(sa, "common", mDir[1]);
                const exes = collectFolderGameExes(fsMod, pathMod, installFull, 0, new Set(), 24);
                addForGame(g, exes);
              }
              break;
            }
          }
        }
      } catch (_) {}
    }
  }

  rt.exeMapSig = sig;
  rt.exeMap = map;
  rt.exeSetByGame = byGameId;
  return map;
}

function collectCandidateExesForGame(plugin, game, extraExePath = "") {
  const out = new Set();
  if (!plugin || !game) return out;
  buildTrackableExeMap(plugin);
  const rt = getRuntime(plugin);
  const cached = rt.exeSetByGame && rt.exeSetByGame.get(game.id);
  if (cached) {
    cached.forEach((x) => out.add(x));
  }
  if (extraExePath) {
    const fsMod = tryRequireNode("fs");
    const pathMod = tryRequireNode("path");
    const extra = scanExecutableNeighborhood(fsMod, pathMod, extraExePath, game.launchMode !== "emulator");
    extra.forEach((x) => out.add(x));
  }
  return out;
}

function queryRunningProcessNamesWin32() {
  return new Promise((resolve) => {
    const cp = tryRequireNode("child_process");
    if (!cp || typeof cp.execFile !== "function") {
      resolve(null);
      return;
    }
    if (typeof process !== "undefined" && process.platform === "win32") {
      cp.execFile(
        "tasklist.exe",
        ["/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true, timeout: 3500, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve(null);
            return;
          }
          const set = new Set();
          const lines = stdout.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || line[0] !== '"') continue;
            const endQuote = line.indexOf('"', 1);
            if (endQuote > 1) {
              set.add(line.slice(1, endQuote).toLowerCase());
            }
          }
          resolve(set);
        }
      );
    } else {
      cp.execFile("ps", ["-A", "-o", "comm="], { encoding: "utf8", timeout: 3500 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        const pathMod = tryRequireNode("path");
        const set = new Set();
        stdout.split(/\r?\n/).forEach((l) => {
          const t = l.trim();
          if (t) set.add((pathMod ? pathMod.basename(t) : t).toLowerCase());
        });
        resolve(set);
      });
    }
  });
}

/* ==================== 运行时状态机与馆内连接器 ==================== */

function getRuntime(plugin) {
  if (!plugin._bmGameCapsuleRuntime) {
    plugin._bmGameCapsuleRuntime = {
      win: null,
      winReady: false,
      concealed: false,
      retiring: false,
      retireTimer: null,
      pendingSyncPayload: null,
      activeGameId: null,
      activeSource: "", // "internal" | "external" | "preview"
      externalSessionStartMs: 0,
      externalMatchedExe: "",
      adoptedSession: null, // { gameId, candidateExes, finalizeSession }
      protocolWatch: null, // { gameId, candidateExes, expiresAtMs, seenRunning }
      expanded: false,
      pinned: false,
      focusOwnedNow: false,
      dragging: false,
      userDraggedThisSession: false,
      hoverAwake: false,
      greetingActive: false,
      greetingClearTimer: null,
      hostPassThrough: true,
      cursorTimer: null,
      zOrderBurstTimers: [],
      lastZOrderTickMs: 0,
      inModalListeners: new Map(), // gameId -> { syncFromExternal, collapseToEdge }
      stageRefreshListeners: new Set(),
      pollTimer: null,
      pollingBusy: false,
      snapAnimTimer: null,
      dragBaseCursor: null,
      dragBaseWinPos: null,
      exeMapSig: "",
      exeMap: null,
      exeSetByGame: null,
      taskbarSuppressedNow: false,
      hostHtmlPath: ""
    };
  }
  return plugin._bmGameCapsuleRuntime;
}

function registerOpenJournalModalHook(plugin, gameId, hooks) {
  if (!plugin || !gameId) return () => {};
  const rt = getRuntime(plugin);
  rt.inModalListeners.set(gameId, hooks);
  return () => {
    if (rt.inModalListeners.get(gameId) === hooks) {
      rt.inModalListeners.delete(gameId);
    }
  };
}

function registerGameStageRefreshHook(plugin, fn) {
  if (!plugin || typeof fn !== "function") return () => {};
  const rt = getRuntime(plugin);
  rt.stageRefreshListeners.add(fn);
  return () => {
    rt.stageRefreshListeners.delete(fn);
  };
}

function notifyObsidianViewsUpdated(plugin, gameId, origin = "capsule") {
  if (!plugin) return;
  const rt = getRuntime(plugin);
  if (origin === "capsule" && gameId) {
    const modalHook = rt.inModalListeners.get(gameId);
    if (modalHook && typeof modalHook.syncFromExternal === "function") {
      try {
        modalHook.syncFromExternal();
      } catch (_) {}
    }
  }
  if (origin === "capsule") {
    for (const refreshFn of Array.from(rt.stageRefreshListeners)) {
      try {
        refreshFn();
      } catch (_) {}
    }
  }
  if (origin === "obsidian") {
    broadcastToCapsuleWindow(plugin);
  }
}

/* ==================== 显示器几何计算与跨屏弹簧吸附 ==================== */

function resolveTargetDisplay(remote, cfg) {
  const displays = remote.screen.getAllDisplays();
  if (cfg.dockDisplayId !== null) {
    const matched = displays.find((d) => d.id === cfg.dockDisplayId);
    if (matched) return matched;
  }
  try {
    const curWin = remote.getCurrentWindow && remote.getCurrentWindow();
    if (curWin && !curWin.isDestroyed()) {
      const b = curWin.getBounds();
      return remote.screen.getDisplayNearestPoint({
        x: Math.round(b.x + b.width / 2),
        y: Math.round(b.y + b.height / 2)
      });
    }
  } catch (_) {}
  return remote.screen.getPrimaryDisplay();
}

function computeDockedWindowRect(display, cfg) {
  const b = display.bounds;
  const w = Math.min(WIN_W, Math.max(340, b.width - 16));
  const h = Math.min(WIN_H, Math.max(420, b.height - 24));
  const x = cfg.dockSide === "left" ? b.x : b.x + b.width - w;
  const centerY = b.y + Math.round(b.height * clampNum(cfg.dockRatioY, 0.08, 0.88, 0.42));
  const minY = b.y + 8;
  const maxY = Math.max(minY, b.y + b.height - h - 8);
  const y = Math.max(minY, Math.min(maxY, Math.round(centerY - h / 2)));
  return { x, y, width: w, height: h };
}

function animateWindowToPosition(rt, targetX, targetY, durationMs = 280, onDone) {
  if (!rt.win || rt.win.isDestroyed()) {
    if (typeof onDone === "function") onDone();
    return;
  }
  if (rt.snapAnimTimer) {
    clearInterval(rt.snapAnimTimer);
    rt.snapAnimTimer = null;
  }
  const [startX, startY] = rt.win.getPosition();
  const dx = targetX - startX;
  const dy = targetY - startY;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    rt.win.setPosition(Math.round(targetX), Math.round(targetY));
    if (typeof onDone === "function") onDone();
    return;
  }
  const t0 = Date.now();
  // 带微弱物理吸附弹性的平滑阻尼曲线
  const easeOutBackSoft = (t) => {
    const c1 = 1.18;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  rt.snapAnimTimer = setInterval(() => {
    if (!rt.win || rt.win.isDestroyed()) {
      clearInterval(rt.snapAnimTimer);
      rt.snapAnimTimer = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / durationMs);
    const e = p >= 1 ? 1 : easeOutBackSoft(p);
    const nx = Math.round(startX + dx * e);
    const ny = Math.round(startY + dy * e);
    try {
      rt.win.setPosition(nx, ny);
    } catch (_) {}
    if (p >= 1) {
      clearInterval(rt.snapAnimTimer);
      rt.snapAnimTimer = null;
      try {
        rt.win.setPosition(Math.round(targetX), Math.round(targetY));
      } catch (_) {}
      if (typeof onDone === "function") onDone();
    }
  }, 14);
}

/* ==================== 悬浮窗载荷序列化 ==================== */

function findGameForCapsule(plugin, preferredGameId = null) {
  const games = Array.isArray(plugin?.settings?.gameCollection) ? plugin.settings.gameCollection : [];
  if (preferredGameId) {
    const hit = games.find((g) => g && g.id === preferredGameId);
    if (hit) return hit;
  }
  if (games.length > 0) {
    return games[0];
  }
  return null;
}

function buildCapsuleStatePayload(plugin, extra = {}) {
  const rt = getRuntime(plugin);
  const cfg = ensureGameCapsuleSettings(plugin);
  const appearance = readPluginAppearance(plugin);
  const isDark =
    typeof document !== "undefined" && document.body
      ? document.body.classList.contains("theme-dark")
      : false;
  const game = findGameForCapsule(plugin, rt.activeGameId);
  const ui = plugin.__gameJournalUi || (plugin.__gameJournalUi = { tabByGame: {}, drafts: {}, showDone: false });

  let gameDto = null;
  if (game) {
    gameDto = {
      id: game.id,
      title: game.title || "未命名游戏",
      developer: game.developer || "",
      status: game.status || "在玩",
      currentProgress: game.currentProgress || "",
      playHours: Math.round((Number(game.playHours) || 0) * 100) / 100,
      score: game.score !== undefined && game.score !== null && game.score !== "" ? Number(game.score) : "",
      coverFileUrl: resolveCapsuleCoverFileUrl(plugin, game.coverUrl),
      hue: seedHueFromTitle(game.title),
      draft: String(ui.drafts?.[game.id] || ""),
      activeTab: ui.tabByGame?.[game.id] || "notes",
      showDone: Boolean(ui.showDone),
      playNotes: Array.isArray(game.playNotes) ? game.playNotes.slice(0, 60) : [],
      todos: Array.isArray(game.todos) ? game.todos.slice(0, 80) : [],
      strategyUrls: Array.isArray(game.strategyUrls) ? game.strategyUrls.slice(0, 50) : []
    };
  } else {
    gameDto = {
      id: "__preview_placeholder__",
      title: "示例游戏 · 侧边手札预览",
      developer: "收录游戏后将自动关联对应笔记",
      status: "在玩",
      currentProgress: "序章",
      playHours: 1.5,
      score: 9,
      coverFileUrl: "",
      hue: 208,
      draft: "",
      activeTab: "notes",
      showDone: false,
      playNotes: [
        {
          id: "sample-1",
          text: "在游戏运行时，把鼠标移到屏幕边缘即可唤起这枚胶囊，点开随时记录剧情想法、勾选待办或查看攻略。",
          chapter: "序章",
          hoursAtNote: 1.5,
          createdAt: new Date().toISOString()
        }
      ],
      todos: [{ id: "sample-td-1", text: "试试拖动顶栏把胶囊吸附到屏幕左侧或其他显示器", done: false }],
      strategyUrls: []
    };
  }

  return Object.assign(
    {
      capsule: cfg,
      appearance: {
        theme: appearance.theme || "follow",
        celFx: appearance.celFx || "prism",
        motionLevel: appearance.motionLevel || "full",
        isDark
      },
      runtime: {
        expanded: Boolean(rt.expanded),
        pinned: Boolean(rt.pinned),
        isPreview: rt.activeSource === "preview",
        concealed: Boolean(rt.concealed)
      },
      game: gameDto
    },
    extra
  );
}

function broadcastToCapsuleWindow(plugin, extra = {}) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt || !rt.win || rt.win.isDestroyed()) return;
  const payload = buildCapsuleStatePayload(plugin, extra);
  if (!rt.winReady) {
    rt.pendingSyncPayload = payload;
    return;
  }
  try {
    rt.win.webContents.send("bm-host-state", payload);
  } catch (_) {}
}

/* ==================== 悬浮窗独立 HTML 构建器（6 主题定制 + 全链路丝滑动效） ==================== */

function ensureCapsuleHostHtmlFile(plugin) {
  const rt = getRuntime(plugin);
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const osMod = tryRequireNode("os");
  if (!fsMod || !pathMod || !osMod) return "";

  const dir = pathMod.join(osMod.tmpdir(), "bangumi-manager-game-capsule");
  fsMod.mkdirSync(dir, { recursive: true });
  const filePath = pathMod.join(dir, "capsule-overlay-v2.html");
  fsMod.writeFileSync(filePath, CAPSULE_WINDOW_HTML, "utf8");
  rt.hostHtmlPath = filePath;
  return filePath;
}

const CAPSULE_WINDOW_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>游戏侧边手札</title>
<style>
  :root {
    --cap-bg: rgba(250, 250, 252, 0.94);
    --cap-bg-2: rgba(240, 242, 247, 0.92);
    --cap-ink: #1e222b;
    --cap-ink-2: #525968;
    --cap-ink-3: #848d9f;
    --cap-line: rgba(30, 36, 50, 0.11);
    --cap-accent: #4c6ef5;
    --cap-accent-soft: rgba(76, 110, 245, 0.13);
    --cap-strip-bg: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(226,232,248,0.84));
    --cap-strip-border: rgba(76, 110, 245, 0.42);
    --cap-strip-core: #4c6ef5;
    --cap-shadow: 0 18px 44px rgba(12, 18, 32, 0.24), 0 2px 10px rgba(12, 18, 32, 0.10);
    --cap-idle-alpha: 0.42;
    --cap-edge-gap: 6px;
    --cap-strip-w: 6px;
    --cap-strip-h: 84px;
    --cap-hue: 212;
  }
  body.is-dark {
    --cap-bg: rgba(25, 27, 34, 0.94);
    --cap-bg-2: rgba(35, 38, 48, 0.92);
    --cap-ink: #eef1f7;
    --cap-ink-2: #b4bccb;
    --cap-ink-3: #7d8698;
    --cap-line: rgba(255, 255, 255, 0.10);
    --cap-accent: #748ffc;
    --cap-accent-soft: rgba(116, 143, 252, 0.16);
    --cap-strip-bg: linear-gradient(180deg, rgba(46,52,68,0.92), rgba(28,32,44,0.90));
    --cap-strip-border: rgba(116, 143, 252, 0.48);
    --cap-strip-core: #8ce99a;
    --cap-shadow: 0 20px 48px rgba(0, 0, 0, 0.55), 0 2px 12px rgba(0, 0, 0, 0.36);
  }

  /* ── 六大馆藏外观个性化材质（窄条 + 胶囊 + 手札浮窗） ── */
  body[data-theme="paper"] {
    --cap-bg: rgba(251, 247, 239, 0.96);
    --cap-bg-2: rgba(241, 233, 219, 0.94);
    --cap-ink: #34281d;
    --cap-ink-2: #6b5642;
    --cap-ink-3: #99826b;
    --cap-line: rgba(115, 84, 52, 0.16);
    --cap-accent: #8f683d;
    --cap-accent-soft: rgba(143, 104, 61, 0.14);
    --cap-strip-bg: linear-gradient(180deg, #fdfaf3 0%, #eadcc6 100%);
    --cap-strip-border: rgba(143, 104, 61, 0.52);
    --cap-strip-core: #8f683d;
  }
  body.is-dark[data-theme="paper"] {
    --cap-bg: rgba(36, 31, 26, 0.95);
    --cap-bg-2: rgba(48, 41, 34, 0.94);
    --cap-ink: #f3eadc;
    --cap-ink-2: #c8b8a4;
    --cap-ink-3: #92816e;
    --cap-line: rgba(226, 198, 162, 0.14);
    --cap-accent: #d4a373;
    --cap-accent-soft: rgba(212, 163, 115, 0.18);
    --cap-strip-bg: linear-gradient(180deg, #3c3228 0%, #28211a 100%);
    --cap-strip-border: rgba(212, 163, 115, 0.48);
    --cap-strip-core: #d4a373;
  }

  body[data-theme="glow"] {
    --cap-accent: hsl(var(--cap-hue) 68% 52%);
    --cap-accent-soft: hsl(var(--cap-hue) 75% 56% / 0.15);
    --cap-strip-bg: linear-gradient(180deg, hsl(var(--cap-hue) 85% 92% / 0.92), hsl(calc(var(--cap-hue) + 28) 78% 82% / 0.88));
    --cap-strip-border: hsl(var(--cap-hue) 75% 58% / 0.58);
    --cap-strip-core: hsl(var(--cap-hue) 78% 54%);
  }
  body.is-dark[data-theme="glow"] {
    --cap-bg: rgba(24, 24, 33, 0.93);
    --cap-bg-2: rgba(34, 34, 47, 0.92);
    --cap-accent: hsl(var(--cap-hue) 82% 70%);
    --cap-accent-soft: hsl(var(--cap-hue) 82% 66% / 0.18);
    --cap-strip-bg: linear-gradient(180deg, hsl(var(--cap-hue) 52% 32% / 0.92), hsl(calc(var(--cap-hue) + 32) 48% 22% / 0.92));
    --cap-strip-border: hsl(var(--cap-hue) 82% 68% / 0.56);
    --cap-strip-core: hsl(var(--cap-hue) 88% 72%);
  }

  body[data-theme="cinema"] {
    --cap-bg: rgba(23, 20, 17, 0.95);
    --cap-bg-2: rgba(36, 31, 26, 0.94);
    --cap-ink: #f4ece1;
    --cap-ink-2: #c5b6a2;
    --cap-ink-3: #8c7d6b;
    --cap-line: rgba(224, 164, 88, 0.16);
    --cap-accent: #e0a458;
    --cap-accent-soft: rgba(224, 164, 88, 0.16);
    --cap-strip-bg: linear-gradient(180deg, rgba(32, 27, 22, 0.95), rgba(18, 15, 12, 0.95));
    --cap-strip-border: rgba(224, 164, 88, 0.55);
    --cap-strip-core: #e0a458;
  }

  body[data-theme="roxy"] {
    --cap-bg: rgba(246, 240, 227, 0.96);
    --cap-bg-2: rgba(235, 225, 204, 0.94);
    --cap-ink: #2b2723;
    --cap-ink-2: #5d5346;
    --cap-ink-3: #8c7e6a;
    --cap-line: rgba(98, 86, 66, 0.16);
    --cap-accent: #3f56b0;
    --cap-accent-soft: rgba(63, 86, 176, 0.13);
    --cap-strip-bg: linear-gradient(180deg, #f8f2e4 0%, #dfd0b0 100%);
    --cap-strip-border: rgba(63, 86, 176, 0.52);
    --cap-strip-core: #3f56b0;
  }
  body.is-dark[data-theme="roxy"] {
    --cap-bg: rgba(27, 29, 39, 0.95);
    --cap-bg-2: rgba(37, 40, 54, 0.94);
    --cap-ink: #efe9dc;
    --cap-ink-2: #bdb5a4;
    --cap-ink-3: #857f72;
    --cap-line: rgba(142, 168, 255, 0.15);
    --cap-accent: #7b96ff;
    --cap-accent-soft: rgba(123, 150, 255, 0.17);
    --cap-strip-bg: linear-gradient(180deg, #2b3148 0%, #1d2132 100%);
    --cap-strip-border: rgba(123, 150, 255, 0.54);
    --cap-strip-core: #7dd3fc;
  }

  body[data-theme="cel"] {
    --cap-bg: rgba(247, 252, 255, 0.95);
    --cap-bg-2: rgba(231, 244, 255, 0.93);
    --cap-ink: #172b44;
    --cap-ink-2: #486588;
    --cap-ink-3: #7c97b6;
    --cap-line: rgba(44, 123, 229, 0.15);
    --cap-accent: #0ea5e9;
    --cap-accent-soft: rgba(14, 165, 233, 0.13);
    --cap-strip-bg: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(186,230,253,0.92) 56%, rgba(255,250,235,0.92) 100%);
    --cap-strip-border: rgba(14, 165, 233, 0.58);
    --cap-strip-core: #0ea5e9;
  }
  body.is-dark[data-theme="cel"] {
    --cap-bg: rgba(15, 23, 42, 0.94);
    --cap-bg-2: rgba(24, 36, 62, 0.93);
    --cap-ink: #f0f9ff;
    --cap-ink-2: #bae6fd;
    --cap-ink-3: #6482a6;
    --cap-line: rgba(56, 189, 248, 0.18);
    --cap-accent: #38bdf8;
    --cap-accent-soft: rgba(56, 189, 248, 0.17);
    --cap-strip-bg: linear-gradient(180deg, rgba(30,58,95,0.94) 0%, rgba(15,23,42,0.95) 100%);
    --cap-strip-border: rgba(56, 189, 248, 0.62);
    --cap-strip-core: #7dd3fc;
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--cap-ink);
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── 侧边感应区与窄条/亮显胶囊母体 ── */
  .dock-zone {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    min-width: calc(var(--cap-strip-w) + var(--cap-edge-gap) + 22px);
    height: calc(var(--cap-strip-h) + 38px);
    display: flex;
    align-items: center;
    pointer-events: auto;
    z-index: 20;
    transition: opacity .26s cubic-bezier(.22, 1, .36, 1), transform .32s cubic-bezier(.22, 1, .36, 1);
  }
  body[data-side="right"] .dock-zone {
    right: 0;
    justify-content: flex-end;
    padding-right: var(--cap-edge-gap);
    padding-left: 16px;
  }
  body[data-side="left"] .dock-zone {
    left: 0;
    justify-content: flex-start;
    padding-left: var(--cap-edge-gap);
    padding-right: 16px;
  }
  body.is-expanded .dock-zone {
    opacity: 0;
    pointer-events: none !important;
    transform: translateY(-50%) scale(0.86);
  }

  /* 未亮显窄条（平行于屏幕边缘，保留呼吸边距，支持 0% 全透明隐身） */
  .strip-bar {
    position: relative;
    width: var(--cap-strip-w);
    height: var(--cap-strip-h);
    border-radius: 999px;
    background: var(--cap-strip-bg);
    border: 1px solid var(--cap-strip-border);
    opacity: var(--cap-idle-alpha);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.16);
    overflow: hidden;
    cursor: pointer;
    transition:
      opacity .24s cubic-bezier(.22, 1, .36, 1),
      transform .28s cubic-bezier(.22, 1, .36, 1),
      width .28s cubic-bezier(.22, 1, .36, 1),
      height .28s cubic-bezier(.22, 1, .36, 1),
      border-radius .28s cubic-bezier(.22, 1, .36, 1),
      box-shadow .28s ease;
  }
  .strip-core {
    position: absolute;
    left: 50%;
    top: 20%;
    bottom: 20%;
    width: 2px;
    border-radius: 99px;
    transform: translateX(-50%);
    background: var(--cap-strip-core);
    opacity: .88;
  }
  /* 晴空画集窄条斜切清玻反光面 */
  body[data-theme="cel"] .strip-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(165deg, rgba(255,255,255,0.55) 0%, transparent 32%, rgba(255,255,255,0.95) 49%, transparent 66%, rgba(186,230,253,0.5) 100%);
  }
  /* 暖色纸本窄条斜裁书签感与纸脊折线 */
  body[data-theme="paper"] .strip-bar {
    border-radius: 3px 3px 6px 6px;
    box-shadow: inset -1px 0 0 rgba(143, 104, 61, 0.28), 0 2px 10px rgba(0, 0, 0, 0.14);
  }
  /* 封面柔光窄条双色呼吸光芯 */
  body[data-theme="glow"] .strip-core {
    top: 12%;
    bottom: 12%;
    width: 3px;
    filter: blur(0.4px);
    background: linear-gradient(180deg, hsl(var(--cap-hue) 88% 68%), hsl(calc(var(--cap-hue) + 36) 84% 62%));
  }
  /* 夜间影院窄条暖琥珀微光灯丝 */
  body[data-theme="cinema"] .strip-core {
    top: 26%;
    bottom: 26%;
    width: 1.5px;
    box-shadow: 0 0 6px rgba(224, 164, 88, 0.85);
  }
  /* 洛琪希手记顶端四芒星微徽与双金箍 */
  .strip-star {
    display: none;
    position: absolute;
    top: 6px;
    left: 50%;
    width: 6px;
    height: 6px;
    transform: translateX(-50%);
    fill: var(--cap-strip-core);
  }
  body[data-theme="roxy"] .strip-star {
    display: block;
  }
  body[data-theme="roxy"] .strip-core {
    top: 28%;
    bottom: 18%;
  }

  /* 悬停唤醒或初现提示态：平滑浮起为亮显侧边胶囊 */
  .capsule-pill {
    position: absolute;
    top: 50%;
    display: flex;
    align-items: center;
    gap: 9px;
    height: 46px;
    padding: 5px 12px 5px 6px;
    border-radius: 999px;
    background: var(--cap-bg);
    border: 1px solid var(--cap-strip-border);
    box-shadow: var(--cap-shadow);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    max-width: 256px;
    transition:
      opacity .24s cubic-bezier(.22, 1, .36, 1),
      transform .30s cubic-bezier(.20, 1.12, .32, 1);
  }
  body[data-side="right"] .capsule-pill {
    right: var(--cap-edge-gap);
    transform: translate3d(26px, -50%, 0) scale(0.88);
  }
  body[data-side="left"] .capsule-pill {
    left: var(--cap-edge-gap);
    flex-direction: row-reverse;
    padding: 5px 6px 5px 12px;
    transform: translate3d(-26px, -50%, 0) scale(0.88);
  }

  .dock-zone.is-awake .strip-bar,
  .dock-zone.is-greeting .strip-bar {
    opacity: 0 !important;
    transform: scaleY(0.65);
  }
  .dock-zone.is-awake .capsule-pill,
  .dock-zone.is-greeting .capsule-pill {
    opacity: 1;
    pointer-events: auto;
    transform: translate3d(0, -50%, 0) scale(1);
  }
  body.is-dragging .capsule-pill {
    transform: translate3d(0, -50%, 0) scale(1.04) rotate(-1deg);
  }
  body.is-snapping .dock-zone {
    animation: edge-kiss .32s cubic-bezier(.22, 1.28, .36, 1);
  }
  @keyframes edge-kiss {
    0% { transform: translateY(-50%) scaleX(1); }
    42% { transform: translateY(-50%) scaleX(0.92) scaleY(1.05); }
    100% { transform: translateY(-50%) scaleX(1); }
  }

  .pill-cover {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--cap-accent-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: var(--cap-accent);
    border: 1px solid var(--cap-line);
  }
  .pill-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pill-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .pill-title {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--cap-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 164px;
  }
  .pill-sub {
    font-size: 12px;
    color: var(--cap-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 164px;
  }
  .pill-pen {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--cap-accent-soft);
    color: var(--cap-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* ── 展开态：悬浮游戏手札主面板 ── */
  .journal-card {
    position: absolute;
    top: 14px;
    bottom: 14px;
    width: calc(100% - 22px);
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    background: var(--cap-bg);
    border: 1px solid var(--cap-line);
    box-shadow: var(--cap-shadow);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    overflow: hidden;
    z-index: 30;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity .26s cubic-bezier(.22, 1, .36, 1),
      transform .32s cubic-bezier(.18, 1.04, .30, 1);
  }
  body[data-side="right"] .journal-card {
    right: max(8px, var(--cap-edge-gap));
    transform-origin: 100% 50%;
    transform: translate3d(42px, 0, 0) scale(0.84);
  }
  body[data-side="left"] .journal-card {
    left: max(8px, var(--cap-edge-gap));
    transform-origin: 0% 50%;
    transform: translate3d(-42px, 0, 0) scale(0.84);
  }
  body.is-expanded .journal-card {
    opacity: 1;
    pointer-events: auto;
    transform: translate3d(0, 0, 0) scale(1);
  }

  /* 封面柔光专属环境晕染头 */
  .card-ambient {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 112px;
    pointer-events: none;
    background: radial-gradient(ellipse at 20% 0%, hsl(var(--cap-hue) 78% 62% / 0.24), transparent 72%);
  }
  body[data-theme="glow"] .card-ambient { display: block; }

  /* 顶栏（可跨屏拖拽手柄 + 进度时长速改 + 钉住/调参/收起） */
  .card-top {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px 9px;
    border-bottom: 1px solid var(--cap-line);
    cursor: grab;
  }
  .card-top:active { cursor: grabbing; }
  .head-cover {
    width: 40px;
    height: 54px;
    border-radius: 7px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--cap-bg-2);
    border: 1px solid var(--cap-line);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: var(--cap-accent);
  }
  .head-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .head-row1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .head-title {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--cap-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .head-tools { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  button {
    appearance: none;
    -webkit-appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--cap-ink-2);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    margin: 0;
    box-shadow: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background .15s ease, color .15s ease, border-color .15s ease, transform .12s ease;
  }
  .icon-btn {
    width: 27px;
    height: 27px;
    border-radius: 8px;
  }
  .icon-btn:hover {
    background: var(--cap-bg-2);
    color: var(--cap-ink);
  }
  .icon-btn.is-on {
    background: var(--cap-accent-soft);
    color: var(--cap-accent);
    border-color: color-mix(in srgb, var(--cap-accent) 34%, transparent);
  }

  body { color-scheme: light; }
  body.is-dark, body[data-theme="cinema"] { color-scheme: dark; }

  .meta-strip {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: nowrap;
    min-width: 0;
  }
  .meta-select, .meta-inp {
    height: 26px;
    padding: 0 7px;
    border-radius: 7px;
    border: 1px solid var(--cap-line);
    background: var(--cap-bg-2);
    color: var(--cap-ink);
    font-size: 12px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }
  .meta-inp[type="number"]::-webkit-inner-spin-button,
  .meta-inp[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .meta-select:focus, .meta-inp:focus {
    border-color: var(--cap-accent);
  }
  .meta-inp.is-prog { flex: 1 1 88px; }
  .meta-inp.is-num { width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
  .meta-unit { font-size: 12px; color: var(--cap-ink-3); flex-shrink: 0; }

  /* 快捷外观与透明度/边距实时微调抽屉 */
  .tune-drawer {
    display: none;
    flex-direction: column;
    gap: 8px;
    padding: 9px 12px;
    background: var(--cap-bg-2);
    border-bottom: 1px solid var(--cap-line);
    font-size: 12px;
  }
  .tune-drawer.is-open { display: flex; }
  .tune-row {
    display: grid;
    grid-template-columns: 94px minmax(0, 1fr) 46px;
    align-items: center;
    gap: 8px;
  }
  .tune-lbl { color: var(--cap-ink-2); font-size: 12px; }
  .tune-val { color: var(--cap-accent); font-weight: 650; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 5px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--cap-accent) 22%, var(--cap-line));
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--cap-accent);
    border: 2px solid #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
    transition: transform .12s ease;
  }
  input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.12);
  }

  /* 单一物理承载母体分段切换栏（手札 / 待办 / 攻略） */
  .seg-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px 6px;
  }
  .seg-rail {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: var(--cap-bg-2);
    border: 1px solid var(--cap-line);
    gap: 2px;
  }
  .seg-btn {
    height: 26px;
    padding: 0 11px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--cap-ink-2);
    gap: 5px;
  }
  .seg-btn.is-active {
    background: var(--cap-bg);
    color: var(--cap-ink);
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }
  .seg-cnt {
    font-size: 12px;
    color: var(--cap-accent);
    font-weight: 700;
  }
  .sync-badge {
    font-size: 12px;
    color: var(--cap-ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 内容滚动区 */
  .card-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    user-select: text;
  }
  .card-body::-webkit-scrollbar { width: 5px; }
  .card-body::-webkit-scrollbar-thumb { background: var(--cap-line); border-radius: 99px; }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 9px;
    border-radius: 11px;
    background: var(--cap-bg-2);
    border: 1px solid var(--cap-line);
  }
  .composer textarea {
    width: 100%;
    min-height: 52px;
    max-height: 140px;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--cap-ink);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
  }
  .composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .stamp-note {
    font-size: 12px;
    color: var(--cap-ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .primary-btn {
    height: 27px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--cap-accent);
    color: #fff;
    font-weight: 600;
    font-size: 12px;
  }
  .primary-btn:disabled { opacity: .45; cursor: default; }
  .quiet-btn {
    height: 26px;
    padding: 0 9px;
    border-radius: 7px;
    border: 1px solid var(--cap-line);
    background: var(--cap-bg);
    color: var(--cap-ink-2);
    font-size: 12px;
  }
  .quiet-btn:hover { color: var(--cap-ink); border-color: var(--cap-accent); }

  .list-col { display: flex; flex-direction: column; gap: 7px; }
  .item-card {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--cap-line);
    background: color-mix(in srgb, var(--cap-bg) 70%, var(--cap-bg-2));
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .item-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--cap-ink-3);
  }
  .item-chap {
    color: var(--cap-accent);
    font-weight: 600;
  }
  .item-tools { margin-left: auto; display: inline-flex; gap: 6px; }
  .txt-link { font-size: 12px; color: var(--cap-ink-3); }
  .txt-link:hover { color: var(--cap-accent); }
  .txt-link.is-danger:hover { color: #e03131; }
  .item-text {
    font-size: 13px;
    line-height: 1.52;
    color: var(--cap-ink);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .quick-row { display: flex; gap: 6px; }
  .quick-inp {
    flex: 1;
    height: 30px;
    padding: 0 9px;
    border-radius: 8px;
    border: 1px solid var(--cap-line);
    background: var(--cap-bg-2);
    color: var(--cap-ink);
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }
  .quick-inp:focus { border-color: var(--cap-accent); }

  .todo-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 9px;
    border: 1px solid var(--cap-line);
  }
  .todo-row.is-done .todo-txt {
    text-decoration: line-through;
    color: var(--cap-ink-3);
  }
  .todo-row input[type="checkbox"] {
    margin-top: 3px;
    accent-color: var(--cap-accent);
    cursor: pointer;
  }
  .todo-txt { flex: 1; font-size: 13px; line-height: 1.45; min-width: 0; word-break: break-word; }

  .spoiler-pill {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--cap-accent-soft);
    color: var(--cap-accent);
    font-size: 12px;
    cursor: pointer;
  }
  .empty-hint {
    padding: 20px 12px;
    text-align: center;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--cap-ink-3);
  }
  .preview-banner {
    display: none;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    background: var(--cap-accent-soft);
    border-top: 1px solid var(--cap-line);
    font-size: 12px;
    color: var(--cap-ink-2);
  }
  body.is-preview .preview-banner { display: flex; }

  body.is-concealed .stage {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  body.is-retiring .dock-zone,
  body.is-retiring .journal-card {
    opacity: 0 !important;
    pointer-events: none !important;
    transition: opacity .24s ease, transform .26s cubic-bezier(.32, 0, .24, 1) !important;
  }
  body[data-side="right"].is-retiring .dock-zone {
    transform: translate3d(28px, -50%, 0) scale(0.75) !important;
  }
  body[data-side="left"].is-retiring .dock-zone {
    transform: translate3d(-28px, -50%, 0) scale(0.75) !important;
  }
  body[data-side="right"].is-retiring .journal-card {
    transform: translate3d(44px, 0, 0) scale(0.84) !important;
  }
  body[data-side="left"].is-retiring .journal-card {
    transform: translate3d(-44px, 0, 0) scale(0.84) !important;
  }

  .taskbar-ask-banner {
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: var(--cap-accent-soft);
    border-top: 1px solid var(--cap-line);
    font-size: 12px;
    line-height: 1.45;
    color: var(--cap-ink-2);
    pointer-events: auto;
  }
  .taskbar-ask-banner.is-open { display: flex; }
  .taskbar-ask-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  svg.ico {
    width: 15px;
    height: 15px;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
  }
</style>
</head>
<body data-theme="follow" data-side="right">
  <div class="stage" id="stage">
    <!-- 贴边半透明窄条与靠近浮起胶囊 -->
    <div class="dock-zone" id="dockZone">
      <div class="strip-bar" id="stripBar" title="点击展开游戏手札 · 按住可拖动位置">
        <svg class="strip-star" viewBox="0 0 12 12"><path d="M6 0 L7.4 4.6 L12 6 L7.4 7.4 L6 12 L4.6 7.4 L0 6 L4.6 4.6 Z"/></svg>
        <span class="strip-core"></span>
      </div>
      <div class="capsule-pill" id="capsulePill" title="点击展开手札 · 按住可跨显示器拖动">
        <div class="pill-cover" id="pillCover"></div>
        <div class="pill-info">
          <div class="pill-title" id="pillTitle">游戏手札</div>
          <div class="pill-sub" id="pillSub">点击展开记录</div>
        </div>
        <div class="pill-pen">
          <svg class="ico" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </div>
      </div>
    </div>

    <!-- 展开态悬浮手札面板 -->
    <section class="journal-card" id="journalCard" aria-label="游戏手札悬浮窗">
      <div class="card-ambient"></div>
      <header class="card-top" id="dragHeader">
        <div class="head-cover" id="headCover"></div>
        <div class="head-main">
          <div class="head-row1">
            <div class="head-title" id="headTitle">游戏手札</div>
            <div class="head-tools">
              <button type="button" class="icon-btn" id="btnPin" title="钉住面板（点击游戏画面时不自动缩回侧边）">
                <svg class="ico" viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/></svg>
              </button>
              <button type="button" class="icon-btn" id="btnTune" title="调节窄条透明度、边距与粗细长短">
                <svg class="ico" viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/></svg>
              </button>
              <button type="button" class="icon-btn" id="btnCollapse" title="收拢回屏幕侧边窄条（Esc）">
                <svg class="ico" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
          <div class="meta-strip">
            <select class="meta-select" id="selStatus" aria-label="游玩状态">
              <option value="在玩">在玩</option>
              <option value="想玩">想玩</option>
              <option value="通关">通关</option>
              <option value="全成就">全成就</option>
              <option value="搁置">搁置</option>
            </select>
            <input type="text" class="meta-inp is-prog" id="inpProgress" placeholder="当前章节 / 进度" />
            <input type="number" class="meta-inp is-num" id="inpHours" step="0.5" min="0" title="游玩时长（小时）" />
            <span class="meta-unit">h</span>
            <input type="number" class="meta-inp is-num" id="inpScore" step="0.5" min="0" max="10" placeholder="评分" title="个人评分（0~10）" />
          </div>
        </div>
      </header>

      <div class="tune-drawer" id="tuneDrawer">
        <div class="tune-row">
          <span class="tune-lbl">窄条不透明度</span>
          <input type="range" id="rngOpacity" min="0" max="100" step="1" />
          <span class="tune-val" id="valOpacity">42%</span>
        </div>
        <div class="tune-row">
          <span class="tune-lbl">距屏幕边缘</span>
          <input type="range" id="rngMargin" min="0" max="28" step="1" />
          <span class="tune-val" id="valMargin">6px</span>
        </div>
        <div class="tune-row">
          <span class="tune-lbl">窄条粗细</span>
          <input type="range" id="rngStripW" min="4" max="14" step="1" />
          <span class="tune-val" id="valStripW">6px</span>
        </div>
        <div class="tune-row">
          <span class="tune-lbl">窄条高度</span>
          <input type="range" id="rngStripH" min="52" max="148" step="4" />
          <span class="tune-val" id="valStripH">84px</span>
        </div>
      </div>

      <div class="seg-wrap">
        <div class="seg-rail" role="tablist">
          <button type="button" class="seg-btn is-active" data-tab="notes">手札 <span class="seg-cnt" id="cntNotes"></span></button>
          <button type="button" class="seg-btn" data-tab="todos">待办 <span class="seg-cnt" id="cntTodos"></span></button>
          <button type="button" class="seg-btn" data-tab="guides">攻略 <span class="seg-cnt" id="cntGuides"></span></button>
        </div>
        <span class="sync-badge" id="syncBadge">与档案馆实时同步</span>
      </div>

      <div class="card-body" id="cardBody"></div>

      <div class="taskbar-ask-banner" id="taskbarAskBanner">
        <span>打字记手札时，是否临时自动收起底部系统任务栏（收起浮窗即恢复）？</span>
        <div class="taskbar-ask-actions">
          <button type="button" class="quiet-btn" id="btnKeepTaskbar">保持系统默认</button>
          <button type="button" class="primary-btn" id="btnAutoHideTaskbar">临时收起（推荐）</button>
        </div>
      </div>

      <footer class="preview-banner" id="previewBanner">
        <span>当前处于侧边胶囊预览模式（可跨屏拖拽测试吸附）</span>
        <button type="button" class="quiet-btn" id="btnExitPreview">结束预览</button>
      </footer>
    </section>
  </div>

<script>
  const { ipcRenderer } = require("electron");

  let state = null;
  let activeTab = "notes";
  let greetingTimer = null;
  let passThrough = true;
  let focusOwned = false;
  let dragging = false;
  let dragMoved = false;
  let dragStartScreen = null;

  const dockZone = document.getElementById("dockZone");
  const journalCard = document.getElementById("journalCard");
  const cardBody = document.getElementById("cardBody");
  const syncBadge = document.getElementById("syncBadge");
  const tuneDrawer = document.getElementById("tuneDrawer");

  function send(type, data = {}) {
    ipcRenderer.send("bm-cap-msg", Object.assign({ type }, data));
  }

  function setMousePassThrough(ignore) {
    if (passThrough === ignore) return;
    passThrough = ignore;
    send("set-ignore-mouse", { ignore });
  }

  function requestKeyboardFocus(want) {
    if (focusOwned === want) return;
    focusOwned = want;
    send("set-focusable", { focusable: want });
  }

  function flashBadge(msg) {
    syncBadge.textContent = msg;
    clearTimeout(flashBadge._t);
    flashBadge._t = setTimeout(() => {
      syncBadge.textContent = "与档案馆实时同步";
    }, 1800);
  }

  /* ── 鼠标穿透与靠近亮显检测 ── */
  window.addEventListener("mousemove", (ev) => {
    if (dragging) {
      setMousePassThrough(false);
      return;
    }
    const expanded = document.body.classList.contains("is-expanded");
    if (expanded) {
      const r = journalCard.getBoundingClientRect();
      const hit = ev.clientX >= r.left - 4 && ev.clientX <= r.right + 4 && ev.clientY >= r.top - 4 && ev.clientY <= r.bottom + 4;
      setMousePassThrough(!hit);
    } else {
      const r = dockZone.getBoundingClientRect();
      const near = ev.clientX >= r.left - 8 && ev.clientX <= r.right + 8 && ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8;
      dockZone.classList.toggle("is-awake", near);
      setMousePassThrough(!near);
    }
  });

  document.addEventListener("mouseleave", () => {
    if (!dragging) {
      dockZone.classList.remove("is-awake");
      if (!document.body.classList.contains("is-expanded")) {
        setMousePassThrough(true);
      }
    }
  });

  /* ── 跨显示器拖拽与点击展开 ── */
  function attachDragAndClick(handleEl, onTap) {
    handleEl.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest("button, input, select, textarea")) return;
      dragging = true;
      dragMoved = false;
      dragStartScreen = { x: ev.screenX, y: ev.screenY };
      handleEl.setPointerCapture(ev.pointerId);
      send("drag-start");
    });
    handleEl.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const dx = ev.screenX - dragStartScreen.x;
      const dy = ev.screenY - dragStartScreen.y;
      if (!dragMoved && Math.hypot(dx, dy) > 5) {
        dragMoved = true;
        document.body.classList.add("is-dragging");
      }
      if (dragMoved) {
        send("drag-move");
      }
    });
    const finish = (ev) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-dragging");
      try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
      if (dragMoved) {
        document.body.classList.add("is-snapping");
        setTimeout(() => document.body.classList.remove("is-snapping"), 340);
        send("drag-end");
      } else if (typeof onTap === "function") {
        onTap();
      }
    };
    handleEl.addEventListener("pointerup", finish);
    handleEl.addEventListener("pointercancel", finish);
  }

  attachDragAndClick(dockZone, () => {
    dockZone.classList.remove("is-greeting");
    send("set-expanded", { expanded: true });
  });
  attachDragAndClick(document.getElementById("dragHeader"), null);

  /* ── 按需获取键盘焦点（不打字时绝不抢夺全屏游戏焦点） ── */
  const taskbarAskBanner = document.getElementById("taskbarAskBanner");
  document.getElementById("btnKeepTaskbar").onclick = () => {
    taskbarAskBanner.classList.remove("is-open");
    send("update-capsule-cfg", { taskbarPolicy: "keep_system" });
    flashBadge("已保持系统任务栏默认设置");
  };
  document.getElementById("btnAutoHideTaskbar").onclick = () => {
    taskbarAskBanner.classList.remove("is-open");
    send("update-capsule-cfg", { taskbarPolicy: "auto_hide" });
    flashBadge("已开启打字时自动收起任务栏");
  };

  document.addEventListener("pointerdown", (ev) => {
    const isField = Boolean(ev.target.closest("textarea, input[type='text'], input[type='number'], input[type='url'], select"));
    if (isField) {
      const target = ev.target;
      if (state && state.capsule && state.capsule.taskbarPolicy === "ask") {
        taskbarAskBanner.classList.add("is-open");
      }
      requestKeyboardFocus(true);
      setTimeout(() => { try { target.focus(); } catch (_) {} }, 35);
    } else if (focusOwned && !ev.target.closest(".composer, .quick-row, .meta-strip, .taskbar-ask-banner")) {
      requestKeyboardFocus(false);
    }
  }, true);

  window.addEventListener("blur", () => {
    focusOwned = false;
    if (state && state.runtime && state.runtime.expanded && !state.runtime.pinned) {
      send("set-expanded", { expanded: false });
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && document.body.classList.contains("is-expanded")) {
      requestKeyboardFocus(false);
      send("set-expanded", { expanded: false });
    }
  });

  document.getElementById("btnCollapse").onclick = () => {
    requestKeyboardFocus(false);
    send("set-expanded", { expanded: false });
  };
  document.getElementById("btnPin").onclick = () => {
    const next = !(state && state.runtime && state.runtime.pinned);
    send("set-pinned", { pinned: next });
  };
  document.getElementById("btnTune").onclick = () => {
    tuneDrawer.classList.toggle("is-open");
    document.getElementById("btnTune").classList.toggle("is-on", tuneDrawer.classList.contains("is-open"));
  };
  document.getElementById("btnExitPreview").onclick = () => {
    send("close-preview");
  };

  /* ── 顶栏元数据与微调滑块同步 ── */
  const selStatus = document.getElementById("selStatus");
  const inpProgress = document.getElementById("inpProgress");
  const inpHours = document.getElementById("inpHours");
  const inpScore = document.getElementById("inpScore");

  selStatus.onchange = () => { send("update-meta", { status: selStatus.value }); flashBadge("已同步状态"); };
  inpProgress.onchange = () => { send("update-meta", { currentProgress: inpProgress.value.trim() }); flashBadge("已同步进度"); };
  inpHours.onchange = () => { send("update-meta", { playHours: Math.max(0, Number(inpHours.value) || 0) }); flashBadge("已同步时长"); };
  inpScore.onchange = () => {
    const raw = inpScore.value.trim();
    send("update-meta", { score: raw === "" ? "" : Math.min(10, Math.max(0, Number(raw) || 0)) });
    flashBadge("已同步评分");
  };
  [inpProgress, inpHours, inpScore].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); el.blur(); }
    });
  });

  const rngOpacity = document.getElementById("rngOpacity");
  const rngMargin = document.getElementById("rngMargin");
  const rngStripW = document.getElementById("rngStripW");
  const rngStripH = document.getElementById("rngStripH");
  rngOpacity.addEventListener("input", () => {
    const v = Number(rngOpacity.value) || 0;
    document.getElementById("valOpacity").textContent = v === 0 ? "全透明" : v + "%";
    document.documentElement.style.setProperty("--cap-idle-alpha", (v / 100).toFixed(2));
    send("update-capsule-cfg", { idleOpacity: v });
  });
  rngMargin.addEventListener("input", () => {
    const v = Number(rngMargin.value) || 0;
    document.getElementById("valMargin").textContent = v + "px";
    document.documentElement.style.setProperty("--cap-edge-gap", v + "px");
    send("update-capsule-cfg", { edgeMargin: v });
  });
  rngStripW.addEventListener("input", () => {
    const v = Number(rngStripW.value) || 6;
    document.getElementById("valStripW").textContent = v + "px";
    document.documentElement.style.setProperty("--cap-strip-w", v + "px");
    send("update-capsule-cfg", { stripWidth: v });
  });
  rngStripH.addEventListener("input", () => {
    const v = Number(rngStripH.value) || 84;
    document.getElementById("valStripH").textContent = v + "px";
    document.documentElement.style.setProperty("--cap-strip-h", v + "px");
    send("update-capsule-cfg", { stripHeight: v });
  });

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      send("set-tab", { tab: activeTab });
      renderBody(true);
    };
  });

  function setCoverNode(box, url, fallbackTitle) {
    const sig = url || ("txt:" + (fallbackTitle || "?").slice(0, 1));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.onerror = () => { box.textContent = (fallbackTitle || "?").slice(0, 1); };
      box.appendChild(img);
    } else {
      box.textContent = (fallbackTitle || "?").slice(0, 1);
    }
  }

  function formatStamp(n) {
    const parts = [];
    const ch = n.chapter || n.progress || "";
    if (ch) parts.push(ch);
    const hrs = n.hoursAtNote !== undefined ? n.hoursAtNote : n.hours;
    if (hrs !== undefined && hrs !== null && Number(hrs) > 0) parts.push(Number(hrs).toFixed(1).replace(/\.0$/, "") + "h");
    return parts.join(" · ");
  }

  function renderBody(preserveDraftFocus = false) {
    if (!state || !state.game) return;
    const g = state.game;

    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tab === activeTab);
    });
    const openTodoCnt = (g.todos || []).filter((t) => t && !t.done).length;
    document.getElementById("cntNotes").textContent = (g.playNotes || []).length || "";
    document.getElementById("cntTodos").textContent = openTodoCnt || "";
    document.getElementById("cntGuides").textContent = (g.strategyUrls || []).length || "";

    // 若当前正在手札输入框内打字，仅局部刷新下方列表，绝不打断输入法光标
    const existingTa = cardBody.querySelector("#noteDraftInput");
    if (preserveDraftFocus && activeTab === "notes" && existingTa && document.activeElement === existingTa) {
      const listHost = cardBody.querySelector("#notesListHost");
      if (listHost) {
        paintNotesList(listHost, g);
        return;
      }
    }

    cardBody.innerHTML = "";

    if (activeTab === "notes") {
      const comp = document.createElement("div");
      comp.className = "composer";
      const ta = document.createElement("textarea");
      ta.id = "noteDraftInput";
      ta.placeholder = "玩到哪儿、想到什么，随手记一笔…（Ctrl+Enter 记下）";
      ta.value = g.draft || "";
      const foot = document.createElement("div");
      foot.className = "composer-foot";
      const stamp = document.createElement("span");
      stamp.className = "stamp-note";
      const curStamp = [g.currentProgress || "未标进度", g.playHours ? g.playHours + "h" : "0h"].join(" · ");
      stamp.textContent = "标记：" + curStamp;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.textContent = "记下";
      btn.disabled = !ta.value.trim();

      const submit = () => {
        const txt = ta.value.trim();
        if (!txt) return;
        ta.value = "";
        btn.disabled = true;
        send("add-note", { text: txt });
        flashBadge("已记入手札");
      };
      ta.addEventListener("input", () => {
        btn.disabled = !ta.value.trim();
        send("draft-input", { text: ta.value });
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
          e.preventDefault();
          submit();
        }
      });
      btn.onclick = submit;
      foot.append(stamp, btn);
      comp.append(ta, foot);
      cardBody.appendChild(comp);

      const listHost = document.createElement("div");
      listHost.className = "list-col";
      listHost.id = "notesListHost";
      paintNotesList(listHost, g);
      cardBody.appendChild(listHost);
    } else if (activeTab === "todos") {
      const row = document.createElement("div");
      row.className = "quick-row";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "quick-inp";
      inp.placeholder = "添加待办目标（如：回收支线结局），回车确认";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "primary-btn";
      addBtn.textContent = "添加";
      const submitTodo = () => {
        const v = inp.value.trim();
        if (!v) return;
        inp.value = "";
        send("add-todo", { text: v });
        flashBadge("已添加待办");
      };
      addBtn.onclick = submitTodo;
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submitTodo(); }
      });
      row.append(inp, addBtn);
      cardBody.appendChild(row);

      const list = document.createElement("div");
      list.className = "list-col";
      const todos = g.todos || [];
      if (!todos.length) {
        const empty = document.createElement("div");
        empty.className = "empty-hint";
        empty.textContent = "还没有待办。想收集的要素、下次要挑战的目标都可以随手记在这里。";
        list.appendChild(empty);
      } else {
        const ordered = todos.filter((t) => !t.done).concat(todos.filter((t) => t.done));
        ordered.forEach((td) => {
          const item = document.createElement("div");
          item.className = "todo-row" + (td.done ? " is-done" : "");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = Boolean(td.done);
          cb.onchange = () => {
            send("toggle-todo", { id: td.id, done: cb.checked });
            flashBadge(cb.checked ? "已完成一项" : "已移回待办");
          };
          const txt = document.createElement("div");
          txt.className = "todo-txt";
          txt.textContent = td.text || "";
          const del = document.createElement("button");
          del.type = "button";
          del.className = "txt-link is-danger";
          del.textContent = "删除";
          del.onclick = () => send("delete-todo", { id: td.id });
          item.append(cb, txt, del);
          list.appendChild(item);
        });
      }
      cardBody.appendChild(list);
    } else {
      const row = document.createElement("div");
      row.className = "quick-row";
      const inpUrl = document.createElement("input");
      inpUrl.type = "url";
      inpUrl.className = "quick-inp";
      inpUrl.placeholder = "粘贴 Wiki / 攻略链接，回车收藏";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "primary-btn";
      addBtn.textContent = "收藏";
      const submitGuide = () => {
        const u = inpUrl.value.trim();
        if (!u) return;
        inpUrl.value = "";
        send("add-guide", { url: u });
        flashBadge("已收藏攻略");
      };
      addBtn.onclick = submitGuide;
      inpUrl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submitGuide(); }
      });
      row.append(inpUrl, addBtn);
      cardBody.appendChild(row);

      const list = document.createElement("div");
      list.className = "list-col";
      const guides = g.strategyUrls || [];
      if (!guides.length) {
        const empty = document.createElement("div");
        empty.className = "empty-hint";
        empty.textContent = "还没有收藏攻略链接。常看的 Wiki 或路线图放进来，玩的时候一点即开。";
        list.appendChild(empty);
      } else {
        guides.forEach((gd) => {
          const card = document.createElement("div");
          card.className = "item-card";
          const top = document.createElement("div");
          top.className = "item-meta";
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "txt-link";
          openBtn.style.color = "var(--cap-accent)";
          openBtn.style.fontWeight = "650";
          openBtn.textContent = (gd.title || gd.url || "攻略链接") + " ↗";
          openBtn.onclick = () => send("open-external", { url: gd.url });
          const tools = document.createElement("div");
          tools.className = "item-tools";
          const del = document.createElement("button");
          del.type = "button";
          del.className = "txt-link is-danger";
          del.textContent = "删除";
          del.onclick = () => send("delete-guide", { id: gd.id, url: gd.url });
          tools.appendChild(del);
          top.append(openBtn, tools);
          card.appendChild(top);
          if (gd.remark) {
            if (gd.spoiler) {
              const sp = document.createElement("span");
              sp.className = "spoiler-pill";
              let shown = false;
              sp.textContent = "含剧透备注 · 点按显示";
              sp.onclick = () => {
                shown = !shown;
                sp.textContent = shown ? gd.remark : "含剧透备注 · 点按显示";
              };
              card.appendChild(sp);
            } else {
              const rm = document.createElement("div");
              rm.className = "item-text";
              rm.textContent = gd.remark;
              card.appendChild(rm);
            }
          }
          list.appendChild(card);
        });
      }
      cardBody.appendChild(list);
    }
  }

  function paintNotesList(listHost, g) {
    listHost.innerHTML = "";
    const notes = g.playNotes || [];
    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "还没有手札。随手记下此刻的剧情推理、吐槽或配装灵感，会自动同步回番剧档案馆。";
      listHost.appendChild(empty);
      return;
    }
    notes.forEach((n) => {
      const card = document.createElement("div");
      card.className = "item-card";
      const meta = document.createElement("div");
      meta.className = "item-meta";
      const st = formatStamp(n);
      if (st) {
        const chap = document.createElement("span");
        chap.className = "item-chap";
        chap.textContent = st;
        meta.appendChild(chap);
      }
      const tools = document.createElement("div");
      tools.className = "item-tools";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "txt-link is-danger";
      del.textContent = "删除";
      del.onclick = () => send("delete-note", { id: n.id, text: n.text });
      tools.appendChild(del);
      meta.appendChild(tools);

      const body = document.createElement("div");
      body.className = "item-text";
      body.textContent = n.text || "";
      card.append(meta, body);
      listHost.appendChild(card);
    });
  }

  ipcRenderer.on("bm-host-hover", (_ev, data) => {
    if (dragging) return;
    const awake = Boolean(data && data.awake);
    if (!document.body.classList.contains("is-expanded")) {
      dockZone.classList.toggle("is-awake", awake);
    }
  });

  ipcRenderer.on("bm-host-retire", () => {
    document.body.classList.add("is-retiring");
  });

  ipcRenderer.on("bm-host-state", (_ev, next) => {
    const prevExpanded = state && state.runtime ? state.runtime.expanded : false;
    state = next;
    const cap = next.capsule || {};
    const app = next.appearance || {};
    const rt = next.runtime || {};
    const g = next.game || {};

    document.body.classList.remove("is-retiring");
    document.body.dataset.theme = app.theme || "follow";
    document.body.dataset.side = cap.dockSide === "left" ? "left" : "right";
    document.body.classList.toggle("is-dark", Boolean(app.isDark));
    document.body.classList.toggle("is-expanded", Boolean(rt.expanded));
    document.body.classList.toggle("is-preview", Boolean(rt.isPreview));
    document.body.classList.toggle("is-concealed", Boolean(next.concealed ?? rt.concealed));

    if (cap.taskbarPolicy && cap.taskbarPolicy !== "ask") {
      taskbarAskBanner.classList.remove("is-open");
    }

    const collapseIcon = document.querySelector("#btnCollapse svg");
    if (collapseIcon) {
      collapseIcon.style.transform = cap.dockSide === "left" ? "scaleX(-1)" : "none";
    }
    document.getElementById("btnPin").classList.toggle("is-on", Boolean(rt.pinned));

    document.documentElement.style.setProperty("--cap-idle-alpha", ((Number(cap.idleOpacity) || 0) / 100).toFixed(2));
    document.documentElement.style.setProperty("--cap-edge-gap", (Number(cap.edgeMargin) || 0) + "px");
    document.documentElement.style.setProperty("--cap-strip-w", (Number(cap.stripWidth) || 6) + "px");
    document.documentElement.style.setProperty("--cap-strip-h", (Number(cap.stripHeight) || 84) + "px");
    document.documentElement.style.setProperty("--cap-hue", String(g.hue || 212));

    if (document.activeElement !== rngOpacity) {
      rngOpacity.value = String(cap.idleOpacity ?? 42);
      document.getElementById("valOpacity").textContent = Number(cap.idleOpacity) === 0 ? "全透明" : cap.idleOpacity + "%";
    }
    if (document.activeElement !== rngMargin) {
      rngMargin.value = String(cap.edgeMargin ?? 6);
      document.getElementById("valMargin").textContent = (cap.edgeMargin ?? 6) + "px";
    }
    if (document.activeElement !== rngStripW) {
      rngStripW.value = String(cap.stripWidth ?? 6);
      document.getElementById("valStripW").textContent = (cap.stripWidth ?? 6) + "px";
    }
    if (document.activeElement !== rngStripH) {
      rngStripH.value = String(cap.stripHeight ?? 84);
      document.getElementById("valStripH").textContent = (cap.stripHeight ?? 84) + "px";
    }

    setCoverNode(document.getElementById("pillCover"), g.coverFileUrl, g.title);
    setCoverNode(document.getElementById("headCover"), g.coverFileUrl, g.title);
    document.getElementById("pillTitle").textContent = g.title || "游戏手札";
    document.getElementById("pillSub").textContent = next.greetingText || (g.currentProgress ? "进度：" + g.currentProgress : "点击展开手札");
    document.getElementById("headTitle").textContent = g.title || "游戏手札";

    if (document.activeElement !== selStatus) selStatus.value = g.status || "在玩";
    if (document.activeElement !== inpProgress) inpProgress.value = g.currentProgress || "";
    if (document.activeElement !== inpHours) inpHours.value = String(g.playHours ?? 0);
    if (document.activeElement !== inpScore) inpScore.value = g.score !== "" && g.score !== undefined ? String(g.score) : "";

    if (g.activeTab && !prevExpanded && rt.expanded) {
      activeTab = g.activeTab;
    }

    const ta = document.getElementById("noteDraftInput");
    if (ta && document.activeElement !== ta && ta.value !== (g.draft || "")) {
      ta.value = g.draft || "";
    }

    if (next.greetOnArrive) {
      dockZone.classList.add("is-greeting");
      clearTimeout(greetingTimer);
      greetingTimer = setTimeout(() => {
        dockZone.classList.remove("is-greeting");
      }, 2200);
    }

    if (!rt.expanded && prevExpanded) {
      setMousePassThrough(true);
    }

    renderBody(true);
  });

  send("capsule-ready");
</script>
</body>
</html>`;

/* ==================== 悬浮窗创建、消息总线与数据写回 ==================== */

async function persistCapsuleGameMutation(plugin, game) {
  if (!plugin || !game || game.id === "__preview_placeholder__") return;
  try {
    const mh = require("./multi-hall-archive-service.js");
    if (typeof mh.syncGameMarkdownNote === "function") {
      await mh.syncGameMarkdownNote(plugin, game);
    }
  } catch (_) {}
  try {
    await plugin.saveSettings();
  } catch (_) {}
}

function reassertCapsuleTopmost(rt) {
  if (!rt || !rt.win || rt.win.isDestroyed() || rt.retiring) return;
  try {
    rt.win.setAlwaysOnTop(true, "screen-saver");
    if (typeof rt.win.moveTop === "function") rt.win.moveTop();
    if (typeof rt.win.setVisibleOnAllWorkspaces === "function") {
      rt.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  } catch (_) {}
}

function setHostMousePassThrough(rt, ignore) {
  if (!rt || !rt.win || rt.win.isDestroyed()) return;
  const wantIgnore = Boolean(ignore);
  if (rt.hostPassThrough === wantIgnore) return;
  rt.hostPassThrough = wantIgnore;
  try {
    if (wantIgnore) {
      rt.win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      rt.win.setIgnoreMouseEvents(false);
    }
  } catch (_) {}
}

function markGreetingActive(rt, durationMs = 2300) {
  if (!rt) return;
  rt.greetingActive = true;
  if (rt.greetingClearTimer) clearTimeout(rt.greetingClearTimer);
  rt.greetingClearTimer = setTimeout(() => {
    rt.greetingActive = false;
    rt.greetingClearTimer = null;
  }, durationMs);
}

function readNativeHwndValue(win) {
  if (!win || win.isDestroyed() || typeof win.getNativeWindowHandle !== "function") return 0;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || !buf.length) return 0;
    if (buf.length >= 8 && typeof buf.readBigUInt64LE === "function") {
      return Number(buf.readBigUInt64LE(0));
    }
    if (buf.length >= 4 && typeof buf.readUInt32LE === "function") {
      return Number(buf.readUInt32LE(0));
    }
  } catch (_) {}
  return 0;
}

async function locateGameWindowAndAssertTop(plugin, game) {
  if (!plugin || typeof process === "undefined" || process.platform !== "win32") return;
  const rt = plugin._bmGameCapsuleRuntime;
  if (!rt || !rt.win || rt.win.isDestroyed() || rt.retiring) return;
  const remote = getElectronRemote();
  if (!remote) return;

  const targetGame = game || findGameForCapsule(plugin, rt.activeGameId);
  const exeSet = targetGame ? collectCandidateExesForGame(plugin, targetGame) : new Set();
  const procBaseNames = Array.from(exeSet)
    .map((x) => String(x || "").replace(/\.exe$/i, "").replace(/['"]/g, "").trim())
    .filter(Boolean)
    .slice(0, 16);

  const capHwnd = readNativeHwndValue(rt.win);
  const namesPsLiteral = procBaseNames.length
    ? `@(${procBaseNames.map((n) => `'${n}'`).join(",")})`
    : `@()`;

  const res = await runPowerShellHidden(
    `${WIN32_GAME_WIN_PS}\n[BmGameWinHelper]::InspectAndRaise(${capHwnd}, [string[]]${namesPsLiteral})`
  );
  if (!res.ok || !res.stdout || res.stdout === "NONE") return;
  if (!rt.win || rt.win.isDestroyed() || rt.retiring) return;

  const parts = res.stdout.split(/\r?\n/).pop().trim().split(",");
  if (parts.length < 4) return;
  const left = Number(parts[0]);
  const top = Number(parts[1]);
  const right = Number(parts[2]);
  const bottom = Number(parts[3]);
  if (![left, top, right, bottom].every(Number.isFinite)) return;
  if (right - left < 480 || bottom - top < 320) return;

  const physCenter = {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2)
  };
  let dipCenter = physCenter;
  try {
    if (typeof remote.screen.screenToDipPoint === "function") {
      dipCenter = remote.screen.screenToDipPoint(physCenter);
    }
  } catch (_) {}

  const gameDisp = remote.screen.getDisplayNearestPoint(dipCenter);
  if (!gameDisp) return;

  if (!rt.userDraggedThisSession && rt.activeSource !== "preview" && !rt.dragging) {
    try {
      const curBounds = rt.win.getBounds();
      const curDisp = remote.screen.getDisplayNearestPoint({
        x: Math.round(curBounds.x + curBounds.width / 2),
        y: Math.round(curBounds.y + curBounds.height / 2)
      });
      if (curDisp && curDisp.id !== gameDisp.id) {
        const cfg = ensureGameCapsuleSettings(plugin);
        const nextRect = computeDockedWindowRect(gameDisp, cfg);
        rt.win.setBounds(nextRect);
        markGreetingActive(rt, 2400);
        broadcastToCapsuleWindow(plugin, {
          greetOnArrive: true,
          greetingText: "已跟随至游戏屏幕边缘"
        });
      }
    } catch (_) {}
  }

  if (!rt.focusOwnedNow) {
    reassertCapsuleTopmost(rt);
  }
}

function clearZOrderBurstTimers(rt) {
  if (!rt || !Array.isArray(rt.zOrderBurstTimers)) return;
  for (const tid of rt.zOrderBurstTimers) {
    clearTimeout(tid);
  }
  rt.zOrderBurstTimers = [];
}

function schedulePostLaunchWindowChecks(plugin, game) {
  const rt = getRuntime(plugin);
  clearZOrderBurstTimers(rt);

  for (const delayMs of [420, 1250, 2500, 4400, 7200]) {
    const tid = setTimeout(() => {
      if (!rt.win || rt.win.isDestroyed() || rt.retiring) return;
      if (!rt.focusOwnedNow && !rt.dragging) {
        reassertCapsuleTopmost(rt);
      }
    }, delayMs);
    rt.zOrderBurstTimers.push(tid);
  }

  if (rt.activeSource !== "preview" && typeof process !== "undefined" && process.platform === "win32") {
    for (const delayMs of [1800, 4900, 9200]) {
      const tid = setTimeout(() => {
        locateGameWindowAndAssertTop(plugin, game);
      }, delayMs);
      rt.zOrderBurstTimers.push(tid);
    }
  }
}

function startOverlayWatchers(plugin) {
  const rt = getRuntime(plugin);
  if (rt.cursorTimer) return;
  rt.lastZOrderTickMs = Date.now();

  rt.cursorTimer = setInterval(() => {
    if (!rt.win || rt.win.isDestroyed()) {
      stopOverlayWatchers(rt);
      return;
    }
    if (!rt.winReady || rt.concealed || rt.retiring) return;

    const now = Date.now();
    if (now - rt.lastZOrderTickMs >= 2200) {
      rt.lastZOrderTickMs = now;
      if (!rt.focusOwnedNow && !rt.dragging) {
        reassertCapsuleTopmost(rt);
      }
    }

    if (rt.dragging) {
      setHostMousePassThrough(rt, false);
      return;
    }

    const remote = getElectronRemote();
    if (!remote) return;
    let cur = null;
    let wb = null;
    try {
      cur = remote.screen.getCursorScreenPoint();
      wb = rt.win.getBounds();
    } catch (_) {
      return;
    }
    if (!cur || !wb) return;

    const cfg = ensureGameCapsuleSettings(plugin);
    if (rt.expanded) {
      const hitCard =
        cur.x >= wb.x + 4 &&
        cur.x <= wb.x + wb.width - 4 &&
        cur.y >= wb.y + 8 &&
        cur.y <= wb.y + wb.height - 8;
      setHostMousePassThrough(rt, !hitCard);
      return;
    }

    const midY = wb.y + wb.height / 2;
    const pillShowing = Boolean(rt.hoverAwake || rt.greetingActive);
    const zoneW = pillShowing
      ? Math.min(wb.width, 268 + cfg.edgeMargin)
      : Math.max(28, cfg.stripWidth + cfg.edgeMargin + 24);
    const zoneH = pillShowing ? Math.max(cfg.stripHeight + 46, 72) : cfg.stripHeight + 44;

    const x0 = cfg.dockSide === "left" ? wb.x - 8 : wb.x + wb.width - zoneW;
    const x1 = cfg.dockSide === "left" ? wb.x + zoneW : wb.x + wb.width + 8;
    const y0 = midY - zoneH / 2;
    const y1 = midY + zoneH / 2;

    const near = cur.x >= x0 && cur.x <= x1 && cur.y >= y0 && cur.y <= y1;
    setHostMousePassThrough(rt, !near);
    if (rt.hoverAwake !== near) {
      rt.hoverAwake = near;
      try {
        rt.win.webContents.send("bm-host-hover", { awake: near });
      } catch (_) {}
    }
  }, 90);
}

function stopOverlayWatchers(rt) {
  if (!rt) return;
  if (rt.cursorTimer) {
    clearInterval(rt.cursorTimer);
    rt.cursorTimer = null;
  }
  if (rt.greetingClearTimer) {
    clearTimeout(rt.greetingClearTimer);
    rt.greetingClearTimer = null;
  }
  clearZOrderBurstTimers(rt);
}

function handleCapsuleIpcMessage(plugin, msg) {
  if (!plugin || !msg || typeof msg !== "object") return;
  const rt = getRuntime(plugin);
  const cfg = ensureGameCapsuleSettings(plugin);
  const remote = getElectronRemote();
  if (!remote) return;

  if (msg.type === "capsule-ready") {
    rt.winReady = true;
    if (rt.pendingSyncPayload) {
      const pending = rt.pendingSyncPayload;
      rt.pendingSyncPayload = null;
      try {
        rt.win.webContents.send("bm-host-state", pending);
      } catch (_) {}
    } else {
      broadcastToCapsuleWindow(plugin);
    }
    return;
  }

  if (msg.type === "set-ignore-mouse") {
    setHostMousePassThrough(rt, Boolean(msg.ignore));
    return;
  }

  if (msg.type === "set-focusable") {
    if (rt.win && !rt.win.isDestroyed()) {
      const want = Boolean(msg.focusable);
      rt.focusOwnedNow = want;
      if (want) {
        (async () => {
          await applyTempTaskbarAutoHideIfPermitted(plugin);
          if (!rt.win || rt.win.isDestroyed()) return;
          try {
            rt.win.setFocusable(true);
            reassertCapsuleTopmost(rt);
            rt.win.focus();
          } catch (_) {}
        })();
      } else {
        try {
          rt.win.blur();
          rt.win.setFocusable(false);
          reassertCapsuleTopmost(rt);
        } catch (_) {}
        if (!rt.expanded) {
          restoreTempTaskbarAutoHide(plugin);
        }
      }
    }
    return;
  }

  if (msg.type === "set-expanded") {
    rt.expanded = Boolean(msg.expanded);
    if (!rt.expanded && rt.win && !rt.win.isDestroyed()) {
      rt.focusOwnedNow = false;
      try {
        rt.win.blur();
        rt.win.setFocusable(false);
        setHostMousePassThrough(rt, true);
        reassertCapsuleTopmost(rt);
      } catch (_) {}
      restoreTempTaskbarAutoHide(plugin);
    } else if (rt.expanded) {
      setHostMousePassThrough(rt, false);
      reassertCapsuleTopmost(rt);
      applyTempTaskbarAutoHideIfPermitted(plugin);
    }
    broadcastToCapsuleWindow(plugin);
    return;
  }

  if (msg.type === "set-pinned") {
    rt.pinned = Boolean(msg.pinned);
    broadcastToCapsuleWindow(plugin);
    return;
  }

  if (msg.type === "close-preview") {
    retireCapsuleWindowSmoothly(plugin);
    return;
  }

  if (msg.type === "drag-start") {
    if (!rt.win || rt.win.isDestroyed()) return;
    if (rt.snapAnimTimer) {
      clearInterval(rt.snapAnimTimer);
      rt.snapAnimTimer = null;
    }
    rt.dragging = true;
    setHostMousePassThrough(rt, false);
    rt.dragBaseCursor = remote.screen.getCursorScreenPoint();
    rt.dragBaseWinPos = rt.win.getPosition();
    return;
  }

  if (msg.type === "drag-move") {
    if (!rt.win || rt.win.isDestroyed() || !rt.dragBaseCursor || !rt.dragBaseWinPos) return;
    const cur = remote.screen.getCursorScreenPoint();
    const nx = rt.dragBaseWinPos[0] + (cur.x - rt.dragBaseCursor.x);
    const ny = rt.dragBaseWinPos[1] + (cur.y - rt.dragBaseCursor.y);
    try {
      rt.win.setPosition(Math.round(nx), Math.round(ny));
    } catch (_) {}
    return;
  }

  if (msg.type === "drag-end") {
    rt.dragging = false;
    rt.userDraggedThisSession = true;
    if (!rt.win || rt.win.isDestroyed()) return;
    const cur = remote.screen.getCursorScreenPoint();
    const disp = remote.screen.getDisplayNearestPoint(cur);
    const b = disp.bounds;
    const [, curWinY] = rt.win.getPosition();
    const winBounds = rt.win.getBounds();
    const midY = curWinY + winBounds.height / 2;

    cfg.dockDisplayId = disp.id;
    cfg.dockSide = cur.x < b.x + b.width / 2 ? "left" : "right";
    cfg.dockRatioY = clampNum((midY - b.y) / b.height, 0.08, 0.88, 0.42);
    plugin.saveSettings().catch(() => {});

    const targetRect = computeDockedWindowRect(disp, cfg);
    broadcastToCapsuleWindow(plugin);
    animateWindowToPosition(rt, targetRect.x, targetRect.y, 290, () => {
      reassertCapsuleTopmost(rt);
    });
    return;
  }

  if (msg.type === "update-capsule-cfg") {
    if (msg.idleOpacity !== undefined) {
      cfg.idleOpacity = Math.round(clampNum(msg.idleOpacity, 0, 100, cfg.idleOpacity));
    }
    if (msg.edgeMargin !== undefined) {
      cfg.edgeMargin = Math.round(clampNum(msg.edgeMargin, 0, 28, cfg.edgeMargin));
    }
    if (msg.stripWidth !== undefined) {
      cfg.stripWidth = Math.round(clampNum(msg.stripWidth, 4, 14, cfg.stripWidth));
    }
    if (msg.stripHeight !== undefined) {
      cfg.stripHeight = Math.round(clampNum(msg.stripHeight, 52, 148, cfg.stripHeight));
    }
    if (msg.taskbarPolicy === "auto_hide" || msg.taskbarPolicy === "keep_system") {
      cfg.taskbarPolicy = msg.taskbarPolicy;
      if (cfg.taskbarPolicy === "auto_hide" && (rt.expanded || rt.focusOwnedNow)) {
        applyTempTaskbarAutoHideIfPermitted(plugin);
      } else if (cfg.taskbarPolicy === "keep_system") {
        restoreTempTaskbarAutoHide(plugin);
      }
    }
    plugin.saveSettings().catch(() => {});
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, rt.activeGameId, "capsule");
    return;
  }

  if (msg.type === "open-external" && msg.url) {
    try {
      const electron = tryRequireNode("electron");
      if (electron?.shell?.openExternal) electron.shell.openExternal(msg.url);
    } catch (_) {}
    return;
  }

  // 以下为游戏数据双向镜像同步操作
  const game = findGameForCapsule(plugin, rt.activeGameId);
  if (!game) return;
  const ui = plugin.__gameJournalUi || (plugin.__gameJournalUi = { tabByGame: {}, drafts: {}, showDone: false });

  if (msg.type === "set-tab" && msg.tab) {
    ui.tabByGame[game.id] = msg.tab;
    return;
  }

  if (msg.type === "draft-input") {
    ui.drafts[game.id] = String(msg.text || "");
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "update-meta") {
    if (msg.status !== undefined) game.status = String(msg.status || "在玩");
    if (msg.currentProgress !== undefined) game.currentProgress = String(msg.currentProgress || "");
    if (msg.playHours !== undefined) game.playHours = Math.max(0, Math.round((Number(msg.playHours) || 0) * 100) / 100);
    if (msg.score !== undefined) {
      if (msg.score === "") delete game.score;
      else game.score = Math.min(10, Math.max(0, Math.round((Number(msg.score) || 0) * 10) / 10));
    }
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "add-note") {
    const text = String(msg.text || "").trim();
    if (!text) return;
    if (!Array.isArray(game.playNotes)) game.playNotes = [];
    const now = new Date();
    const hours = Math.round(Math.max(0, Number(game.playHours) || 0) * 10) / 10;
    const chapter = String(game.currentProgress || "").trim();
    game.playNotes.unshift({
      id: `gnote-${Date.now()}`,
      text,
      hours,
      hoursAtNote: hours,
      chapter,
      createdAt: now.toISOString(),
      progressTag: chapter ? `${hours}h · ${chapter}` : `${hours}h`,
      timeLabel: now.toLocaleString("zh-CN", { hour12: false })
    });
    ui.drafts[game.id] = "";
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "delete-note") {
    if (!Array.isArray(game.playNotes)) return;
    game.playNotes = game.playNotes.filter((n) => (msg.id ? n.id !== msg.id : n.text !== msg.text));
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "add-todo") {
    const text = String(msg.text || "").trim();
    if (!text) return;
    if (!Array.isArray(game.todos)) game.todos = [];
    const now = new Date();
    const hours = Math.round(Math.max(0, Number(game.playHours) || 0) * 10) / 10;
    const chapter = String(game.currentProgress || "").trim();
    game.todos.unshift({
      id: `todo-${Date.now()}`,
      text,
      done: false,
      hours,
      hoursAtNote: hours,
      chapter,
      createdAt: now.toISOString(),
      progressTag: chapter ? `${hours}h · ${chapter}` : `${hours}h`,
      timeLabel: now.toLocaleString("zh-CN", { hour12: false })
    });
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "toggle-todo") {
    if (!Array.isArray(game.todos)) return;
    const hit = game.todos.find((t) => t && t.id === msg.id);
    if (!hit) return;
    hit.done = Boolean(msg.done);
    if (hit.done) hit.doneAt = new Date().toISOString();
    else delete hit.doneAt;
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "delete-todo") {
    if (!Array.isArray(game.todos)) return;
    game.todos = game.todos.filter((t) => t && t.id !== msg.id);
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "add-guide") {
    let url = String(msg.url || "").trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./i, "");
    } catch (_) {}
    if (!Array.isArray(game.strategyUrls)) game.strategyUrls = [];
    game.strategyUrls.push({
      id: `guide-${Date.now()}`,
      title: host,
      url,
      remark: ""
    });
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
    return;
  }

  if (msg.type === "delete-guide") {
    if (!Array.isArray(game.strategyUrls)) return;
    game.strategyUrls = game.strategyUrls.filter((g) => (msg.id ? g.id !== msg.id : g.url !== msg.url));
    persistCapsuleGameMutation(plugin, game);
    broadcastToCapsuleWindow(plugin);
    notifyObsidianViewsUpdated(plugin, game.id, "capsule");
  }
}

function ensureCapsuleWindowMounted(plugin, opts = {}) {
  const remote = getElectronRemote();
  if (!remote) return null;
  const rt = getRuntime(plugin);
  const cfg = ensureGameCapsuleSettings(plugin);

  if (rt.retireTimer) {
    clearTimeout(rt.retireTimer);
    rt.retireTimer = null;
  }
  rt.retiring = false;
  rt.concealed = Boolean(opts.concealed);
  if (opts.gameId) rt.activeGameId = opts.gameId;
  if (opts.source) rt.activeSource = opts.source;
  if (typeof opts.expanded === "boolean") rt.expanded = opts.expanded;
  if (opts.greet && !opts.concealed) {
    markGreetingActive(rt, 2400);
  }

  const disp = resolveTargetDisplay(remote, cfg);
  const rect = computeDockedWindowRect(disp, cfg);

  if (rt.win && !rt.win.isDestroyed()) {
    try {
      rt.win.setPosition(rect.x, rect.y);
      reassertCapsuleTopmost(rt);
    } catch (_) {}
    startOverlayWatchers(plugin);
    broadcastToCapsuleWindow(plugin, {
      concealed: rt.concealed,
      greetOnArrive: Boolean(opts.greet && !rt.concealed),
      greetingText: opts.greetingText || ""
    });
    return rt.win;
  }

  const htmlPath = ensureCapsuleHostHtmlFile(plugin);
  if (!htmlPath) return null;

  rt.winReady = false;
  rt.hostPassThrough = true;
  rt.hoverAwake = false;
  rt.focusOwnedNow = false;

  const win = new remote.BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    type: "toolbar",
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  rt.win = win;
  rt.pendingSyncPayload = buildCapsuleStatePayload(plugin, {
    concealed: rt.concealed,
    greetOnArrive: Boolean(opts.greet && !rt.concealed),
    greetingText: opts.greetingText || ""
  });

  win.webContents.on("ipc-message", (_ev, channel, payload) => {
    if (channel === "bm-cap-msg") {
      handleCapsuleIpcMessage(plugin, payload);
    }
  });

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    try {
      reassertCapsuleTopmost(rt);
      win.setIgnoreMouseEvents(true, { forward: true });
      win.showInactive();
      reassertCapsuleTopmost(rt);
    } catch (_) {
      try {
        win.show();
      } catch (_2) {}
    }
    startOverlayWatchers(plugin);
  });

  win.on("closed", () => {
    if (rt.win === win) {
      stopOverlayWatchers(rt);
      rt.win = null;
      rt.winReady = false;
      rt.expanded = false;
      rt.focusOwnedNow = false;
      rt.dragging = false;
      restoreTempTaskbarAutoHide(plugin);
    }
  });

  win.loadFile(htmlPath).catch(() => {});
  return win;
}

function destroyCapsuleWindow(plugin) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt) return;
  if (rt.retireTimer) {
    clearTimeout(rt.retireTimer);
    rt.retireTimer = null;
  }
  stopOverlayWatchers(rt);
  if (rt.snapAnimTimer) {
    clearInterval(rt.snapAnimTimer);
    rt.snapAnimTimer = null;
  }
  if (rt.win && !rt.win.isDestroyed()) {
    try {
      rt.win.destroy();
    } catch (_) {}
  }
  rt.win = null;
  rt.winReady = false;
  rt.concealed = false;
  rt.retiring = false;
  rt.expanded = false;
  rt.focusOwnedNow = false;
  rt.dragging = false;
  rt.hoverAwake = false;
  rt.activeSource = "";
  restoreTempTaskbarAutoHide(plugin);
}

function retireCapsuleWindowSmoothly(plugin) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt || !rt.win || rt.win.isDestroyed()) {
    destroyCapsuleWindow(plugin);
    return;
  }
  if (rt.retiring) return;
  rt.retiring = true;
  rt.focusOwnedNow = false;
  try {
    rt.win.blur();
    rt.win.setFocusable(false);
    rt.win.setIgnoreMouseEvents(true, { forward: true });
    rt.win.webContents.send("bm-host-retire");
  } catch (_) {}
  restoreTempTaskbarAutoHide(plugin);
  if (rt.retireTimer) clearTimeout(rt.retireTimer);
  rt.retireTimer = setTimeout(() => {
    rt.retireTimer = null;
    destroyCapsuleWindow(plugin);
  }, 270);
}

/* ==================== 游戏启动、壳进程交接与退出联动入口 ==================== */

function closeAnyOpenGameStatsDrawers() {
  if (typeof document === "undefined" || !document.body) return;
  try {
    const v07Core = require("./v07-core.js");
    if (v07Core && typeof v07Core.closeAllPopovers === "function") {
      v07Core.closeAllPopovers();
    }
  } catch (_) {}
  try {
    document.body.querySelectorAll(":scope > .bm7-drawer").forEach((drawer) => {
      drawer.classList.add("is-leaving");
      setTimeout(() => {
        try {
          drawer.remove();
        } catch (_) {}
      }, 220);
    });
  } catch (_) {}
}

function activateGameSideCapsule(plugin, game, opts = {}) {
  if (!plugin || !isDesktopCapsuleSupported()) return false;
  const cfg = ensureGameCapsuleSettings(plugin);
  const isPreview = opts.source === "preview";
  if (!cfg.enabled && !isPreview) return false;

  const rt = getRuntime(plugin);
  const gameId = game && game.id ? game.id : null;
  if (!isPreview) {
    rt.userDraggedThisSession = false;
    closeAnyOpenGameStatsDrawers();
  }
  const openModalHook = gameId ? rt.inModalListeners.get(gameId) : null;

  // 若馆内正打开该游戏的手札弹窗：预热侧边浮窗 + 播放面板向屏幕侧边收拢凝结动效，零空窗无缝点亮胶囊
  if (openModalHook && typeof openModalHook.collapseToEdge === "function") {
    ensureCapsuleWindowMounted(plugin, {
      gameId,
      source: opts.source || "internal",
      expanded: false,
      concealed: true,
      greet: false
    });
    schedulePostLaunchWindowChecks(plugin, game);
    openModalHook.collapseToEdge(cfg.dockSide, cfg.dockRatioY, () => {
      rt.concealed = false;
      markGreetingActive(rt, 2500);
      reassertCapsuleTopmost(rt);
      broadcastToCapsuleWindow(plugin, {
        concealed: false,
        greetOnArrive: true,
        greetingText: "已收至侧边 · 点此展开"
      });
    });
    return true;
  }

  ensureCapsuleWindowMounted(plugin, {
    gameId,
    source: opts.source || "internal",
    expanded: Boolean(opts.expanded),
    concealed: false,
    greet: !opts.expanded,
    greetingText: isPreview ? "拖拽可吸附任意屏幕边缘" : "手札已在侧边就位"
  });
  schedulePostLaunchWindowChecks(plugin, game);
  return true;
}

function deactivateGameSideCapsule(plugin, gameId = null) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt) return;
  if (gameId && rt.activeGameId && rt.activeGameId !== gameId && rt.activeSource !== "preview") {
    return;
  }
  if (!gameId || (rt.adoptedSession && rt.adoptedSession.gameId === gameId)) {
    rt.adoptedSession = null;
  }
  if (!gameId || (rt.protocolWatch && rt.protocolWatch.gameId === gameId)) {
    rt.protocolWatch = null;
  }
  retireCapsuleWindowSmoothly(plugin);
}

function ensureProcessPollLoop(plugin) {
  if (!plugin || !isDesktopCapsuleSupported()) return;
  const rt = getRuntime(plugin);
  if (rt.pollTimer) return;
  rt.pollTimer = setInterval(() => {
    pollExternalGameProcessesOnce(plugin);
  }, PROCESS_POLL_MS);
}

/**
 * 防止 Steam DRM 重启（SteamAPI_RestartAppIfNecessary）或 WeGame/启动器壳进程秒退误杀侧边胶囊：
 * 当直接 spawn 的初始进程较快退出时，延迟复核同目录/映射表内的真实游戏进程是否仍在运行。
 * 若真实游戏仍在运行，则无缝接管本次会话与时长结算，直至游戏真正退出。
 */
async function handleSpawnedProcessClosed(plugin, game, sessionCtx = {}) {
  if (!plugin || !game || !game.id || !isDesktopCapsuleSupported()) {
    return { adopted: false };
  }
  const rt = getRuntime(plugin);
  const candidateExes = collectCandidateExesForGame(plugin, game, sessionCtx.spawnedExePath || "");
  if (!candidateExes || candidateExes.size === 0) {
    return { adopted: false };
  }

  const elapsedMs = Date.now() - (Number(sessionCtx.startTs) || Date.now());
  if (elapsedMs < 25000) {
    await new Promise((r) => setTimeout(r, 2800));
  }

  const runningSet = await queryRunningProcessNamesWin32();
  if (!runningSet) return { adopted: false };

  let stillRunning = false;
  for (const exeLower of candidateExes) {
    if (runningSet.has(exeLower)) {
      stillRunning = true;
      break;
    }
  }
  if (!stillRunning) {
    return { adopted: false };
  }

  rt.activeGameId = game.id;
  rt.activeSource = "internal";
  rt.adoptedSession = {
    gameId: game.id,
    candidateExes,
    finalizeSession: typeof sessionCtx.finalizeSession === "function" ? sessionCtx.finalizeSession : null
  };
  ensureProcessPollLoop(plugin);
  schedulePostLaunchWindowChecks(plugin, game);
  return { adopted: true };
}

/**
 * 当通过 steam:// / .url 桌面快捷方式启动游戏时，注册后台进程监控：
 * 游戏窗口出现后自动跟随显示器，且当游戏真正退出后自动结束计时并平滑收起侧边胶囊。
 */
function notifyProtocolOrShortcutLaunch(plugin, game) {
  if (!plugin || !game || !game.id || !isDesktopCapsuleSupported()) return;
  const rt = getRuntime(plugin);
  const candidateExes = collectCandidateExesForGame(plugin, game);
  if (candidateExes.size > 0) {
    rt.protocolWatch = {
      gameId: game.id,
      candidateExes,
      expiresAtMs: Date.now() + 60000,
      seenRunning: false
    };
    ensureProcessPollLoop(plugin);
  }
  schedulePostLaunchWindowChecks(plugin, game);
}

function openCapsulePreview(plugin, preferredGame = null) {
  if (!isDesktopCapsuleSupported()) {
    if (Notice) new Notice("桌面侧边手札胶囊仅在桌面端 Obsidian 中可用。");
    return;
  }
  const game = preferredGame || findGameForCapsule(plugin, null);
  activateGameSideCapsule(plugin, game, { source: "preview", expanded: false });
  if (Notice) {
    const cfg = ensureGameCapsuleSettings(plugin);
    const sideLabel = cfg.dockSide === "left" ? "左侧" : "右侧";
    new Notice(`已在屏幕${sideLabel}唤出侧边手札胶囊预览（移近亮显、点击展开、按住可跨显示器拖动）`);
  }
}

function isCapsuleActiveForGame(plugin, gameId) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt || !rt.win || rt.win.isDestroyed() || rt.retiring) return false;
  return !gameId || rt.activeGameId === gameId;
}

function expandActiveCapsuleForGame(plugin, game) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (!rt || !rt.win || rt.win.isDestroyed() || rt.retiring) return false;
  if (game && game.id) rt.activeGameId = game.id;
  rt.expanded = true;
  setHostMousePassThrough(rt, false);
  reassertCapsuleTopmost(rt);
  applyTempTaskbarAutoHideIfPermitted(plugin);
  broadcastToCapsuleWindow(plugin);
  return true;
}

/* ==================== 后台轻量外部游戏进程感知与壳进程接管守护 ==================== */

async function pollExternalGameProcessesOnce(plugin) {
  const rt = getRuntime(plugin);
  if (rt.pollingBusy || !isDesktopCapsuleSupported()) return;
  const cfg = ensureGameCapsuleSettings(plugin);
  const hasInternalWatch = Boolean(rt.adoptedSession || rt.protocolWatch);
  if (!hasInternalWatch && (!cfg.enabled || !cfg.autoDetectExternalProcess)) return;

  const exeMap = buildTrackableExeMap(plugin);
  if (!hasInternalWatch && (!exeMap || exeMap.size === 0)) return;

  rt.pollingBusy = true;
  try {
    const runningSet = await queryRunningProcessNamesWin32();
    if (!runningSet) return;

    // 0A. 检查接管的壳进程/Steam 重启会话是否仍在运行
    if (rt.adoptedSession) {
      const { gameId, candidateExes, finalizeSession } = rt.adoptedSession;
      let alive = false;
      for (const exeLower of candidateExes) {
        if (runningSet.has(exeLower)) {
          alive = true;
          break;
        }
      }
      if (alive) return;

      rt.adoptedSession = null;
      deactivateGameSideCapsule(plugin, gameId);
      if (typeof finalizeSession === "function") {
        try {
          await finalizeSession();
        } catch (_) {}
      }
      if (!cfg.enabled || !cfg.autoDetectExternalProcess) {
        refreshGameCapsuleLifecycle(plugin);
      }
      return;
    }

    // 0B. 检查通过 steam:// 或 .url 启动的协议游戏进程生命周期
    if (rt.protocolWatch) {
      const pw = rt.protocolWatch;
      let alive = false;
      for (const exeLower of pw.candidateExes) {
        if (runningSet.has(exeLower)) {
          alive = true;
          break;
        }
      }
      if (alive) {
        if (!pw.seenRunning) {
          pw.seenRunning = true;
          const g = findGameForCapsule(plugin, pw.gameId);
          if (g) locateGameWindowAndAssertTop(plugin, g);
        }
        return;
      }
      if (pw.seenRunning) {
        rt.protocolWatch = null;
        const g = findGameForCapsule(plugin, pw.gameId);
        if (g) {
          try {
            const gs = require("./game-stats-and-groups-service.js");
            const mh = require("./multi-hall-archive-service.js");
            if (gs.getActiveGameTimer(plugin, g.id)) {
              await gs.stopActiveGameTimer(plugin, g, async (p, gm) => {
                if (typeof mh.syncGameMarkdownNote === "function") {
                  await mh.syncGameMarkdownNote(p, gm);
                }
              });
              notifyObsidianViewsUpdated(plugin, g.id, "capsule");
            } else {
              deactivateGameSideCapsule(plugin, g.id);
            }
          } catch (_) {
            deactivateGameSideCapsule(plugin, g.id);
          }
        }
        return;
      }
      if (Date.now() > pw.expiresAtMs) {
        rt.protocolWatch = null;
      }
    }

    if (!cfg.enabled || !cfg.autoDetectExternalProcess) return;

    // 1. 若当前正跟踪一个外部直接启动的游戏，检查是否仍在运行（兼容同目录其他子进程接力）
    if (rt.activeSource === "external" && rt.activeGameId) {
      const trackedGame = findGameForCapsule(plugin, rt.activeGameId);
      const candSet = trackedGame ? collectCandidateExesForGame(plugin, trackedGame) : new Set();
      if (rt.externalMatchedExe) candSet.add(rt.externalMatchedExe);
      let stillAlive = false;
      for (const exeLower of candSet) {
        if (runningSet.has(exeLower)) {
          stillAlive = true;
          break;
        }
      }
      if (stillAlive) {
        return;
      }
      // 外部启动的游戏已退出：自动累加游玩时长并平滑收起胶囊
      const finishedGame = trackedGame;
      const startedMs = rt.externalSessionStartMs;
      rt.externalMatchedExe = "";
      rt.externalSessionStartMs = 0;
      deactivateGameSideCapsule(plugin, finishedGame ? finishedGame.id : null);

      if (finishedGame && startedMs > 0) {
        const elapsedMin = Math.max(1, Math.round((Date.now() - startedMs) / 60000));
        const elapsedHours = Number((elapsedMin / 60).toFixed(2));
        const startIso = new Date(startedMs).toISOString();
        const endIso = new Date().toISOString();
        if (!Array.isArray(finishedGame.playSessions)) finishedGame.playSessions = [];
        finishedGame.playSessions.unshift({
          id: `ses-${Date.now().toString(36)}`,
          start: startIso,
          startedAt: startIso,
          endedAt: endIso,
          minutes: elapsedMin,
          durationHours: elapsedHours,
          source: "auto",
          mode: "auto",
          note: "桌面快捷方式启动自动记录"
        });
        finishedGame.playHours = Number(((Number(finishedGame.playHours) || 0) + elapsedHours).toFixed(2));
        finishedGame.lastPlayedAt = endIso;
        if (!finishedGame.firstPlayedAt) finishedGame.firstPlayedAt = startIso;
        await persistCapsuleGameMutation(plugin, finishedGame);
        notifyObsidianViewsUpdated(plugin, finishedGame.id, "capsule");
      }
      return;
    }

    // 2. 若当前已有插件内启动的活跃胶囊，不重复抢占
    if (rt.win && !rt.win.isDestroyed() && rt.activeSource === "internal") {
      return;
    }

    // 3. 检测是否有已收录游戏刚刚在外部启动
    for (const [exeLower, game] of exeMap.entries()) {
      if (runningSet.has(exeLower)) {
        rt.activeGameId = game.id;
        rt.activeSource = "external";
        rt.externalMatchedExe = exeLower;
        rt.externalSessionStartMs = Date.now();
        activateGameSideCapsule(plugin, game, { source: "external" });
        break;
      }
    }
  } finally {
    rt.pollingBusy = false;
  }
}

function refreshGameCapsuleLifecycle(plugin) {
  if (!plugin || !isDesktopCapsuleSupported()) return;
  const rt = getRuntime(plugin);
  const cfg = ensureGameCapsuleSettings(plugin);

  // 异常退出遗留的系统任务栏自动隐藏自愈还原
  if (cfg.taskbarTempApplied && !rt.taskbarSuppressedNow) {
    restoreTempTaskbarAutoHide(plugin, true);
  }

  if (rt.pollTimer) {
    clearInterval(rt.pollTimer);
    rt.pollTimer = null;
  }

  if (!cfg.enabled) {
    rt.protocolWatch = null;
    if (rt.activeSource !== "preview" && !rt.adoptedSession) {
      retireCapsuleWindowSmoothly(plugin);
    }
    if (rt.adoptedSession) {
      ensureProcessPollLoop(plugin);
    }
    return;
  }

  if (cfg.autoDetectExternalProcess || rt.adoptedSession || rt.protocolWatch) {
    ensureProcessPollLoop(plugin);
    setTimeout(() => pollExternalGameProcessesOnce(plugin), 1200);
  }
}

function stopGameCapsuleService(plugin) {
  const rt = plugin ? plugin._bmGameCapsuleRuntime : null;
  if (rt) {
    if (rt.pollTimer) {
      clearInterval(rt.pollTimer);
      rt.pollTimer = null;
    }
    rt.adoptedSession = null;
    rt.protocolWatch = null;
  }
  destroyCapsuleWindow(plugin);
  restoreTempTaskbarAutoHide(plugin);
}

module.exports = {
  DEFAULT_GAME_CAPSULE_SETTINGS,
  ensureGameCapsuleSettings,
  isDesktopCapsuleSupported,
  promptTaskbarPolicyIfNeeded,
  registerOpenJournalModalHook,
  registerGameStageRefreshHook,
  notifyObsidianViewsUpdated,
  broadcastToCapsuleWindow,
  activateGameSideCapsule,
  deactivateGameSideCapsule,
  handleSpawnedProcessClosed,
  notifyProtocolOrShortcutLaunch,
  openCapsulePreview,
  isCapsuleActiveForGame,
  expandActiveCapsuleForGame,
  refreshGameCapsuleLifecycle,
  stopGameCapsuleService
};
