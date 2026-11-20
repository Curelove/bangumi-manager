/**
 * v0.8 视觉层 · 主题与独立动态外观系统
 * ---------------------------------------------------------------
 * 主题全部以 CSS 自定义属性（--bm7-*）表达，组件只消费令牌，不写死颜色：
 *
 *   follow  跟随 Obsidian：令牌映射到 Obsidian 当前主题变量；开启动态时叠加封面主色轻呼吸与灵动翻页
 *   paper   暖色纸本：米白纸张 + 胡桃木棕；开启动态时泛起午后窗边树影轻晃与卡片掀页
 *   glow    封面柔光：焦点封面三色晕染 + 光标追光池 + 磨砂边缘折射高光（默认动态）
 *   cinema  夜间影院：暖调暗场 + 琥珀微光；开启动态时浮现放映机柔光束与胶片微尘
 *   roxy    洛琪希手记：羊皮纸 + 钢笔淡彩分层交互洛琪希（视线追踪 + 轻点戴帽/脱帽）+ 书页平实滑阅 + 批注水系魔导褪去（默认动态）
 *   cel     晴空画集：二次元夏日晴空水色画集 + 赛璐璐网点（暗色化作夏夜星穹）+ 流云光斑轻漂（默认动态）
 *
 * 每个外观拥有独立的动态开关记忆（themeMotion[id]）；任意外观开启「动态效果」后，外观列表与顶栏按钮即自动标出「动态」。
 */
const { h, clear, svgEl, icon, segmented, toggleRow, applyAmbient } = require("./v07-core.js");
const { roxyLineArtMarkup } = require("./v07-roxy-art.js");
const { createRoxyMiniPreviewEl } = require("./v08-roxy-live-rig.js");
const { attachCoverGlowMotion } = require("./v08-motion-and-lens.js");
const { isMobileEnv } = require("./platform-env.js");

const DEFAULT_THEME_MOTION = {
  follow: false,
  paper: false,
  glow: true,
  cinema: false,
  roxy: true,
  cel: true
};

const DEFAULT_THEME_MOTION_LEVEL = {
  follow: "off",
  paper: "off",
  glow: "full",
  cinema: "off",
  roxy: "full",
  cel: "full"
};

const VALID_MOTION_LEVELS = new Set(["full", "lite", "off"]);
const VALID_CEL_FX = new Set(["prism", "veil", "ripple"]);

function normalizeCelFx(rawFx) {
  if (rawFx === "veil" || rawFx === "sheen") return "veil";
  if (rawFx === "ripple" || rawFx === "louvers") return "ripple";
  return VALID_CEL_FX.has(rawFx) ? rawFx : "prism";
}

const THEMES = [
  {
    id: "follow",
    name: "跟随 Obsidian",
    desc: "跟随当前 Obsidian 主题配色，明暗自动切换",
    motionHint: "开启后，顶部泛起当前番剧封面的柔和环境色呼吸，面板内按左右方向清爽滑移切换",
    defaultMotion: false,
    swatch: ["linear-gradient(135deg,#f4f4f4 0 50%,#2a2a2a 50% 100%)", "rgba(150,150,150,.38)", "#7c6fd8"]
  },
  {
    id: "paper",
    name: "暖色纸本",
    desc: "温润米白纸张配胡桃木棕，久看柔和不刺眼",
    motionHint: "开启后，纸面右上角浮现午后窗棂暖阳与树影微风轻晃，面板内按左右方向清爽滑移切换",
    defaultMotion: false,
    swatch: ["#fbf7ef", "#efe6d6", "#8f683d"]
  },
  {
    id: "glow",
    name: "封面柔光",
    desc: "焦点封面化作多层呼吸柔光，磨砂面板随光标轻移",
    mobileDesc: "焦点封面化作多层呼吸柔光，配柔和磨砂卡片质感",
    motionHint: "开启后，焦点封面柔光随光标流动，磨砂边框折射高光，面板内按左右方向清爽滑移切换",
    mobileMotionHint: "开启后，焦点封面泛起多层呼吸柔光，面板内按左右方向清爽滑移切换",
    defaultMotion: true,
    swatch: ["#e9dfe6", "#b9a3c4", "#5d6fb3"]
  },
  {
    id: "cinema",
    name: "夜间影院",
    desc: "暖调暗场配琥珀微光，适合夜晚安静看番",
    motionHint: "开启后，暗场上方洒下柔和的琥珀放映机光束与微尘浮动，面板内按左右方向清爽滑移切换",
    defaultMotion: false,
    swatch: ["#171411", "#2a241e", "#e0a458"]
  },
  {
    id: "roxy",
    name: "洛琪希手记",
    desc: "羊皮纸与钢笔淡彩，附洛琪希探头交互与手写批注",
    mobileDesc: "羊皮纸星轨底纹与钢笔淡彩，附洛琪希手写批注",
    motionHint: "开启后，启用阅读器平实书页滑阅、批注水系魔导褪去、星轨微光及洛琪希呼吸/视线交互",
    mobileMotionHint: "开启后，启用平实书页滑阅、批注水系微光褪去与星轨淡彩动效",
    defaultMotion: true,
    swatch: ["#f6f0e3", "#d9c7a6", "#3f56b0"]
  },
  {
    id: "cel",
    name: "晴空画集",
    desc: "澄澈晴空水色配赛璐璐网点画集，通透清爽",
    motionHint: "开启后，晴空流云光斑轻柔漂移（暗色化作夏夜星穹），面板左右切换时随方向展现晴空棱镜、白羽柔纱或澄水涟漪",
    defaultMotion: true,
    swatch: ["linear-gradient(155deg,#dff0ff 0%,#f5faff 62%,#fff8eb 100%)", "#ffffff", "#2c7be5"]
  }
];

const DEFAULT_APPEARANCE = {
  theme: "follow",
  motion: false,
  motionLevel: "off",
  themeMotion: Object.assign({}, DEFAULT_THEME_MOTION),
  themeMotionLevel: Object.assign({}, DEFAULT_THEME_MOTION_LEVEL),
  roxyArt: true,
  roxyGaze: true,
  roxyHat: false,
  roxyNoteCollapsed: false,
  celFx: "prism"
};

function normalizeAppearance(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const theme = THEMES.some((t) => t.id === src.theme) ? src.theme : "follow";

  const tml = Object.assign({}, DEFAULT_THEME_MOTION_LEVEL);
  if (src.themeMotion && typeof src.themeMotion === "object") {
    for (const t of THEMES) {
      if (typeof src.themeMotion[t.id] === "boolean") {
        tml[t.id] = src.themeMotion[t.id] ? "full" : "off";
      }
    }
  } else if (typeof src.motion === "boolean" && src.theme && THEMES.some((t) => t.id === src.theme)) {
    tml[theme] = src.motion ? "full" : "off";
  }

  if (src.themeMotionLevel && typeof src.themeMotionLevel === "object") {
    for (const t of THEMES) {
      const lv = src.themeMotionLevel[t.id];
      if (VALID_MOTION_LEVELS.has(lv)) {
        tml[t.id] = lv;
      }
    }
  }

  if (VALID_MOTION_LEVELS.has(src.motionLevel) && (!src.themeMotionLevel || src._syncCurrentMotion)) {
    tml[theme] = src.motionLevel;
  } else if (typeof src.motion === "boolean" && (!src.themeMotion && !src.themeMotionLevel || src._syncCurrentMotion) && !VALID_MOTION_LEVELS.has(src.motionLevel)) {
    tml[theme] = src.motion ? "full" : "off";
  }

  const tm = {};
  for (const t of THEMES) {
    tm[t.id] = tml[t.id] !== "off";
  }
  const motionLevel = tml[theme] || "off";

  return {
    theme,
    themeMotion: tm,
    themeMotionLevel: tml,
    motionLevel,
    motion: motionLevel !== "off",
    roxyArt: src.roxyArt !== false,
    roxyGaze: src.roxyGaze !== false,
    roxyHat: Boolean(src.roxyHat),
    roxyNoteCollapsed: Boolean(src.roxyNoteCollapsed),
    celFx: normalizeCelFx(src.celFx)
  };
}

function isThemeMotionOn(appearance, themeId) {
  const a = normalizeAppearance(appearance);
  const id = themeId || a.theme;
  return Boolean(a.themeMotion && a.themeMotion[id]);
}

function formatAppearanceButtonLabel(appearance) {
  const a = normalizeAppearance(appearance);
  if (a.motionLevel === "full") return "外观 · 动态";
  if (a.motionLevel === "lite") return "外观 · 轻巧";
  return "外观";
}

/**
 * 把主题挂到根节点（可以是 .curator-desk-root，也可以是游戏典藏容器）。
 * 同时负责插入/移除背景装饰层（封面柔光底、暖阳纸影、影院光束、洛琪希羊皮纸星轨、晴空画集流云）。
 */
function applyTheme(rootEl, appearance) {
  if (!rootEl) return;
  const a = normalizeAppearance(appearance);
  rootEl.classList.add("bm7-root");
  rootEl.setAttribute("data-bm7-theme", a.theme);
  rootEl.setAttribute("data-bm7-motion", a.motion ? "on" : "off");
  rootEl.setAttribute("data-bm7-motion-tier", a.motionLevel);
  rootEl.setAttribute("data-bm8-cel-fx", a.celFx || "prism");
  ensureDecorLayer(rootEl, a);
  if (a.theme === "glow" && a.motionLevel === "full") {
    attachCoverGlowMotion(rootEl);
  } else {
    if (rootEl._bm8GlowMotion) rootEl._bm8GlowMotion.destroy();
    rootEl.style.setProperty("--bm7-px", "0");
    rootEl.style.setProperty("--bm7-py", "0");
    rootEl.classList.remove("is-bm8-pointer");
  }
}

function ensureDecorLayer(rootEl, a) {
  let layer = rootEl.querySelector(":scope > .bm7-decor");
  if (!layer) {
    layer = h("div.bm7-decor", { attr: { "aria-hidden": "true" } });
    rootEl.insertBefore(layer, rootEl.firstChild);
  }
  const want = `${a.theme}|${a.motionLevel}|${a.roxyArt ? 1 : 0}`;
  if (layer.dataset.built === want) return;
  layer.dataset.built = want;
  clear(layer);

  if (a.theme === "follow" && a.motionLevel === "full") {
    layer.appendChild(h("div.bm8-decor-follow"));
  } else if (a.theme === "paper") {
    layer.appendChild(h("div.bm7-decor-paper"));
    if (a.motionLevel === "full") {
      layer.appendChild(h("div.bm8-decor-sunleaf"));
    }
  } else if (a.theme === "glow") {
    layer.appendChild(
      h("div.bm7-decor-glow", [
        h("div.bm7-decor-glow-img.is-a.is-shown"),
        h("div.bm7-decor-glow-img.is-b"),
        h("div.bm7-decor-glow-orb.is-orb1"),
        h("div.bm7-decor-glow-orb.is-orb2"),
        h("div.bm7-decor-glow-orb.is-orb3"),
        h("div.bm7-decor-glow-veil"),
        h("div.bm8-glow-pool")
      ])
    );
  } else if (a.theme === "cinema") {
    layer.appendChild(
      h("div.bm8-decor-cinema", [
        h("div.bm8-cinema-beam.is-b1"),
        h("div.bm8-cinema-beam.is-b2"),
        h("div.bm8-cinema-motes")
      ])
    );
  } else if (a.theme === "roxy") {
    layer.appendChild(h("div.bm7-decor-paper"));
    layer.appendChild(starTrailEl());
  } else if (a.theme === "cel") {
    layer.appendChild(
      h("div.bm8-decor-cel", [
        h("div.bm8-cel-sky"),
        h("div.bm8-cel-cloud.is-c1"),
        h("div.bm8-cel-cloud.is-c2"),
        h("div.bm8-cel-halftone"),
        celFrameMarksEl()
      ])
    );
  }
}

/** 封面柔光与跟随动态：更新环境主色；若在封面柔光下则双缓冲交叉淡入底图 */
function setGlowBackdrop(rootEl, coverUrl, titleSeed = "") {
  if (!rootEl) return;
  applyAmbient(rootEl, coverUrl, titleSeed);
  const glow = rootEl.querySelector(":scope > .bm7-decor .bm7-decor-glow");
  if (!glow) return;
  const imgA = glow.querySelector(".bm7-decor-glow-img.is-a");
  const imgB = glow.querySelector(".bm7-decor-glow-img.is-b");
  if (!imgA || !imgB) return;
  const next = coverUrl ? `url("${String(coverUrl).replace(/"/g, '\\"')}")` : "none";
  const curActive = imgB.classList.contains("is-shown") ? imgB : imgA;
  if (curActive.dataset.bgUrl === next) return;
  const nextLayer = curActive === imgA ? imgB : imgA;
  nextLayer.style.backgroundImage = next;
  nextLayer.dataset.bgUrl = next;
  nextLayer.classList.add("is-shown");
  curActive.classList.remove("is-shown");
}

/* ============================== 洛琪希钢笔淡彩与柔和渐隐星轨 ============================== */

let roxyDrawnOnce = false;

function roxyLineArtEl(opts = {}) {
  const wrap = h("div.bm7-roxy-art-wrap", {
    cls: [opts.cls || "", roxyDrawnOnce ? "" : "is-drawing"].join(" "),
    attr: { "aria-hidden": "true" }
  });
  roxyDrawnOnce = true;
  wrap.appendChild(svgEl(roxyLineArtMarkup(opts)));
  return wrap;
}

/**
 * 魔杖水系星轨：从主舞台卡片后方自然探出、掠过洛琪希头顶并延伸至右缘消隐（彻底杜绝虚线在空白背景处突兀中断）
 */
function starTrailEl() {
  const uid = `bm8st${Math.random().toString(36).slice(2, 7)}`;
  const stars = [
    [872, 66, 6.8, 0],
    [764, 46, 4.3, 1.2],
    [968, 86, 4.6, 2.1],
    [668, 76, 3.5, 0.6],
    [1062, 128, 3.8, 1.7],
    [818, 112, 3.0, 2.7]
  ];
  const starPath = (x, y, r) =>
    `M${x},${y - r} C${x + r * 0.16},${y - r * 0.16} ${x + r * 0.16},${y - r * 0.16} ${x + r},${y} C${x + r * 0.16},${y + r * 0.16} ${x + r * 0.16},${y + r * 0.16} ${x},${y + r} C${x - r * 0.16},${y + r * 0.16} ${x - r * 0.16},${y + r * 0.16} ${x - r},${y} C${x - r * 0.16},${y - r * 0.16} ${x - r * 0.16},${y - r * 0.16} ${x},${y - r} Z`;
  const markup = `<svg class="bm7-startrail" viewBox="0 0 1160 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="${uid}g" x1="18%" y1="92%" x2="100%" y2="22%">
        <stop offset="0%" stop-color="#000" stop-opacity="0"/>
        <stop offset="14%" stop-color="#fff" stop-opacity="0.72"/>
        <stop offset="58%" stop-color="#fff" stop-opacity="0.96"/>
        <stop offset="90%" stop-color="#fff" stop-opacity="0.78"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${uid}r" cx="76%" cy="22%" r="46%">
        <stop offset="0%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="72%" stop-color="#fff" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <mask id="${uid}m">
        <rect width="1160" height="400" fill="url(#${uid}g)"/>
      </mask>
      <mask id="${uid}mr">
        <rect width="1160" height="400" fill="url(#${uid}r)"/>
      </mask>
    </defs>
    <g mask="url(#${uid}m)">
      <path class="bm7-startrail-arc" d="M236,348 C456,178 734,42 1160,96" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-dasharray="2 6.8"/>
      <path class="bm7-startrail-arc2" d="M312,368 C528,214 782,84 1160,144" fill="none" stroke="currentColor" stroke-width="0.78" stroke-linecap="round" stroke-dasharray="1.3 7.8" opacity="0.58"/>
    </g>
    <g mask="url(#${uid}mr)">
      <circle cx="872" cy="66" r="20" fill="none" stroke="currentColor" stroke-width="0.65" stroke-dasharray="2 4.2" opacity="0.34"/>
      ${stars
        .map(
          ([x, y, r, d], i) =>
            `<path class="bm7-star" style="--d:${d}s;--o:${(0.46 + (i % 3) * 0.17).toFixed(2)};transform-origin:${x}px ${y}px" d="${starPath(x, y, r)}" fill="currentColor"/>`
        )
        .join("")}
    </g>
  </svg>`;
  return h("div.bm7-decor-stars", [svgEl(markup)]);
}

/** 晴空画集专属：原画定位十字与水色四芒星微饰 */
function celFrameMarksEl() {
  const markup = `<svg class="bm8-cel-marks" viewBox="0 0 640 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="0.85" opacity="0.36">
      <circle cx="566" cy="44" r="12"/><line x1="548" y1="44" x2="584" y2="44"/><line x1="566" y1="26" x2="566" y2="62"/>
      <path d="M598,22 L620,22 L620,44" stroke-width="1.1"/>
      <path d="M412,28 L438,28 M425,21 L425,35" opacity="0.6"/>
    </g>
    <path class="bm8-cel-spark is-s1" d="M512,68 L514.2,74.8 L521,77 L514.2,79.2 L512,86 L509.8,79.2 L503,77 L509.8,74.8 Z" fill="currentColor" opacity="0.45"/>
    <path class="bm8-cel-spark is-s2" d="M604,98 L605.5,102.5 L610,104 L605.5,105.5 L604,110 L602.5,105.5 L598,104 L602.5,102.5 Z" fill="currentColor" opacity="0.34"/>
  </svg>`;
  return h("div.bm8-cel-marks-wrap", [svgEl(markup)]);
}

/* ============================== 外观选择面板 ============================== */

/**
 * 渲染外观设置（每个外观独立记忆「动态」状态，开启后自动在对应外观卡片标出「动态」徽标）
 * opts: { appearance, onChange(nextAppearance), compact }
 */
function renderAppearancePicker(host, opts = {}) {
  clear(host);
  const mobile = isMobileEnv();
  let a = normalizeAppearance(opts.appearance);
  const wrap = h("div.bm7-appearance", { cls: opts.compact ? "is-compact" : "" });
  const grid = h("div.bm7-theme-grid", { attr: { role: "radiogroup", "aria-label": "外观主题" } });
  const toggles = h("div.bm7-appearance-toggles");

  const motionTierLabel = h("div.bm7-toggle-label", { text: "当前外观动效强度" });
  const motionTierHint = h("div.bm7-toggle-hint", { text: "" });
  const motionSegHost = h("div.bm8-motion-tier-seg");
  const motionRow = h("div.bm8-motion-tier-row", [
    h("div.bm7-toggle-text", [motionTierLabel, motionTierHint]),
    motionSegHost
  ]);

  const celFxLabel = h("div.bm7-toggle-label", { text: "晴空画集 · 面板切换光效" });
  const celFxHint = h("div.bm7-toggle-hint", {
    text: "随面板向左或向右切换自动翻转光线倾角与掠过方向"
  });
  const celFxSegHost = h("div.bm8-motion-tier-seg");
  const celFxRow = h("div.bm8-motion-tier-row", [
    h("div.bm7-toggle-text", [celFxLabel, celFxHint]),
    celFxSegHost
  ]);

  const artRow = toggleRow({
    label: mobile ? "显示洛琪希手写批注" : "显示洛琪希插画与批注",
    hint: mobile
      ? "在「洛琪希手记」主题下显示手写批注卡片"
      : "在「洛琪希手记」下展示侧栏探头小人与手写批注卡（轻点小人可切换脱帽呆毛与巫师帽）",
    checked: a.roxyArt,
    onChange: (v) => commit({ roxyArt: v })
  });
  const artInput = artRow.querySelector("input");
  artInput.dataset.key = "roxyArt";

  const gazeRow = toggleRow({
    label: "洛琪希视线跟随光标",
    hint: "光标移动时洛琪希会轻转视线看向光标并自然眨眼；关闭后释放动态图层，不占用额外显存",
    checked: a.roxyGaze,
    onChange: (v) => commit({ roxyGaze: v })
  });
  const gazeInput = gazeRow.querySelector("input");
  const gazeHintEl = gazeRow.querySelector(".bm7-toggle-hint");
  gazeInput.dataset.key = "roxyGaze";

  let ratingSourceRow = null;
  let ratingSourceSegHost = null;
  let ratingSourceHint = null;
  let currentRatingSource = opts.ratingSourceOptions ? String(opts.ratingSourceOptions.value || "bangumi") : "bangumi";
  if (opts.ratingSourceOptions && Array.isArray(opts.ratingSourceOptions.items)) {
    ratingSourceHint = h("div.bm7-toggle-hint", {
      text: "控制追番封面、全部番剧与 3D 展厅等单评分位默认显示的评分依据（该站未同步时自动回退 Bangumi）"
    });
    ratingSourceSegHost = h("div.bm8-motion-tier-seg");
    ratingSourceRow = h("div.bm8-motion-tier-row", [
      h("div.bm7-toggle-text", [
        h("div.bm7-toggle-label", { text: "优先展示评分源" }),
        ratingSourceHint
      ]),
      ratingSourceSegHost
    ]);
  }

  const commit = (patch) => {
    const merged = Object.assign({}, a, patch);
    if (patch && patch.theme && !patch.themeMotion && !patch.themeMotionLevel) {
      merged.themeMotion = Object.assign({}, a.themeMotion);
      merged.themeMotionLevel = Object.assign({}, a.themeMotionLevel);
      delete merged._syncCurrentMotion;
      delete merged.motionLevel;
      delete merged.motion;
    }
    a = normalizeAppearance(merged);
    opts.onChange && opts.onChange(a);
    paint();
  };

  const paint = () => {
    clear(grid);
    const curThemeObj = THEMES.find((t) => t.id === a.theme) || THEMES[0];

    for (const t of THEMES) {
      const lv = (a.themeMotionLevel && a.themeMotionLevel[t.id]) || "off";
      const hasMotion = lv !== "off";
      const tagText = lv === "full" ? "动态" : lv === "lite" ? "轻巧" : "";
      const card = h(
        "button.bm7-theme-card",
        {
          cls: t.id === a.theme ? "is-active" : "",
          attr: {
            type: "button",
            role: "radio",
            "aria-checked": t.id === a.theme ? "true" : "false",
            "data-theme-id": t.id,
            "data-theme-motion": hasMotion ? "on" : "off",
            "data-theme-motion-level": lv
          },
          on: { click: () => commit({ theme: t.id }) }
        },
        [
          h("span.bm7-theme-preview", { attr: { "data-preview": t.id } }, [
            h("span.bm7-tp-bg", { style: { background: t.swatch[0] } }),
            h("span.bm7-tp-panel", { style: { background: t.swatch[1] } }),
            h("span.bm7-tp-accent", { style: { background: t.swatch[2] } }),
            t.id === "roxy" ? createRoxyMiniPreviewEl(a.roxyHat) : null,
            t.id === "glow" ? h("span.bm7-tp-glowblob") : null,
            t.id === "glow" ? h("span.bm7-tp-glowblob2") : null,
            t.id === "cel" ? h("span.bm8-tp-celdots") : null,
            t.id === "cel" ? h("span.bm8-tp-celcloud") : null
          ]),
          h("span.bm7-theme-meta", [
            h("span.bm7-theme-name", [
              h("span.bm7-theme-name-text", { text: t.name }),
              tagText ? h("span.bm7-theme-tag", { cls: lv === "lite" ? "is-lite" : "", text: tagText }) : null
            ]),
            h("span.bm7-theme-desc", { text: (mobile && t.mobileDesc) || t.desc })
          ]),
          t.id === a.theme ? h("span.bm7-theme-check", [icon("check", 14)]) : null
        ]
      );
      grid.appendChild(card);
    }

    motionTierLabel.textContent = `当前外观动效强度（${curThemeObj.name}）`;
    if (a.motionLevel === "full") {
      motionTierHint.textContent =
        (mobile && curThemeObj.mobileMotionHint) ||
        curThemeObj.motionHint ||
        "完整启用纸页转场、画卷伸缩与当前外观环境动效";
    } else if (a.motionLevel === "lite") {
      motionTierHint.textContent = mobile
        ? "保留顺滑的面板切换与收拢过渡，暂停持续背景动画与滤镜以省电减耗"
        : "保留顺滑的面板切换与收拢过渡，暂停持续背景动画、光标追光与滤镜以节省显存";
    } else {
      motionTierHint.textContent = "已停用界面转场与背景装饰动画，保持即时切换";
    }

    clear(motionSegHost);
    motionSegHost.appendChild(
      segmented(
        [
          { value: "full", label: "丰富", title: "完整启用纸页转场、画卷伸缩与环境动效" },
          { value: "lite", label: "轻巧", title: "保留面板平滑过渡，暂停持续背景动画与滤镜" },
          { value: "off", label: "关闭", title: "停用全部界面动效，即时切换" }
        ],
        a.motionLevel,
        (lv) => {
          const nextLvMap = Object.assign({}, a.themeMotionLevel, { [a.theme]: lv });
          const nextBoolMap = Object.assign({}, a.themeMotion, { [a.theme]: lv !== "off" });
          commit({
            themeMotionLevel: nextLvMap,
            themeMotion: nextBoolMap,
            motionLevel: lv,
            motion: lv !== "off",
            _syncCurrentMotion: true
          });
        },
        "is-small"
      )
    );

    artInput.checked = Boolean(a.roxyArt);
    artRow.style.display = a.theme === "roxy" ? "" : "none";

    celFxRow.style.display = a.theme === "cel" ? "" : "none";
    const celFxDisabled = a.motionLevel !== "full";
    celFxRow.classList.toggle("is-disabled", celFxDisabled);
    clear(celFxSegHost);
    celFxSegHost.appendChild(
      segmented(
        [
          { value: "prism", label: "晴空棱镜", title: "通透斜面玻璃折射伴随水青与微光谱边掠过" },
          { value: "veil", label: "白羽柔纱", title: "纯白半透薄纱与柔焦光斑随风漫透，无深色调与硬描边" },
          { value: "ripple", label: "澄水涟漪", title: "从点击侧荡开清透纯白与浅天水双层环形水纹" }
        ],
        a.celFx || "prism",
        (fx) => {
          if (celFxDisabled) return;
          commit({ celFx: fx });
        },
        "is-small"
      )
    );
    if (celFxHint) {
      celFxHint.textContent = celFxDisabled
        ? "需将上方动效强度设为「丰富」以启用晴空画集专属切换转场"
        : a.celFx === "veil"
        ? "纯白半透薄纱携柔焦微光斑随风向轻拂漫透，零深色调、零硬描边"
        : a.celFx === "ripple"
        ? "从点击方向的一侧荡开清透纯白与浅天水双层环形水波纹，悠然散至对侧"
        : "斜面光学棱镜折射带伴随水青—纯白—微粉紫光谱边随切换方向掠过";
    }

    gazeInput.checked = Boolean(a.roxyGaze);
    gazeRow.style.display = !mobile && a.theme === "roxy" ? "" : "none";
    const gazeDisabled = a.motionLevel !== "full" || !a.roxyArt;
    gazeInput.disabled = gazeDisabled;
    gazeRow.classList.toggle("is-disabled", gazeDisabled);
    if (gazeHintEl) {
      gazeHintEl.textContent =
        a.motionLevel === "lite"
          ? "「轻巧」档位已暂停持续光标追踪以节省显存；切至「丰富」即可启用视线跟随"
          : "光标移动时洛琪希会轻转视线看向光标并自然眨眼；关闭后释放动态图层，不占用额外显存";
    }

    if (ratingSourceSegHost && opts.ratingSourceOptions) {
      clear(ratingSourceSegHost);
      ratingSourceSegHost.appendChild(
        segmented(
          opts.ratingSourceOptions.items,
          currentRatingSource,
          (nextSrc) => {
            currentRatingSource = nextSrc;
            if (typeof opts.ratingSourceOptions.onChange === "function") {
              opts.ratingSourceOptions.onChange(nextSrc);
            }
            paint();
          },
          "is-small"
        )
      );
    }
  };

  toggles.append(motionRow, celFxRow, artRow, gazeRow);
  if (ratingSourceRow) toggles.append(ratingSourceRow);
  wrap.append(grid, toggles);
  host.appendChild(wrap);
  paint();
  return wrap;
}

module.exports = {
  THEMES,
  DEFAULT_THEME_MOTION,
  DEFAULT_THEME_MOTION_LEVEL,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  isThemeMotionOn,
  formatAppearanceButtonLabel,
  applyTheme,
  setGlowBackdrop,
  roxyLineArtMarkup,
  roxyLineArtEl,
  starTrailEl,
  renderAppearancePicker
};
