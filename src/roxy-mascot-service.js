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

const ROXY_PORTRAIT_FILES = {
  idle: "roxy_explain.png",
  explain: "roxy_explain.png",
  surprised: "roxy_surprised.png",
  blocked: "roxy_blocked.png",
  warn: "roxy_warn.png",
  warn2: "roxy_warn2.png",
  success: "roxy_success.png",
  panic: "roxy_panic.png"
};

const STATE_LABELS = {
  idle: "导览",
  explain: "导览",
  success: "欣慰",
  surprised: "发现",
  blocked: "无奈",
  warn2: "叮嘱",
  warn: "抗议",
  panic: "慌张"
};

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
  const baseDir =
    plugin && plugin.manifest && plugin.manifest.dir
      ? plugin.manifest.dir.replace(/\\/g, "/").replace(/\/$/, "")
      : ".obsidian/plugins/bangumi-manager";
  const relDir = `${baseDir}/assets/roxy`;
  let absDir = "";
  try {
    const path = require("path");
    const vaultBase =
      plugin &&
      plugin.app &&
      plugin.app.vault &&
      plugin.app.vault.adapter &&
      typeof plugin.app.vault.adapter.getBasePath === "function"
        ? plugin.app.vault.adapter.getBasePath()
        : "";
    if (vaultBase) {
      absDir = path.join(vaultBase, baseDir, "assets", "roxy");
    }
  } catch (err) {
    // ignore
  }
  return { baseDir, relDir, absDir };
}

/**
 * 检测本地是否已安装 7 张洛琪希高清半身立绘扩展包（适配 BRAT 仅下载 main.js + manifest.json 的场景）
 */
function checkRoxyHdPortraitsStatus(plugin) {
  const uniqueFiles = Array.from(new Set(Object.values(ROXY_PORTRAIT_FILES)));
  const { relDir, absDir } = getRoxyAssetDirs(plugin);
  const missingFiles = [];

  try {
    const fs = require("fs");
    const path = require("path");
    if (absDir) {
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

  return {
    installed: missingFiles.length === 0,
    existingCount: uniqueFiles.length - missingFiles.length,
    totalCount: uniqueFiles.length,
    missingFiles,
    relDir,
    absDir
  };
}

/**
 * 一键独立下载洛琪希 7 张高清半身立绘扩展包到本地插件目录（无需压缩包，适配 BRAT 用户按需获取）
 * 依次尝试：GitHub Release 附件直链 -> jsDelivr CDN -> GitHub Raw
 */
async function downloadRoxyHdPortraitPack(plugin, onProgress) {
  const { requestUrl } = require("obsidian");
  const fs = require("fs");
  const path = require("path");
  const uniqueFiles = Array.from(new Set(Object.values(ROXY_PORTRAIT_FILES)));
  const { relDir, absDir } = getRoxyAssetDirs(plugin);

  if (absDir && !fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }

  const REPO_SLUG = "Curelove/bangumi-manager";
  let downloadedCount = 0;
  const failedFiles = [];

  for (let i = 0; i < uniqueFiles.length; i++) {
    const fileName = uniqueFiles[i];
    if (typeof onProgress === "function") {
      onProgress({ current: i + 1, total: uniqueFiles.length, fileName });
    }

    const candidateUrls = [
      `https://github.com/${REPO_SLUG}/releases/latest/download/${encodeURIComponent(fileName)}`,
      `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/assets/roxy/${encodeURIComponent(fileName)}`,
      `https://raw.githubusercontent.com/${REPO_SLUG}/main/assets/roxy/${encodeURIComponent(fileName)}`
    ];

    let fileBuffer = null;
    for (const url of candidateUrls) {
      try {
        const res = await requestUrl({ url, method: "GET", throw: true });
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
        if (absDir) {
          fs.writeFileSync(path.join(absDir, fileName), Buffer.from(fileBuffer));
        } else if (plugin?.app?.vault?.adapter?.writeBinary) {
          await plugin.app.vault.adapter.writeBinary(`${relDir}/${fileName}`, fileBuffer);
        }
        downloadedCount++;
      } catch (writeErr) {
        failedFiles.push(fileName);
      }
    } else {
      failedFiles.push(fileName);
    }
  }

  const coord = ensureRoxyCoordinator(plugin);
  const status = checkRoxyHdPortraitsStatus(plugin);
  if (coord) {
    coord.hdPortraitsAvailable = status.installed;
    coord.preloaded = false;
    preloadAllRoxyPortraits(plugin, coord);
  }

  return {
    ok: status.installed,
    downloadedCount,
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
    const baseDir =
      plugin && plugin.manifest && plugin.manifest.dir
        ? plugin.manifest.dir
        : ".obsidian/plugins/bangumi-manager";
    const cleanRel = `${baseDir.replace(/\/$/, "")}/assets/roxy/${relativeFile.replace(/^\//, "")}`;
    if (
      plugin &&
      plugin.app &&
      plugin.app.vault &&
      plugin.app.vault.adapter &&
      typeof plugin.app.vault.adapter.getResourcePath === "function"
    ) {
      return plugin.app.vault.adapter.getResourcePath(cleanRel);
    }
  } catch (err) {
    // ignore
  }
  return "";
}

/**
 * 预加载全部 7 张洛琪希立绘，确保点击切换不同情绪时零闪烁（若本地未安装额外高清立绘包则跳过图片预加载并自动启用内置像素形象）
 */
function preloadAllRoxyPortraits(plugin, coord) {
  if (!coord) return;
  const hdStatus = checkRoxyHdPortraitsStatus(plugin);
  coord.hdPortraitsAvailable = hdStatus.installed;
  if (!hdStatus.installed) {
    coord.resolvedUrls = {};
    return;
  }
  if (coord.preloaded) return;
  coord.preloaded = true;
  coord.resolvedUrls = {};
  const uniqueFiles = new Set(Object.values(ROXY_PORTRAIT_FILES));
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
 * 加载并获取 Q 版像素/矢量骨骼组件 RoxyPixelAvatar（专用于三维原画档案室，与二维高清立绘形态区分）
 */
function ensureRoxyPixelAvatarClass() {
  if (typeof window !== "undefined") {
    if (!window.RoxyPixelAvatar) {
      try {
        require("../assets/roxy/roxy-pixel.js");
      } catch (err) {
        // ignore
      }
    }
    return window.RoxyPixelAvatar || null;
  }
  return null;
}

/**
 * 将 7 种洛琪希情绪状态映射到 RoxyPixelAvatar 的静态姿态（不启动无限循环 RAF，保持低打扰与零常驻 CPU 开销）
 */
function applyRoxy3DPixelPose(avatar, state) {
  if (!avatar || typeof avatar.setState !== "function") return;
  const st = ROXY_PORTRAIT_FILES[state] ? state : "explain";
  const baseState = st === "warn2" ? "warn" : st === "idle" ? "explain" : st;
  avatar.setState(baseState, false);
  // 选取 t = 0.45s 的确定性帧（此时眨眼判定 isBlink 为 false，双目自然睁开，姿态端正）
  avatar.update(0.45);

  // 针对 warn2（教师叮嘱态）与 warn（软气抗议态）做差分修饰，保证 7 种情绪在 3D 手办上均有独立神态
  if (typeof avatar.q === "function") {
    const rootG = avatar.q("#rx-root");
    if (rootG) {
      rootG.setAttribute("transform", st === "blocked" ? "translate(0, 3)" : "translate(0, 0)");
    }
    if (st === "warn2") {
      const fxWarn = avatar.q("#rx-fx-warn");
      const fxStars = avatar.q("#rx-fx-stars");
      const armL = avatar.q("#rx-arm-left");
      const armR = avatar.q("#rx-arm-right");
      const staffGlow = avatar.q("#rx-staff-glow");
      if (fxWarn) fxWarn.style.display = "none";
      if (fxStars) fxStars.style.display = "block";
      if (armL) armL.style.transform = "rotate(18deg)";
      if (armR) armR.style.transform = "rotate(-28deg)";
      if (staffGlow) staffGlow.setAttribute("opacity", "0.82");
    }
  }
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
      message: `目前案头有《${top.name}》（已看 ${t > 0 ? `${w}/${t}话` : `${w}话`}）等 ${watching.length} 部连载正在跟进。今天要先看第 ${nextEp} 话，还是整理笔记呢？`
    };
  }

  // 4. 若当前没有「在看」作品，使用温和的讲解立绘（explain）引导首屏候补席
  return {
    type: "primary:standby",
    state: "explain",
    badgeText: "✦ 洛琪希 · 首要事项",
    isPrimary: true,
    priority: PRIORITY.NORMAL,
    message: `目前案头还没有标记为「在看」的连载呢。我已经从您的 ${plan.length} 部想看候补与 ${completed.length} 部已看典藏里挑了 4 部放在首屏，随时可以挑一部开始追番哦。`
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
    .filter((it) => (it.bangumiScore ?? it.preciseScore) !== null)
    .sort((a, b) => (b.bangumiScore ?? b.preciseScore ?? 0) - (a.bangumiScore ?? a.preciseScore ?? 0));

  const lastSyncTs = Number(plugin?.settings?.lastRatingMonitorAt) || 0;
  const syncAgeHours = lastSyncTs > 0 ? Math.max(0, Math.round((now.getTime() - lastSyncTs) / 3600000)) : null;
  const syncPrefix =
    syncAgeHours !== null && syncAgeHours <= 72
      ? `根据最近（约 ${syncAgeHours === 0 ? "刚刚" : `${syncAgeHours} 小时前`}）同步的评分数据，`
      : "查阅了馆藏的 Bangumi 评分记录，";

  if (scoredBgmPlan.length > 0) {
    const topPlan = scoredBgmPlan[0];
    const topScore = Number(topPlan.bangumiScore ?? topPlan.preciseScore).toFixed(1);
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
      badgeText: "✦ 洛琪希 · 编目叮嘱",
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
      badgeText: "✦ 洛琪希 · 编目叮嘱",
      isPrimary: false,
      message: `看完了新的一话之后，请记得顺手点一下卡片上的「+1」按钮登记进度哦。保持台账整洁可是馆藏记录的基本功呢。`
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
 * 当用户连续多次点击洛琪希时，返回符合角色性格的递进抗议/讨饶/眩晕预警台词（满 100 下触发弹飞逃跑彩蛋）
 */
function buildOverPokeReaction(pokeStreak) {
  const warnLines = [
    "那、那个……请不要一直连续戳我啦！我是在认真帮您核对番剧台账，可不是放在桌角解闷的玩偶哦。",
    "禁止继续乱戳！再这样打岔的话，我今天就不帮您留意新番的开播日期了哦。"
  ];
  const panicLines = [
    "呜哇……帽子都要被您戳歪了！就算一直按我也不会掉出隐藏动画来的，快去挑一部番看吧！",
    "请、请饶了我吧……如果您是想看回最关键的案头事项，点一下气泡上面的「↺ 首要」就能马上切回去了！",
    "别、别再连击了！再戳下去手里的番剧编目账本都要散落一地啦！"
  ];

  if (pokeStreak >= 99) {
    return {
      type: "poke:critical_99",
      state: "panic",
      badgeText: "✦ 洛琪希 · 临界警报",
      isPrimary: false,
      autoHideMs: 12000,
      message: "九、九十九下了……？！脚下的重力稳定术式已经彻底撑不住了，下一下绝对会被弹飞出去的，快停手呀——！"
    };
  }
  if (pokeStreak >= 80) {
    return {
      type: "poke:dizzy_80",
      state: "panic",
      badgeText: "✦ 洛琪希 · 天旋地转",
      isPrimary: false,
      autoHideMs: 12000,
      message: `已经连戳 ${pokeStreak} 下了……呜哇，眼前的画面开始高速转圈了，再戳满 100 下真的要控制不住乱飞了——！`
    };
  }
  if (pokeStreak >= 50) {
    return {
      type: "poke:dizzy_50",
      state: "blocked",
      badgeText: "✦ 洛琪希 · 魔力紊乱",
      isPrimary: false,
      autoHideMs: 12000,
      message: `五、五十多下了（连戳 ×${pokeStreak}）？！难道您是在测试什么奇怪的百连击隐藏成就吗……头好晕……`
    };
  }
  if (pokeStreak >= 25) {
    return {
      type: "poke:warn_25",
      state: "warn2",
      badgeText: "✦ 洛琪希 · 严肃警告",
      isPrimary: false,
      autoHideMs: 12000,
      message: `已经连续戳了 ${pokeStreak} 下了哦！就算我是米格路德族，被您这样高频连点也是会失去平衡的！`
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
 * 当「连戳×100」把洛琪希弹飞消失后，用户点击召唤按钮将她哄回来时的多结果随机抱怨台词池（共 8 种不同神态与抱怨内容）
 */
function buildRoxyRunawayComplaintRecord(coord) {
  const complaints = [
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
        "咳咳！虽然听到您的召唤还是乖乖回来了，但我必须严正声明——馆藏记录员的职责是核对动画台账，绝对不包括『百连击满屏弹射表演』！"
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
    },
    {
      state: "warn2",
      badgeText: "✦ 洛琪希 · 约法三章",
      message:
        "先说好哦，既然把我召唤回来了，今天就不许再凑满 100 连击了！刚才撞到顶部边框的那一下，到现在脑门还隐隐作痛呢……"
    },
    {
      state: "panic",
      badgeText: "✦ 洛琪希 · 惊魂未定",
      message:
        "呼、呼……总算平稳落地了。刚才第 100 下戳过来的时候，脚下突然冒出一串残影把我弹飞出去，我还以为误触了什么古代传送阵呢……"
    }
  ];

  let nextIdx = Math.floor(Math.random() * complaints.length);
  if (coord && typeof coord.lastRunawayComplaintIdx === "number" && complaints.length > 1) {
    if (nextIdx === coord.lastRunawayComplaintIdx) {
      nextIdx = (nextIdx + 1 + Math.floor(Math.random() * (complaints.length - 1))) % complaints.length;
    }
    coord.lastRunawayComplaintIdx = nextIdx;
  }

  const picked = complaints[nextIdx];
  return {
    type: `roxy:summoned_back_${nextIdx}`,
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
 * 向洛琪希馆藏记录员发送真实状态事件（自动执行冷却、去重与优先级裁决）
 */
function emitRoxyEvent(plugin, payload = {}) {
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord) return false;

  const now = Date.now();
  const state = ROXY_PORTRAIT_FILES[payload.state] ? payload.state : "explain";
  const priority = payload.priority || PRIORITY.NORMAL;
  const eventType = payload.type || "general";
  const dedupeKey = payload.dedupeKey || `${eventType}:${state}:${payload.message || ""}`;
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

  const record = {
    id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
    ts: now,
    type: eventType,
    state,
    badgeText:
      payload.badgeText ||
      (payload.category ? `✦ 洛琪希 · ${payload.category}` : `✦ 洛琪希 · ${STATE_LABELS[state] || "记录"}`),
    stepHint: payload.stepHint || "",
    isPrimary: Boolean(payload.isPrimary),
    message: String(payload.message || "").trim(),
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

/**
 * 在二维“案头编目台”挂载或刷新洛琪希高清立绘看板娘
 */
function mountRoxy2DMascot(plugin, container, state, helpers = {}) {
  const coord = ensureRoxyCoordinator(plugin);
  if (!coord || !container) return null;

  const hostEl =
    container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")
      ? container.parentElement
      : container;

  hostEl.querySelectorAll(".curator-roxy-widget").forEach((existing) => {
    if (typeof existing._cleanupRoxy === "function") {
      existing._cleanupRoxy();
    }
    existing.remove();
  });

  const isEnabled = plugin.settings.enableRoxy2DMascot !== false;
  const isSessionHidden = Boolean(coord.sessionHidden2D);
  const isMinimized = Boolean(plugin.settings.roxy2DMinimized);
  const isRunaway = Boolean(coord.runaway2D);

  syncTopbarRoxyButton(plugin, container, state, helpers);

  if (!isEnabled || isSessionHidden) {
    return null;
  }

  const useHdInitially = Boolean(coord.hdPortraitsAvailable) && !plugin.settings.roxyForceLightweight2D;

  const widget = hostEl.createDiv(
    `curator-roxy-widget ${isRunaway ? "is-runaway" : isMinimized ? "is-minimized" : "is-expanded"} ${
      useHdInitially ? "is-hd-portrait-mode" : "is-pixel-fallback-mode"
    }`
  );
  widget.dataset.roxyState = coord.currentState || "explain";

  // 1. 对话气泡（含状态徽章、轮播序号、「↺ 首要」还原按钮与关闭按钮）
  const bubble = widget.createDiv("curator-roxy-bubble is-hidden");
  const bubbleHeader = bubble.createDiv("curator-roxy-bubble-header");
  const bubbleLeftMeta = bubbleHeader.createDiv("curator-roxy-bubble-meta");
  const bubbleBadge = bubbleLeftMeta.createSpan({
    cls: "curator-roxy-bubble-badge",
    text: `✦ 洛琪希 · ${STATE_LABELS[coord.currentState] || "导览"}`
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
  restorePrimaryBtn.title = "将气泡内容还原为当前最需要优先关注的案头首要事项";

  const bubbleCloseBtn = bubbleRightCtrls.createEl("button", {
    cls: "curator-roxy-bubble-close",
    text: "×"
  });
  bubbleCloseBtn.title = "收起提示气泡";

  const bubbleText = bubble.createDiv({
    cls: "curator-roxy-bubble-text",
    text: ""
  });

  // 2. 立绘半身像舞台（平时下缘自然嵌入底部名牌后方；未安装高清立绘包时自动适配为内置像素洛琪希；连戳×100时展露完整白靴全身独立弹射）
  const stage = widget.createDiv("curator-roxy-stage");
  const portraitImg = stage.createEl("img", {
    cls: "curator-roxy-portrait roxy-clean-fx"
  });
  const pixelFallbackHost = stage.createDiv("curator-roxy-pixel-fallback roxy-clean-fx");
  let pixelFallbackAvatar = null;

  const ensurePixelFallbackAvatar = (poseState) => {
    const PixelAvatarClass = ensureRoxyPixelAvatarClass();
    if (!PixelAvatarClass) return null;
    if (!pixelFallbackAvatar) {
      pixelFallbackHost.empty();
      pixelFallbackAvatar = new PixelAvatarClass(pixelFallbackHost, {
        scale: 0.56,
        state: poseState || coord.currentState || "explain",
        talking: false
      });
    }
    applyRoxy3DPixelPose(pixelFallbackAvatar, poseState || coord.currentState || "explain");
    return pixelFallbackAvatar;
  };

  const initState = coord.currentState || "explain";
  const initFile = ROXY_PORTRAIT_FILES[initState] || ROXY_PORTRAIT_FILES.explain;

  const applyStageMode = (targetState) => {
    const pose = ROXY_PORTRAIT_FILES[targetState] ? targetState : "explain";
    const file = ROXY_PORTRAIT_FILES[pose] || ROXY_PORTRAIT_FILES.explain;
    const canUseHd = Boolean(coord.hdPortraitsAvailable) && !plugin.settings.roxyForceLightweight2D;
    if (canUseHd) {
      const nextUrl =
        (coord.resolvedUrls && coord.resolvedUrls[file]) || resolveRoxyAssetUrl(plugin, file);
      if (nextUrl) {
        widget.classList.add("is-hd-portrait-mode");
        widget.classList.remove("is-pixel-fallback-mode");
        portraitImg.style.display = "block";
        pixelFallbackHost.style.display = "none";
        if (portraitImg.getAttribute("src") !== nextUrl) {
          portraitImg.src = nextUrl;
        }
        return;
      }
    }
    // 未安装高清立绘扩展包或强制轻量模式：自动适配为内置矢量像素形象
    widget.classList.remove("is-hd-portrait-mode");
    widget.classList.add("is-pixel-fallback-mode");
    portraitImg.style.display = "none";
    pixelFallbackHost.style.display = "flex";
    ensurePixelFallbackAvatar(pose);
  };

  portraitImg.alt = "洛琪希 · 馆藏记录员";
  portraitImg.draggable = false;
  portraitImg.onerror = () => {
    // 若本地图片加载失败（如通过 BRAT 安装尚未下载扩展立绘包），无缝降级到内置像素洛琪希
    coord.hdPortraitsAvailable = false;
    applyStageMode(widget.dataset.roxyState || "explain");
    if (packDownloadBtn) {
      packDownloadBtn.style.display = "inline-flex";
    }
  };

  const hitZone = stage.createDiv("curator-roxy-hit-zone");
  hitZone.title = "点击洛琪希切换下一条番剧咨讯（连续点击会有不同反应，右键或点「↺ 首要」还原首要事项）";

  // 3. 底部轻量控制名牌（平时压在立绘下缘前方挡住脚部裁切线；弹飞时向下收起隐藏，绝不跟着一起飞；飞走后升起召唤按钮）
  const dockBar = widget.createDiv("curator-roxy-dock-bar");
  const summonBackBtn = dockBar.createEl("button", {
    cls: "curator-roxy-summon-btn",
    text: "🔮 洛琪希被戳飞逃跑了 · 点击召唤回来"
  });
  summonBackBtn.dataset.roxyAction = "summon-runaway";
  summonBackBtn.title = "把被连戳 100 下弹飞出去的洛琪希重新召唤回案头";

  const nameTagBtn = dockBar.createEl("button", {
    cls: "curator-roxy-name-btn",
    text: isMinimized ? "✦ 洛琪希 · 记录员 [展开]" : "✦ 洛琪希 · 记录员"
  });
  nameTagBtn.title = isMinimized ? "展开洛琪希馆藏记录员" : "点击切换下一条番剧咨讯";

  const ctrlsGroup = dockBar.createDiv("curator-roxy-ctrl-group");

  // 当检测到本地未安装高清立绘包时，在控制栏提供一键下载扩展包入口
  const packDownloadBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-pack-dl",
    text: "📥 立绘包"
  });
  packDownloadBtn.dataset.roxyAction = "download-hd-pack";
  packDownloadBtn.title = "当前使用内置轻量像素版 · 点击一键下载洛琪希高清立绘扩展包（7张 PNG）";
  packDownloadBtn.style.display = coord.hdPortraitsAvailable ? "none" : "inline-flex";

  const dockPrimaryBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-primary-reset",
    text: "首要"
  });
  dockPrimaryBtn.dataset.roxyAction = "dock-restore-primary";
  dockPrimaryBtn.title = "还原为当前最需要展现的首要案头事项";

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
  hideBtn.title = "本次会话暂时隐藏（可从顶栏「✦ 记录员」随时唤出）";

  const disableBtn = ctrlsGroup.createEl("button", {
    cls: "curator-roxy-ctrl-btn is-muted",
    text: "关闭"
  });
  disableBtn.dataset.roxyAction = "disable-permanent";
  disableBtn.title = "永久关闭二维记录员（可在插件设置或顶栏重新启用）";

  applyStageMode(initState);

  let bubbleTimer = null;
  let cancelPinballAnim = null;

  const getActiveActorEl = () =>
    widget.classList.contains("is-pixel-fallback-mode") ? pixelFallbackHost : portraitImg;

  const triggerQBounce = () => {
    const actor = getActiveActorEl();
    actor.classList.remove("roxy-pressing", "roxy-anim-qbounce");
    void actor.offsetWidth;
    actor.classList.add("roxy-anim-qbounce");
  };

  const triggerBubblePop = () => {
    bubble.classList.remove("roxy-bubble-popping");
    void bubble.offsetWidth;
    bubble.classList.add("roxy-bubble-popping");
  };

  const hideBubble = () => {
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    bubble.classList.remove("is-visible", "roxy-bubble-popping");
    bubble.classList.add("is-hidden");
  };

  const showRecord = (record) => {
    if (!record || coord.runaway2D || coord.isPinballFlying2D) return;
    const nextState = ROXY_PORTRAIT_FILES[record.state] ? record.state : "explain";
    widget.dataset.roxyState = nextState;

    applyStageMode(nextState);

    // 每次切换状态或弹出新对话框，仅执行单次 Q 弹动效，绝不无限循环摇晃
    triggerQBounce();

    if (record.message) {
      bubbleBadge.textContent = record.badgeText || `✦ 洛琪希 · ${STATE_LABELS[nextState] || "记录"}`;
      bubbleBadge.className = `curator-roxy-bubble-badge is-${nextState}`;
      bubbleStep.textContent = record.stepHint || (record.isPrimary ? "首要" : "");
      bubbleStep.style.display = bubbleStep.textContent ? "inline-flex" : "none";
      restorePrimaryBtn.classList.toggle("is-active-primary", Boolean(record.isPrimary));

      bubbleText.textContent = record.message;
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
        packDownloadBtn.style.display = "none";
        applyStageMode(widget.dataset.roxyState || "explain");
        emitRoxyEvent(plugin, {
          type: "roxy:hd_pack_installed",
          state: "success",
          badgeText: "✦ 洛琪希 · 高清立绘就位",
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

  // 将被「连戳×100」弹飞消失的洛琪希召唤回案头，并弹出多分支随机抱怨台词
  const summonRoxyBack2D = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (typeof cancelPinballAnim === "function") {
      cancelPinballAnim();
      cancelPinballAnim = null;
    }
    stage.style.transform = "";
    stage.style.opacity = "";
    coord.runaway2D = false;
    coord.isPinballFlying2D = false;
    coord.pokeStreak = 0;
    if (plugin.settings.roxy2DMinimized) {
      plugin.settings.roxy2DMinimized = false;
      plugin.saveSettings().catch(() => {});
    }
    widget.classList.remove("is-runaway", "is-minimized", "is-pinball-rampage");
    widget.classList.add("is-expanded", "is-summon-landing");
    setTimeout(() => {
      widget.classList.remove("is-summon-landing");
    }, 520);
    nameTagBtn.textContent = "✦ 洛琪希 · 记录员";
    minBtn.textContent = "最小化";
    syncTopbarRoxyButton(plugin, container, state, helpers);
    const complaintRecord = buildRoxyRunawayComplaintRecord(coord);
    emitRoxyEvent(plugin, complaintRecord);
  };

  summonBackBtn.onclick = summonRoxyBack2D;
  widget._summonRoxyBack2D = summonRoxyBack2D;

  // 将气泡与立绘还原为当前最需要关注的首要事项（Card 0）
  const restoreToPrimary = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (coord.runaway2D) {
      summonRoxyBack2D(e);
      return;
    }
    if (plugin.settings.roxy2DMinimized) {
      plugin.settings.roxy2DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameTagBtn.textContent = "✦ 洛琪希 · 记录员";
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

  // 玩偶按压形变反馈（pointerdown 微微压扁，松手触发单次 Q 弹）
  hitZone.addEventListener("pointerdown", () => {
    if (coord.isPinballFlying2D || coord.runaway2D) return;
    const actor = getActiveActorEl();
    actor.classList.remove("roxy-anim-qbounce");
    actor.classList.add("roxy-pressing");
  });
  const clearPressing = () => {
    portraitImg.classList.remove("roxy-pressing");
    pixelFallbackHost.classList.remove("roxy-pressing");
  };
  hitZone.addEventListener("pointerup", clearPressing);
  hitZone.addEventListener("pointerleave", clearPressing);
  hitZone.addEventListener("pointercancel", clearPressing);

  // 右键立绘可直接还原到「首要事项」
  hitZone.addEventListener("contextmenu", (e) => {
    restoreToPrimary(e);
  });

  // 左键点击立绘或名牌：若气泡已隐藏且处于初始态，先展示首要事项；否则轮播下一条真实数据咨讯，按多了触发软气抗议/慌张，满100下触发满屏连续高速回弹消失彩蛋
  const handleCharacterClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

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
      nameTagBtn.textContent = "✦ 洛琪希 · 记录员";
      minBtn.textContent = "最小化";
      restoreToPrimary();
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

    // 趣味彩蛋：当连戳达到 100 次（连戳 ×100）时：
    // 1. 立即收起气泡、底部 UI 控制条向下滑出隐藏（绝不带着 UI 条一起飞！）
    // 2. 解除舞台底部裁切，露出洛琪希完整的白色短靴全身立绘
    // 3. 洛琪希独自一人以恒定超高速在屏幕四壁连续反弹 4 次后直接飞出屏幕外消失（中途零停顿！）
    if (coord.pokeStreak >= 100) {
      coord.isPinballFlying2D = true;
      coord.currentState = "panic";
      widget.dataset.roxyState = "panic";
      applyStageMode("panic");

      // 立即收起对话气泡，不中途停顿弹窗
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

    // 当连续点击达到 5 次及以上时，触发洛琪希软气抗议（warn）或脸红慌张（panic）
    if (coord.pokeStreak >= 5) {
      const pokeReaction = buildOverPokeReaction(coord.pokeStreak);
      emitRoxyEvent(
        plugin,
        Object.assign({}, pokeReaction, {
          force: true,
          stepHint: `连戳 ×${coord.pokeStreak}`
        })
      );
      return;
    }

    // 正常点击：推进真实数据咨讯队列（开播日历 -> 评分情报 -> 编目叮嘱 -> 候补盘点 -> 馆藏小结）
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
        isPrimary: false,
        stepHint: `咨讯 ${idx + 1}/${deck.length}`,
        autoHideMs: 12000
      })
    );
  };

  hitZone.onclick = handleCharacterClick;
  nameTagBtn.onclick = handleCharacterClick;

  minBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextMin = !plugin.settings.roxy2DMinimized;
    plugin.settings.roxy2DMinimized = nextMin;
    await plugin.saveSettings();
    widget.classList.toggle("is-minimized", nextMin);
    widget.classList.toggle("is-expanded", !nextMin);
    nameTagBtn.textContent = nextMin ? "✦ 洛琪希 · 记录员 [展开]" : "✦ 洛琪希 · 记录员";
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
    widget.remove();
    syncTopbarRoxyButton(plugin, container, state, helpers);
  };

  disableBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.settings.enableRoxy2DMascot = false;
    await plugin.saveSettings();
    hideBubble();
    widget.remove();
    syncTopbarRoxyButton(plugin, container, state, helpers);
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice("已关闭二维馆藏记录员（可在插件设置或顶栏重新开启）");
    }
  };

  coord.listeners2D.add(showRecord);
  widget._cleanupRoxy = () => {
    coord.listeners2D.delete(showRecord);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (typeof cancelPinballAnim === "function") {
      cancelPinballAnim();
      cancelPinballAnim = null;
    }
  };

  // 首次打开工作台或重绘时，若处于首要态则展示当前最重要的一条「首要事项」（explain 姿态）
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

  return widget;
}

/**
 * 在顶栏操作区同步「✦ 记录员」恢复入口按钮（含「连戳×100」弹飞后的召唤按钮态）
 */
function syncTopbarRoxyButton(plugin, container, state, helpers) {
  const actionsCol = container.querySelector(".curator-topbar-actions");
  if (!actionsCol) return;

  const coord = ensureRoxyCoordinator(plugin);
  let btn = actionsCol.querySelector(".curator-roxy-topbar-toggle");
  if (!btn) {
    btn = actionsCol.createEl("button", {
      cls: "curator-top-btn is-subtle curator-roxy-topbar-toggle"
    });
    const enter3DBtn = actionsCol.querySelector(".curator-top-btn.is-3d-entry");
    if (enter3DBtn) {
      actionsCol.insertBefore(btn, enter3DBtn);
    }
  }

  const isEnabled = plugin.settings.enableRoxy2DMascot !== false;
  const isSessionHidden = Boolean(coord && coord.sessionHidden2D);
  const isRunaway = Boolean(coord && coord.runaway2D);

  btn.classList.remove("is-roxy-off", "is-roxy-summon");
  if (!isEnabled) {
    btn.textContent = "✦ 开启记录员";
    btn.title = "重新启用洛琪希二维馆藏记录员";
    btn.classList.add("is-roxy-off");
  } else if (isSessionHidden) {
    btn.textContent = "✦ 唤出记录员";
    btn.title = "恢复显示本次会话隐藏的洛琪希记录员";
    btn.classList.add("is-roxy-off");
  } else if (isRunaway) {
    btn.textContent = "🔮 召唤洛琪希";
    btn.title = "洛琪希被连戳 100 下弹飞躲起来了，点击将她召唤回案头";
    btn.classList.add("is-roxy-off", "is-roxy-summon");
  } else {
    btn.textContent = "✦ 记录员";
    btn.title = "点击还原洛琪希的首要案头提示（右下角挂件支持点击轮播咨讯、最小化、隐藏或关闭）";
  }

  btn.onclick = async (e) => {
    e.preventDefault();
    if (!plugin.settings.enableRoxy2DMascot) {
      plugin.settings.enableRoxy2DMascot = true;
      plugin.settings.roxy2DMinimized = false;
      if (coord) {
        coord.sessionHidden2D = false;
        coord.runaway2D = false;
        coord.isPinballFlying2D = false;
        coord.pokeStreak = 0;
        coord.deckIndex = 0;
      }
      await plugin.saveSettings();
      mountRoxy2DMascot(plugin, container, state, helpers);
      emitRoxyEvent(plugin, {
        type: "roxy:reenabled",
        state: "success",
        badgeText: "✦ 洛琪希 · 归档就位",
        stepHint: "就位",
        priority: PRIORITY.HIGH,
        force: true,
        message: "让您久等了，馆藏记录员洛琪希已经重新回到案头待命，随时可以帮您核对番剧进度哦。"
      });
    } else if (coord && coord.runaway2D) {
      const hostEl =
        container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")
          ? container.parentElement
          : container;
      const existing = hostEl.querySelector(".curator-roxy-widget");
      if (existing && typeof existing._summonRoxyBack2D === "function") {
        existing._summonRoxyBack2D(e);
      } else {
        coord.runaway2D = false;
        coord.isPinballFlying2D = false;
        coord.pokeStreak = 0;
        plugin.settings.roxy2DMinimized = false;
        await plugin.saveSettings();
        mountRoxy2DMascot(plugin, container, state, helpers);
        emitRoxyEvent(plugin, buildRoxyRunawayComplaintRecord(coord));
      }
    } else if (coord && coord.sessionHidden2D) {
      coord.sessionHidden2D = false;
      coord.pokeStreak = 0;
      coord.deckIndex = 0;
      plugin.settings.roxy2DMinimized = false;
      await plugin.saveSettings();
      mountRoxy2DMascot(plugin, container, state, helpers);
      const primary = buildPrimaryDeskRecord(plugin, state);
      emitRoxyEvent(plugin, Object.assign({}, primary, { force: true, stepHint: "首要" }));
    } else {
      const hostEl =
        container.parentElement && container.parentElement.classList.contains("bangumi-score-dashboard-view")
          ? container.parentElement
          : container;
      const existing = hostEl.querySelector(".curator-roxy-widget");
      if (!existing) {
        mountRoxy2DMascot(plugin, container, state, helpers);
      }
      if (coord) {
        coord.pokeStreak = 0;
        coord.deckIndex = 0;
      }
      const primary = buildPrimaryDeskRecord(plugin, state);
      emitRoxyEvent(plugin, Object.assign({}, primary, { force: true, stepHint: "首要" }));
    }
  };
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
 * 二维洛琪希馆藏记录员专属样式（单次 Q 弹动效、无循环摇晃、纸本气泡、连戳×100独立全身弹射与底部UI收起、无立绘包自动像素降级）
 */
function getRoxy2DMascotStyles() {
  return [
    /* 单次 Q 弹玩偶动效（底部中心锚定 50% 100%，按下微缩，松手或切换台词时单次 Q 弹回弹，平时静止不晃） */
    "@keyframes roxy-q-bounce{0%{transform:scaleX(1) scaleY(1);}28%{transform:scaleX(1.065) scaleY(0.885);}60%{transform:scaleX(0.96) scaleY(1.048);}82%{transform:scaleX(1.016) scaleY(0.988);}100%{transform:scaleX(1) scaleY(1);}}",
    "@keyframes roxy-bubble-pop{0%{opacity:0;transform:translateY(8px) scale(0.91);}70%{opacity:1;transform:translateY(-2px) scale(1.015);}100%{opacity:1;transform:translateY(0) scale(1);}}",
    "@keyframes roxy-summon-drop{0%{transform:translateY(-64px) scale(0.75);opacity:0;}62%{transform:translateY(6px) scale(1.06,0.92);opacity:1;}84%{transform:translateY(-3px) scale(0.97,1.03);opacity:1;}100%{transform:translateY(0) scale(1);opacity:1;}}",
    ".roxy-clean-fx{filter:drop-shadow(0 8px 20px rgba(32,24,16,0.16));}",
    ".curator-roxy-portrait.roxy-pressing,.curator-roxy-pixel-fallback.roxy-pressing{transform:scaleX(1.055) scaleY(0.89) !important;transition:transform 0.1s ease-out !important;}",
    ".curator-roxy-portrait.roxy-anim-qbounce,.curator-roxy-pixel-fallback.roxy-anim-qbounce{animation:roxy-q-bounce 0.42s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".curator-roxy-bubble.roxy-bubble-popping{animation:roxy-bubble-pop 0.28s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".curator-roxy-widget.is-summon-landing .curator-roxy-stage{animation:roxy-summon-drop 0.48s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    /* 预留底部滚动呼吸空间，确保滚到底部时右下角挂件绝不遮挡任何卡片或统计模块 */
    ".curator-desk-root{padding-bottom:118px !important;}",
    /* 右下角轻量记录员容器（gap: 0 确保立绘底部紧贴并嵌入底部名牌后方，不留悬空断层） */
    ".curator-roxy-widget{position:fixed;right:24px;bottom:34px;z-index:40;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:0;user-select:none;}",
    ".curator-roxy-widget.is-pinball-rampage{z-index:999 !important;pointer-events:none !important;}",
    /* 纸本档案风对话气泡 */
    ".curator-roxy-bubble{pointer-events:auto;max-width:268px;padding:9px 12px;margin-right:4px;margin-bottom:6px;border-radius:11px 11px 3px 11px;border:1px solid color-mix(in srgb, #8f683d 44%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 96%, #f6efe3 4%);box-shadow:0 8px 22px rgba(38,28,18,0.13);transform-origin:88% 100%;transition:opacity .18s ease,transform .18s ease;}",
    ".curator-roxy-bubble.is-hidden,.curator-roxy-widget.is-pinball-rampage .curator-roxy-bubble{opacity:0 !important;transform:translateY(8px) scale(0.95) !important;pointer-events:none !important;visibility:hidden !important;}",
    ".curator-roxy-bubble.is-visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;visibility:visible;}",
    ".curator-roxy-bubble-header{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;padding-bottom:3px;border-bottom:1px dashed color-mix(in srgb, var(--background-modifier-border) 65%, transparent);}",
    ".curator-roxy-bubble-meta{display:inline-flex;align-items:center;gap:5px;min-width:0;}",
    ".curator-roxy-bubble-badge{font-size:10.5px;font-weight:700;letter-spacing:0.03em;color:#8f683d;white-space:nowrap;}",
    ".curator-roxy-bubble-badge.is-success{color:#3a7d5c;}",
    ".curator-roxy-bubble-badge.is-warn,.curator-roxy-bubble-badge.is-panic{color:#b8543d;}",
    ".curator-roxy-bubble-badge.is-warn2{color:#a86428;}",
    ".curator-roxy-bubble-badge.is-surprised{color:#2b72b9;}",
    ".curator-roxy-bubble-step{font-size:9.5px;padding:0 5px;border-radius:999px;background:color-mix(in srgb, #8f683d 12%, var(--background-secondary));color:var(--text-muted);font-weight:600;white-space:nowrap;}",
    ".curator-roxy-bubble-ctrls{display:inline-flex;align-items:center;gap:3px;flex-shrink:0;}",
    ".curator-roxy-bubble-restore{cursor:pointer;padding:1px 6px;border-radius:4px;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));background:var(--background-secondary);color:#8f683d;font-size:10px;font-weight:600;line-height:1.3;transition:all .12s ease;}",
    ".curator-roxy-bubble-restore:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-roxy-bubble-restore.is-active-primary{display:none !important;}",
    ".curator-roxy-bubble-close{cursor:pointer;width:17px;height:17px;padding:0;border:none;background:transparent;color:var(--text-faint);font-size:12px;line-height:1;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;}",
    ".curator-roxy-bubble-close:hover{background:var(--background-modifier-hover);color:var(--text-normal);}",
    ".curator-roxy-bubble-text{font-size:12px;line-height:1.48;color:var(--text-normal);word-break:break-word;}",
    /* 半身立绘舞台：平时 margin-bottom: -10px 让立绘下缘自然探入底部 UI 控制条后方（由 UI 条自然遮挡腿部裁切处，不留缝隙）；连戳×100弹飞时解除裁切露出完整白靴全身独立飞行！ */
    ".curator-roxy-stage{position:relative;z-index:1;width:146px;height:168px;margin-bottom:-10px;overflow:hidden;pointer-events:none;display:flex;align-items:flex-start;justify-content:center;transform-origin:50% 50%;will-change:transform;}",
    ".curator-roxy-widget.is-pixel-fallback-mode .curator-roxy-stage{height:142px;margin-bottom:-6px;align-items:flex-end;overflow:visible;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-stage{height:218px !important;margin-bottom:0 !important;overflow:visible !important;transition:none !important;}",
    ".curator-roxy-widget.is-minimized .curator-roxy-stage,.curator-roxy-widget.is-runaway .curator-roxy-stage{height:0 !important;margin-bottom:0 !important;opacity:0;pointer-events:none;}",
    ".curator-roxy-widget.is-runaway .curator-roxy-bubble{display:none !important;}",
    ".curator-roxy-portrait{width:146px;height:218px;object-fit:contain;object-position:top center;transform-origin:50% 100%;pointer-events:none;will-change:transform;transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);}",
    ".curator-roxy-pixel-fallback{width:132px;height:140px;display:none;align-items:flex-end;justify-content:center;transform-origin:50% 100%;pointer-events:none;will-change:transform;transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);}",
    ".curator-roxy-pixel-fallback *{pointer-events:none !important;}",
    ".curator-roxy-hit-zone{position:absolute;top:12px;left:22px;width:102px;height:146px;pointer-events:auto;cursor:pointer;border-radius:40% 40% 16% 16%;-webkit-tap-highlight-color:transparent;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-hit-zone{pointer-events:none !important;}",
    /* 底部轻量控制名牌：平时 z-index: 2 压在立绘底部前方挡住脚部；当洛琪希被弹飞（.is-pinball-rampage）时，UI条向下收起隐藏，绝不跟着洛琪希一起飞！ */
    ".curator-roxy-dock-bar{position:relative;z-index:2;pointer-events:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;margin-bottom:2px;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 96%, #f5ede0 4%);box-shadow:0 4px 12px rgba(34,24,14,0.12);transition:transform 0.22s cubic-bezier(0.4,0,0.2,1),opacity 0.18s ease;}",
    ".curator-roxy-widget.is-pinball-rampage .curator-roxy-dock-bar{transform:translateY(28px) scale(0.9) !important;opacity:0 !important;pointer-events:none !important;}",
    ".curator-roxy-summon-btn{display:none;cursor:pointer;padding:4px 10px;border:none;border-radius:999px;background:linear-gradient(135deg,#8f683d,#b8543d);color:#fffdf9;font-size:11.5px;font-weight:700;line-height:1.3;box-shadow:0 4px 12px rgba(184,84,61,0.28);transition:transform .15s ease,filter .15s ease;}",
    ".curator-roxy-summon-btn:hover{transform:translateY(-1px) scale(1.02);filter:brightness(1.08);}",
    ".curator-roxy-widget.is-runaway .curator-roxy-summon-btn{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-roxy-widget.is-runaway .curator-roxy-name-btn,.curator-roxy-widget.is-runaway .curator-roxy-ctrl-group{display:none !important;}",
    ".curator-roxy-name-btn{cursor:pointer;padding:1px 5px;border:none;background:transparent;font-size:11px;font-weight:700;color:#8f683d;line-height:1.2;}",
    ".curator-roxy-name-btn:hover{text-decoration:underline;}",
    ".curator-roxy-ctrl-group{display:inline-flex;align-items:center;gap:2px;padding-left:4px;border-left:1px solid var(--background-modifier-border);}",
    ".curator-roxy-ctrl-btn{cursor:pointer;padding:1px 5px;border:none;border-radius:4px;background:transparent;font-size:10.5px;color:var(--text-muted);line-height:1.2;transition:all .12s ease;}",
    ".curator-roxy-ctrl-btn:hover{background:var(--background-modifier-hover);color:#8f683d;}",
    ".curator-roxy-ctrl-btn.is-primary-reset{color:#8f683d;font-weight:600;}",
    ".curator-roxy-ctrl-btn.is-pack-dl{color:#2b72b9;font-weight:600;}",
    ".curator-roxy-ctrl-btn.is-pack-dl:hover{background:color-mix(in srgb, #2b72b9 12%, transparent);color:#1d5a96;}",
    ".curator-roxy-ctrl-btn.is-muted:hover{color:var(--text-error,#c94a4a);}",
    ".curator-roxy-topbar-toggle.is-roxy-off{border-style:dashed;color:#8f683d;}",
    ".curator-roxy-topbar-toggle.is-roxy-summon{border-style:solid;border-color:#b8543d;color:#b8543d;font-weight:700;}"
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
    message: `欢迎来到三维原画档案室。当前聚焦于「${laneName}」（共 ${laneList.length} 部），全馆 ${items.length} 部原画封套已按真实状态就位，单击任意封套即可抽阅详情哦。`
  };
}

/**
 * 在三维原画档案室顶栏同步「✦ 记录员」恢复与开关按钮（零侵入修改）
 */
function sync3DTopbarRoxyButton(plugin, space) {
  if (!space || !space.root) return;
  const coord = ensureRoxyCoordinator(plugin);

  // 统一三维原画档案室左上角主标识文案
  const brandEl = space.root.querySelector(".atelier-mark");
  if (brandEl && brandEl.childNodes[0] && brandEl.childNodes[0].nodeType === 3) {
    brandEl.childNodes[0].nodeValue = "三维原画档案室 · ATELIER CEL";
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
    btn.title = "重新启用三维原画档案室像素洛琪希记录员";
    btn.classList.add("is-roxy3d-off");
  } else if (isSessionHidden) {
    btn.textContent = "✦ 唤出记录员";
    btn.title = "恢复显示本次会话隐藏的像素洛琪希记录员";
    btn.classList.add("is-roxy3d-off");
  } else if (isRunaway3D) {
    btn.textContent = "🔮 召唤洛琪希";
    btn.title = "像素洛琪希被连戳 100 下弹飞躲起来了，点击将她召唤回原画台角";
    btn.classList.add("is-roxy3d-off", "is-roxy3d-summon");
  } else {
    btn.textContent = "✦ 记录员";
    btn.title = "点击还原洛琪希的首要档案室导览提示（左上角桌角手办框支持点击轮播咨讯、最小化、隐藏或关闭）";
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
        autoHideMs: 5500,
        message: "让您久等了，三维档案室记录员洛琪希已经回到原画分镜台边待命，随时为您登记抽阅动态哦。"
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
        emitRoxyEvent(plugin, buildRoxyRunawayComplaintRecord(coord));
      }
    } else if (coord && coord.sessionHidden3D) {
      coord.sessionHidden3D = false;
      coord.pokeStreak3D = 0;
      coord.deckIndex3D = 0;
      plugin.settings.roxy3DMinimized = false;
      await plugin.saveSettings();
      mountRoxy3DMascot(plugin, space);
      const primary = buildPrimary3DRecord(plugin, space);
      emitRoxyEvent(plugin, Object.assign({}, primary, { force: true, stepHint: "首要", autoHideMs: 6500 }));
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
      emitRoxyEvent(plugin, Object.assign({}, primary, { force: true, stepHint: "首要", autoHideMs: 6500 }));
    }
  };
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
      const res = origToggleLens(...args);
      const isHigh = this.lensMode === "highscore";
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
          message: `已从封套夹层中为您抽出《${it?.name || "当前作品"}》的随附笔记纸页，可以在此浏览编目摘要与个人观后手记。`
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
                  message: `在三维档案室里翻找了一遍，没有找到包含“${q}”的原画档案呢，要不要换个关键词试试？`
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
        message: "三维原画档案室的偏好与轨道配置已经为您妥善保存好了。"
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
 * 在三维“三维原画档案室”挂载像素洛琪希桌角手办框（RoxyPixelAvatar）
 * 严格遵循：与二维高清立绘形态区分、边缘低打扰、非交互区 pointer-events: none、零常驻循环摇晃、真实事件短暂响应
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
  const isMinimized = Boolean(plugin.settings.roxy3DMinimized);
  const isRunaway3D = Boolean(coord.runaway3D);

  sync3DTopbarRoxyButton(plugin, space);

  if (!isEnabled || isSessionHidden) {
    return null;
  }

  const widget = document.createElement("div");
  widget.className = `atelier-roxy3d-widget ${isRunaway3D ? "is-runaway" : isMinimized ? "is-minimized" : "is-expanded"}`;
  widget.dataset.ui = "roxy-3d-mascot";
  widget.dataset.roxyState = coord.currentState || "explain";
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

  const PixelAvatarClass = ensureRoxyPixelAvatarClass();
  let pixelAvatar = null;
  if (PixelAvatarClass) {
    pixelAvatar = new PixelAvatarClass(avatarHost, {
      scale: 0.275,
      state: coord.currentState || "explain",
      talking: false
    });
    applyRoxy3DPixelPose(pixelAvatar, coord.currentState || "explain");
  }

  const subPlaque = document.createElement("div");
  subPlaque.className = "atelier-roxy3d-subplaque";
  subPlaque.textContent = "ROXY · PIXEL";
  figureFrame.appendChild(subPlaque);

  const hitZone = document.createElement("div");
  hitZone.className = "atelier-roxy3d-hit-zone";
  hitZone.title = "点击像素洛琪希轮播番剧咨讯（连续点击有软气抗议反应，右键或点「↺ 首要」还原首要导览）";
  figureFrame.appendChild(hitZone);

  // 2. 下排：底部紧凑控制铭牌（含连戳×100弹飞后的召唤按钮）
  const dockBar = document.createElement("div");
  dockBar.className = "atelier-roxy3d-dock";
  widget.appendChild(dockBar);

  const summonBtn3D = document.createElement("button");
  summonBtn3D.className = "atelier-roxy3d-summon-btn";
  summonBtn3D.dataset.roxy3dAction = "summon-runaway-3d";
  summonBtn3D.textContent = "🔮 洛琪希被戳飞逃跑了 · 点击召唤回来";
  summonBtn3D.title = "把被连戳 100 下弹飞出去的像素洛琪希重新召唤回原画台角";
  dockBar.appendChild(summonBtn3D);

  const nameBtn = document.createElement("button");
  nameBtn.className = "atelier-roxy3d-name-btn";
  nameBtn.dataset.roxy3dAction = "name-trigger";
  nameBtn.textContent = isMinimized ? "✦ 洛琪希 [展开]" : "✦ 洛琪希";
  nameBtn.title = isMinimized ? "展开像素洛琪希手办框" : "点击切换下一条番剧咨讯";
  dockBar.appendChild(nameBtn);

  const ctrlGroup = document.createElement("div");
  ctrlGroup.className = "atelier-roxy3d-ctrl-group";
  dockBar.appendChild(ctrlGroup);

  const dockPrimaryBtn = document.createElement("button");
  dockPrimaryBtn.className = "atelier-roxy3d-ctrl-btn is-primary-reset";
  dockPrimaryBtn.dataset.roxy3dAction = "dock-restore-primary";
  dockPrimaryBtn.textContent = "首要";
  dockPrimaryBtn.title = "还原为三维原画档案室首要导览提示";
  ctrlGroup.appendChild(dockPrimaryBtn);

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
  bubbleBadge.textContent = "✦ 洛琪希 · 档案室导览";
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
  restorePrimaryBtn.title = "将气泡内容还原为三维原画档案室首要导览提示";
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
    const nextState = ROXY_PORTRAIT_FILES[record.state] ? record.state : "explain";
    widget.dataset.roxyState = nextState;

    if (pixelAvatar) {
      applyRoxy3DPixelPose(pixelAvatar, nextState);
    }

    trigger3DQBounce();

    if (record.message) {
      bubbleBadge.textContent = record.badgeText || `✦ 洛琪希 · ${STATE_LABELS[nextState] || "记录"}`;
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
    figureFrame.style.transform = "";
    coord.runaway3D = false;
    coord.isPinballFlying3D = false;
    coord.pokeStreak3D = 0;
    if (plugin.settings.roxy3DMinimized) {
      plugin.settings.roxy3DMinimized = false;
      plugin.saveSettings().catch(() => {});
    }
    widget.classList.remove("is-runaway", "is-minimized", "is-pinball-rampage-3d");
    widget.classList.add("is-expanded");
    nameBtn.textContent = "✦ 洛琪希";
    minBtn.textContent = "最小化";
    sync3DTopbarRoxyButton(plugin, space);
    emitRoxyEvent(plugin, buildRoxyRunawayComplaintRecord(coord));
  };

  summonBtn3D.onclick = summonRoxyBack3D;
  widget._summonRoxyBack3D = summonRoxyBack3D;

  const restoreTo3DPrimary = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (coord.runaway3D) {
      summonRoxyBack3D(e);
      return;
    }
    if (plugin.settings.roxy3DMinimized) {
      plugin.settings.roxy3DMinimized = false;
      plugin.saveSettings().catch(() => {});
      widget.classList.remove("is-minimized");
      widget.classList.add("is-expanded");
      nameBtn.textContent = "✦ 洛琪希";
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
      nameBtn.textContent = "✦ 洛琪希";
      minBtn.textContent = "最小化";
      restoreTo3DPrimary();
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
      coord.isPinballFlying3D = true;
      coord.currentState = "panic";
      widget.dataset.roxyState = "panic";
      if (pixelAvatar) {
        applyRoxy3DPixelPose(pixelAvatar, "panic");
      }
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
        isPrimary: false,
        stepHint: `咨讯 ${idx + 1}/${deck.length}`,
        autoHideMs: 7500
      })
    );
  };

  hitZone.onclick = handle3DCharacterClick;
  nameBtn.onclick = handle3DCharacterClick;

  minBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextMin = !plugin.settings.roxy3DMinimized;
    plugin.settings.roxy3DMinimized = nextMin;
    await plugin.saveSettings();
    widget.classList.toggle("is-minimized", nextMin);
    widget.classList.toggle("is-expanded", !nextMin);
    nameBtn.textContent = nextMin ? "✦ 洛琪希 [展开]" : "✦ 洛琪希";
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
    if (bubbleTimer3D) clearTimeout(bubbleTimer3D);
    if (typeof cancelPinballAnim3D === "function") {
      cancelPinballAnim3D();
      cancelPinballAnim3D = null;
    }
  };

  // 若序幕已结束（如 bootMode === "none" 或重新开启记录员），立即展示首要导览
  if (isRunaway3D) {
    hide3DBubble();
  } else if (space.spaceState !== "boot") {
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
 * 三维原画档案室 · 像素洛琪希桌角手办框样式（边缘低打扰、非交互区 pointer-events: none、单次 Q 弹、连戳×100乱弹消失彩蛋）
 */
function getRoxy3DMascotStyles() {
  return [
    "@keyframes roxy3d-q-bounce{0%{transform:scaleX(1) scaleY(1);}28%{transform:scaleX(1.075) scaleY(0.875);}60%{transform:scaleX(0.955) scaleY(1.052);}82%{transform:scaleX(1.018) scaleY(0.986);}100%{transform:scaleX(1) scaleY(1);}}",
    "@keyframes roxy3d-bubble-pop{0%{opacity:0;transform:translateX(-6px) scale(0.93);}70%{opacity:1;transform:translateX(2px) scale(1.012);}100%{opacity:1;transform:translateX(0) scale(1);}}",
    /* 左上角原画桌角位置，绝不进入封套核心画布中心，绝不遮挡详情栏、笔记纸页、底栏或 Hover 提示 */
    ".atelier-roxy3d-widget{position:absolute;left:clamp(24px,4vw,64px);top:clamp(78px,9.4vh,104px);z-index:32;pointer-events:none!important;display:flex;flex-direction:column;align-items:flex-start;gap:5px;user-select:none;transition:top .28s cubic-bezier(.16,1,.3,1),opacity .28s ease;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d{pointer-events:none!important;z-index:999!important;}",
    /* 高分精选模式下自动下移让出 .atelier-curation-banner 横幅空间 */
    ".bangumi-3d-root[data-lens-mode=\"highscore\"][data-space-state=\"array\"] .atelier-roxy3d-widget{top:clamp(118px,14vh,146px);}",
    /* 序幕动画期间隐藏，随主 UI 一同显现 */
    ".bangumi-3d-root[data-space-state=\"boot\"] .atelier-roxy3d-widget{opacity:0;pointer-events:none!important;}",
    ".atelier-roxy3d-main-row{display:flex;align-items:flex-start;gap:10px;pointer-events:none!important;}",
    /* 原画纸本手办小座框 */
    ".atelier-roxy3d-figure-frame{position:relative;width:66px;height:74px;border-radius:6px;border:1px solid rgba(155,114,71,0.48);background:linear-gradient(180deg,rgba(250,246,238,0.95) 0%,rgba(237,230,217,0.95) 100%);box-shadow:0 8px 20px rgba(24,26,22,0.09),inset 0 1px 0 rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;pointer-events:none!important;transform-origin:50% 50%;will-change:transform;}",
    ".atelier-roxy3d-widget.is-minimized .atelier-roxy3d-figure-frame,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-figure-frame,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-bubble,.atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-bubble{display:none!important;}",
    ".atelier-roxy3d-pin{position:absolute;width:3.5px;height:3.5px;border-radius:50%;background:#9b7247;opacity:0.75;pointer-events:none!important;}",
    ".atelier-roxy3d-pin.is-tl{top:4px;left:4px;}.atelier-roxy3d-pin.is-tr{top:4px;right:4px;}.atelier-roxy3d-pin.is-bl{bottom:13px;left:4px;}.atelier-roxy3d-pin.is-br{bottom:13px;right:4px;}",
    ".atelier-roxy3d-avatar-host{width:61px;height:69px;margin-top:-7px;display:flex;align-items:center;justify-content:center;transform-origin:50% 100%;pointer-events:none!important;will-change:transform;transition:transform .16s cubic-bezier(0.34,1.56,0.64,1);}",
    ".atelier-roxy3d-avatar-host *{pointer-events:none!important;}",
    ".atelier-roxy3d-avatar-host.roxy3d-pressing{transform:scaleX(1.07) scaleY(0.88)!important;transition:transform .09s ease-out!important;}",
    ".atelier-roxy3d-avatar-host.roxy3d-anim-qbounce{animation:roxy3d-q-bounce 0.42s cubic-bezier(0.34,1.56,0.64,1) 1 forwards;}",
    ".atelier-roxy3d-subplaque{position:absolute;left:0;right:0;bottom:0;height:12px;background:rgba(155,114,71,0.14);border-top:1px solid rgba(155,114,71,0.3);font-size:7.5px;font-weight:700;letter-spacing:0.08em;color:#7a5835;display:flex;align-items:center;justify-content:center;pointer-events:none!important;}",
    ".atelier-roxy3d-hit-zone{position:absolute;inset:0;border-radius:6px;pointer-events:auto!important;cursor:pointer;-webkit-tap-highlight-color:transparent;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-hit-zone{pointer-events:none!important;}",
    /* 底部紧凑控制条（弹飞时向下收起隐藏，绝不跟随飞行） */
    ".atelier-roxy3d-dock{pointer-events:auto!important;display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;border:1px solid rgba(155,114,71,0.42);background:rgba(246,242,234,0.96);box-shadow:0 4px 12px rgba(24,26,22,0.08);transition:transform 0.2s cubic-bezier(0.4,0,0.2,1),opacity 0.16s ease;}",
    ".atelier-roxy3d-widget.is-pinball-rampage-3d .atelier-roxy3d-dock{transform:translateY(20px) scale(0.9)!important;opacity:0!important;pointer-events:none!important;}",
    ".bangumi-3d-root button.atelier-roxy3d-summon-btn{display:none;cursor:pointer;padding:3px 9px;border:none;border-radius:4px;background:linear-gradient(135deg,#8f683d,#b8543d);color:#fffdf9;font-size:10.5px;font-weight:700;line-height:1.3;}",
    ".atelier-roxy3d-widget.is-runaway button.atelier-roxy3d-summon-btn{display:inline-flex!important;align-items:center;gap:4px;}",
    ".atelier-roxy3d-widget.is-runaway button.atelier-roxy3d-name-btn,.atelier-roxy3d-widget.is-runaway .atelier-roxy3d-ctrl-group{display:none!important;}",
    ".bangumi-3d-root button.atelier-roxy3d-name-btn{cursor:pointer;padding:1px 4px;border:none;background:transparent;font-size:10.5px;font-weight:700;color:#8f683d;line-height:1.2;}",
    ".bangumi-3d-root button.atelier-roxy3d-name-btn:hover{text-decoration:underline;}",
    ".atelier-roxy3d-ctrl-group{display:inline-flex;align-items:center;gap:2px;padding-left:3px;border-left:1px solid rgba(198,190,178,0.7);}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn{cursor:pointer;padding:1px 4px;border:none;border-radius:3px;background:transparent;font-size:10px;color:#6e685e;line-height:1.2;transition:all .12s ease;}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn:hover{background:rgba(155,114,71,0.12);color:#8f683d;}",
    ".bangumi-3d-root button.atelier-roxy3d-ctrl-btn.is-primary-reset{color:#8f683d;font-weight:600;}",
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
    ".atelier-roxy3d-bubble-badge.is-warn,.atelier-roxy3d-bubble-badge.is-panic{color:#b44c36;}",
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
    ".bangumi-3d-root button.atelier-roxy3d-topbar-btn.is-roxy3d-summon{border-bottom:1px solid #b44c36;color:#b44c36;font-weight:700;}"
  ].join("\n");
}

module.exports = {
  PRIORITY,
  ROXY_PORTRAIT_FILES,
  resolveRoxyAssetUrl,
  checkRoxyHdPortraitsStatus,
  downloadRoxyHdPortraitPack,
  ensureRoxyCoordinator,
  emitRoxyEvent,
  buildPrimaryDeskRecord,
  buildPrimary3DRecord,
  buildRoxyConsultationDeck,
  mountRoxy2DMascot,
  syncTopbarRoxyButton,
  getRoxy2DMascotStyles,
  mountRoxy3DMascot,
  sync3DTopbarRoxyButton,
  getRoxy3DMascotStyles
};
