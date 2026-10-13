const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  ItemView
} = require("obsidian");


globalThis.__BangumiManagerModal = Modal;
globalThis.__BangumiManagerNotice = Notice;


let openSingleAnimeImport;
let openBatchAnimeImport;
let BangumiManagerSettingTab;
let NetabaNoteManagerModal;
let NetabaPageSelectModal;
let NetabaCompareSelectModal;
let {
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
  appendSeasonView
} = {};

const bangumiApi = require("./bangumi-api.js");
const importManager = require("./import-manager.js");
const batchImportManager = require("./batch-import-manager.js");
const createSettingsTabClass = require("./settings-tab.js");
const noteUtils = require("./note-utils.js");
const createNetabaModals = require("./netaba-modals.js");

var DEFAULT_SETTINGS = {
  mode: "lazy",
  noteRootFolder: "动画笔记",
  coverFolder: "\u9644\u4EF6/Bangumi Images",
  baseFilePath: "动画笔记/追番广场/动画库.base",
  baseFolderPath: "动画笔记/追番广场",
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


};

var WATCH_STATES = [
  "\u5DF2\u770B",
  "\u5728\u770B",
  "\u60F3\u770B",
  "\u629B\u5F03"
];

var BANGUMI_SCORE_DASHBOARD_VIEW_TYPE =
  "bangumi-score-dashboard-view";

var BangumiScoreDashboardView = class extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return BANGUMI_SCORE_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText() {
    return "动画评分仪表盘";
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
      text: "动画评分仪表盘"
    });

    const controls = toolbar.createDiv(
      "bangumi-dashboard-view-controls"
    );

    const refreshButton = controls.createEl("button", {
      text: "刷新"
    });

    const markdownButton = controls.createEl("button", {
      text: "打开 Markdown"
    });

    const dashboard = this.contentEl.createDiv(
      "bangumi-score-dashboard"
    );

    refreshButton.onclick = async () => {
      refreshButton.disabled = true;

      try {
        await this.plugin.refreshScoreDashboard(true);
        await this.plugin.renderScoreDashboard(
          dashboard
        );
      } finally {
        refreshButton.disabled = false;
      }
    };

    markdownButton.onclick = async () => {
      await this.plugin.openScoreDashboard();
    };

    await this.plugin.renderScoreDashboard(dashboard);
  }

  async onClose() {
    this.contentEl.empty();
  }
};

var BangumiManagerPlugin = class extends Plugin {
  async onload() {
    const savedSettings =
      await this.loadData();

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

    if (
      !validRatingRefreshPromptModes.includes(
        savedSettings &&
        savedSettings.ratingRefreshPromptMode
      )
    ) {
      this.settings.ratingRefreshPromptMode =
        savedSettings &&
        savedSettings.ratingRefreshPromptDisabled ===
        true
          ? "later"
          : "ask";
    }

    this.settings.ratingRefreshPromptDisabled =
      this.settings.ratingRefreshPromptMode !==
      "ask";

    if (
      typeof this.settings.netabaUserIdManuallySet !==
      "boolean"
    ) {
      this.settings.netabaUserIdManuallySet =
        Boolean(
          savedSettings &&
          savedSettings.netabaUserId &&
          savedSettings.netabaUserId !==
            savedSettings.bangumiUserId
        );
    }

    if (
      this.settings.netabaUserIdManuallySet !==
      true
    ) {
      this.settings.netabaUserId = String(
        this.settings.bangumiUserId || ""
      ).trim();
    }

    if (
      typeof this.settings.baseFolderPathManuallySet !==
      "boolean"
    ) {
      this.settings.baseFolderPathManuallySet = false;
    }

    if (
      typeof this.settings.dashboardPathManuallySet !==
      "boolean"
    ) {
      this.settings.dashboardPathManuallySet = false;
    }

    if (
      this.settings.baseFolderPathManuallySet ===
      true
    ) {
      this.settings.baseFolderPath =
        this.normalizeDashboardPath(
          this.settings.baseFolderPath
        ) || this.getDefaultManagerFolderPath();
    } else {
      this.settings.baseFolderPath =
        this.getDefaultManagerFolderPath();
    }

    if (
      this.settings.dashboardPathManuallySet ===
      true
    ) {
      this.settings.dashboardPath =
        this.normalizeDashboardPath(
          this.settings.dashboardPath
        ) || this.getDefaultDashboardPath();
    } else {
      this.settings.dashboardPath =
        this.getDefaultDashboardPath();
    }

    this.settings.baseFilePath =
      this.settings.baseFolderPath +
      "/动画库.base";

    await this.saveData(this.settings);
    const netabaModals =
      createNetabaModals({
        Modal,
        Notice,
        bangumiApi
      });

    NetabaNoteManagerModal =
      netabaModals.NetabaNoteManagerModal;

    NetabaPageSelectModal =
      netabaModals.NetabaPageSelectModal;

    NetabaCompareSelectModal =
      netabaModals.NetabaCompareSelectModal;

    openSingleAnimeImport =
      importManager.openSingleAnimeImport;

    openBatchAnimeImport =
      batchImportManager.openBatchAnimeImport;

    BangumiManagerSettingTab =
      createSettingsTabClass({
        PluginSettingTab,
        Setting,
        Notice,
        Modal,
        openSingleAnimeImport,
        openBatchAnimeImport,
        NetabaCompareSelectModal
      });

    cleanValue = noteUtils.cleanValue;
    parseFrontmatter = noteUtils.parseFrontmatter;
    extractWatchedEpisodes =
      noteUtils.extractWatchedEpisodes;
    inspectLocalFolder =
      noteUtils.inspectLocalFolder;
    getLocalStatusText =
      noteUtils.getLocalStatusText;
    updateFrontmatterField =
      noteUtils.updateFrontmatterField;
    updateScoreFields =
      noteUtils.updateScoreFields;

    synchronizeBangumiScoreFields =
      noteUtils.synchronizeBangumiScoreFields;
    updateFolderLine =
      noteUtils.updateFolderLine;
    updateNetabaIframeUrl =
      noteUtils.updateNetabaIframeUrl;
    getNetabaPageName =
      noteUtils.getNetabaPageName;
    updateNetabaSection =
      noteUtils.updateNetabaSection;
    extractBaseViewNames =
      noteUtils.extractBaseViewNames;
    removeBaseViews =
      noteUtils.removeBaseViews;
    hasBaseView =
      noteUtils.hasBaseView;
    appendSeasonView =
      noteUtils.appendSeasonView;

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
      name: "打开动画评分仪表盘",
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
      this.startupTimer = window.setTimeout(
        async () => {
          await this.checkAllLocalStatus(false);

          try {
            await this.refreshBangumiRatingsSilently();
          } catch (error) {
            console.error(
              "启动后评分监测失败:",
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

        const ratingMonitorDue =
          !this.settings.lastRatingMonitorAt ||
          Date.now() -
            this.settings.lastRatingMonitorAt >=
            ratingMonitorSeconds * 1000;

        if (ratingMonitorDue) {
          try {
            await this.refreshBangumiRatingsSilently();
          } catch (error) {
            console.error(
              "后台评分监测失败:",
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

    if (
      this.settings.showDashboardRibbon === false
    ) {
      return;
    }

    this.dashboardRibbon = this.addRibbonIcon(
      "chart-no-axes-combined",
      "打开动画评分仪表盘",
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

    if (
      this.settings.markdownDashboardEnabled !==
      false
    ) {
      await this.ensureScoreDashboard(false);
    }

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
  async createBaseFileIfMissing() {
    const baseFolderPath = String(
      this.settings.baseFolderPath || ""
    )
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/[\\/]+$/, "");

    const filePath = baseFolderPath
      ? baseFolderPath + "/动画库.base"
      : "动画库.base";

    if (!filePath) {
      new Notice(
        "动画库 Base 文件路径为空，请先设置动画笔记目录或动画库文件路径。",
        6000
      );
      return;
    }

    if (this.app.vault.getAbstractFileByPath(
      filePath
    )) {
      return;
    }
    const lastSlash =
      filePath.lastIndexOf("/");

    const folderPath =
      lastSlash >= 0
        ? filePath.slice(0, lastSlash)
        : "";

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
        "创建动画库 Base 文件失败:",
        filePath,
        error
      );

      new Notice(
        "创建动画库 Base 文件失败：" +
        filePath +
        "。请检查路径是否位于当前仓库内，以及父目录是否可写。",
        8000
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

      if (
        !parsed ||
        !String(parsed.fields.tags || "").includes("bangumi")
      ) {
        continue;
      }

      const subjectId = bangumiApi.getSubjectId(
        cleanValue(parsed.fields.BGM链接)
      );

      if (subjectId) {
        count += 1;
      }
    }

    return count;
  }
    async refreshBangumiRatingsSilently() {
    if (
      this.settings.ratingMonitorEnabled === false
    ) {
      return;
    }

    if (this.ratingRefreshRunning) {
      return;
    }

    const userId = String(
      this.settings.bangumiUserId || ""
    ).trim();

    const shouldMonitorUserScore =
      /^\d+$/.test(userId);

    const shouldMonitorPublicScore = true;

    if (
      !shouldMonitorUserScore &&
      !shouldMonitorPublicScore
    ) {
      return;
    }

    this.ratingRefreshRunning = true;

    try {
      const items = [];

      for (
        const file of this.app.vault.getMarkdownFiles()
      ) {
        if (!this.isTargetNote(file)) {
          continue;
        }

        const content = await this.app.vault.read(
          file
        );

        const parsed = parseFrontmatter(content);

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
            parsed.fields.BGM链接
          )
        );

        if (!subjectId) {
          continue;
        }

        items.push({
          file,
          content,
          parsed,
          subjectId
        });
      }

      if (!items.length) {
        return;
      }

      const subjectIds = items.map((item) => {
        return item.subjectId;
      });

      let userRatings = new Map();
      let publicRatings = new Map();

      if (
        shouldMonitorUserScore &&
        /^\d+$/.test(userId)
      ) {
        try {
          userRatings =
            await bangumiApi.getUserRatingsForSubjects(
              userId,
              subjectIds
            );
        } catch (error) {
          console.error(
            "后台读取 BGM 用户评分失败:",
            error
          );
        }
      }

      if (shouldMonitorPublicScore) {
        try {
          publicRatings =
            await bangumiApi.getPublicRatingsForSubjects(
              subjectIds,
              450
            );
        } catch (error) {
          console.error(
            "后台读取 BGM 公共评分失败:",
            error
          );
        }
      }

      const ratingCache = Object.assign(
        {},
        this.settings.bangumiRatingCache || {}
      );

      const publicRatingCache = Object.assign(
        {},
        this.settings.bangumiPublicRatingCache || {}
      );

      let updated = 0;

      for (const item of items) {
        let newContent = item.content;
        const userScore =
          userRatings.get(item.subjectId);

        const publicScore =
          publicRatings.get(item.subjectId);

        if (
          userScore !== undefined &&
          userScore !== null
        ) {
          const scoreText = String(userScore);

          ratingCache[item.subjectId] =
            scoreText;

          newContent = updateScoreFields(
            newContent,
            this.settings.showBangumiUserScore !==
            false
              ? scoreText
              : null,
            this.settings.showPersonalScore !==
            false
              ? (
                  cleanValue(
                    item.parsed.fields.我的评分
                  ) || "未评分"
                )
              : null
          );
        }

        if (
          publicScore !== undefined &&
          publicScore !== null
        ) {
          publicRatingCache[item.subjectId] =
            String(publicScore);

          const displayedScore =
            this.settings.showBangumiPreciseScore ===
            true
              ? this.getDisplayedBangumiScore(
                  item.subjectId,
                  item.parsed.fields
                )
              : String(publicScore);

          newContent =
            synchronizeBangumiScoreFields(
              newContent,
              this.getScoreDisplayOptions(),
              {
                bangumiScore: displayedScore
              }
            );
        }

        if (newContent !== item.content) {
          await this.app.vault.modify(
            item.file,
            newContent
          );

          updated += 1;
        }
      }

      this.settings.bangumiRatingCache =
        ratingCache;

      this.settings.bangumiPublicRatingCache =
        publicRatingCache;

      this.settings.lastRatingMonitorAt =
        Date.now();

      await this.saveSettings();
      await this.refreshScoreDashboard(false);

      if (updated > 0) {
        console.log(
          "BGM 评分监测完成，更新 " +
          updated +
          " 篇动画笔记。"
        );
      }
    } finally {
      this.ratingRefreshRunning = false;
    }
  }

  getScoreDisplayOptions() {
    return {
      useBangumiPreciseScore:
        this.settings.showBangumiPreciseScore ===
        true,
      bangumiPreciseScoreDisplayDigits:
        this.settings.bangumiPreciseScoreDisplayDigits
    };
  }

  getDisplayedBangumiScore(
    subjectId,
    fields
  ) {
    const publicCache = Object.assign(
      {},
      this.settings.bangumiPublicRatingCache || {}
    );

    const preciseCache = Object.assign(
      {},
      this.settings.bangumiPreciseRatingCache || {}
    );

    if (
      this.settings.showBangumiPreciseScore ===
      true
    ) {
      return cleanValue(
        preciseCache[subjectId]
      ) || cleanValue(fields.BGM评分);
    }

    return cleanValue(
      publicCache[subjectId]
    ) || cleanValue(fields.BGM评分);
  }

  async refreshScoreDisplayFields() {
    const displayOptions =
      this.getScoreDisplayOptions();

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

    for (
      const file of this.app.vault.getMarkdownFiles()
    ) {
      if (!this.isTargetNote(file)) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        const parsed = parseFrontmatter(content);

        if (
          !parsed ||
          !String(parsed.fields.tags || "").includes("bangumi")
        ) {
          continue;
        }

        const subjectId = bangumiApi.getSubjectId(
          cleanValue(parsed.fields.BGM链接)
        );

        if (!subjectId) {
          continue;
        }

        const legacyPreciseScore = cleanValue(
          parsed.fields.BGM精确评分
        );

        if (legacyPreciseScore && !preciseCache[subjectId]) {
          preciseCache[subjectId] = legacyPreciseScore;
        }

        if (
          parsed.fields.BGM评分 &&
          !publicCache[subjectId]
        ) {
          publicCache[subjectId] =
            cleanValue(parsed.fields.BGM评分);
        }

        scanned += 1;

        const displayedScore =
          this.getDisplayedBangumiScore(
            subjectId,
            parsed.fields
          );

        const oldBangumiScore = cleanValue(
          parsed.fields.BGM用户评分 ||
          parsed.fields.Bangumi用户评分
        );

        const oldPersonalScore = cleanValue(
          parsed.fields.我的评分
        );

        if (
          oldBangumiScore &&
          oldBangumiScore !== "未评分" &&
          oldBangumiScore !== "未知"
        ) {
          bangumiRatingCache[subjectId] =
            oldBangumiScore;
        }

        if (
          oldPersonalScore &&
          oldPersonalScore !== "未评分" &&
          oldPersonalScore !== "未知"
        ) {
          personalRatingCache[file.path] =
            oldPersonalScore;
        }

        let newContent =
          synchronizeBangumiScoreFields(
            content,
            displayOptions,
            {
              bangumiScore: displayedScore
            }
          );

        newContent = updateScoreFields(
          newContent,
          this.settings.showBangumiUserScore !== false
            ? (
                bangumiRatingCache[subjectId] ||
                oldBangumiScore ||
                "未评分"
              )
            : null,
          this.settings.showPersonalScore !== false
            ? (
                oldPersonalScore ||
                personalRatingCache[file.path] ||
                "未评分"
              )
            : null
        );

        if (newContent !== content) {
          await this.app.vault.modify(file, newContent);
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        console.warn(
          "刷新评分显示失败:",
          file.path,
          error
        );
      }
    }

    this.settings.bangumiPublicRatingCache =
      publicCache;

    this.settings.bangumiPreciseRatingCache =
      preciseCache;

    this.settings.bangumiRatingCache =
      bangumiRatingCache;

    this.settings.personalRatingCache =
      personalRatingCache;

    await this.saveSettings();
    await this.refreshScoreDashboard(false);

    return {
      scanned,
      updated,
      failed
    };
  }
  async refreshPreciseRatingsSilently(
    manual = false
  ) {
    if (
      !manual &&
      this.settings.ratingMonitorEnabled === false
    ) {
      return {
        scanned: 0,
        requested: 0,
        preciseUpdated: 0,
        notesUpdated: 0,
        noData: 0,
        failed: 0,
        skipped: true
      };
    }

    const shouldUpdatePreciseScore =
      this.settings.showBangumiPreciseScore ===
        true ||
      this.settings.dashboardShowPreciseRank ===
        true;

    const summary = {
      scanned: 0,
      requested: 0,
      preciseUpdated: 0,
      notesUpdated: 0,
      noData: 0,
      failed: 0,
      skipped: false
    };

    if (!shouldUpdatePreciseScore) {
      summary.skipped = true;
      return summary;
    }

    if (this.preciseRefreshRunning) {
      summary.skipped = true;
      return summary;
    }

    this.preciseRefreshRunning = true;

    try {
      const items = [];

      for (
        const file of this.app.vault.getMarkdownFiles()
      ) {
        if (!this.isTargetNote(file)) {
          continue;
        }

        const content = await this.app.vault.read(
          file
        );

        const parsed = parseFrontmatter(content);

        if (
          !parsed ||
          !String(
            parsed.fields.tags || ""
          ).includes("bangumi")
        ) {
          continue;
        }

        const subjectId = bangumiApi.getSubjectId(
          cleanValue(
            parsed.fields.BGM链接
          )
        );

        if (!subjectId) {
          continue;
        }

        items.push({
          file,
          content,
          parsed,
          subjectId
        });
      }

      summary.scanned = items.length;

      const preciseCache = Object.assign(
        {},
        this.settings.bangumiPreciseRatingCache || {}
      );

      const subjectIds = [
        ...new Set(
          items.map((item) => item.subjectId)
        )
      ];

      summary.requested = subjectIds.length;

      let preciseRatings = new Map();

      try {
        preciseRatings =
          await bangumiApi.getPreciseRatingsForSubjects(
            subjectIds,
            450
          );
      } catch (error) {
        console.error(
          "读取 BGM 精确评分失败:",
          error
        );
        summary.failed = subjectIds.length;
      }

      for (const item of items) {
        const preciseScore =
          preciseRatings.get(item.subjectId);

        if (
          preciseScore === undefined ||
          preciseScore === null
        ) {
          summary.noData += 1;
          continue;
        }

        preciseCache[item.subjectId] =
          String(preciseScore);

        summary.preciseUpdated += 1;

        const displayedScore =
          this.settings.showBangumiPreciseScore ===
          true
            ? String(preciseScore)
            : cleanValue(
                item.parsed.fields.BGM评分
              );

        const newContent =
          synchronizeBangumiScoreFields(
            item.content,
            this.getScoreDisplayOptions(),
            {
              bangumiScore: displayedScore
            }
          );

        if (newContent !== item.content) {
          await this.app.vault.modify(
            item.file,
            newContent
          );

          summary.notesUpdated += 1;
        }
      }

      this.settings.bangumiPreciseRatingCache =
        preciseCache;

      if (summary.requested > 0) {
        this.settings.lastRatingMonitorAt =
          Date.now();

        await this.saveSettings();
      }

      if (summary.notesUpdated > 0) {
        await this.refreshScoreDashboard(false);

        console.log(
          "BGM 精确评分更新完成：更新 " +
          summary.notesUpdated +
          " 篇动画笔记。"
        );
      }

      return summary;
    } finally {
      this.preciseRefreshRunning = false;
    }
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

        const subjectId =
          bangumiApi.getSubjectId(
            cleanValue(
              parsed.fields.BGM链接
            )
          );

        if (!subjectId) {
          continue;
        }

        const oldBangumiScore =
          cleanValue(
            parsed.fields.BGM用户评分 ||
            parsed.fields.Bangumi用户评分
          );

        const oldPersonalScore =
          cleanValue(
            parsed.fields.我的评分
          );

        if (
          oldBangumiScore &&
          oldBangumiScore !== "\u672A\u8BC4\u5206" &&
          oldBangumiScore !== "\u672A\u77E5" &&
          oldBangumiScore !== "\u6B63\u5728\u8BFB\u53D6"
        ) {
          bangumiRatingCache[subjectId] =
            oldBangumiScore;
        }

        if (
          oldPersonalScore &&
          oldPersonalScore !== "\u672A\u8BC4\u5206" &&
          oldPersonalScore !== "\u672A\u77E5"
        ) {
          personalRatingCache[file.path] =
            oldPersonalScore;
        }

        const bgmScore =
          bangumiRatingCache[subjectId] ||
          oldBangumiScore ||
          "\u672A\u8BC4\u5206";

        const personalScore =
          oldPersonalScore ||
          personalRatingCache[file.path] ||
          "\u672A\u8BC4\u5206";

        const newContent =
          updateScoreFields(
            content,
            this.settings.showBangumiUserScore !== false
              ? bgmScore
              : null,
            this.settings.showPersonalScore !== false
              ? personalScore
              : null
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
          "刷新评分字段失败:",
          file.path,
          error
        );
      }
    }

    this.settings.bangumiRatingCache =
      bangumiRatingCache;

    this.settings.personalRatingCache =
      personalRatingCache;

    await this.saveSettings();
    await this.refreshScoreDashboard(false);

    if (updated > 0) {
      new Notice(
        "\u5DF2\u66F4\u65B0 " +
        updated +
        " \u7BC7\u52A8\u753B\u7B14\u8BB0的评分显示。",
        5000
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
  async openScoreDashboardView() {
    const leaves =
      this.app.workspace.getLeavesOfType(
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
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/[\\/]+$/, "");
  }

  getDefaultManagerFolderPath() {
    const noteRoot = this.normalizeDashboardPath(
      this.settings.noteRootFolder
    );

    return noteRoot
      ? noteRoot + "/追番广场"
      : "追番广场";
  }

  getDefaultDashboardPath() {
    return this.getDefaultManagerFolderPath() +
      "/动画评分仪表盘.md";
  }
  getDashboardPath() {
    const configuredPath =
      this.normalizeDashboardPath(
        this.settings.dashboardPath
      );

    if (!configuredPath) {
      return this.getDefaultDashboardPath();
    }

    return configuredPath.endsWith(".md")
      ? configuredPath
      : configuredPath + ".md";
  }

  getDashboardContent() {
    return [
      "---",
      "cssclasses:",
      "  - bangumi-dashboard",
      "---",
      "",
      "# 动画评分仪表盘",
      "",
      "<div class=\"bangumi-score-dashboard\" data-bangumi-dashboard=\"true\"></div>",
      ""
    ].join("\n");
  }

  async ensureScoreDashboard(forceOverwrite) {
    if (
      this.settings.markdownDashboardEnabled ===
      false
    ) {
      return null;
    }

    const dashboardPath = this.getDashboardPath();
    const lastSlash = dashboardPath.lastIndexOf("/");
    const folderPath = lastSlash >= 0
      ? dashboardPath.slice(0, lastSlash)
      : "";

    if (folderPath) {
      await this.ensureVaultFolder(folderPath);
    }

    const existing =
      this.app.vault.getAbstractFileByPath(
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
    if (
      this.settings.markdownDashboardEnabled ===
      false
    ) {
      new Notice(
        "Markdown 仪表盘当前已关闭，请在插件设置中重新启用。",
        5000
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

    return Number.isFinite(score) &&
      score >= 0 &&
      score <= 10
      ? score
      : null;
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

      const tags = String(
        parsed.fields.tags || ""
      );

      if (!tags.includes("bangumi")) {
        continue;
      }

      result.push({
        file,
        name: cleanValue(
          parsed.fields.中文名
        ) || file.basename,
        state: cleanValue(
          parsed.fields.观看状态
        ) || "未设置",
        personalScore: this.parseDashboardScore(
          parsed.fields.我的评分
        ),
        bangumiScore: this.parseDashboardScore(
          parsed.fields.BGM用户评分 ||
          parsed.fields.Bangumi用户评分
        ),
        preciseScore: this.parseDashboardScore(
          (
            this.settings.bangumiPreciseRatingCache ||
            {}
          )[
            bangumiApi.getSubjectId(
              cleanValue(parsed.fields.BGM链接)
            )
          ] || parsed.fields.BGM精确评分
        ),

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

  createDashboardRankList(
    container,
    title,
    items,
    scoreKey,
    secondaryKey,
    limit
  ) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );

    section.createEl("h2", {
      text: title
    });

    if (!items.length) {
      section.createEl("p", {
        text: "暂无可显示的评分记录。",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }

    const list = section.createDiv(
      "bangumi-dashboard-rank-list"
    );

    const maxScore = 10;

    items.slice(0, limit).forEach(
      (item, index) => {
        const row = list.createDiv(
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

          const leaf =
            this.app.workspace.getLeaf(true);

          await leaf.openFile(item.file);
        };

        const scoreValue = item[scoreKey];

        titleRow.createDiv({
          text: scoreValue.toFixed(1),
          cls: "bangumi-dashboard-score"
        });

        const track = content.createDiv(
          "bangumi-dashboard-bar-track"
        );

        const bar = track.createDiv(
          "bangumi-dashboard-bar"
        );

        bar.style.width =
          scoreValue / maxScore * 100 + "%";

        const secondaryScore =
          item[secondaryKey];

        content.createDiv({
          text: secondaryScore === null
            ? "另一项评分：未评分"
            : "另一项评分：" +
              secondaryScore.toFixed(1),
          cls: "bangumi-dashboard-rank-meta"
        });
      }
    );
  }

  createDashboardPreciseRankList(
    container,
    title,
    items,
    limit
  ) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );

    section.createEl("h2", {
      text: title
    });

    if (!items.length) {
      section.createEl("p", {
        text: "暂无可显示的精确评分记录。",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }

    const list = section.createDiv(
      "bangumi-dashboard-rank-list"
    );

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
        const row = list.createDiv(
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

        bar.style.width =
          item.preciseScore / 10 * 100 + "%";
      }
    );
  }

  createDashboardDistribution(container, items) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );

    section.createEl("h2", {
      text: "我的评分分布"
    });

    const ranges = [
      { label: "0–2", min: 0, max: 2.99 },
      { label: "3–4", min: 3, max: 4.99 },
      { label: "5–6", min: 5, max: 6.99 },
      { label: "7–8", min: 7, max: 8.99 },
      { label: "9–10", min: 9, max: 10 }
    ];

    const scoredItems = items.filter(
      (item) => item.personalScore !== null
    );

    if (!scoredItems.length) {
      section.createEl("p", {
        text: "填写“我的评分”后会显示评分分布。",
        cls: "bangumi-dashboard-empty"
      });
      return;
    }

    const chart = section.createDiv(
      "bangumi-dashboard-distribution"
    );

    ranges.forEach((range) => {
      const count = scoredItems.filter(
        (item) => {
          return item.personalScore >= range.min &&
            item.personalScore <= range.max;
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

      bar.style.width =
        count / scoredItems.length * 100 + "%";

      row.createDiv({
        text: String(count),
        cls: "bangumi-dashboard-distribution-count"
      });
    });
  }

  createDashboardWatchState(container, items) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );

    section.createEl("h2", {
      text: "观看状态"
    });

    const states = [
      "已看",
      "在看",
      "想看",
      "抛弃"
    ];

    const grid = section.createDiv(
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

  async renderScoreDashboard(container) {
    container.empty();

    const items = await this.collectDashboardItems();

    const personalItems = items
      .filter(
        (item) => item.personalScore !== null
      )
      .sort(
        (a, b) =>
          b.personalScore - a.personalScore ||
          a.name.localeCompare(b.name, "zh-CN")
      );

    const bangumiItems = items
      .filter(
        (item) => item.bangumiScore !== null
      )
      .sort(
        (a, b) =>
          b.bangumiScore - a.bangumiScore ||
          a.name.localeCompare(b.name, "zh-CN")
      );

    const personalAverage = personalItems.length
      ? (
          personalItems.reduce(
            (sum, item) =>
              sum + item.personalScore,
            0
          ) / personalItems.length
        ).toFixed(1)
      : "—";

    const bangumiAverage = bangumiItems.length
      ? (
          bangumiItems.reduce(
            (sum, item) =>
              sum + item.bangumiScore,
            0
          ) / bangumiItems.length
        ).toFixed(1)
      : "—";

    const header = container.createDiv(
      "bangumi-dashboard-header"
    );

    header.createEl("h1", {
      text: "动画评分仪表盘"
    });

    header.createDiv({
      text: "数据来自当前动画笔记；打开页面时自动重新统计。",
      cls: "bangumi-dashboard-subtitle"
    });

    const cards = container.createDiv(
      "bangumi-dashboard-cards"
    );

    this.createDashboardCard(
      cards,
      "动画总数",
      items.length
    );

    this.createDashboardCard(
      cards,
      "我的评分数",
      personalItems.length
    );

    this.createDashboardCard(
      cards,
      "我的平均评分",
      personalAverage
    );

    this.createDashboardCard(
      cards,
      "BGM 用户平均评分",
      bangumiAverage
    );

    const rankGrid = container.createDiv(
      "bangumi-dashboard-rank-grid"
    );

    this.createDashboardRankList(
      rankGrid,
      "我的评分排名",
      personalItems,
      "personalScore",
      "bangumiScore",
      Math.max(
        1,
        Number(
          this.settings.dashboardPersonalRankLimit
        ) || 10
      )
    );

    this.createDashboardRankList(
      rankGrid,
      "BGM 用户评分排名",
      bangumiItems,
      "bangumiScore",
      "personalScore",
      Math.max(
        1,
        Number(
          this.settings.dashboardBangumiRankLimit
        ) || 10
      )
    );

    const preciseItems = items
      .filter((item) => {
        return item.preciseScore !== null;
      })
      .sort((a, b) => {
        return b.preciseScore - a.preciseScore ||
          a.name.localeCompare(b.name, "zh-CN");
      });

    const preciseLimit = Math.max(
      1,
      Number(
        this.settings.dashboardBangumiRankLimit
      ) || 10
    );

    if (
      this.settings.dashboardShowPreciseRank !==
      false &&
      preciseItems.length
    ) {
      this.createDashboardPreciseRankList(
        rankGrid,
        "BGM 精确评分排名",
        preciseItems,
        preciseLimit
      );
    }

    if (
      this.settings.dashboardShowDistribution !==
      false
    ) {
      this.createDashboardDistribution(
        container,
        items
      );
    }

    if (
      this.settings.dashboardShowWatchState !==
      false
    ) {
      this.createDashboardWatchState(
        container,
        items
      );
    }
  }

  async refreshScoreDashboard(force) {
    if (
      !force &&
      this.settings.dashboardAutoRefresh === false
    ) {
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

    const marker =
      "<!-- bangumi-dashboard-refresh:" +
      Date.now() +
      " -->";

    const updated = content.includes(
      "<!-- bangumi-dashboard-refresh:"
    )
      ? content.replace(
          /<!-- bangumi-dashboard-refresh:[\s\S]*?-->/,
          marker
        )
      : content.trimEnd() +
        "\n\n" +
        marker +
        "\n";

    if (updated !== content) {
      await this.app.vault.modify(
        file,
        updated
      );
    }
  }

  registerScoreDashboardStyles() {
    const styleId =
      "bangumi-score-dashboard-style";

    const oldStyle =
      document.getElementById(styleId);

    if (oldStyle) {
      oldStyle.remove();
    }

    const style = document.createElement("style");

    style.id = styleId;

    style.textContent = [
      ".bangumi-score-dashboard{max-width:1180px;margin:0 auto;padding:8px 0 28px;}",
      ".bangumi-dashboard-header{margin:8px 0 18px;padding:20px 22px;border:1px solid var(--background-modifier-border);border-radius:16px;background:linear-gradient(135deg,var(--background-secondary),var(--background-primary));}",
      ".bangumi-dashboard-header h1{margin:0 0 6px;font-size:1.65em;}",
      ".bangumi-dashboard-subtitle{color:var(--text-muted);font-size:.9em;}",
      ".bangumi-dashboard-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px;}",
      ".bangumi-dashboard-card{padding:16px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-secondary);}",
      ".bangumi-dashboard-card-label{color:var(--text-muted);font-size:.82em;margin-bottom:7px;}",
      ".bangumi-dashboard-card-value{font-size:1.65em;font-weight:700;font-variant-numeric:tabular-nums;}",
      ".bangumi-dashboard-rank-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;}",
      ".bangumi-dashboard-section{margin:16px 0;padding:16px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-primary);}",
      ".bangumi-dashboard-section h2{margin:0 0 14px;font-size:1.08em;}",
      ".bangumi-dashboard-empty{margin:0;color:var(--text-muted);}",
      ".bangumi-dashboard-rank-list{display:flex;flex-direction:column;gap:10px;}",
      ".bangumi-dashboard-rank-row{display:flex;gap:10px;padding:10px;border-radius:10px;background:var(--background-secondary);transition:background-color .15s ease;}",
      ".bangumi-dashboard-rank-row:hover{background:var(--background-modifier-hover);}",
      ".bangumi-dashboard-rank-index{display:flex;align-items:center;justify-content:center;flex:0 0 28px;height:28px;border-radius:50%;background:var(--interactive-accent);color:var(--text-on-accent);font-size:.85em;font-weight:700;}",
      ".bangumi-dashboard-rank-content{min-width:0;flex:1;}",
      ".bangumi-dashboard-rank-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}",
      ".bangumi-dashboard-rank-title-row a{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}",
      ".bangumi-dashboard-score{flex:0 0 auto;color:var(--interactive-accent);font-weight:700;font-variant-numeric:tabular-nums;}",
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
      ".bangumi-score-dashboard-view{padding:0 18px 24px;overflow:auto;}",
      ".bangumi-dashboard-view-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0 10px;}",
      ".bangumi-dashboard-view-toolbar h2{margin:0;font-size:1.15em;}",
      ".bangumi-dashboard-view-controls{display:flex;gap:8px;flex-wrap:wrap;}",
      "@media (max-width:800px){.bangumi-dashboard-cards{grid-template-columns:repeat(2,minmax(0,1fr));}.bangumi-dashboard-rank-grid{grid-template-columns:1fr;}.bangumi-dashboard-state-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}",
      "@media (max-width:460px){.bangumi-dashboard-cards{grid-template-columns:1fr;}}"
    ].join("");

    document.head.appendChild(style);

    this.register(() => {
      style.remove();
    });
  }

  registerScoreDashboardProcessor() {
    this.registerMarkdownPostProcessor(
      async (element) => {
        const dashboards =
          element.querySelectorAll(
            "[data-bangumi-dashboard=true]"
          );

        for (const dashboard of dashboards) {
          await this.renderScoreDashboard(
            dashboard
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
              key: "subject",
              name: "当前动画页面"
            },
            {
              key: "season",
              name: "当季动画"
            },
            {
              key: "trending",
              name: "评分趋势"
            },
            {
              key: "history",
              name: "历史分布"
            },
            {
              key: "user",
              name: "个人评分"
            },
            {
              key: "compare",
              name: "动画对比"
            },
            {
              key: "browser",
              name: "在浏览器打开当前页面"
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

                if (page.key === "browser") {
                  const currentUrl =
                    iframe?.getAttribute("src") || "";

                  if (currentUrl) {
                    window.open(
                      currentUrl,
                      "_blank"
                    );
                  }

                  return;
                }

                const url =
                  this.getNetabaPageUrlForNote(
                    content,
                    page.key
                  );

                if (!url) {
                  new Notice(
                    "当前设置不足以生成这个 Netaba 页面，请检查用户编号或对比动画设置。",
                    6000
                  );
                  return;
                }

                const newContent =
                  updateNetabaIframeUrl(
                    content,
                    url
                  );

                if (newContent === content) {
                  new Notice(
                    "当前笔记中没有找到可更新的 Netaba 页面。",
                    5000
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

                new Notice(
                  "已切换为：" +
                  getNetabaPageName(page.key),
                  4000
                );
              }
            );

            control.appendChild(button);
          }

          const tip = document.createElement(
            "div"
          );

          tip.textContent =
            "请使用上方由本插件生成的按钮控制页面。Netaba 网页内部的按钮不受本插件控制，因此点击网页内部的“个人评分”或“实验功能”时，可能会看到与当前动画笔记无关的公共内容。";

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
      parsed.fields.BGM链接
    );

    const subjectMatch = bgmUrl.match(
      /\/subject\/(\d+)/i
    );

    const subjectId = subjectMatch
      ? subjectMatch[1]
      : "";

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

      return /^\d+$/.test(userId)
        ? "https://netaba.re/user/" + userId
        : "";
    }

    if (page === "compare") {
      const compareMatch = String(
        this.settings.netabaCompareUrl || ""
      ).match(
        /\/subject\/(\d+)/i
      );

      const compareSubjectId = compareMatch
        ? compareMatch[1]
        : "";

      if (!subjectId || !compareSubjectId) {
        return "";
      }

      return (
        "https://netaba.re/" +
        subjectId +
        "/vs/" +
        compareSubjectId
      );
    }

    return subjectId
      ? "https://netaba.re/subject/" + subjectId
      : "";
  }

  async applyNetabaPageToActiveNote(page) {
    const file = this.app.workspace.getActiveFile();

    if (!file || !this.isTargetNote(file)) {
      new Notice(
        "请先打开一篇动画数据笔记。",
        5000
      );
      return;
    }

    const content = await this.app.vault.read(file);
    const url = this.getNetabaPageUrlForNote(
      content,
      page
    );

    if (!url) {
      new Notice(
        "当前设置不足以生成这个 Netaba 页面，请检查用户编号或对比动画设置。",
        6000
      );
      return;
    }

    const newContent = updateNetabaIframeUrl(
      content,
      url
    );

    if (newContent === content) {
      new Notice(
        "当前笔记中没有找到 Netaba 评分图。",
        5000
      );
      return;
    }

    await this.app.vault.modify(
      file,
      newContent
    );

    new Notice(
      "已切换为：" +
      getNetabaPageName(page),
      4000
    );
  }

  async openNetabaPageInBrowser(page) {
    const file = this.app.workspace.getActiveFile();

    if (!file || !this.isTargetNote(file)) {
      new Notice(
        "请先打开一篇动画数据笔记。",
        5000
      );
      return;
    }

    const content = await this.app.vault.read(file);
    const url = this.getNetabaPageUrlForNote(
      content,
      page
    );

    if (!url) {
      new Notice(
        "当前设置不足以生成这个 Netaba 页面，请检查用户编号或对比动画设置。",
        6000
      );
      return;
    }

    window.open(url, "_blank");
  }

  async openNetabaNoteManager() {
    const items = await this.collectAnimeItems();

    if (items.length === 0) {
      new Notice(
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
          "批量处理 Netaba 评分图失败:",
          file.path,
          error
        );
      }
    }

    const actionText = action === "add"
      ? "创建"
      : "删除";

    new Notice(
      "Netaba 评分图" +
      actionText +
      "完成：更新 " +
      updated +
      " 篇，跳过 " +
      skipped +
      " 篇，失败 " +
      failed +
      " 篇。",
      8e3
    );
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
      "\u6253\u5F00\u6211\u7684 Bangumi \u8BC4\u5206\u6392\u884C",
      async () => {
        const userId = String(
          this.plugin.settings.bangumiUserId || ""
        ).trim();

        if (!/^\d+$/.test(userId)) {
          new Notice(
            "\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u6B63\u786E\u7684 Bangumi \u7528\u6237 ID\u3002",
            6000
          );
          return;
        }

        window.open(
          "https://bangumi.tv/anime/list/" +
          userId +
          "/collect?orderby=rate",
          "_blank"
        );
      }
    );
    this.addButton(
      contentEl,
      "切换 Netaba 页面",
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
module.exports = BangumiManagerPlugin;

