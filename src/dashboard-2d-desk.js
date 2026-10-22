const fs = require("fs");
const { openLocalPathSafely, inspectLocalFolder } = require("./note-utils.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const animeDownloadService = require("./anime-download-service.js");

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
    const bgm = item.bangumiScore !== null && Number.isFinite(item.bangumiScore)
      ? item.bangumiScore
      : (item.preciseScore !== null && Number.isFinite(item.preciseScore) ? item.preciseScore : null);
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
  let topStudioCount = 0;
  for (const [stName, cnt] of studioCounts.entries()) {
    if (cnt > topStudioCount) {
      topStudioCount = cnt;
      topStudio = `${stName} (${cnt}部)`;
    }
  }

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
    topStudio
  };
}

/**
 * 即时搜索匹配器：支持中文名、日文原名、Bangumi 编号、标签、制作公司、年份或番季
 */
function matchesInstantSearch(item, rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase();
  if (!q) return true;

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
    `${item.year || ""}${item.season || ""}`
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
        const ba = a.bangumiScore ?? a.preciseScore ?? -1;
        const bb = b.bangumiScore ?? b.preciseScore ?? -1;
        if (bb !== ba) return bb - ba;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
    case "bgmScore_desc":
      list.sort((a, b) => {
        const sa = a.bangumiScore ?? a.preciseScore ?? -1;
        const sb = b.bangumiScore ?? b.preciseScore ?? -1;
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
      searchQuery: "",
      statusFilter: "all", // "all" | "在看" | "已看" | "想看" | "抛弃" | "shelf:<id>" | "query:<id>"
      sortBy: saved.sortBy || "year_desc",
      viewMode: saved.viewMode || "gallery", // "gallery" | "index"
      deskTab: saved.deskTab || "auto", // "auto" | "watching" | "completed" | "plan" | "recent" | "season:<year>:<season>"
      deskLayoutMode: plugin.settings?.deskLayoutMode || saved.deskLayoutMode || "scroll", // "scroll" | "grid"
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
  plugin.settings.curatorDeskState = {
    sortBy: state.sortBy,
    viewMode: state.viewMode,
    deskTab: state.deskTab,
    deskLayoutMode: state.deskLayoutMode || "scroll",
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
 * 渲染案头追番席（首屏核心高频工作区：支持多季度自定义席位、基于真实本地文件夹的本地更新、无限/可配上限与丝滑左右滑动）
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

  if (!activeTab || activeTab === "auto" || (activeTab.startsWith("season:") && !validSeasonTab)) {
    if (hasWatching) {
      activeTab = "watching";
    } else if (recentItems.length > 0) {
      activeTab = "recent";
    } else if (pinnedSeasons.length > 0 && pinnedSeasons[0]?.id) {
      activeTab = pinnedSeasons[0].id;
    } else if (planItems.length > 0) {
      activeTab = "plan";
    } else {
      activeTab = "completed";
    }
    state.deskTab = activeTab;
  }

  const layoutMode = state.deskLayoutMode || plugin.settings?.deskLayoutMode || "scroll";
  const displayLimit = Math.max(0, Number(plugin.settings?.deskDisplayLimit) || 0);

  const header = deskMount.createDiv("curator-section-header curator-desk-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createSpan({ cls: "curator-section-kicker", text: "ACTIVE READING DESK" });
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
    { id: "watching", label: `正在追番 (${watchingItems.length})`, title: "当前观看状态为「在看」的连载作品" },
    {
      id: "recent",
      label: `本地更新 (${recentItems.length})`,
      title: "仅展示本地视频文件夹内有剧集更新（本地视频集数 > 已看集数，或近期下载了新视频）的作品，完结老番或未建文件夹作品不会混入"
    },
    { id: "plan", label: `想看候补 (${planItems.length})`, title: "当前观看状态为「想看」的候补作品" },
    { id: "completed", label: `最近完成 (${completedItems.length})`, title: "已看完归档的作品" }
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
      text: "当前案头暂无「在看」作品。以下为您展示待命候补案卷（可左右滑动浏览全部），点击「▶ 置入在看」即可开启连载追踪，或点击上方季度标签浏览新番。"
    });
    if (pinnedSeasons.length > 0) {
      const switchBtn = fallbackBanner.createEl("button", {
        cls: "curator-mini-btn is-accent",
        text: `查看 ${pinnedSeasons[0].label} →`
      });
      switchBtn.onclick = () => {
        state.deskTab = pinnedSeasons[0].id;
        renderActiveDeskSection(plugin, deskMount, state, helpers);
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
  } else if (activeTab === "completed") {
    rawList = completedItems;
  } else if (activeTab === "plan") {
    rawList = planItems;
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
        text: "可通过命令面板导入动画笔记，或在下方馆藏总览中调整作品观看状态。"
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
 * 渲染单张案头追番席卡片：
 * - 支持完整追番工作卡（进度条 + -1/+1 + 本地更新集数签 + 播放下一话/下载RSS/目录/笔记/趋势）
 * - 支持轻量候补推荐卡（封面 + 完整标题 + 状态/评分 + 番季制作社 + 主操作「▶ 置入在看」+「⬇ 下载」+「笔记 ↗」）
 */
function renderDeskCard(plugin, parent, item, state, helpers, cardOpts = {}) {
  const currentState = item.state || "未设置";
  const isStandby = Boolean(cardOpts.isStandby);
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

  const bgmVal = item.bangumiScore ?? item.preciseScore;
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

  // 分支 B：完整工作卡（进度条 + -1/+1 步进控制 + 播放下一话/下载RSS/目录/笔记/趋势）
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

  // 底部快捷动作栏（播放下一话 / 追番下载与RSS / 本地目录 / 动画笔记 / 评分趋势）
  const actionsRow = body.createDiv("curator-desk-actions-row");

  if (localResult && !localResult.error && localResult.fileCount > 0 && localResult.nextEpisodeFile) {
    const nextEpNum = localResult.nextEpisodeNumber || (watched + 1);
    const playBtn = actionsRow.createEl("button", {
      cls: "curator-action-link is-primary",
      text: `▶ 播放第${nextEpNum}话`
    });
    playBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await openLocalPathSafely(localResult.nextEpisodeFile);
    };
  }

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
 * 渲染主馆藏目录区（支持画廊封面模式 Gallery 与 编目索引模式 Index）
 */
function renderCatalogSection(plugin, catalogMount, state, helpers) {
  const scrollParent = plugin.getDashboardScrollParent(catalogMount);
  const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

  catalogMount.empty();
  const allItems = state.items || [];

  // 1. 按状态或展柜/自定义分区筛选
  let baseFiltered = allItems;
  let activeFilterLabel = "全部馆藏";

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

  const header = catalogMount.createDiv("curator-section-header curator-catalog-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createSpan({ cls: "curator-section-kicker", text: "ARCHIVE CATALOG" });
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "馆藏编目总览" });
  titleWrap.createSpan({
    cls: "curator-section-badge",
    text: `${activeFilterLabel} · 显示 ${sortedItems.length} / ${allItems.length} 部`
  });

  if (state.searchQuery || (state.statusFilter && state.statusFilter !== "all")) {
    const clearFilterBtn = header.createEl("button", {
      cls: "curator-mini-btn",
      text: "重置检索与筛选 ×"
    });
    clearFilterBtn.onclick = () => {
      state.searchQuery = "";
      state.statusFilter = "all";
      if (helpers.syncTopbarControls) {
        helpers.syncTopbarControls();
      }
      renderCatalogSection(plugin, catalogMount, state, helpers);
    };
  }

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
    const emptyBox = catalogMount.createDiv("curator-empty-box");
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
    renderCatalogIndexMode(plugin, catalogMount, sortedItems, state, helpers);
  } else {
    renderCatalogGalleryMode(plugin, catalogMount, sortedItems, state, helpers);
  }

  if (scrollParent && savedScrollTop > 0) {
    scrollParent.scrollTop = savedScrollTop;
  }
}

/**
 * 模式 A：画廊封面模式（纸本档案封套卡片，固定高度行高对齐，底部操作轻量化收敛）
 */
function renderCatalogGalleryMode(plugin, container, items, state, helpers) {
  const grid = container.createDiv("curator-gallery-grid");

  for (const item of items) {
    const edition = extractEditionInfo(item);
    const card = grid.createDiv("curator-gallery-card bangumi-grid-card");
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

    // 右上角评分签
    let scoreBadgeText = "★ 评分";
    if (item.personalScore !== null) {
      scoreBadgeText = `★ ${item.personalScore.toFixed(1)}`;
    } else if (item.bangumiScore !== null) {
      scoreBadgeText = `BGM ${item.bangumiScore.toFixed(1)}`;
    } else if (item.preciseScore !== null) {
      scoreBadgeText = `BGM ${item.preciseScore.toFixed(1)}`;
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
          await openLocalPathSafely(localResult.nextEpisodeFile);
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
}

/**
 * 模式 B：编目索引模式（高密度台账表，长标题完整换行自适应，数字稳定等宽对齐）
 */
function renderCatalogIndexMode(plugin, container, items, state, helpers) {
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

  items.forEach((item, idx) => {
    const edition = extractEditionInfo(item);
    const row = body.createDiv("curator-index-row");
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
    const bgmVal = item.bangumiScore ?? item.preciseScore;
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
}

/**
 * 渲染自定义收藏展柜与自定义查询分区（保留完整管理/编辑/拖拽排序能力）
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

  if (collectionConfigs.length === 0 && customConfigs.length === 0) {
    return;
  }

  const header = shelvesMount.createDiv("curator-section-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createSpan({ cls: "curator-section-kicker", text: "CURATED SHELVES & PARTITIONS" });
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "收藏展柜与自定义分区" });
  titleWrap.createSpan({
    cls: "curator-section-badge",
    text: `${collectionConfigs.length} 展柜 · ${customConfigs.length} 分区`
  });

  const sectionsGrid = shelvesMount.createDiv("bangumi-dashboard-sections curator-shelves-grid");
  const collapsedMap = plugin.settings.dashboardSectionCollapsed || {};
  const hiddenMap = plugin.settings.dashboardSectionHidden || {};

  for (const colConfig of collectionConfigs) {
    const secId = `collection_${colConfig.id}`;
    if (hiddenMap[secId]) continue;
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
      onReorder: async () => {},
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
      onReorder: async () => {},
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
}

/**
 * 渲染收拢在底部的“馆藏统计与洞察年鉴”（默认显示精炼摘要条，点击展开完整 9 大统计与榜单模块）
 */
function renderAlmanacSection(plugin, almanacMount, state, container, options) {
  almanacMount.empty();
  const items = state.items || [];
  const metrics = computeDeskMetrics(items);

  const header = almanacMount.createDiv("curator-section-header curator-almanac-header");
  const titleWrap = header.createDiv("curator-section-title-wrap");
  titleWrap.createSpan({ cls: "curator-section-kicker", text: "ARCHIVE ALMANAC & INSIGHTS" });
  titleWrap.createEl("h2", { cls: "curator-section-title", text: "馆藏统计与洞察年鉴" });
  titleWrap.createSpan({
    cls: "curator-section-badge",
    text: "9 项统计与排行模块"
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

  // 展开状态下：完整渲染原有的 9 大统计与排行榜模块
  const personalItems = items
    .filter((item) => item.personalScore !== null)
    .sort((a, b) => b.personalScore - a.personalScore || a.name.localeCompare(b.name, "zh-CN"));

  const bangumiItems = items
    .filter((item) => item.bangumiScore !== null)
    .sort((a, b) => b.bangumiScore - a.bangumiScore || a.name.localeCompare(b.name, "zh-CN"));

  const preciseItems = items
    .filter((item) => item.preciseScore !== null)
    .sort((a, b) => b.preciseScore - a.preciseScore || a.name.localeCompare(b.name, "zh-CN"));

  const personalLimit = Math.max(1, Number(plugin.settings.dashboardPersonalRankLimit) || 10);
  const bangumiLimit = Math.max(1, Number(plugin.settings.dashboardBangumiRankLimit) || 10);
  const preciseLimit = Math.max(1, Number(plugin.settings.dashboardBangumiRankLimit) || 10);

  const almanacDefs = [
    {
      id: "progressStats",
      title: "追番全景与时长统计",
      badgeText: `${items.length} 部`,
      hasData: items.length > 0,
      emptyText: "暂无动画数据",
      spanFull: true,
      renderBody: (body) => plugin.renderProgressStats(body, items)
    },
    {
      id: "yearStats",
      title: "年代与番季分布",
      badgeText: items.some((it) => it.year) ? "年代统计" : "",
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
      emptyText: "需要同时拥有“我的评分”与“BGM评分”方可进行对比分析",
      spanFull: true,
      renderBody: (body) => plugin.renderScoreDelta(body, items)
    },
    {
      id: "studioStats",
      title: "制作公司与改编类型",
      badgeText: items.some((it) => it.studio || it.animeType) ? "深度统计" : "",
      hasData: items.some((it) => it.studio || it.animeType),
      emptyText: "笔记中暂无制作公司或改编类型信息",
      spanFull: true,
      renderBody: (body) => plugin.renderStudioStats(body, items)
    },
    {
      id: "distribution",
      title: "我的评分分布",
      badgeText: personalItems.length ? `${personalItems.length} 部` : "",
      hasData: personalItems.length > 0,
      emptyText: "填写“我的评分”后会显示评分分布",
      spanFull: false,
      renderBody: (body) => plugin.renderDistributionBars(body, items)
    },
    {
      id: "watchState",
      title: "观看状态概览",
      badgeText: items.length ? `${items.length} 部` : "",
      hasData: items.length > 0,
      emptyText: "暂无观看状态记录",
      spanFull: false,
      renderBody: (body) => plugin.renderWatchStateCards(body, items)
    },
    {
      id: "personalRank",
      title: "我的评分排名",
      badgeText: personalItems.length ? `TOP ${Math.min(personalLimit, personalItems.length)}` : "",
      hasData: personalItems.length > 0,
      emptyText: "暂无可显示的评分记录（笔记未填写“我的评分”）",
      spanFull: false,
      renderBody: (body) => {
        const list = body.createDiv("bangumi-dashboard-rank-list");
        plugin.renderRankListRows(list, personalItems, "personalScore", "bangumiScore", personalLimit);
      }
    },
    {
      id: "bangumiRank",
      title: "BGM 用户评分排名",
      badgeText: bangumiItems.length ? `TOP ${Math.min(bangumiLimit, bangumiItems.length)}` : "",
      hasData: bangumiItems.length > 0,
      emptyText: "暂无可显示的评分记录",
      spanFull: false,
      renderBody: (body) => {
        const list = body.createDiv("bangumi-dashboard-rank-list");
        plugin.renderRankListRows(list, bangumiItems, "bangumiScore", "personalScore", bangumiLimit);
      }
    },
    {
      id: "preciseRank",
      title: "BGM 精确评分排名",
      badgeText: preciseItems.length ? `TOP ${Math.min(preciseLimit, preciseItems.length)}` : "",
      hasData: preciseItems.length > 0,
      emptyText: "暂无可显示的精确评分记录",
      spanFull: true,
      renderBody: (body) => {
        const list = body.createDiv("bangumi-dashboard-rank-list");
        plugin.renderPreciseRankListRows(list, preciseItems, preciseLimit);
      }
    }
  ];

  const hiddenMap = plugin.settings.dashboardSectionHidden || {};
  const isHidden = (id) => {
    if (typeof hiddenMap[id] === "boolean") return hiddenMap[id];
    if (id === "preciseRank") return plugin.settings.dashboardShowPreciseRank === false;
    return false;
  };

  const collapsedMap = plugin.settings.dashboardSectionCollapsed || {};
  const sectionsGrid = bodyWrap.createDiv("bangumi-dashboard-sections curator-almanac-grid");

  for (const def of almanacDefs) {
    if (isHidden(def.id)) continue;
    const isCollapsed = Boolean(collapsedMap[def.id]);
    plugin.createDashboardSection(sectionsGrid, {
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
      onReorder: async () => {}
    });
  }

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
        if (hDef.id === "preciseRank") {
          plugin.settings.dashboardShowPreciseRank = true;
        }
        await plugin.saveSettings();
        renderAlmanacSection(plugin, almanacMount, state, container, options);
      };
    }
  }
}

function itemHasBothScores(it) {
  return it.personalScore !== null && (it.bangumiScore !== null || it.preciseScore !== null);
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
    text: "BANGUMI ARCHIVE · 番剧档案馆"
  });
  const titleLine = brandCol.createDiv("curator-brand-title-line");
  titleLine.createEl("h1", {
    cls: "curator-brand-title",
    text: "二维案头编目台 · CURATOR'S DESK"
  });

  // 紧凑核心馆藏摘要
  const metrics = computeDeskMetrics(items);
  const summaryStrip = topRow1.createDiv("curator-summary-strip");
  const summaryDefs = [
    { label: "馆藏总数", val: `${metrics.total} 部`, role: "summary-total" },
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

  // 顶栏右侧主操作按钮组
  const actionsCol = topRow1.createDiv("curator-topbar-actions");

  const addQueryBtn = actionsCol.createEl("button", {
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
      await renderCuratorDesk(plugin, container, options, helpers);
    });
  };

  const addCollectionBtn = actionsCol.createEl("button", {
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
      await renderCuratorDesk(plugin, container, options, helpers);
    });
  };

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
    state.searchQuery = "";
    state.statusFilter = "all";
    state.sortBy = "year_desc";
    state.viewMode = "gallery";
    state.deskTab = "auto";
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

  // ==================== 顶栏第 2 行：即时检索 + 状态/展柜快筛 + 排序与视图控制 ====================
  const topRow2 = topbar.createDiv("curator-topbar-row2");

  // 即时检索框
  const searchWrap = topRow2.createDiv("curator-search-wrap");
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

  // 状态与收藏展柜快筛胶囊
  const filterBar = topRow2.createDiv("curator-filter-bar");
  const baseFilters = [
    { key: "all", label: "全部", count: metrics.total },
    { key: "在看", label: "在看", count: metrics.stateCounts["在看"] },
    { key: "已看", label: "已看", count: metrics.stateCounts["已看"] },
    { key: "想看", label: "想看", count: metrics.stateCounts["想看"] },
    { key: "抛弃", label: "抛弃", count: metrics.stateCounts["抛弃"] }
  ];

  // 追加自定义收藏展柜快筛入口
  const collections = Array.isArray(plugin.settings.customCollectionSections)
    ? plugin.settings.customCollectionSections
    : [];
  for (const col of collections) {
    const resolved = plugin.resolveCollectionItems(col, items);
    baseFilters.push({
      key: `shelf:${col.id}`,
      label: `展柜·${col.title}`,
      count: resolved.length
    });
  }

  // 追加自定义查询分区快筛入口（排除与状态重复的默认追番分区）
  const customQueries = Array.isArray(plugin.settings.customQuerySections)
    ? plugin.settings.customQuerySections
    : [];
  for (const cq of customQueries) {
    if (cq.id === "preset_currently_watching") continue;
    const matched = plugin.filterCustomQueryItems(items, cq);
    baseFilters.push({
      key: `query:${cq.id}`,
      label: `分区·${cq.title}`,
      count: matched.length
    });
  }

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
      syncTopbarControls();
      renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
    };
  });

  // 排序与浏览模式控制
  const viewControls = topRow2.createDiv("curator-view-controls");
  const sortSelect = viewControls.createEl("select", { cls: "curator-sort-select" });
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
    renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
  };

  const modeGroup = viewControls.createDiv("curator-mode-toggle-group");
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

  // ==================== 2. 四大工作区挂载点 ====================
  const deskMount = container.createDiv("curator-mount-active-desk");
  const catalogMount = container.createDiv("curator-mount-catalog");
  const shelvesMount = container.createDiv("curator-mount-shelves");
  const almanacMount = container.createDiv("curator-mount-almanac");

  const syncTopbarControls = () => {
    if (searchInput.value !== (state.searchQuery || "")) {
      searchInput.value = state.searchQuery || "";
    }
    searchClearBtn.classList.toggle("is-visible", Boolean(state.searchQuery));
    filterBar.querySelectorAll(".curator-filter-pill").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.filterKey === state.statusFilter);
    });
    btnGallery.classList.toggle("is-active", state.viewMode === "gallery");
    btnIndex.classList.toggle("is-active", state.viewMode === "index");
  };

  const runtimeHelpers = Object.assign({}, helpers, {
    syncTopbarControls,
    deskMount,
    catalogMount,
    shelvesMount,
    almanacMount
  });
  container._deskRuntime = runtimeHelpers;

  searchInput.oninput = () => {
    state.searchQuery = searchInput.value;
    searchClearBtn.classList.toggle("is-visible", Boolean(state.searchQuery));
    renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
  };

  searchClearBtn.onclick = (e) => {
    e.preventDefault();
    state.searchQuery = "";
    searchInput.value = "";
    searchClearBtn.classList.remove("is-visible");
    renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
  };

  btnGallery.onclick = (e) => {
    e.preventDefault();
    if (state.viewMode !== "gallery") {
      state.viewMode = "gallery";
      persistDeskPrefs(plugin, state);
      syncTopbarControls();
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "view:mode_switch",
        state: "explain",
        category: "视图切换",
        priority: roxyMascotService.PRIORITY.LOW,
        dedupeKey: "view:gallery",
        message: "已经为您切换回「画廊封面」模式了，看着一排排封面心情也会变好呢。"
      });
      renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
    }
  };

  btnIndex.onclick = (e) => {
    e.preventDefault();
    if (state.viewMode !== "index") {
      state.viewMode = "index";
      persistDeskPrefs(plugin, state);
      syncTopbarControls();
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "view:mode_switch",
        state: "explain",
        category: "视图切换",
        priority: roxyMascotService.PRIORITY.LOW,
        dedupeKey: "view:index",
        message: "已经切换成「编目索引」台账模式了，像这样核对集数和评分对比会更清晰一些。"
      });
      renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
    }
  };

  renderActiveDeskSection(plugin, deskMount, state, runtimeHelpers);
  renderCatalogSection(plugin, catalogMount, state, runtimeHelpers);
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
 * 局部增量更新：当集数 +1 / -1 / 修改个人评分 / 切换观看状态 / 增删标签时，
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
    }
  }

  // 2. 原地刷新顶栏核心统计与快筛胶囊计数
  updateTopbarMetricsInPlace(plugin, container, state);

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
        const bgmVal = item.bangumiScore ?? item.preciseScore;
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

  // 4. 若观看状态或标签变更，局部刷新案头追番席与（在筛选激活时的）目录区，不触碰顶栏和滚动条
  if (updates.state !== undefined || updates.addTag || updates.removeTag) {
    if (updates.state === "在看") {
      state.deskTab = "watching";
    }
    if (runtime.deskMount) {
      renderActiveDeskSection(plugin, runtime.deskMount, state, runtime);
    }
    if (
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
    /* 顶栏第二行：即时检索 + 快筛 + 视图切换 */
    ".curator-topbar-row2{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:10px;border-top:1px dashed var(--background-modifier-border);}",
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
    ".curator-almanac-grid .bangumi-dashboard-section{border-radius:9px !important;border:1px solid color-mix(in srgb, #9e784b 22%, var(--background-modifier-border)) !important;border-left:3px solid rgba(143,104,61,0.58) !important;background:var(--background-primary) !important;}",
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
