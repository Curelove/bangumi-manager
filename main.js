var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// bangumi-api.js
var require_bangumi_api = __commonJS({
  "bangumi-api.js"(exports2, module2) {
    var HEADERS = {
      "Content-Type": "text/html; charset=utf-8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/html;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
    async function requestHtml(url) {
      const html = await request({
        url,
        method: "GET",
        cache: "no-cache",
        headers: HEADERS
      });
      return html || "";
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
    module2.exports = {
      requestHtml,
      parseHtml,
      searchBangumi,
      getAnimeDetail,
      getSubjectId,
      getNetabaUrl,
      cleanText,
      cleanFileName
    };
  }
});

// note-manager.js
var require_note_manager = __commonJS({
  "note-manager.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
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
    function buildNoteContent(info, options) {
      const watchedEpisodes = options.watchedEpisodes || "0";
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
      addYamlField(
        yaml,
        "BGM\u8BC4\u5206",
        info.rating
      );
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
      yaml.push(
        "**\u89C2\u770B\u7F51\u5740**\uFF1A " + watchUrl
      );
      yaml.push("");
      yaml.push("# \u52A8\u753B\u4FE1\u606F");
      yaml.push(
        "> [!bookinfo|noicon]+ **" + (info.CN || "\u672A\u77E5\u4F5C\u54C1") + "**"
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
      yaml.push(
        "| BGM \u8BC4\u5206 | " + (info.rating || "\u672A\u77E5") + " |"
      );
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
      if (info.netaba) {
        yaml.push(
          "<!-- Netaba\u8BC4\u5206\u8D8B\u52BF\u56FE -->"
        );
        yaml.push(
          '<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">'
        );
        yaml.push(
          '<iframe src="' + info.netaba + '" style="width:100%;height:600px;border:0;"></iframe>'
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

// import-manager.js
var require_import_manager = __commonJS({
  "import-manager.js"(exports2, module2) {
    var Modal2 = globalThis.__BangumiManagerModal;
    var Notice2 = globalThis.__BangumiManagerNotice;
    if (!Modal2 || !Notice2) {
      throw new Error(
        "\u4E3B\u63D2\u4EF6\u6CA1\u6709\u4F20\u5165 Modal \u6216 Notice\u3002"
      );
    }
    var fs2 = require("fs");
    var path2 = require("path");
    var bangumiApi = require_bangumi_api();
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
            new Notice2(
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
            this.results = await bangumiApi.searchBangumi(
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
          const info = await bangumiApi.getAnimeDetail(
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
            new Notice2(
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
            downloadPath
          }
        );
        if (!result.created) {
          new Notice2(
            "\u540C\u540D\u52A8\u753B\u7B14\u8BB0\u5DF2\u7ECF\u5B58\u5728\uFF0C\u672A\u8986\u76D6\u539F\u7B14\u8BB0\u3002",
            7e3
          );
          this.close();
          return;
        }
        new Notice2(
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
      const folderPath = path2.join(
        root,
        info.year,
        info.season,
        folderName
      );
      try {
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

// batch-import-manager.js
var require_batch_import_manager = __commonJS({
  "batch-import-manager.js"(exports2, module2) {
    var Modal2 = globalThis.__BangumiManagerModal;
    var Notice2 = globalThis.__BangumiManagerNotice;
    if (!Modal2 || !Notice2) {
      throw new Error(
        "\u4E3B\u63D2\u4EF6\u6CA1\u6709\u4F20\u5165 Modal \u6216 Notice\u3002"
      );
    }
    var path2 = require("path");
    var bangumiApi = require_bangumi_api();
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
            text: "\u4ECE Bangumi \u7528\u6237\u5217\u8868\u8BFB\u53D6\u52A8\u753B\uFF0C\u81EA\u52A8\u521B\u5EFA\u7B14\u8BB0\u3002\u5DF2\u6709\u7B14\u8BB0\u53EF\u9009\u62E9\u8DF3\u8FC7\u3002"
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
          this.plugin.settings.bangumiUserId || ""
        );
        userInput.placeholder = "\u4F8B\u5982\uFF1A890645";
        userInput.style.width = "100%";
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
          " \u8DF3\u8FC7\u5DF2\u7ECF\u5B58\u5728\u7684\u52A8\u753B\u7B14\u8BB0"
        );
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
            new Notice2(
              "\u8BF7\u5148\u586B\u5199 Bangumi \u7528\u6237 ID\u3002",
              6e3
            );
            return;
          }
          if (!/^\d+$/.test(userId)) {
            new Notice2(
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
          }
        };
        stopButton.onclick = () => {
          this.stopRequested = true;
          progress.textContent += "\n\u5DF2\u8BF7\u6C42\u505C\u6B62\uFF0C\u5F53\u524D\u52A8\u753B\u5904\u7406\u5B8C\u6210\u540E\u505C\u6B62\u3002";
          stopButton.disabled = true;
        };
      }
      async runImport(userId, listKey, targetState, createFolder, skipExisting, progress) {
        const listConfig = LIST_TYPES[listKey];
        const status = {
          isRunning: true,
          userId,
          listName: listConfig.name,
          totalPages: 0,
          totalItems: 0,
          processedItems: 0,
          createdNotes: 0,
          skippedNotes: 0,
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
          const items = await this.fetchAllCollectionPages(
            userId,
            listConfig.path,
            status,
            progress
          );
          if (!items.length) {
            this.writeProgress(
              progress,
              "\u6CA1\u6709\u627E\u5230\u53EF\u5BFC\u5165\u7684\u52A8\u753B\u3002"
            );
            return;
          }
          status.totalItems = items.length;
          this.writeProgress(
            progress,
            "\u5171\u627E\u5230 " + items.length + " \u90E8\u52A8\u753B\uFF0C\u5F00\u59CB\u5BFC\u5165\u2026\u2026"
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
                status
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
          await this.updateStatusFile(
            status
          );
          this.writeProgress(
            progress,
            this.createSummary(
              status
            )
          );
          new Notice2(
            this.createSummary(status),
            1e4
          );
        } catch (error) {
          status.isRunning = false;
          status.failedItems += 1;
          this.addLog(
            status,
            "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" + error.message
          );
          await this.updateStatusFile(
            status
          );
          this.writeProgress(
            progress,
            "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" + error.message
          );
          new Notice2(
            "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" + error.message,
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
          const html = await bangumiApi.requestHtml(
            url
          );
          const doc = bangumiApi.parseHtml(
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
          result.push({
            title_cn: bangumiApi.cleanFileName(
              titleLink.textContent
            ),
            title_jp: bangumiApi.cleanFileName(
              jpElement ? jpElement.textContent : ""
            ),
            link: href.startsWith("http") ? href : "https://bgm.tv" + href,
            cover: cover ? normalizeImageUrl(
              cover.getAttribute(
                "src"
              )
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
      async importOne(item, targetState, createFolder, skipExisting, status) {
        const info = await bangumiApi.getAnimeDetail(
          item.link
        );
        if (!info) {
          throw new Error(
            "\u65E0\u6CD5\u8BFB\u53D6\u52A8\u753B\u8BE6\u60C5"
          );
        }
        const seasonInfo = noteManager.getSeasonInfo(
          info.date
        );
        info.state = targetState;
        info.recordDate = getTodayString();
        info.year = seasonInfo.year;
        info.season = seasonInfo.season;
        info.url = item.link;
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
            downloadPath
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
        const folderPath = path2.join(
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
        content += "\u72B6\u6001\uFF1A" + (status.isRunning ? "\u8FDB\u884C\u4E2D" : "\u5DF2\u5B8C\u6210") + "\n\n";
        content += "\u8FDB\u5EA6\uFF1A" + status.processedItems + "/" + status.totalItems + "\uFF08" + percent + "%\uFF09\n\n";
        content += "- \u9875\u9762\u6570\uFF1A" + status.totalPages + "\n";
        content += "- \u6210\u529F\u521B\u5EFA\uFF1A" + status.createdNotes + "\n";
        content += "- \u8DF3\u8FC7\u5DF2\u6709\uFF1A" + status.skippedNotes + "\n";
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
        return "\u6279\u91CF\u5BFC\u5165\u5B8C\u6210\uFF1A\u6210\u529F " + status.createdNotes + " \u90E8\uFF0C\u8DF3\u8FC7 " + status.skippedNotes + " \u90E8\uFF0C\u5931\u8D25 " + status.failedItems + " \u90E8\u3002\u8017\u65F6 " + minutes + " \u5206 " + seconds + " \u79D2\u3002";
      }
      onClose() {
        if (this.running) {
          this.stopRequested = true;
        }
        this.contentEl.empty();
      }
    };
    function normalizeImageUrl(url) {
      const value = String(url || "").trim();
      if (value.startsWith("//")) {
        return "https:" + value;
      }
      if (value.startsWith("http")) {
        return value;
      }
      return value ? "https://bgm.tv" + value : "";
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

// main.js
var {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal
} = require("obsidian");
var fs = require("fs");
var path = require("path");
globalThis.__BangumiManagerModal = Modal;
globalThis.__BangumiManagerNotice = Notice;
var {
  openSingleAnimeImport
} = require_import_manager();
var {
  openBatchAnimeImport
} = require_batch_import_manager();
var DEFAULT_SETTINGS = {
  mode: "lazy",
  noteRootFolder: "\u9986\u85CF/\u8FFD\u756A\u5E7F\u573A/\u756A\u5267\u6570\u636E\u5361\u7247",
  coverFolder: "\u9644\u4EF6/Bangumi Images",
  listFilePath: "\u9986\u85CF/\u8FFD\u756A\u5E7F\u573A/\u8FFD\u756A\u5217\u8868\uFF08\u672C\u5730\uFF09",
  baseFilePath: "\u9986\u85CF/\u8FFD\u756A\u5E7F\u573A/\u52A8\u753B\u5E93.base",
  localAnimeRoot: "D:/ACG/Obsidian ACG",
  checkIntervalSeconds: 60,
  checkOnStartup: true,
  checkOnSave: true,
  seasonViewMode: "none",
  showManagerRibbon: false
};
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
var WATCH_STATES = [
  "\u5DF2\u770B",
  "\u5728\u770B",
  "\u60F3\u770B",
  "\u629B\u5F03"
];
var BangumiManagerPlugin = class extends Plugin {
  async onload() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
    this.addSettingTab(
      new BangumiManagerSettingTab(
        this.app,
        this
      )
    );
    this.addCommand({
      id: "initialize-missing-files",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6",
      callback: async () => {
        await this.initializeMissingFiles();
      }
    });
    this.addCommand({
      id: "check-all-local-status",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001",
      callback: async () => {
        await this.checkAllLocalStatus(true);
      }
    });
    this.addCommand({
      id: "generate-season-views",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u8865\u9F50\u5B63\u5EA6\u89C6\u56FE",
      callback: async () => {
        await this.generateSeasonViews(true);
      }
    });
    this.addCommand({
      id: "import-single-anime",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
      callback: async () => {
        await openSingleAnimeImport(
          this.app,
          this
        );
      }
    });
    this.addCommand({
      id: "import-batch-anime",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
      callback: async () => {
        await openBatchAnimeImport(
          this.app,
          this
        );
      }
    });
    this.addCommand({
      id: "select-season-views-to-remove",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u6E05\u7406",
      callback: async () => {
        await this.openSeasonViewCleanup();
      }
    });
    this.addCommand({
      id: "clean-completed-season-views",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE",
      callback: async () => {
        await this.cleanCompletedSeasonViews(true);
      }
    });
    this.addCommand({
      id: "batch-change-watch-status",
      name: "Bangumi\u7BA1\u7406\u5668\uFF1A\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
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
    if (this.settings.checkOnStartup) {
      setTimeout(
        async () => {
          await this.checkAllLocalStatus(false);
        },
        5e3
      );
    }
    this.refreshManagerRibbon();
    this.startStatusTimer();
  }
  onunload() {
    this.stopStatusTimer();
    clearTimeout(this.saveCheckTimer);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.startStatusTimer();
  }
  startStatusTimer() {
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
    await this.createListFileIfMissing();
    await this.createBaseFileIfMissing();
    new Notice(
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
  async createListFileIfMissing() {
    const filePath = this.settings.listFilePath.endsWith(
      ".md"
    ) ? this.settings.listFilePath : this.settings.listFilePath + ".md";
    if (this.app.vault.getAbstractFileByPath(
      filePath
    )) {
      return;
    }
    const folderPath = filePath.substring(
      0,
      filePath.lastIndexOf("/")
    );
    await this.ensureVaultFolder(folderPath);
    const content = `# \u8FFD\u756A\u5217\u8868 - \u5728\u770B

\u6B64\u9875\u9762\u7531 Bangumi \u8FFD\u756A\u7BA1\u7406\u5668\u521B\u5EFA\u3002

\u63D2\u4EF6\u4F1A\u5728\u540E\u53F0\u81EA\u52A8\u68C0\u67E5\u672C\u5730\u89C6\u9891\u6570\u91CF\u3002
\u9700\u8981\u7ACB\u5373\u66F4\u65B0\u65F6\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u70B9\u51FB\u201C\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001\u201D\u3002

\`\`\`dataview
TABLE
  \u4E2D\u6587\u540D AS "\u4E2D\u6587\u540D",
  \u5F00\u64AD\u5B63\u5EA6 AS "\u5F00\u64AD\u5B63\u5EA6",
  \u672C\u5730\u66F4\u65B0\u72B6\u6001 AS "\u672C\u5730\u66F4\u65B0\u72B6\u6001"
FROM "${this.settings.noteRootFolder}"
WHERE tags = "bangumi" AND \u89C2\u770B\u72B6\u6001 = "\u5728\u770B"
SORT \u5F00\u64AD\u5E74\u4EFD DESC, \u5F00\u64AD\u5B63\u5EA6 DESC, \u4E2D\u6587\u540D ASC
\`\`\`
`;
    await this.app.vault.create(
      filePath,
      content
    );
  }
  async createBaseFileIfMissing() {
    const filePath = this.settings.baseFilePath;
    if (this.app.vault.getAbstractFileByPath(
      filePath
    )) {
      return;
    }
    const folderPath = filePath.substring(
      0,
      filePath.lastIndexOf("/")
    );
    await this.ensureVaultFolder(folderPath);
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
    await this.app.vault.create(
      filePath,
      content
    );
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
      new Notice(
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
  async openBatchStatusManager() {
    const items = await this.collectAnimeItems();
    if (items.length === 0) {
      new Notice(
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
      new Notice(
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
        new Notice(
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
        new Notice(
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
          new Notice(
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
var BangumiManagerSettingTab = class extends PluginSettingTab {
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
  displayLazyMode(container) {
    container.createEl(
      "p",
      {
        text: "\u5B89\u88C5\u540E\u5148\u70B9\u51FB\u201C\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6\u201D\u3002\u4E4B\u540E\u63D2\u4EF6\u4F1A\u81EA\u52A8\u68C0\u67E5\u672C\u5730\u89C6\u9891\uFF1B\u9700\u8981\u65F6\u53EF\u5728\u8FD9\u91CC\u624B\u52A8\u5237\u65B0\u3002"
      }
    );
    new Setting(container).setName("\u4F7F\u7528\u6A21\u5F0F").setDesc(
      "\u61D2\u4EBA\u6A21\u5F0F\u9690\u85CF\u4E0D\u5E38\u7528\u7684\u9AD8\u7EA7\u8DEF\u5F84\u8BBE\u7F6E\u3002"
    ).addDropdown((dropdown) => {
      dropdown.addOptions({
        lazy: "\u61D2\u4EBA\u6A21\u5F0F",
        professional: "\u4E13\u4E1A\u6A21\u5F0F"
      });
      dropdown.setValue("lazy");
      dropdown.onChange(async (value) => {
        this.plugin.settings.mode = value;
        await this.plugin.saveSettings();
        this.display();
      });
    });
    this.addPathSetting(
      container,
      "\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55",
      "noteRootFolder",
      "\u52A8\u753B\u7B14\u8BB0\u4FDD\u5B58\u4F4D\u7F6E\u3002\u4FEE\u6539\u540E\u8BF7\u70B9\u51FB\u201C\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6\u201D\u3002"
    );
    new Setting(container).setName("\u672C\u5730\u52A8\u753B\u6839\u76EE\u5F55").setDesc(
      "\u7528\u4E8E\u65B0\u529F\u80FD\u9ED8\u8BA4\u8DEF\u5F84\u63D0\u793A\uFF0C\u4E0D\u4F1A\u79FB\u52A8\u5DF2\u6709\u89C6\u9891\u3002"
    ).addText((text) => {
      text.setValue(
        this.plugin.settings.localAnimeRoot
      );
      text.onChange(async (value) => {
        this.plugin.settings.localAnimeRoot = value.trim();
        await this.plugin.saveSettings();
      });
    });
    this.addCheckSettings(container);
    this.addSeasonSettings(container);
    container.createEl(
      "h3",
      {
        text: "\u5FEB\u901F\u64CD\u4F5C"
      }
    );
    new Setting(container).setName("\u663E\u793A\u5DE6\u4FA7\u7BA1\u7406\u6309\u94AE").setDesc(
      this.plugin.settings.mode === "lazy" ? "\u6253\u5F00\u540E\uFF0CObsidian \u5DE6\u4FA7\u4F1A\u663E\u793A\u4E00\u4E2A Bangumi \u7BA1\u7406\u6309\u94AE\uFF0C\u53EF\u4ECE\u8BE5\u6309\u94AE\u4E2D\u9009\u62E9\u76F8\u5173\u547D\u4EE4\u6267\u884C\u3002" : "\u6253\u5F00\u540E\uFF0C\u5728 Obsidian \u5DE6\u4FA7\u663E\u793A\u7EDF\u4E00\u7BA1\u7406\u5165\u53E3\uFF0C\u4E0D\u4E3A\u6BCF\u4E2A\u529F\u80FD\u5355\u72EC\u589E\u52A0\u56FE\u6807\u3002"
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
    container.createEl(
      "p",
      {
        text: "\u4E13\u4E1A\u6A21\u5F0F\u5141\u8BB8\u8C03\u6574\u4ED3\u5E93\u8DEF\u5F84\u3001\u68C0\u67E5\u7B56\u7565\u548C\u5B63\u5EA6\u89C6\u56FE\u884C\u4E3A\u3002\u4FEE\u6539\u8DEF\u5F84\u540E\u8BF7\u70B9\u51FB\u201C\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6\u201D\u3002"
      }
    );
    new Setting(container).setName("\u4F7F\u7528\u6A21\u5F0F").setDesc(
      "\u5207\u6362\u6A21\u5F0F\u4E0D\u4F1A\u5220\u9664\u6587\u4EF6\u3001\u7B14\u8BB0\u6216\u52A8\u753B\u5E93\u89C6\u56FE\u3002"
    ).addDropdown((dropdown) => {
      dropdown.addOptions({
        lazy: "\u61D2\u4EBA\u6A21\u5F0F",
        professional: "\u4E13\u4E1A\u6A21\u5F0F"
      });
      dropdown.setValue("professional");
      dropdown.onChange(async (value) => {
        this.plugin.settings.mode = value;
        await this.plugin.saveSettings();
        this.display();
      });
    });
    this.addPathSetting(
      container,
      "\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55",
      "noteRootFolder",
      "\u626B\u63CF\u548C\u7BA1\u7406 Bangumi \u52A8\u753B\u7B14\u8BB0\u7684\u4ED3\u5E93\u76EE\u5F55\u3002"
    );
    this.addPathSetting(
      container,
      "\u5C01\u9762\u76EE\u5F55",
      "coverFolder",
      "\u672C\u5730\u5C01\u9762\u4FDD\u5B58\u76EE\u5F55\u3002"
    );
    this.addPathSetting(
      container,
      "\u8FFD\u756A\u5217\u8868\u6587\u4EF6",
      "listFilePath",
      "\u8FFD\u756A\u5217\u8868 Markdown \u6587\u4EF6\u8DEF\u5F84\u3002"
    );
    this.addPathSetting(
      container,
      "\u52A8\u753B\u5E93\u6587\u4EF6",
      "baseFilePath",
      "\u52A8\u753B\u5E93 Base \u6587\u4EF6\u8DEF\u5F84\u3002"
    );
    new Setting(container).setName("\u672C\u5730\u52A8\u753B\u6839\u76EE\u5F55").setDesc(
      "\u7528\u4E8E\u9ED8\u8BA4\u8DEF\u5F84\u63D0\u793A\uFF0C\u4E0D\u4F1A\u79FB\u52A8\u5DF2\u6709\u89C6\u9891\u3002"
    ).addText((text) => {
      text.setValue(
        this.plugin.settings.localAnimeRoot
      );
      text.onChange(async (value) => {
        this.plugin.settings.localAnimeRoot = value.trim();
        await this.plugin.saveSettings();
      });
    });
    this.addCheckSettings(container);
    this.addSeasonSettings(container);
    new Setting(container).setName("\u663E\u793A\u5DE6\u4FA7\u7BA1\u7406\u6309\u94AE").setDesc(
      this.plugin.settings.mode === "lazy" ? "\u6253\u5F00\u540E\uFF0CObsidian \u5DE6\u4FA7\u4F1A\u663E\u793A\u4E00\u4E2A Bangumi \u7BA1\u7406\u6309\u94AE\uFF0C\u53EF\u4ECE\u8BE5\u6309\u94AE\u4E2D\u9009\u62E9\u76F8\u5173\u547D\u4EE4\u6267\u884C\u3002" : "\u6253\u5F00\u540E\uFF0C\u5728 Obsidian \u5DE6\u4FA7\u663E\u793A\u7EDF\u4E00\u7BA1\u7406\u5165\u53E3\uFF0C\u4E0D\u4E3A\u6BCF\u4E2A\u529F\u80FD\u5355\u72EC\u589E\u52A0\u56FE\u6807\u3002"
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
    container.createEl(
      "h3",
      {
        text: "\u5FEB\u901F\u64CD\u4F5C"
      }
    );
    this.addProfessionalActions(container);
  }
  addCheckSettings(container) {
    new Setting(container).setName("\u540E\u53F0\u68C0\u67E5\u95F4\u9694").setDesc(
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
    new Setting(container).setName("\u542F\u52A8\u65F6\u81EA\u52A8\u68C0\u67E5").setDesc(
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
    new Setting(container).setName("\u4FDD\u5B58\u7B14\u8BB0\u65F6\u81EA\u52A8\u68C0\u67E5").setDesc(
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
    new Setting(container).setName("\u5B63\u5EA6\u89C6\u56FE\u7B56\u7565").setDesc(
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
  addLazyActions(container) {
    this.addAction(
      container,
      "\u5BFC\u5165\u5355\u4E2A\u52A8\u753B",
      "\u641C\u7D22 Bangumi\uFF0C\u9009\u62E9\u52A8\u753B\u540E\u81EA\u52A8\u521B\u5EFA\u7B14\u8BB0\u548C\u672C\u5730\u5C01\u9762\u3002",
      async () => {
        await openSingleAnimeImport(
          this.app,
          this.plugin
        );
      }
    );
    this.addAction(
      container,
      "\u6279\u91CF\u5BFC\u5165\u52A8\u753B",
      "\u9009\u62E9 Bangumi \u7528\u6237\u5217\u8868\u540E\u6279\u91CF\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0\uFF1B\u5DF2\u6709\u7B14\u8BB0\u53EF\u4EE5\u81EA\u52A8\u8DF3\u8FC7\u3002",
      async () => {
        await openBatchAnimeImport(
          this.app,
          this.plugin
        );
      }
    );
    this.addAction(
      container,
      "\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6",
      "\u6309\u4E0A\u65B9\u8BBE\u7F6E\u521B\u5EFA\u7F3A\u5C11\u7684\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55\u3001\u5C01\u9762\u76EE\u5F55\u3001\u8FFD\u756A\u5217\u8868\u6587\u4EF6\u548C\u52A8\u753B\u5E93\u6587\u4EF6\uFF1B\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u8986\u76D6\u3002",
      async () => {
        await this.plugin.initializeMissingFiles();
      }
    );
    this.addAction(
      container,
      "\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001",
      "\u63D2\u4EF6\u901A\u5E38\u4F1A\u81EA\u52A8\u68C0\u67E5\uFF1B\u70B9\u51FB\u6B64\u5904\u53EF\u4EE5\u7ACB\u5373\u91CD\u65B0\u626B\u63CF\u5168\u90E8\u52A8\u753B\u7684\u672C\u5730\u89C6\u9891\u76EE\u5F55\u3002",
      async () => {
        await this.plugin.checkAllLocalStatus(true);
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
      "\u9009\u62E9\u5B63\u5EA6\u89C6\u56FE\u6E05\u7406",
      "\u52FE\u9009\u591A\u4E2A\u5B63\u5EA6\u540E\u4E00\u6B21\u5220\u9664\uFF1B\u201C\u5168\u90E8\u52A8\u753B\u201D\u4E0D\u4F1A\u88AB\u5220\u9664\u3002",
      async () => {
        await this.plugin.openSeasonViewCleanup();
      }
    );
    this.addAction(
      container,
      "\u5B89\u5168\u6E05\u7406\u5DF2\u5B8C\u6210\u5B63\u5EA6\u89C6\u56FE",
      "\u53EA\u5220\u9664\u52A8\u753B\u5E93\u4E2D\u7684\u5B63\u5EA6\u89C6\u56FE\uFF0C\u4E0D\u5220\u9664\u52A8\u753B\u7B14\u8BB0\u3001\u672C\u5730\u89C6\u9891\u6216\u672C\u5730\u6587\u4EF6\u5939\uFF1B\u201C\u5DF2\u770B\u201D\u52A8\u753B\u53EF\u76F4\u63A5\u89C6\u4E3A\u5B8C\u6210\uFF0C\u5176\u4ED6\u52A8\u753B\u9700\u8981\u603B\u96C6\u6570\u3001\u89C2\u770B\u8FDB\u5EA6\u548C\u672C\u5730\u89C6\u9891\u5747\u5DF2\u5B8C\u6210\u3002",
      async () => {
        await this.plugin.cleanCompletedSeasonViews(
          true
        );
      }
    );
    this.addAction(
      container,
      "\u6279\u91CF\u4FEE\u6539\u89C2\u770B\u72B6\u6001",
      "\u4ECE\u52A8\u753B\u5217\u8868\u4E2D\u52FE\u9009\u591A\u90E8\u52A8\u753B\u540E\u4E00\u6B21\u4FEE\u6539\u3002",
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
        await openSingleAnimeImport(
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
        await openBatchAnimeImport(
          this.app,
          this.plugin
        );
      }
    );
    this.addAction(
      container,
      "\u521D\u59CB\u5316\u7F3A\u5931\u6587\u4EF6",
      "\u6309\u5F53\u524D\u8DEF\u5F84\u8BBE\u7F6E\u521B\u5EFA\u7F3A\u5C11\u7684\u76EE\u5F55\u3001\u8FFD\u756A\u5217\u8868\u6587\u4EF6\u548C\u52A8\u753B\u5E93 Base \u6587\u4EF6\uFF1B\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u8986\u76D6\u3002",
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
    new Setting(container).setName(name).setDesc(description).addButton((button) => {
      button.setButtonText("\u6267\u884C");
      button.onClick(callback);
    });
  }
  addPathSetting(container, name, key, description) {
    new Setting(container).setName(name).setDesc(description).addText((text) => {
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
  for (const line of match[1].split(/\r?\n/)) {
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
function inspectLocalFolder(downloadPath, watchedEpisodes) {
  if (!downloadPath || downloadPath === "\u65E0") {
    return {
      error: "\u65E0\u4E0B\u8F7D\u8DEF\u5F84",
      downloadPath: "",
      fileCount: 0,
      newCount: 0
    };
  }
  if (!fs.existsSync(downloadPath)) {
    return {
      error: "\u6587\u4EF6\u5939\u4E0D\u5B58\u5728",
      downloadPath,
      fileCount: 0,
      newCount: 0
    };
  }
  const entries = fs.readdirSync(
    downloadPath,
    {
      withFileTypes: true
    }
  );
  const fileCount = entries.filter((entry) => {
    if (!entry.isFile()) {
      return false;
    }
    return VIDEO_EXTENSIONS.includes(
      path.extname(
        entry.name
      ).toLowerCase()
    );
  }).length;
  return {
    error: null,
    downloadPath,
    fileCount,
    newCount: Math.max(
      0,
      fileCount - watchedEpisodes
    )
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
  const fieldLine = fieldName + ': "' + String(fieldValue || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const pattern = new RegExp(
    "^" + escapedName + "\\s*:.*$",
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
module.exports = BangumiManagerPlugin;
