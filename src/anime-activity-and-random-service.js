const { Notice } = require("obsidian");
const { isMobileEnv, isDesktopNodeAvailable, tryRequireNode } = require("./platform-env.js");
const { openLocalPathSafely } = require("./note-utils.js");
const localMediaIndexService = require("./local-media-index-service.js");

const RANDOM_ANIME_SCOPES = [
  {
    id: "default_active",
    label: "推荐范围（在看 + 想看）",
    desc: "排除已抛弃作品，优先抽取本地已有片源或已填观看网址的下一集"
  },
  {
    id: "watching_only",
    label: "仅在看番剧 · 下一集",
    desc: "从当前正在追看的番剧中随机挑一部推进下一集"
  },
  {
    id: "local_ready",
    label: "本地已有未看集数",
    desc: "仅抽取电脑本地文件夹内已有未看视频文件的番剧",
    desktopOnly: true
  },
  {
    id: "wish_pilot",
    label: "想看列表 · 随机开荒第 1 集",
    desc: "从想看片单里随机抽一部试看第 1 集，治好选择困难"
  },
  {
    id: "high_score_rewatch",
    label: "高分佳作 · 随机重温一集",
    desc: "从已看完且评分 ≥ 8.0 的作品中随机抽一集重温名场面"
  }
];

function openWebUrlSafely(url) {
  if (!url) return false;
  try {
    if (isDesktopNodeAvailable()) {
      const electronMod = tryRequireNode("electron");
      if (electronMod && electronMod.shell && typeof electronMod.shell.openExternal === "function") {
        electronMod.shell.openExternal(url);
        return true;
      }
    }
  } catch (_) {}
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (_) {
    return false;
  }
}

function getEffectiveItemScore(item) {
  if (!item) return 0;
  if (Number.isFinite(item.personalScore) && item.personalScore > 0) return item.personalScore;
  if (Number.isFinite(item.preciseScore) && item.preciseScore > 0) return item.preciseScore;
  if (Number.isFinite(item.publicScore) && item.publicScore > 0) return item.publicScore;
  if (Number.isFinite(item.bangumiScore) && item.bangumiScore > 0) return item.bangumiScore;
  return 0;
}

function matchesOptionalTagFilter(item, tagFilter) {
  const cleanTag = String(tagFilter || "").trim().replace(/^#/, "").toLowerCase();
  if (!cleanTag) return true;
  const hay = [
    item && item.tags,
    item && item.animeType,
    item && item.studio
  ]
    .filter(Boolean)
    .join(" , ")
    .toLowerCase();
  return hay.includes(cleanTag);
}

function getRandomAnimeScopesForEnv() {
  const mobile = isMobileEnv();
  return RANDOM_ANIME_SCOPES.filter((s) => !(mobile && s.desktopOnly));
}

function filterPoolByRandomScope(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const scopeId = String(options.scopeId || "default_active");
  const tagFilter = String(options.tagFilter || "").trim();
  const allowedFilePaths = Array.isArray(options.allowedFilePaths) && options.allowedFilePaths.length > 0
    ? new Set(options.allowedFilePaths)
    : null;

  const candidates = [];
  for (const item of list) {
    if (!item || !item.name) continue;
    const filePath = item.file && item.file.path ? item.file.path : "";
    if (allowedFilePaths && filePath && !allowedFilePaths.has(filePath)) continue;
    if (!matchesOptionalTagFilter(item, tagFilter)) continue;

    const state = String(item.state || "").trim();
    if (state === "抛弃") continue;

    const totalEp = Number(item.totalEpisodes) || 0;
    const watchedEp = Number(item.watchedEpisodes) || 0;
    const score = getEffectiveItemScore(item);
    const resolvedLocal = !isMobileEnv()
      ? localMediaIndexService.resolveAnimeLocalMedia(options.plugin || null, item)
      : null;
    const localInfo = resolvedLocal && resolvedLocal.hasAnyBinding ? resolvedLocal : null;
    const hasLocalNext = Boolean(localInfo && !localInfo.error && localInfo.nextEpisodeFile);
    const hasAnyLocalVideo = Boolean(localInfo && !localInfo.error && Array.isArray(localInfo.videoFiles) && localInfo.videoFiles.length > 0);
    const hasWatchUrl = Boolean(item.watchUrl && /^https?:\/\//i.test(item.watchUrl));

    if (scopeId === "watching_only") {
      if (state !== "在看") continue;
      if (totalEp > 0 && watchedEp >= totalEp && !hasLocalNext) continue;
    } else if (scopeId === "local_ready") {
      if (!hasLocalNext) continue;
    } else if (scopeId === "wish_pilot") {
      if (state !== "想看") continue;
    } else if (scopeId === "high_score_rewatch") {
      if (state !== "已看") continue;
      if (score > 0 && score < 8.0) continue;
    } else {
      // default_active: 在看 + 想看（若全部为空则回退未抛弃且未看完的作品）
      if (state !== "在看" && state !== "想看") continue;
      if (state === "在看" && totalEp > 0 && watchedEp >= totalEp && !hasLocalNext) continue;
    }

    let weight = 10;
    if (hasLocalNext) weight += 18;
    else if (hasWatchUrl) weight += 10;
    if (state === "在看" && scopeId === "default_active") weight += 8;
    if (score >= 8.0) weight += 4;

    candidates.push({
      item,
      localInfo,
      hasLocalNext,
      hasAnyLocalVideo,
      hasWatchUrl,
      score,
      weight
    });
  }

  return candidates;
}

function pickRandomAnimeEpisode(plugin, items, options = {}) {
  const enrichedOptions = Object.assign({}, options, { plugin });
  let pool = filterPoolByRandomScope(items, enrichedOptions);
  const scopeId = String(options.scopeId || "default_active");

  // Graceful fallback if default_active has 0 watching/wish items in a vault where everything is 已看
  if (pool.length === 0 && scopeId === "default_active" && Array.isArray(items) && items.length > 0) {
    pool = filterPoolByRandomScope(items, Object.assign({}, enrichedOptions, { scopeId: "high_score_rewatch" }));
  }

  if (pool.length === 0) {
    return null;
  }

  if (!plugin._recentRandomAnimeHistory) {
    plugin._recentRandomAnimeHistory = [];
  }
  const recentSet = new Set(plugin._recentRandomAnimeHistory.slice(-Math.min(4, Math.max(1, pool.length - 1))));
  const filteredPool = pool.length > 1
    ? pool.filter((entry) => {
        const fp = entry.item.file && entry.item.file.path ? entry.item.file.path : entry.item.name;
        return !recentSet.has(fp);
      })
    : pool;
  const activePool = filteredPool.length > 0 ? filteredPool : pool;

  const totalWeight = activePool.reduce((sum, e) => sum + (e.weight || 1), 0);
  let roll = Math.random() * totalWeight;
  let chosen = activePool[activePool.length - 1];
  for (const entry of activePool) {
    roll -= (entry.weight || 1);
    if (roll <= 0) {
      chosen = entry;
      break;
    }
  }

  const item = chosen.item;
  const idKey = (item.file && item.file.path) ? item.file.path : item.name;
  plugin._recentRandomAnimeHistory.push(idKey);
  if (plugin._recentRandomAnimeHistory.length > 12) {
    plugin._recentRandomAnimeHistory.shift();
  }

  const totalEp = Number(item.totalEpisodes) || 0;
  const watchedEp = Number(item.watchedEpisodes) || 0;
  let targetEpisode = watchedEp + 1;
  let episodeFile = "";
  let launchType = "note";
  let launchLabel = "打开番剧卡片";

  if (scopeId === "high_score_rewatch") {
    if (chosen.hasAnyLocalVideo && chosen.localInfo.videoFiles.length > 0) {
      const randVf = chosen.localInfo.videoFiles[Math.floor(Math.random() * chosen.localInfo.videoFiles.length)];
      targetEpisode = randVf.episode || 1;
      episodeFile = randVf.path || "";
      launchType = "local_video";
      launchLabel = `本地播放第 ${targetEpisode} 集`;
    } else {
      const maxEp = totalEp > 0 ? totalEp : Math.max(1, watchedEp || 12);
      targetEpisode = Math.floor(Math.random() * maxEp) + 1;
      if (chosen.hasWatchUrl) {
        launchType = "watch_url";
        launchLabel = `网页重温第 ${targetEpisode} 集`;
      }
    }
  } else {
    if (chosen.hasLocalNext && chosen.localInfo) {
      targetEpisode = chosen.localInfo.nextEpisodeNumber || (watchedEp + 1);
      episodeFile = chosen.localInfo.nextEpisodeFile || "";
      launchType = "local_video";
      launchLabel = `本地播放第 ${targetEpisode} 集`;
    } else {
      targetEpisode = totalEp > 0 ? Math.min(totalEp, watchedEp + 1) : (watchedEp + 1);
      if (chosen.hasWatchUrl) {
        launchType = "watch_url";
        launchLabel = `打开观看网页（第 ${targetEpisode} 集）`;
      } else if (item.bgmUrl) {
        launchType = "bgm_url";
        launchLabel = `查看词条 / 打开笔记（第 ${targetEpisode} 集）`;
      }
    }
  }

  return {
    item,
    scopeId,
    poolCount: pool.length,
    targetEpisode,
    totalEpisodes: totalEp,
    watchedEpisodes: watchedEp,
    episodeFile,
    watchUrl: item.watchUrl || "",
    bgmUrl: item.bgmUrl || "",
    launchType,
    launchLabel,
    score: chosen.score
  };
}

async function launchPickedAnimeEpisode(plugin, pickResult) {
  if (!pickResult || !pickResult.item) return false;
  const item = pickResult.item;

  if (pickResult.episodeFile && !isMobileEnv()) {
    const ok = await openLocalPathSafely(pickResult.episodeFile);
    if (ok) {
      new Notice(`正在播放《${item.name}》第 ${pickResult.targetEpisode} 集`);
      return true;
    }
  }

  if (pickResult.watchUrl && /^https?:\/\//i.test(pickResult.watchUrl)) {
    openWebUrlSafely(pickResult.watchUrl);
    const isSubjectPage = /(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\//i.test(pickResult.watchUrl);
    new Notice(
      isSubjectPage
        ? `已打开《${item.name}》Bangumi 条目页`
        : `已打开《${item.name}》观看网页（建议观看第 ${pickResult.targetEpisode} 集）`
    );
    return true;
  }

  if (item.file && plugin && plugin.app && plugin.app.workspace) {
    const leaf = plugin.app.workspace.getLeaf(false);
    await leaf.openFile(item.file);
    return true;
  }
  return false;
}

function parseLooseTimestampMs(raw) {
  if (!raw) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const str = String(raw).trim();
  if (!str) return 0;
  const direct = Date.parse(str.replace(/\./g, "-").replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, ""));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const ymd = str.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (ymd) {
    const dt = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 20, 0, 0);
    return dt.getTime();
  }
  return 0;
}

async function recordAnimeActivity(plugin, payload = {}) {
  if (!plugin || !plugin.settings) return null;
  if (!Array.isArray(plugin.settings.animeActivityLog)) {
    plugin.settings.animeActivityLog = [];
  }
  const now = Date.now();
  const entry = {
    id: `act_${now}_${Math.random().toString(36).slice(2, 7)}`,
    type: String(payload.type || "episode"),
    animeName: String(payload.animeName || "").trim(),
    filePath: String(payload.filePath || "").trim(),
    cover: String(payload.cover || "").trim(),
    detail: String(payload.detail || "").trim(),
    episode: Number.isFinite(Number(payload.episode)) ? Number(payload.episode) : null,
    score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
    status: String(payload.status || "").trim(),
    timestamp: Number(payload.timestamp) || now
  };
  if (!entry.animeName) return null;

  // Coalesce rapid consecutive edits on the exact same anime + type within 90 seconds
  const top = plugin.settings.animeActivityLog[0];
  if (
    top &&
    top.type === entry.type &&
    ((top.filePath && top.filePath === entry.filePath) || top.animeName === entry.animeName) &&
    Math.abs(now - (Number(top.timestamp) || 0)) < 90000
  ) {
    Object.assign(top, entry, { id: top.id, timestamp: now });
  } else {
    plugin.settings.animeActivityLog.unshift(entry);
  }

  if (plugin.settings.animeActivityLog.length > 420) {
    plugin.settings.animeActivityLog.length = 420;
  }
  if (typeof plugin.saveSettings === "function") {
    try {
      await plugin.saveSettings();
    } catch (_) {}
  }
  return entry;
}

function buildMergedAnimeActivityFeed(plugin, items, maxCount = 80) {
  const explicitLog = (plugin && plugin.settings && Array.isArray(plugin.settings.animeActivityLog))
    ? plugin.settings.animeActivityLog
    : [];
  const itemByPath = new Map();
  const itemByName = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    if (item.file && item.file.path) itemByPath.set(item.file.path, item);
    if (item.name) itemByName.set(item.name, item);
  }

  const merged = [];
  const seenKeys = new Set();

  for (const ev of explicitLog) {
    if (!ev || !ev.animeName) continue;
    const matchedItem = (ev.filePath && itemByPath.get(ev.filePath)) || itemByName.get(ev.animeName) || null;
    const ts = Number(ev.timestamp) || 0;
    const dayBucket = ts ? new Date(ts).toISOString().slice(0, 10) : "";
    seenKeys.add(`${ev.type}|${ev.filePath || ev.animeName}|${dayBucket}`);
    merged.push({
      id: ev.id || `ev_${ts}`,
      type: ev.type || "episode",
      animeName: ev.animeName,
      filePath: ev.filePath || (matchedItem && matchedItem.file ? matchedItem.file.path : ""),
      cover: (matchedItem && matchedItem.cover) || ev.cover || "",
      detail: ev.detail || "",
      episode: ev.episode,
      score: ev.score,
      status: ev.status || (matchedItem ? matchedItem.state : ""),
      timestamp: ts,
      synthetic: false
    });
  }

  // Synthesize historical footprints from existing notes & reviews so users immediately see rich history
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.name) continue;
    const fp = item.file && item.file.path ? item.file.path : "";

    // 1) Reviews inside note
    if (Array.isArray(item.reviews)) {
      for (const rev of item.reviews) {
        if (!rev || !rev.content) continue;
        const rTs = parseLooseTimestampMs(rev.createdAt || rev.updatedAt) || (item.file && item.file.stat ? item.file.stat.mtime : 0);
        if (!rTs) continue;
        const dayBucket = new Date(rTs).toISOString().slice(0, 10);
        const dedupKey = `review|${fp || item.name}|${dayBucket}|${String(rev.scope || "")}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);
        const snippet = String(rev.content || "").replace(/\s+/g, " ").trim().slice(0, 38);
        merged.push({
          id: `syn_rev_${fp}_${rTs}_${rev.id || ""}`,
          type: "review",
          animeName: item.name,
          filePath: fp,
          cover: item.cover || "",
          detail: `${rev.scope ? `[${rev.scope}] ` : ""}写下手札：${snippet}${snippet.length >= 38 ? "…" : ""}`,
          episode: null,
          score: item.personalScore,
          status: item.state || "",
          timestamp: rTs,
          synthetic: true
        });
      }
    }

    // 2) Note record date / recent watch state
    const recTs =
      parseLooseTimestampMs(item.recordDate) ||
      (item.file && item.file.stat ? (item.file.stat.mtime || item.file.stat.ctime) : 0);
    if (recTs > 0) {
      const dayBucket = new Date(recTs).toISOString().slice(0, 10);
      const inferredType =
        item.state === "已看"
          ? "status"
          : (Number(item.watchedEpisodes) > 0 ? "episode" : "import");
      const dedupKey = `${inferredType}|${fp || item.name}|${dayBucket}`;
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        let detail = "收录至番剧档案馆";
        if (item.state === "已看") {
          detail = item.personalScore
            ? `标记为已看 · 个人评分 ${item.personalScore}`
            : "标记为已看";
        } else if (item.state === "在看" && Number(item.watchedEpisodes) > 0) {
          detail = `看到第 ${item.watchedEpisodes} 集`;
        } else if (item.state === "想看") {
          detail = "加入想看片单";
        }
        merged.push({
          id: `syn_note_${fp}_${recTs}`,
          type: inferredType,
          animeName: item.name,
          filePath: fp,
          cover: item.cover || "",
          detail,
          episode: Number(item.watchedEpisodes) || null,
          score: item.personalScore,
          status: item.state || "",
          timestamp: recTs,
          synthetic: true
        });
      }
    }
  }

  merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return merged.slice(0, maxCount);
}

function computeAnimeWatchRhythm(feed, items) {
  const list = Array.isArray(feed) ? feed : [];
  const now = Date.now();
  const dayMs = 86400000;

  let active7d = 0;
  let active30d = 0;
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
  const recent14Days = [];
  const dayMap = new Map();

  for (let i = 13; i >= 0; i--) {
    const dt = new Date(now - i * dayMs);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
    const bucket = { key, label, count: 0 };
    recent14Days.push(bucket);
    dayMap.set(key, bucket);
  }

  const realHourBuckets = { morning: 0, afternoon: 0, evening: 0, lateNight: 0, total: 0 };

  for (const ev of list) {
    const ts = Number(ev.timestamp) || 0;
    if (!ts) continue;
    const diff = now - ts;
    if (diff >= 0 && diff <= 7 * dayMs) active7d += 1;
    if (diff >= 0 && diff <= 30 * dayMs) active30d += 1;

    const d = new Date(ts);
    weekdayCounts[d.getDay()] += 1;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dayMap.has(key)) {
      dayMap.get(key).count += 1;
    }

    if (!ev.synthetic) {
      const h = d.getHours();
      realHourBuckets.total += 1;
      if (h >= 22 || h < 4) realHourBuckets.lateNight += 1;
      else if (h >= 18) realHourBuckets.evening += 1;
      else if (h >= 12) realHourBuckets.afternoon += 1;
      else realHourBuckets.morning += 1;
    }
  }

  const weekendSum = weekdayCounts[0] + weekdayCounts[6];
  const weekdaySum = weekdayCounts[1] + weekdayCounts[2] + weekdayCounts[3] + weekdayCounts[4] + weekdayCounts[5];
  let habitSummary = "均衡追番节奏";
  if (weekendSum + weekdaySum >= 4) {
    const weekendRatio = weekendSum / (weekendSum + weekdaySum);
    if (weekendRatio >= 0.45) {
      habitSummary = "周末集中补番型";
    } else if (weekendRatio <= 0.2) {
      habitSummary = "工作日稳定追更型";
    } else {
      habitSummary = "日常随心追番型";
    }
  }

  let peakSlotLabel = "";
  if (realHourBuckets.total >= 3) {
    const entries = [
      ["深夜档 (22:00-03:00)", realHourBuckets.lateNight],
      ["晚间档 (18:00-22:00)", realHourBuckets.evening],
      ["午后档 (12:00-18:00)", realHourBuckets.afternoon],
      ["晨间档 (05:00-12:00)", realHourBuckets.morning]
    ].sort((a, b) => b[1] - a[1]);
    if (entries[0][1] > 0) peakSlotLabel = entries[0][0];
  }

  const watchingCount = (Array.isArray(items) ? items : []).filter((i) => i && i.state === "在看").length;
  const completedCount = (Array.isArray(items) ? items : []).filter((i) => i && i.state === "已看").length;

  return {
    active7d,
    active30d,
    watchingCount,
    completedCount,
    habitSummary,
    peakSlotLabel,
    weekdayCounts,
    recent14Days
  };
}

function formatRelativeActivityTime(ts) {
  const num = Number(ts) || 0;
  if (!num) return "";
  const diffSec = Math.floor((Date.now() - num) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  const d = new Date(num);
  const now = new Date();
  if (diffSec < 172800 && now.getDate() !== d.getDate()) return "昨天";
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = {
  RANDOM_ANIME_SCOPES,
  getRandomAnimeScopesForEnv,
  filterPoolByRandomScope,
  pickRandomAnimeEpisode,
  launchPickedAnimeEpisode,
  recordAnimeActivity,
  buildMergedAnimeActivityFeed,
  computeAnimeWatchRhythm,
  formatRelativeActivityTime
};
