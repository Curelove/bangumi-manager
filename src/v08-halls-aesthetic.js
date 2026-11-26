/**
 * v0.8 多馆藏差异化审美与全宽度容器自适应样式
 * - 顶栏 6 馆导航条现代化对齐（全面接入 --bm7-* 令牌）
 * - 画册典藏（Exhibition & Artbook Folio）：分册书签条 + 无框呼吸感画墙 + 暗房级缩放灯箱
 * - 角色典藏（Character Setting Dossier）：人物设定集卡片 + 属性偏好条 + 制图风等身标尺架
 * - 音声典藏（Acoustic Liner-Notes）：台词手帖卡片 + 定制触感音频播放器与声波脉动
 * - 全部番剧（Library Shelf & Index）：书架陈列与编目台账 + 窄侧边栏优雅降列
 */

const HALLS_AESTHETIC_CSS = /* css */ `
/* ==========================================================================
   0. 顶栏六馆工作区导航与全局容器查询基座
   ========================================================================== */
.bm7-root,
.curator-desk-root {
  --bm7-text: var(--bm7-ink, var(--text-normal));
  --bm7-text-dim: var(--bm7-ink-2, var(--text-muted));
  --bm7-text-faint: var(--bm7-ink-3, var(--text-faint));
  --bm7-border: var(--bm7-line, var(--background-modifier-border));
  --bm7-border-strong: color-mix(in srgb, var(--bm7-ink, #888) 18%, var(--bm7-line, transparent));
  --bm7-shadow-sm: var(--bm7-shadow, 0 1px 3px rgba(15, 23, 42, 0.04));
}

div.curator-desk-root,
.curator-desk-root {
  container-type: inline-size;
  container-name: curator-desk bmdesk;
  color: var(--bm7-text, var(--text-normal));
  overflow-x: clip !important;
  overflow-y: visible !important;
}

.curator-unified-workspace {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}

.curator-workspace-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px !important;
  margin-bottom: 14px !important;
  border-radius: 12px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: var(--bm7-shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.04)) !important;
}

.curator-workspace-mode-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.curator-workspace-mode-btn,
.curator-workspace-tab {
  border-radius: 8px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  padding: 6px 11px !important;
  height: auto !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease !important;
}
.curator-workspace-mode-btn:hover,
.curator-workspace-tab:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: var(--bm7-surface-2, rgba(127, 127, 127, 0.08)) !important;
}
.curator-workspace-mode-btn.is-active,
.curator-workspace-tab.is-active {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border)) !important;
  font-weight: 600 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06) !important;
}
.curator-ws-mode-badge,
.curator-ws-tab-badge {
  font-size: 12px !important;
  font-variant-numeric: tabular-nums;
  padding: 1px 6px !important;
  border-radius: 999px !important;
  background: var(--bm7-surface-2, rgba(127, 127, 127, 0.1)) !important;
  color: var(--bm7-text-faint, var(--text-faint)) !important;
  border: none !important;
}
.curator-workspace-mode-btn.is-active .curator-ws-mode-badge,
.curator-workspace-tab.is-active .curator-ws-tab-badge {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.14)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
}

.curator-workspace-quick-ribbon {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.curator-ws-quick-jump-btn {
  height: 28px !important;
  padding: 0 10px !important;
  border-radius: 7px !important;
  font-size: 12px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease !important;
}
.curator-ws-quick-jump-btn:hover {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
}

.curator-workspace-pane {
  container-type: inline-size;
  container-name: bmhall;
  min-width: 0;
}

/* 通用二级控件现代令牌对齐（彻底洗净旧版棕褐硬编码与宿主灰框阴影） */
.curator-desk-root .curator-btn,
.curator-workspace-pane .curator-btn,
.curator-illust-lightbox-modal .curator-btn {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px !important;
  border-radius: 8px !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: none !important;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 100ms ease !important;
}
.curator-desk-root .curator-btn.is-hidden,
.curator-workspace-pane .curator-btn.is-hidden,
.curator-illust-lightbox-modal .curator-btn.is-hidden,
.curator-desk-root .curator-btn[hidden],
.curator-workspace-pane .curator-btn[hidden],
.curator-illust-lightbox-modal .curator-btn[hidden] {
  display: none !important;
}
.curator-desk-root .curator-btn:hover,
.curator-workspace-pane .curator-btn:hover,
.curator-illust-lightbox-modal .curator-btn:hover {
  background: var(--bm7-surface-2, var(--background-modifier-hover)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
}
.curator-desk-root .curator-btn.is-primary,
.curator-workspace-pane .curator-btn.is-primary,
.curator-illust-lightbox-modal .curator-btn.is-primary {
  background: var(--bm7-accent, var(--interactive-accent)) !important;
  color: #ffffff !important;
  border-color: transparent !important;
}
.curator-workspace-pane .curator-btn.is-primary:hover,
.curator-illust-lightbox-modal .curator-btn.is-primary:hover {
  filter: brightness(1.06);
}
.curator-workspace-pane .curator-btn.is-active {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.14)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 42%, transparent) !important;
}

.curator-workspace-pane .curator-dl-mini-btn,
.curator-desk-root .curator-mini-btn {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px !important;
  padding: 0 10px !important;
  border-radius: 7px !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 4.5%, var(--bm7-surface, transparent)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 78%, transparent) !important;
  box-shadow: none !important;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease !important;
}
.curator-workspace-pane .curator-dl-mini-btn:hover,
.curator-desk-root .curator-mini-btn:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
  background: var(--bm7-surface-2, var(--background-modifier-hover)) !important;
}
.curator-workspace-pane .curator-dl-mini-btn.is-active,
.curator-workspace-pane .curator-dl-mini-btn.is-accent,
.curator-desk-root .curator-mini-btn.is-active {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.13)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 38%, transparent) !important;
  box-shadow: none !important;
  font-weight: 600 !important;
}

.curator-workspace-pane .curator-input,
.curator-workspace-pane .curator-textarea,
.curator-workspace-pane .curator-sort-select,
.curator-illust-lightbox-modal .curator-input {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 8px !important;
  font-size: 12.5px !important;
  box-shadow: none !important;
  transition: border-color 140ms ease, box-shadow 140ms ease !important;
}
.curator-workspace-pane .curator-input:focus,
.curator-workspace-pane .curator-textarea:focus,
.curator-illust-lightbox-modal .curator-input:focus {
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: 0 0 0 2px var(--bm7-accent-soft, rgba(91, 108, 242, 0.14)) !important;
  outline: none !important;
}

.curator-workspace-pane .curator-rs-empty,
.curator-workspace-pane .curator-empty-box,
.curator-workspace-pane .curator-char-empty-box {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px dashed var(--bm7-border-strong, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  padding: 32px 20px !important;
  text-align: center;
}

/* 跨页跳转心理预期统一角标 */
.bm8-jump-cue {
  display: inline-flex;
  align-items: center;
  opacity: 0.72;
  transition: transform 140ms ease, opacity 140ms ease;
}
button:hover .bm8-jump-cue,
a:hover .bm8-jump-cue {
  opacity: 1;
  transform: translate(1px, -1px);
}


/* ==========================================================================
   1. 画册典藏（Exhibition & Artbook Folio · 画集装帧与无框画境）
   ========================================================================== */
.curator-illust-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 18px !important;
  background: transparent !important;
  border: none !important;
}

.curator-illust-workspace > .curator-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
}

.curator-illust-workspace .curator-char-title {
  margin: 0 !important;
  font-size: 18px !important;
  font-weight: 700 !important;
  letter-spacing: -0.01em;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-illust-workspace .curator-char-count-badge {
  font-size: 12px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  padding: 2px 9px !important;
  border-radius: 999px !important;
}

.curator-illust-workspace .curator-char-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
}
.curator-illust-workspace .curator-char-search-input:not(.bm-hall-filter-input) {
  width: 210px;
  max-width: 100%;
  height: 32px;
  padding: 0 11px !important;
}

/* 画集分册书签条（Artbook Folio Bookmark Strip） */
.bm8-folio-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--bm7-panel-bg, var(--background-secondary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
}

.bm8-folio-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  min-width: 0;
  flex: 1 1 320px;
}
.bm8-folio-strip::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}

.bm8-folio-tab {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  height: 30px !important;
  padding: 0 12px !important;
  border-radius: 8px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
.bm8-folio-tab:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
}
.bm8-folio-tab.is-active {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border)) !important;
  font-weight: 600 !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08) !important;
}
.bm8-folio-tab.is-active::before {
  content: "";
  width: 3px;
  height: 12px;
  border-radius: 99px;
  background: var(--bm7-accent, var(--interactive-accent));
  margin-right: 1px;
}
.bm8-folio-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--bm7-text-faint, var(--text-faint));
}
.bm8-folio-tab.is-active .bm8-folio-count {
  color: var(--bm7-accent, var(--interactive-accent));
}

.bm8-folio-ctrls {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.bm8-folio-seg {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 8px;
  background: var(--bm7-surface, var(--background-primary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
}
.bm8-folio-seg-btn {
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--bm7-text-dim, var(--text-muted));
  font-size: 11.5px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.bm8-folio-seg-btn:hover {
  color: var(--bm7-text, var(--text-normal));
}
.bm8-folio-seg-btn.is-active {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.14));
  color: var(--bm7-accent, var(--interactive-accent));
  font-weight: 600;
}

/* 无框高呼吸感画墙（彻底清除压图黑黄膏药，赋予美术馆级留白与柔和阴影） */
.curator-illust-stage-host {
  min-height: 220px;
}
.curator-illust-workspace .curator-char-photowall-grid {
  gap: 12px !important;
  padding: 2px !important;
}
.curator-illust-workspace .curator-char-photowall-tile {
  border-radius: 10px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127,127,127,0.2)) 65%, transparent) !important;
  background: var(--bm7-surface, var(--background-secondary)) !important;
  box-shadow: 0 4px 16px -6px rgba(15, 23, 42, 0.14) !important;
  overflow: hidden !important;
  cursor: zoom-in !important;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms cubic-bezier(0.22, 1, 0.36, 1), border-color 180ms ease !important;
}
.curator-illust-workspace .curator-char-photowall-tile:hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 14px 28px -10px rgba(15, 23, 42, 0.28) !important;
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 45%, var(--bm7-border, transparent)) !important;
  z-index: 3;
}
.curator-illust-workspace .curator-char-photowall-img {
  transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1) !important;
}
.curator-illust-workspace .curator-char-photowall-tile:hover .curator-char-photowall-img {
  transform: scale(1.026) !important;
}

/* 顶部操作仅悬停显现右上角轻量图标按钮 */
.curator-illust-workspace .curator-char-photowall-topbar {
  justify-content: flex-end !important;
  padding: 8px !important;
  background: none !important;
  pointer-events: none;
}
.curator-illust-workspace .curator-illust-tile-topactions {
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: auto;
}
.curator-illust-workspace .curator-char-photowall-tile:hover .curator-illust-tile-topactions,
.curator-illust-workspace .curator-char-photowall-tile:focus-within .curator-illust-tile-topactions {
  opacity: 1;
  transform: translateY(0);
}
@media (hover: none), (pointer: coarse) {
  .curator-illust-workspace .curator-illust-tile-topactions {
    opacity: 0.92;
    transform: none;
  }
}
.curator-illust-workspace .curator-char-photowall-cropbtn {
  width: 28px;
  height: 28px;
  padding: 0 !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px !important;
  background: rgba(15, 18, 24, 0.62) !important;
  backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.9) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
}
.curator-illust-workspace .curator-char-photowall-cropbtn.is-armed {
  width: auto;
  padding: 0 8px !important;
  background: #dc2626 !important;
  color: #fff !important;
  font-size: 11px !important;
}

/* 画册铭牌：美术馆展签渐变 */
.curator-illust-workspace .curator-char-photowall-plaque {
  padding: 24px 12px 10px !important;
  background: linear-gradient(to top, rgba(10, 12, 16, 0.84) 0%, rgba(10, 12, 16, 0.42) 56%, transparent 100%) !important;
}
.curator-illust-workspace .curator-char-photowall-name {
  font-size: 12.5px !important;
  font-weight: 600 !important;
  color: #f8fafc !important;
  letter-spacing: 0.01em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.curator-illust-workspace .curator-char-photowall-moes {
  font-size: 11px !important;
  color: rgba(241, 245, 249, 0.78) !important;
  margin-top: 2px !important;
}

/* 暗房级大图灯箱（Darkroom Lightbox） */
.modal:has(.bm8-darkroom-modal) {
  width: min(92vw, 1220px) !important;
  max-width: 94vw !important;
  background: #121418 !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 16px !important;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.68) !important;
  color: #f1f5f9 !important;
  padding: 16px 20px !important;
}
.modal:has(.bm8-darkroom-modal) .modal-close-button {
  color: rgba(241, 245, 249, 0.72) !important;
}
.bm8-darkroom-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: #f1f5f9;
}
.bm8-darkroom-modal .curator-illust-lb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-right: 28px;
}
.bm8-darkroom-modal .curator-illust-lb-h3row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bm8-darkroom-modal .curator-illust-lb-h3row h3 {
  margin: 0 !important;
  font-size: 16px !important;
  font-weight: 650 !important;
  color: #f8fafc !important;
}
.bm8-darkroom-modal .curator-illust-lb-counter {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(248, 250, 252, 0.85);
}
.bm8-darkroom-modal .curator-illust-lb-meta {
  font-size: 12px !important;
  color: rgba(203, 213, 225, 0.76) !important;
  margin-top: 3px;
}
.bm8-darkroom-modal .curator-illust-lb-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: min(68vh, 720px);
  background: radial-gradient(circle at 50% 50%, #1b1f27 0%, #0d0f13 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.07) !important;
  border-radius: 12px !important;
  overflow: hidden;
  user-select: none;
}
.bm8-darkroom-modal .curator-illust-lb-stage.is-zoomed {
  cursor: grab;
}
.bm8-darkroom-modal .curator-illust-lb-stage.is-panning {
  cursor: grabbing;
}
.bm8-darkroom-modal .curator-illust-lb-img {
  max-height: 100% !important;
  max-width: 100% !important;
  object-fit: contain;
  border-radius: 4px !important;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.52);
  transform-origin: center center;
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.bm8-darkroom-modal .curator-illust-lb-stage.is-panning .curator-illust-lb-img {
  transition: none !important;
}
.bm8-darkroom-modal .curator-illust-lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px !important;
  height: 40px !important;
  padding: 0 !important;
  border-radius: 999px !important;
  background: rgba(15, 18, 24, 0.68) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  box-shadow: none !important;
  outline: none !important;
  color: #f8fafc !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 4;
  transition: background 150ms ease, transform 150ms ease, border-color 150ms ease;
}
.bm8-darkroom-modal .curator-illust-lb-nav:hover {
  background: rgba(30, 36, 48, 0.92) !important;
  border-color: rgba(255, 255, 255, 0.34) !important;
  transform: translateY(-50%) scale(1.06);
}
.bm8-darkroom-modal .curator-illust-lb-nav:focus:not(:focus-visible) {
  border-color: rgba(255, 255, 255, 0.16) !important;
  box-shadow: none !important;
}
.bm8-darkroom-modal .curator-illust-lb-nav:focus-visible {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.45) !important;
}
.bm8-darkroom-modal .curator-illust-lb-nav.is-prev { left: 14px; }
.bm8-darkroom-modal .curator-illust-lb-nav.is-next { right: 14px; }

.bm8-lb-zoom-pill {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(15, 18, 24, 0.78);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  z-index: 4;
}
.bm8-darkroom-modal button.bm8-lb-zoom-btn,
.bm8-lb-zoom-btn {
  height: 24px !important;
  min-width: 24px !important;
  padding: 0 7px !important;
  border: none !important;
  border-radius: 999px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: #e2e8f0 !important;
  font-size: 12px !important;
  cursor: pointer;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}
.bm8-darkroom-modal button.bm8-lb-zoom-btn:hover,
.bm8-lb-zoom-btn:hover {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #fff !important;
}
.bm8-lb-zoom-readout {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
  min-width: 42px;
  text-align: center;
}
.bm8-darkroom-modal .curator-illust-lb-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.bm8-darkroom-modal .curator-btn {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #e2e8f0 !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow: none !important;
}
.bm8-darkroom-modal .curator-btn:hover {
  background: rgba(255, 255, 255, 0.15) !important;
}
.bm8-darkroom-modal .curator-illust-lb-editbox {
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.bm8-darkroom-modal .curator-input {
  background: rgba(15, 18, 24, 0.85) !important;
  color: #f8fafc !important;
  border-color: rgba(255, 255, 255, 0.18) !important;
}


/* ==========================================================================
   2. 角色典藏（Character Setting Dossier · 人物设定集与等身标尺架）
   ========================================================================== */
.curator-character-archive-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: transparent !important;
  border: none !important;
  padding: 4px 0 18px !important;
}

.curator-char-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
}
.curator-char-header-title {
  font-size: 17px !important;
  font-weight: 700 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-char-header-sub {
  font-size: 12px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
}
.curator-char-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

/* 角色寻访抽屉与萌点偏好排行面板 */
.curator-char-add-drawer,
.curator-char-rank-section {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
  padding: 16px 18px !important;
  box-shadow: var(--bm7-shadow-sm, none) !important;
}

.curator-char-rank-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px !important;
  padding-bottom: 10px !important;
  border-bottom: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-char-rank-title {
  font-size: 14.5px !important;
  font-weight: 650 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-char-rank-subtitle {
  font-size: 12px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
}
.curator-char-rank-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 角色设定集：切角档案夹索引签（Cut-Corner Dossier Folder Tabs） */
.bm8-dossier-tabs {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  padding: 3px 4px 0;
  border-radius: 9px 9px 4px 4px;
  background: color-mix(in srgb, var(--bm7-ink, #888) 5.5%, transparent);
  border-bottom: 1px solid var(--bm7-border, var(--background-modifier-border));
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.bm8-dossier-tabs::-webkit-scrollbar {
  display: none;
}
.curator-workspace-pane button.bm8-dossier-tab,
.bm8-dossier-tab {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  height: 28px !important;
  padding: 0 12px !important;
  border: none !important;
  border-radius: 6px 8px 0 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  white-space: nowrap !important;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%);
  transition: color 140ms ease, background 140ms ease !important;
}
.curator-workspace-pane button.bm8-dossier-tab:hover,
.bm8-dossier-tab:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: color-mix(in srgb, var(--bm7-surface, #fff) 55%, transparent) !important;
}
.curator-workspace-pane button.bm8-dossier-tab.is-active,
.bm8-dossier-tab.is-active {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  font-weight: 650 !important;
  box-shadow: inset 0 2px 0 var(--bm7-accent, var(--interactive-accent)) !important;
}

/* 角色设定集：制图卡尺刻度排序栏（Drafting Caliper Scale Bar） */
.bm8-caliper-strip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bm7-ink, #888) 4.5%, transparent);
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 75%, transparent);
  max-width: 100%;
  flex-wrap: wrap;
}
.bm8-caliper-label {
  font-size: 12px;
  color: var(--bm7-text-faint, var(--text-faint));
  padding-right: 6px;
  margin-right: 2px;
  border-right: 1px solid var(--bm7-border, rgba(127, 127, 127, 0.2));
  user-select: none;
}
.curator-workspace-pane button.bm8-caliper-btn,
.bm8-caliper-btn {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  height: 25px !important;
  padding: 0 8px !important;
  border: none !important;
  border-radius: 5px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  white-space: nowrap !important;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease !important;
}
.curator-workspace-pane button.bm8-caliper-btn:hover,
.bm8-caliper-btn:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-workspace-pane button.bm8-caliper-btn.is-active,
.bm8-caliper-btn.is-active {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  font-weight: 650 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.curator-char-rank-section .curator-char-empty-box {
  padding: 12px 16px !important;
  font-size: 12.5px !important;
}

.curator-char-rank-bars-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)) !important;
  gap: 10px !important;
}
.curator-char-rank-bar-card {
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 10px !important;
  padding: 10px 12px !important;
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease !important;
}
.curator-char-rank-bar-card:hover {
  transform: translateY(-1px);
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
}
.curator-char-rank-bar-card.is-selected {
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: 0 0 0 2px var(--bm7-accent-soft, rgba(91, 108, 242, 0.15)) !important;
}
.curator-char-trait-name {
  color: var(--bm7-text, var(--text-normal)) !important;
  font-weight: 600 !important;
}
.curator-char-trait-metrics {
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
}
.curator-char-rank-track {
  height: 5px !important;
  border-radius: 99px !important;
  background: var(--bm7-surface-2, rgba(127, 127, 127, 0.12)) !important;
  overflow: hidden;
  margin: 7px 0 !important;
}
.curator-char-rank-fill {
  height: 100%;
  border-radius: 99px !important;
  background: var(--bm7-accent, var(--interactive-accent)) !important;
}
.curator-char-mini-chip,
.curator-char-cloud-pill {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: none !important;
  border-radius: 999px !important;
}
.curator-char-cloud-pill:hover,
.curator-char-cloud-pill.is-selected {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.12)) !important;
}

/* 角色画廊工具栏与设定集卡片（Setting Sheet Dossier Card） */
.curator-char-gallery-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px !important;
  border-radius: 12px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  margin-bottom: 12px !important;
}
.curator-char-gallery-toolbar-left,
.curator-char-gallery-sort {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.curator-char-view-switcher {
  display: inline-flex;
  padding: 3px;
  border-radius: 8px !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 5.5%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 70%, transparent) !important;
}
.curator-char-view-btn {
  height: 25px !important;
  padding: 0 10px !important;
  border-radius: 6px !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  cursor: pointer;
}
.curator-char-view-btn.is-active {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
  font-weight: 600 !important;
}

.curator-char-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr)) !important;
  gap: 14px !important;
}

.curator-char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px !important;
  border-radius: 13px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: var(--bm7-shadow-sm, 0 2px 8px rgba(15, 23, 42, 0.04)) !important;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 160ms ease, box-shadow 180ms ease !important;
}
/* 设定集四角微裁切线（克制的纸本设定稿细节，绝不抢戏） */
.curator-char-card::after {
  content: "";
  position: absolute;
  top: 7px;
  right: 7px;
  width: 9px;
  height: 9px;
  border-top: 1.5px solid color-mix(in srgb, var(--bm7-accent, #5b6cf2) 32%, transparent);
  border-right: 1.5px solid color-mix(in srgb, var(--bm7-accent, #5b6cf2) 32%, transparent);
  pointer-events: none;
  opacity: 0.65;
}
.curator-char-card:hover {
  transform: translateY(-2px);
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
  box-shadow: 0 10px 24px -12px rgba(15, 23, 42, 0.18) !important;
}
.curator-char-card-avatar {
  border-radius: 10px !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}
.curator-char-card-name {
  font-size: 15.5px !important;
  font-weight: 700 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-char-score-badge {
  font-size: 12px !important;
}
.curator-char-card-jp {
  font-size: 12px !important;
  color: var(--bm7-text-faint, var(--text-faint)) !important;
}
.curator-char-attr-chip {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  padding: 2px 7px !important;
}
.curator-char-anime-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: auto !important;
  font-size: 12px !important;
  padding: 2px 8px !important;
  border-radius: 6px !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: none !important;
}
.curator-char-anime-chip.is-in-vault {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 32%, transparent) !important;
  cursor: pointer;
}
.curator-char-anime-chip.is-in-vault:hover {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.12)) !important;
}
.curator-char-moe-tag {
  height: auto !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 4.5%, var(--bm7-surface, transparent)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 70%, transparent) !important;
  box-shadow: none !important;
  border-radius: 999px !important;
  font-size: 12px !important;
  padding: 2px 9px !important;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease !important;
}
.curator-char-moe-tag:hover,
.curator-char-moe-tag.is-active {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.14)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
}
.curator-char-card-comment {
  font-size: 12.5px !important;
  line-height: 1.55 !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border-left: 2.5px solid var(--bm7-accent, var(--interactive-accent)) !important;
  border-radius: 0 8px 8px 0 !important;
  padding: 7px 11px !important;
}
.curator-char-card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px !important;
  border-top: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}

/* 等身标尺架：制图台浅/深色自适应升级 */
.curator-height-lineup-wrap {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
  padding: 14px 16px !important;
}
.curator-height-calibrator-bar {
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 10px !important;
  padding: 10px 12px !important;
  margin-bottom: 12px !important;
}
.curator-height-stat-pill {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 999px !important;
}
.curator-height-stat-pill.is-gold {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 36%, transparent) !important;
}


/* ==========================================================================
   3. 音声典藏（Acoustic Liner-Notes & Custom Tactile Player · 原声台词手帖）
   ========================================================================== */
.curator-voice-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0 18px !important;
  background: transparent !important;
  border: none !important;
}

.curator-voice-workspace > .curator-char-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 14px !important;
}
.curator-voice-workspace .curator-char-title {
  margin: 0 !important;
  font-size: 18px !important;
  font-weight: 700 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-voice-workspace .curator-char-count-badge {
  font-size: 12px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  padding: 2px 9px !important;
  border-radius: 999px !important;
}

/* 音声典藏：唱片内页曲目单横栏（Acoustic Sleeve Liner-Note Tracklist） */
.bm8-voice-filter-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-radius: 12px;
  background:
    repeating-linear-gradient(0deg, rgba(127, 127, 127, 0.025) 0 1px, transparent 1px 4px),
    var(--bm7-panel-bg, var(--background-secondary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
}
.bm8-liner-head {
  flex: none;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.12em;
  color: var(--bm7-gold, #c6922a);
  padding-right: 10px;
  border-right: 1px solid var(--bm7-border, rgba(127, 127, 127, 0.22));
  user-select: none;
}
.bm8-liner-rail {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
  min-width: 0;
  max-width: 100%;
  flex: 1 1 auto;
}
.bm8-liner-rail::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
.curator-voice-workspace button.bm8-liner-track,
.bm8-liner-track {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  gap: 7px;
  height: 30px !important;
  padding: 0 12px !important;
  border-radius: 7px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  white-space: nowrap !important;
  flex-shrink: 0;
  cursor: pointer;
  transition: color 150ms ease, background 150ms ease, box-shadow 150ms ease !important;
}
.curator-voice-workspace button.bm8-liner-track:hover,
.bm8-liner-track:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 5%, transparent) !important;
}
.bm8-liner-no {
  font-size: 12px;
  color: var(--bm7-text-faint, var(--text-faint));
  opacity: 0.78;
}
.bm8-liner-count {
  font-size: 12px;
  color: var(--bm7-text-faint, var(--text-faint));
}
.curator-voice-workspace button.bm8-liner-track.is-active,
.bm8-liner-track.is-active {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border-color: color-mix(in srgb, var(--bm7-gold, #c6922a) 42%, var(--bm7-border, transparent)) !important;
  box-shadow: 0 2px 7px -3px rgba(0, 0, 0, 0.18) !important;
  font-weight: 650 !important;
}
.bm8-liner-track.is-active .bm8-liner-no {
  color: var(--bm7-gold, #c6922a);
  opacity: 1;
}
.bm8-liner-track.is-active::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bm7-gold, #d69e2e);
  box-shadow: 0 0 6px rgba(214, 158, 46, 0.65);
  flex-shrink: 0;
}

.curator-voice-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important;
  gap: 14px !important;
}

.curator-voice-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 16px 18px !important;
  border-radius: 14px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: var(--bm7-shadow-sm, 0 2px 8px rgba(15, 23, 42, 0.04)) !important;
  overflow: hidden;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 160ms ease, box-shadow 180ms ease !important;
}
.curator-voice-card::before {
  content: "“";
  position: absolute;
  top: 4px;
  right: 14px;
  font-family: Georgia, "Noto Serif SC", serif;
  font-size: 54px;
  line-height: 1;
  color: var(--bm7-accent, var(--interactive-accent));
  opacity: 0.08;
  pointer-events: none;
}
.curator-voice-card.is-playing {
  border-color: color-mix(in srgb, var(--bm7-accent, #5b6cf2) 55%, var(--bm7-border, transparent)) !important;
  box-shadow: 0 10px 26px -12px color-mix(in srgb, var(--bm7-accent, #5b6cf2) 32%, rgba(0, 0, 0, 0.2)) !important;
}
.curator-voice-card:hover {
  transform: translateY(-2px);
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
}

.curator-voice-quote-text {
  font-size: 14.5px !important;
  font-weight: 600 !important;
  line-height: 1.6 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  letter-spacing: 0.01em;
  padding-right: 18px;
}

.curator-voice-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.curator-voice-chip {
  font-size: 12px !important;
  padding: 2px 8px !important;
  border-radius: 6px !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-voice-chip.is-char {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.12)) !important;
  border-color: transparent !important;
  font-weight: 600 !important;
}

/* 定制触感音频播放器（彻底取代浏览器原生灰条 <audio controls>） */
.bm8-voice-player {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--bm7-surface, var(--background-primary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
}
.curator-voice-workspace button.bm8-voice-play-btn,
.bm8-voice-play-btn {
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  padding: 0 !important;
  border-radius: 999px !important;
  border: none !important;
  background: var(--bm7-accent, var(--interactive-accent)) !important;
  color: #ffffff !important;
  box-shadow: 0 3px 10px -2px color-mix(in srgb, var(--bm7-accent, #5b6cf2) 45%, transparent) !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  flex-shrink: 0 !important;
  transition: transform 140ms ease, filter 140ms ease;
}
.curator-voice-workspace button.bm8-voice-play-btn svg,
.bm8-voice-play-btn svg {
  color: #ffffff !important;
}
.curator-voice-workspace button.bm8-voice-play-btn:hover,
.bm8-voice-play-btn:hover {
  transform: scale(1.06);
  filter: brightness(1.07);
}
.bm8-voice-scrub-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.bm8-voice-scrub {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--bm7-surface-2, rgba(127, 127, 127, 0.16));
  cursor: pointer;
  overflow: hidden;
}
.bm8-voice-scrub-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: var(--bm7-accent, var(--interactive-accent));
  transition: width 80ms linear;
}
.bm8-voice-time-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--bm7-text-faint, var(--text-faint));
}
.bm8-voice-eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
  opacity: 0;
  transition: opacity 150ms ease;
}
.curator-voice-card.is-playing .bm8-voice-eq {
  opacity: 1;
}
.bm8-voice-eq i {
  display: block;
  width: 2.5px;
  height: 4px;
  border-radius: 2px;
  background: var(--bm7-accent, var(--interactive-accent));
  animation: bm8VoiceEqPulse 760ms ease-in-out infinite alternate;
}
.bm8-voice-eq i:nth-child(2) { animation-delay: 180ms; height: 9px; }
.bm8-voice-eq i:nth-child(3) { animation-delay: 340ms; height: 6px; }
@keyframes bm8VoiceEqPulse {
  0% { transform: scaleY(0.38); }
  100% { transform: scaleY(1); }
}

.curator-voice-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
}
.curator-voice-workspace button.bm8-voice-trash-btn,
.bm8-voice-trash-btn {
  width: 28px !important;
  height: 28px !important;
  min-width: 28px !important;
  padding: 0 !important;
  border-radius: 7px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-faint, var(--text-faint)) !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  margin-left: auto !important;
  transition: color 140ms ease, background 140ms ease;
}
.curator-voice-workspace button.bm8-voice-trash-btn:hover,
.bm8-voice-trash-btn:hover {
  color: #dc2626 !important;
  background: rgba(220, 38, 38, 0.1) !important;
}


/* ==========================================================================
   4. 全部番剧（Editorial Library Shelf & Index · 片库陈列架与编目台账）
   ========================================================================== */
.curator-mount-catalog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 18px !important;
}

.curator-catalog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px !important;
  margin: 0 !important;
  border-radius: 14px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-catalog-header .curator-section-title {
  margin: 0 !important;
  font-size: 18px !important;
  font-weight: 700 !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-catalog-header .curator-section-badge {
  font-size: 12px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 999px !important;
  padding: 2px 10px !important;
}
.curator-catalog-header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.curator-mode-toggle-group {
  display: inline-flex;
  padding: 3px !important;
  border-radius: 9px !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 5.5%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 70%, transparent) !important;
}
.curator-mode-btn {
  height: 27px !important;
  padding: 0 11px !important;
  border: none !important;
  border-radius: 6px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.curator-mode-btn.is-active {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
  font-weight: 600 !important;
}

.curator-catalog-toolbar {
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
  gap: 10px !important;
  padding: 12px 16px !important;
  margin: 0 !important;
  border-radius: 13px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-catalog-toolbar .curator-search-wrap,
.curator-search-wrap {
  position: relative;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  flex: 0 0 auto !important;
  width: 100% !important;
  max-width: 100% !important;
  height: 36px !important;
  min-height: 36px !important;
  max-height: 36px !important;
  margin: 0 !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 9px !important;
}
.curator-catalog-toolbar .curator-search-input,
.curator-search-wrap .curator-search-input {
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 34px !important;
  padding: 0 30px 0 32px !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  font-size: 12.5px !important;
}
.curator-catalog-toolbar .curator-search-input:focus,
.curator-search-wrap .curator-search-input:focus {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
}
.curator-search-wrap:focus-within {
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: 0 0 0 2px var(--bm7-accent-soft, rgba(91, 108, 242, 0.14)) !important;
}
/* 全部番剧：片库书架分栏尺（Shelf Ledger Bar）+ 书签批注纸签（Marginalia Tag Slips） */
.curator-filter-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding-bottom: 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--bm7-border, rgba(127, 127, 127, 0.2)) 80%, transparent);
}
.curator-catalog-tagbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.curator-filter-bar > .curator-filter-pill {
  position: relative;
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  height: 29px !important;
  padding: 0 10px !important;
  border-radius: 6px 6px 0 0 !important;
  background: transparent !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: none !important;
  box-shadow: none !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease !important;
}
.curator-filter-bar > .curator-filter-pill:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 4.5%, transparent) !important;
}
.curator-filter-bar > .curator-filter-pill.is-active,
.bm7-root:not([data-bm7-theme="follow"]) .curator-filter-bar > .curator-filter-pill.is-active {
  background: transparent !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  border: none !important;
  box-shadow: none !important;
  font-weight: 650 !important;
}
.curator-filter-bar > .curator-filter-pill.is-active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -5px;
  height: 2.5px;
  border-radius: 2px;
  background: var(--bm7-accent, var(--interactive-accent));
}
.curator-filter-bar > .curator-filter-pill.is-active .curator-pill-count {
  color: var(--bm7-accent, var(--interactive-accent));
  opacity: 1;
}

.curator-catalog-tagbar > .curator-filter-pill.is-tag-chip,
.curator-filter-pill {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  height: 25px !important;
  padding: 0 9px !important;
  border-radius: 5px !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 5%, transparent) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: none !important;
  box-shadow: none !important;
  font-size: 12px !important;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease !important;
}
.curator-catalog-tagbar > .curator-filter-pill.is-tag-chip:hover,
.curator-filter-pill:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 9%, transparent) !important;
}
.curator-catalog-tagbar > .curator-filter-pill.is-tag-chip.is-active,
.curator-filter-pill.is-active {
  background: var(--bm7-accent-soft, rgba(91, 108, 242, 0.15)) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: inset 2.5px 0 0 var(--bm7-accent, var(--interactive-accent)) !important;
  font-weight: 600 !important;
}
.curator-pill-count {
  font-size: 12px !important;
  opacity: 0.78;
}

.curator-gallery-card {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 12px !important;
  box-shadow: var(--bm7-shadow-sm, 0 2px 6px rgba(15, 23, 42, 0.04)) !important;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 160ms ease, box-shadow 180ms ease !important;
}
.curator-gallery-card:hover {
  transform: translateY(-2px) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
  box-shadow: 0 10px 24px -10px rgba(15, 23, 42, 0.18) !important;
}
.curator-gallery-title {
  color: var(--bm7-text, var(--text-normal)) !important;
}
.curator-gallery-distinguisher,
.curator-gallery-meta {
  color: var(--bm7-text-dim, var(--text-muted)) !important;
}
.curator-desk-root .curator-gallery-footer,
.curator-gallery-footer {
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
}
/* 全部番剧封面卡内嵌微操作按钮：彻底剥离宿主灰框阴影 */
.curator-desk-root button.bangumi-grid-ep-btn,
.bangumi-grid-ep-btn {
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
}
.curator-desk-root button.curator-gallery-add-tag,
.curator-desk-root button.bangumi-grid-add-tag-btn,
.curator-gallery-add-tag {
  background: transparent !important;
  box-shadow: none !important;
  border: 1px dashed var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 4px !important;
  color: var(--bm7-text-faint, var(--text-faint)) !important;
}
.curator-desk-root button.curator-gallery-quiet-link,
.curator-gallery-quiet-link {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  height: auto !important;
  padding: 2px 5px !important;
  border-radius: 5px !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  transition: color 140ms ease, background 140ms ease !important;
}
.curator-desk-root button.curator-gallery-quiet-link:hover,
.curator-gallery-quiet-link:hover {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 6%, transparent) !important;
  text-decoration: none !important;
}
.curator-catalog-fold-btn {
  height: auto !important;
  border-radius: 999px !important;
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  box-shadow: none !important;
  padding: 7px 18px !important;
  font-size: 12.5px !important;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease !important;
}
.curator-search-clear {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.curator-catalog-fold-btn:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
}

.curator-index-table-wrap {
  background: var(--bm7-panel-bg, var(--background-secondary)) !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  border-radius: 13px !important;
  overflow: hidden;
}
.curator-index-header-row {
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  border-bottom: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-index-row {
  border-bottom: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
}
.curator-index-row:hover {
  background: var(--bm7-surface, rgba(127, 127, 127, 0.05)) !important;
}


/* ==========================================================================
   5. 全工作区多宽度容器自适应（双侧栏展开 / 单侧栏 / 窄屏 0 溢出兜底）
   ========================================================================== */
@container bmdesk (max-width: 820px) {
  .curator-workspace-mode-bar {
    padding: 6px 8px !important;
  }
  .curator-workspace-mode-btn,
  .curator-workspace-tab {
    padding: 5px 8px !important;
    font-size: 12px !important;
  }
}

@container bmdesk (max-width: 560px) {
  div.curator-desk-root .curator-workspace-mode-tabs {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
  div.curator-desk-root .curator-workspace-mode-btn {
    min-height: 38px !important;
    height: 38px !important;
    padding: 0 5px !important;
  }
  div.curator-desk-root .curator-workspace-mode-btn .curator-ws-mode-icon {
    display: none !important;
  }
}

@container bmhall (max-width: 860px) {
  .curator-index-header-row .col-season,
  .curator-index-header-row .col-bgmscore,
  .curator-index-row .col-season,
  .curator-index-row .col-bgmscore {
    display: none !important;
  }
  .curator-index-header-row,
  .curator-index-row {
    grid-template-columns: 38px 44px minmax(140px, 1fr) 62px 92px 68px 88px !important;
  }
  .curator-char-cards-grid,
  .curator-voice-cards-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) !important;
  }
}

/* ==========================================================================
   6. 全馆统一左置筛选栏（物理隔离本地筛选与右侧主操作按钮，免疫侧边栏拖拽与第三方主题污染）
      + 角色收录台多角色待收录队列栏
   ========================================================================== */
.curator-illust-workspace > .curator-char-header.bm-hall-header-stack,
.curator-voice-workspace > .curator-char-header.bm-hall-header-stack,
.curator-char-header-bar.bm-hall-header-stack,
.curator-radar-status-strip.bm-hall-header-stack {
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
  justify-content: flex-start !important;
  gap: 10px !important;
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}

.bm-hall-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.bm-hall-header-top > .curator-char-header-left,
.bm-hall-header-top > .curator-radar-status-text {
  flex: 1 1 220px;
  min-width: 0;
}
.bm-hall-header-top > .curator-char-header-actions,
.bm-hall-header-top > .curator-char-header-right,
.bm-hall-header-top > .curator-radar-controls-right {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
  min-width: 0;
  max-width: 100%;
}

.bm-hall-filter-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
  min-width: 0;
  padding-top: 9px;
  border-top: 1px dashed color-mix(in srgb, var(--bm7-border, var(--background-modifier-border)) 82%, transparent);
  box-sizing: border-box;
}

.bm-hall-filter-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 1 360px;
  width: min(360px, 100%);
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.bm-hall-filter-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--bm7-text-faint, var(--text-faint));
  pointer-events: none;
  z-index: 2;
}

.bm-hall-filter-wrap input.bm-hall-filter-input {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  height: 34px !important;
  min-height: 34px !important;
  margin: 0 !important;
  padding: 0 30px 0 32px !important;
  border-radius: 9px !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  background: var(--bm7-surface, var(--background-primary)) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03) !important;
  appearance: none !important;
  -webkit-appearance: none !important;
  box-sizing: border-box !important;
  transition: border-color 140ms ease, box-shadow 140ms ease !important;
}
.bm-hall-filter-wrap input.bm-hall-filter-input::placeholder {
  color: var(--bm7-text-faint, var(--text-faint)) !important;
  opacity: 0.9;
}
.bm-hall-filter-wrap input.bm-hall-filter-input:focus {
  outline: none !important;
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 18%, transparent) !important;
}
.bm-hall-filter-wrap input.bm-hall-filter-input::-webkit-search-cancel-button,
.bm-hall-filter-wrap input.bm-hall-filter-input::-webkit-search-decoration,
.bm-hall-filter-wrap input.bm-hall-filter-input::-webkit-search-results-button,
.bm-hall-filter-wrap input.bm-hall-filter-input::-webkit-search-results-decoration {
  display: none !important;
  -webkit-appearance: none !important;
}

.curator-workspace-pane button.bm-hall-filter-clear,
button.bm-hall-filter-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 999px !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 15px !important;
  line-height: 1 !important;
  cursor: pointer;
  z-index: 2;
}
.curator-workspace-pane button.bm-hall-filter-clear.is-visible,
button.bm-hall-filter-clear.is-visible {
  display: inline-flex !important;
}
.curator-workspace-pane button.bm-hall-filter-clear:hover,
button.bm-hall-filter-clear:hover {
  background: color-mix(in srgb, var(--bm7-ink, #888) 12%, transparent) !important;
  color: var(--bm7-text, var(--text-normal)) !important;
}

/* 角色典藏：统一「馆藏筛选与萌点偏好」整合面板 */
.curator-char-filter-hub .curator-char-rank-head {
  margin-bottom: 12px !important;
  padding-bottom: 10px !important;
  border-bottom: 1px dashed color-mix(in srgb, var(--bm7-border, var(--background-modifier-border)) 88%, transparent) !important;
}
.curator-char-unified-filter-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px 10px;
  flex-wrap: wrap;
  margin: 0 0 12px 0;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.curator-char-unified-filter-row .bm-hall-filter-wrap {
  flex: 0 1 380px;
  width: min(380px, 100%);
}
.curator-char-filter-status {
  display: inline-flex;
  align-items: center;
  gap: 6px 8px;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.curator-char-filter-status:empty {
  display: none;
}
.curator-workspace-pane button.curator-char-active-filter-chip,
button.curator-char-active-filter-chip {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  height: 28px !important;
  min-height: 0 !important;
  padding: 0 10px !important;
  border-radius: 999px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 45%, transparent) !important;
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 12%, var(--bm7-surface, var(--background-primary))) !important;
  box-shadow: none !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer;
  white-space: nowrap;
  max-width: 100%;
  transition: background 140ms ease, border-color 140ms ease !important;
}
.curator-workspace-pane button.curator-char-active-filter-chip:hover,
button.curator-char-active-filter-chip:hover {
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 19%, var(--bm7-surface, var(--background-primary))) !important;
  border-color: var(--bm7-accent, var(--interactive-accent)) !important;
}
.curator-char-active-filter-x {
  font-size: 14px;
  line-height: 1;
  opacity: 0.78;
}
.curator-char-filter-match-count {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bm7-ink, #888) 7%, transparent);
  color: var(--bm7-text-dim, var(--text-muted));
  font-size: 12px;
  white-space: nowrap;
}
.curator-workspace-pane button.curator-char-filter-reset-btn,
button.curator-char-filter-reset-btn {
  display: inline-flex !important;
  align-items: center !important;
  height: 26px !important;
  min-height: 0 !important;
  padding: 0 9px !important;
  border-radius: 7px !important;
  border: 1px solid var(--bm7-border, var(--background-modifier-border)) !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-dim, var(--text-muted)) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  cursor: pointer;
  white-space: nowrap;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease !important;
}
.curator-workspace-pane button.curator-char-filter-reset-btn:hover,
button.curator-char-filter-reset-btn:hover {
  color: var(--bm7-text, var(--text-normal)) !important;
  border-color: var(--bm7-border-strong, var(--background-modifier-border-hover)) !important;
  background: color-mix(in srgb, var(--bm7-ink, #888) 7%, transparent) !important;
}
.curator-char-rank-body-slot {
  min-width: 0;
  max-width: 100%;
}
.curator-char-rank-bar-card.is-query-match:not(.is-selected) {
  border-color: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 55%, var(--bm7-border, var(--background-modifier-border))) !important;
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 6%, var(--bm7-surface, var(--background-primary))) !important;
}
.curator-char-cloud-pill.is-query-match:not(.is-selected) {
  border-color: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 58%, transparent) !important;
  color: var(--bm7-accent, var(--interactive-accent)) !important;
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 8%, var(--bm7-surface, var(--background-primary))) !important;
}

/* 画册典藏：贴近展厅的独立本地筛选条（与在线搜图抽屉解耦） */
.bm-hall-browse-filter-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--bm7-panel-bg, var(--background-secondary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.bm-hall-browse-filter-bar .bm-hall-filter-wrap {
  flex: 0 1 380px;
  width: min(380px, 100%);
}

/* 音声典藏：整合关键词筛选 + 曲目单的统一本地筛选面板（消除双层边框） */
.bm-voice-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background:
    repeating-linear-gradient(0deg, rgba(127, 127, 127, 0.025) 0 1px, transparent 1px 4px),
    var(--bm7-panel-bg, var(--background-secondary));
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03);
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.bm-voice-filter-search-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px 10px;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
.bm-voice-filter-search-row .bm-hall-filter-wrap {
  flex: 0 1 380px;
  width: min(380px, 100%);
}
.bm-voice-filter-panel > .bm8-voice-filter-strip {
  padding: 8px 0 0 0 !important;
  border: none !important;
  border-top: 1px dashed color-mix(in srgb, var(--bm7-border, var(--background-modifier-border)) 82%, transparent) !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* 角色收录台：多角色待收录队列栏 */
.curator-char-queue-host:empty {
  display: none;
}
.curator-char-queue-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 9px 12px;
  margin-bottom: 10px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 32%, var(--bm7-border, var(--background-modifier-border)));
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 7%, var(--bm7-surface, var(--background-primary)));
  min-width: 0;
  box-sizing: border-box;
}
.curator-char-queue-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--bm7-accent, var(--interactive-accent));
  white-space: nowrap;
}
.curator-char-queue-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
}
.curator-char-queue-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--bm7-border, var(--background-modifier-border));
  background: var(--bm7-surface, var(--background-primary));
  max-width: 100%;
  overflow: hidden;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.curator-char-queue-chip.is-active {
  border-color: var(--bm7-accent, var(--interactive-accent));
  background: color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 14%, var(--bm7-surface, var(--background-primary)));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 22%, transparent);
}
.curator-char-queue-chip.is-loading {
  border-style: dashed;
}
.curator-workspace-pane button.curator-char-queue-chip-btn,
button.curator-char-queue-chip-btn {
  display: inline-flex !important;
  align-items: center !important;
  height: 26px !important;
  min-height: 0 !important;
  padding: 0 8px 0 10px !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text, var(--text-normal)) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.curator-char-queue-chip.is-active button.curator-char-queue-chip-btn {
  color: var(--bm7-accent, var(--interactive-accent)) !important;
}
.curator-workspace-pane button.curator-char-queue-chip-remove,
button.curator-char-queue-chip-remove {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 26px !important;
  min-width: 22px !important;
  min-height: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--bm7-text-faint, var(--text-faint)) !important;
  font-size: 13px !important;
  cursor: pointer;
}
.curator-workspace-pane button.curator-char-queue-chip-remove:hover,
button.curator-char-queue-chip-remove:hover {
  color: #c94440 !important;
  background: rgba(201, 68, 64, 0.1) !important;
}
.curator-char-queue-batch-btn {
  height: 28px !important;
  padding: 0 11px !important;
  font-size: 12px !important;
  flex-shrink: 0;
}
.curator-char-draft-submit-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.curator-char-offline-banner {
  margin: 0 0 10px 0;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px dashed color-mix(in srgb, var(--bm7-amber, #c6862a) 42%, var(--bm7-border, var(--background-modifier-border)));
  background: color-mix(in srgb, var(--bm7-amber, #c6862a) 8%, var(--bm7-surface, var(--background-primary)));
  color: var(--bm7-text-muted, var(--text-muted));
  font-size: 12px;
  line-height: 1.5;
}

@container bmhall (max-width: 600px) {
  .curator-illust-workspace > .curator-char-header,
  .curator-voice-workspace > .curator-char-header,
  .curator-char-header-bar,
  .curator-catalog-header {
    padding: 12px !important;
  }
  .bm-hall-header-top > .curator-char-header-actions,
  .bm-hall-header-top > .curator-char-header-right,
  .bm-hall-header-top > .curator-radar-controls-right {
    margin-left: 0;
    width: 100%;
  }
  .bm-hall-filter-wrap {
    flex: 1 1 100%;
    width: 100%;
    max-width: 100%;
  }
  .curator-char-unified-filter-row .bm-hall-filter-wrap,
  .bm-hall-browse-filter-bar .bm-hall-filter-wrap,
  .bm-voice-filter-search-row .bm-hall-filter-wrap {
    flex: 1 1 100%;
    width: 100%;
  }
  .bm-hall-browse-filter-bar,
  .bm-voice-filter-panel {
    padding: 10px 12px;
  }
  .bm-hall-filter-wrap input.bm-hall-filter-input {
    height: 38px !important;
    min-height: 38px !important;
    font-size: 14px !important;
  }
  .curator-char-add-searchbar > .curator-btn {
    flex: 1 1 auto;
    justify-content: center;
  }
  .curator-char-queue-batch-btn {
    margin-left: 0;
    width: 100%;
    height: 34px !important;
    justify-content: center;
  }
  .curator-char-draft-submit-btns {
    width: 100%;
  }
  .curator-char-draft-submit-btns > .curator-btn {
    flex: 1 1 140px;
    justify-content: center;
  }
  .curator-illust-workspace .curator-char-search-input:not(.bm-hall-filter-input),
  .curator-voice-workspace .curator-char-search-input:not(.bm-hall-filter-input),
  .curator-char-header-actions .curator-char-search-input:not(.bm-hall-filter-input) {
    width: 100% !important;
    flex: 1 1 100%;
  }
  .curator-index-header-row .col-idx,
  .curator-index-header-row .col-actions,
  .curator-index-header-row .col-progress,
  .curator-index-row .col-idx,
  .curator-index-row .col-actions,
  .curator-index-row .col-progress {
    display: none !important;
  }
  .curator-index-header-row,
  .curator-index-row {
    min-width: 0 !important;
    grid-template-columns: 36px minmax(0, 1fr) 52px 54px !important;
    gap: 6px !important;
    padding-left: 8px !important;
    padding-right: 8px !important;
  }
  .curator-char-cards-grid,
  .curator-voice-cards-grid,
  .curator-char-rank-bars-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .bm8-folio-bar {
    padding: 8px;
  }
}

@media (max-width: 600px) {
  .curator-index-header-row .col-season,
  .curator-index-header-row .col-bgmscore,
  .curator-index-header-row .col-idx,
  .curator-index-header-row .col-actions,
  .curator-index-header-row .col-progress,
  .curator-index-row .col-season,
  .curator-index-row .col-bgmscore,
  .curator-index-row .col-idx,
  .curator-index-row .col-actions,
  .curator-index-row .col-progress {
    display: none !important;
  }
  .curator-index-header-row,
  .curator-index-row {
    min-width: 0 !important;
    grid-template-columns: 36px minmax(0, 1fr) 52px 54px !important;
    gap: 6px !important;
    padding-left: 8px !important;
    padding-right: 8px !important;
  }
}
`;

module.exports = { HALLS_AESTHETIC_CSS };
