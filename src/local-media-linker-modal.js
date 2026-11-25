/**
 * 宽屏「本地视频关联」整理工作台（双栏拖拽 + 持久化暂存区 + 智能预扫描 + 单集胶片槽）
 * ----------------------------------------------------------------------------
 * - 完整继承 6 大档案馆外观与亮/暗模式（--bm7-* 令牌），零宿主灰框按钮污染；
 * - 支持左侧电脑目录浏览器 -> 暂存区 -> 右侧动画卡片/单集槽位 双向拖拽与点击关联；
 * - 捕获阶段接管外部 Windows 资源管理器拖放，避免被 Obsidian 主窗口导入行为截胡；
 * - 保留 Windows 原生文件/文件夹选择窗口，不强制任何一种操作路径。
 */
const {
  isDesktopNodeAvailable,
  isMobileEnv,
  normalizeUnicodeNfc,
  getNativeFilePathCrossPlatform,
  pickNativeFolderOnDesktop,
  pickNativeFilesOnDesktop,
  listAvailableDrivesOnDesktop,
  tryRequireNode
} = require("./platform-env.js");
const noteUtils = require("./note-utils.js");
const v07Core = require("./v07-core.js");
const { normalizeAppearance } = require("./v07-themes.js");
const indexSvc = require("./local-media-index-service.js");
const { THEATER_CSS, LocalMediaLinkerTheater } = require("./local-media-linker-theater.js");

let obsidianMod = null;
try {
  obsidianMod = require("obsidian");
} catch (_) {}

const LOCAL_MEDIA_LINKER_CSS = String.raw`
.modal.bm-linker-modal-container{
  width:min(1240px, 95vw) !important;
  max-width:1240px !important;
  height:min(840px, 90vh) !important;
  max-height:92vh !important;
  padding:0 !important;
  border-radius:16px !important;
  overflow:hidden !important;
  border:1px solid var(--bm7-line, var(--background-modifier-border)) !important;
  background:var(--bm7-bg, var(--background-primary)) !important;
  box-shadow:0 26px 70px -18px rgb(0 0 0 / .48) !important;
}
.modal.bm-linker-modal-container[data-bm7-theme="follow"],
.bm-linker-shell[data-bm7-theme="follow"]{
  background:var(--background-primary) !important;
}
.modal.bm-linker-modal-container .modal-close-button{
  top:12px !important;
  right:12px !important;
  z-index:20 !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  background:transparent !important;
}
.modal.bm-linker-modal-container .modal-close-button:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-modal-content{
  padding:0 !important;
  margin:0 !important;
  height:100% !important;
  max-height:100% !important;
  display:flex !important;
  flex-direction:column !important;
  overflow:hidden !important;
  min-width:0 !important;
}
.bm-linker-shell{
  position:relative;
  display:flex;
  flex-direction:column;
  width:100%;
  height:100%;
  min-width:0;
  min-height:0;
  overflow:hidden;
  color:var(--bm7-ink, var(--text-normal));
  background:var(--bm7-bg, var(--background-primary));
  font-size:13px;
}
.bm-linker-shell *,
.bm-linker-shell *::before,
.bm-linker-shell *::after{
  box-sizing:border-box;
}

/* 强制清零 Obsidian 原生 button 灰框污染 */
.bm-linker-shell button{
  appearance:none;
  -webkit-appearance:none;
  margin:0;
  font:inherit;
  box-shadow:none !important;
  background-image:none !important;
}
.bm-linker-shell .bm-lk-btn{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  gap:6px;
  height:30px !important;
  min-height:30px !important;
  padding:0 11px !important;
  border-radius:8px !important;
  border:1px solid var(--bm7-line, var(--background-modifier-border)) !important;
  background:var(--bm7-surface, var(--background-primary)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
  font-size:12.5px !important;
  font-weight:600 !important;
  line-height:1 !important;
  white-space:nowrap !important;
  cursor:pointer;
  flex-shrink:0;
  transition:background .15s ease, border-color .15s ease, transform .14s ease, color .15s ease;
}
.bm-linker-shell .bm-lk-btn:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 45%, var(--bm7-line, var(--background-modifier-border))) !important;
}
.bm-linker-shell .bm-lk-btn:active{
  transform:translateY(1px);
}
.bm-linker-shell .bm-lk-btn:disabled{
  opacity:.52;
  cursor:default;
}
.bm-linker-shell .bm-lk-btn.is-sm{
  height:26px !important;
  min-height:26px !important;
  padding:0 9px !important;
  font-size:12px !important;
  border-radius:7px !important;
}
.bm-linker-shell .bm-lk-btn.is-primary{
  background:var(--bm7-accent, var(--interactive-accent)) !important;
  border-color:transparent !important;
  color:var(--bm7-accent-ink, #fff) !important;
}
.bm-linker-shell .bm-lk-btn.is-primary:hover{
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 86%, #000) !important;
}
.bm-linker-shell .bm-lk-btn.is-ghost{
  background:transparent !important;
  border-color:transparent !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
}
.bm-linker-shell .bm-lk-btn.is-ghost:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-shell .bm-lk-btn.is-danger-soft{
  color:var(--bm7-live, #e5484d) !important;
  border-color:color-mix(in srgb, var(--bm7-live, #e5484d) 32%, transparent) !important;
}
.bm-linker-shell .bm-lk-btn.is-danger-soft:hover{
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 10%, transparent) !important;
}
.bm-linker-shell .bm-lk-icon-btn{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  width:28px !important;
  height:28px !important;
  min-height:28px !important;
  padding:0 !important;
  border-radius:7px !important;
  border:1px solid transparent !important;
  background:transparent !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  cursor:pointer;
  flex-shrink:0;
  transition:background .15s ease, color .15s ease;
}
.bm-linker-shell .bm-lk-icon-btn:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-shell .bm-lk-icon-btn.is-active{
  color:var(--bm7-accent, var(--interactive-accent)) !important;
  background:var(--bm7-accent-soft, rgba(100,120,240,.12)) !important;
}

.bm-linker-shell .bm-lk-input,
.bm-linker-shell .bm-lk-select{
  height:30px;
  min-height:30px;
  padding:0 10px;
  border-radius:8px;
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-surface, var(--background-primary));
  color:var(--bm7-ink, var(--text-normal));
  font-size:12.5px;
  min-width:0;
}
.bm-linker-shell .bm-lk-input:focus,
.bm-linker-shell .bm-lk-select:focus{
  outline:none;
  border-color:var(--bm7-accent, var(--interactive-accent));
  box-shadow:0 0 0 2.5px var(--bm7-accent-soft, rgba(100,120,240,.14));
}

/* 顶栏 */
.bm-lk-header{
  flex:0 0 auto;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:10px 14px;
  padding:13px 52px 12px 18px;
  border-bottom:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary)));
  min-width:0;
}
.bm-lk-title-group{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px 12px;
  min-width:0;
}
.bm-lk-title{
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin:0;
  font-size:16px;
  font-weight:750;
  color:var(--bm7-ink, var(--text-normal));
}
.bm-lk-stat-pill{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:3px 10px;
  border-radius:999px;
  font-size:12px;
  font-weight:600;
  color:var(--bm7-ink-2, var(--text-muted));
  background:color-mix(in srgb, var(--bm7-ink, #333) 6%, transparent);
}
.bm-lk-stat-pill.is-warn{
  color:var(--bm7-gold, #c6922a);
  background:color-mix(in srgb, var(--bm7-gold, #c6922a) 13%, transparent);
}
.bm-lk-header-right{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px;
  min-width:0;
}

/* 盘符自动迁移提示条 */
.bm-lk-drive-banner{
  flex:0 0 auto;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px 12px;
  padding:9px 18px;
  background:color-mix(in srgb, var(--bm7-gold, #c6922a) 12%, var(--bm7-surface, var(--background-secondary)));
  border-bottom:1px solid color-mix(in srgb, var(--bm7-gold, #c6922a) 32%, transparent);
  font-size:12.5px;
}
.bm-lk-drive-banner-msg{
  display:flex;
  align-items:center;
  gap:8px;
  color:var(--bm7-ink, var(--text-normal));
  min-width:0;
  flex:1 1 280px;
}
.bm-lk-drive-banner-acts{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:center;
}
.bm-lk-remap-bar{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:8px 18px;
  border-bottom:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-surface-2, var(--background-secondary));
  font-size:12px;
}

/* 移动端视图切换 */
.bm-lk-mobile-switch{
  display:none;
  padding:8px 12px 0;
  flex:0 0 auto;
}

/* 主工作区 */
.bm-lk-body{
  flex:1 1 auto;
  min-height:0;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}
.bm-lk-workbench{
  flex:1 1 auto;
  min-height:0;
  display:grid;
  grid-template-columns:minmax(330px, 43%) minmax(0, 1fr);
  gap:12px;
  padding:12px 16px 14px;
  overflow:hidden;
}
.bm-lk-col-left{
  display:flex;
  flex-direction:column;
  gap:10px;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
.bm-lk-col-right{
  display:flex;
  flex-direction:column;
  gap:10px;
  min-width:0;
  min-height:0;
  overflow:hidden;
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  border-radius:12px;
  background:var(--bm7-surface, var(--background-primary));
  padding:10px 12px;
}

.bm-lk-pane-card{
  display:flex;
  flex-direction:column;
  min-width:0;
  min-height:0;
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  border-radius:12px;
  background:var(--bm7-surface, var(--background-primary));
  overflow:hidden;
}
.bm-lk-browser-card{
  flex:1.15 1 0;
  min-height:200px;
}
.bm-lk-staging-card{
  flex:0.95 1 0;
  min-height:190px;
  transition:border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
.bm-lk-staging-card.is-drop-over{
  border-color:var(--bm7-accent, var(--interactive-accent));
  box-shadow:0 0 0 3px var(--bm7-accent-soft, rgba(100,120,240,.16));
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 4%, var(--bm7-surface, var(--background-primary)));
}

.bm-lk-pane-head{
  flex:0 0 auto;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:6px 8px;
  padding:8px 11px;
  border-bottom:1px solid var(--bm7-line, var(--background-modifier-border));
  background:color-mix(in srgb, var(--bm7-surface-2, var(--background-secondary)) 65%, transparent);
}
.bm-lk-pane-title{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:13px;
  font-weight:700;
  color:var(--bm7-ink, var(--text-normal));
  min-width:0;
}
.bm-lk-saved-badge{
  display:inline-flex;
  align-items:center;
  gap:3px;
  padding:1px 7px;
  border-radius:999px;
  font-size:12px;
  font-weight:600;
  color:var(--bm7-ok, #2f9e6e);
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 12%, transparent);
}
.bm-lk-pane-tools{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:5px;
}

/* 盘符与收藏快捷条 */
.bm-lk-quick-strip{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:5px;
  padding:6px 10px 5px;
  overflow-x:auto;
  scrollbar-width:thin;
  border-bottom:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 65%, transparent);
}
.bm-lk-quick-strip::-webkit-scrollbar{
  height:4px;
}
.bm-lk-quick-strip::-webkit-scrollbar-track{
  background:transparent;
}
.bm-lk-quick-strip::-webkit-scrollbar-thumb{
  border-radius:999px;
  background:color-mix(in srgb, var(--bm7-ink-3, #888) 38%, transparent);
}
.bm-lk-chip-btn{
  display:inline-flex !important;
  align-items:center !important;
  gap:4px;
  height:25px !important;
  min-height:25px !important;
  padding:0 9px !important;
  border-radius:999px !important;
  border:1px solid var(--bm7-line, var(--background-modifier-border)) !important;
  background:var(--bm7-surface-2, var(--background-secondary)) !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  font-size:12px !important;
  font-weight:600 !important;
  white-space:nowrap !important;
  flex-shrink:0;
  cursor:pointer;
}
.bm-linker-shell .bm-lk-chip-btn:hover,
.bm-linker-shell .bm-lk-chip-btn.is-active{
  color:var(--bm7-accent, var(--interactive-accent)) !important;
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 45%, transparent) !important;
  background:var(--bm7-accent-soft, rgba(100,120,240,.12)) !important;
}

/* 路径面包屑与目录筛选 */
.bm-lk-nav-bar{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-bottom:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 65%, transparent);
  min-width:0;
}
.bm-lk-crumbs{
  flex:1 1 auto;
  min-width:0;
  display:flex;
  align-items:center;
  gap:2px;
  overflow-x:auto;
  scrollbar-width:none;
  padding:2px 6px;
  border-radius:7px;
  background:var(--bm7-surface-2, var(--background-secondary));
}
.bm-lk-crumb-ellipsis{
  color:var(--bm7-ink-3, var(--text-faint));
  font-size:12px;
  padding:0 4px;
  user-select:none;
  flex-shrink:0;
}
.bm-lk-crumbs::-webkit-scrollbar{display:none;}
.bm-lk-crumb{
  height:22px !important;
  min-height:22px !important;
  padding:0 6px !important;
  border:none !important;
  border-radius:5px !important;
  background:transparent !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  font-size:12px !important;
  white-space:nowrap !important;
  cursor:pointer;
  flex-shrink:0;
}
.bm-lk-crumb:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-lk-crumb-sep{
  color:var(--bm7-ink-3, var(--text-faint));
  font-size:12px;
  user-select:none;
}

.bm-lk-filter-row{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 10px;
  border-bottom:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 55%, transparent);
}
.bm-lk-filter-row .bm-lk-input{
  flex:1 1 auto;
  height:27px;
  min-height:27px;
  font-size:12px;
}
.bm-lk-check-pill{
  display:inline-flex;
  align-items:center;
  gap:5px;
  font-size:12px;
  color:var(--bm7-ink-2, var(--text-muted));
  cursor:pointer;
  white-space:nowrap;
  user-select:none;
}

/* 文件/目录列表 */
.bm-lk-scroll-list{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  overflow-x:hidden;
  padding:6px 8px;
  display:flex;
  flex-direction:column;
  gap:3px;
}
.bm-lk-file-row{
  display:flex;
  align-items:center;
  gap:8px;
  padding:6px 8px;
  border-radius:8px;
  border:1px solid transparent;
  background:transparent;
  cursor:grab;
  min-width:0;
  user-select:none;
  transition:background .13s ease, border-color .13s ease;
}
.bm-lk-file-row:hover{
  background:var(--bm7-surface-2, var(--background-secondary));
}
.bm-lk-file-row.is-selected{
  background:var(--bm7-accent-soft, rgba(100,120,240,.13));
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 36%, transparent);
}
.bm-lk-file-row.is-dragging{
  opacity:.55;
}
.bm-lk-file-ico{
  flex-shrink:0;
  color:var(--bm7-ink-2, var(--text-muted));
  display:inline-flex;
}
.bm-lk-file-row[data-kind="folder"] .bm-lk-file-ico{
  color:var(--bm7-gold, #c6922a);
}
.bm-lk-file-main{
  flex:1 1 auto;
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:1px;
}
.bm-lk-file-name{
  font-size:12.5px;
  font-weight:550;
  color:var(--bm7-ink, var(--text-normal));
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.bm-lk-file-sub{
  font-size:12px;
  color:var(--bm7-ink-3, var(--text-faint));
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.bm-lk-ep-tag{
  flex-shrink:0;
  padding:1px 6px;
  border-radius:6px;
  font-size:12px;
  font-weight:650;
  font-variant-numeric:tabular-nums;
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 14%, transparent);
  color:var(--bm7-accent, var(--interactive-accent));
}
.bm-lk-row-add{
  opacity:.72;
}
.bm-lk-file-row:hover .bm-lk-row-add{
  opacity:1;
}

/* 暂存区条目与折叠分组 */
.bm-lk-selection-bar{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:7px 10px;
  border-top:1px solid var(--bm7-line, var(--background-modifier-border));
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 9%, var(--bm7-surface, var(--background-primary)));
  font-size:12px;
}
.bm-lk-stg-stack{
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  border-radius:9px;
  background:var(--bm7-surface-2, var(--background-secondary));
  overflow:hidden;
}
.bm-lk-stg-stack-head{
  display:flex;
  align-items:center;
  gap:7px;
  padding:6px 8px;
  cursor:grab;
  min-width:0;
}
.bm-lk-stg-stack-head:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover));
}
.bm-lk-stg-stack-children{
  padding:4px 6px 6px 18px;
  display:flex;
  flex-direction:column;
  gap:3px;
  border-top:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 65%, transparent);
  background:var(--bm7-surface, var(--background-primary));
}
.bm-lk-status-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  flex-shrink:0;
  background:var(--bm7-ink-3, var(--text-faint));
}
.bm-lk-status-dot.is-ok{background:var(--bm7-ok, #2f9e6e);}
.bm-lk-status-dot.is-offline{background:var(--bm7-gold, #c6922a);}
.bm-lk-status-dot.is-missing{background:var(--bm7-live, #e5484d);}

.bm-lk-empty-drop{
  flex:1 1 auto;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:18px;
  text-align:center;
  color:var(--bm7-ink-3, var(--text-faint));
  font-size:12.5px;
  line-height:1.55;
  border:1.5px dashed color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 90%, transparent);
  border-radius:10px;
  margin:4px;
}

/* 右侧动画筛选与列表 */
.bm-lk-anime-toolbar{
  flex:0 0 auto;
  display:flex;
  flex-direction:column;
  gap:7px;
  min-width:0;
}
.bm-lk-anime-search-row{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.bm-lk-anime-search-row .bm-lk-input{
  flex:1 1 auto;
  min-width:0;
}
.bm-lk-anime-search-row .bm-lk-select{
  flex:0 0 auto;
  width:auto;
  min-width:96px;
  white-space:nowrap;
}
.bm-lk-anime-filter-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:6px;
  min-width:0;
}
.bm-lk-drop-helper{
  font-size:12px;
  color:var(--bm7-ink-2, var(--text-muted));
  padding:6px 10px;
  border-radius:8px;
  border:1px dashed color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 36%, var(--bm7-line, var(--background-modifier-border)));
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 4%, var(--bm7-surface-2, var(--background-secondary)));
}
.bm-lk-file-sub.is-warn-txt{
  color:var(--bm7-live, #e5484d);
  font-weight:550;
}
.bm-lk-anime-list{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  overflow-x:hidden;
  display:flex;
  flex-direction:column;
  gap:10px;
  padding-right:2px;
}
.bm-lk-anime-card{
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  border-radius:12px;
  background:var(--bm7-surface, var(--background-primary));
  padding:10px 12px;
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  transition:border-color .16s ease, box-shadow .16s ease, background .16s ease, transform .16s ease;
}
.bm-lk-anime-card.is-focused{
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 52%, var(--bm7-line, var(--background-modifier-border)));
}
.bm-lk-anime-card.is-drop-over{
  border-color:var(--bm7-accent, var(--interactive-accent));
  box-shadow:0 0 0 3px var(--bm7-accent-soft, rgba(100,120,240,.16));
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 3.5%, var(--bm7-surface, var(--background-primary)));
}
.bm-lk-anime-top{
  display:flex;
  align-items:flex-start;
  gap:10px;
  min-width:0;
}
.bm-lk-anime-cover{
  width:44px;
  height:62px;
  border-radius:7px;
  flex-shrink:0;
}
.bm-lk-anime-meta{
  flex:1 1 auto;
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px;
}
.bm-lk-anime-title-row{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:6px;
  min-width:0;
}
.bm-lk-anime-name{
  font-size:14px;
  font-weight:720;
  color:var(--bm7-ink, var(--text-normal));
  overflow-wrap:anywhere;
}
.bm-lk-anime-sub{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px 10px;
  font-size:12px;
  color:var(--bm7-ink-2, var(--text-muted));
}
.bm-lk-anime-acts{
  display:flex;
  align-items:center;
  gap:5px;
  flex-shrink:0;
}

/* 已关联路径芯片 */
.bm-lk-sources-wrap{
  display:flex;
  flex-wrap:wrap;
  gap:5px;
  min-width:0;
}
.bm-lk-source-chip{
  display:inline-flex;
  align-items:center;
  gap:5px;
  max-width:100%;
  padding:3px 8px;
  border-radius:8px;
  font-size:12px;
  background:var(--bm7-surface-2, var(--background-secondary));
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  color:var(--bm7-ink, var(--text-normal));
  min-width:0;
}
.bm-lk-source-chip.is-missing{
  border-color:color-mix(in srgb, var(--bm7-live, #e5484d) 45%, transparent);
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 8%, transparent);
}
.bm-lk-source-chip.is-offline{
  border-color:color-mix(in srgb, var(--bm7-gold, #c6922a) 45%, transparent);
  background:color-mix(in srgb, var(--bm7-gold, #c6922a) 8%, transparent);
}
.bm-lk-source-path{
  max-width:260px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.bm-lk-source-tag{
  font-size:12px;
  color:var(--bm7-accent, var(--interactive-accent));
  font-weight:650;
  flex-shrink:0;
}
.bm-lk-chip-mini-btn{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  width:20px !important;
  height:20px !important;
  min-height:20px !important;
  padding:0 !important;
  border:none !important;
  border-radius:5px !important;
  background:transparent !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  cursor:pointer;
}
.bm-lk-chip-mini-btn:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}

.bm-lk-warn-box{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  padding:8px 10px;
  border-radius:9px;
  background:color-mix(in srgb, var(--bm7-gold, #c6922a) 11%, transparent);
  border:1px solid color-mix(in srgb, var(--bm7-gold, #c6922a) 32%, transparent);
  font-size:12px;
  line-height:1.5;
}

/* 剧集胶片格 */
.bm-lk-ep-section{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding-top:6px;
  border-top:1px dashed color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 85%, transparent);
}
.bm-lk-ep-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(58px, 1fr));
  gap:6px;
  min-width:0;
}
.bm-linker-shell .bm-lk-ep-slot{
  position:relative;
  display:flex !important;
  flex-direction:column !important;
  align-items:center !important;
  justify-content:center !important;
  gap:1px;
  height:42px !important;
  min-height:42px !important;
  padding:3px 4px !important;
  border-radius:8px !important;
  border:1px dashed color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 95%, transparent) !important;
  background:var(--bm7-surface-2, var(--background-secondary)) !important;
  color:var(--bm7-ink-3, var(--text-faint)) !important;
  font-variant-numeric:tabular-nums;
  cursor:pointer;
  transition:transform .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease;
}
.bm-linker-shell .bm-lk-ep-slot:hover{
  transform:translateY(-1px);
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 55%, transparent) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-shell .bm-lk-ep-slot.is-ready{
  border-style:solid !important;
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 45%, var(--bm7-line, var(--background-modifier-border))) !important;
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 10%, var(--bm7-surface, var(--background-primary))) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-shell .bm-lk-ep-slot.is-watched{
  border-style:solid !important;
  border-color:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 35%, var(--bm7-line, var(--background-modifier-border))) !important;
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 9%, var(--bm7-surface, var(--background-primary))) !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
}
.bm-linker-shell .bm-lk-ep-slot.is-missing{
  border-style:solid !important;
  border-color:color-mix(in srgb, var(--bm7-live, #e5484d) 55%, transparent) !important;
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 9%, transparent) !important;
  color:var(--bm7-live, #e5484d) !important;
}
.bm-linker-shell .bm-lk-ep-slot.is-active{
  box-shadow:0 0 0 2.5px var(--bm7-accent, var(--interactive-accent)) !important;
}
.bm-linker-shell .bm-lk-ep-slot.is-drag-target-hint{
  border-style:solid !important;
  border-color:var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow:0 0 0 3px var(--bm7-accent-soft, rgba(100,120,240,.24)) !important;
  transform:scale(1.05);
}
.bm-linker-shell .bm-lk-ep-slot.is-drop-confirmed{
  animation:bm-lk-pulse .42s cubic-bezier(.22,.85,.32,1);
}
@keyframes bm-lk-pulse{
  0%{transform:scale(.94)}
  50%{transform:scale(1.07)}
  100%{transform:scale(1)}
}
.bm-lk-ep-num{
  font-size:12.5px;
  font-weight:700;
  line-height:1.15;
}
.bm-lk-ep-sub{
  font-size:12px;
  line-height:1;
  opacity:.85;
}
.bm-lk-ep-pin{
  position:absolute;
  top:2px;
  right:3px;
  color:var(--bm7-accent, var(--interactive-accent));
  display:inline-flex;
}

.bm-lk-ep-detail{
  padding:9px 11px;
  border-radius:9px;
  background:var(--bm7-surface-2, var(--background-secondary));
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  display:flex;
  flex-direction:column;
  gap:7px;
  font-size:12px;
}
.bm-lk-ep-detail-path{
  color:var(--bm7-ink-2, var(--text-muted));
  overflow-wrap:anywhere;
  line-height:1.45;
}

.bm-lk-extras-zone{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
  padding:7px 9px;
  border-radius:9px;
  background:color-mix(in srgb, var(--bm7-surface-2, var(--background-secondary)) 70%, transparent);
  border:1px dashed var(--bm7-line, var(--background-modifier-border));
  font-size:12px;
}
.bm-lk-extras-zone.is-drop-over{
  border-color:var(--bm7-accent, var(--interactive-accent));
  background:var(--bm7-accent-soft, rgba(100,120,240,.12));
}

/* 模式二：智能扫描匹配 */
.bm-lk-scan-view{
  flex:1 1 auto;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.bm-lk-scan-top{
  flex:0 0 auto;
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 18px;
  border-bottom:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-surface, var(--background-primary));
}
.bm-lk-scan-dirs{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}
.bm-lk-scan-results{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  padding:14px 18px;
  display:flex;
  flex-direction:column;
  gap:14px;
}
.bm-lk-scan-group{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.bm-lk-scan-group-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:13px;
  font-weight:720;
}
.bm-lk-scan-row{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px 12px;
  padding:8px 11px;
  border-radius:10px;
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-surface, var(--background-primary));
  min-width:0;
}
.bm-lk-scan-left{
  display:flex;
  align-items:center;
  gap:8px;
  flex:1 1 260px;
  min-width:0;
}
.bm-lk-scan-right{
  display:flex;
  align-items:center;
  gap:8px;
  flex:1 1 260px;
  min-width:0;
  justify-content:flex-end;
}
.bm-lk-scan-footer{
  flex:0 0 auto;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 18px;
  border-top:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary)));
}

/* 顶栏功能演示按钮与可点击红色待确认按钮 */
.bm-linker-shell .bm-lk-demo-btn{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  gap:5px;
  height:26px !important;
  min-height:26px !important;
  padding:0 10px !important;
  border-radius:999px !important;
  border:1px solid color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 36%, transparent) !important;
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 11%, transparent) !important;
  color:var(--bm7-accent, var(--interactive-accent)) !important;
  font-size:12px !important;
  font-weight:650 !important;
  line-height:1 !important;
  white-space:nowrap !important;
  cursor:pointer;
  flex-shrink:0;
  transition:background .15s ease, border-color .15s ease, transform .14s ease;
}
.bm-linker-shell .bm-lk-demo-btn:hover{
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 19%, transparent) !important;
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 60%, transparent) !important;
}
.bm-linker-shell .bm-lk-demo-btn:active{
  transform:scale(.97);
}

.bm-linker-shell .bm-lk-stat-pill.is-warn.is-clickable{
  display:inline-flex !important;
  align-items:center !important;
  gap:5px;
  height:26px !important;
  min-height:26px !important;
  padding:0 10px !important;
  border-radius:999px !important;
  border:1px solid color-mix(in srgb, var(--bm7-live, #e5484d) 40%, transparent) !important;
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 12%, transparent) !important;
  color:var(--bm7-live, #e5484d) !important;
  font-size:12px !important;
  font-weight:680 !important;
  line-height:1 !important;
  white-space:nowrap !important;
  cursor:pointer;
  flex-shrink:0;
  transition:background .15s ease, border-color .15s ease, transform .14s ease, box-shadow .15s ease;
}
.bm-linker-shell .bm-lk-stat-pill.is-warn.is-clickable:hover{
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 20%, transparent) !important;
  border-color:color-mix(in srgb, var(--bm7-live, #e5484d) 65%, transparent) !important;
}
.bm-linker-shell .bm-lk-stat-pill.is-warn.is-clickable.is-active{
  background:var(--bm7-live, #e5484d) !important;
  border-color:var(--bm7-live, #e5484d) !important;
  color:#ffffff !important;
  box-shadow:0 0 0 2.5px color-mix(in srgb, var(--bm7-live, #e5484d) 26%, transparent) !important;
}
.bm-linker-shell .bm-lk-stat-pill.is-warn.is-clickable.is-hidden{
  display:none !important;
}

/* 右侧面板顺滑切换与专属待确认面板 */
.bm-lk-pane-enter{
  animation:bm-lk-pane-slide-in .26s cubic-bezier(.22,1,.36,1);
}
@keyframes bm-lk-pane-slide-in{
  from{
    opacity:0;
    transform:translateX(14px);
  }
  to{
    opacity:1;
    transform:translateX(0);
  }
}
.bm-lk-attn-header{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:8px 10px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid color-mix(in srgb, var(--bm7-live, #e5484d) 32%, var(--bm7-line, var(--background-modifier-border)));
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 8%, var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary))));
}
.bm-lk-attn-header.is-ok{
  border-color:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 36%, var(--bm7-line, var(--background-modifier-border)));
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 8%, var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary))));
}
.bm-lk-attn-title-wrap{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:7px 9px;
  min-width:0;
}
.bm-lk-attn-title{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:14.5px;
  font-weight:750;
  color:var(--bm7-ink, var(--text-normal));
}
.bm-lk-attn-title svg{
  color:var(--bm7-live, #e5484d);
}
.bm-lk-attn-header.is-ok .bm-lk-attn-title svg{
  color:var(--bm7-ok, #2f9e6e);
}
.bm-lk-attn-count{
  display:inline-flex;
  align-items:center;
  padding:2px 9px;
  border-radius:999px;
  font-size:12px;
  font-weight:650;
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 14%, transparent);
  color:var(--bm7-live, #e5484d);
}
.bm-lk-attn-count.is-ok{
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 15%, transparent);
  color:var(--bm7-ok, #2f9e6e);
}
.bm-lk-attn-body{
  flex:1 1 auto;
  min-height:0;
  overflow-y:auto;
  display:flex;
  flex-direction:column;
  gap:12px;
  padding-right:2px;
}
.bm-lk-attn-sec{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.bm-lk-attn-sec-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:8px;
  font-size:12.5px;
  font-weight:720;
  color:var(--bm7-ink-2, var(--text-muted));
  padding:2px 2px 0;
}
.bm-lk-attn-card{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:11px 12px;
  border-radius:12px;
  border:1px solid var(--bm7-line, var(--background-modifier-border));
  background:var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary)));
}
.bm-lk-attn-card.is-missing-card{
  border-color:color-mix(in srgb, var(--bm7-live, #e5484d) 28%, var(--bm7-line, var(--background-modifier-border)));
}
.bm-lk-attn-card-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:8px;
  min-width:0;
}
.bm-lk-attn-card-info{
  display:flex;
  align-items:center;
  gap:9px;
  min-width:0;
  flex:1 1 200px;
}
.bm-lk-attn-mini-cover{
  width:34px;
  height:48px;
  border-radius:6px;
  flex-shrink:0;
}
.bm-lk-attn-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  gap:8px 10px;
  padding:8px 10px;
  border-radius:9px;
  background:var(--bm7-surface-2, var(--background-secondary));
  border:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 82%, transparent);
  min-width:0;
}
.bm-lk-attn-item-main{
  flex:1 1 240px;
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px;
}
.bm-lk-attn-item-top{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:6px;
  font-size:12.5px;
  font-weight:650;
  color:var(--bm7-ink, var(--text-normal));
}
.bm-lk-attn-slot-tag{
  display:inline-flex;
  align-items:center;
  padding:1px 7px;
  border-radius:6px;
  font-size:12px;
  font-weight:650;
  background:color-mix(in srgb, var(--bm7-ink, #333) 8%, transparent);
  color:var(--bm7-ink, var(--text-normal));
}
.bm-lk-attn-status{
  display:inline-flex;
  align-items:center;
  padding:1px 7px;
  border-radius:6px;
  font-size:12px;
  font-weight:650;
  background:color-mix(in srgb, var(--bm7-live, #e5484d) 13%, transparent);
  color:var(--bm7-live, #e5484d);
}
.bm-lk-attn-status.is-offline{
  background:color-mix(in srgb, var(--bm7-gold, #c6922a) 15%, transparent);
  color:var(--bm7-gold, #c6922a);
}
.bm-lk-attn-path{
  font-size:12px;
  color:var(--bm7-ink-2, var(--text-muted));
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  min-width:0;
}
.bm-lk-attn-acts{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:6px;
  flex-shrink:0;
}
.bm-lk-attn-ok-card{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  gap:10px;
  padding:34px 20px;
  border-radius:14px;
  border:1px solid color-mix(in srgb, var(--bm7-ok, #2f9e6e) 35%, var(--bm7-line, var(--background-modifier-border)));
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 7%, var(--bm7-surface, var(--background-primary)));
}
.bm-lk-attn-ok-icon{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:42px;
  height:42px;
  border-radius:50%;
  background:color-mix(in srgb, var(--bm7-ok, #2f9e6e) 15%, transparent);
  color:var(--bm7-ok, #2f9e6e);
}

/* 飞入暂存区的幽灵动效 */
.bm-lk-fly-ghost{
  position:fixed;
  z-index:10099;
  pointer-events:none;
  padding:4px 10px;
  border-radius:999px;
  background:var(--bm7-accent, var(--interactive-accent));
  color:var(--bm7-accent-ink, #fff);
  font-size:12px;
  font-weight:650;
  box-shadow:0 8px 20px -6px rgb(0 0 0 / .35);
  transition:transform .34s cubic-bezier(.22,.85,.32,1), opacity .34s ease;
}

.bm-linker-shell[data-bm7-motion="off"] *,
.bm-linker-shell[data-bm7-motion-tier="off"] *{
  animation:none !important;
  transition:none !important;
}
@media (prefers-reduced-motion: reduce){
  .bm-linker-shell *{
    animation:none !important;
    transition:none !important;
  }
}

/* 窄屏与移动端响应式 */
@media (max-width: 1040px){
  .bm-lk-workbench{
    grid-template-columns:minmax(290px, 41%) minmax(0, 1fr);
    gap:10px;
    padding:10px 12px;
  }
}
@media (max-width: 768px){
  .modal.bm-linker-modal-container{
    width:100vw !important;
    max-width:100vw !important;
    height:100dvh !important;
    max-height:100dvh !important;
    border-radius:0 !important;
  }
  .bm-lk-header{
    padding:12px 46px 10px 14px;
  }
  .bm-lk-mobile-switch{
    display:block;
  }
  .bm-lk-workbench{
    grid-template-columns:minmax(0, 1fr);
    padding:10px 12px 14px;
  }
  .bm-lk-col-left[data-mobile-hidden="1"],
  .bm-lk-col-right[data-mobile-hidden="1"]{
    display:none !important;
  }
  .bm-lk-source-path{
    max-width:170px;
  }
  .bm-lk-anime-top{
    flex-wrap:wrap;
  }
  .bm-lk-anime-acts{
    width:100%;
    justify-content:flex-end;
  }
}
${THEATER_CSS}
`;

function formatBytesText(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(n / (1024 * 1024)))} MB`;
}

function splitBreadcrumbSegments(rawDir) {
  const clean = indexSvc.normFsPath(rawDir);
  if (!clean) return [];
  const pathMod = tryRequireNode("path");
  if (!pathMod) return [{ label: clean, path: clean }];
  const parsed = pathMod.parse(clean);
  const segs = [];
  if (parsed.root) {
    segs.push({ label: parsed.root.replace(/[\\/]+$/, "") || "/", path: parsed.root });
  }
  const tail = clean.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  let acc = parsed.root || "";
  for (const part of tail) {
    acc = acc ? pathMod.join(acc, part) : part;
    segs.push({ label: part, path: acc });
  }
  return segs;
}

function createLinkerModalClass() {
  const ModalClass = globalThis.__BangumiManagerModal || obsidianMod?.Modal;
  const NoticeClass = globalThis.__BangumiManagerNotice || obsidianMod?.Notice;
  if (!ModalClass) return null;

  return class LocalMediaLinkerModal extends ModalClass {
    constructor(app, plugin, items, options = {}) {
      super(app);
      this.plugin = plugin;
      this.allItems = (Array.isArray(items) ? items : []).filter((it) => it && !it.isSamplePreviewItem);
      this.options = options || {};
      this.onUpdated = typeof options.onUpdated === "function" ? options.onUpdated : null;

      const focusIt = options.focusItem || null;
      this.focusKey = focusIt ? indexSvc.getAnimeBindingKey(focusIt) : "";
      this.expandedAnimeKeys = new Set(this.focusKey ? [this.focusKey] : []);
      this.expandedEpisodeByAnime = new Map();
      if (this.focusKey && options.focusEpisode) {
        this.expandedEpisodeByAnime.set(this.focusKey, Number(options.focusEpisode));
      }
      this.longEpExpandedKeys = new Set();

      this.activeTab = options.initialTab === "scan" ? "scan" : "workbench";
      this.mobilePane = this.focusKey ? "anime" : "files";

      this.drives = isDesktopNodeAvailable() ? listAvailableDrivesOnDesktop() : [];
      indexSvc.ensureLocalMediaSettingsShape(this.plugin);
      const bState = this.plugin.settings.localMediaBrowserState;

      const preferredInitDir =
        (focusIt && focusIt.downloadPath && focusIt.downloadPath !== "无" && indexSvc.checkPathStatus(focusIt.downloadPath) === "ok"
          ? focusIt.downloadPath
          : "") ||
        (bState.lastDir && indexSvc.checkPathStatus(bState.lastDir) === "ok" ? bState.lastDir : "") ||
        (this.plugin.settings.localAnimeRoot && indexSvc.checkPathStatus(this.plugin.settings.localAnimeRoot) === "ok"
          ? this.plugin.settings.localAnimeRoot
          : "") ||
        (this.drives[0]?.path || "");

      this.currentDir = preferredInitDir;
      this.browserEntries = [];
      this.browserError = "";
      this.browserLoading = false;
      this.browserQuery = "";
      this.browserVideosOnly = true;
      this.browserSelectedPaths = new Set();
      this.browserLastClickedIdx = -1;

      this.stagingGroupByFolder = true;
      this.stagingExpandedGroups = new Set();
      this.stagingSelectedIds = new Set();
      this.stagingSavedTick = false;
      this.stagingClearPending = false;

      this.animeSearch = "";
      this.animeLinkFilter = "all"; // all | unlinked | linked | attention
      this.animeWatchFilter = "all";
      this.animeChunkLimit = 28;
      this.rightPaneMode = "list"; // list | attention
      this.theater = null;
      this.headerDemoBtnEl = null;
      this.mobileSegEl = null;

      this.showManualRemap = false;
      this.dragPayload = null;
      this.hoverExpandTimer = null;
      this.windowCaptureListeners = [];

      // 智能扫描状态
      this.scanDirs = Array.isArray(bState.lastScannedDirs) ? bState.lastScannedDirs.filter((d) => indexSvc.checkPathStatus(d) === "ok") : [];
      if (this.scanDirs.length === 0 && this.currentDir) {
        this.scanDirs = [this.currentDir];
      }
      this.scanRunning = false;
      this.scanAbort = null;
      this.scanProgressText = "";
      this.scanResults = null;
      this.scanCheckedIds = new Set();
      this.scanCustomTargetById = new Map();
    }

    onOpen() {
      indexSvc.invalidateLocalMediaCache(this.plugin);

      const ownerDoc = this.modalEl?.ownerDocument || document;
      if (ownerDoc !== document && ownerDoc.head) {
        const injectStyleId = "bm-linker-popout-style";
        if (!ownerDoc.getElementById(injectStyleId)) {
          const st = ownerDoc.createElement("style");
          st.id = injectStyleId;
          const mainStyle = document.getElementById("bangumi-score-dashboard-style");
          st.textContent = [mainStyle ? mainStyle.textContent : "", LOCAL_MEDIA_LINKER_CSS].filter(Boolean).join("\n");
          ownerDoc.head.appendChild(st);
        }
      }

      const appearance = normalizeAppearance(this.plugin?.settings?.archiveAppearance);
      const domRoot = ownerDoc.querySelector(".bm7-root") || document.querySelector(".bm7-root");
      const activeTheme = (domRoot && domRoot.getAttribute("data-bm7-theme")) || appearance.theme || "follow";
      const activeMotion = (domRoot && domRoot.getAttribute("data-bm7-motion")) || (appearance.motion ? "on" : "off");
      const activeTier = (domRoot && domRoot.getAttribute("data-bm7-motion-tier")) || appearance.motionLevel || (activeMotion === "off" ? "off" : "full");

      this.modalEl.classList.add("bm-linker-modal-container", "bm7-root");
      this.modalEl.setAttribute("data-bm7-theme", activeTheme);
      this.modalEl.setAttribute("data-bm7-motion", activeMotion);
      this.modalEl.setAttribute("data-bm7-motion-tier", activeTier);
      this.contentEl.classList.add("bm-linker-modal-content");

      this.shell = this.contentEl.createDiv("bm-linker-shell bm7-root");
      this.shell.setAttribute("data-bm7-theme", activeTheme);
      this.shell.setAttribute("data-bm7-motion", activeMotion);
      this.shell.setAttribute("data-bm7-motion-tier", activeTier);

      this.installGlobalDragDropInterceptor();
      this.renderAll();

      if (isDesktopNodeAvailable() && this.currentDir) {
        this.loadDirectory(this.currentDir);
      }
    }

    onClose() {
      if (this.theater) {
        this.theater.destroy();
        this.theater = null;
      }
      if (this.hoverExpandTimer) {
        clearTimeout(this.hoverExpandTimer);
        this.hoverExpandTimer = null;
      }
      if (this.scanAbort) {
        this.scanAbort.aborted = true;
      }
      const targetWin = this.modalEl?.ownerDocument?.defaultView || window;
      for (const [evt, fn] of this.windowCaptureListeners) {
        targetWin.removeEventListener(evt, fn, true);
      }
      this.windowCaptureListeners = [];
      if (this.plugin?._activeLocalMediaLinkerModal === this) {
        this.plugin._activeLocalMediaLinkerModal = null;
      }
      this.contentEl.empty();
    }

    installGlobalDragDropInterceptor() {
      if (!isDesktopNodeAvailable()) return;
      const targetWin = this.modalEl?.ownerDocument?.defaultView || window;
      const onWinDragOver = (ev) => {
        if (!this.modalEl || !this.modalEl.isConnected) return;
        const types = ev.dataTransfer ? Array.from(ev.dataTransfer.types || []) : [];
        const hasNativeFiles = types.includes("Files");
        const hasInternal = types.includes("application/x-bangumi-media") || Boolean(this.dragPayload);
        if (!hasNativeFiles && !hasInternal) return;
        // 弹窗打开时阻止 Obsidian 主编辑器误将拖入的视频当附件导入 Markdown
        ev.preventDefault();
        if (ev.dataTransfer) {
          ev.dataTransfer.dropEffect = hasNativeFiles ? "link" : "copy";
        }
      };
      const onWinDrop = (ev) => {
        if (!this.modalEl || !this.modalEl.isConnected) return;
        const target = ev.target;
        const insideModal = target && this.shell && this.shell.contains(target);
        if (!insideModal) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      };
      targetWin.addEventListener("dragover", onWinDragOver, true);
      targetWin.addEventListener("drop", onWinDrop, true);
      this.windowCaptureListeners.push(["dragover", onWinDragOver], ["drop", onWinDrop]);
    }

    isDragEventSupported(ev, options = {}) {
      const rejectSource = options.rejectSource || "";
      const requireFiles = Boolean(options.requireFiles);
      if (this.dragPayload && Array.isArray(this.dragPayload.items) && this.dragPayload.items.length > 0) {
        if (rejectSource && this.dragPayload.source === rejectSource) return false;
        if (requireFiles && !this.dragPayload.items.some((x) => x.kind === "file")) return false;
        return true;
      }
      if (ev.dataTransfer) {
        const types = Array.from(ev.dataTransfer.types || []);
        if (types.includes("application/x-bangumi-media")) return true;
        if (types.includes("Files")) return true;
      }
      return false;
    }

    extractDropPayload(ev) {
      if (this.dragPayload && Array.isArray(this.dragPayload.items) && this.dragPayload.items.length > 0) {
        return this.dragPayload;
      }
      if (ev.dataTransfer) {
        try {
          const raw = ev.dataTransfer.getData("application/x-bangumi-media");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.items)) return parsed;
          }
        } catch (_) {}
        const files = ev.dataTransfer.files;
        if (files && files.length > 0) {
          const fsMod = tryRequireNode("fs");
          const pathMod = tryRequireNode("path");
          const out = [];
          for (let i = 0; i < files.length; i++) {
            const fp = getNativeFilePathCrossPlatform(files[i]);
            if (!fp) continue;
            let kind = "file";
            if (fsMod) {
              try {
                if (fsMod.statSync(fp).isDirectory()) kind = "folder";
              } catch (_) {}
            }
            const name = pathMod ? pathMod.basename(fp) : fp.split(/[\\/]/).pop() || fp;
            if (kind === "file") {
              const ext = (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
              if (!indexSvc.VIDEO_EXT_SET.has(ext)) continue;
            }
            const meta = kind === "file" ? noteUtils.parseVideoEpisodeMeta(name) : null;
            out.push({
              path: fp,
              kind,
              name,
              detectedEp: meta && !meta.isExtra ? meta.episode : null
            });
          }
          if (out.length > 0) return { source: "external", items: out };
        }
      }
      return null;
    }

    async notifyVaultChanged() {
      indexSvc.invalidateLocalMediaCache(this.plugin);
      this.updateHeaderStats();
      if (typeof this.onUpdated === "function") {
        await Promise.resolve(this.onUpdated()).catch(() => {});
      }
      if (typeof this.plugin?.refreshOpenDashboardViews === "function") {
        await this.plugin.refreshOpenDashboardViews().catch(() => {});
      }
    }

    openTheaterDemo(anchorEl = null) {
      if (!this.shell) return;
      if (this.theater && this.theater.isOpen) return;
      this.theater?.destroy();
      this.theater = new LocalMediaLinkerTheater(this.shell, {
        modalEl: this.modalEl,
        onTrySmartScan: () => {
          this.activeTab = "scan";
          this.rightPaneMode = "list";
          this.renderAll();
        },
        onReturnWorkbench: () => {}
      });
      this.theater.open(anchorEl || this.headerDemoBtnEl);
    }

    syncWarnPillActiveState() {
      if (!this.headerWarnPillEl) return;
      const warnActive = this.rightPaneMode === "attention" && this.activeTab === "workbench";
      this.headerWarnPillEl.classList.toggle("is-active", warnActive);
      this.headerWarnPillEl.setAttribute("aria-pressed", warnActive ? "true" : "false");
    }

    handleWarnPillClick() {
      if (this.activeTab !== "workbench") {
        this.activeTab = "workbench";
        this.rightPaneMode = "attention";
        this.mobilePane = "anime";
        this.renderAll();
        if (this.rightColEl) {
          this.rightColEl.classList.remove("bm-lk-pane-enter");
          void this.rightColEl.offsetWidth;
          this.rightColEl.classList.add("bm-lk-pane-enter");
        }
        return;
      }
      this.rightPaneMode = this.rightPaneMode === "attention" ? "list" : "attention";
      if (this.rightPaneMode === "attention") {
        this.mobilePane = "anime";
        this.syncMobilePaneVisibility();
      }
      this.syncWarnPillActiveState();
      this.renderRightColumn({ animate: true });
    }

    updateHeaderStats(cachedSummary = null) {
      if (!this.headerLinkedPillEl) return;
      const desktop = isDesktopNodeAvailable();
      const summary = cachedSummary || this.computeSummaryStats();
      const stagingHealth = desktop ? indexSvc.inspectStagingPoolHealth(this.plugin) : [];
      const stagingMissingCount = stagingHealth.filter((s) => s.status !== "ok").length;

      this.headerLinkedPillEl.textContent = `已关联 ${summary.linkedCount} / ${summary.totalCount} 部`;
      if (this.headerStagingPillEl) {
        this.headerStagingPillEl.textContent = `暂存区 ${stagingHealth.length} 项`;
      }
      if (this.headerWarnPillEl) {
        const warnTotal = summary.missingAnimeCount + stagingMissingCount;
        this.headerWarnPillEl.classList.toggle("is-hidden", warnTotal <= 0);
        const lbl = this.headerWarnPillEl.querySelector(".bm-lk-warn-label");
        if (lbl) {
          lbl.textContent = `有 ${warnTotal} 处路径待确认`;
        } else {
          this.headerWarnPillEl.textContent = `有 ${warnTotal} 处路径待确认`;
        }
        this.syncWarnPillActiveState();
      }
    }

    showSavedFlash() {
      this.stagingSavedTick = true;
      if (this.savedBadgeEl) {
        this.savedBadgeEl.style.display = "inline-flex";
      }
      setTimeout(() => {
        this.stagingSavedTick = false;
      }, 2200);
    }

    animateFlyToStaging(sourceEl, labelText = "+1") {
      if (!sourceEl || !this.stagingCardEl) return;
      const tier = this.shell?.getAttribute("data-bm7-motion-tier") || "full";
      if (tier === "off") return;
      try {
        const r1 = sourceEl.getBoundingClientRect();
        const r2 = this.stagingCardEl.getBoundingClientRect();
        const ownerDoc = this.modalEl?.ownerDocument || document;
        const ghost = ownerDoc.createElement("div");
        ghost.className = "bm-lk-fly-ghost";
        ghost.textContent = labelText;
        ghost.style.left = `${r1.left}px`;
        ghost.style.top = `${r1.top}px`;
        ownerDoc.body.appendChild(ghost);
        const dx = r2.left + 40 - r1.left;
        const dy = r2.top + 16 - r1.top;
        requestAnimationFrame(() => {
          ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(.85)`;
          ghost.style.opacity = "0";
        });
        setTimeout(() => ghost.remove(), 380);
      } catch (_) {}
    }

    async loadDirectory(dirPath) {
      const clean = indexSvc.normFsPath(dirPath);
      if (!clean) return;
      this.currentDir = clean;
      this.browserLoading = true;
      this.browserSelectedPaths.clear();
      this.browserLastClickedIdx = -1;
      this.renderBrowserPane();

      const res = await indexSvc.readDirectoryEntriesAsync(clean, {
        videosOnly: this.browserVideosOnly,
        query: ""
      });
      this.browserLoading = false;
      if (res.ok) {
        this.browserEntries = res.entries;
        this.browserError = "";
        this.currentDir = res.dirPath;
        this.plugin.settings.localMediaBrowserState.lastDir = res.dirPath;
        this.plugin.saveSettings?.().catch(() => {});
      } else {
        this.browserEntries = [];
        this.browserError = res.error || "无法读取该文件夹";
      }
      this.renderBrowserPane();
    }

    computeSummaryStats() {
      let linkedCount = 0;
      let missingAnimeCount = 0;
      const cache = new Map();
      for (const it of this.allItems) {
        const res = indexSvc.resolveAnimeLocalMedia(this.plugin, it);
        const key = indexSvc.getAnimeBindingKey(it);
        cache.set(key, res);
        if (res.hasAnyBinding && (res.fileCount > 0 || res.extraFiles?.length > 0 || res.folders?.some((f) => f.status === "ok"))) {
          linkedCount += 1;
        }
        if (res.hasMissingMedia) {
          missingAnimeCount += 1;
        }
      }
      return { linkedCount, totalCount: this.allItems.length, missingAnimeCount, resolveMap: cache };
    }

    renderAll() {
      if (!this.shell) return;
      v07Core.clear(this.shell);
      const desktop = isDesktopNodeAvailable();
      const summary = this.computeSummaryStats();
      const stagingHealth = desktop ? indexSvc.inspectStagingPoolHealth(this.plugin) : [];
      const stagingMissingCount = stagingHealth.filter((s) => s.status !== "ok").length;

      // 1. 顶栏
      const header = this.shell.createDiv("bm-lk-header");
      const titleGroup = header.createDiv("bm-lk-title-group");
      const titleEl = titleGroup.createEl("h2", { cls: "bm-lk-title" });
      titleEl.appendChild(v07Core.icon("film", 18));
      titleEl.createSpan({ text: "本地视频关联" });

      this.headerDemoBtnEl = titleGroup.createEl("button", {
        cls: "bm-lk-demo-btn",
        attr: { type: "button", title: "播放面板功能介绍动画" }
      });
      this.headerDemoBtnEl.appendChild(v07Core.icon("play", 11));
      this.headerDemoBtnEl.createSpan({ text: "功能演示" });
      this.headerDemoBtnEl.onclick = () => this.openTheaterDemo(this.headerDemoBtnEl);

      this.headerLinkedPillEl = titleGroup.createSpan({
        cls: "bm-lk-stat-pill",
        text: `已关联 ${summary.linkedCount} / ${summary.totalCount} 部`
      });
      if (desktop) {
        this.headerStagingPillEl = titleGroup.createSpan({
          cls: "bm-lk-stat-pill",
          text: `暂存区 ${stagingHealth.length} 项`
        });
      }
      const warnTotal = summary.missingAnimeCount + stagingMissingCount;
      const warnActive = this.rightPaneMode === "attention" && this.activeTab === "workbench";
      this.headerWarnPillEl = titleGroup.createEl("button", {
        cls: `bm-lk-stat-pill is-warn is-clickable ${warnActive ? "is-active" : ""} ${warnTotal <= 0 ? "is-hidden" : ""}`,
        attr: {
          type: "button",
          title: "点击直接在右侧打开路径待确认面板",
          "aria-pressed": warnActive ? "true" : "false"
        }
      });
      this.headerWarnPillEl.appendChild(v07Core.icon("alert", 13));
      this.headerWarnPillEl.createSpan({
        cls: "bm-lk-warn-label",
        text: `有 ${warnTotal} 处路径待确认`
      });
      this.headerWarnPillEl.appendChild(v07Core.icon("chevronRight", 12));
      this.headerWarnPillEl.onclick = () => this.handleWarnPillClick();

      const headerRight = header.createDiv("bm-lk-header-right");
      if (desktop) {
        const modeSeg = v07Core.segmented(
          [
            { value: "workbench", label: "整理工作台" },
            { value: "scan", label: "智能扫描匹配" }
          ],
          this.activeTab,
          (nextMode) => {
            this.activeTab = nextMode;
            this.syncWarnPillActiveState();
            this.renderBody();
          }
        );
        headerRight.appendChild(modeSeg);
      }

      // 2. 移动硬盘换盘符探测提示条
      if (desktop) {
        const relinks = indexSvc.detectDriveRelinkCandidates(this.plugin, this.allItems);
        if (relinks.length > 0) {
          const topSug = relinks[0];
          const banner = this.shell.createDiv("bm-lk-drive-banner");
          const msg = banner.createDiv("bm-lk-drive-banner-msg");
          msg.appendChild(v07Core.icon("alert", 15));
          msg.createSpan({
            text: `检测到 ${topSug.fromDrive} 盘未接入，但在 ${topSug.toDrive} 盘找到了 ${topSug.matchedCount} 处同名动画路径。`
          });
          const acts = banner.createDiv("bm-lk-drive-banner-acts");
          const autoFixBtn = acts.createEl("button", {
            cls: "bm-lk-btn is-sm is-primary",
            text: `一键修正为 ${topSug.toDrive} 盘`
          });
          autoFixBtn.onclick = async () => {
            autoFixBtn.disabled = true;
            const r = await indexSvc.applyPathPrefixRemap(
              this.plugin,
              topSug.fromDrive,
              topSug.toDrive,
              this.allItems
            );
            if (NoticeClass) {
              new NoticeClass(`已更新 ${r.updatedCount} 条本地路径至 ${topSug.toDrive} 盘`, 3600);
            }
            await this.notifyVaultChanged();
            this.renderAll();
          };
          const manualToggleBtn = acts.createEl("button", {
            cls: "bm-lk-btn is-sm",
            text: this.showManualRemap ? "收起手动替换" : "手动替换前缀"
          });
          manualToggleBtn.onclick = () => {
            this.showManualRemap = !this.showManualRemap;
            this.renderAll();
          };
        }

        if (this.showManualRemap) {
          const remapBar = this.shell.createDiv("bm-lk-remap-bar");
          remapBar.createSpan({ text: "把旧路径前缀" });
          const fromInp = remapBar.createEl("input", {
            type: "text",
            cls: "bm-lk-input",
            placeholder: "例如 E:\\Anime"
          });
          remapBar.createSpan({ text: "替换为" });
          const toInp = remapBar.createEl("input", {
            type: "text",
            cls: "bm-lk-input",
            placeholder: "例如 F:\\Anime"
          });
          const applyRemapBtn = remapBar.createEl("button", {
            cls: "bm-lk-btn is-sm is-primary",
            text: "执行替换"
          });
          applyRemapBtn.onclick = async () => {
            const fVal = fromInp.value.trim();
            const tVal = toInp.value.trim();
            if (!fVal || !tVal) return;
            applyRemapBtn.disabled = true;
            const r = await indexSvc.applyPathPrefixRemap(this.plugin, fVal, tVal, this.allItems);
            if (NoticeClass) new NoticeClass(`已更新 ${r.updatedCount} 条本地路径`, 3600);
            this.showManualRemap = false;
            await this.notifyVaultChanged();
            this.renderAll();
          };
        }
      }

      // 移动端提示或窄屏子面板切换
      if (!desktop) {
        this.mobileSegEl = null;
        const mobBanner = this.shell.createDiv("bm-lk-drive-banner");
        mobBanner.createDiv({
          cls: "bm-lk-drive-banner-msg",
          text: "当前为移动端，暂不浏览电脑磁盘；下方仅展示已保存的关联记录，电脑端原路径不会被改动。"
        });
      } else {
        const mobSwitch = this.shell.createDiv("bm-lk-mobile-switch");
        this.mobileSegEl = v07Core.segmented(
          [
            { value: "files", label: "电脑目录与暂存区" },
            { value: "anime", label: "动画与剧集" }
          ],
          this.mobilePane,
          (nextPane) => {
            this.mobilePane = nextPane;
            this.syncMobilePaneVisibility();
          }
        );
        mobSwitch.appendChild(this.mobileSegEl);
      }

      this.bodyEl = this.shell.createDiv("bm-lk-body");
      this.renderBody(summary);
    }

    syncMobilePaneVisibility() {
      if (this.mobileSegEl && typeof this.mobileSegEl.setValue === "function") {
        this.mobileSegEl.setValue(this.mobilePane);
      }
      if (!this.leftColEl || !this.rightColEl) return;
      this.leftColEl.dataset.mobileHidden = this.mobilePane === "files" ? "0" : "1";
      this.rightColEl.dataset.mobileHidden = this.mobilePane === "anime" ? "0" : "1";
    }

    renderBody(cachedSummary = null) {
      if (!this.bodyEl) return;
      v07Core.clear(this.bodyEl);
      const desktop = isDesktopNodeAvailable();

      if (!desktop) {
        const singleWrap = this.bodyEl.createDiv("bm-lk-workbench");
        singleWrap.style.gridTemplateColumns = "minmax(0, 1fr)";
        this.rightColEl = singleWrap.createDiv("bm-lk-col-right");
        this.renderRightColumn({ cachedSummary });
        return;
      }

      if (this.activeTab === "scan") {
        this.renderScanView();
        return;
      }

      const workbench = this.bodyEl.createDiv("bm-lk-workbench");
      this.leftColEl = workbench.createDiv("bm-lk-col-left");
      this.rightColEl = workbench.createDiv("bm-lk-col-right");

      this.browserCardEl = this.leftColEl.createDiv("bm-lk-pane-card bm-lk-browser-card");
      this.stagingCardEl = this.leftColEl.createDiv("bm-lk-pane-card bm-lk-staging-card");

      this.setupStagingDropzone(this.stagingCardEl);
      this.syncMobilePaneVisibility();

      this.renderBrowserPane();
      this.renderStagingPane({ skipRightSync: true, skipHeaderSync: true });
      this.renderRightColumn({ cachedSummary });
    }

    renderRightColumn({ cachedSummary = null, animate = false } = {}) {
      if (!this.rightColEl) return;
      if (this.rightPaneMode === "attention") {
        this.renderRightAttentionPane(cachedSummary, animate);
      } else {
        this.renderRightAnimePane(cachedSummary, animate);
      }
    }

    /* ============================== 左上：电脑目录浏览器 ============================== */

    renderBrowserPane() {
      if (!this.browserCardEl) return;
      v07Core.clear(this.browserCardEl);

      const head = this.browserCardEl.createDiv("bm-lk-pane-head");
      const title = head.createDiv("bm-lk-pane-title");
      title.appendChild(v07Core.icon("folder", 15));
      title.createSpan({ text: "电脑文件夹" });

      const tools = head.createDiv("bm-lk-pane-tools");
      const bState = this.plugin.settings.localMediaBrowserState;
      const isPinned = Boolean(
        this.currentDir &&
          bState.pinnedDirs.some((d) => indexSvc.normPathCompareKey(d) === indexSvc.normPathCompareKey(this.currentDir))
      );

      if (this.currentDir) {
        const pinBtn = tools.createEl("button", {
          cls: `bm-lk-icon-btn ${isPinned ? "is-active" : ""}`,
          title: isPinned ? "从常用目录移除当前文件夹" : "固定当前文件夹到常用目录"
        });
        pinBtn.appendChild(v07Core.icon("bookmark", 14));
        pinBtn.onclick = async () => {
          const normKey = indexSvc.normPathCompareKey(this.currentDir);
          if (isPinned) {
            bState.pinnedDirs = bState.pinnedDirs.filter((d) => indexSvc.normPathCompareKey(d) !== normKey);
          } else {
            bState.pinnedDirs.push(this.currentDir);
          }
          await this.plugin.saveSettings?.();
          this.renderBrowserPane();
        };
      }

      const pickFolderBtn = tools.createEl("button", {
        cls: "bm-lk-btn is-sm",
        title: "用系统窗口打开任意本地文件夹"
      });
      pickFolderBtn.appendChild(v07Core.icon("folder", 13));
      pickFolderBtn.createSpan({ text: "选择文件夹…" });
      pickFolderBtn.onclick = async () => {
        const picked = await pickNativeFolderOnDesktop({
          title: "浏览本地动画文件夹",
          initialDir: this.currentDir
        });
        if (picked) {
          await this.loadDirectory(picked);
        }
      };

      // 常用盘符与收藏目录
      const strip = this.browserCardEl.createDiv("bm-lk-quick-strip");
      const pinnedList = (bState.pinnedDirs || []).filter((d) => indexSvc.checkPathStatus(d) === "ok");
      const quickEntries = [...this.drives];
      const defRoot = String(this.plugin.settings?.localAnimeRoot || "").trim();
      if (defRoot && indexSvc.checkPathStatus(defRoot) === "ok") {
        quickEntries.unshift({ path: defRoot, label: "默认下载目录", kind: "quick" });
      }
      for (const pd of pinnedList) {
        const label = pd.split(/[\\/]/).filter(Boolean).pop() || pd;
        quickEntries.unshift({ path: pd, label: `★ ${label}`, kind: "pin" });
      }

      const seenChip = new Set();
      for (const qe of quickEntries) {
        const k = indexSvc.normPathCompareKey(qe.path);
        if (!k || seenChip.has(k)) continue;
        seenChip.add(k);
        const active = indexSvc.normPathCompareKey(this.currentDir) === k;
        const chip = strip.createEl("button", {
          cls: `bm-lk-chip-btn ${active ? "is-active" : ""}`,
          text: qe.label,
          title: qe.path
        });
        chip.onclick = () => this.loadDirectory(qe.path);
      }

      // 面包屑导航
      const nav = this.browserCardEl.createDiv("bm-lk-nav-bar");
      const pathMod = tryRequireNode("path");
      const parentDir = this.currentDir && pathMod ? pathMod.dirname(this.currentDir) : "";
      const canGoUp = Boolean(parentDir && parentDir !== this.currentDir);

      const upBtn = nav.createEl("button", {
        cls: "bm-lk-icon-btn",
        title: "返回上一级文件夹"
      });
      upBtn.appendChild(v07Core.icon("chevronLeft", 15));
      upBtn.disabled = !canGoUp;
      upBtn.onclick = () => canGoUp && this.loadDirectory(parentDir);

      const crumbs = nav.createDiv("bm-lk-crumbs");
      const segs = splitBreadcrumbSegments(this.currentDir);
      const displaySegs =
        segs.length > 4
          ? [segs[0], { label: "…", ellipsis: true, path: segs.slice(0, segs.length - 3).map((s) => s.path).pop() }, ...segs.slice(-3)]
          : segs;
      displaySegs.forEach((seg, idx) => {
        if (idx > 0) crumbs.createSpan({ cls: "bm-lk-crumb-sep", text: "/" });
        if (seg.ellipsis) {
          crumbs.createSpan({
            cls: "bm-lk-crumb-ellipsis",
            text: "…",
            title: this.currentDir
          });
          return;
        }
        const cb = crumbs.createEl("button", {
          cls: "bm-lk-crumb",
          text: seg.label,
          title: seg.path
        });
        cb.onclick = () => this.loadDirectory(seg.path);
      });

      // 目录内筛选
      const filterRow = this.browserCardEl.createDiv("bm-lk-filter-row");
      const qInput = filterRow.createEl("input", {
        type: "text",
        cls: "bm-lk-input",
        placeholder: "在当前文件夹筛选…",
        value: this.browserQuery
      });
      qInput.oninput = () => {
        this.browserQuery = qInput.value;
        this.renderBrowserListOnly();
      };

      const vidOnlyLabel = filterRow.createEl("label", { cls: "bm-lk-check-pill" });
      const vidOnlyCb = vidOnlyLabel.createEl("input", { type: "checkbox" });
      vidOnlyCb.checked = this.browserVideosOnly;
      vidOnlyLabel.createSpan({ text: "只看视频" });
      vidOnlyCb.onchange = () => {
        this.browserVideosOnly = vidOnlyCb.checked;
        this.loadDirectory(this.currentDir);
      };

      this.browserListHost = this.browserCardEl.createDiv("bm-lk-scroll-list");
      this.browserSelBarEl = this.browserCardEl.createDiv("bm-lk-selection-bar");
      this.renderBrowserListOnly();
    }

    renderBrowserListOnly() {
      if (!this.browserListHost) return;
      v07Core.clear(this.browserListHost);

      if (this.browserLoading) {
        this.browserListHost.createDiv({
          cls: "bm-lk-empty-drop",
          text: "正在读取文件夹内容…"
        });
        this.updateBrowserSelBar();
        return;
      }
      if (this.browserError) {
        this.browserListHost.createDiv({
          cls: "bm-lk-empty-drop",
          text: `${this.browserError}。可点击上方盘符或「选择文件夹…」切换位置。`
        });
        this.updateBrowserSelBar();
        return;
      }

      const q = normalizeUnicodeNfc(String(this.browserQuery || "").trim()).toLowerCase();
      const visible = q
        ? this.browserEntries.filter((e) => normalizeUnicodeNfc(e.name).toLowerCase().includes(q))
        : this.browserEntries;

      if (visible.length === 0) {
        this.browserListHost.createDiv({
          cls: "bm-lk-empty-drop",
          text: q ? "当前文件夹下没有符合筛选的文件。" : "当前文件夹里暂无子文件夹或视频文件。"
        });
        this.updateBrowserSelBar();
        return;
      }

      visible.forEach((ent, idx) => {
        const isSel = this.browserSelectedPaths.has(ent.path);
        const row = this.browserListHost.createDiv(`bm-lk-file-row ${isSel ? "is-selected" : ""}`);
        row.dataset.kind = ent.kind;
        row.draggable = true;
        row.title = ent.kind === "folder" ? `双击进入「${ent.name}」，或直接拖到暂存区 / 右侧动画` : ent.path;

        const icoWrap = row.createSpan({ cls: "bm-lk-file-ico" });
        icoWrap.appendChild(v07Core.icon(ent.kind === "folder" ? "folder" : ent.isVideo ? "film" : "file", 15));

        const main = row.createDiv("bm-lk-file-main");
        main.createDiv({ cls: "bm-lk-file-name", text: ent.name });
        if (ent.kind === "file") {
          const metaParts = [];
          if (ent.size > 0) metaParts.push(formatBytesText(ent.size));
          if (ent.isExtra && ent.extraKind) metaParts.push(ent.extraKind);
          if (metaParts.length > 0) {
            main.createDiv({ cls: "bm-lk-file-sub", text: metaParts.join(" · ") });
          }
        }

        if (ent.detectedEp !== null && ent.detectedEp !== undefined) {
          row.createSpan({
            cls: "bm-lk-ep-tag",
            text: `第${String(ent.detectedEp).padStart(2, "0")}集`
          });
        }

        if (ent.kind === "folder" || ent.isVideo) {
          const addBtn = row.createEl("button", {
            cls: "bm-lk-btn is-sm bm-lk-row-add",
            text: "+ 暂存",
            title: "放入左下角暂存区以便稍后整理"
          });
          addBtn.onclick = async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const targets =
              this.browserSelectedPaths.has(ent.path) && this.browserSelectedPaths.size > 1
                ? Array.from(this.browserSelectedPaths)
                : [ent.path];
            this.animateFlyToStaging(addBtn, `+${targets.length}`);
            await indexSvc.addItemsToStagingPool(this.plugin, targets);
            this.showSavedFlash();
            this.renderStagingPane();
          };
        }

        row.onclick = (ev) => {
          if (ev.shiftKey && this.browserLastClickedIdx >= 0) {
            const start = Math.min(this.browserLastClickedIdx, idx);
            const end = Math.max(this.browserLastClickedIdx, idx);
            if (!ev.ctrlKey && !ev.metaKey) this.browserSelectedPaths.clear();
            for (let i = start; i <= end; i++) {
              this.browserSelectedPaths.add(visible[i].path);
            }
          } else if (ev.ctrlKey || ev.metaKey) {
            if (this.browserSelectedPaths.has(ent.path)) this.browserSelectedPaths.delete(ent.path);
            else this.browserSelectedPaths.add(ent.path);
            this.browserLastClickedIdx = idx;
          } else {
            this.browserSelectedPaths.clear();
            this.browserSelectedPaths.add(ent.path);
            this.browserLastClickedIdx = idx;
          }
          this.renderBrowserListOnly();
        };

        if (ent.kind === "folder") {
          row.ondblclick = (ev) => {
            ev.preventDefault();
            this.loadDirectory(ent.path);
          };
        }

        row.addEventListener("dragstart", (ev) => {
          const draggedPaths =
            this.browserSelectedPaths.has(ent.path) && this.browserSelectedPaths.size > 1
              ? Array.from(this.browserSelectedPaths)
              : [ent.path];
          const draggedItems = visible
            .filter((v) => draggedPaths.includes(v.path) && (v.kind === "folder" || v.isVideo))
            .map((v) => ({
              path: v.path,
              kind: v.kind,
              name: v.name,
              detectedEp: v.detectedEp
            }));
          if (draggedItems.length === 0) {
            ev.preventDefault();
            return;
          }
          row.classList.add("is-dragging");
          this.dragPayload = { source: "browser", items: draggedItems };
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = "copy";
            try {
              ev.dataTransfer.setData("application/x-bangumi-media", JSON.stringify(this.dragPayload));
              ev.dataTransfer.setData("text/plain", draggedItems.map((i) => i.path).join("\n"));
            } catch (_) {}
          }
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("is-dragging");
          this.dragPayload = null;
          this.clearAllDragHints();
        });
      });

      this.updateBrowserSelBar();
    }

    updateBrowserSelBar() {
      if (!this.browserSelBarEl) return;
      v07Core.clear(this.browserSelBarEl);
      const count = this.browserSelectedPaths.size;
      if (count <= 1) {
        this.browserSelBarEl.style.display = "none";
        return;
      }
      this.browserSelBarEl.style.display = "flex";
      this.browserSelBarEl.createSpan({ text: `已选中 ${count} 项` });
      const acts = this.browserSelBarEl.createDiv("bm-lk-pane-tools");
      const batchStageBtn = acts.createEl("button", {
        cls: "bm-lk-btn is-sm is-primary",
        text: "全部放入暂存区"
      });
      batchStageBtn.onclick = async () => {
        const list = Array.from(this.browserSelectedPaths);
        this.animateFlyToStaging(batchStageBtn, `+${list.length}`);
        await indexSvc.addItemsToStagingPool(this.plugin, list);
        this.showSavedFlash();
        this.renderStagingPane();
      };
      const clrBtn = acts.createEl("button", {
        cls: "bm-lk-btn is-sm is-ghost",
        text: "取消"
      });
      clrBtn.onclick = () => {
        this.browserSelectedPaths.clear();
        this.renderBrowserListOnly();
      };
    }

    /* ============================== 左下：持久化暂存区 ============================== */

    setupStagingDropzone(zoneEl) {
      zoneEl.addEventListener("dragover", (ev) => {
        if (!this.isDragEventSupported(ev, { rejectSource: "staging" })) return;
        ev.preventDefault();
        ev.stopPropagation();
        zoneEl.classList.add("is-drop-over");
      });
      zoneEl.addEventListener("dragleave", (ev) => {
        if (!zoneEl.contains(ev.relatedTarget)) {
          zoneEl.classList.remove("is-drop-over");
        }
      });
      zoneEl.addEventListener("drop", async (ev) => {
        zoneEl.classList.remove("is-drop-over");
        const payload = this.extractDropPayload(ev);
        this.dragPayload = null;
        if (!payload || payload.source === "staging") return;
        ev.preventDefault();
        ev.stopPropagation();
        const paths = payload.items.map((i) => i.path);
        const res = await indexSvc.addItemsToStagingPool(this.plugin, paths);
        if (res.added > 0) {
          this.showSavedFlash();
          this.renderStagingPane();
        } else if (NoticeClass && res.skipped > 0) {
          new NoticeClass("所选项目已在暂存区中，或不是视频与文件夹。", 3000);
        }
      });
    }

    renderStagingPane(opts = {}) {
      if (!this.stagingCardEl) return;
      v07Core.clear(this.stagingCardEl);

      const bState = this.plugin.settings.localMediaBrowserState;
      const healthList = indexSvc.inspectStagingPoolHealth(this.plugin);
      const visibleList = bState.hideLinkedInPool
        ? healthList.filter((e) => !Array.isArray(e.linkedAnimeKeys) || e.linkedAnimeKeys.length === 0)
        : healthList;
      if (this.headerStagingPillEl) {
        this.headerStagingPillEl.textContent = `暂存区 ${healthList.length} 项`;
      }
      if (!opts.skipHeaderSync) {
        this.updateHeaderStats();
      }
      if (!opts.skipRightSync && this.rightPaneMode === "attention") {
        this.renderRightColumn();
      }

      const head = this.stagingCardEl.createDiv("bm-lk-pane-head");
      const title = head.createDiv("bm-lk-pane-title");
      title.appendChild(v07Core.icon("package", 15));
      title.createSpan({ text: `暂存区 (${healthList.length})` });

      this.savedBadgeEl = title.createSpan({
        cls: "bm-lk-saved-badge",
        text: "已保存"
      });
      this.savedBadgeEl.style.display = this.stagingSavedTick ? "inline-flex" : "none";

      const tools = head.createDiv("bm-lk-pane-tools");

      const groupLabel = tools.createEl("label", { cls: "bm-lk-check-pill", title: "把同文件夹里的零散视频折叠成一叠，可整叠一次拖给动画" });
      const groupCb = groupLabel.createEl("input", { type: "checkbox" });
      groupCb.checked = this.stagingGroupByFolder;
      groupLabel.createSpan({ text: "按文件夹叠放" });
      groupCb.onchange = () => {
        this.stagingGroupByFolder = groupCb.checked;
        this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
      };

      const hideLinkedLabel = tools.createEl("label", { cls: "bm-lk-check-pill" });
      const hideLinkedCb = hideLinkedLabel.createEl("input", { type: "checkbox" });
      hideLinkedCb.checked = Boolean(bState.hideLinkedInPool);
      hideLinkedLabel.createSpan({ text: "隐藏已关联" });
      hideLinkedCb.onchange = async () => {
        bState.hideLinkedInPool = hideLinkedCb.checked;
        await this.plugin.saveSettings?.();
        this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
      };

      const addNativeBtn = tools.createEl("button", {
        cls: "bm-lk-btn is-sm",
        title: "通过 Windows 文件窗口挑选任意位置视频加入暂存区"
      });
      addNativeBtn.appendChild(v07Core.icon("plus", 13));
      addNativeBtn.createSpan({ text: "添加文件…" });
      addNativeBtn.onclick = async () => {
        const picked = await pickNativeFilesOnDesktop({
          title: "选择视频文件放入暂存区",
          initialDir: this.currentDir,
          multi: true
        });
        if (picked && picked.length > 0) {
          await indexSvc.addItemsToStagingPool(this.plugin, picked);
          this.showSavedFlash();
          this.renderStagingPane();
        }
      };

      if (healthList.some((e) => Array.isArray(e.linkedAnimeKeys) && e.linkedAnimeKeys.length > 0)) {
        const pruneBtn = tools.createEl("button", {
          cls: "bm-lk-btn is-sm is-ghost",
          text: "清理已关联"
        });
        pruneBtn.onclick = async () => {
          await indexSvc.clearStagingPool(this.plugin, { linkedOnly: true });
          this.stagingSelectedIds.clear();
          this.renderStagingPane();
        };
      }

      if (healthList.length > 0) {
        const clearBtn = tools.createEl("button", {
          cls: `bm-lk-btn is-sm ${this.stagingClearPending ? "is-danger-soft" : "is-ghost"}`,
          text: this.stagingClearPending ? "确认清空" : "清空"
        });
        clearBtn.onclick = async () => {
          if (!this.stagingClearPending) {
            this.stagingClearPending = true;
            this.renderStagingPane();
            setTimeout(() => {
              if (this.stagingClearPending) {
                this.stagingClearPending = false;
                this.renderStagingPane();
              }
            }, 3500);
            return;
          }
          this.stagingClearPending = false;
          this.stagingSelectedIds.clear();
          await indexSvc.clearStagingPool(this.plugin, { linkedOnly: false });
          this.renderStagingPane();
        };
      }

      const listEl = this.stagingCardEl.createDiv("bm-lk-scroll-list");

      if (visibleList.length === 0) {
        const emptyBox = listEl.createDiv("bm-lk-empty-drop");
        emptyBox.appendChild(v07Core.icon("film", 22));
        emptyBox.createDiv({
          text:
            healthList.length > 0
              ? "所有暂存文件都已关联到右侧动画，可取消勾选「隐藏已关联」查看。"
              : "把左边找到的文件或文件夹拖到这里暂存，也可以直接从电脑文件夹窗口拖进来。整理状态随时自动保存。"
        });
      } else {
        const renderSingleEntry = (hostEl, entry) => {
          const isSel = this.stagingSelectedIds.has(entry.id);
          const isLinked = Array.isArray(entry.linkedAnimeKeys) && entry.linkedAnimeKeys.length > 0;
          const row = hostEl.createDiv(`bm-lk-file-row ${isSel ? "is-selected" : ""}`);
          row.dataset.kind = entry.kind;
          row.draggable = entry.status === "ok";
          row.title = entry.path;

          const dotCls =
            entry.status === "ok" ? "is-ok" : entry.status === "drive_offline" ? "is-offline" : "is-missing";
          row.createSpan({
            cls: `bm-lk-status-dot ${dotCls}`,
            title:
              entry.status === "ok"
                ? "本地文件正常"
                : entry.status === "drive_offline"
                ? "所在磁盘尚未接入"
                : "原文件已移动或找不到"
          });

          const ico = row.createSpan({ cls: "bm-lk-file-ico" });
          ico.appendChild(v07Core.icon(entry.kind === "folder" ? "folder" : "film", 14));

          const main = row.createDiv("bm-lk-file-main");
          main.createDiv({ cls: "bm-lk-file-name", text: entry.name });
          const subBits = [];
          if (entry.kind === "folder") {
            subBits.push(`${entry.videoCount || 0} 个视频`);
          } else if (entry.size > 0) {
            subBits.push(formatBytesText(entry.size));
          }
          if (entry.status === "drive_offline") subBits.push("磁盘未接入");
          else if (entry.status === "missing") subBits.push("文件已丢失");
          if (isLinked) subBits.push("已关联");
          if (subBits.length > 0) {
            main.createDiv({ cls: "bm-lk-file-sub", text: subBits.join(" · ") });
          }

          if (entry.detectedEp !== null && entry.detectedEp !== undefined) {
            row.createSpan({
              cls: "bm-lk-ep-tag",
              text: `第${String(entry.detectedEp).padStart(2, "0")}集`
            });
          }

          if (entry.status === "missing") {
            const fixBtn = row.createEl("button", {
              cls: "bm-lk-btn is-sm",
              text: "重新选择"
            });
            fixBtn.onclick = async (ev) => {
              ev.stopPropagation();
              if (entry.kind === "folder") {
                const p = await pickNativeFolderOnDesktop({ title: `重新定位「${entry.name}」` });
                if (p) await indexSvc.replaceStagingPoolItemPath(this.plugin, entry.id, p);
              } else {
                const ps = await pickNativeFilesOnDesktop({ title: `重新定位「${entry.name}」`, multi: false });
                if (ps[0]) await indexSvc.replaceStagingPoolItemPath(this.plugin, entry.id, ps[0]);
              }
              this.renderStagingPane();
            };
          }

          const rmBtn = row.createEl("button", {
            cls: "bm-lk-icon-btn",
            title: "从暂存区移除（不会删除硬盘文件）"
          });
          rmBtn.appendChild(v07Core.icon("close", 13));
          rmBtn.onclick = async (ev) => {
            ev.stopPropagation();
            this.stagingSelectedIds.delete(entry.id);
            await indexSvc.removeFromStagingPool(this.plugin, entry.id);
            this.renderStagingPane();
          };

          row.onclick = (ev) => {
            if (ev.ctrlKey || ev.metaKey) {
              if (this.stagingSelectedIds.has(entry.id)) this.stagingSelectedIds.delete(entry.id);
              else this.stagingSelectedIds.add(entry.id);
            } else {
              const wasOnly = this.stagingSelectedIds.has(entry.id) && this.stagingSelectedIds.size === 1;
              this.stagingSelectedIds.clear();
              if (!wasOnly) this.stagingSelectedIds.add(entry.id);
            }
            this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
            if (this.rightPaneMode === "list") {
              this.renderRightAnimePane();
            }
          };

          if (entry.status === "ok") {
            row.addEventListener("dragstart", (ev) => {
              const selectedPool = this.stagingSelectedIds.has(entry.id) && this.stagingSelectedIds.size > 1
                ? visibleList.filter((v) => this.stagingSelectedIds.has(v.id) && v.status === "ok")
                : [entry];
              this.dragPayload = {
                source: "staging",
                items: selectedPool.map((x) => ({
                  id: x.id,
                  path: x.path,
                  kind: x.kind,
                  name: x.name,
                  detectedEp: x.detectedEp
                }))
              };
              row.classList.add("is-dragging");
              if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = "copy";
                try {
                  ev.dataTransfer.setData("application/x-bangumi-media", JSON.stringify(this.dragPayload));
                  ev.dataTransfer.setData("text/plain", selectedPool.map((i) => i.path).join("\n"));
                } catch (_) {}
              }
            });
            row.addEventListener("dragend", () => {
              row.classList.remove("is-dragging");
              this.dragPayload = null;
              this.clearAllDragHints();
            });
          }
        };

        if (this.stagingGroupByFolder) {
          // 按 parentPath 归组超过 1 个单文件的条目，文件夹或独个文件直接展示
          const groups = new Map();
          const singles = [];
          for (const entry of visibleList) {
            if (entry.kind === "file" && entry.parentPath) {
              const pk = indexSvc.normPathCompareKey(entry.parentPath);
              if (!groups.has(pk)) groups.set(pk, { parentPath: entry.parentPath, parentName: entry.parentName, items: [] });
              groups.get(pk).items.push(entry);
            } else {
              singles.push(entry);
            }
          }

          for (const entry of singles) {
            renderSingleEntry(listEl, entry);
          }

          for (const [pk, grp] of groups.entries()) {
            if (grp.items.length === 1) {
              renderSingleEntry(listEl, grp.items[0]);
              continue;
            }
            const isExpanded = this.stagingExpandedGroups.has(pk);
            const stack = listEl.createDiv("bm-lk-stg-stack");
            const sHead = stack.createDiv("bm-lk-stg-stack-head");
            sHead.draggable = true;
            sHead.title = `按住整叠拖给右侧动画，或点击展开逐个绑定集数\n${grp.parentPath}`;

            const chevron = sHead.createSpan({ cls: "bm-lk-file-ico" });
            chevron.appendChild(v07Core.icon(isExpanded ? "chevronDown" : "chevronRight", 14));
            const grpMissingCount = grp.items.filter((x) => x.status !== "ok").length;
            if (grpMissingCount > 0) {
              const hasOff = grp.items.some((x) => x.status === "drive_offline");
              sHead.createSpan({
                cls: `bm-lk-status-dot ${hasOff ? "is-offline" : "is-missing"}`,
                title: `其中 ${grpMissingCount} 个文件路径待确认`
              });
            }
            const fIco = sHead.createSpan({ cls: "bm-lk-file-ico" });
            fIco.appendChild(v07Core.icon("folder", 14));
            const sMain = sHead.createDiv("bm-lk-file-main");
            sMain.createDiv({ cls: "bm-lk-file-name", text: `${grp.parentName || grp.parentPath}` });
            sMain.createDiv({
              cls: `bm-lk-file-sub ${grpMissingCount > 0 ? "is-warn-txt" : ""}`,
              text:
                grpMissingCount > 0
                  ? `含 ${grp.items.length} 个视频 · ${grpMissingCount} 个文件丢失（展开可重定位）`
                  : `包含 ${grp.items.length} 个视频文件（可整叠拖放）`
            });

            const selAllBtn = sHead.createEl("button", {
              cls: "bm-lk-btn is-sm is-ghost",
              text: "全选"
            });
            selAllBtn.onclick = (ev) => {
              ev.stopPropagation();
              for (const sub of grp.items) {
                if (sub.status === "ok") this.stagingSelectedIds.add(sub.id);
              }
              this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
              if (this.rightPaneMode === "list") {
                this.renderRightAnimePane();
              }
            };

            sHead.onclick = () => {
              if (this.stagingExpandedGroups.has(pk)) this.stagingExpandedGroups.delete(pk);
              else this.stagingExpandedGroups.add(pk);
              this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
            };

            sHead.addEventListener("dragstart", (ev) => {
              const okItems = grp.items.filter((x) => x.status === "ok");
              if (okItems.length === 0) {
                ev.preventDefault();
                return;
              }
              this.dragPayload = {
                source: "staging",
                items: okItems.map((x) => ({
                  id: x.id,
                  path: x.path,
                  kind: x.kind,
                  name: x.name,
                  detectedEp: x.detectedEp
                }))
              };
              if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = "copy";
                try {
                  ev.dataTransfer.setData("application/x-bangumi-media", JSON.stringify(this.dragPayload));
                } catch (_) {}
              }
            });
            sHead.addEventListener("dragend", () => {
              this.dragPayload = null;
              this.clearAllDragHints();
            });

            if (isExpanded) {
              const childBox = stack.createDiv("bm-lk-stg-stack-children");
              for (const sub of grp.items) {
                renderSingleEntry(childBox, sub);
              }
            }
          }
        } else {
          for (const entry of visibleList) {
            renderSingleEntry(listEl, entry);
          }
        }
      }

      if (this.stagingSelectedIds.size > 0) {
        const selBar = this.stagingCardEl.createDiv("bm-lk-selection-bar");
        selBar.createSpan({
          text: `已选 ${this.stagingSelectedIds.size} 项：直接拖到右侧动画，或点击「关联到这部」`
        });
        const clr = selBar.createEl("button", {
          cls: "bm-lk-btn is-sm is-ghost",
          text: "取消选择"
        });
        clr.onclick = () => {
          this.stagingSelectedIds.clear();
          this.renderStagingPane({ skipHeaderSync: true, skipRightSync: true });
          if (this.rightPaneMode === "list") {
            this.renderRightAnimePane();
          }
        };
      }
    }

    /* ============================== 右侧：动画笔记与集数胶片槽 ============================== */

    clearAllDragHints() {
      if (!this.shell) return;
      this.shell.querySelectorAll(".is-drop-over, .is-drag-target-hint").forEach((el) => {
        el.classList.remove("is-drop-over", "is-drag-target-hint");
      });
    }

    getSelectedStagingItems() {
      if (this.stagingSelectedIds.size === 0) return [];
      const healthList = indexSvc.inspectStagingPoolHealth(this.plugin);
      return healthList.filter((e) => this.stagingSelectedIds.has(e.id) && e.status === "ok");
    }

    async associateItemsWithAnime(animeItem, rawMediaItems, targetEpSlot = null, targetExtra = false) {
      if (!animeItem || !Array.isArray(rawMediaItems) || rawMediaItems.length === 0) return;

      if (targetExtra) {
        for (const m of rawMediaItems) {
          if (m.kind === "file") {
            await indexSvc.bindExtraClipToAnime(this.plugin, animeItem, m.path, "特典");
          }
        }
      } else if (targetEpSlot !== null && targetEpSlot !== undefined) {
        const firstFile = rawMediaItems.find((m) => m.kind === "file");
        if (firstFile) {
          await indexSvc.bindEpisodeFileToAnime(this.plugin, animeItem, targetEpSlot, firstFile.path);
        } else if (rawMediaItems[0]?.kind === "folder") {
          await indexSvc.bindFolderToAnime(this.plugin, animeItem, rawMediaItems[0].path);
        }
      } else {
        const folders = rawMediaItems.filter((m) => m.kind === "folder").map((m) => m.path);
        const files = rawMediaItems.filter((m) => m.kind === "file").map((m) => m.path);
        for (const f of folders) {
          await indexSvc.bindFolderToAnime(this.plugin, animeItem, f);
        }
        if (files.length > 0) {
          await indexSvc.bindLooseFilesToAnime(this.plugin, animeItem, files);
        }
      }

      this.stagingSelectedIds.clear();
      const key = indexSvc.getAnimeBindingKey(animeItem);
      this.expandedAnimeKeys.add(key);
      if (targetEpSlot !== null && targetEpSlot !== undefined) {
        this.expandedEpisodeByAnime.set(key, Number(targetEpSlot));
      }

      await this.notifyVaultChanged();
      this.renderStagingPane({ skipRightSync: true });
      this.renderRightColumn();
      if (NoticeClass) {
        new NoticeClass(
          targetEpSlot !== null && targetEpSlot !== undefined
            ? `已将视频关联至《${animeItem.name}》第 ${String(targetEpSlot).padStart(2, "0")} 集`
            : `已将 ${rawMediaItems.length} 项关联至《${animeItem.name}》（原文件位置不变）`,
          3200
        );
      }
    }

    triggerRightPaneEnterAnimation() {
      if (!this.rightColEl) return;
      const tier = this.shell?.getAttribute("data-bm7-motion-tier") || "full";
      if (tier === "off") return;
      this.rightColEl.classList.remove("bm-lk-pane-enter");
      void this.rightColEl.offsetWidth;
      this.rightColEl.classList.add("bm-lk-pane-enter");
    }

    renderRightAttentionPane(cachedSummary = null, animate = false) {
      if (!this.rightColEl) return;
      v07Core.clear(this.rightColEl);
      if (animate) this.triggerRightPaneEnterAnimation();

      const desktop = isDesktopNodeAvailable();
      const summary = cachedSummary || this.computeSummaryStats();
      const resolveMap = summary.resolveMap;
      const stagingHealth = desktop ? indexSvc.inspectStagingPoolHealth(this.plugin) : [];
      const stagingIssues = stagingHealth.filter((s) => s.status !== "ok");

      const animeMissingList = [];
      const otherAttentionList = [];
      for (const it of this.allItems) {
        const key = indexSvc.getAnimeBindingKey(it);
        const res = resolveMap.get(key);
        if (res?.hasMissingMedia) {
          animeMissingList.push({ item: it, key, res });
        } else if (res?.hasAttentionNeeded) {
          otherAttentionList.push({ item: it, key, res });
        }
      }

      const warnTotal = stagingIssues.length + animeMissingList.length;

      // 顶部栏
      const head = this.rightColEl.createDiv(`bm-lk-attn-header ${warnTotal === 0 ? "is-ok" : ""}`);
      const titleWrap = head.createDiv("bm-lk-attn-title-wrap");
      const titleEl = titleWrap.createDiv("bm-lk-attn-title");
      titleEl.appendChild(v07Core.icon(warnTotal > 0 ? "alert" : "check", 16));
      titleEl.createSpan({ text: "路径待确认" });

      titleWrap.createSpan({
        cls: `bm-lk-attn-count ${warnTotal === 0 ? "is-ok" : ""}`,
        text: warnTotal > 0 ? `共 ${warnTotal} 处异常` : "全部已恢复正常"
      });

      const backBtn = head.createEl("button", {
        cls: "bm-lk-btn is-sm",
        attr: { type: "button" }
      });
      backBtn.appendChild(v07Core.icon("chevronLeft", 13));
      backBtn.createSpan({ text: "返回动画列表" });
      backBtn.onclick = () => {
        this.rightPaneMode = "list";
        this.syncWarnPillActiveState();
        this.renderRightColumn({ animate: true });
      };

      const body = this.rightColEl.createDiv("bm-lk-attn-body");

      // 1. 盘符迁移快捷卡
      if (desktop) {
        const relinks = indexSvc.detectDriveRelinkCandidates(this.plugin, this.allItems);
        if (relinks.length > 0) {
          const topSug = relinks[0];
          const drvCard = body.createDiv("bm-lk-attn-card");
          const dHead = drvCard.createDiv("bm-lk-attn-card-head");
          dHead.createSpan({
            attr: { style: "font-size:13px;font-weight:700;" },
            text: `检测到 ${topSug.fromDrive} 盘未接入，但在 ${topSug.toDrive} 盘找到 ${topSug.matchedCount} 处同名动画路径`
          });
          const dActs = dHead.createDiv("bm-lk-attn-acts");
          const fixDrvBtn = dActs.createEl("button", {
            cls: "bm-lk-btn is-sm is-primary",
            attr: { type: "button" },
            text: `一键修正为 ${topSug.toDrive} 盘`
          });
          fixDrvBtn.onclick = async () => {
            fixDrvBtn.disabled = true;
            const r = await indexSvc.applyPathPrefixRemap(this.plugin, topSug.fromDrive, topSug.toDrive, this.allItems);
            if (NoticeClass) new NoticeClass(`已更新 ${r.updatedCount} 条本地路径至 ${topSug.toDrive} 盘`, 3600);
            await this.notifyVaultChanged();
            this.renderAll();
          };
        }
      }

      // 2. 暂存区丢失 / 磁盘未接入项
      if (desktop && stagingIssues.length > 0) {
        const sec = body.createDiv("bm-lk-attn-sec");
        const sHead = sec.createDiv("bm-lk-attn-sec-head");
        sHead.createSpan({ text: `暂存区丢失或磁盘未接入（${stagingIssues.length} 项）` });
        if (stagingIssues.length >= 2) {
          const cleanAllBtn = sHead.createEl("button", {
            cls: "bm-lk-btn is-sm is-danger-soft",
            attr: { type: "button" },
            text: "一键清理失效项"
          });
          cleanAllBtn.onclick = async () => {
            const rmIds = stagingIssues.map((s) => s.id);
            for (const rid of rmIds) this.stagingSelectedIds.delete(rid);
            await indexSvc.removeFromStagingPool(this.plugin, rmIds);
            this.renderStagingPane({ skipRightSync: true });
            this.renderRightColumn();
          };
        }

        const card = sec.createDiv("bm-lk-attn-card is-missing-card");
        for (const entry of stagingIssues) {
          const itemRow = card.createDiv("bm-lk-attn-item");
          const mainCol = itemRow.createDiv("bm-lk-attn-item-main");
          const topLine = mainCol.createDiv("bm-lk-attn-item-top");
          topLine.appendChild(v07Core.icon(entry.kind === "folder" ? "folder" : "film", 13));
          topLine.createSpan({ text: entry.name || "未命名项目" });
          topLine.createSpan({
            cls: `bm-lk-attn-status ${entry.status === "drive_offline" ? "is-offline" : ""}`,
            text: entry.status === "drive_offline" ? "磁盘未接入" : "原文件已丢失"
          });
          const pathDiv = mainCol.createDiv({
            cls: "bm-lk-attn-path",
            text: entry.path || "",
            title: entry.path || ""
          });
          void pathDiv;

          const acts = itemRow.createDiv("bm-lk-attn-acts");
          const repickBtn = acts.createEl("button", {
            cls: "bm-lk-btn is-sm",
            attr: { type: "button" },
            text: "重新选择"
          });
          repickBtn.onclick = async () => {
            if (entry.kind === "folder") {
              const p = await pickNativeFolderOnDesktop({ title: `重新定位「${entry.name}」` });
              if (p) await indexSvc.replaceStagingPoolItemPath(this.plugin, entry.id, p);
            } else {
              const ps = await pickNativeFilesOnDesktop({ title: `重新定位「${entry.name}」`, multi: false });
              if (ps[0]) await indexSvc.replaceStagingPoolItemPath(this.plugin, entry.id, ps[0]);
            }
            this.renderStagingPane({ skipRightSync: true });
            this.renderRightColumn();
          };

          const rmBtn = acts.createEl("button", {
            cls: "bm-lk-btn is-sm is-ghost",
            attr: { type: "button" },
            text: "移出"
          });
          rmBtn.onclick = async () => {
            this.stagingSelectedIds.delete(entry.id);
            await indexSvc.removeFromStagingPool(this.plugin, entry.id);
            this.renderStagingPane({ skipRightSync: true });
            this.renderRightColumn();
          };
        }
      }

      // 3. 动画关联路径失效
      if (animeMissingList.length > 0) {
        const sec = body.createDiv("bm-lk-attn-sec");
        const sHead = sec.createDiv("bm-lk-attn-sec-head");
        sHead.createSpan({ text: `动画笔记关联路径失效（${animeMissingList.length} 部）` });

        for (const { item, key, res } of animeMissingList) {
          const card = sec.createDiv("bm-lk-attn-card is-missing-card");
          const cHead = card.createDiv("bm-lk-attn-card-head");
          const cInfo = cHead.createDiv("bm-lk-attn-card-info");
          let coverUrl = "";
          try {
            coverUrl = item.cover ? this.plugin.getCoverResourceUrl(item.cover, item.file?.path || "") : "";
          } catch (_) {}
          cInfo.appendChild(v07Core.coverEl(coverUrl, item.name, "bm-lk-attn-mini-cover"));

          const nameBlock = cInfo.createDiv({ attr: { style: "min-width:0;display:flex;flex-direction:column;gap:2px;" } });
          nameBlock.createDiv({
            attr: { style: "font-size:13.5px;font-weight:720;color:var(--bm7-ink);overflow-wrap:anywhere;" },
            text: item.name || "未命名动画"
          });
          nameBlock.createDiv({
            attr: { style: "font-size:12px;color:var(--bm7-live);" },
            text: `${res.missingItems.length} 处路径异常`
          });

          const jumpBtn = cHead.createEl("button", {
            cls: "bm-lk-btn is-sm is-ghost",
            attr: { type: "button" },
            text: "在列表中展开"
          });
          jumpBtn.onclick = () => {
            this.rightPaneMode = "list";
            this.animeLinkFilter = "all";
            this.animeWatchFilter = "all";
            this.focusKey = key;
            this.expandedAnimeKeys.add(key);
            this.syncWarnPillActiveState();
            this.renderRightColumn({ animate: true });
          };

          for (const m of res.missingItems || []) {
            const slotLabel =
              m.kind === "folder"
                ? m.isPrimary
                  ? "主文件夹"
                  : "额外文件夹"
                : m.kind === "episode"
                ? `第 ${String(m.episode).padStart(2, "0")} 集`
                : m.kind === "extra_clip"
                ? "特典 / OVA"
                : "散落视频";

            const row = card.createDiv("bm-lk-attn-item");
            const mainCol = row.createDiv("bm-lk-attn-item-main");
            const topLine = mainCol.createDiv("bm-lk-attn-item-top");
            topLine.createSpan({ cls: "bm-lk-attn-slot-tag", text: slotLabel });
            topLine.createSpan({
              cls: `bm-lk-attn-status ${m.status === "drive_offline" ? "is-offline" : ""}`,
              text: m.status === "drive_offline" ? "磁盘未接入" : "文件或目录丢失"
            });
            mainCol.createDiv({
              cls: "bm-lk-attn-path",
              text: m.path || m.name || "",
              title: m.path || ""
            });

            if (desktop) {
              const acts = row.createDiv("bm-lk-attn-acts");
              const repickBtn = acts.createEl("button", {
                cls: "bm-lk-btn is-sm",
                attr: { type: "button" },
                text: "重新选择"
              });
              repickBtn.onclick = async () => {
                if (m.kind === "folder") {
                  const nextDir = await pickNativeFolderOnDesktop({
                    title: `重新定位《${item.name}》文件夹`,
                    initialDir: this.currentDir
                  });
                  if (nextDir) {
                    await indexSvc.unbindFolderFromAnime(this.plugin, item, m.path);
                    await indexSvc.bindFolderToAnime(this.plugin, item, nextDir, { replacePrimary: Boolean(m.isPrimary) });
                  }
                } else if (m.kind === "episode") {
                  const picked = await pickNativeFilesOnDesktop({
                    title: `重新定位《${item.name}》第 ${String(m.episode).padStart(2, "0")} 集`,
                    initialDir: this.currentDir,
                    multi: false
                  });
                  if (picked[0]) {
                    await indexSvc.bindEpisodeFileToAnime(this.plugin, item, m.episode, picked[0]);
                  }
                } else if (m.kind === "extra_clip") {
                  const picked = await pickNativeFilesOnDesktop({
                    title: `重新定位《${item.name}》特典视频`,
                    initialDir: this.currentDir,
                    multi: false
                  });
                  if (picked[0]) {
                    await indexSvc.unbindExtraClipFromAnime(this.plugin, item, m.path);
                    await indexSvc.bindExtraClipToAnime(this.plugin, item, picked[0], "特典");
                  }
                } else {
                  const picked = await pickNativeFilesOnDesktop({
                    title: `重新定位《${item.name}》视频文件`,
                    initialDir: this.currentDir,
                    multi: false
                  });
                  if (picked[0]) {
                    await indexSvc.unbindLooseFileFromAnime(this.plugin, item, m.path);
                    await indexSvc.bindLooseFilesToAnime(this.plugin, item, [picked[0]]);
                  }
                }
                await this.notifyVaultChanged();
                this.renderStagingPane({ skipRightSync: true, skipHeaderSync: true });
                this.renderRightColumn();
              };

              const unbindBtn = acts.createEl("button", {
                cls: "bm-lk-btn is-sm is-ghost",
                attr: { type: "button", title: "仅解除失效关联，不会删除硬盘上的任何文件" },
                text: "解除失效关联"
              });
              unbindBtn.onclick = async () => {
                if (m.kind === "folder") {
                  await indexSvc.unbindFolderFromAnime(this.plugin, item, m.path);
                } else if (m.kind === "episode") {
                  await indexSvc.unbindEpisodeFileFromAnime(this.plugin, item, m.episode);
                } else if (m.kind === "extra_clip") {
                  await indexSvc.unbindExtraClipFromAnime(this.plugin, item, m.path);
                } else {
                  await indexSvc.unbindLooseFileFromAnime(this.plugin, item, m.path);
                }
                await this.notifyVaultChanged();
                this.renderStagingPane({ skipRightSync: true, skipHeaderSync: true });
                this.renderRightColumn();
              };
            }
          }
        }
      }

      // 4. 全部路径正常时的柔和确认卡
      if (warnTotal === 0) {
        const okCard = body.createDiv("bm-lk-attn-ok-card");
        const okIco = okCard.createDiv("bm-lk-attn-ok-icon");
        okIco.appendChild(v07Core.icon("check", 22));
        okCard.createDiv({
          attr: { style: "font-size:15px;font-weight:750;color:var(--bm7-ink);" },
          text: "所有路径都已恢复正常"
        });
        okCard.createDiv({
          attr: { style: "font-size:12.5px;color:var(--bm7-ink-2);max-width:340px;line-height:1.55;" },
          text: "暂存区和动画笔记已关联的本地视频、文件夹目前都可正常访问。"
        });
        const goBackBtn = okCard.createEl("button", {
          cls: "bm-lk-btn is-primary",
          attr: { type: "button" },
          text: "返回动画列表"
        });
        goBackBtn.onclick = () => {
          this.rightPaneMode = "list";
          this.syncWarnPillActiveState();
          this.renderRightColumn({ animate: true });
        };
      }

      // 5. 其他整理建议（如误绑总目录 / 多版本 / 未标集数，仅作辅助分组）
      if (otherAttentionList.length > 0) {
        const sec = body.createDiv("bm-lk-attn-sec");
        const sHead = sec.createDiv("bm-lk-attn-sec-head");
        sHead.createSpan({ text: `其他整理提醒（${otherAttentionList.length} 部）` });

        for (const { item, key, res } of otherAttentionList.slice(0, 20)) {
          const card = sec.createDiv("bm-lk-attn-card");
          const cHead = card.createDiv("bm-lk-attn-card-head");
          cHead.createSpan({
            attr: { style: "font-size:13px;font-weight:700;" },
            text: item.name || "未命名动画"
          });
          const goBtn = cHead.createEl("button", {
            cls: "bm-lk-btn is-sm is-ghost",
            attr: { type: "button" },
            text: "在列表中处理"
          });
          goBtn.onclick = () => {
            this.rightPaneMode = "list";
            this.animeLinkFilter = "all";
            this.animeWatchFilter = "all";
            this.focusKey = key;
            this.expandedAnimeKeys.add(key);
            this.syncWarnPillActiveState();
            this.renderRightColumn({ animate: true });
          };

          const anom = res?.anomalies || {};
          if (anom.suspectedParentContainer?.detected) {
            const hint = card.createDiv({
              attr: { style: "font-size:12px;color:var(--bm7-ink-2);" },
              text: `「${anom.suspectedParentContainer.folderName}」内含多部动画，可直接选中对应的作品子文件夹：`
            });
            void hint;
            if (desktop) {
              const btnWrap = card.createDiv("bm-lk-pane-tools");
              const pathMod = tryRequireNode("path");
              for (const childName of (anom.suspectedParentContainer.childDirNames || []).slice(0, 6)) {
                const cBtn = btnWrap.createEl("button", {
                  cls: "bm-lk-btn is-sm",
                  attr: { type: "button" },
                  text: childName
                });
                cBtn.onclick = async () => {
                  const base = anom.suspectedParentContainer.sourceFolder || item.downloadPath;
                  const nextDir = pathMod ? pathMod.join(base, childName) : `${base}/${childName}`;
                  await indexSvc.bindFolderToAnime(this.plugin, item, nextDir, { replacePrimary: true });
                  await this.notifyVaultChanged();
                  this.renderRightColumn();
                };
              }
            }
          } else {
            const notes = [];
            if (anom.duplicateEpisodes?.length > 0) {
              notes.push(`${anom.duplicateEpisodes.length} 集存在多个视频版本可挑选默认播放`);
            }
            if (anom.unnumberedMultipleVideos?.length > 0) {
              notes.push(`发现 ${anom.unnumberedMultipleVideos.length} 个未标集数视频`);
            }
            if (notes.length > 0) {
              card.createDiv({
                attr: { style: "font-size:12px;color:var(--bm7-ink-2);" },
                text: notes.join("；")
              });
            }
          }
        }
      }
    }

    renderRightAnimePane(cachedSummary = null, animate = false) {
      if (!this.rightColEl) return;
      v07Core.clear(this.rightColEl);
      if (animate) this.triggerRightPaneEnterAnimation();

      const desktop = isDesktopNodeAvailable();
      const summary = cachedSummary || this.computeSummaryStats();
      const resolveMap = summary.resolveMap;

      // 顶部搜索与筛选栏（搜索与状态同排 + 分段筛选独占一行，零孤立下拉）
      const toolbar = this.rightColEl.createDiv("bm-lk-anime-toolbar");
      const searchRow = toolbar.createDiv("bm-lk-anime-search-row");
      const searchInput = searchRow.createEl("input", {
        type: "text",
        cls: "bm-lk-input",
        placeholder: "搜索动画名称、日文名或年份…",
        value: this.animeSearch
      });
      searchInput.oninput = () => {
        this.animeSearch = searchInput.value;
        this.animeChunkLimit = 28;
        this.renderAnimeListOnly(resolveMap);
      };

      const stateSel = searchRow.createEl("select", { cls: "bm-lk-select" });
      for (const stOpt of [
        { v: "all", t: "全部进度" },
        { v: "在看", t: "在看" },
        { v: "想看", t: "想看" },
        { v: "已看", t: "已看" },
        { v: "抛弃", t: "搁置" }
      ]) {
        const opt = stateSel.createEl("option", { value: stOpt.v, text: stOpt.t });
        if (this.animeWatchFilter === stOpt.v) opt.selected = true;
      }
      stateSel.onchange = () => {
        this.animeWatchFilter = stateSel.value;
        this.animeChunkLimit = 28;
        this.renderAnimeListOnly(resolveMap);
      };

      const counts = { all: 0, unlinked: 0, linked: 0, attention: 0 };
      for (const it of this.allItems) {
        const res = resolveMap.get(indexSvc.getAnimeBindingKey(it));
        counts.all += 1;
        const hasValid = Boolean(res?.hasAnyBinding && (res.fileCount > 0 || res.extraFiles?.length > 0 || res.folders?.some((f) => f.status === "ok")));
        if (hasValid) counts.linked += 1;
        else counts.unlinked += 1;
        if (res?.hasAttentionNeeded) counts.attention += 1;
      }

      const filterBar = toolbar.createDiv("bm-lk-anime-filter-row");
      const segFilter = v07Core.segmented(
        [
          { value: "all", label: "全部", count: counts.all },
          { value: "unlinked", label: "未关联", count: counts.unlinked },
          { value: "linked", label: "已关联", count: counts.linked },
          { value: "attention", label: "待确认", count: counts.attention }
        ],
        this.animeLinkFilter,
        (val) => {
          this.animeLinkFilter = val;
          this.animeChunkLimit = 28;
          this.renderAnimeListOnly(resolveMap);
        },
        "is-small"
      );
      filterBar.appendChild(segFilter);

      this.animeListHost = this.rightColEl.createDiv("bm-lk-anime-list");
      this.renderAnimeListOnly(resolveMap, desktop);
    }

    renderAnimeListOnly(resolveMap = null, desktop = isDesktopNodeAvailable()) {
      if (!this.animeListHost) return;
      v07Core.clear(this.animeListHost);
      const map = resolveMap || this.computeSummaryStats().resolveMap;

      const q = normalizeUnicodeNfc(String(this.animeSearch || "").trim()).toLowerCase();
      const filtered = this.allItems.filter((it) => {
        const key = indexSvc.getAnimeBindingKey(it);
        const res = map.get(key);
        const hasValid = Boolean(res?.hasAnyBinding && (res.fileCount > 0 || res.extraFiles?.length > 0 || res.folders?.some((f) => f.status === "ok")));
        if (this.animeLinkFilter === "linked" && !hasValid) return false;
        if (this.animeLinkFilter === "unlinked" && hasValid) return false;
        if (this.animeLinkFilter === "attention" && !res?.hasAttentionNeeded) return false;
        if (this.animeWatchFilter !== "all" && it.state !== this.animeWatchFilter) return false;
        if (q) {
          const hay = normalizeUnicodeNfc(`${it.name || ""} ${it.japaneseName || ""} ${it.year || ""}`).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      // 若由特定作品触发打开，置顶该作品
      if (this.focusKey) {
        filtered.sort((a, b) => {
          const ak = indexSvc.getAnimeBindingKey(a) === this.focusKey ? 1 : 0;
          const bk = indexSvc.getAnimeBindingKey(b) === this.focusKey ? 1 : 0;
          return bk - ak;
        });
      }

      if (filtered.length === 0) {
        this.animeListHost.createDiv({
          cls: "bm-lk-empty-drop",
          text: "没有符合当前筛选条件的动画笔记。"
        });
        return;
      }

      const selectedStaging = desktop ? this.getSelectedStagingItems() : [];
      const limit = Math.min(filtered.length, this.animeChunkLimit);

      for (let i = 0; i < limit; i++) {
        const item = filtered[i];
        this.renderOneAnimeCard(this.animeListHost, item, map.get(indexSvc.getAnimeBindingKey(item)), selectedStaging, desktop);
      }

      if (limit < filtered.length) {
        const moreWrap = this.animeListHost.createDiv();
        moreWrap.style.cssText = "display:flex;justify-content:center;padding:8px 0;";
        const moreBtn = moreWrap.createEl("button", {
          cls: "bm-lk-btn",
          text: `继续加载剩余 ${filtered.length - limit} 部动画`
        });
        moreBtn.onclick = () => {
          this.animeChunkLimit += 40;
          this.renderAnimeListOnly(map, desktop);
        };
      }
    }

    renderOneAnimeCard(host, item, resolved, selectedStaging, desktop) {
      const key = indexSvc.getAnimeBindingKey(item);
      const isExpanded = this.expandedAnimeKeys.has(key);
      const isFocused = this.focusKey === key;

      const card = host.createDiv(`bm-lk-anime-card ${isFocused ? "is-focused" : ""}`);
      card.dataset.animeKey = key;

      const topRow = card.createDiv("bm-lk-anime-top");
      let coverUrl = "";
      try {
        coverUrl = item.cover ? this.plugin.getCoverResourceUrl(item.cover, item.file?.path || "") : "";
      } catch (_) {}
      topRow.appendChild(v07Core.coverEl(coverUrl, item.name, "bm-lk-anime-cover"));

      const metaCol = topRow.createDiv("bm-lk-anime-meta");
      const titleRow = metaCol.createDiv("bm-lk-anime-title-row");
      const dotCls = resolved?.hasMissingMedia
        ? "is-missing"
        : resolved?.fileCount > 0 || resolved?.folders?.some((f) => f.status === "ok")
        ? "is-ok"
        : "";
      titleRow.createSpan({ cls: `bm-lk-status-dot ${dotCls}` });
      titleRow.createSpan({ cls: "bm-lk-anime-name", text: item.name || "未命名动画" });

      const subRow = metaCol.createDiv("bm-lk-anime-sub");
      const totalEpNum = Number(item.totalEpisodes) || 0;
      const watchedNum = Number(item.watchedEpisodes) || 0;
      subRow.createSpan({
        text: totalEpNum > 0 ? `已看 ${watchedNum} / ${totalEpNum} 集` : `已看 ${watchedNum} 集`
      });
      if (item.year) {
        subRow.createSpan({ text: `${item.year}${item.season ? ` · ${item.season}` : ""}` });
      }
      if (resolved?.fileCount > 0) {
        subRow.createSpan({
          text: `本地共 ${resolved.fileCount} 集${resolved.newCount > 0 ? `（待看 ${resolved.newCount} 集）` : ""}`
        });
      } else if (resolved?.hasAnyBinding) {
        subRow.createSpan({ text: resolved.error || "已关联（当前目录为空或未接入）" });
      } else {
        subRow.createSpan({ text: "尚未关联本地视频" });
      }

      const actsCol = topRow.createDiv("bm-lk-anime-acts");
      if (desktop && selectedStaging.length > 0) {
        const quickLinkBtn = actsCol.createEl("button", {
          cls: "bm-lk-btn is-sm is-primary",
          text: `关联选中 (${selectedStaging.length})`
        });
        quickLinkBtn.onclick = async (ev) => {
          ev.stopPropagation();
          await this.associateItemsWithAnime(item, selectedStaging, null, false);
        };
      }

      if (desktop) {
        const sysBtn = actsCol.createEl("button", {
          cls: "bm-lk-btn is-sm",
          title: "用 Windows 文件选择框关联文件夹或散落视频"
        });
        sysBtn.appendChild(v07Core.icon("folder", 13));
        sysBtn.createSpan({ text: "选择…" });
        sysBtn.onclick = (ev) => {
          ev.stopPropagation();
          v07Core.popover(
            sysBtn,
            (popBox, close) => {
              const addItem = (iconName, label, fn) => {
                const b = popBox.createEl("button", { cls: "bm7-menu-item", attr: { type: "button" } });
                b.appendChild(v07Core.icon(iconName, 14));
                b.createSpan({ text: label });
                b.onclick = async () => {
                  close();
                  await fn();
                };
              };
              addItem("folder", "选择整季文件夹关联…", async () => {
                const dir = await pickNativeFolderOnDesktop({
                  title: `为《${item.name}》选择本地动画文件夹`,
                  initialDir: item.downloadPath && item.downloadPath !== "无" ? item.downloadPath : this.currentDir
                });
                if (dir) {
                  await indexSvc.bindFolderToAnime(this.plugin, item, dir);
                  this.expandedAnimeKeys.add(key);
                  await this.notifyVaultChanged();
                  this.renderRightAnimePane();
                }
              });
              addItem("film", "选择一个或多个视频文件…", async () => {
                const files = await pickNativeFilesOnDesktop({
                  title: `为《${item.name}》选择本地视频文件`,
                  initialDir: this.currentDir,
                  multi: true
                });
                if (files.length > 0) {
                  await indexSvc.bindLooseFilesToAnime(this.plugin, item, files);
                  this.expandedAnimeKeys.add(key);
                  await this.notifyVaultChanged();
                  this.renderRightAnimePane();
                }
              });
              addItem("sparkles", "关联到特典 / OVA…", async () => {
                const files = await pickNativeFilesOnDesktop({
                  title: `为《${item.name}》选择特典或 OVA 视频`,
                  initialDir: this.currentDir,
                  multi: true
                });
                if (files.length > 0) {
                  for (const fp of files) {
                    await indexSvc.bindExtraClipToAnime(this.plugin, item, fp, "特典");
                  }
                  this.expandedAnimeKeys.add(key);
                  await this.notifyVaultChanged();
                  this.renderRightAnimePane();
                }
              });
            },
            { width: 220, alignRight: true, title: `关联《${item.name}》` }
          );
        };
      }

      const expandBtn = actsCol.createEl("button", {
        cls: "bm-lk-btn is-sm is-ghost"
      });
      expandBtn.appendChild(v07Core.icon(isExpanded ? "chevronDown" : "chevronRight", 14));
      expandBtn.createSpan({ text: isExpanded ? "收起" : "剧集" });
      expandBtn.onclick = () => {
        if (this.expandedAnimeKeys.has(key)) this.expandedAnimeKeys.delete(key);
        else this.expandedAnimeKeys.add(key);
        this.renderAnimeListOnly();
      };

      // 已关联路径条（主目录、额外目录、散落文件、缺失提醒）
      if (resolved?.folders?.length > 0 || resolved?.looseFiles?.length > 0) {
        const srcWrap = card.createDiv("bm-lk-sources-wrap");
        for (const fEntry of resolved.folders || []) {
          const stCls =
            fEntry.status === "missing" ? "is-missing" : fEntry.status === "drive_offline" ? "is-offline" : "";
          const chip = srcWrap.createDiv(`bm-lk-source-chip ${stCls}`);
          chip.appendChild(v07Core.icon("folder", 12));
          if (fEntry.isPrimary) chip.createSpan({ cls: "bm-lk-source-tag", text: "主" });
          const pSpan = chip.createSpan({ cls: "bm-lk-source-path", text: fEntry.path, title: fEntry.path });
          pSpan.onclick = () => desktop && fEntry.status === "ok" && noteUtils.openLocalPathSafely(fEntry.path);

          if (desktop && !fEntry.isPrimary && fEntry.status === "ok") {
            const setMainBtn = chip.createEl("button", {
              cls: "bm-lk-chip-mini-btn",
              title: "设为笔记里的主文件夹"
            });
            setMainBtn.appendChild(v07Core.icon("star", 11));
            setMainBtn.onclick = async (ev) => {
              ev.stopPropagation();
              await indexSvc.bindFolderToAnime(this.plugin, item, fEntry.path, { replacePrimary: true });
              await this.notifyVaultChanged();
              this.renderRightAnimePane();
            };
          }
          if (desktop && fEntry.status === "missing") {
            const fixFBtn = chip.createEl("button", {
              cls: "bm-lk-chip-mini-btn",
              title: "重新选择文件夹"
            });
            fixFBtn.appendChild(v07Core.icon("search", 11));
            fixFBtn.onclick = async (ev) => {
              ev.stopPropagation();
              const nextDir = await pickNativeFolderOnDesktop({ title: `重新定位《${item.name}》文件夹` });
              if (nextDir) {
                await indexSvc.unbindFolderFromAnime(this.plugin, item, fEntry.path);
                await indexSvc.bindFolderToAnime(this.plugin, item, nextDir, { replacePrimary: fEntry.isPrimary });
                await this.notifyVaultChanged();
                this.renderRightAnimePane();
              }
            };
          }
          if (desktop) {
            const unbindBtn = chip.createEl("button", {
              cls: "bm-lk-chip-mini-btn",
              title: "解除此文件夹关联（不删除硬盘文件夹）"
            });
            unbindBtn.appendChild(v07Core.icon("close", 11));
            unbindBtn.onclick = async (ev) => {
              ev.stopPropagation();
              await indexSvc.unbindFolderFromAnime(this.plugin, item, fEntry.path);
              await this.notifyVaultChanged();
              this.renderRightAnimePane();
            };
          }
        }

        for (const lf of resolved.looseFiles || []) {
          const stCls = lf.status === "missing" ? "is-missing" : lf.status === "drive_offline" ? "is-offline" : "";
          const chip = srcWrap.createDiv(`bm-lk-source-chip ${stCls}`);
          chip.appendChild(v07Core.icon("film", 12));
          chip.createSpan({ cls: "bm-lk-source-path", text: lf.name, title: lf.path });
          if (desktop) {
            const unbindBtn = chip.createEl("button", {
              cls: "bm-lk-chip-mini-btn",
              title: "解除该文件关联（不删除原文件）"
            });
            unbindBtn.appendChild(v07Core.icon("close", 11));
            unbindBtn.onclick = async (ev) => {
              ev.stopPropagation();
              await indexSvc.unbindLooseFileFromAnime(this.plugin, item, lf.path);
              await this.notifyVaultChanged();
              this.renderRightAnimePane();
            };
          }
        }
      }

      // 异常与多子目录智能引导提醒
      const anom = resolved?.anomalies || {};
      if (anom.suspectedParentContainer?.detected) {
        const wBox = card.createDiv("bm-lk-warn-box");
        wBox.createDiv({
          text: `「${anom.suspectedParentContainer.folderName}」内同时包含多部不同动画，请选择下面对应的作品文件夹：`
        });
        const btnWrap = wBox.createDiv("bm-lk-pane-tools");
        const pathMod = tryRequireNode("path");
        for (const childName of (anom.suspectedParentContainer.childDirNames || []).slice(0, 8)) {
          const cBtn = btnWrap.createEl("button", {
            cls: "bm-lk-btn is-sm",
            text: childName
          });
          cBtn.onclick = async () => {
            const base = anom.suspectedParentContainer.sourceFolder || item.downloadPath;
            const nextDir = pathMod ? pathMod.join(base, childName) : `${base}/${childName}`;
            await indexSvc.bindFolderToAnime(this.plugin, item, nextDir, { replacePrimary: true });
            await this.notifyVaultChanged();
            this.renderRightAnimePane();
          };
        }
      } else if (Array.isArray(anom.unnumberedMultipleVideos) && anom.unnumberedMultipleVideos.length > 0) {
        const wBox = card.createDiv("bm-lk-warn-box");
        wBox.createDiv({
          text: `发现 ${anom.unnumberedMultipleVideos.length} 个未标集数的视频文件（${anom.unnumberedMultipleVideos.slice(0, 2).join("、")}），可展开集数后点击或拖到对应格子指定集数。`
        });
      }

      // 卡片级拖放接管（含悬停自动展开剧集 + 匹配集数脉冲预览）
      if (desktop) {
        card.addEventListener("dragover", (ev) => {
          if (!this.isDragEventSupported(ev)) return;
          ev.preventDefault();
          ev.stopPropagation();
          card.classList.add("is-drop-over");

          if (!this.expandedAnimeKeys.has(key) && !this.hoverExpandTimer) {
            this.hoverExpandTimer = setTimeout(() => {
              this.hoverExpandTimer = null;
              this.expandedAnimeKeys.add(key);
              this.renderAnimeListOnly();
            }, 340);
          }

          // 若正在拖动单集且集数可识别，给对应集数格亮起柔和引导高亮
          const epHints = new Set(
            (this.dragPayload?.items || []).map((x) => x.detectedEp).filter((e) => e !== null && e !== undefined)
          );
          if (epHints.size > 0) {
            card.querySelectorAll(".bm-lk-ep-slot").forEach((slotEl) => {
              const epVal = Number(slotEl.dataset.epSlot);
              slotEl.classList.toggle("is-drag-target-hint", epHints.has(epVal));
            });
          }
        });

        card.addEventListener("dragleave", (ev) => {
          if (!card.contains(ev.relatedTarget)) {
            card.classList.remove("is-drop-over");
            card.querySelectorAll(".is-drag-target-hint").forEach((el) => el.classList.remove("is-drag-target-hint"));
            if (this.hoverExpandTimer) {
              clearTimeout(this.hoverExpandTimer);
              this.hoverExpandTimer = null;
            }
          }
        });

        card.addEventListener("drop", async (ev) => {
          card.classList.remove("is-drop-over");
          if (this.hoverExpandTimer) {
            clearTimeout(this.hoverExpandTimer);
            this.hoverExpandTimer = null;
          }
          // 若落在了具体的集数格或特典区，由它们处理
          if (ev.target && ev.target.closest && ev.target.closest("[data-ep-slot], [data-extras-drop]")) {
            return;
          }
          const payload = this.extractDropPayload(ev);
          this.dragPayload = null;
          if (!payload) return;
          ev.preventDefault();
          ev.stopPropagation();
          await this.associateItemsWithAnime(item, payload.items, null, false);
        });
      }

      if (isExpanded) {
        this.renderEpisodeFilmstrip(card, item, resolved, selectedStaging, desktop);
      }
    }

    renderEpisodeFilmstrip(card, item, resolved, selectedStaging, desktop) {
      const key = indexSvc.getAnimeBindingKey(item);
      const sec = card.createDiv("bm-lk-ep-section");

      const totalEp = Number(item.totalEpisodes) || 0;
      const maxLocalEp = Number(resolved?.maxEpisodeNumber) || 0;
      const watchedNum = Number(item.watchedEpisodes) || 0;
      const naturalCount = Math.max(totalEp, maxLocalEp, 12);
      const isLongShowAll = this.longEpExpandedKeys.has(key);
      const displayCount = !isLongShowAll && naturalCount > 48
        ? Math.min(naturalCount, Math.max(24, watchedNum + 12, maxLocalEp + 6))
        : naturalCount;

      const byEp = new Map();
      for (const vf of resolved?.videoFiles || []) {
        byEp.set(Number(vf.episode), vf);
      }
      const missingByEp = new Map();
      for (const m of resolved?.missingItems || []) {
        if (m.kind === "episode" && Number.isFinite(Number(m.episode))) {
          missingByEp.set(Number(m.episode), m);
        }
      }

      const activeEp = this.expandedEpisodeByAnime.get(key) ?? null;

      if (desktop && !resolved?.hasAnyBinding) {
        sec.createDiv({
          cls: "bm-lk-drop-helper",
          text: "可以把左侧文件夹或视频拖到这张卡片上整部关联，或拖到下方对应的第 N 集格子里"
        });
      }

      const grid = sec.createDiv("bm-lk-ep-grid");
      for (let ep = 1; ep <= displayCount; ep++) {
        const vf = byEp.get(ep) || null;
        const miss = missingByEp.get(ep) || null;
        const isWatched = ep <= watchedNum;
        const dupCount = vf && Array.isArray(vf.duplicates) ? vf.duplicates.length + 1 : 1;
        const isExplicit = Boolean(vf?.isExplicitBind || resolved?.episodeMap?.[String(ep)]);

        const clsParts = ["bm-lk-ep-slot"];
        if (miss && !vf) clsParts.push("is-missing");
        else if (vf) clsParts.push(isWatched ? "is-watched" : "is-ready");
        if (activeEp === ep) clsParts.push("is-active");

        const slot = grid.createEl("button", {
          cls: clsParts.join(" "),
          attr: { type: "button", "data-ep-slot": String(ep) },
          title: vf
            ? `第 ${String(ep).padStart(2, "0")} 集 · ${vf.name}${dupCount > 1 ? `（共 ${dupCount} 份版本）` : ""}`
            : miss
            ? `第 ${String(ep).padStart(2, "0")} 集 · 原文件丢失，点击重新选择`
            : `第 ${String(ep).padStart(2, "0")} 集 · 点击或拖入视频文件绑定这一集`
        });

        if (isExplicit) {
          const pin = slot.createSpan({ cls: "bm-lk-ep-pin", title: "已手动指定该集视频" });
          pin.appendChild(v07Core.icon("link", 10));
        }

        slot.createSpan({ cls: "bm-lk-ep-num", text: String(ep).padStart(2, "0") });
        if (dupCount > 1) {
          slot.createSpan({ cls: "bm-lk-ep-sub", text: `×${dupCount}` });
        } else if (miss && !vf) {
          slot.createSpan({ cls: "bm-lk-ep-sub", text: "丢失" });
        } else if (vf) {
          slot.createSpan({ cls: "bm-lk-ep-sub", text: isWatched ? "已看" : "可播" });
        } else {
          slot.createSpan({ cls: "bm-lk-ep-sub", text: "空" });
        }

        slot.onclick = async (ev) => {
          ev.stopPropagation();
          if (!desktop) {
            if (vf || miss) {
              this.expandedEpisodeByAnime.set(key, activeEp === ep ? null : ep);
              this.renderAnimeListOnly();
            }
            return;
          }
          if (!vf && !miss) {
            const singleSelectedFile = selectedStaging.length === 1 && selectedStaging[0].kind === "file" ? selectedStaging[0] : null;
            if (singleSelectedFile) {
              await this.associateItemsWithAnime(item, [singleSelectedFile], ep, false);
              return;
            }
            const picked = await pickNativeFilesOnDesktop({
              title: `为《${item.name}》第 ${String(ep).padStart(2, "0")} 集选择视频文件`,
              initialDir: item.downloadPath && item.downloadPath !== "无" ? item.downloadPath : this.currentDir,
              multi: false
            });
            if (picked[0]) {
              await indexSvc.bindEpisodeFileToAnime(this.plugin, item, ep, picked[0]);
              this.expandedEpisodeByAnime.set(key, ep);
              await this.notifyVaultChanged();
              this.renderRightAnimePane();
            }
            return;
          }
          this.expandedEpisodeByAnime.set(key, activeEp === ep ? null : ep);
          this.renderAnimeListOnly();
        };

        if (desktop) {
          slot.addEventListener("dragover", (ev) => {
            if (!this.isDragEventSupported(ev, { requireFiles: true })) return;
            ev.preventDefault();
            ev.stopPropagation();
            slot.classList.add("is-drag-target-hint");
          });
          slot.addEventListener("dragleave", () => {
            slot.classList.remove("is-drag-target-hint");
          });
          slot.addEventListener("drop", async (ev) => {
            slot.classList.remove("is-drag-target-hint");
            const payload = this.extractDropPayload(ev);
            this.dragPayload = null;
            if (!payload) return;
            ev.preventDefault();
            ev.stopPropagation();
            slot.classList.add("is-drop-confirmed");
            await this.associateItemsWithAnime(item, payload.items, ep, false);
          });
        }
      }

      if (displayCount < naturalCount) {
        const moreBtn = sec.createEl("button", {
          cls: "bm-lk-btn is-sm is-ghost",
          text: `展开全部 ${naturalCount} 集`
        });
        moreBtn.onclick = () => {
          this.longEpExpandedKeys.add(key);
          this.renderAnimeListOnly();
        };
      }

      // 选中剧集详情条（含播放、打开目录、更换文件、多版本抉择与解除指定）
      if (activeEp !== null) {
        const activeVf = byEp.get(activeEp) || null;
        const activeMiss = missingByEp.get(activeEp) || null;
        if (activeVf || activeMiss) {
          const detail = sec.createDiv("bm-lk-ep-detail");
          const dHead = detail.createDiv({
            attr: { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;" }
          });
          dHead.createSpan({
            attr: { style: "font-weight:700;" },
            text: `第 ${String(activeEp).padStart(2, "0")} 集 · ${activeVf ? activeVf.name : activeMiss.name}`
          });
          const dActs = dHead.createDiv("bm-lk-pane-tools");
          if (desktop && activeVf) {
            const playBtn = dActs.createEl("button", { cls: "bm-lk-btn is-sm is-primary", text: "播放" });
            playBtn.onclick = () => noteUtils.openLocalPathSafely(activeVf.path);
            const openFolderBtn = dActs.createEl("button", { cls: "bm-lk-btn is-sm", text: "打开所在文件夹" });
            openFolderBtn.onclick = () => {
              const p = tryRequireNode("path");
              noteUtils.openLocalPathSafely(p ? p.dirname(activeVf.path) : activeVf.path);
            };
          }
          if (desktop) {
            const repickBtn = dActs.createEl("button", { cls: "bm-lk-btn is-sm", text: "换选文件…" });
            repickBtn.onclick = async () => {
              const picked = await pickNativeFilesOnDesktop({
                title: `为第 ${String(activeEp).padStart(2, "0")} 集更换视频文件`,
                initialDir: this.currentDir,
                multi: false
              });
              if (picked[0]) {
                await indexSvc.bindEpisodeFileToAnime(this.plugin, item, activeEp, picked[0]);
                await this.notifyVaultChanged();
                this.renderRightAnimePane();
              }
            };
            if (activeVf?.isExplicitBind || activeMiss) {
              const unbindEpBtn = dActs.createEl("button", { cls: "bm-lk-btn is-sm is-ghost", text: "解除指定" });
              unbindEpBtn.onclick = async () => {
                await indexSvc.unbindEpisodeFileFromAnime(this.plugin, item, activeEp);
                await this.notifyVaultChanged();
                this.renderRightAnimePane();
              };
            }
          }

          const pathLine = detail.createDiv({
            cls: "bm-lk-ep-detail-path",
            text: [
              activeVf ? activeVf.path : activeMiss.path,
              activeVf?.size > 0 ? formatBytesText(activeVf.size) : "",
              activeMiss && !activeVf ? (activeMiss.status === "drive_offline" ? "所在磁盘未接入" : "原文件已丢失") : ""
            ]
              .filter(Boolean)
              .join(" · ")
          });
          pathLine.title = activeVf ? activeVf.path : activeMiss.path;

          // 同集多版本切换（吸收原「重复剧集」处理）
          if (activeVf && Array.isArray(activeVf.duplicates) && activeVf.duplicates.length > 0) {
            const dupBox = detail.createDiv();
            dupBox.style.cssText = "display:flex;flex-direction:column;gap:5px;padding-top:6px;border-top:1px dashed var(--bm7-line);";
            dupBox.createDiv({
              attr: { style: "font-weight:650;" },
              text: `这一集找到了 ${activeVf.duplicates.length + 1} 份文件，点击切换默认播放版本：`
            });
            for (const cand of [activeVf, ...activeVf.duplicates]) {
              const isCur = indexSvc.normPathCompareKey(cand.path) === indexSvc.normPathCompareKey(activeVf.path);
              const dRow = dupBox.createDiv();
              dRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;";
              dRow.createSpan({
                attr: { style: "overflow-wrap:anywhere;flex:1 1 200px;" },
                text: `${isCur ? "● [当前默认] " : ""}${cand.name}${cand.size > 0 ? ` (${formatBytesText(cand.size)})` : ""}`
              });
              if (desktop && !isCur) {
                const useBtn = dRow.createEl("button", {
                  cls: "bm-lk-btn is-sm is-primary",
                  text: "设为默认"
                });
                useBtn.onclick = async () => {
                  await indexSvc.bindEpisodeFileToAnime(this.plugin, item, activeEp, cand.path);
                  await this.notifyVaultChanged();
                  this.renderRightAnimePane();
                };
              }
            }
          }
        }
      }

      // 特典 / OVA / OP·ED 区
      const extras = resolved?.extraFiles || [];
      if (extras.length > 0 || desktop) {
        const extZone = sec.createDiv("bm-lk-extras-zone");
        extZone.dataset.extrasDrop = "1";
        extZone.createSpan({
          attr: { style: "font-weight:650;color:var(--bm7-ink-2);" },
          text: extras.length > 0 ? `特典 / OVA (${extras.length})：` : "特典 / OVA：可将文件拖到这里绑定"
        });
        for (const ex of extras) {
          const exChip = extZone.createDiv("bm-lk-source-chip");
          exChip.createSpan({ cls: "bm-lk-source-tag", text: ex.extraKind || "特典" });
          const exTitle = exChip.createSpan({ cls: "bm-lk-source-path", text: ex.name, title: ex.path });
          exTitle.onclick = () => desktop && noteUtils.openLocalPathSafely(ex.path);
          if (desktop && ex.sourceKind === "extra_bind") {
            const delEx = exChip.createEl("button", {
              cls: "bm-lk-chip-mini-btn",
              title: "解除特典关联"
            });
            delEx.appendChild(v07Core.icon("close", 11));
            delEx.onclick = async (ev) => {
              ev.stopPropagation();
              await indexSvc.unbindExtraClipFromAnime(this.plugin, item, ex.path);
              await this.notifyVaultChanged();
              this.renderRightAnimePane();
            };
          }
        }
        if (desktop) {
          extZone.addEventListener("dragover", (ev) => {
            if (!this.isDragEventSupported(ev, { requireFiles: true })) return;
            ev.preventDefault();
            ev.stopPropagation();
            extZone.classList.add("is-drop-over");
          });
          extZone.addEventListener("dragleave", () => extZone.classList.remove("is-drop-over"));
          extZone.addEventListener("drop", async (ev) => {
            extZone.classList.remove("is-drop-over");
            const payload = this.extractDropPayload(ev);
            this.dragPayload = null;
            if (!payload) return;
            ev.preventDefault();
            ev.stopPropagation();
            await this.associateItemsWithAnime(item, payload.items, null, true);
          });
        }
      }
    }

    /* ============================== 模式二：智能扫描匹配 ============================== */

    renderScanView() {
      if (!this.bodyEl) return;
      v07Core.clear(this.bodyEl);
      const scanView = this.bodyEl.createDiv("bm-lk-scan-view");
      const top = scanView.createDiv("bm-lk-scan-top");

      const dirsRow = top.createDiv("bm-lk-scan-dirs");
      dirsRow.createSpan({
        attr: { style: "font-weight:700;font-size:13px;margin-right:4px;" },
        text: "要扫描的本地目录："
      });
      for (const dir of this.scanDirs) {
        const chip = dirsRow.createDiv("bm-lk-source-chip");
        chip.appendChild(v07Core.icon("folder", 12));
        chip.createSpan({ cls: "bm-lk-source-path", text: dir, title: dir });
        const rm = chip.createEl("button", { cls: "bm-lk-chip-mini-btn", title: "移除" });
        rm.appendChild(v07Core.icon("close", 11));
        rm.onclick = () => {
          this.scanDirs = this.scanDirs.filter((d) => d !== dir);
          this.renderScanView();
        };
      }

      const addDirBtn = dirsRow.createEl("button", {
        cls: "bm-lk-btn is-sm",
        text: "+ 添加文件夹…"
      });
      addDirBtn.onclick = async () => {
        const picked = await pickNativeFolderOnDesktop({
          title: "添加要自动匹配的本地动画总目录",
          initialDir: this.currentDir
        });
        if (picked && !this.scanDirs.some((d) => indexSvc.normPathCompareKey(d) === indexSvc.normPathCompareKey(picked))) {
          this.scanDirs.push(picked);
          this.plugin.settings.localMediaBrowserState.lastScannedDirs = this.scanDirs.slice();
          await this.plugin.saveSettings?.();
          this.renderScanView();
        }
      };

      const actRow = top.createDiv("bm-lk-pane-tools");
      const startBtn = actRow.createEl("button", {
        cls: "bm-lk-btn is-primary",
        text: this.scanRunning ? "正在扫描…" : "开始扫描匹配"
      });
      startBtn.disabled = this.scanRunning || this.scanDirs.length === 0;
      startBtn.onclick = async () => {
        this.scanRunning = true;
        this.scanAbort = { aborted: false };
        this.scanProgressText = "正在读取本地文件夹结构…";
        this.renderScanView();

        this.plugin.settings.localMediaBrowserState.lastScannedDirs = this.scanDirs.slice();
        await this.plugin.saveSettings?.();

        const res = await indexSvc.scanLocalDirectoriesForSuggestions(
          this.plugin,
          this.scanDirs,
          this.allItems,
          {
            signal: this.scanAbort,
            onProgress: (p) => {
              this.scanProgressText = `已检查 ${p.scannedDirs} 个文件夹，发现 ${p.candidatesFound} 个动画候选项…`;
              if (this.scanStatusEl) this.scanStatusEl.textContent = this.scanProgressText;
            }
          }
        );

        this.scanRunning = false;
        this.scanResults = res;
        this.scanCheckedIds = new Set(
          (res.high || []).filter((r) => !r.alreadyLinked).map((r) => r.id)
        );
        this.scanProgressText = `扫描完成（共检查 ${res.scannedDirs} 个文件夹）`;
        this.renderScanView();
      };

      if (this.scanRunning) {
        const cancelBtn = actRow.createEl("button", {
          cls: "bm-lk-btn",
          text: "停止扫描"
        });
        cancelBtn.onclick = () => {
          if (this.scanAbort) this.scanAbort.aborted = true;
        };
      }

      this.scanStatusEl = actRow.createSpan({
        attr: { style: "font-size:12px;color:var(--bm7-ink-2);margin-left:6px;" },
        text: this.scanProgressText || "提示：不会移动或重命名你的任何本地文件，只会记住对应路径。"
      });

      const resultsEl = scanView.createDiv("bm-lk-scan-results");
      if (!this.scanResults) {
        resultsEl.createDiv({
          cls: "bm-lk-empty-drop",
          text: "在上方添加存放本地番剧的文件夹后，点击「开始扫描匹配」，插件会先把能识别的番剧和剧场版自动对齐好，认不准的再送入暂存区手动整理。"
        });
        return;
      }

      const { high = [], medium = [], unmatched = [] } = this.scanResults;

      const renderMatchGroup = (titleText, rows, isMedium) => {
        if (rows.length === 0) return;
        const grp = resultsEl.createDiv("bm-lk-scan-group");
        const gHead = grp.createDiv("bm-lk-scan-group-head");
        gHead.createSpan({ text: `${titleText} (${rows.length})` });

        const grpActs = gHead.createDiv("bm-lk-pane-tools");
        const selAllBtn = grpActs.createEl("button", {
          cls: "bm-lk-btn is-sm is-ghost",
          text: "全选本组"
        });
        selAllBtn.onclick = () => {
          for (const r of rows) {
            if (!r.alreadyLinked) this.scanCheckedIds.add(r.id);
          }
          this.renderScanView();
        };

        for (const r of rows) {
          const targetItem = this.scanCustomTargetById.get(r.id) || r.matchedItem;
          const rowEl = grp.createDiv("bm-lk-scan-row");
          const left = rowEl.createDiv("bm-lk-scan-left");
          const cb = left.createEl("input", { type: "checkbox" });
          cb.checked = this.scanCheckedIds.has(r.id);
          cb.disabled = r.alreadyLinked;
          cb.onchange = () => {
            if (cb.checked) this.scanCheckedIds.add(r.id);
            else this.scanCheckedIds.delete(r.id);
            this.updateScanFooterCount();
          };
          left.appendChild(v07Core.icon(r.kind === "folder" ? "folder" : "film", 15));
          const lText = left.createDiv("bm-lk-file-main");
          lText.createDiv({ cls: "bm-lk-file-name", text: r.name, title: r.path });
          lText.createDiv({
            cls: "bm-lk-file-sub",
            text: r.kind === "folder" ? `${r.videoCount} 个视频 · ${r.path}` : `${formatBytesText(r.size)} · ${r.path}`
          });

          const right = rowEl.createDiv("bm-lk-scan-right");
          right.appendChild(v07Core.icon("chevronRight", 14));
          right.createSpan({
            attr: { style: "font-weight:650;" },
            text: `《${targetItem?.name || "未指定"}》`
          });
          if (r.alreadyLinked) {
            right.createSpan({ cls: "bm-lk-stat-pill", text: "已关联" });
          } else {
            right.createSpan({
              cls: "bm-lk-ep-tag",
              text: isMedium ? `待确认 ${r.score}%` : `匹配 ${r.score}%`
            });
          }
          const changeBtn = right.createEl("button", {
            cls: "bm-lk-btn is-sm",
            text: "换一部"
          });
          changeBtn.onclick = () => {
            v07Core.popover(
              changeBtn,
              (popBox, close) => {
                const qInp = popBox.createEl("input", {
                  type: "text",
                  cls: "bm-lk-input",
                  placeholder: "搜索动画笔记…"
                });
                qInp.style.marginBottom = "6px";
                const list = popBox.createDiv();
                list.style.cssText = "max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;";
                const fill = () => {
                  v07Core.clear(list);
                  const kw = normalizeUnicodeNfc(qInp.value.trim()).toLowerCase();
                  const cands = kw
                    ? this.allItems.filter((it) => normalizeUnicodeNfc(`${it.name} ${it.japaneseName || ""}`).toLowerCase().includes(kw)).slice(0, 20)
                    : (r.alternatives && r.alternatives.length > 0 ? r.alternatives : this.allItems.slice(0, 12));
                  for (const cand of cands) {
                    const b = list.createEl("button", { cls: "bm7-menu-item", text: cand.name });
                    b.onclick = () => {
                      this.scanCustomTargetById.set(r.id, cand);
                      this.scanCheckedIds.add(r.id);
                      close();
                      this.renderScanView();
                    };
                  }
                };
                qInp.oninput = fill;
                fill();
              },
              { width: 260, alignRight: true, title: "选择目标动画" }
            );
          };
        }
      };

      renderMatchGroup("已精准匹配", high, false);
      renderMatchGroup("可能匹配 · 请确认", medium, true);

      if (unmatched.length > 0) {
        const unGrp = resultsEl.createDiv("bm-lk-scan-group");
        const uHead = unGrp.createDiv("bm-lk-scan-group-head");
        uHead.createSpan({ text: `未能自动识别 (${unmatched.length})` });
        const sendAllBtn = uHead.createEl("button", {
          cls: "bm-lk-btn is-sm is-primary",
          text: "全部放入暂存区并去整理"
        });
        sendAllBtn.onclick = async () => {
          await indexSvc.addItemsToStagingPool(this.plugin, unmatched.map((u) => u.path));
          this.showSavedFlash();
          this.activeTab = "workbench";
          this.renderAll();
        };
        for (const u of unmatched.slice(0, 30)) {
          const rEl = unGrp.createDiv("bm-lk-scan-row");
          const left = rEl.createDiv("bm-lk-scan-left");
          left.appendChild(v07Core.icon(u.kind === "folder" ? "folder" : "film", 14));
          const lMain = left.createDiv("bm-lk-file-main");
          lMain.createDiv({ cls: "bm-lk-file-name", text: u.name });
          lMain.createDiv({ cls: "bm-lk-file-sub", text: u.path });
          const addOneBtn = rEl.createEl("button", {
            cls: "bm-lk-btn is-sm",
            text: "+ 放入暂存区"
          });
          addOneBtn.onclick = async () => {
            await indexSvc.addItemsToStagingPool(this.plugin, [u.path]);
            addOneBtn.disabled = true;
            addOneBtn.textContent = "已放入";
          };
        }
        if (unmatched.length > 30) {
          unGrp.createDiv({
            attr: { style: "font-size:12px;color:var(--bm7-ink-3);" },
            text: `还有 ${unmatched.length - 30} 项未展开，可直接点击上方「全部放入暂存区并去整理」。`
          });
        }
      }

      if (high.length === 0 && medium.length === 0 && unmatched.length === 0) {
        resultsEl.createDiv({
          cls: "bm-lk-empty-drop",
          text: "所选文件夹下没有找到视频文件。"
        });
      }

      const footer = scanView.createDiv("bm-lk-scan-footer");
      this.scanFooterTextEl = footer.createSpan({
        attr: { style: "font-size:12.5px;color:var(--bm7-ink-2);" }
      });
      const applyBtn = footer.createEl("button", {
        cls: "bm-lk-btn is-primary",
        text: "关联已勾选项（不移动原文件）"
      });
      this.scanApplyBtnEl = applyBtn;
      this.updateScanFooterCount();

      applyBtn.onclick = async () => {
        const allRows = [...high, ...medium];
        const chosen = allRows.filter((r) => this.scanCheckedIds.has(r.id));
        if (chosen.length === 0) return;
        applyBtn.disabled = true;
        applyBtn.textContent = "正在写入关联…";
        for (const r of chosen) {
          const targetItem = this.scanCustomTargetById.get(r.id) || r.matchedItem;
          if (!targetItem) continue;
          if (r.kind === "folder") {
            await indexSvc.bindFolderToAnime(this.plugin, targetItem, r.path);
          } else {
            await indexSvc.bindLooseFilesToAnime(this.plugin, targetItem, [r.path]);
          }
          r.alreadyLinked = true;
          this.scanCheckedIds.delete(r.id);
        }
        await this.notifyVaultChanged();
        if (NoticeClass) {
          new NoticeClass(`已成功关联 ${chosen.length} 个本地视频/文件夹（原文件位置未做任何改动）`, 4200);
        }
        this.renderScanView();
      };
    }

    updateScanFooterCount() {
      const n = this.scanCheckedIds.size;
      if (this.scanFooterTextEl) {
        this.scanFooterTextEl.textContent = `已勾选 ${n} 项待关联`;
      }
      if (this.scanApplyBtnEl) {
        this.scanApplyBtnEl.disabled = n === 0;
        this.scanApplyBtnEl.textContent = `关联已选中的 ${n} 项（不移动原文件）`;
      }
    }
  };
}

function openLocalMediaLinkerModal(plugin, items, options = {}) {
  const Cls = createLinkerModalClass();
  if (!Cls || !plugin?.app) return null;
  if (plugin._activeLocalMediaLinkerModal && typeof plugin._activeLocalMediaLinkerModal.close === "function") {
    try {
      plugin._activeLocalMediaLinkerModal.close();
    } catch (_) {}
  }
  const modal = new Cls(plugin.app, plugin, items, options);
  plugin._activeLocalMediaLinkerModal = modal;
  modal.open();
  return modal;
}

module.exports = {
  LOCAL_MEDIA_LINKER_CSS,
  openLocalMediaLinkerModal
};
