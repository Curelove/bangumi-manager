/**
 * 多站动画评分数据引擎、归一化换算与跨站分析核心服务
 * -------------------------------------------------------------------
 * 支持 4 大动画评分社区：
 *   - Bangumi (BGM · 华语核心动漫库 · 10 分制，复用插件已有精确/普通评分缓存)
 *   - AniList (AL · 英文圈功能最齐全动漫社交点评网 · 百分制 · GraphQL 直连并桥接 idMal)
 *   - MyAnimeList (MAL · 欧美最大动漫评分网 · 10 分制 2 位小数 · 直连页面 + Jikan 回退)
 *   - Filmarks (FM · 日本最大综合影视评分网 · 5 分制 · 精准解析 .js-cassette 与 Mark/Clip 数)
 *
 * 跨端约束：
 *   - 零 Node 专属依赖，统一通过 obsidian.requestUrl（测试环境回退 globalThis.fetch）发起网络请求，
 *     桌面端与移动端（iOS / Android）完全一致运行。
 *   - 多站评分数据独立持久化于 plugin.settings.multiSiteRatingsCache，绝不污染用户既有动画 Markdown 笔记 YAML。
 */
"use strict";

let obsidianMod = null;
try {
  obsidianMod = require("obsidian");
} catch (_) {}

const RATING_SOURCES = {
  bangumi: {
    id: "bangumi",
    label: "Bangumi",
    shortLabel: "BGM",
    region: "华语",
    maxScore: 10,
    decimals: 1,
    accent: "#d95b78",
    accentDark: "#f28aa2",
    desc: "中国最大的动漫评分网站（10 分制）"
  },
  anilist: {
    id: "anilist",
    label: "AniList",
    shortLabel: "AL",
    region: "国际 · 英文",
    maxScore: 100,
    decimals: 0,
    accent: "#0b87d9",
    accentDark: "#4bb8ff",
    desc: "英文圈功能最齐全的动漫社交点评网站（百分制）"
  },
  mal: {
    id: "mal",
    label: "MyAnimeList",
    shortLabel: "MAL",
    region: "欧美",
    maxScore: 10,
    decimals: 2,
    accent: "#2e51a2",
    accentDark: "#799cff",
    desc: "欧美最大的动漫评分网站（10 分制）"
  },
  filmarks: {
    id: "filmarks",
    label: "Filmarks",
    shortLabel: "FM",
    region: "日本",
    maxScore: 5,
    decimals: 1,
    accent: "#c98a00",
    accentDark: "#f2c138",
    desc: "日本最大的综合影视评分网站（5 分制）"
  },
  composite: {
    id: "composite",
    label: "跨站综合",
    shortLabel: "综合",
    region: "四站加权",
    maxScore: 10,
    decimals: 2,
    accent: "#5e4fd6",
    accentDark: "#9c8fff",
    desc: "按当前设定权重综合四站折算 10 分制的加权评分"
  }
};

const CORE_SITE_IDS = ["bangumi", "anilist", "mal", "filmarks"];
const DISPLAY_SOURCE_IDS = ["bangumi", "anilist", "mal", "filmarks", "composite"];

const COMPOSITE_WEIGHT_PRESETS = {
  balanced: {
    id: "balanced",
    label: "均衡推荐",
    desc: "华语核心 40% + 日欧三站各 20%",
    weights: { bangumi: 0.4, anilist: 0.2, mal: 0.2, filmarks: 0.2 }
  },
  equal: {
    id: "equal",
    label: "四站等权",
    desc: "四站权重完全相同（各 25%）",
    weights: { bangumi: 0.25, anilist: 0.25, mal: 0.25, filmarks: 0.25 }
  },
  east: {
    id: "east",
    label: "中日偏好",
    desc: "侧重 Bangumi 45% 与 Filmarks 35%",
    weights: { bangumi: 0.45, anilist: 0.1, mal: 0.1, filmarks: 0.35 }
  },
  west: {
    id: "west",
    label: "欧美偏好",
    desc: "侧重 MAL 40% 与 AniList 35%",
    weights: { bangumi: 0.15, anilist: 0.35, mal: 0.4, filmarks: 0.1 }
  }
};

const DEFAULT_WEIGHTS = Object.assign({}, COMPOSITE_WEIGHT_PRESETS.balanced.weights);
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天默认新鲜度

/* ============================== 基础工具 ============================== */

function cleanStr(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function normalizeTitleForMatch(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[！!？?：:；;，,。\.、·・\-—–_~～\/\\|（）()\[\]【】「」『』《》〈〉"'"'★☆♪♫\s]+/g, "");
}

function extractSeasonNumber(raw) {
  const s = String(raw || "").normalize("NFKC");
  let m = s.match(/第\s*([0-9一二三四五六七八九十]+)\s*[期季部]/i);
  if (m) return parseCjkOrArabicNum(m[1]);
  m = s.match(/\b(?:season|series)\s*([0-9]{1,2})\b/i);
  if (m) return Number(m[1]);
  m = s.match(/\b([2-9])(?:nd|rd|th)\s*season\b/i);
  if (m) return Number(m[1]);
  m = s.match(/\bS([2-9])\b/);
  if (m) return Number(m[1]);
  if (/\bII\b/.test(s)) return 2;
  if (/\bIII\b/.test(s)) return 3;
  if (/\bIV\b/.test(s)) return 4;
  return 1;
}

function parseCjkOrArabicNum(token) {
  const s = String(token || "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[s] || 1;
}

function isLikelySpinOffOrMiniShort(title) {
  const s = String(title || "").normalize("NFKC");
  return /(?:ミニアニメ|ショート|ぷち|ちび|●●の魔法|総集編|ダイジェスト|PV|CM|予告|特典|劇伴|ラジオ|朗読劇|実写|舞台|ミュージカル|live\s*action)/i.test(
    s
  );
}

function isMovieTitle(title) {
  const s = String(title || "").normalize("NFKC");
  return /(?:劇場版|剧场版|映画|movie|film)/i.test(s);
}

function bigramSimilarity(a, b) {
  const s1 = normalizeTitleForMatch(a);
  const s2 = normalizeTitleForMatch(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return s1.includes(s2) || s2.includes(s1) ? 0.65 : 0;
  const set1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const g = s1.slice(i, i + 2);
    set1.set(g, (set1.get(g) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const g = s2.slice(i, i + 2);
    const cnt = set1.get(g) || 0;
    if (cnt > 0) {
      inter++;
      set1.set(g, cnt - 1);
    }
  }
  return (2 * inter) / (s1.length - 1 + (s2.length - 1));
}

function withTimeout(promise, ms = 12000, label = "timeout") {
  let tid = null;
  const timeoutPromise = new Promise((_, reject) => {
    tid = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (tid) clearTimeout(tid);
  });
}

async function httpRequestSafe(opts, timeoutMs = 12000) {
  const reqUrlFn = obsidianMod && typeof obsidianMod.requestUrl === "function" ? obsidianMod.requestUrl : null;
  if (reqUrlFn) {
    const resp = await withTimeout(
      reqUrlFn(Object.assign({ throw: false }, opts)),
      timeoutMs,
      "request_timeout"
    );
    // 注意：Obsidian requestUrl 的 .json / .text 是惰性 getter，HTML 页面（MAL、Filmarks）访问 .json 会直接抛出
    // “Unexpected token '<'”，必须逐个兜底，否则整站抓取会被误判为失败。
    let text = "";
    try {
      text = typeof resp?.text === "string" ? resp.text : "";
    } catch (_) {
      text = "";
    }
    let json = null;
    const looksJson = /^\s*[[{]/.test(text);
    if (looksJson) {
      try {
        json = resp.json || JSON.parse(text);
      } catch (_) {
        json = null;
      }
    }
    return {
      status: Number(resp?.status) || 0,
      text,
      json
    };
  }
  const fetchInit = {
    method: opts.method || "GET",
    headers: opts.headers || {}
  };
  if (opts.body !== undefined) fetchInit.body = opts.body;
  const resp = await withTimeout(fetch(opts.url, fetchInit), timeoutMs, "request_timeout");
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: resp.status, text, json };
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================== 设置与缓存访问 ============================== */

function getAnimeRatingCacheKey(item) {
  if (!item) return "";
  const sid = cleanStr(item.subjectId);
  if (sid && /^\d+$/.test(sid)) return sid;
  const m = String(item.bgmUrl || "").match(/\/subject\/(\d+)/);
  if (m && m[1]) return m[1];
  const norm = normalizeTitleForMatch(item.japaneseName || item.name || "");
  return norm ? `title:${norm}` : "";
}

function ensureMultiSiteCache(plugin) {
  if (!plugin || !plugin.settings) return {};
  if (!plugin.settings.multiSiteRatingsCache || typeof plugin.settings.multiSiteRatingsCache !== "object") {
    plugin.settings.multiSiteRatingsCache = {};
  }
  return plugin.settings.multiSiteRatingsCache;
}

function getPreferredRatingSource(plugin) {
  const raw = String(plugin?.settings?.preferredRatingSource || "bangumi").trim();
  return DISPLAY_SOURCE_IDS.includes(raw) ? raw : "bangumi";
}

async function setPreferredRatingSource(plugin, sourceId) {
  if (!plugin || !plugin.settings) return "bangumi";
  const next = DISPLAY_SOURCE_IDS.includes(sourceId) ? sourceId : "bangumi";
  plugin.settings.preferredRatingSource = next;
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
  return next;
}

function getCompositeWeights(plugin) {
  const raw = plugin?.settings?.multiSiteWeightConfig;
  if (!raw || typeof raw !== "object") return Object.assign({}, DEFAULT_WEIGHTS);
  const out = {};
  let sum = 0;
  for (const id of CORE_SITE_IDS) {
    const v = Number(raw[id]);
    out[id] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[id];
    sum += out[id];
  }
  if (sum <= 0) return Object.assign({}, DEFAULT_WEIGHTS);
  for (const id of CORE_SITE_IDS) out[id] = out[id] / sum;
  return out;
}

async function setCompositeWeights(plugin, nextWeights) {
  if (!plugin || !plugin.settings) return Object.assign({}, DEFAULT_WEIGHTS);
  const clean = {};
  let sum = 0;
  for (const id of CORE_SITE_IDS) {
    const v = Number(nextWeights?.[id]);
    clean[id] = Number.isFinite(v) && v >= 0 ? v : 0;
    sum += clean[id];
  }
  if (sum <= 0) Object.assign(clean, DEFAULT_WEIGHTS);
  else {
    for (const id of CORE_SITE_IDS) clean[id] = Number((clean[id] / sum).toFixed(4));
  }
  plugin.settings.multiSiteWeightConfig = clean;
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
  return clean;
}

function getCachedMultiSiteRecord(plugin, item) {
  const key = getAnimeRatingCacheKey(item);
  if (!key) return null;
  const cache = ensureMultiSiteCache(plugin);
  return cache[key] || null;
}

/* ============================== 1. AniList GraphQL 抓取 ============================== */

const ANILIST_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 6) {
    media(search: $search, type: ANIME) {
      id
      idMal
      format
      seasonYear
      episodes
      averageScore
      meanScore
      popularity
      favourites
      siteUrl
      title {
        native
        romaji
        english
      }
      synonyms
      stats {
        scoreDistribution {
          score
          amount
        }
      }
    }
  }
}`;

const ANILIST_BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    format
    seasonYear
    episodes
    averageScore
    meanScore
    popularity
    favourites
    siteUrl
    title {
      native
      romaji
      english
    }
    synonyms
    stats {
      scoreDistribution {
        score
        amount
      }
    }
  }
}`;

function scoreAniListCandidate(cand, item) {
  if (!cand) return -999;
  const targetJp = cleanStr(item?.japaneseName || "");
  const targetCn = cleanStr(item?.name || "");
  const targetYear = parseInt(item?.year, 10) || 0;
  const targetSeason = Math.max(extractSeasonNumber(targetJp), extractSeasonNumber(targetCn));
  const targetIsMovie = isMovieTitle(targetJp) || isMovieTitle(targetCn);

  const candTitles = [
    cand.title?.native,
    cand.title?.romaji,
    cand.title?.english,
    ...(Array.isArray(cand.synonyms) ? cand.synonyms : [])
  ]
    .map(cleanStr)
    .filter(Boolean);

  let bestTitleSim = 0;
  let exactHit = false;
  const normJp = normalizeTitleForMatch(targetJp);
  const normCn = normalizeTitleForMatch(targetCn);

  for (const ct of candTitles) {
    const nct = normalizeTitleForMatch(ct);
    if (!nct) continue;
    if ((normJp && nct === normJp) || (normCn && nct === normCn)) {
      exactHit = true;
      bestTitleSim = 1;
      break;
    }
    if (normJp) bestTitleSim = Math.max(bestTitleSim, bigramSimilarity(normJp, nct));
    if (normCn) bestTitleSim = Math.max(bestTitleSim, bigramSimilarity(normCn, nct));
  }

  let score = exactHit ? 110 : bestTitleSim * 80;
  const candSeason = Math.max(...candTitles.map(extractSeasonNumber), 1);
  if (targetSeason > 1) {
    if (candSeason === targetSeason) score += 35;
    else score -= 55;
  } else if (candSeason > 1) {
    score -= 45;
  }

  const candYear = Number(cand.seasonYear) || 0;
  if (targetYear > 1950 && candYear > 1950) {
    const diff = Math.abs(targetYear - candYear);
    if (diff === 0) score += 26;
    else if (diff === 1) score += 12;
    else if (diff >= 3) score -= 28;
  }

  const fmt = String(cand.format || "").toUpperCase();
  if (targetIsMovie && fmt === "MOVIE") score += 20;
  else if (!targetIsMovie && fmt === "TV") score += 12;
  else if (!targetIsMovie && (fmt === "SPECIAL" || fmt === "MUSIC" || fmt === "TV_SHORT")) score -= 18;

  if (cand.popularity > 0) {
    score += Math.min(12, Math.log10(cand.popularity + 1) * 2.2);
  }
  return score;
}

function normalizeAniListMedia(media, confidence = 0.95) {
  if (!media || !media.id) return null;
  const rawAvg = Number(media.averageScore);
  const rawMean = Number(media.meanScore);
  const score100 =
    Number.isFinite(rawAvg) && rawAvg > 0
      ? rawAvg
      : Number.isFinite(rawMean) && rawMean > 0
      ? rawMean
      : null;
  const dist = Array.isArray(media.stats?.scoreDistribution)
    ? media.stats.scoreDistribution
        .map((d) => ({ score: Number(d.score) || 0, amount: Number(d.amount) || 0 }))
        .filter((d) => d.score > 0)
        .sort((a, b) => a.score - b.score)
    : [];
  const totalVotes = dist.reduce((acc, d) => acc + d.amount, 0);
  return {
    id: Number(media.id),
    idMal: Number(media.idMal) || null,
    score: score100,
    averageScore: Number.isFinite(rawAvg) && rawAvg > 0 ? rawAvg : null,
    meanScore: Number.isFinite(rawMean) && rawMean > 0 ? rawMean : null,
    normalized10: score100 !== null ? Number((score100 / 10).toFixed(2)) : null,
    popularity: Number(media.popularity) || 0,
    favourites: Number(media.favourites) || 0,
    votes: totalVotes,
    distribution: dist,
    format: String(media.format || ""),
    seasonYear: Number(media.seasonYear) || null,
    titleNative: cleanStr(media.title?.native),
    titleRomaji: cleanStr(media.title?.romaji),
    titleEnglish: cleanStr(media.title?.english),
    url: cleanStr(media.siteUrl) || `https://anilist.co/anime/${media.id}`,
    confidence: Number(confidence.toFixed(2)),
    fetchedAt: Date.now()
  };
}

async function fetchAniListRating(item, opts = {}) {
  const directId = Number(opts.anilistId) || 0;
  if (directId > 0) {
    const resp = await httpRequestSafe({
      url: "https://graphql.anilist.co",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_BY_ID_QUERY, variables: { id: directId } })
    });
    if (resp.status === 200 && resp.json?.data?.Media) {
      return normalizeAniListMedia(resp.json.data.Media, 1.0);
    }
    return null;
  }

  const queries = [];
  const jp = cleanStr(item?.japaneseName || "");
  const cn = cleanStr(item?.name || "");
  if (jp) queries.push(jp);
  if (jp && /[第季期]/.test(jp)) {
    const stripped = jp.replace(/\s*第\s*[0-9一二三四五六七八九十]+\s*[期季部].*$/, "").trim();
    if (stripped && stripped !== jp) queries.push(stripped);
  }
  if (cn && cn !== jp) queries.push(cn);

  let bestMedia = null;
  let bestScore = -999;

  for (const q of queries.slice(0, 2)) {
    const resp = await httpRequestSafe({
      url: "https://graphql.anilist.co",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_SEARCH_QUERY, variables: { search: q } })
    });
    if (resp.status === 429) {
      await sleepMs(1600);
      continue;
    }
    const list = Array.isArray(resp.json?.data?.Page?.media) ? resp.json.data.Page.media : [];
    for (const cand of list) {
      const sc = scoreAniListCandidate(cand, item);
      if (sc > bestScore) {
        bestScore = sc;
        bestMedia = cand;
      }
    }
    if (bestScore >= 95) break;
  }

  if (!bestMedia || bestScore < 35) return null;
  const conf = Math.max(0.5, Math.min(1, bestScore / 130));
  return normalizeAniListMedia(bestMedia, conf);
}

/* ============================== 2. MyAnimeList 抓取 ============================== */

function parseMalHtmlPage(html, malId) {
  const s = String(html || "");
  if (!s || s.length < 2000) return null;
  const scoreMatch =
    s.match(/class="score-label[^"]*"[^>]*>\s*([0-9]+\.[0-9]+)\s*</i) ||
    s.match(/itemprop="ratingValue"[^>]*>\s*([0-9]+\.[0-9]+)\s*</i);
  const scoreVal = scoreMatch ? Number(scoreMatch[1]) : null;
  const usersMatch =
    s.match(/data-user="([0-9,]+)\s*users?"/i) ||
    s.match(/itemprop="ratingCount"[^>]*>\s*([0-9,]+)\s*</i);
  const scoredBy = usersMatch ? Number(String(usersMatch[1]).replace(/,/g, "")) || 0 : 0;
  const rankMatch = s.match(/Ranked\s*<strong>\s*#([0-9,]+)\s*<\/strong>/i);
  const rank = rankMatch ? Number(String(rankMatch[1]).replace(/,/g, "")) || null : null;
  const popMatch = s.match(/Popularity\s*<strong>\s*#([0-9,]+)\s*<\/strong>/i);
  const popularity = popMatch ? Number(String(popMatch[1]).replace(/,/g, "")) || null : null;
  const titleMatch = s.match(/<h1[^>]*class="title-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim()) : "";

  if (scoreVal === null && !title) return null;
  return {
    id: Number(malId),
    score: Number.isFinite(scoreVal) && scoreVal > 0 ? Number(scoreVal.toFixed(2)) : null,
    normalized10: Number.isFinite(scoreVal) && scoreVal > 0 ? Number(scoreVal.toFixed(2)) : null,
    scoredBy,
    rank,
    popularity,
    title,
    url: `https://myanimelist.net/anime/${malId}`,
    sourceMethod: "mal_html",
    fetchedAt: Date.now()
  };
}

async function searchMalIdFallback(item) {
  const q = cleanStr(item?.japaneseName || item?.name || "");
  if (!q) return null;
  try {
    const resp = await httpRequestSafe(
      {
        url: `https://myanimelist.net/search/prefix.json?type=anime&keyword=${encodeURIComponent(q.slice(0, 60))}&v=1`,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json"
        }
      },
      9000
    );
    const items = resp.json?.categories?.[0]?.items;
    if (Array.isArray(items) && items.length > 0) {
      const targetYear = parseInt(item?.year, 10) || 0;
      let best = items[0];
      let bestScore = -999;
      for (const it of items.slice(0, 6)) {
        let sc = bigramSimilarity(q, it.name || "") * 80;
        const yr = parseInt(it.payload?.aired, 10) || parseInt(String(it.payload?.aired || "").match(/\d{4}/)?.[0], 10) || 0;
        if (targetYear && yr) {
          if (yr === targetYear) sc += 25;
          else if (Math.abs(yr - targetYear) === 1) sc += 10;
          else sc -= 20;
        }
        if (sc > bestScore) {
          bestScore = sc;
          best = it;
        }
      }
      if (best && Number(best.id) > 0) return Number(best.id);
    }
  } catch (_) {}
  return null;
}

async function fetchMalRating(item, opts = {}) {
  let malId = Number(opts.malId) || 0;
  if (!malId) {
    malId = (await searchMalIdFallback(item)) || 0;
  }
  if (!malId) return null;

  // 首选：直连 myanimelist.net 页面（实测快、无 Jikan 限流/超时）
  try {
    const resp = await httpRequestSafe(
      {
        url: `https://myanimelist.net/anime/${malId}`,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        }
      },
      11000
    );
    if (resp.status === 200 && resp.text) {
      const parsed = parseMalHtmlPage(resp.text, malId);
      if (parsed) return parsed;
    }
  } catch (_) {}

  // 兜底：Jikan v4 API
  try {
    const resp = await httpRequestSafe(
      {
        url: `https://api.jikan.moe/v4/anime/${malId}`,
        method: "GET",
        headers: { Accept: "application/json" }
      },
      8000
    );
    const d = resp.status === 200 ? resp.json?.data : null;
    if (d) {
      const sc = Number(d.score);
      return {
        id: Number(malId),
        score: Number.isFinite(sc) && sc > 0 ? Number(sc.toFixed(2)) : null,
        normalized10: Number.isFinite(sc) && sc > 0 ? Number(sc.toFixed(2)) : null,
        scoredBy: Number(d.scored_by) || 0,
        rank: Number(d.rank) || null,
        popularity: Number(d.popularity) || null,
        title: cleanStr(d.title_japanese || d.title),
        url: cleanStr(d.url) || `https://myanimelist.net/anime/${malId}`,
        sourceMethod: "jikan",
        fetchedAt: Date.now()
      };
    }
  } catch (_) {}

  return null;
}

/* ============================== 3. Filmarks HTML 解析与精准匹配 ============================== */

function parseFilmarksSearchHtml(html) {
  const s = String(html || "");
  if (!s) return [];
  const parts = s.split(/<div class="js-cassette"/).slice(1);
  const cards = [];
  for (const chunk of parts.slice(0, 14)) {
    const headEnd = chunk.indexOf(">");
    const attrStr = headEnd > 0 ? chunk.slice(0, headEnd) : "";
    let markJson = null;
    let clipJson = null;
    const mMark = attrStr.match(/data-mark="([^"]+)"/);
    if (mMark) {
      try {
        markJson = JSON.parse(decodeHtmlEntities(mMark[1]));
      } catch (_) {}
    }
    const mClip = attrStr.match(/data-clip="([^"]+)"/);
    if (mClip) {
      try {
        clipJson = JSON.parse(decodeHtmlEntities(mClip[1]));
      } catch (_) {}
    }
    const hrefMatch = chunk.match(/\/animes\/(\d+)\/(\d+)/);
    const seriesId = Number(markJson?.anime_series_id || hrefMatch?.[1]) || 0;
    const seasonId = Number(markJson?.anime_season_id || hrefMatch?.[2]) || 0;
    const titleMatch = chunk.match(/p-content-cassette__title[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
    const scoreMatch = chunk.match(/c-rating__score[^>]*>\s*([^<]+?)\s*</);
    const rawScore = scoreMatch ? scoreMatch[1].trim() : "";
    const scoreNum = /^\d+(?:\.\d+)?$/.test(rawScore) ? Number(rawScore) : null;
    const yearMatch = chunk.match(/(?:上映日|放送|配信|公開)[^<]{0,20}(19\d{2}|20\d{2})/) || chunk.match(/p-content-cassette__other-info[^>]*>[\s\S]{0,160}?(19\d{2}|20\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : 0;

    if (!title && !seriesId) continue;
    cards.push({
      seriesId,
      seasonId,
      title,
      score: scoreNum,
      marks: Number(markJson?.count) || 0,
      clips: Number(clipJson?.count) || 0,
      year,
      url: seriesId && seasonId ? `https://filmarks.com/animes/${seriesId}/${seasonId}` : ""
    });
  }
  return cards;
}

function parseFilmarksDetailHtml(html, url) {
  const s = String(html || "");
  if (!s) return null;
  const titleMatch = s.match(/<h2[^>]*class="p-content-detail__title"[^>]*>([\s\S]*?)<\/h2>/) || s.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s*-\s*アニメ情報.*$/, "").replace(/\s+/g, " ").trim())
    : "";
  const scoreMatch = s.match(/c-rating__score[^>]*>\s*([0-9]+\.[0-9]+)\s*</);
  const scoreNum = scoreMatch ? Number(scoreMatch[1]) : null;
  const mMark = s.match(/data-mark="([^"]+)"/);
  const mClip = s.match(/data-clip="([^"]+)"/);
  let markJson = null;
  let clipJson = null;
  if (mMark) {
    try {
      markJson = JSON.parse(decodeHtmlEntities(mMark[1]));
    } catch (_) {}
  }
  if (mClip) {
    try {
      clipJson = JSON.parse(decodeHtmlEntities(mClip[1]));
    } catch (_) {}
  }
  const mUrl = String(url || "").match(/\/animes\/(\d+)\/(\d+)/);
  const seriesId = Number(markJson?.anime_series_id || mUrl?.[1]) || 0;
  const seasonId = Number(markJson?.anime_season_id || mUrl?.[2]) || 0;
  return {
    seriesId,
    seasonId,
    score: Number.isFinite(scoreNum) && scoreNum > 0 ? Number(scoreNum.toFixed(1)) : null,
    normalized10: Number.isFinite(scoreNum) && scoreNum > 0 ? Number((scoreNum * 2).toFixed(2)) : null,
    marks: Number(markJson?.count) || 0,
    clips: Number(clipJson?.count) || 0,
    matchedTitle: title,
    url: seriesId && seasonId ? `https://filmarks.com/animes/${seriesId}/${seasonId}` : cleanStr(url),
    confidence: 1.0,
    fetchedAt: Date.now()
  };
}

function scoreFilmarksCandidate(card, item) {
  const targetJp = cleanStr(item?.japaneseName || item?.name || "");
  const targetCn = cleanStr(item?.name || "");
  const targetYear = parseInt(item?.year, 10) || 0;
  const targetSeason = Math.max(extractSeasonNumber(targetJp), extractSeasonNumber(targetCn));
  const targetIsSpinOff = isLikelySpinOffOrMiniShort(targetJp) || isLikelySpinOffOrMiniShort(targetCn);
  const targetIsMovie = isMovieTitle(targetJp) || isMovieTitle(targetCn);

  const candTitle = cleanStr(card.title);
  const normTarget = normalizeTitleForMatch(targetJp);
  const normCand = normalizeTitleForMatch(candTitle);
  const sim = bigramSimilarity(normTarget, normCand);
  const exact = normTarget && normCand && normTarget === normCand;

  let sc = exact ? 115 : sim * 82;
  if (!exact && normTarget && normCand.startsWith(normTarget) && normCand.length - normTarget.length <= 6) {
    sc += 18;
  }

  const candSeason = extractSeasonNumber(candTitle);
  if (targetSeason > 1) {
    if (candSeason === targetSeason) sc += 42;
    else sc -= 65;
  } else if (candSeason > 1) {
    sc -= 52;
  }

  if (!targetIsSpinOff && isLikelySpinOffOrMiniShort(candTitle)) {
    sc -= 60;
  }
  if (targetIsMovie !== isMovieTitle(candTitle)) {
    sc -= 30;
  }

  if (targetYear > 1950 && card.year > 1950) {
    const diff = Math.abs(targetYear - card.year);
    if (diff === 0) sc += 24;
    else if (diff === 1) sc += 10;
    else if (diff >= 3) sc -= 26;
  }

  if (card.marks > 0) sc += Math.min(18, Math.log10(card.marks + 1) * 4.2);
  if (card.score !== null) sc += 6;
  return sc;
}

async function fetchFilmarksRating(item, opts = {}) {
  const manualUrl = cleanStr(opts.filmarksUrl || "");
  if (manualUrl && /filmarks\.com\/animes\/\d+\/\d+/i.test(manualUrl)) {
    const resp = await httpRequestSafe(
      {
        url: manualUrl,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "ja,en;q=0.8"
        }
      },
      11000
    );
    if (resp.status === 200 && resp.text) {
      return parseFilmarksDetailHtml(resp.text, manualUrl);
    }
    return null;
  }

  const jpRaw = cleanStr(item?.japaneseName || "");
  const fallbackName = cleanStr(opts.anilistNativeTitle || item?.name || "");
  const queries = [];
  if (jpRaw) queries.push(jpRaw);
  if (jpRaw && /[第季期]/.test(jpRaw)) {
    const stripped = jpRaw.replace(/\s*第\s*[0-9一二三四五六七八九十]+\s*[期季部].*$/, "").trim();
    if (stripped && stripped !== jpRaw) queries.push(stripped);
  }
  if (fallbackName && !queries.includes(fallbackName)) queries.push(fallbackName);

  let bestCard = null;
  let bestScore = -999;

  for (const q of queries.slice(0, 2)) {
    const resp = await httpRequestSafe(
      {
        url: `https://filmarks.com/search/animes?q=${encodeURIComponent(q)}`,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "ja,en;q=0.8"
        }
      },
      11000
    );
    if (resp.status !== 200 || !resp.text) continue;
    const cards = parseFilmarksSearchHtml(resp.text);
    for (const c of cards) {
      const sc = scoreFilmarksCandidate(c, item);
      if (sc > bestScore) {
        bestScore = sc;
        bestCard = c;
      }
    }
    if (bestScore >= 100) break;
  }

  if (!bestCard || bestScore < 42) return null;
  const conf = Math.max(0.5, Math.min(1, bestScore / 135));
  return {
    seriesId: bestCard.seriesId,
    seasonId: bestCard.seasonId,
    score: bestCard.score !== null ? Number(bestCard.score.toFixed(1)) : null,
    normalized10: bestCard.score !== null ? Number((bestCard.score * 2).toFixed(2)) : null,
    marks: bestCard.marks,
    clips: bestCard.clips,
    matchedTitle: bestCard.title,
    url: bestCard.url,
    confidence: Number(conf.toFixed(2)),
    fetchedAt: Date.now()
  };
}

/* ============================== 统一单部抓取 & 手动纠偏 ============================== */

async function fetchMultiSiteRatingForItem(plugin, item, options = {}) {
  const key = getAnimeRatingCacheKey(item);
  if (!key) return { ok: false, reason: "missing_key", record: null };

  const cache = ensureMultiSiteCache(plugin);
  const existing = cache[key] || {};
  const bindings = Object.assign({}, existing.manualBindings || {}, options.manualBindings || {});
  const now = Date.now();
  const force = Boolean(options.force);

  if (
    !force &&
    existing.updatedAt &&
    now - existing.updatedAt < CACHE_TTL_MS &&
    (existing.anilist || existing.mal || existing.filmarks)
  ) {
    return { ok: true, fromCache: true, record: existing };
  }

  const errors = {};
  let anilist = existing.anilist || null;
  let mal = existing.mal || null;
  let filmarks = existing.filmarks || null;

  // 1. 先查 AniList（同时高效获取 idMal 与精准日文原生标题），并行启动 Filmarks
  const alTask = fetchAniListRating(item, { anilistId: bindings.anilistId || existing.anilist?.id })
    .then((res) => {
      if (res) anilist = res;
    })
    .catch((e) => {
      errors.anilist = String(e?.message || e);
    });

  const fmTask = fetchFilmarksRating(item, { filmarksUrl: bindings.filmarksUrl })
    .then((res) => {
      if (res) filmarks = res;
    })
    .catch((e) => {
      errors.filmarks = String(e?.message || e);
    });

  await Promise.all([alTask, fmTask]);

  // 若 Filmarks 首次未命中且 AniList 提供了日文原名，补查一次 Filmarks
  if (!filmarks && anilist?.titleNative && anilist.titleNative !== item?.japaneseName) {
    try {
      const retryFm = await fetchFilmarksRating(item, { anilistNativeTitle: anilist.titleNative });
      if (retryFm) filmarks = retryFm;
    } catch (_) {}
  }

  // 2. 用 AniList 桥接出的 idMal（或手动绑定 malId / 搜索回退）拉取 MAL 精确分
  const resolvedMalId = Number(bindings.malId) || Number(anilist?.idMal) || Number(existing.mal?.id) || 0;
  try {
    const malRes = await fetchMalRating(item, { malId: resolvedMalId });
    if (malRes) mal = malRes;
  } catch (e) {
    errors.mal = String(e?.message || e);
  }

  const record = {
    subjectId: cleanStr(item?.subjectId || existing.subjectId || ""),
    animeName: cleanStr(item?.name || existing.animeName || ""),
    japaneseName: cleanStr(item?.japaneseName || anilist?.titleNative || existing.japaneseName || ""),
    updatedAt: Date.now(),
    anilist,
    mal,
    filmarks,
    manualBindings: bindings
  };

  cache[key] = record;
  if (!options.deferSave && plugin && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }

  return { ok: true, fromCache: false, record, errors };
}

async function applyManualSiteBinding(plugin, item, bindingInput = {}) {
  const key = getAnimeRatingCacheKey(item);
  if (!key) return { ok: false, reason: "missing_key" };
  const cache = ensureMultiSiteCache(plugin);
  const existing = cache[key] || {};
  const nextBindings = Object.assign({}, existing.manualBindings || {});

  if (bindingInput.anilist !== undefined) {
    const m = String(bindingInput.anilist || "").match(/(\d+)/);
    nextBindings.anilistId = m ? Number(m[1]) : null;
  }
  if (bindingInput.mal !== undefined) {
    const m = String(bindingInput.mal || "").match(/(\d+)/);
    nextBindings.malId = m ? Number(m[1]) : null;
  }
  if (bindingInput.filmarks !== undefined) {
    const rawFm = cleanStr(bindingInput.filmarks);
    const m = rawFm.match(/(https?:\/\/filmarks\.com\/animes\/\d+\/\d+)/i);
    nextBindings.filmarksUrl = m ? m[1] : rawFm ? rawFm : "";
  }

  cache[key] = Object.assign({}, existing, { manualBindings: nextBindings });
  return fetchMultiSiteRatingForItem(plugin, item, {
    force: true,
    manualBindings: nextBindings
  });
}

/* ============================== 批量同步队列管理 ============================== */

const _batchSyncState = {
  running: false,
  cancelRequested: false,
  scope: "watching",
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentName: "",
  startedAt: 0,
  finishedAt: 0,
  listeners: new Set()
};

function getMultiSiteSyncStatus() {
  return {
    running: _batchSyncState.running,
    cancelRequested: _batchSyncState.cancelRequested,
    scope: _batchSyncState.scope,
    total: _batchSyncState.total,
    completed: _batchSyncState.completed,
    succeeded: _batchSyncState.succeeded,
    failed: _batchSyncState.failed,
    currentName: _batchSyncState.currentName,
    startedAt: _batchSyncState.startedAt,
    finishedAt: _batchSyncState.finishedAt
  };
}

function emitMultiSiteSyncStatus() {
  const snap = getMultiSiteSyncStatus();
  for (const fn of _batchSyncState.listeners) {
    try {
      fn(snap);
    } catch (_) {}
  }
}

function subscribeMultiSiteSync(listener) {
  if (typeof listener !== "function") return () => {};
  _batchSyncState.listeners.add(listener);
  return () => _batchSyncState.listeners.delete(listener);
}

function cancelMultiSiteSync() {
  if (_batchSyncState.running) {
    _batchSyncState.cancelRequested = true;
    emitMultiSiteSyncStatus();
  }
}

async function startBatchMultiSiteSync(plugin, items, options = {}) {
  if (_batchSyncState.running) {
    return { ok: false, reason: "already_running", status: getMultiSiteSyncStatus() };
  }
  const list = Array.isArray(items) ? items.filter((it) => it && !it.isSamplePreviewItem) : [];
  const scope = options.scope || "watching";
  const force = Boolean(options.force);
  const cache = ensureMultiSiteCache(plugin);
  const now = Date.now();

  let targets = list;
  if (scope === "watching") {
    targets = list.filter((it) => it.state === "在看" || it.state === "想看");
  } else if (scope === "rated") {
    targets = list.filter((it) => it.personalScore !== null && Number.isFinite(Number(it.personalScore)));
  } else if (scope === "missing") {
    targets = list.filter((it) => {
      const rec = cache[getAnimeRatingCacheKey(it)];
      return !rec || (!rec.anilist && !rec.mal && !rec.filmarks);
    });
  } else if (scope === "seasonal") {
    const curYear = String(new Date().getFullYear());
    targets = list.filter((it) => String(it.year || "") === curYear);
  }

  if (!force) {
    targets = targets.filter((it) => {
      const rec = cache[getAnimeRatingCacheKey(it)];
      if (!rec || !rec.updatedAt) return true;
      return now - rec.updatedAt >= CACHE_TTL_MS || (!rec.anilist && !rec.mal && !rec.filmarks);
    });
  }

  if (options.limit && Number(options.limit) > 0) {
    targets = targets.slice(0, Number(options.limit));
  }

  _batchSyncState.running = true;
  _batchSyncState.cancelRequested = false;
  _batchSyncState.scope = scope;
  _batchSyncState.total = targets.length;
  _batchSyncState.completed = 0;
  _batchSyncState.succeeded = 0;
  _batchSyncState.failed = 0;
  _batchSyncState.currentName = "";
  _batchSyncState.startedAt = Date.now();
  _batchSyncState.finishedAt = 0;
  emitMultiSiteSyncStatus();

  try {
    let unsaved = 0;
    for (const item of targets) {
      if (_batchSyncState.cancelRequested) break;
      _batchSyncState.currentName = cleanStr(item.name);
      emitMultiSiteSyncStatus();
      try {
        const res = await fetchMultiSiteRatingForItem(plugin, item, { force, deferSave: true });
        if (res && res.ok && res.record && (res.record.anilist || res.record.mal || res.record.filmarks)) {
          _batchSyncState.succeeded++;
        } else {
          _batchSyncState.failed++;
        }
        unsaved++;
        if (unsaved >= 3 && plugin && typeof plugin.saveSettings === "function") {
          await plugin.saveSettings().catch(() => {});
          unsaved = 0;
        }
      } catch (_) {
        _batchSyncState.failed++;
      }
      _batchSyncState.completed++;
      emitMultiSiteSyncStatus();
      if (!_batchSyncState.cancelRequested && _batchSyncState.completed < targets.length) {
        await sleepMs(Number(options.intervalMs) || 680);
      }
    }
    if (unsaved > 0 && plugin && typeof plugin.saveSettings === "function") {
      await plugin.saveSettings().catch(() => {});
    }
  } finally {
    _batchSyncState.running = false;
    _batchSyncState.currentName = "";
    _batchSyncState.finishedAt = Date.now();
    emitMultiSiteSyncStatus();
  }

  return { ok: true, status: getMultiSiteSyncStatus() };
}

/* ============================== 归一化与单评分展示契约 ============================== */

function getBangumiScoreValue(plugin, item) {
  if (!item) return null;
  const preferPrecise = plugin?.settings?.showBangumiPreciseScore === true;
  const p = item.preciseScore !== null && item.preciseScore !== undefined ? Number(item.preciseScore) : NaN;
  const pub = item.publicScore !== null && item.publicScore !== undefined ? Number(item.publicScore) : NaN;
  if (preferPrecise && Number.isFinite(p) && p > 0) return p;
  if (Number.isFinite(pub) && pub > 0) return pub;
  if (Number.isFinite(p) && p > 0) return p;
  return null;
}

function formatSiteNativeScore(sourceId, rawScore, plugin) {
  if (rawScore === null || rawScore === undefined || !Number.isFinite(Number(rawScore))) return "—";
  const n = Number(rawScore);
  if (sourceId === "anilist") return `${Math.round(n)}%`;
  if (sourceId === "filmarks") return n.toFixed(1);
  if (sourceId === "mal") return n.toFixed(2);
  if (sourceId === "composite") return n.toFixed(2);
  const digits = plugin?.settings?.showBangumiPreciseScore
    ? Math.min(2, Math.max(1, Number(plugin?.settings?.bangumiPreciseScoreDisplayDigits) || 2))
    : 1;
  return n.toFixed(digits);
}

/**
 * 计算单部番剧的四站完整评分画像（供多站对比页、气泡悬浮提示与分析引擎共享）
 */
function computeAnimeCrossSiteProfile(plugin, item, customWeights = null) {
  const weights = customWeights || getCompositeWeights(plugin);
  const rec = getCachedMultiSiteRecord(plugin, item);

  const bgmVal = getBangumiScoreValue(plugin, item);
  const bgmUrl =
    cleanStr(item?.bgmUrl) || (item?.subjectId ? `https://bgm.tv/subject/${item.subjectId}` : "");

  const alScore100 = rec?.anilist?.score !== undefined && rec?.anilist?.score !== null ? Number(rec.anilist.score) : null;
  const malScore10 = rec?.mal?.score !== undefined && rec?.mal?.score !== null ? Number(rec.mal.score) : null;
  const fmScore5 = rec?.filmarks?.score !== undefined && rec?.filmarks?.score !== null ? Number(rec.filmarks.score) : null;

  const sites = {
    bangumi: {
      id: "bangumi",
      available: bgmVal !== null && Number.isFinite(bgmVal),
      rawScore: bgmVal,
      normalized10: bgmVal !== null && Number.isFinite(bgmVal) ? Number(bgmVal.toFixed(2)) : null,
      displayText: bgmVal !== null ? formatSiteNativeScore("bangumi", bgmVal, plugin) : "—",
      count: Number(item?.bangumiVotes || 0),
      rank: Number(item?.bangumiRank || 0) || null,
      url: bgmUrl
    },
    anilist: {
      id: "anilist",
      available: alScore100 !== null && Number.isFinite(alScore100) && alScore100 > 0,
      rawScore: alScore100,
      normalized10: alScore100 !== null && alScore100 > 0 ? Number((alScore100 / 10).toFixed(2)) : null,
      displayText: alScore100 !== null && alScore100 > 0 ? `${Math.round(alScore100)}%` : "—",
      meanScore: rec?.anilist?.meanScore || null,
      count: Number(rec?.anilist?.votes || rec?.anilist?.popularity || 0),
      popularity: Number(rec?.anilist?.popularity || 0),
      favourites: Number(rec?.anilist?.favourites || 0),
      distribution: Array.isArray(rec?.anilist?.distribution) ? rec.anilist.distribution : [],
      url: cleanStr(rec?.anilist?.url || ""),
      idNum: rec?.anilist?.id || null
    },
    mal: {
      id: "mal",
      available: malScore10 !== null && Number.isFinite(malScore10) && malScore10 > 0,
      rawScore: malScore10,
      normalized10: malScore10 !== null && malScore10 > 0 ? Number(malScore10.toFixed(2)) : null,
      displayText: malScore10 !== null && malScore10 > 0 ? malScore10.toFixed(2) : "—",
      count: Number(rec?.mal?.scoredBy || 0),
      rank: rec?.mal?.rank || null,
      popularity: rec?.mal?.popularity || null,
      url: cleanStr(rec?.mal?.url || ""),
      idNum: rec?.mal?.id || null
    },
    filmarks: {
      id: "filmarks",
      available: fmScore5 !== null && Number.isFinite(fmScore5) && fmScore5 > 0,
      rawScore: fmScore5,
      normalized10: fmScore5 !== null && fmScore5 > 0 ? Number((fmScore5 * 2).toFixed(2)) : null,
      displayText: fmScore5 !== null && fmScore5 > 0 ? `${fmScore5.toFixed(1)}/5` : "—",
      compactText: fmScore5 !== null && fmScore5 > 0 ? fmScore5.toFixed(1) : "—",
      count: Number(rec?.filmarks?.marks || 0),
      clips: Number(rec?.filmarks?.clips || 0),
      matchedTitle: cleanStr(rec?.filmarks?.matchedTitle || ""),
      url: cleanStr(rec?.filmarks?.url || "")
    }
  };

  const availIds = CORE_SITE_IDS.filter((id) => sites[id].available && sites[id].normalized10 !== null);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const id of availIds) {
    const w = Number(weights[id]) || 0;
    if (w > 0) {
      weightedSum += sites[id].normalized10 * w;
      weightTotal += w;
    }
  }
  const composite10 =
    weightTotal > 0
      ? Number((weightedSum / weightTotal).toFixed(2))
      : availIds.length > 0
      ? Number((availIds.reduce((acc, id) => acc + sites[id].normalized10, 0) / availIds.length).toFixed(2))
      : null;

  let divergence = null;
  let spread = null;
  let highestSite = null;
  let lowestSite = null;
  if (availIds.length >= 2) {
    const vals = availIds.map((id) => sites[id].normalized10);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / vals.length;
    divergence = Number(Math.sqrt(variance).toFixed(2));
    const sorted = [...availIds].sort((a, b) => sites[b].normalized10 - sites[a].normalized10);
    highestSite = sorted[0];
    lowestSite = sorted[sorted.length - 1];
    spread = Number((sites[highestSite].normalized10 - sites[lowestSite].normalized10).toFixed(2));
  }

  // 东西方文化温差：中日均分 (BGM + Filmarks) 减 欧美均分 (AniList + MAL)
  const eastVals = ["bangumi", "filmarks"].filter((id) => sites[id].available).map((id) => sites[id].normalized10);
  const westVals = ["anilist", "mal"].filter((id) => sites[id].available).map((id) => sites[id].normalized10);
  const eastAvg = eastVals.length ? eastVals.reduce((a, b) => a + b, 0) / eastVals.length : null;
  const westAvg = westVals.length ? westVals.reduce((a, b) => a + b, 0) / westVals.length : null;
  const eastWestGap = eastAvg !== null && westAvg !== null ? Number((eastAvg - westAvg).toFixed(2)) : null;

  const cnVsJpGap =
    sites.bangumi.available && sites.filmarks.available
      ? Number((sites.bangumi.normalized10 - sites.filmarks.normalized10).toFixed(2))
      : null;

  const personalScore =
    item?.personalScore !== null && item?.personalScore !== undefined && Number.isFinite(Number(item.personalScore))
      ? Number(item.personalScore)
      : null;

  const personalDeltas = {};
  if (personalScore !== null) {
    for (const id of CORE_SITE_IDS) {
      personalDeltas[id] = sites[id].available ? Number((personalScore - sites[id].normalized10).toFixed(2)) : null;
    }
    personalDeltas.composite = composite10 !== null ? Number((personalScore - composite10).toFixed(2)) : null;
  }

  return {
    item,
    cacheKey: getAnimeRatingCacheKey(item),
    syncedAt: rec?.updatedAt || 0,
    hasExternalSync: Boolean(rec && (sites.anilist.available || sites.mal.available || sites.filmarks.available)),
    availableCount: availIds.length,
    availableSites: availIds,
    sites,
    composite10,
    divergence,
    spread,
    highestSite,
    lowestSite,
    eastAvg: eastAvg !== null ? Number(eastAvg.toFixed(2)) : null,
    westAvg: westAvg !== null ? Number(westAvg.toFixed(2)) : null,
    eastWestGap,
    cnVsJpGap,
    personalScore,
    personalDeltas,
    manualBindings: rec?.manualBindings || {}
  };
}

/**
 * 为「仅展示单一评分更美观」的位置（追番舞台封面、全部番剧卡片、列表列、3D 展厅）返回当前优先展示的评分。
 * 默认显示 Bangumi；用户切换优先源后，若该作品尚未同步所选平台分数则优雅回退至 Bangumi（并注明来源角标）。
 */
function getPreferredDisplayRating(plugin, item, overrideSourceId = "") {
  const prefId = DISPLAY_SOURCE_IDS.includes(overrideSourceId)
    ? overrideSourceId
    : getPreferredRatingSource(plugin);
  const profile = computeAnimeCrossSiteProfile(plugin, item);

  const buildTooltip = () => {
    const lines = [];
    if (profile.sites.bangumi.available) lines.push(`Bangumi: ${profile.sites.bangumi.displayText}`);
    if (profile.sites.anilist.available) {
      lines.push(`AniList: ${profile.sites.anilist.displayText} (折算 ${profile.sites.anilist.normalized10.toFixed(1)})`);
    }
    if (profile.sites.mal.available) lines.push(`MyAnimeList: ${profile.sites.mal.displayText}`);
    if (profile.sites.filmarks.available) {
      lines.push(`Filmarks: ${profile.sites.filmarks.displayText} (折算 ${profile.sites.filmarks.normalized10.toFixed(1)})`);
    }
    if (profile.composite10 !== null && profile.availableCount >= 2) {
      lines.push(`跨站综合: ${profile.composite10.toFixed(2)}`);
    }
    return lines;
  };

  let activeId = prefId;
  let isFallback = false;

  if (prefId === "composite") {
    if (profile.composite10 !== null) {
      return {
        sourceId: "composite",
        preferredSourceId: prefId,
        shortLabel: RATING_SOURCES.composite.shortLabel,
        siteLabel: RATING_SOURCES.composite.label,
        rawScore: profile.composite10,
        normalized10: profile.composite10,
        badgeText: `综合 ${profile.composite10.toFixed(1)}`,
        compactNumber: profile.composite10.toFixed(1),
        isFallback: profile.availableCount < 2,
        tooltip: buildTooltip().join(" · "),
        tooltipLines: buildTooltip(),
        profile
      };
    }
    activeId = "bangumi";
    isFallback = true;
  } else if (!profile.sites[prefId]?.available) {
    // 优先回退 Bangumi，再回退其它已有源
    if (profile.sites.bangumi.available) {
      activeId = "bangumi";
      isFallback = prefId !== "bangumi";
    } else {
      const any = CORE_SITE_IDS.find((id) => profile.sites[id].available);
      if (any) {
        activeId = any;
        isFallback = any !== prefId;
      } else {
        return {
          sourceId: prefId,
          preferredSourceId: prefId,
          shortLabel: RATING_SOURCES[prefId].shortLabel,
          siteLabel: RATING_SOURCES[prefId].label,
          rawScore: null,
          normalized10: null,
          badgeText: "",
          compactNumber: "",
          isFallback: false,
          tooltip: "",
          tooltipLines: [],
          profile
        };
      }
    }
  }

  const sInfo = profile.sites[activeId];
  const meta = RATING_SOURCES[activeId];
  const compactNumber =
    activeId === "anilist"
      ? `${Math.round(sInfo.rawScore)}%`
      : activeId === "filmarks"
      ? sInfo.rawScore.toFixed(1)
      : activeId === "mal"
      ? sInfo.rawScore.toFixed(2)
      : Number(sInfo.rawScore).toFixed(1);

  return {
    sourceId: activeId,
    preferredSourceId: prefId,
    shortLabel: meta.shortLabel,
    siteLabel: meta.label,
    rawScore: sInfo.rawScore,
    normalized10: sInfo.normalized10,
    badgeText: `${meta.shortLabel} ${compactNumber}`,
    compactNumber,
    isFallback,
    tooltip: buildTooltip().join(" · "),
    tooltipLines: buildTooltip(),
    profile
  };
}

/* ============================== 全馆专业跨站统计与品味亲和度分析 ============================== */

function computePearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom <= 1e-9) return null;
  return Number((num / denom).toFixed(3));
}

function getSeasonOrderWeight(seasonStr) {
  const s = String(seasonStr || "");
  if (/10|秋/.test(s)) return 4;
  if (/0?7|夏/.test(s)) return 3;
  if (/0?4|春/.test(s)) return 2;
  if (/0?1|冬/.test(s)) return 1;
  return 0;
}

function getItemSeasonInfo(item) {
  const year = String(item?.year || "").trim();
  const season = String(item?.season || "").trim();
  const seasonKey = year && season ? `${year}:${season}` : "";
  const label = year && season ? `${year}年${season}` : year ? `${year}年` : "";
  return { year, season, seasonKey, label };
}

function collectRatingFilterFacets(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const seasonMap = new Map();
  const yearMap = new Map();
  const stateCounts = new Map();
  let syncedCount = 0;
  let multiSiteCount = 0;
  let fullQuartetCount = 0;

  for (const p of list) {
    if (!p || !p.item) continue;
    if (p.hasExternalSync) syncedCount++;
    if (p.availableCount >= 2) multiSiteCount++;
    if (p.availableCount >= 4) fullQuartetCount++;

    const { year, season, seasonKey, label } = getItemSeasonInfo(p.item);
    if (seasonKey) {
      let sEntry = seasonMap.get(seasonKey);
      if (!sEntry) {
        sEntry = { key: seasonKey, year, season, label, count: 0, syncedCount: 0 };
        seasonMap.set(seasonKey, sEntry);
      }
      sEntry.count++;
      if (p.hasExternalSync) sEntry.syncedCount++;
    }
    if (year) {
      let yEntry = yearMap.get(year);
      if (!yEntry) {
        yEntry = { key: `year:${year}`, year, label: `${year}年`, count: 0, syncedCount: 0 };
        yearMap.set(year, yEntry);
      }
      yEntry.count++;
      if (p.hasExternalSync) yEntry.syncedCount++;
    }
    const st = String(p.item.state || "").trim();
    if (st) {
      stateCounts.set(st, (stateCounts.get(st) || 0) + 1);
    }
  }

  const seasons = Array.from(seasonMap.values()).sort((a, b) => {
    const ya = parseInt(a.year, 10) || 0;
    const yb = parseInt(b.year, 10) || 0;
    if (yb !== ya) return yb - ya;
    return getSeasonOrderWeight(b.season) - getSeasonOrderWeight(a.season);
  });

  const years = Array.from(yearMap.values()).sort(
    (a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
  );

  const preferredOrder = ["在看", "想看", "已看", "抛弃"];
  const states = [];
  for (const st of preferredOrder) {
    if (stateCounts.has(st)) {
      states.push({ key: st, label: st, count: stateCounts.get(st) });
      stateCounts.delete(st);
    }
  }
  for (const [st, count] of stateCounts.entries()) {
    states.push({ key: st, label: st, count });
  }

  return {
    seasons,
    years,
    states,
    coverage: {
      total: list.length,
      syncedCount,
      multiSiteCount,
      fullQuartetCount
    }
  };
}

function filterRatingProfiles(profiles, filterSpec = {}) {
  const list = Array.isArray(profiles) ? profiles : [];
  const f = filterSpec && typeof filterSpec === "object" ? filterSpec : {};
  const seasonFilter = String(f.seasonFilter || "").trim();
  const stateFilter = String(f.stateFilter || "").trim();
  const syncFilter = String(f.syncFilter || (f.onlySynced ? "synced" : "all")).trim();
  const q = String(f.search || "").trim().toLowerCase();

  return list.filter((p) => {
    if (!p || !p.item) return false;
    if (syncFilter === "synced" && !p.hasExternalSync) return false;
    if (syncFilter === "quartet" && p.availableCount < 4) return false;
    if (stateFilter && stateFilter !== "all" && String(p.item.state || "").trim() !== stateFilter) {
      return false;
    }
    if (seasonFilter && seasonFilter !== "all") {
      const info = getItemSeasonInfo(p.item);
      if (seasonFilter.startsWith("year:")) {
        if (info.year !== seasonFilter.slice(5)) return false;
      } else if (info.seasonKey !== seasonFilter) {
        return false;
      }
    }
    if (q) {
      const name = String(p.item.name || "").toLowerCase();
      const jp = String(p.item.japaneseName || "").toLowerCase();
      const studio = String(p.item.studio || "").toLowerCase();
      const tags = Array.isArray(p.item.tags)
        ? p.item.tags.join(" ").toLowerCase()
        : String(p.item.tags || "").toLowerCase();
      if (!name.includes(q) && !jp.includes(q) && !studio.includes(q) && !tags.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function computeRatingAnalyticsFromProfiles(profilesInput, weights) {
  const profiles = Array.isArray(profilesInput) ? profilesInput : [];

  const siteStats = {};
  for (const id of CORE_SITE_IDS) {
    const vals = profiles
      .filter((p) => p.sites[id].available && p.sites[id].normalized10 !== null)
      .map((p) => p.sites[id].normalized10);
    vals.sort((a, b) => a - b);
    const count = vals.length;
    const mean10 = count ? Number((vals.reduce((a, b) => a + b, 0) / count).toFixed(2)) : null;
    const median10 = count
      ? Number((count % 2 === 1 ? vals[(count - 1) / 2] : (vals[count / 2 - 1] + vals[count / 2]) / 2).toFixed(2))
      : null;
    const stdDev =
      count >= 2
        ? Number(
            Math.sqrt(vals.reduce((acc, v) => acc + (v - mean10) * (v - mean10), 0) / count).toFixed(2)
          )
        : null;
    siteStats[id] = {
      id,
      meta: RATING_SOURCES[id],
      count,
      coveragePct: profiles.length ? Math.round((count / profiles.length) * 100) : 0,
      mean10,
      median10,
      stdDev,
      min10: count ? vals[0] : null,
      max10: count ? vals[count - 1] : null
    };
  }

  // 个人打分与四站品味亲和度分析
  const tasteAffinity = {};
  for (const id of CORE_SITE_IDS) {
    const pairs = profiles.filter((p) => p.personalScore !== null && p.sites[id].available);
    const xs = pairs.map((p) => p.personalScore);
    const ys = pairs.map((p) => p.sites[id].normalized10);
    const overlapCount = pairs.length;
    const meanBias = overlapCount
      ? Number((pairs.reduce((acc, p) => acc + (p.personalScore - p.sites[id].normalized10), 0) / overlapCount).toFixed(2))
      : null;
    const mae = overlapCount
      ? Number((pairs.reduce((acc, p) => acc + Math.abs(p.personalScore - p.sites[id].normalized10), 0) / overlapCount).toFixed(2))
      : null;
    const pearsonR = computePearsonCorrelation(xs, ys);
    // 亲和度综合指数 (0-100)：结合相关性与平均绝对误差
    let affinityScore = null;
    if (overlapCount >= 2 && mae !== null) {
      const maePart = Math.max(0, 1 - mae / 3.2);
      const rPart = pearsonR !== null ? (pearsonR + 1) / 2 : maePart;
      affinityScore = Math.round(Math.max(0, Math.min(100, (maePart * 0.55 + rPart * 0.45) * 100)));
    }
    tasteAffinity[id] = {
      id,
      meta: RATING_SOURCES[id],
      overlapCount,
      meanBias,
      mae,
      pearsonR,
      affinityScore
    };
  }

  const rankedAffinity = CORE_SITE_IDS.map((id) => tasteAffinity[id])
    .filter((t) => t.affinityScore !== null)
    .sort((a, b) => b.affinityScore - a.affinityScore);

  const syncedProfiles = profiles.filter((p) => p.hasExternalSync);
  const multiSiteProfiles = profiles.filter((p) => p.availableCount >= 2);
  const fullQuartetProfiles = profiles.filter((p) => p.availableCount === 4);

  const consensusTop = multiSiteProfiles
    .filter((p) => p.composite10 !== null)
    .sort((a, b) => {
      const sa = a.composite10 - (a.divergence || 0) * 0.35;
      const sb = b.composite10 - (b.divergence || 0) * 0.35;
      return sb - sa;
    })
    .slice(0, 12);

  const mostControversial = multiSiteProfiles
    .filter((p) => p.divergence !== null)
    .sort((a, b) => b.divergence - a.divergence || (b.spread || 0) - (a.spread || 0))
    .slice(0, 12);

  const eastFavored = profiles
    .filter((p) => p.eastWestGap !== null && p.eastWestGap > 0.25)
    .sort((a, b) => b.eastWestGap - a.eastWestGap)
    .slice(0, 10);

  const westFavored = profiles
    .filter((p) => p.eastWestGap !== null && p.eastWestGap < -0.25)
    .sort((a, b) => a.eastWestGap - b.eastWestGap)
    .slice(0, 10);

  const personalRebels = profiles
    .filter((p) => p.personalScore !== null && p.composite10 !== null)
    .sort((a, b) => Math.abs(b.personalDeltas.composite) - Math.abs(a.personalDeltas.composite))
    .slice(0, 12);

  return {
    totalCount: profiles.length,
    syncedCount: syncedProfiles.length,
    multiSiteCount: multiSiteProfiles.length,
    fullQuartetCount: fullQuartetProfiles.length,
    weights,
    profiles,
    siteStats,
    tasteAffinity,
    closestTasteSite: rankedAffinity[0] || null,
    consensusTop,
    mostControversial,
    eastFavored,
    westFavored,
    personalRebels
  };
}

function computeLibraryRatingAnalytics(plugin, items, customWeights = null) {
  const list = Array.isArray(items) ? items : [];
  const weights = customWeights || getCompositeWeights(plugin);
  const profiles = list.map((it) => computeAnimeCrossSiteProfile(plugin, it, weights));
  return computeRatingAnalyticsFromProfiles(profiles, weights);
}

module.exports = {
  RATING_SOURCES,
  CORE_SITE_IDS,
  DISPLAY_SOURCE_IDS,
  COMPOSITE_WEIGHT_PRESETS,
  DEFAULT_WEIGHTS,
  getAnimeRatingCacheKey,
  ensureMultiSiteCache,
  getPreferredRatingSource,
  setPreferredRatingSource,
  getCompositeWeights,
  setCompositeWeights,
  getCachedMultiSiteRecord,
  fetchAniListRating,
  fetchMalRating,
  fetchFilmarksRating,
  fetchMultiSiteRatingForItem,
  applyManualSiteBinding,
  getMultiSiteSyncStatus,
  subscribeMultiSiteSync,
  cancelMultiSiteSync,
  startBatchMultiSiteSync,
  formatSiteNativeScore,
  computeAnimeCrossSiteProfile,
  getPreferredDisplayRating,
  getItemSeasonInfo,
  collectRatingFilterFacets,
  filterRatingProfiles,
  computeRatingAnalyticsFromProfiles,
  computeLibraryRatingAnalytics
};
