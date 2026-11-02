const fs = require("fs");
const path = require("path");

var VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v"
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
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
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
function extractEpisodeNumberFromFileName(fileName) {
  if (!fileName) return null;
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  const epPattern = /(?:ep|episode|e|第)\s*(\d{1,4})(?:\s*话|\s*集|\b)/i;
  const match1 = baseName.match(epPattern);
  if (match1 && match1[1]) {
    return parseInt(match1[1], 10);
  }
  const delimPattern = /(?:[\s_\-\[\(])(\d{1,3})(?:[\s_\-\]\)])/;
  const match2 = baseName.match(delimPattern);
  if (match2 && match2[1]) {
    return parseInt(match2[1], 10);
  }
  const tailPattern = /(\d{1,3})$/;
  const match3 = baseName.match(tailPattern);
  if (match3 && match3[1]) {
    return parseInt(match3[1], 10);
  }
  return null;
}

let electronShell = null;
try {
  electronShell = require("electron").shell;
} catch (e) {}

async function openLocalPathSafely(targetPath) {
  if (!targetPath) return false;
  try {
    if (electronShell && typeof electronShell.openPath === "function") {
      const errMsg = await electronShell.openPath(targetPath);
      if (!errMsg) return true;
    }
  } catch (e) {}
  try {
    const normalized = String(targetPath).replace(/\\/g, "/");
    window.open("file:///" + encodeURI(normalized));
    return true;
  } catch (e) {
    return false;
  }
}

function inspectLocalFolder(downloadPath, watchedEpisodes) {
  if (!downloadPath || downloadPath === "\u65E0") {
    return {
      error: "\u65E0\u4E0B\u8F7D\u8DEF\u5F84",
      downloadPath: "",
      fileCount: 0,
      newCount: 0,
      videoFiles: [],
      nextEpisodeFile: null,
      nextEpisodeNumber: null
    };
  }
  if (!fs.existsSync(downloadPath)) {
    return {
      error: "\u6587\u4EF6\u5939\u4E0D\u5B58\u5728",
      downloadPath,
      fileCount: 0,
      newCount: 0,
      videoFiles: [],
      nextEpisodeFile: null,
      nextEpisodeNumber: null
    };
  }
  let entries = [];
  try {
    entries = fs.readdirSync(downloadPath, { withFileTypes: true });
  } catch (err) {
    return {
      error: "\u6587\u4EF6\u5939\u8BFB\u53D6\u5931\u8D25",
      downloadPath,
      fileCount: 0,
      newCount: 0,
      videoFiles: [],
      nextEpisodeFile: null,
      nextEpisodeNumber: null
    };
  }
  const rawVideoEntries = entries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    return VIDEO_EXTENSIONS.includes(
      path.extname(entry.name).toLowerCase()
    );
  });
  const videoFiles = rawVideoEntries.map((entry, index) => {
    const fullPath = path.join(downloadPath, entry.name);
    const parsedEp = extractEpisodeNumberFromFileName(entry.name);
    return {
      name: entry.name,
      path: fullPath,
      episode: parsedEp !== null ? parsedEp : (index + 1)
    };
  });
  videoFiles.sort((a, b) => {
    if (a.episode !== b.episode) {
      return a.episode - b.episode;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  const currentWatched = Number(watchedEpisodes) || 0;
  const targetNextEp = currentWatched + 1;
  let nextEpisodeFile = null;
  let nextEpisodeNumber = null;
  const matched = videoFiles.find(vf => vf.episode === targetNextEp);
  if (matched) {
    nextEpisodeFile = matched.path;
    nextEpisodeNumber = matched.episode;
  } else if (currentWatched < videoFiles.length) {
    const fallback = videoFiles[currentWatched];
    if (fallback) {
      nextEpisodeFile = fallback.path;
      nextEpisodeNumber = fallback.episode;
    }
  }

  return {
    error: null,
    downloadPath,
    fileCount: videoFiles.length,
    newCount: Math.max(
      0,
      videoFiles.length - currentWatched
    ),
    videoFiles,
    nextEpisodeFile,
    nextEpisodeNumber
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
  let folderLine;
  if (result.downloadPath && !result.error) {
    const normalized = result.downloadPath.replace(
      /\\/g,
      "/"
    );
    folderLine = "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A [\u6253\u5F00\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939](file:///" + encodeURI(normalized) + ")";
  } else {
    folderLine = "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A \u672A\u8BBE\u7F6E";
  }
  const existing = /^\*\*本地文件夹\*\*：.*$/m;
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

module.exports = {
  cleanValue,
  parseFrontmatter,
  extractWatchedEpisodes,
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
  openLocalPathSafely,
  normalizeTimestampInput,
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  extractLeadingTimestampFromText,
  parseScopeToken,
  normalizeReviewEntry,
  parseNoteReviewsSection,
  formatReviewToMarkdownBlock,
  updateNoteReviewsSection
};
