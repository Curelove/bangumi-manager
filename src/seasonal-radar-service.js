const { requestUrl, Notice } = require("obsidian");
const bangumiApi = require("./bangumi-api.js");
const noteManager = require("./note-manager.js");

/**
 * 历史年份全网动画作品基准库（1980–2025 已完结历史年份，免重复网络请求、零卡顿）
 * 数据口径：Bangumi 番组计划按年份收录的 TV / WEB / OVA / 剧场版 动画条目基准总数
 */
const HISTORICAL_YEAR_TOTAL_BASELINE = {
  1980: 58, 1981: 64, 1982: 68, 1983: 76, 1984: 82, 1985: 90, 1986: 98, 1987: 108, 1988: 116, 1989: 120,
  1990: 118, 1991: 124, 1992: 128, 1993: 135, 1994: 142, 1995: 150, 1996: 162, 1997: 170, 1998: 192, 1999: 208,
  2000: 215, 2001: 238, 2002: 256, 2003: 278, 2004: 302, 2005: 325, 2006: 368, 2007: 382, 2008: 396, 2009: 412,
  2010: 425, 2011: 458, 2012: 486, 2013: 518, 2014: 562, 2015: 585, 2016: 628, 2017: 642, 2018: 658, 2019: 635,
  2020: 572, 2021: 624, 2022: 638, 2023: 662, 2024: 678, 2025: 665,
  // 2026 及以后作为动态兜底初始值（联网拉取后立即更新为 Bangumi 实时「目前已确定动画」精确数量）
  2026: 540,
  2027: 160
};

/**
 * 四个番季在全年中的典型分布比例（当某历史季度尚未单独拉取精确值时的零延迟基准）
 */
const SEASON_SHARE_WEIGHTS = {
  "01": 0.23,
  "04": 0.26,
  "07": 0.25,
  "10": 0.26
};

/**
 * 阿斯拉王立魔导书库 · 五大编年纪元定义
 */
const GRIMOIRE_ERAS = [
  {
    id: "era-current",
    label: "当代连载",
    subLabel: "2025–2026+",
    fullTitle: "当代连载 · 星辉新卷 (2025–2026+)",
    color: "#3b6998",
    spineTone: "is-tone-sapphire",
    match: (y, isNum) => isNum && y >= 2025
  },
  {
    id: "era-recent",
    label: "近世卷轴",
    subLabel: "2021–2024",
    fullTitle: "近世卷轴 · 魔导涌流 (2021–2024)",
    color: "#4c8b73",
    spineTone: "is-tone-emerald",
    match: (y, isNum) => isNum && y >= 2021 && y <= 2024
  },
  {
    id: "era-prime",
    label: "盛世馆藏",
    subLabel: "2016–2020",
    fullTitle: "盛世馆藏 · 黄金秘仪 (2016–2020)",
    color: "#8f683d",
    spineTone: "is-tone-bronze",
    match: (y, isNum) => isNum && y >= 2016 && y <= 2020
  },
  {
    id: "era-golden",
    label: "黄金魔导期",
    subLabel: "2010–2015",
    fullTitle: "黄金魔导期 · 王立典籍 (2010–2015)",
    color: "#a85644",
    spineTone: "is-tone-crimson",
    match: (y, isNum) => isNum && y >= 2010 && y <= 2015
  },
  {
    id: "era-ancient",
    label: "远古秘典",
    subLabel: "2009及以前",
    fullTitle: "远古秘典 · 创世古卷 (2009及以前)",
    color: "#6d5b8c",
    spineTone: "is-tone-amethyst",
    match: (y, isNum) => !isNum || y <= 2009
  }
];

function resolveEraForYear(yearStr, isNumeric) {
  const yNum = Number(yearStr);
  for (const era of GRIMOIRE_ERAS) {
    if (era.match(yNum, isNumeric)) return era;
  }
  return GRIMOIRE_ERAS[GRIMOIRE_ERAS.length - 1];
}

/**
 * 获取当前真实年月与所属番季（01 / 04 / 07 / 10）
 */
function getCurrentYearAndSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let seasonMonth = "10";
  if (month <= 2) seasonMonth = "01";
  else if (month <= 5) seasonMonth = "04";
  else if (month <= 8) seasonMonth = "07";
  else if (month <= 11) seasonMonth = "10";
  else {
    return { year: year + 1, seasonMonth: "01", rawYear: year, rawMonth: month };
  }
  return { year, seasonMonth, rawYear: year, rawMonth: month };
}

/**
 * 判断某个年份或某年某季度是否属于「动态未完结/未来排期」（需表述为“目前已确定 N 部”）
 */
function isDynamicYearOrSeason(yearNum, seasonMonth = null) {
  const cur = getCurrentYearAndSeason();
  const y = Number(yearNum);
  if (!Number.isFinite(y)) return false;
  if (y > cur.rawYear) return true;
  if (y < cur.rawYear) return false;
  if (!seasonMonth) return true;
  const sm = parseInt(seasonMonth, 10) || 1;
  const curSm = parseInt(cur.seasonMonth, 10) || 1;
  return sm >= curSm;
}

/**
 * 获取某年某季度的起止日期区间（用于向 Bangumi v0 search API 查询当季目前已确定动画）
 */
function getSeasonDateRange(yearNum, seasonMonth) {
  const y = Number(yearNum);
  const sm = String(seasonMonth).padStart(2, "0");
  if (sm === "01") {
    return { start: `${y}-01-01`, end: `${y}-03-31`, label: `${y}年01月` };
  }
  if (sm === "04") {
    return { start: `${y}-04-01`, end: `${y}-06-30`, label: `${y}年04月` };
  }
  if (sm === "07") {
    return { start: `${y}-07-01`, end: `${y}-09-30`, label: `${y}年07月` };
  }
  return { start: `${y}-10-01`, end: `${y}-12-31`, label: `${y}年10月` };
}

/**
 * 读取某年或某季度的全网动画总数（优先读取持久化缓存 -> 历史年份基准 -> 异步拉取动态更新）
 */
function getTotalAnimeCountForYearOrSeason(plugin, yearNum, seasonMonth = null) {
  const y = Number(yearNum);
  if (!Number.isFinite(y) || y < 1960 || y > 2035) {
    return { total: null, isDynamic: false, fromCache: false };
  }
  const cache = (plugin?.settings?.seasonalTotalCountCache) || {};
  const isDyn = isDynamicYearOrSeason(y, seasonMonth);

  if (!seasonMonth) {
    const key = `Y:${y}`;
    if (cache[key] && Number(cache[key].total) > 0) {
      return { total: Number(cache[key].total), isDynamic: isDyn, fromCache: true, updatedAt: cache[key].updatedAt };
    }
    const base =
      HISTORICAL_YEAR_TOTAL_BASELINE[y] ||
      (y < 1980 ? 45 : y > 2026 ? 120 : 600);
    return { total: base, isDynamic: isDyn, fromCache: false };
  }

  const sm = String(seasonMonth).padStart(2, "0");
  const sKey = `S:${y}-${sm}`;
  if (cache[sKey] && Number(cache[sKey].total) > 0) {
    return { total: Number(cache[sKey].total), isDynamic: isDyn, fromCache: true, updatedAt: cache[sKey].updatedAt };
  }

  const yearTotalInfo = getTotalAnimeCountForYearOrSeason(plugin, y, null);
  const weight = SEASON_SHARE_WEIGHTS[sm] || 0.25;
  const est = Math.max(12, Math.round((yearTotalInfo.total || 500) * weight));
  return { total: est, isDynamic: isDyn, fromCache: false };
}

/**
 * 检查本地封面附件目录（如 附件/Bangumi Images）下是否已存在指定番剧的本地封面文件
 * 若已存在则直接返回本地 Vault 资源路径，避免重复请求远程外链
 */
function resolveLocalCoverForSubject(plugin, subjectId, vaultItem = null) {
  const app = plugin?.app;
  if (!app || !app.vault) {
    return { hasLocal: false, localPath: "", resourceUrl: "" };
  }

  // 1. 若已在馆藏中且笔记记录了本地封面路径，优先解析
  if (vaultItem && vaultItem.cover && !/^https?:\/\//i.test(String(vaultItem.cover).trim())) {
    const cleanCover = String(vaultItem.cover)
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0]
      .trim();
    const directFile = app.vault.getAbstractFileByPath(cleanCover);
    if (directFile && typeof app.vault.getResourcePath === "function") {
      return {
        hasLocal: true,
        localPath: directFile.path,
        resourceUrl: app.vault.getResourcePath(directFile)
      };
    }
    if (typeof plugin.getCoverResourceUrl === "function") {
      const resolved = plugin.getCoverResourceUrl(vaultItem.cover, vaultItem.file?.path || "");
      if (resolved && !/^https?:\/\//i.test(resolved)) {
        return {
          hasLocal: true,
          localPath: cleanCover,
          resourceUrl: resolved
        };
      }
    }
  }

  // 2. 检查用户设置的 coverFolder 下是否存在 bangumi-cover-{id}.{ext}
  const rawId = String(subjectId || vaultItem?.subjectId || "").trim();
  if (!rawId) {
    return { hasLocal: false, localPath: "", resourceUrl: "" };
  }

  const coverFolder = String(plugin?.settings?.coverFolder || "附件/Bangumi Images")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const exts = ["jpg", "png", "webp", "jpeg", "gif", "avif"];

  for (const ext of exts) {
    const candidatePath = `${coverFolder}/bangumi-cover-${rawId}.${ext}`;
    const file = app.vault.getAbstractFileByPath(candidatePath);
    if (file && typeof app.vault.getResourcePath === "function") {
      return {
        hasLocal: true,
        localPath: file.path,
        resourceUrl: app.vault.getResourcePath(file)
      };
    }
  }

  return { hasLocal: false, localPath: "", resourceUrl: "" };
}

/**
 * 向 Bangumi API 异步查询某年或某季度的真实动画总数与排期条目列表（带防抖与持久化缓存）
 */
const _inflightQueries = new Map();

async function fetchSeasonalAnimeFromBangumi(plugin, yearNum, seasonMonth = "10", options = {}) {
  const y = Number(yearNum);
  const sm = String(seasonMonth || "10").padStart(2, "0");
  const cacheKey = `${y}-${sm}`;

  if (!plugin.settings.seasonalRadarCache) {
    plugin.settings.seasonalRadarCache = {};
  }
  if (!plugin.settings.seasonalTotalCountCache) {
    plugin.settings.seasonalTotalCountCache = {};
  }

  const existing = plugin.settings.seasonalRadarCache[cacheKey];
  const isDyn = isDynamicYearOrSeason(y, sm);
  const ttlMs = isDyn ? 1000 * 60 * 60 * 6 : 1000 * 60 * 60 * 24 * 30;

  if (
    !options.forceRefresh &&
    existing &&
    Array.isArray(existing.subjects) &&
    existing.subjects.length > 0 &&
    Date.now() - (existing.updatedAt || 0) < ttlMs
  ) {
    return existing;
  }

  if (_inflightQueries.has(cacheKey)) {
    return _inflightQueries.get(cacheKey);
  }

  const task = (async () => {
    try {
      const range = getSeasonDateRange(y, sm);
      const res = await requestUrl({
        url: "https://api.bgm.tv/v0/search/subjects?limit=50&offset=0",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "curelove/obsidian-bangumi-manager (https://github.com/Curelove/bangumi-manager)"
        },
        body: JSON.stringify({
          keyword: "",
          sort: "heat",
          filter: {
            type: [2],
            air_date: [`>=${range.start}`, `<=${range.end}`]
          }
        })
      });

      const data = res.json || JSON.parse(res.text || "{}");
      const rawList = Array.isArray(data.data) ? data.data : [];
      const totalCount = Number(data.total) || rawList.length;

      const subjects = rawList.map((s) => {
        const tags = Array.isArray(s.tags)
          ? s.tags.slice(0, 8).map((t) => t.name).filter(Boolean)
          : Array.isArray(s.meta_tags)
          ? s.meta_tags.slice(0, 8)
          : [];
        const rawCover = s.images?.common || s.images?.medium || s.images?.large || "";
        return {
          id: String(s.id || ""),
          name: String(s.name_cn || s.name || "").trim(),
          originalName: String(s.name || "").trim(),
          date: String(s.date || range.start).trim(),
          score: s.rating && Number(s.rating.score) > 0 ? Number(s.rating.score) : null,
          rank: s.rating && Number(s.rating.rank) > 0 ? Number(s.rating.rank) : null,
          totalVotes: s.rating && Number(s.rating.total) > 0 ? Number(s.rating.total) : 0,
          cover: rawCover.startsWith("//") ? "https:" + rawCover : rawCover,
          summary: String(s.summary || "").replace(/\s+/g, " ").trim().slice(0, 140),
          tags
        };
      });

      const record = {
        year: y,
        seasonMonth: sm,
        total: totalCount > 0 ? totalCount : subjects.length,
        subjects,
        updatedAt: Date.now()
      };

      plugin.settings.seasonalRadarCache[cacheKey] = record;
      if (record.total > 0) {
        plugin.settings.seasonalTotalCountCache[`S:${y}-${sm}`] = {
          total: record.total,
          updatedAt: Date.now()
        };
      }

      try {
        const yearRes = await requestUrl({
          url: "https://api.bgm.tv/v0/search/subjects?limit=1&offset=0",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "curelove/obsidian-bangumi-manager (https://github.com/Curelove/bangumi-manager)"
          },
          body: JSON.stringify({
            keyword: "",
            filter: {
              type: [2],
              air_date: [`>=${y}-01-01`, `<=${y}-12-31`]
            }
          })
        });
        const yData = yearRes.json || JSON.parse(yearRes.text || "{}");
        if (Number(yData.total) > 0) {
          plugin.settings.seasonalTotalCountCache[`Y:${y}`] = {
            total: Number(yData.total),
            updatedAt: Date.now()
          };
        }
      } catch (e) {}

      await plugin.saveSettings();
      return record;
    } catch (err) {
      console.warn("[BangumiSeasonalRadar] 查询番季排期失败:", err);
      return existing || { year: y, seasonMonth: sm, total: 0, subjects: [], error: err.message };
    } finally {
      _inflightQueries.delete(cacheKey);
    }
  })();

  _inflightQueries.set(cacheKey, task);
  return task;
}

/**
 * 分析用户本地馆藏的审美偏好画像（高频高分标签、偏爱制作社、偏爱改编类型）
 */
function computeUserTasteProfile(items) {
  const tagMap = new Map();
  const studioMap = new Map();
  const typeMap = new Map();

  const stopTags = new Set([
    "bangumi", "tv", "web", "ova", "oad", "movie", "剧场版", "日本", "动画",
    "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027",
    "1月", "4月", "7月", "10月", "01月", "04月", "07月", "10月"
  ]);

  for (const it of Array.isArray(items) ? items : []) {
    if (it.state === "抛弃") continue;
    const score = it.personalScore ?? it.preciseScore ?? it.publicScore ?? it.bangumiScore ?? 7.2;
    const weight = it.personalScore !== null ? (it.personalScore >= 8.5 ? 2.4 : it.personalScore >= 7.5 ? 1.5 : 0.8) : 1.0;

    const rawTags = Array.isArray(it.tags)
      ? it.tags
      : String(it.tags || "").split(/[,，;；\s#\[\]"']+/).filter(Boolean);
    for (const rawT of rawTags) {
      const cleanT = String(rawT).replace(/^#+/, "").trim();
      if (!cleanT || cleanT.length < 2 || stopTags.has(cleanT.toLowerCase())) continue;
      if (/^\d{4}年?/.test(cleanT)) continue;
      const prev = tagMap.get(cleanT) || { name: cleanT, count: 0, weightSum: 0, avgScoreSum: 0 };
      prev.count += 1;
      prev.weightSum += weight;
      prev.avgScoreSum += Number(score) || 7.5;
      tagMap.set(cleanT, prev);
    }

    if (it.studio) {
      const studios = String(it.studio)
        .split(/[,;\/、&]+/)
        .map((s) => s.trim())
        .filter((s) => s && !/^(未知|无|暂无|-)$/i.test(s));
      for (const st of studios) {
        const prev = studioMap.get(st) || { name: st, count: 0, weightSum: 0 };
        prev.count += 1;
        prev.weightSum += weight;
        studioMap.set(st, prev);
      }
    }

    if (it.animeType) {
      const tp = String(it.animeType).trim();
      if (tp && tp !== "未知") {
        const prev = typeMap.get(tp) || { name: tp, count: 0, weightSum: 0 };
        prev.count += 1;
        prev.weightSum += weight;
        typeMap.set(tp, prev);
      }
    }
  }

  const topTags = Array.from(tagMap.values())
    .sort((a, b) => b.weightSum - a.weightSum || b.count - a.count)
    .slice(0, 12);
  const topStudios = Array.from(studioMap.values())
    .sort((a, b) => b.weightSum - a.weightSum || b.count - a.count)
    .slice(0, 6);
  const topTypes = Array.from(typeMap.values())
    .sort((a, b) => b.weightSum - a.weightSum || b.count - a.count)
    .slice(0, 3);

  return {
    topTags,
    topStudios,
    topTypes,
    favTagSet: new Set(topTags.map((t) => t.name.toLowerCase())),
    favStudioList: topStudios.map((s) => s.name)
  };
}

/**
 * 评估某部新番与用户馆藏偏好的契合度
 */
function evaluateSubjectAffinity(subject, tasteProfile) {
  const hits = [];
  let score = 0;
  const subTags = Array.isArray(subject.tags) ? subject.tags : [];

  for (const t of subTags) {
    const clean = String(t || "").trim();
    if (!clean) continue;
    if (tasteProfile.favTagSet.has(clean.toLowerCase())) {
      hits.push(`#${clean}`);
      score += 2;
    } else {
      for (const favSt of tasteProfile.favStudioList) {
        if (clean.toLowerCase().includes(favSt.toLowerCase()) || favSt.toLowerCase().includes(clean.toLowerCase())) {
          hits.push(favSt);
          score += 3;
        }
      }
      for (const tp of tasteProfile.topTypes) {
        if (clean.includes(tp.name.replace("改", ""))) {
          hits.push(tp.name);
          score += 1.2;
        }
      }
    }
  }

  const uniqueHits = Array.from(new Set(hits)).slice(0, 3);
  return {
    isMatch: score >= 2 && uniqueHits.length > 0,
    score,
    hits: uniqueHits
  };
}

/**
 * 生成纪元书脊顶部的烫金纹章 SVG（按当年度馆藏部数分级呈现不同繁复度的魔导星纹）
 */
function buildSpineSigilSvg(count) {
  if (count >= 8) {
    // 盛典级双环六芒星盘纹章
    return `<svg class="curator-spine-sigil-svg" viewBox="0 0 28 28" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="11.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5"/>
      <circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" stroke-width="0.9"/>
      <polygon points="14,4.5 22,19 6,19" fill="none" stroke="currentColor" stroke-width="0.9"/>
      <polygon points="14,23.5 22,9 6,9" fill="none" stroke="currentColor" stroke-width="0.9"/>
      <circle cx="14" cy="14" r="2.2" fill="currentColor"/>
    </svg>`;
  }
  if (count >= 3) {
    // 秘仪级四芒星轨纹章
    return `<svg class="curator-spine-sigil-svg" viewBox="0 0 28 28" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="1"/>
      <path d="M14,4 L16.5,11.5 L24,14 L16.5,16.5 L14,24 L11.5,16.5 L4,14 L11.5,11.5 Z" fill="none" stroke="currentColor" stroke-width="1"/>
      <circle cx="14" cy="14" r="1.8" fill="currentColor"/>
    </svg>`;
  }
  // 雅致级单菱金箔纹章
  return `<svg class="curator-spine-sigil-svg" viewBox="0 0 28 28" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
    <polygon points="14,5 22,14 14,23 6,14" fill="none" stroke="currentColor" stroke-width="1.1"/>
    <circle cx="14" cy="14" r="2" fill="currentColor"/>
  </svg>`;
}

/**
 * 四季元素秘仪纹章 SVG
 */
function buildSeasonElementSvg(seasonCode) {
  if (seasonCode === "04") {
    // 春 · 翠风萌芽
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
    </svg>`;
  }
  if (seasonCode === "07") {
    // 夏 · 炽阳星火
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4.5"/>
      <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"/>
    </svg>`;
  }
  if (seasonCode === "10") {
    // 秋 · 金穗秘仪
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l2.6 5.4 5.9.8-4.2 4.1 1 5.8L12 16.4 6.7 19.1l1-5.8-4.2-4.1 5.9-.8L12 3z"/>
    </svg>`;
  }
  // 冬 · 凛冬水镜
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2v20M17 5l-5 5-5-5M17 19l-5-5-5 5M2 12h20M5 7l5 5-5 5M19 7l-5 5 5 5"/>
  </svg>`;
}

/**
 * 渲染重塑后的「阿斯拉王立魔导书库 · 纪元星轨展厅 & 四季元素秘仪展龛」
 * （Interactive Grimoire Gallery & Chrono-Astrolabe + Seasonal Discovery Radar）
 */
function renderYearSeasonAlmanacModule(plugin, container, items) {
  container.empty();
  container.addClass("curator-year-almanac-v2", "curator-grimoire-chrono-corridor");

  if (!items || items.length === 0) {
    container.createDiv({
      cls: "bangumi-dashboard-empty",
      text: "暂无动画记录。"
    });
    return;
  }

  if (!plugin._yearAlmanacUiState) {
    const cur = getCurrentYearAndSeason();
    plugin._yearAlmanacUiState = {
      selectedYear: null,
      activeEraFilter: "all",
      spineSortOrder: "desc",
      radarOpen: false,
      radarYear: cur.year,
      radarSeasonMonth: cur.seasonMonth,
      radarOnlyMatched: false,
      radarTagFilter: "",
      radarSearch: ""
    };
  }
  const uiState = plugin._yearAlmanacUiState;
  const totalVaultCount = items.length;
  const totalCompletedCount = items.filter((it) => it.state === "已看").length;
  const vaultCompletionPct = totalVaultCount > 0 ? Math.round((totalCompletedCount / totalVaultCount) * 100) : 0;

  // 1. 汇总全部年份与四大元素番季
  const yearMap = new Map();
  const globalSeasonCounts = {
    "04": { code: "04", label: "春 · 翠风 (04月)", shortLabel: "春之龛", icon: "🌿", count: 0, watched: 0, color: "#4c8b73" },
    "07": { code: "07", label: "夏 · 炽阳 (07月)", shortLabel: "夏之龛", icon: "☀️", count: 0, watched: 0, color: "#c87a3b" },
    "10": { code: "10", label: "秋 · 金穗 (10月)", shortLabel: "秋之龛", icon: "🍁", count: 0, watched: 0, color: "#8f683d" },
    "01": { code: "01", label: "冬 · 水镜 (01月)", shortLabel: "冬之龛", icon: "❄️", count: 0, watched: 0, color: "#3b6998" },
    "other": { code: "other", label: "未标番季", shortLabel: "卷宗余编", icon: "📜", count: 0, watched: 0, color: "#8a8278" }
  };

  for (const item of items) {
    const ym = String(item.year || "").match(/\b(19\d\d|20\d\d)\b/);
    const yKey = ym ? ym[1] : "未标年份";
    const isNum = Boolean(ym);

    if (!yearMap.has(yKey)) {
      const era = resolveEraForYear(yKey, isNum);
      yearMap.set(yKey, {
        year: yKey,
        yearNum: isNum ? Number(yKey) : -1,
        isNumeric: isNum,
        eraId: era.id,
        eraLabel: era.label,
        eraFullTitle: era.fullTitle,
        eraColor: era.color,
        spineTone: era.spineTone,
        items: [],
        completedCount: 0,
        watchingCount: 0,
        scoreSum: 0,
        scoreCount: 0,
        seasons: {
          "04": [],
          "07": [],
          "10": [],
          "01": [],
          "other": []
        }
      });
    }
    const yEntry = yearMap.get(yKey);
    yEntry.items.push(item);
    if (item.state === "已看") yEntry.completedCount += 1;
    if (item.state === "在看") yEntry.watchingCount += 1;

    const sc = item.personalScore ?? item.preciseScore ?? item.publicScore ?? item.bangumiScore;
    if (sc !== null && sc !== undefined && Number.isFinite(Number(sc))) {
      yEntry.scoreSum += Number(sc);
      yEntry.scoreCount += 1;
    }

    const sStr = String(item.season || "");
    let sKey = "other";
    if (/0?1月|冬季|冬/i.test(sStr)) sKey = "01";
    else if (/0?4月|春季|春/i.test(sStr)) sKey = "04";
    else if (/0?7月|夏季|夏/i.test(sStr)) sKey = "07";
    else if (/10月|秋季|秋/i.test(sStr)) sKey = "10";

    yEntry.seasons[sKey].push(item);
    globalSeasonCounts[sKey].count += 1;
    if (item.state === "已看") globalSeasonCounts[sKey].watched += 1;
  }

  const allYearEntries = Array.from(yearMap.values()).map((e) => {
    const count = e.items.length;
    const completionRate = count > 0 ? Math.round((e.completedCount / count) * 100) : 0;
    const avgScore = e.scoreCount > 0 ? (e.scoreSum / e.scoreCount).toFixed(1) : null;
    e.count = count;
    e.completionRate = completionRate;
    e.avgScore = avgScore;
    return e;
  });

  // 按用户选择的排序方向排列年份书脊
  const sortEntries = (list, order) => {
    return [...list].sort((a, b) => {
      if (!a.isNumeric && !b.isNumeric) return 0;
      if (!a.isNumeric) return 1;
      if (!b.isNumeric) return -1;
      return order === "asc" ? a.yearNum - b.yearNum : b.yearNum - a.yearNum;
    });
  };

  const sortedAllYears = sortEntries(allYearEntries, uiState.spineSortOrder || "desc");
  const numericYearsCount = sortedAllYears.filter((e) => e.isNumeric).length;
  const maxYearCount = Math.max(1, ...sortedAllYears.map((e) => e.count));

  // 确保存在合法的当前选中年份（默认选中最新或馆藏最丰厚的年份）
  if (!uiState.selectedYear || !yearMap.has(uiState.selectedYear)) {
    const bestDefault =
      sortedAllYears.find((e) => e.isNumeric && e.count >= Math.max(1, Math.floor(maxYearCount * 0.5))) ||
      sortedAllYears[0];
    uiState.selectedYear = bestDefault ? bestDefault.year : null;
  }

  // ==================== 顶部魔导书库导览条 ====================
  const topToolbar = container.createDiv("curator-year-v2-toolbar curator-grimoire-almanac-toolbar");
  const topLeft = topToolbar.createDiv("curator-year-v2-toolbar-left");
  topLeft.createSpan({
    cls: "curator-grimoire-corridor-kicker",
    text: "✦ 阿斯拉王立魔导书库 · 纪元星轨展厅"
  });
  topLeft.createSpan({
    cls: "curator-year-v2-subtitle",
    text: `所有收藏 ${totalVaultCount} 部动画 · 铭刻 ${numericYearsCount} 册纪元魔导书 · 已修毕 ${totalCompletedCount} 部（完结共鸣 ${vaultCompletionPct}%）`
  });

  const topRight = topToolbar.createDiv("curator-year-v2-toolbar-right");

  const orderBtn = topRight.createEl("button", {
    cls: "curator-dl-mini-btn curator-grimoire-order-btn",
    text: uiState.spineSortOrder === "asc" ? "⇅ 编年演进 (旧→新)" : "⇅ 近世优先 (新→旧)"
  });
  orderBtn.title = "切换魔导书架陈列顺序（从远古至当代 / 从当代至远古）";
  orderBtn.onclick = (e) => {
    e.preventDefault();
    uiState.spineSortOrder = uiState.spineSortOrder === "asc" ? "desc" : "asc";
    renderYearSeasonAlmanacModule(plugin, container, items);
  };

  const radarToggleBtn = topRight.createEl("button", {
    cls: `curator-year-radar-toggle-btn ${uiState.radarOpen ? "is-active" : ""}`,
    text: uiState.radarOpen ? "🔭 收起新番排期雷达 ▲" : "🔭 新番排期雷达 ▼"
  });
  radarToggleBtn.title = "打开新番排期雷达，查看当季与未来季度已确定开播的新番资讯，并根据您的馆藏偏好智能标记契合作品";
  radarToggleBtn.onclick = (e) => {
    e.preventDefault();
    uiState.radarOpen = !uiState.radarOpen;
    renderYearSeasonAlmanacModule(plugin, container, items);
  };

  // ==================== 新番排期资讯与喜好寻番雷达抽屉 ====================
  if (uiState.radarOpen) {
    renderSeasonalDiscoveryRadarDrawer(plugin, container, items, uiState, () => {
      renderYearSeasonAlmanacModule(plugin, container, items);
    });
  }

  // ==================== 纪元展区切换栏（五大魔导纪元 + 四季元素共鸣摘要） ====================
  const eraHeaderBar = container.createDiv("curator-grimoire-era-bar");
  const eraTabsGroup = eraHeaderBar.createDiv("curator-grimoire-era-tabs");

  const eraCountsMap = new Map();
  GRIMOIRE_ERAS.forEach((era) => eraCountsMap.set(era.id, { works: 0, years: [] }));
  sortedAllYears.forEach((entry) => {
    const bucket = eraCountsMap.get(entry.eraId);
    if (bucket) {
      bucket.works += entry.count;
      bucket.years.push(entry);
    }
  });

  const allEraBtn = eraTabsGroup.createEl("button", {
    cls: `curator-grimoire-era-tab ${uiState.activeEraFilter === "all" ? "is-active" : ""}`
  });
  allEraBtn.createSpan({ cls: "curator-era-tab-title", text: "✦ 全纪元星轨回廊" });
  allEraBtn.createSpan({ cls: "curator-era-tab-count curator-mono", text: `${totalVaultCount}部` });
  allEraBtn.onclick = (e) => {
    e.preventDefault();
    if (uiState.activeEraFilter === "all") return;
    uiState.activeEraFilter = "all";
    renderYearSeasonAlmanacModule(plugin, container, items);
  };

  GRIMOIRE_ERAS.forEach((era) => {
    const bucket = eraCountsMap.get(era.id);
    if (!bucket || bucket.years.length === 0) return;
    const isAct = uiState.activeEraFilter === era.id;
    const tabBtn = eraTabsGroup.createEl("button", {
      cls: `curator-grimoire-era-tab ${isAct ? "is-active" : ""}`
    });
    tabBtn.dataset.eraId = era.id;
    const dot = tabBtn.createSpan("curator-era-tab-dot");
    dot.style.backgroundColor = era.color;
    tabBtn.createSpan({ cls: "curator-era-tab-title", text: `${era.label} · ${era.subLabel}` });
    tabBtn.createSpan({ cls: "curator-era-tab-count curator-mono", text: `${bucket.works}部` });
    tabBtn.onclick = (e) => {
      e.preventDefault();
      uiState.activeEraFilter = uiState.activeEraFilter === era.id ? "all" : era.id;
      if (uiState.activeEraFilter !== "all" && !bucket.years.some((y) => y.year === uiState.selectedYear)) {
        uiState.selectedYear = bucket.years[0].year;
      }
      renderYearSeasonAlmanacModule(plugin, container, items);
    };
  });

  // 右侧：所有收藏四季元素总览铭牌
  const globalSeasonStrip = eraHeaderBar.createDiv("curator-grimoire-global-seasons");
  ["04", "07", "10", "01"].forEach((sCode) => {
    const info = globalSeasonCounts[sCode];
    const pct = totalVaultCount > 0 ? Math.round((info.count / totalVaultCount) * 100) : 0;
    const pill = globalSeasonStrip.createDiv("curator-global-season-pill");
    pill.title = `${info.label}累计收录 ${info.count} 部（占所有收藏 ${pct}%，已看完结 ${info.watched} 部）`;
    const dot = pill.createSpan("curator-global-season-dot");
    dot.style.backgroundColor = info.color;
    pill.createSpan({ cls: "curator-global-season-name", text: info.shortLabel });
    pill.createSpan({ cls: "curator-global-season-val curator-mono", text: `${info.count}部 (${pct}%)` });
  });

  // 过滤当前展区显示的年份书脊
  const visibleYearEntries =
    uiState.activeEraFilter === "all"
      ? sortedAllYears
      : sortedAllYears.filter((e) => e.eraId === uiState.activeEraFilter);

  if (visibleYearEntries.length > 0 && !visibleYearEntries.some((e) => e.year === uiState.selectedYear)) {
    uiState.selectedYear = visibleYearEntries[0].year;
  }

  // ==================== 上半区舞台：「编年魔导书架与纪元星轨（Grimoire Spine Gallery）」 ====================
  const spineStage = container.createDiv("curator-grimoire-spine-stage");

  // 背景古星象轨迹连线 SVG（根据当前陈列的年份书脊动态绘制起伏星轨）
  const astrolabeBg = spineStage.createDiv("curator-grimoire-astrolabe-bg");
  const svgW = 1200;
  const svgH = 220;
  const pointCount = visibleYearEntries.length;
  const starCoords = visibleYearEntries.map((entry, idx) => {
    const x =
      pointCount === 1
        ? svgW / 2
        : Math.round(68 + (idx / Math.max(1, pointCount - 1)) * (svgW - 136));
    const ratio = entry.count / maxYearCount;
    const y = Math.round(162 - ratio * 108);
    return { x, y, entry };
  });

  let constellationPathD = "";
  for (let i = 0; i < starCoords.length; i++) {
    const pt = starCoords[i];
    if (i === 0) {
      constellationPathD += `M ${pt.x},${pt.y}`;
    } else {
      const prev = starCoords[i - 1];
      const midX = ((prev.x + pt.x) / 2).toFixed(1);
      constellationPathD += ` C ${midX},${prev.y} ${midX},${pt.y} ${pt.x},${pt.y}`;
    }
  }

  const starNodesSvg = starCoords
    .map((pt) => {
      const r = (2.2 + (pt.entry.count / maxYearCount) * 2.6).toFixed(1);
      return `<circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="#59a5e8" fill-opacity="0.55" stroke="#f7e6c4" stroke-width="0.9"/>`;
    })
    .join("");

  astrolabeBg.innerHTML = `<svg class="curator-grimoire-astrolabe-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grimoireConstellationStroke" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#3b6998" stop-opacity="0.22"/>
        <stop offset="50%" stop-color="#d9a74a" stop-opacity="0.52"/>
        <stop offset="100%" stop-color="#4c8b73" stop-opacity="0.28"/>
      </linearGradient>
      <radialGradient id="grimoireAstrolabeCore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#3b6998" stop-opacity="0.14"/>
        <stop offset="65%" stop-color="#8f683d" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#8f683d" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="180" cy="110" r="140" fill="url(#grimoireAstrolabeCore)"/>
    <circle cx="180" cy="110" r="96" fill="none" stroke="#8f683d" stroke-opacity="0.14" stroke-width="1" stroke-dasharray="5 4"/>
    <circle cx="1020" cy="110" r="110" fill="none" stroke="#3b6998" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="3 5"/>
    <line x1="24" y1="186" x2="1176" y2="186" stroke="#8f683d" stroke-opacity="0.24" stroke-width="1"/>
    ${constellationPathD ? `<path d="${constellationPathD}" fill="none" stroke="url(#grimoireConstellationStroke)" stroke-width="2" stroke-dasharray="6 4"/>` : ""}
    ${starNodesSvg}
  </svg>`;

  const shelfHeader = spineStage.createDiv("curator-grimoire-shelf-header");
  shelfHeader.createSpan({
    cls: "curator-grimoire-shelf-title",
    text: "📚 编年魔导书脊陈列架 · 点击任意年份魔导书展开下方「四季元素秘仪展龛」"
  });
  const shelfLegend = shelfHeader.createDiv("curator-grimoire-shelf-legend");
  shelfLegend.innerHTML =
    `<span class="curator-spine-leg-item"><i class="curator-spine-leg-orb"></i>水系辉光：当年完结率</span>` +
    `<span class="curator-spine-leg-item"><i class="curator-spine-leg-gold"></i>金系辉光：当年收藏数</span>`;

  // 显式纵轴 + 手绘虚线纪元分舱 + 横轴坐标标尺容器
  const shelfBody = spineStage.createDiv("curator-grimoire-shelf-body");
  const yAxisCol = shelfBody.createDiv("curator-grimoire-y-axis");
  yAxisCol.createDiv({
    cls: "curator-grimoire-axis-y-title",
    text: "纵轴：当年收藏(部)"
  });
  const yTicks = yAxisCol.createDiv("curator-grimoire-y-ticks curator-mono");
  const midYearCount = Math.max(1, Math.round(maxYearCount / 2));
  yTicks.createSpan({ cls: "curator-grimoire-y-tick is-max", text: `${maxYearCount}部` });
  yTicks.createSpan({ cls: "curator-grimoire-y-tick is-mid", text: `${midYearCount}部` });
  yTicks.createSpan({ cls: "curator-grimoire-y-tick is-zero", text: "0部" });

  const shelfScrollWrap = shelfBody.createDiv("curator-grimoire-shelf-scroll-wrap");
  const shelfScroll = shelfScrollWrap.createDiv("curator-grimoire-shelf-scroll");
  const gridLines = shelfScroll.createDiv("curator-grimoire-grid-lines");
  gridLines.createDiv("curator-grimoire-grid-line is-top");
  gridLines.createDiv("curator-grimoire-grid-line is-mid");
  gridLines.createDiv("curator-grimoire-grid-line is-bottom");

  const spinesRow = shelfScroll.createDiv("curator-grimoire-spines-row");
  const xAxisBar = shelfScrollWrap.createDiv("curator-grimoire-x-axis");
  xAxisBar.createSpan({
    cls: "curator-grimoire-axis-x-title",
    text: "横轴：开播年份（按纪元分舱陈列 · 点击书脊切换下方四季展龛）"
  });

  // ==================== 下半区展台容器引用（支持无闪烁丝滑切换） ====================
  const alcovesStageHost = container.createDiv("curator-grimoire-alcoves-stage-host");

  // 书脊点击联动函数（带青金魔力涟漪、书脊微幅拔高与四季展厅 FLIP + 错峰浮现过渡）
  const selectYearWithMagicTransition = (targetYearKey) => {
    if (!yearMap.has(targetYearKey)) return;
    const prevYearKey = uiState.selectedYear;
    uiState.selectedYear = targetYearKey;

    // 1. 原地更新所有魔导书脊的选中态与青金魔力涟漪
    spinesRow.querySelectorAll(".curator-grimoire-spine").forEach((spEl) => {
      const isMatch = spEl.dataset.year === targetYearKey;
      spEl.classList.toggle("is-selected", isMatch);
      spEl.classList.remove("is-mana-rippling");
      if (isMatch && prevYearKey !== targetYearKey) {
        void spEl.offsetWidth;
        spEl.classList.add("is-mana-rippling");
      }
    });

    // 2. 若选中的是动态年份，后台静默校准一次当季定档数
    const selEntry = yearMap.get(targetYearKey);
    if (selEntry && selEntry.isNumeric && isDynamicYearOrSeason(selEntry.year, null)) {
      const cur = getCurrentYearAndSeason();
      fetchSeasonalAnimeFromBangumi(plugin, selEntry.year, cur.seasonMonth).then(() => {
        if (alcovesStageHost.isConnected && uiState.selectedYear === targetYearKey) {
          renderAlcovesStageContent(selEntry, false);
        }
      });
    }

    // 3. 触发四季元素秘仪展龛的卷轴展开与 FLIP 错峰过渡
    if (selEntry) {
      renderAlcovesStageContent(selEntry, prevYearKey !== targetYearKey);
    }
  };

  // 将可见年份按所属纪元分组，构建手绘虚线纪元分舱框（.curator-grimoire-era-group）
  const eraGroups = [];
  visibleYearEntries.forEach((entry) => {
    const lastGroup = eraGroups[eraGroups.length - 1];
    if (!lastGroup || lastGroup.eraId !== entry.eraId) {
      const eraMeta = GRIMOIRE_ERAS.find((e) => e.id === entry.eraId) || {
        id: entry.eraId,
        label: entry.eraLabel,
        subLabel: "",
        fullTitle: entry.eraFullTitle,
        color: entry.eraColor
      };
      eraGroups.push({
        eraId: entry.eraId,
        eraMeta,
        entries: [entry]
      });
    } else {
      lastGroup.entries.push(entry);
    }
  });

  let globalSpineIdx = 0;
  eraGroups.forEach((group) => {
    const groupBox = spinesRow.createDiv("curator-grimoire-era-group");
    groupBox.dataset.eraId = group.eraId;
    groupBox.style.setProperty("--era-group-color", group.eraMeta.color || "#8f683d");

    const tagText = group.eraMeta.subLabel
      ? `${group.eraMeta.label} · ${group.eraMeta.subLabel}`
      : group.eraMeta.label;
    const groupTag = groupBox.createDiv("curator-grimoire-era-group-tag");
    const tagDot = groupTag.createSpan("curator-era-group-tag-dot");
    tagDot.style.backgroundColor = group.eraMeta.color || "#8f683d";
    groupTag.createSpan({
      cls: "curator-era-group-tag-text",
      text: tagText
    });

    const groupSpinesWrap = groupBox.createDiv("curator-grimoire-era-group-spines");

    group.entries.forEach((entry) => {
      const idx = globalSpineIdx++;
      const isSelected = uiState.selectedYear === entry.year;
      const ratio = entry.count / maxYearCount;
      const spineHeight = Math.round(122 + ratio * 64); // 122px ~ 186px 错落有致
      const sharePct = ((entry.count / totalVaultCount) * 100).toFixed(1);
      const manaAlpha = (0.28 + (entry.completionRate / 100) * 0.68).toFixed(2);

      const spineBtn = groupSpinesWrap.createEl("button", {
        cls: `curator-grimoire-spine ${entry.spineTone} ${isSelected ? "is-selected" : ""}`
      });
      spineBtn.dataset.year = entry.year;
      spineBtn.style.height = `${spineHeight}px`;
      spineBtn.style.setProperty("--spine-idx", String(idx));
      spineBtn.style.setProperty("--spine-mana-alpha", manaAlpha);
      spineBtn.style.setProperty("--spine-era-color", entry.eraColor);
      spineBtn.title =
        `${entry.year}${entry.isNumeric ? "年" : ""}（${entry.eraFullTitle}）\n` +
        `· 当年收藏：${entry.count} 部（占所有收藏 ${sharePct}%）\n` +
        `· 已看完结：${entry.completedCount} 部（完结率 ${entry.completionRate}%）` +
        (entry.avgScore ? `\n· 当年均分：★ ${entry.avgScore}` : "");

      // 1. 书脊顶部悬浮水系魔力辉光球
      const manaOrb = spineBtn.createDiv("curator-spine-mana-orb");
      manaOrb.createSpan({
        cls: "curator-spine-orb-text curator-mono",
        text: `${entry.completionRate}%`
      });

      // 2. 书脊烫金纹章
      const sigilBox = spineBtn.createDiv("curator-spine-sigil");
      sigilBox.innerHTML = buildSpineSigilSvg(entry.count);

      // 3. 年份铭文
      spineBtn.createDiv({
        cls: "curator-spine-year curator-mono",
        text: entry.isNumeric ? entry.year : "未标"
      });

      // 4. 书脊内部双轨液态魔力柱（金轨：当年收藏数；青轨：当年完结率）
      const dualMana = spineBtn.createDiv("curator-spine-dual-mana");
      const goldTrack = dualMana.createDiv("curator-spine-mana-col");
      const goldFill = goldTrack.createDiv("curator-spine-mana-fill is-gold");
      goldFill.style.height = `${Math.max(14, Math.round(ratio * 100))}%`;

      const aquaTrack = dualMana.createDiv("curator-spine-mana-col");
      const aquaFill = aquaTrack.createDiv("curator-spine-mana-fill is-aqua");
      aquaFill.style.height = `${Math.max(12, entry.completionRate)}%`;

      // 5. 书脊底部部数印记
      spineBtn.createDiv({
        cls: "curator-spine-count curator-mono",
        text: `${entry.count}部`
      });

      // 青金魔力涟漪层
      spineBtn.createDiv("curator-spine-ripple-ring");

      spineBtn.onclick = (e) => {
        e.preventDefault();
        selectYearWithMagicTransition(entry.year);
      };
    });
  });

  // ==================== 下半区舞台：「四季元素秘仪展龛（Four-Season Elemental Alcoves）」 ====================
  function renderAlcovesStageContent(selEntry, animateTransition = false) {
    // 采集旧展龛位置用于 FLIP 平滑过渡
    const prevAlcoveRects = new Map();
    if (animateTransition) {
      alcovesStageHost.querySelectorAll(".curator-elemental-alcove[data-season-code]").forEach((el) => {
        prevAlcoveRects.set(el.dataset.seasonCode, el.getBoundingClientRect());
      });
    }

    alcovesStageHost.empty();
    const stageWrap = alcovesStageHost.createDiv(
      `curator-grimoire-alcoves-stage ${animateTransition ? "is-scroll-unfurling" : ""}`
    );

    const yearSharePct = ((selEntry.count / totalVaultCount) * 100).toFixed(1);
    const totInfo = selEntry.isNumeric
      ? getTotalAnimeCountForYearOrSeason(plugin, selEntry.year, null)
      : { total: null, isDynamic: false };
    const yearTotal = totInfo.total;
    const yearCovPct = yearTotal ? ((selEntry.count / yearTotal) * 100).toFixed(1) : null;

    const covBannerText = !selEntry.isNumeric
      ? "待补充开播年份信息"
      : totInfo.isDynamic
      ? `${selEntry.year}年目前已确定 ${yearTotal} 部 · 涉猎率 ${yearCovPct}%`
      : `${selEntry.year}年全网共收录 ${yearTotal} 部 · 涉猎率 ${yearCovPct}%`;

    // 1. 展厅顶栏：当前选中纪元魔导书卷头铭牌 + 前后翻卷导航
    const stageBanner = stageWrap.createDiv("curator-alcoves-banner");
    const bannerLeft = stageBanner.createDiv("curator-alcoves-banner-left");
    const tomeBadge = bannerLeft.createSpan({
      cls: "curator-alcoves-era-badge",
      text: selEntry.eraFullTitle
    });
    tomeBadge.style.borderColor = selEntry.eraColor;

    const titleLine = bannerLeft.createDiv("curator-alcoves-title-line");
    titleLine.createSpan({
      cls: "curator-alcoves-main-title",
      text: selEntry.isNumeric
        ? `📖 《${selEntry.year} 纪元魔导典籍 · 四季元素秘仪展龛》`
        : `📖 《${selEntry.year} 馆藏卷宗 · 四季元素秘仪展龛》`
    });

    const telemetryRow = bannerLeft.createDiv("curator-alcoves-telemetry-row curator-mono");
    telemetryRow.createSpan({
      cls: "curator-alcove-tele-pill is-gold",
      text: `当年收藏 ${selEntry.count} 部（占所有收藏 ${yearSharePct}%）`
    });
    telemetryRow.createSpan({
      cls: "curator-alcove-tele-pill is-aqua",
      text: `已看完结 ${selEntry.completedCount}/${selEntry.count} 部（完结率 ${selEntry.completionRate}%）`
    });
    telemetryRow.createSpan({
      cls: "curator-alcove-tele-pill",
      text: covBannerText
    });

    const bannerRight = stageBanner.createDiv("curator-alcoves-banner-right");
    const curIdx = visibleYearEntries.findIndex((e) => e.year === selEntry.year);
    const prevBtn = bannerRight.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "◂ 上一卷"
    });
    prevBtn.disabled = curIdx <= 0;
    prevBtn.onclick = (e) => {
      e.preventDefault();
      if (curIdx > 0) {
        selectYearWithMagicTransition(visibleYearEntries[curIdx - 1].year);
      }
    };

    const nextBtn = bannerRight.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "下一卷 ▸"
    });
    nextBtn.disabled = curIdx < 0 || curIdx >= visibleYearEntries.length - 1;
    nextBtn.onclick = (e) => {
      e.preventDefault();
      if (curIdx >= 0 && curIdx < visibleYearEntries.length - 1) {
        selectYearWithMagicTransition(visibleYearEntries[curIdx + 1].year);
      }
    };

    if (selEntry.isNumeric) {
      const jumpRadarBtn = bannerRight.createEl("button", {
        cls: "curator-dl-mini-btn is-accent",
        text: `🔭 新番排期雷达 (${selEntry.year})`
      });
      jumpRadarBtn.onclick = (e) => {
        e.preventDefault();
        uiState.radarOpen = true;
        uiState.radarYear = Number(selEntry.year);
        renderYearSeasonAlmanacModule(plugin, container, items);
      };
    }

    // 2. 四季元素秘仪展龛并列舞台（春 · 夏 · 秋 · 冬）
    const alcovesGrid = stageWrap.createDiv("curator-alcoves-grid");
    const seasonDefs = [
      {
        code: "04",
        key: "spring",
        title: "春之龛 · 翠风萌芽",
        sub: "04月 春季番",
        elementTag: "风木秘仪",
        accent: "#4c8b73"
      },
      {
        code: "07",
        key: "summer",
        title: "夏之龛 · 炽阳星火",
        sub: "07月 夏季番",
        elementTag: "曜火秘仪",
        accent: "#c87a3b"
      },
      {
        code: "10",
        key: "autumn",
        title: "秋之龛 · 金穗秘仪",
        sub: "10月 秋季番",
        elementTag: "金穗秘仪",
        accent: "#8f683d"
      },
      {
        code: "01",
        key: "winter",
        title: "冬之龛 · 凛冬水镜",
        sub: "01月 冬季番",
        elementTag: "水镜秘仪",
        accent: "#3b6998"
      }
    ];

    seasonDefs.forEach((sd, sIdx) => {
      const sItems = selEntry.seasons[sd.code] || [];
      const sCount = sItems.length;
      const sWatched = sItems.filter((it) => it.state === "已看").length;
      const sVaultShareNum = totalVaultCount > 0 ? (sCount / totalVaultCount) * 100 : 0;
      const sYearShareNum = selEntry.count > 0 ? (sCount / selEntry.count) * 100 : 0;
      const sWatchedPctNum = sCount > 0 ? (sWatched / sCount) * 100 : 0;

      const sTotInfo = selEntry.isNumeric
        ? getTotalAnimeCountForYearOrSeason(plugin, selEntry.year, sd.code)
        : { total: null, isDynamic: false };
      const sTotal = sTotInfo.total;
      const sCovPctNum = sTotal && sTotal > 0 ? (sCount / sTotal) * 100 : 0;
      const sCovStr = sTotal && sTotal > 0 ? `${sCovPctNum.toFixed(1)}%` : "0.0%";

      const alcove = alcovesGrid.createDiv(
        `curator-elemental-alcove is-season-${sd.key} ${sCount === 0 ? "is-empty-alcove" : "has-works"}`
      );
      alcove.dataset.seasonCode = sd.code;
      alcove.style.setProperty("--alcove-idx", String(sIdx));
      alcove.style.setProperty("--alcove-accent", sd.accent);

      // 展龛拱顶头部
      const alcoveHead = alcove.createDiv("curator-alcove-head");
      const iconBox = alcoveHead.createDiv("curator-alcove-icon");
      iconBox.innerHTML = buildSeasonElementSvg(sd.code);

      const titleCol = alcoveHead.createDiv("curator-alcove-title-col");
      titleCol.createDiv({ cls: "curator-alcove-element-kicker", text: sd.elementTag });
      titleCol.createDiv({ cls: "curator-alcove-title", text: sd.title });
      titleCol.createDiv({ cls: "curator-alcove-sub", text: sd.sub });

      alcoveHead.createSpan({
        cls: "curator-alcove-count-badge curator-mono",
        text: `${sCount} 部`
      });

      // 展龛四柱魔力槽（馆藏共鸣双横柱组：当年收藏 + 所有收藏；已看进度独立柱；当季涉猎独立柱）
      const resonanceBox = alcove.createDiv("curator-alcove-resonance");

      // 组 1：馆藏共鸣（双横柱组：当年收藏 vs 所有收藏）
      const dualGroup = resonanceBox.createDiv("curator-alcove-resonance-group is-dual-group");
      dualGroup.createDiv({
        cls: "curator-alcove-group-header",
        text: "馆藏共鸣"
      });

      // 子横柱 1A：当年收藏
      const subRowYear = dualGroup.createDiv("curator-alcove-subbar-row");
      const labelRowYear = subRowYear.createDiv("curator-alcove-track-labelrow curator-mono");
      labelRowYear.createSpan({ text: "当年收藏" });
      labelRowYear.createSpan({ text: `${sYearShareNum.toFixed(0)}%` });
      const barTrackYear = subRowYear.createDiv("curator-alcove-mana-track is-track-a is-year-share");
      const barFillYear = barTrackYear.createDiv("curator-alcove-mana-fill is-track-a is-year-share");
      const targetWidthYear = `${sCount > 0 ? Math.max(8, sYearShareNum).toFixed(1) : 0}%`;
      barFillYear.style.width = animateTransition ? "0%" : targetWidthYear;
      barFillYear.dataset.targetWidth = targetWidthYear;

      // 子横柱 1B：所有收藏
      const subRowVault = dualGroup.createDiv("curator-alcove-subbar-row");
      const labelRowVault = subRowVault.createDiv("curator-alcove-track-labelrow curator-mono");
      labelRowVault.createSpan({ text: "所有收藏" });
      labelRowVault.createSpan({ text: `${sVaultShareNum.toFixed(1)}%` });
      const barTrackVault = subRowVault.createDiv("curator-alcove-mana-track is-track-vault");
      const barFillVault = barTrackVault.createDiv("curator-alcove-mana-fill is-track-vault");
      const targetWidthVault = `${sCount > 0 ? Math.max(6, sVaultShareNum).toFixed(1) : 0}%`;
      barFillVault.style.width = animateTransition ? "0%" : targetWidthVault;
      barFillVault.dataset.targetWidth = targetWidthVault;

      // 组 2：已看进度（独立横柱，不再混排当季涉猎）
      const trackGroupB = resonanceBox.createDiv("curator-alcove-track-group");
      const labelRowB = trackGroupB.createDiv("curator-alcove-track-labelrow curator-mono");
      labelRowB.createSpan({ text: `已看 ${sWatched}/${sCount} 部` });
      labelRowB.createSpan({ text: `完结 ${sWatchedPctNum.toFixed(0)}%` });
      const barTrackB = trackGroupB.createDiv("curator-alcove-mana-track is-track-b");
      const barFillB = barTrackB.createDiv("curator-alcove-mana-fill is-track-b");
      const targetWidthB = `${sCount > 0 ? Math.max(8, sWatchedPctNum).toFixed(1) : 0}%`;
      barFillB.style.width = animateTransition ? "0%" : targetWidthB;
      barFillB.dataset.targetWidth = targetWidthB;

      // 组 3：当季涉猎（独立成柱）
      const trackGroupC = resonanceBox.createDiv("curator-alcove-track-group");
      const labelRowC = trackGroupC.createDiv("curator-alcove-track-labelrow curator-mono");
      labelRowC.createSpan({ text: "当季涉猎" });
      labelRowC.createSpan({
        text: sTotal ? `${sCount} / 全网 ${sTotal} 部 (${sCovStr})` : `${sCount} 部 (全网基数待同步)`
      });
      const barTrackC = trackGroupC.createDiv("curator-alcove-mana-track is-track-c");
      const barFillC = barTrackC.createDiv("curator-alcove-mana-fill is-track-c");
      const targetWidthC = `${sCount > 0 && sTotal ? Math.max(6, Math.min(100, sCovPctNum)).toFixed(1) : 0}%`;
      barFillC.style.width = animateTransition ? "0%" : targetWidthC;
      barFillC.dataset.targetWidth = targetWidthC;

      // 展龛内藏番剧微缩原画铭牌陈列区
      const plaquesWrap = alcove.createDiv("curator-alcove-plaques-list");
      if (sCount === 0) {
        const emptyBox = plaquesWrap.createDiv("curator-alcove-empty");
        emptyBox.createSpan({
          cls: "curator-alcove-empty-text",
          text: "此番季展龛尚无馆藏铭牌"
        });
        if (selEntry.isNumeric) {
          const exploreBtn = emptyBox.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: `🔭 寻访 ${selEntry.year}年${sd.code}月 新番`
          });
          exploreBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            uiState.radarOpen = true;
            uiState.radarYear = Number(selEntry.year);
            uiState.radarSeasonMonth = sd.code;
            renderYearSeasonAlmanacModule(plugin, container, items);
          };
        }
      } else {
        const sortedWorks = [...sItems].sort((a, b) => {
          const sa = a.personalScore ?? a.preciseScore ?? a.publicScore ?? a.bangumiScore ?? -1;
          const sb = b.personalScore ?? b.preciseScore ?? b.publicScore ?? b.bangumiScore ?? -1;
          return sb - sa || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
        });

        sortedWorks.forEach((wk, pIdx) => {
          const plaque = plaquesWrap.createDiv("curator-alcove-work-plaque");
          plaque.style.setProperty("--plaque-idx", String(pIdx));
          plaque.title = `点击打开《${wk.name}》动画笔记（状态：${wk.state || "未设置"}）`;

          const localCov = resolveLocalCoverForSubject(plugin, wk.subjectId, wk);
          if (localCov.hasLocal && localCov.resourceUrl) {
            const thumbBox = plaque.createDiv("curator-plaque-thumb");
            const img = thumbBox.createEl("img", {
              attr: { src: localCov.resourceUrl, alt: wk.name }
            });
            img.src = localCov.resourceUrl;
            img.alt = wk.name;
            img.loading = "lazy";
            img.onerror = () => {
              thumbBox.remove();
            };
          } else {
            plaque.createSpan({
              cls: `curator-tree-state-dot is-${wk.state || "未设置"}`,
              title: wk.state || "未设置"
            });
          }

          const infoCol = plaque.createDiv("curator-plaque-info");
          infoCol.createSpan({
            cls: "curator-plaque-title",
            text: wk.name
          });

          const scText =
            wk.personalScore !== null
              ? `★${wk.personalScore.toFixed(1)}`
              : wk.preciseScore !== null
              ? `BGM ${wk.preciseScore.toFixed(1)}`
              : wk.publicScore !== null
              ? `BGM ${wk.publicScore.toFixed(1)}`
              : wk.state || "";
          if (scText) {
            plaque.createSpan({
              cls: `curator-plaque-score curator-mono ${wk.personalScore !== null ? "is-personal" : ""}`,
              text: scText
            });
          }

          plaque.onclick = async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (wk.file) {
              const leaf = plugin.app.workspace.getLeaf(true);
              await leaf.openFile(wk.file);
            }
          };
        });
      }
    });

    // 3. 若该年份存在未标注具体番季的作品，在四龛下方陈列「未标番季卷宗托盘」
    const otherWorks = selEntry.seasons.other || [];
    if (otherWorks.length > 0) {
      const otherTray = stageWrap.createDiv("curator-alcoves-other-tray");
      otherTray.createSpan({
        cls: "curator-alcoves-other-label",
        text: `📜 当年未标具体番季卷宗（${otherWorks.length} 部）：`
      });
      const otherList = otherTray.createDiv("curator-alcoves-other-list");
      otherWorks.forEach((wk) => {
        const chip = otherList.createEl("button", {
          cls: "curator-alcove-other-chip",
          text: wk.name
        });
        chip.title = `点击打开《${wk.name}》动画笔记`;
        chip.onclick = async (ev) => {
          ev.preventDefault();
          if (wk.file) {
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(wk.file);
          }
        };
      });
    }

    // 4. 触发液态魔力槽动画与 FLIP 位移过渡
    if (animateTransition && typeof requestAnimationFrame === "function") {
      const newAlcoves = Array.from(stageWrap.querySelectorAll(".curator-elemental-alcove[data-season-code]"));
      newAlcoves.forEach((el, idx) => {
        const prev = prevAlcoveRects.get(el.dataset.seasonCode);
        const next = el.getBoundingClientRect();
        const dx = prev ? Math.max(-24, Math.min(24, prev.left - next.left)) : 0;
        const dy = prev ? Math.max(-18, Math.min(18, prev.top - next.top)) : 12 + idx * 4;
        el.style.transition = "none";
        el.style.opacity = "0.28";
        el.style.transform = `translate3d(${dx}px, ${dy || 10 + idx * 3}px, 0) scale(0.985)`;
      });

      void stageWrap.offsetHeight;

      requestAnimationFrame(() => {
        newAlcoves.forEach((el, idx) => {
          const delayMs = idx * 48;
          el.style.transition = `transform 420ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms, opacity 340ms ease ${delayMs}ms`;
          el.style.opacity = "1";
          el.style.transform = "translate3d(0, 0, 0) scale(1)";
        });

        stageWrap.querySelectorAll(".curator-alcove-mana-fill[data-target-width]").forEach((bar) => {
          bar.style.width = bar.dataset.targetWidth || "0%";
        });

        setTimeout(() => {
          newAlcoves.forEach((el) => {
            if (!el.isConnected) return;
            el.style.transition = "";
            el.style.transform = "";
            el.style.opacity = "";
          });
        }, 560);
      });
    }
  }

  const initialEntry =
    yearMap.get(uiState.selectedYear) || visibleYearEntries[0] || sortedAllYears[0];
  if (initialEntry) {
    renderAlcovesStageContent(initialEntry, false);
  }
}

/**
 * 渲染「🔭 新番排期资讯与喜好寻番雷达」内嵌面板
 * - 优先检查并复用本地封面附件（附件/Bangumi Images/bangumi-cover-{id}.jpg）
 * - 无本地封面时彻底隐藏空白封面占位框，呈现紧凑纯文本卡片
 * - 支持顶栏一键批量下载本季封面到本地 & 单卡按需缓存封面
 */
function renderSeasonalDiscoveryRadarDrawer(plugin, parentContainer, items, uiState, onRerender) {
  const drawer = parentContainer.createDiv("curator-seasonal-radar-drawer");
  const cur = getCurrentYearAndSeason();
  const tasteProfile = computeUserTasteProfile(items);

  const seasonOptions = [];
  const stepSeason = (y, sm, offset) => {
    const months = ["01", "04", "07", "10"];
    let idx = months.indexOf(sm);
    if (idx < 0) idx = 3;
    const totalQ = y * 4 + idx + offset;
    const nextY = Math.floor(totalQ / 4);
    const nextM = months[((totalQ % 4) + 4) % 4];
    return { year: nextY, seasonMonth: nextM };
  };

  for (let offset = -2; offset <= 3; offset++) {
    const target = stepSeason(cur.year, cur.seasonMonth, offset);
    const tag =
      offset === 0
        ? "当季热播"
        : offset > 0
        ? "未来排期"
        : "近期番季";
    seasonOptions.push({
      year: target.year,
      seasonMonth: target.seasonMonth,
      label: `${target.year}年${target.seasonMonth}月`,
      badge: tag
    });
  }

  // 1. 顶栏双栏卡片：左侧主标题「🔭 新番排期雷达」+ 当前季度收录状态胶囊；右侧紧凑偏好画像徽章组
  const headRow = drawer.createDiv("curator-radar-header");
  const headTitleCol = headRow.createDiv("curator-radar-title-col");
  const titleMainLine = headTitleCol.createDiv("curator-radar-title-mainline");
  titleMainLine.createSpan({
    cls: "curator-radar-main-title",
    text: "🔭 新番排期雷达"
  });
  const archivePill = titleMainLine.createSpan({
    cls: "curator-radar-archive-pill curator-mono",
    text: `${uiState.radarYear}年${uiState.radarSeasonMonth}月 · 正在同步排期…`
  });

  const headTasteCol = headRow.createDiv("curator-radar-taste-col");
  headTasteCol.createSpan({
    cls: "curator-radar-taste-label",
    text: "✦ 馆藏偏好画像"
  });
  const tasteChipsWrap = headTasteCol.createDiv("curator-radar-taste-chips");
  if (tasteProfile.topTags.length > 0 || tasteProfile.topStudios.length > 0) {
    tasteProfile.topTags.slice(0, 5).forEach((t) => {
      tasteChipsWrap.createSpan({
        cls: "curator-radar-taste-chip is-tag",
        text: `#${t.name}`
      });
    });
    tasteProfile.topStudios.slice(0, 3).forEach((s) => {
      tasteChipsWrap.createSpan({
        cls: "curator-radar-taste-chip is-studio",
        text: `🏛️ ${s.name}`
      });
    });
  } else {
    tasteChipsWrap.createSpan({
      cls: "curator-radar-taste-empty",
      text: "导入动画或打标签后自动生成偏好画像"
    });
  }

  // 2. 双层胶囊式番季切换 Tabs（上行年份月份 + 下行当季热播/未来排期/近期番季）
  const seasonTabs = drawer.createDiv("curator-radar-season-tabs");
  seasonOptions.forEach((opt) => {
    const isAct =
      Number(uiState.radarYear) === opt.year && uiState.radarSeasonMonth === opt.seasonMonth;
    const btn = seasonTabs.createEl("button", {
      cls: `curator-radar-season-tab ${isAct ? "is-active" : ""}`
    });
    btn.createSpan({ cls: "curator-radar-tab-name curator-mono", text: opt.label });
    btn.createSpan({
      cls: `curator-radar-tab-badge ${
        opt.badge === "当季热播" ? "is-current" : opt.badge === "未来排期" ? "is-upcoming" : "is-past"
      }`,
      text: opt.badge
    });
    btn.onclick = (e) => {
      e.preventDefault();
      uiState.radarYear = opt.year;
      uiState.radarSeasonMonth = opt.seasonMonth;
      onRerender();
    };
  });

  const bodyHost = drawer.createDiv("curator-radar-body-host");
  const cacheKey = `${uiState.radarYear}-${uiState.radarSeasonMonth}`;
  const cached = plugin.settings?.seasonalRadarCache?.[cacheKey];

  const renderSubjectsGrid = (record) => {
    bodyHost.empty();
    const subjects = Array.isArray(record?.subjects) ? record.subjects : [];
    const confirmedTotal = Number(record?.total) || subjects.length;
    const isDyn = isDynamicYearOrSeason(uiState.radarYear, uiState.radarSeasonMonth);

    // 同步顶栏左侧当前季度收录状态胶囊
    if (archivePill) {
      archivePill.textContent = isDyn
        ? `${uiState.radarYear}年${uiState.radarSeasonMonth}月 · 已确定 ${confirmedTotal} 部 / 展示前 ${subjects.length} 部`
        : `${uiState.radarYear}年${uiState.radarSeasonMonth}月 · 全网收录 ${confirmedTotal} 部 / 展示前 ${subjects.length} 部`;
    }

    // 构建本地已有作品的 subjectId 与标题集合
    const existingSubjectIds = new Set(
      items.map((it) => String(it.subjectId || "").trim()).filter(Boolean)
    );
    const existingNames = new Set(
      items.map((it) => String(it.name || "").trim().toLowerCase()).filter(Boolean)
    );

    const buildEnrichedList = () =>
      subjects.map((sub) => {
        const affinity = evaluateSubjectAffinity(sub, tasteProfile);
        const inVault =
          existingSubjectIds.has(String(sub.id)) ||
          (sub.name && existingNames.has(sub.name.toLowerCase()));
        const vaultItem = inVault
          ? items.find(
              (it) =>
                String(it.subjectId) === String(sub.id) ||
                String(it.name || "").toLowerCase() === String(sub.name || "").toLowerCase()
            )
          : null;
        const localCover = resolveLocalCoverForSubject(plugin, sub.id, vaultItem);
        return { sub, affinity, inVault, vaultItem, localCover };
      });

    let enriched = buildEnrichedList();
    const uncachedWithRemote = enriched.filter((e) => !e.localCover.hasLocal && e.sub.cover);

    // 3. 统一底色边框的筛选工具条（.curator-radar-toolbar）
    const statusStrip = bodyHost.createDiv("curator-radar-status-strip curator-radar-toolbar");
    const statusText = isDyn
      ? `📅 ${uiState.radarYear}年${uiState.radarSeasonMonth}月排期 · 目前已确定动画 ${confirmedTotal} 部（展示热度前 ${subjects.length} 部）`
      : `📅 ${uiState.radarYear}年${uiState.radarSeasonMonth}月档案 · 全网共收录动画 ${confirmedTotal} 部（展示代表作前 ${subjects.length} 部）`;

    statusStrip.createSpan({ cls: "curator-radar-status-text", text: statusText });

    const controlsRight = statusStrip.createDiv("curator-radar-controls-right");

    const matchFilterBtn = controlsRight.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.radarOnlyMatched ? "is-active-filter" : ""}`,
      text: uiState.radarOnlyMatched ? "✦ 仅看契合偏好 (已开启)" : "✦ 仅看契合偏好"
    });
    matchFilterBtn.onclick = (e) => {
      e.preventDefault();
      uiState.radarOnlyMatched = !uiState.radarOnlyMatched;
      renderSubjectsGrid(record);
    };

    // 批量缓存本季封面到本地附件目录按钮
    const batchCoverBtn = controlsRight.createEl("button", {
      cls: `curator-dl-mini-btn is-batch-cover-btn ${uncachedWithRemote.length === 0 ? "is-all-cached" : "is-accent"}`,
      text:
        uncachedWithRemote.length > 0
          ? `📥 下载本季封面到本地 (${uncachedWithRemote.length})`
          : "✓ 本季封面已缓存至本地"
    });
    batchCoverBtn.title =
      uncachedWithRemote.length > 0
        ? `将当前季度尚未缓存的 ${uncachedWithRemote.length} 张番剧封面批量下载至本地目录 (${plugin.settings.coverFolder || "附件/Bangumi Images"})`
        : "本季所有展示番剧均已具备本地封面缓存";
    if (uncachedWithRemote.length === 0) {
      batchCoverBtn.disabled = true;
    }
    batchCoverBtn.onclick = async (e) => {
      e.preventDefault();
      const pending = enriched.filter((x) => !x.localCover.hasLocal && x.sub.cover);
      if (pending.length === 0) return;

      batchCoverBtn.disabled = true;
      const folder = plugin.settings.coverFolder || "附件/Bangumi Images";
      let done = 0;
      let success = 0;
      const concurrency = 4;
      const queue = [...pending];

      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          try {
            await noteManager.saveCoverLocally(plugin.app, folder, item.sub.id, item.sub.cover);
            success += 1;
          } catch (err) {
            console.warn("[BangumiSeasonalRadar] 缓存封面失败:", item.sub.name, err);
          }
          done += 1;
          if (batchCoverBtn.isConnected) {
            batchCoverBtn.textContent = `📥 正在缓存 (${done}/${pending.length})…`;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
      if (Notice) {
        new Notice(`已将 ${success} 部新番封面缓存至本地目录「${folder}」！`);
      }
      if (bodyHost.isConnected) {
        renderSubjectsGrid(record);
      }
    };

    const searchInput = controlsRight.createEl("input", {
      type: "search",
      cls: "curator-radar-search-input",
      placeholder: "搜索新番名或标签…",
      value: uiState.radarSearch || ""
    });
    searchInput.oninput = () => {
      uiState.radarSearch = searchInput.value;
      renderGridCards();
    };

    const refreshBtn = controlsRight.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "🔄 刷新最新定档"
    });
    refreshBtn.onclick = async (e) => {
      e.preventDefault();
      refreshBtn.disabled = true;
      refreshBtn.textContent = "正在同步…";
      const fresh = await fetchSeasonalAnimeFromBangumi(
        plugin,
        uiState.radarYear,
        uiState.radarSeasonMonth,
        { forceRefresh: true }
      );
      onRerender();
      if (Notice) {
        new Notice(
          `已更新 ${uiState.radarYear}年${uiState.radarSeasonMonth}月排期：目前已确定 ${fresh.total || 0} 部动画`
        );
      }
    };

    const cardsContainer = bodyHost.createDiv("curator-radar-cards-grid");

    const renderGridCards = () => {
      cardsContainer.empty();
      enriched = buildEnrichedList();
      const q = String(uiState.radarSearch || "").trim().toLowerCase();
      const filtered = enriched.filter((item) => {
        if (uiState.radarOnlyMatched && !item.affinity.isMatch) return false;
        if (q) {
          const hay = `${item.sub.name} ${item.sub.originalName} ${(item.sub.tags || []).join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        cardsContainer.createDiv({
          cls: "curator-rs-empty",
          text: uiState.radarOnlyMatched
            ? "当前季度暂无命中偏好标签的新番，可点击右上角切换查看全部已确定新番。"
            : "未找到匹配的新番条目。"
        });
        return;
      }

      filtered.forEach(({ sub, affinity, inVault, vaultItem, localCover }) => {
        const hasLocal = Boolean(localCover.hasLocal && localCover.resourceUrl);
        const card = cardsContainer.createDiv(
          `curator-radar-card ${affinity.isMatch ? "is-affinity-match" : ""} ${inVault ? "is-in-vault" : ""} ${
            hasLocal ? "has-local-cover" : "is-no-local-cover"
          }`
        );

        // 仅当本地已存在对应封面时渲染左侧海报栏；若无本地封面则彻底隐藏占位框，呈现紧凑纯文本排版
        if (hasLocal) {
          const posterCol = card.createDiv("curator-radar-poster");
          const img = posterCol.createEl("img", {
            attr: { src: localCover.resourceUrl, alt: sub.name || sub.originalName }
          });
          img.src = localCover.resourceUrl;
          img.alt = sub.name || sub.originalName;
          img.loading = "lazy";
          img.onerror = () => {
            posterCol.remove();
            card.removeClass("has-local-cover");
            card.addClass("is-no-local-cover");
          };
        }

        const infoCol = card.createDiv("curator-radar-info");
        if (affinity.isMatch) {
          infoCol.createDiv({
            cls: "curator-radar-affinity-badge",
            text: `✦ 契合偏好 · ${affinity.hits.join(" / ")}`
          });
        }

        const titleRow = infoCol.createDiv("curator-radar-card-title");
        titleRow.setText(sub.name || sub.originalName);
        titleRow.title = `${sub.name}\n原名：${sub.originalName}`;

        const metaRow = infoCol.createDiv("curator-radar-card-meta curator-mono");
        metaRow.createSpan({ text: `📅 ${sub.date || "待定"}` });
        if (sub.score) {
          metaRow.createSpan({ cls: "is-score", text: `★ ${sub.score.toFixed(1)}` });
        } else {
          metaRow.createSpan({ text: "未开分/待播" });
        }

        if (Array.isArray(sub.tags) && sub.tags.length > 0) {
          const tagsWrap = infoCol.createDiv("curator-radar-card-tags");
          sub.tags.slice(0, 5).forEach((t) => {
            tagsWrap.createSpan({ cls: "curator-radar-tag", text: `#${t}` });
          });
        }

        if (sub.summary) {
          infoCol.createDiv({
            cls: "curator-radar-card-desc",
            text: sub.summary
          });
        }

        const actionRow = infoCol.createDiv("curator-radar-card-actions");
        if (inVault && vaultItem?.file) {
          const openBtn = actionRow.createEl("button", {
            cls: "curator-dl-mini-btn is-in-vault-btn",
            text: `✓ 已在馆藏 (${vaultItem.state || "已收录"})`
          });
          openBtn.title = "点击打开本地动画笔记";
          openBtn.onclick = async (ev) => {
            ev.preventDefault();
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(vaultItem.file);
          };
        } else {
          const importBtn = actionRow.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: "+ 一键导入为想看"
          });
          importBtn.onclick = async (ev) => {
            ev.preventDefault();
            importBtn.disabled = true;
            importBtn.textContent = "正在导入…";
            try {
              const bgmUrl = `https://bgm.tv/subject/${sub.id}`;
              const detail = await bangumiApi.getAnimeDetail(bgmUrl);
              if (!detail) {
                throw new Error("无法从 Bangumi 获取该作品详情");
              }
              const seasonInfo = noteManager.getSeasonInfo(detail.date);
              detail.state = "想看";
              detail.recordDate = new Date().toISOString().slice(0, 10);
              detail.year = seasonInfo.year;
              detail.season = seasonInfo.season;
              detail.cover = await noteManager.saveCoverLocally(
                plugin.app,
                plugin.settings.coverFolder,
                detail.subjectId,
                detail.Poster
              );
              await noteManager.createAnimeNote(plugin.app, plugin.settings, detail, {
                watchedEpisodes: "0",
                watchUrl: "",
                personalSummary: "",
                downloadPath: "无",
                netabaEmbedEnabled: plugin.settings.netabaEmbedEnabled,
                animeInfoCollapsedByDefault: plugin.settings.animeInfoCollapsedByDefault === true,
                netabaCollapsedByDefault: plugin.settings.netabaCollapsedByDefault,
                netabaUserId: plugin.settings.netabaUserId,
                netabaCompareUrl: plugin.settings.netabaCompareUrl,
                netabaCompareTitle: plugin.settings.netabaCompareTitle,
                netabaDefaultPage: plugin.settings.netabaDefaultPage,
                showBangumiUserScore: plugin.settings.showBangumiUserScore,
                showPersonalScore: plugin.settings.showPersonalScore,
                useBangumiPreciseScore: plugin.settings.showBangumiPreciseScore === true
              });
              importBtn.textContent = "✓ 已导入想看";
              importBtn.classList.remove("is-accent");
              importBtn.classList.add("is-in-vault-btn");
              if (Notice) {
                new Notice(`已将《${sub.name || sub.originalName}》导入为「想看」动画笔记！`);
              }
              await plugin.refreshOpenDashboardViews();
            } catch (err) {
              importBtn.disabled = false;
              importBtn.textContent = "+ 重试导入";
              if (Notice) {
                new Notice(`导入失败：${err.message}`);
              }
            }
          };
        }

        // 若本地尚未缓存该番剧封面，提供单卡按需缓存按钮
        if (!hasLocal && sub.cover) {
          const cacheSingleBtn = actionRow.createEl("button", {
            cls: "curator-dl-mini-btn is-cache-single-btn",
            text: "📥 缓存封面"
          });
          cacheSingleBtn.title = "将该番剧封面下载至本地附件目录";
          cacheSingleBtn.onclick = async (ev) => {
            ev.preventDefault();
            cacheSingleBtn.disabled = true;
            cacheSingleBtn.textContent = "缓存中…";
            try {
              const folder = plugin.settings.coverFolder || "附件/Bangumi Images";
              await noteManager.saveCoverLocally(plugin.app, folder, sub.id, sub.cover);
              renderSubjectsGrid(record);
            } catch (err) {
              cacheSingleBtn.disabled = false;
              cacheSingleBtn.textContent = "📥 缓存封面";
              if (Notice) new Notice(`封面下载失败：${err.message}`);
            }
          };
        }

        const bgmLinkBtn = actionRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "↗ BGM"
        });
        bgmLinkBtn.onclick = (ev) => {
          ev.preventDefault();
          window.open(`https://bgm.tv/subject/${sub.id}`, "_blank");
        };
      });
    };

    renderGridCards();
  };

  if (cached && Array.isArray(cached.subjects) && cached.subjects.length > 0) {
    renderSubjectsGrid(cached);
  } else {
    bodyHost.createDiv({
      cls: "curator-rs-empty",
      text: `正在从 Bangumi 同步 ${uiState.radarYear}年${uiState.radarSeasonMonth}月 目前已确定排期动画…`
    });
    fetchSeasonalAnimeFromBangumi(plugin, uiState.radarYear, uiState.radarSeasonMonth).then(
      (record) => {
        if (bodyHost.isConnected) {
          renderSubjectsGrid(record);
        }
      }
    );
  }
}

module.exports = {
  HISTORICAL_YEAR_TOTAL_BASELINE,
  GRIMOIRE_ERAS,
  getCurrentYearAndSeason,
  isDynamicYearOrSeason,
  getTotalAnimeCountForYearOrSeason,
  resolveLocalCoverForSubject,
  fetchSeasonalAnimeFromBangumi,
  computeUserTasteProfile,
  renderYearSeasonAlmanacModule
};
