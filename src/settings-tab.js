const Modal = globalThis.__BangumiManagerModal;
const {
  checkRoxyHdPortraitsStatus,
  downloadRoxyHdPortraitPack,
  normalizeRoxy2DModeSettings
} = require("./roxy-mascot-service");
const reviewStudioService = require("./review-studio-service");

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
};
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
  const SETTINGS_SEARCH_SYNONYM_GROUPS = [
    ["player", "pot", "potplayer", "mpv", "vlc", "mpc", "dandan", "dandanplay", "弹弹", "播放", "播放器", "空降", "进度", "视频", "快捷方式", "lnk", "exe", "bfq", "spbf"],
    ["review", "手札", "手记", "观片", "吐槽", "短评", "长评", "截图", "粘贴", "附图", "时间点", "时间码", "书签", "sz", "sj", "gpsz"],
    ["character", "角色", "典藏", "萌点", "萌娘", "百科", "身高", "标尺", "等身", "立绘", "抠图", "背景", "照片墙", "画报", "声优", "cv", "发色", "瞳色", "js", "jsdc", "md"],
    ["roxy", "洛琪希", "看板娘", "小人", "像素", "语音", "立绘包", "高清", "压印", "泥岩", "魔导", "气泡", "台词", "lqx", "kbn", "yy"],
    ["download", "rss", "bt", "qb", "qbittorrent", "mikan", "蜜柑", "花园", "dmhy", "nyaa", "acgrip", "磁力", "magnet", "种子", "torrent", "下载", "追番下载", "字幕组", "xz", "zfxz"],
    ["dashboard", "3d", "2d", "档案馆", "番剧档案馆", "仪表盘", "案头", "编目台", "画廊", "年鉴", "书脊", "陈列架", "统计", "洞察", "雷达", "番季", "dag", "ybp", "bmt"],
    ["score", "rating", "评分", "排行", "同步", "监测", "bgm", "bangumi", "netaba", "趋势", "对比", "分布", "pf", "pftb", "ph"],
    ["path", "folder", "dir", "目录", "路径", "文件夹", "封面", "本地", "根目录", "初始化", "base", "仓库", "ml", "lj", "wjj"],
    ["season", "季度", "新番", "排期", "清理", "视图", "年代", "年份", "jd", "xf"]
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
    const fullHaystack = itemRecord.fullHaystack || "";

    let totalScore = 0;
    const matchedTokens = [];

    for (const token of tokens) {
      let tokenScore = 0;

      // 1. 直接子串命中（标题权重最高，其次章节名、控件文案、描述说明）
      if (nameLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 110 + (nameLower.startsWith(token) ? 20 : 0));
        matchedTokens.push(token);
      } else if (secLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 82);
        matchedTokens.push(token);
      } else if (ctrlLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 70);
        matchedTokens.push(token);
      } else if (descLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 62);
        matchedTokens.push(token);
      }

      // 2. 同义词 / 概念别名 / 拼音首字母扩展匹配
      if (tokenScore === 0) {
        for (const group of SETTINGS_SEARCH_SYNONYM_GROUPS) {
          const hitAlias = group.some((alias) => alias.includes(token) || token.includes(alias));
          if (hitAlias) {
            const targetHits = group.filter((kw) => kw.length >= 2 && fullHaystack.includes(kw));
            if (targetHits.length > 0) {
              tokenScore = Math.max(tokenScore, 68);
              matchedTokens.push(targetHits[0]);
              break;
            }
          }
        }
      }

      // 3. 非连续字符模糊子序列匹配（例如输入 "番档" 命中 "番剧档案馆"，输入 "自播径" 命中 "自定义视频播放器路径"）
      if (tokenScore === 0 && token.length >= 2) {
        const subName = isFuzzySubsequence(token, nameLower);
        if (subName.matched && subName.gapScore >= 14) {
          tokenScore = Math.max(tokenScore, 38 + subName.gapScore);
          matchedTokens.push(token);
        } else {
          const subFull = isFuzzySubsequence(token, `${secLower} ${nameLower} ${descLower}`);
          if (subFull.matched && subFull.gapScore >= 18) {
            tokenScore = Math.max(tokenScore, 28 + subFull.gapScore);
            matchedTokens.push(token);
          }
        }
      }

      if (tokenScore <= 0) {
        return { matched: false, score: 0, matchedTokens: [] };
      }
      totalScore += tokenScore;
    }

    return { matched: true, score: totalScore, matchedTokens: Array.from(new Set(matchedTokens)) };
  }

  function ensureSettingsSpotlightStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("bangumi-settings-spotlight-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "bangumi-settings-spotlight-styles";
    styleEl.textContent = [
      ".bgm-settings-sticky-hud{position:sticky;top:-18px;z-index:35;margin:-8px -8px 16px -8px;padding:12px 14px 10px;border-radius:11px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 92%, #f6efe3 8%);backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(28,20,12,0.09);display:flex;flex-direction:column;gap:9px;}",
      ".bgm-settings-hud-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".bgm-settings-hud-brand{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}",
      ".bgm-settings-hud-title{margin:0 !important;font-size:1.22em !important;font-weight:800 !important;color:var(--text-normal);}",
      ".bgm-settings-hud-mode-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;border:1px solid rgba(143,104,61,0.34);letter-spacing:0.04em;}",
      ".bgm-settings-spotlight-capsule{position:relative;display:flex;align-items:center;flex:1 1 290px;max-width:460px;min-width:220px;}",
      ".bgm-settings-spotlight-icon{position:absolute;left:10px;font-size:13px;color:#8f683d;pointer-events:none;}",
      ".bgm-settings-spotlight-input{width:100% !important;padding:6px 86px 6px 30px !important;font-size:12.5px !important;border-radius:999px !important;border:1px solid color-mix(in srgb, #8f683d 38%, var(--background-modifier-border)) !important;background:var(--background-secondary) !important;color:var(--text-normal) !important;transition:all .16s ease !important;}",
      ".bgm-settings-spotlight-input:focus{border-color:#8f683d !important;background:var(--background-primary) !important;box-shadow:0 0 0 3px rgba(143,104,61,0.18) !important;}",
      ".bgm-settings-spotlight-meta{position:absolute;right:8px;display:inline-flex;align-items:center;gap:4px;}",
      ".bgm-settings-spotlight-count{font-size:10.5px;font-weight:700;padding:1.5px 7px;border-radius:999px;background:color-mix(in srgb, #8f683d 14%, var(--background-primary));color:#8f683d;pointer-events:none;font-variant-numeric:tabular-nums;}",
      ".bgm-settings-spotlight-clear{cursor:pointer;width:19px;height:19px;padding:0;border:none;border-radius:50%;background:rgba(143,104,61,0.16);color:#8f683d;font-size:12px;font-weight:800;display:none;align-items:center;justify-content:center;line-height:1;}",
      ".bgm-settings-spotlight-clear.is-visible{display:inline-flex;}",
      ".bgm-settings-spotlight-clear:hover{background:#8f683d;color:#fffdf9;}",
      ".bgm-settings-compass-rail{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-top:6px;border-top:1px dashed color-mix(in srgb, #8f683d 24%, var(--background-modifier-border));}",
      ".bgm-settings-compass-label{font-size:10.5px;font-weight:700;color:var(--text-muted);margin-right:2px;}",
      ".bgm-settings-compass-chip{cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2.5px 9px;font-size:11px;font-weight:600;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);transition:all .14s ease;}",
      ".bgm-settings-compass-chip:hover{border-color:#8f683d;color:var(--text-normal);transform:translateY(-1px);}",
      ".bgm-settings-compass-chip.is-active{background:linear-gradient(135deg,#8f683d,#b08450);border-color:#8f683d;color:#fffdf9;font-weight:700;box-shadow:0 2px 6px rgba(143,104,61,0.25);}",
      ".bgm-settings-compass-chip-cnt{font-size:9.5px;opacity:0.82;font-variant-numeric:tabular-nums;}",
      ".bgm-settings-compass-mode-btn{cursor:pointer;margin-left:auto;padding:2px 8px;font-size:10.5px;font-weight:700;border-radius:6px;border:1px dashed rgba(143,104,61,0.48);background:transparent;color:#8f683d;transition:all .14s ease;}",
      ".bgm-settings-compass-mode-btn.is-focus-only{border-style:solid;background:rgba(143,104,61,0.14);}",
      ".bgm-settings-search-hidden{display:none !important;}",
      ".setting-item.is-bgm-search-match{border-left:3px solid #8f683d !important;padding-left:10px !important;background:color-mix(in srgb, #8f683d 5%, transparent);border-radius:6px;}",
      ".bgm-setting-section-crumb{display:inline-flex;align-items:center;margin-left:7px;padding:1px 6px;font-size:10px;font-weight:700;border-radius:4px;background:rgba(143,104,61,0.14);color:#8f683d;border:1px solid rgba(143,104,61,0.3);vertical-align:middle;}",
      "mark.bgm-setting-hit-mark{background:rgba(217,167,74,0.32);color:inherit;padding:0 2px;border-radius:3px;font-weight:700;}",
      "@keyframes bgmSectionSpotlightPulse{0%{background:rgba(217,167,74,0.28);}100%{background:transparent;}}",
      ".bgm-section-pulse-highlight{animation:bgmSectionSpotlightPulse 1.2s ease-out;border-radius:6px;}",
      ".bgm-settings-empty-search{padding:18px 16px;margin:12px 0;border-radius:10px;border:1px dashed color-mix(in srgb, #8f683d 42%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f7efe2 28%);text-align:center;display:none;flex-direction:column;align-items:center;gap:8px;}",
      ".bgm-settings-empty-search.is-visible{display:flex;}",
      ".bgm-settings-empty-title{font-size:13px;font-weight:700;color:var(--text-normal);}",
      ".bgm-settings-empty-sub{font-size:11.5px;color:var(--text-muted);}",
      ".bgm-settings-empty-suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:4px;}"
    ].join("\n");
    document.head.appendChild(styleEl);
  }

  const BangumiManagerSettingTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this._savedSpotlightQuery = "";
    this._savedFocusSectionKey = "all";
    this._savedFocusOnlyMode = false;
  }
  display() {
    ensureSettingsSpotlightStyles();
    const container = this.containerEl;
    container.empty();
    const topHudMount = container.createDiv("bgm-settings-top-hud-mount");
    if (this.plugin.settings.mode === "lazy") {
      topHudMount.createEl("h2", {
        text: "Bangumi \u8FFD\u756A\u7BA1\u7406\u5668"
      });
      this.displayLazyMode(container);
    } else {
      this.displayProfessionalMode(container, topHudMount);
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
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/[\\/]+$/, "");
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

  addNoteRootSetting(container, description) {
    new Setting(container)
      .setName("动画笔记目录")
      .setDesc(description)
      .addText((text) => {
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

  addCharacterNoteFolderSetting(container) {
    new Setting(container)
      .setName("角色典藏笔记目录")
      .setDesc(
        "生成角色典藏 Markdown 笔记的仓库保存位置。默认与「动画笔记目录」处于同一层级（并列文件夹，如：角色典藏），留空则自动恢复为与动画笔记目录同级的默认路径。"
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
      });
  }

  displayLazyMode(container) {
    this.addIntroDescription(
      container,
      "快速开始模式保留首次使用和日常追番所需的设置。其他高级选项可在专业模式中调整，切换模式不会修改已有配置。"
    );

    new Setting(container)
      .setName("使用模式")
      .setDesc(
        "快速开始模式仅显示常用设置。切换模式只改变设置项展示，不会修改已有配置。"
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
          this.display();
        });
      });

    container.createEl("h3", {
      text: "快速开始"
    });

    new Setting(container)
      .setName("本地动画根目录")
      .setDesc(
        "用于提示和创建本地动画文件夹，不会移动已有视频。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.localAnimeRoot || ""
          )
        );

        text.onChange(async (value) => {
          this.plugin.settings.localAnimeRoot =
            value.trim();

          await this.plugin.saveSettings();
        });
      });

    this.addBangumiUserSetting(container);

    this.addNoteRootSetting(
      container,
      "动画笔记保存位置。Markdown 番剧档案馆会自动放在该目录下的“追番广场”中。"
    );

    this.addCharacterNoteFolderSetting(container);

    new Setting(container)
      .setName("初始化缺失文件")
      .setDesc(
        "创建缺少的动画笔记目录、封面目录和 Markdown 番剧档案馆（默认不再自动生成传统 动画库.base，如需生成可在专业模式中开启）。已有文件不会被覆盖。"
      )
      .addButton((button) => {
        button.setButtonText("立即初始化");

        button.onClick(async () => {
          await this.plugin.initializeMissingFiles();
        });
      });

    this.addDashboardSettings(container, true);
    this.addNetabaSettings(container, true);

    container.createEl("h3", {
      text: "快速操作"
    });

    new Setting(container)
      .setName("显示侧边栏「Bangumi 追番管理器」按钮")
      .setDesc(
        "开启后，在 Obsidian 左侧功能栏显示「Bangumi 追番管理器」专属电视徽标按钮。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          Boolean(
            this.plugin.settings.showManagerRibbon
          )
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showManagerRibbon =
            value;

          await this.plugin.saveSettings();
          this.plugin.refreshManagerRibbon();
        });
      });

    this.addLazyActions(container);
    this.addHelpAndCommunitySection(container);
  }

  displayProfessionalMode(container, topHudMount) {
    this.addIntroDescription(
      container,
      "专业模式展示完整设置。路径、评分监测、番剧档案馆（二维案头编目台 / 三维原画档案室）、季度视图、笔记显示、Netaba 和全部管理操作均可在这里调整。切换模式只改变展示，不会修改已有配置。"
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
          this.display();
        });
      });

    container.createEl("h3", {
      text: "路径设置"
    });

    this.addNoteRootSetting(
      container,
      "扫描和管理 Bangumi 动画笔记的仓库目录。"
    );

    this.addCharacterNoteFolderSetting(container);

    this.addBaseFolderSetting(container);

    this.addPathSetting(
      container,
      "封面目录",
      "coverFolder",
      "本地封面保存目录。"
    );

    this.addPathSetting(
      container,
      "观片手札图片目录",
      "reviewImageFolder",
      "观片手札粘贴截图（Ctrl+V）与上传附图保存的独立仓库目录（默认：附件/观片手札图片，与动画封面目录完全隔离）。"
    );

    new Setting(container)
      .setName("本地动画根目录")
      .setDesc(
        "用于提示和创建本地动画文件夹，不会移动已有视频。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.localAnimeRoot || ""
          )
        );

        text.onChange(async (value) => {
          this.plugin.settings.localAnimeRoot =
            value.trim();

          await this.plugin.saveSettings();
        });
      });

    this.addBangumiUserSetting(container);
    this.addBangumiSettings(container);

    container.createEl("h3", {
      text: "检查与视图"
    });

    this.addCheckSettings(container);
    this.addSeasonSettings(container);
    this.addDisplaySettings(container);

    this.addDashboardSettings(container, false);
    this.addNetabaSettings(container, false);

    container.createEl("h3", {
      text: "管理入口"
    });

    new Setting(container)
      .setName("显示侧边栏「Bangumi 追番管理器」按钮")
      .setDesc(
        "开启后，在 Obsidian 左侧功能栏显示「Bangumi 追番管理器」专属电视徽标按钮。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          Boolean(
            this.plugin.settings.showManagerRibbon
          )
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showManagerRibbon =
            value;

          await this.plugin.saveSettings();
          this.plugin.refreshManagerRibbon();
        });
      });

    container.createEl("h3", {
      text: "快速操作"
    });

    this.addProfessionalActions(container);
    this.addHelpAndCommunitySection(container);

    // 挂载非冗余顶栏聚光灯模糊搜索与章节磁吸罗盘 HUD（独立于 .setting-item 之外，绝不与普通设置项并列混排）
    this.mountProfessionalSettingsSpotlightHud(container, topHudMount);
  }

  mountProfessionalSettingsSpotlightHud(container, topHudMount) {
    if (!container) return;
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
      text: "✦ 专业模式全景台"
    });

    // 右侧：Spotlight 模糊搜索胶囊框
    const searchCapsule = topRow.createDiv("bgm-settings-spotlight-capsule");
    searchCapsule.createSpan({
      cls: "bgm-settings-spotlight-icon",
      text: "🔍"
    });
    const searchInput = searchCapsule.createEl("input", {
      type: "text",
      cls: "bgm-settings-spotlight-input",
      placeholder: "模糊搜索设置项 / 功能词 / 拼音缩写（如：播放器、蜜柑、身高、lqx）…"
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
    clearBtn.title = "清空搜索与筛选 (Esc)";

    // 第二行：章节磁吸快速定位与分类专注罗盘
    const compassRail = hud.createDiv("bgm-settings-compass-rail");
    compassRail.createSpan({
      cls: "bgm-settings-compass-label",
      text: "🧭 章节速达："
    });

    // 扫描 container 下所有章节标题 (h3) 与设置项 (.setting-item 及自定义面板)
    const resolveSectionIcon = (title) => {
      const t = String(title || "");
      if (t.includes("路径") || t.includes("目录")) return "📂";
      if (t.includes("Bangumi") || t.includes("评分")) return "⭐";
      if (t.includes("检查") || t.includes("视图")) return "🔍";
      if (t.includes("季度")) return "📅";
      if (t.includes("笔记") || t.includes("显示")) return "📝";
      if (t.includes("档案馆") || t.includes("仪表盘")) return "🏛️";
      if (t.includes("播放器") || t.includes("手札")) return "🎬";
      if (t.includes("下载") || t.includes("RSS") || t.includes("追番")) return "📥";
      if (t.includes("洛琪希") || t.includes("看板娘")) return "🧙‍♀️";
      if (t.includes("Netaba")) return "📈";
      if (t.includes("管理入口")) return "🎛️";
      if (t.includes("快速操作")) return "⚡";
      if (t.includes("帮助") || t.includes("交流") || t.includes("社群")) return "💬";
      return "📌";
    };

    const sections = [];
    const indexedItems = [];
    let currentSection = {
      key: "sec-general",
      title: "模式与概览",
      icon: "⚙️",
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
          icon: resolveSectionIcon(rawTitle),
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
          origNameText,
          origDescText,
          nameLower: origNameText.toLowerCase(),
          descLower: origDescText.toLowerCase(),
          ctrlLower: ctrlText.toLowerCase(),
          sectionKey: currentSection.key,
          sectionTitle: currentSection.title,
          sectionIcon: currentSection.icon,
          sectionLower: currentSection.title.toLowerCase(),
          fullHaystack: `${currentSection.title} ${origNameText} ${origDescText} ${ctrlText}`.toLowerCase()
        };
        currentSection.items.push(rec);
        indexedItems.push(rec);
      } else {
        // 诸如段落介绍、洛琪希立绘包状态面板、社群二维码卡片等附属块
        const blockText = (el.textContent || "").trim();
        if (blockText && currentSection.key !== "sec-general") {
          const rec = {
            el,
            nameEl: null,
            descEl: null,
            origNameText: currentSection.title,
            origDescText: blockText,
            nameLower: currentSection.title.toLowerCase(),
            descLower: blockText.toLowerCase(),
            ctrlLower: "",
            sectionKey: currentSection.key,
            sectionTitle: currentSection.title,
            sectionIcon: currentSection.icon,
            sectionLower: currentSection.title.toLowerCase(),
            fullHaystack: `${currentSection.title} ${blockText}`.toLowerCase()
          };
          currentSection.items.push(rec);
          indexedItems.push(rec);
        } else {
          currentSection.extraEls.push(el);
        }
      }
    });

    // 空搜索结果提示面板
    const emptyStateBox = container.createDiv("bgm-settings-empty-search");
    emptyStateBox.createDiv({
      cls: "bgm-settings-empty-title",
      text: "🔍 未找到匹配的设置项"
    });
    emptyStateBox.createDiv({
      cls: "bgm-settings-empty-sub",
      text: "可尝试输入更短的关键词、功能俗称（如：播放器、蜜柑、抠图、身高、看板娘）或点击下方高频分类直接定位："
    });
    const emptySugRow = emptyStateBox.createDiv("bgm-settings-empty-suggestions");
    [
      { label: "🎬 本地播放器联动", q: "播放器" },
      { label: "📥 蜜柑 RSS 与追番下载", q: "下载" },
      { label: "👑 角色典藏目录", q: "角色" },
      { label: "🧙‍♀️ 洛琪希看板娘", q: "洛琪希" },
      { label: "🏛️ 番剧档案馆", q: "番剧档案馆" },
      { label: "📂 路径与封面目录", q: "目录" }
    ].forEach((sug) => {
      const sb = emptySugRow.createEl("button", {
        cls: "bgm-settings-compass-chip",
        text: sug.label
      });
      sb.onclick = (e) => {
        e.preventDefault();
        searchInput.value = sug.q;
        this._savedSpotlightQuery = sug.q;
        this._savedFocusSectionKey = "all";
        applyFilterAndHighlight();
      };
    });

    // 构建章节磁吸罗盘胶囊按钮
    const chipRefs = [];
    const createCompassChip = (secKey, labelText, countNum, targetHeadingEl) => {
      const chip = compassRail.createEl("button", {
        cls: "bgm-settings-compass-chip"
      });
      chip.createSpan({ text: labelText });
      if (typeof countNum === "number") {
        chip.createSpan({
          cls: "bgm-settings-compass-chip-cnt",
          text: `${countNum}`
        });
      }
      chip.onclick = (e) => {
        e.preventDefault();
        if (secKey === "all") {
          this._savedFocusSectionKey = "all";
          applyFilterAndHighlight();
          container.scrollTo?.({ top: 0, behavior: "smooth" });
          return;
        }
        if (this._savedFocusOnlyMode) {
          this._savedFocusSectionKey =
            this._savedFocusSectionKey === secKey ? "all" : secKey;
          applyFilterAndHighlight();
        } else {
          // 既支持全览平滑滚动定位，若当前处于搜索过滤中也自动清空或切换到该章节
          if (this._savedFocusSectionKey !== "all") {
            this._savedFocusSectionKey = secKey;
          }
          if (searchInput.value.trim()) {
            searchInput.value = "";
            this._savedSpotlightQuery = "";
          }
          applyFilterAndHighlight();
          if (targetHeadingEl && typeof targetHeadingEl.scrollIntoView === "function") {
            targetHeadingEl.scrollIntoView({ behavior: "smooth", block: "start" });
            targetHeadingEl.classList.remove("bgm-section-pulse-highlight");
            void targetHeadingEl.offsetWidth;
            targetHeadingEl.classList.add("bgm-section-pulse-highlight");
          }
        }
      };
      chipRefs.push({ key: secKey, chip });
    };

    createCompassChip("all", "✦ 全部", indexedItems.length, null);
    sections.forEach((sec) => {
      if (sec.key === "sec-general" || sec.items.length === 0) return;
      createCompassChip(sec.key, `${sec.icon} ${sec.title}`, sec.items.length, sec.headingEl);
    });

    // 右侧切换「点击跳至章节 vs 仅展开选中章节（折叠其余章节防眼花）」
    const focusModeBtn = compassRail.createEl("button", {
      cls: `bgm-settings-compass-mode-btn ${this._savedFocusOnlyMode ? "is-focus-only" : ""}`,
      text: this._savedFocusOnlyMode ? "📌 模式：仅看选中章" : "🧭 模式：点击跳至章"
    });
    focusModeBtn.title = "切换章节按钮行为：「点击滚动跳转到对应章节」或「仅显示选中的单个章节（隐藏其他章节，彻底告别设置项过多眼花）」";
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
        this._savedFocusOnlyMode ? "📌 模式：仅看选中章" : "🧭 模式：点击跳至章"
      );
      applyFilterAndHighlight();
    };

    // 渲染匹配高亮与章节面包屑标签
    const updateItemNamePresentation = (rec, isSearchActive, matchedTokens) => {
      if (!rec.nameEl) return;
      rec.nameEl.empty();
      const rawTitle = rec.origNameText;
      if (!isSearchActive || !matchedTokens || matchedTokens.length === 0) {
        rec.nameEl.setText(rawTitle);
        return;
      }
      // 查找最长可直接高亮的子串
      const lowerTitle = rawTitle.toLowerCase();
      let hitToken = "";
      for (const tk of matchedTokens) {
        if (tk && lowerTitle.includes(tk) && tk.length > hitToken.length) {
          hitToken = tk;
        }
      }
      if (hitToken) {
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
      rec.nameEl.createSpan({
        cls: "bgm-setting-section-crumb",
        text: `${rec.sectionIcon} ${rec.sectionTitle}`
      });
    };

    const applyFilterAndHighlight = () => {
      const q = searchInput.value.trim();
      this._savedSpotlightQuery = q;
      const isSearchActive = q.length > 0;
      const activeSecKey = this._savedFocusSectionKey || "all";

      clearBtn.toggleClass("is-visible", isSearchActive || activeSecKey !== "all");
      chipRefs.forEach((r) => {
        r.chip.toggleClass("is-active", !isSearchActive && r.key === activeSecKey);
      });

      let visibleItemCount = 0;

      sections.forEach((sec) => {
        let secVisibleCount = 0;
        const secAllowedByFocus =
          isSearchActive || activeSecKey === "all" || sec.key === activeSecKey;

        sec.items.forEach((rec) => {
          if (!secAllowedByFocus) {
            rec.el.classList.add("bgm-settings-search-hidden");
            rec.el.classList.remove("is-bgm-search-match");
            updateItemNamePresentation(rec, false, []);
            return;
          }
          const res = scoreSettingFuzzyMatch(q, rec);
          if (res.matched) {
            rec.el.classList.remove("bgm-settings-search-hidden");
            rec.el.classList.toggle("is-bgm-search-match", isSearchActive);
            updateItemNamePresentation(rec, isSearchActive, res.matchedTokens);
            secVisibleCount++;
            visibleItemCount++;
          } else {
            rec.el.classList.add("bgm-settings-search-hidden");
            rec.el.classList.remove("is-bgm-search-match");
            updateItemNamePresentation(rec, false, []);
          }
        });

        sec.extraEls.forEach((exEl) => {
          exEl.classList.toggle(
            "bgm-settings-search-hidden",
            isSearchActive || (activeSecKey !== "all" && sec.key !== activeSecKey)
          );
        });

        if (sec.headingEl) {
          sec.headingEl.classList.toggle("bgm-settings-search-hidden", secVisibleCount === 0);
        }
      });

      if (isSearchActive) {
        countBadge.setText(`命中 ${visibleItemCount} / ${indexedItems.length} 项`);
      } else if (activeSecKey !== "all") {
        countBadge.setText(`当前章 ${visibleItemCount} 项`);
      } else {
        countBadge.setText(`共 ${indexedItems.length} 项设置`);
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
        applyFilterAndHighlight();
      }
    });

    clearBtn.onclick = (e) => {
      e.preventDefault();
      searchInput.value = "";
      this._savedSpotlightQuery = "";
      this._savedFocusSectionKey = "all";
      applyFilterAndHighlight();
      searchInput.focus();
    };

    applyFilterAndHighlight();
  }

  addReviewAndPlayerSettings(container, compact) {
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
            ? `\n👉 当前生效播放器：${playerInfo.activeLabel}${playerInfo.activeExePath ? " (" + playerInfo.activeExePath + ")" : ""}`
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
          auto: "⚡ 自动检测（优先 PotPlayer 空降，其次 弹弹play）",
          potplayer: "🎬 PotPlayer（打开视频并精确空降到时间点）",
          dandanplay: "💬 弹弹play（打开视频并自动复制时间码）",
          mpv: "🎞️ MPV（--start= 精确空降）",
          vlc: "🔶 VLC（--start-time= 精确空降）",
          mpc: "📽️ MPC-HC / MPC-BE（/startpos 精确空降）",
          custom: "🛠️ 自定义播放器路径（支持 .exe 或 .lnk）",
          system: "🖥️ 系统默认关联程序"
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
            ? `\n✅ 已自动从快捷方式解析真实程序路径：${resolved}`
            : `\n✅ 程序路径有效：${resolved}`;
      } else {
        resolvedHint = `\n⚠️ 未找到该路径对应的程序文件，请检查路径是否正确。`;
      }
    }

    if (!compact || this.plugin.settings.localVideoPlayerMode === "custom" || rawCustomPath) {
      new Setting(container)
        .setName("自定义视频播放器路径（支持 .exe 或 .lnk 快捷方式）")
        .setDesc(
          "可填写播放器可执行文件（如 D:\\PotPlayer\\PotPlayerMini64.exe、%APPDATA%\\弹弹play\\dandanplay.exe）或桌面/开始菜单快捷方式（如 C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\PotPlayer\\PotPlayer 64 bit.lnk），插件会自动解析 .lnk 指向的真实 .exe。" +
            resolvedHint
        )
        .addText((text) => {
          text.setPlaceholder("留空则自动探测本机安装的播放器（支持 .exe 或 .lnk）");
          text.setValue(rawCustomPath);
          text.onChange(async (value) => {
            this.plugin.settings.localVideoPlayerCustomPath = value.trim();
            await this.plugin.saveSettings();
          });
        });
    }
  }

  addBangumiUserSetting(container) {
    new Setting(container)
      .setName("Bangumi 用户 ID")
      .setDesc(
        "用于批量导入动画、打开 Bangumi 用户评分排行和读取用户评分。快速开始模式下会自动作为 Netaba 用户编号使用。"
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
    container.createEl("h3", {
      text: "番剧档案馆"
    });

    new Setting(container)
      .setName("显示侧边栏「打开番剧档案馆」按钮")
      .setDesc(
        "在 Obsidian 左侧功能栏显示「打开番剧档案馆」专属双翼档案册图标（其他番剧档案馆详细设置已全部默认启用，可在专业模式中按需调整）。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.showDashboardRibbon !==
          false
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.showDashboardRibbon =
            value;

          await this.plugin.saveSettings();
          this.plugin.refreshDashboardRibbon();
        });
      });

    this.addReviewAndPlayerSettings(container, compact);

    if (compact) {
      return;
    }

    new Setting(container)
      .setName("打开番剧档案馆")
      .setDesc(
        "在插件专属页面中打开番剧档案馆（含「二维案头编目台」与「三维原画档案室」），不受阅读模式和实时预览模式影响。"
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
        "清除二维案头编目台自定义排序、折叠和隐藏状态，恢复默认编目布局。"
      )
      .addButton((button) => {
        button.setButtonText("恢复默认");

        button.onClick(async () => {
          await this.plugin.resetScoreDashboardLayout();
          this.display();
        });
      });

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

    new Setting(container)
      .setName("案头追番席 · 管理多个自定义季度席位与滑动上限")
      .setDesc(
        "自由添加或移除多个季度的收藏动画席位（具体哪几个季度由您自行决定），并配置横向左右滑动或网格展开模式与显示数量上限。"
      )
      .addButton((button) => {
        button
          .setButtonText("配置季度席位与滑动")
          .setCta()
          .onClick(async () => {
            if (typeof this.plugin.openDeskSeasonManagerFromSettings === "function") {
              await this.plugin.openDeskSeasonManagerFromSettings();
            }
          });
      });

    new Setting(container)
      .setName("案头追番席 · 默认排列模式")
      .setDesc(
        "选择「横向左右滑动（支持鼠标滚轮与 ‹ › 按钮，不截断卡片数量）」或「多行网格全部展开」。"
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

    const roxyModeInfo = normalizeRoxy2DModeSettings(this.plugin);
    const hdStatus = roxyModeInfo.hdStatus;

    new Setting(container)
      .setName("洛琪希高清立绘扩展包（独立附加资源）")
      .setDesc(
        hdStatus.installed
          ? `当前状态：已安装本地高清立绘包（${hdStatus.foundCount}/${hdStatus.totalCount} 张 PNG）。由于 BRAT 仅拉取 main.js 与 manifest.json，新用户若未下载此扩展包，插件会自动适配为已编译进 main.js 的内置轻量像素洛琪希。`
          : `当前状态：未检测到完整的高清立绘扩展包（已存在 ${hdStatus.foundCount}/${hdStatus.totalCount} 张），当前已自动适配为内置轻量像素洛琪希。点击右侧按钮可免解压一键下载 7 张高清透明立绘到本地插件目录。`
      )
      .addButton((button) => {
        button
          .setButtonText(hdStatus.installed ? "重新校验 / 补全立绘包" : "📥 一键下载高清立绘包")
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
                this.plugin.settings.roxyForceLightweight2D = false;
                this.plugin.settings.enableRoxy2DMascot = true;
                await this.plugin.saveSettings();
                await this.plugin.refreshOpenDashboardViews();
                this.display();
              } else {
                new Notice(
                  `高清立绘包下载未全部完成（成功 ${res?.downloaded || 0}/${res?.total || 7}），请确认仓库或 Release 中已上传对应图片后重试。`,
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

    const isHdMascotOn = hdStatus.installed && Boolean(this.plugin.settings.enableRoxy2DMascot);
    const isPixelModeOn = Boolean(this.plugin.settings.roxyForceLightweight2D);
    const disableHdToggle = !hdStatus.installed || isPixelModeOn;
    const hdToggleTooltip = !hdStatus.installed
      ? "需要先下载“洛琪希高清立绘扩展包”"
      : isPixelModeOn
        ? "请先关闭二维像素小人模式"
        : "";

    const hdMascotSetting = new Setting(container)
      .setName("启用二维馆藏记录员（洛琪希看板娘）")
      .setDesc(
        "在番剧档案馆「二维案头编目台」右下角显示高清立绘版洛琪希馆藏记录员。需先安装上方高清立绘扩展包，且与下方轻量像素模式互斥；若两项同时关闭则隐藏二维记录员。"
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
          if (!hdStatus.installed || this.plugin.settings.roxyForceLightweight2D) {
            return;
          }
          this.plugin.settings.enableRoxy2DMascot = value;
          if (value) {
            this.plugin.settings.roxyForceLightweight2D = false;
            if (this.plugin._roxyCoordinator) {
              this.plugin._roxyCoordinator.sessionHidden2D = false;
            }
          }
          await this.saveAndRefreshDashboard();
          this.display();
        });
      });
    hdMascotSetting.setDisabled(disableHdToggle);
    if (hdToggleTooltip) {
      hdMascotSetting.settingEl.title = hdToggleTooltip;
      hdMascotSetting.settingEl.style.opacity = "0.65";
      if (hdMascotSetting.controlEl) hdMascotSetting.controlEl.title = hdToggleTooltip;
    }

    const disablePixelToggle = isHdMascotOn;
    const pixelToggleTooltip = disablePixelToggle ? "请先关闭“启用二维馆藏记录员（洛琪希看板娘）”" : "";

    const pixelMascotSetting = new Setting(container)
      .setName("二维记录员使用内置轻量像素形象（无立绘包适配模式）")
      .setDesc(
        "开启后，二维案头编目台将使用内置于 main.js 的轻量矢量像素洛琪希（未下载高清立绘包时默认开启；与上方高清立绘看板娘互斥，两项均关闭时完全停用二维记录员）。"
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
          if (isHdMascotOn) {
            return;
          }
          this.plugin.settings.roxyForceLightweight2D = value;
          if (value) {
            this.plugin.settings.enableRoxy2DMascot = false;
            if (this.plugin._roxyCoordinator) {
              this.plugin._roxyCoordinator.sessionHidden2D = false;
            }
          }
          await this.saveAndRefreshDashboard();
          this.display();
        });
      });
    pixelMascotSetting.setDisabled(disablePixelToggle);
    if (pixelToggleTooltip) {
      pixelMascotSetting.settingEl.title = pixelToggleTooltip;
      pixelMascotSetting.settingEl.style.opacity = "0.65";
      if (pixelMascotSetting.controlEl) pixelMascotSetting.controlEl.title = pixelToggleTooltip;
    }

    new Setting(container)
      .setName("启用三维馆藏记录员（像素洛琪希手办框）")
      .setDesc(
        "在番剧档案馆「三维原画档案室」左上角边缘显示像素洛琪希桌角手办框。不遮挡 3D 封套与详情面板，仅对档案抽出、归位、笔记纸页、高分策展切换、空轨道等真实事件作出短暂反馈。"
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
      .setName("启用追番下载与单集 RSS 助手")
      .setDesc(
        "在二维案头追番席、画廊卡片与索引表中显示「⬇ 下载/RSS」按钮，支持在 Obsidian 内直接选择发布源、核验每集唯一 RSS 并启动下载。"
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
        .setName("启用漫猫动漫 (www.comicat.org) 搜索与单集 RSS 解析")
        .setDesc(
          "开启后可在弹窗内自动检索 comicat.org 动画资源、按字幕组划分发布源并生成每集唯一的专属 RSS。若您不使用 comicat.org，可关闭此项。"
        )
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.enableComicatIntegration !== false);
          toggle.onChange(async (value) => {
            this.plugin.settings.enableComicatIntegration = value;
            await this.plugin.saveSettings();
            this.display();
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
        new Setting(container)
          .setName("qBittorrent 程序路径（可选）")
          .setDesc(
            "留空将自动探测 C:/Program Files/qBittorrent/qbittorrent.exe 及系统注册表；如安装在其他位置可在此手动填写。"
          )
          .addText((text) => {
            text.setPlaceholder("留空自动检测，例如 C:/Program Files/qBittorrent/qbittorrent.exe");
            text.setValue(String(this.plugin.settings.qbittorrentExecutablePath || ""));
            text.onChange(async (value) => {
              this.plugin.settings.qbittorrentExecutablePath = value.trim();
              await this.plugin.saveSettings();
            });
          });

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

    if (
      this.plugin.settings.markdownDashboardEnabled ===
      false
    ) {
      new Setting(container)
        .setName("综合评分排行榜默认显示数量")
        .setDesc(
          "番剧档案馆中“综合评分排行榜”（我的评分 / 你在 BGM 上的评分 / BGM 评分）默认显示的动画数量。"
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

      return;
    }

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
      .setName("自定义查询分区")
      .setDesc("根据标签、状态、评分门槛及年代创建个性化的动态聚合分区。")
      .addButton((btn) => {
        btn
          .setButtonText("+ 新建查询分区")
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
      .setName("自定义收藏展柜")
      .setDesc("手动挑选并编排心爱作品的专属展柜，支持自定义排序与展示形态。")
      .addButton((btn) => {
        btn
          .setButtonText("+ 新建收藏展柜")
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

  addBangumiSettings(container) {
    container.createEl("h3", {
      text: "评分与排名"
    });

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
  addDisplaySettings(container) {
    container.createEl("h3", {
      text: "笔记显示方式"
    });

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

  addNetabaSettings(container, compact) {
    container.createEl("h3", {
      text: "Netaba 评分图"
    });

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
      text: "📋 复制排障环境信息"
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
      text: "🐛 提交 Issue"
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
    infoCol.style.minWidth = "260px";

    const titleEl = infoCol.createDiv({
      text: `💬 插件官方 QQ 交流群：${QQ_GROUP_ID}`
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
      "<strong>💡 提交 Issue 方案建议：</strong><br/>" +
      "① 点击上方「📋 复制排障环境信息」获取版本与配置摘要；<br/>" +
      "② 点击「🐛 提交 Issue」打开 <code>github.com/Curelove/bangumi-manager/issues/new</code> 粘贴模板，<strong>并自行补充填写具体问题与复现步骤</strong>；<br/>" +
      "③ 若无法访问 GitHub，也可直接加入 QQ 交流群 <strong>912120107</strong> 反馈。";

    const btnRow = infoCol.createDiv();
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "8px";

    const copyGroupBtn = btnRow.createEl("button", {
      text: `📋 复制群号 (${QQ_GROUP_ID})`
    });
    copyGroupBtn.onclick = async () => {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(QQ_GROUP_ID).catch(() => {});
      }
      new Notice(`已复制 QQ 交流群号：${QQ_GROUP_ID}`);
    };

    const joinUrlBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: "↗ 一键唤起 QQ 加群"
    });
    joinUrlBtn.onclick = () => {
      window.open(QQ_GROUP_JOIN_URL);
    };

    // 右侧：纯代码 SVG 矩阵渲染的 QQ 群二维码（对应 https://qm.qq.com/q/qBNe2OicsU，Version 3 29x29 EC-Q Mask-2）
    const qrCol = helpCard.createDiv({ cls: "bangumi-help-qr-col" });
    qrCol.style.display = "flex";
    qrCol.style.flexDirection = "column";
    qrCol.style.alignItems = "center";
    qrCol.style.gap = "6px";
    qrCol.style.padding = "10px 12px";
    qrCol.style.borderRadius = "10px";
    qrCol.style.background = "#ffffff";
    qrCol.style.border = "1px solid rgba(0,0,0,0.12)";
    qrCol.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)";

    this.renderPureCodeQqGroupQrSvg(qrCol);

    const qrCap = qrCol.createDiv({
      text: `手机 QQ 扫码加群 · ${QQ_GROUP_ID}`
    });
    qrCap.style.fontSize = "11px";
    qrCap.style.fontWeight = "700";
    qrCap.style.color = "#222222";
    qrCap.style.letterSpacing = "0.02em";
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

  BangumiManagerSettingTab.scoreSettingFuzzyMatch = scoreSettingFuzzyMatch;
  BangumiManagerSettingTab.isFuzzySubsequence = isFuzzySubsequence;
  return BangumiManagerSettingTab;
};
