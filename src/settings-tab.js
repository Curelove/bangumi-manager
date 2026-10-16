const Modal = globalThis.__BangumiManagerModal;

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
  const BangumiManagerSettingTab = class extends PluginSettingTab {
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

  addBaseFolderSetting(container) {
    new Setting(container)
      .setName("动画库目录")
      .setDesc(
        "填写动画库文件所在的目录。插件会自动在这里创建“动画库.base”，无需输入文件名。"
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
      "动画笔记保存位置。动画库和 Markdown 仪表盘会自动放在该目录下的“追番广场”中。"
    );

    new Setting(container)
      .setName("初始化缺失文件")
      .setDesc(
        "创建缺少的动画笔记目录、封面目录和动画库文件。已有文件不会被覆盖。"
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
      .setName("显示管理入口")
      .setDesc(
        "开启后，在 Obsidian 左侧显示统一的 Bangumi 管理入口。"
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
  }

  displayProfessionalMode(container) {
    this.addIntroDescription(
      container,
      "专业模式展示完整设置。路径、评分监测、仪表盘、季度视图、笔记显示、Netaba 和全部管理操作均可在这里调整。切换模式只改变展示，不会修改已有配置。"
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

    this.addBaseFolderSetting(container);

    this.addPathSetting(
      container,
      "封面目录",
      "coverFolder",
      "本地封面保存目录。"
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
      .setName("显示管理入口")
      .setDesc(
        "开启后，在 Obsidian 左侧显示统一的 Bangumi 管理入口。"
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
      text: "动画评分仪表盘"
    });

    new Setting(container)
      .setName("打开专属仪表盘")
      .setDesc(
        "在插件专属页面中打开评分仪表盘，不受阅读模式和实时预览模式影响。"
      )
      .addButton((button) => {
        button.setButtonText("打开");

        button.onClick(async () => {
          await this.plugin.openScoreDashboardView();
        });
      });

    new Setting(container)
      .setName("恢复仪表盘默认布局")
      .setDesc(
        "清除评分仪表盘自定义拖拽顺序、折叠和隐藏状态，恢复默认智能排序。"
      )
      .addButton((button) => {
        button.setButtonText("恢复默认");

        button.onClick(async () => {
          await this.plugin.resetScoreDashboardLayout();
          this.display();
        });
      });

    new Setting(container)
      .setName("显示侧边栏仪表盘按钮")
      .setDesc(
        "在 Obsidian 左侧功能栏显示动画评分仪表盘图标。"
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

    new Setting(container)
      .setName("启用 Markdown 仪表盘")
      .setDesc(
        "开启后创建并维护 Markdown 仪表盘快照，适合导出、链接和阅读模式查看。关闭后不会删除已有文件。"
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

    if (compact) {
      return;
    }

    if (
      this.plugin.settings.markdownDashboardEnabled ===
      false
    ) {
      new Setting(container)
        .setName("我的评分排名显示数量")
        .setDesc(
          "专属仪表盘中“我的评分排名”默认显示的动画数量。"
        )
        .addText((text) => {
          text.setValue(
            String(
              this.plugin.settings.dashboardPersonalRankLimit ||
              10
            )
          );

          text.onChange(async (value) => {
            this.plugin.settings.dashboardPersonalRankLimit =
              Math.max(
                1,
                Math.min(
                  50,
                  Number(value) || 10
                )
              );

            await this.plugin.saveSettings();
          });
        });

      new Setting(container)
        .setName("BGM 用户评分排名显示数量")
        .setDesc(
          "专属仪表盘中“BGM 用户评分排名”默认显示的动画数量。"
        )
        .addText((text) => {
          text.setValue(
            String(
              this.plugin.settings.dashboardBangumiRankLimit ||
              10
            )
          );

          text.onChange(async (value) => {
            this.plugin.settings.dashboardBangumiRankLimit =
              Math.max(
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

    new Setting(container)
      .setName("Markdown 仪表盘路径")
      .setDesc(
        "Markdown 仪表盘快照的仓库路径。文件名会自动补全为 .md。"
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
      .setName("打开 Markdown 仪表盘")
      .setDesc(
        "打开 Markdown 仪表盘快照。图表内容需要在阅读模式中显示。"
      )
      .addButton((button) => {
        button.setButtonText("打开");

        button.onClick(async () => {
          await this.plugin.openScoreDashboard();
        });
      });

    new Setting(container)
      .setName("重建 Markdown 仪表盘")
      .setDesc(
        "恢复 Markdown 仪表盘的标准内容。此操作会覆盖该笔记中的自定义文字。"
      )
      .addButton((button) => {
        button.setButtonText("重建");

        button.onClick(async () => {
          await this.plugin.ensureScoreDashboard(true);

          new Notice(
            "Markdown 仪表盘已重建。",
            5000
          );
        });
      });

    new Setting(container)
      .setName("自动刷新 Markdown 仪表盘")
      .setDesc(
        "后台评分监测和评分显示刷新完成后，自动更新 Markdown 仪表盘快照。"
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
      .setName("刷新 Markdown 仪表盘")
      .setDesc(
        "立即更新 Markdown 仪表盘快照。"
      )
      .addButton((button) => {
        button.setButtonText("刷新");

        button.onClick(async () => {
          await this.plugin.refreshScoreDashboard(true);

          new Notice(
            "Markdown 仪表盘已刷新。",
            4000
          );
        });
      });


    new Setting(container)
      .setName("我的评分排名显示数量")
      .setDesc(
        "专属仪表盘和 Markdown 仪表盘中“我的评分排名”默认显示的动画数量。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.dashboardPersonalRankLimit ||
            10
          )
        );

        text.onChange(async (value) => {
          this.plugin.settings.dashboardPersonalRankLimit =
            Math.max(
              1,
              Math.min(
                50,
                Number(value) || 10
              )
            );

          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("BGM 用户评分排名显示数量")
      .setDesc(
        "专属仪表盘和 Markdown 仪表盘中“BGM 用户评分排名”默认显示的动画数量。"
      )
      .addText((text) => {
        text.setValue(
          String(
            this.plugin.settings.dashboardBangumiRankLimit ||
            10
          )
        );

        text.onChange(async (value) => {
          this.plugin.settings.dashboardBangumiRankLimit =
            Math.max(
              1,
              Math.min(
                50,
                Number(value) || 10
              )
            );

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
      text: "笔记评分控制动画笔记的属性区和正文；仪表盘选项只影响评分仪表盘；数据更新控制何时访问评分数据来源。"
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
      .setName("显示 BGM 用户评分")
      .setDesc(
        "在动画笔记的属性区和正文中显示你的 Bangumi 评分。关闭后会从笔记隐藏该项，但不会影响 Bangumi 网站上的评分。"
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
      .setName("使用精确 BGM评分")
      .setDesc(
        "开启后，笔记中的唯一“BGM评分”改为精确评分；关闭后恢复普通 Bangumi 页面评分。不会创建“BGM精确评分”属性。"
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
      .setName("精确 BGM评分显示小数位数")
      .setDesc(
        "仅在启用精确 BGM评分后影响笔记正文和精确评分排名的显示。原始评分不会被修改。"
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
      "仪表盘"
    );

    new Setting(container)
      .setName("显示精确评分排名")
      .setDesc(
        "在动画评分仪表盘中显示按精确 BGM评分排序的排名。此项不改变笔记属性或正文。"
      )
      .addToggle((toggle) => {
        toggle.setValue(
          this.plugin.settings.dashboardShowPreciseRank ===
          true
        );

        toggle.onChange(async (value) => {
          this.plugin.settings.dashboardShowPreciseRank =
            value;
await this.saveAndRefreshDashboard();

          if (value) {
            await this.refreshEnabledScoreDataAfterSettingChange();
          }
        });
      });


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
        "开启后，插件会按下方间隔自动更新 BGM 用户评分、普通 BGM评分，以及当前启用的精确评分和仪表盘排名。关闭后停止后台请求，手动更新仍可使用。"
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
        "读取普通 BGM评分、BGM 用户评分，以及当前启用的精确评分。同步过程中可以关闭窗口并让任务在后台继续。"
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
      "生成当前季度视图",
      "只新增当前季度视图，不删除旧季度视图。",
      async () => {
        await this.plugin.runTemporarySeasonMode(
          "current"
        );
      }
    );

    this.addAction(
      container,
      "安全清理已完成季度视图",
      "只删除动画库中的已完成季度视图，不删除动画笔记和本地文件。",
      async () => {
        await this.plugin.cleanCompletedSeasonViews(
          true
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

  return BangumiManagerSettingTab;
};
