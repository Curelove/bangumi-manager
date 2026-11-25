const { requestUrl } = require("obsidian");
const { toMarkdownSafeFileUrl, normalizeUnicodeNfc } = require("./platform-env.js");

var IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif"
];
function escapeYamlValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}
function addYamlField(lines, key, value, options = {}) {
  const allowEmpty = Boolean(options && options.allowEmpty);
  const finalValue =
    value === void 0 || value === null || value === ""
      ? (allowEmpty ? "" : "\u672A\u77E5")
      : value;
  lines.push(
    key + ': "' + escapeYamlValue(finalValue) + '"'
  );
}
function normalizeCoverExtension(rawExtOrMime = "") {
  const s = String(rawExtOrMime || "").trim().toLowerCase();
  if (!s) return "jpg";
  if (s.includes("png")) return "png";
  if (s.includes("webp")) return "webp";
  if (s.includes("gif")) return "gif";
  if (s.includes("avif")) return "avif";
  if (s.includes("jpeg") || s.includes("jpg")) return "jpg";
  const cleaned = s.replace(/^\./, "");
  return IMAGE_EXTENSIONS.includes(cleaned) ? (cleaned === "jpeg" ? "jpg" : cleaned) : "jpg";
}
async function saveCustomCoverFromBuffer(app, coverFolder, titleHint, extOrMime, arrayBuffer) {
  if (!app || !app.vault || !app.vault.adapter || !arrayBuffer || arrayBuffer.byteLength < 64) {
    throw new Error("图片内容无效或文件为空");
  }
  const cleanFolder = String(coverFolder || "附件/动画封面")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  await ensureVaultFolder(app, cleanFolder);
  const ext = normalizeCoverExtension(extOrMime);
  const safeSlug = getSafeFileName(titleHint || "custom")
    .replace(/\s+/g, "-")
    .slice(0, 36);
  const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const localPath = `${cleanFolder}/custom-cover-${safeSlug}-${stamp}.${ext}`;
  await app.vault.adapter.writeBinary(localPath, arrayBuffer);
  return localPath;
}
async function saveCustomCoverFromUrl(app, coverFolder, titleHint, remoteUrl) {
  const cleanUrl = String(remoteUrl || "").trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error("请输入以 http:// 或 https:// 开头的图片网址");
  }
  let timer = null;
  try {
    const reqPromise = requestUrl({
      url: cleanUrl,
      method: "GET",
      headers: {
        "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)"
      },
      throw: true
    });
    reqPromise.catch(() => {});
    const response = await Promise.race([
      reqPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("图片下载超时")), 10000);
      })
    ]);
    if (!response || !response.arrayBuffer || response.arrayBuffer.byteLength < 120) {
      throw new Error("下载到的图片数据为空");
    }
    const contentType =
      (response.headers && (response.headers["content-type"] || response.headers["Content-Type"])) || "";
    const ext = contentType ? normalizeCoverExtension(contentType) : getImageExtension(cleanUrl);
    return await saveCustomCoverFromBuffer(app, coverFolder, titleHint, ext, response.arrayBuffer);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
function getImageExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(
      /\.([a-zA-Z0-9]{2,5})$/
    );
    if (match) {
      const extension = match[1].toLowerCase();
      if (IMAGE_EXTENSIONS.includes(
        extension
      )) {
        return extension === "jpeg" ? "jpg" : extension;
      }
    }
  } catch (error) {
    console.warn(
      "\u65E0\u6CD5\u8BC6\u522B\u5C01\u9762\u6269\u5C55\u540D:",
      error
    );
  }
  return "jpg";
}
async function ensureVaultFolder(app, folderPath) {
  if (!folderPath) {
    return;
  }
  if (app.vault.getAbstractFileByPath(
    folderPath
  )) {
    return;
  }
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    if (!part) {
      continue;
    }
    current = current ? current + "/" + part : part;
    if (app.vault.getAbstractFileByPath(
      current
    )) {
      continue;
    }
    try {
      await app.vault.createFolder(
        current
      );
    } catch (error) {
      if (!app.vault.getAbstractFileByPath(
        current
      )) {
        throw error;
      }
    }
  }
}
async function saveCoverLocally(app, coverFolder, subjectId, remoteUrl, fallbackRemoteUrl = "") {
  if (!coverFolder || !subjectId) {
    return remoteUrl || fallbackRemoteUrl || "";
  }
  const candidates = Array.from(
    new Set(
      [
        remoteUrl,
        fallbackRemoteUrl,
        "https://api.bgm.tv/v0/subjects/" + encodeURIComponent(String(subjectId)) + "/image?type=large",
        "https://api.bgm.tv/v0/subjects/" + encodeURIComponent(String(subjectId)) + "/image?type=common"
      ]
        .map((u) => String(u || "").trim())
        .filter((u) => u.startsWith("http"))
    )
  );
  if (candidates.length === 0) {
    return "";
  }
  await ensureVaultFolder(
    app,
    coverFolder
  );
  const extension = getImageExtension(remoteUrl || fallbackRemoteUrl);
  const localPath = coverFolder + "/bangumi-cover-" + subjectId + "." + extension;
  if (await app.vault.adapter.exists(
    localPath
  )) {
    return localPath;
  }
  let lastError = null;
  for (const candidateUrl of candidates) {
    let timer = null;
    try {
      const reqPromise = requestUrl({
        url: candidateUrl,
        method: "GET",
        headers: {
          "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)"
        },
        throw: true
      });
      reqPromise.catch(() => {});
      const response = await Promise.race([
        reqPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("封面下载超时")), 8500);
        })
      ]);
      if (response && response.arrayBuffer && response.arrayBuffer.byteLength > 200) {
        await app.vault.adapter.writeBinary(
          localPath,
          response.arrayBuffer
        );
        return localPath;
      }
    } catch (err) {
      lastError = err;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
  throw lastError || new Error("无法下载作品封面图片");
}
function getSeasonInfo(dateText) {
  const value = String(dateText || "").trim();
  const match =
    value.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/) ||
    value.match(/(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2}|\b)/);
  if (!match) {
    const yearOnly = value.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearOnly) {
      return {
        year: yearOnly[1],
        season: "未知季度"
      };
    }
  }
  if (!match) {
    return {
      year: "",
      season: "\u672A\u77E5\u5B63\u5EA6"
    };
  }
  const year = match[1];
  const month = Number(match[2]);
  let season;
  if (month === 12 || month === 1 || month === 2) {
    season = "01\u6708\u65B0\u756A";
  } else if (month === 3 || month === 4 || month === 5) {
    season = "04\u6708\u65B0\u756A";
  } else if (month === 6 || month === 7 || month === 8) {
    season = "07\u6708\u65B0\u756A";
  } else {
    season = "10\u6708\u65B0\u756A";
  }
  return {
    year: month === 12 ? String(
      Number(year) + 1
    ) : year,
    season
  };
}
function getSafeFileName(name) {
  let cleaned = normalizeUnicodeNfc(String(name || ""))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\*"\\\/<>:\|?]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned)) {
    cleaned = `_${cleaned}`;
  }
  return cleaned || "\u672A\u77E5\u4F5C\u54C1";
}
function getSubjectIdFromUrl(url) {
  const match = String(url || "").match(
    /\/subject\/(\d+)/i
  );
  return match ? match[1] : "";
}
function getNetabaPageUrl(info, options) {
  const page = String(
    options.netabaDefaultPage || "subject"
  ).trim();

  const subjectId =
    getSubjectIdFromUrl(info.url) ||
    getSubjectIdFromUrl(info.netaba);

  const userId = String(
    options.netabaUserId || ""
  ).trim();

  const compareUrl = String(
    options.netabaCompareUrl || ""
  ).trim();

  const compareSubjectId =
    getSubjectIdFromUrl(compareUrl);

  if (page === "season") {
    return "https://netaba.re/season";
  }

  if (page === "trending") {
    return "https://netaba.re/trending";
  }

  if (page === "history") {
    return "https://netaba.re/history";
  }

  if (page === "user" && /^\d+$/.test(userId)) {
    return "https://netaba.re/user/" + userId;
  }

  if (
    page === "compare" &&
    subjectId &&
    compareSubjectId
  ) {
    return (
      "https://netaba.re/" +
      subjectId +
      "/vs/" +
      compareSubjectId
    );
  }

  return info.netaba || "";
}

function formatScoreForDisplay(value, digits) {
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

function getPreciseScoreInfo(info) {
  const preciseScore = Number(
    info && info.preciseRating
  );

  if (!Number.isFinite(preciseScore)) {
    return null;
  }

  return {
    allScore: String(preciseScore)
  };
}

function buildNoteContent(info, options = {}) {
  const watchedEpisodes =
    options.watchedEpisodes !== undefined && options.watchedEpisodes !== null && String(options.watchedEpisodes).trim() !== ""
      ? String(options.watchedEpisodes).trim()
      : "0";
  const netabaEmbedEnabled =
    options.netabaEmbedEnabled !== false;
  const animeInfoCollapsedByDefault =
    Boolean(options.animeInfoCollapsedByDefault);
  const netabaEmbedUrl =
    getNetabaPageUrl(info, options);
  const watchUrl = String(options.watchUrl || info.watchUrl || "").trim();
  const personalSummary = String(options.personalSummary || "").trim();
  const downloadPath = options.downloadPath || "\u65E0";
  const subjectId = getSubjectIdFromUrl(info.url);
  const hasBgmUrl = /^https?:\/\//i.test(String(info.url || "").trim());
  const isCustom = Boolean(options.isCustom || info.isCustom || !subjectId);
  const cleanCover = String(info.cover || "").trim();
  const hasRealCover = Boolean(cleanCover && cleanCover !== "\u672A\u77E5" && cleanCover !== "\u65E0");
  const cleanRefUrl = String(info.referenceUrl || options.referenceUrl || "").trim();
  const hasRefUrl = /^https?:\/\//i.test(cleanRefUrl);
  const cleanRefScoreRaw =
    info.referenceScore !== undefined && info.referenceScore !== null && String(info.referenceScore).trim() !== ""
      ? String(info.referenceScore).trim()
      : options.referenceScore !== undefined && options.referenceScore !== null && String(options.referenceScore).trim() !== ""
      ? String(options.referenceScore).trim()
      : "";
  const refScoreNum = cleanRefScoreRaw ? Number(cleanRefScoreRaw) : NaN;
  const hasRefScore = Number.isFinite(refScoreNum) && refScoreNum > 0;
  const cleanRefSource = String(info.referenceScoreSource || options.referenceScoreSource || "").trim();
  const cleanPersonalScoreRaw =
    options.personalScore !== undefined && options.personalScore !== null && String(options.personalScore).trim() !== ""
      ? String(options.personalScore).trim()
      : info.personalScore !== undefined && info.personalScore !== null && String(info.personalScore).trim() !== ""
      ? String(info.personalScore).trim()
      : "";
  const personalScoreNum = cleanPersonalScoreRaw ? Number(cleanPersonalScoreRaw) : NaN;
  const personalScoreText =
    Number.isFinite(personalScoreNum) && personalScoreNum >= 0
      ? String(personalScoreNum)
      : "\u672A\u8BC4\u5206";
  const cleanMediaType = String(info.type || info.mediaFormat || "").trim();
  const cleanYear = String(info.year || "").trim();
  const cleanSeason = String(info.season || "").trim();
  const validSeason = cleanSeason && cleanSeason !== "\u672A\u77E5\u5B63\u5EA6" ? cleanSeason : "";
  const emptyOpt = isCustom ? { allowEmpty: true } : {};

  const yaml = [];
  yaml.push("---");
  addYamlField(
    yaml,
    "\u4E2D\u6587\u540D",
    info.CN
  );
  addYamlField(
    yaml,
    "\u65E5\u6587\u540D",
    info.JP,
    emptyOpt
  );
  addYamlField(
    yaml,
    "cover",
    hasRealCover ? cleanCover : "",
    { allowEmpty: true }
  );
  if (isCustom) {
    addYamlField(
      yaml,
      "\u6570\u636E\u6765\u6E90",
      "\u81EA\u5B9A\u4E49"
    );
  }
  if (cleanMediaType) {
    addYamlField(
      yaml,
      "\u8F7D\u4F53\u7C7B\u578B",
      cleanMediaType
    );
  }
  addYamlField(
    yaml,
    "\u6539\u7F16\u7C7B\u578B",
    info.catego,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u603B\u96C6\u6570",
    info.episode,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u89C2\u770B\u72B6\u6001",
    info.state
  );
  addYamlField(
    yaml,
    "\u5236\u4F5C\u516C\u53F8",
    info.AnimeMake,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u76D1\u7763",
    info.director,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u97F3\u4E50",
    info.music,
    emptyOpt
  );
  if (info.date && String(info.date).trim() && String(info.date).trim() !== "\u672A\u77E5") {
    addYamlField(
      yaml,
      "\u5F00\u64AD\u65E5\u671F",
      String(info.date).trim()
    );
  }
  addYamlField(
    yaml,
    "\u5F00\u64AD\u5E74\u4EFD",
    cleanYear,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u5F00\u64AD\u5B63\u5EA6",
    isCustom ? validSeason : info.season,
    emptyOpt
  );
  addYamlField(
    yaml,
    "\u8BB0\u5F55\u65E5\u671F",
    info.recordDate
  );
  if (hasBgmUrl || !isCustom) {
    addYamlField(
      yaml,
      "BGM\u94FE\u63A5",
      hasBgmUrl ? info.url : "",
      { allowEmpty: true }
    );
  }
  if (hasRefUrl) {
    addYamlField(
      yaml,
      "\u53C2\u8003\u94FE\u63A5",
      cleanRefUrl
    );
  }
  const preciseInfo = getPreciseScoreInfo(info);

  const scoreToStore =
    !isCustom || hasBgmUrl
      ? (
          options.useBangumiPreciseScore === true &&
          preciseInfo &&
          preciseInfo.allScore
            ? preciseInfo.allScore
            : info.rating
        )
      : "\u672A\u8BC4\u5206";

  addYamlField(
    yaml,
    "BGM评分",
    scoreToStore === void 0 || scoreToStore === null || scoreToStore === ""
      ? "\u672A\u8BC4\u5206"
      : scoreToStore
  );

  if (hasRefScore) {
    addYamlField(
      yaml,
      "\u53C2\u8003\u8BC4\u5206",
      String(refScoreNum)
    );
    if (cleanRefSource) {
      addYamlField(
        yaml,
        "\u53C2\u8003\u8BC4\u5206\u6765\u6E90",
        cleanRefSource
      );
    }
  }

  const showBangumiUserScore =
    options.showBangumiUserScore !== false && (!isCustom || hasBgmUrl);

  const showPersonalScore =
    options.showPersonalScore !== false;

  if (showBangumiUserScore) {
    addYamlField(
      yaml,
      "你在 BGM 上的评分",
      info.userRating === null ||
        info.userRating === undefined
        ? "\u672A\u8BC4\u5206"
        : info.userRating
    );
  }

  if (showPersonalScore || personalScoreText !== "\u672A\u8BC4\u5206") {
    addYamlField(
      yaml,
      "\u6211\u7684\u8BC4\u5206",
      personalScoreText
    );
  }

  addYamlField(
    yaml,
    "\u4E0B\u8F7D\u8DEF\u5F84",
    downloadPath
  );
  if (info.netaba) {
    addYamlField(
      yaml,
      "Netaba\u94FE\u63A5",
      info.netaba
    );
  }
  const extraTags = Array.isArray(info.tags)
    ? info.tags
        .map((t) => String(t || "").trim())
        .filter((t) => t && t.toLowerCase() !== "bangumi")
    : [];
  if (extraTags.length > 0) {
    const mergedTags = Array.from(new Set(["bangumi", ...extraTags]));
    yaml.push("tags:");
    for (const tagItem of mergedTags) {
      yaml.push("  - " + tagItem);
    }
  } else {
    addYamlField(
      yaml,
      "tags",
      "bangumi"
    );
  }
  yaml.push("---");
  yaml.push("");
  yaml.push(
    "**\u5DF2\u89C2\u770B\u96C6\u6570**\uFF1A " + watchedEpisodes
  );

  if (downloadPath && downloadPath !== "\u65E0") {
    const safeUrl = toMarkdownSafeFileUrl(downloadPath);

    yaml.push(
      "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A [\u6253\u5F00\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939](" +
      safeUrl +
      ")"
    );
  } else {
    yaml.push(
      "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A \u672A\u8BBE\u7F6E"
    );
  }

  yaml.push(
    "**\u89C2\u770B\u7F51\u5740**\uFF1A " + watchUrl
  );
  yaml.push("");

  yaml.push("# \u52A8\u753B\u4FE1\u606F");
  yaml.push("");

  const animeInfoMarker =
    animeInfoCollapsedByDefault ? "-" : "+";

  yaml.push(
    "> [!bookinfo|noicon]" +
    animeInfoMarker +
    " **" +
    (info.CN || "\u672A\u77E5\u4F5C\u54C1") +
    "**"
  );
  if (hasRealCover) {
    yaml.push(
      /^https?:\/\//i.test(cleanCover)
        ? "> ![" + (info.CN || "\u5C01\u9762") + "](" + cleanCover + ")"
        : "> ![[" + cleanCover + "]]"
    );
  }
  yaml.push(">");
  yaml.push(
    "| \u9879\u76EE | \u5185\u5BB9 |"
  );
  yaml.push(
    "|:------|:------------------------------------------|"
  );
  yaml.push(
    "| \u4E2D\u6587\u540D | " +
    (info.CN || "\u672A\u77E5") +
    " |"
  );
  if (!isCustom || (info.JP && String(info.JP).trim())) {
    yaml.push(
      "| \u65E5\u6587\u540D | " +
      (info.JP || "\u672A\u77E5") +
      " |"
    );
  }
  yaml.push(
    "| \u5F00\u64AD\u65E5\u671F | " +
    (info.date || cleanYear || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u6539\u7F16\u7C7B\u578B | " +
    (info.catego || "\u672A\u77E5") +
    " |"
  );
  const epNumVal = Number(info.episode);
  const epText =
    Number.isFinite(epNumVal) && epNumVal > 0
      ? [cleanMediaType, `\u5171 ${epNumVal} \u8BDD`].filter(Boolean).join(" ")
      : cleanMediaType
      ? `${cleanMediaType} \u96C6\u6570\u5F85\u5B9A`
      : "\u5171 0 \u8BDD";
  yaml.push(
    "| \u52A8\u753B\u96C6\u6570 | " +
    epText +
    " |"
  );
  yaml.push(
    "| \u5236\u4F5C\u516C\u53F8 | " +
    (info.AnimeMake || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u5236\u4F5C\u76D1\u7763 | " +
    (info.director || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u97F3\u4E50 | " +
    (info.music || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u89C2\u770B\u72B6\u6001 | " +
    (info.state || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u8BB0\u5F55\u65E5\u671F | " +
    info.recordDate +
    " |"
  );
  if (isCustom) {
    yaml.push("| \u6570\u636E\u6765\u6E90 | \u81EA\u5B9A\u4E49\u6536\u5F55 |");
  }
  if (hasBgmUrl) {
    yaml.push(
      "| BGM \u5730\u5740 | [" +
      (info.CN || "\u94FE\u63A5") +
      "](" +
      info.url +
      ") |"
    );
  }
  if (hasRefUrl) {
    yaml.push(
      "| \u53C2\u8003\u94FE\u63A5 | [\u67E5\u770B\u5916\u90E8\u6761\u76EE](" +
      cleanRefUrl +
      ") |"
    );
  }
  if (!isCustom || hasBgmUrl) {
    const scoreToDisplay =
      options.useBangumiPreciseScore === true &&
      preciseInfo &&
      preciseInfo.allScore
        ? preciseInfo.allScore
        : info.rating;

    const scoreDigits =
      options.useBangumiPreciseScore === true &&
      preciseInfo &&
      preciseInfo.allScore
        ? options.bangumiPreciseScoreDisplayDigits
        : 1;

    yaml.push(
      "| BGM 评分 | " +
      formatScoreForDisplay(
        scoreToDisplay,
        scoreDigits
      ) +
      " |"
    );
  }

  if (hasRefScore) {
    yaml.push(
      "| \u53C2\u8003\u8BC4\u5206 | " +
      (cleanRefSource ? `${cleanRefSource} ${refScoreNum}` : String(refScoreNum)) +
      " |"
    );
  }

  if (showBangumiUserScore) {
    yaml.push(
      "| 你在 BGM 上的评分 | " +
      (
        info.userRating === null ||
        info.userRating === undefined
          ? "\u672A\u8BC4\u5206"
          : info.userRating
      ) +
      " |"
    );
  }

  if (showPersonalScore || personalScoreText !== "\u672A\u8BC4\u5206") {
    yaml.push(
      "| \u6211\u7684\u8BC4\u5206 | " + personalScoreText + " |"
    );
  }

  if (info.netaba) {
    yaml.push(
      "| Netaba \u8BC4\u5206\u8D8B\u52BF | [\u67E5\u770B\u53D8\u5316](" +
      info.netaba +
      ") |"
    );
  }

  if (downloadPath && downloadPath !== "\u65E0") {
    yaml.push(
      "| \u4E0B\u8F7D\u8DEF\u5F84 | `" +
      downloadPath +
      "` |"
    );
  }

  yaml.push("");
  yaml.push("---");
  yaml.push("");
  if (info.netaba && netabaEmbedEnabled) {
    yaml.push("");

    yaml.push("# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE");
    yaml.push("");

    yaml.push(
      '<div class="bangumi-netaba-controls" data-netaba-controls="true"></div>'
    );
    yaml.push("");

    yaml.push(
      '<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">'
    );
    yaml.push(
      '<iframe src="' +
      netabaEmbedUrl +
      '" style="display:block;width:100%;height:600px;border:0;"></iframe>'
    );
    yaml.push("</div>");
    yaml.push("");
  }
  yaml.push("# 观片手记与评价");
  yaml.push("");
  yaml.push(
    personalSummary ||
      "<!-- 观片手札：支持在番剧档案馆「观片手札」面板可视化管理，或直接按 \"> [!quote] [吐槽|短评|长评] [全剧|EP01|EP01-03] [12:34]\" 格式手写编辑 -->"
  );
  yaml.push("");
  return yaml.join("\n");
}
function getNoteFolder(rootFolder, info) {
  const year = String(info?.year || "").trim();
  const season = String(info?.season || "").trim();
  if (/^\d{4}$/.test(year) && season && season !== "\u672A\u77E5\u5B63\u5EA6" && season !== "\u672A\u77E5") {
    return rootFolder + "/" + year + "/" + season;
  }
  return rootFolder;
}
function resolveAnimeNotePath(settings, info) {
  const rootFolder = String(settings?.noteRootFolder || "\u52A8\u753B\u7B14\u8BB0").trim().replace(/[\\/]+$/, "");
  const noteFolder = getNoteFolder(rootFolder, info);
  const fileName = getSafeFileName(info?.fileName || info?.CN || info?.JP);
  return {
    noteFolder,
    fileName,
    filePath: noteFolder + "/" + fileName + ".md"
  };
}
async function createAnimeNote(app, settings, info, options = {}) {
  const { noteFolder, filePath } = resolveAnimeNotePath(settings, info);
  await ensureVaultFolder(
    app,
    noteFolder
  );
  if (app.vault.getAbstractFileByPath(
    filePath
  )) {
    return {
      created: false,
      filePath
    };
  }
  const content = buildNoteContent(
    info,
    options
  );
  const file = await app.vault.create(
    filePath,
    content
  );
  return {
    created: true,
    filePath: file.path,
    file
  };
}
module.exports = {
  ensureVaultFolder,
  saveCoverLocally,
  saveCustomCoverFromBuffer,
  saveCustomCoverFromUrl,
  getSeasonInfo,
  getSafeFileName,
  buildNoteContent,
  getNoteFolder,
  resolveAnimeNotePath,
  createAnimeNote
};
