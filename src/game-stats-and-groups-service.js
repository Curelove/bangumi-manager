const COVER_ASPECT_PRESETS = [
  { id: "default", label: "默认统一比例", ratio: null, cssRatio: "3 / 4" },
  { id: "2:3", label: "2:3 竖版盒封", ratio: 2 / 3, cssRatio: "2 / 3" },
  { id: "3:4", label: "3:4 经典竖封", ratio: 3 / 4, cssRatio: "3 / 4" },
  { id: "1:1", label: "1:1 方形封面", ratio: 1, cssRatio: "1 / 1" },
  { id: "4:3", label: "4:3 复古横封", ratio: 4 / 3, cssRatio: "4 / 3" },
  { id: "16:9", label: "16:9 宽屏横幅", ratio: 16 / 9, cssRatio: "16 / 9" },
  { id: "460:215", label: "Steam 横版宣传图", ratio: 460 / 215, cssRatio: "460 / 215" },
  { id: "custom", label: "自由微调比例", ratio: null, cssRatio: "" }
];

const COVER_FIT_MODES = [
  { id: "cover", label: "自动裁切铺满" },
  { id: "contain-blur", label: "完整展示 + 柔光补边" }
];

const GAME_SORT_OPTIONS = [
  { id: "recent_first", label: "最近活跃优先" },
  { id: "playHours_desc", label: "游玩时长从高到低" },
  { id: "score_desc", label: "个人评分从高到低" },
  { id: "createdAt_desc", label: "最新收录优先" },
  { id: "title_asc", label: "名称拼音 / 字母排序" }
];

function getGameCoverPresentation(game) {
  const aspectId = String((game && game.coverAspect) || "default").trim();
  const fitMode = String((game && game.coverFit) || "cover").trim() === "contain-blur"
    ? "contain-blur"
    : "cover";
  const focalY = Number.isFinite(Number(game && game.coverFocalY))
    ? Math.max(0, Math.min(100, Number(game.coverFocalY)))
    : 35;

  if (aspectId === "custom") {
    const customNum = Number(game && game.coverCustomRatio);
    const validRatio = Number.isFinite(customNum) && customNum >= 0.45 && customNum <= 2.8 ? customNum : 0.75;
    return {
      isCustom: true,
      aspectId: "custom",
      cssAspectRatio: `${validRatio.toFixed(3)} / 1`,
      numericRatio: validRatio,
      fitMode,
      focalY
    };
  }

  const preset = COVER_ASPECT_PRESETS.find((p) => p.id === aspectId) || COVER_ASPECT_PRESETS[0];
  return {
    isCustom: preset.id !== "default",
    aspectId: preset.id,
    cssAspectRatio: preset.cssRatio || "3 / 4",
    numericRatio: preset.ratio || 0.75,
    fitMode,
    focalY
  };
}

function resetSingleGameCoverAspect(game) {
  if (!game || typeof game !== "object") return;
  delete game.coverAspect;
  delete game.coverCustomRatio;
  delete game.coverFit;
  delete game.coverFocalY;
}

async function resetAllGamesCoverAspect(plugin) {
  const games = Array.isArray(plugin && plugin.settings && plugin.settings.gameCollection)
    ? plugin.settings.gameCollection
    : [];
  let count = 0;
  for (const gm of games) {
    if (gm && (gm.coverAspect || gm.coverFit || gm.coverCustomRatio !== undefined || gm.coverFocalY !== undefined)) {
      resetSingleGameCoverAspect(gm);
      count += 1;
    }
  }
  if (count > 0 && plugin && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return count;
}

function ensureGameGroupsSettings(plugin) {
  if (!plugin || !plugin.settings) return [];
  if (!Array.isArray(plugin.settings.gameCustomGroups)) {
    plugin.settings.gameCustomGroups = [];
  }
  return plugin.settings.gameCustomGroups;
}

async function createGameCustomGroup(plugin, name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  const groups = ensureGameGroupsSettings(plugin);
  const existing = groups.find((g) => g && g.name === cleanName);
  if (existing) return existing;
  const group = {
    id: `ggrp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    gameIds: [],
    createdAt: new Date().toISOString()
  };
  groups.push(group);
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return group;
}

async function renameGameCustomGroup(plugin, groupId, nextName) {
  const cleanName = String(nextName || "").trim();
  if (!cleanName) return false;
  const groups = ensureGameGroupsSettings(plugin);
  const target = groups.find((g) => g && g.id === groupId);
  if (!target) return false;
  target.name = cleanName;
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return true;
}

async function deleteGameCustomGroup(plugin, groupId) {
  const groups = ensureGameGroupsSettings(plugin);
  const before = groups.length;
  plugin.settings.gameCustomGroups = groups.filter((g) => g && g.id !== groupId);
  if (plugin.settings.gameCustomGroups.length !== before && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
    return true;
  }
  return false;
}

async function toggleGameInCustomGroup(plugin, groupId, gameId) {
  const groups = ensureGameGroupsSettings(plugin);
  const grp = groups.find((g) => g && g.id === groupId);
  if (!grp || !gameId) return false;
  if (!Array.isArray(grp.gameIds)) grp.gameIds = [];
  const idx = grp.gameIds.indexOf(gameId);
  let added = false;
  if (idx >= 0) {
    grp.gameIds.splice(idx, 1);
  } else {
    grp.gameIds.push(gameId);
    added = true;
  }
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return added;
}

async function moveGameWithinCustomGroup(plugin, groupId, gameId, delta) {
  const groups = ensureGameGroupsSettings(plugin);
  const grp = groups.find((g) => g && g.id === groupId);
  if (!grp || !Array.isArray(grp.gameIds)) return false;
  const idx = grp.gameIds.indexOf(gameId);
  if (idx < 0) return false;
  const targetIdx = idx + (delta < 0 ? -1 : 1);
  if (targetIdx < 0 || targetIdx >= grp.gameIds.length) return false;
  const [moved] = grp.gameIds.splice(idx, 1);
  grp.gameIds.splice(targetIdx, 0, moved);
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return true;
}

function buildDeveloperAutoGroups(games) {
  const map = new Map();
  for (const gm of Array.isArray(games) ? games : []) {
    if (!gm) continue;
    const rawDev = String(gm.developer || "").trim();
    if (!rawDev) continue;
    const primaryDev = rawDev.split(/[\/、,，]/)[0].trim();
    if (!primaryDev) continue;
    if (!map.has(primaryDev)) {
      map.set(primaryDev, []);
    }
    map.get(primaryDev).push(gm.id);
  }
  return Array.from(map.entries())
    .map(([developer, gameIds]) => ({
      id: `dev:${developer}`,
      developer,
      name: developer,
      count: gameIds.length,
      gameIds
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function parseTs(val) {
  if (!val) return 0;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const t = Date.parse(String(val));
  return Number.isFinite(t) ? t : 0;
}

function getGameLastActiveTimestamp(game) {
  if (!game) return 0;
  let best = Math.max(parseTs(game.lastPlayedAt), parseTs(game.createdAt));
  if (Array.isArray(game.playSessions)) {
    for (const s of game.playSessions) {
      const st = parseTs(s && (s.endedAt || s.startedAt));
      if (st > best) best = st;
    }
  }
  if (Array.isArray(game.playNotes)) {
    for (const n of game.playNotes) {
      const nt = parseTs(n && n.createdAt);
      if (nt > best) best = nt;
    }
  }
  return best;
}

function filterAndSortGames(plugin, games, filterState = {}) {
  const all = Array.isArray(games) ? games : [];
  const q = String(filterState.searchQuery || "").trim().toLowerCase();
  const statusFilter = String(filterState.statusFilter || "all");
  const sourceFilter = String(filterState.sourceFilter || "all");
  const groupFilter = String(filterState.groupFilter || "all");
  const sortBy = String(filterState.sortBy || "recent_first");

  let customOrderMap = null;
  let allowedIds = null;

  if (groupFilter.startsWith("custom:")) {
    const gid = groupFilter.slice("custom:".length);
    const grp = ensureGameGroupsSettings(plugin).find((g) => g && g.id === gid);
    const ids = grp && Array.isArray(grp.gameIds) ? grp.gameIds : [];
    allowedIds = new Set(ids);
    customOrderMap = new Map(ids.map((id, idx) => [id, idx]));
  } else if (groupFilter.startsWith("dev:")) {
    const devName = groupFilter.slice("dev:".length).toLowerCase();
    allowedIds = new Set(
      all
        .filter((g) => g && String(g.developer || "").toLowerCase().includes(devName))
        .map((g) => g.id)
    );
  }

  const filtered = all.filter((gm) => {
    if (!gm) return false;
    if (allowedIds && !allowedIds.has(gm.id)) return false;
    if (statusFilter !== "all" && (gm.status || "在玩") !== statusFilter) return false;
    if (sourceFilter !== "all") {
      const src = String(gm.metadataSource || (gm.bgmSubjectId ? "bangumi" : "local")).toLowerCase();
      if (src !== sourceFilter) return false;
    }
    if (q) {
      const tagsStr = Array.isArray(gm.tags) ? gm.tags.join(" ") : String(gm.tags || "");
      const hay = [gm.title, gm.originalTitle, gm.developer, gm.currentProgress, gm.status, tagsStr]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (customOrderMap && (sortBy === "group_manual" || !filterState.explicitSortChanged)) {
    filtered.sort((a, b) => {
      const ia = customOrderMap.has(a.id) ? customOrderMap.get(a.id) : 99999;
      const ib = customOrderMap.has(b.id) ? customOrderMap.get(b.id) : 99999;
      return ia - ib;
    });
    return filtered;
  }

  filtered.sort((a, b) => {
    if (sortBy === "playHours_desc") {
      const diff = (Number(b.playHours) || 0) - (Number(a.playHours) || 0);
      if (diff !== 0) return diff;
    } else if (sortBy === "score_desc") {
      const diff = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (diff !== 0) return diff;
    } else if (sortBy === "createdAt_desc") {
      const diff = parseTs(b.createdAt) - parseTs(a.createdAt);
      if (diff !== 0) return diff;
    } else if (sortBy === "title_asc") {
      return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
    } else {
      const diff = getGameLastActiveTimestamp(b) - getGameLastActiveTimestamp(a);
      if (diff !== 0) return diff;
    }
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });

  return filtered;
}

function recordGameSessionInternal(game, session) {
  if (!game || typeof game !== "object") return null;
  if (!Array.isArray(game.playSessions)) {
    game.playSessions = [];
  }
  const dur = Math.max(0.02, Number(Number(session.durationHours || 0).toFixed(2)));
  const entry = {
    id: `gsess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt: session.startedAt || new Date(Date.now() - dur * 3600000).toISOString(),
    endedAt: session.endedAt || new Date().toISOString(),
    durationHours: dur,
    mode: session.mode || "auto",
    note: String(session.note || "").trim()
  };
  game.playSessions.unshift(entry);
  if (game.playSessions.length > 360) {
    game.playSessions.length = 360;
  }
  game.playHours = Number(((Number(game.playHours) || 0) + dur).toFixed(2));
  if (entry.mode !== "backfill_legacy") {
    game.lastPlayedAt = entry.endedAt;
  }
  if (!game.firstPlayedAt) {
    game.firstPlayedAt = entry.startedAt;
  }
  return entry;
}

function startActiveGameTimer(plugin, game) {
  if (!plugin || !game || !game.id) return null;
  if (!plugin._activeGameTimers) {
    plugin._activeGameTimers = new Map();
  }
  if (plugin._activeGameTimers.has(game.id)) {
    return plugin._activeGameTimers.get(game.id);
  }
  const state = {
    gameId: game.id,
    title: game.title,
    startedAtMs: Date.now(),
    startedAtIso: new Date().toISOString()
  };
  plugin._activeGameTimers.set(game.id, state);
  try {
    const capSvc = require("./game-floating-capsule-service.js");
    capSvc.activateGameSideCapsule(plugin, game, { source: "internal" });
  } catch (_) {}
  return state;
}

function getActiveGameTimer(plugin, gameId) {
  if (!plugin || !plugin._activeGameTimers || !gameId) return null;
  return plugin._activeGameTimers.get(gameId) || null;
}

async function stopActiveGameTimer(plugin, game, syncCallback) {
  if (!plugin || !game || !plugin._activeGameTimers) return null;
  const active = plugin._activeGameTimers.get(game.id);
  if (!active) return null;
  plugin._activeGameTimers.delete(game.id);
  try {
    const capSvc = require("./game-floating-capsule-service.js");
    capSvc.deactivateGameSideCapsule(plugin, game.id);
  } catch (_) {}
  const elapsedHours = Math.max(0.05, (Date.now() - active.startedAtMs) / 3600000);
  const entry = recordGameSessionInternal(game, {
    startedAt: active.startedAtIso,
    endedAt: new Date().toISOString(),
    durationHours: elapsedHours,
    mode: "timer",
    note: "手动 / Steam 计时结算"
  });
  if (typeof syncCallback === "function") {
    await syncCallback(plugin, game);
  }
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return entry;
}

async function addManualGameHoursBackfill(plugin, game, { hours, dateStr, note = "" }, syncCallback) {
  const numHours = Number(hours);
  if (!game || !Number.isFinite(numHours) || numHours <= 0) return null;
  let targetEnd = new Date();
  if (dateStr) {
    const parsed = Date.parse(dateStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      targetEnd = new Date(parsed);
    }
  }
  const startMs = targetEnd.getTime() - numHours * 3600000;
  const entry = recordGameSessionInternal(game, {
    startedAt: new Date(startMs).toISOString(),
    endedAt: targetEnd.toISOString(),
    durationHours: numHours,
    mode: "manual",
    note: note || "手动补录时长"
  });
  if (typeof syncCallback === "function") {
    await syncCallback(plugin, game);
  }
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return entry;
}

function computeGamePlayStats(game) {
  const sessions = Array.isArray(game && game.playSessions) ? game.playSessions : [];
  const totalScalar = Number((game && game.playHours) || 0);
  const sessionSum = sessions.reduce((s, item) => s + (Number(item && item.durationHours) || 0), 0);
  const totalHours = Number(Math.max(totalScalar, sessionSum).toFixed(2));
  const unloggedLegacyHours = Number(Math.max(0, totalHours - sessionSum).toFixed(2));

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  const startOfWeek = startOfToday - dayOfWeek * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let todayHours = 0;
  let weekHours = 0;
  let monthHours = 0;
  let earliestTs = parseTs(game && game.firstPlayedAt);
  let latestTs = parseTs(game && game.lastPlayedAt);

  const dailyBuckets = [];
  const dailyMap = new Map();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bucket = { key, label: `${d.getMonth() + 1}/${d.getDate()}`, hours: 0 };
    dailyBuckets.push(bucket);
    dailyMap.set(key, bucket);
  }

  const monthlyBuckets = [];
  const monthlyMap = new Map();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = { key, label: `${d.getMonth() + 1}月`, hours: 0 };
    monthlyBuckets.push(bucket);
    monthlyMap.set(key, bucket);
  }

  for (const s of sessions) {
    if (!s) continue;
    const dur = Number(s.durationHours) || 0;
    const endTs = parseTs(s.endedAt || s.startedAt);
    const startTs = parseTs(s.startedAt) || endTs;
    if (!endTs) continue;
    if (!earliestTs || (startTs > 0 && startTs < earliestTs)) earliestTs = startTs;
    if (!latestTs || endTs > latestTs) latestTs = endTs;

    if (endTs >= startOfToday) todayHours += dur;
    if (endTs >= startOfWeek) weekHours += dur;
    if (endTs >= startOfMonth) monthHours += dur;

    const d = new Date(endTs);
    const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dailyMap.has(dKey)) {
      dailyMap.get(dKey).hours = Number((dailyMap.get(dKey).hours + dur).toFixed(2));
    }
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap.has(mKey)) {
      monthlyMap.get(mKey).hours = Number((monthlyMap.get(mKey).hours + dur).toFixed(2));
    }
  }

  const sessionCount = sessions.length || (totalHours > 0 ? 1 : 0);
  const avgSessionHours = sessionCount > 0 ? Number((totalHours / sessionCount).toFixed(1)) : 0;

  return {
    totalHours,
    todayHours: Number(todayHours.toFixed(2)),
    weekHours: Number(weekHours.toFixed(2)),
    monthHours: Number(monthHours.toFixed(2)),
    unloggedLegacyHours,
    sessionCount,
    avgSessionHours,
    firstPlayedAt: earliestTs ? new Date(earliestTs).toISOString() : "",
    lastPlayedAt: latestTs ? new Date(latestTs).toISOString() : "",
    dailySeries7d: dailyBuckets,
    monthlySeries6m: monthlyBuckets,
    recentSessions: sessions.slice(0, 20)
  };
}

function pickRandomGame(plugin, games, options = {}) {
  const all = Array.isArray(games) ? games : [];
  const scope = String(options.scope || "active"); // active (在玩+想玩) | playing | wish | all
  let pool = all.filter((gm) => {
    if (!gm || !gm.title) return false;
    const st = gm.status || "在玩";
    if (scope === "playing") return st === "在玩";
    if (scope === "wish") return st === "想玩";
    if (scope === "all") return st !== "搁置";
    return st === "在玩" || st === "想玩";
  });
  if (pool.length === 0 && scope === "active") {
    pool = all.filter((gm) => gm && gm.title && gm.status !== "搁置");
  }
  if (pool.length === 0) return null;

  if (!plugin._recentRandomGameIds) {
    plugin._recentRandomGameIds = [];
  }
  const recent = new Set(plugin._recentRandomGameIds.slice(-Math.min(3, Math.max(1, pool.length - 1))));
  const candidates = pool.length > 1 ? pool.filter((g) => !recent.has(g.id)) : pool;
  const active = candidates.length > 0 ? candidates : pool;
  const chosen = active[Math.floor(Math.random() * active.length)];
  if (chosen && chosen.id) {
    plugin._recentRandomGameIds.push(chosen.id);
    if (plugin._recentRandomGameIds.length > 10) plugin._recentRandomGameIds.shift();
  }
  return {
    game: chosen,
    poolCount: pool.length,
    scope
  };
}

function buildGameActivityFeed(games, maxCount = 50) {
  const feed = [];
  for (const gm of Array.isArray(games) ? games : []) {
    if (!gm || !gm.title) continue;

    if (Array.isArray(gm.playSessions)) {
      for (const s of gm.playSessions) {
        const ts = parseTs(s && (s.endedAt || s.startedAt));
        if (!ts) continue;
        feed.push({
          id: s.id || `gs_${gm.id}_${ts}`,
          gameId: gm.id,
          gameTitle: gm.title,
          coverUrl: gm.coverUrl || "",
          type: s.mode === "manual" ? "backfill" : "session",
          detail: s.mode === "manual"
            ? `补录游玩时长 +${Number(s.durationHours || 0).toFixed(1)}h${s.note ? ` · ${s.note}` : ""}`
            : `游玩了 ${Number(s.durationHours || 0).toFixed(1)} 小时`,
          timestamp: ts
        });
      }
    }

    if (Array.isArray(gm.playNotes)) {
      for (const n of gm.playNotes) {
        if (!n || !n.text) continue;
        const ts = parseTs(n.createdAt);
        if (!ts) continue;
        const snippet = String(n.text).replace(/\s+/g, " ").trim().slice(0, 36);
        feed.push({
          id: `gn_${gm.id}_${ts}`,
          gameId: gm.id,
          gameTitle: gm.title,
          coverUrl: gm.coverUrl || "",
          type: "note",
          detail: `记下手札：${snippet}${snippet.length >= 36 ? "…" : ""}`,
          timestamp: ts
        });
      }
    }

    const createdTs = parseTs(gm.createdAt);
    if (createdTs) {
      feed.push({
        id: `gc_${gm.id}_${createdTs}`,
        gameId: gm.id,
        gameTitle: gm.title,
        coverUrl: gm.coverUrl || "",
        type: "added",
        detail: `收入游戏典藏 · ${gm.status || "在玩"}`,
        timestamp: createdTs
      });
    }
  }

  feed.sort((a, b) => b.timestamp - a.timestamp);
  return feed.slice(0, maxCount);
}

module.exports = {
  COVER_ASPECT_PRESETS,
  COVER_FIT_MODES,
  GAME_SORT_OPTIONS,
  getGameCoverPresentation,
  resetSingleGameCoverAspect,
  resetAllGamesCoverAspect,
  ensureGameGroupsSettings,
  createGameCustomGroup,
  renameGameCustomGroup,
  deleteGameCustomGroup,
  toggleGameInCustomGroup,
  moveGameWithinCustomGroup,
  buildDeveloperAutoGroups,
  filterAndSortGames,
  recordGameSessionInternal,
  startActiveGameTimer,
  getActiveGameTimer,
  stopActiveGameTimer,
  finishActiveGameTimer: stopActiveGameTimer,
  addManualGameHoursBackfill,
  computeGamePlayStats,
  pickRandomGame,
  buildGameActivityFeed
};
