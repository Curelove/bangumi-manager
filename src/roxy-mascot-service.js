/**
 * Bangumi Manager — 洛琪希（Roxy Migurdia）馆藏记录员服务
 *
 * 设计特征：
 * 1. 完整启用全部 7 张洛琪希立绘（explain / surprised / panic / warn / warn2 / blocked / success），预加载零闪烁。
 * 2. 台词语气贴合《无职转生》洛琪希·米格路迪亚（认真、谦逊、略带教师叮嘱感，连续戳刺时会有软气抗议与慌张讨饶），纯台词无括号动作描写。
 * 3. 借鉴 dsh-whale-widget 玩偶按压与点击序列设计：取消循环摇晃，底部中心锚定（transform-origin: 50% 100%），每次点击触发单次 Q 弹动效并弹出新气泡。
 * 4. 首要事项优先展示 + 多维真实数据咨讯轮播（新番开播与档期日历、近期 BGM 评分情报、个人品味分差、待补完/待评分督导、库存叹气、时段问候）+ 一键「↺ 首要」还原。
 * 5. 资源通过 Obsidian 插件相对目录（manifest.dir + "/assets/roxy/..."）加载，严禁硬编码本地磁盘绝对路径。
 */

const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv,
  pluginAssetExists,
  writePluginAssetBinary
} = require("./platform-env.js");

const ROXY_PORTRAIT_FILES = {
  idle: "roxy_explain.png",
  explain: "roxy_explain.png",
  surprised: "roxy_surprised.png",
  blocked: "roxy_blocked.png",
  warn: "roxy_warn.png",
  warn2: "roxy_warn2.png",
  success: "roxy_success.png",
  panic: "roxy_panic.png",
  overpoke: "roxy_panic.png",
  plushie01: "chibi_plushie01.png",
  plushie02: "chibi_plushie02.png"
};

/**
 * 内置校准版 8 态 Q 版洛琪希像素立绘 + 2 款百连击替身玩偶（无需用户额外下载高清立绘包）
 * 已以 chibi_alert.png 为基准完成头部比例、发色、肤色与大衣色调像素级一致性校准
 */
const ROXY_CHIBI_SPRITE_FILES = {
  idle: "chibi_guide.png",
  explain: "chibi_guide.png",
  surprised: "chibi_alert.png",
  success: "chibi_cheer.png",
  blocked: "chibi_helpless.png",
  warn2: "chibi_lecture.png",
  warn: "chibi_pout.png",
  panic: "chibi_fluster.png",
  overpoke: "chibi_overpoke.png",
  plushie01: "chibi_plushie01.png",
  plushie02: "chibi_plushie02.png"
};

const STATE_LABELS = {
  idle: "导览",
  explain: "导览",
  success: "欣慰",
  surprised: "发现",
  blocked: "无奈",
  warn2: "叮嘱",
  warn: "抗议",
  panic: "慌张",
  overpoke: "惊吓",
  plushie01: "替身玩偶",
  plushie02: "替身玩偶"
};

function getMascotDisplayName(plugin) {
  const custom = String(plugin?.settings?.customMascotName || "").trim();
  return custom || "洛琪希";
}

const STATE_ALIAS_MAP = {
  idle: ["guide", "explain", "idle"],
  explain: ["guide", "explain", "idle"],
  guide: ["guide", "explain", "idle"],
  surprised: ["alert", "surprised"],
  alert: ["alert", "surprised"],
  success: ["cheer", "success"],
  cheer: ["cheer", "success"],
  blocked: ["helpless", "blocked"],
  helpless: ["helpless", "blocked"],
  warn2: ["lecture", "warn2"],
  lecture: ["lecture", "warn2"],
  warn: ["pout", "warn"],
  pout: ["pout", "warn"],
  panic: ["fluster", "panic"],
  fluster: ["fluster", "panic"],
  overpoke: ["overpoke", "fluster", "panic"],
  plushie01: ["plushie", "plushie01"],
  plushie02: ["plushie", "plushie02"],
  plushie: ["plushie", "plushie01", "plushie02"]
};

function resolveCustomPortraitOverride(plugin, stateKey) {
  const map = plugin?.settings?.customMascotPortraits;
  if (!map || typeof map !== "object") return "";
  const candidates = STATE_ALIAS_MAP[stateKey] || [stateKey];
  let raw = "";
  for (const k of candidates) {
    if (map[k] && String(map[k]).trim()) {
      raw = String(map[k]).trim();
      break;
    }
  }
  if (!raw) raw = String(map.guide || map.explain || "").trim();
  if (!raw) return "";
  if (/^(?:https?:|data:|app:|capacitor:|file:)/i.test(raw)) return raw;
  const cleanPath = raw.replace(/\\/g, "/");
  const isExternalAbs =
    /^[A-Za-z]:\//.test(cleanPath) ||
    cleanPath.startsWith("//") ||
    raw.startsWith("\\\\") ||
    /^\/(?:Users|Volumes|home|mnt|media|var|opt|tmp|private)\//i.test(cleanPath);
  if (isExternalAbs) {
    const { toExternalLocalMediaUrl } = require("./platform-env.js");
    return toExternalLocalMediaUrl(raw);
  }
  try {
    if (plugin?.app?.vault?.adapter?.getResourcePath) {
      const cleanRel = cleanPath.replace(/^\//, "");
      return plugin.app.vault.adapter.getResourcePath(cleanRel);
    }
  } catch (e) {}
  return raw;
}

function applyCustomDialogueOverride(plugin, categoryOrState, defaultMessage) {
  const customName = getMascotDisplayName(plugin);
  let msg = String(defaultMessage || "");
  if (customName !== "洛琪希") {
    msg = msg.replace(/洛琪希/g, customName);
  }
  const pool = plugin?.settings?.customMascotDialogues;
  if (pool && typeof pool === "object") {
    const candidates = STATE_ALIAS_MAP[categoryOrState] || [categoryOrState];
    for (const k of candidates) {
      const list = pool[k];
      if (Array.isArray(list) && list.length > 0) {
        const valid = list.map((s) => String(s || "").trim()).filter(Boolean);
        if (valid.length > 0) {
          msg = valid[Math.floor(Math.random() * valid.length)];
          break;
        }
      } else if (typeof list === "string" && list.trim()) {
        const lines = list
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          msg = lines[Math.floor(Math.random() * lines.length)];
          break;
        }
      }
    }
    const rulesRaw = String(pool._replaceRules || "").trim();
    if (rulesRaw) {
      for (const ruleLine of rulesRaw.split(/\r?\n/)) {
        const idx = ruleLine.indexOf("=>");
        if (idx > 0) {
          const fromStr = ruleLine.slice(0, idx).trim();
          const toStr = ruleLine.slice(idx + 2).trim();
          if (fromStr) {
            msg = msg.split(fromStr).join(toStr);
          }
        }
      }
    }
  }
  return msg;
}

const PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4
};

const COOLDOWN_BY_PRIORITY = {
  [PRIORITY.LOW]: 12000,
  [PRIORITY.NORMAL]: 4500,
  [PRIORITY.HIGH]: 1600,
  [PRIORITY.CRITICAL]: 0
};

const DEDUPE_WINDOW_MS = 10000;

/**
 * 获取插件内部 assets/roxy 的相对路径与本地磁盘绝对路径
 */
function getRoxyAssetDirs(plugin) {
  const configDir = String(plugin?.app?.vault?.configDir || ".obsidian")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const baseDir =
    plugin && plugin.manifest && plugin.manifest.dir
      ? plugin.manifest.dir.replace(/\\/g, "/").replace(/\/$/, "")
      : `${configDir}/plugins/bangumi-manager`;
  const relDir = `${baseDir}/assets/roxy`;
  let absDir = "";
  try {
    const path = tryRequireNode("path");
    const vaultBase =
      isDesktopNodeAvailable() &&
      plugin?.app?.vault?.adapter &&
      typeof plugin.app.vault.adapter.getBasePath === "function"
        ? plugin.app.vault.adapter.getBasePath()
        : "";
    if (path && vaultBase) {
      absDir = path.join(vaultBase, baseDir, "assets", "roxy");
    }
  } catch (err) {
    // ignore
  }
  return { baseDir, relDir, absDir };
}

const HD_PORTRAIT_ONLY_FILES = [
  "roxy_explain.png",
  "roxy_surprised.png",
  "roxy_blocked.png",
  "roxy_warn.png",
  "roxy_warn2.png",
  "roxy_success.png",
  "roxy_panic.png"
];

/**
 * 检测本地是否已安装 7 张洛琪希高清半身立绘扩展包（适配 BRAT 仅下载 main.js + manifest.json 的场景与移动端 Vault adapter）
 */
function checkRoxyHdPortraitsStatus(plugin) {
  const uniqueFiles = HD_PORTRAIT_ONLY_FILES;
  const { relDir, absDir } = getRoxyAssetDirs(plugin);
  const missingFiles = [];

  if (plugin && plugin._roxyHdAdapterInstalled === true) {
    return {
      installed: true,
      foundCount: uniqueFiles.length,
      existingCount: uniqueFiles.length,
      totalCount: uniqueFiles.length,
      missingFiles: [],
      relDir,
      absDir
    };
  }

  try {
    const fs = tryRequireNode("fs");
    const path = tryRequireNode("path");
    if (fs && path && absDir) {
      for (const file of uniqueFiles) {
        const fullPath = path.join(absDir, file);
        if (!fs.existsSync(fullPath)) {
          missingFiles.push(file);
        } else {
          const stat = fs.statSync(fullPath);
          if (!stat || stat.size < 1024) {
            missingFiles.push(file);
          }
        }
      }
    } else {
      missingFiles.push(...uniqueFiles);
    }
  } catch (err) {
    missingFiles.push(...uniqueFiles);
  }

  const foundCount = uniqueFiles.length - missingFiles.length;
  return {
    installed: missingFiles.length === 0,
    foundCount,
    existingCount: foundCount,
    totalCount: uniqueFiles.length,
    missingFiles,
    relDir,
    absDir
  };
}

/**
 * 规范化二维馆藏记录员（总开关 enableRoxy2DMascotMaster）与高清立绘版 / 轻量像素形象模式的互斥及前置状态
 * - enableRoxy2DMascotMaster 为前置总开关：未开启时后续两个设置灰显禁用，二维记录员不挂载
 * - 未安装高清立绘扩展包时：默认直接启用内置校准版 8 态轻量像素形象（无需用户下载立绘包）
 * - 已安装高清扩展包时：enableRoxy2DMascot（高清立绘版洛琪希）与 roxyForceLightweight2D（轻量像素形象洛琪希）互斥切换
 */
function normalizeRoxy2DModeSettings(plugin) {
  if (!plugin || !plugin.settings) {
    return { masterEnabled: false, hdInstalled: false, useHd: false, usePixel: false, isEnabled: false };
  }
  const hdStatus = checkRoxyHdPortraitsStatus(plugin);
  const hdInstalled = Boolean(hdStatus.installed);

  if (typeof plugin.settings.enableRoxy2DMascotMaster !== "boolean") {
    const legacyActive =
      plugin.settings.enableRoxy2DMascot !== false || plugin.settings.roxyForceLightweight2D !== false;
    plugin.settings.enableRoxy2DMascotMaster = legacyActive;
  }

  const masterEnabled = plugin.settings.enableRoxy2DMascotMaster !== false;

  if (!hdInstalled) {
    if (plugin.settings.enableRoxy2DMascot === true) {
      plugin.settings.enableRoxy2DMascot = false;
      if (!plugin.settings._roxy2DModeMigrated) {
        plugin.settings.roxyForceLightweight2D = true;
        plugin.settings._roxy2DModeMigrated = true;
      }
    }
    if (masterEnabled && plugin.settings.roxyForceLightweight2D !== true) {
      plugin.settings.roxyForceLightweight2D = true;
    }
  } else {
    if (plugin.settings.enableRoxy2DMascot === true && plugin.settings.roxyForceLightweight2D === true) {
      plugin.settings.roxyForceLightweight2D = false;
    } else if (
      masterEnabled &&
      plugin.settings.enableRoxy2DMascot !== true &&
      plugin.settings.roxyForceLightweight2D !== true
    ) {
      plugin.settings.enableRoxy2DMascot = true;
      plugin.settings.roxyForceLightweight2D = false;
    }
  }

  const useHd =
    masterEnabled &&
    hdInstalled &&
    plugin.settings.enableRoxy2DMascot === true &&
    plugin.settings.roxyForceLightweight2D !== true;
  const usePixel =
    masterEnabled &&
    plugin.settings.roxyForceLightweight2D === true &&
    (!hdInstalled || plugin.settings.enableRoxy2DMascot !== true);
  return {
    masterEnabled,
    hdInstalled,
    hdStatus,
    useHd,
    usePixel,
    isEnabled: masterEnabled && (useHd || usePixel)
  };
}

/**
 * 洛琪希不同立绘状态下的嘴部精确坐标与贴条倾角表（基于 1024x1536 像素级测量校准）
 * - hd：对应 7 张高清立绘（roxy_*.png）在 146x219 舞台中的嘴部百分比坐标
 * - chibi2d：对应 8 张 Q 版像素立绘（chibi_*.png）在 138x148 容器中的嘴部百分比坐标
 * - chibi3d：对应三维手办框（66x70 容器）中的嘴部百分比坐标与微缩尺寸
 */
const BANDAGE_STATE_CANONICAL_MAP = {
  idle: "explain",
  explain: "explain",
  guide: "explain",
  surprised: "surprised",
  alert: "surprised",
  blocked: "blocked",
  helpless: "blocked",
  warn: "warn",
  pout: "warn",
  warn2: "warn2",
  lecture: "warn2",
  success: "success",
  cheer: "success",
  panic: "panic",
  fluster: "panic",
  overpoke: "overpoke"
};

const ROXY_MOUTH_BANDAGE_COORDS = {
  hd: {
    idle: { left: "49.0%", top: "16.2%", w: 18, h: 6.5, rot: -2 },
    explain: { left: "49.0%", top: "16.2%", w: 18, h: 6.5, rot: -2 },
    surprised: { left: "49.3%", top: "18.8%", w: 17, h: 6.5, rot: -1 },
    blocked: { left: "50.8%", top: "22.1%", w: 17, h: 6, rot: -6 },
    warn: { left: "49.1%", top: "16.3%", w: 17, h: 6, rot: 1 },
    warn2: { left: "48.9%", top: "16.3%", w: 17, h: 6, rot: -2 },
    success: { left: "49.0%", top: "16.9%", w: 19, h: 7, rot: -2 },
    panic: { left: "49.0%", top: "17.3%", w: 20, h: 7.2, rot: 1 },
    overpoke: { left: "49.0%", top: "17.3%", w: 20, h: 7.2, rot: 1 }
  },
  chibi2d: {
    idle: { left: "49.3%", top: "34.2%", w: 20, h: 7.5, rot: -2 },
    explain: { left: "49.3%", top: "34.2%", w: 20, h: 7.5, rot: -2 },
    surprised: { left: "48.7%", top: "34.3%", w: 19, h: 7.5, rot: -1 },
    success: { left: "49.3%", top: "33.4%", w: 21, h: 7.8, rot: -2 },
    blocked: { left: "49.3%", top: "34.6%", w: 20, h: 7.5, rot: -3 },
    warn2: { left: "48.8%", top: "34.5%", w: 19, h: 7.5, rot: -2 },
    warn: { left: "49.0%", top: "34.3%", w: 20, h: 7.5, rot: 2 },
    panic: { left: "48.9%", top: "33.9%", w: 23, h: 8.2, rot: 2 },
    overpoke: { left: "49.0%", top: "33.4%", w: 23, h: 8.2, rot: -3 }
  },
  chibi3d: {
    idle: { left: "49.2%", top: "34.2%", w: 11.5, h: 4.5, rot: -2 },
    explain: { left: "49.2%", top: "34.2%", w: 11.5, h: 4.5, rot: -2 },
    surprised: { left: "48.6%", top: "34.3%", w: 11, h: 4.5, rot: -1 },
    success: { left: "49.2%", top: "33.4%", w: 12.2, h: 4.8, rot: -2 },
    blocked: { left: "49.2%", top: "34.6%", w: 11.5, h: 4.5, rot: -3 },
    warn2: { left: "48.8%", top: "34.5%", w: 11, h: 4.5, rot: -2 },
    warn: { left: "49.0%", top: "34.3%", w: 11.5, h: 4.5, rot: 2 },
    panic: { left: "48.9%", top: "33.9%", w: 13.2, h: 5.0, rot: 2 },
    overpoke: { left: "49.0%", top: "33.4%", w: 13.2, h: 5.0, rot: -3 }
  }
};

function applyMouthBandageGeometry(bandageEl, modeKey, stateKey) {
  if (!bandageEl) return;
  if (stateKey === "plushie01" || stateKey === "plushie02" || stateKey === "plushie") {
    bandageEl.style.display = "none";
    return;
  }
  bandageEl.style.display = "";
  const canonicalState = BANDAGE_STATE_CANONICAL_MAP[stateKey] || stateKey || "explain";
  const table = ROXY_MOUTH_BANDAGE_COORDS[modeKey] || ROXY_MOUTH_BANDAGE_COORDS.chibi2d;
  const cfg = table[canonicalState] || table.explain;
  bandageEl.style.left = cfg.left;
  bandageEl.style.top = cfg.top;
  bandageEl.style.width = `${cfg.w}px`;
  bandageEl.style.height = `${cfg.h}px`;
  bandageEl.style.setProperty("--roxy-bandage-rot", `${cfg.rot}deg`);
  bandageEl.style.setProperty("--bandage-rot", `${cfg.rot}deg`);
  bandageEl.dataset.bandageRot = String(cfg.rot);
  bandageEl.dataset.bandageW = String(cfg.w);
  bandageEl.dataset.bandageH = String(cfg.h);
}

/**
 * 触发贴上嘴部静音小封条的飞入压合弹性动效（纯 RAF 逐帧驱动，零 CSS/WAAPI 冲突）
 * - 第一阶段（0 ~ 215ms）：封条在立绘前方显眼放大（3.1x）并从左上方带着投影飞扑向嘴部，期间立绘保持静止以确保飞入轨迹清晰可见；
 * - 第二阶段（215ms 触嘴瞬间）：触发 onImpact 回调（驱动洛琪希因封条拍上嘴部而产生 Q 弹后仰反应）；
 * - 第三阶段（215 ~ 560ms）：封条在嘴部完成压扁与果冻回弹并严密贴合。
 */
function playBandageStickOnAnimation(bandageEl, options = {}) {
  if (!bandageEl) return;
  if (bandageEl._roxyStickCleanup) {
    try {
      bandageEl._roxyStickCleanup();
    } catch (_) {}
    bandageEl._roxyStickCleanup = null;
  }
  if (bandageEl._roxyStickAnim) {
    try {
      bandageEl._roxyStickAnim.cancel();
    } catch (_) {}
    bandageEl._roxyStickAnim = null;
  }

  bandageEl.classList.remove("is-dropping", "is-sticking");
  bandageEl.classList.add("is-visible");

  const rot = Number(bandageEl.dataset.bandageRot);
  const baseRot = Number.isFinite(rot) ? rot : -2;
  const DURATION_MS = 560;
  const IMPACT_MS = 215;
  const startTime = performance.now();
  let impactFired = false;
  let rafId = null;
  let cancelled = false;

  const resetInlineStyles = () => {
    bandageEl.style.opacity = "";
    bandageEl.style.transform = "";
    bandageEl.style.boxShadow = "";
  };

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    resetInlineStyles();
    if (bandageEl._roxyStickCleanup === cleanup) {
      bandageEl._roxyStickCleanup = null;
    }
  };
  bandageEl._roxyStickCleanup = cleanup;

  const step = (now) => {
    if (cancelled) return;
    if (!bandageEl.isConnected || !bandageEl.classList.contains("is-visible")) {
      cleanup();
      return;
    }
    const elapsed = Math.max(0, now - startTime);
    const p = Math.min(1, elapsed / DURATION_MS);

    if (!impactFired && elapsed >= IMPACT_MS) {
      impactFired = true;
      if (typeof options.onImpact === "function") {
        options.onImpact();
      }
    }

    let dx = 0;
    let dy = 0;
    let sx = 1;
    let sy = 1;
    let curRot = baseRot;
    let opacity = 1;
    let shadowBlur = 4;
    let shadowY = 1.5;

    if (elapsed < IMPACT_MS) {
      // 阶段一：从左上方 3.1x 放大飞扑向嘴部压合（0 ~ 215ms）
      const t = elapsed / IMPACT_MS;
      const easeIn = t * t * (2.2 - 1.2 * t);
      dx = -14 * (1 - easeIn);
      dy = -26 * (1 - easeIn);
      sx = 3.1 - (3.1 - 0.76) * easeIn;
      sy = 3.1 - (3.1 - 0.80) * easeIn;
      curRot = baseRot - 26 * (1 - easeIn) + 5 * easeIn;
      opacity = Math.min(1, 0.38 + t * 2.2);
      shadowBlur = 16 * (1 - easeIn) + 2;
      shadowY = 10 * (1 - easeIn) + 1;
    } else if (elapsed < 345) {
      // 阶段二：拍上嘴部后的第一次果冻外扩回弹（215 ~ 345ms）
      const t = (elapsed - IMPACT_MS) / (345 - IMPACT_MS);
      const easeOut = 1 - Math.pow(1 - t, 2);
      sx = 0.76 + (1.24 - 0.76) * easeOut;
      sy = 0.80 + (0.88 - 0.80) * easeOut;
      curRot = baseRot + 5 - 8 * easeOut;
    } else if (elapsed < 455) {
      // 阶段三：反向微收（345 ~ 455ms）
      const t = (elapsed - 345) / (455 - 345);
      sx = 1.24 + (0.94 - 1.24) * t;
      sy = 0.88 + (1.06 - 0.88) * t;
      curRot = baseRot - 3 + 4 * t;
    } else {
      // 阶段四：严丝合缝定格在嘴部（455 ~ 560ms）
      const t = (elapsed - 455) / (DURATION_MS - 455);
      sx = 0.94 + (1.0 - 0.94) * t;
      sy = 1.06 + (1.0 - 1.06) * t;
      curRot = baseRot + 1 * (1 - t);
    }

    bandageEl.style.opacity = opacity.toFixed(3);
    bandageEl.style.boxShadow = `0 ${shadowY.toFixed(1)}px ${shadowBlur.toFixed(1)}px rgba(36,24,14,0.28), inset 0 0.5px 0 rgba(255,255,255,0.95)`;
    bandageEl.style.transform = `translate(-50%, -50%) translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) rotate(${curRot.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;

    if (p >= 1) {
      cleanup();
      return;
    }
    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);
  return cleanup;
}

/**
 * “刻舟求剑”式独立封条飘落动效：
 * 点击「🩹 解封」瞬间，在封条当前所处的页面世界坐标处生成一枚完全独立于立绘状态的封条替身（挂载于 document.body 规避 Obsidian leaf contain 偏移）：
 * - 无论用户随后如何点击洛琪希（触发立绘切换、Q弹、下拉回顶或百连击），替身封条都不受立绘影响；
 * - 无论用户如何上滚或下滑番剧档案馆页面，替身封条都锚定在解封那一刻的页面原位置（刻舟求剑）逐渐摇曳偏落并淡出；
 * - 若上滚或下滑超出当前视口边界，替身封条自然随页面滚出视野。
 */
function spawnDetachedFallingBandage(sourceBandageEl, options = {}) {
  if (!sourceBandageEl || typeof document === "undefined" || !document.body) return () => {};
  const rect = sourceBandageEl.getBoundingClientRect();
  const is3D = Boolean(options.is3D);
  const w = Number(sourceBandageEl.dataset.bandageW) || (rect && rect.width) || (is3D ? 11.5 : 18);
  const h = Number(sourceBandageEl.dataset.bandageH) || (rect && rect.height) || (is3D ? 4.5 : 6.5);
  const rawRot = Number(sourceBandageEl.dataset.bandageRot);
  const baseRot = Number.isFinite(rawRot) ? rawRot : -2;

  let startClientX = 0;
  let startClientY = 0;
  if (rect && rect.width >= 2 && rect.height >= 2) {
    startClientX = rect.left + rect.width / 2;
    startClientY = rect.top + rect.height / 2;
  } else if (options.stageEl) {
    const stageRect = options.stageEl.getBoundingClientRect();
    if (stageRect && stageRect.width >= 10 && stageRect.height >= 10) {
      const leftPct = parseFloat(sourceBandageEl.style.left) || 49.0;
      const topPct = parseFloat(sourceBandageEl.style.top) || (options.isChibi ? 34.2 : 16.5);
      startClientX = stageRect.left + (stageRect.width * leftPct) / 100;
      startClientY = stageRect.top + (stageRect.height * topPct) / 100;
    } else {
      return () => {};
    }
  } else {
    return () => {};
  }

  const anchorEl = options.anchorEl || null;
  const scrollEl = options.scrollEl || null;
  const paneEl = options.paneEl || scrollEl || null;

  const anchorRect0 = anchorEl ? anchorEl.getBoundingClientRect() : null;
  const scrollTop0 = scrollEl ? scrollEl.scrollTop || 0 : 0;
  const scrollLeft0 = scrollEl ? scrollEl.scrollLeft || 0 : 0;

  const detachedEl = document.createElement("div");
  detachedEl.className = `roxy-mouth-bandage roxy-detached-falling-bandage is-visible${is3D ? " is-3d" : ""}`;
  const crossSpan = document.createElement("span");
  crossSpan.className = "roxy-mouth-bandage-cross";
  crossSpan.textContent = "×";
  detachedEl.appendChild(crossSpan);

  detachedEl.style.position = "fixed";
  detachedEl.style.left = "0px";
  detachedEl.style.top = "0px";
  detachedEl.style.width = `${w}px`;
  detachedEl.style.height = `${h}px`;
  detachedEl.style.setProperty("z-index", "9999", "important");
  detachedEl.style.pointerEvents = "none";
  detachedEl.style.margin = "0";
  detachedEl.style.display = "inline-flex";
  detachedEl.style.visibility = "visible";
  detachedEl.style.opacity = "1";
  detachedEl.style.transform = "none";
  detachedEl.style.willChange = "transform, opacity";

  const mountHost =
    (options.hostEl && options.hostEl.isConnected ? options.hostEl : null) ||
    document.body;
  mountHost.appendChild(detachedEl);

  // 校准 fixed 坐标系原点，彻底消除 Obsidian .workspace-leaf-content (contain: strict) 导致的偏移
  const zeroRect = detachedEl.getBoundingClientRect();
  const baseLeft = startClientX - zeroRect.left;
  const baseTop = startClientY - zeroRect.top;
  detachedEl.style.left = `${baseLeft.toFixed(2)}px`;
  detachedEl.style.top = `${baseTop.toFixed(2)}px`;

  const DURATION_MS = 2800;
  const startTime = performance.now();
  const swayDir = Math.random() < 0.5 ? 1 : -1;
  let rafId = null;
  let finished = false;
  let latestDropX = 0;
  let latestDropY = 0;
  let latestRot = baseRot;
  let latestScaleX = 1;
  let latestScaleY = 1;
  let latestOpacity = 1;

  const computeScrollDelta = () => {
    if (scrollEl && scrollEl.isConnected) {
      const sdx = -((scrollEl.scrollLeft || 0) - scrollLeft0);
      const sdy = -((scrollEl.scrollTop || 0) - scrollTop0);
      if (Math.abs(sdx) > 0.2 || Math.abs(sdy) > 0.2) {
        return { dx: sdx, dy: sdy };
      }
    }
    if (anchorEl && anchorRect0 && anchorEl.isConnected && anchorEl !== scrollEl) {
      const cur = anchorEl.getBoundingClientRect();
      const dx = cur.left - anchorRect0.left;
      const dy = cur.top - anchorRect0.top;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        return { dx, dy };
      }
    }
    return { dx: 0, dy: 0 };
  };

  const applyTransform = () => {
    if (finished) return;
    const { dx: scrollDx, dy: scrollDy } = computeScrollDelta();
    const offsetX = scrollDx + latestDropX;
    const offsetY = scrollDy + latestDropY;
    const curScreenX = startClientX + offsetX;
    const curScreenY = startClientY + offsetY;

    if (
      paneEl &&
      paneEl !== document.body &&
      (Math.abs(scrollDy) > 4 || Math.abs(scrollDx) > 4)
    ) {
      const paneRect = paneEl.getBoundingClientRect();
      if (paneRect && paneRect.height > 40 && paneRect.width > 40) {
        const outOfPane =
          curScreenY + h < paneRect.top + 2 ||
          curScreenY - h > paneRect.bottom - 2 ||
          curScreenX + w < paneRect.left + 2 ||
          curScreenX - w > paneRect.right - 2;
        detachedEl.style.visibility = outOfPane ? "hidden" : "visible";
      }
    } else {
      detachedEl.style.visibility = "visible";
    }

    detachedEl.style.opacity = latestOpacity.toFixed(3);
    detachedEl.style.transform = `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0) translate(-50%, -50%) rotate(${latestRot.toFixed(1)}deg) scale(${latestScaleX.toFixed(3)}, ${latestScaleY.toFixed(3)})`;
  };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("scroll", onWindowScroll, true);
    detachedEl.remove();
    if (typeof options.onFinish === "function") {
      options.onFinish();
    }
  };

  const onWindowScroll = () => {
    if (!finished) {
      applyTransform();
    }
  };
  window.addEventListener("scroll", onWindowScroll, { capture: true, passive: true });

  const step = (now) => {
    if (finished) return;
    if (!detachedEl.isConnected) {
      cleanup();
      return;
    }
    const elapsed = Math.max(0, now - startTime);
    const p = Math.min(1, elapsed / DURATION_MS);

    if (p < 0.13) {
      // 阶段一：从嘴角轻巧翘起揭下并微幅向前景弹出（0 ~ 364ms）
      const peelT = p / 0.13;
      const peelEase = 1 - Math.pow(1 - peelT, 3);
      const popScale = 1 + Math.sin(peelT * Math.PI) * 0.26;
      latestDropX = swayDir * peelEase * 10;
      latestDropY = -Math.sin(peelT * Math.PI) * 7.5 + peelEase * 3;
      latestRot = baseRot + swayDir * peelEase * 24;
      latestScaleX = popScale * (1 - Math.sin(peelT * Math.PI) * 0.10);
      latestScaleY = popScale * (1 + Math.sin(peelT * Math.PI) * 0.06);
      latestOpacity = 1;
    } else {
      // 阶段二：在原世界位置如纸片般随风摇曳偏落并渐隐（364ms ~ 2800ms）
      const fallT = (p - 0.13) / 0.87;
      const swayPhase = fallT * Math.PI * 2.8;
      const swayAmp = (is3D ? 10 : 16) * (1 - 0.18 * fallT);
      const driftX = swayDir * ((is3D ? 16 : 26) * Math.pow(fallT, 0.9));

      latestDropX = swayDir * 10 + driftX + swayDir * Math.sin(swayPhase) * swayAmp;
      latestDropY = 3 + (is3D ? 68 : 112) * Math.pow(fallT, 1.08);
      latestRot =
        baseRot +
        swayDir * (24 + 28 * fallT) +
        swayDir * Math.cos(swayPhase) * 18;

      const baseScale = 1.06 - 0.18 * fallT;
      const paperTiltY = 0.80 + 0.20 * Math.abs(Math.cos(swayPhase));
      latestScaleX = baseScale;
      latestScaleY = baseScale * paperTiltY;

      if (fallT < 0.50) {
        latestOpacity = 1 - fallT * 0.14;
      } else {
        const fadeT = Math.min(1, (fallT - 0.50) / 0.50);
        const smoothFade = fadeT * fadeT * (3 - 2 * fadeT);
        latestOpacity = Math.max(0, 0.93 * (1 - smoothFade));
      }
    }

    applyTransform();

    if (p >= 1) {
      cleanup();
      return;
    }
    rafId = requestAnimationFrame(step);
  };

  applyTransform();
  rafId = requestAnimationFrame(step);
  return cleanup;
}

/**
 * 一键独立下载洛琪希 7 张高清半身立绘扩展包到本地插件目录（无需压缩包，适配 BRAT 用户按需获取）
 * 依次尝试：GitHub Release 附件直链 -> jsDelivr CDN -> GitHub Raw
 */
async function downloadRoxyHdPortraitPack(plugin, onProgress) {
  const { requestUrl } = require("obsidian");
  const fs = tryRequireNode("fs");
  const uniqueFiles = HD_PORTRAIT_ONLY_FILES;
  const { absDir } = getRoxyAssetDirs(plugin);

  if (fs && absDir && !fs.existsSync(absDir)) {
    try {
      fs.mkdirSync(absDir, { recursive: true });
    } catch (_) {}
  }

  const REPO_SLUG = "Curelove/bangumi-manager";
  let downloadedCount = 0;
  const failedFiles = [];

  for (let i = 0; i < uniqueFiles.length; i++) {
    const fileName = uniqueFiles[i];
    if (typeof onProgress === "function") {
      onProgress(i + 1, uniqueFiles.length, fileName);
    }

    const candidateUrls = [
      `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/assets/roxy/${encodeURIComponent(fileName)}`,
      `https://fastly.jsdelivr.net/gh/${REPO_SLUG}@main/assets/roxy/${encodeURIComponent(fileName)}`,
      `https://raw.githubusercontent.com/${REPO_SLUG}/main/assets/roxy/${encodeURIComponent(fileName)}`,
      `https://github.com/${REPO_SLUG}/releases/download/0.4.0/${encodeURIComponent(fileName)}`
    ];

    let fileBuffer = null;
    for (const url of candidateUrls) {
      try {
        const res = await Promise.race([
          requestUrl({ url, method: "GET", throw: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7500))
        ]);
        if (res && res.arrayBuffer && res.arrayBuffer.byteLength > 1024) {
          fileBuffer = res.arrayBuffer;
          break;
        }
      } catch (err) {
        // try next mirror
      }
    }

    if (fileBuffer) {
      try {
        await writePluginAssetBinary(plugin, `assets/roxy/${fileName}`, fileBuffer);
        downloadedCount++;
      } catch (writeErr) {
        failedFiles.push(fileName);
      }
    } else {
      failedFiles.push(fileName);
    }
  }

  if (downloadedCount === uniqueFiles.length && plugin) {
    plugin._roxyHdAdapterInstalled = true;
  }

  const coord = ensureRoxyCoordinator(plugin);
  const status = checkRoxyHdPortraitsStatus(plugin);
  if (coord) {
    coord.assetCacheBust = Date.now();
    coord.hdPortraitsAvailable = status.installed;
    coord.preloaded = false;
    preloadAllRoxyPortraits(plugin, coord);
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll(".curator-roxy-widget").forEach((w) => {
      if (typeof w._refreshRoxyStageMode === "function") {
        w._refreshRoxyStageMode();
      }
    });
  }

  return {
    ok: status.installed,
    success: status.installed,
    downloaded: status.foundCount,
    downloadedCount: status.foundCount,
    total: uniqueFiles.length,
    totalCount: uniqueFiles.length,
    failedFiles,
    status
  };
}

/**
 * 通过 Obsidian Vault Adapter 解析插件内部相对静态资源 URL（零硬编码绝对路径）
 */
function resolveRoxyAssetUrl(plugin, relativeFile) {
  try {
    if (String(relativeFile || "").startsWith("chibi_")) {
      return resolveRoxyChibiAssetUrl(plugin, relativeFile);
    }
    const cfgDir = String(plugin?.app?.vault?.configDir || ".obsidian").replace(/\\/g, "/").replace(/\/+$/, "");
    const baseDir =
      plugin && plugin.manifest && plugin.manifest.dir
        ? plugin.manifest.dir
        : `${cfgDir}/plugins/bangumi-manager`;
    const cleanRel = `${baseDir.replace(/\/$/, "")}/assets/roxy/${relativeFile.replace(/^\//, "")}`;
    if (
      plugin &&
      plugin.app &&
      plugin.app.vault &&
      plugin.app.vault.adapter &&
      typeof plugin.app.vault.adapter.getResourcePath === "function"
    ) {
      let resourceUrl = plugin.app.vault.adapter.getResourcePath(cleanRel);
      const bust = plugin._roxyCoordinator && plugin._roxyCoordinator.assetCacheBust;
      if (resourceUrl && bust) {
        resourceUrl += (resourceUrl.includes("?") ? "&" : "?") + `v=${bust}`;
      }
      return resourceUrl;
    }
  } catch (err) {
    // ignore
  }
  return "";
}

/**
 * 解析内置校准版 8 态 Q 版洛琪希立绘及玩偶彩蛋资源 URL（assets/roxy-chibi-sprites/），桌面端与移动端统一加载
 */
function resolveRoxyChibiAssetUrl(plugin, fileName) {
  try {
    const cleanName = String(fileName || "chibi_guide.png").replace(/^\//, "");
    const coord = plugin && plugin._roxyCoordinator;
    if (coord && coord.missingChibiFiles && coord.missingChibiFiles.has(cleanName)) {
      return "";
    }
    const cfgDir = String(plugin?.app?.vault?.configDir || ".obsidian").replace(/\\/g, "/").replace(/\/+$/, "");
    const baseDir =
      plugin && plugin.manifest && plugin.manifest.dir
        ? plugin.manifest.dir.replace(/\\/g, "/").replace(/\/$/, "")
        : `${cfgDir}/plugins/bangumi-manager`;
    const cleanRel = `${baseDir}/assets/roxy-chibi-sprites/${cleanName}`;
    const adapter = plugin?.app?.vault?.adapter;
    if (!adapter || typeof adapter.getResourcePath !== "function") {
      return "";
    }

    const fs = tryRequireNode("fs");
    const path = tryRequireNode("path");
    const vaultBase =
      isDesktopNodeAvailable() && typeof adapter.getBasePath === "function"
        ? adapter.getBasePath()
        : "";
    if (fs && path && vaultBase) {
      const absTarget = path.join(vaultBase, baseDir, "assets", "roxy-chibi-sprites", cleanName);
      if (!fs.existsSync(absTarget)) {
        return "";
      }
    }

    let resourceUrl = adapter.getResourcePath(cleanRel);
    const bust = coord && coord.assetCacheBust;
    if (resourceUrl && bust) {
      resourceUrl += (resourceUrl.includes("?") ? "&" : "?") + `v=${bust}`;
    }
    return resourceUrl || "";
  } catch (err) {
    // ignore
  }
  return "";
}

/**
 * 若本地插件目录缺少内置 Q 版洛琪希精灵（如精简安装/BRAT 场景），按需静默拉取并缓存至 assets/roxy-chibi-sprites/
 */
function ensureRoxyChibiSpritesCached(plugin, priorityFile) {
  if (!plugin) return Promise.resolve(false);
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord) return Promise.resolve(false);
  if (coord._chibiAutoCachePromise) return coord._chibiAutoCachePromise;

  const uniqueFiles = Array.from(new Set(Object.values(ROXY_CHIBI_SPRITE_FILES)));
  if (priorityFile && uniqueFiles.includes(priorityFile)) {
    uniqueFiles.splice(uniqueFiles.indexOf(priorityFile), 1);
    uniqueFiles.unshift(priorityFile);
  }

  coord._chibiAutoCachePromise = (async () => {
    const { requestUrl } = require("obsidian");
    const REPO_SLUG = "Curelove/bangumi-manager";
    let fetchedAny = false;

    for (const fileName of uniqueFiles) {
      try {
        const exists = await pluginAssetExists(plugin, `assets/roxy-chibi-sprites/${fileName}`);
        if (exists) {
          if (coord.missingChibiFiles) coord.missingChibiFiles.delete(fileName);
          continue;
        }
        const candidateUrls = [
          `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/assets/roxy-chibi-sprites/${encodeURIComponent(fileName)}`,
          `https://fastly.jsdelivr.net/gh/${REPO_SLUG}@main/assets/roxy-chibi-sprites/${encodeURIComponent(fileName)}`,
          `https://raw.githubusercontent.com/${REPO_SLUG}/main/assets/roxy-chibi-sprites/${encodeURIComponent(fileName)}`
        ];
        let fileBuffer = null;
        for (const url of candidateUrls) {
          try {
            const res = await Promise.race([
              requestUrl({ url, method: "GET", throw: true }),
              new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7500))
            ]);
            if (res && res.arrayBuffer && res.arrayBuffer.byteLength > 1024) {
              fileBuffer = res.arrayBuffer;
              break;
            }
          } catch (_) {
            // try next mirror
          }
        }
        if (fileBuffer) {
          await writePluginAssetBinary(plugin, `assets/roxy-chibi-sprites/${fileName}`, fileBuffer);
          if (coord.missingChibiFiles) coord.missingChibiFiles.delete(fileName);
          fetchedAny = true;
        }
      } catch (_) {
        // ignore individual file failure
      }
    }

    if (fetchedAny) {
      coord.assetCacheBust = Date.now();
      coord.chibiPreloaded = false;
      coord.resolvedChibiUrls = {};
      preloadAllRoxyPortraits(plugin, coord);
      if (typeof document !== "undefined") {
        document.querySelectorAll(".curator-roxy-widget, .atelier-roxy3d-widget").forEach((w) => {
          if (typeof w._refreshRoxyStageMode === "function") {
            w._refreshRoxyStageMode();
          }
        });
      }
    }
    return fetchedAny;
  })()
    .catch(() => false)
    .finally(() => {
      coord._chibiAutoCachePromise = null;
    });

  return coord._chibiAutoCachePromise;
}

function getRoxyChibiCdnFallbackUrl(fileName) {
  const cleanName = String(fileName || "chibi_guide.png").replace(/^\//, "");
  return `https://cdn.jsdelivr.net/gh/Curelove/bangumi-manager@main/assets/roxy-chibi-sprites/${encodeURIComponent(cleanName)}`;
}

/**
 * 预加载洛琪希立绘（包含 8 态校准版 Q 版立绘、2 款替身玩偶及可选的 7 张高清半身立绘），确保切换零闪烁
 */
function preloadAllRoxyPortraits(plugin, coord) {
  if (!coord) return;
  const hdStatus = checkRoxyHdPortraitsStatus(plugin);
  coord.hdPortraitsAvailable = hdStatus.installed;
  if (!hdStatus.installed && !isDesktopNodeAvailable() && plugin && !plugin._roxyHdAsyncProbed) {
    plugin._roxyHdAsyncProbed = true;
    Promise.all(HD_PORTRAIT_ONLY_FILES.map((f) => pluginAssetExists(plugin, `assets/roxy/${f}`)))
      .then((flags) => {
        if (flags.every(Boolean)) {
          plugin._roxyHdAdapterInstalled = true;
          coord.hdPortraitsAvailable = true;
        }
      })
      .catch(() => {});
  }
  if (!coord.resolvedChibiUrls) {
    coord.resolvedChibiUrls = {};
  }
  const uniqueChibiFiles = new Set(Object.values(ROXY_CHIBI_SPRITE_FILES));
  let missingChibiCount = 0;
  uniqueChibiFiles.forEach((file) => {
    const url = resolveRoxyChibiAssetUrl(plugin, file);
    if (url) {
      coord.resolvedChibiUrls[file] = url;
      if (typeof Image !== "undefined" && !coord.chibiPreloaded) {
        const img = new Image();
        img.src = url;
      }
    } else {
      missingChibiCount++;
    }
  });
  coord.chibiPreloaded = true;
  if (missingChibiCount > 0 && !coord._chibiAutoCacheAttempted) {
    coord._chibiAutoCacheAttempted = true;
    ensureRoxyChibiSpritesCached(plugin, ROXY_CHIBI_SPRITE_FILES.explain);
  }

  if (!hdStatus.installed) {
    coord.resolvedUrls = {};
    return;
  }
  if (coord.preloaded) return;
  coord.preloaded = true;
  coord.resolvedUrls = {};
  const uniqueFiles = new Set(HD_PORTRAIT_ONLY_FILES);
  uniqueFiles.forEach((file) => {
    const url = resolveRoxyAssetUrl(plugin, file);
    if (url) {
      coord.resolvedUrls[file] = url;
      if (typeof Image !== "undefined") {
        const img = new Image();
        img.src = url;
      }
    }
  });
}

/**
 * 获取或初始化挂在 plugin 实例上的全局洛琪希事件协调器
 */
function ensureRoxyCoordinator(plugin) {
  if (!plugin) return null;
  if (!plugin._roxyCoordinator) {
    plugin._roxyCoordinator = {
      currentState: "explain",
      lastEventAt: 0,
      lastPriority: 0,
      lastEventType: "",
      dedupeMap: new Map(),
      history: [],
      emittedCount: 0,
      dedupeSuppressedCount: 0,
      cooldownSuppressedCount: 0,
      sessionHidden2D: false,
      sessionHidden3D: false,
      runaway2D: false,
      runaway3D: false,
      isPinballFlying2D: false,
      isPinballFlying3D: false,
      lastRunawayComplaintIdx: -1,
      deckIndex: 0,
      pokeStreak: 0,
      lastPokeAt: 0,
      isShowingPrimary: true,
      deckIndex3D: 0,
      pokeStreak3D: 0,
      lastPokeAt3D: 0,
      isShowingPrimary3D: true,
      listeners2D: new Set(),
      listeners3D: new Set()
    };
  }
  preloadAllRoxyPortraits(plugin, plugin._roxyCoordinator);
  return plugin._roxyCoordinator;
}

/**
 * 解析作品的真实开播日期（优先读取笔记表格中的「开播日期：YYYY年MM月DD日」），
 * 若某部作品仅有「开播年份 + 开播季度」而无具体开播日，则只做番季归属统计，绝不按「当月1日」硬算该作已开播天数。
 */
function analyzeBroadcastTiming(items, now = new Date()) {
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const curDay = now.getDate();
  const todayMidnight = new Date(curYear, curMonth - 1, curDay).getTime();

  const seasonStartMonth = curMonth >= 10 ? 10 : curMonth >= 7 ? 7 : curMonth >= 4 ? 4 : 1;
  const curSeasonLabel = `${String(seasonStartMonth).padStart(2, "0")}月新番`;

  const airingNow = [];
  const upcoming = [];

  for (const it of items) {
    const rawAirDate = String(it.airDate || "").trim();
    const exactMatch =
      rawAirDate.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ||
      rawAirDate.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);

    if (exactMatch) {
      const y = Number(exactMatch[1]);
      const m = Number(exactMatch[2]);
      const d = Number(exactMatch[3]);
      const startMidnight = new Date(y, m - 1, d).getTime();
      const diffDays = Math.round((todayMidnight - startMidnight) / 86400000);
      const seasonM = m >= 10 ? 10 : m >= 7 ? 7 : m >= 4 ? 4 : 1;
      const rawSeason = String(it.season || "").trim();
      const seasonText =
        rawSeason && rawSeason !== "未知" && rawSeason !== "未知季度"
          ? rawSeason
          : `${String(seasonM).padStart(2, "0")}月新番`;
      const airDateShort = `${m}月${d}日`;
      const airDateFull = `${y}年${m}月${d}日`;

      if (diffDays >= 0 && diffDays <= 95) {
        airingNow.push({
          item: it,
          hasExactDate: true,
          diffDays,
          year: y,
          month: m,
          day: d,
          airDateShort,
          airDateFull,
          seasonText
        });
      } else if (diffDays < 0 && diffDays >= -365) {
        upcoming.push({
          item: it,
          hasExactDate: true,
          daysUntil: Math.abs(diffDays),
          year: y,
          month: m,
          day: d,
          airDateShort,
          airDateFull,
          seasonText
        });
      }
      continue;
    }

    const ym = String(it.year || "").match(/\b(20\d\d)\b/);
    const sm = String(it.season || "").match(/(01|04|07|10|1|4|7)\s*月/);
    if (!ym || !sm) continue;

    const y = Number(ym[1]);
    const m = Number(sm[1]);
    const seasonStartMidnight = new Date(y, m - 1, 1).getTime();
    const seasonDiffDays = Math.round((todayMidnight - seasonStartMidnight) / 86400000);
    const seasonText = `${String(m).padStart(2, "0")}月新番`;

    if (seasonDiffDays >= 0 && seasonDiffDays <= 95) {
      airingNow.push({
        item: it,
        hasExactDate: false,
        diffDays: seasonDiffDays,
        year: y,
        month: m,
        day: null,
        airDateShort: "",
        airDateFull: `${y}年${seasonText}`,
        seasonText
      });
    } else if (seasonDiffDays < 0 && seasonDiffDays >= -365) {
      upcoming.push({
        item: it,
        hasExactDate: false,
        daysUntil: Math.abs(seasonDiffDays),
        year: y,
        month: m,
        day: null,
        airDateShort: "",
        airDateFull: `${y}年${seasonText}`,
        seasonText
      });
    }
  }

  airingNow.sort((a, b) => {
    if (a.hasExactDate !== b.hasExactDate) return a.hasExactDate ? -1 : 1;
    return a.diffDays - b.diffDays;
  });
  upcoming.sort((a, b) => {
    if (a.hasExactDate !== b.hasExactDate) return a.hasExactDate ? -1 : 1;
    return a.daysUntil - b.daysUntil;
  });

  // 计算距离下一个新番季（1/4/7/10月）还有多少天
  const nextMonths = [1, 4, 7, 10];
  let nextSeasonYear = curYear;
  let nextSeasonMonth = nextMonths.find((m) => m > curMonth);
  if (!nextSeasonMonth) {
    nextSeasonYear = curYear + 1;
    nextSeasonMonth = 1;
  }
  const nextSeasonDate = new Date(nextSeasonYear, nextSeasonMonth - 1, 1);
  const daysToNextSeason = Math.max(1, Math.ceil((nextSeasonDate.getTime() - now.getTime()) / 86400000));

  return {
    curYear,
    curMonth,
    curDay,
    curHour: now.getHours(),
    curSeasonLabel,
    airingNow,
    upcoming,
    nextSeasonYear,
    nextSeasonMonth,
    daysToNextSeason
  };
}

/**
 * 规范化并读取洛琪希手势操作记忆（用于新用户温和引导与长久未用唤醒，绝不打扰高频或有固定使用节奏的老用户）
 */
function ensureGestureMemory(plugin) {
  if (!plugin || !plugin.settings) {
    return {
      firstSeenAt: Date.now(),
      wandUseCount: 0,
      firstWandUsedAt: 0,
      lastWandUsedAt: 0,
      wandHintShowCount: 0,
      lastWandHintShownAt: 0,
      wandHintDismissed: false,
      pullUseCount: 0,
      lastPullUsedAt: 0
    };
  }
  const raw =
    plugin.settings.roxyGestureMemory && typeof plugin.settings.roxyGestureMemory === "object"
      ? plugin.settings.roxyGestureMemory
      : {};
  const now = Date.now();
  const normalized = {
    firstSeenAt: Number(raw.firstSeenAt) > 0 ? Number(raw.firstSeenAt) : now,
    wandUseCount: Math.max(0, Number(raw.wandUseCount) || 0),
    firstWandUsedAt: Math.max(0, Number(raw.firstWandUsedAt) || 0),
    lastWandUsedAt: Math.max(0, Number(raw.lastWandUsedAt) || 0),
    wandHintShowCount: Math.max(0, Number(raw.wandHintShowCount) || 0),
    lastWandHintShownAt: Math.max(0, Number(raw.lastWandHintShownAt) || 0),
    wandHintDismissed: Boolean(raw.wandHintDismissed),
    pullUseCount: Math.max(0, Number(raw.pullUseCount) || 0),
    lastPullUsedAt: Math.max(0, Number(raw.lastPullUsedAt) || 0)
  };
  plugin.settings.roxyGestureMemory = normalized;
  return normalized;
}

function recordWandRelationUsed(plugin) {
  if (!plugin || !plugin.settings) return;
  const mem = ensureGestureMemory(plugin);
  const now = Date.now();
  mem.wandUseCount = (mem.wandUseCount || 0) + 1;
  if (!mem.firstWandUsedAt) {
    mem.firstWandUsedAt = now;
  }
  mem.lastWandUsedAt = now;
  if (typeof plugin.saveSettings === "function") {
    plugin.saveSettings().catch(() => {});
  }
}

function recordPullToTopUsed(plugin) {
  if (!plugin || !plugin.settings) return;
  const mem = ensureGestureMemory(plugin);
  mem.pullUseCount = (mem.pullUseCount || 0) + 1;
  mem.lastPullUsedAt = Date.now();
  if (typeof plugin.saveSettings === "function") {
    plugin.saveSettings().catch(() => {});
  }
}

async function resetRoxyGestureMemory(plugin) {
  if (!plugin || !plugin.settings) return;
  plugin.settings.roxyGestureMemory = {
    firstSeenAt: Date.now(),
    wandUseCount: 0,
    firstWandUsedAt: 0,
    lastWandUsedAt: 0,
    wandHintShowCount: 0,
    lastWandHintShownAt: 0,
    wandHintDismissed: false,
    pullUseCount: 0,
    lastPullUsedAt: 0
  };
  plugin.settings.roxyPullToTopHintDismissed = false;
  const coord = ensureRoxyCoordinator(plugin);
  if (coord) {
    coord._sessionWandHintShown = false;
  }
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
}

/**
 * 判断是否应当温和提示「长按或右键卡片查看关联收藏」
 * - 全新未使用过该功能的用户：最多温和提示 3 次（首次开馆后展示 1 次，后续每次至少间隔 5 天）
 * - 长久未使用（距上次使用 > 25 天）且尚未形成固定低频节奏的用户：间隔至少 21 天温和提醒 1 次
 * - 近期使用过（<= 25 天）或已有稳定个人使用节奏的老用户：保持完全安静，绝不打扰
 */
function evaluateWandGestureHintNeed(plugin, state, coord) {
  if (!plugin || !plugin.settings) return null;
  if (plugin.settings.roxySmartGestureHints === false) return null;
  if (plugin.settings.roxyQuietMode) return null;
  const items = (state && state.items) || [];
  if (items.length === 0) return null;
  if (coord && coord._sessionWandHintShown) return null;

  const mem = ensureGestureMemory(plugin);
  if (mem.wandHintDismissed) return null;

  const now = Date.now();
  const DAY = 86400000;
  const daysSinceLastHint = mem.lastWandHintShownAt > 0 ? (now - mem.lastWandHintShownAt) / DAY : 999;

  if (mem.wandUseCount === 0) {
    if (mem.wandHintShowCount >= 3) return null;
    if (mem.wandHintShowCount > 0 && daysSinceLastHint < 5) return null;
    return "new_user";
  }

  const refUsedAt = mem.lastWandUsedAt || mem.firstWandUsedAt || mem.firstSeenAt || now;
  const daysSinceLastWand = (now - refUsedAt) / DAY;
  if (daysSinceLastWand <= 25) {
    return null;
  }

  // 若用户已累计使用 >= 4 次且处于自身平均间隔的合理倍数内（低频但规律使用的熟手），不打扰
  if (mem.wandUseCount >= 4 && mem.firstWandUsedAt > 0 && mem.lastWandUsedAt > mem.firstWandUsedAt) {
    const avgIntervalDays = (mem.lastWandUsedAt - mem.firstWandUsedAt) / ((mem.wandUseCount - 1) * DAY);
    if (daysSinceLastWand < Math.max(45, avgIntervalDays * 2.2)) {
      return null;
    }
  }

  if (daysSinceLastHint < 21 || mem.wandHintShowCount >= 4) {
    return null;
  }
  return "dormant";
}

function buildWandGestureHintRecord(plugin, kind = "new_user") {
  const mascotName = getMascotDisplayName(plugin);
  return {
    type: "roxy:wand_gesture_hint",
    state: "explain",
    badgeText: `✦ ${mascotName} · 关联小贴士`,
    stepHint: "操作提示",
    isWandHint: true,
    isPrimary: false,
    priority: PRIORITY.LOW,
    autoHideMs: 11500,
    message:
      kind === "dormant"
        ? "顺带提一句，如果您想把某部动画和角色、画册、音声或游戏串起来同屏对照，只要长按任意卡片（或直接右键点击）就能唤出关联收藏啦。"
        : "偷偷告诉您一个小窍门：在馆内任意卡片或条目上长按片刻（或者直接点鼠标右键），就能一键串起同作品的角色、画册、音声和游戏记录哦。"
  };
}

/**
 * 将固定定位的洛琪希挂件/唤醒胶囊动态锚定到当前 `.workspace-leaf-content` 内容区右下角
 * 确保开启 Obsidian 右侧边栏或双侧边栏分屏时，绝不越界遮挡右侧栏，也绝不溢出被裁切
 */
function bindRoxyLeafBoundsAnchor(targetEl, hostEl) {
  if (!targetEl || !hostEl || typeof window === "undefined") {
    return () => {};
  }
  const paneEl =
    hostEl.closest(".workspace-leaf-content") ||
    hostEl.closest(".bangumi-score-dashboard-view") ||
    hostEl;

  let rafId = null;
  const syncBounds = () => {
    rafId = null;
    if (!targetEl.isConnected || !paneEl.isConnected) return;
    const rect = paneEl.getBoundingClientRect();
    const vw = Math.max(320, window.innerWidth || 1280);
    const vh = Math.max(240, window.innerHeight || 800);

    if (rect.width < 48 || rect.height < 48 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) {
      targetEl.classList.add("is-pane-hidden");
      return;
    }
    targetEl.classList.remove("is-pane-hidden");

    const isMobileLayout =
      isMobileEnv() || Boolean(document.body && document.body.classList.contains("is-mobile"));
    const hasFloatingNav = Boolean(
      document.body && document.body.classList.contains("is-floating-nav")
    );
    const isCompactPane = !isMobileLayout && rect.width <= 760;
    const isTightPane = !isMobileLayout && rect.width <= 560;
    targetEl.classList.toggle("is-compact-pane", isCompactPane);
    targetEl.classList.toggle("is-tight-pane", isTightPane);
    targetEl.classList.toggle("is-mobile-roxy", isMobileLayout);

    const padRight = isMobileLayout ? 10 : isTightPane ? 8 : isCompactPane ? 12 : 20;
    const padBottom = isMobileLayout
      ? hasFloatingNav
        ? 88
        : 66
      : isTightPane
      ? 10
      : isCompactPane
      ? 14
      : 24;

    // 检测是否存在建立独立 fixed 包含块的祖先（如 Obsidian .workspace-leaf-content 的 contain: strict）
    let cbRight = vw;
    let cbBottom = vh;
    let anc = targetEl.parentElement;
    while (anc && anc !== document.body && anc !== document.documentElement) {
      const cs = window.getComputedStyle(anc);
      if (
        (cs.contain && /(layout|paint|strict|content)/.test(cs.contain)) ||
        (cs.transform && cs.transform !== "none") ||
        (cs.filter && cs.filter !== "none") ||
        (cs.perspective && cs.perspective !== "none") ||
        (cs.backdropFilter && cs.backdropFilter !== "none")
      ) {
        const cbRect = anc.getBoundingClientRect();
        cbRight = cbRect.right;
        cbBottom = cbRect.bottom;
        break;
      }
      anc = anc.parentElement;
    }

    const rightPx = Math.max(8, Math.round(Math.max(0, cbRight - Math.min(cbRight, rect.right)) + padRight));
    const bottomPx = Math.max(8, Math.round(Math.max(0, cbBottom - Math.min(cbBottom, rect.bottom)) + padBottom));
    const maxBubbleW = Math.max(176, Math.min(268, Math.round(rect.width - 76)));

    targetEl.style.right = `${rightPx}px`;
    targetEl.style.bottom = `${bottomPx}px`;
    targetEl.style.setProperty("--roxy-pane-max-bubble-w", `${maxBubbleW}px`);
  };

  const scheduleSync = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(syncBounds);
  };

  syncBounds();
  window.addEventListener("resize", scheduleSync, { passive: true });

  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(scheduleSync);
    ro.observe(paneEl);
    if (document.body) {
      ro.observe(document.body);
    }
  }

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("resize", scheduleSync);
    if (ro) {
      try {
        ro.disconnect();
      } catch (_) {}
      ro = null;
    }
  };
}

/**
 * 构建当前最重要的一条「首要提示」（Card 0，用于首次进入工作台及用户点击「↺ 首要」还原）
 */
function buildPrimaryDeskRecord(plugin, state) {
  const items = (state && state.items) || [];
  const watching = items.filter((it) => it.state === "在看");
  const completed = items.filter((it) => it.state === "已看");
  const plan = items.filter((it) => it.state === "想看");

  // 1. 若存在异常集数（已看 > 总集数），优先提示修正
  const abnormal = items.find((it) => {
    const w = Number(it.watchedEpisodes) || 0;
    const t = Number(it.totalEpisodes) || 0;
    return t > 0 && w > t;
  });
  if (abnormal) {
    return {
      type: "primary:abnormal",
      state: "surprised",
      badgeText: "✦ 洛琪希 · 首要事项",
      isPrimary: true,
      priority: PRIORITY.HIGH,
      message: `那个……我在核对账本时发现，《${abnormal.name}》登记的已看话数（${abnormal.watchedEpisodes}话）超过了总话数（${abnormal.totalEpisodes}话），要先修正一下吗？`
    };
  }

  // 2. 若正在进行搜索过滤，汇报当前检索情况
  if (state && state.searchQuery) {
    return {
      type: "primary:search",
      state: "explain",
      badgeText: "✦ 洛琪希 · 首要事项",
      isPrimary: true,
      priority: PRIORITY.NORMAL,
      message: `正在为您检索包含“${state.searchQuery}”的馆藏案卷。如果需要缩小范围，可以配合上方的状态胶囊一起筛选哦。`
    };
  }

  // 3. 若有正在追番作品，优先汇报追番席首位进度
  if (watching.length > 0) {
    const top = watching[0];
    const w = Number(top.watchedEpisodes) || 0;
    const t = Number(top.totalEpisodes) || 0;
    const nextEp = t > 0 ? Math.min(t, w + 1) : w + 1;
    return {
      type: "primary:watching",
      state: "explain",
      badgeText: "✦ 洛琪希 · 首要事项",
      isPrimary: true,
      priority: PRIORITY.NORMAL,
      message: `目前有《${top.name}》（已看 ${t > 0 ? `${w}/${t}话` : `${w}话`}）等 ${watching.length} 部连载正在跟进。今天要先看第 ${nextEp} 话，还是整理笔记呢？`
    };
  }

  // 3.5. 新用户 0 部馆藏开馆态：给出温和自然的迎宾引导，绝不出现“从 0 部里挑了 4 部”的机械话术
  if (items.length === 0) {
    return {
      type: "primary:onboarding",
      state: "explain",
      badgeText: "✦ 洛琪希 · 开馆导览",
      isPrimary: true,
      priority: PRIORITY.NORMAL,
      message: "欢迎来到新落成的番剧与原画典藏馆！您可以直接搜索第一部喜欢的动画建档，或者先点「载入 3 部示例样片预览」随我逛一圈展厅哦。"
    };
  }

  // 4. 若当前没有「在看」作品，使用温和的讲解立绘（explain）引导首屏待看推荐
  return {
    type: "primary:standby",
    state: "explain",
    badgeText: "✦ 洛琪希 · 首要事项",
    isPrimary: true,
    priority: PRIORITY.NORMAL,
    message: `目前还没有标记为「在看」的连载呢。我已经从您的 ${plan.length} 部想看与 ${completed.length} 部已看作品里挑了几部放在首屏，随时可以挑一部开始追番哦。`
  };
}

/**
 * 构建用户点击洛琪希立绘时的多维真实数据咨讯轮播队列（覆盖全部情绪立绘与时间/开播/评分/进度数据）
 */
function buildRoxyConsultationDeck(plugin, state) {
  const items = (state && state.items) || [];
  const watching = items.filter((it) => it.state === "在看");
  const completed = items.filter((it) => it.state === "已看");
  const plan = items.filter((it) => it.state === "想看");
  const now = new Date();
  const timing = analyzeBroadcastTiming(items, now);

  const deck = [];

  // [1] 新番开播与档期日历咨讯（优先按单部动画精确首播日计算，绝不用「当月日期 - 1」误导用户）
  if (timing.airingNow.length > 0) {
    const exactAiring = timing.airingNow.filter((x) => x.hasExactDate);
    const totalAiringCount = timing.airingNow.length;

    if (exactAiring.length > 0) {
      const pick = exactAiring[0];
      let msgText = "";
      if (pick.diffDays === 0) {
        msgText = `看了一眼今天的日历（${timing.curMonth}月${timing.curDay}日），您收藏的《${pick.item.name}》就在今天（${pick.airDateShort}）正式首播了！目前馆藏里共有 ${totalAiringCount} 部已开播的当季新番，有空不妨去看看首话哦。`;
      } else if (pick.diffDays <= 7) {
        msgText = `看了一眼今天的日历（${timing.curMonth}月${timing.curDay}日），您收藏的《${pick.item.name}》（${pick.airDateShort}首播）才刚开播 ${pick.diffDays} 天；目前馆藏里共有 ${totalAiringCount} 部已开播的当季新番，正是追更的好时候呢！`;
      } else {
        msgText = `看了一眼今天的日历（${timing.curMonth}月${timing.curDay}日），您收藏的《${pick.item.name}》自 ${pick.airDateShort} 首播以来已开播 ${pick.diffDays} 天；目前馆藏里共有 ${totalAiringCount} 部当季作品正在连载，有空的话不妨去看看最新一话。`;
      }
      deck.push({
        type: "consult:broadcast_airing",
        state: "surprised",
        badgeText: "✦ 洛琪希 · 开播咨讯",
        isPrimary: false,
        message: msgText
      });
    } else {
      const pick = timing.airingNow[0];
      deck.push({
        type: "consult:broadcast_airing",
        state: "surprised",
        badgeText: "✦ 洛琪希 · 开播咨讯",
        isPrimary: false,
        message: `看了一眼今天的日历（${timing.curMonth}月${timing.curDay}日），当前正处于 ${pick.year} 年 ${pick.seasonText}档期，您馆藏里共收录了《${pick.item.name}》等 ${totalAiringCount} 部本季作品，可根据各作首播日去看看最新一话哦。`
      });
    }
  } else if (timing.upcoming.length > 0) {
    const nextUp = timing.upcoming[0];
    deck.push({
      type: "consult:broadcast_upcoming",
      state: "surprised",
      badgeText: "✦ 洛琪希 · 待播倒计时",
      isPrimary: false,
      message: nextUp.hasExactDate
        ? `顺带一提，您想看的《${nextUp.item.name}》定档于 ${nextUp.airDateFull} 首播，距离正式开播还有 ${nextUp.daysUntil} 天，到时我会记得提醒您的。`
        : `顺带一提，您想看的《${nextUp.item.name}》（${nextUp.year}年${nextUp.seasonText}）距离预计开播季还有约 ${nextUp.daysUntil} 天，到时我会记得提醒您的。`
    });
  } else {
    deck.push({
      type: "consult:season_countdown",
      state: "explain",
      badgeText: "✦ 洛琪希 · 番季日历",
      isPrimary: false,
      message: `今天是 ${timing.curMonth} 月 ${timing.curDay} 日，距离下一季（${timing.nextSeasonYear}年${String(timing.nextSeasonMonth).padStart(2, "0")}月新番）开启还有约 ${timing.daysToNextSeason} 天，趁这段时间正好可以补几部旧番呢。`
    });
  }

  // [2] 待播预约或近期高分情报（surprised / success）
  if (timing.upcoming.length > 0 && timing.airingNow.length > 0) {
    const nextUp = timing.upcoming[0];
    deck.push({
      type: "consult:broadcast_upcoming",
      state: "explain",
      badgeText: "✦ 洛琪希 · 待播档期",
      isPrimary: false,
      message: nextUp.hasExactDate
        ? `另外我也帮您核对了待播档期，《${nextUp.item.name}》定档于 ${nextUp.airDateFull} 首播，再过 ${nextUp.daysUntil} 天就会正式开播，请耐心等待吧。`
        : `另外我也帮您留意了远期档期，《${nextUp.item.name}》（${nextUp.year}年${nextUp.seasonText}）大约再过 ${nextUp.daysUntil} 天就会迎来开播季了，请耐心等待吧。`
    });
  }

  // [3] 近期 Bangumi 评分情报与口碑推荐（success / surprised）
  const scoredBgmPlan = [...plan]
    .filter((it) => (it.preciseScore ?? it.publicScore ?? it.bangumiScore) !== null)
    .sort((a, b) => (b.preciseScore ?? b.publicScore ?? b.bangumiScore ?? 0) - (a.preciseScore ?? a.publicScore ?? a.bangumiScore ?? 0));

  const lastSyncTs = Number(plugin?.settings?.lastRatingMonitorAt) || 0;
  const syncAgeHours = lastSyncTs > 0 ? Math.max(0, Math.round((now.getTime() - lastSyncTs) / 3600000)) : null;
  const syncPrefix =
    syncAgeHours !== null && syncAgeHours <= 72
      ? `根据最近（约 ${syncAgeHours === 0 ? "刚刚" : `${syncAgeHours} 小时前`}）同步的评分数据，`
      : "查阅了馆藏的 Bangumi 评分记录，";

  if (scoredBgmPlan.length > 0) {
    const topPlan = scoredBgmPlan[0];
    const topScore = Number(topPlan.preciseScore ?? topPlan.publicScore ?? topPlan.bangumiScore).toFixed(1);
    deck.push({
      type: "consult:bgm_rating_highlight",
      state: "success",
      badgeText: "✦ 洛琪希 · 评分情报",
      isPrimary: false,
      message: `${syncPrefix}您「想看」候补里的《${topPlan.name}》在 Bangumi 上拿到了 ${topScore} 分的高评价，口碑相当扎实，不知道下一部看什么的话选它准没错。`
    });
  }

  // [4] 编目督导与进度提醒（warn2 —— 竖起食指叮嘱姿态）
  const nearDone = items
    .filter((it) => {
      const w = Number(it.watchedEpisodes) || 0;
      const t = Number(it.totalEpisodes) || 0;
      return w > 0 && t > w;
    })
    .sort((a, b) => (Number(a.totalEpisodes) - Number(a.watchedEpisodes)) - (Number(b.totalEpisodes) - Number(b.watchedEpisodes)));

  const unscoredCompleted = completed.filter((it) => it.personalScore === null);

  if (nearDone.length > 0) {
    const target = nearDone[0];
    const w = Number(target.watchedEpisodes) || 0;
    const t = Number(target.totalEpisodes) || 0;
    const rem = t - w;
    deck.push({
      type: "consult:teacher_reminder",
      state: "warn2",
      badgeText: "✦ 洛琪希 · 进度提醒",
      isPrimary: false,
      message:
        unscoredCompleted.length > 0
          ? `稍微提醒一下，《${target.name}》已经看到第 ${w}/${t} 话，只差最后 ${rem} 话就能收官了；另外还有《${unscoredCompleted[0].name}》等 ${unscoredCompleted.length} 部已看作品还没打个人评分哦。`
          : `稍微提醒一下，《${target.name}》已经看到第 ${w}/${t} 话了，只差最后 ${rem} 话就能全部看完，要不要趁热打铁把它补完呢？`
    });
  } else if (unscoredCompleted.length > 0) {
    deck.push({
      type: "consult:teacher_unscored",
      state: "warn2",
      badgeText: "✦ 洛琪希 · 评分叮嘱",
      isPrimary: false,
      message: `稍微提醒一下，您看过的《${unscoredCompleted[0].name}》等 ${unscoredCompleted.length} 部完结作品还没有登记个人评分哦。趁着印象还深刻，给它们打个分吧。`
    });
  } else {
    deck.push({
      type: "consult:teacher_neat",
      state: "warn2",
      badgeText: "✦ 洛琪希 · 进度提醒",
      isPrimary: false,
      message: `看完了新的一话之后，请记得顺手点一下卡片上的「+1」按钮登记进度哦。保持观看记录整洁可是追番整理的基本功呢。`
    });
  }

  // [5] 个人评分 vs BGM 均分品味对照 & 囤番无奈感叹（blocked —— 无奈叹气摊手姿态）
  if (plan.length >= Math.max(5, completed.length * 2)) {
    deck.push({
      type: "consult:backlog_sigh",
      state: "blocked",
      badgeText: "✦ 洛琪希 · 候补盘点",
      isPrimary: false,
      message: `稍微数了一下，您的「想看」候补已经攒到 ${plan.length} 部了，而「已看」只有 ${completed.length} 部……虽然收集新番让人很安心，但偶尔也要记得消消库存呀。`
    });
  } else {
    deck.push({
      type: "consult:backlog_calm",
      state: "blocked",
      badgeText: "✦ 洛琪希 · 馆藏感叹",
      isPrimary: false,
      message: `整理这 ${items.length} 卷动画档案比想象中还要花心思呢……如果觉得列表太长不好找，随时可以用上方的快筛胶囊或者搜索框交给我来过滤。`
    });
  }

  // [6] 时段问候与主力制作社统计（深夜用 warn2 叮嘱休息，白天用 success 欣慰汇报）
  let totalWatchedEp = 0;
  const studioMap = new Map();
  for (const it of items) {
    totalWatchedEp += Number(it.watchedEpisodes) || 0;
    if (it.studio) {
      String(it.studio)
        .split(/[,;\/、&]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((st) => studioMap.set(st, (studioMap.get(st) || 0) + 1));
    }
  }
  const hours = ((totalWatchedEp * 24) / 60).toFixed(1);
  let topStudio = "多家动画制作社";
  let topStudioCnt = 0;
  for (const [k, v] of studioMap.entries()) {
    if (v > topStudioCnt) {
      topStudioCnt = v;
      topStudio = `${k}（${v}部）`;
    }
  }

  if (timing.curHour >= 23 || timing.curHour < 5) {
    deck.push({
      type: "consult:late_night_care",
      state: "warn2",
      badgeText: "✦ 洛琪希 · 夜深叮嘱",
      isPrimary: false,
      message: `已经这么晚了还在整理番剧档案馆吗？您累计已经看完了 ${totalWatchedEp} 话（约 ${hours} 小时），就算动画再吸引人，熬夜太晚也会伤身体的，请早点休息吧。`
    });
  } else {
    deck.push({
      type: "consult:archive_milestone",
      state: "success",
      badgeText: "✦ 洛琪希 · 馆藏小结",
      isPrimary: false,
      message: `截至目前，您的番剧档案馆共收录 ${items.length} 部作品，累计观看 ${totalWatchedEp} 话（约 ${hours} 小时），其中收录最多的是 ${topStudio} 的作品呢。`
    });
  }

  return deck;
}

/**
 * 当用户连续多次点击洛琪希时，返回符合角色性格的递进抗议/讨饶/眩晕预警台词（满 100 下触发替身玩偶或弹飞彩蛋）
 */
function buildOverPokeReaction(pokeStreak) {
  const warnLines = [
    "那、那个……请不要一直连续戳我啦！我是在认真帮您核对追番记录，可不是放在桌角解闷的玩偶哦。",
    "禁止继续乱戳！再这样打岔的话，我今天就不帮您留意新番的开播日期了哦。"
  ];
  const panicLines = [
    "呜哇……帽子都要被您戳歪了！就算一直按我也不会掉出隐藏动画来的，快去挑一部番看吧！",
    "请、请饶了我吧……如果您是想看回最关键的首要事项，点一下气泡上面的「↺ 首要」就能马上切回去了！",
    "别、别再连击了！再戳下去手里的追番记录本都要散落一地啦！"
  ];

  if (pokeStreak >= 99) {
    return {
      type: "poke:critical_99",
      state: "overpoke",
      badgeText: "✦ 洛琪希 · 临界警报",
      isPrimary: false,
      autoHideMs: 12000,
      message: "九、九十九下了……？！魔力稳定术式已经彻底撑不住了，下一下绝对要发动紧急替身术或者被弹飞出去了，快停手呀——！"
    };
  }
  if (pokeStreak >= 80) {
    return {
      type: "poke:dizzy_80",
      state: "overpoke",
      badgeText: "✦ 洛琪希 · 天旋地转",
      isPrimary: false,
      autoHideMs: 12000,
      message: `已经连戳 ${pokeStreak} 下了……呜哇，眼前的画面开始高速转圈了，再戳满 100 下真的要控制不住变成布偶或者乱飞了——！`
    };
  }
  if (pokeStreak >= 50) {
    return {
      type: "poke:dizzy_50",
      state: "overpoke",
      badgeText: "✦ 洛琪希 · 魔力紊乱",
      isPrimary: false,
      autoHideMs: 12000,
      message: `五、五十多下了（连戳 ×${pokeStreak}）？！难道您是在测试什么奇怪的百连击隐藏成就吗……头好晕……`
    };
  }
  if (pokeStreak >= 25) {
    return {
      type: "poke:warn_25",
      state: "overpoke",
      badgeText: "✦ 洛琪希 · 严肃警告",
      isPrimary: false,
      autoHideMs: 12000,
      message: `已经连续戳了 ${pokeStreak} 下了哦！就算我是米格路德族，被您这样高频连点也是会失去平衡的！`
    };
  }
  if (pokeStreak >= 15) {
    return {
      type: "poke:overpoke_15",
      state: "overpoke",
      badgeText: "✦ 洛琪希 · 招架不住",
      isPrimary: false,
      autoHideMs: 12000,
      message: panicLines[(pokeStreak - 7) % panicLines.length]
    };
  }
  if (pokeStreak <= 6) {
    return {
      type: "poke:warn",
      state: "warn",
      badgeText: "✦ 洛琪希 · 软气抗议",
      isPrimary: false,
      autoHideMs: 12000,
      message: warnLines[(pokeStreak - 5) % warnLines.length]
    };
  }
  return {
    type: "poke:panic",
    state: "panic",
    badgeText: "✦ 洛琪希 · 慌张讨饶",
    isPrimary: false,
    autoHideMs: 12000,
    message: panicLines[(pokeStreak - 7) % panicLines.length]
  };
}

/**
 * 当洛琪希处于「百连击替身布偶（plushie01 / plushie02）」状态时，点击布偶的软萌棉花反馈台词
 */
function buildPlushiePokeReaction(pokeCount = 1, plushieVariant = "plushie01") {
  const isButtonEyes = plushieVariant === "plushie01";
  const lines = isButtonEyes
    ? [
        "（轻轻捏了捏纽扣眼布偶洛琪希软乎乎的法师帽，头顶那一小撮白棉花跟着颤了颤，发出『噗叽』一声轻响……）",
        "（戳了戳布偶脸颊上的十字缝线，里面塞得满满当当的高弹棉花立刻乖巧地回弹了起来。）",
        "（布偶背后的小标签上写着：『米格路德特制抗连击替身玩偶 · 1号机』——点击下方按钮即可唤回洛琪希真身哦。）",
        "（再怎么戳这只纽扣眼布偶，它也只会端正地坐在桌角冲您歪头微笑，看来本尊正躲在书架后面安心喝甜茶呢。）"
      ]
    : [
        "（轻轻按了按刺绣眼Fumo布偶洛琪希圆滚滚的脸蛋，蓬松柔软的绒毛手感极佳，完全不怕您的高频连击。）",
        "（捏了捏布偶垂在肩头的蓝发双辫，精细的十字针脚在灯光下泛着柔和的棉线光泽。）",
        "（布偶斗篷内侧夹着一张小字条：『既然您这么喜欢戳玩偶，这只软绵绵的2号替身就先借您解闷啦 —— 洛琪希留』）",
        "（噗呼……布偶肚子里塞满了晒过太阳的暖棉花，想念洛琪希真身的话，随时点底栏的「唤回真身」就行哦。）"
      ];
  const idx = Math.max(0, (pokeCount - 1) % lines.length);
  return {
    type: `poke:plushie_${plushieVariant}_${idx}`,
    state: plushieVariant,
    badgeText: isButtonEyes ? "✦ 替身布偶 · 纽扣眼1号" : "✦ 替身布偶 · 刺绣眼2号",
    stepHint: "棉花替身",
    isPrimary: false,
    priority: PRIORITY.HIGH,
    force: true,
    autoHideMs: 9000,
    message: lines[idx]
  };
}

/**
 * 复古 2D 像素魔法烟雾 + 替身玩偶落地动画（小跳 -> 12fps 阶跃像素烟雾团与十字星 -> 切换玩偶并Q弹坠地）
 */
function runPlushieTransformEasterEgg(actorStageEl, options = {}) {
  if (!actorStageEl) {
    if (typeof options.onTransformMidpoint === "function") options.onTransformMidpoint();
    if (typeof options.onComplete === "function") options.onComplete();
    return () => {};
  }

  let cancelled = false;
  let rafId = null;
  let midpointTriggered = false;
  const timers = [];

  // 创建复古像素烟雾 Canvas 覆盖层
  const smokeCanvas = document.createElement("canvas");
  smokeCanvas.className = "roxy-pixel-smoke-canvas";
  const cw = 180;
  const ch = 180;
  smokeCanvas.width = cw;
  smokeCanvas.height = ch;
  smokeCanvas.style.cssText =
    "position:absolute;left:50%;top:52%;width:168px;height:168px;transform:translate(-50%,-50%);pointer-events:none;z-index:12;image-rendering:pixelated;";
  actorStageEl.appendChild(smokeCanvas);
  const ctx = smokeCanvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;

  // 生成复古像素烟雾粒子与魔法十字星
  const palette = ["#f7f0ff", "#e5d4ff", "#b79ced", "#7998d8", "#ffd97d", "#ffffff"];
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const angle = (Math.PI * 2 * i) / 26 + (Math.random() - 0.5) * 0.25;
    const speed = 28 + Math.random() * 68;
    puffs.push({
      x: cw / 2,
      y: ch / 2 + 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 12,
      size: i % 3 === 0 ? 18 : i % 2 === 0 ? 14 : 10,
      color: palette[i % palette.length],
      bornFrame: i % 3
    });
  }

  const drawPixelCluster = (cx, cy, radius, color, alpha) => {
    if (!ctx || alpha <= 0.05) return;
    const px = 4; // 4x4 像素块粒度
    const r = Math.max(px, Math.round(radius / px) * px);
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
    // 十字阶梯像素圆团
    ctx.fillRect(Math.round((cx - r) / px) * px, Math.round((cy - r * 0.5) / px) * px, r * 2, r);
    ctx.fillRect(Math.round((cx - r * 0.5) / px) * px, Math.round((cy - r) / px) * px, r, r * 2);
    ctx.fillRect(Math.round((cx - r * 0.75) / px) * px, Math.round((cy - r * 0.75) / px) * px, r * 1.5, r * 1.5);
  };

  const drawPixelStar = (cx, cy, arm, color, alpha) => {
    if (!ctx || alpha <= 0.05) return;
    const px = 3;
    const a = Math.max(px, Math.round(arm / px) * px);
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
    ctx.fillRect(Math.round(cx / px) * px - a, Math.round(cy / px) * px, a * 2 + px, px);
    ctx.fillRect(Math.round(cx / px) * px, Math.round(cy / px) * px - a, px, a * 2 + px);
  };

  // 第一阶段 (0~210ms)：被戳满100下受惊小跳腾空
  actorStageEl.style.transition = "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)";
  actorStageEl.style.transform = "translate3d(0, -34px, 0) scale(0.9, 1.12)";

  const t0 = performance.now();
  let lastSteppedFrame = -1;

  const stepSmoke = (now) => {
    if (cancelled) return;
    const elapsed = now - t0;

    // 在 200ms 腾空顶点触发烟雾爆开与玩偶替身切换
    if (elapsed >= 200 && !midpointTriggered) {
      midpointTriggered = true;
      if (typeof options.onTransformMidpoint === "function") {
        options.onTransformMidpoint();
      }
      // 玩偶从烟雾中自由落体并带棉花Q弹着陆
      if (typeof actorStageEl.animate === "function") {
        actorStageEl.style.transition = "none";
        actorStageEl.style.transform = "";
        actorStageEl.animate(
          [
            { transform: "translate3d(0, -32px, 0) scale(0.82, 1.16) rotate(-6deg)", offset: 0 },
            { transform: "translate3d(0, 6px, 0) scale(1.18, 0.82) rotate(4deg)", offset: 0.44 },
            { transform: "translate3d(0, -10px, 0) scale(0.94, 1.07) rotate(-2deg)", offset: 0.68 },
            { transform: "translate3d(0, 2px, 0) scale(1.04, 0.96) rotate(1deg)", offset: 0.86 },
            { transform: "translate3d(0, 0, 0) scale(1, 1) rotate(0deg)", offset: 1 }
          ],
          {
            duration: 560,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "none"
          }
        );
      } else {
        actorStageEl.style.transition = "transform 0.36s cubic-bezier(0.34, 1.56, 0.64, 1)";
        actorStageEl.style.transform = "translate3d(0, 0, 0) scale(1, 1)";
      }
    }

    // 200ms ~ 780ms 渲染 15fps 复古阶跃像素魔法烟雾
    if (elapsed >= 190 && elapsed <= 780 && ctx) {
      const smokeElapsed = (elapsed - 190) / 1000;
      const frameIdx = Math.floor(smokeElapsed * 15);
      if (frameIdx !== lastSteppedFrame) {
        lastSteppedFrame = frameIdx;
        ctx.clearRect(0, 0, cw, ch);
        const stepT = frameIdx / 15;
        const progress = Math.min(1, smokeElapsed / 0.58);

        // 中心初始像素闪光团
        if (frameIdx <= 2) {
          drawPixelCluster(cw / 2, ch / 2, 34 - frameIdx * 6, "#ffffff", 0.95);
          drawPixelCluster(cw / 2, ch / 2, 24, "#ffd97d", 0.9);
        }

        puffs.forEach((p, idx) => {
          if (frameIdx < p.bornFrame) return;
          const px = p.x + p.vx * stepT;
          const py = p.y + p.vy * stepT - 14 * stepT * stepT;
          const shrink = Math.max(0.2, 1 - progress * 0.72);
          const alpha = progress < 0.3 ? 0.95 : Math.max(0, (1 - progress) * 1.35);
          drawPixelCluster(px, py, p.size * shrink, p.color, alpha);
          if (idx % 4 === 0 && frameIdx >= 1 && frameIdx <= 6) {
            drawPixelStar(px + 8, py - 8, 9 * shrink, "#ffd97d", alpha);
          }
        });
      }
    }

    if (elapsed < 800) {
      rafId = requestAnimationFrame(stepSmoke);
    } else {
      smokeCanvas.remove();
      actorStageEl.style.transition = "";
      actorStageEl.style.transform = "";
      if (typeof options.onComplete === "function") {
        options.onComplete();
      }
    }
  };

  rafId = requestAnimationFrame(stepSmoke);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    timers.forEach((t) => clearTimeout(t));
    smokeCanvas.remove();
    actorStageEl.style.transition = "";
    actorStageEl.style.transform = "";
  };
}

/**
 * 当「连戳×100」把洛琪希弹飞消失或变成替身布偶后，用户点击召唤按钮将她哄回来时的多结果随机抱怨台词池
 */
function buildRoxyRunawayComplaintRecord(coord, wasPlushie = false) {
  const plushieComplaints = [
    {
      state: "warn",
      badgeText: "✦ 洛琪希 · 解除替身术",
      message:
        "噗呼……总算把替身布偶收回法袍口袋里了。您刚才居然一口气连戳了整整 100 下，要不是我及时施展米格路德替身术，帽子都要被您戳穿啦！"
    },
    {
      state: "warn2",
      badgeText: "✦ 洛琪希 · 收起棉花布偶",
      message:
        "咳咳！替身玩偶虽然耐戳，但馆藏记录员本尊可不是用来练习百连击手速的哦。看在您主动唤我回来的份上，这次就先不扣平时分了！"
    },
    {
      state: "panic",
      badgeText: "✦ 洛琪希 · 拍拍布偶灰尘",
      message:
        "呜……我躲在书架后面喝甜茶的时候，都看到您还在一个劲地捏那只替身布偶的脸颊了！下次想聊天的话，轻轻点一下就够了啦……"
    }
  ];
  const pinballComplaints = [
    {
      state: "warn",
      badgeText: "✦ 洛琪希 · 气鼓鼓抱怨",
      message:
        "真是的……居然一口气连戳了整整 100 下！害得我在整个页面里像弹珠一样到处乱撞，发辫都散开了……下次再这样捉弄老师，我真的要扣您平时分了！"
    },
    {
      state: "blocked",
      badgeText: "✦ 洛琪希 · 头晕目眩",
      message:
        "唔……眼前的番剧卡片还在转圈圈……被您连戳 100 下弹飞出去之后，我在窗外缓了好半天。就算我是米格路德族，也不是抗揍的史莱姆弹球呀……"
    },
    {
      state: "warn2",
      badgeText: "✦ 洛琪希 · 严正抗议",
      message:
        "咳咳！虽然听到您的召唤还是乖乖回来了，但我必须严正声明——馆藏记录员的职责是核对追番记录，绝对不包括『百连击满屏弹射表演』！"
    },
    {
      state: "panic",
      badgeText: "✦ 洛琪希 · 委屈控诉",
      message:
        "呜……魔杖差点都飞丢了，法袍边角也撞皱了……您把人戳飞出去又装作若无其事地召唤回来，至少要先道个歉或者请我喝杯甜茶补偿一下吧？"
    },
    {
      state: "warn",
      badgeText: "✦ 洛琪希 · 按紧法师帽",
      message:
        "我回来了……但这次我会双手死死按住帽子的！刚才在屏幕四个角哐当哐当弹来弹去的时候，差点以为自己变成了弹珠台里的小钢珠……太失礼了！"
    },
    {
      state: "blocked",
      badgeText: "✦ 洛琪希 · 幽怨叹气",
      message:
        "唉……有连戳我 100 下的手速和耐力，明明都足够把「想看」列表里的动画点开看两集了。下次请把这份干劲用在正经追番上好吗？"
    }
  ];

  const pool = wasPlushie ? plushieComplaints : pinballComplaints;
  let nextIdx = Math.floor(Math.random() * pool.length);
  if (coord && typeof coord.lastRunawayComplaintIdx === "number" && pool.length > 1) {
    if (nextIdx === coord.lastRunawayComplaintIdx) {
      nextIdx = (nextIdx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
    }
    coord.lastRunawayComplaintIdx = nextIdx;
  }

  const picked = pool[nextIdx];
  return {
    type: `roxy:summoned_back_${wasPlushie ? "plushie" : "pinball"}_${nextIdx}`,
    state: picked.state,
    badgeText: picked.badgeText,
    stepHint: "召唤归来",
    isPrimary: false,
    priority: PRIORITY.CRITICAL,
    force: true,
    autoHideMs: 16000,
    message: picked.message
  };
}

/**
 * 向洛琪希馆藏记录员发送真实状态事件（自动执行冷却、去重与优先级裁决，并支持自定义角色名与台词覆写）
 */
function emitRoxyEvent(plugin, payload = {}) {
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord) return false;

  // 若开启了「静默值守（封口白条）」模式，拦截所有非用户主动点击看板娘触发的自动搭话事件
  if (plugin?.settings?.roxyQuietMode && !payload.userInitiated) {
    return false;
  }

  const now = Date.now();
  const rawState = payload.state || "explain";
  const state =
    ROXY_PORTRAIT_FILES[rawState] || ROXY_CHIBI_SPRITE_FILES[rawState] ? rawState : "explain";
  const priority = payload.priority || PRIORITY.NORMAL;
  const eventType = payload.type || "general";
  const mascotName = getMascotDisplayName(plugin);
  const rawMessage = String(payload.message || "").trim();
  const finalMessage = applyCustomDialogueOverride(plugin, eventType, rawMessage, state);
  const dedupeKey = payload.dedupeKey || `${eventType}:${state}:${finalMessage}`;
  const force = Boolean(payload.force);

  if (!force) {
    const prevKeyTime = coord.dedupeMap.get(dedupeKey) || 0;
    if (now - prevKeyTime < DEDUPE_WINDOW_MS) {
      coord.dedupeSuppressedCount = (coord.dedupeSuppressedCount || 0) + 1;
      return false;
    }

    const isSameType = coord.lastEventType === eventType;
    const baseGap = COOLDOWN_BY_PRIORITY[priority] ?? 4000;
    const minGap = !isSameType && priority >= PRIORITY.NORMAL ? 1200 : baseGap;
    const elapsed = now - coord.lastEventAt;
    if (elapsed < minGap && priority <= coord.lastPriority) {
      coord.cooldownSuppressedCount = (coord.cooldownSuppressedCount || 0) + 1;
      return false;
    }
  }

  coord.emittedCount = (coord.emittedCount || 0) + 1;
  coord.dedupeMap.set(dedupeKey, now);
  coord.lastEventAt = now;
  coord.lastPriority = priority;
  coord.lastEventType = eventType;
  coord.currentState = state;
  coord.isShowingPrimary = Boolean(payload.isPrimary);

  let badgeText =
    payload.badgeText ||
    (payload.category ? `✦ ${mascotName} · ${payload.category}` : `✦ ${mascotName} · ${STATE_LABELS[state] || "记录"}`);
  if (mascotName !== "洛琪希" && badgeText.includes("洛琪希")) {
    badgeText = badgeText.replace(/洛琪希/g, mascotName);
  }

  const record = {
    id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
    ts: now,
    type: eventType,
    state,
    badgeText,
    stepHint: payload.stepHint || "",
    isPrimary: Boolean(payload.isPrimary),
    userInitiated: Boolean(payload.userInitiated),
    message: finalMessage,
    priority,
    autoHideMs: payload.autoHideMs ?? 6500
  };

  if (record.message) {
    coord.history.unshift(record);
    if (coord.history.length > 15) {
      coord.history.length = 15;
    }
  }

  coord.listeners2D.forEach((fn) => {
    try {
      fn(record);
    } catch {}
  });
  coord.listeners3D.forEach((fn) => {
    try {
      fn(record);
    } catch {}
  });

  return true;
}

function resolveRoxyOverlayMountHost(container) {
  if (!container) return null;
  const leafContent =
    typeof container.closest === "function" ? container.closest(".workspace-leaf-content") : null;
  if (leafContent) return leafContent;
  if (container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")) {
    return container.parentElement;
  }
  return container;
}

/**
 * 在二维“案头编目台”挂载或刷新洛琪希馆藏记录员
 */
function mountRoxy2DMascot(plugin, container, state, helpers = {}) {
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord || !container) return null;

  const scrollHostEl =
    container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")
      ? container.parentElement
      : container;
  // 挂载到非滚动的 .workspace-leaf-content 层，避免 Android Chromium 在 contain:strict + overflow:auto 下把 position:fixed 随内容滚出视口
  const hostEl = resolveRoxyOverlayMountHost(container) || scrollHostEl;

  [hostEl, scrollHostEl].forEach((scope) => {
    if (!scope) return;
    scope.querySelectorAll(".curator-roxy-widget").forEach((existing) => {
      if (typeof existing._cleanupRoxy === "function") {
        existing._cleanupRoxy();
      }
      existing.remove();
    });
    scope.querySelectorAll(".curator-roxy-wakeup-pill").forEach((pill) => {
      if (typeof pill._cleanupAnchor === "function") {
        pill._cleanupAnchor();
      }
      pill.remove();
    });
  });

  const modeInfo = normalizeRoxy2DModeSettings(plugin);
  coord.hdPortraitsAvailable = modeInfo.hdInstalled;

  const isMobile = isMobileEnv();
  const isEnabled = modeInfo.isEnabled;
  const isSessionHidden = Boolean(coord.sessionHidden2D);
  const isCurrentlyMinimized = () =>
    isMobile ? coord.mobileExpanded2D !== true : Boolean(plugin.settings.roxy2DMinimized);
  const setMinimizedState = async (nextMin) => {
    if (isMobile) {
      coord.mobileExpanded2D = !nextMin;
    } else {
      plugin.settings.roxy2DMinimized = nextMin;
      await plugin.saveSettings().catch(() => {});
    }
  };
  const isMinimized = isCurrentlyMinimized();
  const isRunaway = Boolean(coord.runaway2D);
  const isPlushie = Boolean(coord.plushieState2D);
  const isDockAutoCollapse = !isMobile && Boolean(plugin.settings.roxyDockExpandOnClickOnly);
  const isQuietMode = Boolean(plugin.settings.roxyQuietMode);
  const mascotName = getMascotDisplayName(plugin);

  syncTopbarRoxyButton(plugin, container, state, helpers);

  if (!isEnabled || isSessionHidden) {
    return null;
  }

  const useHdInitially = modeInfo.useHd && !isPlushie;

  const widget = hostEl.createDiv(
    `curator-roxy-widget ${isRunaway ? "is-runaway" : isMinimized ? "is-minimized" : "is-expanded"} ${
      useHdInitially ? "is-hd-portrait-mode" : "is-pixel-fallback-mode"
    }${isPlushie ? " is-plushie-mode" : ""}${isDockAutoCollapse ? " is-dock-auto-collapse" : ""}${
      isQuietMode ? " is-quiet-mode" : ""
    }${isMobile ? " is-mobile-roxy" : ""}`
  );
  widget.dataset.roxyState = coord.plushieState2D || coord.currentState || "explain";
  const cleanupLeafAnchor = bindRoxyLeafBoundsAnchor(widget, hostEl);

  // 1. 对话气泡（含状态徽章、轮播序号、「↺ 首要」还原按钮、关闭按钮，以及长按回顶提示专属「不再显示」轻按钮）
  const bubble = widget.createDiv("curator-roxy-bubble is-hidden");
  const bubbleHeader = bubble.createDiv("curator-roxy-bubble-header");
  const bubbleLeftMeta = bubbleHeader.createDiv("curator-roxy-bubble-meta");
  const bubbleBadge = bubbleLeftMeta.createSpan({
    cls: "curator-roxy-bubble-badge",
    text: `✦ ${mascotName} · ${STATE_LABELS[coord.currentState] || "导览"}`
  });
  const bubbleStep = bubbleLeftMeta.createSpan({
    cls: "curator-roxy-bubble-step",
    text: ""
  });

  const bubbleRightCtrls = bubbleHeader.createDiv("curator-roxy-bubble-ctrls");
  const restorePrimaryBtn = bubbleRightCtrls.createEl("button", {
    cls: "curator-roxy-bubble-restore",
    text: "↺ 首要"
  });
  restorePrimaryBtn.dataset.roxyAction = "restore-primary";
  restorePrimaryBtn.title = "将气泡内容还原为当前最需要优先关注的首要事项";

  const bubbleCloseBtn = bubbleRightCtrls.createEl("button", {
    cls: "curator-roxy-bubble-close",
    text: "×"
  });
  bubbleCloseBtn.title = "收起提示气泡";

  const bubbleText = bubble.createDiv({
    cls: "curator-roxy-bubble-text",
    text: ""
  });

  const bubbleFooter = bubble.createDiv("curator-roxy-bubble-footer is-hidden");
  const dismissPullHintBtn = bubbleFooter.createEl("button", {
    cls: "curator-roxy-bubble-dismiss-hint",
    text: "不再显示"
  });
  dismissPullHintBtn.dataset.roxyAction = "dismiss-pull-hint";
  dismissPullHintBtn.title = "永久不再弹出长按回顶教学提示（不影响长按拉动回顶功能本身）";

  // 2. 立绘舞台（完整呈现高清立绘或内置 8 态 Q 版像素立绘；内置可随动作同步形变的嘴部白色封条贴纸）
  const stage = widget.createDiv("curator-roxy-stage");
  const hdPortraitHost = stage.createDiv("curator-roxy-hd-host roxy-clean-fx");
  const portraitImg = hdPortraitHost.createEl("img", {
    cls: "curator-roxy-portrait roxy-clean-fx"
  });
  const hdBandageEl = hdPortraitHost.createDiv(
    `roxy-mouth-bandage is-2d-hd${isQuietMode ? " is-visible" : ""}`
  );
  hdBandageEl.createSpan({ cls: "roxy-mouth-bandage-cross", text: "×" });

  const pixelFallbackHost = stage.createDiv("curator-roxy-pixel-fallback roxy-clean-fx");
  const chibiSpriteImg = pixelFallbackHost.createEl("img", {
    cls: "curator-roxy-chibi-sprite"
  });
  chibiSpriteImg.draggable = false;
  const chibiOfflineBadge = pixelFallbackHost.createDiv({
    cls: "curator-roxy-chibi-offline-badge",
    text: `✦ ${mascotName}`
  });
  chibiOfflineBadge.style.display = "none";
  const chibiBandageEl = pixelFallbackHost.createDiv(
    `roxy-mouth-bandage is-2d-chibi${isQuietMode ? " is-visible" : ""}`
  );
  chibiBandageEl.createSpan({ cls: "roxy-mouth-bandage-cross", text: "×" });

  // 蓄力下拉弹簧回顶指示器（按住 1 秒或向下拖动时浮现呼吸下箭头与蓄力进度提示）
  const pullIndicator = stage.createDiv("curator-roxy-pull-indicator");
  pullIndicator.createSpan({
    cls: "curator-roxy-pull-arrows",
    text: "▾"
  });
  const pullHintLabel = pullIndicator.createSpan({
    cls: "curator-roxy-pull-label",
    text: "下拉回顶"
  });

  const ensurePixelFallbackAvatar = (poseState) => {
    const activePose = coord.plushieState2D || poseState || coord.currentState || "explain";
    const chibiFile =
      ROXY_CHIBI_SPRITE_FILES[activePose] || ROXY_CHIBI_SPRITE_FILES.explain;
    const localUrl =
      (coord.resolvedChibiUrls && coord.resolvedChibiUrls[chibiFile]) ||
      resolveRoxyChibiAssetUrl(plugin, chibiFile);
    const targetUrl = localUrl || getRoxyChibiCdnFallbackUrl(chibiFile);

    chibiSpriteImg.dataset.chibiFile = chibiFile;
    chibiSpriteImg.dataset.chibiFallbackStage = localUrl ? "local" : "cdn";
    chibiOfflineBadge.style.display = "none";
    chibiSpriteImg.style.display = "block";
    if (chibiSpriteImg.getAttribute("src") !== targetUrl) {
      chibiSpriteImg.src = targetUrl;
    }
    if (!localUrl) {
      ensureRoxyChibiSpritesCached(plugin, chibiFile);
    }
    return chibiSpriteImg;
  };

  chibiSpriteImg.onerror = () => {
    const chibiFile = chibiSpriteImg.dataset.chibiFile || ROXY_CHIBI_SPRITE_FILES.explain;
    if (chibiSpriteImg.dataset.chibiFallbackStage === "local") {
      if (!coord.missingChibiFiles) coord.missingChibiFiles = new Set();
      coord.missingChibiFiles.add(chibiFile);
      chibiSpriteImg.dataset.chibiFallbackStage = "cdn";
      chibiSpriteImg.src = getRoxyChibiCdnFallbackUrl(chibiFile);
      ensureRoxyChibiSpritesCached(plugin, chibiFile);
      return;
    }
    chibiSpriteImg.style.display = "none";
    chibiOfflineBadge.style.display = "inline-flex";
  };

  const initState = coord.plushieState2D || coord.currentState || "explain";

  const sync2DBandagePosition = (poseState) => {
    const pose = coord.plushieState2D || poseState || widget.dataset.roxyState || "explain";
    applyMouthBandageGeometry(hdBandageEl, "hd", pose);
    applyMouthBandageGeometry(chibiBandageEl, "chibi2d", pose);
  };

  const applyStageMode = (targetState) => {
    // 若处于「百连击替身玩偶」状态，优先展示纽扣眼/Fumo玩偶 PNG
    if (coord.plushieState2D) {
      widget.classList.remove("is-hd-portrait-mode");
      widget.classList.add("is-pixel-fallback-mode", "is-plushie-mode");
      hdPortraitHost.style.display = "none";
      portraitImg.style.display = "none";
      pixelFallbackHost.style.display = "flex";
      ensurePixelFallbackAvatar(coord.plushieState2D);
      sync2DBandagePosition(coord.plushieState2D);
      return;
    }
    widget.classList.remove("is-plushie-mode");

    const pose =
      ROXY_PORTRAIT_FILES[targetState] || ROXY_CHIBI_SPRITE_FILES[targetState]
        ? targetState
        : "explain";

    // 若用户在设置中配置了自定义立绘覆盖，优先使用自定义立绘
    const customOverrideUrl = resolveCustomPortraitOverride(plugin, pose);
    if (customOverrideUrl) {
      widget.classList.add("is-hd-portrait-mode");
      widget.classList.remove("is-pixel-fallback-mode");
      hdPortraitHost.style.display = "flex";
      portraitImg.style.display = "block";
      pixelFallbackHost.style.display = "none";
      if (portraitImg.getAttribute("src") !== customOverrideUrl) {
        portraitImg.src = customOverrideUrl;
      }
      sync2DBandagePosition(pose);
      return;
    }

    const file = ROXY_PORTRAIT_FILES[pose] || ROXY_PORTRAIT_FILES.explain;
    if (!coord.hdPortraitsAvailable) {
      const latestStatus = checkRoxyHdPortraitsStatus(plugin);
      if (latestStatus.installed) {
        coord.hdPortraitsAvailable = true;
        coord.preloaded = false;
        preloadAllRoxyPortraits(plugin, coord);
      }
    }
    const canUseHd =
      Boolean(coord.hdPortraitsAvailable) &&
      plugin.settings.enableRoxy2DMascotMaster !== false &&
      plugin.settings.enableRoxy2DMascot === true &&
      plugin.settings.roxyForceLightweight2D !== true;
    if (canUseHd) {
      const nextUrl =
        (coord.resolvedUrls && coord.resolvedUrls[file]) || resolveRoxyAssetUrl(plugin, file);
      if (nextUrl) {
        const wasFallback = widget.classList.contains("is-pixel-fallback-mode");
        widget.classList.add("is-hd-portrait-mode");
        widget.classList.remove("is-pixel-fallback-mode");
        hdPortraitHost.style.display = "flex";
        portraitImg.style.display = "block";
        pixelFallbackHost.style.display = "none";
        if (wasFallback || portraitImg.getAttribute("src") !== nextUrl) {
          portraitImg.src = nextUrl;
        }
        sync2DBandagePosition(pose);
        return;
      }
    }
    // 未安装高清立绘扩展包或启用内置轻量像素形象：展示经过色温与头身比精校的内置 8 态轻量像素形象
    widget.classList.remove("is-hd-portrait-mode");
    widget.classList.add("is-pixel-fallback-mode");
    hdPortraitHost.style.display = "none";
    portraitImg.style.display = "none";
    pixelFallbackHost.style.display = "flex";
    ensurePixelFallbackAvatar(pose);
    sync2DBandagePosition(pose);
  };

  portraitImg.alt = `${mascotName} · 馆藏记录员`;
  portraitImg.draggable = false;
  portraitImg.onerror = () => {
    coord.hdPortraitsAvailable = false;
    applyStageMode(widget.dataset.roxyState || "explain");
    if (packDownloadBtn) {
      packDownloadBtn.style.display = "inline-flex";
    }
  };

  const hitZone = stage.createDiv("curator-roxy-hit-zone");
  hitZone.title = "点击切换番剧咨讯 · 右键还原首要事项";

  // 3. 底部轻量控制名牌（支持常驻显示或「点击看板娘后才长出小横条」）
  const dockBar = widget.createDiv("curator-roxy-dock-bar");
  const summonBackBtn = dockBar.createEl("button", {
    cls: "curator-roxy-summon-btn",
    text: `✦ ${mascotName}被戳飞逃跑了 · 点击召唤回来`
  });
  summonBackBtn.dataset.roxyAction = "summon-runaway";
  summonBackBtn.title = `把被连戳 100 下弹飞出去的${mascotName}重新召唤回来`;

  const unplushieBtn = dockBar.createEl("button", {
    cls: "curator-roxy-unplushie-btn",
    text: `✦ 解除替身玩偶 · 唤回${mascotName}`
  });
  unplushieBtn.dataset.roxyAction = "summon-from-plushie";
  unplushieBtn.title = `解除米格路德替身玩偶术，把躲起来喝甜茶的${mascotName}真身唤回页面`;

  const getDockModeBtnLabel = () => {
    if (isCurrentlyMinimized()) {
      return isMobile ? `✦ ${mascotName}` : `✦ ${mascotName} [展开]`;
    }
    if (isMobile) {
      return `收起 ${mascotName}`;
    }
    return plugin.settings.roxyDockExpandOnClickOnly ? "固定底栏" : "点立绘展栏";
  };
  const getDockModeBtnTitle = () => {
    if (isCurrentlyMinimized()) {
      return `展开${mascotName}馆藏记录员`;
    }
    if (isMobile) {
      return `收起${mascotName}为轻量悬浮胶囊`;
    }
    return plugin.settings.roxyDockExpandOnClickOnly
      ? "当前：点击看板娘后才长出底部小横条 · 点击切换为常驻显示底栏"
      : "当前：常驻显示底部小横条 · 点击切换为仅在点击看板娘后才长出底栏";
  };

  const nameTagBtn = dockBar.createEl("button", {
    cls: "curator-roxy-name-btn",
    text: getDockModeBtnLabel()
  });
  nameTagBtn.title = getDockModeBtnTitle();

  let dockRevealTimer2D = null;
  let isDockHovered2D = false;
  const scheduleDockAutoHide2D = (delayMs = 7000) => {
    if (dockRevealTimer2D) clearTimeout(dockRevealTimer2D);
    if (!plugin.settings.roxyDockExpandOnClickOnly || plugin.settings.roxy2DMinimized || coord.runaway2D) {
      return;
    }
    dockRevealTimer2D = setTimeout(() => {
      if (isDockHovered2D) {
        scheduleDockAutoHide2D(3500);
        return;
      }
      widget.classList.remove("is-dock-revealed");
    }, delayMs);
  };
  const revealDockTemporarily2D = () => {
    if (!plugin.settings.roxyDockExpandOnClickOnly) return;
    widget.classList.add("is-dock-revealed");
    scheduleDockAutoHide2D(7000);
  };
  dockBar.addEventListener("pointerenter", () => {
    isDockHovered2D = true;
    if (dockRevealTimer2D) clearTimeout(dockRevealTimer2D);
  });
  dockBar.addEventListener("pointerleave", () => {
    isDockHovered2D = false;
    if (plugin.settings.roxyDockExpandOnClickOnly) {
      scheduleDockAutoHide2D(3200);
    }
  });

  const ctrlsGroup = dockBar.createDiv("curator-roxy-ctrl-group");

  const packDownloadBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-pack-dl",
    text: "立绘包"
  });
  packDownloadBtn.dataset.roxyAction = "download-hd-pack";
  packDownloadBtn.title = "当前使用内置轻量像素形象 · 点击一键下载洛琪希高清立绘扩展包（7张 PNG）";
  packDownloadBtn.style.display = coord.hdPortraitsAvailable ? "none" : "inline-flex";

  const dockPrimaryBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-primary-reset",
    text: "首要"
  });
  dockPrimaryBtn.dataset.roxyAction = "dock-restore-primary";
  dockPrimaryBtn.title = "还原为当前最需要展现的首要事项";

  const quietBtn = ctrlsGroup.createEl("button", {
    cls: `curator-roxy-ctrl-btn is-quiet-toggle ${isQuietMode ? "is-active is-quiet-active" : ""}`,
    text: isQuietMode ? "解封" : "静默"
  });
  quietBtn.dataset.roxyAction = "toggle-quiet-mode";
  const syncQuietBtnState = () => {
    const active = Boolean(plugin.settings.roxyQuietMode);
    quietBtn.classList.toggle("is-active", active);
    quietBtn.classList.toggle("is-quiet-active", active);
    quietBtn.textContent = active ? "解封" : "静默";
    quietBtn.title = active
      ? `当前：静默值守中（已贴上封口白条，仅在点击${mascotName}时说话）· 点击撕下白条恢复主动播报`
      : `开启静默值守：为${mascotName}贴上封口白条，平时操作不主动弹窗搭话，仅在点击${mascotName}时回应`;
  };
  syncQuietBtnState();

  const minBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn",
    text: isMinimized ? "展开" : "最小化"
  });
  minBtn.dataset.roxyAction = "minimize";
  minBtn.title = isMinimized ? "展开立绘视图" : "最小化为右下角轻量名牌";

  const hideBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn",
    text: "隐藏"
  });
  hideBtn.dataset.roxyAction = "hide-session";
  hideBtn.title = "本次会话暂时隐藏（可从右下角唤醒胶囊随时唤出）";

  const disableBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-muted",
    text: "关闭"
  });
  disableBtn.dataset.roxyAction = "disable-permanent";
  disableBtn.title = "永久关闭二维馆藏记录员（可在插件设置中重新开启）";

  applyStageMode(initState);
  widget._refreshRoxyStageMode = () => {
    const latest = checkRoxyHdPortraitsStatus(plugin);
    coord.hdPortraitsAvailable = latest.installed;
    if (packDownloadBtn) {
      packDownloadBtn.style.display = latest.installed ? "none" : "inline-flex";
    }
    applyStageMode(widget.dataset.roxyState || "explain");
  };

  let bubbleTimer = null;
  let cancelPinballAnim = null;

  const getActiveActorEl = () =>
    widget.classList.contains("is-pixel-fallback-mode") ? pixelFallbackHost : hdPortraitHost;

  const cancelActorAnimations = (el) => {
    if (!el) return;
    if (el._roxySpringAnim) {
      try {
        el._roxySpringAnim.cancel();
      } catch (_) {}
      el._roxySpringAnim = null;
    }
    if (typeof el.getAnimations === "function") {
      try {
        el.getAnimations().forEach((anim) => anim.cancel());
      } catch (_) {}
    }
    el.classList.remove("roxy-pressing", "roxy-anim-qbounce", "roxy-anim-spring-launch");
    portraitImg.classList.remove("roxy-pressing", "roxy-anim-qbounce", "roxy-anim-spring-launch");
  };

  const triggerQBounce = () => {
    const actor = getActiveActorEl();
    cancelActorAnimations(actor);
    actor.style.transition = "";
    actor.style.transform = "";
    void actor.offsetWidth;
    actor.classList.add("roxy-anim-qbounce");
  };

  const triggerBubblePop = () => {
    bubble.classList.remove("roxy-bubble-popping");
    void bubble.offsetWidth;
    bubble.classList.add("roxy-bubble-popping");
  };

  let activeDismissHintType = null;

  const hideBubble = () => {
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    activeDismissHintType = null;
    bubble.classList.remove("is-visible", "roxy-bubble-popping", "is-pull-hint-bubble", "is-wand-hint-bubble");
    bubble.classList.add("is-hidden");
    bubbleFooter.classList.add("is-hidden");
  };

  const showRecord = (record) => {
    if (!record || coord.runaway2D || coord.isPinballFlying2D) return;
    const nextState =
      ROXY_PORTRAIT_FILES[record.state] || ROXY_CHIBI_SPRITE_FILES[record.state]
        ? record.state
        : "explain";
    widget.dataset.roxyState = coord.plushieState2D || nextState;

    applyStageMode(coord.plushieState2D || nextState);

    if (!record.skipBounce) {
      triggerQBounce();
    }

    if (record.message) {
      bubbleBadge.textContent =
        record.badgeText || `✦ ${mascotName} · ${STATE_LABELS[nextState] || "记录"}`;
      bubbleBadge.className = `curator-roxy-bubble-badge is-${nextState}`;
      bubbleStep.textContent = record.stepHint || (record.isPrimary ? "首要" : "");
      bubbleStep.style.display = bubbleStep.textContent ? "inline-flex" : "none";
      restorePrimaryBtn.classList.toggle(
        "is-active-primary",
        Boolean(record.isPrimary || record.isPullHint || record.isWandHint)
      );

      const isPullHint = Boolean(record.isPullHint);
      const isWandHint = Boolean(record.isWandHint);
      const mem = ensureGestureMemory(plugin);
      bubble.classList.toggle("is-pull-hint-bubble", isPullHint);
      bubble.classList.toggle("is-wand-hint-bubble", isWandHint);

      if (isPullHint && !plugin.settings.roxyPullToTopHintDismissed) {
        activeDismissHintType = "pull";
        dismissPullHintBtn.title = "永久不再弹出长按回顶操作提示（不影响长按拉动回顶功能本身）";
        bubbleFooter.classList.remove("is-hidden");
      } else if (isWandHint && !mem.wandHintDismissed) {
        activeDismissHintType = "wand";
        dismissPullHintBtn.title = "永久不再弹出长按/右键关联检索操作提示（不影响长按或右键功能本身）";
        bubbleFooter.classList.remove("is-hidden");
      } else {
        activeDismissHintType = null;
        bubbleFooter.classList.add("is-hidden");
      }

      bubbleText.textContent = record.message;
      const paneEl =
        hostEl.closest(".workspace-leaf-content") ||
        hostEl.closest(".bangumi-score-dashboard-view") ||
        hostEl;
      const paneWidth =
        (paneEl && paneEl.getBoundingClientRect().width) ||
        (typeof window !== "undefined" ? window.innerWidth : 1280);
      const isTightPane2D = paneWidth > 0 && paneWidth <= 540;
      const allowAutoBubbleOnTightPane =
        Boolean(record.userInitiated) ||
        String(record.type || "").startsWith("poke") ||
        record.type === "roxy:hd_pack_installed";
      if (isTightPane2D && !allowAutoBubbleOnTightPane) {
        hideBubble();
      } else {
        bubble.classList.remove("is-hidden");
        bubble.classList.add("is-visible");
        triggerBubblePop();

        if (bubbleTimer) clearTimeout(bubbleTimer);
        const hideMs = record.autoHideMs ?? 6500;
        if (hideMs > 0) {
          bubbleTimer = setTimeout(() => {
            hideBubble();
          }, hideMs);
        }
      }
    }
  };

  dismissPullHintBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dismissedType = activeDismissHintType;
    if (dismissedType === "wand") {
      const mem = ensureGestureMemory(plugin);
      mem.wandHintDismissed = true;
      await plugin.saveSettings().catch(() => {});
      hideBubble();
      if (globalThis.__BangumiManagerNotice) {
        new globalThis.__BangumiManagerNotice("已记住偏好：今后不再弹出长按/右键查看关联收藏的操作提示。");
      }
      return;
    }
    plugin.settings.roxyPullToTopHintDismissed = true;
    await plugin.saveSettings().catch(() => {});
    hideBubble();
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice("已记住偏好：今后不再弹出长按回顶操作提示。");
    }
  };

  // 一键下载高清立绘扩展包处理逻辑
  packDownloadBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (packDownloadBtn.disabled) return;
    packDownloadBtn.disabled = true;
    const origText = packDownloadBtn.textContent;
    packDownloadBtn.textContent = "下载中...";
    try {
      const res = await downloadRoxyHdPortraitPack(plugin, (done, total) => {
        packDownloadBtn.textContent = `${done}/${total}`;
      });
      if (res && res.success) {
        plugin.settings.enableRoxy2DMascot = true;
        plugin.settings.roxyForceLightweight2D = false;
        await plugin.saveSettings().catch(() => {});
        packDownloadBtn.style.display = "none";
        applyStageMode(widget.dataset.roxyState || "explain");
        emitRoxyEvent(plugin, {
          type: "roxy:hd_pack_installed",
          state: "success",
          badgeText: `✦ ${mascotName} · 高清立绘就位`,
          stepHint: "扩展包完成",
          priority: PRIORITY.HIGH,
          force: true,
          autoHideMs: 8000,
          message: "太好了！7 张洛琪希高清透明立绘已成功下载到本地插件目录，现在已经为您切换为高清半身立绘模式啦。"
        });
        if (globalThis.__BangumiManagerNotice) {
          new globalThis.__BangumiManagerNotice("洛琪希高清立绘扩展包下载完成！已自动切换为高清立绘。");
        }
      } else {
        packDownloadBtn.textContent = origText;
        packDownloadBtn.disabled = false;
        if (globalThis.__BangumiManagerNotice) {
          new globalThis.__BangumiManagerNotice(
            `高清立绘包下载未全部完成（成功 ${res?.downloaded || 0}/${res?.total || 7}），请检查网络或在插件设置中重试。`
          );
        }
      }
    } catch (err) {
      packDownloadBtn.textContent = origText;
      packDownloadBtn.disabled = false;
      if (globalThis.__BangumiManagerNotice) {
        new globalThis.__BangumiManagerNotice(`下载高清立绘包失败：${err?.message || err}`);
      }
    }
  };

  // 将被「连戳×100」弹飞消失或变成替身布偶的洛琪希召唤回案头，并弹出多分支随机抱怨台词
  const summonRoxyBack2D = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (typeof cancelPinballAnim === "function") {
      cancelPinballAnim();
      cancelPinballAnim = null;
    }
    const wasPlushie = Boolean(coord.plushieState2D);
    stage.style.transform = "";
    stage.style.opacity = "";
    coord.runaway2D = false;
    coord.isPinballFlying2D = false;
    coord.plushieState2D = null;
    coord.plushiePokeCount2D = 0;
    coord.pokeStreak = 0;
    if (plugin.settings.roxy2DMinimized) {
      plugin.settings.roxy2DMinimized = false;
      plugin.saveSettings().catch(() => {});
    }
    widget.classList.remove("is-runaway", "is-minimized", "is-pinball-rampage", "is-plushie-mode");
    widget.classList.add("is-expanded", "is-summon-landing");
    setTimeout(() => {
      widget.classList.remove("is-summon-landing");
    }, 520);
    nameTagBtn.textContent = getDockModeBtnLabel();
    nameTagBtn.title = getDockModeBtnTitle();
    minBtn.textContent = "最小化";
    applyStageMode("warn");
    syncTopbarRoxyButton(plugin, container, state, helpers);
    const complaintRecord = Object.assign(
      {},
      buildRoxyRunawayComplaintRecord(coord, wasPlushie),
      { userInitiated: true }
    );
    emitRoxyEvent(plugin, complaintRecord);
  };

  summonBackBtn.onclick = summonRoxyBack2D;
  unplushieBtn.onclick = summonRoxyBack2D;
  widget._summonRoxyBack2D = summonRoxyBack2D;

  // 将气泡与立绘还原为当前最需要关注的首要事项（Card 0）
  const restoreToPrimary = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (coord.runaway2D || coord.plushieState2D) {
      summonRoxyBack2D(e);
      return;
    }
    if (plugin.settings.roxy2DMinimized) {
      plugin.settings.roxy2DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameTagBtn.textContent = getDockModeBtnLabel();
      nameTagBtn.title = getDockModeBtnTitle();
      minBtn.textContent = "最小化";
    }
    coord.pokeStreak = 0;
    coord.deckIndex = 0;
    coord.isShowingPrimary = true;
    const primary = buildPrimaryDeskRecord(plugin, state);
    emitRoxyEvent(
      plugin,
      Object.assign({}, primary, {
        force: true,
        userInitiated: true,
        isPrimary: true,
        stepHint: "首要",
        autoHideMs: 10000
      })
    );
  };

  restorePrimaryBtn.onclick = restoreToPrimary;
  dockPrimaryBtn.onclick = restoreToPrimary;

  bubbleCloseBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideBubble();
  };

  // =========================================================================
  // 洛琪希 2D 挂件“长按拉动蓄力 · 弹簧回顶（Pull-to-Top Spring）”四阶段交互
  // =========================================================================
  const PULL_THRESHOLD = isMobile ? 24 : 32;
  let isPointerDown = false;
  let activePointerId = null;
  let startY = 0;
  let startX = 0;
  let currentDy = 0;
  let maxDy = 0;
  let hold1sTimer = null;
  let hold3sTimer = null;
  let hintShownDuringHold = false;
  let suppressNextClick = false;
  let activeScrollRaf = null;

  const getScrollHost = () => {
    const primary =
      typeof plugin.getDashboardScrollParent === "function"
        ? plugin.getDashboardScrollParent(container)
        : container.closest(".bangumi-score-dashboard-view") || container;
    if (primary && (primary.scrollTop > 0 || primary.scrollHeight - primary.clientHeight > 24)) {
      return primary;
    }
    let cur = container;
    while (cur && cur !== document.body) {
      if (cur.scrollTop > 0) return cur;
      cur = cur.parentElement;
    }
    cur = container;
    while (cur && cur !== document.body) {
      if (cur.scrollHeight - cur.clientHeight > 24) return cur;
      cur = cur.parentElement;
    }
    return primary || container;
  };

  const clearPullTimers = () => {
    if (hold1sTimer) {
      clearTimeout(hold1sTimer);
      hold1sTimer = null;
    }
    if (hold3sTimer) {
      clearTimeout(hold3sTimer);
      hold3sTimer = null;
    }
  };

  const resetPullVisuals = (withSpringLaunch = false, pullDy = 0) => {
    widget.classList.remove("is-pull-holding", "is-pull-dragging", "is-pull-ready");
    pullHintLabel.textContent = "下拉回顶";
    cancelActorAnimations(hdPortraitHost);
    cancelActorAnimations(portraitImg);
    cancelActorAnimations(pixelFallbackHost);

    const actor = getActiveActorEl();
    if (!withSpringLaunch) {
      actor.style.transition = "";
      actor.style.transform = "";
      return;
    }

    // 阶段四：松手激发“弹簧发射回顶”与动态高度跳跃 + 阻尼果冻回弹落地
    const scrollEl = getScrollHost();
    const startScrollTop = scrollEl ? Math.max(0, scrollEl.scrollTop || 0) : 0;
    const pullNorm = Math.min(1, Math.max(0.25, pullDy / 110));
    const scrollBoost = Math.min(1, startScrollTop / 1200);
    const jumpPx = Math.round(20 + 22 * pullNorm + 8 * scrollBoost);

    // 1. 平滑快启慢停滚动至页首 (scrollTop = 0)
    if (scrollEl && startScrollTop > 0) {
      if (activeScrollRaf) cancelAnimationFrame(activeScrollRaf);
      const duration = Math.min(760, Math.max(380, 340 + Math.sqrt(startScrollTop) * 7));
      const t0 = performance.now();
      const stepScroll = (now) => {
        const elapsed = now - t0;
        const progress = Math.min(1, elapsed / duration);
        // Quartic ease-out: 蓄力释放初段极快，接近页首时丝滑减速停靠
        const eased = 1 - Math.pow(1 - progress, 4);
        scrollEl.scrollTop = Math.round(startScrollTop * (1 - eased));
        if (progress < 1) {
          activeScrollRaf = requestAnimationFrame(stepScroll);
        } else {
          scrollEl.scrollTop = 0;
          activeScrollRaf = null;
        }
      };
      activeScrollRaf = requestAnimationFrame(stepScroll);
    } else if (scrollEl) {
      scrollEl.scrollTop = 0;
    }

    // 2. 立绘/像素小人执行纵向弹簧起跳与果冻落地动画
    const norm = Math.tanh(Math.max(0, pullDy - 4) / 95);
    const startScaleY = (1 - 0.36 * norm).toFixed(3);
    const startScaleX = (1 + 0.24 * norm).toFixed(3);
    const startSinkY = (6 * norm).toFixed(1);

    actor.style.transition = "none";
    actor.style.transform = "";

    if (typeof actor.animate === "function") {
      const springAnim = actor.animate(
        [
          {
            transform: `translate3d(0, ${startSinkY}px, 0) scaleX(${startScaleX}) scaleY(${startScaleY})`,
            offset: 0
          },
          {
            transform: `translate3d(0, -${jumpPx}px, 0) scaleX(0.87) scaleY(1.16)`,
            offset: 0.28
          },
          {
            transform: "translate3d(0, 3px, 0) scaleX(1.13) scaleY(0.87)",
            offset: 0.58
          },
          {
            transform: "translate3d(0, -7px, 0) scaleX(0.96) scaleY(1.05)",
            offset: 0.78
          },
          {
            transform: "translate3d(0, 1px, 0) scaleX(1.02) scaleY(0.98)",
            offset: 0.91
          },
          {
            transform: "translate3d(0, 0, 0) scaleX(1) scaleY(1)",
            offset: 1
          }
        ],
        {
          duration: 620,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "none"
        }
      );
      actor._roxySpringAnim = springAnim;
      const cleanupAnim = () => {
        if (actor._roxySpringAnim === springAnim) {
          actor._roxySpringAnim = null;
        }
        try {
          springAnim.cancel();
        } catch (_) {}
        actor.style.transform = "";
        actor.style.transition = "";
      };
      springAnim.onfinish = cleanupAnim;
      springAnim.oncancel = () => {
        if (actor._roxySpringAnim === springAnim) {
          actor._roxySpringAnim = null;
        }
      };
    } else {
      actor.classList.add("roxy-anim-spring-launch");
    }
  };

  const isDashboardScrollable = () => {
    const scrollEl = getScrollHost();
    if (!scrollEl) return false;
    return scrollEl.scrollHeight - scrollEl.clientHeight > 64 || scrollEl.scrollTop > 12;
  };

  hitZone.addEventListener("pointerenter", () => {
    hitZone.title = isDashboardScrollable()
      ? "点击切换番剧咨讯 · 按住向下拉动松手可回到顶部（右键还原首要事项）"
      : "点击切换番剧咨讯 · 右键还原首要事项";
  });

  const onTouchMoveBlock = (e) => {
    if (isPointerDown && e.cancelable) {
      e.preventDefault();
    }
  };

  const onWindowPointerMove = (e) => {
    if (!isPointerDown) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) {
      return;
    }
    const dy = e.clientY - startY;
    const dx = e.clientX - startX;
    currentDy = dy;
    if (dy > maxDy) maxDy = dy;

    // 若用户已经明显开始向下拉动，取消 3 秒未拉动教学提示定时器
    if (dy > 14 && hold3sTimer) {
      clearTimeout(hold3sTimer);
      hold3sTimer = null;
    }

    // 水平大幅偏离且未下拉时取消按压
    if (Math.abs(dx) > 90 && dy < 10) {
      clearPullTimers();
      return;
    }

    if (dy > 6) {
      const canPullTop = isDashboardScrollable();
      if (canPullTop) {
        widget.classList.add("is-pull-holding", "is-pull-dragging");
        const isReady = dy >= PULL_THRESHOLD;
        widget.classList.toggle("is-pull-ready", isReady);
        pullHintLabel.textContent = isReady ? "松手回顶 ↑" : "继续下拉";
      } else {
        widget.classList.remove("is-pull-holding", "is-pull-dragging", "is-pull-ready");
      }

      // 阶段二：渐进式阻尼挤压形变（底部锚定于名牌上沿 50% 168px，体积守恒：纵向压缩 + 横向微扩 + 微下沉）
      const norm = Math.tanh(Math.max(0, dy - 4) / 95);
      const scaleY = 1 - 0.36 * norm;
      const scaleX = 1 + 0.24 * norm;
      const sinkY = 6 * norm;
      const actor = getActiveActorEl();
      cancelActorAnimations(actor);
      actor.style.transition = "none";
      actor.style.transform = `translate3d(0, ${sinkY.toFixed(1)}px, 0) scaleX(${scaleX.toFixed(3)}) scaleY(${scaleY.toFixed(3)})`;
    }
  };

  const finishPointerInteraction = (isCancel = false) => {
    if (!isPointerDown) return;
    isPointerDown = false;
    const prevPid = activePointerId;
    activePointerId = null;
    if (prevPid !== null && typeof hitZone.releasePointerCapture === "function") {
      try {
        if (hitZone.hasPointerCapture && hitZone.hasPointerCapture(prevPid)) {
          hitZone.releasePointerCapture(prevPid);
        }
      } catch (_) {}
    }
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
    window.removeEventListener("touchmove", onTouchMoveBlock, { passive: false });
    clearPullTimers();

    const canPullTop = isDashboardScrollable();
    const effectiveDy = Math.max(currentDy, maxDy >= PULL_THRESHOLD + 8 && currentDy >= PULL_THRESHOLD * 0.65 ? maxDy : currentDy);
    const pulledEnough = !isCancel && canPullTop && effectiveDy >= PULL_THRESHOLD;
    if (pulledEnough) {
      suppressNextClick = true;
      recordPullToTopUsed(plugin);
      // 用户完成下拉回顶操作，立即关闭气泡并执行弹簧发射回顶
      hideBubble();
      resetPullVisuals(true, effectiveDy);
    } else if (hintShownDuringHold) {
      // 阶段三关键要求：长按满 3 秒弹出教学气泡后松开鼠标，气泡不得随之消失！
      suppressNextClick = true;
      resetPullVisuals(false, 0);
    } else if (maxDy >= 10) {
      suppressNextClick = true;
      resetPullVisuals(false, 0);
      triggerQBounce();
    } else {
      resetPullVisuals(false, 0);
    }
  };

  const onWindowPointerUp = (e) => {
    if (activePointerId !== null && e && e.pointerId !== undefined && e.pointerId !== activePointerId) {
      return;
    }
    finishPointerInteraction(false);
  };
  const onWindowPointerCancel = (e) => {
    if (activePointerId !== null && e && e.pointerId !== undefined && e.pointerId !== activePointerId) {
      return;
    }
    finishPointerInteraction(true);
  };

  hitZone.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (coord.isPinballFlying2D || coord.runaway2D) return;

    isPointerDown = true;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    if (activePointerId !== null && typeof hitZone.setPointerCapture === "function") {
      try {
        hitZone.setPointerCapture(activePointerId);
      } catch (_) {}
    }
    startY = e.clientY;
    startX = e.clientX;
    currentDy = 0;
    maxDy = 0;
    hintShownDuringHold = false;
    suppressNextClick = false;

    const actor = getActiveActorEl();
    cancelActorAnimations(actor);
    actor.style.transition = "";
    actor.style.transform = "";
    actor.classList.add("roxy-pressing");

    clearPullTimers();

    if (isDashboardScrollable()) {
      // 阶段一：长按满 1 秒未松手，浮现半透明呼吸/流动向下箭头指示器
      hold1sTimer = setTimeout(() => {
        hold1sTimer = null;
        if (!isPointerDown || coord.isPinballFlying2D || coord.runaway2D || !isDashboardScrollable()) return;
        widget.classList.add("is-pull-holding");
      }, 1000);

      // 阶段三：长按满 3 秒仍未拉动触发回顶，且未点击过「不再显示」或尚未熟练掌握时，弹出角色口吻引导气泡
      hold3sTimer = setTimeout(() => {
        hold3sTimer = null;
        if (!isPointerDown || coord.isPinballFlying2D || coord.runaway2D || !isDashboardScrollable()) return;
        if (maxDy >= PULL_THRESHOLD) return;
        if (plugin.settings.roxyPullToTopHintDismissed) return;
        if (plugin.settings.roxySmartGestureHints === false) return;
        const pullMem = ensureGestureMemory(plugin);
        if (
          pullMem.pullUseCount >= 3 &&
          pullMem.lastPullUsedAt > 0 &&
          Date.now() - pullMem.lastPullUsedAt < 30 * 86400000
        ) {
          return;
        }

        hintShownDuringHold = true;
        showRecord({
          type: "roxy:pull_to_top_hint",
          state: "explain",
          badgeText: `✦ ${mascotName} · 回顶术式`,
          stepHint: "操作提示",
          isPullHint: true,
          skipBounce: true,
          autoHideMs: 12000,
          message: "那个……如果您想快速回到档案馆顶部的话，只需按住我向下拖动蓄力再松手，我就会施展风系术式带您一跃回到页首哦。"
        });
      }, 3000);
    }

    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
    window.addEventListener("touchmove", onTouchMoveBlock, { passive: false });
  });

  // 右键立绘可直接还原到「首要事项」
  hitZone.addEventListener("contextmenu", (e) => {
    restoreToPrimary(e);
  });

  // 左键点击立绘：若刚刚完成了长按/下拉交互则抑制单击；若启用了「点击看板娘后才长出底部小横条」，同时展开底栏
  const handleCharacterClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    revealDockTemporarily2D();

    if (coord.isPinballFlying2D) return;
    if (coord.runaway2D) {
      summonRoxyBack2D(e);
      return;
    }

    if (plugin.settings.roxy2DMinimized) {
      plugin.settings.roxy2DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameTagBtn.textContent = getDockModeBtnLabel();
      nameTagBtn.title = getDockModeBtnTitle();
      minBtn.textContent = "最小化";
      restoreToPrimary();
      return;
    }

    // 若当前处于「百连击替身布偶」状态，点击布偶触发软萌棉花反馈
    if (coord.plushieState2D) {
      coord.plushiePokeCount2D = (coord.plushiePokeCount2D || 0) + 1;
      const plushieRecord = Object.assign(
        {},
        buildPlushiePokeReaction(coord.plushiePokeCount2D, coord.plushieState2D),
        { userInitiated: true }
      );
      emitRoxyEvent(plugin, plushieRecord);
      return;
    }

    const now = Date.now();
    const pokeDelta = e && e.shiftKey ? 25 : 1;
    if (now - (coord.lastPokeAt || 0) < 15000) {
      coord.pokeStreak = (coord.pokeStreak || 0) + pokeDelta;
    } else {
      coord.pokeStreak = pokeDelta;
    }
    coord.lastPokeAt = now;

    // 趣味双分支彩蛋：当连戳达到 100 次（连戳 ×100）时：
    // 分支 A（新增）：小跳 -> 复古 2D 像素魔法烟雾 -> 变成纽扣眼/Fumo替身玩偶坠地！
    // 分支 B（经典）：全屏高速弹珠弹射飞出窗外！
    if (coord.pokeStreak >= 100) {
      const usePlushieBranch =
        !coord._hasTriggeredPlushieOnce2D || Math.random() < 0.68;
      if (usePlushieBranch) {
        coord._hasTriggeredPlushieOnce2D = true;
        coord.isPinballFlying2D = true;
        const nextPlushie =
          coord._lastPlushieVariant2D === "plushie01" ? "plushie02" : "plushie01";
        coord._lastPlushieVariant2D = nextPlushie;

        hideBubble();
        if (typeof cancelPinballAnim === "function") {
          cancelPinballAnim();
        }
        cancelPinballAnim = runPlushieTransformEasterEgg(stage, {
          onTransformMidpoint: () => {
            coord.plushieState2D = nextPlushie;
            coord.plushiePokeCount2D = 0;
            widget.dataset.roxyState = nextPlushie;
            applyStageMode(nextPlushie);
          },
          onComplete: () => {
            cancelPinballAnim = null;
            coord.isPinballFlying2D = false;
            coord.pokeStreak = 0;
            revealDockTemporarily2D();
            emitRoxyEvent(plugin, {
              type: `roxy:plushie_transformed_${nextPlushie}`,
              state: nextPlushie,
              badgeText: `✦ ${mascotName} · 替身玩偶术`,
              stepHint: "百连击彩蛋",
              priority: PRIORITY.CRITICAL,
              force: true,
              userInitiated: true,
              autoHideMs: 14000,
              message:
                nextPlushie === "plushie01"
                  ? "噗呼——！面对您整整 100 下的无情连戳，我只好紧急施展『米格路德替身玩偶术』溜走去喝口甜茶啦！桌角这只纽扣眼棉花布偶就留给您慢慢捏吧～"
                  : "噗呼——！居然真的连戳了 100 下！我已经用『蓬松Fumo玩偶替身术』躲进书架后面休息啦，想唤回真身的话随时点下面的按钮哦～"
            });
          }
        });
        return;
      }

      coord.isPinballFlying2D = true;
      coord.currentState = "overpoke";
      widget.dataset.roxyState = "overpoke";
      applyStageMode("overpoke");

      hideBubble();
      widget.classList.remove("is-summon-landing");
      widget.classList.add("is-pinball-rampage");

      if (typeof cancelPinballAnim === "function") {
        cancelPinballAnim();
      }
      cancelPinballAnim = runSoloPinballFlight(stage, {
        bouncesBeforeExit: 4,
        speedPxPerSec: 2550,
        onComplete: () => {
          cancelPinballAnim = null;
          stage.style.transform = "";
          stage.style.opacity = "";
          coord.isPinballFlying2D = false;
          coord.runaway2D = true;
          coord.pokeStreak = 0;
          hideBubble();
          widget.classList.remove("is-pinball-rampage", "is-expanded", "is-minimized");
          widget.classList.add("is-runaway");
          syncTopbarRoxyButton(plugin, container, state, helpers);
        }
      });
      return;
    }

    if (coord.pokeStreak >= 5) {
      const pokeReaction = buildOverPokeReaction(coord.pokeStreak);
      emitRoxyEvent(
        plugin,
        Object.assign({}, pokeReaction, {
          force: true,
          userInitiated: true,
          stepHint: `连戳 ×${coord.pokeStreak}`
        })
      );
      return;
    }

    const deck = buildRoxyConsultationDeck(plugin, state);
    if (deck.length === 0) {
      restoreToPrimary();
      return;
    }

    const idx = coord.deckIndex % deck.length;
    coord.deckIndex = (coord.deckIndex + 1) % deck.length;
    const card = deck[idx];

    emitRoxyEvent(
      plugin,
      Object.assign({}, card, {
        force: true,
        userInitiated: true,
        isPrimary: false,
        stepHint: `咨讯 ${idx + 1}/${deck.length}`,
        autoHideMs: 12000
      })
    );
  };

  hitZone.onclick = handleCharacterClick;

  // 静默值守模式切换（贴上嘴部白色小封条动效 / 刻舟求剑式独立原位飘落解封动效 + 拦截非主动点击气泡）
  let bandageAnimTimer2D = null;
  quietBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (bandageAnimTimer2D) {
      clearTimeout(bandageAnimTimer2D);
      bandageAnimTimer2D = null;
    }
    const nextQuiet = !plugin.settings.roxyQuietMode;
    plugin.settings.roxyQuietMode = nextQuiet;
    syncQuietBtnState();

    if (nextQuiet) {
      sync2DBandagePosition(widget.dataset.roxyState || "explain");
      hideBubble();
      widget.classList.add("is-quiet-mode");
      const isPixelMode = widget.classList.contains("is-pixel-fallback-mode");
      playBandageStickOnAnimation(hdBandageEl, {
        onImpact: !isPixelMode ? () => triggerQBounce() : null
      });
      playBandageStickOnAnimation(chibiBandageEl, {
        onImpact: isPixelMode ? () => triggerQBounce() : null
      });
      if (globalThis.__BangumiManagerNotice) {
        new globalThis.__BangumiManagerNotice(`已开启「静默值守」：平时不再自动弹出气泡，仅在主动点击${mascotName}时说话`);
      }
      await plugin.saveSettings().catch(() => {});
    } else {
      // 在切换立绘神态前，先于当前嘴部世界坐标处生成“刻舟求剑”独立飘落封条
      const isPixelMode = widget.classList.contains("is-pixel-fallback-mode");
      const activeBandage2D = isPixelMode ? chibiBandageEl : hdBandageEl;
      const activeStage2D = isPixelMode ? pixelFallbackHost : hdPortraitHost;
      const scrollEl =
        typeof plugin.getDashboardScrollParent === "function"
          ? plugin.getDashboardScrollParent(container)
          : container.closest(".bangumi-score-dashboard-view") || hostEl;
      spawnDetachedFallingBandage(activeBandage2D, {
        hostEl,
        stageEl: activeStage2D,
        isChibi: isPixelMode,
        anchorEl: container,
        scrollEl,
        paneEl: hostEl.closest(".workspace-leaf-content") || scrollEl || hostEl,
        is3D: false
      });

      widget.classList.remove("is-quiet-mode");
      [hdBandageEl, chibiBandageEl].forEach((el) => {
        if (el._roxyStickCleanup) {
          try {
            el._roxyStickCleanup();
          } catch (_) {}
          el._roxyStickCleanup = null;
        }
        if (el._roxyStickAnim) {
          try {
            el._roxyStickAnim.cancel();
          } catch (_) {}
          el._roxyStickAnim = null;
        }
        el.classList.remove("is-visible", "is-sticking", "is-dropping");
      });
      emitRoxyEvent(plugin, {
        type: "roxy:quiet_unsealed",
        state: "surprised",
        badgeText: `✦ ${mascotName} · 解除封条`,
        stepHint: "恢复播报",
        priority: PRIORITY.HIGH,
        force: true,
        userInitiated: true,
        autoHideMs: 6500,
        message: "噗哈——！嘴上的静音小封条终于揭下来啦，接下来我会继续为您播报馆藏动态的！"
      });
      await plugin.saveSettings().catch(() => {});
    }
  };

  // 底部最左侧按钮：最小化时点击展开；移动端展开态点击即收起；桌面端作为常驻/自动收起切换器
  nameTagBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCurrentlyMinimized()) {
      await setMinimizedState(false);
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameTagBtn.textContent = getDockModeBtnLabel();
      nameTagBtn.title = getDockModeBtnTitle();
      minBtn.textContent = "最小化";
      restoreToPrimary();
      return;
    }
    if (isMobile) {
      await setMinimizedState(true);
      widget.classList.add("is-minimized");
      widget.classList.remove("is-expanded");
      nameTagBtn.textContent = getDockModeBtnLabel();
      nameTagBtn.title = getDockModeBtnTitle();
      minBtn.textContent = "展开";
      hideBubble();
      return;
    }
    const nextAutoCollapse = !plugin.settings.roxyDockExpandOnClickOnly;
    plugin.settings.roxyDockExpandOnClickOnly = nextAutoCollapse;
    await plugin.saveSettings().catch(() => {});
    widget.classList.toggle("is-dock-auto-collapse", nextAutoCollapse);
    if (nextAutoCollapse) {
      widget.classList.add("is-dock-revealed");
      scheduleDockAutoHide2D(4500);
    } else {
      if (dockRevealTimer2D) clearTimeout(dockRevealTimer2D);
      widget.classList.remove("is-dock-revealed");
    }
    nameTagBtn.textContent = getDockModeBtnLabel();
    nameTagBtn.title = getDockModeBtnTitle();
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice(
        nextAutoCollapse
          ? "已切换为「点击看板娘后才长出底部小横条」（4.5秒后自动收起）"
          : "已切换为「常驻显示底部小横条」"
      );
    }
  };

  minBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextMin = !isCurrentlyMinimized();
    await setMinimizedState(nextMin);
    widget.classList.toggle("is-minimized", nextMin);
    widget.classList.toggle("is-expanded", !nextMin);
    nameTagBtn.textContent = getDockModeBtnLabel();
    nameTagBtn.title = getDockModeBtnTitle();
    minBtn.textContent = nextMin ? "展开" : "最小化";
    minBtn.title = nextMin ? "展开立绘视图" : "最小化为右下角轻量名牌";
    if (nextMin) {
      hideBubble();
    }
  };

  hideBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    coord.sessionHidden2D = true;
    hideBubble();
    if (typeof widget._cleanupRoxy === "function") {
      widget._cleanupRoxy();
    }
    widget.remove();
    syncTopbarRoxyButton(plugin, container, state, helpers);
  };

  disableBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.settings.enableRoxy2DMascotMaster = false;
    await plugin.saveSettings();
    hideBubble();
    if (typeof widget._cleanupRoxy === "function") {
      widget._cleanupRoxy();
    }
    widget.remove();
    syncTopbarRoxyButton(plugin, container, state, helpers);
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice("已关闭二维馆藏记录员（可在插件设置中重新开启）");
    }
  };

  let wandHintTimer = null;
  coord.listeners2D.add(showRecord);
  widget._cleanupRoxy = () => {
    coord.listeners2D.delete(showRecord);
    if (typeof cleanupLeafAnchor === "function") {
      cleanupLeafAnchor();
    }
    if (wandHintTimer) {
      clearTimeout(wandHintTimer);
      wandHintTimer = null;
    }
    clearPullTimers();
    if (bandageAnimTimer2D) clearTimeout(bandageAnimTimer2D);
    [hdBandageEl, chibiBandageEl].forEach((el) => {
      if (el && el._roxyStickCleanup) {
        try {
          el._roxyStickCleanup();
        } catch (_) {}
      }
    });
    if (dockRevealTimer2D) clearTimeout(dockRevealTimer2D);
    if (activeScrollRaf) cancelAnimationFrame(activeScrollRaf);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (typeof cancelPinballAnim === "function") {
      cancelPinballAnim();
      cancelPinballAnim = null;
    }
  };

  if (isRunaway) {
    hideBubble();
  } else if (!coord.initialGreetingSent2D) {
    coord.initialGreetingSent2D = true;
    const primary = buildPrimaryDeskRecord(plugin, state);
    emitRoxyEvent(
      plugin,
      Object.assign({}, primary, {
        force: true,
        dedupeKey: "desk:initial_greeting",
        stepHint: "首要",
        autoHideMs: 10000
      })
    );
  } else if (coord.isShowingPrimary) {
    const primary = buildPrimaryDeskRecord(plugin, state);
    showRecord(
      Object.assign({}, primary, {
        stepHint: "首要",
        autoHideMs: 10000
      })
    );
  } else if (coord.history.length > 0 && Date.now() - coord.history[0].ts < 4200) {
    showRecord(coord.history[0]);
  }

  const initialWandHintNeed = evaluateWandGestureHintNeed(plugin, state, coord);
  if (initialWandHintNeed && !isRunaway && !isMinimized) {
    wandHintTimer = setTimeout(() => {
      wandHintTimer = null;
      if (!widget.isConnected || coord.runaway2D || coord.isPinballFlying2D || plugin.settings.roxy2DMinimized) {
        return;
      }
      if (widget.classList.contains("is-pane-hidden") || widget.classList.contains("is-tight-pane")) {
        return;
      }
      if (Date.now() - (coord.lastPokeAt || 0) < 8000) {
        return;
      }
      const needNow = evaluateWandGestureHintNeed(plugin, state, coord);
      if (!needNow) return;
      coord._sessionWandHintShown = true;
      const mem = ensureGestureMemory(plugin);
      mem.wandHintShowCount = (mem.wandHintShowCount || 0) + 1;
      mem.lastWandHintShownAt = Date.now();
      plugin.saveSettings().catch(() => {});
      showRecord(buildWandGestureHintRecord(plugin, needNow));
    }, 11800);
  }

  return widget;
}

/**
 * 顶栏已徹底移除「✦ 记录员」按钮；若用户在当前会话中点击了挂件的「隐藏」，在右下角原位留一枚极轻量的小型唤醒胶囊
 */
function syncTopbarRoxyButton(plugin, container, state, helpers) {
  if (!container) return;
  const actionsCol = container.querySelector(".curator-topbar-actions");
  if (actionsCol) {
    actionsCol.querySelectorAll(".curator-roxy-topbar-toggle").forEach((el) => el.remove());
  }

  const scrollHostEl =
    container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")
      ? container.parentElement
      : container;
  const hostEl = resolveRoxyOverlayMountHost(container) || scrollHostEl;

  [hostEl, scrollHostEl].forEach((scope) => {
    if (!scope) return;
    scope.querySelectorAll(".curator-roxy-wakeup-pill").forEach((el) => {
      if (typeof el._cleanupAnchor === "function") {
        el._cleanupAnchor();
      }
      el.remove();
    });
  });

  const coord = ensureRoxyCoordinator(plugin);
  const modeInfo = normalizeRoxy2DModeSettings(plugin);
  if (!modeInfo.isEnabled) return;

  if (coord && coord.sessionHidden2D) {
    const pill = hostEl.createEl("button", {
      cls: "curator-roxy-wakeup-pill",
      text: "✦ 唤出洛琪希"
    });
    pill.title = "恢复显示本次会话隐藏的洛琪希馆藏记录员";
    pill._cleanupAnchor = bindRoxyLeafBoundsAnchor(pill, hostEl);
    pill.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      coord.sessionHidden2D = false;
      coord.pokeStreak = 0;
      coord.deckIndex = 0;
      plugin.settings.roxy2DMinimized = false;
      await plugin.saveSettings().catch(() => {});
      if (typeof pill._cleanupAnchor === "function") {
        pill._cleanupAnchor();
      }
      pill.remove();
      mountRoxy2DMascot(plugin, container, state, helpers);
      const primary = buildPrimaryDeskRecord(plugin, state);
      emitRoxyEvent(plugin, Object.assign({}, primary, { force: true, userInitiated: true, stepHint: "首要" }));
    };
  }
}

/**
 * 驱动洛琪希立绘本体（不含底部 UI 控制条与气泡）在视口四壁进行连续恒定高速回弹并飞出屏幕外消失
 * - 全程零停顿、零减速，前 bouncesBeforeExit 次触壁瞬时反弹并微幅加速，最后直接冲出屏幕边界
 */
function runSoloPinballFlight(actorStageEl, options = {}) {
  if (!actorStageEl) {
    if (typeof options.onComplete === "function") options.onComplete();
    return () => {};
  }
  const bouncesBeforeExit = Number.isFinite(options.bouncesBeforeExit) ? options.bouncesBeforeExit : 4;
  const baseSpeed = Number.isFinite(options.speedPxPerSec) ? options.speedPxPerSec : 2550;
  const dirX = options.initialDirX || -1;
  const dirY = options.initialDirY || -1;

  const rect = actorStageEl.getBoundingClientRect();
  const width = Math.max(64, rect.width || 146);
  const height = Math.max(72, rect.height || 210);
  const startLeft = rect.left;
  const startTop = rect.top;

  let vx = dirX * baseSpeed * 0.79;
  let vy = dirY * baseSpeed * 0.61;
  let dx = 0;
  let dy = 0;
  let angle = 0;
  let spinRate = dirX < 0 ? -960 : 960;
  let bounces = 0;
  let cancelled = false;
  let rafId = null;
  let impactSquash = { sx: 1, sy: 1, until: 0 };

  const startTime = performance.now();
  let lastTime = startTime;

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (typeof options.onComplete === "function") {
      options.onComplete();
    }
  };

  const step = (now) => {
    if (cancelled) return;
    const dt = Math.min(0.034, Math.max(0.004, (now - lastTime) / 1000));
    lastTime = now;

    const vw = Math.max(480, window.innerWidth || 1280);
    const vh = Math.max(360, window.innerHeight || 780);
    const pad = 10;

    dx += vx * dt;
    dy += vy * dt;

    let curLeft = startLeft + dx;
    let curRight = curLeft + width;
    let curTop = startTop + dy;
    let curBottom = curTop + height;

    if (bounces < bouncesBeforeExit) {
      if (curLeft <= pad && vx < 0) {
        dx = pad - startLeft;
        vx = Math.abs(vx) * 1.045;
        bounces += 1;
        spinRate = -spinRate * 1.05;
        impactSquash = { sx: 0.82, sy: 1.18, until: now + 60 };
      } else if (curRight >= vw - pad && vx > 0) {
        dx = vw - pad - width - startLeft;
        vx = -Math.abs(vx) * 1.045;
        bounces += 1;
        spinRate = -spinRate * 1.05;
        impactSquash = { sx: 0.82, sy: 1.18, until: now + 60 };
      }

      if (curTop <= pad && vy < 0) {
        dy = pad - startTop;
        vy = Math.abs(vy) * 1.045;
        bounces += 1;
        impactSquash = { sx: 1.18, sy: 0.82, until: now + 60 };
      } else if (curBottom >= vh - pad && vy > 0) {
        dy = vh - pad - height - startTop;
        vy = -Math.abs(vy) * 1.045;
        bounces += 1;
        impactSquash = { sx: 1.18, sy: 0.82, until: now + 60 };
      }
    } else {
      // 已完成 4 次高速反弹，不再受屏幕边界阻挡，直接高速冲出视口消失
      const marginOut = Math.max(width, height) + 60;
      if (
        curRight < -marginOut ||
        curLeft > vw + marginOut ||
        curBottom < -marginOut ||
        curTop > vh + marginOut
      ) {
        finish();
        return;
      }
    }

    if (now - startTime > 1650) {
      finish();
      return;
    }

    angle += spinRate * dt;
    const sx = now < impactSquash.until ? impactSquash.sx : 1;
    const sy = now < impactSquash.until ? impactSquash.sy : 1;
    actorStageEl.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${angle.toFixed(1)}deg) scale(${sx}, ${sy})`;

    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}

/**
 * 二维洛琪希馆藏记录员专属样式（单次 Q 弹动效、无循环摇晃、纸本气泡、连戳×100替身布偶与全身弹射、底栏按需生长切换、内置8态Q版像素立绘、嘴部静音小封条）
 */
function getRoxy2DMascotStyles() {
  return [
    /* 单次 Q 弹玩偶动效（底部中心锚定 50% 100%，按下微缩，松手或切换台词时单次 Q 弹回弹，平时静止不晃） */
    "@keyframes roxy-q-bounce{0%{transform:scaleX(1) scaleY(1);}28%{transform:scaleX(1.065) scaleY(0.885);}60%{transform:scaleX(0.96) scaleY(1.048);}82%{transform:scaleX(1.016) scaleY(0.988);}100%{transform:scaleX(1) scaleY(1);}}",
    "@keyframes roxy-bubble-pop{0%{opacity:0;transform:translateY(8px) scale(0.91);}70%{opacity:1;transform:translateY(-2px) scale(1.015);}100%{opacity:1;transform:translateY(0) scale(1);}}",
    "@keyframes roxy-summon-drop{0%{transform:translateY(-64px) scale(0.75);opacity:0;}62%{transform:translateY(6px) scale(1.06,0.92);opacity:1;}84%{transform:translateY(-3px) scale(0.97,1.03);opacity:1;}100%{transform:translateY(0) scale(1);opacity:1;}}",
    /* 嘴部静音白色小封条贴上与揭落动画 */
    "@keyframes roxy-bandage-stick{0%{opacity:0;transform:translate(-50%,-82%) scale(2.42) rotate(calc(var(--roxy-bandage-rot,-2deg) - 20deg));}56%{opacity:1;transform:translate(-50%,-50%) scale(0.82,0.86) rotate(calc(var(--roxy-bandage-rot,-2deg) + 5deg));}78%{opacity:1;transform:translate(-50%,-50%) scale(1.10,0.94) rotate(calc(var(--roxy-bandage-rot,-2deg) - 2deg));}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(var(--roxy-bandage-rot,-2deg));}}",
    "@keyframes roxy-bandage-peel-drop{0%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(var(--roxy-bandage-rot,-2deg));}32%{opacity:1;transform:translate(-34%,-44%) scale(1.05,0.92) rotate(calc(var(--roxy-bandage-rot,-2deg) + 22deg));}100%{opacity:0;transform:translate(-14%,26px) scale(0.78) rotate(calc(var(--roxy-bandage-rot,-2deg) + 52deg));}}",
    ".roxy-clean-fx{filter:drop-shadow(0 8px 20px rgba(32,24,16,0.16));}",
    ".curator-roxy-hd-host.roxy-pressing,.curator-roxy-portrait.roxy-pressing,.curator-roxy-pixel-fallback.roxy-pressing{transform:scaleX(1.055) scaleY(0.89) !important;transition:transform 0.1s ease-out !important;}",
    ".curator-roxy-hd-host.roxy-anim-qbounce,.curator-roxy-portrait.roxy-anim-qbounce,.curator-roxy-pixel-fallback.roxy-anim-qbounce{animation:roxy-q-bounce 0.42s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".curator-roxy-bubble.roxy-bubble-popping{animation:roxy-bubble-pop 0.28s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".curator-roxy-widget.is-summon-landing .curator-roxy-stage{animation:roxy-summon-drop 0.48s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    /* 预留底部滚动呼吸空间：单屏追番页使用紧凑下边距避免无意义留白，长列表页保留 136px 防右下角挂件遮挡 */
    ".curator-desk-root{padding-bottom:136px !important;}",
    ".curator-desk-root[data-active-mode=\"desk\"],.curator-desk-root:has(.curator-unified-workspace[data-active-mode=\"desk\"]){padding-bottom:28px !important;}",
    "@media (max-width: 920px){.curator-desk-root[data-active-mode=\"desk\"],.curator-desk-root:has(.curator-unified-workspace[data-active-mode=\"desk\"]){padding-bottom:112px !important;}}",
    "body.is-mobile .curator-desk-root,body.is-mobile .curator-desk-root[data-active-mode=\"desk\"]{padding-bottom:calc(118px + env(safe-area-inset-bottom, 0px)) !important;}",
    ".curator-roxy-widget.is-mobile-roxy:not(.is-pinball-rampage){right:10px !important;bottom:calc(88px + env(safe-area-inset-bottom, 0px)) !important;transform:none !important;max-width:calc(100vw - 20px) !important;z-index:45;}",
    ".curator-roxy-widget.is-mobile-roxy.is-minimized .curator-roxy-dock-bar{padding:5px 11px !important;border-radius:999px !important;box-shadow:0 6px 18px rgba(28,20,12,0.16) !important;opacity:0.94;}",
    ".curator-roxy-widget.is-mobile-roxy.is-minimized .curator-roxy-ctrl-group{display:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-stage{width:96px !important;height:132px !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded.is-pixel-fallback-mode .curator-roxy-stage{width:96px !important;height:108px !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-hd-host,.curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-portrait{width:96px !important;height:132px !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-pixel-fallback,.curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-chibi-sprite{width:92px !important;height:102px !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded .curator-roxy-hit-zone{top:6px;left:6px;width:84px;height:122px;touch-action:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded.is-pixel-fallback-mode .curator-roxy-hit-zone{top:2px;left:4px;width:88px;height:104px;touch-action:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy .curator-roxy-bubble{max-width:min(280px,calc(100vw - 24px)) !important;padding:9px 12px !important;margin-right:0 !important;background:var(--background-primary) !important;border:1px solid var(--background-modifier-border) !important;box-shadow:0 12px 30px rgba(15,18,24,0.22) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy .curator-roxy-dock-bar{max-width:calc(100vw - 20px) !important;max-height:none !important;flex-wrap:wrap !important;justify-content:flex-end !important;border-radius:14px !important;padding:4px 8px !important;box-sizing:border-box !important;background:var(--background-primary) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy.is-expanded [data-roxy-action=\"minimize\"]{display:none !important;}",
    ".curator-roxy-widget.is-mobile-roxy .curator-roxy-ctrl-group{flex-wrap:wrap !important;justify-content:flex-end !important;gap:3px !important;}",
    "body.is-mobile .curator-roxy-wakeup-pill{right:10px !important;bottom:calc(88px + env(safe-area-inset-bottom, 0px)) !important;}",
    "@media (max-width: 600px){.curator-roxy-widget:not(.is-pinball-rampage):not(.is-mobile-roxy){right:10px !important;bottom:14px !important;transform:none !important;max-width:calc(100vw - 20px) !important;}.curator-roxy-dock-bar{max-width:calc(100vw - 20px) !important;flex-wrap:wrap !important;max-height:none !important;}.curator-roxy-bubble{max-width:min(260px,calc(100vw - 28px)) !important;padding:7px 10px !important;}}",
    /* 右下角轻量记录员容器（动态锚定于当前 Leaf 内容区右下角，绝不越界覆盖右侧边栏） */
    ".curator-roxy-widget{position:fixed;right:20px;bottom:24px;z-index:40;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:0;user-select:none;transform-origin:100% 100%;transition:transform .2s ease,opacity .16s ease;}",
    ".curator-roxy-widget.is-pane-hidden,.curator-roxy-wakeup-pill.is-pane-hidden{opacity:0 !important;visibility:hidden !important;pointer-events:none !important;}",
    ".curator-roxy-widget.is-compact-pane:not(.is-pinball-rampage){transform:scale(0.86);}",
    ".curator-roxy-widget.is-tight-pane:not(.is-pinball-rampage){transform:scale(0.76);}",
    ".curator-roxy-widget.is-pinball-rampage{z-index:999 !important;pointer-events:none !important;}",
    /* 纸本档案风对话气泡 */
    ".curator-roxy-bubble{pointer-events:auto;max-width:var(--roxy-pane-max-bubble-w,268px);padding:9px 12px;margin-right:4px;margin-bottom:6px;border-radius:11px 11px 3px 11px;border:1px solid color-mix(in srgb, #8f683d 44%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 96%, #f6efe3 4%);box-shadow:0 8px 22px rgba(38,28,18,0.13);transform-origin:88% 100%;transition:opacity .18s ease,transform .18s ease;}",
    ".curator-roxy-bubble.is-hidden,.curator-roxy-widget.is-pinball-rampage .curator-roxy-bubble{opacity:0 !important;transform:translateY(8px) scale(0.95) !important;pointer-events:none !important;visibility:hidden !important;}",
    ".curator-roxy-bubble.is-visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;visibility:visible;}",
    ".curator-roxy-bubble-header{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;padding-bottom:3px;border-bottom:1px dashed color-mix(in srgb, var(--background-modifier-border) 65%, transparent);}",
    ".curator-roxy-bubble-meta{display:inline-flex;align-items:center;gap:5px;min-width:0;}",
    ".curator-roxy-bubble-badge{font-size:12px;font-weight:700;letter-spacing:0.02em;color:#8f683d;white-space:nowrap;}",
    ".curator-roxy-bubble-badge.is-success{color:#3a7d5c;}",
    ".curator-roxy-bubble-badge.is-warn,.curator-roxy-bubble-badge.is-panic,.curator-roxy-bubble-badge.is-overpoke{color:#b8543d;}",
    ".curator-roxy-bubble-badge.is-warn2{color:#a86428;}",
    ".curator-roxy-bubble-badge.is-surprised{color:#2b72b9;}",
    ".curator-roxy-bubble-step{font-size:12px;padding:0 6px;border-radius:999px;background:color-mix(in srgb, #8f683d 12%, var(--background-secondary));color:var(--text-muted);font-weight:600;white-space:nowrap;}",
    ".curator-roxy-bubble-ctrls{display:inline-flex;align-items:center;gap:3px;flex-shrink:0;}",
    ".curator-roxy-bubble-restore{cursor:pointer;padding:1px 6px;border-radius:4px;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));background:var(--background-secondary);color:#8f683d;font-size:12px;font-weight:600;line-height:1.3;transition:all .12s ease;}",
    ".curator-roxy-bubble-restore:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-roxy-bubble-restore.is-active-primary{display:none !important;}",
    ".curator-roxy-bubble-close{cursor:pointer;width:17px;height:17px;padding:0;border:none;background:transparent;color:var(--text-faint);font-size:12px;line-height:1;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;}",
    ".curator-roxy-bubble-close:hover{background:var(--background-modifier-hover);color:var(--text-normal);}",
    ".curator-roxy-bubble-text{font-size:12px;line-height:1.48;color:var(--text-normal);word-break:break-word;}",
    /* 高清全身立绘舞台：完整展示 218px 全身与白色长靴，绝不裁切下半身；Q版像素立绘模式高 152px 完整展现精致全身 */
    ".curator-roxy-stage{position:relative;z-index:1;width:146px;height:218px;margin-bottom:0;overflow:visible;clip-path:none;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;transform-origin:50% 50%;will-change:transform;}",
    ".curator-roxy-widget.is-pixel-fallback-mode .curator-roxy-stage{height:152px;margin-bottom:0;align-items:flex-end;overflow:visible;clip-path:none;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-stage{height:218px !important;margin-bottom:0 !important;overflow:visible !important;clip-path:none !important;transition:none !important;}",
    ".curator-roxy-widget.is-minimized .curator-roxy-stage,.curator-roxy-widget.is-runaway .curator-roxy-stage{height:0 !important;margin-bottom:0 !important;opacity:0;pointer-events:none;overflow:hidden !important;clip-path:inset(0) !important;}",
    ".curator-roxy-widget.is-runaway .curator-roxy-bubble{display:none !important;}",
    ".curator-roxy-hd-host{position:relative;width:146px;height:218px;display:flex;align-items:flex-end;justify-content:center;transform-origin:50% 100%;pointer-events:none;will-change:transform;transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);}",
    ".curator-roxy-portrait{width:146px;height:218px;object-fit:contain;object-position:bottom center;transform-origin:50% 100%;pointer-events:none;will-change:transform;}",
    ".curator-roxy-pixel-fallback{position:relative;width:138px;height:148px;display:none;align-items:flex-end;justify-content:center;transform-origin:50% 100%;pointer-events:none;will-change:transform;transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);}",
    ".curator-roxy-chibi-sprite{width:136px;height:146px;object-fit:contain;object-position:bottom center;pointer-events:none;user-select:none;}",
    ".curator-roxy-chibi-offline-badge{display:none;align-items:center;justify-content:center;padding:6px 10px;margin-bottom:8px;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 94%, #f6efe3 6%);color:#8f683d;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(34,24,14,0.12);}",
    ".curator-roxy-pixel-fallback *{pointer-events:none !important;}",
    /* 可爱嘴部静音白色小封条（代码绘制：圆角奶白胶布 + 两端微透气点 + 腮红粉小叉号，严格锚定在动画容器内随 Q 弹与拉动同步形变） */
    ".roxy-mouth-bandage{position:absolute;z-index:5;pointer-events:none !important;display:none;align-items:center;justify-content:center;border-radius:999px;background:linear-gradient(180deg,#fffefb 0%,#f7efe2 100%);border:1px solid rgba(138,98,64,0.68);box-shadow:0 1.5px 4px rgba(36,24,14,0.22),inset 0 0.5px 0 rgba(255,255,255,0.95);transform:translate(-50%,-50%) rotate(var(--roxy-bandage-rot,-4deg));transform-origin:50% 50%;}",
    ".roxy-mouth-bandage::before,.roxy-mouth-bandage::after{content:\"\";position:absolute;top:22%;bottom:22%;width:1.2px;border-radius:1px;background:rgba(158,116,80,0.34);}",
    ".roxy-mouth-bandage::before{left:22%;}",
    ".roxy-mouth-bandage::after{right:22%;}",
    ".roxy-mouth-bandage-cross{display:block;font-size:6.5px;font-weight:900;line-height:1;color:#d2695a;opacity:0.88;transform:scale(0.88);user-select:none;}",
    ".roxy-mouth-bandage.is-3d .roxy-mouth-bandage-cross{font-size:5px;transform:scale(0.78);}",
    ".roxy-mouth-bandage.is-visible{display:inline-flex;}",
    ".roxy-mouth-bandage.is-sticking{animation:roxy-bandage-stick 0.42s cubic-bezier(0.22,1,0.36,1) 1 forwards;}",
    ".roxy-mouth-bandage.is-dropping{animation:roxy-bandage-peel-drop 0.38s cubic-bezier(0.22,1,0.36,1) 1 forwards;}",
    ".roxy-detached-falling-bandage{position:fixed !important;z-index:9999 !important;pointer-events:none !important;box-shadow:0 3px 8px rgba(36,24,14,0.22),inset 0 0.5px 0 rgba(255,255,255,0.95);}",
    ".curator-roxy-hit-zone{position:absolute;top:12px;left:22px;width:102px;height:198px;pointer-events:auto;cursor:pointer;border-radius:40% 40% 16% 16%;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}",
    ".curator-roxy-widget.is-pixel-fallback-mode:not(.is-mobile-roxy) .curator-roxy-hit-zone{top:8px;height:140px;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-hit-zone{pointer-events:none !important;}",
    /* 底部轻量控制名牌：支持常驻显示或「点击看板娘后才长出底部小横条 (.is-dock-auto-collapse)」 */
    ".curator-roxy-dock-bar{position:relative;z-index:2;pointer-events:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;margin-bottom:2px;max-width:480px;max-height:42px;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 96%, #f5ede0 4%);box-shadow:0 4px 12px rgba(34,24,14,0.12);transform-origin:85% 0%;transition:transform 0.24s cubic-bezier(0.34,1.56,0.64,1),opacity 0.18s ease,max-width 0.24s ease,max-height 0.24s ease,padding 0.2s ease;}",
    ".curator-roxy-widget.is-dock-auto-collapse:not(.is-minimized):not(.is-runaway):not(.is-plushie-mode):not(.is-dock-revealed) .curator-roxy-dock-bar{max-width:0 !important;max-height:0 !important;padding:0 !important;margin:0 !important;border-width:0 !important;opacity:0 !important;transform:translateY(-8px) scale(0.82) !important;pointer-events:none !important;overflow:hidden !important;}",
    ".curator-roxy-widget.is-dock-auto-collapse:not(.is-minimized):not(.is-runaway):not(.is-plushie-mode):not(.is-dock-revealed) .curator-roxy-stage{margin-bottom:0;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-dock-bar{transform:translateY(28px) scale(0.9) !important;opacity:0 !important;pointer-events:none !important;}",
    ".curator-roxy-summon-btn,.curator-roxy-unplushie-btn{display:none;cursor:pointer;padding:4px 10px;border:none;border-radius:999px;background:linear-gradient(135deg,#8f683d,#b8543d);color:#fffdf9;font-size:12px;font-weight:700;line-height:1.3;box-shadow:0 4px 12px rgba(184,84,61,0.28);transition:transform .15s ease,filter .15s ease;white-space:nowrap;}",
    ".curator-roxy-summon-btn:hover,.curator-roxy-unplushie-btn:hover{transform:translateY(-1px) scale(1.02);filter:brightness(1.08);}",
    ".curator-roxy-widget.is-runaway .curator-roxy-summon-btn{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-roxy-widget.is-plushie-mode .curator-roxy-unplushie-btn{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-roxy-widget.is-runaway .curator-roxy-name-btn,.curator-roxy-widget.is-runaway .curator-roxy-ctrl-group{display:none !important;}",
    ".curator-roxy-name-btn{cursor:pointer;padding:1px 5px;border:none;background:transparent;font-size:12px;font-weight:700;color:#8f683d;line-height:1.2;white-space:nowrap;}",
    ".curator-roxy-name-btn:hover{text-decoration:underline;}",
    ".curator-roxy-ctrl-group{display:inline-flex;align-items:center;gap:2px;padding-left:4px;border-left:1px solid var(--background-modifier-border);}",
    ".curator-roxy-ctrl-btn{cursor:pointer;padding:1px 5px;border:none;border-radius:4px;background:transparent;font-size:12px;color:var(--text-muted);line-height:1.2;transition:all .12s ease;white-space:nowrap;}",
    ".curator-roxy-ctrl-btn:hover{background:var(--background-modifier-hover);color:#8f683d;}",
    ".curator-roxy-ctrl-btn.is-primary-reset{color:#8f683d;font-weight:600;}",
    ".curator-roxy-ctrl-btn.is-quiet-toggle.is-active{color:#b8543d;font-weight:700;background:color-mix(in srgb, #b8543d 12%, transparent);}",
    ".curator-roxy-ctrl-btn.is-pack-dl{color:#2b72b9;font-weight:600;}",
    ".curator-roxy-ctrl-btn.is-pack-dl:hover{background:color-mix(in srgb, #2b72b9 12%, transparent);color:#1d5a96;}",
    ".curator-roxy-ctrl-btn.is-muted:hover{color:var(--text-error,#c94a4a);}",
    /* 长按回顶教学气泡底栏微弱“不再显示”按钮 */
    ".curator-roxy-bubble-footer{display:flex;justify-content:flex-end;margin-top:6px;padding-top:4px;border-top:1px dashed color-mix(in srgb, var(--background-modifier-border) 48%, transparent);}",
    ".curator-roxy-bubble-footer.is-hidden{display:none !important;}",
    ".curator-roxy-bubble-dismiss-hint{cursor:pointer;padding:1px 6px;border:none;border-radius:4px;background:transparent;font-size:12px;color:var(--text-faint);opacity:0.76;transition:opacity .15s ease,color .15s ease,background .15s ease;}",
    ".curator-roxy-bubble-dismiss-hint:hover{opacity:1;color:#8f683d;background:color-mix(in srgb, #8f683d 10%, transparent);}",
    /* 长按满 1 秒 / 向下拉动蓄力时的呼吸向下箭头与法阵指示器 */
    "@keyframes roxy-pull-chevron-flow{0%{transform:translateY(-2px);opacity:0.45;}50%{transform:translateY(3px);opacity:0.95;}100%{transform:translateY(-2px);opacity:0.45;}}",
    "@keyframes roxy-spring-launch{0%{transform:translateY(4px) scaleX(1.16) scaleY(0.76);}28%{transform:translateY(-48px) scaleX(0.86) scaleY(1.18);}58%{transform:translateY(3px) scaleX(1.12) scaleY(0.88);}78%{transform:translateY(-6px) scaleX(0.96) scaleY(1.04);}100%{transform:translateY(0) scaleX(1) scaleY(1);}}",
    ".curator-roxy-hd-host.roxy-anim-spring-launch,.curator-roxy-portrait.roxy-anim-spring-launch,.curator-roxy-pixel-fallback.roxy-anim-spring-launch{animation:roxy-spring-launch 0.6s cubic-bezier(0.22,1,0.36,1) 1 forwards;}",
    ".curator-roxy-pull-indicator{position:absolute;bottom:14px;left:50%;transform:translateX(-50%) translateY(6px);z-index:4;pointer-events:none;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 92%, #f6efe3 8%);box-shadow:0 4px 12px rgba(34,24,14,0.14);opacity:0;transition:opacity 0.2s ease,transform 0.2s ease,border-color 0.16s ease,background 0.16s ease;}",
    ".curator-roxy-widget.is-pull-holding .curator-roxy-pull-indicator{opacity:0.92;transform:translateX(-50%) translateY(0);}",
    ".curator-roxy-widget.is-pull-ready .curator-roxy-pull-indicator{opacity:1;border-color:#2b72b9;background:color-mix(in srgb, #2b72b9 14%, var(--background-primary));}",
    ".curator-roxy-pull-arrows{display:inline-block;font-size:12px;line-height:1;color:#8f683d;font-weight:700;animation:roxy-pull-chevron-flow 1.1s ease-in-out infinite;}",
    ".curator-roxy-widget.is-pull-ready .curator-roxy-pull-arrows{color:#2b72b9;}",
    ".curator-roxy-pull-label{font-size:12px;font-weight:600;color:#8f683d;letter-spacing:0.02em;white-space:nowrap;}",
    ".curator-roxy-widget.is-pull-ready .curator-roxy-pull-label{color:#2b72b9;font-weight:700;}",
    /* 会话内隐藏时的右下角极轻量唤醒胶囊（不占用顶栏） */
    ".curator-roxy-wakeup-pill{position:fixed;right:24px;bottom:28px;z-index:39;cursor:pointer;padding:4px 11px;border-radius:999px;border:1px dashed color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 94%, #f6efe3 6%);color:#8f683d;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(34,24,14,0.1);opacity:0.82;transition:opacity .16s ease,transform .16s ease,border-color .16s ease;}",
    ".curator-roxy-wakeup-pill:hover{opacity:1;transform:translateY(-2px);border-style:solid;border-color:#8f683d;}"
  ].join("\n");
}

/**
 * 构建三维原画档案室当前最重要的「首要导览提示」（Card 0）
 */
function buildPrimary3DRecord(plugin, space) {
  const items = (space && space.items) || [];
  if (space && (space.spaceState === "detail" || space.spaceState === "entering-detail") && space.detailFolio?.item) {
    const it = space.detailFolio.item;
    if (space.noteSheetState === "open" || space.noteSheetState === "extracting") {
      return {
        type: "primary3d:note_sheet",
        state: "explain",
        badgeText: "✦ 洛琪希 · 首要事项",
        isPrimary: true,
        priority: PRIORITY.NORMAL,
        message: `目前正在为您展阅《${it.name}》的随附笔记纸页。核对完手记后，点击纸页外空白处或按 ESC 就能将纸页收回封套袋中哦。`
      };
    }
    return {
      type: "primary3d:detail",
      state: "explain",
      badgeText: "✦ 洛琪希 · 首要事项",
      isPrimary: true,
      priority: PRIORITY.NORMAL,
      message: `目前正为您抽起《${it.name}》的原画封套。您可以在右侧调整评分与话数，再次点击左侧封套本体还能抽出随附笔记纸页哦。`
    };
  }

  if (space && space.lensMode === "highscore") {
    return {
      type: "primary3d:highscore",
      state: "success",
      badgeText: "✦ 洛琪希 · 首要事项",
      isPrimary: true,
      priority: PRIORITY.NORMAL,
      message: `目前处于「高分精选」四柱策展厅，为您甄选了口碑最出众的馆藏原画。单击任意封套即可将它抽起检阅详情哦。`
    };
  }

  const laneIdx = (space && space.focusLane) || 0;
  const laneName = (space && space.laneNames && space.laneNames[laneIdx]) || "当前轨道";
  const laneList = (space && space.lanes && space.lanes[laneIdx]) || [];

  return {
    type: "primary3d:array",
    state: "explain",
    badgeText: "✦ 洛琪希 · 首要事项",
    isPrimary: true,
    priority: PRIORITY.NORMAL,
    message: `欢迎来到 3D 原画展厅。当前聚焦于「${laneName}」（共 ${laneList.length} 部），全馆 ${items.length} 部原画封套已按真实状态就位，单击任意封套即可抽阅详情哦。`
  };
}

/**
 * 在 3D 原画展厅顶栏同步「✦ 记录员」恢复与开关按钮（零侵入修改）
 */
function sync3DTopbarRoxyButton(plugin, space) {
  if (!space || !space.root) return;
  const coord = ensureRoxyCoordinator(plugin);

  // 统一 3D 原画展厅左上角主标识文案（移动端保持简洁，避免挤压虚拟横屏顶栏）
  const brandEl = space.root.querySelector(".atelier-mark");
  if (brandEl && brandEl.childNodes[0] && brandEl.childNodes[0].nodeType === 3) {
    brandEl.childNodes[0].nodeValue = isMobileEnv() ? "3D 原画展厅" : "3D 原画展厅 · ATELIER CEL";
  }

  const actionsEl = space.root.querySelector(".atelier-actions");
  if (!actionsEl) return;

  let btn = actionsEl.querySelector(".atelier-roxy3d-topbar-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "atelier-btn atelier-roxy3d-topbar-btn";
    btn.dataset.action = "toggle-roxy-3d";
    if (space.exitButton && space.exitButton.parentElement === actionsEl) {
      actionsEl.insertBefore(btn, space.exitButton);
    } else {
      actionsEl.appendChild(btn);
    }
  }

  const isEnabled = plugin.settings.enableRoxy3DMascot !== false;
  const isSessionHidden = Boolean(coord && coord.sessionHidden3D);
  const isRunaway3D = Boolean(coord && coord.runaway3D);

  btn.classList.remove("is-roxy3d-off", "is-roxy3d-summon");
  if (!isEnabled) {
    btn.textContent = "✦ 开启记录员";
    btn.title = "重新启用 3D 原画展厅像素洛琪希记录员";
    btn.classList.add("is-roxy3d-off");
  } else if (isSessionHidden) {
    btn.textContent = "✦ 唤出记录员";
    btn.title = "恢复显示本次会话隐藏的像素洛琪希记录员";
    btn.classList.add("is-roxy3d-off");
  } else if (isRunaway3D) {
    btn.textContent = "✦ 召唤洛琪希";
    btn.title = "像素洛琪希被连戳 100 下弹飞躲起来了，点击将她召唤回原画台角";
    btn.classList.add("is-roxy3d-off", "is-roxy3d-summon");
  } else {
    btn.textContent = "✦ 记录员";
    btn.title = "点击还原洛琪希的首要展厅导览提示（左上角桌角手办框支持点击轮播咨讯、最小化、隐藏或关闭）";
  }

  btn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!plugin.settings.enableRoxy3DMascot) {
      plugin.settings.enableRoxy3DMascot = true;
      plugin.settings.roxy3DMinimized = false;
      if (coord) {
        coord.sessionHidden3D = false;
        coord.runaway3D = false;
        coord.isPinballFlying3D = false;
        coord.pokeStreak3D = 0;
        coord.deckIndex3D = 0;
      }
      await plugin.saveSettings();
      mountRoxy3DMascot(plugin, space);
      emitRoxyEvent(plugin, {
        type: "roxy3d:reenabled",
        state: "success",
        badgeText: "✦ 洛琪希 · 归档就位",
        stepHint: "就位",
        priority: PRIORITY.HIGH,
        force: true,
        userInitiated: true,
        autoHideMs: 5500,
        message: "让您久等了，3D 原画展厅记录员洛琪希已经回到原画分镜台边待命，随时为您登记抽阅动态哦。"
      });
    } else if (coord && coord.runaway3D) {
      const existing = space.ui && space.ui.querySelector(".atelier-roxy3d-widget");
      if (existing && typeof existing._summonRoxyBack3D === "function") {
        existing._summonRoxyBack3D(e);
      } else {
        coord.runaway3D = false;
        coord.isPinballFlying3D = false;
        coord.pokeStreak3D = 0;
        plugin.settings.roxy3DMinimized = false;
        await plugin.saveSettings();
        mountRoxy3DMascot(plugin, space);
        emitRoxyEvent(
          plugin,
          Object.assign({}, buildRoxyRunawayComplaintRecord(coord), { userInitiated: true })
        );
      }
    } else if (coord && coord.sessionHidden3D) {
      coord.sessionHidden3D = false;
      coord.pokeStreak3D = 0;
      coord.deckIndex3D = 0;
      plugin.settings.roxy3DMinimized = false;
      await plugin.saveSettings();
      mountRoxy3DMascot(plugin, space);
      const primary = buildPrimary3DRecord(plugin, space);
      emitRoxyEvent(
        plugin,
        Object.assign({}, primary, { force: true, userInitiated: true, stepHint: "首要", autoHideMs: 6500 })
      );
    } else {
      const existing = space.ui && space.ui.querySelector(".atelier-roxy3d-widget");
      if (!existing) {
        mountRoxy3DMascot(plugin, space);
      }
      if (coord) {
        coord.pokeStreak3D = 0;
        coord.deckIndex3D = 0;
      }
      const primary = buildPrimary3DRecord(plugin, space);
      emitRoxyEvent(
        plugin,
        Object.assign({}, primary, { force: true, userInitiated: true, stepHint: "首要", autoHideMs: 6500 })
      );
    }
  };
}

/**
 * 三维原画档案室 · 特定动画彩蛋台词生成器（无职转生系列 / Re:0 / 素晴 / 芙莉莲 / 迷宫饭 / 异世界同侪作品）
 * 当用户抽出匹配作品的封套时，不再使用死板的系统播报，而是触发符合洛琪希人设且每次轮换变化的专属彩蛋台词
 */
function buildRoxy3DAnimePullEasterEgg(item, coord) {
  if (!item || !item.name) return null;
  const title = String(item.name || "").trim();
  const rawBlob = [
    title,
    item.originalName || "",
    item.seriesName || "",
    Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || ""),
    item.studio || "",
    item.summary || ""
  ]
    .join(" ")
    .toLowerCase();

  const pickRotatingLine = (bucketKey, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) return null;
    if (!coord) return pool[0];
    if (!coord._isekaiEasterEggCursor) {
      coord._isekaiEasterEggCursor = {};
    }
    const cur = coord._isekaiEasterEggCursor[bucketKey] || 0;
    coord._isekaiEasterEggCursor[bucketKey] = (cur + 1) % pool.length;
    return pool[cur % pool.length];
  };

  // 1. 《无职转生》本家与衍生系列
  if (/无职转生|無職転生|mushoku\s*tensei|到了异世界就拿出真本事|鲁迪乌斯|洛琪希·米格路德/.test(rawBlob)) {
    const mushokuPool = [
      {
        state: "surprised",
        badgeText: "✦ 洛琪希 · 本家记忆共鸣",
        stepHint: "专属彩蛋",
        message: `哇……！您抽出了《${title}》的原画封套！看到布耶纳村的麦田和那顶熟悉的巫师帽，总觉得有些害羞呢……当年教鲁迪水圣级魔术『积乱云』的时候，可没想过会被收录进这么隆重的档案室里呀。`
      },
      {
        state: "warn",
        badgeText: "✦ 洛琪希 · 师父的威严",
        stepHint: "专属彩蛋",
        message: `咳咳，这卷是《${title}》呢！先跟您声明一下，封套夹层里只允许存放正经的原画分镜和观片手记，鲁迪偷偷供奉的那件“圣遗物”我是绝对不会允许登记入库的！`
      },
      {
        state: "success",
        badgeText: "✦ 洛琪希 · 迷宫与魔术",
        stepHint: "专属彩蛋",
        message: `是《${title}》呀……每次翻到转移迷宫与魔大陆旅途的篇章，我都会想起篝火旁的魔术咏唱声。无论是第几季、哪一段旅途，只要您想重温，我随时陪您一页页细看哦。`
      },
      {
        state: "explain",
        badgeText: "✦ 洛琪希 · 米格路德手记",
        stepHint: "专属彩蛋",
        message: `《${title}》的原画封套已经为您捧过来啦！说起来，无论未来还会有多少续篇和外传，身为鲁迪的魔术师父，我都会把这些回忆整理得整整齐齐的。`
      }
    ];
    return pickRotatingLine("mushoku", mushokuPool);
  }

  // 2. 《Re:从零开始的异世界生活》系列
  if (/re\s*[:：]?\s*从零开始|re\s*[:：]?\s*zero|从零开始的异世界生活|爱蜜莉雅|雷姆|菜月昴/.test(rawBlob)) {
    const rezeroPool = [
      {
        state: "surprised",
        badgeText: "✦ 洛琪希 · 异界魔术考据",
        stepHint: "异界彩蛋",
        message: `是《${title}》呢！那位菜月昴先生明明没有强大的魔力天赋，却总能在绝境中找出唯一的破局之路……连我这个魔术教师看了都忍不住为他捏一把汗呀。`
      },
      {
        state: "explain",
        badgeText: "✦ 洛琪希 · 精灵术式笔记",
        stepHint: "异界彩蛋",
        message: `为您抽出了《${title}》！爱蜜莉雅小姐与帕克的冰系精灵术式非常纯粹，和我们六面世界的水系魔术比起来，又是另一种美丽的法则呢。`
      },
      {
        state: "warn",
        badgeText: "✦ 洛琪希 · 轮回案卷",
        stepHint: "异界彩蛋",
        message: `这卷《${title}》的剧情转折总是格外扣人心弦……如果您看累了，随时来桌角喝杯热茶缓一缓，不用一个人硬扛那些沉重的章节哦。`
      }
    ];
    return pickRotatingLine("rezero", rezeroPool);
  }

  // 3. 《为美好的世界献上祝福！（素晴 / KonoSuba）》系列
  if (/为美好的世界献上祝福|素晴|konosuba|この素晴らしい世界に祝福を|阿库娅|惠惠|佐藤和真|爆裂魔法/.test(rawBlob)) {
    const konosubaPool = [
      {
        state: "warn",
        badgeText: "✦ 洛琪希 · 同行魔术师吐槽",
        stepHint: "异界彩蛋",
        message: `诶？！是《${title}》！那位叫惠惠的红魔族少女，明明魔力庞大却坚持每天只放一发爆裂魔法就倒下……要是她在我的迷宫探索小队里，我一定会严厉督促她改修实用水系魔术的！`
      },
      {
        state: "surprised",
        badgeText: "✦ 洛琪希 · 水之女神考据",
        stepHint: "异界彩蛋",
        message: `《${title}》抽出来啦！虽说我专精的是水王级魔术，但那位阿库娅小姐把高阶水系神圣术全都用来表演花式宴会才艺，某种意义上也是天才呢……噗呼。`
      },
      {
        state: "success",
        badgeText: "✦ 洛琪希 · 欢笑冒险谭",
        stepHint: "异界彩蛋",
        message: `翻开《${title}》的时候，整个档案室的气氛都会变得轻松起来呢。和真先生他们吵吵闹闹的日常，无论重看多少遍都很解压呀。`
      }
    ];
    return pickRotatingLine("konosuba", konosubaPool);
  }

  // 4. 《葬送的芙莉莲》与《迷宫饭》等奇幻/魔术/迷宫同好作品
  if (/葬送的芙莉莲|芙莉莲|frieren|迷宫饭|ダンジョン飯|delicious\s*in\s*dungeon/.test(rawBlob)) {
    const magicFantasyPool = [
      {
        state: "success",
        badgeText: "✦ 洛琪希 · 魔导与迷宫共鸣",
        stepHint: "同好彩蛋",
        message: `哇，是《${title}》！无论是漫长旅途中收集民间小魔法，还是在迷宫深处认真研究魔物生态，都让我超级有共鸣呢——这一定是一部值得反复细品的杰作！`
      },
      {
        state: "explain",
        badgeText: "✦ 洛琪希 · 冒险者手记",
        stepHint: "同好彩蛋",
        message: `为您取出了《${title}》的原画封套！当初我独自在魔大陆闯荡迷宫时，要是也能有这么详尽的魔物图鉴或悠闲的魔法笔记该多好呀。`
      }
    ];
    return pickRotatingLine("magic_fantasy", magicFantasyPool);
  }

  // 5. 其他异世界系列（转生史莱姆 / Overlord / 盾勇 / 异世界舅舅 / 幼女战记 / 游戏人生 / 灰与幻想 / 通用异世界作品）
  if (
    /异世界|異世界|isekai|转生变成史莱姆|転生したらスライム|利姆露|overlord|不死者之王|骨王|盾之勇者|异世界舅舅|幼女战记|灰与幻想|格林姆迦尔|记录的地平线|游戏人生|no\s*game\s*no\s*life|平凡职业|暗影大人|想要成为影之实力者|无神世界|转生贵族|转生王女/.test(
      rawBlob
    )
  ) {
    const generalIsekaiPool = [
      {
        state: "surprised",
        badgeText: "✦ 洛琪希 · 异界星轨共鸣",
        stepHint: "异界彩蛋",
        message: `呀，是异世界题材的《${title}》呢！每次看到不同世界里的魔素法则、冒险者公会与旅途奇遇，我都会好奇如果拉诺亚魔法大学也开设异界比较学，这本一定会是必读教材吧。`
      },
      {
        state: "success",
        badgeText: "✦ 洛琪希 · 异界冒险录",
        stepHint: "异界彩蛋",
        message: `《${title}》的原画封套已经为您抽起！作为同样在异界大陆跋涉多年的魔术师，我对这种跨越世界的冒险故事最没有抵抗力了，快来看看您的观片记录吧～`
      },
      {
        state: "explain",
        badgeText: "✦ 洛琪希 · 旅人批注",
        stepHint: "异界彩蛋",
        message: `这卷《${title}》描绘的异界风土真是别具一格呢。无论后续还会播出多少季新篇章，我都会在档案室里帮您把每一段异界见闻妥善珍藏好的！`
      }
    ];
    return pickRotatingLine("isekai_general", generalIsekaiPool);
  }

  return null;
}

/**
 * 以非侵入式实例方法包装的方式监听 Dashboard3DSpace 真实事件（不改动 src/dashboard-3d-view.js 任何一行代码）
 */
function hook3DSpaceEvents(plugin, space) {
  if (!space || space._roxy3DHooked) return;
  space._roxy3DHooked = true;

  const coord = ensureRoxyCoordinator(plugin);

  // 1. 监听序幕完成（finishBoot）：当进入 array 态时发送首次档案室首要导览
  const origFinishBoot = space.finishBoot?.bind(space);
  if (origFinishBoot) {
    space.finishBoot = function (...args) {
      const wasDone = this.bootDone;
      const res = origFinishBoot(...args);
      if (!wasDone && this.bootDone) {
        const primary = buildPrimary3DRecord(plugin, this);
        emitRoxyEvent(
          plugin,
          Object.assign({}, primary, {
            force: true,
            dedupeKey: "3d:boot_ready",
            stepHint: "首要",
            autoHideMs: 6500
          })
        );
      }
      return res;
    };
  }

  // 2. 监听档案抽出（enterDetail）与详情态内直接切卡（createDetailFolio）
  const origCreateDetailFolio = space.createDetailFolio?.bind(space);
  if (origCreateDetailFolio) {
    space.createDetailFolio = function (item, sourceCard) {
      const wasInDetail = this.spaceState === "detail" || this.spaceState === "entering-detail";
      const prevName = this.detailFolio?.item?.name || "";
      const res = origCreateDetailFolio(item, sourceCard);
      if (wasInDetail && item && item.name && item.name !== prevName) {
        const easterEgg = buildRoxy3DAnimePullEasterEgg(item, coord);
        if (easterEgg) {
          emitRoxyEvent(plugin, {
            type: "3d:switch_detail_easter_egg",
            state: easterEgg.state || "surprised",
            badgeText: easterEgg.badgeText || "✦ 洛琪希 · 专属彩蛋",
            stepHint: easterEgg.stepHint || "彩蛋",
            priority: PRIORITY.HIGH,
            force: true,
            autoHideMs: 7800,
            message: easterEgg.message
          });
        } else {
          emitRoxyEvent(plugin, {
            type: "3d:switch_detail",
            state: "explain",
            badgeText: "✦ 洛琪希 · 切换案卷",
            stepHint: "抽阅",
            priority: PRIORITY.NORMAL,
            force: true,
            autoHideMs: 5200,
            message: `已为您将《${prevName}》归位，并换抽《${item.name}》的原画封套。`
          });
        }
      }
      return res;
    };
  }

  const origEnterDetail = space.enterDetail?.bind(space);
  if (origEnterDetail) {
    space.enterDetail = function (...args) {
      const wasInDetail = this.spaceState === "detail" || this.spaceState === "entering-detail";
      const res = origEnterDetail(...args);
      if (!wasInDetail && (this.spaceState === "entering-detail" || this.spaceState === "detail") && this.detailFolio?.item) {
        const it = this.detailFolio.item;
        const easterEgg = buildRoxy3DAnimePullEasterEgg(it, coord);
        if (easterEgg) {
          emitRoxyEvent(plugin, {
            type: "3d:enter_detail_easter_egg",
            state: easterEgg.state || "surprised",
            badgeText: easterEgg.badgeText || "✦ 洛琪希 · 专属彩蛋",
            stepHint: easterEgg.stepHint || "彩蛋",
            priority: PRIORITY.HIGH,
            force: true,
            autoHideMs: 7800,
            message: easterEgg.message
          });
        } else {
          const pScore = Number(it.personalScore);
          const bScore = Number(it.bangumiScore ?? it.preciseScore);
          const bestScore = Number.isFinite(pScore) && pScore > 0 ? pScore : Number.isFinite(bScore) && bScore > 0 ? bScore : 0;
          const isHigh = bestScore >= 8.0;
          emitRoxyEvent(plugin, {
            type: "3d:enter_detail",
            state: isHigh ? "success" : "explain",
            badgeText: isHigh ? "✦ 洛琪希 · 佳作拆阅" : "✦ 洛琪希 · 原画拆阅",
            stepHint: "拆阅",
            priority: PRIORITY.NORMAL,
            force: true,
            autoHideMs: 5500,
            message: isHigh
              ? `已为您从轨道抽起《${it.name}》（评分 ${bestScore.toFixed(1)}）的原画封套。再次点击左侧封套本体还能抽出随附笔记纸页哦。`
              : `已为您从轨道抽起《${it.name}》的原画封套。右侧可核对进度与趋势，再次点击左侧封套还能抽出随附笔记纸页哦。`
          });
        }
      }
      return res;
    };
  }

  // 3. 监听档案归位（leaveDetail）
  const origLeaveDetail = space.leaveDetail?.bind(space);
  if (origLeaveDetail) {
    space.leaveDetail = function (...args) {
      const wasInDetail = this.spaceState === "detail" || this.spaceState === "entering-detail";
      const leavingItem = this.detailFolio?.item || this.selectedItem;
      const res = origLeaveDetail(...args);
      if (wasInDetail && this.spaceState === "leaving-detail") {
        emitRoxyEvent(plugin, {
          type: "3d:leave_detail",
          state: "explain",
          badgeText: "✦ 洛琪希 · 归档入槽",
          stepHint: "归位",
          priority: PRIORITY.NORMAL,
          force: true,
          autoHideMs: 4200,
          message: `正在将《${leavingItem?.name || "当前档案"}》的原画封套回正如初，平稳归入原轨道槽位。`
        });
      }
      return res;
    };
  }

  // 4. 监听高分精选切换（toggleLensMode）
  const origToggleLens = space.toggleLensMode?.bind(space);
  if (origToggleLens) {
    space.toggleLensMode = function (...args) {
      const wasTransitioning = Boolean(this.lensTransition);
      const res = origToggleLens(...args);
      if (wasTransitioning) return res;
      const targetMode = this.lensTransition?.targetMode || this.lensMode;
      const isHigh = targetMode === "highscore";
      emitRoxyEvent(plugin, {
        type: "3d:lens_switch",
        state: isHigh ? "success" : "explain",
        badgeText: isHigh ? "✦ 洛琪希 · 高分策展" : "✦ 洛琪希 · 状态轨道",
        stepHint: isHigh ? "策展" : "状态",
        priority: PRIORITY.NORMAL,
        force: true,
        autoHideMs: 5500,
        message: isHigh
          ? "已为您切换至「高分精选」四柱策展视角，这里陈列的都是馆藏中口碑出众的佳作呢。"
          : "已切回「状态与收藏轨」视图，按观看状态与自定义轨道为您如实陈列馆藏。"
      });
      return res;
    };
  }

  // 5. 监听随附笔记纸页抽出与收回（openNoteSheet / onClickActiveFolio / closeNoteSheet）
  const origOpenNoteSheet = space.openNoteSheet?.bind(space);
  if (origOpenNoteSheet) {
    space.openNoteSheet = function (...args) {
      const prev = this.noteSheetState;
      const res = origOpenNoteSheet(...args);
      const it = this.detailFolio?.item || this.selectedItem;
      if (prev !== "extracting" && prev !== "open" && (this.noteSheetState === "extracting" || this.noteSheetState === "open")) {
        emitRoxyEvent(plugin, {
          type: "3d:note_sheet_open",
          state: "surprised",
          badgeText: "✦ 洛琪希 · 手记纸页",
          stepHint: "纸页",
          priority: PRIORITY.NORMAL,
          force: true,
          autoHideMs: 5500,
          message: `已从封套夹层中为您抽出《${it?.name || "当前作品"}》的随附笔记纸页，可以在此浏览作品摘要与个人观后手记。`
        });
      } else if (prev !== "pending" && this.noteSheetState === "pending") {
        emitRoxyEvent(plugin, {
          type: "3d:note_sheet_pending",
          state: "explain",
          badgeText: "✦ 洛琪希 · 预约抽纸",
          stepHint: "预约",
          priority: PRIORITY.NORMAL,
          force: true,
          autoHideMs: 4500,
          message: "已经记下您的抽纸指令啦，等封套升起到位后我就会立刻为您展开随附笔记纸页。"
        });
      }
      return res;
    };
  }

  const origClickActiveFolio = space.onClickActiveFolio?.bind(space);
  if (origClickActiveFolio) {
    space.onClickActiveFolio = function (...args) {
      const res = origClickActiveFolio(...args);
      if (res === "queued-pending-notesheet") {
        emitRoxyEvent(plugin, {
          type: "3d:note_sheet_pending",
          state: "explain",
          badgeText: "✦ 洛琪希 · 预约抽纸",
          stepHint: "预约",
          priority: PRIORITY.NORMAL,
          force: true,
          autoHideMs: 4500,
          message: "已经记下您的抽纸指令啦，等封套升起到位后我就会立刻为您展开随附笔记纸页。"
        });
      }
      return res;
    };
  }

  const origCloseNoteSheet = space.closeNoteSheet?.bind(space);
  if (origCloseNoteSheet) {
    space.closeNoteSheet = function (immediate = false, ...rest) {
      const wasOpen = this.noteSheetState === "open" || this.noteSheetState === "extracting";
      const it = this.detailFolio?.item || this.selectedItem;
      const res = origCloseNoteSheet(immediate, ...rest);
      if (!immediate && wasOpen) {
        emitRoxyEvent(plugin, {
          type: "3d:note_sheet_close",
          state: "explain",
          badgeText: "✦ 洛琪希 · 纸页收回",
          stepHint: "收回",
          priority: PRIORITY.LOW,
          force: true,
          autoHideMs: 4200,
          message: `已将《${it?.name || "当前档案"}》的随附笔记纸页平整收回封套袋中。`
        });
      }
      return res;
    };
  }

  // 6. 监听轨道移动与空轨道检测（move）
  const origMove = space.move?.bind(space);
  if (origMove) {
    space.move = function (laneDelta, rowDelta) {
      const prevLane = this.focusLane;
      const res = origMove(laneDelta, rowDelta);
      if (laneDelta && this.focusLane !== prevLane) {
        const laneList = (this.lanes && this.lanes[this.focusLane]) || [];
        const laneName = (this.laneNames && this.laneNames[this.focusLane]) || `轨道 ${this.focusLane + 1}`;
        if (laneList.length === 0) {
          emitRoxyEvent(plugin, {
            type: "3d:empty_lane",
            state: "blocked",
            badgeText: "✦ 洛琪希 · 空轨提示",
            stepHint: "空轨",
            priority: PRIORITY.NORMAL,
            force: true,
            autoHideMs: 5800,
            message: `当前「${laneName}」还没有收录作品呢，所以我只在这里放了一枚空轨铭牌，绝不会拿其他状态的番剧来冒充的。`
          });
        }
      }
      return res;
    };
  }

  // 7. 监听 3D 检索弹窗无结果（openSearch）
  const origOpenSearch = space.openSearch?.bind(space);
  if (origOpenSearch) {
    space.openSearch = function (...args) {
      const res = origOpenSearch(...args);
      if (this.modal) {
        const searchInput = this.modal.querySelector('input[type="search"]');
        const resultsBox = this.modal.querySelector(".atelier-search-results");
        if (searchInput && resultsBox) {
          let searchTimer = null;
          searchInput.addEventListener("input", () => {
            if (searchTimer) clearTimeout(searchTimer);
            const q = String(searchInput.value || "").trim();
            if (q && resultsBox.children.length === 0) {
              const emptyEl = document.createElement("div");
              emptyEl.className = "atelier-empty";
              emptyEl.textContent = `未找到匹配“${q}”的馆藏原画档案。`;
              resultsBox.appendChild(emptyEl);
              searchTimer = setTimeout(() => {
                emitRoxyEvent(plugin, {
                  type: "3d:search_empty",
                  state: "surprised",
                  badgeText: "✦ 洛琪希 · 检索无果",
                  stepHint: "无结果",
                  priority: PRIORITY.HIGH,
                  force: true,
                  autoHideMs: 5800,
                  message: `在 3D 原画展厅里翻找了一遍，没有找到包含“${q}”的原画档案呢，要不要换个关键词试试？`
                });
              }, 240);
            }
          });
        }
      }
      return res;
    };
  }

  // 8. 监听 3D 空间设置保存（saveSettings）
  const origSaveSettings = space.saveSettings?.bind(space);
  if (origSaveSettings) {
    space.saveSettings = async function (...args) {
      const res = await origSaveSettings(...args);
      emitRoxyEvent(plugin, {
        type: "3d:settings_saved",
        state: "success",
        badgeText: "✦ 洛琪希 · 设置已存",
        stepHint: "已保存",
        priority: PRIORITY.NORMAL,
        force: true,
        autoHideMs: 4800,
        message: "3D 原画展厅的偏好与轨道配置已经为您妥善保存好了。"
      });
      return res;
    };
  }

  // 9. 监听销毁（destroy），确保零监听器与定时器泄漏
  const origDestroy = space.destroy?.bind(space);
  if (origDestroy) {
    space.destroy = function (...args) {
      if (this.ui) {
        this.ui.querySelectorAll(".atelier-roxy3d-widget").forEach((w) => {
          if (typeof w._cleanupRoxy3D === "function") {
            w._cleanupRoxy3D();
          }
          w.remove();
        });
      }
      if (coord) {
        coord.listeners3D.clear();
      }
      return origDestroy(...args);
    };
  }
}

/**
 * 注入三维像素洛琪希手办框专属样式
 */
function injectRoxy3DScopedStyles() {
  if (typeof document === "undefined") return;
  let styleEl = document.getElementById("bangumi-roxy-3d-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "bangumi-roxy-3d-style";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = getRoxy3DMascotStyles();
}

/**
 * 在三维“三维原画档案室”挂载像素洛琪希桌角手办框（默认使用精校 8 态 Q 版像素立绘，支持替身布偶与底栏按需生长切换）
 */
function mountRoxy3DMascot(plugin, space) {
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord || !space || !space.ui || !space.root) return null;

  injectRoxy3DScopedStyles();
  hook3DSpaceEvents(plugin, space);

  space.ui.querySelectorAll(".atelier-roxy3d-widget").forEach((existing) => {
    if (typeof existing._cleanupRoxy3D === "function") {
      existing._cleanupRoxy3D();
    }
    existing.remove();
  });

  const isEnabled = plugin.settings.enableRoxy3DMascot !== false;
  const isSessionHidden = Boolean(coord.sessionHidden3D);
  const isMobile3D = isMobileEnv();
  const isMinimized = isMobile3D
    ? coord.mobile3DExpanded !== true
    : Boolean(plugin.settings.roxy3DMinimized);
  const isRunaway3D = Boolean(coord.runaway3D);
  const isPlushie3D = Boolean(coord.plushieState3D);
  const isDockAutoCollapse = Boolean(plugin.settings.roxyDockExpandOnClickOnly);
  const isQuietMode3D = Boolean(plugin.settings.roxyQuietMode);
  const mascotName = getMascotDisplayName(plugin);

  sync3DTopbarRoxyButton(plugin, space);

  if (!isEnabled || isSessionHidden) {
    return null;
  }

  const widget = document.createElement("div");
  widget.className = `atelier-roxy3d-widget ${
    isRunaway3D ? "is-runaway" : isMinimized ? "is-minimized" : "is-expanded"
  }${isMobile3D ? " is-mobile-roxy3d" : ""}${isPlushie3D ? " is-plushie-mode" : ""}${isDockAutoCollapse ? " is-dock-auto-collapse" : ""}${
    isQuietMode3D ? " is-quiet-mode" : ""
  }`;
  widget.dataset.ui = "roxy-3d-mascot";
  widget.dataset.roxyState = coord.plushieState3D || coord.currentState || "explain";
  space.ui.appendChild(widget);

  // 1. 上排：左侧桌角原画手办座架 + 右侧紧邻的横向原画编目签气泡
  const mainRow = document.createElement("div");
  mainRow.className = "atelier-roxy3d-main-row";
  widget.appendChild(mainRow);

  const figureFrame = document.createElement("div");
  figureFrame.className = "atelier-roxy3d-figure-frame";
  mainRow.appendChild(figureFrame);

  // 四角黄铜铆钉装饰（呼应三维原画封套 Cel Folio 装帧语言）
  ["tl", "tr", "bl", "br"].forEach((pos) => {
    const pin = document.createElement("span");
    pin.className = `atelier-roxy3d-pin is-${pos}`;
    figureFrame.appendChild(pin);
  });

  const avatarHost = document.createElement("div");
  avatarHost.className = "atelier-roxy3d-avatar-host";
  figureFrame.appendChild(avatarHost);

  const chibiImg3D = document.createElement("img");
  chibiImg3D.className = "atelier-roxy3d-chibi-sprite";
  chibiImg3D.draggable = false;
  avatarHost.appendChild(chibiImg3D);

  const offlineBadge3D = document.createElement("div");
  offlineBadge3D.className = "curator-roxy-chibi-offline-badge";
  offlineBadge3D.textContent = `✦ ${mascotName}`;
  offlineBadge3D.style.display = "none";
  avatarHost.appendChild(offlineBadge3D);

  const bandage3DEl = document.createElement("div");
  bandage3DEl.className = `roxy-mouth-bandage is-3d${isQuietMode3D ? " is-visible" : ""}`;
  const bandage3DCross = document.createElement("span");
  bandage3DCross.className = "roxy-mouth-bandage-cross";
  bandage3DCross.textContent = "×";
  bandage3DEl.appendChild(bandage3DCross);
  avatarHost.appendChild(bandage3DEl);

  const subPlaque = document.createElement("div");
  subPlaque.className = "atelier-roxy3d-subplaque";
  subPlaque.textContent = isPlushie3D ? "ROXY · PLUSH" : "ROXY · CHIBI";
  figureFrame.appendChild(subPlaque);

  const apply3DAvatarPose = (poseState) => {
    const activePose = coord.plushieState3D || poseState || coord.currentState || "explain";
    subPlaque.textContent = coord.plushieState3D ? "ROXY · PLUSH" : "ROXY · CHIBI";
    applyMouthBandageGeometry(bandage3DEl, "chibi3d", activePose);

    if (!coord.plushieState3D) {
      const customUrl = resolveCustomPortraitOverride(plugin, activePose);
      if (customUrl) {
        chibiImg3D.style.display = "block";
        offlineBadge3D.style.display = "none";
        if (chibiImg3D.getAttribute("src") !== customUrl) {
          chibiImg3D.src = customUrl;
        }
        return;
      }
    }

    const chibiFile =
      ROXY_CHIBI_SPRITE_FILES[activePose] || ROXY_CHIBI_SPRITE_FILES.explain;
    const localUrl =
      (coord.resolvedChibiUrls && coord.resolvedChibiUrls[chibiFile]) ||
      resolveRoxyChibiAssetUrl(plugin, chibiFile);
    const targetUrl = localUrl || getRoxyChibiCdnFallbackUrl(chibiFile);
    chibiImg3D.dataset.chibiFile = chibiFile;
    chibiImg3D.dataset.chibiFallbackStage = localUrl ? "local" : "cdn";
    chibiImg3D.style.display = "block";
    offlineBadge3D.style.display = "none";
    if (chibiImg3D.getAttribute("src") !== targetUrl) {
      chibiImg3D.src = targetUrl;
    }
    if (!localUrl) {
      ensureRoxyChibiSpritesCached(plugin, chibiFile);
    }
  };

  chibiImg3D.onerror = () => {
    const chibiFile = chibiImg3D.dataset.chibiFile || ROXY_CHIBI_SPRITE_FILES.explain;
    if (chibiImg3D.dataset.chibiFallbackStage === "local") {
      if (!coord.missingChibiFiles) coord.missingChibiFiles = new Set();
      coord.missingChibiFiles.add(chibiFile);
      chibiImg3D.dataset.chibiFallbackStage = "cdn";
      chibiImg3D.src = getRoxyChibiCdnFallbackUrl(chibiFile);
      ensureRoxyChibiSpritesCached(plugin, chibiFile);
      return;
    }
    chibiImg3D.style.display = "none";
    offlineBadge3D.style.display = "inline-flex";
  };

  widget._refreshRoxyStageMode = () => {
    apply3DAvatarPose(coord.plushieState3D || widget.dataset.roxyState || coord.currentState || "explain");
  };

  apply3DAvatarPose(coord.plushieState3D || coord.currentState || "explain");

  const hitZone = document.createElement("div");
  hitZone.className = "atelier-roxy3d-hit-zone";
  hitZone.title = `点击${mascotName}轮播番剧咨讯（连续点击有软气抗议反应，右键或点「↺ 首要」还原首要导览）`;
  figureFrame.appendChild(hitZone);

  // 2. 下排：底部紧凑控制铭牌（支持按需点击展开底栏 + 百连击替身玩偶/弹飞召唤）
  const dockBar = document.createElement("div");
  dockBar.className = "atelier-roxy3d-dock";
  widget.appendChild(dockBar);

  const summonBtn3D = document.createElement("button");
  summonBtn3D.className = "atelier-roxy3d-summon-btn";
  summonBtn3D.dataset.roxy3dAction = "summon-runaway-3d";
  summonBtn3D.textContent = `✦ ${mascotName}被戳飞逃跑了 · 点击召唤回来`;
  summonBtn3D.title = `把被连戳 100 下弹飞出去的${mascotName}重新召唤回原画台角`;
  dockBar.appendChild(summonBtn3D);

  const unplushieBtn3D = document.createElement("button");
  unplushieBtn3D.className = "atelier-roxy3d-unplushie-btn";
  unplushieBtn3D.dataset.roxy3dAction = "summon-plushie-3d";
  unplushieBtn3D.textContent = `✦ 解除玩偶 · 唤回${mascotName}`;
  unplushieBtn3D.title = `解除米格路德替身玩偶术，把${mascotName}真身唤回原画台角`;
  dockBar.appendChild(unplushieBtn3D);

  const isCurrently3DMinimized = () =>
    isMobile3D ? coord.mobile3DExpanded !== true : Boolean(plugin.settings.roxy3DMinimized);
  const get3DDockModeLabel = () => {
    if (isCurrently3DMinimized()) {
      return isMobile3D ? `✦ ${mascotName}` : `✦ ${mascotName} [展开]`;
    }
    return plugin.settings.roxyDockExpandOnClickOnly ? "固定底栏" : "点立绘展栏";
  };
  const get3DDockModeTitle = () => {
    if (isCurrently3DMinimized()) {
      return `展开${mascotName}手办框`;
    }
    return plugin.settings.roxyDockExpandOnClickOnly
      ? "当前：点击看板娘后才长出底部小横条 · 点击切换为常驻显示底栏"
      : "当前：常驻显示底部小横条 · 点击切换为仅在点击看板娘后才长出底栏";
  };

  const nameBtn = document.createElement("button");
  nameBtn.className = "atelier-roxy3d-name-btn";
  nameBtn.dataset.roxy3dAction = "name-trigger";
  nameBtn.textContent = get3DDockModeLabel();
  nameBtn.title = get3DDockModeTitle();
  dockBar.appendChild(nameBtn);

  let dockRevealTimer3D = null;
  let isDockHovered3D = false;
  const scheduleDockAutoHide3D = (delayMs = 7000) => {
    if (dockRevealTimer3D) clearTimeout(dockRevealTimer3D);
    if (!plugin.settings.roxyDockExpandOnClickOnly || plugin.settings.roxy3DMinimized || coord.runaway3D) {
      return;
    }
    dockRevealTimer3D = setTimeout(() => {
      if (isDockHovered3D) {
        scheduleDockAutoHide3D(3500);
        return;
      }
      widget.classList.remove("is-dock-revealed");
    }, delayMs);
  };
  const revealDockTemporarily3D = () => {
    if (!plugin.settings.roxyDockExpandOnClickOnly) return;
    widget.classList.add("is-dock-revealed");
    scheduleDockAutoHide3D(7000);
  };
  dockBar.addEventListener("pointerenter", () => {
    isDockHovered3D = true;
    if (dockRevealTimer3D) clearTimeout(dockRevealTimer3D);
  });
  dockBar.addEventListener("pointerleave", () => {
    isDockHovered3D = false;
    if (plugin.settings.roxyDockExpandOnClickOnly) {
      scheduleDockAutoHide3D(3200);
    }
  });

  const ctrlGroup = document.createElement("div");
  ctrlGroup.className = "atelier-roxy3d-ctrl-group";
  dockBar.appendChild(ctrlGroup);

  const dockPrimaryBtn = document.createElement("button");
  dockPrimaryBtn.className = "atelier-roxy3d-ctrl-btn is-primary-reset";
  dockPrimaryBtn.dataset.roxy3dAction = "dock-restore-primary";
  dockPrimaryBtn.textContent = "首要";
  dockPrimaryBtn.title = "还原为 3D 原画展厅首要导览提示";
  ctrlGroup.appendChild(dockPrimaryBtn);

  const quietBtn3D = document.createElement("button");
  quietBtn3D.className = `atelier-roxy3d-ctrl-btn is-quiet-toggle${isQuietMode3D ? " is-active" : ""}`;
  quietBtn3D.dataset.roxy3dAction = "toggle-quiet-mode-3d";
  const sync3DQuietBtnState = () => {
    const active = Boolean(plugin.settings.roxyQuietMode);
    quietBtn3D.classList.toggle("is-active", active);
    quietBtn3D.textContent = active ? "解封" : "静默";
    quietBtn3D.title = active
      ? `当前处于「静默值守」模式（抽阅封套等操作时不主动说话，仅在点击${mascotName}时说话）· 点击揭下静音小封条恢复正常说话`
      : `开启「静默值守」模式：为${mascotName}贴上静音小封条，抽阅三维封套等操作时不再弹出气泡，仅在主动点击她时说话`;
  };
  sync3DQuietBtnState();
  ctrlGroup.appendChild(quietBtn3D);

  const minBtn = document.createElement("button");
  minBtn.className = "atelier-roxy3d-ctrl-btn";
  minBtn.dataset.roxy3dAction = "minimize";
  minBtn.textContent = isMinimized ? "展开" : "最小化";
  minBtn.title = isMinimized ? "展开手办框" : "最小化为紧凑铭牌";
  ctrlGroup.appendChild(minBtn);

  const hideBtn = document.createElement("button");
  hideBtn.className = "atelier-roxy3d-ctrl-btn";
  hideBtn.dataset.roxy3dAction = "hide-session";
  hideBtn.textContent = "隐藏";
  hideBtn.title = "本次会话暂时隐藏（可从顶栏「✦ 记录员」随时唤出）";
  ctrlGroup.appendChild(hideBtn);

  const disableBtn = document.createElement("button");
  disableBtn.className = "atelier-roxy3d-ctrl-btn is-muted";
  disableBtn.dataset.roxy3dAction = "disable-3d";
  disableBtn.textContent = "关闭";
  disableBtn.title = "永久关闭三维记录员（可在插件设置或顶栏重新开启）";
  ctrlGroup.appendChild(disableBtn);

  // 右侧：紧邻手办框的横向原画编目签气泡（默认几秒后自动收起，绝不常驻遮挡画面）
  const bubble = document.createElement("div");
  bubble.className = "atelier-roxy3d-bubble is-hidden";
  mainRow.appendChild(bubble);

  const bubbleHeader = document.createElement("div");
  bubbleHeader.className = "atelier-roxy3d-bubble-header";
  bubble.appendChild(bubbleHeader);

  const bubbleMeta = document.createElement("div");
  bubbleMeta.className = "atelier-roxy3d-bubble-meta";
  bubbleHeader.appendChild(bubbleMeta);

  const bubbleBadge = document.createElement("span");
  bubbleBadge.className = "atelier-roxy3d-bubble-badge";
  bubbleBadge.textContent = `✦ ${mascotName} · 档案室导览`;
  bubbleMeta.appendChild(bubbleBadge);

  const bubbleStep = document.createElement("span");
  bubbleStep.className = "atelier-roxy3d-bubble-step";
  bubbleStep.textContent = "";
  bubbleMeta.appendChild(bubbleStep);

  const bubbleCtrls = document.createElement("div");
  bubbleCtrls.className = "atelier-roxy3d-bubble-ctrls";
  bubbleHeader.appendChild(bubbleCtrls);

  const restorePrimaryBtn = document.createElement("button");
  restorePrimaryBtn.className = "atelier-roxy3d-bubble-restore";
  restorePrimaryBtn.dataset.roxy3dAction = "restore-primary";
  restorePrimaryBtn.textContent = "↺ 首要";
  restorePrimaryBtn.title = "将气泡内容还原为 3D 原画展厅首要导览提示";
  bubbleCtrls.appendChild(restorePrimaryBtn);

  const bubbleCloseBtn = document.createElement("button");
  bubbleCloseBtn.className = "atelier-roxy3d-bubble-close";
  bubbleCloseBtn.dataset.roxy3dAction = "close-bubble";
  bubbleCloseBtn.textContent = "×";
  bubbleCloseBtn.title = "收起提示气泡";
  bubbleCtrls.appendChild(bubbleCloseBtn);

  const bubbleText = document.createElement("div");
  bubbleText.className = "atelier-roxy3d-bubble-text";
  bubble.appendChild(bubbleText);

  // 阻断指针事件向底层 3D 画布冒泡，确保点击洛琪希挂件绝不误触 3D 封套或触发归位
  [hitZone, dockBar, bubble].forEach((el) => {
    ["pointerdown", "pointerup", "click"].forEach((evtName) => {
      el.addEventListener(evtName, (ev) => {
        ev.stopPropagation();
      });
    });
  });

  let bubbleTimer3D = null;
  let cancelPinballAnim3D = null;

  const trigger3DQBounce = () => {
    if (space.settings && space.settings.reducedMotion) return;
    avatarHost.classList.remove("roxy3d-pressing", "roxy3d-anim-qbounce");
    void avatarHost.offsetWidth;
    avatarHost.classList.add("roxy3d-anim-qbounce");
  };

  const trigger3DBubblePop = () => {
    if (space.settings && space.settings.reducedMotion) return;
    bubble.classList.remove("roxy3d-bubble-popping");
    void bubble.offsetWidth;
    bubble.classList.add("roxy3d-bubble-popping");
  };

  const hide3DBubble = () => {
    if (bubbleTimer3D) {
      clearTimeout(bubbleTimer3D);
      bubbleTimer3D = null;
    }
    bubble.classList.remove("is-visible", "roxy3d-bubble-popping");
    bubble.classList.add("is-hidden");
  };

  const show3DRecord = (record) => {
    if (!record || coord.runaway3D || coord.isPinballFlying3D) return;
    if (isMobile3D && isCurrently3DMinimized() && !record.userInitiated) {
      return;
    }
    if (plugin.settings && plugin.settings.roxyQuietMode && !record.userInitiated) {
      return;
    }
    const nextState =
      ROXY_PORTRAIT_FILES[record.state] || ROXY_CHIBI_SPRITE_FILES[record.state]
        ? record.state
        : "explain";
    widget.dataset.roxyState = coord.plushieState3D || nextState;

    apply3DAvatarPose(coord.plushieState3D || nextState);

    trigger3DQBounce();

    if (record.message) {
      bubbleBadge.textContent =
        record.badgeText || `✦ ${mascotName} · ${STATE_LABELS[nextState] || "记录"}`;
      bubbleBadge.className = `atelier-roxy3d-bubble-badge is-${nextState}`;
      bubbleStep.textContent = record.stepHint || (record.isPrimary ? "首要" : "");
      bubbleStep.style.display = bubbleStep.textContent ? "inline-flex" : "none";
      restorePrimaryBtn.classList.toggle("is-active-primary", Boolean(record.isPrimary));

      bubbleText.textContent = record.message;
      bubble.classList.remove("is-hidden");
      bubble.classList.add("is-visible");
      trigger3DBubblePop();

      if (bubbleTimer3D) clearTimeout(bubbleTimer3D);
      const hideMs = record.autoHideMs ?? 5500;
      if (hideMs > 0) {
        bubbleTimer3D = setTimeout(() => {
          hide3DBubble();
        }, hideMs);
      }
    }
  };

  const summonRoxyBack3D = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (typeof cancelPinballAnim3D === "function") {
      cancelPinballAnim3D();
      cancelPinballAnim3D = null;
    }
    const wasPlushie = Boolean(coord.plushieState3D);
    figureFrame.style.transform = "";
    coord.runaway3D = false;
    coord.isPinballFlying3D = false;
    coord.plushieState3D = null;
    coord.plushiePokeCount3D = 0;
    coord.pokeStreak3D = 0;
    if (plugin.settings.roxy3DMinimized) {
      plugin.settings.roxy3DMinimized = false;
      plugin.saveSettings().catch(() => {});
    }
    widget.classList.remove("is-runaway", "is-minimized", "is-pinball-rampage-3d", "is-plushie-mode");
    widget.classList.add("is-expanded");
    nameBtn.textContent = get3DDockModeLabel();
    nameBtn.title = get3DDockModeTitle();
    minBtn.textContent = "最小化";
    apply3DAvatarPose("warn");
    sync3DTopbarRoxyButton(plugin, space);
    emitRoxyEvent(
      plugin,
      Object.assign({}, buildRoxyRunawayComplaintRecord(coord, wasPlushie), { userInitiated: true })
    );
  };

  summonBtn3D.onclick = summonRoxyBack3D;
  unplushieBtn3D.onclick = summonRoxyBack3D;
  widget._summonRoxyBack3D = summonRoxyBack3D;

  const restoreTo3DPrimary = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (coord.runaway3D || coord.plushieState3D) {
      summonRoxyBack3D(e);
      return;
    }
    if (plugin.settings.roxy3DMinimized) {
      plugin.settings.roxy3DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameBtn.textContent = get3DDockModeLabel();
      nameBtn.title = get3DDockModeTitle();
      minBtn.textContent = "最小化";
    }
    coord.pokeStreak3D = 0;
    coord.deckIndex3D = 0;
    coord.isShowingPrimary3D = true;
    const primary = buildPrimary3DRecord(plugin, space);
    emitRoxyEvent(
      plugin,
      Object.assign({}, primary, {
        force: true,
        userInitiated: true,
        isPrimary: true,
        stepHint: "首要",
        autoHideMs: 6500
      })
    );
  };

  restorePrimaryBtn.onclick = restoreTo3DPrimary;
  dockPrimaryBtn.onclick = restoreTo3DPrimary;

  bubbleCloseBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide3DBubble();
  };

  hitZone.addEventListener("pointerdown", () => {
    if (coord.isPinballFlying3D || coord.runaway3D) return;
    if (space.settings && space.settings.reducedMotion) return;
    avatarHost.classList.remove("roxy3d-anim-qbounce");
    avatarHost.classList.add("roxy3d-pressing");
  });
  const clear3DPressing = () => {
    avatarHost.classList.remove("roxy3d-pressing");
  };
  hitZone.addEventListener("pointerup", clear3DPressing);
  hitZone.addEventListener("pointerleave", clear3DPressing);
  hitZone.addEventListener("pointercancel", clear3DPressing);

  hitZone.addEventListener("contextmenu", (e) => {
    restoreTo3DPrimary(e);
  });

  const handle3DCharacterClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    revealDockTemporarily3D();

    if (coord.isPinballFlying3D) return;
    if (coord.runaway3D) {
      summonRoxyBack3D(e);
      return;
    }

    if (plugin.settings.roxy3DMinimized) {
      plugin.settings.roxy3DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameBtn.textContent = get3DDockModeLabel();
      nameBtn.title = get3DDockModeTitle();
      minBtn.textContent = "最小化";
      restoreTo3DPrimary();
      return;
    }

    if (coord.plushieState3D) {
      coord.plushiePokeCount3D = (coord.plushiePokeCount3D || 0) + 1;
      emitRoxyEvent(
        plugin,
        Object.assign({}, buildPlushiePokeReaction(coord.plushiePokeCount3D, coord.plushieState3D), {
          userInitiated: true
        })
      );
      return;
    }

    const now = Date.now();
    const pokeDelta = e && e.shiftKey ? 25 : 1;
    if (now - (coord.lastPokeAt3D || 0) < 15000) {
      coord.pokeStreak3D = (coord.pokeStreak3D || 0) + pokeDelta;
    } else {
      coord.pokeStreak3D = pokeDelta;
    }
    coord.lastPokeAt3D = now;

    if (coord.pokeStreak3D >= 100) {
      const usePlushieBranch =
        !coord._hasTriggeredPlushieOnce3D || Math.random() < 0.68;
      if (usePlushieBranch) {
        coord._hasTriggeredPlushieOnce3D = true;
        coord.isPinballFlying3D = true;
        const nextPlushie =
          coord._lastPlushieVariant3D === "plushie01" ? "plushie02" : "plushie01";
        coord._lastPlushieVariant3D = nextPlushie;

        hide3DBubble();
        if (typeof cancelPinballAnim3D === "function") {
          cancelPinballAnim3D();
        }
        cancelPinballAnim3D = runPlushieTransformEasterEgg(figureFrame, {
          onTransformMidpoint: () => {
            coord.plushieState3D = nextPlushie;
            coord.plushiePokeCount3D = 0;
            widget.classList.add("is-plushie-mode");
            widget.dataset.roxyState = nextPlushie;
            apply3DAvatarPose(nextPlushie);
          },
          onComplete: () => {
            cancelPinballAnim3D = null;
            coord.isPinballFlying3D = false;
            coord.pokeStreak3D = 0;
            revealDockTemporarily3D();
            emitRoxyEvent(plugin, {
              type: `roxy3d:plushie_transformed_${nextPlushie}`,
              state: nextPlushie,
              badgeText: `✦ ${mascotName} · 替身玩偶术`,
              stepHint: "百连击彩蛋",
              priority: PRIORITY.CRITICAL,
              force: true,
              userInitiated: true,
              autoHideMs: 12000,
              message:
                nextPlushie === "plushie01"
                  ? "噗呼——！被您连戳满 100 下啦，我只好施展『米格路德替身玩偶术』躲去原画架后面休息会儿，手办框里这只纽扣眼布偶先陪您值班哦～"
                  : "噗呼——！百连击达成！我已经切换成『蓬松Fumo布偶替身』啦，随时点下方按钮就能唤回我真身哦～"
            });
          }
        });
        return;
      }

      coord.isPinballFlying3D = true;
      coord.currentState = "overpoke";
      widget.dataset.roxyState = "overpoke";
      apply3DAvatarPose("overpoke");
      hide3DBubble();
      widget.classList.add("is-pinball-rampage-3d");

      if (typeof cancelPinballAnim3D === "function") {
        cancelPinballAnim3D();
      }
      cancelPinballAnim3D = runSoloPinballFlight(figureFrame, {
        bouncesBeforeExit: 4,
        speedPxPerSec: 2550,
        initialDirX: 1,
        initialDirY: 1,
        onComplete: () => {
          cancelPinballAnim3D = null;
          figureFrame.style.transform = "";
          coord.isPinballFlying3D = false;
          coord.runaway3D = true;
          coord.pokeStreak3D = 0;
          hide3DBubble();
          widget.classList.remove("is-pinball-rampage-3d", "is-expanded", "is-minimized");
          widget.classList.add("is-runaway");
          sync3DTopbarRoxyButton(plugin, space);
        }
      });
      return;
    }

    if (coord.pokeStreak3D >= 5) {
      const pokeReaction = buildOverPokeReaction(coord.pokeStreak3D);
      emitRoxyEvent(
        plugin,
        Object.assign({}, pokeReaction, {
          force: true,
          userInitiated: true,
          stepHint: `连戳 ×${coord.pokeStreak3D}`,
          autoHideMs: 7500
        })
      );
      return;
    }

    const deck = buildRoxyConsultationDeck(plugin, { items: space.items || [] });
    if (deck.length === 0) {
      restoreTo3DPrimary();
      return;
    }

    const idx = (coord.deckIndex3D || 0) % deck.length;
    coord.deckIndex3D = (idx + 1) % deck.length;
    const card = deck[idx];

    emitRoxyEvent(
      plugin,
      Object.assign({}, card, {
        force: true,
        userInitiated: true,
        isPrimary: false,
        stepHint: `咨讯 ${idx + 1}/${deck.length}`,
        autoHideMs: 7500
      })
    );
  };

  hitZone.onclick = handle3DCharacterClick;

  // 三维静默值守模式切换（贴上嘴部白色小封条动效 / 独立原位飘落解封动效 + 拦截抽阅封套等非主动点击气泡）
  let bandageAnimTimer3D = null;
  quietBtn3D.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (bandageAnimTimer3D) {
      clearTimeout(bandageAnimTimer3D);
      bandageAnimTimer3D = null;
    }
    const nextQuiet = !plugin.settings.roxyQuietMode;
    plugin.settings.roxyQuietMode = nextQuiet;
    sync3DQuietBtnState();

    if (nextQuiet) {
      applyMouthBandageGeometry(bandage3DEl, "chibi3d", widget.dataset.roxyState || "explain");
      hide3DBubble();
      widget.classList.add("is-quiet-mode");
      playBandageStickOnAnimation(bandage3DEl, {
        onImpact: () => trigger3DQBounce()
      });
      if (globalThis.__BangumiManagerNotice) {
        new globalThis.__BangumiManagerNotice(`已开启「静默值守」：抽阅原画封套等操作时不再弹出气泡，仅在主动点击${mascotName}时说话`);
      }
      await plugin.saveSettings().catch(() => {});
    } else {
      spawnDetachedFallingBandage(bandage3DEl, {
        hostEl: (space && (space.ui || space.root)) || document.body,
        stageEl: avatarHost,
        isChibi: true,
        anchorEl: (space && (space.ui || space.root)) || null,
        paneEl: (space && space.root) || null,
        is3D: true
      });
      widget.classList.remove("is-quiet-mode");
      if (bandage3DEl._roxyStickCleanup) {
        try {
          bandage3DEl._roxyStickCleanup();
        } catch (_) {}
        bandage3DEl._roxyStickCleanup = null;
      }
      if (bandage3DEl._roxyStickAnim) {
        try {
          bandage3DEl._roxyStickAnim.cancel();
        } catch (_) {}
        bandage3DEl._roxyStickAnim = null;
      }
      bandage3DEl.classList.remove("is-visible", "is-sticking", "is-dropping");
      emitRoxyEvent(plugin, {
        type: "roxy3d:quiet_unsealed",
        state: "surprised",
        badgeText: `✦ ${mascotName} · 解除封条`,
        stepHint: "恢复播报",
        priority: PRIORITY.HIGH,
        force: true,
        userInitiated: true,
        autoHideMs: 6500,
        message: "噗哈——！嘴上的静音小封条揭下来啦，接下来在 3D 原画展厅里我会继续为您播报动态的！"
      });
      await plugin.saveSettings().catch(() => {});
    }
  };

  nameBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCurrently3DMinimized()) {
      if (isMobile3D) {
        coord.mobile3DExpanded = true;
      } else {
        plugin.settings.roxy3DMinimized = false;
        await plugin.saveSettings().catch(() => {});
      }
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameBtn.textContent = get3DDockModeLabel();
      nameBtn.title = get3DDockModeTitle();
      minBtn.textContent = "最小化";
      restoreTo3DPrimary();
      return;
    }
    const nextAutoCollapse = !plugin.settings.roxyDockExpandOnClickOnly;
    plugin.settings.roxyDockExpandOnClickOnly = nextAutoCollapse;
    await plugin.saveSettings().catch(() => {});
    widget.classList.toggle("is-dock-auto-collapse", nextAutoCollapse);
    if (nextAutoCollapse) {
      widget.classList.add("is-dock-revealed");
      scheduleDockAutoHide3D(4500);
    } else {
      if (dockRevealTimer3D) clearTimeout(dockRevealTimer3D);
      widget.classList.remove("is-dock-revealed");
    }
    nameBtn.textContent = get3DDockModeLabel();
    nameBtn.title = get3DDockModeTitle();
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice(
        nextAutoCollapse
          ? "已切换为「点击看板娘后才长出底部小横条」（4.5秒后自动收起）"
          : "已切换为「常驻显示底部小横条」"
      );
    }
  };

  minBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextMin = !isCurrently3DMinimized();
    if (isMobile3D) {
      coord.mobile3DExpanded = !nextMin;
    } else {
      plugin.settings.roxy3DMinimized = nextMin;
      await plugin.saveSettings();
    }
    widget.classList.toggle("is-minimized", nextMin);
    widget.classList.toggle("is-expanded", !nextMin);
    nameBtn.textContent = get3DDockModeLabel();
    nameBtn.title = get3DDockModeTitle();
    minBtn.textContent = nextMin ? "展开" : "最小化";
    minBtn.title = nextMin ? "展开手办框" : "最小化为紧凑铭牌";
    if (nextMin) {
      hide3DBubble();
    }
  };

  hideBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    coord.sessionHidden3D = true;
    hide3DBubble();
    widget.remove();
    sync3DTopbarRoxyButton(plugin, space);
  };

  disableBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.settings.enableRoxy3DMascot = false;
    await plugin.saveSettings();
    hide3DBubble();
    widget.remove();
    sync3DTopbarRoxyButton(plugin, space);
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice("已关闭三维馆藏记录员（可在插件设置或三维顶栏重新开启）");
    }
  };

  coord.listeners3D.add(show3DRecord);
  widget._cleanupRoxy3D = () => {
    coord.listeners3D.delete(show3DRecord);
    if (bandageAnimTimer3D) clearTimeout(bandageAnimTimer3D);
    if (bandage3DEl && bandage3DEl._roxyStickCleanup) {
      try {
        bandage3DEl._roxyStickCleanup();
      } catch (_) {}
    }
    if (dockRevealTimer3D) clearTimeout(dockRevealTimer3D);
    if (bubbleTimer3D) clearTimeout(bubbleTimer3D);
    if (typeof cancelPinballAnim3D === "function") {
      cancelPinballAnim3D();
      cancelPinballAnim3D = null;
    }
  };

  // 若序幕已结束（如 bootMode === "none" 或重新开启记录员），立即展示首要导览
  if (isRunaway3D || (isMobile3D && isMinimized)) {
    hide3DBubble();
  } else if (space.spaceState !== "boot" && !plugin.settings.roxyQuietMode) {
    const primary = buildPrimary3DRecord(plugin, space);
    show3DRecord(
      Object.assign({}, primary, {
        stepHint: "首要",
        autoHideMs: 6500
      })
    );
  }

  return widget;
}

/**
 * 三维原画档案室 · 像素洛琪希桌角手办框样式（边缘低打扰、非交互区 pointer-events: none、单次 Q 弹、连戳×100替身玩偶与乱弹彩蛋、嘴部静音小封条）
 */
function getRoxy3DMascotStyles() {
  return [
    "@keyframes roxy3d-q-bounce{0%{transform:scaleX(1) scaleY(1);}28%{transform:scaleX(1.075) scaleY(0.875);}60%{transform:scaleX(0.955) scaleY(1.052);}82%{transform:scaleX(1.018) scaleY(0.986);}100%{transform:scaleX(1) scaleY(1);}}",
    "@keyframes roxy3d-bubble-pop{0%{opacity:0;transform:translateX(-6px) scale(0.93);}70%{opacity:1;transform:translateX(2px) scale(1.012);}100%{opacity:1;transform:translateX(0) scale(1);}}",
    "@keyframes roxy-bandage-stick{0%{opacity:0;transform:translate(-50%,-82%) scale(2.42) rotate(calc(var(--roxy-bandage-rot,-2deg) - 20deg));}56%{opacity:1;transform:translate(-50%,-50%) scale(0.82,0.86) rotate(calc(var(--roxy-bandage-rot,-2deg) + 5deg));}78%{opacity:1;transform:translate(-50%,-50%) scale(1.10,0.94) rotate(calc(var(--roxy-bandage-rot,-2deg) - 2deg));}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(var(--roxy-bandage-rot,-2deg));}}",
    "@keyframes roxy-bandage-peel-drop{0%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(var(--roxy-bandage-rot,-2deg));}32%{opacity:1;transform:translate(-34%,-44%) scale(1.05,0.92) rotate(calc(var(--roxy-bandage-rot,-2deg) + 22deg));}100%{opacity:0;transform:translate(-14%,26px) scale(0.78) rotate(calc(var(--roxy-bandage-rot,-2deg) + 52deg));}}",
    ".roxy-mouth-bandage{position:absolute;z-index:5;pointer-events:none !important;display:none;align-items:center;justify-content:center;border-radius:999px;background:linear-gradient(180deg,#fffefb 0%,#f7efe2 100%);border:1px solid rgba(138,98,64,0.68);box-shadow:0 1.5px 4px rgba(36,24,14,0.22),inset 0 0.5px 0 rgba(255,255,255,0.95);transform:translate(-50%,-50%) rotate(var(--roxy-bandage-rot,-4deg));transform-origin:50% 50%;}",
    ".roxy-mouth-bandage::before,.roxy-mouth-bandage::after{content:\"\";position:absolute;top:22%;bottom:22%;width:1.2px;border-radius:1px;background:rgba(158,116,80,0.34);}",
    ".roxy-mouth-bandage::before{left:22%;}",
    ".roxy-mouth-bandage::after{right:22%;}",
    ".roxy-mouth-bandage-cross{display:block;font-size:6.5px;font-weight:900;line-height:1;color:#d2695a;opacity:0.88;transform:scale(0.88);user-select:none;}",
    ".roxy-mouth-bandage.is-3d .roxy-mouth-bandage-cross{font-size:5px;transform:scale(0.78);}",
    ".roxy-mouth-bandage.is-visible{display:inline-flex;}",
    ".roxy-mouth-bandage.is-sticking{animation:roxy-bandage-stick 0.42s cubic-bezier(0.22,1,0.36,1) 1 forwards;}",
    ".roxy-mouth-bandage.is-dropping{animation:roxy-bandage-peel-drop 0.38s cubic-bezier(0.22,1,0.36,1) 1 forwards;}",
    ".roxy-detached-falling-bandage{position:fixed !important;z-index:9999 !important;pointer-events:none !important;box-shadow:0 3px 8px rgba(36,24,14,0.22),inset 0 0.5px 0 rgba(255,255,255,0.95);}",
    /* 左上角原画桌角位置，绝不进入封套核心画布中心，绝不遮挡详情栏、笔记纸页、底栏或 Hover 提示 */
    ".atelier-roxy3d-widget{position:absolute;left:clamp(24px,4vw,64px);top:clamp(78px,9.4vh,104px);z-index:32;pointer-events:none!important;display:flex;flex-direction:column;align-items:flex-start;gap:5px;user-select:none;transition:top .28s cubic-bezier(.16,1,.3,1),opacity .28s ease;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d{pointer-events:none!important;z-index:999!important;}",
    /* 高分精选模式下自动下移让出 .atelier-curation-banner 横幅空间 */
    ".bangumi-3d-root[data-lens-mode=\"highscore\"][data-space-state=\"array\"] .atelier-roxy3d-widget{top:clamp(118px,14vh,146px);}",
    /* 序幕动画期间隐藏，随主 UI 一同显现 */
    ".bangumi-3d-root[data-space-state=\"boot\"] .atelier-roxy3d-widget{opacity:0;pointer-events:none!important;}",
    ".atelier-roxy3d-main-row{display:flex;align-items:flex-start;gap:10px;pointer-events:none!important;}",
    /* 原画纸本手办小座框 */
    ".atelier-roxy3d-figure-frame{position:relative;width:72px;height:82px;border-radius:6px;border:1px solid rgba(155,114,71,0.48);background:linear-gradient(180deg,rgba(250,246,238,0.95) 0%,rgba(237,230,217,0.95) 100%);box-shadow:0 8px 20px rgba(24,26,22,0.09),inset 0 1px 0 rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;pointer-events:none!important;transform-origin:50% 50%;will-change:transform;}",
    ".atelier-roxy3d-widget.is-minimized .atelier-roxy3d-figure-frame,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-figure-frame,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-bubble,.atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-bubble{display:none!important;}",
    ".atelier-roxy3d-pin{position:absolute;width:3.5px;height:3.5px;border-radius:50%;background:#9b7247;opacity:0.75;pointer-events:none!important;}",
    ".atelier-roxy3d-pin.is-tl{top:4px;left:4px;}.atelier-roxy3d-pin.is-tr{top:4px;right:4px;}.atelier-roxy3d-pin.is-bl{bottom:13px;left:4px;}.atelier-roxy3d-pin.is-br{bottom:13px;right:4px;}",
    ".atelier-roxy3d-avatar-host{position:relative;width:66px;height:70px;margin-top:-8px;display:flex;align-items:center;justify-content:center;transform-origin:50% 100%;pointer-events:none!important;will-change:transform;transition:transform .16s cubic-bezier(0.34,1.56,0.64,1);}",
    ".atelier-roxy3d-chibi-sprite{width:64px;height:68px;object-fit:contain;object-position:bottom center;pointer-events:none!important;user-select:none;}",
    ".atelier-roxy3d-avatar-host *{pointer-events:none!important;}",
    ".atelier-roxy3d-avatar-host.roxy3d-pressing{transform:scaleX(1.07) scaleY(0.88)!important;transition:transform .09s ease-out!important;}",
    ".atelier-roxy3d-avatar-host.roxy3d-anim-qbounce{animation:roxy3d-q-bounce 0.42s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".atelier-roxy3d-subplaque{position:absolute;left:0;right:0;bottom:0;height:12px;background:rgba(155,114,71,0.14);border-top:1px solid rgba(155,114,71,0.3);font-size:7.5px;font-weight:700;letter-spacing:0.08em;color:#7a5835;display:flex;align-items:center;justify-content:center;pointer-events:none!important;}",
    ".atelier-roxy3d-hit-zone{position:absolute;inset:0;border-radius:6px;pointer-events:auto!important;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-hit-zone{pointer-events:none!important;}",
    /* 底部紧凑控制条（支持按需点击看板娘后生长，弹飞时向下收起隐藏） */
    ".atelier-roxy3d-dock{pointer-events:auto!important;display:inline-flex;align-items:center;gap:3px;padding:2px 6px;max-width:450px;max-height:36px;border-radius:4px;border:1px solid rgba(155,114,71,0.42);background:rgba(246,242,234,0.96);box-shadow:0 4px 12px rgba(24,26,22,0.08);transform-origin:15% 0%;transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),opacity 0.16s ease,max-width 0.22s ease,max-height 0.22s ease,padding 0.18s ease;}",
    ".atelier-roxy3d-widget.is-dock-auto-collapse:not(.is-minimized):not(.is-runaway):not(.is-plushie-mode):not(.is-dock-revealed) .atelier-roxy3d-dock{max-width:0!important;max-height:0!important;padding:0!important;margin:0!important;border-width:0!important;opacity:0!important;transform:translateY(-6px) scale(0.85)!important;pointer-events:none!important;overflow:hidden!important;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-dock{transform:translateY(20px) scale(0.9)!important;opacity:0!important;pointer-events:none!important;}",
    ".bangumi-3d-root button.atelier-roxy3d-summon-btn,.bangumi-3d-root button.atelier-roxy3d-unplushie-btn{display:none;cursor:pointer;padding:3px 9px;border:none;border-radius:4px;background:linear-gradient(135deg,#8f683d,#b8543d);color:#fffdf9;font-size:10.5px;font-weight:700;line-height:1.3;white-space:nowrap;}",
    ".atelier-roxy3d-widget.is-runaway button.atelier-roxy3d-summon-btn{display:inline-flex!important;align-items:center;gap:4px;}",
    ".atelier-roxy3d-widget.is-plushie-mode button.atelier-roxy3d-unplushie-btn{display:inline-flex!important;align-items:center;gap:4px;}",
    ".atelier-roxy3d-widget.is-runaway button.atelier-roxy3d-name-btn,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-ctrl-group{display:none!important;}",
    ".bangumi-3d-root button.atelier-roxy3d-name-btn{cursor:pointer;padding:1px 4px;border:none;background:transparent;font-size:10px;font-weight:700;color:#8f683d;line-height:1.2;white-space:nowrap;}",
    ".bangumi-3d-root button.atelier-roxy3d-name-btn:hover{text-decoration:underline;}",
    ".atelier-roxy3d-ctrl-group{display:inline-flex;align-items:center;gap:2px;padding-left:3px;border-left:1px solid rgba(198,190,178,0.7);}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn{cursor:pointer;padding:1px 4px;border:none;border-radius:3px;background:transparent;font-size:10px;color:#6e685e;line-height:1.2;transition:all .12s ease;white-space:nowrap;}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn:hover{background:rgba(155,114,71,0.12);color:#8f683d;}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn.is-primary-reset{color:#8f683d;font-weight:600;}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn.is-quiet-toggle.is-active{color:#b44c36;font-weight:700;background:rgba(180,76,54,0.12);}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn.is-muted:hover{color:#b84a39;}",
    /* 横向原画纸签气泡 */
    ".atelier-roxy3d-bubble{pointer-events:auto!important;max-width:258px;padding:8px 11px;border-radius:4px 8px 8px 8px;border:1px solid rgba(155,114,71,0.46);border-left:3px solid var(--cel-accent,#9b7247);background:rgba(250,246,238,0.96);backdrop-filter:blur(8px);box-shadow:0 10px 26px rgba(24,26,22,0.11);transform-origin:0% 24%;transition:opacity .18s ease,transform .18s ease;}",
    ".bangumi-3d-root[data-note-sheet=\"open\"] .atelier-roxy3d-bubble{max-width:254px;}",
    ".atelier-roxy3d-bubble.is-hidden{opacity:0;transform:translateX(-6px) scale(0.95);pointer-events:none!important;visibility:hidden;}",
    ".atelier-roxy3d-bubble.is-visible{opacity:1;transform:translateX(0) scale(1);pointer-events:auto!important;visibility:visible;}",
    ".atelier-roxy3d-bubble.roxy3d-bubble-popping{animation:roxy3d-bubble-pop 0.26s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".atelier-roxy3d-bubble-header{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;padding-bottom:3px;border-bottom:1px dashed rgba(155,114,71,0.32);}",
    ".atelier-roxy3d-bubble-meta{display:inline-flex;align-items:center;gap:5px;min-width:0;}",
    ".atelier-roxy3d-bubble-badge{font-size:10.5px;font-weight:700;letter-spacing:0.03em;color:#8f683d;white-space:nowrap;}",
    ".atelier-roxy3d-bubble-badge.is-success{color:#357253;}",
    ".atelier-roxy3d-bubble-badge.is-warn,.atelier-roxy3d-bubble-badge.is-panic,.atelier-roxy3d-bubble-badge.is-overpoke{color:#b44c36;}",
    ".atelier-roxy3d-bubble-badge.is-warn2{color:#a25d22;}",
    ".atelier-roxy3d-bubble-badge.is-surprised{color:#296aa8;}",
    ".atelier-roxy3d-bubble-step{font-size:9.5px;padding:0 5px;border-radius:999px;background:rgba(155,114,71,0.14);color:#6e685e;font-weight:600;white-space:nowrap;}",
    ".atelier-roxy3d-bubble-ctrls{display:inline-flex;align-items:center;gap:3px;flex-shrink:0;}",
    ".bangumi-3d-root button.atelier-roxy3d-bubble-restore{cursor:pointer;padding:1px 5px;border-radius:3px;border:1px solid rgba(155,114,71,0.4);background:rgba(255,252,245,0.85);color:#8f683d;font-size:9.5px;font-weight:600;line-height:1.3;transition:all .12s ease;}",
    ".bangumi-3d-root button.atelier-roxy3d-bubble-restore:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".bangumi-3d-root button.atelier-roxy3d-bubble-restore.is-active-primary{display:none!important;}",
    ".bangumi-3d-root button.atelier-roxy3d-bubble-close{cursor:pointer;width:16px;height:16px;padding:0;border:none;background:transparent;color:#716b61;font-size:12px;line-height:1;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;}",
    ".bangumi-3d-root button.atelier-roxy3d-bubble-close:hover{background:rgba(24,26,22,0.08);color:#181a16;}",
    ".atelier-roxy3d-bubble-text{font-size:11.8px;line-height:1.46;color:#181a16;word-break:break-word;}",
    ".bangumi-3d-root button.atelier-roxy3d-topbar-btn.is-roxy3d-off{border-bottom:1px dashed #8f683d;color:#8f683d;}",
    ".bangumi-3d-root button.atelier-roxy3d-topbar-btn.is-roxy3d-summon{border-bottom:1px solid #b44c36;color:#b44c36;font-weight:700;}",
    "@media (max-width: 680px){",
    "  .atelier-roxy3d-widget{left:12px!important;top:102px!important;bottom:auto!important;transform:scale(0.8);transform-origin:0% 0%;}",
    "  .bangumi-3d-root[data-space-state=\"entering-detail\"] .atelier-roxy3d-bubble,.bangumi-3d-root[data-space-state=\"detail\"] .atelier-roxy3d-bubble{display:none!important;}",
    "  .atelier-roxy3d-bubble{max-width:206px!important;padding:6px 9px!important;}",
    "}",
    ".atelier-roxy3d-widget.is-mobile-roxy3d.is-minimized .atelier-roxy3d-ctrl-group{display:none!important;}",
    ".atelier-roxy3d-widget.is-mobile-roxy3d.is-minimized .atelier-roxy3d-dock{padding:3px 9px;border-radius:999px;background:rgba(250,246,238,0.92);}",
    ".bangumi-3d-root.is-virtual-landscape .atelier-roxy3d-widget{left:max(34px,env(safe-area-inset-top))!important;top:50px!important;transform:scale(0.86)!important;transform-origin:0% 0%!important;}",
    ".bangumi-3d-root.is-virtual-landscape[data-lens-mode=\"highscore\"][data-space-state=\"array\"] .atelier-roxy3d-widget{top:86px!important;}",
    ".bangumi-3d-root.is-mobile-portrait .atelier-roxy3d-widget{left:12px!important;top:calc(max(34px,env(safe-area-inset-top)) + 84px)!important;transform:scale(0.85)!important;transform-origin:0% 0%!important;}"
  ].join("\n");
}

module.exports = {
  PRIORITY,
  ROXY_PORTRAIT_FILES,
  ROXY_CHIBI_SPRITE_FILES,
  STATE_LABELS,
  resolveRoxyAssetUrl,
  resolveRoxyChibiAssetUrl,
  checkRoxyHdPortraitsStatus,
  normalizeRoxy2DModeSettings,
  downloadRoxyHdPortraitPack,
  ensureRoxyCoordinator,
  ensureGestureMemory,
  recordWandRelationUsed,
  recordPullToTopUsed,
  resetRoxyGestureMemory,
  emitRoxyEvent,
  buildPrimaryDeskRecord,
  buildPrimary3DRecord,
  buildRoxy3DAnimePullEasterEgg,
  applyMouthBandageGeometry,
  buildRoxyConsultationDeck,
  mountRoxy2DMascot,
  syncTopbarRoxyButton,
  getRoxy2DMascotStyles,
  mountRoxy3DMascot,
  sync3DTopbarRoxyButton,
  getRoxy3DMascotStyles
};
