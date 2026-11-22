/**
 * 本地视频关联 · 60fps 实时互动动画剧场（全画幅舞台 + FLIP 弹簧开合 + 主题光学色板适配）
 * ----------------------------------------------------------------------------
 * - 纯确定性 render(t) 函数（零 Math.random / Date.now），支持任意拖拽进度条与章节跳转；
 * - 实时读取容器上的 --bm7-* 样式令牌与当前外观 ID，自动适配 6 大档案馆主题与明/暗模式；
 * - 全流程真实物理拟音（默认静音，不打扰看番，点右下角喇叭可随时开声）；
 * - 点击顶栏「功能演示」按钮以 FLIP clip-path 弹簧变形展开，关闭时平滑原路收回。
 */
const v07Core = require("./v07-core.js");
const { createTheaterFoleyEngine } = require("./local-media-linker-sfx.js");

const TOTAL_DURATION = 34.0;
const LOGICAL_W = 1280;
const LOGICAL_H = 720;
const FONT_SANS = '"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace';

const CHAPTERS = [
  { id: "direct", label: "原地关联", start: 0.0, end: 6.2 },
  { id: "scan", label: "智能扫描", start: 6.2, end: 13.0 },
  { id: "staging", label: "暂存整理", start: 13.0, end: 20.4 },
  { id: "episode", label: "精确到集", start: 20.4, end: 27.6 },
  { id: "heal", label: "异常自愈", start: 27.6, end: 34.0 }
];

const FOLEY_CUES = [
  { t: 0.16, cue: "swipe", gain: 0.45, rate: 0.96 },
  { t: 2.65, cue: "chime", gain: 0.56, rate: 1.0 },
  { t: 7.10, cue: "click", gain: 0.68, rate: 1.0 },
  { t: 7.30, cue: "swipe", gain: 0.48, rate: 1.04 },
  { t: 8.50, cue: "popA", gain: 0.56, rate: 0.98 },
  { t: 8.72, cue: "popB", gain: 0.46, rate: 1.04 },
  { t: 8.88, cue: "popA", gain: 0.38, rate: 1.1 },
  { t: 9.95, cue: "popB", gain: 0.44, rate: 0.94 },
  { t: 14.30, cue: "press", gain: 0.62, rate: 1.0 },
  { t: 15.65, cue: "release", gain: 0.64, rate: 1.0 },
  { t: 15.72, cue: "popA", gain: 0.54, rate: 0.96 },
  { t: 15.92, cue: "popB", gain: 0.45, rate: 1.02 },
  { t: 16.08, cue: "popA", gain: 0.36, rate: 1.08 },
  { t: 16.90, cue: "chime", gain: 0.46, rate: 1.05 },
  { t: 21.85, cue: "swipe", gain: 0.42, rate: 1.06 },
  { t: 23.25, cue: "release", gain: 0.66, rate: 1.0 },
  { t: 23.30, cue: "popA", gain: 0.62, rate: 1.0 },
  { t: 28.35, cue: "click", gain: 0.68, rate: 1.0 },
  { t: 29.20, cue: "popB", gain: 0.58, rate: 1.0 },
  { t: 30.10, cue: "swipe", gain: 0.46, rate: 0.95 },
  { t: 31.60, cue: "chime", gain: 0.62, rate: 1.0 }
];

const THEATER_CSS = String.raw`
.bm-linker-shell .bm-lk-header,
.bm-linker-shell .bm-lk-body,
.bm-linker-shell .bm-lk-drive-banner,
.bm-linker-shell .bm-lk-remap-bar,
.bm-linker-shell .bm-lk-mobile-switch{
  transition:transform .42s cubic-bezier(.22,1,.36,1), filter .42s ease, opacity .36s ease;
  transform-origin:center center;
}
.bm-linker-shell.is-theater-open > .bm-lk-header,
.bm-linker-shell.is-theater-open > .bm-lk-body,
.bm-linker-shell.is-theater-open > .bm-lk-drive-banner,
.bm-linker-shell.is-theater-open > .bm-lk-remap-bar,
.bm-linker-shell.is-theater-open > .bm-lk-mobile-switch{
  transform:scale(.968);
  filter:blur(5px);
  opacity:.24;
  pointer-events:none;
}
.bm-linker-shell[data-bm7-motion="off"].is-theater-open > .bm-lk-header,
.bm-linker-shell[data-bm7-motion="off"].is-theater-open > .bm-lk-body,
.bm-linker-shell[data-bm7-motion-tier="off"].is-theater-open > .bm-lk-header,
.bm-linker-shell[data-bm7-motion-tier="off"].is-theater-open > .bm-lk-body{
  transform:none !important;
  filter:none !important;
  opacity:.18 !important;
}
.modal.bm-linker-modal-container.is-theater-open .modal-close-button,
.modal.bm-linker-modal-container.is-theater-open .modal-header-button,
.modal:has(.bm-linker-shell.is-theater-open) .modal-close-button,
.modal:has(.bm-linker-shell.is-theater-open) .modal-header-button,
.modal-container:has(.bm-linker-shell.is-theater-open) .modal-close-button,
.modal-container:has(.bm-linker-shell.is-theater-open) .modal-header-button{
  opacity:0 !important;
  visibility:hidden !important;
  pointer-events:none !important;
  transition:opacity .18s ease, visibility .18s ease !important;
}

.bm-lk-theater-overlay{
  position:absolute;
  inset:0;
  z-index:42;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:14px 16px;
  background:color-mix(in srgb, var(--bm7-bg, var(--background-primary)) 68%, rgb(8 10 16 / .62));
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  opacity:0;
  transition:opacity .26s ease !important;
}
.bm-lk-theater-overlay.is-visible{
  opacity:1;
}
.bm-linker-shell[data-bm7-motion="off"] .bm-lk-theater-overlay,
.bm-linker-shell[data-bm7-motion-tier="off"] .bm-lk-theater-overlay{
  transition:opacity .16s ease !important;
}
.bm-linker-shell[data-bm7-motion="off"] .bm-lk-theater-overlay .bm-lk-btn,
.bm-linker-shell[data-bm7-motion="off"] .bm-lk-theater-overlay .bm-lk-th-chap-btn,
.bm-linker-shell[data-bm7-motion-tier="off"] .bm-lk-theater-overlay .bm-lk-btn,
.bm-linker-shell[data-bm7-motion-tier="off"] .bm-lk-theater-overlay .bm-lk-th-chap-btn{
  transition:background .15s ease, color .15s ease, border-color .15s ease !important;
}
@media (prefers-reduced-motion: reduce){
  .bm-linker-shell .bm-lk-theater-overlay,
  .bm-linker-shell .bm-lk-theater-card{
    transition:none !important;
  }
}

.bm-lk-theater-card{
  position:relative;
  width:100%;
  max-width:1120px;
  height:min(738px, 100%);
  max-height:100%;
  display:flex;
  flex-direction:column;
  border-radius:16px;
  overflow:hidden;
  border:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 82%, var(--bm7-accent, var(--interactive-accent)) 18%);
  background:var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary)));
  box-shadow:0 28px 80px -18px rgb(0 0 0 / .58);
  will-change:clip-path, opacity;
}
.bm-linker-shell[data-bm7-theme="follow"] .bm-lk-theater-card{
  background:var(--background-primary);
}

.bm-lk-th-topbar{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:9px 14px;
  border-bottom:1px solid var(--bm7-line, var(--background-modifier-border));
  background:color-mix(in srgb, var(--bm7-surface-2, var(--background-secondary)) 70%, var(--bm7-surface, var(--background-primary)));
  min-width:0;
  opacity:0;
  transform:translateY(-6px);
  transition:opacity .28s ease .10s, transform .32s cubic-bezier(.22,1,.36,1) .10s !important;
}
.bm-lk-theater-overlay.is-settled .bm-lk-th-topbar{
  opacity:1;
  transform:translateY(0);
}
.bm-lk-th-chapters{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
  flex:1 1 auto;
  overflow-x:auto;
  scrollbar-width:none;
}
.bm-lk-th-chapters::-webkit-scrollbar{
  display:none;
}
.bm-linker-shell .bm-lk-th-chap-btn{
  position:relative;
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  gap:6px;
  height:28px !important;
  min-height:28px !important;
  padding:0 11px !important;
  border-radius:8px !important;
  border:1px solid transparent !important;
  background:transparent !important;
  color:var(--bm7-ink-2, var(--text-muted)) !important;
  font-size:12px !important;
  font-weight:620 !important;
  white-space:nowrap !important;
  overflow:hidden !important;
  cursor:pointer;
  flex:0 0 auto;
  transition:background .16s ease, color .16s ease, border-color .16s ease !important;
}
.bm-linker-shell .bm-lk-th-chap-btn:hover{
  background:var(--bm7-surface-3, var(--background-modifier-hover)) !important;
  color:var(--bm7-ink, var(--text-normal)) !important;
}
.bm-linker-shell .bm-lk-th-chap-btn.is-active{
  color:var(--bm7-accent, var(--interactive-accent)) !important;
  background:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 12%, transparent) !important;
  border-color:color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 30%, transparent) !important;
}
.bm-lk-th-chap-fill{
  position:absolute;
  left:0;
  right:0;
  bottom:0;
  height:2.5px;
  background:var(--bm7-accent, var(--interactive-accent));
  transform-origin:left center;
  transform:scaleX(0);
  pointer-events:none;
}

.bm-lk-th-stage-wrap{
  position:relative;
  flex:1 1 auto;
  min-height:200px;
  width:100%;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  container-type:size;
  background:var(--bm7-bg, var(--background-primary));
}
.bm-linker-shell[data-bm7-theme="follow"] .bm-lk-th-stage-wrap{
  background:var(--background-primary);
}
.bm-lk-th-stage-box{
  position:relative;
  width:min(100cqw, calc(100cqh * 16 / 9));
  height:min(100cqh, calc(100cqw * 9 / 16));
  max-width:100%;
  max-height:100%;
}
.bm-lk-th-canvas{
  display:block;
  width:100%;
  height:100%;
}

.bm-lk-th-outro-cta{
  position:absolute;
  left:50%;
  bottom:18px;
  transform:translate(-50%, 10px);
  z-index:5;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-wrap:wrap;
  gap:8px;
  padding:7px 10px;
  border-radius:12px;
  background:color-mix(in srgb, var(--bm7-panel-bg, var(--bm7-surface, var(--background-primary))) 88%, transparent);
  border:1px solid color-mix(in srgb, var(--bm7-line, var(--background-modifier-border)) 82%, var(--bm7-accent, var(--interactive-accent)) 18%);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  box-shadow:0 12px 30px -10px rgb(0 0 0 / .35);
  opacity:0;
  pointer-events:none;
  transition:opacity .30s ease, transform .30s cubic-bezier(.22,1,.36,1) !important;
}
.bm-lk-th-outro-cta.is-visible{
  opacity:1;
  transform:translate(-50%, 0);
  pointer-events:auto;
}

.bm-lk-th-controls{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:10px;
  padding:9px 14px;
  border-top:1px solid var(--bm7-line, var(--background-modifier-border));
  background:color-mix(in srgb, var(--bm7-surface-2, var(--background-secondary)) 72%, var(--bm7-surface, var(--background-primary)));
  min-width:0;
  opacity:0;
  transform:translateY(6px);
  transition:opacity .28s ease .12s, transform .32s cubic-bezier(.22,1,.36,1) .12s !important;
}
.bm-lk-theater-overlay.is-settled .bm-lk-th-controls{
  opacity:1;
  transform:translateY(0);
}

.bm-lk-th-scrub{
  position:relative;
  flex:1 1 auto;
  min-width:90px;
  height:24px;
  display:flex;
  align-items:center;
  cursor:pointer;
  touch-action:none;
}
.bm-lk-th-scrub-rail{
  position:relative;
  width:100%;
  height:6px;
  border-radius:999px;
  background:color-mix(in srgb, var(--bm7-ink, #666) 16%, transparent);
  overflow:visible;
}
.bm-lk-th-scrub-fill{
  position:absolute;
  left:0;
  top:0;
  bottom:0;
  width:0%;
  border-radius:999px;
  background:linear-gradient(90deg, var(--bm7-accent, var(--interactive-accent)), color-mix(in srgb, var(--bm7-accent, var(--interactive-accent)) 72%, #fff));
  pointer-events:none;
}
.bm-lk-th-scrub-tick{
  position:absolute;
  top:-2px;
  width:2px;
  height:10px;
  border-radius:2px;
  background:color-mix(in srgb, var(--bm7-surface, #fff) 75%, var(--bm7-ink, #333) 25%);
  transform:translateX(-1px);
  pointer-events:none;
}
.bm-lk-th-scrub-thumb{
  position:absolute;
  top:50%;
  left:0%;
  width:13px;
  height:13px;
  border-radius:50%;
  background:var(--bm7-accent, var(--interactive-accent));
  border:2px solid var(--bm7-surface, #fff);
  box-shadow:0 2px 6px rgb(0 0 0 / .35);
  transform:translate(-50%, -50%);
  pointer-events:none;
  transition:transform .12s ease !important;
}
.bm-lk-th-scrub:hover .bm-lk-th-scrub-thumb{
  transform:translate(-50%, -50%) scale(1.16);
}
.bm-lk-th-time{
  flex:0 0 auto;
  font-size:12px;
  font-weight:600;
  font-variant-numeric:tabular-nums;
  color:var(--bm7-ink-2, var(--text-muted));
  white-space:nowrap;
}

@media (max-width: 768px){
  .bm-lk-theater-overlay{
    padding:8px;
  }
  .bm-lk-theater-card{
    height:auto;
    max-height:100%;
    border-radius:14px;
  }
  .bm-lk-th-topbar{
    padding:8px 10px;
    gap:6px;
  }
  .bm-lk-th-stage-wrap{
    flex:0 0 auto;
    min-height:0;
    container-type:inline-size;
  }
  .bm-lk-th-stage-box{
    width:100%;
    height:auto;
    aspect-ratio:16 / 9;
  }
  .bm-lk-th-outro-cta{
    position:static;
    transform:none;
    width:100%;
    border-radius:0;
    border-left:none;
    border-right:none;
    border-bottom:none;
    padding:8px 10px;
    display:none;
    opacity:1;
    pointer-events:auto;
  }
  .bm-lk-th-outro-cta.is-visible{
    display:flex;
    transform:none;
  }
  .bm-lk-th-outro-cta .is-outro-replay{
    display:none !important;
  }
  .bm-lk-th-controls{
    flex-wrap:wrap;
    padding:8px 10px;
    gap:6px 8px;
  }
  .bm-lk-th-scrub{
    order:10;
    flex:1 1 100%;
  }
}
`;

/* ============================== 数学与色彩工具（100% 确定性） ============================== */

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, p) {
  return a + (b - a) * p;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(p) {
  const t = clamp(p, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(p) {
  const t = clamp(p, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutExpo(p) {
  const t = clamp(p, 0, 1);
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function springEval(tSec, response = 0.48, damping = 0.72) {
  if (tSec <= 0) return 0;
  if (tSec > response * 3.8) return 1;
  const omega = (2 * Math.PI) / Math.max(0.08, response);
  const decay = Math.exp(-damping * omega * tSec);
  if (damping < 1) {
    const wd = omega * Math.sqrt(1 - damping * damping);
    return 1 - decay * (Math.cos(wd * tSec) + (damping * omega / wd) * Math.sin(wd * tSec));
  }
  return 1 - decay * (1 + omega * tSec);
}

function hash01(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function parseColorStr(raw, fallback = [30, 34, 44, 1]) {
  const str = String(raw || "").trim();
  if (!str) return fallback ? fallback.slice() : null;
  const hex3 = str.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const h = hex3[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
  }
  const hex6 = str.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const h = hex6[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const hex8 = str.match(/^#([0-9a-f]{8})$/i);
  if (hex8) {
    const h = hex8[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      parseInt(h.slice(6, 8), 16) / 255
    ];
  }
  const rgb = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] !== undefined ? Number(rgb[4]) : 1];
  }
  return fallback ? fallback.slice() : null;
}

function withAlpha(colorInput, alpha) {
  const [r, g, b] = Array.isArray(colorInput) ? colorInput : parseColorStr(colorInput);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function mixColors(c1, c2, ratio) {
  const a = Array.isArray(c1) ? c1 : parseColorStr(c1);
  const b = Array.isArray(c2) ? c2 : parseColorStr(c2);
  const t = clamp(ratio, 0, 1);
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    lerp(a[3], b[3], t)
  ];
}

function colorLum(rgb) {
  const [r, g, b] = Array.isArray(rgb) ? rgb : parseColorStr(rgb);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function readLiveThemePalette(shellEl, ownerWin) {
  const win = ownerWin || window;
  const doc = shellEl?.ownerDocument || document;
  const themeId = shellEl?.getAttribute("data-bm7-theme") || "follow";
  const cs = shellEl && win.getComputedStyle ? win.getComputedStyle(shellEl) : null;
  const bodyCs = doc.body && win.getComputedStyle ? win.getComputedStyle(doc.body) : null;
  const getVar = (name, fb) => {
    const val = cs ? cs.getPropertyValue(name).trim() : "";
    return val || fb;
  };
  const isObsidianDark = Boolean(doc.body?.classList?.contains("theme-dark"));

  const probe = doc.createElement("span");
  probe.style.display = "none";
  if (shellEl) shellEl.appendChild(probe);

  const resolveColor = (rawCss, fallback) => {
    const val = String(rawCss || "").trim();
    if (!val || val === "transparent") return fallback.slice();
    const fast = parseColorStr(val, null);
    if (fast) return fast;
    if (probe.isConnected && win.getComputedStyle) {
      try {
        probe.style.color = "";
        probe.style.color = val;
        if (probe.style.color) {
          const computed = win.getComputedStyle(probe).color;
          const parsed = parseColorStr(computed, null);
          if (parsed) return parsed;
        }
      } catch (_) {}
    }
    return fallback.slice();
  };

  try {
    const surfaceFb = isObsidianDark ? [30, 32, 40, 1] : [255, 255, 255, 1];
    const surface = resolveColor(getVar("--bm7-surface", isObsidianDark ? "#1e2028" : "#ffffff"), surfaceFb);
    const bgRaw = getVar("--bm7-bg", "");
    const bgParsed =
      bgRaw && bgRaw !== "transparent" && !bgRaw.includes("0, 0, 0, 0")
        ? resolveColor(bgRaw, surface)
        : resolveColor(bodyCs?.backgroundColor || "", surface);
    const dark = themeId === "cinema" || (themeId === "follow" ? isObsidianDark : colorLum(surface) < 0.45);

    const surface2 = resolveColor(getVar("--bm7-surface-2", dark ? "#252936" : "#f3f5fa"), surface);
    const surface3 = resolveColor(getVar("--bm7-surface-3", dark ? "#2f3445" : "#e8ecf4"), surface2);
    const line = resolveColor(getVar("--bm7-line", dark ? "#383e52" : "#dce2ee"), [128, 128, 128, 0.25]);
    const ink = resolveColor(getVar("--bm7-ink", dark ? "#f1f3f9" : "#1f2430"), dark ? [241, 243, 249, 1] : [31, 36, 48, 1]);
    const ink2 = resolveColor(getVar("--bm7-ink-2", dark ? "#aeb6ca" : "#5b6478"), ink);
    const ink3 = resolveColor(getVar("--bm7-ink-3", dark ? "#7a849c" : "#8a94a8"), ink2);
    const accent = resolveColor(getVar("--bm7-accent", dark ? "#8c7cf0" : "#4361ee"), dark ? [140, 124, 240, 1] : [67, 97, 238, 1]);
    const accentInk = resolveColor(getVar("--bm7-accent-ink", "#ffffff"), [255, 255, 255, 1]);
    const ok = resolveColor(getVar("--bm7-ok", dark ? "#4cc38a" : "#2f9e6e"), [47, 158, 110, 1]);
    const live = resolveColor(getVar("--bm7-live", dark ? "#ff6b6f" : "#e5484d"), [229, 72, 77, 1]);
    const gold = resolveColor(getVar("--bm7-gold", dark ? "#e3b34f" : "#c6922a"), [198, 146, 42, 1]);

    const accentText = dark ? mixColors(accent, [255, 255, 255], 0.34) : accent;
    const okText = dark ? mixColors(ok, [255, 255, 255], 0.24) : ok;

    const solidSurface = surface[3] < 0.92 ? mixColors(bgParsed, surface, 0.78) : surface;
    const stageBgTop = mixColors(bgParsed, accent, dark ? 0.08 : 0.04);
    const stageBgBtm = mixColors(bgParsed, [0, 0, 0], dark ? 0.24 : 0.05);

    return {
      themeId,
      dark,
      bg: bgParsed,
      stageBgTop,
      stageBgBtm,
      surface: solidSurface,
      surface2,
      surface3,
      line,
      ink,
      ink2,
      ink3,
      accent,
      accentText,
      accentInk,
      ok,
      okText,
      live,
      gold
    };
  } finally {
    probe.remove();
  }
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ============================== 画布绘图原语 ============================== */

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
  }
  ctx.closePath();
}

function drawCardShell(ctx, P, x, y, w, h, opts = {}) {
  const r = opts.radius ?? 14;
  const fill = opts.fill || P.surface;
  const border = opts.border || P.line;
  const borderWidth = opts.borderWidth ?? 1.4;
  const shadowAlpha = opts.shadowAlpha ?? (P.dark ? 0.42 : 0.14);

  ctx.save();
  if (shadowAlpha > 0) {
    ctx.shadowColor = `rgba(0,0,0,${shadowAlpha.toFixed(3)})`;
    ctx.shadowBlur = opts.shadowBlur ?? 24;
    ctx.shadowOffsetY = opts.shadowY ?? 10;
  }
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = withAlpha(fill, opts.fillAlpha ?? 1);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  if (borderWidth > 0) {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = withAlpha(border, opts.borderAlpha ?? 0.9);
    ctx.stroke();
  }

  if (opts.topHighlight !== false) {
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1);
    ctx.lineTo(x + w - r, y + 1);
    ctx.strokeStyle = P.dark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSheenSweep(ctx, x, y, w, h, r, progress, alpha = 0.26) {
  if (progress <= 0 || progress >= 1) return;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const sweepX = lerp(x - w * 0.45, x + w * 1.45, progress);
  const g = ctx.createLinearGradient(sweepX - 90, y, sweepX + 90, y + h);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.48, `rgba(255,255,255,${alpha.toFixed(3)})`);
  g.addColorStop(0.55, `rgba(255,255,255,${(alpha * 0.85).toFixed(3)})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
  ctx.restore();
}

/**
 * 带可见 Z 轴厚度边与软地影的 3D 斜倾卡片（遵守 Q6 阅读角度与 Q7 体积感）
 */
function drawTilted3DCard(ctx, P, cx, cy, w, h, opts, drawInteriorFn) {
  const rotYDeg = opts.rotY ?? 0;
  const rotXDeg = opts.rotX ?? 0;
  const tiltDeg = opts.rotZ ?? 0;
  const depth = opts.depth ?? 14;
  const radY = (rotYDeg * Math.PI) / 180;
  const radX = (rotXDeg * Math.PI) / 180;
  const radZ = (tiltDeg * Math.PI) / 180;
  const scaleX = Math.max(0.45, Math.cos(radY));
  const scaleY = Math.max(0.65, Math.cos(radX));
  const skewY = Math.sin(radY) * 0.14;
  const extX = -Math.sin(radY) * depth * 1.15;
  const extY = Math.sin(radX) * depth + 4;
  const r = opts.radius ?? 14;

  ctx.save();
  ctx.translate(cx, cy);
  if (radZ) ctx.rotate(radZ);

  // 投射软地影
  ctx.save();
  ctx.translate(extX * 0.85, h * 0.52 + 22);
  ctx.scale(scaleX, 0.22);
  const sg = ctx.createRadialGradient(0, 0, w * 0.1, 0, 0, w * 0.65);
  sg.addColorStop(0, P.dark ? "rgba(0,0,0,0.52)" : "rgba(18,24,42,0.22)");
  sg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Z 轴立体厚度边
  ctx.save();
  ctx.translate(extX, extY);
  ctx.transform(scaleX, skewY, 0, scaleY, 0, 0);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = withAlpha(mixColors(opts.fill || P.surface, P.ink, P.dark ? 0.16 : 0.24), opts.alpha ?? 1);
  ctx.fill();
  ctx.strokeStyle = withAlpha(P.line, 0.7);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // 正面主体
  ctx.save();
  ctx.transform(scaleX, skewY, 0, scaleY, 0, 0);
  ctx.globalAlpha *= opts.alpha ?? 1;
  drawCardShell(ctx, P, -w / 2, -h / 2, w, h, {
    radius: r,
    fill: opts.fill || P.surface,
    border: opts.border || P.line,
    borderWidth: opts.borderWidth ?? 1.6,
    shadowAlpha: 0
  });
  if (typeof drawInteriorFn === "function") {
    drawInteriorFn(-w / 2, -h / 2, w, h);
  }
  if (opts.sheenProgress > 0 && opts.sheenProgress < 1) {
    drawSheenSweep(ctx, -w / 2, -h / 2, w, h, r, opts.sheenProgress, 0.28);
  }
  ctx.restore();

  ctx.restore();
}

function drawFolderIcon(ctx, x, y, size, color, fillAlpha = 0.22) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(2.5, 7);
  ctx.arcTo(2.5, 4.8, 4.7, 4.8, 2.2);
  ctx.lineTo(9.2, 4.8);
  ctx.lineTo(11.3, 7.1);
  ctx.lineTo(19.3, 7.1);
  ctx.arcTo(21.5, 7.1, 21.5, 9.3, 2.2);
  ctx.lineTo(21.5, 17.5);
  ctx.arcTo(21.5, 19.7, 19.3, 19.7, 2.2);
  ctx.lineTo(4.7, 19.7);
  ctx.arcTo(2.5, 19.7, 2.5, 17.5, 2.2);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, fillAlpha);
  ctx.fill();
  ctx.lineWidth = 1.9;
  ctx.strokeStyle = withAlpha(color, 1);
  ctx.stroke();
  ctx.restore();
}

function drawFilmIcon(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  roundRectPath(ctx, 3, 5, 18, 14, 2.5);
  ctx.fillStyle = withAlpha(color, 0.14);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 1);
  ctx.lineWidth = 1.85;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7.5, 5);
  ctx.lineTo(7.5, 19);
  ctx.moveTo(16.5, 5);
  ctx.lineTo(16.5, 19);
  ctx.moveTo(3, 9.8);
  ctx.lineTo(7.5, 9.8);
  ctx.moveTo(3, 14.2);
  ctx.lineTo(7.5, 14.2);
  ctx.moveTo(16.5, 9.8);
  ctx.lineTo(21, 9.8);
  ctx.moveTo(16.5, 14.2);
  ctx.lineTo(21, 14.2);
  ctx.stroke();
  ctx.restore();
}

function drawCheckBadge(ctx, cx, cy, r, bgColor, checkColor = "#ffffff", progress = 1) {
  if (progress <= 0.01) return;
  ctx.save();
  ctx.translate(cx, cy);
  const sc = springEval(progress * 0.48, 0.42, 0.65);
  ctx.scale(sc, sc);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(bgColor, 1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, r * 0.02);
  ctx.lineTo(-r * 0.1, r * 0.34);
  ctx.lineTo(r * 0.44, -r * 0.28);
  ctx.strokeStyle = typeof checkColor === "string" ? checkColor : withAlpha(checkColor, 1);
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawAnimeCoverArt(ctx, x, y, w, h, variant, P) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 9);
  ctx.clip();

  if (variant === 0) {
    // 蓝银星月苍穹（葬送的芙莉莲风格意象）
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#1c284d");
    g.addColorStop(0.55, "#36508f");
    g.addColorStop(1, "#7da3d9");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.beginPath();
    ctx.arc(x + w * 0.72, y + h * 0.26, w * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 245, 206, 0.9)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.78);
    ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.56, x + w, y + h * 0.72);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = "rgba(22, 34, 62, 0.75)";
    ctx.fill();

    // 苍月草发光小花点
    for (let i = 0; i < 6; i++) {
      const fx = x + w * (0.18 + hash01(i + 1) * 0.65);
      const fy = y + h * (0.66 + hash01(i + 11) * 0.24);
      ctx.beginPath();
      ctx.arc(fx, fy, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#b7e4ff";
      ctx.fill();
    }
  } else if (variant === 1) {
    // 粉色舞台跃动（孤独摇滚风格意象）
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#321830");
    g.addColorStop(0.55, "#b34272");
    g.addColorStop(1, "#f497b8");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = "rgba(255, 242, 184, 0.75)";
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y + h * 0.55, w * (0.18 + i * 0.14), 0.2, Math.PI * 1.45);
      ctx.stroke();
    }
  } else {
    // 暖金翡翠地城炉火（迷宫饭风格意象）
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#24332a");
    g.addColorStop(0.55, "#5c6f46");
    g.addColorStop(1, "#d59a4a");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.44, w * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 224, 152, 0.72)";
    ctx.fill();
  }

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = withAlpha(P.line, 0.5);
  roundRectPath(ctx, x, y, w, h, 9);
  ctx.stroke();
  ctx.restore();
}

function drawPill(ctx, cx, cy, text, bgColor, inkColor, borderColor = null, fontSize = 16, padX = 16, h = 34) {
  ctx.save();
  ctx.font = `650 ${fontSize}px ${FONT_SANS}`;
  const tw = ctx.measureText(text).width;
  const w = tw + padX * 2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = typeof bgColor === "string" ? bgColor : withAlpha(bgColor, 1);
  ctx.fill();
  if (borderColor) {
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = typeof borderColor === "string" ? borderColor : withAlpha(borderColor, 0.8);
    ctx.stroke();
  }
  ctx.fillStyle = typeof inkColor === "string" ? inkColor : withAlpha(inkColor, 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
  return w;
}

function drawHeadline(ctx, P, titleText, subText = "", alpha = 1, yOffset = 0, withScrim = false) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (withScrim) {
    const sg = ctx.createLinearGradient(0, 0, 0, 126);
    sg.addColorStop(0, withAlpha(P.stageBgTop, 0.94));
    sg.addColorStop(0.74, withAlpha(P.stageBgTop, 0.78));
    sg.addColorStop(1, withAlpha(P.stageBgTop, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, LOGICAL_W, 126);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 38px ${FONT_SANS}`;
  ctx.shadowColor = P.dark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.fillText(titleText, LOGICAL_W / 2, 62 + yOffset);
  ctx.shadowBlur = 0;

  if (subText) {
    drawPill(
      ctx,
      LOGICAL_W / 2,
      106 + yOffset,
      subText,
      withAlpha(P.accent, P.dark ? 0.22 : 0.12),
      withAlpha(P.accentText || P.accent, 1),
      withAlpha(P.accent, 0.44),
      15,
      16,
      30
    );
  }
  ctx.restore();
}

function drawGlowingFilament(ctx, x0, y0, cx0, cy0, cx1, cy1, x1, y1, drawProgress, P, seed = 1, colorOverride = null) {
  const p = clamp(drawProgress, 0, 1);
  if (p <= 0.01) return;
  const col = colorOverride || P.accent;
  const steps = 40;
  const maxStep = Math.max(1, Math.floor(steps * p));

  const evalPt = (u) => {
    const inv = 1 - u;
    return [
      inv * inv * inv * x0 + 3 * inv * inv * u * cx0 + 3 * inv * u * u * cx1 + u * u * u * x1,
      inv * inv * inv * y0 + 3 * inv * inv * u * cy0 + 3 * inv * u * u * cy1 + u * u * u * y1
    ];
  };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= maxStep; i++) {
    const u = (i / steps) * (p < 1 ? 1 : 1);
    if (u > p) break;
    const [px, py] = evalPt(u);
    ctx.lineTo(px, py);
  }
  const [tipX, tipY] = evalPt(p);
  ctx.lineTo(tipX, tipY);

  ctx.lineCap = "round";
  ctx.strokeStyle = withAlpha(col, 0.22);
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.strokeStyle = withAlpha(col, 0.92);
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // 光流微粒沿线行进
  if (p > 0.2) {
    const beadU = ((seed * 0.33 + performanceOrFixedBead(seed)) % 1) * p;
    const [bx, by] = evalPt(beadU);
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(col, 1);
  ctx.fill();
  ctx.restore();
}

let _currentFrameTime = 0;
function performanceOrFixedBead(seed) {
  return (_currentFrameTime * 0.72 + seed * 0.29) % 1;
}

function drawPrecisionCursor(ctx, x, y, P, opts = {}) {
  const pressed = Boolean(opts.pressed);
  const clickAge = opts.clickAge ?? -1; // >= 0 && < 0.45 时绘制收紧点击光圈
  const hoverProg = opts.hoverProgress ?? 0; // > 0 时围绕光标绘制悬停蓄力环
  const sc = pressed ? 0.82 : 1.0;

  ctx.save();
  ctx.translate(x, y);

  if (clickAge >= 0 && clickAge < 0.42) {
    const cp = clickAge / 0.42;
    const radius = lerp(26, 9, easeOutCubic(cp));
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(P.accent, (1 - cp * 0.75) * 0.85);
    ctx.lineWidth = 3;
    ctx.stroke();

    const expandR = lerp(8, 38, easeOutCubic(cp));
    ctx.beginPath();
    ctx.arc(0, 0, expandR, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(P.accent, (1 - cp) * 0.45);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (hoverProg > 0 && hoverProg < 1) {
    ctx.beginPath();
    ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hoverProg);
    ctx.strokeStyle = withAlpha(P.accent, 0.92);
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  if (pressed) {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(P.accent, 0.24);
    ctx.fill();
  }

  ctx.scale(sc, sc);
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 22);
  ctx.lineTo(5.6, 17.2);
  ctx.lineTo(10.2, 26.2);
  ctx.lineTo(13.6, 24.4);
  ctx.lineTo(9.0, 15.6);
  ctx.lineTo(16.2, 15.2);
  ctx.closePath();
  ctx.fillStyle = pressed ? withAlpha(P.accent, 1) : "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.9;
  ctx.strokeStyle = pressed ? "#ffffff" : "#181b24";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawBackdrop(ctx, P, t) {
  const g = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
  g.addColorStop(0, withAlpha(P.stageBgTop, 1));
  g.addColorStop(1, withAlpha(P.stageBgBtm, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 聚焦主光源柔和光晕
  const rg = ctx.createRadialGradient(LOGICAL_W * 0.5, LOGICAL_H * 0.44, 40, LOGICAL_W * 0.5, LOGICAL_H * 0.44, 660);
  rg.addColorStop(0, withAlpha(P.accent, P.dark ? 0.13 : 0.08));
  rg.addColorStop(1, withAlpha(P.accent, 0));
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.save();
  if (P.themeId === "roxy") {
    // 洛琪希手记：星轨双环与极淡墨线刻度
    ctx.translate(LOGICAL_W * 0.84, LOGICAL_H * 0.24);
    ctx.rotate(t * 0.05);
    ctx.strokeStyle = withAlpha(P.gold, 0.14);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 210, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 172, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (P.themeId === "cinema") {
    // 夜间影院：上方柔光放映光束 + 确定性漂浮微尘
    const cg = ctx.createLinearGradient(LOGICAL_W * 0.5, 0, LOGICAL_W * 0.5, LOGICAL_H * 0.85);
    cg.addColorStop(0, withAlpha(P.accent, 0.14));
    cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(LOGICAL_W * 0.34, 0);
    ctx.lineTo(LOGICAL_W * 0.66, 0);
    ctx.lineTo(LOGICAL_W * 0.92, LOGICAL_H);
    ctx.lineTo(LOGICAL_W * 0.08, LOGICAL_H);
    ctx.closePath();
    ctx.fillStyle = cg;
    ctx.fill();

    for (let i = 0; i < 24; i++) {
      const mx = (hash01(i + 3) * LOGICAL_W + t * (8 + hash01(i + 40) * 14)) % LOGICAL_W;
      const my = (hash01(i + 17) * LOGICAL_H + Math.sin(t * 0.7 + i) * 18 + LOGICAL_H) % LOGICAL_H;
      const mr = 1.2 + hash01(i + 80) * 1.8;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(P.gold, 0.24);
      ctx.fill();
    }
  } else if (P.themeId === "cel") {
    // 晴空画集：澄澈棱镜斜光带
    const pg = ctx.createLinearGradient(0, 0, LOGICAL_W, LOGICAL_H);
    pg.addColorStop(0, withAlpha(P.accent, 0.09));
    pg.addColorStop(0.5, "rgba(255,255,255,0)");
    pg.addColorStop(1, withAlpha(P.gold, 0.06));
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  } else {
    // 极简摄影棚点阵网格
    ctx.fillStyle = withAlpha(P.ink, P.dark ? 0.05 : 0.04);
    for (let gx = 96; gx <= LOGICAL_W - 96; gx += 64) {
      for (let gy = 148; gy <= LOGICAL_H - 64; gy += 64) {
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
      }
    }
  }
  ctx.restore();
}

/* ============================== 五幕分镜渲染 ============================== */

function renderScene1(ctx, P, t) {
  const lt = t; // 0.0 .. 6.2
  const enter = easeOutCubic(lt / 0.7);
  const exitP = smoothstep(5.75, 6.2, lt);
  const panOutX = -exitP * 240;
  const alpha = enter * (1 - exitP);

  drawHeadline(ctx, P, "视频留在原处，笔记照样直连播放", "不移动文件 · 不改原文件名", alpha, (1 - enter) * 10);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(panOutX, 0);

  const drives = [
    { label: "D:\\下载番剧", count: "24 个视频", y: 248, zIdx: 0, accent: P.accent },
    { label: "E:\\老番归档", count: "已分季 12 集", y: 378, zIdx: 1, accent: P.gold },
    { label: "F:\\移动硬盘", count: "OVA 与特典", y: 508, zIdx: 2, accent: P.ok }
  ];

  // 右侧动画笔记卡片
  const noteEnter = springEval(Math.max(0, lt - 0.35), 0.56, 0.76);
  const linkedP = smoothstep(2.45, 2.85, lt);
  const linkBounce = lt >= 2.65 ? Math.sin(clamp((lt - 2.65) / 0.32, 0, 1) * Math.PI) * 5 : 0;
  const noteX = lerp(980, 910, noteEnter) + linkBounce * 0.4;
  const noteY = 378;
  const noteRotY = lerp(-24, -14, easeInOutCubic(lt / 6.2));

  // 先绘连接光纤（在卡片底层下方自然汇入）
  const filProg = easeInOutCubic(clamp((lt - 1.55) / 1.15, 0, 1));
  if (filProg > 0.01) {
    drives.forEach((d, idx) => {
      const staggerP = clamp((filProg - idx * 0.14) / 0.72, 0, 1);
      drawGlowingFilament(
        ctx,
        460,
        d.y,
        590,
        d.y,
        660,
        noteY + (idx - 1) * 32,
        742,
        noteY + (idx - 1) * 24,
        staggerP,
        P,
        idx + 1,
        idx === 1 ? P.gold : P.accent
      );
    });
  }

  // 左侧三枚 3D 磁盘目录卡（带缓转与主角扫光）
  drives.forEach((d, idx) => {
    const cardSpr = springEval(Math.max(0, lt - idx * 0.12 - 0.1), 0.52, 0.74);
    const orbitRot = 24 - idx * 2 + Math.sin(lt * 0.8 + idx) * 2.5;
    const cx = lerp(190, 315, cardSpr);
    const sheenP = idx === 1 ? clamp((lt - 1.45) / 0.72, 0, 1) : 0;

    drawTilted3DCard(
      ctx,
      P,
      cx,
      d.y,
      304,
      104,
      {
        rotY: orbitRot,
        rotX: 5,
        depth: 13,
        alpha: cardSpr,
        fill: P.surface,
        border: idx === 1 && linkedP > 0.5 ? P.accent : P.line,
        sheenProgress: sheenP
      },
      (lx, ly, lw, lh) => {
        drawFolderIcon(ctx, lx + 20, ly + 26, 36, d.accent, 0.2);
        ctx.fillStyle = withAlpha(P.ink, 1);
        ctx.font = `700 20px ${FONT_MONO}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(d.label, lx + 68, ly + 40);

        ctx.fillStyle = withAlpha(P.ink2, 1);
        ctx.font = `500 15px ${FONT_SANS}`;
        ctx.fillText(d.count, lx + 68, ly + 70);

        // 右端连接端口亮灯
        ctx.beginPath();
        ctx.arc(lx + lw - 20, ly + lh / 2, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(d.accent, filProg > 0.2 ? 0.95 : 0.35);
        ctx.fill();
      }
    );
  });

  // 右侧 3D 动画笔记卡
  drawTilted3DCard(
    ctx,
    P,
    noteX,
    noteY,
    336,
    292,
    {
      rotY: noteRotY,
      rotX: 4,
      depth: 15,
      alpha: noteEnter,
      fill: P.surface,
      border: linkedP > 0.6 ? P.ok : P.line,
      sheenProgress: clamp((lt - 2.68) / 0.65, 0, 1)
    },
    (lx, ly, lw, lh) => {
      drawAnimeCoverArt(ctx, lx + 20, ly + 22, 92, 128, 0, P);

      ctx.fillStyle = withAlpha(P.ink, 1);
      ctx.font = `800 22px ${FONT_SANS}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("葬送的芙莉莲", lx + 126, ly + 28);

      ctx.fillStyle = withAlpha(P.ink2, 1);
      ctx.font = `500 15px ${FONT_SANS}`;
      ctx.fillText("2023 · 已看 8 / 28 集", lx + 126, ly + 62);

      // 状态指示胶囊
      const statusCol = mixColors(P.ink3, P.okText || P.ok, linkedP);
      roundRectPath(ctx, lx + 126, ly + 100, 146, 32, 16);
      ctx.fillStyle = withAlpha(statusCol, linkedP > 0.5 ? 0.18 : 0.1);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = withAlpha(statusCol, 0.48);
      ctx.stroke();

      ctx.fillStyle = withAlpha(statusCol, 1);
      ctx.font = `700 14px ${FONT_SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(linkedP > 0.5 ? "本地 12 集已就绪" : "等待关联本地视频", lx + 199, ly + 116);

      // 底部已连路径条
      for (let i = 0; i < 3; i++) {
        const rowY = ly + 168 + i * 34;
        roundRectPath(ctx, lx + 20, rowY, lw - 40, 26, 7);
        ctx.fillStyle = withAlpha(P.surface2, 1);
        ctx.fill();
        ctx.fillStyle = withAlpha(P.ink2, 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = `500 13.5px ${FONT_MONO}`;
        const tag = i === 0 ? "D:\\下载番剧" : i === 1 ? "E:\\老番归档" : "F:\\移动硬盘";
        ctx.fillText(tag, lx + 34, rowY + 13.5);

        if (linkedP > 0.5) {
          drawCheckBadge(ctx, lx + lw - 34, rowY + 13, 8.5, P.ok, "#fff", clamp((lt - 2.65 - i * 0.08) / 0.2, 0, 1));
        }
      }
    }
  );

  ctx.restore();
}

function renderScene2(ctx, P, t) {
  const lt = t - 6.2; // 0.0 .. 6.8
  const enter = easeOutCubic(lt / 0.55);
  const exitP = smoothstep(6.35, 6.8, lt);
  const alpha = enter * (1 - exitP);
  const panY = -exitP * 140;

  drawHeadline(ctx, P, "选好文件夹，批量自动对上号", "", alpha, (1 - enter) * 10);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, panY);

  // 左侧：扫描源目录卡 + 下方暂存区
  const leftX = 112;
  const leftW = 396;
  drawCardShell(ctx, P, leftX, 152, leftW, 312, { radius: 16 });
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `700 18px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("已选动画目录", leftX + 22, 184);

  const scanDirs = ["D:\\新番下载\\秋", "E:\\老番完结仓", "F:\\OVA收藏"];
  const beamSweep = clamp((lt - 1.05) / 1.35, 0, 1); // 7.25 .. 8.60

  scanDirs.forEach((dirPath, i) => {
    const ry = 212 + i * 54;
    const hitGlow = beamSweep > 0 && beamSweep < 1 ? Math.max(0, 1 - Math.abs(beamSweep - (0.2 + i * 0.24)) * 4.5) : 0;
    roundRectPath(ctx, leftX + 20, ry, leftW - 40, 44, 10);
    ctx.fillStyle = withAlpha(hitGlow > 0.1 ? mixColors(P.surface2, P.accent, hitGlow * 0.22) : P.surface2, 1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(hitGlow > 0.2 ? P.accent : P.line, 0.85);
    ctx.lineWidth = hitGlow > 0.2 ? 1.8 : 1.1;
    ctx.stroke();

    drawFolderIcon(ctx, leftX + 34, ry + 11, 22, P.accent, 0.22);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `600 14.5px ${FONT_MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(dirPath, leftX + 66, ry + 22);
  });

  // 扫描按钮（t = 0.90 点击）
  const clickT = lt - 0.9;
  const btnPress = clickT >= -0.05 && clickT < 0.14 ? 0.96 : 1.0;
  const scanStarted = lt >= 0.9;
  ctx.save();
  ctx.translate(leftX + leftW / 2, 418);
  ctx.scale(btnPress, btnPress);
  roundRectPath(ctx, -168, -22, 336, 44, 11);
  ctx.fillStyle = withAlpha(scanStarted ? P.ok : P.accent, 1);
  ctx.fill();
  ctx.fillStyle = withAlpha(P.accentInk, 1);
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(lt >= 2.6 ? "扫描完成" : scanStarted ? "正在匹配片名…" : "开始扫描", 0, 0);
  ctx.restore();

  // 下方暂存区接收托盘
  const dropLand = smoothstep(3.55, 3.85, lt);
  const trayBounce = lt >= 3.75 ? Math.sin(clamp((lt - 3.75) / 0.28, 0, 1) * Math.PI) * 5 : 0;
  drawCardShell(ctx, P, leftX, 492 + trayBounce, leftW, 136, {
    radius: 16,
    fill: mixColors(P.surface, P.accent, dropLand * 0.06),
    border: dropLand > 0.4 ? P.accent : P.line
  });
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("暂存区", leftX + 22, 520 + trayBounce);

  drawPill(
    ctx,
    leftX + leftW - 96,
    520 + trayBounce,
    "认不出的送进暂存区",
    withAlpha(P.surface2, 1),
    withAlpha(P.ink2, 1),
    withAlpha(P.line, 0.8),
    13,
    12,
    26
  );

  if (lt < 3.75) {
    const approach = smoothstep(2.85, 3.75, lt);
    ctx.save();
    roundRectPath(ctx, leftX + 20, 548 + trayBounce, leftW - 40, 58, 10);
    ctx.fillStyle = withAlpha(mixColors(P.surface2, P.gold, approach * 0.12), 0.72 + approach * 0.28);
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = withAlpha(approach > 0.2 ? mixColors(P.line, P.gold, approach) : P.line, 0.75 + approach * 0.2);
    ctx.lineWidth = 1.2 + approach * 0.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else {
    roundRectPath(ctx, leftX + 20, 548 + trayBounce, leftW - 40, 58, 10);
    ctx.fillStyle = withAlpha(P.surface2, 1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(P.accent, 0.5);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    drawFilmIcon(ctx, leftX + 34, 565 + trayBounce, 24, P.accent);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `600 14.5px ${FONT_MONO}`;
    ctx.textAlign = "left";
    ctx.fillText("SP_未命名特典.mkv", leftX + 68, 568 + trayBounce);
    ctx.fillStyle = withAlpha(P.ink2, 1);
    ctx.font = `500 13.5px ${FONT_SANS}`;
    ctx.fillText("已自动收进暂存区，稍后拖给对应动画", leftX + 68, 590 + trayBounce);
  }

  // 右侧：批量匹配结果面板
  const rightX = 548;
  const rightW = 620;
  drawCardShell(ctx, P, rightX, 152, rightW, 476, { radius: 16 });
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `700 19px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("自动识别结果", rightX + 24, 186);

  const badgeAlpha = smoothstep(2.4, 2.8, lt);
  if (badgeAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha *= badgeAlpha;
    drawPill(
      ctx,
      rightX + rightW - 92,
      186,
      "精准匹配 3 部",
      withAlpha(P.ok, 0.18),
      withAlpha(P.okText || P.ok, 1),
      withAlpha(P.ok, 0.44),
      14,
      14,
      30
    );
    ctx.restore();
  }

  // R2 硬加速错峰落位（2.10, 2.32, 2.48 => 绝对 8.30, 8.52, 8.68）
  const matches = [
    { name: "葬送的芙莉莲", info: "匹配 12 集 · [VCB-S] 目录", art: 0, start: 2.05 },
    { name: "孤独摇滚！", info: "匹配 12 集 · [SweetSub] 合集", art: 1, start: 2.27 },
    { name: "迷宫饭", info: "匹配 24 集 · D:\\新番下载\\秋", art: 2, start: 2.43 }
  ];

  matches.forEach((m, i) => {
    const mp = clamp((lt - m.start) / 0.36, 0, 1);
    if (mp <= 0) return;
    const ms = springEval(lt - m.start, 0.42, 0.72);
    const cardY = 222 + i * 96 + (1 - ms) * 18;
    ctx.save();
    ctx.globalAlpha *= clamp(mp * 1.4, 0, 1);
    roundRectPath(ctx, rightX + 22, cardY, rightW - 44, 82, 12);
    ctx.fillStyle = withAlpha(P.surface2, 1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(P.line, 0.85);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    drawAnimeCoverArt(ctx, rightX + 34, cardY + 11, 46, 60, m.art, P);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `700 19px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(m.name, rightX + 96, cardY + 30);

    ctx.fillStyle = withAlpha(P.ink2, 1);
    ctx.font = `500 14.5px ${FONT_SANS}`;
    ctx.fillText(m.info, rightX + 96, cardY + 56);

    drawCheckBadge(ctx, rightX + rightW - 56, cardY + 41, 14, P.ok, "#fff", clamp((lt - (m.start + 0.2)) / 0.25, 0, 1));
    ctx.restore();
  });

  // 未识别项沿发光弧线低空滑入左下暂存区槽位（lt 2.85 .. 3.75）
  if (lt >= 2.85 && lt <= 3.78) {
    const flyP = easeInOutCubic((lt - 2.85) / 0.9);
    const fx = lerp(850, leftX + leftW / 2, flyP);
    const fy = 577 - Math.sin(flyP * Math.PI) * 10;
    drawGlowingFilament(ctx, 850, 577, 700, 552, 460, 554, fx, fy, 1, P, 4, P.gold);
    drawTilted3DCard(
      ctx,
      P,
      fx,
      fy,
      268,
      54,
      { rotY: lerp(-12, 8, flyP), rotZ: -Math.sin(flyP * Math.PI) * 6, depth: 8, fill: P.surface, border: P.gold },
      (lx, ly, lw, lh) => {
        drawFilmIcon(ctx, lx + 14, ly + 15, 24, P.gold);
        ctx.fillStyle = withAlpha(P.ink, 1);
        ctx.font = `600 14.5px ${FONT_MONO}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("SP_未命名特典.mkv", lx + 46, ly + lh / 2);
      }
    );
  } else if (lt < 2.85 && lt >= 2.55) {
    const rowIn = springEval(lt - 2.55, 0.36, 0.78);
    ctx.save();
    ctx.globalAlpha *= clamp((lt - 2.55) / 0.25, 0, 1);
    roundRectPath(ctx, rightX + 22, 514 + (1 - rowIn) * 12, rightW - 44, 62, 12);
    ctx.fillStyle = withAlpha(mixColors(P.surface2, P.gold, 0.1), 1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(P.gold, 0.45);
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = withAlpha(P.ink2, 1);
    ctx.font = `600 15px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("待整理：SP_未命名特典.mkv  ->  准备送入暂存区", rightX + 42, 545 + (1 - rowIn) * 12);
    ctx.restore();
  }

  // 光学扫描体积光束
  if (beamSweep > 0 && beamSweep < 1) {
    const bx = lerp(leftX - 20, rightX + rightW + 20, easeInOutCubic(beamSweep));
    ctx.save();
    const bg = ctx.createLinearGradient(bx - 70, 0, bx + 20, 0);
    bg.addColorStop(0, withAlpha(P.accent, 0));
    bg.addColorStop(0.75, withAlpha(P.accent, 0.22));
    bg.addColorStop(1, withAlpha(P.accent, 0.55));
    ctx.fillStyle = bg;
    ctx.fillRect(bx - 70, 148, 90, 486);

    ctx.fillStyle = "#ffffff";
    for (let s = 0; s < 10; s++) {
      const sy = 175 + hash01(s + 5) * 430;
      const sx = bx - hash01(s + 21) * 18;
      ctx.globalAlpha = 0.7 * (1 - beamSweep * 0.2);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 虚拟光标操作「开始扫描」
  if (lt < 1.65) {
    const curMove = easeInOutCubic(clamp(lt / 0.85, 0, 1));
    const cx = lerp(680, leftX + leftW / 2 + 24, curMove);
    const cy = lerp(490, 422, curMove);
    drawPrecisionCursor(ctx, cx, cy, P, {
      pressed: lt >= 0.88 && lt <= 1.04,
      clickAge: lt >= 0.9 ? lt - 0.9 : -1
    });
  }

  ctx.restore();
}

function renderScene3(ctx, P, t) {
  const lt = t - 13.0; // 0.0 .. 7.4
  const enter = easeOutCubic(lt / 0.55);
  const exitP = smoothstep(6.95, 7.4, lt);
  const alpha = enter * (1 - exitP);
  const panOutX = -exitP * 260;

  drawHeadline(ctx, P, "先放进暂存区，随手整理随时保存", "", alpha, (1 - enter) * 10);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(panOutX, 0);

  const deckX = 240;
  const deckW = 800;

  // 上半区：电脑文件夹
  drawCardShell(ctx, P, deckX, 144, deckW, 206, { radius: 16 });
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("电脑文件夹", deckX + 22, 174);
  ctx.fillStyle = withAlpha(P.ink2, 1);
  ctx.font = `500 14px ${FONT_MONO}`;
  ctx.fillText("E:\\未整理新番\\2026\\某部新作\\", deckX + 128, 174);

  const selectedOn = lt >= 1.0 && lt < 2.65;
  const rows = [
    "[VCB-Studio] 某新番合集 - 01 [1080p].mkv",
    "[VCB-Studio] 某新番合集 - 02 [1080p].mkv",
    "[VCB-Studio] 某新番合集 - 03 [1080p].mkv"
  ];
  rows.forEach((label, idx) => {
    const ry = 198 + idx * 44;
    const sel = lt >= 0.72 + idx * 0.14 && lt < 2.8;
    roundRectPath(ctx, deckX + 20, ry, deckW - 40, 38, 9);
    ctx.fillStyle = withAlpha(sel ? mixColors(P.surface2, P.accent, 0.16) : P.surface2, 1);
    ctx.fill();
    ctx.strokeStyle = withAlpha(sel ? P.accent : P.line, sel ? 0.9 : 0.7);
    ctx.lineWidth = sel ? 1.5 : 1;
    ctx.stroke();

    drawFilmIcon(ctx, deckX + 34, ry + 8, 22, sel ? P.accent : P.ink2);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `600 14.5px ${FONT_MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, deckX + 66, ry + 19);
  });

  // 下半区：暂存区（每次落位产生 5px 物理下压回弹）
  let deckRecoil = 0;
  for (const dropT of [2.72, 2.92, 3.08]) {
    if (lt >= dropT && lt < dropT + 0.28) {
      deckRecoil += Math.sin(((lt - dropT) / 0.28) * Math.PI) * 5;
    }
  }
  const poolY = 374 + deckRecoil;
  const dragOver = lt >= 1.5 && lt < 2.68;
  drawCardShell(ctx, P, deckX, poolY, deckW, 222, {
    radius: 16,
    border: dragOver ? P.accent : P.line,
    borderWidth: dragOver ? 2.2 : 1.4,
    fill: dragOver ? mixColors(P.surface, P.accent, 0.05) : P.surface
  });

  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("暂存区", deckX + 22, poolY + 30);

  // 「已保存」绿标与右侧折叠标签
  const savedP = smoothstep(3.40, 3.78, lt);
  if (savedP > 0.01) {
    ctx.save();
    ctx.globalAlpha *= savedP;
    drawPill(
      ctx,
      deckX + 124,
      poolY + 30,
      "已保存",
      withAlpha(P.ok, 0.2),
      withAlpha(P.okText || P.ok, 1),
      withAlpha(P.ok, 0.48),
      13.5,
      12,
      26
    );
    ctx.restore();
  }

  const stackP = easeInOutCubic(clamp((lt - 3.35) / 0.52, 0, 1));
  if (lt < 2.7) {
    roundRectPath(ctx, deckX + 24, poolY + 56, deckW - 48, 140, 12);
    ctx.strokeStyle = withAlpha(dragOver ? P.accent : P.line, dragOver ? 0.9 : 0.65);
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = withAlpha(P.ink2, 1);
    ctx.font = `500 16px ${FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(dragOver ? "松手即可放入暂存区" : "把上方挑选好的视频拖进这里", deckX + deckW / 2, poolY + 126);
  } else if (stackP < 0.98) {
    // 3 张卡片依次弹落随后迅速向中间折叠
    for (let i = 0; i < 3; i++) {
      const landT = [2.72, 2.92, 3.08][i];
      if (lt < landT) continue;
      const sp = springEval(lt - landT, 0.34, 0.72);
      const yFrom = poolY + 60 + i * 44;
      const yTo = poolY + 74 + i * 6;
      const cy = lerp(yFrom, yTo, stackP) + (1 - sp) * -14;
      roundRectPath(ctx, deckX + 26 + stackP * 10 * i, cy, deckW - 52 - stackP * 20 * i, 38, 10);
      ctx.fillStyle = withAlpha(P.surface2, 1);
      ctx.fill();
      ctx.strokeStyle = withAlpha(P.accent, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = withAlpha(P.ink, 1);
      ctx.font = `600 14.5px ${FONT_MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(rows[i], deckX + 46, cy + 19);
    }
  } else {
    // 叠放成一叠 3D 厚叠卡组
    for (let layer = 2; layer >= 1; layer--) {
      roundRectPath(ctx, deckX + 34 + layer * 8, poolY + 68 + layer * 9, deckW - 68 - layer * 16, 86, 12);
      ctx.fillStyle = withAlpha(mixColors(P.surface2, P.ink, 0.05 * layer), 1);
      ctx.fill();
      ctx.strokeStyle = withAlpha(P.line, 0.8);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    drawCardShell(ctx, P, deckX + 26, poolY + 64, deckW - 52, 92, {
      radius: 12,
      fill: P.surface2,
      border: P.accent,
      borderWidth: 1.5,
      shadowAlpha: 0.14,
      shadowBlur: 14,
      shadowY: 6
    });
    drawFolderIcon(ctx, deckX + 46, poolY + 84, 38, P.accent, 0.22);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `700 18px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("某部新作 · 已选 3 集", deckX + 98, poolY + 96);
    ctx.fillStyle = withAlpha(P.ink2, 1);
    ctx.font = `500 14px ${FONT_MONO}`;
    ctx.fillText("E:\\未整理新番\\2026\\某部新作\\", deckX + 98, poolY + 126);

    drawPill(
      ctx,
      deckX + deckW - 126,
      poolY + 110,
      "同目录自动叠放",
      withAlpha(P.accent, 0.2),
      withAlpha(P.accentText || P.accent, 1),
      withAlpha(P.accent, 0.45),
      14,
      14,
      30
    );
  }

  // 底部安心提示
  if (savedP > 0.01) {
    ctx.save();
    ctx.globalAlpha *= savedP;
    drawPill(
      ctx,
      LOGICAL_W / 2,
      628,
      "关掉面板下次接着来",
      withAlpha(P.surface2, 0.98),
      withAlpha(P.ink, 1),
      withAlpha(P.accent, 0.42),
      15,
      18,
      34
    );
    ctx.restore();
  }

  // 光标拖拽弧线（lt 1.30 .. 2.65）
  if (lt >= 1.3 && lt <= 2.75) {
    const dragP = easeInOutCubic(clamp((lt - 1.35) / 1.25, 0, 1));
    const sx = deckX + 260;
    const sy = 256;
    const tx = deckX + 400;
    const ty = poolY + 114;
    const gx = lerp(sx, tx, dragP);
    const gy = lerp(sy, ty, dragP);
    drawGlowingFilament(ctx, sx, sy, sx + 80, sy + 50, tx - 60, ty - 40, gx, gy, 1, P, 7, P.accent);
    if (lt < 2.65) {
      drawTilted3DCard(
        ctx,
        P,
        gx,
        gy,
        244,
        54,
        { rotY: -10, rotZ: -4, depth: 8, fill: P.surface, border: P.accent },
        (lx, ly, lw, lh) => {
          drawFilmIcon(ctx, lx + 14, ly + 15, 24, P.accent);
          ctx.fillStyle = withAlpha(P.ink, 1);
          ctx.font = `700 15px ${FONT_SANS}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText("已选中 3 个视频", lx + 48, ly + lh / 2);
        }
      );
    }
    drawPrecisionCursor(ctx, gx + 12, gy + 10, P, {
      pressed: lt < 2.65,
      clickAge: lt >= 2.65 ? lt - 2.65 : -1
    });
  } else if (lt < 1.3) {
    const cp = easeInOutCubic(clamp(lt / 0.95, 0, 1));
    const cx = lerp(740, deckX + 260, cp);
    const cy = lerp(190, 256, cp);
    drawPrecisionCursor(ctx, cx, cy, P, { pressed: lt >= 1.25 });
  }

  ctx.restore();
}

function renderScene4(ctx, P, t) {
  const lt = t - 20.4; // 0.0 .. 7.2
  const enter = easeOutCubic(lt / 0.45);
  const exitP = smoothstep(6.75, 7.2, lt);
  const alpha = enter * (1 - exitP);

  // 世界级摄影机推进（保持卡片水平居中且顶端安全留白给上方标题）
  const dollyIn = easeInOutCubic(clamp((lt - 1.75) / 1.05, 0, 1));
  const dollyOut = easeInOutCubic(clamp((lt - 3.65) / 0.85, 0, 1));
  const camScale = 1 + dollyIn * 0.24 - dollyOut * 0.16;
  const camFocusX = lerp(640, 645, dollyIn);
  const camFocusY = lerp(388, 418, dollyIn);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, -exitP * 110);

  // 世界相机变换
  ctx.save();
  ctx.translate(LOGICAL_W / 2, LOGICAL_H / 2 + 24);
  ctx.scale(camScale, camScale);
  ctx.translate(-camFocusX, -camFocusY);

  const cardX = 350;
  const cardW = 580;
  const expandP = springEval(Math.max(0, lt - 1.45), 0.48, 0.76);
  const cardH = lerp(124, 344, expandP);
  const cardY = 216;
  const boundDone = lt >= 2.85;

  drawCardShell(ctx, P, cardX, cardY, cardW, cardH, {
    radius: 16,
    border: lt >= 0.9 && lt < 2.85 ? P.accent : boundDone ? P.ok : P.line,
    borderWidth: lt >= 0.9 ? 1.8 : 1.4
  });

  // 顶部动画信息头
  drawAnimeCoverArt(ctx, cardX + 20, cardY + 18, 60, 84, 0, P);
  ctx.fillStyle = withAlpha(P.ink, 1);
  ctx.font = `800 22px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("葬送的芙莉莲", cardX + 96, cardY + 42);

  ctx.fillStyle = withAlpha(P.ink2, 1);
  ctx.font = `500 15px ${FONT_SANS}`;
  ctx.fillText("共 28 集 · 已看 6 集", cardX + 96, cardY + 74);

  if (boundDone) {
    const doneSp = clamp((lt - 2.85) / 0.25, 0, 1);
    ctx.save();
    ctx.globalAlpha *= doneSp;
    drawPill(
      ctx,
      cardX + cardW - 102,
      cardY + 56,
      "第 07 集 · 已绑定",
      withAlpha(P.ok, 0.18),
      withAlpha(P.okText || P.ok, 1),
      withAlpha(P.ok, 0.46),
      14.5,
      14,
      30
    );
    ctx.restore();
  }

  // 展开 2x6 剧集胶片格
  if (expandP > 0.18) {
    ctx.save();
    ctx.globalAlpha *= clamp((expandP - 0.18) / 0.5, 0, 1);
    const gridX = cardX + 22;
    const gridY = cardY + 126;
    const cols = 6;
    const cellW = 82;
    const cellH = 68;
    const gap = 8;

    let slot7X = 0;
    let slot7Y = 0;

    for (let ep = 1; ep <= 12; ep++) {
      const c = (ep - 1) % cols;
      const r = Math.floor((ep - 1) / cols);
      const sx = gridX + c * (cellW + gap);
      const sy = gridY + r * (cellH + gap);
      const isSeven = ep === 7;
      if (isSeven) {
        slot7X = sx + cellW / 2;
        slot7Y = sy + cellH / 2;
      }
      const isWatched = ep <= 6;
      const isSevenHint = isSeven && !boundDone && lt >= 1.55;
      const pulse = isSevenHint ? 0.5 + 0.5 * Math.sin((lt - 1.55) * 9) : 0;

      roundRectPath(ctx, sx, sy, cellW, cellH, 10);
      if (isSeven && boundDone) {
        ctx.fillStyle = withAlpha(P.ok, 0.2);
        ctx.fill();
        ctx.strokeStyle = withAlpha(P.ok, 0.95);
        ctx.lineWidth = 2.2;
        ctx.stroke();
      } else if (isSevenHint) {
        ctx.fillStyle = withAlpha(P.accent, 0.14 + pulse * 0.12);
        ctx.fill();
        ctx.strokeStyle = withAlpha(P.accent, 0.95);
        ctx.lineWidth = 2.4;
        ctx.stroke();
      } else if (isWatched) {
        ctx.fillStyle = withAlpha(P.ok, 0.1);
        ctx.fill();
        ctx.strokeStyle = withAlpha(P.ok, 0.35);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = withAlpha(P.surface2, 1);
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = withAlpha(P.line, 0.9);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = withAlpha(
        isSeven && (isSevenHint || boundDone) ? (boundDone ? (P.okText || P.ok) : (P.accentText || P.accent)) : isWatched ? P.ink2 : P.ink3,
        1
      );
      ctx.font = `700 18px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(ep).padStart(2, "0"), sx + cellW / 2, sy + cellH / 2 - (isSeven && boundDone ? 6 : 0));

      if (isSeven && boundDone) {
        ctx.fillStyle = withAlpha(P.okText || P.ok, 1);
        ctx.font = `700 12px ${FONT_SANS}`;
        ctx.fillText("已绑", sx + cellW / 2, sy + cellH / 2 + 16);
      }
    }

    // 确认微粒礼花（确定性 hash01）
    if (lt >= 2.85 && lt < 3.65) {
      const bp = (lt - 2.85) / 0.8;
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + hash01(i + 3) * 0.25;
        const dist = lerp(8, 56 + hash01(i + 20) * 32, easeOutExpo(bp));
        const px = slot7X + Math.cos(ang) * dist;
        const py = slot7Y + Math.sin(ang) * dist;
        ctx.beginPath();
        ctx.arc(px, py, (1 - bp) * 3.8 + 0.8, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(i % 2 === 0 ? P.ok : P.accent, (1 - bp) * 0.9);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 被拖拽卡片 -> 悬停蓄力 -> 精准缩入 07 格（Q9 严禁悬停遮挡文字）
  const hoverPauseStart = 0.95;
  const hoverPauseEnd = 1.45;
  const slot7CenterX = cardX + 22 + 41;
  const slot7CenterY = cardY + 126 + 68 + 8 + 34;
  let dragX = 0;
  let dragY = 0;
  let dragScale = 1;
  let dragAlpha = 1;

  if (lt < hoverPauseStart) {
    const p = easeInOutCubic(lt / hoverPauseStart);
    dragX = lerp(160, 560, p);
    dragY = lerp(330, 272, p);
  } else if (lt < hoverPauseEnd) {
    dragX = 560;
    dragY = 272;
  } else if (lt < 2.85) {
    const p = easeInOutCubic((lt - hoverPauseEnd) / (2.85 - hoverPauseEnd));
    dragX = lerp(560, slot7CenterX, p);
    dragY = lerp(272, slot7CenterY, p);
    if (p > 0.72) {
      const shrink = (p - 0.72) / 0.28;
      dragScale = lerp(1, 0.36, shrink);
      dragAlpha = lerp(1, 0, shrink);
    }
  } else {
    dragAlpha = 0;
  }

  if (dragAlpha > 0.02) {
    ctx.save();
    ctx.translate(dragX, dragY);
    ctx.scale(dragScale, dragScale);
    drawTilted3DCard(
      ctx,
      P,
      0,
      0,
      230,
      54,
      { rotY: -8, rotZ: -3, depth: 8, alpha: dragAlpha, fill: P.surface, border: P.accent },
      (lx, ly, lw, lh) => {
        drawFilmIcon(ctx, lx + 14, ly + 15, 24, P.accent);
        ctx.fillStyle = withAlpha(P.ink, 1);
        ctx.font = `600 14.5px ${FONT_MONO}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("Frieren - 07.mkv", lx + 46, ly + lh / 2);
      }
    );
    ctx.restore();
  }

  if (lt < 3.45) {
    const curX = lt < 2.85 ? dragX + 14 : slot7CenterX + 14;
    const curY = lt < 2.85 ? dragY + 14 : slot7CenterY + 14;
    const hoverRing = lt >= hoverPauseStart && lt < hoverPauseEnd ? (lt - hoverPauseStart) / (hoverPauseEnd - hoverPauseStart) : 0;
    drawPrecisionCursor(ctx, curX, curY, P, {
      pressed: lt < 2.85,
      hoverProgress: hoverRing,
      clickAge: lt >= 2.85 ? lt - 2.85 : -1
    });
  }

  ctx.restore(); // 结束世界相机变换

  // 屏幕正上方文字置于摄影机图层之上（永不被放大卡片遮挡）
  drawHeadline(ctx, P, "拖到动画上停一停，直接绑进第 N 集", "", 1, (1 - enter) * 10, true);

  // 屏幕空间右下并行提示（不抢主焦点）
  const winHintP = smoothstep(4.2, 4.7, lt);
  if (winHintP > 0.01) {
    ctx.save();
    ctx.globalAlpha *= winHintP;
    const bx = 816;
    const by = 588 + (1 - winHintP) * 10;
    drawCardShell(ctx, P, bx, by, 344, 52, { radius: 12, fill: P.surface, border: P.line });
    drawFolderIcon(ctx, bx + 18, by + 13, 26, P.ink2, 0.16);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `600 15px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("也可随时用系统窗口选文件", bx + 54, by + 26);
    ctx.restore();
  }

  ctx.restore();
}

function renderScene5(ctx, P, t) {
  const lt = t - 27.6; // 0.0 .. 6.4

  // 第一段（0.0 .. 2.75）：顶栏红标一键直达右侧自愈修复
  const part1Fade = 1 - smoothstep(2.35, 2.75, lt);
  if (part1Fade > 0.01) {
    ctx.save();
    ctx.globalAlpha = part1Fade * easeOutCubic(lt / 0.42);
    drawHeadline(ctx, P, "路径失效或换盘符，点红标立刻修好", "", 1, 0);

    const fixed = lt >= 1.6;
    const barW = 860;
    const barX = (LOGICAL_W - barW) / 2;
    const barY = 176;
    drawCardShell(ctx, P, barX, barY, barW, 64, { radius: 14 });
    drawFilmIcon(ctx, barX + 24, barY + 19, 26, P.accent);
    ctx.fillStyle = withAlpha(P.ink, 1);
    ctx.font = `700 18px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("本地视频关联", barX + 60, barY + 32);

    const pillCol = fixed ? P.ok : P.live;
    const pillTxtCol = fixed ? (P.okText || P.ok) : P.live;
    const pillTxt = fixed ? "路径全部正常" : "有 2 处路径待确认";
    drawPill(
      ctx,
      barX + 314,
      barY + 32,
      pillTxt,
      withAlpha(pillCol, 0.18),
      withAlpha(pillTxtCol, 1),
      withAlpha(pillCol, 0.48),
      14.5,
      16,
      32
    );

    // 右侧滑出的修复卡片
    const panelP = springEval(Math.max(0, lt - 0.78), 0.44, 0.78);
    if (panelP > 0.01) {
      const px = barX + 340 + (1 - panelP) * 32;
      const py = 272;
      ctx.save();
      ctx.globalAlpha *= clamp((lt - 0.78) / 0.25, 0, 1);
      drawCardShell(ctx, P, px, py, 500, 198, { radius: 14, border: fixed ? P.ok : P.live });
      ctx.fillStyle = withAlpha(P.ink, 1);
      ctx.font = `700 17px ${FONT_SANS}`;
      ctx.textAlign = "left";
      ctx.fillText("路径待确认", px + 24, py + 34);

      roundRectPath(ctx, px + 22, py + 62, 456, 110, 11);
      ctx.fillStyle = withAlpha(P.surface2, 1);
      ctx.fill();
      ctx.fillStyle = withAlpha(P.ink, 1);
      ctx.font = `700 16px ${FONT_SANS}`;
      ctx.fillText("葬送的芙莉莲 · 主文件夹", px + 38, py + 94);

      ctx.fillStyle = withAlpha(fixed ? P.ok : P.live, 1);
      ctx.font = `600 14.5px ${FONT_MONO}`;
      ctx.fillText(fixed ? "已修正为  F:\\Anime\\Frieren" : "丢失路径  E:\\Anime\\Frieren", px + 38, py + 126);

      drawPill(
        ctx,
        px + 392,
        py + 116,
        fixed ? "已恢复" : "一键修正",
        withAlpha(fixed ? P.ok : P.accent, fixed ? 0.16 : 1),
        fixed ? withAlpha(P.ok, 1) : withAlpha(P.accentInk, 1),
        null,
        14,
        14,
        30
      );
      ctx.restore();
    }

    if (lt < 1.85) {
      const cp = easeInOutCubic(clamp(lt / 0.72, 0, 1));
      const click2 = lt >= 1.5;
      const cx = click2 ? barX + 340 + 392 : lerp(barX + 120, barX + 314, cp);
      const cy = click2 ? 272 + 116 : lerp(310, barY + 34, cp);
      drawPrecisionCursor(ctx, cx, cy, P, {
        pressed: (lt >= 0.73 && lt <= 0.86) || (lt >= 1.56 && lt <= 1.7),
        clickAge: lt >= 1.58 ? lt - 1.58 : lt >= 0.75 ? lt - 0.75 : -1
      });
    }
    ctx.restore();
  }

  // 第二段（2.50 .. 6.40 => 含最后 1.8s 100% 真静止定格！）：四方汇聚终幕
  if (lt >= 2.45) {
    const fTime = lt - 2.45; // 0 .. 3.95; hold starts at fTime >= 2.15 (lt >= 4.60, abs t >= 32.2s)
    const finAlpha = smoothstep(0, 0.55, fTime);
    drawHeadline(ctx, P, "散落各处的收藏，一处顺手看完", "", finAlpha, 0);

    const cards = [
      { title: "点开即播", sub: "双击直唤本地播放器", sx: 140, sy: 180, tx: 292, ty: 248, rotY: 14, tint: P.accent, delay: 0.12 },
      { title: "单集切换", sub: "精确记住所选第 N 集", sx: 1140, sy: 180, tx: 988, ty: 248, rotY: -14, tint: P.ok, delay: 0.22 },
      { title: "随机抽番", sub: "本地已就绪立刻开看", sx: 140, sy: 560, tx: 292, ty: 452, rotY: 12, tint: P.gold, delay: 0.30 },
      { title: "台词截图", sub: "自动绑定时间线跳转", sx: 1140, sy: 560, tx: 988, ty: 452, rotY: -12, tint: P.accent, delay: 0.38 }
    ];

    const heroSpr = springEval(Math.max(0, fTime - 0.18), 0.54, 0.78);
    const settleHold = fTime >= 2.15; // 真静止锚点

    // 中心拱卫总卡（无晃动）
    const sheenFinal = !settleHold ? clamp((fTime - 1.55) / 0.55, 0, 1) : 0;
    drawTilted3DCard(
      ctx,
      P,
      LOGICAL_W / 2,
      352,
      332,
      244,
      {
        rotY: 0,
        rotX: 3,
        depth: 12,
        alpha: finAlpha * heroSpr,
        fill: P.surface,
        border: P.accent,
        borderWidth: 1.8,
        sheenProgress: sheenFinal
      },
      (lx, ly, lw, lh) => {
        drawAnimeCoverArt(ctx, lx + 24, ly + 24, 92, 128, 0, P);
        drawAnimeCoverArt(ctx, lx + 124, ly + 36, 78, 108, 1, P);
        drawAnimeCoverArt(ctx, lx + 210, ly + 28, 86, 120, 2, P);
        drawPill(
          ctx,
          lx + lw / 2,
          ly + lh - 40,
          "原路径零改动 · 全馆随时可播",
          withAlpha(P.accent, 0.2),
          withAlpha(P.accentText || P.accent, 1),
          withAlpha(P.accent, 0.44),
          14.5,
          16,
          32
        );
      }
    );

    cards.forEach((c) => {
      const p = settleHold ? 1 : springEval(Math.max(0, fTime - c.delay), 0.48, 0.76);
      const cx = lerp(c.sx, c.tx, p);
      const cy = lerp(c.sy, c.ty, p);
      drawTilted3DCard(
        ctx,
        P,
        cx,
        cy,
        244,
        118,
        {
          rotY: c.rotY,
          rotX: 3,
          depth: 10,
          alpha: finAlpha * clamp(p * 1.4, 0, 1),
          fill: P.surface,
          border: P.line
        },
        (lx, ly, lw, lh) => {
          ctx.beginPath();
          ctx.arc(lx + 34, ly + 42, 16, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(c.tint, 0.16);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(lx + 34, ly + 42, 6, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(c.tint, 1);
          ctx.fill();

          ctx.fillStyle = withAlpha(P.ink, 1);
          ctx.font = `800 20px ${FONT_SANS}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(c.title, lx + 62, ly + 42);

          ctx.fillStyle = withAlpha(P.ink2, 1);
          ctx.font = `500 14.5px ${FONT_SANS}`;
          ctx.fillText(c.sub, lx + 24, ly + 86);
        }
      );
    });
  }
}

/* ============================== 互动放映台控制器 ============================== */

class LocalMediaLinkerTheater {
  constructor(shellEl, options = {}) {
    this.shellEl = shellEl;
    this.ownerDoc = shellEl?.ownerDocument || document;
    this.ownerWin = this.ownerDoc?.defaultView || window;
    this.options = options || {};

    this.overlayEl = null;
    this.cardEl = null;
    this.stageBoxEl = null;
    this.canvasEl = null;
    this.ctx = null;
    this.sourceEl = null;
    this.modalContainerEl =
      options.modalEl || (shellEl?.closest ? shellEl.closest(".modal, .modal-container") : null);
    this.chapWrapEl = null;
    this.lastActiveChapIdx = -1;

    this.chapterBtns = [];
    this.chapterFills = [];
    this.playBtn = null;
    this.muteBtn = null;
    this.scrubEl = null;
    this.scrubFillEl = null;
    this.scrubThumbEl = null;
    this.timeEl = null;
    this.outroCtaEl = null;

    this.foley = createTheaterFoleyEngine(this.ownerWin);
    this.muted = true;
    this.playing = false;
    this.currentTime = 0;
    this.lastFrameMs = 0;
    this.rafId = 0;
    this.resizeObs = null;
    this.keyHandler = null;
    this.isOpen = false;
    this.isClosing = false;
    this.scrubbing = false;
    this.cachedPalette = null;
  }

  isReducedMotion() {
    const attrOff =
      this.shellEl?.getAttribute("data-bm7-motion") === "off" ||
      this.shellEl?.getAttribute("data-bm7-motion-tier") === "off";
    const sysOff = Boolean(
      this.ownerWin?.matchMedia && this.ownerWin.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    return attrOff || sysOff;
  }

  computeOriginClipPath(sourceEl) {
    if (!sourceEl || !this.shellEl || !this.cardEl) return null;
    try {
      const sr = sourceEl.getBoundingClientRect();
      const cr = this.cardEl.getBoundingClientRect();
      if (!sr.width || !cr.width || !cr.height) return null;
      const top = Math.max(0, sr.top - cr.top);
      const right = Math.max(0, cr.right - sr.right);
      const bottom = Math.max(0, cr.bottom - sr.bottom);
      const left = Math.max(0, sr.left - cr.left);
      return `inset(${top.toFixed(1)}px ${right.toFixed(1)}px ${bottom.toFixed(1)}px ${left.toFixed(1)}px round 999px)`;
    } catch (_) {
      return null;
    }
  }

  open(sourceEl) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.isClosing = false;
    this.sourceEl = sourceEl || null;
    this.currentTime = 0;
    this.playing = true;
    this.lastFrameMs = 0;
    this.cachedPalette = readLiveThemePalette(this.shellEl, this.ownerWin);

    this.buildDom();
    this.resizeCanvas();
    this.renderAt(0);

    const reduced = this.isReducedMotion();
    this.shellEl.classList.add("is-theater-open");
    this.modalContainerEl?.classList.add("is-theater-open");

    if (reduced) {
      this.overlayEl.classList.add("is-visible", "is-settled");
      this.cardEl.style.transition = "opacity .16s ease";
      this.cardEl.style.opacity = "0";
      void this.cardEl.offsetWidth;
      this.cardEl.style.opacity = "1";
    } else {
      const startClip = this.computeOriginClipPath(this.sourceEl);
      this.cardEl.style.transition = "none";
      this.cardEl.style.clipPath = startClip || "inset(18% 20% 24% 20% round 18px)";
      this.cardEl.style.opacity = "0.72";
      void this.cardEl.offsetWidth;

      this.overlayEl.classList.add("is-visible");
      this.cardEl.style.transition =
        "clip-path .44s cubic-bezier(.22,1,.36,1), opacity .26s ease";
      this.cardEl.style.clipPath = "inset(0px 0px 0px 0px round 16px)";
      this.cardEl.style.opacity = "1";

      setTimeout(() => {
        if (this.isOpen && !this.isClosing && this.overlayEl) {
          this.overlayEl.classList.add("is-settled");
          if (this.cardEl) this.cardEl.style.clipPath = "";
        }
      }, 240);
    }

    this.bindEvents();
    this.startLoop();
  }

  close(afterCloseAction = null) {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;
    this.playing = false;
    if (this.rafId) {
      this.ownerWin.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    const finalize = () => {
      this.destroy();
      if (typeof afterCloseAction === "function") {
        afterCloseAction();
      }
    };

    const reduced = this.isReducedMotion();
    this.shellEl?.classList.remove("is-theater-open");
    this.modalContainerEl?.classList.remove("is-theater-open");
    this.overlayEl?.classList.remove("is-settled");

    if (reduced || !this.cardEl || !this.overlayEl) {
      if (this.overlayEl) {
        this.overlayEl.classList.remove("is-visible");
        setTimeout(finalize, 160);
      } else {
        finalize();
      }
      return;
    }

    const endClip = this.computeOriginClipPath(this.sourceEl);
    this.overlayEl.classList.remove("is-visible");
    this.cardEl.style.transition =
      "clip-path .30s cubic-bezier(.4,0,.2,1), opacity .26s ease";
    this.cardEl.style.clipPath = endClip || "inset(18% 20% 24% 20% round 18px)";
    this.cardEl.style.opacity = "0";
    setTimeout(finalize, 310);
  }

  destroy() {
    this.isOpen = false;
    this.isClosing = false;
    this.playing = false;
    if (this.rafId) {
      this.ownerWin.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.resizeObs) {
      try {
        this.resizeObs.disconnect();
      } catch (_) {}
      this.resizeObs = null;
    }
    if (this.keyHandler) {
      this.ownerWin.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
    this.foley.dispose();
    this.shellEl?.classList.remove("is-theater-open");
    this.modalContainerEl?.classList.remove("is-theater-open");
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.cardEl = null;
    this.canvasEl = null;
    this.ctx = null;
  }

  buildDom() {
    const doc = this.ownerDoc;
    this.overlayEl = doc.createElement("div");
    this.overlayEl.className = "bm-lk-theater-overlay";
    this.overlayEl.addEventListener("click", (ev) => {
      if (ev.target === this.overlayEl) {
        this.close();
      }
    });

    this.cardEl = doc.createElement("div");
    this.cardEl.className = "bm-lk-theater-card";
    this.overlayEl.appendChild(this.cardEl);

    // 顶栏章节 + 返回工作台
    const topbar = doc.createElement("div");
    topbar.className = "bm-lk-th-topbar";
    const chapWrap = doc.createElement("div");
    chapWrap.className = "bm-lk-th-chapters";
    this.chapWrapEl = chapWrap;
    this.lastActiveChapIdx = -1;
    this.chapterBtns = [];
    this.chapterFills = [];

    CHAPTERS.forEach((ch) => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "bm-lk-th-chap-btn";
      btn.textContent = ch.label;
      const fill = doc.createElement("span");
      fill.className = "bm-lk-th-chap-fill";
      btn.appendChild(fill);
      btn.onclick = () => {
        this.seekTo(ch.start);
        this.setPaused(false);
      };
      chapWrap.appendChild(btn);
      this.chapterBtns.push(btn);
      this.chapterFills.push(fill);
    });
    topbar.appendChild(chapWrap);

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "bm-lk-btn is-sm";
    closeBtn.appendChild(v07Core.icon("close", 13));
    const closeLbl = doc.createElement("span");
    closeLbl.textContent = "返回工作台";
    closeBtn.appendChild(closeLbl);
    closeBtn.onclick = () => this.close();
    topbar.appendChild(closeBtn);
    this.cardEl.appendChild(topbar);

    // 16:9 舞台画布容器
    const stageWrap = doc.createElement("div");
    stageWrap.className = "bm-lk-th-stage-wrap";
    this.stageBoxEl = doc.createElement("div");
    this.stageBoxEl.className = "bm-lk-th-stage-box";
    this.canvasEl = doc.createElement("canvas");
    this.canvasEl.className = "bm-lk-th-canvas";
    this.ctx = this.canvasEl.getContext("2d");
    this.stageBoxEl.appendChild(this.canvasEl);

    // 终幕交互跳转栏（仅 t >= 32.3s 出现）
    this.outroCtaEl = doc.createElement("div");
    this.outroCtaEl.className = "bm-lk-th-outro-cta";
    const tryScanBtn = doc.createElement("button");
    tryScanBtn.type = "button";
    tryScanBtn.className = "bm-lk-btn is-sm is-primary";
    tryScanBtn.textContent = "试试智能扫描";
    tryScanBtn.onclick = () => this.close(() => this.options.onTrySmartScan?.());

    const backWorkBtn = doc.createElement("button");
    backWorkBtn.type = "button";
    backWorkBtn.className = "bm-lk-btn is-sm";
    backWorkBtn.textContent = "回到工作台";
    backWorkBtn.onclick = () => this.close(() => this.options.onReturnWorkbench?.());

    const replayCtaBtn = doc.createElement("button");
    replayCtaBtn.type = "button";
    replayCtaBtn.className = "bm-lk-btn is-sm is-ghost is-outro-replay";
    replayCtaBtn.textContent = "重播";
    replayCtaBtn.onclick = () => this.replay();

    this.outroCtaEl.appendChild(tryScanBtn);
    this.outroCtaEl.appendChild(backWorkBtn);
    this.outroCtaEl.appendChild(replayCtaBtn);
    this.stageBoxEl.appendChild(this.outroCtaEl);

    stageWrap.appendChild(this.stageBoxEl);
    this.cardEl.appendChild(stageWrap);

    // 底部控制条
    const controls = doc.createElement("div");
    controls.className = "bm-lk-th-controls";

    this.playBtn = doc.createElement("button");
    this.playBtn.type = "button";
    this.playBtn.className = "bm-lk-btn is-sm";
    this.playBtn.onclick = () => {
      if (this.currentTime >= TOTAL_DURATION - 0.05) {
        this.replay();
      } else {
        this.setPaused(this.playing);
      }
    };
    controls.appendChild(this.playBtn);

    const replayBtn = doc.createElement("button");
    replayBtn.type = "button";
    replayBtn.className = "bm-lk-btn is-sm is-ghost";
    replayBtn.appendChild(v07Core.icon("reset", 13));
    const replaySpan = doc.createElement("span");
    replaySpan.textContent = "重播";
    replayBtn.appendChild(replaySpan);
    replayBtn.onclick = () => this.replay();
    controls.appendChild(replayBtn);

    this.scrubEl = doc.createElement("div");
    this.scrubEl.className = "bm-lk-th-scrub";
    const rail = doc.createElement("div");
    rail.className = "bm-lk-th-scrub-rail";
    this.scrubFillEl = doc.createElement("div");
    this.scrubFillEl.className = "bm-lk-th-scrub-fill";
    rail.appendChild(this.scrubFillEl);

    CHAPTERS.slice(1).forEach((ch) => {
      const tick = doc.createElement("span");
      tick.className = "bm-lk-th-scrub-tick";
      tick.style.left = `${(ch.start / TOTAL_DURATION) * 100}%`;
      rail.appendChild(tick);
    });

    this.scrubThumbEl = doc.createElement("div");
    this.scrubThumbEl.className = "bm-lk-th-scrub-thumb";
    rail.appendChild(this.scrubThumbEl);
    this.scrubEl.appendChild(rail);
    controls.appendChild(this.scrubEl);

    this.timeEl = doc.createElement("div");
    this.timeEl.className = "bm-lk-th-time";
    controls.appendChild(this.timeEl);

    this.muteBtn = doc.createElement("button");
    this.muteBtn.type = "button";
    this.muteBtn.className = "bm-lk-btn is-sm";
    this.muteBtn.onclick = async () => {
      this.muted = !this.muted;
      this.syncControlsUi();
      await this.foley.setMuted(this.muted);
    };
    controls.appendChild(this.muteBtn);

    this.cardEl.appendChild(controls);
    this.shellEl.appendChild(this.overlayEl);
    this.syncControlsUi();
  }

  bindEvents() {
    const scrubAtPointer = (ev) => {
      if (!this.scrubEl) return;
      const r = this.scrubEl.getBoundingClientRect();
      if (!r.width) return;
      const ratio = clamp((ev.clientX - r.left) / r.width, 0, 1);
      this.seekTo(ratio * TOTAL_DURATION);
    };
    this.scrubEl?.addEventListener("pointerdown", (ev) => {
      this.scrubbing = true;
      try {
        this.scrubEl.setPointerCapture(ev.pointerId);
      } catch (_) {}
      scrubAtPointer(ev);
    });
    this.scrubEl?.addEventListener("pointermove", (ev) => {
      if (this.scrubbing) scrubAtPointer(ev);
    });
    const endScrub = () => {
      this.scrubbing = false;
    };
    this.scrubEl?.addEventListener("pointerup", endScrub);
    this.scrubEl?.addEventListener("pointercancel", endScrub);

    const ResizeObs = this.ownerWin.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObs && this.stageBoxEl) {
      this.resizeObs = new ResizeObs(() => {
        this.resizeCanvas();
        this.renderAt(this.currentTime);
      });
      this.resizeObs.observe(this.stageBoxEl);
    }

    this.keyHandler = (ev) => {
      if (!this.isOpen) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
      } else if (ev.key === " " || ev.code === "Space") {
        const tag = (ev.target?.tagName || "").toLowerCase();
        if (tag === "button" || tag === "input") return;
        ev.preventDefault();
        if (this.currentTime >= TOTAL_DURATION - 0.05) this.replay();
        else this.setPaused(this.playing);
      }
    };
    this.ownerWin.addEventListener("keydown", this.keyHandler, true);
  }

  resizeCanvas() {
    if (!this.canvasEl || !this.stageBoxEl) return;
    const rect = this.stageBoxEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(this.ownerWin.devicePixelRatio || 1, 2.5);
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(180, Math.round(rect.height * dpr));
    if (this.canvasEl.width !== w || this.canvasEl.height !== h) {
      this.canvasEl.width = w;
      this.canvasEl.height = h;
    }
  }

  setPaused(paused) {
    this.playing = !paused;
    this.lastFrameMs = 0;
    this.syncControlsUi();
    if (this.playing && !this.rafId) {
      this.startLoop();
    }
  }

  replay() {
    this.currentTime = 0;
    this.playing = true;
    this.lastFrameMs = 0;
    this.renderAt(0);
    this.syncControlsUi();
    if (!this.rafId) this.startLoop();
  }

  seekTo(sec) {
    this.currentTime = clamp(Number(sec) || 0, 0, TOTAL_DURATION);
    this.renderAt(this.currentTime);
    this.syncControlsUi();
  }

  startLoop() {
    const step = (nowMs) => {
      if (!this.isOpen || this.isClosing) return;
      if (this.playing && !this.scrubbing) {
        if (!this.lastFrameMs) this.lastFrameMs = nowMs;
        const dt = Math.min(0.08, Math.max(0, (nowMs - this.lastFrameMs) / 1000));
        this.lastFrameMs = nowMs;
        const prevT = this.currentTime;
        const nextT = Math.min(TOTAL_DURATION, prevT + dt);
        this.currentTime = nextT;
        this.triggerFoleyBetween(prevT, nextT);
        this.renderAt(nextT);
        this.syncControlsUi();
        if (nextT >= TOTAL_DURATION) {
          this.playing = false;
          this.syncControlsUi();
        }
      } else {
        this.lastFrameMs = nowMs;
      }
      if (this.playing) {
        this.rafId = this.ownerWin.requestAnimationFrame(step);
      } else {
        this.rafId = 0;
      }
    };
    this.rafId = this.ownerWin.requestAnimationFrame(step);
  }

  triggerFoleyBetween(prevT, nextT) {
    if (this.muted || nextT <= prevT || nextT - prevT > 0.25) return;
    for (const item of FOLEY_CUES) {
      if (item.t > prevT && item.t <= nextT) {
        this.foley.play(item.cue, { gain: item.gain, rate: item.rate });
      }
    }
  }

  syncControlsUi() {
    const pct = clamp((this.currentTime / TOTAL_DURATION) * 100, 0, 100);
    if (this.scrubFillEl) this.scrubFillEl.style.width = `${pct.toFixed(2)}%`;
    if (this.scrubThumbEl) this.scrubThumbEl.style.left = `${pct.toFixed(2)}%`;
    if (this.timeEl) this.timeEl.textContent = `${formatClock(this.currentTime)} / ${formatClock(TOTAL_DURATION)}`;

    let activeChapIdx = -1;
    CHAPTERS.forEach((ch, idx) => {
      const btn = this.chapterBtns[idx];
      const fill = this.chapterFills[idx];
      if (!btn || !fill) return;
      const inChap = this.currentTime >= ch.start && (this.currentTime < ch.end || (idx === CHAPTERS.length - 1 && this.currentTime <= ch.end));
      if (inChap) activeChapIdx = idx;
      btn.classList.toggle("is-active", inChap);
      const localP = clamp((this.currentTime - ch.start) / (ch.end - ch.start), 0, 1);
      fill.style.transform = `scaleX(${inChap ? localP.toFixed(3) : 0})`;
    });
    if (activeChapIdx >= 0 && activeChapIdx !== this.lastActiveChapIdx) {
      this.lastActiveChapIdx = activeChapIdx;
      const activeBtn = this.chapterBtns[activeChapIdx];
      if (activeBtn && this.chapWrapEl && this.chapWrapEl.scrollWidth > this.chapWrapEl.clientWidth + 2) {
        this.chapWrapEl.scrollLeft = Math.max(0, activeBtn.offsetLeft - 12);
      }
    }

    if (this.playBtn) {
      v07Core.setBtnIconLabel(
        this.playBtn,
        this.playing ? "pause" : "play",
        this.playing ? "暂停" : "播放",
        13
      );
    }
    if (this.muteBtn) {
      v07Core.setBtnIconLabel(
        this.muteBtn,
        this.muted ? "volumeOff" : "volume",
        this.muted ? "静音" : "开声",
        13
      );
    }
    if (this.outroCtaEl) {
      this.outroCtaEl.classList.toggle("is-visible", this.currentTime >= 32.3);
    }
  }

  renderAt(tSec) {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    if (!ctx || !canvas) return;
    const P = this.cachedPalette || readLiveThemePalette(this.shellEl, this.ownerWin);
    const t = clamp(Number(tSec) || 0, 0, TOTAL_DURATION);
    _currentFrameTime = t;

    ctx.save();
    ctx.setTransform(canvas.width / LOGICAL_W, 0, 0, canvas.height / LOGICAL_H, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    drawBackdrop(ctx, P, t);

    if (t < 6.2) {
      renderScene1(ctx, P, t);
    } else if (t < 13.0) {
      renderScene2(ctx, P, t);
    } else if (t < 20.4) {
      renderScene3(ctx, P, t);
    } else if (t < 27.6) {
      renderScene4(ctx, P, t);
    } else {
      renderScene5(ctx, P, t);
    }

    ctx.restore();
  }
}

module.exports = {
  THEATER_CSS,
  CHAPTERS,
  TOTAL_DURATION,
  LocalMediaLinkerTheater
};
