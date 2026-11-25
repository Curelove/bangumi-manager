/**
 * 本地多路径视频索引、暂存区、单集精准绑定与智能预扫描服务
 * ---------------------------------------------------------------
 * 设计原则：
 *   1) 非侵入式索引：绝不移动、绝不重命名用户本地的任何视频文件或文件夹；
 *   2) 多层关联：兼容主文件夹（同步写入笔记「下载路径」）、额外多文件夹、散落单文件、指定单集映射、以及特典/OVA；
 *   3) 离线与便携兜底：区分盘符未接入与文件丢失，自动探测移动硬盘换盘符并支持一键前缀批量修复；
 *   4) 跨端安全：移动端环境 zero Node 调用，安全只读返回空/状态提示，绝不破坏电脑端配置。
 */
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  normalizeUnicodeNfc,
  extnameLower
} = require("./platform-env.js");
const noteUtils = require("./note-utils.js");
const { getSafeFileName } = require("./note-manager.js");

let obsidianMod = null;
try {
  obsidianMod = require("obsidian");
} catch (_) {}

const VIDEO_EXT_SET = new Set(
  Array.isArray(noteUtils.VIDEO_EXTENSIONS) && noteUtils.VIDEO_EXTENSIONS.length > 0
    ? noteUtils.VIDEO_EXTENSIONS
    : [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts"]
);

const RESOLVE_CACHE_TTL_MS = 20 * 1000;

function isWin() {
  return typeof process !== "undefined" && process.platform === "win32";
}

function normFsPath(rawPath) {
  const s = String(rawPath || "").trim();
  if (!s) return "";
  const pathMod = tryRequireNode("path");
  if (!pathMod) return s.replace(/\\/g, "/");
  try {
    return pathMod.normalize(s);
  } catch (_) {
    return s;
  }
}

function normPathCompareKey(rawPath) {
  const clean = normFsPath(rawPath).replace(/[\\/]+$/, "");
  if (!clean) return "";
  const slashNorm = clean.replace(/\\/g, "/");
  return isWin() ? slashNorm.toLowerCase() : slashNorm;
}

function extractDriveRoot(rawPath) {
  const s = normFsPath(rawPath);
  const m = s.match(/^([A-Za-z]:)(?:[\\/]|$)/);
  if (m && m[1]) return `${m[1].toUpperCase()}\\`;
  return "";
}

function checkPathStatus(rawPath) {
  const clean = normFsPath(rawPath);
  if (!clean) return "missing";
  if (!isDesktopNodeAvailable()) return "mobile";
  const fsMod = tryRequireNode("fs");
  if (!fsMod) return "mobile";

  const driveRoot = isWin() ? extractDriveRoot(clean) : "";
  if (driveRoot) {
    try {
      if (!fsMod.existsSync(driveRoot)) {
        return "drive_offline";
      }
    } catch (_) {
      return "drive_offline";
    }
  }
  try {
    return fsMod.existsSync(clean) ? "ok" : "missing";
  } catch (_) {
    return "missing";
  }
}

function normalizeNoteRelKey(rawPath) {
  return normalizeUnicodeNfc(String(rawPath || "").trim()).replace(/\\/g, "/").replace(/^\/+/, "");
}

function getAnimeBindingKey(item) {
  if (!item) return "";
  const sid = String(item.subjectId || "").trim();
  if (sid) return `bgm:${sid}`;
  const notePath = normalizeNoteRelKey(item.file?.path || item.path || "");
  if (notePath) return `note:${notePath}`;
  const title = normalizeUnicodeNfc(String(item.name || "")).trim().toLowerCase();
  return title ? `title:${title}` : "";
}

function getAnimeNoteAliasKey(item) {
  const notePath = normalizeNoteRelKey(item?.file?.path || item?.path || "");
  return notePath ? `note:${notePath}` : "";
}

function ensureLocalMediaSettingsShape(plugin) {
  if (!plugin || !plugin.settings || typeof plugin.settings !== "object") return;
  if (!plugin.settings.localMediaBindings || typeof plugin.settings.localMediaBindings !== "object" || Array.isArray(plugin.settings.localMediaBindings)) {
    plugin.settings.localMediaBindings = {};
  }
  if (!Array.isArray(plugin.settings.localMediaStagingPool)) {
    plugin.settings.localMediaStagingPool = [];
  }
  if (!plugin.settings.localMediaBrowserState || typeof plugin.settings.localMediaBrowserState !== "object") {
    plugin.settings.localMediaBrowserState = {
      lastDir: "",
      pinnedDirs: [],
      lastScannedDirs: [],
      hideLinkedInPool: false
    };
  }
  if (!Array.isArray(plugin.settings.localMediaBrowserState.pinnedDirs)) {
    plugin.settings.localMediaBrowserState.pinnedDirs = [];
  }
  if (!Array.isArray(plugin.settings.localMediaBrowserState.lastScannedDirs)) {
    plugin.settings.localMediaBrowserState.lastScannedDirs = [];
  }
}

function normalizeBindingEntry(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const extraFolders = Array.isArray(src.extraFolders)
    ? src.extraFolders.map((x) => normFsPath(x)).filter(Boolean)
    : [];
  const looseFiles = Array.isArray(src.looseFiles)
    ? src.looseFiles
        .filter((f) => f && f.path)
        .map((f) => ({
          path: normFsPath(f.path),
          name: String(f.name || f.path.split(/[\\/]/).pop() || ""),
          size: Number(f.size) || 0,
          mtimeMs: Number(f.mtimeMs) || 0,
          addedAt: Number(f.addedAt) || 0
        }))
    : [];
  const episodeMap = {};
  if (src.episodeMap && typeof src.episodeMap === "object") {
    for (const [k, v] of Object.entries(src.episodeMap)) {
      const epNum = parseInt(k, 10);
      if (!Number.isFinite(epNum) || epNum < 0 || !v || !v.path) continue;
      episodeMap[String(epNum)] = {
        path: normFsPath(v.path),
        name: String(v.name || v.path.split(/[\\/]/).pop() || ""),
        size: Number(v.size) || 0,
        mtimeMs: Number(v.mtimeMs) || 0,
        boundAt: Number(v.boundAt) || 0
      };
    }
  }
  const extraClips = Array.isArray(src.extraClips)
    ? src.extraClips
        .filter((c) => c && c.path)
        .map((c) => ({
          path: normFsPath(c.path),
          name: String(c.name || c.path.split(/[\\/]/).pop() || ""),
          label: String(c.label || "特典"),
          size: Number(c.size) || 0,
          mtimeMs: Number(c.mtimeMs) || 0,
          boundAt: Number(c.boundAt) || 0
        }))
    : [];
  return {
    animeName: String(src.animeName || ""),
    notePath: String(src.notePath || ""),
    extraFolders,
    looseFiles,
    episodeMap,
    extraClips,
    updatedAt: Number(src.updatedAt) || 0
  };
}

function getAnimeBindingRecord(plugin, item) {
  if (!plugin?.settings?.localMediaBindings || !item) return null;
  const bindings = plugin.settings.localMediaBindings;
  const primaryKey = getAnimeBindingKey(item);
  if (primaryKey && bindings[primaryKey]) {
    return normalizeBindingEntry(bindings[primaryKey]);
  }
  const noteAlias = getAnimeNoteAliasKey(item);
  if (noteAlias && noteAlias !== primaryKey && bindings[noteAlias]) {
    const rec = normalizeBindingEntry(bindings[noteAlias]);
    if (primaryKey) {
      bindings[primaryKey] = rec;
      delete bindings[noteAlias];
    }
    return rec;
  }
  return null;
}

function ensureAnimeBindingRecord(plugin, item) {
  ensureLocalMediaSettingsShape(plugin);
  const key = getAnimeBindingKey(item);
  if (!key) return { key: "", record: normalizeBindingEntry(null) };
  const bindings = plugin.settings.localMediaBindings;
  const noteAlias = getAnimeNoteAliasKey(item);
  if (!bindings[key] && noteAlias && noteAlias !== key && bindings[noteAlias]) {
    bindings[key] = normalizeBindingEntry(bindings[noteAlias]);
    delete bindings[noteAlias];
  }
  if (!bindings[key]) {
    bindings[key] = normalizeBindingEntry({
      animeName: item?.name || "",
      notePath: normalizeNoteRelKey(item?.file?.path || item?.path || "")
    });
  }
  const rec = normalizeBindingEntry(bindings[key]);
  rec.animeName = item?.name || rec.animeName || "";
  const curNotePath = normalizeNoteRelKey(item?.file?.path || item?.path || "");
  if (curNotePath) rec.notePath = curNotePath;
  bindings[key] = rec;
  return { key, record: rec };
}

function hasNonEmptyBindingRecord(record) {
  if (!record) return false;
  return Boolean(
    (Array.isArray(record.extraFolders) && record.extraFolders.length > 0) ||
      (Array.isArray(record.looseFiles) && record.looseFiles.length > 0) ||
      (record.episodeMap && Object.keys(record.episodeMap).length > 0) ||
      (Array.isArray(record.extraClips) && record.extraClips.length > 0)
  );
}

/**
 * 在动画笔记重命名 / 移动或自定义动画补绑 Bangumi ID 时无损迁移本地视频绑定键与暂存区关联标记
 */
async function migrateAnimeBindingKey(plugin, oldKeyRaw, newKeyRaw, nextNotePath = "") {
  const oldKey = String(oldKeyRaw || "").trim();
  const newKey = String(newKeyRaw || "").trim();
  if (!plugin || !oldKey || !newKey || oldKey === newKey) return false;
  ensureLocalMediaSettingsShape(plugin);
  const bindings = plugin.settings.localMediaBindings;
  let changed = false;

  if (bindings[oldKey]) {
    const src = normalizeBindingEntry(bindings[oldKey]);
    if (!bindings[newKey]) {
      if (nextNotePath) src.notePath = normalizeNoteRelKey(nextNotePath);
      bindings[newKey] = src;
    } else {
      const dst = normalizeBindingEntry(bindings[newKey]);
      const seenFolders = new Set(dst.extraFolders.map(normPathCompareKey));
      for (const f of src.extraFolders) {
        if (!seenFolders.has(normPathCompareKey(f))) {
          dst.extraFolders.push(f);
          seenFolders.add(normPathCompareKey(f));
        }
      }
      const seenLoose = new Set(dst.looseFiles.map((f) => normPathCompareKey(f.path)));
      for (const lf of src.looseFiles) {
        if (!seenLoose.has(normPathCompareKey(lf.path))) {
          dst.looseFiles.push(lf);
          seenLoose.add(normPathCompareKey(lf.path));
        }
      }
      for (const [epK, epV] of Object.entries(src.episodeMap || {})) {
        if (!dst.episodeMap[epK]) dst.episodeMap[epK] = epV;
      }
      const seenClips = new Set(dst.extraClips.map((c) => normPathCompareKey(c.path)));
      for (const cl of src.extraClips) {
        if (!seenClips.has(normPathCompareKey(cl.path))) {
          dst.extraClips.push(cl);
          seenClips.add(normPathCompareKey(cl.path));
        }
      }
      if (nextNotePath) dst.notePath = normalizeNoteRelKey(nextNotePath);
      dst.updatedAt = Date.now();
      bindings[newKey] = dst;
    }
    delete bindings[oldKey];
    changed = true;
  }

  const pool = plugin.settings.localMediaStagingPool;
  if (Array.isArray(pool)) {
    for (const item of pool) {
      if (!item || !Array.isArray(item.linkedTo)) continue;
      if (item.linkedTo.includes(oldKey)) {
        item.linkedTo = Array.from(new Set(item.linkedTo.map((k) => (k === oldKey ? newKey : k))));
        changed = true;
      }
    }
  }

  if (changed) {
    invalidateLocalMediaCache(plugin);
    if (typeof plugin.saveSettings === "function") {
      await plugin.saveSettings().catch(() => {});
    }
  }
  return changed;
}

function invalidateLocalMediaCache(plugin, item = null) {
  if (plugin?._localMediaResolveCache && typeof plugin._localMediaResolveCache.clear === "function") {
    if (!item) {
      plugin._localMediaResolveCache.clear();
    } else {
      const prefix = `${getAnimeBindingKey(item)}||`;
      for (const k of Array.from(plugin._localMediaResolveCache.keys())) {
        if (k.startsWith(prefix)) plugin._localMediaResolveCache.delete(k);
      }
    }
  }
  if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
    plugin._v07LocalFolderCache.clear();
  }
}

function buildFileMetaObj(filePath, options = {}) {
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const normPath = normFsPath(filePath);
  const name = pathMod ? pathMod.basename(normPath) : normPath.split(/[\\/]/).pop() || normPath;
  let size = 0;
  let mtimeMs = 0;
  let birthtimeMs = 0;
  if (fsMod) {
    try {
      const st = fsMod.statSync(normPath);
      size = Number(st?.size) || 0;
      mtimeMs = Number(st?.mtimeMs) || 0;
      birthtimeMs = Number(st?.birthtimeMs) || 0;
    } catch (_) {}
  }
  const meta = noteUtils.parseVideoEpisodeMeta(name);
  return {
    name,
    path: normPath,
    relPath: options.relPath || name,
    depth: 0,
    inSubfolder: false,
    topSubdirName: "",
    parentDirName: pathMod ? pathMod.basename(pathMod.dirname(normPath)) : "",
    episode: options.forcedEpisode !== undefined ? options.forcedEpisode : meta.episode,
    version: meta.version || 1,
    resolutionScore: meta.resolutionScore || 0,
    formatScore: meta.formatScore || 0,
    hasExplicitEp: options.forcedEpisode !== undefined ? true : Boolean(meta.hasExplicitEp),
    inferredFromFolder: false,
    isOvaCandidate: Boolean(meta.isOvaCandidate),
    isMovieOrSpecialCandidate: Boolean(meta.isMovieOrSpecialCandidate),
    extraKind: options.extraKind || meta.extraKind || "",
    fractionalEp: meta.fractionalEp,
    size,
    mtimeMs,
    birthtimeMs,
    addedTimeMs: Math.max(mtimeMs, birthtimeMs),
    sourceKind: options.sourceKind || "loose_file",
    sourceFolder: options.sourceFolder || "",
    isExplicitBind: Boolean(options.isExplicitBind),
    duplicates: []
  };
}

function makeEmptyResolvedResult(error, downloadPath = "", extra = {}) {
  return {
    error,
    downloadPath,
    fileCount: 0,
    newCount: 0,
    videoFiles: [],
    allRawVideoFiles: [],
    extraFiles: [],
    unwatchedFiles: [],
    maxEpisodeNumber: 0,
    nextEpisodeFile: null,
    nextEpisodeNumber: null,
    hasAttentionNeeded: Boolean(extra.hasMissingMedia),
    hasMissingMedia: Boolean(extra.hasMissingMedia),
    hasAnyBinding: Boolean(extra.hasAnyBinding),
    folders: extra.folders || [],
    looseFiles: extra.looseFiles || [],
    episodeMap: extra.episodeMap || {},
    extraClips: extra.extraClips || [],
    missingItems: extra.missingItems || [],
    offlineDrives: extra.offlineDrives || [],
    latestFileTimeMs: 0,
    latestUnwatchedTimeMs: 0,
    anomalies: {
      duplicateEpisodes: [],
      suspectedParentContainer: null,
      skippedOtherSeasonDirs: [],
      unnumberedMultipleVideos: [],
      hasBdmvStructure: false,
      incompleteCount: 0,
      subfolderStats: { totalInSubfolders: 0, subfolderNames: [] }
    }
  };
}

function finalizeWithWatchedCount(rawRes, watchedEpisodes) {
  const watched = Number(watchedEpisodes) || 0;
  const videoFiles = Array.isArray(rawRes.videoFiles) ? rawRes.videoFiles : [];
  const hasAnyExplicitEp = videoFiles.some((vf) => vf.hasExplicitEp);
  const unwatchedFiles = hasAnyExplicitEp
    ? videoFiles.filter((vf) => Number(vf.episode) > watched)
    : videoFiles.slice(watched);

  const targetNextEp = watched + 1;
  let nextEpisodeFile = null;
  let nextEpisodeNumber = null;
  const exactNext = videoFiles.find((vf) => Number(vf.episode) === targetNextEp);
  if (exactNext) {
    nextEpisodeFile = exactNext.path;
    nextEpisodeNumber = exactNext.episode;
  } else if (unwatchedFiles.length > 0) {
    nextEpisodeFile = unwatchedFiles[0].path;
    nextEpisodeNumber = unwatchedFiles[0].episode;
  } else if (watched < videoFiles.length && videoFiles[watched]) {
    nextEpisodeFile = videoFiles[watched].path;
    nextEpisodeNumber = videoFiles[watched].episode;
  }

  let latestFileTimeMs = 0;
  let latestUnwatchedTimeMs = 0;
  for (const vf of videoFiles) {
    const tMs = Math.max(
      Number(vf?.addedTimeMs) || 0,
      Number(vf?.mtimeMs) || 0,
      Number(vf?.birthtimeMs) || 0
    );
    if (tMs > latestFileTimeMs) latestFileTimeMs = tMs;
    if (Number(vf.episode) > watched && tMs > latestUnwatchedTimeMs) {
      latestUnwatchedTimeMs = tMs;
    }
  }

  return Object.assign({}, rawRes, {
    unwatchedFiles,
    newCount: hasAnyExplicitEp ? unwatchedFiles.length : Math.max(0, videoFiles.length - watched),
    nextEpisodeFile,
    nextEpisodeNumber,
    latestFileTimeMs,
    latestUnwatchedTimeMs: latestUnwatchedTimeMs || latestFileTimeMs
  });
}

/**
 * 全插件唯一本地视频解析真值层：合并主目录 + 额外目录 + 散落文件 + 单集锁定 + 特典
 */
function resolveAnimeLocalMedia(plugin, item, options = {}) {
  if (!item) return makeEmptyResolvedResult("无下载路径", "");

  const primaryRaw = String(item.downloadPath || "").trim();
  const primaryPath = primaryRaw && primaryRaw !== "无" ? normFsPath(primaryRaw) : "";
  const record = getAnimeBindingRecord(plugin, item);
  const hasBindingData = hasNonEmptyBindingRecord(record);
  const hasAnyBinding = Boolean(primaryPath || hasBindingData);
  const watched = Number(item.watchedEpisodes) || 0;

  if (!hasAnyBinding) {
    return makeEmptyResolvedResult("无下载路径", "", { hasAnyBinding: false });
  }

  if (!isDesktopNodeAvailable()) {
    return makeEmptyResolvedResult("移动端环境", primaryPath, {
      isMobile: true,
      hasAnyBinding,
      folders: primaryPath
        ? [{ path: primaryPath, isPrimary: true, status: "mobile" }]
        : [],
      looseFiles: record?.looseFiles || [],
      episodeMap: record?.episodeMap || {},
      extraClips: record?.extraClips || []
    });
  }

  if (plugin && !plugin._localMediaResolveCache) {
    plugin._localMediaResolveCache = new Map();
  }
  const cache = plugin?._localMediaResolveCache || null;
  const prefVer = plugin?.settings?.preferredEpisodeFiles
    ? Object.keys(plugin.settings.preferredEpisodeFiles).length
    : 0;
  const cacheKey = `${getAnimeBindingKey(item)}||${normPathCompareKey(primaryPath)}||${Number(record?.updatedAt) || 0}||${prefVer}`;
  const now = Date.now();
  if (!options.force && cache && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < RESOLVE_CACHE_TTL_MS) {
      return finalizeWithWatchedCount(cached.raw, watched);
    }
  }

  const folderEntries = [];
  const seenFolderKeys = new Set();
  const addFolderCandidate = (fp, isPrimary) => {
    const norm = normFsPath(fp);
    const k = normPathCompareKey(norm);
    if (!norm || !k || seenFolderKeys.has(k)) return;
    seenFolderKeys.add(k);
    const status = checkPathStatus(norm);
    folderEntries.push({ path: norm, isPrimary, status });
  };
  if (primaryPath) addFolderCandidate(primaryPath, true);
  if (record && Array.isArray(record.extraFolders)) {
    for (const ef of record.extraFolders) addFolderCandidate(ef, false);
  }

  const missingItems = [];
  const offlineDriveSet = new Set();
  const trackMissing = (entry) => {
    missingItems.push(entry);
    if (entry.status === "drive_offline") {
      const dr = extractDriveRoot(entry.path);
      if (dr) offlineDriveSet.add(dr);
    }
  };

  const folderMainCandidates = [];
  const collectedExtras = [];
  const seenFileKeys = new Set();
  const combinedSubfolderNames = new Set();
  let totalInSubfolders = 0;
  let suspectedParentContainer = null;
  const skippedOtherSeasonDirs = [];
  const unnumberedMultipleVideos = [];
  let hasBdmvStructure = false;
  let incompleteCount = 0;

  const preferredMap =
    options.preferredEpisodeFiles ||
    plugin?.settings?.preferredEpisodeFiles ||
    (typeof globalThis !== "undefined" ? globalThis.__BangumiPreferredEpisodeFiles : null) ||
    null;

  for (const fe of folderEntries) {
    if (fe.status !== "ok") {
      trackMissing({
        kind: "folder",
        path: fe.path,
        name: fe.path.split(/[\\/]/).pop() || fe.path,
        isPrimary: fe.isPrimary,
        status: fe.status
      });
      continue;
    }
    const res = noteUtils.inspectLocalFolder(fe.path, 0, { preferredEpisodeFiles: preferredMap });
    fe.fileCount = Number(res?.fileCount) || 0;
    if (res?.anomalies) {
      if (!suspectedParentContainer && res.anomalies.suspectedParentContainer?.detected) {
        suspectedParentContainer = {
          ...res.anomalies.suspectedParentContainer,
          sourceFolder: fe.path
        };
      }
      if (Array.isArray(res.anomalies.skippedOtherSeasonDirs)) {
        for (const s of res.anomalies.skippedOtherSeasonDirs) {
          if (!skippedOtherSeasonDirs.includes(s)) skippedOtherSeasonDirs.push(s);
        }
      }
      if (Array.isArray(res.anomalies.unnumberedMultipleVideos)) {
        for (const u of res.anomalies.unnumberedMultipleVideos) {
          unnumberedMultipleVideos.push(u);
        }
      }
      if (res.anomalies.hasBdmvStructure) hasBdmvStructure = true;
      incompleteCount += Number(res.anomalies.incompleteCount) || 0;
      totalInSubfolders += Number(res.anomalies.subfolderStats?.totalInSubfolders) || 0;
      for (const sn of res.anomalies.subfolderStats?.subfolderNames || []) {
        combinedSubfolderNames.add(sn);
      }
    }

    const folderVideos = [];
    for (const vf of res?.videoFiles || []) {
      if (!vf) continue;
      folderVideos.push(vf);
      if (Array.isArray(vf.duplicates)) {
        for (const dv of vf.duplicates) {
          if (dv) folderVideos.push(dv);
        }
      }
    }
    for (const vf of folderVideos) {
      const fk = normPathCompareKey(vf.path);
      if (!fk || seenFileKeys.has(fk)) continue;
      seenFileKeys.add(fk);
      folderMainCandidates.push(
        Object.assign({}, vf, {
          sourceKind: fe.isPrimary ? "primary_folder" : "extra_folder",
          sourceFolder: fe.path
        })
      );
    }
    for (const ex of res?.extraFiles || []) {
      const ek = normPathCompareKey(ex.path);
      if (!ek || seenFileKeys.has(ek)) continue;
      seenFileKeys.add(ek);
      collectedExtras.push(
        Object.assign({}, ex, {
          sourceKind: fe.isPrimary ? "primary_folder" : "extra_folder",
          sourceFolder: fe.path
        })
      );
    }
  }

  // 散落单文件
  const looseMainExplicit = [];
  const looseMainUnnumbered = [];
  const looseStatusList = [];
  for (const lf of record?.looseFiles || []) {
    const status = checkPathStatus(lf.path);
    looseStatusList.push(Object.assign({}, lf, { status }));
    if (status !== "ok") {
      trackMissing({
        kind: "loose_file",
        path: lf.path,
        name: lf.name || lf.path.split(/[\\/]/).pop(),
        status
      });
      continue;
    }
    const fk = normPathCompareKey(lf.path);
    if (seenFileKeys.has(fk)) continue;
    seenFileKeys.add(fk);

    const fileObj = buildFileMetaObj(lf.path, { sourceKind: "loose_file" });
    const meta = noteUtils.parseVideoEpisodeMeta(fileObj.name);
    if (meta.isExtra) {
      collectedExtras.push(fileObj);
    } else if (fileObj.hasExplicitEp && fileObj.episode !== null) {
      looseMainExplicit.push(fileObj);
    } else {
      looseMainUnnumbered.push(fileObj);
    }
  }

  // 显式关联的特典
  const extraClipStatusList = [];
  for (const clip of record?.extraClips || []) {
    const status = checkPathStatus(clip.path);
    extraClipStatusList.push(Object.assign({}, clip, { status }));
    if (status !== "ok") {
      trackMissing({
        kind: "extra_clip",
        path: clip.path,
        name: clip.name || clip.path.split(/[\\/]/).pop(),
        status
      });
      continue;
    }
    const ek = normPathCompareKey(clip.path);
    if (seenFileKeys.has(ek)) continue;
    seenFileKeys.add(ek);
    collectedExtras.push(
      buildFileMetaObj(clip.path, {
        sourceKind: "extra_bind",
        extraKind: clip.label || "特典"
      })
    );
  }

  // 预先收集所有「单集锁定」的路径 -> 锁定集数，避免同一文件因文件名数字被重复识别到错误集数
  const explicitBoundPathsToEp = new Map();
  if (record?.episodeMap && typeof record.episodeMap === "object") {
    for (const [epKey, epBind] of Object.entries(record.episodeMap)) {
      const epNum = parseInt(epKey, 10);
      if (!Number.isFinite(epNum) || epNum < 0 || !epBind?.path) continue;
      const pk = normPathCompareKey(epBind.path);
      if (pk) explicitBoundPathsToEp.set(pk, epNum);
    }
  }

  // 合并正片候选按集数分组
  const byEp = new Map();
  const folderUnnumbered = [];
  const pushToEpMap = (cand) => {
    const pk = normPathCompareKey(cand.path);
    const lockedEp = pk ? explicitBoundPathsToEp.get(pk) : undefined;
    if (lockedEp !== undefined && cand.episode !== lockedEp) {
      return;
    }
    if (cand.hasExplicitEp && cand.episode !== null && Number.isFinite(cand.episode)) {
      if (!byEp.has(cand.episode)) byEp.set(cand.episode, []);
      byEp.get(cand.episode).push(cand);
    } else if (lockedEp === undefined) {
      folderUnnumbered.push(cand);
    }
  };
  for (const fc of folderMainCandidates) pushToEpMap(fc);
  for (const le of looseMainExplicit) pushToEpMap(le);

  // 未带明确集数的散落视频处理：若全库尚无任何正片且仅 1 个散落视频（剧场版/OVA/单集），直接归为第 1 集；否则顺序编号并提醒
  const filteredLooseUnnumbered = looseMainUnnumbered.filter(
    (u) => !explicitBoundPathsToEp.has(normPathCompareKey(u.path))
  );
  const allUnnumbered = [...folderUnnumbered, ...filteredLooseUnnumbered];
  if (byEp.size === 0 && explicitBoundPathsToEp.size === 0 && allUnnumbered.length > 0) {
    allUnnumbered.sort((a, b) =>
      (a.relPath || a.name).localeCompare(b.relPath || b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    allUnnumbered.forEach((u, idx) => {
      const assigned = idx + 1;
      u.episode = assigned;
      if (!byEp.has(assigned)) byEp.set(assigned, []);
      byEp.get(assigned).push(u);
    });
    if (allUnnumbered.length >= 2) {
      for (const u of allUnnumbered) {
        if (!unnumberedMultipleVideos.includes(u.relPath || u.name)) {
          unnumberedMultipleVideos.push(u.relPath || u.name);
        }
      }
    }
  } else if ((byEp.size > 0 || explicitBoundPathsToEp.size > 0) && filteredLooseUnnumbered.length > 0) {
    for (const u of filteredLooseUnnumbered) {
      if (!unnumberedMultipleVideos.includes(u.name)) {
        unnumberedMultipleVideos.push(u.name);
      }
    }
  }

  // 应用用户「单集锁定」（最高优先级）
  const explicitEpMapEntries = new Map();
  const episodeMapStatus = {};
  if (record?.episodeMap && typeof record.episodeMap === "object") {
    for (const [epKey, epBind] of Object.entries(record.episodeMap)) {
      const epNum = parseInt(epKey, 10);
      if (!Number.isFinite(epNum) || epNum < 0 || !epBind?.path) continue;
      const status = checkPathStatus(epBind.path);
      episodeMapStatus[String(epNum)] = Object.assign({}, epBind, { status });
      if (status !== "ok") {
        trackMissing({
          kind: "episode",
          episode: epNum,
          path: epBind.path,
          name: epBind.name || epBind.path.split(/[\\/]/).pop(),
          status
        });
        continue;
      }
      const boundObj = buildFileMetaObj(epBind.path, {
        forcedEpisode: epNum,
        sourceKind: "episode_bind",
        isExplicitBind: true
      });
      explicitEpMapEntries.set(epNum, boundObj);
    }
  }

  const isPreferredPath = (fp) => {
    if (!preferredMap || !fp) return false;
    const normKey = String(fp).replace(/\\/g, "/").toLowerCase();
    return Boolean(preferredMap[normKey] || preferredMap[fp]);
  };
  const rankCandidate = (a, b) => {
    const aPref = isPreferredPath(a.path) ? 1 : 0;
    const bPref = isPreferredPath(b.path) ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    if ((a.version || 1) !== (b.version || 1)) return (b.version || 1) - (a.version || 1);
    if ((a.resolutionScore || 0) !== (b.resolutionScore || 0)) return (b.resolutionScore || 0) - (a.resolutionScore || 0);
    if ((a.formatScore || 0) !== (b.formatScore || 0)) return (b.formatScore || 0) - (a.formatScore || 0);
    if (a.depth !== b.depth) return a.depth - b.depth;
    if ((a.size || 0) !== (b.size || 0)) return (b.size || 0) - (a.size || 0);
    return (a.relPath || a.name).localeCompare(b.relPath || b.name, undefined, { numeric: true, sensitivity: "base" });
  };

  // 确保所有显式单集绑定的集数都在集数集合中
  const allEpNums = new Set([...byEp.keys(), ...explicitEpMapEntries.keys()]);
  const videoFiles = [];
  const duplicateEpisodes = [];

  for (const epNum of Array.from(allEpNums).sort((a, b) => a - b)) {
    const group = (byEp.get(epNum) || []).slice();
    const explicitFile = explicitEpMapEntries.get(epNum) || null;

    if (explicitFile) {
      const expKey = normPathCompareKey(explicitFile.path);
      const otherCands = group.filter((c) => normPathCompareKey(c.path) !== expKey);
      otherCands.sort(rankCandidate);
      explicitFile.duplicates = otherCands;
      videoFiles.push(explicitFile);
      continue;
    }

    if (group.length === 0) continue;
    group.sort(rankCandidate);
    const primary = Object.assign({}, group[0]);
    const rest = group.slice(1);
    primary.duplicates = rest;
    videoFiles.push(primary);
    if (rest.length > 0) {
      duplicateEpisodes.push({
        episode: epNum,
        primaryFile: primary,
        duplicateFiles: rest,
        allFiles: [primary, ...rest]
      });
    }
  }

  const maxEpisodeNumber = videoFiles.reduce(
    (mx, vf) => (Number.isFinite(vf.episode) && vf.episode > mx ? vf.episode : mx),
    0
  );

  let resolvedError = null;
  if (videoFiles.length === 0 && collectedExtras.length === 0) {
    if (missingItems.length > 0) {
      resolvedError = offlineDriveSet.size > 0 ? "磁盘未接入" : "文件或文件夹不存在";
    } else if (folderEntries.every((f) => f.status === "ok")) {
      resolvedError = null;
    } else {
      resolvedError = "文件夹不存在";
    }
  }

  const hasMissingMedia = missingItems.length > 0;
  const hasAttentionNeeded = Boolean(
    duplicateEpisodes.length > 0 ||
      suspectedParentContainer?.detected ||
      skippedOtherSeasonDirs.length > 0 ||
      unnumberedMultipleVideos.length > 0 ||
      hasMissingMedia ||
      (hasBdmvStructure && videoFiles.length === 0)
  );

  const rawResult = {
    error: resolvedError,
    downloadPath: primaryPath,
    fileCount: videoFiles.length,
    newCount: 0,
    videoFiles,
    allRawVideoFiles: [...folderMainCandidates, ...looseMainExplicit, ...looseMainUnnumbered],
    extraFiles: collectedExtras,
    unwatchedFiles: [],
    maxEpisodeNumber,
    nextEpisodeFile: null,
    nextEpisodeNumber: null,
    hasAttentionNeeded,
    hasMissingMedia,
    hasAnyBinding: true,
    folders: folderEntries,
    looseFiles: looseStatusList,
    episodeMap: episodeMapStatus,
    extraClips: extraClipStatusList,
    missingItems,
    offlineDrives: Array.from(offlineDriveSet),
    anomalies: {
      duplicateEpisodes,
      suspectedParentContainer,
      skippedOtherSeasonDirs,
      unnumberedMultipleVideos,
      hasBdmvStructure,
      incompleteCount,
      subfolderStats: {
        totalInSubfolders,
        subfolderNames: Array.from(combinedSubfolderNames)
      }
    }
  };

  if (cache) {
    cache.set(cacheKey, { ts: now, raw: rawResult });
  }
  return finalizeWithWatchedCount(rawResult, watched);
}

/* ============================== 写回与绑定操作 ============================== */

async function writeNotePrimaryDownloadPath(plugin, item, nextPath, resolvedOverride = null) {
  const cleanPath = String(nextPath || "").trim();
  const targetFile =
    item?.file ||
    (item?.path && plugin?.app?.vault ? plugin.app.vault.getAbstractFileByPath(item.path) : null);
  if (!targetFile || !plugin?.app?.vault) {
    item.downloadPath = cleanPath || "无";
    return false;
  }

  let content = await plugin.app.vault.read(targetFile);
  if (typeof noteUtils.inspectAndUpgradeAnimeNoteContent === "function") {
    const upg = noteUtils.inspectAndUpgradeAnimeNoteContent(content, {
      ...(typeof plugin.getScoreDisplayOptions === "function" ? plugin.getScoreDisplayOptions() : {}),
      cachedPersonalScore: plugin.settings?.personalRatingCache?.[targetFile.path] || ""
    });
    if (upg.isTargetAnimeNote && upg.needsUpgrade) content = upg.upgradedContent;
  }
  const hasRealPath = Boolean(cleanPath && cleanPath !== "无");
  const statusRes =
    resolvedOverride ||
    (isDesktopNodeAvailable() && hasRealPath
      ? noteUtils.inspectLocalFolder(cleanPath, item?.watchedEpisodes)
      : { downloadPath: hasRealPath ? cleanPath : "", error: null, newCount: 0 });

  content = noteUtils.updateFrontmatterField(content, "下载路径", hasRealPath ? cleanPath : "无");
  content = noteUtils.updateFrontmatterField(content, "本地更新状态", noteUtils.getLocalStatusText(statusRes));
  content = noteUtils.updateFolderLine(content, {
    downloadPath: hasRealPath ? cleanPath : "",
    error: null
  });
  content = noteUtils.syncNoteCalloutFromFrontmatter(content);

  if (typeof plugin.modifyNoteSafely === "function") {
    await plugin.modifyNoteSafely(targetFile, content, 2800);
  } else {
    await plugin.app.vault.modify(targetFile, content);
  }
  item.file = targetFile;
  item.downloadPath = hasRealPath ? cleanPath : "无";
  return true;
}

function recordStagingPoolLinks(plugin, paths, animeKey) {
  ensureLocalMediaSettingsShape(plugin);
  const pool = plugin.settings.localMediaStagingPool;
  const keySet = new Set((Array.isArray(paths) ? paths : [paths]).map(normPathCompareKey).filter(Boolean));
  if (keySet.size === 0 || !animeKey) return false;
  let changed = false;
  for (const entry of pool) {
    if (!entry || !entry.path) continue;
    if (keySet.has(normPathCompareKey(entry.path))) {
      if (!Array.isArray(entry.linkedAnimeKeys)) entry.linkedAnimeKeys = [];
      if (!entry.linkedAnimeKeys.includes(animeKey)) {
        entry.linkedAnimeKeys.push(animeKey);
        changed = true;
      }
    }
  }
  return changed;
}

async function bindFolderToAnime(plugin, item, folderPath, options = {}) {
  const norm = normFsPath(folderPath);
  if (!norm || !item) return { ok: false, reason: "路径无效" };
  ensureLocalMediaSettingsShape(plugin);
  const { key, record } = ensureAnimeBindingRecord(plugin, item);
  const curPrimary = String(item.downloadPath || "").trim();
  const hasPrimary = Boolean(curPrimary && curPrimary !== "无");
  const normKey = normPathCompareKey(norm);

  if (!hasPrimary || options.replacePrimary) {
    if (hasPrimary && options.replacePrimary && normPathCompareKey(curPrimary) !== normKey) {
      if (!record.extraFolders.some((f) => normPathCompareKey(f) === normPathCompareKey(curPrimary))) {
        record.extraFolders.push(normFsPath(curPrimary));
      }
    }
    record.extraFolders = record.extraFolders.filter((f) => normPathCompareKey(f) !== normKey);
    record.updatedAt = Date.now();
    await writeNotePrimaryDownloadPath(plugin, item, norm);
  } else if (normPathCompareKey(curPrimary) !== normKey) {
    if (!record.extraFolders.some((f) => normPathCompareKey(f) === normKey)) {
      record.extraFolders.push(norm);
    }
    record.updatedAt = Date.now();
  }

  recordStagingPoolLinks(plugin, [norm], key);
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true, path: norm };
}

async function unbindFolderFromAnime(plugin, item, folderPath) {
  const targetKey = normPathCompareKey(folderPath);
  if (!targetKey || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { record } = ensureAnimeBindingRecord(plugin, item);
  const curPrimary = String(item.downloadPath || "").trim();
  const isRemovingPrimary = Boolean(curPrimary && curPrimary !== "无" && normPathCompareKey(curPrimary) === targetKey);

  record.extraFolders = record.extraFolders.filter((f) => normPathCompareKey(f) !== targetKey);
  record.updatedAt = Date.now();

  if (isRemovingPrimary) {
    const promoted = record.extraFolders.shift() || "";
    await writeNotePrimaryDownloadPath(plugin, item, promoted);
  }
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true };
}

async function bindLooseFilesToAnime(plugin, item, filePaths) {
  const list = (Array.isArray(filePaths) ? filePaths : [filePaths]).map(normFsPath).filter(Boolean);
  if (list.length === 0 || !item) return { ok: false, count: 0 };
  ensureLocalMediaSettingsShape(plugin);
  const { key, record } = ensureAnimeBindingRecord(plugin, item);
  const existingKeys = new Set(record.looseFiles.map((f) => normPathCompareKey(f.path)));
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  let added = 0;

  for (const fp of list) {
    const k = normPathCompareKey(fp);
    if (!k || existingKeys.has(k)) continue;
    existingKeys.add(k);
    let size = 0;
    let mtimeMs = 0;
    if (fsMod) {
      try {
        const st = fsMod.statSync(fp);
        size = Number(st?.size) || 0;
        mtimeMs = Number(st?.mtimeMs) || 0;
      } catch (_) {}
    }
    record.looseFiles.push({
      path: fp,
      name: pathMod ? pathMod.basename(fp) : fp.split(/[\\/]/).pop() || fp,
      size,
      mtimeMs,
      addedAt: Date.now()
    });
    added += 1;
  }

  record.updatedAt = Date.now();
  recordStagingPoolLinks(plugin, list, key);
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true, count: added };
}

async function unbindLooseFileFromAnime(plugin, item, filePath) {
  const targetKey = normPathCompareKey(filePath);
  if (!targetKey || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { record } = ensureAnimeBindingRecord(plugin, item);
  record.looseFiles = record.looseFiles.filter((f) => normPathCompareKey(f.path) !== targetKey);
  record.updatedAt = Date.now();
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true };
}

async function bindEpisodeFileToAnime(plugin, item, episodeNum, filePath) {
  const ep = parseInt(episodeNum, 10);
  const fp = normFsPath(filePath);
  if (!Number.isFinite(ep) || ep < 0 || !fp || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { key, record } = ensureAnimeBindingRecord(plugin, item);
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  let size = 0;
  let mtimeMs = 0;
  if (fsMod) {
    try {
      const st = fsMod.statSync(fp);
      size = Number(st?.size) || 0;
      mtimeMs = Number(st?.mtimeMs) || 0;
    } catch (_) {}
  }

  record.episodeMap[String(ep)] = {
    path: fp,
    name: pathMod ? pathMod.basename(fp) : fp.split(/[\\/]/).pop() || fp,
    size,
    mtimeMs,
    boundAt: Date.now()
  };
  record.updatedAt = Date.now();

  // 同步清理旧 preferredEpisodeFiles 对同集的冲突标记，保证新绑定即刻生效
  if (plugin.settings.preferredEpisodeFiles && typeof plugin.settings.preferredEpisodeFiles === "object") {
    const resolvedBefore = resolveAnimeLocalMedia(plugin, item, { force: true });
    const dupMatch = (resolvedBefore.videoFiles || []).find((vf) => Number(vf.episode) === ep);
    if (dupMatch) {
      for (const cand of [dupMatch, ...(dupMatch.duplicates || [])]) {
        const legacyKey = String(cand.path || "").replace(/\\/g, "/").toLowerCase();
        delete plugin.settings.preferredEpisodeFiles[legacyKey];
      }
    }
    plugin.settings.preferredEpisodeFiles[fp.replace(/\\/g, "/").toLowerCase()] = true;
    globalThis.__BangumiPreferredEpisodeFiles = plugin.settings.preferredEpisodeFiles;
  }

  recordStagingPoolLinks(plugin, [fp], key);
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true, episode: ep, path: fp };
}

async function unbindEpisodeFileFromAnime(plugin, item, episodeNum) {
  const ep = parseInt(episodeNum, 10);
  if (!Number.isFinite(ep) || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { record } = ensureAnimeBindingRecord(plugin, item);
  const existing = record.episodeMap[String(ep)];
  if (existing && plugin.settings.preferredEpisodeFiles) {
    delete plugin.settings.preferredEpisodeFiles[String(existing.path || "").replace(/\\/g, "/").toLowerCase()];
  }
  delete record.episodeMap[String(ep)];
  record.updatedAt = Date.now();
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true };
}

async function bindExtraClipToAnime(plugin, item, filePath, label = "特典") {
  const fp = normFsPath(filePath);
  if (!fp || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { key, record } = ensureAnimeBindingRecord(plugin, item);
  const k = normPathCompareKey(fp);
  if (!record.extraClips.some((c) => normPathCompareKey(c.path) === k)) {
    const fsMod = tryRequireNode("fs");
    const pathMod = tryRequireNode("path");
    let size = 0;
    let mtimeMs = 0;
    if (fsMod) {
      try {
        const st = fsMod.statSync(fp);
        size = Number(st?.size) || 0;
        mtimeMs = Number(st?.mtimeMs) || 0;
      } catch (_) {}
    }
    record.extraClips.push({
      path: fp,
      name: pathMod ? pathMod.basename(fp) : fp.split(/[\\/]/).pop() || fp,
      label: String(label || "特典"),
      size,
      mtimeMs,
      boundAt: Date.now()
    });
  }
  record.updatedAt = Date.now();
  recordStagingPoolLinks(plugin, [fp], key);
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true };
}

async function unbindExtraClipFromAnime(plugin, item, filePath) {
  const targetKey = normPathCompareKey(filePath);
  if (!targetKey || !item) return { ok: false };
  ensureLocalMediaSettingsShape(plugin);
  const { record } = ensureAnimeBindingRecord(plugin, item);
  record.extraClips = record.extraClips.filter((c) => normPathCompareKey(c.path) !== targetKey);
  record.updatedAt = Date.now();
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin, item);
  return { ok: true };
}

/* ============================== 暂存区管理 ============================== */

function buildStagingItemMetadata(rawPath) {
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  const norm = normFsPath(rawPath);
  if (!norm || !fsMod || !pathMod) return null;
  let st;
  try {
    st = fsMod.statSync(norm);
  } catch (_) {
    return null;
  }
  const isDir = typeof st.isDirectory === "function" && st.isDirectory();
  const isFile = typeof st.isFile === "function" && st.isFile();
  if (!isDir && !isFile) return null;
  const name = pathMod.basename(norm) || norm;
  if (isFile && !VIDEO_EXT_SET.has(extnameLower(name))) {
    return null;
  }

  const parentDir = pathMod.dirname(norm);
  const parentName = pathMod.basename(parentDir) || parentDir;
  let videoCount = isFile ? 1 : 0;
  let detectedEp = null;
  if (isFile) {
    const meta = noteUtils.parseVideoEpisodeMeta(name);
    detectedEp = !meta.isExtra ? meta.episode : null;
  } else {
    try {
      const ents = fsMod.readdirSync(norm, { withFileTypes: true });
      for (const ent of ents) {
        if (ent.isFile() && VIDEO_EXT_SET.has(extnameLower(ent.name))) videoCount += 1;
      }
      if (videoCount === 0) {
        for (const ent of ents) {
          if (!ent.isDirectory()) continue;
          const subPath = pathMod.join(norm, ent.name);
          try {
            for (const sub of fsMod.readdirSync(subPath, { withFileTypes: true })) {
              if (sub.isFile() && VIDEO_EXT_SET.has(extnameLower(sub.name))) videoCount += 1;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  const id = `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    path: norm,
    kind: isDir ? "folder" : "file",
    name,
    parentPath: parentDir,
    parentName,
    size: isFile ? Number(st.size) || 0 : 0,
    mtimeMs: Number(st.mtimeMs) || 0,
    videoCount,
    detectedEp,
    groupHint: isDir ? name : parentName,
    addedAt: Date.now(),
    linkedAnimeKeys: []
  };
}

async function addItemsToStagingPool(plugin, rawPaths) {
  if (!isDesktopNodeAvailable()) return { added: 0, skipped: 0, items: [] };
  ensureLocalMediaSettingsShape(plugin);
  const list = Array.isArray(rawPaths) ? rawPaths : [rawPaths];
  const pool = plugin.settings.localMediaStagingPool;
  const existingKeys = new Set(pool.map((p) => normPathCompareKey(p.path)));
  const addedItems = [];
  let skipped = 0;

  for (const raw of list) {
    const norm = normFsPath(raw);
    const k = normPathCompareKey(norm);
    if (!k || existingKeys.has(k)) {
      skipped += 1;
      continue;
    }
    const meta = buildStagingItemMetadata(norm);
    if (!meta) {
      skipped += 1;
      continue;
    }
    existingKeys.add(k);
    pool.push(meta);
    addedItems.push(meta);
  }

  if (addedItems.length > 0 && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return { added: addedItems.length, skipped, items: addedItems };
}

async function removeFromStagingPool(plugin, idsOrPaths) {
  ensureLocalMediaSettingsShape(plugin);
  const set = new Set((Array.isArray(idsOrPaths) ? idsOrPaths : [idsOrPaths]).map(String));
  const pathSet = new Set((Array.isArray(idsOrPaths) ? idsOrPaths : [idsOrPaths]).map(normPathCompareKey));
  const before = plugin.settings.localMediaStagingPool.length;
  plugin.settings.localMediaStagingPool = plugin.settings.localMediaStagingPool.filter(
    (entry) => !set.has(String(entry.id)) && !pathSet.has(normPathCompareKey(entry.path))
  );
  const removed = before - plugin.settings.localMediaStagingPool.length;
  if (removed > 0 && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  return removed;
}

async function replaceStagingPoolItemPath(plugin, itemId, nextPath) {
  ensureLocalMediaSettingsShape(plugin);
  const meta = buildStagingItemMetadata(nextPath);
  if (!meta) return false;
  const idx = plugin.settings.localMediaStagingPool.findIndex((p) => p.id === itemId);
  if (idx < 0) return false;
  const prev = plugin.settings.localMediaStagingPool[idx];
  plugin.settings.localMediaStagingPool[idx] = Object.assign({}, meta, {
    id: prev.id,
    addedAt: prev.addedAt,
    linkedAnimeKeys: Array.isArray(prev.linkedAnimeKeys) ? prev.linkedAnimeKeys : []
  });
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  return true;
}

async function clearStagingPool(plugin, options = {}) {
  ensureLocalMediaSettingsShape(plugin);
  const linkedOnly = Boolean(options.linkedOnly);
  if (linkedOnly) {
    plugin.settings.localMediaStagingPool = plugin.settings.localMediaStagingPool.filter(
      (entry) => !Array.isArray(entry.linkedAnimeKeys) || entry.linkedAnimeKeys.length === 0
    );
  } else {
    plugin.settings.localMediaStagingPool = [];
  }
  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
}

function inspectStagingPoolHealth(plugin) {
  ensureLocalMediaSettingsShape(plugin);
  return plugin.settings.localMediaStagingPool.map((entry) => ({
    ...entry,
    status: checkPathStatus(entry.path)
  }));
}

/* ============================== 异步目录浏览器 ============================== */

async function readDirectoryEntriesAsync(dirPath, options = {}) {
  if (!isDesktopNodeAvailable()) return { ok: false, error: "移动端环境", entries: [] };
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  if (!fsMod || !pathMod) return { ok: false, error: "文件系统不可用", entries: [] };

  const normDir = normFsPath(dirPath);
  if (!normDir || !fsMod.existsSync(normDir)) {
    return { ok: false, error: "文件夹不存在", dirPath: normDir, entries: [] };
  }

  const readdirAsync =
    fsMod.promises && typeof fsMod.promises.readdir === "function"
      ? (p) => fsMod.promises.readdir(p, { withFileTypes: true })
      : async (p) => fsMod.readdirSync(p, { withFileTypes: true });
  const statAsync =
    fsMod.promises && typeof fsMod.promises.stat === "function"
      ? (p) => fsMod.promises.stat(p)
      : async (p) => fsMod.statSync(p);

  const videosOnly = options.videosOnly !== false;
  const query = normalizeUnicodeNfc(String(options.query || "").trim()).toLowerCase();
  const skipDirs = noteUtils.SKIP_PURE_ASSET_DIRS || new Set();

  let rawEnts = [];
  try {
    rawEnts = await readdirAsync(normDir);
  } catch (err) {
    return { ok: false, error: err?.message || "读取目录失败", dirPath: normDir, entries: [] };
  }

  const dirs = [];
  const files = [];

  for (const ent of rawEnts) {
    if (!ent || !ent.name) continue;
    const name = String(ent.name);
    const low = name.toLowerCase();
    if (low.startsWith(".") || low === "$recycle.bin" || low === "system volume information") continue;
    const isDir = typeof ent.isDirectory === "function" && ent.isDirectory();
    const isFile = typeof ent.isFile === "function" && ent.isFile();
    if (!isDir && !isFile) continue;

    if (query && !normalizeUnicodeNfc(name).toLowerCase().includes(query)) continue;

    const fullPath = pathMod.join(normDir, name);
    if (isDir) {
      if (skipDirs.has(low)) continue;
      dirs.push({
        kind: "folder",
        name,
        path: fullPath,
        size: 0,
        mtimeMs: 0,
        detectedEp: null,
        isExtra: false,
        extraKind: ""
      });
    } else if (isFile) {
      const ext = extnameLower(name);
      const isVideo = VIDEO_EXT_SET.has(ext);
      if (videosOnly && !isVideo) continue;
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = await statAsync(fullPath);
        size = Number(st?.size) || 0;
        mtimeMs = Number(st?.mtimeMs) || 0;
      } catch (_) {}
      const meta = isVideo ? noteUtils.parseVideoEpisodeMeta(name) : null;
      files.push({
        kind: "file",
        isVideo,
        name,
        path: fullPath,
        size,
        mtimeMs,
        detectedEp: meta && !meta.isExtra ? meta.episode : null,
        isExtra: Boolean(meta?.isExtra),
        extraKind: meta?.extraKind || "",
        resolutionScore: meta?.resolutionScore || 0
      });
    }
  }

  const cmp = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  dirs.sort(cmp);
  files.sort(cmp);
  return {
    ok: true,
    dirPath: normDir,
    parentPath: pathMod.dirname(normDir) !== normDir ? pathMod.dirname(normDir) : "",
    entries: [...dirs, ...files]
  };
}

/* ============================== 智能预扫描匹配 ============================== */

const CLEAN_BRACKETS_RX = /\[[^\]]*\]|\([^\)]*\)|【[^】]*】/g;
const CLEAN_TECH_RX = /\b(?:1080[pi]?|720p|2160p|4k|uhd|fhd|bdrip|webrip|web-dl|bluray|x264|x265|hevc|avc|av1|10bit|8bit|flac|aac|mp4|mkv|chs|cht|gb|big5|jpn|sub|raw|fin|end)\b/gi;

function normalizeMatchText(raw) {
  return normalizeUnicodeNfc(String(raw || ""))
    .replace(/\.[^/.]+$/, "")
    .replace(CLEAN_BRACKETS_RX, " ")
    .replace(CLEAN_TECH_RX, " ")
    .replace(/第\s*\d+\s*[话集話]/g, " ")
    .replace(/[\s_\-!！?？:：~～·.。,，、'"“”‘’/\\]+/g, "")
    .toLowerCase();
}

function buildBigrams(str) {
  const s = String(str || "");
  if (s.length < 2) return new Set(s ? [s] : []);
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

function scoreTitleMatch(candidateName, animeItem) {
  const candSeason = noteUtils.parseExplicitSeasonNumber(candidateName);
  const candNorm = normalizeMatchText(candidateName);
  if (!candNorm || candNorm.length < 2) return 0;

  const titleCandidates = [
    animeItem?.name,
    animeItem?.japaneseName,
    animeItem?.file?.basename,
    animeItem?.downloadSourceKeyword,
    animeItem?.name ? getSafeFileName(animeItem.name) : ""
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  let bestScore = 0;
  for (const rawTitle of titleCandidates) {
    const titleNorm = normalizeMatchText(rawTitle);
    if (!titleNorm || titleNorm.length < 2) continue;

    let sc = 0;
    if (candNorm === titleNorm) {
      sc = 98;
    } else if (candNorm.includes(titleNorm) || titleNorm.includes(candNorm)) {
      const shorter = Math.min(candNorm.length, titleNorm.length);
      const longer = Math.max(candNorm.length, titleNorm.length);
      const ratio = shorter / Math.max(1, longer);
      if (shorter >= 3 && ratio >= 0.42) {
        sc = Math.round(76 + ratio * 18);
      } else if (shorter >= 2) {
        sc = Math.round(45 + ratio * 30);
      }
    } else {
      const bgA = buildBigrams(candNorm);
      const bgB = buildBigrams(titleNorm);
      let hit = 0;
      for (const b of bgA) {
        if (bgB.has(b)) hit += 1;
      }
      if (hit > 0) {
        const dice = (2 * hit) / (bgA.size + bgB.size);
        sc = Math.round(dice * 90);
      }
    }

    const titleSeason = noteUtils.parseExplicitSeasonNumber(rawTitle);
    if (candSeason !== null || titleSeason !== null) {
      const effCand = candSeason || 1;
      const effTitle = titleSeason || 1;
      if (effCand === effTitle && candSeason !== null && titleSeason !== null) {
        sc = Math.min(100, sc + 6);
      } else if (effCand !== effTitle) {
        sc = Math.max(0, sc - 45);
      }
    }

    if (sc > bestScore) bestScore = sc;
  }
  return bestScore;
}

async function scanLocalDirectoriesForSuggestions(plugin, scanDirs, animeItems, options = {}) {
  if (!isDesktopNodeAvailable()) {
    return { ok: false, high: [], medium: [], unmatched: [], scannedDirs: 0 };
  }
  const fsMod = tryRequireNode("fs");
  const pathMod = tryRequireNode("path");
  if (!fsMod || !pathMod) {
    return { ok: false, high: [], medium: [], unmatched: [], scannedDirs: 0 };
  }

  const readdirAsync =
    fsMod.promises && typeof fsMod.promises.readdir === "function"
      ? (p) => fsMod.promises.readdir(p, { withFileTypes: true })
      : async (p) => fsMod.readdirSync(p, { withFileTypes: true });
  const statAsync =
    fsMod.promises && typeof fsMod.promises.stat === "function"
      ? (p) => fsMod.promises.stat(p)
      : async (p) => fsMod.statSync(p);

  const items = (Array.isArray(animeItems) ? animeItems : []).filter((it) => it && !it.isSamplePreviewItem);
  const existingBoundKeys = new Set();
  for (const it of items) {
    if (it.downloadPath && it.downloadPath !== "无") {
      existingBoundKeys.add(`${getAnimeBindingKey(it)}::${normPathCompareKey(it.downloadPath)}`);
    }
    const rec = getAnimeBindingRecord(plugin, it);
    if (rec) {
      for (const f of rec.extraFolders || []) existingBoundKeys.add(`${getAnimeBindingKey(it)}::${normPathCompareKey(f)}`);
      for (const lf of rec.looseFiles || []) existingBoundKeys.add(`${getAnimeBindingKey(it)}::${normPathCompareKey(lf.path)}`);
    }
  }

  const skipDirs = noteUtils.SKIP_PURE_ASSET_DIRS || new Set();
  const genericRootRx = noteUtils.GENERIC_PARENT_ROOT_NAME_RX || /^(?:Anime|ACG|番剧|动画|Downloads)$/i;
  const extraSubdirRx = noteUtils.EXTRA_SUBDIR_NAME_RX || /^(?:sp|ova|ncop|nced|pv|cm|特典)$/i;
  const maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 3;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const signal = options.signal || null;

  const candidates = [];
  const seenCandPaths = new Set();
  let scannedDirCount = 0;

  const walk = async (dirPath, depth) => {
    if (signal?.aborted) return;
    const norm = normFsPath(dirPath);
    if (!norm || !fsMod.existsSync(norm)) return;
    scannedDirCount += 1;
    if (onProgress && scannedDirCount % 4 === 0) {
      onProgress({ scannedDirs: scannedDirCount, currentDir: norm, candidatesFound: candidates.length });
    }

    let entries = [];
    try {
      entries = await readdirAsync(norm);
    } catch (_) {
      return;
    }

    const baseName = pathMod.basename(norm);
    const directVideos = [];
    const childDirs = [];

    for (const ent of entries) {
      if (!ent || !ent.name) continue;
      const name = String(ent.name);
      const low = name.toLowerCase();
      if (low.startsWith(".") || low === "$recycle.bin" || low === "system volume information") continue;
      if (ent.isFile() && VIDEO_EXT_SET.has(extnameLower(name))) {
        directVideos.push(name);
      } else if (ent.isDirectory() && !skipDirs.has(low) && !extraSubdirRx.test(low)) {
        childDirs.push(name);
      }
    }

    // 判定当前目录是否为可直接当成「一部番」的叶子目录（非根目录且非明显容器目录）
    const isRootScanned = depth === 0;
    const isContainerLike = isRootScanned || genericRootRx.test(baseName.trim());

    if (!isContainerLike && directVideos.length >= 1) {
      // 检查是否混放了多部完全不同的单集电影
      const uniqueStems = new Set(directVideos.map((v) => normalizeMatchText(v).slice(0, 8)).filter((x) => x.length >= 3));
      const looksLikeMixedMovies = directVideos.length >= 2 && uniqueStems.size >= Math.min(directVideos.length, 3) && directVideos.every((v) => {
        const m = noteUtils.parseVideoEpisodeMeta(v);
        return !m.hasExplicitEp;
      });
      if (!looksLikeMixedMovies) {
        const ck = normPathCompareKey(norm);
        if (!seenCandPaths.has(ck)) {
          seenCandPaths.add(ck);
          candidates.push({
            kind: "folder",
            path: norm,
            name: baseName,
            videoCount: directVideos.length,
            sampleFile: directVideos[0]
          });
        }
        return; // 不再把同部番内的剧集拆成散落文件
      }
    }

    // 容器目录内的散落直铺视频文件作为单文件候选
    if (directVideos.length > 0 && (isContainerLike || depth > 0)) {
      for (const vf of directVideos) {
        const full = pathMod.join(norm, vf);
        const ck = normPathCompareKey(full);
        if (seenCandPaths.has(ck)) continue;
        seenCandPaths.add(ck);
        let size = 0;
        try {
          const st = await statAsync(full);
          size = Number(st?.size) || 0;
        } catch (_) {}
        candidates.push({
          kind: "file",
          path: full,
          name: vf,
          size,
          videoCount: 1
        });
      }
    }

    if (depth < maxDepth) {
      for (const cd of childDirs) {
        if (signal?.aborted) break;
        await walk(pathMod.join(norm, cd), depth + 1);
      }
    }
  };

  for (const rootDir of Array.isArray(scanDirs) ? scanDirs : [scanDirs]) {
    if (signal?.aborted) break;
    await walk(rootDir, 0);
  }

  const high = [];
  const medium = [];
  const unmatched = [];

  for (const cand of candidates) {
    let bestItem = null;
    let bestScore = 0;
    const altMatches = [];

    for (const it of items) {
      const sc = scoreTitleMatch(cand.name, it);
      if (sc >= 45) {
        altMatches.push({ item: it, score: sc });
      }
      if (sc > bestScore) {
        bestScore = sc;
        bestItem = it;
      }
    }
    altMatches.sort((a, b) => b.score - a.score);

    const alreadyLinked =
      bestItem && existingBoundKeys.has(`${getAnimeBindingKey(bestItem)}::${normPathCompareKey(cand.path)}`);

    const row = {
      id: `scan_${Math.random().toString(36).slice(2, 9)}`,
      kind: cand.kind,
      path: cand.path,
      name: cand.name,
      videoCount: cand.videoCount || 1,
      size: cand.size || 0,
      matchedItem: bestItem,
      score: bestScore,
      alreadyLinked: Boolean(alreadyLinked),
      alternatives: altMatches.slice(0, 4).map((m) => m.item)
    };

    if (bestScore >= 72 && bestItem) {
      high.push(row);
    } else if (bestScore >= 45 && bestItem) {
      medium.push(row);
    } else {
      unmatched.push(row);
    }
  }

  if (onProgress) {
    onProgress({ scannedDirs: scannedDirCount, currentDir: "", candidatesFound: candidates.length, done: true });
  }

  return { ok: true, high, medium, unmatched, scannedDirs: scannedDirCount };
}

/* ============================== 移动硬盘换盘符探测与前缀修复 ============================== */

function detectDriveRelinkCandidates(plugin, animeItems) {
  if (!isDesktopNodeAvailable() || !isWin()) return [];
  const fsMod = tryRequireNode("fs");
  if (!fsMod) return [];

  const availableDrives = [];
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    try {
      if (fsMod.existsSync(`${letter}:\\`)) availableDrives.push(`${letter}:`);
    } catch (_) {}
  }

  const offlinePathList = [];
  const collectPath = (raw) => {
    const p = normFsPath(raw);
    if (!p) return;
    if (checkPathStatus(p) === "drive_offline") {
      offlinePathList.push(p);
    }
  };

  for (const it of animeItems || []) {
    if (it.downloadPath && it.downloadPath !== "无") collectPath(it.downloadPath);
  }
  const bindings = plugin?.settings?.localMediaBindings || {};
  for (const rawRec of Object.values(bindings)) {
    const rec = normalizeBindingEntry(rawRec);
    for (const f of rec.extraFolders) collectPath(f);
    for (const lf of rec.looseFiles) collectPath(lf.path);
    for (const ep of Object.values(rec.episodeMap)) collectPath(ep.path);
    for (const cl of rec.extraClips) collectPath(cl.path);
  }
  for (const stg of plugin?.settings?.localMediaStagingPool || []) {
    collectPath(stg.path);
  }

  const byOfflineDrive = new Map();
  for (const p of offlinePathList) {
    const m = p.match(/^([A-Za-z]:)(.*)$/);
    if (!m) continue;
    const drv = m[1].toUpperCase();
    const rest = m[2];
    if (!byOfflineDrive.has(drv)) byOfflineDrive.set(drv, []);
    byOfflineDrive.get(drv).push(rest);
  }

  const suggestions = [];
  for (const [fromDrive, suffixes] of byOfflineDrive.entries()) {
    const uniqueSuffixes = Array.from(new Set(suffixes));
    let bestTarget = "";
    let bestHits = 0;
    for (const candDrive of availableDrives) {
      if (candDrive === fromDrive) continue;
      let hits = 0;
      for (const suf of uniqueSuffixes) {
        try {
          if (fsMod.existsSync(`${candDrive}${suf}`)) hits += 1;
        } catch (_) {}
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestTarget = candDrive;
      }
    }
    if (bestTarget && bestHits > 0) {
      suggestions.push({
        fromDrive,
        toDrive: bestTarget,
        matchedCount: bestHits,
        totalOnFromDrive: uniqueSuffixes.length
      });
    }
  }
  return suggestions;
}

async function applyPathPrefixRemap(plugin, fromPrefix, toPrefix, animeItems) {
  const fromClean = String(fromPrefix || "").trim().replace(/[\\/]+$/, "");
  const toClean = String(toPrefix || "").trim().replace(/[\\/]+$/, "");
  if (!fromClean || !toClean) return { ok: false, updatedCount: 0 };

  const replaceOne = (rawPath) => {
    const raw = String(rawPath || "").trim();
    if (!raw) return { changed: false, value: raw };
    const normSlash = raw.replace(/\\/g, "/");
    const fromSlash = fromClean.replace(/\\/g, "/");
    const matchTarget = isWin()
      ? normSlash.toLowerCase().startsWith(fromSlash.toLowerCase())
      : normSlash.startsWith(fromSlash);
    if (!matchTarget) return { changed: false, value: raw };
    const tail = normSlash.slice(fromSlash.length);
    if (tail && !tail.startsWith("/")) return { changed: false, value: raw };
    return { changed: true, value: normFsPath(`${toClean.replace(/\\/g, "/")}${tail}`) };
  };

  let updatedCount = 0;
  for (const it of animeItems || []) {
    if (!it.downloadPath || it.downloadPath === "无") continue;
    const r = replaceOne(it.downloadPath);
    if (r.changed) {
      await writeNotePrimaryDownloadPath(plugin, it, r.value);
      updatedCount += 1;
    }
  }

  ensureLocalMediaSettingsShape(plugin);
  const bindings = plugin.settings.localMediaBindings;
  for (const key of Object.keys(bindings)) {
    const rec = normalizeBindingEntry(bindings[key]);
    let recChanged = false;
    rec.extraFolders = rec.extraFolders.map((f) => {
      const r = replaceOne(f);
      if (r.changed) {
        recChanged = true;
        updatedCount += 1;
      }
      return r.value;
    });
    rec.looseFiles = rec.looseFiles.map((lf) => {
      const r = replaceOne(lf.path);
      if (r.changed) {
        recChanged = true;
        updatedCount += 1;
      }
      return Object.assign({}, lf, { path: r.value });
    });
    for (const [epKey, epVal] of Object.entries(rec.episodeMap)) {
      const r = replaceOne(epVal.path);
      if (r.changed) {
        recChanged = true;
        updatedCount += 1;
        rec.episodeMap[epKey] = Object.assign({}, epVal, { path: r.value });
      }
    }
    rec.extraClips = rec.extraClips.map((cl) => {
      const r = replaceOne(cl.path);
      if (r.changed) {
        recChanged = true;
        updatedCount += 1;
      }
      return Object.assign({}, cl, { path: r.value });
    });
    if (recChanged) {
      rec.updatedAt = Date.now();
      bindings[key] = rec;
    }
  }

  for (const stg of plugin.settings.localMediaStagingPool) {
    const r = replaceOne(stg.path);
    if (r.changed) {
      stg.path = r.value;
      updatedCount += 1;
    }
  }

  if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
  invalidateLocalMediaCache(plugin);
  return { ok: true, updatedCount };
}

/* ============================== 播放缺失兜底通知 ============================== */

function notifyMissingEpisodeWithRecovery(plugin, item, episodeNum, missingInfo = null, allItems = null) {
  const NoticeClass = globalThis.__BangumiManagerNotice || obsidianMod?.Notice;
  if (!NoticeClass || typeof document === "undefined") return;

  const epText = episodeNum ? `第 ${String(episodeNum).padStart(2, "0")} 集` : "视频文件";
  const isOffline = missingInfo?.status === "drive_offline";
  const msg = isOffline
    ? `《${item?.name || "动画"}》${epText}所在的磁盘尚未接入，暂时无法播放。`
    : `《${item?.name || "动画"}》${epText}在原位置找不到了（可能已移动或删改）。`;

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  const txt = document.createElement("div");
  txt.textContent = msg;
  txt.style.cssText = "font-size:13px;line-height:1.45;";
  wrap.appendChild(txt);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
  const noticeInst = new NoticeClass(wrap, 10000);

  const relinkBtn = document.createElement("button");
  relinkBtn.className = "mod-cta";
  relinkBtn.textContent = "在整理台重新定位";
  relinkBtn.onclick = async () => {
    noticeInst.hide();
    if (typeof plugin?.openLocalMediaLinkerModal === "function") {
      await plugin.openLocalMediaLinkerModal(item, { focusEpisode: episodeNum || null });
    }
  };
  btnRow.appendChild(relinkBtn);

  if (isDesktopNodeAvailable()) {
    const pickFileBtn = document.createElement("button");
    pickFileBtn.textContent = "直接选文件替换";
    pickFileBtn.onclick = async () => {
      noticeInst.hide();
      const { pickNativeFilesOnDesktop } = require("./platform-env.js");
      const picked = await pickNativeFilesOnDesktop({
        title: `为《${item?.name || "动画"}》${epText}选择本地视频`,
        multi: false
      });
      if (picked && picked[0]) {
        const targetEp = episodeNum || 1;
        await bindEpisodeFileToAnime(plugin, item, targetEp, picked[0]);
        if (typeof plugin?.refreshOpenDashboardViews === "function") {
          await plugin.refreshOpenDashboardViews().catch(() => {});
        }
        await noteUtils.openLocalPathSafely(picked[0]);
      }
    };
    btnRow.appendChild(pickFileBtn);
  }

  wrap.appendChild(btnRow);
}

module.exports = {
  VIDEO_EXT_SET,
  normFsPath,
  normPathCompareKey,
  checkPathStatus,
  getAnimeBindingKey,
  ensureLocalMediaSettingsShape,
  getAnimeBindingRecord,
  ensureAnimeBindingRecord,
  hasNonEmptyBindingRecord,
  migrateAnimeBindingKey,
  invalidateLocalMediaCache,
  resolveAnimeLocalMedia,
  writeNotePrimaryDownloadPath,
  bindFolderToAnime,
  unbindFolderFromAnime,
  bindLooseFilesToAnime,
  unbindLooseFileFromAnime,
  bindEpisodeFileToAnime,
  unbindEpisodeFileFromAnime,
  bindExtraClipToAnime,
  unbindExtraClipFromAnime,
  addItemsToStagingPool,
  removeFromStagingPool,
  replaceStagingPoolItemPath,
  clearStagingPool,
  inspectStagingPoolHealth,
  readDirectoryEntriesAsync,
  scanLocalDirectoriesForSuggestions,
  detectDriveRelinkCandidates,
  applyPathPrefixRemap,
  notifyMissingEpisodeWithRecovery
};
