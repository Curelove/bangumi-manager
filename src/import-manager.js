const Modal = globalThis.__BangumiManagerModal;
const Notice = globalThis.__BangumiManagerNotice;

if (!Modal || !Notice) {
  throw new Error("主插件没有传入 Modal 或 Notice。");
}

const { tryRequireNode, isDesktopNodeAvailable, isMobileEnv, joinPosixPath } = require("./platform-env.js");
const { setSamplePreviewActive } = require("./onboarding-sample-service.js");
var bangumiApi = require("./bangumi-api.js");
var noteManager = require("./note-manager.js");
var animeActivityService = require("./anime-activity-and-random-service.js");
var WATCH_STATES2 = [
  "\u5DF2\u770B",
  "\u5728\u770B",
  "\u60F3\u770B",
  "\u629B\u5F03"
];
async function openSingleAnimeImport2(app, plugin, options = {}) {
  new SingleAnimeImportModal(
    app,
    plugin,
    options
  ).open();
}
var SingleAnimeImportModal = class extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.initialQuery = String(options?.initialQuery || "").trim();
    this.results = [];
    this.selectedInfo = null;
  }
  onOpen() {
    const {
      contentEl
    } = this;
    contentEl.empty();
    if (!isMobileEnv()) {
      this.modalEl.style.width = "min(760px, 90vw)";
      this.modalEl.style.maxWidth = "90vw";
      this.modalEl.style.maxHeight = "90vh";
      this.modalEl.style.overflowY = "auto";
    }
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
    const actionRow = contentEl.createDiv();
    actionRow.style.display = "flex";
    actionRow.style.flexWrap = "wrap";
    actionRow.style.alignItems = "center";
    actionRow.style.gap = "8px";
    actionRow.style.marginTop = "10px";

    const searchButton = actionRow.createEl(
      "button",
      {
        cls: "mod-cta",
        text: "\u641C\u7D22 Bangumi"
      }
    );
    const customFallbackBtn = actionRow.createEl(
      "button",
      {
        text: "Bangumi 搜不到？手动新建自定义动画"
      }
    );
    customFallbackBtn.onclick = () => {
      const kw = keywordInput.value.trim();
      this.close();
      if (typeof this.plugin?.openCustomAnimeModal === "function") {
        this.plugin.openCustomAnimeModal({ initialName: kw });
      }
    };
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
        new Notice(
          "\u8BF7\u5148\u8F93\u5165\u52A8\u753B\u540D\u79F0\u3002",
          5e3
        );
        return;
      }
      const searchSeq = (this._searchSeq = (this._searchSeq || 0) + 1);
      searchButton.disabled = true;
      searchButton.textContent = "\u6B63\u5728\u641C\u7D22\u2026\u2026";
      resultList.empty();
      detailArea.empty();
      try {
        const fetchedResults = await bangumiApi.searchBangumi(
          keyword
        );
        if (searchSeq !== this._searchSeq) return;
        this.results = fetchedResults;
        if (this.results.length === 0) {
          resultList.createEl(
            "p",
            {
              text: "\u6CA1\u6709\u5728 Bangumi \u627E\u5230\u76F8\u5173\u52A8\u753B\u3002\u82E5\u8BE5\u4F5C\u54C1\u672A\u88AB Bangumi \u6536\u5F55\uFF0C\u53EF\u76F4\u63A5\u624B\u52A8\u81EA\u5B9A\u4E49\u5EFA\u6863\uFF1A"
            }
          );
          const directCustomBtn = resultList.createEl("button", {
            cls: "mod-cta",
            text: `手动新建《${keyword}》自定义动画 →`
          });
          directCustomBtn.onclick = () => {
            this.close();
            if (typeof this.plugin?.openCustomAnimeModal === "function") {
              this.plugin.openCustomAnimeModal({ initialName: keyword });
            }
          };
          return;
        }
        const candidateRows = [];
        const foldHandleWrap = resultList.createDiv();
        foldHandleWrap.style.display = "none";
        foldHandleWrap.style.marginTop = "4px";
        const foldHandleBtn = foldHandleWrap.createEl("button", { text: "" });
        foldHandleBtn.style.display = "flex";
        foldHandleBtn.style.alignItems = "center";
        foldHandleBtn.style.justifyContent = "space-between";
        foldHandleBtn.style.width = "calc(100% - 12px)";
        foldHandleBtn.style.margin = "-2px auto 8px";
        foldHandleBtn.style.height = "auto";
        foldHandleBtn.style.minHeight = "34px";
        foldHandleBtn.style.padding = "7px 12px";
        foldHandleBtn.style.fontSize = "12px";
        foldHandleBtn.style.borderRadius = "0 0 10px 10px";
        foldHandleBtn.style.boxShadow =
          "0 4px 0 -2px var(--background-primary), 0 5px 0 -2px var(--background-modifier-border), 0 8px 0 -4px var(--background-secondary), 0 9px 0 -4px var(--background-modifier-border)";

        let folded = false;
        let pickedRowIdx = -1;
        const applyListFoldState = () => {
          const total = candidateRows.length;
          candidateRows.forEach((btnEl, i) => {
            const isPicked = i === pickedRowIdx;
            btnEl.style.borderColor = isPicked ? "var(--interactive-accent)" : "";
            btnEl.style.boxShadow = isPicked
              ? "0 0 0 2px color-mix(in srgb, var(--interactive-accent) 24%, transparent)"
              : "";
            btnEl.style.display = folded && pickedRowIdx >= 0 && !isPicked ? "none" : "block";
          });
          if (pickedRowIdx >= 0 && total > 1) {
            foldHandleWrap.style.display = "block";
            foldHandleBtn.textContent = folded
              ? `已折叠其余 ${total - 1} 条搜索结果 · 点击展开重选 ▾`
              : `收起其余 ${total - 1} 条搜索结果 ▴`;
          } else {
            foldHandleWrap.style.display = "none";
          }
        };
        foldHandleBtn.onclick = () => {
          folded = !folded;
          applyListFoldState();
        };

        this.results.forEach((result, idx) => {
          const button = resultList.createEl("button");
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
            pickedRowIdx = idx;
            folded = this.results.length > 1;
            applyListFoldState();
            await this.selectResult(result, detailArea);
          };
          candidateRows.push(button);
        });
        resultList.appendChild(foldHandleWrap);
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
    if (this.initialQuery) {
      keywordInput.value = this.initialQuery;
      setTimeout(() => search(), 30);
    }
  }
  async selectResult(result, detailArea) {
    const selectSeq = (this._selectSeq = (this._selectSeq || 0) + 1);
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
      if (selectSeq !== this._selectSeq) {
        return;
      }
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
      if (selectSeq !== this._selectSeq) {
        return;
      }

      this.selectedInfo = info;
      this.renderDetail(
        detailArea,
        info
      );
    } catch (error) {
      if (selectSeq !== this._selectSeq) {
        return;
      }
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
        text: "\u65E5\u6587\u540D\uFF1A" + info.JP + "\n\u7C7B\u578B\uFF1A" + info.type + "\n\u603B\u96C6\u6570\uFF1A" + info.episode + "\n\u5F00\u64AD\u65E5\u671F\uFF1A" + info.date + "\nBGM \u8BC4\u5206\uFF1A" + info.rating
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
    const canCreateLocal = isDesktopNodeAvailable();
    const configuredRoot = String(
      this.plugin.settings.localAnimeRoot || ""
    ).trim();
    const folderLabel = detailArea.createEl(
      "label"
    );
    folderLabel.style.display = canCreateLocal ? "block" : "none";
    folderLabel.style.marginTop = "12px";
    const folderCheckbox = folderLabel.createEl(
      "input"
    );
    folderCheckbox.type = "checkbox";
    folderCheckbox.checked = Boolean(canCreateLocal && configuredRoot);
    folderCheckbox.disabled = !configuredRoot;
    folderLabel.appendText(
      " \u521B\u5EFA\u672C\u5730\u52A8\u753B\u6587\u4EF6\u5939"
    );
    const pathPreview = detailArea.createEl(
      "p"
    );
    pathPreview.style.display = canCreateLocal ? "block" : "none";
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
      if (!base) {
        pathPreview.textContent = "尚未设置「新下载默认保存目录」，本次仅创建动画笔记（日后可随时通过「本地视频关联」绑定已有视频）。";
        return;
      }
      if (!folderCheckbox.checked || !seasonInfo.year || seasonInfo.season === "\u672A\u77E5\u5B63\u5EA6") {
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
        cls: "mod-cta is-save-ready-pulse",
        text: "\u521B\u5EFA\u52A8\u753B\u7B14\u8BB0"
      }
    );
    createButton.style.marginTop = "14px";
    requestAnimationFrame(() => {
      if (createButton.isConnected && typeof createButton.scrollIntoView === "function") {
        createButton.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
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
        new Notice(
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
      info.Poster,
      info.PosterFallback || ""
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

    if (
      /^\d+$/.test(bangumiUserId) &&
      info.subjectId
    ) {
      try {
        info.userRating =
          await bangumiApi.getUserRatingForSubject(
            bangumiUserId,
            info.subjectId
          );

        if (info.userRating !== null) {
          const ratingCache = Object.assign(
            {},
            this.plugin.settings.bangumiRatingCache || {}
          );

          ratingCache[info.subjectId] =
            String(info.userRating);

          this.plugin.settings.bangumiRatingCache =
            ratingCache;

          await this.plugin.saveSettings();
        }
      } catch (error) {
        info.userRating = null;
      }
    }
    let downloadPath = "\u65E0";
    if (shouldCreateFolder) {
      try {
        downloadPath = createDownloadFolder(
          this.plugin.settings,
          info
        );
      } catch (folderErr) {
        console.warn("[Bangumi Import] 创建本地下载目录失败，已降级仅创建笔记:", folderErr);
        new Notice(
          "未能创建本地下载文件夹（" + (folderErr?.message || "路径不可用") + "），已正常为您生成动画笔记。",
          6000
        );
        downloadPath = "\u65E0";
      }
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
        netabaEmbedEnabled:
          this.plugin.settings.netabaEmbedEnabled,
        animeInfoCollapsedByDefault:
          this.plugin.settings
            .animeInfoCollapsedByDefault === true,
        netabaCollapsedByDefault:
          this.plugin.settings.netabaCollapsedByDefault,
        netabaUserId:
          this.plugin.settings.netabaUserId,
        netabaCompareUrl:
          this.plugin.settings.netabaCompareUrl,
        netabaCompareTitle:
          this.plugin.settings.netabaCompareTitle,
        netabaDefaultPage:
          this.plugin.settings.netabaDefaultPage,
        showBangumiUserScore:
          this.plugin.settings.showBangumiUserScore,
        showPersonalScore:
          this.plugin.settings.showPersonalScore,
        useBangumiPreciseScore:
          this.plugin.settings.showBangumiPreciseScore ===
          true,
}
    );
    if (!result.created) {
      new Notice(
        "\u540C\u540D\u52A8\u753B\u7B14\u8BB0\u5DF2\u7ECF\u5B58\u5728\uFF0C\u672A\u8986\u76D6\u539F\u7B14\u8BB0\u3002",
        7e3
      );
      this.close();
      return;
    }
    setSamplePreviewActive(this.plugin, false);
    animeActivityService.recordAnimeActivity(this.plugin, {
      type: "import",
      animeName: info.CN || info.JP || result.filePath,
      filePath: result.filePath || "",
      cover: info.Poster || "",
      status: info.state || "",
      detail: `导入番剧卡片（${info.state || "想看"}）`
    }).catch(() => {});
    if (typeof this.plugin.refreshOpenDashboardViews === "function") {
      await this.plugin.refreshOpenDashboardViews();
    }
    new Notice(
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

    plugin.settings.bangumiPublicRatingCache =
      publicCache;
  }

  const preciseScore = Number(
    info && info.preciseRating
  );

  if (Number.isFinite(preciseScore)) {
    const preciseCache = Object.assign(
      {},
      plugin.settings.bangumiPreciseRatingCache || {}
    );

    preciseCache[subjectId] =
      String(info.preciseRating);

    plugin.settings.bangumiPreciseRatingCache =
      preciseCache;
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
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  if (!fs || !isDesktopNodeAvailable()) {
    return "\u65E0";
  }
  const root = String(
    settings.localAnimeRoot || ""
  ).trim();
  if (!root || !info.year || !info.season || info.season === "\u672A\u77E5\u5B63\u5EA6") {
    return "\u65E0";
  }
  const folderName = noteManager.getSafeFileName(
    info.CN || info.JP || info.fileName
  );
  const folderPath = path
    ? path.join(root, info.year, info.season, folderName)
    : joinPosixPath(root, info.year, info.season, folderName);
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
module.exports = {
  openSingleAnimeImport: openSingleAnimeImport2
};
