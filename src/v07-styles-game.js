/**
 * v0.8 样式 · 第 3 部分：游戏典藏（首屏、等高行封面网格、分组、封面比例编辑、统计抽屉、多源搜索）
 */
module.exports = String.raw`
/* ====================== 首屏 ====================== */
@container bm7stage (min-width: 1080px){
  .bm7-game-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(300px,.85fr);grid-template-areas:"hero hero side" "pick rhythm side";}
}
@container bm7stage (min-width: 720px) and (max-width: 1079px){
  .bm7-game-grid{grid-template-areas:"hero hero" "pick side" "rhythm side";}
  .bm7-game-grid .bm7-area-side .bm7-panel-feed{flex:1 1 0;min-height:320px;}
  .bm7-game-grid .bm7-area-side .bm7-panel-feed .bm7-panel-body{position:relative;flex:1 1 0;min-height:0;padding:0;}
  .bm7-game-grid .bm7-area-side .bm7-panel-feed .bm7-feed-scroll{position:absolute;inset:12px 10px 12px 16px;max-height:none;overflow:auto;}
}
@container bm7stage (max-width: 719px){
  .bm7-game-grid{grid-template-areas:"hero" "pick" "rhythm" "side";}
}
.bm7-ghero{min-height:260px;}
.bm7-ghero-plate{width:auto;height:clamp(150px,19cqw,230px);}
.bm7-ghero-plate .bm7-gcover{height:100%;width:auto;aspect-ratio:var(--ar);border-radius:5px;}
.bm7-ghero-figs{display:grid;grid-template-columns:repeat(4,minmax(0,auto));justify-content:start;gap:4px 26px;margin:2px 0 2px;}
.bm7-ghero-fig{display:flex;flex-direction:column;gap:2px;min-width:0;}
.bm7-ghero-fig-label{font-size:12px;font-weight:600;color:var(--bm7-ink-2);}
.bm7-ghero-fig-val{font-size:17px;font-weight:800;color:var(--bm7-ink);font-variant-numeric:tabular-nums;white-space:nowrap;}
.bm7-btn.is-timing{border-color:var(--bm7-live);color:var(--bm7-live);}
.bm7-root[data-bm7-motion="on"] .bm7-btn.is-timing .bm7-ico{animation:bm7-spin 3s linear infinite;}
.bm7-gsum{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.bm7-seg.is-mini{padding:2px;margin:-2px 0 0 -2px;}
.bm7-seg.is-mini .bm7-seg-btn{height:22px;padding:0 8px;font-size:12px;}
.bm7-gweek{margin-top:14px;}
.bm7-gweek .bm7-dist-bars{height:58px;}
@container bm7stage (max-width: 719px){
  .bm7-ghero-figs{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;}
  .bm7-ghero-plate{height:clamp(120px,36cqw,170px);}
}
@container bm7stage (max-width: 460px){
  .bm7-ghero .bm7-hero-main{grid-template-columns:92px minmax(0,1fr);gap:10px 12px;}
  .bm7-ghero-plate{position:relative;top:auto;right:auto;width:92px;height:auto;max-height:138px;margin-top:-12px;padding:4px;}
  .bm7-ghero-plate .bm7-gcover{width:100%;height:auto;}
  .bm7-ghero .bm7-hero-info{padding-top:10px;padding-right:0;}
  .bm7-ghero-figs{gap:6px 10px;}
  .bm7-ghero-fig-val{font-size:15px;}
}

/* ====================== 全部游戏 ====================== */
.bm7-glib{display:flex;flex-direction:column;gap:14px;margin-top:16px;padding:18px 18px 22px;border-radius:var(--bm7-radius);border:1px solid var(--bm7-line);
  background:var(--bm7-panel-bg);box-shadow:var(--bm7-shadow);-webkit-backdrop-filter:blur(var(--bm7-blur));backdrop-filter:blur(var(--bm7-blur));min-width:0;}
.bm7-glib-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;}
.bm7-glib-toolbar{display:flex;flex-direction:column;gap:10px;min-width:0;}
.bm7-glib-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;}
.bm7-glib-search{flex:1 1 220px;max-width:360px;}
.bm7-select{padding-right:26px;cursor:pointer;}
.bm7-glib-body{display:flex;flex-direction:column;gap:20px;min-width:0;}

/* 等高行：flex-grow 与封面比例成正比 → 同一行高度一致，比例各自保留 */
.bm7-gjust{--row-h:214px;display:flex;flex-wrap:wrap;gap:16px 14px;min-width:0;}
.bm7-gjust-filler{flex-grow:999999;flex-basis:0;}
.bm7-gcard{position:relative;display:flex;flex-direction:column;gap:8px;min-width:0;max-width:100%;
  flex-grow:calc(var(--ar) * 100);flex-basis:calc(var(--ar) * var(--row-h));max-width:min(100%, calc(var(--ar) * var(--row-h) * 1.18));cursor:pointer;outline:none;}
.bm7-gcover{position:relative;width:100%;aspect-ratio:var(--ar);border-radius:10px;overflow:hidden;background:color-mix(in srgb,var(--bm7-ink) 8%,transparent);
  box-shadow:0 1px 2px rgb(0 0 0 / .08),0 12px 24px -16px rgb(0 0 0 / .55);transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease;}
.bm7-gcover .bm7-gcover-img{position:absolute;inset:0;width:100%;height:100%;background:transparent;}
.bm7-gcover.is-cover .bm7-gcover-img img{object-fit:cover;object-position:50% var(--fy,30%);}
.bm7-gcover.is-contain .bm7-gcover-img img{object-fit:contain;filter:drop-shadow(0 6px 14px rgb(0 0 0 / .35));}
.bm7-gcover-bg{position:absolute;inset:-24px;background-size:cover;background-position:center;filter:blur(22px) saturate(1.4) brightness(.92);opacity:.85;}
.bm7-gcard:hover .bm7-gcover,.bm7-gcard:focus-visible .bm7-gcover{transform:translateY(-3px);box-shadow:0 2px 4px rgb(0 0 0 / .1),0 22px 34px -18px rgb(0 0 0 / .6);}
.bm7-gcard:focus-visible .bm7-gcover{outline:2px solid var(--bm7-accent);outline-offset:3px;}
.bm7-gcard-status{position:absolute;left:8px;top:8px;z-index:2;height:21px;padding:0 8px;border-radius:999px;display:inline-flex;align-items:center;font-size:12px;font-weight:700;
  color:#fff;background:rgb(20 20 24 / .58);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}
.bm7-gcard-status[data-st="在玩"]{background:color-mix(in srgb,var(--bm7-accent) 84%,#000 0%);color:var(--bm7-accent-ink);}
.bm7-gcard-status[data-st="通关"],.bm7-gcard-status[data-st="全成就"]{background:rgb(40 140 96 / .88);}
.bm7-gcard-overlay{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:28px 8px 10px;
  background:linear-gradient(to top,rgb(0 0 0 / .62),transparent);opacity:0;pointer-events:none;transform:translateY(6px);transition:opacity .2s ease,transform .2s ease;}
.bm7-gcard-overlay .bm7-btn{height:30px;padding:0 11px;}
.bm7-gcard-overlay .bm7-btn:not(.is-primary){background:rgb(255 255 255 / .9);color:#222;border-color:transparent;}
@media (hover:hover){ .bm7-gcard:hover .bm7-gcard-overlay,.bm7-gcard:focus-within .bm7-gcard-overlay{opacity:1;pointer-events:auto;transform:none;} }
@media (hover:none),(pointer:coarse){
  .bm7-gcard-overlay{opacity:1;pointer-events:auto;transform:none;padding:16px 6px 6px;gap:4px;}
  .bm7-gcard-overlay .bm7-btn{height:26px;padding:0 8px;font-size:12px;}
}
.bm7-gcard-body{display:flex;flex-direction:column;gap:3px;min-width:0;padding:0 28px 0 2px;}
.bm7-gcard-title{font-size:13px;font-weight:700;color:var(--bm7-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-gcard-meta{display:flex;gap:8px;font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;}
.bm7-gcard-dev{overflow:hidden;text-overflow:ellipsis;min-width:0;}
.bm7-gcard-score{color:var(--bm7-gold);font-weight:700;flex-shrink:0;}
.bm7-gcard-more{position:absolute !important;right:-4px;bottom:2px;width:28px !important;height:28px !important;}
.bm7-gcard.is-reorder{cursor:grab;}
.bm7-gcard.is-reorder .bm7-gcover{outline:1.5px dashed color-mix(in srgb,var(--bm7-accent) 60%,transparent);outline-offset:3px;}
.bm7-gcard.is-dragging{opacity:.4;}
.bm7-gcard.is-over .bm7-gcover{transform:translateX(6px);box-shadow:-6px 0 0 -2px var(--bm7-accent);}
.bm7-gcard-grip{position:absolute;top:8px;right:8px;z-index:3;width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:rgb(255 255 255 / .9);color:#333;}
.bm7-gcard-order{position:absolute;left:0;right:0;top:calc(100% - 64px);z-index:3;display:flex;justify-content:space-between;padding:0 6px;}
.bm7-gcard-order .bm7-btn.is-icon{width:30px;height:30px;background:rgb(255 255 255 / .92);color:#222;border-color:transparent;}
.bm7-ggroup{display:flex;flex-direction:column;gap:12px;}
.bm7-ggroup-head{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--bm7-line);}
.bm7-ggroup-title{margin:0;font-size:14px;font-weight:750;}
.bm7-ggroup-count{font-size:12px;font-weight:700;color:var(--bm7-ink-3);padding:0 7px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);line-height:19px;}
.bm7-ggroup.is-muted .bm7-ggroup-title{color:var(--bm7-ink-2);}
.bm7-ggroup-empty{font-size:12px;color:var(--bm7-ink-3);padding:6px 0 4px;}
.bm7-root .bm7-gnewgroup{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;height:34px;padding:0 14px;border-radius:10px;border:1.5px dashed var(--bm7-line);
  background:transparent;color:var(--bm7-ink-2);font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:none;}
.bm7-root .bm7-gnewgroup:hover{border-color:var(--bm7-accent);color:var(--bm7-accent);}
.bm7-menu-item.is-checked{color:var(--bm7-accent) !important;font-weight:650;}
@container bm7stage (max-width: 719px){ .bm7-gjust{--row-h:190px;gap:14px 10px;} }
@container bm7stage (max-width: 460px){
  .bm7-glib{padding:14px;}
  .bm7-gjust{--row-h:150px;gap:14px 10px;}
  .bm7-glib-search{max-width:none;}
  .bm7-gcard-body{padding-right:30px;}
}

/* ====================== 封面比例编辑 ====================== */
.bm7-ce{display:grid;grid-template-columns:132px minmax(0,1fr);gap:14px;align-items:start;padding:4px 0 6px;}
.bm7-ce-preview{display:flex;align-items:center;justify-content:center;height:180px;border-radius:10px;background:color-mix(in srgb,var(--bm7-ink) 5%,transparent);padding:8px;}
.bm7-ce-preview .bm7-gcover{width:min(116px, calc(164px * var(--ar)));max-width:100%;max-height:100%;}
.bm7-ce-controls{display:flex;flex-direction:column;gap:10px;min-width:0;}
.bm7-ce-chips{display:flex;flex-wrap:wrap;gap:6px;}
.bm7-root .bm7-ce-chip{height:27px;padding:0 10px;border-radius:999px;border:1px solid var(--bm7-line);background:var(--bm7-surface);color:var(--bm7-ink-2);font-size:12px;cursor:pointer;box-shadow:none;display:inline-flex;align-items:center;}
.bm7-root .bm7-ce-chip:hover{border-color:var(--bm7-accent);color:var(--bm7-ink);}
.bm7-root .bm7-ce-chip.is-active{background:var(--bm7-accent);border-color:var(--bm7-accent);color:var(--bm7-accent-ink);font-weight:650;}
.bm7-ce-row{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--bm7-ink-2);min-width:0;}
.bm7-ce-row > span:first-child{width:52px;flex-shrink:0;}
.bm7-ce-val{width:38px;text-align:right;font-variant-numeric:tabular-nums;color:var(--bm7-ink-3);}
.bm7-range{flex:1;min-width:0;accent-color:var(--bm7-accent);}
.bm7-ce-hint{margin:0;font-size:12px;line-height:1.5;color:var(--bm7-ink-3);white-space:normal;overflow-wrap:anywhere;}
.bm7-ce-actions{display:flex;align-items:center;gap:8px;padding-top:8px;margin-top:4px;border-top:1px solid var(--bm7-line);}
.bm7-pop.is-sheet .bm7-ce{grid-template-columns:110px minmax(0,1fr);}

/* ====================== 详情与统计抽屉 ====================== */
.bm7-drawer{position:fixed;inset:0;z-index:48;display:flex;justify-content:flex-end;background:transparent !important;}
.bm7-drawer-scrim{position:absolute;inset:0;background:rgb(10 10 14 / .34);animation:bm7-fade-in .2s ease;}
.bm7-drawer-sheet{position:relative;width:min(500px,100%);height:100%;background:var(--bm7-surface);border-left:1px solid var(--bm7-line);box-shadow:-30px 0 60px -30px rgb(0 0 0 / .5);
  animation:bm7-drawer-in .28s cubic-bezier(.2,.9,.3,1);display:flex;flex-direction:column;min-width:0;}
.bm7-root[data-bm7-theme="glow"] .bm7-drawer-sheet{background:color-mix(in srgb,var(--bm7-bg) 92%,transparent);-webkit-backdrop-filter:blur(28px);backdrop-filter:blur(28px);}
.bm7-drawer.is-leaving .bm7-drawer-sheet{transform:translateX(30px);opacity:0;transition:all .2s ease;}
.bm7-drawer.is-leaving .bm7-drawer-scrim{opacity:0;transition:opacity .2s ease;}
.bm7-drawer-close{position:absolute !important;top:12px;right:12px;z-index:5;background:color-mix(in srgb,var(--bm7-surface) 82%,transparent) !important;}
.bm7-drawer-body{flex:1;overflow-y:auto;overscroll-behavior:contain;min-width:0;}
@media (max-width: 560px){
  .bm7-drawer{align-items:flex-end;}
  .bm7-drawer-sheet{width:100%;height:92%;border-left:none;border-radius:18px 18px 0 0;animation:bm7-sheet-in .28s cubic-bezier(.2,.9,.3,1);}
}
.bm7-gs{display:flex;flex-direction:column;gap:18px;padding-bottom:calc(36px + env(safe-area-inset-bottom, 0px));}
.bm7-gs-head{position:relative;overflow:hidden;padding:24px 18px 18px;isolation:isolate;}
.bm7-gs-backdrop{position:absolute;inset:-40px;z-index:-1;background-size:cover;background-position:center 30%;filter:blur(36px) saturate(1.35);opacity:.42;}
.bm7-gs-head::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(to bottom,color-mix(in srgb,var(--bm7-surface) 38%,transparent) 0,color-mix(in srgb,var(--bm7-surface) 82%,transparent) 55%,var(--bm7-surface) 100%);}
.bm7-gs-head-main{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:end;}
.bm7-gs-cover .bm7-gcover{width:104px;box-shadow:0 18px 30px -14px rgb(0 0 0 / .6);}
.bm7-gs-titles{display:flex;flex-direction:column;gap:6px;min-width:0;}
.bm7-gs-title{margin:0;font-size:21px;font-weight:820;line-height:1.25;padding-right:30px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-gs-total{display:flex;align-items:baseline;gap:8px;}
.bm7-gs-total-label{font-size:12px;font-weight:600;color:var(--bm7-ink-2);}
.bm7-gs-total-val{font-size:24px;font-weight:850;font-variant-numeric:tabular-nums;color:var(--bm7-ink);}
.bm7-gs-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}
.bm7-gs-overview,.bm7-gs-sec{padding:0 18px;display:flex;flex-direction:column;gap:12px;}
.bm7-gs-period{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;background:var(--bm7-accent-soft);}
.bm7-gs-period-val{font-size:20px;font-weight:820;font-variant-numeric:tabular-nums;color:var(--bm7-ink);}
.bm7-gs-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
.bm7-gs-sec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.bm7-gs-sec-head h4{margin:0;font-size:14px;font-weight:750;}
.bm7-gs-sec-sub{font-size:12px;color:var(--bm7-ink-3);}
.bm7-gs-bars{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:4px;height:150px;align-items:end;}
.bm7-gs-bar{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;min-width:0;}
.bm7-gs-bar-val{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;height:15px;}
.bm7-gs-bar-fill{width:100%;max-width:22px;border-radius:5px 5px 2px 2px;background:color-mix(in srgb,var(--bm7-accent) 45%,transparent);min-height:0;}
.bm7-gs-bar.is-now .bm7-gs-bar-fill{background:var(--bm7-accent);}
.bm7-gs-bar-label{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm7-gs-bar:nth-child(even) .bm7-gs-bar-label{opacity:.65;}
.bm7-gs-sessions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}
.bm7-gs-session{display:grid;grid-template-columns:minmax(96px,auto) auto auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bm7-line);font-size:12.5px;}
.bm7-gs-session:last-child{border-bottom:none;}
.bm7-gs-session-date{display:flex;gap:6px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm7-gs-session-date strong{color:var(--bm7-ink);font-weight:650;}
.bm7-gs-session-len{font-weight:750;font-variant-numeric:tabular-nums;}
.bm7-gs-session-src{font-size:12px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);color:var(--bm7-ink-2);white-space:nowrap;}
.bm7-gs-session-src[data-src="manual"]{color:var(--bm7-gold);background:color-mix(in srgb,var(--bm7-gold) 12%,transparent);}
.bm7-gs-session-src[data-src="timer"]{color:var(--bm7-accent);background:var(--bm7-accent-soft);}
.bm7-gs-session-src[data-src="watcher"],.bm7-gs-session-src[data-src="watcher_recovered"]{color:var(--bm7-ok);background:color-mix(in srgb,var(--bm7-ok) 12%,transparent);}
.bm7-gs-session-note{color:var(--bm7-ink-3);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-gs-session .bm7-btn.is-icon{width:26px;height:26px;}
.bm7-gs-session-del.is-armed{width:auto !important;padding:0 8px !important;font-size:12px !important;color:#fff !important;background:var(--bm7-live) !important;border-color:var(--bm7-live) !important;}
.bm7-gs-more-btn{align-self:flex-start;margin-top:4px;font-size:12px;}

/* 实时游玩状态与离线后台守卫胶囊 */
.bm7-ghero .bm7-kicker,.bm7-gs .bm7-kicker{flex-wrap:wrap;row-gap:5px;column-gap:8px;align-items:center;}
.bm7-ghero .bm7-kicker > span,.bm7-gs .bm7-kicker > span{white-space:nowrap;}
.bm7-glive-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;
  color:var(--bm7-ok);background:color-mix(in srgb,var(--bm7-ok) 14%,transparent);border:1px solid color-mix(in srgb,var(--bm7-ok) 28%,transparent);white-space:nowrap;}
.bm7-glive-dot{width:7px;height:7px;border-radius:50%;background:var(--bm7-ok);flex-shrink:0;}
.bm7-root[data-bm7-motion="on"] .bm7-glive-dot{animation:bm7-live-pulse 1.8s ease-in-out infinite;}
@keyframes bm7-live-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.82);}}
.bm7-gcard-status.is-live{background:color-mix(in srgb,var(--bm7-ok) 92%,#000 0%);color:#fff;gap:5px;}
.bm7-gcard-status.is-live .bm7-glive-dot{width:6px;height:6px;background:#fff;}
.bm7-gs-live-banner{display:flex;align-items:center;gap:8px;margin:0 18px;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.45;
  color:var(--bm7-ok);background:color-mix(in srgb,var(--bm7-ok) 10%,transparent);border:1px solid color-mix(in srgb,var(--bm7-ok) 24%,transparent);}
.bm7-btn.is-tracker-on{border-color:color-mix(in srgb,var(--bm7-ok) 45%,var(--bm7-line)) !important;}
.bm7-tracker-status{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--bm7-ink) 4%,transparent);border:1px solid var(--bm7-line);font-size:12px;line-height:1.5;color:var(--bm7-ink-2);}
.bm7-tracker-status-head{display:flex;align-items:center;gap:7px;font-weight:700;color:var(--bm7-ink);}
.bm7-tracker-dot{width:8px;height:8px;border-radius:50%;background:var(--bm7-ink-3);flex-shrink:0;}
.bm7-tracker-dot.is-on{background:var(--bm7-ok);}
.bm7-tracker-status-sub{color:var(--bm7-ink-3);font-size:12px;overflow-wrap:anywhere;}
.bm7-tracker-live-list{display:flex;flex-direction:column;gap:3px;margin-top:2px;padding-top:6px;border-top:1px dashed var(--bm7-line);color:var(--bm7-ok);font-weight:600;}
@media (prefers-reduced-motion: reduce){ .bm7-glive-dot{animation:none !important;} }
.bm7-gs-add{padding-top:16px;border-top:1px dashed var(--bm7-line);margin:0 18px;padding-left:0;padding-right:0;}
.bm7-gs-form{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,.6fr) minmax(0,.6fr);gap:10px;align-items:end;}
.bm7-gs-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--bm7-ink-2);min-width:0;}
.bm7-gs-field .bm7-input{width:100%;box-sizing:border-box;height:36px;}
.bm7-gs-field.is-wide{grid-column:1 / -1;}
.bm7-gs-form > .bm7-btn{grid-column:1 / -1;height:38px;}
.bm7-gs-form-msg{font-size:12px;color:var(--bm7-live);}
@media (max-width: 520px){
  .bm7-gs-head{padding:20px 14px 16px;}
  .bm7-gs-overview,.bm7-gs-sec{padding:0 14px;}
  .bm7-gs-add{margin:0 14px;}
  .bm7-gs-cover .bm7-gcover{width:84px;}
  .bm7-gs-title{font-size:18px;}
  .bm7-gs-bars{gap:2px;height:136px;}
  .bm7-gs-bar-val{font-size:10px;height:13px;}
  .bm7-gs-bar-label{font-size:10px;opacity:1 !important;}
  .bm7-gs-bars .bm7-gs-bar:not(:nth-child(4n+1)):not(:last-child) .bm7-gs-bar-label,.bm7-gs-bars .bm7-gs-bar:nth-last-child(2) .bm7-gs-bar-label{visibility:hidden;}
  .bm7-gs-session{grid-template-columns:minmax(0,1fr) auto auto auto;row-gap:4px;}
  .bm7-gs-session-note{grid-column:1 / -1;}
  .bm7-gs-form{grid-template-columns:1fr 1fr;}
  .bm7-gs-form > .bm7-gs-field:first-child{grid-column:1 / -1;}
}
@keyframes bm7-drawer-in{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}

/* ====================== 多数据源搜索 ====================== */
.bm7-gsrc{display:flex;flex-direction:column;gap:10px;min-width:0;}
.bm7-gsrc-bar{display:flex;gap:8px;}
.bm7-gsrc-input{flex:1;height:36px;}
.bm7-gsrc-status{display:flex;flex-wrap:wrap;gap:6px;}
.bm7-gsrc-pill{font-size:12px;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ok) 12%,transparent);color:var(--bm7-ok);font-weight:600;}
.bm7-gsrc-pill.is-loading{background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);color:var(--bm7-ink-3);}
.bm7-gsrc-pill.is-timeout,.bm7-gsrc-pill.is-error{background:color-mix(in srgb,var(--bm7-gold) 14%,transparent);color:var(--bm7-gold);}
.bm7-gsrc-pill.is-empty{background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);color:var(--bm7-ink-3);}
.bm7-gsrc-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;}
.bm7-gsrc-card{display:grid;grid-template-columns:62px minmax(0,1fr);gap:12px;padding:10px;border-radius:12px;border:1px solid var(--bm7-line);background:var(--bm7-surface);}
.bm7-gsrc-cover .bm7-cover{aspect-ratio:2/3;border-radius:6px;}
.bm7-gsrc-info{display:flex;flex-direction:column;gap:4px;min-width:0;}
.bm7-gsrc-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-gsrc-sub{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-gsrc-meta{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;color:var(--bm7-ink-3);align-items:center;}
.bm7-gsrc-src{font-size:12px;font-weight:700;padding:0 6px;border-radius:5px;line-height:18px;color:#fff;background:#888;}
.bm7-gsrc-src[data-src="bangumi"]{background:#f09199;}
.bm7-gsrc-src[data-src="vndb"]{background:#3b6fb6;}
.bm7-gsrc-src[data-src="steam"]{background:#2a475e;}
.bm7-gsrc-src[data-src="ymgal"]{background:#c9862b;}
.bm7-gsrc-actions{display:flex;gap:6px;margin-top:auto;padding-top:4px;}
.bm7-gsrc-actions .bm7-btn{height:28px;padding:0 10px;font-size:12px;}
.bm7-gsrc-card{transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease;}
.bm7-gsrc-card.is-picked{border-color:var(--bm7-accent);box-shadow:0 0 0 2px var(--bm7-accent-soft),0 6px 18px -10px rgb(0 0 0 / .28);}
.bm7-gsrc-picked-tag{font-size:12px;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--bm7-accent-soft);color:var(--bm7-accent);margin-left:auto;}
.bm7-gsrc-results.is-folded{grid-template-columns:1fr;gap:0;}
.bm7-gsrc-results.is-folded .bm7-gsrc-card:not(.is-picked){display:none;}
.bm7-gsrc-stack-handle{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;width:calc(100% - 14px);margin:-2px auto 10px;padding:8px 13px !important;height:auto !important;min-height:36px !important;border-radius:0 0 11px 11px !important;border:1px solid var(--bm7-line) !important;border-top:none !important;background:color-mix(in srgb,var(--bm7-surface) 92%,var(--bm7-ink) 8%) !important;color:var(--bm7-ink-2) !important;font-size:12px !important;font-weight:600 !important;cursor:pointer;box-shadow:0 4px 0 -2px var(--bm7-surface),0 5px 0 -2px var(--bm7-line),0 9px 0 -5px color-mix(in srgb,var(--bm7-surface) 88%,var(--bm7-ink) 12%),0 10px 0 -5px var(--bm7-line) !important;transition:background .15s ease,color .15s ease,transform .15s ease;}
.bm7-gsrc-stack-handle:hover{color:var(--bm7-accent) !important;transform:translateY(1px);}
.bm7-gsrc-stack-handle-action{color:var(--bm7-accent);font-weight:700;white-space:nowrap;flex-shrink:0;}
.bm7-gsrc-collapse-bar{grid-column:1 / -1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:9px;background:var(--bm7-accent-soft);font-size:12px;color:var(--bm7-ink-2);}
.bm7-gsrc-collapse-bar .bm7-btn{height:26px;padding:0 10px;font-size:12px;}
@keyframes bm7SaveReadyPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--interactive-accent,#8f683d) 65%,transparent);transform:scale(1);}45%{box-shadow:0 0 0 9px color-mix(in srgb,var(--interactive-accent,#8f683d) 0%,transparent);transform:scale(1.02);}100%{box-shadow:0 0 0 0 transparent;transform:scale(1);}}
.is-save-ready-pulse{animation:bm7SaveReadyPulse 0.9s cubic-bezier(0.22,1,0.36,1) 2;}
`;
