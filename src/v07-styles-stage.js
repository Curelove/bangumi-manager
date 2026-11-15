/**
 * v0.8 样式 · 第 2 部分：番剧首屏（三场景焦点舞台、洛琪希批注卡、抽选、节奏、动态、直播间、片单、暗室统计画像抽屉）
 * 布局全部基于 @container，适配 Obsidian 侧边栏挤压态与手机竖屏。
 */
module.exports = String.raw`
/* ====================== 网格 ====================== */
.bm7-stage{container-type:inline-size;container-name:bm7stage;width:100%;min-width:0;overflow-x:clip;margin:0 0 18px;display:flex;flex-direction:column;gap:14px;}
.bm7-stage-grid{display:grid;gap:14px;grid-template-columns:minmax(0,1fr);
  grid-template-areas:"hero" "roxy" "pick" "side" "rhythm" "lists";}
.bm7-area-hero{grid-area:hero;min-width:0;padding-top:20px;}
.bm7-area-roxy{grid-area:roxy;min-width:0;}
.bm7-area-roxy:empty{display:none;}
.bm7-area-pick{grid-area:pick;min-width:0;}
.bm7-area-rhythm{grid-area:rhythm;min-width:0;}
.bm7-area-side{grid-area:side;display:flex;flex-direction:column;gap:14px;min-width:0;position:relative;}
.bm7-area-lists{grid-area:lists;min-width:0;}
@container bm7stage (min-width: 720px){
  .bm7-stage-grid{grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);
    grid-template-areas:"hero hero" "roxy roxy" "pick side" "rhythm side" "lists lists";}
}
@container bm7stage (min-width: 1080px){
  .bm7-stage-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) minmax(304px,.92fr);
    grid-template-areas:"hero hero side" "roxy roxy side" "pick rhythm side" "lists lists side";gap:16px;}
  .bm7-area-side .bm7-panel-feed{flex:1 1 0;min-height:340px;}
  .bm7-area-side .bm7-panel-feed .bm7-panel-body{position:relative;flex:1 1 0;min-height:0;padding:0;}
  .bm7-area-side .bm7-panel-feed .bm7-feed-scroll{position:absolute;inset:12px 10px 12px 16px;overflow:auto;padding-right:6px;scrollbar-width:thin;}
}
@container bm7stage (min-width: 720px) and (max-width: 1079px){
  .bm7-area-side .bm7-panel-feed .bm7-feed-scroll{max-height:460px;overflow:auto;}
}
@container bm7stage (max-width: 719px){
  .bm7-area-side .bm7-panel-feed .bm7-feed-scroll{max-height:500px;overflow:auto;}
}

/* ====================== 面板 ====================== */
.bm7-panel{container-type:inline-size;container-name:bm7panel;display:flex;flex-direction:column;min-width:0;border-radius:var(--bm7-radius);border:1px solid var(--bm7-line);background:var(--bm7-panel-bg);
  box-shadow:var(--bm7-shadow);-webkit-backdrop-filter:blur(var(--bm7-blur)) saturate(1.2);backdrop-filter:blur(var(--bm7-blur)) saturate(1.2);position:relative;z-index:1;}
.bm7-panel-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 0;min-width:0;flex-wrap:wrap;}
.bm7-panel-titles{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap;}
.bm7-panel-title{margin:0;font-size:14.5px;font-weight:750;letter-spacing:.01em;color:var(--bm7-ink);white-space:nowrap;}
.bm7-panel-sub{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.bm7-panel-body{position:relative;z-index:2;padding:12px 16px 16px;min-width:0;display:flex;flex-direction:column;}
.bm7-section-title{margin:0;font-size:17px;font-weight:780;letter-spacing:.01em;}
.bm7-section-sub{font-size:12px;color:var(--bm7-ink-3);}

/* ====================== 焦点舞台（继续看 · 刚下载 · 当季番） ====================== */
.bm7-hero{--bm7-hero-r:20px;position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;min-height:286px;border-radius:var(--bm7-hero-r);
  border:1px solid var(--bm7-line);background:var(--bm7-surface-2);box-shadow:var(--bm7-shadow);isolation:isolate;}
.bm7-hero-backdrop{position:absolute;inset:0;z-index:-2;border-radius:var(--bm7-hero-r);background-size:122% 122%;background-position:center 28%;filter:blur(40px) saturate(1.4);opacity:.6;
  clip-path:inset(0 round var(--bm7-hero-r));transform:translateZ(0);}
.theme-dark .bm7-hero-backdrop,.bm7-root[data-bm7-theme="cinema"] .bm7-hero-backdrop{opacity:.42;}
.bm7-hero-shade{position:absolute;inset:0;z-index:-1;border-radius:var(--bm7-hero-r);
  background:
    radial-gradient(90% 120% at 0% 100%,color-mix(in srgb,var(--bm7-ambient) 22%,transparent) 0,transparent 60%),
    linear-gradient(100deg,color-mix(in srgb,var(--bm7-surface) 82%,transparent) 0%,color-mix(in srgb,var(--bm7-surface) 56%,transparent) 50%,color-mix(in srgb,var(--bm7-surface) 30%,transparent) 100%);}
.bm7-hero.is-entering .bm7-hero-main{animation:bm7-hero-in .46s cubic-bezier(.2,.8,.2,1);}
.bm7-hero.is-entering .bm7-hero-backdrop{animation:bm7-fade-in .65s ease;}
.bm7-hero-main{position:relative;z-index:3;display:grid;grid-template-columns:auto minmax(0,1fr);gap:26px;padding:0 24px 22px 24px;min-width:0;align-items:start;}
.bm7-hero-plate{position:relative;z-index:4;width:clamp(132px,16cqw,202px);margin-top:-20px;padding:5px;border-radius:9px;background:var(--bm7-surface);cursor:pointer;
  box-shadow:0 1px 0 rgb(255 255 255 / .4) inset,0 3px 6px rgb(0 0 0 / .1),0 26px 44px -18px rgb(0 0 0 / .55);transform:rotate(-1.1deg);transition:transform .35s cubic-bezier(.2,.8,.2,1);}
.bm7-hero-plate:hover{transform:rotate(0) translateY(-3px);}
.bm7-hero-plate .bm7-cover{aspect-ratio:2/3;border-radius:5px;}
.bm7-hero-score{position:absolute;right:-8px;bottom:16px;min-width:38px;height:24px;padding:0 7px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:12.5px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;background:#d98a2b;box-shadow:0 4px 10px -4px rgb(0 0 0 / .45);}
.bm7-hero-myscore{position:absolute;left:-6px;top:12px;height:22px;padding:0 7px;border-radius:7px;display:inline-flex;align-items:center;gap:3px;
  font-size:12px;font-weight:750;font-variant-numeric:tabular-nums;color:#fff;background:var(--bm7-accent);box-shadow:0 4px 10px -4px rgb(0 0 0 / .4);}
.bm7-hero-info{display:flex;flex-direction:column;gap:10px;min-width:0;padding-top:18px;}
.bm7-hero-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;min-width:0;}
.bm7-hero-tabs{background:color-mix(in srgb,var(--bm7-surface) 58%,color-mix(in srgb,var(--bm7-ink) 8%,transparent)) !important;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
.bm7-kicker{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--bm7-accent);letter-spacing:.04em;}
.bm7-kicker-dim{font-size:12px;font-weight:500;color:var(--bm7-ink-2);letter-spacing:0;}
.bm7-hero-title{margin:0;font-size:clamp(20px,2.4cqw,31px);line-height:1.24;font-weight:820;letter-spacing:.005em;color:var(--bm7-ink);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}
.bm7-hero-sub{margin:-4px 0 0;font-size:12.5px;color:var(--bm7-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-hero-progress{display:flex;flex-direction:column;gap:8px;margin-top:2px;}
.bm7-hero-progress-text{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 6px;font-size:12.5px;color:var(--bm7-ink-2);}
.bm7-hero-ep{font-size:22px;font-weight:800;color:var(--bm7-ink);line-height:1;}
.bm7-hero-local{display:inline-flex;align-items:center;gap:4px;margin-left:6px;color:var(--bm7-ok);font-size:12px;font-weight:650;}
.bm7-ep-strip{display:flex;flex-wrap:wrap;gap:4px;max-width:540px;}
.bm7-ep{position:relative;min-width:25px;height:23px;padding:0 4px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--bm7-ink-2);border:1px solid color-mix(in srgb,var(--bm7-line) 90%,transparent);
  background:color-mix(in srgb,var(--bm7-surface) 55%,transparent);}
.bm7-ep.is-watched{background:color-mix(in srgb,var(--bm7-accent) 17%,transparent);border-color:transparent;color:color-mix(in srgb,var(--bm7-accent) 82%,var(--bm7-ink));}
.bm7-ep.is-next{border-color:transparent;color:var(--bm7-accent-ink);background:var(--bm7-accent);font-weight:800;box-shadow:0 4px 10px -4px color-mix(in srgb,var(--bm7-accent) 70%,transparent);}
.bm7-root[data-bm7-motion="on"] .bm7-ep.is-next{animation:bm7-next 2.6s ease-in-out infinite;}
.bm7-ep.is-local::after{content:"";position:absolute;bottom:2px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--bm7-ok);}
.bm7-ep.is-more{border-style:dashed;}
.bm7-ep-bar{position:relative;height:8px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 10%,transparent);overflow:hidden;max-width:540px;}
.bm7-ep-bar-fill,.bm7-ep-bar-local{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;}
.bm7-ep-bar-fill{background:var(--bm7-accent);}
.bm7-ep-bar-local{background:color-mix(in srgb,var(--bm7-ok) 45%,transparent);}
.bm7-ep-bar-tick{position:absolute;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--bm7-surface) 70%,transparent);}

/* 焦点区动作条：最多 2 个直露文字按钮 + 单色细线图标工具簇 */
.bm7-hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px;}
.bm7-hero-actions .bm7-btn{height:36px;}
.bm7-hero-actions .bm7-btn:not(.is-primary){background:color-mix(in srgb,var(--bm7-surface) 72%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
.bm7-hero-tools{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}
.bm7-hero-tools .bm7-btn.is-icon{width:36px;height:36px;}
.bm7-hero-tools .bm7-btn.is-icon.is-active{border-color:var(--bm7-accent);color:var(--bm7-accent);background:var(--bm7-accent-soft);}

/* 舞台内嵌轻量「随手记一句」展开条 */
.bm7-hero-quip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:12px;
  background:color-mix(in srgb,var(--bm7-surface) 82%,transparent);border:1px solid var(--bm7-line);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);max-width:580px;animation:bm7-hero-in .2s ease;}
.bm7-hero-quip-ep{font-size:12px;font-weight:700;color:var(--bm7-accent);padding:0 6px;white-space:nowrap;}
.bm7-hero-quip .bm7-input{flex:1 1 200px;height:32px;background:var(--bm7-surface);}

/* 轻量打分浮层 */
.bm7-rate-box{display:flex;flex-direction:column;gap:10px;padding:4px 2px;}
.bm7-rate-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.bm7-rate-val{font-size:18px;font-weight:800;color:var(--bm7-gold);font-variant-numeric:tabular-nums;}
.bm7-rate-stars{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;}
.bm7-root .bm7-rate-chip{height:30px;padding:0 6px;border-radius:8px;border:1px solid var(--bm7-line);background:var(--bm7-surface);
  color:var(--bm7-ink);font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:none;display:inline-flex;align-items:center;justify-content:center;}
.bm7-root .bm7-rate-chip:hover{border-color:var(--bm7-gold);color:var(--bm7-gold);}
.bm7-root .bm7-rate-chip.is-active{background:var(--bm7-gold);border-color:var(--bm7-gold);color:#fff;}

.bm7-hero-foot{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--bm7-ink-2);min-width:0;}
.bm7-hero-foot > span{display:inline-flex;align-items:center;gap:5px;min-width:0;}
.bm7-hero-quote{font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.bm7-hero-rail{position:relative;z-index:3;display:flex;flex-direction:column;gap:8px;padding:16px 14px 16px 4px;height:0;min-height:100%;box-sizing:border-box;overflow-y:auto;scrollbar-width:none;}
.bm7-hero-rail::-webkit-scrollbar{display:none;}
.bm7-rail-item{position:relative;width:46px;flex-shrink:0;padding:0;border:none !important;background:none !important;border-radius:7px;cursor:pointer;box-shadow:none !important;height:auto !important;opacity:.68;
  transition:opacity .2s ease,transform .2s ease;}
.bm7-rail-item .bm7-cover{aspect-ratio:2/3;border-radius:7px;box-shadow:0 4px 10px -6px rgb(0 0 0 / .5);}
.bm7-rail-item:hover{opacity:1;transform:translateX(-2px);}
.bm7-rail-item.is-active{opacity:1;}
.bm7-rail-item.is-active .bm7-cover{outline:2px solid var(--bm7-accent);outline-offset:2px;}
.bm7-rail-prog{position:absolute;left:4px;right:4px;bottom:4px;height:3px;border-radius:2px;background:rgb(0 0 0 / .35);overflow:hidden;}
.bm7-rail-prog span{display:block;height:100%;background:#fff;}
.bm7-rail-more{width:46px;height:32px;border-radius:7px;border:1px dashed var(--bm7-line) !important;background:transparent !important;color:var(--bm7-ink-2);font-size:12px;cursor:pointer;box-shadow:none !important;flex-shrink:0;}
.bm7-hero.is-empty{display:block;min-height:210px;}
.bm7-hero-empty{display:flex;flex-direction:column;gap:12px;align-items:flex-start;padding:26px 26px;}

@container bm7stage (max-width: 719px){
  .bm7-hero{grid-template-columns:minmax(0,1fr);}
  .bm7-hero-main{grid-template-columns:auto minmax(0,1fr);gap:16px;padding:0 16px 14px;}
  .bm7-hero-plate{width:clamp(96px,28cqw,138px);margin-top:-16px;}
  .bm7-hero-info{padding-top:14px;gap:8px;}
  .bm7-hero-rail{flex-direction:row;padding:0 16px 16px;overflow-x:auto;overflow-y:hidden;height:auto;min-height:0;}
  .bm7-rail-item{width:44px;}
  .bm7-rail-item:hover{transform:translateY(-2px);}
  .bm7-ep-strip{gap:3px;}
  .bm7-ep{min-width:23px;height:22px;font-size:12px;}
}
@container bm7stage (max-width: 480px){
  .bm7-hero-main{grid-template-columns:minmax(0,1fr);gap:12px;}
  .bm7-hero-plate{position:relative;top:auto;right:auto;width:108px;margin-top:-14px;}
  .bm7-hero-info{padding-top:2px;padding-right:0;}
  .bm7-hero-actions{display:flex;flex-wrap:wrap;}
  .bm7-hero-actions > .bm7-btn.is-primary{flex:1 1 100%;}
  .bm7-hero-actions > .bm7-btn:not(.is-icon):not(.is-primary){flex:1 1 auto;}
}

/* ====================== 洛琪希手记 · 巫师帽与羽毛笔手写批注卡 ====================== */
.bm7-rxnote-card{position:relative;display:grid;grid-template-columns:148px minmax(0,1fr);align-items:center;gap:16px;padding:12px 18px 12px 14px;
  border-radius:var(--bm7-radius);border:1px solid var(--bm7-line);background:color-mix(in srgb,var(--bm7-panel-bg) 92%,#eadbc2 8%);
  box-shadow:var(--bm7-shadow);overflow:hidden;min-width:0;}
.theme-dark .bm7-rxnote-card{background:color-mix(in srgb,var(--bm7-panel-bg) 92%,#2b3556 8%);}
.bm7-rxnote-wm{position:absolute;left:16px;top:50%;width:240px;height:auto;transform:translateY(-50%);color:var(--bm7-accent);pointer-events:none;}
.bm7-rxnote-illus{position:relative;z-index:1;width:148px;flex-shrink:0;}
.bm7-rxnote-art{display:block;width:100%;height:auto;}
.bm7-root[data-bm7-motion="on"] .bm7-rxnote-steam{animation:bm7-breathe 3.6s ease-in-out infinite;}
.bm7-rxnote-body{position:relative;z-index:1;display:flex;flex-direction:column;gap:6px;min-width:0;}
.bm7-rxnote-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;}
.bm7-rxnote-kicker{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:750;color:var(--bm7-accent);}
.bm7-rxnote-actions{display:inline-flex;align-items:center;gap:4px;}
.bm7-rxnote-btn{height:28px !important;padding:0 10px !important;font-size:12px !important;}
.bm7-rxnote-close{width:28px !important;height:28px !important;}
.bm7-rxnote-quote{margin:0;padding:8px 12px;border-left:2.5px solid color-mix(in srgb,var(--bm7-accent) 62%,transparent);
  border-radius:0 10px 10px 0;background:color-mix(in srgb,var(--bm7-surface) 74%,transparent);
  font-size:13px;line-height:1.58;color:var(--bm7-ink);overflow-wrap:anywhere;}
.bm7-root .bm7-rxnote-pill{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;
  border:1px dashed color-mix(in srgb,var(--bm7-accent) 42%,var(--bm7-line));background:var(--bm7-panel-bg);
  color:var(--bm7-accent);font-size:12px;font-weight:650;cursor:pointer;box-shadow:none;}
.bm7-root .bm7-rxnote-pill:hover{border-style:solid;background:var(--bm7-accent-soft);}
@container bm7stage (max-width: 560px){
  .bm7-rxnote-card{grid-template-columns:minmax(0,1fr);padding:12px 14px;}
  .bm7-rxnote-illus{width:124px;margin:0 auto -4px;}
}

/* ====================== 随机抽选 ====================== */
.bm7-pick{display:flex;flex-direction:column;gap:14px;position:relative;flex:1;min-width:0;}
.bm7-area-pick .bm7-panel-body{flex:1;display:flex;flex-direction:column;}
.bm7-pick-scopes{min-width:0;}
.bm7-pick-stage{display:grid;grid-template-columns:118px minmax(0,1fr);gap:20px;align-items:center;min-height:168px;flex:0 0 auto;padding:8px 0 4px;}
.bm7-pick-deck{position:relative;width:104px;aspect-ratio:2/3;margin-left:10px;}
.bm7-pick-card{position:absolute;inset:0;border-radius:9px;overflow:hidden;background:var(--bm7-surface);border:1px solid var(--bm7-line);
  box-shadow:0 10px 22px -12px rgb(0 0 0 / .5);transition:transform .45s cubic-bezier(.2,.8,.2,1);}
.bm7-pick-card .bm7-cover{width:100%;height:100%;}
.bm7-pick-card.is-back2{transform:translateX(-12px) rotate(-9deg);filter:saturate(.6) brightness(.92);}
.bm7-pick-card.is-back1{transform:translateX(-5px) rotate(-4deg);filter:saturate(.8);}
.bm7-pick-card.is-front{transform:rotate(2.5deg);}
.bm7-pick:hover .bm7-pick-card.is-back2{transform:translateX(-18px) rotate(-12deg);}
.bm7-pick:hover .bm7-pick-card.is-back1{transform:translateX(-8px) rotate(-5.5deg);}
.bm7-pick-blank{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--bm7-ink-3);
  background:repeating-linear-gradient(135deg,transparent 0 7px,color-mix(in srgb,var(--bm7-ink) 4%,transparent) 7px 8px),var(--bm7-surface-2);}
.bm7-pick-card.is-flip{animation:bm7-flip .14s ease-out;}
.bm7-pick-card.is-land{animation:bm7-land .6s cubic-bezier(.2,1.5,.4,1);}
.bm7-pick-halo{position:absolute;inset:-26px;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--bm7-ambient) 55%,transparent),transparent);
  opacity:0;transition:opacity .6s ease;filter:blur(6px);}
.bm7-pick.has-result .bm7-pick-halo{opacity:.75;}
.bm7-pick.is-drawing .bm7-pick-card.is-back1,.bm7-pick.is-drawing .bm7-pick-card.is-back2{transform:translateX(0) rotate(0);}
.bm7-pick-info{min-width:0;}
.bm7-pick-lead{margin:0 0 4px;font-size:13px;color:var(--bm7-ink-2);}
.bm7-pick-count{margin:0 0 12px;font-size:12px;color:var(--bm7-ink-3);}
.bm7-pick-count .bm7-num{font-size:20px;font-weight:800;color:var(--bm7-ink);margin-right:2px;}
.bm7-pick-go{height:36px !important;padding:0 18px !important;}
.bm7-pick-rolling{font-size:12.5px;color:var(--bm7-ink-3);letter-spacing:.1em;}
.bm7-pick-result{display:flex;flex-direction:column;gap:6px;animation:bm7-hero-in .45s cubic-bezier(.2,.8,.2,1);min-width:0;}
.bm7-pick-kicker{font-size:12px;font-weight:700;color:var(--bm7-accent);}
.bm7-pick-title{margin:0;font-size:17px;font-weight:800;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-pick-reason{margin:0;font-size:12px;line-height:1.55;color:var(--bm7-ink-2);}
.bm7-pick-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
@container bm7stage (max-width: 460px){
  .bm7-pick-stage{grid-template-columns:92px minmax(0,1fr);gap:14px;}
  .bm7-pick-deck{width:82px;}
  .bm7-pick-actions .bm7-btn{height:36px;}
}
@container bm7panel (max-width: 340px){
  .bm7-pick-stage{grid-template-columns:84px minmax(0,1fr);gap:12px;}
  .bm7-pick-deck{width:76px;}
  .bm7-pick-title{font-size:15px;}
}
@container bm7panel (max-width: 256px){
  .bm7-pick-stage{grid-template-columns:minmax(0,1fr);justify-items:start;gap:12px;}
}

/* ====================== 节奏 ====================== */
.bm7-rhythm{display:flex;flex-direction:column;gap:16px;min-width:0;}
.bm7-rhythm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.bm7-stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--bm7-ink) 4.2%,transparent);}
.bm7-stat.is-clickable{cursor:pointer;transition:background .15s ease,transform .15s ease;}
.bm7-stat.is-clickable:hover{background:var(--bm7-accent-soft);transform:translateY(-1px);}
.bm7-stat-label{font-size:12px;color:var(--bm7-ink-2);}
.bm7-stat-value{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--bm7-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-stat-hint{font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-heat{--cell:11px;--gap:3px;display:flex;flex-direction:column;gap:6px;min-width:0;}
.bm7-heat-body{display:flex;align-items:flex-start;gap:8px;min-width:0;}
.bm7-heat-days{display:grid;grid-template-rows:16px repeat(7,var(--cell));gap:var(--gap);font-size:12px;color:var(--bm7-ink-3);line-height:var(--cell);padding-top:2px;flex-shrink:0;}
.bm7-heat-scroll{display:flex;flex-direction:row-reverse;overflow-x:auto;overflow-y:visible;min-width:0;max-width:100%;flex:0 1 auto;padding:2px 3px;scrollbar-width:none;}
.bm7-heat-scroll::-webkit-scrollbar{display:none;}
.bm7-heat-inner{display:flex;flex-direction:column;gap:var(--gap);flex-shrink:0;}
.bm7-heat-months{display:grid;grid-auto-flow:column;grid-auto-columns:var(--cell);gap:var(--gap);height:16px;font-size:12px;color:var(--bm7-ink-3);white-space:nowrap;}
.bm7-heat-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,var(--cell));grid-auto-columns:var(--cell);gap:var(--gap);}
.bm7-heat-cell{display:inline-block;width:var(--cell);height:var(--cell);border-radius:3px;background:color-mix(in srgb,var(--bm7-ink) 7%,transparent);}
.bm7-heat-cell[data-lv="1"]{background:color-mix(in srgb,var(--bm7-accent) 26%,transparent);}
.bm7-heat-cell[data-lv="2"]{background:color-mix(in srgb,var(--bm7-accent) 48%,transparent);}
.bm7-heat-cell[data-lv="3"]{background:color-mix(in srgb,var(--bm7-accent) 72%,transparent);}
.bm7-heat-cell[data-lv="4"]{background:var(--bm7-accent);}
.bm7-heat-cell.is-today{outline:1.5px solid var(--bm7-ink-2);outline-offset:1px;}
.bm7-heat-cell.is-future{background:transparent;}
.bm7-heat-legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;font-size:12px;color:var(--bm7-ink-3);}
.bm7-heat-legend span:first-child{margin-right:3px;}
.bm7-heat-legend span:last-child{margin-left:3px;}
.bm7-heat-legend .bm7-heat-cell{width:9px;height:9px;border-radius:2px;}
.bm7-dist{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.4fr);gap:18px;align-items:end;}
.bm7-dist-label{font-size:12px;color:var(--bm7-ink-2);margin-bottom:6px;}
.bm7-dist-bars{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;height:66px;}
.bm7-dist-bar{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;min-width:0;height:100%;}
.bm7-dist-fill{width:100%;max-width:18px;border-radius:4px 4px 2px 2px;background:color-mix(in srgb,var(--bm7-accent) 38%,transparent);}
.bm7-dist-fill.is-max{background:var(--bm7-accent);}
.bm7-dist-tick{font-size:12px;color:var(--bm7-ink-3);line-height:1;}
.bm7-dist-hours{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;height:22px;}
.bm7-dist-hour{border-radius:3px;background:color-mix(in srgb,var(--bm7-accent) calc(8% + var(--a) * 92%),color-mix(in srgb,var(--bm7-ink) 5%,transparent));}
.bm7-dist-hour-ticks{display:flex;justify-content:space-between;font-size:12px;color:var(--bm7-ink-3);margin-top:5px;}
@container bm7stage (max-width: 1079px){
  .bm7-rhythm-stats{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@container bm7stage (max-width: 460px){
  .bm7-dist{grid-template-columns:minmax(0,1fr);}
  .bm7-heat{--cell:10px;--gap:2.5px;}
}

/* ====================== 动态时间线 ====================== */
.bm7-feed{display:flex;flex-direction:column;gap:10px;min-width:0;}
.bm7-feed-filter{min-width:0;}
.bm7-feed-list{display:flex;flex-direction:column;gap:12px;position:relative;}
.bm7-feed-day{display:flex;flex-direction:column;gap:2px;position:relative;}
.bm7-feed-day::before{content:"";position:absolute;left:10.5px;top:24px;bottom:6px;width:1px;background:var(--bm7-line);}
.bm7-feed-date{font-size:12px;font-weight:700;color:var(--bm7-ink-2);padding:2px 0 4px;position:sticky;top:0;z-index:2;background:var(--bm7-panel-bg);}
.bm7-root[data-bm7-theme="glow"] .bm7-feed-date{background:transparent;}
.bm7-root .bm7-feed-item{display:grid;grid-template-columns:22px 30px minmax(0,1fr);gap:10px;align-items:start;width:100%;padding:6px 6px 6px 0;border:none !important;border-radius:10px;
  background:transparent !important;text-align:left;cursor:pointer;box-shadow:none !important;height:auto !important;color:inherit;position:relative;white-space:normal !important;}
.bm7-root .bm7-feed-item:hover{background:color-mix(in srgb,var(--bm7-ink) 4.5%,transparent) !important;}
.bm7-feed-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-top:5px;position:relative;z-index:1;
  color:var(--bm7-accent);background:var(--bm7-panel-bg);box-shadow:0 0 0 1px var(--bm7-line);}
.bm7-feed-item[data-tone="ok"] .bm7-feed-dot{color:var(--bm7-ok);}
.bm7-feed-item[data-tone="gold"] .bm7-feed-dot{color:var(--bm7-gold);}
.bm7-feed-item[data-tone="ink"] .bm7-feed-dot{color:var(--bm7-ink-2);}
.bm7-feed-item[data-tone="muted"] .bm7-feed-dot{color:var(--bm7-ink-3);}
.bm7-feed-cover{width:30px;aspect-ratio:2/3;border-radius:5px;}
.bm7-feed-text{display:flex;flex-direction:column;gap:3px;min-width:0;padding-top:2px;}
.bm7-feed-line{font-size:12.5px;line-height:1.5;color:var(--bm7-ink-2);word-break:break-word;}
.bm7-feed-title{color:var(--bm7-ink);font-weight:650;}
.bm7-feed-quote{font-size:12px;line-height:1.5;color:var(--bm7-ink-2);padding:4px 9px;border-left:2px solid color-mix(in srgb,var(--bm7-accent) 50%,transparent);
  background:color-mix(in srgb,var(--bm7-ink) 3.5%,transparent);border-radius:0 6px 6px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-feed-meta{display:flex;gap:8px;font-size:12px;color:var(--bm7-ink-3);}
.bm7-feed-more{display:flex;justify-content:center;}

/* ====================== 关注直播间 ====================== */
.bm7-live{display:flex;flex-direction:column;gap:8px;min-width:0;}
.bm7-live-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:-4px;}
.bm7-live-count{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--bm7-ink-3);min-width:0;}
.bm7-live-pulse{width:7px;height:7px;border-radius:50%;background:var(--bm7-ink-3);flex-shrink:0;}
.bm7-live-count.has-live{color:var(--bm7-live);font-weight:650;}
.bm7-live-count.has-live .bm7-live-pulse{background:var(--bm7-live);box-shadow:0 0 0 0 color-mix(in srgb,var(--bm7-live) 60%,transparent);}
.bm7-root[data-bm7-motion="on"] .bm7-live-count.has-live .bm7-live-pulse,.bm7-root[data-bm7-motion="on"] .bm7-live-dot{animation:bm7-ping 1.8s ease-out infinite;}
.bm7-live-tools{display:inline-flex;gap:2px;flex-shrink:0;}
.bm7-live-tools .bm7-btn.is-icon{width:28px;height:28px;}
.bm7-live.is-refreshing .bm7-live-refresh .bm7-ico{animation:bm7-spin .8s linear infinite;}
.bm7-live-list{display:flex;flex-direction:column;gap:2px;}
.bm7-live-room{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:8px 6px;margin:0 -6px;border-radius:11px;cursor:pointer;
  transition:background .15s ease;}
.bm7-live-room:hover{background:color-mix(in srgb,var(--bm7-ink) 4.5%,transparent);}
.bm7-live-room:focus-visible{outline:2px solid var(--bm7-accent);outline-offset:-2px;}
.bm7-live-avatar{width:38px;height:38px;border-radius:50%;overflow:hidden;background:var(--bm7-surface-3);flex-shrink:0;}
.bm7-live-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
.bm7-live-avatar-fb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--bm7-ink-2);}
.bm7-live-room.is-live .bm7-live-avatar{box-shadow:0 0 0 2px var(--bm7-panel-bg),0 0 0 3.5px var(--bm7-live);}
.bm7-live-room.is-off .bm7-live-avatar{filter:grayscale(.55);opacity:.85;}
.bm7-live-main{display:flex;flex-direction:column;gap:2px;min-width:0;}
.bm7-live-line1{display:flex;align-items:center;gap:7px;min-width:0;}
.bm7-live-name{font-size:13px;font-weight:700;color:var(--bm7-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-live-badge{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;height:20px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:700;
  color:var(--bm7-ink-2);background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);}
.bm7-live-badge.is-live{color:var(--bm7-live);background:color-mix(in srgb,var(--bm7-live) 12%,transparent);}
.bm7-live-badge.is-round{color:var(--bm7-gold);background:color-mix(in srgb,var(--bm7-gold) 14%,transparent);}
.bm7-live-dot{width:6px;height:6px;border-radius:50%;background:var(--bm7-live);}
.bm7-live-title{font-size:12px;color:var(--bm7-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-live-room.is-off .bm7-live-title{color:var(--bm7-ink-3);}
.bm7-live-meta{display:flex;flex-wrap:wrap;gap:0 8px;font-size:12px;color:var(--bm7-ink-3);}
.bm7-live-thumb{width:68px;aspect-ratio:16/9;border-radius:7px;overflow:hidden;flex-shrink:0;box-shadow:0 4px 10px -6px rgb(0 0 0 / .5);}
.bm7-live-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.bm7-live-go{color:var(--bm7-ink-3);display:flex;}
.bm7-live-remove{color:var(--bm7-live) !important;}
.bm7-live-room.is-editing{cursor:default;}
.bm7-live-foot{display:flex;flex-direction:column;gap:6px;padding-top:4px;border-top:1px dashed var(--bm7-line);}
.bm7-live-add{display:flex;gap:6px;padding-top:6px;}
.bm7-live-add .bm7-input{flex:1;}
.bm7-live-error{font-size:12px;color:var(--bm7-live);min-height:0;}
.bm7-live-error:empty{display:none;}
.bm7-live-note{font-size:12px;color:var(--bm7-ink-3);display:flex;align-items:center;flex-wrap:wrap;padding-top:6px;}
.bm7-live-monitor-on{display:inline-flex;align-items:center;gap:4px;color:var(--bm7-ok);}
@container bm7stage (max-width: 460px){
  .bm7-live-thumb{display:none;}
  .bm7-live-room{grid-template-columns:40px minmax(0,1fr) auto;padding:10px 6px;}
}

/* ====================== 洛琪希探头（仅桌面三栏侧边栏顶置态展示，EDGE_Y=220 严丝合缝贴合上沿） ====================== */
.bm7-area-side.has-roxy{padding-top:138px;}
.bm7-roxy-peek{position:absolute;top:-10px;right:18px;width:168px;z-index:3;pointer-events:none;}
@container bm7stage (max-width: 1079px){
  .bm7-area-side.has-roxy{padding-top:0;}
  .bm7-roxy-peek{display:none;}
}

/* ====================== 片单与筛选 ====================== */
.bm7-lists{display:flex;flex-direction:column;gap:14px;padding:18px 18px 20px;border-radius:var(--bm7-radius);border:1px solid var(--bm7-line);background:var(--bm7-panel-bg);
  box-shadow:var(--bm7-shadow);-webkit-backdrop-filter:blur(var(--bm7-blur));backdrop-filter:blur(var(--bm7-blur));min-width:0;}
.bm7-lists-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;}
.bm7-lists-titles{display:flex;flex-direction:column;gap:3px;min-width:0;}
.bm7-lists-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}
.bm7-lists-notice{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;background:var(--bm7-accent-soft);border:1px solid color-mix(in srgb,var(--bm7-accent) 22%,transparent);}
.bm7-lists-notice.is-done{background:color-mix(in srgb,var(--bm7-ok) 10%,transparent);border-color:color-mix(in srgb,var(--bm7-ok) 25%,transparent);}
.bm7-notice-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--bm7-accent);background:var(--bm7-surface);}
.bm7-lists-notice.is-done .bm7-notice-icon{color:var(--bm7-ok);}
.bm7-notice-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:12px;color:var(--bm7-ink-2);line-height:1.5;}
.bm7-notice-text strong{font-size:13px;color:var(--bm7-ink);}
.bm7-pl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(262px,1fr));gap:12px;}
.bm7-pl-card{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;padding:14px 40px 14px 14px;border-radius:14px;
  border:1px solid var(--bm7-line);background:var(--bm7-surface);cursor:pointer;transition:border-color .15s ease,box-shadow .2s ease,transform .2s ease;}
.bm7-pl-card:hover{transform:translateY(-2px);box-shadow:var(--bm7-shadow-lift);}
.bm7-pl-card.is-open{border-color:var(--bm7-accent);box-shadow:0 0 0 3px var(--bm7-accent-soft);}
.bm7-pl-stack{position:relative;width:104px;height:100px;}
.bm7-pl-stack-item{position:absolute;bottom:0;left:calc(var(--i) * 15px);width:62px;z-index:calc(10 - var(--i));transform:rotate(calc(var(--i) * 4deg - 2deg));transform-origin:bottom left;
  transition:transform .3s cubic-bezier(.2,.8,.2,1);}
.bm7-pl-stack-item .bm7-cover{aspect-ratio:2/3;border-radius:6px;box-shadow:0 6px 14px -8px rgb(0 0 0 / .55);border:2px solid var(--bm7-surface);}
.bm7-pl-card:hover .bm7-pl-stack-item{transform:rotate(calc(var(--i) * 7deg - 3deg)) translateX(calc(var(--i) * 3px));}
.bm7-pl-stack-empty{width:62px;aspect-ratio:2/3;border-radius:6px;border:1.5px dashed var(--bm7-line);display:flex;align-items:center;justify-content:center;color:var(--bm7-ink-3);position:absolute;bottom:0;}
.bm7-pl-meta{display:flex;flex-direction:column;gap:3px;min-width:0;}
.bm7-pl-title{margin:0;font-size:14px;font-weight:750;line-height:1.35;color:var(--bm7-ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-pl-count{font-size:12px;color:var(--bm7-accent);font-weight:650;}
.bm7-pl-desc{margin:2px 0 0;font-size:12px;line-height:1.5;color:var(--bm7-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-pl-more{position:absolute !important;top:8px;right:6px;width:28px !important;height:28px !important;}
.bm7-pl-detail{grid-column:1 / -1;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:14px;background:color-mix(in srgb,var(--bm7-ink) 3.5%,transparent);
  animation:bm7-hero-in .35s cubic-bezier(.2,.8,.2,1);min-width:0;}
.bm7-pl-detail-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;}
.bm7-pl-tip{font-size:12px;color:var(--bm7-ink-3);}
.bm7-pl-strip{display:flex;gap:12px;overflow-x:auto;margin:0;padding:4px 2px 8px;list-style:none;scrollbar-width:thin;}
.bm7-pl-entry{position:relative;display:flex;flex-direction:column;gap:5px;width:92px;flex-shrink:0;cursor:grab;transition:transform .15s ease,opacity .15s ease;}
.bm7-pl-entry.is-dragging{opacity:.4;}
.bm7-pl-entry.is-over{transform:translateX(6px);}
.bm7-pl-entry.is-over::before{content:"";position:absolute;left:-7px;top:0;bottom:22px;width:2px;border-radius:2px;background:var(--bm7-accent);}
.bm7-pl-rank{position:absolute;top:-4px;left:-4px;z-index:2;min-width:20px;height:20px;padding:0 5px;border-radius:999px;font-size:12px;font-weight:800;line-height:20px;text-align:center;
  background:var(--bm7-ink);color:var(--bm7-surface);font-variant-numeric:tabular-nums;}
.bm7-pl-cover-btn{padding:0;border:none !important;background:none !important;cursor:pointer;box-shadow:none !important;height:auto !important;border-radius:7px;}
.bm7-pl-cover-btn .bm7-cover{aspect-ratio:2/3;border-radius:7px;box-shadow:0 6px 14px -8px rgb(0 0 0 / .5);}
.bm7-pl-entry-title{font-size:12px;line-height:1.35;color:var(--bm7-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bm7-pl-move{display:flex;justify-content:space-between;}
.bm7-pl-move .bm7-btn.is-icon{width:26px;height:24px;}
@media (hover:hover){ .bm7-pl-move{opacity:0;transition:opacity .15s ease;} .bm7-pl-entry:hover .bm7-pl-move{opacity:1;} }
.bm7-fl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
.bm7-fl-card{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:14px;border:1px solid var(--bm7-line);background:var(--bm7-surface);min-width:0;}
.bm7-fl-top{display:flex;justify-content:space-between;gap:12px;}
.bm7-fl-titles{display:flex;flex-direction:column;gap:7px;min-width:0;}
.bm7-fl-title{margin:0;font-size:14px;font-weight:750;}
.bm7-fl-count{display:flex;align-items:baseline;gap:2px;flex-shrink:0;color:var(--bm7-ink-3);font-size:12px;}
.bm7-fl-count .bm7-num{font-size:26px;font-weight:800;color:var(--bm7-ink);line-height:1;}
.bm7-fl-strip{display:flex;gap:6px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,#000 80%,transparent);mask-image:linear-gradient(90deg,#000 80%,transparent);}
.bm7-fl-cover{width:46px;flex-shrink:0;padding:0;border:none !important;background:none !important;cursor:pointer;box-shadow:none !important;height:auto !important;border-radius:6px;}
.bm7-fl-cover .bm7-cover{aspect-ratio:2/3;border-radius:6px;}
.bm7-fl-cover:hover{transform:translateY(-2px);}
.bm7-fl-none{font-size:12px;color:var(--bm7-ink-3);padding:14px 0;}
.bm7-fl-actions{display:flex;align-items:center;gap:2px;margin:-4px -6px -6px;}
@container bm7stage (max-width: 460px){
  .bm7-lists{padding:14px;}
  .bm7-pl-grid,.bm7-fl-grid{grid-template-columns:minmax(0,1fr);}
  .bm7-lists-notice{flex-wrap:wrap;}
  .bm7-lists-notice .bm7-btn{width:100%;}
}

/* ====================== 暗室惊喜式统计画像抽屉 (.bm7-ins) ====================== */
.bm7-ins{display:flex;flex-direction:column;gap:18px;padding:20px 20px calc(24px + env(safe-area-inset-bottom));min-width:0;}
.bm7-ins-head{display:flex;flex-direction:column;gap:12px;padding-right:34px;min-width:0;}
.bm7-ins-title{margin:0;font-size:19px;font-weight:820;color:var(--bm7-ink);}
.bm7-ins-sub{margin:-6px 0 0;font-size:12.5px;color:var(--bm7-ink-2);line-height:1.45;}
.bm7-ins-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.bm7-ins-sec{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:1px solid var(--bm7-line);min-width:0;}
.bm7-ins-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;}
.bm7-ins-sec-title{margin:0;font-size:14px;font-weight:750;color:var(--bm7-ink);}
.bm7-ins-sec-hint{font-size:12px;color:var(--bm7-ink-3);}
.bm7-ins-state-bar{display:flex;height:12px;border-radius:999px;overflow:hidden;gap:2px;background:color-mix(in srgb,var(--bm7-ink) 8%,transparent);padding:1px;}
.bm7-ins-state-seg{height:100%;border-radius:3px;min-width:6px;padding:0;border:none !important;box-shadow:none !important;}
.bm7-ins-state-seg.is-interactive{cursor:pointer;transition:transform .15s ease,filter .15s ease;}
.bm7-ins-state-seg.is-interactive:hover{filter:brightness(1.1);transform:scaleY(1.18);}
.bm7-ins-state-seg.is-selected{outline:2px solid var(--bm7-ink);outline-offset:1px;}
.bm7-ins-state-pills{display:flex;flex-wrap:wrap;gap:6px;}
.bm7-root .bm7-ins-pill{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:999px;
  border:1px solid var(--bm7-line);background:var(--bm7-surface);color:var(--bm7-ink);font-size:12px;font-weight:600;cursor:pointer;box-shadow:none;}
.bm7-root .bm7-ins-pill:hover,.bm7-root .bm7-ins-pill.is-selected{border-color:var(--bm7-accent);color:var(--bm7-accent);background:var(--bm7-accent-soft);}
.bm7-ins-pill-count{font-weight:750;color:var(--bm7-accent);font-variant-numeric:tabular-nums;}
.bm7-ins-bars{display:flex;flex-direction:column;gap:6px;}
.bm7-root .bm7-ins-row{display:grid;grid-template-columns:minmax(78px,132px) minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;
  padding:6px 8px;border:none !important;border-radius:9px;background:transparent !important;color:var(--bm7-ink);cursor:pointer;box-shadow:none !important;text-align:left;height:auto !important;}
.bm7-root .bm7-ins-row:hover{background:var(--bm7-surface-3) !important;}
.bm7-ins-row-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-ins-row-track{height:8px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 8%,transparent);overflow:hidden;}
.bm7-ins-row-fill{display:block;height:100%;border-radius:inherit;background:var(--bm7-accent);}
.bm7-ins-row-val{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:var(--bm7-ink-2);font-variant-numeric:tabular-nums;white-space:nowrap;}
.bm7-ins-tags{display:flex;flex-wrap:wrap;gap:7px;}
@media (max-width: 440px){
  .bm7-ins{padding:16px 14px calc(20px + env(safe-area-inset-bottom));}
  .bm7-ins-kpis{grid-template-columns:minmax(0,1fr);}
  .bm7-root .bm7-ins-row{grid-template-columns:minmax(68px,104px) minmax(0,1fr) auto;gap:7px;}
}

/* 可点击节奏图格子/柱条与原地展开托盘 */
.bm7-heat-cell.is-interactive{cursor:pointer;transition:transform .14s ease,box-shadow .14s ease;}
.bm7-heat-cell.is-interactive:hover{transform:scale(1.25);z-index:2;}
.bm7-heat-cell.is-selected{outline:2px solid var(--bm7-accent);outline-offset:1px;z-index:2;}
.bm7-root button.bm7-dist-bar.is-interactive{padding:2px 0 !important;border:none !important;background:transparent !important;box-shadow:none !important;cursor:pointer;border-radius:6px;}
.bm7-root button.bm7-dist-bar.is-interactive:hover .bm7-dist-fill,.bm7-root button.bm7-dist-bar.is-selected .bm7-dist-fill{background:var(--bm7-accent);transform:scaleY(1.06);transform-origin:bottom;}
.bm7-root button.bm7-dist-bar.is-selected .bm7-dist-tick{color:var(--bm7-accent);font-weight:750;}
.bm7-root button.bm7-dist-hour.is-interactive{padding:0 !important;border:none !important;height:100% !important;min-height:0 !important;box-shadow:none !important;cursor:pointer;}
.bm7-root button.bm7-dist-hour.is-interactive:hover,.bm7-root button.bm7-dist-hour.is-selected{outline:1.5px solid var(--bm7-accent);outline-offset:1px;z-index:1;}
.bm8-inline-FocusTray{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:11px;background:color-mix(in srgb,var(--bm7-accent) 7%,var(--bm7-surface));
  border:1px solid color-mix(in srgb,var(--bm7-accent) 24%,var(--bm7-line));animation:bm7-hero-in .22s cubic-bezier(.2,.8,.2,1);min-width:0;}
.bm8-inline-tray-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.bm8-inline-tray-title{font-size:12px;font-weight:750;color:var(--bm7-ink);}
.bm8-inline-tray-close{display:inline-flex;align-items:center;justify-content:center;width:22px !important;height:22px !important;min-height:22px !important;padding:0 !important;
  border-radius:6px;border:none !important;background:transparent !important;color:var(--bm7-ink-3);cursor:pointer;box-shadow:none !important;}
.bm8-inline-tray-close:hover{background:color-mix(in srgb,var(--bm7-ink) 8%,transparent) !important;color:var(--bm7-ink);}
.bm8-inline-tray-chips{display:flex;flex-wrap:wrap;gap:6px;}
.bm7-root .bm8-inline-work-chip{display:inline-flex;align-items:center;height:26px !important;min-height:26px !important;padding:0 9px !important;border-radius:999px;
  border:1px solid var(--bm7-line) !important;background:var(--bm7-surface) !important;color:var(--bm7-ink);font-size:12px;font-weight:600;cursor:pointer;box-shadow:none !important;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bm7-root button.bm8-inline-work-chip:hover{border-color:var(--bm7-accent) !important;color:var(--bm7-accent);}
.bm8-inline-tray-empty{font-size:12px;color:var(--bm7-ink-3);}
.bm8-inline-tray-foot{display:flex;justify-content:flex-end;padding-top:2px;}

/* 移动端：放大触控热区、收敛毛玻璃 */
.is-mobile .bm7-root{--bm7-blur:10px;}
.is-mobile .bm7-root .bm7-btn{height:38px;}
.is-mobile .bm7-root .bm7-btn.is-icon{width:38px;}
.is-mobile .bm7-root .bm7-seg-btn{height:32px;}
@media (hover:none){ .bm7-root .bm7-btn{min-height:36px;} .bm7-root .bm7-btn.is-icon{min-width:36px;} }

@keyframes bm7-hero-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes bm7-next{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bm7-accent) 0%,transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--bm7-accent) 22%,transparent)}}
@keyframes bm7-flip{from{transform:rotate(2.5deg) translateY(-7px) scale(.97);filter:brightness(1.15)}to{transform:rotate(2.5deg)}}
@keyframes bm7-land{0%{transform:rotate(2.5deg) scale(.92)}60%{transform:rotate(-1deg) scale(1.07)}100%{transform:rotate(2.5deg) scale(1)}}
@keyframes bm7-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bm7-live) 55%,transparent)}100%{box-shadow:0 0 0 7px color-mix(in srgb,var(--bm7-live) 0%,transparent)}}
@keyframes bm7-spin{to{transform:rotate(360deg)}}
`;
