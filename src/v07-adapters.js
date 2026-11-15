/**
 * v0.7 视觉层 · 统一数据适配器（把插件后端服务接入 v0.7 界面的 ctx）
 * ---------------------------------------------------------------
 * 跨端约束：本模块零裸调 Node 模块；平台判断统一走 ./platform-env.js。
 */
const { Notice } = require("obsidian");
const { isMobileEnv } = require("./platform-env.js");
const {
  inspectLocalFolder,
  openLocalPathSafely,
  classifyWatchUrl,
  normalizeReviewEntry,
  extractLeadingTimestampFromText
} = require("./note-utils.js");
const { deriveAnimeEventsFromItems, deriveGameEvents } = require("./v07-history.js");
const { normalizeAppearance } = require("./v07-themes.js");
const { dayKey, toDate } = require("./v07-core.js");
const bilibiliLiveService = require("./bilibili-live-service.js");
const animeActivityService = require("./anime-activity-and-random-service.js");
const animeDownloadService = require("./anime-download-service.js");
const reviewStudioService = require("./review-studio-service.js");
const seasonalRadarService = require("./seasonal-radar-service.js");
const gameMultisourceApi = require("./game-multisource-api.js");
const gameStatsService = require("./game-stats-and-groups-service.js");

function getAppearance(plugin) {
  const s = (plugin && plugin.settings) || {};
  let raw = s.archiveAppearance;
  if (!raw && s.archiveVisualTheme && s.archiveVisualTheme !== "obsidian") {
    raw = {
      theme: s.archiveVisualTheme,
      motion: s.archiveDynamicThemeMotion !== false,
      roxyArt: true
    };
  }
  return normalizeAppearance(raw);
}

async function saveAppearance(plugin, next) {
  if (!plugin || !plugin.settings) return;
  const norm = normalizeAppearance(next);
  plugin.settings.archiveAppearance = norm;
  plugin.settings.archiveVisualTheme = norm.theme === "follow" ? "obsidian" : norm.theme;
  plugin.settings.archiveDynamicThemeMotion = norm.motion !== false;
  await plugin.saveSettings();
}

function itemKey(it) {
  return it.subjectId ? String(it.subjectId) : (it.file && it.file.path) || it.name;
}

function openExternal(url) {
  if (!url) return;
  bilibiliLiveService.openExternalUrlSafely(url);
}

async function openNoteFile(plugin, file) {
  if (!file || !plugin.app || !plugin.app.workspace) return;
  const leaf = plugin.app.workspace.getLeaf(false);
  await leaf.openFile(file);
}

/* ============================== 直播间服务桥接 ============================== */

function normalizeLiveTimeValue(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "0" || s === "0000-00-00 00:00:00") return "";
  if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,14}$/.test(s)) return Number(s);
  return s;
}

function createLiveRoomProvider(plugin) {
  const mapRooms = () => {
    const list = bilibiliLiveService.getLiveRoomsWithStatus(plugin) || [];
    return list.map((r) => ({
      roomId: String(r.roomId || ""),
      uid: String(r.uid || ""),
      name: r.name || `房间 ${r.roomId}`,
      face: r.avatar || "",
      status: Number(r.liveStatus) || 0,
      title: r.title || "",
      online: Number(r.online) || 0,
      areaName: r.areaName || r.note || "",
      keyframe: r.keyframe || r.cover || "",
      liveTime: normalizeLiveTimeValue(r.liveTime),
      url: r.webUrl || bilibiliLiveService.getLiveRoomWebUrl(r.roomId)
    }));
  };

  return {
    getRooms: mapRooms,
    getSettings: () => {
      const cfg = bilibiliLiveService.ensureBilibiliLiveSettings(plugin);
      const store = (plugin && plugin._biliLiveServiceState) || {};
      return {
        monitor: cfg.monitorEnabled,
        notify: cfg.systemNotifyEnabled,
        lastCheckedAt: store.lastRefreshedAt || 0
      };
    },
    refresh: async () => {
      await bilibiliLiveService.refreshBilibiliLiveRooms(plugin, { allowNotify: true });
      return mapRooms();
    },
    addRoom: async (input) => {
      try {
        await bilibiliLiveService.addBilibiliLiveRoom(plugin, input);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) ? err.message : "添加失败，请检查房间号或网络连接"
        };
      }
    },
    removeRoom: async (roomId) => {
      await bilibiliLiveService.removeBilibiliLiveRoom(plugin, roomId);
    },
    setSetting: async (key, value) => {
      if (!plugin || !plugin.settings) return;
      if (key === "monitor") {
        plugin.settings.bilibiliLiveMonitorEnabled = Boolean(value);
        await plugin.saveSettings();
        if (value) bilibiliLiveService.startBilibiliLiveMonitor(plugin);
        else bilibiliLiveService.stopBilibiliLiveMonitor(plugin);
      } else if (key === "notify") {
        plugin.settings.bilibiliLiveSystemNotifyEnabled = Boolean(value);
        await plugin.saveSettings();
      }
    },
    openRoom: (room) => {
      const targetUrl =
        (room && room.url) ||
        bilibiliLiveService.getLiveRoomWebUrl(room && room.roomId);
      openExternal(targetUrl);
    },
    subscribe: (fn) => bilibiliLiveService.subscribeBilibiliLiveUpdates(plugin, () => fn())
  };
}

/* ============================== 看番历史事件融合 ============================== */

function buildWatchHistoryEvents(plugin, items, getCover) {
  const list = Array.isArray(items) ? items : [];
  const byPath = new Map();
  const byName = new Map();
  for (const it of list) {
    if (!it) continue;
    if (it.file && it.file.path) byPath.set(it.file.path, it);
    if (it.name) byName.set(it.name, it);
  }

  const out = [];
  const seenDayTypeKey = new Set();
  const rawLog =
    plugin && plugin.settings && Array.isArray(plugin.settings.animeActivityLog)
      ? plugin.settings.animeActivityLog
      : [];

  for (const ev of rawLog) {
    if (!ev || !ev.animeName) continue;
    const matched = (ev.filePath && byPath.get(ev.filePath)) || byName.get(ev.animeName) || null;
    const key = matched ? itemKey(matched) : ev.filePath || ev.animeName;
    const cover = matched ? (getCover ? getCover(matched) : matched.cover) : ev.cover || "";
    const ts = Number(ev.timestamp) || 0;
    const d = toDate(ts);
    if (!d) continue;

    let mappedType = "episode";
    if (ev.type === "episode") mappedType = "episode";
    else if (ev.type === "score" || ev.type === "rate") mappedType = "rate";
    else if (ev.type === "review") mappedType = "review";
    else if (ev.type === "status") {
      if (ev.status === "已看") mappedType = "complete";
      else if (ev.status === "想看") mappedType = "plan";
      else if (ev.status === "抛弃") mappedType = "drop";
      else mappedType = "start";
    } else if (ev.type === "import") {
      if (ev.status === "已看") mappedType = "complete";
      else if (ev.status === "在看") mappedType = "start";
      else mappedType = "plan";
    }

    const epNum = Number.isFinite(Number(ev.episode)) && Number(ev.episode) > 0 ? Number(ev.episode) : 1;
    const epFrom = Number.isFinite(Number(ev.epFrom)) && Number(ev.epFrom) > 0 ? Number(ev.epFrom) : epNum;
    const epTo = Number.isFinite(Number(ev.epTo)) && Number(ev.epTo) > 0 ? Number(ev.epTo) : epNum;
    const textSnippet = String(ev.text || ev.detail || "")
      .replace(/^写下手札[：:]\s*/, "")
      .trim()
      .slice(0, 80);

    seenDayTypeKey.add(`${dayKey(d)}|${mappedType}|${key}`);
    out.push({
      id: ev.id || `log-${ts}-${out.length}`,
      ts,
      type: mappedType,
      key,
      title: (matched && matched.name) || ev.animeName,
      cover,
      epFrom,
      epTo,
      score: Number.isFinite(Number(ev.score)) ? Number(ev.score) : undefined,
      text: textSnippet
    });
  }

  const derived = deriveAnimeEventsFromItems(list, getCover);
  for (const dev of derived) {
    const d = toDate(dev.ts);
    if (!d) continue;
    const dk = `${dayKey(d)}|${dev.type}|${dev.key}`;
    if (seenDayTypeKey.has(dk)) continue;
    out.push(dev);
  }

  return out;
}

/* ============================== 标签覆盖率与补全 ============================== */

function computeBangumiTagCoverage(items) {
  const list = Array.isArray(items) ? items : [];
  let total = 0;
  let missing = 0;
  for (const it of list) {
    if (!it || it.isSamplePreviewItem) continue;
    const hasBgm = Boolean(it.subjectId || (it.bgmUrl && /subject\/\d+/.test(String(it.bgmUrl))));
    if (!hasBgm) continue;
    total += 1;
    const tokens = String(it.tags || "")
      .split(/[,;\s#\[\]"']+/)
      .map((t) => t.trim())
      .filter((t) => t && t.toLowerCase() !== "bangumi");
    if (tokens.length < 2) {
      missing += 1;
    }
  }
  return { total, missing };
}

/* ============================== 番剧首屏 ============================== */

function createAnimeStageContext(plugin, items, deskRuntime = {}) {
  const mobile = isMobileEnv();
  if (plugin && !plugin._v07LocalFolderCache) {
    plugin._v07LocalFolderCache = new Map();
  }
  const folderCache = (plugin && plugin._v07LocalFolderCache) || new Map();

  const scheduleSaveSettings = () => {
    if (!plugin || !plugin.settings) return;
    if (plugin._v08LensSaveTid) clearTimeout(plugin._v08LensSaveTid);
    plugin._v08LensSaveTid = setTimeout(() => {
      plugin._v08LensSaveTid = null;
      plugin.saveSettings().catch(() => {});
    }, 260);
  };

  const getCover = (it) => {
    try {
      return it.cover ? plugin.getCoverResourceUrl(it.cover, (it.file && it.file.path) || "") : "";
    } catch (_) {
      return "";
    }
  };
  const getLocal = (it) => {
    if (mobile || !it || !it.downloadPath || it.downloadPath === "无") return null;
    const folderPath = String(it.downloadPath).trim();
    if (!folderPath) return null;
    let entry = folderCache.get(folderPath);
    const now = Date.now();
    if (!entry || now - entry.ts > 30000) {
      let videoFiles = null;
      try {
        const r = inspectLocalFolder(folderPath, 0);
        if (r && !r.error && Array.isArray(r.videoFiles)) {
          videoFiles = r.videoFiles;
        }
      } catch (_) {}
      entry = { ts: now, videoFiles };
      folderCache.set(folderPath, entry);
    }
    if (!entry.videoFiles) return null;
    const watched = Number(it.watchedEpisodes) || 0;
    let maxEp = 0;
    const unseen = [];
    for (const vf of entry.videoFiles) {
      const ep = Number(vf && vf.episode) || 0;
      if (ep > maxEp) maxEp = ep;
      if (ep > watched) unseen.push(vf);
    }
    unseen.sort((a, b) => (Number(a.episode) || 0) - (Number(b.episode) || 0));
    const exactNext = unseen.find((v) => Number(v.episode) === watched + 1) || unseen[0] || null;
    return {
      nextEpisodeFile: exactNext,
      nextEpisodeNumber: exactNext ? Number(exactNext.episode) || null : null,
      maxLocalEpisode: maxEp,
      newCount: unseen.length
    };
  };

  const events = buildWatchHistoryEvents(plugin, items, getCover);
  const currentSeasonInfo =
    seasonalRadarService && typeof seasonalRadarService.getCurrentYearAndSeason === "function"
      ? seasonalRadarService.getCurrentYearAndSeason()
      : { year: new Date().getFullYear(), seasonMonth: "10", seasonLabel: "10月新番" };

  return {
    items,
    events,
    getEvents: () => buildWatchHistoryEvents(plugin, items, getCover),
    appearance: getAppearance(plugin),
    onAppearancePatch: async (patch) => {
      const cur = getAppearance(plugin);
      const next = Object.assign({}, cur, patch || {});
      await saveAppearance(plugin, next);
      return next;
    },
    currentSeasonInfo,
    getCover,
    getKey: itemKey,
    getLocal,
    getWatchUrl: (it) => (it && it.watchUrl) || "",
    getBgmUrl: (it) =>
      (it && it.bgmUrl) ||
      (it && it.subjectId ? `https://bgm.tv/subject/${it.subjectId}` : ""),
    classifyWatch: (it) => classifyWatchUrl((it && (it.watchUrl || it.bgmUrl)) || ""),
    heroScene: (plugin.settings && plugin.settings.v07HeroScene) || "watching",
    onHeroSceneChange: (id) => {
      if (!plugin || !plugin.settings) return;
      plugin.settings.v07HeroScene = id;
      plugin.saveSettings().catch(() => {});
    },
    pickScope: (plugin.settings && plugin.settings.v07PickScope) || "queue",
    onPickScopeChange: (id) => {
      if (!plugin || !plugin.settings) return;
      plugin.settings.v07PickScope = id;
      scheduleSaveSettings();
    },
    lensMode: (plugin.settings && plugin.settings.v08LensMode) || "slide",
    onLensModeChange: (mode) => {
      if (!plugin || !plugin.settings) return;
      plugin.settings.v08LensMode = mode === "grid" ? "grid" : "slide";
      scheduleSaveSettings();
    },
    lensPage: Number(plugin.settings && plugin.settings.v08LensPage) || 0,
    onLensPageChange: (idx) => {
      if (!plugin || !plugin.settings) return;
      plugin.settings.v08LensPage = Math.max(0, Math.min(3, Number(idx) || 0));
      scheduleSaveSettings();
    },
    addNew: () => {
      if (typeof plugin.openSearchModal === "function") plugin.openSearchModal();
    },
    actions: {
      play: async (it, local, ep) => {
        const targetEp =
          Number(ep) ||
          (local && Number(local.nextEpisodeNumber)) ||
          (Number(it && it.watchedEpisodes) || 0) + 1;
        if (reviewStudioService && typeof reviewStudioService.launchVideoAtEpisodeAndTimestamp === "function") {
          const res = await reviewStudioService.launchVideoAtEpisodeAndTimestamp(plugin, it, {
            episode: targetEp,
            timestamp: ""
          });
          if (res && res.ok) return;
        }
        const f = local && local.nextEpisodeFile;
        const p = f && (f.path || f);
        if (p) await openLocalPathSafely(p);
      },
      openWeb: (it, url) => openExternal(url),
      openNote: (it) => {
        if (it && it.isSamplePreviewItem && !it.file) {
          if (Notice) {
            new Notice("当前为示例预览条目，点击右上角「+ 添加番剧」导入真实动画后即可生成专属 Markdown 笔记");
          }
          return;
        }
        return openNoteFile(plugin, it && it.file);
      },
      openFolder: async (it) => {
        if (it && it.downloadPath && it.downloadPath !== "无") {
          await openLocalPathSafely(it.downloadPath);
        } else if (animeDownloadService && typeof animeDownloadService.openAnimeDownloadModal === "function") {
          animeDownloadService.openAnimeDownloadModal(plugin, it, () => {
            if (it && it.downloadPath) folderCache.delete(String(it.downloadPath).trim());
            if (typeof deskRuntime.refreshStage === "function") deskRuntime.refreshStage();
          });
        }
      },
      markNext: async (it) => {
        const next = (Number(it.watchedEpisodes) || 0) + 1;
        await plugin.quickUpdateAnimeNote(it, { watchedEpisodes: next });
      },
      stepBack: async (it) => {
        const prev = Math.max(0, (Number(it.watchedEpisodes) || 0) - 1);
        await plugin.quickUpdateAnimeNote(it, { watchedEpisodes: prev });
      },
      setScore: async (it, score) => {
        await plugin.quickUpdateAnimeNote(it, {
          score: score === null || score === undefined || score === "" ? "" : Number(score)
        });
      },
      setState: async (it, nextState) => {
        if (!nextState) return;
        await plugin.quickUpdateAnimeNote(it, { state: nextState });
      },
      addQuickQuip: async (it, ep, rawText) => {
        const body = String(rawText || "").trim();
        if (!it || !body) return false;
        const epNum = Math.max(1, parseInt(ep, 10) || Math.max(1, Number(it.watchedEpisodes) || 1));
        const extracted =
          typeof extractLeadingTimestampFromText === "function"
            ? extractLeadingTimestampFromText(body)
            : { timestamp: "", cleanText: body };
        const scopeCode = `EP${String(epNum).padStart(2, "0")}`;
        const todayStr = new Date().toISOString().slice(0, 10);
        const entry = normalizeReviewEntry(
          {
            type: "quip",
            scopeCode,
            timestamp: extracted.timestamp || "",
            title: "",
            date: todayStr,
            text: extracted.cleanText || body,
            images: [],
            coverImage: ""
          },
          Array.isArray(it.reviews) ? it.reviews.length : 0
        );
        const nextReviews = [...(Array.isArray(it.reviews) ? it.reviews : []), entry];
        if (it.isSamplePreviewItem && !it.file) {
          it.reviews = nextReviews;
          if (Notice) {
            new Notice(`已在示例条目《${it.name}》体验记入第 ${epNum} 集手札（导入真实番剧后将持久写入笔记）`);
          }
          return true;
        }
        await reviewStudioService.saveAnimeReviewsToNote(
          plugin,
          it,
          nextReviews,
          `已记入《${it.name}》第 ${epNum} 集手札`
        );
        return true;
      },
      openReviews: (it) => {
        if (reviewStudioService && typeof reviewStudioService.openAnimeReviewStudioModal === "function") {
          reviewStudioService.openAnimeReviewStudioModal(plugin, it, {
            onChanged: () => {
              if (typeof deskRuntime.refreshStage === "function") deskRuntime.refreshStage();
            }
          });
        }
      },
      openDownload: (it, onDone) => {
        if (animeDownloadService && typeof animeDownloadService.openAnimeDownloadModal === "function") {
          animeDownloadService.openAnimeDownloadModal(plugin, it, () => {
            if (it && it.downloadPath) folderCache.delete(String(it.downloadPath).trim());
            if (typeof onDone === "function") onDone();
            if (typeof deskRuntime.refreshStage === "function") deskRuntime.refreshStage();
          });
        }
      },
      openTrend: (it) => {
        if (typeof deskRuntime.openTrendModal === "function") {
          deskRuntime.openTrendModal(it);
        }
      },
      openRelations: (it) => {
        try {
          const mh = require("./multi-hall-archive-service.js");
          if (typeof mh.openMagicWandRelationModal === "function") {
            mh.openMagicWandRelationModal(
              plugin,
              {
                type: "anime",
                id: (it.file && it.file.path) || it.name,
                record: it,
                title: it.name,
                studio: it.studio || ""
              },
              items,
              deskRuntime.wandCallbacks || {}
            );
          }
        } catch (_) {}
      },
      openCatalog: (query, statusFilter) => {
        if (typeof deskRuntime.switchWorkspaceMode === "function") {
          const navOpts = { scrollToWorkspace: true };
          if (statusFilter) navOpts.statusFilter = statusFilter;
          if (query !== undefined && query !== null) navOpts.searchQuery = query;
          deskRuntime.switchWorkspaceMode("catalog", navOpts);
        }
      }
    },
    live: plugin.liveRoomService || createLiveRoomProvider(plugin),
    lists: createListsProvider(plugin, items, getCover, deskRuntime)
  };
}

/* ============================== 片单与筛选 ============================== */

function createListsProvider(plugin, items, getCover, deskRuntime = {}) {
  const rerender = async () => {
    const root = deskRuntime.rootContainer;
    if (root && typeof plugin.renderScoreDashboard === "function") {
      await plugin.renderScoreDashboard(root, deskRuntime.deskOptions || {});
    }
  };
  const pls = () => (Array.isArray(plugin.settings.customCollectionSections) ? plugin.settings.customCollectionSections : []);
  const fls = () =>
    (Array.isArray(plugin.settings.customQuerySections) ? plugin.settings.customQuerySections : []).filter(
      (c) => !(c.id === "preset_currently_watching" && plugin.settings.customQuerySections.length === 1)
    );
  return {
    getPlaylists: () =>
      pls().map((c) => ({
        id: c.id,
        title: c.title,
        desc: c.description || c.desc || "",
        items: plugin.resolveCollectionItems(c, items),
        _cfg: c
      })),
    getFilters: () =>
      fls().map((c) => {
        const matched = plugin.sortCustomQueryItems(plugin.filterCustomQueryItems(items, c), c.sortBy);
        return { id: c.id, title: c.title, rules: c, items: matched.slice(0, 12), total: matched.length, _cfg: c };
      }),
    getTagCoverage: () =>
      typeof plugin.getBangumiTagCoverage === "function"
        ? plugin.getBangumiTagCoverage(items)
        : computeBangumiTagCoverage(items),
    backfillTags: async (cb) => {
      if (typeof plugin.backfillBangumiTags === "function") {
        return plugin.backfillBangumiTags(cb);
      }
      if (typeof plugin.backfillExistingAnimeTagsFromBangumi === "function") {
        const res = await plugin.backfillExistingAnimeTagsFromBangumi({
          onlyMissing: true,
          onProgress: (prog) => {
            if (typeof cb === "function" && prog) cb(prog.completed || 0, prog.total || 0);
          }
        });
        const updated = Number(res && res.updated) || 0;
        const total = Number(res && res.targetsCount) || updated;
        return { updated, failed: Math.max(0, total - updated) };
      }
      return { updated: 0, failed: 0 };
    },
    createPlaylist: () => plugin.openCustomCollectionModal(null, rerender),
    editPlaylist: (pl) => plugin.openCustomCollectionModal(pl._cfg, rerender),
    managePlaylist: (pl) => plugin.openCollectionItemsManagerModal(pl._cfg, rerender),
    deletePlaylist: (pl) => plugin.confirmDeleteCustomCollection(pl._cfg, rerender),
    reorderPlaylist: async (pl, keys) => {
      const cfg = pl._cfg;
      const byKey = new Map(pl.items.map((it) => [(it.file && it.file.path) || it.subjectId || it.name, it]));
      cfg.items = keys
        .map((k) => byKey.get(k))
        .filter(Boolean)
        .map((it) => ({ path: it.file && it.file.path, subjectId: it.subjectId, name: it.name }));
      await plugin.saveSettings();
    },
    createFilter: () => plugin.openCustomQuerySectionModal(null, rerender),
    editFilter: (f) => plugin.openCustomQuerySectionModal(f._cfg, rerender),
    deleteFilter: (f) => plugin.confirmDeleteCustomQuerySection(f._cfg, rerender),
    openFilterResults: (f) => {
      if (typeof deskRuntime.switchWorkspaceMode === "function") {
        deskRuntime.switchWorkspaceMode("catalog", { statusFilter: `query:${f.id}`, scrollToWorkspace: true });
      }
    },
    openItem: (it) => openNoteFile(plugin, it.file),
    getCover,
    getKey: (it) => (it.file && it.file.path) || it.subjectId || it.name
  };
}

/* ============================== 多源游戏搜索适配 ============================== */

async function searchGameSourcesAdapter(source, keyword) {
  const srcKey = !source || source === "all" ? "mixed" : String(source).toLowerCase();
  const { candidates, sourceStatuses } = await gameMultisourceApi.searchGamesAcrossSources(keyword, srcKey);
  const bySource = new Map();
  for (const st of sourceStatuses || []) {
    const errText = String(st.error || "").toLowerCase();
    const status = st.ok
      ? st.count > 0
        ? "ok"
        : "empty"
      : errText.includes("timeout")
      ? "timeout"
      : "error";
    bySource.set(st.source, { source: st.source, status, items: [] });
  }
  for (const c of candidates || []) {
    if (!bySource.has(c.source)) {
      bySource.set(c.source, { source: c.source, status: "ok", items: [] });
    }
    const yearMatch = String(c.releaseDate || "").match(/(\d{4})/);
    bySource.get(c.source).items.push({
      source: c.source,
      id: c.id,
      title: c.title,
      subtitle: c.originalTitle && c.originalTitle !== c.title ? c.originalTitle : "",
      cover: c.coverUrl || "",
      developer: c.developer || "",
      year: yearMatch ? yearMatch[1] : "",
      score: c.score ? Number(c.score) : null,
      url: c.sourceUrl || "",
      _raw: c
    });
  }
  const order = srcKey === "mixed" ? ["bangumi", "vndb", "steam", "ymgal"] : [srcKey];
  return order
    .map((k) => bySource.get(k))
    .filter(Boolean);
}

/* ============================== 游戏典藏 ============================== */

function ensureNormalizedGameGroups(plugin) {
  if (!plugin || !plugin.settings) return [];
  if (!Array.isArray(plugin.settings.gameGroups)) {
    plugin.settings.gameGroups = [];
  }
  if (
    plugin.settings.gameGroups.length === 0 &&
    Array.isArray(plugin.settings.gameCustomGroups) &&
    plugin.settings.gameCustomGroups.length > 0
  ) {
    plugin.settings.gameGroups = plugin.settings.gameCustomGroups.map((g, idx) => ({
      id: g.id || `grp-${idx + 1}`,
      name: g.name || "未命名分组",
      gameIds: Array.isArray(g.gameIds) ? g.gameIds.slice() : []
    }));
  }
  return plugin.settings.gameGroups;
}

function createGameStageContext(plugin, vaultAnimeItems, rerender, extraOpts = {}) {
  const mh = require("./multi-hall-archive-service.js");
  const games = Array.isArray(plugin.settings.gameCollection) ? plugin.settings.gameCollection : [];
  const save = async () => plugin.saveSettings();
  const refresh = () => typeof rerender === "function" && rerender();
  const getCover = (g) => {
    try {
      return typeof mh.resolveLocalOrVaultImageUrl === "function"
        ? mh.resolveLocalOrVaultImageUrl(plugin, g.coverUrl)
        : g.coverUrl;
    } catch (_) {
      return g.coverUrl;
    }
  };

  const openRelationsModalForGame = (g) => {
    if (typeof mh.openMagicWandRelationModal !== "function") return;
    mh.openMagicWandRelationModal(
      plugin,
      { type: "game", id: g.id, record: g, title: g.title, studio: g.developer || "" },
      vaultAnimeItems || [],
      extraOpts.wandCallbacks || {}
    );
  };

  const timerBridge = plugin.gameTimer || {
    running: (g) => {
      const active = gameStatsService.getActiveGameTimer(plugin, g && g.id);
      return active ? active.startedAtMs : null;
    },
    start: (g) => {
      gameStatsService.startActiveGameTimer(plugin, g);
    },
    stop: async (g) => {
      await gameStatsService.finishActiveGameTimer(plugin, g, async (p, gm) => {
        if (typeof mh.syncGameMarkdownNote === "function") await mh.syncGameMarkdownNote(p, gm);
      });
    }
  };

  return {
    games,
    initialSearchQuery: extraOpts.searchQuery || "",
    appearance: getAppearance(plugin),
    settings: {
      gameUi: plugin.settings.gameUi || {},
      gameGroups: ensureNormalizedGameGroups(plugin)
    },
    getCover,
    getEvents: () => deriveGameEvents(games, getCover),
    actions: {
      canLaunch: (g) => !isMobileEnv() && Boolean(String(g.exePath || "").trim()),
      launch: (g) => typeof mh.launchLocalGameProcess === "function" && mh.launchLocalGameProcess(plugin, g, refresh),
      openJournal: (g) => typeof mh.openGameDetailAndNotesModal === "function" && mh.openGameDetailAndNotesModal(plugin, g, refresh),
      editMeta: (g) => typeof mh.openGameEditMetadataModal === "function" && mh.openGameEditMetadataModal(plugin, g, refresh),
      openRelations: openRelationsModalForGame,
      bindRelationMenu: (cardEl, g) => {
        if (typeof mh.bindMagicWandLongPress === "function") {
          mh.bindMagicWandLongPress(cardEl, () => openRelationsModalForGame(g));
        }
        if (cardEl && typeof cardEl.addEventListener === "function") {
          cardEl.addEventListener("contextmenu", (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest("button, input, select, textarea, a")) {
              return;
            }
            ev.preventDefault();
            try {
              const { Menu } = require("obsidian");
              const menu = new Menu();
              menu.addItem((item) =>
                item
                  .setTitle("关联其他典藏")
                  .setIcon("sparkles")
                  .onClick(() => openRelationsModalForGame(g))
              );
              menu.addItem((item) =>
                item
                  .setTitle("编辑游戏资料")
                  .setIcon("pencil")
                  .onClick(() => typeof mh.openGameEditMetadataModal === "function" && mh.openGameEditMetadataModal(plugin, g, refresh))
              );
              menu.addItem((item) =>
                item
                  .setTitle("游戏记录与笔记")
                  .setIcon("book-open")
                  .onClick(() => typeof mh.openGameDetailAndNotesModal === "function" && mh.openGameDetailAndNotesModal(plugin, g, refresh))
              );
              menu.showAtMouseEvent(ev);
            } catch (_) {
              openRelationsModalForGame(g);
            }
          });
        }
      },
      removeGame: async (g) => {
        plugin.settings.gameCollection = (plugin.settings.gameCollection || []).filter((x) => x.id !== g.id);
        if (Array.isArray(plugin.settings.gameGroups)) {
          plugin.settings.gameGroups.forEach((gr) => {
            if (Array.isArray(gr.gameIds)) {
              gr.gameIds = gr.gameIds.filter((id) => id !== g.id);
            }
          });
        }
        await save();
        refresh();
      },
      addGame: () => {
        if (!plugin.__gameWorkspaceState) {
          plugin.__gameWorkspaceState = { searchQuery: "", statusFilter: "all", showAddDrawer: true };
        } else {
          plugin.__gameWorkspaceState.showAddDrawer = true;
        }
        refresh();
      },
      saveGame: async (g) => {
        if (typeof mh.syncGameMarkdownNote === "function") await mh.syncGameMarkdownNote(plugin, g);
        await save();
      },
      saveSettings: async (patch) => {
        if (patch.gameUi) plugin.settings.gameUi = patch.gameUi;
        if (patch.gameGroups) {
          plugin.settings.gameGroups = patch.gameGroups;
          plugin.settings.gameCustomGroups = patch.gameGroups;
        }
        await save();
      },
      addManualSession: async (g, s) => {
        if (!Array.isArray(g.playSessions)) g.playSessions = [];
        const mins = Math.max(1, Math.round(Number(s.minutes) || 0));
        const durHours = Number((mins / 60).toFixed(2));
        const startIso = s.start || new Date().toISOString();
        g.playSessions.unshift({
          id: `ses-${Date.now().toString(36)}`,
          start: startIso,
          startedAt: startIso,
          endedAt: startIso,
          minutes: mins,
          durationHours: durHours,
          source: "manual",
          mode: "manual",
          note: s.note || ""
        });
        g.playHours = Number(((Number(g.playHours) || 0) + durHours).toFixed(2));
        g.lastPlayedAt = g.lastPlayedAt || startIso;
        if (typeof mh.syncGameMarkdownNote === "function") await mh.syncGameMarkdownNote(plugin, g);
        await save();
      },
      removeSession: async (g, id) => {
        const s = (g.playSessions || []).find((x) => x.id === id);
        g.playSessions = (g.playSessions || []).filter((x) => x.id !== id);
        if (s) {
          const mins = s.minutes !== undefined ? Number(s.minutes) : Math.round((Number(s.durationHours) || 0) * 60);
          g.playHours = Math.max(0, Number(((Number(g.playHours) || 0) - mins / 60).toFixed(2)));
        }
        if (typeof mh.syncGameMarkdownNote === "function") await mh.syncGameMarkdownNote(plugin, g);
        await save();
      },
      timer: timerBridge
    },
    searchGames: searchGameSourcesAdapter
  };
}

module.exports = {
  getAppearance,
  saveAppearance,
  createLiveRoomProvider,
  buildWatchHistoryEvents,
  computeBangumiTagCoverage,
  searchGameSourcesAdapter,
  createAnimeStageContext,
  createListsProvider,
  createGameStageContext
};
