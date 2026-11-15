/**
 * v0.8 视觉层 · 洛琪希（脱帽形态）钢笔淡彩探头插画与手记批注卡
 * ---------------------------------------------------------------------------------
 * 造型严格锚定设定参考图（脱帽形态）：
 *  - 灰蓝色蓬松圆润短发，头顶单根向内回钩的标志性大呆毛，耳侧柔和微翘碎发簇与内扣护颊鬓发
 *  - 颈后左侧隐约露出一小段三股麻花辫剪影，不堆砌繁碎线条
 *  - 微困安静的半垂眼（Kuudere）气质：平缓微垂上眼睑略遮虹膜上缘、清透灰蓝渐变虹膜与细小留白高光、轻细鼻点与小巧微抿唇线
 *  - 宽口立领连帽驼棕披风斗篷（米白双线镶边、V 领米白内衬衬衫、胸前三排米白横搭扣与六枚深色圆纽扣）
 *  - 双手轻搭在侧栏卡片上沿（EDGE_Y=220）自然探头，消除生硬截断；亮暗双色温润手账纸底衬不反白、不发脏
 */
const { h, clear, svgEl, icon, button, iconButton, motionTier } = require("./v07-core.js");

const ROXY_RADICAL_POOL = ["氵", "辶", "纟", "丿", "丶", "☵", "♒", "〜", "·"];

function getRoxyNoteTier(el) {
  if (typeof motionTier === "function") return motionTier(el);
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "off";
  } catch (_) {}
  const root = el && el.closest ? el.closest(".bm7-root") : null;
  if (!root) return "full";
  const tier = root.getAttribute("data-bm7-motion-tier");
  if (tier === "off" || tier === "lite" || tier === "full") return tier;
  return root.getAttribute("data-bm7-motion") === "off" ? "off" : "full";
}

function canAnimateRoxyNote(el) {
  return getRoxyNoteTier(el) !== "off";
}

function ensureRoxyWaveFilterDefs(hostEl) {
  if (!hostEl || hostEl.querySelector(".bm8-rx-wave-defs")) return;
  const defsSvg = svgEl(
    `<svg class="bm8-rx-wave-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"><defs><filter id="bm8-rxnote-wave-filter" x="-8%" y="-18%" width="116%" height="136%" color-interpolation-filters="sRGB"><feTurbulence class="bm8-rx-turb" type="fractalNoise" baseFrequency="0.016 0.042" numOctaves="2" seed="7" result="noise"/><feDisplacementMap class="bm8-rx-disp" in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>`
  );
  hostEl.appendChild(defsSvg);
}

function buildSerpentBezierPath(w, hPx, laneIdx, laneTotal) {
  const ratio = (laneIdx + 0.5) / Math.max(1, laneTotal);
  const baseY = hPx * (0.2 + ratio * 0.62);
  const amp = 7 + (laneIdx % 3) * 4.5;
  const dir = laneIdx % 2 === 0 ? 1 : -1;
  const x0 = -10;
  const x1 = w * 0.26;
  const x2 = w * 0.54;
  const x3 = w * 0.8;
  const x4 = w + 14;
  const y0 = baseY + dir * 4;
  const y1 = baseY - dir * amp;
  const y2 = baseY + dir * (amp * 0.85);
  const y3 = baseY - dir * (amp * 0.65);
  const y4 = baseY - dir * 7;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} C ${(x0 + w * 0.12).toFixed(1)} ${y1.toFixed(1)}, ${(x1 - w * 0.08).toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${baseY.toFixed(1)} S ${(x2 - w * 0.08).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${baseY.toFixed(1)} S ${(x3 - w * 0.08).toFixed(1)} ${y3.toFixed(1)}, ${x3.toFixed(1)} ${(baseY - dir * 3).toFixed(1)} S ${(x4 - w * 0.06).toFixed(1)} ${y4.toFixed(1)}, ${x4.toFixed(1)} ${y4.toFixed(1)}`;
}

/**
 * 「换一条」批注专属：提炼水系笔锋与偏旁流转灵气，同时平滑锁定/过渡字框高度，零跳动换句
 */
function triggerRoxyNoteInkSwitch(quoteEl, nextFullText) {
  if (!quoteEl) return;
  const tier = getRoxyNoteTier(quoteEl);
  if (tier === "off") {
    quoteEl.textContent = nextFullText;
    return;
  }
  if (quoteEl.dataset.switching === "1") {
    quoteEl.textContent = nextFullText;
    return;
  }
  quoteEl.dataset.switching = "1";

  const textSpan = quoteEl.querySelector(".bm8-rx-quote-text") || quoteEl;
  const prevH = quoteEl.offsetHeight;
  if (prevH > 0) {
    quoteEl.style.height = `${prevH}px`;
    quoteEl.style.overflow = "hidden";
  }

  if (tier === "lite") {
    textSpan.classList.remove("bm8-rx-quote-in");
    textSpan.classList.add("bm8-rx-quote-out");
    setTimeout(() => {
      if (!quoteEl.isConnected) return;
      textSpan.classList.remove("bm8-rx-quote-out");
      textSpan.textContent = nextFullText;
      quoteEl.style.height = "auto";
      const nextH = quoteEl.offsetHeight;
      if (prevH > 0 && Math.abs(nextH - prevH) > 1) {
        quoteEl.style.height = `${prevH}px`;
        void quoteEl.offsetWidth;
        quoteEl.style.transition = "height 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        quoteEl.style.height = `${nextH}px`;
      }
      textSpan.classList.add("bm8-rx-quote-in");
      setTimeout(() => {
        if (!quoteEl.isConnected) return;
        textSpan.classList.remove("bm8-rx-quote-in");
        quoteEl.style.height = "";
        quoteEl.style.overflow = "";
        quoteEl.style.transition = "";
        quoteEl.dataset.switching = "0";
      }, 240);
    }, 95);
    return;
  }

  // 丰富档（full）：笔锋偏旁微光轻散 + 新句水色落笔显影
  const rawChars = Array.from(textSpan.textContent || "");
  textSpan.classList.remove("bm8-rx-quote-in");
  textSpan.classList.add("bm8-rx-quote-ink-out");

  const radicalTimer = setTimeout(() => {
    if (!textSpan.isConnected) return;
    textSpan.textContent = rawChars
      .map((ch, idx) => {
        if (/[「」『』，。、！？（）\s]/.test(ch)) return ch;
        return idx % 3 === 1 ? ROXY_RADICAL_POOL[(idx * 3 + 2) % ROXY_RADICAL_POOL.length] : ch;
      })
      .join("");
  }, 42);
  void radicalTimer;

  const fx = h("span.bm8-rx-quote-fx", { attr: { "aria-hidden": "true" } });
  for (let i = 0; i < 7; i++) {
    const glyph = ROXY_RADICAL_POOL[(i * 2 + 1) % ROXY_RADICAL_POOL.length];
    const px = 10 + i * 12.5;
    const py = 30 + ((i * 17) % 38);
    const dx = (i % 2 === 0 ? 1 : -1) * (8 + (i % 3) * 5);
    const dy = -(9 + (i % 3) * 5);
    fx.appendChild(
      h("span.bm8-rx-stroke-particle", {
        cls: i % 3 === 2 ? "is-amber" : "",
        text: glyph,
        style: {
          left: `${px.toFixed(1)}%`,
          top: `${py.toFixed(1)}%`,
          "--rx-dx": `${dx}px`,
          "--rx-dy": `${dy}px`,
          "--rx-rot": `${(i % 2 === 0 ? 14 : -14)}deg`,
          animationDelay: `${i * 16}ms`
        }
      })
    );
  }
  quoteEl.appendChild(fx);

  setTimeout(() => {
    if (!quoteEl.isConnected) return;
    textSpan.classList.remove("bm8-rx-quote-ink-out");
    textSpan.textContent = nextFullText;

    quoteEl.style.transition = "none";
    quoteEl.style.height = "auto";
    const nextH = quoteEl.offsetHeight;
    if (prevH > 0 && Math.abs(nextH - prevH) > 1) {
      quoteEl.style.height = `${prevH}px`;
      void quoteEl.offsetWidth;
      quoteEl.style.transition = "height 260ms cubic-bezier(0.22, 1, 0.36, 1)";
      quoteEl.style.height = `${nextH}px`;
    } else {
      quoteEl.style.height = "";
    }

    void textSpan.offsetWidth;
    textSpan.classList.add("bm8-rx-quote-in");

    setTimeout(() => {
      if (fx.parentNode) fx.remove();
      if (!quoteEl.isConnected) return;
      textSpan.classList.remove("bm8-rx-quote-in");
      quoteEl.style.height = "";
      quoteEl.style.overflow = "";
      quoteEl.style.transition = "";
      quoteEl.dataset.switching = "0";
    }, 320);
  }, 135);
}

/**
 * 洛琪希批注「叉号收起」连贯转出与空间收拢过渡（彻底消除动画后原地硬跳）：
 *  - full 档：SVG 水波置换扰动 + 青蓝/琥珀水纹游丝 + 容器高度平滑向胶囊高度收拢 + 书签胶囊自然浮现
 *  - lite 档：无滤镜顺滑淡出 + 容器高度连贯收拢至书签胶囊
 */
function triggerRoxyNoteSpellDissolve(morphEl, cardEl, pillEl, onComplete) {
  const tier = getRoxyNoteTier(cardEl || morphEl);
  if (!morphEl || !cardEl || !pillEl || tier === "off") {
    onComplete && onComplete();
    return;
  }
  if (morphEl.dataset.morphing === "1") return;
  morphEl.dataset.morphing = "1";
  cardEl.dataset.dissolving = "1";

  const cardRect = cardEl.getBoundingClientRect();
  const fromH = Math.max(64, Math.round(cardRect.height || cardEl.offsetHeight || 104));
  const w = Math.max(240, Math.round(cardRect.width || cardEl.offsetWidth || 520));

  // 先测量胶囊目标高度，确保收拢终点与真实布局 0px 误差
  pillEl.classList.add("is-emerging-pill");
  morphEl.appendChild(pillEl);
  const toH = Math.max(28, Math.round(pillEl.getBoundingClientRect().height || pillEl.offsetHeight || 30));

  morphEl.style.height = `${fromH}px`;
  morphEl.classList.add("is-morphing");
  void morphEl.offsetHeight;

  if (tier === "lite") {
    cardEl.classList.add("is-collapsing-lite");
    morphEl.style.transition = "height 340ms cubic-bezier(0.22, 1, 0.36, 1)";
    morphEl.style.height = `${toH}px`;
    requestAnimationFrame(() => {
      pillEl.classList.add("is-shown");
    });
    setTimeout(() => {
      morphEl.classList.remove("is-morphing");
      morphEl.style.height = "";
      morphEl.style.transition = "";
      pillEl.classList.remove("is-emerging-pill", "is-shown");
      morphEl.dataset.morphing = "0";
      onComplete && onComplete();
    }, 355);
    return;
  }

  // 丰富档（full）：SVG 水波置换 + 魔法水纹游丝 + 同步丝滑收拢容器高度
  ensureRoxyWaveFilterDefs(morphEl.parentNode || morphEl);
  cardEl.classList.add("is-dissolving-spell");

  const fxLayer = h("div.bm8-rx-dissolve-layer", { attr: { "aria-hidden": "true" } });
  const laneTotal = 4;
  const uid = `rxsp${Math.random().toString(36).slice(2, 6)}`;
  const pathsMarkup = [];
  for (let l = 0; l < laneTotal; l++) {
    const d = buildSerpentBezierPath(w, fromH, l, laneTotal);
    const grad = l % 2 === 0 ? `url(#${uid}w)` : `url(#${uid}a)`;
    const sw = l % 2 === 0 ? 1.9 : 1.45;
    const delay = (30 + l * 32) / 1000;
    pathsMarkup.push(
      `<path class="bm8-rx-serpent-path" pathLength="1" d="${d}" stroke="${grad}" stroke-width="${sw}" style="animation-delay:${delay.toFixed(3)}s"/>`
    );
  }
  fxLayer.appendChild(
    svgEl(
      `<svg class="bm8-rx-serpent-svg" viewBox="0 0 ${w} ${fromH}" preserveAspectRatio="none"><defs><linearGradient id="${uid}w" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#4898e0" stop-opacity="0"/><stop offset="38%" stop-color="#6fc0ff" stop-opacity="0.92"/><stop offset="78%" stop-color="#3f56b0" stop-opacity="0.82"/><stop offset="100%" stop-color="#b8ebff" stop-opacity="0"/></linearGradient><linearGradient id="${uid}a" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#c99b49" stop-opacity="0"/><stop offset="45%" stop-color="#e2b45c" stop-opacity="0.88"/><stop offset="100%" stop-color="#f7df9c" stop-opacity="0"/></linearGradient></defs>${pathsMarkup.join("")}</svg>`
    )
  );
  cardEl.appendChild(fxLayer);

  const hostRoot = morphEl.parentNode || document;
  const dispNode = hostRoot.querySelector(".bm8-rx-disp");
  const turbNode = hostRoot.querySelector(".bm8-rx-turb");
  const startTs = performance.now();
  const filterDur = 520;

  const stepWave = (now) => {
    const p = Math.min(1, (now - startTs) / filterDur);
    if (dispNode) {
      const waveScale = Math.sin(p * Math.PI) * 20;
      dispNode.setAttribute("scale", waveScale.toFixed(1));
    }
    if (turbNode) {
      const fxFreq = (0.014 + Math.sin(p * Math.PI * 1.5) * 0.006).toFixed(4);
      const fyFreq = (0.038 + p * 0.026).toFixed(4);
      turbNode.setAttribute("baseFrequency", `${fxFreq} ${fyFreq}`);
    }
    if (p < 1 && morphEl.isConnected) {
      requestAnimationFrame(stepWave);
    } else if (dispNode) {
      dispNode.setAttribute("scale", "0");
    }
  };
  requestAnimationFrame(stepWave);

  // 批注化为水纹伊始即同步丝滑收拢容器高度，使下方模块全程柔和跟进上移，收尾帧 0px 跳动
  setTimeout(() => {
    if (!morphEl.isConnected) return;
    morphEl.style.transition = "height 510ms cubic-bezier(0.22, 1, 0.36, 1)";
    morphEl.style.height = `${toH}px`;
  }, 35);

  setTimeout(() => {
    if (!pillEl.isConnected) return;
    pillEl.classList.add("is-shown");
  }, 210);

  setTimeout(() => {
    if (dispNode) dispNode.setAttribute("scale", "0");
    onComplete && onComplete();
    morphEl.classList.remove("is-morphing");
    morphEl.style.height = "";
    morphEl.style.transition = "";
    pillEl.classList.remove("is-emerging-pill", "is-shown");
    morphEl.dataset.morphing = "0";
  }, 575);
}

/**
 * 点击「展开洛琪希的批注」胶囊：容器高度与纸页同步柔和舒展，杜绝下方模块生硬下跳
 */
function triggerRoxyNotePillExpand(morphEl, pillEl, cardEl, onComplete) {
  const tier = getRoxyNoteTier(morphEl);
  if (!morphEl || !pillEl || !cardEl || tier === "off") {
    onComplete && onComplete();
    return;
  }
  if (morphEl.dataset.morphing === "1") return;
  morphEl.dataset.morphing = "1";

  const fromH = Math.max(28, Math.round(pillEl.offsetHeight || 30));
  pillEl.classList.add("is-fading-pill");
  cardEl.classList.add(tier === "full" ? "is-expanding-card" : "is-expanding-lite");

  morphEl.appendChild(cardEl);
  const toH = Math.max(68, Math.round(cardEl.offsetHeight || 104));

  morphEl.classList.add("is-morphing");
  morphEl.style.height = `${fromH}px`;
  void morphEl.offsetWidth;

  const dur = tier === "full" ? 420 : 320;
  morphEl.style.transition = `height ${dur}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  morphEl.style.height = `${toH}px`;

  requestAnimationFrame(() => {
    pillEl.classList.add("is-out");
    cardEl.classList.add("is-in");
  });

  setTimeout(() => {
    if (pillEl.parentNode) pillEl.remove();
    cardEl.classList.remove("is-expanding-card", "is-expanding-lite", "is-in");
    morphEl.classList.remove("is-morphing");
    morphEl.style.height = "";
    morphEl.style.transition = "";
    morphEl.dataset.morphing = "0";
    onComplete && onComplete();
  }, dur + 20);
}

const VB_W = 240;
const VB_H = 232;
const EDGE_Y = 220;

function fmt(n) {
  return Math.round(n * 10) / 10;
}

/** 以 x=120 为对称轴镜像（适用于绝对坐标命令 M/C/Q/L） */
function mirror(d) {
  return String(d).replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${fmt(240 - Number(x))},${y}`);
}

/* ---------------- 1. 蓬松圆润发顶、耳侧微翘羽簇、单根回钩呆毛与后侧辫影 ---------------- */

const HAIR_BACK_FILL =
  "M120,39.5 C89,38 66.5,56.5 60.5,86 C58.5,95.5 54.8,102.5 48.8,107.8 C54.2,109.2 59.2,107.8 63.2,104.5 C61.8,115.5 58.8,124.5 53.8,131.8 C59.8,131.8 65.2,128.8 69.2,123.8 C69.8,134.5 73.2,143.5 78.5,151 L161.5,151 C166.8,143.5 170.2,134.5 170.8,123.8 C174.8,128.8 180.2,131.8 186.2,131.8 C181.2,124.5 178.2,115.5 176.8,104.5 C180.8,107.8 185.8,109.2 191.2,107.8 C185.2,102.5 181.5,95.5 179.5,86 C173.5,56.5 151,38 120,39.5 Z";

const HAIR_OUTLINE_L =
  "M75.5,145.5 C71.5,138.5 69.8,131 69.2,123.8 C65.2,128.8 59.8,131.8 53.8,131.8 C58.8,124.5 61.8,115.5 63.2,104.5 C59.2,107.8 54.2,109.2 48.8,107.8 C54.8,102.5 58.5,95.5 60.5,86 C66.5,56.5 89,38.2 116.5,39.4";
const HAIR_OUTLINE_R =
  "M123.8,39.4 C151,38.2 173.5,56.5 179.5,86 C181.5,95.5 185.2,102.5 191.2,107.8 C185.8,109.2 180.8,107.8 176.8,104.5 C178.2,115.5 181.2,124.5 186.2,131.8 C180.2,131.8 174.8,128.8 170.8,123.8 C170.2,131 168.5,138.5 164.5,145.5";
const HAIR_CROWN_CREASES =
  "M114.5,43.5 C95,49.5 79.5,66 74.5,89 M125.5,43.5 C145,49.5 160.5,66 165.5,89 M59.5,101.5 C56.8,104.2 53.5,106 50.5,107 M180.5,101.5 C183.2,104.2 186.5,106 189.5,107";

const AHOGE_FILL =
  "M116.8,40.8 C115.2,20.5 126.8,10.2 139,11.2 C149.2,12.2 152.8,21.6 146.5,28 C143.6,30.8 140.2,31.4 138.2,30.4 C141.4,29.8 144.6,26.8 145.6,22.5 C146.5,17 141.8,14.4 136.5,14.8 C126.8,15.8 120.5,25.6 121.2,40.8 Z";
const AHOGE_OUTER =
  "M116.8,40.8 C115.2,20.5 126.8,10.2 139,11.2 C149.2,12.2 152.8,21.6 146.5,28 C143.6,30.8 140.2,31.4 138.2,30.4";
const AHOGE_INNER =
  "M121.2,40.4 C120.6,26 126.8,16.2 136.5,14.8";

const BRAID_FILL =
  "M69.5,134 C64.2,139 62.2,145 64.2,150 C60.2,154 58.8,160 61.2,165 C58.5,169 58,174 60,179 L68.8,177 C70.6,171 69.6,166 68.2,163 C71.5,158 71.5,152 69.5,148 C72.8,143 72.8,137 69.5,134 Z";
const BRAID_INK =
  "M68,135 C63.8,139.5 62.8,145 65.2,149.5 C60.8,153.5 59.4,159.5 62.2,164.5 C59,168.5 58.5,173.5 60.5,178 M70.4,141 C69,145 66.6,148 65.2,149.5 M69,152 C67.5,156.5 64.6,160.5 62.2,164.5";

/* ---------------- 2. 柔和圆润下颌骨相与修长脖颈 ---------------- */

const FACE_FILL =
  "M81.5,97 C81.5,117.5 92.2,133.5 113.2,140.2 Q120,142.3 126.8,140.2 C147.8,133.5 158.5,117.5 158.5,97 C158.5,72 81.5,72 81.5,97 Z";
const JAW_L = "M82.2,107 C83.5,120.5 93.2,133.8 113.2,140.2 Q117.8,141.7 119.5,141.6";
const JAW_R = "M157.8,107 C156.5,120.5 146.8,133.8 126.8,140.2 Q122.6,141.5 121.2,141.6";
const EAR_L = "M81.8,109.5 C78.4,110.8 78,116.8 80.8,119.8 C81.8,120.8 82.8,121 83.5,120.4";
const EAR_R = mirror(EAR_L);

const NECK_FILL = "M113,139.5 L127,139.5 L128.2,152.5 C124,155 116,155 111.8,152.5 Z";
const NECK_INK = "M113.4,140.8 L112.4,149.5 M126.6,140.8 L127.6,149.5";
const NECK_SHADE = "M113,140.2 Q120,142.8 127,140.2 L127.2,146.2 Q120,148.6 112.8,146.2 Z";

/* ---------------- 3. 自然偏分垂缕刘海与内扣护颊鬓发 ---------------- */

const BANGS_EDGE =
  "M75.5,103 C78.5,96.5 81.2,91.5 83.8,88.2 C84.4,95.2 86.2,100.8 89.2,104.8 C90.8,96.8 93.8,90.5 97.6,87.5 C99.2,94.2 101.8,99.5 105.2,102.8 C106.8,94.8 109.2,88.8 111.8,85.8 C112.6,96.5 114.6,105.2 117.8,110.2 C118.6,106.2 119.5,102.5 120.4,99.8 C121.2,104.2 122.4,107.6 124,109.8 C127.6,103.2 130.2,94.8 131.8,86.5 C134.2,90.2 136.4,96.5 138.2,102.8 C141.6,99.4 144.2,93.8 145.8,87.8 C148.8,91.2 151,97.2 152.2,104.5 C154.8,100.2 156.2,94.8 156.8,88.2 C159.2,91.5 161.8,96.5 164.5,103";
const BANGS_FILL = `${BANGS_EDGE} C166,61 148,40.5 120,40.5 C92,40.5 74,61 75.5,103 Z`;
const BANGS_STRANDS =
  "M117.5,44.5 C111.5,56 109.5,71 110.8,86 M120.2,44.5 C120.8,61 120.8,79 120.2,96.5 M123,44.8 C129.5,56.5 131.8,71 131.2,86.5 M104.5,50.5 C96.5,61 93,74 92.2,87.5 M135.5,50.5 C143.5,61 147,74 147.8,87.5";

const SIDELOCK_L_FILL =
  "M75.5,95 C72.8,112 74.2,130.5 80.5,149 C82.8,155.2 85.8,160.5 89.2,164.5 C88.8,156.8 87.4,147.8 85.6,138.8 C83.4,126 82.8,112 84.5,99 Z";
const SIDELOCK_L_OUT =
  "M75.8,96 C73.1,112.5 74.4,130.5 80.5,149 C82.8,155.2 85.8,160.5 89.2,164.5";
const SIDELOCK_L_IN =
  "M83.8,103 C82.8,116.5 83.6,130.5 86,144.5 C87.2,151.8 88.4,158.5 89.2,164.5";
const SIDELOCK_L_STRAND = "M78.8,111.5 C78.8,124.5 80.6,138 84.2,151";

const SIDELOCK_R_FILL = mirror(SIDELOCK_L_FILL);
const SIDELOCK_R_OUT = mirror(SIDELOCK_L_OUT);
const SIDELOCK_R_IN = mirror(SIDELOCK_L_IN);
const SIDELOCK_R_STRAND = mirror(SIDELOCK_L_STRAND);

const HAIR_SHEEN =
  "M84,65.5 C93,58 105,54.2 115.5,53.6 C106,57.4 95,62 87,69.5 Z M125,53.6 C136,54.4 147,58.4 155,66 C146.5,61.6 136,57.6 126.5,56.2 Z";

/* ---------------- 4. 安静微垂半睁蓝瞳（眼平线精准落在头部高度 53%） ---------------- */

const EYE_L = {
  open: "M87.2,106.4 C92.0,103.5 102.4,103.4 109.0,105.5 C108.2,113.2 103.8,118.2 98.2,118.2 C92.2,118.2 88.0,113.4 87.2,106.4 Z",
  lash: "M85.8,106.6 C90.6,101.8 102.2,101.5 109.8,104.5 L109.0,106.2 C102.2,103.8 92.0,104.0 87.3,107.2 Z",
  flick: "M86.8,106.0 C85.3,105.4 84.3,104.5 83.7,103.5",
  crease: "M89.5,100.6 C94.5,99.0 102.0,99.0 107.2,100.6",
  brow: "M90.2,96.0 C95.4,94.8 102.0,95.2 107.2,96.8",
  lower: "M93.8,119.0 C96.8,119.7 100.2,119.7 103.0,118.8",
  irisCx: 98.5,
  irisCy: 111.0,
  irisRx: 6.9,
  irisRy: 7.6,
  pupilCx: 98.6,
  pupilCy: 111.5,
  hl1: [95.6, 108.2, 1.95],
  hl2: [101.4, 114.5, 0.9]
};

/* ---------------- 5. 宽口立领连帽驼棕披风、米白双镶边与三排搭扣 ---------------- */

const CAPE_FILL =
  "M90,157.5 C72,164.5 53,179 42.5,200.5 C39.2,207 37.2,213.8 36.2,220 L203.8,220 C202.8,213.8 200.8,207 197.5,200.5 C187,179 168,164.5 150,157.5 Z";
const CAPE_OUT_L = "M89.5,158 C72,165 53,179 42.5,200.5 C39.4,206.8 37.5,213.4 36.5,219.2";
const CAPE_OUT_R = mirror(CAPE_OUT_L);

const CAPE_HEM_FILL_L = "M40,205 C56,211 75,213.5 98,212 L98,217.5 C75,219 55.5,216.5 38,210.5 Z";
const CAPE_HEM_TOP_L = "M40,205 C56,211 75,213.5 98,212";
const CAPE_HEM_BOT_L = "M38,210.5 C55.5,216.5 75,219 98,217.5";
const CAPE_HEM_FILL_R = mirror(CAPE_HEM_FILL_L);
const CAPE_HEM_TOP_R = mirror(CAPE_HEM_TOP_L);
const CAPE_HEM_BOT_R = mirror(CAPE_HEM_BOT_L);

const PLACKET_FILL = "M102,159.5 L138,159.5 L139,220 L101,220 Z";
const FRONT_TRIM_FILL_L = "M96.8,163.5 L102.2,162 L101,220 L95.5,220 Z";
const FRONT_TRIM_LINES_L = "M96.8,164.5 L95.5,219.2 M102.2,163 L101,219.2";
const FRONT_TRIM_FILL_R = mirror(FRONT_TRIM_FILL_L);
const FRONT_TRIM_LINES_R = mirror(FRONT_TRIM_LINES_L);

const INNER_COLLAR_FILL =
  "M108.5,146.5 L114,146.5 L120,156.5 L126,146.5 L131.5,146.5 L133.5,161.5 C125.5,165 114.5,165 106.5,161.5 Z";
const INNER_COLLAR_INK =
  "M112.5,146.8 L120,157.5 L127.5,146.8 M108.8,148.2 L114.8,161.8 M131.2,148.2 L125.2,161.8 M120,157.5 L120,163.2";

const STAND_COLLAR_L_FILL =
  "M109,147 C95.5,145.5 85,149.8 83.5,157.8 C82.8,162.5 90,168.5 102,172 L106,163.5 C96,161.2 91.5,157.6 92.8,154.4 C94.2,151.2 101.5,149.8 109,150.2 Z";
const STAND_COLLAR_L_OUT =
  "M108.5,147 C95.5,145.5 85,149.8 83.5,157.8 C82.8,162.5 90.5,168.5 102,171.8";
const STAND_COLLAR_L_IN =
  "M108,150.4 C100.5,150 94,151.5 92.6,154.5 C91.4,157.4 96.2,161 105.2,163.2";
const STAND_COLLAR_CAMEL_L =
  "M83.5,157.8 C83,163.8 89.5,170 101.5,173 L102.5,169.5 C91.5,166.5 86,161.6 86.5,156.8 Z";
const STAND_COLLAR_CAMEL_R = mirror(STAND_COLLAR_CAMEL_L);

const LAPEL_TAB_L_FILL = "M93,169 L103.5,166.5 L105,173.2 L96,174.2 Z";
const LAPEL_TAB_L_INK = "M93,169 L103.5,166.5 L105,173.2 L96,174.2 Z";

const STAND_COLLAR_R_FILL = mirror(STAND_COLLAR_L_FILL);
const STAND_COLLAR_R_OUT = mirror(STAND_COLLAR_L_OUT);
const STAND_COLLAR_R_IN = mirror(STAND_COLLAR_L_IN);
const LAPEL_TAB_R_FILL = mirror(LAPEL_TAB_L_FILL);
const LAPEL_TAB_R_INK = mirror(LAPEL_TAB_L_INK);

const STRAP_ROWS = [177.5, 192.5, 207.5];

/* ---------------- 6. 轻搭在卡片上沿（EDGE_Y=220）的小手 ---------------- */

const HAND_L_FILL =
  "M68.5,220 C68.2,214.6 72.0,211.4 77.5,211.4 C83.0,211.4 86.6,214.6 86.4,220 C86.3,223.4 84.6,225.2 82.6,224.8 C81.4,226.0 79.0,226.0 78.0,224.8 C76.8,226.0 74.4,226.0 73.4,224.8 C71.8,225.4 69.8,224.8 69.0,223.2 C68.6,222.2 68.5,221.1 68.5,220 Z";
const HAND_L_OUT =
  "M68.6,218.8 C68.6,214.4 72.2,211.4 77.5,211.4 C82.8,211.4 86.3,214.4 86.4,219.0 C86.4,223.0 84.8,225.0 82.6,224.8 C81.4,226.0 79.0,226.0 78.0,224.8 C76.8,226.0 74.4,226.0 73.4,224.8 C71.8,225.4 69.8,224.8 69.0,223.2";
const HAND_L_KNUCKLES = "M73.5,224.5 L73.8,221.6 M78.0,224.5 L78.0,221.4 M82.5,224.5 L82.2,221.6";
const HAND_R_FILL = mirror(HAND_L_FILL);
const HAND_R_OUT = mirror(HAND_L_OUT);
const HAND_R_KNUCKLES = mirror(HAND_L_KNUCKLES);

function eyeMarkup(uid, side) {
  const m = side === "R" ? mirror : (d) => d;
  const mx = (x) => (side === "R" ? fmt(240 - x) : x);
  const clipId = `${uid}ec${side}`;
  return `
    <clipPath id="${clipId}"><path d="${m(EYE_L.open)}"/></clipPath>
    <g class="bm7-rx-eye bm7-rx-eye-${side}">
      <path d="${m(EYE_L.open)}" fill="var(--bm7-rx-sclera)"/>
      <g clip-path="url(#${clipId})">
        <ellipse cx="${mx(EYE_L.irisCx)}" cy="${EYE_L.irisCy}" rx="${EYE_L.irisRx}" ry="${EYE_L.irisRy}" fill="url(#${uid}iris)"/>
        <ellipse cx="${mx(EYE_L.irisCx)}" cy="${fmt(EYE_L.irisCy + 2.5)}" rx="${fmt(EYE_L.irisRx - 1.5)}" ry="3.5" fill="var(--bm7-rx-iris-glow)" opacity=".68"/>
        <ellipse cx="${mx(EYE_L.irisCx)}" cy="${EYE_L.irisCy}" rx="${EYE_L.irisRx}" ry="${EYE_L.irisRy}" fill="none" stroke="var(--bm7-rx-iris-rim)" stroke-width="0.75"/>
        <ellipse cx="${mx(EYE_L.pupilCx)}" cy="${EYE_L.pupilCy}" rx="2.6" ry="3.45" fill="var(--bm7-rx-pupil)"/>
        <path d="${m("M86,103.2 C93,102.4 103,102.4 111,104.2 L111,108.8 C103,107.6 93,107.8 86,109.2 Z")}" fill="var(--bm7-rx-lid-shade)"/>
        <circle class="bm7-rx-hl" cx="${mx(EYE_L.hl1[0])}" cy="${EYE_L.hl1[1]}" r="${EYE_L.hl1[2]}" fill="#ffffff"/>
        <circle class="bm7-rx-hl" cx="${mx(EYE_L.hl2[0])}" cy="${EYE_L.hl2[1]}" r="${EYE_L.hl2[2]}" fill="#ffffff" opacity=".88"/>
      </g>
      <path class="bm7-rx-lid" d="${m(EYE_L.lash)}" fill="var(--bm7-rx-line)"/>
      <path pathLength="1" d="${m(EYE_L.flick)}" stroke="var(--bm7-rx-line)" stroke-width="1.05" fill="none"/>
      <path pathLength="1" d="${m(EYE_L.lower)}" stroke="var(--bm7-rx-feature)" stroke-width="0.78" fill="none" opacity=".82"/>
    </g>`;
}

function strapsMarkup() {
  return STRAP_ROWS.map(
    (cy) => `
      <rect x="103" y="${fmt(cy - 4.4)}" width="34" height="8.8" rx="2.4" fill="var(--bm7-rx-cream)" stroke="var(--bm7-rx-line)" stroke-width="1.2"/>
      <path d="M105.2,${fmt(cy + 2.8)} L134.8,${fmt(cy + 2.8)}" stroke="var(--bm7-rx-line)" stroke-width="0.65" opacity=".36"/>
      <circle cx="109.6" cy="${cy}" r="2.35" fill="var(--bm7-rx-button)" stroke="var(--bm7-rx-line)" stroke-width="0.75"/>
      <circle cx="130.4" cy="${cy}" r="2.35" fill="var(--bm7-rx-button)" stroke="var(--bm7-rx-line)" stroke-width="0.75"/>
      <circle cx="108.9" cy="${fmt(cy - 0.8)}" r="0.65" fill="#ffffff" opacity=".6"/>
      <circle cx="129.7" cy="${fmt(cy - 0.8)}" r="0.65" fill="#ffffff" opacity=".6"/>`
  ).join("");
}

function roxyLineArtMarkup(opts = {}) {
  const wash = opts.wash !== false;
  const showAstrolabe = opts.astrolabe !== false;
  const showHands = opts.hands !== false;
  const uid = `bm8rx${Math.random().toString(36).slice(2, 7)}`;

  const astrolabe = showAstrolabe
    ? `<g class="bm7-rx-astrolabe" fill="none" stroke="var(--bm7-rx-astro)" stroke-linecap="round">
        <circle cx="188" cy="54" r="35" stroke-width="0.7" stroke-dasharray="2.4 4.2"/>
        <circle cx="188" cy="54" r="26" stroke-width="0.55"/>
        <path d="M188,29 L209.6,66.5 L166.4,66.5 Z M188,79 L209.6,41.5 L166.4,41.5 Z" stroke-width="0.5"/>
        <circle cx="188" cy="19" r="1.5" fill="var(--bm7-rx-astro)" stroke="none"/>
        <path d="M216,27 L217.2,30 L220.2,31.2 L217.2,32.4 L216,35.4 L214.8,32.4 L211.8,31.2 L214.8,30 Z" fill="var(--bm7-rx-astro)" stroke="none"/>
      </g>`
    : "";

  const baseBacking = wash
    ? `<g class="bm7-rx-backing" clip-path="url(#${uid}aboveEdge)">
        <path d="${HAIR_BACK_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${BRAID_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${CAPE_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${STAND_COLLAR_L_FILL}" fill="var(--bm7-rx-paper-fill)"/><path d="${STAND_COLLAR_R_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${FACE_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${BANGS_FILL}" fill="var(--bm7-rx-paper-fill)"/>
        <path d="${AHOGE_FILL}" fill="var(--bm7-rx-paper-fill)" class="bm7-rx-ahoge-wash"/>
      </g>`
    : "";

  const washLayer = wash
    ? `<g class="bm7-rx-wash" clip-path="url(#${uid}aboveEdge)" transform="translate(1.6 1.2)">
        <path d="${BRAID_FILL}" fill="var(--bm7-rx-hair-deep)"/>
        <path d="${HAIR_BACK_FILL}" fill="url(#${uid}hairGrad)"/>
        <path d="${CAPE_FILL}" fill="url(#${uid}capeGrad)"/>
        <path d="M43,199 C59,186 79,176 97,170 L96,220 L36.2,220 Z" fill="var(--bm7-rx-cloak-shade)" opacity=".36"/>
        <path d="${CAPE_HEM_FILL_L}" fill="var(--bm7-rx-cream)"/><path d="${CAPE_HEM_FILL_R}" fill="var(--bm7-rx-cream)"/>
        <path d="${FRONT_TRIM_FILL_L}" fill="var(--bm7-rx-cream)"/><path d="${FRONT_TRIM_FILL_R}" fill="var(--bm7-rx-cream)"/>
        <path d="${PLACKET_FILL}" fill="var(--bm7-rx-cream)"/>
        <path d="${NECK_FILL}" fill="var(--bm7-rx-skin)"/>
        <path d="${NECK_SHADE}" fill="var(--bm7-rx-skin-shade)"/>
        <path d="${INNER_COLLAR_FILL}" fill="var(--bm7-rx-cream)"/>
        <path d="M113.5,147 L120,156.8 L126.5,147 Z" fill="var(--bm7-rx-skin-shade)" opacity=".45"/>
        <path d="${STAND_COLLAR_L_FILL}" fill="var(--bm7-rx-cream)"/><path d="${STAND_COLLAR_R_FILL}" fill="var(--bm7-rx-cream)"/>
        <path d="${STAND_COLLAR_CAMEL_L}" fill="var(--bm7-rx-cloak)"/><path d="${STAND_COLLAR_CAMEL_R}" fill="var(--bm7-rx-cloak)"/>
        <path d="${LAPEL_TAB_L_FILL}" fill="var(--bm7-rx-cream)"/><path d="${LAPEL_TAB_R_FILL}" fill="var(--bm7-rx-cream)"/>
        <path d="${FACE_FILL}" fill="var(--bm7-rx-skin)"/>
        <path d="M82,96 C93,91.5 147,91.5 158,96 L158,105 C145,100.5 95,100.5 82,105 Z" fill="var(--bm7-rx-skin-shade)" opacity=".5"/>
        <path d="${SIDELOCK_L_FILL}" fill="url(#${uid}hairGrad)"/><path d="${SIDELOCK_R_FILL}" fill="url(#${uid}hairGrad)"/>
        <path d="${BANGS_FILL}" fill="url(#${uid}hairGrad)"/>
        <path d="${HAIR_SHEEN}" fill="#ffffff" opacity=".48"/>
        <path d="${AHOGE_FILL}" fill="var(--bm7-rx-hair)" class="bm7-rx-ahoge-wash"/>
      </g>`
    : "";

  const handsLayer = showHands
    ? `<g class="bm7-rx-g6 bm7-rx-hands">
        <ellipse cx="77.5" cy="221.0" rx="10.8" ry="2.2" fill="rgb(32 22 14 / .15)"/>
        <ellipse cx="162.5" cy="221.0" rx="10.8" ry="2.2" fill="rgb(32 22 14 / .15)"/>
        ${wash ? `<path d="${HAND_L_FILL}" fill="var(--bm7-rx-skin)"/><path d="${HAND_R_FILL}" fill="var(--bm7-rx-skin)"/>` : ""}
        <path pathLength="1" d="${HAND_L_OUT}" fill="none" stroke="var(--bm7-rx-line)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        <path pathLength="1" d="${HAND_R_OUT}" fill="none" stroke="var(--bm7-rx-line)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        <path pathLength="1" d="${HAND_L_KNUCKLES} ${HAND_R_KNUCKLES}" fill="none" stroke="var(--bm7-rx-feature)" stroke-width="0.72" stroke-linecap="round" opacity=".82"/>
      </g>`
    : "";

  return `<svg class="bm7-roxy-art" data-rx="v8" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="洛琪希钢笔淡彩探头插画">
  <defs>
    <clipPath id="${uid}aboveEdge"><rect x="-8" y="-8" width="${VB_W + 16}" height="${EDGE_Y + 8}"/></clipPath>
    <filter id="${uid}pen" x="-4%" y="-4%" width="108%" height="108%">
      <feTurbulence type="fractalNoise" baseFrequency="0.042" numOctaves="2" seed="7" result="w"/>
      <feDisplacementMap in="SourceGraphic" in2="w" scale="0.45" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <linearGradient id="${uid}hairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="var(--bm7-rx-hair-hi)"/>
      <stop offset="58%" stop-color="var(--bm7-rx-hair)"/>
      <stop offset="100%" stop-color="var(--bm7-rx-hair-deep)"/>
    </linearGradient>
    <linearGradient id="${uid}capeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="var(--bm7-rx-cloak)"/>
      <stop offset="100%" stop-color="var(--bm7-rx-cloak-shade)"/>
    </linearGradient>
    <radialGradient id="${uid}iris" cx="50%" cy="66%" r="64%">
      <stop offset="0%" stop-color="var(--bm7-rx-iris-lo)"/>
      <stop offset="56%" stop-color="var(--bm7-rx-eye)"/>
      <stop offset="100%" stop-color="var(--bm7-rx-iris-hi)"/>
    </radialGradient>
    <radialGradient id="${uid}blush" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--bm7-rx-blush)" stop-opacity=".75"/>
      <stop offset="100%" stop-color="var(--bm7-rx-blush)" stop-opacity="0"/>
    </radialGradient>
    <mask id="${uid}mFace" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB_W}" height="${VB_H}">
      <rect width="${VB_W}" height="${VB_H}" fill="#fff"/>
      <path d="${BANGS_FILL}" fill="#000"/>
      <path d="${SIDELOCK_L_FILL}" fill="#000"/>
      <path d="${SIDELOCK_R_FILL}" fill="#000"/>
    </mask>
    <mask id="${uid}mCloth" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB_W}" height="${VB_H}">
      <rect width="${VB_W}" height="${EDGE_Y + 0.5}" fill="#fff"/>
      <path d="${SIDELOCK_L_FILL}" fill="#000"/>
      <path d="${SIDELOCK_R_FILL}" fill="#000"/>
      ${showHands ? `<path d="${HAND_L_FILL}" fill="#000"/><path d="${HAND_R_FILL}" fill="#000"/>` : ""}
    </mask>
    <mask id="${uid}mBraid" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB_W}" height="${VB_H}">
      <rect width="${VB_W}" height="${EDGE_Y}" fill="#fff"/>
      <path d="${CAPE_FILL}" fill="#000"/>
      <path d="${STAND_COLLAR_L_FILL}" fill="#000"/>
      <path d="${HAIR_BACK_FILL}" fill="#000"/>
    </mask>
  </defs>
  ${astrolabe}
  ${baseBacking}
  ${washLayer}
  <g class="bm7-rx-ink" fill="none" stroke="var(--bm7-rx-line)" stroke-linecap="round" stroke-linejoin="round">
    <g class="bm7-rx-g5 bm7-rx-braid" mask="url(#${uid}mBraid)" filter="url(#${uid}pen)">
      <path pathLength="1" d="${BRAID_INK}" stroke-width="1.05" opacity=".82"/>
    </g>
    <g class="bm7-rx-g1 bm7-rx-cloth" mask="url(#${uid}mCloth)">
      <g filter="url(#${uid}pen)">
        <path pathLength="1" d="${CAPE_OUT_L}" stroke-width="2.15"/>
        <path pathLength="1" d="${CAPE_OUT_R}" stroke-width="2.15"/>
        <path pathLength="1" d="${CAPE_HEM_TOP_L} ${CAPE_HEM_TOP_R}" stroke-width="0.9"/>
        <path pathLength="1" d="${CAPE_HEM_BOT_L} ${CAPE_HEM_BOT_R}" stroke-width="1.45"/>
        <path pathLength="1" d="${FRONT_TRIM_LINES_L} ${FRONT_TRIM_LINES_R}" stroke-width="1.15"/>
        <path pathLength="1" d="${STAND_COLLAR_L_OUT} ${STAND_COLLAR_R_OUT}" stroke-width="1.45"/>
        <path pathLength="1" d="${STAND_COLLAR_L_IN} ${STAND_COLLAR_R_IN}" stroke-width="0.85"/>
        <path pathLength="1" d="${LAPEL_TAB_L_INK} ${LAPEL_TAB_R_INK}" stroke-width="1.05"/>
        <path pathLength="1" d="M62,188 C65,198 67,205 67.5,210 M178,188 C175,198 173,205 172.5,210" stroke-width="0.72" opacity=".48"/>
      </g>
      ${strapsMarkup()}
    </g>
    <g class="bm7-rx-g2 bm7-rx-neck">
      <path pathLength="1" d="${NECK_INK}" stroke-width="1.15"/>
      <path pathLength="1" d="${INNER_COLLAR_INK}" stroke-width="0.88"/>
    </g>
    <g class="bm7-rx-g2 bm7-rx-hairback" clip-path="url(#${uid}aboveEdge)" filter="url(#${uid}pen)">
      <path pathLength="1" d="${HAIR_OUTLINE_L}" stroke-width="2.1"/>
      <path pathLength="1" d="${HAIR_OUTLINE_R}" stroke-width="2.1"/>
      <path pathLength="1" d="${HAIR_CROWN_CREASES}" stroke-width="0.78" opacity=".62"/>
    </g>
    <g class="bm7-rx-g3 bm7-rx-face">
      <g mask="url(#${uid}mFace)">
        <path pathLength="1" d="${EAR_L} ${EAR_R}" stroke="var(--bm7-rx-feature)" stroke-width="1.05"/>
        <path pathLength="1" d="${JAW_L}" stroke-width="1.82"/>
        <path pathLength="1" d="${JAW_R}" stroke-width="1.82"/>
        <ellipse cx="91.2" cy="123.2" rx="7.6" ry="3.4" fill="url(#${uid}blush)" stroke="none"/>
        <ellipse cx="148.8" cy="123.2" rx="7.6" ry="3.4" fill="url(#${uid}blush)" stroke="none"/>
        <path class="bm7-rx-blush-ink" d="M88.2,124.4 L90.2,121.6 M91.5,124.6 L93.5,121.8 ${mirror("M88.2,124.4 L90.2,121.6 M91.5,124.6 L93.5,121.8")}" stroke="var(--bm7-rx-blush-line)" stroke-width="0.68"/>
        <path pathLength="1" d="${EYE_L.crease} ${mirror(EYE_L.crease)}" stroke="var(--bm7-rx-feature)" stroke-width="0.72" opacity=".62"/>
        <g class="bm7-rx-eyes">
          ${eyeMarkup(uid, "L")}
          ${eyeMarkup(uid, "R")}
        </g>
        <path pathLength="1" d="M119.8,122.6 L120.3,124.1" stroke="var(--bm7-rx-feature)" stroke-width="0.92"/>
        <ellipse cx="120" cy="131.6" rx="2.1" ry="0.9" fill="var(--bm7-rx-blush)" opacity=".28" stroke="none"/>
        <path pathLength="1" d="M117.1,130.6 Q120,129.9 122.9,130.6" stroke="var(--bm7-rx-feature)" stroke-width="1.02"/>
      </g>
      <path pathLength="1" d="${EYE_L.brow} ${mirror(EYE_L.brow)}" stroke="var(--bm7-rx-line)" stroke-width="0.92" opacity=".58"/>
    </g>
    <g class="bm7-rx-g5 bm7-rx-locks" filter="url(#${uid}pen)">
      <path pathLength="1" d="${SIDELOCK_L_OUT} ${SIDELOCK_R_OUT}" stroke-width="1.48"/>
      <path pathLength="1" d="${SIDELOCK_L_IN} ${SIDELOCK_R_IN}" stroke-width="1.22"/>
      <path pathLength="1" d="${SIDELOCK_L_STRAND} ${SIDELOCK_R_STRAND}" stroke-width="0.72" opacity=".62"/>
    </g>
    <g class="bm7-rx-g4 bm7-rx-bangs" filter="url(#${uid}pen)">
      <path pathLength="1" d="${BANGS_EDGE}" stroke-width="1.35"/>
      <path pathLength="1" d="${BANGS_STRANDS}" stroke-width="0.75" opacity=".62"/>
    </g>
    <g class="bm7-rx-g4 bm7-rx-ahoge" filter="url(#${uid}pen)">
      <path pathLength="1" d="${AHOGE_OUTER}" stroke-width="1.75"/>
      <path pathLength="1" d="${AHOGE_INNER}" stroke-width="0.95"/>
    </g>
    ${handsLayer}
  </g>
</svg>`;
}

/**
 * 洛琪希手记 · 巫师帽、魔导书、白羽鹅毛笔、水滴史莱姆墨水瓶与热红茶小插画
 */
function roxyDeskVignetteMarkup() {
  const uid = `bm7rxd${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="bm7-rxnote-art" viewBox="0 0 212 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="${uid}hat" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3e4763"/><stop offset="58%" stop-color="#282f44"/><stop offset="100%" stop-color="#1c2130"/>
      </linearGradient>
      <linearGradient id="${uid}book" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8f5d38"/><stop offset="100%" stop-color="#6e4427"/>
      </linearGradient>
      <radialGradient id="${uid}gem" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#c4eeff"/><stop offset="48%" stop-color="#4b9ae3"/><stop offset="100%" stop-color="#20558f"/>
      </radialGradient>
    </defs>
    <ellipse cx="106" cy="118" rx="86" ry="8.5" fill="currentColor" fill-opacity="0.08"/>
    <g transform="rotate(-17 104 70)">
      <path d="M20,72 L166,72" stroke="#6d4929" stroke-width="4.8" stroke-linecap="round"/>
      <path d="M24,71 L164,71" stroke="#a4784c" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M160,72 C168,60 185,61 188,72 C185,83 168,84 160,72 Z" fill="none" stroke="#6d4929" stroke-width="3.3"/>
      <circle cx="174" cy="72" r="7" fill="url(#${uid}gem)" stroke="#dcf5ff" stroke-width="1"/>
      <circle cx="172" cy="69.5" r="2" fill="#fff" fill-opacity="0.88"/>
    </g>
    <g transform="translate(28, 88)">
      <rect x="0" y="10" width="94" height="16" rx="3" fill="url(#${uid}book)" stroke="#4d311c" stroke-width="1.15"/>
      <rect x="5" y="12.6" width="86" height="10.6" rx="1.5" fill="#f7efe2" stroke="#cbb89d" stroke-width="0.8"/>
      <line x1="8" y1="15.8" x2="88" y2="15.8" stroke="#d8c7ae" stroke-width="0.7"/>
      <line x1="8" y1="19.2" x2="86" y2="19.2" stroke="#d8c7ae" stroke-width="0.7"/>
      <path d="M36,23 L32,32 L38,29.4 L43,33 L44,23 Z" fill="#b84a39"/>
      <rect x="8" y="0" width="80" height="11.5" rx="2.4" fill="#3b5e8c" stroke="#263f61" stroke-width="1.05"/>
      <rect x="13" y="2.4" width="72" height="6.8" rx="1" fill="#fbf5ea"/>
      <rect x="23" y="0" width="6.5" height="11.5" fill="#c99b52"/>
    </g>
    <g transform="translate(15, 10)">
      <ellipse cx="64" cy="68" rx="52" ry="12" fill="#181c29" transform="rotate(-4 64 68)"/>
      <path d="M31,64 C38,39 49,15 61,6 C72,-1 87,5 96,16 C85,16 75,20 71,28 C76,41 85,53 96,64 Z" fill="url(#${uid}hat)" stroke="#151924" stroke-width="1.25" stroke-linejoin="round"/>
      <path d="M32,59 Q64,67 95,58 L97,64 Q64,73 30,64 Z" fill="#9e4238" stroke="#471d18" stroke-width="1"/>
      <rect x="58" y="57" width="12.5" height="9.5" rx="2" fill="#d9a74a" stroke="#5c4014" stroke-width="1.05"/>
      <rect x="61" y="59.4" width="6.5" height="4.6" rx="1" fill="#282e40"/>
      <path d="M10,68 C24,56 106,54 119,65 C108,79 25,81 10,68 Z" fill="url(#${uid}hat)" stroke="#151924" stroke-width="1.25"/>
      <path d="M18,67 C35,60 94,58 111,65" fill="none" stroke="#667399" stroke-width="0.85" stroke-opacity="0.6"/>
    </g>
    <g transform="translate(132, 74)">
      <path d="M22,22 C29,6 44,-6 56,-10 C53,2 44,15 28,25 Z" fill="#fcf9f2" stroke="#6a6054" stroke-width="1"/>
      <path d="M20,27 L52,-7" stroke="#7d6e5d" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M17,31 L22,24" stroke="#c99b52" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M18,20 C8,20 3,29 5,37 C7,42.5 29,42.5 31,37 C33,29 28,20 18,20 Z" fill="#5e97d6" fill-opacity="0.9" stroke="#264973" stroke-width="1.15"/>
      <rect x="12.5" y="15.5" width="11" height="5" rx="1.6" fill="#d8c7ae" stroke="#5c4934" stroke-width="1"/>
      <ellipse cx="13" cy="27" rx="3.2" ry="1.8" fill="#fff" fill-opacity="0.68" transform="rotate(-18 13 27)"/>
      <circle cx="14" cy="32" r="1.4" fill="#1d2d44"/><circle cx="22" cy="32" r="1.4" fill="#1d2d44"/>
      <path d="M16.2,35 Q18,36.8 19.8,35" fill="none" stroke="#1d2d44" stroke-width="0.95" stroke-linecap="round"/>
      <g transform="translate(38, 22)">
        <ellipse cx="11" cy="19.5" rx="12.5" ry="3" fill="#e8decb" stroke="#8f683d" stroke-width="1"/>
        <path d="M2,8 L20,8 L18,18.5 C17,20.5 5,20.5 4,18.5 Z" fill="#fbf7f0" stroke="#8f683d" stroke-width="1.05"/>
        <path d="M20,10 C24.6,10 24.6,16.6 19,16.6" fill="none" stroke="#8f683d" stroke-width="1.15"/>
        <path class="bm7-rxnote-steam" d="M8,4 Q6,0 9,-3.5 M14,5 Q12,1 15,-2.5" fill="none" stroke="#9e784b" stroke-width="0.9" stroke-opacity="0.58" stroke-linecap="round"/>
      </g>
    </g>
    <g fill="#4a89c7" fill-opacity="0.68">
      <path d="M22,32 L23.8,36.4 L28.2,38.2 L23.8,40 L22,44.4 L20.2,40 L15.8,38.2 L20.2,36.4 Z"/>
      <path d="M150,20 L151.4,23.6 L155,25 L151.4,26.4 L150,30 L148.6,26.4 L145,25 L148.6,23.6 Z" fill="#c99b52"/>
    </g>
  </svg>`;
}

/**
 * 基于真实番剧收藏状态生成洛琪希手写批注（零生造词，口语自然温和）
 */
function buildRoxyReadingNotes(items = [], localNewCount = 0) {
  const valid = Array.isArray(items) ? items.filter(Boolean) : [];
  const real = valid.filter((it) => !it.isSamplePreviewItem);
  const list = real.length > 0 ? real : valid;
  const total = list.length;
  const watching = list.filter((it) => it.state === "在看");
  const completed = list.filter((it) => it.state === "已看");
  const planned = list.filter((it) => it.state === "想看");
  const watchedEps = list.reduce((s, it) => s + (Number(it.watchedEpisodes) || 0), 0);
  const hours = Math.round(watchedEps * 0.4 * 10) / 10;
  const scored = list.filter((it) => it.personalScore !== null && it.personalScore !== undefined && Number.isFinite(Number(it.personalScore)));
  const highRated = scored.filter((it) => Number(it.personalScore) >= 8.5);
  const totalReviews = list.reduce((s, it) => s + (Array.isArray(it.reviews) ? it.reviews.length : 0), 0);

  const notes = [];
  if (total === 0) {
    notes.push("还没有登记动画呢。先搜一部喜欢的作品收进来吧，封面、集数和手札我都会帮您一页页记好的。");
    return notes;
  }
  if (localNewCount > 0) {
    notes.push(`本地文件夹里已经有 ${localNewCount} 部在看动画下好了新集数，闲下来的时候随时点上面的播放按钮就能接着看。`);
  }
  if (watchedEps >= 120) {
    notes.push(`不知不觉间，您已经看完了 ${watchedEps} 集动画，折算下来大约有 ${hours} 小时呢。一集一集认真记到现在，翻看的时候真的很有成就感。`);
  } else if (watchedEps > 0) {
    notes.push(`目前手记里一共记下了 ${watchedEps} 集进度（约 ${hours} 小时）。每次看完顺手点一下「看完」，慢慢攒起来就是一份很踏实的回忆。`);
  } else {
    notes.push(`已经收进了 ${total} 部动画，不过集数都还停在 0 集呢。以前看过的作品随时改一下状态或点「+1」，进度就补齐了。`);
  }
  if (watching.length >= 6) {
    notes.push(`您现在同时追着 ${watching.length} 部动画，稍微有点多呢。要是隔几天没看怕忘掉剧情，可以在焦点卡片上顺手留一句本集吐槽。`);
  } else if (watching.length >= 1) {
    notes.push(`现在保持着 ${watching.length} 部在看作品的步调，节奏刚刚好，既不会觉得追更太赶，也能静下心把每一集看完。`);
  }
  if (total >= 5 && completed.length / total >= 0.6) {
    const rate = Math.round((completed.length / total) * 100);
    notes.push(`收录的 ${total} 部动画里已经看完了 ${completed.length} 部（完结率 ${rate}%），一旦开看就有始有终，是很认真的看番习惯呢。`);
  }
  if (planned.length >= Math.max(5, Math.ceil(total * 0.42))) {
    notes.push(`想看列表里已经攒了 ${planned.length} 部作品啦。要是挑花眼拿不定主意，不妨让下面的「随机看一集」帮您抽一部开看。`);
  }
  if (scored.length >= 4) {
    const myAvg = scored.reduce((s, it) => s + Number(it.personalScore), 0) / scored.length;
    notes.push(`您已经给 ${scored.length} 部作品打过分（均分 ${myAvg.toFixed(1)}，8.5 分以上的佳作有 ${highRated.length} 部），过阵子回头翻看就明白当时的喜好了。`);
  }
  if (totalReviews > 0) {
    notes.push(`笔记里已经写下了 ${totalReviews} 条观片手札。比起单纯的数字，当时顺手记下的那几句真情实感才最珍贵呢。`);
  }
  return notes;
}

/**
 * 渲染「洛琪希手记」专属页边批注卡（带魔法阵暗纹、巫师帽羽毛笔插画、笔锋换句灵气与零硬跳水波收拢/展开过渡）
 */
function renderRoxyHandbookCard(host, opts = {}) {
  clear(host);
  let notes = buildRoxyReadingNotes(opts.items || [], opts.localNewCount || 0);
  if (!notes.length) return null;

  const state = {
    collapsed: Boolean(opts.collapsed),
    idx: Math.floor(Math.random() * notes.length)
  };
  let quoteWrapEl = null;
  let quoteTextSpan = null;
  let cardEl = null;
  const morphEl = h("div.bm8-rxnote-morph");
  ensureRoxyWaveFilterDefs(host);
  host.appendChild(morphEl);

  const buildPillNode = () => {
    const pill = h(
      "button.bm7-rxnote-pill",
      {
        attr: { type: "button", title: "展开洛琪希的手写批注" },
        on: {
          click: () => {
            if (morphEl.dataset.morphing === "1") return;
            state.collapsed = false;
            opts.onCollapseChange && opts.onCollapseChange(false);
            if (!canAnimateRoxyNote(morphEl)) {
              paint();
              return;
            }
            const nextCard = buildCardNode();
            cardEl = nextCard;
            triggerRoxyNotePillExpand(morphEl, pill, nextCard, () => {});
          }
        }
      },
      [icon("pen", 13), h("span", { text: "展开洛琪希的批注" })]
    );
    return pill;
  };

  const buildCardNode = () => {
    quoteTextSpan = h("span.bm8-rx-quote-text", { text: `「${notes[state.idx % notes.length]}」` });
    quoteWrapEl = h("p.bm7-rxnote-quote", [quoteTextSpan]);
    const bgWatermark = svgEl(`<svg class="bm7-rxnote-wm" viewBox="0 0 360 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="translate(106,75)" stroke="currentColor" fill="none" opacity="0.13">
        <circle r="66" stroke-width="1" stroke-dasharray="4 3"/>
        <circle r="52" stroke-width="0.8"/>
        <circle r="36" stroke-width="0.7" stroke-dasharray="2 4"/>
        <polygon points="0,-52 45,26 -45,26" stroke-width="0.75"/>
        <polygon points="0,52 45,-26 -45,-26" stroke-width="0.75"/>
        <line x1="-72" y1="0" x2="72" y2="0" stroke-width="0.6" stroke-dasharray="3 3"/>
        <line x1="0" y1="-72" x2="0" y2="72" stroke-width="0.6" stroke-dasharray="3 3"/>
      </g>
    </svg>`);

    const node = h("section.bm7-rxnote-card", [
      bgWatermark,
      h("div.bm7-rxnote-illus", [svgEl(roxyDeskVignetteMarkup())]),
      h("div.bm7-rxnote-body", [
        h("div.bm7-rxnote-head", [
          h("span.bm7-rxnote-kicker", [icon("pen", 13), h("span", { text: "洛琪希的批注" })]),
          h("div.bm7-rxnote-actions", [
            notes.length > 1
              ? button("换一条", {
                  icon: "refresh",
                  variant: "ghost",
                  cls: "bm7-rxnote-btn",
                  onClick: () => {
                    state.idx = (state.idx + 1) % notes.length;
                    triggerRoxyNoteInkSwitch(quoteWrapEl, `「${notes[state.idx]}」`);
                  }
                })
              : null,
            iconButton(
              "close",
              "收起批注",
              () => {
                if (morphEl.dataset.morphing === "1") return;
                if (!canAnimateRoxyNote(morphEl)) {
                  state.collapsed = true;
                  opts.onCollapseChange && opts.onCollapseChange(true);
                  paint();
                  return;
                }
                const nextPill = buildPillNode();
                triggerRoxyNoteSpellDissolve(morphEl, node, nextPill, () => {
                  state.collapsed = true;
                  opts.onCollapseChange && opts.onCollapseChange(true);
                  if (node.parentNode) node.remove();
                  cardEl = null;
                  quoteWrapEl = null;
                  quoteTextSpan = null;
                });
              },
              "bm7-rxnote-close"
            )
          ])
        ]),
        quoteWrapEl
      ])
    ]);
    return node;
  };

  const paint = () => {
    clear(morphEl);
    quoteWrapEl = null;
    quoteTextSpan = null;
    cardEl = null;
    if (state.collapsed) {
      morphEl.appendChild(buildPillNode());
      return;
    }
    cardEl = buildCardNode();
    morphEl.appendChild(cardEl);
  };

  paint();
  return {
    repaint: paint,
    updateNotes(nextItems, nextLocalNewCount = 0) {
      const next = buildRoxyReadingNotes(nextItems, nextLocalNewCount);
      if (!next.length) return;
      notes = next;
      if (
        quoteTextSpan &&
        !state.collapsed &&
        morphEl.dataset.morphing !== "1" &&
        (!quoteWrapEl || quoteWrapEl.dataset.switching !== "1")
      ) {
        quoteTextSpan.textContent = `「${notes[state.idx % notes.length]}」`;
      }
    }
  };
}

const ROXY_V8_CSS = String.raw`
.bm7-roxy-art[data-rx="v8"] {
  --bm7-rx-line: #3b291e;
  --bm7-rx-feature: #7e4335;
  --bm7-rx-paper-fill: #fdf9f1;
  --bm7-rx-hair-hi: #8fa6de;
  --bm7-rx-hair: #728aca;
  --bm7-rx-hair-deep: #566fb2;
  --bm7-rx-cloak: #b38d5e;
  --bm7-rx-cloak-shade: #947047;
  --bm7-rx-cream: #f6efe1;
  --bm7-rx-button: #2f2825;
  --bm7-rx-skin: #fcebe0;
  --bm7-rx-skin-shade: #eecab6;
  --bm7-rx-blush: #f29890;
  --bm7-rx-blush-line: #d6746b;
  --bm7-rx-sclera: #fffdfa;
  --bm7-rx-eye: #5171c6;
  --bm7-rx-iris-hi: #2b3e7c;
  --bm7-rx-iris-lo: #9ec3f5;
  --bm7-rx-iris-glow: #bad7ff;
  --bm7-rx-iris-rim: #283566;
  --bm7-rx-pupil: #1b213d;
  --bm7-rx-lid-shade: rgb(36 46 88 / .32);
  --bm7-rx-astro: color-mix(in srgb, var(--bm7-accent, #3d55b0) 48%, transparent);
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  color: var(--bm7-rx-line);
}
.theme-dark .bm7-roxy-art[data-rx="v8"],
.bm7-root[data-bm7-theme="cinema"] .bm7-roxy-art[data-rx="v8"] {
  --bm7-rx-line: #2c1e16;
  --bm7-rx-feature: #6e392d;
  --bm7-rx-paper-fill: #f2eadc;
  --bm7-rx-hair-hi: #859cd5;
  --bm7-rx-hair: #6981c1;
  --bm7-rx-hair-deep: #4f67a7;
  --bm7-rx-cloak: #a88254;
  --bm7-rx-cloak-shade: #87643d;
  --bm7-rx-cream: #efe6d5;
  --bm7-rx-skin: #f6e2d4;
  --bm7-rx-skin-shade: #e4bea8;
  --bm7-rx-sclera: #faf6ef;
}
.bm7-roxy-art[data-rx="v8"] .bm7-rx-hl {
  fill: #ffffff !important;
}
.bm7-roxy-art[data-rx="v8"] .bm7-rx-wash {
  opacity: .92;
  mix-blend-mode: multiply;
}
.theme-dark .bm7-roxy-art[data-rx="v8"] .bm7-rx-wash,
.bm7-root[data-bm7-theme="cinema"] .bm7-roxy-art[data-rx="v8"] .bm7-rx-wash {
  opacity: .95;
  mix-blend-mode: normal;
}
.bm7-roxy-art[data-rx="v8"] .bm7-rx-astrolabe {
  opacity: .48;
  transform-box: view-box;
  transform-origin: 188px 54px;
}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-roxy-art[data-rx="v8"] .bm7-rx-astrolabe {
  animation: bm8-astrolabe-turn 68s linear infinite;
}
.bm7-roxy-art[data-rx="v8"] .bm7-rx-ahoge,
.bm7-roxy-art[data-rx="v8"] .bm7-rx-ahoge-wash {
  transform-box: view-box;
  transform-origin: 119px 40.5px;
}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-roxy-art[data-rx="v8"] .bm7-rx-ahoge-wash {
  animation: bm7-ahoge-sway 5.4s ease-in-out 1.1s infinite;
}
.bm7-roxy-art[data-rx="v8"] .bm7-rx-eyes {
  transform-box: view-box;
  transform-origin: 120px 111px;
}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-roxy-art[data-rx="v8"] .bm7-rx-backing {
  animation: bm7-fade-in .45s ease .22s both;
}
@keyframes bm8-astrolabe-turn {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 洛琪希手记批注卡：换一条笔锋流转 + 零硬跳水系置换收拢与舒展过渡 */
.bm8-rxnote-morph {
  position: relative;
  min-width: 0;
  width: 100%;
}
.bm8-rxnote-morph.is-morphing {
  position: relative !important;
  overflow: hidden !important;
  min-height: 0 !important;
  will-change: height;
}
.bm8-rxnote-morph.is-morphing > .bm7-rxnote-card {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  margin: 0 !important;
}
.bm7-rxnote-quote {
  position: relative;
}
.bm8-rx-quote-text {
  display: inline-block;
  width: 100%;
}
.bm8-rx-quote-text.bm8-rx-quote-out {
  opacity: .16;
  transform: translateX(-4px);
  transition: opacity .095s ease, transform .095s ease;
}
.bm8-rx-quote-text.bm8-rx-quote-ink-out {
  opacity: .22;
  color: color-mix(in srgb, var(--bm7-accent) 76%, var(--bm7-ink-2));
  filter: blur(1.1px);
  transform: translateX(-3px);
  transition: opacity .13s ease, color .12s ease, filter .13s ease, transform .13s ease;
}
.bm8-rx-quote-text.bm8-rx-quote-in {
  animation: bm8-rx-quote-settle .28s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-rx-quote-fx {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: inherit;
}

/* 收拢为书签胶囊（连贯淡出 + 水波置换 + 胶囊原位柔和显现） */
.bm7-rxnote-card.is-dissolving-spell {
  pointer-events: none !important;
  transform-origin: left top;
  filter: url(#bm8-rxnote-wave-filter);
  animation: bm8-rx-spell-dissolve .56s cubic-bezier(.25, .8, .28, 1) forwards;
}
.bm7-rxnote-card.is-collapsing-lite {
  pointer-events: none !important;
  transform-origin: left top;
  animation: bm8-rx-collapse-lite .32s cubic-bezier(.22, 1, .36, 1) forwards;
}
.bm7-rxnote-card.is-dissolving-spell .bm7-rxnote-head,
.bm7-rxnote-card.is-dissolving-spell .bm7-rxnote-illus,
.bm7-rxnote-card.is-dissolving-spell .bm7-rxnote-wm {
  opacity: 0;
  filter: blur(1.5px);
  transition: opacity .34s ease .06s, filter .34s ease .06s;
}
.bm7-rxnote-card.is-dissolving-spell .bm7-rxnote-quote {
  color: color-mix(in srgb, var(--bm7-accent) 72%, var(--bm7-ink-2));
  transition: color .16s ease, opacity .34s ease .08s, filter .34s ease .08s;
  opacity: .12;
  filter: blur(1.4px);
}
.bm7-root .bm7-rxnote-pill.is-emerging-pill {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 5;
  opacity: 0;
  transform: translateY(5px) scale(.97);
  transition: opacity .28s cubic-bezier(.22, 1, .36, 1), transform .28s cubic-bezier(.22, 1, .36, 1);
}
.bm7-root .bm7-rxnote-pill.is-emerging-pill.is-shown {
  opacity: 1;
  transform: none;
}

/* 反向展开批注卡（胶囊隐退 + 纸页自左上舒展铺开） */
.bm7-root .bm7-rxnote-pill.is-fading-pill {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 4;
  pointer-events: none;
  transition: opacity .18s ease, transform .2s ease;
}
.bm7-root .bm7-rxnote-pill.is-fading-pill.is-out {
  opacity: 0;
  transform: translateY(-3px) scale(.96);
}
.bm7-rxnote-card.is-expanding-card {
  opacity: 0;
  transform: translateY(-6px) scale(.988);
  transform-origin: left top;
  transition: opacity .36s cubic-bezier(.22, 1, .36, 1) .04s, transform .40s cubic-bezier(.22, 1, .36, 1) .04s;
}
.bm7-rxnote-card.is-expanding-lite {
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity .26s ease, transform .28s cubic-bezier(.22, 1, .36, 1);
}
.bm7-rxnote-card.is-expanding-card.is-in,
.bm7-rxnote-card.is-expanding-lite.is-in {
  opacity: 1;
  transform: none;
}

.bm8-rx-dissolve-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  overflow: hidden;
  border-radius: inherit;
}
.bm8-rx-stroke-particle {
  position: absolute;
  font-size: 13px;
  font-weight: 600;
  color: color-mix(in srgb, var(--bm7-accent) 82%, #4d9de0);
  opacity: 0;
  animation: bm8-rx-stroke-wander .44s cubic-bezier(.22, 1, .36, 1) forwards;
  user-select: none;
}
.bm8-rx-stroke-particle.is-amber {
  color: #c99b49;
}
.bm8-rx-serpent-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.bm8-rx-serpent-path {
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 0.44 0.86;
  stroke-dashoffset: 0.48;
  opacity: 0;
  animation: bm8-rx-serpent-flow .50s cubic-bezier(.22, 1, .36, 1) forwards;
}
@keyframes bm8-rx-quote-settle {
  from { opacity: 0; transform: translateX(6px); filter: blur(.6px); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes bm8-rx-stroke-wander {
  0% { opacity: 0; transform: translate3d(0, 2px, 0) scale(.75); }
  30% { opacity: .9; }
  100% { opacity: 0; transform: translate3d(var(--rx-dx, 10px), var(--rx-dy, -14px), 0) rotate(var(--rx-rot, 14deg)) scale(.7); }
}
@keyframes bm8-rx-serpent-flow {
  0% { opacity: 0; stroke-dashoffset: 0.50; }
  32% { opacity: .92; }
  100% { opacity: 0; stroke-dashoffset: -0.66; }
}
@keyframes bm8-rx-spell-dissolve {
  0% { opacity: 1; transform: scale(1) translateY(0); }
  36% { opacity: .82; transform: scale(.994) translateY(-2px) skewX(.6deg); }
  100% { opacity: 0; transform: scale(.965) translateY(-10px); }
}
@keyframes bm8-rx-collapse-lite {
  0% { opacity: 1; transform: scale(1) translateY(0); }
  100% { opacity: 0; transform: scale(.985) translateY(-6px); }
}
`;

module.exports = {
  roxyLineArtMarkup,
  roxyDeskVignetteMarkup,
  buildRoxyReadingNotes,
  renderRoxyHandbookCard,
  triggerRoxyNoteSpellDissolve,
  triggerRoxyNotePillExpand,
  triggerRoxyNoteInkSwitch,
  mirror,
  ROXY_V8_CSS,
  VB_W,
  VB_H,
  EDGE_Y
};
