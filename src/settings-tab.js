const Modal = globalThis.__BangumiManagerModal;
const { setIcon, getIconIds, Notice } = require("obsidian");
const {
  resolveFfmpegExecutable,
  isPathInsideAnimeRoot,
  reconcileGameCollectionWithNotes,
  reconcileVoiceCollectionWithVault
} = require("./multi-hall-archive-service");
const {
  checkRoxyHdPortraitsStatus,
  downloadRoxyHdPortraitPack,
  normalizeRoxy2DModeSettings,
  resetRoxyGestureMemory
} = require("./roxy-mascot-service");
const reviewStudioService = require("./review-studio-service");
const multiSiteRatingService = require("./multisite-rating-service");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv,
  pluginAssetExists,
  getPluginAssetResourceUrl,
  pickNativeFolderOnDesktop,
  getNativeFilePathCrossPlatform
} = require("./platform-env");
const {
  updateFrontmatterField,
  updateFolderLine,
  syncNoteCalloutFromFrontmatter
} = require("./note-utils");
const bilibiliLiveService = require("./bilibili-live-service");
const {
  STYLE_CATALOG,
  checkAtelierHdPackStatus,
  downloadAtelierHdPack,
  removeAtelierHdPack,
  preloadAtelierHdPrototypes
} = require("./atelier-3d-pack-service");
let _cachedSettingsCapsuleService = null;
function getSettingsCapsuleService() {
  if (isMobileEnv()) return null;
  if (!_cachedSettingsCapsuleService) {
    _cachedSettingsCapsuleService = require("./game-floating-capsule-service");
  }
  return _cachedSettingsCapsuleService;
}

if (!Modal) {
  throw new Error("主插件没有传入 Modal。");
}

var ScoreDataRefreshPromptModal = class extends Modal {
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
      text: "更新评分数据"
    });

    contentEl.createEl("p", {
      text:
        "检测到 " +
        this.noteCount +
        " 篇 Bangumi 动画笔记。是否立即读取评分数据？"
    });

    const label = contentEl.createEl("label");
    label.style.display = "block";
    label.style.margin = "16px 0";

    const checkbox = label.createEl("input");
    checkbox.type = "checkbox";
    label.appendText(" 记住我的选择，以后不再询问");

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const laterButton = actions.createEl("button", {
      text: "稍后更新"
    });

    const updateButton = actions.createEl("button", {
      text: "立即更新"
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
}

class RatingSyncProgressModal extends Modal {
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

    if (
      this.plugin.ratingSync &&
      typeof this.plugin.ratingSync.subscribe === "function"
    ) {
      this.unsubscribe =
        this.plugin.ratingSync.subscribe(() => {
          this.render();
        });
    }
  }

  getTask() {
    return this.plugin.ratingSync
      ? this.plugin.ratingSync.getTask()
      : null;
  }

  render() {
    const task = this.getTask();
    const { contentEl } = this;

    contentEl.empty();

    contentEl.createEl("h2", {
      text: "评分同步进度"
    });

    if (!task) {
      contentEl.createEl("p", {
        text: "没有正在运行的评分同步任务。"
      });
      return;
    }

    contentEl.createEl("p", {
      text: task.phase || "正在准备"
    });

    const current = task.currentName
      ? "当前：" + task.currentName
      : "";

    if (current) {
      contentEl.createEl("p", {
        text: current
      });
    }

    const stats = [
      "扫描笔记：" + task.scanned,
      "详情请求：" + task.requested,
      "已完成：" + task.completed,
      "失败：" + task.failed,
      "超时：" + task.timedOut,
      "无数据：" + task.noData
    ];

    contentEl.createEl("p", {
      text: stats.join("，")
    });

    if (task.pauseRequested && task.running) {
      contentEl.createEl("p", {
        text: "已暂停后续请求，等待停止决定。"
      });
    } else if (task.stopRequested && task.running) {
      contentEl.createEl("p", {
        text: task.stopMode === "commit"
          ? "正在保存已获取结果并停止。"
          : "正在停止并放弃本次结果。"
      });
    }

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    if (task.running) {
      const stopButton = actions.createEl("button", {
        text: "停止同步"
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
        text: "关闭"
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

    if (
      task &&
      task.running &&
      !this.allowClose &&
      !this.closeRequested &&
      typeof this.onCloseRequest === "function"
    ) {
      this.closeRequested = true;
      this.onCloseRequest();
    }

    this.contentEl.empty();
  }
}

class RatingSyncCloseModal extends Modal {
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
      text: "关闭评分同步进度"
    });

    contentEl.createEl("p", {
      text: "同步任务仍在运行。请选择关闭窗口后的处理方式。"
    });

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const backgroundButton = actions.createEl("button", {
      text: "关闭窗口，后台继续"
    });

    const stopButton = actions.createEl("button", {
      text: "停止后续同步"
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
}

class RatingSyncStopModal extends Modal {
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
      text: "停止评分同步"
    });

    contentEl.createEl("p", {
      text: "停止后，已经取得的网络结果可以保存，也可以全部放弃。"
    });

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.style.justifyContent = "flex-end";

    const continueButton = actions.createEl("button", {
      text: "继续同步"
    });

    const saveButton = actions.createEl("button", {
      text: "保存已获取结果并停止"
    });

    const discardButton = actions.createEl("button", {
      text: "放弃本次结果并停止"
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
}

class PathMigrationStatusModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.unsubscribe = null;
  }

  onOpen() {
    this.render();
    if (this.plugin && typeof this.plugin.onPathMigrationChange === "function") {
      this.unsubscribe = this.plugin.onPathMigrationChange(() => {
        this.render();
      });
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.maxWidth = "640px";

    contentEl.createEl("h2", {
      text: "路径自动迁移状态"
    });

    const snap =
      this.plugin && typeof this.plugin.getPathMigrationSnapshot === "function"
        ? this.plugin.getPathMigrationSnapshot()
        : { status: "idle", logs: [] };

    const statusBadgeMap = {
      idle: { text: "空闲（尚未执行过迁移或等待路径变更）", color: "var(--text-muted)" },
      running: { text: "正在迁移中…", color: "#d9822b" },
      completed: { text: "✓ 迁移已完成", color: "#2e8b57" },
      failed: { text: "✕ 迁移失败", color: "#c94a4a" }
    };
    const badgeInfo = statusBadgeMap[snap.status] || statusBadgeMap.idle;

    const summaryBox = contentEl.createDiv();
    summaryBox.style.padding = "12px 14px";
    summaryBox.style.borderRadius = "8px";
    summaryBox.style.border = "1px solid var(--background-modifier-border)";
    summaryBox.style.background = "var(--background-secondary)";
    summaryBox.style.marginBottom = "12px";

    const stateLine = summaryBox.createDiv({
      text: `当前状态：${badgeInfo.text}`
    });
    stateLine.style.fontWeight = "700";
    stateLine.style.fontSize = "14px";
    stateLine.style.color = badgeInfo.color;
    stateLine.style.marginBottom = "6px";

    if (snap.categoryLabel || snap.oldPath || snap.newPath) {
      const routeLine = summaryBox.createDiv({
        text: `最近任务：${snap.categoryLabel || "目录迁移"} （${snap.oldPath || "—"}  →  ${snap.newPath || "—"}）`
      });
      routeLine.style.fontSize = "12.5px";
      routeLine.style.color = "var(--text-normal)";
      routeLine.style.marginBottom = "4px";
    }

    if (snap.status !== "idle") {
      const statsLine = summaryBox.createDiv({
        text: `进度：${snap.processed || 0} / ${snap.total || 0} 项 · 已移动文件：${snap.movedFiles || 0} 个 · 已更新笔记引用：${snap.updatedNotes || 0} 篇 · 失败：${snap.failed || 0} 个`
      });
      statsLine.style.fontSize = "12px";
      statsLine.style.color = "var(--text-muted)";

      if (snap.status === "running" && snap.total > 0) {
        const barOuter = summaryBox.createDiv();
        barOuter.style.height = "6px";
        barOuter.style.borderRadius = "999px";
        barOuter.style.background = "var(--background-modifier-border)";
        barOuter.style.marginTop = "8px";
        barOuter.style.overflow = "hidden";
        const barInner = barOuter.createDiv();
        const pct = Math.min(100, Math.round(((snap.processed || 0) / snap.total) * 100));
        barInner.style.width = `${pct}%`;
        barInner.style.height = "100%";
        barInner.style.background = "linear-gradient(90deg, #8f683d, #2e8b57)";
      }

      if (snap.currentItem) {
        const curLine = summaryBox.createDiv({
          text: `正在处理：${snap.currentItem}`
        });
        curLine.style.fontSize = "11.5px";
        curLine.style.color = "var(--text-muted)";
        curLine.style.marginTop = "6px";
      }

      if (snap.lastError) {
        const errLine = summaryBox.createDiv({
          text: `错误信息：${snap.lastError}`
        });
        errLine.style.fontSize = "12px";
        errLine.style.color = "#c94a4a";
        errLine.style.marginTop = "6px";
      }
    }

    const logs = Array.isArray(snap.logs) ? snap.logs : [];
    if (logs.length > 0) {
      contentEl.createEl("h4", {
        text: "最近迁移日志"
      }).style.margin = "10px 0 6px";
      const logBox = contentEl.createDiv();
      logBox.style.maxHeight = "220px";
      logBox.style.overflowY = "auto";
      logBox.style.padding = "8px 10px";
      logBox.style.borderRadius = "6px";
      logBox.style.border = "1px solid var(--background-modifier-border)";
      logBox.style.background = "var(--background-primary)";
      logBox.style.fontSize = "11.5px";
      logBox.style.lineHeight = "1.55";
      for (const entry of logs) {
        const row = logBox.createDiv();
        const timeStr = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "";
        row.textContent = `[${timeStr}] ${entry.text}`;
        if (entry.level === "error") row.style.color = "#c94a4a";
        else if (entry.level === "success") row.style.color = "#2e8b57";
        else row.style.color = "var(--text-muted)";
      }
    }

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.marginTop = "14px";
    const closeBtn = actions.createEl("button", { text: "关闭", cls: "mod-cta" });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.contentEl.empty();
  }
}

const PRESET_RIBBON_ICONS = [
  { id: "bangumi-archive-hall", label: "双翼档案册" },
  { id: "bangumi-tv-manager", label: "追番小电视" },
  { id: "book-open", label: "翻开书册" },
  { id: "library", label: "馆藏书架" },
  { id: "film", label: "胶片画格" },
  { id: "clapperboard", label: "场记板" },
  { id: "tv", label: "电视屏幕" },
  { id: "sparkles", label: "星芒策展" },
  { id: "layers", label: "多轨叠层" },
  { id: "compass", label: "导览罗盘" },
  { id: "palette", label: "原画调色" },
  { id: "folder-heart", label: "典藏夹" },
  { id: "crown", label: "殿堂王冠" },
  { id: "star", label: "星标精选" },
  { id: "box", label: "立体礼盒" },
  { id: "layout-grid", label: "展架网格" }
];

function renderSafeRibbonIcon(el, iconId, fallbackId) {
  if (!el) return;
  el.empty();
  if (typeof setIcon === "function") {
    try {
      setIcon(el, iconId);
    } catch (_) {}
    if (!el.childElementCount && fallbackId && fallbackId !== iconId) {
      try {
        setIcon(el, fallbackId);
      } catch (_) {}
    }
  }
  if (!el.childElementCount) {
    el.setText("✦");
  }
}

class RibbonIconPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.targetTitle = options.title || "侧边栏按钮";
    this.currentIcon = options.currentIcon || "";
    this.defaultIcon = options.defaultIcon || "bangumi-archive-hall";
    this.onSelect = options.onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("bgm-icon-picker-modal");
    contentEl.style.maxWidth = "640px";

    const topRow = contentEl.createDiv({ cls: "bgm-icon-picker-header" });
    const titleWrap = topRow.createDiv();
    titleWrap.createEl("h2", {
      text: "更换图标",
      cls: "bgm-icon-picker-title"
    });
    titleWrap.createDiv({
      text: this.targetTitle,
      cls: "bgm-icon-picker-subtitle"
    });

    const resetBtn = topRow.createEl("button", {
      text: "↺ 恢复默认图标"
    });
    resetBtn.onclick = async () => {
      if (typeof this.onSelect === "function") {
        await this.onSelect(this.defaultIcon);
      }
      this.close();
    };

    contentEl.createDiv({
      text: "专属与推荐图标",
      cls: "bgm-icon-picker-section-label"
    });

    const presetGrid = contentEl.createDiv({ cls: "bgm-icon-picker-preset-grid" });
    PRESET_RIBBON_ICONS.forEach((item) => {
      const btn = presetGrid.createEl("button", {
        type: "button",
        cls: `bgm-icon-picker-preset${this.currentIcon === item.id ? " is-active" : ""}`
      });
      btn.dataset.iconId = item.id;
      const iconBox = btn.createSpan({ cls: "bgm-icon-picker-svg" });
      renderSafeRibbonIcon(iconBox, item.id, this.defaultIcon);
      btn.createSpan({
        text: item.label,
        cls: "bgm-icon-picker-preset-name"
      });
      btn.onclick = async () => {
        if (typeof this.onSelect === "function") {
          await this.onSelect(item.id);
        }
        this.close();
      };
    });

    contentEl.createDiv({
      text: "Obsidian 图标库检索",
      cls: "bgm-icon-picker-section-label"
    });

    const searchInput = contentEl.createEl("input", {
      type: "search",
      cls: "bgm-icon-picker-search",
      placeholder: "输入英文关键词筛选图标（如 book、film、star、archive、heart）…"
    });

    const allIcons = (() => {
      try {
        const raw = typeof getIconIds === "function" ? getIconIds() : [];
        const list = Array.isArray(raw) ? raw.filter((id) => typeof id === "string" && id.trim()) : [];
        return Array.from(new Set(["bangumi-archive-hall", "bangumi-tv-manager", ...list]));
      } catch (_) {
        return PRESET_RIBBON_ICONS.map((p) => p.id);
      }
    })();

    const countHint = contentEl.createDiv({ cls: "bgm-icon-picker-count" });
    const libGrid = contentEl.createDiv({ cls: "bgm-icon-picker-grid" });

    const renderLibrary = () => {
      libGrid.empty();
      const q = String(searchInput.value || "").trim().toLowerCase();
      const matched = q
        ? allIcons.filter((id) => id.toLowerCase().includes(q))
        : allIcons;
      const slice = matched.slice(0, 96);
      countHint.setText(
        q
          ? `共匹配 ${matched.length} 个图标（展示前 ${slice.length} 个）`
          : `共 ${allIcons.length} 个可用图标（当前展示前 ${slice.length} 个，输入关键词可检索全部）`
      );

      slice.forEach((id) => {
        const cell = libGrid.createEl("button", {
          type: "button",
          cls: `bgm-icon-picker-cell${this.currentIcon === id ? " is-active" : ""}`
        });
        cell.title = id;
        cell.setAttribute("aria-label", id);
        cell.dataset.iconId = id;
        renderSafeRibbonIcon(cell, id, this.defaultIcon);
        cell.onclick = async () => {
          if (typeof this.onSelect === "function") {
            await this.onSelect(id);
          }
          this.close();
        };
      });
    };

    searchInput.addEventListener("input", renderLibrary);
    renderLibrary();
    setTimeout(() => searchInput.focus(), 30);
  }

  onClose() {
    this.contentEl.empty();
  }
}

function openRatingSyncProgress(plugin, app) {
  const existing = plugin.ratingSync &&
    plugin.ratingSync.getTask();

  if (existing && existing.running) {
    new RatingSyncProgressModal(
      app,
      plugin,
      () => {
        new RatingSyncCloseModal(
          app,
          plugin,
          () => {},
          () => {
            new RatingSyncStopModal(
              app,
              plugin,
              () => {
                new RatingSyncProgressModal(
                  app,
                  plugin,
                  () => {}
                ).open();
              },
              () => {
                new RatingSyncProgressModal(
                  app,
                  plugin,
                  () => {}
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
        () => {},
        () => {
          new RatingSyncStopModal(
            app,
            plugin,
            () => {
              new RatingSyncProgressModal(
                app,
                plugin,
                () => {}
              ).open();
            },
            () => {
              new RatingSyncProgressModal(
                app,
                plugin,
                () => {}
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
      10000
    );
  }).catch((error) => {
    console.error("评分同步失败:", error);

    new Notice(
      "评分同步失败，请查看控制台日志。",
      7000
    );
  });
}
module.exports = function createSettingsTabClass({
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  openSingleAnimeImport,
  openBatchAnimeImport,
  NetabaCompareSelectModal
}) {
  // 严格等价别名组：只放真正指代同一事物的别名/缩写，绝不把「视频 / 进度 / 快捷方式 / exe」这类泛词塞进双向大袋
  const SETTINGS_EXACT_ALIAS_GROUPS = [
    ["弹弹", "弹弹play", "dandan", "dandanplay"],
    ["potplayer", "pot"],
    ["播放器", "player", "bfq"],
    ["观片手札", "手札", "手记", "review", "gpsz"],
    ["洛琪希", "roxy", "lqx", "看板娘", "kbn"],
    ["qbittorrent", "qb"],
    ["漫猫", "comicat"],
    ["蜜柑", "mikan"],
    ["番剧档案馆", "档案馆", "dag"],
    ["3d展厅", "原画展厅", "3d原画展厅"],
    ["netaba", "评分图"],
    ["bangumi", "bgm"],
    ["anilist", "al"],
    ["myanimelist", "mal"],
    ["filmarks", "fm"],
    ["pixiv", "p站"],
    ["ffmpeg", "转码"],
    ["侧边胶囊", "手札胶囊", "桌面侧边手札胶囊", "capsule"],
    ["b站", "bilibili", "哔哩哔哩"],
    ["直播", "直播间", "开播"]
  ];

  // 单向精准功能词映射：输入具体软件或俗称时，仅向标题/控件中对应的窄功能词扩展，不反向扩散、不扫长段描述
  const SETTINGS_ONEWAY_INTENT_MAP = {
    "弹弹": ["播放器"],
    "弹弹play": ["播放器"],
    dandan: ["播放器"],
    dandanplay: ["播放器"],
    pot: ["播放器"],
    potplayer: ["播放器"],
    mpv: ["播放器"],
    vlc: ["播放器"],
    mpc: ["播放器"],
    "空降": ["播放器", "观片手札"],
    "时间码": ["播放器", "观片手札"],
    "时间点": ["播放器", "观片手札"],
    "蜜柑": ["追番下载", "下载搜索", "rss", "磁力", "自动追更"],
    mikan: ["追番下载", "下载搜索", "rss", "磁力", "自动追更"],
    "花园": ["追番下载", "下载搜索", "磁力"],
    dmhy: ["追番下载", "下载搜索", "磁力"],
    nyaa: ["追番下载", "下载搜索", "磁力"],
    "磁力": ["追番下载", "磁力", "自动追更", "qbittorrent"],
    magnet: ["追番下载", "磁力", "qbittorrent"],
    "种子": ["追番下载", "qbittorrent"],
    torrent: ["追番下载", "qbittorrent"],
    rss: ["追番下载", "rss", "自动追更"],
    bt: ["追番下载", "qbittorrent"],
    xz: ["下载", "追更"],
    zfxz: ["追番下载", "自动追更"],
    "抠图": ["角色典藏"],
    "身高": ["角色典藏"],
    "标尺": ["角色典藏"],
    "声优": ["角色典藏"],
    jsdc: ["角色典藏"],
    "皮肤": ["外观主题"],
    "主题": ["外观主题"],
    "晴空": ["外观主题"],
    "纸本": ["外观主题"],
    "柔光": ["外观主题"],
    "夜间": ["外观主题"],
    "文件夹": ["目录", "路径"],
    folder: ["目录", "路径"],
    path: ["目录", "路径"],
    dir: ["目录", "路径"],
    ml: ["目录"],
    lj: ["路径"],
    wjj: ["目录", "路径"],
    "评分": ["评分"],
    pf: ["评分"],
    pftb: ["评分同步", "评分数据"],
    "旧版": ["兼容升级", "旧版"],
    "快照": ["markdown 番剧档案馆"],
    "悬浮": ["桌面侧边手札胶囊", "侧边窄条"],
    "悬浮窗": ["桌面侧边手札胶囊", "侧边窄条"]
  };

  // 按用户常见需求跨章汇总（不改动原始页面章节结构）
  const SETTINGS_INTENT_GROUPS = [
    {
      key: "intent-play",
      label: "播放本地视频",
      hint: "本地动画目录、视频播放器联动、FFmpeg 与本地视频更新检查",
      match: (rec) => {
        const n = rec.origNameText || "";
        if (/季度视图策略/.test(n)) return false;
        return (
          rec.sectionTitle === "本地播放与状态检查" ||
          /本地动画根目录|新下载默认保存目录|本地视频关联|FFmpeg|本地视频播放器|自定义视频播放器|立即检查全部本地状态|观片手札图片目录/.test(n)
        );
      }
    },
    {
      key: "intent-download",
      label: "下载与自动追更",
      hint: "追番下载助手、漫猫检索、自动追更管理、qBittorrent 与新下载默认保存目录",
      match: (rec) => {
        const n = rec.origNameText || "";
        return rec.sectionTitle === "追番下载与自动追更" || /本地动画根目录|新下载默认保存目录/.test(n);
      }
    },
    {
      key: "intent-ratings",
      label: "评分与榜单同步",
      hint: "Bangumi ID、精确评分、国际四站评分源、同步间隔、Netaba 评分图与榜单数量",
      match: (rec) => {
        const n = rec.origNameText || "";
        return (
          rec.sectionTitle === "评分、排名与 Netaba" ||
          /综合评分排行榜默认显示数量|显示我的评分分布|显示评分差异与偏好分析/.test(n)
        );
      }
    },
    {
      key: "intent-appearance",
      label: "外观与洛琪希",
      hint: "番剧档案馆外观主题、3D 装帧模型、洛琪希记录员、侧边栏入口与布局",
      match: (rec) => {
        const n = rec.origNameText || "";
        return (
          rec.sectionTitle === "洛琪希与看板娘" ||
          /番剧档案馆外观主题|三维精装模型|三维装帧模型|显示侧边栏|恢复番剧档案馆默认布局|追番 · |侧边窄条/.test(n)
        );
      }
    },
    {
      key: "intent-folders",
      label: "目录与数据维护",
      hint: "全部仓库目录、跨设备自动识别、路径迁移、旧版笔记升级与批量维护",
      match: (rec) => {
        const n = rec.origNameText || "";
        return (
          rec.sectionTitle === "路径与目录" ||
          /兼容升级旧版动画笔记|初始化缺失文件|导入单个动画|批量导入动画|批量修改观看状态|补全已有番剧|季度视图|安全清理已完成季度|Markdown 番剧档案馆/.test(n)
        );
      }
    },
    {
      key: "intent-halls",
      label: "画册、游戏与直播",
      hint: "画册 Pixiv 搜图、3D 展厅模型、游戏侧边手札胶囊、角色与音声目录及 B 站直播监测",
      match: (rec) => {
        const n = rec.origNameText || "";
        return (
          rec.sectionTitle === "画册、3D、游戏与直播" ||
          /画册本地保存路径|游戏典藏笔记目录|游戏典藏封面目录|角色典藏|音声典藏/.test(n)
        );
      }
    }
  ];

  function isFuzzySubsequence(needle, haystack) {
    if (!needle || !haystack) return { matched: false, gapScore: 0 };
    if (needle.length > haystack.length) return { matched: false, gapScore: 0 };
    let nIdx = 0;
    let firstMatchIdx = -1;
    let lastMatchIdx = -1;
    for (let hIdx = 0; hIdx < haystack.length && nIdx < needle.length; hIdx++) {
      if (haystack[hIdx] === needle[nIdx]) {
        if (firstMatchIdx === -1) firstMatchIdx = hIdx;
        lastMatchIdx = hIdx;
        nIdx++;
      }
    }
    if (nIdx < needle.length) return { matched: false, gapScore: 0 };
    const span = Math.max(1, lastMatchIdx - firstMatchIdx + 1);
    if (needle.length === 2 && span > 5) return { matched: false, gapScore: 0 };
    const compactness = needle.length / span; // 越紧凑得分越高 (0..1]
    return { matched: true, gapScore: Math.round(compactness * 42) };
  }

  function scoreSettingFuzzyMatch(rawQuery, itemRecord) {
    const cleanQ = String(rawQuery || "").trim().toLowerCase();
    if (!cleanQ) return { matched: true, score: 100, matchedTokens: [] };

    const tokens = cleanQ.split(/\s+/).filter(Boolean);
    const nameLower = itemRecord.nameLower || "";
    const descLower = itemRecord.descLower || "";
    const secLower = itemRecord.sectionLower || "";
    const ctrlLower = itemRecord.ctrlLower || "";
    const directText = `${nameLower} ${descLower} ${ctrlLower}`;

    let totalScore = 0;
    const matchedTokens = [];

    for (const token of tokens) {
      let tokenScore = 0;

      // 1. 直接字面子串命中（标题权重最高，其次控件文案、描述说明、章节名）
      if (nameLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 120 + (nameLower.startsWith(token) ? 20 : 0));
        matchedTokens.push(token);
      } else if (ctrlLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 86);
        matchedTokens.push(token);
      } else if (descLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 74);
        matchedTokens.push(token);
      } else if (secLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 60);
        matchedTokens.push(token);
      }

      // 2. 严格等价别名匹配（仅当输入词与别名精确一致，或长度 >= 2 且英文前缀/中文全包含时）
      if (tokenScore === 0) {
        for (const group of SETTINGS_EXACT_ALIAS_GROUPS) {
          const hitAlias = group.some(
            (alias) => alias === token || (token.length >= 2 && alias.length >= 2 && (alias.startsWith(token) || token.includes(alias)))
          );
          if (hitAlias) {
            const targetHit = group.find((kw) => kw.length >= 2 && directText.includes(kw));
            if (targetHit) {
              tokenScore = Math.max(tokenScore, 70);
              matchedTokens.push(targetHit);
              break;
            }
          }
        }
      }

      // 3. 单向精准功能词映射（只匹配标题与控件文案，绝不扫描述段里的泛词）
      if (tokenScore === 0) {
        const mappedTargets = SETTINGS_ONEWAY_INTENT_MAP[token];
        if (Array.isArray(mappedTargets)) {
          const hitTarget = mappedTargets.find((kw) => nameLower.includes(kw) || ctrlLower.includes(kw));
          if (hitTarget) {
            tokenScore = Math.max(tokenScore, 64);
            matchedTokens.push(hitTarget);
          }
        }
      }

      // 4. 非连续字符模糊子序列匹配（仅限紧凑匹配设置项标题，例如「番档」→「番剧档案馆」，杜绝长描述误伤）
      if (tokenScore === 0 && token.length >= 2) {
        const subName = isFuzzySubsequence(token, nameLower);
        if (subName.matched && subName.gapScore >= 18) {
          tokenScore = Math.max(tokenScore, 40 + subName.gapScore);
          matchedTokens.push(token);
        }
      }

      if (tokenScore <= 0) {
        return { matched: false, score: 0, matchedTokens: [] };
      }
      totalScore += tokenScore;
    }

    return { matched: true, score: totalScore, matchedTokens: Array.from(new Set(matchedTokens)) };
  }

  function ensureSettingsSpotlightStyles(doc) {
    const targetDoc = doc || (typeof document !== "undefined" ? document : null);
    if (!targetDoc || !targetDoc.head) return;
    const STYLE_VER = "0.9.5-settings-ia-v2";
    let styleEl = targetDoc.getElementById("bangumi-settings-spotlight-styles");
    if (styleEl && styleEl.dataset.bgmVer === STYLE_VER) return;
    if (!styleEl) {
      styleEl = targetDoc.createElement("style");
      styleEl.id = "bangumi-settings-spotlight-styles";
      targetDoc.head.appendChild(styleEl);
    }
    styleEl.dataset.bgmVer = STYLE_VER;
    styleEl.textContent = [
      ".bgm-settings-sticky-hud{position:sticky;top:-18px;z-index:35;margin:-8px -8px 16px -8px;padding:12px 14px 10px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 92%, #f6efe3 8%);backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(28,20,12,0.09);display:flex;flex-direction:column;gap:9px;}",
      ".bgm-settings-hud-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".bgm-settings-hud-brand{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}",
      ".bgm-settings-hud-title{margin:0 !important;font-size:1.22em !important;font-weight:800 !important;color:var(--text-normal);}",
      ".bgm-settings-hud-mode-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;border:1px solid rgba(143,104,61,0.34);letter-spacing:0.04em;}",
      ".bgm-settings-spotlight-capsule{position:relative;display:flex;align-items:center;flex:1 1 290px;max-width:460px;min-width:220px;}",
      ".bgm-settings-spotlight-icon{position:absolute;left:10px;font-size:13px;color:#8f683d;pointer-events:none;display:inline-flex;align-items:center;}",
      ".bgm-settings-spotlight-input{width:100% !important;padding:6px 102px 6px 32px !important;font-size:12.5px !important;border-radius:999px !important;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border)) !important;background:var(--background-secondary) !important;color:var(--text-normal) !important;transition:all .16s ease !important;box-sizing:border-box !important;}",
      ".bgm-settings-spotlight-input:focus{border-color:#8f683d !important;background:var(--background-primary) !important;box-shadow:0 0 0 3px rgba(143,104,61,0.18) !important;}",
      ".bgm-settings-spotlight-meta{position:absolute;right:8px;display:inline-flex;align-items:center;gap:4px;}",
      ".bgm-settings-spotlight-count{font-size:10.5px;font-weight:700;padding:1.5px 7px;border-radius:999px;background:color-mix(in srgb, #8f683d 14%, var(--background-primary));color:#8f683d;pointer-events:none;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".bgm-settings-spotlight-clear{cursor:pointer;width:19px;height:19px;padding:0;border:none;border-radius:50%;background:rgba(143,104,61,0.16);color:#8f683d;font-size:12px;font-weight:800;display:none;align-items:center;justify-content:center;line-height:1;}",
      ".bgm-settings-spotlight-clear.is-visible{display:inline-flex;}",
      ".bgm-settings-spotlight-clear:hover{background:#8f683d;color:#fffdf9;}",
      ".bgm-settings-compass-rail{display:flex;flex-direction:column;gap:6px;padding-top:7px;border-top:1px dashed color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));}",
      ".bgm-settings-compass-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
      ".bgm-settings-compass-head-left{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}",
      ".bgm-settings-compass-subhint{font-size:11.5px;color:var(--text-muted);white-space:nowrap;}",
      ".bgm-settings-view-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:color-mix(in srgb, var(--text-normal) 6%, var(--background-secondary));border:1px solid color-mix(in srgb, #8f683d 20%, var(--background-modifier-border));flex:0 0 auto;}",
      ".bgm-settings-view-seg-btn{appearance:none !important;-webkit-appearance:none !important;box-shadow:none !important;border:none !important;background:transparent !important;height:24px !important;min-height:24px !important;padding:0 9px !important;border-radius:6px !important;font-size:12px !important;font-weight:600 !important;line-height:1 !important;color:var(--text-muted) !important;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease,box-shadow .15s ease;}",
      ".bgm-settings-view-seg-btn:hover{color:var(--text-normal) !important;}",
      ".bgm-settings-view-seg-btn.is-active{background:var(--background-primary) !important;color:var(--text-normal) !important;font-weight:700 !important;box-shadow:0 1px 4px rgba(24,18,12,0.12) !important;}",
      ".bgm-settings-compass-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0;}",
      ".bgm-settings-compass-chip{appearance:none !important;-webkit-appearance:none !important;box-shadow:none !important;height:auto !important;min-height:26px !important;cursor:pointer;display:inline-flex !important;align-items:center;gap:4px;padding:3px 10px !important;font-size:12px !important;font-weight:600;border-radius:999px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-secondary) !important;color:var(--text-muted) !important;transition:all .14s ease;flex:0 0 auto;white-space:nowrap;}",
      ".bgm-settings-compass-chip:hover{border-color:#8f683d !important;color:var(--text-normal) !important;transform:translateY(-1px);}",
      ".bgm-settings-compass-chip.is-active{background:linear-gradient(135deg,#8f683d,#b08450) !important;border-color:#8f683d !important;color:#fffdf9 !important;font-weight:700;box-shadow:0 2px 6px rgba(143,104,61,0.25) !important;}",
      ".bgm-settings-compass-chip-cnt{font-size:10.5px;opacity:0.82;font-variant-numeric:tabular-nums;}",
      ".bgm-settings-compass-mode-btn{appearance:none !important;-webkit-appearance:none !important;box-shadow:none !important;height:auto !important;min-height:26px !important;cursor:pointer;margin-left:auto;padding:2px 9px !important;font-size:11.5px !important;font-weight:600;border-radius:6px !important;border:1px dashed rgba(143,104,61,0.48) !important;background:transparent !important;color:#8f683d !important;transition:all .14s ease;flex:0 0 auto;white-space:nowrap;}",
      ".bgm-settings-compass-mode-btn.is-focus-only{border-style:solid !important;background:rgba(143,104,61,0.14) !important;}",
      ".bgm-settings-intent-bar{display:none;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:6px 10px;border-radius:8px;background:color-mix(in srgb, #8f683d 8%, var(--background-secondary));border:1px solid color-mix(in srgb, #8f683d 22%, var(--background-modifier-border));font-size:12px;color:var(--text-muted);line-height:1.45;}",
      ".bgm-settings-intent-bar.is-visible{display:flex;}",
      ".bgm-settings-intent-bar strong{color:var(--text-normal);font-weight:700;}",
      ".bgm-settings-intent-reset{appearance:none !important;-webkit-appearance:none !important;box-shadow:none !important;height:auto !important;min-height:24px !important;padding:2px 8px !important;border-radius:6px !important;border:1px solid color-mix(in srgb, #8f683d 34%, transparent) !important;background:transparent !important;color:#8f683d !important;font-size:12px !important;font-weight:600;cursor:pointer;white-space:nowrap;}",
      ".bgm-settings-intent-reset:hover{background:rgba(143,104,61,0.12) !important;}",
      ".bgm-settings-search-hidden{display:none !important;}",
      ".setting-item.is-bgm-search-match{border-left:3px solid #8f683d !important;padding-left:10px !important;background:color-mix(in srgb, #8f683d 5%, transparent);border-radius:6px;}",
      ".bgm-settings-root-container .setting-item .setting-item-name.has-bgm-crumb{display:flex;flex-wrap:wrap;align-items:center;gap:4px 7px;}",
      ".bgm-setting-section-crumb{display:inline-flex;align-items:center;margin-left:0;padding:1px 6px;font-size:11px;font-weight:600;border-radius:4px;background:rgba(143,104,61,0.12);color:#8f683d;border:1px solid rgba(143,104,61,0.28);line-height:1.35;}",
      "mark.bgm-setting-hit-mark{background:rgba(217,167,74,0.32);color:inherit;padding:0 2px;border-radius:3px;font-weight:700;}",
      "@keyframes bgmSectionSpotlightPulse{0%{background:rgba(217,167,74,0.28);}100%{background:transparent;}}",
      ".bgm-section-pulse-highlight{animation:bgmSectionSpotlightPulse 1.2s ease-out;border-radius:6px;}",
      ".bgm-settings-empty-search{padding:18px 16px;margin:12px 0;border-radius:10px;border:1px dashed color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f7efe2 28%);text-align:center;display:none;flex-direction:column;align-items:center;gap:8px;}",
      ".bgm-settings-empty-search.is-visible{display:flex;}",
      ".bgm-settings-empty-title{font-size:13px;font-weight:700;color:var(--text-normal);}",
      ".bgm-settings-empty-sub{font-size:11.5px;color:var(--text-muted);}",
      ".bgm-settings-empty-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:4px;}",
      ".bgm-settings-root-container .setting-item{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 16px;}",
      ".bgm-settings-root-container .setting-item > .setting-item-info{flex:1 1 280px;min-width:min(260px, 100%);margin-right:0;}",
      ".bgm-settings-root-container .setting-item .setting-item-name{word-break:break-word;overflow-wrap:anywhere;}",
      ".bgm-settings-root-container .setting-item .setting-item-description{word-break:break-word;overflow-wrap:anywhere;line-height:1.5;}",
      ".bgm-settings-root-container .setting-item > .setting-item-control{flex:0 1 auto;max-width:100%;flex-wrap:wrap;justify-content:flex-end;}",
      ".bgm-settings-root-container .setting-item > .setting-item-control select.dropdown{max-width:min(220px, 100%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".bgm-settings-root-container .setting-item.is-roxy-sub-disabled{opacity:0.5;filter:grayscale(0.35);pointer-events:none;}",
      ".bgm-guide-step-note{margin:4px 0 14px;padding:10px 14px;border-radius:8px;border-left:3px solid #8f683d;background:color-mix(in srgb, var(--background-secondary) 84%, #f6efe3 16%);font-size:12.6px;line-height:1.62;color:var(--text-muted);}",
      ".bgm-mobile-compat-banner{margin:10px 0 14px;padding:10px 12px;border-radius:9px;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 86%, #f6efe3 14%);font-size:12px;line-height:1.55;color:var(--text-muted);}",
      ".bgm-ribbon-inline-dock{display:inline-flex;align-items:center;padding:3px;border-radius:9px;background:var(--ribbon-background, var(--background-secondary-alt, var(--background-secondary)));border:1px solid var(--background-modifier-border);margin-right:6px;}",
      ".bgm-ribbon-inline-btn{width:34px !important;height:34px !important;min-width:34px !important;padding:0 !important;border-radius:7px !important;border:1px solid transparent !important;background:transparent !important;color:var(--icon-color, var(--text-muted)) !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;box-shadow:none !important;transition:background .14s ease, color .14s ease, border-color .14s ease, transform .14s ease !important;}",
      ".bgm-ribbon-inline-btn:hover{background:var(--background-modifier-hover) !important;color:var(--icon-color-hover, var(--text-normal)) !important;border-color:rgba(143,104,61,0.45) !important;transform:translateY(-1px);}",
      ".bgm-ribbon-inline-btn svg{width:18px !important;height:18px !important;}",
      ".bgm-guide-demo-drawer{margin:6px 0 18px;border-radius:10px;border:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:var(--background-secondary);overflow:hidden;}",
      ".bgm-guide-demo-summary{cursor:pointer;padding:10px 14px;font-size:12.8px;font-weight:700;color:var(--text-normal);user-select:none;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;}",
      ".bgm-guide-demo-summary::-webkit-details-marker{display:none;}",
      ".bgm-guide-demo-summary::after{content:'展开演示 ▾';font-size:11.5px;font-weight:600;color:#8f683d;flex:0 0 auto;}",
      ".bgm-guide-demo-drawer[open] .bgm-guide-demo-summary{border-bottom:1px solid var(--background-modifier-border);}",
      ".bgm-guide-demo-drawer[open] .bgm-guide-demo-summary::after{content:'收起演示 ▴';}",
      ".bgm-guide-demo-body{padding:12px 14px;display:flex;flex-direction:column;gap:14px;background:var(--background-primary);}",
      ".bgm-guide-demo-item{display:flex;flex-direction:column;gap:7px;}",
      ".bgm-guide-demo-caption{font-size:12px;line-height:1.55;color:var(--text-muted);}",
      ".bgm-guide-video-card{width:100%;max-width:780px;border-radius:9px;border:1px solid var(--background-modifier-border);overflow:hidden;background:var(--background-secondary);position:relative;}",
      ".bgm-guide-video-stage{position:relative;width:100%;background:#151311;cursor:pointer;line-height:0;}",
      ".bgm-guide-demo-video{width:100%;height:auto;display:block;background:#151311;}",
      ".bgm-guide-pause-pill{position:absolute;top:10px;right:10px;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:600;line-height:1.4;color:#fff8ee;background:rgba(24,20,16,0.76);backdrop-filter:blur(6px);border:1px solid rgba(214,178,110,0.45);pointer-events:none;opacity:0;transform:translateY(-3px);transition:opacity .16s ease, transform .16s ease;}",
      ".bgm-guide-video-stage.is-paused .bgm-guide-pause-pill{opacity:1;transform:translateY(0);}",
      ".bgm-guide-video-bar{display:flex;align-items:center;gap:10px;padding:6px 10px;background:color-mix(in srgb, var(--background-secondary) 90%, #f6efe3 10%);border-top:1px solid var(--background-modifier-border);font-size:11.5px;color:var(--text-muted);}",
      ".bgm-guide-video-toggle{padding:2px 9px !important;height:24px !important;font-size:11.5px !important;border-radius:6px !important;cursor:pointer !important;flex:0 0 auto;}",
      ".bgm-guide-video-scrubber{flex:1 1 auto;height:4px;accent-color:#8f683d;cursor:pointer;margin:0;}",
      ".bgm-guide-video-meta{font-variant-numeric:tabular-nums;font-size:11px;color:var(--text-muted);white-space:nowrap;flex:0 0 auto;}",
      ".bgm-guide-demo-img{width:100%;max-width:780px;height:auto;border-radius:8px;border:1px solid var(--background-modifier-border);display:block;background:var(--background-secondary);}",
      ".bgm-pro-upgrade-card{margin:20px 0 18px;padding:16px 18px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 86%, #f6efe3 14%);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;}",
      ".bgm-pro-upgrade-info{flex:1 1 360px;min-width:min(260px, 100%);}",
      ".bgm-pro-upgrade-title{font-size:14.5px;font-weight:700;color:var(--text-normal);margin-bottom:5px;}",
      ".bgm-pro-upgrade-desc{font-size:12.5px;line-height:1.6;color:var(--text-muted);}",
      ".bgm-icon-picker-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;}",
      ".bgm-icon-picker-title{margin:0 !important;font-size:1.2em !important;}",
      ".bgm-icon-picker-subtitle{font-size:12px;color:var(--text-muted);margin-top:3px;}",
      ".bgm-icon-picker-section-label{font-size:12px;font-weight:700;color:var(--text-muted);margin:12px 0 8px;}",
      ".bgm-icon-picker-preset-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(128px, 1fr));gap:7px;}",
      ".bgm-icon-picker-preset{display:flex !important;align-items:center !important;justify-content:flex-start !important;gap:8px;padding:7px 10px !important;height:auto !important;border-radius:8px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-secondary) !important;cursor:pointer;text-align:left;white-space:normal !important;}",
      ".bgm-icon-picker-preset:hover,.bgm-icon-picker-cell:hover{border-color:#8f683d !important;background:var(--background-modifier-hover) !important;}",
      ".bgm-icon-picker-preset.is-active,.bgm-icon-picker-cell.is-active{border-color:#8f683d !important;background:color-mix(in srgb, #8f683d 14%, var(--background-secondary)) !important;box-shadow:0 0 0 1px rgba(143,104,61,0.35);}",
      ".bgm-icon-picker-svg{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;}",
      ".bgm-icon-picker-svg svg,.bgm-icon-picker-cell svg{width:18px;height:18px;}",
      ".bgm-icon-picker-preset-name{font-size:12px;font-weight:600;color:var(--text-normal);line-height:1.3;}",
      ".bgm-icon-picker-search{width:100% !important;margin-bottom:6px;}",
      ".bgm-icon-picker-count{font-size:11.5px;color:var(--text-muted);margin-bottom:8px;}",
      ".bgm-icon-picker-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(40px, 1fr));gap:6px;max-height:240px;overflow-y:auto;padding:4px 2px;}",
      ".bgm-icon-picker-cell{width:40px !important;height:38px !important;padding:0 !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;border-radius:7px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-secondary) !important;cursor:pointer;}",
      "body.is-mobile .bgm-settings-root-container{padding-bottom:calc(92px + env(safe-area-inset-bottom, 0px)) !important;box-sizing:border-box;}",
      "body.is-mobile .bgm-settings-root-container h3{margin:18px 0 8px !important;font-size:1.05em !important;scroll-margin-top:128px;}",
      "body.is-mobile .bgm-settings-root-container .setting-item{display:flex !important;flex-direction:column !important;flex-wrap:nowrap !important;align-items:stretch !important;gap:9px !important;padding:12px 13px !important;margin:0 0 8px 0 !important;height:auto !important;min-height:0 !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-info{flex:0 0 auto !important;flex-basis:auto !important;min-width:0 !important;width:100% !important;height:auto !important;margin:0 !important;padding:0 !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-control{flex:0 0 auto !important;width:100% !important;min-width:0 !important;display:flex !important;flex-wrap:wrap !important;align-items:center !important;justify-content:flex-start !important;gap:8px !important;padding-top:2px !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item.mod-toggle:not(:has(.setting-item-control button)):not(:has(input[type=\"text\"])):not(:has(select)){flex-direction:row !important;align-items:center !important;justify-content:space-between !important;gap:12px !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item.mod-toggle:not(:has(.setting-item-control button)):not(:has(input[type=\"text\"])):not(:has(select)) > .setting-item-info{flex:1 1 auto !important;width:auto !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item.mod-toggle:not(:has(.setting-item-control button)):not(:has(input[type=\"text\"])):not(:has(select)) > .setting-item-control{flex:0 0 auto !important;width:auto !important;justify-content:flex-end !important;padding-top:0 !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-control input[type=\"text\"],body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-control input[type=\"search\"],body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-control select.dropdown{width:100% !important;max-width:100% !important;min-height:38px !important;box-sizing:border-box !important;}",
      "body.is-mobile .bgm-settings-root-container .setting-item > .setting-item-control button:not(.bgm-ribbon-inline-btn){min-height:36px !important;padding:6px 12px !important;font-size:13px !important;}",
      "body.is-mobile .bgm-settings-sticky-hud{position:relative !important;top:auto !important;z-index:2 !important;margin:0 0 12px 0;padding:10px 11px 9px;border-radius:12px;gap:8px;background:var(--background-primary) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;box-shadow:0 4px 14px rgba(28,20,12,0.06);}",
      "body.is-mobile .bgm-settings-hud-top{gap:7px;}",
      "body.is-mobile .bgm-settings-hud-brand{width:100%;justify-content:space-between;align-items:center;}",
      "body.is-mobile .bgm-settings-hud-title{font-size:1.05em !important;}",
      "body.is-mobile .bgm-settings-hud-mode-badge{font-size:10px;padding:1.5px 7px;}",
      "body.is-mobile .bgm-settings-spotlight-capsule{flex:1 1 100%;max-width:100%;min-width:0;}",
      "body.is-mobile .bgm-settings-spotlight-input{font-size:13px !important;min-height:36px !important;padding:6px 96px 6px 32px !important;}",
      "body.is-mobile .bgm-settings-compass-rail{gap:7px;padding:6px 0 2px;}",
      "body.is-mobile .bgm-settings-compass-subhint{display:none;}",
      "body.is-mobile .bgm-settings-compass-chips{flex-wrap:nowrap !important;overflow-x:auto !important;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:6px;padding:1px 1px 2px;}",
      "body.is-mobile .bgm-settings-compass-chips::-webkit-scrollbar{display:none;}",
      "body.is-mobile .bgm-settings-compass-chip{padding:4px 10px !important;font-size:12px !important;}",
      "body.is-mobile .bgm-settings-compass-mode-btn{margin-left:auto;padding:4px 9px !important;font-size:11.5px !important;}",
      "body.is-mobile .bgm-pro-upgrade-card{padding:13px 14px;gap:10px;}",
      "body.is-mobile .bgm-pro-upgrade-info{flex:1 1 100%;min-width:0;}",
      "body.is-mobile .bgm-pro-upgrade-card > button{width:100%;min-height:38px;}",
      "body.is-mobile .bangumi-help-github-card,body.is-mobile .bangumi-help-community-card{padding:13px 14px !important;}",
      "body.is-mobile .bangumi-help-info-col{min-width:0 !important;flex:1 1 100% !important;}",
      "body.is-mobile .bangumi-help-qr-col{margin:0 auto;}",
      "body.is-mobile .bgm-guide-demo-summary{font-size:12.4px;padding:9px 11px;}",
      "body.is-mobile .bgm-guide-video-bar{flex-wrap:wrap;gap:6px;}",
      /* 简略说明模式：隐藏冗长文字说明、显著缩短滑程，同时保留完整 DOM 搜索索引与单条轻点展开 */
      ".bgm-settings-lazy-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px;}",
      ".bgm-settings-lazy-head h2{margin:0 !important;}",
      ".bgm-brief-toggle-btn{cursor:pointer;display:inline-flex !important;align-items:center;gap:4px;padding:3px 10px !important;height:auto !important;min-height:26px !important;border-radius:999px !important;border:1px solid color-mix(in srgb, #8f683d 40%, var(--background-modifier-border)) !important;background:var(--background-secondary) !important;color:var(--text-muted) !important;font-size:12px !important;font-weight:600 !important;line-height:1.3 !important;box-shadow:none !important;white-space:nowrap;transition:background .14s ease,color .14s ease,border-color .14s ease;}",
      ".bgm-brief-toggle-btn:hover{border-color:#8f683d !important;color:var(--text-normal) !important;}",
      ".bgm-brief-toggle-btn.is-active{background:rgba(143,104,61,0.16) !important;border-color:#8f683d !important;color:#8f683d !important;font-weight:700 !important;}",
      ".bgm-brief-info-btn{display:none !important;align-items:center;justify-content:center;width:22px !important;height:22px !important;min-width:22px !important;min-height:22px !important;padding:0 !important;margin:0 !important;border-radius:999px !important;border:1px solid color-mix(in srgb, #8f683d 42%, var(--background-modifier-border)) !important;background:color-mix(in srgb, #8f683d 9%, var(--background-secondary)) !important;color:#8f683d !important;font-size:12px !important;font-weight:700 !important;line-height:1 !important;box-shadow:none !important;cursor:pointer;flex:0 0 auto;vertical-align:middle;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .bgm-brief-info-btn{display:inline-flex !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc.is-bgm-search-active .bgm-brief-info-btn,.bgm-settings-root-container.is-bgm-brief-desc .setting-item.is-bgm-search-match .bgm-brief-info-btn{display:none !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item.is-bgm-desc-peeked .bgm-brief-info-btn{background:rgba(143,104,61,0.16) !important;border-color:#8f683d !important;color:#8f683d !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .bgm-settings-intro-p,.bgm-settings-root-container.is-bgm-brief-desc .bgm-guide-step-note,.bgm-settings-root-container.is-bgm-brief-desc .bgm-mobile-compat-banner{display:none !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item > .setting-item-info{display:flex !important;flex-wrap:wrap !important;align-items:center !important;gap:2px 6px !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item > .setting-item-info > .setting-item-name{flex:0 1 auto;max-width:calc(100% - 30px);}",
      ".bgm-settings-root-container.is-bgm-brief-desc.is-bgm-search-active .setting-item > .setting-item-info > .setting-item-name{max-width:100%;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item > .setting-item-info > .setting-item-description{display:none !important;flex:0 0 100% !important;width:100% !important;margin-top:4px !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item.is-bgm-desc-peeked > .setting-item-info > .setting-item-description,.bgm-settings-root-container.is-bgm-brief-desc .setting-item.is-bgm-search-match > .setting-item-info > .setting-item-description{display:block !important;}",
      ".bgm-settings-root-container.is-bgm-brief-desc .setting-item.is-bgm-live-status:not(.is-bgm-desc-peeked) > .setting-item-info > .setting-item-description{display:-webkit-box !important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
      "body.is-mobile .bgm-settings-root-container.is-bgm-brief-desc .setting-item{padding:9px 12px !important;margin-bottom:6px !important;gap:6px !important;}",
      "body.is-mobile .bgm-settings-root-container.is-bgm-brief-desc h3{margin:14px 0 6px !important;}",
      "@media (max-width: 720px){.bgm-settings-root-container .setting-item{flex-direction:column;align-items:stretch;gap:9px;}.bgm-settings-root-container .setting-item > .setting-item-info{flex:0 0 auto;flex-basis:auto;min-width:0;width:100%;}.bgm-settings-root-container .setting-item > .setting-item-control{width:100%;justify-content:flex-start;}.bgm-settings-compass-subhint{display:none;}.bgm-settings-compass-chips{flex-wrap:nowrap;overflow-x:auto;}.bgm-settings-spotlight-capsule{min-width:0;max-width:100%;flex:1 1 100%;}}"
    ].join("\n");
  }

  const BangumiManagerSettingTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this._savedSpotlightQuery = "";
    this._savedBrowseMode = "module";
    this._savedFocusSectionKey = "all";
    this._savedFocusIntentKey = "all";
    this._savedFocusOnlyMode = false;
  }
  isBriefDescriptionsEnabled() {
    const s = (this.plugin && this.plugin.settings) || {};
    if (isMobileEnv()) {
      return typeof s.settingsBriefDescMobile === "boolean" ? s.settingsBriefDescMobile : true;
    }
    return typeof s.settingsBriefDescDesktop === "boolean" ? s.settingsBriefDescDesktop : false;
  }

  async setBriefDescriptionsEnabled(nextVal, container) {
    const enabled = Boolean(nextVal);
    if (this.plugin && this.plugin.settings) {
      if (isMobileEnv()) {
        this.plugin.settings.settingsBriefDescMobile = enabled;
      } else {
        this.plugin.settings.settingsBriefDescDesktop = enabled;
      }
      await this.plugin.saveSettings().catch(() => {});
    }
    const root = container || this.containerEl;
    if (root) {
      root.classList.toggle("is-bgm-brief-desc", enabled);
      root.querySelectorAll(".bgm-brief-toggle-btn").forEach((btn) => {
        btn.classList.toggle("is-active", enabled);
        btn.textContent = enabled ? "简略说明：开" : "简略说明：关";
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      });
    }
  }

  createBriefToggleButton(parentEl, container) {
    const enabled = this.isBriefDescriptionsEnabled();
    const btn = parentEl.createEl("button", {
      cls: `bgm-brief-toggle-btn${enabled ? " is-active" : ""}`,
      text: enabled ? "简略说明：开" : "简略说明：关"
    });
    btn.type = "button";
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    btn.title = "收起或展开各项详细文字说明以大幅缩短下滑距离（开启后点击单条旁的 ⓘ 仍可查看该项完整说明，且不影响顶部搜索）";
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setBriefDescriptionsEnabled(!this.isBriefDescriptionsEnabled(), container);
    };
    return btn;
  }

  enhanceBriefDescriptions(container) {
    if (!container) return;
    container.classList.toggle("is-bgm-brief-desc", this.isBriefDescriptionsEnabled());
    container.querySelectorAll(".setting-item").forEach((item) => {
      const infoEl = item.querySelector(":scope > .setting-item-info");
      const nameEl = infoEl && infoEl.querySelector(":scope > .setting-item-name");
      const descEl = infoEl && infoEl.querySelector(":scope > .setting-item-description");
      if (!infoEl || !nameEl || !descEl) return;
      const descText = (descEl.textContent || "").trim();
      if (!descText) return;
      if (/^(?:当前状态：|正在检测|已自动识别)/.test(descText)) {
        item.classList.add("is-bgm-live-status");
      }
      if (infoEl.querySelector(":scope > .bgm-brief-info-btn")) return;
      const docRef = container.ownerDocument || document;
      const infoBtn = docRef.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "bgm-brief-info-btn";
      infoBtn.textContent = "i";
      infoBtn.setAttribute("aria-label", "查看完整说明");
      infoBtn.title = "展开 / 收起本项详细说明";
      infoBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = item.classList.toggle("is-bgm-desc-peeked");
        infoBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      nameEl.insertAdjacentElement("afterend", infoBtn);
    });
  }

  display(opts = {}) {
    if (this.plugin && typeof this.plugin.ensureScoreDashboardStyles === "function") {
      this.plugin.ensureScoreDashboardStyles();
    }
    ensureSettingsSpotlightStyles(this.containerEl?.ownerDocument || (typeof document !== "undefined" ? document : null));
    const container = this.containerEl;
    const preserveScroll = !(opts && opts.scrollToTop === true);
    const savedScrolls = [];
    if (preserveScroll && container) {
      const seen = new Set();
      const candidates = [
        container,
        container.parentElement,
        typeof container.closest === "function" ? container.closest(".vertical-tab-content") : null,
        typeof container.closest === "function" ? container.closest(".modal-content") : null
      ];
      for (const hostEl of candidates) {
        if (hostEl && !seen.has(hostEl)) {
          seen.add(hostEl);
          const top = Number(hostEl.scrollTop) || 0;
          if (top > 0) savedScrolls.push({ el: hostEl, top });
        }
      }
    }

    container.empty();
    container.addClass("bgm-settings-root-container");
    container.classList.toggle("is-bgm-brief-desc", this.isBriefDescriptionsEnabled());
    const topHudMount = container.createDiv("bgm-settings-top-hud-mount");
    if (this.plugin.settings.mode === "lazy") {
      const lazyHead = topHudMount.createDiv("bgm-settings-lazy-head");
      lazyHead.createEl("h2", {
        text: "Bangumi \u8FFD\u756A\u7BA1\u7406\u5668"
      });
      this.createBriefToggleButton(lazyHead, container);
      this.displayLazyMode(container);
    } else {
      this.displayProfessionalMode(container, topHudMount);
    }

    // 必须在聚光灯完成全文 DOM 索引后再挂载单条 ⓘ 展开按钮，保证搜索索引 100% 完整
    this.enhanceBriefDescriptions(container);

    if (savedScrolls.length > 0) {
      const restore = () => {
        for (const item of savedScrolls) {
          if (item.el && item.el.isConnected) {
            item.el.scrollTop = item.top;
          }
        }
      };
      restore();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          restore();
          requestAnimationFrame(restore);
        });
      }
      setTimeout(restore, 50);
    } else if (opts && opts.scrollToTop === true && container) {
      container.scrollTop = 0;
      const scroller =
        (typeof container.closest === "function" &&
          (container.closest(".vertical-tab-content") || container.closest(".modal-content"))) ||
        container.parentElement;
      if (scroller) scroller.scrollTop = 0;
    }
  }
  addIntroDescription(container, text) {
    const description = container.createEl(
      "p",
      {
        cls: "bgm-settings-intro-p",
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
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/[\\/]+$/, "");
  }

  bindPathInputAutoMigration(textComponent, categoryKey, getCurrentPathFn) {
    if (!textComponent || !textComponent.inputEl) return;
    const inputEl = textComponent.inputEl;
    let baselinePath = this.normalizeVaultFolderPath(getCurrentPathFn());

    inputEl.addEventListener("focus", () => {
      baselinePath = this.normalizeVaultFolderPath(getCurrentPathFn());
    });

    const triggerAutoMigrationIfChanged = async () => {
      const committedPath = this.normalizeVaultFolderPath(getCurrentPathFn());
      const prevPath = baselinePath;
      baselinePath = committedPath;
      if (
        prevPath &&
        committedPath &&
        prevPath !== committedPath &&
        this.plugin &&
        typeof this.plugin.migrateVaultFolderPath === "function"
      ) {
        this.plugin
          .migrateVaultFolderPath(categoryKey, prevPath, committedPath)
          .catch((err) => console.error("[BangumiPathMigration] error:", err));
      }
    };

    inputEl.addEventListener("blur", () => {
      triggerAutoMigrationIfChanged();
    });
    inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        inputEl.blur();
      }
    });
  }

  getAutomaticBaseFolderPath() {
    const noteRootFolder =
      this.normalizeVaultFolderPath(
        this.plugin.settings.noteRootFolder
      );

    return noteRootFolder
      ? noteRootFolder + "/追番广场"
      : "追番广场";
  }
  getBaseFilePath() {
    const baseFolder = this.normalizeVaultFolderPath(
      this.plugin.settings.baseFolderPath ||
      this.getAutomaticBaseFolderPath()
    );

    return baseFolder
      ? baseFolder + "/动画库.base"
      : "动画库.base";
  }

  getAutomaticCharacterNoteFolder() {
    if (typeof this.plugin.getDefaultCharacterNoteFolder === "function") {
      return this.plugin.getDefaultCharacterNoteFolder();
    }
    const noteRootFolder = this.normalizeVaultFolderPath(
      this.plugin.settings.noteRootFolder || "动画笔记"
    );
    const lastSlash = noteRootFolder.lastIndexOf("/");
    const parentDir = lastSlash > 0 ? noteRootFolder.slice(0, lastSlash) : "";
    return parentDir ? parentDir + "/角色典藏" : "角色典藏";
  }

  async updateCharacterNoteFolder(value) {
    const folder = this.normalizeVaultFolderPath(value);
    const autoDefault = this.getAutomaticCharacterNoteFolder();
    if (folder && folder !== autoDefault) {
      this.plugin.settings.characterNoteFolder = folder;
      this.plugin.settings.characterNoteFolderManuallySet = true;
    } else {
      this.plugin.settings.characterNoteFolder = autoDefault;
      this.plugin.settings.characterNoteFolderManuallySet = false;
    }
    await this.plugin.saveSettings();
  }

  async updateNoteRootFolder(value) {
    const noteRootFolder =
      this.normalizeVaultFolderPath(value);

    this.plugin.settings.noteRootFolder =
      noteRootFolder;

    if (
      this.plugin.settings.baseFolderPathManuallySet !==
      true
    ) {
      this.plugin.settings.baseFolderPath =
        this.getAutomaticBaseFolderPath();
    }

    if (
      this.plugin.settings.dashboardPathManuallySet !==
      true
    ) {
      this.plugin.settings.dashboardPath =
        this.plugin.getDefaultDashboardPath();
    }

    if (
      this.plugin.settings.characterNoteFolderManuallySet !==
      true
    ) {
      this.plugin.settings.characterNoteFolder =
        this.getAutomaticCharacterNoteFolder();
    }

    this.plugin.settings.baseFilePath =
      this.getBaseFilePath();

    await this.plugin.saveSettings();
  }
  async updateBaseFolderPath(value) {
    const baseFolderPath =
      this.normalizeVaultFolderPath(value);

    if (baseFolderPath) {
      this.plugin.settings.baseFolderPath =
        baseFolderPath;

      this.plugin.settings.baseFolderPathManuallySet =
        true;
    } else {
      this.plugin.settings.baseFolderPath =
        this.getAutomaticBaseFolderPath();

      this.plugin.settings.baseFolderPathManuallySet =
        false;
    }

    this.plugin.settings.baseFilePath =
      this.getBaseFilePath();

    await this.plugin.saveSettings();
  }

  addLocalAnimeRootSetting(container, descText) {
    const promptHost = document.createElement("div");
    let baselineRoot = String(this.plugin.settings.localAnimeRoot || "").trim();
    let rootInputEl = null;

    const commitLocalRootValue = async (rawNextVal) => {
      const nextRoot = String(rawNextVal || "").trim();
      const prevRoot = baselineRoot;
      if (nextRoot === String(this.plugin.settings.localAnimeRoot || "").trim() && nextRoot === prevRoot) {
        return;
      }
      this.plugin.settings.localAnimeRoot = nextRoot;
      this.plugin._v07LocalFolderCache = null;
      baselineRoot = nextRoot;
      await this.plugin.saveSettings();

      promptHost.empty();
      if (!isDesktopNodeAvailable()) return;

      const files =
        typeof this.plugin.getAnimeMarkdownFiles === "function"
          ? this.plugin.getAnimeMarkdownFiles()
          : this.app.vault.getMarkdownFiles().filter((f) => this.plugin.isTargetNote(f));
      const affected = [];
      for (const file of files) {
        const fm = this.app.metadataCache?.getFileCache(file)?.frontmatter;
        const dl = fm && fm["下载路径"] ? String(fm["下载路径"]).trim() : "";
        if (!dl || dl === "无") continue;
        const fromOldRoot = prevRoot && isPathInsideAnimeRoot(prevRoot, dl);
        if (fromOldRoot) {
          affected.push({ file, dl, fromOldRoot: true });
        }
      }

      if (affected.length === 0) {
        await this.plugin.refreshOpenDashboardViews();
        return;
      }

      const box = promptHost.createDiv();
      box.style.cssText =
        "margin:-4px 0 14px 0;padding:10px 12px;border-radius:8px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;";
      box.createDiv({
        text: `检测到 ${affected.length} 部已有动画笔记的「下载路径」仍指向旧的默认保存目录（不影响各处散落关联视频的正常播放与抽取）。是否需要批量更新这些旧笔记的路径？`,
        attr: { style: "font-size:12px;line-height:1.5;color:var(--text-muted);flex:1 1 280px;" }
      });
      const btnRow = box.createDiv({
        attr: { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:center;" }
      });

      if (prevRoot && nextRoot && affected.some((a) => a.fromOldRoot)) {
        const rebaseBtn = btnRow.createEl("button", {
          cls: "mod-cta",
          text: "替换旧根目录前缀"
        });
        rebaseBtn.onclick = async () => {
          rebaseBtn.disabled = true;
          let updated = 0;
          const normPrev = prevRoot.replace(/\\/g, "/").replace(/\/+$/, "");
          const normNext = nextRoot.replace(/\\/g, "/").replace(/\/+$/, "");
          for (const item of affected) {
            if (!item.fromOldRoot) continue;
            const normDl = item.dl.replace(/\\/g, "/");
            if (normDl.toLowerCase().startsWith(normPrev.toLowerCase())) {
              const suffix = normDl.slice(normPrev.length);
              const rebased = `${normNext}${suffix}`;
              try {
                let rawMd = await this.app.vault.read(item.file);
                rawMd = updateFrontmatterField(rawMd, "下载路径", rebased);
                rawMd = updateFolderLine(rawMd, { downloadPath: rebased, error: null });
                rawMd = syncNoteCalloutFromFrontmatter(rawMd);
                await this.plugin.modifyNoteSafely(item.file, rawMd, 2400);
                updated += 1;
              } catch (_) {}
            }
          }
          this.plugin._v07LocalFolderCache = null;
          promptHost.empty();
          if (Notice) new Notice(`已将 ${updated} 部动画笔记的下载路径前缀更新至新根目录`);
          if (typeof this.plugin.checkAllLocalStatus === "function") {
            await this.plugin.checkAllLocalStatus(false);
          }
          await this.plugin.refreshOpenDashboardViews();
        };
      }

      const unbindBtn = btnRow.createEl("button", {
        text: "解绑旧目录关联（设为“无”）"
      });
      unbindBtn.onclick = async () => {
        unbindBtn.disabled = true;
        let cleared = 0;
        for (const item of affected) {
          try {
            let rawMd = await this.app.vault.read(item.file);
            rawMd = updateFrontmatterField(rawMd, "下载路径", "无");
            rawMd = updateFrontmatterField(rawMd, "本地更新状态", "未设置下载路径");
            rawMd = updateFolderLine(rawMd, { downloadPath: "", error: null });
            rawMd = syncNoteCalloutFromFrontmatter(rawMd);
            await this.plugin.modifyNoteSafely(item.file, rawMd, 2400);
            cleared += 1;
          } catch (_) {}
        }
        this.plugin._v07LocalFolderCache = null;
        promptHost.empty();
        if (Notice) new Notice(`已解绑 ${cleared} 部动画笔记的旧目录关联`);
        await this.plugin.refreshOpenDashboardViews();
      };

      const keepBtn = btnRow.createEl("button", {
        text: "保持原状"
      });
      keepBtn.onclick = async () => {
        promptHost.empty();
        await this.plugin.refreshOpenDashboardViews();
      };
    };

    const settingRow = new Setting(container)
      .setName("新下载默认保存目录")
      .setDesc(descText)
      .addText((text) => {
        rootInputEl = text.inputEl;
        text
          .setPlaceholder("例如：D:/Anime（仅新下载时创建子目录，可留空）")
          .setValue(baselineRoot);

        text.inputEl.addEventListener("focus", () => {
          baselineRoot = String(this.plugin.settings.localAnimeRoot || "").trim();
        });
        text.inputEl.addEventListener("blur", () => {
          commitLocalRootValue(text.inputEl.value);
        });
        text.inputEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            text.inputEl.blur();
          }
        });
      });

    if (isDesktopNodeAvailable()) {
      settingRow.addButton((btn) => {
        btn.setButtonText("选择文件夹…").onClick(async () => {
          baselineRoot = String(this.plugin.settings.localAnimeRoot || "").trim();
          const picked = await pickNativeFolderOnDesktop({
            title: "选择新下载默认保存目录",
            initialDir: baselineRoot
          });
          if (picked) {
            if (rootInputEl) rootInputEl.value = picked;
            await commitLocalRootValue(picked);
          }
        });
      });
    }

    container.appendChild(promptHost);

    if (isDesktopNodeAvailable() && typeof this.plugin?.openLocalMediaLinkerModal === "function") {
      new Setting(container)
        .setName("本地视频关联")
        .setDesc("把电脑各盘符、下载文件夹或移动硬盘里已经看过的旧动画原片，原地关联到对应动画笔记（不移动原文件、不改原文件名，也能直接播放和截取台词）。")
        .addButton((btn) => {
          btn.setButtonText("打开本地视频关联面板").onClick(() => {
            this.plugin.openLocalMediaLinkerModal(null);
          });
        });
    }
  }

  addFfmpegSetting(container) {
    if (!isDesktopNodeAvailable()) return;
    const fs = tryRequireNode("fs");
    const computeDetectDesc = () => {
      const resolved = resolveFfmpegExecutable(this.plugin);
      const existsOnDisk = resolved && resolved !== "ffmpeg" && fs && fs.existsSync(resolved);
      const statusLabel = existsOnDisk
        ? `已自动识别本机 FFmpeg：${resolved}`
        : "默认调用系统环境变量 PATH 中的 ffmpeg（若未加入 PATH，可在右侧手动指定 ffmpeg 可执行文件）";
      return `用于「音声典藏 → 截取剧集音声」解析内嵌软字幕与切片保存 MP3。${statusLabel}`;
    };

    const ffSetting = new Setting(container)
      .setName("FFmpeg 可执行文件路径（可选）")
      .setDesc(computeDetectDesc())
      .addText((text) => {
        text
          .setPlaceholder("留空自动探测（支持 WinGet / Scoop / C:\\ffmpeg / PATH）")
          .setValue(String(this.plugin.settings.ffmpegCustomPath || ""));
        const saveFf = async () => {
          const val = String(text.inputEl.value || "").trim();
          if (val === String(this.plugin.settings.ffmpegCustomPath || "").trim()) return;
          this.plugin.settings.ffmpegCustomPath = val;
          this.plugin._resolvedFfmpegCustom = null;
          this.plugin._resolvedFfmpegBin = "";
          await this.plugin.saveSettings();
          ffSetting.setDesc(computeDetectDesc());
        };
        text.inputEl.addEventListener("blur", saveFf);
        text.inputEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            text.inputEl.blur();
          }
        });
      })
      .addButton((btn) => {
        btn.setButtonText("浏览...").onClick(() => {
          const fInput = document.createElement("input");
          fInput.type = "file";
          if (typeof process !== "undefined" && process.platform === "win32") {
            fInput.accept = ".exe";
          }
          fInput.onchange = async () => {
            const file = fInput.files && fInput.files[0];
            if (!file) return;
            const picked = getNativeFilePathCrossPlatform(file);
            if (picked) {
              this.plugin.settings.ffmpegCustomPath = picked;
              this.plugin._resolvedFfmpegCustom = null;
              this.plugin._resolvedFfmpegBin = "";
              await this.plugin.saveSettings();
              this.display();
            }
          };
          fInput.click();
        });
      });
  }

  addNoteRootSetting(container, description) {
    new Setting(container)
      .setName("动画笔记目录")
      .setDesc(description + "（修改路径并离开输入框后将自动迁移目录下已有笔记，可在「查看路径迁移状态」中跟踪进度）")
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.noteRootFolder || ""
          )
        );

        text.onChange(async (value) => {
          await this.updateNoteRootFolder(value);
        });

        this.bindPathInputAutoMigration(text, "noteRootFolder", () => this.plugin.settings.noteRootFolder || "");
      });
  }

  addCharacterNoteFolderSetting(container) {
    new Setting(container)
      .setName("角色典藏笔记目录")
      .setDesc(
        "生成角色典藏 Markdown 笔记的仓库保存位置。默认与「动画笔记目录」处于同一层级（如：角色典藏），修改后自动迁移已有笔记。"
      )
      .addText((text) => {
        text
          .setPlaceholder(this.getAutomaticCharacterNoteFolder())
          .setValue(
            String(
              this.plugin.settings.characterNoteFolder ||
              this.getAutomaticCharacterNoteFolder()
            )
          )
          .onChange(async (value) => {
            await this.updateCharacterNoteFolder(value);
          });

        this.bindPathInputAutoMigration(
          text,
          "characterNoteFolder",
          () => this.plugin.settings.characterNoteFolder || this.getAutomaticCharacterNoteFolder()
        );
      });
  }

  addGameNoteFolderSetting(container) {
    new Setting(container)
      .setName("游戏典藏笔记目录")
      .setDesc(
        "生成游戏典藏 Markdown 笔记的仓库保存位置（默认：游戏典藏），修改后自动迁移已有游戏笔记。"
      )
      .addText((text) => {
        text
          .setPlaceholder("游戏典藏")
          .setValue(String(this.plugin.settings.gameNoteFolder || "游戏典藏"))
          .onChange(async (value) => {
            this.plugin.settings.gameNoteFolder =
              this.normalizeVaultFolderPath(value) || "游戏典藏";
            await this.plugin.saveSettings();
          });

        this.bindPathInputAutoMigration(
          text,
          "gameNoteFolder",
          () => this.plugin.settings.gameNoteFolder || "游戏典藏"
        );
      });
  }

  addPathMigrationStatusSetting(container) {
    const snap =
      this.plugin && typeof this.plugin.getPathMigrationSnapshot === "function"
        ? this.plugin.getPathMigrationSnapshot()
        : { status: "idle" };
    const statusTextMap = {
      idle: "当前状态：空闲（等待路径变更）",
      running: `当前状态：正在迁移中（${snap.processed || 0}/${snap.total || 0}）`,
      completed: `当前状态：✓ 迁移已完成（上次移动 ${snap.movedFiles || 0} 个文件，更新 ${snap.updatedNotes || 0} 篇笔记引用）`,
      failed: `当前状态：✕ 迁移失败（${snap.lastError || "请点击查看详情"}）`
    };
    const statusSummary = statusTextMap[snap.status] || statusTextMap.idle;

    new Setting(container)
      .setName("查看路径迁移状态")
      .setDesc(
        "更改任意目录路径（图片、画册、音声或动画/角色/游戏笔记目录）后，插件会自动在后台迁移已有文件并同步更新笔记与典藏引用。\n" +
          statusSummary
      )
      .addButton((button) => {
        button.setButtonText("查看状态");
        button.onClick(() => {
          new PathMigrationStatusModal(this.app, this.plugin).open();
        });
      });
  }

  addAutoDetectVaultFoldersSetting(container) {
    new Setting(container)
      .setName("一键自动识别仓库目录与重建典藏")
      .setDesc(
        "跨设备同步（如同步了笔记与附件，但未同步插件配置文件）或使用自定义嵌套目录时，点击即可自动扫描仓库内的动画、角色、游戏笔记及封面、画册、音声目录，并重建典藏列表，不会修改或覆盖已有笔记。"
      )
      .addButton((button) => {
        button
          .setButtonText("自动识别目录")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("正在识别…");
            try {
              const detectRes =
                typeof this.plugin?.autoDetectVaultFoldersIfNeeded === "function"
                  ? await this.plugin.autoDetectVaultFoldersIfNeeded({
                      force: true,
                      silent: true
                    })
                  : { changed: false, updated: [] };
              const gameRes =
                typeof reconcileGameCollectionWithNotes === "function"
                  ? await reconcileGameCollectionWithNotes(this.plugin)
                  : { added: 0 };
              const voiceRes =
                typeof reconcileVoiceCollectionWithVault === "function"
                  ? await reconcileVoiceCollectionWithVault(this.plugin)
                  : { added: 0 };
              if (typeof this.plugin?.refreshOpenDashboardViews === "function") {
                await this.plugin.refreshOpenDashboardViews();
              }
              const parts = [];
              if (detectRes && Array.isArray(detectRes.updated) && detectRes.updated.length > 0) {
                parts.push(`更新目录 ${detectRes.updated.length} 项（${detectRes.updated.slice(0, 3).join("；")}）`);
              }
              if (gameRes && gameRes.added > 0) {
                parts.push(`补回游戏典藏 ${gameRes.added} 部`);
              }
              if (voiceRes && voiceRes.added > 0) {
                parts.push(`补回音声 ${voiceRes.added} 条`);
              }
              new Notice(
                parts.length > 0
                  ? `仓库自动识别完成：${parts.join("，")}。`
                  : "已扫描仓库目录，当前路径与典藏索引均已对齐。",
                6000
              );
              this.display();
            } catch (err) {
              console.error("[BangumiAutoDetect] manual scan failed:", err);
              new Notice(`自动识别目录失败：${err?.message || err}`, 5000);
              button.setDisabled(false);
              button.setButtonText("自动识别目录");
            }
          });
      });
  }

  addLegacyNoteUpgradeSetting(container) {
    const baseDesc =
      "日常操作已默认自动兼容早期版本创建的动画笔记。若仓库中含有旧版本生成的笔记，也可在此一键扫描并无损补齐新版字段与区块（含「我的评分」、下载路径与本地文件夹链接对齐、Netaba 页面切换栏及「观片手记与评价」区块，100% 保留原有评分与手记内容）。";
    let settingRef = null;
    let scanBtnRef = null;
    let runBtnRef = null;

    settingRef = new Setting(container)
      .setName("兼容升级旧版动画笔记")
      .setDesc(baseDesc)
      .addButton((button) => {
        scanBtnRef = button;
        button.setButtonText("扫描检查");
        button.onClick(async () => {
          if (typeof this.plugin?.inspectAndUpgradeLegacyNotes !== "function") return;
          button.setDisabled(true);
          button.setButtonText("扫描中…");
          try {
            const res = await this.plugin.inspectAndUpgradeLegacyNotes({
              dryRun: true,
              showNotice: true
            });
            if (settingRef?.descEl?.isConnected) {
              if (res.needsUpgradeCount > 0) {
                const sampleNames = res.details
                  .slice(0, 4)
                  .map((d) => `《${d.name}》`)
                  .join("、");
                const moreSuffix = res.details.length > 4 ? ` 等 ${res.needsUpgradeCount} 篇` : "";
                settingRef.setDesc(
                  `${baseDesc}\n→ 最近扫描结果：共检查 ${res.scanned} 篇动画笔记，发现 ${res.needsUpgradeCount} 篇可无损补齐升级（${sampleNames}${moreSuffix}）。点击右侧「一键兼容升级」即可完成更新。`
                );
              } else {
                settingRef.setDesc(
                  `${baseDesc}\n✓ 最近扫描结果：共检查 ${res.scanned} 篇动画笔记，全部已是最新兼容结构，无需更新。`
                );
              }
            }
          } finally {
            button.setDisabled(false);
            button.setButtonText("扫描检查");
          }
        });
      })
      .addButton((button) => {
        runBtnRef = button;
        button.setButtonText("一键兼容升级");
        button.setCta();
        button.onClick(async () => {
          if (typeof this.plugin?.inspectAndUpgradeLegacyNotes !== "function") return;
          button.setDisabled(true);
          if (scanBtnRef) scanBtnRef.setDisabled(true);
          button.setButtonText("升级中…");
          try {
            const res = await this.plugin.inspectAndUpgradeLegacyNotes({
              dryRun: false,
              showNotice: true
            });
            if (settingRef?.descEl?.isConnected) {
              settingRef.setDesc(
                res.upgradedCount > 0
                  ? `${baseDesc}\n✓ 已完成无损兼容升级：共检查 ${res.scanned} 篇笔记，成功更新 ${res.upgradedCount} 篇旧版笔记。`
                  : `${baseDesc}\n✓ 检查完毕：共检查 ${res.scanned} 篇笔记，全部已是最新兼容结构。`
              );
            }
          } finally {
            button.setDisabled(false);
            if (scanBtnRef) scanBtnRef.setDisabled(false);
            button.setButtonText("一键兼容升级");
          }
        });
      });
  }

  addBaseFolderSetting(container) {
    new Setting(container)
      .setName("启用传统动画库 (动画库.base) 自动生成")
      .setDesc(
        "番剧档案馆已全面替代传统 Obsidian Bases 视图，默认不再自动生成“动画库.base”。若您仍需使用传统 Base 视图，可在此开启自动生成或点击右侧按钮手动生成。"
      )
      .addButton((button) => {
        button.setButtonText("立即生成动画库.base");
        button.onClick(async () => {
          await this.plugin.createBaseFileIfMissing(true);
        });
      })
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableBaseFileGeneration === true);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableBaseFileGeneration = value;
          await this.plugin.saveSettings();
          if (value) {
            await this.plugin.createBaseFileIfMissing(true);
          }
          this.display();
        });
      });

    new Setting(container)
      .setName("动画库目录（传统 Base 文件）")
      .setDesc(
        "填写传统“动画库.base”文件所在的目录（仅在手动生成或开启上方开关时使用）。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.baseFolderPath ||
            this.getAutomaticBaseFolderPath()
          )
        );

        text.onChange(async (value) => {
          await this.updateBaseFolderPath(value);
        });

        this.bindPathInputAutoMigration(
          text,
          "baseFolderPath",
          () => this.plugin.settings.baseFolderPath || this.getAutomaticBaseFolderPath()
        );
      });
  }

  addStepGuideNote(container, text) {
    const note = container.createDiv({
      cls: "bgm-guide-step-note",
      text
    });
    return note;
  }

  async resolveGuideMediaUrlCandidates(fileName) {
    const cleanName = String(fileName || "").trim();
    if (!cleanName) return [];
    const urls = [];
    const rel = `assets/guide/${cleanName}`;
    try {
      if (await pluginAssetExists(this.plugin, rel)) {
        const localUrl = getPluginAssetResourceUrl(this.plugin, rel);
        if (localUrl) urls.push(localUrl);
      }
    } catch (_) {}
    urls.push(`https://cdn.jsdelivr.net/gh/Curelove/bangumi-manager@main/assets/guide/${encodeURIComponent(cleanName)}`);
    urls.push(`https://raw.githubusercontent.com/Curelove/bangumi-manager/main/assets/guide/${encodeURIComponent(cleanName)}`);
    return urls;
  }

  addGuideDemoDrawer(container, { title, items = [] }) {
    if (!container || !Array.isArray(items) || items.length === 0) return;
    const drawer = container.createEl("details", {
      cls: "bgm-guide-demo-drawer"
    });
    drawer.createEl("summary", {
      cls: "bgm-guide-demo-summary",
      text: `▶ 查看操作演示：${title}`
    });
    const body = drawer.createDiv({ cls: "bgm-guide-demo-body" });
    let loaded = false;
    const managedVideos = [];

    const fmtSec = (sec) => {
      const s = Math.max(0, Math.floor(Number(sec) || 0));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      return `${mm}:${ss}`;
    };

    const mountFallbackGif = (hostEl, gifFileName, altText) => {
      hostEl.empty();
      const img = hostEl.createEl("img", {
        cls: "bgm-guide-demo-img"
      });
      img.loading = "lazy";
      img.alt = altText;
      this.resolveGuideMediaUrlCandidates(gifFileName).then((candidates) => {
        if (!img.isConnected || candidates.length === 0) return;
        let idx = 0;
        img.onerror = () => {
          idx += 1;
          if (idx < candidates.length) {
            img.src = candidates[idx];
          }
        };
        img.src = candidates[0];
      });
    };

    drawer.addEventListener("toggle", () => {
      if (!drawer.open) {
        managedVideos.forEach((rec) => {
          try {
            rec.video.pause();
          } catch (_) {}
        });
        return;
      }

      if (loaded) {
        managedVideos.forEach((rec) => {
          if (!rec.userPaused) {
            try {
              const p = rec.video.play();
              if (p && typeof p.catch === "function") p.catch(() => {});
            } catch (_) {}
          }
        });
        return;
      }

      loaded = true;
      items.forEach((entry) => {
        const itemWrap = body.createDiv({ cls: "bgm-guide-demo-item" });
        if (entry.caption) {
          itemWrap.createDiv({
            cls: "bgm-guide-demo-caption",
            text: entry.caption
          });
        }

        const gifName = String(entry.fileName || "").trim();
        const mp4Name = String(
          entry.videoFileName || (gifName ? gifName.replace(/\.gif$/i, ".mp4") : "")
        ).trim();
        const mediaHost = itemWrap.createDiv();

        if (!mp4Name) {
          mountFallbackGif(mediaHost, gifName, entry.caption || title);
          return;
        }

        const card = mediaHost.createDiv({ cls: "bgm-guide-video-card" });
        const stage = card.createDiv({ cls: "bgm-guide-video-stage" });
        const video = stage.createEl("video", { cls: "bgm-guide-demo-video" });
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        video.preload = "metadata";
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");

        stage.createDiv({
          cls: "bgm-guide-pause-pill",
          text: "⏸ 已暂停细看 · 点击画面继续循环"
        });

        const bar = card.createDiv({ cls: "bgm-guide-video-bar" });
        const toggleBtn = bar.createEl("button", {
          type: "button",
          cls: "bgm-guide-video-toggle",
          text: "⏸ 暂停细看"
        });
        const scrubber = bar.createEl("input", {
          type: "range",
          cls: "bgm-guide-video-scrubber"
        });
        scrubber.min = "0";
        scrubber.max = "1000";
        scrubber.value = "0";
        const meta = bar.createDiv({
          cls: "bgm-guide-video-meta",
          text: "60 FPS 实机演示"
        });

        const stateRec = { video, userPaused: false, scrubbing: false };
        managedVideos.push(stateRec);

        const syncUi = () => {
          const paused = video.paused;
          stage.classList.toggle("is-paused", paused);
          toggleBtn.textContent = paused ? "▶ 继续循环" : "⏸ 暂停细看";
          const dur = Number(video.duration);
          const cur = Number(video.currentTime) || 0;
          if (Number.isFinite(dur) && dur > 0) {
            if (!stateRec.scrubbing) {
              scrubber.value = String(Math.round((cur / dur) * 1000));
            }
            meta.textContent = `${fmtSec(cur)} / ${fmtSec(dur)} · 60 FPS`;
          }
        };

        const togglePlayPause = (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          if (video.paused) {
            stateRec.userPaused = false;
            const p = video.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          } else {
            stateRec.userPaused = true;
            video.pause();
          }
          syncUi();
        };

        stage.addEventListener("click", togglePlayPause);
        toggleBtn.addEventListener("click", togglePlayPause);
        video.addEventListener("play", syncUi);
        video.addEventListener("pause", syncUi);
        video.addEventListener("loadedmetadata", syncUi);
        video.addEventListener("timeupdate", syncUi);

        scrubber.addEventListener("pointerdown", () => {
          stateRec.scrubbing = true;
        });
        const finishScrub = () => {
          stateRec.scrubbing = false;
        };
        scrubber.addEventListener("pointerup", finishScrub);
        scrubber.addEventListener("change", finishScrub);
        scrubber.addEventListener("input", () => {
          const dur = Number(video.duration);
          if (Number.isFinite(dur) && dur > 0) {
            stateRec.userPaused = true;
            video.pause();
            video.currentTime = (Number(scrubber.value) / 1000) * dur;
            syncUi();
          }
        });

        this.resolveGuideMediaUrlCandidates(mp4Name)
          .then((candidates) => {
            if (!video.isConnected) return;
            if (!candidates.length) {
              mountFallbackGif(mediaHost, gifName, entry.caption || title);
              return;
            }
            let urlIdx = 0;
            video.onerror = () => {
              urlIdx += 1;
              if (urlIdx < candidates.length) {
                video.src = candidates[urlIdx];
                video.load();
                const p = video.play();
                if (p && typeof p.catch === "function") p.catch(() => {});
              } else if (gifName) {
                mountFallbackGif(mediaHost, gifName, entry.caption || title);
              }
            };
            video.src = candidates[0];
            const p = video.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          })
          .catch(() => {
            if (gifName && mediaHost.isConnected) {
              mountFallbackGif(mediaHost, gifName, entry.caption || title);
            }
          });
      });
    });
  }

  addRibbonButtonSetting(container, options) {
    const {
      name,
      desc,
      toggleKey,
      iconKey,
      defaultIcon,
      refreshFn
    } = options;

    const setting = new Setting(container)
      .setName(name)
      .setDesc(desc);

    const getEffectiveIcon = () =>
      String(this.plugin.settings[iconKey] || "").trim() || defaultIcon;

    const dockWrap = setting.controlEl.createDiv({
      cls: "bgm-ribbon-inline-dock"
    });
    const iconBtn = dockWrap.createEl("button", {
      type: "button",
      cls: "clickable-icon side-dock-ribbon-action bgm-ribbon-inline-btn"
    });
    iconBtn.dataset.ribbonSettingKey = iconKey;
    iconBtn.title = "点击更换图标";
    iconBtn.setAttribute("aria-label", "点击更换图标");
    renderSafeRibbonIcon(iconBtn, getEffectiveIcon(), defaultIcon);

    iconBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      new RibbonIconPickerModal(this.app, {
        title: name,
        currentIcon: getEffectiveIcon(),
        defaultIcon,
        onSelect: async (nextIcon) => {
          this.plugin.settings[iconKey] = String(nextIcon || "").trim() || defaultIcon;
          await this.plugin.saveSettings();
          renderSafeRibbonIcon(iconBtn, getEffectiveIcon(), defaultIcon);
          if (typeof refreshFn === "function") {
            refreshFn();
          }
        }
      }).open();
    };

    setting.addToggle((toggle) => {
      toggle.setValue(this.plugin.settings[toggleKey] !== false);
      toggle.onChange(async (value) => {
        this.plugin.settings[toggleKey] = value;
        await this.plugin.saveSettings();
        if (typeof refreshFn === "function") {
          refreshFn();
        }
      });
    });

    return setting;
  }

  addRoxyHdPackSetting(container) {
    const roxyModeInfo = normalizeRoxy2DModeSettings(this.plugin);
    const hdStatus = roxyModeInfo.hdStatus;

    new Setting(container)
      .setName("洛琪希高清立绘扩展包")
      .setDesc(
        hdStatus.installed
          ? `当前状态：✓ 已安装本地高清立绘扩展包（${hdStatus.foundCount}/${hdStatus.totalCount} 张透明立绘已就绪），已在番剧档案馆启用高清立绘伴读形象。`
          : `当前状态：未下载高清立绘扩展包（已存在 ${hdStatus.foundCount}/${hdStatus.totalCount} 张），当前自动使用内置轻量像素形象。点击右侧按钮可一键下载 7 张高清透明立绘到本地插件目录，自动解锁高清形象。`
      )
      .addButton((button) => {
        button
          .setButtonText(hdStatus.installed ? "重新校验 / 补全立绘包" : "一键下载高清立绘包")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("正在下载...");
            try {
              const res = await downloadRoxyHdPortraitPack(this.plugin, (done, total) => {
                button.setButtonText(`下载中 (${done}/${total})...`);
              });
              if (res && res.success) {
                new Notice("洛琪希高清立绘扩展包（7 张 PNG）已下载就位！", 5000);
                this.plugin.settings.enableRoxy2DMascotMaster = true;
                this.plugin.settings.roxyForceLightweight2D = false;
                this.plugin.settings.enableRoxy2DMascot = true;
                await this.plugin.saveSettings();
                await this.plugin.refreshOpenDashboardViews();
                this.display();
              } else {
                new Notice(
                  `高清立绘包下载未全部完成（成功 ${res?.downloaded || 0}/${res?.total || 7}），请检查网络后重试。`,
                  6000
                );
                button.setDisabled(false);
                button.setButtonText("重试下载立绘包");
              }
            } catch (err) {
              new Notice(`下载高清立绘包失败：${err?.message || err}`, 6000);
              button.setDisabled(false);
              button.setButtonText("重试下载立绘包");
            }
          });
      });

    return hdStatus;
  }

  addAtelier3DPackSettings(container, packFirst = false) {
    const syncOpen3DSpaces = async () => {
      try {
        const leaves =
          this.app?.workspace?.getLeavesOfType?.("bangumi-score-dashboard-view") ||
          this.app?.workspace?.getLeavesOfType?.("bangumi-score-dashboard") ||
          [];
        for (const lf of leaves) {
          const sp = lf?.view?.space3DInstance;
          if (sp && typeof sp.rebuildAllFolioModels === "function") {
            // eslint-disable-next-line no-await-in-loop
            await sp.rebuildAllFolioModels();
          }
        }
      } catch (_) {}
    };

    let styleDropdownRef = null;
    let dlPackBtnRef = null;
    let rmPackBtnRef = null;
    let packSettingRef = null;

    const renderPackRow = () => {
      const packSetting = new Setting(container)
        .setName("三维精装模型与 PBR 材质扩展包")
        .setDesc("正在检测本地精装模型扩展包安装状态…");
      packSettingRef = packSetting;

      packSetting.addButton((button) => {
        dlPackBtnRef = button;
        button
          .setButtonText("一键下载精装扩展包 (约 428 KB)")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("正在下载...");
            try {
              const st = await downloadAtelierHdPack(this.plugin, {
                onProgress: ({ step, total }) => {
                  button.setButtonText(`下载中 (${step}/${total})...`);
                }
              });
              if (st.installed) {
                if (this.plugin.settings.atelier3DModelStyle === "standard") {
                  this.plugin.settings.atelier3DModelStyle = "hd_cel_folio";
                  await this.plugin.saveSettings();
                }
                await syncOpen3DSpaces();
                this.display();
              }
            } catch (err) {
              new Notice(`下载三维精装扩展包失败：${err?.message || err}`, 6000);
              button.setDisabled(false);
              button.setButtonText("重试下载精装扩展包");
            }
          });
      });

      packSetting.addButton((button) => {
        rmPackBtnRef = button;
        button.setButtonText("清理扩展包").onClick(async () => {
          button.setDisabled(true);
          try {
            await removeAtelierHdPack(this.plugin);
            if (this.plugin.settings.atelier3DModelStyle !== "standard") {
              this.plugin.settings.atelier3DModelStyle = "standard";
              await this.plugin.saveSettings();
            }
            await syncOpen3DSpaces();
            this.display();
          } catch (err) {
            new Notice(`清理扩展包失败：${err?.message || err}`, 4500);
            button.setDisabled(false);
          }
        });
      });
    };

    const renderStyleRow = () => {
      const styleSetting = new Setting(container)
        .setName("三维装帧模型风格切换")
        .setDesc(
          "切换 3D 原画展厅中每部动画的实体装帧外观。内置「标准轻量原画夹」零额外体积；安装精装扩展包后可切换为「赛璐珞原画装裱夹」或「典藏精装 BD 礼盒」。"
        );

      styleSetting.addDropdown((dropdown) => {
        styleDropdownRef = dropdown;
        STYLE_CATALOG.forEach((st) => {
          dropdown.addOption(st.id, st.label);
        });
        const curStyle = ["standard", "hd_cel_folio", "hd_collector_box"].includes(
          this.plugin.settings.atelier3DModelStyle
        )
          ? this.plugin.settings.atelier3DModelStyle
          : "standard";
        dropdown.setValue(curStyle);
        dropdown.onChange(async (value) => {
          if (value !== "standard") {
            const st = await checkAtelierHdPackStatus(this.plugin);
            if (!st.installed) {
              new Notice("请先点击「一键下载精装扩展包」，安装完成后即可切换精装模型。", 4500);
              dropdown.setValue("standard");
              return;
            }
            await preloadAtelierHdPrototypes(this.plugin);
          }
          this.plugin.settings.atelier3DModelStyle = value;
          await this.plugin.saveSettings();
          await syncOpen3DSpaces();
        });
      });
    };

    if (packFirst) {
      renderPackRow();
      renderStyleRow();
    } else {
      renderStyleRow();
      renderPackRow();
    }

    checkAtelierHdPackStatus(this.plugin)
      .then((st) => {
        if (!packSettingRef?.descEl?.isConnected) return;
        if (st.installed) {
          packSettingRef.setDesc(
            `当前状态：✓ 已安装双风格精装模型扩展包（共 ${st.sizeLabel}，含「赛璐珞原画装裱夹」与「典藏精装 BD 礼盒」两套 GLB 模型及棉纸/亚麻/拉丝金属法线贴图）。支持在此处或 3D 原画展厅右上角「◷ 空间设置」内实时切换。`
          );
          if (dlPackBtnRef) dlPackBtnRef.setButtonText("重新校验 / 更新扩展包");
          if (rmPackBtnRef) rmPackBtnRef.buttonEl.style.display = "";
        } else {
          packSettingRef.setDesc(
            `当前状态：尚未安装精装模型扩展包（当前使用内置「标准轻量原画夹」）。点击右侧按钮可按需一键下载双风格精装扩展包（仅 ${st.sizeLabel}，不增加插件主包体积）。`
          );
          if (rmPackBtnRef) rmPackBtnRef.buttonEl.style.display = "none";
          if (styleDropdownRef && this.plugin.settings.atelier3DModelStyle !== "standard") {
            styleDropdownRef.setValue("standard");
          }
        }
      })
      .catch(() => {});
  }

  displayLazyMode(container) {
    this.addIntroDescription(
      container,
      "欢迎使用 Bangumi 追番管理器。以下按开馆顺序整理了从导入作品、确认保存目录到解锁完整视觉体验的五个步骤，跟着顺序操作即可快速建立您的专属追番档案馆。切换使用模式只改变设置页展示内容，不会修改任何已有数据。"
    );

    new Setting(container)
      .setName("使用模式")
      .setDesc(
        "当前为面向初次上手与日常使用的快速开始指南；需要调整进阶联动与深度规则时可随时切换至专业模式。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          lazy: "快速开始模式",
          professional: "专业模式"
        });

        dropdown.setValue("lazy");

        dropdown.onChange(async (value) => {
          this.plugin.settings.mode = value;
          await this.plugin.saveSettings();
          this.display({ scrollToTop: true });
        });
      });

    // 一、账号与导入动画
    container.createEl("h3", {
      text: "一、账号与导入动画"
    });
    this.addStepGuideNote(
      container,
      "如果只想手动搜索并建立几部喜爱的动画笔记，直接点击「导入单个动画」即可开始；如果希望把自己在 Bangumi 上的追番清单一次性搬进仓库，请先填写纯数字 Bangumi 用户 ID，再执行「批量导入动画」。"
    );

    this.addBangumiUserSetting(container, true);

    new Setting(container)
      .setName("导入单个动画")
      .setDesc("通过中文名、日文原名或条目编号搜索 Bangumi，选择作品后自动生成动画笔记并保存高清封面。")
      .addButton((button) => {
        button
          .setButtonText("导入单个动画")
          .setCta()
          .onClick(async () => {
            await openSingleAnimeImport(this.app, this.plugin);
          });
      });

    new Setting(container)
      .setName("批量导入动画")
      .setDesc("根据上方填写的 Bangumi 用户 ID 读取「在看 / 已看 / 想看」列表，批量创建追番笔记并自动跳过已有条目。")
      .addButton((button) => {
        button
          .setButtonText("批量导入动画")
          .onClick(async () => {
            await openBatchAnimeImport(this.app, this.plugin);
          });
      });

    this.addGuideDemoDrawer(container, {
      title: "搜索导入单部动画与批量同步追番列表",
      items: [
        {
          fileName: "guide-import.gif",
          caption: "输入关键词检索 Bangumi 条目并一键生成带本地封面与元数据的动画笔记。"
        }
      ]
    });

    // 二、相关路径
    const isMobile = isMobileEnv();
    container.createEl("h3", {
      text: "二、相关路径"
    });
    this.addStepGuideNote(
      container,
      "插件已为您预设好清晰合理的仓库目录结构，通常保持默认即可直接使用。日后若修改仓库内的笔记或附件目录，离开输入框后插件会在后台自动迁移已有文件并同步更新引用。"
    );

    this.addAutoDetectVaultFoldersSetting(container);

    if (!isMobile) {
      this.addLocalAnimeRootSetting(
        container,
        "新番下载或自动创建番剧目录时的默认保存总目录。散落在其他盘符的已有视频，可直接用下方「本地视频关联」原地绑定，无需移动原文件。"
      );
    }

    this.addNoteRootSetting(
      container,
      "动画笔记在仓库中的保存目录。Markdown 番剧档案馆快照会自动存放在该目录下的「追番广场」中。"
    );

    this.addCharacterNoteFolderSetting(container);

    this.addPathSetting(
      container,
      "画册本地保存路径",
      "illustrationGalleryFolder",
      "画册典藏插画与本地导入图片在仓库中的保存目录（默认：附件/画册典藏）。"
    );

    this.addPathSetting(
      container,
      "音声典藏保存目录",
      "voiceArchiveFolder",
      "音声典藏抽取与视频台词片段在仓库中的保存目录（默认：附件/音声典藏；已有附件/台词音声库目录自动兼容）。"
    );

    this.addPathMigrationStatusSetting(container);

    if (isMobile) {
      container.createDiv({
        cls: "bgm-mobile-compat-banner",
        text: "移动端精简提示：桌面端专属设置（本地视频目录、本地播放器、FFmpeg、qBittorrent 联动与桌面游戏侧边手札胶囊）已自动隐藏；电脑端已有配置会安全保留，不会受任何影响。"
      });
    }

    new Setting(container)
      .setName("初始化缺失文件")
      .setDesc(
        "按上方路径自动补齐缺失的动画笔记目录、封面目录与 Markdown 番剧档案馆快照，不会覆盖任何已有文件。"
      )
      .addButton((button) => {
        button.setButtonText("立即初始化");

        button.onClick(async () => {
          await this.plugin.initializeMissingFiles();
        });
      });

    this.addLegacyNoteUpgradeSetting(container);

    // 三、侧边栏按钮
    container.createEl("h3", {
      text: "三、侧边栏按钮"
    });

    this.addRibbonButtonSetting(container, {
      name: "显示侧边栏「打开番剧档案馆」按钮",
      desc: "在 Obsidian 左侧功能栏常驻显示番剧档案馆入口，点击左侧图标可直接更换样式。",
      toggleKey: "showDashboardRibbon",
      iconKey: "dashboardRibbonIcon",
      defaultIcon: this.plugin.defaultDashboardRibbonIcon || "bangumi-archive-hall",
      refreshFn: () => this.plugin.refreshDashboardRibbon()
    });

    this.addRibbonButtonSetting(container, {
      name: "显示侧边栏「Bangumi 追番管理器」按钮",
      desc: "在 Obsidian 左侧功能栏常驻显示追番管理快捷面板入口，点击左侧图标可直接更换样式。",
      toggleKey: "showManagerRibbon",
      iconKey: "managerRibbonIcon",
      defaultIcon: this.plugin.defaultManagerRibbonIcon || "bangumi-tv-manager",
      refreshFn: () => this.plugin.refreshManagerRibbon()
    });

    // 四、下载扩展包
    container.createEl("h3", {
      text: "四、下载扩展包"
    });
    this.addStepGuideNote(
      container,
      "为了保持插件主程序轻巧秒开，高清透明伴读立绘与三维精雕 PBR 装帧模型采用按需扩展包设计。建议在此一键下载两款扩展包，解锁番剧档案馆与 3D 原画展厅的完整视觉表现。"
    );

    this.addRoxyHdPackSetting(container);
    this.addAtelier3DPackSettings(container, true);

    this.addGuideDemoDrawer(container, {
      title: "三维精装模型风格切换与空间设置",
      items: [
        {
          fileName: "guide-3d-styles.gif",
          caption: "在标准原画夹、赛璐珞原画装裱夹与典藏精装 BD 礼盒三种实体装帧之间实时切换。"
        }
      ]
    });

    // 五、进入番剧档案馆
    container.createEl("h3", {
      text: "五、进入番剧档案馆"
    });
    this.addStepGuideNote(
      container,
      "一切准备就绪！番剧档案馆整合了六大典藏展区（追番、全部番剧、角色典藏、画册典藏、音声典藏与游戏典藏）与历年收藏书架，并内置「3D 原画展厅」（支持高分精选四柱策展，以及状态与收藏轨下的「开架回廊 / 折屏展架」双视图与立式导视牌）。即使尚未导入笔记，也可在馆内开启示例馆藏先行体验。"
    );

    new Setting(container)
      .setName("打开番剧档案馆")
      .setDesc("立即进入番剧档案馆主界面，顶栏可随时点击「3D 展厅」在档案馆与 3D 原画展厅之间无缝切换。")
      .addButton((button) => {
        button
          .setButtonText("立即打开番剧档案馆")
          .setCta()
          .onClick(async () => {
            await this.plugin.openScoreDashboardView();
          });
      });

    if (!isMobile) {
      this.addGameCapsuleSettings(container, true);
    }

    const demoGuideItems = [
      {
        fileName: "guide-archive-hall.gif",
        caption: "番剧档案馆与 3D 原画展厅一键切换，抽起实体档案夹查看详情与笔记纸页。"
      },
      {
        fileName: "guide-3d-subview.gif",
        caption: "三维「状态与收藏轨」常驻立式分栏导视牌，支持在「开架回廊」与「折屏展架」双视图间自由切换。"
      }
    ];
    if (!isMobile) {
      demoGuideItems.push({
        fileName: "guide-game-capsule.gif",
        caption: "启动已收录游戏后手札面板自动收拢至屏幕旁侧化作半透明窄条，全屏游戏内移近边缘即可展开记录并实时同步。"
      });
    }
    this.addGuideDemoDrawer(container, {
      title: isMobile
        ? "番剧档案馆与 3D 原画展厅实机导览"
        : "番剧档案馆、3D 原画展厅与游戏侧边手札实机导览",
      items: demoGuideItems
    });

    // 底部：专业模式进阶引导卡
    const proCard = container.createDiv({ cls: "bgm-pro-upgrade-card" });
    const proInfo = proCard.createDiv({ cls: "bgm-pro-upgrade-info" });
    proInfo.createDiv({
      cls: "bgm-pro-upgrade-title",
      text: "✦ 需要更深入的自动化与定制能力？随时开启「专业模式」"
    });
    proInfo.createDiv({
      cls: "bgm-pro-upgrade-desc",
      text: isMobile
        ? "熟悉基础追番管理后，切换到「专业模式」可进一步配置：各典藏目录细分路径、评分精度与自动同步、追番磁力资源检索、画册 Pixiv 分级筛选、Netaba 评分图、个人片单与智能筛选分组，以及看板娘角色与台词工坊。"
        : "熟悉基础追番管理后，切换到「专业模式」可进一步配置：本地视频播放器与观片手札帧级时间点空降、单集唯一 RSS 与 qBittorrent 自动下载查重、画册 Pixiv 在线搜图与分级筛选、Netaba 评分趋势对比、个人片单与智能筛选分组，以及看板娘角色与台词工坊。"
    });
    const proBtn = proCard.createEl("button", {
      cls: "mod-cta",
      text: "切换至专业模式 →"
    });
    proBtn.onclick = async () => {
      this.plugin.settings.mode = "professional";
      await this.plugin.saveSettings();
      this.display({ scrollToTop: true });
      container.scrollTo?.({ top: 0, behavior: "smooth" });
    };

    this.addHelpAndCommunitySection(container);
  }

  displayProfessionalMode(container, topHudMount) {
    const isMobile = isMobileEnv();
    this.addIntroDescription(
      container,
      isMobile
        ? "专业模式展示移动端可用的完整设置。桌面端专属配置（本地播放器、qBittorrent、FFmpeg、桌面侧边游戏手札胶囊）已自动隐藏，电脑端原有路径会被安全保留。"
        : "专业模式展示完整设置。路径、评分监测、番剧档案馆（含 3D 原画展厅）、季度视图、笔记显示、Netaba 和全部管理操作均可在这里调整。切换模式只改变展示，不会修改已有配置。"
    );

    new Setting(container)
      .setName("使用模式")
      .setDesc(
        "专业模式显示完整配置项。切换模式只改变设置项展示，不会修改已有配置。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          lazy: "快速开始模式",
          professional: "专业模式"
        });

        dropdown.setValue("professional");

        dropdown.onChange(async (value) => {
          this.plugin.settings.mode = value;

          await this.plugin.saveSettings();
          this.display({ scrollToTop: true });
        });
      });

    container.createEl("h3", {
      text: "路径与目录"
    });

    this.addAutoDetectVaultFoldersSetting(container);

    this.addNoteRootSetting(
      container,
      "扫描和管理 Bangumi 动画笔记的仓库目录。"
    );

    this.addCharacterNoteFolderSetting(container);

    this.addGameNoteFolderSetting(container);

    this.addBaseFolderSetting(container);

    this.addPathSetting(
      container,
      "动画封面图片目录",
      "coverFolder",
      "动画条目封面图片的本地仓库保存目录（默认：附件/动画封面；修改后自动迁移已有动画封面并更新笔记引用）。"
    );

    this.addPathSetting(
      container,
      "角色典藏立绘目录",
      "characterImageFolder",
      "角色典藏立绘与头像图片的仓库保存目录（默认：附件/角色立绘；修改后自动迁移已有角色立绘并更新引用）。"
    );

    this.addPathSetting(
      container,
      "观片手札图片目录",
      "reviewImageFolder",
      isMobile
        ? "观片手札附图与截屏图片保存的仓库目录（默认：附件/观片手札图片；修改后自动迁移）。"
        : "观片手札粘贴截图（Ctrl+V）、时间轴打点截图与上传附图保存的仓库目录（默认：附件/观片手札图片；修改后自动迁移）。"
    );

    this.addPathSetting(
      container,
      "画册本地保存路径（画册典藏图片目录）",
      "illustrationGalleryFolder",
      "画册典藏（含 Pixiv 插画、角色画作与本地导入图片）的仓库保存目录（默认：附件/画册典藏；修改后自动迁移已有画册插画）。"
    );

    this.addPathSetting(
      container,
      "游戏典藏封面目录",
      "gameImageFolder",
      "游戏典藏封面图片的仓库保存目录（默认：附件/游戏封面；修改后自动迁移）。"
    );

    this.addPathSetting(
      container,
      "音声典藏保存目录",
      "voiceArchiveFolder",
      "音声典藏抽取的语音文件与视频字幕截取音频的仓库保存目录（默认：附件/音声典藏；已有附件/台词音声库目录自动兼容；修改后自动迁移已有音频并更新卡片引用）。"
    );

    this.addPathMigrationStatusSetting(container);

    if (!isMobile) {
      this.addLocalAnimeRootSetting(
        container,
        "仅用于新下载或一键新建番剧文件夹时的默认位置（可留空）；已有视频可通过「本地视频关联」跨盘符原地绑定，不会移动原文件。"
      );

      this.addFfmpegSetting(container);
    } else {
      container.createDiv({
        cls: "bgm-mobile-compat-banner",
        text: "移动端精简提示：桌面端专属路径与联动（本地动画视频根目录、FFmpeg、本地播放器、qBittorrent 与桌面侧边游戏手札胶囊）已自动隐藏；电脑端已有配置不会被改动。"
      });
    }

    if (!isMobile) {
      container.createEl("h3", {
        text: "本地播放与状态检查"
      });
      this.addReviewAndPlayerSettings(container, false);
      this.addCheckSettings(container);
      this.addSeasonSettings(container);
    }

    container.createEl("h3", {
      text: "追番下载与自动追更"
    });
    this.addDownloadAndAutoFollowSettings(container);

    container.createEl("h3", {
      text: "评分、排名与 Netaba"
    });
    this.addBangumiUserSetting(container);
    this.addBangumiSettings(container, { skipHeading: true });
    this.addNetabaSettings(container, false, { skipHeading: true });

    container.createEl("h3", {
      text: "番剧档案馆与外观"
    });
    this.addArchiveHallSettings(container);

    container.createEl("h3", {
      text: "洛琪希与看板娘"
    });
    this.addRoxyMascotSettings(container);

    container.createEl("h3", {
      text: "画册、3D、游戏与直播"
    });
    this.addHallsAndLiveSettings(container);

    container.createEl("h3", {
      text: "笔记、入口与快速操作"
    });
    this.addDisplaySettings(container, { skipHeading: true });
    if (isMobile) {
      this.addSeasonSettings(container);
    }

    this.addRibbonButtonSetting(container, {
      name: "显示侧边栏「Bangumi 追番管理器」按钮",
      desc: "开启后，在 Obsidian 左侧功能栏显示「Bangumi 追番管理器」快捷管理面板按钮（点击左侧图标可更换样式）。",
      toggleKey: "showManagerRibbon",
      iconKey: "managerRibbonIcon",
      defaultIcon: this.plugin.defaultManagerRibbonIcon || "bangumi-tv-manager",
      refreshFn: () => this.plugin.refreshManagerRibbon()
    });

    this.addProfessionalActions(container);
    this.addHelpAndCommunitySection(container);

    // 挂载顶栏搜索与「按模块 / 按需求」快速定位栏（独立于 .setting-item 之外）
    this.mountProfessionalSettingsSpotlightHud(container, topHudMount);
  }

  mountProfessionalSettingsSpotlightHud(container, topHudMount) {
    if (!container) return;
    const isMobile = isMobileEnv();
    const hostMount = topHudMount || container.createDiv("bgm-settings-top-hud-mount");
    hostMount.empty();

    const hud = hostMount.createDiv("bgm-settings-sticky-hud");
    const topRow = hud.createDiv("bgm-settings-hud-top");

    const brandWrap = topRow.createDiv("bgm-settings-hud-brand");
    brandWrap.createEl("h2", {
      cls: "bgm-settings-hud-title",
      text: "Bangumi 追番管理器"
    });
    brandWrap.createSpan({
      cls: "bgm-settings-hud-mode-badge",
      text: isMobile ? "专业模式 · 移动版" : "专业模式"
    });
    this.createBriefToggleButton(brandWrap, container);

    // 右侧：搜索框
    const searchCapsule = topRow.createDiv("bgm-settings-spotlight-capsule");
    const searchIconEl = searchCapsule.createSpan({
      cls: "bgm-settings-spotlight-icon"
    });
    renderSafeRibbonIcon(searchIconEl, "search", "search");
    const searchInput = searchCapsule.createEl("input", {
      type: "text",
      cls: "bgm-settings-spotlight-input",
      placeholder: isMobile
        ? "搜索设置（如：目录、评分、洛琪希）"
        : "搜索设置项、常用名或拼音缩写（如：弹弹、播放器、蜜柑、lqx）…"
    });
    searchInput.value = this._savedSpotlightQuery || "";

    const metaRight = searchCapsule.createDiv("bgm-settings-spotlight-meta");
    const countBadge = metaRight.createSpan({
      cls: "bgm-settings-spotlight-count",
      text: "全部设置"
    });
    const clearBtn = metaRight.createEl("button", {
      cls: "bgm-settings-spotlight-clear",
      text: "×"
    });
    clearBtn.type = "button";
    clearBtn.title = "清空搜索与筛选 (Esc)";

    // 第二行：「按模块 | 按需求」双归类切换 + 导航胶囊
    const compassRail = hud.createDiv("bgm-settings-compass-rail");
    const compassHead = compassRail.createDiv("bgm-settings-compass-head");
    const compassHeadLeft = compassHead.createDiv("bgm-settings-compass-head-left");
    const viewSeg = compassHeadLeft.createDiv("bgm-settings-view-seg");
    const moduleModeBtn = viewSeg.createEl("button", {
      cls: "bgm-settings-view-seg-btn",
      text: "按模块"
    });
    moduleModeBtn.type = "button";
    moduleModeBtn.title = "按页面原有模块章节浏览或跳转";
    const intentModeBtn = viewSeg.createEl("button", {
      cls: "bgm-settings-view-seg-btn",
      text: "按需求"
    });
    intentModeBtn.type = "button";
    intentModeBtn.title = "按常见使用目的跨章节汇总相关设置（不打散原分类）";
    const compassSubHint = compassHeadLeft.createSpan({
      cls: "bgm-settings-compass-subhint",
      text: ""
    });

    const chipsWrap = compassRail.createDiv("bgm-settings-compass-chips");

    // 需求筛选状态提示条（仅在「按需求」选中具体场景且未输入搜索词时显示）
    const intentBar = hud.createDiv("bgm-settings-intent-bar");
    const intentBarText = intentBar.createSpan();
    const intentResetBtn = intentBar.createEl("button", {
      cls: "bgm-settings-intent-reset",
      text: "查看全部"
    });
    intentResetBtn.type = "button";

    // 扫描 container 下所有章节标题 (h3) 与设置项 (.setting-item 及有效自定义卡片)
    const sections = [];
    const indexedItems = [];
    let currentSection = {
      key: "sec-general",
      title: "模式与概览",
      headingEl: null,
      extraEls: [],
      items: []
    };
    sections.push(currentSection);

    const children = Array.from(container.children).filter((el) => el !== hostMount);
    children.forEach((el, idx) => {
      const tag = (el.tagName || "").toUpperCase();
      if (tag === "H3") {
        const rawTitle = (el.textContent || "").trim() || `分组 ${sections.length}`;
        currentSection = {
          key: `sec-${idx}-${rawTitle}`,
          title: rawTitle,
          headingEl: el,
          extraEls: [],
          items: []
        };
        sections.push(currentSection);
        return;
      }

      if (el.classList && el.classList.contains("setting-item")) {
        const nameEl = el.querySelector(".setting-item-name");
        const descEl = el.querySelector(".setting-item-description");
        const ctrlEl = el.querySelector(".setting-item-control");
        const origNameText = nameEl ? (nameEl.textContent || "").trim() : "";
        const origDescText = descEl ? (descEl.textContent || "").trim() : "";
        const ctrlText = ctrlEl ? (ctrlEl.textContent || "").trim() : "";
        const rec = {
          el,
          nameEl,
          descEl,
          companionEls: [],
          origNameText,
          origDescText,
          nameLower: origNameText.toLowerCase(),
          descLower: origDescText.toLowerCase(),
          ctrlLower: ctrlText.toLowerCase(),
          sectionKey: currentSection.key,
          sectionTitle: currentSection.title,
          sectionLower: currentSection.title.toLowerCase(),
          fullHaystack: `${currentSection.title} ${origNameText} ${origDescText} ${ctrlText}`.toLowerCase()
        };
        currentSection.items.push(rec);
        indexedItems.push(rec);
        return;
      }

      // 外观主题可视化选择网格归属于紧邻上一条「番剧档案馆外观主题」设置项，不重复计数，筛选与搜索时同步显隐
      if (el.classList && el.classList.contains("bm7-settings-appearance-host") && currentSection.items.length > 0) {
        const ownerRec = currentSection.items[currentSection.items.length - 1];
        ownerRec.companionEls.push(el);
        const pickerText = (el.textContent || "").trim().toLowerCase();
        if (pickerText) {
          ownerRec.descLower = `${ownerRec.descLower} ${pickerText}`.trim();
          ownerRec.fullHaystack = `${ownerRec.fullHaystack} ${pickerText}`.trim();
        }
        return;
      }

      // 子标题 (h4)、说明段落 (p) 与提示横幅只作页面附属元素，不计入设置条目数，也不参与搜索误匹配
      if (
        tag === "H4" ||
        tag === "P" ||
        (el.classList &&
          (el.classList.contains("bgm-mobile-compat-banner") ||
            el.classList.contains("bgm-guide-step-note") ||
            el.classList.contains("bgm-settings-intro-p")))
      ) {
        currentSection.extraEls.push(el);
        return;
      }

      // 帮助区的 GitHub / 交流群卡片等独立功能卡
      const blockText = (el.textContent || "").trim();
      if (blockText && currentSection.key !== "sec-general") {
        const rec = {
          el,
          nameEl: null,
          descEl: null,
          companionEls: [],
          origNameText: currentSection.title,
          origDescText: blockText,
          nameLower: currentSection.title.toLowerCase(),
          descLower: blockText.toLowerCase(),
          ctrlLower: "",
          sectionKey: currentSection.key,
          sectionTitle: currentSection.title,
          sectionLower: currentSection.title.toLowerCase(),
          fullHaystack: `${currentSection.title} ${blockText}`.toLowerCase()
        };
        currentSection.items.push(rec);
        indexedItems.push(rec);
      } else {
        currentSection.extraEls.push(el);
      }
    });

    // 为每条设置项预计算匹配的「按需求」分组列表
    const intentBuckets = SETTINGS_INTENT_GROUPS.map((grp) => {
      const matched = indexedItems.filter((rec) => rec.sectionKey !== "sec-general" && grp.match(rec));
      return {
        key: grp.key,
        label: grp.label,
        hint: grp.hint,
        items: matched,
        itemSet: new Set(matched)
      };
    }).filter((b) => b.items.length > 0);
    const intentByKey = new Map(intentBuckets.map((b) => [b.key, b]));

    // 校验已保存的章节/需求键仍然有效（例如桌面/移动切换或设置项增减后）
    if (this._savedBrowseMode !== "intent") this._savedBrowseMode = "module";
    if (
      this._savedFocusSectionKey !== "all" &&
      !sections.some((s) => s.key === this._savedFocusSectionKey && s.items.length > 0)
    ) {
      this._savedFocusSectionKey = "all";
    }
    if (this._savedFocusIntentKey !== "all" && !intentByKey.has(this._savedFocusIntentKey)) {
      this._savedFocusIntentKey = "all";
    }

    // 空搜索结果提示面板
    const emptyStateBox = container.createDiv("bgm-settings-empty-search");
    emptyStateBox.createDiv({
      cls: "bgm-settings-empty-title",
      text: "未找到匹配的设置项"
    });
    emptyStateBox.createDiv({
      cls: "bgm-settings-empty-sub",
      text: isMobile
        ? "可尝试输入更短的关键词（如：目录、评分、画册、角色、洛琪希）或点击下方常用词："
        : "可尝试输入更短的关键词（如：弹弹、播放器、蜜柑、身高、洛琪希）或点击下方常用词："
    });
    const emptySugRow = emptyStateBox.createDiv("bgm-settings-empty-suggestions");
    const suggestions = isMobile
      ? [
          { label: "追番磁力下载", q: "下载" },
          { label: "角色典藏目录", q: "角色" },
          { label: "洛琪希记录员", q: "洛琪希" },
          { label: "番剧档案馆", q: "番剧档案馆" },
          { label: "路径与封面目录", q: "目录" }
        ]
      : [
          { label: "本地播放器联动", q: "播放器" },
          { label: "追番下载与 RSS", q: "下载" },
          { label: "角色典藏目录", q: "角色" },
          { label: "洛琪希记录员", q: "洛琪希" },
          { label: "番剧档案馆", q: "番剧档案馆" },
          { label: "路径与封面目录", q: "目录" }
        ];
    suggestions.forEach((sug) => {
      const sb = emptySugRow.createEl("button", {
        cls: "bgm-settings-compass-chip",
        text: sug.label
      });
      sb.type = "button";
      sb.onclick = (e) => {
        e.preventDefault();
        searchInput.value = sug.q;
        this._savedSpotlightQuery = sug.q;
        this._savedFocusSectionKey = "all";
        this._savedFocusIntentKey = "all";
        applyFilterAndHighlight();
      };
    });

    // 右侧切换「点击跳至章 vs 仅看选中章」（仅在按模块模式下展示，与「按模块 | 按需求」齐平）
    const focusModeBtn = compassHead.createEl("button", {
      cls: `bgm-settings-compass-mode-btn ${this._savedFocusOnlyMode ? "is-focus-only" : ""}`,
      text: this._savedFocusOnlyMode ? "模式：仅看选中章" : "模式：点击跳至章"
    });
    focusModeBtn.type = "button";
    focusModeBtn.title = "切换章节按钮行为：「点击滚动跳转到对应章节」或「仅显示选中的单个章节」";

    let chipRefs = [];
    const rebuildCompassChips = () => {
      chipsWrap.empty();
      chipRefs = [];
      const browseMode = this._savedBrowseMode === "intent" ? "intent" : "module";
      moduleModeBtn.toggleClass("is-active", browseMode === "module");
      intentModeBtn.toggleClass("is-active", browseMode === "intent");
      focusModeBtn.style.display = browseMode === "module" ? "" : "none";
      compassSubHint.setText(
        browseMode === "intent" ? "跨章节汇总常用场景，不改动原分组" : "按功能章节浏览或跳转"
      );

      const makeChip = (chipKey, labelText, countNum, titleText, onClick) => {
        const chip = chipsWrap.createEl("button", {
          cls: "bgm-settings-compass-chip"
        });
        chip.type = "button";
        if (titleText) chip.title = titleText;
        chip.createSpan({ text: labelText });
        if (typeof countNum === "number") {
          chip.createSpan({
            cls: "bgm-settings-compass-chip-cnt",
            text: `${countNum}`
          });
        }
        chip.onclick = (e) => {
          e.preventDefault();
          onClick();
        };
        chipRefs.push({ key: chipKey, chip });
      };

      if (browseMode === "module") {
        makeChip("all", "全部", indexedItems.length, "显示全部设置项", () => {
          this._savedFocusSectionKey = "all";
          applyFilterAndHighlight();
          container.scrollTo?.({ top: 0, behavior: "smooth" });
        });
        sections.forEach((sec) => {
          if (sec.key === "sec-general" || sec.items.length === 0) return;
          makeChip(sec.key, sec.title, sec.items.length, `定位到「${sec.title}」`, () => {
            if (this._savedFocusOnlyMode) {
              this._savedFocusSectionKey =
                this._savedFocusSectionKey === sec.key ? "all" : sec.key;
              applyFilterAndHighlight();
            } else {
              if (this._savedFocusSectionKey !== "all") {
                this._savedFocusSectionKey = sec.key;
              }
              if (searchInput.value.trim()) {
                searchInput.value = "";
                this._savedSpotlightQuery = "";
              }
              applyFilterAndHighlight();
              if (sec.headingEl && typeof sec.headingEl.scrollIntoView === "function") {
                sec.headingEl.scrollIntoView({ behavior: "smooth", block: "start" });
                sec.headingEl.classList.remove("bgm-section-pulse-highlight");
                void sec.headingEl.offsetWidth;
                sec.headingEl.classList.add("bgm-section-pulse-highlight");
              }
            }
          });
        });
      } else {
        makeChip("all", "全部", indexedItems.length, "显示全部设置项", () => {
          this._savedFocusIntentKey = "all";
          applyFilterAndHighlight();
          container.scrollTo?.({ top: 0, behavior: "smooth" });
        });
        intentBuckets.forEach((bucket) => {
          makeChip(bucket.key, bucket.label, bucket.items.length, bucket.hint, () => {
            if (searchInput.value.trim()) {
              searchInput.value = "";
              this._savedSpotlightQuery = "";
            }
            this._savedFocusIntentKey =
              this._savedFocusIntentKey === bucket.key ? "all" : bucket.key;
            applyFilterAndHighlight();
          });
        });
      }
    };

    moduleModeBtn.onclick = (e) => {
      e.preventDefault();
      if (this._savedBrowseMode === "module") return;
      this._savedBrowseMode = "module";
      this._savedFocusIntentKey = "all";
      rebuildCompassChips();
      applyFilterAndHighlight();
    };

    intentModeBtn.onclick = (e) => {
      e.preventDefault();
      if (this._savedBrowseMode === "intent") return;
      this._savedBrowseMode = "intent";
      this._savedFocusSectionKey = "all";
      rebuildCompassChips();
      applyFilterAndHighlight();
    };

    focusModeBtn.onclick = (e) => {
      e.preventDefault();
      this._savedFocusOnlyMode = !this._savedFocusOnlyMode;
      if (!this._savedFocusOnlyMode) {
        this._savedFocusSectionKey = "all";
      } else if (this._savedFocusSectionKey === "all" && sections.length > 1) {
        this._savedFocusSectionKey = sections[1].key;
      }
      focusModeBtn.toggleClass("is-focus-only", this._savedFocusOnlyMode);
      focusModeBtn.setText(
        this._savedFocusOnlyMode ? "模式：仅看选中章" : "模式：点击跳至章"
      );
      applyFilterAndHighlight();
    };

    intentResetBtn.onclick = (e) => {
      e.preventDefault();
      this._savedFocusIntentKey = "all";
      applyFilterAndHighlight();
    };

    // 渲染匹配高亮与来源章节小标签
    const updateItemNamePresentation = (rec, showHighlight, showCrumb, matchedTokens) => {
      if (!rec.nameEl) return;
      rec.nameEl.empty();
      const rawTitle = rec.origNameText;
      let hitToken = "";
      if (showHighlight && matchedTokens && matchedTokens.length > 0) {
        const lowerTitle = rawTitle.toLowerCase();
        for (const tk of matchedTokens) {
          if (tk && lowerTitle.includes(tk) && tk.length > hitToken.length) {
            hitToken = tk;
          }
        }
      }
      if (hitToken) {
        const lowerTitle = rawTitle.toLowerCase();
        const idx = lowerTitle.indexOf(hitToken);
        const before = rawTitle.slice(0, idx);
        const mid = rawTitle.slice(idx, idx + hitToken.length);
        const after = rawTitle.slice(idx + hitToken.length);
        if (before) rec.nameEl.appendText(before);
        rec.nameEl.createEl("mark", { cls: "bgm-setting-hit-mark", text: mid });
        if (after) rec.nameEl.appendText(after);
      } else {
        rec.nameEl.setText(rawTitle);
      }
      if (showCrumb && rec.sectionTitle && rec.sectionKey !== "sec-general") {
        rec.nameEl.classList.add("has-bgm-crumb");
        rec.nameEl.createSpan({
          cls: "bgm-setting-section-crumb",
          text: rec.sectionTitle
        });
      } else {
        rec.nameEl.classList.remove("has-bgm-crumb");
      }
    };

    const setRecHidden = (rec, hidden) => {
      rec.el.classList.toggle("bgm-settings-search-hidden", hidden);
      if (Array.isArray(rec.companionEls)) {
        rec.companionEls.forEach((compEl) => {
          compEl.classList.toggle("bgm-settings-search-hidden", hidden);
        });
      }
    };

    const applyFilterAndHighlight = () => {
      const q = searchInput.value.trim();
      this._savedSpotlightQuery = q;
      const isSearchActive = q.length > 0;
      const browseMode = this._savedBrowseMode === "intent" ? "intent" : "module";
      const activeSecKey = browseMode === "module" ? (this._savedFocusSectionKey || "all") : "all";
      const activeIntentKey = browseMode === "intent" ? (this._savedFocusIntentKey || "all") : "all";
      const activeIntent = activeIntentKey !== "all" ? intentByKey.get(activeIntentKey) : null;
      const isIntentFilterActive = !isSearchActive && Boolean(activeIntent);

      // 搜索栏有内容时隐藏简略说明模式下多余的 ⓘ 展开开关（此时匹配项已自动展示完整说明）
      container.classList.toggle("is-bgm-search-active", isSearchActive);

      const hasAnyFilter = isSearchActive || activeSecKey !== "all" || activeIntentKey !== "all";
      clearBtn.toggleClass("is-visible", hasAnyFilter);

      const activeChipKey = browseMode === "intent" ? activeIntentKey : activeSecKey;
      chipRefs.forEach((r) => {
        r.chip.toggleClass("is-active", !isSearchActive && r.key === activeChipKey);
      });

      let visibleItemCount = 0;

      sections.forEach((sec) => {
        let secVisibleCount = 0;
        const secAllowedByModule =
          isSearchActive || isIntentFilterActive || activeSecKey === "all" || sec.key === activeSecKey;

        sec.items.forEach((rec) => {
          if (!secAllowedByModule) {
            setRecHidden(rec, true);
            rec.el.classList.remove("is-bgm-search-match");
            updateItemNamePresentation(rec, false, false, []);
            return;
          }
          if (isIntentFilterActive && !activeIntent.itemSet.has(rec)) {
            setRecHidden(rec, true);
            rec.el.classList.remove("is-bgm-search-match");
            updateItemNamePresentation(rec, false, false, []);
            return;
          }
          const res = scoreSettingFuzzyMatch(q, rec);
          if (res.matched) {
            setRecHidden(rec, false);
            rec.el.classList.toggle("is-bgm-search-match", isSearchActive);
            updateItemNamePresentation(
              rec,
              isSearchActive,
              isSearchActive || isIntentFilterActive,
              res.matchedTokens
            );
            secVisibleCount++;
            visibleItemCount++;
          } else {
            setRecHidden(rec, true);
            rec.el.classList.remove("is-bgm-search-match");
            updateItemNamePresentation(rec, false, false, []);
          }
        });

        sec.extraEls.forEach((exEl) => {
          exEl.classList.toggle(
            "bgm-settings-search-hidden",
            isSearchActive || isIntentFilterActive || (activeSecKey !== "all" && sec.key !== activeSecKey)
          );
        });

        if (sec.headingEl) {
          sec.headingEl.classList.toggle("bgm-settings-search-hidden", secVisibleCount === 0);
        }
      });

      if (isIntentFilterActive && activeIntent) {
        intentBarText.empty();
        intentBarText.appendText("已按「");
        intentBarText.createEl("strong", { text: activeIntent.label });
        intentBarText.appendText(`」跨章汇总 ${visibleItemCount} 项相关设置（原始分组未改动）`);
        intentBar.classList.add("is-visible");
      } else {
        intentBar.classList.remove("is-visible");
      }

      if (isSearchActive) {
        countBadge.setText(
          isMobile
            ? `${visibleItemCount}/${indexedItems.length}`
            : `命中 ${visibleItemCount} / ${indexedItems.length} 项`
        );
      } else if (isIntentFilterActive) {
        countBadge.setText(
          isMobile ? `关联 ${visibleItemCount}` : `已汇总 ${visibleItemCount} 项`
        );
      } else if (activeSecKey !== "all") {
        countBadge.setText(
          isMobile ? `本章 ${visibleItemCount}` : `当前章 ${visibleItemCount} 项`
        );
      } else {
        countBadge.setText(
          isMobile ? `共 ${indexedItems.length} 项` : `共 ${indexedItems.length} 项设置`
        );
      }

      emptyStateBox.toggleClass("is-visible", visibleItemCount === 0);
    };

    searchInput.addEventListener("input", () => {
      applyFilterAndHighlight();
    });

    searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        searchInput.value = "";
        this._savedSpotlightQuery = "";
        this._savedFocusSectionKey = "all";
        this._savedFocusIntentKey = "all";
        applyFilterAndHighlight();
      }
    });

    clearBtn.onclick = (e) => {
      e.preventDefault();
      searchInput.value = "";
      this._savedSpotlightQuery = "";
      this._savedFocusSectionKey = "all";
      this._savedFocusIntentKey = "all";
      applyFilterAndHighlight();
      searchInput.focus();
    };

    rebuildCompassChips();
    applyFilterAndHighlight();
  }

  addReviewAndPlayerSettings(container, compact) {
    if (isMobileEnv()) return;
    let playerInfo = null;
    try {
      playerInfo = reviewStudioService.detectInstalledVideoPlayers(this.plugin);
    } catch (e) {
      playerInfo = null;
    }
    const detectedEntries = playerInfo && playerInfo.detected
      ? Object.values(playerInfo.detected).filter((d) => d && d.installed)
      : [];
    const detectedSummary =
      detectedEntries.length > 0
        ? "当前本机已自动探测到：" +
          detectedEntries
            .map((p) => {
              const nameMap = {
                potplayer: "PotPlayer",
                dandanplay: "弹弹play",
                mpv: "MPV",
                vlc: "VLC",
                mpc: "MPC-HC/BE"
              };
              return `${nameMap[p.kind] || p.kind} (${p.exePath})`;
            })
            .join(" ； ") +
          (playerInfo?.activeLabel
            ? `\n→ 当前生效播放器：${playerInfo.activeLabel}${playerInfo.activeExePath ? " (" + playerInfo.activeExePath + ")" : ""}`
            : "")
        : "当前未在默认路径探测到 PotPlayer / 弹弹play，可在下方手动指定 .exe 或 .lnk 快捷方式路径。";

    new Setting(container)
      .setName("本地视频播放器联动（剧集播放与手札时间点空降）")
      .setDesc(
        "点击观片手札上的「▶ EP03 · 14:22」时间点徽章或卡片上的「▶ 播放」按钮时调用的本地播放器。PotPlayer 支持直接空降到对应时间点（/seek=）；弹弹play 支持直接打开对应话数视频并自动复制时间码到剪贴板。\n" +
          detectedSummary
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          auto: "自动检测（优先 PotPlayer 空降，其次 弹弹play）",
          potplayer: "PotPlayer（打开视频并精确空降到时间点）",
          dandanplay: "弹弹play（打开视频并自动复制时间码）",
          mpv: "MPV（--start= 精确空降）",
          vlc: "VLC（--start-time= 精确空降）",
          mpc: "MPC-HC / MPC-BE（/startpos 精确空降）",
          custom: "自定义播放器路径（支持 .exe 或 .lnk）",
          system: "系统默认关联程序"
        });
        dropdown.setValue(this.plugin.settings.localVideoPlayerMode || "auto");
        dropdown.onChange(async (value) => {
          this.plugin.settings.localVideoPlayerMode = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const rawCustomPath = String(this.plugin.settings.localVideoPlayerCustomPath || "").trim();
    let resolvedHint = "";
    if (rawCustomPath) {
      const resolved = reviewStudioService.resolveExecutableOrShortcutPath(rawCustomPath);
      if (resolved) {
        resolvedHint =
          rawCustomPath.toLowerCase().endsWith(".lnk")
            ? `\n✓ 已自动从快捷方式解析真实程序路径：${resolved}`
            : `\n✓ 程序路径有效：${resolved}`;
      } else {
        resolvedHint = `\n! 未找到该路径对应的程序文件，请检查路径是否正确。`;
      }
    }

    if (!compact || this.plugin.settings.localVideoPlayerMode === "custom" || rawCustomPath) {
      const playerPathSetting = new Setting(container)
        .setName("自定义视频播放器路径（支持 .exe / .lnk / macOS .app）")
        .setDesc(
          "可填写或浏览选择播放器可执行文件、快捷方式或应用路径；留空则按所选模式自动探测本机安装的播放器。" +
            resolvedHint
        )
        .addText((text) => {
          text.setPlaceholder("留空则自动探测本机安装的播放器");
          text.setValue(rawCustomPath);
          text.onChange(async (value) => {
            this.plugin.settings.localVideoPlayerCustomPath = value.trim();
            await this.plugin.saveSettings();
          });
        });
      if (isDesktopNodeAvailable()) {
        playerPathSetting.addButton((btn) => {
          btn.setButtonText("浏览...").onClick(() => {
            const fInput = document.createElement("input");
            fInput.type = "file";
            if (typeof process !== "undefined" && process.platform === "win32") {
              fInput.accept = ".exe,.lnk,.bat,.cmd";
            }
            fInput.onchange = async () => {
              const file = fInput.files && fInput.files[0];
              const picked = getNativeFilePathCrossPlatform(file);
              if (picked) {
                this.plugin.settings.localVideoPlayerCustomPath = picked;
                await this.plugin.saveSettings();
                this.display();
              }
            };
            fInput.click();
          });
        });
      }
    }
  }

  addBangumiUserSetting(container, isQuickStart = false) {
    new Setting(container)
      .setName("Bangumi 用户 ID")
      .setDesc(
        isQuickStart
          ? "填写您的 Bangumi 纯数字用户编号（个人主页网址末尾数字），用于一键批量导入您在 Bangumi 上的在看、已看与想看作品并同步个人评分。"
          : "用于批量导入动画、打开 Bangumi 用户评分排行和读取用户评分。未单独指定 Netaba 用户编号时也会默认复用该 ID。"
      )
      .addText((text) => {
        text.setPlaceholder("例如：890645");

        text.setValue(
          String(
            this.plugin.settings.bangumiUserId || ""
          )
        );

        text.onChange(async (value) => {
          const userId = value.trim();

          if (userId && !/^\d+$/.test(userId)) {
            new Notice(
              "Bangumi 用户 ID 只能填写数字。",
              5000
            );
            return;
          }

          this.plugin.settings.bangumiUserId =
            userId;

          if (
            this.plugin.settings.netabaUserIdManuallySet !==
            true
          ) {
            this.plugin.settings.netabaUserId =
              userId;
          }

          await this.plugin.saveSettings();
        });
      });
  }

  addDashboardSettings(container, compact) {
    if (compact) {
      this.addRibbonButtonSetting(container, {
        name: "显示侧边栏「打开番剧档案馆」按钮",
        desc: "开启后，在 Obsidian 左侧功能栏显示「打开番剧档案馆」入口按钮（点击左侧图标可更换样式）。",
        toggleKey: "showDashboardRibbon",
        iconKey: "dashboardRibbonIcon",
        defaultIcon: this.plugin.defaultDashboardRibbonIcon || "bangumi-archive-hall",
        refreshFn: () => this.plugin.refreshDashboardRibbon()
      });
      this.addReviewAndPlayerSettings(container, compact);
      this.addHallsAndLiveSettings(container);
      return;
    }
    this.addArchiveHallSettings(container);
    this.addRoxyMascotSettings(container);
    this.addDownloadAndAutoFollowSettings(container);
    this.addHallsAndLiveSettings(container);
  }

  addHallsAndLiveSettings(container) {
    this.addScoreSectionTitle(container, "画册典藏与 Pixiv 搜图");

    new Setting(container)
      .setName("画册典藏 · Pixiv 年龄分级筛选")
      .setDesc(
        "控制「画册典藏」在线搜图时对 Pixiv 年龄阶段内容的过滤策略，与 Pixiv 官方分级对齐（默认仅展示全年龄内容，自动排除 R-18）。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          safe: "全年龄（排除 R-18 · 默认）",
          safe_strict: "全年龄·严选（排除敏感内容）",
          all: "全部年龄（含 R-18）",
          r18: "仅 R-18"
        });
        const curMode = ["safe", "safe_strict", "all", "r18"].includes(
          this.plugin.settings.illustAgeMode
        )
          ? this.plugin.settings.illustAgeMode
          : "safe";
        dropdown.setValue(curMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.illustAgeMode = value;
          if (this.plugin.__illustGalleryState) {
            this.plugin.__illustGalleryState.ageMode = value;
          }
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenDashboardViews();
        });
      });

    new Setting(container)
      .setName("画册典藏 · 默认排除 AI 生成作品")
      .setDesc(
        "开启后在 Pixiv 在线搜图时默认过滤 AI 生成插画（ai_type=1 与 AI 标签双重识别），也可在画册搜图栏随时一键切换。"
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.illustExcludeAI !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.illustExcludeAI = value;
          if (this.plugin.__illustGalleryState) {
            this.plugin.__illustGalleryState.excludeAI = value;
          }
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenDashboardViews();
        });
      });

    this.addScoreSectionTitle(container, "3D 原画展厅与精装模型扩展包");
    this.addAtelier3DPackSettings(container, false);

    if (!isMobileEnv()) {
      this.addScoreSectionTitle(container, "游戏典藏 · 桌面侧边手札胶囊");
      this.addGameCapsuleSettings(container, false, { skipHeading: true });
    }

    this.addScoreSectionTitle(container, "B 站直播间开播监测");
    bilibiliLiveService.ensureBilibiliLiveSettings(this.plugin);
    new Setting(container)
      .setName("B 站直播间开播监测")
      .setDesc("开启后，插件将按设定间隔查询您关注的动画博主直播状态（默认含泛式 33989、瓶子君152 42062）。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.bilibiliLiveMonitorEnabled !== false)
          .onChange(async (value) => {
            this.plugin.settings.bilibiliLiveMonitorEnabled = value;
            await this.plugin.saveSettings();
            if (value) {
              bilibiliLiveService.startBilibiliLiveMonitor(this.plugin);
            } else {
              bilibiliLiveService.stopBilibiliLiveMonitor(this.plugin);
            }
          });
      });

    if (!isMobileEnv()) {
      new Setting(container)
        .setName("直播开播 Windows 系统通知")
        .setDesc("检测到关注主播刚开播时，在 Windows 系统右下角弹出原生通知（点击通知可直接打开直播网页）。")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.bilibiliLiveSystemNotifyEnabled !== false)
            .onChange(async (value) => {
              this.plugin.settings.bilibiliLiveSystemNotifyEnabled = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton((btn) => {
          btn.setButtonText("发送测试通知").onClick(() => {
            bilibiliLiveService.triggerTestLiveNotification(this.plugin);
          });
        });
    } else {
      new Setting(container)
        .setName("手机 / 平板点击直播间打开方式")
        .setDesc("手机端默认优先唤起哔哩哔哩客户端，平板端自动优先适配哔哩哔哩 HD；首次授权等待期间不会误弹浏览器，未安装时可一键转网页版。")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("auto", "优先客户端（平板适配 B站 HD）")
            .addOption("ask", "每次点击弹窗自选")
            .addOption("app_hd", "始终优先哔哩哔哩 HD")
            .addOption("web", "始终在浏览器打开网页版")
            .setValue(bilibiliLiveService.normalizeMobileLiveOpenMode(this.plugin.settings.bilibiliLiveMobileOpenMode))
            .onChange(async (value) => {
              this.plugin.settings.bilibiliLiveMobileOpenMode = bilibiliLiveService.normalizeMobileLiveOpenMode(value);
              await this.plugin.saveSettings();
            });
        });
    }
  }

  addRoxyMascotSettings(container) {
    const hdStatus = this.addRoxyHdPackSetting(container);

    const isMasterOn = this.plugin.settings.enableRoxy2DMascotMaster !== false;
    const isHdMascotOn = isMasterOn && hdStatus.installed && Boolean(this.plugin.settings.enableRoxy2DMascot);
    const isPixelModeOn = isMasterOn && Boolean(this.plugin.settings.roxyForceLightweight2D);

    new Setting(container)
      .setName("启用二维馆藏记录员")
      .setDesc(
        "在番剧档案馆右下角启用洛琪希馆藏记录员。此项为启用下方「高清立绘版洛琪希」或「轻量像素形象洛琪希」的前置总开关；关闭此项时，下方两个形象设置将灰显且不可点击。"
      )
      .addToggle((toggle) => {
        toggle.setValue(isMasterOn);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableRoxy2DMascotMaster = value;
          if (value) {
            if (!this.plugin.settings.enableRoxy2DMascot && !this.plugin.settings.roxyForceLightweight2D) {
              if (hdStatus.installed) {
                this.plugin.settings.enableRoxy2DMascot = true;
                this.plugin.settings.roxyForceLightweight2D = false;
              } else {
                this.plugin.settings.enableRoxy2DMascot = false;
                this.plugin.settings.roxyForceLightweight2D = true;
              }
            }
            if (this.plugin._roxyCoordinator) {
              this.plugin._roxyCoordinator.sessionHidden2D = false;
            }
          }
          await this.saveAndRefreshDashboard();
          this.display();
        });
      });

    const disableHdToggle = !isMasterOn || !hdStatus.installed;
    const hdToggleTooltip = !isMasterOn
      ? "请先开启前置开关“启用二维馆藏记录员”"
      : !hdStatus.installed
        ? "需要先下载“洛琪希高清立绘扩展包”"
        : "";

    const hdMascotSetting = new Setting(container)
      .setName("启用高清立绘版洛琪希")
      .setDesc(
        "在番剧档案馆右下角使用高清立绘版洛琪希形象。需先开启前置「启用二维馆藏记录员」并已安装高清立绘扩展包，与下方「启用轻量像素形象洛琪希」互斥切换。"
      )
      .addToggle((toggle) => {
        toggle.setValue(isHdMascotOn);
        toggle.setDisabled(disableHdToggle);
        if (toggle.toggleEl) {
          toggle.toggleEl.classList.toggle("is-disabled", disableHdToggle);
          const inp = toggle.toggleEl.querySelector("input");
          if (inp) inp.disabled = disableHdToggle;
          if (hdToggleTooltip) {
            toggle.toggleEl.title = hdToggleTooltip;
            toggle.toggleEl.setAttribute("aria-label", hdToggleTooltip);
          }
        }
        toggle.onChange(async (value) => {
          if (!isMasterOn || !hdStatus.installed) {
            return;
          }
          if (value) {
            this.plugin.settings.enableRoxy2DMascot = true;
            this.plugin.settings.roxyForceLightweight2D = false;
            if (this.plugin._roxyCoordinator) {
              this.plugin._roxyCoordinator.sessionHidden2D = false;
            }
          } else {
            this.plugin.settings.enableRoxy2DMascot = false;
            this.plugin.settings.roxyForceLightweight2D = true;
          }
          await this.saveAndRefreshDashboard();
          this.display();
        });
      });
    hdMascotSetting.setDisabled(disableHdToggle);
    if (disableHdToggle) {
      hdMascotSetting.settingEl.classList.add("is-roxy-sub-disabled");
      if (hdToggleTooltip) {
        hdMascotSetting.settingEl.title = hdToggleTooltip;
        if (hdMascotSetting.controlEl) hdMascotSetting.controlEl.title = hdToggleTooltip;
      }
    }

    const disablePixelToggle = !isMasterOn;
    const pixelToggleTooltip = !isMasterOn
      ? "请先开启前置开关“启用二维馆藏记录员”"
      : "";

    const pixelMascotSetting = new Setting(container)
      .setName("启用轻量像素形象洛琪希")
      .setDesc(
        "在番剧档案馆右下角使用内置 8 态轻量像素形象洛琪希（assets/roxy-chibi-sprites/），无需下载额外高清立绘包，需先开启前置「启用二维馆藏记录员」，且与上方「启用高清立绘版洛琪希」互斥切换。"
      )
      .addToggle((toggle) => {
        toggle.setValue(isPixelModeOn);
        toggle.setDisabled(disablePixelToggle);
        if (toggle.toggleEl) {
          toggle.toggleEl.classList.toggle("is-disabled", disablePixelToggle);
          const inp = toggle.toggleEl.querySelector("input");
          if (inp) inp.disabled = disablePixelToggle;
          if (pixelToggleTooltip) {
            toggle.toggleEl.title = pixelToggleTooltip;
            toggle.toggleEl.setAttribute("aria-label", pixelToggleTooltip);
          }
        }
        toggle.onChange(async (value) => {
          if (!isMasterOn) {
            return;
          }
          if (value) {
            this.plugin.settings.roxyForceLightweight2D = true;
            this.plugin.settings.enableRoxy2DMascot = false;
            if (this.plugin._roxyCoordinator) {
              this.plugin._roxyCoordinator.sessionHidden2D = false;
            }
          } else if (hdStatus.installed) {
            this.plugin.settings.roxyForceLightweight2D = false;
            this.plugin.settings.enableRoxy2DMascot = true;
          } else {
            this.plugin.settings.enableRoxy2DMascotMaster = false;
            this.plugin.settings.roxyForceLightweight2D = false;
          }
          await this.saveAndRefreshDashboard();
          this.display();
        });
      });
    pixelMascotSetting.setDisabled(disablePixelToggle);
    if (disablePixelToggle) {
      pixelMascotSetting.settingEl.classList.add("is-roxy-sub-disabled");
      if (pixelToggleTooltip) {
        pixelMascotSetting.settingEl.title = pixelToggleTooltip;
        if (pixelMascotSetting.controlEl) pixelMascotSetting.controlEl.title = pixelToggleTooltip;
      }
    }

    new Setting(container)
      .setName("启用三维馆藏记录员（Q 版洛琪希手办框）")
      .setDesc(
        "在 3D 原画展厅左上角边缘显示校准后的 8 态 Q 版洛琪希手办框。不遮挡 3D 封套与详情面板，对档案抽出、归位、笔记纸页、高分策展切换、空轨道等事件作出动态反馈。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.enableRoxy3DMascot !== false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.enableRoxy3DMascot = value;
          if (value && this.plugin._roxyCoordinator) {
            this.plugin._roxyCoordinator.sessionHidden3D = false;
          }
          await this.saveAndRefreshDashboard();
        });
      });

    new Setting(container)
      .setName("馆藏记录员底部控制条仅在点击形象后展开")
      .setDesc(
        "开启后，2D 与 3D 洛琪希下方的迷你控制条（静默 / 收纳 / 隐藏等按钮）平时保持自动收起，仅在点击洛琪希弹出气泡时同步展开；也可直接在底栏点击「点立绘展栏 / 固定底栏」随时切换。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.roxyDockExpandOnClickOnly !== false
        );
        toggle.onChange(async (value) => {
          this.plugin.settings.roxyDockExpandOnClickOnly = value;
          await this.saveAndRefreshDashboard();
        });
      });

    const isMobile = isMobileEnv();
    new Setting(container)
      .setName("洛琪希智能操作提示")
      .setDesc(
        isMobile
          ? "根据您的实际使用记忆提供个性化操作引导（如长按卡片查看关联收藏）：仅在首次尚未使用过或间隔较久未使用时轻声提醒，日常高频或规律使用时保持安静不打扰。"
          : "根据您的实际使用记忆提供个性化操作引导（如长按或右键卡片查看关联收藏）：仅在首次尚未使用过或间隔较久未使用时轻声提醒，日常高频或规律使用时保持安静不打扰。"
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.roxySmartGestureHints !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.roxySmartGestureHints = value;
          await this.saveAndRefreshDashboard();
        });
      })
      .addButton((button) => {
        button
          .setButtonText("重置操作提示记忆")
          .onClick(async () => {
            await resetRoxyGestureMemory(this.plugin);
            this.plugin.settings.roxySmartGestureHints = true;
            await this.saveAndRefreshDashboard();
            new Notice("已重置洛琪希操作提示记忆。", 3000);
            this.display();
          });
      });

    new Setting(container)
      .setName("看板娘角色扩展与台词替换工坊")
      .setDesc(
        "支持将洛琪希自定义为任意角色名称、为 8 种情绪状态单独指定本地立绘图片，并自定义各情绪台词或配置全局关键词替换规则。"
      )
      .addButton((button) => {
        button
          .setButtonText("打开角色与台词工坊")
          .onClick(() => {
            const modal = new Modal(this.app);
            modal.onOpen = () => {
              const { contentEl } = modal;
              contentEl.empty();
              contentEl.style.maxWidth = "720px";
              contentEl.createEl("h2", { text: "看板娘角色扩展与台词替换工坊" });
              contentEl.createEl("p", {
                text: "您可以在此把看板娘替换为任意喜爱的角色：自定义角色称呼、为各情绪状态绑定本地图片路径（或 URL），并自定义台词库或关键词替换（留空则自动回退至洛琪希默认配置。隐藏彩蛋提示：连续点击记录员 100 下将触发百戳玩偶替身或全屏弹珠逃跑反应，可通过下方 plushie 槽位自定义替身玩偶图）。"
              }).style.opacity = "0.82";

              const settings = this.plugin.settings;
              if (!settings.customMascotPortraits || typeof settings.customMascotPortraits !== "object") {
                settings.customMascotPortraits = {};
              }
              if (!settings.customMascotDialogues || typeof settings.customMascotDialogues !== "object") {
                settings.customMascotDialogues = {};
              }

              new Setting(contentEl)
                .setName("自定义看板娘角色名称")
                .setDesc("留空默认显示「洛琪希」。填写后将自动替换界面头衔与默认台词中的「洛琪希」称呼。")
                .addText((text) => {
                  text
                    .setPlaceholder("例如：芙莉莲 / 爱丽丝 / 留空默认洛琪希")
                    .setValue(String(settings.customMascotName || ""))
                    .onChange(async (val) => {
                      settings.customMascotName = String(val || "").trim();
                      await this.saveAndRefreshDashboard();
                    });
                });

              contentEl.createEl("h3", { text: "各情绪状态自定义立绘 / 精灵图路径" });
              const stateDefs = [
                { key: "guide", label: "引导 / 常态 (guide)" },
                { key: "pout", label: "鼓腮 / 傲娇 (pout)" },
                { key: "lecture", label: "讲学 / 严谨 (lecture)" },
                { key: "alert", label: "警觉 / 提醒 (alert)" },
                { key: "fluster", label: "害羞 / 慌张 (fluster)" },
                { key: "helpless", label: "无奈 / 叹气 (helpless)" },
                { key: "cheer", label: "欢呼 / 夸奖 (cheer)" },
                { key: "overpoke", label: "戳晕 / 抗议 (overpoke)" },
                { key: "plushie", label: "百戳玩偶替身 (plushie)" }
              ];

              stateDefs.forEach((st) => {
                new Setting(contentEl)
                  .setName(st.label)
                  .setDesc(
                    isMobile
                      ? "支持仓库内相对路径、点击「浏览」从手机相册导入，或 https 图片链接"
                      : "支持本地绝对路径（如 D:/pics/char_guide.png）、仓库内相对路径或 https 图片链接"
                  )
                  .addText((text) => {
                    text
                      .setPlaceholder("留空使用内置洛琪希形象")
                      .setValue(String(settings.customMascotPortraits[st.key] || ""))
                      .onChange(async (val) => {
                        const clean = String(val || "").trim();
                        if (clean) {
                          settings.customMascotPortraits[st.key] = clean;
                        } else {
                          delete settings.customMascotPortraits[st.key];
                        }
                        await this.saveAndRefreshDashboard();
                      });
                    text.inputEl.style.width = isMobile ? "100%" : "240px";
                  })
                  .addButton((btn) => {
                    btn.setButtonText("浏览...").onClick(() => {
                      const fileInput = document.createElement("input");
                      fileInput.type = "file";
                      fileInput.accept = "image/*";
                      fileInput.onchange = async () => {
                        const file = fileInput.files && fileInput.files[0];
                        if (!file) return;
                        let filePath = "";
                        if (typeof file.arrayBuffer === "function") {
                          try {
                            const folder = String(settings.characterImageFolder || "附件/角色立绘")
                              .replace(/\\/g, "/")
                              .replace(/\/+$/, "");
                            await this.plugin.ensureVaultFolder(folder);
                            const ext = (file.name && file.name.includes("."))
                              ? file.name.split(".").pop().toLowerCase()
                              : "png";
                            const targetRel = `${folder}/custom_mascot_${st.key}_${Date.now()}.${ext}`;
                            const buf = await file.arrayBuffer();
                            await this.app.vault.createBinary(targetRel, buf);
                            filePath = targetRel;
                          } catch (_) {}
                        }
                        if (!filePath) {
                          try {
                            const electron = isDesktopNodeAvailable() ? tryRequireNode("electron") : null;
                            filePath = (electron?.webUtils?.getPathForFile && electron.webUtils.getPathForFile(file)) || file.path || "";
                          } catch (_) {
                            filePath = file.path || "";
                          }
                        }
                        if (filePath) {
                          settings.customMascotPortraits[st.key] = filePath;
                          await this.saveAndRefreshDashboard();
                          modal.onOpen();
                        }
                      };
                      fileInput.click();
                    });
                  });
              });

              contentEl.createEl("h3", { text: "台词关键词替换与专属情绪台词池" });
              const replaceWrap = contentEl.createDiv();
              replaceWrap.style.marginBottom = "14px";
              replaceWrap.createEl("div", {
                text: "全局台词替换规则（每行一条，格式：原词=>新词，例如：魔法=>炼金术）"
              }).style.fontWeight = "600";
              const replaceArea = replaceWrap.createEl("textarea");
              replaceArea.style.width = "100%";
              replaceArea.style.minHeight = "68px";
              replaceArea.style.marginTop = "6px";
              replaceArea.placeholder = "魔法=>炼金术\n魔杖=>法杖";
              replaceArea.value = String(settings.customMascotDialogues._replaceRules || "");
              replaceArea.onchange = async () => {
                settings.customMascotDialogues._replaceRules = String(replaceArea.value || "");
                await this.saveAndRefreshDashboard();
              };

              stateDefs.forEach((st) => {
                const wrap = contentEl.createDiv();
                wrap.style.marginBottom = "10px";
                wrap.createEl("div", {
                  text: st.label + " 专属随机台词池（每行一句，触发该状态时优先从中随机抽取；留空使用默认台词）"
                }).style.fontSize = "12.5px";
                const area = wrap.createEl("textarea");
                area.style.width = "100%";
                area.style.minHeight = "54px";
                area.style.marginTop = "4px";
                const existing = settings.customMascotDialogues[st.key];
                area.value = Array.isArray(existing)
                  ? existing.join("\n")
                  : String(existing || "");
                area.onchange = async () => {
                  const lines = String(area.value || "")
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (lines.length) {
                    settings.customMascotDialogues[st.key] = lines;
                  } else {
                    delete settings.customMascotDialogues[st.key];
                  }
                  await this.saveAndRefreshDashboard();
                };
              });

              const footer = contentEl.createDiv();
              footer.style.display = "flex";
              footer.style.flexWrap = "wrap";
              footer.style.gap = "8px";
              footer.style.justifyContent = "space-between";
              footer.style.marginTop = "16px";

              const resetBtn = footer.createEl("button", { text: "↺ 一键恢复默认洛琪希配置" });
              resetBtn.onclick = async () => {
                settings.customMascotName = "";
                settings.customMascotPortraits = {};
                settings.customMascotDialogues = {};
                await this.saveAndRefreshDashboard();
                modal.onOpen();
              };

              const doneBtn = footer.createEl("button", { text: "完成并生效", cls: "mod-cta" });
              doneBtn.onclick = () => modal.close();
            };
            modal.open();
          });
      });
  }

  addDownloadAndAutoFollowSettings(container) {
    const isMobile = isMobileEnv();

    new Setting(container)
      .setName(isMobile ? "启用追番资源检索与磁力复制助手" : "启用追番下载与单集 RSS 助手")
      .setDesc(
        isMobile
          ? "在番剧档案馆「追番」、封面视图与列表视图中显示「⬇ 下载」按钮，支持在手机端检索剧集磁力链接、一键复制磁力或直接唤起手机下载 App（迅雷 / 夸克 / 115 / Flud 等）。"
          : "在番剧档案馆「追番」、封面视图与列表视图中显示「⬇ 下载/RSS」按钮，支持在 Obsidian 内直接选择发布源、核验每集唯一 RSS 并启动下载。"
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableDownloadAssistant !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableDownloadAssistant = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenDashboardViews();
          this.display();
        });
      });

    if (this.plugin.settings.enableDownloadAssistant !== false) {
      new Setting(container)
        .setName(
          isMobile
            ? "启用漫猫动漫 (www.comicat.org) 磁力检索"
            : "启用漫猫动漫 (www.comicat.org) 搜索与单集 RSS 解析"
        )
        .setDesc(
          isMobile
            ? "开启后可在弹窗内自动检索 comicat.org 动画资源并按字幕组列出各话磁力链接。若您不使用 comicat.org，可关闭此项。"
            : "开启后可在弹窗内自动检索 comicat.org 动画资源、按字幕组划分发布源并生成每集唯一的专属 RSS。若您不使用 comicat.org，可关闭此项。"
        )
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.enableComicatIntegration !== false);
          toggle.onChange(async (value) => {
            this.plugin.settings.enableComicatIntegration = value;
            await this.plugin.saveSettings();
            this.display();
          });
        });

      if (!isMobile) {
        new Setting(container)
          .setName("管理全部自动追更番剧")
          .setDesc(
            "集中查看当前仓库中已开启或已暂停后台自动追更的所有番剧，支持一键暂停、恢复或取消任意番剧的自动下载规则。"
          )
          .addButton((btn) => {
            btn
              .setButtonText("打开追更管理")
              .setCta()
              .onClick(() => {
                const dlSvc = require("./anime-download-service");
                if (dlSvc && typeof dlSvc.openAllRssSubscriptionsManagerModal === "function") {
                  dlSvc.openAllRssSubscriptionsManagerModal(this.plugin, async () => {
                    await this.plugin.refreshOpenDashboardViews();
                  });
                }
              });
          });

        new Setting(container)
          .setName("启用 qBittorrent 客户端联动下载")
          .setDesc(
            "开启后自动检测本机 qBittorrent（未启动时可自动唤起，未安装时提示下载链接），并将剧集直接下载到该动画笔记的本地文件夹。若您不使用 qBittorrent，可关闭此项以使用纯磁力/种子自行下载。"
          )
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.settings.enableQbittorrentIntegration !== false);
            toggle.onChange(async (value) => {
              this.plugin.settings.enableQbittorrentIntegration = value;
              await this.plugin.saveSettings();
              this.display();
            });
          });

        if (this.plugin.settings.enableQbittorrentIntegration !== false) {
          const qbPathSetting = new Setting(container)
            .setName("qBittorrent 程序路径（可选）")
            .setDesc(
              "留空将自动探测本机各盘符、注册表及系统应用目录中的 qBittorrent；如安装在自定义目录可点右侧浏览指定。"
            )
            .addText((text) => {
              text.setPlaceholder("留空自动检测，或点击右侧浏览选择");
              text.setValue(String(this.plugin.settings.qbittorrentExecutablePath || ""));
              text.onChange(async (value) => {
                this.plugin.settings.qbittorrentExecutablePath = value.trim();
                await this.plugin.saveSettings();
              });
            });
          if (isDesktopNodeAvailable()) {
            qbPathSetting.addButton((btn) => {
              btn.setButtonText("浏览...").onClick(() => {
                const fInput = document.createElement("input");
                fInput.type = "file";
                if (typeof process !== "undefined" && process.platform === "win32") {
                  fInput.accept = ".exe,.lnk";
                }
                fInput.onchange = async () => {
                  const file = fInput.files && fInput.files[0];
                  const picked = getNativeFilePathCrossPlatform(file);
                  if (picked) {
                    this.plugin.settings.qbittorrentExecutablePath = picked;
                    await this.plugin.saveSettings();
                    this.display();
                  }
                };
                fInput.click();
              });
            });
          }

          new Setting(container)
            .setName("投递到 qBittorrent 时跳过添加确认框")
            .setDesc(
              "开启后直接将剧集保存到动画笔记对应的本地文件夹（--skip-dialog=true）；关闭后会在 qBittorrent 中弹出添加种子确认窗口。"
            )
            .addToggle((toggle) => {
              toggle.setValue(this.plugin.settings.qbittorrentSkipDialog !== false);
              toggle.onChange(async (value) => {
                this.plugin.settings.qbittorrentSkipDialog = value;
                await this.plugin.saveSettings();
              });
            });
        }
      }

      new Setting(container)
        .setName("备用/自定义动画下载搜索网址模板")
        .setDesc(
          "点击「↗ 备用站搜索」或关闭 comicat.org 时使用的外部搜索网址（使用 {keyword} 代表动画关键词）。"
        )
        .addText((text) => {
          text.setPlaceholder("https://mikanani.me/Home/Search?searchstr={keyword}");
          text.setValue(
            String(
              this.plugin.settings.customDownloadSearchUrlTemplate ||
                "https://mikanani.me/Home/Search?searchstr={keyword}"
            )
          );
          text.onChange(async (value) => {
            this.plugin.settings.customDownloadSearchUrlTemplate =
              value.trim() || "https://mikanani.me/Home/Search?searchstr={keyword}";
            await this.plugin.saveSettings();
          });
        });
    }
  }

  addArchiveHallSettings(container) {
    this.addRibbonButtonSetting(container, {
      name: "显示侧边栏「打开番剧档案馆」按钮",
      desc: "开启后，在 Obsidian 左侧功能栏显示「打开番剧档案馆」入口按钮（点击左侧图标可更换样式）。",
      toggleKey: "showDashboardRibbon",
      iconKey: "dashboardRibbonIcon",
      defaultIcon: this.plugin.defaultDashboardRibbonIcon || "bangumi-archive-hall",
      refreshFn: () => this.plugin.refreshDashboardRibbon()
    });

    new Setting(container)
      .setName("打开番剧档案馆")
      .setDesc(
        "在插件专属页面中打开番剧档案馆（含 3D 原画展厅），不受阅读模式和实时预览模式影响。"
      )
      .addButton((button) => {
        button.setButtonText("打开");

        button.onClick(async () => {
          await this.plugin.openScoreDashboardView();
        });
      });

    new Setting(container)
      .setName("恢复番剧档案馆默认布局")
      .setDesc(
        "清除番剧档案馆自定义分区排序、折叠和隐藏状态，恢复默认布局。"
      )
      .addButton((button) => {
        button.setButtonText("恢复默认");

        button.onClick(async () => {
          await this.plugin.resetScoreDashboardLayout();
          this.display();
        });
      });

    const v07Themes = require("./v07-themes.js");
    const v07Adapters = require("./v07-adapters.js");
    const appearanceSetting = new Setting(container)
      .setName("番剧档案馆外观主题")
      .setDesc("支持跟随当前 Obsidian 主题、暖色纸本、封面柔光、夜间影院、洛琪希手记与晴空画集；每个外观均可独立开关动态效果（同样可在档案馆右上角「外观」按钮随时切换）。");
    const appearancePickerHost = container.createDiv("bm7-root bm7-settings-appearance-host");
    appearancePickerHost.style.marginBottom = "16px";
    v07Themes.renderAppearancePicker(appearancePickerHost, {
      appearance: v07Adapters.getAppearance(this.plugin),
      onChange: async (next) => {
        await v07Adapters.saveAppearance(this.plugin, next);
        if (typeof this.plugin.refreshOpenDashboardViews === "function") {
          await this.plugin.refreshOpenDashboardViews();
        }
      }
    });
    void appearanceSetting;

    new Setting(container)
      .setName("追番 · 管理多个自定义季度与滑动上限")
      .setDesc(
        "自由添加或移除「追番」面板中展示的多个季度（具体哪几个季度由您自行决定），并配置横向左右滑动或网格展开模式与显示数量上限。"
      )
      .addButton((button) => {
        button
          .setButtonText("配置季度与滑动")
          .setCta()
          .onClick(async () => {
            if (typeof this.plugin.openDeskSeasonManagerFromSettings === "function") {
              await this.plugin.openDeskSeasonManagerFromSettings();
            }
          });
      });

    new Setting(container)
      .setName("追番 · 默认排列模式")
      .setDesc(
        "选择「横向左右滑动（推荐）」或「多行网格全部展开」。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          scroll: "⇄ 横向左右滑动（推荐）",
          grid: "⊞ 多行网格全部展开"
        });
        dropdown.setValue(this.plugin.settings.deskLayoutMode || "scroll");
        dropdown.onChange(async (value) => {
          this.plugin.settings.deskLayoutMode = value;
          if (this.plugin.settings.curatorDeskState) {
            this.plugin.settings.curatorDeskState.deskLayoutMode = value;
          }
          await this.plugin.saveSettings();
          await this.plugin.refreshOpenDashboardViews();
        });
      });

    this.addScoreSectionTitle(container, "Markdown 番剧档案馆快照");

    new Setting(container)
      .setName("启用 Markdown 番剧档案馆")
      .setDesc(
        "开启后创建并维护 Markdown 番剧档案馆快照，适合导出、链接和阅读模式查看。关闭后不会删除已有文件。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.markdownDashboardEnabled !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.markdownDashboardEnabled =
            value;

          await this.plugin.saveSettings();

          if (value) {
            await this.plugin.ensureScoreDashboard(
              false
            );
          }

          this.display();
        });
      });

    if (this.plugin.settings.markdownDashboardEnabled !== false) {
      new Setting(container)
        .setName("Markdown 番剧档案馆路径")
        .setDesc(
          "Markdown 番剧档案馆快照的仓库路径。文件名会自动补全为 .md。"
        )
        .addText((text) => {
          text.setValue(
            String(
              this.plugin.settings.dashboardPath ||
              this.plugin.getDefaultDashboardPath()
            )
          );

          text.onChange(async (value) => {
            const input = String(value || "")
              .trim()
              .replace(/\\/g, "/");

            if (input) {
              this.plugin.settings.dashboardPath =
                input.endsWith(".md")
                  ? input
                  : input + ".md";

              this.plugin.settings.dashboardPathManuallySet =
                true;
            } else {
              this.plugin.settings.dashboardPath =
                this.plugin.getDefaultDashboardPath();

              this.plugin.settings.dashboardPathManuallySet =
                false;
            }

            await this.plugin.saveSettings();
          });

          this.bindPathInputAutoMigration(
            text,
            "dashboardPath",
            () => this.plugin.settings.dashboardPath || this.plugin.getDefaultDashboardPath()
          );
        });

      new Setting(container)
        .setName("打开 Markdown 番剧档案馆")
        .setDesc(
          "打开 Markdown 番剧档案馆快照。图表内容需要在阅读模式中显示。"
        )
        .addButton((button) => {
          button.setButtonText("打开");

          button.onClick(async () => {
            await this.plugin.openScoreDashboard();
          });
        });

      new Setting(container)
        .setName("重建 Markdown 番剧档案馆")
        .setDesc(
          "恢复 Markdown 番剧档案馆的标准内容。此操作会覆盖该笔记中的自定义文字。"
        )
        .addButton((button) => {
          button.setButtonText("重建");

          button.onClick(async () => {
            await this.plugin.ensureScoreDashboard(true);

            new Notice(
              "Markdown 番剧档案馆已重建。",
              5000
            );
          });
        });

      new Setting(container)
        .setName("自动刷新 Markdown 番剧档案馆")
        .setDesc(
          "后台评分监测和评分显示刷新完成后，自动更新 Markdown 番剧档案馆快照。"
        )
        .addToggle((toggle) => {
          toggle.setValue(
            this.plugin.settings.dashboardAutoRefresh !==
            false
          );

          toggle.onChange(async (value) => {
            this.plugin.settings.dashboardAutoRefresh =
              value;

            await this.plugin.saveSettings();
          });
        });

      new Setting(container)
        .setName("刷新 Markdown 番剧档案馆")
        .setDesc(
          "立即更新 Markdown 番剧档案馆快照。"
        )
        .addButton((button) => {
          button.setButtonText("刷新");

          button.onClick(async () => {
            await this.plugin.refreshScoreDashboard(true);

            new Notice(
              "Markdown 番剧档案馆已刷新。",
              4000
            );
          });
        });
    }

    this.addScoreSectionTitle(container, "统计视图、智能筛选与精选片单");

    new Setting(container)
      .setName("综合评分排行榜默认显示数量")
      .setDesc(
        "番剧档案馆与 Markdown 番剧档案馆中“综合评分排行榜”（我的评分 / 你在 BGM 上的评分 / BGM 评分）默认显示的动画数量。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.dashboardScoreRankLimit ||
            this.plugin.settings.dashboardPersonalRankLimit ||
            10
          )
        );

        text.onChange(async (value) => {
          const lim = Math.max(
            1,
            Math.min(
              50,
              Number(value) || 10
            )
          );
          this.plugin.settings.dashboardScoreRankLimit = lim;
          this.plugin.settings.dashboardPersonalRankLimit = lim;
          this.plugin.settings.dashboardBangumiRankLimit = lim;

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示我的评分分布")
      .setDesc(
        "按 0–2、3–4、5–6、7–8、9–10 分区间显示我的评分分布。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowDistribution !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowDistribution =
            value;

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示观看状态统计")
      .setDesc(
        "显示已看、在看、想看和抛弃动画的数量。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowWatchState !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowWatchState =
            value;

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示追番全景与时长统计")
      .setDesc("统计累计观看话数、追番投入时长估算以及各观看状态彩带分布。")
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowProgressStats !== false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowProgressStats = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示年代与番季分布")
      .setDesc("按开播年份收录柱状图与四大番季（1月/4月/7月/10月）收录情况统计。")
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowYearStats !== false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowYearStats = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示评分差异与偏好分析")
      .setDesc("对比个人评分与 Bangumi 社区评分差异（Δ），展示个人最偏爱与最严苛作品榜单。")
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowScoreDelta !== false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowScoreDelta = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("显示制作公司与改编类型")
      .setDesc("统计各大动画制作公司收录数与平均分，以及原作类型（原创/漫改/轻改/游戏改等）分布。")
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowStudioStats !== false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowStudioStats = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("补全已有番剧的 Bangumi 题材标签")
      .setDesc("若早期导入的番剧笔记只有单一 bangumi 标签，点击可自动从 Bangumi 拉取题材标签（如百合、原创、日常等）写回笔记属性，不会改动您的评分与手札。")
      .addButton((btn) => {
        btn
          .setButtonText("一键补全标签")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("正在补全...");
            try {
              await this.plugin.backfillExistingAnimeTagsFromBangumi({
                onlyMissing: true,
                onProgress: (p) => {
                  btn.setButtonText(`补全中 (${p.completed}/${p.total})`);
                }
              });
            } finally {
              btn.setDisabled(false);
              btn.setButtonText("一键补全标签");
            }
          });
      });

    new Setting(container)
      .setName("智能筛选")
      .setDesc("按题材标签、观看状态、评分门槛及开播季度创建自动聚合筛选。")
      .addButton((btn) => {
        btn
          .setButtonText("+ 新建智能筛选")
          .setCta()
          .onClick(() => {
            this.plugin.openCustomQuerySectionModal(null, () => {
              this.display();
            });
          });
      });

    const customSections = Array.isArray(this.plugin.settings.customQuerySections)
      ? this.plugin.settings.customQuerySections
      : [];

    if (customSections.length > 0) {
      for (const section of customSections) {
        const descParts = [];
        if (section.tag) descParts.push(`标签: ${section.tag}`);
        if (section.watchStatus && section.watchStatus !== "all") descParts.push(`状态: ${section.watchStatus}`);
        if (section.minMyScore) descParts.push(`个人评分≥${section.minMyScore}`);
        if (section.minBgmScore) descParts.push(`BGM 评分≥${section.minBgmScore}`);
        if (section.year) descParts.push(`年份: ${section.year}`);
        if (section.season) descParts.push(`季度: ${section.season}`);
        descParts.push(section.displayMode === "grid" ? "海报网格" : "榜单列表");
        const limitText = Number(section.limit) > 0 ? `${section.limit}部` : "全部";
        descParts.push(`上限: ${limitText}`);

        new Setting(container)
          .setName(section.title)
          .setDesc(descParts.join(" | "))
          .addButton((btn) => {
            btn.setButtonText("编辑").onClick(() => {
              this.plugin.openCustomQuerySectionModal(section, () => {
                this.display();
              });
            });
          })
          .addButton((btn) => {
            btn
              .setButtonText("删除")
              .setWarning()
              .onClick(() => {
                this.plugin.confirmDeleteCustomQuerySection(section, () => {
                  this.display();
                });
              });
          });
      }
    }

    new Setting(container)
      .setName("精选片单")
      .setDesc("手动挑选作品组建个人片单，支持调整先后顺序与切换展示方式。")
      .addButton((btn) => {
        btn
          .setButtonText("+ 新建精选片单")
          .setCta()
          .onClick(() => {
            this.plugin.openCustomCollectionModal(null, () => {
              this.display();
            });
          });
      });

    const collectionSections = Array.isArray(this.plugin.settings.customCollectionSections)
      ? this.plugin.settings.customCollectionSections
      : [];

    if (collectionSections.length > 0) {
      for (const col of collectionSections) {
        const itemCount = Array.isArray(col.items) ? col.items.length : 0;
        const modeText = col.displayMode === "list" ? "榜单列表" : "海报网格";

        new Setting(container)
          .setName(col.title)
          .setDesc(`收录: ${itemCount} 部 | 展示形态: ${modeText}`)
          .addButton((btn) => {
            btn.setButtonText("管理条目").onClick(() => {
              this.plugin.openCollectionItemsManagerModal(col, () => {
                this.display();
              });
            });
          })
          .addButton((btn) => {
            btn.setButtonText("编辑").onClick(() => {
              this.plugin.openCustomCollectionModal(col, () => {
                this.display();
              });
            });
          })
          .addButton((btn) => {
            btn
              .setButtonText("删除")
              .setWarning()
              .onClick(() => {
                this.plugin.confirmDeleteCustomCollection(col, () => {
                  this.display();
                });
              });
          });
      }
    }
  }

  async promptForScoreDataRefresh() {
    const noteCount =
      await this.plugin.countBangumiNotesForScoreRefresh();

    if (noteCount === 0) {
      return {
        action: "none",
        noteCount
      };
    }

    const promptMode =
      this.plugin.settings.ratingRefreshPromptMode ===
        "later" ||
      this.plugin.settings.ratingRefreshPromptMode ===
        "update"
        ? this.plugin.settings.ratingRefreshPromptMode
        : "ask";

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
      const rememberedMode =
        decision.action === "update"
          ? "update"
          : "later";

      this.plugin.settings.ratingRefreshPromptMode =
        rememberedMode;

      this.plugin.settings.ratingRefreshPromptDisabled =
        true;

      await this.plugin.saveSettings();
    }

    return {
      action: decision.action,
      noteCount
    };
  }
  async refreshEnabledScoreDataAfterSettingChange() {
    const decision =
      await this.promptForScoreDataRefresh();

    if (decision.action !== "update") {
      return;
    }

    const summary =
      await this.plugin.refreshPreciseRatingsSilently(true);

    new Notice(
      "评分数据更新完成：扫描 " +
      summary.scanned +
      " 篇，请求 " +
      summary.requested +
      " 篇，精确评分更新 " +
      summary.preciseUpdated +
      " 篇，写入笔记 " +
      summary.notesUpdated +
      " 篇，无数据 " +
      summary.noData +
      " 篇，失败 " +
      summary.failed +
      " 篇。",
      9000
    );
  }
  async saveAndSynchronizeNoteScores() {
    await this.plugin.saveSettings();

    return await this.plugin
      .refreshScoreDisplayFields();
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

  addBangumiSettings(container, opts = {}) {
    if (!opts || !opts.skipHeading) {
      container.createEl("h3", {
        text: "评分与排名"
      });
    }

    const intro = container.createEl("p", {
      text: "笔记评分控制动画笔记的属性区和正文；数据更新控制何时访问 Bangumi 与 Netaba 评分数据来源。"
    });

    intro.style.marginTop = "6px";
    intro.style.marginBottom = "14px";
    intro.style.color = "var(--text-muted)";
    intro.style.fontSize = "0.9em";
    intro.style.lineHeight = "1.6";

    this.addScoreSectionTitle(
      container,
      "笔记评分"
    );

    new Setting(container)
      .setName("显示你在 BGM 上的评分")
      .setDesc(
        "在动画笔记的属性区和正文中显示你在 Bangumi 网站上打出的个人评分。关闭后会从笔记隐藏该项，但不会影响 Bangumi 网站上的评分。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.showBangumiUserScore !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showBangumiUserScore =
            value;

          await this.plugin.saveSettings();
          await this.plugin.refreshScoreFields();
        });
      });

    new Setting(container)
      .setName("显示我的评分")
      .setDesc(
        "在动画笔记的属性区和正文中显示可编辑的“我的评分”。它只由当前笔记中填写的内容决定，插件不会从 Bangumi 读取或覆盖；关闭后会隐藏，重新开启后恢复。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.showPersonalScore !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showPersonalScore =
            value;

          await this.plugin.saveSettings();
          await this.plugin.refreshScoreFields();
        });
      });

    new Setting(container)
      .setName("使用精确 BGM 评分")
      .setDesc(
        "开启后，笔记中的唯一“BGM 评分”改为精确评分；关闭后恢复普通 Bangumi 页面评分。不会创建“BGM 精确评分”属性。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.showBangumiPreciseScore ===
          true
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showBangumiPreciseScore =
            value;
await this.saveAndSynchronizeNoteScores();

          if (value) {
            await this.refreshEnabledScoreDataAfterSettingChange();
          }
        });
      });

    new Setting(container)
      .setName("精确 BGM 评分显示小数位数")
      .setDesc(
        "影响笔记正文以及番剧档案馆“综合评分排行榜”中 BGM 评分的默认小数位数显示。原始评分不会被修改。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          "1": "1 位小数",
          "2": "2 位小数",
          "4": "4 位小数"
        });

        dropdown.setValue(
          String(
            this.plugin.settings
              .bangumiPreciseScoreDisplayDigits ||
            4
          )
        );

        dropdown.onChange(async (value) => {
          this.plugin.settings
            .bangumiPreciseScoreDisplayDigits =
            Number(value);

          await this.saveAndSynchronizeNoteScores();
        });
      });

    this.addScoreSectionTitle(
      container,
      "多站国际评分源（AniList · MyAnimeList · Filmarks）"
    );

    new Setting(container)
      .setName("番剧档案馆优先展示的评分依据")
      .setDesc(
        "控制追番封面、全部番剧卡片、列表评分列与 3D 展厅等单评分位默认显示的评分来源（默认 Bangumi；所选网站尚未同步时自动回退显示 Bangumi 评分）。多站对比详见番剧档案馆「评分对比」标签页。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          bangumi: "Bangumi（默认 · 华语社区 10 分制）",
          anilist: "AniList（英文社区百分制）",
          mal: "MyAnimeList（欧美最大 10 分制）",
          filmarks: "Filmarks（日本最大 5 分制）",
          composite: "跨站综合分（四站加权 10 分制）"
        });
        dropdown.setValue(multiSiteRatingService.getPreferredRatingSource(this.plugin));
        dropdown.onChange(async (value) => {
          await multiSiteRatingService.setPreferredRatingSource(this.plugin, value);
          if (typeof this.plugin.refreshOpenDashboardViews === "function") {
            await this.plugin.refreshOpenDashboardViews().catch(() => {});
          }
        });
      });

    const cachedMultiCount = Object.values(this.plugin.settings?.multiSiteRatingsCache || {}).filter(
      (r) => r && (r.anilist || r.mal || r.filmarks)
    ).length;

    new Setting(container)
      .setName("同步国际多站评分缓存")
      .setDesc(
        `当前已缓存 ${cachedMultiCount} 部作品的 AniList / MyAnimeList / Filmarks 评分（独立存放在插件缓存中，绝不改动既有动画 Markdown 笔记）。`
      )
      .addButton((btn) => {
        btn
          .setButtonText("同步在看 / 想看")
          .setCta()
          .onClick(async () => {
            const items =
              typeof this.plugin.collectDashboardItems === "function"
                ? await this.plugin.collectDashboardItems().catch(() => [])
                : [];
            btn.setDisabled(true);
            btn.setButtonText("后台同步中…");
            new Notice("已开始后台同步「在看 / 想看」作品的多站评分，可随时在「评分对比」页查看进度");
            try {
              const res = await multiSiteRatingService.startBatchMultiSiteSync(this.plugin, items, {
                scope: "watching"
              });
              const st = res?.status || {};
              new Notice(`多站评分同步完成：成功 ${st.succeeded || 0} 部，失败 ${st.failed || 0} 部`, 4000);
              if (typeof this.plugin.refreshOpenDashboardViews === "function") {
                await this.plugin.refreshOpenDashboardViews().catch(() => {});
              }
            } finally {
              this.display();
            }
          });
      });

    this.addScoreSectionTitle(
      container,
      "评分数据同步与更新"
    );

    new Setting(container)
      .setName("评分设置变更后的处理方式")
      .setDesc(
        "开启精确评分设置时的默认行为。可以在这里改回“每次询问”，覆盖之前记住的选择。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          ask: "每次询问",
          later: "自动稍后更新",
          update: "自动立即更新"
        });

        const currentMode =
          this.plugin.settings.ratingRefreshPromptMode ===
            "later" ||
          this.plugin.settings.ratingRefreshPromptMode ===
            "update"
            ? this.plugin.settings.ratingRefreshPromptMode
            : "ask";

        dropdown.setValue(currentMode);

        dropdown.onChange(async (value) => {
          const nextMode =
            value === "later" || value === "update"
              ? value
              : "ask";

          this.plugin.settings.ratingRefreshPromptMode =
            nextMode;

          this.plugin.settings.ratingRefreshPromptDisabled =
            nextMode !== "ask";

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("自动更新评分与排名数据")
      .setDesc(
        "开启后，插件会按下方间隔自动更新你在 BGM 上的评分、普通 BGM 评分，以及当前启用的精确评分和番剧档案馆排名。关闭后停止后台请求，手动更新仍可使用。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.ratingMonitorEnabled !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.ratingMonitorEnabled =
            value;

          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(container)
      .setName("评分数据更新间隔")
      .setDesc(
        "单位为秒，默认 900 秒。自动更新开启时生效；动画较多时不建议设置过短。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.ratingMonitorSeconds ||
            900
          )
        );

        text.onChange(async (value) => {
          this.plugin.settings.ratingMonitorSeconds =
            Math.max(
              60,
              Number(value) || 900
            );

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("立即更新评分数据")
      .setDesc(
        "读取普通 BGM 评分、你在 BGM 上的评分，以及当前启用的精确评分。同步过程中可以关闭窗口并让任务在后台继续。"
      )
      .addButton((button) => {
        button.setButtonText("立即更新");

        button.onClick(() => {
          openRatingSyncProgress(
            this.plugin,
            this.app
          );
        });
      });

    new Setting(container)
      .setName("查看评分同步状态")
      .setDesc(
        "重新打开当前评分同步任务的进度窗口。没有运行中的任务时不会执行操作。"
      )
      .addButton((button) => {
        button.setButtonText("查看状态");

        button.onClick(() => {
          const task =
            this.plugin.ratingSync &&
            this.plugin.ratingSync.getTask();

          if (!task || !task.running) {
            new Notice(
              "当前没有正在运行的评分同步任务。",
              5000
            );
            return;
          }

          openRatingSyncProgress(
            this.plugin,
            this.app
          );
        });
      });
    new Setting(container)
      .setName("刷新笔记中的评分显示")
      .setDesc(
        "不访问网络。按当前开关和小数位数重排评分属性，并重建笔记正文中的评分行。"
      )
      .addButton((button) => {
        button.setButtonText("刷新显示");

        button.onClick(async () => {
          button.setDisabled(true);

          try {
            const summary =
              await this.plugin
                .refreshScoreDisplayFields();

            new Notice(
              "评分显示已刷新：扫描 " +
              summary.scanned +
              " 篇，更新 " +
              summary.updated +
              " 篇，失败 " +
              summary.failed +
              " 篇。",
              7000
            );
          } catch (error) {
            console.error(
              "刷新评分显示失败:",
              error
            );

            new Notice(
              "刷新评分显示失败，请查看控制台日志。",
              6000
            );
          } finally {
            button.setDisabled(false);
          }
        });
      });
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
  addGameCapsuleSettings(container, compact = false, opts = {}) {
    const gameCapsuleService = getSettingsCapsuleService();
    if (!opts || !opts.skipHeading) {
      container.createEl("h3", {
        text: "游戏典藏 · 桌面侧边手札胶囊"
      });
    }

    if (!gameCapsuleService || !gameCapsuleService.isDesktopCapsuleSupported()) {
      const note = container.createDiv({
        cls: "setting-item-description",
        text: "跨显示器侧边半透明胶囊与全屏手札浮窗依赖桌面端操作系统窗口层，当前移动端环境下仅保留馆内游戏手札面板，不会影响原有笔记同步。"
      });
      note.style.padding = "8px 12px";
      note.style.marginBottom = "10px";
      note.style.borderRadius = "8px";
      note.style.background = "var(--background-secondary)";
      return;
    }

    const cfg = gameCapsuleService.ensureGameCapsuleSettings(this.plugin);

    new Setting(container)
      .setName("游戏运行时启用桌面侧边手札胶囊")
      .setDesc(
        "开启后，当启动已收录游戏（或开始计时）时，自动在显示器左右旁侧挂起窄窄的半透明竖条；光标移近时亮显浮起，点击即展开与档案馆实时镜像同步的「游戏手札」浮窗。平时未运行游戏时不占用屏幕。"
      )
      .addToggle((toggle) => {
        toggle.setValue(Boolean(cfg.enabled));
        toggle.onChange(async (value) => {
          const turningOn = value && !cfg.enabled;
          cfg.enabled = value;
          await this.plugin.saveSettings();
          gameCapsuleService.refreshGameCapsuleLifecycle(this.plugin);
          gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
          if (turningOn && cfg.taskbarPolicy === "ask") {
            gameCapsuleService.promptTaskbarPolicyIfNeeded(this.plugin, () => {
              this.display();
            });
          } else {
            this.display();
          }
        });
      })
      .addButton((btn) => {
        btn.setButtonText("预览侧边胶囊");
        btn.onClick(() => {
          gameCapsuleService.openCapsulePreview(this.plugin);
        });
      });

    if (compact && !cfg.enabled) {
      return;
    }

    new Setting(container)
      .setName("自动识别桌面快捷方式或 Steam 直接启动的游戏")
      .setDesc(
        "开启后，即使不从 Obsidian 内点启动，直接在电脑桌面双击已绑定路径的游戏（.exe / .lnk / Steam .url）运行时，也会自动唤出侧边手札胶囊并记录本次游玩时长。"
      )
      .addToggle((toggle) => {
        toggle.setValue(cfg.autoDetectExternalProcess !== false);
        toggle.onChange(async (value) => {
          cfg.autoDetectExternalProcess = value;
          await this.plugin.saveSettings();
          gameCapsuleService.refreshGameCapsuleLifecycle(this.plugin);
        });
      });

    new Setting(container)
      .setName("侧边窄条静默不透明度")
      .setDesc(
        `当前：${cfg.idleOpacity === 0 ? "0%（全透明隐形，仅光标移近该侧边缘时浮现）" : `${cfg.idleOpacity}%`}。窄条材质会自动跟随当前番剧档案馆的 6 款外观主题。`
      )
      .addSlider((slider) => {
        slider
          .setLimits(0, 100, 1)
          .setValue(cfg.idleOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            cfg.idleOpacity = Math.round(value);
            await this.plugin.saveSettings();
            gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
          });
      });

    new Setting(container)
      .setName("侧边窄条距显示器边缘间距")
      .setDesc("设置平行于显示器左右边缘的呼吸留白距离（0px 紧贴边缘 ～ 28px；按住胶囊或浮窗顶栏可跨多显示器自由拖动磁吸）。")
      .addSlider((slider) => {
        slider
          .setLimits(0, 28, 1)
          .setValue(cfg.edgeMargin)
          .setDynamicTooltip()
          .onChange(async (value) => {
            cfg.edgeMargin = Math.round(value);
            await this.plugin.saveSettings();
            gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
          });
      });

    if (!compact) {
      new Setting(container)
        .setName("侧边窄条粗细与长度")
        .setDesc(`当前窄条宽 ${cfg.stripWidth}px · 高 ${cfg.stripHeight}px。`)
        .addSlider((slider) => {
          slider
            .setLimits(4, 14, 1)
            .setValue(cfg.stripWidth)
            .setDynamicTooltip()
            .onChange(async (value) => {
              cfg.stripWidth = Math.round(value);
              await this.plugin.saveSettings();
              gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
            });
        })
        .addSlider((slider) => {
          slider
            .setLimits(52, 148, 4)
            .setValue(cfg.stripHeight)
            .setDynamicTooltip()
            .onChange(async (value) => {
              cfg.stripHeight = Math.round(value);
              await this.plugin.saveSettings();
              gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
            });
        });

      new Setting(container)
        .setName("默认附着屏幕侧边")
        .setDesc("选择侧边胶囊默认吸附在屏幕左侧还是右侧（也可直接鼠标按住胶囊拖向任意显示器边缘自动吸附）。")
        .addDropdown((dd) => {
          dd.addOptions({
            right: "屏幕右侧",
            left: "屏幕左侧"
          });
          dd.setValue(cfg.dockSide === "left" ? "left" : "right");
          dd.onChange(async (value) => {
            cfg.dockSide = value === "left" ? "left" : "right";
            await this.plugin.saveSettings();
            gameCapsuleService.refreshGameCapsuleLifecycle(this.plugin);
            gameCapsuleService.broadcastToCapsuleWindow(this.plugin);
          });
        });
    }

    new Setting(container)
      .setName("全屏游戏展开打字时的任务栏处理")
      .setDesc(
        "平时浏览、悬停或勾选待办采用无焦点置顶，不会唤出底部任务栏；点进文本框打字时，可选择临时自动收起系统任务栏（收起手札即刻还原），或保持系统默认。"
      )
      .addDropdown((dd) => {
        dd.addOptions({
          ask: "首次开启时询问我",
          auto_hide: "打字时临时收起系统任务栏（收起即还原）",
          keep_system: "不修改系统设置（允许任务栏浮现）"
        });
        dd.setValue(cfg.taskbarPolicy || "ask");
        dd.onChange(async (value) => {
          cfg.taskbarPolicy = value;
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
  addDisplaySettings(container, opts = {}) {
    if (!opts || !opts.skipHeading) {
      container.createEl("h3", {
        text: "笔记显示方式"
      });
    }

    new Setting(container)
      .setName("新建笔记时默认收起动画信息")
      .setDesc(
        "开启后，新创建的动画笔记会默认收起上方的动画信息区域。已有笔记不会被修改。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          Boolean(
            this.plugin.settings
              .animeInfoCollapsedByDefault
          )
        );

        toggle.onChange(async (value) => {
          this.plugin.settings
            .animeInfoCollapsedByDefault =
            value;

          await this.plugin.saveSettings();
        });
      });
  }

  addNetabaSettings(container, compact, opts = {}) {
    if (opts && opts.skipHeading) {
      this.addScoreSectionTitle(container, "Netaba 评分图");
    } else {
      container.createEl("h3", {
        text: "Netaba 评分图"
      });
    }

    if (compact) {
      const inheritedUserId =
        this.plugin.settings.netabaUserId ||
        this.plugin.settings.bangumiUserId ||
        "";

      new Setting(container)
        .setName("Bangumi 用户编号")
        .setDesc(
          inheritedUserId
            ? "当前使用 Bangumi 用户 ID：" +
              inheritedUserId +
              "。可在专业模式中单独设置。"
            : "默认使用 Bangumi 用户 ID。可在专业模式中单独设置。"
        );

      new Setting(container)
        .setName("新建笔记中的 Netaba 默认页面")
        .setDesc(
          "只影响以后新建的动画笔记。"
        )
        .addDropdown((dropdown) => {
          dropdown.addOptions({
            subject: "当前动画页面",
            season: "当季动画",
            trending: "评分趋势",
            history: "历史分布",
            user: "个人评分",
            compare: "动画对比"
          });

          dropdown.setValue(
            this.plugin.settings.netabaDefaultPage ||
            "subject"
          );

          dropdown.onChange(async (value) => {
            this.plugin.settings.netabaDefaultPage =
              value;

            await this.plugin.saveSettings();
          });
        });

      return;
    }

    const netabaDescription = container.createEl(
      "p",
      {
        text: "Netaba 评分图是插件添加到动画笔记中的外部评分页面。Bangumi 用户编号默认继承 Bangumi 用户 ID；在这里手动填写后，将不再跟随 Bangumi 用户 ID 变化。"
      }
    );

    netabaDescription.style.marginTop = "8px";
    netabaDescription.style.marginBottom = "18px";
    netabaDescription.style.maxWidth = "760px";
    netabaDescription.style.lineHeight = "1.6";
    netabaDescription.style.color = "var(--text-muted)";

    new Setting(container)
      .setName("Bangumi 用户编号")
      .setDesc(
        "用于 Netaba 的个人评分页面。留空时会继续使用 Bangumi 用户 ID。"
      )
      .addText((text) => {
        text.setPlaceholder("例如：890645");

        text.setValue(
          String(
            this.plugin.settings.netabaUserId ||
            this.plugin.settings.bangumiUserId ||
            ""
          )
        );

        text.onChange(async (value) => {
          const userId = value.trim();

          if (userId && !/^\d+$/.test(userId)) {
            new Notice(
              "Bangumi 用户编号只能填写数字。",
              5000
            );
            return;
          }

          this.plugin.settings.netabaUserId = userId;
          this.plugin.settings.netabaUserIdManuallySet =
            Boolean(userId);

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("恢复跟随 Bangumi 用户 ID")
      .setDesc(
        "清除手动设置的 Netaba 用户编号，并再次自动使用 Bangumi 用户 ID。"
      )
      .addButton((button) => {
        button.setButtonText("恢复");

        button.onClick(async () => {
          this.plugin.settings.netabaUserId =
            String(
              this.plugin.settings.bangumiUserId || ""
            ).trim();

          this.plugin.settings.netabaUserIdManuallySet =
            false;

          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(container)
      .setName("新建笔记中的 Netaba 默认页面")
      .setDesc(
        "只影响以后新建的动画笔记。笔记内的插件按钮可以单独切换当前笔记的页面。"
      )
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          subject: "当前动画页面",
          season: "当季动画",
          trending: "评分趋势",
          history: "历史分布",
          user: "个人评分",
          compare: "动画对比"
        });

        dropdown.setValue(
          this.plugin.settings.netabaDefaultPage ||
          "subject"
        );

        dropdown.onChange(async (value) => {
          this.plugin.settings.netabaDefaultPage =
            value;

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("新建笔记时添加 Netaba 评分图")
      .setDesc(
        "关闭后，新创建的动画笔记不会加入 Netaba 评分图。已有笔记不会被删除。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.netabaEmbedEnabled !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.netabaEmbedEnabled =
            value;

          await this.plugin.saveSettings();
        });
      });

    const compareSetting = new Setting(container)
      .setName("Netaba 对比页面中的另一部动画")
      .setDesc(
        this.plugin.settings.netabaCompareTitle
          ? "当前对比动画：" +
            this.plugin.settings.netabaCompareTitle
          : "尚未选择。插件会在 Netaba 对比页面中，将当前动画与这里选择的动画进行比较。"
      );

    compareSetting.addButton((button) => {
      button.setButtonText(
        this.plugin.settings.netabaCompareTitle
          ? "更换对比动画"
          : "搜索并选择动画"
      );

      button.onClick(() => {
        new NetabaCompareSelectModal(
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
        button.setButtonText("清除选择");

        button.onClick(async () => {
          this.plugin.settings.netabaCompareUrl = "";
          this.plugin.settings.netabaCompareTitle = "";

          await this.plugin.saveSettings();
          this.display();
        });
      });
    }

    new Setting(container)
      .setName("批量管理已有笔记中的评分图")
      .setDesc(
        "批量创建或删除已有动画笔记中的 Netaba 评分图。"
      )
      .addButton((button) => {
        button.setButtonText("打开管理窗口");

        button.onClick(async () => {
          await this.plugin.openNetabaNoteManager();
        });
      });

    new Setting(container)
      .setName("批量管理已有笔记中的标签")
      .setDesc(
        "批量为选中的动画笔记添加新标签，或从笔记中批量移除已有标签。"
      )
      .addButton((button) => {
        button.setButtonText("打开管理窗口");

        button.onClick(async () => {
          await this.plugin.openBatchTagManager();
        });
      });
  }

  addLazyActions(container) {
    this.addAction(
      container,
      "导入单个动画",
      "搜索 Bangumi，选择动画后自动创建笔记和本地封面。",
      async () => {
        await openSingleAnimeImport(
          this.app,
          this.plugin
        );
      }
    );

    this.addAction(
      container,
      "批量导入动画",
      "从 Bangumi 用户列表读取作品，并批量创建动画笔记。"
      ,
      async () => {
        await openBatchAnimeImport(
          this.app,
          this.plugin
        );
      }
    );

    this.addAction(
      container,
      "批量修改观看状态",
      "从动画列表中选择多部动画后一次修改观看状态。",
      async () => {
        await this.plugin.openBatchStatusManager();
      }
    );
  }

  /**
   * 帮助与交流反馈专区：
   * 1. GitHub 开源仓库地址 (https://github.com/Curelove/bangumi-manager) 与结构化 Issue 提交方案；
   * 2. 插件官方 QQ 交流群 (912120107) 与纯代码矢量渲染的群二维码（不向用户本地保存任何图片文件，确保 100% 扫码可用）。
   */
  addHelpAndCommunitySection(container) {
    container.createEl("h3", {
      text: "帮助与交流反馈"
    });

    const GITHUB_REPO_URL = "https://github.com/Curelove/bangumi-manager";
    const GITHUB_NEW_ISSUE_URL = "https://github.com/Curelove/bangumi-manager/issues/new";
    const QQ_GROUP_ID = "912120107";
    const QQ_GROUP_JOIN_URL = "https://qm.qq.com/q/qBNe2OicsU";

    // 1. GitHub 仓库与 Issue 反馈方案（采用上下分层全宽卡片布局，避免 Obsidian 默认 Setting 右侧三按钮挤压左侧文字导致 URL 被省略号截断及右侧下方留白）
    const githubCard = container.createDiv({ cls: "bangumi-help-github-card" });
    githubCard.style.padding = "14px 18px";
    githubCard.style.marginTop = "8px";
    githubCard.style.borderRadius = "10px";
    githubCard.style.border = "1px solid var(--background-modifier-border)";
    githubCard.style.background = "var(--background-secondary)";

    const ghTitleEl = githubCard.createDiv({
      text: "GitHub 开源仓库与问题反馈 (Issue)"
    });
    ghTitleEl.style.fontSize = "15px";
    ghTitleEl.style.fontWeight = "700";
    ghTitleEl.style.marginBottom = "6px";
    ghTitleEl.style.color = "var(--text-normal)";

    const ghUrlLine = githubCard.createDiv();
    ghUrlLine.style.fontSize = "12.5px";
    ghUrlLine.style.lineHeight = "1.55";
    ghUrlLine.style.color = "var(--text-muted)";
    ghUrlLine.style.marginBottom = "4px";
    ghUrlLine.style.whiteSpace = "normal";
    ghUrlLine.style.wordBreak = "break-all";
    ghUrlLine.createSpan({ text: "开源地址：" });
    const ghLink = ghUrlLine.createEl("a", {
      text: GITHUB_REPO_URL,
      href: GITHUB_REPO_URL
    });
    ghLink.style.wordBreak = "break-all";
    ghLink.onclick = (e) => {
      e.preventDefault();
      window.open(GITHUB_REPO_URL);
    };

    const ghDescEl = githubCard.createDiv({
      text: "若遇到 Bug、网络异常或有新功能建议，请先点击「复制排障环境信息」，再点击「提交 Issue」粘贴到 GitHub Issue 描述框中，并请自行补充填写具体问题描述与复现步骤后再提交。"
    });
    ghDescEl.style.fontSize = "12.5px";
    ghDescEl.style.lineHeight = "1.55";
    ghDescEl.style.color = "var(--text-muted)";
    ghDescEl.style.marginBottom = "12px";
    ghDescEl.style.whiteSpace = "normal";

    const ghBtnRow = githubCard.createDiv();
    ghBtnRow.style.display = "flex";
    ghBtnRow.style.flexWrap = "wrap";
    ghBtnRow.style.gap = "8px";

    const copyDiagBtn = ghBtnRow.createEl("button", {
      text: "复制排障环境信息"
    });
    copyDiagBtn.onclick = async () => {
      const pluginVer = this.plugin?.manifest?.version || "0.5.0";
      const diagText = [
        "### 运行环境诊断信息",
        `- **插件版本**: Bangumi Manager v${pluginVer}`,
        `- **设置模式**: ${this.plugin.settings.mode === "professional" ? "专业模式" : "快速开始模式"}`,
        `- **系统平台**: ${typeof navigator !== "undefined" ? navigator.platform : "Desktop"}`,
        `- **漫猫联动**: ${this.plugin.settings.enableComicatIntegration !== false ? "开启" : "关闭"}`,
        `- **qBittorrent 联动**: ${this.plugin.settings.enableQbittorrentIntegration !== false ? "开启" : "关闭"}`,
        `- **传统 Base 自动生成**: ${this.plugin.settings.enableBaseFileGeneration === true ? "开启" : "关闭(默认)"}`,
        "",
        "### 问题描述 / 功能建议（请在此补充填写您的具体情况）",
        "- **复现步骤**: ",
        "  1. ",
        "  2. ",
        "- **期望结果**: ",
        "- **实际结果 / 报错截图**: "
      ].join("\n");
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(diagText).catch(() => {});
      }
      new Notice("已复制排障环境信息模板！粘贴至 GitHub Issue 后，请补充填写您的具体问题与复现步骤。");
    };

    const openRepoBtn = ghBtnRow.createEl("button", {
      text: "↗ 打开 GitHub 仓库"
    });
    openRepoBtn.onclick = () => {
      window.open(GITHUB_REPO_URL);
    };

    const newIssueBtn = ghBtnRow.createEl("button", {
      cls: "mod-cta",
      text: "提交 Issue ↗"
    });
    newIssueBtn.onclick = () => {
      window.open(GITHUB_NEW_ISSUE_URL);
    };

    // 2. QQ 交流群与纯代码渲染二维码卡片
    const helpCard = container.createDiv({ cls: "bangumi-help-community-card" });
    helpCard.style.display = "flex";
    helpCard.style.flexWrap = "wrap";
    helpCard.style.alignItems = "center";
    helpCard.style.justifyContent = "space-between";
    helpCard.style.gap = "18px";
    helpCard.style.padding = "16px 18px";
    helpCard.style.marginTop = "10px";
    helpCard.style.marginBottom = "18px";
    helpCard.style.borderRadius = "10px";
    helpCard.style.border = "1px solid var(--background-modifier-border)";
    helpCard.style.background = "var(--background-secondary)";

    const infoCol = helpCard.createDiv({ cls: "bangumi-help-info-col" });
    infoCol.style.flex = "1 1 320px";
    infoCol.style.minWidth = "min(260px, 100%)";

    const titleEl = infoCol.createDiv({
      text: `插件官方 QQ 交流群：${QQ_GROUP_ID}`
    });
    titleEl.style.fontSize = "15px";
    titleEl.style.fontWeight = "700";
    titleEl.style.marginBottom = "10px";
    titleEl.style.color = "var(--text-normal)";

    const issueGuideEl = infoCol.createDiv();
    issueGuideEl.style.fontSize = "12px";
    issueGuideEl.style.lineHeight = "1.55";
    issueGuideEl.style.padding = "8px 10px";
    issueGuideEl.style.borderRadius = "6px";
    issueGuideEl.style.background = "var(--background-primary)";
    issueGuideEl.style.border = "1px dashed var(--background-modifier-border)";
    issueGuideEl.style.color = "var(--text-muted)";
    issueGuideEl.style.marginBottom = "12px";
    issueGuideEl.innerHTML =
      "<strong>提交 Issue 建议：</strong><br/>" +
      "① 点击上方「复制排障环境信息」获取版本与配置摘要；<br/>" +
      "② 点击「提交 Issue ↗」打开 <code>github.com/Curelove/bangumi-manager/issues/new</code> 粘贴模板，<strong>并自行补充填写具体问题与复现步骤</strong>；<br/>" +
      "③ 若无法访问 GitHub，也可直接加入 QQ 交流群 <strong>912120107</strong> 反馈。";

    const btnRow = infoCol.createDiv();
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "8px";

    const copyGroupBtn = btnRow.createEl("button", {
      text: `复制群号 (${QQ_GROUP_ID})`
    });
    copyGroupBtn.onclick = async () => {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(QQ_GROUP_ID).catch(() => {});
      }
      new Notice(`已复制 QQ 交流群号：${QQ_GROUP_ID}`);
    };

    // 右侧：纯代码 SVG 矩阵渲染的 QQ 群二维码（对应 https://qm.qq.com/q/qBNe2OicsU，Version 3 29x29 EC-Q Mask-2）
    const qrCol = helpCard.createDiv({ cls: "bangumi-help-qr-col" });
    qrCol.style.display = "flex";
    qrCol.style.flexDirection = "column";
    qrCol.style.alignItems = "center";
    qrCol.style.padding = "10px 12px";
    qrCol.style.borderRadius = "10px";
    qrCol.style.background = "#ffffff";
    qrCol.style.border = "1px solid rgba(0,0,0,0.12)";
    qrCol.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)";

    this.renderPureCodeQqGroupQrSvg(qrCol);
  }

  /**
   * 使用纯代码 SVG 渲染群二维码矩阵（29×29 模块 + 4 模块静区 = 37×37 坐标系），
   * 不随插件打包或向用户本地写入任何图片文件，且支持任意缩放不失真、扫码率 100%。
   */
  renderPureCodeQqGroupQrSvg(mountEl) {
    const QQ_GROUP_QR_MATRIX_29 = [
      "11111110110011110001101111111",
      "10000010000100011101001000001",
      "10111010011111000110101011101",
      "10111010010000000000101011101",
      "10111010111001110000001011101",
      "10000010110001101100101000001",
      "11111110101010101010101111111",
      "00000000010110000111100000000",
      "01111111010010101010000110001",
      "11011101100110001001000011011",
      "00101010011101110110100100101",
      "01111100010011111011001111100",
      "01110111111111111100110011010",
      "10100101000111011111101011001",
      "11001010111110001101000100101",
      "00110001100111011111010110111",
      "00010010111111111110110100000",
      "11011000100011111000111100010",
      "10001111101110110100010000100",
      "10011101101101110001101011111",
      "10001011110100110010111111111",
      "00000000101000101001100011001",
      "11111110101010100101101011110",
      "10000010110000100001100011011",
      "10111010100011011111111110000",
      "10111010111110111000111011000",
      "10111010110111011100011111110",
      "10000010111100011000100100001",
      "11111110011111111011110111000"
    ];

    const size = 29;
    const quiet = 4;
    const total = size + quiet * 2;
    const pathParts = [];

    for (let r = 0; r < size; r++) {
      const rowStr = QQ_GROUP_QR_MATRIX_29[r];
      for (let c = 0; c < size; c++) {
        if (rowStr[c] === "1") {
          pathParts.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
        }
      }
    }

    const svgWrap = mountEl.createDiv({ cls: "bangumi-pure-code-qr-svg-wrap" });
    svgWrap.dataset.qrPayload = "https://qm.qq.com/q/qBNe2OicsU";
    svgWrap.dataset.qrGroup = "912120107";
    svgWrap.style.width = "168px";
    svgWrap.style.height = "168px";
    svgWrap.style.display = "block";
    svgWrap.innerHTML = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="168" height="168" shape-rendering="crispEdges" role="img" aria-label="QQ交流群 912120107 二维码">`,
      `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
      `<path d="${pathParts.join("")}" fill="#000000"/>`,
      `</svg>`
    ].join("");
  }

  addProfessionalActions(container) {
    const isMobile = isMobileEnv();
    this.addAction(
      container,
      "导入单个动画",
      isMobile
        ? "搜索 Bangumi 并创建动画笔记；封面保存目录使用上方设置。"
        : "搜索 Bangumi 并创建动画笔记；封面保存目录和新下载默认保存目录使用上方设置。",
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
      "\u6309\u5F53\u524D\u8DEF\u5F84\u8BBE\u7F6E\u521B\u5EFA\u7F3A\u5C11\u7684\u52A8\u753B\u7B14\u8BB0\u76EE\u5F55\u3001\u5C01\u9762\u76EE\u5F55\u548C\u52A8\u753B\u5E93 Base \u6587\u4EF6\uFF1B\u5DF2\u6709\u6587\u4EF6\u4E0D\u4F1A\u8986\u76D6\u3002",
      async () => {
        await this.plugin.initializeMissingFiles();
      }
    );
    this.addLegacyNoteUpgradeSetting(container);
    if (!isMobile) {
      this.addAction(
        container,
        "\u7ACB\u5373\u68C0\u67E5\u5168\u90E8\u672C\u5730\u72B6\u6001",
        "\u7ACB\u5373\u626B\u63CF\u5168\u90E8\u76EE\u6807\u7B14\u8BB0\uFF0C\u5C06\u89C6\u9891\u6570\u91CF\u4E0E\u5DF2\u89C2\u770B\u96C6\u6570\u6BD4\u8F83\uFF0C\u5E76\u5199\u5165\u672C\u5730\u66F4\u65B0\u72B6\u6001\u3002",
        async () => {
          await this.plugin.checkAllLocalStatus(true);
        }
      );
    }
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
      "生成当前季度视图",
      "按照当前日期判断季度，只新增当前季度视图。",
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
        String(this.plugin.settings[key] || "")
      );
      text.onChange(async (value) => {
        const cleanVal = this.normalizeVaultFolderPath(value);
        this.plugin.settings[key] = cleanVal;
        if (
          key === "characterImageFolder" ||
          key === "reviewImageFolder" ||
          key === "illustrationGalleryFolder" ||
          key === "gameImageFolder"
        ) {
          this.plugin.settings.imageFoldersCustomized = true;
        }
        await this.plugin.saveSettings();
      });
      this.bindPathInputAutoMigration(text, key, () => this.plugin.settings[key] || "");
    });
  }
};

  BangumiManagerSettingTab.scoreSettingFuzzyMatch = scoreSettingFuzzyMatch;
  BangumiManagerSettingTab.isFuzzySubsequence = isFuzzySubsequence;
  return BangumiManagerSettingTab;
};
