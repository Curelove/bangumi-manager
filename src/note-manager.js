const { requestUrl } = require("obsidian");

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
function addYamlField(lines, key, value) {
  const finalValue = value === void 0 || value === null || value === "" ? "\u672A\u77E5" : value;
  lines.push(
    key + ': "' + escapeYamlValue(finalValue) + '"'
  );
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
async function saveCoverLocally(app, coverFolder, subjectId, remoteUrl) {
  if (!coverFolder || !subjectId || !remoteUrl) {
    return remoteUrl || "";
  }
  await ensureVaultFolder(
    app,
    coverFolder
  );
  const extension = getImageExtension(remoteUrl);
  const localPath = coverFolder + "/bangumi-cover-" + subjectId + "." + extension;
  if (await app.vault.adapter.exists(
    localPath
  )) {
    return localPath;
  }
  const response = await requestUrl({
    url: remoteUrl,
    method: "GET",
    throw: true
  });
  await app.vault.adapter.writeBinary(
    localPath,
    response.arrayBuffer
  );
  return localPath;
}
function getSeasonInfo(dateText) {
  const value = String(dateText || "");
  const match = value.match(
    /(\d{4})年(\d{1,2})月/
  );
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
  return String(name || "").replace(/[\*"\\\/<>:\|?]/g, " ").trim() || "\u672A\u77E5\u4F5C\u54C1";
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

function buildNoteContent(info, options) {
  const watchedEpisodes = options.watchedEpisodes || "0";
  const netabaEmbedEnabled =
    options.netabaEmbedEnabled !== false;
  const animeInfoCollapsedByDefault =
    Boolean(options.animeInfoCollapsedByDefault);
  const netabaEmbedUrl =
    getNetabaPageUrl(info, options);
  const watchUrl = options.watchUrl || "";
  const personalSummary = options.personalSummary || "";
  const downloadPath = options.downloadPath || "\u65E0";
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
    info.JP
  );
  addYamlField(
    yaml,
    "cover",
    info.cover
  );
  addYamlField(
    yaml,
    "\u6539\u7F16\u7C7B\u578B",
    info.catego
  );
  addYamlField(
    yaml,
    "\u603B\u96C6\u6570",
    info.episode
  );
  addYamlField(
    yaml,
    "\u89C2\u770B\u72B6\u6001",
    info.state
  );
  addYamlField(
    yaml,
    "\u5236\u4F5C\u516C\u53F8",
    info.AnimeMake
  );
  addYamlField(
    yaml,
    "\u76D1\u7763",
    info.director
  );
  addYamlField(
    yaml,
    "\u97F3\u4E50",
    info.music
  );
  addYamlField(
    yaml,
    "\u5F00\u64AD\u5E74\u4EFD",
    info.year
  );
  addYamlField(
    yaml,
    "\u5F00\u64AD\u5B63\u5EA6",
    info.season
  );
  addYamlField(
    yaml,
    "\u8BB0\u5F55\u65E5\u671F",
    info.recordDate
  );
  addYamlField(
    yaml,
    "BGM\u94FE\u63A5",
    info.url
  );
  const preciseInfo = getPreciseScoreInfo(info);

  const scoreToStore =
    options.useBangumiPreciseScore === true &&
    preciseInfo &&
    preciseInfo.allScore
      ? preciseInfo.allScore
      : info.rating;

  addYamlField(
    yaml,
    "BGM评分",
    scoreToStore
  );


  const showBangumiUserScore =
    options.showBangumiUserScore !== false;

  const showPersonalScore =
    options.showPersonalScore !== false;

  if (showBangumiUserScore) {
    addYamlField(
      yaml,
      "BGM\u7528\u6237\u8BC4\u5206",
      info.userRating === null ||
        info.userRating === undefined
        ? "\u672A\u8BC4\u5206"
        : info.userRating
    );
  }

  if (showPersonalScore) {
    addYamlField(
      yaml,
      "\u6211\u7684\u8BC4\u5206",
      "\u672A\u8BC4\u5206"
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
  addYamlField(
    yaml,
    "tags",
    "bangumi"
  );
  yaml.push("---");
  yaml.push("");
  yaml.push(
    "**\u5DF2\u89C2\u770B\u96C6\u6570**\uFF1A " + watchedEpisodes
  );

  if (downloadPath && downloadPath !== "\u65E0") {
    const normalizedDownloadPath = String(
      downloadPath
    ).replace(
      /\\/g,
      "/"
    );

    yaml.push(
      "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A [\u6253\u5F00\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939](file:///" +
      encodeURI(normalizedDownloadPath) +
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
  yaml.push(
    "> ![[" + info.cover + "]]"
  );
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
  yaml.push(
    "| \u65E5\u6587\u540D | " +
    (info.JP || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u5F00\u64AD\u65E5\u671F | " +
    (info.date || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u6539\u7F16\u7C7B\u578B | " +
    (info.catego || "\u672A\u77E5") +
    " |"
  );
  yaml.push(
    "| \u52A8\u753B\u96C6\u6570 | " +
    (info.type || "") +
    " \u5171 " +
    (info.episode || "0") +
    " \u8BDD |"
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
  yaml.push(
    "| BGM \u5730\u5740 | [" +
    (info.CN || "\u94FE\u63A5") +
    "](" +
    info.url +
    ") |"
  );
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

  if (showBangumiUserScore) {
    yaml.push(
      "| BGM\u7528\u6237\u8BC4\u5206 | " +
      (
        info.userRating === null ||
        info.userRating === undefined
          ? "\u672A\u8BC4\u5206"
          : info.userRating
      ) +
      " |"
    );
  }

  if (showPersonalScore) {
    yaml.push(
      "| \u6211\u7684\u8BC4\u5206 | \u672A\u8BC4\u5206 |"
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
  yaml.push("# \u4E2A\u4EBA\u603B\u7ED3");
  yaml.push("");
  yaml.push(
    personalSummary || "<!-- \u5728\u8FD9\u91CC\u5199\u4E0B\u60A8\u5BF9\u8FD9\u90E8\u52A8\u753B\u7684\u611F\u60F3\u548C\u8BC4\u4EF7 -->"
  );
  yaml.push("");
  return yaml.join("\n");
}
function getNoteFolder(rootFolder, info) {
  if (info.year && info.season && info.season !== "\u672A\u77E5\u5B63\u5EA6") {
    return rootFolder + "/" + info.year + "/" + info.season;
  }
  return rootFolder;
}
async function createAnimeNote(app, settings, info, options = {}) {
  const noteFolder = getNoteFolder(
    settings.noteRootFolder,
    info
  );
  await ensureVaultFolder(
    app,
    noteFolder
  );
  const fileName = getSafeFileName(
    info.fileName || info.CN || info.JP
  );
  const filePath = noteFolder + "/" + fileName + ".md";
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
  getSeasonInfo,
  getSafeFileName,
  buildNoteContent,
  getNoteFolder,
  createAnimeNote
};
