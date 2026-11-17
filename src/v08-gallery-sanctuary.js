'use strict';
const { paperSlipSwap, withPreservedScroll } = require('./v08-motion-and-lens.js');
/*
 * v08 画册典藏 · 三态空间化视图
 *   salon : 展厅转角（美术馆一隅 · 轨道射灯 · 装裱卡纸 · 视平线居中挂画 · 逐面展墙漫步）
 *   book  : 精装画集（案头摊开跨页 · 书口阶梯折签 · 翻页）
 *   wall  : 快速总览（无框等高流式画墙 · 行高密度 · 铭牌显隐）
 * 导出：{ GALLERY_SANCTUARY_CSS, renderGallerySanctuary }
 * 约定：用户数据一律 textContent 写入；图标为内联单色 SVG。
 */

function svgIcon(paths) {
  return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

const ICONS = {
  salon: svgIcon('<path d="M3 4l5 2v14l-5-2z"/><path d="M8 6h13v14H8"/><path d="M12 10h5v6h-5z"/>'),
  book: svgIcon('<path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2z"/><path d="M12 6v14"/>'),
  wall: svgIcon('<path d="M3 5h7v6H3zM13 5h8v4h-8zM3 14h5v5H3zM11 14h10v5H11zM13 12h8"/>'),
  left: svgIcon('<path d="M15 5l-7 7 7 7"/>'),
  right: svgIcon('<path d="M9 5l7 7-7 7"/>'),
  remove: svgIcon('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  importer: svgIcon('<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>'),
  search: svgIcon('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  label: svgIcon('<path d="M4 7h16v10H4z"/><path d="M8 11h8M8 14h5"/>')
};

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
function roman(i) { return i < ROMAN.length ? ROMAN[i] : String(i + 1); }

const GALLERY_SANCTUARY_CSS = String.raw`
.bmgs-root{--gs-plaster:#ebe5da;--gs-plaster-2:#ddd5c7;--gs-floor:#8c7258;--gs-floor-2:#5e4a38;--gs-ceil:#f4f0e9;--gs-desk:#6b5340;--gs-paper:#f7f2e8;--gs-paper-2:#ece4d4;--gs-cloth:#3f4a45;--gs-beam:rgba(255,226,170,.30);
  container-type:inline-size;container-name:bmgssanc;
  position:relative;display:flex;flex-direction:column;gap:14px;min-width:0;width:100%;color:var(--bm7-ink,var(--text-normal));font-size:13px;line-height:1.5;outline:none;}
.theme-dark .bmgs-root{--gs-plaster:#2b2824;--gs-plaster-2:#211f1c;--gs-floor:#3a2f26;--gs-floor-2:#1d1814;--gs-ceil:#1f1d1a;--gs-desk:#2a2018;--gs-paper:#e9e1d1;--gs-paper-2:#d9cfbb;--gs-cloth:#26302c;--gs-beam:rgba(255,214,150,.20);}
.bmgs-root *{box-sizing:border-box;}
.bmgs-root button,.bmgs-root button:hover,.bmgs-root button:focus,.bmgs-root button:active{-webkit-appearance:none;appearance:none;background:transparent !important;background-color:transparent !important;border:0 !important;box-shadow:none !important;height:auto !important;min-height:0 !important;padding:0 !important;margin:0;white-space:normal !important;font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.bmgs-root button:focus-visible{outline:2px solid var(--bm7-accent,var(--interactive-accent)) !important;outline-offset:2px;border-radius:4px;}
.bmgs-root svg{flex:none;display:block;}
.bmgs-root[data-motion="off"] *{transition:none !important;animation:none !important;}
`;
const CSS_FOYER = String.raw`
.bmgs-foyer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0;}
.bmgs-switch{position:relative;display:inline-grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:4px;border-radius:999px;background:linear-gradient(180deg,rgba(0,0,0,.07),rgba(0,0,0,.02));box-shadow:inset 0 1px 2px rgba(0,0,0,.18),inset 0 -1px 0 rgba(255,255,255,.35);}
.theme-dark .bmgs-switch{background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(255,255,255,.03));box-shadow:inset 0 1px 3px rgba(0,0,0,.6),inset 0 -1px 0 rgba(255,255,255,.06);}
.bmgs-switch-knob{position:absolute;top:4px;bottom:4px;left:4px;width:calc((100% - 8px)/3);border-radius:999px;transform:translateX(calc(var(--i,0)*100%));background:linear-gradient(180deg,#f6e3b4,#d6b26a 55%,#b48a43);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(90,60,20,.35),0 2px 6px rgba(90,60,20,.35);transition:transform .42s cubic-bezier(.2,.9,.25,1.15);}
.bmgs-root .bmgs-switch button{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px !important;border-radius:999px;color:var(--bm7-ink-2,var(--text-muted));font-size:13px;letter-spacing:.06em;transition:color .25s;}
.bmgs-root .bmgs-switch button[aria-pressed="true"]{color:#3b2a12;font-weight:600;}
.bmgs-foyer-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;}
.bmgs-count{color:var(--bm7-ink-3,var(--text-faint));font-size:12px;letter-spacing:.06em;white-space:nowrap;}
.bmgs-root .bmgs-foyer-pin{display:inline-flex;align-items:center;gap:5px;padding:4px 10px !important;border-radius:999px;font-size:12px;color:var(--bm7-ink-2,var(--text-muted));box-shadow:inset 0 0 0 1px var(--bm7-line,rgba(0,0,0,.12)) !important;transition:color .2s,background .2s,box-shadow .2s;}
.bmgs-root .bmgs-foyer-pin:hover{color:var(--bm7-ink,var(--text-normal));background:var(--bm7-surface-2,rgba(127,127,127,.08)) !important;}
.bmgs-root .bmgs-foyer-pin[aria-pressed="true"]{color:#3b2a12;font-weight:600;background:linear-gradient(180deg,#f5e2b5,#dab46b) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 6px -2px rgba(90,60,20,.35) !important;}
.bmgs-lintel{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding:2px 2px 6px;min-width:0;}
.bmgs-lintel::-webkit-scrollbar{display:none;}
.bmgs-root .bmgs-plaque{flex:none;display:flex;align-items:baseline;gap:8px;max-width:220px;padding:7px 14px 7px 12px !important;border-radius:3px;color:var(--bm7-ink-2,var(--text-muted));background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,.15)) !important;box-shadow:inset 0 0 0 1px var(--bm7-line,rgba(0,0,0,.1)) !important;transition:color .25s,transform .25s;}
.theme-dark .bmgs-root .bmgs-plaque{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01)) !important;}
.bmgs-root .bmgs-plaque:hover{color:var(--bm7-ink,var(--text-normal));transform:translateY(-1px);}
.bmgs-plaque-no{font-family:Georgia,"Times New Roman",serif;font-size:13px;color:var(--bm7-gold,#b48a43);}
.bmgs-plaque-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;}
.bmgs-plaque-n{font-size:12px;color:var(--bm7-ink-3,var(--text-faint));}
.bmgs-root .bmgs-plaque[aria-pressed="true"]{color:#3b2a12;font-weight:600;background:linear-gradient(180deg,#f3dfae,#d4ae64 60%,#b88d45) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 3px 10px -4px rgba(120,80,20,.6) !important;}
.bmgs-root .bmgs-plaque[aria-pressed="true"] .bmgs-plaque-no,.bmgs-root .bmgs-plaque[aria-pressed="true"] .bmgs-plaque-n{color:#5a3d14;}
`;
const CSS_ROOM = String.raw`
.bmgs-room{--ceil:10%;--floor:16%;--sw:clamp(22px,6.2%,78px);position:relative;width:100%;height:var(--room-h,520px);border-radius:10px;overflow:hidden;isolation:isolate;background:var(--gs-plaster);box-shadow:0 18px 40px -24px rgba(0,0,0,.5);user-select:none;}
.bmgs-ceil{position:absolute;left:0;right:0;top:0;height:var(--ceil);background:linear-gradient(180deg,var(--gs-ceil),color-mix(in srgb,var(--gs-ceil) 82%,#000));clip-path:polygon(0 0,100% 0,100% 100%,var(--sw) 100%);}
.bmgs-rail{position:absolute;left:var(--sw);right:0;top:calc(var(--ceil) - 4px);height:5px;z-index:3;background:linear-gradient(180deg,#4a4540,#1f1c19);box-shadow:0 2px 4px rgba(0,0,0,.25);}
.bmgs-side{position:absolute;left:0;top:0;bottom:0;width:var(--sw);z-index:2;transform-origin:0 50%;transform:scaleX(calc(1 + var(--px,0)*.18));background:linear-gradient(90deg,color-mix(in srgb,var(--gs-plaster-2) 68%,#000),var(--gs-plaster-2) 92%,rgba(0,0,0,.16) 100%);clip-path:polygon(0 0,100% var(--ceil),100% calc(100% - var(--floor)),0 100%);transition:transform .5s ease-out;}
.bmgs-side::after{content:"";position:absolute;inset:0;pointer-events:none;background:color-mix(in srgb,var(--gs-plaster-2) 56%,#000);clip-path:polygon(0 calc(100% - 14px),100% calc(100% - var(--floor) - 9px),100% calc(100% - var(--floor)),0 100%);}
.bmgs-wall{position:absolute;left:var(--sw);right:0;top:var(--ceil);bottom:var(--floor);overflow:hidden;background:radial-gradient(120% 90% at 50% 25%,var(--gs-plaster),var(--gs-plaster-2));box-shadow:inset 8px 0 18px -12px rgba(0,0,0,.28);}
.bmgs-skirt{position:absolute;left:0;right:0;bottom:0;height:9px;z-index:2;background:linear-gradient(180deg,color-mix(in srgb,var(--gs-plaster-2) 70%,#000),color-mix(in srgb,var(--gs-plaster-2) 52%,#000));}
.bmgs-floor{position:absolute;left:0;right:0;bottom:0;height:var(--floor);clip-path:polygon(var(--sw) 0,100% 0,100% 100%,0 100%);background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(0,0,0,.25)),repeating-linear-gradient(90deg,rgba(0,0,0,.10) 0 1px,transparent 1px 120px),linear-gradient(180deg,var(--gs-floor),var(--gs-floor-2));}
.bmgs-floor::after{content:"";position:absolute;inset:0;background:radial-gradient(60% 70% at calc(50% + var(--px,0)*40px) 0%,rgba(255,230,180,.22),transparent 70%);}
.bmgs-beams{position:absolute;inset:0;pointer-events:none;z-index:1;}
.bmgs-beam{position:absolute;top:0;transform:translateX(-50%);clip-path:polygon(44% 0,56% 0,100% 100%,0 100%);background:linear-gradient(180deg,var(--gs-beam),transparent 92%);opacity:.9;}
.theme-dark .bmgs-beam{mix-blend-mode:screen;}
.bmgs-lamp{position:absolute;top:0;width:14px;height:11px;transform:translateX(-50%);border-radius:1px 1px 6px 6px;background:linear-gradient(180deg,#3b3733,#15130f);}
.bmgs-lamp::after{content:"";position:absolute;left:3px;right:3px;bottom:-2px;height:3px;border-radius:50%;background:#ffe6b0;box-shadow:0 0 10px 3px rgba(255,220,150,.75);}
.bmgs-hangs{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:var(--row-gap,36px);padding:10px 4% 22px;transform:translate3d(calc(var(--px,0)*-7px),calc(var(--py,0)*-4px),0);transition:transform .5s ease-out;}
.bmgs-root[data-caption="always"] .bmgs-hangs{padding-bottom:62px;}
.bmgs-row{display:flex;justify-content:center;align-items:center;gap:var(--col-gap,38px);min-width:0;}
.bmgs-root[data-dir="next"] .bmgs-hangs{animation:bmgs-walk-next .62s cubic-bezier(.2,.8,.2,1);}
.bmgs-root[data-dir="prev"] .bmgs-hangs{animation:bmgs-walk-prev .62s cubic-bezier(.2,.8,.2,1);}
.bmgs-root[data-motion="lite"] .bmgs-hangs{animation-duration:.28s;transform:none;}
@keyframes bmgs-walk-next{from{opacity:0;translate:7% 0;scale:.97}to{opacity:1;translate:0 0;scale:1}}
@keyframes bmgs-walk-prev{from{opacity:0;translate:-7% 0;scale:.97}to{opacity:1;translate:0 0;scale:1}}
.bmgs-root .bmgs-stroll{position:absolute;top:var(--ceil);bottom:0;width:11%;z-index:4;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.0);transition:color .3s,background .3s;}
.bmgs-root .bmgs-stroll.is-prev{left:0;}
.bmgs-root .bmgs-stroll.is-next{right:0;}
.bmgs-root .bmgs-stroll:hover{color:var(--bm7-ink,#222);}
.bmgs-root .bmgs-stroll.is-prev:hover{background:linear-gradient(90deg,rgba(0,0,0,.12),transparent) !important;}
.bmgs-root .bmgs-stroll.is-next:hover{background:linear-gradient(270deg,rgba(0,0,0,.12),transparent) !important;}
.bmgs-root .bmgs-stroll[disabled]{display:none;}
`;
const CSS_FRAME = String.raw`
.bmgs-hang{position:relative;flex:none;cursor:zoom-in;}
.bmgs-hang::before{content:"";position:absolute;left:-30%;right:-30%;top:-25%;bottom:-15%;z-index:-1;pointer-events:none;background:radial-gradient(closest-side,rgba(255,232,190,.38),transparent);}
.theme-dark .bmgs-hang::before{background:radial-gradient(closest-side,rgba(255,215,150,.16),transparent);}
.bmgs-frame{position:relative;padding:var(--mold,10px);border-radius:1px;transition:transform .45s cubic-bezier(.2,.8,.2,1),box-shadow .45s;box-shadow:0 22px 26px -18px rgba(0,0,0,.55),0 4px 8px -4px rgba(0,0,0,.35);}
.bmgs-hang:hover .bmgs-frame{transform:translateY(-3px);box-shadow:0 30px 34px -20px rgba(0,0,0,.6),0 6px 12px -6px rgba(0,0,0,.35);}
.bmgs-frame[data-mold="gilt"]{background:linear-gradient(135deg,#8a6a2c,#e9cf8a 28%,#b8924a 50%,#f1dc9f 72%,#7d5e25);}
.bmgs-frame[data-mold="walnut"]{background:linear-gradient(135deg,#3a2616,#6b4a30 40%,#4a301d 70%,#2d1d10);}
.bmgs-frame[data-mold="ebony"]{background:linear-gradient(135deg,#0f0e0d,#2b2927 50%,#121110);}
.bmgs-frame[data-mold="oak"]{background:linear-gradient(135deg,#a5845e,#d9bf98 45%,#b09068);}
.bmgs-mat{position:relative;padding:var(--mat,18px);background:#f6f2ea;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08),inset 2px 2px 4px rgba(0,0,0,.18);}
.bmgs-frame[data-mold="oak"] .bmgs-mat{background:#fbf8f2;}
.bmgs-frame[data-mold="ebony"] .bmgs-mat{background:#fafaf7;}
.bmgs-pic{position:relative;overflow:hidden;background:#d9d3c8;box-shadow:0 0 0 1px rgba(0,0,0,.18),-1px -1px 0 1px rgba(255,255,255,.7);}
.bmgs-pic img{display:block;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity .6s;}
.bmgs-pic img.is-ready{opacity:1;}
.bmgs-pic::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.16),transparent 38%);}
.bmgs-pic.is-broken{display:flex;align-items:center;justify-content:center;color:#8a8175;font-size:12px;}
.bmgs-cartel{position:absolute;left:50%;top:calc(100% + 12px);transform:translateX(-50%);width:max(150px,70%);max-width:240px;padding:7px 10px;background:#fbfaf6;color:#2c2924;border-radius:1px;box-shadow:0 2px 5px -2px rgba(0,0,0,.35);z-index:5;transition:opacity .3s,transform .3s;pointer-events:none;}
.bmgs-root[data-caption="hover"] .bmgs-cartel{opacity:0;transform:translate(-50%,-4px);}
.bmgs-root[data-caption="hover"] .bmgs-hang:hover .bmgs-cartel,.bmgs-root[data-caption="hover"] .bmgs-hang:focus-within .bmgs-cartel{opacity:1;transform:translate(-50%,0);}
.bmgs-cartel-t{font-size:12.5px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bmgs-cartel-s{font-size:12px;color:#6d665c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bmgs-root .bmgs-unhang{position:absolute;top:-10px;right:-10px;z-index:6;display:flex;align-items:center;gap:4px;padding:4px 8px !important;border-radius:999px;font-size:12px;color:#5b3b33;background:#fbf6ef !important;box-shadow:0 2px 6px rgba(0,0,0,.3) !important;opacity:0;transform:scale(.85);transition:opacity .2s,transform .2s;}
.bmgs-hang:hover .bmgs-unhang,.bmgs-unhang:focus-visible,.bmgs-unhang.is-armed{opacity:1;transform:scale(1);}
.bmgs-root .bmgs-unhang.is-armed{color:#fff;background:#a8473a !important;}
.bmgs-unhang-txt{display:none;white-space:nowrap;}
.bmgs-unhang.is-armed .bmgs-unhang-txt{display:inline;}
.bmgs-placard{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;min-width:0;}
.bmgs-placard-card{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:4px;background:var(--bm7-surface,var(--background-secondary));box-shadow:inset 0 0 0 1px var(--bm7-line,rgba(0,0,0,.08));}
.bmgs-root .bmgs-knob{display:flex;align-items:center;justify-content:center;width:30px;height:30px !important;border-radius:50%;color:#4a3414;background:radial-gradient(circle at 35% 30%,#fbe9bf,#d2aa5e 60%,#9c7434) !important;box-shadow:0 2px 4px rgba(60,40,10,.35),inset 0 -1px 1px rgba(60,40,10,.4) !important;transition:transform .15s;}
.bmgs-root .bmgs-knob:active{transform:scale(.92);}
.bmgs-root .bmgs-knob[disabled]{opacity:.35;cursor:default;}
.bmgs-placard-txt{font-size:13px;letter-spacing:.06em;white-space:nowrap;}
.bmgs-placard-txt b{font-family:Georgia,serif;color:var(--bm7-gold,#b48a43);font-size:15px;margin:0 2px;}
.bmgs-pips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:100%;}
.bmgs-root .bmgs-pip{width:18px;height:6px !important;border-radius:3px;background:var(--bm7-line,rgba(0,0,0,.15)) !important;transition:background .25s,width .25s;}
.bmgs-root .bmgs-pip[aria-current="true"]{width:30px;background:var(--bm7-gold,#c39a52) !important;}
`;
const CSS_BOOK = String.raw`
.bmgs-desk{position:relative;padding:20px 58px 18px 24px;border-radius:10px;background:radial-gradient(90% 80% at 50% 35%,color-mix(in srgb,var(--gs-desk) 88%,#fff),var(--gs-desk)),var(--gs-desk);box-shadow:inset 0 0 80px rgba(0,0,0,.35);min-width:0;}
.bmgs-desk::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:.25;background:repeating-linear-gradient(176deg,rgba(0,0,0,.18) 0 1px,transparent 1px 7px);}
.bmgs-book{position:relative;margin:0 auto;max-width:min(830px,max(400px,calc((100vh - 420px)*1.52)));}
.bmgs-cover{position:absolute;inset:-8px -8px -10px -8px;border-radius:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--gs-cloth) 90%,#fff),var(--gs-cloth));box-shadow:0 22px 36px -18px rgba(0,0,0,.65);}
.bmgs-spread{position:relative;display:grid;grid-template-columns:1fr 1fr;aspect-ratio:var(--spread-ar,1.52);min-height:300px;}
.bmgs-page{position:relative;padding:5.5% 7.2% 7.8%;display:flex;flex-direction:column;justify-content:center;gap:4.5%;min-width:0;min-height:0;color:#3a342b;background:var(--gs-paper);}
.bmgs-page.is-l{border-radius:4px 0 0 4px;background:linear-gradient(90deg,var(--gs-paper-2),var(--gs-paper) 8%,var(--gs-paper) 86%,color-mix(in srgb,var(--gs-paper) 82%,#000));box-shadow:-3px 0 0 -1px #d8cfbf,-5px 1px 0 -1px #cfc5b3;}
.bmgs-page.is-r{border-radius:0 4px 4px 0;background:linear-gradient(270deg,var(--gs-paper-2),var(--gs-paper) 8%,var(--gs-paper) 86%,color-mix(in srgb,var(--gs-paper) 82%,#000));box-shadow:3px 0 0 -1px #d8cfbf,5px 1px 0 -1px #cfc5b3;}
.bmgs-gutter{position:absolute;top:0;bottom:0;left:50%;width:9%;transform:translateX(-50%);pointer-events:none;z-index:2;background:linear-gradient(90deg,transparent,rgba(0,0,0,.10) 38%,rgba(0,0,0,.26) 50%,rgba(0,0,0,.10) 62%,transparent);}
.bmgs-folio-no{position:absolute;bottom:3.2%;font-family:Georgia,serif;font-size:12px;color:#8a8070;letter-spacing:.1em;}
.bmgs-page.is-l .bmgs-folio-no{left:7%;}
.bmgs-page.is-r .bmgs-folio-no{right:7%;}
.bmgs-running{position:absolute;top:3%;left:7%;right:7%;font-size:12px;color:#9a907f;letter-spacing:.14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bmgs-page.is-r .bmgs-running{text-align:right;}
.bmgs-plate-row{display:flex;justify-content:center;align-items:center;gap:6%;min-height:0;flex:1 1 0;max-width:100%;}
.bmgs-plate{position:relative;display:flex;flex-direction:column;align-items:center;min-width:0;min-height:0;max-width:100%;max-height:100%;cursor:zoom-in;}
.bmgs-plate-pic{position:relative;max-width:100%;max-height:100%;box-shadow:0 1px 2px rgba(0,0,0,.25),0 6px 12px -8px rgba(0,0,0,.4);background:#e2dbcd;}
.bmgs-plate-pic img{display:block;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity .5s;}
.bmgs-plate-pic img.is-ready{opacity:1;}
.bmgs-plate-pic::before,.bmgs-plate-pic::after{content:"";position:absolute;width:20px;height:20px;z-index:1;background:linear-gradient(135deg,rgba(60,50,40,.55) 50%,transparent 50%);}
.bmgs-plate-pic::before{top:-5px;left:-5px;}
.bmgs-plate-pic::after{bottom:-5px;right:-5px;transform:rotate(180deg);}
.bmgs-plate[data-mount="tape"] .bmgs-plate-pic::before,.bmgs-plate[data-mount="tape"] .bmgs-plate-pic::after{width:44px;height:13px;background:rgba(232,214,170,.78);box-shadow:0 1px 1px rgba(0,0,0,.08);}
.bmgs-plate[data-mount="tape"] .bmgs-plate-pic::before{top:-6px;left:50%;transform:translateX(-50%) rotate(-3deg);}
.bmgs-plate[data-mount="tape"] .bmgs-plate-pic::after{display:none;}
.bmgs-plate-cap{margin-top:6px;max-width:100%;text-align:center;font-size:12px;color:#5f574b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bmgs-root[data-caption="hover"] .bmgs-plate-cap{opacity:0;transition:opacity .25s;}
.bmgs-root[data-caption="hover"] .bmgs-plate:hover .bmgs-plate-cap{opacity:1;}
.bmgs-plate .bmgs-unhang{top:-12px;right:-12px;}
.bmgs-plate:hover .bmgs-unhang{opacity:1;transform:scale(1);}
.bmgs-blank{display:flex;align-items:center;justify-content:center;flex:1;color:#b2a894;font-size:12px;letter-spacing:.3em;}
.bmgs-tabs{position:absolute;top:5%;bottom:5%;left:100%;width:56px;display:flex;flex-direction:column;gap:3px;overflow-y:auto;scrollbar-width:none;padding:4px 0;z-index:0;}
.bmgs-tabs::-webkit-scrollbar{display:none;}
.bmgs-root .bmgs-tab{flex:none;position:relative;display:flex;align-items:center;justify-content:center;width:calc(30px + var(--step,0)*4px);min-height:58px;max-height:124px;padding:7px 4px !important;margin-left:-2px;border-radius:0 7px 7px 0;writing-mode:vertical-rl;font-size:12px;letter-spacing:.12em;color:#5b5244;background:linear-gradient(90deg,color-mix(in srgb,var(--tab-c) 70%,#000) 0,var(--tab-c) 18%) !important;box-shadow:2px 1px 3px rgba(0,0,0,.25) !important;transition:width .3s cubic-bezier(.2,.8,.2,1),filter .2s;overflow:hidden;}
.bmgs-root .bmgs-tab:hover{width:calc(38px + var(--step,0)*4px);filter:brightness(1.05);}
.bmgs-root .bmgs-tab[aria-pressed="true"]{width:50px;color:#2c241a;font-weight:600;z-index:2;}
.bmgs-tab-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-height:104px;}
.bmgs-turn{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:12px;color:#efe6d4;}
.bmgs-turn .bmgs-placard-txt{color:#efe6d4;}
.bmgs-root .bmgs-corner{position:absolute;bottom:0;width:13%;height:16%;z-index:3;}
.bmgs-root .bmgs-corner.is-l{left:0;}
.bmgs-root .bmgs-corner.is-r{right:0;}
.bmgs-root .bmgs-corner::after{content:"";position:absolute;bottom:0;width:0;height:0;transition:width .25s,height .25s;}
.bmgs-root .bmgs-corner.is-r::after{right:0;background:linear-gradient(315deg,transparent 50%,#e8dfcd 50%,#d5cab4);box-shadow:-2px -2px 4px rgba(0,0,0,.15);}
.bmgs-root .bmgs-corner.is-l::after{left:0;background:linear-gradient(45deg,transparent 50%,#e8dfcd 50%,#d5cab4);box-shadow:2px -2px 4px rgba(0,0,0,.15);}
.bmgs-root .bmgs-corner:hover::after{width:34px;height:34px;}
.bmgs-root .bmgs-corner[disabled]{display:none;}
.bmgs-root[data-flip="next"] .bmgs-page.is-r,.bmgs-root[data-flip="prev"] .bmgs-page.is-l{animation:bmgs-leaf .5s cubic-bezier(.3,.7,.2,1);}
@keyframes bmgs-leaf{from{opacity:.2;filter:brightness(.82)}to{opacity:1;filter:none}}
`;
const CSS_WALL = String.raw`
.bmgs-wallbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-width:0;}
.bmgs-chips{display:flex;gap:4px 16px;flex-wrap:wrap;min-width:0;flex:1 1 300px;}
.bmgs-root .bmgs-chip{position:relative;padding:3px 0 !important;font-size:13px;color:var(--bm7-ink-3,var(--text-faint));max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap !important;transition:color .2s;}
.bmgs-root .bmgs-chip:hover{color:var(--bm7-ink,var(--text-normal));}
.bmgs-root .bmgs-chip[aria-pressed="true"]{color:var(--bm7-ink,var(--text-normal));font-weight:600;}
.bmgs-root .bmgs-chip[aria-pressed="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:1px;background:var(--bm7-gold,#c39a52);}
.bmgs-density{display:flex;align-items:center;gap:8px;color:var(--bm7-ink-3,var(--text-faint));font-size:12px;}
.bmgs-density input[type=range]{width:108px;height:4px;accent-color:var(--bm7-gold,#c39a52);cursor:pointer;}
.bmgs-root .bmgs-toggle{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--bm7-ink-3,var(--text-faint));padding:4px 10px !important;border-radius:999px;box-shadow:inset 0 0 0 1px var(--bm7-line,rgba(0,0,0,.1)) !important;}
.bmgs-root .bmgs-toggle[aria-pressed="true"]{color:#3b2a12;font-weight:600;background:linear-gradient(180deg,#f5e2b5,#dab46b) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 6px -2px rgba(90,60,20,.35) !important;}
.bmgs-flow{display:flex;flex-wrap:wrap;gap:var(--g,10px);min-width:0;}
.bmgs-flow::after{content:"";flex-grow:999;}
.bmgs-tile{position:relative;height:var(--rh,240px);flex-grow:var(--ar,1);flex-basis:calc(var(--rh,240px)*var(--ar,1));max-width:100%;overflow:hidden;border-radius:3px;cursor:zoom-in;background:var(--bm7-surface-2,rgba(0,0,0,.06));}
.bmgs-tile img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .45s,transform .6s cubic-bezier(.2,.8,.2,1);}
.bmgs-tile img.is-ready{opacity:1;}
.bmgs-tile:hover img{transform:scale(1.025);}
.bmgs-tile[data-tall] img{object-fit:contain;}
.bmgs-tile-cap{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 7px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.62));font-size:12px;line-height:1.35;min-width:0;transition:opacity .25s;}
.bmgs-tile-cap div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bmgs-tile-cap div+div{opacity:.78;}
.bmgs-root[data-caption="hover"] .bmgs-tile-cap{opacity:0;}
.bmgs-root[data-caption="hover"] .bmgs-tile:hover .bmgs-tile-cap{opacity:1;}
.bmgs-tile .bmgs-unhang{top:6px;right:6px;}
.bmgs-tile:hover .bmgs-unhang{opacity:1;transform:scale(1);}
@media (hover:none),(pointer:coarse){
  .bmgs-root .bmgs-stroll{color:var(--bm7-ink-3,rgba(120,110,95,.65));}
  .bmgs-root .bmgs-unhang{opacity:.9;transform:scale(.92);}
  .bmgs-root[data-caption="hover"] .bmgs-cartel{opacity:1;transform:translate(-50%,0);}
  .bmgs-root[data-caption="hover"] .bmgs-plate-cap{opacity:1;}
  .bmgs-root[data-caption="hover"] .bmgs-tile-cap{opacity:1;}
}
.bmgs-empty{display:flex;flex-direction:column;align-items:center;gap:14px;padding:60px 20px;border-radius:10px;text-align:center;color:var(--bm7-ink-2,var(--text-muted));background:radial-gradient(70% 90% at 50% 0%,rgba(255,226,170,.18),transparent 70%),var(--bm7-surface,var(--background-secondary));}
.bmgs-empty-frame{width:120px;height:86px;padding:8px;background:linear-gradient(135deg,#8a6a2c,#e9cf8a 40%,#9c7a3a);box-shadow:0 14px 20px -12px rgba(0,0,0,.5);}
.bmgs-empty-frame div{width:100%;height:100%;background:#f4efe5;box-shadow:inset 2px 2px 4px rgba(0,0,0,.18);}
.bmgs-empty-t{font-size:15px;color:var(--bm7-ink,var(--text-normal));}
.bmgs-empty-acts{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;}
.bmgs-root .bmgs-act{display:flex;align-items:center;gap:6px;padding:8px 16px !important;border-radius:999px;font-size:13px;color:var(--bm7-ink,var(--text-normal));box-shadow:inset 0 0 0 1px var(--bm7-line,rgba(0,0,0,.12)) !important;}
.bmgs-root .bmgs-act.is-main{color:#3b2a12;background:linear-gradient(180deg,#f3dfae,#d4ae64) !important;box-shadow:0 3px 10px -4px rgba(120,80,20,.6) !important;}
@container bmgssanc (max-width:660px){
  .bmgs-room{--sw:18px;--ceil:8%;--floor:12%;}
  .bmgs-root .bmgs-stroll{width:16%;}
  .bmgs-desk{padding:52px 14px 18px;}
  .bmgs-book{max-width:100%;}
  .bmgs-spread{grid-template-columns:1fr;aspect-ratio:auto;}
  .bmgs-page{padding:28px 18px 30px;min-height:240px;gap:20px;}
  .bmgs-page.is-l{border-radius:4px 4px 0 0;border-bottom:1px solid rgba(60,48,32,.14);box-shadow:inset 0 -10px 14px -10px rgba(0,0,0,.16);}
  .bmgs-page.is-r{border-radius:0 0 4px 4px;box-shadow:inset 0 10px 14px -10px rgba(0,0,0,.16);}
  .bmgs-gutter{display:none;}
  .bmgs-tabs{left:3%;right:3%;top:auto;bottom:calc(100% + 6px);width:auto;flex-direction:row;overflow-x:auto;overflow-y:hidden;align-items:flex-end;height:42px;padding:0 2px;}
  .bmgs-root .bmgs-tab{writing-mode:horizontal-tb;width:auto !important;min-height:0;height:calc(28px + var(--step,0)*2px) !important;max-width:126px;margin:0;border-radius:6px 6px 0 0;padding:4px 10px !important;background:linear-gradient(180deg,var(--tab-c) 80%,color-mix(in srgb,var(--tab-c) 72%,#000)) !important;}
  .bmgs-root .bmgs-tab[aria-pressed="true"]{height:36px !important;}
  .bmgs-density input[type=range]{width:80px;}
}
.bmgs-root.is-narrow .bmgs-room{--sw:18px;--ceil:8%;--floor:12%;}
.bmgs-root.is-narrow .bmgs-stroll{width:16%;}
.bmgs-root.is-narrow .bmgs-desk{padding:52px 14px 18px;}
.bmgs-root.is-narrow .bmgs-book{max-width:100%;}
.bmgs-root.is-narrow .bmgs-spread{grid-template-columns:1fr;aspect-ratio:auto;}
.bmgs-root.is-narrow .bmgs-page{padding:28px 18px 30px;min-height:240px;gap:20px;}
.bmgs-root.is-narrow .bmgs-page.is-l{border-radius:4px 4px 0 0;border-bottom:1px solid rgba(60,48,32,.14);box-shadow:inset 0 -10px 14px -10px rgba(0,0,0,.16);}
.bmgs-root.is-narrow .bmgs-page.is-r{border-radius:0 0 4px 4px;box-shadow:inset 0 10px 14px -10px rgba(0,0,0,.16);}
.bmgs-root.is-narrow .bmgs-gutter{display:none;}
.bmgs-root.is-narrow .bmgs-tabs{left:3%;right:3%;top:auto;bottom:calc(100% + 6px);width:auto;flex-direction:row;overflow-x:auto;overflow-y:hidden;align-items:flex-end;height:42px;padding:0 2px;}
.bmgs-root.is-narrow .bmgs-tab{writing-mode:horizontal-tb;width:auto !important;min-height:0;height:calc(28px + var(--step,0)*2px) !important;max-width:126px;margin:0;border-radius:6px 6px 0 0;padding:4px 10px !important;background:linear-gradient(180deg,var(--tab-c) 80%,color-mix(in srgb,var(--tab-c) 72%,#000)) !important;}
.bmgs-root.is-narrow .bmgs-tab[aria-pressed="true"]{height:36px !important;}
.bmgs-root.is-narrow .bmgs-density input[type=range]{width:80px;}
`;

const PART_CSS = [CSS_FOYER, CSS_ROOM, CSS_FRAME, CSS_BOOK, CSS_WALL];

/* ───────────────────────── helpers ───────────────────────── */
function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function btn(cls, opts) {
  const b = mk('button', cls);
  b.type = 'button';
  if (opts && opts.icon) b.insertAdjacentHTML('beforeend', ICONS[opts.icon]);
  if (opts && opts.text != null) b.appendChild(mk('span', opts.textCls || '', opts.text));
  if (opts && opts.label) { b.setAttribute('aria-label', opts.label); b.title = opts.label; }
  return b;
}
function hash(s) {
  let h = 2166136261;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function aspectOf(ill) {
  const a = Number(ill && ill._naturalAspect);
  return Number.isFinite(a) && a > 0 ? clamp(a, 0.2, 5) : 0.75;
}
function subLine(ill) {
  return [ill.characterName, ill.animeTitle].filter(Boolean).join(' · ') || ill.sourceLabel || '';
}
function matchFolio(ill, key) {
  if (!key || key === 'all') return true;
  const ani = String((ill && ill.animeTitle) || '').trim();
  const ch = String((ill && ill.characterName) || '').trim();
  if (key === 'loose') return !ani && !ch;
  const i = key.indexOf('::');
  if (i < 0) return true;
  const kind = key.slice(0, i), val = key.slice(i + 2);
  if (kind === 'anime') return ani === val;
  if (kind === 'char') return ch === val;
  return true;
}

/* 每张图按真实比例「等面积」定尺寸：竖幅更高、横幅更宽、长条不裁切 */
function frameSize(aspect, area, maxW, maxH) {
  let h = Math.sqrt(area / aspect), w = h * aspect;
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/* 展墙分墙：按视平线居中，常规视口单排精挂（3～4 幅大画配独立射灯），超高视口允许双排 */
function planWalls(list, wallW, wallH, captionAlways) {
  const rows = wallH >= 560 && wallW >= 820 ? 2 : 1;
  const maxPerRow = wallW >= 1060 ? 4 : wallW >= 700 ? 3 : wallW >= 440 ? 2 : 1;
  const colGap = clamp(wallW * 0.052, 22, 58);
  const rowGap = captionAlways ? 64 : 36;
  const usableW = wallW * 0.88;
  const bottomClearance = captionAlways ? 84 : 32;
  const rowH = Math.max(120, (wallH - bottomClearance - rowGap * (rows - 1)) / rows);
  const chrome = (h) => 2 * (clamp(h * 0.045, 6, 14) + clamp(h * 0.10, 8, 28));
  const picMaxH = Math.max(90, rowH * 0.94);
  const area = Math.pow(picMaxH * (rows === 1 ? 0.78 : 0.66), 2);
  const maxSingleW = usableW * (maxPerRow === 1 ? 0.86 : 0.56);
  const walls = [];
  let wall = [], row = [], rowW = 0;
  for (let i = 0; i < list.length; i++) {
    const a = aspectOf(list[i]);
    const pre = frameSize(a, area, maxSingleW, picMaxH);
    const ch = chrome(pre.h);
    const s = frameSize(a, area, Math.max(72, maxSingleW - ch), Math.max(72, picMaxH - ch));
    const outerW = s.w + chrome(s.h);
    if (row.length >= maxPerRow || (row.length && rowW + colGap + outerW > usableW)) {
      wall.push(row); row = []; rowW = 0;
      if (wall.length >= rows) { walls.push(wall); wall = []; }
    }
    row.push({ ill: list[i], index: i, w: s.w, h: s.h });
    rowW += (row.length > 1 ? colGap : 0) + outerW;
  }
  if (row.length) wall.push(row);
  if (wall.length) walls.push(wall);
  return { walls, colGap, rowGap };
}

/* 画集跨页排版：每页 1～3 幅；横幅独占一行，竖幅并排（超窄单列屏自动单幅成行） */
function planPages(list, maxCols = 2) {
  const pages = [];
  let page = [], row = [], budget = 0;
  const flushRow = () => { if (row.length) { page.push(row); row = []; } };
  const flushPage = () => { flushRow(); if (page.length) pages.push(page); page = []; budget = 0; };
  list.forEach((ill, index) => {
    const a = aspectOf(ill);
    const wide = a >= 1.15 || maxCols <= 1;
    const cost = a < 0.45 ? 2 : (wide ? 1 : 0.5);
    if (budget + cost > 2 + 1e-6) flushPage();
    if (wide || cost >= 2) { flushRow(); page.push([{ ill, index }]); }
    else { row.push({ ill, index }); if (row.length >= maxCols) flushRow(); }
    budget += cost;
  });
  flushPage();
  return pages;
}

const MOLDS = ['gilt', 'walnut', 'ebony', 'oak'];
const TAB_TONES = ['#e9d8b4', '#d9e2cf', '#ead0c7', '#d3dce6', '#e6dcc0', '#dcd2e2', '#f0e2c4', '#cfe0dc'];

/* 装图：失败回退在线预览；成功回写真实比例，比例偏差大时通知重排 */
function loadImg(holder, ill, ctx, onAspectShift) {
  const img = document.createElement('img');
  img.decoding = 'async';
  img.loading = 'lazy';
  img.alt = ill.title || '';
  img.draggable = false;
  let triedRemote = false;
  img.onload = () => {
    img.classList.add('is-ready');
    if (img.naturalWidth && img.naturalHeight) {
      const real = img.naturalWidth / img.naturalHeight;
      const prev = Number(ill._naturalAspect);
      ill._naturalAspect = real;
      if (ctx.onNaturalAspect) { try { ctx.onNaturalAspect(ill, real); } catch (_) { /* noop */ } }
      if (!(prev > 0) || Math.abs(prev - real) / real > 0.12) onAspectShift && onAspectShift();
    }
  };
  img.onerror = () => {
    if (ctx.onBrokenLocalFile) {
      try { if (ctx.onBrokenLocalFile(ill) === true) return; } catch (_) { /* noop */ }
    }
    const remote = ill.imageUrl && /^https?:/i.test(ill.imageUrl) ? ill.imageUrl : '';
    if (!triedRemote && remote && img.src !== remote) { triedRemote = true; img.src = remote; return; }
    holder.classList.add('is-broken');
    img.remove();
    holder.appendChild(mk('span', '', '图像暂缺'));
  };
  let src = '';
  try { src = ctx.resolveImgSrc ? ctx.resolveImgSrc(ill) : (ill.imageUrl || ''); } catch (_) { src = ill.imageUrl || ''; }
  img.src = src || ill.imageUrl || '';
  if (img.complete && img.naturalWidth > 0) {
    img.style.transition = 'none';
    img.classList.add('is-ready');
    const real = img.naturalWidth / img.naturalHeight;
    ill._naturalAspect = real;
    if (ctx.onNaturalAspect) { try { ctx.onNaturalAspect(ill, real); } catch (_) { /* noop */ } }
  }
  holder.appendChild(img);
  return img;
}

/* 撤下按钮：首次点击变「确认撤下」，3 秒内再点才真正删除 */
function unhangBtn(ill, ctx) {
  const b = btn('bmgs-unhang', { icon: 'remove', label: '撤下这幅' });
  b.appendChild(mk('span', 'bmgs-unhang-txt', '确认撤下'));
  let timer = 0;
  b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!b.classList.contains('is-armed')) {
      b.classList.add('is-armed');
      timer = window.setTimeout(() => b.classList.remove('is-armed'), 3000);
      return;
    }
    window.clearTimeout(timer);
    b.disabled = true;
    try { if (ctx.onDeleteItem) await ctx.onDeleteItem(ill); } finally { b.disabled = false; b.classList.remove('is-armed'); }
  });
  return b;
}

function bindPiece(node, ill, list, index, ctx) {
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', (ill.title || '画作') + (subLine(ill) ? '，' + subLine(ill) : ''));
  node.addEventListener('click', () => ctx.onOpenLightbox && ctx.onOpenLightbox(ill, list, index));
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); ctx.onOpenLightbox && ctx.onOpenLightbox(ill, list, index); }
  });
  node.addEventListener('contextmenu', (ev) => { if (ctx.onContextMenu) { ev.preventDefault(); ctx.onContextMenu(ev, ill, list, index); } });
  if (ctx.onBindPiece) { try { ctx.onBindPiece(node, ill, list, index); } catch (_) { /* noop */ } }
}

function renderEmpty(stage, ctx, filtered) {
  const box = mk('div', 'bmgs-empty');
  const fr = mk('div', 'bmgs-empty-frame'); fr.appendChild(mk('div'));
  box.appendChild(fr);
  box.appendChild(mk('div', 'bmgs-empty-t', filtered ? '这一册还没有挂上画' : '展墙还空着'));
  box.appendChild(mk('div', '', filtered ? '换一个分册看看，或者导入新的画作。' : '从本地导入，或在线搜一张喜欢的图挂上去。'));
  const acts = mk('div', 'bmgs-empty-acts');
  if (ctx.onImportClick) { const a = btn('bmgs-act is-main', { icon: 'importer', text: '本地导入' }); a.onclick = () => ctx.onImportClick(); acts.appendChild(a); }
  if (ctx.onOnlineSearchClick) { const a = btn('bmgs-act', { icon: 'search', text: '在线搜图' }); a.onclick = () => ctx.onOnlineSearchClick(); acts.appendChild(a); }
  box.appendChild(acts);
  stage.appendChild(box);
}

/* ───────────────────────── 展厅转角 ───────────────────────── */
function renderSalon(stage, env) {
  const { ctx, state, list } = env;
  const lintel = mk('div', 'bmgs-lintel');
  lintel.setAttribute('role', 'toolbar');
  lintel.setAttribute('aria-label', '展室导览');
  env.folios.forEach((f, i) => {
    const p = btn('bmgs-plaque');
    p.setAttribute('aria-pressed', String(f.key === state.activeFolio));
    p.appendChild(mk('span', 'bmgs-plaque-no', roman(i)));
    p.appendChild(mk('span', 'bmgs-plaque-name', f.label));
    p.appendChild(mk('span', 'bmgs-plaque-n', f.count));
    p.title = f.label + ' · ' + f.count + ' 幅';
    p.onclick = () => env.setState({ activeFolio: f.key, wallIndex: 0, bookPage: 0 });
    lintel.appendChild(p);
  });
  lintel.addEventListener('wheel', (ev) => {
    if (lintel.scrollWidth > lintel.clientWidth + 4 && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
      lintel.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }
  }, { passive: false });
  stage.appendChild(lintel);
  if (!list.length) { renderEmpty(stage, ctx, state.activeFolio !== 'all'); return; }

  const room = mk('div', 'bmgs-room');
  const vh = window.innerHeight || 800;
  const hostW = stage.clientWidth || 800;
  room.style.setProperty('--room-h', Math.round(clamp(Math.min(vh * 0.54, hostW * 0.68), 340, 680)) + 'px');
  room.appendChild(mk('div', 'bmgs-ceil'));
  const wall = mk('div', 'bmgs-wall');
  const beams = mk('div', 'bmgs-beams');
  const hangs = mk('div', 'bmgs-hangs');
  wall.appendChild(beams);
  wall.appendChild(hangs);
  wall.appendChild(mk('div', 'bmgs-skirt'));
  room.appendChild(wall);
  room.appendChild(mk('div', 'bmgs-side'));
  room.appendChild(mk('div', 'bmgs-rail'));
  room.appendChild(mk('div', 'bmgs-floor'));
  const prev = btn('bmgs-stroll is-prev', { icon: 'left', label: '走向上一面墙' });
  const next = btn('bmgs-stroll is-next', { icon: 'right', label: '走向下一面墙' });
  room.appendChild(prev);
  room.appendChild(next);
  stage.appendChild(room);

  const placard = mk('div', 'bmgs-placard');
  stage.appendChild(placard);

  const plan = planWalls(list, wall.clientWidth || hostW * 0.9, wall.clientHeight || 400, state.captionMode === 'always');
  const total = plan.walls.length;
  if (env.anchorId) {
    const at = plan.walls.findIndex((w) => w.some((r) => r.some((c) => c.ill.id === env.anchorId)));
    if (at >= 0) state.wallIndex = at;
    env.anchorId = null;
  }
  state.wallIndex = clamp(state.wallIndex | 0, 0, total - 1);
  hangs.style.setProperty('--col-gap', plan.colGap + 'px');
  hangs.style.setProperty('--row-gap', plan.rowGap + 'px');

  plan.walls[state.wallIndex].forEach((rowCells) => {
    const row = mk('div', 'bmgs-row');
    rowCells.forEach((c) => {
      const minSide = Math.min(c.w, c.h);
      const hang = mk('div', 'bmgs-hang');
      const frame = mk('div', 'bmgs-frame');
      frame.dataset.mold = MOLDS[hash(c.ill.id) % MOLDS.length];
      frame.style.setProperty('--mold', Math.round(clamp(c.h * 0.045, 6, 14)) + 'px');
      frame.style.setProperty('--mat', Math.round(clamp(minSide * 0.12, 8, 30)) + 'px');
      const mat = mk('div', 'bmgs-mat');
      const pic = mk('div', 'bmgs-pic');
      pic.style.width = c.w + 'px';
      pic.style.height = c.h + 'px';
      loadImg(pic, c.ill, ctx, env.onAspectShift);
      mat.appendChild(pic);
      frame.appendChild(mat);
      hang.appendChild(frame);
      const cartel = mk('div', 'bmgs-cartel');
      cartel.appendChild(mk('div', 'bmgs-cartel-t', c.ill.title || '无题'));
      const sub = subLine(c.ill);
      if (sub) cartel.appendChild(mk('div', 'bmgs-cartel-s', sub));
      hang.appendChild(cartel);
      if (ctx.onDeleteItem) frame.appendChild(unhangBtn(c.ill, ctx));
      bindPiece(hang, c.ill, list, c.index, ctx);
      row.appendChild(hang);
    });
    hangs.appendChild(row);
  });
  env.anchorProbe = () => { const w = plan.walls[state.wallIndex]; return w && w[0] && w[0][0] ? w[0][0].ill.id : null; };

  /* 射灯：对齐每一幅画的中心，从轨道投下暖光锥 */
  window.requestAnimationFrame(() => {
    if (!wall.isConnected) return;
    const wb = wall.getBoundingClientRect();
    const xs = [];
    hangs.querySelectorAll('.bmgs-frame').forEach((f) => {
      const r = f.getBoundingClientRect();
      const cx = r.left + r.width / 2 - wb.left;
      if (xs.some((x) => Math.abs(x.cx - cx) < 40)) return;
      xs.push({ cx, w: r.width, bottom: r.bottom - wb.top });
    });
    xs.forEach((x) => {
      const beam = mk('div', 'bmgs-beam');
      beam.style.left = x.cx + 'px';
      beam.style.width = Math.round(x.w * 1.7) + 'px';
      beam.style.height = Math.round(Math.min(wb.height, x.bottom + 50)) + 'px';
      beams.appendChild(beam);
      const lamp = mk('div', 'bmgs-lamp');
      lamp.style.left = x.cx + 'px';
      beams.appendChild(lamp);
    });
  });

  const go = (d) => {
    const to = clamp(state.wallIndex + d, 0, total - 1);
    if (to === state.wallIndex) return false;
    env.dir = d > 0 ? 'next' : 'prev';
    env.setState({ wallIndex: to });
    return true;
  };
  prev.disabled = state.wallIndex <= 0;
  next.disabled = state.wallIndex >= total - 1;
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  env.step = go;

  const card = mk('div', 'bmgs-placard-card');
  const kp = btn('bmgs-knob', { icon: 'left', label: '上一面墙' });
  const kn = btn('bmgs-knob', { icon: 'right', label: '下一面墙' });
  kp.disabled = prev.disabled; kn.disabled = next.disabled;
  kp.onclick = () => go(-1); kn.onclick = () => go(1);
  const txt = mk('span', 'bmgs-placard-txt');
  txt.append('第', mk('b', '', state.wallIndex + 1), '面展墙 / 共 ' + total + ' 面');
  card.append(kp, txt, kn);
  placard.appendChild(card);
  if (total > 1 && total <= 16) {
    const pips = mk('div', 'bmgs-pips');
    for (let i = 0; i < total; i++) {
      const pip = btn('bmgs-pip', { label: '第 ' + (i + 1) + ' 面展墙' });
      if (i === state.wallIndex) pip.setAttribute('aria-current', 'true');
      pip.onclick = () => go(i - state.wallIndex);
      pips.appendChild(pip);
    }
    placard.appendChild(pips);
  }

  /* 滚轮漫步：越过阈值才换墙；到头时放行页面滚动 */
  let acc = 0, lock = 0;
  room.addEventListener('wheel', (ev) => {
    if (total < 2) return;
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    const dir = d > 0 ? 1 : -1;
    if ((dir > 0 && state.wallIndex >= total - 1) || (dir < 0 && state.wallIndex <= 0)) return;
    ev.preventDefault();
    if (Date.now() < lock) return;
    acc += d;
    if (Math.abs(acc) > 70) { acc = 0; lock = Date.now() + 520; go(dir); }
  }, { passive: false });

  /* 视差：轻微头部移动感 */
  if (ctx.motionTier === 'full') {
    let raf = 0;
    room.addEventListener('pointermove', (ev) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const r = room.getBoundingClientRect();
        room.style.setProperty('--px', (((ev.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
        room.style.setProperty('--py', (((ev.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
      });
    });
    room.addEventListener('pointerleave', () => { room.style.setProperty('--px', '0'); room.style.setProperty('--py', '0'); });
  }
}

/* ───────────────────────── 精装画集 ───────────────────────── */
function renderBook(stage, env) {
  const { ctx, state, list } = env;
  const desk = mk('div', 'bmgs-desk');
  const book = mk('div', 'bmgs-book');
  book.appendChild(mk('div', 'bmgs-cover'));
  desk.appendChild(book);
  stage.appendChild(desk);

  /* 书口阶梯折签：越往下探得越远，当前分册整片拉出 */
  const tabs = mk('div', 'bmgs-tabs');
  tabs.setAttribute('role', 'toolbar');
  tabs.setAttribute('aria-label', '分册索引');
  env.folios.forEach((f, i) => {
    const t = btn('bmgs-tab');
    t.style.setProperty('--tab-c', TAB_TONES[i % TAB_TONES.length]);
    t.style.setProperty('--step', String(i % 4));
    t.setAttribute('aria-pressed', String(f.key === state.activeFolio));
    t.title = f.label + ' · ' + f.count + ' 幅';
    t.appendChild(mk('span', 'bmgs-tab-txt', f.label));
    t.onclick = () => env.setState({ activeFolio: f.key, bookPage: 0, wallIndex: 0 });
    tabs.appendChild(t);
  });
  book.appendChild(tabs);

  const spread = mk('div', 'bmgs-spread');
  book.appendChild(spread);
  if (!list.length) {
    spread.style.display = 'block';
    spread.style.aspectRatio = 'auto';
    renderEmpty(spread, ctx, state.activeFolio !== 'all');
    return;
  }
  const stageW = stage.clientWidth || 800;
  const narrow = stageW <= 660;
  const pages = planPages(list, stageW <= 430 ? 1 : 2);
  const spreads = Math.max(1, Math.ceil(pages.length / 2));
  state.bookPage = clamp(state.bookPage | 0, 0, spreads - 1);
  const folio = env.folios.find((f) => f.key === state.activeFolio);
  const running = folio ? folio.label : '全部收录';

  [0, 1].forEach((side) => {
    const pIdx = state.bookPage * 2 + side;
    const page = mk('div', 'bmgs-page ' + (side ? 'is-r' : 'is-l'));
    page.appendChild(mk('div', 'bmgs-running', side ? running : '画集 · ' + list.length + ' 幅'));
    page.appendChild(mk('div', 'bmgs-folio-no', pIdx + 1));
    spread.appendChild(page);
    const rows = pages[pIdx];
    if (!rows) { page.appendChild(mk('div', 'bmgs-blank', '留白')); return; }
    const cs = window.getComputedStyle(page);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const pw = page.clientWidth || 360;
    const innerW = Math.max(110, pw - padX - 8);
    const innerH = Math.max(150, narrow ? Math.min(340, innerW * 1.18) : ((page.clientHeight || pw * 1.32) - padY - 14));
    const capH = state.captionMode === 'always' ? 30 : 12;
    const rowGapPx = Math.round(innerH * 0.055);
    const rowH = (innerH - (rows.length - 1) * rowGapPx) / rows.length - capH;
    rows.forEach((cells) => {
      const row = mk('div', 'bmgs-plate-row');
      const sumA = cells.reduce((s, c) => s + aspectOf(c.ill), 0);
      const gap = Math.round(innerW * 0.06) * (cells.length - 1);
      const h = Math.max(60, Math.min(rowH, (innerW - gap) / sumA));
      cells.forEach((c) => {
        const wPx = Math.round(h * aspectOf(c.ill));
        const plate = mk('div', 'bmgs-plate');
        plate.style.maxWidth = Math.max(96, wPx + 8) + 'px';
        plate.dataset.mount = hash(c.ill.id) % 3 === 0 ? 'tape' : 'corner';
        const pic = mk('div', 'bmgs-plate-pic');
        pic.style.width = wPx + 'px';
        pic.style.height = Math.round(h) + 'px';
        loadImg(pic, c.ill, ctx, env.onAspectShift);
        plate.appendChild(pic);
        plate.appendChild(mk('div', 'bmgs-plate-cap', c.ill.title || subLine(c.ill) || '无题'));
        if (ctx.onDeleteItem) plate.appendChild(unhangBtn(c.ill, ctx));
        bindPiece(plate, c.ill, list, c.index, ctx);
        row.appendChild(plate);
      });
      page.appendChild(row);
    });
  });
  spread.appendChild(mk('div', 'bmgs-gutter'));

  const go = (d) => {
    const to = clamp(state.bookPage + d, 0, spreads - 1);
    if (to === state.bookPage) return false;
    env.flip = d > 0 ? 'next' : 'prev';
    env.setState({ bookPage: to });
    return true;
  };
  env.step = go;
  const cl = btn('bmgs-corner is-l', { label: '往前翻' });
  const cr = btn('bmgs-corner is-r', { label: '往后翻' });
  cl.disabled = state.bookPage <= 0;
  cr.disabled = state.bookPage >= spreads - 1;
  cl.onclick = () => go(-1);
  cr.onclick = () => go(1);
  spread.append(cl, cr);

  const turn = mk('div', 'bmgs-turn');
  const kp = btn('bmgs-knob', { icon: 'left', label: '上一跨页' });
  const kn = btn('bmgs-knob', { icon: 'right', label: '下一跨页' });
  kp.disabled = cl.disabled; kn.disabled = cr.disabled;
  kp.onclick = () => go(-1); kn.onclick = () => go(1);
  const txt = mk('span', 'bmgs-placard-txt');
  txt.append('第', mk('b', '', state.bookPage + 1), '跨页 / 共 ' + spreads + ' 跨页');
  turn.append(kp, txt, kn);
  desk.appendChild(turn);
}

/* ───────────────────────── 快速总览 ───────────────────────── */
function renderWall(stage, env) {
  const { ctx, state, list } = env;
  const bar = mk('div', 'bmgs-wallbar');
  const chips = mk('div', 'bmgs-chips');
  env.folios.forEach((f) => {
    const c = btn('bmgs-chip', { text: f.label + ' ' + f.count });
    c.setAttribute('aria-pressed', String(f.key === state.activeFolio));
    c.onclick = () => env.setState({ activeFolio: f.key, wallIndex: 0, bookPage: 0 });
    chips.appendChild(c);
  });
  bar.appendChild(chips);
  const dens = mk('label', 'bmgs-density');
  dens.appendChild(mk('span', '', '行高'));
  const range = document.createElement('input');
  range.type = 'range'; range.min = '120'; range.max = '420'; range.step = '10';
  range.value = String(state.rowHeight || 240);
  range.setAttribute('aria-label', '行高');
  dens.appendChild(range);
  bar.appendChild(dens);
  const cap = btn('bmgs-toggle', { icon: 'label', text: '铭牌常显' });
  cap.setAttribute('aria-pressed', String(state.captionMode === 'always'));
  cap.onclick = () => env.setState({ captionMode: state.captionMode === 'always' ? 'hover' : 'always' });
  bar.appendChild(cap);
  stage.appendChild(bar);
  if (!list.length) { renderEmpty(stage, ctx, state.activeFolio !== 'all'); return; }

  const flow = mk('div', 'bmgs-flow');
  const applyRh = (v) => {
    const rh = clamp(Number(v) || 240, 120, 420);
    flow.style.setProperty('--rh', rh + 'px');
    flow.style.setProperty('--g', Math.round(rh / 26 + 2) + 'px');
  };
  applyRh(state.rowHeight);
  range.addEventListener('input', () => applyRh(range.value));
  range.addEventListener('change', () => { state.rowHeight = Number(range.value); ctx.onStateChange && ctx.onStateChange({ rowHeight: state.rowHeight }); });
  list.forEach((ill, index) => {
    const tile = mk('div', 'bmgs-tile');
    const a = aspectOf(ill);
    tile.style.setProperty('--ar', a.toFixed(3));
    if (a < 0.45 || a > 2.6) tile.dataset.tall = '1';
    loadImg(tile, ill, ctx, () => tile.style.setProperty('--ar', aspectOf(ill).toFixed(3)));
    const capEl = mk('div', 'bmgs-tile-cap');
    capEl.appendChild(mk('div', '', ill.title || '无题'));
    const sub = subLine(ill);
    if (sub) capEl.appendChild(mk('div', '', sub));
    tile.appendChild(capEl);
    if (ctx.onDeleteItem) tile.appendChild(unhangBtn(ill, ctx));
    bindPiece(tile, ill, list, index, ctx);
    flow.appendChild(tile);
  });
  stage.appendChild(flow);
}

/* ───────────────────────── 主入口 ───────────────────────── */
const MODES = [
  { key: 'salon', label: '展厅', icon: 'salon', tip: '展厅转角：在展墙前逐面漫步' },
  { key: 'book', label: '画集', icon: 'book', tip: '精装画集：摊开跨页翻阅' },
  { key: 'wall', label: '总览', icon: 'wall', tip: '快速总览：一眼扫完全部' }
];

function renderGallerySanctuary(hostEl, ctx) {
  if (!hostEl) return null;
  if (typeof hostEl.__bmgsCleanup === 'function') { try { hostEl.__bmgsCleanup(); } catch (_) { /* noop */ } }
  ctx = ctx || {};
  const state = ctx.state || (ctx.state = {});
  if (!MODES.some((m) => m.key === state.viewMode)) state.viewMode = 'salon';
  if (!state.activeFolio) state.activeFolio = 'all';
  if (state.captionMode !== 'always') state.captionMode = 'hover';
  if (!(state.rowHeight > 0)) state.rowHeight = 240;
  state.wallIndex = state.wallIndex | 0;
  state.bookPage = state.bookPage | 0;

  const source = ctx.filteredItems || ctx.items || ctx.allItems || [];
  const folios = (ctx.folios && ctx.folios.length) ? ctx.folios : [{ key: 'all', label: '全部', count: source.length }];
  if (!folios.some((f) => f.key === state.activeFolio)) state.activeFolio = 'all';
  const match = typeof ctx.matchFolio === 'function' ? ctx.matchFolio : matchFolio;

  hostEl.empty ? hostEl.empty() : (hostEl.innerHTML = '');
  const root = mk('div', 'bmgs-root');
  root.tabIndex = -1;
  root.dataset.motion = ctx.motionTier || 'full';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.dataset.motion = 'off';
  hostEl.appendChild(root);

  const env = { ctx, state, folios, list: [], dir: null, flip: null, anchorId: null, step: null, anchorProbe: null };
  let relayoutTimer = 0;

  const foyer = mk('div', 'bmgs-foyer');
  const sw = mk('div', 'bmgs-switch');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', '观看方式');
  const knob = mk('div', 'bmgs-switch-knob');
  sw.appendChild(knob);
  const modeBtns = MODES.map((m) => {
    const b = btn('', { icon: m.icon, text: m.label });
    b.title = m.tip;
    b.onclick = () => { if (m.key !== state.viewMode) env.setState({ viewMode: m.key }); };
    sw.appendChild(b);
    return { key: m.key, el: b };
  });
  foyer.appendChild(sw);
  const foyerMeta = mk('div', 'bmgs-foyer-meta');
  foyer.appendChild(foyerMeta);
  root.appendChild(foyer);

  const stage = mk('div', 'bmgs-stage');
  stage.style.display = 'flex';
  stage.style.flexDirection = 'column';
  stage.style.gap = '12px';
  stage.style.minWidth = '0';
  root.appendChild(stage);

  env.setState = (patch) => {
    const prevMode = state.viewMode;
    const prevFolio = state.activeFolio;
    if (patch.activeFolio && patch.activeFolio !== state.activeFolio) env.dir = null;
    Object.assign(state, patch);
    if (ctx.onStateChange) ctx.onStateChange(patch);
    if (patch.viewMode && patch.viewMode !== prevMode) {
      const i0 = MODES.findIndex((m) => m.key === prevMode);
      const i1 = MODES.findIndex((m) => m.key === patch.viewMode);
      draw(false, { modeSwapDir: i1 >= i0 ? 1 : -1 });
    } else if (patch.activeFolio && patch.activeFolio !== prevFolio) {
      draw(false, { folioSwap: true });
    } else {
      draw(false);
    }
  };
  env.onAspectShift = () => {
    window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => {
      if (!root.isConnected || state.viewMode === 'wall') return;
      env.anchorId = env.anchorProbe ? env.anchorProbe() : null;
      draw(true);
    }, 360);
  };

  function draw(quiet, animHint) {
    root.dataset.mode = state.viewMode;
    root.dataset.caption = state.captionMode;
    const curW = root.clientWidth || hostEl.clientWidth || 800;
    root.classList.toggle('is-narrow', curW <= 660);
    env.list = source.filter((ill) => match(ill, state.activeFolio));
    env.step = null;
    env.anchorProbe = null;

    knob.style.setProperty('--i', String(MODES.findIndex((m) => m.key === state.viewMode)));
    modeBtns.forEach((mb) => mb.el.setAttribute('aria-pressed', String(mb.key === state.viewMode)));
    foyerMeta.textContent = '';
    foyerMeta.appendChild(mk('span', 'bmgs-count', '本册 ' + env.list.length + ' 幅 · 馆藏 ' + source.length + ' 幅'));
    if (state.viewMode !== 'wall') {
      const capPin = btn('bmgs-foyer-pin', { icon: 'label', text: '铭牌常显' });
      capPin.title = '切换展墙/画集下方的标题铭牌是否常驻显示';
      capPin.setAttribute('aria-pressed', String(state.captionMode === 'always'));
      capPin.onclick = () => env.setState({ captionMode: state.captionMode === 'always' ? 'hover' : 'always' });
      foyerMeta.appendChild(capPin);
    }

    const paintStage = () => {
      stage.textContent = '';
      if (state.viewMode === 'book') renderBook(stage, env);
      else if (state.viewMode === 'wall') renderWall(stage, env);
      else renderSalon(stage, env);
    };

    if (!quiet && animHint && (animHint.modeSwapDir || animHint.folioSwap)) {
      paperSlipSwap(stage, paintStage, {
        dir: animHint.modeSwapDir || 1,
        small: true,
        frameless: true
      });
    } else {
      withPreservedScroll(stage, paintStage);
    }

    if (!quiet && env.dir) { root.dataset.dir = env.dir; }
    if (!quiet && env.flip) { root.dataset.flip = env.flip; }
    env.dir = null; env.flip = null;
    window.setTimeout(() => { delete root.dataset.dir; delete root.dataset.flip; }, 700);
  }

  const onKey = (ev) => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!env.step) return;
    if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { if (env.step(1)) ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { if (env.step(-1)) ev.preventDefault(); }
  };
  root.addEventListener('keydown', onKey);

  let lastW = Math.round(hostEl.clientWidth || 0), roTimer = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w <= 0) return;
    root.classList.toggle('is-narrow', w <= 660);
    if (Math.abs(w - lastW) < 24 || state.viewMode === 'wall') { lastW = w; return; }
    lastW = w;
    window.clearTimeout(roTimer);
    roTimer = window.setTimeout(() => {
      if (!root.isConnected) return;
      env.anchorId = env.anchorProbe ? env.anchorProbe() : null;
      draw(true);
    }, 180);
  }) : null;
  if (ro) ro.observe(root);

  draw(true);
  if (lastW < 60) {
    window.requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const measured = Math.round(root.clientWidth || hostEl.clientWidth || 0);
      if (measured >= 60 && Math.abs(measured - lastW) >= 24) {
        lastW = measured;
        draw(true);
      }
    });
  }

  const cleanup = () => {
    if (ro) ro.disconnect();
    window.clearTimeout(relayoutTimer);
    window.clearTimeout(roTimer);
    root.removeEventListener('keydown', onKey);
    if (hostEl.__bmgsCleanup === cleanup) hostEl.__bmgsCleanup = null;
  };
  hostEl.__bmgsCleanup = cleanup;
  return { root, refresh: () => draw(true), destroy: cleanup };
}

module.exports = {
  GALLERY_SANCTUARY_CSS: GALLERY_SANCTUARY_CSS + PART_CSS.join(''),
  renderGallerySanctuary
};
