"use strict";

const bangumiApi = require("./bangumi-api.js");
const noteUtils = require("./note-utils.js");

const PHASES = {
  SCAN: "正在扫描动画笔记",
  USER: "正在读取 Bangumi 用户评分",
  DETAIL: "正在读取普通评分和精确评分",
  READY: "评分数据已读取，正在准备写入",
  WRITE: "正在写入动画笔记",
  DASHBOARD: "正在刷新仪表盘",
  DONE: "已完成",
  STOPPED: "已中止",
  DISCARDED: "已中止，未保存本次结果",
  FAILED: "已失败"
};

const SELF_WRITE_WINDOW_MS = 5000;

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  return Math.min(
    max,
    Math.max(
      min,
      Number.isFinite(parsed)
        ? parsed
        : fallback
    )
  );
}

function copyObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? Object.assign({}, value)
    : {};
}

function isFresh(meta, now, ttlMs) {
  const at = Number(meta && meta.at);

  return Number.isFinite(at) &&
    at > 0 &&
    now - at < ttlMs;
}

function formatDuration(value) {
  const totalSeconds = Math.max(
    0,
    Math.round(Number(value) / 1000) || 0
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes + " 分 " + seconds + " 秒";
}

class RatingSyncManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.task = null;
    this.listeners = new Set();
    this.selfWrites = new Map();
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
        console.warn("评分同步状态监听失败:", error);
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
      details: new Map(),
      userRatings: new Map(),
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
    this.task.phase = "等待停止决定";
    this.task.currentName =
      "已暂停后续请求，等待停止决定";
    this.emit();

    return true;
  }

  resumeAfterDecision() {
    if (!this.isRunning() || !this.task.pauseRequested) {
      return false;
    }

    this.task.pauseRequested = false;
    this.task.phase =
      this.task.pausedPhase || PHASES.SCAN;
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
      task.lastError =
        error && error.message
          ? error.message
          : String(error);
      console.error("评分同步任务失败:", error);
    } finally {
      await this.finish(task);
    }

    return task;
  }

  async run(task, options) {
    task.items = await this.collectItems(
      task,
      Array.isArray(options.targets)
        ? options.targets
        : null
    );

    task.total = task.items.length;

    await this.waitWhilePaused(task);

    if (!task.items.length || task.stopRequested) {
      return;
    }

    task.preciseEnabled =
      this.plugin.settings.showBangumiPreciseScore === true ||
      this.plugin.settings.dashboardShowPreciseRank === true;

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
    const files = targets ||
      this.plugin.app.vault.getMarkdownFiles();

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
        const parsed = noteUtils.parseFrontmatter(content);

        if (
          !parsed ||
          !String(parsed.fields.tags || "").includes("bangumi")
        ) {
          continue;
        }

        const subjectId = bangumiApi.getSubjectId(
          noteUtils.cleanValue(parsed.fields.BGM链接)
        );

        if (!subjectId) {
          continue;
        }

        items.push({
          file,
          content,
          parsed,
          subjectId,
          title:
            noteUtils.cleanValue(parsed.fields.中文名) ||
            file.basename ||
            subjectId
        });

        task.scanned += 1;
        task.currentName = items[items.length - 1].title;

        if (items.length % 20 === 0) {
          this.emit();
        }
      } catch (error) {
        task.failed += 1;
        console.warn("读取动画笔记失败:", file.path, error);
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
      task.userRatingsSkipReason =
        "未填写 Bangumi 用户 ID，已跳过用户评分同步";
      this.emit();
      return;
    }

    try {
      task.userRatings =
        await bangumiApi.getUserRatingsForSubjects(
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
              task.currentName =
                "正在读取 " +
                progress.path +
                " 列表第 " +
                progress.page +
                " 页";
              this.emit();
            }
          }
        );
    } catch (error) {
      task.userRatingsSkipped = true;
      task.userRatingsSkipReason =
        "读取用户评分失败：" +
        (error && error.message
          ? error.message
          : String(error));
      console.warn("读取 BGM 用户评分失败:", error);
    }

    this.emit();
  }

  selectDetailTargets(task) {
    const settings = this.plugin.settings;
    const ttlMs = clampNumber(
      settings.ratingCacheTtlSeconds,
      3600,
      2592000,
      86400
    ) * 1000;
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
    const seen = new Set();
    const targetIds = [];

    for (const item of task.items) {
      const subjectId = item.subjectId;

      if (seen.has(subjectId)) {
        continue;
      }

      seen.add(subjectId);

      const needsPublic =
        task.mode !== "preciseOnly" &&
        (
          task.forceRefresh ||
          !publicCache[subjectId] ||
          !isFresh(publicMeta[subjectId], now, ttlMs)
        );

      const needsPrecise =
        task.preciseEnabled &&
        (
          task.forceRefresh ||
          !preciseCache[subjectId] ||
          !isFresh(preciseMeta[subjectId], now, ttlMs)
        );

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

    const outcome =
      await bangumiApi.getScoreDetailsForSubjects(
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
            1000,
            300
          ),
          timeoutMs: clampNumber(
            this.plugin.settings.ratingRequestTimeoutMs,
            3000,
            60000,
            15000
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
              task.currentName =
                "正在读取动画编号 " +
                progress.subjectId;
            }

            this.emit();
          }
        }
      );

    task.details = outcome.results;
    task.detailStats = outcome.stats;

    for (const detail of task.details.values()) {
      if (detail.error && detail.error !== "已停止") {
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
      if (
        task.stopRequested &&
        task.stopMode !== "commit"
      ) {
        break;
      }

      let content = item.content;
      let changed = false;
      const userRating = task.userRatings.get(item.subjectId);
      const detail = task.details.get(item.subjectId);

      task.currentName = item.title;

      if (
        userRating !== undefined &&
        userRating !== null
      ) {
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

        const updated = noteUtils.updateScoreFields(
          content,
          settings.showBangumiUserScore !== false
            ? score
            : null,
          settings.showPersonalScore !== false
            ? (
                noteUtils.cleanValue(
                  item.parsed.fields.我的评分
                ) || "未评分"
              )
            : null
        );

        if (updated !== content) {
          content = updated;
          changed = true;
        }
      }

      if (detail && !detail.error) {
        let publicScoreChanged = false;
        let preciseScoreChanged = false;

        if (
          task.mode !== "preciseOnly" &&
          detail.publicScore !== null
        ) {
          const score = String(detail.publicScore);

          publicScoreChanged =
            publicCache[item.subjectId] !== score;

          publicCache[item.subjectId] = score;
          publicMeta[item.subjectId] = {
            at: now,
            source: "bangumi"
          };

          if (publicScoreChanged) {
            task.publicRatingsUpdated += 1;
          }
        }

        if (
          task.preciseEnabled &&
          detail.preciseScore !== null
        ) {
          const score = String(detail.preciseScore);

          preciseScoreChanged =
            preciseCache[item.subjectId] !== score;

          preciseCache[item.subjectId] = score;
          preciseMeta[item.subjectId] = {
            at: now,
            source: "bangumi"
          };

          if (preciseScoreChanged) {
            task.preciseRatingsUpdated += 1;
          }
        }

        if (
          publicScoreChanged ||
          preciseScoreChanged
        ) {
          const displayedScore =
            task.preciseEnabled
              ? (
                  preciseCache[item.subjectId] ||
                  noteUtils.cleanValue(
                    item.parsed.fields.BGM评分
                  )
                )
              : (
                  publicCache[item.subjectId] ||
                  noteUtils.cleanValue(
                    item.parsed.fields.BGM评分
                  )
                );

          const updated =
            noteUtils.synchronizeBangumiScoreFields(
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
            "写入评分字段失败:",
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
    task.wasStopped =
      task.wasStopped || task.stopRequested;

    try {
      if (this.shouldCommit(task)) {
        await this.commit(task);

        this.plugin.settings.lastRatingMonitorAt =
          Date.now();

        try {
          await this.plugin.saveSettings();
          task.settingsSaved += 1;
        } catch (error) {
          task.failed += 1;
          console.warn("保存评分缓存失败:", error);
        }

        if (task.notesUpdated > 0) {
          task.phase = PHASES.DASHBOARD;
          this.emit();

          try {
            await this.plugin.refreshScoreDashboard(false);
            task.dashboardRefreshes += 1;
          } catch (error) {
            task.failed += 1;
            console.warn("刷新动画仪表盘失败:", error);
          }
        }
      } else if (task.stopRequested) {
        task.discarded = true;
      }
    } catch (error) {
      task.hadFatalError = true;
      task.failed += 1;
      task.lastError =
        error && error.message
          ? error.message
          : String(error);
      console.error("评分同步收尾失败:", error);
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

    const title = task.hadFatalError
      ? "评分同步失败："
      : task.discarded
        ? "评分同步已中止，未保存本次结果："
        : task.wasStopped
          ? "评分同步已中止，已保存已获取结果："
          : "评分同步完成：";

    const parts = [
      "扫描 " + task.scanned + " 篇",
      "详情请求 " + task.requested + " 部",
      "缓存跳过 " + task.skipped + " 部",
      "用户评分更新 " + task.userRatingsUpdated + " 部",
      "普通评分更新 " + task.publicRatingsUpdated + " 部",
      "精确评分更新 " + task.preciseRatingsUpdated + " 部",
      "写入笔记 " + task.notesUpdated + " 篇",
      "无数据 " + task.noData + " 部",
      "失败 " + task.failed + " 部"
    ];

    if (task.userRatingsSkipped) {
      parts.push(task.userRatingsSkipReason);
    }

    return (
      title +
      parts.join("，") +
      "。耗时 " +
      formatDuration(task.elapsed) +
      "。"
    );
  }
}

module.exports = {
  RatingSyncManager,
  RATING_SYNC_PHASES: PHASES
};