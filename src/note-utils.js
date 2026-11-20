const {
  tryRequireNode,
  isDesktopNodeAvailable,
  normalizeUnicodeNfc,
  toSafeFileUrl,
  toMarkdownSafeFileUrl,
  extnameLower,
  joinPosixPath
} = require("./platform-env.js");

var VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".ts"
];

function cleanValue(value) {
  return String(value || "").replace(/`/g, "").replace(/^["']|["']$/g, "").trim();
}
function parseFrontmatter(content) {
  const match = String(content || "").match(
    /^---\r?\n([\s\S]*?)\r?\n---/
  );
  if (!match) {
    return null;
  }
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        if (fields[currentKey]) {
          currentList.push(fields[currentKey]);
        }
      }
      let itemVal = listMatch[1].trim();
      if ((itemVal.startsWith('"') && itemVal.endsWith('"')) || (itemVal.startsWith("'") && itemVal.endsWith("'"))) {
        itemVal = itemVal.slice(1, -1);
      }
      currentList.push(itemVal);
      fields[currentKey] = currentList.join(", ");
      continue;
    }

    currentList = null;
    const index = line.indexOf(":");
    if (index < 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      value = inner
        ? inner
            .split(",")
            .map((part) => part.trim().replace(/^["']|["']$/g, "").trim())
            .filter(Boolean)
            .join(", ")
        : "";
    } else if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
    currentKey = key;
  }
  return {
    full: match[0],
    body: match[1],
    fields
  };
}
function extractWatchedEpisodes(content) {
  const patterns = [
    /\*\*已观看集数\s*：\s*\*\*\s*(\d+(?:\.\d+)?)/,
    /\*\*已观看集数\s*:\s*\*\*\s*(\d+(?:\.\d+)?)/,
    /\*\*已观看集数\*\*\s*：\s*(\d+(?:\.\d+)?)/,
    /\*\*已观看集数\*\*\s*:\s*(\d+(?:\.\d+)?)/
  ];
  for (const pattern of patterns) {
    const match = String(content || "").match(
      pattern
    );
    if (match) {
      return Number(match[1]) || 0;
    }
  }
  return 0;
}
const CN_SEASON_MAP = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10
};

function parseExplicitSeasonNumber(rawName) {
  const s = normalizeUnicodeNfc(String(rawName || ""));
  if (!s) return null;
  const cn = s.match(/第\s*([一二三四五六七八九十\d]{1,2})\s*[季期]/);
  if (cn && cn[1]) {
    const n = /^\d+$/.test(cn[1]) ? parseInt(cn[1], 10) : CN_SEASON_MAP[cn[1]];
    if (n >= 1 && n <= 20) return n;
  }
  const sCode = s.match(/(?:^|[\s_\-\[\(])(?:Season\s*(\d{1,2})|(\d)(?:st|nd|rd|th)\s*Season|S(\d{1,2})(?:E\d{1,3}|\b|[\s_\-\]\)]))/i);
  if (sCode) {
    const n = parseInt(sCode[1] || sCode[2] || sCode[3], 10);
    if (n >= 1 && n <= 20) return n;
  }
  return null;
}

function isPackOrRangeTitle(rawName) {
  const s = normalizeUnicodeNfc(String(rawName || ""));
  if (!s) return false;
  return (
    /(?:^|[\s_\-\[\(])(\d{1,3})\s*[-~～]\s*(\d{1,3})(?:\s*(?:Fin|END|话|集|話|完))?(?:$|[\s_\-\]\)])/i.test(s) ||
    /全\s*\d+\s*[话集話]|季度全集|合集|全集|BD[\s_-]*BOX/i.test(s)
  );
}

/**
 * 解析视频文件名或单集子目录名的集数、修订版本 (v2/v3)、分辨率权重及是否为特典/OP/ED/总集篇
 */
function parseVideoEpisodeMeta(fileName, options = {}) {
  const raw = normalizeUnicodeNfc(String(fileName || "").trim());
  if (!raw) {
    return {
      episode: null,
      version: 1,
      resolutionScore: 0,
      formatScore: 0,
      hasExplicitEp: false,
      isExtra: false,
      extraKind: "",
      isOvaCandidate: false,
      fractionalEp: null,
      isPackRange: false
    };
  }

  const ext = options.isDirectory ? "" : extnameLower(raw);
  const baseName = options.isDirectory ? raw : raw.replace(/\.[^/.]+$/, "");
  const isPackRange = isPackOrRangeTitle(baseName);

  let resolutionScore = 2;
  if (/(?:^|[\s._\-\[\(])(?:2160[pP]|3840x2160|4K|UHD)(?=$|[\s._\-\]\)])/i.test(baseName)) resolutionScore = 4;
  else if (/(?:^|[\s._\-\[\(])(?:1440[pP]|2560x1440|2K)(?=$|[\s._\-\]\)])/i.test(baseName)) resolutionScore = 3.5;
  else if (/(?:^|[\s._\-\[\(])(?:1080[pPiI]?|1920x1080|FHD)(?=$|[\s._\-\]\)])/i.test(baseName)) resolutionScore = 3;
  else if (/(?:^|[\s._\-\[\(])(?:720[pP]|1280x720|HD)(?=$|[\s._\-\]\)])/i.test(baseName)) resolutionScore = 1;
  else if (/(?:^|[\s._\-\[\(])(?:576[pP]|480[pP]|360[pP])(?=$|[\s._\-\]\)])/i.test(baseName)) resolutionScore = 0.5;

  const formatScore = ext === ".mkv" ? 2 : ext === ".mp4" ? 1.5 : 1;

  // 先剥离常见音视频编码参数与带连字符的压制组括号（如 [343-Labs]），防止 5.1 声道 / H.264 / AV1 / 组名数字干扰识别
  const techCleaned = baseName
    .replace(/^\s*\[[^\]]*[A-Za-z\u4e00-\u9fa5][^\]]*\]\s*/, " ")
    .replace(/\[\d+\s*-\s*[A-Za-z][^\]]*\]/g, " ")
    .replace(/\[\s*\d{1,2}\s*月新番\s*\]/g, " ")
    .replace(/\[[0-9a-fA-F]{8}\]/g, " ")
    .replace(/\[(?:1080|720|2160|1440|576|480)[pPiI]?(?:@\d+(?:\.\d+)?(?:fps)?)?\]/gi, " ")
    .replace(
      /(?:^|(?<=[\s._\-\[\(]))(?:1920x1080|1280x720|3840x2160|2560x1440|10bit|8bit|Hi10p|Ma10p|Hi444PP|YUV420P10|x264|x265|H\.?264|H\.?265|HEVC|AVC|AV1|VP9|MPEG2|HDR10\+?|DoVi|SDR|(?:AAC|DDP|EAC3|AC3|DTS|THD|TrueHD|FLAC|OPUS|LPCM|PCM)(?:[\s._-]?\d\.\d|x\d+)?|[257]\.[01](?:ch)?|(?:ASS|SRT|SUP|PGS)(?:x\d+)?|\d{2,3}(?:\.\d+)?\s*fps|MP4(?:v\d+)?|MKV|AVI|WMV|WEBM|WEB-DL|WebRip|BDRip|BD(?:Remux)?|BluRay|Blu-ray|DVDRip|1080[pPiI]|720[pP]|2160[pP]|1440[pP]|576[pP]|480[pP]|4K)(?=$|[\s._\-\]\)])/gi,
      " "
    );

  const isMovieOrSpecialCandidate =
    /(?:^|[\s_\-\[\(])(?:The\s+Movie|Movie(?:\s*\d+)?|剧场版(?:总集篇)?|剧场|总集篇|完结篇|特别篇|前篇|后篇)(?=$|[\s_\-\]\).])|\[TM\]/i.test(
      techCleaned
    );

  const makeMeta = (overrides = {}) => ({
    episode: null,
    version: 1,
    resolutionScore,
    formatScore,
    hasExplicitEp: false,
    epMatchKind: "",
    isExtra: false,
    extraKind: "",
    isOvaCandidate: false,
    isMovieOrSpecialCandidate,
    fractionalEp: null,
    isPackRange,
    ...overrides
  });

  // 1. 显式 OP/ED/NCOP/NCED（含 [OP_EP1_Onair] / - ED ep 02 / - OP01 等放送版主题曲）及 PV/CM/Menu/特典 检测
  if (
    /(?:^|[\s_\-\[\(])(?:NCOP|NCED|Creditless\s*(?:OP|ED)|Clean\s*(?:OP|ED)|无字\s*(?:OP|ED))(?:\s*\d*[a-zA-Z]?)?(?:v\d+)?(?=$|[\s_\-\]\).])/i.test(
      techCleaned
    ) ||
    /\[(?:NC)?(?:OP|ED)(?:\d*[a-zA-Z]?)(?:[\s._-]*(?:EP?\s*\d+|Onair|TV|Ver\.?[^\]]*|v\d+|Full|Short))*\]/i.test(
      baseName
    ) ||
    /(?:-\s*|\()(?:NC)?(?:OP|ED)(?:\s*ep\s*\d+|\s*\d{1,2}[a-zA-Z]?)(?:v\d+)?(?=$|[\s_\-\]\).])/i.test(
      techCleaned
    )
  ) {
    return makeMeta({ isExtra: true, extraKind: "OP/ED" });
  }

  if (
    /(?:^|[\s_\-\[\(])(?:BD\s*Menu|Menu\s*\d*|PV\s*\d*|CM\s*\d*|(?:CompleteBOX|PR|BD|Web|TV)[\s_-]*CM\s*\d*|Trailer\s*\d*|Preview\s*\d*|映像特典|特典映像|下集预告|番宣|Web\s*Preview)(?:v\d+)?(?=$|[\s_\-\]\).])/i.test(
      techCleaned
    )
  ) {
    return makeMeta({ isExtra: true, extraKind: "PV/特典" });
  }

  if (/(?:角色歌|Character\s*Song|插入曲\s*MV|主题曲\s*MV)/i.test(techCleaned)) {
    return makeMeta({ isExtra: true, extraKind: "音乐/特典" });
  }

  if (
    /(?:^|[\s_\-\[\(])(?:SP(?:\s*Anime)?|Specials?|Tokuten|特典(?:映像|动画|视频)?|Mini\s*(?:Anime|Theater)|Chibi\s*(?:Anime|Theater)|Picture\s*Drama|(?:Q版|迷你|四格|短篇)?小剧场|迷你动画|迷你剧场|四格[^\s\]\)]*|有声漫画|广播剧|朗读剧|声优见面会|(?:交响)?音乐会|演唱会|Live\s*Event|Concert)(?:\s*\d{0,3})?(?:v\d+)?(?=$|[\s_\-\]\).])/i.test(
      techCleaned
    )
  ) {
    return makeMeta({ isExtra: true, extraKind: "SP/特典" });
  }

  // 2. 总集篇小数话数（如 07.5 / E07.5 / [07.5] / 第7.5话）：专门拦截，防止掉入兜底规则误抓作品标题里的数字
  const fracMatch = techCleaned.match(
    /(?:^|[\s_\-\[\(])(?:(?:S\d{1,2})?E|EP|Episode\s*|第\s*)?(\d{1,3}\.5)(?:v(\d+))?(?:\s*[话集話])?(?=$|[\s_\-\]\)])/i
  );
  if (fracMatch && fracMatch[1]) {
    return makeMeta({
      version: fracMatch[2] ? parseInt(fracMatch[2], 10) : 1,
      isExtra: true,
      extraKind: "总集篇(.5)",
      fractionalEp: parseFloat(fracMatch[1])
    });
  }

  const isOvaCandidate = /(?:^|[\s_\-\[\(])(?:OVA|OAD)\s*(\d{0,2})(?:v\d+)?(?=$|[\s_\-\]\).])/i.test(techCleaned);

  // 若目录名为合集区间（如 01-12Fin），不将其本身解析为单集编号
  if (options.isDirectory && isPackRange) {
    return makeMeta({ isOvaCandidate, isPackRange: true });
  }

  // 3. 显式正片集数：EP / Episode / S01E05 / 第05话 / 05话
  const epExplicit = techCleaned.match(
    /(?:^|[\s_\-\[\(])(?:(?:S\d{1,2})?E|EP|Episode)\s*(\d{1,4})(?:v(\d+))?(?=$|[\s_\-\]\)]|[话集話])/i
  );
  if (epExplicit && epExplicit[1]) {
    return makeMeta({
      episode: parseInt(epExplicit[1], 10),
      version: epExplicit[2] ? parseInt(epExplicit[2], 10) : 1,
      hasExplicitEp: true,
      epMatchKind: "explicit",
      isOvaCandidate
    });
  }

  const cnEpMatch = techCleaned.match(/(?:第\s*(\d{1,4})\s*[话集話]?|(\d{1,3})\s*[话集話])(?:v(\d+))?/i);
  if (cnEpMatch && (cnEpMatch[1] || cnEpMatch[2])) {
    return makeMeta({
      episode: parseInt(cnEpMatch[1] || cnEpMatch[2], 10),
      version: cnEpMatch[3] ? parseInt(cnEpMatch[3], 10) : 1,
      hasExplicitEp: true,
      epMatchKind: "explicit",
      isOvaCandidate
    });
  }

  // 4. 字幕组常见横杠格式: " - 05 [", " - 05v2 ", " - 12 END"
  const dashMatch = techCleaned.match(/-\s*(\d{1,3})(?:v(\d+))?(?=\s*[\[\(]|\s+(?:END|Fin|完)\b|\s*$)/i);
  if (dashMatch && dashMatch[1]) {
    const ep = parseInt(dashMatch[1], 10);
    if (ep >= 0 && ep < 1900) {
      return makeMeta({
        episode: ep,
        version: dashMatch[2] ? parseInt(dashMatch[2], 10) : 1,
        hasExplicitEp: true,
        epMatchKind: "dash",
        isOvaCandidate
      });
    }
  }

  // 5. 方括号集数格式: "[05]", "[05v2]", "[12 END]"（取最右侧合法集数括号，避开前置年份/标题数字）
  const bracketMatches = [
    ...techCleaned.matchAll(/\[(\d{1,3})(?:v(\d+))?(?:\s*(?:END|Fin|完|话|集|話))?\]/gi)
  ];
  if (bracketMatches.length > 0) {
    for (let i = bracketMatches.length - 1; i >= 0; i--) {
      const ep = parseInt(bracketMatches[i][1], 10);
      if (ep >= 0 && ep < 1900 && ep !== 480 && ep !== 576 && ep !== 720 && ep !== 1080) {
        return makeMeta({
          episode: ep,
          version: bracketMatches[i][2] ? parseInt(bracketMatches[i][2], 10) : 1,
          hasExplicitEp: true,
          epMatchKind: "bracket",
          isOvaCandidate
        });
      }
    }
  }

  // 6. 通用分隔符、CJK 紧邻双位集数（如 `为美好的世界献上爆焰02.mp4`）与尾部数字兜底
  if (!isPackRange) {
    const cjkTailMatch = techCleaned
      .trim()
      .match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af！!？?～~](\d{2})(?:v(\d+))?(?:\s*(?:END|Fin|完))?$/i);
    if (cjkTailMatch && cjkTailMatch[1]) {
      const ep = parseInt(cjkTailMatch[1], 10);
      return makeMeta({
        episode: ep,
        version: cjkTailMatch[2] ? parseInt(cjkTailMatch[2], 10) : 1,
        hasExplicitEp: true,
        epMatchKind: "cjk_tail",
        isOvaCandidate
      });
    }

    const delimPattern = /(?:[\s_\-\[\(])(\d{1,3})(?:v(\d+))?(?:[\s_\]\)]|-(?![A-Za-z](?!(?:ND|in)\b)))/i;
    const match2 = techCleaned.match(delimPattern);
    if (match2 && match2[1]) {
      const ep = parseInt(match2[1], 10);
      if (ep >= 0 && ep < 1900 && ep !== 480 && ep !== 576 && ep !== 720 && ep !== 264 && ep !== 265) {
        return makeMeta({
          episode: ep,
          version: match2[2] ? parseInt(match2[2], 10) : 1,
          hasExplicitEp: true,
          epMatchKind: "delim",
          isOvaCandidate
        });
      }
    }
    const tailPattern = /(?:^|[\s_\-])(\d{1,3})(?:v(\d+))?$/i;
    const match3 = techCleaned.trim().match(tailPattern);
    if (match3 && match3[1]) {
      const ep = parseInt(match3[1], 10);
      if (ep >= 0 && ep < 1900 && ep !== 480 && ep !== 576 && ep !== 720 && ep !== 264 && ep !== 265) {
        return makeMeta({
          episode: ep,
          version: match3[2] ? parseInt(match3[2], 10) : 1,
          hasExplicitEp: true,
          epMatchKind: "tail",
          isOvaCandidate
        });
      }
    }
  }

  if (isOvaCandidate) {
    const ovaNum = techCleaned.match(/(?:OVA|OAD)\s*(\d{1,2})(?:v(\d+))?/i);
    return makeMeta({
      episode: ovaNum && ovaNum[1] ? parseInt(ovaNum[1], 10) : null,
      version: ovaNum && ovaNum[2] ? parseInt(ovaNum[2], 10) : 1,
      hasExplicitEp: Boolean(ovaNum && ovaNum[1]),
      epMatchKind: ovaNum && ovaNum[1] ? "ova" : "",
      extraKind: "OVA/OAD",
      isOvaCandidate: true
    });
  }

  return makeMeta();
}

function extractEpisodeNumberFromFileName(fileName) {
  if (!fileName) return null;
  const meta = parseVideoEpisodeMeta(fileName);
  if (meta.isExtra) return null;
  return meta.episode;
}

let electronShell = null;
try {
  const electronMod = tryRequireNode("electron");
  electronShell = electronMod ? electronMod.shell : null;
} catch (e) {}

async function openLocalPathSafely(targetPath) {
  const raw = String(targetPath || "").trim();
  if (!raw) return false;
  if (!isDesktopNodeAvailable()) {
    return false;
  }
  const pathMod = tryRequireNode("path");
  const normPath = pathMod ? pathMod.normalize(raw) : raw;

  try {
    const shellNow = electronShell || tryRequireNode("electron")?.shell || null;
    if (shellNow && typeof shellNow.openPath === "function") {
      const errMsg = await shellNow.openPath(normPath);
      if (!errMsg) return true;
    }
  } catch (e) {}

  try {
    const cp = tryRequireNode("child_process");
    const plat = typeof process !== "undefined" ? process.platform : "";
    if (cp && typeof cp.spawn === "function") {
      const cmd = plat === "win32" ? "explorer.exe" : plat === "darwin" ? "open" : "xdg-open";
      const child = cp.spawn(cmd, [normPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.unref();
      return true;
    }
  } catch (e) {}

  try {
    const safeHref = toSafeFileUrl(normPath);
    if (safeHref && typeof window !== "undefined" && typeof window.open === "function") {
      window.open(safeHref);
      return true;
    }
  } catch (e) {}
  return false;
}

const SKIP_PURE_ASSET_DIRS = new Set([
  ".git",
  ".obsidian",
  ".stfolder",
  ".sync",
  ".trash",
  ".spotlight-v100",
  ".fseventsd",
  "$recycle.bin",
  "system volume information",
  "node_modules",
  "fonts",
  "font",
  "字体",
  "附件字体",
  "subs",
  "sub",
  "subtitle",
  "subtitles",
  "字幕",
  "外挂字幕",
  "scans",
  "scan",
  "bk",
  "booklet",
  "booklets",
  "扫图",
  "设定集",
  "画集",
  "storyboard",
  "storyboards",
  "分镜",
  "分镜集",
  "cds",
  "cd",
  "ost",
  "soundtrack",
  "music",
  "audio",
  "特典cd",
  "角色歌",
  "lyrics",
  "歌词",
  "sample",
  "samples",
  "featurettes",
  "certificate",
  "adv_obj",
  "clipinf",
  "playlist",
  "auxdata",
  "bdjo",
  "jar",
  "meta"
]);

const EXTRA_SUBDIR_NAME_RX =
  /^(?:sp|sps|special|specials|extra|extras|bonus|tokuten|ova|ovas|oad|oads|ncop|nced|op|ed|op[_\s&+-]*ed|ncop[_\s&+-]*nced|creditless|clean\s*op|clean\s*ed|pv|pvs|cm|cms|menu|menus|bd\s*menu|preview|previews|trailer|trailers|mini\s*anime|mini\s*theater|chibi\s*theater|picture\s*drama|concert|live|event|making|特典|映像特典|特典映像|特典动画|花絮|幕后|访谈|预告|预告片|(?:q版|迷你|四格|短篇)?(?:小剧场|剧场|动画)|有声漫画|广播剧|朗读剧|(?:交响)?音乐会|演唱会|声优见面会|总集篇|番外|番外篇)$/i;

const EXTRA_SUBDIR_SUFFIX_RX =
  /(?:^|[\s\[\(_-])(?:SPs|Specials|Extras|Bonus|Tokuten|映像特典|特典映像|(?:Q版|迷你|四格)小剧场|交响音乐会|音乐会|演唱会|NCOP|NCED|Menus|PVs|CMs)(?:$|[\s\]\)_-])/i;

const INCOMPLETE_FILE_RX =
  /\.(?:!qB|part|aria2|bc!|crdownload|xltd|downloading|baiduyun\.uploading\.cfg)$/i;

const GENERIC_PARENT_ROOT_NAME_RX =
  /^(?:\d{4}\s*年?|\d{1,2}\s*月(?:新番|番剧)?|(?:春|夏|秋|冬)季(?:新番)?|Anime|ACG|番剧|动画|Obsidian\s*ACG|Downloads|QuarkDownload|夸克网盘下载|BaiduNetdiskDownload|迅雷下载)$/i;

function extractTitleStemForCluster(name) {
  return normalizeUnicodeNfc(String(name || ""))
    .replace(/\.[^/.]+$/, "")
    .replace(/^\s*\[[^\]]+\]\s*/g, "")
    .replace(/\[[^\]]*\]|\([^\)]*\)/g, " ")
    .replace(/-\s*\d{1,3}(?:v\d+)?.*$/i, " ")
    .replace(/\b(?:S\d{1,2}E\d{1,3}|EP?\d{1,3}|Season\s*\d+|1080p|720p|2160p|WebRip|WEB-DL|BDRip|MP4|MKV)\b/gi, " ")
    .replace(/[\s_\-!！?？:：~～·.。]+/g, "")
    .toLowerCase()
    .slice(0, 18);
}

function makeEmptyInspectResult(error, downloadPath = "") {
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
    hasAttentionNeeded: false,
    anomalies: {
      duplicateEpisodes: [],
      suspectedParentContainer: null,
      skippedOtherSeasonDirs: [],
      unnumberedMultipleVideos: [],
      hasBdmvStructure: false,
      incompleteCount: 0,
      subfolderStats: {
        totalInSubfolders: 0,
        subfolderNames: []
      }
    }
  };
}

/**
 * 智能本地番剧目录检测引擎（v0.8.1 升级版）：
 * - 原生支持：直铺单集、合集自带子文件夹（如 `[Comicat...] Make Heroine (01-12Fin...)`）、单集独立子文件夹（如每集套一层目录）及多层解压目录（深度 <= 3）；
 * - 防错乱隔离：自动剥离 SP/NCOP/NCED/PV/CM/Menu/.5总集篇/Fonts/Scans/CDs/BDMV 原盘流，不污染正片话数；
 * - 防串番保护：自动识别误绑至「季度总目录 / 下载总目录」（含多部不同番剧重叠话数）或误混入「其他季度子目录（如第二季）」并拦截提示；
 * - 无损去重与冲突提示：同话数存在多版本（如 v1+v2、双字幕组、内外重复）时正片按 1 话计（支持用户指定默认播放文件），同时标记 `hasAttentionNeeded` 供界面温和提示用户核对。
 */
function inspectLocalFolder(downloadPath, watchedEpisodes, options = {}) {
  if (!downloadPath || downloadPath === "\u65E0") {
    return makeEmptyInspectResult("\u65E0\u4E0B\u8F7D\u8DEF\u5F84", "");
  }
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  if (!fs || !isDesktopNodeAvailable()) {
    return makeEmptyInspectResult("\u79FB\u52A8\u7AEF\u73AF\u5883", downloadPath);
  }
  const normDownloadPath = path ? path.normalize(String(downloadPath).trim()) : String(downloadPath).trim();
  if (!fs.existsSync(normDownloadPath)) {
    return makeEmptyInspectResult("\u6587\u4EF6\u5939\u4E0D\u5B58\u5728", downloadPath);
  }

  let topEntries = [];
  try {
    topEntries = fs.readdirSync(normDownloadPath, { withFileTypes: true });
  } catch (err) {
    return makeEmptyInspectResult("\u6587\u4EF6\u5939\u8BFB\u53D6\u5931\u8D25", downloadPath);
  }

  const maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 3;
  const maxVisitedDirs = 96;
  let visitedDirs = 0;
  let hasBdmvStructure = false;
  let incompleteCount = 0;

  const rootFolderBase = path
    ? path.basename(normDownloadPath.replace(/[\\/]+$/, ""))
    : normDownloadPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  const rootExplicitSeason = parseExplicitSeasonNumber(rootFolderBase);

  const collectedMainCandidates = [];
  const collectedExtras = [];
  const skippedOtherSeasonDirs = [];
  const topSubdirSummaries = new Map(); // topSubdirName -> { epSet, stems, count }

  const recordCandidate = (entryName, fullPath, relPath, depth, topSubdirName, parentDirName, inExtraBranch, siblingVideoCountInDir) => {
    let fileSize = 0;
    let mtimeMs = 0;
    let birthtimeMs = 0;
    try {
      const st = fs.statSync(fullPath);
      fileSize = Number(st?.size) || 0;
      mtimeMs = Number(st?.mtimeMs) || 0;
      birthtimeMs = Number(st?.birthtimeMs) || 0;
    } catch (_) {}
    const addedTimeMs = Math.max(mtimeMs, birthtimeMs);

    const ext = extnameLower(entryName);
    // .ts 仅当体积 > 2MB 时视为电视传输流视频，避免误判小型 TypeScript 脚本
    if (ext === ".ts" && fileSize > 0 && fileSize < 2 * 1024 * 1024) {
      return;
    }

    const meta = parseVideoEpisodeMeta(entryName);
    let resolvedEp = meta.episode;
    let resolvedVersion = meta.version || 1;
    let hasExplicitEp = meta.hasExplicitEp;
    let inferredFromFolder = false;

    // 若单集子文件夹内仅有 1 个主视频文件且文件名本身不含集数（如 `第07话/video.mp4`），安全回退从父文件夹名提取集数
    if (
      !inExtraBranch &&
      !meta.isExtra &&
      resolvedEp === null &&
      depth > 0 &&
      siblingVideoCountInDir === 1 &&
      parentDirName
    ) {
      const parentMeta = parseVideoEpisodeMeta(parentDirName, { isDirectory: true });
      const reliableFolderEp =
        parentMeta.epMatchKind === "explicit" ||
        parentMeta.epMatchKind === "dash" ||
        parentMeta.epMatchKind === "bracket" ||
        parentMeta.epMatchKind === "cjk_tail" ||
        /^\s*0*\d{1,3}(?:v\d+)?\s*$/.test(parentDirName);
      if (
        !parentMeta.isExtra &&
        !parentMeta.isPackRange &&
        reliableFolderEp &&
        parentMeta.episode !== null &&
        parentMeta.episode <= 200
      ) {
        resolvedEp = parentMeta.episode;
        resolvedVersion = parentMeta.version || 1;
        hasExplicitEp = true;
        inferredFromFolder = true;
      }
    }

    const fileObj = {
      name: entryName,
      path: fullPath,
      relPath,
      depth,
      inSubfolder: depth > 0,
      topSubdirName: topSubdirName || "",
      parentDirName: parentDirName || "",
      episode: resolvedEp,
      version: resolvedVersion,
      resolutionScore: meta.resolutionScore,
      formatScore: meta.formatScore,
      hasExplicitEp,
      inferredFromFolder,
      isOvaCandidate: meta.isOvaCandidate,
      isMovieOrSpecialCandidate: Boolean(
        meta.isMovieOrSpecialCandidate ||
          /(?:^|[\\/])(?:剧场版|总集篇|特别篇|完结篇|Movie|Movies)(?:$|[\\/])/i.test(relPath || "")
      ),
      extraKind: inExtraBranch ? (meta.extraKind || "特典子目录") : meta.extraKind,
      fractionalEp: meta.fractionalEp,
      size: fileSize,
      mtimeMs,
      birthtimeMs,
      addedTimeMs
    };

    if (inExtraBranch || meta.isExtra) {
      collectedExtras.push(fileObj);
      return;
    }

    collectedMainCandidates.push(fileObj);
    if (topSubdirName) {
      if (!topSubdirSummaries.has(topSubdirName)) {
        topSubdirSummaries.set(topSubdirName, { epSet: new Set(), stems: new Set(), count: 0 });
      }
      const sum = topSubdirSummaries.get(topSubdirName);
      sum.count += 1;
      if (resolvedEp !== null) sum.epSet.add(resolvedEp);
      const stem = extractTitleStemForCluster(entryName) || extractTitleStemForCluster(topSubdirName);
      if (stem && stem.length >= 2) sum.stems.add(stem);
    }
  };

  // 先检查顶层直铺的视频文件，以便后续判断子目录是否存在跨季混放
  const topLevelDirectVideos = topEntries.filter((e) => {
    try {
      return e && typeof e.isFile === "function" && e.isFile() && VIDEO_EXTENSIONS.includes(extnameLower(e.name));
    } catch (_) {
      return false;
    }
  });
  for (const e of topEntries) {
    try {
      if (e && typeof e.isFile === "function" && e.isFile() && INCOMPLETE_FILE_RX.test(e.name)) {
        incompleteCount += 1;
      }
    } catch (_) {}
  }

  for (const entry of topLevelDirectVideos) {
    const fullPath = path ? path.join(normDownloadPath, entry.name) : joinPosixPath(normDownloadPath, entry.name);
    recordCandidate(entry.name, fullPath, entry.name, 0, "", rootFolderBase, false, topLevelDirectVideos.length);
  }

  // 检测是否误将下载路径绑定到了「2024 / 07月新番 / Downloads」等上级多番剧总目录
  const isRootNamedLikeContainer = GENERIC_PARENT_ROOT_NAME_RX.test(rootFolderBase.trim());

  const walkSubDir = (absDir, relDir, depth, topSubdirName, inExtraBranch) => {
    if (depth > maxDepth || visitedDirs >= maxVisitedDirs) return;
    visitedDirs += 1;
    let subEntries = [];
    try {
      subEntries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    const dirVideoEntries = [];
    const childDirs = [];

    for (const ent of subEntries) {
      if (!ent || !ent.name) continue;
      const entName = String(ent.name);
      try {
        if (typeof ent.isFile === "function" && ent.isFile()) {
          if (INCOMPLETE_FILE_RX.test(entName)) {
            incompleteCount += 1;
            continue;
          }
          if (VIDEO_EXTENSIONS.includes(extnameLower(entName))) {
            dirVideoEntries.push(ent);
          }
        } else if (typeof ent.isDirectory === "function" && ent.isDirectory()) {
          const lower = entName.toLowerCase().trim();
          if (lower.startsWith(".")) continue;
          if (lower === "bdmv") {
            hasBdmvStructure = true;
            continue;
          }
          if (SKIP_PURE_ASSET_DIRS.has(lower)) continue;
          childDirs.push(ent);
        }
      } catch (_) {}
    }

    const curDirBase = path ? path.basename(absDir) : absDir.split(/[\\/]/).pop() || "";
    for (const vEnt of dirVideoEntries) {
      const fullPath = path ? path.join(absDir, vEnt.name) : joinPosixPath(absDir, vEnt.name);
      const relPath = relDir ? `${relDir}/${vEnt.name}` : vEnt.name;
      recordCandidate(
        vEnt.name,
        fullPath,
        relPath,
        depth,
        topSubdirName,
        curDirBase,
        inExtraBranch,
        dirVideoEntries.length
      );
    }

    for (const dEnt of childDirs) {
      if (visitedDirs >= maxVisitedDirs) break;
      const dName = String(dEnt.name);
      const nextExtra =
        inExtraBranch ||
        EXTRA_SUBDIR_NAME_RX.test(dName.trim()) ||
        EXTRA_SUBDIR_SUFFIX_RX.test(dName.trim());
      const nextAbs = path ? path.join(absDir, dName) : joinPosixPath(absDir, dName);
      const nextRel = relDir ? `${relDir}/${dName}` : dName;
      walkSubDir(nextAbs, nextRel, depth + 1, topSubdirName || dName, nextExtra);
    }
  };

  // 遍历顶层子目录（含跨季度隔离判断）
  const topDirs = topEntries.filter((e) => {
    try {
      if (!e || typeof e.isDirectory !== "function" || !e.isDirectory()) return false;
      const lower = String(e.name || "").toLowerCase().trim();
      if (!lower || lower.startsWith(".")) return false;
      if (lower === "bdmv") {
        hasBdmvStructure = true;
        return false;
      }
      return !SKIP_PURE_ASSET_DIRS.has(lower);
    } catch (_) {
      return false;
    }
  });

  const dirHasAnyVideoQuick = (absDir, depthLeft = 2) => {
    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent || !ent.name) continue;
        if (typeof ent.isFile === "function" && ent.isFile()) {
          if (VIDEO_EXTENSIONS.includes(extnameLower(ent.name))) return true;
        } else if (depthLeft > 0 && typeof ent.isDirectory === "function" && ent.isDirectory()) {
          const low = String(ent.name).toLowerCase().trim();
          if (!low.startsWith(".") && !SKIP_PURE_ASSET_DIRS.has(low)) {
            const childAbs = path ? path.join(absDir, ent.name) : joinPosixPath(absDir, ent.name);
            if (dirHasAnyVideoQuick(childAbs, depthLeft - 1)) return true;
          }
        }
      }
    } catch (_) {}
    return false;
  };

  // 先探测各顶层子目录的显式季数，防止把附带的「第二季」混进第一季
  const topDirMetas = topDirs.map((d) => {
    const dName = String(d.name);
    const isExtraDir = EXTRA_SUBDIR_NAME_RX.test(dName.trim()) || EXTRA_SUBDIR_SUFFIX_RX.test(dName.trim());
    const dirEpMeta = isExtraDir ? null : parseVideoEpisodeMeta(dName, { isDirectory: true });
    const isSingleEpDir = Boolean(
      dirEpMeta &&
        dirEpMeta.hasExplicitEp &&
        !dirEpMeta.isPackRange &&
        (dirEpMeta.epMatchKind === "explicit" ||
          dirEpMeta.epMatchKind === "dash" ||
          dirEpMeta.epMatchKind === "bracket" ||
          dirEpMeta.epMatchKind === "cjk_tail" ||
          /^\s*0*\d{1,3}(?:v\d+)?\s*$/.test(dName))
    );
    const explicitSeason = isExtraDir ? null : parseExplicitSeasonNumber(dName);
    const subAbs = path ? path.join(normDownloadPath, dName) : joinPosixPath(normDownloadPath, dName);
    const hasVideos = dirHasAnyVideoQuick(subAbs, 2);
    return { dirent: d, name: dName, subAbs, hasVideos, isExtraDir, isSingleEpDir, explicitSeason };
  });

  const hasSeasonOneSource =
    collectedMainCandidates.some((c) => c.hasExplicitEp) ||
    collectedMainCandidates.length >= 2 ||
    topDirMetas.some(
      (m) => m.hasVideos && !m.isExtraDir && !m.isSingleEpDir && (m.explicitSeason === null || m.explicitSeason === 1)
    );

  for (const dm of topDirMetas) {
    if (!dm.isExtraDir && !dm.isSingleEpDir && dm.explicitSeason !== null) {
      if (rootExplicitSeason !== null && dm.explicitSeason !== rootExplicitSeason) {
        if (dm.hasVideos) skippedOtherSeasonDirs.push(dm.name);
        continue;
      }
      if (rootExplicitSeason === null && dm.explicitSeason >= 2 && hasSeasonOneSource) {
        if (dm.hasVideos) skippedOtherSeasonDirs.push(dm.name);
        continue;
      }
    }
    walkSubDir(dm.subAbs, dm.name, 1, dm.name, dm.isExtraDir);
  }

  // 检查是否误指向包含多部不同番剧的上级总目录（例如指向 `2026/07月新番` 或 `Downloads`）
  let suspectedParentContainer = null;
  const multiEpSubdirs = Array.from(topSubdirSummaries.entries()).filter(([, info]) => info.count >= 2);
  const allDistinctStems = new Set();
  for (const [, info] of multiEpSubdirs) {
    for (const st of info.stems) allDistinctStems.add(st);
  }
  const ep1SubdirCount = multiEpSubdirs.filter(([, info]) => info.epSet.has(1) || info.epSet.has(2)).length;

  if (
    (isRootNamedLikeContainer && topSubdirSummaries.size >= 2 && topLevelDirectVideos.length === 0) ||
    (multiEpSubdirs.length >= 3 && ep1SubdirCount >= 3 && allDistinctStems.size >= 3)
  ) {
    suspectedParentContainer = {
      detected: true,
      folderName: rootFolderBase,
      childDirNames: Array.from(topSubdirSummaries.keys()).slice(0, 12)
    };
    // 拦截跨番混算：仅保留顶层直铺文件（通常为 0），避免把整个季度的几十部番剧混成一部
    collectedMainCandidates.splice(
      0,
      collectedMainCandidates.length,
      ...collectedMainCandidates.filter((c) => c.depth === 0)
    );
  }

  // 若目录内既有常规 TV 正片（>=2 话且非 OVA），又有散落的 OVA/OAD 文件，将散落 OVA/OAD 归入特典列表，避免挤占常规集数
  const nonOvaMain = collectedMainCandidates.filter((c) => !c.isOvaCandidate);
  const ovaMain = collectedMainCandidates.filter((c) => c.isOvaCandidate);
  let effectiveMainPool = collectedMainCandidates;
  if (nonOvaMain.length >= 2 && ovaMain.length > 0) {
    effectiveMainPool = nonOvaMain;
    for (const ov of ovaMain) {
      ov.extraKind = ov.extraKind || "OVA/OAD";
      collectedExtras.push(ov);
    }
  }

  // 用户手动指定的优先版本映射（规范化路径键）
  const preferredMap =
    (options && options.preferredEpisodeFiles) ||
    (typeof globalThis !== "undefined" ? globalThis.__BangumiPreferredEpisodeFiles : null) ||
    null;
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
    return a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: "base" });
  };

  const extractCleanTitleSignature = (fileName, ep) => {
    const epStr = ep !== null && ep !== undefined ? String(ep) : "";
    let s = normalizeUnicodeNfc(String(fileName || ""))
      .replace(/\.[^/.]+$/, "")
      .replace(/^\s*\[[^\]]+\]\s*/, " ")
      .replace(/\[[0-9a-fA-F]{8}\]/g, " ")
      .replace(
        /\[(?:1080|720|2160|1440|576|480|4K|UHD|FHD|HD|BD|BDRip|WebRip|WEB-DL|BluRay|DVDRip|HEVC|AVC|x264|x265|H\.?264|H\.?265|AV1|10bit|8bit|Hi10p|Ma10p|FLAC|AAC|OPUS|DDP|EAC3|AC3|DTS|THD|TrueHD|LPCM|PCM|CHS|CHT|GB|BIG5|JP|JPN|SC|TC|ASS|SRT|SUP|PGS|MKV|MP4|Uncensored|Uncencored)[^\]]*\]/gi,
        " "
      )
      .replace(
        /\((?:1080|720|2160|1440|576|480|BD|BdRip|WebRip|WEB-DL|DvdRip|1920x1080|1280x720|848x480|HEVC|AVC|x264|x265)[^\)]*\)/gi,
        " "
      );
    if (epStr) {
      const epRx = new RegExp(
        `(?:\\[\\s*0*${epStr}(?:v\\d+)?(?:\\s*(?:END|Fin|完|话|集|話))?\\s*\\]|(?:-|\\bEP?|\\bS\\d{1,2}E)\\s*0*${epStr}(?:v\\d+)?\\b|第\\s*0*${epStr}\\s*[话集話]?)`,
        "gi"
      );
      s = s.replace(epRx, " ");
    }
    return s.replace(/[\[\]\(\)\s._\-!！?？:：~～·.。]+/g, "").toLowerCase();
  };

  const explicitByEp = new Map();
  const unnumberedCandidates = [];

  for (const cand of effectiveMainPool) {
    if (cand.hasExplicitEp && cand.episode !== null && Number.isFinite(cand.episode)) {
      if (!explicitByEp.has(cand.episode)) {
        explicitByEp.set(cand.episode, []);
      }
      explicitByEp.get(cand.episode).push(cand);
    } else {
      unnumberedCandidates.push(cand);
    }
  }

  // 若目录内已有 >= 2 话常规正数集（01..N），则将第 00 话（前日谈/序章/SP00）归入特典，避免挤占常规集数与未看队列
  const positiveExplicitCount = Array.from(explicitByEp.keys()).filter((k) => k >= 1).length;
  if (positiveExplicitCount >= 2 && explicitByEp.has(0)) {
    const epZeroFiles = explicitByEp.get(0) || [];
    for (const zf of epZeroFiles) {
      zf.extraKind = zf.extraKind || "SP/第00话";
      collectedExtras.push(zf);
    }
    explicitByEp.delete(0);
  }

  const duplicateEpisodes = [];
  const dedupedExplicitVideos = [];

  for (const [ep, group] of explicitByEp.entries()) {
    group.sort(rankCandidate);
    const primary = group[0];
    const primarySig = group.length > 1 ? extractCleanTitleSignature(primary.name, ep) : "";
    const trueDuplicates = [];

    for (let i = 1; i < group.length; i++) {
      const cand = group[i];
      const candSig = extractCleanTitleSignature(cand.name, ep);
      // 识别同目录混放的 BD 附赠短篇动画（如 `[来自深渊][01]` 438MB vs `[来自深渊][马璐璐库的日常][01]` 67MB）
      const isBundledMiniShort =
        primary.size >= 120 * 1024 * 1024 &&
        cand.size > 0 &&
        cand.size / primary.size < 0.28 &&
        primarySig.length >= 2 &&
        candSig.length >= primarySig.length + 2 &&
        candSig.includes(primarySig);

      if (isBundledMiniShort) {
        cand.extraKind = "短篇/特典";
        collectedExtras.push(cand);
      } else {
        trueDuplicates.push(cand);
      }
    }

    primary.duplicates = trueDuplicates;
    dedupedExplicitVideos.push(primary);
    if (trueDuplicates.length > 0) {
      duplicateEpisodes.push({
        episode: ep,
        primaryFile: primary,
        duplicateFiles: trueDuplicates,
        allFiles: [primary, ...trueDuplicates]
      });
    }
  }
  duplicateEpisodes.sort((a, b) => a.episode - b.episode);

  let videoFiles = [];
  const unnumberedMultipleVideos = [];

  if (dedupedExplicitVideos.length > 0) {
    videoFiles = dedupedExplicitVideos;
    // 当目录已具备 >= 2 话 TV 正片时，同包附带的剧场版 / 完结篇 / 总集篇 / 特别篇自动归入特典，不误报无法识别集数
    for (const u of unnumberedCandidates) {
      if (dedupedExplicitVideos.length >= 2 && u.isMovieOrSpecialCandidate) {
        u.extraKind = u.extraKind || "剧场版/特别篇";
        collectedExtras.push(u);
      } else {
        unnumberedMultipleVideos.push(u.relPath || u.name);
      }
    }
  } else if (unnumberedCandidates.length > 0) {
    unnumberedCandidates.sort((a, b) =>
      (a.relPath || a.name).localeCompare(b.relPath || b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    videoFiles = unnumberedCandidates.map((u, idx) => ({
      ...u,
      episode: idx + 1,
      hasExplicitEp: false,
      duplicates: []
    }));
    if (unnumberedCandidates.length >= 2) {
      for (const u of unnumberedCandidates) {
        unnumberedMultipleVideos.push(u.relPath || u.name);
      }
    }
  }

  videoFiles.sort((a, b) => {
    if (a.episode !== b.episode) {
      return a.episode - b.episode;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  const subfolderSet = new Set();
  let totalInSubfolders = 0;
  for (const vf of videoFiles) {
    if (vf.inSubfolder) {
      totalInSubfolders += 1;
      if (vf.topSubdirName) subfolderSet.add(vf.topSubdirName);
    }
  }

  const currentWatched = Number(watchedEpisodes) || 0;
  const targetNextEp = currentWatched + 1;
  const hasAnyExplicitEp = videoFiles.some((vf) => vf.hasExplicitEp);
  const unwatchedFiles = hasAnyExplicitEp
    ? videoFiles.filter((vf) => Number(vf.episode) > currentWatched)
    : videoFiles.slice(currentWatched);

  let nextEpisodeFile = null;
  let nextEpisodeNumber = null;
  const matched = videoFiles.find((vf) => vf.episode === targetNextEp);
  if (matched) {
    nextEpisodeFile = matched.path;
    nextEpisodeNumber = matched.episode;
  } else if (unwatchedFiles.length > 0) {
    nextEpisodeFile = unwatchedFiles[0].path;
    nextEpisodeNumber = unwatchedFiles[0].episode;
  } else if (currentWatched < videoFiles.length) {
    const fallback = videoFiles[currentWatched];
    if (fallback) {
      nextEpisodeFile = fallback.path;
      nextEpisodeNumber = fallback.episode;
    }
  }

  const maxEpisodeNumber = videoFiles.reduce(
    (maxEp, vf) => (Number.isFinite(vf.episode) && vf.episode > maxEp ? vf.episode : maxEp),
    0
  );

  const hasAttentionNeeded = Boolean(
    duplicateEpisodes.length > 0 ||
      suspectedParentContainer?.detected ||
      skippedOtherSeasonDirs.length > 0 ||
      unnumberedMultipleVideos.length > 0 ||
      (hasBdmvStructure && videoFiles.length === 0)
  );

  return {
    error: null,
    downloadPath,
    fileCount: videoFiles.length,
    newCount: hasAnyExplicitEp
      ? unwatchedFiles.length
      : Math.max(0, videoFiles.length - currentWatched),
    videoFiles,
    allRawVideoFiles: effectiveMainPool,
    extraFiles: collectedExtras,
    unwatchedFiles,
    maxEpisodeNumber,
    nextEpisodeFile,
    nextEpisodeNumber,
    hasAttentionNeeded,
    anomalies: {
      duplicateEpisodes,
      suspectedParentContainer,
      skippedOtherSeasonDirs,
      unnumberedMultipleVideos,
      hasBdmvStructure,
      incompleteCount,
      subfolderStats: {
        totalInSubfolders,
        subfolderNames: Array.from(subfolderSet)
      }
    }
  };
}
function getLocalStatusText(result) {
  if (result.error === "\u65E0\u4E0B\u8F7D\u8DEF\u5F84") {
    return "\u672A\u8BBE\u7F6E\u4E0B\u8F7D\u8DEF\u5F84";
  }
  if (result.error === "\u6587\u4EF6\u5939\u4E0D\u5B58\u5728") {
    return "\u6587\u4EF6\u5939\u4E0D\u5B58\u5728";
  }
  if (result.error) {
    return "\u68C0\u6D4B\u5931\u8D25";
  }
  if (result.anomalies?.suspectedParentContainer?.detected && result.fileCount === 0) {
    return "\u76EE\u5F55\u8DEF\u5F84\u5F85\u6838\u5BF9";
  }
  if (result.newCount > 0) {
    return "\u5DF2\u66F4\u65B0 " + result.newCount + " \u96C6";
  }
  return "\u5DF2\u540C\u6B65";
}
function updateFrontmatterField(content, fieldName, fieldValue) {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return content;
  }
  const escapedName = fieldName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  let fieldLine;
  if (fieldName === "tags") {
    let tagList = Array.isArray(fieldValue)
      ? fieldValue
      : String(fieldValue || "").split(/[,;\s#\[\]"']+/).filter(Boolean);
    tagList = Array.from(new Set(tagList));
    if (!tagList.some((t) => t.toLowerCase() === "bangumi")) {
      tagList.unshift("bangumi");
    }
    fieldLine = "tags:\n" + tagList.map((t) => "  - " + t).join("\n");
  } else {
    fieldLine = fieldName + ': "' + String(fieldValue || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  const pattern = new RegExp(
    "^" + escapedName + "\\s*:(?:[^\\r\\n]*(?:\\r?\\n\\s+-[^\\r\\n]*)*)",
    "m"
  );
  const newBody = pattern.test(parsed.body) ? parsed.body.replace(
    pattern,
    fieldLine
  ) : parsed.body + "\n" + fieldLine;
  return content.replace(
    parsed.full,
    "---\n" + newBody + "\n---"
  );
}
function updateScoreFields(
  content,
  bangumiScore,
  personalScore
) {
  const parsed = parseFrontmatter(
    content
  );

  if (!parsed) {
    return content;
  }

  const scoreFieldNames = [
    "你在 BGM 上的评分",
    "你在BGM上的评分",
    "BGM\u7528\u6237\u8BC4\u5206",
    "BGM \u7528\u6237\u8BC4\u5206",
    "Bangumi\u7528\u6237\u8BC4\u5206",
    "\u6211\u7684\u8BC4\u5206"
  ];

  const frontmatterLines =
    parsed.body.split(/\r?\n/);

  const cleanedFrontmatterLines =
    frontmatterLines.filter((line) => {
      const match = line.match(
        /^\s*([^:]+?)\s*:/
      );

      if (!match) {
        return true;
      }

      return !scoreFieldNames.includes(
        match[1].trim()
      );
    });

  const scoreFieldLines = [];

  if (
    bangumiScore !== null &&
    bangumiScore !== undefined
  ) {
    scoreFieldLines.push(
      "你在 BGM 上的评分: \"" +
      String(bangumiScore)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"') +
      "\""
    );
  }

  if (
    personalScore !== null &&
    personalScore !== undefined
  ) {
    scoreFieldLines.push(
      "\u6211\u7684\u8BC4\u5206: \"" +
      String(personalScore)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"') +
      "\""
    );
  }

  const rebuiltFrontmatterLines = [];
  let insertedFrontmatterScores = false;

  for (const line of cleanedFrontmatterLines) {
    rebuiltFrontmatterLines.push(
      line
    );

    if (
      !insertedFrontmatterScores &&
      /^\s*BGM\s*\u8BC4\u5206\s*:/.test(line)
    ) {
      rebuiltFrontmatterLines.push(
        ...scoreFieldLines
      );
      insertedFrontmatterScores = true;
    }
  }

  if (
    !insertedFrontmatterScores &&
    scoreFieldLines.length > 0
  ) {
    rebuiltFrontmatterLines.push(
      ...scoreFieldLines
    );
  }

  const rebuiltFrontmatter =
    "---\n" +
    rebuiltFrontmatterLines.join("\n") +
    "\n---";

  let result = content.replace(
    parsed.full,
    rebuiltFrontmatter
  );

  const tableFieldNames = [
    "你在 BGM 上的评分",
    "你在BGM上的评分",
    "BGM\u7528\u6237\u8BC4\u5206",
    "BGM \u7528\u6237\u8BC4\u5206",
    "Bangumi\u7528\u6237\u8BC4\u5206",
    "\u6211\u7684\u8BC4\u5206"
  ];

  const contentLines =
    result.split(/\r?\n/);

  const cleanedContentLines =
    contentLines.filter((line) => {
      const match = line.match(
        /^\|\s*([^|]+?)\s*\|/
      );

      if (!match) {
        return true;
      }

      return !tableFieldNames.includes(
        match[1].trim()
      );
    });

  const tableLines = [];

  if (
    bangumiScore !== null &&
    bangumiScore !== undefined
  ) {
    tableLines.push(
      "| 你在 BGM 上的评分 | " +
      String(bangumiScore) +
      " |"
    );
  }

  if (
    personalScore !== null &&
    personalScore !== undefined
  ) {
    tableLines.push(
      "| \u6211\u7684\u8BC4\u5206 | " +
      String(personalScore) +
      " |"
    );
  }

  const rebuiltContentLines = [];
  let insertedTableScores = false;

  for (const line of cleanedContentLines) {
    rebuiltContentLines.push(
      line
    );

    if (
      !insertedTableScores &&
      /^\|\s*BGM\s+\u8BC4\u5206\s*\|/.test(line)
    ) {
      rebuiltContentLines.push(
        ...tableLines
      );
      insertedTableScores = true;
    }
  }

  if (
    !insertedTableScores &&
    tableLines.length > 0
  ) {
    rebuiltContentLines.push(
      ...tableLines
    );
  }

  return rebuiltContentLines.join(
    "\n"
  );
}
function updateFolderLine(content, result) {
  const normalizedResult =
    typeof result === "string"
      ? {
          downloadPath: result.trim() && result.trim() !== "无" ? result.trim() : "",
          error: null
        }
      : result || {};
  let folderLine;
  if (normalizedResult.downloadPath && !normalizedResult.error) {
    const safeUrl = toMarkdownSafeFileUrl(normalizedResult.downloadPath);
    folderLine = "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A [\u6253\u5F00\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939](" + safeUrl + ")";
  } else {
    folderLine = "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A \u672A\u8BBE\u7F6E";
  }
  const existing = /^\*\*本地文件夹\s*[：:]?\s*\*\*\s*[：:]?.*$/m;
  if (existing.test(content)) {
    return content.replace(
      existing,
      folderLine
    );
  }
  const watched = /^(\*\*已观看集数[^\n]*\n)/m;
  if (watched.test(content)) {
    return content.replace(
      watched,
      "$1" + folderLine + "\n"
    );
  }
  return content.trimEnd() + "\n\n" + folderLine + "\n";
}

function updateNetabaIframeUrl(content, newUrl) {
  const source = String(content || "");
  const marker = "<!-- Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE -->";
  const markerIndex = source.indexOf(marker);

  let targetStart = markerIndex;

  if (targetStart < 0) {
    const headingMatch = source.match(
      /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
    );

    if (!headingMatch || headingMatch.index === undefined) {
      return source;
    }

    targetStart = headingMatch.index;
  }

  const before = source.slice(
    0,
    targetStart
  );

  const netabaPart = source.slice(
    targetStart
  );

  const iframePattern =
    /(<iframe\s+src=")[^"]+(")/i;

  if (!iframePattern.test(netabaPart)) {
    return source;
  }

  const updatedNetabaPart = netabaPart.replace(
    iframePattern,
    "$1" + newUrl + "$2"
  );

  return before + updatedNetabaPart;
}

function getNetabaPageName(page) {
  const names = {
    subject: "当前动画页面",
    season: "当季动画",
    trending: "评分趋势",
    history: "历史分布",
    user: "个人评分",
    compare: "动画对比"
  };

  return names[page] || "当前动画页面";
}

function updateNetabaSection(content, action) {
  const source = String(content || "");
  const marker = "<!-- Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE -->";
  const hasMarker = source.includes(marker);
  const hasNetabaHeading =
    /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m.test(source);
  const hasNetabaIframe =
    /<iframe[^>]+src=["'][^"']*netaba\.re[^"']*["'][^>]*>/i.test(
      source
    );

  if (action === "add") {
    if (hasMarker || hasNetabaHeading || hasNetabaIframe) {
      return source;
    }

    const parsed = parseFrontmatter(source);

    if (!parsed) {
      return source;
    }

    const bgmUrl = cleanValue(
      parsed.fields.BGM链接
    );

    const subjectMatch = bgmUrl.match(
      /\/subject\/(\d+)/i
    );

    if (!subjectMatch) {
      return source;
    }

    const subjectId = subjectMatch[1];
    const netabaUrl =
      "https://netaba.re/subject/" + subjectId;

    const section = [
      "",
      "# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE",
      "",
      '<div class="bangumi-netaba-controls" data-netaba-controls="true"></div>',
      "",
      '<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">',
      '<iframe src="' + netabaUrl + '" style="display:block;width:100%;height:600px;border:0;"></iframe>',
      "</div>",
      ""
    ].join("\n");

    const summaryIndex = source.search(
      /^#+\s*(?:观片手记与评价|\u4E2A\u4EBA\u603B\u7ED3)\s*$/m
    );

    if (summaryIndex >= 0) {
      return (
        source.slice(0, summaryIndex).trimEnd() +
        "\n\n" +
        section +
        "\n" +
        source.slice(summaryIndex)
      );
    }

    return source.trimEnd() + "\n\n" + section;
  }

  if (action !== "delete") {
    return source;
  }

  if (!hasMarker && !hasNetabaHeading && !hasNetabaIframe) {
    return source;
  }

  const markerIndex = source.indexOf(marker);

  if (markerIndex >= 0) {
    const before = source.slice(
      0,
      markerIndex
    );

    const afterMarker = source.slice(
      markerIndex
    );

    const detailsStart = afterMarker.indexOf(
      "<details"
    );

    if (detailsStart >= 0) {
      const detailsEnd = afterMarker.indexOf(
        "</details>",
        detailsStart
      );

      if (detailsEnd >= 0) {
        const endIndex =
          detailsEnd + "</details>".length;

        return (
          before.trimEnd() +
          "\n\n" +
          afterMarker.slice(endIndex).replace(/^\s+/, "")
        );
      }
    }

    const headingMatch = afterMarker.match(
      /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
    );

    if (headingMatch && headingMatch.index !== undefined) {
      const headingStart = headingMatch.index;
      const headingEnd =
        headingStart + headingMatch[0].length;
      const afterHeading = afterMarker.slice(
        headingEnd
      );
      const nextHeadingMatch = afterHeading.match(
        /^#\s+/m
      );

      let sectionEnd = afterMarker.length;

      if (
        nextHeadingMatch &&
        nextHeadingMatch.index !== undefined
      ) {
        sectionEnd =
          headingEnd + nextHeadingMatch.index;
      }

      return (
        before.trimEnd() +
        "\n\n" +
        afterMarker.slice(sectionEnd).replace(/^\s+/, "")
      );
    }
  }

  const headingMatch = source.match(
    /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
  );

  if (
    headingMatch &&
    headingMatch.index !== undefined
  ) {
    const headingStart = headingMatch.index;
    const headingEnd =
      headingStart + headingMatch[0].length;
    const afterHeading = source.slice(
      headingEnd
    );
    const nextHeadingMatch = afterHeading.match(
      /^#\s+/m
    );

    let sectionEnd = source.length;

    if (
      nextHeadingMatch &&
      nextHeadingMatch.index !== undefined
    ) {
      sectionEnd =
        headingEnd + nextHeadingMatch.index;
    }

    return (
      source.slice(0, headingStart).trimEnd() +
      "\n\n" +
      source.slice(sectionEnd).replace(/^\s+/, "")
    );
  }

  return source;
}

function extractBaseViewNames(content) {
  const names = [];
  const lines = String(content || "").split(/\r?\n/);
  let block = [];
  const flush = () => {
    if (!block.length) {
      return;
    }
    const text = block.join("\n");
    const match = text.match(
      /^\s*name:\s*(.+?)\s*$/m
    );
    if (match) {
      names.push(match[1].trim());
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s{2}-\s+type:\s+/.test(line)) {
      flush();
      block = [line];
    } else if (block.length) {
      block.push(line);
    }
  }
  flush();
  return [...new Set(names)];
}
function removeBaseViews(content, shouldRemove) {
  const lines = String(content || "").split(/\r?\n/);
  const header = [];
  const blocks = [];
  let block = [];
  const flush = () => {
    if (block.length) {
      blocks.push(block.join("\n"));
      block = [];
    }
  };
  for (const line of lines) {
    if (/^\s{2}-\s+type:\s+/.test(line)) {
      flush();
      block = [line];
    } else if (block.length) {
      block.push(line);
    } else {
      header.push(line);
    }
  }
  flush();
  const kept = [];
  let removedCount = 0;
  for (const current of blocks) {
    const match = current.match(
      /^\s*name:\s*(.+?)\s*$/m
    );
    const name = match ? match[1].trim() : "";
    if (name !== "\u5168\u90E8\u52A8\u753B" && shouldRemove(name)) {
      removedCount += 1;
    } else {
      kept.push(current);
    }
  }
  const newContent = header.join("\n") + (kept.length ? "\n" + kept.join("\n") : "");
  return {
    content: newContent.trimEnd() + "\n",
    removedCount
  };
}
function hasBaseView(content, viewName) {
  return extractBaseViewNames(content).includes(viewName);
}
function appendSeasonView(content, seasonName) {
  const match = seasonName.match(
    /^(\d{4})年(\d{2}月新番)$/
  );
  if (!match) {
    return content;
  }
  const block = `  - type: cards
    name: ${seasonName}
    filters:
      and:
        - \u5F00\u64AD\u5E74\u4EFD == "${match[1]}"
        - \u5F00\u64AD\u5B63\u5EA6 == "${match[2]}"
    groupBy:
      property: \u672C\u5730\u66F4\u65B0\u72B6\u6001
      direction: ASC
    order:
      - file.name
      - BGM\u8BC4\u5206
      - \u5236\u4F5C\u516C\u53F8
    image: note.cover
    imageAspectRatio: 1
    cardSize: 180
`;
  return content.trimEnd() + "\n" + block;
}

function formatScoreValue(value, digits) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return "未评分";
  }

  const precision = Math.max(
    1,
    Math.min(
      4,
      Number(digits) || 1
    )
  );

  return score.toFixed(precision);
}

function escapeFrontmatterValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function getScoreFieldLine(name, value) {
  return name + ': "' +
    escapeFrontmatterValue(value) +
    '"';
}

function rebuildScoreFrontmatter(
  content,
  options = {},
  overrides = {}
) {
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    return content;
  }

  const oldFields = parsed.fields;

  const currentBangumiScore = cleanValue(
    overrides.bangumiScore !== undefined
      ? overrides.bangumiScore
      : (oldFields.BGM评分 || oldFields["BGM 评分"])
  );

  const legacyPreciseScore = cleanValue(
    oldFields.BGM精确评分
  );

  const shouldUsePreciseScore =
    options.useBangumiPreciseScore === true;

  const bangumiScore =
    shouldUsePreciseScore &&
    legacyPreciseScore &&
    overrides.bangumiScore === undefined
      ? legacyPreciseScore
      : currentBangumiScore;

  const bangumiScoreForDisplay = bangumiScore
    ? formatScoreValue(
        bangumiScore,
        shouldUsePreciseScore
          ? options.bangumiPreciseScoreDisplayDigits
          : 1
      )
    : "";

  const scoreValues = {
    BGM评分: bangumiScoreForDisplay,
    "你在 BGM 上的评分": cleanValue(
      oldFields["你在 BGM 上的评分"] ||
      oldFields["你在BGM上的评分"] ||
      oldFields.BGM用户评分 ||
      oldFields["BGM 用户评分"] ||
      oldFields.Bangumi用户评分
    )
  };

  const managedFields = new Set([
    "BGM评分",
    "BGM 评分",
    "BGM精确评分",
    "你在 BGM 上的评分",
    "你在BGM上的评分",
    "BGM用户评分",
    "BGM 用户评分",
    "Bangumi用户评分"
  ]);

  const retainedLines = parsed.body
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(
        /^\s*([^:]+?)\s*:/
      );

      return !match ||
        !managedFields.has(match[1].trim());
    });

  const scoreLines = [
    "BGM评分",
    "你在 BGM 上的评分"
  ].filter((name) => {
    return Boolean(scoreValues[name]);
  }).map((name) => {
    return getScoreFieldLine(
      name,
      scoreValues[name]
    );
  });

  const rebuiltLines = [];
  let inserted = false;

  for (const line of retainedLines) {
    rebuiltLines.push(line);

    if (
      !inserted &&
      /^\s*BGM链接\s*:/.test(line)
    ) {
      rebuiltLines.push(...scoreLines);
      inserted = true;
    }
  }

  if (!inserted && scoreLines.length) {
    rebuiltLines.push(...scoreLines);
  }

  return content.replace(
    parsed.full,
    "---\n" +
    rebuiltLines.join("\n") +
    "\n---"
  );
}
function rebuildScoreDisplay(
  content,
  options = {}
) {
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    return content;
  }

  const bangumiScore = cleanValue(
    parsed.fields.BGM评分
  );

  const tableFieldNames = [
    "BGM评分",
    "BGM 评分",
    "BGM精确评分"
  ];

  const cleanedLines = String(content || "")
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(
        /^\|\s*([^|]+?)\s*\|/
      );

      return !match ||
        !tableFieldNames.includes(
          match[1].trim()
        );
    });

  const tableRows = [];

  if (bangumiScore) {
    tableRows.push(
      "| BGM 评分 | " +
      formatScoreValue(
        bangumiScore,
        options.useBangumiPreciseScore === true
          ? options.bangumiPreciseScoreDisplayDigits
          : 1
      ) +
      " |"
    );
  }

  const rebuiltLines = [];
  let inserted = false;

  for (const line of cleanedLines) {
    rebuiltLines.push(line);

    if (
      !inserted &&
      /^\|\s*BGM\s+地址\s*\|/.test(line)
    ) {
      rebuiltLines.push(...tableRows);
      inserted = true;
    }
  }

  if (!inserted && tableRows.length) {
    rebuiltLines.push(...tableRows);
  }

  return rebuiltLines.join("\n");
}
function synchronizeBangumiScoreFields(
  content,
  options = {},
  overrides = {}
) {
  return rebuildScoreDisplay(
    rebuildScoreFrontmatter(
      content,
      options,
      overrides
    ),
    options
  );
}



function updateWatchedEpisodes(content, count) {
  const patterns = [
    /(\*\*已观看集数\s*：\s*\*\*\s*)\d+(?:\.\d+)?/,
    /(\*\*已观看集数\s*:\s*\*\*\s*)\d+(?:\.\d+)?/,
    /(\*\*已观看集数\*\*\s*：\s*)\d+(?:\.\d+)?/,
    /(\*\*已观看集数\*\*\s*:\s*)\d+(?:\.\d+)?/
  ];
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return content.replace(pattern, `$1${count}`);
    }
  }
  const parsed = parseFrontmatter(content);
  if (parsed) {
    return content.replace(parsed.full, parsed.full + `\n\n**已观看集数**： ${count}`);
  }
  return `**已观看集数**： ${count}\n\n` + content;
}

function updateCalloutTableRow(content, fieldName, newValue) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^((?:>\\s*)?\\|\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*\\|)[^|\\r\\n]*(\\|)`, "m");
  if (regex.test(content)) {
    return content.replace(regex, `$1 ${newValue} $2`);
  }
  return content;
}

function syncNoteCalloutFromFrontmatter(content) {
  const parsed = parseFrontmatter(content);
  if (!parsed || !parsed.fields) return content;
  // 排除角色典藏笔记与非动画笔记，防止向角色笔记误注入“已观看集数”等字段
  if (
    parsed.fields["角色中文名"] !== undefined ||
    parsed.fields["个人喜爱度评分"] !== undefined ||
    parsed.fields["Bangumi角色页"] !== undefined
  ) {
    return content;
  }
  const hasBangumiTag = String(parsed.fields.tags || "").toLowerCase().includes("bangumi");
  const hasBgmSubjectLink = Boolean(parsed.fields["BGM链接"]);
  if (!hasBangumiTag && !hasBgmSubjectLink) {
    return content;
  }

  let updated = content;

  if (parsed.fields["观看状态"]) {
    const st = cleanValue(parsed.fields["观看状态"]);
    if (st) {
      updated = updateCalloutTableRow(updated, "观看状态", st);
    }
  }

  if (parsed.fields["我的评分"] !== undefined) {
    const sc = cleanValue(parsed.fields["我的评分"]);
    updated = updateCalloutTableRow(updated, "我的评分", sc || "未评分");
  }

  const userBgmFieldVal =
    parsed.fields["你在 BGM 上的评分"] ??
    parsed.fields["你在BGM上的评分"] ??
    parsed.fields["BGM用户评分"] ??
    parsed.fields["BGM 用户评分"] ??
    parsed.fields["Bangumi用户评分"];
  if (userBgmFieldVal !== undefined) {
    const sc = cleanValue(userBgmFieldVal) || "未评分";
    updated = updateCalloutTableRow(updated, "你在 BGM 上的评分", sc);
    updated = updateCalloutTableRow(updated, "你在BGM上的评分", sc);
    updated = updateCalloutTableRow(updated, "BGM用户评分", sc);
    updated = updateCalloutTableRow(updated, "BGM 用户评分", sc);
    updated = updateCalloutTableRow(updated, "Bangumi用户评分", sc);
    updated = updated.replace(
      /^((?:>\s*)?\|\s*(?:\*\*)?)(?:BGM\s*用户评分|Bangumi\s*用户评分)((?:\*\*)?\s*\|)/gm,
      "$1你在 BGM 上的评分$2"
    );
  }

  if (parsed.fields["BGM评分"] !== undefined || parsed.fields["BGM 评分"] !== undefined) {
    const sc = cleanValue(parsed.fields["BGM评分"] || parsed.fields["BGM 评分"]);
    if (sc) {
      updated = updateCalloutTableRow(updated, "BGM 评分", sc);
      updated = updateCalloutTableRow(updated, "BGM评分", sc);
    }
  }

  const hasWatchedLineInBody = /\*\*已观看集数\s*[：:]?\s*\*\*/.test(content);
  let ep = null;
  if (parsed.fields["已观看集数"] !== undefined) {
    const parsedEp = parseInt(parsed.fields["已观看集数"], 10);
    if (!isNaN(parsedEp)) ep = parsedEp;
  } else if (hasWatchedLineInBody) {
    ep = extractWatchedEpisodes(content);
  }

  if (ep !== null && !isNaN(ep) && ep >= 0) {
    if (hasWatchedLineInBody || parsed.fields["已观看集数"] !== undefined) {
      updated = updateWatchedEpisodes(updated, ep);
    }
    updated = updateCalloutTableRow(updated, "已观看集数", String(ep));
  }

  if (parsed.fields["下载路径"] !== undefined) {
    const dl = cleanValue(parsed.fields["下载路径"]);
    if (dl && dl !== "无") {
      updated = updateCalloutTableRow(updated, "下载路径", "`" + dl + "`");
    }
  }

  return updated;
}

function addNoteTag(content, tag) {
  const cleanTag = String(tag || "").trim().replace(/^#/, "");
  if (!cleanTag) return content;
  const parsed = parseFrontmatter(content);
  if (!parsed) return content;

  let existing = cleanValue(parsed.fields.tags || "");
  const tokens = existing.split(/[,;\s#\[\]"']+/).filter(Boolean);
  if (tokens.includes(cleanTag)) {
    return content;
  }
  tokens.push(cleanTag);
  const newTags = tokens.join(", ");
  return updateFrontmatterField(content, "tags", newTags);
}

function removeNoteTag(content, tag) {
  const cleanTag = String(tag || "").trim().replace(/^#/, "");
  if (!cleanTag || cleanTag.toLowerCase() === "bangumi") return content;
  const parsed = parseFrontmatter(content);
  if (!parsed) return content;

  let existing = cleanValue(parsed.fields.tags || "");
  const tokens = existing.split(/[,;\s#\[\]"']+/).filter(Boolean);
  const remaining = tokens.filter((t) => t !== cleanTag);
  if (remaining.length === tokens.length) {
    return content;
  }
  const newTags = remaining.join(", ");
  return updateFrontmatterField(content, "tags", newTags);
}

/**
 * ==================== 观片手札（吐槽 / 短评 / 长评）与智能时间戳双向解析引擎 ====================
 */
function normalizeTimestampInput(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/[：．.]/g, ":")
    .trim();
  if (!s) return "";

  // 标准 HH:MM:SS 或 MM:SS
  const colonMatch = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    if (colonMatch[3] !== undefined) {
      const hh = parseInt(colonMatch[1], 10);
      const mm = parseInt(colonMatch[2], 10);
      const ss = parseInt(colonMatch[3], 10);
      if (mm >= 60 || ss >= 60) return "";
      if (hh > 0) {
        return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
      return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    } else {
      const mm = parseInt(colonMatch[1], 10);
      const ss = parseInt(colonMatch[2], 10);
      if (ss >= 60) return "";
      if (mm >= 60) {
        const hh = Math.floor(mm / 60);
        const remM = mm % 60;
        return `${String(hh).padStart(2, "0")}:${String(remM).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
      return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }
  }

  // 纯数字简写（如 1234 -> 12:34, 520 -> 05:20, 10520 -> 01:05:20, 45 -> 00:45）
  if (/^\d{1,6}$/.test(s)) {
    if (s.length <= 2) {
      const sec = parseInt(s, 10);
      if (sec < 60) {
        return `00:${String(sec).padStart(2, "0")}`;
      }
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }
    if (s.length <= 4) {
      const padded = s.padStart(4, "0");
      const mm = parseInt(padded.slice(0, 2), 10);
      const ss = parseInt(padded.slice(2, 4), 10);
      if (ss < 60) {
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
    }
    if (s.length <= 6) {
      const padded = s.padStart(6, "0");
      const hh = parseInt(padded.slice(0, 2), 10);
      const mm = parseInt(padded.slice(2, 4), 10);
      const ss = parseInt(padded.slice(4, 6), 10);
      if (mm < 60 && ss < 60) {
        return hh > 0
          ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
          : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
    }
  }

  return "";
}

function parseTimestampToSeconds(ts) {
  const norm = normalizeTimestampInput(ts);
  if (!norm) return null;
  const parts = norm.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => isNaN(n))) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

function formatSecondsToTimestamp(sec, forceHours = false) {
  if (sec === null || sec === undefined || !Number.isFinite(Number(sec)) || Number(sec) < 0) {
    return "";
  }
  const total = Math.floor(Number(sec));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (forceHours || hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * 从输入文本开头智能识别时间码：
 * 1. 若整段文本仅输入了一个时间码（如 "14:22" 或 "1422"），返回 { timestamp: "14:22", cleanText: "" }（触发时间点占位书签！）
 * 2. 若文本开头为时间码加空格（如 "12:34 这段作画绝了" 或 "1234 这段作画绝了"），提取时间码并剥离前缀
 */
function extractLeadingTimestampFromText(rawText) {
  const text = String(rawText || "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { timestamp: "", cleanText: "" };
  }

  // 情况 1：整段输入仅有一个时间码（如 "12:34"、"[12:34]"、"1234"、"01:05:20"）
  if (/^\[?\d{1,2}[:：.]\d{2}(?:[:：.]\d{2})?\]?$/.test(trimmed) || /^\d{3,6}$/.test(trimmed)) {
    const onlyTs = normalizeTimestampInput(trimmed);
    if (onlyTs) {
      return { timestamp: onlyTs, cleanText: "" };
    }
  }

  // 情况 2：开头带标准时间码 "[12:34] 正文" 或 "12:34 正文" 或 "12：34 正文"
  const prefixColon = trimmed.match(/^\[?(\d{1,2}[:：.]\d{2}(?:[:：.]\d{2})?)\]?(?:\s+|[,，。、\-—|]+)(.*)$/s);
  if (prefixColon) {
    const ts = normalizeTimestampInput(prefixColon[1]);
    if (ts) {
      return { timestamp: ts, cleanText: prefixColon[2].trim() };
    }
  }

  // 情况 3：开头带 3~4 位纯数字时间码 + 空格 + 正文（如 "451 这段作画绝了" -> 04:51、"1234 这段作画绝了" -> 12:34，排除年份或量词如 "2025 年"、"100 个"）
  const prefixDigits = trimmed.match(/^(\d{3,4})\s+([^\s].*)$/s);
  if (prefixDigits) {
    const rawDigits = prefixDigits[1];
    const padded = rawDigits.padStart(4, "0");
    const mm = parseInt(padded.slice(0, 2), 10);
    const ss = parseInt(padded.slice(2, 4), 10);
    // 动漫单集通常在 00:00 ~ 59:59 之间，且紧跟的不是“年/月/日/话/集/部/个/条/次/人/分/秒/倍/帧”等量词
    if (mm < 60 && ss < 60 && !/^[年月日话集話部个条次人分秒天周季期倍帧%]/.test(prefixDigits[2])) {
      const ts = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      return { timestamp: ts, cleanText: prefixDigits[2].trim() };
    }
  }

  return { timestamp: "", cleanText: text };
}

function parseScopeToken(rawToken) {
  const tok = String(rawToken || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .trim();
  if (!tok) return null;

  if (/^(?:全剧|全集|总评|全剧总评|整部|ALL)$/i.test(tok)) {
    return {
      scopeType: "all",
      epStart: null,
      epEnd: null,
      scopeCode: "全剧",
      scopeDisplay: "全剧总评"
    };
  }

  const rangeMatch = tok.match(/^(?:EP|E|第)?\s*(\d{1,4})\s*[-~～至到]\s*(?:EP|E|第)?\s*(\d{1,4})\s*(?:话|集|話)?$/i);
  if (rangeMatch) {
    let a = parseInt(rangeMatch[1], 10);
    let b = parseInt(rangeMatch[2], 10);
    if (a > b) [a, b] = [b, a];
    if (a === b) {
      const p = String(a).padStart(2, "0");
      return {
        scopeType: "single",
        epStart: a,
        epEnd: a,
        scopeCode: `EP${p}`,
        scopeDisplay: `EP${p}`
      };
    }
    const pa = String(a).padStart(2, "0");
    const pb = String(b).padStart(2, "0");
    return {
      scopeType: "range",
      epStart: a,
      epEnd: b,
      scopeCode: `EP${pa}-${pb}`,
      scopeDisplay: `EP${pa}–${pb}`
    };
  }

  const singleMatch = tok.match(/^(?:EP|E|第)\s*(\d{1,4})\s*(?:话|集|話)?$/i) || tok.match(/^(\d{1,4})\s*(?:话|集|話)$/i);
  if (singleMatch) {
    const ep = parseInt(singleMatch[1], 10);
    const p = String(ep).padStart(2, "0");
    return {
      scopeType: "single",
      epStart: ep,
      epEnd: ep,
      scopeCode: `EP${p}`,
      scopeDisplay: `EP${p}`
    };
  }

  return null;
}

function parseReviewTypeToken(rawToken, calloutKind = "") {
  const tok = String(rawToken || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .trim();
  if (/^(?:吐槽|随记|弹幕|quip)$/i.test(tok)) {
    return { type: "quip", typeLabel: "吐槽" };
  }
  if (/^(?:短评|简评|short)$/i.test(tok)) {
    return { type: "short", typeLabel: "短评" };
  }
  if (/^(?:长评|剧评|深评|文章|long)$/i.test(tok)) {
    return { type: "long", typeLabel: "长评" };
  }
  const ck = String(calloutKind || "").toLowerCase();
  if (ck.includes("quote") || ck.includes("quip")) {
    return { type: "quip", typeLabel: "吐槽" };
  }
  if (ck.includes("abstract") || ck.includes("long") || ck.includes("summary")) {
    return { type: "long", typeLabel: "长评" };
  }
  if (ck.includes("note") || ck.includes("short")) {
    return { type: "short", typeLabel: "短评" };
  }
  return null;
}

function normalizeReviewEntry(raw, idx = 0) {
  const typeObj = parseReviewTypeToken(raw?.type || raw?.typeLabel, raw?.calloutKind) || {
    type: "quip",
    typeLabel: "吐槽"
  };

  let scopeObj = null;
  if (raw?.scopeCode || raw?.scope) {
    scopeObj = parseScopeToken(raw.scopeCode || raw.scope);
  }
  if (!scopeObj) {
    if (raw?.scopeType === "range" && raw.epStart != null && raw.epEnd != null) {
      scopeObj = parseScopeToken(`EP${raw.epStart}-${raw.epEnd}`);
    } else if (raw?.scopeType === "single" && (raw.epStart != null || raw.episode != null)) {
      scopeObj = parseScopeToken(`EP${raw.epStart ?? raw.episode}`);
    } else if (raw?.epStart != null || raw?.episode != null) {
      scopeObj = parseScopeToken(`EP${raw.epStart ?? raw.episode}`);
    } else {
      scopeObj = {
        scopeType: "all",
        epStart: null,
        epEnd: null,
        scopeCode: "全剧",
        scopeDisplay: "全剧总评"
      };
    }
  }

  const timestamp = normalizeTimestampInput(raw?.timestamp || "");
  const timestampSeconds = timestamp ? parseTimestampToSeconds(timestamp) : null;

  const rawImages = Array.isArray(raw?.images) ? raw.images : [];
  const images = rawImages
    .map((im) => {
      if (typeof im === "string") {
        return { path: im.trim(), isCover: false };
      }
      return {
        path: String(im?.path || "").trim(),
        isCover: Boolean(im?.isCover),
        noCover: Boolean(im?.noCover)
      };
    })
    .filter((im) => im.path);

  let coverImage = String(raw?.coverImage || "").trim();
  const explicitCover = images.find((im) => im.isCover);
  if (explicitCover) {
    coverImage = explicitCover.path;
  } else if (coverImage && images.some((im) => im.path === coverImage)) {
    images.forEach((im) => {
      im.isCover = im.path === coverImage;
    });
  } else if (images.length > 0 && !images.every((im) => im.noCover)) {
    coverImage = images[0].path;
    images[0].isCover = true;
  } else {
    coverImage = "";
  }

  const cleanText = String(raw?.text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  const isPlaceholder = Boolean(!cleanText);

  const todayStr = new Date().toISOString().slice(0, 10);
  const date = String(raw?.date ?? todayStr).trim();
  const title = String(raw?.title || "").trim();

  return {
    id: raw?.id || `rev_${idx + 1}_${Date.now().toString(36)}`,
    type: typeObj.type,
    typeLabel: typeObj.typeLabel,
    scopeType: scopeObj.scopeType,
    epStart: scopeObj.epStart,
    epEnd: scopeObj.epEnd,
    episode: scopeObj.epStart,
    scopeCode: scopeObj.scopeCode,
    scope: scopeObj.scopeCode,
    scopeDisplay: scopeObj.scopeDisplay,
    timestamp,
    timestampSeconds,
    title,
    date,
    text: cleanText,
    images,
    coverImage,
    isPlaceholder
  };
}

function parseSingleReviewHeaderAndBody(headerLine, bodyLines, calloutKind, idx) {
  let remHeader = String(headerLine || "").trim();
  const bracketMatches = [...remHeader.matchAll(/\[([^\]]+)\]/g)];

  let parsedType = null;
  let parsedScope = null;
  let parsedTs = "";
  let explicitPlaceholder = false;

  for (const m of bracketMatches) {
    const inner = m[1].trim();
    if (!parsedType) {
      const t = parseReviewTypeToken(inner, "");
      if (t) {
        parsedType = t;
        remHeader = remHeader.replace(m[0], " ");
        continue;
      }
    }
    if (!parsedScope) {
      const sc = parseScopeToken(inner);
      if (sc) {
        parsedScope = sc;
        remHeader = remHeader.replace(m[0], " ");
        continue;
      }
    }
    if (!parsedTs && /^\d{1,2}[:：.]\d{2}(?:[:：.]\d{2})?$/.test(inner)) {
      const ts = normalizeTimestampInput(inner);
      if (ts) {
        parsedTs = ts;
        remHeader = remHeader.replace(m[0], " ");
        continue;
      }
    }
    if (/^(?:待补完|待记|占位|书签|bookmark|placeholder)$/i.test(inner)) {
      explicitPlaceholder = true;
      remHeader = remHeader.replace(m[0], " ");
      continue;
    }
  }

  if (!parsedType) {
    parsedType = parseReviewTypeToken("", calloutKind) || { type: "short", typeLabel: "短评" };
  }

  // 若用户没加方括号，尝试在剩余标题里宽松识别 EP03 / 12:34 / 日期 / 标题
  remHeader = remHeader.replace(/\s+/g, " ").trim();
  if (!parsedScope) {
    const looseScope = remHeader.match(/\b(EP\d{1,4}(?:-\d{1,4})?|第\d{1,4}(?:-\d{1,4})?[话集話]|全剧(?:总评)?)\b/i);
    if (looseScope) {
      parsedScope = parseScopeToken(looseScope[1]);
      remHeader = remHeader.replace(looseScope[0], " ").trim();
    }
  }
  if (!parsedTs) {
    const looseTs = remHeader.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (looseTs) {
      parsedTs = normalizeTimestampInput(looseTs[1]);
      remHeader = remHeader.replace(looseTs[0], " ").trim();
    }
  }

  let date = "";
  const dateMatch = remHeader.match(/\b(20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\b/);
  if (dateMatch) {
    date = dateMatch[1];
    remHeader = remHeader.replace(dateMatch[0], " ").trim();
  }

  const title = remHeader.replace(/^[|·\-—\s]+|[|·\-—\s]+$/g, "").trim();

  // 解析正文与内嵌图片
  const images = [];
  const textLines = [];

  for (const rawLine of bodyLines) {
    const cleanedComment = String(rawLine || "").replace(/<!--[\s\S]*?-->/g, "");
    let lineRem = cleanedComment;

    // 匹配 Obsidian WikiLink 图片 ![[path|alt]]
    const wikiMatches = [...lineRem.matchAll(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)];
    for (const wm of wikiMatches) {
      const imgPath = wm[1].trim();
      const modifier = String(wm[2] || "").trim().toLowerCase();
      if (imgPath) {
        images.push({
          path: imgPath,
          isCover: modifier.includes("cover") || modifier.includes("封面"),
          noCover: modifier.includes("nocover")
        });
      }
      lineRem = lineRem.replace(wm[0], "");
    }

    // 匹配标准 Markdown 图片 ![alt](path)
    const mdMatches = [...lineRem.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    for (const mm of mdMatches) {
      const alt = String(mm[1] || "").trim().toLowerCase();
      const imgPath = mm[2].trim();
      if (imgPath) {
        images.push({
          path: imgPath,
          isCover: alt.includes("cover") || alt.includes("封面"),
          noCover: alt.includes("nocover")
        });
      }
      lineRem = lineRem.replace(mm[0], "");
    }

    // 若整行只有注释或只有图片，不额外塞入空行
    const hadImageOrComment =
      wikiMatches.length > 0 || mdMatches.length > 0 || /<!--[\s\S]*?-->/.test(rawLine);
    if (hadImageOrComment && !lineRem.trim()) {
      continue;
    }
    textLines.push(lineRem);
  }

  const cleanBodyText = textLines.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();

  return normalizeReviewEntry(
    {
      id: `rev_${idx + 1}`,
      type: parsedType.type,
      typeLabel: parsedType.typeLabel,
      scopeType: parsedScope?.scopeType || "all",
      epStart: parsedScope?.epStart ?? null,
      epEnd: parsedScope?.epEnd ?? null,
      scopeCode: parsedScope?.scopeCode || "全剧",
      timestamp: parsedTs,
      title,
      date,
      text: cleanBodyText,
      images,
      isPlaceholder: explicitPlaceholder && !cleanBodyText
    },
    idx
  );
}

/**
 * 从动画 Markdown 笔记内容中解析「# 观片手记与评价」或「# 个人总结」下的所有手札卡片
 */
function parseNoteReviewsSection(content) {
  const source = String(content || "");
  const headingMatch = source.match(/^#+\s*(?:观片手记与评价|个人总结)\s*$/m);
  if (!headingMatch || headingMatch.index === undefined) {
    return [];
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const afterHeading = source.slice(sectionStart);
  const nextH1Match = afterHeading.match(/^#\s+[^\r\n]+/m);
  const rawSection =
    nextH1Match && nextH1Match.index !== undefined
      ? afterHeading.slice(0, nextH1Match.index)
      : afterHeading;

  const lines = rawSection.split(/\r?\n/);
  const reviews = [];
  let i = 0;
  let legacyLines = [];

  const flushLegacy = () => {
    if (!legacyLines.length) return;
    const joined = legacyLines
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    legacyLines = [];
    if (!joined) return;
    reviews.push(
      normalizeReviewEntry(
        {
          id: `rev_${reviews.length + 1}`,
          type: joined.length > 140 ? "long" : "short",
          scopeCode: "全剧",
          date: "",
          text: joined
        },
        reviews.length
      )
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    // 1. 识别 Obsidian Callout 语法块: > [!quote] [吐槽] [EP03] [14:22] ...
    const calloutStart = line.match(/^\s*>\s*\[!([a-zA-Z0-9_-]+)\][+-]?\s*(.*)$/);
    if (calloutStart) {
      flushLegacy();
      const calloutKind = calloutStart[1];
      const headerRest = calloutStart[2] || "";
      const bodyLines = [];
      i += 1;
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        // 如果连续两个 Callout 没有空行隔开，遇到下一个 > [!xxx] 立即结束当前块
        if (/^\s*>\s*\[!([a-zA-Z0-9_-]+)\]/.test(lines[i])) {
          break;
        }
        bodyLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      reviews.push(
        parseSingleReviewHeaderAndBody(headerRest, bodyLines, calloutKind, reviews.length)
      );
      continue;
    }

    // 2. 兼容手写三级标题语法: ### [吐槽] [EP03] 14:22
    const headingBlockStart = line.match(/^\s*#{2,4}\s*(?:\[|💬|✒️|📜|⏱️)(.*)$/);
    if (headingBlockStart) {
      flushLegacy();
      const headerRest = line.replace(/^\s*#{2,4}\s*/, "");
      const bodyLines = [];
      i += 1;
      while (
        i < lines.length &&
        !/^\s*>\s*\[!/.test(lines[i]) &&
        !/^\s*#{1,4}\s+/.test(lines[i])
      ) {
        bodyLines.push(lines[i]);
        i += 1;
      }
      reviews.push(
        parseSingleReviewHeaderAndBody(headerRest, bodyLines, "", reviews.length)
      );
      continue;
    }

    legacyLines.push(line);
    i += 1;
  }

  flushLegacy();
  return reviews;
}

/**
 * 将单条观片手札序列化为干净优雅、人机共读的 Obsidian 原生 Callout Markdown
 */
function formatReviewToMarkdownBlock(rawReview, idx = 0) {
  const rev = normalizeReviewEntry(rawReview, idx);
  const calloutMap = {
    quip: "quote",
    short: "note",
    long: "abstract"
  };
  const calloutType = calloutMap[rev.type] || "quote";

  const headerTokens = [`[!${calloutType}]`, `[${rev.typeLabel}]`, `[${rev.scopeCode}]`];
  if (rev.timestamp) {
    headerTokens.push(`[${rev.timestamp}]`);
  }
  if (rev.isPlaceholder) {
    headerTokens.push(`[待补完]`);
  }

  const metaTailParts = [];
  if (rev.title) metaTailParts.push(rev.title);
  if (rev.date) metaTailParts.push(rev.date);
  if (metaTailParts.length > 0) {
    headerTokens.push(metaTailParts.join(" | "));
  }

  const outLines = [`> ${headerTokens.join(" ")}`];

  if (rev.text) {
    const textLines = rev.text.split(/\r?\n/);
    for (const tl of textLines) {
      outLines.push(tl ? `> ${tl}` : `>`);
    }
  } else {
    outLines.push(`> <!-- ⏱️ 时间点书签占位：点击档案馆手札卡片或在此直接输入文字即可补完 -->`);
  }

  if (Array.isArray(rev.images) && rev.images.length > 0) {
    for (const im of rev.images) {
      const cleanPath = String(im.path || "").trim();
      if (!cleanPath) continue;
      const isCover = rev.coverImage && cleanPath === rev.coverImage;
      if (isCover) {
        outLines.push(`> ![[${cleanPath}|cover]]`);
      } else if (im.noCover) {
        outLines.push(`> ![[${cleanPath}|nocover]]`);
      } else {
        outLines.push(`> ![[${cleanPath}]]`);
      }
    }
  }

  return outLines.join("\n");
}

/**
 * 将结构化手札数组写回动画 Markdown 笔记的「# 观片手记与评价」（双向兼容「# 个人总结」）
 */
function updateNoteReviewsSection(content, reviews) {
  const source = String(content || "");
  const list = Array.isArray(reviews) ? reviews : [];
  const defaultComment =
    '<!-- 观片手札：支持在番剧档案馆「观片手札」面板可视化管理，或直接按 "> [!quote] [吐槽|短评|长评] [全剧|EP01|EP01-03] [12:34]" 格式手写编辑 -->';

  const blocks = list.map((r, idx) => formatReviewToMarkdownBlock(r, idx));
  const sectionBody =
    blocks.length > 0 ? `${defaultComment}\n\n${blocks.join("\n\n")}` : defaultComment;

  const headingMatch = source.match(/^(#+\s*(?:观片手记与评价|个人总结))\s*$/m);
  if (headingMatch && headingMatch.index !== undefined) {
    const headingStart = headingMatch.index;
    const headingLine = headingMatch[1];
    const afterHeadingStart = headingStart + headingMatch[0].length;
    const afterHeading = source.slice(afterHeadingStart);
    const nextH1Match = afterHeading.match(/^#\s+[^\r\n]+/m);

    const beforePart = source.slice(0, headingStart).trimEnd();
    const tailPart =
      nextH1Match && nextH1Match.index !== undefined
        ? "\n\n" + afterHeading.slice(nextH1Match.index).trimStart()
        : "";

    return `${beforePart}\n\n${headingLine}\n\n${sectionBody}\n${tailPart}`;
  }

  return `${source.trimEnd()}\n\n# 观片手记与评价\n\n${sectionBody}\n`;
}

/**
 * 无损检测并升级旧版本插件生成的动画 Markdown 笔记结构：
 * - 100% 保留用户已填写的所有评分、标签、观看集数、本地路径、观看网址与手记正文；
 * - 自动补齐新版所需字段与区块（如 `我的评分`、`下载路径` 双向对齐、`**观看网址**`、Netaba 页面切换控件容器、`# 观片手记与评价` 区块及标准加粗语法）。
 */
function inspectAndUpgradeAnimeNoteContent(content, options = {}) {
  const source = String(content || "");
  const parsed0 = parseFrontmatter(source);
  if (!parsed0 || !parsed0.fields) {
    return {
      isTargetAnimeNote: false,
      needsUpgrade: false,
      reasons: [],
      upgradedContent: source
    };
  }

  const f0 = parsed0.fields;
  if (
    f0["角色中文名"] !== undefined ||
    f0["个人喜爱度评分"] !== undefined ||
    f0["Bangumi角色页"] !== undefined ||
    f0["游戏状态"] !== undefined ||
    f0["游玩时长"] !== undefined ||
    f0["开发发行"] !== undefined
  ) {
    return {
      isTargetAnimeNote: false,
      needsUpgrade: false,
      reasons: [],
      upgradedContent: source
    };
  }

  const hasBangumiTag = String(f0.tags || "").toLowerCase().includes("bangumi");
  const hasBgmLink = Boolean(cleanValue(f0["BGM链接"]));
  if (!hasBangumiTag && !hasBgmLink) {
    return {
      isTargetAnimeNote: false,
      needsUpgrade: false,
      reasons: [],
      upgradedContent: source
    };
  }

  let updated = source;
  const reasons = [];

  // 1. 升级旧版评分字段别名（如 BGM用户评分 / BGM精确评分 -> 你在 BGM 上的评分）
  const hasLegacyScoreField =
    f0["BGM用户评分"] !== undefined ||
    f0["BGM 用户评分"] !== undefined ||
    f0["Bangumi用户评分"] !== undefined ||
    f0["你在BGM上的评分"] !== undefined ||
    f0["BGM精确评分"] !== undefined;
  if (hasLegacyScoreField) {
    const syncedScore = synchronizeBangumiScoreFields(updated, options);
    if (syncedScore !== updated) {
      updated = syncedScore;
      reasons.push("统一旧版 Bangumi 评分字段命名");
    }
  }

  // 2. 补齐「我的评分」属性与表格行（优先继承缓存评分）
  let parsedNow = parseFrontmatter(updated);
  if (parsedNow && parsedNow.fields && parsedNow.fields["我的评分"] === undefined) {
    const cachedScore = String(options.cachedPersonalScore || "").trim();
    const myScoreVal = cachedScore && cachedScore !== "未知" ? cachedScore : "未评分";
    updated = updateFrontmatterField(updated, "我的评分", myScoreVal);
    if (!/^\s*(?:>\s*)?\|\s*(?:\*\*)?我的评分(?:\*\*)?\s*\|/m.test(updated)) {
      const anchorRe = /^(\s*(?:>\s*)?\|\s*(?:\*\*)?(?:你在\s*BGM\s*上的评分|BGM\s*评分)(?:\*\*)?\s*\|[^\r\n]*)$/m;
      if (anchorRe.test(updated)) {
        updated = updated.replace(anchorRe, `$1\n| 我的评分 | ${myScoreVal} |`);
      }
    }
    reasons.push("补齐「我的评分」字段");
  }

  // 3. 规范化「**已观看集数**：」加粗冒号位置（修复旧版 **已观看集数：** 冒号在星号内的问题）
  if (/\*\*已观看集数\s*[：:]\s*\*\*/.test(updated)) {
    const curWatched = extractWatchedEpisodes(updated);
    const fixedWatched = updated.replace(
      /\*\*已观看集数\s*[：:]\s*\*\*\s*\d+(?:\.\d+)?/,
      `**已观看集数**： ${curWatched}`
    );
    if (fixedWatched !== updated) {
      updated = fixedWatched;
      reasons.push("规范「已观看集数」Markdown 语法");
    }
  }

  // 4. 双向对齐 Frontmatter「下载路径」与正文「**本地文件夹**」链接
  parsedNow = parseFrontmatter(updated);
  if (parsedNow && parsedNow.fields) {
    const fmDlRaw = cleanValue(parsedNow.fields["下载路径"]);
    const fmHasRealPath = Boolean(fmDlRaw && fmDlRaw !== "无" && fmDlRaw !== "未设置");
    const bodyFileUrlMatch = updated.match(
      /^\*\*本地文件夹\s*[：:]?\s*\*\*\s*[：:]?\s*\[[^\]]*\]\(file:\/\/(\/?[^)\r\n]+)\)/m
    );
    let bodyRecoveredPath = "";
    if (bodyFileUrlMatch && bodyFileUrlMatch[1]) {
      let rawTail = bodyFileUrlMatch[1].trim();
      try {
        rawTail = decodeURIComponent(rawTail).trim();
      } catch (_) {
        try {
          rawTail = decodeURI(rawTail).trim();
        } catch (__) {}
      }
      if (/^\/[A-Za-z]:\//.test(rawTail)) {
        bodyRecoveredPath = rawTail.slice(1);
      } else if (!rawTail.startsWith("/") && !/^[A-Za-z]:/.test(rawTail)) {
        bodyRecoveredPath = "/" + rawTail;
      } else {
        bodyRecoveredPath = rawTail;
      }
    }

    if (!fmHasRealPath && bodyRecoveredPath) {
      updated = updateFrontmatterField(updated, "下载路径", bodyRecoveredPath);
      reasons.push("从正文恢复 Frontmatter「下载路径」");
    } else if (parsedNow.fields["下载路径"] === undefined) {
      updated = updateFrontmatterField(updated, "下载路径", "无");
      reasons.push("补齐 Frontmatter「下载路径」字段");
    }

    const effectivePath = fmHasRealPath ? fmDlRaw : bodyRecoveredPath;
    if (effectivePath) {
      const folderUpdated = updateFolderLine(updated, { downloadPath: effectivePath, error: null });
      if (folderUpdated !== updated) {
        updated = folderUpdated;
        reasons.push("同步正文「本地文件夹」快捷打开链接");
      }
    } else if (!/^\*\*本地文件夹\s*[：:]?\s*\*\*/m.test(updated)) {
      updated = updateFolderLine(updated, { downloadPath: "", error: null });
      reasons.push("补齐正文「本地文件夹」行");
    }
  }

  // 5. 补齐「**观看网址**：」行（旧版模板未生成该行）
  if (!/^\*\*观看网址\s*[：:]?\s*\*\*/m.test(updated)) {
    const folderLineRe = /^(\*\*本地文件夹[^\r\n]*)$/m;
    if (folderLineRe.test(updated)) {
      updated = updated.replace(folderLineRe, "$1\n**观看网址**： ");
      reasons.push("补齐「观看网址」快捷记录行");
    }
  }

  // 6. 升级旧版裸 `<!-- Netaba评分趋势图 -->` 区块为新版带交互控件容器的标准区块（保留原 iframe URL）
  const hasLegacyNetabaComment = updated.includes("<!-- Netaba评分趋势图 -->");
  const hasNewNetabaHeading = /^#\s*Netaba评分趋势图\s*$/m.test(updated);
  if (hasLegacyNetabaComment && !hasNewNetabaHeading) {
    const legacyBlockRe =
      /<!--\s*Netaba评分趋势图\s*-->[\s\S]*?<iframe[^>]+src=["']([^"']+)["'][^>]*>\s*<\/iframe>\s*(?:<\/div>\s*)?(?:<\/details>)?/i;
    const m = updated.match(legacyBlockRe);
    if (m && m[1]) {
      const iframeUrl = m[1];
      const replacement = [
        "# Netaba评分趋势图",
        "",
        '<div class="bangumi-netaba-controls" data-netaba-controls="true"></div>',
        "",
        '<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">',
        `<iframe src="${iframeUrl}" style="display:block;width:100%;height:600px;border:0;"></iframe>`,
        "</div>"
      ].join("\n");
      updated = updated.replace(legacyBlockRe, replacement);
      reasons.push("升级「Netaba评分趋势图」页面切换控件区块");
    }
  } else if (hasNewNetabaHeading && !updated.includes("bangumi-netaba-controls")) {
    updated = updated.replace(
      /^(#\s*Netaba评分趋势图\s*)$/m,
      '$1\n\n<div class="bangumi-netaba-controls" data-netaba-controls="true"></div>'
    );
    reasons.push("补齐 Netaba 页面切换控件挂载点");
  }

  // 7. 补齐末尾「# 观片手记与评价」区块（若既无「观片手记与评价」也无旧版「个人总结」）
  if (!/^#+\s*(?:观片手记与评价|个人总结)\s*$/m.test(updated)) {
    const defaultGuide =
      '<!-- 观片手札：支持在番剧档案馆「观片手札」面板可视化管理，或直接按 "> [!quote] [吐槽|短评|长评] [全剧|EP01|EP01-03] [12:34]" 格式手写编辑 -->';
    updated = `${updated.trimEnd()}\n\n# 观片手记与评价\n\n${defaultGuide}\n`;
    reasons.push("补齐「观片手记与评价」手札区块");
  }

  // 8. 同步动画信息卡 Callout 与 Frontmatter 一致性
  const calloutSynced = syncNoteCalloutFromFrontmatter(updated);
  if (calloutSynced !== updated) {
    updated = calloutSynced;
    if (!reasons.includes("同步动画信息表格与属性一致性")) {
      reasons.push("同步动画信息表格与属性一致性");
    }
  }

  return {
    isTargetAnimeNote: true,
    needsUpgrade: updated !== source,
    reasons,
    upgradedContent: updated
  };
}

const TAG_EQUIVALENT_GROUPS = [
  ["百合", "轻百", "橘里橘气", "yuri", "gl", "girls love", "少女爱"],
  ["漫改", "漫画改", "漫画改编"],
  ["轻改", "轻小说改", "小说改", "轻小说改编", "小说改编"],
  ["游戏改", "游戏改编", "gal改", "galgame改"],
  ["原创", "原创动画", "original"],
  ["日常", "空气系", "轻日常"],
  ["芳文社", "kirara", "きらら"],
  ["治愈", "治愈系"],
  ["科幻", "sf", "sci-fi"],
  ["奇幻", "异世界", "魔法"],
  ["机战", "萝卜", "mecha"]
];

function expandTagEquivalents(rawToken) {
  const clean = String(rawToken || "")
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
  if (!clean) return [];
  const out = new Set([clean]);
  for (const grp of TAG_EQUIVALENT_GROUPS) {
    // Only bidirectional-expand exact canonical aliases (first 6 groups are strict synonyms; for broader groups, only expand when exact head matches)
    const lowerGrp = grp.map((x) => x.toLowerCase());
    if (lowerGrp[0] === clean) {
      lowerGrp.forEach((x) => out.add(x));
    } else if (lowerGrp.slice(0, 5).includes(clean) && ["百合", "漫改", "轻改", "游戏改", "原创", "日常", "芳文社", "治愈", "科幻"].includes(grp[0])) {
      out.add(lowerGrp[0]);
      if (grp[0] === "百合") {
        ["百合", "轻百", "yuri", "gl", "橘里橘气"].forEach((x) => out.add(x));
      } else {
        lowerGrp.forEach((x) => out.add(x));
      }
    }
  }
  return Array.from(out);
}

function matchesTagOrMetaQuery(item, rawToken) {
  const equivalents = expandTagEquivalents(rawToken);
  if (!equivalents.length) return true;
  const tagStr = String(item?.tags || "").toLowerCase();
  const tagTokens = tagStr
    .split(/[,，;；\s#\[\]"'|/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const metaHay = [
    item?.animeType,
    item?.studio,
    item?.director,
    item?.name,
    item?.japaneseName,
    item?.year,
    item?.season
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  return equivalents.some((eq) => {
    if (eq.length <= 2 && /^[a-z]+$/.test(eq)) {
      // Short ASCII alias like 'gl' or 'sf' must match a whole token to avoid false positives in substrings
      return tagTokens.includes(eq);
    }
    return (
      tagTokens.some((t) => t === eq || t.includes(eq)) ||
      tagStr.includes(eq) ||
      metaHay.includes(eq)
    );
  });
}

function extractWatchUrlFromContent(content, fields = null) {
  if (fields && typeof fields === "object") {
    const fmRaw = cleanValue(fields.观看网址 || fields.在线观看 || fields.播放链接 || "");
    if (fmRaw && fmRaw !== "未设置" && fmRaw !== "无") {
      const md = fmRaw.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
      if (md && md[1]) return md[1].trim();
      const bare = fmRaw.match(/(https?:\/\/\S+)/i);
      if (bare && bare[1]) return bare[1].trim();
    }
  }
  const text = String(content || "");
  const lineMatch = text.match(/^\*\*观看网址\*\*\s*[：:]\s*(.+)$/m);
  if (!lineMatch || !lineMatch[1]) return "";
  const raw = lineMatch[1].trim();
  if (!raw || raw === "未设置" || raw === "无") return "";
  const mdLink = raw.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (mdLink && mdLink[1]) return mdLink[1].trim();
  const bareUrl = raw.match(/(https?:\/\/\S+)/i);
  return bareUrl && bareUrl[1] ? bareUrl[1].trim() : "";
}

function classifyWatchUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { kind: "none", url: "", siteLabel: "" };
  }
  if (/^https?:\/\/(?:www\.)?(?:bgm\.tv|bangumi\.tv|chii\.in|netaba\.re)\b/i.test(url)) {
    return { kind: "bangumi_info", url, siteLabel: "Bangumi" };
  }
  if (/bilibili\.com|b23\.tv/i.test(url)) return { kind: "streaming", url, siteLabel: "B站" };
  if (/gamer\.com\.tw/i.test(url)) return { kind: "streaming", url, siteLabel: "动画疯" };
  if (/acfun\.cn/i.test(url)) return { kind: "streaming", url, siteLabel: "AcFun" };
  if (/netflix\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "Netflix" };
  if (/youtube\.com|youtu\.be/i.test(url)) return { kind: "streaming", url, siteLabel: "YouTube" };
  if (/iqiyi\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "爱奇艺" };
  if (/v\.qq\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "腾讯视频" };
  if (/youku\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "优酷" };
  if (/mgtv\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "芒果TV" };
  if (/crunchyroll\.com/i.test(url)) return { kind: "streaming", url, siteLabel: "Crunchyroll" };
  return { kind: "streaming", url, siteLabel: "播放页" };
}

module.exports = {
  cleanValue,
  parseFrontmatter,
  extractWatchedEpisodes,
  extractWatchUrlFromContent,
  classifyWatchUrl,
  expandTagEquivalents,
  matchesTagOrMetaQuery,
  inspectLocalFolder,
  getLocalStatusText,
  updateFrontmatterField,
  updateScoreFields,
  rebuildScoreDisplay,
  synchronizeBangumiScoreFields,
  formatScoreValue,
  updateFolderLine,
  updateNetabaIframeUrl,
  getNetabaPageName,
  updateNetabaSection,
  extractBaseViewNames,
  removeBaseViews,
  hasBaseView,
  appendSeasonView,
  updateWatchedEpisodes,
  updateCalloutTableRow,
  syncNoteCalloutFromFrontmatter,
  addNoteTag,
  removeNoteTag,
  extractEpisodeNumberFromFileName,
  parseVideoEpisodeMeta,
  openLocalPathSafely,
  normalizeTimestampInput,
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  extractLeadingTimestampFromText,
  parseScopeToken,
  normalizeReviewEntry,
  parseNoteReviewsSection,
  formatReviewToMarkdownBlock,
  updateNoteReviewsSection,
  inspectAndUpgradeAnimeNoteContent
};
