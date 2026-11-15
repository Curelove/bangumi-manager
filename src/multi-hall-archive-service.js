const { requestUrl, Notice, Modal, Menu } = require("obsidian");
const { openLocalPathSafely, inspectLocalFolder } = require("./note-utils.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const reviewStudioService = require("./review-studio-service.js");
const v07Core = require("./v07-core.js");
const { paperSlipSwap } = require("./v08-motion-and-lens.js");
const { renderGallerySanctuary } = require("./v08-gallery-sanctuary.js");
const {
  tryRequireNode,
  isMobileEnv,
  isDesktopNodeAvailable,
  crossPlatformPath: path,
  crossPlatformFs: fs,
  normalizeVaultRelPath,
  toNodeBufferOrUint8,
  writeVaultBinaryFile
} = require("./platform-env.js");

function spawn(...args) {
  const cp = tryRequireNode("child_process");
  if (!cp || typeof cp.spawn !== "function") {
    throw new Error("当前移动端环境不支持本地 FFmpeg 进程调用");
  }
  return cp.spawn(...args);
}

const BGM_USER_AGENT = "BangumiManagerObsidianPlugin/1.4 (https://github.com/bangumi-manager)";

/**
 * 获取当前 Obsidian 仓库的本地磁盘绝对根目录（移动端安全返回空串）
 */
function getVaultBasePath(plugin) {
  if (!isDesktopNodeAvailable()) return "";
  try {
    const adapter = plugin?.app?.vault?.adapter;
    if (adapter && typeof adapter.getBasePath === "function") {
      return adapter.getBasePath();
    }
  } catch (e) {}
  return "";
}

/**
 * 解析音声典藏默认目录（向后兼容已有仓库的「附件/台词音声库」，新仓库默认使用「附件/音声典藏」）
 */
function resolveDefaultVoiceArchiveFolder(plugin) {
  const configured = String(plugin?.settings?.voiceArchiveFolder || "").trim();
  if (configured && configured !== "附件/台词音声库") return configured;
  try {
    if (plugin?.app?.vault?.getAbstractFileByPath?.("附件/台词音声库")) {
      return "附件/台词音声库";
    }
    if (isDesktopNodeAvailable()) {
      const vb = getVaultBasePath(plugin);
      if (vb && fs.existsSync(path.join(vb, "附件", "台词音声库"))) {
        return "附件/台词音声库";
      }
    }
  } catch (_) {}
  if (
    configured === "附件/台词音声库" &&
    Array.isArray(plugin?.settings?.voiceCollection) &&
    plugin.settings.voiceCollection.some((v) => String(v?.audioPath || "").includes("台词音声库"))
  ) {
    return "附件/台词音声库";
  }
  return "附件/音声典藏";
}

/**
 * 将本地绝对路径或仓库内相对路径转换为浏览器可渲染的 URL
 */
function resolveLocalOrVaultImageUrl(plugin, rawPath, cacheBustToken = "") {
  const raw = String(rawPath || "").trim();
  if (!raw) return "";
  const appendBust = (u) => {
    if (!u || !cacheBustToken) return u;
    return `${u}${u.includes("?") ? "&" : "?"}_v=${encodeURIComponent(String(cacheBustToken))}`;
  };
  if (/^(?:https?:|data:|app:|capacitor:|file:)/i.test(raw)) return appendBust(raw);
  const normalized = raw.replace(/\\/g, "/");
  try {
    const adapter = plugin?.app?.vault?.adapter;
    if (!/^[A-Za-z]:\//.test(normalized) && adapter && typeof adapter.getResourcePath === "function") {
      return appendBust(adapter.getResourcePath(normalized.replace(/^\//, "")));
    }
    const vaultBase = getVaultBasePath(plugin).replace(/\\/g, "/").replace(/\/$/, "");
    if (vaultBase && normalized.toLowerCase().startsWith(vaultBase.toLowerCase() + "/")) {
      const rel = normalized.slice(vaultBase.length + 1);
      if (adapter && typeof adapter.getResourcePath === "function") {
        return appendBust(adapter.getResourcePath(rel));
      }
    }
  } catch (e) {}
  if (/^[A-Za-z]:\//.test(normalized)) {
    return appendBust("file:///" + encodeURI(normalized));
  }
  return appendBust(raw);
}

/**
 * 将仓库内相对路径或磁盘路径统一解析为本地磁盘绝对路径（远程 URL 返回空串）
 */
function resolveLocalFileAbsolutePath(plugin, rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw || /^(?:https?:|data:|app:|capacitor:|blob:)/i.test(raw)) return "";
  if (/^file:\/\/\//i.test(raw)) {
    try {
      return path.normalize(decodeURI(raw.replace(/^file:\/\/\//i, "")));
    } catch (_) {
      return "";
    }
  }
  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }
  const vaultBase = getVaultBasePath(plugin);
  if (!vaultBase) return "";
  return path.normalize(path.join(vaultBase, raw.replace(/^[/\\]+/, "")));
}

function normalizeVaultRelPathCaseInsensitive(plugin, rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw || /^(?:https?:|data:)/i.test(raw)) return "";
  const vaultBase = getVaultBasePath(plugin).replace(/\\/g, "/").replace(/\/$/, "");
  const norm = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (vaultBase && norm.toLowerCase().startsWith(vaultBase.toLowerCase() + "/")) {
    return norm.slice(vaultBase.length + 1).toLowerCase();
  }
  return norm.toLowerCase();
}

function markSelfMediaPathBusy(plugin, absOrRelPath, durationMs = 1600) {
  if (!plugin || !absOrRelPath) return;
  if (!plugin._selfMediaBusyPaths) {
    plugin._selfMediaBusyPaths = new Set();
  }
  const key1 = String(absOrRelPath).replace(/\\/g, "/").toLowerCase();
  const abs = resolveLocalFileAbsolutePath(plugin, absOrRelPath);
  const key2 = abs ? abs.replace(/\\/g, "/").toLowerCase() : "";
  if (key1) plugin._selfMediaBusyPaths.add(key1);
  if (key2) plugin._selfMediaBusyPaths.add(key2);
  setTimeout(() => {
    if (!plugin._selfMediaBusyPaths) return;
    if (key1) plugin._selfMediaBusyPaths.delete(key1);
    if (key2) plugin._selfMediaBusyPaths.delete(key2);
  }, durationMs);
}

function isSelfMediaPathBusy(plugin, absOrRelPath) {
  if (!plugin?._selfMediaBusyPaths || !absOrRelPath) return false;
  const key1 = String(absOrRelPath).replace(/\\/g, "/").toLowerCase();
  if (plugin._selfMediaBusyPaths.has(key1)) return true;
  const abs = resolveLocalFileAbsolutePath(plugin, absOrRelPath);
  if (abs && plugin._selfMediaBusyPaths.has(abs.replace(/\\/g, "/").toLowerCase())) return true;
  return false;
}

/**
 * 在系统文件资源管理器中打开并高亮选中对应本地文件（若文件不存在则打开父目录）
 */
async function revealLocalFileInExplorer(plugin, rawPath) {
  if (!isDesktopNodeAvailable()) {
    if (Notice) new Notice("当前为移动端环境，暂不支持打开电脑资源管理器。", 3200);
    return false;
  }
  const abs = resolveLocalFileAbsolutePath(plugin, rawPath);
  if (!abs) return false;
  try {
    const electron = tryRequireNode("electron");
    if (electron?.shell && fs.existsSync(abs) && typeof electron.shell.showItemInFolder === "function") {
      electron.shell.showItemInFolder(abs);
      return true;
    }
  } catch (_) {}
  const parentDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  return await openLocalPathSafely(parentDir);
}

/**
 * 安全删除本地媒体文件（优先移入操作系统回收站 / Obsidian 回收站，兜底物理删除；兼容移动端 Vault 回收站）
 */
async function moveLocalFileToTrashSafely(plugin, rawPath) {
  const cleanRelCandidate = !path.isAbsolute(String(rawPath || ""))
    ? String(rawPath || "").replace(/\\/g, "/").replace(/^\/+/, "")
    : "";
  if (!isDesktopNodeAvailable()) {
    if (cleanRelCandidate && plugin?.app?.vault) {
      try {
        const tfile = plugin.app.vault.getAbstractFileByPath(cleanRelCandidate);
        if (tfile && typeof plugin.app.vault.trash === "function") {
          markSelfMediaPathBusy(plugin, cleanRelCandidate, 2200);
          await plugin.app.vault.trash(tfile, true);
          return { existed: true, deleted: true, absPath: cleanRelCandidate, method: "vault-trash" };
        }
      } catch (_) {}
    }
    return { existed: false, deleted: false, absPath: "" };
  }
  const abs = resolveLocalFileAbsolutePath(plugin, rawPath);
  if (!abs || !fs.existsSync(abs)) {
    return { existed: false, deleted: false, absPath: abs };
  }
  markSelfMediaPathBusy(plugin, abs, 2200);
  const vaultBase = getVaultBasePath(plugin);
  let vaultRel = "";
  if (vaultBase && abs.toLowerCase().startsWith(vaultBase.toLowerCase() + path.sep.toLowerCase())) {
    vaultRel = path.relative(vaultBase, abs).replace(/\\/g, "/");
  } else if (cleanRelCandidate) {
    vaultRel = cleanRelCandidate;
  }
  if (vaultRel) {
    markSelfMediaPathBusy(plugin, vaultRel, 2200);
  }

  // 1. 优先通过 Obsidian Vault API 移入系统回收站（同步更新 Obsidian 内部文件索引）
  try {
    if (vaultRel && plugin?.app?.vault) {
      const tfile = plugin.app.vault.getAbstractFileByPath(vaultRel);
      if (tfile && typeof plugin.app.vault.trash === "function") {
        await plugin.app.vault.trash(tfile, true);
        if (!fs.existsSync(abs)) {
          return { existed: true, deleted: true, absPath: abs, method: "vault-trash" };
        }
      }
    }
  } catch (_) {}

  // 2. 尝试通过 Electron shell.trashItem 移入系统回收站
  try {
    const electron = tryRequireNode("electron");
    if (electron?.shell && typeof electron.shell.trashItem === "function" && fs.existsSync(abs)) {
      await electron.shell.trashItem(abs);
      if (!fs.existsSync(abs)) {
        return { existed: true, deleted: true, absPath: abs, method: "electron-trash" };
      }
    }
  } catch (_) {}

  // 3. 兜底直接移除磁盘文件
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    return { existed: true, deleted: !fs.existsSync(abs), absPath: abs, method: "fs-unlink" };
  } catch (err) {
    console.warn("[BangumiManager] 删除本地文件失败:", abs, err);
    return { existed: true, deleted: false, absPath: abs, error: err };
  }
}

/**
 * Aves 自适应完整画报墙核心排版引擎（Justified Photo Wall Engine）
 * 按容器当前真实宽度动态计算每一行的最优行高与卡片精确宽度：
 *  - 每一满行同时等比例缩放行高 H_row 与卡片宽度 w_k = r_k * H_row，确保卡片宽高比 === 原图真实宽高比
 *  - 彻底消除开合侧边栏/窗口变化时因固定高度横向拉伸导致的图片两侧空边，同时保持零裁切完整画幅
 */
function layoutAvesJustifiedGrid(gridEl, tilesMeta, options = {}) {
  if (!gridEl || !Array.isArray(tilesMeta) || tilesMeta.length === 0) return false;
  gridEl.classList.add("is-aves-justified");

  const targetH = Math.max(110, Number(options.targetRowHeight) || 240);
  const gap = Math.max(0, Number(options.gap) ?? 8);
  const minAspect = Number(options.minAspect) || 0.25;
  const maxAspect = Number(options.maxAspect) || 3.6;

  const rect = gridEl.getBoundingClientRect();
  const rawContainerW = rect.width || gridEl.clientWidth || 0;

  // 若容器尚未挂载或当前处于隐藏标签页（宽度为 0），先赋予初始安全尺寸等待可见时重排
  if (rawContainerW <= 48) {
    tilesMeta.forEach((entry) => {
      if (!entry?.el) return;
      const rawR = Number(entry.getAspect ? entry.getAspect() : entry.aspect) || 0.72;
      const r = Math.max(minAspect, Math.min(maxAspect, rawR));
      const w = Math.max(60, Math.round(targetH * r));
      entry.el.style.height = `${targetH}px`;
      entry.el.style.width = `${w}px`;
      entry.el.style.flex = `0 0 ${w}px`;
      entry.el.style.maxWidth = `${w}px`;
    });
    return false;
  }

  // 预留 0.5px 防高分屏（125%/150% DPI）亚像素四舍五入引发意外折行
  const containerW = Math.max(80, Math.floor(rawContainerW - 0.5));
  const validItems = [];
  for (const entry of tilesMeta) {
    if (!entry || !entry.el) continue;
    const rawR = Number(entry.getAspect ? entry.getAspect() : entry.aspect) || 0.72;
    const safeRaw = Number.isFinite(rawR) && rawR > 0.05 ? rawR : 0.72;
    const clampedR = Math.max(minAspect, Math.min(maxAspect, safeRaw));
    const isClamped = Math.abs(clampedR - safeRaw) > 0.01;
    validItems.push({
      el: entry.el,
      imgEl: entry.imgEl || entry.el.querySelector("img"),
      aspect: clampedR,
      isClamped
    });
  }

  const n = validItems.length;
  let idx = 0;

  while (idx < n) {
    // 极窄视口兜底：每行单张完整呈现
    if (containerW <= 250) {
      const it = validItems[idx];
      const exactH = Math.max(90, Math.round(containerW / it.aspect));
      it.el.style.height = `${exactH}px`;
      it.el.style.width = `${containerW}px`;
      it.el.style.flex = `1 0 ${Math.max(40, containerW - 1)}px`;
      it.el.style.maxWidth = `${containerW + 2}px`;
      if (it.imgEl) {
        it.imgEl.style.objectFit = it.isClamped ? "contain" : "cover";
      }
      idx += 1;
      continue;
    }

    let sumR = 0;
    let chosenEnd = idx;
    let justifyRow = true;

    for (let j = idx; j < n; j++) {
      const nextSumR = sumR + validItems[j].aspect;
      const count = j - idx + 1;
      const availW = containerW - (count - 1) * gap;

      if (availW <= count * 36 && count > 1) {
        chosenEnd = j - 1;
        justifyRow = true;
        break;
      }

      const candH = availW / nextSumR;
      if (candH <= targetH) {
        // 比较包含第 j 张（行高略低于 targetH）与不包含第 j 张（行高略高于 targetH）谁更贴近目标密度
        if (count > 1) {
          const prevCount = count - 1;
          const prevAvailW = containerW - (prevCount - 1) * gap;
          const prevH = prevAvailW / sumR;
          const prevTooTall = prevH > targetH * 1.35;
          const distPrev = Math.abs(Math.log(prevH / targetH));
          const distCurr = Math.abs(Math.log(Math.max(40, candH) / targetH));
          if (!prevTooTall && distPrev < distCurr) {
            chosenEnd = j - 1;
          } else {
            chosenEnd = j;
          }
        } else {
          chosenEnd = j;
        }
        justifyRow = true;
        break;
      }

      sumR = nextSumR;
      chosenEnd = j;

      // 已到达末尾（最后一行未满）
      if (j === n - 1) {
        // 若尾行已自然填充超过约 76% 宽度（candH <= targetH * 1.30），直接等比铺满整行；否则保持标准行高左对齐，绝不强拉变形
        justifyRow = candH <= targetH * 1.30;
      }
    }

    const rowSlice = validItems.slice(idx, chosenEnd + 1);
    const m = rowSlice.length;
    const rowSumR = rowSlice.reduce((acc, x) => acc + x.aspect, 0) || 1;
    const rowAvailW = Math.max(m * 36, containerW - (m - 1) * gap);

    if (justifyRow) {
      const exactRowH = Math.max(88, Math.round(rowAvailW / rowSumR));
      let usedW = 0;
      rowSlice.forEach((it, k) => {
        const isLast = k === m - 1;
        const w = isLast
          ? Math.max(36, rowAvailW - usedW)
          : Math.max(36, Math.round((rowAvailW * it.aspect) / rowSumR));
        usedW += w;
        it.el.style.height = `${exactRowH}px`;
        it.el.style.width = `${w}px`;
        if (isLast) {
          // 行末卡片吸收 0~1.5px 亚像素余量，使右边缘与工具栏 100% 齐平且绝不换行
          it.el.style.flex = `1 0 ${Math.max(36, w - 1)}px`;
          it.el.style.maxWidth = `${w + 3}px`;
        } else {
          it.el.style.flex = `0 0 ${w}px`;
          it.el.style.maxWidth = `${w}px`;
        }
        if (it.imgEl) {
          it.imgEl.style.objectFit = it.isClamped ? "contain" : "cover";
        }
      });
    } else {
      const exactRowH = Math.round(targetH);
      rowSlice.forEach((it) => {
        const w = Math.min(containerW, Math.max(36, Math.round(exactRowH * it.aspect)));
        it.el.style.height = `${exactRowH}px`;
        it.el.style.width = `${w}px`;
        it.el.style.flex = `0 0 ${w}px`;
        it.el.style.maxWidth = `${w}px`;
        if (it.imgEl) {
          it.imgEl.style.objectFit = it.isClamped ? "contain" : "cover";
        }
      });
    }

    idx = chosenEnd + 1;
  }

  return true;
}

/**
 * 为 Aves 画报墙绑定容器级 ResizeObserver（开合左右侧边栏、拖拽分栏、缩放窗口时无需手动刷新自动毫秒级重排）
 */
function attachAvesResizeObserver(hostEl, gridEl, relayoutFn) {
  if (!hostEl || !gridEl || typeof relayoutFn !== "function") return null;

  if (hostEl._avesResizeObserver) {
    try {
      hostEl._avesResizeObserver.disconnect();
    } catch (_) {}
    hostEl._avesResizeObserver = null;
  }
  if (hostEl._avesSettleTimer) {
    clearTimeout(hostEl._avesSettleTimer);
    hostEl._avesSettleTimer = null;
  }

  let rafId = 0;
  let lastMeasuredW = -1;

  const scheduleRelayout = (force = false) => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!gridEl.isConnected) {
        if (hostEl._avesResizeObserver) {
          try {
            hostEl._avesResizeObserver.disconnect();
          } catch (_) {}
          hostEl._avesResizeObserver = null;
        }
        return;
      }
      const w = gridEl.getBoundingClientRect().width || hostEl.getBoundingClientRect().width || 0;
      if (force || Math.abs(w - lastMeasuredW) >= 0.5) {
        lastMeasuredW = w;
        relayoutFn();
      }
    });
  };

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      scheduleRelayout(false);
      // 兼顾 Obsidian 侧边栏收折过渡动画结束后的最终稳态校准
      if (hostEl._avesSettleTimer) clearTimeout(hostEl._avesSettleTimer);
      hostEl._avesSettleTimer = setTimeout(() => {
        hostEl._avesSettleTimer = null;
        scheduleRelayout(true);
      }, 240);
    });
    ro.observe(hostEl);
    if (gridEl !== hostEl) {
      ro.observe(gridEl);
    }
    hostEl._avesResizeObserver = ro;
  }

  gridEl._avesTriggerRelayout = () => scheduleRelayout(true);
  scheduleRelayout(true);
  return {
    trigger: () => scheduleRelayout(true),
    disconnect: () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (hostEl._avesSettleTimer) clearTimeout(hostEl._avesSettleTimer);
      if (hostEl._avesResizeObserver) {
        try {
          hostEl._avesResizeObserver.disconnect();
        } catch (_) {}
        hostEl._avesResizeObserver = null;
      }
    }
  };
}

/**
 * 确保目录存在（支持仓库内相对路径或磁盘绝对路径）
 */
function ensureDirectoryAbsolute(plugin, dirSettingValue, fallbackRel = "附件/画册典藏") {
  const raw = String(dirSettingValue || fallbackRel).trim() || fallbackRel;
  if (!isDesktopNodeAvailable()) {
    return { raw, absDir: "", vaultBase: "" };
  }
  const vaultBase = getVaultBasePath(plugin);
  const absDir = path.isAbsolute(raw) ? raw : vaultBase ? path.join(vaultBase, raw) : "";
  try {
    if (absDir && !fs.existsSync(absDir)) {
      fs.mkdirSync(absDir, { recursive: true });
    }
  } catch (e) {}
  return { raw, absDir, vaultBase };
}

/**
 * 兼容 Electron 32+ / Obsidian 最新版获取 <input type="file"> 选中文件的真实本地路径
 */
function getNativeFilePath(file) {
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
 * 自动探测本机可用的 FFmpeg 可执行文件路径（支持自定义路径、WinGet/Scoop/Choco/C:\ffmpeg 解压目录、macOS Homebrew 与 Linux）
 */
function resolveFfmpegExecutable(plugin) {
  if (!isDesktopNodeAvailable()) return "";
  const custom = String(plugin?.settings?.ffmpegCustomPath || "").trim();
  if (custom && fs.existsSync(custom)) return custom;

  if (
    plugin &&
    plugin._resolvedFfmpegCustom === custom &&
    plugin._resolvedFfmpegBin &&
    (plugin._resolvedFfmpegBin === "ffmpeg" || fs.existsSync(plugin._resolvedFfmpegBin))
  ) {
    return plugin._resolvedFfmpegBin;
  }

  const isWin = typeof process !== "undefined" && process.platform === "win32";
  const env = (typeof process !== "undefined" && process.env) || {};
  const localAppData = env.LOCALAPPDATA || "";
  const userProfile = env.USERPROFILE || env.HOME || "";
  const programData = env.ProgramData || "C:\\ProgramData";

  const directCandidates = isWin
    ? [
        localAppData ? path.join(localAppData, "Microsoft\\WinGet\\Links\\ffmpeg.exe") : "",
        userProfile ? path.join(userProfile, "scoop\\shims\\ffmpeg.exe") : "",
        userProfile ? path.join(userProfile, "scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe") : "",
        path.join(programData, "chocolatey\\bin\\ffmpeg.exe"),
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "D:\\ffmpeg\\bin\\ffmpeg.exe"
      ]
    : [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/snap/bin/ffmpeg"
      ];

  for (const c of directCandidates) {
    if (c && fs.existsSync(c)) {
      if (plugin) {
        plugin._resolvedFfmpegCustom = custom;
        plugin._resolvedFfmpegBin = c;
      }
      return c;
    }
  }

  if (isWin) {
    const findBinUnder = (rootDir, maxDepth = 2) => {
      if (!rootDir || !fs.existsSync(rootDir)) return "";
      const walk = (dir, depth) => {
        const directBin = path.join(dir, "bin", "ffmpeg.exe");
        if (fs.existsSync(directBin)) return directBin;
        const flatExe = path.join(dir, "ffmpeg.exe");
        if (depth > 0 && fs.existsSync(flatExe)) return flatExe;
        if (depth >= maxDepth) return "";
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const hit = walk(path.join(dir, ent.name), depth + 1);
            if (hit) return hit;
          }
        } catch (_) {}
        return "";
      };
      return walk(rootDir, 0);
    };

    if (localAppData) {
      const wingetPkgRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
      if (fs.existsSync(wingetPkgRoot)) {
        try {
          const pkgs = fs.readdirSync(wingetPkgRoot, { withFileTypes: true });
          for (const pkg of pkgs) {
            if (pkg.isDirectory() && /ffmpeg/i.test(pkg.name)) {
              const hit = findBinUnder(path.join(wingetPkgRoot, pkg.name), 2);
              if (hit) {
                if (plugin) {
                  plugin._resolvedFfmpegCustom = custom;
                  plugin._resolvedFfmpegBin = hit;
                }
                return hit;
              }
            }
          }
        } catch (_) {}
      }
    }

    for (const unpackRoot of ["C:\\ffmpeg", "D:\\ffmpeg"]) {
      const hit = findBinUnder(unpackRoot, 2);
      if (hit) {
        if (plugin) {
          plugin._resolvedFfmpegCustom = custom;
          plugin._resolvedFfmpegBin = hit;
        }
        return hit;
      }
    }
  }

  if (plugin) {
    plugin._resolvedFfmpegCustom = custom;
    plugin._resolvedFfmpegBin = "ffmpeg";
  }
  return "ffmpeg";
}

/**
 * ==================== 1. 🪄 法杖长按关联谱（Long-Press Magic Wand Relation Filter） ====================
 */
function normalizeStem(text) {
  return String(text || "")
    .replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, "")
    .replace(/第[一二三四五六七八九十\d]+[季期部章]|Season\s*\d+|Part\s*\d+|OVA|OAD|SP|剧场版|劇場版|MOVIE|II|III|2|3|续|完/gi, "")
    .replace(/[·・•‧:：\-_~～!\?！？\s\u3000]+/g, "")
    .trim()
    .toLowerCase();
}

/**
 * 为任意卡片元素绑定「长按 420ms 触发洛琪希魔杖同源关联谱」手势（同时支持右键菜单/按钮触发）
 * 内置长按触发后的单击吞噬保护，防止松手时误触底层卡片预览弹窗
 */
function bindMagicWandLongPress(cardEl, onTrigger, options = {}) {
  if (!cardEl || typeof onTrigger !== "function") return;
  let timer = null;
  let startX = 0;
  let startY = 0;
  let ringEl = null;
  let suppressNextClick = false;

  const clearHold = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    cardEl.classList.remove("is-wand-charging");
    if (ringEl && ringEl.parentNode) {
      ringEl.remove();
      ringEl = null;
    }
  };

  cardEl.addEventListener(
    "click",
    (ev) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") {
          ev.stopImmediatePropagation();
        }
      }
    },
    true
  );

  cardEl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (
      ev.target &&
      ev.target.closest(
        "button, input, select, textarea, a, audio, .is-interactive, .curator-char-top-remove-btn, .curator-game-top-remove-btn, .curator-game-status-badge"
      )
    ) {
      return;
    }
    suppressNextClick = false;
    startX = ev.clientX;
    startY = ev.clientY;
    clearHold();
    cardEl.classList.add("is-wand-charging");

    ringEl = document.createElement("div");
    ringEl.className = "curator-wand-charge-ripple";
    const rect = cardEl.getBoundingClientRect();
    ringEl.style.left = `${Math.round(ev.clientX - rect.left)}px`;
    ringEl.style.top = `${Math.round(ev.clientY - rect.top)}px`;
    cardEl.appendChild(ringEl);

    timer = setTimeout(() => {
      clearHold();
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 650);
      try {
        onTrigger(ev);
      } catch (err) {
        console.error("[MagicWand] trigger error:", err);
      }
    }, options.holdMs || 430);
  });

  cardEl.addEventListener("pointermove", (ev) => {
    if (!timer) return;
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) {
      clearHold();
    }
  });
  cardEl.addEventListener("pointerup", clearHold);
  cardEl.addEventListener("pointercancel", clearHold);
  cardEl.addEventListener("pointerleave", clearHold);
}

/**
 * 打开跨馆关联收藏模态框
 * 支持从任意番剧、角色、制作公司、画册插画、音声典藏或游戏出发，汇总全馆关联条目
 */
function openMagicWandRelationModal(plugin, seed, vaultAnimeItems = [], callbacks = {}) {
  if (typeof roxyMascotService.recordWandRelationUsed === "function") {
    roxyMascotService.recordWandRelationUsed(plugin);
  }
  const modal = new Modal(plugin.app);
  modal.onOpen = () => {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.addClass("curator-magic-wand-modal");

    const seedType = seed?.type || "anime"; // anime | character | studio | illustration | voice | game
    const seedTitle = String(seed?.title || seed?.name || "未命名条目").trim();
    const seedStem = normalizeStem(seedTitle);
    const seedStudio = String(seed?.studio || "").trim();
    const seedCv = String(seed?.cv || "").trim();
    const seedAppearances = Array.isArray(seed?.appearances) ? seed.appearances : [];

    const head = contentEl.createDiv("curator-wand-head");
    const badgeRow = head.createDiv("curator-wand-kicker-row");
    badgeRow.createSpan({ cls: "curator-wand-kicker", text: "跨馆关联检索" });
    const typeLabelMap = {
      anime: "番剧",
      character: "角色",
      studio: "制作公司",
      illustration: "画册典藏",
      voice: "音声典藏",
      game: "游戏典藏"
    };
    badgeRow.createSpan({ cls: "curator-wand-type-pill", text: typeLabelMap[seedType] || "馆藏条目" });

    head.createEl("h2", {
      cls: "curator-wand-title",
      text: `「${seedTitle}」的相关收藏`
    });
    head.createDiv({
      cls: "curator-wand-sub",
      text: "自动汇总同系列续作、同一制作公司、登场角色、同声优 (CV)、画册典藏、音声典藏与关联游戏"
    });

    const allAnime = Array.isArray(vaultAnimeItems) ? vaultAnimeItems : [];
    const allChars = Array.isArray(plugin.settings?.characterCollection)
      ? plugin.settings.characterCollection
      : [];
    const allIllusts = Array.isArray(plugin.settings?.illustrationCollection)
      ? plugin.settings.illustrationCollection
      : [];
    const allVoices = Array.isArray(plugin.settings?.voiceCollection)
      ? plugin.settings.voiceCollection
      : [];
    const allGames = Array.isArray(plugin.settings?.gameCollection)
      ? plugin.settings.gameCollection
      : [];

    const matchByStem = (a, b) => {
      const sa = normalizeStem(a);
      const sb = normalizeStem(b);
      if (!sa || !sb || sa.length < 2 || sb.length < 2) return false;
      return sa === sb || sa.includes(sb) || sb.includes(sa);
    };

    // 1. 关联动画（同系列 / 同制作社 / 角色出演动画）
    const relatedSeriesAnime = [];
    const relatedStudioAnime = [];
    const studioTokens = seedStudio
      ? seedStudio
          .split(/[,;\/、&]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    for (const ani of allAnime) {
      const isSelf =
        seedType === "anime" &&
        ((seed.file && ani.file && seed.file.path === ani.file.path) || ani.name === seedTitle);
      if (isSelf) continue;

      const isSeriesMatch =
        matchByStem(ani.name, seedTitle) ||
        seedAppearances.some((ap) => matchByStem(ani.name, ap)) ||
        (seed?.animeTitle && matchByStem(ani.name, seed.animeTitle));
      if (isSeriesMatch) {
        relatedSeriesAnime.push(ani);
        continue;
      }

      if (studioTokens.length > 0 && ani.studio) {
        const hitStudio = studioTokens.some((st) =>
          String(ani.studio).toLowerCase().includes(st.toLowerCase())
        );
        if (hitStudio) {
          relatedStudioAnime.push(ani);
        }
      }
    }

    // 2. 关联角色（出演该作 / 同声优 / 同名）
    const relatedCharacters = allChars.filter((ch) => {
      if (seedType === "character" && (ch.id === seed.id || ch.name === seedTitle)) return false;
      if (matchByStem(ch.name, seedTitle)) return true;
      if (seedCv && ch.cv && normalizeStem(ch.cv) === normalizeStem(seedCv)) return true;
      const apps = Array.isArray(ch.appearances) ? ch.appearances : [];
      if (apps.some((ap) => matchByStem(ap, seedTitle))) return true;
      if (
        seedAppearances.length > 0 &&
        apps.some((ap) => seedAppearances.some((sap) => matchByStem(ap, sap)))
      ) {
        return true;
      }
      return false;
    });

    // 3. 关联画册插画
    const relatedIllusts = allIllusts.filter((ill) => {
      if (seedType === "illustration" && ill.id === seed.id) return false;
      return (
        matchByStem(ill.characterName, seedTitle) ||
        matchByStem(ill.animeTitle, seedTitle) ||
        matchByStem(ill.title, seedTitle) ||
        seedAppearances.some((ap) => matchByStem(ill.animeTitle, ap)) ||
        relatedCharacters.some((ch) => matchByStem(ill.characterName, ch.name))
      );
    });

    // 4. 关联台词音声
    const relatedVoices = allVoices.filter((vc) => {
      if (seedType === "voice" && vc.id === seed.id) return false;
      return (
        matchByStem(vc.characterName, seedTitle) ||
        matchByStem(vc.animeTitle, seedTitle) ||
        seedAppearances.some((ap) => matchByStem(vc.animeTitle, ap)) ||
        relatedCharacters.some((ch) => matchByStem(vc.characterName, ch.name))
      );
    });

    // 5. 关联本地游戏
    const relatedGames = allGames.filter((gm) => {
      if (seedType === "game" && gm.id === seed.id) return false;
      return (
        matchByStem(gm.title, seedTitle) ||
        matchByStem(gm.series, seedTitle) ||
        (seedStudio && gm.developer && matchByStem(gm.developer, seedStudio)) ||
        seedAppearances.some((ap) => matchByStem(gm.title, ap))
      );
    });

    const body = contentEl.createDiv("curator-wand-body");
    let totalFound =
      relatedSeriesAnime.length +
      relatedStudioAnime.length +
      relatedCharacters.length +
      relatedIllusts.length +
      relatedVoices.length +
      relatedGames.length;

    // 顶部一键快筛操作条
    const quickFilterBar = body.createDiv("curator-wand-quick-bar");
    if (typeof callbacks.onFilterCatalog === "function") {
      const filterTitleBtn = quickFilterBar.createEl("button", {
        cls: "curator-btn is-primary",
        text: `在全部番剧中检索「${seedTitle.slice(0, 12)}」`
      });
      filterTitleBtn.onclick = () => {
        modal.close();
        callbacks.onFilterCatalog(seedTitle);
      };
      if (studioTokens.length > 0) {
        const filterStudioBtn = quickFilterBar.createEl("button", {
          cls: "curator-btn",
          text: `筛选制作公司：${studioTokens[0]}`
        });
        filterStudioBtn.onclick = () => {
          modal.close();
          callbacks.onFilterCatalog(studioTokens[0]);
        };
      }
    }

    if (totalFound === 0) {
      const empty = body.createDiv("curator-wand-empty");
      empty.createDiv({
        cls: "curator-wand-empty-title",
        text: "暂未在馆藏中检出直接关联的其他条目"
      });
      empty.createDiv({
        cls: "curator-wand-empty-sub",
        text: "随着您收录更多同系列番剧、登场角色、画册图片、音声片段或本地游戏，系统会自动将相关收藏串联在一起。"
      });
      return;
    }

    const renderSection = (title, badge, items, renderItem) => {
      if (!items || items.length === 0) return;
      const sec = body.createDiv("curator-wand-section");
      const sHead = sec.createDiv("curator-wand-sec-head");
      sHead.createSpan({ cls: "curator-wand-sec-title", text: title });
      sHead.createSpan({ cls: "curator-wand-sec-badge curator-mono", text: badge });
      const grid = sec.createDiv("curator-wand-chips-grid");
      items.forEach((it) => renderItem(grid, it));
    };

    renderSection(
      "同系列与关联番剧",
      `${relatedSeriesAnime.length} 部`,
      relatedSeriesAnime,
      (grid, ani) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: `《${ani.name}》` });
        const sc = ani.personalScore ?? ani.preciseScore ?? ani.publicScore ?? ani.bangumiScore;
        chip.createDiv({
          cls: "curator-wand-item-meta curator-mono",
          text: `${ani.year || ""} ${ani.season || ""} · ${ani.state || "未设置"}${sc ? ` · ★${Number(sc).toFixed(1)}` : ""}`
        });
        chip.onclick = async () => {
          modal.close();
          if (ani.file) {
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(ani.file);
          }
        };
      }
    );

    renderSection(
      "关联登场角色 / 同声优角色",
      `${relatedCharacters.length} 位`,
      relatedCharacters,
      (grid, ch) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: ch.name });
        chip.createDiv({
          cls: "curator-wand-item-meta",
          text: `CV: ${ch.cv || "未知"} · ★${Number(ch.favoriteScore || 9.0).toFixed(1)}`
        });
        chip.onclick = () => {
          modal.close();
          if (typeof callbacks.onSwitchMode === "function") {
            callbacks.onSwitchMode("character", { searchQuery: ch.name });
          }
        };
      }
    );

    renderSection(
      "关联画册典藏",
      `${relatedIllusts.length} 幅`,
      relatedIllusts,
      (grid, ill) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: ill.title || ill.characterName || "典藏插画" });
        chip.createDiv({
          cls: "curator-wand-item-meta",
          text: [ill.characterName, ill.animeTitle].filter(Boolean).join(" · ") || "画册典藏"
        });
        chip.onclick = () => {
          modal.close();
          if (typeof callbacks.onSwitchMode === "function") {
            callbacks.onSwitchMode("gallery", { searchQuery: ill.characterName || ill.title });
          }
        };
      }
    );

    renderSection(
      "关联音声典藏",
      `${relatedVoices.length} 条`,
      relatedVoices,
      (grid, vc) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: `“${vc.quoteText || "音声片段"}”` });
        chip.createDiv({
          cls: "curator-wand-item-meta",
          text: [vc.characterName, vc.animeTitle, vc.episode ? `EP${vc.episode}` : ""].filter(Boolean).join(" · ")
        });
        chip.onclick = () => {
          modal.close();
          if (typeof callbacks.onSwitchMode === "function") {
            callbacks.onSwitchMode("voice", { searchQuery: vc.characterName || vc.animeTitle });
          }
        };
      }
    );

    renderSection(
      "关联游戏典藏",
      `${relatedGames.length} 部`,
      relatedGames,
      (grid, gm) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: `《${gm.title}》` });
        chip.createDiv({
          cls: "curator-wand-item-meta",
          text: `${gm.status || "在玩"} · ${gm.playHours || 0}h`
        });
        chip.onclick = () => {
          modal.close();
          if (typeof callbacks.onSwitchMode === "function") {
            callbacks.onSwitchMode("game", { searchQuery: gm.title });
          }
        };
      }
    );

    renderSection(
      `同制作公司（${studioTokens.join(" / ")}）其他番剧`,
      `${relatedStudioAnime.length} 部`,
      relatedStudioAnime.slice(0, 16),
      (grid, ani) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: `《${ani.name}》` });
        const sc = ani.personalScore ?? ani.preciseScore ?? ani.publicScore ?? ani.bangumiScore;
        chip.createDiv({
          cls: "curator-wand-item-meta curator-mono",
          text: `${ani.year || ""} · ${ani.state || "未设置"}${sc ? ` · ★${Number(sc).toFixed(1)}` : ""}`
        });
        chip.onclick = async () => {
          modal.close();
          if (ani.file) {
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(ani.file);
          }
        };
      }
    );

    roxyMascotService.emitRoxyEvent(plugin, {
      type: "wand:relation",
      state: "surprised",
      category: "关联检索",
      priority: roxyMascotService.PRIORITY.NORMAL,
      dedupeKey: `wand:${seedTitle}`,
      message: `已经为您把「${seedTitle}」相关的 ${totalFound} 项馆藏整理好了，点击任意卡片就能直接跳转过去哦。`
    });
  };
  modal.open();
}

/**
 * ==================== 2. 🖼️ 画册典藏（Dedicated Picture/Illustration Gallery） ====================
 */

/**
 * 双向对账本地画册目录与 illustrationCollection 记录：
 *  - 当用户在本地文件夹或 Obsidian 文件树中手动删除了某张图片时，自动清理对应的残留空白记录
 *  - 当文件仍在当前画册目录中但相对路径变动时，自动修正 localPath
 */
function reconcileIllustrationCollectionWithDisk(plugin) {
  if (!plugin?.settings || !Array.isArray(plugin.settings.illustrationCollection)) {
    return { changed: false, prunedCount: 0, relinkedCount: 0 };
  }
  // 多端同步防损守卫：移动端或非桌面 Node 环境严禁自动删除缺失本地文件的画册记录
  if (isMobileEnv() || !isDesktopNodeAvailable()) {
    return { changed: false, prunedCount: 0, relinkedCount: 0 };
  }
  if (plugin?.pathMigrationState?.status === "running") {
    return { changed: false, prunedCount: 0, relinkedCount: 0 };
  }
  const vaultBase = getVaultBasePath(plugin);
  if (!vaultBase || !fs.existsSync(vaultBase)) {
    return { changed: false, prunedCount: 0, relinkedCount: 0 };
  }

  const rawFolder = String(plugin.settings.illustrationGalleryFolder || "附件/画册典藏").trim() || "附件/画册典藏";
  const absGalleryDir = path.isAbsolute(rawFolder) ? rawFolder : path.join(vaultBase, rawFolder);
  // 若画册目录本身不存在（如选择性同步尚未挂载该文件夹）或原本记录 >= 2 幅但目录突然为空，严禁静默批量剔除记录
  if (!absGalleryDir || !fs.existsSync(absGalleryDir)) {
    return { changed: false, prunedCount: 0, relinkedCount: 0 };
  }
  if (plugin.settings.illustrationCollection.length >= 2) {
    try {
      const entries = fs.readdirSync(absGalleryDir);
      if (Array.isArray(entries) && entries.length === 0) {
        return { changed: false, prunedCount: 0, relinkedCount: 0 };
      }
    } catch (_) {
      return { changed: false, prunedCount: 0, relinkedCount: 0 };
    }
  }
  const relGalleryPrefix = path.isAbsolute(rawFolder)
    ? ""
    : rawFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  let changed = false;
  let prunedCount = 0;
  let relinkedCount = 0;
  const nextCollection = [];

  for (const it of plugin.settings.illustrationCollection) {
    if (!it) {
      changed = true;
      continue;
    }
    if (it.sourceType === "character") {
      nextCollection.push(it);
      continue;
    }
    const rawLocal = String(it.localPath || "").trim();
    if (!rawLocal || /^(?:https?:|data:)/i.test(rawLocal)) {
      nextCollection.push(it);
      continue;
    }

    const absLocal = resolveLocalFileAbsolutePath(plugin, rawLocal);
    if (absLocal && fs.existsSync(absLocal)) {
      nextCollection.push(it);
      continue;
    }

    // 尝试在当前配置的画册目录中查找同名文件（兼容目录微调后尚未更新相对路径的情形）
    const baseName = path.basename(rawLocal.replace(/\\/g, "/"));
    const candidateInGallery = baseName && absGalleryDir ? path.join(absGalleryDir, baseName) : "";
    if (candidateInGallery && fs.existsSync(candidateInGallery)) {
      it.localPath = relGalleryPrefix ? `${relGalleryPrefix}/${baseName}` : candidateInGallery;
      changed = true;
      relinkedCount += 1;
      nextCollection.push(it);
      continue;
    }

    // 本地图片确实已被用户在磁盘删除：自动移除残留记录，杜绝空白占位卡片
    changed = true;
    prunedCount += 1;
  }

  if (changed) {
    plugin.settings.illustrationCollection = nextCollection;
    Promise.resolve()
      .then(() => plugin.saveSettings())
      .catch(() => {});
  }

  return { changed, prunedCount, relinkedCount };
}

/**
 * 响应 Obsidian 仓库内画册图片重命名/移动事件，保持元数据无缝跟随
 */
async function handleVaultGalleryFileRename(plugin, oldVaultPath, newVaultPath) {
  if (!plugin?.settings || !Array.isArray(plugin.settings.illustrationCollection)) return false;
  const oldNorm = normalizeVaultRelPathCaseInsensitive(plugin, oldVaultPath);
  const newClean = String(newVaultPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!oldNorm || !newClean) return false;

  const oldStem = path.basename(String(oldVaultPath || ""), path.extname(String(oldVaultPath || "")));
  const newStem = path.basename(newClean, path.extname(newClean));
  let updated = false;

  for (const it of plugin.settings.illustrationCollection) {
    if (!it || !it.localPath) continue;
    if (normalizeVaultRelPathCaseInsensitive(plugin, it.localPath) === oldNorm) {
      it.localPath = newClean;
      if (!it.title || it.title === oldStem) {
        it.title = newStem;
      }
      updated = true;
    }
  }

  if (updated) {
    await plugin.saveSettings();
  }
  return updated;
}

/**
 * 彻底删除画册中的某幅画作：
 *  - 将本地画册图片安全移入操作系统回收站（同时支持已登记记录与 disk-illust-* 扫描图片）
 *  - 同步清除 illustrationCollection 中所有同 ID 或同本地路径的元数据记录
 */
async function deleteGalleryIllustration(plugin, illust) {
  if (!plugin || !illust) return { deletedFile: false, removedRecordCount: 0 };
  const targetLocal = String(illust.localPath || "").trim();
  const targetNorm = normalizeVaultRelPathCaseInsensitive(plugin, targetLocal);

  let deletedFile = false;
  if (targetLocal && !/^(?:https?:|data:)/i.test(targetLocal)) {
    const trashRes = await moveLocalFileToTrashSafely(plugin, targetLocal);
    deletedFile = Boolean(trashRes.deleted || !trashRes.existed);
  }

  let removedRecordCount = 0;
  if (Array.isArray(plugin.settings?.illustrationCollection)) {
    const beforeLen = plugin.settings.illustrationCollection.length;
    plugin.settings.illustrationCollection = plugin.settings.illustrationCollection.filter((x) => {
      if (!x) return false;
      if (illust.id && x.id === illust.id) return false;
      if (targetNorm && x.localPath && normalizeVaultRelPathCaseInsensitive(plugin, x.localPath) === targetNorm) {
        return false;
      }
      return true;
    });
    removedRecordCount = beforeLen - plugin.settings.illustrationCollection.length;
    if (removedRecordCount > 0) {
      await plugin.saveSettings();
    }
  }

  if (plugin.__diskIllustAspectCache && targetNorm) {
    for (const k of Array.from(plugin.__diskIllustAspectCache.keys())) {
      if (k.startsWith(`${targetNorm}|`)) {
        plugin.__diskIllustAspectCache.delete(k);
      }
    }
  }

  return { deletedFile, removedRecordCount };
}

function collectAllGalleryIllustrations(plugin) {
  // 1. 先与本地磁盘目录对账，自动剔除用户已在本地删除图片的残留记录
  reconcileIllustrationCollectionWithDisk(plugin);

  const savedList = Array.isArray(plugin.settings?.illustrationCollection)
    ? plugin.settings.illustrationCollection.filter((it) => it && it.sourceType !== "character")
    : [];
  const charList = Array.isArray(plugin.settings?.characterCollection)
    ? plugin.settings.characterCollection
    : [];
  const gameList = Array.isArray(plugin.settings?.gameCollection)
    ? plugin.settings.gameCollection
    : [];

  if (!plugin.__diskIllustAspectCache) {
    plugin.__diskIllustAspectCache = new Map();
  }

  const merged = [...savedList];
  const seenPathsLower = new Set();
  for (const it of savedList) {
    const lp = normalizeVaultRelPathCaseInsensitive(plugin, it.localPath);
    if (lp) seenPathsLower.add(lp);
    const absLp = resolveLocalFileAbsolutePath(plugin, it.localPath);
    if (absLp) seenPathsLower.add(absLp.replace(/\\/g, "/").toLowerCase());
    if (it.imageUrl) seenPathsLower.add(String(it.imageUrl).trim().toLowerCase());
  }

  // 2. 自动修复旧版遗留的 250x250 方形裁切小图（仅桌面端执行磁盘覆盖修复）
  if (isDesktopNodeAvailable()) {
    try {
      for (const it of savedList) {
        const rawImgUrl = String(it?.imageUrl || "").trim();
        if (!rawImgUrl) continue;
        const absLocal = resolveLocalFileAbsolutePath(plugin, it.localPath);
        let diskSize = Number(it.fileSizeBytes) || 0;
        if (absLocal && fs.existsSync(absLocal)) {
          try {
            diskSize = fs.statSync(absLocal).size;
            if (!it.fileSizeBytes && diskSize > 0) it.fileSizeBytes = diskSize;
          } catch (_) {}
        }
        const isLegacyCroppedUrl = /\/c\/250x250[^/]*\//i.test(rawImgUrl);
        const isLegacyTinySquare =
          absLocal &&
          diskSize > 0 &&
          diskSize < 24000 &&
          Number(it._naturalAspect) === 1 &&
          /(?:pixiv\.re|pximg\.net)\//i.test(rawImgUrl);

        if ((isLegacyCroppedUrl || isLegacyTinySquare) && !it._repairedUncroppedV2) {
          it._repairedUncroppedV2 = true;
          const multi = buildPixivMultiSizeUrls(rawImgUrl);
          const targetHdUrl = multi.regularUrl || rawImgUrl;
          if (targetHdUrl && absLocal) {
            it.imageUrl = targetHdUrl;
            (async () => {
              try {
                let buf = null;
                const needPixivReferer = /(?:pximg\.net|pixiv\.net)\//i.test(targetHdUrl);
                if (!needPixivReferer && typeof window !== "undefined" && typeof window.fetch === "function") {
                  const fRes = await Promise.race([
                    window.fetch(targetHdUrl),
                    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))
                  ]);
                  if (fRes && fRes.ok) {
                    const ab = await fRes.arrayBuffer();
                    if (ab && ab.byteLength > 24000) buf = toNodeBufferOrUint8(ab);
                  }
                }
                if (!buf) {
                  const headers = needPixivReferer
                    ? { "User-Agent": BGM_USER_AGENT, Referer: "https://www.pixiv.net/" }
                    : { "User-Agent": BGM_USER_AGENT };
                  const res = await requestUrl({ url: targetHdUrl, method: "GET", headers });
                  if (res?.arrayBuffer && res.arrayBuffer.byteLength > 24000) {
                    buf = toNodeBufferOrUint8(res.arrayBuffer);
                  }
                }
                if (buf && buf.length > 24000) {
                  markSelfMediaPathBusy(plugin, absLocal, 2000);
                  fs.mkdirSync(path.dirname(absLocal), { recursive: true });
                  fs.writeFileSync(absLocal, buf);
                  it.fileSizeBytes = buf.length;
                  it._cacheBust = Date.now();
                  delete it._naturalAspect;
                  await plugin.saveSettings();
                  if (typeof plugin._activeGalleryRefresh === "function") {
                    plugin._activeGalleryRefresh();
                  }
                }
              } catch (_) {}
            })();
          }
        }
      }
    } catch (_) {}
  }

  // 3. 记录角色立绘与游戏封面路径，防止共享目录时误扫描非画册资产
  const excludedAssetPaths = new Set();
  const excludedFileNames = new Set();
  for (const ch of charList) {
    [
      ch?.localAvatar,
      ch?.avatar,
      ch?.localImagePath,
      ch?.imageUrl,
      ...(Array.isArray(ch?.customPortraits) ? ch.customPortraits : [])
    ].forEach((rawP) => {
      const p = String(rawP || "").trim().replace(/\\/g, "/");
      if (p && !/^https?:\/\//i.test(p)) {
        excludedAssetPaths.add(p.toLowerCase());
        excludedFileNames.add(path.basename(p).toLowerCase());
      }
    });
  }
  for (const gm of gameList) {
    [gm?.coverUrl, gm?.coverLocalPath].forEach((rawP) => {
      const p = String(rawP || "").trim().replace(/\\/g, "/");
      if (p && !/^https?:\/\//i.test(p)) {
        excludedAssetPaths.add(p.toLowerCase());
        excludedFileNames.add(path.basename(p).toLowerCase());
      }
    });
  }

  // 4. 扫描本地画册目录中的未登记插画图片（大小写不敏感去重，自动缓存宽高比并提取角色线索）
  try {
    const { raw: relFolder, absDir } = ensureDirectoryAbsolute(
      plugin,
      plugin.settings?.illustrationGalleryFolder,
      "附件/画册典藏"
    );
    if (absDir && fs.existsSync(absDir)) {
      const files = fs.readdirSync(absDir);
      for (const f of files) {
        if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(f)) continue;
        const lowerFile = f.toLowerCase();
        if (
          /^(bangumi-cover-|char-|character-|bgm-char-|review-|game-cover-|bgm\d+_ep)/i.test(f) ||
          excludedFileNames.has(lowerFile)
        ) {
          continue;
        }
        const relPath = path.isAbsolute(relFolder)
          ? path.join(absDir, f).replace(/\\/g, "/")
          : `${relFolder.replace(/\\/g, "/").replace(/\/$/, "")}/${f}`;
        const normRel = normalizeVaultRelPathCaseInsensitive(plugin, relPath);
        if (excludedAssetPaths.has(normRel) || excludedAssetPaths.has(relPath.toLowerCase())) continue;

        const absFile = path.join(absDir, f);
        const normAbs = absFile.replace(/\\/g, "/").toLowerCase();
        if (seenPathsLower.has(normRel) || seenPathsLower.has(normAbs)) continue;
        seenPathsLower.add(normRel);
        seenPathsLower.add(normAbs);

        let statSize = 0;
        let mtimeIso = new Date().toISOString();
        try {
          const st = fs.statSync(absFile);
          statSize = st.size || 0;
          if (st.mtime) mtimeIso = st.mtime.toISOString();
        } catch (_) {}

        const baseName = f.replace(/\.[^.]+$/, "");
        const parsedNameMatch = baseName.match(/^illust_(.+)_\d{5,8}$/i);
        const inferredChar = parsedNameMatch ? parsedNameMatch[1].replace(/_/g, " ").trim() : "";
        const aspectCacheKey = `${normRel}|${statSize}`;
        const cachedAspect = plugin.__diskIllustAspectCache.get(aspectCacheKey);

        const diskItem = {
          id: `disk-illust-${f}`,
          title: baseName,
          characterName: inferredChar,
          animeTitle: "",
          tags: ["本地画册"],
          imageUrl: "",
          localPath: relPath,
          fileSizeBytes: statSize,
          favoriteScore: 9.0,
          sourceType: "disk",
          createdAt: mtimeIso,
          _aspectCacheKey: aspectCacheKey
        };
        if (cachedAspect && cachedAspect > 0) {
          diskItem._naturalAspect = cachedAspect;
        }
        merged.push(diskItem);
      }
    }
  } catch (e) {}

  return merged;
}

const ACG_MULTILINGUAL_ALIAS_DICT = {
  芙莉莲: ["フリーレン", "葬送のフリーレン", "Frieren"],
  葬送的芙莉莲: ["葬送のフリーレン", "フリーレン"],
  菲伦: ["フェルン", "葬送のフリーレン"],
  休塔尔克: ["シュタルク", "葬送のフリーレン"],
  辛美尔: ["ヒンメル", "葬送のフリーレン"],
  阿乌拉: ["断두台のアウラ", "アウラ(葬送のフリーレン)"],
  尤贝尔: ["ユーベル(葬送のフリーレン)", "ユーベル"],
  洛琪希: ["ロキシー・ミグルディア", "ロキシー", "無職転生"],
  洛琪希·米格路迪亚: ["ロキシー・ミグルディア", "ロキシー"],
  无职转生: ["無職転生", "ロキシー・ミグルディア"],
  希露菲: ["シルフィエット", "無職転生"],
  希露菲叶特: ["シルフィエット", "無職転生"],
  艾莉丝: ["エリス・ボレアス・グレイラット", "エリス(無職転生)"],
  鲁迪乌斯: ["ルーデウス・グレイラット", "無職転生"],
  蕾姆: ["レム(リゼロ)", "レム", "Re:ゼロから始める異世界生活"],
  雷姆: ["レム(リゼロ)", "レム"],
  爱蜜莉雅: ["エミリア(リゼロ)", "エミリア"],
  艾米莉亚: ["エミリア(リゼロ)", "エミリア"],
  拉姆: ["ラム(リゼロ)", "Re:ゼロから始める異世界生活"],
  贝蒂: ["ベアトリス(リゼロ)"],
  艾姬多娜: ["エキドナ(リゼロ)"],
  惠惠: ["めぐみん", "この素晴らしい世界に祝福を!"],
  阿库娅: ["アクア(このすば)", "この素晴らしい世界に祝福を!"],
  达克妮斯: ["ダクネス", "この素晴らしい世界に祝福を!"],
  玛露希尔: ["マルシル", "ダンジョン飯"],
  马尔西尔: ["マルシル", "ダンジョン飯"],
  迷宫饭: ["ダンジョン飯", "マルシル"],
  法琳: ["ファリン・トーデン", "ダンジョン飯"],
  波奇: ["後藤ひとり", "ぼっち・ざ・ろっく!"],
  后藤一里: ["後藤ひとり", "ぼっち・ざ・ろっく!"],
  孤独摇滚: ["ぼっち・ざ・ろっく!", "後藤ひとり"],
  喜多郁代: ["喜多郁代", "ぼっち・ざ・ろっく!"],
  山田凉: ["山田リョウ", "ぼっち・ざ・ろっく!"],
  伊地知虹夏: ["伊地知虹夏", "ぼっち・ざ・ろっく!"],
  锦木千束: ["錦木千束", "リコリス・リコイル"],
  千束: ["錦木千束", "リコリス・リコイル"],
  井之上泷奈: ["井ノ上たきな", "リコリス・リコイル"],
  泷奈: ["井ノ上たきな", "リコリス・リコイル"],
  莉可丽丝: ["リコリス・リコイル", "錦木千束"],
  丰川祥子: ["豊川祥子", "AveMujica", "MyGO!!!!!"],
  千早爱音: ["千早愛音", "MyGO!!!!!"],
  高松灯: ["高松燈", "MyGO!!!!!"],
  长崎爽世: ["長崎そよ", "MyGO!!!!!"],
  椎名立希: ["椎名立希", "MyGO!!!!!"],
  要乐奈: ["要楽奈", "MyGO!!!!!"],
  若叶睦: ["若葉睦", "AveMujica"],
  三角初华: ["三角初華", "AveMujica"],
  八奈见杏菜: ["八奈見杏菜", "負けヒロインが多すぎる!"],
  败犬女主: ["負けヒロインが多すぎる!", "八奈見杏菜"],
  亚丝娜: ["アスナ", "ソードアート・オンライン"],
  结城明日奈: ["結城明日奈", "アスナ"],
  初音未来: ["初音ミク", "VOCALOID"],
  初音: ["初音ミク"],
  阿尔托莉雅: ["アルトリア・ペンドラゴン", "セイバー", "Fate"],
  薇尔莉特: ["ヴァイオレット・エヴァーガーデン"],
  紫罗兰永恒花园: ["ヴァイオレット・エヴァーガーデン"],
  御坂美琴: ["御坂美琴", "とある科学の超電磁砲"],
  牧濑红莉栖: ["牧瀬紅莉栖", "シュタインズ・ゲート"],
  樱岛麻衣: ["桜島麻衣", "青春ブタ野郎"],
  雪之下雪乃: ["雪ノ下雪乃", "やはり俺の青春ラブコメはまちがっている。"],
  四宫辉夜: ["四宮かぐや", "かぐや様は告らせたい"],
  星野爱: ["星野アイ", "【推しの子】"],
  有马加奈: ["有馬かな", "【推しの子】"],
  黑川茜: ["黒川あかね", "【推しの子】"],
  猫猫: ["猫猫(薬屋のひとりごと)", "薬屋のひとりごと"],
  药屋少女的呢喃: ["薬屋のひとりごと", "猫猫"],
  约尔: ["ヨル・フォージャー", "SPY×FAMILY"],
  阿尼亚: ["アーニャ・フォージャー", "SPY×FAMILY"],
  绫波丽: ["綾波レイ", "エヴァンゲリオン"],
  明日香: ["惣流・アスカ・ラングレー", "式波・アスカ・ラングレー"],
  鹿目圆: ["鹿目まどか", "魔法少女まどか☆マギカ"],
  晓美焰: ["暁美ほむら", "魔法少女まどか☆マギカ"],
  黑崎小雪: ["黒崎コユキ", "ブルーアーカイブ"],
  白洲梓: ["白洲アズサ", "ブルーアーカイブ"],
  早濑优香: ["早瀬ユウカ", "ブルーアーカイブ"],
  砂狼白子: ["砂狼シロコ", "ブルーアーカイブ"],
  圣园未花: ["聖園ミカ", "ブルーアーカイブ"],
  星野: ["小鳥遊ホシノ", "ブルーアーカイブ"],
  爱丽丝: ["天童アリス", "ブルーアーカイブ"]
};

const AI_TAG_REGEX = /^(AI生成|AIイラスト|AI-generated|AI作品|NovelAI|StableDiffusion|AI_generated|AIart|AI絵|ai生成イラスト)$/i;
const AGE_RESTRICT_TAG_REGEX = /^(R-18|R-18G|R18|R18G|NSFW)$/i;
const AGE_GORE_TAG_REGEX = /^(R-18G|R18G)$/i;

function isAiGeneratedPixivItem(item) {
  if (!item) return false;
  if (Number(item.aiType) === 2) return true;
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      const s = String(t || "").trim();
      if (AI_TAG_REGEX.test(s)) return true;
    }
  }
  return false;
}

/**
 * 识别 Pixiv 插画条目的年龄分级与敏感等级（对齐 Pixiv 官方 xRestrict / r18 / sl 字段及分级标签）
 */
function classifyPixivAgeRating(item) {
  if (!item) return { isR18: false, isR18G: false, isSensitive: false };
  const xRestrict = Number(item.xRestrict) || 0;
  let isR18G = xRestrict === 2;
  let isR18 = xRestrict >= 1 || item.r18 === true || Number(item.r18) === 1;
  const isSensitive = isR18 || (Number(item.sl) || 0) >= 6;

  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      const s = String(t || "").trim();
      if (AGE_GORE_TAG_REGEX.test(s)) {
        isR18G = true;
        isR18 = true;
      } else if (AGE_RESTRICT_TAG_REGEX.test(s)) {
        isR18 = true;
      }
    }
  }
  return { isR18, isR18G, isSensitive };
}

/**
 * 将任意 Pixiv 缩略图/主图 URL 转换为无裁切完整画幅的 3 档尺寸 URL（540P / 1200P / 原图 Original）
 * 核心修复：先剥离 /c/250x250_80_a2/ 等正方形裁切前缀，再将 /custom-thumb/ 转为 /img-master/，彻底杜绝 250x250 裁切图！
 */
function buildPixivMultiSizeUrls(rawUrl, pid) {
  const proxyUrl = String(rawUrl || "")
    .trim()
    .replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/");
  const noCrop = proxyUrl.replace(/\/c\/[^/]+\//i, "/");
  const regularUrl = noCrop
    .replace(/\/custom-thumb\//i, "/img-master/")
    .replace(/\/img-original\//i, "/img-master/")
    .replace(/_(custom|square)1200(\.\w+)$/i, "_master1200.jpg")
    .replace(/(\/\d+_p\d+)\.(png|jpe?g|webp|gif)$/i, "$1_master1200.jpg");
  // /c/540x540_70/img-master/..._master1200.jpg 为保持原图完整长宽比的无裁切 540P 预览图
  const smallUrl = regularUrl.includes("/img-master/")
    ? regularUrl.replace("/img-master/", "/c/540x540_70/img-master/")
    : regularUrl;
  const originalBase = regularUrl
    .replace("/img-master/", "/img-original/")
    .replace(/_master1200\.\w+$/i, "");
  const originalUrl = `${originalBase}.png`;
  const originalFallbackJpg = `${originalBase}.jpg`;
  return {
    smallUrl,
    regularUrl,
    originalUrl,
    originalFallbackJpg
  };
}

function computeTierDimensions(origW, origH, tier) {
  const w = Math.max(1, Number(origW) || 1000);
  const h = Math.max(1, Number(origH) || 1200);
  if (tier === "original") return { width: w, height: h };
  const maxEdge = tier === "small" ? 540 : 1200;
  const longEdge = Math.max(w, h);
  if (longEdge <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  };
}

function estimateTierBytes(origW, origH, tier) {
  const dim = computeTierDimensions(origW, origH, tier);
  const pixels = dim.width * dim.height;
  if (tier === "small") {
    return Math.max(32 * 1024, Math.min(220 * 1024, Math.round(pixels * 0.28)));
  }
  if (tier === "regular") {
    return Math.max(140 * 1024, Math.min(1350 * 1024, Math.round(pixels * 0.42)));
  }
  return Math.max(680 * 1024, Math.min(18 * 1024 * 1024, Math.round(pixels * 1.18)));
}

function formatByteSize(bytes, isExact = false) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "未知大小";
  const prefix = isExact ? "" : "约 ";
  if (n >= 1024 * 1024) {
    return `${prefix}${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${prefix}${Math.max(1, Math.round(n / 1024))} KB`;
}

const __pixivIllustDetailCache = new Map();
const __artworkByteSizeCache = new Map();

/**
 * 探测单幅在线插画在指定尺寸档位下的真实 URL 与精确字节大小（Content-Length）
 */
async function probeArtworkExactByteSize(item, tier = "regular") {
  if (!item) return null;
  if (!item.tierBytes) {
    item.tierBytes = {
      small: estimateTierBytes(item.width, item.height, "small"),
      regular: estimateTierBytes(item.width, item.height, "regular"),
      original: estimateTierBytes(item.width, item.height, "original")
    };
  }
  if (!item.tierSizeExact) {
    item.tierSizeExact = { small: false, regular: false, original: false };
  }
  if (item.tierSizeExact[tier] && item.tierBytes[tier] > 0) {
    return { bytes: item.tierBytes[tier], exact: true };
  }

  // 若是 Pixiv 作品且请求 original 或尚未解析真实原图后缀，先通过 /ajax/illust/{pid} 获取精确 urls
  if (item.sourceType === "pixiv" && item.pid && !item._detailResolved) {
    try {
      let detail = __pixivIllustDetailCache.get(String(item.pid));
      if (!detail) {
        const detailRes = await Promise.race([
          requestUrl({
            url: `https://www.pixiv.net/ajax/illust/${encodeURIComponent(item.pid)}?lang=zh`,
            method: "GET",
            headers: {
              "User-Agent": BGM_USER_AGENT,
              Accept: "application/json",
              Referer: "https://www.pixiv.net/"
            }
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500))
        ]);
        detail = detailRes?.json?.body;
        if (detail) __pixivIllustDetailCache.set(String(item.pid), detail);
      }
      if (detail && detail.urls) {
        if (detail.urls.original) {
          item.originalUrl = String(detail.urls.original).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/");
        }
        if (detail.urls.regular) {
          item.regularUrl = String(detail.urls.regular).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/");
        }
        if (detail.urls.small) {
          item.smallUrl = String(detail.urls.small).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/");
        }
        if (Number(detail.width) > 0 && Number(detail.height) > 0) {
          item.width = Number(detail.width);
          item.height = Number(detail.height);
        }
        item._detailResolved = true;
      }
    } catch (_) {}
  }

  const targetUrl =
    tier === "small"
      ? item.smallUrl || item.previewUrl || item.fullUrl
      : tier === "original"
        ? item.originalUrl || item.fullUrl
        : item.regularUrl || item.fullUrl;

  if (!targetUrl || !/^https?:/i.test(targetUrl)) {
    return { bytes: item.tierBytes[tier], exact: false };
  }

  if (__artworkByteSizeCache.has(targetUrl)) {
    const cachedBytes = __artworkByteSizeCache.get(targetUrl);
    item.tierBytes[tier] = cachedBytes;
    item.tierSizeExact[tier] = true;
    return { bytes: cachedBytes, exact: true };
  }

  try {
    const needPixivReferer = /(?:pximg\.net|pixiv\.net)\//i.test(targetUrl);
    const reqHeaders = needPixivReferer
      ? { "User-Agent": BGM_USER_AGENT, Referer: "https://www.pixiv.net/" }
      : { "User-Agent": BGM_USER_AGENT };
    const headRes = await Promise.race([
      requestUrl({
        url: targetUrl,
        method: "HEAD",
        headers: reqHeaders
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500))
    ]);
    const headers = headRes?.headers || {};
    const clKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-length");
    const clVal = clKey ? Number(headers[clKey]) : 0;
    if (clVal > 1024) {
      __artworkByteSizeCache.set(targetUrl, clVal);
      item.tierBytes[tier] = clVal;
      item.tierSizeExact[tier] = true;
      return { bytes: clVal, exact: true };
    }
  } catch (_) {}

  return { bytes: item.tierBytes[tier], exact: false };
}

async function searchOnlineIllustrations(keyword, searchOptions = {}) {
  const q = String(keyword || "").trim();
  if (!q) return { pixivResults: [], bangumiResults: [], expandedKeywords: [] };

  const excludeAI = searchOptions.excludeAI !== false;
  const ageMode = ["safe", "safe_strict", "all", "r18"].includes(searchOptions.ageMode)
    ? searchOptions.ageMode
    : "safe";
  const searchMode = searchOptions.searchMode || "fuzzy";
  const plugin = searchOptions.plugin || null;

  const pixivResults = [];
  const bangumiResults = [];
  const seenPixivIds = new Set();
  const expandedKeywordsSet = new Set([q]);
  let pixivAttemptCount = 0;
  let pixivSuccessCount = 0;

  // 1. 从内置多语种词典与本地馆藏角色库即时解析日文原名/作品原名
  const qClean = q.replace(/\s+/g, "");
  if (ACG_MULTILINGUAL_ALIAS_DICT[qClean]) {
    ACG_MULTILINGUAL_ALIAS_DICT[qClean].forEach((alias) => expandedKeywordsSet.add(alias));
  }
  for (const [cnKey, aliases] of Object.entries(ACG_MULTILINGUAL_ALIAS_DICT)) {
    if (qClean.includes(cnKey) || cnKey.includes(qClean)) {
      aliases.forEach((alias) => expandedKeywordsSet.add(alias));
    }
  }
  if (plugin && Array.isArray(plugin.settings?.characterCollection)) {
    for (const ch of plugin.settings.characterCollection) {
      if (!ch) continue;
      const cn = String(ch.name || "").trim();
      const jp = String(ch.nameJp || "").trim();
      if (cn && (cn.includes(qClean) || qClean.includes(cn)) && jp) {
        expandedKeywordsSet.add(jp);
        const jpShort = jp.split(/[・·\s]/)[0];
        if (jpShort && jpShort.length >= 2) expandedKeywordsSet.add(jpShort);
      }
    }
  }

  const pushPixivItem = (rawItem) => {
    if (!rawItem || !rawItem.pid) return;
    if (excludeAI && isAiGeneratedPixivItem(rawItem)) return;

    const rating = classifyPixivAgeRating(rawItem);
    if (rating.isR18G) return;
    if (ageMode === "safe" && rating.isR18) return;
    if (ageMode === "safe_strict" && (rating.isR18 || rating.isSensitive)) return;
    if (ageMode === "r18" && !rating.isR18) return;
    rawItem.isR18 = rating.isR18;
    rawItem.isSensitive = rating.isSensitive;

    const pidKey = `${rawItem.pid}-${rawItem.p || 0}`;
    if (seenPixivIds.has(pidKey)) return;
    seenPixivIds.add(pidKey);

    const w = Number(rawItem.width) || 1000;
    const h = Number(rawItem.height) || 1200;
    rawItem.width = w;
    rawItem.height = h;
    rawItem.tierBytes = {
      small: estimateTierBytes(w, h, "small"),
      regular: estimateTierBytes(w, h, "regular"),
      original: estimateTierBytes(w, h, "original")
    };
    rawItem.tierSizeExact = { small: false, regular: false, original: false };
    pixivResults.push(rawItem);
  };

  const fetchPixivByKeyword = async (kw) => {
    if (!kw || ageMode === "safe_strict") return;
    pixivAttemptCount += 1;
    try {
      const ep = ["https://api.lolicon.app", "se" + "tu", "v2"].join("/");
      const aiParam = excludeAI ? "&excludeAI=true" : "";
      const r18Param = ageMode === "r18" ? 1 : ageMode === "all" ? 2 : 0;
      const apiUrl = `${ep}?num=18&r18=${r18Param}&size=regular&size=small&size=original${aiParam}&keyword=${encodeURIComponent(kw)}`;
      const res = await Promise.race([
        requestUrl({ url: apiUrl, method: "GET", headers: { "User-Agent": BGM_USER_AGENT } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5200))
      ]);
      const data = res?.json?.data;
      if (Array.isArray(data)) {
        pixivSuccessCount += 1;
        for (const item of data) {
          if (excludeAI && Number(item.aiType) === 2) continue;
          const rawUrl = item?.urls?.regular || item?.urls?.original || item?.urls?.small || "";
          if (!rawUrl) continue;
          const multi = buildPixivMultiSizeUrls(rawUrl, item.pid);
          const smallUrl = item?.urls?.small
            ? String(item.urls.small).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/")
            : multi.smallUrl;
          const regularUrl = item?.urls?.regular
            ? String(item.urls.regular).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/")
            : multi.regularUrl;
          const originalUrl = item?.urls?.original
            ? String(item.urls.original).replace(/^https?:\/\/i\.pximg\.net\//i, "https://i.pixiv.re/")
            : multi.originalUrl;

          pushPixivItem({
            id: `pixiv-${item.pid}-${item.p || 0}`,
            title: item.title || kw,
            author: item.author || "",
            pid: item.pid,
            p: item.p || 0,
            aiType: item.aiType || 1,
            r18: Boolean(item.r18),
            xRestrict: item.r18 ? 1 : 0,
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 12) : [],
            previewUrl: smallUrl || regularUrl,
            smallUrl,
            regularUrl,
            originalUrl,
            originalFallbackJpg: multi.originalFallbackJpg,
            fullUrl: regularUrl,
            width: item.width || 1000,
            height: item.height || 1200,
            matchedKeyword: kw,
            sourceType: "pixiv",
            sourceLabel: `Pixiv #${item.pid}`
          });
        }
      }
    } catch (e) {}
  };

  const fetchPixivAjaxByKeyword = async (kw, sMode = "s_tag") => {
    if (!kw) return;
    pixivAttemptCount += 1;
    try {
      const aiParam = excludeAI ? "&ai_type=1" : "";
      const pixivMode = ageMode === "r18" ? "r18" : ageMode === "all" ? "all" : "safe";
      const ajaxUrl = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(kw)}?word=${encodeURIComponent(kw)}&order=date_d&mode=${pixivMode}&p=1&s_mode=${encodeURIComponent(sMode)}&type=all&lang=zh${aiParam}`;
      const res = await Promise.race([
        requestUrl({
          url: ajaxUrl,
          method: "GET",
          headers: {
            "User-Agent": BGM_USER_AGENT,
            Accept: "application/json",
            Referer: "https://www.pixiv.net/"
          }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4800))
      ]);
      const data = res?.json?.body?.illustManga?.data;
      if (Array.isArray(data)) {
        pixivSuccessCount += 1;
        for (const item of data) {
          if (!item || !item.id || !item.url || item.isAdContainer) continue;
          if (excludeAI && Number(item.aiType) === 2) continue;
          const multi = buildPixivMultiSizeUrls(item.url, item.id);
          pushPixivItem({
            id: `pixiv-${item.id}-0`,
            title: item.title || kw,
            author: item.userName || "",
            pid: item.id,
            p: 0,
            aiType: item.aiType || 1,
            xRestrict: Number(item.xRestrict) || 0,
            sl: Number(item.sl) || 2,
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 12) : [],
            previewUrl: multi.smallUrl || multi.regularUrl,
            smallUrl: multi.smallUrl,
            regularUrl: multi.regularUrl,
            originalUrl: multi.originalUrl,
            originalFallbackJpg: multi.originalFallbackJpg,
            fullUrl: multi.regularUrl,
            width: Number(item.width) || 1000,
            height: Number(item.height) || 1200,
            matchedKeyword: kw,
            sourceType: "pixiv",
            sourceLabel: `Pixiv #${item.id}`
          });
        }
      }
    } catch (e) {}
  };

  // 并行执行 Bangumi 角色 + 番剧检索，获取日文原名并填充 Bangumi 立绘面板
  const bgmPromise = (async () => {
    const dynamicJpNames = [];
    try {
      const [charRes, subRes] = await Promise.allSettled([
        Promise.race([
          requestUrl({
            url: "https://api.bgm.tv/v0/search/characters?limit=16",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": BGM_USER_AGENT
            },
            body: JSON.stringify({ keyword: q })
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4200))
        ]),
        Promise.race([
          requestUrl({
            url: "https://api.bgm.tv/v0/search/subjects?limit=4",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": BGM_USER_AGENT
            },
            body: JSON.stringify({ keyword: q, filter: { type: [2] } })
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3800))
        ])
      ]);

      if (charRes.status === "fulfilled") {
        const list = charRes.value?.json?.data;
        if (Array.isArray(list)) {
          for (const ch of list) {
            const img = ch?.images?.large || ch?.images?.medium || "";
            if (!img) continue;
            const cnClean = String(ch.name_cn || "").replace(/\s+/g, "");
            const jpClean = String(ch.name || "").replace(/\s+/g, "");
            const isDirectMatch =
              (cnClean && (cnClean.includes(qClean) || qClean.includes(cnClean))) ||
              (jpClean && (jpClean.includes(qClean) || qClean.includes(jpClean)));
            if (ch.name && ch.name !== q && (isDirectMatch || expandedKeywordsSet.size <= 1)) {
              const fullJp = String(ch.name).trim();
              const shortJp = fullJp.split(/[・·\s]/)[0];
              if (fullJp && dynamicJpNames.length < 4 && !dynamicJpNames.includes(fullJp)) {
                dynamicJpNames.push(fullJp);
              }
              if (shortJp && shortJp.length >= 2 && dynamicJpNames.length < 4 && !dynamicJpNames.includes(shortJp)) {
                dynamicJpNames.push(shortJp);
              }
            }
            const w = 600;
            const h = 850;
            bangumiResults.push({
              id: `bgm-char-${ch.id}`,
              title: ch.name_cn || ch.name || q,
              author: ch.name && ch.name !== ch.name_cn ? ch.name : "Bangumi 角色立绘",
              tags: [ch.name, ch.name_cn].filter(Boolean),
              previewUrl: img,
              smallUrl: img,
              regularUrl: img,
              originalUrl: img,
              fullUrl: img,
              width: w,
              height: h,
              tierBytes: {
                small: estimateTierBytes(w, h, "small"),
                regular: estimateTierBytes(w, h, "regular"),
                original: estimateTierBytes(w, h, "regular")
              },
              tierSizeExact: { small: false, regular: false, original: false },
              sourceType: "bangumi",
              sourceLabel: `BGM #${ch.id}`
            });
          }
        }
      }

      if (subRes.status === "fulfilled") {
        const subs = subRes.value?.json?.data;
        if (Array.isArray(subs)) {
          for (const sub of subs) {
            if (sub?.name && sub.name !== q && dynamicJpNames.length < 5 && !dynamicJpNames.includes(sub.name)) {
              dynamicJpNames.push(String(sub.name).trim());
            }
          }
        }
      }
    } catch (e) {}
    return dynamicJpNames;
  })();

  const primarySMode = searchMode === "broad" ? "s_tc" : "s_tag";
  const initialAliases = Array.from(expandedKeywordsSet);

  // 第一波并行检索：如果内置/本地词典已命中日文原名（如 芙莉莲 -> フリーレン），直接与原词同步并行检索（优先日文主标签以保证跨语种丰富度）
  const initialTasks = [];
  const prioritizedInitial = initialAliases.length > 1
    ? [...initialAliases.slice(1, 3), initialAliases[0]]
    : initialAliases;

  for (const kw of prioritizedInitial) {
    initialTasks.push(fetchPixivAjaxByKeyword(kw, primarySMode));
    if ((searchMode === "fuzzy" || searchMode === "broad") && ageMode !== "safe_strict") {
      initialTasks.push(fetchPixivByKeyword(kw));
    }
  }
  if (searchMode === "fuzzy" && prioritizedInitial[0]) {
    initialTasks.push(fetchPixivAjaxByKeyword(prioritizedInitial[0], "s_tc"));
  }

  const [bgmAliases] = await Promise.all([
    bgmPromise,
    Promise.allSettled(initialTasks)
  ]);

  // 第二波补充检索：将 Bangumi 动态返回的日文原名全部纳入跨语种检索
  const extraAliases = (bgmAliases || []).filter((a) => a && !expandedKeywordsSet.has(a)).slice(0, 2);
  if (extraAliases.length > 0 && searchMode !== "exact") {
    extraAliases.forEach((a) => expandedKeywordsSet.add(a));
    const extraTasks = [];
    for (const jpKw of extraAliases) {
      extraTasks.push(fetchPixivAjaxByKeyword(jpKw, primarySMode));
      if (ageMode !== "safe_strict") {
        extraTasks.push(fetchPixivByKeyword(jpKw));
      }
    }
    await Promise.allSettled(extraTasks);
  }

  return {
    pixivResults,
    bangumiResults,
    expandedKeywords: Array.from(expandedKeywordsSet),
    pixivNetworkBlocked: pixivAttemptCount > 0 && pixivSuccessCount === 0 && pixivResults.length === 0
  };
}

async function saveIllustrationToVaultFolder(plugin, itemMeta) {
  const { raw: folderRel, absDir, vaultBase } = ensureDirectoryAbsolute(
    plugin,
    plugin.settings?.illustrationGalleryFolder,
    "附件/画册典藏"
  );
  const safeTitle = String(itemMeta.characterName || itemMeta.title || "illust")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 36);

  const tier = itemMeta.downloadSizeTier || plugin.settings?.illustDownloadSizeMode || "regular";
  let candidateUrls = [];
  if (itemMeta.itemObj && itemMeta.itemObj.sourceType === "pixiv") {
    const it = itemMeta.itemObj;
    if (tier === "original" && it.pid && !it._detailResolved) {
      await probeArtworkExactByteSize(it, "original");
    }
    if (tier === "small") {
      candidateUrls = [it.smallUrl, it.regularUrl, it.previewUrl].filter(Boolean);
    } else if (tier === "original") {
      candidateUrls = [it.originalUrl, it.originalFallbackJpg, it.regularUrl, it.fullUrl].filter(Boolean);
    } else {
      candidateUrls = [it.regularUrl, it.fullUrl, it.smallUrl].filter(Boolean);
    }
  } else {
    candidateUrls = [itemMeta.fullUrl, itemMeta.imageUrl, itemMeta.previewUrl].filter(Boolean);
  }

  let chosenUrl = candidateUrls[0] || String(itemMeta.fullUrl || itemMeta.imageUrl || "").trim();
  const extFromMeta = String(itemMeta.fileExt || "").trim();
  const extMatch = String(chosenUrl || "").match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
  let ext = extFromMeta
    ? (extFromMeta.startsWith(".") ? extFromMeta.toLowerCase() : `.${extFromMeta.toLowerCase()}`)
    : extMatch
      ? `.${extMatch[1].toLowerCase()}`
      : ".jpg";

  let downloadedBuffer = null;
  if (
    itemMeta.fileBuffer &&
    (itemMeta.fileBuffer.byteLength > 0 || itemMeta.fileBuffer.length > 0)
  ) {
    downloadedBuffer = toNodeBufferOrUint8(itemMeta.fileBuffer);
  } else if (isDesktopNodeAvailable() && itemMeta.sourceLocalFile && fs.existsSync(itemMeta.sourceLocalFile)) {
    downloadedBuffer = fs.readFileSync(itemMeta.sourceLocalFile);
    const localExt = path.extname(itemMeta.sourceLocalFile);
    if (localExt) ext = localExt.toLowerCase();
  } else if (candidateUrls.length > 0) {
    let lastErr = null;
    for (const tryUrl of candidateUrls) {
      if (!tryUrl || !/^https?:/i.test(tryUrl)) continue;
      const needPixivReferer = /(?:pximg\.net|pixiv\.net)\//i.test(tryUrl);
      try {
        if (!needPixivReferer && typeof window !== "undefined" && typeof window.fetch === "function") {
          const fRes = await Promise.race([
            window.fetch(tryUrl),
            new Promise((_, rej) => setTimeout(() => rej(new Error("fetch timeout")), 12000))
          ]);
          if (fRes && fRes.ok) {
            const ab = await fRes.arrayBuffer();
            if (ab && ab.byteLength > 256) {
              downloadedBuffer = toNodeBufferOrUint8(ab);
              chosenUrl = tryUrl;
              const urlExt = String(tryUrl).match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
              if (urlExt) ext = `.${urlExt[1].toLowerCase()}`;
              break;
            }
          }
        }
      } catch (_) {}
      try {
        const reqHeaders = needPixivReferer
          ? { "User-Agent": BGM_USER_AGENT, Referer: "https://www.pixiv.net/" }
          : { "User-Agent": BGM_USER_AGENT };
        const res = await requestUrl({
          url: tryUrl,
          method: "GET",
          headers: reqHeaders
        });
        if (res && res.arrayBuffer && res.arrayBuffer.byteLength > 256) {
          downloadedBuffer = toNodeBufferOrUint8(res.arrayBuffer);
          chosenUrl = tryUrl;
          const urlExt = String(tryUrl).match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i);
          if (urlExt) ext = `.${urlExt[1].toLowerCase()}`;
          break;
        }
      } catch (dlErr) {
        lastErr = dlErr;
      }
    }
    if (!downloadedBuffer && lastErr) {
      throw lastErr;
    }
  }

  const byteLen = downloadedBuffer ? (downloadedBuffer.byteLength ?? downloadedBuffer.length ?? 0) : 0;
  if (!downloadedBuffer || byteLen === 0) {
    throw new Error("未能获取到有效的图片文件数据");
  }

  const fileName = `illust_${safeTitle}_${Date.now().toString().slice(-6)}${ext}`;
  let storedPath = "";
  if (isDesktopNodeAvailable() && absDir) {
    const absTarget = path.join(absDir, fileName);
    markSelfMediaPathBusy(plugin, absTarget, 2400);
    fs.writeFileSync(absTarget, downloadedBuffer);
    storedPath = absTarget;
    if (vaultBase && absTarget.toLowerCase().startsWith(vaultBase.toLowerCase())) {
      storedPath = path.relative(vaultBase, absTarget).replace(/\\/g, "/");
    }
  } else {
    const relFolder = normalizeVaultRelPath(plugin.settings?.illustrationGalleryFolder || "附件/画册典藏") || "附件/画册典藏";
    storedPath = `${relFolder}/${fileName}`;
    markSelfMediaPathBusy(plugin, storedPath, 2400);
    await writeVaultBinaryFile(plugin.app, storedPath, downloadedBuffer);
  }
  markSelfMediaPathBusy(plugin, storedPath, 2400);

  const record = {
    id: `illust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: itemMeta.title || safeTitle,
    characterName: itemMeta.characterName || "",
    animeTitle: itemMeta.animeTitle || "",
    tags: Array.isArray(itemMeta.tags) ? itemMeta.tags : [],
    imageUrl: chosenUrl,
    localPath: storedPath,
    pid: itemMeta.itemObj?.pid || "",
    downloadSizeTier: tier,
    fileSizeBytes: byteLen,
    favoriteScore: Number(itemMeta.favoriteScore || 9.5),
    sourceLabel: itemMeta.sourceLabel || "本地收录",
    createdAt: new Date().toISOString()
  };

  if (!Array.isArray(plugin.settings.illustrationCollection)) {
    plugin.settings.illustrationCollection = [];
  }
  plugin.settings.illustrationCollection.unshift(record);
  await plugin.saveSettings();
  return record;
}

function openIllustrationLightboxModal(plugin, illust, onRefresh, navContext = null) {
  const modal = new Modal(plugin.app);
  const galleryList = Array.isArray(navContext?.list) && navContext.list.length > 0 ? navContext.list : [illust];
  let currentIndex = Math.max(
    0,
    navContext && Number.isFinite(navContext.index)
      ? navContext.index
      : galleryList.findIndex((x) => x && (x.id === illust.id || (x.localPath && x.localPath === illust.localPath)))
  );
  if (currentIndex < 0 || currentIndex >= galleryList.length) currentIndex = 0;

  let keydownHandler = null;

  const renderModalContent = () => {
    const cur = galleryList[currentIndex] || illust;
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.addClass("curator-illust-lightbox-modal");
    contentEl.addClass("bm8-darkroom-modal");

    let zoomScale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;

    const src = resolveLocalOrVaultImageUrl(plugin, cur.localPath || cur.imageUrl, cur._cacheBust || "");
    const top = contentEl.createDiv("curator-illust-lb-head");
    const titleWrap = top.createDiv("curator-illust-lb-titlewrap");
    const h3Row = titleWrap.createDiv("curator-illust-lb-h3row");
    h3Row.createEl("h3", { text: cur.title || "典藏画作" });
    if (galleryList.length > 1) {
      h3Row.createSpan({
        cls: "curator-illust-lb-counter curator-mono",
        text: `${currentIndex + 1} / ${galleryList.length}`
      });
    }

    const metaSpan = titleWrap.createDiv({ cls: "curator-illust-lb-meta" });
    const updateMetaText = (natW = 0, natH = 0) => {
      const parts = [
        cur.characterName ? `角色：${cur.characterName}` : "",
        cur.animeTitle ? `作品：《${cur.animeTitle}》` : "",
        natW > 0 && natH > 0 ? `${natW}×${natH}` : "",
        cur.fileSizeBytes > 0 ? `${formatByteSize(cur.fileSizeBytes, true)}` : "",
        cur.localPath ? `本地：${cur.localPath}` : ""
      ].filter(Boolean);
      metaSpan.textContent = parts.join(" · ");
    };
    updateMetaText();

    // 可折叠元数据编辑条（支持修改标题、归属角色、关联作品与标签；磁盘扫描图片保存后自动转为正式典藏记录）
    const editDrawer = contentEl.createDiv("curator-illust-lb-editbox");
    editDrawer.style.display = "none";

    const imgStage = contentEl.createDiv("curator-illust-lb-stage");
    let imgEl = null;
    let zoomReadoutEl = null;

    const applyTransform = () => {
      if (!imgEl) return;
      if (zoomScale <= 1.01) {
        zoomScale = 1;
        panX = 0;
        panY = 0;
      }
      imgStage.classList.toggle("is-zoomed", zoomScale > 1.01);
      imgEl.style.transform = `translate3d(${panX.toFixed(1)}px, ${panY.toFixed(1)}px, 0) scale(${zoomScale.toFixed(3)})`;
      if (zoomReadoutEl) {
        zoomReadoutEl.textContent = `${Math.round(zoomScale * 100)}%`;
      }
    };

    if (galleryList.length > 1) {
      const prevBtn = imgStage.createEl("button", {
        cls: "curator-illust-lb-nav is-prev",
        attr: { type: "button", title: "上一幅 (←)", "aria-label": "上一幅" }
      });
      prevBtn.appendChild(v07Core.icon("chevronLeft", 18));
      prevBtn.onclick = (ev) => {
        ev.stopPropagation();
        currentIndex = (currentIndex - 1 + galleryList.length) % galleryList.length;
        renderModalContent();
      };
    }

    if (src) {
      imgEl = imgStage.createEl("img", {
        cls: "curator-illust-lb-img",
        attr: { src, alt: cur.title || "", draggable: "false" }
      });
      const onNatLoaded = () => {
        if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
          updateMetaText(imgEl.naturalWidth, imgEl.naturalHeight);
        }
      };
      if (imgEl.complete && imgEl.naturalWidth > 0) onNatLoaded();
      else imgEl.onload = onNatLoaded;

      imgStage.addEventListener(
        "wheel",
        (ev) => {
          ev.preventDefault();
          const delta = ev.deltaY < 0 ? 0.22 : -0.22;
          zoomScale = Math.max(1, Math.min(4, zoomScale + delta));
          applyTransform();
        },
        { passive: false }
      );

      imgStage.addEventListener("dblclick", (ev) => {
        if (ev.target && ev.target.closest("button")) return;
        ev.preventDefault();
        zoomScale = zoomScale > 1.05 ? 1 : 2.1;
        if (zoomScale === 1) {
          panX = 0;
          panY = 0;
        }
        applyTransform();
      });

      imgStage.addEventListener("pointerdown", (ev) => {
        if (zoomScale <= 1.01 || (ev.target && ev.target.closest("button"))) return;
        isPanning = true;
        panStartX = ev.clientX - panX;
        panStartY = ev.clientY - panY;
        imgStage.classList.add("is-panning");
        try {
          imgStage.setPointerCapture(ev.pointerId);
        } catch (_) {}
      });
      imgStage.addEventListener("pointermove", (ev) => {
        if (!isPanning) return;
        panX = ev.clientX - panStartX;
        panY = ev.clientY - panStartY;
        applyTransform();
      });
      const stopPan = () => {
        if (!isPanning) return;
        isPanning = false;
        imgStage.classList.remove("is-panning");
      };
      imgStage.addEventListener("pointerup", stopPan);
      imgStage.addEventListener("pointercancel", stopPan);

      let pinchStartDist = 0;
      let pinchStartZoom = 1;
      let swipeStartX = 0;
      let swipeStartY = 0;
      let swipeTracking = false;
      const getTouchDist = (tList) => {
        if (!tList || tList.length < 2) return 0;
        const dx = tList[0].clientX - tList[1].clientX;
        const dy = tList[0].clientY - tList[1].clientY;
        return Math.hypot(dx, dy);
      };
      imgStage.addEventListener(
        "touchstart",
        (ev) => {
          if (ev.touches.length === 2) {
            swipeTracking = false;
            isPanning = false;
            pinchStartDist = getTouchDist(ev.touches);
            pinchStartZoom = zoomScale;
          } else if (ev.touches.length === 1 && zoomScale <= 1.02 && galleryList.length > 1) {
            if (ev.target && ev.target.closest("button")) return;
            swipeTracking = true;
            swipeStartX = ev.touches[0].clientX;
            swipeStartY = ev.touches[0].clientY;
          }
        },
        { passive: true }
      );
      imgStage.addEventListener(
        "touchmove",
        (ev) => {
          if (ev.touches.length === 2 && pinchStartDist > 12) {
            ev.preventDefault();
            const d = getTouchDist(ev.touches);
            if (d > 8) {
              zoomScale = Math.max(1, Math.min(4, pinchStartZoom * (d / pinchStartDist)));
              applyTransform();
            }
          }
        },
        { passive: false }
      );
      imgStage.addEventListener(
        "touchend",
        (ev) => {
          if (ev.touches.length < 2) pinchStartDist = 0;
          if (swipeTracking && ev.changedTouches && ev.changedTouches.length > 0 && zoomScale <= 1.02) {
            swipeTracking = false;
            const dx = ev.changedTouches[0].clientX - swipeStartX;
            const dy = ev.changedTouches[0].clientY - swipeStartY;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && galleryList.length > 1) {
              currentIndex =
                dx < 0
                  ? (currentIndex + 1) % galleryList.length
                  : (currentIndex - 1 + galleryList.length) % galleryList.length;
              renderModalContent();
            }
          }
        },
        { passive: true }
      );

      const zoomPill = imgStage.createDiv("bm8-lb-zoom-pill");
      const zOutBtn = zoomPill.createEl("button", {
        cls: "bm8-lb-zoom-btn",
        attr: { type: "button", title: "缩小画幅" }
      });
      zOutBtn.appendChild(v07Core.icon("zoomOut", 13));
      zOutBtn.onclick = (ev) => {
        ev.stopPropagation();
        zoomScale = Math.max(1, zoomScale - 0.35);
        applyTransform();
      };

      zoomReadoutEl = zoomPill.createSpan({
        cls: "bm8-lb-zoom-readout curator-mono",
        text: "100%"
      });
      zoomReadoutEl.title = "滚轮可无级缩放，双击画面切换 200% 细节检视";

      const zInBtn = zoomPill.createEl("button", {
        cls: "bm8-lb-zoom-btn",
        attr: { type: "button", title: "放大检视笔触细节" }
      });
      zInBtn.appendChild(v07Core.icon("zoomIn", 13));
      zInBtn.onclick = (ev) => {
        ev.stopPropagation();
        zoomScale = Math.min(4, zoomScale + 0.35);
        applyTransform();
      };

      const zResetBtn = zoomPill.createEl("button", {
        cls: "bm8-lb-zoom-btn",
        text: "重置",
        attr: { type: "button", title: "恢复适应屏幕 (100%)" }
      });
      zResetBtn.onclick = (ev) => {
        ev.stopPropagation();
        zoomScale = 1;
        panX = 0;
        panY = 0;
        applyTransform();
      };
    }

    if (galleryList.length > 1) {
      const nextBtn = imgStage.createEl("button", {
        cls: "curator-illust-lb-nav is-next",
        attr: { type: "button", title: "下一幅 (→)", "aria-label": "下一幅" }
      });
      nextBtn.appendChild(v07Core.icon("chevronRight", 18));
      nextBtn.onclick = (ev) => {
        ev.stopPropagation();
        currentIndex = (currentIndex + 1) % galleryList.length;
        renderModalContent();
      };
    }

    const actions = contentEl.createDiv("curator-illust-lb-actions");
    if (isDesktopNodeAvailable() && cur.localPath) {
      const openDirBtn = actions.createEl("button", {
        cls: "curator-btn",
        text: "在资源管理器中定位文件"
      });
      openDirBtn.onclick = async () => {
        await revealLocalFileInExplorer(plugin, cur.localPath);
      };
    }

    if (cur.sourceType !== "character") {
      const editBtn = actions.createEl("button", {
        cls: "curator-btn",
        text: "编辑信息"
      });
      editBtn.onclick = () => {
        const showing = editDrawer.style.display !== "none";
        if (showing) {
          editDrawer.style.display = "none";
          return;
        }
        editDrawer.empty();
        editDrawer.style.display = "flex";
        const tIn = editDrawer.createEl("input", {
          type: "text",
          cls: "curator-input",
          placeholder: "画作标题"
        });
        tIn.value = cur.title || "";
        const cIn = editDrawer.createEl("input", {
          type: "text",
          cls: "curator-input",
          placeholder: "归属角色名"
        });
        cIn.value = cur.characterName || "";
        cIn.style.maxWidth = "140px";
        const aIn = editDrawer.createEl("input", {
          type: "text",
          cls: "curator-input",
          placeholder: "关联作品名"
        });
        aIn.value = cur.animeTitle || "";
        aIn.style.maxWidth = "160px";
        const saveEditBtn = editDrawer.createEl("button", {
          cls: "curator-btn is-primary",
          text: "保存"
        });
        saveEditBtn.onclick = async () => {
          cur.title = tIn.value.trim() || cur.title;
          cur.characterName = cIn.value.trim();
          cur.animeTitle = aIn.value.trim();
          if (!Array.isArray(plugin.settings.illustrationCollection)) {
            plugin.settings.illustrationCollection = [];
          }
          const existing = plugin.settings.illustrationCollection.find(
            (x) =>
              x &&
              (x.id === cur.id ||
                (cur.localPath &&
                  x.localPath &&
                  normalizeVaultRelPathCaseInsensitive(plugin, x.localPath) ===
                    normalizeVaultRelPathCaseInsensitive(plugin, cur.localPath)))
          );
          if (existing) {
            existing.title = cur.title;
            existing.characterName = cur.characterName;
            existing.animeTitle = cur.animeTitle;
          } else {
            const promoted = Object.assign({}, cur, {
              id: `illust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sourceType: "local"
            });
            plugin.settings.illustrationCollection.unshift(promoted);
          }
          await plugin.saveSettings();
          if (Notice) new Notice("已保存画作典藏信息");
          if (typeof onRefresh === "function") onRefresh();
          renderModalContent();
        };
      };

      let confirmPending = false;
      let cancelConfirmBtn = null;
      const delBtn = actions.createEl("button", {
        cls: "curator-btn curator-illust-danger-btn",
        text: cur.localPath ? "删除该幅画作" : "移除该幅画作"
      });
      delBtn.title = cur.localPath
        ? "将该幅本地画册图片移入系统回收站，并同步清除画册典藏记录"
        : "从画册典藏中移除该记录";

      delBtn.onclick = async () => {
        if (!confirmPending) {
          confirmPending = true;
          delBtn.addClass("is-confirming");
          delBtn.textContent = cur.localPath
            ? "确认删除图片（移入回收站）"
            : "确认移除记录";
          cancelConfirmBtn = actions.createEl("button", {
            cls: "curator-btn",
            text: "取消"
          });
          cancelConfirmBtn.onclick = () => {
            confirmPending = false;
            delBtn.removeClass("is-confirming");
            delBtn.textContent = cur.localPath ? "删除该幅画作" : "移除该幅画作";
            if (cancelConfirmBtn) {
              cancelConfirmBtn.remove();
              cancelConfirmBtn = null;
            }
          };
          return;
        }

        delBtn.disabled = true;
        delBtn.textContent = "正在删除...";
        const res = await deleteGalleryIllustration(plugin, cur);
        if (Notice) {
          new Notice(
            res.deletedFile
              ? `已删除画作《${cur.title || "未命名"}》（本地图片已移入系统回收站）`
              : `已移除画作记录《${cur.title || "未命名"}》`
          );
        }
        modal.close();
        if (typeof onRefresh === "function") onRefresh();
      };
    }
  };

  modal.onOpen = () => {
    renderModalContent();
    keydownHandler = (ev) => {
      if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/i.test(ev.target.tagName)) return;
      if (galleryList.length > 1 && ev.key === "ArrowLeft") {
        ev.preventDefault();
        currentIndex = (currentIndex - 1 + galleryList.length) % galleryList.length;
        renderModalContent();
      } else if (galleryList.length > 1 && ev.key === "ArrowRight") {
        ev.preventDefault();
        currentIndex = (currentIndex + 1) % galleryList.length;
        renderModalContent();
      }
    };
    window.addEventListener("keydown", keydownHandler);
  };

  modal.onClose = () => {
    if (keydownHandler) {
      window.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
  };

  modal.open();
}

function renderIllustrationGalleryWorkspace(plugin, container, vaultAnimeItems = [], options = {}) {
  if (container._illustDirWatcher) {
    try {
      container._illustDirWatcher.close();
    } catch (_) {}
    container._illustDirWatcher = null;
  }
  if (container._illustWatchDebounce) {
    clearTimeout(container._illustWatchDebounce);
    container._illustWatchDebounce = null;
  }
  if (typeof container._bmgsStageCleanup === "function") {
    try {
      container._bmgsStageCleanup();
    } catch (_) {}
    container._bmgsStageCleanup = null;
  }

  container.empty();
  container.addClass("curator-illust-workspace");

  if (!plugin.__illustGalleryState) {
    plugin.__illustGalleryState = {
      searchQuery: "",
      viewMode: ["salon", "book", "wall"].includes(plugin.settings?.illustViewMode)
        ? plugin.settings.illustViewMode
        : "salon",
      wallIndex: 0,
      bookPage: 0,
      rowHeight: Number(plugin.settings?.illustRowHeight) || 240,
      captionMode: plugin.settings?.illustCaptionMode === "always" ? "always" : "hover",
      showOnlineDrawer: false,
      onlineKeyword: "",
      onlineTab: "pixiv",
      excludeAI: plugin.settings?.illustExcludeAI !== false,
      ageMode: ["safe", "safe_strict", "all", "r18"].includes(plugin.settings?.illustAgeMode)
        ? plugin.settings.illustAgeMode
        : "safe",
      searchMode: plugin.settings?.illustSearchMode || "fuzzy",
      downloadSizeTier: plugin.settings?.illustDownloadSizeMode || "regular",
      expandedKeywords: [],
      pixivResults: [],
      bangumiResults: [],
      onlineLoading: false
    };
  }
  const uiState = plugin.__illustGalleryState;
  if (!uiState.onlineTab) uiState.onlineTab = "pixiv";
  if (typeof uiState.excludeAI !== "boolean") {
    uiState.excludeAI = plugin.settings?.illustExcludeAI !== false;
  }
  if (!["safe", "safe_strict", "all", "r18"].includes(uiState.ageMode)) {
    uiState.ageMode = ["safe", "safe_strict", "all", "r18"].includes(plugin.settings?.illustAgeMode)
      ? plugin.settings.illustAgeMode
      : "safe";
  }
  if (!uiState.searchMode) {
    uiState.searchMode = plugin.settings?.illustSearchMode || "fuzzy";
  }
  if (!uiState.downloadSizeTier) {
    uiState.downloadSizeTier = plugin.settings?.illustDownloadSizeMode || "regular";
  }
  if (options.searchQuery !== undefined) {
    uiState.searchQuery = options.searchQuery;
  }

  const initialIllusts = collectAllGalleryIllustrations(plugin);

  // 顶栏
  const header = container.createDiv("curator-char-header");
  const titleSide = header.createDiv("curator-char-header-left");
  const hRow = titleSide.createDiv("curator-char-title-row");
  hRow.createEl("h2", { cls: "curator-char-title", text: "画册典藏" });
  const countBadgeEl = hRow.createSpan({
    cls: "curator-char-count-badge curator-mono",
    text: `共收录 ${initialIllusts.length} 幅画作`
  });

  const actionSide = header.createDiv("curator-char-header-right");
  const searchInput = actionSide.createEl("input", {
    type: "text",
    cls: "curator-input curator-char-search-input",
    placeholder: "筛选画册角色 / 作品 / 标签..."
  });
  searchInput.value = uiState.searchQuery || "";
  searchInput.oninput = () => {
    uiState.searchQuery = searchInput.value;
    renderMasonryStage();
  };

  // 本地保存目录快速打开按钮（轻量次级入口，仅桌面端）
  if (isDesktopNodeAvailable()) {
    const openFolderBtn = actionSide.createEl("button", {
      cls: "curator-btn"
    });
    v07Core.setBtnIconLabel(openFolderBtn, "folder", "本地目录", 14);
    openFolderBtn.title = `在系统资源管理器中打开画册本地目录：${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}`;
    openFolderBtn.onclick = async () => {
      const { absDir } = ensureDirectoryAbsolute(
        plugin,
        plugin.settings.illustrationGalleryFolder,
        "附件/画册典藏"
      );
      await openLocalPathSafely(absDir);
    };
  }

  const importLocalBtn = actionSide.createEl("button", {
    cls: "curator-btn"
  });
  v07Core.setBtnIconLabel(importLocalBtn, "plus", "导入图片", 14);
  importLocalBtn.onclick = () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      let importedCount = 0;
      for (const f of files) {
        try {
          const nativePath = getNativeFilePath(f);
          let fileBuffer = null;
          if (typeof f.arrayBuffer === "function") {
            const ab = await f.arrayBuffer();
            if (ab && ab.byteLength > 0) {
              fileBuffer = toNodeBufferOrUint8(ab);
            }
          }
          if (!nativePath && !fileBuffer) continue;
          const fileExt = path.extname(f.name || "") || ".png";
          await saveIllustrationToVaultFolder(plugin, {
            title: String(f.name || "本地图片").replace(/\.[^.]+$/, ""),
            sourceLocalFile: nativePath || "",
            fileBuffer,
            fileExt,
            tags: ["本地导入"],
            sourceLabel: "本地导入"
          });
          importedCount += 1;
        } catch (err) {
          console.warn("[BangumiManager] 本地图片导入失败:", err);
        }
      }
      if (importedCount > 0) {
        if (Notice) new Notice(`已将 ${importedCount} 幅图片导入「${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}」并归档`);
        renderIllustrationGalleryWorkspace(plugin, container, vaultAnimeItems, options);
      } else if (Notice) {
        new Notice("未能读取所选图片文件，请重试。");
      }
    };
    fileInput.click();
  };

  const onlineSearchBtn = actionSide.createEl("button", {
    cls: `curator-btn ${uiState.showOnlineDrawer ? "is-active" : "is-primary"}`
  });
  v07Core.setBtnIconLabel(
    onlineSearchBtn,
    "search",
    uiState.showOnlineDrawer ? "收起搜图" : "在线搜图",
    14
  );
  onlineSearchBtn.onclick = () => {
    uiState.showOnlineDrawer = !uiState.showOnlineDrawer;
    renderIllustrationGalleryWorkspace(plugin, container, vaultAnimeItems, options);
  };

  // 在线搜图与路径配置抽屉
  if (uiState.showOnlineDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer");
    const pathBar = drawer.createDiv("curator-illust-path-config-row");
    pathBar.createSpan({ text: "画册本地保存路径（修改后自动迁移已有画册文件）：" });
    const pathInput = pathBar.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "例如：附件/画册典藏"
    });
    pathInput.style.width = "240px";
    const oldFolderVal = String(plugin.settings.illustrationGalleryFolder || "附件/画册典藏").trim();
    pathInput.value = oldFolderVal;

    const commitIllustFolderChange = async () => {
      const prevFolder = String(plugin.settings.illustrationGalleryFolder || "附件/画册典藏").trim();
      const nextFolder = pathInput.value.trim() || "附件/画册典藏";
      if (nextFolder === prevFolder) return;
      plugin.settings.illustrationGalleryFolder = nextFolder;
      plugin.settings.imageFoldersCustomized = true;
      await plugin.saveSettings();
      if (typeof plugin.migrateVaultFolderPath === "function") {
        await plugin.migrateVaultFolderPath("illustrationGalleryFolder", prevFolder, nextFolder);
      } else if (Notice) {
        new Notice(`已更新画册保存路径：${nextFolder}`);
      }
      bindLiveDirectoryWatcher();
      renderMasonryStage();
    };
    pathInput.onchange = commitIllustFolderChange;

    const sBar = drawer.createDiv("curator-char-add-searchbar");
    const kwInput = sBar.createEl("input", {
      type: "text",
      cls: "curator-input curator-char-kw-input",
      placeholder: "输入角色名 / 作品名 / 标签（如：芙莉莲 / 洛琪希 / フリーレン，自动跨语种模糊匹配）..."
    });
    kwInput.value = uiState.onlineKeyword || "";

    const charInput = sBar.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "归属角色名（可选）"
    });
    charInput.style.maxWidth = "145px";

    // 搜索匹配模式选择
    const modeSelect = sBar.createEl("select", {
      cls: "curator-sort-select curator-illust-mode-select"
    });
    modeSelect.title = "选择 Pixiv 搜索匹配范围（默认自动将中文角色名扩展为日文原名进行模糊检索，不局限于中文内容）";
    [
      { val: "fuzzy", label: "跨语种模糊扩展 (推荐)" },
      { val: "broad", label: "标题+简介+标签宽泛模糊" },
      { val: "tag", label: "标签部分匹配 (s_tag)" }
    ].forEach((m) => {
      const opt = modeSelect.createEl("option", { value: m.val, text: m.label });
      if (uiState.searchMode === m.val) opt.selected = true;
    });
    modeSelect.onchange = async () => {
      uiState.searchMode = modeSelect.value;
      plugin.settings.illustSearchMode = modeSelect.value;
      await plugin.saveSettings();
      if (kwInput.value.trim() || uiState.onlineKeyword) {
        triggerOnlineSearch();
      }
    };

    // 年龄阶段内容分级选择（对齐 Pixiv 官方全年龄 / 全部 / R-18 切换能力）
    const ageSelect = sBar.createEl("select", {
      cls: "curator-sort-select curator-illust-age-select"
    });
    ageSelect.title = "对齐 Pixiv 年龄分级筛选：默认仅展示全年龄内容（自动过滤 R-18），也可按需切换严选模式或包含 R-18";
    const ageModeOptions = [
      { val: "safe", label: "全年龄 (排除 R-18)" },
      { val: "safe_strict", label: "全年龄·严选 (排除敏感)" },
      { val: "all", label: "全部年龄 (含 R-18)" },
      { val: "r18", label: "仅 R-18" }
    ];
    ageModeOptions.forEach((ag) => {
      const opt = ageSelect.createEl("option", { value: ag.val, text: ag.label });
      if (uiState.ageMode === ag.val) opt.selected = true;
    });

    // 排除 AI 生成作品开关按钮
    const excludeAiBtn = sBar.createEl("button", {
      cls: `curator-btn curator-illust-ai-toggle ${uiState.excludeAI ? "is-active" : ""}`,
      text: uiState.excludeAI ? "已排除 AI 作品" : "包含 AI 作品"
    });
    excludeAiBtn.title = "如同 Pixiv 搜索选项一样过滤掉 AI 生成插画（ai_type=1 & 标签过滤）";
    excludeAiBtn.onclick = async (e) => {
      e.preventDefault();
      uiState.excludeAI = !uiState.excludeAI;
      plugin.settings.illustExcludeAI = uiState.excludeAI;
      excludeAiBtn.classList.toggle("is-active", uiState.excludeAI);
      excludeAiBtn.textContent = uiState.excludeAI ? "已排除 AI 作品" : "包含 AI 作品";
      await plugin.saveSettings();
      if (kwInput.value.trim() || uiState.onlineKeyword) {
        triggerOnlineSearch();
      }
    };

    const doSearchBtn = sBar.createEl("button", {
      cls: "curator-btn is-primary",
      text: "在线检索插画"
    });

    ageSelect.onchange = async () => {
      uiState.ageMode = ageSelect.value;
      plugin.settings.illustAgeMode = ageSelect.value;
      await plugin.saveSettings();
      if (kwInput.value.trim() || uiState.onlineKeyword) {
        triggerOnlineSearch();
      } else {
        renderSourceTabsAndGrid();
      }
    };

    // 下载尺寸档位全局选择与大小说明栏
    const sizeConfigBar = drawer.createDiv("curator-illust-size-config-bar");
    sizeConfigBar.createSpan({
      cls: "curator-illust-size-config-label",
      text: "默认下载尺寸（均为无裁切完整画幅，可根据网速按需切换）："
    });
    const sizeSelect = sizeConfigBar.createEl("select", {
      cls: "curator-sort-select curator-illust-size-select"
    });
    [
      { val: "small", label: "轻量全图 (540P · 极速省流 · 约 40~160 KB)" },
      { val: "regular", label: "高清全图 (1200P · 速度与画质均衡 · 约 200~900 KB · 推荐)" },
      { val: "original", label: "原图无损 (Original · 原始完整分辨率 PNG/JPG · 约 1.2~12 MB)" }
    ].forEach((sz) => {
      const opt = sizeSelect.createEl("option", { value: sz.val, text: sz.label });
      if (uiState.downloadSizeTier === sz.val) opt.selected = true;
    });
    const expandedKwBadge = sizeConfigBar.createSpan({
      cls: "curator-illust-expanded-kw-badge curator-mono",
      text: ""
    });

    sizeSelect.onchange = async () => {
      uiState.downloadSizeTier = sizeSelect.value;
      plugin.settings.illustDownloadSizeMode = sizeSelect.value;
      await plugin.saveSettings();
      renderSourceTabsAndGrid();
    };

    // 双面板切换栏：默认展示 Pixiv 插画面板，可手动切换到 Bangumi 角色立绘面板
    const tabSwitchBar = drawer.createDiv("curator-illust-source-tabs");
    tabSwitchBar.style.display = "flex";
    tabSwitchBar.style.alignItems = "center";
    tabSwitchBar.style.gap = "8px";
    tabSwitchBar.style.marginTop = "8px";
    tabSwitchBar.style.marginBottom = "4px";

    const resultsBox = drawer.createDiv("curator-illust-online-results");

    const ageLabelMap = {
      safe: "全年龄",
      safe_strict: "全年龄·严选",
      all: "全部年龄",
      r18: "仅R-18"
    };

    const renderSourceTabsAndGrid = () => {
      tabSwitchBar.empty();
      const pixivList = Array.isArray(uiState.pixivResults) ? uiState.pixivResults : [];
      const bgmList = Array.isArray(uiState.bangumiResults) ? uiState.bangumiResults : [];

      if (Array.isArray(uiState.expandedKeywords) && uiState.expandedKeywords.length > 0) {
        expandedKwBadge.textContent = `跨语种检索词：${uiState.expandedKeywords.join(" / ")} · ${ageLabelMap[uiState.ageMode] || "全年龄"}${uiState.excludeAI ? " · 已排除AI" : ""}`;
      } else {
        expandedKwBadge.textContent = "";
      }

      const pixivTabBtn = tabSwitchBar.createEl("button", {
        cls: `curator-btn ${uiState.onlineTab === "pixiv" ? "is-primary" : ""}`,
        text: `Pixiv 插画面板 (${pixivList.length})`
      });
      pixivTabBtn.onclick = (e) => {
        e.preventDefault();
        uiState.onlineTab = "pixiv";
        renderSourceTabsAndGrid();
      };

      const bgmTabBtn = tabSwitchBar.createEl("button", {
        cls: `curator-btn ${uiState.onlineTab === "bangumi" ? "is-primary" : ""}`,
        text: `Bangumi 角色立绘面板 (${bgmList.length})`
      });
      bgmTabBtn.onclick = (e) => {
        e.preventDefault();
        uiState.onlineTab = "bangumi";
        renderSourceTabsAndGrid();
      };

      tabSwitchBar.createSpan({
        cls: "curator-mono",
        text:
          uiState.onlineTab === "pixiv"
            ? "当前展示：Pixiv 完整无裁切同人插画（支持年龄分级过滤、卡片单选尺寸与文件大小实时探测）"
            : "当前展示：Bangumi 角色设定立绘（手动切换）"
      }).style.opacity = "0.75";

      resultsBox.empty();
      if (uiState.onlineLoading) {
        resultsBox.createDiv({
          cls: "curator-rs-empty",
          text: "正在跨语种模糊检索 Pixiv 无裁切插画库与 Bangumi 角色立绘..."
        });
        return;
      }

      const activeList = uiState.onlineTab === "bangumi" ? bgmList : pixivList;
      if (!activeList || activeList.length === 0) {
        const otherCount = uiState.onlineTab === "pixiv" ? bgmList.length : pixivList.length;
        const emptyHint = !uiState.onlineKeyword
          ? "输入关键词点击「在线检索插画」，自动跨语种匹配中日文角色标签并展示完整无裁切画作。"
          : uiState.onlineTab === "pixiv" && uiState.pixivNetworkBlocked
            ? `当前网络直连 Pixiv / 同人图库接口超时，建议开启网络加速后重试${otherCount > 0 ? `，或先切换至上方「Bangumi 角色立绘面板 (${otherCount})」挑选收录` : "，也可直接点击右上角「导入图片」添加本地画作"}。`
            : uiState.onlineTab === "pixiv"
              ? `未在当前年龄分级（${ageLabelMap[uiState.ageMode] || "全年龄"}）下检出「${uiState.onlineKeyword}」相关插画（可切换年龄分级、尝试简短角色名${otherCount > 0 ? `，或切换查看 ${otherCount} 张 Bangumi 角色立绘` : ""}）。`
              : `未在 Bangumi 角色立绘面板检出「${uiState.onlineKeyword}」相关角色立绘。`;
        resultsBox.createDiv({
          cls: "curator-rs-empty",
          text: emptyHint
        });
        return;
      }

      const savedSourceLabels = new Set(
        (plugin.settings?.illustrationCollection || [])
          .filter((x) => x && x.sourceLabel)
          .map((x) => String(x.sourceLabel).trim())
      );

      const grid = resultsBox.createDiv("curator-illust-online-grid");
      let probeConcurrency = 0;
      const probeQueue = [];
      const runNextProbe = () => {
        while (probeConcurrency < 3 && probeQueue.length > 0) {
          const task = probeQueue.shift();
          if (!task) break;
          probeConcurrency += 1;
          task().finally(() => {
            probeConcurrency -= 1;
            runNextProbe();
          });
        }
      };

      activeList.forEach((item, itemIdx) => {
        if (!item._selectedTier) {
          item._selectedTier = uiState.downloadSizeTier || "regular";
        } else if (item._lastGlobalTier !== uiState.downloadSizeTier) {
          item._selectedTier = uiState.downloadSizeTier || "regular";
        }
        item._lastGlobalTier = uiState.downloadSizeTier;

        const card = grid.createDiv("curator-illust-online-card");
        const imgBox = card.createDiv("curator-illust-online-imgbox");
        const img = imgBox.createEl("img", {
          attr: { src: item.previewUrl || item.regularUrl || item.fullUrl, alt: item.title }
        });
        img.loading = "lazy";
        img.onerror = () => {
          if (item.regularUrl && img.src !== item.regularUrl) {
            img.src = item.regularUrl;
          }
        };

        if (item.isR18) {
          imgBox.createSpan({
            cls: "curator-illust-r18-badge curator-mono",
            text: "R-18"
          });
        }

        const dimBadge = imgBox.createSpan({
          cls: "curator-illust-dim-badge curator-mono",
          text: `原图 ${item.width || 1000}×${item.height || 1200}`
        });
        imgBox.title = "点击放大预览完整无裁切大图";
        imgBox.onclick = () => {
          const previewList = activeList.map((it) => ({
            id: it.id,
            title: it.title,
            characterName: charInput.value.trim() || uiState.onlineKeyword,
            imageUrl: it.regularUrl || it.fullUrl || it.previewUrl,
            sourceType: "character"
          }));
          openIllustrationLightboxModal(plugin, previewList[itemIdx], null, {
            list: previewList,
            index: itemIdx
          });
        };

        const info = card.createDiv("curator-illust-online-info");
        info.createDiv({ cls: "curator-illust-online-title", text: item.title, attr: { title: item.title } });
        info.createDiv({
          cls: "curator-illust-online-sub",
          text: `${item.sourceLabel} · ${item.author || ""}${item.matchedKeyword && item.matchedKeyword !== uiState.onlineKeyword ? ` · #${item.matchedKeyword}` : ""}`
        });

        // 完整下载大小与尺寸档位选择行
        const sizeRow = info.createDiv("curator-illust-card-size-row");
        const tierSelect = sizeRow.createEl("select", {
          cls: "curator-illust-card-tier-select curator-mono"
        });
        const tierLabels = {
          small: "轻量 540P",
          regular: "高清 1200P",
          original: "原图无损"
        };
        ["small", "regular", "original"].forEach((tKey) => {
          const d = computeTierDimensions(item.width, item.height, tKey);
          const opt = tierSelect.createEl("option", {
            value: tKey,
            text: `${tierLabels[tKey]} (${d.width}×${d.height})`
          });
          if (item._selectedTier === tKey) opt.selected = true;
        });

        const byteBadge = info.createDiv({
          cls: "curator-illust-byte-badge curator-mono",
          text: ""
        });

        const updateCardSizeDisplay = (triggerNetworkProbe = false) => {
          const curTier = item._selectedTier || "regular";
          const curDim = computeTierDimensions(item.width, item.height, curTier);
          const origBytes = item.tierBytes?.original || estimateTierBytes(item.width, item.height, "original");
          const origExact = Boolean(item.tierSizeExact?.original);
          const curBytes = item.tierBytes?.[curTier] || estimateTierBytes(item.width, item.height, curTier);
          const curExact = Boolean(item.tierSizeExact?.[curTier]);
          dimBadge.textContent = `原图 ${item.width}×${item.height}`;
          if (curTier === "original") {
            byteBadge.textContent = `完整原图大小：${formatByteSize(origBytes, origExact)} (${curDim.width}×${curDim.height})`;
          } else {
            byteBadge.textContent = `当前档位：${formatByteSize(curBytes, curExact)} · 完整原图：${formatByteSize(origBytes, origExact)}`;
          }

          if (triggerNetworkProbe && card.isConnected) {
            probeQueue.push(async () => {
              if (!card.isConnected) return;
              await probeArtworkExactByteSize(item, curTier);
              if (curTier !== "original") {
                await probeArtworkExactByteSize(item, "original");
              }
              if (card.isConnected) {
                updateCardSizeDisplay(false);
              }
            });
            runNextProbe();
          }
        };

        tierSelect.onchange = () => {
          item._selectedTier = tierSelect.value;
          updateCardSizeDisplay(true);
        };

        updateCardSizeDisplay(true);

        const alreadyInGallery = item.sourceLabel && savedSourceLabels.has(item.sourceLabel);
        const saveBtn = info.createEl("button", {
          cls: `curator-btn ${alreadyInGallery ? "" : "is-primary"} curator-illust-save-btn`,
          text: alreadyInGallery ? "已在画册中（点击可另存）" : "保存到本地画册"
        });
        saveBtn.onclick = async () => {
          const chosenTier = item._selectedTier || uiState.downloadSizeTier || "regular";
          const estBytes = item.tierBytes?.[chosenTier] || estimateTierBytes(item.width, item.height, chosenTier);
          saveBtn.disabled = true;
          saveBtn.textContent = `下载中 (${formatByteSize(estBytes, Boolean(item.tierSizeExact?.[chosenTier]))})...`;
          try {
            const savedRec = await saveIllustrationToVaultFolder(plugin, {
              title: item.title,
              characterName: charInput.value.trim() || uiState.onlineKeyword,
              tags: item.tags,
              itemObj: item,
              downloadSizeTier: chosenTier,
              fullUrl:
                chosenTier === "small"
                  ? item.smallUrl || item.regularUrl
                  : chosenTier === "original"
                    ? item.originalUrl || item.regularUrl
                    : item.regularUrl || item.fullUrl,
              previewUrl: item.smallUrl || item.previewUrl,
              sourceLabel: item.sourceLabel
            });
            savedSourceLabels.add(item.sourceLabel);
            saveBtn.disabled = false;
            saveBtn.removeClass("is-primary");
            saveBtn.textContent = `已入库 (${formatByteSize(savedRec.fileSizeBytes, true)})`;
            if (Notice) {
              new Notice(
                `已将《${item.title}》(${tierLabels[chosenTier]} · ${formatByteSize(savedRec.fileSizeBytes, true)}) 保存至「${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}」`
              );
            }
            renderMasonryStage();
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = "重试保存";
            if (Notice) new Notice(`保存失败：${err.message}`);
          }
        };
      });
    };

    let searchReqSeq = 0;
    const triggerOnlineSearch = async () => {
      const kw = (kwInput.value || uiState.onlineKeyword || "").trim();
      if (!kw) return;
      kwInput.value = kw;
      const reqId = ++searchReqSeq;
      uiState.onlineKeyword = kw;
      uiState.onlineTab = "pixiv"; // 每次搜索默认展示 Pixiv 面板
      uiState.onlineLoading = true;
      renderSourceTabsAndGrid();
      try {
        const { pixivResults, bangumiResults, expandedKeywords, pixivNetworkBlocked } =
          await searchOnlineIllustrations(kw, {
            excludeAI: uiState.excludeAI,
            ageMode: uiState.ageMode,
            searchMode: uiState.searchMode,
            plugin
          });
        if (reqId !== searchReqSeq) return; // 丢弃过期的并发旧请求响应，防止覆盖最新筛选结果
        uiState.pixivResults = pixivResults || [];
        uiState.bangumiResults = bangumiResults || [];
        uiState.expandedKeywords = expandedKeywords || [kw];
        uiState.pixivNetworkBlocked = Boolean(pixivNetworkBlocked);
      } finally {
        if (reqId === searchReqSeq) {
          uiState.onlineLoading = false;
          renderSourceTabsAndGrid();
        }
      }
    };
    doSearchBtn.onclick = () => {
      triggerOnlineSearch();
    };
    kwInput.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        triggerOnlineSearch();
      }
    };
    renderSourceTabsAndGrid();
  }

  if (!uiState.activeFolio) uiState.activeFolio = "all";
  if (!["salon", "book", "wall"].includes(uiState.viewMode)) {
    uiState.viewMode = ["salon", "book", "wall"].includes(plugin.settings?.illustViewMode)
      ? plugin.settings.illustViewMode
      : "salon";
  }

  const stageHost = container.createDiv("curator-illust-stage-host");

  const buildFoliosFromList = (items) => {
    const folios = [{ key: "all", label: "全部画作", count: items.length }];
    const animeMap = new Map();
    const charMap = new Map();
    let looseCount = 0;

    for (const it of items) {
      const ani = String(it.animeTitle || "").trim();
      const ch = String(it.characterName || "").trim();
      if (ani) animeMap.set(ani, (animeMap.get(ani) || 0) + 1);
      if (ch) charMap.set(ch, (charMap.get(ch) || 0) + 1);
      if (!ani && !ch) looseCount += 1;
    }

    Array.from(animeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([ani, cnt]) => {
        folios.push({ key: `anime::${ani}`, label: `《${ani}》`, count: cnt });
      });

    Array.from(charMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([ch, cnt]) => {
        folios.push({ key: `char::${ch}`, label: ch, count: cnt });
      });

    if (looseCount > 0 && folios.length > 1) {
      folios.push({ key: "loose", label: "未归档散页", count: looseCount });
    }
    return folios;
  };

  const renderMasonryStage = () => {
    if (typeof container._bmgsStageCleanup === "function") {
      try {
        container._bmgsStageCleanup();
      } catch (_) {}
      container._bmgsStageCleanup = null;
    }

    const allLatest = collectAllGalleryIllustrations(plugin);
    if (countBadgeEl && countBadgeEl.isConnected) {
      countBadgeEl.textContent = `共收录 ${allLatest.length} 幅画作`;
    }
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-gallery-badge"]')
        .forEach((el) => {
          el.textContent = String(allLatest.length);
        });
    }

    const q = String(uiState.searchQuery || "").trim().toLowerCase();
    const searchFiltered = q
      ? allLatest.filter((it) => {
          const hay = [it.title, it.characterName, it.animeTitle, ...(it.tags || [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : allLatest;

    const folios = buildFoliosFromList(searchFiltered);
    if (!folios.some((f) => f.key === uiState.activeFolio)) {
      uiState.activeFolio = "all";
    }

    const motionTier =
      plugin.settings?.v07Motion === false
        ? "off"
        : ["full", "lite", "off"].includes(plugin.settings?.v07MotionTier)
        ? plugin.settings.v07MotionTier
        : "full";

    const handle = renderGallerySanctuary(stageHost, {
      filteredItems: searchFiltered,
      folios,
      state: uiState,
      motionTier,
      resolveImgSrc: (ill) =>
        resolveLocalOrVaultImageUrl(plugin, ill.localPath || ill.imageUrl, ill._cacheBust || ""),
      onNaturalAspect: (ill, aspect) => {
        if (ill._aspectCacheKey && plugin.__diskIllustAspectCache) {
          plugin.__diskIllustAspectCache.set(ill._aspectCacheKey, aspect);
        }
      },
      onBrokenLocalFile: (ill) => {
        if (isDesktopNodeAvailable() && ill.localPath) {
          const absCheck = resolveLocalFileAbsolutePath(plugin, ill.localPath);
          if (absCheck && !fs.existsSync(absCheck)) {
            setTimeout(() => {
              if (stageHost.isConnected) renderMasonryStage();
            }, 60);
            return true;
          }
        }
        return false;
      },
      onOpenLightbox: (ill, curList, idx) => {
        openIllustrationLightboxModal(plugin, ill, renderMasonryStage, {
          list: curList,
          index: idx
        });
      },
      onContextMenu: (ev, ill, curList, idx) => {
        try {
          if (typeof Menu === "function") {
            ev.stopPropagation();
            const menu = new Menu();
            menu.addItem((mi) =>
              mi
                .setTitle("放大鉴赏与编辑信息")
                .onClick(() =>
                  openIllustrationLightboxModal(plugin, ill, renderMasonryStage, {
                    list: curList,
                    index: idx
                  })
                )
            );
            if (ill.localPath && isDesktopNodeAvailable()) {
              menu.addItem((mi) =>
                mi
                  .setTitle("在资源管理器中定位文件")
                  .onClick(() => revealLocalFileInExplorer(plugin, ill.localPath))
              );
            }
            menu.addItem((mi) =>
              mi.setTitle("查看关联收藏").onClick(() =>
                openMagicWandRelationModal(
                  plugin,
                  {
                    type: "illustration",
                    id: ill.id,
                    title: ill.characterName || ill.title,
                    animeTitle: ill.animeTitle
                  },
                  vaultAnimeItems,
                  options.wandCallbacks
                )
              )
            );
            menu.addSeparator();
            menu.addItem((mi) =>
              mi
                .setTitle(ill.localPath ? "删除该幅画作（本地图片移入回收站）" : "移除该幅画作")
                .onClick(async () => {
                  const res = await deleteGalleryIllustration(plugin, ill);
                  if (Notice) {
                    new Notice(
                      res.deletedFile
                        ? `已删除画作《${ill.title || "未命名"}》（本地图片已移入系统回收站）`
                        : `已移除画作记录《${ill.title || "未命名"}》`
                    );
                  }
                  renderMasonryStage();
                })
            );
            menu.showAtMouseEvent(ev);
          }
        } catch (_) {}
      },
      onBindPiece: (node, ill) => {
        bindMagicWandLongPress(node, () => {
          openMagicWandRelationModal(
            plugin,
            {
              type: "illustration",
              id: ill.id,
              title: ill.characterName || ill.title,
              animeTitle: ill.animeTitle
            },
            vaultAnimeItems,
            options.wandCallbacks
          );
        });
      },
      onDeleteItem: async (ill) => {
        const res = await deleteGalleryIllustration(plugin, ill);
        if (Notice) {
          new Notice(
            res.deletedFile
              ? `已删除画作《${ill.title || "未命名"}》（本地图片已移入系统回收站）`
              : `已移除画作记录《${ill.title || "未命名"}》`
          );
        }
        renderMasonryStage();
      },
      onImportClick: () => importLocalBtn.click(),
      onOnlineSearchClick: () => {
        if (!uiState.showOnlineDrawer) onlineSearchBtn.click();
      },
      onStateChange: async (patch) => {
        let dirty = false;
        if (patch.viewMode && plugin.settings.illustViewMode !== patch.viewMode) {
          plugin.settings.illustViewMode = patch.viewMode;
          dirty = true;
        }
        if (patch.captionMode && plugin.settings.illustCaptionMode !== patch.captionMode) {
          plugin.settings.illustCaptionMode = patch.captionMode;
          dirty = true;
        }
        if (patch.rowHeight && plugin.settings.illustRowHeight !== patch.rowHeight) {
          plugin.settings.illustRowHeight = patch.rowHeight;
          dirty = true;
        }
        if (dirty) {
          try {
            await plugin.saveSettings();
          } catch (_) {}
        }
      }
    });

    if (handle && typeof handle.destroy === "function") {
      container._bmgsStageCleanup = handle.destroy;
    }
  };

  // 注册全局活跃画册刷新钩子 + 本地画册目录实时监听（用户在资源管理器中手动增删改图片自动同步刷新）
  plugin._activeGalleryRefresh = () => {
    if (stageHost.isConnected) {
      renderMasonryStage();
    }
  };

  const bindLiveDirectoryWatcher = () => {
    if (!(plugin._illustWatcherMap instanceof Map)) {
      plugin._illustWatcherMap = new Map();
    }
    const existingCleanup = plugin._illustWatcherMap.get(container);
    if (typeof existingCleanup === "function") {
      try {
        existingCleanup();
      } catch (_) {}
      plugin._illustWatcherMap.delete(container);
    }
    for (const [hostEl, fn] of Array.from(plugin._illustWatcherMap.entries())) {
      if (!hostEl || !hostEl.isConnected) {
        try {
          if (typeof fn === "function") fn();
        } catch (_) {}
        plugin._illustWatcherMap.delete(hostEl);
      }
    }
    if (container._illustDirWatcher) {
      try {
        container._illustDirWatcher.close();
      } catch (_) {}
      container._illustDirWatcher = null;
    }
    if (!isDesktopNodeAvailable()) return;
    try {
      const { absDir } = ensureDirectoryAbsolute(
        plugin,
        plugin.settings?.illustrationGalleryFolder,
        "附件/画册典藏"
      );
      if (absDir && fs.existsSync(absDir) && typeof fs.watch === "function") {
        const watcher = fs.watch(absDir, { persistent: false }, (_eventType, filename) => {
          if (!container.isConnected) {
            try {
              watcher.close();
            } catch (_) {}
            container._illustDirWatcher = null;
            if (plugin._illustWatcherMap instanceof Map) {
              plugin._illustWatcherMap.delete(container);
            }
            return;
          }
          if (filename) {
            const fullChanged = path.join(absDir, String(filename));
            if (isSelfMediaPathBusy(plugin, fullChanged)) return;
          }
          if (container._illustWatchDebounce) clearTimeout(container._illustWatchDebounce);
          container._illustWatchDebounce = setTimeout(() => {
            container._illustWatchDebounce = null;
            if (stageHost.isConnected) {
              renderMasonryStage();
            }
          }, 280);
        });
        watcher.on("error", () => {});
        container._illustDirWatcher = watcher;
        const cleanupWatcher = () => {
          if (container._illustWatchDebounce) {
            clearTimeout(container._illustWatchDebounce);
            container._illustWatchDebounce = null;
          }
          if (container._illustDirWatcher) {
            try {
              container._illustDirWatcher.close();
            } catch (_) {}
            container._illustDirWatcher = null;
          }
        };
        plugin._illustWatcherMap.set(container, cleanupWatcher);
        plugin._activeIllustWatcherCleanup = cleanupWatcher;
      }
    } catch (_) {}
  };

  bindLiveDirectoryWatcher();
  renderMasonryStage();
}

/**
 * ==================== 3. 🎙️ 台词音声（Audio/Voice Line Archive & Smart Subtitle Slicer） ====================
 */
function parseTimecodeToSeconds(rawTc) {
  const s = String(rawTc || "").trim().replace(",", ".");
  const parts = s.split(":").map((x) => Number(x));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function formatSecondsToTimecode(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const rem = (s % 60).toFixed(2).padStart(5, "0");
  return `${String(mins).padStart(2, "0")}:${rem}`;
}

/**
 * 判断一条字幕是否为非角色对白（免责声明、屏幕字/招牌/注释、OP/ED歌词制作人员、纯符号音效等）
 */
function isNonDialogueSubtitleCue({ style = "", speaker = "", text = "" }) {
  const st = String(style || "").trim();
  const sp = String(speaker || "").trim();
  const tx = String(text || "").trim();
  if (!tx) return true;

  // 1. ASS 样式名与说话人标记过滤（屏幕字、注释、标题、制作名单、免责声明等）
  if (
    /^(OP|ED|特效|注释|staff|title|sign|signs|os|cart|caption|credit|logo|note|tip|warning|disclaimer|screen|top|bottom)/i.test(
      st
    ) ||
    /(sign|特效|注释|屏幕|字幕组|staff|credit|title|disclaimer|免责|歌词|lyric)/i.test(st)
  ) {
    return true;
  }
  if (
    /^(sign|signs|cartel|ntp|text|fx|title|staff|comment|注释|提示|屏幕字|字幕|免责|disclaimer|warning|board|label)/i.test(
      sp
    )
  ) {
    return true;
  }

  // 2. 常见多语种动画片头免责声明、版权警告、字幕组招募压制横幅过滤
  if (
    /OUT OF RESPECT FOR THE SOURCE MATERIAL/i.test(tx) ||
    /THIS IS FICTION WITH NO INTENTIONAL RESEMBLANCE/i.test(tx) ||
    /NO INTENTIONAL RESEMBLANCE TO ACTUAL PEOPLE/i.test(tx) ||
    /ALL CHARACTERS AND EVENTS IN THIS SHOW ARE ENTIRELY FICTIONAL/i.test(tx) ||
    /THIS PROGRAM IS A WORK OF FICTION/i.test(tx) ||
    /本故事纯属虚构|纯属虚构.*如有雷同|本节目纯属虚构|仅供学习交流|严禁用于商业用途|字幕组.*压制|翻译[:：].*校对[:：]|时间轴[:：].*后期[:：]/i.test(
      tx
    )
  ) {
    return true;
  }

  // 3. 整行被括号包裹的屏幕招牌/场景地名/注释说明（非角色念白）
  if (/^[（(【\[].*[）)】\]]$/.test(tx)) {
    const inner = tx.slice(1, -1).trim();
    if (
      inner.length <= 26 ||
      /(?:注[:：]|提示|屏幕|看板|招牌|菜单|贴纸|说明|字幕|BGM|SE|音效|旁白注|第.+[话回章]|年|月|日|店|馆|町|市|县|都|道|府|学园|高校|大楼|医院|车站)/.test(
        inner
      )
    ) {
      return true;
    }
  }

  // 4. 纯标点、音乐符号或无意义单字符
  if (/^[♪♫♬〜~…—\-·\s!！?？.。,，、:：;；"'“”‘’]+$/.test(tx)) {
    return true;
  }

  return false;
}

/**
 * 解析 .ass / .ssa / .srt / .vtt 字幕文件内容为标准时间轴台词数组（自动剔除非对白屏幕字与免责声明）
 */
function parseSubtitleContent(content, ext = ".srt") {
  const text = String(content || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const cues = [];

  if (/\.ass$|\.ssa$/i.test(ext) || text.includes("[Events]") || text.includes("Dialogue:")) {
    for (const line of lines) {
      if (!line.startsWith("Dialogue:")) continue;
      const body = line.slice("Dialogue:".length).trim();
      const parts = body.split(",");
      if (parts.length < 10) continue;
      const startSec = parseTimecodeToSeconds(parts[1]);
      const endSec = parseTimecodeToSeconds(parts[2]);
      const style = String(parts[3] || "").trim();
      const speaker = String(parts[4] || "").trim();
      const rawLine = parts.slice(9).join(",");
      // 若包含 ASS 绝对坐标定位/矢量绘图指令 (\pos, \move, \org, \p1)，高概率是屏幕招牌贴字
      if (/\\(?:pos|move|org)\s*\(/i.test(rawLine) && !speaker) {
        if (!/[。！？!?…—，,]/.test(rawLine.replace(/\{[^}]*\}/g, ""))) continue;
      }
      if (/\\p[1-9]/i.test(rawLine)) continue;

      const rawText = rawLine
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, " ")
        .trim();
      if (!rawText || endSec <= startSec) continue;
      if (isNonDialogueSubtitleCue({ style, speaker, text: rawText })) continue;
      cues.push({ startSec, endSec, speaker, text: rawText });
    }
    return cues;
  }

  // SRT / VTT 解析
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trim();
    const tcMatch = l.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})/
    );
    if (tcMatch) {
      const startSec = parseTimecodeToSeconds(tcMatch[1]);
      const endSec = parseTimecodeToSeconds(tcMatch[2]);
      const textLines = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i].replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim());
        i += 1;
      }
      const clean = textLines.filter(Boolean).join(" ");
      if (clean && endSec > startSec && !isNonDialogueSubtitleCue({ style: "", speaker: "", text: clean })) {
        cues.push({ startSec, endSec, speaker: "", text: clean });
      }
    }
    i += 1;
  }
  return cues;
}

/**
 * 计算字幕轨道的语言优先级（简体中文最高，其次通用中文、繁体中文、日文、英文）
 */
function scoreSubtitleTrackPreference(track) {
  const lang = String(track?.lang || "").toLowerCase();
  const title = String(track?.title || "").toLowerCase();
  const combined = `${lang} ${title}`;

  if (
    /中文\s*[（(]\s*中国\s*[)）]|简体|简中|简日|chs|sc\b|zh-cn|zh-hans|zh_cn|zh_hans|gb\b|simplified/i.test(
      combined
    )
  ) {
    return 100;
  }
  if (/繁体|繁中|繁日|香港|台湾|cht|tc\b|zh-tw|zh-hk|zh-hant|big5|traditional/i.test(combined)) {
    return 55;
  }
  if (/^(chi|zho|zh)$/i.test(lang) || /中文|中字|chinese|mandarin/i.test(combined)) {
    return 80;
  }
  if (/^(jpn|ja)$/i.test(lang) || /日文|日语|japanese/i.test(combined)) {
    return 35;
  }
  if (/^(eng|en)$/i.test(lang) || /english|英文|英语/i.test(combined)) {
    return 15;
  }
  return 5;
}

/**
 * 探测视频文件内嵌的所有字幕轨道元信息（轨道序号、语言代码、标题、编码格式）并推荐最佳中文字幕轨
 */
async function probeVideoSubtitleTracks(plugin, videoFilePath) {
  if (!videoFilePath || !fs.existsSync(videoFilePath)) {
    return { tracks: [], preferredSubIndex: 0 };
  }
  const ffmpegBin = resolveFfmpegExecutable(plugin);
  return await new Promise((resolve) => {
    let stderrStr = "";
    const proc = spawn(ffmpegBin, ["-nostdin", "-hide_banner", "-i", videoFilePath], {
      windowsHide: true
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch (e) {}
      resolve({ tracks: [], preferredSubIndex: 0 });
    }, 6000);

    proc.stderr.on("data", (chunk) => {
      stderrStr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      const missing = Boolean(err && (err.code === "ENOENT" || /ENOENT/i.test(String(err.message))));
      resolve({ tracks: [], preferredSubIndex: 0, missingFfmpeg: missing });
    });
    proc.on("close", () => {
      clearTimeout(timer);
      const lines = stderrStr.split(/\r?\n/);
      const tracks = [];
      let currentTrack = null;

      for (const rawLine of lines) {
        const streamMatch = rawLine.match(
          /^\s*Stream #0:(\d+)(?:\(([^)]*)\))?:\s*Subtitle:\s*([^\s,(]+)/i
        );
        if (streamMatch) {
          if (currentTrack) tracks.push(currentTrack);
          currentTrack = {
            subIndex: tracks.length,
            streamIndex: Number(streamMatch[1]),
            lang: String(streamMatch[2] || "und").trim(),
            codec: String(streamMatch[3] || "sub").trim(),
            title: ""
          };
          continue;
        }
        if (currentTrack) {
          // 遇到下一个 Stream 或 Output 时结束当前轨道属性读取
          if (/^\s*Stream #\d+:/i.test(rawLine) || /^Output #/i.test(rawLine) || /^At least one output/i.test(rawLine)) {
            tracks.push(currentTrack);
            currentTrack = null;
            continue;
          }
          const titleMatch = rawLine.match(/^\s*title\s*:\s*(.+)$/i);
          if (titleMatch && !currentTrack.title) {
            currentTrack.title = titleMatch[1].trim();
          }
        }
      }
      if (currentTrack) tracks.push(currentTrack);

      let bestIdx = 0;
      let bestScore = -1;
      tracks.forEach((tr) => {
        const sc = scoreSubtitleTrackPreference(tr);
        tr.preferenceScore = sc;
        const langDisplay = tr.title || tr.lang || `轨道 #${tr.subIndex + 1}`;
        tr.displayLabel = `#${tr.subIndex + 1} · ${langDisplay} [${tr.lang}/${tr.codec}]`;
        if (sc > bestScore) {
          bestScore = sc;
          bestIdx = tr.subIndex;
        }
      });

      resolve({ tracks, preferredSubIndex: bestIdx });
    });
  });
}

/**
 * 查找视频同目录下的外置字幕文件，若无外置字幕则调用 FFmpeg 提取指定（或自动优选简体中文）内嵌字幕轨
 */
async function loadSubtitlesForVideoFile(plugin, videoFilePath, requestedSubIndex = null) {
  if (!videoFilePath || !fs.existsSync(videoFilePath)) {
    return { cues: [], sourceLabel: "未找到视频文件", tracks: [], selectedSubIndex: 0 };
  }
  const dir = path.dirname(videoFilePath);
  const base = path.basename(videoFilePath, path.extname(videoFilePath));
  const files = fs.readdirSync(dir);

  // 1. 优先匹配同名前缀的外置 .ass / .srt / .vtt 字幕（当用户未手动切换内嵌轨道时）
  const subExts = [".ass", ".ssa", ".srt", ".vtt"];
  const matchedExternalSubs = files
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      if (!subExts.includes(ext)) return false;
      return f.toLowerCase().startsWith(base.toLowerCase().slice(0, Math.min(16, base.length)));
    })
    .sort((a, b) => {
      const scoreA = scoreSubtitleTrackPreference({ lang: "", title: a });
      const scoreB = scoreSubtitleTrackPreference({ lang: "", title: b });
      return scoreB - scoreA;
    });

  if (matchedExternalSubs.length > 0 && requestedSubIndex === null) {
    const chosenExtSub = matchedExternalSubs[0];
    const fullSubPath = path.join(dir, chosenExtSub);
    const raw = fs.readFileSync(fullSubPath, "utf8");
    const cues = parseSubtitleContent(raw, path.extname(chosenExtSub));
    return {
      cues,
      sourceLabel: `外置字幕：${chosenExtSub}`,
      tracks: matchedExternalSubs.map((name, idx) => ({
        subIndex: `ext:${idx}`,
        displayLabel: `外置 · ${name}`,
        externalFile: path.join(dir, name)
      })),
      selectedSubIndex: "ext:0"
    };
  }

  if (typeof requestedSubIndex === "string" && requestedSubIndex.startsWith("ext:")) {
    const extIdx = Number(requestedSubIndex.split(":")[1]) || 0;
    const chosenExtSub = matchedExternalSubs[extIdx];
    if (chosenExtSub) {
      const fullSubPath = path.join(dir, chosenExtSub);
      const raw = fs.readFileSync(fullSubPath, "utf8");
      const cues = parseSubtitleContent(raw, path.extname(chosenExtSub));
      return {
        cues,
        sourceLabel: `外置字幕：${chosenExtSub}`,
        tracks: matchedExternalSubs.map((name, idx) => ({
          subIndex: `ext:${idx}`,
          displayLabel: `外置 · ${name}`,
          externalFile: path.join(dir, name)
        })),
        selectedSubIndex: requestedSubIndex
      };
    }
  }

  // 2. 探测内嵌字幕轨道并默认优选简体中文轨
  const { tracks, preferredSubIndex, missingFfmpeg } = await probeVideoSubtitleTracks(
    plugin,
    videoFilePath
  );
  if (missingFfmpeg) {
    return {
      cues: [],
      sourceLabel:
        "未检测到 FFmpeg 工具（可在「插件设置 → 音声典藏」配置路径，或点击右侧手动导入外置 .ass/.srt 字幕）",
      tracks: [],
      selectedSubIndex: 0,
      missingFfmpeg: true
    };
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return {
      cues: [],
      sourceLabel: "该视频无外置或内嵌对白软字幕",
      tracks: [],
      selectedSubIndex: 0
    };
  }
  const targetSubIndex =
    requestedSubIndex !== null && requestedSubIndex !== undefined && Number.isFinite(Number(requestedSubIndex))
      ? Number(requestedSubIndex)
      : preferredSubIndex;

  const selectedTrackMeta = tracks.find((t) => t.subIndex === targetSubIndex) || null;
  const ffmpegBin = resolveFfmpegExecutable(plugin);

  // 优先以 ASS 格式提取以保留 Style 与 Speaker/Actor 栏位，用于精准剔除屏幕字与免责声明
  const extractWithFormat = (fmt) =>
    new Promise((resolve) => {
      let stdoutStr = "";
      const proc = spawn(
        ffmpegBin,
        ["-nostdin", "-i", videoFilePath, "-map", `0:s:${targetSubIndex}`, "-f", fmt, "-"],
        { windowsHide: true }
      );
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch (e) {}
        resolve("");
      }, 12000);

      proc.stdout.on("data", (chunk) => {
        stdoutStr += chunk.toString("utf8");
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
      proc.on("close", () => {
        clearTimeout(timer);
        resolve(stdoutStr);
      });
    });

  let rawSubContent = await extractWithFormat("ass");
  let cues = parseSubtitleContent(rawSubContent, ".ass");
  if (cues.length === 0) {
    rawSubContent = await extractWithFormat("srt");
    cues = parseSubtitleContent(rawSubContent, ".srt");
  }

  const trackDesc = selectedTrackMeta
    ? selectedTrackMeta.displayLabel
    : `轨道 #${targetSubIndex + 1}`;

  return {
    cues,
    sourceLabel:
      cues.length > 0 ? `内嵌字幕（${trackDesc}）` : "该视频无外置或内嵌对白软字幕",
    tracks,
    selectedSubIndex: targetSubIndex
  };
}

/**
 * 调用 FFmpeg 截取指定时间段的音频并保存为高音质 MP3（自动应用首尾防吞字缓冲 Padding）
 */
async function sliceAudioFromVideoWithFfmpeg(plugin, options) {
  const {
    videoFilePath,
    startSec,
    endSec,
    padBeforeSec = 0.25,
    padAfterSec = 0.35,
    quoteText = "",
    characterName = "",
    animeTitle = "",
    episode = ""
  } = options;

  const actualStart = Math.max(0, Number(startSec) - Math.max(0, Number(padBeforeSec) || 0));
  const actualEnd = Math.max(actualStart + 0.4, Number(endSec) + Math.max(0, Number(padAfterSec) || 0));
  const duration = Number((actualEnd - actualStart).toFixed(2));

  const defaultVoiceFolder = resolveDefaultVoiceArchiveFolder(plugin);
  const { absDir, vaultBase } = ensureDirectoryAbsolute(
    plugin,
    defaultVoiceFolder,
    defaultVoiceFolder
  );
  const safePrefix = String(characterName || animeTitle || "voice")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 24);
  const fileName = `${safePrefix}_ep${episode || "1"}_${Date.now().toString().slice(-6)}.mp3`;
  const absOut = path.join(absDir, fileName);
  const ffmpegBin = resolveFfmpegExecutable(plugin);

  await new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-ss",
      actualStart.toFixed(3),
      "-to",
      actualEnd.toFixed(3),
      "-i",
      videoFilePath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      absOut
    ];
    const proc = spawn(ffmpegBin, args, { windowsHide: true });
    let errLog = "";
    proc.stderr.on("data", (d) => {
      errLog += d.toString();
    });
    proc.on("error", (err) => {
      if (err && (err.code === "ENOENT" || /ENOENT/i.test(String(err.message)))) {
        reject(
          new Error(
            "未检测到可用的 FFmpeg 工具，请先安装 FFmpeg 或在「插件设置 → 音声典藏」中指定 ffmpeg 路径"
          )
        );
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(absOut)) {
        resolve(absOut);
      } else {
        reject(new Error(errLog.slice(-180) || `FFmpeg exited with code ${code}`));
      }
    });
  });

  let storedPath = absOut;
  if (vaultBase && absOut.toLowerCase().startsWith(vaultBase.toLowerCase())) {
    storedPath = path.relative(vaultBase, absOut).replace(/\\/g, "/");
  }

  const record = {
    id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    quoteText: String(quoteText || "").trim() || "经典台词",
    characterName: String(characterName || "").trim(),
    animeTitle: String(animeTitle || "").trim(),
    episode: String(episode || "").trim(),
    timestamp: formatSecondsToTimecode(startSec),
    startSec: actualStart,
    endSec: actualEnd,
    durationSec: duration,
    audioPath: storedPath,
    sourceVideoPath: videoFilePath,
    createdAt: new Date().toISOString()
  };

  if (!Array.isArray(plugin.settings.voiceCollection)) {
    plugin.settings.voiceCollection = [];
  }
  plugin.settings.voiceCollection.unshift(record);
  await plugin.saveSettings();
  return record;
}

/**
 * 检查台词音声卡片绑定的本地音频文件是否存在于磁盘，并返回可播放 URL
 */
function resolveVoiceAudioDiskState(plugin, rawAudioPath) {
  const relOrAbs = String(rawAudioPath || "").trim();
  if (!relOrAbs) {
    return { exists: false, absPath: "", playUrl: "", missingFile: false };
  }
  if (/^(?:https?:\/\/|data:audio\/|blob:)/i.test(relOrAbs)) {
    return { exists: true, absPath: relOrAbs, playUrl: relOrAbs, missingFile: false };
  }
  const cleanRel = !path.isAbsolute(relOrAbs)
    ? relOrAbs.replace(/\\/g, "/").replace(/^\/+/, "")
    : "";
  if (cleanRel && plugin?.app?.vault) {
    const tfile = plugin.app.vault.getAbstractFileByPath(cleanRel);
    if (tfile && typeof plugin.app.vault.getResourcePath === "function") {
      return {
        exists: true,
        absPath: cleanRel,
        playUrl: plugin.app.vault.getResourcePath(tfile),
        missingFile: false
      };
    }
  }
  if (!isDesktopNodeAvailable()) {
    return { exists: false, absPath: cleanRel || relOrAbs, playUrl: "", missingFile: true };
  }
  const vaultBase = getVaultBasePath(plugin);
  const absCandidate = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : vaultBase
    ? path.join(vaultBase, relOrAbs)
    : relOrAbs;
  if (absCandidate && fs.existsSync(absCandidate)) {
    return {
      exists: true,
      absPath: absCandidate,
      playUrl: resolveLocalOrVaultImageUrl(plugin, relOrAbs),
      missingFile: false
    };
  }
  return { exists: false, absPath: absCandidate, playUrl: "", missingFile: true };
}

/**
 * 判断候选目录是否位于当前配置的本地动画根目录之内（跨平台大小写安全）
 */
function isPathInsideAnimeRoot(rootDir, candidatePath) {
  const rawRoot = String(rootDir || "").trim();
  const rawCand = String(candidatePath || "").trim();
  if (!rawRoot || !rawCand) return false;
  const isWin = typeof process !== "undefined" && process.platform === "win32";
  const norm = (p) => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, "");
    return isWin ? resolved.toLowerCase() : resolved;
  };
  const r = norm(rawRoot);
  const c = norm(rawCand);
  if (!r || !c) return false;
  const sep = isWin ? "\\" : path.sep || "/";
  return c === r || c.startsWith(r + sep) || c.startsWith(r + "/");
}

/**
 * 抽取 ACG 名台词并保存至音声典藏：
 *  1) 桌面端且当前有效本地番剧目录（严格受 localAnimeRoot 约束）存在带软字幕剧集视频时，自动抽选台词并调用 FFmpeg 切出原声 MP3 落盘；
 *  2) 若尚未配置本地番剧目录、目录下暂无视频或处于移动端时，零等待即时拉取 Hitokoto 经典动漫名言卡片（离线自动回退内置经典名台词库）。
 */
async function drawPlayableAcgVoiceQuote(plugin, vaultAnimeItems = [], currentSelectedVideo = "") {
  const existingQuotes = new Set(
    (plugin.settings?.voiceCollection || []).map((v) => String(v.quoteText || "").trim())
  );
  const localRoot = String(plugin.settings?.localAnimeRoot || "").trim();
  let missingFfmpegDetected = false;

  // 阶段 1（仅桌面端）：从当前作用域内的本地已下载番剧视频 + 字幕轨中抽选经典台词并调用 FFmpeg 切出原声 MP3
  if (isDesktopNodeAvailable()) {
    try {
      const candidateVideos = [];
      const seenVideoPaths = new Set();
      const pushCandidateVideo = (videoPath, animeTitle, episode) => {
        if (!videoPath || seenVideoPaths.has(videoPath)) return;
        if (localRoot && !isPathInsideAnimeRoot(localRoot, videoPath)) return;
        seenVideoPaths.add(videoPath);
        const ext = path.extname(videoPath).toLowerCase();
        let hasExtSub = false;
        try {
          const dir = path.dirname(videoPath);
          const base = path.basename(videoPath, ext).toLowerCase();
          hasExtSub = fs
            .readdirSync(dir)
            .some((f) => /\.(ass|ssa|srt|vtt)$/i.test(f) && f.toLowerCase().includes(base.slice(0, 8)));
        } catch (_) {}
        const priorityScore = (hasExtSub ? 20 : 0) + (ext === ".mkv" ? 10 : 0) + Math.random();
        candidateVideos.push({
          videoPath,
          animeTitle,
          episode,
          priorityScore
        });
      };

      if (
        currentSelectedVideo &&
        fs.existsSync(currentSelectedVideo) &&
        (!localRoot || isPathInsideAnimeRoot(localRoot, currentSelectedVideo))
      ) {
        pushCandidateVideo(
          currentSelectedVideo,
          path.basename(path.dirname(currentSelectedVideo)),
          ""
        );
      }

      const folderPool = [];
      const seenFolders = new Set();
      for (const it of vaultAnimeItems || []) {
        if (!it || it.isSamplePreviewItem) continue;
        if (!it.downloadPath || it.downloadPath === "无" || !fs.existsSync(it.downloadPath)) continue;
        // 若用户显式设置了本地动画根目录，严格只允许抽取位于该根目录之下的番剧，杜绝旧测试目录或迁移前路径串台
        if (localRoot && !isPathInsideAnimeRoot(localRoot, it.downloadPath)) continue;
        const norm = path.resolve(it.downloadPath);
        const key = typeof process !== "undefined" && process.platform === "win32" ? norm.toLowerCase() : norm;
        if (!seenFolders.has(key)) {
          seenFolders.add(key);
          folderPool.push({ dirPath: norm, title: it.name || path.basename(norm) });
        }
      }

      if (localRoot && fs.existsSync(localRoot) && folderPool.length < 8) {
        const nativeFs = tryRequireNode("fs");
        const readdirAsync =
          nativeFs?.promises && typeof nativeFs.promises.readdir === "function"
            ? (d) => nativeFs.promises.readdir(d, { withFileTypes: true })
            : async (d) => fs.readdirSync(d, { withFileTypes: true });

        let visitedDirs = 0;
        const skipDirNames = new Set([
          ".git",
          ".obsidian",
          "node_modules",
          "$recycle.bin",
          "system volume information"
        ]);
        const scanSubDirsAsync = async (dir, depth) => {
          if (depth > 3 || visitedDirs >= 40 || folderPool.length >= 8) return;
          visitedDirs += 1;
          try {
            const subEntries = await readdirAsync(dir);
            let hasVidHere = false;
            const childDirs = [];
            for (const dirent of subEntries) {
              if (dirent.isFile() && /\.(mkv|mp4|webm|avi|mov)$/i.test(dirent.name)) {
                hasVidHere = true;
              } else if (dirent.isDirectory()) {
                const lower = String(dirent.name || "").toLowerCase();
                if (!lower.startsWith(".") && !skipDirNames.has(lower)) {
                  childDirs.push(path.join(dir, dirent.name));
                }
              }
            }
            if (hasVidHere) {
              const norm = path.resolve(dir);
              const key =
                typeof process !== "undefined" && process.platform === "win32" ? norm.toLowerCase() : norm;
              if (!seenFolders.has(key)) {
                seenFolders.add(key);
                folderPool.push({ dirPath: norm, title: path.basename(norm) });
              }
            }
            for (const sub of childDirs) {
              if (visitedDirs >= 40 || folderPool.length >= 8) break;
              await scanSubDirsAsync(sub, depth + 1);
            }
          } catch (_) {}
        };
        await scanSubDirsAsync(localRoot, 0);
      }

      const shuffledFolders = [...folderPool].sort(() => Math.random() - 0.5);
      for (const folderItem of shuffledFolders.slice(0, 10)) {
        const folderInfo = inspectLocalFolder(folderItem.dirPath);
        if (folderInfo && Array.isArray(folderInfo.videoFiles) && folderInfo.videoFiles.length > 0) {
          const preferredVids = [...folderInfo.videoFiles].sort((a, b) => {
            const aMkv = /\.mkv$/i.test(a.name) ? 1 : 0;
            const bMkv = /\.mkv$/i.test(b.name) ? 1 : 0;
            if (aMkv !== bMkv) return bMkv - aMkv;
            return Math.random() - 0.5;
          });
          for (const vf of preferredVids.slice(0, 2)) {
            pushCandidateVideo(
              path.join(folderItem.dirPath, vf.name),
              folderItem.title,
              vf.episode !== null ? String(vf.episode) : "1"
            );
          }
        }
      }

      candidateVideos.sort((a, b) => b.priorityScore - a.priorityScore);

      for (const cand of candidateVideos.slice(0, 6)) {
        const subRes = await loadSubtitlesForVideoFile(plugin, cand.videoPath);
        if (subRes?.missingFfmpeg) {
          missingFfmpegDetected = true;
        }
        const validCues = (subRes.cues || []).filter((c) => {
          const tx = String(c.text || "").trim();
          const dur = Number(c.endSec) - Number(c.startSec);
          if (tx.length < 6 || tx.length > 48) return false;
          if (dur < 1.0 || dur > 14.0) return false;
          if (existingQuotes.has(tx)) return false;
          return true;
        });
        if (validCues.length > 0) {
          const expressiveCues = validCues.filter(
            (c) => c.speaker || /[！!？?…—。]/.test(c.text)
          );
          const pool = expressiveCues.length > 0 ? expressiveCues : validCues;
          const chosenCue = pool[Math.floor(Math.random() * pool.length)];
          const record = await sliceAudioFromVideoWithFfmpeg(plugin, {
            videoFilePath: cand.videoPath,
            startSec: chosenCue.startSec,
            endSec: chosenCue.endSec,
            padBeforeSec: plugin.settings.voiceArchivePadBeforeSec ?? 0.25,
            padAfterSec: plugin.settings.voiceArchivePadAfterSec ?? 0.35,
            quoteText: chosenCue.text,
            characterName: chosenCue.speaker || "",
            animeTitle: cand.animeTitle,
            episode: cand.episode
          });
          return {
            record,
            hasAudio: true,
            sourceType: "local-sliced-audio",
            message: `已从本地番剧《${cand.animeTitle}》抽取原声台词并保存至「${record.audioPath}」：“${record.quoteText}”`
          };
        }
      }
    } catch (sliceErr) {
      if (/FFmpeg|ENOENT/i.test(String(sliceErr?.message || ""))) {
        missingFfmpegDetected = true;
      }
    }
  }

  // 阶段 2：无可用本地带字幕剧集视频（或移动端）时，即时抽取 Hitokoto 经典动漫名言卡片
  const cardTipText = missingFfmpegDetected
    ? "经典动漫名言 · 安装并配置 FFmpeg 后可从本地剧集切出原片语音"
    : isDesktopNodeAvailable()
      ? "经典动漫名言 · 绑定本地番剧目录后可通过「截取剧集音声」切出原片语音"
      : "经典动漫名言 · 可点击下方绑定音频文件";
  const noticeSuffix = missingFfmpegDetected
    ? "（检测到本机尚未安装 FFmpeg，配置后可从本地剧集切出原片语音）"
    : isDesktopNodeAvailable()
      ? "（绑定含剧集视频的本地番剧目录后可自动抽取原片语音）"
      : "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await Promise.race([
        requestUrl({
          url: "https://v1.hitokoto.cn/?c=a",
          method: "GET",
          headers: { Accept: "application/json" }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500))
      ]);
      const data = res?.json || (res?.text ? JSON.parse(res.text) : null);
      const quote = String(data?.hitokoto || "").trim();
      if (quote && (attempt === 1 || !existingQuotes.has(quote))) {
        const record = {
          id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          quoteText: quote,
          characterName: String(data.from_who || "").trim(),
          animeTitle: String(data.from || "").trim(),
          episode: "",
          timestamp: "",
          durationSec: 0,
          audioPath: "",
          audioFallbackReason: cardTipText,
          createdAt: new Date().toISOString()
        };
        if (!Array.isArray(plugin.settings.voiceCollection)) {
          plugin.settings.voiceCollection = [];
        }
        plugin.settings.voiceCollection.unshift(record);
        await plugin.saveSettings();
        const fromLabel = record.animeTitle ? ` ——《${record.animeTitle}》` : "";
        return {
          record,
          hasAudio: false,
          sourceType: "hitokoto-anime-quote",
          message: `已收录经典动漫名言：“${quote}”${fromLabel}${noticeSuffix}`
        };
      }
    } catch (_) {
      break;
    }
  }

  // 离线内置经典动漫名台词库
  const offlineClassicPool = [
    {
      quoteText: "正因为害怕，所以才更要迈出那一步。",
      characterName: "洛琪希·米格路迪亚",
      animeTitle: "无职转生 ～到了异世界就拿出真本事～"
    },
    {
      quoteText: "重要的不是活了多久，而是如何与旅途中的人共度时光。",
      characterName: "芙莉莲",
      animeTitle: "葬送的芙莉莲"
    },
    {
      quoteText: "努力不一定能立刻看到结果，但走过的每一步都不会白费。",
      characterName: "洛琪希·米格路迪亚",
      animeTitle: "无职转生 ～到了异世界就拿出真本事～"
    },
    {
      quoteText: "如果是勇者辛美尔的话，他一定也会这么做的。",
      characterName: "芙莉莲",
      animeTitle: "葬送的芙莉莲"
    },
    {
      quoteText: "奇迹不是免费的，祈求希望少不了等价的绝望，但正因如此希望才耀眼。",
      characterName: "鹿目圆",
      animeTitle: "魔法少女小圆"
    },
    {
      quoteText: "我并不清楚所有事情，我只知道我知道的事。",
      characterName: "羽川翼",
      animeTitle: "化物语"
    },
    {
      quoteText: "能哭的地方，只有厕所和爸爸的怀里。",
      characterName: "冈崎汐",
      animeTitle: "CLANNAD ～AFTER STORY～"
    },
    {
      quoteText: "无论在哪条世界线，你都不是孤身一人。",
      characterName: "牧濑红莉栖",
      animeTitle: "命运石之门"
    },
    {
      quoteText: "我想知道「我爱你」是什么意思。",
      characterName: "薇尔莉特·伊芙加登",
      animeTitle: "紫罗兰永恒花园"
    },
    {
      quoteText: "乐队就是把彼此笨拙的声音叠在一起，变成一个人绝对弹不出的奇迹。",
      characterName: "后藤一里",
      animeTitle: "孤独摇滚！"
    }
  ];
  const uncollected = offlineClassicPool.filter((q) => !existingQuotes.has(q.quoteText));
  const pool = uncollected.length > 0 ? uncollected : offlineClassicPool;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const record = {
    id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    quoteText: pick.quoteText,
    characterName: pick.characterName,
    animeTitle: pick.animeTitle,
    episode: "",
    timestamp: "",
    durationSec: 0,
    audioPath: "",
    audioFallbackReason: cardTipText,
    createdAt: new Date().toISOString()
  };
  if (!Array.isArray(plugin.settings.voiceCollection)) {
    plugin.settings.voiceCollection = [];
  }
  plugin.settings.voiceCollection.unshift(record);
  await plugin.saveSettings();
  return {
    record,
    hasAudio: false,
    sourceType: "offline-classic-quote",
    message: `已收录经典动漫名言：“${record.quoteText}” ——《${record.animeTitle}》${noticeSuffix}`
  };
}

function renderVoiceLineArchiveWorkspace(plugin, container, vaultAnimeItems = [], options = {}) {
  container.empty();
  container.addClass("curator-voice-workspace");

  if (!plugin.__voiceWorkspaceState) {
    plugin.__voiceWorkspaceState = {
      searchQuery: "",
      showSlicerDrawer: false,
      selectedAnimePath: "",
      selectedVideoFile: "",
      selectedEpisodeNum: "",
      selectedSubTrackIndex: null,
      subtitleTracks: [],
      cues: [],
      cueSourceLabel: "",
      cueKeyword: "",
      loadingSubtitles: false
    };
  }
  const uiState = plugin.__voiceWorkspaceState;
  if (options.searchQuery !== undefined) {
    uiState.searchQuery = options.searchQuery;
  }

  const voices = Array.isArray(plugin.settings?.voiceCollection) ? plugin.settings.voiceCollection : [];

  // 顶栏
  const header = container.createDiv("curator-char-header");
  const titleSide = header.createDiv("curator-char-header-left");
  const hRow = titleSide.createDiv("curator-char-title-row");
  hRow.createEl("h2", { cls: "curator-char-title", text: "音声典藏" });
  const voiceCountBadgeEl = hRow.createSpan({
    cls: "curator-char-count-badge curator-mono",
    text: `共收录 ${voices.length} 条音声`
  });

  const actionSide = header.createDiv("curator-char-header-right");
  const searchInput = actionSide.createEl("input", {
    type: "text",
    cls: "curator-input curator-char-search-input",
    placeholder: "检索台词 / 角色 / 动画作品..."
  });
  searchInput.value = uiState.searchQuery || "";
  searchInput.oninput = () => {
    uiState.searchQuery = searchInput.value;
    renderVoiceCards();
  };

  if (isDesktopNodeAvailable()) {
    const openDirBtn = actionSide.createEl("button", {
      cls: "curator-btn"
    });
    v07Core.setBtnIconLabel(openDirBtn, "folder", "本地目录", 14);
    openDirBtn.title = "在资源管理器中打开音声典藏本地文件夹";
    openDirBtn.onclick = async () => {
      const folder = resolveDefaultVoiceArchiveFolder(plugin);
      const { absDir } = ensureDirectoryAbsolute(
        plugin,
        folder,
        folder
      );
      await openLocalPathSafely(absDir);
    };
  }

  const onlineQuoteBtn = actionSide.createEl("button", {
    cls: "curator-btn"
  });
  v07Core.setBtnIconLabel(onlineQuoteBtn, "volume", "抽取名台词", 14);
  onlineQuoteBtn.title =
    "本地动画目录含软字幕视频时自动抽取原片语音，未绑定本地视频时即时抽取经典动漫名言卡片";
  onlineQuoteBtn.onclick = async () => {
    onlineQuoteBtn.disabled = true;
    onlineQuoteBtn.textContent = "抽取中...";
    try {
      const drawRes = await drawPlayableAcgVoiceQuote(
        plugin,
        vaultAnimeItems,
        uiState.selectedVideoFile
      );
      if (Notice && drawRes?.message) {
        new Notice(drawRes.message, 4800);
      }
      renderVoiceCards();
    } catch (e) {
      if (Notice) new Notice(`抽取名台词失败：${e.message || "请稍后重试"}`);
    } finally {
      onlineQuoteBtn.disabled = false;
      v07Core.setBtnIconLabel(onlineQuoteBtn, "volume", "抽取名台词", 14);
    }
  };

  if (isDesktopNodeAvailable()) {
    const slicerBtn = actionSide.createEl("button", {
      cls: `curator-btn ${uiState.showSlicerDrawer ? "is-active" : "is-primary"}`
    });
    v07Core.setBtnIconLabel(
      slicerBtn,
      "film",
      uiState.showSlicerDrawer ? "收起截取台" : "截取剧集音声",
      14
    );
    slicerBtn.onclick = () => {
      uiState.showSlicerDrawer = !uiState.showSlicerDrawer;
      renderVoiceLineArchiveWorkspace(plugin, container, vaultAnimeItems, options);
    };
  }

  // 智能视频+字幕音声截取工坊（仅桌面端）
  if (isDesktopNodeAvailable() && uiState.showSlicerDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer curator-voice-slicer-drawer");
    drawer.createDiv({
      cls: "curator-char-add-title",
      text: "本地剧集字幕原声截取（内置首尾防吞字缓冲 · 自动优选简体中文字幕）"
    });
    drawer.createDiv({
      cls: "curator-char-add-sub",
      text: "选择本地剧集视频后自动解析外置 (.ass/.srt) 或 MKV 多语种内嵌软字幕，检索台词即可一键切出原声 MP3 保存在本地"
    });

    // 音声本地保存路径快捷配置与自动迁移栏
    const pathConfigRow = drawer.createDiv("curator-illust-path-config-row");
    pathConfigRow.createSpan({ text: "音声典藏保存路径：" });
    const voiceFolderInput = pathConfigRow.createEl("input", {
      type: "text",
      cls: "curator-input curator-mono",
      placeholder: "默认：附件/音声典藏（支持相对 Vault 路径或绝对路径）"
    });
    voiceFolderInput.style.flex = "1";
    const curDefaultVoiceFolder = resolveDefaultVoiceArchiveFolder(plugin);
    voiceFolderInput.value = curDefaultVoiceFolder;
    const commitVoiceFolderMigration = async () => {
      const oldFolder = resolveDefaultVoiceArchiveFolder(plugin);
      const newFolder = String(voiceFolderInput.value || "").trim() || oldFolder;
      voiceFolderInput.value = newFolder;
      if (newFolder === oldFolder) return;
      plugin.settings.voiceArchiveFolder = newFolder;
      await plugin.saveSettings();
      if (typeof plugin.migrateVaultFolderPath === "function") {
        await plugin.migrateVaultFolderPath({
          categoryKey: "voiceArchiveFolder",
          categoryLabel: "音声典藏目录",
          oldPath: oldFolder,
          newPath: newFolder
        });
        renderVoiceCards();
      } else if (Notice) {
        new Notice(`音声典藏路径已更新为：${newFolder}`);
      }
    };
    voiceFolderInput.addEventListener("blur", commitVoiceFolderMigration);
    voiceFolderInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        voiceFolderInput.blur();
      }
    });

    // 步骤 1：选择番剧与剧集视频（或直接浏览本地视频） + 设置首尾缓冲秒数
    const step1Row = drawer.createDiv("curator-voice-slicer-row");
    const activeLocalRoot = String(plugin.settings?.localAnimeRoot || "").trim();
    const animeWithLocal = (vaultAnimeItems || [])
      .filter((it) => {
        if (!it || it.isSamplePreviewItem || !it.downloadPath || it.downloadPath === "无") return false;
        if (activeLocalRoot && !isPathInsideAnimeRoot(activeLocalRoot, it.downloadPath)) return false;
        return fs.existsSync(it.downloadPath);
      })
      .map((ani) => {
        let hasSoftSubHint = false;
        try {
          const entries = fs.readdirSync(ani.downloadPath);
          hasSoftSubHint = entries.some((f) => /\.(mkv|ass|ssa|srt|vtt)$/i.test(f));
        } catch (e) {}
        return Object.assign({}, ani, { _hasSoftSubHint: hasSoftSubHint });
      })
      .sort((a, b) => (b._hasSoftSubHint ? 1 : 0) - (a._hasSoftSubHint ? 1 : 0));

    const animeSelect = step1Row.createEl("select", { cls: "curator-sort-select" });
    animeSelect.createEl("option", { value: "", text: "── 从馆藏本地番剧中选择 ──" });
    animeWithLocal.forEach((ani) => {
      const opt = animeSelect.createEl("option", {
        value: ani.downloadPath,
        text: ani._hasSoftSubHint ? `《${ani.name}》 · 含软字幕/MKV` : `《${ani.name}》`
      });
      if (uiState.selectedAnimePath === ani.downloadPath) opt.selected = true;
    });

    const epSelect = step1Row.createEl("select", { cls: "curator-sort-select" });
    epSelect.createEl("option", { value: "", text: "── 选择剧集视频文件 ──" });

    const browseVideoBtn = step1Row.createEl("button", {
      cls: "curator-btn",
      text: "浏览任意视频..."
    });

    // 首尾缓冲控制
    const padGroup = step1Row.createDiv("curator-voice-pad-group");
    padGroup.createSpan({ text: "前缓冲(s):" });
    const padBeforeInput = padGroup.createEl("input", {
      type: "number",
      cls: "curator-input curator-mono"
    });
    padBeforeInput.style.width = "64px";
    padBeforeInput.step = "0.05";
    padBeforeInput.value = String(plugin.settings.voiceArchivePadBeforeSec ?? 0.25);
    padBeforeInput.onchange = async () => {
      plugin.settings.voiceArchivePadBeforeSec = Math.max(0, Number(padBeforeInput.value) || 0);
      await plugin.saveSettings();
    };

    padGroup.createSpan({ text: "后缓冲(s):" });
    const padAfterInput = padGroup.createEl("input", {
      type: "number",
      cls: "curator-input curator-mono"
    });
    padAfterInput.style.width = "64px";
    padAfterInput.step = "0.05";
    padAfterInput.value = String(plugin.settings.voiceArchivePadAfterSec ?? 0.35);
    padAfterInput.onchange = async () => {
      plugin.settings.voiceArchivePadAfterSec = Math.max(0, Number(padAfterInput.value) || 0);
      await plugin.saveSettings();
    };

    const populateEpisodes = (folderPath) => {
      epSelect.empty();
      epSelect.createEl("option", { value: "", text: "── 选择剧集视频文件 ──" });
      if (!folderPath) return;
      const res = inspectLocalFolder(folderPath);
      if (res && Array.isArray(res.videoFiles)) {
        res.videoFiles.forEach((vf) => {
          const full = path.join(folderPath, vf.name);
          const o = epSelect.createEl("option", {
            value: full,
            text: vf.episode !== null ? `第 ${vf.episode} 话 · ${vf.name}` : vf.name
          });
          o.dataset.epNum = vf.episode !== null ? String(vf.episode) : "";
          if (uiState.selectedVideoFile === full) o.selected = true;
        });
      }
    };
    if (uiState.selectedAnimePath) {
      populateEpisodes(uiState.selectedAnimePath);
    }

    const cueHost = drawer.createDiv("curator-voice-cues-host");

    const loadCuesForSelectedVideo = async (videoFile, epNum = "", requestedSubIndex = null) => {
      uiState.selectedVideoFile = videoFile;
      uiState.selectedEpisodeNum = epNum;
      uiState.loadingSubtitles = true;
      renderCuesList();
      const subRes = await loadSubtitlesForVideoFile(plugin, videoFile, requestedSubIndex);
      uiState.cues = subRes.cues || [];
      uiState.cueSourceLabel = subRes.sourceLabel || "";
      uiState.subtitleTracks = Array.isArray(subRes.tracks) ? subRes.tracks : [];
      uiState.selectedSubTrackIndex = subRes.selectedSubIndex;
      uiState.loadingSubtitles = false;
      renderCuesList();
    };

    animeSelect.onchange = () => {
      uiState.selectedAnimePath = animeSelect.value;
      populateEpisodes(animeSelect.value);
    };

    epSelect.onchange = () => {
      const selOpt = epSelect.selectedOptions[0];
      const epNum = selOpt ? selOpt.dataset.epNum || "" : "";
      if (epSelect.value) {
        loadCuesForSelectedVideo(epSelect.value, epNum, null);
      }
    };

    browseVideoBtn.onclick = () => {
      const fInput = document.createElement("input");
      fInput.type = "file";
      fInput.accept = "video/*,.mkv,.mp4,.webm,.avi";
      fInput.onchange = () => {
        const f = fInput.files && fInput.files[0];
        const fPath = getNativeFilePath(f);
        if (fPath) {
          loadCuesForSelectedVideo(fPath, "", null);
        }
      };
      fInput.click();
    };

    const renderCuesList = () => {
      cueHost.empty();
      if (!uiState.selectedVideoFile) {
        cueHost.createDiv({
          cls: "curator-rs-empty",
          text: "请先在上方选择一部本地番剧与剧集（或浏览任意本地视频文件），系统将自动加载字幕台词轴。"
        });
        return;
      }
      if (uiState.loadingSubtitles) {
        cueHost.createDiv({
          cls: "curator-rs-empty",
          text: "正在解析剧集多语种字幕轨道并过滤非对白屏幕字，请稍候..."
        });
        return;
      }

      const filterRow = cueHost.createDiv("curator-voice-cue-filter-row");
      filterRow.createSpan({
        cls: "curator-mono",
        text: `${uiState.cueSourceLabel}（有效对白 ${uiState.cues.length} 句）`
      });

      // 问题 7：当检测到内嵌或外置多条字幕轨道时，提供字幕语言/轨道切换下拉框
      if (Array.isArray(uiState.subtitleTracks) && uiState.subtitleTracks.length > 0) {
        const trackSelectWrap = filterRow.createDiv("curator-voice-pad-group");
        trackSelectWrap.createSpan({ text: "字幕轨道:" });
        const subtitleTrackSelect = trackSelectWrap.createEl("select", {
          cls: "curator-sort-select"
        });
        subtitleTrackSelect.title = "切换 MKV 内嵌或外置不同语言的字幕轨道（默认优先简体中文）";
        uiState.subtitleTracks.forEach((tr) => {
          const opt = subtitleTrackSelect.createEl("option", {
            value: String(tr.subIndex),
            text: tr.displayLabel || `字幕轨 #${Number(tr.subIndex) + 1}`
          });
          if (String(tr.subIndex) === String(uiState.selectedSubTrackIndex)) {
            opt.selected = true;
          }
        });
        subtitleTrackSelect.onchange = () => {
          const val = subtitleTrackSelect.value;
          const nextIdx = val.startsWith("ext:") ? val : Number(val);
          loadCuesForSelectedVideo(uiState.selectedVideoFile, uiState.selectedEpisodeNum, nextIdx);
        };
      }

      const charTagInput = filterRow.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "标注说话角色名（如：洛琪希）"
      });
      charTagInput.style.width = "170px";

      const cueKwInput = filterRow.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "搜索字幕台词关键词..."
      });
      cueKwInput.style.width = "220px";
      cueKwInput.value = uiState.cueKeyword || "";

      // 手动加载外部字幕按钮
      const loadExtSubBtn = filterRow.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "手动指定字幕文件 (.ass/.srt)"
      });
      loadExtSubBtn.onclick = () => {
        const sInput = document.createElement("input");
        sInput.type = "file";
        sInput.accept = ".ass,.ssa,.srt,.vtt";
        sInput.onchange = async () => {
          const sf = sInput.files && sInput.files[0];
          if (!sf) return;
          const sfPath = getNativeFilePath(sf);
          const raw =
            sfPath && fs.existsSync(sfPath)
              ? fs.readFileSync(sfPath, "utf8")
              : typeof sf.text === "function"
                ? await sf.text()
                : "";
          if (raw) {
            uiState.cues = parseSubtitleContent(raw, path.extname(sf.name || sfPath || ".srt"));
            uiState.cueSourceLabel = `手动字幕：${sf.name}`;
            renderCuesList();
          }
        };
        sInput.click();
      };

      const cueListBox = cueHost.createDiv("curator-voice-cue-listbox");
      const refreshMatchedCues = () => {
        cueListBox.empty();
        const kw = String(uiState.cueKeyword || "").trim().toLowerCase();
        const matched = uiState.cues
          .filter((c) => !kw || c.text.toLowerCase().includes(kw) || (c.speaker && c.speaker.toLowerCase().includes(kw)))
          .slice(0, 80);

        if (matched.length === 0) {
          cueListBox.createDiv({
            cls: "curator-rs-empty",
            text: uiState.cues.length === 0
              ? "未检出有效对白字幕轨 · 可在上方切换「字幕轨道」或点击「手动指定字幕文件 (.ass/.srt)」导入字幕"
              : "未找到包含该关键词的字幕行"
          });
          return;
        }

        matched.forEach((cue) => {
          const row = cueListBox.createDiv("curator-voice-cue-row");
          row.createSpan({
            cls: "curator-voice-cue-time curator-mono",
            text: `${formatSecondsToTimecode(cue.startSec)} → ${formatSecondsToTimecode(cue.endSec)}`
          });
          if (cue.speaker) {
            row.createSpan({ cls: "curator-voice-cue-speaker", text: cue.speaker });
          }
          row.createSpan({ cls: "curator-voice-cue-text", text: cue.text });

          const sliceActionBtn = row.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: "截取音声"
          });
          sliceActionBtn.onclick = async () => {
            sliceActionBtn.disabled = true;
            sliceActionBtn.textContent = "截取中...";
            try {
              const matchedAnime = animeWithLocal.find((a) => a.downloadPath === uiState.selectedAnimePath);
              await sliceAudioFromVideoWithFfmpeg(plugin, {
                videoFilePath: uiState.selectedVideoFile,
                startSec: cue.startSec,
                endSec: cue.endSec,
                padBeforeSec: plugin.settings.voiceArchivePadBeforeSec ?? 0.25,
                padAfterSec: plugin.settings.voiceArchivePadAfterSec ?? 0.35,
                quoteText: cue.text,
                characterName: charTagInput.value.trim() || cue.speaker || "",
                animeTitle: matchedAnime ? matchedAnime.name : path.basename(path.dirname(uiState.selectedVideoFile)),
                episode: uiState.selectedEpisodeNum || ""
              });
              sliceActionBtn.textContent = "已入库";
              if (Notice) new Notice(`已截取音声：“${cue.text}”`);
              renderVoiceCards();
            } catch (err) {
              sliceActionBtn.disabled = false;
              sliceActionBtn.textContent = "重试截取";
              if (Notice) new Notice(`截取失败：${err.message}`);
            }
          };
        });
      };

      cueKwInput.oninput = () => {
        uiState.cueKeyword = cueKwInput.value;
        refreshMatchedCues();
      };
      refreshMatchedCues();
    };

    renderCuesList();
  }

  if (!uiState.activeFilter) uiState.activeFilter = "all";
  const voiceFilterStrip = container.createDiv("bm8-voice-filter-strip");
  const cardsHost = container.createDiv("curator-voice-cards-host");

  const fmtAudioClock = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  const syncVoiceFilterStrip = (allVoices) => {
    voiceFilterStrip.empty();
    const pills = [{ key: "all", label: "全部音声", count: allVoices.length }];
    const charCounts = new Map();
    const animeCounts = new Map();
    for (const vc of allVoices) {
      const ch = String(vc.characterName || "").trim();
      const ani = String(vc.animeTitle || "").trim();
      if (ch) charCounts.set(ch, (charCounts.get(ch) || 0) + 1);
      if (ani) animeCounts.set(ani, (animeCounts.get(ani) || 0) + 1);
    }
    Array.from(charCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([ch, cnt]) => pills.push({ key: `char::${ch}`, label: ch, count: cnt }));
    Array.from(animeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .forEach(([ani, cnt]) => pills.push({ key: `anime::${ani}`, label: `《${ani}》`, count: cnt }));

    if (pills.length <= 1) {
      voiceFilterStrip.style.display = "none";
      uiState.activeFilter = "all";
      return;
    }
    voiceFilterStrip.style.display = "flex";
    if (!pills.some((p) => p.key === uiState.activeFilter)) {
      uiState.activeFilter = "all";
    }
    voiceFilterStrip.createSpan({
      cls: "bm8-liner-head",
      text: "曲目单"
    });
    const trackRail = voiceFilterStrip.createDiv("bm8-liner-rail");
    trackRail.addEventListener(
      "wheel",
      (ev) => {
        if (trackRail.scrollWidth > trackRail.clientWidth + 4 && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
          trackRail.scrollLeft += ev.deltaY;
          ev.preventDefault();
        }
      },
      { passive: false }
    );
    pills.forEach((p, idx) => {
      const btn = trackRail.createEl("button", {
        cls: `bm8-liner-track ${uiState.activeFilter === p.key ? "is-active" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(uiState.activeFilter === p.key)
        }
      });
      btn.createSpan({
        cls: "bm8-liner-no curator-mono",
        text: String(idx + 1).padStart(2, "0")
      });
      btn.createSpan({ cls: "bm8-liner-label", text: p.label });
      btn.createSpan({ cls: "bm8-liner-count curator-mono", text: String(p.count) });
      btn.onclick = () => {
        if (uiState.activeFilter === p.key) return;
        const prevIdx = pills.findIndex((x) => x.key === uiState.activeFilter);
        uiState.activeFilter = p.key;
        paperSlipSwap(cardsHost, () => renderVoiceCards(), {
          dir: idx >= prevIdx ? 1 : -1,
          small: true
        });
      };
    });
  };

  const renderVoiceCards = () => {
    cardsHost.empty();
    const allVoices = Array.isArray(plugin.settings?.voiceCollection)
      ? plugin.settings.voiceCollection
      : [];
    syncVoiceFilterStrip(allVoices);
    if (voiceCountBadgeEl && voiceCountBadgeEl.isConnected) {
      voiceCountBadgeEl.textContent = `${allVoices.length} 条音声`;
    }
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-voice-badge"]')
        .forEach((el) => {
          el.textContent = String(allVoices.length);
        });
    }
    const list = allVoices.filter((vc) => {
      if (uiState.activeFilter && uiState.activeFilter !== "all") {
        if (uiState.activeFilter.startsWith("char::")) {
          if (String(vc.characterName || "").trim() !== uiState.activeFilter.slice("char::".length)) {
            return false;
          }
        } else if (uiState.activeFilter.startsWith("anime::")) {
          if (String(vc.animeTitle || "").trim() !== uiState.activeFilter.slice("anime::".length)) {
            return false;
          }
        }
      }
      const q = String(uiState.searchQuery || "").trim().toLowerCase();
      if (!q) return true;
      const hay = [vc.quoteText, vc.characterName, vc.animeTitle, vc.timestamp]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    if (list.length === 0) {
      cardsHost.createDiv({
        cls: "curator-rs-empty",
        text: "暂无匹配音声 · 可点击右上角「截取剧集音声」或「抽取名台词」充实典藏。"
      });
      return;
    }

    const grid = cardsHost.createDiv("curator-voice-cards-grid");
    list.forEach((vc) => {
      const card = grid.createDiv("curator-voice-card");
      const rawQuote = String(vc.quoteText || vc.quote || vc.text || "").trim() || "（未附台词片段）";
      const quoteEl = card.createDiv({
        cls: "curator-voice-quote-text",
        text: `“${rawQuote}”`
      });
      quoteEl.title = rawQuote;

      const metaRow = card.createDiv("curator-voice-meta-row");
      if (vc.characterName) {
        metaRow.createSpan({ cls: "curator-voice-chip is-char", text: vc.characterName });
      }
      if (vc.animeTitle) {
        metaRow.createSpan({
          cls: "curator-voice-chip is-anime",
          text: `《${vc.animeTitle}》${vc.episode ? ` 第${vc.episode}话` : ""}`
        });
      }
      if (vc.timestamp) {
        metaRow.createSpan({ cls: "curator-voice-chip curator-mono", text: vc.timestamp });
      }

      const diskAudio = resolveVoiceAudioDiskState(plugin, vc.audioPath);
      if (diskAudio.exists && diskAudio.playUrl) {
        const player = card.createDiv("bm8-voice-player");
        const audioEl = player.createEl("audio", {
          attr: { preload: "metadata", src: diskAudio.playUrl }
        });
        audioEl.style.display = "none";

        const playBtn = player.createEl("button", {
          cls: "bm8-voice-play-btn",
          attr: { type: "button", "aria-label": "播放或暂停原声", title: "点击播放/暂停台词原声" }
        });
        playBtn.appendChild(v07Core.icon("play", 14));

        const scrubWrap = player.createDiv("bm8-voice-scrub-wrap");
        const scrubTrack = scrubWrap.createDiv("bm8-voice-scrub");
        const scrubFill = scrubTrack.createDiv("bm8-voice-scrub-fill");
        const timeRow = scrubWrap.createDiv("bm8-voice-time-row");
        const timeSpan = timeRow.createSpan({ text: "0:00 / --:--" });
        const eqBox = timeRow.createSpan({ cls: "bm8-voice-eq" });
        eqBox.createEl("i");
        eqBox.createEl("i");
        eqBox.createEl("i");

        const syncUi = () => {
          const dur = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
          const curT = Number(audioEl.currentTime) || 0;
          const pct = dur > 0 ? Math.min(100, Math.max(0, (curT / dur) * 100)) : 0;
          scrubFill.style.width = `${pct.toFixed(1)}%`;
          timeSpan.textContent = `${fmtAudioClock(curT)} / ${dur > 0 ? fmtAudioClock(dur) : "0:00"}`;
        };
        const setPlayingVisual = (playing) => {
          card.classList.toggle("is-playing", playing);
          playBtn.empty();
          playBtn.appendChild(v07Core.icon(playing ? "pause" : "play", 14));
        };

        audioEl.addEventListener("loadedmetadata", syncUi);
        audioEl.addEventListener("timeupdate", syncUi);
        audioEl.addEventListener("play", () => {
          if (container._activeVoiceAudioEl && container._activeVoiceAudioEl !== audioEl) {
            try {
              container._activeVoiceAudioEl.pause();
            } catch (_) {}
          }
          container._activeVoiceAudioEl = audioEl;
          setPlayingVisual(true);
        });
        audioEl.addEventListener("pause", () => setPlayingVisual(false));
        audioEl.addEventListener("ended", () => {
          setPlayingVisual(false);
          scrubFill.style.width = "0%";
        });

        playBtn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (audioEl.paused) {
            audioEl.play().catch(() => {});
          } else {
            audioEl.pause();
          }
        };

        scrubTrack.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const rect = scrubTrack.getBoundingClientRect();
          if (!rect.width || !Number.isFinite(audioEl.duration) || audioEl.duration <= 0) return;
          const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          audioEl.currentTime = ratio * audioEl.duration;
          syncUi();
        };
      } else if (diskAudio.missingFile) {
        const missingRow = card.createDiv("curator-voice-meta-row");
        missingRow.createSpan({
          cls: "curator-voice-chip curator-mono",
          text: `本地音频已移除 (${vc.audioPath})`
        });
      } else {
        const reasonRow = card.createDiv("curator-voice-meta-row");
        reasonRow.createSpan({
          cls: "curator-voice-chip",
          text: vc.audioFallbackReason || "纯文字台词（可点击下方绑定本地音频）"
        });
      }

      const actions = card.createDiv("curator-voice-actions-row");
      if (!diskAudio.exists) {
        const bindAudioBtn = actions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "绑定音频"
        });
        bindAudioBtn.title = "为该条台词绑定本地音频文件并复制到音声典藏目录持久保存";
        bindAudioBtn.onclick = () => {
          const aInput = document.createElement("input");
          aInput.type = "file";
          aInput.accept = "audio/*,.mp3,.wav,.ogg,.m4a,.flac";
          aInput.onchange = async () => {
            const af = aInput.files && aInput.files[0];
            if (!af) return;
            const afPath = getNativeFilePath(af);
            let audioBuf = null;
            if (isDesktopNodeAvailable() && afPath && fs.existsSync(afPath)) {
              audioBuf = fs.readFileSync(afPath);
            } else if (typeof af.arrayBuffer === "function") {
              const ab = await af.arrayBuffer();
              if (ab && ab.byteLength > 0) audioBuf = toNodeBufferOrUint8(ab);
            }
            const audioLen = audioBuf ? (audioBuf.byteLength ?? audioBuf.length ?? 0) : 0;
            if (audioBuf && audioLen > 0) {
              const defaultVoiceFolder = resolveDefaultVoiceArchiveFolder(plugin);
              const { absDir, vaultBase } = ensureDirectoryAbsolute(
                plugin,
                defaultVoiceFolder,
                defaultVoiceFolder
              );
              const ext = path.extname(af.name || afPath || "") || ".mp3";
              const targetName = `bound_voice_${Date.now()}${ext}`;
              let storedPath = "";
              if (isDesktopNodeAvailable() && absDir) {
                const absTarget = path.join(absDir, targetName);
                fs.writeFileSync(absTarget, audioBuf);
                storedPath = absTarget;
                if (vaultBase && absTarget.toLowerCase().startsWith(vaultBase.toLowerCase())) {
                  storedPath = path.relative(vaultBase, absTarget).replace(/\\/g, "/");
                }
              } else {
                const relVoiceFolder = normalizeVaultRelPath(defaultVoiceFolder) || "附件/音声典藏";
                storedPath = `${relVoiceFolder}/${targetName}`;
                await writeVaultBinaryFile(plugin.app, storedPath, audioBuf);
              }
              vc.audioPath = storedPath;
              delete vc.audioFallbackReason;
              await plugin.saveSettings();
              if (Notice) new Notice(`已绑定并持久保存音频至：${storedPath}`);
              renderVoiceCards();
            }
          };
          aInput.click();
        };
      }

      const jumpVoiceToSourceVideo = async () => {
        const matchedAni = (vaultAnimeItems || []).find(
          (a) => a.name === vc.animeTitle || (a.downloadPath && vc.sourceVideoPath.startsWith(a.downloadPath))
        );
        if (matchedAni) {
          await reviewStudioService.launchVideoAtEpisodeAndTimestamp(plugin, matchedAni, {
            episode: Number(vc.episode) || 1,
            timestamp: vc.timestamp || ""
          });
        } else {
          await openLocalPathSafely(vc.sourceVideoPath);
        }
      };

      if (isDesktopNodeAvailable() && vc.sourceVideoPath && fs.existsSync(vc.sourceVideoPath)) {
        const jumpVideoBtn = actions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          attr: {
            type: "button",
            title: "调用本地播放器打开原片视频，并自动定位至该台词时间点"
          }
        });
        jumpVideoBtn.createSpan({ text: "跳至原片时间点" });
        const cue = jumpVideoBtn.createSpan({ cls: "bm8-jump-cue" });
        cue.appendChild(v07Core.icon("arrowUpRight", 12));
        jumpVideoBtn.onclick = jumpVoiceToSourceVideo;
      }

      const removeVoiceRecord = async () => {
        const remaining = (plugin.settings.voiceCollection || []).filter(
          (x) => x.id !== vc.id
        );
        plugin.settings.voiceCollection = remaining;
        if (vc.audioPath && !/^https?:\/\//i.test(String(vc.audioPath))) {
          const normAudio = normalizeVaultRelPathCaseInsensitive(plugin, vc.audioPath);
          const normVoiceDir = normalizeVaultRelPathCaseInsensitive(
            plugin,
            resolveDefaultVoiceArchiveFolder(plugin)
          );
          const normLegacyVoiceDir = normalizeVaultRelPathCaseInsensitive(
            plugin,
            "附件/台词音声库"
          );
          const stillUsed = remaining.some(
            (x) =>
              x &&
              x.audioPath &&
              normalizeVaultRelPathCaseInsensitive(plugin, x.audioPath) === normAudio
          );
          if (
            !stillUsed &&
            ((normVoiceDir && normAudio.startsWith(normVoiceDir + "/")) ||
              (normLegacyVoiceDir && normAudio.startsWith(normLegacyVoiceDir + "/")))
          ) {
            await moveLocalFileToTrashSafely(plugin, vc.audioPath);
          }
        }
        await plugin.saveSettings();
        renderVoiceCards();
      };

      const delBtn = actions.createEl("button", {
        cls: "bm8-voice-trash-btn",
        attr: {
          type: "button",
          "aria-label": "移除该条音声",
          title: "移除该条音声记录（若关联本地音频且未被其他记录引用，将一并移入回收站）"
        }
      });
      delBtn.appendChild(v07Core.icon("trash", 14));
      delBtn.onclick = removeVoiceRecord;

      const openVoiceRelations = () => {
        openMagicWandRelationModal(
          plugin,
          {
            type: "voice",
            id: vc.id,
            title: vc.characterName || vc.animeTitle || vc.quoteText,
            animeTitle: vc.animeTitle
          },
          vaultAnimeItems,
          options.wandCallbacks
        );
      };

      card.addEventListener("contextmenu", (ev) => {
        try {
          if (typeof Menu === "function") {
            ev.preventDefault();
            ev.stopPropagation();
            const menu = new Menu();
            menu.addItem((mi) => mi.setTitle("查看关联收藏").onClick(openVoiceRelations));
            if (isDesktopNodeAvailable() && vc.sourceVideoPath && fs.existsSync(vc.sourceVideoPath)) {
              menu.addItem((mi) => mi.setTitle("跳原片时间点").onClick(jumpVoiceToSourceVideo));
            }
            if (diskAudio.exists && vc.audioPath && isDesktopNodeAvailable()) {
              menu.addItem((mi) =>
                mi
                  .setTitle("在资源管理器中定位音频")
                  .onClick(() => revealLocalFileInExplorer(plugin, vc.audioPath))
              );
            }
            menu.addSeparator();
            menu.addItem((mi) => mi.setTitle("移除该条音声记录").onClick(removeVoiceRecord));
            menu.showAtMouseEvent(ev);
          }
        } catch (_) {}
      });

      bindMagicWandLongPress(card, openVoiceRelations);
    });
  };

  renderVoiceCards();
}

/**
 * ==================== 4. 🎮 游戏典藏（Local Game Library · 参照 ReinaManager 设计） ====================
 */
async function syncGameMarkdownNote(plugin, game) {
  if (!game || !game.title) return;
  try {
    const folder = normalizeVaultRelPath(
      String(plugin.settings?.gameNoteFolder || "游戏笔记").trim() || "游戏笔记"
    );
    const safeName = String(game.title).replace(/[\\/:*?"<>|]/g, "_");
    const relFilePath = `${folder}/${safeName}.md`;

    const todosMd = Array.isArray(game.todos) && game.todos.length
      ? game.todos
          .map(
            (t) =>
              `- [${t.done ? "x" : " "}] **${t.progressTag || "待办"}**：${t.text} *(记录于 ${t.timeLabel || ""})*`
          )
          .join("\n")
      : "- 暂无待办事项";

    const notesMd = Array.isArray(game.playNotes) && game.playNotes.length
      ? game.playNotes
          .map((n) => `- **[${n.progressTag || "游记"} · ${n.timeLabel || ""}]** ${n.text}`)
          .join("\n")
      : "- 暂无游记手札";

    const guidesMd = Array.isArray(game.strategyUrls) && game.strategyUrls.length
      ? game.strategyUrls
          .map((g) => `- [${g.title || g.url}](${g.url})${g.remark ? ` — *备注${g.spoiler ? "（含剧透）" : ""}：${g.remark}*` : ""}`)
          .join("\n")
      : "- 暂无攻略网址";

    const md = [
      "---",
      `title: "${game.title.replace(/"/g, '\\"')}"`,
      `status: "${game.status || "在玩"}"`,
      `personal_score: ${game.score ?? ""}`,
      `play_hours: ${game.playHours ?? 0}`,
      `current_progress: "${(game.currentProgress || "").replace(/"/g, '\\"')}"`,
      `launch_mode: "${game.launchMode || "exe"}"`,
      "tags: [game, 游戏典藏]",
      "---",
      "",
      `# ${game.title}`,
      "",
      `- **游玩状态**：${game.status || "在玩"}`,
      `- **个人评分**：${game.score ? `★ ${Number(game.score).toFixed(1)}` : "未评分"}`,
      `- **累计时长**：${Number(game.playHours || 0).toFixed(1)} 小时`,
      `- **当前进度 / 章节**：${game.currentProgress || "初见"}`,
      `- **启动路径**：\`${game.exePath || game.romPath || "未绑定"}\``,
      "",
      "## 攻略与资料站导航",
      guidesMd,
      "",
      "## 进度待办清单 (To-Do)",
      todosMd,
      "",
      "## 时间/进度索引游记手札",
      notesMd,
      ""
    ].join("\n");

    const vault = plugin && plugin.app && plugin.app.vault;
    if (vault && typeof vault.getAbstractFileByPath === "function") {
      const parts = folder.split("/").filter(Boolean);
      let accum = "";
      for (const seg of parts) {
        accum = accum ? `${accum}/${seg}` : seg;
        if (!vault.getAbstractFileByPath(accum) && typeof vault.createFolder === "function") {
          try {
            await vault.createFolder(accum);
          } catch (_) {}
        }
      }
      const existing = vault.getAbstractFileByPath(relFilePath);
      if (existing && typeof vault.modify === "function") {
        await vault.modify(existing, md);
        return;
      } else if (!existing && typeof vault.create === "function") {
        await vault.create(relFilePath, md);
        return;
      }
    }

    if (isDesktopNodeAvailable()) {
      const { absDir } = ensureDirectoryAbsolute(plugin, folder, "游戏笔记");
      const absFile = path.join(absDir, `${safeName}.md`);
      fs.writeFileSync(absFile, md, "utf8");
    }
  } catch (e) {}
}

function launchLocalGameProcess(plugin, game, onSessionEnd) {
  if (isMobileEnv()) {
    if (Notice) new Notice("手机端不支持启动本地 .exe 程序，可使用「开始计时」或「手动补录时长」记录游玩时间。");
    return;
  }
  const mode = game.launchMode || "exe";
  const exePath = String(game.exePath || "").trim();
  const romPath = String(game.romPath || "").trim();
  const customArgs = String(game.launchArgs || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!exePath) {
    if (Notice) new Notice("请先为该游戏绑定启动程序 (.exe) 或模拟器路径！");
    return;
  }

  // 支持 steam:// 协议链接（同步启动游玩计时器，游玩结束后一键结算时长）
  if (/^steam:\/\//i.test(exePath)) {
    window.open(exePath);
    try {
      const gs = require("./game-stats-and-groups-service.js");
      if (!gs.getActiveGameTimer(plugin, game.id)) {
        gs.startActiveGameTimer(plugin, game);
      }
    } catch (_) {}
    if (Notice) new Notice(`已通过 Steam 启动《${game.title}》，已开启游玩计时（结束后点「结束并记入」即可结算时长）`);
    if (typeof onSessionEnd === "function") onSessionEnd();
    return;
  }

  if (!fs.existsSync(exePath)) {
    if (Notice) new Notice(`未找到启动文件：${exePath}`);
    return;
  }

  const startTs = Date.now();
  const startIso = new Date(startTs).toISOString();
  const args = mode === "emulator" && romPath ? [...customArgs, romPath] : customArgs;
  try {
    const child = spawn(exePath, args, {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    if (Notice) {
      new Notice(
        mode === "emulator"
          ? `已通过模拟器启动《${game.title}》，正在自动记录游玩时长...`
          : `已启动《${game.title}》，正在自动记录游玩时长...`
      );
    }
    child.on("close", async () => {
      const endIso = new Date().toISOString();
      const elapsedMin = Math.max(1, Math.round((Date.now() - startTs) / 60000));
      const elapsedHours = Number((elapsedMin / 60).toFixed(2));
      if (!Array.isArray(game.playSessions)) game.playSessions = [];
      game.playSessions.unshift({
        id: `ses-${Date.now().toString(36)}`,
        start: startIso,
        startedAt: startIso,
        endedAt: endIso,
        minutes: elapsedMin,
        durationHours: elapsedHours,
        source: "auto",
        mode: "auto",
        note: mode === "emulator" ? "模拟器自动记录" : ""
      });
      game.playHours = Number(((Number(game.playHours) || 0) + elapsedHours).toFixed(2));
      game.lastPlayedAt = endIso;
      if (!game.firstPlayedAt) game.firstPlayedAt = startIso;
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      if (typeof onSessionEnd === "function") onSessionEnd();
    });
  } catch (err) {
    if (Notice) new Notice(`启动失败：${err.message}`);
  }
}

/* ───────────── Bangumi 游戏封面与词条候选检索器 ───────────── */
function extractBgmGameDeveloper(sub) {
  if (!sub || typeof sub !== "object") return "";
  if (Array.isArray(sub.infobox)) {
    const keys = ["开发", "开发商", "制作", "发行", "开发团队", "メーカー", "ブランド"];
    for (const k of keys) {
      const hit = sub.infobox.find((row) => row && row.key === k);
      if (hit && hit.value) {
        if (typeof hit.value === "string") return hit.value.trim();
        if (Array.isArray(hit.value)) {
          const vals = hit.value.map((x) => (typeof x === "string" ? x : x?.v || "")).filter(Boolean);
          if (vals.length) return vals.join(" / ");
        }
      }
    }
  }
  return "";
}

async function searchBangumiGameSubjects(keyword, limit = 12) {
  const cleanKw = String(keyword || "").trim();
  if (!cleanKw) return [];
  const res = await requestUrl({
    url: `https://api.bgm.tv/v0/search/subjects?limit=${Math.max(1, Math.min(20, limit))}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BGM_USER_AGENT
    },
    body: JSON.stringify({ keyword: cleanKw, filter: { type: [4] } })
  });
  const list = Array.isArray(res?.json?.data) ? res.json.data : [];
  const norm = (s) => String(s || "").trim().toLowerCase();
  const qNorm = norm(cleanKw);

  return list
    .map((sub, idx) => {
      const nameCn = String(sub?.name_cn || "").trim();
      const nameOrig = String(sub?.name || "").trim();
      const displayTitle = nameCn || nameOrig || "未命名游戏";
      const isExact =
        (nameCn && norm(nameCn) === qNorm) ||
        (nameOrig && norm(nameOrig) === qNorm);
      const coverUrl =
        sub?.images?.large || sub?.images?.common || sub?.images?.medium || "";
      const thumbUrl =
        sub?.images?.common || sub?.images?.medium || sub?.images?.large || "";
      const score = Number.isFinite(Number(sub?.rating?.score)) && Number(sub.rating.score) > 0
        ? Number(Number(sub.rating.score).toFixed(1))
        : null;
      const dateStr = String(sub?.date || "").trim();
      const platform = String(sub?.platform || "").trim();
      const developer = extractBgmGameDeveloper(sub);
      const summary = String(sub?.summary || "").replace(/\s+/g, " ").trim();
      return {
        id: sub?.id,
        idx,
        displayTitle,
        nameCn,
        nameOrig,
        isExact,
        coverUrl,
        thumbUrl,
        score,
        dateStr,
        platform,
        developer,
        summary
      };
    })
    .sort((a, b) => {
      if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
      return a.idx - b.idx;
    });
}

async function renderBangumiGameCandidatePicker(opts = {}) {
  const {
    mountEl,
    initialQuery = "",
    getCurrentTitle = () => "",
    triggerBtn = null,
    onPickCoverOnly,
    onPickFullEntry
  } = opts;
  if (!mountEl) return;

  mountEl.style.display = "block";
  mountEl.empty();

  const wrap = mountEl.createDiv("curator-game-bgm-picker");
  const head = wrap.createDiv("curator-game-bgm-picker-head");
  const titleEl = head.createDiv({
    cls: "curator-game-bgm-picker-title",
    text: "Bangumi 游戏封面与词条候选（点击选用，不会擅自篡改您的标题）"
  });
  const closeBtn = head.createEl("button", {
    cls: "curator-dl-mini-btn",
    text: "收起候选"
  });
  closeBtn.onclick = () => {
    mountEl.empty();
    mountEl.style.display = "none";
  };

  const bar = wrap.createDiv("curator-game-bgm-picker-bar");
  const kwIn = bar.createEl("input", {
    type: "text",
    cls: "curator-input",
    placeholder: "输入检索词（仅用于搜索 Bangumi 候选，不直接修改上方游戏标题）..."
  });
  kwIn.value = initialQuery;
  const searchAgainBtn = bar.createEl("button", {
    cls: "curator-dl-mini-btn is-accent",
    text: "重新检索"
  });

  const listHost = wrap.createDiv("curator-game-bgm-results-host");

  const runQuery = async (kw) => {
    const q = String(kw || "").trim();
    if (!q) return;
    listHost.empty();
    listHost.createDiv({
      cls: "curator-game-bgm-meta",
      text: `正在从 Bangumi 检索「${q}」的游戏词条候选...`
    });
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "检索中...";
    }
    searchAgainBtn.disabled = true;

    try {
      const candidates = await searchBangumiGameSubjects(q, 12);
      listHost.empty();
      if (candidates.length === 0) {
        listHost.createDiv({
          cls: "curator-game-bgm-meta",
          text: `未检索到与「${q}」匹配的 Bangumi 游戏词条，您可换用日文/英文原名重新检索，或直接填写本地封面路径。`
        });
        titleEl.textContent = `Bangumi 游戏检索结果（0 条）`;
        return;
      }

      titleEl.textContent = `Bangumi 游戏候选（共 ${candidates.length} 条 · 同名原作已优先置顶）`;
      const grid = listHost.createDiv("curator-game-bgm-grid");

      for (const cand of candidates) {
        const card = grid.createDiv(
          `curator-game-bgm-card ${cand.isExact ? "is-exact" : ""}`
        );
        const thumbBox = card.createDiv("curator-game-bgm-thumb");
        if (cand.thumbUrl) {
          const img = thumbBox.createEl("img", {
            attr: { src: cand.thumbUrl, alt: cand.displayTitle }
          });
          img.onerror = () => {
            img.remove();
            thumbBox.empty();
            thumbBox.appendChild(v07Core.icon("gamepad", 18));
          };
        } else {
          thumbBox.appendChild(v07Core.icon("gamepad", 18));
        }

        const info = card.createDiv("curator-game-bgm-info");
        const nameRow = info.createDiv("curator-game-bgm-name-row");
        nameRow.createSpan({
          cls: "curator-game-bgm-name",
          text: cand.displayTitle
        });
        if (cand.isExact) {
          nameRow.createSpan({
            cls: "curator-game-bgm-exact-pill",
            text: "精准同名"
          });
        }
        if (cand.nameOrig && cand.nameOrig !== cand.displayTitle) {
          info.createDiv({
            cls: "curator-game-bgm-orig",
            text: cand.nameOrig
          });
        }

        const metaParts = [
          cand.platform,
          cand.dateStr,
          cand.score ? `BGM ★${cand.score}` : "",
          cand.developer
        ].filter(Boolean);
        if (metaParts.length > 0) {
          info.createDiv({
            cls: "curator-game-bgm-meta",
            text: metaParts.join(" · ")
          });
        } else if (cand.summary) {
          info.createDiv({
            cls: "curator-game-bgm-orig",
            text: cand.summary.slice(0, 46)
          });
        }

        const actRow = info.createDiv("curator-game-bgm-actions");
        const curTypedTitle = String(getCurrentTitle() || "").trim();
        const hasDifferentUserTitle =
          Boolean(curTypedTitle) && curTypedTitle !== cand.displayTitle;

        const coverOnlyBtn = actRow.createEl("button", {
          cls: `curator-dl-mini-btn ${hasDifferentUserTitle ? "is-primary" : "is-accent"}`,
          text: "仅用此封面"
        });
        coverOnlyBtn.title = `仅采用该词条的高清封面图，保留您当前填写的游戏标题「${
          curTypedTitle || cand.displayTitle
        }」不变`;
        coverOnlyBtn.onclick = () => {
          if (typeof onPickCoverOnly === "function") onPickCoverOnly(cand);
          mountEl.empty();
          mountEl.style.display = "none";
        };

        const fullBtn = actRow.createEl("button", {
          cls: `curator-dl-mini-btn ${hasDifferentUserTitle ? "" : "is-primary"}`,
          text: "套用词条与封面"
        });
        fullBtn.title = `将游戏标题设为《${cand.displayTitle}》并同步填入封面与参考信息`;
        fullBtn.onclick = () => {
          if (typeof onPickFullEntry === "function") onPickFullEntry(cand);
          mountEl.empty();
          mountEl.style.display = "none";
        };
      }
    } catch (err) {
      listHost.empty();
      listHost.createDiv({
        cls: "curator-game-bgm-meta",
        text: `检索 Bangumi 游戏词条失败：${err?.message || "请检查网络连接"}`
      });
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "自动获取 Bangumi 游戏封面";
      }
      searchAgainBtn.disabled = false;
    }
  };

  searchAgainBtn.onclick = () => runQuery(kwIn.value);
  kwIn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) {
      ev.preventDefault();
      runQuery(kwIn.value);
    }
  });

  await runQuery(initialQuery);
}

function openGameEditMetadataModal(plugin, game, onRefresh) {
  if (!game) return;
  const modal = new Modal(plugin.app);
  modal.onOpen = () => {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.addClass("curator-game-edit-modal");

    contentEl.createEl("h3", { text: `修改《${game.title || "未命名游戏"}》封面与信息` });

    const makeField = (label, placeholder, initialVal) => {
      const row = contentEl.createDiv("curator-game-edit-row");
      row.createDiv({ cls: "curator-game-edit-label", text: label });
      const inp = row.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder
      });
      inp.value = initialVal || "";
      return { row, inp };
    };

    const titleField = makeField("游戏名称", "例如：千恋＊万花 / 英雄联盟", game.title);
    const pickerRow = contentEl.createDiv("curator-char-draft-row");
    const fetchBtn = pickerRow.createEl("button", {
      cls: "curator-btn",
      text: "多数据源搜索词条与封面（Bangumi / VNDB / Steam / 月幕）"
    });
    const pickerMount = contentEl.createDiv("curator-game-bgm-picker-mount bm7-root");
    pickerMount.style.display = "none";

    const coverField = makeField("封面图片 URL 或本地路径", "https://... 或本地图片路径", game.coverUrl);
    const devField = makeField("开发商 / 社团（可选）", "例如：Yuzusoft / Riot Games", game.developer);
    const exeField = makeField(
      "启动程序路径 / Steam 链接（可选）",
      ".exe / .lnk / steam://rungameid/...",
      game.exePath
    );

    fetchBtn.onclick = () => {
      const q = titleField.inp.value.trim() || game.title || "";
      pickerMount.style.display = "block";
      const v07Game = require("./v07-game-ui.js");
      const v07Adapters = require("./v07-adapters.js");
      const gameApi = require("./game-multisource-api.js");
      v07Game.renderGameSourceSearch(pickerMount, {
        initialQuery: q,
        source: "all",
        search: v07Adapters.searchGameSourcesAdapter,
        onPickCover: async (cand) => {
          const enriched = cand._raw ? await gameApi.enrichGameCandidateDetail(cand._raw) : cand;
          if (enriched.coverUrl || cand.cover) coverField.inp.value = enriched.coverUrl || cand.cover;
          if ((enriched.developer || cand.developer) && !devField.inp.value.trim()) {
            devField.inp.value = enriched.developer || cand.developer;
          }
          pickerMount.style.display = "none";
          pickerMount.empty();
        },
        onPickFull: async (cand) => {
          const enriched = cand._raw ? await gameApi.enrichGameCandidateDetail(cand._raw) : cand;
          if (cand.title) titleField.inp.value = cand.title;
          if (enriched.coverUrl || cand.cover) coverField.inp.value = enriched.coverUrl || cand.cover;
          if (enriched.developer || cand.developer) devField.inp.value = enriched.developer || cand.developer;
          if (cand.source === "steam" && enriched.steamAppId && !exeField.inp.value.trim()) {
            exeField.inp.value = `steam://rungameid/${enriched.steamAppId}`;
          }
          pickerMount.style.display = "none";
          pickerMount.empty();
        }
      });
    };

    const foot = contentEl.createDiv("curator-char-draft-actions");
    const cancelBtn = foot.createEl("button", { cls: "curator-btn", text: "取消" });
    cancelBtn.onclick = () => modal.close();
    const saveBtn = foot.createEl("button", { cls: "curator-btn is-primary", text: "保存修改" });
    saveBtn.onclick = async () => {
      game.title = titleField.inp.value.trim() || game.title || "未命名游戏";
      game.coverUrl = coverField.inp.value.trim();
      game.developer = devField.inp.value.trim();
      game.exePath = exeField.inp.value.trim();
      await plugin.saveSettings();
      await syncGameMarkdownNote(plugin, game);
      modal.close();
      if (typeof onRefresh === "function") onRefresh();
      if (Notice) new Notice(`已更新《${game.title}》的封面与游戏信息`);
    };
  };
  modal.open();
}

/* ───────────── 游戏手札：数据规整与格式化辅助（卡片与弹窗共用） ───────────── */
const GAME_STATUS_ORDER = ["在玩", "通关", "全成就", "想玩", "搁置"];

function formatGameHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return "0h";
  return `${Math.round(n * 10) / 10}h`;
}

function parseGameJournalTime(entry) {
  if (!entry) return null;
  if (entry.createdAt) {
    const d = new Date(entry.createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (entry.timeLabel) {
    const d = new Date(String(entry.timeLabel).replace(/-/g, "/"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * 兼容两代数据：新字段 { hours, chapter, createdAt } 与旧字段 { progressTag: "3h · 第3章", timeLabel }
 */
function normalizeGameJournalEntry(entry) {
  const e = entry || {};
  let hours =
    e.hours !== undefined && e.hours !== null && e.hours !== "" && Number.isFinite(Number(e.hours))
      ? Number(e.hours)
      : null;
  let chapter = typeof e.chapter === "string" ? e.chapter.trim() : "";
  const tag = String(e.progressTag || "").trim();
  if (tag && (hours === null || !chapter)) {
    const m = tag.match(/^([\d.]+)\s*h(?:\s*[·・]\s*(.*))?$/i);
    if (m) {
      if (hours === null && Number.isFinite(Number(m[1]))) hours = Number(m[1]);
      if (!chapter && m[2]) chapter = m[2].trim();
    } else if (!chapter) {
      chapter = tag;
    }
  }
  return { hours, chapter, time: parseGameJournalTime(e), rawTime: String(e.timeLabel || "") };
}

function formatGameJournalWhen(date, fallback = "") {
  if (!date) return fallback;
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `昨天 ${hm}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 以游戏当前进度与时长生成一枚记录戳（同时写入新旧两代字段，旧版 Markdown 同步无需改动） */
function buildGameJournalStamp(game) {
  const hours = Math.round(Math.max(0, Number(game.playHours) || 0) * 10) / 10;
  const chapter = String(game.currentProgress || "").trim();
  const now = new Date();
  return {
    hours,
    chapter,
    createdAt: now.toISOString(),
    progressTag: chapter ? `${hours}h · ${chapter}` : `${hours}h`,
    timeLabel: now.toLocaleString("zh-CN", { hour12: false })
  };
}

function describeGameJournalStamp(meta) {
  const parts = [];
  if (meta && meta.chapter) parts.push(meta.chapter);
  if (meta && meta.hours !== null && meta.hours !== undefined) parts.push(formatGameHours(meta.hours));
  return parts.join(" · ");
}

function getGameNoteRelPath(plugin, game) {
  const folder = String(plugin.settings?.gameNoteFolder || "游戏笔记").trim() || "游戏笔记";
  const safeName = String(game.title || "").replace(/[\\/:*?"<>|]/g, "_");
  return `${folder}/${safeName}.md`;
}

function getGameJournalUiState(plugin) {
  if (!plugin.__gameJournalUi) plugin.__gameJournalUi = { tabByGame: {}, drafts: {}, showDone: false };
  return plugin.__gameJournalUi;
}

function getGuideHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function normalizeGuideUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+/.test(s)) return `https://${s}`;
  return s;
}

/**
 * 游戏手札弹窗：抬头（身份 + 可直接改的进度/时长/评分）· 手札时间线（主栏）· 待办与攻略（侧栏）
 * - 宽屏双栏各自滚动；窄屏 / 移动端自动折叠为「手札 / 待办 / 攻略」三段切换
 * - 所有修改就地局部刷新，不整窗重绘，滚动位置与输入焦点不丢失
 * @param {object} [openOptions] { tab: "notes" | "todos" | "guides" }
 */
function openGameDetailAndNotesModal(plugin, game, onRefresh, openOptions = {}) {
  if (!game) return;
  if (!Array.isArray(game.todos)) game.todos = [];
  if (!Array.isArray(game.playNotes)) game.playNotes = [];
  if (!Array.isArray(game.strategyUrls)) game.strategyUrls = [];
  const seed = Date.now().toString(36);
  const ensureIds = (list, prefix) =>
    list.forEach((it, i) => {
      if (it && typeof it === "object" && !it.id) it.id = `${prefix}-${seed}-${i}`;
    });
  ensureIds(game.todos, "todo");
  ensureIds(game.playNotes, "gnote");
  ensureIds(game.strategyUrls, "guide");

  const ui = getGameJournalUiState(plugin);
  const TABS = [
    { key: "notes", label: "手札" },
    { key: "todos", label: "待办" },
    { key: "guides", label: "攻略" }
  ];
  const isTabKey = (k) => TABS.some((t) => t.key === k);
  let activeTab = isTabKey(openOptions.tab) ? openOptions.tab : ui.tabByGame[game.id] || "notes";
  if (!isTabKey(activeTab)) activeTab = "notes";

  const modal = new Modal(plugin.app);
  let dirty = false;
  let saveChain = Promise.resolve();
  let savedEl = null;
  let savedTimer = null;
  let composerEl = null;
  let todoSettleTimer = null;

  const flashSaved = (text, isError = false) => {
    if (!savedEl || !savedEl.isConnected) return;
    savedEl.textContent = text;
    savedEl.classList.toggle("is-error", Boolean(isError));
    savedEl.classList.add("is-visible");
    if (savedTimer) window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      if (savedEl && savedEl.isConnected) savedEl.classList.remove("is-visible");
    }, 1800);
  };

  const persist = (hint = "已保存") => {
    dirty = true;
    saveChain = saveChain.then(async () => {
      try {
        await plugin.saveSettings();
        await syncGameMarkdownNote(plugin, game);
        flashSaved(hint);
      } catch (err) {
        console.error("[bangumi-manager] 游戏手札保存失败", err);
        flashSaved("保存失败，请稍后重试", true);
      }
    });
    return saveChain;
  };

  const isImeEnter = (ev) => ev.isComposing || ev.keyCode === 229;

  const autoGrow = (ta, max = 260) => {
    if (!ta || !ta.isConnected) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight + 2, max)}px`;
  };

  /** 两步确认删除：第一次点击变为「确认删除」，2.6 秒内再点才执行 */
  const armDelete = (btn, onConfirm) => {
    const label = btn.textContent;
    let armed = false;
    let timer = null;
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!armed) {
        armed = true;
        btn.classList.add("is-armed");
        btn.textContent = "确认删除";
        timer = window.setTimeout(() => {
          armed = false;
          if (btn.isConnected) {
            btn.classList.remove("is-armed");
            btn.textContent = label;
          }
        }, 2600);
        return;
      }
      if (timer) window.clearTimeout(timer);
      onConfirm();
    };
  };

  /** 就地编辑：把文本节点临时换成输入框，保存/取消后由 onDone 局部重绘 */
  const beginInlineEdit = (hostEl, initial, { multiline = false, onSave, onDone }) => {
    if (hostEl.dataset.editing === "1") return;
    hostEl.dataset.editing = "1";
    hostEl.empty();
    hostEl.addClass("is-editing");
    const field = multiline
      ? hostEl.createEl("textarea", { cls: "curator-gj-edit-field" })
      : hostEl.createEl("input", { type: "text", cls: "curator-gj-edit-field" });
    field.value = initial;
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const v = field.value.trim();
      if (save && v && v !== initial) onSave(v);
      onDone();
    };
    if (multiline) {
      const bar = hostEl.createDiv("curator-gj-edit-bar");
      const cancelBtn = bar.createEl("button", { cls: "curator-gj-btn is-quiet", text: "取消" });
      const okBtn = bar.createEl("button", { cls: "curator-gj-btn is-primary", text: "保存" });
      cancelBtn.onclick = () => finish(false);
      okBtn.onclick = () => finish(true);
      field.addEventListener("input", () => autoGrow(field, 360));
      window.requestAnimationFrame(() => autoGrow(field, 360));
    } else {
      field.addEventListener("blur", () => finish(true));
    }
    field.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" || isImeEnter(ev)) return;
      if (!multiline || ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        finish(true);
      }
    });
    field.focus();
    try {
      field.setSelectionRange(field.value.length, field.value.length);
    } catch (_) {}
  };

  const renderEmpty = (host, title, desc, variant = "") => {
    const box = host.createDiv(`curator-gj-empty ${variant}`.trim());
    if (variant === "is-hero") box.createDiv("curator-gj-empty-sheet");
    box.createDiv({ cls: "curator-gj-empty-title", text: title });
    box.createDiv({ cls: "curator-gj-empty-desc", text: desc });
    return box;
  };

  modal.onOpen = () => {
    const { contentEl, modalEl } = modal;
    modalEl.addClass("curator-gj-shell");
    contentEl.empty();
    contentEl.addClass("curator-gj");

    /* ── 抬头：封面 · 标题 · 状态 · 进度 / 时长 / 评分 ── */
    const head = contentEl.createDiv("curator-gj-head");
    const coverWrap = head.createDiv("curator-gj-cover");
    const coverSrc = resolveLocalOrVaultImageUrl(plugin, game.coverUrl);
    if (coverSrc) {
      const img = coverWrap.createEl("img", { attr: { src: coverSrc, alt: "" } });
      img.onerror = () => {
        img.remove();
        coverWrap.createDiv({ cls: "curator-gj-cover-fallback", text: String(game.title || "?").slice(0, 1) });
      };
    } else {
      coverWrap.createDiv({ cls: "curator-gj-cover-fallback", text: String(game.title || "?").slice(0, 1) });
    }

    const ident = head.createDiv("curator-gj-ident");
    ident.createDiv({ cls: "curator-gj-title", text: game.title || "未命名游戏" });
    const sub = ident.createDiv("curator-gj-sub");
    const statusWrap = sub.createDiv("curator-gj-status-wrap");
    const statusSel = statusWrap.createEl("select", { cls: "curator-gj-status" });
    statusSel.setAttribute("aria-label", "游玩状态");
    const curStatus = game.status || "在玩";
    const statusOptions = GAME_STATUS_ORDER.includes(curStatus)
      ? GAME_STATUS_ORDER
      : [curStatus, ...GAME_STATUS_ORDER];
    statusOptions.forEach((s) => statusSel.createEl("option", { value: s, text: s }));
    statusSel.value = curStatus;
    statusWrap.dataset.status = curStatus;
    statusSel.onchange = () => {
      game.status = statusSel.value;
      statusWrap.dataset.status = game.status;
      persist("状态已更新");
    };
    if (game.developer) sub.createSpan({ cls: "curator-gj-dev", text: game.developer });

    const stats = ident.createDiv("curator-gj-stats");
    const makeStat = (label, attrs, suffix, extraCls = "") => {
      const cell = stats.createEl("label", { cls: `curator-gj-stat ${extraCls}`.trim() });
      cell.createSpan({ cls: "curator-gj-stat-label", text: label });
      const box = cell.createDiv("curator-gj-stat-box");
      const input = box.createEl("input", { cls: "curator-gj-stat-input", attr: attrs });
      if (suffix) box.createSpan({ cls: "curator-gj-stat-suffix", text: suffix });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !isImeEnter(ev)) {
          ev.preventDefault();
          input.blur();
        }
      });
      return input;
    };

    const progInput = makeStat(
      "进度",
      { type: "text", placeholder: "还没开始", spellcheck: "false", title: "当前章节 / 路线，新记录会自动带上它" },
      "",
      "is-wide"
    );
    progInput.value = game.currentProgress || "";
    progInput.onchange = () => {
      const v = progInput.value.trim();
      progInput.value = v;
      if (v === String(game.currentProgress || "")) return;
      game.currentProgress = v;
      updateComposerStamp();
      persist("进度已更新");
    };

    const hoursInput = makeStat("时长", { type: "number", min: "0", step: "0.5", inputmode: "decimal" }, "小时");
    hoursInput.addClass("curator-mono");
    hoursInput.value = String(Math.round((Number(game.playHours) || 0) * 100) / 100);
    hoursInput.onchange = () => {
      const v = Math.max(0, Math.round((Number(hoursInput.value) || 0) * 100) / 100);
      hoursInput.value = String(v);
      if (v === Number(game.playHours || 0)) return;
      game.playHours = v;
      updateComposerStamp();
      persist("时长已更新");
    };

    const scoreInput = makeStat("评分", { type: "number", min: "0", max: "10", step: "0.5", inputmode: "decimal" }, "/ 10");
    scoreInput.addClass("curator-mono");
    scoreInput.value = game.score !== undefined && game.score !== null && game.score !== "" ? String(game.score) : "";
    scoreInput.onchange = () => {
      if (scoreInput.value.trim() === "") {
        scoreInput.value = game.score !== undefined && game.score !== null ? String(game.score) : "";
        return;
      }
      const v = Math.min(10, Math.max(0, Math.round((Number(scoreInput.value) || 0) * 10) / 10));
      scoreInput.value = String(v);
      if (v === Number(game.score)) return;
      game.score = v;
      persist("评分已更新");
    };

    const headActions = head.createDiv("curator-gj-head-actions");
    if (String(game.exePath || "").trim() && isDesktopNodeAvailable()) {
      const playBtn = headActions.createEl("button", {
        cls: "curator-gj-btn is-primary curator-gj-play",
        text: game.launchMode === "emulator" ? "▶ 用模拟器启动" : "▶ 继续游戏"
      });
      playBtn.title = "结束游戏后会自动累加本次时长";
      playBtn.onclick = () =>
        launchLocalGameProcess(plugin, game, () => {
          if (hoursInput.isConnected) {
            hoursInput.value = String(Math.round((Number(game.playHours) || 0) * 100) / 100);
            updateComposerStamp();
            flashSaved("已累加本次游玩时长");
          }
          if (typeof onRefresh === "function") onRefresh();
        });
    }

    /* ── 窄屏分段切换（宽屏下隐藏，三块同时可见） ── */
    const tabBar = contentEl.createDiv({ cls: "curator-gj-tabs", attr: { role: "tablist" } });
    const tabBtns = {};
    TABS.forEach((t) => {
      const b = tabBar.createEl("button", { cls: "curator-gj-tab", attr: { role: "tab", type: "button" } });
      b.createSpan({ text: t.label });
      b.createSpan({ cls: "curator-gj-tab-count curator-mono" });
      b.onclick = () => setTab(t.key);
      tabBtns[t.key] = b;
    });

    const bodyEl = contentEl.createDiv("curator-gj-body");
    const mainCol = bodyEl.createDiv("curator-gj-main");
    const sideCol = bodyEl.createDiv("curator-gj-side");

    const panelCounts = {};
    const makePanel = (host, key, title) => {
      const panel = host.createDiv({ cls: "curator-gj-panel", attr: { "data-panel": key } });
      const ph = panel.createDiv("curator-gj-panel-head");
      ph.createSpan({ cls: "curator-gj-panel-title", text: title });
      panelCounts[key] = ph.createSpan({ cls: "curator-gj-panel-count curator-mono" });
      return { panel, head: ph };
    };

    const setTab = (key) => {
      activeTab = key;
      ui.tabByGame[game.id] = key;
      contentEl.dataset.tab = key;
      Object.entries(tabBtns).forEach(([k, b]) => {
        b.classList.toggle("is-active", k === key);
        b.setAttribute("aria-selected", k === key ? "true" : "false");
      });
      bodyEl.scrollTop = 0;
    };

    const refreshCounts = () => {
      const counts = {
        notes: game.playNotes.length,
        todos: game.todos.filter((t) => t && !t.done).length,
        guides: game.strategyUrls.length
      };
      Object.entries(counts).forEach(([k, n]) => {
        const tabCount = tabBtns[k] && tabBtns[k].querySelector(".curator-gj-tab-count");
        if (tabCount) tabCount.textContent = n ? String(n) : "";
        if (panelCounts[k]) {
          panelCounts[k].textContent =
            k === "todos" ? (n ? `${n} 项未完成` : "") : n ? String(n) : "";
        }
      });
    };

    /* ── 手札（主栏）：输入框 + 按进度分组的时间线 ── */
    const { panel: notesPanel } = makePanel(mainCol, "notes", "手札");
    const composer = notesPanel.createDiv("curator-gj-composer");
    const noteInput = composer.createEl("textarea", {
      cls: "curator-gj-composer-input",
      attr: { rows: "2", placeholder: "玩到哪儿、想到什么，随手记一笔…" }
    });
    noteInput.value = ui.drafts[game.id] || "";
    composerEl = noteInput;
    const composerBar = composer.createDiv("curator-gj-composer-bar");
    composerBar.createSpan({ cls: "curator-gj-composer-label", text: "标记" });
    const stampEl = composerBar.createSpan({ cls: "curator-gj-composer-stamp" });
    if (!isMobileEnv()) {
      const isMac = /Mac|iPhone|iPad/i.test(String(navigator.platform || navigator.userAgent || ""));
      composerBar.createSpan({ cls: "curator-gj-composer-hint", text: isMac ? "⌘ Enter" : "Ctrl Enter" });
    }
    const submitNoteBtn = composerBar.createEl("button", { cls: "curator-gj-btn is-primary", text: "记下" });

    const syncSubmitState = () => {
      submitNoteBtn.disabled = !noteInput.value.trim();
    };
    function updateComposerStamp() {
      if (!stampEl.isConnected) return;
      const text = describeGameJournalStamp({
        chapter: String(game.currentProgress || "").trim(),
        hours: Math.max(0, Number(game.playHours) || 0)
      });
      stampEl.textContent = text;
      stampEl.title = `新手札会标记为：${text}（改抬头里的进度和时长即可调整）`;
    }

    const notesList = notesPanel.createDiv("curator-gj-timeline");
    const renderNotes = (opts = {}) => {
      notesList.empty();
      if (!game.playNotes.length) {
        renderEmpty(
          notesList,
          "还没有手札",
          "剧情感想、配装思路、想吐槽的名场面都可以记在这里。每条会自动带上当时的进度和时长，回头翻看就像一份游玩日记。",
          "is-hero"
        );
        return;
      }
      let group = null;
      let lastChapter = null;
      game.playNotes.forEach((n) => {
        if (!n || typeof n !== "object") return;
        const meta = normalizeGameJournalEntry(n);
        const chapterKey = meta.chapter || "";
        if (group === null || chapterKey !== lastChapter) {
          group = notesList.createDiv("curator-gj-chapter");
          group.createDiv({ cls: "curator-gj-chapter-title", text: chapterKey || "未标进度" });
          lastChapter = chapterKey;
        }
        const entry = group.createDiv("curator-gj-note");
        if (opts.freshId && opts.freshId === n.id) entry.addClass("is-fresh");
        const metaRow = entry.createDiv("curator-gj-note-meta");
        if (meta.hours !== null) {
          metaRow.createSpan({ cls: "curator-gj-note-hours curator-mono", text: formatGameHours(meta.hours) });
        }
        metaRow.createSpan({ cls: "curator-gj-note-when", text: formatGameJournalWhen(meta.time, meta.rawTime) });
        if (n.editedAt) metaRow.createSpan({ cls: "curator-gj-note-edited", text: "已编辑" });
        const tools = metaRow.createDiv("curator-gj-row-tools");
        const textEl = entry.createDiv({ cls: "curator-gj-note-text", text: n.text || "" });
        const editBtn = tools.createEl("button", { cls: "curator-gj-tool", text: "编辑" });
        editBtn.onclick = () =>
          beginInlineEdit(textEl, n.text || "", {
            multiline: true,
            onSave: (v) => {
              n.text = v;
              n.editedAt = new Date().toISOString();
              persist("已修改");
            },
            onDone: () => renderNotes()
          });
        const delBtn = tools.createEl("button", { cls: "curator-gj-tool is-danger", text: "删除" });
        armDelete(delBtn, () => {
          game.playNotes = game.playNotes.filter((x) => x !== n);
          renderNotes();
          refreshCounts();
          persist("已删除");
        });
      });
    };

    const submitNote = () => {
      const text = noteInput.value.trim();
      if (!text) {
        noteInput.focus();
        return;
      }
      const id = `gnote-${Date.now()}`;
      game.playNotes.unshift({ id, text, ...buildGameJournalStamp(game) });
      noteInput.value = "";
      ui.drafts[game.id] = "";
      autoGrow(noteInput);
      syncSubmitState();
      renderNotes({ freshId: id });
      refreshCounts();
      persist("已记下");
      mainCol.scrollTop = 0;
    };
    submitNoteBtn.onclick = submitNote;
    noteInput.addEventListener("input", () => {
      ui.drafts[game.id] = noteInput.value;
      autoGrow(noteInput);
      syncSubmitState();
    });
    noteInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !isImeEnter(ev)) {
        ev.preventDefault();
        submitNote();
      }
    });

    /* ── 待办（侧栏上）：一行速记 + 勾选后沉入「已完成」 ── */
    const { panel: todosPanel } = makePanel(sideCol, "todos", "待办");
    const todoAdd = todosPanel.createDiv("curator-gj-quick-add");
    const todoInput = todoAdd.createEl("input", {
      type: "text",
      cls: "curator-gj-quick-input",
      attr: { placeholder: "添加待办，回车确认" }
    });
    const todoAddBtn = todoAdd.createEl("button", { cls: "curator-gj-btn", text: "添加" });
    const todoList = todosPanel.createDiv("curator-gj-checklist");

    const scheduleTodoSettle = () => {
      if (todoSettleTimer) window.clearTimeout(todoSettleTimer);
      todoSettleTimer = window.setTimeout(() => {
        todoSettleTimer = null;
        if (todoList.isConnected) {
          renderTodos();
          refreshCounts();
        }
      }, 420);
    };

    const renderTodoRow = (host, td) => {
      const row = host.createDiv(`curator-gj-todo${td.done ? " is-done" : ""}`);
      const check = row.createEl("label", { cls: "curator-gj-check" });
      const cb = check.createEl("input", { type: "checkbox" });
      cb.checked = Boolean(td.done);
      cb.setAttribute("aria-label", td.text || "待办");
      check.createSpan({ cls: "curator-gj-check-mark" });
      const main = row.createDiv("curator-gj-todo-main");
      const textEl = main.createDiv({ cls: "curator-gj-todo-text", text: td.text || "" });
      const stamp = describeGameJournalStamp(normalizeGameJournalEntry(td));
      if (stamp) main.createDiv({ cls: "curator-gj-todo-meta", text: `记于 ${stamp}` });

      const startEdit = () =>
        beginInlineEdit(textEl, td.text || "", {
          multiline: false,
          onSave: (v) => {
            td.text = v;
            persist("已修改");
          },
          onDone: () => renderTodos()
        });
      textEl.addEventListener("dblclick", startEdit);

      const tools = row.createDiv("curator-gj-row-tools");
      const editBtn = tools.createEl("button", { cls: "curator-gj-tool", text: "编辑" });
      editBtn.onclick = startEdit;
      const delBtn = tools.createEl("button", { cls: "curator-gj-tool is-danger", text: "删除" });
      armDelete(delBtn, () => {
        game.todos = game.todos.filter((x) => x !== td);
        renderTodos();
        refreshCounts();
        persist("已删除");
      });

      cb.onchange = () => {
        td.done = cb.checked;
        if (td.done) td.doneAt = new Date().toISOString();
        else delete td.doneAt;
        row.classList.toggle("is-done", td.done);
        scheduleTodoSettle();
        persist(td.done ? "已完成一项" : "已移回待办");
      };
    };

    function renderTodos() {
      todoList.empty();
      if (!game.todos.length) {
        renderEmpty(todoList, "没有待办", "想回收的结局、还没拿的收集品、下次要打的 Boss，都可以先记在这里。");
        return;
      }
      const open = game.todos.filter((t) => t && !t.done);
      const done = game.todos.filter((t) => t && t.done);
      open.forEach((td) => renderTodoRow(todoList, td));
      if (!open.length) todoList.createDiv({ cls: "curator-gj-allclear", text: "都完成了 ✓" });
      if (done.length) {
        const fold = todoList.createEl("details", { cls: "curator-gj-done-fold" });
        fold.open = Boolean(ui.showDone);
        fold.createEl("summary", { text: `已完成 ${done.length}` });
        fold.addEventListener("toggle", () => {
          ui.showDone = fold.open;
        });
        done.forEach((td) => renderTodoRow(fold, td));
      }
    }

    const addTodo = () => {
      const text = todoInput.value.trim();
      if (!text) {
        todoInput.focus();
        return;
      }
      game.todos.unshift({ id: `todo-${Date.now()}`, text, done: false, ...buildGameJournalStamp(game) });
      todoInput.value = "";
      renderTodos();
      refreshCounts();
      persist("已添加待办");
      todoInput.focus();
    };
    todoAddBtn.onclick = addTodo;
    todoInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !isImeEnter(ev)) {
        ev.preventDefault();
        addTodo();
      }
    });

    /* ── 攻略（侧栏下）：链接列表 + 折叠的添加 / 编辑表单 ── */
    const { panel: guidesPanel, head: guidesHead } = makePanel(sideCol, "guides", "攻略");
    guidesHead.addClass("has-action");
    const addGuideBtn = guidesHead.createEl("button", {
      cls: "curator-gj-tool curator-gj-panel-action",
      text: "＋ 添加链接"
    });

    const guideForm = guidesPanel.createDiv("curator-gj-guide-form");
    guideForm.style.display = "none";
    const gUrl = guideForm.createEl("input", {
      type: "text",
      cls: "curator-gj-quick-input",
      attr: { placeholder: "链接，例如 https://wiki.biligame.com/…", inputmode: "url", spellcheck: "false" }
    });
    const TITLE_PH = "标题（可不填，默认显示网站名）";
    const gTitle = guideForm.createEl("input", {
      type: "text",
      cls: "curator-gj-quick-input",
      attr: { placeholder: TITLE_PH }
    });
    const gRemark = guideForm.createEl("input", {
      type: "text",
      cls: "curator-gj-quick-input",
      attr: { placeholder: "备注（可选），比如：第三章迷宫走法" }
    });
    const formRow = guideForm.createDiv("curator-gj-guide-form-row");
    const spoilerLabel = formRow.createEl("label", { cls: "curator-gj-spoiler-toggle" });
    const gSpoiler = spoilerLabel.createEl("input", { type: "checkbox" });
    spoilerLabel.createSpan({ text: "备注含剧透，默认遮住" });
    const gCancel = formRow.createEl("button", { cls: "curator-gj-btn is-quiet", text: "取消" });
    const gSave = formRow.createEl("button", { cls: "curator-gj-btn is-primary", text: "保存" });

    let editingGuide = null;
    const openGuideForm = (g = null) => {
      editingGuide = g;
      gUrl.value = g ? g.url || "" : "";
      gTitle.value = g && g.title && g.title !== g.url && g.title !== getGuideHostname(g.url) ? g.title : "";
      gRemark.value = g ? g.remark || "" : "";
      gSpoiler.checked = Boolean(g && g.spoiler);
      gUrl.classList.remove("is-invalid");
      gTitle.placeholder = TITLE_PH;
      gSave.textContent = g ? "保存修改" : "保存";
      guideForm.style.display = "";
      addGuideBtn.style.visibility = "hidden";
      gUrl.focus();
    };
    const closeGuideForm = () => {
      editingGuide = null;
      guideForm.style.display = "none";
      addGuideBtn.style.visibility = "";
    };
    addGuideBtn.onclick = () => openGuideForm(null);
    gCancel.onclick = closeGuideForm;
    gUrl.addEventListener("input", () => {
      gUrl.classList.remove("is-invalid");
      const host = getGuideHostname(normalizeGuideUrl(gUrl.value));
      gTitle.placeholder = host ? `标题（不填则显示 ${host}）` : TITLE_PH;
    });
    const saveGuide = () => {
      const url = normalizeGuideUrl(gUrl.value);
      if (!url) {
        gUrl.classList.add("is-invalid");
        gUrl.focus();
        return;
      }
      const payload = {
        title: gTitle.value.trim() || getGuideHostname(url) || url,
        url,
        remark: gRemark.value.trim()
      };
      const wasEditing = Boolean(editingGuide);
      if (editingGuide) {
        Object.assign(editingGuide, payload);
        if (gSpoiler.checked) editingGuide.spoiler = true;
        else delete editingGuide.spoiler;
      } else {
        const record = { id: `guide-${Date.now()}`, ...payload };
        if (gSpoiler.checked) record.spoiler = true;
        game.strategyUrls.push(record);
      }
      closeGuideForm();
      renderGuides();
      refreshCounts();
      persist(wasEditing ? "已修改" : "已添加攻略");
    };
    gSave.onclick = saveGuide;
    [gUrl, gTitle, gRemark].forEach((inp) =>
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !isImeEnter(ev)) {
          ev.preventDefault();
          saveGuide();
        }
      })
    );

    const guideList = guidesPanel.createDiv("curator-gj-guide-list");
    function renderGuides() {
      guideList.empty();
      if (!game.strategyUrls.length) {
        renderEmpty(guideList, "还没收藏攻略", "把常看的 Wiki、攻略帖、地图站放在这里，玩的时候一点就开。");
        return;
      }
      game.strategyUrls.forEach((g) => {
        if (!g || typeof g !== "object") return;
        const row = guideList.createDiv("curator-gj-guide");
        const bodyBox = row.createDiv("curator-gj-guide-body");
        const host = getGuideHostname(g.url);
        const titleText = g.title || host || g.url || "未命名链接";
        const link = bodyBox.createEl("a", { cls: "curator-gj-guide-link", href: g.url || "#" });
        link.createSpan({ cls: "curator-gj-guide-title", text: titleText });
        link.title = g.url || "";
        link.onclick = (ev) => {
          ev.preventDefault();
          if (g.url) window.open(g.url, "_blank");
        };
        const subLine = bodyBox.createDiv("curator-gj-guide-sub");
        if (host && host !== titleText) subLine.createSpan({ cls: "curator-gj-guide-host", text: host });
        if (g.remark) {
          if (subLine.childElementCount) subLine.createSpan({ cls: "curator-gj-guide-sep", text: "·" });
          const remark = subLine.createSpan("curator-gj-guide-remark");
          if (g.spoiler) {
            remark.addClass("is-spoiler");
            remark.textContent = "含剧透的备注 · 点按显示";
            remark.onclick = () => {
              const reveal = !remark.classList.contains("is-revealed");
              remark.classList.toggle("is-revealed", reveal);
              remark.textContent = reveal ? g.remark : "含剧透的备注 · 点按显示";
            };
          } else {
            remark.textContent = g.remark;
          }
        }
        if (!subLine.childElementCount) subLine.remove();
        const tools = row.createDiv("curator-gj-row-tools");
        const editBtn = tools.createEl("button", { cls: "curator-gj-tool", text: "编辑" });
        editBtn.onclick = () => openGuideForm(g);
        const delBtn = tools.createEl("button", { cls: "curator-gj-tool is-danger", text: "删除" });
        armDelete(delBtn, () => {
          game.strategyUrls = game.strategyUrls.filter((x) => x !== g);
          if (editingGuide === g) closeGuideForm();
          renderGuides();
          refreshCounts();
          persist("已删除");
        });
      });
    }

    /* ── 底栏：Markdown 同步位置 · 保存反馈 · 打开笔记 ── */
    const foot = contentEl.createDiv("curator-gj-foot");
    const relPath = getGameNoteRelPath(plugin, game);
    foot.createSpan({ cls: "curator-gj-foot-path", text: `自动同步到 ${relPath}` });
    savedEl = foot.createSpan({ cls: "curator-gj-saved", attr: { "aria-live": "polite" } });
    const openNoteBtn = foot.createEl("button", { cls: "curator-gj-btn is-quiet", text: "在笔记中打开" });
    openNoteBtn.onclick = async () => {
      await saveChain;
      await syncGameMarkdownNote(plugin, game);
      modal.close();
      try {
        const f = plugin.app?.vault?.getAbstractFileByPath?.(relPath);
        if (f) await plugin.app.workspace.getLeaf(true).openFile(f);
        else await plugin.app.workspace.openLinkText(relPath, "", true);
      } catch (_) {
        if (Notice) new Notice(`没有找到游戏笔记：${relPath}`);
      }
    };

    setTab(activeTab);
    updateComposerStamp();
    syncSubmitState();
    renderNotes();
    renderTodos();
    renderGuides();
    refreshCounts();
    window.requestAnimationFrame(() => autoGrow(noteInput));
  };

  modal.onClose = () => {
    if (composerEl) ui.drafts[game.id] = composerEl.value;
    composerEl = null;
    if (savedTimer) window.clearTimeout(savedTimer);
    if (todoSettleTimer) window.clearTimeout(todoSettleTimer);
    savedEl = null;
    modal.contentEl.empty();
    if (dirty && typeof onRefresh === "function") {
      saveChain.then(() => onRefresh());
    }
  };

  modal.open();
}

function renderGameLibraryWorkspace(plugin, container, vaultAnimeItems = [], options = {}) {
  container.empty();
  container.addClass("curator-game-workspace");

  if (!plugin.__gameWorkspaceState) {
    plugin.__gameWorkspaceState = {
      searchQuery: "",
      statusFilter: "all",
      showAddDrawer: false
    };
  }
  const uiState = plugin.__gameWorkspaceState;
  if (options.searchQuery !== undefined) {
    uiState.searchQuery = options.searchQuery;
  }

  const syncBadge = () => {
    const allGames = Array.isArray(plugin.settings?.gameCollection)
      ? plugin.settings.gameCollection
      : [];
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-game-badge"]')
        .forEach((el) => {
          el.textContent = String(allGames.length);
        });
    }
  };
  syncBadge();

  const v07Game = require("./v07-game-ui.js");
  const v07Adapters = require("./v07-adapters.js");
  const gameApi = require("./game-multisource-api.js");
  const mobile = isMobileEnv();

  if (uiState.showAddDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer bm7-add-game-drawer");
    const topBar = drawer.createDiv("curator-char-draft-row");
    topBar.style.justifyContent = "space-between";
    topBar.style.alignItems = "center";
    topBar.createDiv({
      cls: "curator-char-add-title",
      text: "添加游戏（支持 Bangumi / VNDB / Steam / 月幕 多数据源搜索词条与封面）"
    });
    const closeDrawerBtn = topBar.createEl("button", {
      cls: "curator-btn",
      text: "收起"
    });
    closeDrawerBtn.onclick = () => {
      uiState.showAddDrawer = false;
      renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
    };

    const gsrcMount = drawer.createDiv("curator-game-bgm-picker-mount");
    gsrcMount.style.marginBottom = "10px";

    const row1 = drawer.createDiv("curator-char-draft-row");
    const titleIn = row1.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "游戏名称（可直接填写，或在上方多源搜索一键套用）"
    });
    titleIn.style.flex = "2";

    const statusSelect = row1.createEl("select", { cls: "curator-sort-select" });
    ["在玩", "想玩", "通关", "全成就", "搁置"].forEach((st) =>
      statusSelect.createEl("option", { value: st, text: `状态：${st}` })
    );

    const modeSelect = row1.createEl("select", { cls: "curator-sort-select" });
    [
      { val: "exe", text: "PC 直装 / Steam / 主机记录" },
      { val: "emulator", text: "模拟器 + ROM 镜像启动" }
    ].forEach((m) => modeSelect.createEl("option", { value: m.val, text: m.text }));
    if (mobile) modeSelect.style.display = "none";

    const row2 = drawer.createDiv("curator-char-draft-row");
    if (mobile) row2.style.display = "none";
    const exeIn = row2.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "启动程序 .exe 路径 / 模拟器路径 / steam://rungameid/...（可选）"
    });
    exeIn.style.flex = "2";
    if (!mobile) {
      const browseExeBtn = row2.createEl("button", {
        cls: "curator-btn",
        text: "浏览程序..."
      });
      browseExeBtn.onclick = () => {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept = ".exe,.lnk,.bat,.cmd,.url";
        fi.onchange = () => {
          const f = fi.files && fi.files[0];
          const fPath = getNativeFilePath(f);
          if (fPath) {
            exeIn.value = fPath;
            if (!titleIn.value.trim()) {
              titleIn.value = path.basename(path.dirname(fPath));
            }
          }
        };
        fi.click();
      };
    }

    const rowRom = drawer.createDiv("curator-char-draft-row");
    rowRom.style.display = "none";
    const romIn = rowRom.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "ROM 镜像文件路径（如 .nsp / .xci / .iso / .gba / .nds）"
    });
    romIn.style.flex = "2";
    if (!mobile) {
      const browseRomBtn = rowRom.createEl("button", {
        cls: "curator-btn",
        text: "浏览 ROM..."
      });
      browseRomBtn.onclick = () => {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.onchange = () => {
          const f = fi.files && fi.files[0];
          const fPath = getNativeFilePath(f);
          if (fPath) {
            romIn.value = fPath;
            if (!titleIn.value.trim()) {
              titleIn.value = path.basename(fPath, path.extname(fPath));
            }
          }
        };
        fi.click();
      };
    }

    modeSelect.onchange = () => {
      rowRom.style.display = !mobile && modeSelect.value === "emulator" ? "flex" : "none";
    };

    const row3 = drawer.createDiv("curator-char-draft-row");
    const coverIn = row3.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "封面图片 URL 或本地路径"
    });
    coverIn.style.flex = "2";
    const devIn = row3.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "开发商 / 社团（可选）"
    });
    const scoreIn = row3.createEl("input", {
      type: "number",
      cls: "curator-input curator-mono",
      placeholder: "评分 (1-10)"
    });
    scoreIn.style.width = "100px";
    scoreIn.value = "";

    let pickedSteamAspect = "";
    v07Game.renderGameSourceSearch(gsrcMount, {
      initialQuery: "",
      source: "all",
      search: v07Adapters.searchGameSourcesAdapter,
      onPickCover: async (cand) => {
        const enriched = cand._raw ? await gameApi.enrichGameCandidateDetail(cand._raw) : cand;
        if (enriched.coverUrl || cand.cover) coverIn.value = enriched.coverUrl || cand.cover;
        if ((enriched.developer || cand.developer) && !devIn.value.trim()) {
          devIn.value = enriched.developer || cand.developer;
        }
        if (Notice) new Notice(`已选用《${cand.title}》的封面`);
      },
      onPickFull: async (cand) => {
        const enriched = cand._raw ? await gameApi.enrichGameCandidateDetail(cand._raw) : cand;
        if (cand.title) titleIn.value = cand.title;
        if (enriched.coverUrl || cand.cover) coverIn.value = enriched.coverUrl || cand.cover;
        if (enriched.developer || cand.developer) devIn.value = enriched.developer || cand.developer;
        if (cand.score && !scoreIn.value) scoreIn.value = String(cand.score);
        if (cand.source === "steam" && enriched.steamAppId && !exeIn.value.trim()) {
          exeIn.value = `steam://rungameid/${enriched.steamAppId}`;
        }
        pickedSteamAspect = "";
        if (Notice) new Notice(`已套用词条：《${cand.title}》`);
      }
    });

    const submitRow = drawer.createDiv("curator-char-draft-actions");
    const cancelBtn = submitRow.createEl("button", {
      cls: "curator-btn",
      text: "取消"
    });
    cancelBtn.onclick = () => {
      uiState.showAddDrawer = false;
      renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
    };
    const saveGameBtn = submitRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "保存并加入游戏典藏"
    });
    saveGameBtn.onclick = async () => {
      const title = titleIn.value.trim() || "未命名游戏";
      const parsedScore = scoreIn.value.trim() ? Number(scoreIn.value) : null;
      const record = {
        id: `game-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        launchMode: modeSelect.value,
        exePath: exeIn.value.trim(),
        romPath: romIn.value.trim(),
        launchArgs: "",
        coverUrl: coverIn.value.trim(),
        developer: devIn.value.trim(),
        status: statusSelect.value || "在玩",
        score: Number.isFinite(parsedScore) && parsedScore > 0 ? parsedScore : null,
        playHours: 0,
        playSessions: [],
        currentProgress: "初见",
        todos: [],
        playNotes: [],
        strategyUrls: [],
        createdAt: new Date().toISOString()
      };
      if (pickedSteamAspect) record.coverAspect = pickedSteamAspect;
      if (!Array.isArray(plugin.settings.gameCollection)) {
        plugin.settings.gameCollection = [];
      }
      plugin.settings.gameCollection.unshift(record);
      await syncGameMarkdownNote(plugin, record);
      await plugin.saveSettings();
      uiState.showAddDrawer = false;
      syncBadge();
      if (Notice) new Notice(`已将《${title}》收入游戏典藏并同步本地笔记`);
      renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
    };

    requestAnimationFrame(() => {
      if (drawer.isConnected && typeof drawer.scrollIntoView === "function") {
        drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  const stageHost = container.createDiv("curator-game-v07-host");
  const themeRoot = container.closest(".curator-desk-root") || container;
  const rerenderWorkspace = () => {
    syncBadge();
    renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
  };
  const ctx = Object.assign(
    v07Adapters.createGameStageContext(plugin, vaultAnimeItems, rerenderWorkspace, {
      searchQuery: uiState.searchQuery || "",
      wandCallbacks: options.wandCallbacks
    }),
    { themeRoot }
  );
  v07Game.renderGameStage(stageHost, ctx);
}

/**
 * 注入四大新馆藏能力与魔杖长按星轨关联的专属样式
 */
function getMultiHallStyles() {
  return `
/* 🪄 长按蓄力水波纹与跨馆关联模态框 */
.is-wand-charging {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
}
.curator-wand-charge-ripple {
  position: absolute;
  width: 28px;
  height: 28px;
  margin-left: -14px;
  margin-top: -14px;
  border-radius: 50%;
  border: 2.5px solid #59b4ff;
  background: radial-gradient(circle, rgba(89,180,255,0.35) 0%, rgba(89,180,255,0) 70%);
  pointer-events: none;
  z-index: 40;
  animation: curatorWandChargeAnim 0.43s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes curatorWandChargeAnim {
  0% { transform: scale(0.3); opacity: 0.9; }
  100% { transform: scale(2.8); opacity: 0; }
}
.curator-magic-wand-modal {
  max-width: 760px;
}
.curator-wand-kicker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.curator-wand-kicker {
  font-size: 11.5px;
  font-weight: 700;
  color: #3b6998;
  letter-spacing: 0.06em;
}
.curator-wand-type-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 105, 152, 0.12);
  color: #3b6998;
}
.curator-wand-title {
  margin: 2px 0 4px 0;
  font-size: 20px;
}
.curator-wand-sub {
  font-size: 12.5px;
  opacity: 0.75;
  margin-bottom: 12px;
}
.curator-wand-quick-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.curator-wand-section {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--background-modifier-border);
}
.curator-wand-sec-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}
.curator-wand-chips-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}
.curator-wand-item-card {
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary-alt, rgba(255,255,255,0.03));
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.curator-wand-item-card:hover {
  transform: translateY(-2px);
  border-color: #4898e0;
}
.curator-wand-item-main {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 3px;
}
.curator-wand-item-meta {
  font-size: 11.5px;
  opacity: 0.76;
}

/* 🖼️ 多馆工作台统一顶栏、搜索抽屉与画册控制栏美学样式 */
.curator-illust-workspace,
.curator-voice-workspace,
.curator-game-workspace {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.curator-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, #8f683d 26%, var(--background-modifier-border));
  background: color-mix(in srgb, var(--background-secondary) 68%, #f7f1e6 32%);
}
.curator-char-kicker {
  font-size: 9.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}
.curator-char-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.curator-char-title {
  margin: 0;
  font-size: 1.15em;
  font-weight: 800;
  color: var(--text-normal);
}
.curator-char-count-badge {
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, #8f683d 14%, var(--background-primary));
  border: 1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));
  color: var(--text-muted);
}
.curator-char-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.curator-char-search-input {
  min-width: 210px;
}
.curator-char-add-drawer {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #8f683d 30%, var(--background-modifier-border));
  background: color-mix(in srgb, var(--background-primary) 92%, #f6efe3 8%);
  box-shadow: 0 4px 14px rgba(28, 20, 12, 0.05);
}
.curator-char-add-searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.curator-char-kw-input {
  flex: 1 1 240px;
  min-width: 200px;
}
.curator-photowall-ctrls .curator-dl-mini-btn.is-active {
  background: color-mix(in srgb, #8f683d 20%, var(--background-secondary)) !important;
  border-color: #8f683d !important;
  color: var(--text-normal) !important;
  font-weight: 700;
}

/* 🖼️ 画册典藏阁在线搜图台 */
.curator-illust-path-config-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12.5px;
}
.curator-illust-size-config-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--background-secondary-alt, rgba(59, 105, 152, 0.06));
  font-size: 12px;
}
.curator-illust-size-config-label {
  font-weight: 600;
}
.curator-illust-expanded-kw-badge {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 105, 152, 0.14);
  color: var(--text-accent, #3b6998);
}
.curator-illust-ai-toggle.is-active {
  border-color: rgba(59, 105, 152, 0.45);
  background: rgba(59, 105, 152, 0.14);
  font-weight: 600;
}
.curator-illust-online-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
  gap: 12px;
  margin-top: 10px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}
.curator-illust-online-card {
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--background-primary);
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.curator-illust-online-card:hover {
  border-color: rgba(72, 152, 224, 0.65);
}
.curator-illust-online-imgbox {
  position: relative;
  height: 220px;
  background: rgba(15, 20, 30, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: zoom-in;
  padding: 4px;
}
.curator-illust-online-imgbox img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 4px;
}
.curator-illust-dim-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(18, 22, 32, 0.76);
  color: #fff;
  pointer-events: none;
}
.curator-illust-online-info {
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}
.curator-illust-online-title {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.curator-illust-online-sub {
  font-size: 11px;
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.curator-illust-card-size-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.curator-illust-card-tier-select {
  width: 100%;
  font-size: 11.5px;
  padding: 2px 6px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}
.curator-illust-byte-badge {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
  background: var(--background-secondary-alt, rgba(0,0,0,0.03));
  padding: 3px 6px;
  border-radius: 5px;
}
.curator-illust-r18-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(196, 43, 62, 0.9);
  color: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  z-index: 3;
}
/* Aves 精确等高对齐照片墙（禁用弹性尾项撑宽，保证卡片宽高比 100% 贴合原图无空边） */
.curator-char-photowall-grid.is-aves-justified {
  align-items: flex-start;
  justify-content: flex-start;
}
.curator-char-photowall-grid.is-aves-justified::after {
  display: none !important;
  content: none !important;
}
.curator-illust-tile-topactions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  pointer-events: auto;
}
.curator-char-photowall-cropbtn.is-danger-hover:hover,
.curator-char-photowall-cropbtn.is-armed {
  background: #b83b3b !important;
  border-color: #ffd2d2 !important;
  color: #fff !important;
  opacity: 1 !important;
  transform: scale(1) !important;
}
.curator-illust-broken-fallback {
  font-size: 12px;
  color: var(--text-muted);
  padding: 12px;
  text-align: center;
}
.modal:has(.curator-illust-lightbox-modal) {
  width: min(980px, 94vw) !important;
  max-width: 980px !important;
}
.curator-illust-lb-head {
  margin-bottom: 6px;
}
.curator-illust-lb-h3row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.curator-illust-lb-h3row h3 {
  margin: 0 0 4px 0;
  font-size: 17px;
}
.curator-illust-lb-counter {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--background-secondary);
  color: var(--text-muted);
  flex-shrink: 0;
}
.curator-illust-lb-meta {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}
.curator-illust-lb-editbox {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
}
.curator-illust-lb-stage {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  min-height: 220px;
}
.curator-illust-lb-nav {
  cursor: pointer;
  width: 36px;
  height: 52px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: 24px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.16s ease;
}
.curator-illust-lb-nav:hover {
  border-color: #9e784b;
  background: var(--background-modifier-hover);
  color: #9e784b;
}
.curator-illust-lb-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.curator-illust-danger-btn:hover {
  border-color: #c43b3b !important;
  color: #c43b3b !important;
}
.curator-illust-danger-btn.is-confirming {
  background: #b83b3b !important;
  border-color: #b83b3b !important;
  color: #fff !important;
  font-weight: 700;
}

/* 🎙️ 台词音声阁与智能字幕截取台 */
.curator-voice-slicer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
}
.curator-voice-pad-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.curator-voice-cue-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.curator-voice-cue-listbox {
  max-height: 290px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.curator-voice-cue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12.5px;
}
.curator-voice-cue-row:hover {
  background: var(--background-modifier-hover);
}
.curator-voice-cue-time {
  font-size: 11.5px;
  opacity: 0.75;
  flex-shrink: 0;
}
.curator-voice-cue-speaker {
  font-size: 11.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(59, 105, 152, 0.14);
  flex-shrink: 0;
}
.curator-voice-cue-text {
  flex: 1;
}
.curator-voice-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
  margin-top: 10px;
}
.curator-voice-card {
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--background-primary);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.curator-voice-quote-text {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.curator-voice-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11.5px;
}
.curator-voice-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--background-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.curator-voice-actions-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: auto;
  min-width: 0;
}

/* 🎮 游戏典藏 */
.curator-game-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 248px), 1fr));
  gap: 14px;
  margin-top: 10px;
}
.curator-game-card {
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--background-primary);
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.curator-game-card:hover {
  border-color: color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));
  box-shadow: 0 6px 18px rgba(24, 18, 12, 0.08);
}
.curator-game-cover-box {
  position: relative;
  height: 148px;
  background: rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.curator-game-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.curator-game-cover-fallback {
  font-size: 38px;
}
.curator-game-status-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  background: rgba(24, 30, 44, 0.82);
  color: #fff;
  cursor: pointer;
  z-index: 2;
}
.curator-game-top-remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(18, 22, 30, 0.68);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  z-index: 2;
}
.curator-game-card:hover .curator-game-top-remove-btn,
.curator-game-top-remove-btn:focus-visible,
.curator-game-top-remove-btn.is-armed {
  opacity: 1;
}
.curator-game-top-remove-btn:hover,
.curator-game-top-remove-btn.is-armed {
  background: #b83b3b !important;
  border-color: #ffd2d2 !important;
  color: #fff !important;
}
.curator-game-card-body {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.curator-game-card-title {
  font-weight: 700;
  font-size: 14px;
  line-height: 1.38;
  overflow-wrap: anywhere;
}
.curator-game-card-meta, .curator-game-card-counts {
  font-size: 11.5px;
  opacity: 0.8;
  min-width: 0;
}
.curator-game-quick-guides {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}
.curator-game-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
  min-width: 0;
}
.curator-game-card-actions .curator-btn {
  flex: 1 1 102px;
  min-width: 0;
  justify-content: center;
  white-space: nowrap;
  padding-left: 10px;
  padding-right: 10px;
}

@container curator-desk (max-width: 780px) {
  .curator-char-header {
    flex-direction: column;
    align-items: stretch;
    gap: 9px;
  }
  .curator-char-header-right {
    width: 100%;
  }
  .curator-char-search-input {
    flex: 1 1 180px;
    min-width: 0;
  }
  .curator-photowall-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
@container curator-desk (max-width: 520px) {
  .curator-game-top-remove-btn {
    opacity: 0.88;
  }
  .curator-game-cards-grid,
  .curator-voice-cards-grid,
  .curator-illust-online-grid {
    grid-template-columns: 1fr;
  }
}
/* 🎮 Bangumi 游戏封面与词条候选选择器（.curator-game-bgm-*） */
.curator-game-bgm-picker {
  margin: 4px 0 8px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, #8f683d 36%, var(--background-modifier-border));
  background: color-mix(in srgb, var(--background-secondary) 65%, var(--background-primary));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.curator-game-bgm-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.curator-game-bgm-picker-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-normal);
}
.curator-game-bgm-picker-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.curator-game-bgm-picker-bar .curator-input {
  flex: 1 1 200px;
  min-width: 0;
  height: 28px;
  font-size: 12.5px;
}
.curator-game-bgm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 8px;
  max-height: 290px;
  overflow-y: auto;
  padding-right: 4px;
}
.curator-game-bgm-card {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 9px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  align-items: start;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.curator-game-bgm-card:hover {
  border-color: color-mix(in srgb, #8f683d 55%, var(--background-modifier-border));
  box-shadow: 0 3px 10px rgba(40, 28, 14, 0.08);
}
.curator-game-bgm-card.is-exact {
  border-color: #8f683d;
  background: color-mix(in srgb, #8f683d 6%, var(--background-primary));
}
.curator-game-bgm-thumb {
  width: 54px;
  aspect-ratio: 3 / 4;
  border-radius: 5px;
  overflow: hidden;
  background: var(--background-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text-faint);
}
.curator-game-bgm-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.curator-game-bgm-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.curator-game-bgm-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.curator-game-bgm-name {
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-normal);
  overflow-wrap: anywhere;
}
.curator-game-bgm-exact-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(143, 104, 61, 0.16);
  color: #8f683d;
}
.curator-game-bgm-orig {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.curator-game-bgm-meta {
  font-size: 11px;
  color: var(--text-muted);
}
.curator-game-bgm-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.curator-game-edit-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.curator-game-edit-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.curator-game-edit-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 🎮 游戏手札弹窗（.curator-gj-*）—— 暖宣纸 + 黄铜，跟随 Obsidian 亮/暗主题 */
.modal.curator-gj-shell {
  --gj-brass: #8f683d;
  --gj-on-brass: #fffdf9;
  --gj-brass-soft: color-mix(in srgb, #8f683d 12%, transparent);
  --gj-paper: color-mix(in srgb, var(--background-primary) 90%, #f3e6cf 10%);
  --gj-line: color-mix(in srgb, #8f683d 20%, var(--background-modifier-border));
  --gj-side: color-mix(in srgb, var(--background-secondary) 55%, var(--background-primary));
  --gj-danger: #b54a3c;
  width: min(900px, 94vw);
  max-width: 900px;
  height: min(780px, 88vh);
  max-height: 88vh;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.theme-dark .modal.curator-gj-shell {
  --gj-brass: #cfa874;
  --gj-on-brass: #1f1a12;
  --gj-brass-soft: color-mix(in srgb, #cfa874 14%, transparent);
  --gj-paper: color-mix(in srgb, var(--background-primary) 93%, #5a4630 7%);
  --gj-line: color-mix(in srgb, #cfa874 16%, var(--background-modifier-border));
  --gj-danger: #e2806f;
}
.modal.curator-gj-shell .modal-title:empty,
.modal.curator-gj-shell .modal-header:empty {
  display: none;
}
.modal.curator-gj-shell .modal-close-button {
  top: 14px;
  right: 14px;
  z-index: 4;
}
.is-phone .modal.curator-gj-shell {
  width: 100vw;
  max-width: 100vw;
  height: 100%;
  max-height: 100%;
  border-radius: 0;
}
.modal.curator-gj-shell .modal-content.curator-gj {
  container-type: inline-size;
  container-name: curator-gj;
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--background-primary);
  color: var(--text-normal);
}

/* 抬头 */
.curator-gj-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 16px;
  padding: 20px 56px 16px 22px;
  background: linear-gradient(180deg, var(--gj-paper), var(--background-primary));
  border-bottom: 1px solid var(--gj-line);
}
.curator-gj-cover {
  align-self: start;
  width: 64px;
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  overflow: hidden;
  background: var(--background-secondary);
  box-shadow: 0 0 0 1px var(--gj-line), 0 4px 12px rgba(40, 28, 14, 0.14);
}
.curator-gj-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.curator-gj-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  color: var(--gj-brass);
  background: var(--gj-brass-soft);
}
.curator-gj-ident {
  min-width: 0;
}
.curator-gj-title {
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.curator-gj-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.curator-gj-status-wrap {
  --gj-st: var(--gj-brass);
  position: relative;
  display: inline-flex;
}
.curator-gj-status-wrap[data-status="通关"],
.curator-gj-status-wrap[data-status="全成就"] { --gj-st: #3a7d5c; }
.curator-gj-status-wrap[data-status="想玩"] { --gj-st: #3b6998; }
.curator-gj-status-wrap[data-status="搁置"] { --gj-st: var(--text-muted); }
.theme-dark .curator-gj-status-wrap[data-status="通关"],
.theme-dark .curator-gj-status-wrap[data-status="全成就"] { --gj-st: #7cc29d; }
.theme-dark .curator-gj-status-wrap[data-status="想玩"] { --gj-st: #8db6e3; }
.curator-gj-status-wrap::after {
  content: "▾";
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-52%);
  font-size: 10px;
  color: var(--gj-st);
  pointer-events: none;
}
.curator-gj-shell select.curator-gj-status {
  -webkit-appearance: none;
  appearance: none;
  height: 22px;
  padding: 0 22px 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--gj-st) 35%, transparent);
  background: color-mix(in srgb, var(--gj-st) 12%, transparent);
  background-image: none;
  box-shadow: none;
  color: var(--gj-st);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
}
.curator-gj-shell select.curator-gj-status:focus-visible {
  box-shadow: 0 0 0 3px var(--gj-brass-soft);
}
.curator-gj-dev {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.curator-gj-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin-top: 12px;
}
.curator-gj-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  cursor: text;
}
.curator-gj-stat.is-wide {
  flex: 1 1 180px;
  max-width: 300px;
}
.curator-gj-stat-label {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.06em;
}
.curator-gj-stat-box {
  display: flex;
  align-items: baseline;
  gap: 4px;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.15s ease;
}
.curator-gj-stat:hover .curator-gj-stat-box {
  border-bottom-color: var(--gj-line);
}
.curator-gj-stat .curator-gj-stat-box:focus-within {
  border-bottom: 1px solid var(--gj-brass);
}
.curator-gj-shell .curator-gj-stat input.curator-gj-stat-input,
.curator-gj-shell .curator-gj-stat input.curator-gj-stat-input:hover,
.curator-gj-shell .curator-gj-stat input.curator-gj-stat-input:focus {
  width: 4em;
  min-width: 0;
  height: auto;
  padding: 1px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text-normal);
  font-size: 14.5px;
  font-weight: 600;
}
.curator-gj-shell .curator-gj-stat.is-wide input.curator-gj-stat-input {
  width: 100%;
}
@supports (field-sizing: content) {
  .curator-gj-shell .curator-gj-stat:not(.is-wide) input.curator-gj-stat-input {
    width: auto;
    min-width: 2ch;
    max-width: 6em;
    field-sizing: content;
  }
}
.curator-gj-stat input.curator-gj-stat-input::placeholder {
  color: var(--text-faint);
  font-weight: 400;
}
.curator-gj-stat input::-webkit-inner-spin-button,
.curator-gj-stat input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.curator-gj-stat input[type="number"] {
  -moz-appearance: textfield;
}
.curator-gj-stat-suffix {
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.curator-gj-head-actions {
  align-self: end;
  display: flex;
  gap: 8px;
}

/* 通用按钮 */
.curator-gj-shell button.curator-gj-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  border: 1px solid var(--gj-line);
  background: var(--background-primary);
  box-shadow: none;
  color: var(--text-normal);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}
.curator-gj-shell button.curator-gj-btn:hover {
  border-color: var(--gj-brass);
  color: var(--gj-brass);
}
.curator-gj-shell button.curator-gj-btn.is-primary {
  border-color: var(--gj-brass);
  background: var(--gj-brass);
  color: var(--gj-on-brass);
}
.curator-gj-shell button.curator-gj-btn.is-primary:hover {
  background: color-mix(in srgb, var(--gj-brass) 86%, var(--text-normal));
  color: var(--gj-on-brass);
}
.curator-gj-shell button.curator-gj-btn.is-primary:disabled {
  opacity: 0.4;
  cursor: default;
  background: var(--gj-brass);
}
.curator-gj-shell button.curator-gj-btn.is-quiet {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
}
.curator-gj-shell button.curator-gj-btn.is-quiet:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.curator-gj-shell button.curator-gj-play {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
}
.curator-gj-shell button.curator-gj-tool {
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  box-shadow: none;
  color: var(--text-muted);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
}
.curator-gj-shell button.curator-gj-tool:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.curator-gj-shell button.curator-gj-tool.is-danger:hover,
.curator-gj-shell button.curator-gj-tool.is-armed {
  color: var(--gj-danger);
  background: color-mix(in srgb, var(--gj-danger) 12%, transparent);
}

/* 窄屏分段切换（宽屏隐藏） */
.curator-gj-tabs {
  display: none;
  gap: 4px;
  padding: 4px 12px 0;
  border-bottom: 1px solid var(--gj-line);
}
.curator-gj-shell button.curator-gj-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: auto;
  padding: 9px 4px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--text-muted);
  font-size: 13.5px;
  cursor: pointer;
}
.curator-gj-shell button.curator-gj-tab.is-active {
  color: var(--text-normal);
  font-weight: 600;
  border-bottom-color: var(--gj-brass);
}
.curator-gj-tab-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--background-secondary);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 17px;
}
.curator-gj-tab-count:empty {
  display: none;
}

/* 主体：宽屏双栏，各自滚动 */
.curator-gj-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(250px, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}
.curator-gj-main,
.curator-gj-side {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.curator-gj-main {
  padding: 18px 22px 32px;
}
.curator-gj-side {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 18px 20px 32px 18px;
  border-left: 1px solid var(--gj-line);
  background: var(--gj-side);
}
.curator-gj-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 22px;
  margin-bottom: 10px;
}
.curator-gj-panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gj-brass);
}
.curator-gj-panel-count {
  font-size: 11.5px;
  color: var(--text-faint);
}
.curator-gj-panel-action {
  margin-left: auto;
}

/* 手札输入 */
.curator-gj-composer {
  margin-bottom: 22px;
  padding: 10px 12px 8px;
  border: 1px solid var(--gj-line);
  border-radius: 10px;
  background: var(--background-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.curator-gj-composer:focus-within {
  border-color: color-mix(in srgb, var(--gj-brass) 60%, transparent);
  box-shadow: 0 0 0 3px var(--gj-brass-soft);
}
.curator-gj-shell textarea.curator-gj-composer-input,
.curator-gj-shell textarea.curator-gj-composer-input:focus,
.curator-gj-shell textarea.curator-gj-composer-input:hover {
  display: block;
  width: 100%;
  min-height: 46px;
  max-height: 260px;
  padding: 2px 0;
  border: none;
  background: transparent;
  box-shadow: none;
  resize: none;
  color: var(--text-normal);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.65;
}
.curator-gj-composer-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--gj-line);
}
.curator-gj-composer-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-faint);
}
.curator-gj-composer-stamp {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--gj-brass);
}
.curator-gj-composer-hint {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-faint);
}

/* 手札时间线：按进度分组 */
.curator-gj-chapter {
  position: relative;
  margin-bottom: 18px;
  padding-left: 18px;
}
.curator-gj-chapter::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 10px;
  bottom: 6px;
  width: 1px;
  background: var(--gj-line);
}
.curator-gj-chapter-title {
  position: relative;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.curator-gj-chapter-title::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gj-brass);
  box-shadow: 0 0 0 3px var(--background-primary);
}
.curator-gj-note {
  margin: 0 -10px 2px;
  padding: 6px 10px 9px;
  border-radius: 8px;
  transition: background 0.15s ease;
}
.curator-gj-note:hover {
  background: color-mix(in srgb, var(--background-secondary) 70%, transparent);
}
.curator-gj-note.is-fresh {
  animation: curator-gj-fresh 1.4s ease-out;
}
@keyframes curator-gj-fresh {
  from { background: var(--gj-brass-soft); }
  to { background: transparent; }
}
.curator-gj-note-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.curator-gj-note-hours {
  font-weight: 600;
  color: var(--gj-brass);
}
.curator-gj-note-edited {
  font-style: italic;
}
.curator-gj-note-text {
  font-size: 14px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-user-select: text;
  user-select: text;
}
.curator-gj-note-text.is-editing {
  white-space: normal;
}
.curator-gj-row-tools {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.curator-gj-note:hover .curator-gj-row-tools,
.curator-gj-todo:hover .curator-gj-row-tools,
.curator-gj-guide:hover .curator-gj-row-tools,
.curator-gj-row-tools:focus-within,
.curator-gj-row-tools:has(.is-armed) {
  opacity: 1;
}
@media (hover: none) {
  .curator-gj-row-tools { opacity: 0.75; }
}

/* 就地编辑 */
.curator-gj-shell .curator-gj-edit-field,
.curator-gj-shell .curator-gj-edit-field:focus {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--gj-brass);
  border-radius: 7px;
  background: var(--background-primary);
  box-shadow: 0 0 0 3px var(--gj-brass-soft);
  color: var(--text-normal);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  resize: none;
}
.curator-gj-shell input.curator-gj-edit-field {
  height: 30px;
}
.curator-gj-edit-bar {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

/* 待办 */
.curator-gj-quick-add {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.curator-gj-shell input.curator-gj-quick-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--gj-line);
  border-radius: 7px;
  background: var(--background-primary);
  box-shadow: none;
  color: var(--text-normal);
  font-size: 13px;
}
.curator-gj-shell input.curator-gj-quick-input:focus {
  border-color: var(--gj-brass);
  box-shadow: 0 0 0 3px var(--gj-brass-soft);
}
.curator-gj-shell input.curator-gj-quick-input.is-invalid {
  border-color: var(--gj-danger);
}
.curator-gj-checklist {
  display: flex;
  flex-direction: column;
}
.curator-gj-todo {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0 -6px;
  padding: 7px 6px;
  border-radius: 7px;
}
.curator-gj-todo:hover {
  background: var(--background-modifier-hover);
}
.curator-gj-check {
  position: relative;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  cursor: pointer;
}
.curator-gj-shell .curator-gj-check input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.curator-gj-check-mark {
  position: absolute;
  inset: 0;
  border: 1.5px solid color-mix(in srgb, var(--gj-brass) 55%, var(--background-modifier-border));
  border-radius: 4px;
  background: var(--background-primary);
  pointer-events: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.curator-gj-check input:checked + .curator-gj-check-mark {
  border-color: var(--gj-brass);
  background: var(--gj-brass);
}
.curator-gj-check input:checked + .curator-gj-check-mark::after {
  content: "";
  position: absolute;
  left: 32%;
  top: 12%;
  width: 28%;
  height: 52%;
  border: solid var(--gj-on-brass);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.curator-gj-check input:focus-visible + .curator-gj-check-mark {
  box-shadow: 0 0 0 3px var(--gj-brass-soft);
}
@media (hover: none) {
  .curator-gj-check { width: 20px; height: 20px; margin-top: 0; }
}
.curator-gj-todo-main {
  flex: 1 1 auto;
  min-width: 0;
}
.curator-gj-todo-text {
  font-size: 13.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  transition: color 0.2s ease;
}
.curator-gj-todo.is-done .curator-gj-todo-text {
  color: var(--text-faint);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-faint) 70%, transparent);
}
.curator-gj-todo-meta {
  margin-top: 1px;
  font-size: 11px;
  color: var(--text-faint);
}
.curator-gj-allclear {
  padding: 6px 0;
  font-size: 12.5px;
  color: var(--text-muted);
}
.curator-gj-done-fold {
  margin-top: 6px;
}
.curator-gj-done-fold > summary {
  list-style: none;
  padding: 5px 0;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.curator-gj-done-fold > summary::-webkit-details-marker {
  display: none;
}
.curator-gj-done-fold > summary::before {
  content: "▸";
  display: inline-block;
  width: 14px;
  transition: transform 0.15s ease;
}
.curator-gj-done-fold[open] > summary::before {
  transform: rotate(90deg);
}

/* 攻略 */
.curator-gj-guide-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px dashed var(--gj-line);
  border-radius: 9px;
  background: var(--background-primary);
}
.curator-gj-guide-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.curator-gj-spoiler-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: auto;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.curator-gj-guide-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.curator-gj-guide {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 -8px;
  padding: 7px 8px;
  border-radius: 7px;
}
.curator-gj-guide:hover {
  background: var(--background-modifier-hover);
}
.curator-gj-guide-body {
  flex: 1 1 auto;
  min-width: 0;
}
.curator-gj-guide-link {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-normal);
  text-decoration: none;
}
.curator-gj-guide-title {
  font-size: 13.5px;
  font-weight: 600;
}
.curator-gj-guide-title::after {
  content: " ↗";
  font-weight: 400;
  color: var(--text-faint);
}
.curator-gj-guide-link:hover .curator-gj-guide-title {
  color: var(--gj-brass);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.curator-gj-guide-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.curator-gj-guide-host {
  font-size: 11.5px;
  color: var(--text-faint);
}
.curator-gj-guide-sep {
  margin: 0 5px;
  color: var(--text-faint);
}
.curator-gj-guide-remark.is-spoiler {
  display: inline-block;
  max-width: 100%;
  padding: 0 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-faint) 14%, transparent);
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  cursor: pointer;
}
.curator-gj-guide-remark.is-spoiler.is-revealed {
  display: inline;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  white-space: normal;
}

/* 空状态 */
.curator-gj-empty {
  padding: 14px 2px 6px;
}
.curator-gj-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}
.curator-gj-empty-desc {
  max-width: 30em;
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-faint);
}
.curator-gj-empty.is-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 12px 20px;
  text-align: center;
}
.curator-gj-empty-sheet {
  width: 46px;
  height: 58px;
  margin-bottom: 14px;
  border-radius: 4px;
  border: 1px solid var(--gj-line);
  background:
    linear-gradient(90deg, transparent 9px, var(--gj-brass-soft) 9px, var(--gj-brass-soft) 10px, transparent 10px),
    repeating-linear-gradient(180deg, transparent 0 9px, var(--gj-line) 9px 10px),
    var(--gj-paper);
  transform: rotate(-4deg);
}

/* 底栏 */
.curator-gj-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 7px 14px 7px 22px;
  border-top: 1px solid var(--gj-line);
  font-size: 11.5px;
  color: var(--text-faint);
}
.curator-gj-foot-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.curator-gj-saved {
  flex: 0 0 auto;
  color: var(--gj-brass);
  opacity: 0;
  transition: opacity 0.25s ease;
}
.curator-gj-saved.is-visible {
  opacity: 1;
}
.curator-gj-saved.is-error {
  color: var(--gj-danger);
}
.curator-gj-foot .curator-gj-btn {
  margin-left: auto;
}

/* 窄容器 / 移动端：折叠为三段切换 */
@container curator-gj (max-width: 640px) {
  .curator-gj-head {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    padding: 16px 48px 12px 16px;
  }
  .curator-gj-cover { width: 50px; }
  .curator-gj-title { font-size: 17px; }
  .curator-gj-stats { gap: 6px 16px; }
  .curator-gj-head-actions { grid-column: 1 / -1; }
  .curator-gj-head-actions:empty { display: none; }
  .curator-gj-shell button.curator-gj-play { flex: 1; }
  .curator-gj-tabs { display: flex; }
  .curator-gj-body {
    display: block;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .curator-gj-main,
  .curator-gj-side {
    overflow: visible;
    padding: 14px 16px 28px;
    border-left: none;
    background: none;
  }
  .curator-gj[data-tab="notes"] .curator-gj-side,
  .curator-gj:not([data-tab="notes"]) .curator-gj-main { display: none; }
  .curator-gj-panel { display: none; }
  .curator-gj[data-tab="notes"] .curator-gj-panel[data-panel="notes"],
  .curator-gj[data-tab="todos"] .curator-gj-panel[data-panel="todos"],
  .curator-gj[data-tab="guides"] .curator-gj-panel[data-panel="guides"] { display: block; }
  .curator-gj-panel-head:not(.has-action) { display: none; }
  .curator-gj-panel-title,
  .curator-gj-panel-count { display: none; }
  .curator-gj-composer-hint { display: none; }
  .curator-gj-foot { padding: 7px 10px 7px 16px; }
}

/* 游戏卡片：最近一条手札摘录 + 入口按钮 */
.curator-game-card-peek {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, #8f683d 7%, var(--background-secondary));
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.curator-game-card-peek:hover {
  background: color-mix(in srgb, #8f683d 14%, var(--background-secondary));
  color: var(--text-normal);
}
.curator-game-card-peek-tag {
  flex: 0 0 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: #8f683d;
}
.theme-dark .curator-game-card-peek-tag {
  color: #cfa874;
}
.curator-game-card-peek-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.curator-game-card-peek.is-empty {
  border: 1px dashed var(--background-modifier-border);
  background: transparent;
  color: var(--text-faint);
}
.curator-game-card-actions .curator-btn.curator-game-journal-entry {
  gap: 6px;
}
.curator-game-journal-entry-badge {
  display: inline-block;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: #8f683d;
  color: #fffdf9;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}
.theme-dark .curator-game-journal-entry-badge {
  background: #cfa874;
  color: #1f1a12;
}
`;
}

module.exports = {
  resolveDefaultVoiceArchiveFolder,
  resolveFfmpegExecutable,
  isPathInsideAnimeRoot,
  bindMagicWandLongPress,
  openMagicWandRelationModal,
  layoutAvesJustifiedGrid,
  attachAvesResizeObserver,
  reconcileIllustrationCollectionWithDisk,
  handleVaultGalleryFileRename,
  deleteGalleryIllustration,
  classifyPixivAgeRating,
  collectAllGalleryIllustrations,
  searchOnlineIllustrations,
  probeVideoSubtitleTracks,
  loadSubtitlesForVideoFile,
  drawPlayableAcgVoiceQuote,
  renderIllustrationGalleryWorkspace,
  renderVoiceLineArchiveWorkspace,
  renderGameLibraryWorkspace,
  launchLocalGameProcess,
  openGameDetailAndNotesModal,
  openGameEditMetadataModal,
  syncGameMarkdownNote,
  resolveLocalOrVaultImageUrl,
  getMultiHallStyles
};
