const obsidian = require("obsidian");
const noteUtils = require("./note-utils.js");
const noteManager = require("./note-manager.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const v07Core = require("./v07-core.js");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  crossPlatformPath: path,
  crossPlatformFs: fs,
  toNodeBufferOrUint8
} = require("./platform-env.js");

function getSafeEnv() {
  return (typeof process !== "undefined" && process && process.env) || {};
}

function isWinPlatform() {
  return isDesktopNodeAvailable() && typeof process !== "undefined" && process.platform === "win32";
}

function execSync(...args) {
  const cp = tryRequireNode("child_process");
  if (!cp || typeof cp.execSync !== "function") return "";
  return cp.execSync(...args);
}

function spawn(...args) {
  const cp = tryRequireNode("child_process");
  if (!cp || typeof cp.spawn !== "function") {
    throw new Error("当前移动端环境不支持启动本地 qBittorrent 进程");
  }
  return cp.spawn(...args);
}

function getSafeTmpDir() {
  const osMod = tryRequireNode("os");
  return osMod && typeof osMod.tmpdir === "function" ? osMod.tmpdir() : "";
}

function getSafeHomeDir() {
  const osMod = tryRequireNode("os");
  return osMod && typeof osMod.homedir === "function" ? osMod.homedir() : "";
}

function generateRandomUuid() {
  const cryptoMod = tryRequireNode("crypto");
  if (cryptoMod && typeof cryptoMod.randomUUID === "function") {
    return cryptoMod.randomUUID();
  }
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const OFFICIAL_QBITTORRENT_URL = "https://www.qbittorrent.org/download";
const DEFAULT_COMICAT_BASE_URL = "http://www.comicat.org";
const PUBLIC_ANIME_TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "https://tr.bangumi.moe:9696/announce",
  "http://tr.bangumi.moe:6969/announce",
  "http://open.acgtracker.com:1096/announce",
  "http://t.nyaatracker.com:80/announce",
  "https://tracker.tamersunion.org:443/announce",
  "https://tracker.moeblog.cn:443/announce",
  "https://tracker.gbitt.info:443/announce",
  "http://tracker.gbitt.info:80/announce",
  "https://tracker.lilithraws.org:443/announce",
  "https://tracker.nanoha.org:443/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "https://tracker.opentrackr.org:443/announce",
  "http://tracker1.itzmx.com:8080/announce",
  "http://tracker.bt4g.com:2095/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce"
];

let _cachedExtraTrackers = null;
function getAugmentedAnimeTrackers() {
  if (_cachedExtraTrackers) return _cachedExtraTrackers;
  const set = new Set(PUBLIC_ANIME_TRACKERS);
  if (isDesktopNodeAvailable()) {
    try {
      const localAppData = getSafeEnv().LOCALAPPDATA || "";
      if (localAppData) {
        const extraFile = path.join(localAppData, "qBittorrent", "additional_trackers_from_url.txt");
        if (fs.existsSync(extraFile)) {
          const lines = fs
            .readFileSync(extraFile, "utf8")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => /^(?:https?|udp):\/\//i.test(s));
          // 优先注入 HTTP/HTTPS tracker（在 Fake-IP TUN 代理环境下 UDP 常被阻断，HTTP/HTTPS 可正常穿透）
          for (const tr of lines) {
            if (/^https?:\/\//i.test(tr)) set.add(tr);
          }
          for (const tr of lines.slice(0, 25)) {
            set.add(tr);
          }
        }
      }
    } catch (e) {}
  }
  _cachedExtraTrackers = Array.from(set);
  return _cachedExtraTrackers;
}

/**
 * 探测 Windows 系统代理设置（当 Obsidian requestUrl 不可用或超时时作为 Node 回退通道）
 */
function detectWindowsSystemProxy() {
  if (!isWinPlatform()) return null;
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
  const http = tryRequireNode("http");
  const https = tryRequireNode("https");
  if (!http || !https) {
    if (typeof fetch === "function") {
      return fetch(targetUrl).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
    }
    return Promise.reject(new Error("当前环境不支持 Node HTTP 回退"));
  }
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
  let groupSearchToken = "";
  if (group && group !== "其他发布源") {
    if (group.includes("&")) {
      groupSearchToken = group.split("&")[0].trim();
    } else {
      groupSearchToken = `[${group}]`;
    }
    if (groupSearchToken) keywordTokens.push(groupSearchToken);
  }
  const cleanAnimeName = String(animeName || "").trim();
  if (cleanAnimeName) {
    keywordTokens.push(cleanAnimeName);
  }
  const fallbackKeyword = keywordTokens.join(" ").trim();
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
    recommendedKeyword: keywordTokens.join(" ").trim(),
    fallbackKeyword
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
 * 判定 RSS 链接或种子附件是否指向 enclosure 已墙死失效的站点（如漫猫 comicat.org 硬编码的 v2.uploadbt.com）
 */
function isDeadEnclosureRssFeed(rawUrl) {
  return /(?:^|\/\/|\.)(comicat\.org|kisssub\.org|miobt\.com|uploadbt\.com)\b/i.test(
    String(rawUrl || "").trim()
  );
}

/**
 * 判定 RSS 链接是否为未带任何作品/关键词过滤的全站大杂烩总源（严禁直接轮询投递，防串番误下无关动画）
 */
function isGenericSiteWideRssFeed(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return true;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");
    const search = u.search || "";
    if (/(?:^|\.)(comicat\.org|kisssub\.org|miobt\.com)$/i.test(host)) {
      // 漫猫专属搜索源格式为 /rss-<keyword>.xml；裸 /rss.xml 或 /rss-all.xml 均为全站总源
      if (!pathname || /^\/rss(?:-all)?\.xml$/i.test(pathname)) {
        return !/[?&](?:keyword|kw|q)=[^&]+/i.test(search);
      }
      return false;
    }
    if (/mikanani\.me|mikanime\.tv/i.test(host)) {
      if (/^\/rss\/classic$/i.test(pathname)) return true;
      if (/^\/rss\/mybangumi$/i.test(pathname) && !/[?&]token=/i.test(search)) return true;
      if (/^\/rss\/search$/i.test(pathname) && !/[?&]searchstr=[^&]+/i.test(search)) return true;
    }
    if (/dmhy\.org/i.test(host)) {
      if (/\/rss\.xml$/i.test(pathname) && !/[?&]keyword=[^&]+/i.test(search)) return true;
    }
    if (/nyaa\.si/i.test(host)) {
      if (/[?&]page=rss/i.test(search) && !/[?&]q=[^&]+/i.test(search)) return true;
    }
  } catch (_) {
    if (/\/rss(?:-all)?\.xml\s*$/i.test(raw)) return true;
  }
  return false;
}

function normalizeSubSavePathKey(p) {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function selectSpecificFeedFromAffected(affected, fallbackKeyword = "") {
  const list = (Array.isArray(affected) ? affected : [])
    .map((f) => String(f || "").trim())
    .filter(Boolean);
  const specificDead = list.find((f) => isDeadEnclosureRssFeed(f) && !isGenericSiteWideRssFeed(f));
  if (specificDead) return specificDead;
  const specificAny = list.find((f) => !isGenericSiteWideRssFeed(f));
  if (specificAny) return specificAny;
  const cleanKw = String(fallbackKeyword || "").trim();
  if (cleanKw && list.some((f) => isDeadEnclosureRssFeed(f))) {
    return buildComicatRssUrl(cleanKw);
  }
  return "";
}

/**
 * 兼容 qBittorrent 通配符语法的标题过滤器：
 * - `|` 分隔多个「或（OR）」子句；
 * - 单个子句内以空白分隔多个「且（AND）」词元；
 * - 词元内支持 `*`（任意字符序列）与 `?`（单个字符），大小写不敏感。
 */
function matchesQbWildcardFilter(title, patternRaw) {
  const raw = String(patternRaw || "").trim();
  if (!raw) return false;
  const text = String(title || "");
  const clauses = raw
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length === 0) return false;

  return clauses.some((clause) => {
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tk) => {
      if (!tk.includes("*") && !tk.includes("?")) {
        return text.toLowerCase().includes(tk.toLowerCase());
      }
      const escaped = tk
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[\\s\\S]*")
        .replace(/\?/g, ".");
      try {
        return new RegExp(escaped, "i").test(text);
      } catch (_) {
        return text.toLowerCase().includes(tk.replace(/[*?]/g, "").toLowerCase());
      }
    });
  });
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
      enclosureUrl.match(/hash=([a-fA-F0-9]{40})/i) ||
      enclosureUrl.match(/btih:([a-fA-F0-9]{40})/i);
    const infoHash = hashMatch ? hashMatch[1].toLowerCase() : "";

    const trackerList = getAugmentedAnimeTrackers();
    const trackerSuffix = trackerList.map((tr) => `&tr=${encodeURIComponent(tr)}`).join("");
    const magnetUrl =
      enclosureUrl.startsWith("magnet:?")
        ? enrichMagnetUrlWithTrackers(enclosureUrl)
        : infoHash
        ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}${trackerSuffix}`
        : "";
    const safeEnclosure =
      enclosureUrl && !enclosureUrl.startsWith("magnet:?") && !isDeadEnclosureRssFeed(enclosureUrl)
        ? enclosureUrl
        : "";
    const torrentUrl =
      safeEnclosure || (infoHash ? `https://itorrents.org/torrent/${infoHash.toUpperCase()}.torrent` : "");

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
        fallbackKeyword: meta.fallbackKeyword || meta.recommendedKeyword,
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
      packCount: dedup.packs.length,
      minEp: dedup.minEp,
      maxEp: dedup.maxEp,
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
  if (!enabled || !isDesktopNodeAvailable()) {
    return {
      enabled: enabled && isDesktopNodeAvailable(),
      installed: false,
      running: false,
      pid: null,
      exePath: "",
      officialDownloadUrl: OFFICIAL_QBITTORRENT_URL,
      mobileEnv: !isDesktopNodeAvailable()
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
  const localAppData = getSafeEnv().LOCALAPPDATA || "";
  if (localAppData) {
    candidates.push(path.join(localAppData, "Programs/qBittorrent/qbittorrent.exe"));
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
  if (!exePath && isWinPlatform()) {
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
  if (exePath && isWinPlatform()) {
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
async function launchQbittorrentClient(plugin, opts = {}) {
  const status = detectQbittorrentStatus(plugin);
  if (!status.installed || !status.exePath) {
    return { ok: false, reason: "not_installed", status };
  }
  if (status.running) {
    return { ok: true, alreadyRunning: true, status };
  }
  try {
    const args = opts.noSplash ? ["--no-splash"] : [];
    const child = spawn(status.exePath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: Boolean(opts.noSplash)
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
async function ensureAnimeLocalDownloadFolder(plugin, item, createOnDisk = true, customTargetPath = "") {
  if (item?.isSamplePreviewItem) {
    return {
      ok: false,
      targetPath: "",
      createdOnDisk: false,
      updatedNote: false,
      error: "当前作品为示例样片预览，不会在本地磁盘创建目录。请先导入真实动画笔记后再试。"
    };
  }

  let targetPath = String(customTargetPath || item?.downloadPath || "").trim();
  const needsWritePathToNote =
    Boolean(customTargetPath) || !item?.downloadPath || String(item.downloadPath).trim() === "无";

  if (!targetPath || targetPath === "无") {
    const base = String(plugin?.settings?.localAnimeRoot || "")
      .trim()
      .replace(/[\\/]+$/, "");
    if (!base) {
      return {
        ok: false,
        targetPath: "",
        createdOnDisk: false,
        updatedNote: false,
        error: "尚未在插件设置中填写「本地动画根目录」，请先前往设置指定保存根目录。"
      };
    }
    const year = String(item?.year || new Date().getFullYear()).trim() || String(new Date().getFullYear());
    const season = String(item?.season || "10月新番").trim() || "10月新番";
    const safeFolder = noteManager.getSafeFileName(item?.name || "未命名动画");
    targetPath = `${base}/${year}/${season}/${safeFolder}`.replace(/\\/g, "/");
  } else {
    targetPath = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  let createdOnDisk = false;
  let diskError = "";
  if (createOnDisk && targetPath && targetPath !== "无") {
    if (!isDesktopNodeAvailable()) {
      return {
        ok: false,
        targetPath,
        createdOnDisk: false,
        updatedNote: false,
        error: "当前处于移动端环境，暂不支持直接创建电脑端本地文件夹。"
      };
    }
    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      createdOnDisk = Boolean(fs.existsSync(targetPath));
      if (!createdOnDisk) {
        diskError = "目录创建后仍未检测到文件夹，请检查目标盘符是否存在或是否有写入权限";
      }
    } catch (err) {
      diskError = err?.message || String(err);
      console.warn("[BangumiDownload] 创建本地动画文件夹失败:", err);
    }

    if (!createdOnDisk) {
      return {
        ok: false,
        targetPath,
        createdOnDisk: false,
        updatedNote: false,
        error: `无法创建本地目录「${targetPath}」（${diskError || "目标盘符不存在或无写入权限"}）。请在设置中检查「本地动画根目录」路径是否有效。`
      };
    }
  }

  let updatedNote = false;
  let noteError = "";
  const targetFile =
    item?.file ||
    (item?.path && plugin?.app?.vault
      ? plugin.app.vault.getAbstractFileByPath(item.path)
      : null);

  if (targetFile && needsWritePathToNote) {
    try {
      let content = await plugin.app.vault.read(targetFile);
      if (typeof noteUtils.inspectAndUpgradeAnimeNoteContent === "function") {
        const upg = noteUtils.inspectAndUpgradeAnimeNoteContent(content, {
          ...(typeof plugin?.getScoreDisplayOptions === "function"
            ? plugin.getScoreDisplayOptions()
            : {}),
          cachedPersonalScore: plugin?.settings?.personalRatingCache?.[targetFile.path] || ""
        });
        if (upg.isTargetAnimeNote && upg.needsUpgrade) {
          content = upg.upgradedContent;
        }
      }
      const inspectRes = isDesktopNodeAvailable()
        ? noteUtils.inspectLocalFolder(targetPath, item?.watchedEpisodes)
        : { downloadPath: targetPath, error: null, newCount: 0 };
      content = noteUtils.updateFrontmatterField(content, "下载路径", targetPath);
      content = noteUtils.updateFrontmatterField(
        content,
        "本地更新状态",
        noteUtils.getLocalStatusText(inspectRes)
      );
      content = noteUtils.updateFolderLine(content, {
        downloadPath: targetPath,
        error: null
      });
      content = noteUtils.syncNoteCalloutFromFrontmatter(content);
      if (typeof plugin?.modifyNoteSafely === "function") {
        await plugin.modifyNoteSafely(targetFile, content);
      } else {
        await plugin.app.vault.modify(targetFile, content);
      }
      item.file = targetFile;
      item.downloadPath = targetPath;
      if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
        plugin._v07LocalFolderCache.clear();
      }
      updatedNote = true;
      if (typeof plugin?.applyQuickUpdateToOpenDashboards === "function") {
        await plugin.applyQuickUpdateToOpenDashboards(item, { downloadPath: targetPath }).catch(() => {});
      }
    } catch (err) {
      noteError = err?.message || String(err);
      console.error("[BangumiDownload] 写回动画笔记本地目录路径失败:", err);
    }
  } else if (needsWritePathToNote && !targetFile) {
    item.downloadPath = targetPath;
    noteError = "本地目录已创建，但未能定位到对应的动画 Markdown 笔记文件，可在设置中执行「兼容升级旧版动画笔记」或重新打开番剧档案馆刷新。";
  }

  return {
    ok: createOnDisk ? createdOnDisk : true,
    targetPath,
    createdOnDisk,
    updatedNote,
    noteError,
    error: noteError && !createdOnDisk ? noteError : ""
  };
}

/**
 * 尝试从多路公共种子缓存镜像（itorrents / btcache / watercache / uploadbt）预下载 .torrent 元数据文件到本地缓存目录，
 * 以彻底解决 Fake-IP TUN 代理环境下纯 magnet 链接在 qBittorrent 中卡在「下载元数据 0.0%」的问题。
 */
async function tryDownloadTorrentFileToCache(target, timeoutMs = 3400) {
  if (!isDesktopNodeAvailable() || !target || typeof target !== "object") return "";
  const hashMatch =
    String(target.infoHash || "").match(/^[a-fA-F0-9]{40}$/) ||
    String(target.magnetUrl || "").match(/btih:([a-fA-F0-9]{40})/i) ||
    String(target.torrentUrl || "").match(/hash=([a-fA-F0-9]{40})/i);
  const infoHash = hashMatch ? (hashMatch[1] || hashMatch[0]).toLowerCase() : "";
  if (!infoHash && !target.torrentUrl) return "";

  const tmpBase = getSafeTmpDir();
  if (!tmpBase) return "";
  const cacheDir = path.join(tmpBase, "bangumi-manager-torrents");
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  } catch (e) {
    return "";
  }

  const outFile = path.join(cacheDir, `${infoHash || Date.now()}.torrent`);
  try {
    if (infoHash && fs.existsSync(outFile)) {
      const st = fs.statSync(outFile);
      if (st.size > 180) {
        const head = fs.readFileSync(outFile);
        if (head[0] === 0x64) return outFile;
      }
    }
  } catch (e) {}

  const upperHash = infoHash.toUpperCase();
  const candidateUrls = [];
  if (upperHash) {
    candidateUrls.push(
      `https://itorrents.org/torrent/${upperHash}.torrent`,
      `https://watercache.nanobytes.org/get/${infoHash}`,
      `http://btcache.me/torrent/${upperHash}`
    );
  }
  if (target.torrentUrl && !isDeadEnclosureRssFeed(target.torrentUrl)) {
    candidateUrls.push(target.torrentUrl);
  }

  const fetchOneBinary = async (url) => {
    if (obsidian && typeof obsidian.requestUrl === "function") {
      const resp = await Promise.race([
        obsidian.requestUrl({
          url,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/x-bittorrent, application/octet-stream, */*"
          }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))
      ]);
      if (resp && resp.status >= 200 && resp.status < 300 && resp.arrayBuffer) {
        const buf = toNodeBufferOrUint8(resp.arrayBuffer);
        if (buf.length > 180 && buf[0] === 0x64) {
          return buf;
        }
      }
    }
    throw new Error("invalid_torrent_response");
  };

  for (const url of candidateUrls) {
    try {
      const buf = await fetchOneBinary(url);
      if (buf && buf.length > 180 && buf[0] === 0x64) {
        fs.writeFileSync(outFile, buf);
        return outFile;
      }
    } catch (e) {
      // try next mirror
    }
  }
  return "";
}

/**
 * 为任意磁力链接补齐高可用 HTTP/HTTPS/UDP 动漫 Tracker 列表
 */
function enrichMagnetUrlWithTrackers(rawMagnet) {
  const s = String(rawMagnet || "").trim();
  if (!s.startsWith("magnet:?")) return s;
  const trackers = getAugmentedAnimeTrackers();
  const lower = s.toLowerCase();
  const missingSuffix = trackers
    .filter((tr) => !lower.includes(encodeURIComponent(tr).toLowerCase()))
    .map((tr) => `&tr=${encodeURIComponent(tr)}`)
    .join("");
  return s + missingSuffix;
}

/**
 * 向 qBittorrent 投递一个或多个下载任务（优先预取 .torrent 种子元数据文件并注入 HTTP/HTTPS Tracker，自动携带 --save-path 指向该番剧的本地文件夹）
 */
async function dispatchDownloadToQbittorrent(plugin, item, episodeTargets, options = {}) {
  const targets = Array.isArray(episodeTargets) ? episodeTargets : [episodeTargets];
  if (targets.length === 0) {
    return { ok: false, reason: "没有可投递的磁力或种子链接" };
  }

  const qbStatus = detectQbittorrentStatus(plugin);
  if (!qbStatus.enabled || !qbStatus.installed || !qbStatus.exePath) {
    return { ok: false, reason: "qb_unavailable", qbStatus };
  }

  const autoCreate = plugin?.settings?.qbittorrentAutoCreateFolder !== false;
  const folderRes = await ensureAnimeLocalDownloadFolder(plugin, item, autoCreate);
  if (autoCreate && !folderRes.ok) {
    return {
      ok: false,
      reason: folderRes.error || "无法创建本地动画保存目录，请检查插件设置中的「本地动画根目录」"
    };
  }
  const { targetPath } = folderRes;
  const winSavePath = targetPath ? path.normalize(targetPath) : "";

  let torrentFileHitCount = 0;
  const resolvedArgs = await Promise.all(
    targets.map(async (t) => {
      if (typeof t === "string") {
        if (isDeadEnclosureRssFeed(t)) return "";
        return t.startsWith("magnet:?") ? enrichMagnetUrlWithTrackers(t) : t;
      }
      const cachedTorrentPath = await tryDownloadTorrentFileToCache(t, 2800).catch(() => "");
      if (cachedTorrentPath && fs.existsSync(cachedTorrentPath)) {
        torrentFileHitCount++;
        return path.normalize(cachedTorrentPath);
      }
      if (t?.magnetUrl) {
        return enrichMagnetUrlWithTrackers(t.magnetUrl);
      }
      return t?.torrentUrl && !isDeadEnclosureRssFeed(t.torrentUrl) ? t.torrentUrl : "";
    })
  );

  const urls = resolvedArgs.filter(Boolean);
  if (urls.length === 0) {
    return { ok: false, reason: "没有可投递的磁力或种子链接" };
  }

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
      message: `已经帮您把《${item?.name || "作品"}》的 ${urls.length} 集下载任务发送给 qBittorrent 了${
        torrentFileHitCount > 0 ? `（已预先拉取 ${torrentFileHitCount} 份种子文件）` : "（已附带加速节点列表）"
      }，保存位置已对准本地番剧目录哦。`
    });

    return {
      ok: true,
      dispatchedCount: urls.length,
      torrentFileHitCount,
      savePath: targetPath,
      wasRunning: qbStatus.running
    };
  } catch (err) {
    return { ok: false, reason: err.message, qbStatus };
  }
}

/**
 * 优雅关闭正在运行的 qBittorrent 进程（用于安全写入 feeds.json / download_rules.json / BT_backup，防止被 qB 退出时的内存快照覆盖）
 */
async function gracefullyStopQbittorrentIfRunning(plugin, maxWaitMs = 3200) {
  const st = detectQbittorrentStatus(plugin);
  if (!st.running) return { wasRunning: false, exePath: st.exePath };
  try {
    execSync('taskkill /IM "qbittorrent.exe"', {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 2000
    });
  } catch (e) {}

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 320));
    const cur = detectQbittorrentStatus(plugin);
    if (!cur.running) {
      return { wasRunning: true, exePath: st.exePath };
    }
  }

  try {
    execSync('taskkill /F /IM "qbittorrent.exe"', {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 2000
    });
    await new Promise((r) => setTimeout(r, 350));
  } catch (e) {}
  return { wasRunning: true, exePath: st.exePath };
}

function ensurePluginRssSubMap(plugin) {
  if (!plugin || !plugin.settings) return {};
  if (!plugin.settings.pluginRssSubscriptions || typeof plugin.settings.pluginRssSubscriptions !== "object") {
    plugin.settings.pluginRssSubscriptions = {};
  }
  return plugin.settings.pluginRssSubscriptions;
}

/**
 * 自愈清洗已存储在 pluginRssSubscriptions 中的污染规则（去除键名尾随换行符、将误存的全站总源升级为对应番剧专属源）
 */
async function healPollutedPluginRssSubscriptions(plugin) {
  if (!plugin?.settings) return false;
  const subMap = ensurePluginRssSubMap(plugin);
  const entries = Object.entries(subMap);
  if (entries.length === 0) return false;

  let bakRulesByCleanName = null;
  const loadBackupRulesMap = () => {
    if (bakRulesByCleanName) return bakRulesByCleanName;
    bakRulesByCleanName = new Map();
    if (!isDesktopNodeAvailable()) return bakRulesByCleanName;
    const appData = getSafeEnv().APPDATA || "";
    if (!appData) return bakRulesByCleanName;
    const rssDir = path.join(appData, "qBittorrent", "rss");
    for (const fn of ["download_rules.pre-v08.bak.json", "download_rules.json"]) {
      const fp = path.join(rssDir, fn);
      try {
        if (!fs.existsSync(fp)) continue;
        const obj = JSON.parse(fs.readFileSync(fp, "utf8")) || {};
        for (const [rKey, rVal] of Object.entries(obj)) {
          const cleanRKey = String(rKey || "").trim();
          if (cleanRKey && rVal && typeof rVal === "object" && !bakRulesByCleanName.has(cleanRKey)) {
            bakRulesByCleanName.set(cleanRKey, rVal);
          }
        }
      } catch (_) {}
    }
    return bakRulesByCleanName;
  };

  let changed = false;
  for (const [rawKey, sub] of entries) {
    if (!sub || typeof sub !== "object") continue;
    const cleanKey = String(rawKey || "").trim();
    const cleanAnimeName = String(sub.animeName || cleanKey).trim();
    if (!cleanKey) {
      delete subMap[rawKey];
      changed = true;
      continue;
    }
    if (cleanKey !== rawKey) {
      delete subMap[rawKey];
      sub.animeName = cleanAnimeName;
      subMap[cleanKey] = sub;
      changed = true;
    } else if (sub.animeName !== cleanAnimeName) {
      sub.animeName = cleanAnimeName;
      changed = true;
    }

    if (sub.rssUrl && isGenericSiteWideRssFeed(sub.rssUrl)) {
      const bakMap = loadBackupRulesMap();
      const bakRule = bakMap.get(cleanAnimeName) || bakMap.get(cleanKey);
      const fallbackKw = [
        String(sub.mustContain || "").includes("*") ? "" : String(sub.mustContain || "").trim(),
        String(sub.keyword || cleanAnimeName).trim()
      ]
        .filter(Boolean)
        .join(" ");
      const upgraded = bakRule
        ? selectSpecificFeedFromAffected(bakRule.affectedFeeds, fallbackKw || cleanAnimeName)
        : buildComicatRssUrl(fallbackKw || cleanAnimeName);
      if (upgraded && !isGenericSiteWideRssFeed(upgraded)) {
        sub.rssUrl = upgraded;
        sub.updatedAt = Date.now();
        changed = true;
      } else {
        sub.enabled = false;
        changed = true;
      }
    }
  }

  if (changed && typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
  return changed;
}

function resolveNoteItemForSubscription(key, sub, items, byName, bySavePath, byNotePath) {
  const rawName = String(sub?.animeName || key || "").trim();
  const normSave = normalizeSubSavePathKey(sub?.savePath);
  if (normSave && bySavePath.has(normSave)) {
    return { matched: true, item: bySavePath.get(normSave) };
  }
  const notePath = String(sub?.notePath || "").trim();
  if (notePath && byNotePath.has(notePath)) {
    return { matched: true, item: byNotePath.get(notePath) };
  }
  if (rawName && byName.has(rawName)) {
    return { matched: true, item: byName.get(rawName) };
  }
  if (rawName.length >= 2) {
    const lowerRaw = rawName.toLowerCase();
    for (const it of items) {
      const itName = String(it?.name || "").trim();
      if (!itName) continue;
      const lowerIt = itName.toLowerCase();
      if (lowerIt.includes(lowerRaw) || lowerRaw.includes(lowerIt)) {
        return { matched: true, item: it };
      }
    }
  }
  return {
    matched: false,
    item: {
      name: rawName,
      downloadPath: sub?.savePath || "",
      watchedEpisodes: 0
    }
  };
}

/**
 * 自动清理并迁移 qBittorrent 中指向漫猫 (comicat.org / uploadbt.com) 死链 enclosure 的原生自动下载规则：
 * - 漫猫 XML 的 <enclosure url="http://v2.uploadbt.com/?r=down&hash=..."> 已失效，qB 原生自动下载器请求时必弹超时报错；
 * - 本函数在保留备份的前提下停用 qB 中所有指向死链源的自动下载规则并清退「自动追番」分组下的死链订阅，
 *   同时将其平滑迁入插件侧磁力追更引擎（提取 infoHash 走镜像缓存与磁力推送），彻底消除右下角超时报错弹窗。
 */
async function sanitizeDeadQbittorrentComicatRules(plugin) {
  await healPollutedPluginRssSubscriptions(plugin).catch(() => {});
  if (!isDesktopNodeAvailable()) return { cleanedRules: 0, cleanedFeeds: 0 };
  const appData = getSafeEnv().APPDATA || "";
  if (!appData) return { cleanedRules: 0, cleanedFeeds: 0 };

  const rssDir = path.join(appData, "qBittorrent", "rss");
  const rulesFilePath = path.join(rssDir, "download_rules.json");
  const feedsFilePath = path.join(rssDir, "feeds.json");
  if (!fs.existsSync(rulesFilePath) && !fs.existsSync(feedsFilePath)) {
    return { cleanedRules: 0, cleanedFeeds: 0 };
  }

  let rulesObj = null;
  let feedsObj = null;
  let dirtyRules = 0;
  let dirtyFeeds = 0;

  try {
    if (fs.existsSync(rulesFilePath)) {
      rulesObj = JSON.parse(fs.readFileSync(rulesFilePath, "utf8")) || {};
      for (const [, ruleVal] of Object.entries(rulesObj)) {
        if (!ruleVal || typeof ruleVal !== "object" || ruleVal.enabled === false) continue;
        const affected = Array.isArray(ruleVal.affectedFeeds) ? ruleVal.affectedFeeds : [];
        if (affected.some((f) => isDeadEnclosureRssFeed(f))) {
          dirtyRules++;
        }
      }
    }
    if (fs.existsSync(feedsFilePath)) {
      feedsObj = JSON.parse(fs.readFileSync(feedsFilePath, "utf8")) || {};
      const autoGroup = feedsObj["自动追番"];
      if (autoGroup && typeof autoGroup === "object" && typeof autoGroup.url !== "string") {
        for (const [, fVal] of Object.entries(autoGroup)) {
          if (fVal && typeof fVal.url === "string" && isDeadEnclosureRssFeed(fVal.url)) {
            dirtyFeeds++;
          }
        }
      }
    }
  } catch (e) {
    return { cleanedRules: 0, cleanedFeeds: 0, error: e.message };
  }

  if (dirtyRules === 0 && dirtyFeeds === 0) {
    const bakPath = path.join(rssDir, "download_rules.pre-v08.bak.json");
    if (plugin?.settings && !plugin.settings._migratedPreV08QbRules && fs.existsSync(bakPath)) {
      try {
        const bakObj = JSON.parse(fs.readFileSync(bakPath, "utf8")) || {};
        const subMap = ensurePluginRssSubMap(plugin);
        let migrated = 0;
        for (const [rawRuleName, ruleVal] of Object.entries(bakObj)) {
          if (!ruleVal || typeof ruleVal !== "object" || ruleVal.enabled === false) continue;
          const cleanRuleName = String(rawRuleName || "").trim();
          if (!cleanRuleName) continue;
          const affected = Array.isArray(ruleVal.affectedFeeds) ? ruleVal.affectedFeeds : [];
          const primaryFeed = selectSpecificFeedFromAffected(affected, cleanRuleName);
          if (primaryFeed && !isGenericSiteWideRssFeed(primaryFeed) && !subMap[cleanRuleName]) {
            const parsedLast = ruleVal.lastMatch ? Date.parse(ruleVal.lastMatch) || 0 : 0;
            subMap[cleanRuleName] = {
              animeName: cleanRuleName,
              rssUrl: primaryFeed,
              keyword: cleanRuleName,
              savePath: String(ruleVal.savePath || ruleVal.torrentParams?.save_path || "").trim(),
              mustContain: String(ruleVal.mustContain || ""),
              mustNotContain: String(ruleVal.mustNotContain || "720p|720P|480p"),
              enabled: true,
              baselineTimeMs: parsedLast > 0 ? parsedLast : Date.now(),
              matchedHashes: [],
              updatedAt: Date.now()
            };
            migrated++;
          }
        }
        plugin.settings._migratedPreV08QbRules = true;
        if (typeof plugin.saveSettings === "function") {
          await plugin.saveSettings().catch(() => {});
        }
        return { cleanedRules: 0, cleanedFeeds: 0, migratedFromBackup: migrated };
      } catch (_) {}
    }
    return { cleanedRules: 0, cleanedFeeds: 0 };
  }

  const stopInfo = await gracefullyStopQbittorrentIfRunning(plugin);
  try {
    // Re-read after qB flush so nothing is lost
    if (fs.existsSync(rulesFilePath)) {
      const raw = fs.readFileSync(rulesFilePath, "utf8");
      const bakPath = path.join(rssDir, "download_rules.pre-v08.bak.json");
      if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, raw, "utf8");
      rulesObj = JSON.parse(raw) || {};
    }
    if (fs.existsSync(feedsFilePath)) {
      const rawF = fs.readFileSync(feedsFilePath, "utf8");
      const bakFPath = path.join(rssDir, "feeds.pre-v08.bak.json");
      if (!fs.existsSync(bakFPath)) fs.writeFileSync(bakFPath, rawF, "utf8");
      feedsObj = JSON.parse(rawF) || {};
    }

    const subMap = ensurePluginRssSubMap(plugin);
    let settingsChanged = false;
    let cleanedRules = 0;
    let cleanedFeeds = 0;

    if (rulesObj) {
      for (const [rawRuleName, ruleVal] of Object.entries(rulesObj)) {
        if (!ruleVal || typeof ruleVal !== "object") continue;
        const cleanRuleName = String(rawRuleName || "").trim();
        const affected = Array.isArray(ruleVal.affectedFeeds) ? ruleVal.affectedFeeds : [];
        if (affected.some((f) => isDeadEnclosureRssFeed(f))) {
          if (ruleVal.enabled !== false) {
            ruleVal.enabled = false;
            cleanedRules++;
            const primaryFeed = selectSpecificFeedFromAffected(affected, cleanRuleName);
            const savePath = String(ruleVal.savePath || ruleVal.torrentParams?.save_path || "").trim();
            if (cleanRuleName && primaryFeed && !isGenericSiteWideRssFeed(primaryFeed) && !subMap[cleanRuleName]) {
              const parsedLast = ruleVal.lastMatch ? Date.parse(ruleVal.lastMatch) || 0 : 0;
              subMap[cleanRuleName] = {
                animeName: cleanRuleName,
                rssUrl: primaryFeed,
                keyword: cleanRuleName,
                savePath,
                mustContain: String(ruleVal.mustContain || ""),
                mustNotContain: String(ruleVal.mustNotContain || "720p|720P|480p"),
                enabled: true,
                baselineTimeMs: parsedLast > 0 ? parsedLast : Date.now(),
                matchedHashes: [],
                updatedAt: Date.now()
              };
              settingsChanged = true;
            }
          }
        }
      }
      if (cleanedRules > 0) {
        fs.writeFileSync(rulesFilePath, JSON.stringify(rulesObj, null, 4), "utf8");
      }
    }

    if (feedsObj && feedsObj["自动追番"] && typeof feedsObj["自动追番"] === "object") {
      for (const [k, v] of Object.entries(feedsObj["自动追番"])) {
        if (v && typeof v.url === "string" && isDeadEnclosureRssFeed(v.url)) {
          delete feedsObj["自动追番"][k];
          cleanedFeeds++;
        }
      }
      if (cleanedFeeds > 0) {
        fs.writeFileSync(feedsFilePath, JSON.stringify(feedsObj, null, 4), "utf8");
      }
    }

    if (settingsChanged && plugin && typeof plugin.saveSettings === "function") {
      await plugin.saveSettings().catch(() => {});
    }
    if (stopInfo.wasRunning && stopInfo.exePath) {
      await launchQbittorrentClient(plugin, { noSplash: true }).catch(() => {});
    }
    return { cleanedRules, cleanedFeeds };
  } catch (err) {
    if (stopInfo.wasRunning) {
      await launchQbittorrentClient(plugin, { noSplash: true }).catch(() => {});
    }
    return { cleanedRules: 0, cleanedFeeds: 0, error: err.message };
  }
}

/**
 * 插件侧磁力 RSS 追更轮询器：拉取绑定的 RSS XML，提取 infoHash 并过滤已看/本地已有/已投递剧集，通过镜像种子或磁力链推送给 qBittorrent。
 */
async function pollPluginRssSubscriptions(plugin, options = {}) {
  if (!isDesktopNodeAvailable() || !plugin?.settings) return { checked: 0, dispatched: 0 };
  if (plugin._isPollingPluginRss) return { checked: 0, dispatched: 0 };
  plugin._isPollingPluginRss = true;

  try {
    await healPollutedPluginRssSubscriptions(plugin).catch(() => {});
    const qbStatus = detectQbittorrentStatus(plugin);
    if (!qbStatus.enabled || !qbStatus.installed) return { checked: 0, dispatched: 0 };

    const subMap = ensurePluginRssSubMap(plugin);
    const items = typeof plugin.collectDashboardItems === "function" ? await plugin.collectDashboardItems().catch(() => []) : [];
    const byName = new Map();
    const bySavePath = new Map();
    const byNotePath = new Map();
    for (const it of items) {
      const cleanItName = String(it?.name || "").trim();
      if (cleanItName) byName.set(cleanItName, it);
      const normItSave = normalizeSubSavePathKey(it?.downloadPath);
      if (normItSave && normItSave !== "无") bySavePath.set(normItSave, it);
      if (it?.file?.path) byNotePath.set(it.file.path, it);

      if (it?.rssUrl && !isGenericSiteWideRssFeed(it.rssUrl) && it.state === "在看" && cleanItName && !subMap[cleanItName]) {
        const alreadyCoveredByPath = normItSave && Array.from(Object.values(subMap)).some(
          (existing) => normalizeSubSavePathKey(existing?.savePath) === normItSave
        );
        if (!alreadyCoveredByPath) {
          subMap[cleanItName] = {
            animeName: cleanItName,
            notePath: it.file?.path || "",
            rssUrl: it.rssUrl,
            keyword: it.downloadSourceKeyword || cleanItName,
            streamId: it.downloadStreamId || "",
            savePath: it.downloadPath && it.downloadPath !== "无" ? it.downloadPath : "",
            mustContain: "",
            mustNotContain: "720p|720P|480p",
            enabled: true,
            baselineTimeMs: Date.now() - 7 * 86400000,
            matchedHashes: [],
            updatedAt: Date.now()
          };
        }
      }
    }

    let checked = 0;
    let dispatched = 0;
    let dirty = false;

    for (const [key, sub] of Object.entries(subMap)) {
      if (!sub || !sub.enabled || !sub.rssUrl) continue;
      // 终极安全闸门：严禁轮询任何未带过滤参数的全站总源
      if (isGenericSiteWideRssFeed(sub.rssUrl)) {
        continue;
      }

      const resolved = resolveNoteItemForSubscription(key, sub, items, byName, bySavePath, byNotePath);
      const noteItem = resolved.item;
      if (resolved.matched && noteItem.state && noteItem.state !== "在看" && !options.forceAll) {
        continue;
      }
      if (resolved.matched && noteItem.file?.path && sub.notePath !== noteItem.file.path) {
        sub.notePath = noteItem.file.path;
        dirty = true;
      }

      checked++;
      let xml = "";
      try {
        xml = await fetchComicatRssXml(sub.rssUrl);
      } catch (_) {
        continue;
      }
      if (!xml) continue;

      const parsed = parseComicatRssXml(xml, noteItem.name);
      const dedup = deduplicateEpisodeItems(parsed.items || []);
      const watchedEp = Number(noteItem.watchedEpisodes) || 0;
      const saveDir = (noteItem.downloadPath && noteItem.downloadPath !== "无" ? noteItem.downloadPath : sub.savePath) || "";
      const localInspect = saveDir ? noteUtils.inspectLocalFolder(saveDir, watchedEp) : null;
      const localEpSet = new Set(
        Array.isArray(localInspect?.videoFiles) ? localInspect.videoFiles.map((v) => Number(v.episode)) : []
      );
      const matchedSet = new Set(Array.isArray(sub.matchedHashes) ? sub.matchedHashes : []);
      const baseline = Number(sub.baselineTimeMs) || 0;
      const mustContainRaw = String(sub.mustContain || "").trim();
      const mustNotRaw = String(sub.mustNotContain || "720p|720P|480p").trim();

      const newTargets = [];
      for (const epItem of dedup.episodes) {
        if (!epItem.infoHash) continue;
        if (matchedSet.has(epItem.infoHash)) continue;
        const itemTitle = String(epItem.title || "");
        if (mustContainRaw && !matchesQbWildcardFilter(itemTitle, mustContainRaw)) continue;
        if (mustNotRaw && matchesQbWildcardFilter(itemTitle, mustNotRaw)) continue;
        const epNum = Number(epItem.episode);
        if (Number.isFinite(epNum) && (epNum <= watchedEp || localEpSet.has(epNum))) {
          matchedSet.add(epItem.infoHash);
          dirty = true;
          continue;
        }
        if (baseline > 0 && epItem.pubTimeMs > 0 && epItem.pubTimeMs <= baseline) {
          matchedSet.add(epItem.infoHash);
          dirty = true;
          continue;
        }
        newTargets.push(epItem);
      }

      if (newTargets.length > 0) {
        const dlRes = await dispatchDownloadToQbittorrent(plugin, noteItem, newTargets);
        if (dlRes && dlRes.ok) {
          dispatched += newTargets.length;
          for (const t of newTargets) matchedSet.add(t.infoHash);
          sub.lastMatchTitle = newTargets[0].title || "";
          dirty = true;
        }
      }
      sub.matchedHashes = Array.from(matchedSet).slice(-400);
      sub.lastCheckedAt = Date.now();
    }

    if (dirty && typeof plugin.saveSettings === "function") {
      await plugin.saveSettings().catch(() => {});
    }
    return { checked, dispatched };
  } finally {
    plugin._isPollingPluginRss = false;
  }
}

/**
 * 将动画的专属 RSS 订阅地址与自动下载规则同步生效：
 * - 若订阅源为漫猫 (comicat.org) 等 enclosure 指向失效死链 (v2.uploadbt.com) 的源，绝不写入 qB 原生自动下载器（防右下角超时报错），
 *   而是交由插件内置磁力追更引擎接管并立即清理旧死链规则；
 * - 若为标准有效 .torrent 源（如蜜柑计划等），则同步写入 qBittorrent。
 */
async function syncRssFeedAndRuleToQbittorrent(
  plugin,
  item,
  { keyword, rssUrl, streamId, missingEpisodes = [] } = {}
) {
  let cleanRss = String(rssUrl || "").trim();
  if (!cleanRss) return { ok: false, reason: "empty_rss" };

  if (!isDesktopNodeAvailable()) return { ok: false, reason: "mobile_env" };
  const appData = getSafeEnv().APPDATA || "";
  if (!appData) return { ok: false, reason: "no_appdata" };

  const { targetPath } = await ensureAnimeLocalDownloadFolder(plugin, item, true);
  const normSavePath = String(targetPath || "").replace(/\\/g, "/");
  const ruleName = String(item?.name || keyword || "未命名番剧").trim();
  if (isGenericSiteWideRssFeed(cleanRss)) {
    const kwFallback = String(keyword || ruleName).trim();
    if (!kwFallback) return { ok: false, reason: "generic_site_wide_rss_blocked" };
    cleanRss = buildComicatRssUrl(kwFallback);
  }
  const feedTitle = `${item?.name || keyword}${streamId ? ` [${streamId}]` : ""}`;

  // 漫猫等死链 enclosure 源：走插件内置磁力追更引擎，并自动停用 qB 中可能残留的死链规则
  if (isDeadEnclosureRssFeed(cleanRss)) {
    await sanitizeDeadQbittorrentComicatRules(plugin).catch(() => {});
    const subMap = ensurePluginRssSubMap(plugin);
    const seedHashes = new Set(Array.isArray(subMap[ruleName]?.matchedHashes) ? subMap[ruleName].matchedHashes : []);
    for (const ep of Array.isArray(missingEpisodes) ? missingEpisodes : []) {
      if (ep?.infoHash) seedHashes.add(String(ep.infoHash).toLowerCase());
    }
    subMap[ruleName] = {
      animeName: ruleName,
      notePath: item?.file?.path || "",
      rssUrl: cleanRss,
      keyword: String(keyword || ruleName),
      streamId: String(streamId || ""),
      savePath: normSavePath,
      mustContain: "",
      mustNotContain: "720p|720P|480p",
      enabled: true,
      baselineTimeMs: Date.now(),
      matchedHashes: Array.from(seedHashes).slice(-400),
      lastCheckedAt: Date.now(),
      updatedAt: Date.now()
    };
    if (plugin && typeof plugin.saveSettings === "function") {
      await plugin.saveSettings().catch(() => {});
    }

    let dispatchedCount = 0;
    if (Array.isArray(missingEpisodes) && missingEpisodes.length > 0) {
      const dlRes = await dispatchDownloadToQbittorrent(plugin, item, missingEpisodes);
      if (dlRes && dlRes.ok) {
        dispatchedCount = dlRes.dispatchedCount || missingEpisodes.length;
      }
    }

    return {
      ok: true,
      pluginManagedMagnetRss: true,
      feedTitle,
      ruleName,
      savePath: normSavePath,
      restartedQb: false,
      dispatchedCount
    };
  }

  const rssDir = path.join(appData, "qBittorrent", "rss");
  try {
    if (!fs.existsSync(rssDir)) {
      fs.mkdirSync(rssDir, { recursive: true });
    }
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  const feedsFilePath = path.join(rssDir, "feeds.json");
  const rulesFilePath = path.join(rssDir, "download_rules.json");

  const stopInfo = await gracefullyStopQbittorrentIfRunning(plugin);

  try {
    let feedsObj = {};
    if (fs.existsSync(feedsFilePath)) {
      try {
        feedsObj = JSON.parse(fs.readFileSync(feedsFilePath, "utf8")) || {};
      } catch (e) {
        feedsObj = {};
      }
    }
    if (!feedsObj["自动追番"] || typeof feedsObj["自动追番"] !== "object" || typeof feedsObj["自动追番"].url === "string") {
      feedsObj["自动追番"] = {};
    }

    const decodeTarget = safeDecodeRssUrl(cleanRss).toLowerCase();
    let existingFeedKey = "";
    let existingUid = "";
    for (const [k, v] of Object.entries(feedsObj["自动追番"])) {
      if (v && typeof v.url === "string" && safeDecodeRssUrl(v.url).toLowerCase() === decodeTarget) {
        existingFeedKey = k;
        existingUid = v.uid || "";
        break;
      }
    }

    const finalFeedTitle = existingFeedKey || feedTitle;
    const uid = existingUid || `{${generateRandomUuid()}}`;

    feedsObj["自动追番"][finalFeedTitle] = {
      uid,
      url: cleanRss
    };
    fs.writeFileSync(feedsFilePath, JSON.stringify(feedsObj, null, 4), "utf8");

    let rulesObj = {};
    if (fs.existsSync(rulesFilePath)) {
      try {
        rulesObj = JSON.parse(fs.readFileSync(rulesFilePath, "utf8")) || {};
      } catch (e) {
        rulesObj = {};
      }
    }

    const prevRule = rulesObj[ruleName] && typeof rulesObj[ruleName] === "object" ? rulesObj[ruleName] : {};
    rulesObj[ruleName] = {
      addPaused: false,
      affectedFeeds: [cleanRss],
      assignedCategory: prevRule.assignedCategory || "",
      enabled: true,
      episodeFilter: prevRule.episodeFilter || "",
      ignoreDays: 0,
      lastMatch: prevRule.lastMatch || "",
      mustContain: "",
      mustNotContain: prevRule.mustNotContain || "720p|720P|480p",
      previouslyMatchedEpisodes: Array.isArray(prevRule.previouslyMatchedEpisodes)
        ? prevRule.previouslyMatchedEpisodes
        : [],
      priority: 0,
      savePath: normSavePath,
      smartFilter: false,
      torrentContentLayout: "Original",
      torrentParams: {
        category: "",
        download_limit: -1,
        download_path: "",
        operating_mode: "AutoManaged",
        ratio_limit: -2,
        save_path: normSavePath,
        seeding_time_limit: -2,
        skip_checking: false,
        stopped: false,
        tags: [],
        upload_limit: -1,
        use_auto_tmm: false,
        use_download_path: false
      },
      useRegex: false
    };
    fs.writeFileSync(rulesFilePath, JSON.stringify(rulesObj, null, 4), "utf8");

    const iniPath = path.join(appData, "qBittorrent", "qBittorrent.ini");
    if (fs.existsSync(iniPath)) {
      try {
        let iniText = fs.readFileSync(iniPath, "utf8");
        if (!/AutoDownloader\\EnableProcessing=true/i.test(iniText)) {
          if (/AutoDownloader\\EnableProcessing=false/i.test(iniText)) {
            iniText = iniText.replace(/AutoDownloader\\EnableProcessing=false/gi, "AutoDownloader\\EnableProcessing=true");
          } else if (iniText.includes("[RSS]")) {
            iniText = iniText.replace("[RSS]", "[RSS]\nAutoDownloader\\EnableProcessing=true\nSession\\EnableProcessing=true");
          } else {
            iniText += "\n[RSS]\nAutoDownloader\\EnableProcessing=true\nSession\\EnableProcessing=true\n";
          }
          fs.writeFileSync(iniPath, iniText, "utf8");
        }
      } catch (e) {}
    }

    let dispatchedCount = 0;
    if (Array.isArray(missingEpisodes) && missingEpisodes.length > 0) {
      const dlRes = await dispatchDownloadToQbittorrent(plugin, item, missingEpisodes);
      if (dlRes && dlRes.ok) {
        dispatchedCount = dlRes.dispatchedCount || missingEpisodes.length;
      }
    } else if (stopInfo.wasRunning && stopInfo.exePath) {
      await launchQbittorrentClient(plugin);
    }

    return {
      ok: true,
      feedTitle: finalFeedTitle,
      ruleName,
      savePath: normSavePath,
      restartedQb: stopInfo.wasRunning,
      dispatchedCount
    };
  } catch (err) {
    if (stopInfo.wasRunning) {
      await launchQbittorrentClient(plugin).catch(() => {});
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * 将用户选定的「下载源关键词」与「专属 RSS 订阅地址」绑定写入动画 Markdown 笔记的 YAML Frontmatter，
 * 并同步写入本机 qBittorrent 的 RSS 阅读器与 RSS 下载器。
 */
async function bindAnimeDownloadSourceToNote(
  plugin,
  item,
  { keyword, rssUrl, streamId, missingEpisodes = [], syncQb = true } = {}
) {
  const targetFile =
    item?.file ||
    (item?.path && plugin?.app?.vault
      ? plugin.app.vault.getAbstractFileByPath(item.path)
      : null);
  if (!item || !targetFile) return false;
  let content = await plugin.app.vault.read(targetFile);
  if (typeof noteUtils.inspectAndUpgradeAnimeNoteContent === "function") {
    const upg = noteUtils.inspectAndUpgradeAnimeNoteContent(content, {
      ...(typeof plugin?.getScoreDisplayOptions === "function"
        ? plugin.getScoreDisplayOptions()
        : {}),
      cachedPersonalScore: plugin?.settings?.personalRatingCache?.[targetFile.path] || ""
    });
    if (upg.isTargetAnimeNote && upg.needsUpgrade) {
      content = upg.upgradedContent;
    }
  }
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
  if (typeof plugin?.modifyNoteSafely === "function") {
    await plugin.modifyNoteSafely(targetFile, content);
  } else {
    await plugin.app.vault.modify(targetFile, content);
  }
  item.file = targetFile;

  let qbSyncResult = null;
  if (syncQb && rssUrl) {
    qbSyncResult = await syncRssFeedAndRuleToQbittorrent(plugin, item, {
      keyword,
      rssUrl,
      streamId,
      missingEpisodes
    });
  }

  roxyMascotService.emitRoxyEvent(plugin, {
    type: "download:bind_rss",
    state: "success",
    category: "下载源绑定",
    priority: roxyMascotService.PRIORITY.HIGH,
    dedupeKey: `bind_rss:${item.name}:${keyword}`,
    message: qbSyncResult?.ok
      ? `已经为《${item.name}》锁定了「${streamId || keyword}」专属源并开启自动追更${
          qbSyncResult.dispatchedCount > 0 ? `，同时开始为您下载缺失的 ${qbSyncResult.dispatchedCount} 集` : ""
        }哦！`
      : `已经为《${item.name}》锁定了「${streamId || keyword}」专属单集源并记入笔记，之后随时可以一键核对补齐新集哦。`
  });
  return qbSyncResult || { ok: true };
}

/**
 * 在插件内删除指定单集的本地视频文件，并同步清理 qBittorrent (BT_backup) 中的对应传输任务与种子缓存；
 * 支持「看一集删一集」自动推进已看集数水位线（绝不在本地文件夹生成任何空白占位假文件）。
 */
async function deleteLocalEpisodeAndSyncQb(plugin, item, { episodeNumber, filePath, infoHash, markWatched = false } = {}) {
  const deletedFiles = [];
  const epNum = Number(episodeNumber);

  // 1. 查找并删除本地视频文件及同集外挂字幕/未完成缓存文件
  const rawFolder = String(item?.downloadPath || "").trim();
  const targetFiles = [];
  if (filePath && fs.existsSync(filePath)) {
    targetFiles.push(filePath);
  } else if (rawFolder && rawFolder !== "无" && fs.existsSync(rawFolder) && Number.isFinite(epNum)) {
    const inspectRes = noteUtils.inspectLocalFolder(rawFolder, item?.watchedEpisodes);
    for (const vf of inspectRes?.videoFiles || []) {
      if (Number(vf.episode) === epNum && vf.path && fs.existsSync(vf.path)) {
        targetFiles.push(vf.path);
      }
    }
  }

  for (const fp of targetFiles) {
    try {
      const dir = path.dirname(fp);
      const baseNoExt = path.basename(fp, path.extname(fp));
      const entries = fs.readdirSync(dir);
      for (const name of entries) {
        if (name === path.basename(fp) || name === `${path.basename(fp)}.!qB` || name.startsWith(baseNoExt + ".")) {
          const full = path.join(dir, name);
          try {
            fs.unlinkSync(full);
            deletedFiles.push(name);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // 2. 扫描本机 qBittorrent BT_backup 目录，查找匹配该集 infoHash 或文件名的传输任务并同步移除
  let removedQbTorrents = 0;
  const localAppData = getSafeEnv().LOCALAPPDATA || "";
  const btBackupDir = localAppData ? path.join(localAppData, "qBittorrent", "BT_backup") : "";
  if (btBackupDir && fs.existsSync(btBackupDir)) {
    try {
      const backupFiles = fs.readdirSync(btBackupDir);
      const hashesToRemove = new Set();
      const cleanHash = String(infoHash || "").trim().toLowerCase();
      if (cleanHash && /^[a-f0-9]{40}$/.test(cleanHash)) {
        hashesToRemove.add(cleanHash);
      }

      // 通过匹配已删除的文件名或「作品名 + 集数」在 .torrent / .fastresume 中定位任务 Hash
      const baseNames = targetFiles.map((fp) => path.basename(fp, path.extname(fp)).replace(/\.\!qB$/i, ""));
      for (const bf of backupFiles) {
        if (!bf.endsWith(".torrent") && !bf.endsWith(".fastresume")) continue;
        const hash = path.basename(bf, path.extname(bf)).toLowerCase();
        if (hashesToRemove.has(hash)) continue;
        try {
          const buf = fs.readFileSync(path.join(btBackupDir, bf));
          const text = buf.toString("utf8");
          if (baseNames.some((bn) => bn.length >= 4 && text.includes(bn))) {
            hashesToRemove.add(hash);
          }
        } catch (e) {}
      }

      if (hashesToRemove.size > 0) {
        const stopInfo = await gracefullyStopQbittorrentIfRunning(plugin);
        for (const h of hashesToRemove) {
          for (const ext of [".torrent", ".fastresume"]) {
            const p = path.join(btBackupDir, `${h}${ext}`);
            if (fs.existsSync(p)) {
              try {
                fs.unlinkSync(p);
                if (ext === ".fastresume") removedQbTorrents++;
              } catch (e) {}
            }
          }
        }
        if (stopInfo.wasRunning) {
          await launchQbittorrentClient(plugin);
        }
      }
    } catch (e) {}
  }

  // 3. 若用户勾选或属于「看完即删」（epNum > item.watchedEpisodes），同步推进笔记中的已看集数水位线并刷新「本地更新状态」
  if (item?.file) {
    const curWatched = Number(item.watchedEpisodes) || 0;
    if (markWatched && Number.isFinite(epNum) && epNum > curWatched) {
      await plugin.quickUpdateAnimeNote(item, { watchedEpisodes: epNum });
    } else {
      await plugin.checkOneLocalStatus(item.file);
    }
  }

  return {
    ok: true,
    deletedFiles,
    removedQbTorrents
  };
}

/**
 * 扫描常见网盘/浏览器默认下载目录（夸克 QuarkDownload、百度网盘、迅雷、系统 Downloads 等），
 * 将属于该番剧的视频文件一键归集移动到当前番剧的专属本地文件夹。
 */
async function collectEpisodesFromCloudDriveFolders(plugin, item) {
  const { targetPath } = await ensureAnimeLocalDownloadFolder(plugin, item, true);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: false, movedFiles: [], reason: "本地番剧目录不可用" };
  }

  const tokens = extractAnimeMatchTokens(item, item?.downloadSourceKeyword || "");
  if (tokens.length === 0) {
    return { ok: false, movedFiles: [], reason: "无法提取该番剧的匹配关键词" };
  }

  const homeDir = getSafeHomeDir();
  const candidateDirs = new Set();
  if (plugin?.settings?.customCloudDriveDownloadDir) {
    candidateDirs.add(String(plugin.settings.customCloudDriveDownloadDir).trim());
  }
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    candidateDirs.add(`${drive}/QuarkDownload`);
    candidateDirs.add(`${drive}/夸克网盘下载`);
    candidateDirs.add(`${drive}/BaiduNetdiskDownload`);
    candidateDirs.add(`${drive}/迅雷下载`);
    candidateDirs.add(`${drive}/Downloads`);
  }
  if (homeDir) {
    candidateDirs.add(path.join(homeDir, "Downloads"));
    candidateDirs.add(path.join(homeDir, "QuarkDownload"));
  }

  const videoExts = new Set([".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".ts"]);
  const movedFiles = [];
  const normTarget = path.resolve(targetPath).toLowerCase();

  const matchesAnime = (fileName) => {
    const lower = String(fileName || "").toLowerCase();
    return tokens.some((t) => t.length >= 2 && lower.includes(t.toLowerCase()));
  };

  for (const dir of candidateDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    if (path.resolve(dir).toLowerCase() === normTarget) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (videoExts.has(ext) && matchesAnime(entry.name)) {
            const srcFile = path.join(dir, entry.name);
            const destFile = path.join(targetPath, entry.name);
            if (!fs.existsSync(destFile)) {
              try {
                fs.renameSync(srcFile, destFile);
              } catch (_) {
                fs.copyFileSync(srcFile, destFile);
                fs.unlinkSync(srcFile);
              }
              movedFiles.push(entry.name);
            }
          }
        } else if (entry.isDirectory() && matchesAnime(entry.name)) {
          const subDir = path.join(dir, entry.name);
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isFile()) continue;
            const ext = path.extname(sub.name).toLowerCase();
            if (videoExts.has(ext)) {
              const srcFile = path.join(subDir, sub.name);
              const destFile = path.join(targetPath, sub.name);
              if (!fs.existsSync(destFile)) {
                try {
                  fs.renameSync(srcFile, destFile);
                } catch (_) {
                  fs.copyFileSync(srcFile, destFile);
                  fs.unlinkSync(srcFile);
                }
                movedFiles.push(sub.name);
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  if (movedFiles.length > 0 && item?.file) {
    await plugin.checkOneLocalStatus(item.file);
  }

  return {
    ok: true,
    movedFiles,
    targetPath
  };
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

  const appData = getSafeEnv().APPDATA || "";
  const localAppData = getSafeEnv().LOCALAPPDATA || "";
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

  const subMap = ensurePluginRssSubMap(plugin);
  for (const [subKey, subVal] of Object.entries(subMap)) {
    if (!subVal || typeof subVal !== "object" || !subVal.rssUrl) continue;
    const decodedSubRss = safeDecodeRssUrl(subVal.rssUrl);
    const isSame = normCurrentRss && decodedSubRss.toLowerCase() === normCurrentRss;
    if (isSame || textMatchesTokens(subKey) || textMatchesTokens(subVal.animeName) || textMatchesTokens(decodedSubRss)) {
      matchedRules.push({
        ruleName: `${subVal.animeName || subKey}（插件磁力追更）`,
        enabled: subVal.enabled !== false,
        affectedFeeds: [subVal.rssUrl],
        decodedFeeds: [decodedSubRss],
        mustContain: String(subVal.mustContain || ""),
        mustNotContain: String(subVal.mustNotContain || ""),
        episodeFilter: "",
        savePath: String(subVal.savePath || ""),
        lastMatch: subVal.lastCheckedAt ? new Date(subVal.lastCheckedAt).toLocaleString() : "",
        matchReason: "插件内置磁力追更已接管（绕开失效种子站）"
      });
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
        text: `RSS 订阅与自动下载查重确认 · 《${item?.name || "未命名"}》`
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
            ? `检测到已存在 ${report.matchedRules.length} 条相关下载规则（其中 ${enabledCount} 条正处于「已启用」状态）及 ${report.matchedFeeds.length} 条 RSS 订阅源`
            : `检测到已存在相关记录（下载规则 ${report.matchedRules.length} 条 · RSS 订阅源 ${report.matchedFeeds.length} 条 · 笔记绑定 ${report.noteBoundRss ? "1 项" : "0 项"}）`
        });
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-sub",
          text: "若继续添加 RSS 订阅或重复投递下载，可能会导致 RSS 订阅重复或同一集被重复下载。请先核对下方检测结果："
        });
      } else {
        statusBanner.createDiv({
          cls: "curator-rss-check-banner-title",
          text: "检测结果：未发现已存在的同名或相关 RSS 订阅与自动下载规则"
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
            text: r.enabled ? "已启用" : "已停用"
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
            text: `${f.folderPath}`
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
        text: `当前操作：「${actionTitle}」${
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
      this.broadKeyword = String(item?.name || "").trim();
      this.broadStreams = [];
      this.broadHitLimit = false;
      this.broadSnapshot = null;
      this.activeStreamId = "";
      this._userManuallyPickedStream = false;
      this.autoPromotedStreamLabel = "";
      this.currentEpisodes = [];
      this.currentPacks = [];
      this.currentDedupInfo = null;
      this.streamsExpanded = false;
      this.isLoading = false;
      this.errorMessage = "";
      this.lastFolderError = "";
      this.showCustomFolderInput = false;
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
        text: "番剧下载与单集 RSS 助手"
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
          text: `已绑定源：${this.item.downloadSourceKeyword || "专属 RSS"}`
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
          cls: "curator-dl-btn is-primary"
        });
        v07Core.setBtnIconLabel(searchBtn, "search", "检索漫猫发布源", 14);
        searchBtn.onclick = () => {
          this.performSearch(this.keywordInput.value.trim(), { preserveStreams: false });
        };

        const openWebBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn"
        });
        v07Core.setBtnIconLabel(openWebBtn, "external", "漫猫网页搜索", 14);
        openWebBtn.title = "在浏览器中打开 www.comicat.org 搜索结果页";
        openWebBtn.onclick = () => {
          const kw = this.keywordInput.value.trim() || this.item?.name || "";
          window.open(buildComicatSearchUrl(kw, this.baseUrl));
        };

        const copyRssBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn"
        });
        v07Core.setBtnIconLabel(copyRssBtn, "copy", "复制当前 RSS", 14);
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
        cls: "curator-dl-btn is-subtle"
      });
      v07Core.setBtnIconLabel(customWebBtn, "external", "备用站搜索", 14);
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
          ? `本地目录已就绪（现存 ${localInspect?.fileCount || 0} 集 · 未看新集 ${localInspect?.newCount || 0} 集）`
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
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(createDirBtn, "folder", "自动生成并创建本地目录", 13);
        createDirBtn.onclick = async () => {
          createDirBtn.disabled = true;
          createDirBtn.textContent = "正在创建本地目录...";
          const res = await ensureAnimeLocalDownloadFolder(this.plugin, this.item, true);
          createDirBtn.disabled = false;
          if (res.ok && res.createdOnDisk) {
            this.lastFolderError = "";
            this.showCustomFolderInput = false;
            if (NoticeClass) {
              new NoticeClass(
                `已创建并绑定本地番剧目录：\n${res.targetPath}${
                  res.noteError ? `\n（提示：${res.noteError}）` : ""
                }`,
                4800
              );
            }
          } else {
            this.lastFolderError =
              res.error ||
              res.noteError ||
              "无法创建本地文件夹，请检查本地动画根目录路径是否存在及磁盘写入权限。";
            if (NoticeClass) {
              new NoticeClass(`本地目录创建未成功：\n${this.lastFolderError}`, 6500);
            }
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
        };

        const customDirToggleBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: this.showCustomFolderInput ? "收起路径输入" : "手动指定目录"
        });
        customDirToggleBtn.onclick = () => {
          this.showCustomFolderInput = !this.showCustomFolderInput;
          this.renderEnvStatus();
        };
      } else {
        const openDirBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn"
        });
        v07Core.setBtnIconLabel(openDirBtn, "folder", "打开本地文件夹", 13);
        openDirBtn.onclick = async () => {
          await noteUtils.openLocalPathSafely(rawPath);
        };

        const rescanBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn"
        });
        v07Core.setBtnIconLabel(rescanBtn, "refresh", "刷新本地状态", 13);
        rescanBtn.onclick = async () => {
          if (this.item?.file) {
            await this.plugin.checkOneLocalStatus(this.item.file);
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
          if (NoticeClass) new NoticeClass("已重新扫描本地视频文件夹并同步状态。");
        };

        const collectCloudBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(collectCloudBtn, "cloud", "从夸克/网盘目录归集", 13);
        collectCloudBtn.title =
          "自动扫描夸克网盘 (QuarkDownload)、百度网盘、迅雷及系统下载目录，将属于该番剧的视频一键移入本番文件夹";
        collectCloudBtn.onclick = async () => {
          collectCloudBtn.disabled = true;
          const res = await collectEpisodesFromCloudDriveFolders(this.plugin, this.item);
          collectCloudBtn.disabled = false;
          if (res.movedFiles && res.movedFiles.length > 0) {
            if (NoticeClass) {
              new NoticeClass(
                `已从网盘/默认下载目录自动归集 ${res.movedFiles.length} 个视频文件至本番目录！`,
                4500
              );
            }
          } else if (NoticeClass) {
            new NoticeClass(
              "未在常见网盘下载目录（QuarkDownload / Downloads 等）中发现待归集的同名番剧视频。"
            );
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
        };

        const changeDirBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn is-subtle",
          text: this.showCustomFolderInput ? "收起路径修改" : "更换目录"
        });
        changeDirBtn.onclick = () => {
          this.showCustomFolderInput = !this.showCustomFolderInput;
          this.renderEnvStatus();
        };
      }

      if (this.lastFolderError) {
        const errBox = folderCol.createDiv("curator-dl-folder-error-box");
        errBox.createDiv({
          cls: "curator-dl-folder-error-text",
          text: this.lastFolderError
        });
        const errActs = errBox.createDiv("curator-dl-folder-error-actions");
        if (!this.showCustomFolderInput) {
          const manualBtn = errActs.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: "手动输入本番目录"
          });
          manualBtn.onclick = () => {
            this.showCustomFolderInput = true;
            this.renderEnvStatus();
          };
        }
        const openSettingsBtn = errActs.createEl("button", {
          cls: "curator-dl-mini-btn"
        });
        v07Core.setBtnIconLabel(openSettingsBtn, "settings", "前往设置检查「本地动画根目录」", 13);
        openSettingsBtn.onclick = () => {
          this.close();
          if (this.plugin?.app?.setting) {
            this.plugin.app.setting.open();
            if (typeof this.plugin.app.setting.openTabById === "function") {
              this.plugin.app.setting.openTabById("bangumi-manager");
            }
          }
        };
      }

      if (this.showCustomFolderInput) {
        const customRow = folderCol.createDiv("curator-dl-custom-folder-row");
        const cleanRoot = String(this.plugin?.settings?.localAnimeRoot || "").trim().replace(/[\\/]+$/, "");
        const defaultSuggested =
          hasPath && rawPath !== "无"
            ? rawPath
            : cleanRoot
              ? `${cleanRoot}/${
                  this.item?.year || new Date().getFullYear()
                }/${this.item?.season || "10月新番"}/${noteManager.getSafeFileName(
                  this.item?.name || "未命名动画"
                )}`
              : "";
        const dirInput = customRow.createEl("input", {
          type: "text",
          cls: "curator-dl-keyword-input curator-mono",
          placeholder: "输入本机保存文件夹路径（如 D:/Anime/败犬女主太多了）..."
        });
        dirInput.value = defaultSuggested;
        const saveCustomDirBtn = customRow.createEl("button", {
          cls: "curator-dl-mini-btn is-primary",
          text: "保存并创建"
        });
        saveCustomDirBtn.onclick = async () => {
          const val = dirInput.value.trim();
          if (!val) return;
          saveCustomDirBtn.disabled = true;
          const res = await ensureAnimeLocalDownloadFolder(this.plugin, this.item, true, val);
          saveCustomDirBtn.disabled = false;
          if (res.ok && res.createdOnDisk) {
            this.lastFolderError = "";
            this.showCustomFolderInput = false;
            if (NoticeClass) {
              new NoticeClass(`已绑定并创建目录：\n${res.targetPath}`, 4500);
            }
          } else {
            this.lastFolderError = res.error || res.noteError || "指定目录无法创建";
            if (NoticeClass) {
              new NoticeClass(`目录创建未成功：\n${this.lastFolderError}`, 6000);
            }
          }
          this.renderEnvStatus();
          this.renderResultsMount();
          if (typeof this.onUpdated === "function") this.onUpdated();
        };
      }

      // 展示本地已存在的单集列表，支持在插件内直接删除本地单集并同步删除 qBittorrent 对应任务
      if (folderExists && Array.isArray(localInspect?.videoFiles) && localInspect.videoFiles.length > 0) {
        const localEpStrip = folderCol.createDiv("curator-dl-local-ep-strip");
        localEpStrip.style.cssText =
          "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--background-modifier-border);";
        for (const vf of localInspect.videoFiles) {
          const epNum = Number(vf.episode);
          const watchedNow = Number(this.item?.watchedEpisodes) || 0;
          const isWatched = Number.isFinite(epNum) && epNum <= watchedNow;
          const pill = localEpStrip.createDiv("curator-dl-local-ep-chip");
          pill.style.cssText =
            "display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;font-size:12px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);";
          pill.createSpan({
            text: `第${String(epNum).padStart(2, "0")}话${isWatched ? "(已看)" : ""}`
          });
          const delBtn = pill.createEl("button", {
            cls: "curator-dl-mini-btn is-subtle"
          });
          delBtn.appendChild(v07Core.icon("trash", 13));
          delBtn.style.cssText = "padding:0 4px;min-height:20px;font-size:12px;display:inline-flex;align-items:center;";
          delBtn.title = `删除本地《${vf.name}》并同步移除 qBittorrent 中的对应下载任务（支持看一集删一集，不回退已看进度）`;
          delBtn.onclick = async () => {
            delBtn.disabled = true;
            const res = await deleteLocalEpisodeAndSyncQb(this.plugin, this.item, {
              episodeNumber: epNum,
              filePath: vf.path,
              markWatched: !isWatched
            });
            if (NoticeClass) {
              new NoticeClass(
                `已删除本地第 ${epNum} 话文件${
                  res.removedQbTorrents > 0 ? `，并同步从 qBittorrent 清理了 ${res.removedQbTorrents} 项任务` : ""
                }${!isWatched ? `（已自动记录已看至第 ${epNum} 话）` : ""}！`
              );
            }
            this.renderShell();
            this.renderResultsMount();
            if (typeof this.onUpdated === "function") this.onUpdated();
          };
        }
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
          text: "点击下方剧集的「磁力」或「种子」可使用您习惯的任意工具自行下载。"
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
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(startQbBtn, "play", "立即打开 qBittorrent", 13);
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
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(dlQbBtn, "external", "前往官网下载 qBittorrent", 13);
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
            ? `已检出 ${enabledCount} 条启用中的下载规则`
            : "已检出关联订阅记录"
        });
        headRow.createSpan({
          cls: "curator-rss-inline-title",
          text: `本机 RSS 订阅与下载规则检测结果（规则 ${report.matchedRules.length} 条：启用 ${enabledCount} / 停用 ${disabledCount} · 订阅源 ${report.matchedFeeds.length} 条）`
        });

        const detailList = leftCol.createDiv("curator-rss-inline-details");
        for (const r of report.matchedRules.slice(0, 3)) {
          const tag = detailList.createDiv("curator-rss-inline-rule-line");
          tag.createSpan({
            cls: `curator-rss-rule-state-pill ${r.enabled ? "is-enabled" : "is-disabled"}`,
            text: r.enabled ? "已启用" : "已停用"
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
              text: f.folderPath
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
          text: "未检出已有规则"
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
        cls: "curator-dl-mini-btn is-accent"
      });
      v07Core.setBtnIconLabel(inspectBtn, "search", "查看查重报告与复制 RSS", 13);
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

      if (opts.isInitial) {
        this._userManuallyPickedStream = false;
        this.autoPromotedStreamLabel = "";
      } else if (opts.preserveStreams) {
        this._userManuallyPickedStream = true;
        this.autoPromotedStreamLabel = "";
      } else {
        this._userManuallyPickedStream = false;
        this.autoPromotedStreamLabel = "";
        this.activeStreamId = "";
      }

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
        const dedup = deduplicateEpisodeItems(parsed.items);

        this.currentDedupInfo = dedup;
        this.currentEpisodes = dedup.episodes;
        this.currentPacks = dedup.packs;

        if (!opts.preserveStreams || this.broadStreams.length === 0) {
          this.broadStreams = parsed.streams;
          this.broadHitLimit = parsed.items.length >= 45;
          this.broadSnapshot = {
            keyword: cleanKw,
            dedup,
            episodes: dedup.episodes,
            packs: dedup.packs
          };
          if (opts.isInitial && parsed.streams.length > 0 && !this.item?.downloadSourceKeyword) {
            this.activeStreamId = "";
          }
          // 若本次已经是精确流搜索（仅返回单一发布源），则标记为精确已核验
          if (this.broadStreams.length === 1) {
            this.broadStreams[0].exactCountVerified = true;
            this.broadStreams[0].episodeCount = dedup.episodes.length;
            this.broadStreams[0].packCount = dedup.packs.length;
            this.broadStreams[0].minEp = dedup.minEp;
            this.broadStreams[0].maxEp = dedup.maxEp;
          } else if (this.broadHitLimit) {
            // 宽泛搜索受到漫猫单页 50 条上限截断，导致前几话被挤出本页且各发布源卡片集数不全
            // 启动非阻塞探测：回填真实集数，并在宽泛结果缺失未看前序集数时自动为您聚焦首个全集发布源
            this.probeTopStreamsExactCount(this.broadStreams.slice(0, 8));
          }
        } else {
          // 用户点击了某个候选发布源卡片（opts.preserveStreams === true）：
          // 立即将该发布源实际检索到的真实去重集数同步回填到上方发布源卡片
          for (const st of this.broadStreams) {
            if (
              st.streamId === this.activeStreamId ||
              st.recommendedKeyword === cleanKw
            ) {
              st.episodeCount = dedup.episodes.length;
              st.packCount = dedup.packs.length;
              st.minEp = dedup.minEp;
              st.maxEp = dedup.maxEp;
              st.totalRawCount = parsed.items.length;
              st.probedDedup = dedup;
              st.exactCountVerified = true;
            }
          }
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

    async probeTopStreamsExactCount(streamsToProbe) {
      if (!Array.isArray(streamsToProbe) || streamsToProbe.length === 0) return;
      const probeToken = (this._probeToken = (this._probeToken || 0) + 1);
      const watchedNow = Number(this.item?.watchedEpisodes) || 0;

      for (const st of streamsToProbe) {
        if (!this.modalEl || !this.modalEl.isConnected || this._probeToken !== probeToken) return;
        if (st.exactCountVerified || !st.recommendedKeyword) continue;
        try {
          const url = buildComicatRssUrl(st.recommendedKeyword, this.baseUrl);
          const xml = await fetchComicatRssXml(url, 6500);
          let parsed = parseComicatRssXml(xml, this.item?.name || "", this.baseUrl);
          let dedup = deduplicateEpisodeItems(parsed.items);

          // 若带简日/繁日等特征词导致合流字幕组前几话命名略异而漏集，尝试回退仅含「[字幕组] 番名」的宽容词
          if (
            (dedup.episodes.length === 0 || (dedup.minEp !== null && dedup.minEp > 1)) &&
            st.fallbackKeyword &&
            st.fallbackKeyword !== st.recommendedKeyword
          ) {
            try {
              const fbUrl = buildComicatRssUrl(st.fallbackKeyword, this.baseUrl);
              const fbXml = await fetchComicatRssXml(fbUrl, 5500);
              const fbParsed = parseComicatRssXml(fbXml, this.item?.name || "", this.baseUrl);
              const fbDedup = deduplicateEpisodeItems(fbParsed.items);
              const improvedCount = fbDedup.episodes.length > dedup.episodes.length;
              const improvedStart =
                dedup.minEp === null || (fbDedup.minEp !== null && fbDedup.minEp <= dedup.minEp);
              if (improvedCount && improvedStart && fbParsed.streams.length <= 3) {
                st.recommendedKeyword = st.fallbackKeyword;
                parsed = fbParsed;
                dedup = fbDedup;
              }
            } catch (_) {}
          }

          st.episodeCount = dedup.episodes.length;
          st.packCount = dedup.packs.length;
          st.minEp = dedup.minEp;
          st.maxEp = dedup.maxEp;
          st.totalRawCount = parsed.items.length;
          st.probedDedup = dedup;
          st.exactCountVerified = true;

          // 若初始宽泛 RSS 因 50 条上限把用户尚未观看的前几话挤出了列表（如已看 0 话却只剩第 05–12 话），
          // 且用户尚未手动点选其他流，则自动切换至首个包含起始未看集数的完整字幕组流！
          const curMinEp = this.currentDedupInfo?.minEp ?? null;
          if (
            !this._userManuallyPickedStream &&
            !this.autoPromotedStreamLabel &&
            !this.item?.downloadSourceKeyword &&
            this.broadHitLimit &&
            curMinEp !== null &&
            curMinEp > watchedNow + 1 &&
            dedup.minEp !== null &&
            dedup.minEp <= watchedNow + 1 &&
            dedup.episodes.length > this.currentEpisodes.length
          ) {
            this.activeStreamId = st.streamId;
            this.currentKeyword = st.recommendedKeyword;
            if (this.keywordInput) {
              this.keywordInput.value = st.recommendedKeyword;
            }
            this.currentDedupInfo = dedup;
            this.currentEpisodes = dedup.episodes;
            this.currentPacks = dedup.packs;
            this.autoPromotedStreamLabel = st.group || st.streamId;
            this.renderRssRuleCheckBanner();
          }

          if (!this.isLoading && this.modalEl && this.modalEl.isConnected) {
            this.renderResultsMount();
          }
        } catch (e) {}
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

        const streamHeaderBtns = streamHeaderTop.createDiv("curator-dl-stream-head-btns");
        if (this.activeStreamId && this.broadSnapshot) {
          const resetBroadBtn = streamHeaderBtns.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: "切回宽泛混流结果"
          });
          resetBroadBtn.title = "返回按动画原名检索的最新 50 条多字幕组混排列表";
          resetBroadBtn.onclick = () => {
            this._userManuallyPickedStream = true;
            this.autoPromotedStreamLabel = "";
            this.activeStreamId = "";
            this.currentKeyword = this.broadSnapshot.keyword;
            if (this.keywordInput) this.keywordInput.value = this.broadSnapshot.keyword;
            this.currentDedupInfo = this.broadSnapshot.dedup;
            this.currentEpisodes = this.broadSnapshot.episodes;
            this.currentPacks = this.broadSnapshot.packs;
            this.renderRssRuleCheckBanner();
            this.renderResultsMount();
          };
        }

        if (hasMoreStreams) {
          const toggleExpandBtn = streamHeaderBtns.createEl("button", {
            cls: "curator-dl-mini-btn is-accent curator-dl-streams-toggle-btn",
            text: isExpandedAll
              ? `收起发布源（仅显示前 ${defaultLimit} 组）`
              : `展开全部 ${totalStreamCount} 组发布源（还有 ${totalStreamCount - defaultLimit} 组）`
          });
          toggleExpandBtn.onclick = () => {
            this.streamsExpanded = !this.streamsExpanded;
            this.renderResultsMount();
          };
        }

        streamHeader.createDiv({
          cls: "curator-dl-section-hint",
          text: this.autoPromotedStreamLabel
            ? `因宽泛 RSS 单页 50 条上限挤出了早期集数，已自动为您聚焦集数完整的「${this.autoPromotedStreamLabel}」发布源（您仍可自由点选其他字幕组）`
            : "点击任一发布源即可自动切换为该字幕组专属搜索词（确保每集仅下载 1 份）"
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
          const plusSign = !st.exactCountVerified && this.broadHitLimit ? "+" : "";
          const epRangeSuffix =
            st.exactCountVerified &&
            st.episodeCount > 0 &&
            Number.isFinite(st.minEp) &&
            Number.isFinite(st.maxEp)
              ? ` (${String(st.minEp).padStart(2, "0")}-${String(st.maxEp).padStart(2, "0")})`
              : "";
          topRow.createSpan({
            cls: "curator-dl-stream-epcount curator-mono",
            text:
              st.episodeCount > 0
                ? `已检出 ${st.episodeCount}${plusSign} 集${epRangeSuffix}`
                : st.packCount > 0
                ? `合集 ${st.packCount} 条`
                : `${st.totalRawCount}${plusSign} 条`
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
            this._userManuallyPickedStream = true;
            this.autoPromotedStreamLabel = "";
            this.activeStreamId = st.streamId;
            if (st.exactCountVerified && st.probedDedup) {
              this.currentKeyword = st.recommendedKeyword;
              if (this.keywordInput) this.keywordInput.value = st.recommendedKeyword;
              this.currentDedupInfo = st.probedDedup;
              this.currentEpisodes = st.probedDedup.episodes;
              this.currentPacks = st.probedDedup.packs;
              this.renderRssRuleCheckBanner();
              this.renderResultsMount();
            } else {
              this.performSearch(st.recommendedKeyword, { preserveStreams: true });
            }
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
      const fallbackBroadPacks =
        this.currentPacks.length === 0 && Array.isArray(this.broadSnapshot?.packs)
          ? this.broadSnapshot.packs
          : [];
      const effectivePacks =
        this.currentPacks.length > 0 ? this.currentPacks : fallbackBroadPacks;
      const isShowingBroadPacksFallback =
        this.currentPacks.length === 0 && fallbackBroadPacks.length > 0;

      if (this.currentEpisodes.length === 0 && effectivePacks.length === 0) {
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

      // 3. 单集唯一性核验横幅 + 前序集数截断诊断提醒 + 一键批量操作栏
      const localEpSet = this.getLocalExistingEpisodeSet();
      const watchedEp = Number(this.item?.watchedEpisodes) || 0;
      const allNotInFolder = this.currentEpisodes.filter(
        (epItem) => !localEpSet.has(Number(epItem.episode))
      );
      const unwatchedMissing = allNotInFolder.filter(
        (epItem) => Number(epItem.episode) > watchedEp
      );
      const watchedNotInFolderCount = allNotInFolder.length - unwatchedMissing.length;
      const missingEpisodes = this.includeWatchedInBatch ? allNotInFolder : unwatchedMissing;

      const dupCount = this.currentDedupInfo?.duplicateReplacedCount || 0;
      const curMinEp = this.currentDedupInfo?.minEp ?? null;
      const curMaxEp = this.currentDedupInfo?.maxEp ?? null;
      const rangeText =
        curMinEp !== null && curMaxEp !== null
          ? `第 ${String(curMinEp).padStart(2, "0")}–${String(curMaxEp).padStart(2, "0")} 话`
          : "";

      // 若当前列表起始话数大于「已看话数 + 1」（例如外显已看 0 话、内显仅第 05–12 话），主动解释原因并提供一键切换完整源按钮
      if (this.currentEpisodes.length > 0 && curMinEp !== null && curMinEp > watchedEp + 1) {
        const missingStart = watchedEp + 1;
        const missingEnd = curMinEp - 1;
        const missingRangeLabel =
          missingStart === missingEnd
            ? `第 ${String(missingStart).padStart(2, "0")} 话`
            : `第 ${String(missingStart).padStart(2, "0")}–${String(missingEnd).padStart(2, "0")} 话`;

        const bestCompleteStream = this.broadStreams.find(
          (st) =>
            st.exactCountVerified &&
            st.minEp !== null &&
            st.minEp <= watchedEp + 1 &&
            st.episodeCount > this.currentEpisodes.length
        );

        const gapWarn = this.resultsMount.createDiv("curator-dl-gap-warn-banner");
        gapWarn.createDiv({
          cls: "curator-dl-gap-warn-text",
          text:
            !this.activeStreamId && this.broadHitLimit
              ? `前序集数截断提示：漫猫宽泛搜索单次仅返回最新 50 条记录，多字幕组混排时较早发布的 ${missingRangeLabel} 已被挤出本页（您当前已看 ${watchedEp} 话，本页仅剩 ${rangeText}）。请点选上方具体字幕组加载完整集数。`
              : `当前发布源未检出 ${missingRangeLabel}（仅含 ${rangeText}，您当前已看 ${watchedEp} 话）：该字幕组可能仅发布了后半部分剧集或采用合集打包，建议切换其他完整发布源或查看下方季度合集包。`
        });
        if (bestCompleteStream) {
          const switchCompleteBtn = gapWarn.createEl("button", {
            cls: "curator-dl-mini-btn is-primary",
            text: `切换至完整源「${bestCompleteStream.group}」（共 ${bestCompleteStream.episodeCount} 集）`
          });
          switchCompleteBtn.onclick = () => {
            this._userManuallyPickedStream = true;
            this.autoPromotedStreamLabel = "";
            this.activeStreamId = bestCompleteStream.streamId;
            if (bestCompleteStream.probedDedup) {
              this.currentKeyword = bestCompleteStream.recommendedKeyword;
              if (this.keywordInput) this.keywordInput.value = bestCompleteStream.recommendedKeyword;
              this.currentDedupInfo = bestCompleteStream.probedDedup;
              this.currentEpisodes = bestCompleteStream.probedDedup.episodes;
              this.currentPacks = bestCompleteStream.probedDedup.packs;
              this.renderRssRuleCheckBanner();
              this.renderResultsMount();
            } else {
              this.performSearch(bestCompleteStream.recommendedKeyword, { preserveStreams: true });
            }
          };
        }
      }

      const actionBanner = this.resultsMount.createDiv("curator-dl-verify-banner");
      const verifyLeft = actionBanner.createDiv("curator-dl-verify-info");

      verifyLeft.createDiv({
        cls: "curator-dl-verify-title",
        text:
          this.currentEpisodes.length === 0
            ? `当前检索到 ${effectivePacks.length} 条季度全集 / 合集包资源（当前搜索词下无拆分单集条目）`
            : dupCount === 0
            ? `每集唯一性核验通过：共 ${this.currentEpisodes.length} 集（${rangeText}），每集严格 1 条资源`
            : `已自动去重 ${dupCount} 条重复/v1旧版条目：当前锁定 ${this.currentEpisodes.length} 集（${rangeText}），确保每集仅下载 1 份`
      });

      const currentRssUrl = buildComicatRssUrl(this.currentKeyword, this.baseUrl);
      verifyLeft.createDiv({
        cls: "curator-dl-verify-rss curator-mono",
        text: `专属 RSS：${currentRssUrl}`
      });

      const verifyActions = actionBanner.createDiv("curator-dl-verify-actions");
      const qbStatus = detectQbittorrentStatus(this.plugin);

      if (watchedNotInFolderCount > 0) {
        const toggleWatchedMissingBtn = verifyActions.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: this.includeWatchedInBatch
            ? `已含前 ${watchedNotInFolderCount} 集已看补档 (点击仅下未看新集)`
            : `已跳过 ${watchedNotInFolderCount} 集已看集数 (点击纳入补档)`
        });
        toggleWatchedMissingBtn.title =
          "完美支持「看一集删一集」或「前几集在其他平台看过」：默认仅把大于已看话数的新集视为待下载";
        toggleWatchedMissingBtn.onclick = () => {
          this.includeWatchedInBatch = !this.includeWatchedInBatch;
          this.renderResultsMount();
        };
      }

      if (missingEpisodes.length > 0 && qbStatus.enabled && qbStatus.installed) {
        const batchDlBtn = verifyActions.createEl("button", {
          cls: "curator-dl-btn is-primary"
        });
        v07Core.setBtnIconLabel(batchDlBtn, "download", `一键下载未看缺失的 ${missingEpisodes.length} 集 (qBittorrent)`, 14);
        batchDlBtn.dataset.dlAction = "batch-qb-download";
        batchDlBtn.onclick = () => {
          this.confirmRssRuleBeforeAction(
            {
              actionTitle: `一键投递缺失的 ${missingEpisodes.length} 集至 qBittorrent`,
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
        cls: "curator-dl-btn is-accent"
      });
      v07Core.setBtnIconLabel(bindSourceBtn, "rss", "绑定为默认下载源并开启追更", 14);
      bindSourceBtn.dataset.dlAction = "bind-rss-source";
      bindSourceBtn.title =
        "将该精准搜索词与专属 RSS 写入动画笔记并启用自动磁力追更（绕开失效种子站），同时立即下载当前未看缺失集数";
      bindSourceBtn.onclick = () => {
        this.confirmRssRuleBeforeAction(
          {
            actionTitle: "绑定默认下载源并开启自动追更",
            targetKeyword: this.currentKeyword,
            targetRss: currentRssUrl
          },
          async () => {
            bindSourceBtn.disabled = true;
            const syncRes = await bindAnimeDownloadSourceToNote(this.plugin, this.item, {
              keyword: this.currentKeyword,
              rssUrl: currentRssUrl,
              streamId: this.activeStreamId || this.currentKeyword,
              missingEpisodes: unwatchedMissing,
              syncQb: true
            });
            bindSourceBtn.disabled = false;
            if (NoticeClass) {
              new NoticeClass(
                syncRes?.ok
                  ? `已绑定「${this.currentKeyword}」并开启自动追更${
                      syncRes.dispatchedCount > 0 ? `（已同时投递 ${syncRes.dispatchedCount} 集未看新集）` : ""
                    }！`
                  : `已将「${this.currentKeyword}」绑定至《${this.item.name}》笔记！`,
                5500
              );
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
        const isAlreadyWatched = Number.isFinite(epNum) && epNum <= watchedEp;

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
          cls: `curator-dl-ep-local-tag ${
            isLocalDownloaded ? "is-ok" : isAlreadyWatched ? "is-ok" : "is-new"
          }`,
          text: isLocalDownloaded
            ? "本地已有"
            : isAlreadyWatched
            ? "已看(已清理/云端)"
            : "待下载"
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
        if (isLocalDownloaded) {
          const delEpBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-subtle"
          });
          v07Core.setBtnIconLabel(delEpBtn, "trash", "删源(同步qB)", 13);
          delEpBtn.title =
            "在插件内删除本集本地视频文件，并同步移除 qBittorrent 中的对应下载任务（支持看一集删一集）";
          delEpBtn.onclick = async () => {
            delEpBtn.disabled = true;
            const res = await deleteLocalEpisodeAndSyncQb(this.plugin, this.item, {
              episodeNumber: epNum,
              infoHash: epItem.infoHash,
              markWatched: !isAlreadyWatched
            });
            if (NoticeClass) {
              new NoticeClass(
                `已删除第 ${epNum} 话本地文件${
                  res.removedQbTorrents > 0 ? `并清理 qBittorrent 任务` : ""
                }！`
              );
            }
            this.renderShell();
            this.renderResultsMount();
            if (typeof this.onUpdated === "function") this.onUpdated();
          };
        }

        if (qbStatus.enabled && qbStatus.installed) {
          const qbBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-primary"
          });
          v07Core.setBtnIconLabel(qbBtn, "download", "qB下载", 13);
          qbBtn.title = "预取种子元数据并调用本机 qBittorrent 下载本集到番剧文件夹";
          qbBtn.onclick = () => {
            this.confirmRssRuleBeforeAction(
              {
                actionTitle: `使用 qBittorrent 下载第 ${String(epNum).padStart(2, "0")} 话`,
                targetKeyword: this.currentKeyword,
                targetRss: currentRssUrl
              },
              async () => {
                qbBtn.disabled = true;
                const res = await dispatchDownloadToQbittorrent(this.plugin, this.item, [epItem]);
                qbBtn.disabled = false;
                if (res.ok && NoticeClass) {
                  new NoticeClass(
                    `已投递《${this.item.name}》第 ${epNum} 话至 qBittorrent${
                      res.torrentFileHitCount > 0 ? "（已预取 .torrent 元数据）" : ""
                    }`
                  );
                } else if (!res.ok && NoticeClass) {
                  new NoticeClass(`发送失败：${res.reason || "未知原因"}`, 5500);
                }
                this.renderEnvStatus();
              }
            );
          };
        }

        if (epItem.magnetUrl) {
          const magBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn"
          });
          v07Core.setBtnIconLabel(magBtn, "magnet", "磁力/网盘", 13);
          magBtn.title =
            "唤起磁力链接（如夸克网盘/迅雷），并自动将本番剧本地文件夹路径复制到剪贴板，在网盘「下载到」直接按 Ctrl+V 即可关联路径！";
          magBtn.onclick = () => {
            this.confirmRssRuleBeforeAction(
              {
                actionTitle: `唤起第 ${String(epNum).padStart(2, "0")} 话磁力/网盘下载（自动复制本番保存目录供 Ctrl+V 粘贴）`,
                targetKeyword: this.currentKeyword,
                targetRss: currentRssUrl
              },
              async () => {
                const folderRes = await ensureAnimeLocalDownloadFolder(
                  this.plugin,
                  this.item,
                  true
                );
                const winFolder =
                  folderRes.ok && folderRes.targetPath ? path.normalize(folderRes.targetPath) : "";
                if (navigator.clipboard) {
                  await navigator.clipboard
                    .writeText(winFolder || epItem.magnetUrl)
                    .catch(() => {});
                }
                window.open(enrichMagnetUrlWithTrackers(epItem.magnetUrl));
                if (NoticeClass) {
                  new NoticeClass(
                    winFolder
                      ? `已拉起磁力/夸克下载！\n已自动将本番保存路径复制到剪贴板：\n${winFolder}\n（在网盘弹窗的「下载到」直接 Ctrl+V 粘贴即可，或下载后点上方「从夸克/网盘目录归集」）`
                      : `已唤起磁力链接（第 ${epNum} 话）${
                          folderRes.error ? `\n本地目录未自动创建：${folderRes.error}` : ""
                        }`,
                    6500
                  );
                }
              }
            );
          };
        }

        if (epItem.torrentUrl) {
          const torBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn"
          });
          v07Core.setBtnIconLabel(torBtn, "file", "种子", 13);
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
            cls: "curator-dl-mini-btn is-subtle"
          });
          pageBtn.appendChild(v07Core.icon("external", 13));
          pageBtn.title = "打开漫猫该集发布详情页";
          pageBtn.onclick = () => {
            window.open(epItem.link);
          };
        }
      }

      // 5. 季度全集 / 合集包资源（避免完结番补番时合集包被静默丢弃）
      if (effectivePacks.length > 0) {
        const packsSection = this.resultsMount.createDiv("curator-dl-packs-section");
        const packsHead = packsSection.createDiv("curator-dl-section-head");
        packsHead.createDiv({
          cls: "curator-dl-section-title",
          text: isShowingBroadPacksFallback
            ? `季度全集 / 合集包资源（来自全站搜索 · 共 ${effectivePacks.length} 条，适合完结一次补齐）`
            : `季度全集 / 合集包资源（共 ${effectivePacks.length} 条，适合一次下载全季）`
        });
        const packsList = packsSection.createDiv("curator-dl-packs-list");
        for (const packItem of effectivePacks) {
          const prow = packsList.createDiv("curator-dl-ep-row is-pack-row");
          const badgeCol = prow.createDiv("curator-dl-ep-badge-col");
          badgeCol.createSpan({
            cls: "curator-dl-pack-pill curator-mono",
            text: "全集/合集"
          });

          const infoCol = prow.createDiv("curator-dl-ep-info-col");
          infoCol.createDiv({
            cls: "curator-dl-ep-title",
            text: packItem.title
          });
          const subMeta = [
            packItem.group ? `发布组：${packItem.group}` : "",
            packItem.pubDate ? `发布时间：${packItem.pubDate}` : ""
          ]
            .filter(Boolean)
            .join(" · ");
          if (subMeta) {
            infoCol.createDiv({
              cls: "curator-dl-ep-sub",
              text: subMeta
            });
          }

          const actCol = prow.createDiv("curator-dl-ep-actions-col");
          if (qbStatus.enabled && qbStatus.installed) {
            const qbPackBtn = actCol.createEl("button", {
              cls: "curator-dl-mini-btn is-primary"
            });
            v07Core.setBtnIconLabel(qbPackBtn, "download", "qB下载合集", 13);
            qbPackBtn.onclick = () => {
              this.confirmRssRuleBeforeAction(
                {
                  actionTitle: "使用 qBittorrent 下载季度合集包",
                  targetKeyword: this.currentKeyword,
                  targetRss: currentRssUrl
                },
                async () => {
                  qbPackBtn.disabled = true;
                  const res = await dispatchDownloadToQbittorrent(this.plugin, this.item, [packItem]);
                  qbPackBtn.disabled = false;
                  if (res.ok && NoticeClass) {
                    new NoticeClass(
                      `已投递《${this.item.name}》季度合集包至 qBittorrent！\n保存目录：${res.savePath}`,
                      5000
                    );
                  } else if (!res.ok && NoticeClass) {
                    new NoticeClass(`发送失败：${res.reason || "未知原因"}`, 5500);
                  }
                  this.renderEnvStatus();
                }
              );
            };
          }

          if (packItem.magnetUrl) {
            const magPackBtn = actCol.createEl("button", {
              cls: "curator-dl-mini-btn"
            });
            v07Core.setBtnIconLabel(magPackBtn, "magnet", "磁力/网盘", 13);
            magPackBtn.onclick = () => {
              this.confirmRssRuleBeforeAction(
                {
                  actionTitle: "唤起季度合集包磁力/网盘下载",
                  targetKeyword: this.currentKeyword,
                  targetRss: currentRssUrl
                },
                async () => {
                  const folderRes = await ensureAnimeLocalDownloadFolder(
                    this.plugin,
                    this.item,
                    true
                  );
                  const winFolder =
                    folderRes.ok && folderRes.targetPath ? path.normalize(folderRes.targetPath) : "";
                  if (navigator.clipboard) {
                    await navigator.clipboard
                      .writeText(winFolder || packItem.magnetUrl)
                      .catch(() => {});
                  }
                  window.open(enrichMagnetUrlWithTrackers(packItem.magnetUrl));
                  if (NoticeClass) {
                    new NoticeClass(
                      winFolder
                        ? `已拉起合集磁力下载！\n已将本番保存目录复制到剪贴板：\n${winFolder}`
                        : "已唤起季度合集包磁力链接",
                      5500
                    );
                  }
                }
              );
            };
          }

          if (packItem.torrentUrl) {
            const torPackBtn = actCol.createEl("button", {
              cls: "curator-dl-mini-btn"
            });
            v07Core.setBtnIconLabel(torPackBtn, "file", "种子", 13);
            torPackBtn.onclick = () => {
              window.open(packItem.torrentUrl);
            };
          }

          if (packItem.link) {
            const pagePackBtn = actCol.createEl("button", {
              cls: "curator-dl-mini-btn is-subtle"
            });
            pagePackBtn.appendChild(v07Core.icon("external", 13));
            pagePackBtn.title = "打开漫猫该合集详情页";
            pagePackBtn.onclick = () => {
              window.open(packItem.link);
            };
          }
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
  isDeadEnclosureRssFeed,
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
  sanitizeDeadQbittorrentComicatRules,
  pollPluginRssSubscriptions,
  syncRssFeedAndRuleToQbittorrent,
  bindAnimeDownloadSourceToNote,
  deleteLocalEpisodeAndSyncQb,
  collectEpisodesFromCloudDriveFolders,
  detectExistingRssAndDownloadRules,
  openRssDuplicateConfirmModal,
  openAnimeDownloadModal
};
