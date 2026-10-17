const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  ItemView,
  Menu
} = require("obsidian");


globalThis.__BangumiManagerModal = Modal;
globalThis.__BangumiManagerNotice = Notice;


let openSingleAnimeImport;
let openBatchAnimeImport;
let BangumiManagerSettingTab;
let NetabaNoteManagerModal;
let NetabaPageSelectModal;
let NetabaCompareSelectModal;
const noteUtils = require("./note-utils.js");
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
  appendSeasonView,
  updateWatchedEpisodes,
  updateCalloutTableRow,
  addNoteTag,
  removeNoteTag,
  syncNoteCalloutFromFrontmatter,
  openLocalPathSafely
} = noteUtils;

const netabaTrendService = require("./netaba-trend-service.js");
const NetabaTrendModal = netabaTrendService.createNetabaTrendModalClass({ Modal, Notice });
const { Dashboard3DSpace } = require("./dashboard-3d-view.js");

const bangumiApi = require("./bangumi-api.js");
const importManager = require("./import-manager.js");
const batchImportManager = require("./batch-import-manager.js");
const createSettingsTabClass = require("./settings-tab.js");
const { RatingSyncManager } = require("./rating-sync-manager.js");
const createNetabaModals = require("./netaba-modals.js");

var DEFAULT_SETTINGS = {
  mode: "lazy",
  dashboard3dPerfMode: "medium",
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
  ratingCacheTtlSeconds: 86400,
  ratingDetailRequestConcurrency: 3,
  ratingDetailRequestIntervalMs: 300,
  ratingRequestTimeoutMs: 15000,
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
  title: "正在追番",
  tag: "",
  watchStatus: "在看",
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
    return "动画仪表盘";
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
      text: "动画仪表盘"
    });

    const controls = toolbar.createDiv(
      "bangumi-dashboard-view-controls"
    );

    const addSectionButton = controls.createEl("button", {
      text: "+ 新建查询分区",
      cls: "mod-cta"
    });

    const addCollectionButton = controls.createEl("button", {
      text: "+ 新建收藏展柜",
      cls: "mod-cta"
    });

    const refreshButton = controls.createEl("button", {
      text: "刷新"
    });

    const resetButton = controls.createEl("button", {
      text: "恢复默认布局"
    });

    const markdownButton = controls.createEl("button", {
      text: "打开 Markdown"
    });

    const toggle3DBtn = controls.createEl("button", {
      text: "🧊 3D 档案空间",
      cls: "mod-cta"
    });
    this.toggle3DBtn = toggle3DBtn;

    const dashboard = this.contentEl.createDiv(
      "bangumi-score-dashboard"
    );
    this.dashboardEl = dashboard;

    toggle3DBtn.onclick = async () => {
      if (this.space3DInstance) {
        this.destroy3D();
        this.dashboardEl.style.display = "";
        toggle3DBtn.textContent = "🧊 3D 档案空间";
        toggle3DBtn.classList.add("mod-cta");
        await this.refresh();
      } else {
        this.dashboardEl.style.display = "none";
        toggle3DBtn.textContent = "🔲 返回 2D 仪表盘";
        toggle3DBtn.classList.remove("mod-cta");
        const items = await this.plugin.collectDashboardItems();
        this.space3DContainer = this.contentEl.createDiv("bangumi-3d-wrapper");
        this.space3DInstance = new Dashboard3DSpace(this.space3DContainer, this.plugin, {
          items,
          filterMode: "watching"
        });
        this.space3DInstance.onExit3D = () => {
          toggle3DBtn.click();
        };
      }
    };

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

  destroy3D() {
    if (this.space3DInstance) {
      this.space3DInstance.destroy();
      this.space3DInstance = null;
    }
    if (this.space3DContainer) {
      this.space3DContainer.remove();
      this.space3DContainer = null;
    }
  }

  async refresh() {
    if (this.dashboardEl && !this.space3DInstance) {
      await this.plugin.renderScoreDashboard(this.dashboardEl, { isMarkdown: false });
    }
  }

  async onClose() {
    this.destroy3D();
    this.dashboardEl = null;
    this.contentEl.empty();
  }
};

var BangumiManagerPlugin = class extends Plugin {
  getWatchStateClass(state) {
    return state || "未设置";
  }

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

    if (!Array.isArray(this.settings.customQuerySections)) {
      this.settings.customQuerySections = [];
    }
    if (this.settings.customQuerySections.length === 0) {
      this.settings.customQuerySections = [Object.assign({}, DEFAULT_PRESET_QUERY_SECTION)];
    }
    if (!Array.isArray(this.settings.customCollectionSections)) {
      this.settings.customCollectionSections = [];
    }

    this.isPluginWritingNote = new Set();
    this.calloutSyncTimers = new Map();

    await this.saveData(this.settings);
    this.ratingSync = new RatingSyncManager(this);

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
    updateWatchedEpisodes =
      noteUtils.updateWatchedEpisodes;
    updateCalloutTableRow =
      noteUtils.updateCalloutTableRow;
    addNoteTag =
      noteUtils.addNoteTag;
    removeNoteTag =
      noteUtils.removeNoteTag;
    openLocalPathSafely =
      noteUtils.openLocalPathSafely;

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
      name: "打开动画仪表盘",
      callback: async () => {
        await this.openScoreDashboardView();
      }
    });

    this.addCommand({
      id: "open-bangumi-3d-space",
      name: "打开 3D 交互式动画档案空间",
      callback: async () => {
        await this.openScoreDashboardView();
        const leaves = this.app.workspace.getLeavesOfType(BANGUMI_SCORE_DASHBOARD_VIEW_TYPE);
        if (leaves.length > 0 && leaves[0].view) {
          const view = leaves[0].view;
          if (view.toggle3DBtn && !view.space3DInstance) {
            view.toggle3DBtn.click();
          }
        }
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

          if (
            this.ratingSync &&
            this.ratingSync.isSelfWrite(file.path)
          ) {
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

        // Auto-sync callout from frontmatter (debounced 1200ms)
        if (!this.calloutSyncTimers) {
          this.calloutSyncTimers = new Map();
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
      "打开动画仪表盘",
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
    if (this.settings.ratingMonitorEnabled === false) {
      return {
        skipped: true,
        reason: "自动更新已关闭"
      };
    }

    return await this.ratingSync.start({
      forceRefresh: false,
      mode: "standard"
    });
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
    const preciseEnabled =
      this.settings.showBangumiPreciseScore === true ||
      this.settings.dashboardShowPreciseRank === true;

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

    if (
      !manual &&
      this.settings.ratingMonitorEnabled === false
    ) {
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
    const base = this.getDefaultManagerFolderPath();
    const oldPath = base + "/动画评分仪表盘.md";
    if (this.app && this.app.vault) {
      const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (oldFile) {
        return oldPath;
      }
    }
    return base + "/动画仪表盘.md";
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
      "# 动画仪表盘",
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

      const bgmLink = cleanValue(parsed.fields.BGM链接);
      const subjectId = bangumiApi.getSubjectId(bgmLink);

      result.push({
        file,
        name: cleanValue(
          parsed.fields.中文名
        ) || file.basename,
        japaneseName: cleanValue(parsed.fields.日文名),
        cover: cleanValue(parsed.fields.cover),
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
            subjectId
          ] || parsed.fields.BGM精确评分
        ),
        year: cleanValue(parsed.fields.开播年份),
        season: cleanValue(parsed.fields.开播季度),
        tags: rawTags,
        totalEpisodes: cleanValue(parsed.fields.总集数),
        watchedEpisodes: extractWatchedEpisodes(content),
        bgmUrl: bgmLink,
        subjectId: subjectId,
        animeType: cleanValue(parsed.fields.改编类型),
        studio: cleanValue(parsed.fields.制作公司),
        director: cleanValue(parsed.fields.监督),
        downloadPath: cleanValue(parsed.fields.下载路径),
        localUpdateStatus: cleanValue(parsed.fields.本地更新状态),
        netabaUrl: cleanValue(parsed.fields.Netaba链接)
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

  renderRankListRows(
    listContainer,
    items,
    scoreKey,
    secondaryKey,
    limit
  ) {
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

          const leaf =
            this.app.workspace.getLeaf(true);

          await leaf.openFile(item.file);
        };

        const scoreValue = item[scoreKey];

        const scoreEl = titleRow.createDiv({
          text: scoreValue.toFixed(1),
          cls: "bangumi-dashboard-score"
        });

        if (scoreKey === "personalScore") {
          scoreEl.addClass("is-interactive");
          scoreEl.title = "点击修改个人评分";
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

    this.renderRankListRows(list, items, scoreKey, secondaryKey, limit);
  }

  renderPreciseRankListRows(
    listContainer,
    items,
    limit
  ) {
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

        bar.style.width =
          item.preciseScore / 10 * 100 + "%";
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

    this.renderPreciseRankListRows(list, items, limit);
  }

  renderDistributionBars(
    chartContainer,
    items
  ) {
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
      chartContainer.createEl("p", {
        text: "填写“我的评分”后会显示评分分布。",
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

  createDashboardDistribution(container, items) {
    const section = container.createDiv(
      "bangumi-dashboard-section"
    );

    section.createEl("h2", {
      text: "我的评分分布"
    });

    this.renderDistributionBars(section, items);
  }

  renderWatchStateCards(
    gridContainer,
    items
  ) {
    const states = [
      "已看",
      "在看",
      "想看",
      "抛弃"
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
      text: "观看状态"
    });

    this.renderWatchStateCards(section, items);
  }

  renderProgressStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无动画记录。"
      });
      return;
    }

    const stateCounts = {
      "已看": 0,
      "在看": 0,
      "想看": 0,
      "抛弃": 0,
      "未设置": 0
    };

    let totalWatchedEpisodes = 0;
    let totalPlannedEpisodes = 0;

    for (const item of items) {
      const state = item.state && stateCounts.hasOwnProperty(item.state) ? item.state : "未设置";
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

    const completionRate = items.length > 0
      ? Math.round((stateCounts["已看"] / items.length) * 100)
      : 0;

    // 1. KPI 概览卡片
    const statGrid = container.createDiv("bangumi-analytics-stat-grid");

    const epCard = statGrid.createDiv("bangumi-analytics-stat-card");
    epCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "累计观看话数" });
    epCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${totalWatchedEpisodes} 话` });
    if (totalPlannedEpisodes > 0) {
      epCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `总规划 ${totalPlannedEpisodes} 话` });
    }

    const timeCard = statGrid.createDiv("bangumi-analytics-stat-card");
    timeCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "投入追番时长" });
    timeCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${hours} 小时` });
    timeCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `约 ${days} 天 (按24分/话估算)` });

    const stateCard = statGrid.createDiv("bangumi-analytics-stat-card");
    stateCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "观看状态概览" });
    stateCard.createDiv({
      cls: "bangumi-analytics-stat-value",
      text: `${stateCounts["在看"]} 在看 / ${stateCounts["已看"]} 已看`
    });
    stateCard.createDiv({
      cls: "bangumi-analytics-stat-sub",
      text: `${stateCounts["想看"]} 想看 · ${stateCounts["抛弃"]} 抛弃`
    });

    const rateCard = statGrid.createDiv("bangumi-analytics-stat-card");
    rateCard.createDiv({ cls: "bangumi-analytics-stat-label", text: "动画完结率" });
    rateCard.createDiv({ cls: "bangumi-analytics-stat-value", text: `${completionRate}%` });
    rateCard.createDiv({ cls: "bangumi-analytics-stat-sub", text: `已看 ${stateCounts["已看"]} / 总收录 ${items.length} 部` });

    // 2. 彩带堆叠进度条
    const barWrap = container.createDiv("bangumi-stacked-bar-wrap");
    barWrap.createDiv({ cls: "bangumi-stacked-bar-title", text: "追番状态分布带" });

    const stackedBar = barWrap.createDiv("bangumi-stacked-bar");
    const legendWrap = barWrap.createDiv("bangumi-stacked-legend");

    const statesConfig = [
      { key: "已看", color: "var(--color-green, #28a745)", label: "已看" },
      { key: "在看", color: "var(--interactive-accent)", label: "在看" },
      { key: "想看", color: "var(--color-orange, #ff9900)", label: "想看" },
      { key: "抛弃", color: "var(--text-muted, #6c757d)", label: "抛弃" },
      { key: "未设置", color: "var(--background-modifier-border, #888888)", label: "未设置" }
    ];

    statesConfig.forEach((cfg) => {
      const count = stateCounts[cfg.key] || 0;
      if (count > 0) {
        const pct = ((count / items.length) * 100).toFixed(1);
        const seg = stackedBar.createDiv("bangumi-stacked-segment");
        seg.style.width = `${pct}%`;
        seg.style.backgroundColor = cfg.color;
        seg.title = `${cfg.label}: ${count} 部 (${pct}%)`;

        const itemEl = legendWrap.createDiv("bangumi-stacked-legend-item");
        const dot = itemEl.createSpan("bangumi-legend-dot");
        dot.style.backgroundColor = cfg.color;
        itemEl.createSpan({ text: `${cfg.label} ${count} 部 (${pct}%)` });
      }
    });
  }

  renderYearStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无动画记录。"
      });
      return;
    }

    const yearCounts = {};
    const seasonCounts = {
      "冬季番 (1月)": 0,
      "春季番 (4月)": 0,
      "夏季番 (7月)": 0,
      "秋季番 (10月)": 0,
      "其他/未知": 0
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
        seasonCounts["冬季番 (1月)"]++;
      } else if (/4月|春季|春/i.test(seasonStr)) {
        seasonCounts["春季番 (4月)"]++;
      } else if (/7月|夏季|夏/i.test(seasonStr)) {
        seasonCounts["夏季番 (7月)"]++;
      } else if (/10月|秋季|秋/i.test(seasonStr)) {
        seasonCounts["秋季番 (10月)"]++;
      } else {
        seasonCounts["其他/未知"]++;
      }
    }

    const sortedYears = Object.keys(yearCounts).sort((a, b) => Number(a) - Number(b));

    // 1. 年代分布直方柱状图
    const chartWrap = container.createDiv("bangumi-year-chart-wrap");
    chartWrap.createDiv({ cls: "bangumi-year-chart-title", text: "开播年份收录分布" });

    if (sortedYears.length > 0) {
      let maxCount = 1;
      for (const y of sortedYears) {
        if (yearCounts[y] > maxCount) maxCount = yearCounts[y];
      }

      const chart = chartWrap.createDiv("bangumi-year-chart");
      const displayYears = sortedYears.length > 14 ? sortedYears.slice(-14) : sortedYears;

      displayYears.forEach((year) => {
        const count = yearCounts[year];
        const heightPct = Math.max(12, Math.round((count / maxCount) * 85));

        const col = chart.createDiv("bangumi-year-col");
        col.title = `${year}年：收录 ${count} 部`;

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
        text: "暂无年份信息（笔记中未填写“开播年份”）。"
      });
    }

    // 2. 四季番分布卡片
    const seasonWrap = container.createDiv("bangumi-season-wrap");
    seasonWrap.createDiv({ cls: "bangumi-season-title", text: "番季分布" });

    const seasonGrid = seasonWrap.createDiv("bangumi-season-grid");
    const seasonIcons = {
      "冬季番 (1月)": "❄️",
      "春季番 (4月)": "🌸",
      "夏季番 (7月)": "☀️",
      "秋季番 (10月)": "🍁"
    };

    ["冬季番 (1月)", "春季番 (4月)", "夏季番 (7月)", "秋季番 (10月)"].forEach((seasonName) => {
      const c = seasonCounts[seasonName] || 0;
      const card = seasonGrid.createDiv("bangumi-season-card");
      card.createDiv({
        cls: "bangumi-season-label",
        text: `${seasonIcons[seasonName]} ${seasonName}`
      });
      card.createDiv({
        cls: "bangumi-season-value",
        text: `${c} 部`
      });
    });
  }

  renderScoreDelta(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无动画记录。"
      });
      return;
    }

    const compared = [];
    for (const item of items) {
      if (item.personalScore !== null) {
        const bgm = item.bangumiScore !== null
          ? item.bangumiScore
          : (item.preciseScore !== null ? item.preciseScore : null);
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
        text: "暂无可对比的动画记录（需同时填写“我的评分”并同步“BGM评分”）。"
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
      deltaDesc = "✨ 粉丝偏好/宽容包容型：对作品包容度高，显著高于大众评分基准。";
      deltaBadgeClass = "is-generous";
    } else if (avgDelta > 0.1) {
      deltaDesc = "🌟 略高于大众：整体评价普遍略高于 Bangumi 大众基准。";
      deltaBadgeClass = "is-generous";
    } else if (avgDelta >= -0.1) {
      deltaDesc = "🎯 口碑严密契合：个人审美偏好与 Bangumi 大众评分基准高度一致。";
      deltaBadgeClass = "is-balanced";
    } else if (avgDelta > -0.5) {
      deltaDesc = "🔍 略严于大众：评分较为克制审慎，略低于大众均分。";
      deltaBadgeClass = "is-strict";
    } else {
      deltaDesc = "⚔️ 严格理性型：标准严苛，去滤镜直击核心，明显低于大众评分。";
      deltaBadgeClass = "is-strict";
    }

    // 1. KPI 概览卡片
    const summaryCard = container.createDiv("bangumi-score-delta-summary");
    const summaryTop = summaryCard.createDiv("bangumi-delta-summary-top");

    const statBox1 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox1.createDiv({ cls: "bangumi-delta-stat-label", text: "已对比动画数" });
    statBox1.createDiv({ cls: "bangumi-delta-stat-val", text: `${compared.length} 部` });

    const statBox2 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox2.createDiv({ cls: "bangumi-delta-stat-label", text: "个人对比均分" });
    statBox2.createDiv({ cls: "bangumi-delta-stat-val", text: avgPersonal.toFixed(1) });

    const statBox3 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox3.createDiv({ cls: "bangumi-delta-stat-label", text: "BGM对比均分" });
    statBox3.createDiv({ cls: "bangumi-delta-stat-val", text: avgBgm.toFixed(1) });

    const statBox4 = summaryTop.createDiv("bangumi-delta-stat-box");
    statBox4.createDiv({ cls: "bangumi-delta-stat-label", text: "平均评分差值 (Δ)" });
    const deltaStr = avgDelta > 0 ? `+${avgDelta.toFixed(2)}` : avgDelta.toFixed(2);
    statBox4.createDiv({ cls: "bangumi-delta-stat-val mod-accent", text: deltaStr });

    const summaryBottom = summaryCard.createDiv("bangumi-delta-summary-bottom");
    summaryBottom.createDiv({
      cls: `bangumi-delta-trait-badge ${deltaBadgeClass}`,
      text: deltaDesc
    });

    // 2. 偏爱榜 TOP 5 & 严苛榜 TOP 5
    const listsWrap = container.createDiv("bangumi-delta-lists-wrap");

    const favored = compared
      .filter((c) => c.delta > 0)
      .sort((a, b) => b.delta - a.delta || b.personal - a.personal)
      .slice(0, 5);

    const critical = compared
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta || a.personal - b.personal)
      .slice(0, 5);

    const renderDeltaList = (targetContainer, title, listItems, isFavored) => {
      const panel = targetContainer.createDiv("bangumi-delta-panel");
      panel.createDiv({
        cls: "bangumi-delta-panel-title",
        text: title
      });

      if (listItems.length === 0) {
        panel.createDiv({
          cls: "bangumi-dashboard-empty",
          text: isFavored ? "暂无个人评分显著高于大众的作品。" : "暂无个人评分显著低于大众的作品。"
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
          text: `我: ${c.personal.toFixed(1)}`
        });
        scoreCol.createSpan({
          cls: "bangumi-delta-bgm-score",
          text: `BGM: ${c.bgm.toFixed(1)}`
        });

        const badgeClass = isFavored ? "is-plus" : "is-minus";
        const deltaText = c.delta > 0 ? `+${c.delta.toFixed(1)}` : `${c.delta.toFixed(1)}`;
        row.createDiv({
          cls: `bangumi-delta-pill ${badgeClass}`,
          text: `Δ ${deltaText}`
        });
      });
    };

    renderDeltaList(listsWrap, "个人最偏爱作品 (我评高于大众 TOP 5)", favored, true);
    renderDeltaList(listsWrap, "个人最严苛作品 (我评低于大众 TOP 5)", critical, false);
  }

  renderStudioStats(container, items) {
    if (!items || items.length === 0) {
      container.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无动画记录。"
      });
      return;
    }

    const studioMap = new Map();
    const typeCounts = {
      "原创": 0,
      "漫画改": 0,
      "轻小说改": 0,
      "游戏改": 0,
      "其他": 0
    };

    for (const item of items) {
      // 制作公司
      if (item.studio) {
        const rawStudios = String(item.studio)
          .split(/[,;\/、&]+/)
          .map((s) => s.trim())
          .filter((s) => s && !/^(未知|无|暂无|-)$/i.test(s));

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

      // 改编类型
      const t = String(item.animeType || "").trim();
      if (/原创/i.test(t)) {
        typeCounts["原创"]++;
      } else if (/漫/i.test(t)) {
        typeCounts["漫画改"]++;
      } else if (/小|轻/i.test(t)) {
        typeCounts["轻小说改"]++;
      } else if (/游/i.test(t)) {
        typeCounts["游戏改"]++;
      } else if (t) {
        typeCounts["其他"]++;
      }
    }

    const wrap = container.createDiv("bangumi-studio-type-wrap");

    // 1. 制作公司榜单
    const studioSection = wrap.createDiv("bangumi-studio-section");
    studioSection.createDiv({
      cls: "bangumi-analytics-sub-title",
      text: "动画制作公司收录排行 (TOP 8)"
    });

    const sortedStudios = Array.from(studioMap.entries())
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 8);

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
          text: `${data.count} 部`
        });

        if (data.personalScores.length > 0) {
          const avg = (data.personalScores.reduce((a, b) => a + b, 0) / data.personalScores.length).toFixed(1);
          row.createDiv({
            cls: "bangumi-studio-score-badge",
            text: `均分 ${avg}`
          });
        }
      });
    } else {
      studioSection.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无制作公司信息（笔记中未填写“制作公司”）。"
      });
    }

    // 2. 改编类型分布
    const typeSection = wrap.createDiv("bangumi-type-section");
    typeSection.createDiv({
      cls: "bangumi-analytics-sub-title",
      text: "原作改编类型分布"
    });

    const totalTyped = Object.values(typeCounts).reduce((a, b) => a + b, 0);

    if (totalTyped > 0) {
      const typeList = typeSection.createDiv("bangumi-type-list");
      const typeKeys = ["原创", "漫画改", "轻小说改", "游戏改", "其他"];

      typeKeys.forEach((key) => {
        const count = typeCounts[key] || 0;
        const pct = Math.round((count / totalTyped) * 100);

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
          text: `${count} 部 (${pct}%)`
        });
      });
    } else {
      typeSection.createDiv({
        cls: "bangumi-dashboard-empty",
        text: "暂无改编类型信息（笔记中未填写“改编类型”）。"
      });
    }
  }

  getCoverResourceUrl(coverPath, sourcePath = "") {
    if (!coverPath) {
      return "";
    }

    let cleanPath = String(coverPath)
      .trim()
      .replace(/^!\[\[|\]\]$/g, "")
      .replace(/^\[\[|\]\]$/g, "");

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

    if (
      this.app &&
      this.app.vault &&
      this.app.vault.adapter &&
      typeof this.app.vault.adapter.getResourcePath === "function"
    ) {
      try {
        return this.app.vault.adapter.getResourcePath(cleanPath);
      } catch (e) {
        // ignore
      }
    }

    return cleanPath;
  }

  filterCustomQueryItems(items, config) {
    if (!Array.isArray(items) || !config) {
      return [];
    }

    const targetTag = String(config.tag || "")
      .trim()
      .replace(/^#/, "")
      .toLowerCase();
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

      if (targetStatus && targetStatus !== "all" && targetStatus !== "全部") {
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
        const score = item.bangumiScore !== null
          ? item.bangumiScore
          : (item.preciseScore !== null ? item.preciseScore : null);
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
          const scoreA = a.bangumiScore !== null ? a.bangumiScore : (a.preciseScore !== null ? a.preciseScore : -1);
          const scoreB = b.bangumiScore !== null ? b.bangumiScore : (b.preciseScore !== null ? b.preciseScore : -1);
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
        text: "暂无符合筛选条件的动画记录。"
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

      // 1. 观看状态徽章（点击弹出菜单直接切换状态）
      const currentState = item.state || "未设置";
      const stateBadge = posterWrap.createDiv({
        cls: `bangumi-grid-state-badge is-${currentState} is-interactive`,
        text: currentState
      });
      stateBadge.title = "点击快速切换观看状态";
      stateBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };

      // 2. 评分徽章（点击弹出打分菜单）
      let scoreBadgeText = "";
      if (item.personalScore !== null) {
        scoreBadgeText = `★ ${item.personalScore.toFixed(1)}`;
      } else if (item.bangumiScore !== null) {
        scoreBadgeText = `BGM ${item.bangumiScore.toFixed(1)}`;
      } else if (item.preciseScore !== null) {
        scoreBadgeText = `BGM ${item.preciseScore.toFixed(1)}`;
      } else {
        scoreBadgeText = "★ 评分";
      }

      const scoreBadge = posterWrap.createDiv({
        cls: "bangumi-grid-score-badge is-interactive",
        text: scoreBadgeText
      });
      scoreBadge.title = "点击快速打分 / 修改个人评分";
      scoreBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };

      // 封面海报
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

      // 3. 追番轻量微操作条（方案 A：微操作条常驻海报底部，[-1]、话数点击、[+1]）
      const epBar = posterWrap.createDiv("bangumi-grid-ep-bar");

      const btnDec = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-dec",
        text: "−"
      });
      btnDec.title = "已看集数 -1";
      btnDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice(`《${item.name}》已看集数调整为：${next} 话`);
        }
      };

      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== undefined ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`;

      const epLabel = epBar.createDiv({
        cls: "bangumi-grid-ep-label",
        text: epLabelText
      });
      epLabel.title = "点击直接输入观看集数";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };

      const btnInc = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-inc",
        text: "+"
      });
      btnInc.title = "已看集数 +1";
      btnInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        const updates = { watchedEpisodes: next };
        let msg = `《${item.name}》已看集数递增至：${next} 话`;
        await this.quickUpdateAnimeNote(item, updates);
        new Notice(msg);
      };

      const btnTrend = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-trend",
        text: "📈"
      });
      btnTrend.title = "查看 Netaba 播出期间评分趋势与个人评分对比";
      btnTrend.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!item.subjectId) {
          new Notice("该动画未关联有效的 Bangumi 编号，无法获取 Netaba 趋势。");
          return;
        }
        new NetabaTrendModal(this.app, this, item).open();
      };

      // 4. 信息区
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
        text: metaParts.join(" · ") || " "
      });

      // 本地视频追番深度联动
      if (item.downloadPath && item.downloadPath !== "\u65E0") {
        const localResult = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
        if (localResult && !localResult.error && localResult.fileCount > 0) {
          const localBar = info.createDiv("bangumi-grid-local-bar");
          const capsule = localBar.createSpan({
            cls: `bangumi-local-capsule ${localResult.newCount > 0 ? "has-new" : "is-synced"}`,
            text: localResult.newCount > 0
              ? `📁 本地 +${localResult.newCount}话`
              : `📁 本地 ${localResult.fileCount}话`
          });
          capsule.title = `本地视频共 ${localResult.fileCount} 话（路径：${item.downloadPath}）。点击在系统文件夹中打开。`;
          capsule.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };

          if (localResult.nextEpisodeFile) {
            const nextEpNum = localResult.nextEpisodeNumber || (Number(item.watchedEpisodes || 0) + 1);
            const playBtn = localBar.createEl("button", {
              cls: "bangumi-local-action-btn is-play",
              text: `▶ 第${nextEpNum}话`
            });
            playBtn.title = `调用系统默认播放器打开第 ${nextEpNum} 话`;
            playBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const ok = await openLocalPathSafely(localResult.nextEpisodeFile);
              if (ok) {
                const noticeEl = document.createElement("div");
                noticeEl.innerHTML = `<div>已调用播放器打开<strong>第 ${nextEpNum} 话</strong>。</div><div style="margin-top:6px;display:flex;gap:6px;"><button class="mod-cta" id="bgm-quick-advance-ep">标记已看至第 ${nextEpNum} 话</button></div>`;
                const n = new Notice(noticeEl, 12000);
                const advBtn = noticeEl.querySelector("#bgm-quick-advance-ep");
                if (advBtn) {
                  advBtn.onclick = async () => {
                    n.hide();
                    await this.quickUpdateAnimeNote(item, { watchedEpisodes: nextEpNum });
                    new Notice(`《${item.name}》已更新为观看至第 ${nextEpNum} 话`);
                  };
                }
              }
            };
          }

          const folderBtn = localBar.createEl("button", {
            cls: "bangumi-local-action-btn is-folder",
            text: "📂"
          });
          folderBtn.title = `打开本地视频所在文件夹\n${item.downloadPath}`;
          folderBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
        }
      }

      // 5. 标签栏（支持点击删除、快速打标）
      const tagsRow = info.createDiv("bangumi-grid-tags-row");
      const tagTokens = String(item.tags || "")
        .split(/[,;\s#\[\]"']+/)
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== "bangumi");

      tagTokens.forEach((tag) => {
        const chip = tagsRow.createDiv("bangumi-grid-tag-chip");
        chip.createSpan({ text: `#${tag}` });
        const delBtn = chip.createSpan({
          cls: "bangumi-grid-tag-del",
          text: "×"
        });
        delBtn.title = `移除标签 #${tag}`;
        delBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.quickUpdateAnimeNote(item, { removeTag: tag });
          new Notice(`已从《${item.name}》移除标签 #${tag}`);
        };
      });

      const addTagBtn = tagsRow.createEl("button", {
        cls: "bangumi-grid-add-tag-btn",
        text: "+"
      });
      addTagBtn.title = "添加标签";
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
      text: "🎬"
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
        text: "暂无符合筛选条件的动画记录。"
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

      const primaryScore = item[primaryKey] !== null
        ? item[primaryKey]
        : (isBgmSort && item.preciseScore !== null ? item.preciseScore : null);

      const scoreEl = titleRow.createDiv({
        text: primaryScore !== null ? primaryScore.toFixed(1) : "未评分",
        cls: `bangumi-dashboard-score ${primaryScore === null ? "bangumi-dashboard-score-none" : ""}`
      });

      if (!isBgmSort) {
        scoreEl.addClass("is-interactive");
        scoreEl.title = "点击快速打分 / 修改个人评分";
        scoreEl.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openScoreMenu(e, item);
        };
      }

      if (primaryScore !== null) {
        const track = content.createDiv("bangumi-dashboard-bar-track");
        const bar = track.createDiv("bangumi-dashboard-bar");
        bar.style.width = Math.min(100, Math.max(0, (primaryScore / 10) * 100)) + "%";
      }

      const metaRow = content.createDiv("bangumi-dashboard-rank-meta");

      // 交互式状态微标
      const statePill = metaRow.createSpan({
        cls: `bangumi-list-state-pill is-${item.state || "未设置"}`,
        text: item.state || "未设置"
      });
      statePill.title = "点击快速切换观看状态";
      statePill.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };

      // 集数微控组件
      const epControl = metaRow.createSpan("bangumi-list-ep-control");
      const btnListDec = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn is-dec",
        text: "−"
      });
      btnListDec.title = "已看集数 -1";
      btnListDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice(`《${item.name}》已看集数调整为：${next} 话`);
        }
      };

      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== undefined ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabel = epControl.createSpan({
        cls: "bangumi-list-ep-label",
        text: totalNum > 0 ? ` ${watched}/${totalNum}话 ` : ` ${watched}话 `
      });
      epLabel.title = "点击直接输入观看集数";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };

      const btnListInc = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn is-inc",
        text: "+"
      });
      btnListInc.title = "已看集数 +1";
      btnListInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        const updates = { watchedEpisodes: next };
        let msg = `《${item.name}》已看集数递增至：${next} 话`;
        await this.quickUpdateAnimeNote(item, updates);
        new Notice(msg);
      };

      const secondaryScore = item[secondaryKey] !== null
        ? item[secondaryKey]
        : (!isBgmSort && item.preciseScore !== null ? item.preciseScore : null);

      const metaParts = [];
      if (secondaryScore !== null) {
        metaParts.push((isBgmSort ? "我的评分：" : "BGM评分：") + secondaryScore.toFixed(1));
      } else {
        metaParts.push((isBgmSort ? "我的评分：" : "BGM评分：") + "未评分");
      }
      if (item.year || item.season) {
        metaParts.push([item.year, item.season].filter(Boolean).join(" "));
      }

      if (metaParts.length > 0) {
        metaRow.createSpan({
          text: " · " + metaParts.join(" · ")
        });
      }
    });
  }

  renderCollectionGrid(container, items, collectionConfig, dashboardContainer, dashboardOptions) {
    if (!items || items.length === 0) {
      const emptyDiv = container.createDiv({
        cls: "bangumi-dashboard-empty bangumi-collection-empty",
        text: "展柜内暂无动画。"
      });
      const addBtn = emptyDiv.createEl("button", {
        cls: "bangumi-collection-empty-add-btn",
        text: "+ 从动画库添加作品"
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
        if (sourceIdxStr !== "" && sourceIdxStr !== undefined) {
          const sourceIdx = Number(sourceIdxStr);
          const targetIdx = index;
          if (!isNaN(sourceIdx) && sourceIdx !== targetIdx && Array.isArray(collectionConfig.items)) {
            const [moved] = collectionConfig.items.splice(sourceIdx, 1);
            collectionConfig.items.splice(targetIdx, 0, moved);
            await this.saveSettings();
            if (dashboardContainer) {
              await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
            }
            new Notice(`已调整《${item.name}》在展柜中的位置。`);
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

      // 1. 观看状态徽章
      const currentState = item.state || "未设置";
      const stateBadge = posterWrap.createDiv({
        cls: `bangumi-grid-state-badge is-${currentState} is-interactive`,
        text: currentState
      });
      stateBadge.title = "点击快速切换观看状态";
      stateBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };

      // 2. 评分徽章
      let scoreBadgeText = "";
      if (item.personalScore !== null) {
        scoreBadgeText = `★ ${item.personalScore.toFixed(1)}`;
      } else if (item.bangumiScore !== null) {
        scoreBadgeText = `BGM ${item.bangumiScore.toFixed(1)}`;
      } else if (item.preciseScore !== null) {
        scoreBadgeText = `BGM ${item.preciseScore.toFixed(1)}`;
      } else {
        scoreBadgeText = "★ 评分";
      }

      const scoreBadge = posterWrap.createDiv({
        cls: "bangumi-grid-score-badge is-interactive",
        text: scoreBadgeText
      });
      scoreBadge.title = "点击快速打分 / 修改个人评分";
      scoreBadge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };

      // 封面海报
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

      // 3. 追番轻量微操作条
      const epBar = posterWrap.createDiv("bangumi-grid-ep-bar");
      const btnDec = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-dec",
        text: "−"
      });
      btnDec.title = "已看集数 -1";
      btnDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice(`《${item.name}》已看集数调整为：${next} 话`);
        }
      };

      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== undefined ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`;

      const epLabel = epBar.createDiv({
        cls: "bangumi-grid-ep-label",
        text: epLabelText
      });
      epLabel.title = "点击直接输入观看集数";
      epLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };

      const btnInc = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-inc",
        text: "+"
      });
      btnInc.title = "已看集数 +1";
      btnInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
        new Notice(`《${item.name}》已看集数递增至：${next} 话`);
      };

      const btnTrend = epBar.createEl("button", {
        cls: "bangumi-grid-ep-btn is-trend",
        text: "📈"
      });
      btnTrend.title = "查看 Netaba 播出期间评分趋势与个人评分对比";
      btnTrend.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!item.subjectId) {
          new Notice("该动画未关联有效的 Bangumi 编号，无法获取 Netaba 趋势。");
          return;
        }
        new NetabaTrendModal(this.app, this, item).open();
      };

      // 4. 信息区
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
        text: metaParts.join(" · ") || " "
      });

      // 本地视频追番深度联动
      if (item.downloadPath && item.downloadPath !== "\u65E0") {
        const localResult = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
        if (localResult && !localResult.error && localResult.fileCount > 0) {
          const localBar = info.createDiv("bangumi-grid-local-bar");
          const capsule = localBar.createSpan({
            cls: `bangumi-local-capsule ${localResult.newCount > 0 ? "has-new" : "is-synced"}`,
            text: localResult.newCount > 0
              ? `📁 本地 +${localResult.newCount}话`
              : `📁 本地 ${localResult.fileCount}话`
          });
          capsule.title = `本地视频共 ${localResult.fileCount} 话（路径：${item.downloadPath}）。点击在系统文件夹中打开。`;
          capsule.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };

          if (localResult.nextEpisodeFile) {
            const nextEpNum = localResult.nextEpisodeNumber || (Number(item.watchedEpisodes || 0) + 1);
            const playBtn = localBar.createEl("button", {
              cls: "bangumi-local-action-btn is-play",
              text: `▶ 第${nextEpNum}话`
            });
            playBtn.title = `调用系统默认播放器打开第 ${nextEpNum} 话`;
            playBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const ok = await openLocalPathSafely(localResult.nextEpisodeFile);
              if (ok) {
                const noticeEl = document.createElement("div");
                noticeEl.innerHTML = `<div>已调用播放器打开<strong>第 ${nextEpNum} 话</strong>。</div><div style="margin-top:6px;display:flex;gap:6px;"><button class="mod-cta" id="bgm-quick-advance-ep-compact">标记已看至第 ${nextEpNum} 话</button></div>`;
                const n = new Notice(noticeEl, 12000);
                const advBtn = noticeEl.querySelector("#bgm-quick-advance-ep-compact");
                if (advBtn) {
                  advBtn.onclick = async () => {
                    n.hide();
                    await this.quickUpdateAnimeNote(item, { watchedEpisodes: nextEpNum });
                    new Notice(`《${item.name}》已更新为观看至第 ${nextEpNum} 话`);
                  };
                }
              }
            };
          }

          const folderBtn = localBar.createEl("button", {
            cls: "bangumi-local-action-btn is-folder",
            text: "📂"
          });
          folderBtn.title = `打开本地视频所在文件夹\n${item.downloadPath}`;
          folderBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openLocalPathSafely(item.downloadPath);
          };
        }
      }

      // 5. 标签栏
      const tagsRow = info.createDiv("bangumi-grid-tags-row");
      const tagTokens = String(item.tags || "")
        .split(/[,;\s#\[\]"']+/)
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== "bangumi");

      tagTokens.forEach((tag) => {
        const chip = tagsRow.createDiv("bangumi-grid-tag-chip");
        chip.createSpan({ text: `#${tag}` });
        const delBtn = chip.createSpan({
          cls: "bangumi-grid-tag-del",
          text: "×"
        });
        delBtn.title = `移除标签 #${tag}`;
        delBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.quickUpdateAnimeNote(item, { removeTag: tag });
          new Notice(`已从《${item.name}》移除标签 #${tag}`);
        };
      });

      const addTagBtn = tagsRow.createEl("button", {
        cls: "bangumi-grid-add-tag-btn",
        text: "+"
      });
      addTagBtn.title = "添加标签";
      addTagBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new QuickAddTagModal(this.app, this, item).open();
      };

      // 6. 移出展柜按钮
      const shelfActionRow = info.createDiv("bangumi-grid-shelf-action-row");
      const removeBtn = shelfActionRow.createEl("button", {
        cls: "bangumi-grid-shelf-del-btn",
        text: "移出展柜"
      });
      removeBtn.title = `从展柜“${collectionConfig.title}”中移出《${item.name}》`;
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
          new Notice(`已将《${item.name}》移出展柜“${collectionConfig.title}”。`);
        }
      };
    });
  }

  renderCollectionList(container, items, collectionConfig, dashboardContainer, dashboardOptions) {
    if (!items || items.length === 0) {
      const emptyDiv = container.createDiv({
        cls: "bangumi-dashboard-empty bangumi-collection-empty",
        text: "展柜内暂无动画。"
      });
      const addBtn = emptyDiv.createEl("button", {
        cls: "bangumi-collection-empty-add-btn",
        text: "+ 从动画库添加作品"
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
        if (sourceIdxStr !== "" && sourceIdxStr !== undefined) {
          const sourceIdx = Number(sourceIdxStr);
          const targetIdx = index;
          if (!isNaN(sourceIdx) && sourceIdx !== targetIdx && Array.isArray(collectionConfig.items)) {
            const [moved] = collectionConfig.items.splice(sourceIdx, 1);
            collectionConfig.items.splice(targetIdx, 0, moved);
            await this.saveSettings();
            if (dashboardContainer) {
              await this.renderScoreDashboard(dashboardContainer, dashboardOptions);
            }
            new Notice(`已调整《${item.name}》在展柜中的位置。`);
          }
        }
      };

      const rankIndex = row.createDiv({
        cls: "bangumi-dashboard-rank-index",
        text: String(index + 1)
      });
      rankIndex.title = "拖拽可重新排序";
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
        scoreWrap.setText(`★ ${item.personalScore.toFixed(1)}`);
      } else if (item.bangumiScore !== null) {
        scoreWrap.setText(`BGM ${item.bangumiScore.toFixed(1)}`);
      } else {
        scoreWrap.setText("未评分");
        scoreWrap.addClass("bangumi-dashboard-score-none");
      }
      scoreWrap.title = "点击打分 / 修改评分";
      scoreWrap.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openScoreMenu(e, item);
      };

      const metaRow = content.createDiv("bangumi-dashboard-rank-meta");

      const statePill = metaRow.createSpan({
        cls: `bangumi-list-state-pill is-${item.state || "未设置"}`,
        text: item.state || "未设置"
      });
      statePill.title = "点击切换观看状态";
      statePill.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openStateMenu(e, item);
      };

      const epControl = metaRow.createSpan("bangumi-list-ep-control");
      const listDec = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn",
        text: "−"
      });
      listDec.title = "已看集数 -1";
      listDec.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        if (current > 0) {
          const next = current - 1;
          await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
          new Notice(`《${item.name}》已看集数调整为：${next} 话`);
        }
      };

      const watched = item.watchedEpisodes !== null && item.watchedEpisodes !== undefined ? Number(item.watchedEpisodes) : 0;
      const totalNum = Number(item.totalEpisodes);
      const epLabelText = totalNum > 0 ? `${watched}/${totalNum}话` : `${watched}话`;

      const listEpLabel = epControl.createSpan({
        cls: "bangumi-list-ep-label",
        text: epLabelText
      });
      listEpLabel.title = "点击直接输入观看集数";
      listEpLabel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new SetEpisodesModal(this.app, this, item).open();
      };

      const listInc = epControl.createEl("button", {
        cls: "bangumi-list-ep-btn",
        text: "+"
      });
      listInc.title = "已看集数 +1";
      listInc.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = Number(item.watchedEpisodes) || 0;
        const next = current + 1;
        await this.quickUpdateAnimeNote(item, { watchedEpisodes: next });
        new Notice(`《${item.name}》已看集数递增至：${next} 话`);
      };

      const metaParts = [];
      if (item.year || item.season) {
        metaParts.push([item.year, item.season].filter(Boolean).join(" "));
      }
      if (metaParts.length > 0) {
        metaRow.createSpan({
          text: " · " + metaParts.join(" · ")
        });
      }

      const removeBtn = metaRow.createEl("button", {
        cls: "bangumi-list-remove-btn",
        text: "移出展柜"
      });
      removeBtn.title = `从展柜“${collectionConfig.title}”中移出`;
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
          new Notice(`已将《${item.name}》移出展柜。`);
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
      new Notice(`已删除自定义分区“${section.title}”。`);
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
        new Notice(`已删除收藏展柜“${collectionConfig.title}”。`);
      },
      `确定要删除收藏展柜“${collectionConfig.title}”吗？展柜内的笔记不会受到任何影响，仅移除展柜展示。`
    ).open();
  }

  resolveCollectionItems(colConfig, allItems) {
    if (!colConfig || !Array.isArray(colConfig.items)) return [];
    const resolved = [];
    let settingsNeedSave = false;

    const pathMap = new Map();
    const subjectMap = new Map();
    const nameMap = new Map();

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
      this.saveSettings().catch((e) => console.error("保存展柜自愈路径失败:", e));
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
        if (!this.isPluginWritingNote) this.isPluginWritingNote = new Set();
        this.isPluginWritingNote.add(file.path);
        try {
          await this.app.vault.modify(file, synced);
        } finally {
          setTimeout(() => {
            if (this.isPluginWritingNote) {
              this.isPluginWritingNote.delete(file.path);
            }
          }, 1000);
        }
      }
    } catch (err) {
      console.error("自动同步动画信息卡失败:", err);
    }
  }

  async quickUpdateAnimeNote(item, updates) {
    if (!item || !item.file) return false;
    try {
      const file = item.file;
      const content = await this.app.vault.read(file);
      let newContent = content;

      if (updates.watchedEpisodes !== undefined) {
        newContent = updateWatchedEpisodes(newContent, updates.watchedEpisodes);
        const parsed = parseFrontmatter(newContent);
        if (parsed && parsed.fields && "已观看集数" in parsed.fields) {
          newContent = updateFrontmatterField(newContent, "已观看集数", String(updates.watchedEpisodes));
        }
      }

      if (updates.state !== undefined) {
        newContent = updateFrontmatterField(newContent, "观看状态", updates.state);
        newContent = updateCalloutTableRow(newContent, "观看状态", updates.state);
      }

      if (updates.score !== undefined) {
        const scoreStr = updates.score === null || updates.score === "未评分" ? "未评分" : String(updates.score);
        newContent = updateFrontmatterField(newContent, "我的评分", scoreStr);
        newContent = updateCalloutTableRow(newContent, "我的评分", scoreStr);
      }

      if (updates.addTag) {
        newContent = addNoteTag(newContent, updates.addTag);
      }

      if (updates.removeTag) {
        newContent = removeNoteTag(newContent, updates.removeTag);
      }

      if (newContent !== content) {
        if (!this.isPluginWritingNote) this.isPluginWritingNote = new Set();
        this.isPluginWritingNote.add(file.path);
        try {
          await this.app.vault.modify(file, newContent);
        } finally {
          setTimeout(() => {
            if (this.isPluginWritingNote) {
              this.isPluginWritingNote.delete(file.path);
            }
          }, 1000);
        }
      }

      if (updates.watchedEpisodes !== undefined) {
        item.watchedEpisodes = updates.watchedEpisodes;
      }
      if (updates.state !== undefined) {
        item.state = updates.state;
      }
      if (updates.score !== undefined) {
        item.personalScore = updates.score === null || updates.score === "未评分" ? null : Number(updates.score);
      }
      if (updates.addTag || updates.removeTag) {
        const parsedAfter = parseFrontmatter(newContent);
        if (parsedAfter) {
          item.tags = cleanValue(parsedAfter.fields.tags);
        }
      }

      if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        try {
          const escapedPath = (CSS && typeof CSS.escape === "function")
            ? CSS.escape(file.path)
            : file.path.replace(/["\\]/g, "\\$&");
          const domNodes = document.querySelectorAll(`[data-file-path="${escapedPath}"]`);
          for (const node of domNodes) {
            if (updates.watchedEpisodes !== undefined) {
              const epLabel = node.querySelector(".bangumi-grid-ep-label, .bangumi-list-ep-label");
              if (epLabel) {
                const totalNum = Number(item.totalEpisodes);
                epLabel.textContent = totalNum > 0 ? `${updates.watchedEpisodes}/${totalNum}话` : `${updates.watchedEpisodes}话`;
              }
            }
            if (updates.state !== undefined) {
              const badge = node.querySelector(".bangumi-grid-state-badge, .bangumi-list-state-pill");
              if (badge) {
                badge.textContent = updates.state;
                badge.className = badge.className.replace(/is-\S+/g, "").trim() + ` is-${updates.state}`;
              }
            }
          }
        } catch (domErr) {
          // ignore
        }
      }

      await this.refreshOpenDashboardViews();
      return true;
    } catch (err) {
      console.error("[Bangumi Manager] 快捷修改动画笔记失败:", err);
      new Notice(`修改笔记失败: ${err.message}`);
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
      { id: "想看", icon: "bookmark" },
      { id: "在看", icon: "play" },
      { id: "已看", icon: "check-circle" },
      { id: "抛弃", icon: "x-circle" },
      { id: "未设置", icon: "minus" }
    ];

    states.forEach(({ id, icon }) => {
      menu.addItem((menuItem) => {
        menuItem
          .setTitle(id)
          .setIcon(icon)
          .setChecked(item.state === id)
          .onClick(async () => {
            if (item.state !== id) {
              await this.quickUpdateAnimeNote(item, { state: id });
              new Notice(`已将《${item.name}》状态切换为：${id}`);
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
      { score: 10, label: "10 分 (★★★★★ 极佳)" },
      { score: 9, label: "9 分 (★★★★☆ 优秀)" },
      { score: 8, label: "8 分 (★★★★ 推荐)" },
      { score: 7, label: "7 分 (★★★☆ 良好)" },
      { score: 6, label: "6 分 (★★★ 尚可)" },
      { score: 5, label: "5 分 (★★☆ 勉强)" },
      { score: 4, label: "4 分 (★★ 较差)" },
      { score: 3, label: "3 分 (★☆ 差)" },
      { score: 2, label: "2 分 (★ 很差)" },
      { score: 1, label: "1 分 (☆ 不忍直视)" }
    ];

    scores.forEach(({ score, label }) => {
      menu.addItem((menuItem) => {
        menuItem
          .setTitle(label)
          .setChecked(item.personalScore === score)
          .onClick(async () => {
            await this.quickUpdateAnimeNote(item, { score });
            new Notice(`已更新《${item.name}》个人评分为：${score} 分`);
          });
      });
    });

    menu.addSeparator();

    menu.addItem((menuItem) => {
      menuItem
        .setTitle("清除评分 (设为未评分)")
        .setIcon("trash-2")
        .setChecked(item.personalScore === null)
        .onClick(async () => {
          await this.quickUpdateAnimeNote(item, { score: "未评分" });
          new Notice(`已清除《${item.name}》个人评分`);
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
      cls:
        "bangumi-dashboard-section" +
        (hasData ? "" : " is-empty") +
        (isCollapsed ? " is-collapsed" : "") +
        (def.spanFull ? " span-full" : "")
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
      text: "⋮⋮"
    });
    dragHandle.title = "拖拽调整分区顺序";

    if (hasData) {
      const collapseBtn = leftEl.createSpan({
        cls: "bangumi-dashboard-collapse-btn",
        text: isCollapsed ? "▶" : "▼"
      });
      collapseBtn.title = isCollapsed ? "展开分区" : "折叠分区";
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
        text: "管理"
      });
      manageBtn.title = "管理展柜中的动画条目";
      manageBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onManage === "function") {
          onManage();
        }
      };

      const editBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "编辑"
      });
      editBtn.title = "编辑展柜标题与显示模式";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onEdit === "function") {
          onEdit();
        }
      };

      const deleteBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "删除"
      });
      deleteBtn.title = "删除此收藏展柜";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete();
        }
      };
    } else if (def.isCustom) {
      const editBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "编辑"
      });
      editBtn.title = "编辑此自定义查询分区";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onEdit === "function") {
          onEdit();
        }
      };

      const deleteBtn = rightEl.createEl("button", {
        cls: "bangumi-dashboard-action-btn",
        text: "删除"
      });
      deleteBtn.title = "删除此自定义查询分区";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof onDelete === "function") {
          onDelete();
        }
      };
    }

    const hideBtn = rightEl.createEl("button", {
      cls: "bangumi-dashboard-action-btn",
      text: "隐藏"
    });
    hideBtn.title = "隐藏此分区（可在底部或设置中恢复）";
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
    new Notice("已恢复动画仪表盘默认布局。");
  }

  getDashboardScrollParent(el) {
    if (!el) return null;
    let curr = el.parentElement;
    while (curr) {
      if (
        curr.classList &&
        (curr.classList.contains("bangumi-score-dashboard-view") ||
          curr.classList.contains("view-content") ||
          curr.classList.contains("markdown-preview-view") ||
          curr.classList.contains("cm-scroller"))
      ) {
        return curr;
      }
      try {
        if (typeof window !== "undefined" && window.getComputedStyle) {
          const style = window.getComputedStyle(curr);
          const overflowY = style.overflowY;
          if (
            (overflowY === "auto" || overflowY === "scroll") &&
            curr.scrollHeight > curr.clientHeight
          ) {
            return curr;
          }
        }
      } catch (e) {
        // ignore
      }
      curr = curr.parentElement;
    }
    return el.ownerDocument ? (el.ownerDocument.scrollingElement || el.ownerDocument.documentElement) : null;
  }

  async renderScoreDashboard(container, options = {}) {
    const scrollParent = this.getDashboardScrollParent(container);
    const savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;
    const prevHeight = (container.getBoundingClientRect && typeof container.getBoundingClientRect === "function")
      ? container.getBoundingClientRect().height
      : 0;
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

    const preciseItems = items
      .filter((item) => {
        return item.preciseScore !== null;
      })
      .sort((a, b) => {
        return b.preciseScore - a.preciseScore ||
          a.name.localeCompare(b.name, "zh-CN");
      });

    const scoredItems = items.filter(
      (item) => item.personalScore !== null
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

    const headerMain = header.createDiv("bangumi-dashboard-header-main");

    headerMain.createEl("h1", {
      text: "动画仪表盘"
    });

    headerMain.createDiv({
      text: "数据来自当前动画笔记；打开页面时自动重新统计。",
      cls: "bangumi-dashboard-subtitle"
    });

    const headerActions = header.createDiv("bangumi-dashboard-header-actions");
    const addQueryBtn = headerActions.createEl("button", {
      cls: "bangumi-dashboard-header-btn",
      text: "+ 新建查询分区"
    });

    addQueryBtn.onclick = () => {
      this.openCustomQuerySectionModal(null, async () => {
        await this.renderScoreDashboard(container, options);
      });
    };

    const addCollectionBtn = headerActions.createEl("button", {
      cls: "bangumi-dashboard-header-btn",
      text: "+ 新建收藏展柜"
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
        text: "提示：当前为 Markdown 嵌入模式。为避免实时预览光标干扰并获得最佳拖拽排版体验，推荐在"
      });

      text.createEl("strong", {
        text: "专属页面"
      });

      text.createSpan({
        text: "中打开。"
      });

      const actions = banner.createDiv(
        "bangumi-dashboard-compat-actions"
      );

      const openBtn = actions.createEl("button", {
        cls: "bangumi-dashboard-compat-btn",
        text: "打开专属仪表盘"
      });

      openBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.openScoreDashboardView();
      };

      const resetBtn = actions.createEl("button", {
        cls: "bangumi-dashboard-compat-reset-btn",
        text: "恢复默认布局"
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
        title: "我的评分排名",
        badgeText: personalItems.length ? `${personalItems.length} 部` : "",
        hasData: personalItems.length > 0,
        emptyText: "暂无可显示的评分记录（笔记未填写“我的评分”）",
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
        title: "BGM 用户评分排名",
        badgeText: bangumiItems.length ? `${bangumiItems.length} 部` : "",
        hasData: bangumiItems.length > 0,
        emptyText: "暂无可显示的评分记录",
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
        title: "BGM 精确评分排名",
        badgeText: preciseItems.length ? `${preciseItems.length} 部` : "",
        hasData: preciseItems.length > 0,
        emptyText: "暂无可显示的精确评分记录",
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
        title: "我的评分分布",
        badgeText: scoredItems.length ? `${scoredItems.length} 部` : "",
        hasData: scoredItems.length > 0,
        emptyText: "填写“我的评分”后会显示评分分布",
        spanFull: true,
        renderBody: (body) => {
          this.renderDistributionBars(body, items);
        }
      },
      {
        id: "watchState",
        title: "观看状态",
        badgeText: items.length ? `${items.length} 部` : "",
        hasData: items.length > 0,
        emptyText: "暂无观看状态记录",
        spanFull: true,
        renderBody: (body) => {
          this.renderWatchStateCards(body, items);
        }
      }
    ];

    const collectionConfigs = Array.isArray(this.settings.customCollectionSections)
      ? this.settings.customCollectionSections
      : [];

    const collectionSectionDefs = [];
    for (const colConfig of collectionConfigs) {
      const colItems = this.resolveCollectionItems(colConfig, items);
      collectionSectionDefs.push({
        id: `collection_${colConfig.id}`,
        title: colConfig.title || "自定义展柜",
        badgeText: colItems.length ? `${colItems.length} 部` : "",
        hasData: colItems.length > 0,
        emptyText: "展柜内暂无动画（点击右上角“管理”添加）",
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

    const customConfigs = Array.isArray(this.settings.customQuerySections)
      ? this.settings.customQuerySections
      : [];

    const customSectionDefs = [];
    for (const customConfig of customConfigs) {
      const filtered = this.filterCustomQueryItems(items, customConfig);
      const sorted = this.sortCustomQueryItems(filtered, customConfig.sortBy);
      const limit = Number(customConfig.limit) || 0;
      const displayItems = limit > 0 ? sorted.slice(0, limit) : sorted;

      customSectionDefs.push({
        id: customConfig.id,
        title: customConfig.title || "自定义查询",
        badgeText: filtered.length ? `${filtered.length} 部` : "",
        hasData: filtered.length > 0,
        emptyText: "暂无匹配的动画记录",
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
        title: "追番全景与时长统计",
        badgeText: items.length ? `${items.length} 部` : "",
        hasData: items.length > 0,
        emptyText: "暂无动画数据",
        spanFull: true,
        renderBody: (body) => {
          this.renderProgressStats(body, items);
        }
      },
      {
        id: "yearStats",
        title: "年代与番季分布",
        badgeText: items.some((it) => it.year) ? "年代统计" : "",
        hasData: items.some((it) => it.year),
        emptyText: "笔记中暂无开播年份或季度信息",
        spanFull: true,
        renderBody: (body) => {
          this.renderYearStats(body, items);
        }
      },
      {
        id: "scoreDelta",
        title: "评分差异与偏好分析",
        badgeText: items.some((it) => it.personalScore !== null && (it.bangumiScore !== null || it.preciseScore !== null)) ? "对比分析" : "",
        hasData: items.some((it) => it.personalScore !== null && (it.bangumiScore !== null || it.preciseScore !== null)),
        emptyText: "需要同时拥有“我的评分”与“BGM评分”方可进行对比分析",
        spanFull: true,
        renderBody: (body) => {
          this.renderScoreDelta(body, items);
        }
      },
      {
        id: "studioStats",
        title: "制作公司与改编类型",
        badgeText: items.some((it) => it.studio || it.animeType) ? "深度统计" : "",
        hasData: items.some((it) => it.studio || it.animeType),
        emptyText: "笔记中暂无制作公司或改编类型信息",
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
    )
      ? this.settings.dashboardSectionOrder.filter((id) =>
          sectionDefs.some((s) => s.id === id)
        )
      : [];

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

    const hiddenDefs = sectionDefs.filter((s) =>
      isSectionHidden(s.id)
    );

    const sectionsContainer = container.createDiv(
      "bangumi-dashboard-sections"
    );

    const collapsedMap =
      this.settings.dashboardSectionCollapsed || {};

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
          new Notice(
            `已隐藏“${def.title}”分区。可在底部或设置中恢复。`
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
            new Notice("已更新分区排序。");
          }
        },
        onManage: def.isCollection
          ? async () => {
              this.openCollectionItemsManagerModal(def.collectionConfig, async () => {
                await this.renderScoreDashboard(container, options);
              });
            }
          : null,
        onEdit: def.isCollection
          ? async () => {
              this.openCustomCollectionModal(def.collectionConfig, async () => {
                await this.renderScoreDashboard(container, options);
              });
            }
          : (def.isCustom
            ? async () => {
                this.openCustomQuerySectionModal(def.config, async () => {
                  await this.renderScoreDashboard(container, options);
                });
              }
            : null),
        onDelete: def.isCollection
          ? async () => {
              this.confirmDeleteCustomCollection(def.collectionConfig, async () => {
                await this.renderScoreDashboard(container, options);
              });
            }
          : (def.isCustom
            ? async () => {
                this.confirmDeleteCustomQuerySection(def.config, async () => {
                  await this.renderScoreDashboard(container, options);
                });
              }
            : null)
      });
    }

    if (hiddenDefs.length > 0) {
      const restoreBar = container.createDiv(
        "bangumi-dashboard-restore-bar"
      );

      restoreBar.createSpan({
        text: "已隐藏分区："
      });

      for (const hDef of hiddenDefs) {
        const chip = restoreBar.createEl("button", {
          cls: "bangumi-dashboard-restore-chip",
          text: `+ 恢复 ${hDef.title}`
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
          new Notice(`已恢复显示“${hDef.title}”分区。`);
        };
      }

      const resetBtn = restoreBar.createEl("button", {
        cls: "bangumi-dashboard-restore-chip bangumi-dashboard-restore-all",
        text: "恢复默认布局"
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
    if (typeof document === "undefined") {
      return;
    }
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
      ".bangumi-grid-state-badge.is-已看{background:rgba(40,167,69,.85);}",
      ".bangumi-grid-state-badge.is-在看{background:rgba(0,123,255,.85);}",
      ".bangumi-grid-state-badge.is-想看{background:rgba(255,153,0,.85);}",
      ".bangumi-grid-state-badge.is-抛弃{background:rgba(108,117,125,.85);}",
      ".bangumi-grid-state-badge.is-未设置{background:rgba(80,80,80,.75);}",
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
      ".bangumi-grid-ep-btn.is-trend{margin-left:auto;background:rgba(0,123,255,0.12);color:var(--interactive-accent);border:1px solid rgba(0,123,255,0.25);font-size:.78em;padding:2px 6px;}",
      ".bangumi-3d-wrapper{width:100%;height:100%;min-height:640px;position:relative;}",
      ".bangumi-3d-root{--rl-bg:#eae5e1;--rl-surface:rgba(245,243,238,0.94);--rl-surface-hover:#e4d5c1;--rl-border:#c8c4b8;--rl-text:#1a1a1a;--rl-text-muted:#666257;--rl-accent:#d49b35;--rl-active-bg:#1a1a1a;--rl-active-text:#ffffff;--rl-card-bg:#ffffff;--rl-card-border:#ddd8ce;--rl-shadow:0 16px 36px rgba(0,0,0,0.08);color:var(--rl-text);}",
      ".bangumi-3d-root.theme-dark-space{--rl-bg:#14161a;--rl-surface:rgba(24,27,33,0.94);--rl-surface-hover:rgba(255,255,255,0.12);--rl-border:rgba(255,255,255,0.16);--rl-text:#f0ede6;--rl-text-muted:#9aa0a6;--rl-accent:#d49b35;--rl-active-bg:#ffffff;--rl-active-text:#111111;--rl-card-bg:rgba(30,34,42,0.9);--rl-card-border:rgba(255,255,255,0.1);--rl-shadow:0 16px 36px rgba(0,0,0,0.45);color:var(--rl-text);}",
      ".bangumi-3d-toolbar{position:absolute;top:12px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;z-index:20;pointer-events:none;}",
      ".toolbar-section-left,.toolbar-section-right{display:flex;align-items:center;gap:8px;pointer-events:auto;flex-wrap:wrap;}",
      ".bangumi-3d-btn{background:var(--rl-surface);backdrop-filter:blur(8px);border:1px solid var(--rl-border);color:var(--rl-text);padding:5px 12px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease;line-height:1.4;}",
      ".bangumi-3d-btn:hover{background:var(--rl-surface-hover);color:var(--rl-text);border-color:var(--rl-accent);}",
      ".bangumi-3d-btn.is-active{background:var(--rl-active-bg);color:var(--rl-active-text);border-color:var(--rl-active-bg);}",
      ".bangumi-3d-btn.is-active::after{content:'';width:5px;height:5px;background:var(--rl-accent);border-radius:50%;display:inline-block;}",
      ".bangumi-3d-title-badge{font-size:11px;font-weight:700;letter-spacing:1.5px;padding:5px 12px;border-radius:4px;background:var(--rl-surface);color:var(--rl-text);border:1px solid var(--rl-border);display:inline-flex;align-items:center;gap:6px;backdrop-filter:blur(8px);}",
      ".bangumi-3d-title-badge i{font-style:normal;color:var(--rl-accent);}",
      ".bangumi-3d-select{background:var(--rl-surface);backdrop-filter:blur(8px);border:1px solid var(--rl-border);color:var(--rl-text);padding:4px 10px;border-radius:4px;font-size:12px;font-weight:500;outline:none;cursor:pointer;}",
      ".bangumi-3d-select option{background:var(--rl-bg);color:var(--rl-text);}",
      ".bangumi-3d-perf-group{display:flex;background:var(--rl-surface);backdrop-filter:blur(8px);border:1px solid var(--rl-border);border-radius:4px;overflow:hidden;padding:2px;gap:2px;}",
      ".bangumi-perf-btn{background:transparent;border:0;color:var(--rl-text-muted);font-size:11px;font-weight:600;padding:3px 9px;cursor:pointer;border-radius:3px;transition:all .15s ease;}",
      ".bangumi-perf-btn:hover{color:var(--rl-text);}",
      ".bangumi-perf-btn.is-active{background:var(--rl-active-bg);color:var(--rl-active-text);}",
      ".bangumi-perf-btn.is-active::after{content:'';width:4px;height:4px;background:var(--rl-accent);border-radius:50%;display:inline-block;margin-left:4px;vertical-align:middle;}",
      ".bangumi-3d-status-pill{position:absolute;bottom:14px;right:18px;font-size:11px;font-weight:500;padding:4px 12px;border-radius:999px;background:var(--rl-surface);backdrop-filter:blur(6px);border:1px solid var(--rl-border);color:var(--rl-text-muted);z-index:20;pointer-events:none;transition:all .2s ease;}",
      ".bangumi-3d-status-pill.is-sleeping{color:var(--rl-accent);border-color:rgba(212,155,53,0.4);font-weight:600;}",
      ".bangumi-3d-hud-panel{position:absolute;top:64px;right:24px;width:440px;max-width:calc(100% - 48px);max-height:calc(100% - 84px);overflow-y:auto;background:var(--rl-surface);backdrop-filter:blur(16px);border:1px solid var(--rl-border);box-shadow:var(--rl-shadow);border-radius:8px;padding:20px;pointer-events:auto;color:var(--rl-text);z-index:25;animation:hudFadeIn .22s cubic-bezier(0.16,1,0.3,1);}",
      "@keyframes hudFadeIn{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}",
      ".hud-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px;}",
      ".hud-eyebrow{font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--rl-accent);text-transform:uppercase;margin-bottom:4px;}",
      ".hud-title{font-size:18px;font-weight:700;line-height:1.3;color:var(--rl-text);margin:0;}",
      ".hud-sub{font-size:12px;color:var(--rl-text-muted);margin-bottom:12px;line-height:1.4;}",
      ".hud-score-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}",
      ".hud-pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;border:1px solid transparent;}",
      ".hud-pill.is-personal{background:rgba(212,155,53,0.15);color:var(--rl-accent);border-color:rgba(212,155,53,0.35);}",
      ".hud-pill.is-bgm{background:rgba(0,123,255,0.12);color:#007bff;border-color:rgba(0,123,255,0.25);}",
      ".hud-pill.is-state{background:var(--rl-surface-hover);color:var(--rl-text);border-color:var(--rl-border);}",
      ".hud-progress-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:10px 0;border-top:1px solid var(--rl-border);border-bottom:1px solid var(--rl-border);}",
      ".hud-ep-label{font-size:13px;font-weight:600;color:var(--rl-text);}",
      ".hud-action-btn{font-size:12px;font-weight:600;padding:4px 10px;border-radius:4px;cursor:pointer;background:var(--rl-surface);border:1px solid var(--rl-border);color:var(--rl-text);transition:all .15s ease;display:inline-flex;align-items:center;gap:4px;}",
      ".hud-action-btn:hover{background:var(--rl-surface-hover);border-color:var(--rl-accent);}",
      ".hud-action-btn.is-primary{background:var(--rl-active-bg);color:var(--rl-active-text);border-color:var(--rl-active-bg);}",
      ".hud-action-btn.is-primary:hover{filter:brightness(1.15);}",
      ".hud-local-bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}",
      ".hud-trend-box{margin:14px 0;background:var(--rl-card-bg);border:1px solid var(--rl-card-border);border-radius:6px;padding:10px;overflow:hidden;}",
      ".hud-footer-actions{display:flex;gap:8px;margin-top:14px;}",
      ".hud-close-btn{flex:1;font-size:12px;font-weight:600;padding:6px 0;border-radius:4px;cursor:pointer;background:var(--rl-surface);border:1px solid var(--rl-border);color:var(--rl-text-muted);transition:all .15s ease;text-align:center;}",
      ".hud-close-btn:hover{background:var(--rl-surface-hover);color:var(--rl-text);}",
      ".bangumi-3d-explode-hud{position:absolute;inset:0;pointer-events:none;z-index:22;}",
      ".explode-parts-sidebar{position:absolute;left:24px;top:72px;width:240px;background:var(--rl-surface);backdrop-filter:blur(16px);border:1px solid var(--rl-border);box-shadow:var(--rl-shadow);border-radius:8px;padding:16px;pointer-events:auto;}",
      ".explode-parts-title{font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--rl-accent);margin-bottom:10px;text-transform:uppercase;}",
      ".explode-part-item{display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--rl-card-border);font-size:12px;}",
      ".explode-part-item:last-child{border-bottom:none;}",
      ".explode-part-num{font-weight:700;color:var(--rl-accent);margin-right:8px;font-family:monospace;}",
      ".explode-part-label{font-weight:600;color:var(--rl-text);flex:1;}",
      ".explode-part-en{font-size:10px;color:var(--rl-text-muted);font-family:monospace;}",
      ".explode-bottom-bar{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:var(--rl-surface);backdrop-filter:blur(16px);border:1px solid var(--rl-border);box-shadow:var(--rl-shadow);border-radius:30px;padding:6px 18px;pointer-events:auto;}",
      ".explode-help-hint{font-size:11px;color:var(--rl-text-muted);display:flex;gap:12px;align-items:center;}"
    ].join("");

    document.head.appendChild(style);

    this.register(() => {
      style.remove();
    });
  }

  registerScoreDashboardProcessor() {
    this.registerMarkdownPostProcessor(
      async (element, context) => {
        const dashboards =
          element.querySelectorAll(
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
              name: "📈 原生趋势图"
            },
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

                if (page.key === "nativeTrend") {
                  const parsed = parseFrontmatter(content);
                  const sid = bangumiApi.getSubjectId(cleanValue(parsed?.fields?.BGM链接 || parsed?.fields?.Netaba链接));
                  if (!sid) {
                    new Notice("未找到该动画的有效 Bangumi 编号。");
                    return;
                  }
                  let nativeBox = element.querySelector(".bangumi-native-trend-container");
                  if (!nativeBox) {
                    nativeBox = document.createElement("div");
                    nativeBox.className = "bangumi-native-trend-container";
                    if (iframe && iframe.parentElement) {
                      iframe.parentElement.before(nativeBox);
                    } else {
                      element.appendChild(nativeBox);
                    }
                  }
                  if (iframe && iframe.parentElement) {
                    iframe.parentElement.style.display = "none";
                  }
                  nativeBox.style.display = "block";
                  nativeBox.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);">正在加载原生趋势图……</div>';
                  try {
                    const rawData = await netabaTrendService.fetchSubjectTrendData(this.app, sid);
                    const pScore = this.parseDashboardScore(parsed?.fields?.我的评分);
                    const normData = netabaTrendService.normalizeTrendData(rawData, pScore);
                    netabaTrendService.renderNativeTrendSvg(nativeBox, normData);
                    new Notice("已渲染原生轻量评分趋势图");
                  } catch (e) {
                    nativeBox.innerHTML = `<div style="padding:16px;color:var(--text-error);">加载原生趋势图失败: ${e.message}</div>`;
                  }
                  return;
                }

                // 切回其他 iframe 页面时隐藏原生趋势图并恢复 iframe
                const nativeBox = element.querySelector(".bangumi-native-trend-container");
                if (nativeBox) {
                  nativeBox.style.display = "none";
                }
                if (iframe && iframe.parentElement) {
                  iframe.parentElement.style.display = "";
                }

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

  async openBatchTagManager() {
    const items = await this.collectDashboardItems();
    if (!items || items.length === 0) {
      new Notice("没有找到带有 bangumi 标签的动画笔记。", 6000);
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
    contentEl.createEl("h3", { text: "确认删除" });
    contentEl.createEl("p", {
      text: this.customDesc || `确定要删除自定义分区“${this.sectionTitle}”吗？此操作仅移除分区配置，不会修改任何动画笔记或数据。`
    });

    const actions = contentEl.createDiv("bangumi-modal-actions");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "16px";

    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const confirmBtn = actions.createEl("button", {
      text: "删除",
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
      text: isEdit ? "编辑自定义查询分区" : "新建自定义查询分区"
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

    new Setting(contentEl)
      .setName("分区名称")
      .setDesc("为该查询分区起一个清晰的标题")
      .addText((text) => {
        text
          .setPlaceholder("如：我最喜爱的百合动画、2025在看佳作")
          .setValue(formData.title)
          .onChange((val) => {
            formData.title = val;
          });
      });

    new Setting(contentEl)
      .setName("标签筛选 (tags)")
      .setDesc("必须包含的标签，如“百合”或“原创”（留空表示不限标签）")
      .addText((text) => {
        text
          .setPlaceholder("如：百合（留空不限）")
          .setValue(formData.tag || "")
          .onChange((val) => {
            formData.tag = val;
          });
      });

    new Setting(contentEl)
      .setName("观看状态")
      .setDesc("按动画观看状态进行筛选")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("all", "全部")
          .addOption("想看", "想看")
          .addOption("在看", "在看")
          .addOption("已看", "已看")
          .addOption("抛弃", "抛弃")
          .setValue(formData.watchStatus || "all")
          .onChange((val) => {
            formData.watchStatus = val;
          });
      });

    new Setting(contentEl)
      .setName("个人评分下限")
      .setDesc("筛选“我的评分”达到指定分数的作品")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("0", "无限制")
          .addOption("6", "6 分以上")
          .addOption("7", "7 分以上")
          .addOption("8", "8 分以上")
          .addOption("9", "9 分以上")
          .setValue(String(formData.minMyScore || 0))
          .onChange((val) => {
            formData.minMyScore = Number(val) || 0;
          });
      });

    new Setting(contentEl)
      .setName("BGM 评分下限")
      .setDesc("筛选 Bangumi 评分达到指定分数的作品")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("0", "无限制")
          .addOption("6", "6 分以上")
          .addOption("7", "7 分以上")
          .addOption("7.5", "7.5 分以上")
          .addOption("8", "8 分以上")
          .setValue(String(formData.minBgmScore || 0))
          .onChange((val) => {
            formData.minBgmScore = Number(val) || 0;
          });
      });

    new Setting(contentEl)
      .setName("开播年份")
      .setDesc("指定四位年份（如 2025，留空表示不限年份）")
      .addText((text) => {
        text
          .setPlaceholder("如：2025（留空不限）")
          .setValue(formData.year || "")
          .onChange((val) => {
            formData.year = val;
          });
      });

    new Setting(contentEl)
      .setName("开播季度")
      .setDesc("指定开播季度（留空表示不限季度）")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("", "全部季度（留空不限）")
          .addOption("01月新番", "01月新番 (冬季)")
          .addOption("04月新番", "04月新番 (春季)")
          .addOption("07月新番", "07月新番 (夏季)")
          .addOption("10月新番", "10月新番 (秋季)")
          .setValue(formData.season || "")
          .onChange((val) => {
            formData.season = val;
          });
      });

    new Setting(contentEl)
      .setName("展示形态")
      .setDesc("选择分区在仪表盘上的展现方式")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("grid", "响应式封面海报网格 (Cover Grid)")
          .addOption("list", "紧凑榜单列表 (Compact List)")
          .setValue(formData.displayMode || "grid")
          .onChange((val) => {
            formData.displayMode = val;
          });
      });

    new Setting(contentEl)
      .setName("排序依据")
      .setDesc("选择分区内部作品的排序规则")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("myScore_desc", "按个人评分降序")
          .addOption("bgmScore_desc", "按 BGM 评分降序")
          .addOption("year_desc", "按开播年份降序")
          .addOption("title_asc", "按作品名称升序")
          .setValue(formData.sortBy || "myScore_desc")
          .onChange((val) => {
            formData.sortBy = val;
          });
      });

    new Setting(contentEl)
      .setName("显示数量上限")
      .setDesc("控制该分区最多显示的作品数量")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("6", "6 部")
          .addOption("12", "12 部")
          .addOption("18", "18 部")
          .addOption("24", "24 部")
          .addOption("0", "全部显示")
          .setValue(String(formData.limit !== undefined ? formData.limit : 12))
          .onChange((val) => {
            formData.limit = Number(val);
          });
      });

    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", {
      text: isEdit ? "保存修改" : "创建分区",
      cls: "mod-cta"
    });

    saveBtn.onclick = async () => {
      const cleanTitle = String(formData.title || "").trim();
      if (!cleanTitle) {
        new Notice("请输入分区名称！");
        return;
      }
      formData.title = cleanTitle;
      formData.tag = String(formData.tag || "").trim();
      formData.year = String(formData.year || "").trim();
      formData.season = String(formData.season || "").trim();

      const customSections = Array.isArray(this.plugin.settings.customQuerySections)
        ? [...this.plugin.settings.customQuerySections]
        : [];

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

      new Notice(isEdit ? `已更新分区“${formData.title}”。` : `已创建分区“${formData.title}”。`);
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
      text: isEdit ? "编辑收藏展柜" : "新建收藏展柜"
    });
    contentEl.createEl("p", {
      cls: "bangumi-modal-subtitle",
      text: "手动挑选并编排心爱作品的专属展柜，支持卡片拖拽重排与直观展出。"
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

    new Setting(contentEl)
      .setName("展柜名称")
      .setDesc("为您的收藏展柜起一个优雅的名字")
      .addText((text) => {
        text
          .setPlaceholder("如：年度十佳、神作殿堂、二次元启蒙...")
          .setValue(formData.title)
          .onChange((val) => {
            formData.title = val;
          });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new Setting(contentEl)
      .setName("展示形态")
      .setDesc("选择展柜在仪表盘上的展现方式")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("grid", "响应式封面海报网格 (Cover Grid)")
          .addOption("list", "紧凑榜单列表 (Compact List)")
          .setValue(formData.displayMode || "grid")
          .onChange((val) => {
            formData.displayMode = val;
          });
      });

    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "20px";

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", {
      text: isEdit ? "保存修改" : "创建展柜并挑选动画",
      cls: "mod-cta"
    });

    saveBtn.onclick = async () => {
      const cleanTitle = String(formData.title || "").trim();
      if (!cleanTitle) {
        new Notice("请输入展柜名称！");
        return;
      }
      formData.title = cleanTitle;

      const collections = Array.isArray(this.plugin.settings.customCollectionSections)
        ? [...this.plugin.settings.customCollectionSections]
        : [];

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

      new Notice(isEdit ? `已更新展柜“${formData.title}”。` : `已创建展柜“${formData.title}”。`);

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
    this.currentItems = Array.isArray(collectionConfig.items)
      ? [...collectionConfig.items]
      : [];
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.style.width = "min(860px, 94vw)";
    this.modalEl.style.maxWidth = "94vw";
    this.modalEl.style.maxHeight = "90vh";
    this.modalEl.style.overflowY = "auto";

    contentEl.createEl("h2", {
      text: `管理收藏展柜 - 《${this.collectionConfig.title}》`
    });
    contentEl.createEl("p", {
      cls: "bangumi-modal-subtitle",
      text: "从动画库中挑选动画收录至展柜，使用“↑ / ↓”微调展示顺序，或一键从展柜移出。"
    });

    this.allItems = await this.plugin.collectDashboardItems();

    const itemByPath = new Map();
    const itemBySubject = new Map();
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
      placeholder: "搜索动画库（标题、日文名、标签）..."
    });
    searchInput.style.flex = "1";
    searchInput.style.minWidth = "200px";

    const statusSelect = controlsRow.createEl("select");
    [
      { val: "all", text: "全部状态" },
      { val: "在看", text: "在看" },
      { val: "已看", text: "已看" },
      { val: "想看", text: "想看" },
      { val: "抛弃", text: "抛弃" }
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
        text: `已收录到展柜 (${this.currentItems.length} 部)`
      });
      leftList.empty();

      if (this.currentItems.length === 0) {
        leftList.createDiv({
          cls: "bangumi-collection-panel-empty",
          text: "展柜为空，请从右侧点击“+ 添加”加入作品。"
        });
      } else {
        this.currentItems.forEach((entry, idx) => {
          const entryPath = typeof entry === "string" ? entry : entry.path;
          const entrySubject = typeof entry === "object" ? entry.subjectId : null;
          const resolved = (entryPath && itemByPath.get(entryPath)) ||
            (entrySubject && itemBySubject.get(String(entrySubject))) ||
            null;

          const title = resolved ? resolved.name : (entry.name || entryPath || "未知动画");
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
            const btnUp = ops.createEl("button", { text: "↑", cls: "bangumi-manager-mini-btn" });
            btnUp.title = "上移";
            btnUp.onclick = () => {
              const temp = this.currentItems[idx - 1];
              this.currentItems[idx - 1] = this.currentItems[idx];
              this.currentItems[idx] = temp;
              renderPanels();
            };
          }

          if (idx < this.currentItems.length - 1) {
            const btnDown = ops.createEl("button", { text: "↓", cls: "bangumi-manager-mini-btn" });
            btnDown.title = "下移";
            btnDown.onclick = () => {
              const temp = this.currentItems[idx + 1];
              this.currentItems[idx + 1] = this.currentItems[idx];
              this.currentItems[idx] = temp;
              renderPanels();
            };
          }

          const btnDel = ops.createEl("button", { text: "×", cls: "bangumi-manager-mini-btn mod-warning" });
          btnDel.title = "从展柜移出";
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
        text: `动画库候选 (${candidates.length} 部)`
      });
      rightList.empty();

      if (candidates.length === 0) {
        rightList.createDiv({
          cls: "bangumi-collection-panel-empty",
          text: q ? "未搜索到匹配的动画。" : "所有符合条件的动画均已收录。"
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
            text: "+ 添加",
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
            text: "已显示前 50 部，更多作品请使用上方搜索框过滤。"
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

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", {
      text: "保存展柜编排",
      cls: "mod-cta"
    });

    saveBtn.onclick = async () => {
      this.collectionConfig.items = this.currentItems;

      const collections = Array.isArray(this.plugin.settings.customCollectionSections)
        ? [...this.plugin.settings.customCollectionSections]
        : [];
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
      new Notice(`已保存展柜“${this.collectionConfig.title}”的编排（共收录 ${this.currentItems.length} 部）。`);
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

    contentEl.createEl("h2", { text: "设置观看集数" });
    contentEl.createDiv({
      cls: "bangumi-modal-subtitle",
      text: `《${this.item.name}》`
    });

    const currentWatched = Number(this.item.watchedEpisodes) || 0;
    const total = Number(this.item.totalEpisodes) || 0;

    let targetCount = currentWatched;

    new Setting(contentEl)
      .setName("已观看集数")
      .setDesc(total > 0 ? `当前进度：${currentWatched} / ${total} 话` : `当前进度：${currentWatched} 话`)
      .addText((text) => {
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

    const btnPlus1 = shortcuts.createEl("button", { text: "+1 话" });
    btnPlus1.onclick = () => updateInputValue(targetCount + 1);

    const btnPlus2 = shortcuts.createEl("button", { text: "+2 话" });
    btnPlus2.onclick = () => updateInputValue(targetCount + 2);

    if (total > 0) {
      const btnAll = shortcuts.createEl("button", { text: `全看完 (${total}话)` });
      btnAll.onclick = () => updateInputValue(total);
    }

    const btnZero = shortcuts.createEl("button", { text: "重置为 0" });
    btnZero.onclick = () => updateInputValue(0);

    const footer = contentEl.createDiv("bangumi-modal-footer");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "8px";
    footer.style.marginTop = "24px";

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", {
      text: "保存进度",
      cls: "mod-cta"
    });

    saveBtn.onclick = async () => {
      const count = Math.max(0, parseInt(targetCount, 10) || 0);
      const updates = { watchedEpisodes: count };
      let noticeMsg = `《${this.item.name}》已看集数已更新为：${count} 话`;

      await this.plugin.quickUpdateAnimeNote(this.item, updates);
      this.close();
      if (typeof this.onSave === "function") {
        await this.onSave(count);
      }
      new Notice(noticeMsg);
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

    contentEl.createEl("h2", { text: "添加标签" });
    contentEl.createDiv({
      cls: "bangumi-modal-subtitle",
      text: `《${this.item.name}》`
    });

    let newTag = "";

    new Setting(contentEl)
      .setName("新标签名称")
      .setDesc("输入要添加的标签（支持以空格或逗号添加多个，如：百合 原创）")
      .addText((text) => {
        text.setPlaceholder("如：百合、萌系、硬核推理...");
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

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", {
      text: "添加标签",
      cls: "mod-cta"
    });

    const doSave = async () => {
      const clean = String(newTag || "").trim();
      if (!clean) {
        new Notice("请输入标签名称！");
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
      new Notice(`已为《${this.item.name}》添加标签：#${tags.join(" #")}`);
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
    this.selected = new Set();
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

    contentEl.createEl("h2", { text: "批量管理已有笔记中的标签" });
    contentEl.createEl("p", {
      cls: "bangumi-modal-desc",
      text: "批量为选中的动画笔记添加新标签，或从笔记中批量移除已有标签。根标签 #bangumi 受到严格保护，绝不会被意外移除。"
    });

    // 1. 操作类型设置
    new Setting(contentEl)
      .setName("操作类型")
      .setDesc("选择是为选中的动画笔记批量添加标签，还是批量移除已有标签")
      .addDropdown((dropdown) => {
        dropdown.addOption("add", "批量添加标签");
        dropdown.addOption("remove", "批量移除已有标签");
        dropdown.setValue(this.actionType);
        dropdown.onChange((val) => {
          this.actionType = val;
          updateActionDesc();
          updateSubmitBtn();
        });
      });

    // 2. 目标标签输入
    const tagSetting = new Setting(contentEl)
      .setName("目标标签")
      .setDesc("输入要批量添加的标签（支持以空格或逗号输入多个，如：热血 奇幻）")
      .addText((text) => {
        text.setPlaceholder("如：热血、奇幻、冷门佳作...");
        text.setValue(this.targetTag);
        text.onChange((val) => {
          this.targetTag = val;
        });
      });

    const updateActionDesc = () => {
      if (this.actionType === "add") {
        tagSetting.setDesc("输入要批量添加的标签（支持以空格或逗号输入多个，如：热血 奇幻）");
      } else {
        tagSetting.setDesc("输入要批量移除的标签（如：厕纸。保护根标签 bangumi）");
      }
    };

    // 3. 筛选栏
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
      placeholder: "搜索动画名称..."
    });
    searchInput.style.flex = "1";
    searchInput.style.minWidth = "160px";
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      renderList();
    };

    const statusSelect = filterSection.createEl("select");
    statusSelect.createEl("option", { text: "全部状态", value: "all" });
    for (const st of ["在看", "想看", "已看", "抛弃", "未设置"]) {
      statusSelect.createEl("option", { text: st, value: st });
    }
    statusSelect.onchange = (e) => {
      this.statusFilter = e.target.value;
      renderList();
    };

    const tagSelect = filterSection.createEl("select");
    tagSelect.createEl("option", { text: "全部现有标签", value: "all" });
    const allTags = new Set();
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

    // 4. 选择控制栏
    const controlBar = contentEl.createDiv();
    controlBar.style.display = "flex";
    controlBar.style.justifyContent = "space-between";
    controlBar.style.alignItems = "center";
    controlBar.style.margin = "8px 0";

    const btnGroup = controlBar.createDiv();
    const btnSelectAll = btnGroup.createEl("button", { text: "全选当前筛选结果" });
    btnSelectAll.style.marginRight = "8px";
    const btnDeselectAll = btnGroup.createEl("button", { text: "取消选择" });

    const countInfo = controlBar.createSpan({ cls: "bangumi-batch-counter" });
    countInfo.style.color = "var(--text-muted)";
    countInfo.style.fontSize = "13px";

    // 5. 笔记列表
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
      countInfo.textContent = `已选 ${this.selected.size} / 筛选出 ${filtered.length} 部（共 ${this.allItems.length} 部）`;
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
        const empty = listEl.createDiv({ text: "未找到匹配的动画笔记" });
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

        const stateClass = (this.plugin && typeof this.plugin.getWatchStateClass === "function")
          ? this.plugin.getWatchStateClass(it.state)
          : (it.state || "未设置");
        const stateBadge = row.createSpan({
          cls: `bangumi-grid-state-badge is-${stateClass}`,
          text: it.state || "未设置"
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

    // 6. 底部操作栏
    const footer = contentEl.createDiv();
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.marginTop = "12px";

    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();

    const submitBtn = footer.createEl("button", { cls: "mod-cta" });

    const updateSubmitBtn = () => {
      const count = this.selected.size;
      if (this.actionType === "add") {
        submitBtn.textContent = `批量添加标签（已选 ${count} 部）`;
      } else {
        submitBtn.textContent = `批量移除标签（已选 ${count} 部）`;
      }
    };

    submitBtn.onclick = async () => {
      const cleanTarget = String(this.targetTag || "").trim();
      if (!cleanTarget) {
        new Notice("请输入要操作的标签名称！");
        return;
      }
      if (this.selected.size === 0) {
        new Notice("请至少选择一部动画笔记！");
        return;
      }

      const tags = cleanTarget.split(/[,;\s#]+/).filter(Boolean);
      if (this.actionType === "remove") {
        const hasBangumi = tags.some((t) => t.toLowerCase() === "bangumi");
        if (hasBangumi) {
          new Notice("根标签 #bangumi 受到系统保护，不可移除！");
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "正在处理中...";

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
        const actionWord = this.actionType === "add" ? "添加" : "移除";
        new Notice(`已成功为 ${successCount} 部动画笔记${actionWord}标签：#${tags.join(" #")}`);
        await this.plugin.refreshOpenDashboardViews();
      } catch (err) {
        console.error("[Bangumi Manager] 批量管理标签失败:", err);
        new Notice(`批量处理失败: ${err.message}`);
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

