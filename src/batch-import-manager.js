const Modal = globalThis.__BangumiManagerModal;
const Notice = globalThis.__BangumiManagerNotice;

if (!Modal || !Notice) {
  throw new Error("主插件没有传入 Modal 或 Notice。");
}

var path = require("path");
var bangumiApi = require("./bangumi-api.js");
var noteManager = require("./note-manager.js");
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
var BatchAnimeImportModal = class extends Modal {
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
      this.plugin.settings.batchLastUserId ||
      this.plugin.settings.bangumiUserId ||
      ""
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
        new Notice(
          "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199 Bangumi \u7528\u6237 ID\u3002",
          5000
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
        new Notice(
          "\u8BF7\u5148\u586B\u5199 Bangumi \u7528\u6237 ID\u3002",
          6e3
        );
        return;
      }
      if (!/^\d+$/.test(userId)) {
        new Notice(
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
    const subjectIds = new Set();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (
        !file.path.startsWith(
          this.plugin.settings.noteRootFolder + "/"
        )
      ) {
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

      const subjectId = bangumiApi.getSubjectId(
        match[1]
      );

      if (subjectId) {
        subjectIds.add(subjectId);
      }
    }

    return subjectIds;
  }
  async runImport(
    userId,
    listKey,
    targetState,
    createFolder,
    skipExisting,
    importAfterDate,
    progress
  ) {
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

      const filteredItems = importAfterDate
        ? allItems.filter((item) => {
            return (
              item.collectedDate &&
              item.collectedDate > importAfterDate
            );
          })
        : allItems;

      const filteredOutCount =
        allItems.length - filteredItems.length;

      status.filteredOutItems = filteredOutCount;

      const items = filteredItems;

      if (!items.length) {
        if (importAfterDate && filteredOutCount > 0) {
          this.writeProgress(
            progress,
            "\u6CA1\u6709\u627E\u5230\u7B26\u5408\u65E5\u671F\u6761\u4EF6\u7684\u52A8\u753B\u3002\u5DF2\u8FC7\u6EE4 " +
            filteredOutCount +
            " \u90E8\u3002"
          );
        } else {
          this.writeProgress(
            progress,
            "\u6CA1\u6709\u627E\u5230\u53EF\u5BFC\u5165\u7684\u52A8\u753B\u3002"
          );
        }
        return;
      }

      const existingSubjectIds =
        skipExisting
          ? await this.getExistingBangumiSubjectIds()
          : new Set();

      status.totalItems = items.length;

      const filterMessage = importAfterDate
        ? "\uFF0C\u5DF2\u6309\u6536\u85CF\u65E5\u671F\u8FC7\u6EE4 " +
          filteredOutCount +
          " \u90E8"
        : "";

      this.writeProgress(
        progress,
        "\u5171\u627E\u5230 " +
        items.length +
        " \u90E8\u52A8\u753B" +
        filterMessage +
        "\uFF0C\u5F00\u59CB\u5BFC\u5165\u2026\u2026"
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
      new Notice(
        this.createSummary(status),
        1e4
      );
    } catch (error) {
      status.isRunning = false;
      status.wasStopped =
        this.stopRequested === true;

      status.hadFatalError = true;

      status.failedItems += 1;

      status.failedList.push({
        title: status.currentItem ||
          "\uFF08\u5217\u8868\u8BFB\u53D6\u9636\u6BB5\uFF09",
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

      const summary = status.wasStopped
        ? this.createSummary(status)
        : "\u6279\u91CF\u5BFC\u5165\u5931\u8D25\uFF1A" +
          error.message;

      this.writeProgress(
        progress,
        summary
      );

      new Notice(
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

      const entryText = String(
        entry.textContent || ""
      );

      const ratingElement = entry.querySelector(
        "span.starlight"
      );

      const ratingClass = ratingElement
        ? String(
            ratingElement.className || ""
          )
        : "";

      const ratingMatch = ratingClass.match(
        /(?:^|\s)stars(\d+)(?:\s|$)/
      );

      const userRating = ratingMatch
        ? Number(ratingMatch[1])
        : null;

      const dateMatch = entryText.match(
        /(20\d{2})-(\d{1,2})-(\d{1,2})/
      );

      const collectedDate = dateMatch
        ? dateMatch[1] +
          "-" +
          dateMatch[2].padStart(2, "0") +
          "-" +
          dateMatch[3].padStart(2, "0")
        : "";

      result.push({
        title_cn: bangumiApi.cleanFileName(
          titleLink.textContent
        ),
        title_jp: bangumiApi.cleanFileName(
          jpElement ? jpElement.textContent : ""
        ),
        link: href.startsWith("http")
          ? href
          : "https://bgm.tv" + href,
        subjectId: bangumiApi.getSubjectId(
          href
        ),
        collectedDate,
        userRating,
        cover: cover
          ? normalizeImageUrl(
              cover.getAttribute("src")
            )
          : ""
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
  async importOne(
    item,
    targetState,
    createFolder,
    skipExisting,
    status,
    existingSubjectIds
  ) {
    const subjectId =
      item.subjectId ||
      bangumiApi.getSubjectId(
        item.link
      );

    if (
      skipExisting &&
      subjectId &&
      existingSubjectIds.has(subjectId)
    ) {
      this.addLog(
        status,
        "\u8DF3\u8FC7 Obsidian \u4E2D\u5DF2\u6709\u52A8\u753B\uFF1A" +
        (item.title_cn ||
          item.title_jp ||
          item.link)
      );
      return "skipped";
    }

    const info = await bangumiApi.getAnimeDetail(
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

    if (
      info.userRating !== null &&
      info.userRating !== undefined &&
      info.subjectId
    ) {
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
    content += "\u72B6\u6001\uFF1A" + (
      status.isRunning
        ? "\u8FDB\u884C\u4E2D"
        : status.wasStopped
          ? "\u5DF2\u4E2D\u6B62"
          : status.hadFatalError
            ? "\u5DF2\u5931\u8D25"
            : "\u5DF2\u5B8C\u6210"
    ) + "\n\n";
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

    const statusText = status.wasStopped
      ? (
          status.failedItems > 0
            ? "\u6279\u91CF\u5BFC\u5165\u5DF2\u4E2D\u6B62\uFF08\u53D1\u751F\u5931\u8D25\uFF09\uFF1A\u65B0\u5EFA "
            : "\u6279\u91CF\u5BFC\u5165\u5DF2\u4E2D\u6B62\uFF1A\u65B0\u5EFA "
        )
      : "\u6279\u91CF\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u5EFA ";

    return (
      statusText +
      status.createdNotes +
      " \u90E8\uFF0C\u8DF3\u8FC7\u5DF2\u6709\u52A8\u753B " +
      status.skippedNotes +
      " \u90E8\uFF0C\u65E9\u4E8E\u7B5B\u9009\u65E5\u671F " +
      (status.filteredOutItems || 0) +
      " \u90E8\uFF0C\u5931\u8D25 " +
      status.failedItems +
      " \u90E8\u3002\u8017\u65F6 " +
      minutes +
      " \u5206 " +
      seconds +
      " \u79D2\u3002"
    );
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
module.exports = {
  openBatchAnimeImport: openBatchAnimeImport2
};
