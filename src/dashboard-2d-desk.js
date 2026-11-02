const fs = require("fs");
const { openLocalPathSafely, inspectLocalFolder } = require("./note-utils.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const animeDownloadService = require("./anime-download-service.js");
const reviewStudioService = require("./review-studio-service.js");
const characterArchiveService = require("./character-archive-service.js");

/**
 * 提取同系列作品的季数、OVA、剧场版、篇章或副标题区分信息，
 * 确保画廊封面模式与编目索引模式下同系列多作不会混淆或截断成相同前缀。
 */
function extractEditionInfo(item) {
  const rawName = String(item?.name || "").trim();
  if (!rawName) {
    return { mainTitle: "未命名作品", badge: "", subtitle: "" };
  }

  const badges = [];
  let subtitle = "";

  if (/剧场版|MOVIE|劇場版/i.test(rawName)) {
    badges.push("剧场版");
  }
  if (/\b(OVA|OAD|ONA|SP|总集篇|特別篇|特别篇)\b/i.test(rawName)) {
    const match = rawName.match(/\b(OVA|OAD|ONA|SP|总集篇|特別篇|特别篇)\b/i);
    if (match) badges.push(match[1].toUpperCase());
  }

  const seasonMatch = rawName.match(/第([一二三四五六七八九十\d]+)[季期部]|Season\s*(\d+)|Part\s*(\d+)/i);
  if (seasonMatch) {
    badges.push(seasonMatch[0]);
  }

  // 检测末尾 续 / 完 / S / R / II / 2 等续作标识
  const suffixMatch = rawName.match(/(?:\s+|[·・])(续|完|二期|三期|II|III|2|3)$/i);
  if (suffixMatch && !badges.length) {
    const token = suffixMatch[1];
    badges.push(token === "2" ? "第2作" : token === "3" ? "第3作" : `${token}`);
  } else if (/([\u4e00-\u9fa5])(S|R|2)$/.test(rawName) && !/8\.0$/.test(rawName) && !badges.length) {
    const tail = rawName.slice(-1);
    if (tail === "S" || tail === "R" || tail === "2") {
      badges.push(tail === "2" ? "第2作" : `续篇·${tail}`);
    }
  }

  // 提取波浪号 ～...～ 或连字符 -...- 中的副标题
  const waveMatch = rawName.match(/[～~]([^～~]+)[～~]/);
  if (waveMatch && waveMatch[1]) {
    subtitle = waveMatch[1].trim();
  } else {
    const dashMatch = rawName.match(/-([^-]{2,})-/);
    if (dashMatch && dashMatch[1]) {
      subtitle = dashMatch[1].trim();
    } else {
      // 空格分隔的篇章副标题（如“罗小黑战记 众生之门篇”、“小林家的龙女仆 怕寂寞的龙”）
      const parts = rawName.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        if (lastPart.length >= 2 && !/^(OVA|OAD|SP|第.+[季期]|Season\s*\d+|2|3|续|完)$/i.test(lastPart)) {
          subtitle = parts.slice(1).join(" ");
        }
      }
    }
  }

  const badge = badges.join(" · ");
  return {
    mainTitle: rawName,
    badge,
    subtitle: subtitle && subtitle !== badge ? subtitle : ""
  };
}

/**
 * 计算馆藏核心摘要指标（用于顶栏与年鉴摘要条）
 */
function computeDeskMetrics(items) {
  const list = Array.isArray(items) ? items : [];
  const stateCounts = {
    "在看": 0,
    "已看": 0,
    "想看": 0,
    "抛弃": 0,
    "未设置": 0
  };

  let totalWatchedEpisodes = 0;
  let totalPlannedEpisodes = 0;
  const personalScores = [];
  const bgmScores = [];
  const comparedDeltas = [];
  const years = [];
  const studioCounts = new Map();

  for (const item of list) {
    const st = item.state && Object.prototype.hasOwnProperty.call(stateCounts, item.state)
      ? item.state
      : "未设置";
    stateCounts[st] = (stateCounts[st] || 0) + 1;

    const watched = Number(item.watchedEpisodes) || 0;
    const total = Number(item.totalEpisodes) || 0;
    totalWatchedEpisodes += watched;
    if (total > 0) totalPlannedEpisodes += total;

    if (item.personalScore !== null && Number.isFinite(item.personalScore)) {
      personalScores.push(item.personalScore);
    }
    const bgm = item.preciseScore !== null && Number.isFinite(item.preciseScore)
      ? item.preciseScore
      : (item.publicScore !== null && item.publicScore !== undefined && Number.isFinite(item.publicScore)
        ? item.publicScore
        : (item.bangumiScore !== null && Number.isFinite(item.bangumiScore) ? item.bangumiScore : null));
    if (bgm !== null) {
      bgmScores.push(bgm);
    }
    if (item.personalScore !== null && bgm !== null) {
      comparedDeltas.push(item.personalScore - bgm);
    }

    const ym = String(item.year || "").match(/\b(19\d\d|20\d\d)\b/);
    if (ym) years.push(Number(ym[1]));

    if (item.studio) {
      const rawStudios = String(item.studio)
        .split(/[,;\/、&]+/)
        .map((s) => s.trim())
        .filter((s) => s && !/^(未知|无|暂无|-)$/i.test(s));
      for (const stName of rawStudios) {
        studioCounts.set(stName, (studioCounts.get(stName) || 0) + 1);
      }
    }
  }

  const personalAvg = personalScores.length
    ? (personalScores.reduce((a, b) => a + b, 0) / personalScores.length).toFixed(1)
    : "—";
  const bgmAvg = bgmScores.length
    ? (bgmScores.reduce((a, b) => a + b, 0) / bgmScores.length).toFixed(1)
    : "—";
  const avgDelta = comparedDeltas.length
    ? Number((comparedDeltas.reduce((a, b) => a + b, 0) / comparedDeltas.length).toFixed(2))
    : null;

  const hours = ((totalWatchedEpisodes * 24) / 60).toFixed(1);
  const completionRate = list.length > 0
    ? Math.round((stateCounts["已看"] / list.length) * 100)
    : 0;

  years.sort((a, b) => a - b);
  const yearRange = years.length
    ? (years[0] === years[years.length - 1] ? `${years[0]}年` : `${years[0]}–${years[years.length - 1]}`)
    : "暂无年份";

  let topStudio = "暂无记录";
  let topStudioName = "";
  let topStudioCount = 0;
  for (const [stName, cnt] of studioCounts.entries()) {
    if (cnt > topStudioCount) {
      topStudioCount = cnt;
      topStudioName = stName;
      topStudio = `${stName} (${cnt}部)`;
    }
  }

  const totalReviewsCount = list.reduce(
    (acc, it) => acc + (Array.isArray(it.reviews) ? it.reviews.length : 0),
    0
  );

  return {
    total: list.length,
    stateCounts,
    personalCount: personalScores.length,
    personalAvg,
    bgmAvg,
    avgDelta,
    totalWatchedEpisodes,
    totalPlannedEpisodes,
    hours,
    completionRate,
    yearRange,
    topStudio,
    topStudioName,
    topStudioCount,
    totalReviewsCount
  };
}

/**
 * 即时搜索匹配器：支持中文名、日文原名、Bangumi 编号、标签、制作公司、年份、番季或观片手札内容
 */
function matchesInstantSearch(item, rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase();
  if (!q) return true;

  const reviewCorpus = Array.isArray(item.reviews)
    ? item.reviews.map((r) => `${r.scope || ""} ${r.timestamp || ""} ${r.type || ""} ${r.text || ""}`).join(" ")
    : "";

  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = [
    item.name || "",
    item.japaneseName || "",
    item.subjectId ? `bgm${item.subjectId} #${item.subjectId} ${item.subjectId}` : "",
    item.tags || "",
    item.studio || "",
    item.director || "",
    item.animeType || "",
    item.year || "",
    item.season || "",
    `${item.year || ""}${item.season || ""}`,
    reviewCorpus
  ]
    .join(" ")
    .toLowerCase();

  return tokens.every((tok) => haystack.includes(tok));
}

/**
 * 排序目录条目
 */
function sortCatalogItems(items, sortBy = "year_desc") {
  const list = [...items];
  switch (sortBy) {
    case "myScore_desc":
      list.sort((a, b) => {
        const sa = a.personalScore !== null ? a.personalScore : -1;
        const sb = b.personalScore !== null ? b.personalScore : -1;
        if (sb !== sa) return sb - sa;
        const ba = a.preciseScore ?? a.publicScore ?? a.bangumiScore ?? -1;
        const bb = b.preciseScore ?? b.publicScore ?? b.bangumiScore ?? -1;
        if (bb !== ba) return bb - ba;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
    case "bgmScore_desc":
      list.sort((a, b) => {
        const sa = a.preciseScore ?? a.publicScore ?? a.bangumiScore ?? -1;
        const sb = b.preciseScore ?? b.publicScore ?? b.bangumiScore ?? -1;
        if (sb !== sa) return sb - sa;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
    case "progress_desc":
      list.sort((a, b) => {
        const wa = Number(a.watchedEpisodes) || 0;
        const wb = Number(b.watchedEpisodes) || 0;
        if (wb !== wa) return wb - wa;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
    case "title_asc":
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      break;
    case "year_desc":
    default:
      list.sort((a, b) => {
        const ya = parseInt(a.year, 10) || 0;
        const yb = parseInt(b.year, 10) || 0;
        if (yb !== ya) return yb - ya;
        const sea = String(a.season || "");
        const seb = String(b.season || "");
        if (seb !== sea) return seb.localeCompare(sea, "zh-CN");
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
  }
  return list;
}

/**
 * 获取或初始化容器上的编目台状态（保证局部更新与筛选切换时状态持久）
 */
function ensureDeskState(plugin, container, options = {}) {
  if (!container._deskState) {
    const saved = plugin.settings?.curatorDeskState || {};
    container._deskState = {
      workspaceMode:
        saved.workspaceMode === "desk" ||
        saved.workspaceMode === "catalog" ||
        saved.workspaceMode === "character"
          ? saved.workspaceMode
          : "auto", // "auto" | "desk" | "catalog" | "character"
      workspaceModeCustomized: Boolean(saved.workspaceModeCustomized),
      roxyGrimoireDismissed: Boolean(
        plugin.settings?.roxyGrimoireDismissed ?? saved.roxyGrimoireDismissed
      ),
      searchQuery: "",
      statusFilter: "all", // "all" | "在看" | "已看" | "想看" | "抛弃" | "shelf:<id>" | "query:<id>"
      sortBy: saved.sortBy || "year_desc",
      viewMode: saved.viewMode || "gallery", // "gallery" | "index"
      deskTab: saved.deskTab || "auto", // "auto" | "watching" | "recent" | "season:<year>:<season>"
      deskLayoutMode: plugin.settings?.deskLayoutMode || saved.deskLayoutMode || "scroll", // "scroll" | "grid"
      catalogExpanded: false,
      rankTab: plugin.settings?.dashboardScoreRankTab || saved.rankTab || "personal",
      rankLimit:
        Number(plugin.settings?.dashboardScoreRankLimit) ||
        Number(plugin.settings?.dashboardPersonalRankLimit) ||
        10,
      almanacExpanded: Boolean(saved.almanacExpanded),
      items: [],
      options: options || {},
      fullRenderCount: 0,
      incrementalUpdateCount: 0
    };
  }
  if (options && Object.keys(options).length > 0) {
    container._deskState.options = options;
  }
  return container._deskState;
}

function persistDeskPrefs(plugin, state) {
  if (!plugin || !plugin.settings) return;
  plugin.settings.deskLayoutMode = state.deskLayoutMode || "scroll";
  plugin.settings.dashboardScoreRankTab = state.rankTab || "personal";
  plugin.settings.roxyGrimoireDismissed = Boolean(state.roxyGrimoireDismissed);
  plugin.settings.curatorDeskState = {
    workspaceMode: state.workspaceMode || "auto",
    workspaceModeCustomized: Boolean(state.workspaceModeCustomized),
    roxyGrimoireDismissed: Boolean(state.roxyGrimoireDismissed),
    sortBy: state.sortBy,
    viewMode: state.viewMode,
    deskTab: state.deskTab,
    deskLayoutMode: state.deskLayoutMode || "scroll",
    rankTab: state.rankTab || "personal",
    almanacExpanded: state.almanacExpanded
  };
  plugin.saveSettings().catch(() => {});
}

/**
 * 计算真正基于「本地视频文件夹剧集变化」的最近更新列表：
 * - 严格过滤：必须配置了有效下载路径（非“无”且本地文件夹真实存在），且文件夹内包含视频文件（或笔记明确记录“已更新 X 集”）
 * - 本地根本没建文件夹的老番、或已看完且无新集的老番绝不混入！
 */
function computeLocalUpdatedItems(items) {
  const list = Array.isArray(items) ? items : [];
  const candidates = [];

  for (const item of list) {
    const rawPath = String(item?.downloadPath || "").trim();
    if (!rawPath || rawPath === "无") {
      item._localInspect = null;
      continue;
    }

    const localRes = inspectLocalFolder(rawPath, item.watchedEpisodes);
    if (!localRes || localRes.error) {
      item._localInspect = localRes || null;
      continue;
    }

    const statusMatch = String(item.localUpdateStatus || "").match(/已更新\s*(\d+)\s*集/);
    const explicitNewCount = statusMatch ? Number(statusMatch[1]) : 0;
    const effectiveNewCount = Math.max(Number(localRes.newCount) || 0, explicitNewCount);

    // 文件夹内无视频文件且无未看更新集数 -> 排除
    if (localRes.fileCount <= 0 && effectiveNewCount <= 0) {
      item._localInspect = localRes;
      continue;
    }

    // 已看完的老番且没有多出未看新集 -> 排除
    if (item.state === "已看" && effectiveNewCount <= 0) {
      item._localInspect = localRes;
      continue;
    }

    let latestVideoMtime = 0;
    if (Array.isArray(localRes.videoFiles)) {
      for (const vf of localRes.videoFiles) {
        try {
          const st = fs.statSync(vf.path);
          if (st && st.mtimeMs > latestVideoMtime) {
            latestVideoMtime = st.mtimeMs;
          }
        } catch (e) {}
      }
    }

    item._localInspect = {
      ...localRes,
      newCount: effectiveNewCount,
      latestVideoMtime
    };
    candidates.push(item);
  }

  candidates.sort((a, b) => {
    const na = a._localInspect?.newCount || 0;
    const nb = b._localInspect?.newCount || 0;
    // 1. 有未看新集 (newCount > 0) 的作品优先排在最前
    if ((nb > 0) !== (na > 0)) {
      return nb > 0 ? 1 : -1;
    }
    // 2. 按本地最新视频文件的下载/写入时间降序
    const ta = a._localInspect?.latestVideoMtime || 0;
    const tb = b._localInspect?.latestVideoMtime || 0;
    if (tb !== ta) return tb - ta;
    // 3. 按未看新集数量降序
    if (nb !== na) return nb - na;
    // 4. 按本地视频总集数降序
    return (b._localInspect?.fileCount || 0) - (a._localInspect?.fileCount || 0);
  });

  return candidates;
}

/**
 * 扫描馆藏中所有已存在的「年份 + 季度」组合（按年份与季度从新到旧排序）
 */
function getSeasonSortOrderValue(seasonStr) {
  const s = String(seasonStr || "");
  if (/10|秋/.test(s)) return 4;
  if (/0?7|夏/.test(s)) return 3;
  if (/0?4|春/.test(s)) return 2;
  if (/0?1|冬/.test(s)) return 1;
  return 0;
}

function getSeasonIcon(seasonStr) {
  const s = String(seasonStr || "");
  if (/10|秋/.test(s)) return "🍁";
  if (/0?7|夏/.test(s)) return "☀️";
  if (/0?4|春/.test(s)) return "🌸";
  if (/0?1|冬/.test(s)) return "❄️";
  return "📅";
}

function collectAvailableSeasons(items) {
  const map = new Map();
  for (const it of items || []) {
    const year = String(it.year || "").trim();
    const season = String(it.season || "").trim();
    if (!year || !season) continue;
    const key = `${year}:${season}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        year,
        season,
        label: `${year}年${season}`,
        count: 0,
        watchingCount: 0,
        planCount: 0
      });
    }
    const entry = map.get(key);
    entry.count++;
    if (it.state === "在看") entry.watchingCount++;
    if (it.state === "想看") entry.planCount++;
  }

  return Array.from(map.values()).sort((a, b) => {
    const ya = parseInt(a.year, 10) || 0;
    const yb = parseInt(b.year, 10) || 0;
    if (yb !== ya) return yb - ya;
    return getSeasonSortOrderValue(b.season) - getSeasonSortOrderValue(a.season);
  });
}

function normalizePinnedSeasonEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const raw = entry.trim().replace(/^season:/i, "");
    const colonMatch = raw.match(/^(\d{4})[:\-/]\s*(.+)$/);
    if (colonMatch) {
      const year = colonMatch[1].trim();
      const season = colonMatch[2].trim();
      return {
        id: `season:${year}:${season}`,
        year,
        season,
        label: `${year}年${season}`,
        filterState: "all"
      };
    }
    const yearMatch = raw.match(/^(\d{4})\s*年?\s*(.+)$/);
    if (yearMatch) {
      const year = yearMatch[1].trim();
      const season = yearMatch[2].trim();
      return {
        id: `season:${year}:${season}`,
        year,
        season,
        label: `${year}年${season}`,
        filterState: "all"
      };
    }
    return null;
  }
  if (typeof entry === "object") {
    const year = String(entry.year || "").trim();
    const season = String(entry.season || "").trim();
    if (!year || !season) return null;
    return {
      id: entry.id && typeof entry.id === "string" ? entry.id : `season:${year}:${season}`,
      year,
      season,
      label: entry.label || `${year}年${season}`,
      filterState: entry.filterState || "all"
    };
  }
  return null;
}

/**
 * 获取当前案头追番席固定的「自定义季度席位」列表：
 * - 若用户尚未手动配置过，默认自动置入馆藏中最新的 1 个季度（如 2026年10月新番），方便追番党开箱即用；
 * - 用户可通过「+ 季度席位」按钮或插件设置自由增删、调整任意多个季度。
 */
function getEffectivePinnedSeasons(plugin, items) {
  if (!plugin || !plugin.settings) return [];
  if (Array.isArray(plugin.settings.deskPinnedSeasons)) {
    const normalized = plugin.settings.deskPinnedSeasons
      .map(normalizePinnedSeasonEntry)
      .filter(Boolean);
    if (plugin.settings.deskPinnedSeasonsCustomized || normalized.length > 0) {
      return normalized;
    }
  }
  const available = collectAvailableSeasons(items);
  if (available.length > 0) {
    const latest = available[0];
    return [
      {
        id: `season:${latest.year}:${latest.season}`,
        year: latest.year,
        season: latest.season,
        label: `${latest.year}年${latest.season}`,
        filterState: "all"
      }
    ];
  }
  return [];
}

function filterItemsForPinnedSeason(items, seasonCfg) {
  if (!seasonCfg) return [];
  const y = String(seasonCfg.year || "").trim();
  const s = String(seasonCfg.season || "").trim();
  const filterState = seasonCfg.filterState || "all";

  return (items || []).filter((it) => {
    if (String(it.year || "").trim() !== y) return false;
    if (String(it.season || "").trim() !== s) return false;
    if (filterState === "watching") return it.state === "在看";
    if (filterState === "active") return it.state === "在看" || it.state === "想看";
    return true;
  });
}

/**
 * 打开「案头追番席 · 多季度收藏席位与显示配置」弹窗
 */
function openDeskSeasonManagerModal(plugin, items, onSaved) {
  const ModalClass = globalThis.__BangumiManagerModal;
  const NoticeClass = globalThis.__BangumiManagerNotice;
  if (!ModalClass) return null;

  class DeskSeasonManagerModal extends ModalClass {
    constructor(app) {
      super(app);
      this.plugin = plugin;
      this.items = items || [];
      this.onSaved = onSaved;
      this.pinned = JSON.parse(
        JSON.stringify(getEffectivePinnedSeasons(plugin, this.items))
      );
      this.layoutMode = plugin.settings?.deskLayoutMode || "scroll";
      this.displayLimit = Number(plugin.settings?.deskDisplayLimit) || 0;
    }

    onOpen() {
      this.modalEl.style.width = "min(740px, 92vw)";
      this.modalEl.style.maxWidth = "92vw";
      this.render();
    }

    onClose() {
      this.contentEl.empty();
    }

    isSeasonPinned(year, season) {
      return this.pinned.some(
        (p) => String(p.year) === String(year) && String(p.season) === String(season)
      );
    }

    addSeason(year, season, filterState = "all") {
      const y = String(year || "").trim();
      const s = String(season || "").trim();
      if (!y || !s) return;
      if (this.isSeasonPinned(y, s)) return;
      this.pinned.push({
        id: `season:${y}:${s}`,
        year: y,
        season: s,
        label: `${y}年${s}`,
        filterState
      });
    }

    render() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-season-mgr-modal");

      contentEl.createEl("h2", {
        text: "案头追番席 · 多季度席位与滑动显示设置"
      });
      contentEl.createEl("p", {
        cls: "curator-season-mgr-desc",
        text: "您可以自由将多个指定番季（如 2026年10月新番、2026年07月新番、往期补番季等）固定到「案头追番席」顶栏，并调整横向左右滑动或网格展开模式。"
      });

      // 1. 显示模式与数量上限
      const prefSection = contentEl.createDiv("curator-season-mgr-box");
      prefSection.createDiv({
        cls: "curator-season-mgr-subtitle",
        text: "一、案头追番席浏览模式与显示上限"
      });

      const prefRow = prefSection.createDiv("curator-season-mgr-pref-row");
      const layoutLabel = prefRow.createEl("label", { cls: "curator-season-mgr-field" });
      layoutLabel.createSpan({ text: "卡片排列方式：" });
      const layoutSelect = layoutLabel.createEl("select");
      [
        { val: "scroll", text: "⇄ 横向画轴左右滑动（支持滚轮与翻页箭头，推荐）" },
        { val: "grid", text: "⊞ 多行网格平铺展开（一次展示全部卡片）" }
      ].forEach((opt) => {
        const o = layoutSelect.createEl("option", { value: opt.val, text: opt.text });
        if (opt.val === this.layoutMode) o.selected = true;
      });
      layoutSelect.onchange = () => {
        this.layoutMode = layoutSelect.value;
      };

      const limitLabel = prefRow.createEl("label", { cls: "curator-season-mgr-field" });
      limitLabel.createSpan({ text: "单席位显示上限（0 = 不限数量）：" });
      const limitInput = limitLabel.createEl("input", {
        type: "number",
        value: String(this.displayLimit)
      });
      limitInput.min = "0";
      limitInput.max = "200";
      limitInput.style.width = "84px";
      limitInput.onchange = () => {
        this.displayLimit = Math.max(0, parseInt(limitInput.value, 10) || 0);
      };

      // 2. 当前已固定的季度席位列表（支持排序、筛选范围切换、移除）
      const pinnedSection = contentEl.createDiv("curator-season-mgr-box");
      pinnedSection.createDiv({
        cls: "curator-season-mgr-subtitle",
        text: `二、已固定在案头追番席的番季标签（当前 ${this.pinned.length} 个）`
      });

      if (this.pinned.length === 0) {
        pinnedSection.createDiv({
          cls: "curator-season-mgr-empty",
          text: "当前未固定任何季度标签，可从下方馆藏季度中勾选或手动输入添加。"
        });
      } else {
        const pinnedList = pinnedSection.createDiv("curator-season-mgr-list");
        this.pinned.forEach((p, idx) => {
          const matchedCount = filterItemsForPinnedSeason(this.items, p).length;
          const row = pinnedList.createDiv("curator-season-mgr-row");
          row.createSpan({
            cls: "curator-season-mgr-name",
            text: `${getSeasonIcon(p.season)} ${p.year}年${p.season}（当前匹配 ${matchedCount} 部）`
          });

          const filterSel = row.createEl("select", { cls: "curator-season-mgr-filter" });
          [
            { val: "all", text: "显示该季全部收藏" },
            { val: "active", text: "仅显示在看 + 想看" },
            { val: "watching", text: "仅显示正在追番" }
          ].forEach((opt) => {
            const o = filterSel.createEl("option", { value: opt.val, text: opt.text });
            if ((p.filterState || "all") === opt.val) o.selected = true;
          });
          filterSel.onchange = () => {
            p.filterState = filterSel.value;
            this.render();
          };

          const rowBtns = row.createDiv("curator-season-mgr-row-btns");
          const upBtn = rowBtns.createEl("button", { text: "↑", cls: "curator-dl-mini-btn" });
          upBtn.disabled = idx === 0;
          upBtn.onclick = () => {
            if (idx > 0) {
              const tmp = this.pinned[idx - 1];
              this.pinned[idx - 1] = this.pinned[idx];
              this.pinned[idx] = tmp;
              this.render();
            }
          };

          const downBtn = rowBtns.createEl("button", { text: "↓", cls: "curator-dl-mini-btn" });
          downBtn.disabled = idx === this.pinned.length - 1;
          downBtn.onclick = () => {
            if (idx < this.pinned.length - 1) {
              const tmp = this.pinned[idx + 1];
              this.pinned[idx + 1] = this.pinned[idx];
              this.pinned[idx] = tmp;
              this.render();
            }
          };

          const delBtn = rowBtns.createEl("button", { text: "移除 ×", cls: "curator-dl-mini-btn" });
          delBtn.onclick = () => {
            this.pinned.splice(idx, 1);
            this.render();
          };
        });
      }

      // 3. 从馆藏已有番季中一键勾选添加 + 手动自定义添加任意年份季度
      const availSection = contentEl.createDiv("curator-season-mgr-box");
      availSection.createDiv({
        cls: "curator-season-mgr-subtitle",
        text: "三、从馆藏已有番季中快速勾选 / 手动添加指定季度"
      });

      const available = collectAvailableSeasons(this.items);
      if (available.length > 0) {
        const chipsWrap = availSection.createDiv("curator-season-mgr-chips");
        for (const av of available) {
          const pinned = this.isSeasonPinned(av.year, av.season);
          const chip = chipsWrap.createEl("button", {
            cls: `curator-season-mgr-chip ${pinned ? "is-pinned" : ""}`,
            text: `${pinned ? "✓ " : "+ "}${av.year}年${av.season} (${av.count}部)`
          });
          chip.onclick = () => {
            if (pinned) {
              this.pinned = this.pinned.filter(
                (p) => !(String(p.year) === String(av.year) && String(p.season) === String(av.season))
              );
            } else {
              this.addSeason(av.year, av.season, "all");
            }
            this.render();
          };
        }
      }

      const customAddRow = availSection.createDiv("curator-season-mgr-custom-row");
      const yearInput = customAddRow.createEl("input", {
        type: "text",
        placeholder: "年份 (如 2026)",
        value: String(new Date().getFullYear())
      });
      yearInput.style.width = "110px";

      const seasonSelect = customAddRow.createEl("select");
      ["01月新番", "04月新番", "07月新番", "10月新番"].forEach((s) => {
        seasonSelect.createEl("option", { value: s, text: s });
      });
      seasonSelect.value = "10月新番";

      const addCustomBtn = customAddRow.createEl("button", {
        cls: "curator-dl-btn",
        text: "+ 添加指定季度到追番席"
      });
      addCustomBtn.onclick = () => {
        const y = yearInput.value.trim().replace(/年$/, "");
        const s = seasonSelect.value;
        if (!/^\d{4}$/.test(y)) {
          if (NoticeClass) new NoticeClass("请输入 4 位数字年份（如 2026）");
          return;
        }
        this.addSeason(y, s, "all");
        this.render();
      };

      // 4. 底部保存与取消
      const footer = contentEl.createDiv("curator-season-mgr-footer");
      const cancelBtn = footer.createEl("button", {
        cls: "curator-dl-btn",
        text: "取消"
      });
      cancelBtn.onclick = () => this.close();

      const saveBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-primary",
        text: "保存追番席设置"
      });
      saveBtn.onclick = async () => {
        this.plugin.settings.deskPinnedSeasons = this.pinned;
        this.plugin.settings.deskPinnedSeasonsCustomized = true;
        this.plugin.settings.deskLayoutMode = this.layoutMode;
        this.plugin.settings.deskDisplayLimit = this.displayLimit;
        await this.plugin.saveSettings();
        if (NoticeClass) {
          new NoticeClass(`已保存案头追番席配置（已固定 ${this.pinned.length} 个季度席位）`);
        }
        this.close();
        if (typeof this.onSaved === "function") {
          this.onSaved({
            layoutMode: this.layoutMode,
            displayLimit: this.displayLimit,
            pinned: this.pinned
          });
        }
      };
    }
  }

  const modal = new DeskSeasonManagerModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 渲染案头追番席（首屏核心高频工作区：专注「正在追番」、「本地更新」与「自定义季度席位」，消除与馆藏编目总览的状态筛选重复）
 */
function renderActiveDeskSection(plugin, deskMount, state, helpers) {
  deskMount.empty();
  const items = state.items || [];
  const watchingItems = sortCatalogItems(
    items.filter((it) => it.state === "在看"),
    "progress_desc"
  );
  const completedItems = sortCatalogItems(
    items.filter((it) => it.state === "已看"),
    "myScore_desc"
  );
  const planItems = sortCatalogItems(
    items.filter((it) => it.state === "想看"),
    "bgmScore_desc"
  );
  // 真正基于本地视频文件夹剧集变化的「本地更新」列表（绝不混入无本地文件夹的完结老番）
  const recentItems = computeLocalUpdatedItems(items);
  const pinnedSeasons = getEffectivePinnedSeasons(plugin, items);

  const hasWatching = watchingItems.length > 0;
  let activeTab = typeof state.deskTab === "string" ? state.deskTab : "auto";
  const validSeasonTab =
    activeTab &&
    activeTab.startsWith("season:") &&
    pinnedSeasons.some((p) => p.id === activeTab);

  // 兼容旧存档：移除冗余的 plan / completed 标签后自动归一化至高频追番席位
  if (
    !activeTab ||
    activeTab === "auto" ||
    activeTab === "plan" ||
    activeTab === "completed" ||
    (activeTab.startsWith("season:") && !validSeasonTab)
  ) {
    if (hasWatching) {
      activeTab = "watching";
    } else if (recentItems.length > 0) {
      activeTab = "recent";
    } else if (pinnedSeasons.length > 0 && pinnedSeasons[0]?.id) {
      activeTab = pinnedSeasons[0].id;
    } else {
      activeTab = "watching";
    }
    state.deskTab = activeTab;
  }

  const layoutMode = state.deskLayoutMode || plugin.settings?.deskLayoutMode || "scroll";
  const displayLimit = Math.max(0, Number(plugin.settings?.deskDisplayLimit) || 0);

  const header = deskMount.createDiv("curator-section-header curator-desk-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "案头追番席" });
  titleWrap.createSpan({
    cls: `curator-section-badge ${hasWatching ? "is-watching-active" : "is-standby-mode"}`,
    text: hasWatching
      ? `连载跟进 ${watchingItems.length} 部`
      : recentItems.length > 0
      ? `本地待看新更 ${recentItems.length} 部`
      : "待命候补席 · 暂无在看"
  });

  const controlsWrap = header.createDiv("curator-desk-controls-wrap");
  const tabs = controlsWrap.createDiv("curator-desk-tabs");
  const tabDefs = [
    { id: "watching", label: `正在追番 (${watchingItems.length})`, title: "当前观看状态为「在看」的连载跟进作品" },
    {
      id: "recent",
      label: `📁 本地更新 (${recentItems.length})`,
      title: "仅展示本地视频文件夹内有剧集更新（本地视频集数 > 已看集数，或近期下载了新视频）的作品，完结老番或未建文件夹作品不会混入"
    }
  ];

  // 追加用户自定义的多个季度收藏席位
  for (const seasonCfg of pinnedSeasons) {
    const sItems = filterItemsForPinnedSeason(items, seasonCfg);
    tabDefs.push({
      id: seasonCfg.id,
      label: `${getSeasonIcon(seasonCfg.season)} ${seasonCfg.label} (${sItems.length})`,
      title: `自定义季度追番席：${seasonCfg.label}（点击右侧「+ 季度席位」可自由增删季度）`,
      isSeasonTab: true
    });
  }

  tabDefs.forEach((td) => {
    const btn = tabs.createEl("button", {
      cls: `curator-desk-tab-btn ${activeTab === td.id ? "is-active" : ""} ${td.isSeasonTab ? "is-season-tab" : ""}`,
      text: td.label
    });
    btn.dataset.deskTab = td.id;
    if (td.title) btn.title = td.title;
    btn.onclick = (e) => {
      e.preventDefault();
      state.deskTab = td.id;
      persistDeskPrefs(plugin, state);
      renderActiveDeskSection(plugin, deskMount, state, helpers);
    };
  });

  // 「+ 季度席位」配置按钮
  const addSeasonBtn = tabs.createEl("button", {
    cls: "curator-desk-tab-btn is-manage-seasons",
    text: "+ 季度席位"
  });
  addSeasonBtn.dataset.deskAction = "manage-seasons";
  addSeasonBtn.title = "自由添加/管理多个季度的收藏动画席位，或调整案头追番席显示上限";
  addSeasonBtn.onclick = (e) => {
    e.preventDefault();
    openDeskSeasonManagerModal(plugin, items, ({ layoutMode: newMode }) => {
      state.deskLayoutMode = newMode || plugin.settings.deskLayoutMode || "scroll";
      renderActiveDeskSection(plugin, deskMount, state, helpers);
    });
  };

  // 右侧：左右滑动箭头 + 横向滑动/网格展开切换器
  const navBar = controlsWrap.createDiv("curator-desk-nav-bar");
  const scrollLeftBtn = navBar.createEl("button", {
    cls: "curator-desk-scroll-btn",
    text: "‹"
  });
  scrollLeftBtn.dataset.deskAction = "scroll-left";
  scrollLeftBtn.title = "向左滑动案头席位";

  const scrollRightBtn = navBar.createEl("button", {
    cls: "curator-desk-scroll-btn",
    text: "›"
  });
  scrollRightBtn.dataset.deskAction = "scroll-right";
  scrollRightBtn.title = "向右滑动案头席位";

  const toggleLayoutBtn = navBar.createEl("button", {
    cls: "curator-desk-layout-btn",
    text: layoutMode === "scroll" ? "⇄ 横向滑动" : "⊞ 展开网格"
  });
  toggleLayoutBtn.dataset.deskAction = "toggle-layout";
  toggleLayoutBtn.title =
    layoutMode === "scroll"
      ? "当前为横向左右滑动模式（支持鼠标滚轮与 ‹ › 按钮），点击切换为多行网格全部展开"
      : "当前为多行网格展开模式，点击切换为横向左右滑动模式";
  toggleLayoutBtn.onclick = (e) => {
    e.preventDefault();
    state.deskLayoutMode = layoutMode === "scroll" ? "grid" : "scroll";
    persistDeskPrefs(plugin, state);
    renderActiveDeskSection(plugin, deskMount, state, helpers);
  };

  // 当没有正在追番作品且处于 watching 页时，给出轻量紧凑的案头待命提示条
  if (!hasWatching && activeTab === "watching") {
    const fallbackBanner = deskMount.createDiv("curator-desk-fallback-banner");
    const noticeLeft = fallbackBanner.createDiv("curator-desk-fallback-text");
    noticeLeft.createSpan({
      cls: "curator-fallback-dot",
      text: "✦"
    });
    noticeLeft.createSpan({
      text: "当前案头暂无「在看」作品。以下为您展示待命候补案卷（可左右滑动浏览全部），点击「▶ 置入在看」即可开启连载追踪，或切换至「🗂️ 馆藏编目总览」检索全部馆藏。"
    });
    const fallbackActions = fallbackBanner.createDiv("curator-desk-fallback-actions");
    if (pinnedSeasons.length > 0) {
      const switchBtn = fallbackActions.createEl("button", {
        cls: "curator-mini-btn is-accent",
        text: `查看 ${pinnedSeasons[0].label} →`
      });
      switchBtn.onclick = () => {
        state.deskTab = pinnedSeasons[0].id;
        renderActiveDeskSection(plugin, deskMount, state, helpers);
      };
    }
    if (typeof helpers?.switchWorkspaceMode === "function") {
      const toCatalogBtn = fallbackActions.createEl("button", {
        cls: "curator-mini-btn",
        text: "🗂️ 前往馆藏编目总览 →"
      });
      toCatalogBtn.onclick = () => {
        helpers.switchWorkspaceMode("catalog", { statusFilter: planItems.length > 0 ? "想看" : "all" });
      };
    }
  }

  let rawList = [];
  let activeSeasonCfg = null;
  if (activeTab === "watching") {
    if (hasWatching) {
      rawList = watchingItems;
    } else {
      const merged = [...planItems, ...completedItems];
      const seen = new Set();
      for (const it of merged) {
        const key = it.file?.path || it.name;
        if (!seen.has(key)) {
          seen.add(key);
          rawList.push(it);
        }
      }
    }
  } else if (activeTab === "recent") {
    rawList = recentItems;
  } else if (activeTab.startsWith("season:")) {
    activeSeasonCfg = pinnedSeasons.find((p) => p.id === activeTab);
    rawList = sortCatalogItems(filterItemsForPinnedSeason(items, activeSeasonCfg), "bgmScore_desc");
  }

  const displayList = displayLimit > 0 ? rawList.slice(0, displayLimit) : rawList;

  if (displayList.length === 0) {
    scrollLeftBtn.style.display = "none";
    scrollRightBtn.style.display = "none";
    const emptyDesk = deskMount.createDiv("curator-empty-box");
    if (activeTab === "recent") {
      emptyDesk.createDiv({
        cls: "curator-empty-title",
        text: "当前暂无本地新增剧集的动画（未建本地文件夹或已完结老番不会混入此处）"
      });
      emptyDesk.createDiv({
        cls: "curator-empty-sub",
        text: "「本地更新」仅由动画本地文件夹（下载路径）中的真实视频集数决定：当本地视频集数 > 已观看集数，或本地目录内新放入视频文件时会自动出现在此席位。"
      });
      const emptyActions = emptyDesk.createDiv("curator-empty-actions");
      const scanNowBtn = emptyActions.createEl("button", {
        cls: "curator-mini-btn is-accent",
        text: "🔄 立即扫描全部本地视频文件夹"
      });
      scanNowBtn.onclick = async () => {
        await plugin.checkAllLocalStatus(true);
        await plugin.refreshOpenDashboardViews();
      };
    } else if (activeSeasonCfg) {
      emptyDesk.createDiv({
        cls: "curator-empty-title",
        text: `「${activeSeasonCfg.label}」下暂无符合条件的动画档案`
      });
      emptyDesk.createDiv({
        cls: "curator-empty-sub",
        text: "可通过「导入单个/批量动画」补充该季度番剧，或点击「+ 季度席位」切换筛选范围。"
      });
    } else {
      emptyDesk.createDiv({
        cls: "curator-empty-title",
        text: "案头席位暂无可展示的动画档案"
      });
      emptyDesk.createDiv({
        cls: "curator-empty-sub",
        text: "可通过命令面板导入动画笔记，或切换至「🗂️ 馆藏编目总览」调整作品观看状态。"
      });
    }
    return;
  }

  const isFullWatchingMode =
    (activeTab === "watching" && hasWatching) ||
    activeTab === "recent" ||
    Boolean(activeSeasonCfg);

  const deskGrid = deskMount.createDiv(
    `curator-desk-grid ${isFullWatchingMode ? "is-watching-grid" : "is-standby-grid"} ${
      layoutMode === "scroll" ? "is-horizontal-scroll" : "is-grid-expanded"
    }`
  );

  for (const item of displayList) {
    // 在「正在追番」、「本地更新」或「自定义季度席位」中，支持完整集数控制与下载操作
    const useStandbyCard =
      !isFullWatchingMode && item.state !== "在看" && activeTab !== "recent" && !activeSeasonCfg;
    renderDeskCard(plugin, deskGrid, item, state, helpers, {
      isStandby: useStandbyCard
    });
  }

  // 绑定横向滑动控制与滚轮转化
  if (layoutMode === "scroll") {
    const scrollStep = () => Math.max(320, Math.round(deskGrid.clientWidth * 0.72));
    scrollLeftBtn.onclick = (e) => {
      e.preventDefault();
      deskGrid.scrollBy({ left: -scrollStep(), behavior: "smooth" });
    };
    scrollRightBtn.onclick = (e) => {
      e.preventDefault();
      deskGrid.scrollBy({ left: scrollStep(), behavior: "smooth" });
    };
    deskGrid.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && deskGrid.scrollWidth > deskGrid.clientWidth + 4) {
          const atLeft = deskGrid.scrollLeft <= 0 && e.deltaY < 0;
          const atRight =
            deskGrid.scrollLeft + deskGrid.clientWidth >= deskGrid.scrollWidth - 2 && e.deltaY > 0;
          if (!atLeft && !atRight) {
            e.preventDefault();
            deskGrid.scrollLeft += e.deltaY;
          }
        }
      },
      { passive: false }
    );
  } else {
    scrollLeftBtn.style.display = "none";
    scrollRightBtn.style.display = "none";
  }
}

/**
 * 渲染案头卡片上的「观片手札微气泡摘要条」：
 * - 有手札时：展示最新一条吐槽/评价/时间点占位锚点 + 点击时间点直接打开本地播放器定位 + 点击主体打开观片手札工作台
 * - 无手札时：提供零摩擦的「💬 记一笔吐槽 / 打个时间点锚点…」极速入口
 */
function renderCardReviewMicroStrip(plugin, body, item, state, helpers, isStandby = false) {
  const reviews = Array.isArray(item.reviews) ? item.reviews : [];
  const strip = body.createDiv(
    `curator-desk-review-strip ${reviews.length > 0 ? "has-reviews" : "is-empty"} ${
      isStandby ? "is-standby-strip" : ""
    }`
  );
  strip.dataset.deskAction = "open-reviews-strip";

  const openStudio = (e) => {
    e.preventDefault();
    e.stopPropagation();
    reviewStudioService.openAnimeReviewStudioModal(plugin, item, {
      onUpdated: () => {
        if (helpers?.deskMount) renderActiveDeskSection(plugin, helpers.deskMount, state, helpers);
        if (helpers?.catalogMount) renderCatalogSection(plugin, helpers.catalogMount, state, helpers);
      }
    });
  };

  if (reviews.length === 0) {
    strip.createSpan({
      cls: "curator-desk-review-empty-prompt",
      text: isStandby ? "💬 记一笔观片手札…" : "💬 记一笔本集吐槽 / 打个时间点锚点…"
    });
    strip.title = "点击打开观片手札工作台（自动锁定当前集数，支持 1422 智能时间码与截图粘贴）";
    strip.onclick = openStudio;
    return strip;
  }

  const latest = reviews[reviews.length - 1];
  const placeholderCount = reviews.filter((r) => r.isPlaceholder).length;

  if (latest.timestamp || latest.episode) {
    const seekBadge = strip.createEl("button", {
      cls: `curator-desk-review-seek-pill curator-mono ${latest.isPlaceholder ? "is-placeholder" : ""}`,
      text: `▶ ${latest.scope || "全剧"}${latest.timestamp ? "·" + latest.timestamp : ""}`
    });
    seekBadge.title = latest.timestamp
      ? `点击调用本地播放器定位至《${item.name}》${latest.scope} ${latest.timestamp}`
      : `点击调用本地播放器打开《${item.name}》${latest.scope}`;
    seekBadge.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await reviewStudioService.launchVideoAtEpisodeAndTimestamp(plugin, item, {
        episode: latest.episode || Number(item.watchedEpisodes) || 1,
        timestamp: latest.timestamp || ""
      });
    };
  } else {
    strip.createSpan({
      cls: "curator-desk-review-scope-pill",
      text: `${latest.scope || "全剧"}·${latest.typeLabel || latest.type || "吐槽"}`
    });
  }

  const hasCoverImg = Boolean(latest.coverImage || (Array.isArray(latest.images) && latest.images.length > 0));
  const snippetText = latest.isPlaceholder
    ? `${hasCoverImg ? "🖼️ " : ""}⏱️ 待补完锚点（点击补齐感想）`
    : `${hasCoverImg ? "🖼️ " : ""}“${String(latest.text || "[附图手札]").replace(/\s+/g, " ")}”`;

  const textSpan = strip.createSpan({
    cls: `curator-desk-review-snippet ${latest.isPlaceholder ? "is-placeholder-text" : ""}`,
    text: snippetText
  });
  textSpan.title = `${latest.text || "待补完时间点锚点"}\n（点击打开观片手札工作台，共 ${reviews.length} 条记录）`;

  const countBadge = strip.createSpan({
    cls: "curator-desk-review-count curator-mono",
    text: placeholderCount > 0 ? `💬${reviews.length}·待补${placeholderCount}` : `💬${reviews.length} ▸`
  });
  countBadge.title = `共 ${reviews.length} 条观片手札`;

  strip.onclick = openStudio;
  return strip;
}

/**
 * 渲染单张案头追番席卡片：
 * - 支持完整追番工作卡（进度条 + -1/+1 + 本地更新集数签 + 观片手札微气泡 + 播放下一话/下载RSS/手札/目录/笔记/趋势）
 * - 支持轻量候补推荐卡（封面 + 完整标题 + 状态/评分 + 番季制作社 + 主操作「▶ 置入在看」+「💬 手札」+「⬇ 下载」+「笔记 ↗」）
 */
function renderDeskCard(plugin, parent, item, state, helpers, cardOpts = {}) {
  const currentState = item.state || "未设置";
  const isStandby = Boolean(cardOpts.isStandby);
  const reviews = Array.isArray(item.reviews) ? item.reviews : [];
  const card = parent.createDiv(`curator-desk-card ${isStandby ? "is-standby-card" : "is-watching-card"}`);
  if (item.file?.path) {
    card.dataset.filePath = item.file.path;
  }

  const edition = extractEditionInfo(item);
  const coverWrap = card.createDiv("curator-desk-cover-wrap");
  const coverUrl = item.file ? plugin.getCoverResourceUrl(item.cover, item.file.path) : "";
  if (coverUrl) {
    const img = coverWrap.createEl("img", { cls: "curator-desk-cover" });
    img.alt = item.name;
    img.loading = "lazy";
    img.src = coverUrl;
    img.onerror = () => {
      img.remove();
      plugin.renderPosterPlaceholder(coverWrap, item);
    };
  } else {
    plugin.renderPosterPlaceholder(coverWrap, item);
  }

  if (edition.badge) {
    coverWrap.createSpan({
      cls: "curator-edition-stamp",
      text: edition.badge
    });
  }

  coverWrap.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.file) {
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.openFile(item.file);
    }
  };

  const body = card.createDiv("curator-desk-card-body");

  // 顶部状态 + 本地剧集状态签 + 评分签
  const topMeta = body.createDiv("curator-desk-top-meta");
  const stateBadge = topMeta.createSpan({
    cls: `curator-state-pill is-${currentState} is-interactive`,
    text: currentState
  });
  stateBadge.title = "点击切换观看状态";
  stateBadge.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.openStateMenu(e, item);
  };

  // 检测真实本地文件夹视频状态
  const localResult =
    item.downloadPath && item.downloadPath !== "无"
      ? inspectLocalFolder(item.downloadPath, item.watchedEpisodes)
      : null;

  if (localResult && !localResult.error && localResult.fileCount > 0) {
    const localPill = topMeta.createSpan({
      cls: `curator-local-ep-pill ${localResult.newCount > 0 ? "has-new" : "is-synced"}`,
      text:
        localResult.newCount > 0
          ? `📁 本地 +${localResult.newCount}集`
          : `📁 本地 ${localResult.fileCount}集`
    });
    localPill.title = `本地文件夹共 ${localResult.fileCount} 集视频，未看新集 ${localResult.newCount} 集（点击打开本地文件夹）`;
    localPill.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await openLocalPathSafely(item.downloadPath);
    };
  }

  const scoreGroup = topMeta.createDiv("curator-desk-score-group");
  const pScoreText = item.personalScore !== null ? `★ ${item.personalScore.toFixed(1)}` : "★ 评分";
  const pScoreBtn = scoreGroup.createSpan({
    cls: `curator-score-pill is-personal is-interactive ${item.personalScore !== null ? "has-score" : ""}`,
    text: pScoreText
  });
  pScoreBtn.title = "点击打分或修改个人评分";
  pScoreBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.openScoreMenu(e, item);
  };

  const bgmVal = item.preciseScore ?? item.publicScore ?? item.bangumiScore;
  if (bgmVal !== null && bgmVal !== undefined) {
    scoreGroup.createSpan({
      cls: "curator-score-pill is-bgm",
      text: `BGM ${Number(bgmVal).toFixed(1)}`
    });
  }

  // 标题与区分副标
  const titleEl = body.createEl("a", {
    cls: "curator-desk-title",
    text: item.name
  });
  titleEl.title = item.name;
  titleEl.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.file) {
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.openFile(item.file);
    }
  };

  const subRow = body.createDiv("curator-desk-subrow");
  if (edition.subtitle) {
    subRow.createSpan({
      cls: "curator-subtitle-chip",
      text: edition.subtitle
    });
  }
  const metaTokens = [item.year, item.season, item.studio].filter(Boolean);
  if (metaTokens.length > 0) {
    subRow.createSpan({
      cls: "curator-meta-text",
      text: metaTokens.join(" · ")
    });
  } else if (item.japaneseName) {
    subRow.createSpan({
      cls: "curator-meta-text",
      text: item.japaneseName
    });
  }

  // 分支 A：轻量候补推荐卡
  if (isStandby) {
    if (reviews.length > 0) {
      renderCardReviewMicroStrip(plugin, body, item, state, helpers, true);
    }
    const standbyFooter = body.createDiv("curator-standby-footer");
    const watchNowBtn = standbyFooter.createEl("button", {
      cls: "curator-quick-watch-btn curator-standby-watch-btn",
      text: "▶ 置入在看"
    });
    watchNowBtn.title = "一键将此作品置入正在追番席位";
    watchNowBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.deskTab = "watching";
      await plugin.quickUpdateAnimeNote(item, { state: "在看" });
      if (globalThis.__BangumiManagerNotice) {
        new globalThis.__BangumiManagerNotice(`已将《${item.name}》置入案头「在看」席位`);
      }
    };

    const rightStandbyActions = standbyFooter.createDiv("curator-standby-right-actions");
    const rvBtn = rightStandbyActions.createEl("button", {
      cls: "curator-standby-note-btn",
      text: reviews.length > 0 ? `💬 观片手札(${reviews.length})` : "💬 观片手札"
    });
    rvBtn.dataset.deskAction = "open-reviews";
    rvBtn.title = "打开观片手札工作台";
    rvBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      reviewStudioService.openAnimeReviewStudioModal(plugin, item);
    };

    if (plugin.settings?.enableDownloadAssistant !== false) {
      const dlBtn = rightStandbyActions.createEl("button", {
        cls: "curator-standby-note-btn is-dl",
        text: "⬇ 下载"
      });
      dlBtn.dataset.deskAction = "open-download";
      dlBtn.title = "打开追番下载与单集 RSS 订阅助手";
      dlBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        animeDownloadService.openAnimeDownloadModal(plugin, item, () => {
          renderActiveDeskSection(plugin, helpers.deskMount || parent.parentElement, state, helpers);
        });
      };
    }

    const openNoteLink = rightStandbyActions.createEl("button", {
      cls: "curator-standby-note-btn",
      text: "笔记 ↗"
    });
    openNoteLink.title = "打开动画笔记";
    openNoteLink.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };
    return;
  }

  // 分支 B：完整工作卡（进度条 + -1/+1 步进控制 + 观片手札微气泡 + 播放下一话/手札/下载RSS/目录/笔记/趋势）
  const watched = Number(item.watchedEpisodes) || 0;
  const total = Number(item.totalEpisodes) || 0;
  const pct = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : (watched > 0 ? 50 : 0);
  const nextEp = total > 0 ? Math.min(total, watched + 1) : watched + 1;

  const progressBox = body.createDiv("curator-desk-progress-box");
  const progressTrack = progressBox.createDiv("curator-progress-track");
  const progressFill = progressTrack.createDiv("curator-progress-fill");
  progressFill.style.width = `${pct}%`;

  const progressControls = progressBox.createDiv("curator-desk-progress-controls");
  const stepGroup = progressControls.createDiv("curator-ep-stepper");

  const decBtn = stepGroup.createEl("button", {
    cls: "curator-step-btn is-dec",
    text: "−"
  });
  decBtn.title = "已看集数 -1";
  decBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = Number(item.watchedEpisodes) || 0;
    if (cur > 0) {
      await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: cur - 1 });
    }
  };

  const epLabel = stepGroup.createSpan({
    cls: "curator-ep-readout bangumi-grid-ep-label",
    text: total > 0 ? `${watched}/${total}话` : `${watched}话`
  });
  epLabel.title = "点击直接输入观看集数";
  epLabel.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    helpers.openSetEpisodesModal(item);
  };

  const incBtn = stepGroup.createEl("button", {
    cls: "curator-step-btn is-inc",
    text: total > 0 && watched < total ? `+1 (第${nextEp}话)` : "+"
  });
  incBtn.title = "记录观看下一话 (+1)";
  incBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = Number(item.watchedEpisodes) || 0;
    const next = cur + 1;
    await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: next });
  };

  // 内嵌观片手札微气泡（单集吐槽 / 时间点空降 / 待补完占位锚点）
  renderCardReviewMicroStrip(plugin, body, item, state, helpers, false);

  // 底部快捷动作栏（播放下一话 / 观片手札 / 追番下载与RSS / 本地目录 / 动画笔记 / 评分趋势）
  const actionsRow = body.createDiv("curator-desk-actions-row");

  if (localResult && !localResult.error && localResult.fileCount > 0 && localResult.nextEpisodeFile) {
    const nextEpNum = localResult.nextEpisodeNumber || (watched + 1);
    const playBtn = actionsRow.createEl("button", {
      cls: "curator-action-link is-primary",
      text: `▶ 播放第${nextEpNum}话`
    });
    playBtn.title = `使用配置的本地视频播放器打开第 ${nextEpNum} 话`;
    playBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await reviewStudioService.launchVideoAtEpisodeAndTimestamp(plugin, item, {
        episode: nextEpNum,
        timestamp: ""
      });
    };
  }

  const reviewActionBtn = actionsRow.createEl("button", {
    cls: `curator-action-link is-review-btn ${reviews.length > 0 ? "has-reviews" : ""}`,
    text: reviews.length > 0 ? `💬 观片手札(${reviews.length})` : "💬 观片手札"
  });
  reviewActionBtn.dataset.deskAction = "open-reviews";
  reviewActionBtn.title = "打开观片手札工作台（支持单集多条吐槽、1422 智能时间码、截图粘贴与播放器空降）";
  reviewActionBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    reviewStudioService.openAnimeReviewStudioModal(plugin, item);
  };

  if (plugin.settings?.enableDownloadAssistant !== false) {
    const dlBtn = actionsRow.createEl("button", {
      cls: "curator-action-link is-download",
      text: item.rssUrl ? "⬇ 追更/下载" : "⬇ 下载/RSS"
    });
    dlBtn.dataset.deskAction = "open-download";
    dlBtn.title = "搜索漫猫 (comicat.org) 发布源、获取单集唯一 RSS 或调用 qBittorrent 下载剧集";
    dlBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      animeDownloadService.openAnimeDownloadModal(plugin, item, () => {
        if (helpers.deskMount) {
          renderActiveDeskSection(plugin, helpers.deskMount, state, helpers);
        }
      });
    };
  }

  if (item.downloadPath && item.downloadPath !== "无") {
    const dirBtn = actionsRow.createEl("button", {
      cls: "curator-action-link",
      text: "📂 目录"
    });
    dirBtn.title = item.downloadPath;
    dirBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!localResult || localResult.error || localResult.fileCount === 0) {
        roxyMascotService.emitRoxyEvent(plugin, {
          type: "local:not_found",
          state: "blocked",
          category: "本地卷宗",
          priority: roxyMascotService.PRIORITY.NORMAL,
          dedupeKey: `local:not_found:${item.name}`,
          message: `那个……《${item.name}》的本地目录里好像还没有放入剧集视频文件呢，可以点击旁边「⬇ 下载/RSS」获取剧集哦。`
        });
      }
      await openLocalPathSafely(item.downloadPath);
    };
  }

  const noteBtn = actionsRow.createEl("button", {
    cls: "curator-action-link",
    text: "✎ 笔记"
  });
  noteBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.file) {
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.openFile(item.file);
    }
  };

  if (item.subjectId) {
    const trendBtn = actionsRow.createEl("button", {
      cls: "curator-action-link",
      text: "📈 趋势"
    });
    trendBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      helpers.openTrendModal(item);
    };
  }
}

/**
 * 渲染主馆藏目录区（内聚即时搜索框、状态/展柜筛选胶囊、排序与画廊/索引切换，默认两排收起并支持 ResizeObserver 响应式自适应）
 */
function renderCatalogSection(plugin, catalogMount, state, helpers) {
  const scrollParent = plugin.getDashboardScrollParent(catalogMount);
  const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

  if (catalogMount._catalogResizeObserver) {
    try {
      catalogMount._catalogResizeObserver.disconnect();
    } catch (e) {}
    catalogMount._catalogResizeObserver = null;
  }

  const allItems = state.items || [];
  const metrics = computeDeskMetrics(allItems);

  // 1. 按状态或展柜/自定义分区筛选
  let baseFiltered = allItems;
  let activeFilterLabel = "所有收藏";

  if (state.statusFilter && state.statusFilter !== "all") {
    if (state.statusFilter.startsWith("shelf:")) {
      const shelfId = state.statusFilter.slice("shelf:".length);
      const colConfig = (plugin.settings.customCollectionSections || []).find((c) => c.id === shelfId);
      if (colConfig) {
        baseFiltered = plugin.resolveCollectionItems(colConfig, allItems);
        activeFilterLabel = `收藏展柜 · ${colConfig.title}`;
      }
    } else if (state.statusFilter.startsWith("query:")) {
      const queryId = state.statusFilter.slice("query:".length);
      const qConfig = (plugin.settings.customQuerySections || []).find((c) => c.id === queryId);
      if (qConfig) {
        baseFiltered = plugin.filterCustomQueryItems(allItems, qConfig);
        activeFilterLabel = `查询分区 · ${qConfig.title}`;
      }
    } else {
      baseFiltered = allItems.filter((it) => (it.state || "未设置") === state.statusFilter);
      activeFilterLabel = `状态 · ${state.statusFilter}`;
    }
  }

  // 2. 即时搜索过滤
  const searchFiltered = state.searchQuery
    ? baseFiltered.filter((it) => matchesInstantSearch(it, state.searchQuery))
    : baseFiltered;

  // 3. 排序
  const sortedItems = sortCatalogItems(searchFiltered, state.sortBy);

  // 构建或复用目录区头部与工具栏（确保即时输入搜索时不丢失焦点与输入法组合态）
  let header = catalogMount.querySelector(".curator-catalog-header");
  let toolbar = catalogMount.querySelector(".curator-catalog-toolbar");
  let bodyMount = catalogMount.querySelector(".curator-catalog-body-mount");

  if (!header || !toolbar || !bodyMount) {
    catalogMount.empty();

    header = catalogMount.createDiv("curator-section-header curator-catalog-header");
    const titleWrap = header.createDiv("curator-section-title-wrap");
    titleWrap.createEl("h2", { cls: "curator-section-title", text: "馆藏编目总览" });
    const countBadge = titleWrap.createSpan({
      cls: "curator-section-badge"
    });
    countBadge.dataset.role = "catalog-count-badge";

    // 模块头部右侧：重置筛选 + 排序下拉 + 画廊封面/编目索引切换
    const headerControls = header.createDiv("curator-view-controls curator-catalog-header-controls");
    const clearFilterBtn = headerControls.createEl("button", {
      cls: "curator-mini-btn curator-catalog-reset-btn",
      text: "重置检索与筛选 ×"
    });
    clearFilterBtn.onclick = (e) => {
      e.preventDefault();
      state.searchQuery = "";
      state.statusFilter = "all";
      renderCatalogSection(plugin, catalogMount, state, helpers);
    };

    const sortSelect = headerControls.createEl("select", { cls: "curator-sort-select" });
    [
      { val: "year_desc", text: "排序：番季年份 ↓" },
      { val: "myScore_desc", text: "排序：个人评分 ↓" },
      { val: "bgmScore_desc", text: "排序：BGM 评分 ↓" },
      { val: "progress_desc", text: "排序：观看进度 ↓" },
      { val: "title_asc", text: "排序：标题音序 ↑" }
    ].forEach((opt) => {
      const o = sortSelect.createEl("option", { value: opt.val, text: opt.text });
      if (opt.val === state.sortBy) o.selected = true;
    });

    sortSelect.onchange = () => {
      state.sortBy = sortSelect.value;
      persistDeskPrefs(plugin, state);
      if (state.sortBy === "myScore_desc" || state.sortBy === "bgmScore_desc") {
        roxyMascotService.emitRoxyEvent(plugin, {
          type: "sort:high_score",
          state: "surprised",
          category: "排序检阅",
          priority: roxyMascotService.PRIORITY.LOW,
          dedupeKey: `sort:${state.sortBy}`,
          message:
            state.sortBy === "myScore_desc"
              ? "哦，已经按您的个人评分从高到低排列好了，排在最前面的果然都是您很喜欢的作品呢。"
              : "已经按照 Bangumi 社区评分从高到低排列完毕了，高分名作一目了然呢。"
        });
      }
      renderCatalogSection(plugin, catalogMount, state, helpers);
    };

    const modeGroup = headerControls.createDiv("curator-mode-toggle-group");
    const btnGallery = modeGroup.createEl("button", {
      cls: `curator-mode-btn ${state.viewMode === "gallery" ? "is-active" : ""}`,
      text: "⊞ 画廊封面"
    });
    btnGallery.dataset.viewMode = "gallery";

    const btnIndex = modeGroup.createEl("button", {
      cls: `curator-mode-btn ${state.viewMode === "index" ? "is-active" : ""}`,
      text: "☰ 编目索引"
    });
    btnIndex.dataset.viewMode = "index";

    btnGallery.onclick = (e) => {
      e.preventDefault();
      if (state.viewMode !== "gallery") {
        state.viewMode = "gallery";
        persistDeskPrefs(plugin, state);
        roxyMascotService.emitRoxyEvent(plugin, {
          type: "view:mode_switch",
          state: "explain",
          category: "视图切换",
          priority: roxyMascotService.PRIORITY.LOW,
          dedupeKey: "view:gallery",
          message: "已经为您切换回「画廊封面」模式了，看着一排排封面心情也会变好呢。"
        });
        renderCatalogSection(plugin, catalogMount, state, helpers);
      }
    };

    btnIndex.onclick = (e) => {
      e.preventDefault();
      if (state.viewMode !== "index") {
        state.viewMode = "index";
        persistDeskPrefs(plugin, state);
        roxyMascotService.emitRoxyEvent(plugin, {
          type: "view:mode_switch",
          state: "explain",
          category: "视图切换",
          priority: roxyMascotService.PRIORITY.LOW,
          dedupeKey: "view:index",
          message: "已经切换成「编目索引」台账模式了，像这样核对集数和评分对比会更清晰一些。"
        });
        renderCatalogSection(plugin, catalogMount, state, helpers);
      }
    };

    // 目录工具栏：即时检索框 + 状态/展柜快筛胶囊栏
    toolbar = catalogMount.createDiv("curator-catalog-toolbar");
    const searchWrap = toolbar.createDiv("curator-search-wrap");
    searchWrap.createSpan({ cls: "curator-search-icon", text: "⌕" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      cls: "curator-search-input",
      placeholder: "即时检索：中文标题 / 日文原名 / BGM编号 / 标签 / 制作公司 / 年份番季..."
    });
    searchInput.value = state.searchQuery || "";
    const searchClearBtn = searchWrap.createEl("button", {
      cls: `curator-search-clear ${state.searchQuery ? "is-visible" : ""}`,
      text: "×"
    });
    searchClearBtn.title = "清空搜索词";

    searchInput.oninput = () => {
      state.searchQuery = searchInput.value;
      searchClearBtn.classList.toggle("is-visible", Boolean(state.searchQuery));
      renderCatalogSection(plugin, catalogMount, state, helpers);
    };

    searchClearBtn.onclick = (e) => {
      e.preventDefault();
      state.searchQuery = "";
      searchInput.value = "";
      searchClearBtn.classList.remove("is-visible");
      renderCatalogSection(plugin, catalogMount, state, helpers);
    };

    toolbar.createDiv("curator-filter-bar");
    bodyMount = catalogMount.createDiv("curator-catalog-body-mount");
  }

  // 同步头部与工具栏控件状态
  const countBadge = header.querySelector('[data-role="catalog-count-badge"]');
  if (countBadge) {
    countBadge.textContent = `${activeFilterLabel} · 显示 ${sortedItems.length} / ${allItems.length} 部`;
  }
  const clearFilterBtn = header.querySelector(".curator-catalog-reset-btn");
  if (clearFilterBtn) {
    clearFilterBtn.style.display =
      state.searchQuery || (state.statusFilter && state.statusFilter !== "all") ? "inline-flex" : "none";
  }
  const sortSelect = header.querySelector(".curator-sort-select");
  if (sortSelect && sortSelect.value !== state.sortBy) {
    sortSelect.value = state.sortBy;
  }
  header.querySelectorAll(".curator-mode-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.viewMode === state.viewMode);
  });

  const searchInput = toolbar.querySelector(".curator-search-input");
  const searchClearBtn = toolbar.querySelector(".curator-search-clear");
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== (state.searchQuery || "")) {
    searchInput.value = state.searchQuery || "";
  }
  if (searchClearBtn) {
    searchClearBtn.classList.toggle("is-visible", Boolean(state.searchQuery));
  }

  // 同步筛选胶囊栏
  const filterBar = toolbar.querySelector(".curator-filter-bar");
  if (filterBar) {
    const baseFilters = [
      { key: "all", label: "全部", count: metrics.total },
      { key: "在看", label: "在看", count: metrics.stateCounts["在看"] },
      { key: "已看", label: "已看", count: metrics.stateCounts["已看"] },
      { key: "想看", label: "想看", count: metrics.stateCounts["想看"] },
      { key: "抛弃", label: "抛弃", count: metrics.stateCounts["抛弃"] }
    ];
    const collections = Array.isArray(plugin.settings.customCollectionSections)
      ? plugin.settings.customCollectionSections
      : [];
    for (const col of collections) {
      const resolved = plugin.resolveCollectionItems(col, allItems);
      baseFilters.push({
        key: `shelf:${col.id}`,
        label: `展柜·${col.title}`,
        count: resolved.length
      });
    }
    const customQueries = Array.isArray(plugin.settings.customQuerySections)
      ? plugin.settings.customQuerySections
      : [];
    for (const cq of customQueries) {
      if (cq.id === "preset_currently_watching") continue;
      const matched = plugin.filterCustomQueryItems(allItems, cq);
      baseFilters.push({
        key: `query:${cq.id}`,
        label: `分区·${cq.title}`,
        count: matched.length
      });
    }

    filterBar.empty();
    baseFilters.forEach((f) => {
      const pill = filterBar.createEl("button", {
        cls: `curator-filter-pill ${state.statusFilter === f.key ? "is-active" : ""}`
      });
      pill.dataset.filterKey = f.key;
      pill.createSpan({ cls: "curator-pill-label", text: f.label });
      pill.createSpan({ cls: "curator-pill-count curator-mono", text: String(f.count) });
      pill.onclick = (e) => {
        e.preventDefault();
        state.statusFilter = f.key;
        renderCatalogSection(plugin, catalogMount, state, helpers);
      };
    });
  }

  bodyMount.empty();

  if (sortedItems.length === 0) {
    if (state.searchQuery) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "search:empty",
        state: "surprised",
        category: "检索轮空",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `search:empty:${state.searchQuery}`,
        message: `咦，馆藏里没有找到关于“${state.searchQuery}”的案卷呢……要不要换个日文原名、制作公司或者 Bangumi 编号再查查看？`
      });
    } else if (state.statusFilter && state.statusFilter !== "all") {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "filter:empty",
        state: "blocked",
        category: "筛选提示",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `filter:empty:${state.statusFilter}`,
        message: `当前的「${activeFilterLabel}」分类下还没有收录作品呢，需要的话可以点击右上角把筛选条件重置一下。`
      });
    }
    const emptyBox = bodyMount.createDiv("curator-empty-box");
    emptyBox.createDiv({
      cls: "curator-empty-title",
      text: state.searchQuery
        ? `未检索到匹配“${state.searchQuery}”的动画档案`
        : `当前筛选（${activeFilterLabel}）下暂无动画记录`
    });
    emptyBox.createDiv({
      cls: "curator-empty-sub",
      text: "可尝试搜索其他标题、日文原名、Bangumi 编号、制作公司，或切换上方状态快筛。"
    });
    return;
  }

  if (state.viewMode === "index") {
    renderCatalogIndexMode(plugin, bodyMount, sortedItems, state, helpers, catalogMount);
  } else {
    renderCatalogGalleryMode(plugin, bodyMount, sortedItems, state, helpers, catalogMount);
  }

  if (scrollParent && savedScrollTop > 0) {
    scrollParent.scrollTop = savedScrollTop;
  }
}

/**
 * 模式 A：画廊封面模式（纸本档案封套卡片，固定高度行高对齐，支持默认两排响应式折叠与展开）
 */
function renderCatalogGalleryMode(plugin, container, items, state, helpers, catalogMount) {
  const grid = container.createDiv("curator-gallery-grid");
  const cardEls = [];

  for (const item of items) {
    const edition = extractEditionInfo(item);
    const card = grid.createDiv("curator-gallery-card bangumi-grid-card");
    cardEls.push(card);
    if (item.file?.path) {
      card.dataset.filePath = item.file.path;
    }

    const posterWrap = card.createDiv("curator-gallery-poster-wrap bangumi-grid-poster-wrap");
    posterWrap.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };

    // 左上角状态签
    const currentState = item.state || "未设置";
    const stateBadge = posterWrap.createDiv({
      cls: `bangumi-grid-state-badge curator-gallery-state is-${currentState} is-interactive`,
      text: currentState
    });
    stateBadge.title = "点击快速切换观看状态";
    stateBadge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.openStateMenu(e, item);
    };

    // 右上角评分签（优先显示个人评分，否则显示 BGM 社区评分）
    let scoreBadgeText = "★ 评分";
    const bgmCommunity = item.preciseScore ?? item.publicScore ?? item.bangumiScore;
    if (item.personalScore !== null) {
      scoreBadgeText = `★ ${item.personalScore.toFixed(1)}`;
    } else if (bgmCommunity !== null && bgmCommunity !== undefined) {
      scoreBadgeText = `BGM ${Number(bgmCommunity).toFixed(1)}`;
    }
    const scoreBadge = posterWrap.createDiv({
      cls: `bangumi-grid-score-badge curator-gallery-score is-interactive ${item.personalScore !== null ? "is-personal" : "is-bgm"}`,
      text: scoreBadgeText
    });
    scoreBadge.title = "点击快速打分 / 修改个人评分";
    scoreBadge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.openScoreMenu(e, item);
    };

    // 季数 / OVA / 剧场版 区分印章
    if (edition.badge) {
      posterWrap.createDiv({
        cls: "curator-gallery-edition-badge",
        text: edition.badge
      });
    }

    const coverUrl = item.file ? plugin.getCoverResourceUrl(item.cover, item.file.path) : "";
    if (coverUrl) {
      const img = posterWrap.createEl("img", { cls: "bangumi-grid-poster curator-gallery-poster" });
      img.alt = item.name;
      img.loading = "lazy";
      img.src = coverUrl;
      img.onerror = () => {
        img.remove();
        plugin.renderPosterPlaceholder(posterWrap, item);
      };
    } else {
      plugin.renderPosterPlaceholder(posterWrap, item);
    }

    // 封面底部仅保留纯粹的集数微操作条（-  11/12话  +）
    const epBar = posterWrap.createDiv("bangumi-grid-ep-bar curator-gallery-ep-bar");
    const btnDec = epBar.createEl("button", {
      cls: "bangumi-grid-ep-btn is-dec",
      text: "−"
    });
    btnDec.title = "已看集数 -1";
    btnDec.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = Number(item.watchedEpisodes) || 0;
      if (cur > 0) {
        await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: cur - 1 });
      }
    };

    const watched = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    const epLabel = epBar.createDiv({
      cls: "bangumi-grid-ep-label",
      text: totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`
    });
    epLabel.title = "点击直接输入观看集数";
    epLabel.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      helpers.openSetEpisodesModal(item);
    };

    const btnInc = epBar.createEl("button", {
      cls: "bangumi-grid-ep-btn is-inc",
      text: "+"
    });
    btnInc.title = "已看集数 +1";
    btnInc.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = Number(item.watchedEpisodes) || 0;
      await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: cur + 1 });
    };

    // 纸本编目信息区（固定层级高度，杜绝同行卡片参差不齐或 Hover 抖动）
    const info = card.createDiv("curator-gallery-info bangumi-grid-info");
    const titleEl = info.createDiv({
      cls: "curator-gallery-title bangumi-grid-title",
      text: item.name
    });
    titleEl.title = item.name;
    titleEl.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };

    // 固定 1 行的季数/副标题/原名识别行
    const distinguishingText = edition.subtitle
      ? (edition.badge ? `${edition.badge} · ${edition.subtitle}` : edition.subtitle)
      : (edition.badge || item.japaneseName || item.animeType || "TV 动画");
    const subEl = info.createDiv({
      cls: "curator-gallery-distinguisher",
      text: distinguishingText
    });
    subEl.title = distinguishingText;

    // 固定 1 行的轻量年份番季与制作社元信息
    const metaParts = [];
    if (item.year || item.season) metaParts.push([item.year, item.season].filter(Boolean).join(" "));
    if (item.studio) metaParts.push(item.studio);
    info.createDiv({
      cls: "bangumi-grid-meta curator-gallery-meta",
      text: metaParts.join(" · ") || (item.subjectId ? `BGM #${item.subjectId}` : "馆藏条目")
    });

    // 固定单行安静页脚（左：最多2枚无框标签 + 添加标签；右：安静无框微链接，Hover 显色不改高度）
    const footer = info.createDiv("curator-gallery-footer");
    const tagsInline = footer.createDiv("curator-gallery-tags-inline bangumi-grid-tags-row");
    const tagTokens = String(item.tags || "")
      .split(/[,;\s#\[\]"']+/)
      .map((t) => t.trim())
      .filter((t) => t && t.toLowerCase() !== "bangumi");

    tagTokens.slice(0, 2).forEach((tag) => {
      const chip = tagsInline.createDiv("curator-gallery-tag-chip bangumi-grid-tag-chip");
      chip.createSpan({ text: `#${tag}` });
      const delBtn = chip.createSpan({ cls: "bangumi-grid-tag-del", text: "×" });
      delBtn.title = `移除标签 #${tag}`;
      delBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await plugin.quickUpdateAnimeNote(item, { removeTag: tag });
      };
    });

    const addTagBtn = tagsInline.createEl("button", {
      cls: "curator-gallery-add-tag bangumi-grid-add-tag-btn",
      text: "+"
    });
    addTagBtn.title = "添加标签";
    addTagBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      helpers.openQuickAddTagModal(item);
    };

    const quietActions = footer.createDiv("curator-gallery-quiet-actions");
    const reviewCount = Array.isArray(item.reviews) ? item.reviews.length : 0;
    const galleryReviewBtn = quietActions.createEl("button", {
      cls: `curator-gallery-quiet-link ${reviewCount > 0 ? "has-reviews" : ""}`,
      text: reviewCount > 0 ? `观片手札(${reviewCount})` : "观片手札"
    });
    galleryReviewBtn.dataset.galleryAction = "open-reviews";
    galleryReviewBtn.title = "打开观片手札工作台";
    galleryReviewBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      reviewStudioService.openAnimeReviewStudioModal(plugin, item);
    };

    if (item.downloadPath && item.downloadPath !== "无") {
      const localResult = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
      if (localResult && !localResult.error && localResult.fileCount > 0 && localResult.nextEpisodeFile) {
        const nextEpNum = localResult.nextEpisodeNumber || (watched + 1);
        const playBtn = quietActions.createEl("button", {
          cls: "curator-gallery-quiet-link is-play",
          text: `▶第${nextEpNum}话`
        });
        playBtn.title = `播放第 ${nextEpNum} 话`;
        playBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await reviewStudioService.launchVideoAtEpisodeAndTimestamp(plugin, item, {
            episode: nextEpNum,
            timestamp: ""
          });
        };
      } else {
        const folderBtn = quietActions.createEl("button", {
          cls: "curator-gallery-quiet-link",
          text: "目录"
        });
        folderBtn.title = `打开本地目录：${item.downloadPath}`;
        folderBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          roxyMascotService.emitRoxyEvent(plugin, {
            type: "local:not_found",
            state: "blocked",
            category: "本地卷宗",
            priority: roxyMascotService.PRIORITY.NORMAL,
            dedupeKey: `local:not_found:${item.name}`,
            message: `那个……《${item.name}》的本地目录里好像还没有放入剧集视频文件呢，请先确认一下存放路径吧。`
          });
          await openLocalPathSafely(item.downloadPath);
        };
      }
    }

    if (plugin.settings?.enableDownloadAssistant !== false) {
      const dlBtn = quietActions.createEl("button", {
        cls: "curator-gallery-quiet-link",
        text: "下载"
      });
      dlBtn.dataset.galleryAction = "open-download";
      dlBtn.title = "打开追番下载与单集 RSS 助手";
      dlBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        animeDownloadService.openAnimeDownloadModal(plugin, item, () => {
          if (helpers.deskMount) {
            renderActiveDeskSection(plugin, helpers.deskMount, state, helpers);
          }
        });
      };
    }

    if (item.subjectId) {
      const trendBtn = quietActions.createEl("button", {
        cls: "curator-gallery-quiet-link",
        text: "趋势"
      });
      trendBtn.title = "查看 Netaba 评分趋势";
      trendBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        helpers.openTrendModal(item);
      };
    }

    const openNoteBtn = quietActions.createEl("button", {
      cls: "curator-gallery-quiet-link",
      text: "笔记↗"
    });
    openNoteBtn.title = "打开动画 Markdown 笔记";
    openNoteBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };
  }

  // 两排预览折叠条与 ResizeObserver 响应式列数计算
  const foldBar = container.createDiv("curator-catalog-fold-bar");
  const foldBtn = foldBar.createEl("button", {
    cls: "curator-catalog-fold-btn"
  });

  const computeColumnsPerRow = () => {
    // 1. 优先尝试从已排版的卡片 offsetTop 实测第一行真实列数
    const visibleCards = cardEls.filter((el) => !el.classList.contains("is-hidden-by-fold"));
    if (visibleCards.length > 1 && visibleCards[0].offsetWidth > 0) {
      const firstTop = visibleCards[0].offsetTop;
      let row1Count = 0;
      for (const el of visibleCards) {
        if (Math.abs(el.offsetTop - firstTop) <= 8) {
          row1Count += 1;
        } else {
          break;
        }
      }
      if (row1Count >= 1 && row1Count < visibleCards.length) {
        return row1Count;
      }
    }

    // 2. 从 computedStyle 的 grid-template-columns 读取列数
    try {
      if (typeof window !== "undefined" && window.getComputedStyle) {
        const tpl = window.getComputedStyle(grid).gridTemplateColumns;
        if (tpl && tpl !== "none" && !tpl.includes("repeat(")) {
          const cols = tpl.trim().split(/\s+/).filter(Boolean).length;
          if (cols >= 1) return cols;
        }
      }
    } catch (e) {}

    // 3. 容器宽度几何回退计算
    const w = grid.clientWidth || container.clientWidth || (catalogMount && catalogMount.clientWidth) || 960;
    const minCardW = w <= 860 ? 148 : 168;
    const gap = w <= 860 ? 10 : 14;
    return Math.max(1, Math.floor((w + gap) / (minCardW + gap)));
  };

  const applyGalleryTwoRowFold = () => {
    const cols = computeColumnsPerRow();
    const maxVisible = Math.max(2, cols * 2);
    const total = cardEls.length;
    const hasMore = total > maxVisible;
    const isCollapsed = !state.catalogExpanded && hasMore;

    grid.classList.toggle("is-collapsed-2rows", isCollapsed);
    grid.dataset.columnsPerRow = String(cols);
    grid.dataset.twoRowLimit = String(maxVisible);

    for (let i = 0; i < total; i++) {
      cardEls[i].classList.toggle("is-hidden-by-fold", isCollapsed && i >= maxVisible);
    }

    if (!hasMore) {
      foldBar.style.display = "none";
    } else {
      foldBar.style.display = "flex";
      foldBar.classList.toggle("is-collapsed", !state.catalogExpanded);
      const hiddenCount = Math.max(0, total - maxVisible);
      foldBtn.textContent = state.catalogExpanded
        ? `收起至两排预览（当前展示全部 ${total} 部） ▴`
        : `展开全部 ${total} 部馆藏（还有 ${hiddenCount} 部未展开） ▾`;
      foldBtn.dataset.catalogAction = state.catalogExpanded ? "collapse" : "expand";
    }
  };

  foldBtn.onclick = (e) => {
    e.preventDefault();
    state.catalogExpanded = !state.catalogExpanded;
    applyGalleryTwoRowFold();
  };

  applyGalleryTwoRowFold();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => applyGalleryTwoRowFold());
  }

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      applyGalleryTwoRowFold();
    });
    ro.observe(grid);
    if (catalogMount) {
      catalogMount._catalogResizeObserver = ro;
    }
  }
}

/**
 * 模式 B：编目索引模式（高密度台账表，长标题完整换行自适应，支持收起至紧凑预览与展开）
 */
function renderCatalogIndexMode(plugin, container, items, state, helpers, catalogMount) {
  const previewLimit = 12;
  const tableWrap = container.createDiv("curator-index-table-wrap");
  const head = tableWrap.createDiv("curator-index-header-row");
  head.createDiv({ cls: "col-idx", text: "编号" });
  head.createDiv({ cls: "col-cover", text: "封套" });
  head.createDiv({ cls: "col-title", text: "作品完整标题 / 原名 / 卷次" });
  head.createDiv({ cls: "col-season", text: "番季 · 制作社" });
  head.createDiv({ cls: "col-state", text: "状态" });
  head.createDiv({ cls: "col-progress", text: "观看进度" });
  head.createDiv({ cls: "col-myscore", text: "个人评分" });
  head.createDiv({ cls: "col-bgmscore", text: "BGM 评分" });
  head.createDiv({ cls: "col-actions", text: "案头操作" });

  const body = tableWrap.createDiv("curator-index-body");
  const rowEls = [];

  items.forEach((item, idx) => {
    const edition = extractEditionInfo(item);
    const row = body.createDiv("curator-index-row");
    if (!state.catalogExpanded && idx >= previewLimit) {
      row.classList.add("is-hidden-by-fold");
    }
    rowEls.push(row);
    if (item.file?.path) {
      row.dataset.filePath = item.file.path;
    }

    // 1. 编号列
    const colIdx = row.createDiv("col-idx curator-mono");
    colIdx.createDiv({ cls: "curator-index-seq", text: String(idx + 1).padStart(2, "0") });
    if (item.subjectId) {
      colIdx.createDiv({ cls: "curator-index-bgmid", text: `#${item.subjectId}` });
    }

    // 2. 缩略图列
    const colCover = row.createDiv("col-cover");
    const thumbWrap = colCover.createDiv("curator-index-thumb-wrap");
    const coverUrl = item.file ? plugin.getCoverResourceUrl(item.cover, item.file.path) : "";
    if (coverUrl) {
      const img = thumbWrap.createEl("img", { cls: "curator-index-thumb" });
      img.alt = item.name;
      img.loading = "lazy";
      img.src = coverUrl;
      img.onerror = () => {
        img.remove();
        thumbWrap.textContent = "🎬";
      };
    } else {
      thumbWrap.textContent = "🎬";
    }
    thumbWrap.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };

    // 3. 完整标题（自然换行，绝不截断成同样前缀）+ 原名 + 卷次区分签
    const colTitle = row.createDiv("col-title");
    const titleMainLine = colTitle.createDiv("curator-index-title-line");
    const link = titleMainLine.createEl("a", {
      cls: "curator-index-title-link",
      text: item.name
    });
    link.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };

    if (edition.badge) {
      titleMainLine.createSpan({
        cls: "curator-index-edition-pill",
        text: edition.badge
      });
    }
    if (edition.subtitle) {
      titleMainLine.createSpan({
        cls: "curator-index-subtitle-pill",
        text: edition.subtitle
      });
    }

    if (item.japaneseName) {
      colTitle.createDiv({
        cls: "curator-index-jp-title",
        text: item.japaneseName
      });
    }

    // 4. 番季与制作公司
    const colSeason = row.createDiv("col-season");
    colSeason.createDiv({
      cls: "curator-index-season-text curator-mono",
      text: [item.year, item.season].filter(Boolean).join(" ") || "—"
    });
    colSeason.createDiv({
      cls: "curator-index-studio-text",
      text: [item.studio, item.animeType].filter(Boolean).join(" · ") || "—"
    });

    // 5. 状态列
    const colState = row.createDiv("col-state");
    const currentState = item.state || "未设置";
    const statePill = colState.createSpan({
      cls: `bangumi-list-state-pill curator-state-pill is-${currentState} is-interactive`,
      text: currentState
    });
    statePill.title = "点击切换观看状态";
    statePill.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.openStateMenu(e, item);
    };

    // 6. 观看进度列（等宽数字）
    const colProgress = row.createDiv("col-progress curator-mono");
    const epCtrl = colProgress.createDiv("curator-index-ep-ctrl");
    const decBtn = epCtrl.createEl("button", {
      cls: "bangumi-list-ep-btn is-dec",
      text: "−"
    });
    decBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = Number(item.watchedEpisodes) || 0;
      if (cur > 0) {
        await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: cur - 1 });
      }
    };

    const watched = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    const epLabel = epCtrl.createSpan({
      cls: "bangumi-list-ep-label curator-mono",
      text: totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`
    });
    epLabel.title = "点击设置集数";
    epLabel.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      helpers.openSetEpisodesModal(item);
    };

    const incBtn = epCtrl.createEl("button", {
      cls: "bangumi-list-ep-btn is-inc",
      text: "+"
    });
    incBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cur = Number(item.watchedEpisodes) || 0;
      await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: cur + 1 });
    };

    // 7. 个人评分列（等宽数字，可点击打分）
    const colMyScore = row.createDiv("col-myscore curator-mono");
    const myScoreEl = colMyScore.createSpan({
      cls: `curator-index-score-btn bangumi-dashboard-score is-interactive ${item.personalScore === null ? "bangumi-dashboard-score-none" : ""}`,
      text: item.personalScore !== null ? `★ ${item.personalScore.toFixed(1)}` : "未评分"
    });
    myScoreEl.title = "点击修改个人评分";
    myScoreEl.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      plugin.openScoreMenu(e, item);
    };

    // 8. BGM 评分列（等宽数字）
    const colBgmScore = row.createDiv("col-bgmscore curator-mono");
    const bgmVal = item.preciseScore ?? item.publicScore ?? item.bangumiScore;
    colBgmScore.createSpan({
      cls: "curator-index-bgm-val",
      text: bgmVal !== null && bgmVal !== undefined ? Number(bgmVal).toFixed(1) : "—"
    });
    if (item.personalScore !== null && bgmVal !== null && bgmVal !== undefined) {
      const delta = item.personalScore - Number(bgmVal);
      const sign = delta > 0 ? "+" : "";
      colBgmScore.createSpan({
        cls: `curator-index-delta ${delta >= 0 ? "is-plus" : "is-minus"}`,
        text: `${sign}${delta.toFixed(1)}`
      });
    }

    // 9. 主要动作列
    const colActions = row.createDiv("col-actions");
    const reviewCount = Array.isArray(item.reviews) ? item.reviews.length : 0;
    const rvBtn = colActions.createEl("button", {
      cls: `curator-table-action-btn ${reviewCount > 0 ? "has-reviews" : ""}`,
      text: reviewCount > 0 ? `💬观片手札(${reviewCount})` : "💬观片手札"
    });
    rvBtn.dataset.indexAction = "open-reviews";
    rvBtn.title = "打开观片手札工作台";
    rvBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      reviewStudioService.openAnimeReviewStudioModal(plugin, item);
    };

    const noteBtn = colActions.createEl("button", {
      cls: "curator-table-action-btn",
      text: "笔记"
    });
    noteBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      }
    };

    if (plugin.settings?.enableDownloadAssistant !== false) {
      const dlBtn = colActions.createEl("button", {
        cls: "curator-table-action-btn",
        text: "⬇下载"
      });
      dlBtn.dataset.indexAction = "open-download";
      dlBtn.title = "打开追番下载与单集 RSS 助手";
      dlBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        animeDownloadService.openAnimeDownloadModal(plugin, item, () => {
          if (helpers.deskMount) {
            renderActiveDeskSection(plugin, helpers.deskMount, state, helpers);
          }
        });
      };
    }

    if (item.downloadPath && item.downloadPath !== "无") {
      const dirBtn = colActions.createEl("button", {
        cls: "curator-table-action-btn",
        text: "目录"
      });
      dirBtn.title = item.downloadPath;
      dirBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await openLocalPathSafely(item.downloadPath);
      };
    }

    if (item.subjectId) {
      const trendBtn = colActions.createEl("button", {
        cls: "curator-table-action-btn",
        text: "趋势"
      });
      trendBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        helpers.openTrendModal(item);
      };
    }
  });

  if (items.length > previewLimit) {
    const foldBar = container.createDiv("curator-catalog-fold-bar");
    const foldBtn = foldBar.createEl("button", {
      cls: "curator-catalog-fold-btn",
      text: state.catalogExpanded
        ? `收起至紧凑预览（当前展示全部 ${items.length} 部） ▴`
        : `展开全部 ${items.length} 部馆藏索引（还有 ${items.length - previewLimit} 部未展开） ▾`
    });
    foldBtn.onclick = (e) => {
      e.preventDefault();
      state.catalogExpanded = !state.catalogExpanded;
      renderCatalogSection(plugin, catalogMount || container, state, helpers);
    };
  }
}

/**
 * 渲染自定义收藏展柜与自定义查询分区（新建按钮就近归位至本模块标题栏右侧，空状态亦常驻展示）
 */
function renderCustomShelvesSection(plugin, shelvesMount, state, container, options) {
  shelvesMount.empty();
  const items = state.items || [];

  const collectionConfigs = Array.isArray(plugin.settings.customCollectionSections)
    ? plugin.settings.customCollectionSections
    : [];
  const customConfigs = Array.isArray(plugin.settings.customQuerySections)
    ? plugin.settings.customQuerySections
    : [];

  const effectiveCustomCount = customConfigs.filter(
    (c) => !(c.id === "preset_currently_watching" && customConfigs.length === 1)
  ).length;

  const header = shelvesMount.createDiv("curator-section-header curator-shelves-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "收藏展柜与自定义分区" });
  titleWrap.createSpan({
    cls: "curator-section-badge",
    text: `${collectionConfigs.length} 展柜 · ${effectiveCustomCount} 分区`
  });

  const headerActions = header.createDiv("curator-shelves-header-actions");
  const addQueryBtn = headerActions.createEl("button", {
    cls: "curator-top-btn",
    text: "+ 新建查询分区"
  });
  addQueryBtn.onclick = () => {
    plugin.openCustomQuerySectionModal(null, async () => {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "shelf:created_query",
        state: "success",
        category: "分区编目",
        priority: roxyMascotService.PRIORITY.HIGH,
        message: "新的自定义查询分区已经整理好了，把同类型的作品归纳在一起确实会好找很多呢。"
      });
      await renderCuratorDesk(plugin, container, options, container._deskRuntime || {});
    });
  };

  const addCollectionBtn = headerActions.createEl("button", {
    cls: "curator-top-btn",
    text: "+ 新建收藏展柜"
  });
  addCollectionBtn.onclick = () => {
    plugin.openCustomCollectionModal(null, async () => {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "shelf:created_collection",
        state: "success",
        category: "展柜编目",
        priority: roxyMascotService.PRIORITY.HIGH,
        message: "新的个人收藏展柜已经建好啦，可以把您最珍视的作品慢慢陈列进去了。"
      });
      await renderCuratorDesk(plugin, container, options, container._deskRuntime || {});
    });
  };

  const sectionsGrid = shelvesMount.createDiv("bangumi-dashboard-sections curator-shelves-grid");
  const collapsedMap = plugin.settings.dashboardSectionCollapsed || {};
  const hiddenMap = plugin.settings.dashboardSectionHidden || {};
  let renderedCount = 0;

  const reorderShelvesAndPartitions = async (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    if (sourceId.startsWith("collection_") && targetId.startsWith("collection_")) {
      const colA = sourceId.replace(/^collection_/, "");
      const colB = targetId.replace(/^collection_/, "");
      const list = Array.isArray(plugin.settings.customCollectionSections)
        ? [...plugin.settings.customCollectionSections]
        : [];
      const idxA = list.findIndex((c) => c.id === colA);
      const idxB = list.findIndex((c) => c.id === colB);
      if (idxA !== -1 && idxB !== -1) {
        const tmp = list[idxA];
        list[idxA] = list[idxB];
        list[idxB] = tmp;
        plugin.settings.customCollectionSections = list;
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      }
      return;
    }
    if (!sourceId.startsWith("collection_") && !targetId.startsWith("collection_")) {
      const list = Array.isArray(plugin.settings.customQuerySections)
        ? [...plugin.settings.customQuerySections]
        : [];
      const idxA = list.findIndex((c) => c.id === sourceId);
      const idxB = list.findIndex((c) => c.id === targetId);
      if (idxA !== -1 && idxB !== -1) {
        const tmp = list[idxA];
        list[idxA] = list[idxB];
        list[idxB] = tmp;
        plugin.settings.customQuerySections = list;
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      }
    }
  };

  for (const colConfig of collectionConfigs) {
    const secId = `collection_${colConfig.id}`;
    if (hiddenMap[secId]) continue;
    renderedCount += 1;
    const colItems = plugin.resolveCollectionItems(colConfig, items);
    const isCollapsed = Boolean(collapsedMap[secId]);

    plugin.createDashboardSection(sectionsGrid, {
      def: {
        id: secId,
        title: `展柜 · ${colConfig.title || "自定义展柜"}`,
        badgeText: `${colItems.length} 部`,
        hasData: true,
        emptyText: "展柜内暂无动画（点击右上角“管理”添加）",
        spanFull: true,
        isCollection: true,
        collectionConfig: colConfig,
        renderBody: (body) => {
          if (colConfig.displayMode === "list") {
            plugin.renderCollectionList(body, colItems, colConfig, container, options);
          } else {
            plugin.renderCollectionGrid(body, colItems, colConfig, container, options);
          }
        }
      },
      isCollapsed,
      onToggleCollapse: async () => {
        plugin.settings.dashboardSectionCollapsed = Object.assign({}, plugin.settings.dashboardSectionCollapsed, {
          [secId]: !isCollapsed
        });
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      },
      onHide: async () => {
        plugin.settings.dashboardSectionHidden = Object.assign({}, plugin.settings.dashboardSectionHidden, {
          [secId]: true
        });
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      },
      onReorder: reorderShelvesAndPartitions,
      onManage: () => {
        plugin.openCollectionItemsManagerModal(colConfig, async () => {
          await plugin.renderScoreDashboard(container, options);
        });
      },
      onEdit: () => {
        plugin.openCustomCollectionModal(colConfig, async () => {
          await plugin.renderScoreDashboard(container, options);
        });
      },
      onDelete: () => {
        plugin.confirmDeleteCustomCollection(colConfig, async () => {
          await plugin.renderScoreDashboard(container, options);
        });
      }
    });
  }

  for (const customConfig of customConfigs) {
    // 默认的“正在追番”预设已由首屏案头追番席完整承载，仅当用户自定义了其他查询分区或该分区有结果时展示
    if (customConfig.id === "preset_currently_watching" && customConfigs.length === 1) {
      continue;
    }
    if (hiddenMap[customConfig.id]) continue;
    renderedCount += 1;
    const filtered = plugin.filterCustomQueryItems(items, customConfig);
    const sorted = plugin.sortCustomQueryItems(filtered, customConfig.sortBy);
    const limit = Number(customConfig.limit) || 0;
    const displayItems = limit > 0 ? sorted.slice(0, limit) : sorted;
    const isCollapsed = Boolean(collapsedMap[customConfig.id]);

    plugin.createDashboardSection(sectionsGrid, {
      def: {
        id: customConfig.id,
        title: `分区 · ${customConfig.title || "自定义查询"}`,
        badgeText: `${filtered.length} 部`,
        hasData: filtered.length > 0,
        emptyText: "暂无匹配的动画记录",
        spanFull: true,
        isCustom: true,
        config: customConfig,
        renderBody: (body) => {
          if (customConfig.displayMode === "grid") {
            plugin.renderCustomGrid(body, displayItems, customConfig);
          } else {
            plugin.renderCustomList(body, displayItems, customConfig);
          }
        }
      },
      isCollapsed,
      onToggleCollapse: async () => {
        plugin.settings.dashboardSectionCollapsed = Object.assign({}, plugin.settings.dashboardSectionCollapsed, {
          [customConfig.id]: !isCollapsed
        });
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      },
      onHide: async () => {
        plugin.settings.dashboardSectionHidden = Object.assign({}, plugin.settings.dashboardSectionHidden, {
          [customConfig.id]: true
        });
        await plugin.saveSettings();
        renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
      },
      onReorder: reorderShelvesAndPartitions,
      onEdit: () => {
        plugin.openCustomQuerySectionModal(customConfig, async () => {
          await plugin.renderScoreDashboard(container, options);
        });
      },
      onDelete: () => {
        plugin.confirmDeleteCustomQuerySection(customConfig, async () => {
          await plugin.renderScoreDashboard(container, options);
        });
      }
    });
  }

  if (renderedCount === 0) {
    sectionsGrid.remove();
    const emptyBar = shelvesMount.createDiv("curator-shelves-empty-bar");
    emptyBar.createSpan({
      cls: "curator-shelves-empty-text",
      text: "当前尚未陈列自定义收藏展柜或查询分区 · 可点击右上角「+ 新建查询分区」或「+ 新建收藏展柜」按个人偏好归档陈列"
    });
  }
}

/**
 * 渲染按年份从早到晚排列的作品时间树抽屉（供制作社排行、评分分布区间、改编类型分布共用）
 */
function renderChronologyTreeDrawer(plugin, hostEl, labelTitle, groupItems) {
  const drawer = hostEl.createDiv("curator-chronology-tree-drawer");
  const yearBuckets = new Map();

  (groupItems || []).forEach((it) => {
    const ym = String(it.year || "").match(/\b(19\d\d|20\d\d)\b/);
    const yKey = ym ? ym[1] : "未知年份";
    if (!yearBuckets.has(yKey)) {
      yearBuckets.set(yKey, []);
    }
    yearBuckets.get(yKey).push(it);
  });

  const sortedYearKeys = Array.from(yearBuckets.keys()).sort((a, b) => {
    const na = /^\d{4}$/.test(a) ? Number(a) : 9999;
    const nb = /^\d{4}$/.test(b) ? Number(b) : 9999;
    return na - nb;
  });

  const head = drawer.createDiv("curator-chrono-header");
  head.createSpan({
    text: `🌿 「${labelTitle}」收录作品时间树（共 ${(groupItems || []).length} 部 · 按较前年份 → 较后年份排列）`
  });
  head.createSpan({
    cls: "curator-mono",
    text: "点击作品直达笔记"
  });

  const timeline = drawer.createDiv("curator-chrono-timeline");
  sortedYearKeys.forEach((yKey) => {
    const works = yearBuckets.get(yKey) || [];
    works.sort((a, b) => {
      const sa = String(a.season || "");
      const sb = String(b.season || "");
      if (sa !== sb) return sa.localeCompare(sb, "zh-CN");
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    });

    const yRow = timeline.createDiv("curator-chrono-year-group");
    yRow.createDiv({
      cls: "curator-chrono-year-node curator-mono",
      text: /^\d{4}$/.test(yKey) ? `${yKey}年` : yKey
    });

    const worksWrap = yRow.createDiv("curator-chrono-works-list");
    works.forEach((w) => {
      const chip = worksWrap.createEl("a", {
        cls: "curator-chrono-work-chip",
        href: "#"
      });
      chip.createSpan({
        cls: "curator-chrono-work-title",
        text: `《${w.name || "未命名"}》`
      });
      const sc = w.personalScore ?? w.preciseScore ?? w.publicScore ?? w.bangumiScore;
      if (sc !== null && sc !== undefined && Number.isFinite(Number(sc))) {
        chip.createSpan({
          cls: "curator-chrono-work-score curator-mono",
          text: w.personalScore !== null ? `★${Number(w.personalScore).toFixed(1)}` : `BGM ${Number(sc).toFixed(1)}`
        });
      }
      chip.title = `${w.name}\n年份季度：${w.year || "未知"} ${w.season || ""}\n状态：${w.state || "未设置"}\n点击打开本地动画笔记`;
      chip.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (w.file) {
          const leaf = plugin.app.workspace.getLeaf(true);
          await leaf.openFile(w.file);
        }
      };
    });
  });

  return drawer;
}

/**
 * 渲染四合一「综合评分与制作社排行榜」（支持 我的评分 / 你在 BGM 上的评分 / BGM 评分 / 动画制作公司 切换、TOP 5/10/15/20/全部 + 自定义数量、以及 FLIP 升降过渡动画与制作社时间树展开）
 */
function renderUnifiedScoreRankBody(plugin, body, items, state) {
  body.empty();
  body.addClass("curator-unified-rank-body");

  const activeTabRaw = state.scoreRankTab || plugin.settings.dashboardScoreRankTab || "personal";
  state.scoreRankTab = ["personal", "userBgm", "bgm", "studio"].includes(activeTabRaw)
    ? activeTabRaw
    : "personal";

  if (!plugin.__studioRankExpandSet) {
    plugin.__studioRankExpandSet = new Set();
  }
  const expandedStudios = plugin.__studioRankExpandSet;

  const getRankLimit = () => {
    const raw =
      state.scoreRankLimit !== undefined
        ? state.scoreRankLimit
        : plugin.settings.dashboardScoreRankLimit !== undefined
          ? plugin.settings.dashboardScoreRankLimit
          : plugin.settings.dashboardPersonalRankLimit;
    if (raw === 0 || raw === "0" || raw === "all") return 0; // 0 代表全部
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 10;
  };

  const getBgmDigits = () => {
    const d = Number(plugin.settings.bangumiPreciseScoreDisplayDigits);
    return [1, 2, 4].includes(d) ? d : 4;
  };

  // 模块内嵌控制栏：左侧四维分段控制器，右侧 TOP N（含全部与自定义输入）与 BGM 小数位数切换
  const controlsWrap = body.createDiv("curator-rank-controls");
  const tabsBar = controlsWrap.createDiv("curator-rank-tabs");
  const tabDefs = [
    { id: "personal", label: "我的评分", desc: "按本地笔记个人评分排序" },
    { id: "userBgm", label: "你在 BGM 上的评分", desc: "按你在 Bangumi 网站打出的评分排序" },
    { id: "bgm", label: "BGM 评分", desc: "按 Bangumi 社区评分排序（支持精度切换）" },
    { id: "studio", label: "动画制作公司", desc: "按动画制作公司收录部数排行（点击右侧部数展开年份时间树）" }
  ];

  const paramsBar = controlsWrap.createDiv("curator-rank-params");

  // TOP N 选择组（支持 5 / 10 / 15 / 20 / 全部 + 自定义数量输入框）
  const limitGroup = paramsBar.createDiv("curator-rank-param-group");
  limitGroup.createSpan({ cls: "curator-rank-param-label", text: "TOP" });
  const limitPills = limitGroup.createDiv("curator-rank-pill-group");
  const limitOptions = [
    { val: 5, text: "5" },
    { val: 10, text: "10" },
    { val: 15, text: "15" },
    { val: 20, text: "20" },
    { val: 0, text: "全部" }
  ];
  const customLimitInput = limitGroup.createEl("input", {
    type: "number",
    cls: "curator-rank-custom-limit-input curator-mono",
    placeholder: "自定义"
  });
  customLimitInput.min = "1";
  customLimitInput.max = "999";
  customLimitInput.title = "输入自定义排名数量（回车或失焦生效）";

  // BGM 评分小数位数选择组
  const digitsGroup = paramsBar.createDiv("curator-rank-param-group");
  digitsGroup.createSpan({ cls: "curator-rank-param-label", text: "BGM精度" });
  const digitsPills = digitsGroup.createDiv("curator-rank-pill-group");
  const digitOptions = [
    { val: 1, text: "1位" },
    { val: 2, text: "2位" },
    { val: 4, text: "4位" }
  ];

  const listWrap = body.createDiv("bangumi-dashboard-rank-list curator-unified-rank-list");

  const computeSortedRankItems = (tabId, digits) => {
    const factor = Math.pow(10, digits);
    const roundByDigits = (val) => Math.round(Number(val) * factor) / factor;

    if (tabId === "studio") {
      const studioMap = new Map();
      for (const item of items) {
        if (!item.studio) continue;
        const rawStudios = String(item.studio)
          .split(/[,;\/、&]+/)
          .map((s) => s.trim())
          .filter((s) => s && !/^(未知|无|暂无|-)$/i.test(s));
        for (const st of rawStudios) {
          if (!studioMap.has(st)) {
            studioMap.set(st, { count: 0, personalScores: [], bgmScores: [], items: [] });
          }
          const data = studioMap.get(st);
          data.count += 1;
          data.items.push(item);
          if (item.personalScore !== null && item.personalScore !== undefined) {
            data.personalScores.push(Number(item.personalScore));
          }
          const bgmSc = item.preciseScore ?? item.publicScore ?? item.bangumiScore;
          if (bgmSc !== null && bgmSc !== undefined) {
            data.bgmScores.push(Number(bgmSc));
          }
        }
      }
      const entries = Array.from(studioMap.entries()).map(([studioName, data]) => {
        const avgPersonal =
          data.personalScores.length > 0
            ? (data.personalScores.reduce((a, b) => a + b, 0) / data.personalScores.length).toFixed(1)
            : null;
        const avgBgm =
          data.bgmScores.length > 0
            ? (data.bgmScores.reduce((a, b) => a + b, 0) / data.bgmScores.length).toFixed(1)
            : null;
        return {
          isStudio: true,
          studioName,
          count: data.count,
          avgPersonal,
          avgBgm,
          groupItems: data.items,
          primaryVal: data.count
        };
      });
      entries.sort((a, b) => b.count - a.count || a.studioName.localeCompare(b.studioName, "zh-CN"));
      const maxCount = entries.length > 0 ? Math.max(1, entries[0].count) : 1;
      entries.forEach((e) => {
        e.maxCount = maxCount;
      });
      return entries;
    }

    if (tabId === "personal") {
      return items
        .filter((it) => it.personalScore !== null && it.personalScore !== undefined)
        .map((it) => {
          const refRaw = it.preciseScore ?? it.publicScore ?? it.bangumiScore;
          return {
            item: it,
            primaryVal: Number(it.personalScore),
            primaryText: `★ ${Number(it.personalScore).toFixed(1)}`,
            secondaryText: refRaw !== null && refRaw !== undefined ? `BGM ${Number(refRaw).toFixed(digits)}` : "",
            deltaVal: refRaw !== null && refRaw !== undefined ? Number(it.personalScore) - Number(refRaw) : null
          };
        })
        .sort((a, b) => b.primaryVal - a.primaryVal || a.item.name.localeCompare(b.item.name, "zh-CN"));
    }

    if (tabId === "userBgm") {
      return items
        .filter((it) => it.bangumiScore !== null && it.bangumiScore !== undefined)
        .map((it) => {
          const refRaw = it.preciseScore ?? it.publicScore;
          return {
            item: it,
            primaryVal: Number(it.bangumiScore),
            primaryText: `★ ${Number(it.bangumiScore).toFixed(1)}`,
            secondaryText:
              it.personalScore !== null
                ? `我 ★ ${Number(it.personalScore).toFixed(1)}`
                : refRaw !== null && refRaw !== undefined
                  ? `BGM ${Number(refRaw).toFixed(digits)}`
                  : "",
            deltaVal:
              refRaw !== null && refRaw !== undefined ? Number(it.bangumiScore) - Number(refRaw) : null
          };
        })
        .sort((a, b) => b.primaryVal - a.primaryVal || a.item.name.localeCompare(b.item.name, "zh-CN"));
    }

    // tabId === "bgm"
    return items
      .filter((it) => (it.preciseScore ?? it.publicScore) !== null && (it.preciseScore ?? it.publicScore) !== undefined)
      .map((it) => {
        const rawBgm = Number(it.preciseScore ?? it.publicScore);
        const roundedBgm = roundByDigits(rawBgm);
        return {
          item: it,
          primaryVal: roundedBgm,
          rawVal: rawBgm,
          primaryText: roundedBgm.toFixed(digits),
          secondaryText:
            it.personalScore !== null
              ? `我 ★ ${Number(it.personalScore).toFixed(1)}`
              : it.bangumiScore !== null
                ? `你在BGM ★ ${Number(it.bangumiScore).toFixed(1)}`
                : "",
          deltaVal: it.personalScore !== null ? Number(it.personalScore) - roundedBgm : null
        };
      })
      .sort((a, b) => b.primaryVal - a.primaryVal || a.item.name.localeCompare(b.item.name, "zh-CN"));
  };

  const syncControlStates = () => {
    const curTab = state.scoreRankTab;
    const curLimit = getRankLimit();
    const curDigits = getBgmDigits();

    tabsBar.querySelectorAll(".curator-rank-tab-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.rankTab === curTab);
    });
    limitPills.querySelectorAll(".curator-rank-param-pill").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.limitVal) === curLimit);
    });
    if (document.activeElement !== customLimitInput) {
      customLimitInput.value = curLimit > 0 ? String(curLimit) : "";
    }
    digitsGroup.style.display = curTab === "bgm" ? "inline-flex" : "none";
    digitsPills.querySelectorAll(".curator-rank-param-pill").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.digitsVal) === curDigits);
    });

    // 同步更新外层 Section Header 徽章文本（固定提示“点击制作社部数展开时间树”）
    const secEl = body.closest(".bangumi-dashboard-section");
    const badgeEl = secEl ? secEl.querySelector(".bangumi-dashboard-section-badge") : null;
    if (badgeEl) {
      badgeEl.textContent = "点击制作社部数展开时间树";
    }
  };

  const renderRowsWithFLIP = (animate = true) => {
    const curTab = state.scoreRankTab;
    const curLimit = getRankLimit();
    const curDigits = getBgmDigits();

    const prevMap = new Map();
    if (animate) {
      listWrap.querySelectorAll(".curator-unified-rank-row[data-rank-key]").forEach((row) => {
        const key = row.dataset.rankKey;
        const rect = row.getBoundingClientRect();
        const barEl = row.querySelector(".bangumi-dashboard-bar");
        prevMap.set(key, {
          top: rect.top,
          rank: Number(row.dataset.rankIndex) || 0,
          barWidth: barEl ? barEl.style.width : "0%"
        });
      });
    }

    const rankedEntries = computeSortedRankItems(curTab, curDigits);
    const sliced = curLimit > 0 ? rankedEntries.slice(0, curLimit) : rankedEntries;
    listWrap.empty();

    if (sliced.length === 0) {
      const emptyBox = listWrap.createDiv("curator-rank-empty");
      const emptyHints = {
        personal: "暂无「我的评分」记录 · 可在案头卡片或馆藏目录中直接点击 ★ 为作品打分",
        userBgm: "暂无「你在 BGM 上的评分」记录 · 若已在 Bangumi 网站打分，可通过命令面板或设置页同步拉取",
        bgm: "暂无「BGM 评分」记录 · 导入或刷新作品信息后会自动写入 Bangumi 社区评分",
        studio: "暂无制作公司信息 · 笔记中未填写“制作公司”字段"
      };
      emptyBox.setText(emptyHints[curTab] || "暂无可显示的排行记录");
      return;
    }

    sliced.forEach((entry, idx) => {
      const newRank = idx + 1;

      if (entry.isStudio) {
        const { studioName, count, avgPersonal, avgBgm, groupItems, maxCount } = entry;
        const key = `studio:${studioName}`;
        const prev = prevMap.get(key);
        const isExpanded = expandedStudios.has(studioName);

        const row = listWrap.createDiv({
          cls: `bangumi-dashboard-rank-row curator-unified-rank-row is-studio-rank-row ${newRank <= 3 ? `is-top-${newRank}` : ""}`
        });
        row.dataset.rankKey = key;
        row.dataset.rankIndex = String(newRank);

        const head = row.createDiv("bangumi-dashboard-rank-head curator-unified-rank-head");
        const leftGroup = head.createDiv("curator-rank-left-group");

        leftGroup.createSpan({
          cls: `curator-rank-num curator-mono ${newRank <= 3 ? `is-top-${newRank}` : ""}`,
          text: `#${newRank}`
        });

        const studioTitle = leftGroup.createSpan({
          cls: "curator-rank-title-link is-studio-name",
          text: studioName
        });
        studioTitle.title = studioName;

        const rightGroup = head.createDiv("curator-rank-right-group curator-mono");
        if (avgPersonal !== null) {
          rightGroup.createSpan({
            cls: "bangumi-studio-score-badge",
            text: `均分 ★${avgPersonal}`
          });
        } else if (avgBgm !== null) {
          rightGroup.createSpan({
            cls: "bangumi-studio-score-badge",
            text: `BGM均分 ${avgBgm}`
          });
        }

        const countBtn = rightGroup.createEl("button", {
          cls: `curator-studio-count-btn curator-mono ${isExpanded ? "is-expanded" : ""}`,
          text: `${count} 部 ${isExpanded ? "▴" : "▾"}`
        });
        countBtn.title = `点击${isExpanded ? "收起" : "展开"}「${studioName}」收录的 ${count} 部作品年份时间树`;
        countBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (expandedStudios.has(studioName)) {
            expandedStudios.delete(studioName);
          } else {
            expandedStudios.add(studioName);
          }
          renderRowsWithFLIP(false);
        };

        const barTrack = row.createDiv("bangumi-dashboard-bar-track curator-rank-bar-track");
        const barFill = barTrack.createDiv("bangumi-dashboard-bar curator-rank-bar-fill");
        const targetWidth = `${Math.max(4, Math.min(100, (count / maxCount) * 100)).toFixed(2)}%`;
        barFill.dataset.targetWidth = targetWidth;
        barFill.style.width = animate && prev ? prev.barWidth : targetWidth;

        if (isExpanded && groupItems.length > 0) {
          renderChronologyTreeDrawer(plugin, row, studioName, groupItems);
        }
        return;
      }

      const { item, primaryVal, primaryText, secondaryText, deltaVal } = entry;
      const key = item.file?.path || item.subjectId || item.name;
      const prev = prevMap.get(key);

      const row = listWrap.createDiv({
        cls: `bangumi-dashboard-rank-row curator-unified-rank-row ${newRank <= 3 ? `is-top-${newRank}` : ""}`
      });
      row.dataset.rankKey = key;
      row.dataset.rankIndex = String(newRank);

      const head = row.createDiv("bangumi-dashboard-rank-head curator-unified-rank-head");
      const leftGroup = head.createDiv("curator-rank-left-group");

      leftGroup.createSpan({
        cls: `curator-rank-num curator-mono ${newRank <= 3 ? `is-top-${newRank}` : ""}`,
        text: `#${newRank}`
      });

      if (animate && prev && prev.rank > 0 && prev.rank !== newRank) {
        const diff = prev.rank - newRank;
        leftGroup.createSpan({
          cls: `curator-rank-shift-tag curator-mono ${diff > 0 ? "is-up" : "is-down"}`,
          text: diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`
        });
      }

      const titleLink = leftGroup.createEl("a", {
        cls: "curator-rank-title-link",
        text: item.name || "未命名动画",
        href: "#"
      });
      titleLink.onclick = async (e) => {
        e.preventDefault();
        if (item.file) {
          const leaf = plugin.app.workspace.getLeaf(true);
          await leaf.openFile(item.file);
        }
      };

      const edInfo = extractEditionInfo(item);
      if (edInfo.edition) {
        leftGroup.createSpan({
          cls: "curator-rank-edition-tag",
          text: edInfo.edition
        });
      }

      const rightGroup = head.createDiv("curator-rank-right-group curator-mono");
      const primaryBadge = rightGroup.createSpan({
        cls: `curator-rank-primary-score ${curTab === "personal" ? "is-interactive" : ""}`,
        text: primaryText
      });
      if (curTab === "personal") {
        primaryBadge.title = "点击修改我的评分";
        primaryBadge.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          plugin.openScoreMenu(e, item);
        };
      }

      if (secondaryText) {
        rightGroup.createSpan({
          cls: "curator-rank-secondary-score",
          text: secondaryText
        });
      }

      if (deltaVal !== null && Number.isFinite(deltaVal)) {
        const sign = deltaVal > 0 ? "+" : "";
        rightGroup.createSpan({
          cls: `curator-rank-delta-pill ${deltaVal >= 0 ? "is-plus" : "is-minus"}`,
          text: `${sign}${deltaVal.toFixed(1)}`
        });
      }

      const barTrack = row.createDiv("bangumi-dashboard-bar-track curator-rank-bar-track");
      const barFill = barTrack.createDiv("bangumi-dashboard-bar curator-rank-bar-fill");
      const targetWidth = `${Math.max(0, Math.min(100, (primaryVal / 10) * 100)).toFixed(2)}%`;
      barFill.dataset.targetWidth = targetWidth;
      barFill.style.width = animate && prev ? prev.barWidth : targetWidth;
    });

    if (animate && prevMap.size > 0 && typeof requestAnimationFrame === "function") {
      const newRows = Array.from(listWrap.querySelectorAll(".curator-unified-rank-row[data-rank-key]"));
      const inversions = [];

      newRows.forEach((row) => {
        const key = row.dataset.rankKey;
        const newRank = Number(row.dataset.rankIndex) || 0;
        const newRect = row.getBoundingClientRect();
        const prev = prevMap.get(key);
        const barFill = row.querySelector(".bangumi-dashboard-bar");
        const targetWidth = barFill ? barFill.dataset.targetWidth : "0%";

        if (prev) {
          const deltaY = prev.top - newRect.top;
          inversions.push({
            row,
            deltaY,
            isRising: prev.rank > newRank,
            isFalling: prev.rank < newRank,
            isNew: false,
            barFill,
            targetWidth
          });
        } else {
          inversions.push({
            row,
            deltaY: 14,
            isRising: false,
            isFalling: false,
            isNew: true,
            barFill,
            targetWidth
          });
        }
      });

      inversions.forEach((inv) => {
        inv.row.style.transition = "none";
        if (inv.isNew) {
          inv.row.style.opacity = "0";
          inv.row.style.transform = `translate3d(0, ${inv.deltaY}px, 0)`;
        } else if (Math.abs(inv.deltaY) > 1) {
          inv.row.style.transform = `translate3d(0, ${inv.deltaY}px, 0)`;
          inv.row.classList.add("is-flip-moving");
          if (inv.isRising) inv.row.classList.add("is-flip-rising");
          if (inv.isFalling) inv.row.classList.add("is-flip-falling");
        }
      });

      void listWrap.offsetHeight;

      requestAnimationFrame(() => {
        inversions.forEach((inv) => {
          inv.row.style.transition =
            "transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 360ms ease, background-color 460ms ease, box-shadow 460ms ease";
          inv.row.style.transform = "translate3d(0, 0, 0)";
          if (inv.isNew) {
            inv.row.style.opacity = "1";
          }
          if (inv.barFill) {
            inv.barFill.style.width = inv.targetWidth;
          }
        });

        setTimeout(() => {
          inversions.forEach((inv) => {
            if (!inv.row.isConnected) return;
            inv.row.style.transition = "";
            inv.row.style.transform = "";
            inv.row.style.opacity = "";
            inv.row.classList.remove("is-flip-moving", "is-flip-rising", "is-flip-falling");
          });
          const gridEl = body.closest(".curator-almanac-grid");
          if (gridEl && typeof gridEl._syncHalfWidthFillers === "function") {
            gridEl._syncHalfWidthFillers();
          }
        }, 500);
      });
    } else {
      const gridEl = body.closest(".curator-almanac-grid");
      if (gridEl && typeof gridEl._syncHalfWidthFillers === "function") {
        requestAnimationFrame(() => gridEl._syncHalfWidthFillers());
      }
    }
  };

  const applyNewLimit = async (lim) => {
    const normalized = lim === 0 ? 0 : Math.max(1, Math.min(999, Math.floor(Number(lim) || 10)));
    if (getRankLimit() === normalized) return;
    state.scoreRankLimit = normalized;
    plugin.settings.dashboardScoreRankLimit = normalized;
    if (normalized > 0) {
      plugin.settings.dashboardPersonalRankLimit = normalized;
      plugin.settings.dashboardBangumiRankLimit = normalized;
    }
    await plugin.saveSettings();
    syncControlStates();
    renderRowsWithFLIP(true);
  };

  tabDefs.forEach((td) => {
    const btn = tabsBar.createEl("button", {
      cls: `curator-rank-tab-btn ${state.scoreRankTab === td.id ? "is-active" : ""}`,
      text: td.label
    });
    btn.dataset.rankTab = td.id;
    btn.title = td.desc;
    btn.onclick = async (e) => {
      e.preventDefault();
      if (state.scoreRankTab === td.id) return;
      state.scoreRankTab = td.id;
      plugin.settings.dashboardScoreRankTab = td.id;
      await plugin.saveSettings();
      syncControlStates();
      renderRowsWithFLIP(true);
    };
  });

  limitOptions.forEach((lOpt) => {
    const pill = limitPills.createEl("button", {
      cls: `curator-rank-param-pill curator-mono ${getRankLimit() === lOpt.val ? "is-active" : ""}`,
      text: lOpt.text
    });
    pill.dataset.limitVal = String(lOpt.val);
    pill.title = lOpt.val === 0 ? "展示全部排行" : `展示前 ${lOpt.val} 名`;
    pill.onclick = async (e) => {
      e.preventDefault();
      await applyNewLimit(lOpt.val);
    };
  });

  customLimitInput.onchange = async () => {
    const v = parseInt(customLimitInput.value, 10);
    if (Number.isFinite(v) && v > 0) {
      await applyNewLimit(v);
    }
  };
  customLimitInput.onkeydown = async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = parseInt(customLimitInput.value, 10);
      if (Number.isFinite(v) && v > 0) {
        await applyNewLimit(v);
      }
    }
  };

  digitOptions.forEach((dOpt) => {
    const pill = digitsPills.createEl("button", {
      cls: `curator-rank-param-pill curator-mono ${getBgmDigits() === dOpt.val ? "is-active" : ""}`,
      text: dOpt.text
    });
    pill.dataset.digitsVal = String(dOpt.val);
    pill.title = `BGM 评分保留 ${dOpt.val} 位小数（切换位数将实时重算同分顺位）`;
    pill.onclick = async (e) => {
      e.preventDefault();
      if (getBgmDigits() === dOpt.val) return;
      plugin.settings.bangumiPreciseScoreDisplayDigits = dOpt.val;
      await plugin.saveSettings();
      syncControlStates();
      renderRowsWithFLIP(true);
    };
  });

  syncControlStates();
  renderRowsWithFLIP(false);
}

/**
 * 渲染四合一「多维评分与改编类型分布」（支持 我的评分 / 你在 BGM 上的评分 / BGM 评分 / 原作改编类型 切换，点击右侧 X 部 (Y%) ▾ 展开年份时间树）
 */
function renderUnifiedDistributionBody(plugin, body, items, state) {
  body.empty();
  body.addClass("curator-unified-distribution-body");

  const activeTabRaw = state.distTab || plugin.settings.dashboardDistTab || "personal";
  state.distTab = ["personal", "userBgm", "bgm", "animeType"].includes(activeTabRaw)
    ? activeTabRaw
    : "personal";

  if (!plugin.__unifiedDistExpandSet) {
    plugin.__unifiedDistExpandSet = new Set();
  }
  const expandedKeys = plugin.__unifiedDistExpandSet;

  const getBgmDigits = () => {
    const d = Number(plugin.settings.bangumiPreciseScoreDisplayDigits);
    return [1, 2, 4].includes(d) ? d : 4;
  };

  const controlsWrap = body.createDiv("curator-rank-controls curator-dist-controls");
  const tabsBar = controlsWrap.createDiv("curator-rank-tabs");
  const tabDefs = [
    { id: "personal", label: "我的评分", desc: "按本地笔记个人评分区间统计分布（点击部数展开时间树）" },
    { id: "userBgm", label: "你在 BGM 上的评分", desc: "按你在 Bangumi 网站打出的评分区间统计分布（点击部数展开时间树）" },
    { id: "bgm", label: "BGM 评分", desc: "按 Bangumi 社区评分区间统计分布（支持精度切换，点击部数展开时间树）" },
    { id: "animeType", label: "原作改编类型", desc: "按原创 / 漫画改 / 轻小说改 / 游戏改 / 其他统计分布（点击部数展开时间树）" }
  ];

  const paramsBar = controlsWrap.createDiv("curator-rank-params");
  const digitsGroup = paramsBar.createDiv("curator-rank-param-group");
  digitsGroup.createSpan({ cls: "curator-rank-param-label", text: "BGM精度" });
  const digitsPills = digitsGroup.createDiv("curator-rank-pill-group");
  const digitOptions = [
    { val: 1, text: "1位" },
    { val: 2, text: "2位" },
    { val: 4, text: "4位" }
  ];

  const listHost = body.createDiv("curator-unified-dist-list-host");

  const renderDistRows = () => {
    listHost.empty();
    const curTab = state.distTab;
    const curDigits = getBgmDigits();

    tabsBar.querySelectorAll(".curator-rank-tab-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.distTab === curTab);
    });
    digitsGroup.style.display = curTab === "bgm" ? "inline-flex" : "none";
    digitsPills.querySelectorAll(".curator-rank-param-pill").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.digitsVal) === curDigits);
    });

    if (!items || items.length === 0) {
      listHost.createDiv({
        cls: "curator-rank-empty",
        text: "暂无动画记录。"
      });
      return;
    }

    if (curTab === "animeType") {
      const typeItemsMap = {
        "原创": [],
        "漫画改": [],
        "轻小说改": [],
        "游戏改": [],
        "其他": []
      };
      for (const item of items) {
        const t = String(item.animeType || "").trim();
        if (/原创/i.test(t)) {
          typeItemsMap["原创"].push(item);
        } else if (/漫/i.test(t)) {
          typeItemsMap["漫画改"].push(item);
        } else if (/小|轻/i.test(t)) {
          typeItemsMap["轻小说改"].push(item);
        } else if (/游/i.test(t)) {
          typeItemsMap["游戏改"].push(item);
        } else if (t) {
          typeItemsMap["其他"].push(item);
        }
      }

      const totalTyped = Object.values(typeItemsMap).reduce((acc, arr) => acc + arr.length, 0);
      if (totalTyped === 0) {
        listHost.createDiv({
          cls: "curator-rank-empty",
          text: "暂无改编类型信息（笔记中未填写“改编类型”）。"
        });
        return;
      }

      const typeList = listHost.createDiv("bangumi-type-list curator-unified-dist-list");
      ["原创", "漫画改", "轻小说改", "游戏改", "其他"].forEach((key) => {
        const groupItems = typeItemsMap[key] || [];
        const count = groupItems.length;
        const pct = totalTyped > 0 ? Math.round((count / totalTyped) * 100) : 0;
        const expandKey = `type:${key}`;
        const isExpanded = expandedKeys.has(expandKey);

        const itemWrap = typeList.createDiv("curator-type-item-wrap");
        const row = itemWrap.createDiv("bangumi-type-row");
        row.createDiv({
          cls: "bangumi-type-label",
          text: key
        });

        const track = row.createDiv("bangumi-type-track");
        const bar = track.createDiv("bangumi-type-bar");
        bar.style.width = `${pct}%`;

        const countBtn = row.createEl("button", {
          cls: `curator-studio-count-btn curator-mono ${isExpanded ? "is-expanded" : ""}`,
          text: `${count} 部 (${pct}%)${count > 0 ? (isExpanded ? " ▴" : " ▾") : ""}`
        });
        countBtn.disabled = count === 0;
        if (count > 0) {
          countBtn.title = `点击${isExpanded ? "收起" : "展开"}「${key}」收录的 ${count} 部作品年份时间树`;
          countBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (expandedKeys.has(expandKey)) {
              expandedKeys.delete(expandKey);
            } else {
              expandedKeys.add(expandKey);
            }
            renderDistRows();
          };
        }

        if (isExpanded && count > 0) {
          renderChronologyTreeDrawer(plugin, itemWrap, key, groupItems);
        }
      });
    } else {
      const factor = Math.pow(10, curDigits);
      const roundByDigits = (val) => Math.round(Number(val) * factor) / factor;

      const getScoreForTab = (it) => {
        if (curTab === "personal") {
          return it.personalScore !== null && it.personalScore !== undefined
            ? Number(it.personalScore)
            : null;
        }
        if (curTab === "userBgm") {
          return it.bangumiScore !== null && it.bangumiScore !== undefined
            ? Number(it.bangumiScore)
            : null;
        }
        const raw = it.preciseScore ?? it.publicScore;
        return raw !== null && raw !== undefined ? roundByDigits(Number(raw)) : null;
      };

      const ranges = [
        { label: "9–10 分", shortLabel: "9–10", min: 9, max: 10.01 },
        { label: "7–8 分", shortLabel: "7–8", min: 7, max: 8.9999 },
        { label: "5–6 分", shortLabel: "5–6", min: 5, max: 6.9999 },
        { label: "3–4 分", shortLabel: "3–4", min: 3, max: 4.9999 },
        { label: "0–2 分", shortLabel: "0–2", min: 0, max: 2.9999 }
      ];

      const scoredEntries = items
        .map((it) => ({ item: it, score: getScoreForTab(it) }))
        .filter((x) => x.score !== null && Number.isFinite(x.score));

      if (scoredEntries.length === 0) {
        const emptyLabel =
          curTab === "personal"
            ? "我的评分"
            : curTab === "userBgm"
              ? "你在 BGM 上的评分"
              : "BGM 评分";
        listHost.createDiv({
          cls: "curator-almanac-submeta",
          text: `所有收藏共 ${items.length} 部作品，暂未登记「${emptyLabel}」· 登记后可点击各分数段展开作品年份时间树`,
          attr: { style: "margin-bottom:8px;" }
        });
      }

      const distList = listHost.createDiv("bangumi-type-list curator-unified-dist-list");
      const totalScored = scoredEntries.length;

      ranges.forEach((range) => {
        const groupItems = scoredEntries
          .filter((x) => x.score >= range.min && x.score <= range.max)
          .map((x) => x.item);
        const count = groupItems.length;
        const pct = totalScored > 0 ? Math.round((count / totalScored) * 100) : 0;
        const expandKey = `${curTab}:${range.shortLabel}`;
        const isExpanded = expandedKeys.has(expandKey);

        const itemWrap = distList.createDiv("curator-type-item-wrap");
        const row = itemWrap.createDiv("bangumi-type-row");
        row.createDiv({
          cls: "bangumi-type-label curator-mono",
          text: range.label
        });

        const track = row.createDiv("bangumi-type-track");
        const bar = track.createDiv("bangumi-type-bar");
        bar.style.width = `${pct}%`;

        const countBtn = row.createEl("button", {
          cls: `curator-studio-count-btn curator-mono ${isExpanded ? "is-expanded" : ""}`,
          text: `${count} 部 (${pct}%)${count > 0 ? (isExpanded ? " ▴" : " ▾") : ""}`
        });
        countBtn.disabled = count === 0;
        if (count > 0) {
          countBtn.title = `点击${isExpanded ? "收起" : "展开"}「${range.label}」区间的 ${count} 部作品年份时间树`;
          countBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (expandedKeys.has(expandKey)) {
              expandedKeys.delete(expandKey);
            } else {
              expandedKeys.add(expandKey);
            }
            renderDistRows();
          };
        }

        if (isExpanded && count > 0) {
          renderChronologyTreeDrawer(plugin, itemWrap, `${range.label}`, groupItems);
        }
      });
    }

    const gridEl = body.closest(".curator-almanac-grid");
    if (gridEl && typeof gridEl._syncHalfWidthFillers === "function") {
      requestAnimationFrame(() => gridEl._syncHalfWidthFillers());
    }
  };

  tabDefs.forEach((td) => {
    const btn = tabsBar.createEl("button", {
      cls: `curator-rank-tab-btn ${state.distTab === td.id ? "is-active" : ""}`,
      text: td.label
    });
    btn.dataset.distTab = td.id;
    btn.title = td.desc;
    btn.onclick = async (e) => {
      e.preventDefault();
      if (state.distTab === td.id) return;
      state.distTab = td.id;
      plugin.settings.dashboardDistTab = td.id;
      await plugin.saveSettings();
      renderDistRows();
    };
  });

  digitOptions.forEach((dOpt) => {
    const pill = digitsPills.createEl("button", {
      cls: `curator-rank-param-pill curator-mono ${getBgmDigits() === dOpt.val ? "is-active" : ""}`,
      text: dOpt.text
    });
    pill.dataset.digitsVal = String(dOpt.val);
    pill.title = `BGM 评分保留 ${dOpt.val} 位小数`;
    pill.onclick = async (e) => {
      e.preventDefault();
      if (getBgmDigits() === dOpt.val) return;
      plugin.settings.bangumiPreciseScoreDisplayDigits = dOpt.val;
      await plugin.saveSettings();
      renderDistRows();
    };
  });

  renderDistRows();
}

/**
 * 洛琪希典藏压印三阶段「魔力紊乱 · 文字失义 · 笔画拆解 · 蛇形曲线游走」消散动效引擎
 * 适配 micro / compact / full 全尺寸，实时读取容器宽高 W × H 构建自适应 Bezier 蛇形轨迹
 */
const ROXY_RADICAL_POOL = [
  "氵", "辶", "纟", "灬", "艹", "孑", "厶", "冫", "巛", "彳",
  "卩", "凵", "爻", "彡", "丿", "丶", "乙", "亅", "亠", "冖",
  "讠", "钅", "☵", "♒", "⟡", "✧", "◈", "≈"
];

function buildSerpentBezierPath(W, H, laneIndex, totalLanes) {
  const yRatio = (laneIndex + 0.8) / (totalLanes + 0.6);
  const baseY = Math.round(H * yRatio);
  const amp = Math.max(5, Math.min(26, H * 0.24)) * (laneIndex % 2 === 0 ? 1 : -1);
  const dir = laneIndex % 3 === 1 ? -1 : 1;
  const startX = dir === 1 ? -16 : W + 16;
  const endX = dir === 1 ? W + 24 : -24;
  const span = endX - startX;
  const x1 = Math.round(startX + span * 0.16);
  const x2 = Math.round(startX + span * 0.33);
  const x3 = Math.round(startX + span * 0.5);
  const x4 = Math.round(startX + span * 0.67);
  const x5 = Math.round(startX + span * 0.84);
  const y1 = Math.round(baseY - amp);
  const y2 = Math.round(baseY + amp * 0.9);
  const y3 = Math.round(baseY - amp * 1.15);
  const y4 = Math.round(baseY + amp * 1.05);
  const y5 = Math.round(baseY - amp * 0.85);
  return `M ${startX} ${baseY} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${baseY} S ${x4} ${y3}, ${x5} ${y4} S ${endX - dir * 12} ${y5}, ${endX} ${baseY}`;
}

function triggerRoxyGrimoireSpellDissolve(filler, onComplete) {
  if (!filler || filler.classList.contains("is-dissolving-spell")) return;
  const rect = filler.getBoundingClientRect();
  const W = Math.max(160, Math.round(rect.width || filler.clientWidth || 360));
  const H = Math.max(36, Math.round(rect.height || filler.clientHeight || 84));

  filler.classList.remove("is-stamping-press");
  filler.classList.add("is-dissolving-spell", "is-stage-1-turbulence");

  // 采集当前可见文本节点并在消散结束后还原原文
  const textTargets = Array.from(
    filler.querySelectorAll(
      ".curator-roxy-grimoire-quote, .curator-roxy-micro-inscription, .curator-roxy-grimoire-stamp"
    )
  );
  const savedTexts = textTargets.map((el) => ({ el, text: el.textContent || "" }));

  // 创建三阶段特效叠层（笔画游走粒子 + 蛇形 Bezier 魔法曲线 SVG）
  const stageLayer = filler.createDiv("curator-roxy-spell-stage-layer");

  // 阶段二粒子：拆解出的偏旁与孤立笔画沿正弦扰动向量四散游走
  const particleCount = H < 90 ? 14 : 22;
  for (let i = 0; i < particleCount; i++) {
    const pEl = stageLayer.createSpan({
      cls: "curator-roxy-stroke-particle",
      text: ROXY_RADICAL_POOL[(i * 3 + 5) % ROXY_RADICAL_POOL.length]
    });
    const startLeft = 12 + ((i * 37) % 78);
    const startTop = 18 + ((i * 29) % 64);
    const angle = ((i / particleCount) * Math.PI * 2) + (i % 2 === 0 ? 0.35 : -0.35);
    const dist = (H < 90 ? 28 : 46) + (i % 5) * 12;
    const dx = Math.round(Math.cos(angle) * dist * 1.35);
    const dy = Math.round(Math.sin(angle) * Math.min(dist, H * 0.55));
    const rot = (i % 2 === 0 ? 1 : -1) * (35 + (i * 19) % 110);
    pEl.style.left = `${startLeft}%`;
    pEl.style.top = `${startTop}%`;
    pEl.style.setProperty("--roxy-dx", `${dx}px`);
    pEl.style.setProperty("--roxy-dy", `${dy}px`);
    pEl.style.setProperty("--roxy-rot", `${rot}deg`);
    pEl.style.animationDelay = `${110 + (i % 6) * 28}ms`;
    if (i % 3 === 0) {
      pEl.classList.add("is-gold-stroke");
    }
  }

  // 阶段三 SVG：读取实时 W × H 构建多股青金/琥珀蛇形 Bezier 曲线游走逃逸
  const serpentCount = H < 90 ? 4 : 5;
  const pathsSvg = [];
  for (let lane = 0; lane < serpentCount; lane++) {
    const d = buildSerpentBezierPath(W, H, lane, serpentCount);
    const strokeColor = lane % 2 === 0 ? "url(#roxySerpentWaterGrad)" : "url(#roxySerpentAmberGrad)";
    const strokeW = lane % 2 === 0 ? 2.2 : 1.75;
    pathsSvg.push(
      `<path class="curator-roxy-serpent-path is-lane-${lane}" d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${Math.round(W * 0.42)} ${Math.round(W * 1.4)}" stroke-dashoffset="${Math.round(W * 0.48)}"/>`
    );
  }
  const svgWrap = stageLayer.createDiv("curator-roxy-serpent-svg-wrap");
  svgWrap.innerHTML = `<svg class="curator-roxy-serpent-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="roxySerpentWaterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#4898e0" stop-opacity="0"/>
        <stop offset="35%" stop-color="#72c4ff" stop-opacity="0.95"/>
        <stop offset="75%" stop-color="#3b6998" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#b8ebff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="roxySerpentAmberGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8f683d" stop-opacity="0"/>
        <stop offset="40%" stop-color="#d9a74a" stop-opacity="0.92"/>
        <stop offset="80%" stop-color="#8f683d" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#f7df9c" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${pathsSvg.join("")}
  </svg>`;

  const serpentPaths = Array.from(svgWrap.querySelectorAll(".curator-roxy-serpent-path"));
  const rootGrid = filler.closest(".curator-almanac-body") || document;
  const dispNode = rootGrid.querySelector("#curator-roxy-displacement-node");
  const turbNode = rootGrid.querySelector("#curator-roxy-turbulence-node");

  const totalDuration = 720;
  const startTs = performance.now();
  let lastMutateStep = -1;

  const stepAnim = (now) => {
    const elapsed = now - startTs;
    const p = Math.min(1, elapsed / totalDuration);

    // 阶段一（0 ~ 280ms）：语义坍缩为无意义偏旁部首与水系符文
    const mutateStep = Math.min(5, Math.floor(elapsed / 45));
    if (mutateStep !== lastMutateStep && mutateStep <= 5) {
      lastMutateStep = mutateStep;
      const decayRatio = Math.min(0.92, (mutateStep + 1) * 0.18);
      savedTexts.forEach(({ el, text }, tIdx) => {
        if (!el || !el.isConnected || !text) return;
        const chars = Array.from(text);
        const nextChars = chars.map((ch, cIdx) => {
          if (/\s/.test(ch)) return ch;
          const hash = ((cIdx * 17 + mutateStep * 31 + tIdx * 13) % 100) / 100;
          if (hash < decayRatio) {
            return ROXY_RADICAL_POOL[(cIdx + mutateStep * 3 + tIdx) % ROXY_RADICAL_POOL.length];
          }
          return ch;
        });
        el.textContent = nextChars.join("");
      });
    }

    if (elapsed >= 150 && !filler.classList.contains("is-stage-2-strokes")) {
      filler.classList.add("is-stage-2-strokes");
    }
    if (elapsed >= 230 && !filler.classList.contains("is-stage-3-serpents")) {
      filler.classList.add("is-stage-3-serpents");
    }

    // 驱动蛇形 Bezier 曲线游走逃逸
    if (elapsed >= 180) {
      const sp = Math.min(1, (elapsed - 180) / (totalDuration - 180));
      serpentPaths.forEach((pathEl, idx) => {
        const startOffset = W * 0.48;
        const endOffset = -W * (1.05 + idx * 0.12);
        const curOffset = startOffset + (endOffset - startOffset) * sp;
        pathEl.setAttribute("stroke-dashoffset", curOffset.toFixed(1));
      });
    }

    // 同步驱动底层 SVG 滤镜微幅水波扰动
    if (dispNode) {
      dispNode.setAttribute("scale", String(Math.round(4 + Math.sin(p * Math.PI) * 28)));
    }
    if (turbNode) {
      const freqX = (0.015 + Math.sin(p * Math.PI * 2) * 0.007).toFixed(4);
      const freqY = (0.038 + p * 0.028).toFixed(4);
      turbNode.setAttribute("baseFrequency", `${freqX} ${freqY}`);
    }

    if (p < 1 && filler.isConnected) {
      requestAnimationFrame(stepAnim);
    }
  };
  requestAnimationFrame(stepAnim);

  setTimeout(() => {
    savedTexts.forEach(({ el, text }) => {
      if (el) el.textContent = text;
    });
    if (stageLayer && stageLayer.parentNode) {
      stageLayer.remove();
    }
    filler.classList.remove(
      "is-dissolving-spell",
      "is-stage-1-turbulence",
      "is-stage-2-strokes",
      "is-stage-3-serpents"
    );
    if (dispNode) dispNode.setAttribute("scale", "18");
    if (typeof onComplete === "function") {
      onComplete();
    }
  }, totalDuration + 15);
}

/**
 * 构建洛琪希魔导典藏席 · 案卷余白过渡纹理与静物插画画幅（支持 micro / compact / full 三档高度锁死自适应）
 */
function createRoxyArchivalGrimoireFiller(parentEl, items, state, opts = {}) {
  const filler = parentEl.createDiv({
    cls: "curator-roxy-grimoire-filler is-auto-spacer"
  });

  const divider = filler.createDiv("curator-roxy-grimoire-divider");
  divider.createSpan({
    cls: "curator-roxy-grimoire-divider-text",
    text: "✦ 洛琪希魔导典藏压印 ✦"
  });

  // 微型火漆印章 / 单行魔导铭文尾花模式（专供 36px <= diff < 105px 的紧凑高度差）
  const microStrip = filler.createDiv("curator-roxy-micro-strip");
  const microSeal = microStrip.createDiv("curator-roxy-micro-seal");
  microSeal.innerHTML = `<svg viewBox="0 0 36 36" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="roxyWaxGrad" cx="35%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#c85a48"/>
        <stop offset="60%" stop-color="#983628"/>
        <stop offset="100%" stop-color="#631e15"/>
      </radialGradient>
    </defs>
    <circle cx="18" cy="18" r="16" fill="url(#roxyWaxGrad)" stroke="#d9a74a" stroke-width="1.3"/>
    <circle cx="18" cy="18" r="12.5" fill="none" stroke="#f7df9c" stroke-width="0.7" stroke-dasharray="2 1.5" stroke-opacity="0.75"/>
    <path d="M9,21 C12,18 24,18 27,21 C24,24 12,24 9,21 Z" fill="#23293a" stroke="#f7df9c" stroke-width="0.8"/>
    <path d="M13,20 L17,10 C19,9 21,11 22,13 L19,14 L23,20 Z" fill="#323b54" stroke="#f7df9c" stroke-width="0.8"/>
    <circle cx="24" cy="12" r="2" fill="#72c4ff"/>
  </svg>`;
  const microBody = microStrip.createDiv("curator-roxy-micro-body");
  microBody.createSpan({
    cls: "curator-roxy-micro-kicker",
    text: "魔导尾花"
  });
  const microInscriptionEl = microBody.createSpan({
    cls: "curator-roxy-micro-inscription"
  });
  const microActions = microStrip.createDiv("curator-roxy-micro-actions");
  const microSwitchBtn = microActions.createEl("button", {
    cls: "curator-roxy-micro-btn",
    text: "↻"
  });
  microSwitchBtn.title = "切换洛琪希魔导铭文批注";
  const microCloseBtn = microActions.createEl("button", {
    cls: "curator-roxy-micro-btn is-close",
    text: "✕ 散印"
  });
  microCloseBtn.title = "解除洛琪希魔导典藏尾花（触发魔力失义与蛇形曲线游走消散）";

  const canvas = filler.createDiv("curator-roxy-grimoire-canvas");

  // 魔咒紊乱消散水波纹遮罩层与盖印冲击光环层
  canvas.createDiv("curator-roxy-spell-wave-overlay");
  canvas.createDiv("curator-roxy-stamp-shockwave");

  // 背景水系魔导阵与羊皮纸暗纹 SVG
  const bgSvgWrap = canvas.createDiv("curator-roxy-grimoire-bg");
  bgSvgWrap.innerHTML = `<svg viewBox="0 0 400 180" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="roxyAstrolabeGlow" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#3b6998" stop-opacity="0.14"/>
        <stop offset="55%" stop-color="#8f683d" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#8f683d" stop-opacity="0"/>
      </radialGradient>
      <pattern id="roxyParchmentGrid" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#8f683d" stroke-width="0.45" stroke-opacity="0.12"/>
        <circle cx="12" cy="12" r="0.7" fill="#3b6998" fill-opacity="0.18"/>
      </pattern>
    </defs>
    <rect width="400" height="180" fill="url(#roxyParchmentGrid)"/>
    <circle cx="112" cy="94" r="82" fill="url(#roxyAstrolabeGlow)"/>
    <g transform="translate(112,94)" stroke="#8f683d" stroke-opacity="0.24" fill="none">
      <circle r="68" stroke-width="1" stroke-dasharray="4 3"/>
      <circle r="54" stroke-width="0.8"/>
      <circle r="38" stroke-width="0.7" stroke="#3b6998" stroke-opacity="0.28" stroke-dasharray="2 4"/>
      <polygon points="0,-54 46.7,27 -46.7,27" stroke-width="0.75" stroke="#3b6998" stroke-opacity="0.22"/>
      <polygon points="0,54 46.7,-27 -46.7,-27" stroke-width="0.75" stroke="#8f683d" stroke-opacity="0.22"/>
      <line x1="-76" y1="0" x2="76" y2="0" stroke-width="0.6" stroke-dasharray="3 3"/>
      <line x1="0" y1="-76" x2="0" y2="76" stroke-width="0.6" stroke-dasharray="3 3"/>
    </g>
    <g stroke="#3b6998" stroke-opacity="0.25" fill="#3b6998" fill-opacity="0.22">
      <circle cx="245" cy="34" r="2"/>
      <circle cx="288" cy="22" r="1.6"/>
      <circle cx="332" cy="42" r="2.2"/>
      <circle cx="364" cy="28" r="1.5"/>
      <path d="M245,34 L288,22 L332,42 L364,28" fill="none" stroke-width="0.7" stroke-dasharray="2 2"/>
    </g>
  </svg>`;

  const contentRow = canvas.createDiv("curator-roxy-grimoire-content");

  // 左侧：原创洛琪希案头魔导静物插画（宽檐巫师帽 + 蓝发麻花辫发梢与缎带 + 阿库娅·哈提亚水王魔杖 + 典藏番剧魔导书 + 热红茶与水滴史莱姆）
  const artBox = contentRow.createDiv("curator-roxy-grimoire-art-box");
  artBox.innerHTML = `<svg class="curator-roxy-grimoire-art" viewBox="0 0 210 138" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="roxyHatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3c445c"/>
        <stop offset="55%" stop-color="#282e40"/>
        <stop offset="100%" stop-color="#1d2230"/>
      </linearGradient>
      <linearGradient id="roxyBraidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#5d8ac9"/>
        <stop offset="100%" stop-color="#385e96"/>
      </linearGradient>
      <linearGradient id="roxyBookCover" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8f5d38"/>
        <stop offset="100%" stop-color="#6e4427"/>
      </linearGradient>
      <radialGradient id="aquaHeartiaGem" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#b8ebff"/>
        <stop offset="45%" stop-color="#4898e0"/>
        <stop offset="100%" stop-color="#1f548c"/>
      </radialGradient>
    </defs>

    <!-- 桌面柔和投影 -->
    <ellipse cx="105" cy="122" rx="84" ry="9" fill="#5a432b" fill-opacity="0.14"/>

    <!-- 阿库娅·哈提亚 (Aqua Heartia) 魔杖斜靠在案卷后方 -->
    <g transform="rotate(-19 108 72)">
      <path d="M22,74 L172,74" stroke="#6d4929" stroke-width="5.2" stroke-linecap="round"/>
      <path d="M26,73 L170,73" stroke="#9e7348" stroke-width="1.6" stroke-linecap="round"/>
      <!-- 杖首螺旋木纹与水属性魔力结晶 -->
      <path d="M166,74 C174,62 192,63 195,74 C192,85 174,86 166,74 Z" fill="none" stroke="#6d4929" stroke-width="3.6"/>
      <circle cx="181" cy="74" r="7.5" fill="url(#aquaHeartiaGem)" stroke="#d9f4ff" stroke-width="1"/>
      <circle cx="179" cy="71.5" r="2.2" fill="#ffffff" fill-opacity="0.85"/>
    </g>

    <!-- 底层厚重番剧典藏魔导书叠放 -->
    <g transform="translate(32, 92)">
      <rect x="0" y="10" width="96" height="17" rx="3" fill="url(#roxyBookCover)" stroke="#4d311c" stroke-width="1.2"/>
      <rect x="5" y="13" width="88" height="11" rx="1.5" fill="#f7efe2" stroke="#cbb89d" stroke-width="0.8"/>
      <line x1="8" y1="16" x2="90" y2="16" stroke="#d8c7ae" stroke-width="0.7"/>
      <line x1="8" y1="19.5" x2="88" y2="19.5" stroke="#d8c7ae" stroke-width="0.7"/>
      <!-- 书签飘带 -->
      <path d="M38,24 L34,34 L40,31 L45,35 L46,24 Z" fill="#b84a39"/>
      <!-- 上层展开的羊皮卷手记 -->
      <rect x="8" y="0" width="82" height="12" rx="2.5" fill="#3b5e8c" stroke="#263f61" stroke-width="1.1"/>
      <rect x="13" y="2.5" width="74" height="7" rx="1" fill="#fbf5ea"/>
      <rect x="24" y="0" width="7" height="12" fill="#c99b52"/>
    </g>

    <!-- 垂落在魔导书两侧的洛琪希标志性双麻花辫发梢与米格路迪亚发饰 -->
    <g>
      <!-- 左麻花辫小卷 -->
      <path d="M52,82 C44,90 42,102 47,111 C53,107 58,96 58,84 Z" fill="url(#roxyBraidGrad)" stroke="#27436b" stroke-width="1.1"/>
      <path d="M46,93 Q52,96 56,91 M45,101 Q51,104 55,99" fill="none" stroke="#27436b" stroke-width="1"/>
      <rect x="45" y="105" width="8" height="3.5" rx="1.5" fill="#d9a74a" transform="rotate(-12 49 106)"/>
      <!-- 右麻花辫小卷 -->
      <path d="M114,82 C122,90 124,103 118,112 C112,108 108,96 108,84 Z" fill="url(#roxyBraidGrad)" stroke="#27436b" stroke-width="1.1"/>
      <path d="M110,92 Q115,96 120,92 M111,100 Q116,104 121,100" fill="none" stroke="#27436b" stroke-width="1"/>
      <rect x="113" y="105" width="8" height="3.5" rx="1.5" fill="#d9a74a" transform="rotate(14 117 106)"/>
    </g>

    <!-- 洛琪希的标志性大号宽檐巫师帽（微倾安放于魔导书之上） -->
    <g transform="translate(18, 12)">
      <!-- 帽檐后层暗面 -->
      <ellipse cx="66" cy="70" rx="54" ry="13" fill="#181c29" transform="rotate(-4 66 70)"/>
      <!-- 巫师帽锥体与折角帽尖 -->
      <path d="M32,66 C39,40 50,15 62,6 C73,-1 89,5 98,16 C87,16 77,20 73,28 C78,42 87,54 98,66 Z" fill="url(#roxyHatGrad)" stroke="#151924" stroke-width="1.3" stroke-linejoin="round"/>
      <!-- 帽身酒红与米格路迪亚金铜饰带 -->
      <path d="M33,61 Q65,69 97,60 L99,66 Q65,75 31,66 Z" fill="#9e4238" stroke="#471d18" stroke-width="1"/>
      <!-- 黄铜方扣与徽章 -->
      <rect x="59" y="59" width="13" height="10" rx="2" fill="#d9a74a" stroke="#5c4014" stroke-width="1.1"/>
      <rect x="62" y="61.5" width="7" height="5" rx="1" fill="#282e40"/>
      <!-- 宽大前帽檐 -->
      <path d="M10,70 C24,58 108,56 122,67 C110,81 26,83 10,70 Z" fill="url(#roxyHatGrad)" stroke="#151924" stroke-width="1.3"/>
      <path d="M18,69 C36,62 96,60 114,67" fill="none" stroke="#5c688a" stroke-width="0.9" stroke-opacity="0.6"/>
      <!-- 帽侧白色饰羽 -->
      <path d="M75,58 C86,44 102,38 112,41 C104,50 91,58 78,61 Z" fill="#f7f3eb" stroke="#6e6558" stroke-width="0.9"/>
    </g>

    <!-- 右侧可爱水滴魔宠 / 蓝发小团子玩偶与热茶杯 -->
    <g transform="translate(138, 80)">
      <!-- 水蓝色果冻魔宠（头顶小呆毛与小巫师帽） -->
      <path d="M18,16 C7,16 2,26 4,35 C6,41 30,41 32,35 C34,26 29,16 18,16 Z" fill="#639cd9" fill-opacity="0.88" stroke="#284c78" stroke-width="1.2"/>
      <ellipse cx="13" cy="24" rx="3.5" ry="2" fill="#ffffff" fill-opacity="0.65" transform="rotate(-18 13 24)"/>
      <circle cx="13.5" cy="29" r="1.5" fill="#1d2d44"/>
      <circle cx="22.5" cy="29" r="1.5" fill="#1d2d44"/>
      <ellipse cx="10.5" cy="31.5" rx="2" ry="1" fill="#f29b9b" fill-opacity="0.65"/>
      <ellipse cx="25.5" cy="31.5" rx="2" ry="1" fill="#f29b9b" fill-opacity="0.65"/>
      <path d="M16,32 Q18,34 20,32" fill="none" stroke="#1d2d44" stroke-width="1" stroke-linecap="round"/>
      <!-- 迷你小巫师帽 -->
      <path d="M8,17 L18,5 L28,17 Z" fill="#2c3347" stroke="#181c29" stroke-width="1"/>
      <ellipse cx="18" cy="17" rx="13" ry="3.2" fill="#2c3347" stroke="#181c29" stroke-width="1"/>

      <!-- 暖白瓷红茶杯 -->
      <g transform="translate(36, 18)">
        <ellipse cx="11" cy="20" rx="13" ry="3.2" fill="#e8decb" stroke="#8f683d" stroke-width="1"/>
        <path d="M2,8 L20,8 L18,19 C17,21 5,21 4,19 Z" fill="#fbf7f0" stroke="#8f683d" stroke-width="1.1"/>
        <path d="M20,10 C25,10 25,17 19,17" fill="none" stroke="#8f683d" stroke-width="1.2"/>
        <line x1="5" y1="12" x2="17" y2="12" stroke="#c28b52" stroke-width="1"/>
        <!-- 袅袅茶香蒸汽 -->
        <path d="M8,4 Q6,0 9,-3 M14,5 Q12,1 15,-2" fill="none" stroke="#9e784b" stroke-width="0.9" stroke-opacity="0.55" stroke-linecap="round"/>
      </g>
    </g>

    <!-- 漂浮的水系魔力星芒与光点 -->
    <g fill="#4a89c7" fill-opacity="0.72">
      <path d="M24,34 L26,39 L31,41 L26,43 L24,48 L22,43 L17,41 L22,39 Z"/>
      <path d="M154,22 L155.5,26 L159.5,27.5 L155.5,29 L154,33 L152.5,29 L148.5,27.5 L152.5,26 Z" fill="#c99b52"/>
      <circle cx="136" cy="48" r="2.2"/>
      <circle cx="42" cy="22" r="1.8" fill="#c99b52"/>
      <circle cx="188" cy="54" r="1.6"/>
    </g>
  </svg>`;

  // 右侧：洛琪希的馆藏整理手记与实时典藏印记（基于真实数据状态的多分支务实口吻，杜绝 0 话硬套课时与 AI 设定词堆砌）
  const noteBox = contentRow.createDiv("curator-roxy-grimoire-note");
  const topMeta = noteBox.createDiv("curator-roxy-grimoire-kicker-row");
  topMeta.createSpan({
    cls: "curator-roxy-grimoire-kicker",
    text: "馆藏整理随笔"
  });

  const topActionsGroup = topMeta.createDiv("curator-roxy-grimoire-actions-group");
  const switchBtn = topActionsGroup.createEl("button", {
    cls: "curator-roxy-grimoire-switch-btn",
    text: "↻ 翻阅批注"
  });
  switchBtn.title = "切换洛琪希的案卷整理批注";

  const closeBtn = topActionsGroup.createEl("button", {
    cls: "curator-roxy-grimoire-close-btn",
    text: "✕ 收起压印"
  });
  closeBtn.title = "解除洛琪希魔导典藏压印（魔力失义与蛇形曲线游走消散，收起后可在角落重新盖印）";

  const quoteEl = noteBox.createDiv("curator-roxy-grimoire-quote");
  const stampsRow = noteBox.createDiv("curator-roxy-grimoire-stamps curator-mono");

  const metrics = computeDeskMetrics(items);
  const scoredCount = items.filter((it) => it.personalScore !== null).length;
  const highRatedCount = items.filter((it) => (it.personalScore ?? 0) >= 8.5).length;
  const watchedEps = Number(metrics.totalWatchedEpisodes) || 0;
  const totalCount = Number(metrics.total) || 0;
  const watchingCount = Number(metrics.stateCounts?.["在看"]) || 0;
  const completedCount = Number(metrics.stateCounts?.["已看"]) || 0;
  const planCount = Number(metrics.stateCounts?.["想看"]) || 0;
  const totalReviews = items.reduce(
    (acc, it) => acc + (Array.isArray(it.reviews) ? it.reviews.length : 0),
    0
  );
  const placeholderReviews = items.reduce(
    (acc, it) => acc + (Array.isArray(it.reviews) ? it.reviews.filter((r) => r.isPlaceholder).length : 0),
    0
  );

  const notesDeck = [];

  // 分支 1：按真实阅片话数与建档阶段分流（彻底杜绝 0 话折算课时笑话）
  if (totalCount === 0) {
    notesDeck.push(
      "“目前档案室里还没有登记任何作品呢。您可以先从命令面板导入几部常看的动画，我会帮您把封套、集数和分类目录一步步整理妥当的。”"
    );
  } else if (watchedEps === 0) {
    notesDeck.push(
      `“目前已经帮您把 ${totalCount} 部作品收进目录了，不过已观看集数还停留在 0 话呢。如果是以前已经看过的作品，随时在卡片上点一下『+』或者改一下观看状态，我就能帮您把实际进度记上了。”`
    );
    if (planCount > 0) {
      notesDeck.push(
        `“我看目录里已经记下了 ${planCount} 部『想看』的动画，挑一部最感兴趣的点开第一话吧？看番的时候顺手记下集数，这本账目就会慢慢充实起来了。”`
      );
    }
  } else if (watchedEps < 25) {
    notesDeck.push(
      `“目前账本上刚刚记录了 ${watchedEps} 话（大约 ${metrics.hours} 小时）。刚开始整理时不用着急一次补完，每次看完一集顺手点一下『+1』，日积月累下来也是一份很踏实的记录呢。”`
    );
  } else if (watchedEps < 150) {
    notesDeck.push(
      `“算下来，您目前已经累计看完了 ${watchedEps} 话动画（约 ${metrics.hours} 小时）。按一集二十多分钟来算，这也是相当长一段专注投入的闲暇时光了，每一部看完的作品都好好地留在册子里呢。”`
    );
  } else {
    notesDeck.push(
      `“不知不觉间，您的累计阅片量已经达到 ${watchedEps} 话（约 ${metrics.hours} 小时）了呢。能把这么多部作品一集一集看完并整理得井井有条，连我看着这本厚厚的台账都觉得很有成就感。”`
    );
  }

  // 分支 2：观看状态结构洞察（想看囤积 / 多开追番 / 稳健节奏 / 高完结率）
  if (totalCount > 0 && planCount >= Math.max(5, Math.ceil(totalCount * 0.45))) {
    notesDeck.push(
      `“我刚才核对了一下，在 ${totalCount} 部馆藏里有 ${planCount} 部都标着『想看』呢。感兴趣的作品越攒越多确实很容易挑花眼……要不要周末抽空从评分最高的那部开始清起？”`
    );
  }
  if (watchingCount >= 6) {
    notesDeck.push(
      `“您现在同时在追 ${watchingCount} 部动画呢，数量稍微有点多，如果隔几天没看很容易忘记上一集停在哪里。建议多用案头追番席的进度条和手札时间点记一下，免得串戏了哦。”`
    );
  } else if (watchingCount >= 1 && watchingCount <= 5) {
    notesDeck.push(
      `“目前案头正保持着 ${watchingCount} 部『在看』作品的步调，这个数量刚刚好，既不会觉得追更太累，也能静下心来好好体会每一集的内容。”`
    );
  }
  if (totalCount >= 5 && metrics.completionRate >= 65) {
    notesDeck.push(
      `“在收录的 ${totalCount} 部动画里，您已经看完了 ${completedCount} 部，完结率达到了 ${metrics.completionRate}%。一旦开看就会有始有终地看到结局，您对待作品的态度真的很认真呢。”`
    );
  }

  // 分支 3：个人评分与社区评分对照洞察
  if (scoredCount >= 5 && metrics.avgDelta !== null) {
    if (metrics.avgDelta >= 0.4) {
      notesDeck.push(
        `“您目前给 ${scoredCount} 部作品打过分，个人均分（${metrics.personalAvg}）比社区均分（${metrics.bgmAvg}）要温和宽容一些（平均高出 +${metrics.avgDelta} 分）。能纯粹地享受作品本身的乐趣，是很棒的看番心态呢。”`
      );
    } else if (metrics.avgDelta <= -0.4) {
      notesDeck.push(
        `“在您打过分的 ${scoredCount} 部作品里，您的个人均分（${metrics.personalAvg}）比社区均分（${metrics.bgmAvg}）略微严格一点（平均 ${metrics.avgDelta} 分）。有自己独立的评判标准、不盲从大众口碑，整理出来的榜单才更有参考价值。”`
      );
    } else {
      notesDeck.push(
        `“在馆藏的 ${totalCount} 部作品里，您已经为 ${scoredCount} 部打过个人评分（均分 ${metrics.personalAvg}），其中 ★8.5 以上的佳作有 ${highRatedCount} 部。看完顺手留个分数，过两年再回头翻看就明白当时的喜好了。”`
      );
    }
  } else if (scoredCount > 0) {
    notesDeck.push(
      `“您目前已经为 ${scoredCount} 部作品记下了个人评分（其中 ★8.5 以上有 ${highRatedCount} 部）。如果还有已看完却没打分的作品，趁着印象还清晰的时候补上会更准确哦。”`
    );
  } else if (totalCount > 0) {
    notesDeck.push(
      "“目前目录里的作品还没有登记个人评分呢。看完一部动画后，随时点击卡片上的『★ 评分』给它打个分，这本年鉴里的排行榜和偏好分析就会自动帮您绘制出来了。”"
    );
  }

  // 分支 4：观片手札与待补完时间点提醒
  if (placeholderReviews > 0) {
    notesDeck.push(
      `“对了，我看到您的观片手札里还有 ${placeholderReviews} 处标了时间点的『待补完锚点』。等哪天有空回顾时，点开卡片上的手札就能接着把当时的感想补齐了。”`
    );
  } else if (totalReviews > 0) {
    notesDeck.push(
      `“您已经在笔记里记下了 ${totalReviews} 条观片手札与吐槽。哪怕只是一两句看番时随手记下的真实想法，隔段时间再读起来也会觉得很有意思呢。”`
    );
  }

  // 分支 5：制作社偏好与年代跨度
  if (metrics.topStudioCount >= 2) {
    notesDeck.push(
      `“从收录记录来看，您看得最多的是『${metrics.topStudio}』的作品，时间跨度覆盖了 ${metrics.yearRange}。按制作社和年份排在一起看，能很清楚地看出您偏爱的风格呢。”`
    );
  }

  // 分支 6：务实的排版与拖拽操作提示
  notesDeck.push(
    "“如果觉得年鉴里某个统计卡片的位置不够顺手，直接按住标题左侧的『⋮⋮』拖到想换的位置就可以了，我会帮您把版面重新对齐好的。”"
  );

  // 单行魔导尾花短铭文（专供 micro 模式）
  const microDeck = [
    `案卷已录 ${totalCount} 部番剧 · 累计阅片 ${watchedEps} 话（完结率 ${metrics.completionRate}%）—— 洛琪希谨识`,
    watchingCount > 0
      ? `案头正追更 ${watchingCount} 部连载，记得随手在进度条上点『+1』记下话数哦。`
      : `目录已备妥 ${planCount} 部待看番剧，闲暇时挑一部开启新的旅程吧。`,
    scoredCount > 0
      ? `已为 ${scoredCount} 部作品留存个人评鉴（均分 ★${metrics.personalAvg}，佳作 ${highRatedCount} 部）。`
      : `按住年鉴卡片标题左侧的『⋮⋮』即可自由拖拽编排席位顺序。`
  ];

  let noteIdx = Number(state._roxyGrimoireNoteIdx) || 0;
  const renderCurrentNote = () => {
    quoteEl.setText(notesDeck[noteIdx % notesDeck.length]);
    microInscriptionEl.setText(microDeck[noteIdx % microDeck.length]);
  };
  renderCurrentNote();

  const handleSwitchNote = (e) => {
    e.preventDefault();
    e.stopPropagation();
    noteIdx = (noteIdx + 1) % notesDeck.length;
    state._roxyGrimoireNoteIdx = noteIdx;
    renderCurrentNote();
  };
  switchBtn.onclick = handleSwitchNote;
  microSwitchBtn.onclick = handleSwitchNote;

  const stampItems = [
    `所有收藏 · ${metrics.total} 部`,
    `已看 · ${metrics.totalWatchedEpisodes} 话`,
    `完结率 · ${metrics.completionRate}%`
  ];
  if (totalReviews > 0) {
    stampItems.push(`手札 · ${totalReviews} 条`);
  }
  stampItems.forEach((st) => {
    stampsRow.createSpan({ cls: "curator-roxy-grimoire-stamp", text: st });
  });

  // 余白角落的恢复盖印按钮容器（当压印被收起时，根据所在列自动停靠左下角或右下角）
  const restoreWrap = parentEl.createDiv("curator-roxy-grimoire-restore-wrap");
  const restoreBtn = restoreWrap.createEl("button", {
    cls: "curator-roxy-grimoire-restore-btn",
    text: "✦ 盖上洛琪希典藏压印"
  });
  restoreBtn.title = "在当前余白处重新盖下洛琪希魔导典藏压印";

  // 关闭按钮：三阶段「魔力紊乱 · 文字失义 · 笔画拆解 · 蛇形曲线游走」消散动效
  const handleDismissSpell = (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerRoxyGrimoireSpellDissolve(filler, () => {
      state.roxyGrimoireDismissed = true;
      if (opts.plugin) {
        persistDeskPrefs(opts.plugin, state);
      }
      const gridEl = filler.closest(".curator-almanac-grid");
      if (gridEl && typeof gridEl._syncHalfWidthFillers === "function") {
        gridEl._syncHalfWidthFillers();
      }
    });
  };
  closeBtn.onclick = handleDismissSpell;
  microCloseBtn.onclick = handleDismissSpell;

  // 恢复按钮：「印章盖下」动效（从上方悬停垂直重压落下 + 微弹回 + 水光金粉扩散光环）
  restoreBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.roxyGrimoireDismissed = false;
    state._triggerGrimoireStampAnim = true;
    if (opts.plugin) {
      persistDeskPrefs(opts.plugin, state);
    }
    const gridEl = restoreWrap.closest(".curator-almanac-grid");
    if (gridEl && typeof gridEl._syncHalfWidthFillers === "function") {
      gridEl._syncHalfWidthFillers();
    }
  };

  return filler;
}

/**
 * 第 8 项统计模块：馆藏标签与话数体量分布（填补「观看状态概览」下方与「综合评分排行榜」右侧的成对半宽席位，并内嵌自适应洛琪希魔导手记画幅）
 */
function renderTagAndVolumeInsights(plugin, body, items, state, container) {
  body.empty();
  body.addClass("curator-tag-volume-body");

  // 1. 高频馆藏标签风向标（过滤通用 bangumi 标签，若无自定义标签则智能回退为季度/载体风向标）
  const tagMap = new Map();
  items.forEach((it) => {
    const rawTags = Array.isArray(it.tags) ? it.tags : [];
    const customTags = rawTags
      .map((t) => String(t).replace(/^#+/, "").trim())
      .filter((t) => t && t.toLowerCase() !== "bangumi");

    const cleanFallbackStudio = (raw) => {
      if (!raw) return "";
      const firstPart = String(raw)
        .split(/[\/、,，;；]/)[0]
        .replace(/^(OP|ED|动画制作|制作协力|制作)[:：\s]*/i, "")
        .trim();
      return firstPart.length > 18 ? firstPart.slice(0, 18) + "…" : firstPart;
    };

    const effectiveTags =
      customTags.length > 0
        ? customTags
        : [
            it.season ? `${it.year || ""}${it.season}` : "",
            it.animeType || "",
            cleanFallbackStudio(it.studio)
          ].filter(Boolean);

    effectiveTags.forEach((tag) => {
      if (!tagMap.has(tag)) {
        tagMap.set(tag, { tag, count: 0, scoreSum: 0, scoreCount: 0 });
      }
      const entry = tagMap.get(tag);
      entry.count += 1;
      const sc = it.personalScore ?? it.preciseScore ?? it.publicScore ?? it.bangumiScore;
      if (sc !== null && sc !== undefined && Number.isFinite(Number(sc))) {
        entry.scoreSum += Number(sc);
        entry.scoreCount += 1;
      }
    });
  });

  const sortedTags = Array.from(tagMap.values())
    .sort((a, b) => b.count - a.count || (b.scoreCount ? b.scoreSum / b.scoreCount : 0) - (a.scoreCount ? a.scoreSum / a.scoreCount : 0))
    .slice(0, 8);

  const tagBlock = body.createDiv("curator-almanac-subblock");
  const tagHead = tagBlock.createDiv("curator-almanac-subhead");
  tagHead.createSpan({ cls: "curator-almanac-subtitle", text: "高频馆藏标签与风向标" });
  tagHead.createSpan({
    cls: "curator-almanac-submeta",
    text: sortedTags.length > 0 ? `点击标签可在总览中快筛` : "可在卡片底部点击 + 为作品添加标签"
  });

  const tagCloud = tagBlock.createDiv("curator-almanac-tag-cloud");
  if (sortedTags.length === 0) {
    tagCloud.createSpan({
      cls: "curator-almanac-tag-empty",
      text: "当前暂无细分标签记录"
    });
  } else {
    sortedTags.forEach((tg, idx) => {
      const avgText = tg.scoreCount > 0 ? `★${(tg.scoreSum / tg.scoreCount).toFixed(1)}` : "";
      const chip = tagCloud.createEl("button", {
        cls: `curator-almanac-tag-chip ${idx < 3 ? "is-top-tag" : ""}`
      });
      chip.createSpan({ cls: "curator-almanac-tag-name", text: `#${tg.tag}` });
      chip.createSpan({ cls: "curator-almanac-tag-count curator-mono", text: `${tg.count}部` });
      if (avgText) {
        chip.createSpan({ cls: "curator-almanac-tag-score curator-mono", text: avgText });
      }
      chip.title = `点击在上方「馆藏编目总览」中检索「${tg.tag}」`;
      chip.onclick = (e) => {
        e.preventDefault();
        if (container && container._deskRuntime && typeof container._deskRuntime.switchWorkspaceMode === "function") {
          container._deskRuntime.switchWorkspaceMode("catalog", { searchQuery: tg.tag, scrollToWorkspace: true });
          return;
        }
        const searchInput = container ? container.querySelector(".curator-search-input") : null;
        if (searchInput) {
          searchInput.value = tg.tag;
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          const catalogMount = container.querySelector(".curator-unified-workspace, .curator-mount-catalog");
          if (catalogMount && typeof catalogMount.scrollIntoView === "function") {
            catalogMount.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      };
    });
  }

  // 2. 剧集篇幅与话数体量分布
  const volumeTiers = [
    { id: "short", label: "短篇 / 剧场 / OVA", range: "1–6 话", count: 0 },
    { id: "single", label: "单季标准番", range: "7–13 话", count: 0 },
    { id: "double", label: "半年番 / 双季", range: "14–26 话", count: 0 },
    { id: "long", label: "长篇连载", range: "27+ 话", count: 0 }
  ];

  items.forEach((it) => {
    const ep = Number(it.totalEpisodes) || Number(it.watchedEpisodes) || 12;
    if (ep <= 6) volumeTiers[0].count += 1;
    else if (ep <= 13) volumeTiers[1].count += 1;
    else if (ep <= 26) volumeTiers[2].count += 1;
    else volumeTiers[3].count += 1;
  });

  const totalItems = Math.max(1, items.length);
  const volBlock = body.createDiv("curator-almanac-subblock");
  const volHead = volBlock.createDiv("curator-almanac-subhead");
  volHead.createSpan({ cls: "curator-almanac-subtitle", text: "剧集篇幅体量分布" });
  volHead.createSpan({ cls: "curator-almanac-submeta curator-mono", text: `共 ${items.length} 部归档` });

  const volGrid = volBlock.createDiv("curator-almanac-volume-grid");
  volumeTiers.forEach((tier) => {
    const pct = items.length > 0 ? Math.round((tier.count / totalItems) * 100) : 0;
    const cell = volGrid.createDiv("curator-almanac-volume-cell");
    const topLine = cell.createDiv("curator-almanac-volume-top");
    topLine.createSpan({ cls: "curator-almanac-volume-label", text: tier.label });
    topLine.createSpan({ cls: "curator-almanac-volume-range curator-mono", text: tier.range });
    const midLine = cell.createDiv("curator-almanac-volume-mid curator-mono");
    midLine.createSpan({ cls: "curator-almanac-volume-val", text: `${tier.count} 部` });
    midLine.createSpan({ cls: "curator-almanac-volume-pct", text: `${pct}%` });
    const barTrack = cell.createDiv("curator-almanac-volume-track");
    const barFill = barTrack.createDiv("curator-almanac-volume-fill");
    barFill.style.width = `${Math.max(4, pct)}%`;
  });

  // 3. 底部内嵌自适应洛琪希魔导典藏手记与纹理画幅（统一由 syncAlmanacHalfWidthFillers 择优单点唤醒，绝不双开）
  createRoxyArchivalGrimoireFiller(body, items, state, { isAutoSpacer: true, plugin });
}

/**
 * 动态巡检「馆藏统计与洞察年鉴」中的半宽模块行（全局唯一压印 & 严禁反向撑高卡片铁律）：
 * 1. 先隐藏所有压印并临时解除 Grid 拉伸（alignSelf: start），精确测量左右卡片真实自然高度 hLeft / hRight。
 * 2. 扣除较矮卡片 body 的 CSS rowGap 后计算真实可用净余白高度 diff：
 *    - diff < 36px：余白极小，直接不渲染压印，保持干净利落。
 *    - 36px <= diff < 105px：切换为「微型火漆印章 / 单行魔导铭文尾花模式」（.is-size-micro）。
 *    - 105px <= diff < 165px：切换为「紧凑手记模式」（.is-size-compact）。
 *    - diff >= 165px：渲染「完整插画手记画幅」（.is-size-full）。
 * 3. 严格将压印容器锁死在 height: ${diff}px; max-height: ${diff}px; overflow: hidden; box-sizing: border-box;，
 *    并在激活后二次校验行高，确保压印绝不反向把父卡片撑高哪怕 1px。
 */
function syncAlmanacHalfWidthFillers(sectionsGrid, items, state) {
  if (!sectionsGrid || !sectionsGrid.isConnected) return;
  const children = Array.from(sectionsGrid.children).filter(
    (el) => el.classList.contains("bangumi-dashboard-section") && !el.classList.contains("span-full")
  );

  // 1. 先将所有卡片的压印与恢复按钮全部重置为隐藏并清空锁高内联样式
  children.forEach((card) => {
    card.querySelectorAll(".curator-roxy-grimoire-filler").forEach((el) => {
      el.classList.remove(
        "is-active",
        "is-col-left",
        "is-col-right",
        "is-size-micro",
        "is-size-compact",
        "is-size-full"
      );
      el.style.cssText = "";
    });
    card.querySelectorAll(".curator-roxy-grimoire-restore-wrap").forEach((el) => {
      el.classList.remove("is-active", "is-col-left", "is-col-right");
      el.style.cssText = "";
    });
  });

  // 2. 遍历成对半宽行，解除 Grid 默认 stretch 后测量两张卡片真实自然高度与净余白
  let bestTarget = null;
  for (let i = 0; i < children.length; i += 2) {
    const leftCard = children[i];
    const rightCard = children[i + 1];
    if (!leftCard || !rightCard) continue;
    if (leftCard.classList.contains("is-collapsed") || rightCard.classList.contains("is-collapsed")) continue;

    const prevLeftAlign = leftCard.style.alignSelf;
    const prevRightAlign = rightCard.style.alignSelf;
    leftCard.style.alignSelf = "start";
    rightCard.style.alignSelf = "start";

    const hLeft = Math.round(leftCard.getBoundingClientRect().height);
    const hRight = Math.round(rightCard.getBoundingClientRect().height);

    leftCard.style.alignSelf = prevLeftAlign;
    rightCard.style.alignSelf = prevRightAlign;

    const rawDiff = Math.abs(hLeft - hRight);
    const isLeftShorter = hLeft <= hRight;
    const shorterCard = isLeftShorter ? leftCard : rightCard;
    const tallerCard = isLeftShorter ? rightCard : leftCard;
    const tallerHeight = Math.max(hLeft, hRight);
    const shorterBody = shorterCard.querySelector(".bangumi-dashboard-section-body");
    const bodyRowGap = shorterBody
      ? parseFloat(window.getComputedStyle(shorterBody).rowGap) || 0
      : 0;
    const availDiff = Math.max(0, Math.floor(rawDiff - bodyRowGap));

    if (availDiff >= 36) {
      const colClass = isLeftShorter ? "is-col-left" : "is-col-right";
      if (!bestTarget || availDiff > bestTarget.diff) {
        bestTarget = {
          shorterCard,
          tallerCard,
          tallerHeight,
          colClass,
          diff: availDiff
        };
      }
    }
  }

  if (!bestTarget) return;

  const { shorterCard, tallerHeight, colClass, diff } = bestTarget;
  const lockInlineHeight = (el, targetH) => {
    const h = Math.max(0, Math.floor(targetH));
    el.style.height = `${h}px`;
    el.style.maxHeight = `${h}px`;
    el.style.minHeight = `${h}px`;
    el.style.flex = `0 0 ${h}px`;
    el.style.margin = "0";
    el.style.paddingTop = "0";
    el.style.overflow = "hidden";
    el.style.boxSizing = "border-box";
  };

  if (state && state.roxyGrimoireDismissed) {
    const restoreWrap = shorterCard.querySelector(".curator-roxy-grimoire-restore-wrap");
    if (restoreWrap) {
      lockInlineHeight(restoreWrap, diff);
      restoreWrap.classList.add("is-active", colClass);
    }
    return;
  }

  const filler = shorterCard.querySelector(".curator-roxy-grimoire-filler");
  if (!filler) return;

  const sizeClass =
    diff < 105 ? "is-size-micro" : diff < 165 ? "is-size-compact" : "is-size-full";
  lockInlineHeight(filler, diff);
  filler.classList.add("is-active", colClass, sizeClass);

  // 二次亚像素校验：若因边框或行距舍入导致较矮卡片高度超过较高卡片自然高度，立即精确下调锁死高度，确保 0px 反向撑高
  const postHeight = Math.round(shorterCard.getBoundingClientRect().height);
  if (postHeight > tallerHeight) {
    const overshoot = postHeight - tallerHeight;
    const correctedDiff = Math.max(36, diff - overshoot);
    lockInlineHeight(filler, correctedDiff);
  }

  if (state && state._triggerGrimoireStampAnim) {
    state._triggerGrimoireStampAnim = false;
    filler.classList.remove("is-stamping-press");
    void filler.offsetWidth;
    filler.classList.add("is-stamping-press");
    setTimeout(() => {
      if (filler.isConnected) {
        filler.classList.remove("is-stamping-press");
      }
    }, 760);
  }
}

/**
 * 渲染收拢在底部的“馆藏统计与洞察年鉴”（默认显示精炼摘要条，点击展开完整统计与三合一排行模块）
 */
function renderAlmanacSection(plugin, almanacMount, state, container, options, prevFlipRects = null) {
  almanacMount.empty();
  const items = state.items || [];
  const metrics = computeDeskMetrics(items);

  const header = almanacMount.createDiv("curator-section-header curator-almanac-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "馆藏统计与洞察年鉴" });
  titleWrap.createSpan({
    cls: "curator-section-badge",
    text: "7 项统计与多维排行模块 · 支持拖拽⋮⋮换位"
  });

  const toggleBtn = header.createEl("button", {
    cls: `curator-almanac-toggle-btn ${state.almanacExpanded ? "is-expanded" : ""}`,
    text: state.almanacExpanded ? "收起完整统计年鉴 ▲" : "展开完整统计年鉴 ▼"
  });

  // 默认常驻的简洁摘要条
  const summaryStrip = almanacMount.createDiv("curator-almanac-summary-strip");
  const summaryCells = [
    {
      label: "累计观看话数 / 时长",
      value: `${metrics.totalWatchedEpisodes} 话 · ${metrics.hours} 小时`,
      role: "almanac-episodes"
    },
    {
      label: "动画完结率",
      value: `${metrics.completionRate}% (已看 ${metrics.stateCounts["已看"]} / ${metrics.total} 部)`,
      role: "almanac-completion"
    },
    {
      label: "开播年份跨度",
      value: metrics.yearRange,
      role: "almanac-years"
    },
    {
      label: "评分对照与差值 (Δ)",
      value:
        metrics.avgDelta !== null
          ? `我 ${metrics.personalAvg} / BGM ${metrics.bgmAvg} (${metrics.avgDelta >= 0 ? "+" : ""}${metrics.avgDelta})`
          : `我 ${metrics.personalAvg} / BGM ${metrics.bgmAvg}`,
      role: "almanac-delta"
    },
    {
      label: "主力收录制作公司",
      value: metrics.topStudio,
      role: "almanac-studio"
    }
  ];

  for (const cell of summaryCells) {
    const box = summaryStrip.createDiv("curator-almanac-summary-cell");
    box.createDiv({ cls: "curator-almanac-cell-label", text: cell.label });
    const valEl = box.createDiv({ cls: "curator-almanac-cell-value curator-mono", text: cell.value });
    valEl.dataset.statRole = cell.role;
  }

  const bodyWrap = almanacMount.createDiv({
    cls: `curator-almanac-body ${state.almanacExpanded ? "is-open" : "is-collapsed"}`
  });

  toggleBtn.onclick = (e) => {
    e.preventDefault();
    state.almanacExpanded = !state.almanacExpanded;
    persistDeskPrefs(plugin, state);
    renderAlmanacSection(plugin, almanacMount, state, container, options);
  };

  if (!state.almanacExpanded) {
    return;
  }

  // 注入洛琪希「魔咒紊乱消散」专属 SVG 水蛇湍流置换滤镜 (#curator-roxy-water-serpent-filter)
  const filterSvgHost = bodyWrap.createDiv("curator-roxy-svg-filter-defs");
  filterSvgHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
  filterSvgHost.innerHTML = `<svg width="0" height="0" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="curator-roxy-water-serpent-filter" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence id="curator-roxy-turbulence-node" type="fractalNoise" baseFrequency="0.018 0.045" numOctaves="2" seed="7" result="roxyNoise"/>
        <feDisplacementMap id="curator-roxy-displacement-node" in="SourceGraphic" in2="roxyNoise" scale="26" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  </svg>`;

  // 展开状态下：完整渲染统计与三合一综合评分排行榜模块
  const personalItems = items
    .filter((item) => item.personalScore !== null)
    .sort((a, b) => b.personalScore - a.personalScore || a.name.localeCompare(b.name, "zh-CN"));

  const hasAnyRankedScore = items.some(
    (it) =>
      it.personalScore !== null ||
      it.bangumiScore !== null ||
      it.preciseScore !== null ||
      it.publicScore !== null
  );
  const rankLimit = Math.max(
    1,
    Number(state.scoreRankLimit || plugin.settings.dashboardScoreRankLimit || plugin.settings.dashboardPersonalRankLimit) || 10
  );

  const almanacDefs = [
    {
      id: "progressStats",
      title: "追番全景与时长统计",
      badgeText: `所有收藏 ${items.length} 部`,
      hasData: items.length > 0,
      emptyText: "暂无动画数据",
      spanFull: true,
      renderBody: (body) => plugin.renderProgressStats(body, items)
    },
    {
      id: "yearStats",
      title: "年代与番季分布",
      badgeText: items.some((it) => it.year) ? "纪元星轨 · 四季展龛" : "",
      hasData: items.some((it) => it.year),
      emptyText: "笔记中暂无开播年份或季度信息",
      spanFull: true,
      renderBody: (body) => plugin.renderYearStats(body, items)
    },
    {
      id: "scoreDelta",
      title: "评分差异与偏好分析",
      badgeText: items.some((it) => itemHasBothScores(it)) ? "对比分析" : "",
      hasData: items.some((it) => itemHasBothScores(it)),
      emptyText: "需要同时拥有“我的评分”与“BGM 评分”方可进行对比分析",
      spanFull: true,
      renderBody: (body) => plugin.renderScoreDelta(body, items)
    },
    {
      id: "characterInsights",
      title: "角色典藏与萌点偏好排行",
      badgeText: `${(plugin.settings.characterCollection || []).length} 位角色`,
      hasData: true,
      emptyText: "尚未收录喜爱的动画角色",
      spanFull: true,
      renderBody: (body) =>
        characterArchiveService.renderCharacterArchiveWorkspace(plugin, body, items, {
          compactAlmanacMode: true
        })
    },
    {
      id: "personalRank",
      title: "综合评分与制作社排行榜",
      badgeText: "点击制作社部数展开时间树",
      hasData: items.length > 0 || hasAnyRankedScore,
      emptyText: "暂无可显示的评分与制作社排行记录",
      spanFull: false,
      renderBody: (body) => {
        renderUnifiedScoreRankBody(plugin, body, items, state);
        createRoxyArchivalGrimoireFiller(body, items, state, { isAutoSpacer: true, plugin });
      }
    },
    {
      id: "distribution",
      title: "多维评分与改编类型分布",
      badgeText: "点击部数展开时间树",
      hasData: items.length > 0,
      emptyText: "暂无评分与改编类型分布数据",
      spanFull: false,
      renderBody: (body) => {
        renderUnifiedDistributionBody(plugin, body, items, state);
        createRoxyArchivalGrimoireFiller(body, items, state, { isAutoSpacer: true, plugin });
      }
    },
    {
      id: "tagInsights",
      title: "馆藏标签与话数体量",
      badgeText: items.length ? "标签与篇幅" : "",
      hasData: items.length > 0,
      emptyText: "暂无馆藏标签与话数记录",
      spanFull: false,
      renderBody: (body) => renderTagAndVolumeInsights(plugin, body, items, state, container)
    }
  ];

  // 按用户持久化的 dashboardSectionOrder 对年鉴模块排序
  const defaultAlmanacIds = almanacDefs.map((d) => d.id);
  const savedOrder = Array.isArray(plugin.settings.dashboardSectionOrder)
    ? plugin.settings.dashboardSectionOrder
    : [];
  const orderedAlmanacIds = [
    ...savedOrder.filter((id) => defaultAlmanacIds.includes(id)),
    ...defaultAlmanacIds.filter((id) => !savedOrder.includes(id))
  ];
  almanacDefs.sort((a, b) => orderedAlmanacIds.indexOf(a.id) - orderedAlmanacIds.indexOf(b.id));

  const hiddenMap = plugin.settings.dashboardSectionHidden || {};
  const isHidden = (id) => {
    if (typeof hiddenMap[id] === "boolean") return hiddenMap[id];
    return false;
  };

  const collapsedMap = plugin.settings.dashboardSectionCollapsed || {};
  const sectionsGrid = bodyWrap.createDiv("bangumi-dashboard-sections curator-almanac-grid");
  sectionsGrid._syncHalfWidthFillers = () => syncAlmanacHalfWidthFillers(sectionsGrid, items, state);

  const handleAlmanacReorder = async (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const fromIdx = orderedAlmanacIds.indexOf(sourceId);
    const toIdx = orderedAlmanacIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    // 采集当前各模块位置用于 FLIP 换位过渡动画
    const rectMap = new Map();
    sectionsGrid.querySelectorAll(".bangumi-dashboard-section[data-section-id]").forEach((el) => {
      rectMap.set(el.dataset.sectionId, el.getBoundingClientRect());
    });

    const nextAlmanacIds = [...orderedAlmanacIds];
    const tmp = nextAlmanacIds[fromIdx];
    nextAlmanacIds[fromIdx] = nextAlmanacIds[toIdx];
    nextAlmanacIds[toIdx] = tmp;

    const nonAlmanacIds = savedOrder.filter((id) => !defaultAlmanacIds.includes(id));
    plugin.settings.dashboardSectionOrder = [...nonAlmanacIds, ...nextAlmanacIds];
    await plugin.saveSettings();

    renderAlmanacSection(plugin, almanacMount, state, container, options, rectMap);
  };

  const visibleDefs = almanacDefs.filter((d) => !isHidden(d.id));
  let lastHalfWidthSectionEl = null;
  let halfWidthColCursor = 0;

  for (let i = 0; i < visibleDefs.length; i++) {
    const def = visibleDefs[i];
    const isCollapsed = Boolean(collapsedMap[def.id]);
    const isEffectiveFull = Boolean(def.spanFull || !def.hasData);

    // 若前一个半宽模块因用户隐藏了配对模块或将全宽模块拖入中间而落单，直接让该落单半宽模块横跨双列，绝不生成无标题幽灵副卡
    if (isEffectiveFull && halfWidthColCursor === 1 && lastHalfWidthSectionEl) {
      lastHalfWidthSectionEl.addClass("span-full");
      halfWidthColCursor = 0;
      lastHalfWidthSectionEl = null;
    }

    const secEl = plugin.createDashboardSection(sectionsGrid, {
      def,
      isCollapsed,
      onToggleCollapse: async () => {
        plugin.settings.dashboardSectionCollapsed = Object.assign({}, plugin.settings.dashboardSectionCollapsed, {
          [def.id]: !isCollapsed
        });
        await plugin.saveSettings();
        renderAlmanacSection(plugin, almanacMount, state, container, options);
      },
      onHide: async () => {
        plugin.settings.dashboardSectionHidden = Object.assign({}, plugin.settings.dashboardSectionHidden, {
          [def.id]: true
        });
        await plugin.saveSettings();
        renderAlmanacSection(plugin, almanacMount, state, container, options);
      },
      onReorder: handleAlmanacReorder
    });

    if (!isEffectiveFull) {
      halfWidthColCursor = (halfWidthColCursor + 1) % 2;
      lastHalfWidthSectionEl = halfWidthColCursor === 1 ? secEl : null;
    }
  }

  // 若末尾仍剩单数个半宽模块未配对，直接让其横跨双列，绝不生成幽灵重复压印卡
  if (halfWidthColCursor === 1 && lastHalfWidthSectionEl) {
    lastHalfWidthSectionEl.addClass("span-full");
  }

  // 执行模块拖拽换位后的 FLIP 平滑位移动画与半宽高度补白同步
  requestAnimationFrame(() => {
    syncAlmanacHalfWidthFillers(sectionsGrid, items, state);
    if (prevFlipRects && prevFlipRects.size > 0) {
      const movedEls = [];
      sectionsGrid.querySelectorAll(".bangumi-dashboard-section[data-section-id]").forEach((el) => {
        const sid = el.dataset.sectionId;
        const prev = prevFlipRects.get(sid);
        if (!prev) return;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.hypot(dx, dy) > 2) {
          el.style.transition = "none";
          el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          el.style.zIndex = "5";
          movedEls.push(el);
        }
      });
      if (movedEls.length > 0) {
        void sectionsGrid.offsetHeight;
        requestAnimationFrame(() => {
          movedEls.forEach((el) => {
            el.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 420ms ease";
            el.style.transform = "translate3d(0, 0, 0)";
          });
          setTimeout(() => {
            movedEls.forEach((el) => {
              if (!el.isConnected) return;
              el.style.transition = "";
              el.style.transform = "";
              el.style.zIndex = "";
            });
          }, 440);
        });
      }
    }
  });

  const hiddenDefs = almanacDefs.filter((d) => isHidden(d.id));
  if (hiddenDefs.length > 0) {
    const restoreBar = bodyWrap.createDiv("bangumi-dashboard-restore-bar");
    restoreBar.createSpan({ text: "已隐藏统计模块：" });
    for (const hDef of hiddenDefs) {
      const chip = restoreBar.createEl("button", {
        cls: "bangumi-dashboard-restore-chip",
        text: `+ 恢复 ${hDef.title}`
      });
      chip.onclick = async (e) => {
        e.preventDefault();
        plugin.settings.dashboardSectionHidden = Object.assign({}, plugin.settings.dashboardSectionHidden, {
          [hDef.id]: false
        });
        await plugin.saveSettings();
        renderAlmanacSection(plugin, almanacMount, state, container, options);
      };
    }
  }
}

function itemHasBothScores(it) {
  return (
    it.personalScore !== null &&
    (it.preciseScore !== null || it.publicScore !== null || it.bangumiScore !== null)
  );
}

/**
 * 更新顶栏的核心馆藏数字与快筛胶囊计数（支持原地局部刷新）
 */
function updateTopbarMetricsInPlace(plugin, container, state) {
  const metrics = computeDeskMetrics(state.items || []);
  const setRoleText = (role, val) => {
    const el = container.querySelector(`[data-stat-role="${role}"]`);
    if (el) el.textContent = String(val);
  };

  setRoleText("summary-total", `${metrics.total} 部`);
  setRoleText("summary-watching", `${metrics.stateCounts["在看"]}`);
  setRoleText("summary-completed", `${metrics.stateCounts["已看"]}`);
  setRoleText("summary-plan", `${metrics.stateCounts["想看"]}`);
  setRoleText("summary-myavg", `${metrics.personalAvg}`);
  setRoleText("summary-bgmavg", `${metrics.bgmAvg}`);

  // 更新快筛胶囊上的数字
  const filterCounts = {
    all: metrics.total,
    "在看": metrics.stateCounts["在看"],
    "已看": metrics.stateCounts["已看"],
    "想看": metrics.stateCounts["想看"],
    "抛弃": metrics.stateCounts["抛弃"]
  };
  container.querySelectorAll(".curator-filter-pill[data-filter-key]").forEach((pill) => {
    const key = pill.dataset.filterKey;
    const countSpan = pill.querySelector(".curator-pill-count");
    if (countSpan && Object.prototype.hasOwnProperty.call(filterCounts, key)) {
      countSpan.textContent = String(filterCounts[key]);
    }
  });
}

/**
 * 完整渲染二维“案头编目工作台 / Curator's Desk”
 */
async function renderCuratorDesk(plugin, container, options = {}, helpers = {}) {
  const scrollParent = plugin.getDashboardScrollParent(container);
  const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

  const state = ensureDeskState(plugin, container, options);
  const items = await plugin.collectDashboardItems();
  state.items = items;
  state.fullRenderCount = (state.fullRenderCount || 0) + 1;

  container.empty();
  container.addClass("curator-desk-root");
  const isMarkdown = Boolean(options && options.isMarkdown);
  if (isMarkdown) {
    container.dataset.markdownDashboard = "true";
    container._dashboardOptions = options;
  }

  // ==================== 1. 统一单一顶栏 (.curator-desk-topbar) ====================
  const topbar = container.createDiv("curator-desk-topbar");

  const topRow1 = topbar.createDiv("curator-topbar-row1");
  const brandCol = topRow1.createDiv("curator-brand-col");
  brandCol.createDiv({
    cls: "curator-brand-kicker",
    text: "番剧档案馆"
  });
  const titleLine = brandCol.createDiv("curator-brand-title-line");
  titleLine.createEl("h1", {
    cls: "curator-brand-title",
    text: "二维案头编目台"
  });

  // 紧凑核心馆藏摘要
  const metrics = computeDeskMetrics(items);
  const summaryStrip = topRow1.createDiv("curator-summary-strip");
  const summaryDefs = [
    { label: "所有收藏", val: `${metrics.total} 部`, role: "summary-total" },
    { label: "在看", val: `${metrics.stateCounts["在看"]}`, role: "summary-watching" },
    { label: "已看", val: `${metrics.stateCounts["已看"]}`, role: "summary-completed" },
    { label: "想看", val: `${metrics.stateCounts["想看"]}`, role: "summary-plan" },
    { label: "个人均分", val: `${metrics.personalAvg}`, role: "summary-myavg" },
    { label: "BGM 均分", val: `${metrics.bgmAvg}`, role: "summary-bgmavg" }
  ];
  summaryDefs.forEach((sd) => {
    const pill = summaryStrip.createDiv("curator-summary-pill");
    pill.createSpan({ cls: "curator-summary-label", text: sd.label });
    const valSpan = pill.createSpan({ cls: "curator-summary-val curator-mono", text: sd.val });
    valSpan.dataset.statRole = sd.role;
  });

  // 顶栏右侧主操作按钮组（仅保留全局级操作：刷新、恢复默认布局、打开 Markdown/番剧档案馆、三维原画档案室）
  const actionsCol = topRow1.createDiv("curator-topbar-actions");

  const refreshBtn = actionsCol.createEl("button", {
    cls: "curator-top-btn is-subtle",
    text: "刷新"
  });
  refreshBtn.onclick = async () => {
    refreshBtn.disabled = true;
    try {
      await plugin.refreshScoreDashboard(true);
      await renderCuratorDesk(plugin, container, options, helpers);
    } finally {
      refreshBtn.disabled = false;
    }
  };

  const resetBtn = actionsCol.createEl("button", {
    cls: "curator-top-btn is-subtle",
    text: "恢复默认布局"
  });
  resetBtn.onclick = async () => {
    state.workspaceMode = "auto";
    state.workspaceModeCustomized = false;
    state.searchQuery = "";
    state.statusFilter = "all";
    state.sortBy = "year_desc";
    state.viewMode = "gallery";
    state.deskTab = "auto";
    state.catalogExpanded = false;
    roxyMascotService.emitRoxyEvent(plugin, {
      type: "layout:reset_warn",
      state: "warn2",
      category: "布局重置",
      priority: roxyMascotService.PRIORITY.HIGH,
      message: "请注意，我已经把二维案头编目台的检索、筛选和分区排列全部还原成最初的默认状态了。"
    });
    await plugin.resetScoreDashboardLayout(container, options);
  };

  if (isMarkdown) {
    const openViewBtn = actionsCol.createEl("button", {
      cls: "curator-top-btn",
      text: "打开番剧档案馆"
    });
    openViewBtn.onclick = async () => {
      await plugin.openScoreDashboardView();
    };
  } else {
    const mdBtn = actionsCol.createEl("button", {
      cls: "curator-top-btn is-subtle",
      text: "打开 Markdown 档案馆"
    });
    mdBtn.onclick = async () => {
      await plugin.openScoreDashboard();
    };
  }

  // 进入三维原画档案室主入口按钮
  const enter3DBtn = actionsCol.createEl("button", {
    cls: "curator-top-btn is-3d-entry mod-cta",
    text: "🧊 三维原画档案室"
  });
  enter3DBtn.title = "进入番剧档案馆 · 三维原画档案室";
  enter3DBtn.onclick = async (e) => {
    e.preventDefault();
    if (typeof options?.onEnter3D === "function") {
      await options.onEnter3D();
    } else {
      await plugin.openScoreDashboardView();
      const leaves = plugin.app.workspace.getLeavesOfType("bangumi-score-dashboard-view");
      if (leaves.length > 0 && leaves[0].view && typeof leaves[0].view.enter3D === "function") {
        await leaves[0].view.enter3D();
      }
    }
  };
  if (typeof options?.bindToggle3DBtn === "function") {
    options.bindToggle3DBtn(enter3DBtn);
  }

  // ==================== 2. 统一案头编目主工作台 (.curator-unified-workspace) + 展柜 + 年鉴 ====================
  const watchingCount = Number(metrics.stateCounts["在看"]) || 0;
  const localUpdatedCount = computeLocalUpdatedItems(items).length;

  // 默认模式判定铁律：优先记忆用户上一次停留模式；若首次打开，有「在看」动画则默认「案头追番席」，否则默认「馆藏编目总览」
  let effectiveWorkspaceMode = "desk";
  if (
    state.workspaceModeCustomized &&
    (state.workspaceMode === "desk" ||
      state.workspaceMode === "catalog" ||
      state.workspaceMode === "character")
  ) {
    effectiveWorkspaceMode = state.workspaceMode;
  } else if (
    state.workspaceMode === "desk" ||
    state.workspaceMode === "catalog" ||
    state.workspaceMode === "character"
  ) {
    effectiveWorkspaceMode = state.workspaceMode;
  } else {
    effectiveWorkspaceMode = watchingCount > 0 ? "desk" : "catalog";
    state.workspaceMode = effectiveWorkspaceMode;
  }

  const unifiedWorkspace = container.createDiv("curator-unified-workspace");
  unifiedWorkspace.dataset.activeMode = effectiveWorkspaceMode;

  const modeBar = unifiedWorkspace.createDiv("curator-workspace-mode-bar");
  const modeTabs = modeBar.createDiv("curator-workspace-mode-tabs");

  const deskModeBtn = modeTabs.createEl("button", {
    cls: `curator-workspace-mode-btn ${effectiveWorkspaceMode === "desk" ? "is-active" : ""}`
  });
  deskModeBtn.dataset.workspaceMode = "desk";
  deskModeBtn.createSpan({ cls: "curator-ws-mode-icon", text: "📖" });
  deskModeBtn.createSpan({ cls: "curator-ws-mode-title", text: "案头追番席" });
  const deskModeBadge = deskModeBtn.createSpan({
    cls: "curator-ws-mode-badge curator-mono",
    text:
      localUpdatedCount > 0
        ? `在看 ${watchingCount} · 新更 ${localUpdatedCount}`
        : `在看 ${watchingCount} 部`
  });
  deskModeBadge.dataset.statRole = "workspace-desk-badge";

  const catalogModeBtn = modeTabs.createEl("button", {
    cls: `curator-workspace-mode-btn ${effectiveWorkspaceMode === "catalog" ? "is-active" : ""}`
  });
  catalogModeBtn.dataset.workspaceMode = "catalog";
  catalogModeBtn.createSpan({ cls: "curator-ws-mode-icon", text: "🗂️" });
  catalogModeBtn.createSpan({ cls: "curator-ws-mode-title", text: "馆藏编目总览" });
  const catalogModeBadge = catalogModeBtn.createSpan({
    cls: "curator-ws-mode-badge curator-mono",
    text: `所有收藏 ${metrics.total} 部`
  });
  catalogModeBadge.dataset.statRole = "workspace-catalog-badge";

  const charCount = Array.isArray(plugin.settings?.characterCollection)
    ? plugin.settings.characterCollection.length
    : 0;
  const charModeBtn = modeTabs.createEl("button", {
    cls: `curator-workspace-mode-btn ${effectiveWorkspaceMode === "character" ? "is-active" : ""}`
  });
  charModeBtn.dataset.workspaceMode = "character";
  charModeBtn.createSpan({ cls: "curator-ws-mode-icon", text: "👑" });
  charModeBtn.createSpan({ cls: "curator-ws-mode-title", text: "角色典藏阁" });
  const charModeBadge = charModeBtn.createSpan({
    cls: "curator-ws-mode-badge curator-mono",
    text: `角色 ${charCount} 位`
  });
  charModeBadge.dataset.statRole = "workspace-char-badge";

  const quickRibbon = modeBar.createDiv("curator-workspace-quick-ribbon");

  const workspaceStage = unifiedWorkspace.createDiv("curator-workspace-stage");
  const deskMount = workspaceStage.createDiv(
    `curator-mount-active-desk curator-workspace-pane ${
      effectiveWorkspaceMode === "desk" ? "is-workspace-pane-active" : "is-workspace-pane-hidden"
    }`
  );
  const catalogMount = workspaceStage.createDiv(
    `curator-mount-catalog curator-workspace-pane ${
      effectiveWorkspaceMode === "catalog" ? "is-workspace-pane-active" : "is-workspace-pane-hidden"
    }`
  );
  const characterMount = workspaceStage.createDiv(
    `curator-mount-character curator-workspace-pane ${
      effectiveWorkspaceMode === "character" ? "is-workspace-pane-active" : "is-workspace-pane-hidden"
    }`
  );

  const shelvesMount = container.createDiv("curator-mount-shelves");
  const almanacMount = container.createDiv("curator-mount-almanac");

  const renderQuickRibbon = () => {
    quickRibbon.empty();
    const curMetrics = computeDeskMetrics(state.items || []);
    const curWatching = Number(curMetrics.stateCounts["在看"]) || 0;
    const curLocalUpd = computeLocalUpdatedItems(state.items || []).length;
    const curCharCount = Array.isArray(plugin.settings?.characterCollection)
      ? plugin.settings.characterCollection.length
      : 0;
    if (deskModeBadge) {
      deskModeBadge.textContent =
        curLocalUpd > 0 ? `在看 ${curWatching} · 新更 ${curLocalUpd}` : `在看 ${curWatching} 部`;
    }
    if (catalogModeBadge) {
      catalogModeBadge.textContent = `所有收藏 ${curMetrics.total} 部`;
    }
    if (charModeBadge) {
      charModeBadge.textContent = `角色 ${curCharCount} 位`;
    }

    if (state.workspaceMode === "desk") {
      const hintSpan = quickRibbon.createSpan({
        cls: "curator-ws-ribbon-hint",
        text: "聚焦当季连载与本地剧集跟进"
      });
      hintSpan.title = "案头追番席专注于正在追番、本地视频更新与季度席位";

      const quickSearchBtn = quickRibbon.createEl("button", {
        cls: "curator-ws-quick-jump-btn",
        text: `⌕ 检索全部 ${curMetrics.total} 部馆藏 / 多维筛选 →`
      });
      quickSearchBtn.dataset.workspaceAction = "jump-to-catalog-search";
      quickSearchBtn.onclick = (e) => {
        e.preventDefault();
        switchWorkspaceMode("catalog", { focusSearch: true });
      };
    } else if (state.workspaceMode === "character") {
      quickRibbon.createSpan({
        cls: "curator-ws-ribbon-hint",
        text: "汇聚角色履历与萌娘百科萌点偏好洞察"
      });
      const backDeskBtn = quickRibbon.createEl("button", {
        cls: "curator-ws-quick-jump-btn",
        text: `← 返回案头追番席 (在看 ${curWatching} 部)`
      });
      backDeskBtn.onclick = (e) => {
        e.preventDefault();
        switchWorkspaceMode("desk");
      };
    } else {
      if (curMetrics.totalReviewsCount > 0) {
        quickRibbon.createSpan({
          cls: "curator-ws-ribbon-stat curator-mono",
          text: `💬 累计观片手札 ${curMetrics.totalReviewsCount} 条`
        });
      }
      const backDeskBtn = quickRibbon.createEl("button", {
        cls: "curator-ws-quick-jump-btn",
        text: `← 返回案头追番席 (在看 ${curWatching} 部)`
      });
      backDeskBtn.dataset.workspaceAction = "jump-to-desk";
      backDeskBtn.onclick = (e) => {
        e.preventDefault();
        switchWorkspaceMode("desk");
      };
    }
  };

  const switchWorkspaceMode = (nextMode, switchOpts = {}) => {
    const targetMode =
      nextMode === "catalog" ? "catalog" : nextMode === "character" ? "character" : "desk";
    const prevMode = state.workspaceMode;
    state.workspaceMode = targetMode;
    state.workspaceModeCustomized = true;

    let needCatalogRefresh = false;
    if (switchOpts.statusFilter !== undefined && state.statusFilter !== switchOpts.statusFilter) {
      state.statusFilter = switchOpts.statusFilter;
      needCatalogRefresh = true;
    }
    if (switchOpts.searchQuery !== undefined && state.searchQuery !== switchOpts.searchQuery) {
      state.searchQuery = switchOpts.searchQuery;
      needCatalogRefresh = true;
    }

    persistDeskPrefs(plugin, state);

    unifiedWorkspace.dataset.activeMode = targetMode;
    deskModeBtn.classList.toggle("is-active", targetMode === "desk");
    catalogModeBtn.classList.toggle("is-active", targetMode === "catalog");
    charModeBtn.classList.toggle("is-active", targetMode === "character");

    const animCls =
      targetMode === "catalog" || targetMode === "character"
        ? "is-switching-to-catalog"
        : "is-switching-to-desk";
    workspaceStage.classList.remove("is-switching-to-catalog", "is-switching-to-desk");

    deskMount.classList.toggle("is-workspace-pane-active", targetMode === "desk");
    deskMount.classList.toggle("is-workspace-pane-hidden", targetMode !== "desk");
    catalogMount.classList.toggle("is-workspace-pane-active", targetMode === "catalog");
    catalogMount.classList.toggle("is-workspace-pane-hidden", targetMode !== "catalog");
    characterMount.classList.toggle("is-workspace-pane-active", targetMode === "character");
    characterMount.classList.toggle("is-workspace-pane-hidden", targetMode !== "character");

    if (prevMode !== targetMode) {
      void workspaceStage.offsetWidth;
      workspaceStage.classList.add(animCls);
      setTimeout(() => {
        if (workspaceStage.isConnected) {
          workspaceStage.classList.remove(animCls);
        }
      }, 320);
    }

    if (targetMode === "catalog") {
      // 当从隐藏态切换到馆藏编目总览时，刷新一次以确保两排折叠列数基于真实可见宽度精确计算
      renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
      if (switchOpts.focusSearch) {
        requestAnimationFrame(() => {
          const sInput = catalogMount.querySelector(".curator-search-input");
          if (sInput) sInput.focus();
        });
      }
    } else if (targetMode === "character") {
      characterArchiveService.renderCharacterArchiveWorkspace(
        plugin,
        characterMount,
        state.items || [],
        { compactAlmanacMode: false }
      );
    } else if (needCatalogRefresh) {
      renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
    }

    renderQuickRibbon();

    if (switchOpts.scrollToWorkspace && typeof unifiedWorkspace.scrollIntoView === "function") {
      unifiedWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  deskModeBtn.onclick = (e) => {
    e.preventDefault();
    if (state.workspaceMode !== "desk") {
      switchWorkspaceMode("desk");
    }
  };

  catalogModeBtn.onclick = (e) => {
    e.preventDefault();
    if (state.workspaceMode !== "catalog") {
      switchWorkspaceMode("catalog");
    }
  };

  charModeBtn.onclick = (e) => {
    e.preventDefault();
    if (state.workspaceMode !== "character") {
      switchWorkspaceMode("character");
    }
  };

  const syncTopbarControls = () => {
    const searchInput = catalogMount.querySelector(".curator-search-input");
    const searchClearBtn = catalogMount.querySelector(".curator-search-clear");
    if (searchInput && searchInput.value !== (state.searchQuery || "")) {
      searchInput.value = state.searchQuery || "";
    }
    if (searchClearBtn) {
      searchClearBtn.classList.toggle("is-visible", Boolean(state.searchQuery));
    }
    catalogMount.querySelectorAll(".curator-filter-pill").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.filterKey === state.statusFilter);
    });
    catalogMount.querySelectorAll(".curator-mode-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.viewMode === state.viewMode);
    });
    renderQuickRibbon();
  };

  const runtimeHelpers = Object.assign({}, helpers, {
    syncTopbarControls,
    switchWorkspaceMode,
    renderQuickRibbon,
    unifiedWorkspace,
    deskMount,
    catalogMount,
    characterMount,
    shelvesMount,
    almanacMount
  });
  container._deskRuntime = runtimeHelpers;

  renderQuickRibbon();
  renderActiveDeskSection(plugin, deskMount, state, runtimeHelpers);
  renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
  if (effectiveWorkspaceMode === "character") {
    characterArchiveService.renderCharacterArchiveWorkspace(
      plugin,
      characterMount,
      state.items || [],
      { compactAlmanacMode: false }
    );
  }
  renderCustomShelvesSection(plugin, shelvesMount, state, container, options);
  renderAlmanacSection(plugin, almanacMount, state, container, options);

  // 挂载或刷新二维洛琪希馆藏记录员（低打扰、可最小化、可暂时隐藏、可永久关闭）
  roxyMascotService.mountRoxy2DMascot(plugin, container, state, runtimeHelpers);

  if (scrollParent && savedScrollTop > 0) {
    scrollParent.scrollTop = savedScrollTop;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
      });
    }
  }
}

/**
 * 局部增量更新：当集数 +1 / -1 / 修改个人评分 / 切换观看状态 / 增删标签 / 更新观片手札时，
 * 绝不清空整个二维仪表盘、不重新全量读取所有 Markdown、不跳回滚动顶部！
 */
function applyIncrementalDashboardUpdate(plugin, container, item, updates = {}) {
  if (!container || !container._deskState || !container._deskRuntime) {
    return false;
  }

  const scrollParent = plugin.getDashboardScrollParent(container);
  const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

  const state = container._deskState;
  const runtime = container._deskRuntime;
  state.incrementalUpdateCount = (state.incrementalUpdateCount || 0) + 1;

  // 1. 同步内存态中的对应条目引用
  if (Array.isArray(state.items) && item?.file?.path) {
    const target = state.items.find((it) => it.file?.path === item.file.path);
    if (target && target !== item) {
      if (updates.watchedEpisodes !== undefined) target.watchedEpisodes = item.watchedEpisodes;
      if (updates.state !== undefined) target.state = item.state;
      if (updates.score !== undefined) target.personalScore = item.personalScore;
      if (updates.addTag || updates.removeTag) target.tags = item.tags;
      if (updates.reviewsUpdated) target.reviews = item.reviews;
    }
  }

  // 2. 原地刷新顶栏核心统计、主工作台徽章与快筛胶囊计数
  updateTopbarMetricsInPlace(plugin, container, state);
  if (typeof runtime.renderQuickRibbon === "function") {
    runtime.renderQuickRibbon();
  }

  // 3. 原地更新该卡片/行在 DOM 中的进度、评分、状态显示
  if (item?.file?.path) {
    const escapedPath =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(item.file.path)
        : item.file.path.replace(/["\\]/g, "\\$&");
    const nodes = container.querySelectorAll(`[data-file-path="${escapedPath}"]`);
    const watched = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    const epText = totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`;
    const pct = totalNum > 0 ? Math.min(100, Math.round((watched / totalNum) * 100)) : (watched > 0 ? 50 : 0);
    const nextEp = totalNum > 0 ? Math.min(totalNum, watched + 1) : watched + 1;

    nodes.forEach((node) => {
      // 更新集数文本与进度条
      node.querySelectorAll(".bangumi-grid-ep-label, .bangumi-list-ep-label, .curator-ep-readout").forEach((el) => {
        el.textContent = epText;
      });
      const fill = node.querySelector(".curator-progress-fill");
      if (fill) {
        fill.style.width = `${pct}%`;
      }
      const deskIncBtn = node.querySelector(".curator-desk-card .curator-step-btn.is-inc");
      if (deskIncBtn) {
        deskIncBtn.textContent = totalNum > 0 && watched < totalNum ? `+1 (第${nextEp}话)` : "+";
      }

      // 更新状态徽章
      if (updates.state !== undefined) {
        const st = item.state || "未设置";
        node
          .querySelectorAll(".bangumi-grid-state-badge, .bangumi-list-state-pill, .curator-state-pill")
          .forEach((badge) => {
            badge.textContent = st;
            badge.className = badge.className.replace(/\bis-\S+/g, "").trim() + ` is-${st} is-interactive`;
          });
      }

      // 更新个人评分徽章
      if (updates.score !== undefined) {
        const pScore = item.personalScore;
        const bgmVal = item.preciseScore ?? item.publicScore ?? item.bangumiScore;
        node.querySelectorAll(".bangumi-grid-score-badge").forEach((badge) => {
          if (pScore !== null) {
            badge.textContent = `★ ${pScore.toFixed(1)}`;
            badge.classList.add("is-personal");
            badge.classList.remove("is-bgm");
          } else if (bgmVal !== null && bgmVal !== undefined) {
            badge.textContent = `BGM ${Number(bgmVal).toFixed(1)}`;
            badge.classList.add("is-bgm");
            badge.classList.remove("is-personal");
          } else {
            badge.textContent = "★ 评分";
          }
        });
        node.querySelectorAll(".curator-score-pill.is-personal").forEach((pill) => {
          pill.textContent = pScore !== null ? `★ ${pScore.toFixed(1)}` : "★ 评分";
          pill.classList.toggle("has-score", pScore !== null);
        });
        node.querySelectorAll(".curator-index-score-btn").forEach((btn) => {
          btn.textContent = pScore !== null ? `★ ${pScore.toFixed(1)}` : "未评分";
          btn.classList.toggle("bangumi-dashboard-score-none", pScore === null);
        });
      }
    });
  }

  // 4. 若观看状态、标签或观片手札变更，局部刷新案头追番席与目录区，不触碰顶栏和滚动条
  if (updates.state !== undefined || updates.addTag || updates.removeTag || updates.reviewsUpdated) {
    if (updates.state === "在看") {
      state.deskTab = "watching";
    }
    if (runtime.deskMount) {
      renderActiveDeskSection(plugin, runtime.deskMount, state, runtime);
    }
    if (
      updates.reviewsUpdated ||
      updates.addTag ||
      updates.removeTag ||
      (updates.state !== undefined && state.statusFilter && state.statusFilter !== "all")
    ) {
      if (runtime.catalogMount) {
        renderCatalogSection(plugin, runtime.catalogMount, state, runtime);
      }
    }
  }

  // 5. 原地刷新底部年鉴摘要条（若年鉴正处于展开状态则局部刷新年鉴内部）
  if (runtime.almanacMount) {
    renderAlmanacSection(plugin, runtime.almanacMount, state, container, state.options);
  }

  // 6. 向二维洛琪希馆藏记录员发送真实状态反馈（内置冷却与去重）
  if (item) {
    const watched = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    if (totalNum > 0 && watched > totalNum) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "progress:abnormal",
        state: "surprised",
        category: "集数核对",
        priority: roxyMascotService.PRIORITY.HIGH,
        dedupeKey: `abnormal:${item.file?.path || item.name}:${watched}`,
        message: `咦？《${item.name}》记录到第 ${watched} 话了，比总话数 ${totalNum} 话还要多呢，是不是记错集数了？`
      });
    } else if (updates.state === "已看") {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "state:completed",
        state: "success",
        category: "完结归档",
        priority: roxyMascotService.PRIORITY.HIGH,
        dedupeKey: `state:completed:${item.file?.path || item.name}`,
        message: `《${item.name}》已经顺利看完并归入「已看」典藏了，趁着印象还深刻，要不要顺手给它留个评分呢？`
      });
    } else if (updates.state === "在看") {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "state:watching",
        state: "success",
        category: "开始追番",
        priority: roxyMascotService.PRIORITY.HIGH,
        dedupeKey: `state:watching:${item.file?.path || item.name}`,
        message: `好的，我已经帮您把《${item.name}》放到案头「在看」席位了，接下来的连载进度就交给我来记录吧。`
      });
    } else if (updates.state !== undefined) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "state:changed",
        state: "explain",
        category: "状态变更",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `state:${updates.state}:${item.file?.path || item.name}`,
        message: `明白了，我已经把《${item.name}》的编目状态改成了「${item.state || "未设置"}」。`
      });
    } else if (updates.watchedEpisodes !== undefined) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "progress:update",
        state: "success",
        category: "进度登记",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `progress:${item.file?.path || item.name}:${watched}`,
        message:
          totalNum > 0 && watched === totalNum
            ? `《${item.name}》全部 ${totalNum} 话都已经看完了呢，辛苦了，需要把它移到「已看」案卷里吗？`
            : `好的，已经在案卷上帮您把《${item.name}》记到第 ${watched} 话了。`
      });
    } else if (updates.score !== undefined) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "score:update",
        state: "success",
        category: "评分登记",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `score:${item.file?.path || item.name}:${item.personalScore}`,
        message:
          item.personalScore !== null
            ? `已经在《${item.name}》的档案里记下 ★ ${item.personalScore.toFixed(1)} 分了，认真的评价以后翻看时一定很有参考价值。`
            : `好的，我已经先把《${item.name}》的个人评分清空了。`
      });
    } else if (updates.addTag || updates.removeTag) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "tag:update",
        state: "success",
        category: "标签整理",
        priority: roxyMascotService.PRIORITY.LOW,
        dedupeKey: `tag:${item.file?.path || item.name}:${updates.addTag || updates.removeTag}`,
        message: updates.addTag
          ? `已经为《${item.name}》贴上了 #${updates.addTag} 标签，以后检索起来会更方便呢。`
          : `已经把《${item.name}》上的 #${updates.removeTag} 标签摘下来了。`
      });
    }
  }

  if (scrollParent) {
    scrollParent.scrollTop = savedScrollTop;
  }
  return true;
}

/**
 * 二维“案头编目工作台 / Curator's Desk”专属样式（纸本档案室美学，与 3D 白昼原画室统一设计语言）
 */
function getCuratorDeskStyles() {
  return [
    /* 0. 消除 Obsidian ItemView 外层重复标题「动画仪表盘」与冗余留白，同时保留外层导航箭头与视图操作按钮 */
    ".workspace-leaf-content[data-type='bangumi-score-dashboard-view'] > .view-header{height:28px !important;min-height:28px !important;padding:0 10px !important;border-bottom:none !important;background:transparent !important;}",
    ".workspace-leaf-content[data-type='bangumi-score-dashboard-view'] > .view-header .view-header-title-container{visibility:hidden !important;pointer-events:none !important;}",
    ".workspace-leaf-content[data-type='bangumi-score-dashboard-view'] > .view-content.bangumi-score-dashboard-view{padding:4px 14px 28px !important;overflow-x:hidden !important;}",
    /* 容器级响应式工作台（宽屏提升约 14% 有效编目面积，同时保留两侧纸本台面呼吸留白，绝不产生横向溢出） */
    ".bangumi-score-dashboard{width:100%;max-width:100%;box-sizing:border-box;container-type:inline-size;container-name:curator-desk;}",
    ".curator-desk-root{width:min(96%, 1560px);max-width:1560px;margin:0 auto;padding:6px 8px 42px;color:var(--text-normal);box-sizing:border-box;}",
    ".curator-mono{font-variant-numeric:tabular-nums;font-family:var(--font-monospace, 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace);}",
    /* 1. 统一单一顶栏 */
    ".curator-desk-topbar{position:relative;z-index:5;margin:0 0 18px;padding:14px 18px;border-radius:12px;border:1px solid color-mix(in srgb, #b8966c 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 94%, #f4efe6 6%);box-shadow:0 6px 20px rgba(42,32,22,0.06);display:flex;flex-direction:column;gap:12px;}",
    ".curator-topbar-row1{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}",
    ".curator-brand-col{min-width:210px;}",
    ".curator-brand-kicker{font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-faint);font-weight:600;margin-bottom:2px;}",
    ".curator-brand-title{margin:0;font-size:1.26em;font-weight:700;letter-spacing:0.02em;color:var(--text-normal);}",
    ".curator-summary-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;justify-content:center;}",
    ".curator-summary-pill{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:6px;background:color-mix(in srgb, var(--background-secondary) 82%, #efe8dc 18%);border:1px solid var(--background-modifier-border);font-size:12px;}",
    ".curator-summary-label{color:var(--text-muted);font-size:11px;}",
    ".curator-summary-val{font-weight:700;color:var(--text-normal);font-size:12.5px;}",
    ".curator-topbar-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;}",
    ".curator-top-btn{cursor:pointer;padding:5px 11px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);transition:all .14s ease;}",
    ".curator-top-btn:hover{border-color:#9e784b;color:#9e784b;background:var(--background-modifier-hover);}",
    ".curator-top-btn.is-subtle{font-weight:500;color:var(--text-muted);background:transparent;}",
    ".curator-top-btn.is-3d-entry{background:linear-gradient(135deg,#8f683d,#b08450);color:#fffdf9 !important;border-color:#8f683d;box-shadow:0 2px 8px rgba(143,104,61,0.25);}",
    ".curator-top-btn.is-3d-entry:hover{filter:brightness(1.07);transform:translateY(-1px);}",
    /* 馆藏编目总览头部内嵌检索、快筛与视图切换工具栏 */
    ".curator-catalog-header{margin-bottom:8px;}",
    ".curator-catalog-header-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-catalog-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px;border-radius:9px;border:1px solid color-mix(in srgb, #9e784b 24%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f6f0e4 28%);}",
    ".curator-search-wrap{position:relative;display:flex;align-items:center;flex:1 1 280px;max-width:440px;}",
    ".curator-search-icon{position:absolute;left:10px;color:var(--text-faint);font-size:13px;pointer-events:none;}",
    ".curator-search-input{width:100%;padding:6px 28px 6px 30px !important;font-size:12.5px !important;border-radius:7px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-primary) !important;}",
    ".curator-search-input:focus{border-color:#9e784b !important;box-shadow:0 0 0 2px rgba(158,120,75,0.16) !important;}",
    ".curator-search-clear{position:absolute;right:6px;width:20px;height:20px;padding:0;border:none;background:transparent;color:var(--text-muted);cursor:pointer;display:none;align-items:center;justify-content:center;font-size:14px;border-radius:50%;}",
    ".curator-search-clear.is-visible{display:inline-flex;}",
    ".curator-search-clear:hover{background:var(--background-modifier-hover);color:var(--text-normal);}",
    ".curator-filter-bar{display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1.2 1 auto;}",
    ".curator-filter-pill{cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:12px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-muted);transition:all .14s ease;}",
    ".curator-filter-pill:hover{border-color:#9e784b;color:var(--text-normal);}",
    ".curator-filter-pill.is-active{background:#8f683d;border-color:#8f683d;color:#fffdf9;font-weight:600;}",
    ".curator-filter-pill.is-active .curator-pill-count{background:rgba(255,255,255,0.22);color:#fffdf9;}",
    ".curator-pill-count{font-size:11px;padding:0 5px;border-radius:999px;background:var(--background-secondary);color:var(--text-faint);}",
    ".curator-view-controls{display:flex;align-items:center;gap:8px;flex-shrink:0;}",
    ".curator-sort-select{font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);}",
    ".curator-mode-toggle-group{display:inline-flex;border-radius:7px;border:1px solid var(--background-modifier-border);overflow:hidden;background:var(--background-secondary);}",
    ".curator-mode-btn{cursor:pointer;padding:4px 10px;font-size:12px;border:none;background:transparent;color:var(--text-muted);font-weight:500;transition:all .14s ease;}",
    ".curator-mode-btn.is-active{background:#8f683d;color:#fffdf9;font-weight:600;}",
    /* 馆藏编目总览两排折叠与展开交互条 */
    ".curator-gallery-card.is-hidden-by-fold{display:none !important;}",
    ".curator-catalog-fold-bar{display:flex;justify-content:center;margin:4px 0 18px;padding-top:4px;}",
    ".curator-catalog-fold-btn{cursor:pointer;width:100%;max-width:480px;padding:7px 18px;border-radius:999px;border:1px dashed color-mix(in srgb, #8f683d 52%, var(--background-modifier-border));background:color-mix(in srgb, #8f683d 8%, var(--background-secondary));color:#8f683d;font-size:12px;font-weight:600;letter-spacing:0.02em;transition:all .16s ease;}",
    ".curator-catalog-fold-btn:hover{border-style:solid;border-color:#8f683d;background:#8f683d;color:#fffdf9;box-shadow:0 4px 12px rgba(143,104,61,0.22);transform:translateY(-1px);}",
    /* 收藏展柜与自定义分区头部右侧按钮组及空状态引导条 */
    ".curator-shelves-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-shelves-empty-bar{padding:14px 18px;margin-bottom:14px;border-radius:9px;border:1px dashed color-mix(in srgb, #9e784b 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 64%, #f7f1e6 36%);text-align:center;color:var(--text-muted);font-size:12px;}",
    /* 通用区块头 */
    ".curator-section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:16px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--background-modifier-border);}",
    ".curator-section-title-wrap{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}",
    ".curator-section-kicker{font-size:10px;letter-spacing:0.14em;color:#9e784b;font-weight:700;text-transform:uppercase;}",
    ".curator-section-title{margin:0;font-size:1.14em;font-weight:700;}",
    ".curator-section-badge{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);color:var(--text-muted);}",
    ".curator-section-badge.is-watching-active{background:rgba(43,114,185,0.12);border-color:rgba(43,114,185,0.3);color:#2b72b9;font-weight:600;}",
    /* 2. 首屏：案头追番席（支持横向左右滑动、多季度自定义标签、本地更新徽章与下载助手） */
    ".curator-mount-active-desk{margin-bottom:18px;padding:12px 16px 14px;border-radius:12px;border:1px solid color-mix(in srgb, #9e784b 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 68%, #f7f2e9 32%);}",
    ".curator-mount-active-desk .curator-section-header{margin-top:0;margin-bottom:10px;}",
    ".curator-desk-controls-wrap{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;flex:1 1 auto;}",
    ".curator-desk-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}",
    ".curator-desk-tab-btn{cursor:pointer;padding:3px 10px;font-size:11.5px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-muted);transition:all .14s ease;}",
    ".curator-desk-tab-btn:hover{border-color:#9e784b;color:var(--text-normal);}",
    ".curator-desk-tab-btn.is-active{border-color:#8f683d;background:color-mix(in srgb, #8f683d 14%, var(--background-primary));color:var(--text-normal);font-weight:600;}",
    ".curator-desk-tab-btn.is-season-tab{border-style:solid;border-color:color-mix(in srgb, #9e784b 36%, var(--background-modifier-border));}",
    ".curator-desk-tab-btn.is-manage-seasons{border:1px dashed rgba(143,104,61,0.55);color:#8f683d;background:rgba(143,104,61,0.06);font-weight:600;}",
    ".curator-desk-tab-btn.is-manage-seasons:hover{background:#8f683d;color:#fffdf9;border-style:solid;}",
    ".curator-desk-nav-bar{display:inline-flex;align-items:center;gap:5px;margin-left:auto;}",
    ".curator-desk-scroll-btn{cursor:pointer;width:26px;height:25px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);transition:all .12s ease;}",
    ".curator-desk-scroll-btn:hover{border-color:#8f683d;background:#8f683d;color:#fffdf9;}",
    ".curator-desk-layout-btn{cursor:pointer;padding:3px 9px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-muted);transition:all .12s ease;}",
    ".curator-desk-layout-btn:hover{border-color:#8f683d;color:#8f683d;}",
    ".curator-desk-fallback-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 11px;margin-bottom:10px;border-radius:7px;border:1px dashed color-mix(in srgb, #9e784b 45%, var(--background-modifier-border));background:color-mix(in srgb, #9e784b 6%, var(--background-primary));font-size:11.5px;color:var(--text-muted);}",
    ".curator-desk-fallback-text{display:flex;align-items:center;gap:7px;line-height:1.4;}",
    ".curator-fallback-dot{color:#9e784b;font-weight:bold;}",
    ".curator-desk-grid.is-watching-grid.is-grid-expanded{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;}",
    ".curator-desk-grid.is-standby-grid.is-grid-expanded{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:10px;}",
    ".curator-desk-grid.is-horizontal-scroll{display:flex !important;flex-wrap:nowrap !important;overflow-x:auto !important;overflow-y:hidden !important;gap:12px;padding-bottom:6px;scroll-behavior:smooth;scroll-snap-type:x proximity;scrollbar-width:thin;}",
    ".curator-desk-grid.is-horizontal-scroll::-webkit-scrollbar{height:6px;}",
    ".curator-desk-grid.is-horizontal-scroll::-webkit-scrollbar-thumb{background:rgba(143,104,61,0.34);border-radius:999px;}",
    ".curator-desk-grid.is-horizontal-scroll .curator-desk-card{flex:0 0 356px;max-width:356px;scroll-snap-align:start;}",
    ".curator-desk-grid.is-horizontal-scroll .curator-desk-card.is-standby-card{flex:0 0 300px;max-width:300px;}",
    ".curator-local-ep-pill{display:inline-flex;align-items:center;padding:1px 6px;font-size:10.5px;font-weight:600;border-radius:4px;cursor:pointer;background:rgba(58,125,92,0.12);color:#3a7d5c;border:1px solid rgba(58,125,92,0.3);}",
    ".curator-local-ep-pill.has-new{background:rgba(198,116,32,0.16);color:#b35c0e;border-color:rgba(198,116,32,0.42);}",
    ".curator-standby-right-actions{display:inline-flex;align-items:center;gap:6px;}",
    ".curator-standby-note-btn.is-dl{color:#8f683d;font-weight:600;}",
    ".curator-action-link.is-download{border-color:rgba(143,104,61,0.42);color:#8f683d;font-weight:600;}",
    ".curator-empty-actions{margin-top:10px;display:flex;justify-content:center;gap:8px;}",
    ".curator-desk-card{display:flex;gap:11px;padding:10px;border-radius:9px;border:1px solid var(--background-modifier-border);background:var(--background-primary);transition:border-color .15s ease,box-shadow .15s ease;}",
    ".curator-desk-card.is-standby-card{padding:9px 10px;align-items:stretch;}",
    ".curator-desk-card:hover{border-color:#9e784b;box-shadow:0 4px 14px rgba(42,32,22,0.08);}",
    ".curator-desk-cover-wrap{position:relative;flex:0 0 80px;width:80px;height:114px;border-radius:6px;overflow:hidden;background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);cursor:pointer;}",
    ".curator-desk-card.is-standby-card .curator-desk-cover-wrap{flex:0 0 68px;width:68px;height:96px;}",
    ".curator-desk-cover{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-edition-stamp{position:absolute;bottom:4px;left:4px;right:4px;text-align:center;padding:1px 4px;font-size:9.5px;font-weight:700;border-radius:3px;background:rgba(36,28,20,0.84);color:#f7ebd4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".curator-desk-card-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:4px;}",
    ".curator-desk-top-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;}",
    ".curator-state-pill{display:inline-flex;align-items:center;padding:1px 7px;font-size:11px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid transparent;}",
    ".curator-state-pill.is-在看{background:rgba(43,114,185,0.15);color:#2b72b9;border-color:rgba(43,114,185,0.32);}",
    ".curator-state-pill.is-已看{background:rgba(58,125,92,0.15);color:#3a7d5c;border-color:rgba(58,125,92,0.32);}",
    ".curator-state-pill.is-想看{background:rgba(176,120,56,0.16);color:#9c6528;border-color:rgba(176,120,56,0.34);}",
    ".curator-state-pill.is-抛弃{background:rgba(120,110,105,0.15);color:var(--text-muted);border-color:var(--background-modifier-border);}",
    ".curator-quick-watch-btn{cursor:pointer;padding:2px 9px;font-size:11px;border-radius:5px;border:1px solid rgba(143,104,61,0.48);background:rgba(143,104,61,0.12);color:#8f683d;font-weight:600;transition:all .14s ease;}",
    ".curator-quick-watch-btn:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-standby-footer{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:auto;padding-top:4px;border-top:1px dashed color-mix(in srgb, var(--background-modifier-border) 65%, transparent);}",
    ".curator-standby-note-btn{cursor:pointer;padding:1px 4px;font-size:11px;border:none;background:transparent;color:var(--text-muted);transition:color .12s ease;}",
    ".curator-standby-note-btn:hover{color:#8f683d;text-decoration:underline;}",
    ".curator-desk-score-group{display:flex;align-items:center;gap:5px;margin-left:auto;}",
    ".curator-score-pill{font-size:11px;padding:1px 6px;border-radius:4px;font-variant-numeric:tabular-nums;}",
    ".curator-score-pill.is-personal{cursor:pointer;background:var(--background-secondary);border:1px solid var(--background-modifier-border);color:var(--text-muted);font-weight:600;}",
    ".curator-score-pill.is-personal.has-score{background:rgba(143,104,61,0.15);border-color:rgba(143,104,61,0.4);color:#8f683d;}",
    ".curator-score-pill.is-bgm{color:var(--text-faint);font-size:10.5px;}",
    ".curator-desk-title{font-size:0.93em;font-weight:700;color:var(--text-normal);line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;text-decoration:none;}",
    ".curator-desk-title:hover{color:#8f683d;text-decoration:underline;}",
    ".curator-desk-subrow{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;overflow:hidden;font-size:11px;color:var(--text-muted);}",
    ".curator-subtitle-chip{padding:0 5px;border-radius:3px;background:var(--background-secondary);color:#8f683d;font-weight:600;flex-shrink:0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-meta-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-desk-progress-box{display:flex;flex-direction:column;gap:4px;margin-top:2px;}",
    ".curator-progress-track{height:5px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;}",
    ".curator-progress-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#8f683d,#c2955f);transition:width .2s ease;}",
    ".curator-desk-progress-controls{display:flex;align-items:center;justify-content:space-between;gap:6px;}",
    ".curator-ep-stepper{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-step-btn{cursor:pointer;height:21px;padding:0 7px;font-size:11px;font-weight:600;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);transition:all .12s ease;}",
    ".curator-step-btn:hover{border-color:#8f683d;background:#8f683d;color:#fff;}",
    ".curator-ep-readout{font-size:11.5px;font-weight:600;padding:0 4px;cursor:pointer;font-variant-numeric:tabular-nums;}",
    ".curator-desk-actions-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px;}",
    ".curator-action-link{cursor:pointer;padding:2px 7px;font-size:11px;border-radius:4px;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-muted);transition:all .12s ease;}",
    ".curator-action-link:hover{border-color:#8f683d;color:var(--text-normal);background:var(--background-modifier-hover);}",
    ".curator-action-link.is-primary{border-color:#8f683d;background:rgba(143,104,61,0.12);color:#8f683d;font-weight:600;}",
    /* 3. 画廊封面模式 (.curator-gallery-grid) —— 纸本封套风格，严格固定层级高度，消除底部按钮墙 */
    ".curator-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px;padding:4px 0 12px;align-items:stretch;}",
    ".curator-gallery-card{display:flex !important;flex-direction:column !important;border-radius:7px !important;border:1px solid color-mix(in srgb, #9e784b 22%, var(--background-modifier-border)) !important;background:var(--background-primary) !important;box-shadow:0 2px 6px rgba(30,22,14,0.04);}",
    ".curator-gallery-card:hover{transform:translateY(-2px) !important;border-color:#8f683d !important;box-shadow:0 8px 18px rgba(42,32,22,0.11) !important;}",
    ".curator-gallery-edition-badge{position:absolute;bottom:30px;left:6px;padding:2px 6px;font-size:10px;font-weight:700;border-radius:3px;background:rgba(34,26,18,0.86);color:#f6e7cf;border:1px solid rgba(213,168,91,0.45);z-index:3;pointer-events:none;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-gallery-info{display:flex !important;flex-direction:column !important;gap:2px !important;padding:8px 9px 7px !important;flex:1 1 auto;}",
    ".curator-gallery-title{font-size:12.5px !important;font-weight:650 !important;line-height:1.34 !important;height:2.68em !important;min-height:2.68em !important;max-height:2.68em !important;display:-webkit-box !important;-webkit-line-clamp:2 !important;-webkit-box-orient:vertical !important;overflow:hidden !important;margin:0 !important;}",
    ".curator-gallery-distinguisher{font-size:11px;font-weight:600;color:#8f683d;line-height:1.35;height:1.35em;min-height:1.35em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-gallery-meta{font-size:11px !important;color:var(--text-muted) !important;line-height:1.35 !important;height:1.35em !important;min-height:1.35em !important;overflow:hidden !important;text-overflow:ellipsis !important;white-space:nowrap !important;margin:0 !important;}",
    ".curator-gallery-footer{display:flex;align-items:center;justify-content:space-between;gap:4px;height:22px;min-height:22px;margin-top:4px;padding-top:3px;border-top:1px dashed color-mix(in srgb, var(--background-modifier-border) 62%, transparent);overflow:hidden;}",
    ".curator-gallery-tags-inline{display:flex !important;flex-wrap:nowrap !important;align-items:center !important;gap:3px !important;min-width:0;flex:1 1 auto;overflow:hidden;white-space:nowrap;margin:0 !important;padding:0 !important;}",
    ".curator-gallery-tag-chip{display:inline-flex !important;align-items:center;gap:2px;padding:0 4px !important;height:18px;font-size:10px !important;border-radius:3px !important;border:none !important;background:color-mix(in srgb, var(--background-secondary) 85%, #efe7da 15%) !important;color:var(--text-muted) !important;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}",
    ".curator-gallery-add-tag{width:16px !important;height:16px !important;padding:0 !important;font-size:11px !important;line-height:1 !important;border-radius:3px !important;border:1px dashed var(--background-modifier-border) !important;background:transparent !important;color:var(--text-faint) !important;cursor:pointer;flex-shrink:0;opacity:0.65;transition:opacity .12s ease,color .12s ease;}",
    ".curator-gallery-card:hover .curator-gallery-add-tag{opacity:1;color:#8f683d;border-color:#8f683d !important;}",
    ".curator-gallery-quiet-actions{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;opacity:0.62;transition:opacity .14s ease;}",
    ".curator-gallery-card:hover .curator-gallery-quiet-actions{opacity:1;}",
    ".curator-gallery-quiet-link{cursor:pointer;padding:0 2px;border:none;background:transparent;font-size:10.5px;color:var(--text-muted);line-height:1.2;transition:color .12s ease;}",
    ".curator-gallery-quiet-link:hover{color:#8f683d;text-decoration:underline;}",
    ".curator-gallery-quiet-link.is-play{color:#8f683d;font-weight:600;}",
    /* 4. 编目索引模式 (.curator-index-table-wrap) */
    ".curator-index-table-wrap{border:1px solid var(--background-modifier-border);border-radius:9px;overflow-x:auto;overflow-y:hidden;background:var(--background-primary);margin-bottom:14px;}",
    ".curator-index-header-row,.curator-index-row{display:grid;grid-template-columns:64px 50px minmax(220px,2.4fr) minmax(130px,1.2fr) 74px 126px 86px 96px 124px;gap:10px;align-items:center;padding:8px 12px;min-width:860px;}",
    ".curator-index-header-row{background:var(--background-secondary);border-bottom:1px solid var(--background-modifier-border);font-size:11.5px;font-weight:700;color:var(--text-muted);user-select:none;}",
    ".curator-index-row{border-bottom:1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent);font-size:12.5px;transition:background-color .12s ease;}",
    ".curator-index-row:last-child{border-bottom:none;}",
    ".curator-index-row:hover{background:var(--background-modifier-hover);}",
    ".curator-index-seq{font-weight:700;color:var(--text-muted);font-size:12px;}",
    ".curator-index-bgmid{font-size:10.5px;color:var(--text-faint);}",
    ".curator-index-thumb-wrap{width:38px;height:54px;border-radius:4px;overflow:hidden;background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".curator-index-thumb{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-index-title-line{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;line-height:1.38;}",
    ".curator-index-title-link{font-weight:600;color:var(--text-normal);white-space:normal;word-break:break-word;cursor:pointer;}",
    ".curator-index-title-link:hover{color:#8f683d;text-decoration:underline;}",
    ".curator-index-edition-pill{font-size:10.5px;font-weight:700;padding:0 5px;border-radius:3px;background:rgba(143,104,61,0.16);color:#8f683d;border:1px solid rgba(143,104,61,0.35);white-space:nowrap;}",
    ".curator-index-subtitle-pill{font-size:10.5px;padding:0 5px;border-radius:3px;background:var(--background-secondary);color:var(--text-muted);white-space:nowrap;}",
    ".curator-index-jp-title{font-size:11px;color:var(--text-faint);margin-top:2px;white-space:normal;word-break:break-word;}",
    ".curator-index-season-text{font-size:12px;color:var(--text-normal);}",
    ".curator-index-studio-text{font-size:11px;color:var(--text-muted);margin-top:2px;}",
    ".curator-index-ep-ctrl{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-index-bgm-val{font-weight:600;color:var(--text-normal);}",
    ".curator-index-delta{margin-left:5px;font-size:10.5px;padding:0 4px;border-radius:3px;}",
    ".curator-index-delta.is-plus{background:rgba(40,167,69,0.14);color:var(--color-green,#28a745);}",
    ".curator-index-delta.is-minus{background:rgba(235,87,87,0.14);color:var(--text-error,#eb5757);}",
    ".col-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}",
    ".curator-table-action-btn{cursor:pointer;padding:2px 7px;font-size:11px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);}",
    ".curator-table-action-btn:hover{border-color:#8f683d;color:#8f683d;}",
    /* 5. 底部馆藏统计与洞察年鉴 (.curator-mount-almanac) —— 纸本台账章节视觉 */
    ".curator-mount-almanac{margin-top:26px;padding:14px 16px;border-radius:12px;border:1px solid color-mix(in srgb, #9e784b 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 76%, #f6efe4 24%);}",
    ".curator-mount-almanac .curator-section-header{margin-top:0;}",
    ".curator-almanac-toggle-btn{cursor:pointer;padding:4px 12px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid #8f683d;background:rgba(143,104,61,0.1);color:#8f683d;transition:all .14s ease;}",
    ".curator-almanac-toggle-btn:hover,.curator-almanac-toggle-btn.is-expanded{background:#8f683d;color:#fffdf9;}",
    ".curator-almanac-summary-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:8px;}",
    ".curator-almanac-summary-cell{padding:10px 12px;border-radius:8px;background:var(--background-primary);border:1px solid color-mix(in srgb, #9e784b 20%, var(--background-modifier-border));}",
    ".curator-almanac-cell-label{font-size:11px;color:var(--text-muted);margin-bottom:4px;}",
    ".curator-almanac-cell-value{font-size:13px;font-weight:700;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-almanac-body.is-collapsed{display:none;}",
    ".curator-almanac-body.is-open{margin-top:16px;padding-top:14px;border-top:1px dashed color-mix(in srgb, #9e784b 38%, var(--background-modifier-border));}",
    ".curator-almanac-grid{align-items:stretch !important;}",
    ".curator-almanac-grid .bangumi-dashboard-section{margin:0 !important;min-width:0 !important;overflow:hidden;display:flex;flex-direction:column;border-radius:9px !important;border:1px solid color-mix(in srgb, #9e784b 22%, var(--background-modifier-border)) !important;border-left:3px solid rgba(143,104,61,0.58) !important;background:var(--background-primary) !important;}",
    ".curator-almanac-grid .bangumi-dashboard-section.is-collapsed{height:auto !important;align-self:start;}",
    ".curator-almanac-grid .bangumi-dashboard-section-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}",
    /* 观看状态概览增强光谱条与推进遥测 */
    ".bangumi-dashboard-state-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;}",
    ".bangumi-dashboard-state-pct{font-size:10.5px;padding:0 5px;border-radius:999px;background:color-mix(in srgb, #8f683d 12%, var(--background-primary));color:#8f683d;font-weight:600;}",
    ".curator-watchstate-extra{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding-top:10px;border-top:1px dashed color-mix(in srgb, #9e784b 30%, var(--background-modifier-border));}",
    ".curator-watchstate-spectrum-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;}",
    ".curator-watchstate-spectrum-title{font-weight:600;color:var(--text-muted);}",
    ".curator-watchstate-spectrum-meta{font-weight:700;color:#8f683d;}",
    ".curator-watchstate-spectrum-bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--background-modifier-border);gap:1px;}",
    ".curator-watchstate-seg{height:100%;transition:width .25s ease;}",
    ".curator-watchstate-seg.is-completed{background:#3a7d5c;}",
    ".curator-watchstate-seg.is-watching{background:#2b72b9;}",
    ".curator-watchstate-seg.is-plan{background:#b8843d;}",
    ".curator-watchstate-seg.is-dropped{background:#8c827a;}",
    ".curator-watchstate-telemetry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:2px;}",
    ".curator-watchstate-telemetry-cell{padding:7px 9px;border-radius:7px;background:color-mix(in srgb, var(--background-secondary) 72%, #f5ede0 28%);border:1px solid color-mix(in srgb, #9e784b 20%, var(--background-modifier-border));}",
    ".curator-watchstate-tele-label{font-size:10.5px;color:var(--text-muted);margin-bottom:2px;}",
    ".curator-watchstate-tele-val{font-size:11.5px;font-weight:700;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    /* 第 8 项模块：馆藏标签与话数体量 + 洛琪希魔导典藏手记余白画幅 */
    ".curator-tag-volume-body{display:flex;flex-direction:column;gap:12px;flex:1 1 auto;}",
    ".curator-almanac-subblock{display:flex;flex-direction:column;gap:7px;}",
    ".curator-almanac-subhead{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
    ".curator-almanac-subtitle{font-size:11.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-almanac-submeta{font-size:10.5px;color:var(--text-muted);}",
    ".curator-almanac-tag-cloud{display:flex;flex-wrap:wrap;gap:6px;}",
    ".curator-almanac-tag-chip{cursor:pointer;display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:3px 9px;border-radius:999px;border:1px solid color-mix(in srgb, #9e784b 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 78%, #f6efe3 22%);color:var(--text-normal);font-size:11.5px;transition:all .14s ease;}",
    ".curator-almanac-tag-chip:hover{border-color:#8f683d;background:#8f683d;color:#fffdf9;transform:translateY(-1px);}",
    ".curator-almanac-tag-chip:hover .curator-almanac-tag-count,.curator-almanac-tag-chip:hover .curator-almanac-tag-score{color:#fffdf9;background:rgba(255,255,255,0.2);}",
    ".curator-almanac-tag-chip.is-top-tag{border-color:rgba(143,104,61,0.48);background:color-mix(in srgb, #8f683d 10%, var(--background-primary));}",
    ".curator-almanac-tag-name{font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-almanac-tag-count{font-size:10px;padding:0 5px;border-radius:999px;background:var(--background-primary);color:var(--text-muted);}",
    ".curator-almanac-tag-score{font-size:10px;font-weight:700;color:#8f683d;}",
    ".curator-almanac-volume-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}",
    ".curator-almanac-volume-cell{padding:7px 10px;border-radius:7px;border:1px solid color-mix(in srgb, #9e784b 20%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 55%, var(--background-primary));display:flex;flex-direction:column;gap:4px;}",
    ".curator-almanac-volume-top{display:flex;align-items:center;justify-content:space-between;gap:4px;font-size:11px;}",
    ".curator-almanac-volume-label{font-weight:600;color:var(--text-normal);}",
    ".curator-almanac-volume-range{font-size:10px;color:var(--text-faint);}",
    ".curator-almanac-volume-mid{display:flex;align-items:baseline;justify-content:space-between;font-size:12px;}",
    ".curator-almanac-volume-val{font-weight:700;color:#8f683d;}",
    ".curator-almanac-volume-pct{font-size:10.5px;color:var(--text-muted);}",
    ".curator-almanac-volume-track{height:4px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;}",
    ".curator-almanac-volume-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#3b6998,#8f683d);}",
    /* 洛琪希魔导典藏手记 · 严格高度锁死、三尺寸自适应 (micro / compact / full) 与案头静物画幅 */
    ".curator-roxy-grimoire-filler{display:flex;flex-direction:column;position:relative;overflow:hidden;box-sizing:border-box;margin:0;padding:0;min-height:0;}",
    ".curator-roxy-grimoire-filler.is-auto-spacer{display:none;}",
    ".curator-roxy-grimoire-filler.is-auto-spacer.is-active{display:flex;}",
    ".curator-roxy-grimoire-companion{padding:12px 14px !important;justify-content:stretch;}",
    ".curator-roxy-grimoire-divider{display:flex;align-items:center;justify-content:center;margin-bottom:6px;flex:0 0 auto;position:relative;}",
    ".curator-roxy-grimoire-divider::before,.curator-roxy-grimoire-divider::after{content:'';flex:1;border-bottom:1px dashed color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));}",
    ".curator-roxy-grimoire-divider-text{padding:0 10px;font-size:9.5px;font-weight:700;letter-spacing:0.12em;color:#8f683d;opacity:0.85;}",
    ".curator-roxy-micro-strip{display:none;position:relative;z-index:2;flex:1 1 auto;min-height:0;align-items:center;justify-content:space-between;gap:10px;padding:6px 12px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:linear-gradient(90deg, color-mix(in srgb, var(--background-primary) 90%, #f7efe2 10%) 0%, color-mix(in srgb, var(--background-secondary) 62%, #ece0ca 38%) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.6);overflow:hidden;}",
    ".curator-roxy-micro-seal{flex:0 0 28px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(99,30,21,0.24));}",
    ".curator-roxy-micro-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden;}",
    ".curator-roxy-micro-kicker{font-size:9px;font-weight:800;letter-spacing:0.12em;color:#3b6998;text-transform:uppercase;line-height:1.1;}",
    ".curator-roxy-micro-inscription{font-size:11.5px;font-style:italic;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;}",
    ".curator-roxy-micro-actions{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;}",
    ".curator-roxy-micro-btn{cursor:pointer;padding:2px 7px;font-size:10px;font-weight:600;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 88%, #f6efe3 12%);color:#8f683d;transition:all .14s ease;}",
    ".curator-roxy-micro-btn:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-roxy-micro-btn.is-close{border-style:dashed;border-color:color-mix(in srgb, #3b6998 45%, var(--background-modifier-border));color:#3b6998;}",
    ".curator-roxy-micro-btn.is-close:hover{border-style:solid;background:#3b6998;color:#fffdf9;border-color:#3b6998;}",
    ".curator-roxy-grimoire-filler.is-size-micro .curator-roxy-grimoire-divider,.curator-roxy-grimoire-filler.is-size-micro .curator-roxy-grimoire-canvas{display:none !important;}",
    ".curator-roxy-grimoire-filler.is-size-micro .curator-roxy-micro-strip{display:flex !important;}",
    ".curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-divider,.curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-stamps{display:none !important;}",
    ".curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-canvas{padding:8px 11px;}",
    ".curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-art-box{flex:0 0 112px;width:112px;}",
    ".curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-art{max-height:84px;}",
    ".curator-roxy-grimoire-filler.is-size-compact .curator-roxy-grimoire-quote{padding:5px 8px;font-size:11.2px;line-height:1.38;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}",
    ".curator-roxy-grimoire-canvas{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:linear-gradient(180deg, color-mix(in srgb, var(--background-primary) 92%, #f6efe3 8%) 0%, color-mix(in srgb, var(--background-secondary) 64%, #efe3ce 36%) 52%, color-mix(in srgb, var(--background-secondary) 48%, #e6d6bc 52%) 100%);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65);}",
    ".curator-roxy-grimoire-bg{position:absolute;inset:0;pointer-events:none;opacity:0.92;}",
    ".curator-roxy-grimoire-content{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;max-height:100%;overflow:hidden;}",
    ".curator-roxy-grimoire-art-box{flex:0 0 168px;width:168px;display:flex;align-items:center;justify-content:center;}",
    ".curator-roxy-grimoire-art{width:100%;height:auto;max-height:126px;filter:drop-shadow(0 4px 10px rgba(38,28,18,0.1));}",
    ".curator-roxy-grimoire-note{flex:1 1 auto;min-width:0;max-height:100%;display:flex;flex-direction:column;gap:5px;overflow:hidden;}",
    ".curator-roxy-grimoire-kicker-row{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;}",
    ".curator-roxy-grimoire-kicker{font-size:9.5px;font-weight:700;letter-spacing:0.12em;color:#3b6998;text-transform:uppercase;}",
    ".curator-roxy-grimoire-switch-btn{cursor:pointer;padding:2px 8px;font-size:10.5px;font-weight:600;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 88%, #f6efe3 12%);color:#8f683d;transition:all .14s ease;}",
    ".curator-roxy-grimoire-switch-btn:hover{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-roxy-grimoire-quote{font-size:11.6px;line-height:1.46;color:var(--text-normal);font-style:italic;padding:6px 9px;border-radius:7px;border-left:2.5px solid #3b6998;background:color-mix(in srgb, var(--background-primary) 78%, transparent);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}",
    ".curator-roxy-grimoire-stamps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-roxy-grimoire-stamp{font-size:9.5px;font-weight:700;letter-spacing:0.06em;padding:1px 6px;border-radius:4px;border:1px dashed color-mix(in srgb, #8f683d 45%, var(--background-modifier-border));color:#8f683d;background:color-mix(in srgb, var(--background-primary) 72%, transparent);}",
    /* 三合一综合评分排行榜与 FLIP 升降动画 */
    ".curator-unified-rank-body{display:flex;flex-direction:column;gap:10px;}",
    ".curator-rank-controls{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:7px 9px;border-radius:8px;background:color-mix(in srgb, var(--background-secondary) 78%, #f4ede1 22%);border:1px solid color-mix(in srgb, #9e784b 22%, var(--background-modifier-border));}",
    ".curator-rank-tabs{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;background:var(--background-primary);padding:3px;border-radius:6px;border:1px solid var(--background-modifier-border);}",
    ".curator-rank-tab-btn{cursor:pointer;padding:3px 9px;font-size:11.5px;font-weight:500;border-radius:4px;border:none;background:transparent;color:var(--text-muted);transition:all .15s ease;}",
    ".curator-rank-tab-btn:hover{color:var(--text-normal);}",
    ".curator-rank-tab-btn.is-active{background:#8f683d;color:#fffdf9;font-weight:600;box-shadow:0 1px 4px rgba(143,104,61,0.24);}",
    ".curator-rank-params{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-rank-param-group{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-rank-param-label{font-size:10.5px;color:var(--text-muted);font-weight:600;letter-spacing:0.04em;}",
    ".curator-rank-pill-group{display:inline-flex;align-items:center;border-radius:5px;border:1px solid var(--background-modifier-border);background:var(--background-primary);overflow:hidden;}",
    ".curator-rank-param-pill{cursor:pointer;padding:2px 6px;font-size:11px;border:none;background:transparent;color:var(--text-muted);transition:all .14s ease;}",
    ".curator-rank-param-pill:hover{color:var(--text-normal);background:var(--background-modifier-hover);}",
    ".curator-rank-param-pill.is-active{background:color-mix(in srgb, #8f683d 18%, var(--background-primary));color:#8f683d;font-weight:700;}",
    ".curator-unified-rank-list{position:relative;display:flex;flex-direction:column;gap:6px;}",
    ".curator-unified-rank-row{position:relative;display:flex !important;flex-direction:column !important;align-items:stretch !important;gap:5px !important;padding:8px 11px !important;border-radius:7px !important;border:1px solid color-mix(in srgb, var(--background-modifier-border) 75%, transparent) !important;background:color-mix(in srgb, var(--background-secondary) 45%, var(--background-primary)) !important;will-change:transform,opacity;}",
    ".curator-unified-rank-row:hover{border-color:rgba(143,104,61,0.45) !important;}",
    ".curator-unified-rank-row.is-flip-moving{z-index:4;box-shadow:0 6px 18px rgba(42,32,22,0.12);}",
    ".curator-unified-rank-row.is-flip-rising{z-index:6;background:color-mix(in srgb, #8f683d 12%, var(--background-primary)) !important;border-color:rgba(143,104,61,0.58) !important;box-shadow:0 8px 22px rgba(143,104,61,0.18);}",
    ".curator-unified-rank-row.is-flip-falling{z-index:3;background:color-mix(in srgb, var(--background-secondary) 75%, var(--background-primary)) !important;}",
    ".curator-unified-rank-head{display:flex !important;align-items:center !important;justify-content:space-between !important;gap:8px !important;width:100% !important;margin-bottom:0 !important;}",
    ".curator-rank-left-group{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto;}",
    ".curator-rank-num{display:inline-flex;align-items:center;justify-content:center;min-width:26px;padding:1px 5px;font-size:11px;font-weight:700;border-radius:4px;background:var(--background-secondary);color:var(--text-muted);flex-shrink:0;}",
    ".curator-rank-num.is-top-1{background:linear-gradient(135deg,#c6933b,#a67422);color:#fffdf8;}",
    ".curator-rank-num.is-top-2{background:linear-gradient(135deg,#8d949e,#6d747e);color:#fffdf8;}",
    ".curator-rank-num.is-top-3{background:linear-gradient(135deg,#b5784a,#8f5830);color:#fffdf8;}",
    ".curator-rank-shift-tag{font-size:10px;font-weight:700;padding:0 4px;border-radius:3px;flex-shrink:0;animation:curatorRankShiftFade 1.8s ease forwards;}",
    ".curator-rank-shift-tag.is-up{background:rgba(46,139,87,0.16);color:#2e8b57;}",
    ".curator-rank-shift-tag.is-down{background:rgba(198,116,32,0.16);color:#b35c0e;}",
    "@keyframes curatorRankShiftFade{0%,65%{opacity:1;}100%{opacity:0.35;}}",
    ".curator-rank-title-link{font-size:12.5px;font-weight:600;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;cursor:pointer;}",
    ".curator-rank-title-link:hover{color:#8f683d;text-decoration:underline;}",
    ".curator-rank-edition-tag{font-size:10px;padding:0 5px;border-radius:3px;background:rgba(143,104,61,0.14);color:#8f683d;font-weight:600;flex-shrink:0;}",
    ".curator-rank-right-group{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;}",
    ".curator-rank-primary-score{font-size:12px;font-weight:700;color:#8f683d;padding:1px 6px;border-radius:4px;background:rgba(143,104,61,0.12);}",
    ".curator-rank-primary-score.is-interactive{cursor:pointer;border:1px solid rgba(143,104,61,0.34);}",
    ".curator-rank-primary-score.is-interactive:hover{background:#8f683d;color:#fffdf9;}",
    ".curator-rank-secondary-score{font-size:11px;color:var(--text-muted);}",
    ".curator-rank-delta-pill{font-size:10.5px;padding:0 4px;border-radius:3px;font-weight:600;}",
    ".curator-rank-delta-pill.is-plus{background:rgba(40,167,69,0.14);color:var(--color-green,#28a745);}",
    ".curator-rank-delta-pill.is-minus{background:rgba(235,87,87,0.14);color:var(--text-error,#eb5757);}",
    ".curator-rank-bar-track{width:100% !important;flex:0 0 auto !important;height:5px !important;border-radius:999px !important;overflow:hidden;}",
    ".curator-rank-bar-fill{transition:width 460ms cubic-bezier(0.22, 1, 0.36, 1) !important;background:linear-gradient(90deg,#8f683d,#c89b62) !important;}",
    ".curator-rank-empty{padding:20px 14px;text-align:center;font-size:12px;color:var(--text-muted);border-radius:7px;border:1px dashed var(--background-modifier-border);}",
    ".curator-empty-box{padding:28px 16px;text-align:center;border-radius:8px;border:1px dashed var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-empty-title{font-weight:600;font-size:14px;color:var(--text-normal);margin-bottom:6px;}",
    ".curator-empty-sub{font-size:12px;color:var(--text-muted);}",
    ".curator-mini-btn{cursor:pointer;padding:3px 10px;font-size:11.5px;border-radius:5px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);}",
    ".curator-mini-btn.is-accent{border-color:#8f683d;color:#8f683d;font-weight:600;}",
    /* 6. 容器级响应式适配（宽屏 / 左侧文件树展开中等宽度 / 窄窗口分屏 / Markdown 嵌入） */
    "@container curator-desk (max-width: 1180px){.curator-desk-grid.is-standby-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.curator-almanac-summary-strip{grid-template-columns:repeat(3,minmax(0,1fr));}}",
    "@container curator-desk (max-width: 860px){.curator-desk-root{width:100%;padding:4px 4px 32px;}.curator-desk-topbar{padding:11px 12px;}.curator-summary-strip{justify-content:flex-start;}.curator-desk-grid.is-watching-grid,.curator-desk-grid.is-standby-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.curator-gallery-grid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;}.curator-almanac-summary-strip{grid-template-columns:repeat(2,minmax(0,1fr));}}",
    "@container curator-desk (max-width: 580px){.curator-desk-grid.is-watching-grid,.curator-desk-grid.is-standby-grid{grid-template-columns:1fr;}.curator-almanac-summary-strip{grid-template-columns:1fr;}}",
    /* 7. 追番下载与单集 RSS 工作台弹窗 + 季度席位管理弹窗 */
    ".curator-download-modal{display:flex;flex-direction:column;gap:12px;color:var(--text-normal);}",
    ".curator-dl-header{padding-bottom:8px;border-bottom:1px solid var(--background-modifier-border);}",
    ".curator-dl-kicker{font-size:10px;letter-spacing:0.14em;color:#9e784b;font-weight:700;text-transform:uppercase;}",
    ".curator-dl-title{margin:2px 0 4px;font-size:1.18em;font-weight:700;}",
    ".curator-dl-meta-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);}",
    ".curator-dl-bound-pill{padding:1px 8px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;font-weight:600;font-size:11px;}",
    ".curator-dl-env-box{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;padding:10px 12px;border-radius:9px;border:1px solid color-mix(in srgb, #9e784b 26%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 75%, #f6f0e4 25%);}",
    ".curator-dl-env-col{display:flex;flex-direction:column;gap:4px;min-width:0;}",
    ".curator-dl-env-line{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;}",
    ".curator-dl-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}",
    ".curator-dl-status-dot.is-ok{background:#2e8b57;box-shadow:0 0 0 2px rgba(46,139,87,0.2);}",
    ".curator-dl-status-dot.is-warn{background:#d4822a;box-shadow:0 0 0 2px rgba(212,130,42,0.2);}",
    ".curator-dl-status-dot.is-muted{background:var(--text-faint);}",
    ".curator-dl-env-path{font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-dl-env-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;}",
    ".curator-dl-search-box{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:9px;border:1px solid var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-dl-search-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-dl-keyword-input{flex:1 1 240px;padding:6px 10px !important;font-size:12.5px !important;border-radius:6px !important;border:1px solid var(--background-modifier-border) !important;}",
    ".curator-dl-btn{cursor:pointer;padding:5px 11px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);transition:all .12s ease;}",
    ".curator-dl-btn:hover{border-color:#8f683d;color:#8f683d;}",
    ".curator-dl-btn.is-primary{background:#8f683d;border-color:#8f683d;color:#fffdf9;}",
    ".curator-dl-btn.is-primary:hover{filter:brightness(1.07);color:#fffdf9;}",
    ".curator-dl-btn.is-accent{border-color:#8f683d;background:rgba(143,104,61,0.12);color:#8f683d;}",
    ".curator-dl-chips-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
    ".curator-dl-chips-label{font-size:11px;color:var(--text-muted);}",
    ".curator-dl-chip{cursor:pointer;padding:2px 8px;font-size:11px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);}",
    ".curator-dl-chip:hover{border-color:#8f683d;color:var(--text-normal);}",
    ".curator-dl-chip.is-modifier{border-style:dashed;color:#8f683d;}",
    ".curator-dl-streams-section{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}",
    ".curator-dl-section-head{display:flex;flex-direction:column;gap:3px;}",
    ".curator-dl-section-head-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
    ".curator-dl-section-title{font-size:12.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-dl-section-hint{font-size:11px;color:var(--text-muted);}",
    ".curator-dl-stream-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}",
    ".curator-dl-stream-grid.is-expanded-scroll{max-height:236px;overflow-y:auto;padding-right:4px;}",
    ".curator-dl-streams-more-bar{cursor:pointer;width:100%;padding:6px 10px;border-radius:7px;border:1px dashed color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:color-mix(in srgb, #8f683d 6%, var(--background-secondary));color:#8f683d;font-size:11.5px;font-weight:600;text-align:center;transition:all .14s ease;}",
    ".curator-dl-streams-more-bar:hover{background:color-mix(in srgb, #8f683d 14%, var(--background-secondary));border-color:#8f683d;}",
    ".curator-dl-stream-card{cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-primary);display:flex;flex-direction:column;gap:5px;transition:all .14s ease;}",
    ".curator-dl-stream-card:hover{border-color:#8f683d;box-shadow:0 3px 10px rgba(42,32,22,0.08);}",
    ".curator-dl-stream-card.is-active{border:1.5px solid #8f683d;background:color-mix(in srgb, #8f683d 10%, var(--background-primary));}",
    ".curator-dl-stream-top{display:flex;align-items:center;justify-content:space-between;gap:6px;}",
    ".curator-dl-stream-group{font-size:12px;font-weight:700;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-dl-stream-epcount{font-size:10.5px;padding:1px 6px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;font-weight:600;flex-shrink:0;}",
    ".curator-dl-stream-tags{display:flex;gap:4px;flex-wrap:wrap;}",
    ".curator-dl-stream-tag{font-size:10px;padding:0 5px;border-radius:3px;background:var(--background-secondary);color:var(--text-muted);}",
    ".curator-dl-stream-kw{font-size:10px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-dl-verify-banner{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:9px 12px;margin-bottom:8px;border-radius:8px;border:1px solid rgba(58,125,92,0.38);background:rgba(58,125,92,0.08);}",
    ".curator-dl-verify-title{font-size:12px;font-weight:700;color:#2c6b49;}",
    ".curator-dl-verify-rss{font-size:10.5px;color:var(--text-muted);word-break:break-all;margin-top:2px;}",
    ".curator-dl-verify-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-dl-ep-list{display:flex;flex-direction:column;gap:6px;max-height:36vh;overflow-y:auto;padding-right:4px;}",
    ".curator-dl-ep-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:7px;border:1px solid var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-dl-ep-row.is-downloaded{background:color-mix(in srgb, var(--background-secondary) 60%, var(--background-primary));}",
    ".curator-dl-ep-badge-col{display:flex;align-items:center;gap:5px;flex-shrink:0;}",
    ".curator-dl-ep-num{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-dl-ep-ver{font-size:10px;padding:0 4px;border-radius:3px;background:rgba(198,116,32,0.18);color:#b35c0e;font-weight:700;}",
    ".curator-dl-ep-local-tag{font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600;}",
    ".curator-dl-ep-local-tag.is-ok{background:rgba(58,125,92,0.15);color:#3a7d5c;}",
    ".curator-dl-ep-local-tag.is-new{background:rgba(143,104,61,0.16);color:#8f683d;}",
    ".curator-dl-ep-info-col{flex:1;min-width:0;}",
    ".curator-dl-ep-title{font-size:11.5px;font-weight:600;color:var(--text-normal);line-height:1.35;word-break:break-word;}",
    ".curator-dl-ep-sub{font-size:10.5px;color:var(--text-faint);margin-top:2px;}",
    ".curator-dl-ep-actions-col{display:flex;align-items:center;gap:4px;flex-shrink:0;}",
    ".curator-dl-mini-btn{cursor:pointer;padding:2px 8px;font-size:11px;border-radius:5px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);}",
    ".curator-dl-mini-btn:hover{border-color:#8f683d;color:#8f683d;}",
    ".curator-dl-mini-btn.is-primary{background:#8f683d;border-color:#8f683d;color:#fffdf9;font-weight:600;}",
    ".curator-dl-mini-btn.is-accent{border-color:#8f683d;color:#8f683d;font-weight:600;}",
    ".curator-dl-empty-box{padding:22px 14px;text-align:center;border-radius:8px;border:1px dashed var(--background-modifier-border);background:var(--background-primary);display:flex;flex-direction:column;align-items:center;gap:6px;}",
    ".curator-dl-empty-title{font-size:13px;font-weight:700;color:var(--text-normal);}",
    ".curator-dl-empty-sub{font-size:11.5px;color:var(--text-muted);max-width:640px;line-height:1.45;}",
    /* 季度管理弹窗 */
    ".curator-season-mgr-desc{font-size:12px;color:var(--text-muted);margin-top:0;line-height:1.45;}",
    ".curator-season-mgr-box{padding:10px 12px;margin-bottom:10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;flex-direction:column;gap:8px;}",
    ".curator-season-mgr-subtitle{font-size:12.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-season-mgr-pref-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12px;}",
    ".curator-season-mgr-field{display:inline-flex;align-items:center;gap:6px;}",
    ".curator-season-mgr-list{display:flex;flex-direction:column;gap:6px;}",
    ".curator-season-mgr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 10px;border-radius:6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);}",
    ".curator-season-mgr-name{font-size:12px;font-weight:600;}",
    ".curator-season-mgr-row-btns{display:inline-flex;align-items:center;gap:4px;}",
    ".curator-season-mgr-chips{display:flex;gap:6px;flex-wrap:wrap;}",
    ".curator-season-mgr-chip{cursor:pointer;padding:3px 9px;font-size:11.5px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-muted);}",
    ".curator-season-mgr-chip.is-pinned{background:#8f683d;border-color:#8f683d;color:#fffdf9;font-weight:600;}",
    ".curator-season-mgr-custom-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;}",
    ".curator-season-mgr-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}",
    /* 8. RSS 订阅与自动下载规则查重检测横幅 & 确认弹窗 */
    ".curator-rss-inline-card{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border-radius:9px;border:1px solid var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-rss-inline-card.is-warn{border-color:rgba(212,130,42,0.55);background:rgba(212,130,42,0.08);}",
    ".curator-rss-inline-card.is-info{border-color:rgba(43,114,185,0.45);background:rgba(43,114,185,0.06);}",
    ".curator-rss-inline-card.is-clean{border-color:rgba(58,125,92,0.4);background:rgba(58,125,92,0.06);}",
    ".curator-rss-inline-left{display:flex;flex-direction:column;gap:5px;flex:1 1 380px;min-width:0;}",
    ".curator-rss-inline-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-rss-inline-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;}",
    ".curator-rss-inline-badge.is-warn{background:rgba(212,130,42,0.2);color:#b35c0e;}",
    ".curator-rss-inline-badge.is-info{background:rgba(43,114,185,0.18);color:#2b72b9;}",
    ".curator-rss-inline-badge.is-clean{background:rgba(58,125,92,0.18);color:#2c6b49;}",
    ".curator-rss-inline-title{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-rss-inline-details{display:flex;flex-direction:column;gap:3px;}",
    ".curator-rss-inline-rule-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;}",
    ".curator-rss-inline-rule-name{font-weight:600;color:var(--text-normal);}",
    ".curator-rss-inline-rule-feed{font-size:10.5px;color:var(--text-muted);word-break:break-all;}",
    ".curator-rss-inline-hint{font-size:11px;color:var(--text-muted);line-height:1.4;}",
    ".curator-rss-inline-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;}",
    ".curator-rss-rule-state-pill{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:4px;}",
    ".curator-rss-rule-state-pill.is-enabled{background:rgba(46,139,87,0.16);color:#2c6b49;border:1px solid rgba(46,139,87,0.35);}",
    ".curator-rss-rule-state-pill.is-disabled{background:var(--background-secondary);color:var(--text-muted);border:1px solid var(--background-modifier-border);}",
    ".curator-rss-check-modal{display:flex;flex-direction:column;gap:12px;color:var(--text-normal);}",
    ".curator-rss-check-banner{padding:10px 12px;border-radius:8px;border:1px solid var(--background-modifier-border);}",
    ".curator-rss-check-banner.is-warn{border-color:rgba(212,130,42,0.55);background:rgba(212,130,42,0.1);}",
    ".curator-rss-check-banner.is-info{border-color:rgba(43,114,185,0.45);background:rgba(43,114,185,0.08);}",
    ".curator-rss-check-banner.is-clean{border-color:rgba(58,125,92,0.42);background:rgba(58,125,92,0.08);}",
    ".curator-rss-check-banner-title{font-size:12.5px;font-weight:700;color:var(--text-normal);margin-bottom:3px;}",
    ".curator-rss-check-banner-sub{font-size:11.5px;color:var(--text-muted);line-height:1.45;}",
    ".curator-rss-check-detail-box{display:flex;flex-direction:column;gap:10px;max-height:42vh;overflow-y:auto;padding-right:4px;}",
    ".curator-rss-check-sec{padding:9px 11px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;flex-direction:column;gap:6px;}",
    ".curator-rss-check-sec-head{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-rss-check-empty{font-size:11.5px;color:var(--text-muted);}",
    ".curator-rss-check-item{padding:7px 9px;border-radius:6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);display:flex;flex-direction:column;gap:4px;}",
    ".curator-rss-check-item-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-rss-check-item-name{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-rss-check-item-reason{font-size:10.5px;color:#8f683d;background:rgba(143,104,61,0.12);padding:1px 6px;border-radius:4px;}",
    ".curator-rss-check-item-meta{font-size:11px;color:var(--text-muted);word-break:break-all;line-height:1.4;}",
    ".curator-rss-check-prompt{padding:10px 12px;border-radius:8px;border:1px dashed #8f683d;background:rgba(143,104,61,0.08);display:flex;flex-direction:column;gap:4px;}",
    ".curator-rss-check-prompt-q{font-size:12.5px;font-weight:700;color:var(--text-normal);line-height:1.45;}",
    ".curator-rss-check-footer{display:flex;justify-content:flex-end;gap:8px;}",
    /* 9. 统一案头编目主工作台 (.curator-unified-workspace) & 双模式切换与过渡 */
    ".curator-unified-workspace{margin-bottom:22px;border-radius:13px;border:1px solid color-mix(in srgb, #9e784b 30%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 64%, #f7f1e7 36%);box-shadow:0 6px 20px rgba(42,32,22,0.05);overflow:hidden;}",
    ".curator-workspace-mode-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 16px;background:linear-gradient(180deg, color-mix(in srgb, var(--background-primary) 88%, #f4ede0 12%), color-mix(in srgb, var(--background-secondary) 78%, #efe5d4 22%));border-bottom:1px solid color-mix(in srgb, #9e784b 24%, var(--background-modifier-border));}",
    ".curator-workspace-mode-tabs{display:inline-flex;align-items:center;gap:6px;padding:3px;border-radius:9px;background:var(--background-primary);border:1px solid color-mix(in srgb, #9e784b 26%, var(--background-modifier-border));}",
    ".curator-workspace-mode-btn{cursor:pointer;display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:7px;border:none;background:transparent;color:var(--text-muted);font-size:12.5px;font-weight:600;transition:all .16s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-workspace-mode-btn:hover{color:var(--text-normal);background:var(--background-modifier-hover);}",
    ".curator-workspace-mode-btn.is-active{background:linear-gradient(135deg,#8f683d,#a87d4c);color:#fffdf9 !important;box-shadow:0 3px 10px rgba(143,104,61,0.25);}",
    ".curator-ws-mode-icon{font-size:13px;line-height:1;}",
    ".curator-ws-mode-title{letter-spacing:0.02em;}",
    ".curator-ws-mode-badge{font-size:10.5px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb, var(--background-secondary) 88%, #eee3d1 12%);color:var(--text-muted);font-weight:600;}",
    ".curator-workspace-mode-btn.is-active .curator-ws-mode-badge{background:rgba(255,253,249,0.22);color:#fffdf9;}",
    ".curator-workspace-quick-ribbon{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-ws-ribbon-hint{font-size:11.5px;color:var(--text-muted);}",
    ".curator-ws-ribbon-stat{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(143,104,61,0.12);color:#8f683d;border:1px solid rgba(143,104,61,0.28);}",
    ".curator-ws-quick-jump-btn{cursor:pointer;padding:4px 11px;font-size:11.5px;font-weight:600;border-radius:7px;border:1px dashed color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:var(--background-primary);color:#8f683d;transition:all .14s ease;}",
    ".curator-ws-quick-jump-btn:hover{border-style:solid;background:#8f683d;color:#fffdf9;}",
    ".curator-workspace-stage{position:relative;padding:12px 16px 14px;}",
    ".curator-workspace-pane.is-workspace-pane-hidden{display:none !important;}",
    ".curator-workspace-pane.is-workspace-pane-active{display:block;}",
    ".curator-unified-workspace .curator-mount-active-desk{margin-bottom:0;padding:0;border:none;background:transparent;}",
    ".curator-unified-workspace .curator-mount-catalog .curator-catalog-header{margin-top:0;}",
    ".curator-workspace-stage.is-switching-to-catalog .curator-mount-catalog{animation:curatorWsSlideLeft .28s cubic-bezier(0.22,1,0.36,1) both;}",
    ".curator-workspace-stage.is-switching-to-desk .curator-mount-active-desk{animation:curatorWsSlideRight .28s cubic-bezier(0.22,1,0.36,1) both;}",
    "@keyframes curatorWsSlideLeft{from{opacity:0;transform:translateX(14px);}to{opacity:1;transform:translateX(0);}}",
    "@keyframes curatorWsSlideRight{from{opacity:0;transform:translateX(-14px);}to{opacity:1;transform:translateX(0);}}",
    ".curator-desk-fallback-actions{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;}",
    /* 10. 案头卡片观片手札微气泡摘要条 (.curator-desk-review-strip) */
    ".curator-desk-review-strip{display:flex;align-items:center;gap:6px;padding:4px 8px;margin-top:2px;border-radius:6px;border:1px dashed color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 68%, #f8f2e7 32%);cursor:pointer;min-width:0;transition:all .14s ease;}",
    ".curator-desk-review-strip:hover{border-style:solid;border-color:#8f683d;background:color-mix(in srgb, #8f683d 10%, var(--background-primary));}",
    ".curator-desk-review-strip.is-empty{opacity:0.84;}",
    ".curator-desk-review-strip.is-empty:hover{opacity:1;}",
    ".curator-desk-review-empty-prompt{font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-desk-review-strip:hover .curator-desk-review-empty-prompt{color:#8f683d;font-weight:600;}",
    ".curator-desk-review-seek-pill{cursor:pointer;padding:1px 6px;font-size:10px;font-weight:700;border-radius:4px;border:1px solid rgba(58,125,92,0.38);background:rgba(58,125,92,0.12);color:#2c6b49;flex-shrink:0;transition:all .12s ease;}",
    ".curator-desk-review-seek-pill:hover{background:#2c6b49;color:#fffdf9;border-color:#2c6b49;}",
    ".curator-desk-review-seek-pill.is-placeholder{border-color:rgba(198,116,32,0.45);background:rgba(198,116,32,0.14);color:#b35c0e;}",
    ".curator-desk-review-seek-pill.is-placeholder:hover{background:#b35c0e;color:#fffdf9;}",
    ".curator-desk-review-scope-pill{font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(143,104,61,0.14);color:#8f683d;flex-shrink:0;}",
    ".curator-desk-review-snippet{font-size:11px;color:var(--text-normal);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-desk-review-snippet.is-placeholder-text{color:#b35c0e;font-weight:600;}",
    ".curator-desk-review-count{font-size:10px;font-weight:700;color:#8f683d;flex-shrink:0;margin-left:auto;}",
    ".curator-action-link.is-review-btn.has-reviews,.curator-gallery-quiet-link.has-reviews,.curator-table-action-btn.has-reviews{color:#8f683d;border-color:rgba(143,104,61,0.42);font-weight:600;}",
    ".curator-index-row.is-hidden-by-fold{display:none !important;}",
    /* 11. 魔导典藏压印：关闭按钮、三阶段「魔力紊乱·文字失义·笔画拆解·蛇形曲线游走」消散动效、角落恢复按钮与盖章动效 */
    ".curator-roxy-grimoire-actions-group{display:inline-flex;align-items:center;gap:6px;}",
    ".curator-roxy-grimoire-close-btn{cursor:pointer;padding:2px 8px;font-size:10px;font-weight:600;border-radius:999px;border:1px dashed color-mix(in srgb, #3b6998 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 86%, #eaf3fb 14%);color:#3b6998;transition:all .15s ease;}",
    ".curator-roxy-grimoire-close-btn:hover{background:#3b6998;color:#fffdf9;border-style:solid;border-color:#3b6998;}",
    ".curator-roxy-spell-wave-overlay{position:absolute;inset:-20%;pointer-events:none;opacity:0;z-index:4;background:repeating-linear-gradient(115deg, rgba(72,152,224,0) 0px, rgba(72,152,224,0.28) 14px, rgba(217,167,74,0.22) 26px, rgba(72,152,224,0) 42px);mix-blend-mode:screen;}",
    ".curator-roxy-stamp-shockwave{position:absolute;inset:6px;border-radius:10px;border:2px solid rgba(72,152,224,0.75);box-shadow:0 0 18px rgba(72,152,224,0.45), inset 0 0 14px rgba(217,167,74,0.38);pointer-events:none;opacity:0;z-index:5;}",
    ".curator-roxy-spell-stage-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:12;}",
    ".curator-roxy-stroke-particle{position:absolute;font-size:14px;font-weight:800;color:#3b6998;text-shadow:0 0 8px rgba(72,152,224,0.72);opacity:0;pointer-events:none;will-change:transform,opacity;animation:curatorRoxyStrokeWander 520ms cubic-bezier(0.18,0.88,0.32,1) forwards;}",
    ".curator-roxy-stroke-particle.is-gold-stroke{color:#c99b52;text-shadow:0 0 8px rgba(217,167,74,0.75);}",
    "@keyframes curatorRoxyStrokeWander{0%{opacity:0;transform:translate3d(0,0,0) scale(0.75) rotate(0deg);}24%{opacity:0.96;transform:translate3d(calc(var(--roxy-dx, 24px) * 0.35), calc(var(--roxy-dy, -12px) * 0.35), 0) scale(1.14) rotate(calc(var(--roxy-rot, 45deg) * 0.4));}100%{opacity:0;transform:translate3d(var(--roxy-dx, 42px), var(--roxy-dy, -22px), 0) scale(0.45) rotate(var(--roxy-rot, 90deg));}}",
    ".curator-roxy-serpent-svg-wrap{position:absolute;inset:0;pointer-events:none;z-index:13;opacity:0;transition:opacity 120ms ease;}",
    ".curator-roxy-grimoire-filler.is-stage-3-serpents .curator-roxy-serpent-svg-wrap{opacity:1;}",
    ".curator-roxy-serpent-svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 6px rgba(72,152,224,0.55));}",
    ".curator-roxy-grimoire-filler.is-dissolving-spell{pointer-events:none;transform-origin:center center;filter:url(#curator-roxy-water-serpent-filter) drop-shadow(0 0 12px rgba(72,152,224,0.38));animation:curatorRoxySpellDissolve 720ms cubic-bezier(0.22,0.8,0.32,1) forwards;}",
    ".curator-roxy-grimoire-filler.is-stage-1-turbulence .curator-roxy-grimoire-quote,.curator-roxy-grimoire-filler.is-stage-1-turbulence .curator-roxy-micro-inscription{color:#2b6399;text-shadow:0 0 6px rgba(72,152,224,0.45);animation:curatorRoxyTextTremor 95ms linear infinite;}",
    "@keyframes curatorRoxyTextTremor{0%{transform:translate(0,0) skewX(0deg);}25%{transform:translate(-1.2px,0.6px) skewX(-2deg);}50%{transform:translate(1.4px,-0.8px) skewX(2.4deg);}75%{transform:translate(-0.8px,-0.5px) skewX(-1.4deg);}100%{transform:translate(0,0) skewX(0deg);}}",
    ".curator-roxy-grimoire-filler.is-dissolving-spell .curator-roxy-spell-wave-overlay{animation:curatorRoxySerpentWave 720ms linear forwards;}",
    "@keyframes curatorRoxySpellDissolve{0%{opacity:1;transform:scale(1);}28%{opacity:0.96;transform:scale(1.012) skewX(1.2deg);}66%{opacity:0.62;transform:scale(0.992) skewX(-1.5deg);}100%{opacity:0;transform:scale(0.96) translateY(-4px);}}",
    "@keyframes curatorRoxySerpentWave{0%{opacity:0;transform:translateX(-18%) translateY(8%) rotate(-3deg);}30%{opacity:0.95;}100%{opacity:0;transform:translateX(22%) translateY(-12%) rotate(4deg);}}",
    ".curator-roxy-grimoire-filler.is-stamping-press{transform-origin:center center;animation:curatorRoxyStampPress 720ms cubic-bezier(0.22,1,0.36,1) both;}",
    ".curator-roxy-grimoire-filler.is-stamping-press .curator-roxy-stamp-shockwave{animation:curatorRoxyStampRipple 720ms cubic-bezier(0.16,1,0.3,1) forwards;}",
    "@keyframes curatorRoxyStampPress{0%{opacity:0;transform:translateY(-24px) scale(1.18) rotate(-1.2deg);filter:brightness(1.22);}42%{opacity:1;transform:translateY(2px) scale(0.975) rotate(0.2deg);filter:brightness(1.06);}66%{transform:translateY(-1px) scale(1.01) rotate(0deg);}100%{opacity:1;transform:translateY(0) scale(1) rotate(0deg);filter:none;}}",
    "@keyframes curatorRoxyStampRipple{0%,38%{opacity:0;transform:scale(0.92);}44%{opacity:0.95;transform:scale(0.98);}100%{opacity:0;transform:scale(1.09);}}",
    ".curator-roxy-grimoire-restore-wrap{display:none;align-items:flex-end;box-sizing:border-box;overflow:hidden;}",
    ".curator-roxy-grimoire-restore-wrap.is-active{display:flex;}",
    ".curator-roxy-grimoire-restore-wrap.is-col-left{justify-content:flex-start;}",
    ".curator-roxy-grimoire-restore-wrap.is-col-right{justify-content:flex-end;}",
    ".curator-roxy-grimoire-restore-btn{cursor:pointer;padding:4px 11px;font-size:11px;font-weight:600;letter-spacing:0.04em;border-radius:999px;border:1px dashed color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f6efe3 28%);color:var(--text-muted);opacity:0.65;transition:all .18s ease;}",
    ".curator-roxy-grimoire-restore-btn:hover{opacity:1;border-style:solid;border-color:#8f683d;background:#8f683d;color:#fffdf9;box-shadow:0 4px 12px rgba(143,104,61,0.24);transform:translateY(-1px);}",
    /* 12. 制作公司与改编类型 & 综合评分排行 & 状态分布带联动展板 */
    ".bangumi-stacked-bar-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;}",
    ".bangumi-stacked-bar-meta{font-size:11.5px;color:var(--text-muted);font-weight:600;}",
    ".bangumi-stacked-bar.is-interactive{overflow:visible !important;padding:2px 0;gap:2px;background:transparent !important;}",
    ".bangumi-stacked-segment.is-interactive{cursor:pointer;position:relative;border-radius:4px;transition:transform 220ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 220ms ease, filter 180ms ease;}",
    ".bangumi-stacked-segment.is-interactive:hover{transform:scaleY(1.22);filter:brightness(1.08);z-index:2;}",
    ".bangumi-stacked-segment.is-interactive.is-selected{transform:scaleY(1.38);z-index:3;box-shadow:0 0 0 1.5px #fffdf9, 0 3px 10px rgba(42,32,22,0.28);filter:brightness(1.1);}",
    ".bangumi-stacked-legend-item.is-interactive{cursor:pointer;padding:3px 9px;border-radius:999px;border:1px solid transparent;background:color-mix(in srgb, var(--background-secondary) 60%, transparent);transition:all 160ms ease;user-select:none;}",
    ".bangumi-stacked-legend-item.is-interactive:hover{border-color:color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));color:var(--text-normal);}",
    ".bangumi-stacked-legend-item.is-interactive.is-selected{border-color:#8f683d;background:color-mix(in srgb, #8f683d 14%, var(--background-primary));color:#7a5429;font-weight:700;box-shadow:0 2px 6px rgba(143,104,61,0.14);}",
    ".curator-watchstate-linked-stage{margin-top:10px;padding-top:10px;border-top:1px dashed color-mix(in srgb, #8f683d 30%, var(--background-modifier-border));}",
    ".curator-watchstate-linked-stage.is-transitioning{animation:curatorLinkedStageReveal 240ms cubic-bezier(0.22,1,0.36,1) both;}",
    "@keyframes curatorLinkedStageReveal{from{opacity:0.25;transform:translateY(-5px);}to{opacity:1;transform:translateY(0);}}",
    ".curator-watchstate-linked-board{display:grid;grid-template-columns:minmax(185px, 235px) minmax(0, 1fr);gap:12px;align-items:stretch;}",
    "@container curator-desk (max-width: 680px){.curator-watchstate-linked-board{grid-template-columns:1fr;}}",
    ".bangumi-dashboard-state-card.is-linked-hero{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:12px 14px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 88%, #f6efe3 12%);}",
    ".curator-watchstate-telemetry-grid.is-linked-detail{display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-top:0 !important;}",
    ".curator-watchstate-tele-card{display:flex;flex-direction:column;justify-content:space-between;gap:5px;padding:10px 12px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-watchstate-tele-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
    ".curator-watchstate-tele-label{font-size:11.5px;font-weight:700;color:var(--text-muted);}",
    ".curator-watchstate-tele-val{font-size:12.5px;font-weight:800;color:#8f683d;}",
    ".curator-watchstate-tele-bar{height:6px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;}",
    ".curator-watchstate-tele-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg, #8f683d, #cfa055);transition:width 320ms cubic-bezier(0.22,1,0.36,1);}",
    ".curator-watchstate-tele-sub{font-size:11px;color:var(--text-muted);}",
    ".curator-rank-custom-limit-wrap{display:inline-flex;align-items:center;gap:4px;margin-left:2px;}",
    ".curator-rank-custom-limit-input{width:54px !important;height:24px !important;padding:2px 6px !important;font-size:11.5px !important;border-radius:6px !important;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border)) !important;background:var(--background-primary) !important;text-align:center;}",
    ".bangumi-type-row{display:grid !important;grid-template-columns:minmax(68px, auto) minmax(0, 1fr) auto !important;align-items:center !important;gap:10px !important;}",
    ".curator-studio-count-btn{cursor:pointer;width:auto !important;min-width:max-content !important;white-space:nowrap !important;flex-shrink:0 !important;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:2px 10px !important;font-size:11.5px;font-weight:700;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 78%, #f5ede0 22%);color:#8f683d;transition:all .14s ease;}",
    ".curator-studio-count-btn:hover,.curator-studio-count-btn.is-expanded{background:#8f683d;color:#fffdf9;border-color:#8f683d;}",
    ".curator-chronology-tree-drawer{margin:6px 0 8px;padding:10px 12px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 64%, #f7f1e6 36%);animation:curatorChronoUnfold 220ms cubic-bezier(0.22,1,0.36,1) both;}",
    "@keyframes curatorChronoUnfold{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}",
    ".curator-chrono-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding-bottom:5px;border-bottom:1px dashed color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));font-size:11px;color:var(--text-muted);}",
    ".curator-chrono-timeline{position:relative;display:flex;flex-direction:column;gap:8px;padding-left:12px;border-left:2px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));}",
    ".curator-chrono-year-group{position:relative;display:flex;align-items:flex-start;gap:10px;}",
    ".curator-chrono-year-group::before{content:'';position:absolute;left:-17px;top:6px;width:8px;height:8px;border-radius:50%;background:#8f683d;box-shadow:0 0 0 2px var(--background-primary);}",
    ".curator-chrono-year-node{flex:0 0 56px;font-size:11.5px;font-weight:700;color:#8f683d;padding-top:2px;}",
    ".curator-chrono-works-list{flex:1 1 auto;display:flex;flex-wrap:wrap;gap:6px;}",
    ".curator-chrono-work-chip{cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-size:11.5px;transition:all .14s ease;text-decoration:none;}",
    ".curator-chrono-work-chip:hover{border-color:#8f683d;color:#8f683d;transform:translateY(-1px);box-shadow:0 2px 8px rgba(42,32,22,0.08);}",
    ".curator-chrono-work-score{font-size:10.5px;font-weight:700;color:#8f683d;}",
    /* 13. 年代与番季分布：阿斯拉王立魔导书库 · 纪元星轨回廊 & 四季元素秘仪展龛 + 新番排期雷达 */
    ".curator-year-season-module,.curator-year-almanac-v2{display:flex;flex-direction:column;gap:14px;}",
    ".curator-grimoire-almanac-toolbar,.curator-year-v2-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg, color-mix(in srgb, var(--background-secondary) 72%, #f4ead8 28%), color-mix(in srgb, var(--background-primary) 86%, #eaf2fa 14%));border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));}",
    ".curator-grimoire-toolbar-left,.curator-year-v2-toolbar-left{display:flex;flex-direction:column;gap:4px;}",
    ".curator-grimoire-kicker-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-grimoire-kicker,.curator-grimoire-corridor-kicker{font-size:10px;font-weight:800;letter-spacing:0.12em;color:#8f683d;text-transform:uppercase;}",
    ".curator-grimoire-summary-pill{font-size:11px;font-weight:700;padding:1.5px 9px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;border:1px solid rgba(143,104,61,0.28);}",
    ".curator-grimoire-toolbar-sub,.curator-year-v2-subtitle{font-size:11.5px;color:var(--text-muted);}",
    ".curator-year-v2-toolbar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-year-radar-toggle-btn{cursor:pointer;padding:6px 13px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid #3b6998;background:rgba(59,105,152,0.1);color:#3b6998;transition:all .16s ease;}",
    ".curator-year-radar-toggle-btn:hover,.curator-year-radar-toggle-btn.is-active{background:#3b6998;color:#fffdf9;box-shadow:0 4px 12px rgba(59,105,152,0.24);}",
    /* 纪元展区切换栏与全馆四季元素总览铭牌 */
    ".curator-grimoire-era-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:6px 10px;border-radius:9px;background:color-mix(in srgb, var(--background-secondary) 56%, var(--background-primary));border:1px solid color-mix(in srgb, #8f683d 20%, var(--background-modifier-border));}",
    ".curator-grimoire-era-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-grimoire-era-tab{cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));background:var(--background-primary);color:var(--text-muted);font-size:11.5px;transition:all .16s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-grimoire-era-tab:hover{border-color:#8f683d;color:var(--text-normal);transform:translateY(-1px);}",
    ".curator-grimoire-era-tab.is-active{background:linear-gradient(135deg,#8f683d,#6e4d29);border-color:#8f683d;color:#fffdf9;box-shadow:0 4px 12px rgba(143,104,61,0.24);}",
    ".curator-era-tab-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}",
    ".curator-era-tab-label,.curator-era-tab-title{font-weight:700;}",
    ".curator-era-tab-sub{font-size:10.5px;opacity:0.82;}",
    ".curator-era-tab-count{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:color-mix(in srgb, var(--background-secondary) 85%, #e8dcc8 15%);color:#8f683d;}",
    ".curator-grimoire-era-tab.is-active .curator-era-tab-count{background:rgba(255,253,249,0.22);color:#fffdf9;}",
    ".curator-grimoire-global-seasons{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-global-season-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;background:var(--background-primary);border:1px solid var(--background-modifier-border);font-size:11px;}",
    ".curator-global-season-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}",
    ".curator-global-season-name{font-weight:700;color:var(--text-normal);}",
    ".curator-global-season-val{color:var(--text-muted);font-size:10.5px;}",
    /* 上半舞台：编年魔导书架与纪元星轨 (Grimoire Spine Gallery) */
    ".curator-grimoire-spine-stage{position:relative;padding:14px 16px 12px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:linear-gradient(180deg, color-mix(in srgb, var(--background-primary) 90%, #f3eadb 10%) 0%, color-mix(in srgb, var(--background-secondary) 68%, #ebe0cc 32%) 100%);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,0.55);}",
    ".curator-grimoire-astrolabe-bg{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0.9;}",
    ".curator-grimoire-astrolabe-svg{width:100%;height:100%;display:block;}",
    ".curator-grimoire-shelf-header{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;}",
    ".curator-grimoire-shelf-title{font-size:12px;font-weight:800;color:var(--text-normal);}",
    ".curator-grimoire-shelf-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);}",
    ".curator-spine-leg-item{display:inline-flex;align-items:center;gap:5px;}",
    ".curator-spine-leg-orb{width:8px;height:8px;border-radius:50%;background:radial-gradient(circle,#9ad8ff,#3b6998);display:inline-block;}",
    ".curator-spine-leg-gold{width:10px;height:6px;border-radius:3px;background:linear-gradient(90deg,#8f683d,#d9a74a);display:inline-block;}",
    ".curator-grimoire-shelf-body{position:relative;z-index:1;display:flex;align-items:stretch;gap:8px;}",
    ".curator-grimoire-y-axis{flex:0 0 auto;display:flex;flex-direction:column;justify-content:space-between;padding:8px 8px 26px 2px;border-right:1px dashed rgba(143,104,61,0.38);min-width:62px;}",
    ".curator-grimoire-axis-y-title{font-size:9.5px;font-weight:800;color:#8f683d;line-height:1.25;margin-bottom:4px;}",
    ".curator-grimoire-y-ticks{flex:1;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;font-size:10px;font-weight:700;color:var(--text-muted);padding:16px 0 4px;}",
    ".curator-grimoire-shelf-scroll-wrap{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}",
    ".curator-grimoire-shelf-scroll{position:relative;z-index:1;overflow-x:auto;overflow-y:hidden;padding:16px 6px 6px;}",
    ".curator-grimoire-grid-lines{position:absolute;inset:28px 8px 10px 8px;pointer-events:none;z-index:0;}",
    ".curator-grimoire-grid-line{position:absolute;left:0;right:0;border-top:1px dashed rgba(143,104,61,0.22);}",
    ".curator-grimoire-spines-row{position:relative;z-index:1;display:flex;align-items:flex-end;gap:12px;min-height:204px;padding:12px 8px 6px;border-bottom:3px solid rgba(143,104,61,0.38);}",
    ".curator-grimoire-era-group{position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:152px;padding:18px 14px 6px;border-radius:12px 10px 8px 8px;border:1.5px dashed color-mix(in srgb, var(--era-group-color, #8f683d) 58%, rgba(143,104,61,0.45));background:color-mix(in srgb, var(--era-group-color, #8f683d) 5%, rgba(255,252,245,0.28));flex-shrink:0;}",
    ".curator-grimoire-era-group-tag{position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:1.5px 10px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:0.06em;color:var(--era-group-color, #8f683d);background:color-mix(in srgb, var(--background-primary) 92%, #f6efe2 8%);border:1px solid color-mix(in srgb, var(--era-group-color, #8f683d) 52%, var(--background-modifier-border));box-shadow:0 2px 6px rgba(42,30,18,0.08);z-index:2;}",
    ".curator-grimoire-era-group-spines{display:flex;align-items:flex-end;gap:8px;}",
    ".curator-grimoire-x-axis{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 8px 0;font-size:10.5px;color:var(--text-muted);}",
    ".curator-grimoire-axis-x-title{font-weight:800;color:#8f683d;}",
    ".curator-grimoire-spine{cursor:pointer;position:relative;flex:0 0 58px;width:58px;border-radius:7px 7px 3px 3px;border:1px solid color-mix(in srgb, var(--spine-era-color, #c99b52) 55%, rgba(42,30,18,0.5));background:linear-gradient(180deg, #5c4028 0%, #3b2818 100%);color:#fdf8ef;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 4px 7px;box-shadow:0 4px 10px rgba(24,18,12,0.18), inset 0 1px 0 rgba(255,248,230,0.32);transition:transform 260ms cubic-bezier(0.22,1,0.36,1), box-shadow 260ms ease, border-color 220ms ease;}",
    ".curator-grimoire-spine.is-tone-azure{background:linear-gradient(180deg,#2d4c6e 0%,#1d324a 100%);}",
    ".curator-grimoire-spine.is-tone-emerald{background:linear-gradient(180deg,#2e5948 0%,#1d3b2f 100%);}",
    ".curator-grimoire-spine.is-tone-crimson{background:linear-gradient(180deg,#6e352c 0%,#47201a 100%);}",
    ".curator-grimoire-spine.is-tone-amber{background:linear-gradient(180deg,#6e4e2a 0%,#473119 100%);}",
    ".curator-grimoire-spine:hover{transform:translateY(-6px);border-color:#f7df9c;box-shadow:0 8px 18px rgba(42,30,18,0.26), 0 0 12px rgba(72,152,224,0.28);}",
    ".curator-grimoire-spine.is-selected{transform:translateY(-10px) scale(1.03);border:1.5px solid #72c4ff;box-shadow:0 12px 24px rgba(34,24,14,0.32), 0 0 18px rgba(72,152,224,0.48), inset 0 0 12px rgba(247,223,156,0.26);z-index:3;}",
    ".curator-spine-mana-orb{padding:1px 5px;border-radius:999px;background:rgba(59,105,152,0.55);border:1px solid rgba(143,212,255,0.65);box-shadow:0 0 8px rgba(72,152,224,0.65);flex-shrink:0;}",
    ".curator-spine-orb-text{font-size:9.5px;font-weight:800;color:#eaf7ff;line-height:1.1;}",
    ".curator-spine-sigil{font-size:11px;line-height:1;color:#f7df9c;text-shadow:0 0 6px rgba(247,223,156,0.5);flex-shrink:0;}",
    ".curator-spine-year{font-size:12px;font-weight:800;letter-spacing:0.03em;color:#fffdf8;line-height:1.1;flex-shrink:0;}",
    ".curator-spine-dual-mana{width:22px;flex:1 1 auto;min-height:28px;max-height:68px;display:flex;align-items:flex-end;justify-content:center;gap:3px;padding:3px;border-radius:4px;background:rgba(16,12,8,0.36);border:1px solid rgba(247,223,156,0.22);margin:3px 0;}",
    ".curator-spine-mana-col{flex:1;height:100%;border-radius:2px;background:rgba(255,255,255,0.08);display:flex;align-items:flex-end;overflow:hidden;}",
    ".curator-spine-mana-fill{width:100%;border-radius:2px;transition:height 360ms cubic-bezier(0.22,1,0.36,1);}",
    ".curator-spine-mana-fill.is-gold,.curator-spine-mana-col.is-vault-col .curator-spine-mana-fill{background:linear-gradient(180deg,#f7df9c,#c8963e);}",
    ".curator-spine-mana-fill.is-aqua,.curator-spine-mana-col.is-watch-col .curator-spine-mana-fill{background:linear-gradient(180deg,#8fd4ff,#3b82c4);}",
    ".curator-spine-count{font-size:10px;font-weight:700;color:#f5e8ce;line-height:1.1;flex-shrink:0;}",
    ".curator-spine-ripple-ring{position:absolute;inset:-4px;border-radius:9px;border:2px solid #72c4ff;opacity:0;pointer-events:none;}",
    ".curator-grimoire-spine.is-mana-rippling .curator-spine-ripple-ring,.curator-grimoire-spine.is-pulsing-ripple .curator-spine-ripple-ring{animation:curatorSpineManaRipple 640ms cubic-bezier(0.16,1,0.3,1) forwards;}",
    "@keyframes curatorSpineManaRipple{0%{opacity:0.95;transform:scale(0.94);box-shadow:0 0 16px rgba(114,196,255,0.75);}100%{opacity:0;transform:scale(1.16);box-shadow:0 0 28px rgba(217,167,74,0);}}",
    /* 下半展台：四季元素秘仪展龛 (Four-Season Elemental Alcoves) */
    ".curator-grimoire-alcoves-stage{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 54%, #f7f0e4 46%);will-change:transform,opacity;}",
    ".curator-grimoire-alcoves-stage.is-scroll-unfurling,.curator-grimoire-alcoves-stage.is-unfurling-scroll{animation:curatorAlcovesScrollUnfurl 420ms cubic-bezier(0.22,1,0.36,1) both;}",
    "@keyframes curatorAlcovesScrollUnfurl{0%{opacity:0.35;transform:translateY(8px) scaleY(0.97);}100%{opacity:1;transform:translateY(0) scaleY(1);}}",
    ".curator-alcoves-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px dashed color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));}",
    ".curator-alcoves-banner-left{display:flex;flex-direction:column;gap:5px;}",
    ".curator-alcoves-era-badge{align-self:flex-start;font-size:10.5px;font-weight:700;padding:1.5px 8px;border-radius:999px;background:rgba(143,104,61,0.12);color:#8f683d;border:1px solid rgba(143,104,61,0.35);}",
    ".curator-alcoves-title-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-alcoves-main-title{font-size:15px;font-weight:800;color:var(--text-normal);letter-spacing:0.02em;}",
    ".curator-alcoves-telemetry-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;}",
    ".curator-alcove-tele-pill{padding:2px 9px;border-radius:6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);color:var(--text-muted);font-weight:600;}",
    ".curator-alcove-tele-pill.is-gold{border-color:rgba(143,104,61,0.38);background:rgba(143,104,61,0.1);color:#8f683d;font-weight:700;}",
    ".curator-alcove-tele-pill.is-aqua{border-color:rgba(59,105,152,0.38);background:rgba(59,105,152,0.1);color:#3b6998;font-weight:700;}",
    ".curator-alcoves-banner-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-alcoves-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:stretch;}",
    "@container curator-desk (max-width: 1080px){.curator-alcoves-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}",
    "@container curator-desk (max-width: 620px){.curator-alcoves-grid{grid-template-columns:1fr;}}",
    ".curator-elemental-alcove{position:relative;display:flex;flex-direction:column;gap:9px;padding:11px 12px;border-radius:10px;border:1px solid color-mix(in srgb, var(--alcove-accent, #8f683d) 36%, var(--background-modifier-border));background:var(--background-primary);box-shadow:0 3px 10px rgba(34,26,18,0.05);transition:transform .16s ease, box-shadow .16s ease;}",
    ".curator-elemental-alcove:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(34,26,18,0.1);}",
    ".curator-elemental-alcove.is-empty-alcove{opacity:0.8;}",
    ".curator-alcove-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}",
    ".curator-alcove-icon{width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--alcove-accent, #8f683d) 14%, var(--background-primary));color:var(--alcove-accent, #8f683d);border:1px solid color-mix(in srgb, var(--alcove-accent, #8f683d) 34%, transparent);flex-shrink:0;}",
    ".curator-alcove-title-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}",
    ".curator-alcove-element-kicker{font-size:9.5px;font-weight:800;letter-spacing:0.08em;color:var(--alcove-accent, #8f683d);}",
    ".curator-alcove-title{font-size:12.5px;font-weight:800;color:var(--text-normal);line-height:1.25;}",
    ".curator-alcove-sub{font-size:10.5px;color:var(--text-muted);}",
    ".curator-alcove-count-badge{font-size:11px;font-weight:700;padding:1.5px 7px;border-radius:999px;background:color-mix(in srgb, var(--alcove-accent, #8f683d) 14%, var(--background-primary));color:var(--alcove-accent, #8f683d);flex-shrink:0;}",
    ".curator-alcove-resonance{display:flex;flex-direction:column;gap:7px;padding:8px 10px;border-radius:7px;background:color-mix(in srgb, var(--background-secondary) 55%, var(--background-primary));border:1px solid color-mix(in srgb, var(--background-modifier-border) 72%, transparent);}",
    ".curator-alcove-resonance-group.is-dual-group{display:flex;flex-direction:column;gap:4px;padding-bottom:5px;border-bottom:1px dashed color-mix(in srgb, var(--background-modifier-border) 68%, transparent);}",
    ".curator-alcove-group-header{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:800;color:#8f683d;}",
    ".curator-alcove-subbar-row{display:flex;flex-direction:column;gap:2.5px;}",
    ".curator-alcove-track-group{display:flex;flex-direction:column;gap:3px;}",
    ".curator-alcove-track-labelrow{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;color:var(--text-muted);}",
    ".curator-alcove-mana-track{height:5px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;}",
    ".curator-alcove-mana-fill{height:100%;border-radius:inherit;transition:width 380ms cubic-bezier(0.22,1,0.36,1);}",
    ".curator-alcove-mana-fill.is-track-a,.curator-alcove-mana-fill.is-year-share,.curator-alcove-mana-fill.is-vault{background:linear-gradient(90deg,#8f683d,#d9a74a);}",
    ".curator-alcove-mana-fill.is-track-vault,.curator-alcove-mana-fill.is-vault-share{background:linear-gradient(90deg,#a66c38,#d49b62);}",
    ".curator-alcove-mana-fill.is-track-b,.curator-alcove-mana-fill.is-watched{background:linear-gradient(90deg,#3b6998,#639cd9);}",
    ".curator-alcove-mana-fill.is-track-c,.curator-alcove-mana-fill.is-involvement{background:linear-gradient(90deg,#2f7a78,#5ec2bd);}",
    ".curator-alcove-plaques-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding-right:2px;}",
    ".curator-alcove-empty{padding:12px 8px;text-align:center;font-size:11px;color:var(--text-faint);border-radius:6px;border:1px dashed var(--background-modifier-border);display:flex;flex-direction:column;align-items:center;gap:6px;}",
    ".curator-alcove-work-plaque{cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;border:1px solid var(--background-modifier-border);background:var(--background-primary);text-align:left;transition:all .14s ease;}",
    ".curator-alcove-work-plaque:hover{border-color:var(--alcove-accent, #8f683d);transform:translateX(2px);box-shadow:0 3px 9px rgba(34,26,18,0.08);}",
    ".curator-plaque-thumb{flex:0 0 32px;width:32px;height:44px;border-radius:4px;overflow:hidden;background:var(--background-secondary);}",
    ".curator-plaque-thumb img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-plaque-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
    ".curator-plaque-title{font-size:11.5px;font-weight:700;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-plaque-score{color:#8f683d;font-weight:700;font-size:10.5px;flex-shrink:0;}",
    ".curator-alcoves-other-tray{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;border:1px dashed color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 78%, transparent);}",
    ".curator-alcoves-other-label{font-size:11px;font-weight:700;color:#8f683d;}",
    ".curator-alcoves-other-list{display:flex;flex-wrap:wrap;gap:6px;}",
    ".curator-alcove-other-chip{cursor:pointer;padding:2px 8px;font-size:11px;border-radius:5px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);}",
    ".curator-alcove-other-chip:hover{border-color:#8f683d;color:#8f683d;}",
    /* 新番排期雷达抽屉（双栏标题 + 偏好画像胶囊 + 双层番季胶囊 + 边框工具条） */
    ".curator-seasonal-radar-drawer{padding:14px 16px;border-radius:11px;border:1.5px solid rgba(59,105,152,0.38);background:color-mix(in srgb, var(--background-secondary) 65%, #eef4fa 35%);display:flex;flex-direction:column;gap:10px;}",
    ".curator-radar-header{display:flex;align-items:stretch;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:10px 12px;border-radius:9px;background:var(--background-primary);border:1px solid color-mix(in srgb, #3b6998 26%, var(--background-modifier-border));}",
    ".curator-radar-header-left{flex:1 1 280px;display:flex;flex-direction:column;justify-content:center;gap:4px;}",
    ".curator-radar-title-mainline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-radar-main-title,.curator-radar-title{margin:0;font-size:14.5px;font-weight:800;color:#23496d;}",
    ".curator-radar-archive-pill{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(59,105,152,0.12);color:#2b5d8f;border:1px solid rgba(59,105,152,0.28);}",
    ".curator-radar-sub{font-size:11px;color:var(--text-muted);}",
    ".curator-radar-taste-col{flex:1 1 320px;display:flex;flex-direction:column;justify-content:center;gap:5px;padding:6px 10px;border-radius:7px;background:color-mix(in srgb, var(--background-secondary) 60%, #f7f1e6 40%);border:1px dashed color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));}",
    ".curator-radar-taste-label{font-size:10.5px;font-weight:800;color:#8f683d;}",
    ".curator-radar-taste-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
    ".curator-radar-taste-chip{padding:1.5px 8px;border-radius:999px;background:rgba(143,104,61,0.14);color:#7d582e;font-weight:700;font-size:10.5px;}",
    ".curator-radar-taste-chip.is-studio{background:rgba(59,105,152,0.14);color:#265480;}",
    ".curator-radar-season-tabs{display:grid;grid-template-columns:repeat(auto-fit, minmax(125px, 1fr));gap:8px;}",
    ".curator-radar-season-tab{cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 10px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid color-mix(in srgb, #3b6998 26%, var(--background-modifier-border));background:var(--background-primary);color:var(--text-normal);transition:all .16s ease;}",
    ".curator-radar-season-tab:hover{border-color:#3b6998;transform:translateY(-1px);}",
    ".curator-radar-season-tab.is-active{background:linear-gradient(135deg,#2b5d8f,#3b73ab);border-color:#2b5d8f;color:#fffdf9;box-shadow:0 4px 12px rgba(43,93,143,0.24);}",
    ".curator-radar-tab-name{font-size:12px;font-weight:800;line-height:1.2;}",
    ".curator-radar-tab-badge{font-size:10px;font-weight:600;opacity:0.84;padding:0.5px 6px;border-radius:999px;background:rgba(59,105,152,0.1);}",
    ".curator-radar-season-tab.is-active .curator-radar-tab-badge{background:rgba(255,255,255,0.22);color:#fffdf9;}",
    ".curator-radar-batch-cover-btn,.curator-radar-batch-dl-btn{border-color:#3b6998 !important;color:#3b6998 !important;font-weight:700 !important;}",
    ".curator-radar-batch-cover-btn:hover,.curator-radar-batch-dl-btn:hover{background:#3b6998 !important;color:#fffdf9 !important;}",
    ".curator-radar-toolbar,.curator-radar-status-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;background:var(--background-primary);border:1px solid color-mix(in srgb, #3b6998 22%, var(--background-modifier-border));font-size:11.5px;}",
    ".curator-radar-controls-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-radar-search-input{min-width:190px;padding:4px 10px !important;font-size:11.5px !important;border-radius:6px !important;}",
    ".curator-radar-local-cover-stat{font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(59,105,152,0.12);color:#3b6998;font-weight:700;}",
    ".curator-radar-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:10px;max-height:430px;overflow-y:auto;padding-right:4px;}",
    ".curator-radar-card{display:flex;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-primary);transition:all .14s ease;}",
    ".curator-radar-card.is-no-local-cover{padding:9px 12px;border-left:3px solid rgba(59,105,152,0.45);}",
    ".curator-radar-card.is-affinity-match{border-color:rgba(143,104,61,0.55);background:color-mix(in srgb, #8f683d 6%, var(--background-primary));}",
    ".curator-radar-card.is-affinity-match.is-no-local-cover{border-left:3px solid #8f683d;}",
    ".curator-radar-poster{flex:0 0 64px;width:64px;height:90px;border-radius:5px;overflow:hidden;background:var(--background-secondary);display:flex;align-items:center;justify-content:center;}",
    ".curator-radar-poster img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-radar-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}",
    ".curator-radar-affinity-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(143,104,61,0.16);color:#8f683d;align-self:flex-start;}",
    ".curator-radar-card-title{font-size:12.5px;font-weight:700;color:var(--text-normal);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
    ".curator-radar-card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;color:var(--text-muted);}",
    ".curator-radar-card-meta .is-score{color:#8f683d;font-weight:700;}",
    ".curator-radar-card-tags{display:flex;flex-wrap:wrap;gap:3px;}",
    ".curator-radar-tag{font-size:10px;padding:0 5px;border-radius:3px;background:var(--background-secondary);color:var(--text-muted);}",
    ".curator-radar-card-desc{font-size:10.5px;color:var(--text-faint);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35;}",
    ".curator-radar-card-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:auto;padding-top:4px;}",
    ".curator-dl-mini-btn.is-in-vault-btn{border-color:rgba(58,125,92,0.45);background:rgba(58,125,92,0.12);color:#2c6b49;font-weight:600;}",
    /* 14. 角色典藏与萌娘百科萌点偏好排行系统 (.curator-character-archive-root) */
    ".curator-character-archive-root{display:flex;flex-direction:column;gap:14px;}",
    ".curator-char-header-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 26%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 68%, #f7f1e6 32%);}",
    ".curator-char-header-left{display:flex;flex-direction:column;gap:2px;}",
    ".curator-char-header-title{font-size:13.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-header-sub{font-size:11px;color:var(--text-muted);}",
    ".curator-char-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-char-search-input{min-width:220px;padding:5px 10px !important;font-size:12px !important;border-radius:6px !important;}",
    ".curator-char-empty-box{padding:26px 18px;border-radius:10px;border:1px dashed color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:var(--background-primary);text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;}",
    ".curator-char-empty-title{font-size:14px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-empty-desc{font-size:12px;color:var(--text-muted);max-width:640px;line-height:1.5;}",
    ".curator-char-empty-actions{display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;justify-content:center;}",
    ".curator-char-add-drawer{padding:12px 14px;border-radius:10px;border:1.5px solid color-mix(in srgb, #8f683d 45%, var(--background-modifier-border));background:var(--background-primary);display:flex;flex-direction:column;gap:10px;}",
    ".curator-char-add-title{font-size:13px;font-weight:700;color:#8f683d;}",
    ".curator-char-add-sub{font-size:11px;color:var(--text-muted);}",
    ".curator-char-add-searchbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-char-kw-input{flex:1 1 260px;}",
    /* 拓宽搜索候选卡片列宽（minmax(300px, 1fr)），确保角色完整中/日文名与简介清晰舒展，绝不截断为单字 */
    ".curator-char-search-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;max-height:290px;overflow-y:auto;padding-right:4px;}",
    ".curator-char-search-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);transition:border-color .14s ease, box-shadow .14s ease;}",
    ".curator-char-search-card:hover{border-color:#8f683d;box-shadow:0 3px 10px rgba(42,32,22,0.08);}",
    ".curator-char-search-ava{width:48px;height:64px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--background-primary);display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb, var(--background-modifier-border) 80%, transparent);}",
    ".curator-char-search-ava img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-char-search-meta{flex:1 1 auto;min-width:130px;display:flex;flex-direction:column;gap:3px;}",
    ".curator-char-search-name-line,.curator-char-search-name-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-char-search-name{font-size:13px;font-weight:700;color:var(--text-normal);line-height:1.3;word-break:break-word;}",
    ".curator-char-search-existing-pill,.curator-char-search-dupe-tag{font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(143,104,61,0.16);color:#8f683d;flex-shrink:0;}",
    ".curator-char-search-jp{font-size:11px;color:var(--text-muted);line-height:1.25;word-break:break-word;}",
    ".curator-char-search-tip{font-size:10.5px;color:var(--text-faint);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
    ".curator-char-pick-btn{flex:0 0 auto;padding:5px 11px !important;font-size:11.5px !important;white-space:nowrap;}",
    ".curator-char-draft-editor{padding:12px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 55%, var(--background-primary));display:flex;flex-direction:column;gap:10px;}",
    ".curator-char-draft-heading{font-size:12.5px;font-weight:700;color:#8f683d;}",
    ".curator-char-draft-grid{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;}",
    ".curator-char-draft-poster{width:96px;height:132px;border-radius:7px;overflow:hidden;border:1px solid var(--background-modifier-border);background:var(--background-primary);flex-shrink:0;display:flex;align-items:center;justify-content:center;}",
    ".curator-char-draft-poster img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-char-draft-fields{flex:1 1 420px;display:flex;flex-direction:column;gap:8px;}",
    ".curator-char-draft-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}",
    ".curator-char-field-item{display:flex;flex-direction:column;gap:3px;}",
    ".curator-char-draft-label{font-size:11px;font-weight:600;color:var(--text-muted);}",
    ".curator-char-draft-moe-wrap{display:flex;flex-direction:column;gap:4px;}",
    ".curator-char-draft-moe-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
    ".curator-char-draft-moe-links{display:inline-flex;align-items:center;gap:6px;}",
    ".curator-char-moe-textarea{width:100%;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-char-draft-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--background-modifier-border);}",
    /* 最喜爱的角色属性与萌点偏好排行面板 */
    ".curator-char-rank-section{padding:12px 14px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 45%, var(--background-primary));display:flex;flex-direction:column;gap:10px;}",
    ".curator-char-rank-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}",
    ".curator-char-rank-title-wrap{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}",
    ".curator-char-rank-title{font-size:13px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-rank-subtitle{font-size:11px;color:var(--text-muted);}",
    ".curator-char-rank-controls{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
    ".curator-char-rank-bars-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:8px;}",
    ".curator-char-rank-bar-card{cursor:pointer;padding:8px 10px;border-radius:7px;border:1px solid var(--background-modifier-border);background:var(--background-primary);display:flex;flex-direction:column;gap:5px;transition:all .14s ease;}",
    ".curator-char-rank-bar-card:hover,.curator-char-rank-bar-card.is-selected{border-color:#8f683d;background:color-mix(in srgb, #8f683d 10%, var(--background-primary));box-shadow:0 3px 10px rgba(42,32,22,0.08);}",
    ".curator-char-rank-bar-top{display:flex;align-items:center;justify-content:space-between;gap:6px;}",
    ".curator-char-rank-bar-label{display:flex;align-items:center;gap:5px;min-width:0;}",
    ".curator-char-rank-idx{font-size:11px;font-weight:700;color:var(--text-muted);}",
    ".curator-char-rank-idx.is-top3{color:#8f683d;}",
    ".curator-char-trait-cat{font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:3px;}",
    ".curator-char-trait-cat.is-moe{background:rgba(143,104,61,0.15);color:#8f683d;}",
    ".curator-char-trait-cat.is-hair,.curator-char-trait-cat.is-eye{background:rgba(59,105,152,0.15);color:#3b6998;}",
    ".curator-char-trait-cat.is-cv{background:rgba(58,125,92,0.15);color:#2c6b49;}",
    ".curator-char-trait-name{font-size:12.5px;font-weight:700;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-char-trait-metrics{font-size:10.5px;color:var(--text-muted);flex-shrink:0;}",
    ".curator-char-rank-track{height:5px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;}",
    ".curator-char-rank-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#8f683d,#c89b62);}",
    ".curator-char-rank-fill.is-hair,.curator-char-rank-fill.is-eye{background:linear-gradient(90deg,#3b6998,#639cd9);}",
    ".curator-char-rank-fill.is-cv{background:linear-gradient(90deg,#3a7d5c,#62ab86);}",
    ".curator-char-rank-avatars-row{display:flex;flex-wrap:wrap;gap:4px;}",
    ".curator-char-mini-chip{font-size:10px;padding:0 5px;border-radius:3px;background:var(--background-secondary);color:var(--text-muted);}",
    ".curator-char-moe-cloud{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding-top:4px;border-top:1px dashed var(--background-modifier-border);}",
    ".curator-char-cloud-label{font-size:11px;color:var(--text-muted);}",
    ".curator-char-cloud-pill{cursor:pointer;padding:2px 8px;font-size:11px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);transition:all .12s ease;}",
    ".curator-char-cloud-pill:hover,.curator-char-cloud-pill.is-selected{border-color:#8f683d;background:#8f683d;color:#fffdf9;}",
    /* 角色典藏画廊卡片 & 查重合并/删除交互 */
    ".curator-char-gallery-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;}",
    ".curator-char-gallery-left{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-char-gallery-count{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-dedupe-btn{border-color:#8f683d !important;background:rgba(143,104,61,0.12) !important;color:#8f683d !important;font-weight:700 !important;}",
    ".curator-char-dedupe-btn:hover{background:#8f683d !important;color:#fffdf9 !important;}",
    ".curator-char-gallery-sort{display:flex;align-items:center;gap:5px;}",
    ".curator-char-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px;}",
    ".curator-char-card{padding:11px 12px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));background:var(--background-primary);display:flex;flex-direction:column;gap:8px;transition:all .22s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-char-card:hover{border-color:#8f683d;box-shadow:0 5px 16px rgba(42,32,22,0.08);}",
    ".curator-char-card.is-card-removing{opacity:0;transform:scale(0.92) translateY(8px);pointer-events:none;}",
    ".curator-char-card-top{display:flex;gap:11px;align-items:flex-start;}",
    ".curator-char-card-avatar{position:relative;flex:0 0 76px;width:76px;height:106px;border-radius:7px;overflow:hidden;border:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;align-items:center;justify-content:center;}",
    ".curator-char-card-avatar img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-char-score-badge{cursor:pointer;position:absolute;bottom:4px;right:4px;padding:1px 6px;font-size:10.5px;font-weight:800;border-radius:4px;background:rgba(34,26,18,0.88);color:#f7df9c;border:1px solid rgba(217,167,74,0.55);}",
    ".curator-char-card-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}",
    ".curator-char-card-namerow{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;}",
    ".curator-char-card-name-group{display:inline-flex;align-items:baseline;gap:6px;flex-wrap:wrap;}",
    ".curator-char-card-name{font-size:13.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-card-jp{font-size:11px;color:var(--text-muted);}",
    ".curator-char-top-remove-btn{cursor:pointer;margin-left:auto;padding:1px 6px;font-size:11px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--text-faint);opacity:0.65;transition:all .14s ease;}",
    ".curator-char-card:hover .curator-char-top-remove-btn{opacity:1;}",
    ".curator-char-top-remove-btn:hover{border-color:rgba(217,83,79,0.45);background:rgba(217,83,79,0.12);color:#c94440;}",
    ".curator-char-card-traits{display:flex;flex-wrap:wrap;gap:4px;}",
    ".curator-char-attr-chip{font-size:10.5px;padding:1px 6px;border-radius:4px;background:var(--background-secondary);color:var(--text-muted);}",
    ".curator-char-attr-chip.is-hair,.curator-char-attr-chip.is-eye{background:rgba(59,105,152,0.12);color:#3b6998;font-weight:600;}",
    ".curator-char-attr-chip.is-cv{background:rgba(58,125,92,0.12);color:#2c6b49;font-weight:600;}",
    ".curator-char-card-appearances{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;}",
    ".curator-char-anime-chip{font-size:10.5px;padding:1px 6px;border-radius:4px;background:color-mix(in srgb, var(--background-secondary) 80%, #efe6d8 20%);color:var(--text-muted);border:none;}",
    ".curator-char-anime-chip.is-in-vault{cursor:pointer;color:#8f683d;font-weight:600;border:1px solid rgba(143,104,61,0.34);}",
    ".curator-char-anime-chip.is-in-vault:hover{background:#8f683d;color:#fffdf9;}",
    ".curator-char-card-moepoints{display:flex;flex-wrap:wrap;gap:4px;padding-top:4px;border-top:1px dashed color-mix(in srgb, var(--background-modifier-border) 68%, transparent);}",
    ".curator-char-moe-tag{cursor:pointer;padding:1.5px 7px;font-size:10.5px;font-weight:600;border-radius:999px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f6efe3 28%);color:var(--text-normal);transition:all .12s ease;}",
    ".curator-char-moe-tag:hover,.curator-char-moe-tag.is-active{background:#8f683d;border-color:#8f683d;color:#fffdf9;}",
    ".curator-char-moe-empty{font-size:11px;color:var(--text-faint);}",
    ".curator-char-card-comment{font-size:11.5px;font-style:italic;color:var(--text-muted);padding:4px 8px;border-radius:5px;border-left:2px solid #8f683d;background:color-mix(in srgb, var(--background-secondary) 55%, transparent);}",
    ".curator-char-inline-edit{padding:8px;border-radius:7px;border:1px dashed #8f683d;background:var(--background-secondary);display:flex;flex-direction:column;gap:6px;}",
    ".curator-char-inline-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;}",
    ".curator-char-score-input{width:68px !important;}",
    ".curator-char-inline-btns{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;}",
    ".curator-char-card-footer{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:auto;padding-top:4px;border-top:1px dashed color-mix(in srgb, var(--background-modifier-border) 60%, transparent);}",
    ".curator-char-remove-btn{margin-left:auto;border-color:rgba(217,83,79,0.35) !important;color:#c94440 !important;}",
    ".curator-char-remove-btn:hover,.curator-dl-btn.is-danger-btn{background:#c94440 !important;border-color:#c94440 !important;color:#fffdf9 !important;}",
    /* 角色查重合并确认弹窗 & 删除确认弹窗 */
    ".curator-char-dupe-modal,.curator-char-delete-modal{display:flex;flex-direction:column;gap:12px;padding:4px 2px;color:var(--text-normal);}",
    ".curator-char-modal-kicker{font-size:10px;font-weight:800;letter-spacing:0.14em;color:#8f683d;text-transform:uppercase;}",
    ".curator-char-modal-title{margin:0;font-size:16px;font-weight:800;color:var(--text-normal);}",
    ".curator-char-modal-desc{margin:0;font-size:12.5px;line-height:1.55;color:var(--text-normal);}",
    ".curator-char-dupe-compare,.curator-char-dupe-compare-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:10px 12px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:var(--background-secondary);}",
    ".curator-char-dupe-box,.curator-char-dupe-col{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);font-size:12px;}",
    ".curator-char-dupe-tag,.curator-char-dupe-col-tag{font-size:10.5px;font-weight:700;color:#8f683d;}",
    ".curator-char-dupe-col-name{font-size:13.5px;font-weight:800;color:var(--text-normal);}",
    ".curator-char-dupe-col-jp,.curator-char-dupe-col-meta,.curator-char-dupe-sub,.curator-char-delete-note-path{font-size:11px;color:var(--text-muted);}",
    ".curator-char-delete-note-box{padding:10px 12px;border-radius:8px;border:1px dashed rgba(217,83,79,0.5);background:rgba(217,83,79,0.06);display:flex;flex-direction:column;gap:4px;}",
    ".curator-char-delete-note-label{font-size:12px;font-weight:700;color:#b83b37;}",
    ".curator-char-modal-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--background-modifier-border);}",
    /* 15. 角色典藏画廊多视图切换、立绘取景换图工坊与等身标尺陈列架 */
    ".curator-char-gallery-toolbar-left{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}",
    ".curator-char-view-switcher{display:inline-flex;align-items:center;gap:3px;padding:3px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 75%, #f5ede0 25%);}",
    ".curator-char-view-btn{cursor:pointer;padding:4px 10px;font-size:11.5px;font-weight:700;border-radius:6px;border:none;background:transparent;color:var(--text-muted);transition:all .18s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-char-view-btn:hover{color:var(--text-normal);background:rgba(143,104,61,0.1);}",
    ".curator-char-view-btn.is-active{background:linear-gradient(135deg,#8f683d,#b08450);color:#fffdf9;box-shadow:0 2px 6px rgba(143,104,61,0.28);}",
    ".curator-char-card-avatar.is-clickable-portrait,.curator-char-draft-poster.is-clickable-portrait{cursor:pointer;position:relative;transition:transform .2s cubic-bezier(0.22,1,0.36,1), box-shadow .2s ease, border-color .2s ease;}",
    ".curator-char-card-avatar.is-clickable-portrait:hover,.curator-char-draft-poster.is-clickable-portrait:hover{border-color:#8f683d;box-shadow:0 4px 12px rgba(143,104,61,0.22);}",
    ".curator-char-card-avatar.is-fit-contain,.curator-char-draft-poster.is-fit-contain,.curator-studio-viewport.is-fit-contain,.curator-char-detail-poster.is-fit-contain{background:radial-gradient(circle at 50% 35%, color-mix(in srgb, #f7df9c 18%, var(--background-secondary)), color-mix(in srgb, #241b12 10%, var(--background-secondary)));}",
    ".curator-char-avatar-hover-pill{position:absolute;top:4px;left:4px;padding:1.5px 6px;font-size:9.5px;font-weight:700;border-radius:4px;background:rgba(30,22,15,0.82);color:#f7df9c;border:1px solid rgba(217,167,74,0.45);opacity:0;transform:translateY(-3px);transition:all .18s cubic-bezier(0.22,1,0.36,1);pointer-events:auto;}",
    ".curator-char-card-avatar.is-clickable-portrait:hover .curator-char-avatar-hover-pill,.curator-char-draft-poster.is-clickable-portrait:hover .curator-char-avatar-hover-pill{opacity:1;transform:translateY(0);}",
    ".curator-char-attr-chip.is-height{cursor:pointer;background:rgba(143,104,61,0.14);color:#8f683d;font-weight:700;border:1px solid rgba(143,104,61,0.28);transition:all .14s ease;}",
    ".curator-char-attr-chip.is-height:hover{background:#8f683d;color:#fffdf9;}",
    /* 等身标尺陈列架 (.curator-char-height-lineup-wrap) */
    ".curator-char-height-lineup-wrap{display:flex;flex-direction:column;gap:10px;animation:curatorFadeSlideIn .26s cubic-bezier(0.22,1,0.36,1);}",
    "@keyframes curatorFadeSlideIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}",
    ".curator-height-calibrator-bar{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-radius:10px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:linear-gradient(180deg, color-mix(in srgb, var(--background-secondary) 72%, #f7efe2 28%), var(--background-primary));box-shadow:0 3px 12px rgba(42,32,22,0.05);}",
    ".curator-height-summary-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}",
    ".curator-height-stats-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-height-stat-pill{font-size:11px;font-weight:600;padding:2.5px 9px;border-radius:999px;background:var(--background-secondary);color:var(--text-muted);border:1px solid var(--background-modifier-border);}",
    ".curator-height-stat-pill.is-gold{background:rgba(143,104,61,0.14);color:#8f683d;border-color:rgba(143,104,61,0.35);font-weight:700;}",
    ".curator-height-tools-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".curator-height-ref-ctrl{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:6px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);font-size:11px;}",
    ".curator-height-ref-label{font-weight:700;color:#3b6998;}",
    ".curator-height-ref-val{font-weight:800;color:var(--text-normal);min-width:44px;}",
    ".curator-height-ref-slider{width:95px !important;cursor:pointer;}",
    ".curator-height-active-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:8px;border-top:1px dashed color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));}",
    ".curator-height-sel-title{display:inline-flex;align-items:center;gap:7px;}",
    ".curator-height-sel-tag{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:4px;background:#8f683d;color:#fffdf9;}",
    ".curator-height-sel-name{font-size:13px;font-weight:800;color:var(--text-normal);}",
    ".curator-height-sel-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}",
    ".curator-height-ctrl-group{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);}",
    ".curator-height-ctrl-k{font-weight:700;color:var(--text-normal);}",
    ".curator-height-ctrl-v{min-width:42px;text-align:right;font-weight:700;color:#8f683d;}",
    ".curator-height-cm-input{width:64px !important;padding:2px 6px !important;font-size:12px !important;text-align:center;}",
    ".curator-height-mini-slider{width:88px !important;cursor:pointer;}",
    ".curator-height-sel-actions{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    /* 等身标尺主舞台（致敬编年魔导书脊陈列架） */
    ".curator-char-height-stage{display:grid;grid-template-columns:46px 1fr;gap:6px;padding:18px 14px 12px 8px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:linear-gradient(180deg, color-mix(in srgb, var(--background-secondary) 52%, #f8f2e7 48%) 0%, color-mix(in srgb, var(--background-primary) 88%, #efe4d2 12%) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 16px rgba(42,32,22,0.06);}",
    ".curator-height-y-axis{position:relative;height:380px;margin-bottom:50px;user-select:none;}",
    ".curator-height-y-axis.is-studio-axis{height:380px;margin-bottom:0;}",
    ".curator-height-y-tick{position:absolute;right:4px;transform:translateY(50%);font-size:10px;font-weight:700;color:var(--text-muted);line-height:1;}",
    ".curator-height-y-tick-minor{position:absolute;right:0;width:6px;height:1px;background:color-mix(in srgb, #8f683d 35%, transparent);}",
    ".curator-height-plot-viewport{position:relative;min-height:430px;overflow-x:auto;overflow-y:hidden;padding-bottom:4px;}",
    ".curator-height-grid-overlay{position:absolute;left:0;right:0;top:0;height:380px;pointer-events:none;z-index:1;}",
    ".curator-height-grid-line{position:absolute;left:0;right:0;height:0;}",
    ".curator-height-grid-line.is-major{border-top:1px dashed color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));}",
    ".curator-height-grid-line.is-minor{border-top:1px dotted color-mix(in srgb, #8f683d 14%, var(--background-modifier-border));}",
    ".curator-height-grid-line.is-baseline{border-top:3px solid color-mix(in srgb, #8f683d 68%, var(--background-modifier-border));box-shadow:0 2px 8px rgba(143,104,61,0.22);}",
    ".curator-height-ref-line{position:absolute;left:0;right:0;height:0;border-top:2px dashed #3b6998;z-index:6;cursor:ns-resize;margin-bottom:50px;transition:border-color .15s ease;}",
    ".curator-height-ref-line:hover,.curator-height-ref-line.is-dragging{border-top-color:#d49b3b;}",
    ".curator-height-ref-line-tag{position:absolute;right:10px;top:-19px;padding:1.5px 8px;font-size:10px;font-weight:700;border-radius:999px;background:rgba(59,105,152,0.92);color:#fffdf9;box-shadow:0 2px 6px rgba(0,0,0,0.16);user-select:none;}",
    ".curator-height-figures-track{position:relative;z-index:3;display:inline-flex;align-items:flex-end;gap:14px;min-width:100%;padding:0 14px;}",
    ".curator-height-figure-col{display:flex;flex-direction:column;align-items:center;width:140px;flex:0 0 140px;user-select:none;transition:transform .22s cubic-bezier(0.22,1,0.36,1), width .18s ease;}",
    ".curator-height-figure-stagebox{position:relative;width:100%;height:380px;display:flex;align-items:flex-end;justify-content:center;cursor:grab;overflow:visible;}",
    ".curator-height-figure-col.is-calibrating .curator-height-figure-stagebox{cursor:grabbing;}",
    ".curator-height-head-marker{position:absolute;left:4px;right:4px;height:0;border-top:1.5px dashed rgba(143,104,61,0.55);z-index:5;pointer-events:none;transition:bottom .22s cubic-bezier(0.22,1,0.36,1), border-color .18s ease;}",
    ".curator-height-figure-col:hover .curator-height-head-marker,.curator-height-figure-col.is-selected .curator-height-head-marker{border-top:2px solid #8f683d;}",
    ".curator-height-head-badge{position:absolute;left:50%;top:-20px;transform:translateX(-50%);padding:1px 7px;font-size:10px;font-weight:800;border-radius:999px;background:rgba(36,27,18,0.86);color:#f7df9c;border:1px solid rgba(217,167,74,0.55);white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.15);}",
    ".curator-height-head-badge.is-estimated{background:rgba(59,105,152,0.85);color:#eef6ff;border-color:rgba(130,178,228,0.55);}",
    ".curator-height-stand-box{position:relative;width:100%;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;border-radius:8px 8px 2px 2px;border:1px solid transparent;transition:height .24s cubic-bezier(0.22,1,0.36,1), border-color .18s ease, background .18s ease, box-shadow .18s ease;}",
    ".curator-height-figure-col:hover .curator-height-stand-box{border-color:rgba(143,104,61,0.42);background:rgba(143,104,61,0.06);}",
    ".curator-height-figure-col.is-selected .curator-height-stand-box{border-color:#8f683d;background:linear-gradient(180deg, rgba(247,223,156,0.16), rgba(143,104,61,0.12));box-shadow:0 4px 14px rgba(143,104,61,0.18);}",
    /* 关键：立绘图片在等身标尺架中以 height: 100%; width: auto; max-width: none 驱动，绝不因列宽限制产生顶部透明假留白 */
    ".curator-height-stand-img{height:100% !important;width:auto !important;max-width:none !important;flex-shrink:0 !important;display:block;pointer-events:none;filter:drop-shadow(0 4px 8px rgba(28,20,12,0.18));transition:transform .08s linear;}",
    ".curator-height-pedestal{cursor:pointer;margin-top:6px;width:100%;padding:5px 6px;border-radius:6px;border:1px solid color-mix(in srgb, #8f683d 26%, var(--background-modifier-border));background:var(--background-primary);text-align:center;display:flex;flex-direction:column;gap:1px;transition:all .16s ease;}",
    ".curator-height-figure-col.is-selected .curator-height-pedestal,.curator-height-pedestal:hover{border-color:#8f683d;background:color-mix(in srgb, #8f683d 12%, var(--background-primary));}",
    ".curator-height-pedestal-name{font-size:11.5px;font-weight:800;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-height-pedestal-meta{font-size:10px;color:var(--text-muted);}",
    ".curator-height-stage-footnote{font-size:11px;color:var(--text-muted);padding:2px 4px;}",
    /* 画报照片墙（Aves 相册风格 · 等高自适应完整无裁切拼图墙） */
    ".curator-char-photowall-wrap{display:flex;flex-direction:column;gap:8px;animation:curatorFadeSlideIn .26s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-photowall-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:7px 12px;border-radius:8px;border:1px solid color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 65%, #f7f0e4 35%);}",
    ".curator-photowall-hint{font-size:11.5px;color:var(--text-muted);font-weight:600;}",
    ".curator-photowall-ctrls{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;}",
    ".curator-photowall-collapse-box{position:relative;transition:max-height .32s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-photowall-collapse-box.is-collapsed{max-height:530px;overflow:hidden;}",
    ".curator-photowall-collapse-box.is-collapsed::after{content:'';position:absolute;left:0;right:0;bottom:0;height:68px;background:linear-gradient(180deg, transparent, var(--background-primary));pointer-events:none;z-index:5;}",
    ".curator-photowall-expand-bar{display:flex;justify-content:center;padding-top:4px;}",
    ".curator-char-photowall-grid{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;}",
    ".curator-char-photowall-grid::after{content:'';flex:99999 1 auto;}",
    ".curator-char-photowall-tile{cursor:pointer;position:relative;border-radius:8px;overflow:hidden;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--background-secondary) 85%, #f7ebd7 15%), color-mix(in srgb, var(--background-primary) 90%, #241b12 10%));box-shadow:0 2px 8px rgba(28,20,12,0.08);transition:transform .22s cubic-bezier(0.22,1,0.36,1), box-shadow .22s ease, border-color .2s ease;}",
    ".curator-char-photowall-tile:hover{transform:translateY(-3px);border-color:#8f683d;box-shadow:0 8px 20px rgba(28,20,12,0.18);z-index:2;}",
    ".curator-char-photowall-imgwrap{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;}",
    ".curator-char-photowall-img{width:100% !important;height:100% !important;object-fit:contain !important;display:block;transition:transform .32s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-char-photowall-tile:hover .curator-char-photowall-img{transform:scale(1.03);}",
    ".curator-char-photowall-topbar{position:absolute;top:6px;left:6px;right:6px;display:flex;align-items:center;justify-content:space-between;pointer-events:none;z-index:3;}",
    ".curator-char-photowall-score{padding:1.5px 6px;font-size:10px;font-weight:800;border-radius:5px;background:rgba(28,20,12,0.78);color:#f7df9c;border:1px solid rgba(217,167,74,0.45);backdrop-filter:blur(4px);}",
    ".curator-char-photowall-cropbtn{pointer-events:auto;cursor:pointer;padding:2px 6px;font-size:11px;border-radius:5px;border:1px solid rgba(255,255,255,0.28);background:rgba(28,20,12,0.75);color:#fffdf9;opacity:0;transform:scale(0.9);transition:all .18s ease;}",
    ".curator-char-photowall-tile:hover .curator-char-photowall-cropbtn{opacity:1;transform:scale(1);}",
    ".curator-char-photowall-cropbtn:hover{background:#8f683d;border-color:#f7df9c;}",
    ".curator-char-photowall-plaque{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 8px;background:linear-gradient(180deg, transparent 0%, rgba(20,14,9,0.76) 45%, rgba(16,11,7,0.92) 100%);color:#fffdf9;display:flex;flex-direction:column;gap:2px;z-index:3;transition:opacity .2s ease, transform .2s ease;}",
    ".curator-char-photowall-grid.is-hover-plaque .curator-char-photowall-plaque{opacity:0;transform:translateY(6px);}",
    ".curator-char-photowall-grid.is-hover-plaque .curator-char-photowall-tile:hover .curator-char-photowall-plaque{opacity:1;transform:translateY(0);}",
    ".curator-char-photowall-titleline{display:flex;align-items:baseline;justify-content:space-between;gap:6px;}",
    ".curator-char-photowall-name{font-size:12.5px;font-weight:800;color:#fffdf9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-char-photowall-height{font-size:10px;font-weight:700;color:#f7df9c;flex-shrink:0;}",
    ".curator-char-photowall-moes{font-size:9.5px;color:rgba(255,250,240,0.84);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    /* 立绘取景、换图与等身校准工坊模态框 (.curator-portrait-studio-modal) */
    ".modal.curator-portrait-studio-shell{width:min(880px, 94vw) !important;max-width:880px !important;}",
    ".curator-portrait-studio-modal{display:flex;flex-direction:column;gap:12px;}",
    ".curator-studio-header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--background-modifier-border);}",
    ".curator-studio-tab-bar{display:inline-flex;gap:6px;}",
    ".curator-studio-grid{display:grid;grid-template-columns:minmax(310px, 390px) 1fr;gap:16px;align-items:start;}",
    "@media (max-width: 740px){.curator-studio-grid{grid-template-columns:1fr;}}",
    ".curator-studio-stage-col{display:flex;flex-direction:column;gap:8px;}",
    ".curator-studio-stage-caption{font-size:11px;color:var(--text-muted);line-height:1.45;padding:6px 9px;border-radius:6px;background:var(--background-secondary);border-left:3px solid #8f683d;}",
    ".curator-studio-preview-pair{display:flex;gap:12px;align-items:flex-start;}",
    ".curator-studio-viewport-wrap{flex:1;display:flex;flex-direction:column;gap:5px;}",
    ".curator-studio-sub-label{font-size:11px;font-weight:700;color:var(--text-muted);}",
    ".curator-studio-viewport{position:relative;width:202px;height:282px;margin:0 auto;border-radius:9px;overflow:hidden;border:2px solid color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:var(--background-secondary);cursor:grab;user-select:none;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 18px rgba(0,0,0,0.08);}",
    ".curator-studio-viewport.is-dragging{cursor:grabbing;border-color:#8f683d;}",
    ".curator-studio-viewport.is-drop-hover{border-color:#3b6998;box-shadow:0 0 0 3px rgba(59,105,152,0.28);}",
    ".curator-studio-viewport-img{display:block;pointer-events:none;flex-shrink:0;}",
    ".curator-studio-viewport-img.is-spring-animating,.curator-studio-mini-ava img.is-spring-animating{transition:all .32s cubic-bezier(0.22,1,0.36,1);}",
    ".curator-studio-orig-full-bar{display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:8px;border:1px dashed color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f7f0e4 28%);}",
    ".curator-studio-orig-thumb-box{flex:0 0 58px;width:58px;height:86px;border-radius:6px;border:1px solid var(--background-modifier-border);background:radial-gradient(circle at 50% 40%, color-mix(in srgb, #f7df9c 18%, var(--background-primary)), var(--background-secondary));display:flex;align-items:center;justify-content:center;overflow:hidden;padding:2px;}",
    ".curator-studio-orig-thumb-img{width:100% !important;height:100% !important;object-fit:contain !important;display:block;}",
    ".curator-studio-orig-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}",
    ".curator-studio-orig-title{font-size:11.5px;font-weight:800;color:#8f683d;}",
    ".curator-studio-orig-dims{font-size:10.5px;color:var(--text-muted);}",
    ".curator-studio-orig-quick-btns{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px;}",
    ".curator-height-stand-box.is-bg-removed,.curator-studio-figure-box.is-bg-removed{background:transparent !important;border-color:transparent !important;}",
    ".curator-height-figure-col.is-selected .curator-height-stand-box.is-bg-removed{border-color:rgba(143,104,61,0.45) !important;background:linear-gradient(180deg, rgba(247,223,156,0.08), rgba(143,104,61,0.06)) !important;}",
    ".curator-studio-crosshair{position:absolute;width:16px;height:16px;border:2px solid #f7df9c;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 6px rgba(0,0,0,0.55);pointer-events:none;transition:opacity .18s ease;}",
    ".curator-studio-mode-badge{position:absolute;left:6px;right:6px;bottom:6px;padding:3px 7px;font-size:10px;font-weight:700;border-radius:5px;background:rgba(24,18,12,0.82);color:#f7df9c;text-align:center;pointer-events:none;}",
    ".curator-studio-minicard-wrap{width:108px;flex:0 0 108px;display:flex;flex-direction:column;gap:5px;align-items:center;}",
    ".curator-studio-minicard{padding:8px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-primary);display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;}",
    ".curator-studio-mini-ava{flex:0 0 106px !important;width:76px !important;height:106px !important;min-width:76px !important;min-height:106px !important;max-height:106px !important;}",
    ".curator-studio-mini-meta{text-align:center;width:100%;}",
    ".curator-studio-mini-name{font-size:11.5px;font-weight:800;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-studio-mini-sub{font-size:9.5px;color:var(--text-muted);}",
    ".curator-studio-ctrl-col{display:flex;flex-direction:column;gap:10px;}",
    ".curator-studio-panel-sec{padding:10px 12px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;flex-direction:column;gap:8px;}",
    ".curator-studio-sec-title{font-size:12px;font-weight:800;color:#8f683d;}",
    ".curator-studio-mode-btns,.curator-studio-preset-row,.curator-studio-upload-btns{display:flex;flex-wrap:wrap;gap:6px;}",
    ".curator-studio-slider-row{display:flex;flex-direction:column;gap:3px;}",
    ".curator-studio-slider-top{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);}",
    ".curator-studio-range{width:100%;accent-color:#8f683d;cursor:pointer;}",
    ".curator-studio-url-row{display:flex;gap:6px;align-items:center;}",
    ".curator-studio-url-row .curator-input{flex:1;}",
    ".curator-studio-height-stage{display:grid;grid-template-columns:46px 1fr;gap:6px;height:400px;padding:10px 12px 10px 6px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 40%, var(--background-modifier-border));background:linear-gradient(180deg, color-mix(in srgb, var(--background-secondary) 60%, #f8f1e4 40%), var(--background-primary));}",
    ".curator-studio-height-canvas{position:relative;height:380px;cursor:grab;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;}",
    ".curator-studio-height-canvas.is-dragging{cursor:grabbing;}",
    ".curator-studio-target-headline{position:absolute;left:0;right:0;height:0;border-top:2px dashed #8f683d;z-index:5;pointer-events:none;}",
    ".curator-studio-target-headtag{position:absolute;right:6px;top:-19px;padding:1px 7px;font-size:10px;font-weight:800;border-radius:999px;background:#8f683d;color:#fffdf9;}",
    ".curator-studio-figure-box{position:relative;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;border-radius:8px 8px 2px 2px;border:1px solid rgba(143,104,61,0.45);background:linear-gradient(180deg, rgba(247,223,156,0.16), rgba(143,104,61,0.12));z-index:3;pointer-events:none;}",
    ".curator-studio-figure-img{height:100% !important;width:auto !important;max-width:none !important;flex-shrink:0 !important;display:block;}",
    /* 角色典藏详览档案卡模态框 (.curator-char-detail-modal) */
    ".modal.curator-char-detail-shell{width:min(760px, 92vw) !important;max-width:760px !important;}",
    ".curator-char-detail-layout{display:grid;grid-template-columns:210px 1fr;gap:18px;align-items:start;}",
    "@media (max-width: 640px){.curator-char-detail-layout{grid-template-columns:1fr;}}",
    ".curator-char-detail-poster{position:relative;width:210px;height:294px;border-radius:10px;overflow:hidden;border:1.5px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:var(--background-secondary);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(28,20,12,0.14);}",
    ".curator-char-detail-poster img{width:100%;height:100%;display:block;}",
    ".curator-char-poster-edit-pill{cursor:pointer;position:absolute;left:8px;right:8px;bottom:8px;padding:5px 8px;font-size:11px;font-weight:700;border-radius:6px;border:1px solid rgba(247,223,156,0.55);background:rgba(24,18,12,0.85);color:#f7df9c;backdrop-filter:blur(4px);transition:all .16s ease;}",
    ".curator-char-poster-edit-pill:hover{background:#8f683d;color:#fffdf9;}",
    ".curator-char-detail-info-col{display:flex;flex-direction:column;gap:10px;min-width:0;}",
    ".curator-char-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--background-modifier-border);padding-bottom:8px;}",
    ".curator-char-detail-name{margin:0;font-size:18px;font-weight:800;color:var(--text-normal);}",
    ".curator-char-detail-jp{font-size:12px;color:var(--text-muted);}",
    ".curator-char-detail-score{padding:3px 10px;font-size:13px;font-weight:800;border-radius:6px;background:rgba(34,26,18,0.9);color:#f7df9c;border:1px solid rgba(217,167,74,0.6);}",
    ".curator-char-detail-attrs{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:6px;}",
    ".curator-char-detail-attr-cell{padding:5px 8px;border-radius:6px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);display:flex;flex-direction:column;gap:1px;}",
    ".curator-char-detail-attr-k{font-size:10px;color:var(--text-muted);font-weight:600;}",
    ".curator-char-detail-attr-v{font-size:12px;font-weight:700;color:var(--text-normal);}",
    ".curator-char-detail-block{display:flex;flex-direction:column;gap:5px;}",
    ".curator-char-detail-block-title{font-size:11.5px;font-weight:800;color:#8f683d;}",
    ".curator-char-detail-summary{font-size:12px;line-height:1.55;color:var(--text-muted);max-height:110px;overflow-y:auto;padding:6px 8px;border-radius:6px;background:var(--background-secondary);}",
    ".curator-char-detail-footer{margin-top:12px;}",
    reviewStudioService.getReviewStudioStyles(),
    roxyMascotService.getRoxy2DMascotStyles()
  ].join("\n");
}

module.exports = {
  extractEditionInfo,
  computeDeskMetrics,
  computeLocalUpdatedItems,
  collectAvailableSeasons,
  getEffectivePinnedSeasons,
  openDeskSeasonManagerModal,
  matchesInstantSearch,
  sortCatalogItems,
  renderCuratorDesk,
  applyIncrementalDashboardUpdate,
  getCuratorDeskStyles
};
