/**
 * v0.9 四站动画评分对比（Bangumi · AniList · MyAnimeList · Filmarks）
 * ------------------------------------------------------------------------
 * 模块契约（供主工作台 dashboard-2d-desk.js 挂载调用）：
 *
 *   renderRatingCompareWorkspace(container, ctx)
 *
 *   ctx: {
 *     plugin: BangumiManagerPlugin,
 *     items: Array<AnimeItem>,
 *     focusItem?: AnimeItem | null,          // 从封面评分角标点击直达时聚焦的作品
 *     getCover: (item) => string,
 *     openNote: (item) => Promise<void>,
 *     openExternal: (url) => void,
 *     onPreferredSourceChanged?: (nextSourceId) => void, // 切换全局优先展示评分源后通知追番/全部番剧刷新
 *     service: typeof import("./multisite-rating-service.js")
 *   }
 *
 * 视觉结构：
 *   - 换算尺：四条按各站原生分制刻度的平行标尺（BGM 10 分 / AL 百分 / MAL 10 分 / FM 5 分）
 *     上下对齐同一折算位置，四枚指针连成一条折线——越直越一致；悬停或拖动游标即可同时读出四站对应分数。
 *   - 排行条：每部作品一条点阵刻度（四站圆点 + 综合刻线 + 极差带），切换视角时用 FLIP 平滑换位。
 *   - 东西温差图：中日均分 × 欧美均分散点，对角线即两边一致。
 *   - 权重推子：四路推子实时调整综合分，排行即时重排。
 *   - 给分习惯与口味契合：四站馆藏分布色带、个人评分相关性。
 *
 * 跨端约束：零 Node 专属依赖；兼容桌面端宽屏/中窄窗与移动端 390px 竖屏（0px 横向溢出），
 * 仅消费 --bm7-* 主题令牌，完整适配跟随/纸本/柔光/影院/洛琪希/晴空 6 大外观的明暗态；
 * 动效只走 transform / opacity，并遵从 prefers-reduced-motion 与插件动效档位。
 */
"use strict";

const { Notice } = require("obsidian");
const {
  h,
  clear,
  icon,
  coverEl,
  popover,
  formatCount,
  formatRelative,
  clamp,
  motionEnabled,
  applyAmbient
} = require("./v07-core.js");
const multiSiteRatingService = require("./multisite-rating-service.js");

const RATING_COMPARE_STYLE_ID = "bm9-rating-compare-styles";

const CORE = ["bangumi", "anilist", "mal", "filmarks"];
const SITE_VAR = { bangumi: "--rc-bgm", anilist: "--rc-al", mal: "--rc-mal", filmarks: "--rc-fm" };
const SITE_NAME = { bangumi: "Bangumi", anilist: "AniList", mal: "MyAnimeList", filmarks: "Filmarks" };
const SITE_SHORT = { bangumi: "BGM", anilist: "AL", mal: "MAL", filmarks: "FM" };
const SITE_REGION = { bangumi: "华语", anilist: "英文", mal: "欧美", filmarks: "日本" };
const SITE_SCALE = { bangumi: "10 分制", anilist: "百分制", mal: "10 分制", filmarks: "5 分制" };

const LENSES = [
  { id: "rank", label: "综合排行", title: "按四站加权后的综合分从高到低排列" },
  { id: "split", label: "意见分歧", title: "四个站给分差距最大的作品排在前面" },
  { id: "gap", label: "东西温差", title: "对比中日两站（Bangumi、Filmarks）与欧美两站（AniList、MyAnimeList）的均分" },
  { id: "mine", label: "我的反差", title: "你的个人评分和综合分差得最多的作品" }
];

const siteColor = (sid) => `var(${SITE_VAR[sid]})`;

const CSS = String.raw`
.bm9rc,.bm9rc-mixer{--rc-bgm:#d4506f;--rc-al:#0b84d4;--rc-mal:#3555a8;--rc-fm:#c08400;--rc-east:#cc5a32;--rc-west:#2c78bd;
  --rc-line:color-mix(in srgb,var(--bm7-ink) 11%,transparent);--rc-faint:color-mix(in srgb,var(--bm7-ink) 5.5%,transparent);}
.theme-dark .bm9rc,.bm7-root[data-bm7-theme="cinema"] .bm9rc,.theme-dark .bm9rc-mixer,.bm7-root[data-bm7-theme="cinema"] .bm9rc-mixer{
  --rc-bgm:#f28aa2;--rc-al:#4bb8ff;--rc-mal:#8ea8ff;--rc-fm:#f2c138;--rc-east:#f39264;--rc-west:#6cb4f2;
  --rc-line:color-mix(in srgb,var(--bm7-ink) 13%,transparent);--rc-faint:color-mix(in srgb,var(--bm7-ink) 7%,transparent);}
.bm9rc{container:bm9rc / inline-size;display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;box-sizing:border-box;color:var(--bm7-ink);font-variant-numeric:tabular-nums;}
.bm9rc *,.bm9rc *::before,.bm9rc *::after{box-sizing:border-box;}
.bm9rc .bm9rc-b{appearance:none;-webkit-appearance:none;margin:0;padding:0;font:inherit;color:inherit;text-align:inherit;background:transparent !important;border:none !important;box-shadow:none !important;height:auto !important;min-height:0;border-radius:0;cursor:pointer;line-height:1.25;}
.bm9rc .bm9rc-b:focus-visible{outline:2px solid var(--bm7-accent);outline-offset:2px;}
.bm9rc .bm9rc-b:disabled{cursor:default;}

/* ---------- 顶部：标题 + 图例 + 角标来源 + 同步 ---------- */
.bm9rc-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px 24px;padding:2px 4px 0;min-width:0;}
.bm9rc-titles{min-width:0;flex:1 1 360px;}
.bm9rc-title{margin:0;font-size:22px;font-weight:800;line-height:1.25;letter-spacing:.01em;}
.bm9rc-facts{margin:6px 0 0;display:flex;flex-wrap:wrap;gap:3px 14px;font-size:12.5px;color:var(--bm7-ink-2);}
.bm9rc-facts b{color:var(--bm7-ink);font-weight:750;}
.bm9rc-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:9px;}
.bm9rc-leg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc-leg i{width:8px;height:8px;border-radius:50%;background:var(--c);}
.bm9rc-leg b{font-weight:700;color:var(--bm7-ink-2);}
.bm9rc-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;min-width:0;max-width:100%;}
.bm9rc-src{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;}
.bm9rc-src-lbl{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc-src-group{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--bm7-seg-bg);min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none;}
.bm9rc-src-group::-webkit-scrollbar{display:none;}
.bm9rc .bm9rc-src-chip{display:inline-flex;align-items:center;gap:6px;height:28px !important;padding:0 10px;border-radius:7px;font-size:12px;font-weight:650;color:var(--bm7-ink-2);white-space:nowrap;flex-shrink:0;transition:background .16s ease,color .16s ease,box-shadow .16s ease;}
.bm9rc .bm9rc-src-chip i{width:7px;height:7px;border-radius:50%;background:var(--c);opacity:.55;transition:opacity .16s ease;}
.bm9rc .bm9rc-src-chip:hover{color:var(--bm7-ink);}
.bm9rc .bm9rc-src-chip.is-on{background:var(--bm7-seg-active-bg) !important;color:var(--bm7-ink);box-shadow:var(--bm7-seg-active-shadow) !important;}
.bm9rc .bm9rc-src-chip.is-on i{opacity:1;}
.bm9rc-sync{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.bm9rc .bm9rc-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px !important;padding:0 13px;border-radius:9px;font-size:12.5px;font-weight:650;white-space:nowrap;background:var(--rc-faint) !important;color:var(--bm7-ink);transition:background .16s ease,transform .12s ease,opacity .16s ease;}
.bm9rc .bm9rc-act:hover{background:color-mix(in srgb,var(--bm7-ink) 10%,transparent) !important;}
.bm9rc .bm9rc-act:active{transform:translateY(1px);}
.bm9rc .bm9rc-act.is-solid{background:var(--bm7-accent) !important;color:var(--bm7-accent-ink);}
.bm9rc .bm9rc-act.is-solid:hover{background:color-mix(in srgb,var(--bm7-accent) 86%,#000) !important;}
.bm9rc .bm9rc-act.is-small{height:26px !important;padding:0 9px;font-size:12px;border-radius:7px;background:var(--bm7-surface) !important;}
.bm9rc .bm9rc-act:disabled{opacity:.6;}
.bm9rc .bm9rc-act.is-busy svg{animation:bm9rc-spin 1s linear infinite;}
@keyframes bm9rc-spin{to{transform:rotate(360deg);}}
.bm9rc-prog{position:relative;display:flex;align-items:center;gap:10px;height:34px;padding:0 4px 0 12px;border-radius:10px;background:var(--rc-faint);overflow:hidden;min-width:0;max-width:min(100%,420px);}
.bm9rc-prog-fill{position:absolute;inset:0;background:color-mix(in srgb,var(--bm7-accent) 18%,transparent);transform-origin:left center;transform:scaleX(var(--p,0));transition:transform .45s ease;}
.bm9rc-prog-txt{position:relative;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto;}
.bm9rc-prog .bm9rc-act{position:relative;flex-shrink:0;}

/* ---------- 主区：排行 + 换算尺 ---------- */
.bm9rc-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.04fr);gap:16px;align-items:start;min-width:0;}
.bm9rc-board,.bm9rc-stage,.bm9rc-insight{position:relative;min-width:0;border-radius:var(--bm7-radius,16px);border:1px solid var(--bm7-line);background:var(--bm7-panel-bg);box-shadow:var(--bm7-shadow);-webkit-backdrop-filter:blur(var(--bm7-blur,0px));backdrop-filter:blur(var(--bm7-blur,0px));}
.bm9rc-board{padding:0 0 10px;overflow:hidden;}
.bm9rc-stage{position:sticky;top:12px;overflow:hidden;}

.bm9rc-bar{display:flex;align-items:flex-end;padding:6px 14px 0;border-bottom:1px solid var(--rc-line);min-width:0;}
.bm9rc-tabs{display:flex;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;}
.bm9rc-tabs::-webkit-scrollbar{display:none;}
.bm9rc .bm9rc-tab{position:relative;height:40px !important;padding:0 11px;font-size:13px;font-weight:650;color:var(--bm7-ink-3);white-space:nowrap;flex-shrink:0;transition:color .16s ease;}
.bm9rc .bm9rc-tab:hover{color:var(--bm7-ink);}
.bm9rc .bm9rc-tab.is-on{color:var(--bm7-ink);}
.bm9rc-tab::after{content:"";position:absolute;left:11px;right:11px;bottom:-1px;height:2px;border-radius:2px;background:var(--bm7-ink);transform:scaleX(0);transition:transform .22s cubic-bezier(.22,.8,.24,1);}
.bm9rc-tab::before{content:"";position:absolute;left:50%;bottom:1px;border:4px solid transparent;border-bottom-color:var(--bm7-ink);transform:translateX(-50%) scale(0);transform-origin:50% 100%;transition:transform .22s ease;}
.bm9rc-tab.is-on::after{transform:scaleX(1);}
.bm9rc-tab.is-on::before{transform:translateX(-50%) scale(1);}
.bm9rc-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px 6px;min-width:0;}
.bm9rc-search{position:relative;display:flex;align-items:center;flex:1 1 170px;min-width:0;}
.bm9rc-search svg{position:absolute;left:10px;color:var(--bm7-ink-3);pointer-events:none;}
.bm9rc .bm9rc-search input{width:100%;min-width:0;height:32px !important;padding:0 10px 0 31px !important;border-radius:9px !important;border:1px solid transparent !important;background:var(--rc-faint) !important;color:var(--bm7-ink) !important;font-size:12.5px;box-shadow:none !important;}
.bm9rc .bm9rc-search input:focus{outline:none;border-color:color-mix(in srgb,var(--bm7-accent) 55%,transparent) !important;background:var(--bm7-surface) !important;}
.bm9rc .bm9rc-chip{display:inline-flex;align-items:center;gap:6px;height:32px !important;padding:0 11px;border-radius:9px;font-size:12.5px;font-weight:600;white-space:nowrap;color:var(--bm7-ink-2);background:var(--rc-faint) !important;transition:background .16s ease,color .16s ease;}
.bm9rc .bm9rc-chip:hover{color:var(--bm7-ink);}
.bm9rc .bm9rc-chip svg{opacity:.35;transition:opacity .16s ease;}
.bm9rc .bm9rc-chip.is-on{color:var(--bm7-accent);background:color-mix(in srgb,var(--bm7-accent) 12%,transparent) !important;}
.bm9rc .bm9rc-chip.is-on svg{opacity:1;}
.bm9rc-wbar{display:flex;gap:1.5px;width:40px;height:6px;border-radius:3px;overflow:hidden;flex-shrink:0;}
.bm9rc-wbar i{display:block;height:100%;min-width:1px;background:var(--c);transition:flex-grow .2s ease;}

.bm9rc-list{display:flex;flex-direction:column;gap:1px;padding:2px 8px 0;min-width:0;}
.bm9rc .bm9rc-row{position:relative;display:grid;grid-template-columns:22px 34px minmax(0,1fr) minmax(110px,1.05fr) 60px;grid-template-areas:"rank thumb name strip val";align-items:center;gap:10px;width:100%;min-width:0;padding:7px 8px;border-radius:10px;transition:background .15s ease;}
.bm9rc .bm9rc-row:hover{background:var(--rc-faint) !important;}
.bm9rc .bm9rc-row.is-sel{background:color-mix(in srgb,var(--bm7-accent) 10%,transparent) !important;}
.bm9rc-row::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:2px;background:var(--bm7-accent);transform:scaleY(0);transition:transform .2s ease;}
.bm9rc-row.is-sel::before{transform:scaleY(1);}
.bm9rc-rank{grid-area:rank;font-size:12px;font-weight:700;color:var(--bm7-ink-3);text-align:right;}
.bm9rc-row.is-top .bm9rc-rank{color:var(--bm7-ink);}
.bm9rc-thumb{grid-area:thumb;display:block;width:34px;aspect-ratio:2/3;border-radius:5px;overflow:hidden;}
.bm9rc-thumb .bm7-cover{width:100%;height:100%;}
.bm9rc-name{grid-area:name;display:flex;flex-direction:column;gap:2px;min-width:0;}
.bm9rc-name b{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-name span{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-val{grid-area:val;display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:0;}
.bm9rc-val b{font-size:16px;font-weight:800;letter-spacing:-.01em;line-height:1.15;}
.bm9rc-val span{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc-val.is-pos b{color:var(--bm7-ok);}
.bm9rc-val.is-neg b{color:var(--bm7-live);}
.bm9rc-strip{grid-area:strip;position:relative;display:block;height:22px;min-width:0;}
.bm9rc-strip-m{position:absolute;top:0;bottom:0;left:6px;right:6px;}
.bm9rc-strip-base{position:absolute;left:-6px;right:-6px;top:50%;height:1px;background:var(--rc-line);}
.bm9rc-strip-tick{position:absolute;top:calc(50% - 3px);width:1px;height:7px;background:var(--rc-line);}
.bm9rc-strip-range{position:absolute;top:calc(50% - 2.5px);height:5px;border-radius:3px;background:color-mix(in srgb,var(--bm7-ink) 13%,transparent);}
.bm9rc-dot{position:absolute;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:var(--c);box-shadow:0 0 0 1.5px var(--bm7-surface);}
.bm9rc-dot.is-clamp{background:var(--bm7-surface);box-shadow:inset 0 0 0 2px var(--c),0 0 0 1.5px var(--bm7-surface);}
.bm9rc-comp{position:absolute;top:2px;bottom:2px;width:2px;margin-left:-1px;border-radius:1px;background:var(--bm7-ink);}
.bm9rc-me{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:2px solid var(--bm7-accent);background:var(--bm7-surface);}
.bm9rc-melink{position:absolute;top:50%;height:0;border-top:1.5px dashed color-mix(in srgb,var(--bm7-accent) 70%,transparent);}
.bm9rc-more{display:flex;justify-content:center;padding:6px 0 2px;}
.bm9rc .bm9rc-morebtn{padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--bm7-ink-2);}
.bm9rc .bm9rc-morebtn:hover{background:var(--rc-faint) !important;color:var(--bm7-ink);}
.bm9rc-empty,.bm9rc-empty-in{display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 22px;text-align:center;font-size:13px;line-height:1.7;color:var(--bm7-ink-3);}

/* ---------- 东西温差图 ---------- */
.bm9rc-map{padding:6px 16px 8px;min-width:0;overflow:hidden;}
.bm9rc-map-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 14px;margin:4px 0 2px;}
.bm9rc-map-head .bm9rc-map-cap{flex:1 1 260px;margin:0;}
.bm9rc-map-head .bm9rc-chip{flex-shrink:0;}
.bm9rc-map-cap{margin:4px 0 2px;font-size:12.5px;color:var(--bm7-ink-2);line-height:1.6;}
.bm9rc-map-cap b{color:var(--bm7-ink);}
.bm9rc-plotwrap{position:relative;padding:28px 6px 46px 30px;min-width:0;}
.bm9rc-plot{position:relative;width:100%;aspect-ratio:4 / 3;}
.bm9rc-plot-bg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.bm9rc-zone-east{fill:color-mix(in srgb,var(--rc-east) 7%,transparent);}
.bm9rc-zone-west{fill:color-mix(in srgb,var(--rc-west) 7%,transparent);}
.bm9rc-gridline{stroke:var(--rc-line);stroke-width:1;vector-effect:non-scaling-stroke;}
.bm9rc-diag{stroke:var(--bm7-ink-3);stroke-width:1.25;stroke-dasharray:1.2 1.2;vector-effect:non-scaling-stroke;}
.bm9rc-ax-x{position:absolute;top:calc(100% + 6px);transform:translateX(-50%);font-size:12px;color:var(--bm7-ink-3);}
.bm9rc-ax-y{position:absolute;right:calc(100% + 8px);transform:translateY(-50%);font-size:12px;color:var(--bm7-ink-3);}
.bm9rc-axt{position:absolute;font-size:12px;font-weight:650;color:var(--bm7-ink-2);white-space:nowrap;}
.bm9rc-axt.is-x{right:0;top:calc(100% + 26px);}
.bm9rc-axt.is-y{left:0;bottom:calc(100% + 8px);}
.bm9rc-zone{position:absolute;font-size:12px;font-weight:700;pointer-events:none;white-space:nowrap;}
.bm9rc-zone.is-east{right:8px;bottom:8px;color:var(--rc-east);}
.bm9rc-zone.is-west{left:8px;top:8px;color:var(--rc-west);}
.bm9rc .bm9rc-pt{position:absolute;z-index:1;width:11px;height:11px !important;margin:-5.5px 0 0 -5.5px;border-radius:50% !important;background:color-mix(in srgb,var(--bm7-ink) 42%,transparent) !important;box-shadow:0 0 0 2px var(--bm7-surface) !important;transition:transform .15s ease;animation:bm9rc-pop .45s cubic-bezier(.3,1.5,.5,1) backwards;animation-delay:calc(var(--i,0) * 12ms);}
.bm9rc .bm9rc-pt.is-east{background:var(--rc-east) !important;}
.bm9rc .bm9rc-pt.is-west{background:var(--rc-west) !important;}
.bm9rc .bm9rc-pt:hover{transform:scale(1.55);z-index:3;}
.bm9rc .bm9rc-pt.is-sel{z-index:4;width:34px;height:34px !important;margin:-17px 0 0 -17px;box-shadow:0 0 0 2.5px var(--bm7-surface),0 0 0 4.5px var(--bm7-ink),0 8px 20px -6px rgb(0 0 0 / .4) !important;}
.bm9rc .bm9rc-pt.is-sel:hover{transform:none;}
.bm9rc-pt .bm7-cover{width:100%;height:100%;border-radius:50%;}
.bm9rc-pt-tag{position:absolute;left:calc(100% + 9px);top:50%;transform:translateY(-50%);max-width:150px;padding:3px 8px;border-radius:6px;background:var(--bm7-ink);color:var(--bm7-bg);font-size:12px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
.bm9rc-pt.is-flip .bm9rc-pt-tag{left:auto;right:calc(100% + 9px);}
@keyframes bm9rc-pop{from{transform:scale(0);opacity:0;}to{transform:scale(1);opacity:1;}}
.bm9rc-gcols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:2px;}
.bm9rc-gcol{min-width:0;}
.bm9rc-gcol h4{margin:0 0 4px;padding:0 8px;font-size:12.5px;font-weight:750;color:var(--k);}
.bm9rc .bm9rc-grow{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:6px 8px;border-radius:8px;font-size:12.5px;}
.bm9rc .bm9rc-grow:hover{background:var(--rc-faint) !important;}
.bm9rc-grow span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bm9rc-grow b{color:var(--k);font-weight:750;flex-shrink:0;}
.bm9rc-gnone{padding:6px 8px;font-size:12px;color:var(--bm7-ink-3);}

/* ---------- 换算尺 ---------- */
.bm9rc-shead{position:relative;isolation:isolate;display:grid;grid-template-columns:62px minmax(0,1fr) auto;grid-template-areas:"cover title big" "cover chips big";column-gap:14px;row-gap:6px;align-items:center;padding:18px 18px 12px;}
.bm9rc-shead::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(90% 130% at 0% 0%,color-mix(in srgb,var(--bm7-ambient) 22%,transparent),transparent 72%);pointer-events:none;}
.bm9rc-scover{grid-area:cover;width:62px;aspect-ratio:2/3;border-radius:8px;overflow:hidden;box-shadow:0 8px 18px -8px rgb(0 0 0 / .45);}
.bm9rc-scover .bm7-cover{width:100%;height:100%;}
.bm9rc-stitle{grid-area:title;align-self:end;display:flex;flex-direction:column;gap:3px;min-width:0;}
.bm9rc-stitle h3{margin:0;font-size:17px;font-weight:800;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}
.bm9rc-stitle p{margin:0;font-size:12.5px;color:var(--bm7-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-chips{grid-area:chips;align-self:start;display:flex;flex-wrap:wrap;gap:5px;min-width:0;}
.bm9rc-chips span{max-width:100%;font-size:12px;line-height:1.5;padding:1px 7px;border-radius:6px;background:var(--rc-faint);color:var(--bm7-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-big{grid-area:big;display:flex;flex-direction:column;align-items:flex-end;min-width:0;}
.bm9rc-big b{font-size:40px;font-weight:800;line-height:1;letter-spacing:-.025em;}
.bm9rc-big span{margin-top:5px;font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}

.bm9rc-rule{--g:24px;--r:46px;--b:20px;position:relative;display:grid;grid-template-columns:78px minmax(0,1fr) 86px;grid-template-rows:var(--g) repeat(4,var(--r)) var(--g);column-gap:10px;padding:0 18px 2px;user-select:none;-webkit-user-select:none;}
.bm9rc-rlab{grid-column:1;display:flex;flex-direction:column;gap:1px;padding-top:7px;min-width:0;}
.bm9rc-rlab b{font-size:13px;font-weight:800;letter-spacing:.03em;color:var(--c);line-height:1.2;}
.bm9rc-rlab span{font-size:12px;color:var(--bm7-ink-3);line-height:1.3;white-space:nowrap;}
.bm9rc-rtrack{grid-column:2;position:relative;overflow:hidden;min-width:0;}
.bm9rc-rm{position:absolute;top:0;bottom:0;left:14px;right:14px;}
.bm9rc-rticks{position:absolute;inset:0;}
.bm9rc-rticks::before{content:"";position:absolute;left:-14px;right:-14px;top:var(--b);height:1px;background:color-mix(in srgb,var(--c) 38%,var(--rc-line));}
.bm9rc-tk{position:absolute;top:calc(var(--b) - 2px);width:1px;height:4px;margin-left:-.5px;background:var(--rc-line);}
.bm9rc-tk.is-major{top:calc(var(--b) - 4px);height:9px;background:color-mix(in srgb,var(--bm7-ink) 28%,transparent);}
.bm9rc-tl{position:absolute;top:calc(var(--b) + 8px);transform:translateX(-50%);font-size:12px;line-height:1;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc-rhist{position:absolute;inset:0;pointer-events:none;}
.bm9rc-rhist i{position:absolute;bottom:calc(100% - var(--b));width:5px;margin-left:-2.5px;border-radius:1.5px 1.5px 0 0;background:color-mix(in srgb,var(--c) 30%,transparent);}
.bm9rc-rail{position:absolute;inset:0;pointer-events:none;}
.bm9rc-pinrail{transition:transform .64s cubic-bezier(.22,.8,.24,1) var(--d,0ms),opacity .3s ease var(--d,0ms);}
.bm9rc-pinrail.is-off{opacity:0;}
.bm9rc-pin{position:absolute;left:-6.5px;top:calc(var(--b) - 6.5px);width:13px;height:13px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2.5px var(--bm7-surface),0 3px 10px color-mix(in srgb,var(--c) 55%,transparent);}
.bm9rc-rna{position:absolute;left:50%;top:calc(var(--b) - 9px);transform:translateX(-50%);padding:0 8px;border-radius:6px;font-size:12px;line-height:17px;white-space:nowrap;color:var(--bm7-ink-3);background:var(--bm7-surface);box-shadow:0 0 0 4px var(--bm7-surface);transition:opacity .2s ease;}
.bm9rc-rna.is-hidden{opacity:0;}
.bm9rc-rtrack .bm9rc-rticks{transition:opacity .25s ease;}
.bm9rc-rtrack.is-na .bm9rc-rticks{opacity:.32;}
.bm9rc-rval{grid-column:3;display:flex;flex-direction:column;align-items:flex-end;padding-top:4px;min-width:0;}
.bm9rc-rval b{font-size:17px;font-weight:800;line-height:1.15;}
.bm9rc-rval span{max-width:100%;font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-rover{grid-column:2;grid-row:1 / -1;position:relative;z-index:2;overflow:hidden;touch-action:pan-y;cursor:crosshair;}
.bm9rc-rover-m{position:absolute;top:0;bottom:0;left:14px;right:14px;}
.bm9rc-rpath{position:absolute;left:0;right:0;top:var(--g);height:calc(var(--r) * 4);pointer-events:none;}
.bm9rc-rpath svg{display:block;width:100%;height:100%;overflow:visible;}
.bm9rc-rpath path{fill:none;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round;transition:d .64s cubic-bezier(.22,.8,.24,1);}
.bm9rc-rpath .is-glow{stroke:var(--bm7-ink);stroke-width:7;stroke-opacity:.06;}
.bm9rc-rpath .is-line{stroke:var(--bm7-ink);stroke-width:1.5;stroke-opacity:.55;}
.bm9rc-comprail{transition:transform .64s cubic-bezier(.22,.8,.24,1) .1s,opacity .3s ease;}
.bm9rc-comprail.is-off,.bm9rc-merail.is-off{opacity:0;}
.bm9rc-cline{position:absolute;left:-1px;top:calc(var(--g) - 3px);bottom:calc(var(--g) - 3px);width:2px;border-radius:1px;background:var(--bm7-ink);opacity:.85;}
.bm9rc-ctag{position:absolute;left:0;top:2px;transform:translateX(-50%);padding:1px 7px;border-radius:6px;font-size:12px;font-weight:750;line-height:17px;white-space:nowrap;background:var(--bm7-ink);color:var(--bm7-bg);}
.bm9rc-merail{transition:transform .64s cubic-bezier(.22,.8,.24,1) .16s,opacity .3s ease;}
.bm9rc-mline{position:absolute;left:-.75px;top:var(--g);bottom:calc(var(--g) - 3px);width:0;border-left:1.5px dashed var(--bm7-accent);}
.bm9rc-mtag{position:absolute;left:0;bottom:2px;transform:translateX(-50%);padding:1px 7px;border-radius:6px;font-size:12px;font-weight:750;line-height:17px;white-space:nowrap;color:var(--bm7-accent);background:color-mix(in srgb,var(--bm7-accent) 14%,var(--bm7-bg));}
.bm9rc-rail.is-l .bm9rc-ctag,.bm9rc-rail.is-l .bm9rc-mtag{transform:translateX(-6px);}
.bm9rc-rail.is-r .bm9rc-ctag,.bm9rc-rail.is-r .bm9rc-mtag{transform:translateX(calc(-100% + 6px));}
.bm9rc-currail{opacity:0;transition:opacity .15s ease;}
.bm9rc-currail.is-on{opacity:1;}
.bm9rc-curline{position:absolute;left:-.5px;top:calc(var(--g) - 4px);bottom:calc(var(--g) - 4px);width:1px;background:var(--bm7-ink-2);}
.bm9rc-curchip{position:absolute;left:6px;top:calc(var(--g) + var(--r) * var(--row) + 1px);padding:0 5px;border-radius:5px;font-size:12px;font-weight:750;line-height:17px;white-space:nowrap;color:#fff;background:var(--c);}
.theme-dark .bm9rc-curchip,.bm7-root[data-bm7-theme="cinema"] .bm9rc-curchip{color:#10131a;}
.bm9rc-currail.is-flip .bm9rc-curchip{left:auto;right:calc(100% + 6px);}
.bm9rc-rkey{display:flex;flex-wrap:wrap;align-items:center;gap:5px 14px;padding:4px 18px 12px;font-size:12px;color:var(--bm7-ink-3);}
.bm9rc-k{display:inline-flex;align-items:center;gap:6px;color:var(--bm7-ink-2);white-space:nowrap;}
.bm9rc-k i{display:inline-block;}
.bm9rc-k.is-line i{width:16px;height:0;border-top:1.5px solid color-mix(in srgb,var(--bm7-ink) 55%,transparent);}
.bm9rc-k.is-comp i{width:2px;height:12px;border-radius:1px;background:var(--bm7-ink);}
.bm9rc-k.is-me i{width:0;height:12px;border-left:1.5px dashed var(--bm7-accent);}
.bm9rc-k-tip{flex:1 1 220px;min-width:0;}

.bm9rc-facts4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--rc-line);}
.bm9rc-fact{display:flex;flex-direction:column;gap:3px;min-width:0;padding:10px 16px 11px;}
.bm9rc-fact:nth-child(odd){border-right:1px solid var(--rc-line);}
.bm9rc-fact:nth-child(-n+2){border-bottom:1px solid var(--rc-line);}
.bm9rc-fact-h{display:flex;align-items:center;gap:6px;min-width:0;min-height:24px;}
.bm9rc-fact-h i{width:7px;height:7px;border-radius:50%;background:var(--c);flex-shrink:0;}
.bm9rc-fact-h b{font-size:12.5px;font-weight:750;white-space:nowrap;}
.bm9rc-fact-h span{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc .bm9rc-ext{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px !important;border-radius:6px;color:var(--bm7-ink-3);flex-shrink:0;}
.bm9rc .bm9rc-ext:hover{background:var(--rc-faint) !important;color:var(--bm7-ink);}
.bm9rc-fact-v{font-size:12.5px;line-height:1.55;color:var(--bm7-ink-2);overflow-wrap:anywhere;}
.bm9rc-fact-v.is-none{color:var(--bm7-ink-3);}
.bm9rc-fact-m{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px 14px;border-top:1px solid var(--rc-line);}
.bm9rc .bm9rc-fix{margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:5px 2px;font-size:12.5px;font-weight:600;color:var(--bm7-ink-2);white-space:nowrap;}
.bm9rc .bm9rc-fix:hover{color:var(--bm7-accent);}
.bm9rc-bind{display:flex;flex-direction:column;gap:10px;padding:0 16px 16px;}
.bm9rc-bind-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.bm9rc-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;color:var(--bm7-ink-3);}
.bm9rc-field b{font-size:12.5px;font-weight:750;color:var(--c);}
.bm9rc .bm9rc-field input{width:100%;min-width:0;height:32px !important;padding:0 10px !important;border-radius:8px !important;border:1px solid var(--bm7-line) !important;background:var(--bm7-surface) !important;color:var(--bm7-ink) !important;font-size:12.5px;box-shadow:none !important;}
.bm9rc .bm9rc-field input:focus{outline:none;border-color:var(--bm7-accent) !important;box-shadow:0 0 0 3px var(--bm7-accent-soft) !important;}
.bm9rc-bind-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.bm9rc-bind-foot p{margin:0 0 0 auto;font-size:12px;color:var(--bm7-ink-3);}

/* ---------- 底部：给分习惯 + 口味契合 ---------- */
.bm9rc-insight{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);}
.bm9rc-card{min-width:0;padding:16px 18px 18px;}
.bm9rc-card + .bm9rc-card{border-left:1px solid var(--rc-line);}
.bm9rc-card-h{margin-bottom:10px;}
.bm9rc-card-h h3{margin:0;font-size:15px;font-weight:800;line-height:1.35;}
.bm9rc-card-h span{display:block;margin-top:3px;font-size:12px;line-height:1.55;color:var(--bm7-ink-3);}
.bm9rc-slab{display:flex;flex-direction:column;min-width:0;}
.bm9rc-slab b{font-size:12.5px;font-weight:800;color:var(--c);line-height:1.25;}
.bm9rc-slab span{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm9rc-hrow{display:grid;grid-template-columns:84px minmax(0,1fr) 92px;align-items:center;gap:10px;min-height:38px;}
.bm9rc-swarm{position:relative;height:32px;min-width:0;overflow:hidden;}
.bm9rc-sw-m{position:absolute;top:0;bottom:0;left:7px;right:7px;}
.bm9rc-sw-base{position:absolute;left:-7px;right:-7px;top:50%;height:1px;background:var(--rc-line);}
.bm9rc-sw-band{position:absolute;top:5px;bottom:5px;border-radius:6px;background:color-mix(in srgb,var(--c) 15%,transparent);}
.bm9rc-sw-dot{position:absolute;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:color-mix(in srgb,var(--c) 72%,transparent);cursor:pointer;transition:transform .12s ease;}
.bm9rc-sw-dot:hover{transform:scale(1.7);}
.bm9rc-sw-mean{position:absolute;top:2px;bottom:2px;width:2px;margin-left:-1px;border-radius:1px;background:var(--c);pointer-events:none;}
.bm9rc-hstat{display:flex;flex-direction:column;align-items:flex-end;min-width:0;}
.bm9rc-hstat b{font-size:15px;font-weight:800;line-height:1.2;}
.bm9rc-hstat span{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm9rc-haxis{display:grid;grid-template-columns:84px minmax(0,1fr) 92px;gap:10px;}
.bm9rc-haxis-m{position:relative;height:16px;margin:0 7px;}
.bm9rc-haxis-m span{position:absolute;top:0;transform:translateX(-50%);font-size:12px;color:var(--bm7-ink-3);}
.bm9rc-say{margin:12px 0 0;font-size:13px;line-height:1.7;color:var(--bm7-ink-2);}
.bm9rc-say b{color:var(--bm7-ink);font-weight:750;}
.bm9rc-trow{display:grid;grid-template-columns:84px minmax(0,1fr) 46px;align-items:center;column-gap:10px;row-gap:2px;padding:6px 0;}
.bm9rc-tbar{height:8px;border-radius:4px;background:var(--rc-faint);overflow:hidden;}
.bm9rc-tbar i{display:block;height:100%;border-radius:inherit;background:var(--c);transform-origin:left center;transform:scaleX(var(--v,0));animation:bm9rc-grow .8s cubic-bezier(.22,.8,.24,1) backwards;}
@keyframes bm9rc-grow{from{transform:scaleX(0);}}
.bm9rc-tval{font-size:15px;font-weight:800;text-align:right;}
.bm9rc-tsub{grid-column:2 / 4;font-size:12px;color:var(--bm7-ink-3);line-height:1.5;}

/* ---------- 权重推子（弹出层 Portal 内，不依赖 .bm9rc 作用域） ---------- */
.bm9rc-mixer{display:flex;flex-direction:column;gap:12px;color:var(--bm7-ink);font-variant-numeric:tabular-nums;}
.bm9rc-mx-h b{display:block;font-size:14px;font-weight:800;}
.bm9rc-mx-h span{display:block;margin-top:2px;font-size:12px;line-height:1.5;color:var(--bm7-ink-3);}
.bm9rc-mx-pre{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;}
.bm9rc-mixer button.bm9rc-mx-p{appearance:none;-webkit-appearance:none;display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:0;padding:8px 10px !important;height:auto !important;border-radius:9px !important;border:1px solid transparent !important;background:color-mix(in srgb,var(--bm7-ink) 5%,transparent) !important;box-shadow:none !important;color:var(--bm7-ink);font:inherit;font-size:12.5px;font-weight:700;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease;}
.bm9rc-mixer button.bm9rc-mx-p:hover{background:color-mix(in srgb,var(--bm7-ink) 9%,transparent) !important;}
.bm9rc-mixer button.bm9rc-mx-p.is-on{border-color:color-mix(in srgb,var(--bm7-accent) 55%,transparent) !important;background:color-mix(in srgb,var(--bm7-accent) 10%,transparent) !important;}
.bm9rc-mixer .bm9rc-mx-p .bm9rc-wbar{width:100%;}
.bm9rc-mx-fds{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:4px 2px 0;}
.bm9rc-fd{display:flex;flex-direction:column;align-items:center;gap:7px;min-width:0;}
.bm9rc-fd-val{font-size:14px;font-weight:800;}
.bm9rc-fd-tr{position:relative;width:38px;height:136px;border-radius:11px;background:color-mix(in srgb,var(--bm7-ink) 5.5%,transparent);cursor:ns-resize;touch-action:none;outline:none;}
.bm9rc-fd-tr:focus-visible{box-shadow:0 0 0 2px var(--bm7-accent);}
.bm9rc-fd-tk{position:absolute;left:5px;right:5px;height:1px;background:color-mix(in srgb,var(--bm7-ink) 10%,transparent);}
.bm9rc-fd-slot{position:absolute;left:50%;top:12px;bottom:12px;width:4px;margin-left:-2px;border-radius:2px;background:color-mix(in srgb,var(--bm7-ink) 13%,transparent);}
.bm9rc-fd-fill{position:absolute;left:0;right:0;bottom:0;border-radius:2px;background:var(--c);}
.bm9rc-fd-knob{position:absolute;left:50%;width:30px;height:13px;margin:0 0 -6.5px -15px;border-radius:4px;background:var(--bm7-surface);box-shadow:0 1px 3px rgb(0 0 0 / .28),0 0 0 1px color-mix(in srgb,var(--bm7-ink) 14%,transparent),inset 0 -2px 0 var(--c);}
.bm9rc-fd-knob::after{content:"";position:absolute;left:8px;right:8px;top:5px;height:1px;background:color-mix(in srgb,var(--bm7-ink) 32%,transparent);}
.bm9rc-fd-name{font-size:12px;font-weight:800;color:var(--c);}
.bm9rc-mx-note{margin:0;font-size:12px;line-height:1.55;color:var(--bm7-ink-3);}

/* ---------- 自适应 ---------- */
@container bm9rc (max-width: 940px){
  .bm9rc-main{grid-template-columns:minmax(0,1fr);}
  .bm9rc-stage{position:relative;top:auto;order:-1;}
  .bm9rc-insight{grid-template-columns:minmax(0,1fr);}
  .bm9rc-card + .bm9rc-card{border-left:none;border-top:1px solid var(--rc-line);}
  .bm9rc-tools{justify-content:flex-start;}
}
@container bm9rc (max-width: 560px){
  .bm9rc-title{font-size:19px;}
  .bm9rc-leg span{display:none;}
  .bm9rc-legend{gap:4px 12px;}
  .bm9rc-tools{width:100%;}
  .bm9rc-src{width:100%;flex-wrap:wrap;gap:6px;}
  .bm9rc-src-lbl{flex-basis:100%;}
  .bm9rc-src-group{flex:1 1 100%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));overflow:visible;}
  .bm9rc .bm9rc-src-chip{justify-content:center;gap:4px;padding:0 4px;min-width:0;}
  .bm9rc-sync{width:100%;}
  .bm9rc-sync .bm9rc-act{flex:1 1 auto;}
  .bm9rc-prog{max-width:100%;width:100%;}
  .bm9rc-bar{padding:4px 6px 0;}
  .bm9rc-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:100%;overflow:visible;}
  .bm9rc .bm9rc-tab{padding:0 2px;font-size:12.5px;text-align:center;}
  .bm9rc-tab::after{left:6px;right:6px;}
  .bm9rc-filters{padding:10px 10px 6px;}
  .bm9rc-list{padding:2px 4px 0;}
  .bm9rc .bm9rc-row{grid-template-columns:20px 32px minmax(0,1fr) 56px;grid-template-areas:"rank thumb name val" "rank thumb strip strip";row-gap:4px;column-gap:9px;}
  .bm9rc-thumb{width:32px;align-self:start;}
  .bm9rc-rank{align-self:start;padding-top:3px;}
  .bm9rc-shead{grid-template-columns:52px minmax(0,1fr);grid-template-areas:"cover title" "cover big" "chips chips";column-gap:12px;row-gap:6px;padding:14px 14px 10px;}
  .bm9rc-scover{width:52px;}
  .bm9rc-big{flex-direction:row;align-items:baseline;gap:8px;align-self:start;}
  .bm9rc-big b{font-size:30px;}
  .bm9rc-big span{margin-top:0;white-space:normal;}
  .bm9rc-chips span{white-space:normal;}
  .bm9rc-rule{grid-template-columns:40px minmax(0,1fr) 62px;column-gap:6px;padding:0 12px 2px;}
  .bm9rc-rlab span{display:none;}
  .bm9rc-rval b{font-size:15px;}
  .bm9rc-rm,.bm9rc-rover-m{left:12px;right:12px;}
  .bm9rc-rkey{padding:4px 14px 12px;}
  .bm9rc-fact{padding:9px 12px 10px;}
  .bm9rc-acts{padding:12px 12px 14px;}
  .bm9rc .bm9rc-fix{margin-left:0;}
  .bm9rc-bind{padding:0 12px 14px;}
  .bm9rc-bind-grid{grid-template-columns:minmax(0,1fr);}
  .bm9rc-bind-foot p{margin:0;flex-basis:100%;}
  .bm9rc-plot{aspect-ratio:1 / 1;}
  .bm9rc-plotwrap{padding:26px 4px 46px 26px;}
  .bm9rc-pt-tag{max-width:120px;}
  .bm9rc-map{padding:6px 12px 8px;}
  .bm9rc-gcols{grid-template-columns:minmax(0,1fr);gap:8px;}
  .bm9rc-card{padding:14px 14px 16px;}
  .bm9rc-hrow,.bm9rc-haxis{grid-template-columns:44px minmax(0,1fr) 66px;gap:8px;}
  .bm9rc-trow{grid-template-columns:44px minmax(0,1fr) 42px;column-gap:8px;}
  .bm9rc-slab span{display:none;}
}
@media (prefers-reduced-motion: reduce){
  .bm9rc *,.bm9rc *::before,.bm9rc *::after,.bm9rc-mixer *{transition:none !important;animation:none !important;}
}
.bm7-root[data-bm7-motion="off"] .bm9rc *,.bm7-root[data-bm7-motion-tier="off"] .bm9rc *,
.bm7-root[data-bm7-motion="off"] .bm9rc *::before,.bm7-root[data-bm7-motion-tier="off"] .bm9rc *::before,
.bm7-root[data-bm7-motion="off"] .bm9rc *::after,.bm7-root[data-bm7-motion-tier="off"] .bm9rc *::after{transition:none !important;animation:none !important;}
`;

function ensureRatingCompareStyles() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(RATING_COMPARE_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = RATING_COMPARE_STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

/* ============================== 纯函数工具 ============================== */

/** 原生 append 会把 null 写成字面量 "null"，统一过滤空子节点 */
function put(el, ...kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === "") continue;
    el.append(k);
  }
  return el;
}

function signed(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v).toFixed(digits);
  if (Number(abs) === 0) return Number(0).toFixed(digits);
  return `${v > 0 ? "+" : "−"}${abs}`;
}

function nativeTick(sid, v) {
  if (sid === "anilist") return String(Math.round(v * 10));
  if (sid === "filmarks") return String(Number((v / 2).toFixed(1)));
  return String(Math.round(v));
}

function nativeReading(sid, v) {
  if (sid === "anilist") return `${Math.round(v * 10)}%`;
  if (sid === "filmarks") return (v / 2).toFixed(2);
  if (sid === "mal") return v.toFixed(2);
  return v.toFixed(1);
}

function compactNative(sid, s) {
  if (!s || !s.available) return "—";
  if (sid === "filmarks") return s.compactText || (Number(s.rawScore) || 0).toFixed(1);
  return s.displayText;
}

function countShort(sid, s) {
  if (!s || !s.available) return "";
  const n = Number(s.count) || 0;
  if (!n) return sid === "bangumi" && s.rank ? `第 ${s.rank} 名` : "";
  return `${formatCount(n)}人`;
}

function factLine(sid, s) {
  if (!s || !s.available) return "";
  const parts = [];
  if (sid === "bangumi") {
    parts.push(s.displayText);
    if (s.count > 0) parts.push(`${formatCount(s.count)} 人评分`);
    if (s.rank) parts.push(`第 ${s.rank} 名`);
  } else if (sid === "anilist") {
    parts.push(s.displayText);
    if (s.count > 0) parts.push(`${formatCount(s.count)} 人打分`);
    if (s.popularity > 0) parts.push(`${formatCount(s.popularity)} 人加入列表`);
    if (s.favourites > 0) parts.push(`${formatCount(s.favourites)} 人设为最爱`);
  } else if (sid === "mal") {
    parts.push(s.displayText);
    if (s.count > 0) parts.push(`${formatCount(s.count)} 人评分`);
    if (s.rank) parts.push(`第 ${s.rank} 名`);
    if (s.popularity) parts.push(`人气第 ${s.popularity} 位`);
  } else if (sid === "filmarks") {
    parts.push(`${compactNative(sid, s)} / 5`);
    if (s.count > 0) parts.push(`看过 ${formatCount(s.count)}`);
    if (s.clips > 0) parts.push(`想看 ${formatCount(s.clips)}`);
  }
  return parts.join(" · ");
}

function divergenceWord(sigma) {
  if (sigma < 0.25) return "四站一致";
  if (sigma < 0.5) return "略有分歧";
  if (sigma < 0.8) return "分歧明显";
  return "两极分化";
}

function gapSentence(g) {
  if (Math.abs(g) < 0.15) return "中日与欧美看法接近";
  return g > 0 ? `中日比欧美高 ${Math.abs(g).toFixed(2)}` : `欧美比中日高 ${Math.abs(g).toFixed(2)}`;
}

function availabilityText(p) {
  if (p.availableCount >= 4) return "四站齐全";
  if (p.availableCount === 0) return "暂无评分";
  if (p.availableCount === 1) return `仅 ${SITE_NAME[p.availableSites[0]]}`;
  return `${p.availableCount}/4 站有评分`;
}

function normalizeWeights(raw) {
  const out = {};
  let sum = 0;
  for (const sid of CORE) {
    const v = Math.max(0, Number(raw && raw[sid]) || 0);
    out[sid] = v;
    sum += v;
  }
  if (sum <= 0) {
    for (const sid of CORE) out[sid] = 0.25;
    return out;
  }
  for (const sid of CORE) out[sid] = out[sid] / sum;
  return out;
}

function computeWindow(profiles) {
  // 只用四站评分决定刻度范围（个人评分可能是 1～10 的极端值，超出范围时贴边显示）
  let min = Infinity;
  for (const p of profiles) {
    for (const sid of CORE) {
      const s = p.sites[sid];
      if (s && s.available && s.normalized10 !== null) min = Math.min(min, s.normalized10);
    }
  }
  if (!Number.isFinite(min)) return { lo: 5, hi: 10 };
  return { lo: Math.max(0, Math.min(6, Math.floor(min - 0.25))), hi: 10 };
}

/**
 * 排行条专用的放大刻度：去掉最低 8% 的离群值，让大多数作品的四站圆点能拉开距离；
 * 低于下限的圆点贴边显示为空心，提示「实际更低」。
 */
function computeListWindow(profiles, fullWin) {
  const vals = [];
  for (const p of profiles) {
    for (const sid of CORE) {
      const s = p.sites[sid];
      if (s && s.available && s.normalized10 !== null) vals.push(s.normalized10);
    }
  }
  if (vals.length < 6) return fullWin;
  vals.sort((a, b) => a - b);
  const q = vals[Math.floor(vals.length * 0.08)];
  return { lo: Math.max(fullWin.lo, Math.min(7, Math.floor(q - 0.2))), hi: 10 };
}

function coarsePointer() {
  try {
    return Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  } catch (_) {
    return false;
  }
}

function makePct(win) {
  const span = Math.max(0.0001, win.hi - win.lo);
  return (v) => clamp(((Number(v) - win.lo) / span) * 100, 0, 100);
}

function hashOffset(key, spread) {
  let x = 0;
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) x = (x * 33 + s.charCodeAt(i)) >>> 0;
  return ((x % 1000) / 1000 - 0.5) * 2 * spread;
}

function orderProfiles(lens, profiles) {
  const list = profiles.slice();
  if (lens === "split") {
    return list
      .filter((p) => p.divergence !== null)
      .sort((a, b) => b.divergence - a.divergence || (b.spread || 0) - (a.spread || 0));
  }
  if (lens === "mine") {
    return list
      .filter((p) => p.personalScore !== null && p.composite10 !== null && p.personalDeltas && p.personalDeltas.composite !== null)
      .sort((a, b) => Math.abs(b.personalDeltas.composite) - Math.abs(a.personalDeltas.composite));
  }
  return list.sort((a, b) => {
    const av = a.composite10 === null ? -1 : a.composite10;
    const bv = b.composite10 === null ? -1 : b.composite10;
    return bv - av || b.availableCount - a.availableCount;
  });
}

/* ============================== 换算尺组件 ============================== */

function createSlideRule(svc, onCursor) {
  const el = h("div.bm9rc-rule");
  const cells = {};
  CORE.forEach((sid, i) => {
    const row = String(i + 2);
    const ticks = h("div.bm9rc-rticks");
    const hist = h("div.bm9rc-rhist");
    const pinRail = h("div.bm9rc-rail.bm9rc-pinrail.is-off", { style: { "--d": `${i * 55}ms` } }, [h("span.bm9rc-pin")]);
    const na = h("span.bm9rc-rna", { text: "暂无数据" });
    const valB = h("b", { text: "—" });
    const valS = h("span");
    const track = h("div.bm9rc-rtrack", { style: { gridRow: row, "--c": siteColor(sid) } }, [
      h("div.bm9rc-rm", [ticks, hist, pinRail]),
      na
    ]);
    el.append(
      h("div.bm9rc-rlab", { style: { gridRow: row, "--c": siteColor(sid) } }, [
        h("b", { text: SITE_SHORT[sid] }),
        h("span", { text: SITE_REGION[sid] })
      ]),
      track,
      h("div.bm9rc-rval", { style: { gridRow: row } }, [valB, valS])
    );
    cells[sid] = { track, ticks, hist, pinRail, na, valB, valS };
  });

  const pathBox = h("div.bm9rc-rpath");
  pathBox.innerHTML =
    '<svg viewBox="0 0 100 400" preserveAspectRatio="none" aria-hidden="true"><path class="is-glow" d=""/><path class="is-line" d=""/></svg>';
  const paths = Array.from(pathBox.querySelectorAll("path"));
  const compTag = h("span.bm9rc-ctag");
  const compRail = h("div.bm9rc-rail.bm9rc-comprail.is-off", [h("span.bm9rc-cline"), compTag]);
  const meTag = h("span.bm9rc-mtag");
  const meRail = h("div.bm9rc-rail.bm9rc-merail.is-off", [h("span.bm9rc-mline"), meTag]);
  const curChips = CORE.map((sid, i) => h("span.bm9rc-curchip", { style: { "--row": String(i), "--c": siteColor(sid) } }));
  const curRail = h("div.bm9rc-rail.bm9rc-currail", [h("span.bm9rc-curline"), ...curChips]);
  const overM = h("div.bm9rc-rover-m", [pathBox, compRail, meRail, curRail]);
  const over = h("div.bm9rc-rover", {
    attr: { "aria-hidden": "true" },
    title: ""
  }, [overM]);
  el.appendChild(over);

  let win = null;
  let pct = null;
  let primed = false;

  const rebuildTicks = () => {
    const span = win.hi - win.lo;
    const labelStep = span > 6 ? 2 : 1;
    for (const sid of CORE) {
      const t = cells[sid].ticks;
      clear(t);
      for (let k = 0; win.lo + k * 0.5 <= win.hi + 1e-9; k++) {
        const v = win.lo + k * 0.5;
        const major = Math.abs(v - Math.round(v)) < 1e-9;
        t.appendChild(h("i.bm9rc-tk", { cls: major ? "is-major" : "", style: { left: `${pct(v)}%` } }));
        if (major && Math.round(win.hi - v) % labelStep === 0) {
          t.appendChild(h("span.bm9rc-tl", { style: { left: `${pct(v)}%` }, text: nativeTick(sid, v) }));
        }
      }
    }
  };

  const placeRail = (rail, x) => {
    rail.style.transform = `translateX(${x}%)`;
    rail.classList.toggle("is-l", x < 14);
    rail.classList.toggle("is-r", x > 86);
  };

  const paintHist = (histEl, dist) => {
    clear(histEl);
    if (!Array.isArray(dist) || !dist.length) return;
    const max = Math.max(...dist.map((d) => Number(d.amount) || 0));
    if (!max) return;
    for (const d of dist) {
      const v = (Number(d.score) || 0) / 10;
      if (v < win.lo - 0.01 || v > win.hi + 0.01) continue;
      histEl.appendChild(h("i", { style: { left: `${pct(v)}%`, height: `${Math.max(1.5, (d.amount / max) * 15)}px` } }));
    }
  };

  const setPath = (d) => {
    for (const p of paths) {
      p.setAttribute("d", d);
      try {
        p.style.d = d ? `path("${d}")` : "none";
      } catch (_) {}
    }
  };

  const update = (profile, nextWin) => {
    if (!win || win.lo !== nextWin.lo || win.hi !== nextWin.hi) {
      win = { lo: nextWin.lo, hi: nextWin.hi };
      pct = makePct(win);
      rebuildTicks();
    }
    if (!primed) {
      primed = true;
      void el.getBoundingClientRect();
    }
    const pts = [];
    CORE.forEach((sid, i) => {
      const s = profile.sites[sid];
      const c = cells[sid];
      if (s && s.available && s.normalized10 !== null) {
        const x = pct(s.normalized10);
        c.pinRail.style.transform = `translateX(${x}%)`;
        c.pinRail.classList.remove("is-off");
        c.na.classList.add("is-hidden");
        c.track.classList.remove("is-na");
        c.valB.textContent = compactNative(sid, s);
        c.valS.textContent = countShort(sid, s);
        pts.push(`${x.toFixed(2)} ${(i * 100 + (20 / 46) * 100).toFixed(2)}`);
      } else {
        c.pinRail.classList.add("is-off");
        c.na.classList.remove("is-hidden");
        c.track.classList.add("is-na");
        c.valB.textContent = "—";
        c.valS.textContent = "";
      }
      if (sid === "anilist") paintHist(c.hist, s ? s.distribution : []);
    });
    setPath(pts.length >= 2 ? `M ${pts.join(" L ")}` : "");

    if (profile.composite10 !== null && profile.availableCount >= 2) {
      placeRail(compRail, pct(profile.composite10));
      compTag.textContent = `综合 ${profile.composite10.toFixed(2)}`;
      compRail.classList.remove("is-off");
    } else {
      compRail.classList.add("is-off");
    }
    if (profile.personalScore !== null && profile.personalScore > 0) {
      placeRail(meRail, pct(profile.personalScore));
      meTag.textContent = `我 ${Number(profile.personalScore).toFixed(1).replace(/\.0$/, "")}`;
      meRail.classList.remove("is-off");
    } else {
      meRail.classList.add("is-off");
    }
  };

  // 游标：悬停（鼠标）或左右拖动（触屏）时，同一位置同时读出四站对应分数
  let dragging = false;
  let hideTimer = 0;
  const showAt = (clientX) => {
    if (!win) return;
    const r = overM.getBoundingClientRect();
    if (!r.width) return;
    const x = clamp((clientX - r.left) / r.width, 0, 1);
    const v = win.lo + x * (win.hi - win.lo);
    curRail.style.transform = `translateX(${x * 100}%)`;
    curRail.classList.add("is-on");
    curRail.classList.toggle("is-flip", x > 0.7);
    CORE.forEach((sid, i) => {
      curChips[i].textContent = nativeReading(sid, v);
    });
    if (typeof onCursor === "function") onCursor(v);
  };
  const hide = () => {
    curRail.classList.remove("is-on");
    if (typeof onCursor === "function") onCursor(null);
  };
  over.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || dragging) showAt(e.clientX);
  });
  over.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !dragging) hide();
  });
  over.addEventListener("pointerdown", (e) => {
    dragging = true;
    if (hideTimer) clearTimeout(hideTimer);
    try {
      over.setPointerCapture(e.pointerId);
    } catch (_) {}
    showAt(e.clientX);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.pointerType !== "mouse") {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 1600);
    }
  };
  over.addEventListener("pointerup", endDrag);
  over.addEventListener("pointercancel", (e) => {
    dragging = false;
    hide();
    void e;
  });

  return { el, update };
}

/* ============================== 主入口 ============================== */

function renderRatingCompareWorkspace(container, ctx = {}) {
  if (!container) return;
  ensureRatingCompareStyles();
  const plugin = ctx.plugin;
  const svc = ctx.service || multiSiteRatingService;
  const items = Array.isArray(ctx.items) ? ctx.items : [];
  const getCover = typeof ctx.getCover === "function" ? ctx.getCover : () => "";
  const openNote = typeof ctx.openNote === "function" ? ctx.openNote : () => {};
  const openExternal =
    typeof ctx.openExternal === "function"
      ? ctx.openExternal
      : (u) => {
          try {
            window.open(u, "_blank");
          } catch (_) {}
        };
  const notifyBadges = (src) => {
    if (typeof ctx.onPreferredSourceChanged !== "function") return;
    try {
      ctx.onPreferredSourceChanged(src || svc.getPreferredRatingSource(plugin));
    } catch (_) {}
  };
  const motionOn = () => motionEnabled(container);

  if (!container._bm9RcV9State) {
    container._bm9RcV9State = {
      lens: "rank",
      search: "",
      onlySynced: false,
      selectedKey: "",
      bindOpenKey: "",
      bindDraft: {},
      syncingOneKey: "",
      limit: 60,
      draftWeights: null,
      batchHere: false,
      lastFinishedAt: 0
    };
  }
  const st = container._bm9RcV9State;
  if (!LENSES.some((l) => l.id === st.lens)) st.lens = "rank";
  st.draftWeights = null;
  let pendingFocusScroll = false;
  if (ctx.focusItem) {
    st.selectedKey = svc.getAnimeRatingCacheKey(ctx.focusItem);
    if (st.lens === "gap") st.lens = "rank";
    st.search = "";
    pendingFocusScroll = true;
  }

  if (container._bm9RcUnsub) {
    try {
      container._bm9RcUnsub();
    } catch (_) {}
    container._bm9RcUnsub = null;
  }
  const token = {};
  container._bm9RcToken = token;
  const alive = () => container._bm9RcToken === token;

  /* ---------- 骨架 ---------- */
  clear(container);
  const root = h("div.bm9rc");
  const headEl = h("header.bm9rc-head");
  const boardEl = h("section.bm9rc-board", { attr: { "aria-label": "作品列表" } });
  const stageEl = h("section.bm9rc-stage", { attr: { "aria-label": "四站评分详情" } });
  const insightEl = h("section.bm9rc-insight", { attr: { "aria-label": "四站给分习惯与口味契合" } });
  root.append(headEl, h("div.bm9rc-main", [boardEl, stageEl]), insightEl);
  container.appendChild(root);

  /* ---------- 数据模型 ---------- */
  let model = null;
  const computeModel = () => {
    const weights = st.draftWeights ? normalizeWeights(st.draftWeights) : svc.getCompositeWeights(plugin);
    const analytics = svc.computeLibraryRatingAnalytics(plugin, items, weights);
    const seen = new Set();
    const profiles = [];
    for (const p of analytics.profiles) {
      if (!p || !p.cacheKey || seen.has(p.cacheKey)) continue;
      seen.add(p.cacheKey);
      profiles.push(p);
    }
    const win = computeWindow(profiles);
    model = {
      analytics,
      weights,
      profiles,
      byKey: new Map(profiles.map((p) => [p.cacheKey, p])),
      win,
      listWin: computeListWindow(profiles, win)
    };
  };
  const ensureSelection = () => {
    if (st.selectedKey && model.byKey.has(st.selectedKey)) return;
    const first = orderProfiles("rank", model.profiles)[0];
    st.selectedKey = first ? first.cacheKey : "";
  };
  const getFiltered = () => {
    let list = model.profiles;
    if (st.onlySynced) list = list.filter((p) => p.hasExternalSync);
    const q = st.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          String(p.item.name || "").toLowerCase().includes(q) ||
          String(p.item.japaneseName || "").toLowerCase().includes(q)
      );
    }
    return list;
  };

  /* ---------- 刷新调度（rAF 合并） ---------- */
  let rafId = 0;
  let pending = {};
  const schedule = (parts) => {
    Object.assign(pending, parts);
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const p = pending;
      pending = {};
      if (!alive()) return;
      computeModel();
      ensureSelection();
      if (p.all || p.header) renderHeader();
      if (p.all || p.board || p.weights) renderBoard(Boolean(p.weights && !p.all && !p.board));
      if (p.all || p.stage || p.weights) renderStage();
      if (p.all || p.insight) renderInsights();
    });
  };

  /* ---------- 同步 ---------- */
  const startBatch = (scope) => {
    st.batchHere = true;
    Promise.resolve(svc.startBatchMultiSiteSync(plugin, items, { scope }))
      .then((res) => {
        if (res && res.ok === false && res.reason === "already_running") {
          new Notice("已有一个同步任务在进行中", 2200);
        } else if (res && res.ok && res.status && res.status.total === 0) {
          new Notice(scope === "watching" ? "在看和想看的作品 7 天内都同步过了" : "所有作品都已经有外站评分了", 2800);
        }
      })
      .catch(() => {});
  };

  const syncOne = async (p) => {
    if (st.syncingOneKey) return;
    st.syncingOneKey = p.cacheKey;
    renderStage();
    try {
      await svc.fetchMultiSiteRatingForItem(plugin, p.item, { force: true });
      notifyBadges();
      if (alive()) {
        computeModel();
        const np = model.byKey.get(p.cacheKey);
        new Notice(`《${p.item.name}》已更新：${np ? np.availableCount : 0}/4 个站有评分`, 2600);
      }
    } catch (e) {
      new Notice(`拉取失败：${(e && e.message) || e}`, 3200);
    } finally {
      st.syncingOneKey = "";
      if (alive()) schedule({ all: true });
    }
  };

  const saveBinding = async (p, draft) => {
    if (st.syncingOneKey) return;
    st.syncingOneKey = p.cacheKey;
    renderStage();
    try {
      await svc.applyManualSiteBinding(plugin, p.item, {
        anilist: draft.anilist,
        mal: draft.mal,
        filmarks: draft.filmarks
      });
      st.bindOpenKey = "";
      delete st.bindDraft[p.cacheKey];
      notifyBadges();
      new Notice("已按你指定的链接重新拉取四站评分", 2600);
    } catch (e) {
      new Notice(`保存失败：${(e && e.message) || e}`, 3200);
    } finally {
      st.syncingOneKey = "";
      if (alive()) schedule({ all: true });
    }
  };

  /* ---------- 选择 ---------- */
  const rowCache = new Map();
  const maybeScrollStage = () => {
    try {
      const sticky = getComputedStyle(stageEl).position === "sticky";
      const r = stageEl.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const behavior = motionOn() ? "smooth" : "auto";
      if (sticky) {
        if (r.top < -20 || r.top > vh * 0.6) stageEl.scrollIntoView({ block: "nearest", behavior });
      } else if (r.top < -20 || r.top > vh * 0.45) {
        stageEl.scrollIntoView({ block: "start", behavior });
      }
    } catch (_) {}
  };
  const select = (key, opts = {}) => {
    if (!model.byKey.has(key)) return;
    if (st.bindOpenKey && st.bindOpenKey !== key) st.bindOpenKey = "";
    st.selectedKey = key;
    rowCache.forEach((r, k) => {
      r.el.classList.toggle("is-sel", k === key);
      r.el.setAttribute("aria-pressed", k === key ? "true" : "false");
    });
    if (st.lens === "gap") renderBoard(false);
    renderStage();
    if (opts.scroll) maybeScrollStage();
  };

  /* ============================== 顶部 ============================== */
  const renderHeader = () => {
    clear(headEl);
    const a = model.analytics;
    const sync = svc.getMultiSiteSyncStatus();
    const pref = svc.getPreferredRatingSource(plugin);
    const lastSync = model.profiles.reduce((m, p) => Math.max(m, p.syncedAt || 0), 0);

    const titles = h("div.bm9rc-titles", [
      h("h2.bm9rc-title", { text: "四站评分对比" }),
      h("p.bm9rc-facts", [
        h("span", ["共 ", h("b", { text: String(model.profiles.length) }), " 部"]),
        h("span", ["外站已同步 ", h("b", { text: String(a.syncedCount) })]),
        h("span", ["四站齐全 ", h("b", { text: String(a.fullQuartetCount) })]),
        h("span", { text: lastSync ? `上次同步 ${formatRelative(lastSync)}` : "还没有同步过外站评分" })
      ]),
      h(
        "div.bm9rc-legend",
        CORE.map((sid) =>
          h("span.bm9rc-leg", { style: { "--c": siteColor(sid) }, title: svc.RATING_SOURCES[sid].desc }, [
            h("i"),
            h("b", { text: SITE_NAME[sid] }),
            h("span", { text: `${SITE_REGION[sid]} · ${SITE_SCALE[sid]}` })
          ])
        )
      )
    ]);

    const srcGroup = h("div.bm9rc-src-group", { attr: { role: "radiogroup", "aria-label": "封面角标显示哪个站的评分" } });
    for (const id of svc.DISPLAY_SOURCE_IDS) {
      const on = id === pref;
      const meta = svc.RATING_SOURCES[id];
      srcGroup.appendChild(
        h(
          "button.bm9rc-b.bm9rc-src-chip",
          {
            cls: on ? "is-on" : "",
            style: { "--c": id === "composite" ? "var(--bm7-ink)" : siteColor(id) },
            title: `封面角标显示${meta.label}评分：${meta.desc}`,
            attr: { type: "button", role: "radio", "aria-checked": on ? "true" : "false" },
            on: {
              click: async () => {
                if (id === svc.getPreferredRatingSource(plugin)) return;
                await svc.setPreferredRatingSource(plugin, id);
                notifyBadges(id);
                if (!alive()) return;
                renderHeader();
                new Notice(`追番、全部番剧和 3D 展厅的封面角标已改为 ${meta.label} 评分`, 2600);
              }
            }
          },
          [h("i"), h("span", { text: meta.shortLabel })]
        )
      );
    }
    const srcEl = h("div.bm9rc-src", [h("span.bm9rc-src-lbl", { text: "封面角标" }), srcGroup]);

    let syncEl;
    if (sync.running) {
      const ratio = sync.total ? sync.completed / sync.total : 0;
      syncEl = h("div.bm9rc-prog", { style: { "--p": String(ratio) } }, [
        h("span.bm9rc-prog-fill"),
        h("span.bm9rc-prog-txt", {
          text: sync.cancelRequested
            ? "正在停止…"
            : `正在同步《${sync.currentName || "…"}》 ${sync.completed}/${sync.total}`
        }),
        h(
          "button.bm9rc-b.bm9rc-act.is-small",
          {
            attr: { type: "button", disabled: sync.cancelRequested },
            on: { click: () => svc.cancelMultiSiteSync() }
          },
          [icon("pause", 12), h("span", { text: "停止" })]
        )
      ]);
    } else {
      syncEl = h("div.bm9rc-sync", [
        h(
          "button.bm9rc-b.bm9rc-act.is-solid",
          {
            title: "拉取所有「在看」「想看」作品的 AniList、MyAnimeList、Filmarks 评分（7 天内同步过的会跳过）",
            attr: { type: "button" },
            on: { click: () => startBatch("watching") }
          },
          [icon("refresh", 14), h("span", { text: "同步在看/想看" })]
        ),
        h(
          "button.bm9rc-b.bm9rc-act",
          {
            title: "给还没有任何外站评分的作品补拉一次",
            attr: { type: "button" },
            on: { click: () => startBatch("missing") }
          },
          [h("span", { text: "补齐未同步" })]
        )
      ]);
    }
    headEl.append(titles, h("div.bm9rc-tools", [srcEl, syncEl]));
  };

  /* ============================== 排行板 ============================== */
  const tabBtns = {};
  const tabsEl = h("div.bm9rc-tabs", { attr: { role: "tablist", "aria-label": "对比视角" } });
  for (const L of LENSES) {
    const b = h(
      "button.bm9rc-b.bm9rc-tab",
      {
        title: L.title,
        attr: { type: "button", role: "tab" },
        on: {
          click: () => {
            if (st.lens === L.id) return;
            st.lens = L.id;
            st.limit = 60;
            renderBoard(false);
          }
        }
      },
      [h("span", { text: L.label })]
    );
    tabBtns[L.id] = b;
    tabsEl.appendChild(b);
  }
  const searchInput = h("input", {
    attr: { type: "search", placeholder: "搜索番名或日文原名", "aria-label": "搜索作品", spellcheck: "false" },
    on: {
      input: (e) => {
        st.search = e.target.value;
        st.limit = 60;
        renderBoard(false);
      }
    }
  });
  searchInput.value = st.search;
  const syncedChip = h(
    "button.bm9rc-b.bm9rc-chip",
    {
      title: "只显示已经拉到外站评分的作品",
      attr: { type: "button" },
      on: {
        click: () => {
          st.onlySynced = !st.onlySynced;
          st.limit = 60;
          renderBoard(false);
        }
      }
    },
    [icon("check", 13), h("span", { text: "只看已同步" })]
  );
  const weightBtn = h("button.bm9rc-b.bm9rc-chip", {
    title: "调整综合分里四个站各占多少",
    attr: { type: "button", "aria-haspopup": "dialog" },
    on: { click: () => openMixer(weightBtn) }
  });
  const listEl = h("div.bm9rc-list");
  const moreEl = h("div.bm9rc-more");
  const mapEl = h("div.bm9rc-map");
  const boardEmpty = h("div.bm9rc-empty");
  boardEl.append(
    h("div.bm9rc-bar", [tabsEl]),
    h("div.bm9rc-filters", [h("label.bm9rc-search", [icon("search", 14), searchInput]), syncedChip, weightBtn]),
    listEl,
    moreEl,
    mapEl,
    boardEmpty
  );

  const paintWeightChip = () => {
    clear(weightBtn);
    weightBtn.append(
      h(
        "span.bm9rc-wbar",
        CORE.map((sid) =>
          h("i", { style: { "--c": siteColor(sid), flexGrow: String(Math.max(0.0001, model.weights[sid] || 0)) } })
        )
      ),
      h("span", { text: "权重" })
    );
  };

  const paintStrip = (stripEl, p, lens) => {
    clear(stripEl);
    const lw = model.listWin;
    const pct = makePct(lw);
    const m = h("span.bm9rc-strip-m");
    m.appendChild(h("span.bm9rc-strip-base"));
    for (let v = Math.ceil(lw.lo); v <= lw.hi; v++) {
      m.appendChild(h("span.bm9rc-strip-tick", { style: { left: `${pct(v)}%` } }));
    }
    const vals = p.availableSites.map((sid) => p.sites[sid].normalized10);
    if (vals.length >= 2) {
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      m.appendChild(h("span.bm9rc-strip-range", { style: { left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` } }));
    }
    if (p.composite10 !== null && p.availableCount >= 2) {
      m.appendChild(h("span.bm9rc-comp", { style: { left: `${pct(p.composite10)}%` } }));
    }
    for (const sid of CORE) {
      const s = p.sites[sid];
      if (!s.available || s.normalized10 === null) continue;
      m.appendChild(
        h("span.bm9rc-dot", {
          cls: s.normalized10 < lw.lo ? "is-clamp" : "",
          style: { left: `${pct(s.normalized10)}%`, "--c": siteColor(sid) },
          title: `${SITE_NAME[sid]} ${s.displayText}${s.normalized10 < lw.lo ? "（低于刻度下限，贴边显示）" : ""}`
        })
      );
    }
    if (lens === "mine" && p.personalScore !== null && p.composite10 !== null) {
      const a = pct(p.personalScore);
      const b = pct(p.composite10);
      m.appendChild(h("span.bm9rc-melink", { style: { left: `${Math.min(a, b)}%`, width: `${Math.abs(a - b)}%` } }));
      m.appendChild(h("span.bm9rc-me", { style: { left: `${a}%` }, title: `我的评分 ${p.personalScore}` }));
    }
    stripEl.appendChild(m);
  };

  const metaFor = (p, lens) => {
    if (lens === "split" && p.highestSite && p.lowestSite) {
      return `${SITE_SHORT[p.highestSite]} 最高 · ${SITE_SHORT[p.lowestSite]} 最低 · 相差 ${Number(p.spread || 0).toFixed(1)}`;
    }
    if (lens === "mine" && p.personalScore !== null && p.composite10 !== null) {
      return `我 ${Number(p.personalScore).toFixed(1).replace(/\.0$/, "")} · 综合 ${p.composite10.toFixed(2)}`;
    }
    const when = [p.item.year, p.item.season].filter(Boolean).join(" ");
    return [`${p.availableCount}/4 站`, when].filter(Boolean).join(" · ");
  };

  const getRow = (p) => {
    let r = rowCache.get(p.cacheKey);
    if (r) return r;
    const key = p.cacheKey;
    const el = h("button.bm9rc-b.bm9rc-row", {
      attr: { type: "button" },
      on: { click: () => select(key, { scroll: true }) }
    });
    const rankEl = h("span.bm9rc-rank");
    const nameB = h("b");
    const metaS = h("span");
    const stripEl = h("span.bm9rc-strip");
    const valB = h("b");
    const valS = h("span");
    const valEl = h("span.bm9rc-val", [valB, valS]);
    el.append(
      rankEl,
      h("span.bm9rc-thumb", [coverEl(getCover(p.item), p.item.name)]),
      h("span.bm9rc-name", [nameB, metaS]),
      stripEl,
      valEl
    );
    r = {
      el,
      update(prof, index, lens) {
        const sel = prof.cacheKey === st.selectedKey;
        el.classList.toggle("is-sel", sel);
        el.classList.toggle("is-top", index < 3);
        el.setAttribute("aria-pressed", sel ? "true" : "false");
        el.title = prof.item.name || "";
        rankEl.textContent = String(index + 1);
        nameB.textContent = prof.item.name || "未命名";
        metaS.textContent = metaFor(prof, lens);
        paintStrip(stripEl, prof, lens);
        valEl.classList.remove("is-pos", "is-neg");
        if (lens === "split") {
          valB.textContent = prof.divergence !== null ? prof.divergence.toFixed(2) : "—";
          valS.textContent = "分歧 σ";
        } else if (lens === "mine") {
          const d = prof.personalDeltas.composite;
          valB.textContent = signed(d, 1);
          valS.textContent = d > 0.04 ? "比综合高" : d < -0.04 ? "比综合低" : "基本一致";
          if (d > 0.04) valEl.classList.add("is-pos");
          else if (d < -0.04) valEl.classList.add("is-neg");
        } else {
          valB.textContent = prof.composite10 !== null ? prof.composite10.toFixed(2) : "—";
          valS.textContent =
            prof.availableCount >= 2 ? "综合" : prof.availableCount === 1 ? `仅 ${SITE_SHORT[prof.availableSites[0]]}` : "无数据";
        }
      }
    };
    rowCache.set(key, r);
    return r;
  };

  const flipReorder = (els) => {
    const animate = motionOn() && listEl.offsetParent !== null && typeof Element.prototype.animate === "function";
    const first = new Map();
    if (animate) {
      for (const el of listEl.children) first.set(el, el.getBoundingClientRect().top);
      for (const el of listEl.children) {
        if (typeof el.getAnimations === "function") el.getAnimations().forEach((an) => an.cancel());
      }
    }
    const keep = new Set(els);
    for (const el of Array.from(listEl.children)) if (!keep.has(el)) el.remove();
    els.forEach((el) => listEl.appendChild(el));
    if (!animate) return;
    let entering = 0;
    const vh = window.innerHeight || 900;
    for (const el of els) {
      const top = el.getBoundingClientRect().top;
      if (top > vh + 200 && !first.has(el)) continue;
      const f = first.get(el);
      if (f === undefined) {
        el.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" }
          ],
          { duration: 280, delay: Math.min(entering++, 14) * 18, easing: "cubic-bezier(.22,.8,.24,1)", fill: "backwards" }
        );
        continue;
      }
      const dy = f - top;
      if (Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: 420,
        easing: "cubic-bezier(.22,.8,.24,1)"
      });
    }
  };

  let lastListAt = 0;
  let listTimer = 0;
  const renderBoard = (fromWeights) => {
    for (const L of LENSES) {
      const on = st.lens === L.id;
      tabBtns[L.id].classList.toggle("is-on", on);
      tabBtns[L.id].setAttribute("aria-selected", on ? "true" : "false");
    }
    syncedChip.classList.toggle("is-on", st.onlySynced);
    syncedChip.setAttribute("aria-pressed", st.onlySynced ? "true" : "false");
    paintWeightChip();

    if (fromWeights) {
      if (st.lens === "gap" || st.lens === "split") return;
      const now = performance.now();
      if (now - lastListAt < 150) {
        if (!listTimer) {
          listTimer = setTimeout(() => {
            listTimer = 0;
            if (alive()) renderBoard(true);
          }, 150 - (now - lastListAt));
        }
        return;
      }
    }
    lastListAt = performance.now();

    const filtered = getFiltered();
    clear(boardEmpty);
    boardEmpty.style.display = "none";
    if (st.lens === "gap") {
      listEl.style.display = "none";
      moreEl.style.display = "none";
      mapEl.style.display = "";
      renderMap(filtered);
      return;
    }
    mapEl.style.display = "none";
    listEl.style.display = "";
    const ordered = orderProfiles(st.lens, filtered);
    if (!ordered.length) {
      flipReorder([]);
      moreEl.style.display = "none";
      boardEmpty.style.display = "";
      let msg = "还没有收录动画。";
      if (st.search.trim()) msg = `没有找到「${st.search.trim()}」相关的作品`;
      else if (st.lens === "split") msg = "至少要有两个站都有评分，才能比较分歧。先同步一下外站评分吧。";
      else if (st.lens === "mine") msg = "还没有可以比较的个人评分。给作品打过分、并且有综合分以后，这里会列出你和大家看法差得最多的作品。";
      else if (st.onlySynced) msg = "还没有作品拉到外站评分。";
      boardEmpty.appendChild(h("span", { text: msg }));
      if (!st.search.trim() && (st.lens === "split" || st.onlySynced) && model.analytics.syncedCount === 0) {
        boardEmpty.appendChild(
          h(
            "button.bm9rc-b.bm9rc-act.is-solid",
            { attr: { type: "button" }, on: { click: () => startBatch("watching") } },
            [icon("refresh", 14), h("span", { text: "同步在看/想看" })]
          )
        );
      }
      return;
    }
    const shown = ordered.slice(0, st.limit);
    const els = shown.map((p, i) => {
      const r = getRow(p);
      r.update(p, i, st.lens);
      return r.el;
    });
    flipReorder(els);
    clear(moreEl);
    const rest = ordered.length - shown.length;
    if (rest > 0) {
      moreEl.style.display = "";
      moreEl.appendChild(
        h("button.bm9rc-b.bm9rc-morebtn", {
          attr: { type: "button" },
          text: `再显示 ${Math.min(60, rest)} 部（还有 ${rest} 部）`,
          on: {
            click: () => {
              st.limit += 60;
              renderBoard(false);
            }
          }
        })
      );
    } else {
      moreEl.style.display = "none";
    }
  };

  const renderMap = (filtered) => {
    clear(mapEl);
    const pts = filtered.filter((p) => p.eastAvg !== null && p.westAvg !== null && p.eastWestGap !== null);
    if (!pts.length) {
      mapEl.appendChild(
        h("div.bm9rc-empty-in", [
          h("span", {
            text: "同一部作品要同时有中日站（Bangumi 或 Filmarks）和欧美站（AniList 或 MyAnimeList）的评分，才能画进温差图。"
          }),
          model.analytics.syncedCount === 0
            ? h(
                "button.bm9rc-b.bm9rc-act.is-solid",
                { attr: { type: "button" }, on: { click: () => startBatch("watching") } },
                [icon("refresh", 14), h("span", { text: "同步在看/想看" })]
              )
            : null
        ])
      );
      return;
    }
    // 「扣除各站给分习惯」：先减去每个站在你馆藏里的平均分，再加回四站总均分，
    // 这样 Filmarks 5 分制普遍偏低之类的整体尺度差不会把所有作品都推向一边。
    const cal = Boolean(st.calibrate);
    const means = {};
    const usable = CORE.filter((sid) => model.analytics.siteStats[sid].count >= 3 && model.analytics.siteStats[sid].mean10 !== null);
    for (const sid of usable) means[sid] = model.analytics.siteStats[sid].mean10;
    const grand = usable.length ? usable.reduce((acc, sid) => acc + means[sid], 0) / usable.length : 0;
    const sideAvg = (p, ids) => {
      const vals = ids
        .filter((sid) => p.sites[sid].available && p.sites[sid].normalized10 !== null && (!cal || means[sid] !== undefined))
        .map((sid) => (cal ? p.sites[sid].normalized10 - means[sid] + grand : p.sites[sid].normalized10));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const rows = pts
      .map((p) => {
        const e = sideAvg(p, ["bangumi", "filmarks"]);
        const w = sideAvg(p, ["anilist", "mal"]);
        return e === null || w === null ? null : { p, e, w, g: e - w };
      })
      .filter(Boolean);
    const pct = makePct(model.win);
    const { lo, hi } = model.win;
    const avgGap = rows.length ? rows.reduce((acc, r) => acc + r.g, 0) / rows.length : 0;
    const calBtn = h(
      "button.bm9rc-b.bm9rc-chip",
      {
        cls: cal ? "is-on" : "",
        title: "先减去每个站在你馆藏里的平均分，只比较这部作品在各站里相对的口碑",
        attr: { type: "button", "aria-pressed": cal ? "true" : "false" },
        on: {
          click: () => {
            st.calibrate = !st.calibrate;
            renderBoard(false);
          }
        }
      },
      [icon("check", 13), h("span", { text: "扣除各站给分习惯" })]
    );
    mapEl.appendChild(
      h("div.bm9rc-map-head", [
        h("p.bm9rc-map-cap", [
          `${rows.length} 部作品可以比较，平均温差 `,
          h("b", { text: signed(avgGap) }),
          avgGap > 0.1 ? "（中日两站给分略高）。" : avgGap < -0.1 ? "（欧美两站给分略高）。" : "（两边几乎一样）。",
          cal
            ? "已扣除各站整体给分高低，比的是作品在各站里的相对口碑。"
            : "落在虚线上表示两边看法一致，离得越远差得越多。"
        ]),
        calBtn
      ])
    );

    let grid = "";
    for (let v = Math.ceil(lo); v <= hi; v++) {
      const x = pct(v).toFixed(2);
      const y = (100 - pct(v)).toFixed(2);
      grid += `<line class="bm9rc-gridline" x1="${x}" y1="0" x2="${x}" y2="100"/><line class="bm9rc-gridline" x1="0" y1="${y}" x2="100" y2="${y}"/>`;
    }
    const bg = h("div");
    bg.innerHTML =
      `<svg class="bm9rc-plot-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
      `<polygon class="bm9rc-zone-east" points="0,100 100,100 100,0"/>` +
      `<polygon class="bm9rc-zone-west" points="0,100 0,0 100,0"/>` +
      grid +
      `<line class="bm9rc-diag" x1="0" y1="100" x2="100" y2="0"/></svg>`;
    const plot = h("div.bm9rc-plot", [bg.firstElementChild]);
    for (let v = Math.ceil(lo); v <= hi; v++) {
      plot.appendChild(h("span.bm9rc-ax-x", { style: { left: `${pct(v)}%` }, text: String(v) }));
      plot.appendChild(h("span.bm9rc-ax-y", { style: { top: `${100 - pct(v)}%` }, text: String(v) }));
    }
    plot.append(
      h("span.bm9rc-zone.is-east", { text: "中日给分更高" }),
      h("span.bm9rc-zone.is-west", { text: "欧美给分更高" }),
      h("span.bm9rc-axt.is-x", { text: "中日均分（Bangumi + Filmarks）→" }),
      h("span.bm9rc-axt.is-y", { text: "↑ 欧美均分（AniList + MAL）" })
    );
    const ordered = rows
      .slice()
      .sort((a, b) => (a.p.cacheKey === st.selectedKey ? 1 : 0) - (b.p.cacheKey === st.selectedKey ? 1 : 0));
    ordered.forEach((r, i) => {
      const { p, g } = r;
      const sel = p.cacheKey === st.selectedKey;
      const x = pct(r.e);
      plot.appendChild(
        h(
          "button.bm9rc-b.bm9rc-pt",
          {
            cls: [g > 0.25 ? "is-east" : g < -0.25 ? "is-west" : "", sel ? "is-sel" : "", x > 58 ? "is-flip" : ""]
              .filter(Boolean)
              .join(" "),
            style: { left: `${x}%`, top: `${100 - pct(r.w)}%`, "--i": String(Math.min(i, 40)) },
            title: `${p.item.name}\n中日均分 ${r.e.toFixed(2)} · 欧美均分 ${r.w.toFixed(2)} · 温差 ${signed(g)}${cal ? "（已扣除各站习惯）" : ""}`,
            attr: { type: "button", "aria-label": p.item.name },
            on: { click: () => select(p.cacheKey, { scroll: true }) }
          },
          sel ? [coverEl(getCover(p.item), p.item.name), h("span.bm9rc-pt-tag", { text: p.item.name })] : null
        )
      );
    });
    mapEl.appendChild(h("div.bm9rc-plotwrap", [plot]));

    const col = (title, colorVar, list) =>
      h("div.bm9rc-gcol", { style: { "--k": colorVar } }, [
        h("h4", { text: title }),
        list.length
          ? list.map((r) =>
              h(
                "button.bm9rc-b.bm9rc-grow",
                { attr: { type: "button" }, title: r.p.item.name, on: { click: () => select(r.p.cacheKey, { scroll: true }) } },
                [h("span", { text: r.p.item.name }), h("b", { text: signed(r.g) })]
              )
            )
          : h("div.bm9rc-gnone", { text: cal ? "扣除习惯后，暂时没有明显偏向这边的作品" : "暂时没有明显偏向这边的作品" })
      ]);
    const east = rows.filter((r) => r.g > 0.25).sort((a, b) => b.g - a.g).slice(0, 5);
    const west = rows.filter((r) => r.g < -0.25).sort((a, b) => a.g - b.g).slice(0, 5);
    mapEl.appendChild(
      h("div.bm9rc-gcols", [col("中日给分更高", "var(--rc-east)", east), col("欧美给分更高", "var(--rc-west)", west)])
    );
  };

  /* ============================== 换算尺舞台 ============================== */
  const sHead = h("div.bm9rc-shead");
  const rule = createSlideRule(svc);
  const ruleKey = h("div.bm9rc-rkey");
  const factsEl = h("div.bm9rc-facts4");
  const actsEl = h("div.bm9rc-acts");
  const bindEl = h("div.bm9rc-bind");
  const stageEmpty = h("div.bm9rc-empty-in");
  stageEl.append(sHead, rule.el, ruleKey, factsEl, actsEl, bindEl, stageEmpty);
  let headKey = "";
  let headRefs = null;

  const paintHead = (p) => {
    if (headKey !== p.cacheKey || !headRefs) {
      clear(sHead);
      const url = getCover(p.item);
      const bigB = h("b");
      const bigS = h("span");
      const chipsEl = h("div.bm9rc-chips");
      const jp = p.item.japaneseName && p.item.japaneseName !== p.item.name ? p.item.japaneseName : "";
      sHead.append(
        h("div.bm9rc-scover", [coverEl(url, p.item.name)]),
        h("div.bm9rc-stitle", [h("h3", { text: p.item.name || "未命名", title: p.item.name || "" }), jp ? h("p", { text: jp, title: jp }) : null]),
        h("div.bm9rc-big", [bigB, bigS]),
        chipsEl
      );
      headRefs = { bigB, bigS, chipsEl };
      headKey = p.cacheKey;
      applyAmbient(sHead, url, p.item.name);
      if (motionOn() && typeof sHead.animate === "function") {
        sHead.animate(
          [
            { opacity: 0.35, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" }
          ],
          { duration: 280, easing: "cubic-bezier(.22,.8,.24,1)" }
        );
      }
    }
    headRefs.bigB.textContent = p.composite10 !== null ? p.composite10.toFixed(2) : "—";
    headRefs.bigS.textContent = p.availableCount >= 2 ? "综合分 · 按当前权重" : "综合分（需两站以上）";
    clear(headRefs.chipsEl);
    const chips = [availabilityText(p)];
    if (p.divergence !== null) chips.push(`分歧 σ ${p.divergence.toFixed(2)} · ${divergenceWord(p.divergence)}`);
    if (p.eastWestGap !== null) chips.push(gapSentence(p.eastWestGap));
    chips.push(p.syncedAt ? `${formatRelative(p.syncedAt)}同步` : "未同步外站");
    for (const c of chips) headRefs.chipsEl.appendChild(h("span", { text: c }));
  };

  const paintFacts = (p) => {
    clear(factsEl);
    for (const sid of CORE) {
      const s = p.sites[sid];
      const line = factLine(sid, s);
      factsEl.appendChild(
        h("div.bm9rc-fact", { style: { "--c": siteColor(sid) } }, [
          h("div.bm9rc-fact-h", [
            h("i"),
            h("b", { text: SITE_NAME[sid] }),
            h("span", { text: SITE_REGION[sid] }),
            s.url
              ? h(
                  "button.bm9rc-b.bm9rc-ext",
                  {
                    title: `在 ${SITE_NAME[sid]} 打开这部作品 ↗`,
                    attr: { type: "button", "aria-label": `在 ${SITE_NAME[sid]} 打开` },
                    on: { click: () => openExternal(s.url) }
                  },
                  [icon("external", 13)]
                )
              : null
          ]),
          h("div.bm9rc-fact-v", { cls: line ? "" : "is-none", text: line || "还没拉到这个站的数据" }),
          sid === "filmarks" && s.available && s.matchedTitle
            ? h("div.bm9rc-fact-m", { title: s.matchedTitle, text: `匹配到：${s.matchedTitle}` })
            : null
        ])
      );
    }
  };

  const paintActs = (p) => {
    clear(actsEl);
    const busy = st.syncingOneKey === p.cacheKey;
    const open = st.bindOpenKey === p.cacheKey;
    put(
      actsEl,
      h(
        "button.bm9rc-b.bm9rc-act.is-solid",
        {
          cls: busy ? "is-busy" : "",
          attr: { type: "button", disabled: busy || Boolean(st.syncingOneKey) },
          on: { click: () => syncOne(p) }
        },
        [icon("refresh", 14), h("span", { text: busy ? "正在拉取…" : "重新拉取四站" })]
      ),
      p.item.file
        ? h(
            "button.bm9rc-b.bm9rc-act",
            { attr: { type: "button" }, on: { click: () => openNote(p.item) } },
            [icon("note", 14), h("span", { text: "打开笔记" })]
          )
        : null,
      h(
        "button.bm9rc-b.bm9rc-fix",
        {
          attr: { type: "button", "aria-expanded": open ? "true" : "false" },
          on: {
            click: () => {
              st.bindOpenKey = open ? "" : p.cacheKey;
              renderStage();
              if (!open) {
                const first = bindEl.querySelector("input");
                if (first) first.focus();
              }
            }
          }
        },
        [icon("pen", 13), h("span", { text: open ? "收起" : "匹配错了？手动指定链接" })]
      )
    );
  };

  const paintBind = (p) => {
    const open = st.bindOpenKey === p.cacheKey;
    if (!open) {
      clear(bindEl);
      bindEl.style.display = "none";
      bindEl.dataset.key = "";
      return;
    }
    if (bindEl.dataset.key === p.cacheKey && bindEl.contains(document.activeElement)) return;
    clear(bindEl);
    bindEl.style.display = "";
    bindEl.dataset.key = p.cacheKey;
    if (!st.bindDraft[p.cacheKey]) {
      st.bindDraft[p.cacheKey] = {
        anilist: String((p.manualBindings && p.manualBindings.anilistId) || p.sites.anilist.idNum || ""),
        mal: String((p.manualBindings && p.manualBindings.malId) || p.sites.mal.idNum || ""),
        filmarks: String((p.manualBindings && p.manualBindings.filmarksUrl) || p.sites.filmarks.url || "")
      };
    }
    const draft = st.bindDraft[p.cacheKey];
    const fields = [
      ["anilist", "AniList", "作品 ID 或 anilist.co 链接"],
      ["mal", "MyAnimeList", "作品 ID 或 myanimelist.net 链接"],
      ["filmarks", "Filmarks", "filmarks.com/animes/… 链接"]
    ];
    const grid = h("div.bm9rc-bind-grid");
    for (const [k, label, ph] of fields) {
      const input = h("input", {
        attr: { type: "text", placeholder: ph, spellcheck: "false", "aria-label": `${label} 链接或 ID` },
        on: {
          input: (e) => {
            draft[k] = e.target.value;
          },
          keydown: (e) => {
            if (e.key === "Enter") saveBinding(p, draft);
          }
        }
      });
      input.value = draft[k] || "";
      grid.appendChild(h("label.bm9rc-field", { style: { "--c": siteColor(k) } }, [h("b", { text: label }), input]));
    }
    bindEl.append(
      grid,
      h("div.bm9rc-bind-foot", [
        h(
          "button.bm9rc-b.bm9rc-act.is-solid",
          { attr: { type: "button", disabled: Boolean(st.syncingOneKey) }, on: { click: () => saveBinding(p, draft) } },
          [h("span", { text: "保存并重新拉取" })]
        ),
        h(
          "button.bm9rc-b.bm9rc-act",
          {
            attr: { type: "button" },
            on: {
              click: () => {
                st.bindOpenKey = "";
                delete st.bindDraft[p.cacheKey];
                renderStage();
              }
            }
          },
          [h("span", { text: "取消" })]
        ),
        h("p", { text: "留空的站会交回自动匹配。" })
      ])
    );
  };

  const renderStage = () => {
    const p = model.byKey.get(st.selectedKey);
    const parts = [sHead, rule.el, ruleKey, factsEl, actsEl, bindEl];
    if (!p) {
      parts.forEach((el) => (el.style.display = "none"));
      stageEmpty.style.display = "";
      clear(stageEmpty);
      stageEmpty.appendChild(
        h("span", {
          text: model.profiles.length
            ? "在列表里选一部作品，查看它在四个站的评分。"
            : "还没有收录动画。添加作品后，这里会显示它在四个站的评分。"
        })
      );
      return;
    }
    stageEmpty.style.display = "none";
    [sHead, rule.el, ruleKey, factsEl, actsEl].forEach((el) => (el.style.display = ""));
    paintHead(p);
    rule.update(p, model.win);
    clear(ruleKey);
    put(
      ruleKey,
      h("span.bm9rc-k.is-line", [h("i"), "连线越直，四站越一致"]),
      p.composite10 !== null && p.availableCount >= 2 ? h("span.bm9rc-k.is-comp", [h("i"), "综合分"]) : null,
      p.personalScore !== null && p.personalScore > 0 ? h("span.bm9rc-k.is-me", [h("i"), "我的评分"]) : null,
      h("span.bm9rc-k-tip", { text: coarsePointer() ? "左右拖动刻度尺，可换算四站分数" : "鼠标移到刻度尺上，可换算四站分数" })
    );
    paintFacts(p);
    paintActs(p);
    paintBind(p);
  };

  /* ============================== 权重推子 ============================== */
  const openMixer = (anchor) => {
    const base = model.weights;
    const raw = {};
    CORE.forEach((sid) => {
      raw[sid] = Math.round((Number(base[sid]) || 0) * 100);
    });
    let commitTimer = 0;
    let dirty = false;
    const shares = () => normalizeWeights(raw);
    const commit = () => {
      if (commitTimer) {
        clearTimeout(commitTimer);
        commitTimer = 0;
      }
      if (!dirty) return;
      dirty = false;
      const w = shares();
      Promise.resolve(svc.setCompositeWeights(plugin, w))
        .then(() => {
          st.draftWeights = null;
          if (alive()) schedule({ all: true });
          if (svc.getPreferredRatingSource(plugin) === "composite") notifyBadges("composite");
        })
        .catch(() => {});
    };
    const commitSoon = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, 450);
    };

    popover(
      anchor,
      (inner) => {
        const box = h("div.bm9rc-mixer");
        const presetBtns = {};
        const faderRefs = {};
        const live = () => {
          dirty = true;
          st.draftWeights = shares();
          paintMixer();
          schedule({ weights: true });
        };
        const paintMixer = () => {
          const w = shares();
          for (const sid of CORE) {
            const f = faderRefs[sid];
            f.val.textContent = `${Math.round(w[sid] * 100)}%`;
            f.fill.style.height = `${raw[sid]}%`;
            f.knob.style.bottom = `${raw[sid]}%`;
            f.track.setAttribute("aria-valuenow", String(raw[sid]));
            f.track.setAttribute("aria-valuetext", `${SITE_NAME[sid]} 占 ${Math.round(w[sid] * 100)}%`);
          }
          for (const [pid, btn] of Object.entries(presetBtns)) {
            const pw = svc.COMPOSITE_WEIGHT_PRESETS[pid].weights;
            const match = CORE.every((sid) => Math.abs((pw[sid] || 0) - w[sid]) < 0.006);
            btn.classList.toggle("is-on", match);
          }
        };

        const pre = h("div.bm9rc-mx-pre");
        for (const preset of Object.values(svc.COMPOSITE_WEIGHT_PRESETS)) {
          const btn = h(
            "button.bm9rc-mx-p",
            {
              title: preset.desc,
              attr: { type: "button" },
              on: {
                click: () => {
                  CORE.forEach((sid) => {
                    raw[sid] = Math.round((preset.weights[sid] || 0) * 100);
                  });
                  live();
                  commitSoon();
                }
              }
            },
            [
              h("span", { text: preset.label }),
              h(
                "span.bm9rc-wbar",
                CORE.map((sid) => h("i", { style: { "--c": siteColor(sid), flexGrow: String(Math.max(0.0001, preset.weights[sid] || 0)) } }))
              )
            ]
          );
          presetBtns[preset.id] = btn;
          pre.appendChild(btn);
        }

        const fds = h("div.bm9rc-mx-fds");
        for (const sid of CORE) {
          const val = h("span.bm9rc-fd-val");
          const fill = h("span.bm9rc-fd-fill");
          const knob = h("span.bm9rc-fd-knob");
          const ticks = [0, 25, 50, 75, 100].map((t) => h("span.bm9rc-fd-tk", { style: { bottom: `calc(12px + (100% - 24px) * ${t / 100})` } }));
          const slot = h("span.bm9rc-fd-slot", [fill, knob]);
          const track = h(
            "div.bm9rc-fd-tr",
            {
              attr: {
                role: "slider",
                tabindex: "0",
                "aria-label": `${SITE_NAME[sid]} 权重`,
                "aria-valuemin": "0",
                "aria-valuemax": "100",
                "aria-orientation": "vertical"
              }
            },
            [...ticks, slot]
          );
          const setFromY = (clientY) => {
            const r = slot.getBoundingClientRect();
            if (!r.height) return;
            const v = Math.round(clamp(((r.bottom - clientY) / r.height) * 100, 0, 100));
            if (v === raw[sid]) return;
            const others = CORE.filter((x) => x !== sid).reduce((acc, x) => acc + raw[x], 0);
            if (v === 0 && others === 0) return;
            raw[sid] = v;
            live();
          };
          let drag = false;
          track.addEventListener("pointerdown", (e) => {
            drag = true;
            try {
              track.setPointerCapture(e.pointerId);
            } catch (_) {}
            setFromY(e.clientY);
            e.preventDefault();
          });
          track.addEventListener("pointermove", (e) => {
            if (drag) setFromY(e.clientY);
          });
          const end = () => {
            if (!drag) return;
            drag = false;
            commitSoon();
          };
          track.addEventListener("pointerup", end);
          track.addEventListener("pointercancel", end);
          track.addEventListener("keydown", (e) => {
            let next = raw[sid];
            if (e.key === "ArrowUp" || e.key === "ArrowRight") next += 5;
            else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next -= 5;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = 100;
            else return;
            e.preventDefault();
            next = clamp(next, 0, 100);
            const others = CORE.filter((x) => x !== sid).reduce((acc, x) => acc + raw[x], 0);
            if (next === 0 && others === 0) return;
            raw[sid] = next;
            live();
            commitSoon();
          });
          faderRefs[sid] = { val, fill, knob, track };
          fds.appendChild(
            h("div.bm9rc-fd", { style: { "--c": siteColor(sid) } }, [val, track, h("span.bm9rc-fd-name", { text: SITE_SHORT[sid] })])
          );
        }

        box.append(
          h("div.bm9rc-mx-h", [
            h("b", { text: "综合分里各站占多少" }),
            h("span", { text: "上下拖动推子，左侧排行和右侧换算尺会马上跟着变" })
          ]),
          pre,
          fds,
          h("p.bm9rc-mx-note", { text: "某部作品缺了哪个站的数据，就按其余几站的比例重新分配。" })
        );
        inner.appendChild(box);
        paintMixer();
      },
      { width: 340, alignRight: true, title: "综合分权重", onClose: () => commit() }
    );
  };

  /* ============================== 给分习惯 + 口味契合 ============================== */
  const renderInsights = () => {
    clear(insightEl);
    const a = model.analytics;
    const pct = makePct(model.win);
    const total = model.profiles.length;

    const habit = h("div.bm9rc-card", [
      h("div.bm9rc-card-h", [
        h("h3", { text: "四个站的给分习惯" }),
        h("span", { text: "每个点是你馆藏里的一部作品（已折算成 10 分制），色带是均分上下一个标准差，竖线是均分。点一下可以查看那部作品。" })
      ])
    ]);
    for (const sid of CORE) {
      const stt = a.siteStats[sid];
      const m = h("div.bm9rc-sw-m", [h("span.bm9rc-sw-base")]);
      if (stt.count) {
        if (stt.stdDev !== null) {
          const l = pct(stt.mean10 - stt.stdDev);
          const r = pct(stt.mean10 + stt.stdDev);
          m.appendChild(h("span.bm9rc-sw-band", { style: { left: `${l}%`, width: `${r - l}%` } }));
        }
        for (const p of model.profiles) {
          const s = p.sites[sid];
          if (!s.available || s.normalized10 === null) continue;
          m.appendChild(
            h("span.bm9rc-sw-dot", {
              dataset: { k: p.cacheKey },
              title: `${p.item.name} · ${s.displayText}`,
              style: { left: `${pct(s.normalized10)}%`, top: `calc(50% + ${hashOffset(p.cacheKey + sid, 8).toFixed(1)}px)` }
            })
          );
        }
        m.appendChild(h("span.bm9rc-sw-mean", { style: { left: `${pct(stt.mean10)}%` } }));
      }
      const swarm = h(
        "div.bm9rc-swarm",
        {
          on: {
            click: (e) => {
              const k = e.target && e.target.dataset ? e.target.dataset.k : "";
              if (k) select(k, { scroll: true });
            }
          }
        },
        [m]
      );
      habit.appendChild(
        h("div.bm9rc-hrow", { style: { "--c": siteColor(sid) } }, [
          h("div.bm9rc-slab", [h("b", { text: SITE_SHORT[sid] }), h("span", { text: `${SITE_REGION[sid]} · ${SITE_SCALE[sid]}` })]),
          swarm,
          h("div.bm9rc-hstat", [
            h("b", { text: stt.count ? stt.mean10.toFixed(2) : "—" }),
            h("span", { text: stt.count ? `均分 · ${stt.count}/${total} 部` : "暂无数据" })
          ])
        ])
      );
    }
    const axis = h("div.bm9rc-haxis-m");
    for (let v = Math.ceil(model.win.lo); v <= model.win.hi; v++) {
      axis.appendChild(h("span", { style: { left: `${pct(v)}%` }, text: String(v) }));
    }
    habit.appendChild(h("div.bm9rc-haxis", [h("span"), axis, h("span")]));

    const rated = CORE.map((sid) => a.siteStats[sid]).filter((s) => s.count >= 3 && s.mean10 !== null);
    const say = h("p.bm9rc-say");
    if (rated.length >= 2) {
      const sorted = rated.slice().sort((x, y) => y.mean10 - x.mean10);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      say.append(
        h("b", { text: SITE_NAME[top.id] }),
        ` 给分最大方（均分 ${top.mean10.toFixed(2)}），`,
        h("b", { text: SITE_NAME[bottom.id] }),
        ` 最严格（均分 ${bottom.mean10.toFixed(2)}）。`
      );
      const gaps = model.profiles.filter((p) => p.eastWestGap !== null);
      if (gaps.length >= 2) {
        const avg = gaps.reduce((acc, p) => acc + p.eastWestGap, 0) / gaps.length;
        say.append(
          Math.abs(avg) < 0.1
            ? `在 ${gaps.length} 部可以比较的作品里，中日两站和欧美两站的平均分几乎一样。`
            : `在 ${gaps.length} 部可以比较的作品里，中日两站平均比欧美两站${avg > 0 ? "高" : "低"} `,
          Math.abs(avg) < 0.1 ? "" : h("b", { text: Math.abs(avg).toFixed(2) }),
          Math.abs(avg) < 0.1 ? "" : " 分。"
        );
      }
    } else {
      say.textContent = "同步外站评分后，这里会显示四个站谁给分更大方、谁更严格。";
    }
    habit.appendChild(say);

    const taste = h("div.bm9rc-card", [
      h("div.bm9rc-card-h", [
        h("h3", { text: "哪个站和你口味最像" }),
        h("span", {
          text: "只用你打过分、而且这个站也有评分的作品来算。契合度同时看高低顺序是否一致（相关系数）和分数差多少（平均误差）。"
        })
      ])
    ]);
    const ranked = CORE.map((sid) => a.tasteAffinity[sid]).sort(
      (x, y) => (y.affinityScore === null ? -1 : y.affinityScore) - (x.affinityScore === null ? -1 : x.affinityScore)
    );
    for (const t of ranked) {
      const ok = t.affinityScore !== null;
      let sub = "共同打过分的作品不足 2 部";
      if (ok) {
        const bits = [];
        bits.push(`相关系数 ${t.pearsonR !== null ? t.pearsonR.toFixed(2) : "—"}`);
        if (t.meanBias !== null) {
          bits.push(Math.abs(t.meanBias) < 0.05 ? "你和它给分高低差不多" : `你平均比它${t.meanBias > 0 ? "高" : "低"} ${Math.abs(t.meanBias).toFixed(2)} 分`);
        }
        bits.push(`${t.overlapCount} 部`);
        sub = bits.join(" · ");
      }
      taste.appendChild(
        h("div.bm9rc-trow", { style: { "--c": siteColor(t.id) } }, [
          h("div.bm9rc-slab", [h("b", { text: SITE_SHORT[t.id] }), h("span", { text: SITE_REGION[t.id] })]),
          h("div.bm9rc-tbar", [h("i", { style: { "--v": String(ok ? t.affinityScore / 100 : 0) } })]),
          h("div.bm9rc-tval", { text: ok ? `${t.affinityScore}%` : "—" }),
          h("div.bm9rc-tsub", { text: sub })
        ])
      );
    }
    const closest = a.closestTasteSite;
    const tsay = h("p.bm9rc-say");
    if (closest) {
      tsay.append("和你口味最接近的是 ", h("b", { text: SITE_NAME[closest.id] }), `（契合度 ${closest.affinityScore}%）。`);
    } else {
      tsay.textContent = "给几部已同步外站评分的作品打上个人评分，就能算出你和哪个站最合拍。";
    }
    taste.appendChild(tsay);

    insightEl.append(habit, taste);
  };

  /* ============================== 订阅与首帧 ============================== */
  container._bm9RcUnsub = svc.subscribeMultiSiteSync((snap) => {
    if (!alive() || !container.isConnected) {
      if (container._bm9RcUnsub) {
        try {
          container._bm9RcUnsub();
        } catch (_) {}
      }
      return;
    }
    if (snap && !snap.running && snap.finishedAt && snap.finishedAt !== st.lastFinishedAt) {
      st.lastFinishedAt = snap.finishedAt;
      notifyBadges();
      if (st.batchHere && snap.total > 0) {
        new Notice(
          `四站评分同步${snap.cancelRequested ? "已停止" : "完成"}：${snap.succeeded} 部拿到外站评分${
            snap.failed ? `，${snap.failed} 部没找到` : ""
          }`,
          3600
        );
      }
      st.batchHere = false;
    }
    schedule({ all: true });
  });

  computeModel();
  ensureSelection();
  renderHeader();
  renderBoard(false);
  renderStage();
  renderInsights();
  if (pendingFocusScroll) requestAnimationFrame(() => alive() && maybeScrollStage());
}

module.exports = {
  RATING_COMPARE_STYLE_ID,
  renderRatingCompareWorkspace
};
