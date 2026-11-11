const { requestUrl, Notice, Modal, Menu } = require("obsidian");
const { openLocalPathSafely, inspectLocalFolder } = require("./note-utils.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const reviewStudioService = require("./review-studio-service.js");
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
 * 自动探测本机可用的 FFmpeg 可执行文件路径
 */
function resolveFfmpegExecutable(plugin) {
  if (!isDesktopNodeAvailable()) return "";
  const custom = String(plugin?.settings?.ffmpegCustomPath || "").trim();
  if (custom && fs.existsSync(custom)) return custom;

  const localAppData = (typeof process !== "undefined" && process.env && process.env.LOCALAPPDATA) || "";
  const candidates = [
    "C:\\ffmpeg\\ffmpeg-2025-03-31-git-35c091f4b7-essentials_build\\ffmpeg-2025-03-31-git-35c091f4b7-essentials_build\\bin\\ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    path.join(
      localAppData,
      "Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-127043-g5a54fcf75e-win64-gpl\\bin\\ffmpeg.exe"
    ),
    path.join(localAppData, "Microsoft\\WinGet\\Links\\ffmpeg.exe")
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
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
      ev.target.closest("button, input, select, textarea, a, .is-interactive, .curator-char-top-remove-btn")
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
 * 打开「🪄 洛琪希魔杖 · 同源星轨关联谱」模态框
 * 支持从任意番剧、角色、制作公司、画册插画、台词音声或游戏出发，穿透检索全馆关联条目
 */
function openMagicWandRelationModal(plugin, seed, vaultAnimeItems = [], callbacks = {}) {
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
    badgeRow.createSpan({ cls: "curator-wand-kicker", text: "🪄 洛琪希魔杖 · 同源关联检索" });
    const typeLabelMap = {
      anime: "🎬 动画卷宗",
      character: "👑 角色档案",
      studio: "🏢 动画制作社",
      illustration: "🖼️ 典藏画册",
      voice: "🎙️ 台词音声",
      game: "🎮 本地游戏"
    };
    badgeRow.createSpan({ cls: "curator-wand-type-pill", text: typeLabelMap[seedType] || "馆藏条目" });

    head.createEl("h2", {
      cls: "curator-wand-title",
      text: `「${seedTitle}」的全馆关联星轨`
    });
    head.createDiv({
      cls: "curator-wand-sub",
      text: "已为您跨馆检索同系列续作、同一制作公司、登场角色、同声优 (CV)、典藏画册、台词音声与关联游戏"
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
        text: `🔍 在编目总览中检索「${seedTitle.slice(0, 12)}」`
      });
      filterTitleBtn.onclick = () => {
        modal.close();
        callbacks.onFilterCatalog(seedTitle);
      };
      if (studioTokens.length > 0) {
        const filterStudioBtn = quickFilterBar.createEl("button", {
          cls: "curator-btn",
          text: `🏢 筛选制作社：${studioTokens[0]}`
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
        text: "随着您收录更多同系列番剧、登场角色、画册插画、截取台词音声或本地游戏，洛琪希魔杖将自动把它们串联成同源星轨。"
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
      "🎬 同系列 / 关联动画卷宗",
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
      "👑 关联登场角色 / 同声优角色",
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
      "🖼️ 关联典藏画册",
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
      "🎙️ 关联台词音声",
      `${relatedVoices.length} 条`,
      relatedVoices,
      (grid, vc) => {
        const chip = grid.createDiv("curator-wand-item-card");
        chip.createDiv({ cls: "curator-wand-item-main", text: `“${vc.quoteText || "台词片段"}”` });
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
      "🎮 关联本地游戏",
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
      `🏢 同制作公司（${studioTokens.join(" / ")}）其他馆藏`,
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
      category: "星轨关联",
      priority: roxyMascotService.PRIORITY.NORMAL,
      dedupeKey: `wand:${seedTitle}`,
      message: `我已经用魔杖为您把「${seedTitle}」相关的 ${totalFound} 项馆藏线索串联起来了，点击任意卡片就能直接跳转过去哦。`
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
    expandedKeywords: Array.from(expandedKeywordsSet)
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

    const src = resolveLocalOrVaultImageUrl(plugin, cur.localPath || cur.imageUrl, cur._cacheBust || "");
    const top = contentEl.createDiv("curator-illust-lb-head");
    const titleWrap = top.createDiv("curator-illust-lb-titlewrap");
    const h3Row = titleWrap.createDiv("curator-illust-lb-h3row");
    h3Row.createEl("h3", { text: cur.title || "典藏插画" });
    if (galleryList.length > 1) {
      h3Row.createSpan({
        cls: "curator-illust-lb-counter curator-mono",
        text: `${currentIndex + 1} / ${galleryList.length}`
      });
    }

    const metaSpan = titleWrap.createDiv({ cls: "curator-illust-lb-meta" });
    const updateMetaText = (natW = 0, natH = 0) => {
      const parts = [
        cur.characterName ? `👑 角色：${cur.characterName}` : "",
        cur.animeTitle ? `🎬 作品：《${cur.animeTitle}》` : "",
        natW > 0 && natH > 0 ? `📐 ${natW}×${natH}` : "",
        cur.fileSizeBytes > 0 ? `📦 ${formatByteSize(cur.fileSizeBytes, true)}` : "",
        cur.localPath ? `📁 本地路径：${cur.localPath}` : ""
      ].filter(Boolean);
      metaSpan.textContent = parts.join(" · ");
    };
    updateMetaText();

    // 可折叠元数据编辑条（支持修改标题、归属角色、关联作品与标签；磁盘扫描图片保存后自动转为正式典藏记录）
    const editDrawer = contentEl.createDiv("curator-illust-lb-editbox");
    editDrawer.style.display = "none";

    const imgStage = contentEl.createDiv("curator-illust-lb-stage");
    if (galleryList.length > 1) {
      const prevBtn = imgStage.createEl("button", {
        cls: "curator-illust-lb-nav is-prev",
        text: "‹",
        attr: { title: "上一幅 (←)" }
      });
      prevBtn.onclick = (ev) => {
        ev.stopPropagation();
        currentIndex = (currentIndex - 1 + galleryList.length) % galleryList.length;
        renderModalContent();
      };
    }

    if (src) {
      const img = imgStage.createEl("img", {
        cls: "curator-illust-lb-img",
        attr: { src, alt: cur.title || "" }
      });
      img.style.maxHeight = "70vh";
      img.style.maxWidth = "100%";
      img.style.objectFit = "contain";
      img.style.borderRadius = "8px";
      const onNatLoaded = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          updateMetaText(img.naturalWidth, img.naturalHeight);
        }
      };
      if (img.complete && img.naturalWidth > 0) onNatLoaded();
      else img.onload = onNatLoaded;
    }

    if (galleryList.length > 1) {
      const nextBtn = imgStage.createEl("button", {
        cls: "curator-illust-lb-nav is-next",
        text: "›",
        attr: { title: "下一幅 (→)" }
      });
      nextBtn.onclick = (ev) => {
        ev.stopPropagation();
        currentIndex = (currentIndex + 1) % galleryList.length;
        renderModalContent();
      };
    }

    const actions = contentEl.createDiv("curator-illust-lb-actions");
    if (cur.localPath) {
      const openDirBtn = actions.createEl("button", {
        cls: "curator-btn",
        text: "📂 在资源管理器中定位文件"
      });
      openDirBtn.onclick = async () => {
        await revealLocalFileInExplorer(plugin, cur.localPath);
      };
    }

    if (cur.sourceType !== "character") {
      const editBtn = actions.createEl("button", {
        cls: "curator-btn",
        text: "✏️ 编辑信息"
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
          text: "✓ 保存"
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
          if (Notice) new Notice("✨ 已保存画作典藏信息");
          if (typeof onRefresh === "function") onRefresh();
          renderModalContent();
        };
      };

      let confirmPending = false;
      let cancelConfirmBtn = null;
      const delBtn = actions.createEl("button", {
        cls: "curator-btn curator-illust-danger-btn",
        text: cur.localPath ? "🗑️ 删除该幅画作" : "🗑️ 移除该幅画作"
      });
      delBtn.title = cur.localPath
        ? "将该幅本地画册图片移入系统回收站，并同步清除画册典藏记录"
        : "从画册典藏中移除该记录";

      delBtn.onclick = async () => {
        if (!confirmPending) {
          confirmPending = true;
          delBtn.addClass("is-confirming");
          delBtn.textContent = cur.localPath
            ? "⚠️ 确认删除图片（移入回收站）"
            : "⚠️ 确认移除记录";
          cancelConfirmBtn = actions.createEl("button", {
            cls: "curator-btn",
            text: "取消"
          });
          cancelConfirmBtn.onclick = () => {
            confirmPending = false;
            delBtn.removeClass("is-confirming");
            delBtn.textContent = cur.localPath ? "🗑️ 删除该幅画作" : "🗑️ 移除该幅画作";
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
              ? `🗑️ 已删除画作《${cur.title || "未命名"}》（本地图片已移入系统回收站）`
              : `🗑️ 已移除画作记录《${cur.title || "未命名"}》`
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

  container.empty();
  container.addClass("curator-illust-workspace");

  if (!plugin.__illustGalleryState) {
    plugin.__illustGalleryState = {
      searchQuery: "",
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
  titleSide.createDiv({ cls: "curator-char-kicker", text: "ILLUSTRATION & ARTBOOK GALLERY" });
  const hRow = titleSide.createDiv("curator-char-title-row");
  hRow.createEl("h2", { cls: "curator-char-title", text: "🖼️ 画册典藏" });
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

  // 本地保存目录快速打开按钮
  const openFolderBtn = actionSide.createEl("button", {
    cls: "curator-btn",
    text: "📂 本地画册目录"
  });
  openFolderBtn.title = `当前保存目录：${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}（点击打开目录）`;
  openFolderBtn.onclick = async () => {
    const { absDir } = ensureDirectoryAbsolute(
      plugin,
      plugin.settings.illustrationGalleryFolder,
      "附件/画册典藏"
    );
    await openLocalPathSafely(absDir);
  };

  const importLocalBtn = actionSide.createEl("button", {
    cls: "curator-btn",
    text: "📁 导入本地图片"
  });
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
        if (Notice) new Notice(`✨ 已将 ${importedCount} 幅图片导入「${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}」并归档！`);
        renderIllustrationGalleryWorkspace(plugin, container, vaultAnimeItems, options);
      } else if (Notice) {
        new Notice("⚠️ 未能读取所选图片文件，请重试。");
      }
    };
    fileInput.click();
  };

  const onlineSearchBtn = actionSide.createEl("button", {
    cls: `curator-btn ${uiState.showOnlineDrawer ? "is-active" : "is-primary"}`,
    text: uiState.showOnlineDrawer ? "▴ 收起在线搜图台" : "🔍 在线搜图与一键保存"
  });
  onlineSearchBtn.onclick = () => {
    uiState.showOnlineDrawer = !uiState.showOnlineDrawer;
    renderIllustrationGalleryWorkspace(plugin, container, vaultAnimeItems, options);
  };

  // 在线搜图与路径配置抽屉
  if (uiState.showOnlineDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer");
    const pathBar = drawer.createDiv("curator-illust-path-config-row");
    pathBar.createSpan({ text: "💾 画册本地保存路径（修改后自动迁移已有画册文件）：" });
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
      { val: "fuzzy", label: "🌐 跨语种模糊扩展 (推荐)" },
      { val: "broad", label: "📝 标题+简介+标签宽泛模糊" },
      { val: "tag", label: "🏷️ 标签部分匹配 (s_tag)" }
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
      { val: "safe", label: "🛡️ 全年龄 (排除 R-18)" },
      { val: "safe_strict", label: "🌱 全年龄·严选 (排除敏感)" },
      { val: "all", label: "🌐 全部年龄 (含 R-18)" },
      { val: "r18", label: "🔞 仅 R-18" }
    ];
    ageModeOptions.forEach((ag) => {
      const opt = ageSelect.createEl("option", { value: ag.val, text: ag.label });
      if (uiState.ageMode === ag.val) opt.selected = true;
    });

    // 排除 AI 生成作品开关按钮
    const excludeAiBtn = sBar.createEl("button", {
      cls: `curator-btn curator-illust-ai-toggle ${uiState.excludeAI ? "is-active" : ""}`,
      text: uiState.excludeAI ? "🚫 已排除 AI 作品" : "🤖 包含 AI 作品"
    });
    excludeAiBtn.title = "如同 Pixiv 搜索选项一样过滤掉 AI 生成插画（ai_type=1 & 标签过滤）";
    excludeAiBtn.onclick = async (e) => {
      e.preventDefault();
      uiState.excludeAI = !uiState.excludeAI;
      plugin.settings.illustExcludeAI = uiState.excludeAI;
      excludeAiBtn.classList.toggle("is-active", uiState.excludeAI);
      excludeAiBtn.textContent = uiState.excludeAI ? "🚫 已排除 AI 作品" : "🤖 包含 AI 作品";
      await plugin.saveSettings();
      if (kwInput.value.trim() || uiState.onlineKeyword) {
        triggerOnlineSearch();
      }
    };

    const doSearchBtn = sBar.createEl("button", {
      cls: "curator-btn is-primary",
      text: "🔍 在线检索插画"
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
      text: "📐 默认下载尺寸（均为无裁切完整画幅，可根据网速按需切换）："
    });
    const sizeSelect = sizeConfigBar.createEl("select", {
      cls: "curator-sort-select curator-illust-size-select"
    });
    [
      { val: "small", label: "⚡ 轻量全图 (540P · 极速省流 · 约 40~160 KB)" },
      { val: "regular", label: "🌟 高清全图 (1200P · 速度与画质均衡 · 约 200~900 KB · 推荐)" },
      { val: "original", label: "💎 原图无损 (Original · 原始完整分辨率 PNG/JPG · 约 1.2~12 MB)" }
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
        expandedKwBadge.textContent = `🌐 跨语种检索词：${uiState.expandedKeywords.join(" / ")} · ${ageLabelMap[uiState.ageMode] || "全年龄"}${uiState.excludeAI ? " · 已排除AI" : ""}`;
      } else {
        expandedKwBadge.textContent = "";
      }

      const pixivTabBtn = tabSwitchBar.createEl("button", {
        cls: `curator-btn ${uiState.onlineTab === "pixiv" ? "is-primary" : ""}`,
        text: `🎨 Pixiv 插画面板 (${pixivList.length})`
      });
      pixivTabBtn.onclick = (e) => {
        e.preventDefault();
        uiState.onlineTab = "pixiv";
        renderSourceTabsAndGrid();
      };

      const bgmTabBtn = tabSwitchBar.createEl("button", {
        cls: `curator-btn ${uiState.onlineTab === "bangumi" ? "is-primary" : ""}`,
        text: `👑 Bangumi 角色立绘面板 (${bgmList.length})`
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
          text: "⏳ 正在跨语种模糊检索 Pixiv 无裁切插画库与 Bangumi 角色立绘..."
        });
        return;
      }

      const activeList = uiState.onlineTab === "bangumi" ? bgmList : pixivList;
      if (!activeList || activeList.length === 0) {
        const otherCount = uiState.onlineTab === "pixiv" ? bgmList.length : pixivList.length;
        const emptyHint = !uiState.onlineKeyword
          ? "输入关键词点击「🔍 在线检索插画」，自动跨语种匹配中日文角色标签并展示完整无裁切画作。"
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
            byteBadge.textContent = `📦 完整原图大小：${formatByteSize(origBytes, origExact)} (${curDim.width}×${curDim.height})`;
          } else {
            byteBadge.textContent = `📦 当前档位：${formatByteSize(curBytes, curExact)} · 完整原图：${formatByteSize(origBytes, origExact)}`;
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
          text: alreadyInGallery ? "✓ 已在画册中（点击可另存）" : "💾 保存到本地画册"
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
            saveBtn.textContent = `✓ 已入库 (${formatByteSize(savedRec.fileSizeBytes, true)})`;
            if (Notice) {
              new Notice(
                `✨ 已将《${item.title}》(${tierLabels[chosenTier]} · ${formatByteSize(savedRec.fileSizeBytes, true)}) 保存至「${plugin.settings.illustrationGalleryFolder || "附件/画册典藏"}」！`
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
        const { pixivResults, bangumiResults, expandedKeywords } = await searchOnlineIllustrations(kw, {
          excludeAI: uiState.excludeAI,
          ageMode: uiState.ageMode,
          searchMode: uiState.searchMode,
          plugin
        });
        if (reqId !== searchReqSeq) return; // 丢弃过期的并发旧请求响应，防止覆盖最新筛选结果
        uiState.pixivResults = pixivResults || [];
        uiState.bangumiResults = bangumiResults || [];
        uiState.expandedKeywords = expandedKeywords || [kw];
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

  // 控制栏（行高密度 + 铭牌显示）
  const wallBar = container.createDiv("curator-photowall-toolbar");
  wallBar.createDiv({
    cls: "curator-photowall-hint",
    text: "🖼️ Aves 自适应完整画报墙 · 按原图真实宽高比零空边拼贴，开合侧边栏实时自适应，单击鉴赏，长按魔杖关联"
  });
  const ctrlRight = wallBar.createDiv("curator-photowall-ctrls");
  const densityButtons = [];
  [
    { h: 185, label: "📏 紧凑" },
    { h: 240, label: "🖼️ 标准" },
    { h: 310, label: "✨ 舒展" }
  ].forEach((preset) => {
    const b = ctrlRight.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.rowHeight === preset.h ? "is-active" : ""}`,
      text: preset.label
    });
    b.onclick = async () => {
      uiState.rowHeight = preset.h;
      plugin.settings.illustRowHeight = preset.h;
      densityButtons.forEach((entry) => {
        entry.btn.classList.toggle("is-active", entry.h === preset.h);
      });
      renderMasonryStage();
      await plugin.saveSettings();
    };
    densityButtons.push({ h: preset.h, btn: b });
  });

  const capToggleBtn = ctrlRight.createEl("button", {
    cls: `curator-dl-mini-btn ${uiState.captionMode === "always" ? "is-active" : ""}`,
    text: uiState.captionMode === "hover" ? "🏷️ 铭牌：悬停浮现" : "📌 铭牌：常驻显示"
  });
  capToggleBtn.onclick = async () => {
    uiState.captionMode = uiState.captionMode === "hover" ? "always" : "hover";
    plugin.settings.illustCaptionMode = uiState.captionMode;
    capToggleBtn.classList.toggle("is-active", uiState.captionMode === "always");
    capToggleBtn.textContent =
      uiState.captionMode === "hover" ? "🏷️ 铭牌：悬停浮现" : "📌 铭牌：常驻显示";
    const gridEl = stageHost.querySelector(".curator-char-photowall-grid");
    if (gridEl) {
      gridEl.classList.toggle("is-hover-plaque", uiState.captionMode === "hover");
      gridEl.classList.toggle("is-always-plaque", uiState.captionMode === "always");
    } else {
      renderMasonryStage();
    }
    await plugin.saveSettings();
  };

  const stageHost = container.createDiv("curator-illust-stage-host");

  const renderMasonryStage = () => {
    if (stageHost._avesResizeObserver) {
      try {
        stageHost._avesResizeObserver.disconnect();
      } catch (_) {}
      stageHost._avesResizeObserver = null;
    }
    stageHost.empty();

    const allLatest = collectAllGalleryIllustrations(plugin);
    if (countBadgeEl && countBadgeEl.isConnected) {
      countBadgeEl.textContent = `共收录 ${allLatest.length} 幅画作`;
    }
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-gallery-badge"]')
        .forEach((el) => {
          el.textContent = `画作 ${allLatest.length} 幅`;
        });
    }

    const curList = allLatest.filter((it) => {
      const q = String(uiState.searchQuery || "").trim().toLowerCase();
      if (!q) return true;
      const hay = [it.title, it.characterName, it.animeTitle, ...(it.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    if (curList.length === 0) {
      stageHost.createDiv({
        cls: "curator-rs-empty",
        text: "当前画册暂无匹配图片 · 可点击右上角「🔍 在线搜图与一键保存」或「📁 导入本地图片」充实画册。"
      });
      return;
    }

    const masonry = stageHost.createDiv(
      `curator-char-photowall-grid is-aves-justified ${uiState.captionMode === "hover" ? "is-hover-plaque" : "is-always-plaque"}`
    );
    const rowH = Number(uiState.rowHeight) || 240;
    const tilesMeta = [];
    let pendingImgLayoutRaf = 0;

    const runAvesRelayout = () => {
      layoutAvesJustifiedGrid(masonry, tilesMeta, {
        targetRowHeight: Number(uiState.rowHeight) || rowH,
        gap: 8
      });
    };

    const scheduleImgLoadRelayout = () => {
      if (pendingImgLayoutRaf) return;
      pendingImgLayoutRaf = requestAnimationFrame(() => {
        pendingImgLayoutRaf = 0;
        if (masonry.isConnected) runAvesRelayout();
      });
    };

    curList.forEach((ill, idx) => {
      const tile = masonry.createDiv("curator-char-photowall-tile");
      tile.style.setProperty("--stagger-idx", String(idx));

      const imgWrap = tile.createDiv("curator-char-photowall-imgwrap");
      const src = resolveLocalOrVaultImageUrl(plugin, ill.localPath || ill.imageUrl, ill._cacheBust || "");
      let imgEl = null;

      if (src) {
        imgEl = imgWrap.createEl("img", {
          cls: "curator-char-photowall-img",
          attr: { src, alt: ill.title || "" }
        });
        imgEl.loading = idx < 12 ? "eager" : "lazy";
        const updateFromNatural = () => {
          if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
            const nextAspect = imgEl.naturalWidth / imgEl.naturalHeight;
            const prevAspect = Number(ill._naturalAspect) || 0;
            ill._naturalAspect = nextAspect;
            if (ill._aspectCacheKey && plugin.__diskIllustAspectCache) {
              plugin.__diskIllustAspectCache.set(ill._aspectCacheKey, nextAspect);
            }
            if (Math.abs(nextAspect - prevAspect) > 0.004) {
              scheduleImgLoadRelayout();
            }
          }
        };
        imgEl.onerror = () => {
          // 1. 桌面端：若本地文件刚刚被外部移除，触发对账刷新
          if (isDesktopNodeAvailable() && ill.localPath) {
            const absCheck = resolveLocalFileAbsolutePath(plugin, ill.localPath);
            if (absCheck && !fs.existsSync(absCheck)) {
              setTimeout(() => {
                if (stageHost.isConnected) renderMasonryStage();
              }, 60);
              return;
            }
          }
          // 2. 移动端 / 选择性同步尚未拉取本地原图时：优先回退在线预览图，绝不误删记录
          if (
            ill.imageUrl &&
            /^https?:\/\//i.test(String(ill.imageUrl)) &&
            imgEl.dataset.triedOnlineFallback !== "1"
          ) {
            imgEl.dataset.triedOnlineFallback = "1";
            imgEl.src = ill.imageUrl;
            return;
          }
          imgEl.style.display = "none";
          if (!imgWrap.querySelector(".curator-illust-broken-fallback")) {
            imgWrap.createDiv({
              cls: "curator-illust-broken-fallback",
              text: ill.localPath ? "☁️ 原图未同步至本机" : "🖼️ 图片暂不可用"
            });
          }
        };
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          ill._naturalAspect = imgEl.naturalWidth / imgEl.naturalHeight;
          if (ill._aspectCacheKey && plugin.__diskIllustAspectCache) {
            plugin.__diskIllustAspectCache.set(ill._aspectCacheKey, ill._naturalAspect);
          }
        } else {
          imgEl.onload = updateFromNatural;
        }
      }

      tilesMeta.push({
        el: tile,
        imgEl,
        getAspect: () => Number(ill._naturalAspect) || 0.72
      });

      const topBar = tile.createDiv("curator-char-photowall-topbar");
      topBar.createSpan({
        cls: "curator-char-photowall-score curator-mono",
        text: ill.localPath ? "💾 本地" : "☁️ 云端"
      });

      const topActions = topBar.createDiv("curator-illust-tile-topactions");
      const wandBtn = topActions.createEl("button", {
        cls: "curator-char-photowall-cropbtn",
        text: "🪄"
      });
      wandBtn.title = "打开洛琪希魔杖同源关联谱";
      wandBtn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
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
      };

      let quickDelArmed = false;
      let quickDelTimer = null;
      const quickDelBtn = topActions.createEl("button", {
        cls: "curator-char-photowall-cropbtn is-danger-hover",
        text: "🗑️"
      });
      quickDelBtn.title = "删除该幅画作（再次点击确认移入回收站）";
      quickDelBtn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!quickDelArmed) {
          quickDelArmed = true;
          quickDelBtn.addClass("is-armed");
          quickDelBtn.textContent = "确认删?";
          if (quickDelTimer) clearTimeout(quickDelTimer);
          quickDelTimer = setTimeout(() => {
            quickDelArmed = false;
            if (quickDelBtn.isConnected) {
              quickDelBtn.removeClass("is-armed");
              quickDelBtn.textContent = "🗑️";
            }
          }, 3000);
          return;
        }
        if (quickDelTimer) clearTimeout(quickDelTimer);
        quickDelBtn.disabled = true;
        quickDelBtn.textContent = "...";
        const res = await deleteGalleryIllustration(plugin, ill);
        if (Notice) {
          new Notice(
            res.deletedFile
              ? `🗑️ 已删除画作《${ill.title || "未命名"}》（本地图片已移入系统回收站）`
              : `🗑️ 已移除画作记录《${ill.title || "未命名"}》`
          );
        }
        renderMasonryStage();
      };

      const plaque = tile.createDiv("curator-char-photowall-plaque");
      const titleLine = plaque.createDiv("curator-char-photowall-titleline");
      titleLine.createSpan({
        cls: "curator-char-photowall-name",
        text: ill.title || ill.characterName || "未命名画作"
      });
      if (ill.characterName || ill.animeTitle) {
        plaque.createDiv({
          cls: "curator-char-photowall-moes",
          text: [ill.characterName, ill.animeTitle].filter(Boolean).join(" · ")
        });
      }

      tile.onclick = () => {
        openIllustrationLightboxModal(plugin, ill, renderMasonryStage, {
          list: curList,
          index: idx
        });
      };

      tile.addEventListener("contextmenu", (ev) => {
        try {
          if (typeof Menu === "function") {
            ev.preventDefault();
            ev.stopPropagation();
            const menu = new Menu();
            menu.addItem((mi) =>
              mi
                .setTitle("🔍 放大鉴赏与编辑信息")
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
                  .setTitle("📂 在资源管理器中定位文件")
                  .onClick(() => revealLocalFileInExplorer(plugin, ill.localPath))
              );
            }
            menu.addItem((mi) =>
              mi.setTitle("🪄 魔杖同源星轨关联").onClick(() =>
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
                .setTitle(ill.localPath ? "🗑️ 删除该幅画作（本地图片移入回收站）" : "🗑️ 移除该幅画作")
                .onClick(async () => {
                  const res = await deleteGalleryIllustration(plugin, ill);
                  if (Notice) {
                    new Notice(
                      res.deletedFile
                        ? `🗑️ 已删除画作《${ill.title || "未命名"}》（本地图片已移入系统回收站）`
                        : `🗑️ 已移除画作记录《${ill.title || "未命名"}》`
                    );
                  }
                  renderMasonryStage();
                })
            );
            menu.showAtMouseEvent(ev);
          }
        } catch (_) {}
      });

      bindMagicWandLongPress(tile, () => {
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
    });

    runAvesRelayout();
    attachAvesResizeObserver(stageHost, masonry, runAvesRelayout);
  };

  // 注册全局活跃画册刷新钩子 + 本地画册目录实时监听（用户在资源管理器中手动增删改图片自动同步刷新）
  plugin._activeGalleryRefresh = () => {
    if (stageHost.isConnected) {
      renderMasonryStage();
    }
  };

  const bindLiveDirectoryWatcher = () => {
    if (typeof plugin._activeIllustWatcherCleanup === "function") {
      try {
        plugin._activeIllustWatcherCleanup();
      } catch (_) {}
      plugin._activeIllustWatcherCleanup = null;
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
        plugin._activeIllustWatcherCleanup = () => {
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
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ tracks: [], preferredSubIndex: 0 });
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
  const { tracks, preferredSubIndex } = await probeVideoSubtitleTracks(plugin, videoFilePath);
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

  const { absDir, vaultBase } = ensureDirectoryAbsolute(
    plugin,
    plugin.settings?.voiceArchiveFolder,
    "附件/台词音声库"
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
    proc.on("error", (err) => reject(err));
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
    quoteText: String(quoteText || "").trim() || "经典台词音声",
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
  if (/^https?:\/\//i.test(relOrAbs)) {
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
 * 优先抽取带可播放音频的 ACG 名台词并持久保存到用户自定义音声路径（默认 附件/台词音声库）
 * 顺序：
 *  1) 在线 ACG 语音接口（下载音频字节流并落盘保存）
 *  2) 本地馆藏番剧视频 + 字幕智能抽选经典台词并 FFmpeg 切片原声落盘
 *  3) 若因网络/环境问题或本地无带字幕视频而无法获取音频，降级抽取纯文字台词并明确提示原因
 */
async function drawPlayableAcgVoiceQuote(plugin, vaultAnimeItems = [], currentSelectedVideo = "") {
  const existingQuotes = new Set(
    (plugin.settings?.voiceCollection || []).map((v) => String(v.quoteText || "").trim())
  );
  const diagReasons = [];

  // 阶段 1：尝试在线带原声的二次元语音台词接口并下载音频持久保存到本地
  const onlineVoiceEndpoints = [
    {
      name: "VVHan ACG 原声台词接口",
      url: "https://api.vvhan.com/api/acg/voice?type=json",
      parse: (json) => ({
        quoteText: json?.data?.content || json?.content || json?.text || "",
        audioUrl: json?.data?.url || json?.mp3 || json?.url || json?.audio || "",
        characterName: json?.data?.author || json?.author || json?.name || "",
        animeTitle: json?.data?.source || json?.source || json?.from || "ACG 原声典藏"
      })
    },
    {
      name: "Lolimi 二次元语音接口",
      url: "https://api.lolimi.cn/API/yy/api.php?type=json",
      parse: (json) => ({
        quoteText: json?.text || json?.content || json?.msg || "",
        audioUrl: json?.url || json?.mp3 || json?.audio || "",
        characterName: json?.author || json?.name || "",
        animeTitle: json?.source || json?.from || "ACG 原声典藏"
      })
    }
  ];

  for (const ep of onlineVoiceEndpoints) {
    try {
      const res = await Promise.race([
        requestUrl({ url: ep.url, method: "GET" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))
      ]);
      let parsed = null;
      try {
        parsed = ep.parse(res?.json || JSON.parse(res?.text || "{}"));
      } catch (e) {}
      if (parsed && parsed.audioUrl && /^https?:\/\//i.test(parsed.audioUrl)) {
        const audioRes = await Promise.race([
          requestUrl({ url: parsed.audioUrl, method: "GET" }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4500))
        ]);
        if (audioRes?.arrayBuffer && audioRes.arrayBuffer.byteLength > 1024) {
          const { absDir, vaultBase } = ensureDirectoryAbsolute(
            plugin,
            plugin.settings?.voiceArchiveFolder,
            "附件/台词音声库"
          );
          const extMatch = String(parsed.audioUrl).match(/\.(mp3|wav|ogg|m4a)(?:$|\?)/i);
          const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".mp3";
          const fileName = `acg_voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
          const audioBin = toNodeBufferOrUint8(audioRes.arrayBuffer);
          let storedPath = "";
          if (isDesktopNodeAvailable() && absDir) {
            const absOut = path.join(absDir, fileName);
            fs.writeFileSync(absOut, audioBin);
            storedPath = absOut;
            if (vaultBase && absOut.toLowerCase().startsWith(vaultBase.toLowerCase())) {
              storedPath = path.relative(vaultBase, absOut).replace(/\\/g, "/");
            }
          } else {
            const relVoiceFolder = normalizeVaultRelPath(plugin.settings?.voiceArchiveFolder || "附件/台词音声库") || "附件/台词音声库";
            storedPath = `${relVoiceFolder}/${fileName}`;
            await writeVaultBinaryFile(plugin.app, storedPath, audioBin);
          }

          const record = {
            id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            quoteText: String(parsed.quoteText || "经典二次元原声台词").trim(),
            characterName: String(parsed.characterName || "").trim(),
            animeTitle: String(parsed.animeTitle || "ACG 原声").trim(),
            episode: "",
            timestamp: "",
            durationSec: 0,
            audioPath: storedPath,
            createdAt: new Date().toISOString()
          };
          if (!Array.isArray(plugin.settings.voiceCollection)) {
            plugin.settings.voiceCollection = [];
          }
          plugin.settings.voiceCollection.unshift(record);
          await plugin.saveSettings();
          return {
            record,
            hasAudio: true,
            sourceType: "online-audio",
            message: `🎙️ 已抽取带原声名台词并保存音频至「${storedPath}」：“${record.quoteText}”`
          };
        }
      }
      diagReasons.push(`${ep.name}未返回有效音频流`);
    } catch (err) {
      diagReasons.push(`${ep.name}连接超时或受网络环境限制`);
    }
  }

  // 阶段 2：从本地已下载番剧视频 + 字幕轨中自动抽选经典角色台词并调用 FFmpeg 切出原声 MP3 持久保存
  try {
    const candidateVideos = [];
    const seenVideoPaths = new Set();
    const pushCandidateVideo = (videoPath, animeTitle, episode) => {
      if (!videoPath || seenVideoPaths.has(videoPath)) return;
      seenVideoPaths.add(videoPath);
      const ext = path.extname(videoPath).toLowerCase();
      let hasExtSub = false;
      try {
        const dir = path.dirname(videoPath);
        const base = path.basename(videoPath, ext).toLowerCase();
        hasExtSub = fs
          .readdirSync(dir)
          .some((f) => /\.(ass|ssa|srt|vtt)$/i.test(f) && f.toLowerCase().includes(base.slice(0, 8)));
      } catch (e) {}
      const priorityScore = (hasExtSub ? 20 : 0) + (ext === ".mkv" ? 10 : 0) + Math.random();
      candidateVideos.push({
        videoPath,
        animeTitle,
        episode,
        priorityScore
      });
    };

    if (currentSelectedVideo && fs.existsSync(currentSelectedVideo)) {
      pushCandidateVideo(
        currentSelectedVideo,
        path.basename(path.dirname(currentSelectedVideo)),
        ""
      );
    }

    const folderPool = [];
    const seenFolders = new Set();
    for (const it of vaultAnimeItems || []) {
      if (it && it.downloadPath && it.downloadPath !== "无" && fs.existsSync(it.downloadPath)) {
        const norm = path.resolve(it.downloadPath);
        if (!seenFolders.has(norm)) {
          seenFolders.add(norm);
          folderPool.push({ dirPath: norm, title: it.name || path.basename(norm) });
        }
      }
    }
    const localRoot = String(plugin.settings?.localAnimeRoot || "").trim();
    if (localRoot && fs.existsSync(localRoot)) {
      const scanSubDirs = (dir, depth) => {
        if (depth > 3) return;
        try {
          const subEntries = fs.readdirSync(dir, { withFileTypes: true });
          let hasVidHere = false;
          for (const dirent of subEntries) {
            if (dirent.isFile() && /\.(mkv|mp4|webm|avi|mov)$/i.test(dirent.name)) {
              hasVidHere = true;
            } else if (dirent.isDirectory()) {
              scanSubDirs(path.join(dir, dirent.name), depth + 1);
            }
          }
          if (hasVidHere) {
            const norm = path.resolve(dir);
            if (!seenFolders.has(norm)) {
              seenFolders.add(norm);
              folderPool.push({ dirPath: norm, title: path.basename(norm) });
            }
          }
        } catch (e) {}
      };
      scanSubDirs(localRoot, 0);
    }

    const shuffledFolders = [...folderPool].sort(() => Math.random() - 0.5);
    for (const folderItem of shuffledFolders) {
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

    // 优先检测带外置字幕或内嵌软字幕概率最高的 .mkv 番剧视频
    candidateVideos.sort((a, b) => b.priorityScore - a.priorityScore);

    for (const cand of candidateVideos.slice(0, 6)) {
      const subRes = await loadSubtitlesForVideoFile(plugin, cand.videoPath);
      const validCues = (subRes.cues || []).filter((c) => {
        const tx = String(c.text || "").trim();
        const dur = Number(c.endSec) - Number(c.startSec);
        if (tx.length < 6 || tx.length > 48) return false;
        if (dur < 1.0 || dur > 14.0) return false;
        if (existingQuotes.has(tx)) return false;
        return true;
      });
      if (validCues.length > 0) {
        // 优先挑选带角色说话人标记或带感叹/问句张力的经典台词
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
          message: `🎙️ 已从本地番剧《${cand.animeTitle}》抽取原声台词并保存至「${record.audioPath}」：“${record.quoteText}”`
        };
      }
    }
    if (candidateVideos.length === 0) {
      diagReasons.push("本地馆藏尚未绑定已下载番剧视频目录");
    } else {
      diagReasons.push("本地候选番剧视频未检出可用软字幕轨");
    }
  } catch (sliceErr) {
    diagReasons.push(`本地视频原声切片异常 (${sliceErr.message})`);
  }

  // 阶段 3：实在无法获取音频时，降级抽取纯文字名台词并明确向用户说明原因
  const fallbackReasonText =
    diagReasons.length > 0
      ? diagReasons.join("；")
      : "当前网络环境无法访问在线原声接口且本地无可切片番剧字幕";

  try {
    const res = await requestUrl({ url: "https://v1.hitokoto.cn/?c=a&c=c", method: "GET" });
    const data = res?.json;
    if (data && data.hitokoto) {
      const record = {
        id: `voice-${Date.now()}`,
        quoteText: data.hitokoto,
        characterName: data.from_who || "",
        animeTitle: data.from || "",
        episode: "",
        timestamp: "",
        durationSec: 0,
        audioPath: "",
        audioFallbackReason: `仅文字：${fallbackReasonText}`,
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
        sourceType: "text-fallback",
        message: `⚠️ 因「${fallbackReasonText}」，本次已降级收录纯文字名台词：“${data.hitokoto}”`
      };
    }
  } catch (e) {
    diagReasons.push("Hitokoto 文字台词接口连接超时");
  }

  // 离线兜底名台词库
  const offlineClassicPool = [
    {
      quoteText: "正因为害怕，所以才更要迈出那一步。",
      characterName: "洛琪希·米格路迪亚",
      animeTitle: "无职转生 ～到了异世界就拿出真本事～"
    },
    {
      quoteText: "努力不一定能立刻看到结果，但走过的每一步都不会白费。",
      characterName: "洛琪希·米格路迪亚",
      animeTitle: "无职转生 ～到了异世界就拿出真本事～"
    },
    {
      quoteText: "重要的不是活了多久，而是如何与旅途中的人共度时光。",
      characterName: "芙莉莲",
      animeTitle: "葬送的芙莉莲"
    }
  ];
  const pick =
    offlineClassicPool.find((q) => !existingQuotes.has(q.quoteText)) || offlineClassicPool[0];
  const record = {
    id: `voice-${Date.now()}`,
    quoteText: pick.quoteText,
    characterName: pick.characterName,
    animeTitle: pick.animeTitle,
    episode: "",
    timestamp: "",
    durationSec: 0,
    audioPath: "",
    audioFallbackReason: `仅文字：${diagReasons.join("；")}`,
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
    sourceType: "offline-text-fallback",
    message: `⚠️ 因「${diagReasons.join("；")}」，无法获取在线/本地音频，已降级收录纯文字台词：“${record.quoteText}”`
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
  titleSide.createDiv({ cls: "curator-char-kicker", text: "VOICE LINE & QUOTE STUDIO" });
  const hRow = titleSide.createDiv("curator-char-title-row");
  hRow.createEl("h2", { cls: "curator-char-title", text: "🎙️ 台词音声" });
  const voiceCountBadgeEl = hRow.createSpan({
    cls: "curator-char-count-badge curator-mono",
    text: `共典藏 ${voices.length} 条台词音声`
  });

  const actionSide = header.createDiv("curator-char-header-right");
  const searchInput = actionSide.createEl("input", {
    type: "text",
    cls: "curator-input curator-char-search-input",
    placeholder: "检索台词内容 / 角色 / 动画作品..."
  });
  searchInput.value = uiState.searchQuery || "";
  searchInput.oninput = () => {
    uiState.searchQuery = searchInput.value;
    renderVoiceCards();
  };

  if (isDesktopNodeAvailable()) {
    const openDirBtn = actionSide.createEl("button", {
      cls: "curator-btn",
      text: "📂 音声库目录"
    });
    openDirBtn.onclick = async () => {
      const { absDir } = ensureDirectoryAbsolute(
        plugin,
        plugin.settings.voiceArchiveFolder,
        "附件/台词音声库"
      );
      await openLocalPathSafely(absDir);
    };
  }

  const onlineQuoteBtn = actionSide.createEl("button", {
    cls: "curator-btn",
    text: "✨ 抽取 ACG 名台词"
  });
  onlineQuoteBtn.title =
    "优先抽取带可播放原声的二次元台词并持久保存到本地音声库；若无可用音频源则降级为纯文字并提示原因";
  onlineQuoteBtn.onclick = async () => {
    onlineQuoteBtn.disabled = true;
    const origText = onlineQuoteBtn.textContent;
    onlineQuoteBtn.textContent = "⏳ 正在抽取原声台词...";
    try {
      const drawRes = await drawPlayableAcgVoiceQuote(
        plugin,
        vaultAnimeItems,
        uiState.selectedVideoFile
      );
      if (Notice && drawRes?.message) {
        new Notice(drawRes.message, drawRes.hasAudio ? 5000 : 8000);
      }
      renderVoiceCards();
    } catch (e) {
      if (Notice) new Notice(`抽取台词失败：${e.message || "请稍后重试"}`);
    } finally {
      onlineQuoteBtn.disabled = false;
      onlineQuoteBtn.textContent = origText;
    }
  };

  if (isDesktopNodeAvailable()) {
    const slicerBtn = actionSide.createEl("button", {
      cls: `curator-btn ${uiState.showSlicerDrawer ? "is-active" : "is-primary"}`,
      text: uiState.showSlicerDrawer ? "▴ 收起智能字幕截取台" : "✂️ 从本地视频+字幕截取音声"
    });
    slicerBtn.onclick = () => {
      uiState.showSlicerDrawer = !uiState.showSlicerDrawer;
      renderVoiceLineArchiveWorkspace(plugin, container, vaultAnimeItems, options);
    };
  }

  // 智能视频+字幕台词音声截取工坊（仅桌面端）
  if (isDesktopNodeAvailable() && uiState.showSlicerDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer curator-voice-slicer-drawer");
    drawer.createDiv({
      cls: "curator-char-add-title",
      text: "✂️ 智能视频+字幕台词音声截取工坊（内置首尾防吞字缓冲 Padding · 自动优选简体中文字幕并剔除免责屏幕字）"
    });
    drawer.createDiv({
      cls: "curator-char-add-sub",
      text: "选择本地剧集视频后自动解析外置 (.ass/.srt) 或 MKV 多语种内嵌软字幕（支持自由切换字幕语言轨道），搜台词关键字即可一键切出原声 MP3 持久保存在本地"
    });

    // 音声本地保存路径快捷配置与自动迁移栏
    const pathConfigRow = drawer.createDiv("curator-illust-path-config-row");
    pathConfigRow.createSpan({ text: "📂 音声本地持久保存路径：" });
    const voiceFolderInput = pathConfigRow.createEl("input", {
      type: "text",
      cls: "curator-input curator-mono",
      placeholder: "默认：附件/台词音声库（支持相对 Vault 路径或绝对路径）"
    });
    voiceFolderInput.style.flex = "1";
    voiceFolderInput.value = plugin.settings.voiceArchiveFolder || "附件/台词音声库";
    const commitVoiceFolderMigration = async () => {
      const oldFolder = String(plugin.settings.voiceArchiveFolder || "附件/台词音声库").trim();
      const newFolder = String(voiceFolderInput.value || "").trim() || "附件/台词音声库";
      voiceFolderInput.value = newFolder;
      if (newFolder === oldFolder) return;
      plugin.settings.voiceArchiveFolder = newFolder;
      await plugin.saveSettings();
      if (typeof plugin.migrateVaultFolderPath === "function") {
        await plugin.migrateVaultFolderPath({
          categoryKey: "voiceArchiveFolder",
          categoryLabel: "台词音声库目录",
          oldPath: oldFolder,
          newPath: newFolder
        });
        renderVoiceCards();
      } else if (Notice) {
        new Notice(`📂 音声保存路径已更新为：${newFolder}`);
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
    const animeWithLocal = (vaultAnimeItems || [])
      .filter((it) => it.downloadPath && it.downloadPath !== "无")
      .map((ani) => {
        let hasSoftSubHint = false;
        try {
          if (fs.existsSync(ani.downloadPath)) {
            const entries = fs.readdirSync(ani.downloadPath);
            hasSoftSubHint = entries.some((f) => /\.(mkv|ass|ssa|srt|vtt)$/i.test(f));
          }
        } catch (e) {}
        return Object.assign({}, ani, { _hasSoftSubHint: hasSoftSubHint });
      })
      .sort((a, b) => (b._hasSoftSubHint ? 1 : 0) - (a._hasSoftSubHint ? 1 : 0));

    const animeSelect = step1Row.createEl("select", { cls: "curator-sort-select" });
    animeSelect.createEl("option", { value: "", text: "── 从馆藏本地番剧中选择 ──" });
    animeWithLocal.forEach((ani) => {
      const opt = animeSelect.createEl("option", {
        value: ani.downloadPath,
        text: ani._hasSoftSubHint ? `《${ani.name}》 ✦ 含软字幕/MKV` : `《${ani.name}》`
      });
      if (uiState.selectedAnimePath === ani.downloadPath) opt.selected = true;
    });

    const epSelect = step1Row.createEl("select", { cls: "curator-sort-select" });
    epSelect.createEl("option", { value: "", text: "── 选择剧集视频文件 ──" });

    const browseVideoBtn = step1Row.createEl("button", {
      cls: "curator-btn",
      text: "📁 浏览任意视频..."
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
          text: "⏳ 正在解析剧集多语种字幕轨道并过滤非对白屏幕字，请稍候..."
        });
        return;
      }

      const filterRow = cueHost.createDiv("curator-voice-cue-filter-row");
      filterRow.createSpan({
        cls: "curator-mono",
        text: `📄 ${uiState.cueSourceLabel}（有效对白 ${uiState.cues.length} 句）`
      });

      // 问题 7：当检测到内嵌或外置多条字幕轨道时，提供字幕语言/轨道切换下拉框
      if (Array.isArray(uiState.subtitleTracks) && uiState.subtitleTracks.length > 0) {
        const trackSelectWrap = filterRow.createDiv("curator-voice-pad-group");
        trackSelectWrap.createSpan({ text: "🌐 字幕轨道:" });
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
        placeholder: "🔍 搜索字幕台词关键词..."
      });
      cueKwInput.style.width = "220px";
      cueKwInput.value = uiState.cueKeyword || "";

      // 手动加载外部字幕按钮
      const loadExtSubBtn = filterRow.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "📄 手动指定字幕文件 (.ass/.srt)"
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
              ? "未检出有效对白字幕轨 · 可在上方切换「🌐 字幕轨道」或点击「📄 手动指定字幕文件 (.ass/.srt)」导入字幕"
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
            text: "✂️ 截取音声"
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
              sliceActionBtn.textContent = "✓ 已入库";
              if (Notice) new Notice(`🎙️ 已截取台词音声：“${cue.text}”`);
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

  const cardsHost = container.createDiv("curator-voice-cards-host");
  const renderVoiceCards = () => {
    cardsHost.empty();
    const allVoices = Array.isArray(plugin.settings?.voiceCollection)
      ? plugin.settings.voiceCollection
      : [];
    if (voiceCountBadgeEl && voiceCountBadgeEl.isConnected) {
      voiceCountBadgeEl.textContent = `共典藏 ${allVoices.length} 条台词音声`;
    }
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-voice-badge"]')
        .forEach((el) => {
          el.textContent = `音声 ${allVoices.length} 条`;
        });
    }
    const list = allVoices.filter((vc) => {
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
        text: "尚未收录台词音声 · 点击右上角「✂️ 从本地视频+字幕截取音声」或「✨ 抽取 ACG 名台词」开始典藏！"
      });
      return;
    }

    const grid = cardsHost.createDiv("curator-voice-cards-grid");
    list.forEach((vc) => {
      const card = grid.createDiv("curator-voice-card");
      const quoteEl = card.createDiv({
        cls: "curator-voice-quote-text",
        text: `“${vc.quoteText}”`
      });
      quoteEl.title = vc.quoteText;

      const metaRow = card.createDiv("curator-voice-meta-row");
      if (vc.characterName) {
        metaRow.createSpan({ cls: "curator-voice-chip is-char", text: `👑 ${vc.characterName}` });
      }
      if (vc.animeTitle) {
        metaRow.createSpan({
          cls: "curator-voice-chip is-anime",
          text: `🎬 《${vc.animeTitle}》${vc.episode ? ` 第${vc.episode}话` : ""}`
        });
      }
      if (vc.timestamp) {
        metaRow.createSpan({ cls: "curator-voice-chip curator-mono", text: `⏱️ ${vc.timestamp}` });
      }

      const diskAudio = resolveVoiceAudioDiskState(plugin, vc.audioPath);
      if (diskAudio.exists && diskAudio.playUrl) {
        const audioWrap = card.createDiv("curator-voice-audio-wrap");
        const audioEl = audioWrap.createEl("audio", {
          cls: "curator-voice-audio-player",
          attr: { controls: "controls", preload: "metadata", src: diskAudio.playUrl }
        });
        audioEl.style.width = "100%";
        audioEl.style.height = "34px";
      } else if (diskAudio.missingFile) {
        const missingRow = card.createDiv("curator-voice-meta-row");
        missingRow.createSpan({
          cls: "curator-voice-chip curator-mono",
          text: `⚠️ 本地音频文件已被删除或移动 (${vc.audioPath})`
        });
      } else {
        const reasonRow = card.createDiv("curator-voice-meta-row");
        reasonRow.createSpan({
          cls: "curator-voice-chip",
          text: vc.audioFallbackReason || "📝 纯文字台词（抽取时未包含原声音频，可绑定本地音频或从剧集截取）"
        });
      }

      const actions = card.createDiv("curator-voice-actions-row");
      if (!diskAudio.exists) {
        const bindAudioBtn = actions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🎵 绑定音频"
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
              const { absDir, vaultBase } = ensureDirectoryAbsolute(
                plugin,
                plugin.settings?.voiceArchiveFolder,
                "附件/台词音声库"
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
                const relVoiceFolder = normalizeVaultRelPath(plugin.settings?.voiceArchiveFolder || "附件/台词音声库") || "附件/台词音声库";
                storedPath = `${relVoiceFolder}/${targetName}`;
                await writeVaultBinaryFile(plugin.app, storedPath, audioBuf);
              }
              vc.audioPath = storedPath;
              delete vc.audioFallbackReason;
              await plugin.saveSettings();
              if (Notice) new Notice(`🎵 已绑定并持久保存音频至：${storedPath}`);
              renderVoiceCards();
            }
          };
          aInput.click();
        };
      }
      const wandBtn = actions.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🪄 关联"
      });
      wandBtn.onclick = () => {
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

      if (vc.sourceVideoPath && fs.existsSync(vc.sourceVideoPath)) {
        const jumpVideoBtn = actions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "🎬 跳原片时间点"
        });
        jumpVideoBtn.onclick = async () => {
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
      }

      const delBtn = actions.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "× 移除"
      });
      delBtn.title = "移除该条台词记录（若关联音声库本地文件且未被其他记录引用，将一并移入系统回收站）";
      delBtn.onclick = async () => {
        const remaining = (plugin.settings.voiceCollection || []).filter(
          (x) => x.id !== vc.id
        );
        plugin.settings.voiceCollection = remaining;
        if (vc.audioPath && !/^https?:\/\//i.test(String(vc.audioPath))) {
          const normAudio = normalizeVaultRelPathCaseInsensitive(plugin, vc.audioPath);
          const normVoiceDir = normalizeVaultRelPathCaseInsensitive(
            plugin,
            plugin.settings?.voiceArchiveFolder || "附件/台词音声库"
          );
          const stillUsed = remaining.some(
            (x) =>
              x &&
              x.audioPath &&
              normalizeVaultRelPathCaseInsensitive(plugin, x.audioPath) === normAudio
          );
          if (!stillUsed && normVoiceDir && normAudio.startsWith(normVoiceDir + "/")) {
            await moveLocalFileToTrashSafely(plugin, vc.audioPath);
          }
        }
        await plugin.saveSettings();
        renderVoiceCards();
      };

      bindMagicWandLongPress(card, () => {
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
      });
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
    const folder = String(plugin.settings?.gameNoteFolder || "游戏笔记").trim() || "游戏笔记";
    const { absDir } = ensureDirectoryAbsolute(plugin, folder, "游戏笔记");
    const safeName = String(game.title).replace(/[\\/:*?"<>|]/g, "_");
    const absFile = path.join(absDir, `${safeName}.md`);

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
          .map((g) => `- [${g.title || g.url}](${g.url})${g.remark ? ` — *备注：${g.remark}*` : ""}`)
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
      `# 🎮 ${game.title}`,
      "",
      `- **游玩状态**：${game.status || "在玩"}`,
      `- **个人评分**：${game.score ? `★ ${Number(game.score).toFixed(1)}` : "未评分"}`,
      `- **累计时长**：${Number(game.playHours || 0).toFixed(1)} 小时`,
      `- **当前进度 / 章节**：${game.currentProgress || "初见"}`,
      `- **启动路径**：\`${game.exePath || game.romPath || "未绑定"}\``,
      "",
      "## 🧭 攻略与资料站导航",
      guidesMd,
      "",
      "## ✅ 进度待办清单 (To-Do)",
      todosMd,
      "",
      "## 📝 时间/进度索引游记手札",
      notesMd,
      ""
    ].join("\n");

    fs.writeFileSync(absFile, md, "utf8");
  } catch (e) {}
}

function launchLocalGameProcess(plugin, game, onSessionEnd) {
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

  // 支持 steam:// 协议链接
  if (/^steam:\/\//i.test(exePath)) {
    window.open(exePath);
    if (Notice) new Notice(`🎮 已通过 Steam 启动《${game.title}》`);
    return;
  }

  if (!fs.existsSync(exePath)) {
    if (Notice) new Notice(`未找到启动文件：${exePath}`);
    return;
  }

  const startTs = Date.now();
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
          ? `🕹️ 已通过模拟器启动《${game.title}》，正在自动记录游玩时长...`
          : `🎮 已启动《${game.title}》，正在自动记录游玩时长...`
      );
    }
    child.on("close", async () => {
      const elapsedHours = Math.max(0.05, (Date.now() - startTs) / 3600000);
      game.playHours = Number(((Number(game.playHours) || 0) + elapsedHours).toFixed(2));
      game.lastPlayedAt = new Date().toISOString();
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      if (typeof onSessionEnd === "function") onSessionEnd();
    });
  } catch (err) {
    if (Notice) new Notice(`启动失败：${err.message}`);
  }
}

function openGameDetailAndNotesModal(plugin, game, onRefresh) {
  const modal = new Modal(plugin.app);
  modal.onOpen = () => {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.addClass("curator-game-detail-modal");
    contentEl.style.maxWidth = "780px";

    if (!Array.isArray(game.todos)) game.todos = [];
    if (!Array.isArray(game.playNotes)) game.playNotes = [];
    if (!Array.isArray(game.strategyUrls)) game.strategyUrls = [];

    const head = contentEl.createDiv("curator-game-modal-head");
    head.createEl("h2", { text: `🎮 《${game.title}》· 进度手札、待办与攻略台` });

    // 顶部进度与时长快速更新栏
    const progRow = contentEl.createDiv("curator-game-prog-strip");
    progRow.createSpan({ text: "📍 当前章节/进度锚点：" });
    const progInput = progRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "例如：共通线 第3章 / 洛琪希线 / 二周目..."
    });
    progInput.style.width = "210px";
    progInput.value = game.currentProgress || "";

    progRow.createSpan({ text: "⏱️ 游玩时长(h)：" });
    const hoursInput = progRow.createEl("input", {
      type: "number",
      cls: "curator-input curator-mono"
    });
    hoursInput.style.width = "76px";
    hoursInput.step = "0.5";
    hoursInput.value = String(game.playHours ?? 0);

    const saveProgBtn = progRow.createEl("button", {
      cls: "curator-dl-mini-btn is-accent",
      text: "✓ 更新进度锚点"
    });
    saveProgBtn.onclick = async () => {
      game.currentProgress = progInput.value.trim();
      game.playHours = Math.max(0, Number(hoursInput.value) || 0);
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      if (Notice) new Notice("已更新当前游戏进度锚点与时长！");
      if (typeof onRefresh === "function") onRefresh();
    };

    // 区块 1：🧭 自定义攻略网址与备注导航
    const guideSec = contentEl.createDiv("curator-game-modal-sec");
    guideSec.createEl("h3", { text: "🧭 攻略与资料站导航（支持附带防剧透/章节备注）" });
    const guideAddRow = guideSec.createDiv("curator-game-inline-add");
    const gTitleInput = guideAddRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "攻略标题（如：全分支好感度攻略）"
    });
    const gUrlInput = guideAddRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "攻略网址 https://..."
    });
    const gRemarkInput = guideAddRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "备注说明（如：第三章迷宫走法，微剧透）"
    });
    const addGuideBtn = guideAddRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "+ 添加攻略"
    });
    addGuideBtn.onclick = async () => {
      const url = gUrlInput.value.trim();
      if (!url) return;
      game.strategyUrls.push({
        id: `guide-${Date.now()}`,
        title: gTitleInput.value.trim() || url,
        url,
        remark: gRemarkInput.value.trim()
      });
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      modal.onOpen();
      if (typeof onRefresh === "function") onRefresh();
    };

    const guideList = guideSec.createDiv("curator-game-sublist");
    game.strategyUrls.forEach((g) => {
      const row = guideList.createDiv("curator-game-subrow");
      const linkBtn = row.createEl("a", {
        cls: "curator-game-guide-link",
        text: `↗ ${g.title || g.url}`,
        href: g.url
      });
      linkBtn.onclick = (ev) => {
        ev.preventDefault();
        window.open(g.url, "_blank");
      };
      if (g.remark) {
        row.createSpan({ cls: "curator-game-guide-remark", text: `💡 备注：${g.remark}` });
      }
      const del = row.createEl("button", { cls: "curator-dl-mini-btn", text: "×" });
      del.onclick = async () => {
        game.strategyUrls = game.strategyUrls.filter((x) => x.id !== g.id);
        await syncGameMarkdownNote(plugin, game);
        await plugin.saveSettings();
        modal.onOpen();
      };
    });

    // 区块 2：✅ 绑定时间/进度的待办清单 (To-Do)
    const todoSec = contentEl.createDiv("curator-game-modal-sec");
    todoSec.createEl("h3", { text: "✅ 进度待办清单（自动记录当前游玩小时数与章节锚点）" });
    const todoAddRow = todoSec.createDiv("curator-game-inline-add");
    const todoInput = todoAddRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "输入待办目标（如：收集水王级魔杖支线 / 回收 Bad End CG）..."
    });
    todoInput.style.flex = "1";
    const addTodoBtn = todoAddRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "+ 记入待办"
    });
    addTodoBtn.onclick = async () => {
      const txt = todoInput.value.trim();
      if (!txt) return;
      const curH = Number(hoursInput.value) || Number(game.playHours) || 0;
      const curProg = progInput.value.trim() || game.currentProgress || "进行中";
      game.todos.unshift({
        id: `todo-${Date.now()}`,
        text: txt,
        done: false,
        progressTag: `${curH}h · ${curProg}`,
        timeLabel: new Date().toLocaleString("zh-CN", { hour12: false })
      });
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      modal.onOpen();
      if (typeof onRefresh === "function") onRefresh();
    };

    const todoList = todoSec.createDiv("curator-game-sublist");
    game.todos.forEach((td) => {
      const row = todoList.createDiv(`curator-game-subrow ${td.done ? "is-done" : ""}`);
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = Boolean(td.done);
      cb.onchange = async () => {
        td.done = cb.checked;
        await syncGameMarkdownNote(plugin, game);
        await plugin.saveSettings();
        modal.onOpen();
        if (typeof onRefresh === "function") onRefresh();
      };
      row.createSpan({ cls: "curator-game-prog-badge curator-mono", text: `[${td.progressTag}]` });
      row.createSpan({ cls: "curator-game-todo-text", text: td.text });
      const del = row.createEl("button", { cls: "curator-dl-mini-btn", text: "×" });
      del.onclick = async () => {
        game.todos = game.todos.filter((x) => x.id !== td.id);
        await syncGameMarkdownNote(plugin, game);
        await plugin.saveSettings();
        modal.onOpen();
      };
    });

    // 区块 3：📝 时间/进度索引游记手札
    const noteSec = contentEl.createDiv("curator-game-modal-sec");
    noteSec.createEl("h3", { text: "📝 时间 / 进度索引游记手札（同步写入本地 Markdown 游戏笔记）" });
    const noteAddRow = noteSec.createDiv("curator-game-inline-add");
    const noteInput = noteAddRow.createEl("textarea", {
      cls: "curator-textarea",
      placeholder: "记录此刻的剧情感想、配装思路或名场面吐槽（将自动打上当前游玩时长与章节戳）..."
    });
    noteInput.rows = 2;
    noteInput.style.flex = "1";
    const addNoteBtn = noteAddRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "✒️ 记入手札"
    });
    addNoteBtn.onclick = async () => {
      const txt = noteInput.value.trim();
      if (!txt) return;
      const curH = Number(hoursInput.value) || Number(game.playHours) || 0;
      const curProg = progInput.value.trim() || game.currentProgress || "初见";
      game.playNotes.unshift({
        id: `gnote-${Date.now()}`,
        text: txt,
        progressTag: `${curH}h · ${curProg}`,
        timeLabel: new Date().toLocaleString("zh-CN", { hour12: false })
      });
      await syncGameMarkdownNote(plugin, game);
      await plugin.saveSettings();
      modal.onOpen();
      if (typeof onRefresh === "function") onRefresh();
    };

    const noteList = noteSec.createDiv("curator-game-sublist");
    game.playNotes.forEach((n) => {
      const row = noteList.createDiv("curator-game-subrow");
      row.createSpan({ cls: "curator-game-prog-badge curator-mono", text: `[${n.progressTag}]` });
      row.createSpan({ cls: "curator-game-todo-text", text: n.text });
      row.createSpan({ cls: "curator-game-note-time curator-mono", text: n.timeLabel || "" });
      const del = row.createEl("button", { cls: "curator-dl-mini-btn", text: "×" });
      del.onclick = async () => {
        game.playNotes = game.playNotes.filter((x) => x.id !== n.id);
        await syncGameMarkdownNote(plugin, game);
        await plugin.saveSettings();
        modal.onOpen();
      };
    });
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

  const games = Array.isArray(plugin.settings?.gameCollection) ? plugin.settings.gameCollection : [];

  // 顶栏
  const header = container.createDiv("curator-char-header");
  const titleSide = header.createDiv("curator-char-header-left");
  titleSide.createDiv({ cls: "curator-char-kicker", text: "LOCAL GAME & EMULATOR ARCHIVE" });
  const hRow = titleSide.createDiv("curator-char-title-row");
  hRow.createEl("h2", { cls: "curator-char-title", text: "🎮 游戏典藏" });
  const gameCountBadgeEl = hRow.createSpan({
    cls: "curator-char-count-badge curator-mono",
    text: `共收录 ${games.length} 部游戏`
  });

  const actionSide = header.createDiv("curator-char-header-right");
  const searchInput = actionSide.createEl("input", {
    type: "text",
    cls: "curator-input curator-char-search-input",
    placeholder: "搜索游戏名称 / 进度 / 开发商..."
  });
  searchInput.value = uiState.searchQuery || "";
  searchInput.oninput = () => {
    uiState.searchQuery = searchInput.value;
    renderGameGrid();
  };

  const addGameBtn = actionSide.createEl("button", {
    cls: `curator-btn ${uiState.showAddDrawer ? "is-active" : "is-primary"}`,
    text: uiState.showAddDrawer ? "▴ 收起游戏收录台" : "＋ 录入本地游戏 / 模拟器 ROM"
  });
  addGameBtn.onclick = () => {
    uiState.showAddDrawer = !uiState.showAddDrawer;
    renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
  };

  if (uiState.showAddDrawer) {
    const drawer = container.createDiv("curator-char-add-drawer");
    drawer.createDiv({
      cls: "curator-char-add-title",
      text: "🕹️ 本地游戏与模拟器 ROM 收录台（支持 Bangumi 游戏封面自动寻访）"
    });

    const row1 = drawer.createDiv("curator-char-draft-row");
    const titleIn = row1.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "游戏名称（如：无职转生 ～到了异世界就拿出真本事～ Quest of Memories）"
    });
    titleIn.style.flex = "2";

    const modeSelect = row1.createEl("select", { cls: "curator-sort-select" });
    [
      { val: "exe", text: "💻 PC 直装游戏 (.exe / .lnk / Steam)" },
      { val: "emulator", text: "🕹️ 模拟器 + ROM 镜像启动" }
    ].forEach((m) => modeSelect.createEl("option", { value: m.val, text: m.text }));

    const bgmFetchBtn = row1.createEl("button", {
      cls: "curator-btn",
      text: "🔍 自动获取 Bangumi 游戏封面"
    });

    const row2 = drawer.createDiv("curator-char-draft-row");
    const exeIn = row2.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "游戏主程序 .exe 路径 / 模拟器 .exe 路径 / steam://rungameid/..."
    });
    exeIn.style.flex = "2";
    const browseExeBtn = row2.createEl("button", {
      cls: "curator-btn",
      text: "📁 浏览程序..."
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

    const rowRom = drawer.createDiv("curator-char-draft-row");
    rowRom.style.display = "none";
    const romIn = rowRom.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "ROM 镜像文件路径（如 .nsp / .xci / .iso / .gba / .nds）"
    });
    romIn.style.flex = "2";
    const browseRomBtn = rowRom.createEl("button", {
      cls: "curator-btn",
      text: "📁 浏览 ROM..."
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

    modeSelect.onchange = () => {
      rowRom.style.display = modeSelect.value === "emulator" ? "flex" : "none";
    };

    const row3 = drawer.createDiv("curator-char-draft-row");
    const coverIn = row3.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "封面图片 URL 或本地路径（可点击上方自动获取）"
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
    scoreIn.value = "9.0";

    bgmFetchBtn.onclick = async () => {
      const q = titleIn.value.trim();
      if (!q) {
        if (Notice) new Notice("请先输入游戏名称！");
        return;
      }
      bgmFetchBtn.disabled = true;
      bgmFetchBtn.textContent = "检索中...";
      try {
        const res = await requestUrl({
          url: "https://api.bgm.tv/v0/search/subjects?limit=5",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": BGM_USER_AGENT
          },
          body: JSON.stringify({ keyword: q, filter: { type: [4] } })
        });
        const first = res?.json?.data?.[0];
        if (first) {
          if (first.name_cn || first.name) titleIn.value = first.name_cn || first.name;
          if (first.images?.large) coverIn.value = first.images.large;
          if (Notice) new Notice(`✨ 已匹配 Bangumi 游戏条目：《${titleIn.value}》`);
        } else if (Notice) {
          new Notice("未检索到同名 Bangumi 游戏条目，可手动指定本地封面图。");
        }
      } catch (e) {
      } finally {
        bgmFetchBtn.disabled = false;
        bgmFetchBtn.textContent = "🔍 自动获取 Bangumi 游戏封面";
      }
    };

    const submitRow = drawer.createDiv("curator-char-draft-actions");
    const saveGameBtn = submitRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "✦ 收入游戏典藏"
    });
    saveGameBtn.onclick = async () => {
      const title = titleIn.value.trim() || "未命名游戏";
      const record = {
        id: `game-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        launchMode: modeSelect.value,
        exePath: exeIn.value.trim(),
        romPath: romIn.value.trim(),
        launchArgs: "",
        coverUrl: coverIn.value.trim(),
        developer: devIn.value.trim(),
        status: "在玩",
        score: Number(scoreIn.value) || 9.0,
        playHours: 0,
        currentProgress: "初见",
        todos: [],
        playNotes: [],
        strategyUrls: [],
        createdAt: new Date().toISOString()
      };
      if (!Array.isArray(plugin.settings.gameCollection)) {
        plugin.settings.gameCollection = [];
      }
      plugin.settings.gameCollection.unshift(record);
      await syncGameMarkdownNote(plugin, record);
      await plugin.saveSettings();
      uiState.showAddDrawer = false;
      if (Notice) new Notice(`🎮 已将《${title}》收入游戏典藏并生成本地笔记！`);
      renderGameLibraryWorkspace(plugin, container, vaultAnimeItems, options);
    };
  }

  const gridHost = container.createDiv("curator-game-grid-host");
  const renderGameGrid = () => {
    gridHost.empty();
    const allGames = Array.isArray(plugin.settings?.gameCollection)
      ? plugin.settings.gameCollection
      : [];
    if (gameCountBadgeEl && gameCountBadgeEl.isConnected) {
      gameCountBadgeEl.textContent = `共收录 ${allGames.length} 部游戏`;
    }
    if (typeof document !== "undefined") {
      document
        .querySelectorAll('[data-stat-role="workspace-game-badge"]')
        .forEach((el) => {
          el.textContent = `游戏 ${allGames.length} 部`;
        });
    }
    const list = allGames.filter((gm) => {
      const q = String(uiState.searchQuery || "").trim().toLowerCase();
      if (!q) return true;
      const hay = [gm.title, gm.developer, gm.currentProgress, gm.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    if (list.length === 0) {
      gridHost.createDiv({
        cls: "curator-rs-empty",
        text: "尚未收录本地游戏 · 点击右上角「＋ 录入本地游戏 / 模拟器 ROM」即可一站式管理启动、进度手札、待办与攻略网址！"
      });
      return;
    }

    const grid = gridHost.createDiv("curator-game-cards-grid");
    list.forEach((gm) => {
      const card = grid.createDiv("curator-game-card");
      const coverBox = card.createDiv("curator-game-cover-box");
      const coverSrc = resolveLocalOrVaultImageUrl(plugin, gm.coverUrl);
      if (coverSrc) {
        const img = coverBox.createEl("img", {
          cls: "curator-game-cover-img",
          attr: { src: coverSrc, alt: gm.title }
        });
        img.loading = "lazy";
      } else {
        coverBox.createDiv({ cls: "curator-game-cover-fallback", text: "🎮" });
      }

      const statusBadge = coverBox.createSpan({
        cls: "curator-game-status-badge",
        text: gm.status || "在玩"
      });
      statusBadge.title = "点击切换游玩状态";
      statusBadge.onclick = async (ev) => {
        ev.stopPropagation();
        const order = ["在玩", "通关", "全成就", "想玩", "搁置"];
        const nextIdx = (order.indexOf(gm.status || "在玩") + 1) % order.length;
        gm.status = order[nextIdx];
        await syncGameMarkdownNote(plugin, gm);
        await plugin.saveSettings();
        renderGameGrid();
      };

      const body = card.createDiv("curator-game-card-body");
      body.createDiv({ cls: "curator-game-card-title", text: gm.title });
      body.createDiv({
        cls: "curator-game-card-meta curator-mono",
        text: `⏱️ ${Number(gm.playHours || 0).toFixed(1)}h · 📍 ${gm.currentProgress || "初见"} · ★${Number(gm.score || 9.0).toFixed(1)}`
      });

      const todoOpenCount = (gm.todos || []).filter((t) => !t.done).length;
      const noteCount = (gm.playNotes || []).length;
      const guideCount = (gm.strategyUrls || []).length;
      body.createDiv({
        cls: "curator-game-card-counts",
        text: `✅ 待办 ${todoOpenCount} 项 · 📝 手札 ${noteCount} 条 · 🧭 攻略 ${guideCount} 个`
      });

      // 攻略快速胶囊行
      if (Array.isArray(gm.strategyUrls) && gm.strategyUrls.length > 0) {
        const gRow = body.createDiv("curator-game-quick-guides");
        gm.strategyUrls.slice(0, 2).forEach((g) => {
          const pill = gRow.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: `🧭 ${g.title || "攻略"}`
          });
          pill.title = g.remark ? `备注：${g.remark}\n网址：${g.url}` : g.url;
          pill.onclick = (ev) => {
            ev.stopPropagation();
            window.open(g.url, "_blank");
          };
        });
      }

      const actions = body.createDiv("curator-game-card-actions");
      const launchBtn = actions.createEl("button", {
        cls: "curator-btn is-primary",
        text: gm.launchMode === "emulator" ? "🕹️ 模拟器启动" : "▶ 启动游戏"
      });
      launchBtn.onclick = (ev) => {
        ev.stopPropagation();
        launchLocalGameProcess(plugin, gm, renderGameGrid);
      };

      const notesBtn = actions.createEl("button", {
        cls: "curator-btn",
        text: "📝 手札/待办/攻略"
      });
      notesBtn.onclick = (ev) => {
        ev.stopPropagation();
        openGameDetailAndNotesModal(plugin, gm, renderGameGrid);
      };

      const wandBtn = actions.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🪄"
      });
      wandBtn.title = "打开洛琪希魔杖同源关联谱";
      wandBtn.onclick = (ev) => {
        ev.stopPropagation();
        openMagicWandRelationModal(
          plugin,
          { type: "game", id: gm.id, title: gm.title, studio: gm.developer },
          vaultAnimeItems,
          options.wandCallbacks
        );
      };

      const delBtn = actions.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "×"
      });
      delBtn.title = "移除该部游戏记录";
      delBtn.onclick = async (ev) => {
        ev.stopPropagation();
        plugin.settings.gameCollection = (plugin.settings.gameCollection || []).filter(
          (x) => x.id !== gm.id
        );
        await plugin.saveSettings();
        renderGameGrid();
      };

      bindMagicWandLongPress(card, () => {
        openMagicWandRelationModal(
          plugin,
          { type: "game", id: gm.id, title: gm.title, studio: gm.developer },
          vaultAnimeItems,
          options.wandCallbacks
        );
      });
    });
  };

  renderGameGrid();
}

/**
 * 注入四大新馆藏能力与魔杖长按星轨关联的专属样式
 */
function getMultiHallStyles() {
  return `
/* 🪄 法杖长按蓄力水波纹与星轨关联模态框 */
.is-wand-charging {
  position: relative;
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
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
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
}
.curator-voice-quote-text {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
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
}
.curator-voice-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* 🎮 游戏典藏阁 */
.curator-game-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
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
}
.curator-game-card-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.curator-game-card-title {
  font-weight: 700;
  font-size: 14px;
}
.curator-game-card-meta, .curator-game-card-counts {
  font-size: 11.5px;
  opacity: 0.8;
}
.curator-game-quick-guides {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.curator-game-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
}
.curator-game-prog-strip, .curator-game-inline-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.curator-game-sublist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.curator-game-subrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--background-secondary);
  font-size: 12.5px;
}
.curator-game-subrow.is-done .curator-game-todo-text {
  text-decoration: line-through;
  opacity: 0.6;
}
.curator-game-prog-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(59, 105, 152, 0.16);
  color: #3b6998;
}
.curator-game-todo-text {
  flex: 1;
}
.curator-game-guide-remark {
  font-size: 11.5px;
  opacity: 0.78;
  flex: 1;
}
`;
}

module.exports = {
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
  getMultiHallStyles
};
