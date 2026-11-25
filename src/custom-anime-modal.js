/**
 * 自定义动画建档与资料编辑工作窗（不依赖 Bangumi · 桌面与移动端全兼容）
 * ------------------------------------------------------------------------
 * 功能：
 *   1) 手动新建 Bangumi 未收录或未检索到的自定义动画（支持自定义封面、数值、状态、进度、评分、番季、制作阵容、标签、参考评分、外链与本地文件夹）；
 *   2) 编辑已有动画（含自定义动画与 Bangumi 条目）的核心档案资料，无损保留 `# 观片手记与评价` 正文、手札与截图；
 *   3) 支持日后补绑 Bangumi 条目链接并自动迁移本地视频关联键；
 *   4) 零裸调 Node 模块，遵循 --bm7-* 主题令牌，完整适配 6 套外观明暗态及 390px 手机竖屏。
 */
"use strict";

const { Modal, Notice } = require("obsidian");
const {
  tryRequireNode,
  isDesktopNodeAvailable,
  isMobileEnv,
  joinPosixPath
} = require("./platform-env.js");
const { normalizeAppearance } = require("./v07-themes.js");
const v07Core = require("./v07-core.js");
const noteManager = require("./note-manager.js");
const noteUtils = require("./note-utils.js");
const bangumiApi = require("./bangumi-api.js");
const animeActivityService = require("./anime-activity-and-random-service.js");
const localMediaIndexService = require("./local-media-index-service.js");
const { setSamplePreviewActive } = require("./onboarding-sample-service.js");

const CUSTOM_ANIME_STYLE_ID = "bm-custom-anime-modal-styles";

const WATCH_STATES = ["想看", "在看", "已看", "抛弃"];
const MEDIA_FORMATS = ["TV", "OVA", "剧场版", "WEB", "短片", "其他"];
const ADAPTATION_OPTIONS = ["原创动画", "漫画改编", "小说改编", "游戏改编", "其他"];
const SEASON_OPTIONS = [
  { value: "__auto__", label: "自动推算" },
  { value: "01月新番", label: "01月新番（冬）" },
  { value: "04月新番", label: "04月新番（春）" },
  { value: "07月新番", label: "07月新番（夏）" },
  { value: "10月新番", label: "10月新番（秋）" },
  { value: "__none__", label: "不分季" }
];
const QUICK_TAG_SUGGESTIONS = ["OVA", "剧场版", "短片", "原创", "日常", "恋爱", "奇幻", "科幻", "悬疑", "百合", "治愈", "搞笑"];

const PLACEHOLDER_META_SET = new Set(["未知", "未知季度", "无", "未设置", "暂无", "-"]);

function stripPlaceholderMeta(raw) {
  const s = String(raw || "").trim();
  if (!s || PLACEHOLDER_META_SET.has(s)) return "";
  return s;
}

function getTodayCompact() {
  const now = new Date();
  return (
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0")
  );
}

function hashPosterHue(str) {
  let h = 2166136261;
  const s = String(str || "Anime");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

function parseOptionalScore(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "未评分" || s === "未知") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 10) return NaN;
  return Math.round(n * 100) / 100;
}

function parseOptionalInt(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.floor(n);
}

function splitUserTags(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,，;；\s#\[\]"']+/)
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== "bangumi")
    )
  );
}

function pickLocalFolderViaElectron(initialDir = "") {
  try {
    if (!isDesktopNodeAvailable()) return null;
    const electron = tryRequireNode("electron");
    const remote = electron?.remote || tryRequireNode("@electron/remote");
    const dialog = remote?.dialog || electron?.dialog;
    if (!dialog || typeof dialog.showOpenDialog !== "function") return null;
    const opts = {
      title: "选择本地动画视频文件夹",
      properties: ["openDirectory", "dontAddToRecent"]
    };
    if (initialDir && typeof initialDir === "string") {
      opts.defaultPath = initialDir;
    }
    return dialog.showOpenDialog(opts).then((res) => {
      if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths[0]) {
        return "";
      }
      return String(res.filePaths[0]).trim();
    });
  } catch (_) {
    return null;
  }
}

function createLocalAnimeFolder(settings, info) {
  const fs = tryRequireNode("fs");
  const path = tryRequireNode("path");
  if (!fs || !isDesktopNodeAvailable()) {
    return "无";
  }
  const root = String(settings?.localAnimeRoot || "").trim();
  if (!root) {
    return "无";
  }
  const folderName = noteManager.getSafeFileName(info.CN || info.JP || info.fileName);
  const year = String(info.year || "").trim();
  const season = String(info.season || "").trim();
  const hasSeason = /^\d{4}$/.test(year) && season && season !== "未知季度" && season !== "未知";
  const folderPath = path
    ? hasSeason
      ? path.join(root, year, season, folderName)
      : /^\d{4}$/.test(year)
      ? path.join(root, year, folderName)
      : path.join(root, folderName)
    : hasSeason
    ? joinPosixPath(root, year, season, folderName)
    : /^\d{4}$/.test(year)
    ? joinPosixPath(root, year, folderName)
    : joinPosixPath(root, folderName);
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath.replace(/\\/g, "/");
}

function buildCustomLocalFolderPreview(settings, info) {
  const root = String(settings?.localAnimeRoot || "").trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  const folderName = noteManager.getSafeFileName(info.CN || info.JP || "未命名作品");
  const year = String(info.year || "").trim();
  const season = String(info.season || "").trim();
  const hasSeason = /^\d{4}$/.test(year) && season && season !== "未知季度" && season !== "未知";
  if (hasSeason) return `${root}/${year}/${season}/${folderName}`;
  if (/^\d{4}$/.test(year)) return `${root}/${year}/${folderName}`;
  return `${root}/${folderName}`;
}

/**
 * 同步更新已有动画笔记的元信息（完整保留 `# 观片手记与评价` 及用户自定义正文）
 */
function applyMetadataEditsToNoteContent(rawContent, patch = {}) {
  let content = String(rawContent || "");
  const parsed = noteUtils.parseFrontmatter(content);
  if (!parsed) return content;

  const setFm = (key, val) => {
    content = noteUtils.updateFrontmatterField(content, key, val);
  };

  if (patch.CN !== undefined) {
    setFm("中文名", patch.CN);
    content = noteUtils.updateCalloutTableRow(content, "中文名", patch.CN || "未知");
    // 更新 bookinfo 标题行
    content = content.replace(
      /^(>\s*\[!bookinfo[^\]]*\][+-]?\s*\*\*)[^*\r\n]+(\*\*)/m,
      (_, p1, p2) => `${p1}${patch.CN || "未知作品"}${p2}`
    );
  }
  if (patch.JP !== undefined) {
    setFm("日文名", patch.JP);
    content = noteUtils.updateCalloutTableRow(content, "日文名", patch.JP || "未知");
  }
  if (patch.cover !== undefined) {
    const cleanCov = String(patch.cover || "").trim();
    setFm("cover", cleanCov);
    const embedLine = cleanCov
      ? /^https?:\/\//i.test(cleanCov)
        ? `> ![${patch.CN || "封面"}](${cleanCov})`
        : `> ![[${cleanCov}]]`
      : "";
    const existingCoverRx = /^>\s*!(?:\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))\s*$/m;
    if (existingCoverRx.test(content)) {
      content = embedLine
        ? content.replace(existingCoverRx, () => embedLine)
        : content.replace(/^>\s*!(?:\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))\r?\n/m, "");
    } else if (embedLine) {
      content = content.replace(
        /^(>\s*\[!bookinfo[^\r\n]*)$/m,
        (_, h) => `${h}\n${embedLine}`
      );
    }
  }
  if (patch.mediaFormat !== undefined) {
    setFm("载体类型", patch.mediaFormat);
  }
  if (patch.catego !== undefined) {
    setFm("改编类型", patch.catego);
    content = noteUtils.updateCalloutTableRow(content, "改编类型", patch.catego || "未知");
  }
  if (patch.episode !== undefined) {
    const epStr = patch.episode === "" ? "" : String(patch.episode);
    setFm("总集数", epStr);
    const epNum = Number(epStr);
    const typePrefix = String(patch.mediaFormat || "").trim();
    const epCell =
      Number.isFinite(epNum) && epNum > 0
        ? [typePrefix, `共 ${epNum} 话`].filter(Boolean).join(" ")
        : typePrefix
        ? `${typePrefix} 集数待定`
        : "共 0 话";
    content = noteUtils.updateCalloutTableRow(content, "动画集数", epCell);
  }
  if (patch.state !== undefined) {
    setFm("观看状态", patch.state);
    content = noteUtils.updateCalloutTableRow(content, "观看状态", patch.state);
  }
  if (patch.watchedEpisodes !== undefined) {
    const wNum = Math.max(0, Number(patch.watchedEpisodes) || 0);
    content = noteUtils.updateWatchedEpisodes(content, wNum);
    const pMid = noteUtils.parseFrontmatter(content);
    if (pMid && pMid.fields && "已观看集数" in pMid.fields) {
      setFm("已观看集数", String(wNum));
    }
  }
  if (patch.AnimeMake !== undefined) {
    setFm("制作公司", patch.AnimeMake);
    content = noteUtils.updateCalloutTableRow(content, "制作公司", patch.AnimeMake || "未知");
  }
  if (patch.director !== undefined) {
    setFm("监督", patch.director);
    content = noteUtils.updateCalloutTableRow(content, "制作监督", patch.director || "未知");
    content = noteUtils.updateCalloutTableRow(content, "监督", patch.director || "未知");
  }
  if (patch.music !== undefined) {
    setFm("音乐", patch.music);
    content = noteUtils.updateCalloutTableRow(content, "音乐", patch.music || "未知");
  }
  if (patch.date !== undefined) {
    if (patch.date) {
      setFm("开播日期", patch.date);
    } else {
      const pMid = noteUtils.parseFrontmatter(content);
      if (pMid && pMid.fields && "开播日期" in pMid.fields) {
        setFm("开播日期", "");
      }
    }
    content = noteUtils.updateCalloutTableRow(content, "开播日期", patch.date || patch.year || "未知");
  }
  if (patch.year !== undefined) {
    setFm("开播年份", patch.year);
  }
  if (patch.season !== undefined) {
    setFm("开播季度", patch.season);
  }
  if (patch.personalScore !== undefined) {
    const scoreStr =
      patch.personalScore === null || patch.personalScore === ""
        ? "未评分"
        : String(patch.personalScore);
    setFm("我的评分", scoreStr);
    content = noteUtils.updateCalloutTableRow(content, "我的评分", scoreStr);
  }
  if (patch.referenceScore !== undefined) {
    const refStr =
      patch.referenceScore === null || patch.referenceScore === ""
        ? ""
        : String(patch.referenceScore);
    const pMid = noteUtils.parseFrontmatter(content);
    if (refStr || (pMid && pMid.fields && "参考评分" in pMid.fields)) {
      setFm("参考评分", refStr);
    }
    if (patch.referenceScoreSource !== undefined) {
      const srcStr = String(patch.referenceScoreSource || "").trim();
      if (srcStr || (pMid && pMid.fields && "参考评分来源" in pMid.fields)) {
        setFm("参考评分来源", srcStr);
      }
    }
    if (refStr) {
      const displayRef = patch.referenceScoreSource ? `${patch.referenceScoreSource} ${refStr}` : refStr;
      content = noteUtils.updateCalloutTableRow(content, "参考评分", displayRef);
    }
  }
  if (patch.watchUrl !== undefined) {
    const cleanW = String(patch.watchUrl || "").trim();
    const watchLineRx = /^(\*\*观看网址\s*[：:]?\s*\*\*\s*[：:]?).*$/m;
    if (watchLineRx.test(content)) {
      content = content.replace(watchLineRx, () => `**观看网址**： ${cleanW}`);
    } else if (cleanW) {
      const folderRx = /^(\*\*本地文件夹[^\r\n]*)$/m;
      if (folderRx.test(content)) {
        content = content.replace(folderRx, (_, fl) => `${fl}\n**观看网址**： ${cleanW}`);
      }
    }
  }
  if (patch.bgmUrl !== undefined) {
    const cleanBgm = String(patch.bgmUrl || "").trim();
    const sid = bangumiApi.getSubjectId(cleanBgm);
    if (sid) {
      const normUrl = `https://bgm.tv/subject/${sid}`;
      setFm("BGM链接", normUrl);
      setFm("Netaba链接", `https://netaba.re/subject/${sid}`);
      const pMid = noteUtils.parseFrontmatter(content);
      if (pMid && pMid.fields && pMid.fields["数据来源"] === "自定义") {
        setFm("数据来源", "Bangumi");
      }
      content = noteUtils.updateCalloutTableRow(
        content,
        "BGM 地址",
        `[${patch.CN || "链接"}](${normUrl})`
      );
    } else if (patch.isCustom) {
      const pMid = noteUtils.parseFrontmatter(content);
      if (pMid && pMid.fields && "BGM链接" in pMid.fields) {
        setFm("BGM链接", "");
      }
      setFm("数据来源", "自定义");
    }
  }
  if (patch.referenceUrl !== undefined) {
    const cleanRef = String(patch.referenceUrl || "").trim();
    const pMid = noteUtils.parseFrontmatter(content);
    if (cleanRef || (pMid && pMid.fields && "参考链接" in pMid.fields)) {
      setFm("参考链接", cleanRef);
    }
    if (/^https?:\/\//i.test(cleanRef)) {
      content = noteUtils.updateCalloutTableRow(content, "参考链接", `[查看外部条目](${cleanRef})`);
    }
  }
  if (patch.downloadPath !== undefined) {
    const dlStr = String(patch.downloadPath || "无").trim() || "无";
    setFm("下载路径", dlStr);
    content = noteUtils.updateFolderLine(content, {
      downloadPath: dlStr !== "无" ? dlStr : "",
      error: null
    });
  }
  if (patch.tags !== undefined) {
    setFm("tags", patch.tags);
  }

  return noteUtils.syncNoteCalloutFromFrontmatter(content);
}

const MODAL_CSS = String.raw`
.modal.bm-custom-anime-modal-container {
  width: min(880px, 94vw) !important;
  max-width: 94vw !important;
  max-height: min(90vh, 860px) !important;
  padding: 0 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  border-radius: 18px !important;
  border: 1px solid var(--bm7-line, var(--background-modifier-border)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-ink, var(--text-normal)) !important;
  box-shadow: 0 24px 64px -18px rgb(0 0 0 / 0.36) !important;
}
.modal.bm-custom-anime-modal-container .modal-close-button {
  top: 14px;
  right: 14px;
  z-index: 6;
  color: var(--bm7-ink-2, var(--text-muted));
}
.modal-content.bm-custom-anime-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: min(90vh, 860px);
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden;
  min-width: 0;
}
.bm-ca-shell {
  --ca-bg: var(--bm7-surface, var(--background-primary));
  --ca-panel: var(--bm7-panel-bg, var(--background-secondary));
  --ca-line: var(--bm7-line, var(--background-modifier-border));
  --ca-ink: var(--bm7-ink, var(--text-normal));
  --ca-ink-2: var(--bm7-ink-2, var(--text-muted));
  --ca-ink-3: var(--bm7-ink-3, var(--text-faint));
  --ca-accent: var(--bm7-accent, var(--interactive-accent));
  --ca-accent-ink: var(--bm7-accent-ink, var(--text-on-accent));
  --ca-seg-bg: var(--bm7-seg-bg, color-mix(in srgb, var(--text-normal) 6%, transparent));
  --ca-seg-active: var(--bm7-seg-active-bg, var(--background-primary));
  --ca-seg-shadow: var(--bm7-seg-active-shadow, 0 1px 4px rgb(0 0 0 / 0.14));
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  color: var(--ca-ink);
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
}
.bm-ca-shell *, .bm-ca-shell *::before, .bm-ca-shell *::after {
  box-sizing: border-box;
}
.bm-ca-shell button.bm-ca-btn,
.bm-ca-shell button.bm-ca-seg-btn,
.bm-ca-shell button.bm-ca-chip,
.bm-ca-shell button.bm-ca-score-btn {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  font: inherit;
  line-height: 1.25;
  cursor: pointer;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  height: auto !important;
  color: var(--ca-ink);
}
.bm-ca-head {
  flex: 0 0 auto;
  padding: 18px 48px 14px 22px;
  border-bottom: 1px solid var(--ca-line);
  background: color-mix(in srgb, var(--ca-panel) 62%, var(--ca-bg));
}
.bm-ca-head-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bm-ca-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0.01em;
}
.bm-ca-mode-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  color: var(--ca-accent);
  background: color-mix(in srgb, var(--ca-accent) 13%, transparent);
}
.bm-ca-sub {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--ca-ink-2);
}
.bm-ca-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 22px 22px;
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
/* 左栏：实时海报预览 + 封面上传 */
.bm-ca-left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  position: sticky;
  top: 0;
}
.bm-ca-poster-drop {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 13px;
  overflow: hidden;
  border: 1.5px dashed color-mix(in srgb, var(--ca-ink) 18%, transparent);
  background: var(--ca-panel);
  box-shadow: 0 12px 28px -14px rgb(0 0 0 / 0.34);
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}
.bm-ca-poster-drop.has-cover {
  border-style: solid;
  border-color: var(--ca-line);
}
.bm-ca-poster-drop.is-dragover {
  border-color: var(--ca-accent);
  border-style: solid;
  transform: scale(1.015);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ca-accent) 24%, transparent);
}
.bm-ca-poster-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.bm-ca-poster-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 14px;
  text-align: center;
  color: #fff;
  background: linear-gradient(155deg, hsl(var(--ca-hue, 210) 44% 48%), hsl(calc(var(--ca-hue, 210) + 28) 42% 30%));
}
.bm-ca-poster-mono {
  font-size: 46px;
  font-weight: 800;
  line-height: 1;
  opacity: 0.92;
  text-shadow: 0 4px 16px rgb(0 0 0 / 0.28);
}
.bm-ca-poster-name {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
}
.bm-ca-poster-hint {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.85;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.24);
}
.bm-ca-poster-top-badges {
  position: absolute;
  top: 9px;
  left: 9px;
  right: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  pointer-events: none;
  z-index: 2;
}
.bm-ca-pbadge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: rgb(14 18 28 / 0.72);
  backdrop-filter: blur(6px);
  white-space: nowrap;
}
.bm-ca-pbadge.is-score {
  background: color-mix(in srgb, var(--ca-accent) 88%, #000);
}
.bm-ca-poster-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 22px 10px 9px;
  background: linear-gradient(to top, rgb(10 12 18 / 0.84), rgb(10 12 18 / 0.35) 60%, transparent);
  color: #fff;
  pointer-events: none;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
}
.bm-ca-poster-bottom span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm-ca-cover-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.bm-ca-shell button.bm-ca-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 32px;
  padding: 6px 11px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 650;
  background: var(--ca-seg-bg) !important;
  color: var(--ca-ink);
  transition: background 0.15s ease, transform 0.12s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.bm-ca-shell button.bm-ca-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ca-ink) 11%, transparent) !important;
}
.bm-ca-shell button.bm-ca-btn:active:not(:disabled) {
  transform: translateY(1px);
}
.bm-ca-shell button.bm-ca-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.bm-ca-shell button.bm-ca-btn.is-primary {
  background: var(--ca-accent) !important;
  color: var(--ca-accent-ink) !important;
}
.bm-ca-shell button.bm-ca-btn.is-primary:hover:not(:disabled) {
  opacity: 0.92;
}
.bm-ca-shell button.bm-ca-btn.is-danger-subtle {
  color: var(--text-error, #d94c5a);
}
.bm-ca-cover-url-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px;
  border-radius: 10px;
  background: var(--ca-panel);
  border: 1px solid var(--ca-line);
}
.bm-ca-cover-url-actions {
  display: flex;
  gap: 6px;
}
.bm-ca-cover-url-actions button {
  flex: 1 1 0;
}
.bm-ca-cover-tip {
  font-size: 12px;
  color: var(--ca-ink-3);
  line-height: 1.45;
}
.bm-ca-path-card {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--ca-panel);
  border: 1px solid var(--ca-line);
  font-size: 12px;
  color: var(--ca-ink-2);
  overflow-wrap: anywhere;
  line-height: 1.45;
}
.bm-ca-path-card strong {
  display: block;
  margin-bottom: 2px;
  color: var(--ca-ink);
  font-weight: 700;
}
.bm-ca-path-warn {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, #d97706 13%, transparent);
  color: var(--ca-ink);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
/* 右栏：分组表单 */
.bm-ca-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.bm-ca-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 15px;
  border-radius: 13px;
  background: var(--ca-panel);
  border: 1px solid var(--ca-line);
  min-width: 0;
}
.bm-ca-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.bm-ca-sec-title {
  margin: 0;
  font-size: 14px;
  font-weight: 750;
  color: var(--ca-ink);
}
.bm-ca-sec-desc {
  font-size: 12px;
  color: var(--ca-ink-3);
}
.bm-ca-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
  min-width: 0;
}
.bm-ca-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 12px;
  min-width: 0;
}
.bm-ca-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.bm-ca-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  min-height: 24px;
}
.bm-ca-label {
  display: flex;
  align-items: center;
  min-height: 24px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ca-ink-2);
}
.bm-ca-label .is-req {
  color: var(--text-error, #d94c5a);
  margin-left: 2px;
}
.bm-ca-shell input[type="text"],
.bm-ca-shell input[type="number"],
.bm-ca-shell input[type="url"],
.bm-ca-shell select,
.bm-ca-shell textarea {
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--ca-line);
  background: var(--ca-bg);
  color: var(--ca-ink);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.bm-ca-shell input[type="text"],
.bm-ca-shell input[type="number"],
.bm-ca-shell input[type="url"],
.bm-ca-shell select {
  height: 34px;
}
.bm-ca-shell textarea {
  min-height: 70px;
  resize: vertical;
  font-family: inherit;
}
.bm-ca-shell input:focus,
.bm-ca-shell select:focus,
.bm-ca-shell textarea:focus {
  outline: none;
  border-color: var(--ca-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ca-accent) 18%, transparent);
}
.bm-ca-seg {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: var(--ca-seg-bg);
  min-width: 0;
}
.bm-ca-shell button.bm-ca-seg-btn {
  flex: 1 1 0;
  min-width: 54px;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ca-ink-2);
  text-align: center;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.bm-ca-shell button.bm-ca-seg-btn:hover {
  color: var(--ca-ink);
}
.bm-ca-shell button.bm-ca-seg-btn.is-on {
  background: var(--ca-seg-active) !important;
  color: var(--ca-ink) !important;
  box-shadow: var(--ca-seg-shadow) !important;
}
.bm-ca-score-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.bm-ca-shell button.bm-ca-score-btn {
  min-width: 28px;
  min-height: 26px;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--ca-ink-2);
  background: var(--ca-seg-bg) !important;
  transition: background 0.14s ease, color 0.14s ease;
}
.bm-ca-shell button.bm-ca-score-btn:hover {
  color: var(--ca-ink);
  background: color-mix(in srgb, var(--ca-ink) 11%, transparent) !important;
}
.bm-ca-shell button.bm-ca-score-btn.is-on {
  background: var(--ca-accent) !important;
  color: var(--ca-accent-ink) !important;
}
.bm-ca-tags-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.bm-ca-shell button.bm-ca-chip {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ca-ink-2);
  background: var(--ca-seg-bg) !important;
  transition: background 0.14s ease, color 0.14s ease;
}
.bm-ca-shell button.bm-ca-chip:hover {
  color: var(--ca-ink);
}
.bm-ca-shell button.bm-ca-chip.is-on {
  background: color-mix(in srgb, var(--ca-accent) 16%, transparent) !important;
  color: var(--ca-accent) !important;
}
.bm-ca-inline-link-btn {
  font-size: 12px !important;
  padding: 2px 7px !important;
  min-height: 24px !important;
  border-radius: 6px !important;
}
.bm-ca-local-row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.bm-ca-local-row input {
  flex: 1 1 auto;
}
.bm-ca-hint {
  font-size: 12px;
  color: var(--ca-ink-3);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.bm-ca-hint.is-ok {
  color: var(--bm7-ok, #22a06b);
}
.bm-ca-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 22px;
  border-top: 1px solid var(--ca-line);
  background: color-mix(in srgb, var(--ca-panel) 72%, var(--ca-bg));
}
.bm-ca-foot-note {
  font-size: 12px;
  color: var(--ca-ink-3);
  min-width: 0;
}
.bm-ca-foot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.bm-ca-foot-actions button.bm-ca-btn {
  min-height: 35px;
  padding: 7px 16px;
}
@media (max-width: 720px) {
  .modal.bm-custom-anime-modal-container {
    width: 96vw !important;
    max-width: 96vw !important;
    max-height: 92vh !important;
    border-radius: 14px !important;
  }
  .bm-ca-head {
    padding: 14px 40px 12px 15px;
  }
  .bm-ca-body {
    grid-template-columns: minmax(0, 1fr);
    padding: 14px 15px 18px;
    gap: 14px;
  }
  .bm-ca-left {
    position: static;
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 10px 12px;
    align-items: start;
  }
  .bm-ca-poster-drop {
    grid-row: 1 / span 2;
  }
  .bm-ca-poster-fallback {
    padding: 28px 8px 26px;
  }
  .bm-ca-poster-mono {
    font-size: 32px;
  }
  .bm-ca-poster-name,
  .bm-ca-poster-hint {
    display: none;
  }
  .bm-ca-poster-top-badges {
    top: 6px;
    left: 6px;
    right: 6px;
    gap: 4px;
  }
  .bm-ca-pbadge {
    padding: 1px 6px;
    font-size: 12px;
  }
  .bm-ca-poster-bottom {
    padding: 14px 7px 6px;
    font-size: 12px;
  }
  .bm-ca-cover-url-box,
  .bm-ca-path-card {
    grid-column: 1 / -1;
  }
  .bm-ca-grid-2,
  .bm-ca-grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
  .bm-ca-foot {
    padding: 10px 15px;
  }
  .bm-ca-foot-note {
    display: none;
  }
  .bm-ca-foot-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
`;

function ensureCustomAnimeModalStyles(targetDoc = document) {
  if (!targetDoc || !targetDoc.head) return;
  let el = targetDoc.getElementById(CUSTOM_ANIME_STYLE_ID);
  if (!el) {
    el = targetDoc.createElement("style");
    el.id = CUSTOM_ANIME_STYLE_ID;
    targetDoc.head.appendChild(el);
  }
  if (el.textContent !== MODAL_CSS) {
    el.textContent = MODAL_CSS;
  }
}

class CustomAnimeModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.options = options || {};
    this.editItem = options.editItem || null;
    this.isEditMode = Boolean(this.editItem && this.editItem.file);
    this.onCompleted = typeof options.onCompleted === "function" ? options.onCompleted : null;
    this._previewObjectUrl = "";
    this._pasteHandler = null;
    this._pendingCoverBuffer = null;
    this._pendingCoverExt = "";
    this._pendingCoverFileName = "";
    this._isSaving = false;

    const initialName = String(options.initialName || options.initialQuery || "").trim();
    this.form = {
      CN: this.isEditMode ? stripPlaceholderMeta(this.editItem.name) : initialName,
      JP: this.isEditMode ? stripPlaceholderMeta(this.editItem.japaneseName) : "",
      state: this.isEditMode && WATCH_STATES.includes(this.editItem.state) ? this.editItem.state : "在看",
      episode: this.isEditMode ? stripPlaceholderMeta(this.editItem.totalEpisodes) : "",
      watchedEpisodes: this.isEditMode ? String(Number(this.editItem.watchedEpisodes) || 0) : "0",
      personalScore:
        this.isEditMode && this.editItem.personalScore !== null && this.editItem.personalScore !== undefined
          ? String(this.editItem.personalScore)
          : "",
      date: this.isEditMode ? stripPlaceholderMeta(this.editItem.airDate) : "",
      year: this.isEditMode ? stripPlaceholderMeta(this.editItem.year) : "",
      seasonMode: "__auto__",
      mediaFormat: this.isEditMode ? stripPlaceholderMeta(this.editItem.mediaFormat) || "OVA" : "OVA",
      catego: this.isEditMode ? stripPlaceholderMeta(this.editItem.animeType) : "",
      AnimeMake: this.isEditMode ? stripPlaceholderMeta(this.editItem.studio) : "",
      director: this.isEditMode ? stripPlaceholderMeta(this.editItem.director) : "",
      music: this.isEditMode ? stripPlaceholderMeta(this.editItem.music) : "",
      tagsText: this.isEditMode ? splitUserTags(this.editItem.tags).join(", ") : "",
      referenceScore:
        this.isEditMode && this.editItem.referenceScore !== null && this.editItem.referenceScore !== undefined
          ? String(this.editItem.referenceScore)
          : "",
      referenceScoreSource: this.isEditMode ? stripPlaceholderMeta(this.editItem.referenceScoreSource) : "",
      watchUrl: this.isEditMode ? stripPlaceholderMeta(this.editItem.watchUrl) : "",
      externalLink: this.isEditMode
        ? stripPlaceholderMeta(this.editItem.bgmUrl) || stripPlaceholderMeta(this.editItem.referenceUrl)
        : "",
      coverValue: this.isEditMode ? stripPlaceholderMeta(this.editItem.cover) : "",
      coverUrlDraft: "",
      coverUrlOpen: false,
      localFolderMode: "none", // none | auto | custom
      customDownloadPath:
        this.isEditMode && this.editItem.downloadPath && this.editItem.downloadPath !== "无"
          ? String(this.editItem.downloadPath).trim()
          : "",
      summary: ""
    };

    if (this.isEditMode) {
      const curSeason = stripPlaceholderMeta(this.editItem.season);
      if (["01月新番", "04月新番", "07月新番", "10月新番"].includes(curSeason)) {
        this.form.seasonMode = curSeason;
      } else if (curSeason === "") {
        this.form.seasonMode = this.form.date ? "__auto__" : "__none__";
      }
      if (this.form.customDownloadPath) {
        this.form.localFolderMode = "custom";
      }
    }
  }

  async hydrateEditFieldsFromNote() {
    if (!this.isEditMode || !this.editItem?.file) return;
    try {
      const raw = await this.app.vault.read(this.editItem.file);
      const parsed = noteUtils.parseFrontmatter(raw);
      if (!parsed || !parsed.fields) return;
      const f = parsed.fields;
      const getF = (k) => stripPlaceholderMeta(noteUtils.cleanValue(f[k]));
      if (getF("中文名")) this.form.CN = getF("中文名");
      if (getF("日文名")) this.form.JP = getF("日文名");
      if (getF("cover")) this.form.coverValue = getF("cover");
      if (getF("载体类型")) this.form.mediaFormat = getF("载体类型");
      else {
        const epRow = raw.match(/^\|\s*动画集数\s*\|\s*([A-Za-z\u4e00-\u9fa5]+)/m);
        if (epRow && MEDIA_FORMATS.includes(epRow[1])) this.form.mediaFormat = epRow[1];
      }
      if (getF("改编类型")) this.form.catego = getF("改编类型");
      if (getF("总集数")) this.form.episode = getF("总集数");
      const st = getF("观看状态");
      if (WATCH_STATES.includes(st)) this.form.state = st;
      this.form.watchedEpisodes = String(noteUtils.extractWatchedEpisodes(raw));
      if (getF("制作公司")) this.form.AnimeMake = getF("制作公司");
      if (getF("监督")) this.form.director = getF("监督");
      if (getF("音乐")) this.form.music = getF("音乐");
      const dateMatch = raw.match(/^\|\s*开播日期\s*\|\s*([^|\r\n]+?)\s*\|/m);
      const airDate = getF("开播日期") || (dateMatch ? stripPlaceholderMeta(noteUtils.cleanValue(dateMatch[1])) : "");
      if (airDate) this.form.date = airDate;
      if (getF("开播年份")) this.form.year = getF("开播年份");
      const seasonVal = getF("开播季度");
      if (["01月新番", "04月新番", "07月新番", "10月新番"].includes(seasonVal)) {
        this.form.seasonMode = seasonVal;
      } else {
        this.form.seasonMode = "__none__";
      }
      const mySc = noteUtils.cleanValue(f["我的评分"]);
      if (mySc && mySc !== "未评分" && mySc !== "未知") this.form.personalScore = mySc;
      const refSc = getF("参考评分");
      if (refSc) this.form.referenceScore = refSc;
      const refSrc = getF("参考评分来源");
      if (refSrc) this.form.referenceScoreSource = refSrc;
      const wUrl = noteUtils.extractWatchUrlFromContent(raw, f);
      if (wUrl) this.form.watchUrl = wUrl;
      const bgmUrl = getF("BGM链接");
      const refUrl = getF("参考链接");
      this.form.externalLink = bgmUrl || refUrl || "";
      const dl = getF("下载路径");
      if (dl) {
        this.form.customDownloadPath = dl;
        this.form.localFolderMode = "custom";
      }
      const tagsRaw = noteUtils.cleanValue(f.tags || "");
      this.form.tagsText = splitUserTags(tagsRaw).join(", ");
    } catch (_) {}
  }

  getResolvedYearAndSeason() {
    const inferred = noteManager.getSeasonInfo(this.form.date);
    const manualYear = String(this.form.year || "").trim();
    const year = /^\d{4}$/.test(manualYear) ? manualYear : inferred.year || "";
    let season = "";
    if (this.form.seasonMode === "__none__") {
      season = "";
    } else if (this.form.seasonMode === "__auto__") {
      season = inferred.season && inferred.season !== "未知季度" ? inferred.season : "";
    } else {
      season = this.form.seasonMode;
    }
    return { year, season };
  }

  revokeTempObjectUrl() {
    if (this._previewObjectUrl) {
      try {
        URL.revokeObjectURL(this._previewObjectUrl);
      } catch (_) {}
      this._previewObjectUrl = "";
    }
  }

  getPreviewCoverUrl() {
    if (this._previewObjectUrl) return this._previewObjectUrl;
    const raw = String(this.form.coverValue || "").trim();
    if (!raw) return "";
    if (/^(?:https?:|data:|blob:|app:)/i.test(raw)) return raw;
    if (typeof this.plugin?.getCoverResourceUrl === "function") {
      return this.plugin.getCoverResourceUrl(raw, this.editItem?.file?.path || "");
    }
    return raw;
  }

  async acceptLocalImageFile(fileObj) {
    if (!fileObj || typeof fileObj.arrayBuffer !== "function") return;
    if (fileObj.type && !fileObj.type.startsWith("image/")) {
      new Notice("请选择图片文件（PNG / JPG / WebP / GIF）", 3500);
      return;
    }
    const buf = await fileObj.arrayBuffer();
    if (!buf || buf.byteLength < 64) {
      new Notice("读取到的图片为空，请换一张重试", 3500);
      return;
    }
    this.revokeTempObjectUrl();
    const blob = new Blob([buf], { type: fileObj.type || "image/png" });
    this._previewObjectUrl = URL.createObjectURL(blob);
    this._pendingCoverBuffer = buf;
    this._pendingCoverExt = fileObj.type || (fileObj.name || "").split(".").pop() || "png";
    this._pendingCoverFileName = fileObj.name || "pasted-cover.png";
    this.form.coverValue = `[待保存] ${this._pendingCoverFileName}`;
    this.updateLivePreview();
    new Notice(`已载入封面预览（保存时将自动存入 ${this.plugin.settings.coverFolder || "附件/动画封面"}）`, 3200);
  }

  async onOpen() {
    if (this.isEditMode) {
      await this.hydrateEditFieldsFromNote();
    }
    const ownerDoc = this.modalEl?.ownerDocument || document;
    ensureCustomAnimeModalStyles(ownerDoc);
    if (typeof this.plugin?.ensureScoreDashboardStyles === "function") {
      this.plugin.ensureScoreDashboardStyles();
    }

    const appearance = normalizeAppearance(this.plugin?.settings?.archiveAppearance);
    const domRoot = ownerDoc.querySelector(".bm7-root") || document.querySelector(".bm7-root");
    const activeTheme = (domRoot && domRoot.getAttribute("data-bm7-theme")) || appearance.theme || "follow";
    const activeMotion = (domRoot && domRoot.getAttribute("data-bm7-motion")) || (appearance.motion ? "on" : "off");

    this.modalEl.classList.add("bm-custom-anime-modal-container", "bm7-root");
    this.modalEl.setAttribute("data-bm7-theme", activeTheme);
    this.modalEl.setAttribute("data-bm7-motion", activeMotion);
    this.contentEl.classList.add("bm-custom-anime-content");
    this.contentEl.empty();

    const shell = this.contentEl.createDiv("bm-ca-shell bm7-root");
    shell.setAttribute("data-bm7-theme", activeTheme);
    shell.setAttribute("data-bm7-motion", activeMotion);
    this.shell = shell;

    // 1. 顶部标题区
    const head = shell.createDiv("bm-ca-head");
    const headRow = head.createDiv("bm-ca-head-row");
    headRow.createEl("h2", {
      text: this.isEditMode ? `编辑动画资料 ·《${this.form.CN || "未命名"}》` : "新建自定义动画"
    });
    headRow.createSpan({
      cls: "bm-ca-mode-pill",
      text: this.isEditMode
        ? this.editItem.subjectId
          ? `已绑定 BGM #${this.editItem.subjectId}`
          : "自定义收录"
        : "无需 Bangumi 收录"
    });
    head.createEl("p", {
      cls: "bm-ca-sub",
      text: this.isEditMode
        ? "修改后的数值与封面将同步写入笔记属性与信息卡，原有「观片手记与评价」正文与截图保持不动。"
        : "用于收录 Bangumi 没有或搜不到的动画（如 OVA、短片、独立动画等）。只需填写动画名称即可建档，其余数值均可按需自定义。"
    });

    // 2. 双栏主体
    const body = shell.createDiv("bm-ca-body");
    const left = body.createDiv("bm-ca-left");
    const right = body.createDiv("bm-ca-right");

    // ---------- 左栏：封面实时预览 + 上传 + 路径预览 ----------
    const fileInput = left.createEl("input", {
      attr: { type: "file", accept: "image/*", style: "display:none" }
    });
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) {
        await this.acceptLocalImageFile(f);
        fileInput.value = "";
      }
    };

    const posterDrop = left.createDiv("bm-ca-poster-drop");
    posterDrop.title = "点击选择本地封面图片，或直接拖入 / Ctrl+V 粘贴图片";
    posterDrop.onclick = () => fileInput.click();
    posterDrop.addEventListener("dragover", (e) => {
      e.preventDefault();
      posterDrop.classList.add("is-dragover");
    });
    posterDrop.addEventListener("dragleave", () => {
      posterDrop.classList.remove("is-dragover");
    });
    posterDrop.addEventListener("drop", async (e) => {
      e.preventDefault();
      posterDrop.classList.remove("is-dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) await this.acceptLocalImageFile(f);
    });
    this.posterDropEl = posterDrop;

    const coverTools = left.createDiv("bm-ca-cover-tools");
    const pickImgBtn = coverTools.createEl("button", {
      cls: "bm-ca-btn",
      attr: { type: "button" }
    });
    v07Core.setBtnIconLabel(pickImgBtn, "image", "选择图片");
    pickImgBtn.onclick = () => fileInput.click();

    const urlToggleBtn = coverTools.createEl("button", {
      cls: "bm-ca-btn",
      attr: { type: "button" }
    });
    v07Core.setBtnIconLabel(urlToggleBtn, "link", "图片网址");

    const clearCoverBtn = left.createEl("button", {
      cls: "bm-ca-btn is-danger-subtle",
      attr: { type: "button" },
      text: "清除封面（改用色块占位）"
    });
    clearCoverBtn.onclick = () => {
      this.revokeTempObjectUrl();
      this._pendingCoverBuffer = null;
      this._pendingCoverExt = "";
      this._pendingCoverFileName = "";
      this.form.coverValue = "";
      this.updateLivePreview();
    };
    this.clearCoverBtn = clearCoverBtn;

    const urlBox = left.createDiv("bm-ca-cover-url-box");
    urlBox.style.display = "none";
    const urlInput = urlBox.createEl("input", {
      type: "url",
      placeholder: "粘贴 https://... 图片链接"
    });
    urlInput.value = /^https?:\/\//i.test(this.form.coverValue) ? this.form.coverValue : "";
    const urlActions = urlBox.createDiv("bm-ca-cover-url-actions");
    const applyUrlBtn = urlActions.createEl("button", {
      cls: "bm-ca-btn is-primary",
      attr: { type: "button" },
      text: "使用该图"
    });
    applyUrlBtn.onclick = () => {
      const u = urlInput.value.trim();
      if (!/^https?:\/\//i.test(u)) {
        new Notice("请输入以 http:// 或 https:// 开头的图片链接", 3200);
        return;
      }
      this.revokeTempObjectUrl();
      this._pendingCoverBuffer = null;
      this.form.coverValue = u;
      this.form.coverUrlOpen = false;
      urlBox.style.display = "none";
      this.updateLivePreview();
      new Notice("已载入网络封面（保存时将自动尝试缓存到本地封面目录）", 3000);
    };
    urlToggleBtn.onclick = () => {
      this.form.coverUrlOpen = !this.form.coverUrlOpen;
      urlBox.style.display = this.form.coverUrlOpen ? "flex" : "none";
      if (this.form.coverUrlOpen) urlInput.focus();
    };

    const coverTip = left.createDiv({
      cls: "bm-ca-cover-tip",
      text: isMobileEnv()
        ? "支持从手机相册选图或粘贴图片网址，留空也会自动生成封面。"
        : "支持点选图片、拖入或粘贴图片，留空也会自动生成封面。"
    });
    void coverTip;

    const pathCard = left.createDiv("bm-ca-path-card");
    this.pathCardEl = pathCard;

    // 剪贴板粘贴图片支持（仅当剪贴板含图片文件时接管，不影响文本框粘贴文字）
    this._pasteHandler = async (ev) => {
      const items = ev.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it && it.kind === "file" && it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            ev.preventDefault();
            await this.acceptLocalImageFile(f);
            return;
          }
        }
      }
    };
    ownerDoc.addEventListener("paste", this._pasteHandler);

    // ---------- 右栏区块 1：核心信息与数值 ----------
    const sec1 = right.createDiv("bm-ca-section");
    const sec1Head = sec1.createDiv("bm-ca-sec-head");
    sec1Head.createEl("h3", { cls: "bm-ca-sec-title", text: "核心信息与进度评分" });
    sec1Head.createSpan({ cls: "bm-ca-sec-desc", text: "仅动画名称必填，其余按需填写" });

    const nameGrid = sec1.createDiv("bm-ca-grid-2");
    const cnField = nameGrid.createDiv("bm-ca-field");
    const cnLab = cnField.createDiv("bm-ca-label");
    cnLab.appendText("动画名称（中文名 / 显示名）");
    cnLab.createSpan({ cls: "is-req", text: "*" });
    const cnInput = cnField.createEl("input", {
      type: "text",
      placeholder: "例如：初犬 The Animation"
    });
    cnInput.value = this.form.CN;
    cnInput.oninput = () => {
      this.form.CN = cnInput.value;
      this.updateLivePreview();
    };
    this.cnInputEl = cnInput;

    const jpField = nameGrid.createDiv("bm-ca-field");
    jpField.createDiv({ cls: "bm-ca-label", text: "原名 / 日文名（选填）" });
    const jpInput = jpField.createEl("input", {
      type: "text",
      placeholder: "便于跨站评分检索与搜索"
    });
    jpInput.value = this.form.JP;
    jpInput.oninput = () => {
      this.form.JP = jpInput.value;
    };

    // 观看状态分段条
    const stateField = sec1.createDiv("bm-ca-field");
    stateField.createDiv({ cls: "bm-ca-label", text: "观看状态" });
    const stateSeg = stateField.createDiv("bm-ca-seg");
    const stateBtns = [];
    const syncStateSeg = () => {
      stateBtns.forEach(({ val, btn }) => btn.classList.toggle("is-on", this.form.state === val));
    };
    for (const st of WATCH_STATES) {
      const btn = stateSeg.createEl("button", {
        cls: "bm-ca-seg-btn",
        attr: { type: "button" },
        text: st
      });
      btn.onclick = () => {
        this.form.state = st;
        syncStateSeg();
        this.updateLivePreview();
      };
      stateBtns.push({ val: st, btn });
    }
    syncStateSeg();

    // 总集数 / 已看集数 / 我的评分
    const numGrid = sec1.createDiv("bm-ca-grid-3");
    const epField = numGrid.createDiv("bm-ca-field");
    epField.createDiv({ cls: "bm-ca-label", text: "总集数" });
    const epInput = epField.createEl("input", {
      type: "number",
      attr: { min: "0", max: "9999", step: "1", placeholder: "如：2 或 12" }
    });
    epInput.value = this.form.episode;
    epInput.oninput = () => {
      this.form.episode = epInput.value;
      this.updateLivePreview();
    };

    const watchedField = numGrid.createDiv("bm-ca-field");
    const watchedRow = watchedField.createDiv("bm-ca-label-row");
    watchedRow.createSpan({ cls: "bm-ca-label", text: "已看集数" });
    const fillWatchedBtn = watchedRow.createEl("button", {
      cls: "bm-ca-btn bm-ca-inline-link-btn",
      attr: { type: "button", title: "将已看集数设为等于总集数" },
      text: "全看完"
    });
    const watchedInput = watchedField.createEl("input", {
      type: "number",
      attr: { min: "0", max: "9999", step: "1", placeholder: "0" }
    });
    watchedInput.value = this.form.watchedEpisodes;
    watchedInput.oninput = () => {
      this.form.watchedEpisodes = watchedInput.value;
      this.updateLivePreview();
    };
    fillWatchedBtn.onclick = () => {
      const tot = parseInt(epInput.value, 10);
      if (Number.isFinite(tot) && tot > 0) {
        watchedInput.value = String(tot);
        this.form.watchedEpisodes = String(tot);
        this.form.state = "已看";
        syncStateSeg();
        this.updateLivePreview();
      } else {
        new Notice("请先填写总集数", 2200);
      }
    };

    const scoreField = numGrid.createDiv("bm-ca-field");
    scoreField.createDiv({ cls: "bm-ca-label", text: "我的评分（0-10）" });
    const scoreInput = scoreField.createEl("input", {
      type: "number",
      attr: { min: "0", max: "10", step: "0.1", placeholder: "留空为未评分" }
    });
    scoreInput.value = this.form.personalScore;

    // 快捷评分条
    const scoreBar = sec1.createDiv("bm-ca-score-bar");
    const scoreQuickBtns = [];
    const syncScoreBtns = () => {
      const curNum = parseOptionalScore(this.form.personalScore);
      scoreQuickBtns.forEach(({ val, btn }) => {
        btn.classList.toggle("is-on", curNum !== null && Number.isFinite(curNum) && Math.abs(curNum - val) < 0.001);
      });
    };
    for (let s = 1; s <= 10; s++) {
      const btn = scoreBar.createEl("button", {
        cls: "bm-ca-score-btn",
        attr: { type: "button", title: `设为 ${s} 分` },
        text: String(s)
      });
      btn.onclick = () => {
        this.form.personalScore = String(s);
        scoreInput.value = String(s);
        syncScoreBtns();
        this.updateLivePreview();
      };
      scoreQuickBtns.push({ val: s, btn });
    }
    const clearScoreBtn = scoreBar.createEl("button", {
      cls: "bm-ca-score-btn",
      attr: { type: "button", title: "清空我的评分" },
      text: "清空"
    });
    clearScoreBtn.onclick = () => {
      this.form.personalScore = "";
      scoreInput.value = "";
      syncScoreBtns();
      this.updateLivePreview();
    };
    scoreInput.oninput = () => {
      this.form.personalScore = scoreInput.value;
      syncScoreBtns();
      this.updateLivePreview();
    };
    syncScoreBtns();

    // 开播日期 / 年份 / 季度
    const timeGrid = sec1.createDiv("bm-ca-grid-3");
    const dateField = timeGrid.createDiv("bm-ca-field");
    dateField.createDiv({ cls: "bm-ca-label", text: "开播 / 发售日期" });
    const dateInput = dateField.createEl("input", {
      type: "text",
      placeholder: "如 2007-04-27 或 2007"
    });
    dateInput.value = this.form.date;

    const yearField = timeGrid.createDiv("bm-ca-field");
    yearField.createDiv({ cls: "bm-ca-label", text: "年份（4 位数字）" });
    const yearInput = yearField.createEl("input", {
      type: "text",
      attr: { maxlength: "4", placeholder: "自动推算或手填" }
    });
    yearInput.value = this.form.year;

    const seasonField = timeGrid.createDiv("bm-ca-field");
    seasonField.createDiv({ cls: "bm-ca-label", text: "归属季度" });
    const seasonSelect = seasonField.createEl("select");
    for (const opt of SEASON_OPTIONS) {
      seasonSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    seasonSelect.value = this.form.seasonMode;

    dateInput.oninput = () => {
      this.form.date = dateInput.value.trim();
      const inf = noteManager.getSeasonInfo(this.form.date);
      if (inf.year) {
        this.form.year = inf.year;
        yearInput.value = inf.year;
      }
      this.updateLivePreview();
    };
    yearInput.oninput = () => {
      this.form.year = yearInput.value.trim();
      this.updateLivePreview();
    };
    seasonSelect.onchange = () => {
      this.form.seasonMode = seasonSelect.value;
      this.updateLivePreview();
    };

    // ---------- 右栏区块 2：载体、制作信息与标签 ----------
    const sec2 = right.createDiv("bm-ca-section");
    const sec2Head = sec2.createDiv("bm-ca-sec-head");
    sec2Head.createEl("h3", { cls: "bm-ca-sec-title", text: "作品档案与题材标签" });
    sec2Head.createSpan({ cls: "bm-ca-sec-desc", text: "参与全馆筛选、制作社排行与标签统计" });

    const fmtField = sec2.createDiv("bm-ca-field");
    fmtField.createDiv({ cls: "bm-ca-label", text: "载体类型" });
    const fmtSeg = fmtField.createDiv("bm-ca-seg");
    const fmtBtns = [];
    const syncFmtSeg = () => {
      fmtBtns.forEach(({ val, btn }) => btn.classList.toggle("is-on", this.form.mediaFormat === val));
    };
    for (const fmt of MEDIA_FORMATS) {
      const btn = fmtSeg.createEl("button", {
        cls: "bm-ca-seg-btn",
        attr: { type: "button" },
        text: fmt
      });
      btn.onclick = () => {
        this.form.mediaFormat = fmt;
        syncFmtSeg();
      };
      fmtBtns.push({ val: fmt, btn });
    }
    syncFmtSeg();

    const metaGrid2 = sec2.createDiv("bm-ca-grid-2");
    const categoField = metaGrid2.createDiv("bm-ca-field");
    categoField.createDiv({ cls: "bm-ca-label", text: "改编类型" });
    const categoInput = categoField.createEl("input", {
      type: "text",
      attr: { list: "bm-ca-catego-list", placeholder: "如：游戏改编 / 原创动画 / 漫画改编" }
    });
    categoInput.value = this.form.catego;
    categoInput.oninput = () => {
      this.form.catego = categoInput.value;
    };
    const dl = categoField.createEl("datalist", { attr: { id: "bm-ca-catego-list" } });
    for (const c of ADAPTATION_OPTIONS) dl.createEl("option", { value: c });

    const studioField = metaGrid2.createDiv("bm-ca-field");
    studioField.createDiv({ cls: "bm-ca-label", text: "制作公司 / 社团" });
    const studioInput = studioField.createEl("input", {
      type: "text",
      placeholder: "如：Pink Pineapple / 个人制作"
    });
    studioInput.value = this.form.AnimeMake;
    studioInput.oninput = () => {
      this.form.AnimeMake = studioInput.value;
    };

    const staffGrid = sec2.createDiv("bm-ca-grid-2");
    const dirField = staffGrid.createDiv("bm-ca-field");
    dirField.createDiv({ cls: "bm-ca-label", text: "监督 / 导演" });
    const dirInput = dirField.createEl("input", {
      type: "text",
      placeholder: "选填"
    });
    dirInput.value = this.form.director;
    dirInput.oninput = () => {
      this.form.director = dirInput.value;
    };

    const musicField = staffGrid.createDiv("bm-ca-field");
    musicField.createDiv({ cls: "bm-ca-label", text: "音乐" });
    const musicInput = musicField.createEl("input", {
      type: "text",
      placeholder: "选填"
    });
    musicInput.value = this.form.music;
    musicInput.oninput = () => {
      this.form.music = musicInput.value;
    };

    const tagsField = sec2.createDiv("bm-ca-field");
    tagsField.createDiv({ cls: "bm-ca-label", text: "自定义标签（逗号或空格分隔）" });
    const tagsInput = tagsField.createEl("input", {
      type: "text",
      placeholder: "如：OVA, 日常, 收藏（无需手填 bangumi，插件会自动维护）"
    });
    tagsInput.value = this.form.tagsText;
    const quickTagsWrap = tagsField.createDiv("bm-ca-tags-quick");
    const tagChipRefs = [];
    const syncTagChips = () => {
      const curSet = new Set(splitUserTags(this.form.tagsText));
      tagChipRefs.forEach(({ tg, btn }) => btn.classList.toggle("is-on", curSet.has(tg)));
    };
    for (const tg of QUICK_TAG_SUGGESTIONS) {
      const chip = quickTagsWrap.createEl("button", {
        cls: "bm-ca-chip",
        attr: { type: "button" },
        text: `#${tg}`
      });
      chip.onclick = () => {
        const list = splitUserTags(this.form.tagsText);
        const idx = list.indexOf(tg);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(tg);
        this.form.tagsText = list.join(", ");
        tagsInput.value = this.form.tagsText;
        syncTagChips();
      };
      tagChipRefs.push({ tg, btn: chip });
    }
    tagsInput.oninput = () => {
      this.form.tagsText = tagsInput.value;
      syncTagChips();
    };
    syncTagChips();

    // ---------- 右栏区块 3：参考评分、外链与本地视频目录 ----------
    const sec3 = right.createDiv("bm-ca-section");
    const sec3Head = sec3.createDiv("bm-ca-sec-head");
    sec3Head.createEl("h3", { cls: "bm-ca-sec-title", text: "外部参考评分、链接与本地目录" });
    sec3Head.createSpan({ cls: "bm-ca-sec-desc", text: "全部选填 · 与 Bangumi 同步完全隔离" });

    const refScoreGrid = sec3.createDiv("bm-ca-grid-2");
    const refScField = refScoreGrid.createDiv("bm-ca-field");
    refScField.createDiv({ cls: "bm-ca-label", text: "自定义参考评分（0-10，选填）" });
    const refScInput = refScField.createEl("input", {
      type: "number",
      attr: { min: "0", max: "10", step: "0.1", placeholder: "如：7.4（不会冒充 BGM 评分）" }
    });
    refScInput.value = this.form.referenceScore;
    refScInput.oninput = () => {
      this.form.referenceScore = refScInput.value;
      this.updateLivePreview();
    };

    const refSrcField = refScoreGrid.createDiv("bm-ca-field");
    refSrcField.createDiv({ cls: "bm-ca-label", text: "参考评分来源名（选填）" });
    const refSrcInput = refSrcField.createEl("input", {
      type: "text",
      placeholder: "如：MAL / VNDB / 豆瓣 / 参考"
    });
    refSrcInput.value = this.form.referenceScoreSource;
    refSrcInput.oninput = () => {
      this.form.referenceScoreSource = refSrcInput.value;
      this.updateLivePreview();
    };

    const linksGrid = sec3.createDiv("bm-ca-grid-2");
    const watchField = linksGrid.createDiv("bm-ca-field");
    watchField.createDiv({ cls: "bm-ca-label", text: "在线观看网址（选填）" });
    const watchInput = watchField.createEl("input", {
      type: "url",
      placeholder: "https://..."
    });
    watchInput.value = this.form.watchUrl;
    watchInput.oninput = () => {
      this.form.watchUrl = watchInput.value;
    };

    const extField = linksGrid.createDiv("bm-ca-field");
    extField.createDiv({ cls: "bm-ca-label", text: "外部参考链接 / 补绑 BGM 链接（选填）" });
    const extInput = extField.createEl("input", {
      type: "url",
      placeholder: "MAL / AniList / 官网，或日后粘贴 bgm.tv/subject/xxx"
    });
    extInput.value = this.form.externalLink;
    const extHint = extField.createDiv("bm-ca-hint");
    const syncExtHint = () => {
      const sid = bangumiApi.getSubjectId(this.form.externalLink);
      if (sid) {
        extHint.className = "bm-ca-hint is-ok";
        extHint.textContent = `已识别为 Bangumi 编号 #${sid}，保存后将升级为标准 Bangumi 绑定条目。`;
      } else {
        extHint.className = "bm-ca-hint";
        extHint.textContent = "留空或填非 Bangumi 网址时保持为自定义条目，不参与 BGM 自动评分覆盖。";
      }
    };
    extInput.oninput = () => {
      this.form.externalLink = extInput.value.trim();
      syncExtHint();
      this.updateLivePreview();
    };
    syncExtHint();

    // 桌面端本地视频目录
    if (isDesktopNodeAvailable()) {
      const localField = sec3.createDiv("bm-ca-field");
      localField.createDiv({ cls: "bm-ca-label", text: "本地视频文件夹（仅电脑端，选填）" });
      const configuredRoot = String(this.plugin.settings?.localAnimeRoot || "").trim();
      const localSeg = localField.createDiv("bm-ca-seg");
      const localModes = [
        { val: "none", label: "暂不设置" },
        ...(configuredRoot && !this.isEditMode ? [{ val: "auto", label: "按默认目录新建" }] : []),
        { val: "custom", label: "指定已有文件夹" }
      ];
      const localModeBtns = [];
      const customPathWrap = localField.createDiv("bm-ca-local-row");
      const customPathInput = customPathWrap.createEl("input", {
        type: "text",
        placeholder: "例如：D:/Anime/初犬 The Animation"
      });
      customPathInput.value = this.form.customDownloadPath;
      customPathInput.oninput = () => {
        this.form.customDownloadPath = customPathInput.value.trim();
        this.updateLocalHint();
      };
      const browseBtn = customPathWrap.createEl("button", {
        cls: "bm-ca-btn",
        attr: { type: "button" },
        text: "浏览选择…"
      });
      browseBtn.onclick = async () => {
        const picked = await pickLocalFolderViaElectron(this.form.customDownloadPath || configuredRoot);
        if (picked) {
          this.form.customDownloadPath = picked.replace(/\\/g, "/");
          customPathInput.value = this.form.customDownloadPath;
          this.updateLocalHint();
        } else if (picked === null) {
          new Notice("请直接将文件夹路径粘贴到左侧输入框，或建档后在「本地视频关联」中选择。", 4000);
        }
      };

      const localHint = localField.createDiv("bm-ca-hint");
      this.localHintEl = localHint;
      this.customPathWrapEl = customPathWrap;

      const syncLocalMode = () => {
        localModeBtns.forEach(({ val, btn }) => btn.classList.toggle("is-on", this.form.localFolderMode === val));
        customPathWrap.style.display = this.form.localFolderMode === "custom" ? "flex" : "none";
        this.updateLocalHint();
      };
      for (const m of localModes) {
        const btn = localSeg.createEl("button", {
          cls: "bm-ca-seg-btn",
          attr: { type: "button" },
          text: m.label
        });
        btn.onclick = () => {
          this.form.localFolderMode = m.val;
          syncLocalMode();
        };
        localModeBtns.push({ val: m.val, btn });
      }
      syncLocalMode();
    }

    if (!this.isEditMode) {
      const sumField = sec3.createDiv("bm-ca-field");
      sumField.createDiv({ cls: "bm-ca-label", text: "简介 / 初始备注（选填）" });
      const sumArea = sumField.createEl("textarea", {
        placeholder: "可记录简短背景、安利来源或第一印象，将写入笔记末尾「观片手记与评价」区域。"
      });
      sumArea.value = this.form.summary;
      sumArea.oninput = () => {
        this.form.summary = sumArea.value;
      };
    }

    // 3. 底部固定操作栏
    const foot = shell.createDiv("bm-ca-foot");
    foot.createDiv({
      cls: "bm-ca-foot-note",
      text: this.isEditMode
        ? "支持随时再次编辑，或右键卡片进入观片手札与本地视频关联。"
        : "建档后立即同步至追番台、全部番剧、评分对比与 3D 展厅，兼容本地视频关联。"
    });
    const footActions = foot.createDiv("bm-ca-foot-actions");
    const cancelBtn = footActions.createEl("button", {
      cls: "bm-ca-btn",
      attr: { type: "button" },
      text: "取消"
    });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footActions.createEl("button", {
      cls: "bm-ca-btn is-primary",
      attr: { type: "button" },
      text: this.isEditMode ? "保存修改" : "创建动画笔记"
    });
    saveBtn.onclick = () => this.handleSubmit(saveBtn);
    this.saveBtnEl = saveBtn;

    this.updateLivePreview();
    setTimeout(() => {
      if (cnInput && cnInput.isConnected) cnInput.focus();
    }, 40);
  }

  updateLocalHint() {
    if (!this.localHintEl) return;
    if (this.form.localFolderMode === "auto") {
      const { year, season } = this.getResolvedYearAndSeason();
      const preview = buildCustomLocalFolderPreview(this.plugin.settings, {
        CN: this.form.CN,
        JP: this.form.JP,
        year,
        season
      });
      this.localHintEl.textContent = preview
        ? `保存时将自动创建：${preview}`
        : "尚未在插件设置中配置「新下载默认保存目录」。";
    } else if (this.form.localFolderMode === "custom") {
      this.localHintEl.textContent = this.form.customDownloadPath
        ? `将原地绑定该目录（绝不移动或重命名原文件）。`
        : "选择已有文件夹后，可直接从追番台播放；也可以建档后再用「本地视频关联」精细按集绑定。";
    } else {
      this.localHintEl.textContent = "稍后可随时通过「本地视频关联」跨盘符绑定已有视频或单集文件。";
    }
  }

  updateLivePreview() {
    if (!this.posterDropEl) return;
    const drop = this.posterDropEl;
    drop.empty();

    const title = String(this.form.CN || "").trim() || "未命名动画";
    const coverUrl = this.getPreviewCoverUrl();
    drop.classList.toggle("has-cover", Boolean(coverUrl));

    if (coverUrl) {
      const img = drop.createEl("img", { cls: "bm-ca-poster-img", attr: { alt: title } });
      img.src = coverUrl;
      img.onerror = () => {
        img.remove();
        drop.classList.remove("has-cover");
        this.renderPosterFallback(drop, title);
      };
    } else {
      this.renderPosterFallback(drop, title);
    }

    const topBadges = drop.createDiv("bm-ca-poster-top-badges");
    topBadges.createSpan({ cls: "bm-ca-pbadge", text: this.form.state || "在看" });

    const pScore = parseOptionalScore(this.form.personalScore);
    const rScore = parseOptionalScore(this.form.referenceScore);
    let scoreBadgeText = "";
    if (pScore !== null && Number.isFinite(pScore)) {
      scoreBadgeText = `★ ${pScore.toFixed(1)}`;
    } else if (rScore !== null && Number.isFinite(rScore)) {
      const src = String(this.form.referenceScoreSource || "").trim() || "参考";
      scoreBadgeText = `${src} ${rScore.toFixed(1)}`;
    }
    if (scoreBadgeText) {
      topBadges.createSpan({ cls: "bm-ca-pbadge is-score", text: scoreBadgeText });
    }

    const watchedNum = Math.max(0, parseInt(this.form.watchedEpisodes, 10) || 0);
    const totalNum = parseInt(this.form.episode, 10);
    const epStr = Number.isFinite(totalNum) && totalNum > 0 ? `${watchedNum} / ${totalNum} 话` : `${watchedNum} 话`;
    const sid = bangumiApi.getSubjectId(this.form.externalLink);
    const bottom = drop.createDiv("bm-ca-poster-bottom");
    bottom.createSpan({ text: epStr });
    bottom.createSpan({ text: sid ? `BGM #${sid}` : "自建" });

    if (this.clearCoverBtn) {
      this.clearCoverBtn.style.display = coverUrl || this._pendingCoverBuffer ? "inline-flex" : "none";
    }

    // 更新笔记路径预览与重名检测
    if (this.pathCardEl) {
      this.pathCardEl.empty();
      const { year, season } = this.getResolvedYearAndSeason();
      if (this.isEditMode && this.editItem?.file) {
        this.pathCardEl.createEl("strong", { text: "当前笔记文件" });
        this.pathCardEl.appendText(this.editItem.file.path);
      } else {
        const resolved = noteManager.resolveAnimeNotePath(this.plugin.settings, {
          CN: title,
          JP: this.form.JP,
          year,
          season
        });
        this.pathCardEl.createEl("strong", { text: "预计生成笔记" });
        this.pathCardEl.appendText(resolved.filePath);
        const existing = this.app.vault.getAbstractFileByPath(resolved.filePath);
        if (existing) {
          const warn = this.pathCardEl.createDiv("bm-ca-path-warn");
          warn.createSpan({ text: "该路径下已有同名笔记，创建前请修改名称或直接打开原笔记。" });
          const openExistBtn = warn.createEl("button", {
            cls: "bm-ca-btn bm-ca-inline-link-btn",
            attr: { type: "button" },
            text: "打开已有笔记"
          });
          openExistBtn.onclick = async () => {
            this.close();
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(existing);
          };
        }
      }
    }

    this.updateLocalHint();
  }

  renderPosterFallback(container, title) {
    const hue = hashPosterHue(title);
    const fb = container.createDiv("bm-ca-poster-fallback");
    fb.style.setProperty("--ca-hue", String(hue));
    fb.createDiv({ cls: "bm-ca-poster-mono", text: title.slice(0, 1).toUpperCase() });
    fb.createDiv({ cls: "bm-ca-poster-name", text: title });
    fb.createDiv({ cls: "bm-ca-poster-hint", text: "点击或拖入封面（可选）" });
  }

  async resolveFinalCoverPath(titleHint) {
    const coverFolder = this.plugin.settings.coverFolder || "附件/动画封面";
    if (this._pendingCoverBuffer) {
      return await noteManager.saveCustomCoverFromBuffer(
        this.app,
        coverFolder,
        titleHint,
        this._pendingCoverExt || "png",
        this._pendingCoverBuffer
      );
    }
    const raw = String(this.form.coverValue || "").trim();
    if (!raw || raw.startsWith("[待保存]")) return "";
    if (/^https?:\/\//i.test(raw)) {
      try {
        return await noteManager.saveCustomCoverFromUrl(this.app, coverFolder, titleHint, raw);
      } catch (err) {
        console.warn("[Bangumi Manager] 自定义网络封面缓存失败，已保留原网址:", err);
        new Notice("封面图片未能下载到本地目录，已保留原网址继续保存。", 4000);
        return raw;
      }
    }
    return raw;
  }

  async handleSubmit(saveBtn) {
    if (this._isSaving) return;
    const cn = String(this.form.CN || "").trim();
    if (!cn) {
      new Notice("请先填写动画名称。", 3500);
      if (this.cnInputEl) this.cnInputEl.focus();
      return;
    }

    const totalEpParsed = parseOptionalInt(this.form.episode);
    if (Number.isNaN(totalEpParsed)) {
      new Notice("总集数请填写非负整数（或留空）。", 3500);
      return;
    }
    const watchedParsed = parseOptionalInt(this.form.watchedEpisodes);
    if (Number.isNaN(watchedParsed)) {
      new Notice("已看集数请填写非负整数。", 3500);
      return;
    }
    const personalScore = parseOptionalScore(this.form.personalScore);
    if (Number.isNaN(personalScore)) {
      new Notice("「我的评分」请填写 0 到 10 之间的数字（或留空）。", 3500);
      return;
    }
    const referenceScore = parseOptionalScore(this.form.referenceScore);
    if (Number.isNaN(referenceScore)) {
      new Notice("「自定义参考评分」请填写 0 到 10 之间的数字（或留空）。", 3500);
      return;
    }

    const { year, season } = this.getResolvedYearAndSeason();
    const extLink = String(this.form.externalLink || "").trim();
    const bgmSubjectId = bangumiApi.getSubjectId(extLink);
    const bgmUrl = bgmSubjectId ? `https://bgm.tv/subject/${bgmSubjectId}` : "";
    const referenceUrl = bgmSubjectId ? "" : /^https?:\/\//i.test(extLink) ? extLink : "";
    const watchUrl = String(this.form.watchUrl || "").trim();
    const tags = splitUserTags(this.form.tagsText);

    this._isSaving = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "正在保存…";
    }

    try {
      const finalCover = await this.resolveFinalCoverPath(cn);
      const watchedFinal = watchedParsed === null ? 0 : watchedParsed;
      const episodeStr = totalEpParsed === null ? "" : String(totalEpParsed);

      if (this.isEditMode && this.editItem?.file) {
        const file = this.editItem.file;
        const oldSubjectId = String(this.editItem.subjectId || "").trim();
        const raw = await this.app.vault.read(file);

        let nextDownloadPath = undefined;
        if (isDesktopNodeAvailable()) {
          if (this.form.localFolderMode === "custom") {
            nextDownloadPath = this.form.customDownloadPath || "无";
          } else if (this.form.localFolderMode === "none" && this.editItem.downloadPath && this.editItem.downloadPath !== "无") {
            nextDownloadPath = "无";
          }
        }

        const nextContent = applyMetadataEditsToNoteContent(raw, {
          CN: cn,
          JP: String(this.form.JP || "").trim(),
          cover: finalCover,
          mediaFormat: this.form.mediaFormat,
          catego: String(this.form.catego || "").trim(),
          episode: episodeStr,
          state: this.form.state,
          watchedEpisodes: watchedFinal,
          AnimeMake: String(this.form.AnimeMake || "").trim(),
          director: String(this.form.director || "").trim(),
          music: String(this.form.music || "").trim(),
          date: String(this.form.date || "").trim(),
          year,
          season,
          personalScore: personalScore === null ? "" : personalScore,
          referenceScore: referenceScore === null ? "" : referenceScore,
          referenceScoreSource: String(this.form.referenceScoreSource || "").trim(),
          watchUrl,
          bgmUrl,
          referenceUrl,
          isCustom: !bgmSubjectId,
          downloadPath: nextDownloadPath,
          tags
        });

        await this.plugin.modifyNoteSafely(file, nextContent, 3000);

        // 若从无 subjectId 补绑为有效 Bangumi subjectId，无缝迁移本地视频绑定键
        if (!oldSubjectId && bgmSubjectId && typeof localMediaIndexService.migrateAnimeBindingKey === "function") {
          await localMediaIndexService.migrateAnimeBindingKey(
            this.plugin,
            `note:${file.path}`,
            `bgm:${bgmSubjectId}`
          );
        }
        localMediaIndexService.invalidateLocalMediaCache(this.plugin);

        // 同步个人评分缓存
        if (!this.plugin.settings.personalRatingCache) {
          this.plugin.settings.personalRatingCache = {};
        }
        if (personalScore !== null) {
          this.plugin.settings.personalRatingCache[file.path] = String(personalScore);
        } else {
          delete this.plugin.settings.personalRatingCache[file.path];
        }
        await this.plugin.saveSettings();

        if (typeof this.plugin.refreshOpenDashboardViews === "function") {
          await this.plugin.refreshOpenDashboardViews();
        }
        if (this.onCompleted) {
          await this.onCompleted({ file, filePath: file.path, isEdit: true });
        }
        new Notice(`已保存《${cn}》的动画资料。`, 4500);
        this.close();
        return;
      }

      // 新建模式
      let downloadPath = "无";
      if (isDesktopNodeAvailable()) {
        if (this.form.localFolderMode === "auto") {
          try {
            downloadPath = createLocalAnimeFolder(this.plugin.settings, {
              CN: cn,
              JP: String(this.form.JP || "").trim(),
              year,
              season
            });
          } catch (folderErr) {
            console.warn("[Bangumi Custom] 创建本地目录失败，已降级仅创建笔记:", folderErr);
            new Notice(`未能创建本地文件夹（${folderErr?.message || "路径不可用"}），已继续创建笔记。`, 5000);
            downloadPath = "无";
          }
        } else if (this.form.localFolderMode === "custom" && this.form.customDownloadPath) {
          downloadPath = this.form.customDownloadPath.replace(/\\/g, "/");
        }
      }

      const info = {
        CN: cn,
        JP: String(this.form.JP || "").trim(),
        cover: finalCover,
        type: this.form.mediaFormat || "OVA",
        mediaFormat: this.form.mediaFormat || "OVA",
        catego: String(this.form.catego || "").trim(),
        episode: episodeStr,
        state: this.form.state || "在看",
        AnimeMake: String(this.form.AnimeMake || "").trim(),
        director: String(this.form.director || "").trim(),
        music: String(this.form.music || "").trim(),
        date: String(this.form.date || "").trim(),
        year,
        season,
        recordDate: getTodayCompact(),
        url: bgmUrl,
        netaba: bgmSubjectId ? `https://netaba.re/subject/${bgmSubjectId}` : "",
        referenceUrl,
        referenceScore: referenceScore === null ? "" : String(referenceScore),
        referenceScoreSource: String(this.form.referenceScoreSource || "").trim(),
        rating: "未评分",
        userRating: null,
        isCustom: !bgmSubjectId,
        tags
      };

      const result = await noteManager.createAnimeNote(
        this.app,
        this.plugin.settings,
        info,
        {
          isCustom: !bgmSubjectId,
          watchedEpisodes: String(watchedFinal),
          personalScore: personalScore === null ? "" : String(personalScore),
          referenceScore: referenceScore === null ? "" : String(referenceScore),
          referenceScoreSource: String(this.form.referenceScoreSource || "").trim(),
          referenceUrl,
          watchUrl,
          personalSummary: String(this.form.summary || "").trim(),
          downloadPath,
          netabaEmbedEnabled: Boolean(bgmSubjectId && this.plugin.settings.netabaEmbedEnabled !== false),
          animeInfoCollapsedByDefault: this.plugin.settings.animeInfoCollapsedByDefault === true,
          netabaUserId: this.plugin.settings.netabaUserId,
          netabaCompareUrl: this.plugin.settings.netabaCompareUrl,
          netabaDefaultPage: this.plugin.settings.netabaDefaultPage,
          showBangumiUserScore: Boolean(bgmSubjectId && this.plugin.settings.showBangumiUserScore !== false),
          showPersonalScore: this.plugin.settings.showPersonalScore !== false,
          useBangumiPreciseScore: this.plugin.settings.showBangumiPreciseScore === true
        }
      );

      if (!result.created) {
        new Notice(`同名动画笔记已存在（${result.filePath}），未覆盖原笔记。`, 6500);
        this._isSaving = false;
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "创建动画笔记";
        }
        return;
      }

      if (personalScore !== null) {
        if (!this.plugin.settings.personalRatingCache) {
          this.plugin.settings.personalRatingCache = {};
        }
        this.plugin.settings.personalRatingCache[result.filePath] = String(personalScore);
        await this.plugin.saveSettings();
      }

      setSamplePreviewActive(this.plugin, false);
      localMediaIndexService.invalidateLocalMediaCache(this.plugin);

      animeActivityService.recordAnimeActivity(this.plugin, {
        type: "import",
        animeName: cn,
        filePath: result.filePath || "",
        cover: finalCover || "",
        status: info.state || "",
        detail: `手动新建自定义动画（${info.state || "在看"}）`
      }).catch(() => {});

      if (typeof this.plugin.refreshOpenDashboardViews === "function") {
        await this.plugin.refreshOpenDashboardViews();
      }
      if (this.onCompleted) {
        await this.onCompleted({ file: result.file, filePath: result.filePath, isEdit: false });
      }

      new Notice(`已创建自定义动画笔记：${result.filePath}`, 6000);
      this.close();

      const createdFile = result.file || this.app.vault.getAbstractFileByPath(result.filePath);
      if (createdFile && this.options.openAfterCreate !== false) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(createdFile);
      }
    } catch (err) {
      console.error("[Bangumi Manager] 保存自定义动画失败:", err);
      new Notice(`保存失败：${err?.message || err}`, 7000);
      this._isSaving = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = this.isEditMode ? "保存修改" : "创建动画笔记";
      }
    }
  }

  onClose() {
    this.revokeTempObjectUrl();
    const ownerDoc = this.modalEl?.ownerDocument || document;
    if (this._pasteHandler) {
      try {
        ownerDoc.removeEventListener("paste", this._pasteHandler);
      } catch (_) {}
      this._pasteHandler = null;
    }
    this.contentEl.empty();
  }
}

function openCustomAnimeModal(app, plugin, options = {}) {
  const modal = new CustomAnimeModal(app, plugin, options);
  modal.open();
  return modal;
}

module.exports = {
  CUSTOM_ANIME_STYLE_ID,
  CustomAnimeModal,
  openCustomAnimeModal,
  applyMetadataEditsToNoteContent,
  stripPlaceholderMeta,
  splitUserTags
};
