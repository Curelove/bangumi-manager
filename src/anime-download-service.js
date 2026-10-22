const obsidian = require("obsidian");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { execSync, spawn } = require("child_process");
const noteUtils = require("./note-utils.js");
const noteManager = require("./note-manager.js");
const roxyMascotService = require("./roxy-mascot-service.js");

const OFFICIAL_QBITTORRENT_URL = "https://www.qbittorrent.org/download";
const DEFAULT_COMICAT_BASE_URL = "http://www.comicat.org";
const PUBLIC_ANIME_TRACKERS = [
  "http://open.acgtracker.com:1096/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "http://t.nyaatracker.com:80/announce",
  "udp://tracker.openbittorrent.com:6969/announce"
];

/**
 * 探测 Windows 系统代理设置（当 Obsidian requestUrl 不可用或超时时作为 Node 回退通道）
 */
function detectWindowsSystemProxy() {
  try {
    const enableOut = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }
    );
    if (!/0x1\b/i.test(enableOut)) return null;
    const serverOut = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }
    );
    const match = serverOut.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
    if (!match || !match[1]) return null;
    const raw = match[1].trim();
    const hostPort = raw.includes("=")
      ? (raw.match(/http=([^;]+)/i)?.[1] || raw.split(";")[0].split("=").pop())
      : raw;
    const [host, portStr] = String(hostPort || "").trim().split(":");
    const port = Number(portStr);
    if (host && Number.isFinite(port) && port > 0) {
      return { host, port };
    }
  } catch (e) {}
  return null;
}

/**
 * 构造漫猫 (comicat.org) 搜索页链接与 RSS 订阅链接
 */
function normalizeComicatBaseUrl(plugin) {
  const raw = String(plugin?.settings?.comicatBaseUrl || DEFAULT_COMICAT_BASE_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_COMICAT_BASE_URL;
}

function buildComicatSearchUrl(keyword, baseUrl = DEFAULT_COMICAT_BASE_URL) {
  const cleanKw = String(keyword || "").trim();
  const base = String(baseUrl || DEFAULT_COMICAT_BASE_URL).replace(/\/+$/, "");
  return `${base}/search.php?keyword=${encodeURIComponent(cleanKw)}`;
}

function buildComicatRssUrl(keyword, baseUrl = DEFAULT_COMICAT_BASE_URL) {
  const cleanKw = String(keyword || "").trim().replace(/\s+/g, " ");
  const base = String(baseUrl || DEFAULT_COMICAT_BASE_URL).replace(/\/+$/, "");
  const encoded = encodeURIComponent(cleanKw).replace(/%20/g, "+");
  return `${base}/rss-${encoded}.xml`;
}

function buildCustomSearchUrl(plugin, keyword) {
  const tpl = String(
    plugin?.settings?.customDownloadSearchUrlTemplate ||
      "https://mikanani.me/Home/Search?searchstr={keyword}"
  ).trim();
  const encoded = encodeURIComponent(String(keyword || "").trim());
  if (tpl.includes("{keyword}")) {
    return tpl.replace(/\{keyword\}/g, encoded);
  }
  return tpl + encoded;
}

/**
 * 通过 Node HTTP/HTTPS（支持本地代理与直连双通道）获取文本
 */
function fetchTextViaNode(targetUrl, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const proxy = detectWindowsSystemProxy();

    const tryDirect = () => {
      const client = parsedUrl.protocol === "https:" ? https : http;
      const req = client.get(
        targetUrl,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/rss+xml, application/xml, text/xml, */*"
          },
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            fetchTextViaNode(nextUrl, timeoutMs).then(resolve, reject);
            return;
          }
          let body = "";
          res.on("data", (chunk) => {
            body += chunk.toString("utf8");
          });
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("请求超时"));
      });
    };

    if (proxy && parsedUrl.protocol === "http:") {
      const req = http.request(
        {
          host: proxy.host,
          port: proxy.port,
          method: "GET",
          path: targetUrl,
          headers: {
            Host: parsedUrl.host,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/rss+xml, application/xml, text/xml, */*"
          },
          timeout: timeoutMs
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk.toString("utf8");
          });
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300 && body.includes("<rss")) {
              resolve(body);
            } else {
              tryDirect();
            }
          });
        }
      );
      req.on("error", () => tryDirect());
      req.on("timeout", () => {
        req.destroy();
        tryDirect();
      });
      req.end();
    } else {
      tryDirect();
    }
  });
}

/**
 * 获取 RSS XML 内容（优先使用 Obsidian requestUrl，失败时自动切换系统代理/Node 通道，并支持 http/https 互备）
 */
async function fetchComicatRssXml(url, timeoutMs = 9500) {
  const candidates = [url];
  if (url.startsWith("http://")) {
    candidates.push(url.replace(/^http:\/\//i, "https://"));
  } else if (url.startsWith("https://")) {
    candidates.push(url.replace(/^https:\/\//i, "http://"));
  }

  let lastError = null;
  for (const candidateUrl of candidates) {
    if (obsidian && typeof obsidian.requestUrl === "function") {
      try {
        const resp = await Promise.race([
          obsidian.requestUrl({
            url: candidateUrl,
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              Accept: "application/rss+xml, application/xml, text/xml, */*"
            }
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("requestUrl timeout")), timeoutMs))
        ]);
        if (resp && resp.status >= 200 && resp.status < 300 && resp.text && resp.text.includes("<rss")) {
          return resp.text;
        }
      } catch (err) {
        lastError = err;
      }
    }

    try {
      const text = await fetchTextViaNode(candidateUrl, timeoutMs);
      if (text && text.includes("<rss")) {
        return text;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("无法连接至漫猫 (comicat.org)，请检查网络连接或代理状态。");
}

/**
 * 从漫猫 RSS 标题中解析集数、版本号 (v2/v3) 与是否为合集包
 */
function parseEpisodeAndVersionFromTitle(title) {
  const clean = String(title || "")
    .replace(/\[(?:1080|720|2160|480)[pP]?\]/g, " ")
    .replace(
      /\b(?:1920x1080|1280x720|3840x2160|10bit|8bit|x264|x265|H\.?264|H\.?265|HEVC|AVC|AAC|FLAC|MP4|MKV|WEB-DL|WebRip|BDRip)\b/gi,
      " "
    );

  // 合集包识别（例如 01-12、01~12、全12话、合集）
  if (
    /(?:\b|\s|\[)(\d{1,3})\s*[-~～]\s*(\d{1,3})(?:\b|\s|\]|话|集|話|END|Fin)/i.test(clean) ||
    /全\s*\d+\s*[话集話]|季度全集|合集|全集/i.test(clean)
  ) {
    return { episode: null, version: 1, isPack: true };
  }

  // 模式 1："- 12v2"、"- 12 ["、"- 12 ("、"第12话"
  const dashMatch = clean.match(/(?:-\s*|第\s*)(\d{1,3})(?:\.5)?(?:v(\d+))?(?:\s*[\[\(话集話]|\s|$)/i);
  if (dashMatch) {
    const ep = Number(dashMatch[1]);
    if (ep >= 0 && ep < 1900) {
      return {
        episode: ep,
        version: dashMatch[2] ? Number(dashMatch[2]) : 1,
        isPack: false
      };
    }
  }

  // 模式 2："[12]"、"[12v2]"、"[07]"
  const bracketMatches = [
    ...clean.matchAll(/\[(\d{1,3})(?:v(\d+))?(?:\s*(?:END|Fin|话|集|話))?\]/gi)
  ];
  if (bracketMatches.length > 0) {
    const last = bracketMatches[bracketMatches.length - 1];
    const ep = Number(last[1]);
    if (ep >= 0 && ep < 1900) {
      return {
        episode: ep,
        version: last[2] ? Number(last[2]) : 1,
        isPack: false
      };
    }
  }

  // 模式 3：EP12 / E12
  const epCodeMatch = clean.match(/\b(?:EP|E)(\d{1,3})(?:v(\d+))?\b/i);
  if (epCodeMatch) {
    return {
      episode: Number(epCodeMatch[1]),
      version: epCodeMatch[2] ? Number(epCodeMatch[2]) : 1,
      isPack: false
    };
  }

  return { episode: null, version: 1, isPack: false };
}

/**
 * 解析单条漫猫 RSS <item> 的发布组、片源平台、字幕语言、封装格式、集数与推荐精准搜索词
 */
function parseComicatTitleMeta(title, author = "", animeName = "") {
  const raw = String(title || "").trim();
  const groupMatch = raw.match(/^\s*\[([^\]]+)\]/);
  const group = groupMatch ? groupMatch[1].trim() : (author || "其他发布源");

  let platform = "";
  const platMatch = raw.match(/\b(Baha|Bilibili|B-Global|CR|Crunchyroll|ABEMA|KKTV|Viu|Netflix|AT-X)\b/i);
  if (platMatch) platform = platMatch[1];

  let lang = "";
  const langMatch = raw.match(
    /(简繁日内封|简繁内封|简日内嵌|繁日内嵌|繁日內嵌|简日双语|繁日双语|简日内封|繁日内封|简体内嵌|繁体内嵌|简日|繁日|CHS|CHT|GB|BIG5)/i
  );
  if (langMatch) lang = langMatch[1];

  let format = "";
  const fmtMatch = raw.match(/\b(MP4|MKV)\b/i);
  if (fmtMatch) format = fmtMatch[1].toUpperCase();

  let resolution = "";
  const resMatch = raw.match(/\b(1080[pP]|2160[pP]|4K|720[pP]|1920x1080|1280x720)\b/i);
  if (resMatch) {
    const r = resMatch[1].toUpperCase();
    resolution = r === "1920X1080" ? "1080P" : r === "1280X720" ? "720P" : r;
  }

  const { episode, version, isPack } = parseEpisodeAndVersionFromTitle(raw);

  // 构造能在 comicat.org 精准筛出该单一发布流（每集仅 1 条）的推荐搜索关键词
  const keywordTokens = [];
  if (group && group !== "其他发布源") {
    if (group.includes("&")) {
      keywordTokens.push(group.split("&")[0].trim());
    } else {
      keywordTokens.push(`[${group}]`);
    }
  }
  const cleanAnimeName = String(animeName || "").trim();
  if (cleanAnimeName) {
    keywordTokens.push(cleanAnimeName);
  }
  if (platform) {
    keywordTokens.push(platform);
  } else if (lang) {
    keywordTokens.push(lang);
  }

  const streamLabelParts = [group, platform, lang, format].filter(Boolean);
  const streamId = streamLabelParts.join(" · ") || group;

  return {
    group,
    platform,
    lang,
    format,
    resolution,
    episode,
    version,
    isPack,
    streamId,
    recommendedKeyword: keywordTokens.join(" ").trim()
  };
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 解析完整漫猫 RSS XML 文本，输出条目列表与智能归类的「候选发布源 (streams)」
 */
function parseComicatRssXml(xmlText, animeName = "", baseUrl = DEFAULT_COMICAT_BASE_URL) {
  const rawItems = String(xmlText || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  const parsedItems = [];
  const streamsMap = new Map();

  for (const block of rawItems) {
    const rawTitle =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
        block.match(/<title>([\s\S]*?)<\/title>/i) ||
        [])[1] || "";
    const title = decodeXmlEntities(rawTitle).trim();
    if (!title) continue;

    const link = decodeXmlEntities(
      (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || ""
    ).trim();
    const author = decodeXmlEntities(
      (block.match(/<author><!\[CDATA\[([\s\S]*?)\]\]><\/author>/i) ||
        block.match(/<author>([\s\S]*?)<\/author>/i) ||
        [])[1] || ""
    ).trim();
    const pubDate = decodeXmlEntities(
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || ""
    ).trim();
    const enclosureUrl = decodeXmlEntities(
      (block.match(/<enclosure[^>]+url=["']([^"']+)["']/i) || [])[1] || ""
    ).trim();

    const hashMatch =
      link.match(/show-([a-fA-F0-9]{40})\.html/i) ||
      enclosureUrl.match(/hash=([a-fA-F0-9]{40})/i);
    const infoHash = hashMatch ? hashMatch[1].toLowerCase() : "";

    const trackerSuffix = PUBLIC_ANIME_TRACKERS.map((tr) => `&tr=${encodeURIComponent(tr)}`).join("");
    const magnetUrl = infoHash
      ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}${trackerSuffix}`
      : "";
    const torrentUrl =
      enclosureUrl || (infoHash ? `http://v2.uploadbt.com/?r=down&hash=${infoHash}` : "");

    const meta = parseComicatTitleMeta(title, author, animeName);
    const pubTimeMs = pubDate ? Date.parse(pubDate) || 0 : 0;

    const itemObj = {
      title,
      link,
      author,
      pubDate,
      pubTimeMs,
      infoHash,
      magnetUrl,
      torrentUrl,
      ...meta
    };
    parsedItems.push(itemObj);

    if (!streamsMap.has(meta.streamId)) {
      streamsMap.set(meta.streamId, {
        streamId: meta.streamId,
        group: meta.group,
        platform: meta.platform,
        lang: meta.lang,
        format: meta.format,
        resolution: meta.resolution,
        recommendedKeyword: meta.recommendedKeyword,
        searchUrl: buildComicatSearchUrl(meta.recommendedKeyword, baseUrl),
        rssUrl: buildComicatRssUrl(meta.recommendedKeyword, baseUrl),
        rawItems: []
      });
    }
    streamsMap.get(meta.streamId).rawItems.push(itemObj);
  }

  const streams = Array.from(streamsMap.values()).map((st) => {
    const dedup = deduplicateEpisodeItems(st.rawItems);
    return {
      ...st,
      dedup,
      episodeCount: dedup.episodes.length,
      totalRawCount: st.rawItems.length
    };
  });

  // 按有效单集数量降序、最新更新时间降序排列候选发布源
  streams.sort((a, b) => {
    if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
    const ta = a.rawItems[0]?.pubTimeMs || 0;
    const tb = b.rawItems[0]?.pubTimeMs || 0;
    return tb - ta;
  });

  return {
    items: parsedItems,
    streams
  };
}

/**
 * 对同一发布源的条目执行「每集唯一性」核验与自动去重（优先保留 v2/v3 修正版与最新发布的条目）
 */
function deduplicateEpisodeItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byEpisode = new Map();
  const packs = [];
  const unnumbered = [];
  let duplicateReplacedCount = 0;

  for (const item of list) {
    if (item.isPack) {
      packs.push(item);
      continue;
    }
    if (item.episode === null || item.episode === undefined || !Number.isFinite(item.episode)) {
      unnumbered.push(item);
      continue;
    }

    const ep = item.episode;
    if (!byEpisode.has(ep)) {
      byEpisode.set(ep, item);
    } else {
      duplicateReplacedCount++;
      const existing = byEpisode.get(ep);
      // 优先选择更高 version (如 v2 > v1)，同 version 取最新发布
      if (
        (item.version || 1) > (existing.version || 1) ||
        ((item.version || 1) === (existing.version || 1) && (item.pubTimeMs || 0) > (existing.pubTimeMs || 0))
      ) {
        byEpisode.set(ep, item);
      }
    }
  }

  const episodes = Array.from(byEpisode.values()).sort((a, b) => b.episode - a.episode);
  const minEp = episodes.length ? episodes[episodes.length - 1].episode : null;
  const maxEp = episodes.length ? episodes[0].episode : null;

  return {
    episodes,
    packs,
    unnumbered,
    duplicateReplacedCount,
    isStrictlyOnePerEpisode: duplicateReplacedCount === 0 && episodes.length > 0,
    minEp,
    maxEp
  };
}

/**
 * 检测本机 qBittorrent 安装路径与运行状态（绝不默认用户已安装或已启动）
 */
function detectQbittorrentStatus(plugin) {
  const enabled = plugin?.settings?.enableQbittorrentIntegration !== false;
  if (!enabled) {
    return {
      enabled: false,
      installed: false,
      running: false,
      pid: null,
      exePath: "",
      officialDownloadUrl: OFFICIAL_QBITTORRENT_URL
    };
  }

  const candidates = [];
  const customPath = String(plugin?.settings?.qbittorrentExecutablePath || "").trim();
  if (customPath) {
    candidates.push(customPath);
  }
  candidates.push(
    "C:/Program Files/qBittorrent/qbittorrent.exe",
    "C:/Program Files (x86)/qBittorrent/qbittorrent.exe",
    "D:/Program Files/qBittorrent/qbittorrent.exe",
    "D:/qBittorrent/qbittorrent.exe"
  );
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs/qBittorrent/qbittorrent.exe"));
  }

  let exePath = "";
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        exePath = path.normalize(c);
        break;
      }
    } catch (e) {}
  }

  // 注册表兜底探测
  if (!exePath && process.platform === "win32") {
    try {
      const regOut = execSync(
        'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\qBittorrent" /v DisplayIcon',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }
      );
      const m = regOut.match(/([A-Za-z]:\\[^"\r\n,]+qbittorrent\.exe)/i);
      if (m && m[1] && fs.existsSync(m[1])) {
        exePath = path.normalize(m[1]);
      }
    } catch (e) {}
  }

  let running = false;
  let pid = null;
  if (exePath && process.platform === "win32") {
    try {
      const taskOut = execSync('tasklist /FI "IMAGENAME eq qbittorrent.exe" /FO CSV /NH', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500
      });
      const m = taskOut.match(/"qbittorrent\.exe","(\d+)"/i);
      if (m && m[1]) {
        running = true;
        pid = Number(m[1]);
      }
    } catch (e) {}
  }

  return {
    enabled: true,
    installed: Boolean(exePath),
    running,
    pid,
    exePath,
    officialDownloadUrl: OFFICIAL_QBITTORRENT_URL
  };
}

/**
 * 启动本机 qBittorrent 客户端
 */
async function launchQbittorrentClient(plugin) {
  const status = detectQbittorrentStatus(plugin);
  if (!status.installed || !status.exePath) {
    return { ok: false, reason: "not_installed", status };
  }
  if (status.running) {
    return { ok: true, alreadyRunning: true, status };
  }
  try {
    const child = spawn(status.exePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 1400));
    const afterStatus = detectQbittorrentStatus(plugin);
    return { ok: true, alreadyRunning: false, status: afterStatus };
  } catch (err) {
    return { ok: false, reason: err.message, status };
  }
}

/**
 * 确保作品拥有合法的本地下载文件夹（若笔记未配置下载路径，可按规范「本地根目录/年份/季度/安全名称」自动生成并写回笔记）
 */
async function ensureAnimeLocalDownloadFolder(plugin, item, createOnDisk = true) {
  let targetPath = String(item?.downloadPath || "").trim();
  let updatedNote = false;

  if (!targetPath || targetPath === "无") {
    const base = String(plugin?.settings?.localAnimeRoot || "D:/ACG/Obsidian ACG")
      .trim()
      .replace(/[\\/]+$/, "");
    const year = String(item?.year || new Date().getFullYear()).trim() || String(new Date().getFullYear());
    const season = String(item?.season || "10月新番").trim() || "10月新番";
    const safeFolder = noteManager.getSafeFileName(item?.name || "未命名动画");
    targetPath = `${base}/${year}/${season}/${safeFolder}`.replace(/\\/g, "/");

    if (item?.file) {
      let content = await plugin.app.vault.read(item.file);
      content = noteUtils.updateFrontmatterField(content, "下载路径", targetPath);
      content = noteUtils.updateFolderLine(content, targetPath);
      content = noteUtils.syncNoteCalloutFromFrontmatter(content);
      await plugin.modifyNoteSafely(item.file, content);
      item.downloadPath = targetPath;
      updatedNote = true;
    }
  }

  if (createOnDisk && targetPath && targetPath !== "无") {
    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
    } catch (err) {
      console.warn("[BangumiDownload] 创建本地动画文件夹失败:", err);
    }
  }

  return { targetPath, updatedNote };
}

/**
 * 向 qBittorrent 投递一个或多个下载任务（磁力或种子链接），自动携带 --save-path 指向该番剧的本地文件夹
 */
async function dispatchDownloadToQbittorrent(plugin, item, episodeTargets, options = {}) {
  const targets = Array.isArray(episodeTargets) ? episodeTargets : [episodeTargets];
  const urls = targets
    .map((t) => (typeof t === "string" ? t : t?.magnetUrl || t?.torrentUrl))
    .filter(Boolean);

  if (urls.length === 0) {
    return { ok: false, reason: "没有可投递的磁力或种子链接" };
  }

  const qbStatus = detectQbittorrentStatus(plugin);
  if (!qbStatus.enabled || !qbStatus.installed || !qbStatus.exePath) {
    return { ok: false, reason: "qb_unavailable", qbStatus };
  }

  const autoCreate = plugin?.settings?.qbittorrentAutoCreateFolder !== false;
  const { targetPath } = await ensureAnimeLocalDownloadFolder(plugin, item, autoCreate);
  const winSavePath = targetPath ? path.normalize(targetPath) : "";

  const skipDialog =
    options.skipDialog !== undefined
      ? Boolean(options.skipDialog)
      : plugin?.settings?.qbittorrentSkipDialog !== false;

  const cliArgs = [];
  if (winSavePath) {
    cliArgs.push(`--save-path=${winSavePath}`);
  }
  cliArgs.push(`--skip-dialog=${skipDialog ? "true" : "false"}`);
  if (options.addStopped) {
    cliArgs.push("--add-stopped=true");
  }
  cliArgs.push(...urls);

  try {
    const child = spawn(qbStatus.exePath, cliArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();

    roxyMascotService.emitRoxyEvent(plugin, {
      type: "download:dispatched",
      state: "success",
      category: "追番下载",
      priority: roxyMascotService.PRIORITY.HIGH,
      dedupeKey: `dl:${item?.name}:${urls.length}:${Date.now()}`,
      message: `已经帮您把《${item?.name || "作品"}》的 ${urls.length} 集下载任务投递给 qBittorrent 了，保存位置已对准本地番剧目录哦。`
    });

    return {
      ok: true,
      dispatchedCount: urls.length,
      savePath: targetPath,
      wasRunning: qbStatus.running
    };
  } catch (err) {
    return { ok: false, reason: err.message, qbStatus };
  }
}

/**
 * 将用户选定的「下载源关键词」与「专属 RSS 订阅地址」绑定写入动画 Markdown 笔记的 YAML Frontmatter
 */
async function bindAnimeDownloadSourceToNote(plugin, item, { keyword, rssUrl, streamId }) {
  if (!item || !item.file) return false;
  let content = await plugin.app.vault.read(item.file);
  if (keyword !== undefined) {
    content = noteUtils.updateFrontmatterField(content, "下载源关键词", keyword);
    item.downloadSourceKeyword = keyword;
  }
  if (rssUrl !== undefined) {
    content = noteUtils.updateFrontmatterField(content, "RSS订阅", rssUrl);
    item.rssUrl = rssUrl;
  }
  if (streamId !== undefined) {
    content = noteUtils.updateFrontmatterField(content, "发布源标识", streamId);
    item.downloadStreamId = streamId;
  }
  content = noteUtils.syncNoteCalloutFromFrontmatter(content);
  await plugin.modifyNoteSafely(item.file, content);

  roxyMascotService.emitRoxyEvent(plugin, {
    type: "download:bind_rss",
    state: "success",
    category: "下载源绑定",
    priority: roxyMascotService.PRIORITY.HIGH,
    dedupeKey: `bind_rss:${item.name}:${keyword}`,
    message: `已经为《${item.name}》锁定了「${streamId || keyword}」专属单集源并记入案卷，之后随时可以一键核对补齐新集哦。`
  });
  return true;
}

/**
 * 安全解码 URL（将 + 还原为空格并解码百分号编码，便于直观展示与匹配）
 */
function safeDecodeRssUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  try {
    return decodeURIComponent(s.replace(/\+/g, "%20"));
  } catch (e) {
    return s;
  }
}

/**
 * 提取用于匹配已有 RSS 订阅与 qBittorrent 下载规则的核心作品标题词元
 */
function extractAnimeMatchTokens(item, currentKeyword = "") {
  const tokens = new Set();
  const ignoreSet = new Set([
    "动画", "新番", "第一季", "第二季", "第三季", "第四季", "第五季",
    "第1季", "第2季", "第3季", "第4季", "剧场版", "总集篇", "特别篇",
    "season", "part", "movie", "ova", "oad", "sp",
    "ani", "baha", "lolihouse", "abema", "cr", "bilibili",
    "1080p", "720p", "mp4", "mkv", "cht", "chs", "简日", "繁日", "简日内嵌", "简日双语"
  ]);

  const addToken = (raw) => {
    const clean = String(raw || "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/\s+(?:第[一二三四五六七八九十\d]+[季期部]|Season\s*\d+|Part\s*\d+|II|III|2|3)$/i, "")
      .trim();
    if (!clean || clean.length < 2) return;
    if (ignoreSet.has(clean.toLowerCase())) return;
    tokens.add(clean);
  };

  const rawName = String(item?.name || "").trim();
  if (rawName) {
    tokens.add(rawName);
    addToken(rawName);

    // 提取波浪号 ～...～ 中的副标题（如“感谢对战。 ～大小姐才不玩格斗游戏～” -> “大小姐才不玩格斗游戏”）
    const waveMatches = rawName.matchAll(/[～~]([^～~]+)[～~]/g);
    for (const m of waveMatches) {
      if (m[1]) addToken(m[1]);
    }

    // 按句号、冒号、波浪号、破折号、空格切分核心词段
    const segments = rawName
      .replace(/[～~]/g, " ")
      .split(/[。．：:！!？?\-—\/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const seg of segments) {
      addToken(seg);
    }
  }

  if (item?.japaneseName) {
    addToken(item.japaneseName);
  }

  if (item?.downloadPath && item.downloadPath !== "无") {
    const folderBase = path.basename(String(item.downloadPath).replace(/[\\/]+$/, ""));
    if (folderBase && !/^\d{2}月新番$/.test(folderBase) && !/^\d{4}$/.test(folderBase)) {
      addToken(folderBase);
    }
  }

  if (currentKeyword) {
    const strippedKw = String(currentKeyword)
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\b(Baha|ABEMA|CR|1080P|720P|MP4|MKV|CHT|CHS|LoliHouse|ANi)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    addToken(strippedKw);
  }

  return Array.from(tokens);
}

/**
 * 检测本机 qBittorrent (download_rules.json & feeds.json) 以及当前笔记中
 * 是否已经添加过与该动画可能相关的 RSS 订阅或自动下载规则（含启用/停用状态）
 */
function detectExistingRssAndDownloadRules(plugin, item, currentKeyword = "", currentRssUrl = "") {
  const tokens = extractAnimeMatchTokens(item, currentKeyword);
  const normSaveTarget =
    item?.downloadPath && item.downloadPath !== "无"
      ? String(item.downloadPath).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
      : "";
  const normCurrentRss = safeDecodeRssUrl(currentRssUrl).toLowerCase();

  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const rssDirs = [
    appData ? path.join(appData, "qBittorrent", "rss") : "",
    localAppData ? path.join(localAppData, "qBittorrent", "rss") : ""
  ].filter(Boolean);

  let rulesFilePath = "";
  let feedsFilePath = "";
  for (const dir of rssDirs) {
    if (!rulesFilePath && fs.existsSync(path.join(dir, "download_rules.json"))) {
      rulesFilePath = path.join(dir, "download_rules.json");
    }
    if (!feedsFilePath && fs.existsSync(path.join(dir, "feeds.json"))) {
      feedsFilePath = path.join(dir, "feeds.json");
    }
  }

  const textMatchesTokens = (text) => {
    const hay = String(text || "").trim().toLowerCase();
    if (!hay) return false;
    for (const tok of tokens) {
      const t = tok.toLowerCase();
      if (t.length >= 2 && (hay.includes(t) || (hay.length >= 2 && t.includes(hay)))) {
        return true;
      }
    }
    return false;
  };

  const matchedRules = [];
  if (rulesFilePath) {
    try {
      const rawRules = JSON.parse(fs.readFileSync(rulesFilePath, "utf8"));
      if (rawRules && typeof rawRules === "object") {
        for (const [ruleName, ruleObj] of Object.entries(rawRules)) {
          if (!ruleObj || typeof ruleObj !== "object") continue;
          const feeds = Array.isArray(ruleObj.affectedFeeds) ? ruleObj.affectedFeeds : [];
          const decodedFeeds = feeds.map(safeDecodeRssUrl);
          const ruleSavePath = String(
            ruleObj.savePath || ruleObj.torrentParams?.save_path || ""
          ).trim();
          const normRuleSave = ruleSavePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

          let matchReason = "";
          if (textMatchesTokens(ruleName)) {
            matchReason = `规则名匹配「${ruleName}」`;
          } else if (normSaveTarget && normRuleSave && normRuleSave === normSaveTarget) {
            matchReason = "下载保存路径完全一致";
          } else if (normRuleSave && textMatchesTokens(path.basename(normRuleSave))) {
            matchReason = `保存目录匹配「${path.basename(normRuleSave)}」`;
          } else if (
            normCurrentRss &&
            decodedFeeds.some((df) => df.toLowerCase() === normCurrentRss)
          ) {
            matchReason = "关联 RSS 链接完全一致";
          } else if (decodedFeeds.some((df) => textMatchesTokens(df))) {
            matchReason = "关联 RSS 链接包含该作品关键词";
          }

          if (matchReason) {
            matchedRules.push({
              ruleName,
              enabled: ruleObj.enabled !== false,
              affectedFeeds: feeds,
              decodedFeeds,
              mustContain: String(ruleObj.mustContain || ""),
              mustNotContain: String(ruleObj.mustNotContain || ""),
              episodeFilter: String(ruleObj.episodeFilter || ""),
              savePath: ruleSavePath,
              lastMatch: String(ruleObj.lastMatch || ""),
              matchReason
            });
          }
        }
      }
    } catch (err) {
      console.warn("[BangumiDownload] 读取 qBittorrent download_rules.json 失败:", err);
    }
  }

  const matchedFeeds = [];
  if (feedsFilePath) {
    try {
      const rawFeeds = JSON.parse(fs.readFileSync(feedsFilePath, "utf8"));
      const walkFeeds = (node, folderChain = []) => {
        if (!node || typeof node !== "object") return;
        for (const [key, val] of Object.entries(node)) {
          if (!val || typeof val !== "object") continue;
          if (typeof val.url === "string") {
            const decodedUrl = safeDecodeRssUrl(val.url);
            const isUrlSame =
              normCurrentRss && decodedUrl.toLowerCase() === normCurrentRss;
            if (isUrlSame || textMatchesTokens(key) || textMatchesTokens(decodedUrl)) {
              matchedFeeds.push({
                folderPath: folderChain.join(" / ") || "根目录",
                feedName: key,
                url: val.url,
                decodedUrl,
                uid: String(val.uid || ""),
                isExactUrl: Boolean(isUrlSame)
              });
            }
          } else {
            walkFeeds(val, [...folderChain, key]);
          }
        }
      };
      walkFeeds(rawFeeds, []);
    } catch (err) {
      console.warn("[BangumiDownload] 读取 qBittorrent feeds.json 失败:", err);
    }
  }

  const noteBoundRss = String(item?.rssUrl || "").trim();
  const noteBoundKeyword = String(item?.downloadSourceKeyword || "").trim();
  const hasEnabledRule = matchedRules.some((r) => r.enabled);
  const hasAnyMatch =
    matchedRules.length > 0 || matchedFeeds.length > 0 || Boolean(noteBoundRss);

  return {
    checkedAt: new Date().toLocaleTimeString(),
    tokens,
    rulesFilePath,
    feedsFilePath,
    matchedRules,
    matchedFeeds,
    noteBoundRss,
    noteBoundKeyword,
    hasEnabledRule,
    hasAnyMatch
  };
}

/**
 * 弹出「RSS 订阅与自动下载规则查重确认弹窗」：
 * - 不管是否检测到已有规则/订阅，都把真实检测结果清晰出示给用户；
 * - 明确询问用户是否继续添加/执行，并提示可能导致 RSS 订阅重复或重复下载。
 */
function openRssDuplicateConfirmModal(plugin, item, report, actionMeta = {}, onConfirm) {
  const ModalClass = globalThis.__BangumiManagerModal;
  if (!ModalClass) {
    if (typeof onConfirm === "function") onConfirm();
    return null;
  }

  class RssDuplicateCheckConfirmModal extends ModalClass {
    constructor(app) {
      super(app);
      this.resolved = false;
    }

    onOpen() {
      this.modalEl.addClass("curator-rss-check-modal-shell");
      this.modalEl.style.width = "min(680px, 92vw)";
      this.modalEl.style.maxWidth = "92vw";
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-rss-check-modal");

      const actionTitle = actionMeta.actionTitle || "添加/绑定 RSS 订阅或执行下载";
      const targetRss = actionMeta.targetRss || "";
      const targetKw = actionMeta.targetKeyword || "";

      contentEl.createEl("h2", {
        cls: "curator-dl-title",
        text: `🔍 RSS 订阅与自动下载规则查重确认 · 《${item?.name || "未命名"}》`
      });

      const statusBanner = contentEl.createDiv(
        `curator-rss-check-banner ${
          report.hasEnabledRule
            ? "is-warn"
            : report.hasAnyMatch
            ? "is-info"
            : "is-clean"
        }`
      );

      if (report.hasAnyMatch) {
        const enabledCount = report.matchedRules.filter((r) => r.enabled).length;
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-title",
          text: report.hasEnabledRule
            ? `⚠️ 检测到已存在 ${report.matchedRules.length} 条相关下载规则（其中 ${enabledCount} 条正处于「已启用」状态）及 ${report.matchedFeeds.length} 条 RSS 订阅源！`
            : `ℹ️ 检测到已存在相关记录（下载规则 ${report.matchedRules.length} 条 · RSS 订阅源 ${report.matchedFeeds.length} 条 · 笔记绑定 ${report.noteBoundRss ? "1 项" : "0 项"}）`
        });
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-sub",
          text: "若继续添加 RSS 订阅或重复投递下载，可能会导致 RSS 订阅重复或同一集被重复下载。请先核对下方检测结果："
        });
      } else {
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-title",
          text: "✅ 检测结果：未发现已存在的同名/相关 RSS 订阅或自动下载规则"
        });
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-sub",
          text: `已扫描本机 qBittorrent (download_rules.json / feeds.json) 及当前动画笔记属性。虽然未检出已有规则，但如果您曾用其他别名添加过订阅，继续操作仍可能导致 RSS 订阅重复。`
        });
      }

      // 展示详细检测结果列表
      const detailBox = contentEl.createDiv("curator-rss-check-detail-box");

      // 1. qBittorrent 自动下载规则检测明细
      const rulesSec = detailBox.createDiv("curator-rss-check-sec");
      rulesSec.createDiv({
        cls: "curator-rss-check-sec-head",
        text: `① qBittorrent 自动下载规则检测 (${
          report.rulesFilePath ? `匹配 ${report.matchedRules.length} 条` : "未检测到 download_rules.json"
        })`
      });
      if (report.matchedRules.length === 0) {
        rulesSec.createDiv({
          cls: "curator-rss-check-empty",
          text: "未在 qBittorrent 自动下载规则中检测到与该番剧相关的规则。"
        });
      } else {
        for (const r of report.matchedRules) {
          const itemRow = rulesSec.createDiv("curator-rss-check-item");
          const topLine = itemRow.createDiv("curator-rss-check-item-top");
          topLine.createSpan({
            cls: `curator-rss-rule-state-pill ${r.enabled ? "is-enabled" : "is-disabled"}`,
            text: r.enabled ? "🟢 已启用 (Enabled)" : "⚪ 已停用 (Disabled)"
          });
          topLine.createSpan({
            cls: "curator-rss-check-item-name",
            text: `规则名：${r.ruleName}`
          });
          topLine.createSpan({
            cls: "curator-rss-check-item-reason",
            text: r.matchReason
          });

          if (r.decodedFeeds.length > 0) {
            itemRow.createDiv({
              cls: "curator-rss-check-item-meta curator-mono",
              text: `关联订阅源：${r.decodedFeeds.join(" ; ")}`
            });
          }
          const filterParts = [];
          if (r.mustContain) filterParts.push(`必须包含: "${r.mustContain}"`);
          if (r.mustNotContain) filterParts.push(`必须排除: "${r.mustNotContain}"`);
          if (r.episodeFilter) filterParts.push(`集数过滤: "${r.episodeFilter}"`);
          if (r.savePath) filterParts.push(`保存路径: ${r.savePath}`);
          if (r.lastMatch) filterParts.push(`最近匹配: ${r.lastMatch}`);
          if (filterParts.length > 0) {
            itemRow.createDiv({
              cls: "curator-rss-check-item-meta",
              text: filterParts.join("  |  ")
            });
          }
        }
      }

      // 2. qBittorrent RSS 订阅源列表 (feeds.json) 检测明细
      const feedsSec = detailBox.createDiv("curator-rss-check-sec");
      feedsSec.createDiv({
        cls: "curator-rss-check-sec-head",
        text: `② qBittorrent 已添加 RSS 订阅源检测 (${
          report.feedsFilePath ? `匹配 ${report.matchedFeeds.length} 条` : "未检测到 feeds.json"
        })`
      });
      if (report.matchedFeeds.length === 0) {
        feedsSec.createDiv({
          cls: "curator-rss-check-empty",
          text: "未在 qBittorrent 订阅源列表中检测到与该番剧相关的 RSS 链接。"
        });
      } else {
        for (const f of report.matchedFeeds) {
          const feedRow = feedsSec.createDiv("curator-rss-check-item");
          const topLine = feedRow.createDiv("curator-rss-check-item-top");
          topLine.createSpan({
            cls: "curator-rss-rule-state-pill is-enabled",
            text: `📂 ${f.folderPath}`
          });
          topLine.createSpan({
            cls: "curator-rss-check-item-name",
            text: `订阅名：${f.feedName}`
          });
          feedRow.createDiv({
            cls: "curator-rss-check-item-meta curator-mono",
            text: `RSS 地址：${f.decodedUrl}`
          });
        }
      }

      // 3. 当前 Obsidian 动画笔记已绑定属性检测
      const noteSec = detailBox.createDiv("curator-rss-check-sec");
      noteSec.createDiv({
        cls: "curator-rss-check-sec-head",
        text: "③ 当前 Obsidian 动画笔记已绑定源检测"
      });
      if (report.noteBoundRss || report.noteBoundKeyword) {
        const noteRow = noteSec.createDiv("curator-rss-check-item");
        noteRow.createDiv({
          cls: "curator-rss-check-item-name",
          text: `已绑定关键词：${report.noteBoundKeyword || "（未记录）"}`
        });
        if (report.noteBoundRss) {
          noteRow.createDiv({
            cls: "curator-rss-check-item-meta curator-mono",
            text: `已绑定 RSS：${safeDecodeRssUrl(report.noteBoundRss)}`
          });
        }
      } else {
        noteSec.createDiv({
          cls: "curator-rss-check-empty",
          text: "当前动画笔记尚未绑定默认下载源或 RSS 订阅链接。"
        });
      }

      // 本次拟执行的操作摘要与询问提示
      const promptBox = contentEl.createDiv("curator-rss-check-prompt");
      promptBox.createDiv({
        cls: "curator-rss-check-prompt-q",
        text: `❓ 您当前请求执行：「${actionTitle}」${
          targetKw ? `（关键词：${targetKw}）` : ""
        }。继续添加或执行可能会导致 RSS 订阅重复或剧集重复下载，是否确认继续？`
      });
      if (targetRss) {
        promptBox.createDiv({
          cls: "curator-rss-check-item-meta curator-mono",
          text: `本次目标 RSS：${safeDecodeRssUrl(targetRss)}`
        });
      }

      const footer = contentEl.createDiv("curator-rss-check-footer");
      const cancelBtn = footer.createEl("button", {
        cls: "curator-dl-btn",
        text: "取消操作"
      });
      cancelBtn.onclick = () => {
        this.resolved = true;
        this.close();
      };

      const confirmBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-primary",
        text: report.hasAnyMatch
          ? "确认继续（已知晓可能重复）"
          : "确认继续添加 / 执行"
      });
      confirmBtn.dataset.rssConfirmAction = "confirm";
      confirmBtn.onclick = async () => {
        this.resolved = true;
        this.close();
        if (typeof onConfirm === "function") {
          await onConfirm();
        }
      };
    }

    onClose() {
      this.contentEl.empty();
    }
  }

  const m = new RssDuplicateCheckConfirmModal(plugin.app);
  m.open();
  return m;
}

function buildCandidateKeywordsForAnime(item) {
  const candidates = [];
  const seen = new Set();
  const add = (kw, label) => {
    const clean = String(kw || "").trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    candidates.push({ keyword: clean, label });
  };

  if (item?.downloadSourceKeyword) {
    add(item.downloadSourceKeyword, "已绑定专属源");
  }

  const rawName = String(item?.name || "").trim();
  if (rawName) {
    add(rawName, "完整中文名");
    const coreName = rawName
      .replace(/[～~][^～~]+[～~]/g, " ")
      .replace(/-[^-]{2,}-/g, " ")
      .replace(/\s+(?:第[一二三四五六七八九十\d]+[季期部]|Season\s*\d+|Part\s*\d+|II|III|2|3)$/i, "")
      .replace(/[：:·・！!？?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (coreName && coreName !== rawName) {
      add(coreName, "精简主标题");
    }
  }

  const jpName = String(item?.japaneseName || "").trim();
  if (jpName) {
    add(jpName, "日文原名");
  }

  return candidates;
}

/**
 * 打开「番剧下载与 RSS 订阅工作台」弹窗
 */
function openAnimeDownloadModal(plugin, item, onUpdated) {
  const ModalClass = globalThis.__BangumiManagerModal;
  const NoticeClass = globalThis.__BangumiManagerNotice;
  if (!ModalClass) return null;

  class AnimeDownloadAssistantModal extends ModalClass {
    constructor(app) {
      super(app);
      this.plugin = plugin;
      this.item = item;
      this.onUpdated = onUpdated;
      this.baseUrl = normalizeComicatBaseUrl(plugin);
      this.currentKeyword =
        String(item?.downloadSourceKeyword || item?.name || "").trim();
      this.broadStreams = [];
      this.activeStreamId = "";
      this.currentEpisodes = [];
      this.currentPacks = [];
      this.currentDedupInfo = null;
      this.streamsExpanded = false;
      this.isLoading = false;
      this.errorMessage = "";
    }

    onOpen() {
      this.modalEl.addClass("curator-download-modal-shell");
      this.modalEl.style.width = "min(920px, 94vw)";
      this.modalEl.style.maxWidth = "94vw";
      this.modalEl.style.maxHeight = "88vh";
      this.renderShell();

      if (this.plugin.settings.enableComicatIntegration !== false && this.currentKeyword) {
        this.performSearch(this.currentKeyword, { isInitial: true });
      }
    }

    onClose() {
      this.contentEl.empty();
    }

    getLocalExistingEpisodeSet() {
      const set = new Set();
      if (this.item?.downloadPath && this.item.downloadPath !== "无") {
        const res = noteUtils.inspectLocalFolder(
          this.item.downloadPath,
          this.item.watchedEpisodes
        );
        if (res && !res.error && Array.isArray(res.videoFiles)) {
          for (const vf of res.videoFiles) {
            if (Number.isFinite(vf.episode)) {
              set.add(Number(vf.episode));
            }
          }
        }
      }
      return set;
    }

    renderShell() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-download-modal");

      // 1. 顶部标题与本地路径/qBittorrent 状态栏
      const header = contentEl.createDiv("curator-dl-header");
      const titleCol = header.createDiv("curator-dl-title-col");
      titleCol.createDiv({
        cls: "curator-dl-kicker",
        text: "ANIME DOWNLOAD & SINGLE-EPISODE RSS WORKBENCH"
      });
      titleCol.createEl("h2", {
        cls: "curator-dl-title",
        text: `追番下载与单集 RSS 助手 · 《${this.item?.name || "未命名"}》`
      });

      const metaSub = titleCol.createDiv("curator-dl-meta-sub");
      const seasonStr = [this.item?.year, this.item?.season].filter(Boolean).join(" ") || "未知番季";
      const totalEp = Number(this.item?.totalEpisodes) || 0;
      const watchedEp = Number(this.item?.watchedEpisodes) || 0;
      metaSub.createSpan({
        text: `${seasonStr} · 已看 ${watchedEp}${totalEp > 0 ? "/" + totalEp : ""} 话`
      });
      if (this.item?.rssUrl) {
        const boundBadge = metaSub.createSpan({
          cls: "curator-dl-bound-pill",
          text: `📌 已绑定源：${this.item.downloadSourceKeyword || "专属 RSS"}`
        });
        boundBadge.title = this.item.rssUrl;
      }

      // 2. 本地文件夹与 qBittorrent 环境自检卡片（绝不默认用户已安装或已启动）
      this.envBox = contentEl.createDiv("curator-dl-env-box");
      this.renderEnvStatus();

      // 2.5 本机已添加 RSS 订阅与自动下载规则实时查重横幅（无论是否检测到均向用户出示结果）
      this.rssCheckBox = contentEl.createDiv("curator-dl-rss-check-box");
      this.renderRssRuleCheckBanner();

      // 3. 搜索与快捷跳转控制栏
      const searchBox = contentEl.createDiv("curator-dl-search-box");
      const searchRow = searchBox.createDiv("curator-dl-search-row");

      this.keywordInput = searchRow.createEl("input", {
        type: "text",
        cls: "curator-dl-keyword-input",
        placeholder: "输入动画名或「[字幕组] 动画名 来源词」（如：[ANi] 穹庐下的魔女 Baha）..."
      });
      this.keywordInput.value = this.currentKeyword;
      this.keywordInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.performSearch(this.keywordInput.value.trim(), { preserveStreams: false });
        }
      };

      if (this.plugin.settings.enableComicatIntegration !== false) {
        const searchBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn is-primary",
          text: "🔍 检索漫猫发布源"
        });
        searchBtn.onclick = () => {
          this.performSearch(this.keywordInput.value.trim(), { preserveStreams: false });
        };

        const openWebBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn",
          text: "↗ 漫猫网页搜索"
        });
        openWebBtn.title = "在浏览器中打开 www.comicat.org 搜索结果页";
        openWebBtn.onclick = () => {
          const kw = this.keywordInput.value.trim() || this.item?.name || "";
          window.open(buildComicatSearchUrl(kw, this.baseUrl));
        };

        const copyRssBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn",
          text: "📋 复制当前 RSS"
        });
        copyRssBtn.dataset.dlAction = "copy-rss";
        copyRssBtn.title = "检测是否已有 RSS 订阅/下载规则并复制当前漫猫专属 RSS 订阅地址";
        copyRssBtn.onclick = () => {
          const kw = this.keywordInput.value.trim() || this.item?.name || "";
          const rssUrl = buildComicatRssUrl(kw, this.baseUrl);
          this.confirmRssRuleBeforeAction(
            {
              actionTitle: "复制 RSS 订阅地址（用于添加 RSS 订阅）",
              targetKeyword: kw,
              targetRss: rssUrl
            },
            async () => {
              if (navigator.clipboard) {
                await navigator.clipboard.writeText(rssUrl);
              }
              if (NoticeClass) {
                new NoticeClass(`已复制专属 RSS 链接：\n${rssUrl}`, 4500);
              }
            }
          );
        };
      }

      const customWebBtn = searchRow.createEl("button", {
        cls: "curator-dl-btn is-subtle",
        text: "↗ 备用站搜索"
      });
      customWebBtn.title = "在自定义备用下载网站（如蜜柑计划/动漫花园）中搜索该动画";
      customWebBtn.onclick = () => {
        const kw = this.keywordInput.value.trim() || this.item?.name || "";
        window.open(buildCustomSearchUrl(this.plugin, kw));
      };

      // 候选关键词与常用字幕组快筛芯片
      const chipsRow = searchBox.createDiv("curator-dl-chips-row");
      chipsRow.createSpan({ cls: "curator-dl-chips-label", text: "快捷词条：" });

      const baseCandidates = buildCandidateKeywordsForAnime(this.item);
      for (const cand of baseCandidates) {
        const chip = chipsRow.createEl("button", {
          cls: "curator-dl-chip",
          text: `${cand.label}：${cand.keyword}`
        });
        chip.onclick = () => {
          this.keywordInput.value = cand.keyword;
          if (this.plugin.settings.enableComicatIntegration !== false) {
            this.performSearch(cand.keyword, { preserveStreams: false });
          }
        };
      }

      const quickModifiers = ["[ANi]", "Baha", "LoliHouse", "绿茶字幕组", "喵萌奶茶屋", "简日"];
      for (const mod of quickModifiers) {
        const modChip = chipsRow.createEl("button", {
          cls: "curator-dl-chip is-modifier",
          text: `+ ${mod}`
        });
        modChip.title = `在当前搜索词中追加「${mod}」以锁定单一发布源`;
        modChip.onclick = () => {
          const cur = this.keywordInput.value.trim() || this.item?.name || "";
          if (!cur.toLowerCase().includes(mod.toLowerCase())) {
            this.keywordInput.value = mod.startsWith("[")
              ? `${mod} ${cur}`.trim()
              : `${cur} ${mod}`.trim();
          }
          if (this.plugin.settings.enableComicatIntegration !== false) {
            this.performSearch(this.keywordInput.value.trim(), { preserveStreams: true });
          }
        };
      }

      // 4. 主内容挂载区（发布源选择 + 单集唯一性核验与剧集下载列表）
      this.resultsMount = contentEl.createDiv("curator-dl-results-mount");
      this.renderResultsMount();
    }

    renderEnvStatus() {
      if (!this.envBox) return;
      this.envBox.empty();

      // 左侧：本地下载文件夹状态
      const folderCol = this.envBox.createDiv("curator-dl-env-col");
      const rawPath = String(this.item?.downloadPath || "").trim();
      const hasPath = Boolean(rawPath && rawPath !== "无");
      const folderExists = hasPath && fs.existsSync(rawPath);
      const localInspect = hasPath
        ? noteUtils.inspectLocalFolder(rawPath, this.item?.watchedEpisodes)
        : null;

      const folderHeader = folderCol.createDiv("curator-dl-env-line");
      folderHeader.createSpan({
        cls: `curator-dl-status-dot ${folderExists ? "is-ok" : "is-warn"}`
      });
      folderHeader.createSpan({
        cls: "curator-dl-env-title",
        text: folderExists
          ? `本地目录已就绪（已有 ${localInspect?.fileCount || 0} 集视频）`
          : hasPath
          ? "已配置下载路径（本地文件夹尚未创建）"
          : "尚未配置本地下载文件夹"
      });

      const pathText = folderCol.createDiv({
        cls: "curator-dl-env-path curator-mono",
        text: hasPath ? rawPath : "点击右侧「自动生成并创建目录」将按 年份/季度/番剧名 自动建立"
      });
      pathText.title = rawPath || "";

      const folderActions = folderCol.createDiv("curator-dl-env-actions");
      if (!folderExists) {
        const createDirBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "✨ 自动生成并创建本地目录"
        });
        createDirBtn.onclick = async () => {
          const { targetPath } = await ensureAnimeLocalDownloadFolder(this.plugin, this.item, true);
          if (NoticeClass) {
            new NoticeClass(`已创建并绑定本地番剧目录：\n${targetPath}`);
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
        };
      } else {
        const openDirBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "📂 打开本地文件夹"
        });
        openDirBtn.onclick = async () => {
          await noteUtils.openLocalPathSafely(rawPath);
        };

        const rescanBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🔄 刷新本地集数状态"
        });
        rescanBtn.onclick = async () => {
          if (this.item?.file) {
            await this.plugin.checkOneLocalStatus(this.item.file);
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
          if (NoticeClass) new NoticeClass("已重新扫描本地视频文件夹并同步状态。");
        };
      }

      // 右侧：qBittorrent 客户端检测与控制状态
      const qbCol = this.envBox.createDiv("curator-dl-env-col");
      const qbStatus = detectQbittorrentStatus(this.plugin);
      const qbHeader = qbCol.createDiv("curator-dl-env-line");

      if (!qbStatus.enabled) {
        qbHeader.createSpan({ cls: "curator-dl-status-dot is-muted" });
        qbHeader.createSpan({
          cls: "curator-dl-env-title",
          text: "qBittorrent 联动已关闭（当前为浏览器/磁力自选下载模式）"
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path",
          text: "点击下方剧集的「🧲 磁力」或「📄 种子」可使用您习惯的任意工具自行下载。"
        });
        const qbActions = qbCol.createDiv("curator-dl-env-actions");
        const enableQbBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "开启 qBittorrent 联动"
        });
        enableQbBtn.onclick = async () => {
          this.plugin.settings.enableQbittorrentIntegration = true;
          await this.plugin.saveSettings();
          this.renderEnvStatus();
          this.renderResultsMount();
        };
      } else if (qbStatus.installed && qbStatus.running) {
        qbHeader.createSpan({ cls: "curator-dl-status-dot is-ok" });
        qbHeader.createSpan({
          cls: "curator-dl-env-title",
          text: `qBittorrent 正在运行 (PID ${qbStatus.pid})`
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path curator-mono",
          text: qbStatus.exePath
        });
        const qbActions = qbCol.createDiv("curator-dl-env-actions");
        const toggleSkipBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text:
            this.plugin.settings.qbittorrentSkipDialog !== false
              ? "模式：静默直存番剧目录 (点击改为弹窗确认)"
              : "模式：弹出 qB 添加窗口确认 (点击改为静默直存)"
        });
        toggleSkipBtn.onclick = async () => {
          this.plugin.settings.qbittorrentSkipDialog =
            this.plugin.settings.qbittorrentSkipDialog === false;
          await this.plugin.saveSettings();
          this.renderEnvStatus();
        };
      } else if (qbStatus.installed && !qbStatus.running) {
        qbHeader.createSpan({ cls: "curator-dl-status-dot is-warn" });
        qbHeader.createSpan({
          cls: "curator-dl-env-title",
          text: "已检测到 qBittorrent（当前尚未打开）"
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path",
          text: "点击下载剧集时将自动为您拉起 qBittorrent，也可点击下方按钮立即启动："
        });
        const qbActions = qbCol.createDiv("curator-dl-env-actions");
        const startQbBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "🚀 立即打开 qBittorrent"
        });
        startQbBtn.onclick = async () => {
          startQbBtn.disabled = true;
          startQbBtn.textContent = "正在启动 qBittorrent...";
          const res = await launchQbittorrentClient(this.plugin);
          if (res.ok && NoticeClass) {
            new NoticeClass("已启动 qBittorrent 客户端。");
          }
          this.renderEnvStatus();
        };
      } else {
        qbHeader.createSpan({ cls: "curator-dl-status-dot is-warn" });
        qbHeader.createSpan({
          cls: "curator-dl-env-title",
          text: "未检测到 qBittorrent 客户端"
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path",
          text: "您可前往官网下载安装 qBittorrent，或直接使用磁力/种子自行下载："
        });
        const qbActions = qbCol.createDiv("curator-dl-env-actions");
        const dlQbBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "↗ 前往官网下载 qBittorrent"
        });
        dlQbBtn.onclick = () => {
          window.open(OFFICIAL_QBITTORRENT_URL);
        };
        const disableQbBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "不使用 qBittorrent（切换为纯磁力/种子模式）"
        });
        disableQbBtn.onclick = async () => {
          this.plugin.settings.enableQbittorrentIntegration = false;
          await this.plugin.saveSettings();
          this.renderEnvStatus();
          this.renderResultsMount();
        };
      }
    }

    getLatestRssCheckReport(customKeyword, customRssUrl) {
      const kw = String(customKeyword || this.currentKeyword || this.item?.name || "").trim();
      const rss = String(customRssUrl || buildComicatRssUrl(kw, this.baseUrl)).trim();
      this.lastRssCheckReport = detectExistingRssAndDownloadRules(
        this.plugin,
        this.item,
        kw,
        rss
      );
      return this.lastRssCheckReport;
    }

    confirmRssRuleBeforeAction(actionMeta, onConfirm) {
      const report = this.getLatestRssCheckReport(
        actionMeta?.targetKeyword,
        actionMeta?.targetRss
      );
      return openRssDuplicateConfirmModal(
        this.plugin,
        this.item,
        report,
        actionMeta,
        async () => {
          if (typeof onConfirm === "function") {
            await onConfirm();
          }
          this.renderRssRuleCheckBanner();
        }
      );
    }

    renderRssRuleCheckBanner() {
      if (!this.rssCheckBox) return;
      this.rssCheckBox.empty();

      const report = this.getLatestRssCheckReport();
      const enabledCount = report.matchedRules.filter((r) => r.enabled).length;
      const disabledCount = report.matchedRules.length - enabledCount;

      const card = this.rssCheckBox.createDiv(
        `curator-rss-inline-card ${
          report.hasEnabledRule
            ? "is-warn"
            : report.hasAnyMatch
            ? "is-info"
            : "is-clean"
        }`
      );

      const leftCol = card.createDiv("curator-rss-inline-left");
      const headRow = leftCol.createDiv("curator-rss-inline-head");

      if (report.hasAnyMatch) {
        headRow.createSpan({
          cls: `curator-rss-inline-badge ${report.hasEnabledRule ? "is-warn" : "is-info"}`,
          text: report.hasEnabledRule
            ? `⚠️ 已检出 ${enabledCount} 条启用中的下载规则`
            : "ℹ️ 已检出关联订阅记录"
        });
        headRow.createSpan({
          cls: "curator-rss-inline-title",
          text: `本机 RSS 订阅与下载规则检测结果（规则 ${report.matchedRules.length} 条：🟢启用 ${enabledCount} / ⚪停用 ${disabledCount} · 订阅源 ${report.matchedFeeds.length} 条）`
        });

        const detailList = leftCol.createDiv("curator-rss-inline-details");
        for (const r of report.matchedRules.slice(0, 3)) {
          const tag = detailList.createDiv("curator-rss-inline-rule-line");
          tag.createSpan({
            cls: `curator-rss-rule-state-pill ${r.enabled ? "is-enabled" : "is-disabled"}`,
            text: r.enabled ? "🟢 已启用" : "⚪ 已停用"
          });
          tag.createSpan({
            cls: "curator-rss-inline-rule-name",
            text: `规则「${r.ruleName}」`
          });
          if (r.decodedFeeds[0]) {
            tag.createSpan({
              cls: "curator-rss-inline-rule-feed curator-mono",
              text: r.decodedFeeds[0]
            });
          }
        }
        if (report.matchedRules.length === 0 && report.matchedFeeds.length > 0) {
          for (const f of report.matchedFeeds.slice(0, 2)) {
            const tag = detailList.createDiv("curator-rss-inline-rule-line");
            tag.createSpan({
              cls: "curator-rss-rule-state-pill is-enabled",
              text: `📂 ${f.folderPath}`
            });
            tag.createSpan({
              cls: "curator-rss-inline-rule-name",
              text: `订阅「${f.feedName}」`
            });
            tag.createSpan({
              cls: "curator-rss-inline-rule-feed curator-mono",
              text: f.decodedUrl
            });
          }
        }
        leftCol.createDiv({
          cls: "curator-rss-inline-hint",
          text: "提示：点击下方任意 RSS 复制/绑定或下载按钮时，插件将再次出示完整检测明细并询问是否继续，以防 RSS 订阅重复。"
        });
      } else {
        headRow.createSpan({
          cls: "curator-rss-inline-badge is-clean",
          text: "✅ 未检出已有规则"
        });
        headRow.createSpan({
          cls: "curator-rss-inline-title",
          text: "本机 RSS 订阅与下载规则检测结果：未发现与该番剧相关的 qBittorrent 下载规则或 RSS 订阅源"
        });
        leftCol.createDiv({
          cls: "curator-rss-inline-hint",
          text: "已扫描 qBittorrent (download_rules.json / feeds.json) 与当前笔记属性。点击下方 RSS/下载操作时仍会向您出示完整检测报告并确认是否继续。"
        });
      }

      const rightCol = card.createDiv("curator-rss-inline-actions");
      const inspectBtn = rightCol.createEl("button", {
        cls: "curator-dl-mini-btn is-accent",
        text: "🔍 查看完整查重报告 & 复制 RSS"
      });
      inspectBtn.dataset.dlAction = "inspect-rss-check";
      inspectBtn.onclick = () => {
        const kw = this.keywordInput?.value?.trim() || this.currentKeyword || this.item?.name || "";
        const rssUrl = buildComicatRssUrl(kw, this.baseUrl);
        this.confirmRssRuleBeforeAction(
          {
            actionTitle: "复制当前专属 RSS 订阅地址（供添加至下载器）",
            targetKeyword: kw,
            targetRss: rssUrl
          },
          async () => {
            if (navigator.clipboard) {
              await navigator.clipboard.writeText(rssUrl).catch(() => {});
            }
            if (NoticeClass) {
              new NoticeClass(`已确认并复制专属 RSS 订阅地址：\n${rssUrl}`, 4500);
            }
          }
        );
      };
    }

    async performSearch(keyword, opts = {}) {
      const cleanKw = String(keyword || "").trim();
      if (!cleanKw) return;

      this.currentKeyword = cleanKw;
      if (this.keywordInput && this.keywordInput.value !== cleanKw) {
        this.keywordInput.value = cleanKw;
      }

      this.renderRssRuleCheckBanner();
      this.isLoading = true;
      this.errorMessage = "";
      this.renderResultsMount();

      const rssUrl = buildComicatRssUrl(cleanKw, this.baseUrl);
      try {
        const xmlText = await fetchComicatRssXml(rssUrl);
        const parsed = parseComicatRssXml(xmlText, this.item?.name || "", this.baseUrl);

        if (!opts.preserveStreams || this.broadStreams.length === 0) {
          this.broadStreams = parsed.streams;
        }

        const dedup = deduplicateEpisodeItems(parsed.items);
        this.currentDedupInfo = dedup;
        this.currentEpisodes = dedup.episodes;
        this.currentPacks = dedup.packs;

        // 如果这是首次按番名宽泛搜索且发现存在多个字幕组混杂，记录候选流供用户一键锁定
        if (opts.isInitial && parsed.streams.length > 0 && !this.item?.downloadSourceKeyword) {
          this.activeStreamId = "";
        }
      } catch (err) {
        this.errorMessage = err?.message || "请求漫猫 (comicat.org) 失败";
        this.currentEpisodes = [];
        this.currentPacks = [];
        this.currentDedupInfo = null;
      } finally {
        this.isLoading = false;
        this.renderResultsMount();
      }
    }

    renderResultsMount() {
      if (!this.resultsMount) return;
      this.resultsMount.empty();

      if (this.plugin.settings.enableComicatIntegration === false) {
        const disabledBox = this.resultsMount.createDiv("curator-dl-empty-box");
        disabledBox.createDiv({
          cls: "curator-dl-empty-title",
          text: "已关闭漫猫 (comicat.org) 内置检索联动"
        });
        disabledBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "您可使用上方「↗ 备用站搜索」跳转至外部网站下载，或在下方重新开启漫猫搜索联动。"
        });
        const reEnableBtn = disabledBox.createEl("button", {
          cls: "curator-dl-btn is-primary",
          text: "重新开启 comicat.org 内置搜索与 RSS 助手"
        });
        reEnableBtn.onclick = async () => {
          this.plugin.settings.enableComicatIntegration = true;
          await this.plugin.saveSettings();
          this.renderShell();
          this.performSearch(this.currentKeyword, { isInitial: true });
        };
        return;
      }

      if (this.isLoading) {
        const loadingBox = this.resultsMount.createDiv("curator-dl-empty-box");
        loadingBox.createDiv({
          cls: "curator-dl-empty-title",
          text: `正在从 comicat.org 检索「${this.currentKeyword}」的发布源与剧集列表...`
        });
        loadingBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "正在解析字幕组版本流并核验单集唯一性，请稍候。"
        });
        return;
      }

      if (this.errorMessage) {
        const errBox = this.resultsMount.createDiv("curator-dl-empty-box is-error");
        errBox.createDiv({
          cls: "curator-dl-empty-title",
          text: `未能获取漫猫 RSS 数据：${this.errorMessage}`
        });
        errBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "部分网络环境下可能无法直连 www.comicat.org，或者当前需要使用代理。您也可以直接点击上方「↗ 漫猫网页搜索」或「↗ 备用站搜索」在浏览器中操作。"
        });
        return;
      }

      // 1. 候选发布源面板（让用户自行选择发布源，自动构造「[字幕组] 番名 特征词」以保证每集唯一）
      if (this.broadStreams.length > 0) {
        const totalStreamCount = this.broadStreams.length;
        const defaultLimit = 12;
        const hasMoreStreams = totalStreamCount > defaultLimit;
        const isExpandedAll = Boolean(this.streamsExpanded) || !hasMoreStreams;
        const visibleStreams = isExpandedAll
          ? this.broadStreams
          : this.broadStreams.slice(0, defaultLimit);

        const streamSection = this.resultsMount.createDiv("curator-dl-streams-section");
        const streamHeader = streamSection.createDiv("curator-dl-section-head");
        const streamHeaderTop = streamHeader.createDiv("curator-dl-section-head-row");
        streamHeaderTop.createDiv({
          cls: "curator-dl-section-title",
          text: `① 选择发布源 / 字幕组版本流（共识别出 ${totalStreamCount} 组可用发布源）`
        });

        if (hasMoreStreams) {
          const toggleExpandBtn = streamHeaderTop.createEl("button", {
            cls: "curator-dl-mini-btn is-accent curator-dl-streams-toggle-btn",
            text: isExpandedAll
              ? `▴ 收起发布源（仅显示前 ${defaultLimit} 组）`
              : `▾ 展开全部 ${totalStreamCount} 组发布源（还有 ${totalStreamCount - defaultLimit} 组）`
          });
          toggleExpandBtn.onclick = () => {
            this.streamsExpanded = !this.streamsExpanded;
            this.renderResultsMount();
          };
        }

        streamHeader.createDiv({
          cls: "curator-dl-section-hint",
          text: "点击任一发布源即可自动切换为该字幕组专属搜索词（确保每集仅下载 1 份）"
        });

        const streamGrid = streamSection.createDiv(
          `curator-dl-stream-grid ${isExpandedAll && hasMoreStreams ? "is-expanded-scroll" : ""}`
        );
        for (const st of visibleStreams) {
          const isSelected =
            this.activeStreamId === st.streamId ||
            this.currentKeyword === st.recommendedKeyword;
          const card = streamGrid.createDiv(
            `curator-dl-stream-card ${isSelected ? "is-active" : ""}`
          );
          card.title = `点击切换至此发布源（搜索词：${st.recommendedKeyword}）`;
          const topRow = card.createDiv("curator-dl-stream-top");
          topRow.createSpan({
            cls: "curator-dl-stream-group",
            text: st.group
          });
          topRow.createSpan({
            cls: "curator-dl-stream-epcount curator-mono",
            text: st.episodeCount > 0 ? `已检出 ${st.episodeCount} 集` : `${st.totalRawCount} 条`
          });

          const tagsRow = card.createDiv("curator-dl-stream-tags");
          const tags = [st.platform, st.lang, st.resolution, st.format].filter(Boolean);
          if (tags.length > 0) {
            tags.forEach((tag) => {
              tagsRow.createSpan({ cls: "curator-dl-stream-tag", text: tag });
            });
          } else {
            tagsRow.createSpan({ cls: "curator-dl-stream-tag", text: "标准发布流" });
          }

          card.onclick = () => {
            this.activeStreamId = st.streamId;
            this.performSearch(st.recommendedKeyword, { preserveStreams: true });
          };
        }

        if (hasMoreStreams && !isExpandedAll) {
          const expandMoreBar = streamSection.createEl("button", {
            cls: "curator-dl-streams-more-bar",
            text: `▾ 展开查看其余 ${totalStreamCount - defaultLimit} 组发布源（共 ${totalStreamCount} 组）`
          });
          expandMoreBar.onclick = () => {
            this.streamsExpanded = true;
            this.renderResultsMount();
          };
        }
      }

      // 2. 当前检索结果为空时的温和提示（未开播或冷门无人搬运）
      if (this.currentEpisodes.length === 0 && this.currentPacks.length === 0) {
        const emptyBox = this.resultsMount.createDiv("curator-dl-empty-box");
        emptyBox.createDiv({
          cls: "curator-dl-empty-title",
          text: `漫猫 (comicat.org) 暂未收录「${this.currentKeyword}」的可下载剧集`
        });
        emptyBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "该动画可能尚未到播出时间、暂无人搬运，或漫猫使用了其他译名。您可以选择上方的“快捷词条”或修改搜索词重试，或直接忽略。"
        });
        return;
      }

      // 3. 单集唯一性核验横幅 + 一键批量操作栏
      const localEpSet = this.getLocalExistingEpisodeSet();
      const missingEpisodes = this.currentEpisodes.filter(
        (epItem) => !localEpSet.has(Number(epItem.episode))
      );

      const actionBanner = this.resultsMount.createDiv("curator-dl-verify-banner");
      const verifyLeft = actionBanner.createDiv("curator-dl-verify-info");
      const dupCount = this.currentDedupInfo?.duplicateReplacedCount || 0;
      const rangeText =
        this.currentDedupInfo?.minEp !== null && this.currentDedupInfo?.maxEp !== null
          ? `第 ${String(this.currentDedupInfo.minEp).padStart(2, "0")}–${String(this.currentDedupInfo.maxEp).padStart(2, "0")} 话`
          : "";

      verifyLeft.createDiv({
        cls: "curator-dl-verify-title",
        text:
          dupCount === 0
            ? `✅ 每集唯一性核验通过：共 ${this.currentEpisodes.length} 集（${rangeText}），每集严格 1 条资源`
            : `🛡️ 已自动去重 ${dupCount} 条重复/v1旧版条目：当前锁定 ${this.currentEpisodes.length} 集（${rangeText}），确保每集仅下载 1 份`
      });

      const currentRssUrl = buildComicatRssUrl(this.currentKeyword, this.baseUrl);
      verifyLeft.createDiv({
        cls: "curator-dl-verify-rss curator-mono",
        text: `专属 RSS：${currentRssUrl}`
      });

      const verifyActions = actionBanner.createDiv("curator-dl-verify-actions");
      const qbStatus = detectQbittorrentStatus(this.plugin);

      if (missingEpisodes.length > 0 && qbStatus.enabled && qbStatus.installed) {
        const batchDlBtn = verifyActions.createEl("button", {
          cls: "curator-dl-btn is-primary",
          text: `⬇ 一键下载本地缺失的 ${missingEpisodes.length} 集 (qBittorrent)`
        });
        batchDlBtn.dataset.dlAction = "batch-qb-download";
        batchDlBtn.onclick = () => {
          this.confirmRssRuleBeforeAction(
            {
              actionTitle: `一键投递本地缺失的 ${missingEpisodes.length} 集至 qBittorrent`,
              targetKeyword: this.currentKeyword,
              targetRss: currentRssUrl
            },
            async () => {
              batchDlBtn.disabled = true;
              const res = await dispatchDownloadToQbittorrent(
                this.plugin,
                this.item,
                missingEpisodes
              );
              batchDlBtn.disabled = false;
              if (res.ok) {
                if (NoticeClass) {
                  new NoticeClass(
                    `已将《${this.item.name}》的 ${res.dispatchedCount} 集发送至 qBittorrent！\n保存目录：${res.savePath}`,
                    5000
                  );
                }
                this.renderEnvStatus();
              } else if (NoticeClass) {
                new NoticeClass(`发送失败：${res.reason}`);
              }
            }
          );
        };
      }

      const bindSourceBtn = verifyActions.createEl("button", {
        cls: "curator-dl-btn is-accent",
        text: "📌 绑定为该番默认下载源与 RSS"
      });
      bindSourceBtn.dataset.dlAction = "bind-rss-source";
      bindSourceBtn.title = "检测是否已有 RSS 订阅规则，并将该精准搜索词与专属 RSS 地址写入动画笔记 Frontmatter";
      bindSourceBtn.onclick = () => {
        this.confirmRssRuleBeforeAction(
          {
            actionTitle: "绑定为该番默认下载源与专属 RSS 订阅地址",
            targetKeyword: this.currentKeyword,
            targetRss: currentRssUrl
          },
          async () => {
            await bindAnimeDownloadSourceToNote(this.plugin, this.item, {
              keyword: this.currentKeyword,
              rssUrl: currentRssUrl,
              streamId: this.activeStreamId || this.currentKeyword
            });
            if (NoticeClass) {
              new NoticeClass(`已将「${this.currentKeyword}」绑定至《${this.item.name}》笔记！`);
            }
            this.renderShell();
            this.renderResultsMount();
            if (typeof this.onUpdated === "function") this.onUpdated();
          }
        );
      };

      // 4. 剧集明细列表（按集数从新到旧排列）
      const epListWrap = this.resultsMount.createDiv("curator-dl-ep-list");
      for (const epItem of this.currentEpisodes) {
        const epNum = Number(epItem.episode);
        const isLocalDownloaded = localEpSet.has(epNum);

        const row = epListWrap.createDiv(
          `curator-dl-ep-row ${isLocalDownloaded ? "is-downloaded" : "is-missing"}`
        );

        const badgeCol = row.createDiv("curator-dl-ep-badge-col");
        badgeCol.createSpan({
          cls: "curator-dl-ep-num curator-mono",
          text: `第 ${String(epNum).padStart(2, "0")} 话`
        });
        if (epItem.version > 1) {
          badgeCol.createSpan({
            cls: "curator-dl-ep-ver",
            text: `v${epItem.version}`
          });
        }
        badgeCol.createSpan({
          cls: `curator-dl-ep-local-tag ${isLocalDownloaded ? "is-ok" : "is-new"}`,
          text: isLocalDownloaded ? "本地已有" : "待下载"
        });

        const infoCol = row.createDiv("curator-dl-ep-info-col");
        infoCol.createDiv({
          cls: "curator-dl-ep-title",
          text: epItem.title
        });
        const subMeta = [
          epItem.group ? `发布组：${epItem.group}` : "",
          epItem.pubDate ? `发布时间：${epItem.pubDate}` : ""
        ]
          .filter(Boolean)
          .join(" · ");
        infoCol.createDiv({
          cls: "curator-dl-ep-sub",
          text: subMeta
        });

        const actCol = row.createDiv("curator-dl-ep-actions-col");
        if (qbStatus.enabled && qbStatus.installed) {
          const qbBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-primary",
            text: "⬇ qB下载"
          });
          qbBtn.title = "检测是否已有订阅规则并调用本机 qBittorrent 下载本集到番剧文件夹";
          qbBtn.onclick = () => {
            this.confirmRssRuleBeforeAction(
              {
                actionTitle: `使用 qBittorrent 下载第 ${String(epNum).padStart(2, "0")} 话`,
                targetKeyword: this.currentKeyword,
                targetRss: currentRssUrl
              },
              async () => {
                const res = await dispatchDownloadToQbittorrent(this.plugin, this.item, [epItem]);
                if (res.ok && NoticeClass) {
                  new NoticeClass(`已投递《${this.item.name}》第 ${epNum} 话至 qBittorrent`);
                }
                this.renderEnvStatus();
              }
            );
          };
        }

        if (epItem.magnetUrl) {
          const magBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: "🧲 磁力"
          });
          magBtn.title = "检测是否已有订阅规则并唤起磁力链接 / 复制 Magnet 地址";
          magBtn.onclick = () => {
            this.confirmRssRuleBeforeAction(
              {
                actionTitle: `唤起第 ${String(epNum).padStart(2, "0")} 话磁力链接下载`,
                targetKeyword: this.currentKeyword,
                targetRss: currentRssUrl
              },
              async () => {
                if (navigator.clipboard) {
                  await navigator.clipboard.writeText(epItem.magnetUrl).catch(() => {});
                }
                window.open(epItem.magnetUrl);
                if (NoticeClass) {
                  new NoticeClass(`已唤起磁力链接并复制到剪贴板（第 ${epNum} 话）`);
                }
              }
            );
          };
        }

        if (epItem.torrentUrl) {
          const torBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: "📄 种子"
          });
          torBtn.title = "检测是否已有订阅规则并直接下载 .torrent 种子文件";
          torBtn.onclick = () => {
            this.confirmRssRuleBeforeAction(
              {
                actionTitle: `下载第 ${String(epNum).padStart(2, "0")} 话 .torrent 种子文件`,
                targetKeyword: this.currentKeyword,
                targetRss: currentRssUrl
              },
              () => {
                window.open(epItem.torrentUrl);
              }
            );
          };
        }

        if (epItem.link) {
          const pageBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-subtle",
            text: "↗"
          });
          pageBtn.title = "打开漫猫该集发布详情页";
          pageBtn.onclick = () => {
            window.open(epItem.link);
          };
        }
      }
    }
  }

  const modal = new AnimeDownloadAssistantModal(plugin.app);
  modal.open();
  return modal;
}

module.exports = {
  OFFICIAL_QBITTORRENT_URL,
  DEFAULT_COMICAT_BASE_URL,
  buildComicatSearchUrl,
  buildComicatRssUrl,
  buildCustomSearchUrl,
  fetchComicatRssXml,
  parseEpisodeAndVersionFromTitle,
  parseComicatTitleMeta,
  parseComicatRssXml,
  deduplicateEpisodeItems,
  detectQbittorrentStatus,
  launchQbittorrentClient,
  ensureAnimeLocalDownloadFolder,
  dispatchDownloadToQbittorrent,
  bindAnimeDownloadSourceToNote,
  detectExistingRssAndDownloadRules,
  openRssDuplicateConfirmModal,
  openAnimeDownloadModal
};
