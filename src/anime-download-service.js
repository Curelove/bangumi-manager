const obsidian = require("obsidian");
const noteUtils = require("./note-utils.js");
const noteManager = require("./note-manager.js");
const roxyMascotService = require("./roxy-mascot-service.js");
const v07Core = require("./v07-core.js");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv,
  normalizeUnicodeNfc,
  pickNativeFolderOnDesktop,
  crossPlatformPath: path,
  crossPlatformFs: fs,
  toNodeBufferOrUint8
} = require("./platform-env.js");

function isMobileDownloadEnv() {
  return isMobileEnv() || !isDesktopNodeAvailable();
}

function buildCompactMobileMagnet(epItem) {
  const raw = String(epItem?.magnetUrl || "").trim();
  const infoHash = String(epItem?.infoHash || "").trim().toLowerCase();
  if (!infoHash) return raw;
  const dn = epItem?.title ? `&dn=${encodeURIComponent(String(epItem.title))}` : "";
  const topTrackers = PUBLIC_ANIME_TRACKERS.slice(0, 4)
    .map((tr) => `&tr=${encodeURIComponent(tr)}`)
    .join("");
  return `magnet:?xt=urn:btih:${infoHash}${dn}${topTrackers}`;
}

async function copyTextCrossPlatform(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

function launchMagnetCrossPlatform(magnetUrl) {
  const clean = String(magnetUrl || "").trim();
  if (!clean) return;
  try {
    const a = document.createElement("a");
    a.href = clean;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        a.remove();
      } catch (_) {}
    }, 300);
  } catch (_) {
    try {
      window.open(clean);
    } catch (_) {}
  }
}

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
const KISSSUB_MIRROR_BASE_URL = "https://www.kisssub.org";
const MIKAN_BASE_URL = "https://mikanani.me";
const DMHY_RSS_SEARCH_URL = "https://share.dmhy.org/topics/rss/rss.xml";

const _mioBtHostCooldownUntil = new Map();
const _mioBtVisitorCookies = new Map();
const _bgmSubjectAliasesMemCache = new Map();
const _federatedSearchResultCache = new Map();
const FEDERATED_CACHE_TTL_MS = 20 * 60 * 1000;
const FEDERATED_CACHE_MAX_ENTRIES = 28;

function normalizeComicatBaseUrl(plugin) {
  const raw = String(plugin?.settings?.comicatBaseUrl || DEFAULT_COMICAT_BASE_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_COMICAT_BASE_URL;
}

function buildComicatSearchUrl(keyword, baseUrl = DEFAULT_COMICAT_BASE_URL, page = 1) {
  const cleanKw = String(keyword || "").trim();
  const base = String(baseUrl || DEFAULT_COMICAT_BASE_URL).replace(/\/+$/, "");
  const pageSuffix = Number(page) > 1 ? `&page=${Math.floor(Number(page))}` : "";
  return `${base}/search.php?keyword=${encodeURIComponent(cleanKw)}${pageSuffix}`;
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
 * 将 40 位十六进制或 32 位 RFC-4648 Base32（如动漫花园 magnet 链接）统一归一化为小写 40 位十六进制 infoHash
 */
function normalizeBtihToHex(rawHash) {
  const clean = String(rawHash || "").trim();
  if (/^[a-fA-F0-9]{40}$/.test(clean)) return clean.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(clean)) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (let i = 0; i < clean.length; i++) {
      const val = alphabet.indexOf(clean[i].toUpperCase());
      if (val < 0) return "";
      bits += val.toString(2).padStart(5, "0");
    }
    let hex = "";
    for (let i = 0; i + 4 <= 160; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex.length === 40 ? hex.toLowerCase() : "";
  }
  return "";
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (_) {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch (_) {
        return _;
      }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTagsClean(html) {
  return decodeXmlEntities(String(html || "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFileSizeToBytes(rawSize) {
  const s = String(rawSize || "").trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const m = s.match(/(\d+(?:\.\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB|KB|KiB|B)\b/i);
  if (!m) return 0;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return 0;
  const unit = m[2].toUpperCase();
  if (unit.startsWith("T")) return Math.round(val * 1024 * 1024 * 1024 * 1024);
  if (unit.startsWith("G")) return Math.round(val * 1024 * 1024 * 1024);
  if (unit.startsWith("M")) return Math.round(val * 1024 * 1024);
  if (unit.startsWith("K")) return Math.round(val * 1024);
  return Math.round(val);
}

function formatReadableFileSize(rawSize, sizeBytes = 0) {
  const clean = String(rawSize || "").trim();
  if (clean && /\b(TB|GB|MB|KB)\b/i.test(clean)) {
    return clean.replace(/\s+/g, "");
  }
  const bytes = sizeBytes || parseFileSizeToBytes(clean);
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 * 1024 ? 1 : 2)}GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))}MB`;
}

/**
 * 通过 Node HTTP/HTTPS（支持本地代理与直连双通道及自定义请求头）获取文本与状态码
 */
function fetchResponseViaNode(targetUrl, timeoutMs = 9000, extraHeaders = {}, method = "GET", reqBody = "") {
  const http = tryRequireNode("http");
  const https = tryRequireNode("https");
  if (!http || !https) {
    if (typeof fetch === "function") {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      return fetch(targetUrl, {
        method,
        headers: extraHeaders,
        body: reqBody || undefined,
        signal: controller ? controller.signal : undefined
      })
        .then(async (r) => ({
          status: r.status,
          headers: {},
          text: await r.text()
        }))
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    }
    return Promise.reject(new Error("当前环境不支持 Node HTTP 回退"));
  }
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const proxy = detectWindowsSystemProxy();
    const mergedHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      ...extraHeaders
    };
    if (reqBody) {
      mergedHeaders["Content-Length"] = Buffer.byteLength(reqBody);
    }

    const doDirect = (hopCount = 0) => {
      const client = parsedUrl.protocol === "https:" ? https : http;
      const req = client.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
          method,
          path: parsedUrl.pathname + parsedUrl.search,
          headers: mergedHeaders,
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hopCount < 4 && method === "GET") {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            fetchResponseViaNode(nextUrl, timeoutMs, extraHeaders, "GET", "")
              .then(resolve, reject);
            return;
          }
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers || {},
              text: Buffer.concat(chunks).toString("utf8")
            });
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("请求超时"));
      });
      if (reqBody) req.write(reqBody);
      req.end();
    };

    if (proxy && parsedUrl.protocol === "http:") {
      const req = http.request(
        {
          host: proxy.host,
          port: proxy.port,
          method,
          path: targetUrl,
          headers: {
            ...mergedHeaders,
            Host: parsedUrl.host
          },
          timeout: timeoutMs
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && method === "GET") {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            fetchResponseViaNode(nextUrl, timeoutMs, extraHeaders, "GET", "")
              .then(resolve, reject);
            return;
          }
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode >= 200 && res.statusCode < 500) {
              resolve({ status: res.statusCode, headers: res.headers || {}, text });
            } else {
              doDirect();
            }
          });
        }
      );
      req.on("error", () => doDirect());
      req.on("timeout", () => {
        req.destroy();
        doDirect();
      });
      if (reqBody) req.write(reqBody);
      req.end();
    } else {
      doDirect();
    }
  });
}

function fetchTextViaNode(targetUrl, timeoutMs = 9000, extraHeaders = {}) {
  return fetchResponseViaNode(targetUrl, timeoutMs, extraHeaders, "GET", "").then((res) => {
    if (res.status >= 200 && res.status < 300) return res.text;
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  });
}

/**
 * 跨平台统一 HTTP 请求封装（桌面端与 Android/iOS 移动端均优先走 obsidian.requestUrl，自动清理超时定时器）
 */
async function requestTextCrossPlatform(targetUrl, { method = "GET", headers = {}, body = "", timeoutMs = 7500 } = {}) {
  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    ...headers
  };

  if (obsidian && typeof obsidian.requestUrl === "function") {
    let timer = null;
    try {
      const reqOpts = {
        url: targetUrl,
        method,
        headers: reqHeaders,
        throw: false
      };
      if (body) {
        reqOpts.body = body;
        if (reqHeaders["Content-Type"]) {
          reqOpts.contentType = reqHeaders["Content-Type"];
        }
      }
      const p = obsidian.requestUrl(reqOpts);
      p.catch(() => {});
      const resp = await Promise.race([
        p,
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error("requestUrl timeout")), timeoutMs);
        })
      ]);
      if (resp && typeof resp.status === "number") {
        return {
          status: resp.status,
          headers: resp.headers || {},
          text: String(resp.text || "")
        };
      }
    } catch (err) {
      if (!isDesktopNodeAvailable()) {
        throw err;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (isDesktopNodeAvailable()) {
    return fetchResponseViaNode(targetUrl, timeoutMs, reqHeaders, method, body);
  }
  throw new Error("网络请求不可用");
}

/**
 * 获取 RSS XML 内容（优先使用 Obsidian requestUrl，失败或遇限流时自动切换 https/http 与同库镜像）
 */
async function fetchComicatRssXml(url, timeoutMs = 8500) {
  const rawUrl = String(url || "").trim();
  const candidates = [];
  const pushUnique = (u) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  if (rawUrl.startsWith("http://")) {
    pushUnique(rawUrl.replace(/^http:\/\//i, "https://"));
    pushUnique(rawUrl);
  } else if (rawUrl.startsWith("https://")) {
    pushUnique(rawUrl);
    pushUnique(rawUrl.replace(/^https:\/\//i, "http://"));
  } else if (rawUrl) {
    pushUnique(rawUrl);
  }

  // 若漫猫主站处于 429 冷却或不可达，自动追加同库镜像 kisssub.org 及 DMHY RSS 兜底
  const comicatRssMatch = rawUrl.match(/^https?:\/\/(?:www\.)?comicat\.org\/rss-([^/?#]+)\.xml/i);
  if (comicatRssMatch && comicatRssMatch[1]) {
    const encodedKw = comicatRssMatch[1];
    pushUnique(`${KISSSUB_MIRROR_BASE_URL}/rss-${encodedKw}.xml`);
    try {
      const decodedKw = decodeURIComponent(encodedKw.replace(/\+/g, "%20")).trim();
      if (decodedKw) {
        pushUnique(`${DMHY_RSS_SEARCH_URL}?keyword=${encodeURIComponent(decodedKw)}`);
      }
    } catch (_) {}
  }

  let lastError = null;
  for (const candidateUrl of candidates) {
    try {
      let host = "";
      try {
        host = new URL(candidateUrl).hostname.toLowerCase();
      } catch (_) {}
      const cooldownUntil = host ? _mioBtHostCooldownUntil.get(host) || 0 : 0;
      if (cooldownUntil > Date.now() && candidates.length > 1) {
        continue;
      }

      const resp = await requestTextCrossPlatform(candidateUrl, {
        timeoutMs,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml, */*"
        }
      });
      if (resp.status === 429 && host) {
        _mioBtHostCooldownUntil.set(host, Date.now() + 8 * 60 * 1000);
        lastError = new Error("HTTP 429");
        continue;
      }
      if (resp.status >= 200 && resp.status < 300 && resp.text && resp.text.includes("<rss")) {
        return resp.text;
      }
      lastError = new Error(`HTTP ${resp.status || 0}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("无法连接至漫猫 (comicat.org)，请检查网络连接或代理状态。");
}

const NON_SUBGROUP_BRACKET_TAG_RE =
  /^(?:1080[pP]?|720[pP]?|2160[pP]?|480[pP]?|1080[pP]@60fps|2160p48F|4K|8K|MP4|MKV|AVI|FLAC|MP3|WAV|AAC|EAC|APE|TTA|320K|Hi-?Res|OST|OP|ED|BD|BDRip|BDMV|BDBOX|BD-BOX|DVD|DVDRip|WebRip|WEB-DL|WEB|TVRip|HDTVrip|HDRip|Raw|OVA|OAD|SP|Fin|END|Complete|合集|全集|季度全集|完结|整理搬运|搬运|生肉|外挂字幕|内封字幕|简繁内封|简日双语|繁日双语|简体|繁体|繁體|简中|繁中|CHS|CHT|GB|BIG5|\d{1,2}月新番|新番|\d{4}[.\-/]?\d{2}[.\-/]?\d{2}|\d{6}|暴力超分.*|超分.*)$/i;

const SUBGROUP_TRAD_TO_SIMP_RULES = [
  [/愛戀/g, "爱恋"],
  [/漫貓/g, "漫猫"],
  [/字幕組/g, "字幕组"],
  [/字幕社/g, "字幕社"],
  [/漢化組/g, "汉化组"],
  [/制作組/g, "制作组"],
  [/製作組/g, "制作组"],
  [/搬運組/g, "搬运组"],
  [/壓制組/g, "压制组"],
  [/動漫國/g, "动漫国"],
  [/極影/g, "极影"],
  [/諸神/g, "诸神"],
  [/幻櫻/g, "幻樱"],
  [/澄空學園/g, "澄空学园"],
  [/華盟/g, "华盟"],
  [/風之聖殿/g, "风之圣殿"],
  [/雪飄/g, "雪飘"],
  [/綠茶/g, "绿茶"],
  [/織夢/g, "织梦"],
  [/霜庭雲花/g, "霜庭云花"],
  [/晚街與燈/g, "晚街与灯"],
  [/貓戀/g, "猫恋"],
  [/天月搬運/g, "天月搬运"],
  [/櫻桃花/g, "樱桃花"],
  [/輕之國度/g, "轻之国度"],
  [/動漫/g, "动漫"],
  [/＆/g, "&"],
  [/\s*&\s*/g, "&"],
  [/^AnimRep$/i, "AnimeRep"]
];

function normalizeSubgroupName(rawName) {
  let g = String(rawName || "").trim();
  if (!g) return "其他发布源";
  for (const [re, rep] of SUBGROUP_TRAD_TO_SIMP_RULES) {
    g = g.replace(re, rep);
  }
  if (/^MingY(?:Sub|明)?$/i.test(g)) return "MingY";
  return g;
}

/**
 * 兼容 `[字幕组]`、`【字幕组】`、`〖字幕组〗`、`★07月新番★[字幕组]` 及无括号 UP 主列（如 Kotoriii），
 * 自动跳过前置分辨率/音频/日期伪标签（如 `[Hi-Res][260202]`）
 */
function extractSubgroupInfo(rawTitle, author = "") {
  let rest = String(rawTitle || "").trim();
  rest = rest.replace(/^[★☆✦✧][^★☆✦✧]{1,18}[★☆✦✧]\s*/, "");

  let rawBracketGroup = "";
  for (let i = 0; i < 3; i++) {
    const m = rest.match(/^\s*(?:\[([^\]]+)\]|【([^】]+)】|〖([^〗]+)〗|〔([^〕]+)〕)/);
    if (!m) break;
    const inner = String(m[1] || m[2] || m[3] || m[4] || "").trim();
    rest = rest.slice(m[0].length).replace(/^[★☆✦✧][^★☆✦✧]{1,18}[★☆✦✧]\s*/, "").trim();
    if (!inner) continue;
    if (NON_SUBGROUP_BRACKET_TAG_RE.test(inner)) continue;
    rawBracketGroup = inner;
    break;
  }

  const cleanAuthor = String(author || "").trim();
  if (rawBracketGroup) {
    return {
      group: normalizeSubgroupName(rawBracketGroup),
      rawGroupInTitle: rawBracketGroup,
      fromTitleBracket: true
    };
  }
  if (cleanAuthor && !NON_SUBGROUP_BRACKET_TAG_RE.test(cleanAuthor)) {
    return {
      group: normalizeSubgroupName(cleanAuthor),
      rawGroupInTitle: "",
      fromTitleBracket: false
    };
  }
  const fallbackBracket = String(rawTitle || "").match(/^\s*(?:\[([^\]]+)\]|【([^】]+)】)/);
  if (fallbackBracket) {
    const fb = String(fallbackBracket[1] || fallbackBracket[2] || "").trim();
    if (fb) {
      return {
        group: normalizeSubgroupName(fb),
        rawGroupInTitle: fb,
        fromTitleBracket: true
      };
    }
  }
  return {
    group: "其他发布源",
    rawGroupInTitle: "",
    fromTitleBracket: false
  };
}

function parseChineseNumeralEpisode(cnStr) {
  const s = String(cnStr || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === "十") return 10;
  if (s.includes("十")) {
    const [tensPart, onesPart] = s.split("十");
    const tens = tensPart ? digits[tensPart] : 1;
    const ones = onesPart ? digits[onesPart] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  if (s.length === 1 && digits[s] !== undefined) return digits[s];
  return null;
}

/**
 * 从资源标题中解析集数、版本号 (v2/v3)、季度标记 (S01/S02)、是否为合集包或特典单篇
 */
function parseEpisodeAndVersionFromTitle(title, opts = {}) {
  const raw = String(title || "").trim();
  const sizeBytes = Number(opts.sizeBytes) || parseFileSizeToBytes(opts.size || "");
  const totalEpisodesHint = Number(opts.totalEpisodes) || 0;

  let clean = raw
    .replace(/\[(?:1080|720|2160|480)[pP]?(?:@\d+fps)?\]/gi, " ")
    .replace(
      /\b(?:2160p48F|1080p@60fps|1920x1080|1280x720|3840x2160|10-?bit|8-?bit|x264|x265|H\.?264|H\.?265|HEVC|AVC|AAC(?:x\d)?|FLAC(?:x\d)?|MP4|MKV|WEB-DL|WebRip|BDRip|TVRip|96kHz|48kHz|24bit|16bit|60fps|48fps|24fps)\b/gi,
      " "
    )
    .replace(/\[\d{6}\]|\[\d{4}\.\d{2}\.\d{2}\]/g, " ");

  // 若作品名本身带有易混淆数字（如《86 -不存在的战区-》《魔术快斗1412》），先剥离作品名自身数字防误判话数
  const animeName = String(opts.animeName || "").trim();
  if (animeName && /\d/.test(animeName)) {
    const coreDigitsTitle = animeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      clean = clean.replace(new RegExp(coreDigitsTitle, "gi"), " ");
    } catch (_) {}
  }

  // 特典 / S00E08 / NCOP / NCED / PV / Menu 识别（不占用正片单集号）
  if (/\bS00E\d{1,3}\b/i.test(raw) || /\b(?:NCOP|NCED|PV\d*|CM\d*|Menu|映像特典|特典映像)\b/i.test(raw)) {
    return { episode: null, version: 1, seasonFromEp: 0, isPack: false, isSpecialExtra: true };
  }

  // BD 分卷识别（如 第1巻、第1～2巻、Vol.1、BD Vol.03 -> 归入合集/分卷，绝不当成正片第 1/3 话）
  if (/第\s*\d+(?:\s*[-~～]\s*\d+)?\s*[巻卷]|\b(?:BD\s*)?Vol\.?\s*\d+(?:\s*[-~～]\s*\d+)?\b/i.test(raw)) {
    return { episode: null, version: 1, seasonFromEp: null, isPack: true, isSpecialExtra: false };
  }

  // 合集包识别（例如 01-12、01~13、全12话、合集、[Fin]、[Complete]、BDBOX）
  const rangeMatch = clean.match(/(?:\b|\s|\[|\()(\d{1,3})\s*[-~～]\s*(\d{1,3})(?:\b|\s|\]|\)|话|集|話|END|Fin)/i);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 200 && a <= 500) {
      return { episode: null, version: 1, seasonFromEp: null, isPack: true, isSpecialExtra: false };
    }
  }
  if (
    /全\s*\d+\s*[话集話]|季度全集|合集|全集|完结撒花|\bBDBOX\b|\bBD-BOX\b|\bBDMV\b|\[(?:Fin|Complete|全集)\]/i.test(raw)
  ) {
    return { episode: null, version: 1, seasonFromEp: null, isPack: true, isSpecialExtra: false };
  }

  // 模式 0：S01E05 / S2E12v2
  const sxeMatch = clean.match(/\bS0?(\d{1,2})E(\d{1,3})(?:v(\d+))?\b/i);
  if (sxeMatch) {
    const sNum = Number(sxeMatch[1]);
    const ep = Number(sxeMatch[2]);
    if (ep >= 0 && ep < 1900) {
      return {
        episode: ep,
        version: sxeMatch[3] ? Number(sxeMatch[3]) : 1,
        seasonFromEp: sNum,
        isPack: false,
        isSpecialExtra: sNum === 0
      };
    }
  }

  // 模式 1："- 12v2"、"- 12 ["、"- 12 ("、"第12话"、"生肉第十集"
  const dashMatch = clean.match(/(?:-\s*|第\s*)(\d{1,3})(?:\.5)?(?:v(\d+))?(?:\s*[\[\(话集話期]|\s|$)/i);
  if (dashMatch) {
    const ep = Number(dashMatch[1]);
    if (ep >= 0 && ep < 1900) {
      return {
        episode: ep,
        version: dashMatch[2] ? Number(dashMatch[2]) : 1,
        seasonFromEp: null,
        isPack: false,
        isSpecialExtra: false
      };
    }
  }

  // 模式 2："[12]"、"[12v2]"、"[07]"、"[13 END]"
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
        seasonFromEp: null,
        isPack: false,
        isSpecialExtra: false
      };
    }
  }

  // 模式 3：EP12 / E12 / 第十集（中文数字）
  const epCodeMatch = clean.match(/\b(?:EP|E)(\d{1,3})(?:v(\d+))?\b/i);
  if (epCodeMatch) {
    return {
      episode: Number(epCodeMatch[1]),
      version: epCodeMatch[2] ? Number(epCodeMatch[2]) : 1,
      seasonFromEp: null,
      isPack: false,
      isSpecialExtra: false
    };
  }
  const cnEpMatch = clean.match(/第([一二两三四五六七八九十]{1,3})[话集話]/);
  if (cnEpMatch) {
    const cnEp = parseChineseNumeralEpisode(cnEpMatch[1]);
    if (cnEp !== null && cnEp >= 1 && cnEp <= 99) {
      return {
        episode: cnEp,
        version: 1,
        seasonFromEp: null,
        isPack: false,
        isSpecialExtra: false
      };
    }
  }

  // 无集数编号但带有 BDRip（多集 TV 动画）或体积 >= 4.2GB（非剧场版）时，自动归入季度全集/合集包防静默丢失
  const isLikelyMovie = totalEpisodesHint === 1 || /剧场版|劇場版|\bMovie\b/i.test(animeName || raw);
  if (
    !isLikelyMovie &&
    (/\bBDRip\b/i.test(raw) || sizeBytes >= 4.2 * 1024 * 1024 * 1024)
  ) {
    return { episode: null, version: 1, seasonFromEp: null, isPack: true, isSpecialExtra: false };
  }

  return { episode: null, version: 1, seasonFromEp: null, isPack: false, isSpecialExtra: false };
}

/**
 * 解析字幕语言标签，同时输出：
 * - `lang`：展示在卡片上的直观语言标签（如 `简繁内封`、`简日内嵌`、`简体`、`繁日内嵌`）
 * - `langBucket`：用于聚合版本流的四大稳定桶（`multi` / `chs` / `cht` / `raw`），防止同一字幕组前几话写 CHS、后几话写 简中 导致断流
 * - `langLiteralToken`：标题中真实出现的原文字串（用于生成 100% 可命中的专属 RSS 关键词）
 */
function parseLanguageInfoFromTitle(rawTitle, category = "") {
  const raw = String(rawTitle || "");
  const multiMatch = raw.match(
    /(简繁日内封字幕|简繁内封字幕|简繁日内封|简繁内封|简繁日外挂|简繁外挂|SCTCJP|CHS&CHT&JPN|CHS_JP&CHT_JP|CHS&CHT|SC&TC|CHI_JPN|简繁日|简繁)/i
  );
  if (multiMatch) {
    const tok = multiMatch[1];
    const display = /外挂/.test(tok) ? "简繁外挂" : "简繁内封";
    return { lang: display, langBucket: "multi", langLiteralToken: tok };
  }

  const chsMatch = raw.match(
    /(简日内封|简日内嵌|简日双语|简体内嵌|简中内嵌|简体内封|CHS&JPN|CHS&JP|CHS_JPN|CHS_JP|JPSC|简日|简体|简中|\bCHS\b|\bGB\b)/i
  );
  if (chsMatch) {
    const tok = chsMatch[1];
    const upper = tok.toUpperCase();
    const display =
      /内封/.test(tok)
        ? "简日内封"
        : /内嵌|双语|JPN|JP|JPSC/i.test(tok)
        ? "简日"
        : upper === "GB" || upper === "CHS"
        ? "简体"
        : tok;
    return { lang: display, langBucket: "chs", langLiteralToken: tok };
  }

  const chtMatch = raw.match(
    /(繁日内封|繁日內封|繁日内嵌|繁日內嵌|繁日双语|繁日雙語|繁体内嵌|繁體內嵌|繁中内嵌|CHT&JPN|CHT&JP|CHT_JPN|CHT_JP|JPTC|繁日|繁体|繁體|繁中|\bCHT\b|\bBIG5\b)/i
  );
  if (chtMatch) {
    const tok = chtMatch[1];
    const upper = tok.toUpperCase();
    const display =
      /内封|內封/.test(tok)
        ? "繁日内封"
        : /内嵌|內嵌|双语|雙語|JPN|JP|JPTC/i.test(tok)
        ? "繁日"
        : upper === "BIG5" || upper === "CHT" || tok === "繁體"
        ? "繁体"
        : tok;
    return { lang: display, langBucket: "cht", langLiteralToken: tok };
  }

  if (/^Raw$/i.test(String(category || "").trim()) || /生肉|\bRAW\b/i.test(raw)) {
    return { lang: "生肉", langBucket: "raw", langLiteralToken: "" };
  }
  return { lang: "", langBucket: "", langLiteralToken: "" };
}

/**
 * 基于真实标题样本构造 100% 匹配标题字面词元的推荐 RSS 搜索词，绝不拼入标题中不存在的括号或转译词
 */
function buildVerifiedRssKeyword(rawTitle, groupInfo, animeCandidates, extraTokens = []) {
  const hayLower = String(rawTitle || "").toLowerCase();
  const tokens = [];

  if (groupInfo && groupInfo.group && groupInfo.group !== "其他发布源") {
    const rawGrp = groupInfo.rawGroupInTitle || groupInfo.group;
    if (rawGrp.includes("&")) {
      const firstPart = rawGrp.split("&")[0].trim();
      if (firstPart && hayLower.includes(firstPart.toLowerCase())) {
        tokens.push(firstPart);
      }
    } else if (rawGrp && hayLower.includes(rawGrp.toLowerCase())) {
      tokens.push(rawGrp);
    }
  }

  const candList = (Array.isArray(animeCandidates) ? animeCandidates : [animeCandidates])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  let matchedTitleToken = "";
  for (const cand of candList) {
    if (hayLower.includes(cand.toLowerCase())) {
      matchedTitleToken = cand;
      break;
    }
    const stripped = cand.replace(/[【】「」『』！!？?。：:～~\-—]/g, " ").replace(/\s+/g, " ").trim();
    if (stripped && stripped.split(" ").every((part) => hayLower.includes(part.toLowerCase()))) {
      matchedTitleToken = stripped;
      break;
    }
  }
  if (!matchedTitleToken && candList[0]) {
    matchedTitleToken = candList[0];
  }
  if (matchedTitleToken) {
    tokens.push(matchedTitleToken);
  }

  const fallbackKeyword = tokens.join(" ").replace(/\s+/g, " ").trim();

  for (const ext of extraTokens) {
    const cleanExt = String(ext || "").trim();
    if (!cleanExt) continue;
    if (!cleanExt.includes("&") && hayLower.includes(cleanExt.toLowerCase())) {
      tokens.push(cleanExt);
      break;
    }
  }

  return {
    recommendedKeyword: tokens.join(" ").replace(/\s+/g, " ").trim() || fallbackKeyword,
    fallbackKeyword: fallbackKeyword || matchedTitleToken
  };
}

/**
 * 解析单条资源的发布组、片源平台、字幕语言、分辨率、封装格式、集数与精准搜索词
 */
function parseComicatTitleMeta(title, author = "", animeName = "", extraOpts = {}) {
  const raw = String(title || "").trim();
  const groupInfo = extractSubgroupInfo(raw, author);
  const group = groupInfo.group;

  let platform = "";
  const platMatch = raw.match(/\b(Baha|Bahamut|Bilibili|B-Global|Bili|CR|Crunchyroll|ABEMA|KKTV|Viu|Netflix|AT-X)\b/i);
  if (platMatch) {
    const p = platMatch[1];
    platform = /^Bahamut$/i.test(p) ? "Baha" : /^Bili$/i.test(p) ? "Bilibili" : p;
  }

  const langInfo = parseLanguageInfoFromTitle(raw, extraOpts.category || "");
  const lang = langInfo.lang;

  let format = "";
  const fmtMatch = raw.match(/\b(MP4|MKV)\b/i);
  if (fmtMatch) format = fmtMatch[1].toUpperCase();

  let resolution = "";
  let resLiteral = "";
  const resMatch = raw.match(/\b(2160[pP](?:48F)?|4K|3840x2160|1080[pP](?:@60fps)?|1920x1080|720[pP]|1280x720|480[pP])\b/i);
  if (resMatch) {
    resLiteral = resMatch[1];
    const upper = resLiteral.toUpperCase();
    if (upper.includes("2160") || upper === "4K" || upper === "3840X2160") {
      resolution = "2160P";
    } else if (upper.includes("1080") || upper === "1920X1080") {
      resolution = "1080P";
    } else if (upper.includes("720") || upper === "1280X720") {
      resolution = "720P";
    } else {
      resolution = upper;
    }
  }

  const mediaSource = /\b(BDRip|BDBOX|BD-BOX|BDMV)\b/i.test(raw) ? "BDRip" : "";

  const epParsed = parseEpisodeAndVersionFromTitle(raw, {
    animeName,
    size: extraOpts.size || "",
    sizeBytes: extraOpts.sizeBytes || 0,
    totalEpisodes: extraOpts.totalEpisodes || 0
  });

  const animeCandidates = Array.isArray(extraOpts.animeCandidates) && extraOpts.animeCandidates.length > 0
    ? extraOpts.animeCandidates
    : [animeName].filter(Boolean);

  const verifiedKw = buildVerifiedRssKeyword(
    raw,
    groupInfo,
    animeCandidates,
    [platMatch ? platMatch[1] : "", langInfo.langLiteralToken, resLiteral]
  );

  // 版本流标识：将字幕组 + 平台/BDRip + 语言桶 + 分辨率 纳入区分键，既防止 1080P 与 720P 混流，又兼容同语种微调命名
  const bucketLabel =
    langInfo.langBucket === "multi"
      ? "简繁内封"
      : langInfo.langBucket === "chs"
      ? "简中"
      : langInfo.langBucket === "cht"
      ? "繁中"
      : langInfo.langBucket === "raw"
      ? "生肉"
      : "";
  const streamKeyParts = [group, mediaSource || platform, bucketLabel, resolution || format].filter(Boolean);
  const streamId = streamKeyParts.join(" · ") || group;

  return {
    group,
    platform: mediaSource && !platform ? mediaSource : platform,
    mediaSource,
    lang,
    langBucket: langInfo.langBucket,
    format,
    resolution,
    episode: epParsed.episode,
    version: epParsed.version,
    seasonFromEp: epParsed.seasonFromEp,
    isPack: epParsed.isPack,
    isSpecialExtra: epParsed.isSpecialExtra,
    streamId,
    recommendedKeyword: verifiedKw.recommendedKeyword,
    fallbackKeyword: verifiedKw.fallbackKeyword
  };
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
 * 兼容 qBittorrent 通配符语法的标题过滤器
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

function parseExplicitSeasonNumber(text) {
  const s = String(text || "");
  const cnMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const cnMatch = s.match(/第\s*([一二三四五六七八九\d])\s*[季期]/);
  if (cnMatch) {
    const v = cnMap[cnMatch[1]] || Number(cnMatch[1]);
    if (v >= 1 && v <= 9) return v;
  }
  const enMatch = s.match(/\b(?:Season\s*(\d)|(\d)(?:st|nd|rd|th)\s+Season|S0?([2-9]))\b/i);
  if (enMatch) {
    const v = Number(enMatch[1] || enMatch[2] || enMatch[3]);
    if (v >= 1 && v <= 9) return v;
  }
  if (/\s+III(?:\s|$)/i.test(s)) return 3;
  if (/\s+II(?:\s|$)/i.test(s)) return 2;
  return null;
}

const CJK_TRAD_TO_SIMP_PAIRS = [
  "麗丽", "絲丝", "戰战", "滅灭", "職职", "轉转", "無无", "戀恋", "貓猫", "學学",
  "園园", "異异", "從从", "開开", "蓮莲", "語语", "終终", "傷伤", "歐欧", "醬酱",
  "搖摇", "滾滚", "獨独", "樂乐", "隊队", "吶呐", "國国", "記记", "違违", "輝辉",
  "讓让", "頭头", "腦脑", "電电", "砲炮", "鐵铁", "鍋锅", "惡恶", "龍龙", "夢梦",
  "寶宝", "偵侦", "銀银", "術术", "師师", "達达", "宮宫", "飯饭", "營营", "藍蓝",
  "紅红", "綠绿", "黃黄", "劍剑", "聖圣", "導导", "書书", "館馆", "機机", "動动",
  "進进", "擊击", "撃击", "獵猎", "籃篮", "網网", "鑽钻", "賭赌", "淵渊", "雙双",
  "陰阴", "陽阳", "實实", "驗验", "殺杀", "約约", "會会", "彈弹", "論论", "運运",
  "門门", "薔蔷", "櫻樱", "蘭兰", "關关", "帳帐", "蟲虫", "偽伪", "憑凭", "曆历",
  "續续", "傾倾", "緣缘", "響响", "號号", "羅罗", "恆恒", "聲声", "氣气", "鈴铃",
  "迴回", "鏈链", "鋸锯", "間间", "諜谍", "藥药", "膽胆", "黨党", "敗败", "義义",
  "時时", "輕轻", "鄰邻", "當当", "親亲", "係系", "頌颂", "竊窃", "賊贼", "誼谊",
  "的時間", "東东", "風风", "雲云", "飛飞", "鳥鸟", "魚鱼", "馬马", "島岛", "華华",
  "葉叶", "萬万", "與与", "專专", "業业", "叢丛", "絲丝", "兩两", "嚴严", "喪丧",
  "個个", "豐丰", "臨临", "為为", "麗丽", "舉举", "義义", "烏乌", "樂乐", "喬乔",
  "習习", "鄉乡", "買买", "亂乱", "爭争", "虧亏", "亞亚", "產产", "畝亩", "享享",
  "京京", "亮亮", "億亿", "僅仅", "僕仆", "優优", "償偿", "儲储", "兒儿", "兌兑",
  "兗兖", "黨党", "蘭兰", "興兴", "茲兹", "養养", "獸兽", "內内", "岡冈", "冊册",
  "寫写", "軍军", "農农", "馮冯", "沖冲", "決决", "況况", "凍冻", "淨净", "淒凄",
  "涼凉", "凌凌", "減减", "湊凑", "凜凛", "幾几", "鳳凤", "憑凭", "凱凯", "擊击",
  "鑿凿", "芻刍", "劃划", "劉刘", "則则", "剛刚", "創创", "刪删", "別别", "剄刭",
  "劍剑", "劑剂", "劇剧", "勸劝", "辦办", "務务", "動动", "勵励", "勁劲", "勞劳",
  "勢势", "勳勋", "勻匀", "匭匦", "匱匮", "區区", "醫医", "華华", "協协", "單单",
  "賣卖", "盧卢", "滷卤", "衛卫", "卻却", "廠厂", "廳厅", "歷历", "厲厉", "壓压",
  "厭厌", "廁厕", "廂厢", "廈厦", "廚厨", "廄厩", "縣县", "參参", "雙双", "發发",
  "變变", "敘叙", "疊叠", "葉叶", "號号", "嘆叹", "嘰叽", "籲吁", "後后", "嚇吓",
  "呂吕", "嗎吗", "噸吨", "聽听", "啟启", "吳吴", "嘸呒", "嘔呕", "嚦呖", "唄呗",
  "員员", "唚吣", "嗆呛", "嗚呜", "詠咏", "咔咔", "嚨咙", "嚀咛", "噝咝", "響响",
  "啞哑", "噠哒", "嘵哓", "嗶哔", "噦哕", "嘩哗", "噲哙", "嚌鲚", "噥哝", "喲哟",
  "嘜唛", "唝唝", "嘮唠", "啢唡", "嗩唢", "唣唣", "喚唤", "呼呼", "嘖啧", "嗇啬",
  "囀啭", "齧啮", "囉啰", "嘽啴", "嘯啸", "噴喷", "嘍喽", "嚳喾", "囁嗫", "噯嗳",
  "噓嘘", "嚶嘤", "囑嘱", "嚕噜", "囂嚣", "團团", "園园", "睏困", "囪囱", "圍围",
  "圇囵", "國国", "圖图", "圓圆", "聖圣", "壙圹", "場场", "壞坏", "塊块", "堅坚",
  "壇坛", "壢坜", "壩坝", "塢坞", "墳坟", "墜坠", "壟垄", "壚垆", "壘垒", "墾垦",
  "坰垧", "堊垩", "墊垫", "埡垭", "墶垯", "墁墁", "境境", "墅墅", "壓压", "壯壮",
  "聲声", "殼壳", "壺壶", "處处", "備备", "復复", "夠够", "頭头", "誇夸", "夾夹",
  "奪夺", "奩奁", "奐奂", "奮奋", "獎奖", "奧奥", "妝妆", "婦妇", "媽妈", "嫵妩",
  "嫗妪", "媯妫", "姍姗", "姜姜", "婁娄", "婭娅", "嬈娆", "嬌娇", "孌娈", "娛娱",
  "媧娲", "嫻娴", "嬰婴", "嬋婵", "嬸婶", "媼媪", "嬡嫒", "嬪嫔", "嬙嫱", "嬤嬷",
  "孫孙", "學学", "孿孪", "寧宁", "寶宝", "實实", "寵宠", "審审", "憲宪", "宮宫",
  "寬宽", "賓宾", "寢寝", "對对", "尋寻", "導导", "壽寿", "將将", "爾尔", "塵尘",
  "嘗尝", "堯尧", "尷尴尬", "屍尸", "盡尽", "層层", "屓屃", "屜屉", "屆届", "屬属",
  "屢屡", "屨屦", "嶼屿", "歲岁", "豈岂", "嶇岖", "崗岗", "峴岘", "嵐岚", "島岛",
  "嶺岭", "崠岽", "巋岿", "嶧峄", "峽峡", "嶢峣", "嶠峤", "崢峥", "巒峦", "嶗崂",
  "崍崃", "嶮险", "嶄崭", "嶸嵘", "欽嵚", "嶁嵝", "巔巅", "鞏巩", "巰巯", "幣币",
  "帥帅", "師师", "幃帏", "帳帐", "簾帘", "幟帜", "帶带", "幀帧", "幫帮", "幬帱",
  "幘帻", "幗帼", "冪幂", "幹干", "並并", "廣广", "莊庄", "慶庆", "廬庐", "廡庑",
  "庫库", "應应", "廟庙", "龐庞", "廢废", "廩廪", "開开", "異异", "棄弃", "弒弑",
  "張张", "彌弥", "弳弪", "彎弯", "彈弹", "強强", "歸归", "當当", "錄录", "彥彦",
  "徹彻", "徑径", "徠徕", "御御", "憶忆", "懺忏", "憂忧", "愾忾", "懷怀", "態态",
  "慫怂", "憮怃", "慪怄", "悵怅", "愴怆", "憐怜", "總总", "懟怼", "懌怿", "戀恋",
  "懇恳", "惡恶", "慟恸", "懨恹", "愷恺", "惻恻", "惱恼", "惲恽", "悅悦", "愨悫",
  "懸悬", "慳悭", "憫悯", "驚惊", "懼惧", "慘惨", "懲惩", "憊惫", "愜惬", "慚惭",
  "憚惮", "慣惯", "惰惰", "惱恼", "慍愠", "憤愤", "憒愦", "願愿", "懾慑", "懣懑",
  "懶懒", "懍懔", "戇戆", "戔戋", "戲戏", "戧戗", "戰战", "戩戬", "戶户", "扎扎",
  "撲扑", "扦扦", "執执", "擴扩", "捫扪", "掃扫", "揚扬", "擾扰", "撫抚", "拋抛",
  "摶抟", "摳抠", "掄抡", "搶抢", "護护", "報报", "擔担", "擬拟", "攏拢", "揀拣",
  "擁拥", "攔拦", "擰拧", "撥拨", "擇择", "掛挂", "摯挚", "攣挛", "掗挜", "撾挝",
  "撻挞", "挾挟", "撓挠", "擋挡", "撟挢", "掙挣", "擠挤", "揮挥", "撝撝", "撈捞",
  "損损", "撿捡", "換换", "搗捣", "據据", "擄掳", "摑掴", "擲掷", "撣掸", "摻掺",
  "摜掼", "揸揸", "攬揽", "撳揿", "攙搀", "擱搁", "摟搂", "攪搅", "攜携", "攝摄",
  "攄摅", "擺摆", "搖摇", "擯摈", "攤摊", "攖撄", "撐撑", "攆撵", "擷撷", "擼撸",
  "攛撺", "擻擞", "攢攒", "敵敌", "斂敛", "數数", "齋斋", "斕斓", "斬斩", "斷断",
  "無无", "舊旧", "時时", "曠旷", "暘旸", "曇昙", "晝昼", "曨昽", "顯显", "晉晋",
  "曬晒", "曉晓", "曄晔", "暈晕", "暉晖", "暫暂", "曖暧", "札札", "術术", "樸朴",
  "機机", "殺杀", "雜杂", "權权", "條条", "來来", "楊杨", "榪杩", "傑杰", "極极",
  "構构", "樅枞", "樞枢", "棗枣", "櫪枥", "梘枧", "棖枨", "槍枪", "楓枫", "梟枭",
  "櫃柜", "檸柠", "檉柽", "梔栀", "柵栅", "標标", "棧栈", "櫛栉", "櫳栊", "棟栋",
  "櫨栌", "櫟栎", "欄栏", "樹树", "棲栖", "樣样", "欒栾", "桊棬", "椏桠", "橈桡",
  "楨桢", "檔档", "榿桤", "橋桥", "樺桦", "檜桧", "槳桨", "樁桩", "夢梦", "檮梼",
  "梲棁", "檢检", "欞棂", "槨椁", "櫝椟", "槧椠", "欏椤", "橢椭", "樓楼", "欖榄",
  "櫬榇", "櫚榈", "櫸榉", "檟槚", "檻槛", "檳槟", "櫧槠", "橫横", "檣樯", "櫻樱",
  "橥", "櫥橱", "櫓橹", "櫞橼", "簷檐", "檁檩", "歡欢", "歟欤", "歐欧", "殲歼",
  "歿殁", "殤殇", "殘残", "殞殒", "殮殓", "殫殚", "殯殡", "毆殴", "毀毁", "轂毂",
  "畢毕", "斃毙", "氈毡", "毿毵", "氌氇", "氣气", "氫氢", "氬氩", "氳氲", "匯汇",
  "漢汉", "汙污", "湯汤", "洶汹", "決决", "汽汽", "沃沃", "沈沈", "沌沌", "沍沍",
  "沒没", "沖冲", "沙沙", "溝沟", "瀝沥", "淪沦", "滄沧", "溮浉", "滬沪", "濘泞",
  "淚泪", "澩泶", "瀧泷", "瀘泸", "爍烁", "潑泼", "澤泽", "涇泾", "潔洁", "灑洒",
  "窪洼", "浹浃", "淺浅", "漿浆", "澆浇", "湞浈", "濁浊", "測测", "澮浍", "濟济",
  "瀏浏", "滻浐", "渾浑", "滸浒", "濃浓", "潯浔", "濜浕", "塗涂", "湧涌", "濤涛",
  "澇涝", "淶涞", "漣涟", "潿涠", "渦涡", "溳溳", "渙涣", "滌涤", "潤润", "澗涧",
  "漲涨", "澀涩", "澱淀", "淵渊", "淥渌", "漬渍", "瀆渎", "漸渐", "澠渑", "漁渔",
  "瀋渖", "滲渗", "溫温", "灣湾", "濕湿", "潰溃", "濺溅", "漵溆", "潙沩", "滾滚",
  "滯滞", "灄滠", "滫滫", "滿满", "瀅滢", "濾滤", "濫滥", "灤滦", "濱滨", "灘滩",
  "澦滪", "灕漓", "滷卤", "滸浒", "滻浐", "滾滚", "滿满", "漁渔", "漂漂", "漆漆",
  "漏漏", "演演", "漚沤", "漢汉", "漣涟", "漩漩", "漪漪", "漫漫", "漬渍", "漱漱",
  "漲涨", "漸渐", "漾漾", "漿浆", "潁颍", "潑泼", "潔洁", "潛潜", "潟潟", "潤润",
  "潭潭", "潮潮", "潰溃", "潸潸", "潺潺", "潼潼", "澀涩", "澄澄", "澆浇", "澇涝",
  "澈澈", "澍澍", "澎澎", "澗涧", "澡澡", "澤泽", "澧澧", "澳澳", "澹澹", "激激",
  "濁浊", "濂濂", "濃浓", "澠渑", "濕湿", "濘泞", "濛濛", "濟济", "濠濠", "濡濡",
  "濤涛", "濫滥", "濬浚", "濮濮", "濯濯", "濰潍", "濱滨", "濺溅", "濾滤", "瀆渎",
  "瀉泻", "瀋沈阳", "瀏浏", "瀑瀑", "瀕濒", "瀘泸", "瀚瀚", "瀛瀛", "瀝沥", "瀟潇",
  "瀠瀠", "瀦潴", "瀧泷", "瀨濑", "瀰弥", "瀲潋", "瀾澜", "灌灌", "灑洒", "灘滩",
  "灣湾", "滅灭", "燈灯", "灰灰", "靈灵", "災灾", "燦灿", "煬炀", "爐炉", "燉炖",
  "煒炜", "熗炝", "點点", "煉炼", "熾炽", "爍烁", "爛烂", "烴烃", "燭烛", "煙烟",
  "煩烦", "燒烧", "燁烨", "燴烩", "燙烫", "燼烬", "熱热", "煥焕", "燜焖", "燾焘",
  "愛爱", "爺爷", "牘牍", "牽牵", "犧牺", "犢犊", "狀状", "獁犸", "猶犹", "狽狈",
  "狐狐", "狗狗", "狙狙", "狎狎", "狠狠", "狡狡", "狩狩", "獨独", "狹狭", "獅狮",
  "獪狯", "猙狰", "獄狱", "猻狲", "獵猎", "獼猕", "玀猡", "豬猪", "貓猫", "獻献",
  "獺獭", "璣玑", "璵玙", "瑒", "瑪玛", "瑋玮", "環环", "現现", "瑲玱", "璽玺",
  "瑉珉", "珏珏", "琺珐", "瓏珑", "璫珰", "琿珲", "琤琤", "瓊琼", "瑤瑶", "璦瑷",
  "璿璇", "瓔璎", "瓚瓒", "甕瓮", "甌瓯", "電电", "畫画", "暢畅", "畬畲", "疇畴",
  "癤疖", "療疗", "瘧疟", "癘疠", "瘍疡", "瘺瘘", "癟瘪", "癱瘫", "癢痒", "癥症",
  "癧疬", "瘋疯", "皰疱", "疴疴", "癰痈", "痙痉", "癢痒", "瘂痖", "癆痨", "瘓痪",
  "癇痫", "癡痴", "癉瘅", "瘮瘆", "瘞瘗", "瘺瘘", "癟瘪", "癱瘫", "癮瘾", "癭瘿",
  "癩癞", "癬癣", "癲癫", "皚皑", "皺皱", "皸皲", "盞盏", "鹽盐", "監监", "蓋盖",
  "盜盗", "盤盘", "眥眦", "睏困", "矚瞩", "睜睁", "睞睐", "瞼睑", "瞞瞒", "矚瞩",
  "矯矫", "磯矶", "礬矾", "礦矿", "碭砀", "碼码", "磚砖", "硨砗", "硯砚", "碸砜",
  "礪砺", "礱砻", "礫砾", "礎础", "硜硜", "硅硅", "碩硕", "硤硖", "磽硗", "磑硙",
  "確确", "鹼碱", "礙碍", "磧碛", "磣碜", "禮礼", "禕祎", "禰祢", "禎祯", "禱祷",
  "禍祸", "稟禀", "祿禄", "禪禅", "離离", "禿秃", "稈秆", "種种", "積积", "稱称",
  "穢秽", "穠秾", "移移", "稅税", "穌稣", "穩稳", "穡穑", "窮穷", "竊窃", "竅窍",
  "窯窑", "竄窜", "窩窝", "窺窥", "竇窦", "窶窭", "豎竖", "競竞", "篤笃", "筍笋",
  "筆笔", "筧笕", "箋笺", "籠笼", "籩笾", "築筑", "篳筚", "篩筛", "簹筜", "箏筝",
  "籌筹", "簽签", "簡简", "籙箓", "簀箦", "篋箧", "籜箨", "籮箩", "簞箪", "簫箫",
  "簣篑", "簍篓", "籃篮", "籬篱", "籪簖", "籟籁", "糴籴", "類类", "秈籼", "糶粜",
  "糲粝", "粵粤", "糞粪", "糧粮", "糝糁", "粞粞", "緊紧", "縶絷", "糾纠", "紆纡",
  "紅红", "紂纣", "纖纤", "紇纥", "約约", "級级", "紈纨", "纊纩", "紀纪", "紉纫",
  "緯纬", "紜纭", "紘纮", "純纯", "紕纰", "紗纱", "綱纲", "納纳", "紝纴", "縱纵",
  "綸纶", "紛纷", "紙纸", "紋纹", "紡纺", "紵纻", "紖纼", "紐纽", "紓纾", "線线",
  "紺绀", "絏绁", "紱绂", "練练", "組组", "紳绅", "細细", "織织", "終终", "縐绉",
  "絆绊", "紼绋", "絀绌", "紹绍", "繹绎", "經经", "紿绐", "綁绑", "絨绒", "結结",
  "絝绔", "繞绕", "絰绖", "絎绗", "繪绘", "給给", "絢绚", "絳绛", "絡络", "絕绝",
  "絞绞", "統统", "綆绠", "綃绡", "絹绢", "繡绣", "綌绤", "綏绥", "絛绦", "繼继",
  "綈绨", "績绩", "緒绪", "綾绫", "緓绬", "續续", "綺绮", "緋绯", "綽绰", "緔绱",
  "緄绲", "繩绳", "維维", "綿绵", "綬绶", "繃绷", "綢绸", "綹绺", "綣绻", "綜综",
  "綻绽", "綰绾", "綠绿", "綴缀", "緇缁", "緙缂", "緗缃", "緘缄", "緬缅", "纜缆",
  "緹缇", "緲缈", "緝缉", "緼缊", "繢缋", "緦缌", "綞缍", "緞缎", "緶缏", "線线",
  "緱缑", "縋缒", "緩缓", "締缔", "縷缕", "編编", "緡缗", "緣缘", "縉缙", "縛缚",
  "縟缛", "縝缜", "縫缝", "縗缞", "縞缟", "纏缠", "縭缡", "縊缢", "縑缣", "繽缤",
  "縹缥", "縵缦", "縲缧", "纓缨", "縮缩", "繆缪", "繅缫", "纈缬", "繚缭", "繕缮",
  "繒缯", "韁缰", "繾缱", "繰缲", "繯缳", "繳缴", "纘缵", "罌罂", "網网", "羅罗",
  "罰罚", "罷罢", "羆罴", "羈羁", "羥羟", "羨羡", "翹翘", "翬翚", "聳耸", "恥耻",
  "聶聂", "聾聋", "職职", "聹聍", "聯联", "聵聩", "聰聪", "肅肃", "腸肠", "膚肤",
  "骯肮", "腎肾", "腫肿", "脹胀", "脅胁", "膽胆", "勝胜", "朧胧", "臚胪", "脛胫",
  "膠胶", "脈脉", "膾脍", "臟脏", "臍脐", "腦脑", "膿脓", "臠脔", "腳脚", "脫脱",
  "腡脶", "臉脸", "臘腊", "膩腻", "膕腘", "騰腾", "臏膑", "輿舆", "艤舣", "艦舰",
  "艙舱", "艫舻", "艱艰", "艷艳", "藝艺", "節节", "羋芈", "薌芗", "蕪芜", "蘆芦",
  "蕓芸", "萇苌", "蒼苍", "蘇苏", "苧苎", "蘋苹", "莖茎", "蘢茏", "蔦茑", "塋茔",
  "煢茕", "繭茧", "荊荆", "薦荐", "薘莛", "莢荚", "蕘荛", "蓽荜", "蕎荞", "薈荟",
  "薺荠", "蕩荡", "榮荣", "葷荤", "滎荥", "犖荦", "熒荧", "蕁荨", "藎荩", "蓀荪",
  "蔭荫", "蕒荬", "葒荭", "葤荮", "藥药", "蒞莅", "萊莱", "蓮莲", "蒔莳", "萵莴",
  "薟莶", "獲获", "蕕莸", "瑩莹", "鶯莺", "蓴莼", "蘿萝", "螢萤", "營营", "縈萦",
  "蕭萧", "薩萨", "蔥葱", "蕆蒇", "蕢蒉", "蔣蒋", "蔞蒌", "藍蓝", "薊蓟", "蘺蓠",
  "蕷蓣", "鎣蓥", "驀蓦", "薔蔷", "蘞蔹", "藺蔺", "藹蔼", "蘄蕲", "蘊蕴", "藪薮",
  "藁藁", "蘚藓", "虜虏", "慮虑", "虛虚", "蟲虫", "虯虬", "蟣虮", "雖虽", "蝦虾",
  "蠆虿", "蝕蚀", "蟻蚁", "螞蚂", "蠶蚕", "蠔蚝", "蟶蛏", "蠱蛊", "蠣蛎", "蟈蝈",
  "蟬蝉", "蟯蛲", "蟎螨", "蠨蟏", "釁衅", "銜衔", "補补", "襯衬", "袞衮", "襖袄",
  "嫋袅", "襪袜", "襲袭", "裝装", "襠裆", "褌裈", "襝裣", "褲裤", "褶褶", "褸褛",
  "襤褴", "見见", "觀观", "規规", "覓觅", "視视", "覘觇", "覽览", "覺觉", "覬觊",
  "覡觋", "覿觌", "覦觎", "覯觏", "覲觐", "覷觑", "觴觞", "觸触", "觶觯", "譽誉",
  "謄誊", "計计", "訂订", "訃讣", "認认", "譏讥", "訐讦", "訌讧", "討讨", "讓让",
  "訕讪", "訖讫", "訓训", "議议", "訊讯", "記记", "講讲", "諱讳", "謳讴", "詎讵",
  "訝讶", "訥讷", "許许", "訛讹", "論论", "訟讼", "諷讽", "設设", "訪访", "訣诀",
  "證证", "詁诂", "訶诃", "評评", "詛诅", "識识", "詐诈", "訴诉", "診诊", "詆诋",
  "謅诌", "詞词", "詘诎", "詔诏", "譯译", "詒诒", "誆诓", "誄诔", "試试", "詿诖",
  "詩诗", "詰诘", "詼诙", "誠诚", "誅诛", "詵诜", "話话", "誕诞", "詬诟", "詮诠",
  "詭诡", "詢询", "詣诣", "諍诤", "該该", "詳详", "詫诧", "諢诨", "詡诩", "誡诫",
  "誣诬", "語语", "誚诮", "誤误", "誥诰", "誘诱", "誨诲", "誑诳", "說说", "誦诵",
  "誒诶", "請请", "諸诸", "諏诹", "諾诺", "讀读", "諑诼", "誹诽", "課课", "諉诿",
  "諛谀", "誰谁", "諗谂", "調调", "諂谄", "諒谅", "諄谆", "諝谞", "談谈", "誼谊",
  "謀谋", "諶谌", "諜谍", "謊谎", "諫谏", "諧谐", "謔谑", "謁谒", "謂谓", "諤谔",
  "諭谕", "諼谖", "讒谗", "諮咨", "諳谙", "諺谚", "諦谛", "謎谜", "諞谝", "謨谟",
  "讜谠", "謖谡", "謝谢", "謠谣", "謗谤", "謐谧", "謙谦", "謐谧", "謹谨", "謾谩",
  "謫谪", "譾谫", "謬谬", "譚谭", "譖谮", "譙谯", "讕谰", "譜谱", "譎谲", "讞谳",
  "譴谴", "譫谵", "讖谶", "貝贝", "貞贞", "負负", "財财", "貢贡", "貧贫", "貨货",
  "販贩", "貪贪", "貫贯", "責责", "貯贮", "貰贳", "貲赀", "貳贰", "貴贵", "貶贬",
  "買买", "貸贷", "貺贶", "費费", "貼贴", "貽贻", "貿贸", "賀贺", "賁贲", "賂赂",
  "賃赁", "賄贿", "賅赅", "資资", "賈贾", "賊贼", "賑赈", "賒赊", "賓宾", "賕赇",
  "賙赒", "賤贱", "賬账", "賭赌", "賢贤", "賣卖", "賜赐", "賞赏", "賠赔", "賡赓",
  "賴赖", "賵赗", "贅赘", "賻赙", "賺赚", "賽赛", "賾赜", "贗赝", "贊赞", "贍赡",
  "贏赢", "贛赣", "趙赵", "趕赶", "趨趋", "趲趱", "跡迹", "踐践", "踴踊", "躊踌",
  "蹤踪", "躓踬", "躑踯", "躡蹑", "蹣蹒", "躇躇", "躥蹿", "躪躏", "軀躯", "車车",
  "軋轧", "軌轨", "軒轩", "軔轫", "轉转", "軛轭", "輪轮", "軟软", "轟轰", "軻轲",
  "轤轳", "軸轴", "軹轵", "軼轶", "軺轺", "軫轸", "轢轹", "軿轾", "輕轻", "軾轼",
  "載载", "輊辁", "轎轿", "輈辀", "輇辁", "輅辂", "較较", "輒辄", "輔辅", "輛辆",
  "輦辇", "輩辈", "輝辉", "輥辊", "輞辋", "輟辍", "輜辎", "輳辏", "輻辐", "輯辑",
  "輸输", "轡辔", "轅辕", "轄辖", "輾辗", "轆辘", "轍辙", "轔辚", "辦办", "辭辞",
  "辮辫", "辯辩", "農农", "迴回", "適适", "選选", "遷迁", "遺遗", "遼辽", "邁迈",
  "還还", "邇迩", "邊边", "邏逻", "邐逦", "鬱郁", "鄧邓", "鄭郑", "鄰邻", "鄱鄱",
  "鄴邺", "鄶郐", "鄺邝", "醞酝", "醜丑", "醫医", "醬酱", "釀酿", "釁衅", "釋释",
  "釐厘", "針针", "釘钉", "釗钊", "釙钋", "釕钌", "釷钍", "釧钏", "釤钐", "釩钒",
  "釣钓", "鍆钔", "釹钕", "鍚钖", "釵钗", "鈃钘", "鈣钙", "钚", "鈦钛", "鈍钝",
  "鈔钞", "鐘钟", "鈉钠", "鋇钡", "鋼钢", "鈑钣", "鈐钤", "鑰钥", "欽钦", "鈞钧",
  "鎢钨", "鉤钩", "鈧钪", "钫", "鈥钬", "鈄钭", "鈕钮", "鈀钯", "鈺钰", "錢钱",
  "鉦钲", "鉗钳", "鈷钴", "缽钵", "鈳钶", "鉅钜", "鈽钚", "鈸钹", "鉞钺", "鑽钻",
  "鉬钼", "鉭钽", "鉀钾", "鈿钿", "鈾铀", "鐵铁", "鉑铂", "鈴铃", "鑠铄", "鉛铅",
  "鉚铆", "鈰铈", "鉉铉", "鉈铊", "鉍铋", "鈮铌", "鈹铍", "鐸铎", "銬铐", "銠铑",
  "鉺铒", "銪铕", "鋮铖", "鋏铗", "鐃铙", "鐺铛", "銅铜", "鋁铝", "銱铞", "銦铟",
  "鎧铠", "鍘铡", "銖铢", "銑铣", "鋌铤", "銩铥", "銛铦", "鏵铧", "銓铨", "鎩铩",
  "鉿铪", "銚铫", "鉻铬", "銘铭", "錚铮", "銫铯", "鉸铰", "銥铱", "鏟铲", "銃铳",
  "鐋铴", "銨铵", "銀银", "銣铷", "鑄铸", "鐒铹", "鋪铺", "鏈链", "鏗铿", "銷销",
  "鎖锁", "鋰锂", "鋤锄", "鍋锅", "鋯锆", "鏽锈", "銼锉", "鋝锊", "鋒锋", "鋅锌",
  "鋶锍", "鋱铽", "鐧锏", "銳锐", "銻锑", "鋃锒", "鋟锓", "鋦锔", "錒锕", "錆锖",
  "鍺锗", "鍩锘", "錯错", "錨锚", "錛锛", "錡锜", "錁锞", "錕锟", "錫锡", "錮锢",
  "鑼锣", "錘锤", "錐锥", "錦锦", "鍁锨", "錈锩", "錇锫", "錟锬", "錠锭", "鍵键",
  "鋸锯", "錳锰", "錙锱", "鍥锲", "鍈锳", "鍇锴", "鏘锵", "鍶锶", "鍔锷", "鍤锸",
  "鍬锹", "鍾钟", "鍛锻", "鎪锼", "鍠锾", "鎄锿", "鍍镀", "鎂镁", "鏤镂", "鎡镃",
  "鏌镆", "鎮镇", "鎘镉", "鑷镊", "鐫镌", "鎳镍", "鎿镎", "镏镏", "鎬镐", "鎊镑",
  "鎰镒", "鎵镓", "鎷鎷", "鏢镖", "鏜镗", "鏝镘", "鏍镙", "鏞镛", "鏡镜", "鏑镝",
  "鏃镞", "鏇镟", "鐔镡", "鐐镣", "鐠镨", "鐧锏", "鐨镄", "鐙镫", "鑊镬", "鐳镭",
  "鐶镮", "鐲镯", "鐮镰", "鐿镱", "鑔镲", "鑣镳", "鑞镴", "鑲镶", "長长", "門门",
  "閂闩", "閃闪", "閆闫", "閉闭", "問问", "闖闯", "閏闰", "闈闱", "閒闲", "閎闳",
  "間间", "閔闵", "閌闶", "悶闷", "閘闸", "鬧闹", "閨闺", "聞闻", "闥闼", "閩闽",
  "閭闾", "闓闿", "閥阀", "閣阁", "閡阂", "閫阃", "鬮阄", "閱阅", "閬阆", "閹阉",
  "閻阎", "閼阏", "闡阐", "闌阑", "闃阒", "闊阔", "闋阕", "闔阖", "闐阗", "闕阙",
  "闖闯", "關关", "闡阐", "闢辟", "隊队", "陽阳", "陰阴", "陣阵", "階阶", "際际",
  "陸陆", "隴陇", "陳陈", "陘陉", "陝陕", "隕陨", "險险", "隨随", "隱隐", "隸隶",
  "隻只", "雋隽", "雖虽", "雙双", "雛雏", "雜杂", "雞鸡", "離离", "難难", "雲云",
  "電电", "霧雾", "霽霁", "靂雳", "靄霭", "靈灵", "靚靓", "靜静", "靨靥", "韃鞑",
  "鞦秋", "齑", "韋韦", "韌韧", "韓韩", "韙韪", "韞韫", "韜韬", "韻韵", "頁页",
  "頂顶", "頃顷", "頇顸", "項项", "順顺", "須须", "頊顼", "頑顽", "顧顾", "頓顿",
  "頎颀", "頒颁", "頌颂", "頏颃", "預预", "顱颅", "領领", "頗颇", "頸颈", "頡颉",
  "頰颊", "頲颋", "頜颌", "潁颍", "熲颎", "頦颏", "頤颐", "頻频", "頹颓", "頷颔",
  "穎颖", "顆颗", "題题", "顎颚", "顓颛", "顏颜", "額额", "顳颞", "顢颟", "顛颠",
  "顙颡", "顥颢", "顫颤", "顰颦", "顴颧", "風风", "颺飏", "颭飐", "颯飒", "颶飓",
  "颸飔", "颼飕", "飄飘", "飆飙", "飛飞", "饗飨", "饜餍", "飢饥", "飣饤", "饃馍",
  "餾馏", "饉馑", "饅馒", "饌馔", "饑饥", "饒饶", "餉饷", "餃饺", "餅饼", "餓饿",
  "餒馁", "餘余", "餞饯", "餡馅", "館馆", "餞饯", "饋馈", "餿馊", "饞馋", "馬马",
  "馭驭", "馱驮", "馴驯", "馳驰", "驅驱", "駁驳", "驢驴", "駔驵", "駛驶", "駟驷",
  "駙驸", "駒驹", "騶驺", "駐驻", "駝驼", "駑驽", "駕驾", "驛驿", "駘骀", "驍骁",
  "罵骂", "驕骄", "驊骅", "駱骆", "駭骇", "駢骈", "驪骊", "騁骋", "驗验", "駿骏",
  "騏骐", "騎骑", "騍骒", "騅骓", "驌骕", "驂骖", "騙骗", "騭骘", "騷骚", "騖骛",
  "驁骜", "騮骝", "騫骞", "騸骟", "驃骠", "騾骡", "驄骢", "驏骣", "驟骤", "驥骥",
  "驤骧", "髏髅", "髖髋", "髕髌", "鬢鬓", "魘魇", "魎魉", "魚鱼", "魛鱽", "魢鱾",
  "魷鱿", "魨鲀", "魯鲁", "魴鲂", "魺鲄", "鮁鲅", "鮃鲆", "鯰鲇", "鱸鲈", "鮒鲋",
  "鮑鲍", "鱟鲎", "鮍鲏", "鮭鲑", "鮚鲒", "鮪鲔", "鮞鲕", "鰂鲖", "鮜鲘", "鱠鲙",
  "鱭鲚", "鮫鲛", "鮮鲜", "鮺鲝", "鯗鲞", "鱘鲟", "鯁鲠", "鱺鲡", "鰱鲢", "鰹鲣",
  "鯉鲤", "鰣鲥", "鰷鲦", "鯀鲧", "鯊鲨", "鯇鲩", "鯽鲫", "鯖鲭", "鯪鲮", "鯫鲯",
  "鯡鲱", "鯤鲲", "鯧鲳", "鯝鲴", "鯢鲵", "鮎鲇", "鯛鲷", "鯨鲸", "鰺鲹", "鯴鲺",
  "鯔鲻", "鱝鲼", "鰈鲽", "鰏鲾", "鱨鲿", "鯷鳀", "鰮鳁", "鰃鳂", "鰓鳃", "鱷鳄",
  "鰍鳅", "鰒鳆", "鰉鳇", "鰁鳈", "鱂鳉", "鯿鳊", "鰠鳋", "鰲鳌", "鰭鳍", "鰨鳎",
  "鰥鳏", "鰩鳐", "鰟鳑", "鰜鳒", "鰳鳓", "鰾鳔", "鱈鳕", "鰻鳗", "鰵鳘", "鱅鳙",
  "鰼鳛", "鱖鳜", "鱔鳝", "鱗鳞", "鱒鳟", "鱧鳢", "鱤鳡", "鳥鸟", "鳩鸠", "雞鸡",
  "鳶鸢", "鳴鸣", "鷗鸥", "鴉鸦", "鶬鸧", "鴇鸨", "鴆鸩", "鴣鸪", "鶇鸫", "鸕鸬",
  "鴨鸭", "鴞鸮", "鴦鸯", "鴒鸰", "鴟鸱", "鴝鸲", "鴛鸳", "鴕鸵", "鷥鸶", "鷙鸷",
  "鴯鸸", "鴰鸹", "鵂休", "鴿鸽", "鸞鸾", "鴻鸿", "鵐鹀", "鵓鹁", "鸝鹂", "鵑鹃",
  "鵠鹄", "鵝鹅", "鵒鹆", "鷳鹇", "鵜鹈", "鵡鹉", "鵲鹊", "鶓鹋", "鵪鹌", "鵬鹏",
  "鶉鹑", "鶘鹕", "鶚鹗", "鶻鹘", "鶿鹚", "鶥鹛", "鶩鹜", "鷂鹞", "鶼鹣", "鸚鹦",
  "鷓鹧", "鷚鹨", "鷯鹩", "鷦鹪", "鷲鹫", "鷸鹬", "鷺鹭", "鷹鹰", "鸌鹱", "鸛鹳",
  "鸝鹂", "麥麦", "麩麸", "麴曲", "麵面", "麼么", "黃黄", "黌黉", "點点", "黜黜",
  "黝黝", "黴霉", "黷黩", "黲黪", "黽黾", "鼉鼍", "鼴鼹", "齊齐", "齏齑", "齒齿",
  "齔龀", "齟龃", "齙龅", "齡龄", "齠龆", "齪龊", "齬龉", "齲龋", "齷龌", "龍龙",
  "龐庞", "龔龚", "龕龛", "龜龟"
];
const _CJK_TRAD_MAP = (() => {
  const m = new Map();
  for (const pair of CJK_TRAD_TO_SIMP_PAIRS) {
    if (pair.length === 2 && pair[0] !== pair[1]) {
      m.set(pair[0], pair[1]);
    }
  }
  return m;
})();

function normalizeCjkForMatch(str) {
  const raw = String(str || "");
  if (!raw) return "";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    out += _CJK_TRAD_MAP.get(ch) || ch;
  }
  return out;
}

function compactTitleForMatch(str) {
  return normalizeCjkForMatch(str)
    .toLowerCase()
    .replace(/[\s\-_~～:：·・,，.。!！?？/／\\【】\[\]()（）「」『』〖〗〔〕★☆✦✧《》〈〉<>'"`“”‘’&＆+＋]+/g, "");
}

/**
 * 校验种子标题是否真正包含本番剧的连续名称或已知别名（杜绝搜索引擎把《女友的朋友》拆词误命中《租借女友 / 女朋友，借我一下》）
 */
function doesTitleMatchAnimeCandidates(rawTitle, animeContext = {}) {
  const candList = Array.isArray(animeContext.animeCandidates) && animeContext.animeCandidates.length > 0
    ? animeContext.animeCandidates
    : [animeContext.name, animeContext.japaneseName].filter(Boolean);
  if (candList.length === 0) return true;

  const compactHay = compactTitleForMatch(rawTitle);
  const compactHayNo = compactHay.replace(/の/g, "之");
  if (!compactHay) return false;

  const phraseSet = new Set();
  const addPhrase = (raw) => {
    const s = String(raw || "").trim();
    if (!s) return;
    const comp = compactTitleForMatch(s);
    if (comp.length >= 2) {
      phraseSet.add(comp);
      phraseSet.add(comp.replace(/の/g, "之"));
    } else if (comp.length === 1 && s === String(animeContext.name || "").trim()) {
      phraseSet.add(comp);
    }
  };

  for (const cand of candList) {
    const raw = String(cand || "").trim();
    if (!raw) continue;
    addPhrase(raw);

    // 提取主干标题（去除季度后缀如“第三季 反击篇”，但绝不按“的”拆碎短语）
    const strippedSeason = raw
      .replace(/\s*(?:第[一二三四五六七八九十\d]+[季期部]|Season\s*\d+|Part\s*\d+|反击篇|袭击篇|前篇|后篇|上半季?|下半季?|后半部分|前半部分|II|III)\s*$/gi, "")
      .trim();
    if (strippedSeason && strippedSeason.length >= 2) {
      addPhrase(strippedSeason);
    }

    // 兼容带波浪号或冒号副标题的长番名（如“辉夜大小姐想让我告白～天才们的恋爱头脑战～”或“感谢对战。 ～大小姐才不玩格斗游戏～”）
    for (const wm of raw.matchAll(/[～~]([^～~]{3,})[～~]/g)) {
      if (wm[1]) addPhrase(wm[1]);
    }
    const colonOrDashParts = strippedSeason
      .replace(/[～~][^～~]*[～~]/g, " ")
      .split(/[。．：:！!？?—\/]+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3);
    for (const part of colonOrDashParts) {
      addPhrase(part);
    }
  }

  if (phraseSet.size === 0) return true;
  for (const ph of phraseSet) {
    if (!ph) continue;
    // 纯英文短词要求至少 3 个字符，避免极短缩写误撞
    if (/^[a-z0-9]+$/.test(ph) && ph.length < 3 && ph !== compactTitleForMatch(animeContext.name)) {
      continue;
    }
    if (compactHay.includes(ph) || compactHayNo.includes(ph)) {
      return true;
    }
  }
  return false;
}

/**
 * 识别条目是否属于「非视频杂项 / 无关串番条目」或「同系列其他季 / 衍生短篇（如 2025 友谊是时间的窃贼 之于 2022 莉可丽丝）」，
 * 防止衍生短篇覆盖正片第 01–06 话或拆词串入无关番剧（如搜《女友的朋友》串入《租借女友》）。
 */
function classifyResourceForAnime(itemObj, animeContext = {}) {
  const cat = String(itemObj.category || "").trim();
  const title = String(itemObj.title || "");
  const allowNonVideo = Boolean(animeContext.allowNonVideo);

  if (!allowNonVideo) {
    if (/^(?:音乐|音樂|漫画|漫畫|周边|周邊|其它|其他|游戏|遊戲|小说|小說|画集)$/i.test(cat)) {
      return { isNonVideoNoise: true, isDerivedOrOtherSeason: false };
    }
    const looksLikeAudioOrBookOnly =
      /(?:\bOST\b|Original\s*Soundtrack|オリジナルサウンドトラック|新曲|角色歌|キャラソン|OPテーマ|EDテーマ|Drama\s*CD|\bHi-?Res\b.*(?:\bFLAC\b|\bWAV\b)|\[(?:\d{6}|\d{4}\.\d{2}\.\d{2})\].*(?:\bFLAC\b|\bMP3\b|\bWAV\b|\b320K\b))/i.test(
        title
      ) && !/\b(?:1080[pP]|720[pP]|2160[pP]|4K|MP4|MKV|BDRip|WEB-DL|WebRip)\b/i.test(title);
    if (looksLikeAudioOrBookOnly) {
      return { isNonVideoNoise: true, isDerivedOrOtherSeason: false };
    }
  }

  // 若该 infoHash 已在蜜柑计划的 bgm.tv/subject/<subjectId> 专属条目页得到精确哈希背书，直接判定为 100% 本作正片/合集
  if (
    itemObj.infoHash &&
    animeContext.mikanVerifiedHashes instanceof Set &&
    animeContext.mikanVerifiedHashes.has(itemObj.infoHash)
  ) {
    return { isNonVideoNoise: false, isDerivedOrOtherSeason: false };
  }
  if (
    animeContext.subjectId &&
    itemObj.verifiedSubjectId &&
    String(itemObj.verifiedSubjectId) === String(animeContext.subjectId)
  ) {
    return { isNonVideoNoise: false, isDerivedOrOtherSeason: false };
  }

  // 用户手动输入特定搜索词时（非作品默认搜索），不做季度隔离以尊重用户显式检索意图
  if (animeContext.disableSeasonIsolation) {
    return { isNonVideoNoise: false, isDerivedOrOtherSeason: false };
  }

  // 严格连续片名/别名核验：拦截搜索引擎分词误召回的无关作品（如搜「女友的朋友」误命中「租借女友 / 女朋友，借我一下」）
  if (!doesTitleMatchAnimeCandidates(title, animeContext)) {
    return { isNonVideoNoise: true, isDerivedOrOtherSeason: false };
  }

  const targetName = String(animeContext.name || "").trim();
  const targetJp = String(animeContext.japaneseName || "").trim();
  const targetYear = Number(animeContext.year) || 0;
  const targetTotalEps = Number(animeContext.totalEpisodes) || 0;
  const targetSeason = parseExplicitSeasonNumber(`${targetName} ${targetJp}`);
  const itemSeason = itemObj.seasonFromEp > 0 ? itemObj.seasonFromEp : parseExplicitSeasonNumber(title);
  const pubYear = itemObj.pubTimeMs > 0 ? new Date(itemObj.pubTimeMs).getFullYear() : 0;

  if (targetSeason !== null && targetSeason >= 2) {
    if (itemSeason !== null && itemSeason !== targetSeason) {
      return { isNonVideoNoise: false, isDerivedOrOtherSeason: true };
    }
    if (targetYear >= 2005 && pubYear > 0 && pubYear < targetYear - 1) {
      return { isNonVideoNoise: false, isDerivedOrOtherSeason: true };
    }
    return { isNonVideoNoise: false, isDerivedOrOtherSeason: false };
  }

  // 目标作品为第一季或独立 TV 番剧（标题不含第X季）
  if (itemSeason !== null && itemSeason >= 2) {
    return { isNonVideoNoise: false, isDerivedOrOtherSeason: true };
  }

  const isTargetMovieOrOva =
    targetTotalEps === 1 ||
    /剧场版|劇場版|\bMovie\b|\bOVA\b|\bOAD\b|特别篇|总集篇|小剧场|友谊是时间的窃贼/i.test(`${targetName} ${targetJp}`);

  if (!isTargetMovieOrOva) {
    if (
      /剧场版|劇場版|\bMovie\b|迷你动画|小剧场|\bMini\s*Anime\b|友谊是时间的窃贼|友誼是時間的竊賊|Friends\s+are\s+thieves\s+of\s+time/i.test(
        title
      )
    ) {
      return { isNonVideoNoise: false, isDerivedOrOtherSeason: true };
    }

    // 跨年份非 BD 单集衍生检测：例如 2022 完结 TV 番在 2025 年出现非 BDRip 的周更单集（多为新作短篇/未标季号的新篇章）
    if (
      targetYear >= 1995 &&
      pubYear >= targetYear + 2 &&
      !itemObj.isPack &&
      !/\b(?:BD|BDRip|BDBOX|BD-BOX|BDMV|Remux|2160p48F)\b/i.test(title)
    ) {
      return { isNonVideoNoise: false, isDerivedOrOtherSeason: true };
    }
  }

  return { isNonVideoNoise: false, isDerivedOrOtherSeason: false };
}

function finalizeNormalizedTorrentItem(rawEntry, animeContext = {}, baseUrl = DEFAULT_COMICAT_BASE_URL) {
  const title = String(rawEntry.title || "").trim();
  if (!title) return null;
  const infoHash = normalizeBtihToHex(rawEntry.infoHash || "");
  const trackerList = getAugmentedAnimeTrackers();
  const trackerSuffix = trackerList.map((tr) => `&tr=${encodeURIComponent(tr)}`).join("");

  const rawMagnet = String(rawEntry.magnetUrl || "").trim();
  const magnetUrl = rawMagnet.startsWith("magnet:?")
    ? enrichMagnetUrlWithTrackers(rawMagnet)
    : infoHash
    ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}${trackerSuffix}`
    : "";

  const rawTor = String(rawEntry.torrentUrl || "").trim();
  const safeDirectTorrent = rawTor && !rawTor.startsWith("magnet:?") && !isDeadEnclosureRssFeed(rawTor) ? rawTor : "";
  const torrentUrl =
    safeDirectTorrent || (infoHash ? `https://itorrents.org/torrent/${infoHash.toUpperCase()}.torrent` : "");

  const sizeBytes = Number(rawEntry.sizeBytes) || parseFileSizeToBytes(rawEntry.size || "");
  const size = formatReadableFileSize(rawEntry.size || "", sizeBytes);

  const meta = parseComicatTitleMeta(title, rawEntry.author || rawEntry.mikanSubgroup || "", animeContext.name || "", {
    category: rawEntry.category || "",
    size,
    sizeBytes,
    totalEpisodes: animeContext.totalEpisodes || 0,
    animeCandidates: animeContext.animeCandidates || [animeContext.name].filter(Boolean)
  });

  let pubTimeMs = Number(rawEntry.pubTimeMs) || 0;
  if (!pubTimeMs && rawEntry.pubDate) {
    pubTimeMs = Date.parse(String(rawEntry.pubDate).replace(/\//g, "-")) || 0;
  }

  const fullItem = {
    title,
    link: rawEntry.link || (infoHash ? `${baseUrl.replace(/\/+$/, "")}/show-${infoHash}.html` : ""),
    author: rawEntry.author || "",
    category: rawEntry.category || "",
    size,
    sizeBytes,
    pubDate: rawEntry.pubDate || "",
    pubTimeMs,
    infoHash,
    magnetUrl,
    torrentUrl,
    mikanRssUrl: rawEntry.mikanRssUrl || "",
    verifiedSubjectId: rawEntry.verifiedSubjectId || "",
    sourceSite: rawEntry.sourceSite || "comicat",
    ...meta
  };

  const rel = classifyResourceForAnime(fullItem, animeContext);
  fullItem.isNonVideoNoise = rel.isNonVideoNoise;
  fullItem.isDerivedOrOtherSeason = rel.isDerivedOrOtherSeason;
  return fullItem;
}

/**
 * 将条目集合聚类为「版本流 (streams)」与「字幕组汇总列表 (subgroups)」，
 * 默认采用「各字幕组最优主力流轮询置顶」策略，确保前 12 张卡片覆盖最多不同字幕组而非被单一组多分辨率霸屏
 */
function buildStreamsAndSubgroupsFromItems(items, baseUrl = DEFAULT_COMICAT_BASE_URL, totalEpisodesHint = 0) {
  const streamsMap = new Map();
  for (const itemObj of Array.isArray(items) ? items : []) {
    if (!itemObj || itemObj.isNonVideoNoise) continue;
    if (!streamsMap.has(itemObj.streamId)) {
      streamsMap.set(itemObj.streamId, {
        streamId: itemObj.streamId,
        group: itemObj.group,
        platform: itemObj.platform,
        mediaSource: itemObj.mediaSource || "",
        lang: itemObj.lang,
        langBucket: itemObj.langBucket || "",
        format: itemObj.format,
        resolution: itemObj.resolution,
        recommendedKeyword: itemObj.recommendedKeyword,
        fallbackKeyword: itemObj.fallbackKeyword || itemObj.recommendedKeyword,
        mikanRssUrl: itemObj.mikanRssUrl || "",
        searchUrl: buildComicatSearchUrl(itemObj.recommendedKeyword, baseUrl),
        rssUrl: buildComicatRssUrl(itemObj.recommendedKeyword, baseUrl),
        rawItems: []
      });
    }
    const st = streamsMap.get(itemObj.streamId);
    st.rawItems.push(itemObj);
    if (!st.mikanRssUrl && itemObj.mikanRssUrl) {
      st.mikanRssUrl = itemObj.mikanRssUrl;
    }
  }

  const scoreStreamQuality = (st) => {
    let score = 0;
    const epCnt = st.episodeCount || 0;
    const packCnt = st.packCount || 0;
    score += epCnt * 120;
    if (totalEpisodesHint > 1 && epCnt >= totalEpisodesHint) score += 600;
    if (st.minEp === 1) score += 260;
    if (packCnt > 0) score += 320 + Math.min(packCnt, 4) * 40;
    if (st.unnumberedCount > 0 && epCnt === 0 && packCnt === 0) score += 140;

    if (st.resolution === "1080P") score += 180;
    else if (st.resolution === "2160P") score += 165;
    else if (st.resolution === "720P") score -= 140;

    if (st.langBucket === "multi") score += 110;
    else if (st.langBucket === "chs") score += 95;
    else if (st.langBucket === "cht") score += 25;
    else if (st.langBucket === "raw") score -= 90;

    if (st.group === "其他发布源") score -= 250;
    return score;
  };

  const allStreams = Array.from(streamsMap.values()).map((st) => {
    const dedup = deduplicateEpisodeItems(st.rawItems);
    const enriched = {
      ...st,
      dedup,
      probedDedup: dedup,
      exactCountVerified: true,
      episodeCount: dedup.episodes.length,
      packCount: dedup.packs.length,
      unnumberedCount: dedup.unnumbered.length,
      minEp: dedup.minEp,
      maxEp: dedup.maxEp,
      totalRawCount: st.rawItems.length,
      latestPubMs: st.rawItems.reduce((mx, r) => Math.max(mx, r.pubTimeMs || 0), 0)
    };
    enriched._qualityScore = scoreStreamQuality(enriched);
    return enriched;
  });

  // 按字幕组分桶，组内按质量分降序排列
  const byGroup = new Map();
  for (const st of allStreams) {
    if (!byGroup.has(st.group)) byGroup.set(st.group, []);
    byGroup.get(st.group).push(st);
  }
  for (const gList of byGroup.values()) {
    gList.sort((a, b) => {
      if (b._qualityScore !== a._qualityScore) return b._qualityScore - a._qualityScore;
      return (b.latestPubMs || 0) - (a.latestPubMs || 0);
    });
  }

  const subgroups = Array.from(byGroup.entries())
    .map(([groupName, gStreams]) => {
      const best = gStreams[0];
      const maxEpCnt = gStreams.reduce((mx, s) => Math.max(mx, s.episodeCount), 0);
      const totalPacks = gStreams.reduce((sum, s) => sum + s.packCount, 0);
      const totalItems = gStreams.reduce((sum, s) => sum + s.totalRawCount, 0);
      return {
        group: groupName,
        streamCount: gStreams.length,
        bestStreamId: best.streamId,
        bestQualityScore: best._qualityScore,
        maxEpisodeCount: maxEpCnt,
        packCount: totalPacks,
        totalItemCount: totalItems,
        latestPubMs: best.latestPubMs || 0
      };
    })
    .sort((a, b) => {
      if (b.bestQualityScore !== a.bestQualityScore) return b.bestQualityScore - a.bestQualityScore;
      return b.latestPubMs - a.latestPubMs;
    });

  // 轮询交错排布（Round-Robin）：第 1 轮放每个字幕组的最优流，第 2+ 轮放其余分辨率/繁简变体
  const interleavedStreams = [];
  let round = 0;
  let addedInRound = true;
  while (addedInRound) {
    addedInRound = false;
    for (const sg of subgroups) {
      const gStreams = byGroup.get(sg.group);
      if (gStreams && round < gStreams.length) {
        interleavedStreams.push(gStreams[round]);
        addedInRound = true;
      }
    }
    round++;
  }

  return {
    streams: interleavedStreams,
    subgroups
  };
}

/**
 * 解析完整 RSS XML 文本（兼容漫猫 comicat.org、爱恋 kisssub.org、蜜柑计划 mikanani.me 与动漫花园 dmhy.org）
 */
function parseComicatRssXml(xmlText, animeName = "", baseUrl = DEFAULT_COMICAT_BASE_URL, animeContext = null) {
  const rawItems = String(xmlText || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  const parsedItems = [];
  const ctx = animeContext || { name: animeName, disableSeasonIsolation: true };

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
    const category = decodeXmlEntities(
      (block.match(/<category[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/category>/i) ||
        block.match(/<category[^>]*>([\s\S]*?)<\/category>/i) ||
        [])[1] || ""
    ).trim();
    const pubDate = decodeXmlEntities(
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || ""
    ).trim();
    const enclosureTag = (block.match(/<enclosure[^>]*>/i) || [])[0] || "";
    const enclosureUrl = decodeXmlEntities(
      (enclosureTag.match(/url=["']([^"']+)["']/i) || [])[1] || ""
    ).trim();
    const enclosureLen = (enclosureTag.match(/length=["'](\d+)["']/i) || [])[1] || "";
    const contentLengthTag = (block.match(/<contentLength>(\d+)<\/contentLength>/i) || [])[1] || "";

    const rawHashMatch =
      link.match(/show-([a-fA-F0-9]{40})\.html/i) ||
      link.match(/\/Episode\/([a-fA-F0-9]{40})/i) ||
      enclosureUrl.match(/hash=([a-fA-F0-9]{40})/i) ||
      enclosureUrl.match(/\/([a-fA-F0-9]{40})\.torrent/i) ||
      enclosureUrl.match(/btih:([A-Za-z0-9]{32,40})/i);
    const infoHash = rawHashMatch ? normalizeBtihToHex(rawHashMatch[1]) : "";
    const rawBytes = Number(contentLengthTag || (Number(enclosureLen) > 1024 ? enclosureLen : 0)) || 0;

    const itemObj = finalizeNormalizedTorrentItem(
      {
        title,
        link,
        author,
        category,
        sizeBytes: rawBytes,
        pubDate,
        infoHash,
        magnetUrl: enclosureUrl.startsWith("magnet:?") ? enclosureUrl : "",
        torrentUrl: !enclosureUrl.startsWith("magnet:?") ? enclosureUrl : "",
        sourceSite: /dmhy\.org/i.test(link || enclosureUrl)
          ? "dmhy"
          : /mikan/i.test(link || enclosureUrl)
          ? "mikan-rss"
          : "comicat-rss"
      },
      ctx,
      baseUrl
    );
    if (itemObj && !itemObj.isNonVideoNoise) {
      parsedItems.push(itemObj);
    }
  }

  const built = buildStreamsAndSubgroupsFromItems(parsedItems, baseUrl, Number(ctx.totalEpisodes) || 0);
  return {
    items: parsedItems,
    streams: built.streams,
    subgroups: built.subgroups
  };
}

/**
 * 解析漫猫 / 爱恋 (MioBT) 搜索结果网页 HTML，提取总条数、总页数与当页全部 50 条资源（含大小、类别、UP主、Hash）
 */
function parseMioBtSearchHtml(html, originBaseUrl = DEFAULT_COMICAT_BASE_URL) {
  const text = String(html || "");
  const isVisitorChallenge = /id=["']visitor-test-form["']/i.test(text) && !/id=["']data_list["']/i.test(text);
  if (isVisitorChallenge) {
    return { isVisitorChallenge: true, totalMatches: 0, maxPage: 0, rawRows: [] };
  }

  const countMatch = text.match(/共找到\s*(\d+)\s*条匹配资源/);
  const totalMatches = countMatch ? Number(countMatch[1]) : 0;
  const decodedHrefText = text.replace(/&amp;/gi, "&");
  const pageNums = [...decodedHrefText.matchAll(/[?&]page=(\d+)/gi)].map((m) => Number(m[1]));
  const maxPage =
    totalMatches > 0
      ? Math.max(Math.ceil(totalMatches / 50), ...(pageNums.length > 0 ? pageNums : [1]))
      : 0;

  const tbodyMatch = text.match(/<tbody[^>]*id=["']data_list["'][^>]*>([\s\S]*?)<\/tbody>/i);
  const rowsHtml = tbodyMatch ? tbodyMatch[1] : "";
  const trBlocks = rowsHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const cleanOrigin = String(originBaseUrl || DEFAULT_COMICAT_BASE_URL).replace(/\/+$/, "");
  const rawRows = [];

  for (const tr of trBlocks) {
    const tds = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 4) continue;
    const pubDate = stripHtmlTagsClean(tds[0]);
    const category = stripHtmlTagsClean(tds[1]);
    const showMatch = tds[2].match(/href=["'](?:\/)?(show-([a-fA-F0-9]{40})\.html)["']/i);
    const title = stripHtmlTagsClean(tds[2]);
    const size = stripHtmlTagsClean(tds[3]);
    const author = tds[4] ? stripHtmlTagsClean(tds[4]) : "";
    if (!title) continue;
    const infoHash = showMatch ? showMatch[2].toLowerCase() : "";
    rawRows.push({
      title,
      author,
      category,
      size,
      pubDate,
      infoHash,
      link: showMatch ? `${cleanOrigin}/${showMatch[1]}` : "",
      sourceSite: /kisssub/i.test(cleanOrigin) ? "kisssub" : "comicat"
    });
  }

  return {
    isVisitorChallenge: false,
    totalMatches,
    maxPage,
    rawRows
  };
}

/**
 * 请求单页 MioBT 搜索 HTML（自动携带 `visitor_test=human` Cookie，兼容移动端原生 CookieJar 握手与爱恋同库镜像无缝切换）
 */
async function fetchMioBtSearchPage(keyword, page = 1, preferredBaseUrl = DEFAULT_COMICAT_BASE_URL, timeoutMs = 7000) {
  const normPref = String(preferredBaseUrl || DEFAULT_COMICAT_BASE_URL).replace(/\/+$/, "");
  const httpsPref = normPref.replace(/^http:\/\//i, "https://");
  const origins = [httpsPref];
  if (normPref !== httpsPref) origins.push(normPref);
  if (!/kisssub\.org/i.test(normPref)) {
    origins.push(KISSSUB_MIRROR_BASE_URL);
  }

  let lastErr = null;
  for (const origin of origins) {
    let host = "";
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch (_) {}
    if (host && (_mioBtHostCooldownUntil.get(host) || 0) > Date.now()) {
      continue;
    }

    const cookieVal = _mioBtVisitorCookies.get(origin) || "visitor_test=human";
    const pageUrl = buildComicatSearchUrl(keyword, origin, page);
    try {
      let resp = await requestTextCrossPlatform(pageUrl, {
        timeoutMs,
        headers: { Cookie: cookieVal }
      });

      if (resp.status === 429) {
        if (host) _mioBtHostCooldownUntil.set(host, Date.now() + 8 * 60 * 1000);
        lastErr = new Error("漫猫短时请求过快 (429)");
        continue;
      }
      if (resp.status < 200 || resp.status >= 400 || !resp.text) {
        lastErr = new Error(`HTTP ${resp.status || 0}`);
        continue;
      }

      let parsed = parseMioBtSearchHtml(resp.text, origin);
      // 若移动端/特殊环境下自定义 Cookie 头被宿主忽略并触发了访客校验表单，自动执行一次原生 POST 握手激活系统 CookieJar
      if (parsed.isVisitorChallenge) {
        try {
          const postResp = await requestTextCrossPlatform(
            `${origin}/addon.php?r=document/view&page=visitor-test`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: cookieVal
              },
              body: "visitor_test=human",
              timeoutMs: 5500
            }
          );
          const setCookieRaw = postResp?.headers?.["set-cookie"] || postResp?.headers?.["Set-Cookie"] || "";
          if (setCookieRaw) {
            const cookiePairs = (Array.isArray(setCookieRaw) ? setCookieRaw : [String(setCookieRaw)])
              .map((c) => String(c).split(";")[0].trim())
              .filter((kv) => kv && !kv.endsWith("=deleted"));
            if (cookiePairs.length > 0) {
              _mioBtVisitorCookies.set(origin, cookiePairs.join("; "));
            }
          }
          resp = await requestTextCrossPlatform(pageUrl, {
            timeoutMs,
            headers: { Cookie: _mioBtVisitorCookies.get(origin) || "visitor_test=human" }
          });
          if (resp.status >= 200 && resp.status < 400 && resp.text) {
            parsed = parseMioBtSearchHtml(resp.text, origin);
          }
        } catch (_) {}
      }

      if (!parsed.isVisitorChallenge && (parsed.rawRows.length > 0 || /没有找到匹配资源|共找到\s*0\s*条/.test(resp.text))) {
        return {
          ok: true,
          originUsed: origin,
          totalMatches: parsed.totalMatches,
          maxPage: parsed.maxPage,
          rawRows: parsed.rawRows
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  return {
    ok: false,
    originUsed: "",
    totalMatches: 0,
    maxPage: 0,
    rawRows: [],
    error: lastErr ? lastErr.message : "MioBT 搜索页暂不可用"
  };
}

/**
 * 解析蜜柑计划 `/Home/Bangumi/<id>` 专属作品页，提取 bgm.tv/subject/<id> 精确哈希背书、全部字幕组与有效 .torrent 地址
 */
function parseMikanSubjectPageHtml(html) {
  const text = String(html || "");
  const bgmMatch = text.match(/bgm\.tv\/subject\/(\d+)/i) || text.match(/bangumi\.tv\/subject\/(\d+)/i);
  const bgmSubjectId = bgmMatch ? bgmMatch[1] : "";
  const rawRows = [];

  const parts = text.split(/<div\s+class=["']subgroup-text["']/i);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const sgNameMatch =
      seg.match(/<a\s+href=["']\/Home\/PublishGroup\/\d+["'][^>]*>([\s\S]*?)<\/a>/i) ||
      seg.match(/<a[^>]+style=["'][^"']*color[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const sgName = sgNameMatch ? stripHtmlTagsClean(sgNameMatch[1]) : "";
    const sgRssMatch = seg.match(/href=["'](\/RSS\/Bangumi\?bangumiId=\d+&(?:amp;)?subgroupid=\d+)["']/i);
    const sgRssUrl = sgRssMatch ? `${MIKAN_BASE_URL}${sgRssMatch[1].replace(/&amp;/g, "&")}` : "";

    const tbodyMatch = seg.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) continue;
    const trs = tbodyMatch[1].match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const tds = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (tds.length < 5) continue;
      const epLinkMatch = tds[1].match(/href=["']\/Home\/Episode\/([a-fA-F0-9]{40})["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!epLinkMatch) continue;
      const infoHash = epLinkMatch[1].toLowerCase();
      const title = stripHtmlTagsClean(epLinkMatch[2]);
      if (!title) continue;
      const size = stripHtmlTagsClean(tds[2]);
      const pubDate = stripHtmlTagsClean(tds[3]);
      const torMatch = tds[4].match(/href=["'](\/Download\/[^"']+\.torrent)["']/i);
      rawRows.push({
        title,
        author: sgName,
        mikanSubgroup: sgName,
        mikanRssUrl: sgRssUrl,
        category: "动画",
        size,
        pubDate,
        infoHash,
        link: `${MIKAN_BASE_URL}/Home/Episode/${infoHash}`,
        torrentUrl: torMatch ? `${MIKAN_BASE_URL}${torMatch[1]}` : "",
        verifiedSubjectId: bgmSubjectId,
        sourceSite: "mikan-subject"
      });
    }
  }

  return { bgmSubjectId, rawRows };
}

async function fetchMikanSubjectVerifiedRows(
  searchKeyword,
  targetSubjectId,
  targetAnimeName = "",
  timeoutMs = 5200,
  fallbackJapaneseName = ""
) {
  const tryQueries = [String(searchKeyword || "").trim()];
  const cleanJp = String(fallbackJapaneseName || "").trim();
  if (cleanJp && !tryQueries.includes(cleanJp)) {
    tryQueries.push(cleanJp);
  }

  for (const qKw of tryQueries) {
    if (!qKw) continue;
    try {
      const searchResp = await requestTextCrossPlatform(
        `${MIKAN_BASE_URL}/Home/Search?searchstr=${encodeURIComponent(qKw)}`,
        { timeoutMs }
      );
      if (!searchResp || searchResp.status < 200 || searchResp.status >= 400 || !searchResp.text) {
        continue;
      }

      // 使用不跨越 </li> 的单卡片匹配，避免顶部导航栏 <li> 吞并首个番剧卡片
      const cardBlocks =
        searchResp.text.match(/<li\b(?:(?!<\/li>)[\s\S])*?\/Home\/Bangumi\/\d+(?:(?!<\/li>)[\s\S])*?<\/li>/gi) || [];
      const candidates = [];
      const seenIds = new Set();
      const normTarget = compactTitleForMatch(targetAnimeName || searchKeyword || qKw).replace(/の/g, "之");
      const normJp = cleanJp ? compactTitleForMatch(cleanJp).replace(/の/g, "之") : "";

      for (const li of cardBlocks) {
        const idMatch = li.match(/\/Home\/Bangumi\/(\d+)/i);
        if (!idMatch || seenIds.has(idMatch[1])) continue;
        seenIds.add(idMatch[1]);
        const titleAttr =
          (li.match(/class=["']an-text["'][^>]*title=["']([^"']+)["']/i) ||
            li.match(/title=["']([^"']+)["']/i) ||
            [])[1] || "";
        const fallbackText =
          (li.match(/class=["']an-text["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
        const cleanCardTitle = decodeXmlEntities(titleAttr || stripHtmlTagsClean(fallbackText)).trim();
        const normCard = compactTitleForMatch(cleanCardTitle).replace(/の/g, "之");
        let rank = 10;
        if (normCard && (normCard === normTarget || (normJp && normCard === normJp))) rank = 0;
        else if (normCard && (normCard.includes(normTarget) || normTarget.includes(normCard))) rank = 3;
        candidates.push({ mikanId: idMatch[1], cardTitle: cleanCardTitle, rank });
      }
      if (candidates.length === 0) {
        for (const m of searchResp.text.matchAll(/\/Home\/Bangumi\/(\d+)/gi)) {
          if (!seenIds.has(m[1])) {
            seenIds.add(m[1]);
            candidates.push({ mikanId: m[1], cardTitle: "", rank: 5 });
          }
        }
      }
      candidates.sort((a, b) => a.rank - b.rank);

      const checkLimit = targetSubjectId ? Math.min(candidates.length, 4) : Math.min(candidates.length, 1);
      for (let i = 0; i < checkLimit; i++) {
        const cand = candidates[i];
        if (!targetSubjectId && cand.rank > 0) continue;
        const pageResp = await requestTextCrossPlatform(`${MIKAN_BASE_URL}/Home/Bangumi/${cand.mikanId}`, {
          timeoutMs
        }).catch(() => null);
        if (!pageResp || pageResp.status < 200 || pageResp.status >= 400 || !pageResp.text) continue;
        const parsed = parseMikanSubjectPageHtml(pageResp.text);
        if (targetSubjectId && parsed.bgmSubjectId === String(targetSubjectId)) {
          const verifiedHashes = new Set(parsed.rawRows.map((r) => r.infoHash).filter(Boolean));
          return { verifiedHashes, rawRows: parsed.rawRows, mikanId: cand.mikanId };
        }
        if (!targetSubjectId && cand.rank === 0 && parsed.rawRows.length > 0) {
          const verifiedHashes = new Set(parsed.rawRows.map((r) => r.infoHash).filter(Boolean));
          return { verifiedHashes, rawRows: parsed.rawRows, mikanId: cand.mikanId };
        }
      }
    } catch (_) {}
  }
  return { verifiedHashes: new Set(), rawRows: [] };
}

function isInvalidAnimeAlias(rawAlias) {
  const s = String(rawAlias || "").trim();
  if (!s) return true;
  if (/^(?:ACG|TV|OVA|OAD|SP|BD|MOV|MOVIE|动画|新番|未知|无|\d+)$/i.test(s)) return true;
  if (/^[\x00-\x7F]+$/.test(s) && s.replace(/[^a-zA-Z0-9]/g, "").length < 4) return true;
  return s.length < 2;
}

/**
 * 从 Bangumi v0 Subject API 静默读取作品常用别名（如《莉可丽丝》-> Lycoris Recoil / 铳动彼岸花，《少女乐队的呐喊》-> GIRLS BAND CRY）
 */
async function fetchBgmSubjectAliasesCached(plugin, subjectId, timeoutMs = 3400) {
  const cleanId = String(subjectId || "").trim();
  if (!/^\d+$/.test(cleanId)) return [];
  if (_bgmSubjectAliasesMemCache.has(cleanId)) {
    return _bgmSubjectAliasesMemCache.get(cleanId);
  }
  if (plugin?._bgmSubjectAliasesCache && Array.isArray(plugin._bgmSubjectAliasesCache[cleanId])) {
    _bgmSubjectAliasesMemCache.set(cleanId, plugin._bgmSubjectAliasesCache[cleanId]);
    return plugin._bgmSubjectAliasesCache[cleanId];
  }

  try {
    const resp = await requestTextCrossPlatform(`https://api.bgm.tv/v0/subjects/${encodeURIComponent(cleanId)}`, {
      timeoutMs,
      headers: {
        "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)",
        Accept: "application/json"
      }
    });
    if (resp && resp.status >= 200 && resp.status < 300 && resp.text) {
      const data = JSON.parse(resp.text);
      const aliases = [];
      const addAlias = (v) => {
        const clean = String(v || "").trim();
        if (clean && !isInvalidAnimeAlias(clean) && !aliases.includes(clean)) {
          aliases.push(clean);
        }
      };
      if (data.name_cn) addAlias(data.name_cn);
      if (data.name) addAlias(data.name);
      for (const entry of Array.isArray(data.infobox) ? data.infobox : []) {
        if (!entry || entry.key !== "别名") continue;
        if (Array.isArray(entry.value)) {
          for (const item of entry.value) {
            addAlias(item && typeof item === "object" ? item.v : item);
          }
        } else {
          addAlias(entry.value);
        }
      }
      _bgmSubjectAliasesMemCache.set(cleanId, aliases);
      if (plugin) {
        plugin._bgmSubjectAliasesCache = plugin._bgmSubjectAliasesCache || {};
        plugin._bgmSubjectAliasesCache[cleanId] = aliases;
      }
      return aliases;
    }
  } catch (_) {}
  return [];
}

function mergeNormalizedTorrentItem(targetMap, newItem) {
  if (!newItem || !newItem.title) return;
  const key = newItem.infoHash || `${newItem.title.toLowerCase()}__${newItem.pubDate || ""}`;
  if (!targetMap.has(key)) {
    targetMap.set(key, newItem);
    return;
  }
  const existing = targetMap.get(key);
  if (!existing.size && newItem.size) {
    existing.size = newItem.size;
    existing.sizeBytes = newItem.sizeBytes;
  }
  if ((!existing.torrentUrl || existing.torrentUrl.includes("itorrents.org")) && newItem.torrentUrl && !newItem.torrentUrl.includes("itorrents.org")) {
    existing.torrentUrl = newItem.torrentUrl;
  }
  if (!existing.mikanRssUrl && newItem.mikanRssUrl) {
    existing.mikanRssUrl = newItem.mikanRssUrl;
  }
  if (!existing.verifiedSubjectId && newItem.verifiedSubjectId) {
    existing.verifiedSubjectId = newItem.verifiedSubjectId;
    existing.isDerivedOrOtherSeason = false;
  }
  if (existing.sourceSite !== "comicat" && newItem.sourceSite === "comicat" && newItem.link) {
    existing.link = newItem.link;
  }
}

function buildDatasetOutputFromMergedMap(mergedMap, metaInfo, baseUrl, totalEpisodesHint = 0) {
  const allItems = Array.from(mergedMap.values()).filter((it) => !it.isNonVideoNoise);
  allItems.sort((a, b) => (b.pubTimeMs || 0) - (a.pubTimeMs || 0));

  const primaryItems = allItems.filter((it) => !it.isDerivedOrOtherSeason);
  const derivedItems = allItems.filter((it) => it.isDerivedOrOtherSeason);

  // 安全阀：若某部特殊番剧因元数据年份偏差导致主集合为空，自动回退展示全部有效视频条目，绝不误报空页
  const effectivePrimary = primaryItems.length > 0 ? primaryItems : allItems;
  const effectiveDerived = primaryItems.length > 0 ? derivedItems : [];

  const primaryBuilt = buildStreamsAndSubgroupsFromItems(effectivePrimary, baseUrl, totalEpisodesHint);
  const withDerivedBuilt =
    effectiveDerived.length > 0
      ? buildStreamsAndSubgroupsFromItems(allItems, baseUrl, totalEpisodesHint)
      : primaryBuilt;

  return {
    ...metaInfo,
    allItems,
    primaryItems: effectivePrimary,
    derivedItems: effectiveDerived,
    streams: primaryBuilt.streams,
    subgroups: primaryBuilt.subgroups,
    allStreamsWithDerived: withDerivedBuilt.streams,
    allSubgroupsWithDerived: withDerivedBuilt.subgroups
  };
}

/**
 * 多页漫猫检索 + 爱恋同库镜像防限流 + 蜜柑计划 Subject 精确哈希背书 + 动漫花园单页全量聚合引擎：
 * - 彻底解决漫猫单页 RSS 50 条截断导致早期字幕组（如《莉可丽丝》中的喵萌奶茶屋、爱恋&漫猫、爪爪、悠哈璃羽等）丢失的问题；
 * - 自动融合英文/异译名发布组（如 LoliHouse、SweetSub&VCB-Studio、GIRLS BAND CRY、颂乐人偶）；
 * - 严控单域名请求频次并内置 20 分钟内存缓存，杜绝移动端卡顿与 429 触发。
 */
async function fetchFederatedAnimeSearchDataset(plugin, item, keyword, opts = {}) {
  const baseUrl = opts.baseUrl || normalizeComicatBaseUrl(plugin);
  const isMobile = Boolean(opts.isMobile);
  const cleanKw = String(keyword || "").trim();
  const rawAnimeName = String(item?.name || "").trim();
  const subjectId = String(item?.subjectId || (String(item?.bgmUrl || "").match(/subject\/(\d+)/i) || [])[1] || "").trim();
  const targetYear = Number(item?.year) || 0;
  const totalEpisodes = Number(item?.totalEpisodes) || 0;

  // 判断当前是否为搜番剧本身的宽泛检索（而非用户手动附加了 [字幕组]/1080p 等精准过滤词）
  const normKwLower = cleanKw.toLowerCase();
  const isBroadAnimeSearch =
    !opts.forceExactQuery &&
    (cleanKw === rawAnimeName ||
      (item?.japaneseName && cleanKw === String(item.japaneseName).trim()));

  const allowNonVideo = /\b(?:OST|FLAC|MP3|Hi-?Res|音乐|画集|漫画)\b/i.test(cleanKw);
  const cacheKey = `${baseUrl}|${isMobile ? "m" : "d"}|${subjectId}|${normKwLower}`;
  if (!opts.bypassCache && _federatedSearchResultCache.has(cacheKey)) {
    const cached = _federatedSearchResultCache.get(cacheKey);
    if (Date.now() - cached.timestamp < FEDERATED_CACHE_TTL_MS) {
      return cached.data;
    }
    _federatedSearchResultCache.delete(cacheKey);
  }

  // 1. 解析 Bangumi 别名候选词（仅宽泛搜索时拉取，带内存缓存）
  const bgmAliases = isBroadAnimeSearch && subjectId
    ? await fetchBgmSubjectAliasesCached(plugin, subjectId, isMobile ? 2800 : 3500)
    : [];

  const animeCandidates = [];
  const pushCand = (s) => {
    const c = String(s || "").trim();
    if (c && !isInvalidAnimeAlias(c) && !animeCandidates.includes(c)) animeCandidates.push(c);
  };
  pushCand(rawAnimeName);
  pushCand(cleanKw);
  for (const a of bgmAliases) pushCand(a);
  if (item?.japaneseName) pushCand(item.japaneseName);

  const mioPrimaryKw = isBroadAnimeSearch
    ? cleanKw.replace(/^[【\[]|[】\]]$/g, "").trim() || cleanKw
    : cleanKw;
  const parentSeasonKw = isBroadAnimeSearch
    ? mioPrimaryKw.replace(/\s+(?:反击篇|袭击篇|前篇|后篇|上半季?|下半季?|后半部分|前半部分)$/i, "").trim()
    : mioPrimaryKw;

  // 2. 并行启动三路互补源（MioBT 第 1 页 + 蜜柑 Subject/RSS + 动漫花园单次全量 RSS）
  const autoPageBudget = isMobile ? 3 : 6;
  const [mioP1Res, mikanSubjectRes, dmhyMainXml, mikanRssXml] = await Promise.all([
    fetchMioBtSearchPage(mioPrimaryKw, 1, baseUrl, isMobile ? 6000 : 7000),
    isBroadAnimeSearch
      ? fetchMikanSubjectVerifiedRows(
          mioPrimaryKw,
          subjectId,
          rawAnimeName,
          isMobile ? 4800 : 5600,
          item?.japaneseName || ""
        )
      : Promise.resolve({ verifiedHashes: new Set(), rawRows: [] }),
    requestTextCrossPlatform(`${DMHY_RSS_SEARCH_URL}?keyword=${encodeURIComponent(mioPrimaryKw)}`, {
      timeoutMs: isMobile ? 5200 : 6200
    })
      .then((r) => (r.status >= 200 && r.status < 300 ? r.text : ""))
      .catch(() => ""),
    requestTextCrossPlatform(`${MIKAN_BASE_URL}/RSS/Search?searchstr=${encodeURIComponent(mioPrimaryKw)}`, {
      timeoutMs: isMobile ? 4500 : 5500
    })
      .then((r) => (r.status >= 200 && r.status < 300 ? r.text : ""))
      .catch(() => "")
  ]);

  let mioOriginUsed = mioP1Res.originUsed || baseUrl;
  let mioTotalMatches = mioP1Res.totalMatches || 0;
  let mioMaxPage = mioP1Res.maxPage || 0;
  const mioFetchedPageSet = new Set(mioP1Res.ok ? [1] : []);
  const collectedMioRows = [...(mioP1Res.rawRows || [])];
  let effectiveMioQuery = mioPrimaryKw;

  // 若标题含“反击篇/后半部分”等篇章后缀导致仅搜出极少条目，自动回退检索主季标题
  if (
    isBroadAnimeSearch &&
    collectedMioRows.length < 8 &&
    parentSeasonKw &&
    parentSeasonKw !== mioPrimaryKw
  ) {
    effectiveMioQuery = parentSeasonKw;
    const [fbMioP1, fbDmhyXml] = await Promise.all([
      fetchMioBtSearchPage(parentSeasonKw, 1, mioOriginUsed, 6000),
      requestTextCrossPlatform(`${DMHY_RSS_SEARCH_URL}?keyword=${encodeURIComponent(parentSeasonKw)}`, {
        timeoutMs: 5500
      })
        .then((r) => (r.status >= 200 && r.status < 300 ? r.text : ""))
        .catch(() => "")
    ]);
    if (fbMioP1.ok && fbMioP1.rawRows.length > collectedMioRows.length) {
      mioOriginUsed = fbMioP1.originUsed || mioOriginUsed;
      mioTotalMatches = fbMioP1.totalMatches;
      mioMaxPage = fbMioP1.maxPage;
      mioFetchedPageSet.clear();
      mioFetchedPageSet.add(1);
      collectedMioRows.push(...fbMioP1.rawRows);
    }
    if (fbDmhyXml) {
      collectedMioRows._extraDmhyXml = fbDmhyXml;
    }
  }

  // 3. 温和拉取漫猫/爱恋后续分页（桌面端自动读前 6 页、手机端自动读前 3 页，双并发 + 180ms 节流防 429）
  if (mioP1Res.ok && mioMaxPage > 1) {
    const targetPages = [];
    const cap = Math.min(mioMaxPage, autoPageBudget);
    for (let p = 2; p <= cap; p++) targetPages.push(p);

    for (let i = 0; i < targetPages.length; i += 2) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 180));
      }
      const batch = targetPages.slice(i, i + 2);
      const batchRes = await Promise.all(
        batch.map((p) => fetchMioBtSearchPage(effectiveMioQuery, p, mioOriginUsed, isMobile ? 5500 : 6500))
      );
      for (let idx = 0; idx < batchRes.length; idx++) {
        const r = batchRes[idx];
        if (r.ok) {
          mioFetchedPageSet.add(batch[idx]);
          if (r.originUsed) mioOriginUsed = r.originUsed;
          collectedMioRows.push(...r.rawRows);
        }
      }
    }

    // 若为多季长青番的第一季（如 2019《鬼灭之刃》被后续多季挤到较后页码），自动补抓末尾最早 2 页以找回首播当年单集
    if (
      isBroadAnimeSearch &&
      !isMobile &&
      mioMaxPage > cap &&
      targetYear >= 2000 &&
      targetYear <= new Date().getFullYear() - 2
    ) {
      const eraHitsSoFar = collectedMioRows.filter((r) => {
        const y = Date.parse(String(r.pubDate || "").replace(/\//g, "-"));
        const yr = y > 0 ? new Date(y).getFullYear() : 0;
        return yr > 0 && yr <= targetYear + 1;
      }).length;
      if (eraHitsSoFar < 10) {
        const tailPages = [Math.max(cap + 1, mioMaxPage - 1), mioMaxPage].filter(
          (p, idx, arr) => p > cap && arr.indexOf(p) === idx && !mioFetchedPageSet.has(p)
        );
        if (tailPages.length > 0) {
          await new Promise((r) => setTimeout(r, 180));
          const tailRes = await Promise.all(
            tailPages.map((p) => fetchMioBtSearchPage(effectiveMioQuery, p, mioOriginUsed, 6500))
          );
          for (let idx = 0; idx < tailRes.length; idx++) {
            const r = tailRes[idx];
            if (r.ok) {
              mioFetchedPageSet.add(tailPages[idx]);
              collectedMioRows.push(...r.rawRows);
            }
          }
        }
      }
    }
  }

  // 4. 若宽泛搜索命中了高价值英文/异译名（如 Lycoris Recoil / GIRLS BAND CRY / 颂乐人偶），补充一次轻量动漫花园别名 RSS
  let aliasDmhyXml = "";
  if (isBroadAnimeSearch && bgmAliases.length > 0) {
    const latinOrAltAlias = bgmAliases.find((a) => {
      if (a === rawAnimeName || a === mioPrimaryKw) return false;
      if (/^[A-Za-z0-9\s:'\-!?.]+$/.test(a) && a.length >= 5) return true;
      return collectedMioRows.length < 25 && /[\u4e00-\u9fff]/.test(a) && !/[\u3040-\u30ff]/.test(a);
    });
    if (latinOrAltAlias) {
      aliasDmhyXml = await requestTextCrossPlatform(
        `${DMHY_RSS_SEARCH_URL}?keyword=${encodeURIComponent(latinOrAltAlias)}`,
        { timeoutMs: isMobile ? 4500 : 5200 }
      )
        .then((r) => (r.status >= 200 && r.status < 300 ? r.text : ""))
        .catch(() => "");
    }
  }

  // 5. 若上述 HTML 通道全部因极端网络受阻，终极回退至经典 RSS XML 接口确保零故障
  let fallbackComicatRssXml = "";
  if (
    collectedMioRows.length === 0 &&
    mikanSubjectRes.rawRows.length === 0 &&
    !dmhyMainXml &&
    !mikanRssXml
  ) {
    fallbackComicatRssXml = await fetchComicatRssXml(buildComicatRssUrl(cleanKw, baseUrl), 7500);
  }

  const animeContext = {
    name: rawAnimeName || cleanKw,
    japaneseName: item?.japaneseName || "",
    year: targetYear,
    totalEpisodes,
    subjectId,
    animeCandidates,
    mikanVerifiedHashes: mikanSubjectRes.verifiedHashes,
    allowNonVideo,
    disableSeasonIsolation: !isBroadAnimeSearch
  };

  const mergedMap = new Map();

  // 先合入 Mikan Subject 精确背书条目（自带有效 .torrent 下载链与精确字幕组名）
  for (const r of mikanSubjectRes.rawRows) {
    const norm = finalizeNormalizedTorrentItem(r, animeContext, baseUrl);
    mergeNormalizedTorrentItem(mergedMap, norm);
  }

  // 再合入漫猫 / 爱恋多页 HTML 条目（自带精确大小、类别与 show-<hash>.html 详情链接）
  for (const r of collectedMioRows) {
    const norm = finalizeNormalizedTorrentItem(r, animeContext, baseUrl);
    mergeNormalizedTorrentItem(mergedMap, norm);
  }

  // 再合入 DMHY / Mikan RSS 补充条目
  for (const xmlChunk of [dmhyMainXml, collectedMioRows._extraDmhyXml || "", aliasDmhyXml, mikanRssXml, fallbackComicatRssXml]) {
    if (!xmlChunk) continue;
    const rssParsed = parseComicatRssXml(xmlChunk, rawAnimeName || cleanKw, baseUrl, animeContext);
    for (const it of rssParsed.items) {
      mergeNormalizedTorrentItem(mergedMap, it);
    }
  }

  // 移动端内存保护：最多保留最新/最相关的 650 条去重记录
  if (isMobile && mergedMap.size > 650) {
    const trimmed = Array.from(mergedMap.entries()).slice(0, 650);
    mergedMap.clear();
    for (const [k, v] of trimmed) mergedMap.set(k, v);
  }

  const dataset = buildDatasetOutputFromMergedMap(
    mergedMap,
    {
      keyword: cleanKw,
      effectiveMioQuery,
      mioOriginUsed,
      mioTotalMatches,
      mioMaxPage,
      mioFetchedPages: Array.from(mioFetchedPageSet).sort((a, b) => a - b),
      bgmAliases,
      animeContext,
      _mergedMap: mergedMap
    },
    baseUrl,
    totalEpisodes
  );

  if (dataset.allItems.length > 0) {
    if (_federatedSearchResultCache.size >= FEDERATED_CACHE_MAX_ENTRIES) {
      const oldestKey = _federatedSearchResultCache.keys().next().value;
      if (oldestKey) _federatedSearchResultCache.delete(oldestKey);
    }
    _federatedSearchResultCache.set(cacheKey, {
      timestamp: Date.now(),
      data: dataset
    });
  }

  return dataset;
}

/**
 * 按需继续深挖漫猫 / 爱恋后续未读页码（每次温和加载最多 5 页，无缝并入当前数据集）
 */
async function loadMoreMioBtPagesIntoDataset(dataset, { pagesCount = 5, baseUrl = DEFAULT_COMICAT_BASE_URL, isMobile = false } = {}) {
  if (!dataset || !dataset.mioMaxPage) return dataset;
  const fetchedSet = new Set(dataset.mioFetchedPages || []);
  const nextPages = [];
  for (let p = 1; p <= dataset.mioMaxPage; p++) {
    if (!fetchedSet.has(p)) {
      nextPages.push(p);
      if (nextPages.length >= pagesCount) break;
    }
  }
  if (nextPages.length === 0) return dataset;

  const origin = dataset.mioOriginUsed || baseUrl;
  const query = dataset.effectiveMioQuery || dataset.keyword;
  for (let i = 0; i < nextPages.length; i += 2) {
    if (i > 0) await new Promise((r) => setTimeout(r, 180));
    const batch = nextPages.slice(i, i + 2);
    const results = await Promise.all(
      batch.map((p) => fetchMioBtSearchPage(query, p, origin, isMobile ? 5500 : 6800))
    );
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (r.ok) {
        fetchedSet.add(batch[idx]);
        if (r.originUsed) dataset.mioOriginUsed = r.originUsed;
        for (const row of r.rawRows) {
          const norm = finalizeNormalizedTorrentItem(row, dataset.animeContext, baseUrl);
          mergeNormalizedTorrentItem(dataset._mergedMap, norm);
        }
      }
    }
  }

  const rebuilt = buildDatasetOutputFromMergedMap(
    dataset._mergedMap,
    {
      keyword: dataset.keyword,
      effectiveMioQuery: dataset.effectiveMioQuery,
      mioOriginUsed: dataset.mioOriginUsed,
      mioTotalMatches: dataset.mioTotalMatches,
      mioMaxPage: dataset.mioMaxPage,
      mioFetchedPages: Array.from(fetchedSet).sort((a, b) => a - b),
      bgmAliases: dataset.bgmAliases,
      animeContext: dataset.animeContext,
      _mergedMap: dataset._mergedMap
    },
    baseUrl,
    Number(dataset.animeContext?.totalEpisodes) || 0
  );
  Object.assign(dataset, rebuilt);
  return dataset;
}

/**
 * 对同一发布源的条目执行「每集唯一性」核验与自动去重（优先保留 v2/v3 修正版、1080P+ 高画质与最新发布的条目）
 */
function deduplicateEpisodeItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byEpisode = new Map();
  const packs = [];
  const unnumbered = [];
  let duplicateReplacedCount = 0;

  const resRank = (r) => (r === "1080P" ? 3 : r === "2160P" ? 3 : r === "720P" ? 1 : 2);

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
      const vNew = item.version || 1;
      const vOld = existing.version || 1;
      const rNew = resRank(item.resolution);
      const rOld = resRank(existing.resolution);
      if (
        vNew > vOld ||
        (vNew === vOld && rNew > rOld) ||
        (vNew === vOld && rNew === rOld && (item.pubTimeMs || 0) > (existing.pubTimeMs || 0))
      ) {
        byEpisode.set(ep, item);
      }
    }
  }

  const episodes = Array.from(byEpisode.values()).sort((a, b) => b.episode - a.episode);
  packs.sort((a, b) => (b.pubTimeMs || 0) - (a.pubTimeMs || 0));
  unnumbered.sort((a, b) => (b.pubTimeMs || 0) - (a.pubTimeMs || 0));
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
 * 跨平台获取 qBittorrent 配置目录与 BT_backup 目录（兼容 Windows / macOS / Linux / Flatpak）
 */
function getQbittorrentConfigDirs() {
  if (!isDesktopNodeAvailable()) return [];
  const env = getSafeEnv();
  const home = getSafeHomeDir();
  const plat = typeof process !== "undefined" ? process.platform : "";
  const dirs = [];
  if (plat === "win32") {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "qBittorrent"));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "qBittorrent"));
  } else if (plat === "darwin" && home) {
    dirs.push(path.join(home, "Library", "Application Support", "qBittorrent"));
    dirs.push(path.join(home, ".config", "qBittorrent"));
  } else if (home) {
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
    const xdgData = env.XDG_DATA_HOME || path.join(home, ".local", "share");
    dirs.push(path.join(xdgConfig, "qBittorrent"));
    dirs.push(path.join(xdgData, "qBittorrent"));
    dirs.push(path.join(home, ".var", "app", "org.qbittorrent.qBittorrent", "config", "qBittorrent"));
    dirs.push(path.join(home, ".var", "app", "org.qbittorrent.qBittorrent", "data", "qBittorrent"));
  }
  return Array.from(new Set(dirs.filter(Boolean)));
}

function getQbittorrentBtBackupDir() {
  for (const base of getQbittorrentConfigDirs()) {
    const cand = path.join(base, "BT_backup");
    try {
      if (fs.existsSync(cand)) return cand;
    } catch (_) {}
  }
  return "";
}

/**
 * 检测本机 qBittorrent 安装路径与运行状态（兼容 Windows 多盘符与 64位注册表、macOS .app 与 Linux）
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

  const plat = typeof process !== "undefined" ? process.platform : "";
  const candidates = [];
  const customPath = String(plugin?.settings?.qbittorrentExecutablePath || "").trim();
  if (customPath) {
    candidates.push(customPath);
  }

  if (plat === "win32") {
    for (const drive of ["C:", "D:", "E:", "F:", "G:"]) {
      try {
        if (!fs.existsSync(`${drive}/`)) continue;
      } catch (_) {
        continue;
      }
      candidates.push(
        `${drive}/Program Files/qBittorrent/qbittorrent.exe`,
        `${drive}/Program Files (x86)/qBittorrent/qbittorrent.exe`,
        `${drive}/qBittorrent/qbittorrent.exe`
      );
    }
    const localAppData = getSafeEnv().LOCALAPPDATA || "";
    const userProfile = getSafeEnv().USERPROFILE || "";
    if (localAppData) {
      candidates.push(path.join(localAppData, "Programs/qBittorrent/qbittorrent.exe"));
    }
    if (userProfile) {
      candidates.push(path.join(userProfile, "scoop/apps/qbittorrent/current/qbittorrent.exe"));
    }
  } else if (plat === "darwin") {
    const home = getSafeHomeDir();
    candidates.push("/Applications/qbittorrent.app/Contents/MacOS/qbittorrent");
    if (home) {
      candidates.push(path.join(home, "Applications/qbittorrent.app/Contents/MacOS/qbittorrent"));
    }
  } else {
    candidates.push(
      "/usr/bin/qbittorrent",
      "/usr/local/bin/qbittorrent",
      "/snap/bin/qbittorrent"
    );
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

  // Windows 64位 / 32位 / 用户级注册表兜底探测
  if (!exePath && isWinPlatform()) {
    const regKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\qBittorrent',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\qBittorrent',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\qBittorrent'
    ];
    for (const rk of regKeys) {
      try {
        const regOut = execSync(`reg query "${rk}" /v DisplayIcon`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1200
        });
        const m = regOut.match(/([A-Za-z]:\\[^"\r\n,]+qbittorrent\.exe)/i);
        if (m && m[1] && fs.existsSync(m[1])) {
          exePath = path.normalize(m[1]);
          break;
        }
      } catch (e) {}
    }
  } else if (!exePath && plat !== "win32") {
    try {
      const whichOut = String(
        execSync("which qbittorrent", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1000
        }) || ""
      ).trim();
      if (whichOut && fs.existsSync(whichOut)) {
        exePath = path.normalize(whichOut);
      }
    } catch (_) {}
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
  } else if (exePath && plat !== "win32") {
    try {
      const pgrepOut = String(
        execSync("pgrep -ix qbittorrent", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1200
        }) || ""
      ).trim();
      const firstPid = Number(pgrepOut.split(/\s+/)[0]);
      if (Number.isFinite(firstPid) && firstPid > 0) {
        running = true;
        pid = firstPid;
      }
    } catch (_) {}
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
 * 优雅关闭正在运行的 qBittorrent 进程（兼容 Windows / macOS / Linux）
 */
async function gracefullyStopQbittorrentIfRunning(plugin, maxWaitMs = 3200) {
  const st = detectQbittorrentStatus(plugin);
  if (!st.running) return { wasRunning: false, exePath: st.exePath };
  const isWin = isWinPlatform();
  try {
    if (isWin) {
      execSync('taskkill /IM "qbittorrent.exe"', {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 2000
      });
    } else if (st.pid) {
      try {
        process.kill(st.pid, "SIGTERM");
      } catch (_) {
        execSync("killall qbittorrent", { stdio: ["ignore", "ignore", "ignore"], timeout: 2000 });
      }
    }
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
    if (isWin) {
      execSync('taskkill /F /IM "qbittorrent.exe"', {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 2000
      });
    } else if (st.pid) {
      try {
        process.kill(st.pid, "SIGKILL");
      } catch (_) {
        execSync("killall -9 qbittorrent", { stdio: ["ignore", "ignore", "ignore"], timeout: 2000 });
      }
    }
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
 * 插件侧磁力 RSS 追更轮询器：拉取已启用订阅的 RSS XML，校验连续片名、过滤已看/本地已有/已投递剧集后推送给 qBittorrent。
 * 严格尊重用户的暂停/移除操作，绝不从笔记残留的 YAML 属性中静默复活已删除的订阅规则。
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
    }

    let checked = 0;
    let dispatched = 0;
    let dirty = false;

    for (const [key, sub] of Object.entries(subMap)) {
      if (!sub || sub.enabled === false || !sub.rssUrl) continue;
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

      const subAnimeCtx = {
        name: noteItem.name || sub.animeName || key,
        japaneseName: noteItem.japaneseName || "",
        year: Number(noteItem.year) || 0,
        totalEpisodes: Number(noteItem.totalEpisodes) || 0,
        animeCandidates: [noteItem.name || sub.animeName || key, noteItem.japaneseName].filter(Boolean),
        disableSeasonIsolation: false
      };
      const parsed = parseComicatRssXml(xml, noteItem.name || key, DEFAULT_COMICAT_BASE_URL, subAnimeCtx);
      const primaryOnly = (parsed.items || []).filter((it) => !it.isNonVideoNoise && !it.isDerivedOrOtherSeason);
      const dedup = deduplicateEpisodeItems(primaryOnly);
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

let _nativeQbRulesCache = { ts: 0, rules: [] };
function invalidateNativeQbRulesCache() {
  _nativeQbRulesCache = { ts: 0, rules: [] };
}

function readNativeQbRulesCached() {
  if (!isDesktopNodeAvailable()) return [];
  const now = Date.now();
  if (now - _nativeQbRulesCache.ts < 8000) {
    return _nativeQbRulesCache.rules;
  }
  const out = [];
  try {
    const rssDirs = getQbittorrentConfigDirs().map((d) => path.join(d, "rss"));
    for (const dir of rssDirs) {
      const p = path.join(dir, "download_rules.json");
      if (!fs.existsSync(p)) continue;
      const obj = JSON.parse(fs.readFileSync(p, "utf8")) || {};
      for (const [ruleName, ruleVal] of Object.entries(obj)) {
        if (!ruleVal || typeof ruleVal !== "object") continue;
        const savePath = String(ruleVal.savePath || ruleVal.torrentParams?.save_path || "").trim();
        out.push({
          filePath: p,
          ruleName: String(ruleName || "").trim(),
          enabled: ruleVal.enabled !== false,
          savePath,
          normSavePath: normalizeSubSavePathKey(savePath),
          feeds: Array.isArray(ruleVal.affectedFeeds) ? ruleVal.affectedFeeds : []
        });
      }
      break;
    }
  } catch (_) {}
  _nativeQbRulesCache = { ts: now, rules: out };
  return out;
}

function findMatchingSubEntriesForItem(plugin, item) {
  const subMap = ensurePluginRssSubMap(plugin);
  const cleanName = String(item?.name || "").trim();
  const notePath = String(item?.file?.path || item?.path || "").trim();
  const normSave =
    item?.downloadPath && item.downloadPath !== "无"
      ? normalizeSubSavePathKey(item.downloadPath)
      : "";
  const compactTarget = cleanName ? compactTitleForMatch(cleanName) : "";

  const matches = [];
  for (const [key, sub] of Object.entries(subMap)) {
    if (!sub || typeof sub !== "object" || !sub.rssUrl) continue;
    const subName = String(sub.animeName || key || "").trim();
    const subNote = String(sub.notePath || "").trim();
    const subSave = normalizeSubSavePathKey(sub.savePath);

    let matched = false;
    if (cleanName && (key === cleanName || subName === cleanName)) {
      matched = true;
    } else if (notePath && subNote && notePath === subNote) {
      matched = true;
    } else if (normSave && subSave && normSave === subSave) {
      matched = true;
    } else if (compactTarget.length >= 2 && subName) {
      const compactSub = compactTitleForMatch(subName);
      if (compactSub === compactTarget) matched = true;
    }
    if (matched) {
      matches.push({ key, sub });
    }
  }
  return matches;
}

function formatReadableSubSourceLabel(sub, item) {
  if (!sub) return "";
  const streamId = String(sub.streamId || item?.downloadStreamId || "").trim();
  if (streamId) return streamId;
  const kw = String(sub.keyword || item?.downloadSourceKeyword || "").trim();
  const animeName = String(sub.animeName || item?.name || "").trim();
  if (kw && kw !== animeName) return kw;
  const decoded = safeDecodeRssUrl(sub.rssUrl || "");
  if (/mikan/i.test(decoded)) return kw || "蜜柑专属字幕组源";
  return kw || animeName || "已绑定源";
}

/**
 * 同步读取某部动画当前的「自动追更」状态（O(1) 内存级查询，供全部番剧卡片、追番舞台与下载弹窗实时展示）
 */
function getAnimeAutoFollowState(plugin, item) {
  if (!isDesktopNodeAvailable() || !plugin?.settings) {
    return {
      status: "none",
      ruleKey: "",
      sourceLabel: "",
      rssUrl: "",
      savePath: "",
      totalActiveCount: 0,
      totalRuleCount: 0
    };
  }
  const subMap = ensurePluginRssSubMap(plugin);
  let totalActiveCount = 0;
  let totalRuleCount = 0;
  for (const val of Object.values(subMap)) {
    if (!val || typeof val !== "object" || !val.rssUrl || isGenericSiteWideRssFeed(val.rssUrl)) continue;
    totalRuleCount++;
    if (val.enabled !== false) totalActiveCount++;
  }

  if (!item) {
    return {
      status: "none",
      ruleKey: "",
      sourceLabel: "",
      rssUrl: "",
      savePath: "",
      totalActiveCount,
      totalRuleCount
    };
  }

  const matchedSubs = findMatchingSubEntriesForItem(plugin, item);
  const activeSub = matchedSubs.find((m) => m.sub.enabled !== false);
  const primarySub = activeSub || matchedSubs[0] || null;

  const cleanName = String(item?.name || "").trim();
  const normSave =
    item?.downloadPath && item.downloadPath !== "无"
      ? normalizeSubSavePathKey(item.downloadPath)
      : "";
  const nativeMatches = readNativeQbRulesCached().filter((r) => {
    if (cleanName && r.ruleName === cleanName) return true;
    if (normSave && r.normSavePath && r.normSavePath === normSave) return true;
    return false;
  });
  const activeNative = nativeMatches.find((r) => r.enabled);

  if (activeSub) {
    return {
      status: "active",
      ruleKey: activeSub.key,
      sourceLabel: formatReadableSubSourceLabel(activeSub.sub, item),
      keyword: String(activeSub.sub.keyword || ""),
      streamId: String(activeSub.sub.streamId || ""),
      rssUrl: String(activeSub.sub.rssUrl || ""),
      savePath: String(activeSub.sub.savePath || item?.downloadPath || ""),
      lastCheckedAt: activeSub.sub.lastCheckedAt || 0,
      lastMatchTitle: activeSub.sub.lastMatchTitle || "",
      totalActiveCount,
      totalRuleCount
    };
  }
  if (activeNative) {
    return {
      status: "active",
      ruleKey: activeNative.ruleName,
      sourceLabel: item?.downloadStreamId || item?.downloadSourceKeyword || activeNative.ruleName,
      keyword: String(item?.downloadSourceKeyword || activeNative.ruleName),
      streamId: String(item?.downloadStreamId || ""),
      rssUrl: activeNative.feeds[0] || item?.rssUrl || "",
      savePath: activeNative.savePath || item?.downloadPath || "",
      totalActiveCount: totalActiveCount + 1,
      totalRuleCount: totalRuleCount + 1
    };
  }
  if (primarySub) {
    return {
      status: "paused",
      ruleKey: primarySub.key,
      sourceLabel: formatReadableSubSourceLabel(primarySub.sub, item),
      keyword: String(primarySub.sub.keyword || ""),
      streamId: String(primarySub.sub.streamId || ""),
      rssUrl: String(primarySub.sub.rssUrl || ""),
      savePath: String(primarySub.sub.savePath || item?.downloadPath || ""),
      lastCheckedAt: primarySub.sub.lastCheckedAt || 0,
      lastMatchTitle: primarySub.sub.lastMatchTitle || "",
      totalActiveCount,
      totalRuleCount
    };
  }

  return {
    status: "none",
    ruleKey: "",
    sourceLabel: "",
    keyword: "",
    streamId: "",
    rssUrl: "",
    savePath: "",
    totalActiveCount,
    totalRuleCount
  };
}

function updateNativeQbRuleEnabledOnDisk(item, targetRuleName, enabledOrRemove) {
  if (!isDesktopNodeAvailable()) return false;
  const cleanName = String(item?.name || targetRuleName || "").trim();
  const normSave =
    item?.downloadPath && item.downloadPath !== "无"
      ? normalizeSubSavePathKey(item.downloadPath)
      : "";
  let changed = false;
  try {
    const rssDirs = getQbittorrentConfigDirs().map((d) => path.join(d, "rss"));
    for (const dir of rssDirs) {
      const p = path.join(dir, "download_rules.json");
      if (!fs.existsSync(p)) continue;
      const obj = JSON.parse(fs.readFileSync(p, "utf8")) || {};
      let fileDirty = false;
      for (const [rKey, rVal] of Object.entries(obj)) {
        if (!rVal || typeof rVal !== "object") continue;
        const rSave = normalizeSubSavePathKey(rVal.savePath || rVal.torrentParams?.save_path || "");
        if ((cleanName && rKey === cleanName) || (normSave && rSave && rSave === normSave)) {
          if (enabledOrRemove === "remove") {
            delete obj[rKey];
            fileDirty = true;
          } else if (Boolean(rVal.enabled !== false) !== Boolean(enabledOrRemove)) {
            rVal.enabled = Boolean(enabledOrRemove);
            fileDirty = true;
          }
        }
      }
      if (fileDirty) {
        fs.writeFileSync(p, JSON.stringify(obj, null, 4), "utf8");
        changed = true;
      }
    }
  } catch (_) {}
  invalidateNativeQbRulesCache();
  return changed;
}

/**
 * 一键暂停或恢复某部番剧的自动追更
 */
async function setAnimeAutoFollowEnabled(plugin, item, enabled) {
  if (!plugin?.settings || !item) return { ok: false };
  const subMap = ensurePluginRssSubMap(plugin);
  const matches = findMatchingSubEntriesForItem(plugin, item);
  const wantEnabled = Boolean(enabled);

  if (matches.length > 0) {
    for (const m of matches) {
      m.sub.enabled = wantEnabled;
      m.sub.updatedAt = Date.now();
      if (wantEnabled && !m.sub.baselineTimeMs) {
        m.sub.baselineTimeMs = Date.now();
      }
    }
  } else if (wantEnabled && item.rssUrl && !isGenericSiteWideRssFeed(item.rssUrl)) {
    const ruleName = String(item.name || "未命名番剧").trim();
    subMap[ruleName] = {
      animeName: ruleName,
      notePath: item.file?.path || "",
      rssUrl: item.rssUrl,
      keyword: String(item.downloadSourceKeyword || ruleName),
      streamId: String(item.downloadStreamId || ""),
      savePath: item.downloadPath && item.downloadPath !== "无" ? String(item.downloadPath).replace(/\\/g, "/") : "",
      mustContain: "",
      mustNotContain: "720p|720P|480p",
      enabled: true,
      baselineTimeMs: Date.now(),
      matchedHashes: [],
      updatedAt: Date.now()
    };
  }

  updateNativeQbRuleEnabledOnDisk(item, item.name, wantEnabled);
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }
  return { ok: true, status: wantEnabled ? "active" : "paused" };
}

/**
 * 一键取消某部番剧的自动追更，并同步清空该动画笔记中的默认下载源与 RSS 属性，确保彻底停止自动下载
 */
async function removeAnimeAutoFollowAndUnbind(plugin, item, { clearNoteFields = true } = {}) {
  if (!plugin?.settings || !item) return { ok: false };
  const subMap = ensurePluginRssSubMap(plugin);
  const matches = findMatchingSubEntriesForItem(plugin, item);
  for (const m of matches) {
    delete subMap[m.key];
  }
  updateNativeQbRuleEnabledOnDisk(item, item.name, "remove");

  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings().catch(() => {});
  }

  if (clearNoteFields) {
    const targetFile =
      item?.file ||
      (item?.notePath && plugin?.app?.vault
        ? plugin.app.vault.getAbstractFileByPath(item.notePath)
        : item?.path && plugin?.app?.vault
        ? plugin.app.vault.getAbstractFileByPath(item.path)
        : null);
    if (targetFile && plugin?.app?.vault) {
      try {
        let content = await plugin.app.vault.read(targetFile);
        content = noteUtils.updateFrontmatterField(content, "下载源关键词", "");
        content = noteUtils.updateFrontmatterField(content, "RSS订阅", "");
        content = noteUtils.updateFrontmatterField(content, "发布源标识", "");
        content = noteUtils.syncNoteCalloutFromFrontmatter(content);
        if (typeof plugin.modifyNoteSafely === "function") {
          await plugin.modifyNoteSafely(targetFile, content);
        } else {
          await plugin.app.vault.modify(targetFile, content);
        }
      } catch (_) {}
    }
    item.downloadSourceKeyword = "";
    item.rssUrl = "";
    item.downloadStreamId = "";
  }

  return { ok: true, status: "none" };
}

/**
 * 打开全馆「自动追更订阅管理」窗口：集中查看、暂停/恢复、取消任意番剧的自动下载规则
 */
function openAllRssSubscriptionsManagerModal(plugin, onChanged = null) {
  const ModalClass = globalThis.__BangumiManagerModal || obsidian?.Modal;
  const NoticeClass = globalThis.__BangumiManagerNotice || obsidian?.Notice;
  if (!ModalClass || !plugin?.app) return null;

  class AllRssSubscriptionsManagerModal extends ModalClass {
    constructor(app) {
      super(app);
      this.filterMode = "all";
      this.dashboardItems = [];
      this.isPollingNow = false;
    }

    async onOpen() {
      this.modalEl.addClass("curator-download-modal-shell");
      this.modalEl.style.width = "min(820px, 94vw)";
      this.modalEl.style.maxWidth = "820px";
      this.modalEl.style.maxHeight = "86vh";
      if (typeof plugin.collectDashboardItems === "function") {
        this.dashboardItems = await plugin.collectDashboardItems().catch(() => []);
      }
      this.render();
    }

    onClose() {
      this.contentEl.empty();
    }

    async triggerNotifyChanged() {
      if (typeof plugin.collectDashboardItems === "function") {
        this.dashboardItems = await plugin.collectDashboardItems().catch(() => []);
      }
      if (typeof onChanged === "function") {
        await onChanged();
      }
      if (typeof plugin.refreshOpenDashboardViews === "function") {
        await plugin.refreshOpenDashboardViews().catch(() => {});
      }
    }

    buildEntries() {
      const subMap = ensurePluginRssSubMap(plugin);
      const byName = new Map();
      const bySavePath = new Map();
      const byNotePath = new Map();
      for (const it of this.dashboardItems) {
        const cleanItName = String(it?.name || "").trim();
        if (cleanItName) byName.set(cleanItName, it);
        const normItSave = normalizeSubSavePathKey(it?.downloadPath);
        if (normItSave && normItSave !== "无") bySavePath.set(normItSave, it);
        if (it?.file?.path) byNotePath.set(it.file.path, it);
      }

      const entries = [];
      for (const [key, sub] of Object.entries(subMap)) {
        if (!sub || typeof sub !== "object" || !sub.rssUrl || isGenericSiteWideRssFeed(sub.rssUrl)) continue;
        const resolved = resolveNoteItemForSubscription(
          key,
          sub,
          this.dashboardItems,
          byName,
          bySavePath,
          byNotePath
        );
        const noteItem = resolved.item;
        const isEnabled = sub.enabled !== false;
        const watchState = resolved.matched ? String(noteItem.state || "未知") : "未关联笔记";
        entries.push({
          key,
          sub,
          matchedNote: resolved.matched,
          noteItem,
          animeName: String(noteItem?.name || sub.animeName || key).trim(),
          sourceLabel: formatReadableSubSourceLabel(sub, noteItem),
          savePath: String(noteItem?.downloadPath && noteItem.downloadPath !== "无" ? noteItem.downloadPath : sub.savePath || ""),
          isEnabled,
          watchState,
          updatedAt: Number(sub.updatedAt) || 0
        });
      }
      entries.sort((a, b) => {
        if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
        if ((a.watchState === "在看") !== (b.watchState === "在看")) return a.watchState === "在看" ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      return entries;
    }

    render() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-download-modal");

      const entries = this.buildEntries();
      const activeEntries = entries.filter((e) => e.isEnabled);
      const pausedEntries = entries.filter((e) => !e.isEnabled);
      const nonWatchingActive = activeEntries.filter((e) => e.watchState !== "在看");

      const header = contentEl.createDiv("curator-dl-header curator-dl-header-row");
      const titleCol = header.createDiv("curator-dl-title-col");
      titleCol.createEl("h2", {
        cls: "curator-dl-title",
        text: "自动追更订阅管理"
      });
      titleCol.createDiv({
        cls: "curator-dl-meta-sub",
        text: "集中查看并控制所有番剧的后台自动下载（开启中的「在看」番剧每 30 分钟检查新集并推送至 qBittorrent，自动跳过已看与本地已有集数）。"
      });

      const toolbar = contentEl.createDiv("curator-dl-submgr-toolbar");
      const filterPills = toolbar.createDiv("curator-dl-subgroup-bar");
      const makeFilter = (id, label) => {
        const btn = filterPills.createEl("button", {
          cls: `curator-dl-subgroup-pill ${this.filterMode === id ? "is-active" : ""}`,
          text: label
        });
        btn.onclick = () => {
          this.filterMode = id;
          this.render();
        };
      };
      makeFilter("all", `全部 (${entries.length})`);
      makeFilter("active", `追更中 (${activeEntries.length})`);
      makeFilter("paused", `已暂停 (${pausedEntries.length})`);

      const toolBtns = toolbar.createDiv("curator-dl-stream-head-btns");
      if (nonWatchingActive.length > 0) {
        const cleanInactiveBtn = toolBtns.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: `暂停非「在看」番剧 (${nonWatchingActive.length})`
        });
        cleanInactiveBtn.title = "一键暂停所有已看完、搁置、抛弃或未匹配笔记的旧追更规则";
        cleanInactiveBtn.onclick = async () => {
          for (const e of nonWatchingActive) {
            e.sub.enabled = false;
            e.sub.updatedAt = Date.now();
          }
          await plugin.saveSettings().catch(() => {});
          await this.triggerNotifyChanged();
          this.render();
          if (NoticeClass) {
            new NoticeClass(`已暂停 ${nonWatchingActive.length} 部非「在看」番剧的自动追更`);
          }
        };
      }

      if (activeEntries.length > 0) {
        const pollNowBtn = toolBtns.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: this.isPollingNow ? "正在检查新集…" : "立即检查一次新集"
        });
        pollNowBtn.disabled = this.isPollingNow;
        pollNowBtn.onclick = async () => {
          this.isPollingNow = true;
          this.render();
          const res = await pollPluginRssSubscriptions(plugin).catch(() => ({ checked: 0, dispatched: 0 }));
          this.isPollingNow = false;
          await this.triggerNotifyChanged();
          this.render();
          if (NoticeClass) {
            new NoticeClass(
              res.dispatched > 0
                ? `已检查 ${res.checked} 部追更番剧，发现并添加 ${res.dispatched} 集新更新至 qBittorrent`
                : `已检查 ${res.checked} 部「在看」追更番剧，当前暂无未下载的新集`
            );
          }
        };
      }

      const visible =
        this.filterMode === "active"
          ? activeEntries
          : this.filterMode === "paused"
          ? pausedEntries
          : entries;

      if (visible.length === 0) {
        const empty = contentEl.createDiv("curator-dl-empty-box");
        empty.createDiv({
          cls: "curator-dl-empty-title",
          text:
            entries.length === 0
              ? "当前没有任何自动追更订阅"
              : this.filterMode === "active"
              ? "当前没有处于「追更中」的番剧"
              : "当前没有已暂停的订阅"
        });
        empty.createDiv({
          cls: "curator-dl-empty-sub",
          text: "在任意番剧的下载页面选定字幕组后，点击「设为自动追更」即可加入列表。"
        });
        return;
      }

      const listWrap = contentEl.createDiv("curator-dl-ep-list curator-dl-submgr-list");
      for (const entry of visible) {
        const row = listWrap.createDiv("curator-dl-ep-row");
        const badgeCol = row.createDiv("curator-dl-ep-badge-col");
        badgeCol.createSpan({
          cls: `curator-dl-ep-local-tag ${entry.isEnabled ? "is-ok" : ""}`,
          text: entry.isEnabled ? "追更中" : "已暂停"
        });
        badgeCol.createSpan({
          cls: "curator-dl-stream-tag",
          text: entry.watchState
        });

        const infoCol = row.createDiv("curator-dl-ep-info-col");
        const titleEl = infoCol.createDiv({
          cls: "curator-dl-ep-title",
          text: `《${entry.animeName}》`
        });
        if (entry.matchedNote) {
          titleEl.style.cursor = "pointer";
          titleEl.title = "点击打开该番剧的下载与追更窗口";
          titleEl.onclick = () => {
            this.close();
            openAnimeDownloadModal(plugin, entry.noteItem, onChanged);
          };
        }
        const metaParts = [`锁定源：${entry.sourceLabel}`];
        if (entry.savePath && entry.savePath !== "无") metaParts.push(`保存至：${entry.savePath}`);
        infoCol.createDiv({
          cls: "curator-dl-ep-sub",
          text: metaParts.join(" · ")
        });

        const actCol = row.createDiv("curator-dl-ep-actions-col");
        if (entry.matchedNote) {
          const openDlBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: "打开下载页"
          });
          openDlBtn.onclick = () => {
            this.close();
            openAnimeDownloadModal(plugin, entry.noteItem, onChanged);
          };
        }

        const toggleBtn = actCol.createEl("button", {
          cls: `curator-dl-mini-btn ${entry.isEnabled ? "" : "is-primary"}`,
          text: entry.isEnabled ? "暂停" : "恢复"
        });
        toggleBtn.onclick = async () => {
          entry.sub.enabled = !entry.isEnabled;
          entry.sub.updatedAt = Date.now();
          updateNativeQbRuleEnabledOnDisk(entry.noteItem, entry.key, entry.sub.enabled);
          await plugin.saveSettings().catch(() => {});
          await this.triggerNotifyChanged();
          this.render();
        };

        const removeBtn = actCol.createEl("button", {
          cls: "curator-dl-mini-btn is-danger-outline",
          text: "取消追更"
        });
        removeBtn.onclick = async () => {
          const subMapRef = ensurePluginRssSubMap(plugin);
          delete subMapRef[entry.key];
          await removeAnimeAutoFollowAndUnbind(plugin, entry.noteItem, {
            clearNoteFields: Boolean(entry.matchedNote)
          });
          await this.triggerNotifyChanged();
          this.render();
          if (NoticeClass) {
            new NoticeClass(`已取消《${entry.animeName}》的自动追更`);
          }
        };
      }
    }
  }

  const m = new AllRssSubscriptionsManagerModal(plugin.app);
  m.open();
  return m;
}

/**
 * 将动画的专属 RSS 订阅统一注册到插件自动追更列表中（无需重启 qBittorrent，原生支持跳过已看/本地已有集数并随时在插件内暂停或取消）
 */
async function syncRssFeedAndRuleToQbittorrent(
  plugin,
  item,
  { keyword, rssUrl, streamId, missingEpisodes = [] } = {}
) {
  let cleanRss = String(rssUrl || "").trim();
  if (!cleanRss) return { ok: false, reason: "empty_rss" };
  if (!isDesktopNodeAvailable()) return { ok: false, reason: "mobile_env" };

  const { targetPath } = await ensureAnimeLocalDownloadFolder(plugin, item, true);
  const normSavePath = String(targetPath || "").replace(/\\/g, "/");
  const ruleName = String(item?.name || keyword || "未命名番剧").trim();
  if (isGenericSiteWideRssFeed(cleanRss)) {
    const kwFallback = String(keyword || ruleName).trim();
    if (!kwFallback) return { ok: false, reason: "generic_site_wide_rss_blocked" };
    cleanRss = buildComicatRssUrl(kwFallback);
  }
  const feedTitle = `${item?.name || keyword}${streamId ? ` [${streamId}]` : ""}`;

  await sanitizeDeadQbittorrentComicatRules(plugin).catch(() => {});
  updateNativeQbRuleEnabledOnDisk(item, ruleName, false);

  const subMap = ensurePluginRssSubMap(plugin);
  const existingMatches = findMatchingSubEntriesForItem(plugin, item);
  const seedHashes = new Set();
  for (const m of existingMatches) {
    for (const h of Array.isArray(m.sub.matchedHashes) ? m.sub.matchedHashes : []) {
      seedHashes.add(h);
    }
    if (m.key !== ruleName) delete subMap[m.key];
  }
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

async function trashOrUnlinkExternalFile(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return false;
  try {
    const electron = tryRequireNode("electron");
    if (electron?.shell && typeof electron.shell.trashItem === "function") {
      await electron.shell.trashItem(absPath);
      if (!fs.existsSync(absPath)) return true;
    }
  } catch (_) {}
  try {
    fs.unlinkSync(absPath);
    return !fs.existsSync(absPath);
  } catch (_) {
    return false;
  }
}

function isStrictSubDirOf(parentDir, childDir) {
  if (!parentDir || !childDir) return false;
  const isWin = isWinPlatform();
  const normP = path.resolve(parentDir).replace(/[\\/]+$/, "");
  const normC = path.resolve(childDir).replace(/[\\/]+$/, "");
  const pCmp = isWin ? normP.toLowerCase() : normP;
  const cCmp = isWin ? normC.toLowerCase() : normC;
  if (!pCmp || !cCmp || pCmp === cCmp) return false;
  const sep = isWin ? "\\" : path.sep || "/";
  return cCmp.startsWith(pCmp + sep) || cCmp.startsWith(pCmp + "/");
}

function removeEmptyParentSubdirsUpToRoot(rootFolder, leafDir) {
  if (!rootFolder || !leafDir) return;
  let cur = path.resolve(leafDir);
  let guard = 0;
  while (guard < 4 && isStrictSubDirOf(rootFolder, cur)) {
    guard += 1;
    try {
      if (!fs.existsSync(cur)) {
        cur = path.dirname(cur);
        continue;
      }
      const left = fs.readdirSync(cur);
      if (left.length === 0) {
        fs.rmdirSync(cur);
        cur = path.dirname(cur);
      } else {
        break;
      }
    } catch (_) {
      break;
    }
  }
}

/**
 * 在插件内删除指定单集的本地视频文件（优先移入系统回收站），并同步清理 qBittorrent (BT_backup) 中的对应传输任务与种子缓存；
 * 若该集原位于单集独立子文件夹且删除后子文件夹已空，自动清理空壳子文件夹。
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
          const ok = await trashOrUnlinkExternalFile(full);
          if (ok) deletedFiles.push(name);
        }
      }
      if (rawFolder && rawFolder !== "无") {
        removeEmptyParentSubdirsUpToRoot(rawFolder, dir);
      }
    } catch (e) {}
  }

  // 2. 扫描本机 qBittorrent BT_backup 目录，查找匹配该集 infoHash 或文件名的传输任务并同步移除
  let removedQbTorrents = 0;
  const btBackupDir = getQbittorrentBtBackupDir();
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

  if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
    plugin._v07LocalFolderCache.clear();
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
 * 将属于该番剧的视频文件及同集外挂字幕一键归集移动到当前番剧的专属本地文件夹（兼容 Win/macOS/Linux 及 NFC/NFD 编码）。
 */
async function collectEpisodesFromCloudDriveFolders(plugin, item) {
  const { targetPath } = await ensureAnimeLocalDownloadFolder(plugin, item, true);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: false, movedFiles: [], reason: "本地番剧目录不可用" };
  }

  const tokens = extractAnimeMatchTokens(item, item?.downloadSourceKeyword || "").map((t) =>
    normalizeUnicodeNfc(t).toLowerCase()
  );
  if (tokens.length === 0) {
    return { ok: false, movedFiles: [], reason: "无法提取该番剧的匹配关键词" };
  }

  const homeDir = getSafeHomeDir();
  const isWin = isWinPlatform();
  const candidateDirs = new Set();
  if (plugin?.settings?.customCloudDriveDownloadDir) {
    candidateDirs.add(String(plugin.settings.customCloudDriveDownloadDir).trim());
  }
  if (isWin) {
    for (const drive of ["C:", "D:", "E:", "F:", "G:"]) {
      try {
        if (!fs.existsSync(`${drive}/`)) continue;
      } catch (_) {
        continue;
      }
      candidateDirs.add(`${drive}/QuarkDownload`);
      candidateDirs.add(`${drive}/夸克网盘下载`);
      candidateDirs.add(`${drive}/BaiduNetdiskDownload`);
      candidateDirs.add(`${drive}/迅雷下载`);
      candidateDirs.add(`${drive}/Downloads`);
    }
  }
  if (homeDir) {
    candidateDirs.add(path.join(homeDir, "Downloads"));
    candidateDirs.add(path.join(homeDir, "QuarkDownload"));
    candidateDirs.add(path.join(homeDir, "Movies"));
  }

  const videoAndSubExts = new Set([
    ".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".m4v", ".ts",
    ".ass", ".ssa", ".srt", ".vtt"
  ]);
  const videoOnlyExts = new Set([".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".m4v", ".ts"]);
  const movedFiles = [];
  const normTarget = isWin ? path.resolve(targetPath).toLowerCase() : path.resolve(targetPath);

  const matchesAnime = (fileName) => {
    const lower = normalizeUnicodeNfc(String(fileName || "")).toLowerCase();
    return tokens.some((t) => t.length >= 2 && lower.includes(t));
  };

  const moveOneFileSafely = (srcFile, destFile) => {
    if (fs.existsSync(destFile)) return false;
    try {
      fs.renameSync(srcFile, destFile);
      return true;
    } catch (_) {
      try {
        fs.copyFileSync(srcFile, destFile);
        fs.unlinkSync(srcFile);
        return true;
      } catch (__) {
        return false;
      }
    }
  };

  for (const dir of candidateDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const normCur = isWin ? path.resolve(dir).toLowerCase() : path.resolve(dir);
    if (normCur === normTarget) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (videoAndSubExts.has(ext) && matchesAnime(entry.name)) {
            const srcFile = path.join(dir, entry.name);
            const destFile = path.join(targetPath, entry.name);
            if (moveOneFileSafely(srcFile, destFile) && videoOnlyExts.has(ext)) {
              movedFiles.push(entry.name);
            }
          }
        } else if (entry.isDirectory() && matchesAnime(entry.name)) {
          const subDir = path.join(dir, entry.name);
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isFile()) continue;
            const ext = path.extname(sub.name).toLowerCase();
            if (videoAndSubExts.has(ext)) {
              const srcFile = path.join(subDir, sub.name);
              const destFile = path.join(targetPath, sub.name);
              if (moveOneFileSafely(srcFile, destFile) && videoOnlyExts.has(ext)) {
                movedFiles.push(sub.name);
              }
            }
          }
          try {
            if (fs.readdirSync(subDir).length === 0) fs.rmdirSync(subDir);
          } catch (_) {}
        }
      }
    } catch (e) {}
  }

  if (movedFiles.length > 0) {
    if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
      plugin._v07LocalFolderCache.clear();
    }
    if (item?.file) {
      await plugin.checkOneLocalStatus(item.file);
    }
  }

  return {
    ok: true,
    movedFiles,
    targetPath
  };
}

/**
 * 用户主动确认后，将番剧目录内位于子文件夹中的正片剧集（及配套同名外挂字幕）平铺移动到番剧根目录，并清理腾空的子文件夹
 */
async function flattenAnimeSubfolderEpisodes(plugin, item) {
  const rawFolder = String(item?.downloadPath || "").trim();
  if (!rawFolder || rawFolder === "无" || !fs.existsSync(rawFolder)) {
    return { ok: false, movedCount: 0, skippedCount: 0, reason: "本地番剧目录不存在" };
  }
  const inspectRes = noteUtils.inspectLocalFolder(rawFolder, item?.watchedEpisodes);
  const subVideos = (inspectRes?.videoFiles || []).filter((vf) => vf.inSubfolder && vf.path && fs.existsSync(vf.path));
  if (subVideos.length === 0) {
    return { ok: true, movedCount: 0, skippedCount: 0 };
  }

  let movedCount = 0;
  let skippedCount = 0;
  const subExts = new Set([".ass", ".ssa", ".srt", ".vtt", ".sup"]);
  const touchedDirs = new Set();

  for (const vf of subVideos) {
    const srcDir = path.dirname(vf.path);
    const baseName = path.basename(vf.path);
    const stem = path.basename(vf.path, path.extname(vf.path));
    const destVideo = path.join(rawFolder, baseName);

    if (fs.existsSync(destVideo)) {
      skippedCount += 1;
      continue;
    }

    try {
      fs.renameSync(vf.path, destVideo);
      movedCount += 1;
      touchedDirs.add(srcDir);

      // 同步移动同目录下配套的同名外挂字幕文件
      const siblings = fs.readdirSync(srcDir);
      for (const sib of siblings) {
        const ext = path.extname(sib).toLowerCase();
        if (subExts.has(ext) && sib.toLowerCase().startsWith(stem.toLowerCase())) {
          const srcSub = path.join(srcDir, sib);
          const destSub = path.join(rawFolder, sib);
          if (!fs.existsSync(destSub)) {
            try {
              fs.renameSync(srcSub, destSub);
            } catch (_) {}
          }
        }
      }
    } catch (_) {
      skippedCount += 1;
    }
  }

  for (const d of touchedDirs) {
    removeEmptyParentSubdirsUpToRoot(rawFolder, d);
  }

  if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
    plugin._v07LocalFolderCache.clear();
  }
  if (item?.file) {
    await plugin.checkOneLocalStatus(item.file);
  }
  if (typeof plugin?.refreshOpenDashboardViews === "function") {
    await plugin.refreshOpenDashboardViews().catch(() => {});
  }

  return { ok: true, movedCount, skippedCount };
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

  const rssDirs = getQbittorrentConfigDirs().map((d) => path.join(d, "rss"));

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

function buildCandidateKeywordsForAnime(item, extraAliases = []) {
  const candidates = [];
  const seen = new Set();
  const add = (kw, label) => {
    const clean = String(kw || "").trim();
    if (!clean || isInvalidAnimeAlias(clean)) return;
    const lower = clean.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    candidates.push({ keyword: clean, label });
  };

  if (item?.downloadSourceKeyword) {
    add(item.downloadSourceKeyword, "已绑定源");
  }

  const rawName = String(item?.name || "").trim();
  if (rawName) {
    add(rawName, "中文名");
    const coreName = rawName
      .replace(/^[【\[]|[】\]]$/g, " ")
      .replace(/[～~][^～~]+[～~]/g, " ")
      .replace(/-[^-]{2,}-/g, " ")
      .replace(/\s+(?:第[一二三四五六七八九十\d]+[季期部]|Season\s*\d+|Part\s*\d+|反击篇|袭击篇|前篇|后篇|后半部分|II|III|2|3)$/i, "")
      .replace(/[：:·・！!？?。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (coreName && coreName !== rawName) {
      add(coreName, "主标题");
    }
  }

  const jpName = String(item?.japaneseName || "").trim();
  if (jpName) {
    add(jpName, "原名");
  }

  let aliasAdded = 0;
  for (const al of Array.isArray(extraAliases) ? extraAliases : []) {
    if (aliasAdded >= 3) break;
    const before = candidates.length;
    add(al, "别名");
    if (candidates.length > before) aliasAdded++;
  }

  return candidates;
}

/**
 * 打开「下载与自动追更」弹窗
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
      this.broadDataset = null;
      this.discoveredAliases = [];
      this.broadStreams = [];
      this.broadSubgroups = [];
      this.broadHitLimit = false;
      this.broadSnapshot = null;
      this.selectedSubgroupFilter = "";
      this.subgroupsExpanded = false;
      this.includeDerivedResources = false;
      this.isLoadingMorePages = false;
      this.activeStreamId = "";
      this.activeCustomRssUrl = "";
      this._userManuallyPickedStream = false;
      this._isCustomFilteredSearch = false;
      this.currentEpisodes = [];
      this.currentPacks = [];
      this.currentUnnumbered = [];
      this.currentDedupInfo = null;
      this.streamsExpanded = false;
      this.isLoading = false;
      this.isRefreshingStates = false;
      this.errorMessage = "";
      this.lastFolderError = "";
      this.showCustomFolderInput = false;
      this.isMobileMode = isMobileDownloadEnv();
      this._searchSeq = 0;
      this._lastFocusRefreshTs = 0;
      this._onWindowFocus = () => {
        if (!this.modalEl || !this.modalEl.isConnected || this.isMobileMode) return;
        const now = Date.now();
        if (now - this._lastFocusRefreshTs < 1200) return;
        this._lastFocusRefreshTs = now;
        this.refreshAllStates({ showNotice: false });
      };
    }

    onOpen() {
      this.modalEl.addClass("curator-download-modal-shell");
      if (this.isMobileMode) {
        this.modalEl.addClass("is-mobile-download-modal");
        this.modalEl.style.width = "100%";
        this.modalEl.style.maxWidth = "100vw";
        this.modalEl.style.maxHeight = "92vh";
      } else {
        this.modalEl.style.width = "min(920px, 94vw)";
        this.modalEl.style.maxWidth = "94vw";
        this.modalEl.style.maxHeight = "88vh";
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          window.addEventListener("focus", this._onWindowFocus);
        }
      }
      this.renderShell();

      if (this.plugin.settings.enableComicatIntegration !== false && (this.broadKeyword || this.currentKeyword)) {
        this.performSearch(this.currentKeyword || this.broadKeyword, { isInitial: true });
      }
    }

    onClose() {
      this._searchSeq += 1;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", this._onWindowFocus);
      }
      this.contentEl.empty();
    }

    async reloadItemFromNote() {
      const targetFile =
        this.item?.file ||
        (this.item?.path && this.plugin?.app?.vault
          ? this.plugin.app.vault.getAbstractFileByPath(this.item.path)
          : null);
      if (!targetFile || !this.plugin?.app?.vault) return;
      try {
        const raw = await this.plugin.app.vault.read(targetFile);
        if (typeof noteUtils.extractFrontmatterField === "function") {
          const st = noteUtils.extractFrontmatterField(raw, "观看状态");
          const we = noteUtils.extractFrontmatterField(raw, "已看集数");
          const te = noteUtils.extractFrontmatterField(raw, "总集数");
          const dp = noteUtils.extractFrontmatterField(raw, "本地路径");
          const kw = noteUtils.extractFrontmatterField(raw, "下载源关键词");
          const rss = noteUtils.extractFrontmatterField(raw, "RSS订阅");
          const sid = noteUtils.extractFrontmatterField(raw, "发布源标识");
          if (st) this.item.state = st;
          if (we !== undefined && we !== "") this.item.watchedEpisodes = Number(we) || 0;
          if (te !== undefined && te !== "") this.item.totalEpisodes = Number(te) || 0;
          if (dp !== undefined && dp !== "") this.item.downloadPath = dp;
          if (kw !== undefined) this.item.downloadSourceKeyword = kw;
          if (rss !== undefined) this.item.rssUrl = rss;
          if (sid !== undefined) this.item.downloadStreamId = sid;
        }
      } catch (_) {}
    }

    async refreshAllStates({ showNotice = false } = {}) {
      if (this.isRefreshingStates) return;
      this.isRefreshingStates = true;
      if (this.refreshTopBtn) {
        this.refreshTopBtn.disabled = true;
      }
      try {
        invalidateNativeQbRulesCache();
        if (this.plugin?._v07LocalFolderCache && typeof this.plugin._v07LocalFolderCache.clear === "function") {
          this.plugin._v07LocalFolderCache.clear();
        }
        await this.reloadItemFromNote();
        if (!this.isMobileMode && this.item?.file && typeof this.plugin?.checkOneLocalStatus === "function") {
          await this.plugin.checkOneLocalStatus(this.item.file).catch(() => {});
        }
        if (!this.modalEl || !this.modalEl.isConnected) return;

        this.renderHeaderMeta();
        this.renderEnvStatus();
        this.renderAutoFollowBar();
        this.renderResultsMount();

        if (showNotice && (this.errorMessage || (this.broadStreams.length === 0 && !this.isLoading))) {
          const kw = this.keywordInput?.value?.trim() || this.currentKeyword || this.broadKeyword;
          if (kw && this.plugin.settings.enableComicatIntegration !== false) {
            await this.performSearch(kw, {
              isInitial: !this.broadDataset,
              bypassCache: true
            });
          }
        }

        if (typeof this.onUpdated === "function") {
          this.onUpdated();
        }
        if (typeof this.plugin?.refreshOpenDashboardViews === "function") {
          await this.plugin.refreshOpenDashboardViews().catch(() => {});
        }
        if (showNotice && NoticeClass) {
          const localSet = this.getLocalExistingEpisodeSet();
          new NoticeClass(`已刷新状态（当前本地识别到 ${localSet.size} 集正片视频）`, 3200);
        }
      } finally {
        this.isRefreshingStates = false;
        if (this.refreshTopBtn && this.refreshTopBtn.isConnected) {
          this.refreshTopBtn.disabled = false;
        }
      }
    }

    getLocalExistingEpisodeSet() {
      const set = new Set();
      if (this.isMobileMode) return set;
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

    getEffectiveCurrentRssUrl() {
      if (this.activeCustomRssUrl) return this.activeCustomRssUrl;
      const kw = String(this.currentKeyword || this.item?.name || "").trim();
      return buildComicatRssUrl(kw, this.baseUrl);
    }

    renderHeaderMeta() {
      if (!this.metaSubEl) return;
      this.metaSubEl.empty();
      const seasonStr = [this.item?.year, this.item?.season].filter(Boolean).join(" ") || "未知番季";
      const totalEp = Number(this.item?.totalEpisodes) || 0;
      const watchedEp = Number(this.item?.watchedEpisodes) || 0;
      this.metaSubEl.createSpan({
        text: `${seasonStr} · 已看 ${watchedEp}${totalEp > 0 ? "/" + totalEp : ""} 话`
      });

      if (!this.isMobileMode) {
        const follow = getAnimeAutoFollowState(this.plugin, this.item);
        if (follow.status === "active") {
          this.metaSubEl.createSpan({
            cls: "curator-dl-bound-pill is-following",
            text: `自动追更中：${follow.sourceLabel}`
          });
        } else if (follow.status === "paused") {
          this.metaSubEl.createSpan({
            cls: "curator-dl-bound-pill",
            text: `追更已暂停：${follow.sourceLabel}`
          });
        } else if (this.item?.downloadSourceKeyword) {
          this.metaSubEl.createSpan({
            cls: "curator-dl-bound-pill",
            text: `常用源：${this.item.downloadStreamId || this.item.downloadSourceKeyword}`
          });
        }
      } else if (this.item?.downloadSourceKeyword) {
        this.metaSubEl.createSpan({
          cls: "curator-dl-bound-pill",
          text: `常用源：${this.item.downloadStreamId || this.item.downloadSourceKeyword}`
        });
      }
    }

    renderCandidateChipsRow() {
      if (!this.chipsRow) return;
      this.chipsRow.empty();
      this.chipsRow.createSpan({ cls: "curator-dl-chips-label", text: "快捷词条：" });

      const baseCandidates = buildCandidateKeywordsForAnime(this.item, this.discoveredAliases);
      for (const cand of baseCandidates) {
        const chip = this.chipsRow.createEl("button", {
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

      const quickModifiers = ["ANi", "LoliHouse", "喵萌奶茶屋", "爱恋", "桜都字幕组", "Baha", "简繁内封", "1080p"];
      for (const mod of quickModifiers) {
        const modChip = this.chipsRow.createEl("button", {
          cls: "curator-dl-chip is-modifier",
          text: `+ ${mod}`
        });
        modChip.title = `在当前搜索词中追加「${mod}」筛选`;
        modChip.onclick = () => {
          const cur = this.keywordInput.value.trim() || this.item?.name || "";
          if (!cur.toLowerCase().includes(mod.toLowerCase())) {
            this.keywordInput.value = `${cur} ${mod}`.trim();
          }
          if (this.plugin.settings.enableComicatIntegration !== false) {
            this.performSearch(this.keywordInput.value.trim(), {
              preserveStreams: true,
              forceExactQuery: true
            });
          }
        };
      }
    }

    renderShell() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-download-modal");
      if (this.isMobileMode) {
        contentEl.addClass("is-mobile-download");
      }

      // 1. 顶部标题与右上角统一「刷新状态」按钮
      const header = contentEl.createDiv("curator-dl-header curator-dl-header-row");
      const titleCol = header.createDiv("curator-dl-title-col");
      titleCol.createEl("h2", {
        cls: "curator-dl-title",
        text: this.isMobileMode
          ? `磁力检索 · 《${this.item?.name || "未命名"}》`
          : `下载与自动追更 · 《${this.item?.name || "未命名"}》`
      });
      this.metaSubEl = titleCol.createDiv("curator-dl-meta-sub");
      this.renderHeaderMeta();

      const headerActions = header.createDiv("curator-dl-header-actions");
      this.refreshTopBtn = headerActions.createEl("button", {
        cls: "curator-dl-btn curator-dl-refresh-top-btn"
      });
      v07Core.setBtnIconLabel(
        this.refreshTopBtn,
        "refresh",
        this.isMobileMode ? "刷新" : "刷新状态",
        13
      );
      this.refreshTopBtn.dataset.dlAction = "refresh-all-status";
      this.refreshTopBtn.title = this.isMobileMode
        ? "重新检索最新剧集磁力列表"
        : "重新扫描本地番剧文件夹，同步更新已有集数、待下载缺失集数、qBittorrent 与追更状态";
      this.refreshTopBtn.onclick = async () => {
        if (this.isMobileMode) {
          const kw = this.keywordInput?.value?.trim() || this.currentKeyword || this.broadKeyword;
          if (kw && this.plugin.settings.enableComicatIntegration !== false) {
            await this.performSearch(kw, { bypassCache: true });
          }
          return;
        }
        await this.refreshAllStates({ showNotice: true });
      };

      // 2. 本地文件夹与 qBittorrent 环境卡片（移动端改为简洁磁力指引）
      this.envBox = contentEl.createDiv("curator-dl-env-box");
      this.renderEnvStatus();

      // 2.5 自动追更状态与控制栏（桌面端显示，一键暂停/恢复/取消追更或管理全部追更）
      this.autoFollowBox = contentEl.createDiv("curator-dl-rss-check-box");
      this.renderAutoFollowBar();

      // 3. 搜索与快捷跳转控制栏
      const searchBox = contentEl.createDiv("curator-dl-search-box");
      const searchRow = searchBox.createDiv("curator-dl-search-row");

      this.keywordInput = searchRow.createEl("input", {
        type: "text",
        cls: "curator-dl-keyword-input",
        placeholder: this.isMobileMode
          ? "输入动画名或「字幕组 + 番名」检索磁力…"
          : "输入动画名或「字幕组 动画名 分辨率」（如：喵萌奶茶屋 莉可丽丝 1080p）…"
      });
      this.keywordInput.value = this.currentKeyword;
      this.keywordInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const typed = this.keywordInput.value.trim();
          this.performSearch(typed, {
            preserveStreams: false,
            forceExactQuery: Boolean(typed && typed !== this.broadKeyword)
          });
        }
      };

      if (this.plugin.settings.enableComicatIntegration !== false) {
        const searchBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn is-primary"
        });
        v07Core.setBtnIconLabel(searchBtn, "search", "搜索资源", 14);
        searchBtn.onclick = () => {
          const typed = this.keywordInput.value.trim();
          this.performSearch(typed, {
            preserveStreams: false,
            forceExactQuery: Boolean(typed && typed !== this.broadKeyword)
          });
        };

        const openWebBtn = searchRow.createEl("button", {
          cls: "curator-dl-btn"
        });
        v07Core.setBtnIconLabel(openWebBtn, "external", "漫猫网页", 14);
        openWebBtn.title = "在浏览器中打开 www.comicat.org 搜索结果页";
        openWebBtn.onclick = () => {
          const kw = this.keywordInput.value.trim() || this.item?.name || "";
          window.open(buildComicatSearchUrl(kw, this.baseUrl));
        };

        if (!this.isMobileMode) {
          const copyRssBtn = searchRow.createEl("button", {
            cls: "curator-dl-btn"
          });
          v07Core.setBtnIconLabel(copyRssBtn, "copy", "复制 RSS", 14);
          copyRssBtn.dataset.dlAction = "copy-rss";
          copyRssBtn.title = "复制当前所选字幕组或搜索词对应的 RSS 订阅链接";
          copyRssBtn.onclick = async () => {
            const rssUrl = this.getEffectiveCurrentRssUrl();
            await copyTextCrossPlatform(rssUrl);
            if (NoticeClass) {
              new NoticeClass("已复制当前 RSS 订阅链接", 3200);
            }
          };
        }
      }

      const customWebBtn = searchRow.createEl("button", {
        cls: "curator-dl-btn is-subtle"
      });
      v07Core.setBtnIconLabel(customWebBtn, "external", "备用站", 14);
      customWebBtn.title = "在备用下载网站（如蜜柑计划/动漫花园）中搜索该动画";
      customWebBtn.onclick = () => {
        const kw = this.keywordInput.value.trim() || this.item?.name || "";
        window.open(buildCustomSearchUrl(this.plugin, kw));
      };

      this.chipsRow = searchBox.createDiv("curator-dl-chips-row");
      this.renderCandidateChipsRow();

      // 4. 主内容挂载区
      this.resultsMount = contentEl.createDiv("curator-dl-results-mount");
      this.renderResultsMount();
    }

    renderEnvStatus() {
      if (!this.envBox) return;
      this.envBox.empty();

      if (this.isMobileMode) {
        const mobileCol = this.envBox.createDiv("curator-dl-env-col is-mobile-env-col");
        const header = mobileCol.createDiv("curator-dl-env-line");
        header.createSpan({ cls: "curator-dl-status-dot is-ok" });
        header.createSpan({
          cls: "curator-dl-env-title",
          text: "手机端磁力检索（支持迅雷 / 夸克 / 115 / Flud 等下载工具）"
        });
        mobileCol.createDiv({
          cls: "curator-dl-env-path",
          text: "点击单集右侧「复制磁力」可粘贴到网盘离线观看，或点「唤起 App」调起本机下载应用。"
        });
        return;
      }

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
          ? "已填写下载路径（本地文件夹尚未创建）"
          : "尚未设置本地下载文件夹"
      });

      const pathText = folderCol.createDiv({
        cls: "curator-dl-env-path curator-mono",
        text: hasPath ? rawPath : "点击下方「自动创建本地目录」将按 年份/季度/番剧名 建立文件夹"
      });
      pathText.title = rawPath || "";

      const folderActions = folderCol.createDiv("curator-dl-env-actions");
      if (!folderExists) {
        const createDirBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(createDirBtn, "folder", "自动创建本地目录", 13);
        createDirBtn.onclick = async () => {
          createDirBtn.disabled = true;
          createDirBtn.textContent = "正在创建本地目录…";
          const res = await ensureAnimeLocalDownloadFolder(this.plugin, this.item, true);
          createDirBtn.disabled = false;
          if (res.ok && res.createdOnDisk) {
            this.lastFolderError = "";
            this.showCustomFolderInput = false;
            if (NoticeClass) {
              new NoticeClass(`已创建并绑定本地目录：\n${res.targetPath}`, 4200);
            }
          } else {
            this.lastFolderError =
              res.error ||
              res.noteError ||
              "无法创建本地文件夹，请检查本地动画根目录路径是否存在及磁盘写入权限。";
            if (NoticeClass) {
              new NoticeClass(`本地目录创建未成功：\n${this.lastFolderError}`, 6000);
            }
          }
          await this.refreshAllStates({ showNotice: false });
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

        const collectCloudBtn = folderActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(collectCloudBtn, "cloud", "从夸克/网盘目录归集", 13);
        collectCloudBtn.title =
          "扫描夸克网盘 (QuarkDownload)、百度网盘、迅雷及系统下载目录，将属于该番剧的视频移入本番文件夹";
        collectCloudBtn.onclick = async () => {
          collectCloudBtn.disabled = true;
          const res = await collectEpisodesFromCloudDriveFolders(this.plugin, this.item);
          collectCloudBtn.disabled = false;
          if (res.movedFiles && res.movedFiles.length > 0) {
            if (NoticeClass) {
              new NoticeClass(
                `已从网盘/默认下载目录归集 ${res.movedFiles.length} 个视频文件至本番目录`,
                4200
              );
            }
          } else if (NoticeClass) {
            new NoticeClass(
              "未在常见网盘下载目录（QuarkDownload / Downloads 等）中发现待归集的同名番剧视频"
            );
          }
          await this.refreshAllStates({ showNotice: false });
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
          placeholder: "输入或点右侧选择本机番剧保存文件夹…"
        });
        dirInput.value = defaultSuggested;
        const browseCustomDirBtn = customRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "选择文件夹…"
        });
        browseCustomDirBtn.onclick = async () => {
          browseCustomDirBtn.disabled = true;
          const picked = await pickNativeFolderOnDesktop({
            title: `选择《${this.item?.name || "番剧"}》本地目录`,
            initialDir: dirInput.value.trim() || cleanRoot || ""
          });
          browseCustomDirBtn.disabled = false;
          if (picked) {
            dirInput.value = picked;
          }
        };
        const saveCustomDirBtn = customRow.createEl("button", {
          cls: "curator-dl-mini-btn is-primary",
          text: "保存并绑定"
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
              new NoticeClass(`已绑定本地目录：\n${res.targetPath}`, 4200);
            }
          } else {
            this.lastFolderError = res.error || res.noteError || "指定目录无法创建";
            if (NoticeClass) {
              new NoticeClass(`目录绑定未成功：\n${this.lastFolderError}`, 6000);
            }
          }
          await this.refreshAllStates({ showNotice: false });
        };
      }

      if (folderExists && localInspect) {
        const anom = localInspect.anomalies || {};
        const dupList = Array.isArray(anom.duplicateEpisodes) ? anom.duplicateEpisodes : [];
        const subCount = Number(anom.subfolderStats?.totalInSubfolders) || 0;
        const extraCount = Array.isArray(localInspect.extraFiles) ? localInspect.extraFiles.length : 0;
        const incompleteCount = Number(anom.incompleteCount) || 0;

        if (localInspect.hasAttentionNeeded) {
          const warnParts = [];
          if (anom.suspectedParentContainer?.detected) {
            warnParts.push(
              `当前路径「${anom.suspectedParentContainer.folderName}」内含多部不同番剧子文件夹，已暂停混算以防串番`
            );
          }
          if (dupList.length > 0) {
            warnParts.push(`有 ${dupList.length} 话存在多份本地视频`);
          }
          if (Array.isArray(anom.skippedOtherSeasonDirs) && anom.skippedOtherSeasonDirs.length > 0) {
            warnParts.push(`已隔离其他季度子目录「${anom.skippedOtherSeasonDirs.join("、")}」`);
          }
          if (Array.isArray(anom.unnumberedMultipleVideos) && anom.unnumberedMultipleVideos.length > 0) {
            warnParts.push(`发现 ${anom.unnumberedMultipleVideos.length} 个未标话数的视频文件待核对`);
          }
          if (anom.hasBdmvStructure && localInspect.fileCount === 0) {
            warnParts.push("检测到 BDMV 原盘目录结构");
          }

          const warnBox = folderCol.createDiv("curator-dl-folder-warn-box");
          warnBox.style.cssText =
            "margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(217,130,43,0.11);border:1px solid rgba(217,130,43,0.34);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;";
          warnBox.createDiv({
            text: warnParts.join("；") + "。",
            attr: { style: "font-size:12px;line-height:1.5;color:var(--text-normal);flex:1 1 240px;" }
          });
          const resolveBtn = warnBox.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: "查看并处理…"
          });
          resolveBtn.onclick = () => {
            openLocalFolderDiagnosticsModal(this.plugin, this.item, () => {
              this.refreshAllStates({ showNotice: false });
            });
          };
        } else if (subCount > 0 || extraCount > 0 || incompleteCount > 0) {
          const infoBits = [];
          if (subCount > 0) infoBits.push(`子文件夹内 ${subCount} 集`);
          if (extraCount > 0) infoBits.push(`另含特典/OP/ED ${extraCount} 项`);
          if (incompleteCount > 0) infoBits.push(`下载中分片 ${incompleteCount} 个`);

          const subInfoRow = folderCol.createDiv("curator-dl-subfolder-info-row");
          subInfoRow.style.cssText =
            "margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:var(--text-muted);";
          subInfoRow.createSpan({ text: infoBits.join(" · ") });
          if (subCount > 0 || extraCount > 0) {
            const detailBtn = subInfoRow.createEl("button", {
              cls: "curator-dl-mini-btn is-subtle",
              text: extraCount > 0 ? "子目录与特典…" : "子目录详情…"
            });
            detailBtn.onclick = () => {
              openLocalFolderDiagnosticsModal(this.plugin, this.item, () => {
                this.refreshAllStates({ showNotice: false });
              });
            };
          }
        }
      }

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
          delBtn.title = `删除本地《${vf.name}》并从 qBittorrent 移除对应任务`;
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
                  res.removedQbTorrents > 0 ? `并清理 qBittorrent 任务` : ""
                }${!isWatched ? `（已记录已看至第 ${epNum} 话）` : ""}`
              );
            }
            await this.refreshAllStates({ showNotice: false });
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
          text: "qBittorrent 联动已关闭（当前为磁力/种子自选下载模式）"
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path",
          text: "点击下方剧集的「磁力/网盘」或「种子」可使用任意工具下载。"
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
          text: "qBittorrent 正在运行"
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
              ? "添加任务：直接存入番剧目录"
              : "添加任务：弹出 qB 确认框"
        });
        toggleSkipBtn.title = "点击切换投递种子至 qBittorrent 时是否弹出添加确认框";
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
          text: "已检测到 qBittorrent（尚未启动）"
        });
        qbCol.createDiv({
          cls: "curator-dl-env-path",
          text: "点击下载剧集时会自动启动 qBittorrent，也可立即打开："
        });
        const qbActions = qbCol.createDiv("curator-dl-env-actions");
        const startQbBtn = qbActions.createEl("button", {
          cls: "curator-dl-mini-btn is-accent"
        });
        v07Core.setBtnIconLabel(startQbBtn, "play", "启动 qBittorrent", 13);
        startQbBtn.onclick = async () => {
          startQbBtn.disabled = true;
          startQbBtn.textContent = "正在启动…";
          const res = await launchQbittorrentClient(this.plugin);
          if (res.ok && NoticeClass) {
            new NoticeClass("已启动 qBittorrent 客户端");
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
          text: "可前往官网下载安装 qBittorrent，或直接使用磁力/网盘下载："
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
          text: "切换为纯磁力/网盘模式"
        });
        disableQbBtn.onclick = async () => {
          this.plugin.settings.enableQbittorrentIntegration = false;
          await this.plugin.saveSettings();
          this.renderEnvStatus();
          this.renderResultsMount();
        };
      }
    }

    renderAutoFollowBar() {
      if (!this.autoFollowBox) return;
      this.autoFollowBox.empty();
      if (this.isMobileMode) {
        this.autoFollowBox.style.display = "none";
        return;
      }
      this.autoFollowBox.style.display = "";

      const follow = getAnimeAutoFollowState(this.plugin, this.item);
      const bar = this.autoFollowBox.createDiv(
        `curator-dl-autofollow-bar is-${follow.status}`
      );

      const left = bar.createDiv("curator-dl-autofollow-left");
      if (follow.status === "active") {
        left.createSpan({ cls: "curator-dl-status-dot is-ok" });
        left.createSpan({
          cls: "curator-dl-autofollow-badge is-active",
          text: "自动追更中"
        });
        left.createSpan({
          cls: "curator-dl-autofollow-desc",
          text: `锁定字幕组「${follow.sourceLabel}」— 有未看新集更新时自动推送至 qBittorrent`
        });
      } else if (follow.status === "paused") {
        left.createSpan({ cls: "curator-dl-status-dot is-warn" });
        left.createSpan({
          cls: "curator-dl-autofollow-badge is-paused",
          text: "追更已暂停"
        });
        left.createSpan({
          cls: "curator-dl-autofollow-desc",
          text: `保留源「${follow.sourceLabel}」，当前不会自动下载新集`
        });
      } else {
        left.createSpan({ cls: "curator-dl-status-dot is-muted" });
        left.createSpan({
          cls: "curator-dl-autofollow-badge",
          text: "未开启追更"
        });
        left.createSpan({
          cls: "curator-dl-autofollow-desc",
          text: "在下方点选一家字幕组后点击「设为自动追更」，更新的新集将自动交由 qBittorrent 下载"
        });
      }

      const right = bar.createDiv("curator-dl-autofollow-actions");
      if (follow.status === "active") {
        const pauseBtn = right.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "暂停追更"
        });
        pauseBtn.dataset.dlAction = "pause-autofollow";
        pauseBtn.onclick = async () => {
          pauseBtn.disabled = true;
          await setAnimeAutoFollowEnabled(this.plugin, this.item, false);
          if (NoticeClass) new NoticeClass(`已暂停《${this.item?.name}》的自动追更`, 3200);
          await this.refreshAllStates({ showNotice: false });
        };

        const cancelBtn = right.createEl("button", {
          cls: "curator-dl-mini-btn is-danger-outline",
          text: "取消追更"
        });
        cancelBtn.dataset.dlAction = "cancel-autofollow";
        cancelBtn.title = "删除该番剧的自动追更订阅，并清空笔记中的已绑定下载源";
        cancelBtn.onclick = async () => {
          cancelBtn.disabled = true;
          await removeAnimeAutoFollowAndUnbind(this.plugin, this.item);
          if (NoticeClass) new NoticeClass(`已取消《${this.item?.name}》的自动追更`, 3200);
          await this.refreshAllStates({ showNotice: false });
        };
      } else if (follow.status === "paused") {
        const resumeBtn = right.createEl("button", {
          cls: "curator-dl-mini-btn is-primary",
          text: "恢复追更"
        });
        resumeBtn.dataset.dlAction = "resume-autofollow";
        resumeBtn.onclick = async () => {
          resumeBtn.disabled = true;
          await setAnimeAutoFollowEnabled(this.plugin, this.item, true);
          if (NoticeClass) new NoticeClass(`已恢复《${this.item?.name}》的自动追更`, 3200);
          await this.refreshAllStates({ showNotice: false });
        };

        const cancelBtn = right.createEl("button", {
          cls: "curator-dl-mini-btn is-danger-outline",
          text: "取消追更"
        });
        cancelBtn.dataset.dlAction = "cancel-autofollow";
        cancelBtn.onclick = async () => {
          cancelBtn.disabled = true;
          await removeAnimeAutoFollowAndUnbind(this.plugin, this.item);
          if (NoticeClass) new NoticeClass(`已取消《${this.item?.name}》的自动追更`, 3200);
          await this.refreshAllStates({ showNotice: false });
        };
      }

      if (follow.totalRuleCount > 0) {
        const allMgrBtn = right.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: `管理全部追更 (${follow.totalActiveCount})`
        });
        allMgrBtn.dataset.dlAction = "open-all-autofollow";
        allMgrBtn.title = "查看、暂停或取消仓库内所有番剧的自动追更规则";
        allMgrBtn.onclick = () => {
          openAllRssSubscriptionsManagerModal(this.plugin, () => {
            this.refreshAllStates({ showNotice: false });
          });
        };
      }
    }

    syncStateFromBroadDataset({ preferBoundOrComplete = false, preserveActiveStream = false } = {}) {
      const ds = this.broadDataset;
      if (!ds) return;

      const activeStreams = this.includeDerivedResources ? ds.allStreamsWithDerived : ds.streams;
      const activeSubgroups = this.includeDerivedResources ? ds.allSubgroupsWithDerived : ds.subgroups;
      const activeItems = this.includeDerivedResources ? ds.allItems : ds.primaryItems;

      this.broadStreams = activeStreams || [];
      this.broadSubgroups = activeSubgroups || [];
      const broadDedup = deduplicateEpisodeItems(activeItems || []);
      this.broadSnapshot = {
        keyword: ds.keyword,
        dedup: broadDedup,
        episodes: broadDedup.episodes,
        packs: broadDedup.packs,
        unnumbered: broadDedup.unnumbered
      };

      if (preserveActiveStream && this.activeStreamId) {
        const found = this.broadStreams.find((s) => s.streamId === this.activeStreamId);
        if (found) {
          this.selectStreamDirectly(found, { silentRender: true });
          return;
        }
      }

      if (preferBoundOrComplete && this.broadStreams.length > 0) {
        // 1) 若当前已开启追更或笔记已绑定发布源标识/关键词，优先对准该字幕组流
        const follow = !this.isMobileMode ? getAnimeAutoFollowState(this.plugin, this.item) : null;
        const boundStreamId = String(follow?.streamId || this.item?.downloadStreamId || "").trim();
        const boundKw = String(follow?.keyword || this.item?.downloadSourceKeyword || "").trim();
        if (boundStreamId || boundKw) {
          const matchedBound =
            this.broadStreams.find((s) => boundStreamId && s.streamId === boundStreamId) ||
            this.broadStreams.find((s) => boundKw && s.recommendedKeyword === boundKw) ||
            this.broadStreams.find(
              (s) =>
                boundKw &&
                boundKw !== this.broadKeyword &&
                s.group &&
                boundKw.toLowerCase().includes(s.group.toLowerCase())
            );
          if (matchedBound) {
            this.selectedSubgroupFilter = matchedBound.group;
            this.selectStreamDirectly(matchedBound, { silentRender: true });
            return;
          }
        }

        // 2) 默认聚焦排名最高且集数完整的单一字幕组流（即便新番仅播出第 1 话也自动锁定单组，防止多字幕组混排误投递）
        const watchedNow = Number(this.item?.watchedEpisodes) || 0;
        const firstComplete =
          this.broadStreams.find(
            (st) =>
              st.episodeCount > 0 &&
              st.minEp !== null &&
              st.minEp <= watchedNow + 1 &&
              st.episodeCount >= Math.max(1, broadDedup.episodes.length - 1)
          ) ||
          this.broadStreams.find(
            (st) => st.episodeCount > 0 && st.group && st.group !== "其他发布源"
          );
        if (firstComplete) {
          this.selectStreamDirectly(firstComplete, { silentRender: true });
          return;
        }
      }

      this.activeStreamId = "";
      this.activeCustomRssUrl = "";
      this.currentDedupInfo = broadDedup;
      this.currentEpisodes = broadDedup.episodes;
      this.currentPacks = broadDedup.packs;
      this.currentUnnumbered = broadDedup.unnumbered;
    }

    selectStreamDirectly(st, { silentRender = false } = {}) {
      if (!st) return;
      this.activeStreamId = st.streamId;
      this._isCustomFilteredSearch = false;
      this.currentKeyword = st.recommendedKeyword || this.broadKeyword;
      if (this.keywordInput) {
        this.keywordInput.value = this.currentKeyword;
      }

      const sampleTitle = String(st.rawItems?.[0]?.title || "").toLowerCase();
      const firstGroupToken = String(st.group || "").split("&")[0].trim().toLowerCase();
      const groupAppearsInTitle = Boolean(firstGroupToken && sampleTitle.includes(firstGroupToken));
      this.activeCustomRssUrl =
        !groupAppearsInTitle && st.mikanRssUrl
          ? st.mikanRssUrl
          : buildComicatRssUrl(this.currentKeyword, this.baseUrl);

      const dedup = st.dedup || deduplicateEpisodeItems(st.rawItems || []);
      this.currentDedupInfo = dedup;
      this.currentEpisodes = dedup.episodes;
      this.currentPacks = dedup.packs;
      this.currentUnnumbered = dedup.unnumbered;

      if (!silentRender) {
        this.renderAutoFollowBar();
        this.renderResultsMount();
      }
    }

    async performSearch(keyword, opts = {}) {
      const cleanKw = String(keyword || "").trim();
      if (!cleanKw) return;
      const seq = (this._searchSeq += 1);

      if (opts.isInitial) {
        this._userManuallyPickedStream = false;
        this._isCustomFilteredSearch = false;
      } else if (opts.preserveStreams) {
        this._userManuallyPickedStream = true;
        this._isCustomFilteredSearch = true;
        this.activeStreamId = "";
      } else {
        this._userManuallyPickedStream = false;
        this._isCustomFilteredSearch = Boolean(opts.forceExactQuery);
        this.activeStreamId = "";
        this.activeCustomRssUrl = "";
        this.selectedSubgroupFilter = "";
      }

      this.currentKeyword = cleanKw;
      if (this.keywordInput && this.keywordInput.value !== cleanKw) {
        this.keywordInput.value = cleanKw;
      }

      this.renderAutoFollowBar();
      this.isLoading = true;
      this.errorMessage = "";
      this.renderResultsMount();

      try {
        const fetchTargetKw =
          opts.isInitial && this.broadKeyword ? this.broadKeyword : cleanKw;

        const dataset = await fetchFederatedAnimeSearchDataset(this.plugin, this.item, fetchTargetKw, {
          baseUrl: this.baseUrl,
          isMobile: this.isMobileMode,
          forceExactQuery: Boolean(opts.forceExactQuery),
          bypassCache: Boolean(opts.bypassCache)
        });
        if (!this.modalEl || !this.modalEl.isConnected || this._searchSeq !== seq) return;

        if (Array.isArray(dataset.bgmAliases) && dataset.bgmAliases.length > 0) {
          this.discoveredAliases = dataset.bgmAliases;
          this.renderCandidateChipsRow();
        }

        if (!opts.preserveStreams || !this.broadDataset) {
          this.broadDataset = dataset;
          this.broadHitLimit = (dataset.mioMaxPage || 0) > (dataset.mioFetchedPages?.length || 0);
          this.syncStateFromBroadDataset({
            preferBoundOrComplete: Boolean((opts.isInitial || !opts.forceExactQuery) && !this._isCustomFilteredSearch)
          });

          if (
            opts.isInitial &&
            cleanKw !== fetchTargetKw &&
            !this.activeStreamId
          ) {
            const customDs = await fetchFederatedAnimeSearchDataset(this.plugin, this.item, cleanKw, {
              baseUrl: this.baseUrl,
              isMobile: this.isMobileMode,
              forceExactQuery: true,
              bypassCache: Boolean(opts.bypassCache)
            });
            if (!this.modalEl || !this.modalEl.isConnected || this._searchSeq !== seq) return;
            if (customDs.allItems.length > 0) {
              const dedup = deduplicateEpisodeItems(customDs.allItems);
              this.currentKeyword = cleanKw;
              this._isCustomFilteredSearch = true;
              if (this.keywordInput) this.keywordInput.value = cleanKw;
              this.currentDedupInfo = dedup;
              this.currentEpisodes = dedup.episodes;
              this.currentPacks = dedup.packs;
              this.currentUnnumbered = dedup.unnumbered;
            }
          }
        } else {
          const dedup = deduplicateEpisodeItems(dataset.allItems);
          this.activeCustomRssUrl = "";
          this._isCustomFilteredSearch = true;
          this.currentDedupInfo = dedup;
          this.currentEpisodes = dedup.episodes;
          this.currentPacks = dedup.packs;
          this.currentUnnumbered = dedup.unnumbered;
        }
      } catch (err) {
        if (!this.modalEl || !this.modalEl.isConnected || this._searchSeq !== seq) return;
        this.errorMessage = err?.message || "请求资源站点失败";
        this.currentEpisodes = [];
        this.currentPacks = [];
        this.currentUnnumbered = [];
        this.currentDedupInfo = null;
      } finally {
        if (this.modalEl && this.modalEl.isConnected && this._searchSeq === seq) {
          this.isLoading = false;
          this.renderAutoFollowBar();
          this.renderResultsMount();
        }
      }
    }

    async handleLoadMorePages() {
      if (!this.broadDataset || this.isLoadingMorePages) return;
      this.isLoadingMorePages = true;
      this.renderResultsMount();
      try {
        await loadMoreMioBtPagesIntoDataset(this.broadDataset, {
          pagesCount: this.isMobileMode ? 4 : 6,
          baseUrl: this.baseUrl,
          isMobile: this.isMobileMode
        });
        if (!this.modalEl || !this.modalEl.isConnected) return;
        this.broadHitLimit =
          (this.broadDataset.mioMaxPage || 0) > (this.broadDataset.mioFetchedPages?.length || 0);
        this.syncStateFromBroadDataset({ preserveActiveStream: true });
      } catch (_) {
      } finally {
        if (this.modalEl && this.modalEl.isConnected) {
          this.isLoadingMorePages = false;
          this.renderResultsMount();
        }
      }
    }

    renderDownloadActionButtons(actCol, targetItem, { actionLabel, isPack = false, qbStatus }) {
      if (!this.isMobileMode && qbStatus.enabled && qbStatus.installed) {
        const qbBtn = actCol.createEl("button", {
          cls: "curator-dl-mini-btn is-primary"
        });
        v07Core.setBtnIconLabel(qbBtn, "download", isPack ? "qB下载合集" : "qB下载", 13);
        qbBtn.title = "使用 qBittorrent 下载至本番剧本地文件夹";
        qbBtn.onclick = async () => {
          qbBtn.disabled = true;
          const res = await dispatchDownloadToQbittorrent(this.plugin, this.item, [targetItem]);
          qbBtn.disabled = false;
          if (res.ok && NoticeClass) {
            new NoticeClass(`已将《${this.item.name}》${actionLabel}添加至 qBittorrent`, 3800);
          } else if (!res.ok && NoticeClass) {
            new NoticeClass(`发送失败：${res.reason || "未知原因"}`, 5000);
          }
          this.renderEnvStatus();
        };
      }

      if (targetItem.magnetUrl) {
        if (this.isMobileMode) {
          const copyMagBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-primary"
          });
          v07Core.setBtnIconLabel(copyMagBtn, "copy", "复制磁力", 13);
          copyMagBtn.onclick = async () => {
            const mag = buildCompactMobileMagnet(targetItem);
            const ok = await copyTextCrossPlatform(mag);
            if (NoticeClass) {
              new NoticeClass(
                ok
                  ? `已复制${actionLabel}磁力链接，可粘贴到迅雷 / 夸克 / 115 / Flud 离线下载`
                  : "复制失败，请稍后重试",
                3600
              );
            }
          };

          const launchAppBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn is-accent"
          });
          v07Core.setBtnIconLabel(launchAppBtn, "magnet", "唤起 App", 13);
          launchAppBtn.onclick = () => {
            launchMagnetCrossPlatform(buildCompactMobileMagnet(targetItem));
            if (NoticeClass) {
              new NoticeClass(`正在唤起本机下载应用（${actionLabel}）…`, 2800);
            }
          };
        } else {
          const magBtn = actCol.createEl("button", {
            cls: "curator-dl-mini-btn"
          });
          v07Core.setBtnIconLabel(magBtn, "magnet", "磁力/网盘", 13);
          magBtn.title = "唤起磁力链接（如夸克网盘/迅雷），并自动复制本番剧本地文件夹路径到剪贴板";
          magBtn.onclick = async () => {
            const folderRes = await ensureAnimeLocalDownloadFolder(this.plugin, this.item, true);
            const winFolder =
              folderRes.ok && folderRes.targetPath ? path.normalize(folderRes.targetPath) : "";
            if (navigator.clipboard) {
              await navigator.clipboard
                .writeText(winFolder || targetItem.magnetUrl)
                .catch(() => {});
            }
            window.open(enrichMagnetUrlWithTrackers(targetItem.magnetUrl));
            if (NoticeClass) {
              new NoticeClass(
                winFolder
                  ? `已拉起磁力/网盘下载，并将保存路径复制到剪贴板：\n${winFolder}`
                  : `已唤起磁力链接（${actionLabel}）`,
                4800
              );
            }
          };
        }
      }

      if (targetItem.torrentUrl) {
        const torBtn = actCol.createEl("button", {
          cls: "curator-dl-mini-btn"
        });
        v07Core.setBtnIconLabel(torBtn, "file", "种子", 13);
        torBtn.title = "下载 .torrent 种子文件";
        torBtn.onclick = () => {
          window.open(targetItem.torrentUrl);
        };
      }

      if (targetItem.link) {
        const pageBtn = actCol.createEl("button", {
          cls: "curator-dl-mini-btn is-subtle"
        });
        pageBtn.appendChild(v07Core.icon("external", 13));
        pageBtn.title = "打开资源发布详情页";
        pageBtn.onclick = () => {
          window.open(targetItem.link);
        };
      }
    }

    renderResultsMount() {
      if (!this.resultsMount) return;
      this.resultsMount.empty();

      if (this.plugin.settings.enableComicatIntegration === false) {
        const disabledBox = this.resultsMount.createDiv("curator-dl-empty-box");
        disabledBox.createDiv({
          cls: "curator-dl-empty-title",
          text: "已关闭内置资源检索"
        });
        disabledBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "您可使用上方「备用站」跳转至外部网站下载，或在下方重新开启内置检索。"
        });
        const reEnableBtn = disabledBox.createEl("button", {
          cls: "curator-dl-btn is-primary",
          text: "重新开启内置资源检索"
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
          text: `正在搜索「${this.currentKeyword}」的字幕组与剧集列表…`
        });
        return;
      }

      if (this.errorMessage) {
        const errBox = this.resultsMount.createDiv("curator-dl-empty-box is-error");
        errBox.createDiv({
          cls: "curator-dl-empty-title",
          text: `未能获取资源数据：${this.errorMessage}`
        });
        errBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "请检查网络连接或点击右上角「刷新状态」重试，也可直接点击上方「漫猫网页」或「备用站」在浏览器中查看。"
        });
        return;
      }

      const ds = this.broadDataset;
      const derivedCount = Array.isArray(ds?.derivedItems) ? ds.derivedItems.length : 0;
      const mioFetchedCount = Array.isArray(ds?.mioFetchedPages) ? ds.mioFetchedPages.length : 0;
      const mioMaxPage = Number(ds?.mioMaxPage) || 0;
      const hasMoreMioPages = mioMaxPage > mioFetchedCount;

      // 1. 字幕组与规格选择区
      if (this.broadStreams.length > 0) {
        const filteredStreams = this.selectedSubgroupFilter
          ? this.broadStreams.filter((s) => s.group === this.selectedSubgroupFilter)
          : this.broadStreams;
        const effectiveStreamPool = filteredStreams.length > 0 ? filteredStreams : this.broadStreams;

        const totalStreamCount = effectiveStreamPool.length;
        const defaultLimit = 12;
        const hasMoreStreams = totalStreamCount > defaultLimit;
        const isExpandedAll =
          Boolean(this.streamsExpanded) || Boolean(this.selectedSubgroupFilter) || !hasMoreStreams;
        const visibleStreams = isExpandedAll
          ? effectiveStreamPool
          : effectiveStreamPool.slice(0, defaultLimit);

        const streamSection = this.resultsMount.createDiv("curator-dl-streams-section");
        const streamHeader = streamSection.createDiv("curator-dl-section-head");
        const streamHeaderTop = streamHeader.createDiv("curator-dl-section-head-row");
        const subgroupTotalCount = this.broadSubgroups.length;

        streamHeaderTop.createDiv({
          cls: "curator-dl-section-title",
          text: `选择字幕组（共 ${subgroupTotalCount} 组${
            this.broadStreams.length > subgroupTotalCount ? ` · ${this.broadStreams.length} 种规格` : ""
          }）`
        });

        const streamHeaderBtns = streamHeaderTop.createDiv("curator-dl-stream-head-btns");

        if ((this.activeStreamId || this.selectedSubgroupFilter) && this.broadSnapshot) {
          const resetBroadBtn = streamHeaderBtns.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: "查看全部混排"
          });
          resetBroadBtn.title = "查看全部字幕组混合排列的结果";
          resetBroadBtn.onclick = () => {
            this._userManuallyPickedStream = true;
            this._isCustomFilteredSearch = false;
            this.selectedSubgroupFilter = "";
            this.activeStreamId = "";
            this.activeCustomRssUrl = "";
            this.currentKeyword = this.broadSnapshot.keyword;
            if (this.keywordInput) this.keywordInput.value = this.broadSnapshot.keyword;
            this.currentDedupInfo = this.broadSnapshot.dedup;
            this.currentEpisodes = this.broadSnapshot.episodes;
            this.currentPacks = this.broadSnapshot.packs;
            this.currentUnnumbered = this.broadSnapshot.unnumbered || [];
            this.renderAutoFollowBar();
            this.renderResultsMount();
          };
        }

        if (derivedCount > 0) {
          const toggleDerivedBtn = streamHeaderBtns.createEl("button", {
            cls: `curator-dl-mini-btn ${this.includeDerivedResources ? "is-primary" : ""}`,
            text: this.includeDerivedResources
              ? `隐藏衍生/其他季 (${derivedCount})`
              : `显示衍生/其他季 (${derivedCount})`
          });
          toggleDerivedBtn.title = "切换是否显示同系列短篇、剧场版或其他季度资源";
          toggleDerivedBtn.onclick = () => {
            this.includeDerivedResources = !this.includeDerivedResources;
            this.syncStateFromBroadDataset({ preserveActiveStream: true });
            this.renderAutoFollowBar();
            this.renderResultsMount();
          };
        }

        if (hasMoreMioPages) {
          const loadMoreBtn = streamHeaderBtns.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: this.isLoadingMorePages
              ? "读取中…"
              : `加载更早页 (${mioFetchedCount}/${mioMaxPage}页)`
          });
          loadMoreBtn.disabled = this.isLoadingMorePages;
          loadMoreBtn.title = `漫猫共匹配 ${ds?.mioTotalMatches || 0} 条记录（共 ${mioMaxPage} 页），当前已读 ${mioFetchedCount} 页`;
          loadMoreBtn.onclick = () => {
            this.handleLoadMorePages();
          };
        }

        if (hasMoreStreams && !this.selectedSubgroupFilter) {
          const toggleExpandBtn = streamHeaderBtns.createEl("button", {
            cls: "curator-dl-mini-btn is-accent curator-dl-streams-toggle-btn",
            text: isExpandedAll
              ? `收起卡片`
              : `展开全部 (${totalStreamCount})`
          });
          toggleExpandBtn.onclick = () => {
            this.streamsExpanded = !this.streamsExpanded;
            this.renderResultsMount();
          };
        }

        // 1a. 字幕组直达快筛条
        if (this.broadSubgroups.length > 1) {
          const sgBar = streamSection.createDiv("curator-dl-subgroup-bar");
          const allSgBtn = sgBar.createEl("button", {
            cls: `curator-dl-subgroup-pill ${!this.selectedSubgroupFilter ? "is-active" : ""}`,
            text: `全部字幕组 (${this.broadSubgroups.length})`
          });
          allSgBtn.onclick = () => {
            this.selectedSubgroupFilter = "";
            this.renderResultsMount();
          };

          const maxInlineGroups = this.isMobileMode || this.subgroupsExpanded ? this.broadSubgroups.length : 16;
          const visibleSubgroups = this.broadSubgroups.slice(0, maxInlineGroups);
          for (const sg of visibleSubgroups) {
            const isSgActive = this.selectedSubgroupFilter === sg.group;
            const countBadge =
              sg.maxEpisodeCount > 0
                ? `${sg.maxEpisodeCount}集`
                : sg.packCount > 0
                ? `合集${sg.packCount}`
                : `${sg.totalItemCount}条`;
            const sgBtn = sgBar.createEl("button", {
              cls: `curator-dl-subgroup-pill ${isSgActive ? "is-active" : ""}`,
              text: `${sg.group} · ${countBadge}`
            });
            sgBtn.onclick = () => {
              this._userManuallyPickedStream = true;
              if (this.selectedSubgroupFilter === sg.group) {
                this.selectedSubgroupFilter = "";
                this.renderResultsMount();
                return;
              }
              this.selectedSubgroupFilter = sg.group;
              const bestSt =
                this.broadStreams.find((s) => s.streamId === sg.bestStreamId) ||
                this.broadStreams.find((s) => s.group === sg.group);
              if (bestSt) {
                this.selectStreamDirectly(bestSt);
              } else {
                this.renderResultsMount();
              }
            };
          }

          if (!this.isMobileMode && this.broadSubgroups.length > maxInlineGroups) {
            const moreSgBtn = sgBar.createEl("button", {
              cls: "curator-dl-subgroup-pill is-more-toggle",
              text: `+ 其余 ${this.broadSubgroups.length - maxInlineGroups} 组`
            });
            moreSgBtn.onclick = () => {
              this.subgroupsExpanded = true;
              this.renderResultsMount();
            };
          } else if (!this.isMobileMode && this.subgroupsExpanded && this.broadSubgroups.length > 16) {
            const foldSgBtn = sgBar.createEl("button", {
              cls: "curator-dl-subgroup-pill is-more-toggle",
              text: "收起字幕组"
            });
            foldSgBtn.onclick = () => {
              this.subgroupsExpanded = false;
              this.renderResultsMount();
            };
          }
        }

        // 1b. 版本规格卡片网格
        const streamGrid = streamSection.createDiv(
          `curator-dl-stream-grid ${isExpandedAll && totalStreamCount > defaultLimit ? "is-expanded-scroll" : ""}`
        );
        for (const st of visibleStreams) {
          const isSelected = this.activeStreamId === st.streamId;
          const card = streamGrid.createDiv(
            `curator-dl-stream-card ${isSelected ? "is-active" : ""}`
          );
          const topRow = card.createDiv("curator-dl-stream-top");
          topRow.createSpan({
            cls: "curator-dl-stream-group",
            text: st.group
          });
          const epRangeSuffix =
            st.episodeCount > 0 &&
            Number.isFinite(st.minEp) &&
            Number.isFinite(st.maxEp)
              ? ` (${String(st.minEp).padStart(2, "0")}-${String(st.maxEp).padStart(2, "0")})`
              : "";
          topRow.createSpan({
            cls: "curator-dl-stream-epcount curator-mono",
            text:
              st.episodeCount > 0
                ? `${st.episodeCount} 集${epRangeSuffix}${st.packCount > 0 ? ` + 合集` : ""}`
                : st.packCount > 0
                ? `合集 ${st.packCount} 条`
                : `单篇 ${st.unnumberedCount || st.totalRawCount} 条`
          });

          const tagsRow = card.createDiv("curator-dl-stream-tags");
          const tags = [];
          for (const t of [st.mediaSource, st.platform, st.lang, st.resolution, st.format]) {
            if (t && !tags.includes(t)) tags.push(t);
          }
          if (tags.length > 0) {
            tags.forEach((tag) => {
              tagsRow.createSpan({ cls: "curator-dl-stream-tag", text: tag });
            });
          } else {
            tagsRow.createSpan({ cls: "curator-dl-stream-tag", text: "默认规格" });
          }

          card.onclick = () => {
            this._userManuallyPickedStream = true;
            this.selectStreamDirectly(st);
          };
        }

        if (hasMoreStreams && !isExpandedAll) {
          const expandMoreBar = streamSection.createEl("button", {
            cls: "curator-dl-streams-more-bar",
            text: `▾ 展开其余 ${totalStreamCount - defaultLimit} 种规格`
          });
          expandMoreBar.onclick = () => {
            this.streamsExpanded = true;
            this.renderResultsMount();
          };
        }
      }

      // 2. 核对当前单集、合集包与单篇/剧场版资源
      const fallbackBroadPacks =
        this.currentPacks.length === 0 &&
        this.currentEpisodes.length === 0 &&
        Array.isArray(this.broadSnapshot?.packs)
          ? this.broadSnapshot.packs
          : [];
      const effectivePacks =
        this.currentPacks.length > 0 ? this.currentPacks : fallbackBroadPacks;
      const isShowingBroadPacksFallback =
        this.currentPacks.length === 0 && fallbackBroadPacks.length > 0;
      const effectiveUnnumbered = Array.isArray(this.currentUnnumbered) ? this.currentUnnumbered : [];

      if (
        this.currentEpisodes.length === 0 &&
        effectivePacks.length === 0 &&
        effectiveUnnumbered.length === 0
      ) {
        const emptyBox = this.resultsMount.createDiv("curator-dl-empty-box");
        emptyBox.createDiv({
          cls: "curator-dl-empty-title",
          text: `暂未检索到「${this.currentKeyword}」的视频资源`
        });
        emptyBox.createDiv({
          cls: "curator-dl-empty-sub",
          text: "该动画可能尚未开播、暂无人搬运或使用了特殊译名。您可点选上方的「快捷词条」切换别名重试，或点击「漫猫网页 / 备用站」查看。"
        });
        return;
      }

      // 3. 当前字幕组概览与批量下载/追更操作栏
      const localEpSet = this.getLocalExistingEpisodeSet();
      const watchedEp = Number(this.item?.watchedEpisodes) || 0;
      const allNotInFolder = this.currentEpisodes.filter(
        (epItem) => !localEpSet.has(Number(epItem.episode))
      );
      const unwatchedMissing = allNotInFolder.filter(
        (epItem) => Number(epItem.episode) > watchedEp
      );
      const localInCurrentCount = this.currentEpisodes.length - allNotInFolder.length;

      const curMinEp = this.currentDedupInfo?.minEp ?? null;
      const curMaxEp = this.currentDedupInfo?.maxEp ?? null;
      const rangeText =
        curMinEp !== null && curMaxEp !== null
          ? `第 ${String(curMinEp).padStart(2, "0")}–${String(curMaxEp).padStart(2, "0")} 话`
          : "";

      if (this.currentEpisodes.length > 0 && curMinEp !== null && curMinEp > watchedEp + 1) {
        const missingStart = watchedEp + 1;
        const missingEnd = curMinEp - 1;
        const missingRangeLabel =
          missingStart === missingEnd
            ? `第 ${String(missingStart).padStart(2, "0")} 话`
            : `第 ${String(missingStart).padStart(2, "0")}–${String(missingEnd).padStart(2, "0")} 话`;

        const bestCompleteStream = this.broadStreams.find(
          (st) =>
            st.minEp !== null &&
            st.minEp <= watchedEp + 1 &&
            st.episodeCount > this.currentEpisodes.length
        );

        const gapWarn = this.resultsMount.createDiv("curator-dl-gap-warn-banner");
        gapWarn.createDiv({
          cls: "curator-dl-gap-warn-text",
          text: `当前字幕组未包含 ${missingRangeLabel}（仅有 ${rangeText}，您已看 ${watchedEp} 话）：该组可能中途开坑、早期集数打了合集包，或位于更早页码。`
        });
        const gapBtns = gapWarn.createDiv("curator-dl-stream-head-btns");
        if (bestCompleteStream) {
          const switchCompleteBtn = gapBtns.createEl("button", {
            cls: "curator-dl-mini-btn is-primary",
            text: `切换至「${bestCompleteStream.group}」（共 ${bestCompleteStream.episodeCount} 集）`
          });
          switchCompleteBtn.onclick = () => {
            this._userManuallyPickedStream = true;
            this.selectedSubgroupFilter = bestCompleteStream.group;
            this.selectStreamDirectly(bestCompleteStream);
          };
        }
        if (hasMoreMioPages) {
          const deepLoadBtn = gapBtns.createEl("button", {
            cls: "curator-dl-mini-btn is-accent",
            text: this.isLoadingMorePages ? "读取中…" : "加载更早页"
          });
          deepLoadBtn.disabled = this.isLoadingMorePages;
          deepLoadBtn.onclick = () => this.handleLoadMorePages();
        }
      }

      const isMixedMultiSubgroupView =
        !this.activeStreamId && !this._isCustomFilteredSearch && this.broadSubgroups.length > 1;
      const activeStreamObj = this.activeStreamId
        ? this.broadStreams.find((s) => s.streamId === this.activeStreamId)
        : null;

      const actionBanner = this.resultsMount.createDiv("curator-dl-verify-banner");
      const verifyLeft = actionBanner.createDiv("curator-dl-verify-info");

      let bannerTitleText = "";
      let bannerSubText = "";
      if (this.currentEpisodes.length === 0) {
        if (effectivePacks.length > 0 && effectiveUnnumbered.length > 0) {
          bannerTitleText = `${
            activeStreamObj ? `当前字幕组：${activeStreamObj.streamId} · ` : ""
          }合集包 ${effectivePacks.length} 条 · 单篇资源 ${effectiveUnnumbered.length} 条`;
        } else if (effectivePacks.length > 0) {
          bannerTitleText = `${
            activeStreamObj ? `当前字幕组：${activeStreamObj.streamId} · ` : ""
          }季度全集 / 合集包 ${effectivePacks.length} 条`;
        } else {
          bannerTitleText = `${
            activeStreamObj ? `当前字幕组：${activeStreamObj.streamId} · ` : ""
          }剧场版 / 单篇资源 ${effectiveUnnumbered.length} 条`;
        }
      } else if (isMixedMultiSubgroupView) {
        bannerTitleText = `全部字幕组混排 · 共 ${this.currentEpisodes.length} 集${rangeText ? `（${rangeText}）` : ""}`;
        bannerSubText = "请先在上方点选一家字幕组，再批量下载缺失集数或设为自动追更";
      } else {
        const sourceName = activeStreamObj ? activeStreamObj.streamId : this.currentKeyword;
        bannerTitleText = `当前字幕组：${sourceName} · 共 ${this.currentEpisodes.length} 集${rangeText ? `（${rangeText}）` : ""}`;
        if (!this.isMobileMode) {
          const statBits = [];
          if (watchedEp > 0) statBits.push(`已看 ${watchedEp} 话`);
          if (localInCurrentCount > 0) statBits.push(`本地已有 ${localInCurrentCount} 集`);
          statBits.push(
            unwatchedMissing.length > 0
              ? `未看缺失 ${unwatchedMissing.length} 集`
              : "当前已出未看集数均在本地或已看完"
          );
          bannerSubText = statBits.join(" · ");
        }
      }

      verifyLeft.createDiv({
        cls: "curator-dl-verify-title",
        text: bannerTitleText
      });
      if (bannerSubText) {
        verifyLeft.createDiv({
          cls: "curator-dl-verify-sub",
          text: bannerSubText
        });
      }

      const currentRssUrl = this.getEffectiveCurrentRssUrl();
      const verifyActions = actionBanner.createDiv("curator-dl-verify-actions");
      const qbStatus = detectQbittorrentStatus(this.plugin);

      if (this.isMobileMode) {
        if (!isMixedMultiSubgroupView) {
          const unwatchedMagnets = unwatchedMissing
            .map((ep) => buildCompactMobileMagnet(ep))
            .filter(Boolean);
          if (unwatchedMagnets.length > 0) {
            const copyBatchBtn = verifyActions.createEl("button", {
              cls: "curator-dl-btn is-primary"
            });
            v07Core.setBtnIconLabel(
              copyBatchBtn,
              "copy",
              `复制未看 ${unwatchedMagnets.length} 集磁力`,
              14
            );
            copyBatchBtn.onclick = async () => {
              const ok = await copyTextCrossPlatform(unwatchedMagnets.join("\n"));
              if (NoticeClass) {
                new NoticeClass(
                  ok
                    ? `已复制 ${unwatchedMagnets.length} 条未看剧集磁力链接（每行一条）`
                    : "复制失败，请尝试逐集点击复制磁力",
                  4000
                );
              }
            };
          }
          const savePrefBtn = verifyActions.createEl("button", {
            cls: "curator-dl-btn is-accent"
          });
          v07Core.setBtnIconLabel(savePrefBtn, "star", "记住此字幕组", 14);
          savePrefBtn.onclick = async () => {
            savePrefBtn.disabled = true;
            try {
              await bindAnimeDownloadSourceToNote(this.plugin, this.item, {
                keyword: this.currentKeyword,
                rssUrl: currentRssUrl,
                streamId: this.activeStreamId || this.currentKeyword,
                missingEpisodes: [],
                syncQb: false
              });
              if (NoticeClass) {
                new NoticeClass(`已为《${this.item?.name || "番剧"}》记住常用源：${this.activeStreamId || this.currentKeyword}`, 3600);
              }
              this.renderHeaderMeta();
              this.renderResultsMount();
              if (typeof this.onUpdated === "function") this.onUpdated();
            } finally {
              savePrefBtn.disabled = false;
            }
          };
        }
      } else if (!isMixedMultiSubgroupView) {
        if (unwatchedMissing.length > 0 && qbStatus.enabled && qbStatus.installed) {
          const batchDlBtn = verifyActions.createEl("button", {
            cls: "curator-dl-btn is-primary"
          });
          v07Core.setBtnIconLabel(batchDlBtn, "download", `下载未看缺失的 ${unwatchedMissing.length} 集`, 14);
          batchDlBtn.dataset.dlAction = "batch-qb-download";
          batchDlBtn.onclick = async () => {
            batchDlBtn.disabled = true;
            const res = await dispatchDownloadToQbittorrent(
              this.plugin,
              this.item,
              unwatchedMissing
            );
            batchDlBtn.disabled = false;
            if (res.ok) {
              if (NoticeClass) {
                new NoticeClass(
                  `已将《${this.item.name}》未看缺失的 ${res.dispatchedCount} 集添加至 qBittorrent`,
                  4500
                );
              }
              this.renderEnvStatus();
            } else if (NoticeClass) {
              new NoticeClass(`发送失败：${res.reason}`);
            }
          };
        }

        const followState = getAnimeAutoFollowState(this.plugin, this.item);
        const currentStreamKey = this.activeStreamId || this.currentKeyword;
        const isCurrentStreamActiveFollow =
          followState.status === "active" &&
          ((this.activeStreamId && followState.streamId === this.activeStreamId) ||
            (followState.keyword && followState.keyword === this.currentKeyword));

        if (isCurrentStreamActiveFollow) {
          const followingPill = verifyActions.createEl("span", {
            cls: "curator-dl-following-tag",
            text: "✓ 当前源正在自动追更"
          });
          followingPill.title = "如需暂停或取消自动追更，请点击上方自动追更状态栏右侧按钮";
        } else {
          const bindSourceBtn = verifyActions.createEl("button", {
            cls: "curator-dl-btn is-accent"
          });
          v07Core.setBtnIconLabel(
            bindSourceBtn,
            "rss",
            followState.status === "active" ? "切换为此源追更" : "设为自动追更",
            14
          );
          bindSourceBtn.dataset.dlAction = "bind-rss-source";
          bindSourceBtn.title = "锁定当前字幕组为默认源并开启后台自动追更，同时立即下载当前未看缺失集数";
          bindSourceBtn.onclick = async () => {
            bindSourceBtn.disabled = true;
            const syncRes = await bindAnimeDownloadSourceToNote(this.plugin, this.item, {
              keyword: this.currentKeyword,
              rssUrl: currentRssUrl,
              streamId: currentStreamKey,
              missingEpisodes: unwatchedMissing,
              syncQb: true
            });
            bindSourceBtn.disabled = false;
            if (NoticeClass) {
              new NoticeClass(
                syncRes?.ok
                  ? `已开启「${currentStreamKey}」自动追更${
                      syncRes.dispatchedCount > 0 ? `（同时已添加 ${syncRes.dispatchedCount} 集未看新集至 qBittorrent）` : ""
                    }`
                  : `已将「${currentStreamKey}」记入《${this.item.name}》笔记`,
                4500
              );
            }
            await this.refreshAllStates({ showNotice: false });
          };
        }
      }

      // 4. 剧集明细列表（按集数从新到旧排列）
      if (this.currentEpisodes.length > 0) {
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
            text: this.isMobileMode
              ? isAlreadyWatched
                ? "已看"
                : "未看"
              : isLocalDownloaded
              ? "本地已有"
              : isAlreadyWatched
              ? "已看"
              : "待下载"
          });

          const infoCol = row.createDiv("curator-dl-ep-info-col");
          infoCol.createDiv({
            cls: "curator-dl-ep-title",
            text: epItem.title
          });
          const subMeta = [
            epItem.group ? `发布组：${epItem.group}` : "",
            epItem.size ? `大小：${epItem.size}` : "",
            epItem.pubDate ? `时间：${epItem.pubDate}` : ""
          ]
            .filter(Boolean)
            .join(" · ");
          infoCol.createDiv({
            cls: "curator-dl-ep-sub",
            text: subMeta
          });

          const actCol = row.createDiv("curator-dl-ep-actions-col");
          if (!this.isMobileMode && isLocalDownloaded) {
            const delEpBtn = actCol.createEl("button", {
              cls: "curator-dl-mini-btn is-subtle"
            });
            v07Core.setBtnIconLabel(delEpBtn, "trash", "删源", 13);
            delEpBtn.title = "删除本集本地视频文件，并同步移除 qBittorrent 中的对应任务";
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
                  }`
                );
              }
              await this.refreshAllStates({ showNotice: false });
            };
          }

          this.renderDownloadActionButtons(actCol, epItem, {
            actionLabel: `第 ${String(epNum).padStart(2, "0")} 话`,
            isPack: false,
            qbStatus
          });
        }
      }

      // 5. 季度全集 / 合集包资源
      if (effectivePacks.length > 0) {
        const packsSection = this.resultsMount.createDiv("curator-dl-packs-section");
        const packsHead = packsSection.createDiv("curator-dl-section-head");
        packsHead.createDiv({
          cls: "curator-dl-section-title",
          text: isShowingBroadPacksFallback
            ? `季度全集 / 合集包（来自全站结果 · 共 ${effectivePacks.length} 条）`
            : `季度全集 / 合集包（共 ${effectivePacks.length} 条）`
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
            packItem.size ? `大小：${packItem.size}` : "",
            packItem.pubDate ? `时间：${packItem.pubDate}` : ""
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
          this.renderDownloadActionButtons(actCol, packItem, {
            actionLabel: "季度合集包",
            isPack: true,
            qbStatus
          });
        }
      }

      // 6. 剧场版 / 单篇 / 特别篇资源
      if (effectiveUnnumbered.length > 0) {
        const isMovieNote =
          Number(this.item?.totalEpisodes) === 1 ||
          /剧场版|劇場版|\bMovie\b/i.test(`${this.item?.name || ""} ${this.item?.animeType || ""}`);
        const singleSec = this.resultsMount.createDiv("curator-dl-packs-section");
        const singleHead = singleSec.createDiv("curator-dl-section-head");
        singleHead.createDiv({
          cls: "curator-dl-section-title",
          text: isMovieNote
            ? `剧场版 / 单篇正片（共 ${effectiveUnnumbered.length} 条）`
            : `单篇 / 特别篇（共 ${effectiveUnnumbered.length} 条）`
        });
        const singleList = singleSec.createDiv("curator-dl-packs-list");
        for (const uItem of effectiveUnnumbered) {
          const urow = singleList.createDiv("curator-dl-ep-row is-pack-row");
          const badgeCol = urow.createDiv("curator-dl-ep-badge-col");
          badgeCol.createSpan({
            cls: "curator-dl-pack-pill curator-mono",
            text: uItem.isSpecialExtra ? "特典/SP" : isMovieNote ? "剧场正片" : "单篇资源"
          });

          const infoCol = urow.createDiv("curator-dl-ep-info-col");
          infoCol.createDiv({
            cls: "curator-dl-ep-title",
            text: uItem.title
          });
          const subMeta = [
            uItem.group ? `发布组：${uItem.group}` : "",
            uItem.size ? `大小：${uItem.size}` : "",
            uItem.pubDate ? `时间：${uItem.pubDate}` : ""
          ]
            .filter(Boolean)
            .join(" · ");
          if (subMeta) {
            infoCol.createDiv({
              cls: "curator-dl-ep-sub",
              text: subMeta
            });
          }

          const actCol = urow.createDiv("curator-dl-ep-actions-col");
          this.renderDownloadActionButtons(actCol, uItem, {
            actionLabel: isMovieNote ? "剧场正片" : "单篇资源",
            isPack: false,
            qbStatus
          });
        }
      }
    }
  }

  const modal = new AnimeDownloadAssistantModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 本地剧集目录详情、同集重复版本抉择与子文件夹平铺对话框
 */
function openLocalFolderDiagnosticsModal(plugin, item, onUpdated = null) {
  const ModalClass = globalThis.__BangumiManagerModal || obsidian?.Modal;
  const NoticeClass = globalThis.__BangumiManagerNotice || obsidian?.Notice;
  if (!ModalClass || !plugin?.app) return null;

  const formatSizeMb = (bytes) => {
    const n = Number(bytes) || 0;
    if (n <= 0) return "";
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${Math.max(1, Math.round(n / (1024 * 1024)))} MB`;
  };

  class LocalFolderDiagnosticsModal extends ModalClass {
    constructor(app) {
      super(app);
      this.confirmFlattenPending = false;
      this.confirmBatchCleanPending = false;
      this.confirmSingleTrashPath = "";
    }

    onOpen() {
      this.modalEl.style.width = "min(820px, 95vw)";
      this.modalEl.style.maxWidth = "820px";
      this.render();
    }

    onClose() {
      this.contentEl.empty();
    }

    async notifyChanged() {
      if (plugin?._v07LocalFolderCache && typeof plugin._v07LocalFolderCache.clear === "function") {
        plugin._v07LocalFolderCache.clear();
      }
      if (item?.file && typeof plugin?.checkOneLocalStatus === "function") {
        await plugin.checkOneLocalStatus(item.file).catch(() => {});
      }
      if (typeof onUpdated === "function") onUpdated();
      if (typeof plugin?.refreshOpenDashboardViews === "function") {
        await plugin.refreshOpenDashboardViews().catch(() => {});
      }
    }

    render() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-download-modal");

      const rawPath = String(item?.downloadPath || "").trim();
      const hasPath = Boolean(rawPath && rawPath !== "无");
      const inspectRes = hasPath ? noteUtils.inspectLocalFolder(rawPath, item?.watchedEpisodes) : null;
      const anom = inspectRes?.anomalies || {};
      const dupList = Array.isArray(anom.duplicateEpisodes) ? anom.duplicateEpisodes : [];
      const extraList = Array.isArray(inspectRes?.extraFiles) ? inspectRes.extraFiles : [];
      const subCount = Number(anom.subfolderStats?.totalInSubfolders) || 0;

      const header = contentEl.createDiv("curator-dl-header");
      const titleCol = header.createDiv("curator-dl-title-col");
      titleCol.createEl("h2", {
        cls: "curator-dl-title",
        text: `本地剧集目录详情 · 《${item?.name || "未命名"}》`
      });
      titleCol.createDiv({
        cls: "curator-dl-meta-sub curator-mono",
        text: hasPath ? rawPath : "尚未设置本地番剧文件夹"
      });

      const topBar = contentEl.createDiv("curator-dl-env-actions");
      topBar.style.marginBottom = "12px";

      if (hasPath) {
        const openBtn = topBar.createEl("button", {
          cls: "curator-dl-mini-btn",
          attr: { tabindex: "-1" }
        });
        v07Core.setBtnIconLabel(openBtn, "folder", "打开本地文件夹", 13);
        openBtn.onclick = () => noteUtils.openLocalPathSafely(rawPath);
      }

      const pickDirBtn = topBar.createEl("button", { cls: "curator-dl-mini-btn is-accent" });
      v07Core.setBtnIconLabel(pickDirBtn, "folder", "重新选择文件夹…", 13);
      pickDirBtn.onclick = async () => {
        pickDirBtn.disabled = true;
        const picked = await pickNativeFolderOnDesktop({
          title: `选择《${item?.name || "番剧"}》本地专属文件夹`,
          initialDir: hasPath ? rawPath : String(plugin?.settings?.localAnimeRoot || "")
        });
        pickDirBtn.disabled = false;
        if (picked) {
          await ensureAnimeLocalDownloadFolder(plugin, item, true, picked);
          await this.notifyChanged();
          this.render();
          if (NoticeClass) new NoticeClass(`已更新《${item?.name}》本地目录为：\n${picked}`, 4200);
        }
      };

      const rescanBtn = topBar.createEl("button", { cls: "curator-dl-mini-btn" });
      v07Core.setBtnIconLabel(rescanBtn, "refresh", "重新扫描", 13);
      rescanBtn.onclick = async () => {
        this.confirmFlattenPending = false;
        this.confirmBatchCleanPending = false;
        this.confirmSingleTrashPath = "";
        await this.notifyChanged();
        this.render();
      };

      if (!inspectRes || inspectRes.error) {
        contentEl.createDiv({
          cls: "curator-dl-folder-error-box",
          text: `当前目录暂不可读取（${inspectRes?.error || "未设置路径"}）。请点击上方「重新选择文件夹…」指定正确目录。`
        });
        return;
      }

      // 1. 疑似误绑上级季度/下载总目录（提供一键点选子目录快速修正）
      if (anom.suspectedParentContainer?.detected) {
        const sec = contentEl.createDiv("curator-dl-packs-section");
        sec.style.marginBottom = "12px";
        sec.createDiv({
          cls: "curator-dl-section-title",
          text: `目录层级提醒：当前指向「${anom.suspectedParentContainer.folderName}」，内含多部不同作品的子文件夹`
        });
        sec.createDiv({
          cls: "curator-dl-ep-sub",
          attr: { style: "margin:6px 0 10px 0;line-height:1.55;" },
          text: "为防止把同一季度下其他作品的剧集混入当前番剧，插件已暂停合并子文件夹。您可以直接点选下方对应的作品子文件夹完成精准绑定："
        });
        const chipWrap = sec.createDiv("curator-dl-chips-row");
        for (const childName of anom.suspectedParentContainer.childDirNames || []) {
          const chip = chipWrap.createEl("button", {
            cls: "curator-dl-chip",
            text: `绑定「${childName}」`
          });
          chip.onclick = async () => {
            const nextTarget = path.join(rawPath, childName);
            await ensureAnimeLocalDownloadFolder(plugin, item, true, nextTarget);
            await this.notifyChanged();
            this.render();
            if (NoticeClass) new NoticeClass(`已精准绑定至子目录：${nextTarget}`, 4000);
          };
        }
      }

      // 1b. 跨季度隔离或未编号文件提示
      if (
        (Array.isArray(anom.skippedOtherSeasonDirs) && anom.skippedOtherSeasonDirs.length > 0) ||
        (Array.isArray(anom.unnumberedMultipleVideos) && anom.unnumberedMultipleVideos.length > 0) ||
        (anom.hasBdmvStructure && inspectRes.fileCount === 0)
      ) {
        const noteSec = contentEl.createDiv("curator-dl-packs-section");
        noteSec.style.marginBottom = "12px";
        if (anom.skippedOtherSeasonDirs?.length > 0) {
          noteSec.createDiv({
            cls: "curator-dl-ep-sub",
            attr: { style: "line-height:1.6;margin-bottom:4px;" },
            text: `已自动隔离其他季度文件夹：${anom.skippedOtherSeasonDirs.join("、")}（不计入本季话数，避免与第 01 话起重叠）。`
          });
        }
        if (anom.unnumberedMultipleVideos?.length > 0) {
          noteSec.createDiv({
            cls: "curator-dl-ep-sub",
            attr: { style: "line-height:1.6;margin-bottom:4px;" },
            text: `发现未带明确话数的视频文件：${anom.unnumberedMultipleVideos.slice(0, 6).join("、")}${
              anom.unnumberedMultipleVideos.length > 6 ? " 等" : ""
            }。建议在文件名中补充如「01」「02」以便准确对应进度。`
          });
        }
        if (anom.hasBdmvStructure && inspectRes.fileCount === 0) {
          noteSec.createDiv({
            cls: "curator-dl-ep-sub",
            attr: { style: "line-height:1.6;" },
            text: "当前目录包含蓝光原盘 BDMV 结构，原盘碎片流 (.m2ts) 不会自动充当常规单集。"
          });
        }
      }

      // 2. 同集重复/多版本视频抉择区
      if (dupList.length > 0) {
        const dupSec = contentEl.createDiv("curator-dl-packs-section");
        dupSec.style.marginBottom = "12px";
        const dupHead = dupSec.createDiv();
        dupHead.style.cssText =
          "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;text-align:left;";
        dupHead.createDiv({
          cls: "curator-dl-section-title",
          attr: { style: "text-align:left;margin:0;" },
          text: `检测到 ${dupList.length} 话存在多份本地文件（正片集数已自动去重）`
        });

        const totalRedundantCount = dupList.reduce((acc, d) => acc + (d.duplicateFiles?.length || 0), 0);
        if (totalRedundantCount > 0) {
          const batchTrashBtn = dupHead.createEl("button", {
            cls: `curator-dl-mini-btn ${this.confirmBatchCleanPending ? "is-primary" : ""}`,
            text: this.confirmBatchCleanPending
              ? `确认移入回收站 (${totalRedundantCount} 份)`
              : `清理非默认副本 (${totalRedundantCount} 份)`
          });
          batchTrashBtn.onclick = async () => {
            if (!this.confirmBatchCleanPending) {
              this.confirmBatchCleanPending = true;
              this.render();
              return;
            }
            batchTrashBtn.disabled = true;
            let cleaned = 0;
            for (const d of dupList) {
              for (const red of d.duplicateFiles || []) {
                const ok = await trashOrUnlinkExternalFile(red.path);
                if (ok) {
                  cleaned += 1;
                  removeEmptyParentSubdirsUpToRoot(rawPath, path.dirname(red.path));
                }
              }
            }
            this.confirmBatchCleanPending = false;
            await this.notifyChanged();
            this.render();
            if (NoticeClass) new NoticeClass(`已将 ${cleaned} 份重复副本安全移入系统回收站。`, 4200);
          };
        }

        const listEl = dupSec.createDiv();
        listEl.style.cssText = "display:flex;flex-direction:column;gap:10px;";
        for (const dup of dupList) {
          const groupBox = listEl.createDiv();
          groupBox.style.cssText = "display:flex;flex-direction:column;gap:6px;";
          groupBox.createDiv({
            attr: { style: "font-size:12.5px;font-weight:700;color:var(--text-normal);padding:0 2px;" },
            text: `第 ${String(dup.episode).padStart(2, "0")} 话 · 共 ${dup.allFiles.length} 份文件`
          });

          for (const fItem of dup.allFiles) {
            const isPrimary = fItem.path === dup.primaryFile.path;
            const fRow = groupBox.createDiv();
            fRow.style.cssText =
              `display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:8px;background:var(--background-secondary);border:1px solid ${
                isPrimary ? "rgba(58,125,92,0.38)" : "var(--background-modifier-border)"
              };`;

            const leftCol = fRow.createDiv();
            leftCol.style.cssText = "flex:1 1 280px;min-width:0;";
            const nameLine = leftCol.createDiv();
            nameLine.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;";
            if (isPrimary) {
              nameLine.createSpan({
                attr: {
                  style:
                    "display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:12px;font-weight:650;background:rgba(58,154,108,0.16);color:var(--color-green, #357a56);flex-shrink:0;"
                },
                text: "默认播放"
              });
            }
            nameLine.createSpan({
              cls: "curator-mono",
              attr: {
                style: "font-size:12px;line-height:1.45;overflow-wrap:anywhere;color:var(--text-normal);"
              },
              text: fItem.name
            });
            const locLabel = fItem.inSubfolder ? `子文件夹：${path.dirname(fItem.relPath)}` : "番剧根目录直铺";
            const sizeLabel = formatSizeMb(fItem.size);
            leftCol.createDiv({
              attr: { style: "font-size:12px;color:var(--text-muted);margin-top:3px;overflow-wrap:anywhere;" },
              text: [locLabel, sizeLabel, fItem.version > 1 ? `修正版 v${fItem.version}` : ""].filter(Boolean).join(" · ")
            });

            const rightActs = fRow.createDiv();
            rightActs.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;";

            const playThisBtn = rightActs.createEl("button", {
              cls: "curator-dl-mini-btn",
              text: "试播"
            });
            playThisBtn.onclick = async () => {
              await noteUtils.openLocalPathSafely(fItem.path);
            };

            if (!isPrimary) {
              const setPrefBtn = rightActs.createEl("button", {
                cls: "curator-dl-mini-btn is-accent",
                text: "设为默认"
              });
              setPrefBtn.onclick = async () => {
                if (!plugin.settings.preferredEpisodeFiles || typeof plugin.settings.preferredEpisodeFiles !== "object") {
                  plugin.settings.preferredEpisodeFiles = {};
                }
                for (const other of dup.allFiles) {
                  const k = String(other.path).replace(/\\/g, "/").toLowerCase();
                  delete plugin.settings.preferredEpisodeFiles[k];
                }
                const chosenKey = String(fItem.path).replace(/\\/g, "/").toLowerCase();
                plugin.settings.preferredEpisodeFiles[chosenKey] = true;
                globalThis.__BangumiPreferredEpisodeFiles = plugin.settings.preferredEpisodeFiles;
                if (typeof plugin.saveSettings === "function") await plugin.saveSettings();
                await this.notifyChanged();
                this.render();
              };
            }

            const isConfirmingThis = this.confirmSingleTrashPath === fItem.path;
            const trashBtn = rightActs.createEl("button", {
              cls: `curator-dl-mini-btn ${isConfirmingThis ? "is-primary" : "is-subtle"}`,
              text: isConfirmingThis ? "确认移入回收站" : "移入回收站"
            });
            trashBtn.onclick = async () => {
              if (!isConfirmingThis) {
                this.confirmSingleTrashPath = fItem.path;
                this.render();
                return;
              }
              trashBtn.disabled = true;
              const ok = await trashOrUnlinkExternalFile(fItem.path);
              if (ok) {
                removeEmptyParentSubdirsUpToRoot(rawPath, path.dirname(fItem.path));
                if (NoticeClass) new NoticeClass(`已移入系统回收站：${fItem.name}`, 3600);
              }
              this.confirmSingleTrashPath = "";
              await this.notifyChanged();
              this.render();
            };
          }
        }
      }

      // 3. 子文件夹识别说明与可选一键平铺
      if (subCount > 0) {
        const subSec = contentEl.createDiv("curator-dl-packs-section");
        subSec.style.marginBottom = "12px";
        const subRow = subSec.createDiv();
        subRow.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;";
        subRow.createDiv({
          attr: { style: "flex:1 1 320px;font-size:12.5px;line-height:1.55;color:var(--text-normal);" },
          text: `当前共有 ${subCount} 集位于子文件夹（${(anom.subfolderStats?.subfolderNames || []).slice(0, 3).join("、")}${
            (anom.subfolderStats?.subfolderNames?.length || 0) > 3 ? " 等" : ""
          }）中。插件已支持原地识别与直接播放，无需手动搬出；若您希望统一整理到番剧根目录，可点右侧平铺提取。`
        });
        const flattenBtn = subRow.createEl("button", {
          cls: `curator-dl-mini-btn ${this.confirmFlattenPending ? "is-primary" : ""}`,
          text: this.confirmFlattenPending ? `确认移动 ${subCount} 集到根目录` : "平铺提取至番剧根目录"
        });
        flattenBtn.onclick = async () => {
          if (!this.confirmFlattenPending) {
            this.confirmFlattenPending = true;
            this.render();
            return;
          }
          flattenBtn.disabled = true;
          const res = await flattenAnimeSubfolderEpisodes(plugin, item);
          this.confirmFlattenPending = false;
          await this.notifyChanged();
          this.render();
          if (NoticeClass) {
            new NoticeClass(
              `已平铺提取 ${res.movedCount} 集视频至番剧根目录${
                res.skippedCount > 0 ? `（跳过同名冲突 ${res.skippedCount} 项）` : ""
              }。`,
              4200
            );
          }
        };
      }

      // 4. 已识别并隔离的特典 / OP / ED / 总集篇（支持直接点击播放）
      if (extraList.length > 0) {
        const extSec = contentEl.createDiv("curator-dl-packs-section");
        extSec.createDiv({
          cls: "curator-dl-section-title",
          attr: { style: "margin-bottom:8px;" },
          text: `附带特典 / OP / ED / 总集篇（共 ${extraList.length} 项 · 不占用正片话数，可直接播放）`
        });
        const extList = extSec.createDiv("curator-dl-ep-list");
        for (const ex of extraList) {
          const erow = extList.createDiv("curator-dl-ep-row");
          const bCol = erow.createDiv("curator-dl-ep-badge-col");
          bCol.createSpan({
            cls: "curator-dl-pack-pill curator-mono",
            text: ex.extraKind || "特典"
          });
          const iCol = erow.createDiv("curator-dl-ep-info-col");
          iCol.createDiv({ cls: "curator-dl-ep-title", text: ex.name });
          if (ex.inSubfolder) {
            iCol.createDiv({ cls: "curator-dl-ep-sub", text: `位于：${path.dirname(ex.relPath)}` });
          }
          const aCol = erow.createDiv("curator-dl-ep-actions-col");
          const pBtn = aCol.createEl("button", { cls: "curator-dl-mini-btn is-primary", text: "播放" });
          pBtn.onclick = () => noteUtils.openLocalPathSafely(ex.path);
        }
      }

      if (
        !inspectRes.hasAttentionNeeded &&
        subCount === 0 &&
        extraList.length === 0
      ) {
        contentEl.createDiv({
          attr: { style: "padding:14px;border-radius:8px;background:var(--background-secondary);font-size:13px;color:var(--text-muted);" },
          text: `当前目录结构整洁，共检测到 ${inspectRes.fileCount} 集正片视频，无重复副本或路径异常。`
        });
      }
    }
  }

  const m = new LocalFolderDiagnosticsModal(plugin.app);
  m.open();
  return m;
}

module.exports = {
  OFFICIAL_QBITTORRENT_URL,
  DEFAULT_COMICAT_BASE_URL,
  isDeadEnclosureRssFeed,
  normalizeCjkForMatch,
  doesTitleMatchAnimeCandidates,
  buildComicatSearchUrl,
  buildComicatRssUrl,
  buildCustomSearchUrl,
  fetchComicatRssXml,
  fetchFederatedAnimeSearchDataset,
  loadMoreMioBtPagesIntoDataset,
  buildStreamsAndSubgroupsFromItems,
  classifyResourceForAnime,
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
  getAnimeAutoFollowState,
  setAnimeAutoFollowEnabled,
  removeAnimeAutoFollowAndUnbind,
  openAllRssSubscriptionsManagerModal,
  syncRssFeedAndRuleToQbittorrent,
  bindAnimeDownloadSourceToNote,
  deleteLocalEpisodeAndSyncQb,
  collectEpisodesFromCloudDriveFolders,
  flattenAnimeSubfolderEpisodes,
  detectExistingRssAndDownloadRules,
  openRssDuplicateConfirmModal,
  openAnimeDownloadModal,
  openLocalFolderDiagnosticsModal
};
