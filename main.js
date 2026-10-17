var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/note-utils.js
var require_note_utils = __commonJS({
  "src/note-utils.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
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
    function cleanValue2(value) {
      return String(value || "").replace(/`/g, "").replace(/^["']|["']$/g, "").trim();
    }
    function parseFrontmatter2(content) {
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
          if (itemVal.startsWith('"') && itemVal.endsWith('"') || itemVal.startsWith("'") && itemVal.endsWith("'")) {
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
        if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
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
    function extractWatchedEpisodes2(content) {
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
    var electronShell = null;
    try {
      electronShell = require("electron").shell;
    } catch (e) {
    }
    async function openLocalPathSafely2(targetPath) {
      if (!targetPath) return false;
      try {
        if (electronShell && typeof electronShell.openPath === "function") {
          const errMsg = await electronShell.openPath(targetPath);
          if (!errMsg) return true;
        }
      } catch (e) {
      }
      try {
        const normalized = String(targetPath).replace(/\\/g, "/");
        window.open("file:///" + encodeURI(normalized));
        return true;
      } catch (e) {
        return false;
      }
    }
    function inspectLocalFolder2(downloadPath, watchedEpisodes) {
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
          episode: parsedEp !== null ? parsedEp : index + 1
        };
      });
      videoFiles.sort((a, b) => {
        if (a.episode !== b.episode) {
          return a.episode - b.episode;
        }
        return a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" });
      });
      const currentWatched = Number(watchedEpisodes) || 0;
      const targetNextEp = currentWatched + 1;
      let nextEpisodeFile = null;
      let nextEpisodeNumber = null;
      const matched = videoFiles.find((vf) => vf.episode === targetNextEp);
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
    function getLocalStatusText2(result) {
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
    function updateFrontmatterField2(content, fieldName, fieldValue) {
      const parsed = parseFrontmatter2(content);
      if (!parsed) {
        return content;
      }
      const escapedName = fieldName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      let fieldLine;
      if (fieldName === "tags") {
        let tagList = Array.isArray(fieldValue) ? fieldValue : String(fieldValue || "").split(/[,;\s#\[\]"']+/).filter(Boolean);
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
    function updateScoreFields2(content, bangumiScore, personalScore) {
      const parsed = parseFrontmatter2(
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
      const frontmatterLines = parsed.body.split(/\r?\n/);
      const cleanedFrontmatterLines = frontmatterLines.filter((line) => {
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
      if (bangumiScore !== null && bangumiScore !== void 0) {
        scoreFieldLines.push(
          'BGM\u7528\u6237\u8BC4\u5206: "' + String(bangumiScore).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
        );
      }
      if (personalScore !== null && personalScore !== void 0) {
        scoreFieldLines.push(
          '\u6211\u7684\u8BC4\u5206: "' + String(personalScore).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
        );
      }
      const rebuiltFrontmatterLines = [];
      let insertedFrontmatterScores = false;
      for (const line of cleanedFrontmatterLines) {
        rebuiltFrontmatterLines.push(
          line
        );
        if (!insertedFrontmatterScores && /^\s*BGM\u8BC4\u5206\s*:/.test(line)) {
          rebuiltFrontmatterLines.push(
            ...scoreFieldLines
          );
          insertedFrontmatterScores = true;
        }
      }
      if (!insertedFrontmatterScores && scoreFieldLines.length > 0) {
        rebuiltFrontmatterLines.push(
          ...scoreFieldLines
        );
      }
      const rebuiltFrontmatter = "---\n" + rebuiltFrontmatterLines.join("\n") + "\n---";
      let result = content.replace(
        parsed.full,
        rebuiltFrontmatter
      );
      const tableFieldNames = [
        "BGM\u7528\u6237\u8BC4\u5206",
        "Bangumi\u7528\u6237\u8BC4\u5206",
        "\u6211\u7684\u8BC4\u5206"
      ];
      const contentLines = result.split(/\r?\n/);
      const cleanedContentLines = contentLines.filter((line) => {
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
      if (bangumiScore !== null && bangumiScore !== void 0) {
        tableLines.push(
          "| BGM\u7528\u6237\u8BC4\u5206 | " + String(bangumiScore) + " |"
        );
      }
      if (personalScore !== null && personalScore !== void 0) {
        tableLines.push(
          "| \u6211\u7684\u8BC4\u5206 | " + String(personalScore) + " |"
        );
      }
      const rebuiltContentLines = [];
      let insertedTableScores = false;
      for (const line of cleanedContentLines) {
        rebuiltContentLines.push(
          line
        );
        if (!insertedTableScores && /^\|\s*BGM\s+\u8BC4\u5206\s*\|/.test(line)) {
          rebuiltContentLines.push(
            ...tableLines
          );
          insertedTableScores = true;
        }
      }
      if (!insertedTableScores && tableLines.length > 0) {
        rebuiltContentLines.push(
          ...tableLines
        );
      }
      return rebuiltContentLines.join(
        "\n"
      );
    }
    function updateFolderLine2(content, result) {
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
    function updateNetabaIframeUrl2(content, newUrl) {
      const source = String(content || "");
      const marker = "<!-- Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE -->";
      const markerIndex = source.indexOf(marker);
      let targetStart = markerIndex;
      if (targetStart < 0) {
        const headingMatch = source.match(
          /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
        );
        if (!headingMatch || headingMatch.index === void 0) {
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
      const iframePattern = /(<iframe\s+src=")[^"]+(")/i;
      if (!iframePattern.test(netabaPart)) {
        return source;
      }
      const updatedNetabaPart = netabaPart.replace(
        iframePattern,
        "$1" + newUrl + "$2"
      );
      return before + updatedNetabaPart;
    }
    function getNetabaPageName2(page) {
      const names = {
        subject: "\u5F53\u524D\u52A8\u753B\u9875\u9762",
        season: "\u5F53\u5B63\u52A8\u753B",
        trending: "\u8BC4\u5206\u8D8B\u52BF",
        history: "\u5386\u53F2\u5206\u5E03",
        user: "\u4E2A\u4EBA\u8BC4\u5206",
        compare: "\u52A8\u753B\u5BF9\u6BD4"
      };
      return names[page] || "\u5F53\u524D\u52A8\u753B\u9875\u9762";
    }
    function updateNetabaSection2(content, action) {
      const source = String(content || "");
      const marker = "<!-- Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE -->";
      const hasMarker = source.includes(marker);
      const hasNetabaHeading = /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m.test(source);
      const hasNetabaIframe = /<iframe[^>]+src=["'][^"']*netaba\.re[^"']*["'][^>]*>/i.test(
        source
      );
      if (action === "add") {
        if (hasMarker || hasNetabaHeading || hasNetabaIframe) {
          return source;
        }
        const parsed = parseFrontmatter2(source);
        if (!parsed) {
          return source;
        }
        const bgmUrl = cleanValue2(
          parsed.fields.BGM\u94FE\u63A5
        );
        const subjectMatch = bgmUrl.match(
          /\/subject\/(\d+)/i
        );
        if (!subjectMatch) {
          return source;
        }
        const subjectId = subjectMatch[1];
        const netabaUrl = "https://netaba.re/subject/" + subjectId;
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
          return source.slice(0, summaryIndex).trimEnd() + "\n\n" + section + "\n" + source.slice(summaryIndex);
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
            const endIndex = detailsEnd + "</details>".length;
            return before.trimEnd() + "\n\n" + afterMarker.slice(endIndex).replace(/^\s+/, "");
          }
        }
        const headingMatch2 = afterMarker.match(
          /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
        );
        if (headingMatch2 && headingMatch2.index !== void 0) {
          const headingStart = headingMatch2.index;
          const headingEnd = headingStart + headingMatch2[0].length;
          const afterHeading = afterMarker.slice(
            headingEnd
          );
          const nextHeadingMatch = afterHeading.match(
            /^#\s+/m
          );
          let sectionEnd = afterMarker.length;
          if (nextHeadingMatch && nextHeadingMatch.index !== void 0) {
            sectionEnd = headingEnd + nextHeadingMatch.index;
          }
          return before.trimEnd() + "\n\n" + afterMarker.slice(sectionEnd).replace(/^\s+/, "");
        }
      }
      const headingMatch = source.match(
        /^# Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE\s*$/m
      );
      if (headingMatch && headingMatch.index !== void 0) {
        const headingStart = headingMatch.index;
        const headingEnd = headingStart + headingMatch[0].length;
        const afterHeading = source.slice(
          headingEnd
        );
        const nextHeadingMatch = afterHeading.match(
          /^#\s+/m
        );
        let sectionEnd = source.length;
        if (nextHeadingMatch && nextHeadingMatch.index !== void 0) {
          sectionEnd = headingEnd + nextHeadingMatch.index;
        }
        return source.slice(0, headingStart).trimEnd() + "\n\n" + source.slice(sectionEnd).replace(/^\s+/, "");
      }
      return source;
    }
    function extractBaseViewNames2(content) {
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
    function removeBaseViews2(content, shouldRemove) {
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
    function hasBaseView2(content, viewName) {
      return extractBaseViewNames2(content).includes(viewName);
    }
    function appendSeasonView2(content, seasonName) {
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
        return "\u672A\u8BC4\u5206";
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
      return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
    function getScoreFieldLine(name, value) {
      return name + ': "' + escapeFrontmatterValue(value) + '"';
    }
    function rebuildScoreFrontmatter(content, options = {}, overrides = {}) {
      const parsed = parseFrontmatter2(content);
      if (!parsed) {
        return content;
      }
      const oldFields = parsed.fields;
      const currentBangumiScore = cleanValue2(
        overrides.bangumiScore !== void 0 ? overrides.bangumiScore : oldFields.BGM\u8BC4\u5206
      );
      const legacyPreciseScore = cleanValue2(
        oldFields.BGM\u7CBE\u786E\u8BC4\u5206
      );
      const shouldUsePreciseScore = options.useBangumiPreciseScore === true;
      const bangumiScore = shouldUsePreciseScore && legacyPreciseScore && overrides.bangumiScore === void 0 ? legacyPreciseScore : currentBangumiScore;
      const bangumiScoreForDisplay = bangumiScore ? formatScoreValue(
        bangumiScore,
        shouldUsePreciseScore ? options.bangumiPreciseScoreDisplayDigits : 1
      ) : "";
      const scoreValues = {
        BGM\u8BC4\u5206: bangumiScoreForDisplay,
        BGM\u7528\u6237\u8BC4\u5206: cleanValue2(
          oldFields.BGM\u7528\u6237\u8BC4\u5206 || oldFields.Bangumi\u7528\u6237\u8BC4\u5206
        )
      };
      const managedFields = /* @__PURE__ */ new Set([
        "BGM\u8BC4\u5206",
        "BGM\u7CBE\u786E\u8BC4\u5206",
        "BGM\u7528\u6237\u8BC4\u5206",
        "Bangumi\u7528\u6237\u8BC4\u5206"
      ]);
      const retainedLines = parsed.body.split(/\r?\n/).filter((line) => {
        const match = line.match(
          /^\s*([^:]+?)\s*:/
        );
        return !match || !managedFields.has(match[1].trim());
      });
      const scoreLines = [
        "BGM\u8BC4\u5206",
        "BGM\u7528\u6237\u8BC4\u5206"
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
        if (!inserted && /^\s*BGM链接\s*:/.test(line)) {
          rebuiltLines.push(...scoreLines);
          inserted = true;
        }
      }
      if (!inserted && scoreLines.length) {
        rebuiltLines.push(...scoreLines);
      }
      return content.replace(
        parsed.full,
        "---\n" + rebuiltLines.join("\n") + "\n---"
      );
    }
    function rebuildScoreDisplay(content, options = {}) {
      const parsed = parseFrontmatter2(content);
      if (!parsed) {
        return content;
      }
      const bangumiScore = cleanValue2(
        parsed.fields.BGM\u8BC4\u5206
      );
      const tableFieldNames = [
        "BGM\u8BC4\u5206",
        "BGM \u8BC4\u5206",
        "BGM\u7CBE\u786E\u8BC4\u5206"
      ];
      const cleanedLines = String(content || "").split(/\r?\n/).filter((line) => {
        const match = line.match(
          /^\|\s*([^|]+?)\s*\|/
        );
        return !match || !tableFieldNames.includes(
          match[1].trim()
        );
      });
      const tableRows = [];
      if (bangumiScore) {
        tableRows.push(
          "| BGM \u8BC4\u5206 | " + formatScoreValue(
            bangumiScore,
            options.useBangumiPreciseScore === true ? options.bangumiPreciseScoreDisplayDigits : 1
          ) + " |"
        );
      }
      const rebuiltLines = [];
      let inserted = false;
      for (const line of cleanedLines) {
        rebuiltLines.push(line);
        if (!inserted && /^\|\s*BGM\s+地址\s*\|/.test(line)) {
          rebuiltLines.push(...tableRows);
          inserted = true;
        }
      }
      if (!inserted && tableRows.length) {
        rebuiltLines.push(...tableRows);
      }
      return rebuiltLines.join("\n");
    }
    function synchronizeBangumiScoreFields2(content, options = {}, overrides = {}) {
      return rebuildScoreDisplay(
        rebuildScoreFrontmatter(
          content,
          options,
          overrides
        ),
        options
      );
    }
    function updateWatchedEpisodes2(content, count) {
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
      const parsed = parseFrontmatter2(content);
      if (parsed) {
        return content.replace(parsed.full, parsed.full + `

**\u5DF2\u89C2\u770B\u96C6\u6570**\uFF1A ${count}`);
      }
      return `**\u5DF2\u89C2\u770B\u96C6\u6570**\uFF1A ${count}

` + content;
    }
    function updateCalloutTableRow2(content, fieldName, newValue) {
      const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`^((?:>\\s*)?\\|\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*\\|)[^|\\r\\n]*(\\|)`, "m");
      if (regex.test(content)) {
        return content.replace(regex, `$1 ${newValue} $2`);
      }
      return content;
    }
    function syncNoteCalloutFromFrontmatter2(content) {
      const parsed = parseFrontmatter2(content);
      if (!parsed || !parsed.fields) return content;
      let updated = content;
      if (parsed.fields["\u89C2\u770B\u72B6\u6001"]) {
        const st = cleanValue2(parsed.fields["\u89C2\u770B\u72B6\u6001"]);
        if (st) {
          updated = updateCalloutTableRow2(updated, "\u89C2\u770B\u72B6\u6001", st);
        }
      }
      if (parsed.fields["\u6211\u7684\u8BC4\u5206"] !== void 0) {
        const sc = cleanValue2(parsed.fields["\u6211\u7684\u8BC4\u5206"]);
        updated = updateCalloutTableRow2(updated, "\u6211\u7684\u8BC4\u5206", sc || "\u672A\u8BC4\u5206");
      }
      if (parsed.fields["BGM\u7528\u6237\u8BC4\u5206"] !== void 0 || parsed.fields["Bangumi\u7528\u6237\u8BC4\u5206"] !== void 0) {
        const sc = cleanValue2(parsed.fields["BGM\u7528\u6237\u8BC4\u5206"] || parsed.fields["Bangumi\u7528\u6237\u8BC4\u5206"]);
        updated = updateCalloutTableRow2(updated, "BGM\u7528\u6237\u8BC4\u5206", sc || "\u672A\u8BC4\u5206");
        updated = updateCalloutTableRow2(updated, "BGM \u7528\u6237\u8BC4\u5206", sc || "\u672A\u8BC4\u5206");
      }
      if (parsed.fields["BGM\u8BC4\u5206"] !== void 0 || parsed.fields["BGM \u8BC4\u5206"] !== void 0) {
        const sc = cleanValue2(parsed.fields["BGM\u8BC4\u5206"] || parsed.fields["BGM \u8BC4\u5206"]);
        if (sc) {
          updated = updateCalloutTableRow2(updated, "BGM \u8BC4\u5206", sc);
          updated = updateCalloutTableRow2(updated, "BGM\u8BC4\u5206", sc);
        }
      }
      const watchedInBody = extractWatchedEpisodes2(content);
      let ep = null;
      if (parsed.fields["\u5DF2\u89C2\u770B\u96C6\u6570"] !== void 0) {
        const parsedEp = parseInt(parsed.fields["\u5DF2\u89C2\u770B\u96C6\u6570"], 10);
        if (!isNaN(parsedEp)) ep = parsedEp;
      } else if (watchedInBody !== null) {
        ep = watchedInBody;
      }
      if (ep !== null && !isNaN(ep) && ep >= 0) {
        updated = updateWatchedEpisodes2(updated, ep);
        updated = updateCalloutTableRow2(updated, "\u5DF2\u89C2\u770B\u96C6\u6570", String(ep));
      }
      return updated;
    }
    function addNoteTag2(content, tag) {
      const cleanTag = String(tag || "").trim().replace(/^#/, "");
      if (!cleanTag) return content;
      const parsed = parseFrontmatter2(content);
      if (!parsed) return content;
      let existing = cleanValue2(parsed.fields.tags || "");
      const tokens = existing.split(/[,;\s#\[\]"']+/).filter(Boolean);
      if (tokens.includes(cleanTag)) {
        return content;
      }
      tokens.push(cleanTag);
      const newTags = tokens.join(", ");
      return updateFrontmatterField2(content, "tags", newTags);
    }
    function removeNoteTag2(content, tag) {
      const cleanTag = String(tag || "").trim().replace(/^#/, "");
      if (!cleanTag || cleanTag.toLowerCase() === "bangumi") return content;
      const parsed = parseFrontmatter2(content);
      if (!parsed) return content;
      let existing = cleanValue2(parsed.fields.tags || "");
      const tokens = existing.split(/[,;\s#\[\]"']+/).filter(Boolean);
      const remaining = tokens.filter((t) => t !== cleanTag);
      if (remaining.length === tokens.length) {
        return content;
      }
      const newTags = remaining.join(", ");
      return updateFrontmatterField2(content, "tags", newTags);
    }
    module2.exports = {
      cleanValue: cleanValue2,
      parseFrontmatter: parseFrontmatter2,
      extractWatchedEpisodes: extractWatchedEpisodes2,
      inspectLocalFolder: inspectLocalFolder2,
      getLocalStatusText: getLocalStatusText2,
      updateFrontmatterField: updateFrontmatterField2,
      updateScoreFields: updateScoreFields2,
      rebuildScoreDisplay,
      synchronizeBangumiScoreFields: synchronizeBangumiScoreFields2,
      formatScoreValue,
      updateFolderLine: updateFolderLine2,
      updateNetabaIframeUrl: updateNetabaIframeUrl2,
      getNetabaPageName: getNetabaPageName2,
      updateNetabaSection: updateNetabaSection2,
      extractBaseViewNames: extractBaseViewNames2,
      removeBaseViews: removeBaseViews2,
      hasBaseView: hasBaseView2,
      appendSeasonView: appendSeasonView2,
      updateWatchedEpisodes: updateWatchedEpisodes2,
      updateCalloutTableRow: updateCalloutTableRow2,
      syncNoteCalloutFromFrontmatter: syncNoteCalloutFromFrontmatter2,
      addNoteTag: addNoteTag2,
      removeNoteTag: removeNoteTag2,
      extractEpisodeNumberFromFileName,
      openLocalPathSafely: openLocalPathSafely2
    };
  }
});

// src/netaba-trend-service.js
var require_netaba_trend_service = __commonJS({
  "src/netaba-trend-service.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var memoryCache = /* @__PURE__ */ new Map();
    var MEMORY_CACHE_TTL = 6 * 60 * 60 * 1e3;
    function ensureDirSync(dirPath) {
      try {
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      } catch (e) {
      }
    }
    function getDiskCachePath(app, subjectId) {
      try {
        if (!app || !app.vault || !app.vault.adapter) return null;
        let basePath = "";
        if (typeof app.vault.adapter.getBasePath === "function") {
          basePath = app.vault.adapter.getBasePath();
        }
        if (!basePath) return null;
        const cacheDir = path.join(basePath, ".obsidian", "plugins", "bangumi-manager", ".cache", "netaba");
        ensureDirSync(cacheDir);
        return path.join(cacheDir, `${subjectId}.json`);
      } catch (e) {
        return null;
      }
    }
    function readDiskCache(app, subjectId) {
      const filePath = getDiskCachePath(app, subjectId);
      if (!filePath || !fs.existsSync(filePath)) return null;
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const json = JSON.parse(raw);
        return json;
      } catch (e) {
        return null;
      }
    }
    function writeDiskCache(app, subjectId, data) {
      const filePath = getDiskCachePath(app, subjectId);
      if (!filePath) return;
      try {
        fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
      } catch (e) {
      }
    }
    async function requestNetabaApi(url) {
      try {
        if (typeof window !== "undefined" && typeof window.requestUrl === "function") {
          const resp = await window.requestUrl({
            url,
            method: "GET",
            headers: {
              "User-Agent": "ObsidianBangumiManager/0.3.x (https://github.com)"
            }
          });
          if (resp.status === 200) {
            return typeof resp.json === "object" ? resp.json : JSON.parse(resp.text);
          }
        }
      } catch (e) {
        console.warn("Obsidian requestUrl \u8BF7\u6C42 Netaba \u5931\u8D25\uFF0C\u5C1D\u8BD5 https \u56DE\u9000:", e);
      }
      return new Promise((resolve, reject) => {
        const https = require("https");
        https.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ObsidianBangumiManager"
          }
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => {
            try {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error(`Netaba HTTP ${res.statusCode}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        }).on("error", reject);
      });
    }
    async function fetchSubjectTrendData(app, subjectId, forceRefresh = false) {
      if (!subjectId) return null;
      const sid = String(subjectId);
      if (!forceRefresh && memoryCache.has(sid)) {
        const cached = memoryCache.get(sid);
        if (Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
          return cached.data;
        }
      }
      if (!forceRefresh) {
        const diskData = readDiskCache(app, sid);
        if (diskData && diskData.subject && diskData.history) {
          memoryCache.set(sid, { timestamp: Date.now(), data: diskData });
          return diskData;
        }
      }
      const url = `https://api.netaba.re/subject/${sid}`;
      try {
        const rawData = await requestNetabaApi(url);
        if (rawData && rawData.subject) {
          memoryCache.set(sid, { timestamp: Date.now(), data: rawData });
          writeDiskCache(app, sid, rawData);
          return rawData;
        }
      } catch (error) {
        console.error(`\u83B7\u53D6 Netaba \u52A8\u753B (id=${sid}) \u8D8B\u52BF\u5931\u8D25:`, error);
        const fallbackDisk = readDiskCache(app, sid);
        if (fallbackDisk) return fallbackDisk;
        throw error;
      }
      return null;
    }
    function formatDate(isoStr) {
      if (!isoStr) return "";
      try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      } catch (e) {
        return String(isoStr).slice(0, 10);
      }
    }
    function normalizeTrendData(rawData, personalScore = null) {
      if (!rawData || !rawData.subject || !Array.isArray(rawData.history)) {
        return null;
      }
      const { subject, history } = rawData;
      const name = subject.name_cn || subject.name || "\u672A\u77E5\u52A8\u753B";
      const japaneseName = subject.name || "";
      const currentScore = typeof subject.score === "number" ? subject.score : null;
      const currentRank = typeof subject.rank === "number" ? subject.rank : null;
      const airDate = subject.air_date ? new Date(subject.air_date) : null;
      const airTimestamp = airDate && !isNaN(airDate.getTime()) ? airDate.getTime() : null;
      const epsList = Array.isArray(subject.eps) ? subject.eps : [];
      const normalizedEps = epsList.filter((ep) => ep.airdate && ep.airdate !== "0000-00-00").map((ep) => {
        const epDate = new Date(ep.airdate);
        const ts = !isNaN(epDate.getTime()) ? epDate.getTime() : null;
        return {
          id: ep.id,
          sort: ep.sort,
          name: ep.name_cn || ep.name || `\u7B2C ${ep.sort} \u8BDD`,
          airdate: ep.airdate,
          formattedDate: formatDate(ep.airdate),
          timestamp: ts
        };
      }).sort((a, b) => a.sort - b.sort);
      let lastEpTimestamp = null;
      if (normalizedEps.length > 0) {
        const lastValid = normalizedEps[normalizedEps.length - 1];
        if (lastValid && lastValid.timestamp) {
          lastEpTimestamp = lastValid.timestamp;
        }
      }
      const validPoints = [];
      for (const item of history) {
        if (!item.recordedAt) continue;
        const itemDate = new Date(item.recordedAt);
        const ts = itemDate.getTime();
        if (isNaN(ts)) continue;
        const scoreVal = typeof item.score === "number" && item.score > 0 ? Number(item.score.toFixed(3)) : null;
        const totalVotes = item.rating && typeof item.rating.total === "number" ? item.rating.total : 0;
        const rankVal = typeof item.rank === "number" ? item.rank : null;
        validPoints.push({
          recordedAt: item.recordedAt,
          formattedDate: formatDate(item.recordedAt),
          timestamp: ts,
          score: scoreVal,
          rank: rankVal,
          totalVotes,
          collect: item.collect || null
        });
      }
      validPoints.sort((a, b) => a.timestamp - b.timestamp);
      const scoredPoints = validPoints.filter((p) => p.score !== null);
      let windowStartTs = airTimestamp ? airTimestamp - 7 * 864e5 : scoredPoints.length ? scoredPoints[0].timestamp : 0;
      let windowEndTs = lastEpTimestamp ? lastEpTimestamp + 35 * 864e5 : airTimestamp ? airTimestamp + 100 * 864e5 : Infinity;
      let airingPoints = scoredPoints.filter((p) => p.timestamp >= windowStartTs && p.timestamp <= windowEndTs);
      if (airingPoints.length < 5) {
        airingPoints = scoredPoints;
      }
      const calculateMinMax = (pts) => {
        if (!pts.length) return { min: 5, max: 8 };
        let min = Infinity;
        let max = -Infinity;
        for (const p of pts) {
          if (p.score < min) min = p.score;
          if (p.score > max) max = p.score;
        }
        if (personalScore !== null && !isNaN(personalScore)) {
          if (personalScore < min) min = personalScore;
          if (personalScore > max) max = personalScore;
        }
        min = Math.max(1, Math.floor((min - 0.25) * 2) / 2);
        max = Math.min(10, Math.ceil((max + 0.25) * 2) / 2);
        if (max - min < 1) {
          min = Math.max(1, min - 0.5);
          max = Math.min(10, max + 0.5);
        }
        return { min, max };
      };
      const allMinMax = calculateMinMax(scoredPoints);
      const airingMinMax = calculateMinMax(airingPoints);
      const attachEpInfo = (pts) => {
        return pts.map((p) => {
          let currentEp = null;
          for (let i = normalizedEps.length - 1; i >= 0; i--) {
            if (normalizedEps[i].timestamp && p.timestamp >= normalizedEps[i].timestamp) {
              currentEp = normalizedEps[i];
              break;
            }
          }
          return {
            ...p,
            ep: currentEp
          };
        });
      };
      const richAllPoints = attachEpInfo(scoredPoints);
      const richAiringPoints = attachEpInfo(airingPoints);
      const generate3DPoints = (pts, minMax) => {
        if (!pts.length) return [];
        const t0 = pts[0].timestamp;
        const t1 = pts[pts.length - 1].timestamp;
        const tRange = t1 - t0 || 1;
        const sRange = minMax.max - minMax.min || 1;
        return pts.map((p) => {
          const nx = (p.timestamp - t0) / tRange;
          const ny = (p.score - minMax.min) / sRange;
          const nz = 0;
          return [nx, ny, nz];
        });
      };
      return {
        subjectId: subject.id || null,
        name,
        japaneseName,
        currentScore,
        currentRank,
        airDate: airDate ? formatDate(airDate.toISOString()) : "",
        airTimestamp,
        eps: normalizedEps,
        personalScore: typeof personalScore === "number" ? personalScore : null,
        // 两个周期的点集
        allPoints: richAllPoints,
        airingPoints: richAiringPoints,
        allMinMax,
        airingMinMax,
        // 3D 接口预留
        points3DAll: generate3DPoints(richAllPoints, allMinMax),
        points3DAiring: generate3DPoints(richAiringPoints, airingMinMax)
      };
    }
    function renderNativeTrendSvg(container, normData, options = {}) {
      container.empty();
      if (!normData || !normData.allPoints || normData.allPoints.length === 0) {
        container.createDiv({
          cls: "bangumi-trend-empty",
          text: "\u6682\u65E0\u8BE5\u52A8\u753B\u7684\u5386\u53F2\u8BC4\u5206\u6570\u636E\uFF08\u53EF\u80FD\u5C1A\u672A\u5F00\u64AD\u6216\u6682\u65E0\u8DB3\u591F\u6253\u5206\u6837\u672C\uFF09\u3002"
        });
        return;
      }
      let currentMode = normData.airingPoints.length >= 8 && !options.defaultFull ? "airing" : "all";
      const wrapper = container.createDiv("bangumi-trend-component");
      const header = wrapper.createDiv("bangumi-trend-header");
      const headerLeft = header.createDiv("bangumi-trend-header-left");
      if (normData.currentScore !== null) {
        const curBadge = headerLeft.createSpan({
          cls: "bangumi-trend-score-badge",
          text: `BGM \u5B9E\u65F6 ${normData.currentScore.toFixed(2)}`
        });
        if (normData.currentRank) {
          curBadge.title = `Bangumi \u6392\u540D\u7B2C ${normData.currentRank} \u540D`;
        }
      }
      if (normData.personalScore !== null) {
        headerLeft.createSpan({
          cls: "bangumi-trend-personal-badge",
          text: `\u6211\u7684\u8BC4\u5206 \u2605 ${normData.personalScore.toFixed(1)}`
        });
      }
      const toggleGroup = header.createDiv("bangumi-trend-toggle-group");
      const btnAiring = toggleGroup.createEl("button", {
        cls: `bangumi-trend-btn ${currentMode === "airing" ? "is-active" : ""}`,
        text: "\u64AD\u51FA\u671F\u95F4"
      });
      const btnAll = toggleGroup.createEl("button", {
        cls: `bangumi-trend-btn ${currentMode === "all" ? "is-active" : ""}`,
        text: "\u5168\u5468\u671F"
      });
      const chartBox = wrapper.createDiv("bangumi-trend-chart-box");
      chartBox.style.position = "relative";
      chartBox.style.width = "100%";
      chartBox.style.userSelect = "none";
      const tooltip = chartBox.createDiv("bangumi-trend-tooltip");
      tooltip.style.display = "none";
      tooltip.style.position = "absolute";
      tooltip.style.pointerEvents = "none";
      tooltip.style.zIndex = "10";
      function redrawChart() {
        chartBox.querySelectorAll("svg").forEach((el) => el.remove());
        tooltip.style.display = "none";
        const points = currentMode === "airing" ? normData.airingPoints : normData.allPoints;
        const minMax = currentMode === "airing" ? normData.airingMinMax : normData.allMinMax;
        if (!points || points.length === 0) {
          chartBox.createDiv({ cls: "bangumi-trend-empty", text: "\u8BE5\u533A\u95F4\u5185\u6682\u65E0\u8BC4\u5206\u6570\u636E" });
          return;
        }
        const width = 680;
        const height = 260;
        const padding = { top: 25, right: 35, bottom: 35, left: 45 };
        const innerW = width - padding.left - padding.right;
        const innerH = height - padding.top - padding.bottom;
        const tMin = points[0].timestamp;
        const tMax = points[points.length - 1].timestamp;
        const tSpan = Math.max(1, tMax - tMin);
        const sMin = minMax.min;
        const sMax = minMax.max;
        const sSpan = Math.max(0.1, sMax - sMin);
        const getX = (ts) => padding.left + (ts - tMin) / tSpan * innerW;
        const getY = (val) => padding.top + innerH - (val - sMin) / sSpan * innerH;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("class", "bangumi-trend-svg");
        svg.style.width = "100%";
        svg.style.height = "auto";
        svg.style.display = "block";
        svg.style.overflow = "visible";
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const gradientId = "trend-grad-" + Math.random().toString(36).slice(2, 9);
        defs.innerHTML = `
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--interactive-accent, #3b82f6)" stop-opacity="0.32" />
        <stop offset="100%" stop-color="var(--interactive-accent, #3b82f6)" stop-opacity="0.0" />
      </linearGradient>
    `;
        svg.appendChild(defs);
        const yGridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        yGridGroup.setAttribute("class", "trend-grid-lines");
        const step = sMax - sMin > 4 ? 1 : 0.5;
        for (let s = Math.ceil(sMin); s <= Math.floor(sMax); s += step) {
          const yPos = getY(s);
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", padding.left);
          line.setAttribute("y1", yPos);
          line.setAttribute("x2", width - padding.right);
          line.setAttribute("y2", yPos);
          line.setAttribute("stroke", "var(--background-modifier-border, rgba(128,128,128,0.2))");
          line.setAttribute("stroke-dasharray", "3,3");
          yGridGroup.appendChild(line);
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", padding.left - 8);
          text.setAttribute("y", yPos + 4);
          text.setAttribute("text-anchor", "end");
          text.setAttribute("font-size", "11");
          text.setAttribute("fill", "var(--text-muted, #888)");
          text.textContent = s.toFixed(1);
          yGridGroup.appendChild(text);
        }
        svg.appendChild(yGridGroup);
        if (normData.personalScore !== null && normData.personalScore >= sMin && normData.personalScore <= sMax) {
          const py = getY(normData.personalScore);
          const pLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          pLine.setAttribute("x1", padding.left);
          pLine.setAttribute("y1", py);
          pLine.setAttribute("x2", width - padding.right);
          pLine.setAttribute("y2", py);
          pLine.setAttribute("stroke", "var(--text-accent, #e5a00d)");
          pLine.setAttribute("stroke-width", "1.5");
          pLine.setAttribute("stroke-dasharray", "5,4");
          svg.appendChild(pLine);
          const pLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
          pLabel.setAttribute("x", width - padding.right + 4);
          pLabel.setAttribute("y", py + 3);
          pLabel.setAttribute("font-size", "10");
          pLabel.setAttribute("font-weight", "600");
          pLabel.setAttribute("fill", "var(--text-accent, #e5a00d)");
          pLabel.textContent = `\u6211\u7684: ${normData.personalScore.toFixed(1)}`;
          svg.appendChild(pLabel);
        }
        const xGridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const numLabels = 5;
        for (let i = 0; i < numLabels; i++) {
          const ratio = i / (numLabels - 1);
          const ptIndex = Math.min(points.length - 1, Math.round(ratio * (points.length - 1)));
          const p = points[ptIndex];
          const xPos = getX(p.timestamp);
          const tText = document.createElementNS("http://www.w3.org/2000/svg", "text");
          tText.setAttribute("x", xPos);
          tText.setAttribute("y", height - 12);
          tText.setAttribute("text-anchor", "middle");
          tText.setAttribute("font-size", "10");
          tText.setAttribute("fill", "var(--text-muted, #888)");
          tText.textContent = p.formattedDate.slice(5);
          xGridGroup.appendChild(tText);
        }
        svg.appendChild(xGridGroup);
        const coords = points.map((p) => ({ x: getX(p.timestamp), y: getY(p.score) }));
        let pathD = "";
        if (coords.length > 0) {
          pathD = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
          for (let i = 0; i < coords.length - 1; i++) {
            const p0 = coords[i === 0 ? 0 : i - 1];
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            pathD += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
          }
        }
        if (pathD) {
          const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;
          const areaPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          areaPath.setAttribute("d", areaD);
          areaPath.setAttribute("fill", `url(#${gradientId})`);
          svg.appendChild(areaPath);
          const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
          linePath.setAttribute("d", pathD);
          linePath.setAttribute("fill", "none");
          linePath.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
          linePath.setAttribute("stroke-width", "2.4");
          linePath.setAttribute("stroke-linecap", "round");
          linePath.setAttribute("stroke-linejoin", "round");
          svg.appendChild(linePath);
        }
        const epMarkerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        epMarkerGroup.setAttribute("class", "trend-ep-markers");
        for (const ep of normData.eps) {
          if (!ep.timestamp || ep.timestamp < tMin || ep.timestamp > tMax) continue;
          const ex = getX(ep.timestamp);
          const epLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          epLine.setAttribute("x1", ex);
          epLine.setAttribute("y1", padding.top + innerH - 6);
          epLine.setAttribute("x2", ex);
          epLine.setAttribute("y2", padding.top + innerH);
          epLine.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
          epLine.setAttribute("stroke-width", "1.5");
          epMarkerGroup.appendChild(epLine);
          if (ep.sort === 1 || ep.sort === normData.eps.length || ep.sort % 3 === 0) {
            const epText = document.createElementNS("http://www.w3.org/2000/svg", "text");
            epText.setAttribute("x", ex);
            epText.setAttribute("y", padding.top + innerH + 12);
            epText.setAttribute("text-anchor", "middle");
            epText.setAttribute("font-size", "9");
            epText.setAttribute("font-weight", "600");
            epText.setAttribute("fill", "var(--interactive-accent, #3b82f6)");
            epText.textContent = `E${ep.sort}`;
            epMarkerGroup.appendChild(epText);
          }
        }
        svg.appendChild(epMarkerGroup);
        const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
        crosshair.setAttribute("y1", padding.top);
        crosshair.setAttribute("y2", padding.top + innerH);
        crosshair.setAttribute("stroke", "var(--text-accent, #3b82f6)");
        crosshair.setAttribute("stroke-width", "1.2");
        crosshair.setAttribute("stroke-dasharray", "4,3");
        crosshair.style.display = "none";
        svg.appendChild(crosshair);
        const activeDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        activeDot.setAttribute("r", "4.5");
        activeDot.setAttribute("fill", "var(--background-primary, #fff)");
        activeDot.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
        activeDot.setAttribute("stroke-width", "2.5");
        activeDot.style.display = "none";
        svg.appendChild(activeDot);
        const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        overlay.setAttribute("x", padding.left);
        overlay.setAttribute("y", padding.top);
        overlay.setAttribute("width", innerW);
        overlay.setAttribute("height", innerH);
        overlay.setAttribute("fill", "transparent");
        overlay.style.cursor = "crosshair";
        overlay.onpointermove = (e) => {
          const rect = svg.getBoundingClientRect();
          const clientX = e.clientX - rect.left;
          const svgX = clientX / rect.width * width;
          if (svgX < padding.left || svgX > width - padding.right) {
            crosshair.style.display = "none";
            activeDot.style.display = "none";
            tooltip.style.display = "none";
            return;
          }
          let closestPt = points[0];
          let minDiff = Infinity;
          for (const p of points) {
            const px = getX(p.timestamp);
            const diff = Math.abs(px - svgX);
            if (diff < minDiff) {
              minDiff = diff;
              closestPt = p;
            }
          }
          const cx = getX(closestPt.timestamp);
          const cy = getY(closestPt.score);
          crosshair.setAttribute("x1", cx);
          crosshair.setAttribute("x2", cx);
          crosshair.style.display = "block";
          activeDot.setAttribute("cx", cx);
          activeDot.setAttribute("cy", cy);
          activeDot.style.display = "block";
          tooltip.empty();
          tooltip.style.display = "block";
          const tDate = tooltip.createDiv("trend-tip-date");
          tDate.textContent = closestPt.formattedDate;
          const tScore = tooltip.createDiv("trend-tip-score");
          tScore.innerHTML = `<span class="score-num">${closestPt.score.toFixed(2)}</span> <span class="score-label">\u5206</span>`;
          if (closestPt.rank) {
            const tRank = tooltip.createDiv("trend-tip-meta");
            tRank.textContent = `\u5168\u7AD9\u6392\u540D: \u7B2C ${closestPt.rank} \u4F4D`;
          }
          if (closestPt.totalVotes) {
            const tVotes = tooltip.createDiv("trend-tip-meta");
            tVotes.textContent = `\u8BC4\u5206\u4EBA\u6570: ${closestPt.totalVotes} \u4EBA`;
          }
          if (closestPt.ep) {
            const tEp = tooltip.createDiv("trend-tip-ep");
            tEp.textContent = `\u5F53\u65F6\u5DF2\u64AD: \u7B2C ${closestPt.ep.sort} \u8BDD`;
          }
          const scaleX = rect.width / width;
          const scaleY = rect.height / height;
          const pixelX = cx * scaleX;
          const pixelY = cy * scaleY;
          const isRight = pixelX > rect.width * 0.65;
          tooltip.style.left = isRight ? `${pixelX - 145}px` : `${pixelX + 15}px`;
          tooltip.style.top = `${Math.max(10, pixelY - 45)}px`;
        };
        overlay.onpointerleave = () => {
          crosshair.style.display = "none";
          activeDot.style.display = "none";
          tooltip.style.display = "none";
        };
        svg.appendChild(overlay);
        chartBox.appendChild(svg);
      }
      btnAiring.onclick = () => {
        if (currentMode === "airing") return;
        currentMode = "airing";
        btnAiring.classList.add("is-active");
        btnAll.classList.remove("is-active");
        redrawChart();
      };
      btnAll.onclick = () => {
        if (currentMode === "all") return;
        currentMode = "all";
        btnAll.classList.add("is-active");
        btnAiring.classList.remove("is-active");
        redrawChart();
      };
      redrawChart();
    }
    function createNetabaTrendModalClass({ Modal: Modal2, Notice: Notice3 }) {
      return class NetabaTrendModal extends Modal2 {
        constructor(app, plugin, item) {
          super(app);
          this.plugin = plugin;
          this.item = item;
        }
        async onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          this.modalEl.style.width = "min(760px, 92vw)";
          this.modalEl.style.maxWidth = "92vw";
          this.modalEl.style.padding = "20px 24px";
          const header = contentEl.createDiv("bangumi-trend-modal-title");
          header.createEl("h2", { text: `\u300A${this.item.name}\u300B\u8BC4\u5206\u5386\u53F2\u8D8B\u52BF` });
          const sub = contentEl.createDiv("bangumi-trend-modal-sub");
          sub.style.color = "var(--text-muted)";
          sub.style.fontSize = "13px";
          sub.style.marginBottom = "14px";
          sub.textContent = `${this.item.japaneseName || ""} \xB7 \u6570\u636E\u6765\u6E90\u4E8E Netaba.re \u65F6\u95F4\u5E8F\u5217\u5F52\u6863`;
          const chartContainer = contentEl.createDiv("bangumi-trend-modal-body");
          chartContainer.style.minHeight = "280px";
          chartContainer.style.display = "flex";
          chartContainer.style.alignItems = "center";
          chartContainer.style.justifyContent = "center";
          chartContainer.createDiv({ text: "\u6B63\u5728\u4ECE Netaba \u83B7\u53D6\u65F6\u95F4\u5E8F\u5217\u6570\u636E\u2026\u2026", cls: "bangumi-trend-loading" });
          try {
            const rawData = await fetchSubjectTrendData(this.app, this.item.subjectId);
            chartContainer.empty();
            chartContainer.style.display = "block";
            const normData = normalizeTrendData(rawData, this.item.personalScore);
            renderNativeTrendSvg(chartContainer, normData, { defaultFull: false });
          } catch (err) {
            chartContainer.empty();
            chartContainer.createDiv({
              cls: "bangumi-trend-error",
              text: `\u8BFB\u53D6 Netaba \u8BC4\u5206\u8D8B\u52BF\u5931\u8D25: ${err.message || "\u7F51\u7EDC\u6216\u63A5\u53E3\u8D85\u65F6"}`
            });
          }
          const footer = contentEl.createDiv("bangumi-trend-modal-footer");
          footer.style.marginTop = "16px";
          footer.style.display = "flex";
          footer.style.justifyContent = "space-between";
          footer.style.alignItems = "center";
          const leftLinks = footer.createDiv();
          if (this.item.subjectId) {
            const netabaLink = leftLinks.createEl("a", {
              text: "\u{1F310} \u6253\u5F00 Netaba \u9875\u9762",
              href: `https://netaba.re/subject/${this.item.subjectId}`
            });
            netabaLink.style.marginRight = "14px";
            netabaLink.style.fontSize = "12px";
            const bgmLink = leftLinks.createEl("a", {
              text: "\u{1F4FA} \u6253\u5F00 Bangumi \u539F\u7AD9",
              href: `https://bgm.tv/subject/${this.item.subjectId}`
            });
            bgmLink.style.fontSize = "12px";
          }
          const closeBtn = footer.createEl("button", { text: "\u5173\u95ED" });
          closeBtn.onclick = () => this.close();
        }
        onClose() {
          this.contentEl.empty();
        }
      };
    }
    module2.exports = {
      fetchSubjectTrendData,
      normalizeTrendData,
      renderNativeTrendSvg,
      createNetabaTrendModalClass
    };
  }
});

// src/bangumi-api.js
var require_bangumi_api = __commonJS({
  "src/bangumi-api.js"(exports2, module2) {
    var { requestUrl } = require("obsidian");
    var HEADERS = {
      "Content-Type": "text/html; charset=utf-8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/html;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
    async function requestHtml(url) {
      const response = await requestUrl({
        url,
        method: "GET",
        cache: "no-cache",
        headers: HEADERS
      });
      return response.text || "";
    }
    function parseHtml(html) {
      return new DOMParser().parseFromString(
        html || "<html></html>",
        "text/html"
      );
    }
    function cleanText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
    function cleanFileName(value) {
      return cleanText(value).replace(/[\*"\\\/<>:\|?]/g, " ").trim();
    }
    function getSubjectId(url) {
      const match = String(url || "").match(
        /\/subject\/(\d+)/i
      );
      return match ? match[1] : "";
    }
    function getNetabaUrl(url) {
      const subjectId = getSubjectId(url);
      return subjectId ? "https://netaba.re/subject/" + subjectId : "";
    }
    async function searchBangumi(keyword) {
      const searchUrl = "https://bgm.tv/subject_search/" + encodeURIComponent(
        String(keyword || "").trim()
      ) + "?cat=2";
      const html = await requestHtml(searchUrl);
      if (!html) {
        return [];
      }
      const doc = parseHtml(html);
      const list = doc.querySelector(
        "#browserItemList"
      );
      if (!list) {
        return [];
      }
      const results = [];
      for (const item of list.querySelectorAll("li.item")) {
        const titleLink = item.querySelector("h3 a");
        const typeIcon = item.querySelector("h3 span");
        const info = item.querySelector(".info.tip");
        if (!titleLink) {
          continue;
        }
        if (typeIcon && !String(
          typeIcon.className || ""
        ).includes(
          "subject_type_2"
        )) {
          continue;
        }
        const href = titleLink.getAttribute("href");
        if (!href) {
          continue;
        }
        results.push({
          title: cleanText(
            titleLink.textContent
          ),
          description: cleanText(
            info ? info.textContent : ""
          ),
          url: href.startsWith("http") ? href : "https://bgm.tv" + href
        });
      }
      return results;
    }
    function extractField(text, patterns, defaultValue = "\u672A\u77E5") {
      for (const pattern of patterns) {
        const match = String(text || "").match(
          pattern
        );
        if (match && match[1]) {
          return cleanText(match[1]).replace(/\n/g, "").replace(/\r/g, "");
        }
      }
      return defaultValue;
    }
    function detectAdaptationType(doc) {
      const allTags = [];
      const tagSection = doc.querySelector(
        "h2.subtitle"
      );
      if (tagSection && tagSection.textContent.includes(
        "\u6807\u6CE8\u4E3A"
      )) {
        const container = tagSection.nextElementSibling;
        if (container) {
          for (const tag of container.querySelectorAll(
            "a.l.meta, a.l"
          )) {
            const span = tag.querySelector("span");
            if (span) {
              allTags.push(
                cleanText(
                  span.textContent
                )
              );
            }
          }
        }
      }
      const keywords = {
        "\u5C0F\u8BF4\u6539\u7F16": [
          "\u8F7B\u5C0F\u8BF4\u6539",
          "\u8F7B\u6539",
          "\u5C0F\u8BF4\u6539",
          "\u5C0F\u8BF4\u6539\u7F16"
        ],
        "\u6F2B\u753B\u6539\u7F16": [
          "\u6F2B\u753B\u6539",
          "\u6F2B\u753B\u6539\u7F16"
        ],
        "\u6E38\u620F\u6539\u7F16": [
          "\u6E38\u620F\u6539",
          "\u6E38\u620F\u6539\u7F16"
        ],
        "\u539F\u521B\u52A8\u753B": [
          "\u539F\u521B"
        ]
      };
      for (const [category, words] of Object.entries(keywords)) {
        for (const word of words) {
          if (allTags.some(
            (tag) => tag.includes(word)
          )) {
            return category;
          }
        }
      }
      for (const item of doc.querySelectorAll(
        "#infobox > li"
      )) {
        const text = cleanText(item.textContent);
        if (!text.includes("\u539F\u4F5C") && !text.includes("\u539F\u6848")) {
          continue;
        }
        if (text.includes("\u6F2B\u753B")) {
          return "\u6F2B\u753B\u6539\u7F16";
        }
        if (text.includes("\u5C0F\u8BF4") || text.includes("\u30CE\u30D9\u30EB") || text.includes("\u30E9\u30A4\u30C8\u30CE\u30D9\u30EB")) {
          return "\u5C0F\u8BF4\u6539\u7F16";
        }
        if (text.includes("\u6E38\u620F") || text.includes("\u30B2\u30FC\u30E0")) {
          return "\u6E38\u620F\u6539\u7F16";
        }
      }
      return "\u5176\u5B83";
    }
    function calculatePreciseRating(doc) {
      if (!doc) {
        return null;
      }
      const voteElement = doc.querySelector(
        "span[property='v:votes']"
      );
      const voteText = cleanText(
        voteElement ? voteElement.textContent : ""
      );
      const declaredVotes = Number(
        voteText.replace(/[^\d]/g, "")
      );
      const counts = {};
      for (const item of doc.querySelectorAll(
        ".horizontalChart li"
      )) {
        const labelElement = item.querySelector(
          ".label"
        );
        const countElement = item.querySelector(
          ".count"
        );
        const score = Number(
          cleanText(
            labelElement ? labelElement.textContent : ""
          )
        );
        const countText = cleanText(
          countElement ? countElement.textContent : ""
        );
        const count = Number(
          countText.replace(/[^\d]/g, "")
        );
        if (Number.isInteger(score) && score >= 1 && score <= 10 && Number.isFinite(count) && count >= 0) {
          counts[score] = count;
        }
      }
      const calculatedVotes = Object.values(counts).reduce(
        (sum, count) => sum + count,
        0
      );
      const totalVotes = Number.isFinite(declaredVotes) && declaredVotes > 0 ? declaredVotes : calculatedVotes;
      if (!Number.isFinite(totalVotes) || totalVotes <= 1) {
        return null;
      }
      let weightedTotal = 0;
      for (let score = 1; score <= 10; score += 1) {
        weightedTotal += score * (counts[score] || 0);
      }
      if (!Number.isFinite(weightedTotal) || weightedTotal <= 0) {
        return null;
      }
      return weightedTotal / totalVotes;
    }
    async function getAnimeDetail(url) {
      const html = await requestHtml(url);
      if (!html) {
        return null;
      }
      const doc = parseHtml(html);
      const header = doc.querySelector(
        "#headerSubject"
      );
      if (header && header.getAttribute("typeof") !== "v:Movie") {
        return null;
      }
      const keywords = doc.querySelector(
        "meta[name='keywords']"
      );
      const keywordText = keywords ? keywords.getAttribute("content") || "" : "";
      const keywordParts = keywordText.split(",");
      const cn = cleanFileName(
        keywordParts[0] || ""
      );
      const jp = cleanFileName(
        keywordParts[1] || ""
      );
      const type = cleanText(
        doc.querySelector(
          "small.grey"
        )?.textContent
      );
      const rating = cleanText(
        doc.querySelector(
          "span[property='v:average']"
        )?.textContent
      ) || "\u672A\u77E5";
      let poster = doc.querySelector(
        "div[align='center'] > a"
      )?.href || "";
      poster = String(poster).replace("app://", "http://").trim();
      if (!poster.startsWith("http")) {
        poster = "";
      }
      const infobox = [...doc.querySelectorAll(
        "#infobox > li"
      )].map(
        (item) => item.innerText
      ).join("\n");
      const episode = extractField(
        infobox,
        [
          /话数:\s*(\d+)/,
          /话数：\s*(\d+)/
        ],
        "0"
      );
      const director = extractField(
        infobox,
        [
          /导演:\s*([^\n]+)/,
          /导演：\s*([^\n]+)/
        ]
      );
      const maker = extractField(
        infobox,
        [
          /动画制作:\s*([^\n]+)/,
          /动画制作：\s*([^\n]+)/
        ]
      );
      const music = extractField(
        infobox,
        [
          /音乐:\s*([^\n]+)/,
          /音乐：\s*([^\n]+)/
        ]
      );
      let datePattern;
      if (type === "OVA") {
        datePattern = [
          /发售日:\s*([^\n]+)/,
          /发售日：\s*([^\n]+)/
        ];
      } else if (type === "\u5267\u573A\u7248") {
        datePattern = [
          /上映年度:\s*([^\n]+)/,
          /上映年度：\s*([^\n]+)/
        ];
      } else {
        datePattern = [
          /放送开始:\s*([^\n]+)/,
          /放送开始：\s*([^\n]+)/
        ];
      }
      const date = extractField(
        infobox,
        datePattern
      );
      return {
        url,
        subjectId: getSubjectId(url),
        CN: cn || jp || "\u672A\u77E5\u4F5C\u54C1",
        JP: jp || "\u672A\u77E5",
        fileName: cn || jp || "\u672A\u77E5\u4F5C\u54C1",
        type,
        rating,
        preciseRating: calculatePreciseRating(doc),
        Poster: poster,
        episode,
        director,
        AnimeMake: maker,
        music,
        date,
        catego: detectAdaptationType(doc),
        netaba: getNetabaUrl(url)
      };
    }
    async function getUserRatingForSubject(userId, subjectId) {
      const paths = [
        "collect",
        "do",
        "wish",
        "dropped"
      ];
      for (const listPath of paths) {
        let page = 1;
        while (page <= 100) {
          const url = "https://bgm.tv/anime/list/" + userId + "/" + listPath + (page === 1 ? "" : "?page=" + page);
          const html = await requestHtml(url);
          const doc = parseHtml(html);
          const entries = doc.querySelectorAll(
            "ul#browserItemList > li.item"
          );
          if (!entries.length) {
            break;
          }
          for (const entry of entries) {
            const titleLink = entry.querySelector(
              "h3 > a.l"
            );
            if (!titleLink) {
              continue;
            }
            const href = titleLink.getAttribute(
              "href"
            );
            if (getSubjectId(href) !== String(subjectId)) {
              continue;
            }
            const ratingElement = entry.querySelector(
              "span.starlight"
            );
            const ratingClass = ratingElement ? String(
              ratingElement.className || ""
            ) : "";
            const ratingMatch = ratingClass.match(
              /(?:^|\s)stars(\d+)(?:\s|$)/
            );
            return ratingMatch ? Number(ratingMatch[1]) : null;
          }
          const pagination = doc.querySelector(
            "div#multipage"
          );
          const hasNextPage = pagination && [...pagination.querySelectorAll("a.p")].some((link) => {
            const href = link.getAttribute("href") || "";
            const match = href.match(/page=(\d+)/);
            return match && Number(match[1]) > page;
          });
          if (!hasNextPage) {
            break;
          }
          page += 1;
        }
      }
      return null;
    }
    async function delay(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }
    function getRatingFromEntry(entry) {
      const ratingElement = entry.querySelector(
        "span.starlight"
      );
      const ratingClass = ratingElement ? String(ratingElement.className || "") : "";
      const ratingMatch = ratingClass.match(
        /(?:^|\s)stars(\d+)(?:\s|$)/
      );
      return ratingMatch ? Number(ratingMatch[1]) : null;
    }
    async function getUserRatingsForSubjects(userId, subjectIds, options = {}) {
      const pageIntervalMs = Math.min(
        500,
        Math.max(
          350,
          Number(options.pageIntervalMs) || 400
        )
      );
      const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;
      const waitIfPaused = typeof options.waitIfPaused === "function" ? options.waitIfPaused : async () => {
      };
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {
      };
      const targetIds = new Set(
        (subjectIds || []).map((value) => {
          return String(value);
        })
      );
      const ratings = /* @__PURE__ */ new Map();
      if (!targetIds.size || !/^\d+$/.test(
        String(userId || "")
      )) {
        return ratings;
      }
      const paths = [
        "collect",
        "do",
        "wish",
        "dropped"
      ];
      for (const listPath of paths) {
        await waitIfPaused();
        if (shouldStop()) {
          return ratings;
        }
        let page = 1;
        while (page <= 100) {
          await waitIfPaused();
          if (shouldStop()) {
            return ratings;
          }
          const url = "https://bgm.tv/anime/list/" + userId + "/" + listPath + (page === 1 ? "" : "?page=" + page);
          const html = await requestHtml(url);
          const doc = parseHtml(html);
          const entries = doc.querySelectorAll(
            "ul#browserItemList > li.item"
          );
          if (!entries.length) {
            break;
          }
          for (const entry of entries) {
            const titleLink = entry.querySelector(
              "h3 > a.l"
            );
            const subjectId = getSubjectId(
              titleLink ? titleLink.getAttribute("href") : ""
            );
            if (!subjectId || !targetIds.has(subjectId)) {
              continue;
            }
            ratings.set(
              subjectId,
              getRatingFromEntry(entry)
            );
          }
          onProgress({
            path: listPath,
            page,
            found: ratings.size,
            total: targetIds.size
          });
          if (ratings.size >= targetIds.size) {
            return ratings;
          }
          const pagination = doc.querySelector(
            "div#multipage"
          );
          const hasNextPage = pagination && [...pagination.querySelectorAll("a.p")].some((link) => {
            const href = link.getAttribute("href") || "";
            const match = href.match(
              /page=(\d+)/
            );
            return match && Number(match[1]) > page;
          });
          if (!hasNextPage) {
            break;
          }
          page += 1;
          await delay(pageIntervalMs);
        }
      }
      return ratings;
    }
    async function getPublicRatingForSubject(subjectId) {
      const id = String(subjectId || "").trim();
      if (!/^\d+$/.test(id)) {
        return null;
      }
      const html = await requestHtml(
        "https://bgm.tv/subject/" + id
      );
      if (!html) {
        return null;
      }
      const doc = parseHtml(html);
      const value = cleanText(
        doc.querySelector(
          "span[property='v:average']"
        )?.textContent
      );
      const score = Number(value);
      return Number.isFinite(score) ? score : null;
    }
    async function getPublicRatingsForSubjects(subjectIds, delayMs) {
      const ratings = /* @__PURE__ */ new Map();
      const uniqueIds = [
        ...new Set(
          (subjectIds || []).map((value) => {
            return String(value);
          })
        )
      ].filter((value) => /^\d+$/.test(value));
      for (let index = 0; index < uniqueIds.length; index += 1) {
        const subjectId = uniqueIds[index];
        try {
          const score = await getPublicRatingForSubject(
            subjectId
          );
          if (score !== null) {
            ratings.set(subjectId, score);
          }
        } catch (error) {
          console.error(
            "\u8BFB\u53D6 BGM \u516C\u5171\u8BC4\u5206\u5931\u8D25:",
            subjectId,
            error
          );
        }
        if (index < uniqueIds.length - 1) {
          await delay(
            Math.max(
              200,
              Number(delayMs) || 450
            )
          );
        }
      }
      return ratings;
    }
    async function getPreciseRatingForSubject(subjectId) {
      const id = String(subjectId || "").trim();
      if (!/^\d+$/.test(id)) {
        return null;
      }
      const html = await requestHtml(
        "https://bgm.tv/subject/" + id
      );
      if (!html) {
        return null;
      }
      const doc = parseHtml(html);
      return calculatePreciseRating(doc);
    }
    async function getPreciseRatingsForSubjects(subjectIds, delayMs) {
      const ratings = /* @__PURE__ */ new Map();
      const uniqueIds = [
        ...new Set(
          (subjectIds || []).map((value) => {
            return String(value);
          })
        )
      ].filter((value) => /^\d+$/.test(value));
      for (let index = 0; index < uniqueIds.length; index += 1) {
        const subjectId = uniqueIds[index];
        try {
          const score = await getPreciseRatingForSubject(
            subjectId
          );
          if (score !== null) {
            ratings.set(subjectId, score);
          }
        } catch (error) {
          console.error(
            "\u8BFB\u53D6 BGM \u7CBE\u786E\u8BC4\u5206\u5931\u8D25:",
            subjectId,
            error
          );
        }
        if (index < uniqueIds.length - 1) {
          await delay(
            Math.max(
              200,
              Number(delayMs) || 450
            )
          );
        }
      }
      return ratings;
    }
    function clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      return Math.min(
        max,
        Math.max(
          min,
          Number.isFinite(parsed) ? parsed : fallback
        )
      );
    }
    function readPublicScoreFromDoc(doc) {
      const value = cleanText(
        doc.querySelector(
          "span[property='v:average']"
        )?.textContent
      );
      const score = Number(value);
      return Number.isFinite(score) && score > 0 && score <= 10 ? score : null;
    }
    function readVotesFromDoc(doc) {
      const value = cleanText(
        doc.querySelector(
          "span[property='v:votes']"
        )?.textContent
      );
      const votes = Number(
        value.replace(/[^\d]/g, "")
      );
      return Number.isFinite(votes) && votes >= 0 ? votes : null;
    }
    function createLaunchGate(intervalMs) {
      let queue = Promise.resolve();
      let nextLaunchAt = 0;
      return async () => {
        const scheduled = queue.then(async () => {
          const waitMs = Math.max(
            0,
            nextLaunchAt - Date.now()
          );
          if (waitMs > 0) {
            await delay(waitMs);
          }
          const launchedAt = Date.now();
          nextLaunchAt = launchedAt + intervalMs;
          return launchedAt;
        });
        queue = scheduled.catch(() => {
        });
        return await scheduled;
      };
    }
    async function requestHtmlWithTimeout(url, timeoutMs) {
      let timeoutId = null;
      const requestPromise = requestHtml(url);
      requestPromise.catch(() => {
      });
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            timedOut: true,
            html: ""
          });
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          requestPromise.then((html) => {
            return {
              timedOut: false,
              html: html || ""
            };
          }),
          timeoutPromise
        ]);
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    }
    async function getScoreDetailsForSubjects(subjectIds, options = {}) {
      const uniqueIds = [
        ...new Set(
          (subjectIds || []).map((value) => {
            return String(value);
          })
        )
      ].filter((value) => /^\d+$/.test(value));
      const concurrency = clampNumber(
        options.concurrency,
        1,
        4,
        3
      );
      const intervalMs = clampNumber(
        options.intervalMs,
        200,
        1e3,
        300
      );
      const timeoutMs = clampNumber(
        options.timeoutMs,
        3e3,
        6e4,
        15e3
      );
      const retryCount = clampNumber(
        options.retryCount,
        0,
        2,
        2
      );
      const needPrecise = options.needPrecise === true;
      const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;
      const waitIfPaused = typeof options.waitIfPaused === "function" ? options.waitIfPaused : async () => {
      };
      const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {
      };
      const launch = createLaunchGate(intervalMs);
      const results = /* @__PURE__ */ new Map();
      const stats = {
        requested: uniqueIds.length,
        launched: 0,
        completed: 0,
        failed: 0,
        timedOut: 0,
        retried: 0,
        stopped: false,
        maxConcurrent: 0,
        minLaunchGapMs: null
      };
      let nextIndex = 0;
      let activeRequests = 0;
      let lastLaunchAt = 0;
      async function fetchOne(subjectId) {
        const record = {
          subjectId,
          publicScore: null,
          preciseScore: null,
          votes: null,
          noData: false,
          error: "",
          timedOut: false,
          attempts: 0
        };
        for (let attempt = 0; attempt <= retryCount; attempt += 1) {
          await waitIfPaused();
          if (shouldStop()) {
            stats.stopped = true;
            record.error = "\u5DF2\u505C\u6B62";
            return record;
          }
          if (attempt > 0) {
            stats.retried += 1;
            await delay(attempt === 1 ? 1e3 : 2e3);
            await waitIfPaused();
            if (shouldStop()) {
              stats.stopped = true;
              record.error = "\u5DF2\u505C\u6B62";
              return record;
            }
          }
          const launchedAt = await launch();
          await waitIfPaused();
          if (shouldStop()) {
            stats.stopped = true;
            record.error = "\u5DF2\u505C\u6B62";
            return record;
          }
          if (lastLaunchAt > 0) {
            const gap = launchedAt - lastLaunchAt;
            stats.minLaunchGapMs = stats.minLaunchGapMs === null ? gap : Math.min(stats.minLaunchGapMs, gap);
          }
          lastLaunchAt = launchedAt;
          activeRequests += 1;
          stats.launched += 1;
          stats.maxConcurrent = Math.max(
            stats.maxConcurrent,
            activeRequests
          );
          onProgress({
            type: "launched",
            subjectId,
            attempt: attempt + 1,
            stats: Object.assign({}, stats)
          });
          let response;
          try {
            response = await requestHtmlWithTimeout(
              "https://bgm.tv/subject/" + subjectId,
              timeoutMs
            );
          } catch (error) {
            response = {
              timedOut: false,
              html: "",
              error: error && error.message ? error.message : String(error)
            };
          } finally {
            activeRequests = Math.max(
              0,
              activeRequests - 1
            );
          }
          record.attempts = attempt + 1;
          if (response.timedOut) {
            stats.timedOut += 1;
            record.timedOut = true;
            record.error = "\u8BF7\u6C42\u8D85\u65F6\uFF08" + timeoutMs + " ms\uFF09";
          } else if (response.error) {
            record.error = response.error;
          } else if (!response.html) {
            record.error = "\u6CA1\u6709\u8FD4\u56DE\u9875\u9762\u5185\u5BB9";
          } else {
            const doc = parseHtml(response.html);
            record.publicScore = readPublicScoreFromDoc(doc);
            record.votes = readVotesFromDoc(doc);
            record.preciseScore = needPrecise ? calculatePreciseRating(doc) : null;
            record.noData = record.publicScore === null && record.votes === null && (!needPrecise || record.preciseScore === null);
            record.error = "";
            return record;
          }
          if (attempt === retryCount) {
            stats.failed += 1;
          }
        }
        return record;
      }
      async function worker() {
        while (true) {
          await waitIfPaused();
          if (shouldStop()) {
            stats.stopped = true;
            return;
          }
          const index = nextIndex;
          nextIndex += 1;
          if (index >= uniqueIds.length) {
            return;
          }
          const subjectId = uniqueIds[index];
          const record = await fetchOne(subjectId);
          results.set(subjectId, record);
          stats.completed += 1;
          onProgress({
            type: "completed",
            subjectId,
            record,
            stats: Object.assign({}, stats)
          });
        }
      }
      const workers = [];
      for (let index = 0; index < Math.min(concurrency, uniqueIds.length); index += 1) {
        workers.push(worker());
      }
      await Promise.all(workers);
      return {
        results,
        stats
      };
    }
    module2.exports = {
      requestHtml,
      parseHtml,
      searchBangumi,
      getAnimeDetail,
      getUserRatingForSubject,
      getUserRatingsForSubjects,
      getPublicRatingForSubject,
      getPublicRatingsForSubjects,
      getPreciseRatingForSubject,
      getPreciseRatingsForSubjects,
      getScoreDetailsForSubjects,
      getSubjectId,
      getNetabaUrl,
      cleanText,
      cleanFileName
    };
  }
});

// src/note-manager.js
var require_note_manager = __commonJS({
  "src/note-manager.js"(exports2, module2) {
    var { requestUrl } = require("obsidian");
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
      const subjectId = getSubjectIdFromUrl(info.url) || getSubjectIdFromUrl(info.netaba);
      const userId = String(
        options.netabaUserId || ""
      ).trim();
      const compareUrl = String(
        options.netabaCompareUrl || ""
      ).trim();
      const compareSubjectId = getSubjectIdFromUrl(compareUrl);
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
      if (page === "compare" && subjectId && compareSubjectId) {
        return "https://netaba.re/" + subjectId + "/vs/" + compareSubjectId;
      }
      return info.netaba || "";
    }
    function formatScoreForDisplay(value, digits) {
      const score = Number(value);
      if (!Number.isFinite(score)) {
        return "\u672A\u8BC4\u5206";
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
      const netabaEmbedEnabled = options.netabaEmbedEnabled !== false;
      const animeInfoCollapsedByDefault = Boolean(options.animeInfoCollapsedByDefault);
      const netabaEmbedUrl = getNetabaPageUrl(info, options);
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
      const scoreToStore = options.useBangumiPreciseScore === true && preciseInfo && preciseInfo.allScore ? preciseInfo.allScore : info.rating;
      addYamlField(
        yaml,
        "BGM\u8BC4\u5206",
        scoreToStore
      );
      const showBangumiUserScore = options.showBangumiUserScore !== false;
      const showPersonalScore = options.showPersonalScore !== false;
      if (showBangumiUserScore) {
        addYamlField(
          yaml,
          "BGM\u7528\u6237\u8BC4\u5206",
          info.userRating === null || info.userRating === void 0 ? "\u672A\u8BC4\u5206" : info.userRating
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
          "**\u672C\u5730\u6587\u4EF6\u5939**\uFF1A [\u6253\u5F00\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939](file:///" + encodeURI(normalizedDownloadPath) + ")"
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
      const animeInfoMarker = animeInfoCollapsedByDefault ? "-" : "+";
      yaml.push(
        "> [!bookinfo|noicon]" + animeInfoMarker + " **" + (info.CN || "\u672A\u77E5\u4F5C\u54C1") + "**"
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
        "| \u4E2D\u6587\u540D | " + (info.CN || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u65E5\u6587\u540D | " + (info.JP || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u5F00\u64AD\u65E5\u671F | " + (info.date || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u6539\u7F16\u7C7B\u578B | " + (info.catego || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u52A8\u753B\u96C6\u6570 | " + (info.type || "") + " \u5171 " + (info.episode || "0") + " \u8BDD |"
      );
      yaml.push(
        "| \u5236\u4F5C\u516C\u53F8 | " + (info.AnimeMake || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u5236\u4F5C\u76D1\u7763 | " + (info.director || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u97F3\u4E50 | " + (info.music || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u89C2\u770B\u72B6\u6001 | " + (info.state || "\u672A\u77E5") + " |"
      );
      yaml.push(
        "| \u8BB0\u5F55\u65E5\u671F | " + info.recordDate + " |"
      );
      yaml.push(
        "| BGM \u5730\u5740 | [" + (info.CN || "\u94FE\u63A5") + "](" + info.url + ") |"
      );
      const scoreToDisplay = options.useBangumiPreciseScore === true && preciseInfo && preciseInfo.allScore ? preciseInfo.allScore : info.rating;
      const scoreDigits = options.useBangumiPreciseScore === true && preciseInfo && preciseInfo.allScore ? options.bangumiPreciseScoreDisplayDigits : 1;
      yaml.push(
        "| BGM \u8BC4\u5206 | " + formatScoreForDisplay(
          scoreToDisplay,
          scoreDigits
        ) + " |"
      );
      if (showBangumiUserScore) {
        yaml.push(
          "| BGM\u7528\u6237\u8BC4\u5206 | " + (info.userRating === null || info.userRating === void 0 ? "\u672A\u8BC4\u5206" : info.userRating) + " |"
        );
      }
      if (showPersonalScore) {
        yaml.push(
          "| \u6211\u7684\u8BC4\u5206 | \u672A\u8BC4\u5206 |"
        );
      }
      if (info.netaba) {
        yaml.push(
          "| Netaba \u8BC4\u5206\u8D8B\u52BF | [\u67E5\u770B\u53D8\u5316](" + info.netaba + ") |"
        );
      }
      if (downloadPath && downloadPath !== "\u65E0") {
        yaml.push(
          "| \u4E0B\u8F7D\u8DEF\u5F84 | `" + downloadPath + "` |"
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
          '<iframe src="' + netabaEmbedUrl + '" style="display:block;width:100%;height:600px;border:0;"></iframe>'
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
    module2.exports = {
      ensureVaultFolder,
      saveCoverLocally,
      getSeasonInfo,
      getSafeFileName,
      buildNoteContent,
      getNoteFolder,
      createAnimeNote
    };
  }
});

// src/import-manager.js
var require_import_manager = __commonJS({
  "src/import-manager.js"(exports2, module2) {
    var Modal2 = globalThis.__BangumiManagerModal;
    var Notice3 = globalThis.__BangumiManagerNotice;
    if (!Modal2 || !Notice3) {
      throw new Error("\u4E3B\u63D2\u4EF6\u6CA1\u6709\u4F20\u5165 Modal \u6216 Notice\u3002");
    }
    var fs = require("fs");
    var path = require("path");
    var bangumiApi2 = require_bangumi_api();
    var noteManager = require_note_manager();
    var WATCH_STATES2 = [
      "\u5DF2\u770B",
      "\u5728\u770B",
      "\u60F3\u770B",
      "\u629B\u5F03"
    ];
    async function openSingleAnimeImport2(app, plugin) {
      new SingleAnimeImportModal(
        app,
        plugin
      ).open();
    }
    var SingleAnimeImportModal = class extends Modal2 {
      constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.results = [];
        this.selectedInfo = null;
      }
      onOpen() {
        const {
          contentEl
        } = this;
        contentEl.empty();
        this.modalEl.style.width = "min(760px, 90vw)";
        this.modalEl.style.maxWidth = "90vw";
        this.modalEl.style.maxHeight = "90vh";
        this.modalEl.style.overflowY = "auto";
        contentEl.style.width = "100%";
        contentEl.style.boxSizing = "border-box";
        contentEl.createEl(
          "h2",
          {
            text: "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B"
          }
        );
        contentEl.createEl(
          "p",
          {
            text: "\u8F93\u5165\u52A8\u753B\u540D\u79F0\uFF0C\u641C\u7D22\u540E\u9009\u62E9\u6B63\u786E\u7684 Bangumi \u4F5C\u54C1\u3002"
          }
        );
        const hint = contentEl.querySelector(
          "p"
        );
        if (hint) {
          hint.style.whiteSpace = "normal";
          hint.style.overflowWrap = "anywhere";
          hint.style.lineHeight = "1.5";
        }
        const keywordInput = contentEl.createEl("input");
        keywordInput.type = "text";
        keywordInput.placeholder = "\u4F8B\u5982\uFF1A\u53E4\u8BFA\u5E0C\u4E9A";
        keywordInput.style.width = "100%";
        const searchButton = contentEl.createEl(
          "button",
          {
            text: "\u641C\u7D22 Bangumi"
          }
        );
        searchButton.style.marginTop = "10px";
        const resultList = contentEl.createDiv();
        resultList.style.maxHeight = "42vh";
        resultList.style.overflowY = "auto";
        resultList.style.overflowX = "hidden";
        resultList.style.marginTop = "12px";
        resultList.style.paddingRight = "4px";
        resultList.style.boxSizing = "border-box";
        const detailArea = contentEl.createDiv();
        detailArea.style.marginTop = "14px";
        const search = async () => {
          const keyword = keywordInput.value.trim();
          if (!keyword) {
            new Notice3(
              "\u8BF7\u5148\u8F93\u5165\u52A8\u753B\u540D\u79F0\u3002",
              5e3
            );
            return;
          }
          searchButton.disabled = true;
          searchButton.textContent = "\u6B63\u5728\u641C\u7D22\u2026\u2026";
          resultList.empty();
          detailArea.empty();
          try {
            this.results = await bangumiApi2.searchBangumi(
              keyword
            );
            if (this.results.length === 0) {
              resultList.createEl(
                "p",
                {
                  text: "\u6CA1\u6709\u627E\u5230\u52A8\u753B\u7ED3\u679C\u3002"
                }
              );
              return;
            }
            for (const result of this.results) {
              const button = resultList.createEl(
                "button"
              );
              button.style.display = "block";
              button.style.width = "100%";
              button.style.height = "auto";
              button.style.minHeight = "38px";
              button.style.boxSizing = "border-box";
              button.style.padding = "8px 12px";
              button.style.textAlign = "left";
              button.style.margin = "6px 0";
              button.style.whiteSpace = "normal";
              button.style.overflow = "visible";
              button.style.overflowWrap = "anywhere";
              button.style.wordBreak = "break-word";
              button.style.lineHeight = "1.45";
              button.textContent = result.title + (result.description ? "  " + result.description : "");
              button.onclick = async () => {
                await this.selectResult(
                  result,
                  detailArea
                );
              };
            }
          } catch (error) {
            console.error(
              "Bangumi \u641C\u7D22\u5931\u8D25:",
              error
            );
            resultList.createEl(
              "p",
              {
                text: "\u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u6216 Bangumi \u8BBF\u95EE\u72B6\u6001\u3002"
              }
            );
          } finally {
            searchButton.disabled = false;
            searchButton.textContent = "\u641C\u7D22 Bangumi";
          }
        };
        searchButton.onclick = search;
        keywordInput.onkeydown = (event) => {
          if (event.key === "Enter") {
            search();
          }
        };
      }
      async selectResult(result, detailArea) {
        detailArea.empty();
        detailArea.createEl(
          "p",
          {
            text: "\u6B63\u5728\u8BFB\u53D6\u52A8\u753B\u8D44\u6599\u2026\u2026"
          }
        );
        try {
          const info = await bangumiApi2.getAnimeDetail(
            result.url
          );
          if (!info) {
            detailArea.empty();
            detailArea.createEl(
              "p",
              {
                text: "\u65E0\u6CD5\u8BFB\u53D6\u8BE5\u4F5C\u54C1\u7684\u52A8\u753B\u8D44\u6599\u3002"
              }
            );
            return;
          }
          cacheImportedScoreData(
            this.plugin,
            info
          );
          await this.plugin.saveSettings();
          this.selectedInfo = info;
          this.renderDetail(
            detailArea,
            info
          );
        } catch (error) {
          console.error(
            "\u8BFB\u53D6\u52A8\u753B\u8BE6\u60C5\u5931\u8D25:",
            error
          );
          detailArea.empty();
          detailArea.createEl(
            "p",
            {
              text: "\u8BFB\u53D6\u52A8\u753B\u8BE6\u60C5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
            }
          );
        }
      }
      renderDetail(detailArea, info) {
        detailArea.empty();
        detailArea.createEl(
          "h3",
          {
            text: "\u5DF2\u9009\u62E9\uFF1A\u300A" + info.CN + "\u300B"
          }
        );
        detailArea.createEl(
          "p",
          {
            text: "\u65E5\u6587\u540D\uFF1A" + info.JP + "\n\u7C7B\u578B\uFF1A" + info.type + "\n\u603B\u96C6\u6570\uFF1A" + info.episode + "\n\u5F00\u64AD\u65E5\u671F\uFF1A" + info.date + "\nBGM\u8BC4\u5206\uFF1A" + info.rating
          }
        );
        const stateLabel = detailArea.createEl(
          "p",
          {
            text: "\u89C2\u770B\u72B6\u6001\uFF1A"
          }
        );
        stateLabel.style.marginBottom = "4px";
        const stateSelect = detailArea.createEl(
          "select"
        );
        for (const state of WATCH_STATES2) {
          stateSelect.createEl(
            "option",
            {
              text: state,
              value: state
            }
          );
        }
        const folderLabel = detailArea.createEl(
          "label"
        );
        folderLabel.style.display = "block";
        folderLabel.style.marginTop = "12px";
        const folderCheckbox = folderLabel.createEl(
          "input"
        );
        folderCheckbox.type = "checkbox";
        folderCheckbox.checked = true;
        folderLabel.appendText(
          " \u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939"
        );
        const pathPreview = detailArea.createEl(
          "p"
        );
        pathPreview.style.marginTop = "8px";
        pathPreview.style.color = "var(--text-muted)";
        const updatePreview = () => {
          const seasonInfo = noteManager.getSeasonInfo(
            info.date
          );
          const folderName = noteManager.getSafeFileName(
            info.CN || info.JP
          );
          const base = String(
            this.plugin.settings.localAnimeRoot || ""
          ).replace(
            /[\\/]+$/,
            ""
          );
          if (!folderCheckbox.checked || !base || !seasonInfo.year || seasonInfo.season === "\u672A\u77E5\u5B63\u5EA6") {
            pathPreview.textContent = "\u672C\u6B21\u4E0D\u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939\u3002";
            return;
          }
          pathPreview.textContent = "\u9884\u8BA1\u8DEF\u5F84\uFF1A" + base + "/" + seasonInfo.year + "/" + seasonInfo.season + "/" + folderName;
        };
        folderCheckbox.onchange = updatePreview;
        updatePreview();
        const createButton = detailArea.createEl(
          "button",
          {
            text: "\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0"
          }
        );
        createButton.style.marginTop = "14px";
        createButton.onclick = async () => {
          createButton.disabled = true;
          createButton.textContent = "\u6B63\u5728\u521B\u5EFA\u2026\u2026";
          try {
            await this.createNote(
              info,
              stateSelect.value,
              folderCheckbox.checked
            );
          } catch (error) {
            console.error(
              "\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0\u5931\u8D25:",
              error
            );
            new Notice3(
              "\u521B\u5EFA\u5931\u8D25\uFF1A" + error.message,
              8e3
            );
            createButton.disabled = false;
            createButton.textContent = "\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0";
          }
        };
      }
      async createNote(info, watchState, shouldCreateFolder) {
        const seasonInfo = noteManager.getSeasonInfo(
          info.date
        );
        info.state = watchState;
        info.recordDate = getTodayString();
        info.year = seasonInfo.year;
        info.season = seasonInfo.season;
        info.cover = await noteManager.saveCoverLocally(
          this.app,
          this.plugin.settings.coverFolder,
          info.subjectId,
          info.Poster
        );
        if (!info.cover) {
          throw new Error(
            "\u6CA1\u6709\u53EF\u7528\u7684\u5C01\u9762\u5730\u5740\uFF0C\u65E0\u6CD5\u521B\u5EFA\u7B14\u8BB0\u3002"
          );
        }
        info.userRating = null;
        const bangumiUserId = String(
          this.plugin.settings.bangumiUserId || ""
        ).trim();
        if (/^\d+$/.test(bangumiUserId) && info.subjectId) {
          try {
            info.userRating = await bangumiApi2.getUserRatingForSubject(
              bangumiUserId,
              info.subjectId
            );
            if (info.userRating !== null) {
              const ratingCache = Object.assign(
                {},
                this.plugin.settings.bangumiRatingCache || {}
              );
              ratingCache[info.subjectId] = String(info.userRating);
              this.plugin.settings.bangumiRatingCache = ratingCache;
              await this.plugin.saveSettings();
            }
          } catch (error) {
            info.userRating = null;
          }
        }
        let downloadPath = "\u65E0";
        if (shouldCreateFolder) {
          downloadPath = createDownloadFolder(
            this.plugin.settings,
            info
          );
        }
        const result = await noteManager.createAnimeNote(
          this.app,
          this.plugin.settings,
          info,
          {
            watchedEpisodes: "0",
            watchUrl: "",
            personalSummary: "",
            downloadPath,
            netabaEmbedEnabled: this.plugin.settings.netabaEmbedEnabled,
            animeInfoCollapsedByDefault: this.plugin.settings.animeInfoCollapsedByDefault === true,
            netabaCollapsedByDefault: this.plugin.settings.netabaCollapsedByDefault,
            netabaUserId: this.plugin.settings.netabaUserId,
            netabaCompareUrl: this.plugin.settings.netabaCompareUrl,
            netabaCompareTitle: this.plugin.settings.netabaCompareTitle,
            netabaDefaultPage: this.plugin.settings.netabaDefaultPage,
            showBangumiUserScore: this.plugin.settings.showBangumiUserScore,
            showPersonalScore: this.plugin.settings.showPersonalScore,
            useBangumiPreciseScore: this.plugin.settings.showBangumiPreciseScore === true
          }
        );
        if (!result.created) {
          new Notice3(
            "\u540C\u540D\u52A8\u753B\u7B14\u8BB0\u5DF2\u7ECF\u5B58\u5728\uFF0C\u672A\u8986\u76D6\u539F\u7B14\u8BB0\u3002",
            7e3
          );
          this.close();
          return;
        }
        new Notice3(
          "\u5DF2\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0\uFF1A" + result.filePath,
          8e3
        );
        this.close();
        const file = this.app.vault.getAbstractFileByPath(
          result.filePath
        );
        if (file) {
          const leaf = this.app.workspace.getLeaf(
            true
          );
          await leaf.openFile(file);
        }
      }
    };
    function cacheImportedScoreData(plugin, info) {
      const subjectId = String(
        info && info.subjectId || ""
      ).trim();
      if (!subjectId) {
        return;
      }
      const publicScore = Number(info.rating);
      if (Number.isFinite(publicScore)) {
        const publicCache = Object.assign(
          {},
          plugin.settings.bangumiPublicRatingCache || {}
        );
        publicCache[subjectId] = String(
          info.rating
        );
        plugin.settings.bangumiPublicRatingCache = publicCache;
      }
      const preciseScore = Number(
        info && info.preciseRating
      );
      if (Number.isFinite(preciseScore)) {
        const preciseCache = Object.assign(
          {},
          plugin.settings.bangumiPreciseRatingCache || {}
        );
        preciseCache[subjectId] = String(info.preciseRating);
        plugin.settings.bangumiPreciseRatingCache = preciseCache;
      }
    }
    function getTodayString() {
      const now = /* @__PURE__ */ new Date();
      return String(
        now.getFullYear()
      ) + String(
        now.getMonth() + 1
      ).padStart(2, "0") + String(
        now.getDate()
      ).padStart(2, "0");
    }
    function createDownloadFolder(settings, info) {
      const root = String(
        settings.localAnimeRoot || ""
      ).trim();
      if (!root || !info.year || !info.season || info.season === "\u672A\u77E5\u5B63\u5EA6") {
        return "\u65E0";
      }
      const folderName = noteManager.getSafeFileName(
        info.CN || info.JP || info.fileName
      );
      const folderPath = path.join(
        root,
        info.year,
        info.season,
        folderName
      );
      try {
        fs.mkdirSync(
          folderPath,
          {
            recursive: true
          }
        );
        return folderPath.replace(
          /\\/g,
          "/"
        );
      } catch (error) {
        throw new Error(
          "\u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939\u5931\u8D25\uFF1A" + error.message
        );
      }
    }
    module2.exports = {
      openSingleAnimeImport: openSingleAnimeImport2
    };
  }
});

// src/batch-import-manager.js
var require_batch_import_manager = __commonJS({
  "src/batch-import-manager.js"(exports2, module2) {
    var Modal2 = globalThis.__BangumiManagerModal;
    var Notice3 = globalThis.__BangumiManagerNotice;
    if (!Modal2 || !Notice3) {
      throw new Error("\u4E3B\u63D2\u4EF6\u6CA1\u6709\u4F20\u5165 Modal \u6216 Notice\u3002");
    }
    var path = require("path");
    var bangumiApi2 = require_bangumi_api();
    var noteManager = require_note_manager();
    var LIST_TYPES = {
      collect: {
        name: "\u5DF2\u770B",
        path: "collect",
        state: "\u5DF2\u770B",
        statusFile: "\u6279\u91CF\u5BFC\u5165\u72B6\u6001_\u5DF2\u770B.md"
      },
      wish: {
        name: "\u60F3\u770B",
        path: "wish",
        state: "\u60F3\u770B",
        statusFile: "\u6279\u91CF\u5BFC\u5165\u72B6\u6001_\u60F3\u770B.md"
      },
      doing: {
        name: "\u5728\u770B",
        path: "do",
        state: "\u5728\u770B",
        statusFile: "\u6279\u91CF\u5BFC\u5165\u72B6\u6001_\u5728\u770B.md"
      }
    };
    var DEFAULT_DELAY = 1200;
    function normalizeImageUrl(value) {
      const source = String(value || "").trim();
      if (!source) {
        return "";
      }
      if (source.startsWith("//")) {
        return "https:" + source;
      }
      if (source.startsWith("/")) {
        return "https://bgm.tv" + source;
      }
      try {
        return new URL(
          source,
          "https://bgm.tv"
        ).href;
      } catch (error) {
        return source;
      }
    }
    async function openBatchAnimeImport2(app, plugin) {
      new BatchAnimeImportModal(
        app,
        plugin
      ).open();
    }
    var BatchAnimeImportModal = class extends Modal2 {
      constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.running = false;
        this.stopRequested = false;
        this.status = null;
        this.statusFilePath = "";
      }
      onOpen() {
        const {
          contentEl
        } = this;
        contentEl.empty();
        this.modalEl.style.width = "min(760px, 90vw)";
        this.modalEl.style.maxWidth = "90vw";
        this.modalEl.style.maxHeight = "90vh";
        this.modalEl.style.overflowY = "auto";
        contentEl.style.width = "100%";
        contentEl.style.boxSizing = "border-box";
        contentEl.createEl(
          "h2",
          {
            text: "\u6279\u91CF\u5BFC\u5165\u52A8\u753B"
          }
        );
        contentEl.createEl(
          "p",
          {
            text: "\u4ECE Bangumi \u7528\u6237\u5217\u8868\u8BFB\u53D6\u52A8\u753B\uFF0C\u81EA\u52A8\u521B\u5EFA\u7B14\u8BB0\u3002\u53EF\u6309\u6536\u85CF\u65E5\u671F\u7B5B\u9009\uFF0C\u5E76\u6309 BGM \u4F5C\u54C1\u94FE\u63A5\u8DF3\u8FC7 Obsidian \u4E2D\u5DF2\u6709\u7684\u52A8\u753B\u3002"
          }
        );
        const userLabel = contentEl.createEl(
          "p",
          {
            text: "Bangumi \u7528\u6237 ID\uFF1A"
          }
        );
        userLabel.style.marginBottom = "4px";
        const userInput = contentEl.createEl("input");
        userInput.type = "text";
        userInput.value = String(
          this.plugin.settings.batchLastUserId || this.plugin.settings.bangumiUserId || ""
        );
        userInput.placeholder = "\u4F8B\u5982\uFF1A890645";
        userInput.style.width = "100%";
        const useSettingsUserButton = contentEl.createEl(
          "button",
          {
            text: "\u4F7F\u7528\u8BBE\u7F6E\u4E2D\u7684 Bangumi \u7528\u6237 ID"
          }
        );
        useSettingsUserButton.style.marginTop = "8px";
        useSettingsUserButton.onclick = () => {
          const settingsUserId = String(
            this.plugin.settings.bangumiUserId || ""
          ).trim();
          if (!settingsUserId) {
            new Notice3(
              "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199 Bangumi \u7528\u6237 ID\u3002",
              5e3
            );
            return;
          }
          userInput.value = settingsUserId;
        };
        const listLabel = contentEl.createEl(
          "p",
          {
            text: "\u8981\u5BFC\u5165\u7684\u5217\u8868\uFF1A"
          }
        );
        listLabel.style.marginBottom = "4px";
        const listSelect = contentEl.createEl(
          "select"
        );
        for (const [key, config] of Object.entries(LIST_TYPES)) {
          listSelect.createEl(
            "option",
            {
              text: config.name,
              value: key
            }
          );
        }
        const stateLabel = contentEl.createEl(
          "p",
          {
            text: "\u65B0\u5EFA\u7B14\u8BB0\u7684\u89C2\u770B\u72B6\u6001\uFF1A"
          }
        );
        stateLabel.style.marginBottom = "4px";
        const stateSelect = contentEl.createEl(
          "select"
        );
        for (const state of [
          "\u5DF2\u770B",
          "\u5728\u770B",
          "\u60F3\u770B",
          "\u629B\u5F03"
        ]) {
          stateSelect.createEl(
            "option",
            {
              text: state,
              value: state
            }
          );
        }
        const folderLabel = contentEl.createEl(
          "label"
        );
        folderLabel.style.display = "block";
        folderLabel.style.marginTop = "12px";
        const folderCheckbox = folderLabel.createEl(
          "input"
        );
        folderCheckbox.type = "checkbox";
        folderCheckbox.checked = Boolean(
          this.plugin.settings.batchCreateDownloadFolder
        );
        folderLabel.appendText(
          " \u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939"
        );
        const skipLabel = contentEl.createEl(
          "label"
        );
        skipLabel.style.display = "block";
        skipLabel.style.marginTop = "8px";
        const skipCheckbox = skipLabel.createEl(
          "input"
        );
        skipCheckbox.type = "checkbox";
        skipCheckbox.checked = true;
        skipLabel.appendText(
          " \u8DF3\u8FC7 Obsidian \u4E2D\u5DF2\u7ECF\u5B58\u5728\u7684\u52A8\u753B"
        );
        const dateLabel = contentEl.createEl(
          "p",
          {
            text: "\u53EA\u5BFC\u5165\u6B64\u65E5\u671F\u4E4B\u540E\u6536\u85CF\u7684\u52A8\u753B\uFF1A"
          }
        );
        dateLabel.style.marginTop = "12px";
        dateLabel.style.marginBottom = "4px";
        const dateInput = contentEl.createEl(
          "input"
        );
        dateInput.type = "date";
        dateInput.style.width = "220px";
        dateInput.style.boxSizing = "border-box";
        const dateHint = contentEl.createEl(
          "p",
          {
            text: "\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5236\u6536\u85CF\u65E5\u671F\u3002\u4F8B\u5982\u586B\u5199 2026-08-01\uFF0C\u53EA\u4F1A\u5BFC\u5165 2026 \u5E74 8 \u6708 1 \u65E5\u4E4B\u540E\u6536\u85CF\u7684\u52A8\u753B\u3002"
          }
        );
        dateHint.style.marginTop = "4px";
        dateHint.style.color = "var(--text-muted)";
        const speedLabel = contentEl.createEl(
          "p",
          {
            text: "\u6BCF\u90E8\u52A8\u753B\u4E4B\u95F4\u6682\u505C 1.2 \u79D2\uFF0C\u907F\u514D\u8FDE\u7EED\u8BF7\u6C42\u8FC7\u5FEB\u3002"
          }
        );
        speedLabel.style.marginTop = "12px";
        const progress = contentEl.createEl(
          "pre"
        );
        progress.style.whiteSpace = "pre-wrap";
        progress.style.wordBreak = "break-word";
        progress.style.maxHeight = "260px";
        progress.style.overflowY = "auto";
        progress.style.padding = "10px";
        progress.style.background = "var(--background-secondary)";
        progress.textContent = "\u7B49\u5F85\u5F00\u59CB\u3002";
        const startButton = contentEl.createEl(
          "button",
          {
            text: "\u5F00\u59CB\u6279\u91CF\u5BFC\u5165"
          }
        );
        startButton.style.marginTop = "12px";
        const stopButton = contentEl.createEl(
          "button",
          {
            text: "\u505C\u6B62\u540E\u7EED\u5BFC\u5165"
          }
        );
        stopButton.style.marginTop = "12px";
        stopButton.style.marginLeft = "8px";
        stopButton.disabled = true;
        listSelect.onchange = () => {
          const config = LIST_TYPES[listSelect.value];
          stateSelect.value = config.state;
        };
        startButton.onclick = async () => {
          const userId = userInput.value.trim();
          if (!userId) {
            new Notice3(
              "\u8BF7\u5148\u586B\u5199 Bangumi \u7528\u6237 ID\u3002",
              6e3
            );
            return;
          }
          if (!/^\d+$/.test(userId)) {
            new Notice3(
              "Bangumi \u7528\u6237 ID \u53EA\u80FD\u586B\u5199\u6570\u5B57\u3002",
              6e3
            );
            return;
          }
          if (this.running) {
            return;
          }
          this.running = true;
          this.stopRequested = false;
          startButton.disabled = true;
          stopButton.disabled = false;
          userInput.disabled = true;
          listSelect.disabled = true;
          stateSelect.disabled = true;
          folderCheckbox.disabled = true;
          skipCheckbox.disabled = true;
          dateInput.disabled = true;
          this.plugin.settings.batchLastUserId = userId;
          this.plugin.settings.bangumiUserId = userId;
          this.plugin.settings.batchCreateDownloadFolder = folderCheckbox.checked;
          await this.plugin.saveSettings();
          try {
            await this.runImport(
              userId,
              listSelect.value,
              stateSelect.value,
              folderCheckbox.checked,
              skipCheckbox.checked,
              dateInput.value,
              progress
            );
          } finally {
            this.running = false;
            startButton.disabled = false;
            stopButton.disabled = true;
            userInput.disabled = false;
            listSelect.disabled = false;
            stateSelect.disabled = false;
            folderCheckbox.disabled = false;
            skipCheckbox.disabled = false;
            dateInput.disabled = false;
          }
        };
        stopButton.onclick = () => {
          this.stopRequested = true;
          progress.textContent += "\n\u5DF2\u8BF7\u6C42\u505C\u6B62\uFF0C\u5F53\u524D\u52A8\u753B\u5904\u7406\u5B8C\u6210\u540E\u505C\u6B62\u3002";
          stopButton.disabled = true;
        };
      }
      async getExistingBangumiSubjectIds() {
        const subjectIds = /* @__PURE__ */ new Set();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
          if (!file.path.startsWith(
            this.plugin.settings.noteRootFolder + "/"
          )) {
            continue;
          }
          const content = await this.app.vault.read(
            file
          );
          const match = content.match(
            /^\s*BGM\u94FE\u63A5\s*:\s*["']?([^"'\r\n]+)["']?\s*$/m
          );
          if (!match) {
            continue;
          }
          const subjectId = bangumiApi2.getSubjectId(
            match[1]
          );
          if (subjectId) {
            subjectIds.add(subjectId);
          }
        }
        return subjectIds;
      }
      async runImport(userId, listKey, targetState, createFolder, skipExisting, importAfterDate, progress) {
        const listConfig = LIST_TYPES[listKey];
        const status = {
          isRunning: true,
          wasStopped: false,
          hadFatalError: false,
          userId,
          listName: listConfig.name,
          totalPages: 0,
          totalItems: 0,
          processedItems: 0,
          createdNotes: 0,
          skippedNotes: 0,
          filteredOutItems: 0,
          failedItems: 0,
          currentPage: 0,
          currentItem: "",
          failedList: [],
          recentLogs: [],
          startTime: Date.now()
        };
        this.status = status;
        this.statusFilePath = this.plugin.settings.noteRootFolder + "/" + listConfig.statusFile;
        try {
          this.writeProgress(
            progress,
            "\u6B63\u5728\u8BFB\u53D6 Bangumi \u5217\u8868\u2026\u2026"
          );
          const allItems = await this.fetchAllCollectionPages(
            userId,
            listConfig.path,
            status,
            progress
          );
          const filteredItems = importAfterDate ? allItems.filter((item) => {
            return item.collectedDate && item.collectedDate > importAfterDate;
          }) : allItems;
          const filteredOutCount = allItems.length - filteredItems.length;
          status.filteredOutItems = filteredOutCount;
          const items = filteredItems;
          if (!items.length) {
            if (importAfterDate && filteredOutCount > 0) {
              this.writeProgress(
                progress,
                "\u6CA1\u6709\u627E\u5230\u7B26\u5408\u65E5\u671F\u6761\u4EF6\u7684\u52A8\u753B\u3002\u5DF2\u8FC7\u6EE4 " + filteredOutCount + " \u90E8\u3002"
              );
            } else {
              this.writeProgress(
                progress,
                "\u6CA1\u6709\u627E\u5230\u53EF\u5BFC\u5165\u7684\u52A8\u753B\u3002"
              );
            }
            return;
          }
          const existingSubjectIds = skipExisting ? await this.getExistingBangumiSubjectIds() : /* @__PURE__ */ new Set();
          status.totalItems = items.length;
          const filterMessage = importAfterDate ? "\uFF0C\u5DF2\u6309\u6536\u85CF\u65E5\u671F\u8FC7\u6EE4 " + filteredOutCount + " \u90E8" : "";
          this.writeProgress(
            progress,
            "\u5171\u627E\u5230 " + items.length + " \u90E8\u52A8\u753B" + filterMessage + "\uFF0C\u5F00\u59CB\u5BFC\u5165\u2026\u2026"
          );
          await this.updateStatusFile(
            status
          );
          for (let index = 0; index < items.length; index += 1) {
            if (this.stopRequested) {
              this.addLog(
                status,
                "\u7528\u6237\u505C\u6B62\u4E86\u540E\u7EED\u5BFC\u5165\u3002"
              );
              break;
            }
            const item = items[index];
            const current = index + 1;
            status.currentItem = item.title_cn || item.title_jp || "\u672A\u547D\u540D\u4F5C\u54C1";
            this.writeProgress(
              progress,
              "[" + current + "/" + items.length + "] \u6B63\u5728\u5904\u7406\uFF1A" + status.currentItem
            );
            try {
              const result = await this.importOne(
                item,
                targetState,
                createFolder,
                skipExisting,
                status,
                existingSubjectIds
              );
              status.processedItems = current;
              if (result === "created") {
                status.createdNotes += 1;
              } else if (result === "skipped") {
                status.skippedNotes += 1;
              }
              await this.updateStatusFile(
                status
              );
            } catch (error) {
              status.processedItems = current;
              status.failedItems += 1;
              status.failedList.push({
                title: status.currentItem,
                url: item.link,
                reason: error.message
              });
              this.addLog(
                status,
                "\u5904\u7406\u5931\u8D25\uFF1A" + status.currentItem + "\uFF1B" + error.message
              );
              await this.updateStatusFile(
                status
              );
            }
            if (index < items.length - 1 && !this.stopRequested) {
              await delay(
                DEFAULT_DELAY
              );
            }
          }
          status.isRunning = false;
          status.wasStopped = this.stopRequested === true;
          await this.updateStatusFile(
            status
          );
          this.writeProgress(
            progress,
            this.createSummary(
              status
            )
          );
          new Notice3(
            this.createSummary(status),
            1e4
          );
        } catch (error) {
          status.isRunning = false;
          status.wasStopped = this.stopRequested === true;
          status.hadFatalError = true;
          status.failedItems += 1;
          status.failedList.push({
            title: status.currentItem || "\uFF08\u5217\u8868\u8BFB\u53D6\u9636\u6BB5\uFF09",
            url: "",
            reason: error.message
          });
          this.addLog(
            status,
            "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" + error.message
          );
          await this.updateStatusFile(
            status
          );
          const summary = status.wasStopped ? this.createSummary(status) : "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" + error.message;
          this.writeProgress(
            progress,
            summary
          );
          new Notice3(
            summary,
            1e4
          );
        }
      }
      async fetchAllCollectionPages(userId, listPath, status, progress) {
        const items = [];
        let page = 1;
        while (true) {
          if (this.stopRequested) {
            break;
          }
          const url = "https://bgm.tv/anime/list/" + userId + "/" + listPath + (page === 1 ? "" : "?page=" + page);
          status.currentPage = page;
          this.writeProgress(
            progress,
            "\u6B63\u5728\u8BFB\u53D6\u7B2C " + page + " \u9875\u2026\u2026"
          );
          const html = await bangumiApi2.requestHtml(
            url
          );
          const doc = bangumiApi2.parseHtml(
            html
          );
          const pageItems = this.parseCollectionPage(
            doc
          );
          if (pageItems.length === 0) {
            break;
          }
          items.push(
            ...pageItems
          );
          status.totalPages = page;
          await this.updateStatusFile(
            status
          );
          if (!this.hasNextPage(
            doc,
            page
          )) {
            break;
          }
          page += 1;
          await delay(1200);
        }
        return items;
      }
      parseCollectionPage(doc) {
        const result = [];
        const entries = doc.querySelectorAll(
          "ul#browserItemList > li.item"
        );
        for (const entry of entries) {
          const titleLink = entry.querySelector(
            "h3 > a.l"
          );
          const cover = entry.querySelector(
            "img.cover"
          );
          if (!titleLink) {
            continue;
          }
          const href = titleLink.getAttribute(
            "href"
          );
          if (!href) {
            continue;
          }
          const jpElement = entry.querySelector(
            "h3 > small.grey"
          );
          const entryText = String(
            entry.textContent || ""
          );
          const ratingElement = entry.querySelector(
            "span.starlight"
          );
          const ratingClass = ratingElement ? String(
            ratingElement.className || ""
          ) : "";
          const ratingMatch = ratingClass.match(
            /(?:^|\s)stars(\d+)(?:\s|$)/
          );
          const userRating = ratingMatch ? Number(ratingMatch[1]) : null;
          const dateMatch = entryText.match(
            /(20\d{2})-(\d{1,2})-(\d{1,2})/
          );
          const collectedDate = dateMatch ? dateMatch[1] + "-" + dateMatch[2].padStart(2, "0") + "-" + dateMatch[3].padStart(2, "0") : "";
          result.push({
            title_cn: bangumiApi2.cleanFileName(
              titleLink.textContent
            ),
            title_jp: bangumiApi2.cleanFileName(
              jpElement ? jpElement.textContent : ""
            ),
            link: href.startsWith("http") ? href : "https://bgm.tv" + href,
            subjectId: bangumiApi2.getSubjectId(
              href
            ),
            collectedDate,
            userRating,
            cover: cover ? normalizeImageUrl(
              cover.getAttribute("src")
            ) : ""
          });
        }
        return result;
      }
      hasNextPage(doc, page) {
        const pagination = doc.querySelector(
          "div#multipage"
        );
        if (!pagination) {
          return false;
        }
        const links = pagination.querySelectorAll(
          "a.p"
        );
        for (const link of links) {
          const href = link.getAttribute(
            "href"
          ) || "";
          const match = href.match(
            /page=(\d+)/
          );
          if (match && Number(match[1]) > page) {
            return true;
          }
        }
        return false;
      }
      async importOne(item, targetState, createFolder, skipExisting, status, existingSubjectIds) {
        const subjectId = item.subjectId || bangumiApi2.getSubjectId(
          item.link
        );
        if (skipExisting && subjectId && existingSubjectIds.has(subjectId)) {
          this.addLog(
            status,
            "\u8DF3\u8FC7 Obsidian \u4E2D\u5DF2\u6709\u52A8\u753B\uFF1A" + (item.title_cn || item.title_jp || item.link)
          );
          return "skipped";
        }
        const info = await bangumiApi2.getAnimeDetail(
          item.link
        );
        if (!info) {
          throw new Error(
            "\u65E0\u6CD5\u8BFB\u53D6\u52A8\u753B\u8BE6\u60C5"
          );
        }
        cacheImportedScoreData(
          this.plugin,
          info
        );
        await this.plugin.saveSettings();
        const seasonInfo = noteManager.getSeasonInfo(
          info.date
        );
        info.state = targetState;
        info.recordDate = getTodayString();
        info.year = seasonInfo.year;
        info.season = seasonInfo.season;
        info.url = item.link;
        info.userRating = item.userRating;
        if (info.userRating !== null && info.userRating !== void 0 && info.subjectId) {
          const ratingCache = Object.assign(
            {},
            this.plugin.settings.bangumiRatingCache || {}
          );
          ratingCache[info.subjectId] = String(info.userRating);
          this.plugin.settings.bangumiRatingCache = ratingCache;
          await this.plugin.saveSettings();
        }
        info.fileName = info.CN || info.JP || item.title_cn || item.title_jp || "\u672A\u77E5\u4F5C\u54C1";
        info.cover = await noteManager.saveCoverLocally(
          this.app,
          this.plugin.settings.coverFolder,
          info.subjectId,
          info.Poster || item.cover
        );
        if (!info.cover) {
          throw new Error(
            "\u6CA1\u6709\u53EF\u7528\u5C01\u9762"
          );
        }
        let downloadPath = "\u65E0";
        if (createFolder && info.year && info.season !== "\u672A\u77E5\u5B63\u5EA6") {
          downloadPath = this.createDownloadFolder(
            info
          );
        }
        const notePath = this.getExpectedNotePath(
          info
        );
        if (skipExisting && this.app.vault.getAbstractFileByPath(
          notePath
        )) {
          this.addLog(
            status,
            "\u8DF3\u8FC7\u5DF2\u6709\u7B14\u8BB0\uFF1A" + notePath
          );
          return "skipped";
        }
        const created = await noteManager.createAnimeNote(
          this.app,
          this.plugin.settings,
          info,
          {
            watchedEpisodes: "0",
            watchUrl: "",
            personalSummary: "",
            downloadPath,
            netabaEmbedEnabled: this.plugin.settings.netabaEmbedEnabled,
            animeInfoCollapsedByDefault: this.plugin.settings.animeInfoCollapsedByDefault === true,
            netabaCollapsedByDefault: this.plugin.settings.netabaCollapsedByDefault,
            netabaUserId: this.plugin.settings.netabaUserId,
            netabaCompareUrl: this.plugin.settings.netabaCompareUrl,
            netabaCompareTitle: this.plugin.settings.netabaCompareTitle,
            netabaDefaultPage: this.plugin.settings.netabaDefaultPage,
            showBangumiUserScore: this.plugin.settings.showBangumiUserScore,
            showPersonalScore: this.plugin.settings.showPersonalScore,
            useBangumiPreciseScore: this.plugin.settings.showBangumiPreciseScore === true
          }
        );
        if (!created.created) {
          return "skipped";
        }
        this.addLog(
          status,
          "\u5DF2\u521B\u5EFA\uFF1A" + created.filePath
        );
        return "created";
      }
      getExpectedNotePath(info) {
        const folder = noteManager.getNoteFolder(
          this.plugin.settings.noteRootFolder,
          info
        );
        const fileName = noteManager.getSafeFileName(
          info.fileName || info.CN || info.JP || "\u672A\u77E5\u4F5C\u54C1"
        );
        return folder + "/" + fileName + ".md";
      }
      createDownloadFolder(info) {
        const root = String(
          this.plugin.settings.localAnimeRoot || ""
        ).trim();
        if (!root || !info.year || !info.season) {
          return "\u65E0";
        }
        const folderName = noteManager.getSafeFileName(
          info.fileName || info.CN || info.JP
        );
        const folderPath = path.join(
          root,
          info.year,
          info.season,
          folderName
        );
        const fs2 = require("fs");
        fs2.mkdirSync(
          folderPath,
          {
            recursive: true
          }
        );
        return folderPath.replace(
          /\\/g,
          "/"
        );
      }
      writeProgress(element, message) {
        element.textContent = message;
      }
      addLog(status, message) {
        const now = /* @__PURE__ */ new Date();
        const time = now.toLocaleTimeString(
          "zh-CN",
          {
            hour12: false
          }
        );
        const entry = "[" + time + "] " + message;
        status.recentLogs.push(
          entry
        );
        if (status.recentLogs.length > 50) {
          status.recentLogs = status.recentLogs.slice(
            -50
          );
        }
        console.log(
          "[Bangumi\u6279\u91CF\u5BFC\u5165]",
          message
        );
      }
      async updateStatusFile(status) {
        const folder = this.plugin.settings.noteRootFolder;
        await noteManager.ensureVaultFolder(
          this.app,
          folder
        );
        const filePath = this.statusFilePath;
        const content = this.buildStatusContent(
          status
        );
        const existing = this.app.vault.getAbstractFileByPath(
          filePath
        );
        if (existing) {
          await this.app.vault.modify(
            existing,
            content
          );
        } else {
          await this.app.vault.create(
            filePath,
            content
          );
        }
      }
      buildStatusContent(status) {
        const percent = status.totalItems > 0 ? Math.round(
          status.processedItems / status.totalItems * 100
        ) : 0;
        let content = "# Bangumi \u6279\u91CF\u5BFC\u5165\u72B6\u6001\n\n";
        content += "\u5217\u8868\uFF1A" + status.listName + "\n\n";
        content += "\u7528\u6237 ID\uFF1A" + status.userId + "\n\n";
        content += "\u72B6\u6001\uFF1A" + (status.isRunning ? "\u8FDB\u884C\u4E2D" : status.wasStopped ? "\u5DF2\u4E2D\u6B62" : status.hadFatalError ? "\u5DF2\u5931\u8D25" : "\u5DF2\u5B8C\u6210") + "\n\n";
        content += "\u8FDB\u5EA6\uFF1A" + status.processedItems + "/" + status.totalItems + "\uFF08" + percent + "%\uFF09\n\n";
        content += "- \u9875\u9762\u6570\uFF1A" + status.totalPages + "\n";
        content += "- \u6210\u529F\u521B\u5EFA\uFF1A" + status.createdNotes + "\n";
        content += "- \u8DF3\u8FC7\u5DF2\u6709\u52A8\u753B\uFF1A" + status.skippedNotes + "\n";
        content += "- \u65E9\u4E8E\u7B5B\u9009\u65E5\u671F\uFF1A" + (status.filteredOutItems || 0) + "\n";
        content += "- \u5931\u8D25\u6570\u91CF\uFF1A" + status.failedItems + "\n";
        if (status.currentItem) {
          content += "- \u5F53\u524D\u4F5C\u54C1\uFF1A" + status.currentItem + "\n";
        }
        content += "\n## \u5931\u8D25\u5217\u8868\n\n";
        if (status.failedList.length === 0) {
          content += "\u6682\u65E0\u5931\u8D25\u9879\u76EE\u3002\n";
        } else {
          for (const item of status.failedList) {
            content += "- " + item.title + "\n  - \u94FE\u63A5\uFF1A" + item.url + "\n  - \u539F\u56E0\uFF1A" + item.reason + "\n";
          }
        }
        content += "\n## \u6700\u8FD1\u65E5\u5FD7\n\n";
        content += status.recentLogs.join(
          "\n"
        );
        content += "\n";
        return content;
      }
      createSummary(status) {
        const duration = Math.round(
          (Date.now() - status.startTime) / 1e3
        );
        const minutes = Math.floor(
          duration / 60
        );
        const seconds = duration % 60;
        const statusText = status.wasStopped ? status.failedItems > 0 ? "\u6279\u91CF\u5BFC\u5165\u5DF2\u4E2D\u6B62\uFF08\u53D1\u751F\u5931\u8D25\uFF09\uFF1A\u65B0\u5EFA " : "\u6279\u91CF\u5BFC\u5165\u5DF2\u4E2D\u6B62\uFF1A\u65B0\u5EFA " : "\u6279\u91CF\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u5EFA ";
        return statusText + status.createdNotes + " \u90E8\uFF0C\u8DF3\u8FC7\u5DF2\u6709\u52A8\u753B " + status.skippedNotes + " \u90E8\uFF0C\u65E9\u4E8E\u7B5B\u9009\u65E5\u671F " + (status.filteredOutItems || 0) + " \u90E8\uFF0C\u5931\u8D25 " + status.failedItems + " \u90E8\u3002\u8017\u65F6 " + minutes + " \u5206 " + seconds + " \u79D2\u3002";
      }
      onClose() {
        if (this.running) {
          this.stopRequested = true;
        }
        this.contentEl.empty();
      }
    };
    function cacheImportedScoreData(plugin, info) {
      const subjectId = String(
        info && info.subjectId || ""
      ).trim();
      if (!subjectId) {
        return;
      }
      const publicScore = Number(info.rating);
      if (Number.isFinite(publicScore)) {
        const publicCache = Object.assign(
          {},
          plugin.settings.bangumiPublicRatingCache || {}
        );
        publicCache[subjectId] = String(
          info.rating
        );
        plugin.settings.bangumiPublicRatingCache = publicCache;
      }
      const preciseScore = Number(
        info && info.preciseRating
      );
      if (Number.isFinite(preciseScore)) {
        const preciseCache = Object.assign(
          {},
          plugin.settings.bangumiPreciseRatingCache || {}
        );
        preciseCache[subjectId] = String(info.preciseRating);
        plugin.settings.bangumiPreciseRatingCache = preciseCache;
      }
    }
    function getTodayString() {
      const now = /* @__PURE__ */ new Date();
      return String(
        now.getFullYear()
      ) + String(
        now.getMonth() + 1
      ).padStart(2, "0") + String(
        now.getDate()
      ).padStart(2, "0");
    }
    function delay(ms) {
      return new Promise(
        (resolve) => {
          setTimeout(
            resolve,
            ms
          );
        }
      );
    }
    module2.exports = {
      openBatchAnimeImport: openBatchAnimeImport2
    };
  }
});

// src/settings-tab.js
var require_settings_tab = __commonJS({
  "src/settings-tab.js"(exports2, module2) {
    var Modal2 = globalThis.__BangumiManagerModal;
    if (!Modal2) {
      throw new Error("\u4E3B\u63D2\u4EF6\u6CA1\u6709\u4F20\u5165 Modal\u3002");
    }
    var ScoreDataRefreshPromptModal = class extends Modal2 {
      constructor(app, noteCount, onResolve) {
        super(app);
        this.noteCount = noteCount;
        this.onResolve = onResolve;
        this.resolved = false;
      }
      resolve(action, disableFuturePrompts) {
        if (this.resolved) {
          return;
        }
        this.resolved = true;
        this.onResolve({
          action,
          disableFuturePrompts
        });
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", {
          text: "\u66F4\u65B0\u8BC4\u5206\u6570\u636E"
        });
        contentEl.createEl("p", {
          text: "\u68C0\u6D4B\u5230 " + this.noteCount + " \u7BC7 Bangumi \u52A8\u753B\u7B14\u8BB0\u3002\u662F\u5426\u7ACB\u5373\u8BFB\u53D6\u8BC4\u5206\u6570\u636E\uFF1F"
        });
        const label = contentEl.createEl("label");
        label.style.display = "block";
        label.style.margin = "16px 0";
        const checkbox = label.createEl("input");
        checkbox.type = "checkbox";
        label.appendText(" \u8BB0\u4F4F\u6211\u7684\u9009\u62E9\uFF0C\u4EE5\u540E\u4E0D\u518D\u8BE2\u95EE");
        const actions = contentEl.createDiv();
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";
        const laterButton = actions.createEl("button", {
          text: "\u7A0D\u540E\u66F4\u65B0"
        });
        const updateButton = actions.createEl("button", {
          text: "\u7ACB\u5373\u66F4\u65B0"
        });
        laterButton.onclick = () => {
          this.resolve("later", checkbox.checked);
          this.close();
        };
        updateButton.onclick = () => {
          this.resolve("update", checkbox.checked);
          this.close();
        };
      }
      onClose() {
        if (!this.resolved) {
          this.resolve("later", false);
        }
        this.contentEl.empty();
      }
    };
    var RatingSyncProgressModal = class extends Modal2 {
      constructor(app, plugin, onCloseRequest) {
        super(app);
        this.plugin = plugin;
        this.onCloseRequest = onCloseRequest;
        this.unsubscribe = null;
        this.closeRequested = false;
        this.allowClose = false;
      }
      onOpen() {
        this.render();
        if (this.plugin.ratingSync && typeof this.plugin.ratingSync.subscribe === "function") {
          this.unsubscribe = this.plugin.ratingSync.subscribe(() => {
            this.render();
          });
        }
      }
      getTask() {
        return this.plugin.ratingSync ? this.plugin.ratingSync.getTask() : null;
      }
      render() {
        const task = this.getTask();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", {
          text: "\u8BC4\u5206\u540C\u6B65\u8FDB\u5EA6"
        });
        if (!task) {
          contentEl.createEl("p", {
            text: "\u6CA1\u6709\u6B63\u5728\u8FD0\u884C\u7684\u8BC4\u5206\u540C\u6B65\u4EFB\u52A1\u3002"
          });
          return;
        }
        contentEl.createEl("p", {
          text: task.phase || "\u6B63\u5728\u51C6\u5907"
        });
        const current = task.currentName ? "\u5F53\u524D\uFF1A" + task.currentName : "";
        if (current) {
          contentEl.createEl("p", {
            text: current
          });
        }
        const stats = [
          "\u626B\u63CF\u7B14\u8BB0\uFF1A" + task.scanned,
          "\u8BE6\u60C5\u8BF7\u6C42\uFF1A" + task.requested,
          "\u5DF2\u5B8C\u6210\uFF1A" + task.completed,
          "\u5931\u8D25\uFF1A" + task.failed,
          "\u8D85\u65F6\uFF1A" + task.timedOut,
          "\u65E0\u6570\u636E\uFF1A" + task.noData
        ];
        contentEl.createEl("p", {
          text: stats.join("\uFF0C")
        });
        if (task.pauseRequested && task.running) {
          contentEl.createEl("p", {
            text: "\u5DF2\u6682\u505C\u540E\u7EED\u8BF7\u6C42\uFF0C\u7B49\u5F85\u505C\u6B62\u51B3\u5B9A\u3002"
          });
        } else if (task.stopRequested && task.running) {
          contentEl.createEl("p", {
            text: task.stopMode === "commit" ? "\u6B63\u5728\u4FDD\u5B58\u5DF2\u83B7\u53D6\u7ED3\u679C\u5E76\u505C\u6B62\u3002" : "\u6B63\u5728\u505C\u6B62\u5E76\u653E\u5F03\u672C\u6B21\u7ED3\u679C\u3002"
          });
        }
        const actions = contentEl.createDiv();
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";
        if (task.running) {
          const stopButton = actions.createEl("button", {
            text: "\u505C\u6B62\u540C\u6B65"
          });
          stopButton.onclick = () => {
            if (this.closeRequested) {
              return;
            }
            new RatingSyncStopModal(
              this.app,
              this.plugin,
              () => {
                this.closeRequested = true;
                this.allowClose = true;
                this.close();
              },
              () => {
                this.render();
              }
            ).open();
          };
        } else {
          const closeButton = actions.createEl("button", {
            text: "\u5173\u95ED"
          });
          closeButton.onclick = () => {
            this.allowClose = true;
            this.close();
          };
        }
      }
      onClose() {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        const task = this.getTask();
        if (task && task.running && !this.allowClose && !this.closeRequested && typeof this.onCloseRequest === "function") {
          this.closeRequested = true;
          this.onCloseRequest();
        }
        this.contentEl.empty();
      }
    };
    var RatingSyncCloseModal = class extends Modal2 {
      constructor(app, plugin, onBackground, onStop) {
        super(app);
        this.plugin = plugin;
        this.onBackground = onBackground;
        this.onStop = onStop;
        this.resolved = false;
      }
      resolve(action) {
        if (this.resolved) {
          return;
        }
        this.resolved = true;
        if (action === "background") {
          this.onBackground();
        } else {
          this.onStop();
        }
        this.close();
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", {
          text: "\u5173\u95ED\u8BC4\u5206\u540C\u6B65\u8FDB\u5EA6"
        });
        contentEl.createEl("p", {
          text: "\u540C\u6B65\u4EFB\u52A1\u4ECD\u5728\u8FD0\u884C\u3002\u8BF7\u9009\u62E9\u5173\u95ED\u7A97\u53E3\u540E\u7684\u5904\u7406\u65B9\u5F0F\u3002"
        });
        const actions = contentEl.createDiv();
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";
        const backgroundButton = actions.createEl("button", {
          text: "\u5173\u95ED\u7A97\u53E3\uFF0C\u540E\u53F0\u7EE7\u7EED"
        });
        const stopButton = actions.createEl("button", {
          text: "\u505C\u6B62\u540E\u7EED\u540C\u6B65"
        });
        backgroundButton.onclick = () => {
          this.resolve("background");
        };
        stopButton.onclick = () => {
          this.resolve("stop");
        };
      }
      onClose() {
        if (!this.resolved) {
          this.resolve("background");
          return;
        }
        this.contentEl.empty();
      }
    };
    var RatingSyncStopModal = class extends Modal2 {
      constructor(app, plugin, onClose, onContinue) {
        super(app);
        this.plugin = plugin;
        this.onCloseCallback = onClose;
        this.onContinue = onContinue;
        this.resolved = false;
      }
      onOpen() {
        this.plugin.ratingSync.pauseForDecision();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", {
          text: "\u505C\u6B62\u8BC4\u5206\u540C\u6B65"
        });
        contentEl.createEl("p", {
          text: "\u505C\u6B62\u540E\uFF0C\u5DF2\u7ECF\u53D6\u5F97\u7684\u7F51\u7EDC\u7ED3\u679C\u53EF\u4EE5\u4FDD\u5B58\uFF0C\u4E5F\u53EF\u4EE5\u5168\u90E8\u653E\u5F03\u3002"
        });
        const actions = contentEl.createDiv();
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.flexWrap = "wrap";
        actions.style.justifyContent = "flex-end";
        const continueButton = actions.createEl("button", {
          text: "\u7EE7\u7EED\u540C\u6B65"
        });
        const saveButton = actions.createEl("button", {
          text: "\u4FDD\u5B58\u5DF2\u83B7\u53D6\u7ED3\u679C\u5E76\u505C\u6B62"
        });
        const discardButton = actions.createEl("button", {
          text: "\u653E\u5F03\u672C\u6B21\u7ED3\u679C\u5E76\u505C\u6B62"
        });
        continueButton.onclick = () => {
          this.resolved = true;
          this.plugin.ratingSync.resumeAfterDecision();
          this.close();
          this.onContinue();
        };
        saveButton.onclick = () => {
          this.resolved = true;
          this.plugin.ratingSync.requestStop("commit");
          this.close();
        };
        discardButton.onclick = () => {
          this.resolved = true;
          this.plugin.ratingSync.requestStop("discard");
          this.close();
        };
      }
      onClose() {
        if (!this.resolved) {
          this.resolved = true;
          this.plugin.ratingSync.resumeAfterDecision();
          this.onContinue();
        }
        this.contentEl.empty();
      }
    };
    function openRatingSyncProgress(plugin, app) {
      const existing = plugin.ratingSync && plugin.ratingSync.getTask();
      if (existing && existing.running) {
        new RatingSyncProgressModal(
          app,
          plugin,
          () => {
            new RatingSyncCloseModal(
              app,
              plugin,
              () => {
              },
              () => {
                new RatingSyncStopModal(
                  app,
                  plugin,
                  () => {
                    new RatingSyncProgressModal(
                      app,
                      plugin,
                      () => {
                      }
                    ).open();
                  },
                  () => {
                    new RatingSyncProgressModal(
                      app,
                      plugin,
                      () => {
                      }
                    ).open();
                  }
                ).open();
              }
            ).open();
          }
        ).open();
        return;
      }
      const progress = new RatingSyncProgressModal(
        app,
        plugin,
        () => {
          new RatingSyncCloseModal(
            app,
            plugin,
            () => {
            },
            () => {
              new RatingSyncStopModal(
                app,
                plugin,
                () => {
                  new RatingSyncProgressModal(
                    app,
                    plugin,
                    () => {
                    }
                  ).open();
                },
                () => {
                  new RatingSyncProgressModal(
                    app,
                    plugin,
                    () => {
                    }
                  ).open();
                }
              ).open();
            }
          ).open();
        }
      );
      progress.open();
      plugin.ratingSync.start({
        forceRefresh: true,
        mode: "standard"
      }).then((task) => {
        new Notice(
          plugin.ratingSync.buildSummary(task),
          1e4
        );
      }).catch((error) => {
        console.error("\u8BC4\u5206\u540C\u6B65\u5931\u8D25:", error);
        new Notice(
          "\u8BC4\u5206\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0\u65E5\u5FD7\u3002",
          7e3
        );
      });
    }
    module2.exports = function createSettingsTabClass2({
      PluginSettingTab: PluginSettingTab2,
      Setting: Setting2,
      Notice: Notice3,
      Modal: Modal3,
      openSingleAnimeImport: openSingleAnimeImport2,
      openBatchAnimeImport: openBatchAnimeImport2,
      NetabaCompareSelectModal: NetabaCompareSelectModal2
    }) {
      const BangumiManagerSettingTab2 = class extends PluginSettingTab2 {
        constructor(app, plugin) {
          super(app, plugin);
          this.plugin = plugin;
        }
        display() {
          const container = this.containerEl;
          container.empty();
          container.createEl(
            "h2",
            {
              text: "Bangumi \u8FFD\u756A\u7BA1\u7406\u5668"
            }
          );
          if (this.plugin.settings.mode === "lazy") {
            this.displayLazyMode(container);
          } else {
            this.displayProfessionalMode(
              container
            );
          }
        }
        addIntroDescription(container, text) {
          const description = container.createEl(
            "p",
            {
              text
            }
          );
          description.style.marginTop = "8px";
          description.style.marginBottom = "18px";
          description.style.maxWidth = "760px";
          description.style.whiteSpace = "pre-line";
          description.style.lineHeight = "1.6";
          description.style.fontSize = "0.9em";
          description.style.color = "var(--text-muted)";
        }
        normalizeVaultFolderPath(value) {
          return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/[\\/]+$/, "");
        }
        getAutomaticBaseFolderPath() {
          const noteRootFolder = this.normalizeVaultFolderPath(
            this.plugin.settings.noteRootFolder
          );
          return noteRootFolder ? noteRootFolder + "/\u8FFD\u756A\u5E7F\u573A" : "\u8FFD\u756A\u5E7F\u573A";
        }
        getBaseFilePath() {
          const baseFolder = this.normalizeVaultFolderPath(
            this.plugin.settings.baseFolderPath || this.getAutomaticBaseFolderPath()
          );
          return baseFolder ? baseFolder + "/\u52A8\u753B\u5E93.base" : "\u52A8\u753B\u5E93.base";
        }
        async updateNoteRootFolder(value) {
          const noteRootFolder = this.normalizeVaultFolderPath(value);
          this.plugin.settings.noteRootFolder = noteRootFolder;
          if (this.plugin.settings.baseFolderPathManuallySet !== true) {
            this.plugin.settings.baseFolderPath = this.getAutomaticBaseFolderPath();
          }
          if (this.plugin.settings.dashboardPathManuallySet !== true) {
            this.plugin.settings.dashboardPath = this.plugin.getDefaultDashboardPath();
          }
          this.plugin.settings.baseFilePath = this.getBaseFilePath();
          await this.plugin.saveSettings();
        }
        async updateBaseFolderPath(value) {
          const baseFolderPath = this.normalizeVaultFolderPath(value);
          if (baseFolderPath) {
            this.plugin.settings.baseFolderPath = baseFolderPath;
            this.plugin.settings.baseFolderPathManuallySet = true;
          } else {
            this.plugin.settings.baseFolderPath = this.getAutomaticBaseFolderPath();
            this.plugin.settings.baseFolderPathManuallySet = false;
          }
          this.plugin.settings.baseFilePath = this.getBaseFilePath();
          await this.plugin.saveSettings();
        }
        addNoteRootSetting(container, description) {
          new Setting2(container).setName("\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55").setDesc(description).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.noteRootFolder || ""
              )
            );
            text.onChange(async (value) => {
              await this.updateNoteRootFolder(value);
            });
          });
        }
        addBaseFolderSetting(container) {
          new Setting2(container).setName("\u52A8\u753B\u5E93\u76EE\u5F55").setDesc(
            "\u586B\u5199\u52A8\u753B\u5E93\u6587\u4EF6\u6240\u5728\u7684\u76EE\u5F55\u3002\u63D2\u4EF6\u4F1A\u81EA\u52A8\u5728\u8FD9\u91CC\u521B\u5EFA\u201C\u52A8\u753B\u5E93.base\u201D\uFF0C\u65E0\u9700\u8F93\u5165\u6587\u4EF6\u540D\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.baseFolderPath || this.getAutomaticBaseFolderPath()
              )
            );
            text.onChange(async (value) => {
              await this.updateBaseFolderPath(value);
            });
          });
        }
        displayLazyMode(container) {
          this.addIntroDescription(
            container,
            "\u5FEB\u901F\u5F00\u59CB\u6A21\u5F0F\u4FDD\u7559\u9996\u6B21\u4F7F\u7528\u548C\u65E5\u5E38\u8FFD\u756A\u6240\u9700\u7684\u8BBE\u7F6E\u3002\u5176\u4ED6\u9AD8\u7EA7\u9009\u9879\u53EF\u5728\u4E13\u4E1A\u6A21\u5F0F\u4E2D\u8C03\u6574\uFF0C\u5207\u6362\u6A21\u5F0F\u4E0D\u4F1A\u4FEE\u6539\u5DF2\u6709\u914D\u7F6E\u3002"
          );
          new Setting2(container).setName("\u4F7F\u7528\u6A21\u5F0F").setDesc(
            "\u5FEB\u901F\u5F00\u59CB\u6A21\u5F0F\u4EC5\u663E\u793A\u5E38\u7528\u8BBE\u7F6E\u3002\u5207\u6362\u6A21\u5F0F\u53EA\u6539\u53D8\u8BBE\u7F6E\u9879\u5C55\u793A\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u5DF2\u6709\u914D\u7F6E\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              lazy: "\u5FEB\u901F\u5F00\u59CB\u6A21\u5F0F",
              professional: "\u4E13\u4E1A\u6A21\u5F0F"
            });
            dropdown.setValue("lazy");
            dropdown.onChange(async (value) => {
              this.plugin.settings.mode = value;
              await this.plugin.saveSettings();
              this.display();
            });
          });
          container.createEl("h3", {
            text: "\u5FEB\u901F\u5F00\u59CB"
          });
          new Setting2(container).setName("\u672C\u5730\u52A8\u753B\u6839\u76EE\u5F55").setDesc(
            "\u7528\u4E8E\u63D0\u793A\u548C\u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939\uFF0C\u4E0D\u4F1A\u79FB\u52A8\u5DF2\u6709\u89C6\u9891\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.localAnimeRoot || ""
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.localAnimeRoot = value.trim();
              await this.plugin.saveSettings();
            });
          });
          this.addBangumiUserSetting(container);
          this.addNoteRootSetting(
            container,
            "\u52A8\u753B\u7B14\u8BB0\u4FDD\u5B58\u4F4D\u7F6E\u3002\u52A8\u753B\u5E93\u548C Markdown \u4EEA\u8868\u76D8\u4F1A\u81EA\u52A8\u653E\u5728\u8BE5\u76EE\u5F55\u4E0B\u7684\u201C\u8FFD\u756A\u5E7F\u573A\u201D\u4E2D\u3002"
          );
          new Setting2(container).setName("\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6").setDesc(
            "\u521B\u5EFA\u7F3A\u5C11\u7684\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55\u3001\u5C01\u9762\u76EE\u5F55\u548C\u52A8\u753B\u5E93\u6587\u4EF6\u3002\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u88AB\u8986\u76D6\u3002"
          ).addButton((button) => {
            button.setButtonText("\u7ACB\u5373\u521D\u59CB\u5316");
            button.onClick(async () => {
              await this.plugin.initializeMissingFiles();
            });
          });
          this.addDashboardSettings(container, true);
          this.addNetabaSettings(container, true);
          container.createEl("h3", {
            text: "\u5FEB\u901F\u64CD\u4F5C"
          });
          new Setting2(container).setName("\u663E\u793A\u7BA1\u7406\u5165\u53E3").setDesc(
            "\u5F00\u542F\u540E\uFF0C\u5728 Obsidian \u5DE6\u4FA7\u663E\u793A\u7EDF\u4E00\u7684 Bangumi \u7BA1\u7406\u5165\u53E3\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              Boolean(
                this.plugin.settings.showManagerRibbon
              )
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showManagerRibbon = value;
              await this.plugin.saveSettings();
              this.plugin.refreshManagerRibbon();
            });
          });
          this.addLazyActions(container);
        }
        displayProfessionalMode(container) {
          this.addIntroDescription(
            container,
            "\u4E13\u4E1A\u6A21\u5F0F\u5C55\u793A\u5B8C\u6574\u8BBE\u7F6E\u3002\u8DEF\u5F84\u3001\u8BC4\u5206\u76D1\u6D4B\u3001\u4EEA\u8868\u76D8\u3001\u5B63\u5EA6\u89C6\u56FE\u3001\u7B14\u8BB0\u663E\u793A\u3001Netaba \u548C\u5168\u90E8\u7BA1\u7406\u64CD\u4F5C\u5747\u53EF\u5728\u8FD9\u91CC\u8C03\u6574\u3002\u5207\u6362\u6A21\u5F0F\u53EA\u6539\u53D8\u5C55\u793A\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u5DF2\u6709\u914D\u7F6E\u3002"
          );
          new Setting2(container).setName("\u4F7F\u7528\u6A21\u5F0F").setDesc(
            "\u4E13\u4E1A\u6A21\u5F0F\u663E\u793A\u5B8C\u6574\u914D\u7F6E\u9879\u3002\u5207\u6362\u6A21\u5F0F\u53EA\u6539\u53D8\u8BBE\u7F6E\u9879\u5C55\u793A\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u5DF2\u6709\u914D\u7F6E\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              lazy: "\u5FEB\u901F\u5F00\u59CB\u6A21\u5F0F",
              professional: "\u4E13\u4E1A\u6A21\u5F0F"
            });
            dropdown.setValue("professional");
            dropdown.onChange(async (value) => {
              this.plugin.settings.mode = value;
              await this.plugin.saveSettings();
              this.display();
            });
          });
          container.createEl("h3", {
            text: "\u8DEF\u5F84\u8BBE\u7F6E"
          });
          this.addNoteRootSetting(
            container,
            "\u626B\u63CF\u548C\u7BA1\u7406 Bangumi \u52A8\u753B\u7B14\u8BB0\u7684\u4ED3\u5E93\u76EE\u5F55\u3002"
          );
          this.addBaseFolderSetting(container);
          this.addPathSetting(
            container,
            "\u5C01\u9762\u76EE\u5F55",
            "coverFolder",
            "\u672C\u5730\u5C01\u9762\u4FDD\u5B58\u76EE\u5F55\u3002"
          );
          new Setting2(container).setName("\u672C\u5730\u52A8\u753B\u6839\u76EE\u5F55").setDesc(
            "\u7528\u4E8E\u63D0\u793A\u548C\u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939\uFF0C\u4E0D\u4F1A\u79FB\u52A8\u5DF2\u6709\u89C6\u9891\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.localAnimeRoot || ""
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.localAnimeRoot = value.trim();
              await this.plugin.saveSettings();
            });
          });
          this.addBangumiUserSetting(container);
          this.addBangumiSettings(container);
          container.createEl("h3", {
            text: "\u68C0\u67E5\u4E0E\u89C6\u56FE"
          });
          this.addCheckSettings(container);
          this.addSeasonSettings(container);
          this.addDisplaySettings(container);
          this.addDashboardSettings(container, false);
          this.addNetabaSettings(container, false);
          container.createEl("h3", {
            text: "\u7BA1\u7406\u5165\u53E3"
          });
          new Setting2(container).setName("\u663E\u793A\u7BA1\u7406\u5165\u53E3").setDesc(
            "\u5F00\u542F\u540E\uFF0C\u5728 Obsidian \u5DE6\u4FA7\u663E\u793A\u7EDF\u4E00\u7684 Bangumi \u7BA1\u7406\u5165\u53E3\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              Boolean(
                this.plugin.settings.showManagerRibbon
              )
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showManagerRibbon = value;
              await this.plugin.saveSettings();
              this.plugin.refreshManagerRibbon();
            });
          });
          container.createEl("h3", {
            text: "\u5FEB\u901F\u64CD\u4F5C"
          });
          this.addProfessionalActions(container);
        }
        addBangumiUserSetting(container) {
          new Setting2(container).setName("Bangumi \u7528\u6237 ID").setDesc(
            "\u7528\u4E8E\u6279\u91CF\u5BFC\u5165\u52A8\u753B\u3001\u6253\u5F00 Bangumi \u7528\u6237\u8BC4\u5206\u6392\u884C\u548C\u8BFB\u53D6\u7528\u6237\u8BC4\u5206\u3002\u5FEB\u901F\u5F00\u59CB\u6A21\u5F0F\u4E0B\u4F1A\u81EA\u52A8\u4F5C\u4E3A Netaba \u7528\u6237\u7F16\u53F7\u4F7F\u7528\u3002"
          ).addText((text) => {
            text.setPlaceholder("\u4F8B\u5982\uFF1A890645");
            text.setValue(
              String(
                this.plugin.settings.bangumiUserId || ""
              )
            );
            text.onChange(async (value) => {
              const userId = value.trim();
              if (userId && !/^\d+$/.test(userId)) {
                new Notice3(
                  "Bangumi \u7528\u6237 ID \u53EA\u80FD\u586B\u5199\u6570\u5B57\u3002",
                  5e3
                );
                return;
              }
              this.plugin.settings.bangumiUserId = userId;
              if (this.plugin.settings.netabaUserIdManuallySet !== true) {
                this.plugin.settings.netabaUserId = userId;
              }
              await this.plugin.saveSettings();
            });
          });
        }
        addDashboardSettings(container, compact) {
          container.createEl("h3", {
            text: "\u52A8\u753B\u4EEA\u8868\u76D8"
          });
          new Setting2(container).setName("\u6253\u5F00\u4E13\u5C5E\u4EEA\u8868\u76D8").setDesc(
            "\u5728\u63D2\u4EF6\u4E13\u5C5E\u9875\u9762\u4E2D\u6253\u5F00\u52A8\u753B\u4EEA\u8868\u76D8\uFF0C\u4E0D\u53D7\u9605\u8BFB\u6A21\u5F0F\u548C\u5B9E\u65F6\u9884\u89C8\u6A21\u5F0F\u5F71\u54CD\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6253\u5F00");
            button.onClick(async () => {
              await this.plugin.openScoreDashboardView();
            });
          });
          new Setting2(container).setName("\u6062\u590D\u4EEA\u8868\u76D8\u9ED8\u8BA4\u5E03\u5C40").setDesc(
            "\u6E05\u9664\u52A8\u753B\u4EEA\u8868\u76D8\u81EA\u5B9A\u4E49\u62D6\u62FD\u987A\u5E8F\u3001\u6298\u53E0\u548C\u9690\u85CF\u72B6\u6001\uFF0C\u6062\u590D\u9ED8\u8BA4\u667A\u80FD\u6392\u5E8F\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6062\u590D\u9ED8\u8BA4");
            button.onClick(async () => {
              await this.plugin.resetScoreDashboardLayout();
              this.display();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u4FA7\u8FB9\u680F\u4EEA\u8868\u76D8\u6309\u94AE").setDesc(
            "\u5728 Obsidian \u5DE6\u4FA7\u529F\u80FD\u680F\u663E\u793A\u52A8\u753B\u4EEA\u8868\u76D8\u56FE\u6807\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.showDashboardRibbon !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showDashboardRibbon = value;
              await this.plugin.saveSettings();
              this.plugin.refreshDashboardRibbon();
            });
          });
          new Setting2(container).setName("\u542F\u7528 Markdown \u4EEA\u8868\u76D8").setDesc(
            "\u5F00\u542F\u540E\u521B\u5EFA\u5E76\u7EF4\u62A4 Markdown \u4EEA\u8868\u76D8\u5FEB\u7167\uFF0C\u9002\u5408\u5BFC\u51FA\u3001\u94FE\u63A5\u548C\u9605\u8BFB\u6A21\u5F0F\u67E5\u770B\u3002\u5173\u95ED\u540E\u4E0D\u4F1A\u5220\u9664\u5DF2\u6709\u6587\u4EF6\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.markdownDashboardEnabled !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.markdownDashboardEnabled = value;
              await this.plugin.saveSettings();
              if (value) {
                await this.plugin.ensureScoreDashboard(
                  false
                );
              }
              this.display();
            });
          });
          if (compact) {
            return;
          }
          if (this.plugin.settings.markdownDashboardEnabled === false) {
            new Setting2(container).setName("\u6211\u7684\u8BC4\u5206\u6392\u540D\u663E\u793A\u6570\u91CF").setDesc(
              "\u4E13\u5C5E\u4EEA\u8868\u76D8\u4E2D\u201C\u6211\u7684\u8BC4\u5206\u6392\u540D\u201D\u9ED8\u8BA4\u663E\u793A\u7684\u52A8\u753B\u6570\u91CF\u3002"
            ).addText((text) => {
              text.setValue(
                String(
                  this.plugin.settings.dashboardPersonalRankLimit || 10
                )
              );
              text.onChange(async (value) => {
                this.plugin.settings.dashboardPersonalRankLimit = Math.max(
                  1,
                  Math.min(
                    50,
                    Number(value) || 10
                  )
                );
                await this.plugin.saveSettings();
              });
            });
            new Setting2(container).setName("BGM \u7528\u6237\u8BC4\u5206\u6392\u540D\u663E\u793A\u6570\u91CF").setDesc(
              "\u4E13\u5C5E\u4EEA\u8868\u76D8\u4E2D\u201CBGM \u7528\u6237\u8BC4\u5206\u6392\u540D\u201D\u9ED8\u8BA4\u663E\u793A\u7684\u52A8\u753B\u6570\u91CF\u3002"
            ).addText((text) => {
              text.setValue(
                String(
                  this.plugin.settings.dashboardBangumiRankLimit || 10
                )
              );
              text.onChange(async (value) => {
                this.plugin.settings.dashboardBangumiRankLimit = Math.max(
                  1,
                  Math.min(
                    50,
                    Number(value) || 10
                  )
                );
                await this.plugin.saveSettings();
              });
            });
            return;
          }
          new Setting2(container).setName("Markdown \u4EEA\u8868\u76D8\u8DEF\u5F84").setDesc(
            "Markdown \u4EEA\u8868\u76D8\u5FEB\u7167\u7684\u4ED3\u5E93\u8DEF\u5F84\u3002\u6587\u4EF6\u540D\u4F1A\u81EA\u52A8\u8865\u5168\u4E3A .md\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.dashboardPath || this.plugin.getDefaultDashboardPath()
              )
            );
            text.onChange(async (value) => {
              const input = String(value || "").trim().replace(/\\/g, "/");
              if (input) {
                this.plugin.settings.dashboardPath = input.endsWith(".md") ? input : input + ".md";
                this.plugin.settings.dashboardPathManuallySet = true;
              } else {
                this.plugin.settings.dashboardPath = this.plugin.getDefaultDashboardPath();
                this.plugin.settings.dashboardPathManuallySet = false;
              }
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u6253\u5F00 Markdown \u4EEA\u8868\u76D8").setDesc(
            "\u6253\u5F00 Markdown \u4EEA\u8868\u76D8\u5FEB\u7167\u3002\u56FE\u8868\u5185\u5BB9\u9700\u8981\u5728\u9605\u8BFB\u6A21\u5F0F\u4E2D\u663E\u793A\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6253\u5F00");
            button.onClick(async () => {
              await this.plugin.openScoreDashboard();
            });
          });
          new Setting2(container).setName("\u91CD\u5EFA Markdown \u4EEA\u8868\u76D8").setDesc(
            "\u6062\u590D Markdown \u4EEA\u8868\u76D8\u7684\u6807\u51C6\u5185\u5BB9\u3002\u6B64\u64CD\u4F5C\u4F1A\u8986\u76D6\u8BE5\u7B14\u8BB0\u4E2D\u7684\u81EA\u5B9A\u4E49\u6587\u5B57\u3002"
          ).addButton((button) => {
            button.setButtonText("\u91CD\u5EFA");
            button.onClick(async () => {
              await this.plugin.ensureScoreDashboard(true);
              new Notice3(
                "Markdown \u4EEA\u8868\u76D8\u5DF2\u91CD\u5EFA\u3002",
                5e3
              );
            });
          });
          new Setting2(container).setName("\u81EA\u52A8\u5237\u65B0 Markdown \u4EEA\u8868\u76D8").setDesc(
            "\u540E\u53F0\u8BC4\u5206\u76D1\u6D4B\u548C\u8BC4\u5206\u663E\u793A\u5237\u65B0\u5B8C\u6210\u540E\uFF0C\u81EA\u52A8\u66F4\u65B0 Markdown \u4EEA\u8868\u76D8\u5FEB\u7167\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardAutoRefresh !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardAutoRefresh = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u5237\u65B0 Markdown \u4EEA\u8868\u76D8").setDesc(
            "\u7ACB\u5373\u66F4\u65B0 Markdown \u4EEA\u8868\u76D8\u5FEB\u7167\u3002"
          ).addButton((button) => {
            button.setButtonText("\u5237\u65B0");
            button.onClick(async () => {
              await this.plugin.refreshScoreDashboard(true);
              new Notice3(
                "Markdown \u4EEA\u8868\u76D8\u5DF2\u5237\u65B0\u3002",
                4e3
              );
            });
          });
          new Setting2(container).setName("\u6211\u7684\u8BC4\u5206\u6392\u540D\u663E\u793A\u6570\u91CF").setDesc(
            "\u4E13\u5C5E\u4EEA\u8868\u76D8\u548C Markdown \u4EEA\u8868\u76D8\u4E2D\u201C\u6211\u7684\u8BC4\u5206\u6392\u540D\u201D\u9ED8\u8BA4\u663E\u793A\u7684\u52A8\u753B\u6570\u91CF\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.dashboardPersonalRankLimit || 10
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.dashboardPersonalRankLimit = Math.max(
                1,
                Math.min(
                  50,
                  Number(value) || 10
                )
              );
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("BGM \u7528\u6237\u8BC4\u5206\u6392\u540D\u663E\u793A\u6570\u91CF").setDesc(
            "\u4E13\u5C5E\u4EEA\u8868\u76D8\u548C Markdown \u4EEA\u8868\u76D8\u4E2D\u201CBGM \u7528\u6237\u8BC4\u5206\u6392\u540D\u201D\u9ED8\u8BA4\u663E\u793A\u7684\u52A8\u753B\u6570\u91CF\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.dashboardBangumiRankLimit || 10
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.dashboardBangumiRankLimit = Math.max(
                1,
                Math.min(
                  50,
                  Number(value) || 10
                )
              );
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u6211\u7684\u8BC4\u5206\u5206\u5E03").setDesc(
            "\u6309 0\u20132\u30013\u20134\u30015\u20136\u30017\u20138\u30019\u201310 \u5206\u533A\u95F4\u663E\u793A\u6211\u7684\u8BC4\u5206\u5206\u5E03\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowDistribution !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowDistribution = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u89C2\u770B\u72B6\u6001\u7EDF\u8BA1").setDesc(
            "\u663E\u793A\u5DF2\u770B\u3001\u5728\u770B\u3001\u60F3\u770B\u548C\u629B\u5F03\u52A8\u753B\u7684\u6570\u91CF\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowWatchState !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowWatchState = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u8FFD\u756A\u5168\u666F\u4E0E\u65F6\u957F\u7EDF\u8BA1").setDesc("\u7EDF\u8BA1\u7D2F\u8BA1\u89C2\u770B\u8BDD\u6570\u3001\u8FFD\u756A\u6295\u5165\u65F6\u957F\u4F30\u7B97\u4EE5\u53CA\u5404\u89C2\u770B\u72B6\u6001\u5F69\u5E26\u5206\u5E03\u3002").addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowProgressStats !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowProgressStats = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u5E74\u4EE3\u4E0E\u756A\u5B63\u5206\u5E03").setDesc("\u6309\u5F00\u64AD\u5E74\u4EFD\u6536\u5F55\u67F1\u72B6\u56FE\u4E0E\u56DB\u5927\u756A\u5B63\uFF081\u6708/4\u6708/7\u6708/10\u6708\uFF09\u6536\u5F55\u60C5\u51B5\u7EDF\u8BA1\u3002").addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowYearStats !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowYearStats = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u8BC4\u5206\u5DEE\u5F02\u4E0E\u504F\u597D\u5206\u6790").setDesc("\u5BF9\u6BD4\u4E2A\u4EBA\u8BC4\u5206\u4E0E Bangumi \u5927\u4F17\u8BC4\u5206\u5DEE\u5F02\uFF08\u0394\uFF09\uFF0C\u5C55\u793A\u4E2A\u4EBA\u6700\u504F\u7231\u4E0E\u6700\u4E25\u82DB\u4F5C\u54C1\u699C\u5355\u3002").addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowScoreDelta !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowScoreDelta = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u5236\u4F5C\u516C\u53F8\u4E0E\u6539\u7F16\u7C7B\u578B").setDesc("\u7EDF\u8BA1\u5404\u5927\u52A8\u753B\u5236\u4F5C\u516C\u53F8\u6536\u5F55\u6570\u4E0E\u5E73\u5747\u5206\uFF0C\u4EE5\u53CA\u539F\u4F5C\u7C7B\u578B\uFF08\u539F\u521B/\u6F2B\u6539/\u8F7B\u6539/\u6E38\u620F\u6539\u7B49\uFF09\u5206\u5E03\u3002").addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowStudioStats !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowStudioStats = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u81EA\u5B9A\u4E49\u67E5\u8BE2\u5206\u533A").setDesc("\u6839\u636E\u6807\u7B7E\u3001\u72B6\u6001\u3001\u8BC4\u5206\u95E8\u69DB\u53CA\u5E74\u4EE3\u521B\u5EFA\u4E2A\u6027\u5316\u7684\u52A8\u6001\u805A\u5408\u5206\u533A\u3002").addButton((btn) => {
            btn.setButtonText("+ \u65B0\u5EFA\u67E5\u8BE2\u5206\u533A").setCta().onClick(() => {
              this.plugin.openCustomQuerySectionModal(null, () => {
                this.display();
              });
            });
          });
          const customSections = Array.isArray(this.plugin.settings.customQuerySections) ? this.plugin.settings.customQuerySections : [];
          if (customSections.length > 0) {
            for (const section of customSections) {
              const descParts = [];
              if (section.tag) descParts.push(`\u6807\u7B7E: ${section.tag}`);
              if (section.watchStatus && section.watchStatus !== "all") descParts.push(`\u72B6\u6001: ${section.watchStatus}`);
              if (section.minMyScore) descParts.push(`\u4E2A\u4EBA\u8BC4\u5206\u2265${section.minMyScore}`);
              if (section.minBgmScore) descParts.push(`BGM\u8BC4\u5206\u2265${section.minBgmScore}`);
              if (section.year) descParts.push(`\u5E74\u4EFD: ${section.year}`);
              if (section.season) descParts.push(`\u5B63\u5EA6: ${section.season}`);
              descParts.push(section.displayMode === "grid" ? "\u6D77\u62A5\u7F51\u683C" : "\u699C\u5355\u5217\u8868");
              const limitText = Number(section.limit) > 0 ? `${section.limit}\u90E8` : "\u5168\u90E8";
              descParts.push(`\u4E0A\u9650: ${limitText}`);
              new Setting2(container).setName(section.title).setDesc(descParts.join(" | ")).addButton((btn) => {
                btn.setButtonText("\u7F16\u8F91").onClick(() => {
                  this.plugin.openCustomQuerySectionModal(section, () => {
                    this.display();
                  });
                });
              }).addButton((btn) => {
                btn.setButtonText("\u5220\u9664").setWarning().onClick(() => {
                  this.plugin.confirmDeleteCustomQuerySection(section, () => {
                    this.display();
                  });
                });
              });
            }
          }
          new Setting2(container).setName("\u81EA\u5B9A\u4E49\u6536\u85CF\u5C55\u67DC").setDesc("\u624B\u52A8\u6311\u9009\u5E76\u7F16\u6392\u5FC3\u7231\u4F5C\u54C1\u7684\u4E13\u5C5E\u5C55\u67DC\uFF0C\u652F\u6301\u81EA\u5B9A\u4E49\u6392\u5E8F\u4E0E\u5C55\u793A\u5F62\u6001\u3002").addButton((btn) => {
            btn.setButtonText("+ \u65B0\u5EFA\u6536\u85CF\u5C55\u67DC").setCta().onClick(() => {
              this.plugin.openCustomCollectionModal(null, () => {
                this.display();
              });
            });
          });
          const collectionSections = Array.isArray(this.plugin.settings.customCollectionSections) ? this.plugin.settings.customCollectionSections : [];
          if (collectionSections.length > 0) {
            for (const col of collectionSections) {
              const itemCount = Array.isArray(col.items) ? col.items.length : 0;
              const modeText = col.displayMode === "list" ? "\u699C\u5355\u5217\u8868" : "\u6D77\u62A5\u7F51\u683C";
              new Setting2(container).setName(col.title).setDesc(`\u6536\u5F55: ${itemCount} \u90E8 | \u5C55\u793A\u5F62\u6001: ${modeText}`).addButton((btn) => {
                btn.setButtonText("\u7BA1\u7406\u6761\u76EE").onClick(() => {
                  this.plugin.openCollectionItemsManagerModal(col, () => {
                    this.display();
                  });
                });
              }).addButton((btn) => {
                btn.setButtonText("\u7F16\u8F91").onClick(() => {
                  this.plugin.openCustomCollectionModal(col, () => {
                    this.display();
                  });
                });
              }).addButton((btn) => {
                btn.setButtonText("\u5220\u9664").setWarning().onClick(() => {
                  this.plugin.confirmDeleteCustomCollection(col, () => {
                    this.display();
                  });
                });
              });
            }
          }
        }
        async promptForScoreDataRefresh() {
          const noteCount = await this.plugin.countBangumiNotesForScoreRefresh();
          if (noteCount === 0) {
            return {
              action: "none",
              noteCount
            };
          }
          const promptMode = this.plugin.settings.ratingRefreshPromptMode === "later" || this.plugin.settings.ratingRefreshPromptMode === "update" ? this.plugin.settings.ratingRefreshPromptMode : "ask";
          if (promptMode !== "ask") {
            return {
              action: promptMode,
              noteCount
            };
          }
          const decision = await new Promise((resolve) => {
            new ScoreDataRefreshPromptModal(
              this.app,
              noteCount,
              resolve
            ).open();
          });
          if (decision.disableFuturePrompts) {
            const rememberedMode = decision.action === "update" ? "update" : "later";
            this.plugin.settings.ratingRefreshPromptMode = rememberedMode;
            this.plugin.settings.ratingRefreshPromptDisabled = true;
            await this.plugin.saveSettings();
          }
          return {
            action: decision.action,
            noteCount
          };
        }
        async refreshEnabledScoreDataAfterSettingChange() {
          const decision = await this.promptForScoreDataRefresh();
          if (decision.action !== "update") {
            return;
          }
          const summary = await this.plugin.refreshPreciseRatingsSilently(true);
          new Notice3(
            "\u8BC4\u5206\u6570\u636E\u66F4\u65B0\u5B8C\u6210\uFF1A\u626B\u63CF " + summary.scanned + " \u7BC7\uFF0C\u8BF7\u6C42 " + summary.requested + " \u7BC7\uFF0C\u7CBE\u786E\u8BC4\u5206\u66F4\u65B0 " + summary.preciseUpdated + " \u7BC7\uFF0C\u5199\u5165\u7B14\u8BB0 " + summary.notesUpdated + " \u7BC7\uFF0C\u65E0\u6570\u636E " + summary.noData + " \u7BC7\uFF0C\u5931\u8D25 " + summary.failed + " \u7BC7\u3002",
            9e3
          );
        }
        async saveAndSynchronizeNoteScores() {
          await this.plugin.saveSettings();
          return await this.plugin.refreshScoreDisplayFields();
        }
        async saveAndRefreshDashboard() {
          await this.plugin.saveSettings();
          await this.plugin.refreshScoreDashboard(true);
        }
        addScoreSectionTitle(container, text) {
          const heading = container.createEl("h4", {
            text
          });
          heading.style.marginTop = "24px";
          heading.style.marginBottom = "8px";
          heading.style.fontSize = "1em";
          heading.style.fontWeight = "700";
        }
        addBangumiSettings(container) {
          container.createEl("h3", {
            text: "\u8BC4\u5206\u4E0E\u6392\u540D"
          });
          const intro = container.createEl("p", {
            text: "\u7B14\u8BB0\u8BC4\u5206\u63A7\u5236\u52A8\u753B\u7B14\u8BB0\u7684\u5C5E\u6027\u533A\u548C\u6B63\u6587\uFF1B\u4EEA\u8868\u76D8\u9009\u9879\u53EA\u5F71\u54CD\u52A8\u753B\u4EEA\u8868\u76D8\uFF1B\u6570\u636E\u66F4\u65B0\u63A7\u5236\u4F55\u65F6\u8BBF\u95EE\u8BC4\u5206\u6570\u636E\u6765\u6E90\u3002"
          });
          intro.style.marginTop = "6px";
          intro.style.marginBottom = "14px";
          intro.style.color = "var(--text-muted)";
          intro.style.fontSize = "0.9em";
          intro.style.lineHeight = "1.6";
          this.addScoreSectionTitle(
            container,
            "\u7B14\u8BB0\u8BC4\u5206"
          );
          new Setting2(container).setName("\u663E\u793A BGM \u7528\u6237\u8BC4\u5206").setDesc(
            "\u5728\u52A8\u753B\u7B14\u8BB0\u7684\u5C5E\u6027\u533A\u548C\u6B63\u6587\u4E2D\u663E\u793A\u4F60\u7684 Bangumi \u8BC4\u5206\u3002\u5173\u95ED\u540E\u4F1A\u4ECE\u7B14\u8BB0\u9690\u85CF\u8BE5\u9879\uFF0C\u4F46\u4E0D\u4F1A\u5F71\u54CD Bangumi \u7F51\u7AD9\u4E0A\u7684\u8BC4\u5206\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.showBangumiUserScore !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showBangumiUserScore = value;
              await this.plugin.saveSettings();
              await this.plugin.refreshScoreFields();
            });
          });
          new Setting2(container).setName("\u663E\u793A\u6211\u7684\u8BC4\u5206").setDesc(
            "\u5728\u52A8\u753B\u7B14\u8BB0\u7684\u5C5E\u6027\u533A\u548C\u6B63\u6587\u4E2D\u663E\u793A\u53EF\u7F16\u8F91\u7684\u201C\u6211\u7684\u8BC4\u5206\u201D\u3002\u5B83\u53EA\u7531\u5F53\u524D\u7B14\u8BB0\u4E2D\u586B\u5199\u7684\u5185\u5BB9\u51B3\u5B9A\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u4ECE Bangumi \u8BFB\u53D6\u6216\u8986\u76D6\uFF1B\u5173\u95ED\u540E\u4F1A\u9690\u85CF\uFF0C\u91CD\u65B0\u5F00\u542F\u540E\u6062\u590D\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.showPersonalScore !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showPersonalScore = value;
              await this.plugin.saveSettings();
              await this.plugin.refreshScoreFields();
            });
          });
          new Setting2(container).setName("\u4F7F\u7528\u7CBE\u786E BGM\u8BC4\u5206").setDesc(
            "\u5F00\u542F\u540E\uFF0C\u7B14\u8BB0\u4E2D\u7684\u552F\u4E00\u201CBGM\u8BC4\u5206\u201D\u6539\u4E3A\u7CBE\u786E\u8BC4\u5206\uFF1B\u5173\u95ED\u540E\u6062\u590D\u666E\u901A Bangumi \u9875\u9762\u8BC4\u5206\u3002\u4E0D\u4F1A\u521B\u5EFA\u201CBGM\u7CBE\u786E\u8BC4\u5206\u201D\u5C5E\u6027\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.showBangumiPreciseScore === true
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.showBangumiPreciseScore = value;
              await this.saveAndSynchronizeNoteScores();
              if (value) {
                await this.refreshEnabledScoreDataAfterSettingChange();
              }
            });
          });
          new Setting2(container).setName("\u7CBE\u786E BGM\u8BC4\u5206\u663E\u793A\u5C0F\u6570\u4F4D\u6570").setDesc(
            "\u4EC5\u5728\u542F\u7528\u7CBE\u786E BGM\u8BC4\u5206\u540E\u5F71\u54CD\u7B14\u8BB0\u6B63\u6587\u548C\u7CBE\u786E\u8BC4\u5206\u6392\u540D\u7684\u663E\u793A\u3002\u539F\u59CB\u8BC4\u5206\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              "1": "1 \u4F4D\u5C0F\u6570",
              "2": "2 \u4F4D\u5C0F\u6570",
              "4": "4 \u4F4D\u5C0F\u6570"
            });
            dropdown.setValue(
              String(
                this.plugin.settings.bangumiPreciseScoreDisplayDigits || 4
              )
            );
            dropdown.onChange(async (value) => {
              this.plugin.settings.bangumiPreciseScoreDisplayDigits = Number(value);
              await this.saveAndSynchronizeNoteScores();
            });
          });
          this.addScoreSectionTitle(
            container,
            "\u4EEA\u8868\u76D8"
          );
          new Setting2(container).setName("\u663E\u793A\u7CBE\u786E\u8BC4\u5206\u6392\u540D").setDesc(
            "\u5728\u52A8\u753B\u4EEA\u8868\u76D8\u4E2D\u663E\u793A\u6309\u7CBE\u786E BGM\u8BC4\u5206\u6392\u5E8F\u7684\u6392\u540D\u3002\u6B64\u9879\u4E0D\u6539\u53D8\u7B14\u8BB0\u5C5E\u6027\u6216\u6B63\u6587\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.dashboardShowPreciseRank === true
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.dashboardShowPreciseRank = value;
              await this.saveAndRefreshDashboard();
              if (value) {
                await this.refreshEnabledScoreDataAfterSettingChange();
              }
            });
          });
          new Setting2(container).setName("\u8BC4\u5206\u8BBE\u7F6E\u53D8\u66F4\u540E\u7684\u5904\u7406\u65B9\u5F0F").setDesc(
            "\u5F00\u542F\u7CBE\u786E\u8BC4\u5206\u8BBE\u7F6E\u65F6\u7684\u9ED8\u8BA4\u884C\u4E3A\u3002\u53EF\u4EE5\u5728\u8FD9\u91CC\u6539\u56DE\u201C\u6BCF\u6B21\u8BE2\u95EE\u201D\uFF0C\u8986\u76D6\u4E4B\u524D\u8BB0\u4F4F\u7684\u9009\u62E9\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              ask: "\u6BCF\u6B21\u8BE2\u95EE",
              later: "\u81EA\u52A8\u7A0D\u540E\u66F4\u65B0",
              update: "\u81EA\u52A8\u7ACB\u5373\u66F4\u65B0"
            });
            const currentMode = this.plugin.settings.ratingRefreshPromptMode === "later" || this.plugin.settings.ratingRefreshPromptMode === "update" ? this.plugin.settings.ratingRefreshPromptMode : "ask";
            dropdown.setValue(currentMode);
            dropdown.onChange(async (value) => {
              const nextMode = value === "later" || value === "update" ? value : "ask";
              this.plugin.settings.ratingRefreshPromptMode = nextMode;
              this.plugin.settings.ratingRefreshPromptDisabled = nextMode !== "ask";
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u81EA\u52A8\u66F4\u65B0\u8BC4\u5206\u4E0E\u6392\u540D\u6570\u636E").setDesc(
            "\u5F00\u542F\u540E\uFF0C\u63D2\u4EF6\u4F1A\u6309\u4E0B\u65B9\u95F4\u9694\u81EA\u52A8\u66F4\u65B0 BGM \u7528\u6237\u8BC4\u5206\u3001\u666E\u901A BGM\u8BC4\u5206\uFF0C\u4EE5\u53CA\u5F53\u524D\u542F\u7528\u7684\u7CBE\u786E\u8BC4\u5206\u548C\u4EEA\u8868\u76D8\u6392\u540D\u3002\u5173\u95ED\u540E\u505C\u6B62\u540E\u53F0\u8BF7\u6C42\uFF0C\u624B\u52A8\u66F4\u65B0\u4ECD\u53EF\u4F7F\u7528\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.ratingMonitorEnabled !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.ratingMonitorEnabled = value;
              await this.plugin.saveSettings();
              this.display();
            });
          });
          new Setting2(container).setName("\u8BC4\u5206\u6570\u636E\u66F4\u65B0\u95F4\u9694").setDesc(
            "\u5355\u4F4D\u4E3A\u79D2\uFF0C\u9ED8\u8BA4 900 \u79D2\u3002\u81EA\u52A8\u66F4\u65B0\u5F00\u542F\u65F6\u751F\u6548\uFF1B\u52A8\u753B\u8F83\u591A\u65F6\u4E0D\u5EFA\u8BAE\u8BBE\u7F6E\u8FC7\u77ED\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.ratingMonitorSeconds || 900
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.ratingMonitorSeconds = Math.max(
                60,
                Number(value) || 900
              );
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u7ACB\u5373\u66F4\u65B0\u8BC4\u5206\u6570\u636E").setDesc(
            "\u8BFB\u53D6\u666E\u901A BGM\u8BC4\u5206\u3001BGM \u7528\u6237\u8BC4\u5206\uFF0C\u4EE5\u53CA\u5F53\u524D\u542F\u7528\u7684\u7CBE\u786E\u8BC4\u5206\u3002\u540C\u6B65\u8FC7\u7A0B\u4E2D\u53EF\u4EE5\u5173\u95ED\u7A97\u53E3\u5E76\u8BA9\u4EFB\u52A1\u5728\u540E\u53F0\u7EE7\u7EED\u3002"
          ).addButton((button) => {
            button.setButtonText("\u7ACB\u5373\u66F4\u65B0");
            button.onClick(() => {
              openRatingSyncProgress(
                this.plugin,
                this.app
              );
            });
          });
          new Setting2(container).setName("\u67E5\u770B\u8BC4\u5206\u540C\u6B65\u72B6\u6001").setDesc(
            "\u91CD\u65B0\u6253\u5F00\u5F53\u524D\u8BC4\u5206\u540C\u6B65\u4EFB\u52A1\u7684\u8FDB\u5EA6\u7A97\u53E3\u3002\u6CA1\u6709\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1\u65F6\u4E0D\u4F1A\u6267\u884C\u64CD\u4F5C\u3002"
          ).addButton((button) => {
            button.setButtonText("\u67E5\u770B\u72B6\u6001");
            button.onClick(() => {
              const task = this.plugin.ratingSync && this.plugin.ratingSync.getTask();
              if (!task || !task.running) {
                new Notice3(
                  "\u5F53\u524D\u6CA1\u6709\u6B63\u5728\u8FD0\u884C\u7684\u8BC4\u5206\u540C\u6B65\u4EFB\u52A1\u3002",
                  5e3
                );
                return;
              }
              openRatingSyncProgress(
                this.plugin,
                this.app
              );
            });
          });
          new Setting2(container).setName("\u5237\u65B0\u7B14\u8BB0\u4E2D\u7684\u8BC4\u5206\u663E\u793A").setDesc(
            "\u4E0D\u8BBF\u95EE\u7F51\u7EDC\u3002\u6309\u5F53\u524D\u5F00\u5173\u548C\u5C0F\u6570\u4F4D\u6570\u91CD\u6392\u8BC4\u5206\u5C5E\u6027\uFF0C\u5E76\u91CD\u5EFA\u7B14\u8BB0\u6B63\u6587\u4E2D\u7684\u8BC4\u5206\u884C\u3002"
          ).addButton((button) => {
            button.setButtonText("\u5237\u65B0\u663E\u793A");
            button.onClick(async () => {
              button.setDisabled(true);
              try {
                const summary = await this.plugin.refreshScoreDisplayFields();
                new Notice3(
                  "\u8BC4\u5206\u663E\u793A\u5DF2\u5237\u65B0\uFF1A\u626B\u63CF " + summary.scanned + " \u7BC7\uFF0C\u66F4\u65B0 " + summary.updated + " \u7BC7\uFF0C\u5931\u8D25 " + summary.failed + " \u7BC7\u3002",
                  7e3
                );
              } catch (error) {
                console.error(
                  "\u5237\u65B0\u8BC4\u5206\u663E\u793A\u5931\u8D25:",
                  error
                );
                new Notice3(
                  "\u5237\u65B0\u8BC4\u5206\u663E\u793A\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63A7\u5236\u53F0\u65E5\u5FD7\u3002",
                  6e3
                );
              } finally {
                button.setDisabled(false);
              }
            });
          });
        }
        addCheckSettings(container) {
          new Setting2(container).setName("\u540E\u53F0\u68C0\u67E5\u95F4\u9694").setDesc(
            this.plugin.settings.mode === "lazy" ? "\u63D2\u4EF6\u901A\u5E38\u4F1A\u81EA\u52A8\u68C0\u67E5\uFF1B\u8FD9\u91CC\u53EF\u4EE5\u8C03\u6574\u81EA\u52A8\u68C0\u67E5\u95F4\u9694\u3002" : "\u63D2\u4EF6\u542F\u52A8\u540E\u3001\u4FDD\u5B58\u76EE\u6807\u7B14\u8BB0\u540E\u4EE5\u53CA\u6309\u7167\u6B64\u95F4\u9694\u81EA\u52A8\u68C0\u67E5\u672C\u5730\u89C6\u9891\u3002"
          ).addText((text) => {
            text.setValue(
              String(
                this.plugin.settings.checkIntervalSeconds
              )
            );
            text.onChange(async (value) => {
              this.plugin.settings.checkIntervalSeconds = Math.max(
                10,
                Number(value) || 60
              );
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u542F\u52A8\u65F6\u81EA\u52A8\u68C0\u67E5").setDesc(
            this.plugin.settings.mode === "lazy" ? "\u6253\u5F00 Obsidian \u540E\u81EA\u52A8\u68C0\u67E5\u4E00\u6B21\u3002" : "\u63D2\u4EF6\u52A0\u8F7D\u7EA6 5 \u79D2\u540E\u68C0\u67E5\u5168\u90E8\u76EE\u6807\u7B14\u8BB0\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.checkOnStartup
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.checkOnStartup = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u4FDD\u5B58\u7B14\u8BB0\u65F6\u81EA\u52A8\u68C0\u67E5").setDesc(
            this.plugin.settings.mode === "lazy" ? "\u4FDD\u5B58\u52A8\u753B\u7B14\u8BB0\u540E\u81EA\u52A8\u66F4\u65B0\u672C\u5730\u72B6\u6001\u3002" : "\u4FEE\u6539\u76EE\u6807\u76EE\u5F55\u4E2D\u7684\u52A8\u753B\u7B14\u8BB0\u540E\uFF0C\u5EF6\u8FDF\u7EA6 1 \u79D2\u68C0\u67E5\u8BE5\u7B14\u8BB0\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.checkOnSave
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.checkOnSave = value;
              await this.plugin.saveSettings();
            });
          });
        }
        addSeasonSettings(container) {
          new Setting2(container).setName("\u5B63\u5EA6\u89C6\u56FE\u7B56\u7565").setDesc(
            this.plugin.settings.mode === "lazy" ? "\u9ED8\u8BA4\u4E0D\u81EA\u52A8\u589E\u52A0\u5B63\u5EA6\u89C6\u56FE\uFF1B\u9700\u8981\u65F6\u70B9\u51FB\u201C\u751F\u6210\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE\u201D\u3002" : "\u53EA\u65B0\u589E\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u5DF2\u6709\u89C6\u56FE\uFF1B\u201C\u5168\u90E8\u52A8\u753B\u201D\u59CB\u7EC8\u4FDD\u7559\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              none: "\u4E0D\u81EA\u52A8\u521B\u5EFA",
              current: "\u53EA\u81EA\u52A8\u521B\u5EFA\u5F53\u524D\u5B63\u5EA6",
              all: "\u81EA\u52A8\u521B\u5EFA\u5168\u90E8\u7F3A\u5931\u5B63\u5EA6"
            });
            dropdown.setValue(
              this.plugin.settings.seasonViewMode || "none"
            );
            dropdown.onChange(async (value) => {
              this.plugin.settings.seasonViewMode = value;
              await this.plugin.saveSettings();
            });
          });
        }
        addDisplaySettings(container) {
          container.createEl("h3", {
            text: "\u7B14\u8BB0\u663E\u793A\u65B9\u5F0F"
          });
          new Setting2(container).setName("\u65B0\u5EFA\u7B14\u8BB0\u65F6\u9ED8\u8BA4\u6536\u8D77\u52A8\u753B\u4FE1\u606F").setDesc(
            "\u5F00\u542F\u540E\uFF0C\u65B0\u521B\u5EFA\u7684\u52A8\u753B\u7B14\u8BB0\u4F1A\u9ED8\u8BA4\u6536\u8D77\u4E0A\u65B9\u7684\u52A8\u753B\u4FE1\u606F\u533A\u57DF\u3002\u5DF2\u6709\u7B14\u8BB0\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              Boolean(
                this.plugin.settings.animeInfoCollapsedByDefault
              )
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.animeInfoCollapsedByDefault = value;
              await this.plugin.saveSettings();
            });
          });
        }
        addNetabaSettings(container, compact) {
          container.createEl("h3", {
            text: "Netaba \u8BC4\u5206\u56FE"
          });
          if (compact) {
            const inheritedUserId = this.plugin.settings.netabaUserId || this.plugin.settings.bangumiUserId || "";
            new Setting2(container).setName("Bangumi \u7528\u6237\u7F16\u53F7").setDesc(
              inheritedUserId ? "\u5F53\u524D\u4F7F\u7528 Bangumi \u7528\u6237 ID\uFF1A" + inheritedUserId + "\u3002\u53EF\u5728\u4E13\u4E1A\u6A21\u5F0F\u4E2D\u5355\u72EC\u8BBE\u7F6E\u3002" : "\u9ED8\u8BA4\u4F7F\u7528 Bangumi \u7528\u6237 ID\u3002\u53EF\u5728\u4E13\u4E1A\u6A21\u5F0F\u4E2D\u5355\u72EC\u8BBE\u7F6E\u3002"
            );
            new Setting2(container).setName("\u65B0\u5EFA\u7B14\u8BB0\u4E2D\u7684 Netaba \u9ED8\u8BA4\u9875\u9762").setDesc(
              "\u53EA\u5F71\u54CD\u4EE5\u540E\u65B0\u5EFA\u7684\u52A8\u753B\u7B14\u8BB0\u3002"
            ).addDropdown((dropdown) => {
              dropdown.addOptions({
                subject: "\u5F53\u524D\u52A8\u753B\u9875\u9762",
                season: "\u5F53\u5B63\u52A8\u753B",
                trending: "\u8BC4\u5206\u8D8B\u52BF",
                history: "\u5386\u53F2\u5206\u5E03",
                user: "\u4E2A\u4EBA\u8BC4\u5206",
                compare: "\u52A8\u753B\u5BF9\u6BD4"
              });
              dropdown.setValue(
                this.plugin.settings.netabaDefaultPage || "subject"
              );
              dropdown.onChange(async (value) => {
                this.plugin.settings.netabaDefaultPage = value;
                await this.plugin.saveSettings();
              });
            });
            return;
          }
          const netabaDescription = container.createEl(
            "p",
            {
              text: "Netaba \u8BC4\u5206\u56FE\u662F\u63D2\u4EF6\u6DFB\u52A0\u5230\u52A8\u753B\u7B14\u8BB0\u4E2D\u7684\u5916\u90E8\u8BC4\u5206\u9875\u9762\u3002Bangumi \u7528\u6237\u7F16\u53F7\u9ED8\u8BA4\u7EE7\u627F Bangumi \u7528\u6237 ID\uFF1B\u5728\u8FD9\u91CC\u624B\u52A8\u586B\u5199\u540E\uFF0C\u5C06\u4E0D\u518D\u8DDF\u968F Bangumi \u7528\u6237 ID \u53D8\u5316\u3002"
            }
          );
          netabaDescription.style.marginTop = "8px";
          netabaDescription.style.marginBottom = "18px";
          netabaDescription.style.maxWidth = "760px";
          netabaDescription.style.lineHeight = "1.6";
          netabaDescription.style.color = "var(--text-muted)";
          new Setting2(container).setName("Bangumi \u7528\u6237\u7F16\u53F7").setDesc(
            "\u7528\u4E8E Netaba \u7684\u4E2A\u4EBA\u8BC4\u5206\u9875\u9762\u3002\u7559\u7A7A\u65F6\u4F1A\u7EE7\u7EED\u4F7F\u7528 Bangumi \u7528\u6237 ID\u3002"
          ).addText((text) => {
            text.setPlaceholder("\u4F8B\u5982\uFF1A890645");
            text.setValue(
              String(
                this.plugin.settings.netabaUserId || this.plugin.settings.bangumiUserId || ""
              )
            );
            text.onChange(async (value) => {
              const userId = value.trim();
              if (userId && !/^\d+$/.test(userId)) {
                new Notice3(
                  "Bangumi \u7528\u6237\u7F16\u53F7\u53EA\u80FD\u586B\u5199\u6570\u5B57\u3002",
                  5e3
                );
                return;
              }
              this.plugin.settings.netabaUserId = userId;
              this.plugin.settings.netabaUserIdManuallySet = Boolean(userId);
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u6062\u590D\u8DDF\u968F Bangumi \u7528\u6237 ID").setDesc(
            "\u6E05\u9664\u624B\u52A8\u8BBE\u7F6E\u7684 Netaba \u7528\u6237\u7F16\u53F7\uFF0C\u5E76\u518D\u6B21\u81EA\u52A8\u4F7F\u7528 Bangumi \u7528\u6237 ID\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6062\u590D");
            button.onClick(async () => {
              this.plugin.settings.netabaUserId = String(
                this.plugin.settings.bangumiUserId || ""
              ).trim();
              this.plugin.settings.netabaUserIdManuallySet = false;
              await this.plugin.saveSettings();
              this.display();
            });
          });
          new Setting2(container).setName("\u65B0\u5EFA\u7B14\u8BB0\u4E2D\u7684 Netaba \u9ED8\u8BA4\u9875\u9762").setDesc(
            "\u53EA\u5F71\u54CD\u4EE5\u540E\u65B0\u5EFA\u7684\u52A8\u753B\u7B14\u8BB0\u3002\u7B14\u8BB0\u5185\u7684\u63D2\u4EF6\u6309\u94AE\u53EF\u4EE5\u5355\u72EC\u5207\u6362\u5F53\u524D\u7B14\u8BB0\u7684\u9875\u9762\u3002"
          ).addDropdown((dropdown) => {
            dropdown.addOptions({
              subject: "\u5F53\u524D\u52A8\u753B\u9875\u9762",
              season: "\u5F53\u5B63\u52A8\u753B",
              trending: "\u8BC4\u5206\u8D8B\u52BF",
              history: "\u5386\u53F2\u5206\u5E03",
              user: "\u4E2A\u4EBA\u8BC4\u5206",
              compare: "\u52A8\u753B\u5BF9\u6BD4"
            });
            dropdown.setValue(
              this.plugin.settings.netabaDefaultPage || "subject"
            );
            dropdown.onChange(async (value) => {
              this.plugin.settings.netabaDefaultPage = value;
              await this.plugin.saveSettings();
            });
          });
          new Setting2(container).setName("\u65B0\u5EFA\u7B14\u8BB0\u65F6\u6DFB\u52A0 Netaba \u8BC4\u5206\u56FE").setDesc(
            "\u5173\u95ED\u540E\uFF0C\u65B0\u521B\u5EFA\u7684\u52A8\u753B\u7B14\u8BB0\u4E0D\u4F1A\u52A0\u5165 Netaba \u8BC4\u5206\u56FE\u3002\u5DF2\u6709\u7B14\u8BB0\u4E0D\u4F1A\u88AB\u5220\u9664\u3002"
          ).addToggle((toggle) => {
            toggle.setValue(
              this.plugin.settings.netabaEmbedEnabled !== false
            );
            toggle.onChange(async (value) => {
              this.plugin.settings.netabaEmbedEnabled = value;
              await this.plugin.saveSettings();
            });
          });
          const compareSetting = new Setting2(container).setName("Netaba \u5BF9\u6BD4\u9875\u9762\u4E2D\u7684\u53E6\u4E00\u90E8\u52A8\u753B").setDesc(
            this.plugin.settings.netabaCompareTitle ? "\u5F53\u524D\u5BF9\u6BD4\u52A8\u753B\uFF1A" + this.plugin.settings.netabaCompareTitle : "\u5C1A\u672A\u9009\u62E9\u3002\u63D2\u4EF6\u4F1A\u5728 Netaba \u5BF9\u6BD4\u9875\u9762\u4E2D\uFF0C\u5C06\u5F53\u524D\u52A8\u753B\u4E0E\u8FD9\u91CC\u9009\u62E9\u7684\u52A8\u753B\u8FDB\u884C\u6BD4\u8F83\u3002"
          );
          compareSetting.addButton((button) => {
            button.setButtonText(
              this.plugin.settings.netabaCompareTitle ? "\u66F4\u6362\u5BF9\u6BD4\u52A8\u753B" : "\u641C\u7D22\u5E76\u9009\u62E9\u52A8\u753B"
            );
            button.onClick(() => {
              new NetabaCompareSelectModal2(
                this.app,
                this.plugin,
                () => {
                  this.display();
                }
              ).open();
            });
          });
          if (this.plugin.settings.netabaCompareTitle) {
            compareSetting.addButton((button) => {
              button.setButtonText("\u6E05\u9664\u9009\u62E9");
              button.onClick(async () => {
                this.plugin.settings.netabaCompareUrl = "";
                this.plugin.settings.netabaCompareTitle = "";
                await this.plugin.saveSettings();
                this.display();
              });
            });
          }
          new Setting2(container).setName("\u6279\u91CF\u7BA1\u7406\u5DF2\u6709\u7B14\u8BB0\u4E2D\u7684\u8BC4\u5206\u56FE").setDesc(
            "\u6279\u91CF\u521B\u5EFA\u6216\u5220\u9664\u5DF2\u6709\u52A8\u753B\u7B14\u8BB0\u4E2D\u7684 Netaba \u8BC4\u5206\u56FE\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6253\u5F00\u7BA1\u7406\u7A97\u53E3");
            button.onClick(async () => {
              await this.plugin.openNetabaNoteManager();
            });
          });
          new Setting2(container).setName("\u6279\u91CF\u7BA1\u7406\u5DF2\u6709\u7B14\u8BB0\u4E2D\u7684\u6807\u7B7E").setDesc(
            "\u6279\u91CF\u4E3A\u9009\u4E2D\u7684\u52A8\u753B\u7B14\u8BB0\u6DFB\u52A0\u65B0\u6807\u7B7E\uFF0C\u6216\u4ECE\u7B14\u8BB0\u4E2D\u6279\u91CF\u79FB\u9664\u5DF2\u6709\u6807\u7B7E\u3002"
          ).addButton((button) => {
            button.setButtonText("\u6253\u5F00\u7BA1\u7406\u7A97\u53E3");
            button.onClick(async () => {
              await this.plugin.openBatchTagManager();
            });
          });
        }
        addLazyActions(container) {
          this.addAction(
            container,
            "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
            "\u641C\u7D22 Bangumi\uFF0C\u9009\u62E9\u52A8\u753B\u540E\u81EA\u52A8\u521B\u5EFA\u7B14\u8BB0\u548C\u672C\u5730\u5C01\u9762\u3002",
            async () => {
              await openSingleAnimeImport2(
                this.app,
                this.plugin
              );
            }
          );
          this.addAction(
            container,
            "\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
            "\u4ECE Bangumi \u7528\u6237\u5217\u8868\u8BFB\u53D6\u4F5C\u54C1\uFF0C\u5E76\u6279\u91CF\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0\u3002",
            async () => {
              await openBatchAnimeImport2(
                this.app,
                this.plugin
              );
            }
          );
          this.addAction(
            container,
            "\u751F\u6210\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE",
            "\u53EA\u65B0\u589E\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u65E7\u5B63\u5EA6\u89C6\u56FE\u3002",
            async () => {
              await this.plugin.runTemporarySeasonMode(
                "current"
              );
            }
          );
          this.addAction(
            container,
            "\u5B89\u5168\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE",
            "\u53EA\u5220\u9664\u52A8\u753B\u5E93\u4E2D\u7684\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u52A8\u753B\u7B14\u8BB0\u548C\u672C\u5730\u6587\u4EF6\u3002",
            async () => {
              await this.plugin.cleanCompletedSeasonViews(
                true
              );
            }
          );
          this.addAction(
            container,
            "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
            "\u4ECE\u52A8\u753B\u5217\u8868\u4E2D\u9009\u62E9\u591A\u90E8\u52A8\u753B\u540E\u4E00\u6B21\u4FEE\u6539\u89C2\u770B\u72B6\u6001\u3002",
            async () => {
              await this.plugin.openBatchStatusManager();
            }
          );
        }
        addProfessionalActions(container) {
          this.addAction(
            container,
            "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
            "\u641C\u7D22 Bangumi \u5E76\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0\uFF1B\u5C01\u9762\u4FDD\u5B58\u76EE\u5F55\u548C\u672C\u5730\u52A8\u753B\u6839\u76EE\u5F55\u4F7F\u7528\u4E0A\u65B9\u8BBE\u7F6E\u3002",
            async () => {
              await openSingleAnimeImport2(
                this.app,
                this.plugin
              );
            }
          );
          this.addAction(
            container,
            "\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
            "\u4ECE Bangumi \u7528\u6237\u7684\u201C\u5DF2\u770B\u201D\u201C\u60F3\u770B\u201D\u6216\u201C\u5728\u770B\u201D\u5217\u8868\u8BFB\u53D6\u4F5C\u54C1\uFF0C\u6309\u5F53\u524D\u8DEF\u5F84\u8BBE\u7F6E\u521B\u5EFA\u7B14\u8BB0\uFF0C\u5E76\u8BB0\u5F55\u6210\u529F\u3001\u8DF3\u8FC7\u548C\u5931\u8D25\u7ED3\u679C\u3002",
            async () => {
              await openBatchAnimeImport2(
                this.app,
                this.plugin
              );
            }
          );
          this.addAction(
            container,
            "\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6",
            "\u6309\u5F53\u524D\u8DEF\u5F84\u8BBE\u7F6E\u521B\u5EFA\u7F3A\u5C11\u7684\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55\u3001\u5C01\u9762\u76EE\u5F55\u548C\u52A8\u753B\u5E93 Base \u6587\u4EF6\uFF1B\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u8986\u76D6\u3002",
            async () => {
              await this.plugin.initializeMissingFiles();
            }
          );
          this.addAction(
            container,
            "\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001",
            "\u7ACB\u5373\u626B\u63CF\u5168\u90E8\u76EE\u6807\u7B14\u8BB0\uFF0C\u5C06\u89C6\u9891\u6570\u91CF\u4E0E\u5DF2\u89C2\u770B\u96C6\u6570\u6BD4\u8F83\uFF0C\u5E76\u5199\u5165\u672C\u5730\u66F4\u65B0\u72B6\u6001\u3002",
            async () => {
              await this.plugin.checkAllLocalStatus(true);
            }
          );
          this.addAction(
            container,
            "\u8865\u9F50\u5168\u90E8\u7F3A\u5931\u5B63\u5EA6\u89C6\u56FE",
            "\u8BFB\u53D6\u6240\u6709\u52A8\u753B\u7B14\u8BB0\uFF0C\u53EA\u65B0\u589E\u7F3A\u5931\u7684\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u5DF2\u6709\u89C6\u56FE\u3002",
            async () => {
              const old = this.plugin.settings.seasonViewMode;
              this.plugin.settings.seasonViewMode = "all";
              await this.plugin.generateSeasonViews(
                true
              );
              this.plugin.settings.seasonViewMode = old;
            }
          );
          this.addAction(
            container,
            "\u751F\u6210\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE",
            "\u6309\u7167\u7535\u8111\u5F53\u524D\u65E5\u671F\u5224\u65AD\u5B63\u5EA6\uFF0C\u53EA\u65B0\u589E\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE\u3002",
            async () => {
              await this.plugin.runTemporarySeasonMode(
                "current"
              );
            }
          );
          this.addAction(
            container,
            "\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u6E05\u7406",
            "\u4EE5\u590D\u9009\u6846\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u540E\u6279\u91CF\u5220\u9664\uFF1B\u4E0D\u4F1A\u5220\u9664\u201C\u5168\u90E8\u52A8\u753B\u201D\u3002",
            async () => {
              await this.plugin.openSeasonViewCleanup();
            }
          );
          this.addAction(
            container,
            "\u5B89\u5168\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6",
            "\u4EC5\u5220\u9664\u52A8\u753B\u5E93 Base \u4E2D\u7684\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u52A8\u753B\u7B14\u8BB0\u3001\u672C\u5730\u89C6\u9891\u6216\u672C\u5730\u6587\u4EF6\u5939\uFF1B\u72B6\u6001\u4E3A\u201C\u5DF2\u770B\u201D\u7684\u52A8\u753B\u76F4\u63A5\u89C6\u4E3A\u5B8C\u6210\uFF0C\u5176\u4ED6\u52A8\u753B\u5FC5\u987B\u6EE1\u8DB3\u603B\u96C6\u6570\u5DF2\u77E5\u3001\u89C2\u770B\u8FDB\u5EA6\u8FBE\u6807\u4E14\u672C\u5730\u89C6\u9891\u6570\u91CF\u8FBE\u6807\u3002",
            async () => {
              await this.plugin.cleanCompletedSeasonViews(
                true
              );
            }
          );
          this.addAction(
            container,
            "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
            "\u6309\u72B6\u6001\u548C\u5B63\u5EA6\u7B5B\u9009\u52A8\u753B\uFF0C\u52FE\u9009\u540E\u6279\u91CF\u4FEE\u6539\uFF0C\u4E0D\u91CD\u5EFA\u7B14\u8BB0\u3002",
            async () => {
              await this.plugin.openBatchStatusManager();
            }
          );
        }
        addAction(container, name, description, callback) {
          new Setting2(container).setName(name).setDesc(description).addButton((button) => {
            button.setButtonText("\u6267\u884C");
            button.onClick(callback);
          });
        }
        addPathSetting(container, name, key, description) {
          new Setting2(container).setName(name).setDesc(description).addText((text) => {
            text.setValue(
              this.plugin.settings[key]
            );
            text.onChange(async (value) => {
              this.plugin.settings[key] = value.trim();
              await this.plugin.saveSettings();
            });
          });
        }
      };
      return BangumiManagerSettingTab2;
    };
  }
});

// src/rating-sync-manager.js
var require_rating_sync_manager = __commonJS({
  "src/rating-sync-manager.js"(exports2, module2) {
    "use strict";
    var bangumiApi2 = require_bangumi_api();
    var noteUtils2 = require_note_utils();
    var PHASES = {
      SCAN: "\u6B63\u5728\u626B\u63CF\u52A8\u753B\u7B14\u8BB0",
      USER: "\u6B63\u5728\u8BFB\u53D6 Bangumi \u7528\u6237\u8BC4\u5206",
      DETAIL: "\u6B63\u5728\u8BFB\u53D6\u666E\u901A\u8BC4\u5206\u548C\u7CBE\u786E\u8BC4\u5206",
      READY: "\u8BC4\u5206\u6570\u636E\u5DF2\u8BFB\u53D6\uFF0C\u6B63\u5728\u51C6\u5907\u5199\u5165",
      WRITE: "\u6B63\u5728\u5199\u5165\u52A8\u753B\u7B14\u8BB0",
      DASHBOARD: "\u6B63\u5728\u5237\u65B0\u4EEA\u8868\u76D8",
      DONE: "\u5DF2\u5B8C\u6210",
      STOPPED: "\u5DF2\u4E2D\u6B62",
      DISCARDED: "\u5DF2\u4E2D\u6B62\uFF0C\u672A\u4FDD\u5B58\u672C\u6B21\u7ED3\u679C",
      FAILED: "\u5DF2\u5931\u8D25"
    };
    var SELF_WRITE_WINDOW_MS = 5e3;
    function clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      return Math.min(
        max,
        Math.max(
          min,
          Number.isFinite(parsed) ? parsed : fallback
        )
      );
    }
    function copyObject(value) {
      return value && typeof value === "object" && !Array.isArray(value) ? Object.assign({}, value) : {};
    }
    function isFresh(meta, now, ttlMs) {
      const at = Number(meta && meta.at);
      return Number.isFinite(at) && at > 0 && now - at < ttlMs;
    }
    function formatDuration(value) {
      const totalSeconds = Math.max(
        0,
        Math.round(Number(value) / 1e3) || 0
      );
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes + " \u5206 " + seconds + " \u79D2";
    }
    var RatingSyncManager2 = class {
      constructor(plugin) {
        this.plugin = plugin;
        this.task = null;
        this.listeners = /* @__PURE__ */ new Set();
        this.selfWrites = /* @__PURE__ */ new Map();
      }
      isRunning() {
        return Boolean(this.task && this.task.running);
      }
      getTask() {
        return this.task;
      }
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
      emit() {
        for (const listener of this.listeners) {
          try {
            listener(this.task);
          } catch (error) {
            console.warn("\u8BC4\u5206\u540C\u6B65\u72B6\u6001\u76D1\u542C\u5931\u8D25:", error);
          }
        }
      }
      markSelfWrite(filePath) {
        if (!filePath) {
          return;
        }
        this.selfWrites.set(
          String(filePath),
          Date.now() + SELF_WRITE_WINDOW_MS
        );
      }
      isSelfWrite(filePath) {
        const path = String(filePath || "");
        const expiresAt = this.selfWrites.get(path);
        if (!expiresAt) {
          return false;
        }
        if (Date.now() > expiresAt) {
          this.selfWrites.delete(path);
          return false;
        }
        return true;
      }
      createTask(options) {
        return {
          running: true,
          stopRequested: false,
          stopMode: "",
          pauseRequested: false,
          pausedPhase: "",
          pauseWaiters: [],
          wasStopped: false,
          discarded: false,
          hadFatalError: false,
          phase: PHASES.SCAN,
          startedAt: Date.now(),
          finishedAt: 0,
          elapsed: 0,
          total: 0,
          scanned: 0,
          completed: 0,
          requested: 0,
          launched: 0,
          skipped: 0,
          failed: 0,
          timedOut: 0,
          noData: 0,
          retried: 0,
          userListPages: 0,
          userRatingsUpdated: 0,
          publicRatingsUpdated: 0,
          preciseRatingsUpdated: 0,
          notesUpdated: 0,
          currentName: "",
          forceRefresh: options.forceRefresh === true,
          mode: options.mode || "standard",
          settingsSaved: 0,
          dashboardRefreshes: 0,
          preciseEnabled: false,
          userRatingsSkipped: false,
          userRatingsSkipReason: "",
          detailStats: null,
          details: /* @__PURE__ */ new Map(),
          userRatings: /* @__PURE__ */ new Map(),
          items: [],
          lastError: ""
        };
      }
      releasePauseWaiters(task) {
        const waiters = task.pauseWaiters.splice(0);
        for (const resolve of waiters) {
          resolve();
        }
      }
      pauseForDecision() {
        if (!this.isRunning() || this.task.stopRequested) {
          return false;
        }
        if (this.task.pauseRequested) {
          return true;
        }
        this.task.pauseRequested = true;
        this.task.pausedPhase = this.task.phase;
        this.task.phase = "\u7B49\u5F85\u505C\u6B62\u51B3\u5B9A";
        this.task.currentName = "\u5DF2\u6682\u505C\u540E\u7EED\u8BF7\u6C42\uFF0C\u7B49\u5F85\u505C\u6B62\u51B3\u5B9A";
        this.emit();
        return true;
      }
      resumeAfterDecision() {
        if (!this.isRunning() || !this.task.pauseRequested) {
          return false;
        }
        this.task.pauseRequested = false;
        this.task.phase = this.task.pausedPhase || PHASES.SCAN;
        this.task.pausedPhase = "";
        this.releasePauseWaiters(this.task);
        this.emit();
        return true;
      }
      async waitWhilePaused(task) {
        while (task.pauseRequested && !task.stopRequested) {
          await new Promise((resolve) => {
            task.pauseWaiters.push(resolve);
          });
        }
      }
      requestStop(mode) {
        if (!this.isRunning()) {
          return false;
        }
        if (mode !== "commit" && mode !== "discard") {
          return false;
        }
        this.task.stopRequested = true;
        this.task.stopMode = mode;
        this.task.pauseRequested = false;
        this.task.pausedPhase = "";
        this.releasePauseWaiters(this.task);
        this.emit();
        return true;
      }
      async start(options = {}) {
        if (this.isRunning()) {
          return this.task;
        }
        const task = this.createTask(options);
        this.task = task;
        this.emit();
        try {
          await this.run(task, options);
        } catch (error) {
          task.hadFatalError = true;
          task.failed += 1;
          task.lastError = error && error.message ? error.message : String(error);
          console.error("\u8BC4\u5206\u540C\u6B65\u4EFB\u52A1\u5931\u8D25:", error);
        } finally {
          await this.finish(task);
        }
        return task;
      }
      async run(task, options) {
        task.items = await this.collectItems(
          task,
          Array.isArray(options.targets) ? options.targets : null
        );
        task.total = task.items.length;
        await this.waitWhilePaused(task);
        if (!task.items.length || task.stopRequested) {
          return;
        }
        task.preciseEnabled = this.plugin.settings.showBangumiPreciseScore === true || this.plugin.settings.dashboardShowPreciseRank === true;
        if (task.mode !== "preciseOnly") {
          await this.readUserRatings(task);
        }
        await this.waitWhilePaused(task);
        if (!task.stopRequested) {
          await this.readDetails(task);
        }
        await this.waitWhilePaused(task);
        if (!task.stopRequested) {
          task.phase = PHASES.READY;
          this.emit();
        }
      }
      async collectItems(task, targets) {
        const files = targets || this.plugin.app.vault.getMarkdownFiles();
        const items = [];
        for (const file of files) {
          await this.waitWhilePaused(task);
          if (task.stopRequested) {
            break;
          }
          if (!this.plugin.isTargetNote(file)) {
            continue;
          }
          try {
            const content = await this.plugin.app.vault.read(file);
            const parsed = noteUtils2.parseFrontmatter(content);
            if (!parsed || !String(parsed.fields.tags || "").includes("bangumi")) {
              continue;
            }
            const subjectId = bangumiApi2.getSubjectId(
              noteUtils2.cleanValue(parsed.fields.BGM\u94FE\u63A5)
            );
            if (!subjectId) {
              continue;
            }
            items.push({
              file,
              content,
              parsed,
              subjectId,
              title: noteUtils2.cleanValue(parsed.fields.\u4E2D\u6587\u540D) || file.basename || subjectId
            });
            task.scanned += 1;
            task.currentName = items[items.length - 1].title;
            if (items.length % 20 === 0) {
              this.emit();
            }
          } catch (error) {
            task.failed += 1;
            console.warn("\u8BFB\u53D6\u52A8\u753B\u7B14\u8BB0\u5931\u8D25:", file.path, error);
          }
        }
        this.emit();
        return items;
      }
      async readUserRatings(task) {
        const userId = String(
          this.plugin.settings.bangumiUserId || ""
        ).trim();
        task.phase = PHASES.USER;
        this.emit();
        if (!/^\d+$/.test(userId)) {
          task.userRatingsSkipped = true;
          task.userRatingsSkipReason = "\u672A\u586B\u5199 Bangumi \u7528\u6237 ID\uFF0C\u5DF2\u8DF3\u8FC7\u7528\u6237\u8BC4\u5206\u540C\u6B65";
          this.emit();
          return;
        }
        try {
          task.userRatings = await bangumiApi2.getUserRatingsForSubjects(
            userId,
            task.items.map((item) => item.subjectId),
            {
              pageIntervalMs: clampNumber(
                this.plugin.settings.ratingUserListPageIntervalMs,
                350,
                500,
                400
              ),
              shouldStop: () => task.stopRequested,
              waitIfPaused: () => this.waitWhilePaused(task),
              onProgress: (progress) => {
                task.userListPages += 1;
                task.currentName = "\u6B63\u5728\u8BFB\u53D6 " + progress.path + " \u5217\u8868\u7B2C " + progress.page + " \u9875";
                this.emit();
              }
            }
          );
        } catch (error) {
          task.userRatingsSkipped = true;
          task.userRatingsSkipReason = "\u8BFB\u53D6\u7528\u6237\u8BC4\u5206\u5931\u8D25\uFF1A" + (error && error.message ? error.message : String(error));
          console.warn("\u8BFB\u53D6 BGM \u7528\u6237\u8BC4\u5206\u5931\u8D25:", error);
        }
        this.emit();
      }
      selectDetailTargets(task) {
        const settings = this.plugin.settings;
        const ttlMs = clampNumber(
          settings.ratingCacheTtlSeconds,
          3600,
          2592e3,
          86400
        ) * 1e3;
        const now = Date.now();
        const publicCache = copyObject(
          settings.bangumiPublicRatingCache
        );
        const preciseCache = copyObject(
          settings.bangumiPreciseRatingCache
        );
        const publicMeta = copyObject(
          settings.bangumiPublicRatingCacheMeta
        );
        const preciseMeta = copyObject(
          settings.bangumiPreciseRatingCacheMeta
        );
        const seen = /* @__PURE__ */ new Set();
        const targetIds = [];
        for (const item of task.items) {
          const subjectId = item.subjectId;
          if (seen.has(subjectId)) {
            continue;
          }
          seen.add(subjectId);
          const needsPublic = task.mode !== "preciseOnly" && (task.forceRefresh || !publicCache[subjectId] || !isFresh(publicMeta[subjectId], now, ttlMs));
          const needsPrecise = task.preciseEnabled && (task.forceRefresh || !preciseCache[subjectId] || !isFresh(preciseMeta[subjectId], now, ttlMs));
          if (needsPublic || needsPrecise) {
            targetIds.push(subjectId);
          } else {
            task.skipped += 1;
          }
        }
        task.requested = targetIds.length;
        return targetIds;
      }
      async readDetails(task) {
        const subjectIds = this.selectDetailTargets(task);
        if (!subjectIds.length) {
          this.emit();
          return;
        }
        task.phase = PHASES.DETAIL;
        this.emit();
        const outcome = await bangumiApi2.getScoreDetailsForSubjects(
          subjectIds,
          {
            needPrecise: task.preciseEnabled,
            concurrency: clampNumber(
              this.plugin.settings.ratingDetailRequestConcurrency,
              1,
              4,
              3
            ),
            intervalMs: clampNumber(
              this.plugin.settings.ratingDetailRequestIntervalMs,
              200,
              1e3,
              300
            ),
            timeoutMs: clampNumber(
              this.plugin.settings.ratingRequestTimeoutMs,
              3e3,
              6e4,
              15e3
            ),
            retryCount: clampNumber(
              this.plugin.settings.ratingRequestRetryCount,
              0,
              2,
              2
            ),
            shouldStop: () => task.stopRequested,
            waitIfPaused: () => this.waitWhilePaused(task),
            onProgress: (progress) => {
              const stats = progress.stats || {};
              task.launched = Number(stats.launched) || 0;
              task.completed = Number(stats.completed) || 0;
              task.timedOut = Number(stats.timedOut) || 0;
              task.retried = Number(stats.retried) || 0;
              if (progress.subjectId) {
                task.currentName = "\u6B63\u5728\u8BFB\u53D6\u52A8\u753B\u7F16\u53F7 " + progress.subjectId;
              }
              this.emit();
            }
          }
        );
        task.details = outcome.results;
        task.detailStats = outcome.stats;
        for (const detail of task.details.values()) {
          if (detail.error && detail.error !== "\u5DF2\u505C\u6B62") {
            task.failed += 1;
          } else if (detail.noData) {
            task.noData += 1;
          }
        }
        if (outcome.stats && outcome.stats.stopped) {
          task.wasStopped = true;
        }
        this.emit();
      }
      shouldCommit(task) {
        if (!task.stopRequested) {
          return !task.hadFatalError;
        }
        return task.stopMode === "commit";
      }
      async commit(task) {
        const settings = this.plugin.settings;
        const now = Date.now();
        const userCache = copyObject(
          settings.bangumiRatingCache
        );
        const publicCache = copyObject(
          settings.bangumiPublicRatingCache
        );
        const preciseCache = copyObject(
          settings.bangumiPreciseRatingCache
        );
        const userMeta = copyObject(
          settings.bangumiRatingCacheMeta
        );
        const publicMeta = copyObject(
          settings.bangumiPublicRatingCacheMeta
        );
        const preciseMeta = copyObject(
          settings.bangumiPreciseRatingCacheMeta
        );
        task.phase = PHASES.WRITE;
        task.completed = 0;
        this.emit();
        for (const item of task.items) {
          if (task.stopRequested && task.stopMode !== "commit") {
            break;
          }
          let content = item.content;
          let changed = false;
          const userRating = task.userRatings.get(item.subjectId);
          const detail = task.details.get(item.subjectId);
          task.currentName = item.title;
          if (userRating !== void 0 && userRating !== null) {
            const score = String(userRating);
            const oldScore = userCache[item.subjectId];
            userCache[item.subjectId] = score;
            userMeta[item.subjectId] = {
              at: now,
              source: "bangumi"
            };
            if (oldScore !== score) {
              task.userRatingsUpdated += 1;
            }
            const updated = noteUtils2.updateScoreFields(
              content,
              settings.showBangumiUserScore !== false ? score : null,
              settings.showPersonalScore !== false ? noteUtils2.cleanValue(
                item.parsed.fields.\u6211\u7684\u8BC4\u5206
              ) || "\u672A\u8BC4\u5206" : null
            );
            if (updated !== content) {
              content = updated;
              changed = true;
            }
          }
          if (detail && !detail.error) {
            let publicScoreChanged = false;
            let preciseScoreChanged = false;
            if (task.mode !== "preciseOnly" && detail.publicScore !== null) {
              const score = String(detail.publicScore);
              publicScoreChanged = publicCache[item.subjectId] !== score;
              publicCache[item.subjectId] = score;
              publicMeta[item.subjectId] = {
                at: now,
                source: "bangumi"
              };
              if (publicScoreChanged) {
                task.publicRatingsUpdated += 1;
              }
            }
            if (task.preciseEnabled && detail.preciseScore !== null) {
              const score = String(detail.preciseScore);
              preciseScoreChanged = preciseCache[item.subjectId] !== score;
              preciseCache[item.subjectId] = score;
              preciseMeta[item.subjectId] = {
                at: now,
                source: "bangumi"
              };
              if (preciseScoreChanged) {
                task.preciseRatingsUpdated += 1;
              }
            }
            if (publicScoreChanged || preciseScoreChanged) {
              const displayedScore = task.preciseEnabled ? preciseCache[item.subjectId] || noteUtils2.cleanValue(
                item.parsed.fields.BGM\u8BC4\u5206
              ) : publicCache[item.subjectId] || noteUtils2.cleanValue(
                item.parsed.fields.BGM\u8BC4\u5206
              );
              const updated = noteUtils2.synchronizeBangumiScoreFields(
                content,
                this.plugin.getScoreDisplayOptions(),
                {
                  bangumiScore: displayedScore
                }
              );
              if (updated !== content) {
                content = updated;
                changed = true;
              }
            }
          }
          if (changed && content !== item.content) {
            try {
              this.markSelfWrite(item.file.path);
              await this.plugin.app.vault.modify(
                item.file,
                content
              );
              task.notesUpdated += 1;
            } catch (error) {
              task.failed += 1;
              console.warn(
                "\u5199\u5165\u8BC4\u5206\u5B57\u6BB5\u5931\u8D25:",
                item.file.path,
                error
              );
            }
          }
          task.completed += 1;
          if (task.completed % 10 === 0) {
            this.emit();
          }
        }
        settings.bangumiRatingCache = userCache;
        settings.bangumiPublicRatingCache = publicCache;
        settings.bangumiPreciseRatingCache = preciseCache;
        settings.bangumiRatingCacheMeta = userMeta;
        settings.bangumiPublicRatingCacheMeta = publicMeta;
        settings.bangumiPreciseRatingCacheMeta = preciseMeta;
        this.emit();
      }
      async finish(task) {
        task.wasStopped = task.wasStopped || task.stopRequested;
        try {
          if (this.shouldCommit(task)) {
            await this.commit(task);
            this.plugin.settings.lastRatingMonitorAt = Date.now();
            try {
              await this.plugin.saveSettings();
              task.settingsSaved += 1;
            } catch (error) {
              task.failed += 1;
              console.warn("\u4FDD\u5B58\u8BC4\u5206\u7F13\u5B58\u5931\u8D25:", error);
            }
            if (task.notesUpdated > 0) {
              task.phase = PHASES.DASHBOARD;
              this.emit();
              try {
                await this.plugin.refreshScoreDashboard(false);
                task.dashboardRefreshes += 1;
              } catch (error) {
                task.failed += 1;
                console.warn("\u5237\u65B0\u52A8\u753B\u4EEA\u8868\u76D8\u5931\u8D25:", error);
              }
            }
          } else if (task.stopRequested) {
            task.discarded = true;
          }
        } catch (error) {
          task.hadFatalError = true;
          task.failed += 1;
          task.lastError = error && error.message ? error.message : String(error);
          console.error("\u8BC4\u5206\u540C\u6B65\u6536\u5C3E\u5931\u8D25:", error);
        } finally {
          task.running = false;
          task.finishedAt = Date.now();
          task.elapsed = task.finishedAt - task.startedAt;
          if (task.hadFatalError) {
            task.phase = PHASES.FAILED;
          } else if (task.discarded) {
            task.phase = PHASES.DISCARDED;
          } else if (task.wasStopped) {
            task.phase = PHASES.STOPPED;
          } else {
            task.phase = PHASES.DONE;
          }
          this.emit();
        }
      }
      buildSummary(task) {
        if (!task) {
          return "";
        }
        const title = task.hadFatalError ? "\u8BC4\u5206\u540C\u6B65\u5931\u8D25\uFF1A" : task.discarded ? "\u8BC4\u5206\u540C\u6B65\u5DF2\u4E2D\u6B62\uFF0C\u672A\u4FDD\u5B58\u672C\u6B21\u7ED3\u679C\uFF1A" : task.wasStopped ? "\u8BC4\u5206\u540C\u6B65\u5DF2\u4E2D\u6B62\uFF0C\u5DF2\u4FDD\u5B58\u5DF2\u83B7\u53D6\u7ED3\u679C\uFF1A" : "\u8BC4\u5206\u540C\u6B65\u5B8C\u6210\uFF1A";
        const parts = [
          "\u626B\u63CF " + task.scanned + " \u7BC7",
          "\u8BE6\u60C5\u8BF7\u6C42 " + task.requested + " \u90E8",
          "\u7F13\u5B58\u8DF3\u8FC7 " + task.skipped + " \u90E8",
          "\u7528\u6237\u8BC4\u5206\u66F4\u65B0 " + task.userRatingsUpdated + " \u90E8",
          "\u666E\u901A\u8BC4\u5206\u66F4\u65B0 " + task.publicRatingsUpdated + " \u90E8",
          "\u7CBE\u786E\u8BC4\u5206\u66F4\u65B0 " + task.preciseRatingsUpdated + " \u90E8",
          "\u5199\u5165\u7B14\u8BB0 " + task.notesUpdated + " \u7BC7",
          "\u65E0\u6570\u636E " + task.noData + " \u90E8",
          "\u5931\u8D25 " + task.failed + " \u90E8"
        ];
        if (task.userRatingsSkipped) {
          parts.push(task.userRatingsSkipReason);
        }
        return title + parts.join("\uFF0C") + "\u3002\u8017\u65F6 " + formatDuration(task.elapsed) + "\u3002";
      }
    };
    module2.exports = {
      RatingSyncManager: RatingSyncManager2,
      RATING_SYNC_PHASES: PHASES
    };
  }
});

// src/netaba-modals.js
var require_netaba_modals = __commonJS({
  "src/netaba-modals.js"(exports2, module2) {
    module2.exports = function createNetabaModals2({
      Modal: Modal2,
      Notice: Notice3,
      bangumiApi: bangumiApi2
    }) {
      var NetabaNoteManagerModal2 = class extends Modal2 {
        constructor(app, items, onSubmit) {
          super(app);
          this.items = items;
          this.onSubmit = onSubmit;
          this.selected = /* @__PURE__ */ new Set();
          this.filteredItems = items;
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          this.modalEl.style.width = "min(760px, 90vw)";
          this.modalEl.style.maxWidth = "90vw";
          this.modalEl.style.maxHeight = "90vh";
          this.modalEl.style.overflowY = "auto";
          contentEl.createEl(
            "h2",
            {
              text: "\u6279\u91CF\u7BA1\u7406 Netaba \u8BC4\u5206\u56FE"
            }
          );
          contentEl.createEl(
            "p",
            {
              text: "\u53EF\u4EE5\u4E3A\u6CA1\u6709 Netaba \u8BC4\u5206\u56FE\u7684\u52A8\u753B\u7B14\u8BB0\u521B\u5EFA\u8BC4\u5206\u56FE\uFF0C\u4E5F\u53EF\u4EE5\u5220\u9664\u5DF2\u6709\u8BC4\u5206\u56FE\u3002\u5DF2\u6709\u8BC4\u5206\u56FE\u4E0D\u4F1A\u88AB\u91CD\u590D\u521B\u5EFA\uFF0C\u52A8\u753B\u4FE1\u606F\u3001\u4E2A\u4EBA\u603B\u7ED3\u548C\u5176\u4ED6\u7B14\u8BB0\u5185\u5BB9\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002"
            }
          );
          const actionLabel = contentEl.createEl(
            "p",
            {
              text: "\u64CD\u4F5C\uFF1A"
            }
          );
          actionLabel.style.marginBottom = "4px";
          const actionSelect = contentEl.createEl("select");
          actionSelect.createEl(
            "option",
            {
              text: "\u521B\u5EFA\u8BC4\u5206\u56FE",
              value: "add"
            }
          );
          actionSelect.createEl(
            "option",
            {
              text: "\u5220\u9664\u8BC4\u5206\u56FE",
              value: "delete"
            }
          );
          const controls = contentEl.createDiv();
          controls.style.marginTop = "12px";
          const selectAll = controls.createEl(
            "button",
            {
              text: "\u5168\u9009\u5F53\u524D\u7ED3\u679C"
            }
          );
          const clearAll = controls.createEl(
            "button",
            {
              text: "\u6E05\u7A7A\u9009\u62E9"
            }
          );
          clearAll.style.marginLeft = "8px";
          const list = contentEl.createDiv();
          list.style.maxHeight = "380px";
          list.style.overflowY = "auto";
          list.style.marginTop = "12px";
          list.style.border = "1px solid var(--background-modifier-border)";
          list.style.padding = "8px";
          const render = () => {
            list.empty();
            for (const item of this.filteredItems) {
              const row = list.createDiv();
              row.style.margin = "6px 0";
              const checkbox = row.createEl("input");
              checkbox.type = "checkbox";
              checkbox.checked = this.selected.has(
                item.file.path
              );
              checkbox.onchange = () => {
                if (checkbox.checked) {
                  this.selected.add(item.file.path);
                } else {
                  this.selected.delete(item.file.path);
                }
              };
              row.createEl(
                "span",
                {
                  text: " " + item.name + " [" + item.state + "] " + item.season
                }
              );
            }
          };
          selectAll.onclick = () => {
            for (const item of this.filteredItems) {
              this.selected.add(item.file.path);
            }
            render();
          };
          clearAll.onclick = () => {
            this.selected.clear();
            render();
          };
          render();
          const submit = contentEl.createEl(
            "button",
            {
              text: "\u6267\u884C\u5904\u7406"
            }
          );
          submit.style.marginTop = "14px";
          submit.onclick = async () => {
            if (this.selected.size === 0) {
              new Notice3(
                "\u8BF7\u5148\u9009\u62E9\u81F3\u5C11\u4E00\u7BC7\u52A8\u753B\u7B14\u8BB0\u3002",
                5e3
              );
              return;
            }
            const selectedFiles = this.items.filter((item) => {
              return this.selected.has(item.file.path);
            }).map((item) => item.file);
            if (actionSelect.value === "delete") {
              const confirmed = window.confirm(
                "\u786E\u5B9A\u8981\u5220\u9664\u6240\u9009\u7B14\u8BB0\u4E2D\u7684 Netaba \u8BC4\u5206\u56FE\u5417\uFF1F\n\n\u52A8\u753B\u4FE1\u606F\u3001\u4E2A\u4EBA\u603B\u7ED3\u548C\u5176\u4ED6\u5185\u5BB9\u4E0D\u4F1A\u88AB\u5220\u9664\u3002"
              );
              if (!confirmed) {
                return;
              }
            }
            if (actionSelect.value === "add") {
              const confirmed = window.confirm(
                "\u5C06\u4E3A\u6CA1\u6709 Netaba \u8BC4\u5206\u56FE\u7684\u7B14\u8BB0\u6DFB\u52A0\u8BC4\u5206\u56FE\u3002\u5DF2\u6709\u8BC4\u5206\u56FE\u4E0D\u4F1A\u91CD\u590D\u6DFB\u52A0\u3002\u662F\u5426\u7EE7\u7EED\uFF1F"
              );
              if (!confirmed) {
                return;
              }
            }
            this.close();
            await this.onSubmit(
              actionSelect.value,
              selectedFiles
            );
          };
        }
        onClose() {
          this.contentEl.empty();
        }
      };
      var NetabaPageSelectModal2 = class extends Modal2 {
        constructor(app, plugin) {
          super(app);
          this.plugin = plugin;
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          this.modalEl.style.width = "min(520px, 90vw)";
          this.modalEl.style.maxWidth = "90vw";
          contentEl.createEl(
            "h2",
            {
              text: "\u5207\u6362 Netaba \u9875\u9762"
            }
          );
          contentEl.createEl(
            "p",
            {
              text: "\u9009\u62E9\u540E\u53EF\u4EE5\u5E94\u7528\u5230\u5F53\u524D\u7B14\u8BB0\uFF0C\u4E5F\u53EF\u4EE5\u4FDD\u5B58\u4E3A\u4EE5\u540E\u65B0\u5EFA\u7B14\u8BB0\u7684\u9ED8\u8BA4\u9875\u9762\u3002"
            }
          );
          const pageSelect = contentEl.createEl("select");
          pageSelect.style.width = "100%";
          pageSelect.style.boxSizing = "border-box";
          pageSelect.createEl(
            "option",
            {
              text: "\u5F53\u524D\u52A8\u753B\u9875\u9762",
              value: "subject"
            }
          );
          pageSelect.createEl(
            "option",
            {
              text: "\u5F53\u5B63\u52A8\u753B",
              value: "season"
            }
          );
          pageSelect.createEl(
            "option",
            {
              text: "\u8BC4\u5206\u8D8B\u52BF",
              value: "trending"
            }
          );
          pageSelect.createEl(
            "option",
            {
              text: "\u5386\u53F2\u5206\u5E03",
              value: "history"
            }
          );
          pageSelect.createEl(
            "option",
            {
              text: "\u4E2A\u4EBA\u8BC4\u5206",
              value: "user"
            }
          );
          pageSelect.createEl(
            "option",
            {
              text: "\u52A8\u753B\u5BF9\u6BD4",
              value: "compare"
            }
          );
          pageSelect.value = this.plugin.settings.netabaDefaultPage || "subject";
          const saveButton = contentEl.createEl(
            "button",
            {
              text: "\u4FDD\u5B58\u4E3A\u65B0\u5EFA\u7B14\u8BB0\u7684\u9ED8\u8BA4\u9875\u9762"
            }
          );
          saveButton.style.marginTop = "14px";
          const applyButton = contentEl.createEl(
            "button",
            {
              text: "\u5E94\u7528\u5230\u5F53\u524D\u6253\u5F00\u7684\u52A8\u753B\u7B14\u8BB0"
            }
          );
          applyButton.style.marginTop = "8px";
          const browserButton = contentEl.createEl(
            "button",
            {
              text: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u5F53\u524D\u9009\u62E9\u7684\u9875\u9762"
            }
          );
          browserButton.style.marginTop = "8px";
          saveButton.onclick = async () => {
            const page = pageSelect.value;
            if (page === "user" && !/^\d+$/.test(
              String(this.plugin.settings.netabaUserId || "").trim()
            )) {
              new Notice3(
                "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u6B63\u786E\u7684 Bangumi \u7528\u6237\u7F16\u53F7\u3002",
                5e3
              );
              return;
            }
            if (page === "compare" && !this.plugin.settings.netabaCompareUrl) {
              new Notice3(
                "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u641C\u7D22\u5E76\u9009\u62E9\u4E00\u90E8\u5BF9\u6BD4\u52A8\u753B\u3002",
                5e3
              );
              return;
            }
            this.plugin.settings.netabaDefaultPage = page;
            await this.plugin.saveSettings();
            new Notice3(
              "\u5DF2\u4FDD\u5B58 Netaba \u9ED8\u8BA4\u9875\u9762\u3002",
              4e3
            );
          };
          applyButton.onclick = async () => {
            await this.plugin.applyNetabaPageToActiveNote(
              pageSelect.value
            );
          };
          browserButton.onclick = async () => {
            await this.plugin.openNetabaPageInBrowser(
              pageSelect.value
            );
          };
        }
        onClose() {
          this.contentEl.empty();
        }
      };
      var NetabaCompareSelectModal2 = class extends Modal2 {
        constructor(app, plugin, onSelected) {
          super(app);
          this.plugin = plugin;
          this.onSelected = onSelected;
          this.results = [];
        }
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          this.modalEl.style.width = "min(720px, 90vw)";
          this.modalEl.style.maxWidth = "90vw";
          this.modalEl.style.maxHeight = "90vh";
          this.modalEl.style.overflowY = "auto";
          contentEl.createEl(
            "h2",
            {
              text: "\u9009\u62E9 Netaba \u5BF9\u6BD4\u52A8\u753B"
            }
          );
          contentEl.createEl(
            "p",
            {
              text: "\u8F93\u5165\u52A8\u753B\u540D\u79F0\uFF0C\u641C\u7D22\u540E\u9009\u62E9\u4E00\u90E8\u52A8\u753B\u4F5C\u4E3A\u5B9E\u9A8C\u529F\u80FD\u4E2D\u7684\u5BF9\u6BD4\u5BF9\u8C61\u3002"
            }
          );
          const keywordInput = contentEl.createEl("input");
          keywordInput.type = "text";
          keywordInput.placeholder = "\u4F8B\u5982\uFF1A\u846C\u9001\u7684\u8299\u8389\u83B2";
          keywordInput.style.width = "100%";
          keywordInput.style.boxSizing = "border-box";
          const searchButton = contentEl.createEl(
            "button",
            {
              text: "\u641C\u7D22\u52A8\u753B"
            }
          );
          searchButton.style.marginTop = "10px";
          const resultList = contentEl.createDiv();
          resultList.style.marginTop = "12px";
          resultList.style.maxHeight = "45vh";
          resultList.style.overflowY = "auto";
          const detailArea = contentEl.createDiv();
          detailArea.style.marginTop = "14px";
          const search = async () => {
            const keyword = keywordInput.value.trim();
            if (!keyword) {
              new Notice3(
                "\u8BF7\u5148\u8F93\u5165\u52A8\u753B\u540D\u79F0\u3002",
                5e3
              );
              return;
            }
            searchButton.disabled = true;
            searchButton.textContent = "\u6B63\u5728\u641C\u7D22\u2026\u2026";
            resultList.empty();
            detailArea.empty();
            try {
              this.results = await bangumiApi2.searchBangumi(keyword);
              if (this.results.length === 0) {
                resultList.createEl(
                  "p",
                  {
                    text: "\u6CA1\u6709\u627E\u5230\u52A8\u753B\u7ED3\u679C\uFF0C\u8BF7\u5C1D\u8BD5\u5176\u4ED6\u540D\u79F0\u3002"
                  }
                );
                return;
              }
              for (const result of this.results) {
                const resultButton = resultList.createEl("button");
                resultButton.style.display = "block";
                resultButton.style.width = "100%";
                resultButton.style.height = "auto";
                resultButton.style.minHeight = "38px";
                resultButton.style.boxSizing = "border-box";
                resultButton.style.padding = "8px 12px";
                resultButton.style.margin = "6px 0";
                resultButton.style.textAlign = "left";
                resultButton.style.whiteSpace = "normal";
                resultButton.style.overflowWrap = "anywhere";
                resultButton.style.wordBreak = "break-word";
                resultButton.style.lineHeight = "1.45";
                resultButton.textContent = result.title + (result.description ? "  " + result.description : "");
                resultButton.onclick = async () => {
                  await this.selectResult(result, detailArea);
                };
              }
            } catch (error) {
              console.error(
                "\u641C\u7D22 Netaba \u5BF9\u6BD4\u52A8\u753B\u5931\u8D25:",
                error
              );
              resultList.createEl(
                "p",
                {
                  text: "\u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u6216 Bangumi \u8BBF\u95EE\u72B6\u6001\u3002"
                }
              );
            } finally {
              searchButton.disabled = false;
              searchButton.textContent = "\u641C\u7D22\u52A8\u753B";
            }
          };
          searchButton.onclick = search;
          keywordInput.onkeydown = (event) => {
            if (event.key === "Enter") {
              search();
            }
          };
        }
        async selectResult(result, detailArea) {
          detailArea.empty();
          detailArea.createEl(
            "p",
            {
              text: "\u6B63\u5728\u8BFB\u53D6\u52A8\u753B\u4FE1\u606F\u2026\u2026"
            }
          );
          try {
            const info = await bangumiApi2.getAnimeDetail(result.url);
            if (!info || !info.subjectId) {
              detailArea.empty();
              detailArea.createEl(
                "p",
                {
                  text: "\u65E0\u6CD5\u8BFB\u53D6\u8FD9\u90E8\u52A8\u753B\u7684\u4FE1\u606F\u3002"
                }
              );
              return;
            }
            detailArea.empty();
            detailArea.createEl(
              "h3",
              {
                text: "\u5DF2\u9009\u62E9\uFF1A\u300A" + (info.CN || result.title) + "\u300B"
              }
            );
            detailArea.createEl(
              "p",
              {
                text: "\u65E5\u6587\u540D\uFF1A" + (info.JP || "\u672A\u77E5") + "\n\u5F00\u64AD\u65E5\u671F\uFF1A" + (info.date || "\u672A\u77E5") + "\nBGM\u8BC4\u5206\uFF1A" + (info.rating || "\u672A\u77E5")
              }
            );
            const selectButton = detailArea.createEl(
              "button",
              {
                text: "\u4FDD\u5B58\u6B64\u52A8\u753B"
              }
            );
            selectButton.style.marginTop = "10px";
            selectButton.onclick = async () => {
              selectButton.disabled = true;
              selectButton.textContent = "\u6B63\u5728\u4FDD\u5B58\u2026\u2026";
              this.plugin.settings.netabaCompareUrl = result.url;
              this.plugin.settings.netabaCompareTitle = info.CN || info.JP || result.title;
              await this.plugin.saveSettings();
              new Notice3(
                "\u5DF2\u4FDD\u5B58\u5BF9\u6BD4\u52A8\u753B\uFF1A" + this.plugin.settings.netabaCompareTitle,
                5e3
              );
              this.close();
              if (this.onSelected) {
                this.onSelected();
              }
            };
          } catch (error) {
            console.error(
              "\u8BFB\u53D6\u5BF9\u6BD4\u52A8\u753B\u4FE1\u606F\u5931\u8D25:",
              error
            );
            detailArea.empty();
            detailArea.createEl(
              "p",
              {
                text: "\u8BFB\u53D6\u52A8\u753B\u4FE1\u606F\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
              }
            );
          }
        }
        onClose() {
          this.contentEl.empty();
        }
      };
      return {
        NetabaNoteManagerModal: NetabaNoteManagerModal2,
        NetabaPageSelectModal: NetabaPageSelectModal2,
        NetabaCompareSelectModal: NetabaCompareSelectModal2
      };
    };
  }
});

// src/main.js
var {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice: Notice2,
  Modal,
  ItemView,
  Menu
} = require("obsidian");
globalThis.__BangumiManagerModal = Modal;
globalThis.__BangumiManagerNotice = Notice2;
var openSingleAnimeImport;
var openBatchAnimeImport;
var BangumiManagerSettingTab;
var NetabaNoteManagerModal;
var NetabaPageSelectModal;
var NetabaCompareSelectModal;
var noteUtils = require_note_utils();
var {
  cleanValue,
  parseFrontmatter,
  extractWatchedEpisodes,
  inspectLocalFolder,
  getLocalStatusText,
  updateFrontmatterField,
  updateScoreFields,
  synchronizeBangumiScoreFields,
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
  addNoteTag,
  removeNoteTag,
  syncNoteCalloutFromFrontmatter,
  openLocalPathSafely
} = noteUtils;
var netabaTrendService = require_netaba_trend_service();
var NetabaTrendModal = netabaTrendService.createNetabaTrendModalClass({ Modal, Notice: Notice2 });
var bangumiApi = require_bangumi_api();
var importManager = require_import_manager();
var batchImportManager = require_batch_import_manager();
var createSettingsTabClass = require_settings_tab();
var { RatingSyncManager } = require_rating_sync_manager();
var createNetabaModals = require_netaba_modals();
var DEFAULT_SETTINGS = {
  mode: "lazy",
  noteRootFolder: "\u52A8\u753B\u7B14\u8BB0",
  coverFolder: "\u9644\u4EF6/Bangumi Images",
  baseFilePath: "\u52A8\u753B\u7B14\u8BB0/\u8FFD\u756A\u5E7F\u573A/\u52A8\u753B\u5E93.base",
  baseFolderPath: "\u52A8\u753B\u7B14\u8BB0/\u8FFD\u756A\u5E7F\u573A",
  baseFolderPathManuallySet: false,
  localAnimeRoot: "D:/ACG/Obsidian ACG",
  checkIntervalSeconds: 60,
  checkOnStartup: true,
  checkOnSave: true,
  seasonViewMode: "none",
  showManagerRibbon: false,
  bangumiUserId: "",
  batchLastUserId: "",
  batchCreateDownloadFolder: false,
  showBangumiUserScore: true,
  showPersonalScore: true,
  monitorBangumiUserScore: true,
  bangumiRatingCache: {},
  bangumiPublicRatingCache: {},
  bangumiPreciseRatingCache: {},
  personalRatingCache: {},
  ratingCacheTtlSeconds: 86400,
  ratingDetailRequestConcurrency: 3,
  ratingDetailRequestIntervalMs: 300,
  ratingRequestTimeoutMs: 15e3,
  ratingRequestRetryCount: 2,
  ratingUserListPageIntervalMs: 400,
  bangumiRatingCacheMeta: {},
  bangumiPublicRatingCacheMeta: {},
  bangumiPreciseRatingCacheMeta: {},
  netabaUserId: "",
  netabaUserIdManuallySet: false,
  netabaCompareUrl: "",
  netabaCompareTitle: "",
  netabaDefaultPage: "subject",
  netabaEmbedEnabled: true,
  netabaCollapsedByDefault: true,
  animeInfoCollapsedByDefault: false,
  dashboardPath: "",
  dashboardPathManuallySet: false,
  dashboardPersonalRankLimit: 10,
  dashboardBangumiRankLimit: 10,
  dashboardShowDistribution: true,
  dashboardShowWatchState: true,
  dashboardAutoRefresh: true,
  showDashboardRibbon: true,
  markdownDashboardEnabled: true,
  ratingMonitorEnabled: true,
  ratingRefreshPromptDisabled: false,
  ratingRefreshPromptMode: "ask",
  ratingMonitorSeconds: 900,
  lastRatingMonitorAt: 0,
  monitorBangumiPublicScore: true,
  dashboardShowPreciseRank: false,
  showBangumiPreciseScore: false,
  bangumiPreciseScoreDisplayDigits: 4,
  dashboardSectionOrder: [],
  dashboardSectionCollapsed: {},
  dashboardSectionHidden: {},
  dashboardShowProgressStats: true,
  dashboardShowYearStats: true,
  dashboardShowScoreDelta: true,
  dashboardShowStudioStats: true,
  customQuerySections: [],
  customCollectionSections: []
};
var DEFAULT_PRESET_QUERY_SECTION = {
  id: "preset_currently_watching",
  title: "\u6B63\u5728\u8FFD\u756A",
  tag: "",
  watchStatus: "\u5728\u770B",
  minMyScore: 0,
  minBgmScore: 0,
  year: "",
  season: "",
  displayMode: "grid",
  sortBy: "year_desc",
  limit: 0
};
DEFAULT_SETTINGS.customQuerySections = [DEFAULT_PRESET_QUERY_SECTION];
var WATCH_STATES = [
  "\u5DF2\u770B",
  "\u5728\u770B",
  "\u60F3\u770B",
  "\u629B\u5F03"
];
var BANGUMI_SCORE_DASHBOARD_VIEW_TYPE = "bangumi-score-dashboard-view";
var BangumiScoreDashboardView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return BANGUMI_SCORE_DASHBOARD_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u52A8\u753B\u4EEA\u8868\u76D8";
  }
  getIcon() {
    return "chart-no-axes-combined";
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass(
      "bangumi-score-dashboard-view"
    );
    const toolbar = this.contentEl.createDiv(
      "bangumi-dashboard-view-toolbar"
    );
    toolbar.createEl("h2", {
      text: "\u52A8\u753B\u4EEA\u8868\u76D8"
    });
    const controls = toolbar.createDiv(
      "bangumi-dashboard-view-controls"
    );
    const addSectionButton = controls.createEl("button", {
      text: "+ \u65B0\u5EFA\u67E5\u8BE2\u5206\u533A",
      cls: "mod-cta"
    });
    const addCollectionButton = controls.createEl("button", {
      text: "+ \u65B0\u5EFA\u6536\u85CF\u5C55\u67DC",
      cls: "mod-cta"
    });
    const refreshButton = controls.createEl("button", {
      text: "\u5237\u65B0"
    });
    const resetButton = controls.createEl("button", {
      text: "\u6062\u590D\u9ED8\u8BA4\u5E03\u5C40"
    });
    const markdownButton = controls.createEl("button", {
      text: "\u6253\u5F00 Markdown"
    });
    const dashboard = this.contentEl.createDiv(
      "bangumi-score-dashboard"
    );
    this.dashboardEl = dashboard;
    addSectionButton.onclick = () => {
      this.plugin.openCustomQuerySectionModal(null, async () => {
        await this.refresh();
      });
    };
    addCollectionButton.onclick = () => {
      this.plugin.openCustomCollectionModal(null, async () => {
        await this.refresh();
      });
    };
    refreshButton.onclick = async () => {
      refreshButton.disabled = true;
      try {
        await this.plugin.refreshScoreDashboard(true);
        await this.refresh();
      } finally {
        refreshButton.disabled = false;
      }
    };
    resetButton.onclick = async () => {
      await this.plugin.resetScoreDashboardLayout(
        dashboard,
        { isMarkdown: false }
      );
    };
    markdownButton.onclick = async () => {
      await this.plugin.openScoreDashboard();
    };
    await this.refresh();
  }
  async refresh() {
    if (this.dashboardEl) {
      await this.plugin.renderScoreDashboard(this.dashboardEl, { isMarkdown: false });
    }
  }
  async onClose() {
    this.dashboardEl = null;
    this.contentEl.empty();
  }
};
var BangumiManagerPlugin = class extends Plugin {
  getWatchStateClass(state) {
    return state || "\u672A\u8BBE\u7F6E";
  }
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      savedSettings || {}
    );
    const validRatingRefreshPromptModes = [
      "ask",
      "later",
      "update"
    ];
    if (!validRatingRefreshPromptModes.includes(
      savedSettings && savedSettings.ratingRefreshPromptMode
    )) {
      this.settings.ratingRefreshPromptMode = savedSettings && savedSettings.ratingRefreshPromptDisabled === true ? "later" : "ask";
    }
    this.settings.ratingRefreshPromptDisabled = this.settings.ratingRefreshPromptMode !== "ask";
    if (typeof this.settings.netabaUserIdManuallySet !== "boolean") {
      this.settings.netabaUserIdManuallySet = Boolean(
        savedSettings && savedSettings.netabaUserId && savedSettings.netabaUserId !== savedSettings.bangumiUserId
      );
    }
    if (this.settings.netabaUserIdManuallySet !== true) {
      this.settings.netabaUserId = String(
        this.settings.bangumiUserId || ""
      ).trim();
    }
    if (typeof this.settings.baseFolderPathManuallySet !== "boolean") {
      this.settings.baseFolderPathManuallySet = false;
    }
    if (typeof this.settings.dashboardPathManuallySet !== "boolean") {
      this.settings.dashboardPathManuallySet = false;
    }
    if (this.settings.baseFolderPathManuallySet === true) {
      this.settings.baseFolderPath = this.normalizeDashboardPath(
        this.settings.baseFolderPath
      ) || this.getDefaultManagerFolderPath();
    } else {
      this.settings.baseFolderPath = this.getDefaultManagerFolderPath();
    }
    if (this.settings.dashboardPathManuallySet === true) {
      this.settings.dashboardPath = this.normalizeDashboardPath(
        this.settings.dashboardPath
      ) || this.getDefaultDashboardPath();
    } else {
      this.settings.dashboardPath = this.getDefaultDashboardPath();
    }
    this.settings.baseFilePath = this.settings.baseFolderPath + "/\u52A8\u753B\u5E93.base";
    if (!Array.isArray(this.settings.customQuerySections)) {
      this.settings.customQuerySections = [];
    }
    if (this.settings.customQuerySections.length === 0) {
      this.settings.customQuerySections = [Object.assign({}, DEFAULT_PRESET_QUERY_SECTION)];
    }
    if (!Array.isArray(this.settings.customCollectionSections)) {
      this.settings.customCollectionSections = [];
    }
    this.isPluginWritingNote = /* @__PURE__ */ new Set();
    this.calloutSyncTimers = /* @__PURE__ */ new Map();
    await this.saveData(this.settings);
    this.ratingSync = new RatingSyncManager(this);
    const netabaModals = createNetabaModals({
      Modal,
      Notice: Notice2,
      bangumiApi
    });
    NetabaNoteManagerModal = netabaModals.NetabaNoteManagerModal;
    NetabaPageSelectModal = netabaModals.NetabaPageSelectModal;
    NetabaCompareSelectModal = netabaModals.NetabaCompareSelectModal;
    openSingleAnimeImport = importManager.openSingleAnimeImport;
    openBatchAnimeImport = batchImportManager.openBatchAnimeImport;
    BangumiManagerSettingTab = createSettingsTabClass({
      PluginSettingTab,
      Setting,
      Notice: Notice2,
      Modal,
      openSingleAnimeImport,
      openBatchAnimeImport,
      NetabaCompareSelectModal
    });
    cleanValue = noteUtils.cleanValue;
    parseFrontmatter = noteUtils.parseFrontmatter;
    extractWatchedEpisodes = noteUtils.extractWatchedEpisodes;
    inspectLocalFolder = noteUtils.inspectLocalFolder;
    getLocalStatusText = noteUtils.getLocalStatusText;
    updateFrontmatterField = noteUtils.updateFrontmatterField;
    updateScoreFields = noteUtils.updateScoreFields;
    synchronizeBangumiScoreFields = noteUtils.synchronizeBangumiScoreFields;
    updateFolderLine = noteUtils.updateFolderLine;
    updateNetabaIframeUrl = noteUtils.updateNetabaIframeUrl;
    getNetabaPageName = noteUtils.getNetabaPageName;
    updateNetabaSection = noteUtils.updateNetabaSection;
    extractBaseViewNames = noteUtils.extractBaseViewNames;
    removeBaseViews = noteUtils.removeBaseViews;
    hasBaseView = noteUtils.hasBaseView;
    appendSeasonView = noteUtils.appendSeasonView;
    updateWatchedEpisodes = noteUtils.updateWatchedEpisodes;
    updateCalloutTableRow = noteUtils.updateCalloutTableRow;
    addNoteTag = noteUtils.addNoteTag;
    removeNoteTag = noteUtils.removeNoteTag;
    openLocalPathSafely = noteUtils.openLocalPathSafely;
    this.addSettingTab(
      new BangumiManagerSettingTab(
        this.app,
        this
      )
    );
    this.registerView(
      BANGUMI_SCORE_DASHBOARD_VIEW_TYPE,
      (leaf) => {
        return new BangumiScoreDashboardView(
          leaf,
          this
        );
      }
    );
    this.addCommand({
      id: "open-score-dashboard",
      name: "\u6253\u5F00\u52A8\u753B\u4EEA\u8868\u76D8",
      callback: async () => {
        await this.openScoreDashboardView();
      }
    });
    this.addCommand({
      id: "initialize-missing-files",
      name: "\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6",
      callback: async () => {
        await this.initializeMissingFiles();
      }
    });
    this.addCommand({
      id: "check-all-local-status",
      name: "\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001",
      callback: async () => {
        await this.checkAllLocalStatus(true);
      }
    });
    this.addCommand({
      id: "generate-season-views",
      name: "\u8865\u9F50\u5B63\u5EA6\u89C6\u56FE",
      callback: async () => {
        await this.generateSeasonViews(true);
      }
    });
    this.addCommand({
      id: "import-single-anime",
      name: "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
      callback: async () => {
        await openSingleAnimeImport(
          this.app,
          this
        );
      }
    });
    this.addCommand({
      id: "import-batch-anime",
      name: "\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
      callback: async () => {
        await openBatchAnimeImport(
          this.app,
          this
        );
      }
    });
    this.addCommand({
      id: "select-season-views-to-remove",
      name: "\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u6E05\u7406",
      callback: async () => {
        await this.openSeasonViewCleanup();
      }
    });
    this.addCommand({
      id: "clean-completed-season-views",
      name: "\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE",
      callback: async () => {
        await this.cleanCompletedSeasonViews(true);
      }
    });
    this.addCommand({
      id: "batch-change-watch-status",
      name: "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
      callback: async () => {
        await this.openBatchStatusManager();
      }
    });
    this.registerEvent(
      this.app.vault.on(
        "modify",
        (file) => {
          if (!this.settings.checkOnSave || !this.isTargetNote(file)) {
            return;
          }
          if (this.ratingSync && this.ratingSync.isSelfWrite(file.path)) {
            return;
          }
          clearTimeout(
            this.saveCheckTimer
          );
          this.saveCheckTimer = setTimeout(
            async () => {
              try {
                await this.checkOneLocalStatus(
                  file
                );
              } catch (error) {
                console.error(
                  "\u4FDD\u5B58\u540E\u68C0\u67E5\u672C\u5730\u72B6\u6001\u5931\u8D25:",
                  error
                );
              }
            },
            1200
          );
        }
      )
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.isTargetNote(file)) {
          return;
        }
        if (this.ratingSync && this.ratingSync.isSelfWrite(file.path)) {
          return;
        }
        if (this.isPluginWritingNote && this.isPluginWritingNote.has(file.path)) {
          return;
        }
        if (!this.calloutSyncTimers) {
          this.calloutSyncTimers = /* @__PURE__ */ new Map();
        }
        if (this.calloutSyncTimers.has(file.path)) {
          clearTimeout(this.calloutSyncTimers.get(file.path));
        }
        const calloutTimer = setTimeout(async () => {
          if (this.calloutSyncTimers) {
            this.calloutSyncTimers.delete(file.path);
          }
          await this.autoSyncNoteCallout(file);
        }, 1200);
        this.calloutSyncTimers.set(file.path, calloutTimer);
        clearTimeout(this.dashboardAutoRefreshTimer);
        this.dashboardAutoRefreshTimer = setTimeout(async () => {
          await this.refreshOpenDashboardViews();
        }, 800);
      })
    );
    if (this.settings.checkOnStartup) {
      this.startupTimer = window.setTimeout(
        async () => {
          await this.checkAllLocalStatus(false);
          try {
            await this.refreshBangumiRatingsSilently();
          } catch (error) {
            console.error(
              "\u542F\u52A8\u540E\u8BC4\u5206\u76D1\u6D4B\u5931\u8D25:",
              error
            );
          }
        },
        5e3
      );
    }
    this.registerNetabaMarkdownProcessor();
    this.registerScoreDashboardProcessor();
    this.registerScoreDashboardStyles();
    this.refreshManagerRibbon();
    this.refreshDashboardRibbon();
    this.startStatusTimer();
  }
  onunload() {
    this.unloaded = true;
    this.stopStatusTimer();
    clearTimeout(this.saveCheckTimer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.dashboardAutoRefreshTimer);
    if (this.calloutSyncTimers) {
      for (const t of this.calloutSyncTimers.values()) {
        clearTimeout(t);
      }
      this.calloutSyncTimers.clear();
    }
    if (this.dashboardRibbon) {
      this.dashboardRibbon.remove();
      this.dashboardRibbon = null;
    }
  }
  async saveSettings() {
    if (this.unloaded) {
      return;
    }
    await this.saveData(this.settings);
    this.startStatusTimer();
  }
  startStatusTimer() {
    if (this.unloaded) {
      return;
    }
    this.stopStatusTimer();
    const seconds = Math.max(
      10,
      Number(
        this.settings.checkIntervalSeconds
      ) || 60
    );
    this.statusTimer = window.setInterval(
      async () => {
        await this.checkAllLocalStatus(false);
        const ratingMonitorSeconds = Math.max(
          60,
          Number(
            this.settings.ratingMonitorSeconds
          ) || 900
        );
        const ratingMonitorDue = !this.settings.lastRatingMonitorAt || Date.now() - this.settings.lastRatingMonitorAt >= ratingMonitorSeconds * 1e3;
        if (ratingMonitorDue) {
          try {
            await this.refreshBangumiRatingsSilently();
          } catch (error) {
            console.error(
              "\u540E\u53F0\u8BC4\u5206\u76D1\u6D4B\u5931\u8D25:",
              error
            );
          }
        }
      },
      seconds * 1e3
    );
  }
  stopStatusTimer() {
    if (this.statusTimer) {
      window.clearInterval(
        this.statusTimer
      );
      this.statusTimer = null;
    }
  }
  refreshManagerRibbon() {
    if (this.managerRibbon) {
      this.managerRibbon.remove();
      this.managerRibbon = null;
    }
    if (!this.settings.showManagerRibbon) {
      return;
    }
    this.managerRibbon = this.addRibbonIcon(
      "library",
      "Bangumi \u8FFD\u756A\u7BA1\u7406\u5668",
      () => {
        new ManagerRibbonModal(
          this.app,
          this
        ).open();
      }
    );
  }
  refreshDashboardRibbon() {
    if (this.dashboardRibbon) {
      this.dashboardRibbon.remove();
      this.dashboardRibbon = null;
    }
    if (this.settings.showDashboardRibbon === false) {
      return;
    }
    this.dashboardRibbon = this.addRibbonIcon(
      "chart-no-axes-combined",
      "\u6253\u5F00\u52A8\u753B\u4EEA\u8868\u76D8",
      async () => {
        await this.openScoreDashboardView();
      }
    );
  }
  isTargetNote(file) {
    return Boolean(
      file && file.extension === "md" && file.path.startsWith(
        this.settings.noteRootFolder + "/"
      )
    );
  }
  getCurrentSeasonName() {
    const now = /* @__PURE__ */ new Date();
    const month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (month === 12) {
      year += 1;
      return year + "\u5E7401\u6708\u65B0\u756A";
    }
    if (month === 1 || month === 2) {
      return year + "\u5E7401\u6708\u65B0\u756A";
    }
    if (month === 3 || month === 4 || month === 5) {
      return year + "\u5E7404\u6708\u65B0\u756A";
    }
    if (month === 6 || month === 7 || month === 8) {
      return year + "\u5E7407\u6708\u65B0\u756A";
    }
    return year + "\u5E7410\u6708\u65B0\u756A";
  }
  async runTemporarySeasonMode(mode) {
    const oldMode = this.settings.seasonViewMode;
    this.settings.seasonViewMode = mode;
    try {
      await this.generateSeasonViews(true);
    } finally {
      this.settings.seasonViewMode = oldMode;
    }
  }
  async initializeMissingFiles() {
    await this.ensureVaultFolder(
      this.settings.noteRootFolder
    );
    await this.ensureVaultFolder(
      this.settings.coverFolder
    );
    await this.createBaseFileIfMissing();
    if (this.settings.markdownDashboardEnabled !== false) {
      await this.ensureScoreDashboard(false);
    }
    new Notice2(
      "\u5DF2\u6309\u5F53\u524D\u8DEF\u5F84\u8BBE\u7F6E\u5B8C\u6210\u521D\u59CB\u5316\u68C0\u67E5\u3002\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u8986\u76D6\u3002",
      6e3
    );
  }
  async ensureVaultFolder(folderPath) {
    if (!folderPath) {
      return;
    }
    if (this.app.vault.getAbstractFileByPath(
      folderPath
    )) {
      return;
    }
    try {
      await this.app.vault.createFolder(
        folderPath
      );
    } catch (error) {
      if (!this.app.vault.getAbstractFileByPath(
        folderPath
      )) {
        throw error;
      }
    }
  }
  async createBaseFileIfMissing() {
    const baseFolderPath = String(
      this.settings.baseFolderPath || ""
    ).trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/[\\/]+$/, "");
    const filePath = baseFolderPath ? baseFolderPath + "/\u52A8\u753B\u5E93.base" : "\u52A8\u753B\u5E93.base";
    if (!filePath) {
      new Notice2(
        "\u52A8\u753B\u5E93 Base \u6587\u4EF6\u8DEF\u5F84\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u8BBE\u7F6E\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55\u6216\u52A8\u753B\u5E93\u6587\u4EF6\u8DEF\u5F84\u3002",
        6e3
      );
      return;
    }
    if (this.app.vault.getAbstractFileByPath(
      filePath
    )) {
      return;
    }
    const lastSlash = filePath.lastIndexOf("/");
    const folderPath = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
    if (folderPath) {
      await this.ensureVaultFolder(folderPath);
    }
    const content = `filters:
  and:
    - file.tags.contains("bangumi")
views:
  - type: cards
    name: \u5168\u90E8\u52A8\u753B
    order:
      - file.name
      - \u89C2\u770B\u72B6\u6001
      - BGM\u8BC4\u5206
    cardSize: 180
    image: note.cover
    imageAspectRatio: 1
`;
    try {
      await this.app.vault.create(
        filePath,
        content
      );
    } catch (error) {
      console.error(
        "\u521B\u5EFA\u52A8\u753B\u5E93 Base \u6587\u4EF6\u5931\u8D25:",
        filePath,
        error
      );
      new Notice2(
        "\u521B\u5EFA\u52A8\u753B\u5E93 Base \u6587\u4EF6\u5931\u8D25\uFF1A" + filePath + "\u3002\u8BF7\u68C0\u67E5\u8DEF\u5F84\u662F\u5426\u4F4D\u4E8E\u5F53\u524D\u4ED3\u5E93\u5185\uFF0C\u4EE5\u53CA\u7236\u76EE\u5F55\u662F\u5426\u53EF\u5199\u3002",
        8e3
      );
    }
  }
  async countBangumiNotesForScoreRefresh() {
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      const parsed = parseFrontmatter(content);
      if (!parsed || !String(parsed.fields.tags || "").includes("bangumi")) {
        continue;
      }
      const subjectId = bangumiApi.getSubjectId(
        cleanValue(parsed.fields.BGM\u94FE\u63A5)
      );
      if (subjectId) {
        count += 1;
      }
    }
    return count;
  }
  async refreshBangumiRatingsSilently() {
    if (this.settings.ratingMonitorEnabled === false) {
      return {
        skipped: true,
        reason: "\u81EA\u52A8\u66F4\u65B0\u5DF2\u5173\u95ED"
      };
    }
    return await this.ratingSync.start({
      forceRefresh: false,
      mode: "standard"
    });
  }
  getScoreDisplayOptions() {
    return {
      useBangumiPreciseScore: this.settings.showBangumiPreciseScore === true,
      bangumiPreciseScoreDisplayDigits: this.settings.bangumiPreciseScoreDisplayDigits
    };
  }
  getDisplayedBangumiScore(subjectId, fields) {
    const publicCache = Object.assign(
      {},
      this.settings.bangumiPublicRatingCache || {}
    );
    const preciseCache = Object.assign(
      {},
      this.settings.bangumiPreciseRatingCache || {}
    );
    if (this.settings.showBangumiPreciseScore === true) {
      return cleanValue(
        preciseCache[subjectId]
      ) || cleanValue(fields.BGM\u8BC4\u5206);
    }
    return cleanValue(
      publicCache[subjectId]
    ) || cleanValue(fields.BGM\u8BC4\u5206);
  }
  async refreshScoreDisplayFields() {
    const displayOptions = this.getScoreDisplayOptions();
    const publicCache = Object.assign(
      {},
      this.settings.bangumiPublicRatingCache || {}
    );
    const preciseCache = Object.assign(
      {},
      this.settings.bangumiPreciseRatingCache || {}
    );
    const bangumiRatingCache = Object.assign(
      {},
      this.settings.bangumiRatingCache || {}
    );
    const personalRatingCache = Object.assign(
      {},
      this.settings.personalRatingCache || {}
    );
    let scanned = 0;
    let updated = 0;
    let failed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      try {
        const content = await this.app.vault.read(file);
        const parsed = parseFrontmatter(content);
        if (!parsed || !String(parsed.fields.tags || "").includes("bangumi")) {
          continue;
        }
        const subjectId = bangumiApi.getSubjectId(
          cleanValue(parsed.fields.BGM\u94FE\u63A5)
        );
        if (!subjectId) {
          continue;
        }
        const legacyPreciseScore = cleanValue(
          parsed.fields.BGM\u7CBE\u786E\u8BC4\u5206
        );
        if (legacyPreciseScore && !preciseCache[subjectId]) {
          preciseCache[subjectId] = legacyPreciseScore;
        }
        if (parsed.fields.BGM\u8BC4\u5206 && !publicCache[subjectId]) {
          publicCache[subjectId] = cleanValue(parsed.fields.BGM\u8BC4\u5206);
        }
        scanned += 1;
        const displayedScore = this.getDisplayedBangumiScore(
          subjectId,
          parsed.fields
        );
        const oldBangumiScore = cleanValue(
          parsed.fields.BGM\u7528\u6237\u8BC4\u5206 || parsed.fields.Bangumi\u7528\u6237\u8BC4\u5206
        );
        const oldPersonalScore = cleanValue(
          parsed.fields.\u6211\u7684\u8BC4\u5206
        );
        if (oldBangumiScore && oldBangumiScore !== "\u672A\u8BC4\u5206" && oldBangumiScore !== "\u672A\u77E5") {
          bangumiRatingCache[subjectId] = oldBangumiScore;
        }
        if (oldPersonalScore && oldPersonalScore !== "\u672A\u8BC4\u5206" && oldPersonalScore !== "\u672A\u77E5") {
          personalRatingCache[file.path] = oldPersonalScore;
        }
        let newContent = synchronizeBangumiScoreFields(
          content,
          displayOptions,
          {
            bangumiScore: displayedScore
          }
        );
        newContent = updateScoreFields(
          newContent,
          this.settings.showBangumiUserScore !== false ? bangumiRatingCache[subjectId] || oldBangumiScore || "\u672A\u8BC4\u5206" : null,
          this.settings.showPersonalScore !== false ? oldPersonalScore || personalRatingCache[file.path] || "\u672A\u8BC4\u5206" : null
        );
        if (newContent !== content) {
          await this.app.vault.modify(file, newContent);
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        console.warn(
          "\u5237\u65B0\u8BC4\u5206\u663E\u793A\u5931\u8D25:",
          file.path,
          error
        );
      }
    }
    this.settings.bangumiPublicRatingCache = publicCache;
    this.settings.bangumiPreciseRatingCache = preciseCache;
    this.settings.bangumiRatingCache = bangumiRatingCache;
    this.settings.personalRatingCache = personalRatingCache;
    await this.saveSettings();
    await this.refreshScoreDashboard(false);
    return {
      scanned,
      updated,
      failed
    };
  }
  async refreshPreciseRatingsSilently(manual = false) {
    const preciseEnabled = this.settings.showBangumiPreciseScore === true || this.settings.dashboardShowPreciseRank === true;
    const skippedSummary = {
      scanned: 0,
      requested: 0,
      preciseUpdated: 0,
      notesUpdated: 0,
      noData: 0,
      failed: 0,
      skipped: true
    };
    if (!preciseEnabled) {
      return skippedSummary;
    }
    if (!manual && this.settings.ratingMonitorEnabled === false) {
      return skippedSummary;
    }
    const task = await this.ratingSync.start({
      forceRefresh: false,
      mode: "preciseOnly"
    });
    return {
      scanned: task.scanned,
      requested: task.requested,
      preciseUpdated: task.preciseRatingsUpdated,
      notesUpdated: task.notesUpdated,
      noData: task.noData,
      failed: task.failed,
      skipped: false,
      wasStopped: task.wasStopped === true
    };
  }
  async refreshScoreFields() {
    const files = this.app.vault.getMarkdownFiles();
    const bangumiRatingCache = Object.assign(
      {},
      this.settings.bangumiRatingCache || {}
    );
    const personalRatingCache = Object.assign(
      {},
      this.settings.personalRatingCache || {}
    );
    let updated = 0;
    for (const file of files) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      try {
        const content = await this.app.vault.read(
          file
        );
        const parsed = parseFrontmatter(
          content
        );
        if (!parsed) {
          continue;
        }
        const tags = String(
          parsed.fields.tags || ""
        );
        if (!tags.includes("bangumi")) {
          continue;
        }
        const subjectId = bangumiApi.getSubjectId(
          cleanValue(
            parsed.fields.BGM\u94FE\u63A5
          )
        );
        if (!subjectId) {
          continue;
        }
        const oldBangumiScore = cleanValue(
          parsed.fields.BGM\u7528\u6237\u8BC4\u5206 || parsed.fields.Bangumi\u7528\u6237\u8BC4\u5206
        );
        const oldPersonalScore = cleanValue(
          parsed.fields.\u6211\u7684\u8BC4\u5206
        );
        if (oldBangumiScore && oldBangumiScore !== "\u672A\u8BC4\u5206" && oldBangumiScore !== "\u672A\u77E5" && oldBangumiScore !== "\u6B63\u5728\u8BFB\u53D6") {
          bangumiRatingCache[subjectId] = oldBangumiScore;
        }
        if (oldPersonalScore && oldPersonalScore !== "\u672A\u8BC4\u5206" && oldPersonalScore !== "\u672A\u77E5") {
          personalRatingCache[file.path] = oldPersonalScore;
        }
        const bgmScore = bangumiRatingCache[subjectId] || oldBangumiScore || "\u672A\u8BC4\u5206";
        const personalScore = oldPersonalScore || personalRatingCache[file.path] || "\u672A\u8BC4\u5206";
        const newContent = updateScoreFields(
          content,
          this.settings.showBangumiUserScore !== false ? bgmScore : null,
          this.settings.showPersonalScore !== false ? personalScore : null
        );
        if (newContent !== content) {
          await this.app.vault.modify(
            file,
            newContent
          );
          updated += 1;
        }
      } catch (error) {
        console.error(
          "\u5237\u65B0\u8BC4\u5206\u5B57\u6BB5\u5931\u8D25:",
          file.path,
          error
        );
      }
    }
    this.settings.bangumiRatingCache = bangumiRatingCache;
    this.settings.personalRatingCache = personalRatingCache;
    await this.saveSettings();
    await this.refreshScoreDashboard(false);
    if (updated > 0) {
      new Notice2(
        "\u5DF2\u66F4\u65B0 " + updated + " \u7BC7\u52A8\u753B\u7B14\u8BB0\u7684\u8BC4\u5206\u663E\u793A\u3002",
        5e3
      );
    }
  }
  async checkAllLocalStatus(showNotice) {
    const files = this.app.vault.getMarkdownFiles();
    let checked = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const file of files) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      checked += 1;
      try {
        const result = await this.checkOneLocalStatus(
          file
        );
        if (result === "updated") {
          updated += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(
          "\u672C\u5730\u72B6\u6001\u68C0\u67E5\u5931\u8D25:",
          file.path,
          error
        );
      }
    }
    if (showNotice) {
      new Notice2(
        "\u672C\u5730\u72B6\u6001\u68C0\u67E5\u5B8C\u6210\uFF1A\u68C0\u67E5 " + checked + " \u7BC7\uFF0C\u66F4\u65B0 " + updated + " \u7BC7\uFF0C\u8DF3\u8FC7 " + skipped + " \u7BC7\uFF0C\u5931\u8D25 " + failed + " \u7BC7",
        8e3
      );
    }
  }
  async checkOneLocalStatus(file) {
    const content = await this.app.vault.read(file);
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      return "skipped";
    }
    const tags = String(
      frontmatter.fields.tags || ""
    );
    if (!tags.includes("bangumi")) {
      return "skipped";
    }
    const downloadPath = cleanValue(
      frontmatter.fields.\u4E0B\u8F7D\u8DEF\u5F84
    );
    const watchedEpisodes = extractWatchedEpisodes(content);
    const result = inspectLocalFolder(
      downloadPath,
      watchedEpisodes
    );
    const newContent = updateFolderLine(
      updateFrontmatterField(
        content,
        "\u672C\u5730\u66F4\u65B0\u72B6\u6001",
        getLocalStatusText(result)
      ),
      result
    );
    if (newContent === content) {
      return "skipped";
    }
    await this.app.vault.modify(
      file,
      newContent
    );
    return "updated";
  }
  async generateSeasonViews(showNotice) {
    const baseFile = this.app.vault.getAbstractFileByPath(
      this.settings.baseFilePath
    );
    if (!baseFile) {
      await this.createBaseFileIfMissing();
    }
    const actualBaseFile = this.app.vault.getAbstractFileByPath(
      this.settings.baseFilePath
    );
    if (!actualBaseFile) {
      return;
    }
    const seasons = await this.collectSeasonNames();
    let seasonList = [...seasons];
    if (this.settings.seasonViewMode === "current") {
      const currentSeason = this.getCurrentSeasonName();
      seasonList = [currentSeason];
    }
    let baseContent = await this.app.vault.read(
      actualBaseFile
    );
    let addedCount = 0;
    for (const seasonName of seasonList) {
      if (hasBaseView(
        baseContent,
        seasonName
      )) {
        continue;
      }
      baseContent = appendSeasonView(
        baseContent,
        seasonName
      );
      addedCount += 1;
    }
    if (addedCount > 0) {
      await this.app.vault.modify(
        actualBaseFile,
        baseContent
      );
    }
    if (showNotice) {
      new Notice2(
        addedCount > 0 ? "\u5DF2\u65B0\u589E " + addedCount + " \u4E2A\u5B63\u5EA6\u89C6\u56FE\u3002" : "\u6CA1\u6709\u9700\u8981\u65B0\u589E\u7684\u5B63\u5EA6\u89C6\u56FE\u3002",
        6e3
      );
    }
  }
  async collectSeasonNames() {
    const seasons = /* @__PURE__ */ new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) {
        continue;
      }
      const tags = String(
        frontmatter.fields.tags || ""
      );
      if (!tags.includes("bangumi")) {
        continue;
      }
      const year = cleanValue(
        frontmatter.fields.\u5F00\u64AD\u5E74\u4EFD
      );
      const season = cleanValue(
        frontmatter.fields.\u5F00\u64AD\u5B63\u5EA6
      );
      if (/^\d{4}$/.test(year) && /^\d{2}月新番$/.test(season)) {
        seasons.add(
          year + "\u5E74" + season
        );
      }
    }
    return seasons;
  }
  async readBaseViewNames() {
    const baseFile = this.app.vault.getAbstractFileByPath(
      this.settings.baseFilePath
    );
    if (!baseFile) {
      return [];
    }
    const content = await this.app.vault.read(baseFile);
    return extractBaseViewNames(content);
  }
  async openSeasonViewCleanup() {
    const viewNames = await this.readBaseViewNames();
    const removable = viewNames.filter(
      (name) => name !== "\u5168\u90E8\u52A8\u753B"
    );
    if (removable.length === 0) {
      new Notice2(
        "\u52A8\u753B\u5E93\u4E2D\u6CA1\u6709\u53EF\u6E05\u7406\u7684\u5B63\u5EA6\u89C6\u56FE\u3002",
        5e3
      );
      return;
    }
    new SeasonViewSelectModal(
      this.app,
      removable,
      async (selected) => {
        await this.removeSeasonViews(
          selected,
          true
        );
      }
    ).open();
  }
  async removeSeasonViews(selectedNames, showNotice) {
    const baseFile = this.app.vault.getAbstractFileByPath(
      this.settings.baseFilePath
    );
    if (!baseFile) {
      new Notice2(
        "\u52A8\u753B\u5E93\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u6267\u884C\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6\u3002",
        6e3
      );
      return;
    }
    const content = await this.app.vault.read(baseFile);
    const result = removeBaseViews(
      content,
      (name) => {
        return selectedNames.includes(
          name
        );
      }
    );
    if (result.removedCount === 0) {
      new Notice2(
        "\u6CA1\u6709\u5220\u9664\u4EFB\u4F55\u89C6\u56FE\u3002",
        5e3
      );
      return;
    }
    await this.app.vault.modify(
      baseFile,
      result.content
    );
    if (showNotice) {
      new Notice2(
        "\u5DF2\u5220\u9664 " + result.removedCount + " \u4E2A\u5B63\u5EA6\u89C6\u56FE\u3002\u201C\u5168\u90E8\u52A8\u753B\u201D\u672A\u53D7\u5F71\u54CD\u3002",
        6e3
      );
    }
  }
  async cleanCompletedSeasonViews(showNotice) {
    const baseFile = this.app.vault.getAbstractFileByPath(
      this.settings.baseFilePath
    );
    if (!baseFile) {
      new Notice2(
        "\u52A8\u753B\u5E93\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u6267\u884C\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6\u3002",
        6e3
      );
      return;
    }
    const completionMap = await this.getSeasonCompletionMap();
    const existingViewNames = await this.readBaseViewNames();
    const names = [...completionMap.entries()].filter(([name, complete]) => {
      return complete && existingViewNames.includes(
        name
      );
    }).map(([name]) => name);
    if (names.length === 0) {
      new Notice2(
        "\u6CA1\u6709\u7B26\u5408\u5B89\u5168\u6E05\u7406\u6761\u4EF6\u7684\u5B63\u5EA6\u89C6\u56FE\u3002",
        6e3
      );
      return;
    }
    new SeasonViewConfirmModal(
      this.app,
      names,
      async () => {
        await this.removeSeasonViews(
          names,
          showNotice
        );
      }
    ).open();
  }
  async getSeasonCompletionMap() {
    const result = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) {
        continue;
      }
      const tags = String(
        frontmatter.fields.tags || ""
      );
      if (!tags.includes("bangumi")) {
        continue;
      }
      const year = cleanValue(
        frontmatter.fields.\u5F00\u64AD\u5E74\u4EFD
      );
      const season = cleanValue(
        frontmatter.fields.\u5F00\u64AD\u5B63\u5EA6
      );
      const seasonName = year + "\u5E74" + season;
      if (!/^\d{4}年\d{2}月新番$/.test(
        seasonName
      )) {
        continue;
      }
      const watchState = cleanValue(
        frontmatter.fields.\u89C2\u770B\u72B6\u6001
      );
      let complete = false;
      if (watchState === "\u5DF2\u770B") {
        complete = true;
      } else {
        const totalEpisodes = Number(
          cleanValue(
            frontmatter.fields.\u603B\u96C6\u6570
          )
        );
        const watchedEpisodes = extractWatchedEpisodes(
          content
        );
        const localInfo = inspectLocalFolder(
          cleanValue(
            frontmatter.fields.\u4E0B\u8F7D\u8DEF\u5F84
          ),
          watchedEpisodes
        );
        complete = totalEpisodes > 0 && watchedEpisodes >= totalEpisodes && !localInfo.error && localInfo.fileCount >= totalEpisodes;
      }
      if (!result.has(seasonName)) {
        result.set(
          seasonName,
          complete
        );
      } else if (!complete) {
        result.set(
          seasonName,
          false
        );
      }
    }
    return result;
  }
  async openScoreDashboardView() {
    const leaves = this.app.workspace.getLeavesOfType(
      BANGUMI_SCORE_DASHBOARD_VIEW_TYPE
    );
    let leaf = leaves[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(
        "tab"
      );
      await leaf.setViewState({
        type: BANGUMI_SCORE_DASHBOARD_VIEW_TYPE,
        active: true
      });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  normalizeDashboardPath(value) {
    return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/[\\/]+$/, "");
  }
  getDefaultManagerFolderPath() {
    const noteRoot = this.normalizeDashboardPath(
      this.settings.noteRootFolder
    );
    return noteRoot ? noteRoot + "/\u8FFD\u756A\u5E7F\u573A" : "\u8FFD\u756A\u5E7F\u573A";
  }
  getDefaultDashboardPath() {
    const base = this.getDefaultManagerFolderPath();
    const oldPath = base + "/\u52A8\u753B\u8BC4\u5206\u4EEA\u8868\u76D8.md";
    if (this.app && this.app.vault) {
      const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (oldFile) {
        return oldPath;
      }
    }
    return base + "/\u52A8\u753B\u4EEA\u8868\u76D8.md";
  }
  getDashboardPath() {
    const configuredPath = this.normalizeDashboardPath(
      this.settings.dashboardPath
    );
    if (!configuredPath) {
      return this.getDefaultDashboardPath();
    }
    return configuredPath.endsWith(".md") ? configuredPath : configuredPath + ".md";
  }
  getDashboardContent() {
    return [
      "---",
      "cssclasses:",
      "  - bangumi-dashboard",
      "---",
      "",
      "# \u52A8\u753B\u4EEA\u8868\u76D8",
      "",
      '<div class="bangumi-score-dashboard" data-bangumi-dashboard="true"></div>',
      ""
    ].join("\n");
  }
  async ensureScoreDashboard(forceOverwrite) {
    if (this.settings.markdownDashboardEnabled === false) {
      return null;
    }
    const dashboardPath = this.getDashboardPath();
    const lastSlash = dashboardPath.lastIndexOf("/");
    const folderPath = lastSlash >= 0 ? dashboardPath.slice(0, lastSlash) : "";
    if (folderPath) {
      await this.ensureVaultFolder(folderPath);
    }
    const existing = this.app.vault.getAbstractFileByPath(
      dashboardPath
    );
    const content = this.getDashboardContent();
    if (existing) {
      if (forceOverwrite) {
        await this.app.vault.modify(
          existing,
          content
        );
      }
      return existing;
    }
    return await this.app.vault.create(
      dashboardPath,
      content
    );
  }
  async openScoreDashboard() {
    if (this.settings.markdownDashboardEnabled === false) {
      new Notice2(
        "Markdown \u4EEA\u8868\u76D8\u5F53\u524D\u5DF2\u5173\u95ED\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u542F\u7528\u3002",
        5e3
      );
      return;
    }
    const file = await this.ensureScoreDashboard(false);
    if (!file) {
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }
  parseDashboardScore(value) {
    const score = Number(
      cleanValue(value)
    );
    return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
  }
  async collectDashboardItems() {
    const result = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      const parsed = parseFrontmatter(content);
      if (!parsed) {
        continue;
      }
      let rawTags = cleanValue(parsed.fields.tags || "");
      if (this.app.metadataCache) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache && cache.frontmatter && cache.frontmatter.tags) {
          const cacheTags = cache.frontmatter.tags;
          if (Array.isArray(cacheTags)) {
            const joined = cacheTags.join(", ");
            rawTags = rawTags ? `${rawTags}, ${joined}` : joined;
          } else if (typeof cacheTags === "string" && cacheTags) {
            rawTags = rawTags ? `${rawTags}, ${cacheTags}` : cacheTags;
          }
        }
      }
      if (!String(rawTags).includes("bangumi")) {
        continue;
      }
      const bgmLink = cleanValue(parsed.fields.BGM\u94FE\u63A5);
      const subjectId = bangumiApi.getSubjectId(bgmLink);
      result.push({
        file,
        name: cleanValue(
          parsed.fields.\u4E2D\u6587\u540D
        ) || file.basename,
        japaneseName: cleanValue(parsed.fields.\u65E5\u6587\u540D),
        cover: cleanValue(parsed.fields.cover),
        state: cleanValue(
          parsed.fields.\u89C2\u770B\u72B6\u6001
        ) || "\u672A\u8BBE\u7F6E",
        personalScore: this.parseDashboardScore(
          parsed.fields.\u6211\u7684\u8BC4\u5206
        ),
        bangumiScore: this.parseDashboardScore(
          parsed.fields.BGM\u7528\u6237\u8BC4\u5206 || parsed.fields.Bangumi\u7528\u6237\u8BC4\u5206
        ),
        preciseScore: this.parseDashboardScore(
          (this.settings.bangumiPreciseRatingCache || {})[subjectId] || parsed.fields.BGM\u7CBE\u786E\u8BC4\u5206
        ),
        year: cleanValue(parsed.fields.\u5F00\u64AD\u5E74\u4EFD),
        season: cleanValue(parsed.fields.\u5F00\u64AD\u5B63\u5EA6),
        tags: rawTags,
        totalEpisodes: cleanValue(parsed.fields.\u603B\u96C6\u6570),
        watchedEpisodes: extractWatchedEpisodes(content),
        bgmUrl: bgmLink,
        subjectId,
        animeType: cleanValue(parsed.fields.\u6539\u7F16\u7C7B\u578B),
        studio: cleanValue(parsed.fields.\u5236\u4F5C\u516C\u53F8),
        director: cleanValue(parsed.fields.\u76D1\u7763),
        downloadPath: cleanValue(parsed.fields.\u4E0B\u8F7D\u8DEF\u5F84),
        localUpdateStatus: cleanValue(parsed.fields.\u672C\u5730\u66F4\u65B0\u72B6\u6001),
        netabaUrl: cleanValue(parsed.fields.Netaba\u94FE\u63A5)
      });
    }
    return result;
  }
  createDashboardCard(container, label, value) {
    const card = container.createDiv(
      "bangumi-dashboard-card"
    );
    card.createDiv({
      text: label,
      cls: "bangumi-dashboard-card-label"
    });
    card.createDiv({
      text: String(value),
      cls: "bangumi-dashboard-card-value"
    });
  }
  renderRankListRows(listContainer, items, scoreKey, secondaryKey, limit) {
    const maxScore = 10;
    items.slice(0, limit).forEach(
      (item, index) => {
        const row = listContainer.createDiv(
          "bangumi-dashboard-rank-row"
        );
        row.createDiv({
          text: String(index + 1),
          cls: "bangumi-dashboard-rank-index"
        });
        const content = row.createDiv(
          "bangumi-dashboard-rank-content"
        );
        const titleRow = content.createDiv(
          "bangumi-dashboard-rank-title-row"
        );
        const title = titleRow.createEl("a", {
          text: item.name,
          cls: "internal-link"
        });
        title.dataset.href = item.file.path;
        title.setAttribute(
          "data-type",
          "file"
        );
        title.onclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const leaf = this.app.workspace.getLeaf(true);
          await leaf.openFile(item.file);
        };
        const scoreValue = item[scoreKey];
        const scoreEl = titleRow.createDiv({
          text: scoreValue.toFixed(1),
          cls: "bangumi-dashboard-score"
        });
        if (scoreKey === "personalScore") {
          scoreEl.addClass("is-interactive");
          scoreEl.title = "\u70B9\u51FB\u4FEE\u6539\u4E2A\u4EBA\u8BC4\u5206";
          scoreEl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openScoreMenu(e, item);
          };
        }
        const track = content.createDiv(
          "bangumi-dashboard-bar-track"
        );
        const bar = track.createDiv(
          "bangumi-dashboard-bar"
        );
        bar.style.width = scoreValue / maxScore * 100 + "%";
        const secondaryScore = item[secondaryKey];
        content.createDiv({
          text: secondaryScore === null ? "\u53E6\u4E00\u9879\u8BC4\u5206\uFF1A\u672A\u8BC4\u5206" : "\u53E6\u4E00\u9879\u8BC4\u5206\uFF1A" + secondaryScore.toFixed(1),
          cls: "bangumi-dashboard-rank-meta"
        });
      }
    );
  }
  createDashboardRankList(container, title, items, scoreKey, secondaryKey, limit) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );
    section.createEl("h2", {
      text: title
    });
    if (!items.length) {
      section.createEl("p", {
        text: "\u6682\u65E0\u53EF\u663E\u793A\u7684\u8BC4\u5206\u8BB0\u5F55\u3002",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }
    const list = section.createDiv(
      "bangumi-dashboard-rank-list"
    );
    this.renderRankListRows(list, items, scoreKey, secondaryKey, limit);
  }
  renderPreciseRankListRows(listContainer, items, limit) {
    const digits = Math.max(
      1,
      Math.min(
        4,
        Number(
          this.settings.bangumiPreciseScoreDisplayDigits
        ) || 1
      )
    );
    items.slice(0, limit).forEach(
      (item, index) => {
        const row = listContainer.createDiv(
          "bangumi-dashboard-rank-row"
        );
        row.createDiv({
          text: String(index + 1),
          cls: "bangumi-dashboard-rank-index"
        });
        const content = row.createDiv(
          "bangumi-dashboard-rank-content"
        );
        const titleRow = content.createDiv(
          "bangumi-dashboard-rank-title-row"
        );
        const link = titleRow.createEl("a", {
          text: item.name,
          cls: "internal-link"
        });
        link.dataset.href = item.file.path;
        link.setAttribute("data-type", "file");
        link.onclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const leaf = this.app.workspace.getLeaf(true);
          await leaf.openFile(item.file);
        };
        titleRow.createDiv({
          text: item.preciseScore.toFixed(digits),
          cls: "bangumi-dashboard-score"
        });
        const track = content.createDiv(
          "bangumi-dashboard-bar-track"
        );
        const bar = track.createDiv(
          "bangumi-dashboard-bar"
        );
        bar.style.width = item.preciseScore / 10 * 100 + "%";
      }
    );
  }
  createDashboardPreciseRankList(container, title, items, limit) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );
    section.createEl("h2", {
      text: title
    });
    if (!items.length) {
      section.createEl("p", {
        text: "\u6682\u65E0\u53EF\u663E\u793A\u7684\u7CBE\u786E\u8BC4\u5206\u8BB0\u5F55\u3002",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }
    const list = section.createDiv(
      "bangumi-dashboard-rank-list"
    );
    this.renderPreciseRankListRows(list, items, limit);
  }
  renderDistributionBars(chartContainer, items) {
    const ranges = [
      { label: "0\u20132", min: 0, max: 2.99 },
      { label: "3\u20134", min: 3, max: 4.99 },
      { label: "5\u20136", min: 5, max: 6.99 },
      { label: "7\u20138", min: 7, max: 8.99 },
      { label: "9\u201310", min: 9, max: 10 }
    ];
    const scoredItems = items.filter(
      (item) => item.personalScore !== null
    );
    if (!scoredItems.length) {
      chartContainer.createEl("p", {
        text: "\u586B\u5199\u201C\u6211\u7684\u8BC4\u5206\u201D\u540E\u4F1A\u663E\u793A\u8BC4\u5206\u5206\u5E03\u3002",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }
    const chart = chartContainer.createDiv(
      "bangumi-dashboard-distribution"
    );
    ranges.forEach((range) => {
      const count = scoredItems.filter(
        (item) => {
          return item.personalScore >= range.min && item.personalScore <= range.max;
        }
      ).length;
      const row = chart.createDiv(
        "bangumi-dashboard-distribution-row"
      );
      row.createDiv({
        text: range.label,
        cls: "bangumi-dashboard-distribution-label"
      });
      const track = row.createDiv(
        "bangumi-dashboard-distribution-track"
      );
      const bar = track.createDiv(
        "bangumi-dashboard-distribution-bar"
      );
      bar.style.width = count / scoredItems.length * 100 + "%";
      row.createDiv({
        text: String(count),
        cls: "bangumi-dashboard-distribution-count"
      });
    });
  }
  createDashboardDistribution(container, items) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );
    section.createEl("h2", {
      text: "\u6211\u7684\u8BC4\u5206\u5206\u5E03"
    });
    this.renderDistributionBars(section, items);
  }
  renderWatchStateCards(gridContainer, items) {
    const states = [
      "\u5DF2\u770B",
      "\u5728\u770B",
      "\u60F3\u770B",
      "\u629B\u5F03"
    ];
    const grid = gridContainer.createDiv(
      "bangumi-dashboard-state-grid"
    );
    states.forEach((state) => {
      const count = items.filter(
        (item) => item.state === state
      ).length;
      const card = grid.createDiv(
        "bangumi-dashboard-state-card"
      );
      card.createDiv({
        text: state,
        cls: "bangumi-dashboard-state-label"
      });
      card.createDiv({
        text: String(count),
        cls: "bangumi-dashboard-state-value"
      });
    });
  }
  createDashboardWatchState(container, items) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );
    section.createEl("h2", {
      text: "\u89C2\u770B\u72B6\u6001"
    });
    this.renderWatchStateCards(section, items);
  }
  renderProgressStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const stateCounts = {
      "\u5DF2\u770B": 0,
      "\u5728\u770B": 0,
      "\u60F3\u770B": 0,
      "\u629B\u5F03": 0,
      "\u672A\u8BBE\u7F6E": 0
    };
    let totalWatchedEpisodes = 0;
    let totalPlannedEpisodes = 0;
    for (const item of items) {
      const state = item.state && stateCounts.hasOwnProperty(item.state) ? item.state : "\u672A\u8BBE\u7F6E";
      stateCounts[state] = (stateCounts[state] || 0) + 1;
      const watched = Number(item.watchedEpisodes) || 0;
      const total = Number(item.totalEpisodes) || 0;
      totalWatchedEpisodes += watched;
      if (total > 0) {
        totalPlannedEpisodes += total;
      }
    }
    const totalMinutes = totalWatchedEpisodes * 24;
    const hours = (totalMinutes / 60).toFixed(1);
    const days = (totalMinutes / (60 * 24)).toFixed(1);
    const completionRate = items.length > 0 ? Math.round(stateCounts["\u5DF2\u770B"] / items.length * 100) : 0;
    const statGrid = container.createDiv("bangumi-analytics-stat-grid");
    const epCard = statGrid.createDiv("bangumi-analytics-stat-card");
    epCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "\u7D2F\u8BA1\u89C2\u770B\u8BDD\u6570" });
    epCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${totalWatchedEpisodes} \u8BDD` });
    if (totalPlannedEpisodes > 0) {
      epCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `\u603B\u89C4\u5212 ${totalPlannedEpisodes} \u8BDD` });
    }
    const timeCard = statGrid.createDiv("bangumi-analytics-stat-card");
    timeCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "\u6295\u5165\u8FFD\u756A\u65F6\u957F" });
    timeCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${hours} \u5C0F\u65F6` });
    timeCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `\u7EA6 ${days} \u5929 (\u630924\u5206/\u8BDD\u4F30\u7B97)` });
    const stateCard = statGrid.createDiv("bangumi-analytics-stat-card");
    stateCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "\u89C2\u770B\u72B6\u6001\u6982\u89C8" });
    stateCard.createDiv({
      cls: "bangumi-analytics-stat-value",
      text: `${stateCounts["\u5728\u770B"]} \u5728\u770B / ${stateCounts["\u5DF2\u770B"]} \u5DF2\u770B`
    });
    stateCard.createDiv({
      cls: "bangumi-analytics-stat-sub",
      text: `${stateCounts["\u60F3\u770B"]} \u60F3\u770B \xB7 ${stateCounts["\u629B\u5F03"]} \u629B\u5F03`
    });
    const rateCard = statGrid.createDiv("bangumi-analytics-stat-card");
    rateCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "\u52A8\u753B\u5B8C\u7ED3\u7387" });
    rateCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${completionRate}%` });
    rateCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `\u5DF2\u770B ${stateCounts["\u5DF2\u770B"]} / \u603B\u6536\u5F55 ${items.length} \u90E8` });
    const barWrap = container.createDiv("bangumi-stacked-bar-wrap");
    barWrap.createDiv({ cls: "bangumi-stacked-bar-title", text: "\u8FFD\u756A\u72B6\u6001\u5206\u5E03\u5E26" });
    const stackedBar = barWrap.createDiv("bangumi-stacked-bar");
    const legendWrap = barWrap.createDiv("bangumi-stacked-legend");
    const statesConfig = [
      { key: "\u5DF2\u770B", color: "var(--color-green, #28a745)", label: "\u5DF2\u770B" },
      { key: "\u5728\u770B", color: "var(--interactive-accent)", label: "\u5728\u770B" },
      { key: "\u60F3\u770B", color: "var(--color-orange, #ff9900)", label: "\u60F3\u770B" },
      { key: "\u629B\u5F03", color: "var(--text-muted, #6c757d)", label: "\u629B\u5F03" },
      { key: "\u672A\u8BBE\u7F6E", color: "var(--background-modifier-border, #888888)", label: "\u672A\u8BBE\u7F6E" }
    ];
    statesConfig.forEach((cfg) => {
      const count = stateCounts[cfg.key] || 0;
      if (count > 0) {
        const pct = (count / items.length * 100).toFixed(1);
        const seg = stackedBar.createDiv("bangumi-stacked-segment");
        seg.style.width = `${pct}%`;
        seg.style.backgroundColor = cfg.color;
        seg.title = `${cfg.label}: ${count} \u90E8 (${pct}%)`;
        const itemEl = legendWrap.createDiv("bangumi-stacked-legend-item");
        const dot = itemEl.createSpan("bangumi-legend-dot");
        dot.style.backgroundColor = cfg.color;
        itemEl.createSpan({ text: `${cfg.label} ${count} \u90E8 (${pct}%)` });
      }
    });
  }
  renderYearStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const yearCounts = {};
    const seasonCounts = {
      "\u51AC\u5B63\u756A (1\u6708)": 0,
      "\u6625\u5B63\u756A (4\u6708)": 0,
      "\u590F\u5B63\u756A (7\u6708)": 0,
      "\u79CB\u5B63\u756A (10\u6708)": 0,
      "\u5176\u4ED6/\u672A\u77E5": 0
    };
    for (const item of items) {
      const yearStr = String(item.year || "");
      const match = yearStr.match(/\b(19\d\d|20\d\d)\b/);
      if (match) {
        const y = match[1];
        yearCounts[y] = (yearCounts[y] || 0) + 1;
      }
      const seasonStr = String(item.season || "");
      if (/1月|冬季|冬/i.test(seasonStr)) {
        seasonCounts["\u51AC\u5B63\u756A (1\u6708)"]++;
      } else if (/4月|春季|春/i.test(seasonStr)) {
        seasonCounts["\u6625\u5B63\u756A (4\u6708)"]++;
      } else if (/7月|夏季|夏/i.test(seasonStr)) {
        seasonCounts["\u590F\u5B63\u756A (7\u6708)"]++;
      } else if (/10月|秋季|秋/i.test(seasonStr)) {
        seasonCounts["\u79CB\u5B63\u756A (10\u6708)"]++;
      } else {
        seasonCounts["\u5176\u4ED6/\u672A\u77E5"]++;
      }
    }
    const sortedYears = Object.keys(yearCounts).sort((a, b) => Number(a) - Number(b));
    const chartWrap = container.createDiv("bangumi-year-chart-wrap");
    chartWrap.createDiv({ cls: "bangumi-year-chart-title", text: "\u5F00\u64AD\u5E74\u4EFD\u6536\u5F55\u5206\u5E03" });
    if (sortedYears.length > 0) {
      let maxCount = 1;
      for (const y of sortedYears) {
        if (yearCounts[y] > maxCount) maxCount = yearCounts[y];
      }
      const chart = chartWrap.createDiv("bangumi-year-chart");
      const displayYears = sortedYears.length > 14 ? sortedYears.slice(-14) : sortedYears;
      displayYears.forEach((year) => {
        const count = yearCounts[year];
        const heightPct = Math.max(12, Math.round(count / maxCount * 85));
        const col = chart.createDiv("bangumi-year-col");
        col.title = `${year}\u5E74\uFF1A\u6536\u5F55 ${count} \u90E8`;
        col.createDiv({
          cls: "bangumi-year-count",
          text: String(count)
        });
        const barTrack = col.createDiv("bangumi-year-bar-track");
        const bar = barTrack.createDiv("bangumi-year-bar");
        bar.style.height = `${heightPct}%`;
        col.createDiv({
          cls: "bangumi-year-label",
          text: year.length === 4 ? `'${year.slice(2)}` : year
        });
      });
    } else {
      chartWrap.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u5E74\u4EFD\u4FE1\u606F\uFF08\u7B14\u8BB0\u4E2D\u672A\u586B\u5199\u201C\u5F00\u64AD\u5E74\u4EFD\u201D\uFF09\u3002"
      });
    }
    const seasonWrap = container.createDiv("bangumi-season-wrap");
    seasonWrap.createDiv({ cls: "bangumi-season-title", text: "\u756A\u5B63\u5206\u5E03" });
    const seasonGrid = seasonWrap.createDiv("bangumi-season-grid");
    const seasonIcons = {
      "\u51AC\u5B63\u756A (1\u6708)": "\u2744\uFE0F",
      "\u6625\u5B63\u756A (4\u6708)": "\u{1F338}",
      "\u590F\u5B63\u756A (7\u6708)": "\u2600\uFE0F",
      "\u79CB\u5B63\u756A (10\u6708)": "\u{1F341}"
    };
    ["\u51AC\u5B63\u756A (1\u6708)", "\u6625\u5B63\u756A (4\u6708)", "\u590F\u5B63\u756A (7\u6708)", "\u79CB\u5B63\u756A (10\u6708)"].forEach((seasonName) => {
      const c = seasonCounts[seasonName] || 0;
      const card = seasonGrid.createDiv("bangumi-season-card");
      card.createDiv({
        cls: "bangumi-season-label",
        text: `${seasonIcons[seasonName]} ${seasonName}`
      });
      card.createDiv({
        cls: "bangumi-season-value",
        text: `${c} \u90E8`
      });
    });
  }
  renderScoreDelta(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const compared = [];
    for (const item of items) {
      if (item.personalScore !== null) {
        const bgm = item.bangumiScore !== null ? item.bangumiScore : item.preciseScore !== null ? item.preciseScore : null;
        if (bgm !== null) {
          const delta = Number((item.personalScore - bgm).toFixed(2));
          compared.push({
            item,
            personal: item.personalScore,
            bgm,
            delta
          });
        }
      }
    }
    if (compared.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u53EF\u5BF9\u6BD4\u7684\u52A8\u753B\u8BB0\u5F55\uFF08\u9700\u540C\u65F6\u586B\u5199\u201C\u6211\u7684\u8BC4\u5206\u201D\u5E76\u540C\u6B65\u201CBGM\u8BC4\u5206\u201D\uFF09\u3002"
      });
      return;
    }
    const totalPersonal = compared.reduce((acc, c) => acc + c.personal, 0);
    const totalBgm = compared.reduce((acc, c) => acc + c.bgm, 0);
    const avgPersonal = Number((totalPersonal / compared.length).toFixed(2));
    const avgBgm = Number((totalBgm / compared.length).toFixed(2));
    const avgDelta = Number((avgPersonal - avgBgm).toFixed(2));
    let deltaDesc = "";
    let deltaBadgeClass = "is-balanced";
    if (avgDelta >= 0.5) {
      deltaDesc = "\u2728 \u7C89\u4E1D\u504F\u597D/\u5BBD\u5BB9\u5305\u5BB9\u578B\uFF1A\u5BF9\u4F5C\u54C1\u5305\u5BB9\u5EA6\u9AD8\uFF0C\u663E\u8457\u9AD8\u4E8E\u5927\u4F17\u8BC4\u5206\u57FA\u51C6\u3002";
      deltaBadgeClass = "is-generous";
    } else if (avgDelta > 0.1) {
      deltaDesc = "\u{1F31F} \u7565\u9AD8\u4E8E\u5927\u4F17\uFF1A\u6574\u4F53\u8BC4\u4EF7\u666E\u904D\u7565\u9AD8\u4E8E Bangumi \u5927\u4F17\u57FA\u51C6\u3002";
      deltaBadgeClass = "is-generous";
    } else if (avgDelta >= -0.1) {
      deltaDesc = "\u{1F3AF} \u53E3\u7891\u4E25\u5BC6\u5951\u5408\uFF1A\u4E2A\u4EBA\u5BA1\u7F8E\u504F\u597D\u4E0E Bangumi \u5927\u4F17\u8BC4\u5206\u57FA\u51C6\u9AD8\u5EA6\u4E00\u81F4\u3002";
      deltaBadgeClass = "is-balanced";
    } else if (avgDelta > -0.5) {
      deltaDesc = "\u{1F50D} \u7565\u4E25\u4E8E\u5927\u4F17\uFF1A\u8BC4\u5206\u8F83\u4E3A\u514B\u5236\u5BA1\u614E\uFF0C\u7565\u4F4E\u4E8E\u5927\u4F17\u5747\u5206\u3002";
      deltaBadgeClass = "is-strict";
    } else {
      deltaDesc = "\u2694\uFE0F \u4E25\u683C\u7406\u6027\u578B\uFF1A\u6807\u51C6\u4E25\u82DB\uFF0C\u53BB\u6EE4\u955C\u76F4\u51FB\u6838\u5FC3\uFF0C\u660E\u663E\u4F4E\u4E8E\u5927\u4F17\u8BC4\u5206\u3002";
      deltaBadgeClass = "is-strict";
    }
    const summaryCard = container.createDiv("bangumi-score-delta-summary");
    const summaryTop = summaryCard.createDiv("bangumi-delta-summary-top");
    const statBox1 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox1.createDiv({ cls: "bangumi-delta-stat-label", text: "\u5DF2\u5BF9\u6BD4\u52A8\u753B\u6570" });
    statBox1.createDiv({ cls: "bangumi-delta-stat-val", text: `${compared.length} \u90E8` });
    const statBox2 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox2.createDiv({ cls: "bangumi-delta-stat-label", text: "\u4E2A\u4EBA\u5BF9\u6BD4\u5747\u5206" });
    statBox2.createDiv({ cls: "bangumi-delta-stat-val", text: avgPersonal.toFixed(1) });
    const statBox3 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox3.createDiv({ cls: "bangumi-delta-stat-label", text: "BGM\u5BF9\u6BD4\u5747\u5206" });
    statBox3.createDiv({ cls: "bangumi-delta-stat-val", text: avgBgm.toFixed(1) });
    const statBox4 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox4.createDiv({ cls: "bangumi-delta-stat-label", text: "\u5E73\u5747\u8BC4\u5206\u5DEE\u503C (\u0394)" });
    const deltaStr = avgDelta > 0 ? `+${avgDelta.toFixed(2)}` : avgDelta.toFixed(2);
    statBox4.createDiv({ cls: "bangumi-delta-stat-val mod-accent", text: deltaStr });
    const summaryBottom = summaryCard.createDiv("bangumi-delta-summary-bottom");
    summaryBottom.createDiv({
      cls: `bangumi-delta-trait-badge ${deltaBadgeClass}`,
      text: deltaDesc
    });
    const listsWrap = container.createDiv("bangumi-delta-lists-wrap");
    const favored = compared.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta || b.personal - a.personal).slice(0, 5);
    const critical = compared.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta || a.personal - b.personal).slice(0, 5);
    const renderDeltaList = (targetContainer, title, listItems, isFavored) => {
      const panel = targetContainer.createDiv("bangumi-delta-panel");
      panel.createDiv({
        cls: "bangumi-delta-panel-title",
        text: title
      });
      if (listItems.length === 0) {
        panel.createDiv({
          cls: "bangumi-dashboard-empty",
          text: isFavored ? "\u6682\u65E0\u4E2A\u4EBA\u8BC4\u5206\u663E\u8457\u9AD8\u4E8E\u5927\u4F17\u7684\u4F5C\u54C1\u3002" : "\u6682\u65E0\u4E2A\u4EBA\u8BC4\u5206\u663E\u8457\u4F4E\u4E8E\u5927\u4F17\u7684\u4F5C\u54C1\u3002"
        });
        return;
      }
      const listEl = panel.createDiv("bangumi-delta-list");
      listItems.forEach((c, idx) => {
        const row = listEl.createDiv("bangumi-delta-row");
        row.createDiv({
          cls: "bangumi-delta-index",
          text: String(idx + 1)
        });
        const nameCol = row.createDiv("bangumi-delta-name-col");
        const link = nameCol.createEl("a", {
          cls: "internal-link",
          text: c.item.name
        });
        link.title = c.item.name;
        link.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (c.item.file) {
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(c.item.file);
          }
        };
        const scoreCol = row.createDiv("bangumi-delta-score-col");
        scoreCol.createSpan({
          cls: "bangumi-delta-personal-score",
          text: `\u6211: ${c.personal.toFixed(1)}`
        });
        scoreCol.createSpan({
          cls: "bangumi-delta-bgm-score",
          text: `BGM: ${c.bgm.toFixed(1)}`
        });
        const badgeClass = isFavored ? "is-plus" : "is-minus";
        const deltaText = c.delta > 0 ? `+${c.delta.toFixed(1)}` : `${c.delta.toFixed(1)}`;
        row.createDiv({
          cls: `bangumi-delta-pill ${badgeClass}`,
          text: `\u0394 ${deltaText}`
        });
      });
    };
    renderDeltaList(listsWrap, "\u4E2A\u4EBA\u6700\u504F\u7231\u4F5C\u54C1 (\u6211\u8BC4\u9AD8\u4E8E\u5927\u4F17 TOP 5)", favored, true);
    renderDeltaList(listsWrap, "\u4E2A\u4EBA\u6700\u4E25\u82DB\u4F5C\u54C1 (\u6211\u8BC4\u4F4E\u4E8E\u5927\u4F17 TOP 5)", critical, false);
  }
  renderStudioStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const studioMap = /* @__PURE__ */ new Map();
    const typeCounts = {
      "\u539F\u521B": 0,
      "\u6F2B\u753B\u6539": 0,
      "\u8F7B\u5C0F\u8BF4\u6539": 0,
      "\u6E38\u620F\u6539": 0,
      "\u5176\u4ED6": 0
    };
    for (const item of items) {
      if (item.studio) {
        const rawStudios = String(item.studio).split(/[,;\/、&]+/).map((s) => s.trim()).filter((s) => s && !/^(未知|无|暂无|-)$/i.test(s));
        for (const st of rawStudios) {
          if (!studioMap.has(st)) {
            studioMap.set(st, { count: 0, personalScores: [], bgmScores: [] });
          }
          const data = studioMap.get(st);
          data.count++;
          if (item.personalScore !== null) {
            data.personalScores.push(item.personalScore);
          }
          if (item.bangumiScore !== null) {
            data.bgmScores.push(item.bangumiScore);
          } else if (item.preciseScore !== null) {
            data.bgmScores.push(item.preciseScore);
          }
        }
      }
      const t = String(item.animeType || "").trim();
      if (/原创/i.test(t)) {
        typeCounts["\u539F\u521B"]++;
      } else if (/漫/i.test(t)) {
        typeCounts["\u6F2B\u753B\u6539"]++;
      } else if (/小|轻/i.test(t)) {
        typeCounts["\u8F7B\u5C0F\u8BF4\u6539"]++;
      } else if (/游/i.test(t)) {
        typeCounts["\u6E38\u620F\u6539"]++;
      } else if (t) {
        typeCounts["\u5176\u4ED6"]++;
      }
    }
    const wrap = container.createDiv("bangumi-studio-type-wrap");
    const studioSection = wrap.createDiv("bangumi-studio-section");
    studioSection.createDiv({
      cls: "bangumi-analytics-sub-title",
      text: "\u52A8\u753B\u5236\u4F5C\u516C\u53F8\u6536\u5F55\u6392\u884C (TOP 8)"
    });
    const sortedStudios = Array.from(studioMap.entries()).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "zh-CN")).slice(0, 8);
    if (sortedStudios.length > 0) {
      const studioList = studioSection.createDiv("bangumi-studio-list");
      sortedStudios.forEach(([studioName, data], idx) => {
        const row = studioList.createDiv("bangumi-studio-row");
        row.createDiv({
          cls: "bangumi-studio-rank",
          text: String(idx + 1)
        });
        const nameSpan = row.createDiv({
          cls: "bangumi-studio-name",
          text: studioName
        });
        nameSpan.title = studioName;
        row.createDiv({
          cls: "bangumi-studio-count-badge",
          text: `${data.count} \u90E8`
        });
        if (data.personalScores.length > 0) {
          const avg = (data.personalScores.reduce((a, b) => a + b, 0) / data.personalScores.length).toFixed(1);
          row.createDiv({
            cls: "bangumi-studio-score-badge",
            text: `\u5747\u5206 ${avg}`
          });
        }
      });
    } else {
      studioSection.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u5236\u4F5C\u516C\u53F8\u4FE1\u606F\uFF08\u7B14\u8BB0\u4E2D\u672A\u586B\u5199\u201C\u5236\u4F5C\u516C\u53F8\u201D\uFF09\u3002"
      });
    }
    const typeSection = wrap.createDiv("bangumi-type-section");
    typeSection.createDiv({
      cls: "bangumi-analytics-sub-title",
      text: "\u539F\u4F5C\u6539\u7F16\u7C7B\u578B\u5206\u5E03"
    });
    const totalTyped = Object.values(typeCounts).reduce((a, b) => a + b, 0);
    if (totalTyped > 0) {
      const typeList = typeSection.createDiv("bangumi-type-list");
      const typeKeys = ["\u539F\u521B", "\u6F2B\u753B\u6539", "\u8F7B\u5C0F\u8BF4\u6539", "\u6E38\u620F\u6539", "\u5176\u4ED6"];
      typeKeys.forEach((key) => {
        const count = typeCounts[key] || 0;
        const pct = Math.round(count / totalTyped * 100);
        const row = typeList.createDiv("bangumi-type-row");
        row.createDiv({
          cls: "bangumi-type-label",
          text: key
        });
        const track = row.createDiv("bangumi-type-track");
        const bar = track.createDiv("bangumi-type-bar");
        bar.style.width = `${pct}%`;
        row.createDiv({
          cls: "bangumi-type-count",
          text: `${count} \u90E8 (${pct}%)`
        });
      });
    } else {
      typeSection.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u6539\u7F16\u7C7B\u578B\u4FE1\u606F\uFF08\u7B14\u8BB0\u4E2D\u672A\u586B\u5199\u201C\u6539\u7F16\u7C7B\u578B\u201D\uFF09\u3002"
      });
    }
  }
  getCoverResourceUrl(coverPath, sourcePath = "") {
    if (!coverPath) {
      return "";
    }
    let cleanPath = String(coverPath).trim().replace(/^!\[\[|\]\]$/g, "").replace(/^\[\[|\]\]$/g, "");
    if (/^https?:\/\//i.test(cleanPath)) {
      return cleanPath;
    }
    cleanPath = cleanPath.replace(/^\/+/, "");
    let tFile = null;
    if (this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function") {
      tFile = this.app.vault.getAbstractFileByPath(cleanPath);
    }
    if (!tFile && this.app && this.app.metadataCache && typeof this.app.metadataCache.getFirstLinkpathDest === "function") {
      tFile = this.app.metadataCache.getFirstLinkpathDest(cleanPath, sourcePath || "");
    }
    if (tFile && this.app && this.app.vault && typeof this.app.vault.getResourcePath === "function") {
      return this.app.vault.getResourcePath(tFile);
    }
    if (this.app && this.app.vault && this.app.vault.adapter && typeof this.app.vault.adapter.getResourcePath === "function") {
      try {
        return this.app.vault.adapter.getResourcePath(cleanPath);
      } catch (e) {
      }
    }
    return cleanPath;
  }
  filterCustomQueryItems(items, config) {
    if (!Array.isArray(items) || !config) {
      return [];
    }
    const targetTag = String(config.tag || "").trim().replace(/^#/, "").toLowerCase();
    const targetStatus = String(config.watchStatus || "").trim();
    const minMyScore = Number(config.minMyScore) || 0;
    const minBgmScore = Number(config.minBgmScore) || 0;
    const targetYear = String(config.year || "").trim();
    const targetSeason = String(config.season || "").trim();
    return items.filter((item) => {
      if (targetTag) {
        const itemTags = String(item.tags || "").toLowerCase();
        const tokens = itemTags.split(/[,;\s#\[\]"']+/).filter(Boolean);
        const hasTag = tokens.some((t) => t === targetTag) || itemTags.includes(targetTag);
        if (!hasTag) {
          return false;
        }
      }
      if (targetStatus && targetStatus !== "all" && targetStatus !== "\u5168\u90E8") {
        if (item.state !== targetStatus) {
          return false;
        }
      }
      if (minMyScore > 0) {
        if (item.personalScore === null || item.personalScore < minMyScore) {
          return false;
        }
      }
      if (minBgmScore > 0) {
        const score = item.bangumiScore !== null ? item.bangumiScore : item.preciseScore !== null ? item.preciseScore : null;
        if (score === null || score < minBgmScore) {
          return false;
        }
      }
      if (targetYear) {
        if (!item.year || !String(item.year).includes(targetYear)) {
          return false;
        }
      }
      if (targetSeason) {
        if (!item.season || !String(item.season).includes(targetSeason)) {
          return false;
        }
      }
      return true;
    });
  }
  sortCustomQueryItems(items, sortBy = "myScore_desc") {
    const list = [...items];
    switch (sortBy) {
      case "bgmScore_desc":
        list.sort((a, b) => {
          const scoreA = a.bangumiScore !== null ? a.bangumiScore : a.preciseScore !== null ? a.preciseScore : -1;
          const scoreB = b.bangumiScore !== null ? b.bangumiScore : b.preciseScore !== null ? b.preciseScore : -1;
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          return a.name.localeCompare(b.name, "zh-CN");
        });
        break;
      case "year_desc":
        list.sort((a, b) => {
          const yearA = parseInt(a.year, 10) || 0;
          const yearB = parseInt(b.year, 10) || 0;
          if (yearB !== yearA) {
            return yearB - yearA;
          }
          const seasonA = String(a.season || "");
          const seasonB = String(b.season || "");
          if (seasonB !== seasonA) {
            return seasonB.localeCompare(seasonA, "zh-CN");
          }
          return a.name.localeCompare(b.name, "zh-CN");
        });
        break;
      case "title_asc":
        list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
        break;
      case "myScore_desc":
      default:
        list.sort((a, b) => {
          const scoreA = a.personalScore !== null ? a.personalScore : -1;
          const scoreB = b.personalScore !== null ? b.personalScore : -1;
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          return a.name.localeCompare(b.name, "zh-CN");
        });
        break;
    }
    return list;
  }
  renderCustomGrid(container, items, config) {
    if (!items.length) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const grid = container.createDiv("bangumi-dashboard-custom-grid");
    for (const item of items) {
      const card = grid.createDiv("bangumi-grid-card");
      card.dataset.filePath = item.file.path;
      card.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      };
      const posterWrap = card.createDiv("bangumi-grid-poster-wrap");
      const currentState = item.state || "\u672A\u8BBE\u7F6E";
      const stateBadge = posterWrap.createDiv({
        cls: `bangumi-grid-state-badge is-${currentState} is-interactive`,
        text: currentState
      });
      stateBadge.title = "\u70B9\u51FB\u5FEB\u901F\u5207\u6362\u89C2\u770B\u72B6\u6001";
      stateBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };
      let scoreBadgeText = "";
      if (item.personalScore !== null) {
        scoreBadgeText = `\u2605 ${item.personalScore.toFixed(1)}`;
      } else if (item.bangumiScore !== null) {
        scoreBadgeText = `BGM ${item.bangumiScore.toFixed(1)}`;
      } else if (item.preciseScore !== null) {
        scoreBadgeText = `BGM ${item.preciseScore.toFixed(1)}`;
      } else {
        scoreBadgeText = "\u2605 \u8BC4\u5206";
      }
      const scoreBadge = posterWrap.createDiv({
        cls: "bangumi-grid-score-badge is-interactive",
        text: scoreBadgeText
      });
      scoreBadge.title = "\u70B9\u51FB\u5FEB\u901F\u6253\u5206 / \u4FEE\u6539\u4E2A\u4EBA\u8BC4\u5206";
      scoreBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };
      const coverUrl = this.getCoverResourceUrl(item.cover, item.file.path);
      if (coverUrl) {
        const img = posterWrap.createEl("img", {
          cls: "bangumi-grid-poster"
        });
        img.alt = item.name;
        img.loading = "lazy";
        img.src = coverUrl;
        img.onerror = () => {
          img.remove();
          this.renderPosterPlaceholder(posterWrap, item);
        };
      } else {
        this.renderPosterPlaceholder(posterWrap, item);
      }
      const epBar = posterWrap.createDiv("bangumi-grid-ep-bar");
      const btnDec = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-dec",
        text: "\u2212"
      });
      btnDec.title = "\u5DF2\u770B\u96C6\u6570 -1";
      btnDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u8C03\u6574\u4E3A\uFF1A${next} \u8BDD`);
        }
      };
      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== void 0 ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}\u8BDD` : `${watched}\u8BDD`;
      const epLabel = epBar.createDiv({
        cls: "bangumi-grid-ep-label",
        text: epLabelText
      });
      epLabel.title = "\u70B9\u51FB\u76F4\u63A5\u8F93\u5165\u89C2\u770B\u96C6\u6570";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };
      const btnInc = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-inc",
        text: "+"
      });
      btnInc.title = "\u5DF2\u770B\u96C6\u6570 +1";
      btnInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        const updates = { watchedEpisodes: next };
        let msg = `\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u9012\u589E\u81F3\uFF1A${next} \u8BDD`;
        await this.quickUpdateAnimeNote(item, updates);
        new Notice2(msg);
      };
      const btnTrend = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-trend",
        text: "\u{1F4C8}"
      });
      btnTrend.title = "\u67E5\u770B Netaba \u64AD\u51FA\u671F\u95F4\u8BC4\u5206\u8D8B\u52BF\u4E0E\u4E2A\u4EBA\u8BC4\u5206\u5BF9\u6BD4";
      btnTrend.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!item.subjectId) {
          new Notice2("\u8BE5\u52A8\u753B\u672A\u5173\u8054\u6709\u6548\u7684 Bangumi \u7F16\u53F7\uFF0C\u65E0\u6CD5\u83B7\u53D6 Netaba \u8D8B\u52BF\u3002");
          return;
        }
        new NetabaTrendModal(this.app, this, item).open();
      };
      const info = card.createDiv("bangumi-grid-info");
      const title = info.createDiv({
        cls: "bangumi-grid-title",
        text: item.name
      });
      title.title = item.name;
      const metaParts = [];
      if (item.year) metaParts.push(item.year);
      if (item.season) metaParts.push(item.season);
      info.createDiv({
        cls: "bangumi-grid-meta",
        text: metaParts.join(" \xB7 ") || " "
      });
      if (item.downloadPath && item.downloadPath !== "\u65E0") {
        const localResult = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
        if (localResult && !localResult.error && localResult.fileCount > 0) {
          const localBar = info.createDiv("bangumi-grid-local-bar");
          const capsule = localBar.createSpan({
            cls: `bangumi-local-capsule ${localResult.newCount > 0 ? "has-new" : "is-synced"}`,
            text: localResult.newCount > 0 ? `\u{1F4C1} \u672C\u5730 +${localResult.newCount}\u8BDD` : `\u{1F4C1} \u672C\u5730 ${localResult.fileCount}\u8BDD`
          });
          capsule.title = `\u672C\u5730\u89C6\u9891\u5171 ${localResult.fileCount} \u8BDD\uFF08\u8DEF\u5F84\uFF1A${item.downloadPath}\uFF09\u3002\u70B9\u51FB\u5728\u7CFB\u7EDF\u6587\u4EF6\u5939\u4E2D\u6253\u5F00\u3002`;
          capsule.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
          if (localResult.nextEpisodeFile) {
            const nextEpNum = localResult.nextEpisodeNumber || Number(item.watchedEpisodes || 0) + 1;
            const playBtn = localBar.createEl("button", {
              cls: "bangumi-local-action-btn is-play",
              text: `\u25B6 \u7B2C${nextEpNum}\u8BDD`
            });
            playBtn.title = `\u8C03\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u64AD\u653E\u5668\u6253\u5F00\u7B2C ${nextEpNum} \u8BDD`;
            playBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const ok = await openLocalPathSafely(localResult.nextEpisodeFile);
              if (ok) {
                const noticeEl = document.createElement("div");
                noticeEl.innerHTML = `<div>\u5DF2\u8C03\u7528\u64AD\u653E\u5668\u6253\u5F00<strong>\u7B2C ${nextEpNum} \u8BDD</strong>\u3002</div><div style="margin-top:6px;display:flex;gap:6px;"><button class="mod-cta" id="bgm-quick-advance-ep">\u6807\u8BB0\u5DF2\u770B\u81F3\u7B2C ${nextEpNum} \u8BDD</button></div>`;
                const n = new Notice2(noticeEl, 12e3);
                const advBtn = noticeEl.querySelector("#bgm-quick-advance-ep");
                if (advBtn) {
                  advBtn.onclick = async () => {
                    n.hide();
                    await this.quickUpdateAnimeNote(item, { watchedEpisodes: nextEpNum });
                    new Notice2(`\u300A${item.name}\u300B\u5DF2\u66F4\u65B0\u4E3A\u89C2\u770B\u81F3\u7B2C ${nextEpNum} \u8BDD`);
                  };
                }
              }
            };
          }
          const folderBtn = localBar.createEl("button", {
            cls: "bangumi-local-action-btn is-folder",
            text: "\u{1F4C2}"
          });
          folderBtn.title = `\u6253\u5F00\u672C\u5730\u89C6\u9891\u6240\u5728\u6587\u4EF6\u5939
${item.downloadPath}`;
          folderBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
        }
      }
      const tagsRow = info.createDiv("bangumi-grid-tags-row");
      const tagTokens = String(item.tags || "").split(/[,;\s#\[\]"']+/).map((t) => t.trim()).filter((t) => t && t.toLowerCase() !== "bangumi");
      tagTokens.forEach((tag) => {
        const chip = tagsRow.createDiv("bangumi-grid-tag-chip");
        chip.createSpan({ text: `#${tag}` });
        const delBtn = chip.createSpan({
          cls: "bangumi-grid-tag-del",
          text: "\xD7"
        });
        delBtn.title = `\u79FB\u9664\u6807\u7B7E #${tag}`;
        delBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.quickUpdateAnimeNote(item, { removeTag: tag });
          new Notice2(`\u5DF2\u4ECE\u300A${item.name}\u300B\u79FB\u9664\u6807\u7B7E #${tag}`);
        };
      });
      const addTagBtn = tagsRow.createEl("button", {
        cls: "bangumi-grid-add-tag-btn",
        text: "+"
      });
      addTagBtn.title = "\u6DFB\u52A0\u6807\u7B7E";
      addTagBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new QuickAddTagModal(this.app, this, item).open();
      };
    }
  }
  renderPosterPlaceholder(container, item) {
    const ph = container.createDiv("bangumi-grid-poster-placeholder");
    ph.createDiv({
      cls: "bangumi-grid-poster-icon",
      text: "\u{1F3AC}"
    });
    ph.createDiv({
      cls: "bangumi-grid-poster-text",
      text: item.name
    });
  }
  renderCustomList(container, items, config) {
    if (!items.length) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "\u6682\u65E0\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u52A8\u753B\u8BB0\u5F55\u3002"
      });
      return;
    }
    const list = container.createDiv("bangumi-dashboard-rank-list");
    const isBgmSort = config && config.sortBy === "bgmScore_desc";
    const primaryKey = isBgmSort ? "bangumiScore" : "personalScore";
    const secondaryKey = isBgmSort ? "personalScore" : "bangumiScore";
    items.forEach((item, index) => {
      const row = list.createDiv("bangumi-dashboard-rank-row");
      row.dataset.filePath = item.file.path;
      row.createDiv({
        text: String(index + 1),
        cls: "bangumi-dashboard-rank-index"
      });
      const content = row.createDiv("bangumi-dashboard-rank-content");
      const titleRow = content.createDiv("bangumi-dashboard-rank-title-row");
      const title = titleRow.createEl("a", {
        text: item.name,
        cls: "internal-link"
      });
      title.dataset.href = item.file.path;
      title.setAttribute("data-type", "file");
      title.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      };
      const primaryScore = item[primaryKey] !== null ? item[primaryKey] : isBgmSort && item.preciseScore !== null ? item.preciseScore : null;
      const scoreEl = titleRow.createDiv({
        text: primaryScore !== null ? primaryScore.toFixed(1) : "\u672A\u8BC4\u5206",
        cls: `bangumi-dashboard-score ${primaryScore === null ? "bangumi-dashboard-score-none" : ""}`
      });
      if (!isBgmSort) {
        scoreEl.addClass("is-interactive");
        scoreEl.title = "\u70B9\u51FB\u5FEB\u901F\u6253\u5206 / \u4FEE\u6539\u4E2A\u4EBA\u8BC4\u5206";
        scoreEl.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openScoreMenu(e, item);
        };
      }
      if (primaryScore !== null) {
        const track = content.createDiv("bangumi-dashboard-bar-track");
        const bar = track.createDiv("bangumi-dashboard-bar");
        bar.style.width = Math.min(100, Math.max(0, primaryScore / 10 * 100)) + "%";
      }
      const metaRow = content.createDiv("bangumi-dashboard-rank-meta");
      const statePill = metaRow.createSpan({
        cls: `bangumi-list-state-pill is-${item.state || "\u672A\u8BBE\u7F6E"}`,
        text: item.state || "\u672A\u8BBE\u7F6E"
      });
      statePill.title = "\u70B9\u51FB\u5FEB\u901F\u5207\u6362\u89C2\u770B\u72B6\u6001";
      statePill.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };
      const epControl = metaRow.createSpan("bangumi-list-ep-control");
      const btnListDec = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn is-dec",
        text: "\u2212"
      });
      btnListDec.title = "\u5DF2\u770B\u96C6\u6570 -1";
      btnListDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u8C03\u6574\u4E3A\uFF1A${next} \u8BDD`);
        }
      };
      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== void 0 ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabel = epControl.createSpan({
        cls: "bangumi-list-ep-label",
        text: totalNum > 0 ? ` ${watched}/${totalNum}\u8BDD ` : ` ${watched}\u8BDD `
      });
      epLabel.title = "\u70B9\u51FB\u76F4\u63A5\u8F93\u5165\u89C2\u770B\u96C6\u6570";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };
      const btnListInc = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn is-inc",
        text: "+"
      });
      btnListInc.title = "\u5DF2\u770B\u96C6\u6570 +1";
      btnListInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        const updates = { watchedEpisodes: next };
        let msg = `\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u9012\u589E\u81F3\uFF1A${next} \u8BDD`;
        await this.quickUpdateAnimeNote(item, updates);
        new Notice2(msg);
      };
      const secondaryScore = item[secondaryKey] !== null ? item[secondaryKey] : !isBgmSort && item.preciseScore !== null ? item.preciseScore : null;
      const metaParts = [];
      if (secondaryScore !== null) {
        metaParts.push((isBgmSort ? "\u6211\u7684\u8BC4\u5206\uFF1A" : "BGM\u8BC4\u5206\uFF1A") + secondaryScore.toFixed(1));
      } else {
        metaParts.push((isBgmSort ? "\u6211\u7684\u8BC4\u5206\uFF1A" : "BGM\u8BC4\u5206\uFF1A") + "\u672A\u8BC4\u5206");
      }
      if (item.year || item.season) {
        metaParts.push([item.year, item.season].filter(Boolean).join(" "));
      }
      if (metaParts.length > 0) {
        metaRow.createSpan({
          text: " \xB7 " + metaParts.join(" \xB7 ")
        });
      }
    });
  }
  renderCollectionGrid(container, items, collectionConfig, dashboardContainer, dashboardOptions) {
    if (!items || items.length === 0) {
      const emptyDiv = container.createDiv({
        cls: "bangumi-dashboard-empty bangumi-collection-empty",
        text: "\u5C55\u67DC\u5185\u6682\u65E0\u52A8\u753B\u3002"
      });
      const addBtn = emptyDiv.createEl("button", {
        cls: "bangumi-collection-empty-add-btn",
        text: "+ \u4ECE\u52A8\u753B\u5E93\u6DFB\u52A0\u4F5C\u54C1"
      });
      addBtn.onclick = () => {
        this.openCollectionItemsManagerModal(collectionConfig, async () => {
          if (dashboardContainer) {
            await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
          }
        });
      };
      return;
    }
    const grid = container.createDiv("bangumi-dashboard-custom-grid bangumi-collection-grid");
    items.forEach((item, index) => {
      const card = grid.createDiv("bangumi-grid-card bangumi-collection-card");
      card.dataset.filePath = item.file ? item.file.path : "";
      card.dataset.collectionIndex = String(index);
      card.setAttribute("draggable", "true");
      card.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/collection-idx", String(index));
        card.addClass("is-dragging");
      };
      card.ondragend = () => {
        card.removeClass("is-dragging");
        grid.querySelectorAll(".bangumi-collection-card").forEach((el) => {
          el.removeClass("drag-over-indicator");
        });
      };
      card.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        card.addClass("drag-over-indicator");
      };
      card.ondragleave = (e) => {
        e.stopPropagation();
        card.removeClass("drag-over-indicator");
      };
      card.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.removeClass("drag-over-indicator");
        const sourceIdxStr = e.dataTransfer.getData("text/collection-idx");
        if (sourceIdxStr !== "" && sourceIdxStr !== void 0) {
          const sourceIdx = Number(sourceIdxStr);
          const targetIdx = index;
          if (!isNaN(sourceIdx) && sourceIdx !== targetIdx && Array.isArray(collectionConfig.items)) {
            const [moved] = collectionConfig.items.splice(sourceIdx, 1);
            collectionConfig.items.splice(targetIdx, 0, moved);
            await this.saveSettings();
            if (dashboardContainer) {
              await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
            }
            new Notice2(`\u5DF2\u8C03\u6574\u300A${item.name}\u300B\u5728\u5C55\u67DC\u4E2D\u7684\u4F4D\u7F6E\u3002`);
          }
        }
      };
      card.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.file) {
          const leaf = this.app.workspace.getLeaf(true);
          await leaf.openFile(item.file);
        }
      };
      const posterWrap = card.createDiv("bangumi-grid-poster-wrap");
      const currentState = item.state || "\u672A\u8BBE\u7F6E";
      const stateBadge = posterWrap.createDiv({
        cls: `bangumi-grid-state-badge is-${currentState} is-interactive`,
        text: currentState
      });
      stateBadge.title = "\u70B9\u51FB\u5FEB\u901F\u5207\u6362\u89C2\u770B\u72B6\u6001";
      stateBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };
      let scoreBadgeText = "";
      if (item.personalScore !== null) {
        scoreBadgeText = `\u2605 ${item.personalScore.toFixed(1)}`;
      } else if (item.bangumiScore !== null) {
        scoreBadgeText = `BGM ${item.bangumiScore.toFixed(1)}`;
      } else if (item.preciseScore !== null) {
        scoreBadgeText = `BGM ${item.preciseScore.toFixed(1)}`;
      } else {
        scoreBadgeText = "\u2605 \u8BC4\u5206";
      }
      const scoreBadge = posterWrap.createDiv({
        cls: "bangumi-grid-score-badge is-interactive",
        text: scoreBadgeText
      });
      scoreBadge.title = "\u70B9\u51FB\u5FEB\u901F\u6253\u5206 / \u4FEE\u6539\u4E2A\u4EBA\u8BC4\u5206";
      scoreBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };
      const coverUrl = item.file ? this.getCoverResourceUrl(item.cover, item.file.path) : null;
      if (coverUrl) {
        const img = posterWrap.createEl("img", { cls: "bangumi-grid-poster" });
        img.alt = item.name;
        img.loading = "lazy";
        img.src = coverUrl;
        img.onerror = () => {
          img.remove();
          this.renderPosterPlaceholder(posterWrap, item);
        };
      } else {
        this.renderPosterPlaceholder(posterWrap, item);
      }
      const epBar = posterWrap.createDiv("bangumi-grid-ep-bar");
      const btnDec = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-dec",
        text: "\u2212"
      });
      btnDec.title = "\u5DF2\u770B\u96C6\u6570 -1";
      btnDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u8C03\u6574\u4E3A\uFF1A${next} \u8BDD`);
        }
      };
      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== void 0 ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}\u8BDD` : `${watched}\u8BDD`;
      const epLabel = epBar.createDiv({
        cls: "bangumi-grid-ep-label",
        text: epLabelText
      });
      epLabel.title = "\u70B9\u51FB\u76F4\u63A5\u8F93\u5165\u89C2\u770B\u96C6\u6570";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };
      const btnInc = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-inc",
        text: "+"
      });
      btnInc.title = "\u5DF2\u770B\u96C6\u6570 +1";
      btnInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
        new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u9012\u589E\u81F3\uFF1A${next} \u8BDD`);
      };
      const btnTrend = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-trend",
        text: "\u{1F4C8}"
      });
      btnTrend.title = "\u67E5\u770B Netaba \u64AD\u51FA\u671F\u95F4\u8BC4\u5206\u8D8B\u52BF\u4E0E\u4E2A\u4EBA\u8BC4\u5206\u5BF9\u6BD4";
      btnTrend.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!item.subjectId) {
          new Notice2("\u8BE5\u52A8\u753B\u672A\u5173\u8054\u6709\u6548\u7684 Bangumi \u7F16\u53F7\uFF0C\u65E0\u6CD5\u83B7\u53D6 Netaba \u8D8B\u52BF\u3002");
          return;
        }
        new NetabaTrendModal(this.app, this, item).open();
      };
      const info = card.createDiv("bangumi-grid-info");
      const title = info.createDiv({
        cls: "bangumi-grid-title",
        text: item.name
      });
      title.title = item.name;
      const metaParts = [];
      if (item.year) metaParts.push(item.year);
      if (item.season) metaParts.push(item.season);
      info.createDiv({
        cls: "bangumi-grid-meta",
        text: metaParts.join(" \xB7 ") || " "
      });
      if (item.downloadPath && item.downloadPath !== "\u65E0") {
        const localResult = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
        if (localResult && !localResult.error && localResult.fileCount > 0) {
          const localBar = info.createDiv("bangumi-grid-local-bar");
          const capsule = localBar.createSpan({
            cls: `bangumi-local-capsule ${localResult.newCount > 0 ? "has-new" : "is-synced"}`,
            text: localResult.newCount > 0 ? `\u{1F4C1} \u672C\u5730 +${localResult.newCount}\u8BDD` : `\u{1F4C1} \u672C\u5730 ${localResult.fileCount}\u8BDD`
          });
          capsule.title = `\u672C\u5730\u89C6\u9891\u5171 ${localResult.fileCount} \u8BDD\uFF08\u8DEF\u5F84\uFF1A${item.downloadPath}\uFF09\u3002\u70B9\u51FB\u5728\u7CFB\u7EDF\u6587\u4EF6\u5939\u4E2D\u6253\u5F00\u3002`;
          capsule.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
          if (localResult.nextEpisodeFile) {
            const nextEpNum = localResult.nextEpisodeNumber || Number(item.watchedEpisodes || 0) + 1;
            const playBtn = localBar.createEl("button", {
              cls: "bangumi-local-action-btn is-play",
              text: `\u25B6 \u7B2C${nextEpNum}\u8BDD`
            });
            playBtn.title = `\u8C03\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u64AD\u653E\u5668\u6253\u5F00\u7B2C ${nextEpNum} \u8BDD`;
            playBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const ok = await openLocalPathSafely(localResult.nextEpisodeFile);
              if (ok) {
                const noticeEl = document.createElement("div");
                noticeEl.innerHTML = `<div>\u5DF2\u8C03\u7528\u64AD\u653E\u5668\u6253\u5F00<strong>\u7B2C ${nextEpNum} \u8BDD</strong>\u3002</div><div style="margin-top:6px;display:flex;gap:6px;"><button class="mod-cta" id="bgm-quick-advance-ep-compact">\u6807\u8BB0\u5DF2\u770B\u81F3\u7B2C ${nextEpNum} \u8BDD</button></div>`;
                const n = new Notice2(noticeEl, 12e3);
                const advBtn = noticeEl.querySelector("#bgm-quick-advance-ep-compact");
                if (advBtn) {
                  advBtn.onclick = async () => {
                    n.hide();
                    await this.quickUpdateAnimeNote(item, { watchedEpisodes: nextEpNum });
                    new Notice2(`\u300A${item.name}\u300B\u5DF2\u66F4\u65B0\u4E3A\u89C2\u770B\u81F3\u7B2C ${nextEpNum} \u8BDD`);
                  };
                }
              }
            };
          }
          const folderBtn = localBar.createEl("button", {
            cls: "bangumi-local-action-btn is-folder",
            text: "\u{1F4C2}"
          });
          folderBtn.title = `\u6253\u5F00\u672C\u5730\u89C6\u9891\u6240\u5728\u6587\u4EF6\u5939
${item.downloadPath}`;
          folderBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
        }
      }
      const tagsRow = info.createDiv("bangumi-grid-tags-row");
      const tagTokens = String(item.tags || "").split(/[,;\s#\[\]"']+/).map((t) => t.trim()).filter((t) => t && t.toLowerCase() !== "bangumi");
      tagTokens.forEach((tag) => {
        const chip = tagsRow.createDiv("bangumi-grid-tag-chip");
        chip.createSpan({ text: `#${tag}` });
        const delBtn = chip.createSpan({
          cls: "bangumi-grid-tag-del",
          text: "\xD7"
        });
        delBtn.title = `\u79FB\u9664\u6807\u7B7E #${tag}`;
        delBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.quickUpdateAnimeNote(item, { removeTag: tag });
          new Notice2(`\u5DF2\u4ECE\u300A${item.name}\u300B\u79FB\u9664\u6807\u7B7E #${tag}`);
        };
      });
      const addTagBtn = tagsRow.createEl("button", {
        cls: "bangumi-grid-add-tag-btn",
        text: "+"
      });
      addTagBtn.title = "\u6DFB\u52A0\u6807\u7B7E";
      addTagBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new QuickAddTagModal(this.app, this, item).open();
      };
      const shelfActionRow = info.createDiv("bangumi-grid-shelf-action-row");
      const removeBtn = shelfActionRow.createEl("button", {
        cls: "bangumi-grid-shelf-del-btn",
        text: "\u79FB\u51FA\u5C55\u67DC"
      });
      removeBtn.title = `\u4ECE\u5C55\u67DC\u201C${collectionConfig.title}\u201D\u4E2D\u79FB\u51FA\u300A${item.name}\u300B`;
      removeBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Array.isArray(collectionConfig.items)) {
          collectionConfig.items = collectionConfig.items.filter((entry) => {
            const entryPath = typeof entry === "string" ? entry : entry.path;
            const entrySubject = typeof entry === "object" ? entry.subjectId : null;
            if (item.file && entryPath === item.file.path) return false;
            if (item.subjectId && entrySubject && String(entrySubject) === String(item.subjectId)) return false;
            return true;
          });
          await this.saveSettings();
          if (dashboardContainer) {
            await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
          }
          new Notice2(`\u5DF2\u5C06\u300A${item.name}\u300B\u79FB\u51FA\u5C55\u67DC\u201C${collectionConfig.title}\u201D\u3002`);
        }
      };
    });
  }
  renderCollectionList(container, items, collectionConfig, dashboardContainer, dashboardOptions) {
    if (!items || items.length === 0) {
      const emptyDiv = container.createDiv({
        cls: "bangumi-dashboard-empty bangumi-collection-empty",
        text: "\u5C55\u67DC\u5185\u6682\u65E0\u52A8\u753B\u3002"
      });
      const addBtn = emptyDiv.createEl("button", {
        cls: "bangumi-collection-empty-add-btn",
        text: "+ \u4ECE\u52A8\u753B\u5E93\u6DFB\u52A0\u4F5C\u54C1"
      });
      addBtn.onclick = () => {
        this.openCollectionItemsManagerModal(collectionConfig, async () => {
          if (dashboardContainer) {
            await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
          }
        });
      };
      return;
    }
    const list = container.createDiv("bangumi-dashboard-rank-list");
    items.forEach((item, index) => {
      const row = list.createDiv("bangumi-dashboard-rank-row bangumi-collection-list-row");
      row.dataset.filePath = item.file ? item.file.path : "";
      row.dataset.collectionIndex = String(index);
      row.setAttribute("draggable", "true");
      row.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/collection-idx", String(index));
        row.addClass("is-dragging");
      };
      row.ondragend = () => {
        row.removeClass("is-dragging");
        list.querySelectorAll(".bangumi-collection-list-row").forEach((el) => {
          el.removeClass("drag-over-indicator");
        });
      };
      row.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        row.addClass("drag-over-indicator");
      };
      row.ondragleave = (e) => {
        e.stopPropagation();
        row.removeClass("drag-over-indicator");
      };
      row.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.removeClass("drag-over-indicator");
        const sourceIdxStr = e.dataTransfer.getData("text/collection-idx");
        if (sourceIdxStr !== "" && sourceIdxStr !== void 0) {
          const sourceIdx = Number(sourceIdxStr);
          const targetIdx = index;
          if (!isNaN(sourceIdx) && sourceIdx !== targetIdx && Array.isArray(collectionConfig.items)) {
            const [moved] = collectionConfig.items.splice(sourceIdx, 1);
            collectionConfig.items.splice(targetIdx, 0, moved);
            await this.saveSettings();
            if (dashboardContainer) {
              await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
            }
            new Notice2(`\u5DF2\u8C03\u6574\u300A${item.name}\u300B\u5728\u5C55\u67DC\u4E2D\u7684\u4F4D\u7F6E\u3002`);
          }
        }
      };
      const rankIndex = row.createDiv({
        cls: "bangumi-dashboard-rank-index",
        text: String(index + 1)
      });
      rankIndex.title = "\u62D6\u62FD\u53EF\u91CD\u65B0\u6392\u5E8F";
      rankIndex.style.cursor = "grab";
      const content = row.createDiv("bangumi-dashboard-rank-content");
      const titleRow = content.createDiv("bangumi-dashboard-rank-title-row");
      const titleLink = titleRow.createEl("a", {
        text: item.name,
        href: "#"
      });
      titleLink.onclick = async (e) => {
        e.preventDefault();
        if (item.file) {
          const leaf = this.app.workspace.getLeaf(true);
          await leaf.openFile(item.file);
        }
      };
      const scoreWrap = titleRow.createDiv({
        cls: "bangumi-dashboard-score is-interactive"
      });
      if (item.personalScore !== null) {
        scoreWrap.setText(`\u2605 ${item.personalScore.toFixed(1)}`);
      } else if (item.bangumiScore !== null) {
        scoreWrap.setText(`BGM ${item.bangumiScore.toFixed(1)}`);
      } else {
        scoreWrap.setText("\u672A\u8BC4\u5206");
        scoreWrap.addClass("bangumi-dashboard-score-none");
      }
      scoreWrap.title = "\u70B9\u51FB\u6253\u5206 / \u4FEE\u6539\u8BC4\u5206";
      scoreWrap.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };
      const metaRow = content.createDiv("bangumi-dashboard-rank-meta");
      const statePill = metaRow.createSpan({
        cls: `bangumi-list-state-pill is-${item.state || "\u672A\u8BBE\u7F6E"}`,
        text: item.state || "\u672A\u8BBE\u7F6E"
      });
      statePill.title = "\u70B9\u51FB\u5207\u6362\u89C2\u770B\u72B6\u6001";
      statePill.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };
      const epControl = metaRow.createSpan("bangumi-list-ep-control");
      const listDec = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn",
        text: "\u2212"
      });
      listDec.title = "\u5DF2\u770B\u96C6\u6570 -1";
      listDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u8C03\u6574\u4E3A\uFF1A${next} \u8BDD`);
        }
      };
      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== void 0 ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}\u8BDD` : `${watched}\u8BDD`;
      const listEpLabel = epControl.createSpan({
        cls: "bangumi-list-ep-label",
        text: epLabelText
      });
      listEpLabel.title = "\u70B9\u51FB\u76F4\u63A5\u8F93\u5165\u89C2\u770B\u96C6\u6570";
      listEpLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };
      const listInc = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn",
        text: "+"
      });
      listInc.title = "\u5DF2\u770B\u96C6\u6570 +1";
      listInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
        new Notice2(`\u300A${item.name}\u300B\u5DF2\u770B\u96C6\u6570\u9012\u589E\u81F3\uFF1A${next} \u8BDD`);
      };
      const metaParts = [];
      if (item.year || item.season) {
        metaParts.push([item.year, item.season].filter(Boolean).join(" "));
      }
      if (metaParts.length > 0) {
        metaRow.createSpan({
          text: " \xB7 " + metaParts.join(" \xB7 ")
        });
      }
      const removeBtn = metaRow.createEl("button", {
        cls: "bangumi-list-remove-btn",
        text: "\u79FB\u51FA\u5C55\u67DC"
      });
      removeBtn.title = `\u4ECE\u5C55\u67DC\u201C${collectionConfig.title}\u201D\u4E2D\u79FB\u51FA`;
      removeBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Array.isArray(collectionConfig.items)) {
          collectionConfig.items = collectionConfig.items.filter((entry) => {
            const entryPath = typeof entry === "string" ? entry : entry.path;
            const entrySubject = typeof entry === "object" ? entry.subjectId : null;
            if (item.file && entryPath === item.file.path) return false;
            if (item.subjectId && entrySubject && String(entrySubject) === String(item.subjectId)) return false;
            return true;
          });
          await this.saveSettings();
          if (dashboardContainer) {
            await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
          }
          new Notice2(`\u5DF2\u5C06\u300A${item.name}\u300B\u79FB\u51FA\u5C55\u67DC\u3002`);
        }
      };
    });
  }
  openCustomQuerySectionModal(existingConfig, onSave) {
    new CustomQuerySectionModal(this.app, this, existingConfig, onSave).open();
  }
  confirmDeleteCustomQuerySection(section, onDeleted) {
    new ConfirmDeleteSectionModal(this.app, section.title, async () => {
      this.settings.customQuerySections = (this.settings.customQuerySections || []).filter(
        (s) => s.id !== section.id
      );
      if (Array.isArray(this.settings.dashboardSectionOrder)) {
        this.settings.dashboardSectionOrder = this.settings.dashboardSectionOrder.filter(
          (id) => id !== section.id
        );
      }
      if (this.settings.dashboardSectionCollapsed) {
        delete this.settings.dashboardSectionCollapsed[section.id];
      }
      if (this.settings.dashboardSectionHidden) {
        delete this.settings.dashboardSectionHidden[section.id];
      }
      await this.saveSettings();
      if (typeof onDeleted === "function") {
        await onDeleted();
      }
      new Notice2(`\u5DF2\u5220\u9664\u81EA\u5B9A\u4E49\u5206\u533A\u201C${section.title}\u201D\u3002`);
    }).open();
  }
  openCustomCollectionModal(existingConfig, onSave) {
    new CustomCollectionModal(this.app, this, existingConfig, onSave).open();
  }
  openCollectionItemsManagerModal(collectionConfig, onSave) {
    new CollectionItemsManagerModal(this.app, this, collectionConfig, onSave).open();
  }
  confirmDeleteCustomCollection(collectionConfig, onDeleted) {
    new ConfirmDeleteSectionModal(
      this.app,
      collectionConfig.title,
      async () => {
        this.settings.customCollectionSections = (this.settings.customCollectionSections || []).filter(
          (s) => s.id !== collectionConfig.id
        );
        const sectionId = `collection_${collectionConfig.id}`;
        if (Array.isArray(this.settings.dashboardSectionOrder)) {
          this.settings.dashboardSectionOrder = this.settings.dashboardSectionOrder.filter(
            (id) => id !== sectionId
          );
        }
        if (this.settings.dashboardSectionCollapsed) {
          delete this.settings.dashboardSectionCollapsed[sectionId];
        }
        if (this.settings.dashboardSectionHidden) {
          delete this.settings.dashboardSectionHidden[sectionId];
        }
        await this.saveSettings();
        if (typeof onDeleted === "function") {
          await onDeleted();
        }
        new Notice2(`\u5DF2\u5220\u9664\u6536\u85CF\u5C55\u67DC\u201C${collectionConfig.title}\u201D\u3002`);
      },
      `\u786E\u5B9A\u8981\u5220\u9664\u6536\u85CF\u5C55\u67DC\u201C${collectionConfig.title}\u201D\u5417\uFF1F\u5C55\u67DC\u5185\u7684\u7B14\u8BB0\u4E0D\u4F1A\u53D7\u5230\u4EFB\u4F55\u5F71\u54CD\uFF0C\u4EC5\u79FB\u9664\u5C55\u67DC\u5C55\u793A\u3002`
    ).open();
  }
  resolveCollectionItems(colConfig, allItems) {
    if (!colConfig || !Array.isArray(colConfig.items)) return [];
    const resolved = [];
    let settingsNeedSave = false;
    const pathMap = /* @__PURE__ */ new Map();
    const subjectMap = /* @__PURE__ */ new Map();
    const nameMap = /* @__PURE__ */ new Map();
    for (const it of allItems) {
      if (it.file && it.file.path) {
        pathMap.set(it.file.path, it);
      }
      if (it.subjectId) {
        subjectMap.set(String(it.subjectId), it);
      }
      if (it.name) {
        nameMap.set(it.name, it);
      }
    }
    for (const entry of colConfig.items) {
      let entryObj = typeof entry === "string" ? { path: entry } : entry;
      let matched = null;
      if (entryObj.path && pathMap.has(entryObj.path)) {
        matched = pathMap.get(entryObj.path);
      }
      if (!matched && entryObj.subjectId && subjectMap.has(String(entryObj.subjectId))) {
        matched = subjectMap.get(String(entryObj.subjectId));
        if (matched.file && matched.file.path && entryObj.path !== matched.file.path) {
          entryObj.path = matched.file.path;
          settingsNeedSave = true;
        }
      }
      if (!matched && entryObj.name && nameMap.has(entryObj.name)) {
        matched = nameMap.get(entryObj.name);
        if (matched.file && matched.file.path && entryObj.path !== matched.file.path) {
          entryObj.path = matched.file.path;
          settingsNeedSave = true;
        }
      }
      if (matched) {
        if (!entryObj.subjectId && matched.subjectId) {
          entryObj.subjectId = matched.subjectId;
          settingsNeedSave = true;
        }
        if (!entryObj.name && matched.name) {
          entryObj.name = matched.name;
          settingsNeedSave = true;
        }
        resolved.push(matched);
      }
    }
    if (settingsNeedSave) {
      this.saveSettings().catch((e) => console.error("\u4FDD\u5B58\u5C55\u67DC\u81EA\u6108\u8DEF\u5F84\u5931\u8D25:", e));
    }
    return resolved;
  }
  async autoSyncNoteCallout(file) {
    if (!file || !this.isTargetNote(file)) return;
    if (this.isPluginWritingNote && this.isPluginWritingNote.has(file.path)) return;
    if (this.ratingSync && this.ratingSync.isSelfWrite(file.path)) return;
    try {
      const content = await this.app.vault.read(file);
      const synced = syncNoteCalloutFromFrontmatter(content);
      if (synced && synced !== content) {
        if (!this.isPluginWritingNote) this.isPluginWritingNote = /* @__PURE__ */ new Set();
        this.isPluginWritingNote.add(file.path);
        try {
          await this.app.vault.modify(file, synced);
        } finally {
          setTimeout(() => {
            if (this.isPluginWritingNote) {
              this.isPluginWritingNote.delete(file.path);
            }
          }, 1e3);
        }
      }
    } catch (err) {
      console.error("\u81EA\u52A8\u540C\u6B65\u52A8\u753B\u4FE1\u606F\u5361\u5931\u8D25:", err);
    }
  }
  async quickUpdateAnimeNote(item, updates) {
    if (!item || !item.file) return false;
    try {
      const file = item.file;
      const content = await this.app.vault.read(file);
      let newContent = content;
      if (updates.watchedEpisodes !== void 0) {
        newContent = updateWatchedEpisodes(newContent, updates.watchedEpisodes);
        const parsed = parseFrontmatter(newContent);
        if (parsed && parsed.fields && "\u5DF2\u89C2\u770B\u96C6\u6570" in parsed.fields) {
          newContent = updateFrontmatterField(newContent, "\u5DF2\u89C2\u770B\u96C6\u6570", String(updates.watchedEpisodes));
        }
      }
      if (updates.state !== void 0) {
        newContent = updateFrontmatterField(newContent, "\u89C2\u770B\u72B6\u6001", updates.state);
        newContent = updateCalloutTableRow(newContent, "\u89C2\u770B\u72B6\u6001", updates.state);
      }
      if (updates.score !== void 0) {
        const scoreStr = updates.score === null || updates.score === "\u672A\u8BC4\u5206" ? "\u672A\u8BC4\u5206" : String(updates.score);
        newContent = updateFrontmatterField(newContent, "\u6211\u7684\u8BC4\u5206", scoreStr);
        newContent = updateCalloutTableRow(newContent, "\u6211\u7684\u8BC4\u5206", scoreStr);
      }
      if (updates.addTag) {
        newContent = addNoteTag(newContent, updates.addTag);
      }
      if (updates.removeTag) {
        newContent = removeNoteTag(newContent, updates.removeTag);
      }
      if (newContent !== content) {
        if (!this.isPluginWritingNote) this.isPluginWritingNote = /* @__PURE__ */ new Set();
        this.isPluginWritingNote.add(file.path);
        try {
          await this.app.vault.modify(file, newContent);
        } finally {
          setTimeout(() => {
            if (this.isPluginWritingNote) {
              this.isPluginWritingNote.delete(file.path);
            }
          }, 1e3);
        }
      }
      if (updates.watchedEpisodes !== void 0) {
        item.watchedEpisodes = updates.watchedEpisodes;
      }
      if (updates.state !== void 0) {
        item.state = updates.state;
      }
      if (updates.score !== void 0) {
        item.personalScore = updates.score === null || updates.score === "\u672A\u8BC4\u5206" ? null : Number(updates.score);
      }
      if (updates.addTag || updates.removeTag) {
        const parsedAfter = parseFrontmatter(newContent);
        if (parsedAfter) {
          item.tags = cleanValue(parsedAfter.fields.tags);
        }
      }
      if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        try {
          const escapedPath = CSS && typeof CSS.escape === "function" ? CSS.escape(file.path) : file.path.replace(/["\\]/g, "\\$&");
          const domNodes = document.querySelectorAll(`[data-file-path="${escapedPath}"]`);
          for (const node of domNodes) {
            if (updates.watchedEpisodes !== void 0) {
              const epLabel = node.querySelector(".bangumi-grid-ep-label, .bangumi-list-ep-label");
              if (epLabel) {
                const totalNum = Number(item.totalEpisodes);
                epLabel.textContent = totalNum > 0 ? `${updates.watchedEpisodes}/${totalNum}\u8BDD` : `${updates.watchedEpisodes}\u8BDD`;
              }
            }
            if (updates.state !== void 0) {
              const badge = node.querySelector(".bangumi-grid-state-badge, .bangumi-list-state-pill");
              if (badge) {
                badge.textContent = updates.state;
                badge.className = badge.className.replace(/is-\S+/g, "").trim() + ` is-${updates.state}`;
              }
            }
          }
        } catch (domErr) {
        }
      }
      await this.refreshOpenDashboardViews();
      return true;
    } catch (err) {
      console.error("[Bangumi Manager] \u5FEB\u6377\u4FEE\u6539\u52A8\u753B\u7B14\u8BB0\u5931\u8D25:", err);
      new Notice2(`\u4FEE\u6539\u7B14\u8BB0\u5931\u8D25: ${err.message}`);
      return false;
    }
  }
  async refreshOpenDashboardViews() {
    const leaves = this.app.workspace.getLeavesOfType(BANGUMI_SCORE_DASHBOARD_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view && typeof leaf.view.refresh === "function") {
        await leaf.view.refresh();
      }
    }
    if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
      const domDashboards = document.querySelectorAll(
        ".bangumi-score-dashboard[data-markdown-dashboard='true'], [data-bangumi-dashboard='true']"
      );
      for (const el of domDashboards) {
        if (el) {
          await this.renderScoreDashboard(el, el._dashboardOptions || { isMarkdown: true });
        }
      }
    }
  }
  openStateMenu(event, item) {
    if (!item) return;
    const menu = new Menu();
    const states = [
      { id: "\u60F3\u770B", icon: "bookmark" },
      { id: "\u5728\u770B", icon: "play" },
      { id: "\u5DF2\u770B", icon: "check-circle" },
      { id: "\u629B\u5F03", icon: "x-circle" },
      { id: "\u672A\u8BBE\u7F6E", icon: "minus" }
    ];
    states.forEach(({ id, icon }) => {
      menu.addItem((menuItem) => {
        menuItem.setTitle(id).setIcon(icon).setChecked(item.state === id).onClick(async () => {
          if (item.state !== id) {
            await this.quickUpdateAnimeNote(item, { state: id });
            new Notice2(`\u5DF2\u5C06\u300A${item.name}\u300B\u72B6\u6001\u5207\u6362\u4E3A\uFF1A${id}`);
          }
        });
      });
    });
    if (event && event.nativeEvent instanceof MouseEvent) {
      menu.showAtMouseEvent(event.nativeEvent);
    } else if (event instanceof MouseEvent) {
      menu.showAtMouseEvent(event);
    } else if (event && typeof event.clientX === "number") {
      menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }
  }
  openScoreMenu(event, item) {
    if (!item) return;
    const menu = new Menu();
    const scores = [
      { score: 10, label: "10 \u5206 (\u2605\u2605\u2605\u2605\u2605 \u6781\u4F73)" },
      { score: 9, label: "9 \u5206 (\u2605\u2605\u2605\u2605\u2606 \u4F18\u79C0)" },
      { score: 8, label: "8 \u5206 (\u2605\u2605\u2605\u2605 \u63A8\u8350)" },
      { score: 7, label: "7 \u5206 (\u2605\u2605\u2605\u2606 \u826F\u597D)" },
      { score: 6, label: "6 \u5206 (\u2605\u2605\u2605 \u5C1A\u53EF)" },
      { score: 5, label: "5 \u5206 (\u2605\u2605\u2606 \u52C9\u5F3A)" },
      { score: 4, label: "4 \u5206 (\u2605\u2605 \u8F83\u5DEE)" },
      { score: 3, label: "3 \u5206 (\u2605\u2606 \u5DEE)" },
      { score: 2, label: "2 \u5206 (\u2605 \u5F88\u5DEE)" },
      { score: 1, label: "1 \u5206 (\u2606 \u4E0D\u5FCD\u76F4\u89C6)" }
    ];
    scores.forEach(({ score, label }) => {
      menu.addItem((menuItem) => {
        menuItem.setTitle(label).setChecked(item.personalScore === score).onClick(async () => {
          await this.quickUpdateAnimeNote(item, { score });
          new Notice2(`\u5DF2\u66F4\u65B0\u300A${item.name}\u300B\u4E2A\u4EBA\u8BC4\u5206\u4E3A\uFF1A${score} \u5206`);
        });
      });
    });
    menu.addSeparator();
    menu.addItem((menuItem) => {
      menuItem.setTitle("\u6E05\u9664\u8BC4\u5206 (\u8BBE\u4E3A\u672A\u8BC4\u5206)").setIcon("trash-2").setChecked(item.personalScore === null).onClick(async () => {
        await this.quickUpdateAnimeNote(item, { score: "\u672A\u8BC4\u5206" });
        new Notice2(`\u5DF2\u6E05\u9664\u300A${item.name}\u300B\u4E2A\u4EBA\u8BC4\u5206`);
      });
    });
    if (event && event.nativeEvent instanceof MouseEvent) {
      menu.showAtMouseEvent(event.nativeEvent);
    } else if (event instanceof MouseEvent) {
      menu.showAtMouseEvent(event);
    } else if (event && typeof event.clientX === "number") {
      menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }
  }
  createDashboardSection(parentContainer, {
    def,
    isCollapsed,
    onToggleCollapse,
    onHide,
    onReorder,
    onManage,
    onEdit,
    onDelete
  }) {
    const hasData = def.hasData;
    const sectionEl = parentContainer.createDiv({
      cls: "bangumi-dashboard-section" + (hasData ? "" : " is-empty") + (isCollapsed ? " is-collapsed" : "") + (def.spanFull ? " span-full" : "")
    });
    sectionEl.dataset.sectionId = def.id;
    sectionEl.setAttribute("draggable", "true");
    sectionEl.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", def.id);
      sectionEl.addClass("is-dragging");
    };
    sectionEl.ondragend = () => {
      sectionEl.removeClass("is-dragging");
      document.querySelectorAll(".bangumi-dashboard-section").forEach((el) => {
        el.removeClass("drag-over-indicator");
      });
    };
    sectionEl.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      sectionEl.addClass("drag-over-indicator");
    };
    sectionEl.ondragleave = () => {
      sectionEl.removeClass("drag-over-indicator");
    };
    sectionEl.ondrop = async (e) => {
      e.preventDefault();
      sectionEl.removeClass("drag-over-indicator");
      const sourceId = e.dataTransfer.getData("text/plain");
      if (sourceId && sourceId !== def.id) {
        await onReorder(sourceId, def.id);
      }
    };
    const headerEl = sectionEl.createDiv("bangumi-dashboard-section-header");
    const leftEl = headerEl.createDiv("bangumi-dashboard-section-header-left");
    const dragHandle = leftEl.createSpan({
      cls: "bangumi-dashboard-drag-handle",
      text: "\u22EE\u22EE"
    });
    dragHandle.title = "\u62D6\u62FD\u8C03\u6574\u5206\u533A\u987A\u5E8F";
    if (hasData) {
      const collapseBtn = leftEl.createSpan({
        cls: "bangumi-dashboard-collapse-btn",
        text: isCollapsed ? "\u25B6" : "\u25BC"
      });
      collapseBtn.title = isCollapsed ? "\u5C55\u5F00\u5206\u533A" : "\u6298\u53E0\u5206\u533A";
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        onToggleCollapse();
      };
    }
    leftEl.createEl("h2", {
      text: def.title
    });
    if (hasData && def.badgeText) {
      leftEl.createSpan({
        cls: "bangumi-dashboard-badge",
        text: def.badgeText
      });
    }
    if (!hasData) {
      leftEl.createSpan({
        cls: "bangumi-dashboard-empty-inline",
        text: def.emptyText
      });
    }
    const rightEl = headerEl.createDiv("bangumi-dashboard-section-header-right");
    if (def.isCollection) {
      const manageBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "\u7BA1\u7406"
      });
      manageBtn.title = "\u7BA1\u7406\u5C55\u67DC\u4E2D\u7684\u52A8\u753B\u6761\u76EE";
      manageBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onManage === "function") {
          onManage();
        }
      };
      const editBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "\u7F16\u8F91"
      });
      editBtn.title = "\u7F16\u8F91\u5C55\u67DC\u6807\u9898\u4E0E\u663E\u793A\u6A21\u5F0F";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onEdit === "function") {
          onEdit();
        }
      };
      const deleteBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "\u5220\u9664"
      });
      deleteBtn.title = "\u5220\u9664\u6B64\u6536\u85CF\u5C55\u67DC";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete();
        }
      };
    } else if (def.isCustom) {
      const editBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "\u7F16\u8F91"
      });
      editBtn.title = "\u7F16\u8F91\u6B64\u81EA\u5B9A\u4E49\u67E5\u8BE2\u5206\u533A";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onEdit === "function") {
          onEdit();
        }
      };
      const deleteBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "\u5220\u9664"
      });
      deleteBtn.title = "\u5220\u9664\u6B64\u81EA\u5B9A\u4E49\u67E5\u8BE2\u5206\u533A";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete();
        }
      };
    }
    const hideBtn = rightEl.createEl("button", {
      cls: "bangumi-dashboard-action-btn",
      text: "\u9690\u85CF"
    });
    hideBtn.title = "\u9690\u85CF\u6B64\u5206\u533A\uFF08\u53EF\u5728\u5E95\u90E8\u6216\u8BBE\u7F6E\u4E2D\u6062\u590D\uFF09";
    hideBtn.onclick = (e) => {
      e.stopPropagation();
      onHide();
    };
    headerEl.onclick = (e) => {
      if (e.target.closest("button") || e.target === dragHandle) {
        return;
      }
      if (hasData) {
        onToggleCollapse();
      }
    };
    if (hasData && !isCollapsed) {
      const bodyEl = sectionEl.createDiv("bangumi-dashboard-section-body");
      def.renderBody(bodyEl);
    }
  }
  async resetScoreDashboardLayout(container, options = {}) {
    this.settings.dashboardSectionOrder = [];
    this.settings.dashboardSectionCollapsed = {};
    this.settings.dashboardSectionHidden = {};
    if (!Array.isArray(this.settings.customQuerySections) || this.settings.customQuerySections.length === 0) {
      this.settings.customQuerySections = [Object.assign({}, DEFAULT_PRESET_QUERY_SECTION)];
    }
    await this.saveSettings();
    if (container) {
      await this.renderScoreDashboard(container, options);
    }
    new Notice2("\u5DF2\u6062\u590D\u52A8\u753B\u4EEA\u8868\u76D8\u9ED8\u8BA4\u5E03\u5C40\u3002");
  }
  getDashboardScrollParent(el) {
    if (!el) return null;
    let curr = el.parentElement;
    while (curr) {
      if (curr.classList && (curr.classList.contains("bangumi-score-dashboard-view") || curr.classList.contains("view-content") || curr.classList.contains("markdown-preview-view") || curr.classList.contains("cm-scroller"))) {
        return curr;
      }
      try {
        if (typeof window !== "undefined" && window.getComputedStyle) {
          const style = window.getComputedStyle(curr);
          const overflowY = style.overflowY;
          if ((overflowY === "auto" || overflowY === "scroll") && curr.scrollHeight > curr.clientHeight) {
            return curr;
          }
        }
      } catch (e) {
      }
      curr = curr.parentElement;
    }
    return el.ownerDocument ? el.ownerDocument.scrollingElement || el.ownerDocument.documentElement : null;
  }
  async renderScoreDashboard(container, options = {}) {
    const scrollParent = this.getDashboardScrollParent(container);
    const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;
    const prevHeight = container.getBoundingClientRect && typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect().height : 0;
    if (prevHeight > 0) {
      container.style.minHeight = prevHeight + "px";
    }
    container.empty();
    const isMarkdown = Boolean(options && options.isMarkdown);
    if (isMarkdown) {
      container.dataset.markdownDashboard = "true";
      container._dashboardOptions = options;
    }
    const items = await this.collectDashboardItems();
    const personalItems = items.filter(
      (item) => item.personalScore !== null
    ).sort(
      (a, b) => b.personalScore - a.personalScore || a.name.localeCompare(b.name, "zh-CN")
    );
    const bangumiItems = items.filter(
      (item) => item.bangumiScore !== null
    ).sort(
      (a, b) => b.bangumiScore - a.bangumiScore || a.name.localeCompare(b.name, "zh-CN")
    );
    const preciseItems = items.filter((item) => {
      return item.preciseScore !== null;
    }).sort((a, b) => {
      return b.preciseScore - a.preciseScore || a.name.localeCompare(b.name, "zh-CN");
    });
    const scoredItems = items.filter(
      (item) => item.personalScore !== null
    );
    const personalAverage = personalItems.length ? (personalItems.reduce(
      (sum, item) => sum + item.personalScore,
      0
    ) / personalItems.length).toFixed(1) : "\u2014";
    const bangumiAverage = bangumiItems.length ? (bangumiItems.reduce(
      (sum, item) => sum + item.bangumiScore,
      0
    ) / bangumiItems.length).toFixed(1) : "\u2014";
    const header = container.createDiv(
      "bangumi-dashboard-header"
    );
    const headerMain = header.createDiv("bangumi-dashboard-header-main");
    headerMain.createEl("h1", {
      text: "\u52A8\u753B\u4EEA\u8868\u76D8"
    });
    headerMain.createDiv({
      text: "\u6570\u636E\u6765\u81EA\u5F53\u524D\u52A8\u753B\u7B14\u8BB0\uFF1B\u6253\u5F00\u9875\u9762\u65F6\u81EA\u52A8\u91CD\u65B0\u7EDF\u8BA1\u3002",
      cls: "bangumi-dashboard-subtitle"
    });
    const headerActions = header.createDiv("bangumi-dashboard-header-actions");
    const addQueryBtn = headerActions.createEl("button", {
      cls: "bangumi-dashboard-header-btn",
      text: "+ \u65B0\u5EFA\u67E5\u8BE2\u5206\u533A"
    });
    addQueryBtn.onclick = () => {
      this.openCustomQuerySectionModal(null, async () => {
        await this.renderScoreDashboard(container, options);
      });
    };
    const addCollectionBtn = headerActions.createEl("button", {
      cls: "bangumi-dashboard-header-btn",
      text: "+ \u65B0\u5EFA\u6536\u85CF\u5C55\u67DC"
    });
    addCollectionBtn.onclick = () => {
      this.openCustomCollectionModal(null, async () => {
        await this.renderScoreDashboard(container, options);
      });
    };
    if (isMarkdown) {
      const banner = container.createDiv(
        "bangumi-dashboard-compat-banner"
      );
      const text = banner.createDiv({
        cls: "bangumi-dashboard-compat-text"
      });
      text.createSpan({
        text: "\u63D0\u793A\uFF1A\u5F53\u524D\u4E3A Markdown \u5D4C\u5165\u6A21\u5F0F\u3002\u4E3A\u907F\u514D\u5B9E\u65F6\u9884\u89C8\u5149\u6807\u5E72\u6270\u5E76\u83B7\u5F97\u6700\u4F73\u62D6\u62FD\u6392\u7248\u4F53\u9A8C\uFF0C\u63A8\u8350\u5728"
      });
      text.createEl("strong", {
        text: "\u4E13\u5C5E\u9875\u9762"
      });
      text.createSpan({
        text: "\u4E2D\u6253\u5F00\u3002"
      });
      const actions = banner.createDiv(
        "bangumi-dashboard-compat-actions"
      );
      const openBtn = actions.createEl("button", {
        cls: "bangumi-dashboard-compat-btn",
        text: "\u6253\u5F00\u4E13\u5C5E\u4EEA\u8868\u76D8"
      });
      openBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.openScoreDashboardView();
      };
      const resetBtn = actions.createEl("button", {
        cls: "bangumi-dashboard-compat-reset-btn",
        text: "\u6062\u590D\u9ED8\u8BA4\u5E03\u5C40"
      });
      resetBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.resetScoreDashboardLayout(container, options);
      };
    }
    const cards = container.createDiv(
      "bangumi-dashboard-cards"
    );
    this.createDashboardCard(
      cards,
      "\u52A8\u753B\u603B\u6570",
      items.length
    );
    this.createDashboardCard(
      cards,
      "\u6211\u7684\u8BC4\u5206\u6570",
      personalItems.length
    );
    this.createDashboardCard(
      cards,
      "\u6211\u7684\u5E73\u5747\u8BC4\u5206",
      personalAverage
    );
    this.createDashboardCard(
      cards,
      "BGM \u7528\u6237\u5E73\u5747\u8BC4\u5206",
      bangumiAverage
    );
    const personalLimit = Math.max(
      1,
      Number(
        this.settings.dashboardPersonalRankLimit
      ) || 10
    );
    const bangumiLimit = Math.max(
      1,
      Number(
        this.settings.dashboardBangumiRankLimit
      ) || 10
    );
    const preciseLimit = Math.max(
      1,
      Number(
        this.settings.dashboardBangumiRankLimit
      ) || 10
    );
    const builtInSectionDefs = [
      {
        id: "personalRank",
        title: "\u6211\u7684\u8BC4\u5206\u6392\u540D",
        badgeText: personalItems.length ? `${personalItems.length} \u90E8` : "",
        hasData: personalItems.length > 0,
        emptyText: "\u6682\u65E0\u53EF\u663E\u793A\u7684\u8BC4\u5206\u8BB0\u5F55\uFF08\u7B14\u8BB0\u672A\u586B\u5199\u201C\u6211\u7684\u8BC4\u5206\u201D\uFF09",
        spanFull: false,
        renderBody: (body) => {
          const list = body.createDiv("bangumi-dashboard-rank-list");
          this.renderRankListRows(
            list,
            personalItems,
            "personalScore",
            "bangumiScore",
            personalLimit
          );
        }
      },
      {
        id: "bangumiRank",
        title: "BGM \u7528\u6237\u8BC4\u5206\u6392\u540D",
        badgeText: bangumiItems.length ? `${bangumiItems.length} \u90E8` : "",
        hasData: bangumiItems.length > 0,
        emptyText: "\u6682\u65E0\u53EF\u663E\u793A\u7684\u8BC4\u5206\u8BB0\u5F55",
        spanFull: false,
        renderBody: (body) => {
          const list = body.createDiv("bangumi-dashboard-rank-list");
          this.renderRankListRows(
            list,
            bangumiItems,
            "bangumiScore",
            "personalScore",
            bangumiLimit
          );
        }
      },
      {
        id: "preciseRank",
        title: "BGM \u7CBE\u786E\u8BC4\u5206\u6392\u540D",
        badgeText: preciseItems.length ? `${preciseItems.length} \u90E8` : "",
        hasData: preciseItems.length > 0,
        emptyText: "\u6682\u65E0\u53EF\u663E\u793A\u7684\u7CBE\u786E\u8BC4\u5206\u8BB0\u5F55",
        spanFull: false,
        renderBody: (body) => {
          const list = body.createDiv("bangumi-dashboard-rank-list");
          this.renderPreciseRankListRows(
            list,
            preciseItems,
            preciseLimit
          );
        }
      },
      {
        id: "distribution",
        title: "\u6211\u7684\u8BC4\u5206\u5206\u5E03",
        badgeText: scoredItems.length ? `${scoredItems.length} \u90E8` : "",
        hasData: scoredItems.length > 0,
        emptyText: "\u586B\u5199\u201C\u6211\u7684\u8BC4\u5206\u201D\u540E\u4F1A\u663E\u793A\u8BC4\u5206\u5206\u5E03",
        spanFull: true,
        renderBody: (body) => {
          this.renderDistributionBars(body, items);
        }
      },
      {
        id: "watchState",
        title: "\u89C2\u770B\u72B6\u6001",
        badgeText: items.length ? `${items.length} \u90E8` : "",
        hasData: items.length > 0,
        emptyText: "\u6682\u65E0\u89C2\u770B\u72B6\u6001\u8BB0\u5F55",
        spanFull: true,
        renderBody: (body) => {
          this.renderWatchStateCards(body, items);
        }
      }
    ];
    const collectionConfigs = Array.isArray(this.settings.customCollectionSections) ? this.settings.customCollectionSections : [];
    const collectionSectionDefs = [];
    for (const colConfig of collectionConfigs) {
      const colItems = this.resolveCollectionItems(colConfig, items);
      collectionSectionDefs.push({
        id: `collection_${colConfig.id}`,
        title: colConfig.title || "\u81EA\u5B9A\u4E49\u5C55\u67DC",
        badgeText: colItems.length ? `${colItems.length} \u90E8` : "",
        hasData: colItems.length > 0,
        emptyText: "\u5C55\u67DC\u5185\u6682\u65E0\u52A8\u753B\uFF08\u70B9\u51FB\u53F3\u4E0A\u89D2\u201C\u7BA1\u7406\u201D\u6DFB\u52A0\uFF09",
        spanFull: true,
        isCollection: true,
        collectionConfig: colConfig,
        renderBody: (body) => {
          if (colConfig.displayMode === "list") {
            this.renderCollectionList(body, colItems, colConfig, container, options);
          } else {
            this.renderCollectionGrid(body, colItems, colConfig, container, options);
          }
        }
      });
    }
    const customConfigs = Array.isArray(this.settings.customQuerySections) ? this.settings.customQuerySections : [];
    const customSectionDefs = [];
    for (const customConfig of customConfigs) {
      const filtered = this.filterCustomQueryItems(items, customConfig);
      const sorted = this.sortCustomQueryItems(filtered, customConfig.sortBy);
      const limit = Number(customConfig.limit) || 0;
      const displayItems = limit > 0 ? sorted.slice(0, limit) : sorted;
      customSectionDefs.push({
        id: customConfig.id,
        title: customConfig.title || "\u81EA\u5B9A\u4E49\u67E5\u8BE2",
        badgeText: filtered.length ? `${filtered.length} \u90E8` : "",
        hasData: filtered.length > 0,
        emptyText: "\u6682\u65E0\u5339\u914D\u7684\u52A8\u753B\u8BB0\u5F55",
        spanFull: true,
        isCustom: true,
        config: customConfig,
        renderBody: (body) => {
          if (customConfig.displayMode === "grid") {
            this.renderCustomGrid(body, displayItems, customConfig);
          } else {
            this.renderCustomList(body, displayItems, customConfig);
          }
        }
      });
    }
    const analyticsSectionDefs = [
      {
        id: "progressStats",
        title: "\u8FFD\u756A\u5168\u666F\u4E0E\u65F6\u957F\u7EDF\u8BA1",
        badgeText: items.length ? `${items.length} \u90E8` : "",
        hasData: items.length > 0,
        emptyText: "\u6682\u65E0\u52A8\u753B\u6570\u636E",
        spanFull: true,
        renderBody: (body) => {
          this.renderProgressStats(body, items);
        }
      },
      {
        id: "yearStats",
        title: "\u5E74\u4EE3\u4E0E\u756A\u5B63\u5206\u5E03",
        badgeText: items.some((it) => it.year) ? "\u5E74\u4EE3\u7EDF\u8BA1" : "",
        hasData: items.some((it) => it.year),
        emptyText: "\u7B14\u8BB0\u4E2D\u6682\u65E0\u5F00\u64AD\u5E74\u4EFD\u6216\u5B63\u5EA6\u4FE1\u606F",
        spanFull: true,
        renderBody: (body) => {
          this.renderYearStats(body, items);
        }
      },
      {
        id: "scoreDelta",
        title: "\u8BC4\u5206\u5DEE\u5F02\u4E0E\u504F\u597D\u5206\u6790",
        badgeText: items.some((it) => it.personalScore !== null && (it.bangumiScore !== null || it.preciseScore !== null)) ? "\u5BF9\u6BD4\u5206\u6790" : "",
        hasData: items.some((it) => it.personalScore !== null && (it.bangumiScore !== null || it.preciseScore !== null)),
        emptyText: "\u9700\u8981\u540C\u65F6\u62E5\u6709\u201C\u6211\u7684\u8BC4\u5206\u201D\u4E0E\u201CBGM\u8BC4\u5206\u201D\u65B9\u53EF\u8FDB\u884C\u5BF9\u6BD4\u5206\u6790",
        spanFull: true,
        renderBody: (body) => {
          this.renderScoreDelta(body, items);
        }
      },
      {
        id: "studioStats",
        title: "\u5236\u4F5C\u516C\u53F8\u4E0E\u6539\u7F16\u7C7B\u578B",
        badgeText: items.some((it) => it.studio || it.animeType) ? "\u6DF1\u5EA6\u7EDF\u8BA1" : "",
        hasData: items.some((it) => it.studio || it.animeType),
        emptyText: "\u7B14\u8BB0\u4E2D\u6682\u65E0\u5236\u4F5C\u516C\u53F8\u6216\u6539\u7F16\u7C7B\u578B\u4FE1\u606F",
        spanFull: true,
        renderBody: (body) => {
          this.renderStudioStats(body, items);
        }
      }
    ];
    const sectionDefs = [...collectionSectionDefs, ...customSectionDefs, ...analyticsSectionDefs, ...builtInSectionDefs];
    const hiddenMap = this.settings.dashboardSectionHidden || {};
    const isSectionHidden = (id) => {
      if (typeof hiddenMap[id] === "boolean") {
        return hiddenMap[id];
      }
      if (id === "preciseRank") {
        return this.settings.dashboardShowPreciseRank === false;
      }
      if (id === "distribution") {
        return this.settings.dashboardShowDistribution === false;
      }
      if (id === "watchState") {
        return this.settings.dashboardShowWatchState === false;
      }
      if (id === "progressStats") {
        return this.settings.dashboardShowProgressStats === false;
      }
      if (id === "yearStats") {
        return this.settings.dashboardShowYearStats === false;
      }
      if (id === "scoreDelta") {
        return this.settings.dashboardShowScoreDelta === false;
      }
      if (id === "studioStats") {
        return this.settings.dashboardShowStudioStats === false;
      }
      return false;
    };
    const userOrder = Array.isArray(
      this.settings.dashboardSectionOrder
    ) ? this.settings.dashboardSectionOrder.filter(
      (id) => sectionDefs.some((s) => s.id === id)
    ) : [];
    let orderedDefs = [];
    if (userOrder.length > 0) {
      for (const id of userOrder) {
        const def = sectionDefs.find((s) => s.id === id);
        if (def && !orderedDefs.includes(def)) {
          orderedDefs.push(def);
        }
      }
      for (const def of sectionDefs) {
        if (!orderedDefs.includes(def)) {
          orderedDefs.push(def);
        }
      }
    } else {
      const withData = sectionDefs.filter((s) => s.hasData);
      const withoutData = sectionDefs.filter((s) => !s.hasData);
      orderedDefs = [...withData, ...withoutData];
    }
    const visibleDefs = orderedDefs.filter(
      (s) => !isSectionHidden(s.id)
    );
    const hiddenDefs = sectionDefs.filter(
      (s) => isSectionHidden(s.id)
    );
    const sectionsContainer = container.createDiv(
      "bangumi-dashboard-sections"
    );
    const collapsedMap = this.settings.dashboardSectionCollapsed || {};
    for (const def of visibleDefs) {
      const isCollapsed = Boolean(collapsedMap[def.id]);
      this.createDashboardSection(sectionsContainer, {
        def,
        isCollapsed,
        onToggleCollapse: async () => {
          const next = Object.assign(
            {},
            this.settings.dashboardSectionCollapsed
          );
          next[def.id] = !isCollapsed;
          this.settings.dashboardSectionCollapsed = next;
          await this.saveSettings();
          await this.renderScoreDashboard(container, options);
        },
        onHide: async () => {
          const next = Object.assign(
            {},
            this.settings.dashboardSectionHidden
          );
          next[def.id] = true;
          this.settings.dashboardSectionHidden = next;
          await this.saveSettings();
          await this.renderScoreDashboard(container, options);
          new Notice2(
            `\u5DF2\u9690\u85CF\u201C${def.title}\u201D\u5206\u533A\u3002\u53EF\u5728\u5E95\u90E8\u6216\u8BBE\u7F6E\u4E2D\u6062\u590D\u3002`
          );
        },
        onReorder: async (sourceId, targetId) => {
          const currentOrder = visibleDefs.map((d) => d.id);
          const fromIdx = currentOrder.indexOf(sourceId);
          const toIdx = currentOrder.indexOf(targetId);
          if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
            currentOrder.splice(fromIdx, 1);
            currentOrder.splice(toIdx, 0, sourceId);
            for (const s of sectionDefs) {
              if (!currentOrder.includes(s.id)) {
                currentOrder.push(s.id);
              }
            }
            this.settings.dashboardSectionOrder = currentOrder;
            await this.saveSettings();
            await this.renderScoreDashboard(container, options);
            new Notice2("\u5DF2\u66F4\u65B0\u5206\u533A\u6392\u5E8F\u3002");
          }
        },
        onManage: def.isCollection ? async () => {
          this.openCollectionItemsManagerModal(def.collectionConfig, async () => {
            await this.renderScoreDashboard(container, options);
          });
        } : null,
        onEdit: def.isCollection ? async () => {
          this.openCustomCollectionModal(def.collectionConfig, async () => {
            await this.renderScoreDashboard(container, options);
          });
        } : def.isCustom ? async () => {
          this.openCustomQuerySectionModal(def.config, async () => {
            await this.renderScoreDashboard(container, options);
          });
        } : null,
        onDelete: def.isCollection ? async () => {
          this.confirmDeleteCustomCollection(def.collectionConfig, async () => {
            await this.renderScoreDashboard(container, options);
          });
        } : def.isCustom ? async () => {
          this.confirmDeleteCustomQuerySection(def.config, async () => {
            await this.renderScoreDashboard(container, options);
          });
        } : null
      });
    }
    if (hiddenDefs.length > 0) {
      const restoreBar = container.createDiv(
        "bangumi-dashboard-restore-bar"
      );
      restoreBar.createSpan({
        text: "\u5DF2\u9690\u85CF\u5206\u533A\uFF1A"
      });
      for (const hDef of hiddenDefs) {
        const chip = restoreBar.createEl("button", {
          cls: "bangumi-dashboard-restore-chip",
          text: `+ \u6062\u590D ${hDef.title}`
        });
        chip.onclick = async (e) => {
          e.preventDefault();
          const next = Object.assign(
            {},
            this.settings.dashboardSectionHidden
          );
          next[hDef.id] = false;
          if (hDef.id === "preciseRank") {
            this.settings.dashboardShowPreciseRank = true;
          }
          if (hDef.id === "distribution") {
            this.settings.dashboardShowDistribution = true;
          }
          if (hDef.id === "watchState") {
            this.settings.dashboardShowWatchState = true;
          }
          if (hDef.id === "progressStats") {
            this.settings.dashboardShowProgressStats = true;
          }
          if (hDef.id === "yearStats") {
            this.settings.dashboardShowYearStats = true;
          }
          if (hDef.id === "scoreDelta") {
            this.settings.dashboardShowScoreDelta = true;
          }
          if (hDef.id === "studioStats") {
            this.settings.dashboardShowStudioStats = true;
          }
          this.settings.dashboardSectionHidden = next;
          await this.saveSettings();
          await this.renderScoreDashboard(container, options);
          new Notice2(`\u5DF2\u6062\u590D\u663E\u793A\u201C${hDef.title}\u201D\u5206\u533A\u3002`);
        };
      }
      const resetBtn = restoreBar.createEl("button", {
        cls: "bangumi-dashboard-restore-chip bangumi-dashboard-restore-all",
        text: "\u6062\u590D\u9ED8\u8BA4\u5E03\u5C40"
      });
      resetBtn.onclick = async (e) => {
        e.preventDefault();
        await this.resetScoreDashboardLayout(container, options);
      };
    }
    if (prevHeight > 0) {
      container.style.minHeight = "";
    }
    if (scrollParent && savedScrollTop > 0) {
      scrollParent.scrollTop = savedScrollTop;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          if (scrollParent) {
            scrollParent.scrollTop = savedScrollTop;
          }
        });
      }
    }
  }
  async refreshScoreDashboard(force) {
    if (!force && this.settings.dashboardAutoRefresh === false) {
      return;
    }
    const file = await this.ensureScoreDashboard(
      false
    );
    if (!file) {
      return;
    }
    const content = await this.app.vault.read(
      file
    );
    const marker = "<!-- bangumi-dashboard-refresh:" + Date.now() + " -->";
    const updated = content.includes(
      "<!-- bangumi-dashboard-refresh:"
    ) ? content.replace(
      /<!-- bangumi-dashboard-refresh:[\s\S]*?-->/,
      marker
    ) : content.trimEnd() + "\n\n" + marker + "\n";
    if (updated !== content) {
      await this.app.vault.modify(
        file,
        updated
      );
    }
  }
  registerScoreDashboardStyles() {
    if (typeof document === "undefined") {
      return;
    }
    const styleId = "bangumi-score-dashboard-style";
    const oldStyle = document.getElementById(styleId);
    if (oldStyle) {
      oldStyle.remove();
    }
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = [
      ".bangumi-score-dashboard{max-width:1180px;margin:0 auto;padding:8px 0 28px;}",
      ".bangumi-dashboard-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:8px 0 18px;padding:20px 22px;border:1px solid var(--background-modifier-border);border-radius:16px;background:linear-gradient(135deg,var(--background-secondary),var(--background-primary));}",
      ".bangumi-dashboard-header-main{flex:1;min-width:240px;}",
      ".bangumi-dashboard-header h1{margin:0 0 6px;font-size:1.65em;}",
      ".bangumi-dashboard-subtitle{color:var(--text-muted);font-size:.9em;}",
      ".bangumi-dashboard-header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}",
      ".bangumi-dashboard-header-btn{cursor:pointer;padding:6px 14px;font-size:.88em;font-weight:600;border-radius:8px;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);transition:opacity .15s ease;}",
      ".bangumi-dashboard-header-btn:hover{opacity:.9;}",
      ".bangumi-dashboard-compat-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;margin:0 0 16px;border-radius:10px;border:1px solid color-mix(in srgb,var(--interactive-accent) 25%,var(--background-modifier-border));background:color-mix(in srgb,var(--interactive-accent) 6%,var(--background-secondary));font-size:.84em;color:var(--text-normal);}",
      ".bangumi-dashboard-compat-text{flex:1;min-width:0;}",
      ".bangumi-dashboard-compat-actions{display:flex;gap:8px;flex-shrink:0;}",
      ".bangumi-dashboard-compat-btn{cursor:pointer;padding:3px 10px;font-size:.85em;border-radius:6px;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);}",
      ".bangumi-dashboard-compat-reset-btn{cursor:pointer;padding:3px 10px;font-size:.85em;border-radius:6px;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-muted);}",
      ".bangumi-dashboard-compat-reset-btn:hover{background:var(--background-modifier-hover);color:var(--text-normal);}",
      ".bangumi-dashboard-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px;}",
      ".bangumi-dashboard-card{padding:16px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-secondary);}",
      ".bangumi-dashboard-card-label{color:var(--text-muted);font-size:.82em;margin-bottom:7px;}",
      ".bangumi-dashboard-card-value{font-size:1.65em;font-weight:700;font-variant-numeric:tabular-nums;}",
      ".bangumi-dashboard-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;}",
      ".bangumi-dashboard-rank-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;}",
      ".bangumi-dashboard-section{margin:0 0 16px;padding:16px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-primary);transition:border-color .15s ease,box-shadow .15s ease,opacity .15s ease;}",
      ".bangumi-dashboard-section.span-full{grid-column:1 / -1;}",
      ".bangumi-dashboard-section.is-empty{grid-column:1 / -1;padding:9px 14px;margin-bottom:8px;border-style:dashed;border-color:var(--background-modifier-border);background:var(--background-secondary-alt);opacity:.75;}",
      ".bangumi-dashboard-section.is-empty:hover{opacity:.95;}",
      ".bangumi-dashboard-section.is-empty .bangumi-dashboard-section-header{margin-bottom:0;}",
      ".bangumi-dashboard-section.is-empty h2{font-size:.92em;font-weight:500;color:var(--text-muted);}",
      ".bangumi-dashboard-empty-inline{font-size:.82em;color:var(--text-faint);margin-left:8px;}",
      ".bangumi-dashboard-section-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;user-select:none;}",
      ".bangumi-dashboard-section.is-collapsed .bangumi-dashboard-section-header{margin-bottom:0;}",
      ".bangumi-dashboard-section-header-left{display:flex;align-items:center;gap:7px;min-width:0;flex:1;}",
      ".bangumi-dashboard-section-header-left h2{margin:0;font-size:1.08em;cursor:pointer;}",
      ".bangumi-dashboard-drag-handle{cursor:grab;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-size:12px;line-height:1;}",
      ".bangumi-dashboard-drag-handle:hover{color:var(--text-normal);background:var(--background-modifier-hover);}",
      ".bangumi-dashboard-drag-handle:active{cursor:grabbing;}",
      ".bangumi-dashboard-collapse-btn{cursor:pointer;color:var(--text-muted);font-size:10px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;transition:transform .15s ease;}",
      ".bangumi-dashboard-collapse-btn:hover{color:var(--text-normal);background:var(--background-modifier-hover);}",
      ".bangumi-dashboard-badge{font-size:.72em;padding:1px 7px;border-radius:999px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);color:var(--text-muted);font-weight:500;white-space:nowrap;}",
      ".bangumi-dashboard-section-header-right{display:flex;align-items:center;gap:6px;flex-shrink:0;}",
      ".bangumi-dashboard-action-btn{cursor:pointer;font-size:.75em;padding:2px 7px;border:1px solid var(--background-modifier-border);border-radius:6px;background:transparent;color:var(--text-muted);transition:all .15s ease;}",
      ".bangumi-dashboard-action-btn:hover{color:var(--text-normal);background:var(--background-modifier-hover);}",
      ".bangumi-dashboard-section.is-dragging{opacity:.35;}",
      ".bangumi-dashboard-section.drag-over-indicator{border-color:var(--interactive-accent);box-shadow:0 0 0 2px var(--interactive-accent);}",
      ".bangumi-dashboard-restore-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 14px;margin:8px 0 18px;border-radius:10px;border:1px dashed var(--background-modifier-border);background:var(--background-secondary);font-size:.83em;color:var(--text-muted);}",
      ".bangumi-dashboard-restore-chip{cursor:pointer;padding:2px 9px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);font-size:.9em;}",
      ".bangumi-dashboard-restore-chip:hover{border-color:var(--interactive-accent);color:var(--interactive-accent);}",
      ".bangumi-dashboard-restore-all{margin-left:auto;}",
      ".bangumi-dashboard-empty{margin:0;color:var(--text-muted);}",
      ".bangumi-dashboard-rank-list{display:flex;flex-direction:column;gap:10px;}",
      ".bangumi-dashboard-rank-row{display:flex;gap:10px;padding:10px;border-radius:10px;background:var(--background-secondary);transition:background-color .15s ease;}",
      ".bangumi-dashboard-rank-row:hover{background:var(--background-modifier-hover);}",
      ".bangumi-dashboard-rank-index{display:flex;align-items:center;justify-content:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--interactive-accent);color:var(--text-on-accent);font-size:.85em;font-weight:700;}",
      ".bangumi-dashboard-rank-content{min-width:0;flex:1;}",
      ".bangumi-dashboard-rank-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}",
      ".bangumi-dashboard-rank-title-row a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}",
      ".bangumi-dashboard-score{flex:0 0 auto;color:var(--interactive-accent);font-weight:700;font-variant-numeric:tabular-nums;}",
      ".bangumi-dashboard-score-none{color:var(--text-muted);font-weight:normal;}",
      ".bangumi-dashboard-bar-track{height:7px;overflow:hidden;margin:8px 0 6px;border-radius:999px;background:var(--background-modifier-border);}",
      ".bangumi-dashboard-bar{height:100%;min-width:2px;border-radius:inherit;background:linear-gradient(90deg,var(--interactive-accent),var(--color-accent-2));}",
      ".bangumi-dashboard-rank-meta{color:var(--text-muted);font-size:.8em;}",
      ".bangumi-dashboard-distribution{display:flex;flex-direction:column;gap:10px;}",
      ".bangumi-dashboard-distribution-row{display:grid;grid-template-columns:42px minmax(0,1fr) 30px;gap:10px;align-items:center;}",
      ".bangumi-dashboard-distribution-label,.bangumi-dashboard-distribution-count{font-size:.85em;font-variant-numeric:tabular-nums;color:var(--text-muted);}",
      ".bangumi-dashboard-distribution-count{text-align:right;}",
      ".bangumi-dashboard-distribution-track{height:11px;overflow:hidden;border-radius:999px;background:var(--background-secondary);}",
      ".bangumi-dashboard-distribution-bar{height:100%;min-width:2px;border-radius:inherit;background:linear-gradient(90deg,var(--color-blue),var(--interactive-accent));}",
      ".bangumi-dashboard-state-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}",
      ".bangumi-dashboard-state-card{padding:13px;border-radius:10px;background:var(--background-secondary);}",
      ".bangumi-dashboard-state-label{color:var(--text-muted);font-size:.84em;margin-bottom:5px;}",
      ".bangumi-dashboard-state-value{font-size:1.35em;font-weight:700;font-variant-numeric:tabular-nums;}",
      ".bangumi-dashboard-custom-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));gap:14px;padding:4px 0;}",
      ".bangumi-grid-card{position:relative;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;background:var(--background-secondary);border:1px solid var(--background-modifier-border);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;}",
      ".bangumi-grid-card:hover{transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,.15);border-color:var(--interactive-accent);}",
      ".bangumi-grid-poster-wrap{position:relative;width:100%;aspect-ratio:2/3;background:var(--background-secondary-alt);overflow:hidden;display:flex;align-items:center;justify-content:center;}",
      ".bangumi-grid-poster{width:100%;height:100%;object-fit:cover;display:block;}",
      ".bangumi-grid-poster-placeholder{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 8px;text-align:center;background:var(--background-secondary-alt);color:var(--text-faint);user-select:none;}",
      ".bangumi-grid-poster-icon{font-size:24px;margin-bottom:4px;opacity:.7;}",
      ".bangumi-grid-poster-text{font-size:.76em;line-height:1.25;max-height:3em;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}",
      ".bangumi-grid-state-badge{position:absolute;top:6px;left:6px;padding:2px 6px;font-size:.72em;font-weight:600;border-radius:4px;background:rgba(0,0,0,.68);color:#fff;backdrop-filter:blur(4px);z-index:2;pointer-events:none;}",
      ".bangumi-grid-state-badge.is-interactive{pointer-events:auto;cursor:pointer;transition:transform .12s ease,filter .12s ease;}",
      ".bangumi-grid-state-badge.is-interactive:hover{transform:scale(1.06);filter:brightness(1.15);}",
      ".bangumi-grid-state-badge.is-\u5DF2\u770B{background:rgba(40,167,69,.85);}",
      ".bangumi-grid-state-badge.is-\u5728\u770B{background:rgba(0,123,255,.85);}",
      ".bangumi-grid-state-badge.is-\u60F3\u770B{background:rgba(255,153,0,.85);}",
      ".bangumi-grid-state-badge.is-\u629B\u5F03{background:rgba(108,117,125,.85);}",
      ".bangumi-grid-state-badge.is-\u672A\u8BBE\u7F6E{background:rgba(80,80,80,.75);}",
      ".bangumi-grid-score-badge{position:absolute;top:6px;right:6px;padding:2px 6px;font-size:.75em;font-weight:700;border-radius:4px;background:var(--interactive-accent);color:var(--text-on-accent);box-shadow:0 2px 4px rgba(0,0,0,.2);z-index:2;pointer-events:none;font-variant-numeric:tabular-nums;}",
      ".bangumi-grid-score-badge.is-interactive{pointer-events:auto;cursor:pointer;transition:transform .12s ease,filter .12s ease;}",
      ".bangumi-grid-score-badge.is-interactive:hover{transform:scale(1.06);filter:brightness(1.15);}",
      ".bangumi-grid-ep-bar{position:absolute;bottom:0;left:0;right:0;height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 5px;background:linear-gradient(180deg,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.85) 100%);backdrop-filter:blur(3px);color:#fff;font-size:11px;z-index:3;}",
      ".bangumi-grid-ep-btn{cursor:pointer;width:20px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.28);border-radius:3px;background:rgba(255,255,255,0.18);color:#fff;font-size:13px;font-weight:bold;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:background-color .12s ease,border-color .12s ease;}",
      ".bangumi-grid-ep-btn:hover{background:var(--interactive-accent);border-color:var(--interactive-accent);}",
      ".bangumi-grid-ep-label{cursor:pointer;font-family:var(--font-monospace);white-space:nowrap;padding:0 3px;text-shadow:0 1px 2px rgba(0,0,0,0.85);font-weight:500;transition:color .12s ease;}",
      ".bangumi-grid-ep-label:hover{color:var(--text-accent);text-decoration:underline;}",
      ".bangumi-grid-info{padding:8px 10px 10px;display:flex;flex-direction:column;min-width:0;}",
      ".bangumi-grid-title{font-size:.88em;font-weight:600;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35;}",
      ".bangumi-grid-meta{font-size:.76em;color:var(--text-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".bangumi-grid-tags-row{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px;align-items:center;}",
      ".bangumi-grid-tag-chip{font-size:10px;padding:1px 5px;border-radius:3px;background:var(--background-secondary-alt);color:var(--text-muted);border:1px solid var(--background-modifier-border);display:inline-flex;align-items:center;gap:2px;line-height:1.2;}",
      ".bangumi-grid-tag-del{cursor:pointer;color:var(--text-muted);margin-left:2px;transition:color .12s ease;}",
      ".bangumi-grid-tag-del:hover{color:var(--text-error);font-weight:bold;}",
      ".bangumi-grid-add-tag-btn{font-size:11px;padding:0 5px;height:18px;border-radius:3px;border:1px dashed var(--background-modifier-border);background:transparent;color:var(--text-muted);cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:all .12s ease;}",
      ".bangumi-grid-add-tag-btn:hover{border-color:var(--interactive-accent);color:var(--interactive-accent);}",
      ".bangumi-list-state-pill{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;cursor:pointer;background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);color:var(--text-muted);margin-right:4px;transition:opacity .12s ease;}",
      ".bangumi-list-state-pill:hover{opacity:.85;border-color:var(--interactive-accent);color:var(--interactive-accent);}",
      ".bangumi-list-ep-control{display:inline-flex;align-items:center;gap:3px;margin:0 4px;font-size:11px;vertical-align:middle;}",
      ".bangumi-list-ep-btn{width:18px;height:18px;padding:0;border:1px solid var(--background-modifier-border);border-radius:3px;background:var(--background-secondary);color:var(--text-muted);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1;transition:all .12s ease;}",
      ".bangumi-list-ep-btn:hover{background:var(--interactive-accent);border-color:var(--interactive-accent);color:var(--text-on-accent);}",
      ".bangumi-list-ep-label{cursor:pointer;font-family:var(--font-monospace);padding:0 2px;}",
      ".bangumi-list-ep-label:hover{color:var(--text-accent);text-decoration:underline;}",
      ".bangumi-dashboard-score.is-interactive{cursor:pointer;transition:transform .12s ease,opacity .12s ease;}",
      ".bangumi-dashboard-score.is-interactive:hover{opacity:.85;transform:scale(1.05);}",
      ".bangumi-modal-subtitle{color:var(--text-muted);font-size:.9em;margin:-8px 0 16px;}",
      ".bangumi-ep-shortcuts button{cursor:pointer;font-size:.85em;padding:4px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);transition:all .12s ease;}",
      ".bangumi-ep-shortcuts button:hover{background:var(--background-modifier-hover);border-color:var(--interactive-accent);color:var(--interactive-accent);}",
      ".bangumi-custom-query-modal .setting-item{padding:10px 0;}",
      ".bangumi-custom-collection-modal .setting-item{padding:10px 0;}",
      ".bangumi-collection-empty{padding:24px 12px;text-align:center;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:10px;}",
      ".bangumi-collection-empty-add-btn{cursor:pointer;padding:4px 14px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);transition:opacity .15s ease;}",
      ".bangumi-collection-empty-add-btn:hover{opacity:.9;}",
      ".bangumi-grid-shelf-action-row{display:flex;justify-content:flex-end;margin-top:6px;}",
      ".bangumi-grid-shelf-del-btn{cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary-alt);color:var(--text-muted);transition:all .12s ease;}",
      ".bangumi-grid-shelf-del-btn:hover{color:var(--text-error);border-color:var(--text-error);}",
      ".bangumi-list-remove-btn{cursor:pointer;font-size:11px;padding:1px 6px;border-radius:3px;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-muted);margin-left:auto;transition:all .12s ease;}",
      ".bangumi-list-remove-btn:hover{color:var(--text-error);border-color:var(--text-error);}",
      ".bangumi-collection-manager-row{transition:background-color .12s ease;}",
      ".bangumi-collection-manager-row:hover{background:var(--background-modifier-hover);}",
      ".bangumi-manager-mini-btn{cursor:pointer;padding:1px 6px;font-size:11px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);line-height:1.2;transition:all .12s ease;}",
      ".bangumi-manager-mini-btn:hover{border-color:var(--interactive-accent);color:var(--interactive-accent);}",
      ".bangumi-manager-mini-btn.mod-cta{background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent);}",
      ".bangumi-manager-mini-btn.mod-cta:hover{opacity:.9;}",
      ".bangumi-manager-mini-btn.mod-warning:hover{color:var(--text-error);border-color:var(--text-error);}",
      ".bangumi-collection-panel{border:1px solid var(--background-modifier-border);border-radius:8px;padding:12px;background:var(--background-primary);display:flex;flex-direction:column;}",
      ".bangumi-collection-panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--background-modifier-border);font-size:.9em;}",
      ".bangumi-collection-panel-empty{color:var(--text-muted);font-size:.85em;padding:24px 10px;text-align:center;}",
      ".bangumi-collection-more-hint{font-size:11px;color:var(--text-faint);text-align:center;padding:6px;}",
      ".bangumi-score-dashboard-view{padding:0 18px 24px;overflow:auto;}",
      ".bangumi-dashboard-view-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0 10px;}",
      ".bangumi-dashboard-view-toolbar h2{margin:0;font-size:1.15em;}",
      ".bangumi-dashboard-view-controls{display:flex;gap:8px;flex-wrap:wrap;}",
      ".bangumi-analytics-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px;}",
      ".bangumi-analytics-stat-card{padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-analytics-stat-label{color:var(--text-muted);font-size:.82em;margin-bottom:6px;}",
      ".bangumi-analytics-stat-value{font-size:1.35em;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-normal);}",
      ".bangumi-analytics-stat-sub{color:var(--text-faint);font-size:.76em;margin-top:4px;}",
      ".bangumi-stacked-bar-wrap{margin-top:14px;padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-stacked-bar-title{font-size:.88em;font-weight:600;margin-bottom:10px;color:var(--text-normal);}",
      ".bangumi-stacked-bar{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--background-modifier-border);}",
      ".bangumi-stacked-segment{height:100%;transition:width .2s ease;min-width:2px;}",
      ".bangumi-stacked-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:.8em;color:var(--text-muted);}",
      ".bangumi-stacked-legend-item{display:inline-flex;align-items:center;gap:6px;}",
      ".bangumi-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}",
      ".bangumi-year-chart-wrap{margin-bottom:16px;padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-year-chart-title{font-size:.88em;font-weight:600;margin-bottom:12px;color:var(--text-normal);}",
      ".bangumi-year-chart{display:flex;align-items:flex-end;gap:10px;height:120px;padding:10px 6px 0;overflow-x:auto;}",
      ".bangumi-year-col{flex:1;min-width:32px;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;}",
      ".bangumi-year-count{font-size:.75em;color:var(--text-muted);margin-bottom:4px;font-variant-numeric:tabular-nums;}",
      ".bangumi-year-bar-track{width:100%;max-width:28px;height:80px;display:flex;align-items:flex-end;border-radius:4px 4px 0 0;background:rgba(128,128,128,0.1);}",
      ".bangumi-year-bar{width:100%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--interactive-accent),var(--color-accent-2, var(--interactive-accent)));transition:height .25s ease;}",
      ".bangumi-year-label{font-size:.76em;color:var(--text-muted);margin-top:6px;white-space:nowrap;font-family:var(--font-monospace);}",
      ".bangumi-season-wrap{padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-season-title{font-size:.88em;font-weight:600;margin-bottom:10px;color:var(--text-normal);}",
      ".bangumi-season-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}",
      ".bangumi-season-card{padding:10px 12px;border-radius:8px;background:var(--background-primary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-season-label{font-size:.8em;color:var(--text-muted);margin-bottom:4px;}",
      ".bangumi-season-value{font-size:1.2em;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-normal);}",
      ".bangumi-score-delta-summary{padding:16px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);margin-bottom:16px;}",
      ".bangumi-delta-summary-top{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px;}",
      ".bangumi-delta-stat-box{display:flex;flex-direction:column;}",
      ".bangumi-delta-stat-label{font-size:.8em;color:var(--text-muted);margin-bottom:4px;}",
      ".bangumi-delta-stat-val{font-size:1.35em;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-normal);}",
      ".bangumi-delta-stat-val.mod-accent{color:var(--interactive-accent);}",
      ".bangumi-delta-summary-bottom{padding-top:10px;border-top:1px dashed var(--background-modifier-border);}",
      ".bangumi-delta-trait-badge{display:inline-block;padding:4px 12px;border-radius:6px;font-size:.85em;font-weight:500;line-height:1.4;}",
      ".bangumi-delta-trait-badge.is-generous{background:rgba(40,167,69,0.15);color:var(--color-green, #28a745);border:1px solid rgba(40,167,69,0.3);}",
      ".bangumi-delta-trait-badge.is-balanced{background:rgba(0,123,255,0.15);color:var(--interactive-accent);border:1px solid rgba(0,123,255,0.3);}",
      ".bangumi-delta-trait-badge.is-strict{background:rgba(255,153,0,0.15);color:var(--color-orange, #ff9900);border:1px solid rgba(255,153,0,0.3);}",
      ".bangumi-delta-lists-wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}",
      ".bangumi-delta-panel{padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-delta-panel-title{font-size:.9em;font-weight:600;margin-bottom:12px;color:var(--text-normal);}",
      ".bangumi-delta-list{display:flex;flex-direction:column;gap:8px;}",
      ".bangumi-delta-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--background-primary);border:1px solid var(--background-modifier-border);font-size:.85em;}",
      ".bangumi-delta-index{flex:0 0 20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--background-secondary-alt);color:var(--text-muted);font-size:.78em;font-weight:bold;}",
      ".bangumi-delta-name-col{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".bangumi-delta-name-col a{font-weight:500;color:var(--text-normal);}",
      ".bangumi-delta-score-col{display:flex;gap:8px;font-size:.8em;color:var(--text-muted);flex-shrink:0;font-variant-numeric:tabular-nums;}",
      ".bangumi-delta-personal-score{color:var(--interactive-accent);font-weight:600;}",
      ".bangumi-delta-bgm-score{color:var(--text-muted);}",
      ".bangumi-delta-pill{padding:2px 8px;border-radius:999px;font-size:.78em;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0;}",
      ".bangumi-delta-pill.is-plus{background:rgba(40,167,69,0.15);color:var(--color-green, #28a745);border:1px solid rgba(40,167,69,0.3);}",
      ".bangumi-delta-pill.is-minus{background:rgba(235,87,87,0.15);color:var(--text-error, #eb5757);border:1px solid rgba(235,87,87,0.3);}",
      ".bangumi-studio-type-wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}",
      ".bangumi-studio-section,.bangumi-type-section{padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
      ".bangumi-analytics-sub-title{font-size:.9em;font-weight:600;margin-bottom:12px;color:var(--text-normal);}",
      ".bangumi-studio-list{display:flex;flex-direction:column;gap:7px;}",
      ".bangumi-studio-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;background:var(--background-primary);border:1px solid var(--background-modifier-border);font-size:.85em;}",
      ".bangumi-studio-rank{flex:0 0 18px;font-size:.8em;font-weight:bold;color:var(--text-muted);text-align:center;}",
      ".bangumi-studio-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}",
      ".bangumi-studio-count-badge{font-size:.78em;padding:1px 7px;border-radius:999px;background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);color:var(--text-muted);}",
      ".bangumi-studio-score-badge{font-size:.78em;padding:1px 7px;border-radius:999px;background:rgba(0,123,255,0.12);color:var(--interactive-accent);font-weight:600;}",
      ".bangumi-type-list{display:flex;flex-direction:column;gap:10px;}",
      ".bangumi-type-row{display:grid;grid-template-columns:60px minmax(0,1fr) 72px;gap:10px;align-items:center;font-size:.85em;}",
      ".bangumi-type-label{color:var(--text-muted);white-space:nowrap;}",
      ".bangumi-type-track{height:10px;border-radius:999px;background:var(--background-primary);overflow:hidden;}",
      ".bangumi-type-bar{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--interactive-accent),var(--color-accent-2, var(--color-blue)));transition:width .2s ease;}",
      ".bangumi-type-count{font-size:.8em;color:var(--text-muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      "@media (max-width:800px){.bangumi-dashboard-cards{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-dashboard-sections{grid-template-columns:1fr;}.bangumi-dashboard-rank-grid{grid-template-columns:1fr;}.bangumi-dashboard-state-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-dashboard-compat-banner{flex-direction:column;align-items:flex-start;}.bangumi-dashboard-custom-grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;}.bangumi-collection-manager-panels{grid-template-columns:1fr !important;}.bangumi-analytics-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-season-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-delta-summary-top{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-delta-lists-wrap{grid-template-columns:1fr;}.bangumi-studio-type-wrap{grid-template-columns:1fr;}}",
      "@media (max-width:460px){.bangumi-dashboard-cards{grid-template-columns:1fr;}.bangumi-dashboard-state-grid{grid-template-columns:1fr;}.bangumi-dashboard-custom-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}.bangumi-analytics-stat-grid{grid-template-columns:1fr;}.bangumi-season-grid{grid-template-columns:1fr;}.bangumi-delta-summary-top{grid-template-columns:1fr;}}",
      ".bangumi-trend-component{padding:14px;border-radius:10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);margin:12px 0;}",
      ".bangumi-trend-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;}",
      ".bangumi-trend-header-left{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".bangumi-trend-score-badge{font-size:.82em;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(0,123,255,0.12);color:var(--interactive-accent);border:1px solid rgba(0,123,255,0.25);}",
      ".bangumi-trend-personal-badge{font-size:.82em;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,153,0,0.12);color:var(--text-accent, #e5a00d);border:1px solid rgba(255,153,0,0.25);}",
      ".bangumi-trend-toggle-group{display:flex;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;padding:2px;}",
      ".bangumi-trend-btn{background:transparent;border:0;padding:3px 10px;font-size:.78em;cursor:pointer;border-radius:4px;color:var(--text-muted);transition:all .15s ease;}",
      ".bangumi-trend-btn.is-active{background:var(--interactive-accent);color:#fff;font-weight:600;}",
      ".bangumi-trend-tooltip{background:var(--background-primary);border:1px solid var(--background-modifier-border);box-shadow:0 6px 18px rgba(0,0,0,0.18);border-radius:8px;padding:8px 12px;font-size:12px;min-width:130px;line-height:1.45;}",
      ".trend-tip-date{font-weight:600;color:var(--text-normal);margin-bottom:2px;}",
      ".trend-tip-score{font-size:14px;font-weight:700;color:var(--interactive-accent);}",
      ".trend-tip-score .score-label{font-size:11px;font-weight:normal;color:var(--text-muted);}",
      ".trend-tip-meta{color:var(--text-muted);font-size:11px;}",
      ".trend-tip-ep{color:var(--color-green, #28a745);font-size:11px;font-weight:600;margin-top:2px;}",
      ".bangumi-grid-local-bar{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;}",
      ".bangumi-local-capsule{font-size:.75em;padding:2px 7px;border-radius:4px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;transition:all .15s ease;}",
      ".bangumi-local-capsule.is-synced{background:rgba(40,167,69,0.12);color:var(--color-green, #28a745);border:1px solid rgba(40,167,69,0.25);}",
      ".bangumi-local-capsule.has-new{background:rgba(0,123,255,0.15);color:var(--interactive-accent);border:1px solid rgba(0,123,255,0.3);}",
      ".bangumi-local-capsule.is-missing{background:rgba(235,87,87,0.12);color:var(--text-error);border:1px solid rgba(235,87,87,0.25);}",
      ".bangumi-local-capsule:hover{filter:brightness(1.15);transform:translateY(-1px);}",
      ".bangumi-local-action-btn{font-size:.72em;padding:2px 7px;border-radius:4px;cursor:pointer;background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);color:var(--text-normal);line-height:1.4;transition:all .15s ease;}",
      ".bangumi-local-action-btn.is-play{background:var(--interactive-accent);color:#fff;border-color:var(--interactive-accent);font-weight:600;}",
      ".bangumi-local-action-btn.is-play:hover{filter:brightness(1.1);}",
      ".bangumi-local-action-btn.is-folder:hover{background:var(--background-modifier-hover);}",
      ".bangumi-grid-ep-btn.is-trend{margin-left:auto;background:rgba(0,123,255,0.12);color:var(--interactive-accent);border:1px solid rgba(0,123,255,0.25);font-size:.78em;padding:2px 6px;}"
    ].join("");
    document.head.appendChild(style);
    this.register(() => {
      style.remove();
    });
  }
  registerScoreDashboardProcessor() {
    this.registerMarkdownPostProcessor(
      async (element, context) => {
        const dashboards = element.querySelectorAll(
          "[data-bangumi-dashboard=true]"
        );
        for (const dashboard of dashboards) {
          await this.renderScoreDashboard(
            dashboard,
            { isMarkdown: true, sourcePath: context && context.sourcePath }
          );
        }
      }
    );
  }
  registerNetabaMarkdownProcessor() {
    this.registerMarkdownPostProcessor(
      async (element, context) => {
        const controls = element.querySelectorAll(
          ".bangumi-netaba-controls"
        );
        if (!controls.length) {
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(
          context.sourcePath
        );
        if (!file) {
          return;
        }
        const content = await this.app.vault.read(file);
        const iframe = element.querySelector(
          'iframe[src*="netaba.re"]'
        );
        for (const control of controls) {
          control.empty();
          control.style.display = "flex";
          control.style.flexWrap = "wrap";
          control.style.gap = "6px";
          control.style.margin = "10px 0 14px";
          const pages = [
            {
              key: "nativeTrend",
              name: "\u{1F4C8} \u539F\u751F\u8D8B\u52BF\u56FE"
            },
            {
              key: "subject",
              name: "\u5F53\u524D\u52A8\u753B\u9875\u9762"
            },
            {
              key: "season",
              name: "\u5F53\u5B63\u52A8\u753B"
            },
            {
              key: "trending",
              name: "\u8BC4\u5206\u8D8B\u52BF"
            },
            {
              key: "history",
              name: "\u5386\u53F2\u5206\u5E03"
            },
            {
              key: "user",
              name: "\u4E2A\u4EBA\u8BC4\u5206"
            },
            {
              key: "compare",
              name: "\u52A8\u753B\u5BF9\u6BD4"
            },
            {
              key: "browser",
              name: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u5F53\u524D\u9875\u9762"
            }
          ];
          for (const page of pages) {
            const button = document.createElement(
              "button"
            );
            button.type = "button";
            button.textContent = page.name;
            button.style.cursor = "pointer";
            button.addEventListener(
              "click",
              async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (page.key === "nativeTrend") {
                  const parsed = parseFrontmatter(content);
                  const sid = bangumiApi.getSubjectId(cleanValue(parsed?.fields?.BGM\u94FE\u63A5 || parsed?.fields?.Netaba\u94FE\u63A5));
                  if (!sid) {
                    new Notice2("\u672A\u627E\u5230\u8BE5\u52A8\u753B\u7684\u6709\u6548 Bangumi \u7F16\u53F7\u3002");
                    return;
                  }
                  let nativeBox2 = element.querySelector(".bangumi-native-trend-container");
                  if (!nativeBox2) {
                    nativeBox2 = document.createElement("div");
                    nativeBox2.className = "bangumi-native-trend-container";
                    if (iframe && iframe.parentElement) {
                      iframe.parentElement.before(nativeBox2);
                    } else {
                      element.appendChild(nativeBox2);
                    }
                  }
                  if (iframe && iframe.parentElement) {
                    iframe.parentElement.style.display = "none";
                  }
                  nativeBox2.style.display = "block";
                  nativeBox2.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);">\u6B63\u5728\u52A0\u8F7D\u539F\u751F\u8D8B\u52BF\u56FE\u2026\u2026</div>';
                  try {
                    const rawData = await netabaTrendService.fetchSubjectTrendData(this.app, sid);
                    const pScore = this.parseDashboardScore(parsed?.fields?.\u6211\u7684\u8BC4\u5206);
                    const normData = netabaTrendService.normalizeTrendData(rawData, pScore);
                    netabaTrendService.renderNativeTrendSvg(nativeBox2, normData);
                    new Notice2("\u5DF2\u6E32\u67D3\u539F\u751F\u8F7B\u91CF\u8BC4\u5206\u8D8B\u52BF\u56FE");
                  } catch (e) {
                    nativeBox2.innerHTML = `<div style="padding:16px;color:var(--text-error);">\u52A0\u8F7D\u539F\u751F\u8D8B\u52BF\u56FE\u5931\u8D25: ${e.message}</div>`;
                  }
                  return;
                }
                const nativeBox = element.querySelector(".bangumi-native-trend-container");
                if (nativeBox) {
                  nativeBox.style.display = "none";
                }
                if (iframe && iframe.parentElement) {
                  iframe.parentElement.style.display = "";
                }
                if (page.key === "browser") {
                  const currentUrl = iframe?.getAttribute("src") || "";
                  if (currentUrl) {
                    window.open(
                      currentUrl,
                      "_blank"
                    );
                  }
                  return;
                }
                const url = this.getNetabaPageUrlForNote(
                  content,
                  page.key
                );
                if (!url) {
                  new Notice2(
                    "\u5F53\u524D\u8BBE\u7F6E\u4E0D\u8DB3\u4EE5\u751F\u6210\u8FD9\u4E2A Netaba \u9875\u9762\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u7F16\u53F7\u6216\u5BF9\u6BD4\u52A8\u753B\u8BBE\u7F6E\u3002",
                    6e3
                  );
                  return;
                }
                const newContent = updateNetabaIframeUrl(
                  content,
                  url
                );
                if (newContent === content) {
                  new Notice2(
                    "\u5F53\u524D\u7B14\u8BB0\u4E2D\u6CA1\u6709\u627E\u5230\u53EF\u66F4\u65B0\u7684 Netaba \u9875\u9762\u3002",
                    5e3
                  );
                  return;
                }
                await this.app.vault.modify(
                  file,
                  newContent
                );
                if (iframe) {
                  iframe.setAttribute(
                    "src",
                    url
                  );
                }
                new Notice2(
                  "\u5DF2\u5207\u6362\u4E3A\uFF1A" + getNetabaPageName(page.key),
                  4e3
                );
              }
            );
            control.appendChild(button);
          }
          const tip = document.createElement(
            "div"
          );
          tip.textContent = "\u8BF7\u4F7F\u7528\u4E0A\u65B9\u7531\u672C\u63D2\u4EF6\u751F\u6210\u7684\u6309\u94AE\u63A7\u5236\u9875\u9762\u3002Netaba \u7F51\u9875\u5185\u90E8\u7684\u6309\u94AE\u4E0D\u53D7\u672C\u63D2\u4EF6\u63A7\u5236\uFF0C\u56E0\u6B64\u70B9\u51FB\u7F51\u9875\u5185\u90E8\u7684\u201C\u4E2A\u4EBA\u8BC4\u5206\u201D\u6216\u201C\u5B9E\u9A8C\u529F\u80FD\u201D\u65F6\uFF0C\u53EF\u80FD\u4F1A\u770B\u5230\u4E0E\u5F53\u524D\u52A8\u753B\u7B14\u8BB0\u65E0\u5173\u7684\u516C\u5171\u5185\u5BB9\u3002";
          tip.style.width = "100%";
          tip.style.order = "2";
          tip.style.marginTop = "4px";
          tip.style.color = "var(--text-muted)";
          tip.style.fontSize = "0.9em";
          tip.style.lineHeight = "1.5";
          control.appendChild(tip);
        }
      }
    );
  }
  getNetabaPageUrlForNote(content, page) {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      return "";
    }
    const bgmUrl = cleanValue(
      parsed.fields.BGM\u94FE\u63A5
    );
    const subjectMatch = bgmUrl.match(
      /\/subject\/(\d+)/i
    );
    const subjectId = subjectMatch ? subjectMatch[1] : "";
    if (page === "season") {
      return "https://netaba.re/season";
    }
    if (page === "trending") {
      return "https://netaba.re/trending";
    }
    if (page === "history") {
      return "https://netaba.re/history";
    }
    if (page === "user") {
      const userId = String(
        this.settings.netabaUserId || ""
      ).trim();
      return /^\d+$/.test(userId) ? "https://netaba.re/user/" + userId : "";
    }
    if (page === "compare") {
      const compareMatch = String(
        this.settings.netabaCompareUrl || ""
      ).match(
        /\/subject\/(\d+)/i
      );
      const compareSubjectId = compareMatch ? compareMatch[1] : "";
      if (!subjectId || !compareSubjectId) {
        return "";
      }
      return "https://netaba.re/" + subjectId + "/vs/" + compareSubjectId;
    }
    return subjectId ? "https://netaba.re/subject/" + subjectId : "";
  }
  async applyNetabaPageToActiveNote(page) {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.isTargetNote(file)) {
      new Notice2(
        "\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7\u52A8\u753B\u6570\u636E\u7B14\u8BB0\u3002",
        5e3
      );
      return;
    }
    const content = await this.app.vault.read(file);
    const url = this.getNetabaPageUrlForNote(
      content,
      page
    );
    if (!url) {
      new Notice2(
        "\u5F53\u524D\u8BBE\u7F6E\u4E0D\u8DB3\u4EE5\u751F\u6210\u8FD9\u4E2A Netaba \u9875\u9762\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u7F16\u53F7\u6216\u5BF9\u6BD4\u52A8\u753B\u8BBE\u7F6E\u3002",
        6e3
      );
      return;
    }
    const newContent = updateNetabaIframeUrl(
      content,
      url
    );
    if (newContent === content) {
      new Notice2(
        "\u5F53\u524D\u7B14\u8BB0\u4E2D\u6CA1\u6709\u627E\u5230 Netaba \u8BC4\u5206\u56FE\u3002",
        5e3
      );
      return;
    }
    await this.app.vault.modify(
      file,
      newContent
    );
    new Notice2(
      "\u5DF2\u5207\u6362\u4E3A\uFF1A" + getNetabaPageName(page),
      4e3
    );
  }
  async openNetabaPageInBrowser(page) {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.isTargetNote(file)) {
      new Notice2(
        "\u8BF7\u5148\u6253\u5F00\u4E00\u7BC7\u52A8\u753B\u6570\u636E\u7B14\u8BB0\u3002",
        5e3
      );
      return;
    }
    const content = await this.app.vault.read(file);
    const url = this.getNetabaPageUrlForNote(
      content,
      page
    );
    if (!url) {
      new Notice2(
        "\u5F53\u524D\u8BBE\u7F6E\u4E0D\u8DB3\u4EE5\u751F\u6210\u8FD9\u4E2A Netaba \u9875\u9762\uFF0C\u8BF7\u68C0\u67E5\u7528\u6237\u7F16\u53F7\u6216\u5BF9\u6BD4\u52A8\u753B\u8BBE\u7F6E\u3002",
        6e3
      );
      return;
    }
    window.open(url, "_blank");
  }
  async openNetabaNoteManager() {
    const items = await this.collectAnimeItems();
    if (items.length === 0) {
      new Notice2(
        "\u6CA1\u6709\u627E\u5230\u5E26\u6709 bangumi \u6807\u7B7E\u7684\u52A8\u753B\u7B14\u8BB0\u3002",
        6e3
      );
      return;
    }
    new NetabaNoteManagerModal(
      this.app,
      items,
      async (action, files) => {
        await this.batchUpdateNetabaSections(
          action,
          files
        );
      }
    ).open();
  }
  async batchUpdateNetabaSections(action, files) {
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const newContent = updateNetabaSection(
          content,
          action
        );
        if (newContent === content) {
          skipped += 1;
          continue;
        }
        await this.app.vault.modify(
          file,
          newContent
        );
        updated += 1;
      } catch (error) {
        failed += 1;
        console.error(
          "\u6279\u91CF\u5904\u7406 Netaba \u8BC4\u5206\u56FE\u5931\u8D25:",
          file.path,
          error
        );
      }
    }
    const actionText = action === "add" ? "\u521B\u5EFA" : "\u5220\u9664";
    new Notice2(
      "Netaba \u8BC4\u5206\u56FE" + actionText + "\u5B8C\u6210\uFF1A\u66F4\u65B0 " + updated + " \u7BC7\uFF0C\u8DF3\u8FC7 " + skipped + " \u7BC7\uFF0C\u5931\u8D25 " + failed + " \u7BC7\u3002",
      8e3
    );
  }
  async openBatchStatusManager() {
    const items = await this.collectAnimeItems();
    if (items.length === 0) {
      new Notice2(
        "\u6CA1\u6709\u627E\u5230\u5E26\u6709 bangumi \u6807\u7B7E\u7684\u52A8\u753B\u7B14\u8BB0\u3002",
        6e3
      );
      return;
    }
    new BatchStatusModal(
      this.app,
      items,
      async (status, files) => {
        await this.batchChangeWatchStatus(
          status,
          files,
          true
        );
      }
    ).open();
  }
  async openBatchTagManager() {
    const items = await this.collectDashboardItems();
    if (!items || items.length === 0) {
      new Notice2("\u6CA1\u6709\u627E\u5230\u5E26\u6709 bangumi \u6807\u7B7E\u7684\u52A8\u753B\u7B14\u8BB0\u3002", 6e3);
      return;
    }
    new BatchTagManagerModal(this.app, this, items).open();
  }
  async collectAnimeItems() {
    const result = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTargetNote(file)) {
        continue;
      }
      const content = await this.app.vault.read(file);
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) {
        continue;
      }
      const tags = String(
        frontmatter.fields.tags || ""
      );
      if (!tags.includes("bangumi")) {
        continue;
      }
      result.push({
        file,
        name: cleanValue(
          frontmatter.fields.\u4E2D\u6587\u540D
        ) || file.basename,
        state: cleanValue(
          frontmatter.fields.\u89C2\u770B\u72B6\u6001
        ) || "\u672A\u8BBE\u7F6E",
        season: cleanValue(
          frontmatter.fields.\u5F00\u64AD\u5E74\u4EFD
        ) + "\u5E74" + cleanValue(
          frontmatter.fields.\u5F00\u64AD\u5B63\u5EA6
        )
      });
    }
    return result.sort(
      (a, b) => {
        return a.name.localeCompare(
          b.name,
          "zh-CN"
        );
      }
    );
  }
  async batchChangeWatchStatus(status, files, showNotice) {
    let updated = 0;
    let skipped = 0;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const newContent = updateFrontmatterField(
        content,
        "\u89C2\u770B\u72B6\u6001",
        status
      );
      if (newContent === content) {
        skipped += 1;
        continue;
      }
      await this.app.vault.modify(
        file,
        newContent
      );
      updated += 1;
    }
    if (showNotice) {
      new Notice2(
        "\u89C2\u770B\u72B6\u6001\u4FEE\u6539\u5B8C\u6210\uFF1A\u66F4\u65B0 " + updated + " \u7BC7\uFF0C\u8DF3\u8FC7 " + skipped + " \u7BC7\u3002",
        7e3
      );
    }
  }
};
var SeasonViewSelectModal = class extends Modal {
  constructor(app, names, onSubmit) {
    super(app);
    this.names = names;
    this.onSubmit = onSubmit;
    this.selected = /* @__PURE__ */ new Set();
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl(
      "h2",
      {
        text: "\u9009\u62E9\u8981\u6E05\u7406\u7684\u5B63\u5EA6\u89C6\u56FE"
      }
    );
    contentEl.createEl(
      "p",
      {
        text: "\u52FE\u9009\u540E\u4E00\u6B21\u5220\u9664\u3002\u8FD9\u91CC\u53EA\u5220\u9664\u52A8\u753B\u5E93 Base \u4E2D\u7684\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u52A8\u753B\u7B14\u8BB0\u3001\u672C\u5730\u89C6\u9891\u6216\u672C\u5730\u6587\u4EF6\u5939\uFF1B\u201C\u5168\u90E8\u52A8\u753B\u201D\u4E0D\u4F1A\u88AB\u5220\u9664\u3002"
      }
    );
    const controls = contentEl.createDiv();
    const selectAll = controls.createEl(
      "button",
      {
        text: "\u5168\u9009"
      }
    );
    const clearAll = controls.createEl(
      "button",
      {
        text: "\u6E05\u7A7A"
      }
    );
    selectAll.style.marginRight = "8px";
    const list = contentEl.createDiv();
    list.style.maxHeight = "360px";
    list.style.overflowY = "auto";
    list.style.marginTop = "12px";
    for (const name of this.names) {
      const row = list.createDiv();
      row.style.margin = "6px 0";
      const checkbox = row.createEl(
        "input"
      );
      checkbox.type = "checkbox";
      checkbox.dataset.name = name;
      checkbox.onchange = () => {
        if (checkbox.checked) {
          this.selected.add(name);
        } else {
          this.selected.delete(name);
        }
      };
      row.createEl(
        "span",
        {
          text: " " + name
        }
      );
    }
    selectAll.onclick = () => {
      list.querySelectorAll(
        "input[type=checkbox]"
      ).forEach((checkbox) => {
        checkbox.checked = true;
        this.selected.add(
          checkbox.dataset.name
        );
      });
    };
    clearAll.onclick = () => {
      list.querySelectorAll(
        "input[type=checkbox]"
      ).forEach((checkbox) => {
        checkbox.checked = false;
      });
      this.selected.clear();
    };
    const submit = contentEl.createEl(
      "button",
      {
        text: "\u5220\u9664\u5DF2\u9009\u89C6\u56FE"
      }
    );
    submit.style.marginTop = "14px";
    submit.onclick = async () => {
      if (this.selected.size === 0) {
        new Notice2(
          "\u8BF7\u5148\u52FE\u9009\u8981\u6E05\u7406\u7684\u5B63\u5EA6\u89C6\u56FE\u3002",
          5e3
        );
        return;
      }
      const selected = [...this.selected];
      this.close();
      await this.onSubmit(selected);
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SeasonViewConfirmModal = class extends Modal {
  constructor(app, names, onConfirm) {
    super(app);
    this.names = names;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl(
      "h2",
      {
        text: "\u786E\u8BA4\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6"
      }
    );
    contentEl.createEl(
      "p",
      {
        text: "\u4EE5\u4E0B\u5B63\u5EA6\u5C06\u53EA\u5220\u9664\u52A8\u753B\u5E93 Base \u4E2D\u7684\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u4F1A\u5220\u9664\u52A8\u753B\u7B14\u8BB0\u3001\u672C\u5730\u89C6\u9891\u6216\u672C\u5730\u6587\u4EF6\u5939\uFF1A"
      }
    );
    const list = contentEl.createEl("ul");
    for (const name of this.names) {
      list.createEl(
        "li",
        {
          text: name
        }
      );
    }
    contentEl.createEl(
      "p",
      {
        text: "\u72B6\u6001\u4E3A\u201C\u5DF2\u770B\u201D\u7684\u52A8\u753B\u4F1A\u89C6\u4E3A\u5DF2\u5B8C\u6210\uFF1B\u603B\u96C6\u6570\u672A\u77E5\u3001\u8DEF\u5F84\u4E0D\u5B58\u5728\u6216\u4ECD\u6709\u672A\u5B8C\u6210\u52A8\u753B\u7684\u5176\u4ED6\u52A8\u753B\u4E0D\u4F1A\u4F5C\u4E3A\u5B8C\u6210\u4F9D\u636E\u3002"
      }
    );
    const button = contentEl.createEl(
      "button",
      {
        text: "\u786E\u8BA4\u6E05\u7406"
      }
    );
    button.onclick = async () => {
      this.close();
      await this.onConfirm();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var BatchStatusModal = class extends Modal {
  constructor(app, items, onSubmit) {
    super(app);
    this.items = items;
    this.onSubmit = onSubmit;
    this.selected = /* @__PURE__ */ new Set();
    this.filteredItems = items;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl(
      "h2",
      {
        text: "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001"
      }
    );
    contentEl.createEl(
      "p",
      {
        text: "\u5148\u9009\u62E9\u201C\u5C06\u89C2\u770B\u72B6\u6001\u6539\u4E3A\u201D\u7684\u76EE\u6807\u72B6\u6001\uFF0C\u518D\u52FE\u9009\u591A\u90E8\u52A8\u753B\u3002\u6267\u884C\u540E\u53EA\u4FEE\u6539\u89C2\u770B\u72B6\u6001\uFF0C\u4E0D\u91CD\u5EFA\u7B14\u8BB0\u3002"
      }
    );
    const statusLabel = contentEl.createEl(
      "p",
      {
        text: "\u5C06\u89C2\u770B\u72B6\u6001\u6539\u4E3A\uFF1A"
      }
    );
    statusLabel.style.marginBottom = "4px";
    const status = contentEl.createEl("select");
    for (const value of WATCH_STATES) {
      status.createEl(
        "option",
        {
          text: value,
          value
        }
      );
    }
    const filterLabel = contentEl.createEl(
      "p",
      {
        text: "\u4E0B\u9762\u7684\u7B5B\u9009\u53EA\u5F71\u54CD\u5217\u8868\u663E\u793A\uFF0C\u4E0D\u4F1A\u7ACB\u5373\u4FEE\u6539\u52A8\u753B\u3002"
      }
    );
    filterLabel.style.marginTop = "12px";
    filterLabel.style.marginBottom = "4px";
    const filterRow = contentEl.createDiv();
    filterRow.style.marginTop = "10px";
    const stateFilter = filterRow.createEl("select");
    [
      "\u5168\u90E8\u89C2\u770B\u72B6\u6001",
      ...WATCH_STATES
    ].forEach((value) => {
      stateFilter.createEl(
        "option",
        {
          text: value,
          value
        }
      );
    });
    const seasonFilter = filterRow.createEl("select");
    const seasons = [
      "\u5168\u90E8\u5B63\u5EA6",
      ...new Set(
        this.items.map((item) => item.season).filter(
          (season) => {
            return season && season !== "\u5E74";
          }
        )
      )
    ];
    seasons.forEach((value) => {
      seasonFilter.createEl(
        "option",
        {
          text: value,
          value
        }
      );
    });
    const controls = contentEl.createDiv();
    controls.style.marginTop = "10px";
    const selectAll = controls.createEl(
      "button",
      {
        text: "\u5168\u9009\u5F53\u524D\u7ED3\u679C"
      }
    );
    const clearAll = controls.createEl(
      "button",
      {
        text: "\u6E05\u7A7A\u9009\u62E9"
      }
    );
    selectAll.style.marginRight = "8px";
    const list = contentEl.createDiv();
    list.style.maxHeight = "380px";
    list.style.overflowY = "auto";
    list.style.marginTop = "10px";
    const render = () => {
      list.empty();
      this.filteredItems = this.items.filter(
        (item) => {
          const stateOk = stateFilter.value === "\u5168\u90E8\u89C2\u770B\u72B6\u6001" || item.state === stateFilter.value;
          const seasonOk = seasonFilter.value === "\u5168\u90E8\u5B63\u5EA6" || item.season === seasonFilter.value;
          return stateOk && seasonOk;
        }
      );
      for (const item of this.filteredItems) {
        const row = list.createDiv();
        row.style.margin = "5px 0";
        const checkbox = row.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.selected.has(
          item.file.path
        );
        checkbox.onchange = () => {
          if (checkbox.checked) {
            this.selected.add(
              item.file.path
            );
          } else {
            this.selected.delete(
              item.file.path
            );
          }
        };
        row.createEl(
          "span",
          {
            text: " " + item.name + " [" + item.state + "] " + item.season
          }
        );
      }
    };
    stateFilter.onchange = render;
    seasonFilter.onchange = render;
    selectAll.onclick = () => {
      for (const item of this.filteredItems) {
        this.selected.add(
          item.file.path
        );
      }
      render();
    };
    clearAll.onclick = () => {
      this.selected.clear();
      render();
    };
    render();
    const submit = contentEl.createEl(
      "button",
      {
        text: "\u6267\u884C\u4FEE\u6539"
      }
    );
    submit.style.marginTop = "14px";
    submit.onclick = async () => {
      if (this.selected.size === 0) {
        new Notice2(
          "\u8BF7\u5148\u9009\u62E9\u52A8\u753B\u3002",
          5e3
        );
        return;
      }
      const selectedFiles = this.items.filter((item) => {
        return this.selected.has(
          item.file.path
        );
      }).map((item) => item.file);
      this.close();
      await this.onSubmit(
        status.value,
        selectedFiles
      );
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ManagerRibbonModal = class extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const {
      contentEl
    } = this;
    contentEl.empty();
    contentEl.createEl(
      "h2",
      {
        text: "Bangumi \u8FFD\u756A\u7BA1\u7406\u5668"
      }
    );
    contentEl.createEl(
      "p",
      {
        text: "\u8BF7\u9009\u62E9\u8981\u6267\u884C\u7684\u64CD\u4F5C\u3002"
      }
    );
    this.addButton(
      contentEl,
      "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
      async () => {
        if (typeof openSingleAnimeImport !== "function") {
          new Notice2(
            "\u5355\u4E2A\u52A8\u753B\u5BFC\u5165\u6A21\u5757\u5C1A\u672A\u6B63\u786E\u52A0\u8F7D\u3002",
            8e3
          );
          return;
        }
        this.close();
        await openSingleAnimeImport(
          this.app,
          this.plugin
        );
      }
    );
    this.addButton(
      contentEl,
      "\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
      async () => {
        this.close();
        await openBatchAnimeImport(
          this.app,
          this.plugin
        );
      }
    );
    this.addButton(
      contentEl,
      "\u6253\u5F00\u6211\u7684 Bangumi \u8BC4\u5206\u6392\u884C",
      async () => {
        const userId = String(
          this.plugin.settings.bangumiUserId || ""
        ).trim();
        if (!/^\d+$/.test(userId)) {
          new Notice2(
            "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u6B63\u786E\u7684 Bangumi \u7528\u6237 ID\u3002",
            6e3
          );
          return;
        }
        window.open(
          "https://bangumi.tv/anime/list/" + userId + "/collect?orderby=rate",
          "_blank"
        );
      }
    );
    this.addButton(
      contentEl,
      "\u5207\u6362 Netaba \u9875\u9762",
      async () => {
        new NetabaPageSelectModal(
          this.app,
          this.plugin
        ).open();
      }
    );
    this.addButton(
      contentEl,
      "\u7ACB\u5373\u68C0\u67E5\u672C\u5730\u72B6\u6001",
      async () => {
        this.close();
        await this.plugin.checkAllLocalStatus(
          true
        );
      }
    );
    this.addButton(
      contentEl,
      "\u751F\u6210\u5F53\u524D\u5B63\u5EA6\u89C6\u56FE",
      async () => {
        this.close();
        await this.plugin.runTemporarySeasonMode(
          "current"
        );
      }
    );
    this.addButton(
      contentEl,
      "\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u6E05\u7406",
      async () => {
        this.close();
        await this.plugin.openSeasonViewCleanup();
      }
    );
    this.addButton(
      contentEl,
      "\u5B89\u5168\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE",
      async () => {
        this.close();
        await this.plugin.cleanCompletedSeasonViews(
          true
        );
      }
    );
    this.addButton(
      contentEl,
      "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
      async () => {
        this.close();
        await this.plugin.openBatchStatusManager();
      }
    );
  }
  addButton(container, text, callback) {
    const button = container.createEl(
      "button",
      {
        text
      }
    );
    button.style.display = "block";
    button.style.width = "100%";
    button.style.margin = "8px 0";
    button.onclick = callback;
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmDeleteSectionModal = class extends Modal {
  constructor(app, sectionTitle, onConfirm, customDesc) {
    super(app);
    this.sectionTitle = sectionTitle;
    this.onConfirm = onConfirm;
    this.customDesc = customDesc;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "\u786E\u8BA4\u5220\u9664" });
    contentEl.createEl("p", {
      text: this.customDesc || `\u786E\u5B9A\u8981\u5220\u9664\u81EA\u5B9A\u4E49\u5206\u533A\u201C${this.sectionTitle}\u201D\u5417\uFF1F\u6B64\u64CD\u4F5C\u4EC5\u79FB\u9664\u5206\u533A\u914D\u7F6E\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u4EFB\u4F55\u52A8\u753B\u7B14\u8BB0\u6216\u6570\u636E\u3002`
    });
    const actions = contentEl.createDiv("bangumi-modal-actions");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "16px";
    const cancelBtn = actions.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = actions.createEl("button", {
      text: "\u5220\u9664",
      cls: "mod-warning"
    });
    confirmBtn.onclick = async () => {
      this.close();
      if (typeof this.onConfirm === "function") {
        await this.onConfirm();
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CustomQuerySectionModal = class extends Modal {
  constructor(app, plugin, existingConfig, onSave) {
    super(app);
    this.plugin = plugin;
    this.existingConfig = existingConfig;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bangumi-custom-query-modal");
    const isEdit = Boolean(this.existingConfig);
    contentEl.createEl("h2", {
      text: isEdit ? "\u7F16\u8F91\u81EA\u5B9A\u4E49\u67E5\u8BE2\u5206\u533A" : "\u65B0\u5EFA\u81EA\u5B9A\u4E49\u67E5\u8BE2\u5206\u533A"
    });
    const formData = Object.assign(
      {
        id: "custom_" + Date.now(),
        title: "",
        tag: "",
        watchStatus: "all",
        minMyScore: 0,
        minBgmScore: 0,
        year: "",
        season: "",
        displayMode: "grid",
        sortBy: "myScore_desc",
        limit: 12
      },
      this.existingConfig || {}
    );
    new Setting(contentEl).setName("\u5206\u533A\u540D\u79F0").setDesc("\u4E3A\u8BE5\u67E5\u8BE2\u5206\u533A\u8D77\u4E00\u4E2A\u6E05\u6670\u7684\u6807\u9898").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A\u6211\u6700\u559C\u7231\u7684\u767E\u5408\u52A8\u753B\u30012025\u5728\u770B\u4F73\u4F5C").setValue(formData.title).onChange((val) => {
        formData.title = val;
      });
    });
    new Setting(contentEl).setName("\u6807\u7B7E\u7B5B\u9009 (tags)").setDesc("\u5FC5\u987B\u5305\u542B\u7684\u6807\u7B7E\uFF0C\u5982\u201C\u767E\u5408\u201D\u6216\u201C\u539F\u521B\u201D\uFF08\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u6807\u7B7E\uFF09").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A\u767E\u5408\uFF08\u7559\u7A7A\u4E0D\u9650\uFF09").setValue(formData.tag || "").onChange((val) => {
        formData.tag = val;
      });
    });
    new Setting(contentEl).setName("\u89C2\u770B\u72B6\u6001").setDesc("\u6309\u52A8\u753B\u89C2\u770B\u72B6\u6001\u8FDB\u884C\u7B5B\u9009").addDropdown((dropdown) => {
      dropdown.addOption("all", "\u5168\u90E8").addOption("\u60F3\u770B", "\u60F3\u770B").addOption("\u5728\u770B", "\u5728\u770B").addOption("\u5DF2\u770B", "\u5DF2\u770B").addOption("\u629B\u5F03", "\u629B\u5F03").setValue(formData.watchStatus || "all").onChange((val) => {
        formData.watchStatus = val;
      });
    });
    new Setting(contentEl).setName("\u4E2A\u4EBA\u8BC4\u5206\u4E0B\u9650").setDesc("\u7B5B\u9009\u201C\u6211\u7684\u8BC4\u5206\u201D\u8FBE\u5230\u6307\u5B9A\u5206\u6570\u7684\u4F5C\u54C1").addDropdown((dropdown) => {
      dropdown.addOption("0", "\u65E0\u9650\u5236").addOption("6", "6 \u5206\u4EE5\u4E0A").addOption("7", "7 \u5206\u4EE5\u4E0A").addOption("8", "8 \u5206\u4EE5\u4E0A").addOption("9", "9 \u5206\u4EE5\u4E0A").setValue(String(formData.minMyScore || 0)).onChange((val) => {
        formData.minMyScore = Number(val) || 0;
      });
    });
    new Setting(contentEl).setName("BGM \u8BC4\u5206\u4E0B\u9650").setDesc("\u7B5B\u9009 Bangumi \u8BC4\u5206\u8FBE\u5230\u6307\u5B9A\u5206\u6570\u7684\u4F5C\u54C1").addDropdown((dropdown) => {
      dropdown.addOption("0", "\u65E0\u9650\u5236").addOption("6", "6 \u5206\u4EE5\u4E0A").addOption("7", "7 \u5206\u4EE5\u4E0A").addOption("7.5", "7.5 \u5206\u4EE5\u4E0A").addOption("8", "8 \u5206\u4EE5\u4E0A").setValue(String(formData.minBgmScore || 0)).onChange((val) => {
        formData.minBgmScore = Number(val) || 0;
      });
    });
    new Setting(contentEl).setName("\u5F00\u64AD\u5E74\u4EFD").setDesc("\u6307\u5B9A\u56DB\u4F4D\u5E74\u4EFD\uFF08\u5982 2025\uFF0C\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5E74\u4EFD\uFF09").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A2025\uFF08\u7559\u7A7A\u4E0D\u9650\uFF09").setValue(formData.year || "").onChange((val) => {
        formData.year = val;
      });
    });
    new Setting(contentEl).setName("\u5F00\u64AD\u5B63\u5EA6").setDesc("\u6307\u5B9A\u5F00\u64AD\u5B63\u5EA6\uFF08\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5B63\u5EA6\uFF09").addDropdown((dropdown) => {
      dropdown.addOption("", "\u5168\u90E8\u5B63\u5EA6\uFF08\u7559\u7A7A\u4E0D\u9650\uFF09").addOption("01\u6708\u65B0\u756A", "01\u6708\u65B0\u756A (\u51AC\u5B63)").addOption("04\u6708\u65B0\u756A", "04\u6708\u65B0\u756A (\u6625\u5B63)").addOption("07\u6708\u65B0\u756A", "07\u6708\u65B0\u756A (\u590F\u5B63)").addOption("10\u6708\u65B0\u756A", "10\u6708\u65B0\u756A (\u79CB\u5B63)").setValue(formData.season || "").onChange((val) => {
        formData.season = val;
      });
    });
    new Setting(contentEl).setName("\u5C55\u793A\u5F62\u6001").setDesc("\u9009\u62E9\u5206\u533A\u5728\u4EEA\u8868\u76D8\u4E0A\u7684\u5C55\u73B0\u65B9\u5F0F").addDropdown((dropdown) => {
      dropdown.addOption("grid", "\u54CD\u5E94\u5F0F\u5C01\u9762\u6D77\u62A5\u7F51\u683C (Cover Grid)").addOption("list", "\u7D27\u51D1\u699C\u5355\u5217\u8868 (Compact List)").setValue(formData.displayMode || "grid").onChange((val) => {
        formData.displayMode = val;
      });
    });
    new Setting(contentEl).setName("\u6392\u5E8F\u4F9D\u636E").setDesc("\u9009\u62E9\u5206\u533A\u5185\u90E8\u4F5C\u54C1\u7684\u6392\u5E8F\u89C4\u5219").addDropdown((dropdown) => {
      dropdown.addOption("myScore_desc", "\u6309\u4E2A\u4EBA\u8BC4\u5206\u964D\u5E8F").addOption("bgmScore_desc", "\u6309 BGM \u8BC4\u5206\u964D\u5E8F").addOption("year_desc", "\u6309\u5F00\u64AD\u5E74\u4EFD\u964D\u5E8F").addOption("title_asc", "\u6309\u4F5C\u54C1\u540D\u79F0\u5347\u5E8F").setValue(formData.sortBy || "myScore_desc").onChange((val) => {
        formData.sortBy = val;
      });
    });
    new Setting(contentEl).setName("\u663E\u793A\u6570\u91CF\u4E0A\u9650").setDesc("\u63A7\u5236\u8BE5\u5206\u533A\u6700\u591A\u663E\u793A\u7684\u4F5C\u54C1\u6570\u91CF").addDropdown((dropdown) => {
      dropdown.addOption("6", "6 \u90E8").addOption("12", "12 \u90E8").addOption("18", "18 \u90E8").addOption("24", "24 \u90E8").addOption("0", "\u5168\u90E8\u663E\u793A").setValue(String(formData.limit !== void 0 ? formData.limit : 12)).onChange((val) => {
        formData.limit = Number(val);
      });
    });
    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = footer.createEl("button", {
      text: isEdit ? "\u4FDD\u5B58\u4FEE\u6539" : "\u521B\u5EFA\u5206\u533A",
      cls: "mod-cta"
    });
    saveBtn.onclick = async () => {
      const cleanTitle = String(formData.title || "").trim();
      if (!cleanTitle) {
        new Notice2("\u8BF7\u8F93\u5165\u5206\u533A\u540D\u79F0\uFF01");
        return;
      }
      formData.title = cleanTitle;
      formData.tag = String(formData.tag || "").trim();
      formData.year = String(formData.year || "").trim();
      formData.season = String(formData.season || "").trim();
      const customSections = Array.isArray(this.plugin.settings.customQuerySections) ? [...this.plugin.settings.customQuerySections] : [];
      if (isEdit) {
        const idx = customSections.findIndex((s) => s.id === formData.id);
        if (idx >= 0) {
          customSections[idx] = formData;
        } else {
          customSections.push(formData);
        }
      } else {
        customSections.push(formData);
      }
      this.plugin.settings.customQuerySections = customSections;
      await this.plugin.saveSettings();
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave(formData);
      }
      new Notice2(isEdit ? `\u5DF2\u66F4\u65B0\u5206\u533A\u201C${formData.title}\u201D\u3002` : `\u5DF2\u521B\u5EFA\u5206\u533A\u201C${formData.title}\u201D\u3002`);
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CustomCollectionModal = class extends Modal {
  constructor(app, plugin, existingConfig, onSave) {
    super(app);
    this.plugin = plugin;
    this.existingConfig = existingConfig;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bangumi-custom-collection-modal");
    const isEdit = Boolean(this.existingConfig);
    contentEl.createEl("h2", {
      text: isEdit ? "\u7F16\u8F91\u6536\u85CF\u5C55\u67DC" : "\u65B0\u5EFA\u6536\u85CF\u5C55\u67DC"
    });
    contentEl.createEl("p", {
      cls: "bangumi-modal-subtitle",
      text: "\u624B\u52A8\u6311\u9009\u5E76\u7F16\u6392\u5FC3\u7231\u4F5C\u54C1\u7684\u4E13\u5C5E\u5C55\u67DC\uFF0C\u652F\u6301\u5361\u7247\u62D6\u62FD\u91CD\u6392\u4E0E\u76F4\u89C2\u5C55\u51FA\u3002"
    });
    const formData = Object.assign(
      {
        id: "col_" + Date.now(),
        title: "",
        displayMode: "grid",
        items: []
      },
      this.existingConfig || {}
    );
    new Setting(contentEl).setName("\u5C55\u67DC\u540D\u79F0").setDesc("\u4E3A\u60A8\u7684\u6536\u85CF\u5C55\u67DC\u8D77\u4E00\u4E2A\u4F18\u96C5\u7684\u540D\u5B57").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A\u5E74\u5EA6\u5341\u4F73\u3001\u795E\u4F5C\u6BBF\u5802\u3001\u4E8C\u6B21\u5143\u542F\u8499...").setValue(formData.title).onChange((val) => {
        formData.title = val;
      });
      setTimeout(() => text.inputEl.focus(), 50);
    });
    new Setting(contentEl).setName("\u5C55\u793A\u5F62\u6001").setDesc("\u9009\u62E9\u5C55\u67DC\u5728\u4EEA\u8868\u76D8\u4E0A\u7684\u5C55\u73B0\u65B9\u5F0F").addDropdown((dropdown) => {
      dropdown.addOption("grid", "\u54CD\u5E94\u5F0F\u5C01\u9762\u6D77\u62A5\u7F51\u683C (Cover Grid)").addOption("list", "\u7D27\u51D1\u699C\u5355\u5217\u8868 (Compact List)").setValue(formData.displayMode || "grid").onChange((val) => {
        formData.displayMode = val;
      });
    });
    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = footer.createEl("button", {
      text: isEdit ? "\u4FDD\u5B58\u4FEE\u6539" : "\u521B\u5EFA\u5C55\u67DC\u5E76\u6311\u9009\u52A8\u753B",
      cls: "mod-cta"
    });
    saveBtn.onclick = async () => {
      const cleanTitle = String(formData.title || "").trim();
      if (!cleanTitle) {
        new Notice2("\u8BF7\u8F93\u5165\u5C55\u67DC\u540D\u79F0\uFF01");
        return;
      }
      formData.title = cleanTitle;
      const collections = Array.isArray(this.plugin.settings.customCollectionSections) ? [...this.plugin.settings.customCollectionSections] : [];
      if (isEdit) {
        const idx = collections.findIndex((s) => s.id === formData.id);
        if (idx >= 0) {
          collections[idx] = formData;
        } else {
          collections.push(formData);
        }
      } else {
        collections.push(formData);
      }
      this.plugin.settings.customCollectionSections = collections;
      await this.plugin.saveSettings();
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave(formData);
      }
      new Notice2(isEdit ? `\u5DF2\u66F4\u65B0\u5C55\u67DC\u201C${formData.title}\u201D\u3002` : `\u5DF2\u521B\u5EFA\u5C55\u67DC\u201C${formData.title}\u201D\u3002`);
      if (!isEdit) {
        this.plugin.openCollectionItemsManagerModal(formData, this.onSave);
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var CollectionItemsManagerModal = class extends Modal {
  constructor(app, plugin, collectionConfig, onSave) {
    super(app);
    this.plugin = plugin;
    this.collectionConfig = collectionConfig;
    this.onSave = onSave;
    this.searchQuery = "";
    this.statusFilter = "all";
    this.allItems = [];
    this.currentItems = Array.isArray(collectionConfig.items) ? [...collectionConfig.items] : [];
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.style.width = "min(860px, 94vw)";
    this.modalEl.style.maxWidth = "94vw";
    this.modalEl.style.maxHeight = "90vh";
    this.modalEl.style.overflowY = "auto";
    contentEl.createEl("h2", {
      text: `\u7BA1\u7406\u6536\u85CF\u5C55\u67DC - \u300A${this.collectionConfig.title}\u300B`
    });
    contentEl.createEl("p", {
      cls: "bangumi-modal-subtitle",
      text: "\u4ECE\u52A8\u753B\u5E93\u4E2D\u6311\u9009\u52A8\u753B\u6536\u5F55\u81F3\u5C55\u67DC\uFF0C\u4F7F\u7528\u201C\u2191 / \u2193\u201D\u5FAE\u8C03\u5C55\u793A\u987A\u5E8F\uFF0C\u6216\u4E00\u952E\u4ECE\u5C55\u67DC\u79FB\u51FA\u3002"
    });
    this.allItems = await this.plugin.collectDashboardItems();
    const itemByPath = /* @__PURE__ */ new Map();
    const itemBySubject = /* @__PURE__ */ new Map();
    for (const it of this.allItems) {
      if (it.file && it.file.path) itemByPath.set(it.file.path, it);
      if (it.subjectId) itemBySubject.set(String(it.subjectId), it);
    }
    const controlsRow = contentEl.createDiv("bangumi-collection-manager-controls");
    controlsRow.style.display = "flex";
    controlsRow.style.gap = "10px";
    controlsRow.style.marginBottom = "14px";
    controlsRow.style.flexWrap = "wrap";
    const searchInput = controlsRow.createEl("input", {
      type: "text",
      placeholder: "\u641C\u7D22\u52A8\u753B\u5E93\uFF08\u6807\u9898\u3001\u65E5\u6587\u540D\u3001\u6807\u7B7E\uFF09..."
    });
    searchInput.style.flex = "1";
    searchInput.style.minWidth = "200px";
    const statusSelect = controlsRow.createEl("select");
    [
      { val: "all", text: "\u5168\u90E8\u72B6\u6001" },
      { val: "\u5728\u770B", text: "\u5728\u770B" },
      { val: "\u5DF2\u770B", text: "\u5DF2\u770B" },
      { val: "\u60F3\u770B", text: "\u60F3\u770B" },
      { val: "\u629B\u5F03", text: "\u629B\u5F03" }
    ].forEach((opt) => {
      const o = statusSelect.createEl("option", { value: opt.val, text: opt.text });
      if (opt.val === this.statusFilter) o.selected = true;
    });
    const panelsWrap = contentEl.createDiv("bangumi-collection-manager-panels");
    panelsWrap.style.display = "grid";
    panelsWrap.style.gridTemplateColumns = "1fr 1fr";
    panelsWrap.style.gap = "14px";
    panelsWrap.style.minHeight = "360px";
    const leftCol = panelsWrap.createDiv("bangumi-collection-panel");
    const rightCol = panelsWrap.createDiv("bangumi-collection-panel");
    const leftHeader = leftCol.createDiv("bangumi-collection-panel-header");
    const rightHeader = rightCol.createDiv("bangumi-collection-panel-header");
    const leftList = leftCol.createDiv("bangumi-collection-panel-list");
    leftList.style.maxHeight = "360px";
    leftList.style.overflowY = "auto";
    leftList.style.display = "flex";
    leftList.style.flexDirection = "column";
    leftList.style.gap = "6px";
    const rightList = rightCol.createDiv("bangumi-collection-panel-list");
    rightList.style.maxHeight = "360px";
    rightList.style.overflowY = "auto";
    rightList.style.display = "flex";
    rightList.style.flexDirection = "column";
    rightList.style.gap = "6px";
    const isItemInShelf = (it) => {
      return this.currentItems.some((entry) => {
        const p = typeof entry === "string" ? entry : entry.path;
        const sub = typeof entry === "object" ? entry.subjectId : null;
        if (it.file && p === it.file.path) return true;
        if (it.subjectId && sub && String(sub) === String(it.subjectId)) return true;
        return false;
      });
    };
    const renderPanels = () => {
      leftHeader.empty();
      leftHeader.createEl("strong", {
        text: `\u5DF2\u6536\u5F55\u5230\u5C55\u67DC (${this.currentItems.length} \u90E8)`
      });
      leftList.empty();
      if (this.currentItems.length === 0) {
        leftList.createDiv({
          cls: "bangumi-collection-panel-empty",
          text: "\u5C55\u67DC\u4E3A\u7A7A\uFF0C\u8BF7\u4ECE\u53F3\u4FA7\u70B9\u51FB\u201C+ \u6DFB\u52A0\u201D\u52A0\u5165\u4F5C\u54C1\u3002"
        });
      } else {
        this.currentItems.forEach((entry, idx) => {
          const entryPath = typeof entry === "string" ? entry : entry.path;
          const entrySubject = typeof entry === "object" ? entry.subjectId : null;
          const resolved = entryPath && itemByPath.get(entryPath) || entrySubject && itemBySubject.get(String(entrySubject)) || null;
          const title = resolved ? resolved.name : entry.name || entryPath || "\u672A\u77E5\u52A8\u753B";
          const state = resolved ? resolved.state : "";
          const row = leftList.createDiv("bangumi-collection-manager-row");
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.justifyContent = "space-between";
          row.style.padding = "6px 8px";
          row.style.borderRadius = "6px";
          row.style.background = "var(--background-secondary)";
          row.style.fontSize = "0.85em";
          const leftInfo = row.createDiv();
          leftInfo.style.display = "flex";
          leftInfo.style.alignItems = "center";
          leftInfo.style.gap = "6px";
          leftInfo.style.minWidth = "0";
          leftInfo.style.flex = "1";
          leftInfo.createSpan({
            text: `${idx + 1}.`,
            cls: "bangumi-collection-idx"
          }).style.color = "var(--text-faint)";
          const titleEl = leftInfo.createSpan({
            text: title,
            cls: "bangumi-collection-title"
          });
          titleEl.style.overflow = "hidden";
          titleEl.style.textOverflow = "ellipsis";
          titleEl.style.whiteSpace = "nowrap";
          if (state) {
            const pill = leftInfo.createSpan({
              text: state,
              cls: `bangumi-list-state-pill is-${state}`
            });
            pill.style.fontSize = "10px";
            pill.style.padding = "0 4px";
          }
          const ops = row.createDiv();
          ops.style.display = "flex";
          ops.style.gap = "4px";
          ops.style.flexShrink = "0";
          if (idx > 0) {
            const btnUp = ops.createEl("button", { text: "\u2191", cls: "bangumi-manager-mini-btn" });
            btnUp.title = "\u4E0A\u79FB";
            btnUp.onclick = () => {
              const temp = this.currentItems[idx - 1];
              this.currentItems[idx - 1] = this.currentItems[idx];
              this.currentItems[idx] = temp;
              renderPanels();
            };
          }
          if (idx < this.currentItems.length - 1) {
            const btnDown = ops.createEl("button", { text: "\u2193", cls: "bangumi-manager-mini-btn" });
            btnDown.title = "\u4E0B\u79FB";
            btnDown.onclick = () => {
              const temp = this.currentItems[idx + 1];
              this.currentItems[idx + 1] = this.currentItems[idx];
              this.currentItems[idx] = temp;
              renderPanels();
            };
          }
          const btnDel = ops.createEl("button", { text: "\xD7", cls: "bangumi-manager-mini-btn mod-warning" });
          btnDel.title = "\u4ECE\u5C55\u67DC\u79FB\u51FA";
          btnDel.onclick = () => {
            this.currentItems.splice(idx, 1);
            renderPanels();
          };
        });
      }
      rightHeader.empty();
      const q = String(this.searchQuery || "").toLowerCase().trim();
      const st = this.statusFilter;
      const candidates = this.allItems.filter((it) => {
        if (isItemInShelf(it)) return false;
        if (st !== "all" && it.state !== st) return false;
        if (q) {
          const matchTitle = (it.name || "").toLowerCase().includes(q);
          const matchJp = (it.japaneseName || "").toLowerCase().includes(q);
          const matchTag = (it.tags || "").toLowerCase().includes(q);
          if (!matchTitle && !matchJp && !matchTag) return false;
        }
        return true;
      });
      rightHeader.createEl("strong", {
        text: `\u52A8\u753B\u5E93\u5019\u9009 (${candidates.length} \u90E8)`
      });
      rightList.empty();
      if (candidates.length === 0) {
        rightList.createDiv({
          cls: "bangumi-collection-panel-empty",
          text: q ? "\u672A\u641C\u7D22\u5230\u5339\u914D\u7684\u52A8\u753B\u3002" : "\u6240\u6709\u7B26\u5408\u6761\u4EF6\u7684\u52A8\u753B\u5747\u5DF2\u6536\u5F55\u3002"
        });
      } else {
        candidates.slice(0, 50).forEach((it) => {
          const row = rightList.createDiv("bangumi-collection-manager-row");
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.justifyContent = "space-between";
          row.style.padding = "6px 8px";
          row.style.borderRadius = "6px";
          row.style.background = "var(--background-secondary)";
          row.style.fontSize = "0.85em";
          const leftInfo = row.createDiv();
          leftInfo.style.display = "flex";
          leftInfo.style.alignItems = "center";
          leftInfo.style.gap = "6px";
          leftInfo.style.minWidth = "0";
          leftInfo.style.flex = "1";
          const titleEl = leftInfo.createSpan({ text: it.name });
          titleEl.style.overflow = "hidden";
          titleEl.style.textOverflow = "ellipsis";
          titleEl.style.whiteSpace = "nowrap";
          if (it.state) {
            const pill = leftInfo.createSpan({
              text: it.state,
              cls: `bangumi-list-state-pill is-${it.state}`
            });
            pill.style.fontSize = "10px";
            pill.style.padding = "0 4px";
          }
          if (it.year) {
            leftInfo.createSpan({
              text: it.year,
              cls: "bangumi-meta-year"
            }).style.color = "var(--text-faint)";
          }
          const addBtn = row.createEl("button", {
            text: "+ \u6DFB\u52A0",
            cls: "bangumi-manager-mini-btn mod-cta"
          });
          addBtn.onclick = () => {
            this.currentItems.push({
              path: it.file.path,
              subjectId: it.subjectId || "",
              name: it.name
            });
            renderPanels();
          };
        });
        if (candidates.length > 50) {
          rightList.createDiv({
            cls: "bangumi-collection-more-hint",
            text: "\u5DF2\u663E\u793A\u524D 50 \u90E8\uFF0C\u66F4\u591A\u4F5C\u54C1\u8BF7\u4F7F\u7528\u4E0A\u65B9\u641C\u7D22\u6846\u8FC7\u6EE4\u3002"
          });
        }
      }
    };
    searchInput.oninput = () => {
      this.searchQuery = searchInput.value;
      renderPanels();
    };
    statusSelect.onchange = () => {
      this.statusFilter = statusSelect.value;
      renderPanels();
    };
    renderPanels();
    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = footer.createEl("button", {
      text: "\u4FDD\u5B58\u5C55\u67DC\u7F16\u6392",
      cls: "mod-cta"
    });
    saveBtn.onclick = async () => {
      this.collectionConfig.items = this.currentItems;
      const collections = Array.isArray(this.plugin.settings.customCollectionSections) ? [...this.plugin.settings.customCollectionSections] : [];
      const idx = collections.findIndex((c) => c.id === this.collectionConfig.id);
      if (idx >= 0) {
        collections[idx] = this.collectionConfig;
      } else {
        collections.push(this.collectionConfig);
      }
      this.plugin.settings.customCollectionSections = collections;
      await this.plugin.saveSettings();
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave();
      }
      new Notice2(`\u5DF2\u4FDD\u5B58\u5C55\u67DC\u201C${this.collectionConfig.title}\u201D\u7684\u7F16\u6392\uFF08\u5171\u6536\u5F55 ${this.currentItems.length} \u90E8\uFF09\u3002`);
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SetEpisodesModal = class extends Modal {
  constructor(app, plugin, item, onSave) {
    super(app);
    this.plugin = plugin;
    this.item = item;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bangumi-set-episodes-modal");
    contentEl.createEl("h2", { text: "\u8BBE\u7F6E\u89C2\u770B\u96C6\u6570" });
    contentEl.createDiv({
      cls: "bangumi-modal-subtitle",
      text: `\u300A${this.item.name}\u300B`
    });
    const currentWatched = Number(this.item.watchedEpisodes) || 0;
    const total = Number(this.item.totalEpisodes) || 0;
    let targetCount = currentWatched;
    new Setting(contentEl).setName("\u5DF2\u89C2\u770B\u96C6\u6570").setDesc(total > 0 ? `\u5F53\u524D\u8FDB\u5EA6\uFF1A${currentWatched} / ${total} \u8BDD` : `\u5F53\u524D\u8FDB\u5EA6\uFF1A${currentWatched} \u8BDD`).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      if (total > 0) text.inputEl.max = String(total * 2);
      text.setValue(String(targetCount));
      text.onChange((val) => {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 0) {
          targetCount = num;
        }
      });
      this.inputComponent = text;
      setTimeout(() => text.inputEl.focus(), 50);
    });
    const shortcuts = contentEl.createDiv("bangumi-ep-shortcuts");
    shortcuts.style.display = "flex";
    shortcuts.style.gap = "8px";
    shortcuts.style.marginTop = "12px";
    shortcuts.style.flexWrap = "wrap";
    const updateInputValue = (val) => {
      targetCount = Math.max(0, val);
      if (this.inputComponent) {
        this.inputComponent.setValue(String(targetCount));
      }
    };
    const btnPlus1 = shortcuts.createEl("button", { text: "+1 \u8BDD" });
    btnPlus1.onclick = () => updateInputValue(targetCount + 1);
    const btnPlus2 = shortcuts.createEl("button", { text: "+2 \u8BDD" });
    btnPlus2.onclick = () => updateInputValue(targetCount + 2);
    if (total > 0) {
      const btnAll = shortcuts.createEl("button", { text: `\u5168\u770B\u5B8C (${total}\u8BDD)` });
      btnAll.onclick = () => updateInputValue(total);
    }
    const btnZero = shortcuts.createEl("button", { text: "\u91CD\u7F6E\u4E3A 0" });
    btnZero.onclick = () => updateInputValue(0);
    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "24px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = footer.createEl("button", {
      text: "\u4FDD\u5B58\u8FDB\u5EA6",
      cls: "mod-cta"
    });
    saveBtn.onclick = async () => {
      const count = Math.max(0, parseInt(targetCount, 10) || 0);
      const updates = { watchedEpisodes: count };
      let noticeMsg = `\u300A${this.item.name}\u300B\u5DF2\u770B\u96C6\u6570\u5DF2\u66F4\u65B0\u4E3A\uFF1A${count} \u8BDD`;
      await this.plugin.quickUpdateAnimeNote(this.item, updates);
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave(count);
      }
      new Notice2(noticeMsg);
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QuickAddTagModal = class extends Modal {
  constructor(app, plugin, item, onSave) {
    super(app);
    this.plugin = plugin;
    this.item = item;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bangumi-quick-add-tag-modal");
    contentEl.createEl("h2", { text: "\u6DFB\u52A0\u6807\u7B7E" });
    contentEl.createDiv({
      cls: "bangumi-modal-subtitle",
      text: `\u300A${this.item.name}\u300B`
    });
    let newTag = "";
    new Setting(contentEl).setName("\u65B0\u6807\u7B7E\u540D\u79F0").setDesc("\u8F93\u5165\u8981\u6DFB\u52A0\u7684\u6807\u7B7E\uFF08\u652F\u6301\u4EE5\u7A7A\u683C\u6216\u9017\u53F7\u6DFB\u52A0\u591A\u4E2A\uFF0C\u5982\uFF1A\u767E\u5408 \u539F\u521B\uFF09").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A\u767E\u5408\u3001\u840C\u7CFB\u3001\u786C\u6838\u63A8\u7406...");
      text.onChange((val) => {
        newTag = val;
      });
      text.inputEl.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await doSave();
        }
      });
      setTimeout(() => text.inputEl.focus(), 50);
    });
    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = footer.createEl("button", {
      text: "\u6DFB\u52A0\u6807\u7B7E",
      cls: "mod-cta"
    });
    const doSave = async () => {
      const clean = String(newTag || "").trim();
      if (!clean) {
        new Notice2("\u8BF7\u8F93\u5165\u6807\u7B7E\u540D\u79F0\uFF01");
        return;
      }
      const tags = clean.split(/[,;\s#]+/).filter(Boolean);
      for (const t of tags) {
        await this.plugin.quickUpdateAnimeNote(this.item, { addTag: t });
      }
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave(tags);
      }
      new Notice2(`\u5DF2\u4E3A\u300A${this.item.name}\u300B\u6DFB\u52A0\u6807\u7B7E\uFF1A#${tags.join(" #")}`);
    };
    saveBtn.onclick = async () => {
      await doSave();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var BatchTagManagerModal = class extends Modal {
  constructor(app, plugin, items) {
    super(app);
    this.plugin = plugin;
    this.allItems = items || [];
    this.selected = /* @__PURE__ */ new Set();
    this.actionType = "add";
    this.searchQuery = "";
    this.statusFilter = "all";
    this.tagFilter = "all";
    this.targetTag = "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.style.width = "min(820px, 92vw)";
    this.modalEl.style.maxWidth = "92vw";
    this.modalEl.style.maxHeight = "90vh";
    this.modalEl.style.overflowY = "auto";
    contentEl.createEl("h2", { text: "\u6279\u91CF\u7BA1\u7406\u5DF2\u6709\u7B14\u8BB0\u4E2D\u7684\u6807\u7B7E" });
    contentEl.createEl("p", {
      cls: "bangumi-modal-desc",
      text: "\u6279\u91CF\u4E3A\u9009\u4E2D\u7684\u52A8\u753B\u7B14\u8BB0\u6DFB\u52A0\u65B0\u6807\u7B7E\uFF0C\u6216\u4ECE\u7B14\u8BB0\u4E2D\u6279\u91CF\u79FB\u9664\u5DF2\u6709\u6807\u7B7E\u3002\u6839\u6807\u7B7E #bangumi \u53D7\u5230\u4E25\u683C\u4FDD\u62A4\uFF0C\u7EDD\u4E0D\u4F1A\u88AB\u610F\u5916\u79FB\u9664\u3002"
    });
    new Setting(contentEl).setName("\u64CD\u4F5C\u7C7B\u578B").setDesc("\u9009\u62E9\u662F\u4E3A\u9009\u4E2D\u7684\u52A8\u753B\u7B14\u8BB0\u6279\u91CF\u6DFB\u52A0\u6807\u7B7E\uFF0C\u8FD8\u662F\u6279\u91CF\u79FB\u9664\u5DF2\u6709\u6807\u7B7E").addDropdown((dropdown) => {
      dropdown.addOption("add", "\u6279\u91CF\u6DFB\u52A0\u6807\u7B7E");
      dropdown.addOption("remove", "\u6279\u91CF\u79FB\u9664\u5DF2\u6709\u6807\u7B7E");
      dropdown.setValue(this.actionType);
      dropdown.onChange((val) => {
        this.actionType = val;
        updateActionDesc();
        updateSubmitBtn();
      });
    });
    const tagSetting = new Setting(contentEl).setName("\u76EE\u6807\u6807\u7B7E").setDesc("\u8F93\u5165\u8981\u6279\u91CF\u6DFB\u52A0\u7684\u6807\u7B7E\uFF08\u652F\u6301\u4EE5\u7A7A\u683C\u6216\u9017\u53F7\u8F93\u5165\u591A\u4E2A\uFF0C\u5982\uFF1A\u70ED\u8840 \u5947\u5E7B\uFF09").addText((text) => {
      text.setPlaceholder("\u5982\uFF1A\u70ED\u8840\u3001\u5947\u5E7B\u3001\u51B7\u95E8\u4F73\u4F5C...");
      text.setValue(this.targetTag);
      text.onChange((val) => {
        this.targetTag = val;
      });
    });
    const updateActionDesc = () => {
      if (this.actionType === "add") {
        tagSetting.setDesc("\u8F93\u5165\u8981\u6279\u91CF\u6DFB\u52A0\u7684\u6807\u7B7E\uFF08\u652F\u6301\u4EE5\u7A7A\u683C\u6216\u9017\u53F7\u8F93\u5165\u591A\u4E2A\uFF0C\u5982\uFF1A\u70ED\u8840 \u5947\u5E7B\uFF09");
      } else {
        tagSetting.setDesc("\u8F93\u5165\u8981\u6279\u91CF\u79FB\u9664\u7684\u6807\u7B7E\uFF08\u5982\uFF1A\u5395\u7EB8\u3002\u4FDD\u62A4\u6839\u6807\u7B7E bangumi\uFF09");
      }
    };
    const filterSection = contentEl.createDiv({ cls: "bangumi-batch-filter-bar" });
    filterSection.style.display = "flex";
    filterSection.style.flexWrap = "wrap";
    filterSection.style.gap = "10px";
    filterSection.style.alignItems = "center";
    filterSection.style.margin = "12px 0";
    filterSection.style.padding = "8px 12px";
    filterSection.style.backgroundColor = "var(--background-secondary)";
    filterSection.style.borderRadius = "6px";
    const searchInput = filterSection.createEl("input", {
      type: "text",
      placeholder: "\u641C\u7D22\u52A8\u753B\u540D\u79F0..."
    });
    searchInput.style.flex = "1";
    searchInput.style.minWidth = "160px";
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      renderList();
    };
    const statusSelect = filterSection.createEl("select");
    statusSelect.createEl("option", { text: "\u5168\u90E8\u72B6\u6001", value: "all" });
    for (const st of ["\u5728\u770B", "\u60F3\u770B", "\u5DF2\u770B", "\u629B\u5F03", "\u672A\u8BBE\u7F6E"]) {
      statusSelect.createEl("option", { text: st, value: st });
    }
    statusSelect.onchange = (e) => {
      this.statusFilter = e.target.value;
      renderList();
    };
    const tagSelect = filterSection.createEl("select");
    tagSelect.createEl("option", { text: "\u5168\u90E8\u73B0\u6709\u6807\u7B7E", value: "all" });
    const allTags = /* @__PURE__ */ new Set();
    for (const it of this.allItems) {
      const tokens = String(it.tags || "").split(/[,;\s#\[\]"']+/).filter(Boolean);
      for (const t of tokens) allTags.add(t);
    }
    for (const t of Array.from(allTags).sort()) {
      tagSelect.createEl("option", { text: `#${t}`, value: t });
    }
    tagSelect.onchange = (e) => {
      this.tagFilter = e.target.value;
      renderList();
    };
    const controlBar = contentEl.createDiv();
    controlBar.style.display = "flex";
    controlBar.style.justifyContent = "space-between";
    controlBar.style.alignItems = "center";
    controlBar.style.margin = "8px 0";
    const btnGroup = controlBar.createDiv();
    const btnSelectAll = btnGroup.createEl("button", { text: "\u5168\u9009\u5F53\u524D\u7B5B\u9009\u7ED3\u679C" });
    btnSelectAll.style.marginRight = "8px";
    const btnDeselectAll = btnGroup.createEl("button", { text: "\u53D6\u6D88\u9009\u62E9" });
    const countInfo = controlBar.createSpan({ cls: "bangumi-batch-counter" });
    countInfo.style.color = "var(--text-muted)";
    countInfo.style.fontSize = "13px";
    const listEl = contentEl.createDiv("bangumi-batch-note-list");
    listEl.style.maxHeight = "360px";
    listEl.style.overflowY = "auto";
    listEl.style.border = "1px solid var(--background-modifier-border)";
    listEl.style.borderRadius = "6px";
    listEl.style.padding = "6px";
    listEl.style.margin = "8px 0 16px 0";
    const getFiltered = () => {
      return this.allItems.filter((it) => {
        if (this.searchQuery) {
          const matchName = String(it.name || "").toLowerCase().includes(this.searchQuery);
          const matchJap = String(it.japaneseName || "").toLowerCase().includes(this.searchQuery);
          if (!matchName && !matchJap) return false;
        }
        if (this.statusFilter !== "all" && it.state !== this.statusFilter) {
          return false;
        }
        if (this.tagFilter !== "all") {
          const tokens = String(it.tags || "").split(/[,;\s#\[\]"']+/).filter(Boolean);
          if (!tokens.includes(this.tagFilter)) return false;
        }
        return true;
      });
    };
    const updateCounts = () => {
      const filtered = getFiltered();
      countInfo.textContent = `\u5DF2\u9009 ${this.selected.size} / \u7B5B\u9009\u51FA ${filtered.length} \u90E8\uFF08\u5171 ${this.allItems.length} \u90E8\uFF09`;
      updateSubmitBtn();
    };
    btnSelectAll.onclick = () => {
      const filtered = getFiltered();
      for (const it of filtered) {
        this.selected.add(it.file.path);
      }
      renderList();
    };
    btnDeselectAll.onclick = () => {
      this.selected.clear();
      renderList();
    };
    const renderList = () => {
      listEl.empty();
      const filtered = getFiltered();
      if (filtered.length === 0) {
        const empty = listEl.createDiv({ text: "\u672A\u627E\u5230\u5339\u914D\u7684\u52A8\u753B\u7B14\u8BB0" });
        empty.style.padding = "20px";
        empty.style.textAlign = "center";
        empty.style.color = "var(--text-muted)";
        updateCounts();
        return;
      }
      for (const it of filtered) {
        const row = listEl.createDiv({ cls: "bangumi-batch-row" });
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.padding = "6px 10px";
        row.style.borderBottom = "1px solid var(--background-modifier-border-focus)";
        row.style.gap = "10px";
        row.style.cursor = "pointer";
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = this.selected.has(it.file.path);
        cb.onchange = (e) => {
          e.stopPropagation();
          if (cb.checked) {
            this.selected.add(it.file.path);
          } else {
            this.selected.delete(it.file.path);
          }
          updateCounts();
        };
        row.onclick = () => {
          cb.checked = !cb.checked;
          if (cb.checked) {
            this.selected.add(it.file.path);
          } else {
            this.selected.delete(it.file.path);
          }
          updateCounts();
        };
        const titleEl = row.createDiv();
        titleEl.style.flex = "1";
        titleEl.style.fontWeight = "500";
        titleEl.textContent = it.name;
        const stateClass = this.plugin && typeof this.plugin.getWatchStateClass === "function" ? this.plugin.getWatchStateClass(it.state) : it.state || "\u672A\u8BBE\u7F6E";
        const stateBadge = row.createSpan({
          cls: `bangumi-grid-state-badge is-${stateClass}`,
          text: it.state || "\u672A\u8BBE\u7F6E"
        });
        stateBadge.style.fontSize = "11px";
        stateBadge.style.padding = "2px 6px";
        const tagsContainer = row.createDiv();
        tagsContainer.style.display = "flex";
        tagsContainer.style.gap = "4px";
        tagsContainer.style.flexWrap = "wrap";
        const tokens = String(it.tags || "").split(/[,;\s#\[\]"']+/).filter(Boolean);
        for (const t of tokens) {
          const tChip = tagsContainer.createSpan({ text: `#${t}` });
          tChip.style.fontSize = "11px";
          tChip.style.padding = "1px 5px";
          tChip.style.borderRadius = "3px";
          tChip.style.backgroundColor = "var(--background-modifier-form-field)";
          tChip.style.color = t === "bangumi" ? "var(--text-muted)" : "var(--text-accent)";
        }
      }
      updateCounts();
    };
    const footer = contentEl.createDiv();
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.marginTop = "12px";
    const cancelBtn = footer.createEl("button", { text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const submitBtn = footer.createEl("button", { cls: "mod-cta" });
    const updateSubmitBtn = () => {
      const count = this.selected.size;
      if (this.actionType === "add") {
        submitBtn.textContent = `\u6279\u91CF\u6DFB\u52A0\u6807\u7B7E\uFF08\u5DF2\u9009 ${count} \u90E8\uFF09`;
      } else {
        submitBtn.textContent = `\u6279\u91CF\u79FB\u9664\u6807\u7B7E\uFF08\u5DF2\u9009 ${count} \u90E8\uFF09`;
      }
    };
    submitBtn.onclick = async () => {
      const cleanTarget = String(this.targetTag || "").trim();
      if (!cleanTarget) {
        new Notice2("\u8BF7\u8F93\u5165\u8981\u64CD\u4F5C\u7684\u6807\u7B7E\u540D\u79F0\uFF01");
        return;
      }
      if (this.selected.size === 0) {
        new Notice2("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u90E8\u52A8\u753B\u7B14\u8BB0\uFF01");
        return;
      }
      const tags = cleanTarget.split(/[,;\s#]+/).filter(Boolean);
      if (this.actionType === "remove") {
        const hasBangumi = tags.some((t) => t.toLowerCase() === "bangumi");
        if (hasBangumi) {
          new Notice2("\u6839\u6807\u7B7E #bangumi \u53D7\u5230\u7CFB\u7EDF\u4FDD\u62A4\uFF0C\u4E0D\u53EF\u79FB\u9664\uFF01");
          return;
        }
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "\u6B63\u5728\u5904\u7406\u4E2D...";
      try {
        let successCount = 0;
        for (const filePath of this.selected) {
          const item = this.allItems.find((it) => it.file.path === filePath);
          if (!item || !item.file) continue;
          for (const t of tags) {
            if (this.actionType === "add") {
              await this.plugin.quickUpdateAnimeNote(item, { addTag: t });
            } else {
              await this.plugin.quickUpdateAnimeNote(item, { removeTag: t });
            }
          }
          successCount += 1;
        }
        this.close();
        const actionWord = this.actionType === "add" ? "\u6DFB\u52A0" : "\u79FB\u9664";
        new Notice2(`\u5DF2\u6210\u529F\u4E3A ${successCount} \u90E8\u52A8\u753B\u7B14\u8BB0${actionWord}\u6807\u7B7E\uFF1A#${tags.join(" #")}`);
        await this.plugin.refreshOpenDashboardViews();
      } catch (err) {
        console.error("[Bangumi Manager] \u6279\u91CF\u7BA1\u7406\u6807\u7B7E\u5931\u8D25:", err);
        new Notice2(`\u6279\u91CF\u5904\u7406\u5931\u8D25: ${err.message}`);
      }
    };
    renderList();
    updateSubmitBtn();
  }
  onClose() {
    this.contentEl.empty();
  }
};
module.exports = BangumiManagerPlugin;
