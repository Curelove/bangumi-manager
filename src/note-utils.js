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
    "BGM\u7528\u6237\u8BC4\u5206",
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
      "BGM\u7528\u6237\u8BC4\u5206: \"" +
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
      /^\s*BGM\u8BC4\u5206\s*:/.test(line)
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
    "BGM\u7528\u6237\u8BC4\u5206",
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
      "| BGM\u7528\u6237\u8BC4\u5206 | " +
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
      /^# \u4E2A\u4EBA\u603B\u7ED3\s*$/m
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
      : oldFields.BGM评分
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
    BGM用户评分: cleanValue(
      oldFields.BGM用户评分 ||
      oldFields.Bangumi用户评分
    )
  };

  const managedFields = new Set([
    "BGM评分",
    "BGM精确评分",
    "BGM用户评分",
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
    "BGM用户评分"
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

  if (parsed.fields["BGM用户评分"] !== undefined || parsed.fields["Bangumi用户评分"] !== undefined) {
    const sc = cleanValue(parsed.fields["BGM用户评分"] || parsed.fields["Bangumi用户评分"]);
    updated = updateCalloutTableRow(updated, "BGM用户评分", sc || "未评分");
    updated = updateCalloutTableRow(updated, "BGM 用户评分", sc || "未评分");
  }

  if (parsed.fields["BGM评分"] !== undefined || parsed.fields["BGM 评分"] !== undefined) {
    const sc = cleanValue(parsed.fields["BGM评分"] || parsed.fields["BGM 评分"]);
    if (sc) {
      updated = updateCalloutTableRow(updated, "BGM 评分", sc);
      updated = updateCalloutTableRow(updated, "BGM评分", sc);
    }
  }

  const watchedInBody = extractWatchedEpisodes(content);
  let ep = null;
  if (parsed.fields["已观看集数"] !== undefined) {
    const parsedEp = parseInt(parsed.fields["已观看集数"], 10);
    if (!isNaN(parsedEp)) ep = parsedEp;
  } else if (watchedInBody !== null) {
    ep = watchedInBody;
  }

  if (ep !== null && !isNaN(ep) && ep >= 0) {
    updated = updateWatchedEpisodes(updated, ep);
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
  openLocalPathSafely
};
