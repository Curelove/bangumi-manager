/**
 * v0.8 视觉交互增强与统一「看番记录」多维透镜面板
 * -----------------------------------------------------------------
 * 1. attachCoverGlowMotion : 「封面柔光」光标追光池、磨砂玻璃边缘折射高光、封面微倾与柔光呼吸
 * 2. inkPageSwap           : 「洛琪希手记」书页轻掀 + 钢笔水系墨迹显影 + 水色四芒星微光转场
 * 3. renderWatchLensDeck   : 统一「看番记录」面板（最近看番 / 在看进度 / 想看清单 / 我的口味，支持「逐页 ↔ 平铺」切换，零内部纵向滚动条）
 */
const { h, clear, svgEl, icon, button, iconButton, coverEl, formatCount, motionTier } = require("./v07-core.js");
const num = (n) => (typeof formatCount === "function" ? formatCount(Number(n) || 0) : Number(n || 0).toLocaleString("zh-CN"));

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_) {
    return false;
  }
}

function getTier(el) {
  if (typeof motionTier === "function") return motionTier(el);
  const root = el && el.closest ? el.closest(".bm7-root") : null;
  if (root) {
    const t = root.getAttribute("data-bm7-motion-tier");
    if (t === "off" || t === "lite" || t === "full") return t;
    const flag = root.getAttribute("data-bm7-motion");
    if (flag === "off") return "off";
    if (flag === "on") return "full";
  }
  return prefersReducedMotion() ? "off" : "full";
}

function isMotionActive(rootEl, expectedTheme) {
  if (!rootEl) return false;
  if (getTier(rootEl) === "off") return false;
  if (expectedTheme && rootEl.dataset.bm7Theme !== expectedTheme) return false;
  return true;
}

/* =========================================================================
 * 1. 封面柔光（data-bm7-theme="glow"）：光标追光池 + 磨砂边缘折射 + 封面微倾
 * ========================================================================= */

const RIM_PANEL_SELECTOR = ".bm7-hero, .bm7-panel, .bm8-lens, .bm7-feed";

function attachCoverGlowMotion(rootEl) {
  if (!rootEl) return { refresh() {}, destroy() {} };
  if (rootEl._bm8GlowMotion) {
    rootEl._bm8GlowMotion.refresh();
    return rootEl._bm8GlowMotion;
  }

  let rafId = 0;
  let tx = 0.36;
  let ty = 0.24;
  let cx = 0.36;
  let cy = 0.24;
  let clientX = -9999;
  let clientY = -9999;
  let pointerInside = false;
  let rimPanels = [];
  let heroCover = null;

  const ensurePoolAndRims = () => {
    const glowBox = rootEl.querySelector(".bm7-decor-glow");
    if (glowBox && !glowBox.querySelector(".bm8-glow-pool")) {
      glowBox.appendChild(h("div.bm8-glow-pool"));
    }

    rimPanels = Array.from(rootEl.querySelectorAll(RIM_PANEL_SELECTOR));
    for (const panel of rimPanels) {
      if (!panel.querySelector(":scope > .bm8-rim-light")) {
        panel.appendChild(h("span.bm8-rim-light", { attr: { "aria-hidden": "true" } }));
      }
    }

    heroCover = rootEl.querySelector(".bm7-hero-cover");
    if (heroCover) {
      heroCover.classList.add("bm8-tilt");
      if (!heroCover.querySelector(":scope > .bm8-glare")) {
        heroCover.appendChild(h("span.bm8-glare", { attr: { "aria-hidden": "true" } }));
      }
    }
  };

  const resetInlineTilt = () => {
    if (heroCover) {
      heroCover.style.setProperty("--bm8-tx", "0deg");
      heroCover.style.setProperty("--bm8-ty", "0deg");
    }
    for (const p of rimPanels) {
      p.style.setProperty("--bm8-rim-a", "0");
    }
  };

  const step = () => {
    rafId = 0;
    if (!rootEl.isConnected || !isMotionActive(rootEl, "glow") || getTier(rootEl) !== "full") {
      resetInlineTilt();
      return;
    }

    cx += (tx - cx) * 0.16;
    cy += (ty - cy) * 0.16;

    rootEl.style.setProperty("--bm8-mx", `${(cx * 100).toFixed(2)}%`);
    rootEl.style.setProperty("--bm8-my", `${(cy * 100).toFixed(2)}%`);
    rootEl.style.setProperty("--bm7-px", (cx - 0.5).toFixed(3));
    rootEl.style.setProperty("--bm7-py", (cy - 0.5).toFixed(3));

    if (pointerInside && clientX > -9000) {
      for (const panel of rimPanels) {
        if (!panel.isConnected) continue;
        const r = panel.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const lx = clientX - r.left;
        const ly = clientY - r.top;
        const dx = lx < 0 ? -lx : lx > r.width ? lx - r.width : 0;
        const dy = ly < 0 ? -ly : ly > r.height ? ly - r.height : 0;
        const dist = Math.hypot(dx, dy);
        const alpha = Math.max(0, 1 - dist / 240);
        panel.style.setProperty("--bm8-rim-x", `${lx.toFixed(1)}px`);
        panel.style.setProperty("--bm8-rim-y", `${ly.toFixed(1)}px`);
        panel.style.setProperty("--bm8-rim-a", alpha.toFixed(3));
      }

      if (heroCover && heroCover.isConnected) {
        const cr = heroCover.getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          const nx = (clientX - (cr.left + cr.width / 2)) / (cr.width / 2);
          const ny = (clientY - (cr.top + cr.height / 2)) / (cr.height / 2);
          const inRange = Math.abs(nx) < 2.2 && Math.abs(ny) < 2.2;
          if (inRange) {
            const clamp = (v) => Math.max(-1, Math.min(1, v));
            const rx = (-clamp(ny) * 4.2).toFixed(2);
            const ry = (clamp(nx) * 4.6).toFixed(2);
            heroCover.style.setProperty("--bm8-tx", `${rx}deg`);
            heroCover.style.setProperty("--bm8-ty", `${ry}deg`);
            heroCover.style.setProperty("--bm8-gx", `${((clamp(nx) * 0.5 + 0.5) * 100).toFixed(1)}%`);
            heroCover.style.setProperty("--bm8-gy", `${((clamp(ny) * 0.5 + 0.5) * 100).toFixed(1)}%`);
          } else {
            heroCover.style.setProperty("--bm8-tx", "0deg");
            heroCover.style.setProperty("--bm8-ty", "0deg");
          }
        }
      }
    }

    if (Math.abs(tx - cx) > 0.0015 || Math.abs(ty - cy) > 0.0015) {
      rafId = requestAnimationFrame(step);
    }
  };

  const schedule = () => {
    if (!rafId && isMotionActive(rootEl, "glow") && getTier(rootEl) === "full") {
      rafId = requestAnimationFrame(step);
    }
  };

  const onPointerMove = (e) => {
    if (!isMotionActive(rootEl, "glow") || getTier(rootEl) !== "full") return;
    const rect = rootEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointerInside = true;
    clientX = e.clientX;
    clientY = e.clientY;
    tx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    ty = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.min(rect.height, 1280)));
    rootEl.classList.add("is-bm8-pointer");
    schedule();
  };

  const onPointerLeave = () => {
    pointerInside = false;
    rootEl.classList.remove("is-bm8-pointer");
    tx = 0.36;
    ty = 0.24;
    resetInlineTilt();
    schedule();
  };

  rootEl.addEventListener("pointermove", onPointerMove, { passive: true });
  rootEl.addEventListener("pointerleave", onPointerLeave, { passive: true });
  ensurePoolAndRims();
  schedule();

  const handle = {
    refresh() {
      ensurePoolAndRims();
      schedule();
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      rootEl.removeEventListener("pointermove", onPointerMove);
      rootEl.removeEventListener("pointerleave", onPointerLeave);
      delete rootEl._bm8GlowMotion;
    }
  };
  rootEl._bm8GlowMotion = handle;
  return handle;
}

/* =========================================================================
 * 2. 主题分流翻页转场：
 *    - 洛琪希手记（roxy）：现代阅读器式不透明羊皮纸滑页 + 书脊折影（零双影叠字、零破框残片、零星芒干扰）
 *    - 其他开启动态的主题：严格内裁切的不透明轻掀卡片（.bm8-leaf）+ 右下留白处笔锋星芒微饰（.bm8-ink-flourish）
 * ========================================================================= */

function spawnReaderCrease(hostEl, dir = 1) {
  if (!hostEl) return;
  const rootEl = hostEl.closest ? hostEl.closest(".bm7-root") : null;
  if (!isMotionActive(rootEl)) return;
  hostEl.querySelectorAll(":scope > .bm8-reader-crease").forEach((n) => n.remove());
  const crease = h("div.bm8-reader-crease", {
    cls: dir < 0 ? "is-back" : "",
    attr: { "aria-hidden": "true" }
  });
  const pos = getComputedStyle(hostEl).position;
  if (pos === "static") hostEl.style.position = "relative";
  hostEl.appendChild(crease);
  setTimeout(() => {
    if (crease.parentNode) crease.remove();
  }, 360);
}

function spawnInkFlourish(hostEl, opts = {}) {
  if (!hostEl) return;
  const rootEl = hostEl.closest ? hostEl.closest(".bm7-root") : null;
  if (!isMotionActive(rootEl)) return;

  // 洛琪希手记采用克制平实的阅读器书脊光影，不叠加游丝星芒
  if (rootEl.dataset.bm7Theme === "roxy") {
    spawnReaderCrease(hostEl, opts.dir || 1);
    return;
  }

  hostEl.querySelectorAll(":scope > .bm8-ink-flourish").forEach((n) => n.remove());
  const wrap = h("div.bm8-ink-flourish", { attr: { "aria-hidden": "true" } });
  const nib = svgEl(
    `<svg class="bm8-nib-trace" viewBox="0 0 180 16" preserveAspectRatio="none"><path pathLength="1" d="M4,11 C46,5 98,13 146,7 C160,5 170,7 176,6"/></svg>`
  );
  const starA = svgEl(
    `<svg class="bm8-ink-star is-s1" viewBox="0 0 16 16"><path d="M8 1 L9.6 6.4 L15 8 L9.6 9.6 L8 15 L6.4 9.6 L1 8 L6.4 6.4 Z"/></svg>`
  );
  const starB = svgEl(
    `<svg class="bm8-ink-star is-s2" viewBox="0 0 16 16"><path d="M8 2 L9.2 6.8 L14 8 L9.2 9.2 L8 14 L6.8 9.2 L2 8 L6.8 6.8 Z"/></svg>`
  );
  if (opts.compact) wrap.classList.add("is-compact");
  wrap.appendChild(nib);
  wrap.appendChild(starA);
  wrap.appendChild(starB);

  const pos = getComputedStyle(hostEl).position;
  if (pos === "static") hostEl.style.position = "relative";
  hostEl.appendChild(wrap);
  setTimeout(() => {
    if (wrap.parentNode) wrap.remove();
  }, 560);
}

/**
 * 捕获元素所有可滚动祖先容器的滚动偏移，并在同步 DOM 清空/重建期间锁住最小高度，
 * 彻底防止 `empty()` / `clear()` 瞬间高度坍缩触发浏览器自动将滚动条钳制回页首（scrollTop = 0）。
 */
function captureScrollAncestors(el) {
  const list = [];
  if (!el || typeof window === "undefined") return list;
  let cur = el.parentElement;
  while (cur) {
    try {
      const cs = getComputedStyle(cur);
      const oy = cs ? cs.overflowY : "";
      if (
        cur.scrollTop > 0 ||
        cur.scrollLeft > 0 ||
        oy === "auto" ||
        oy === "scroll" ||
        oy === "overlay" ||
        cur.classList?.contains("view-content") ||
        cur.classList?.contains("curator-desk-root")
      ) {
        list.push({ el: cur, top: cur.scrollTop, left: cur.scrollLeft });
      }
    } catch (_) {}
    cur = cur.parentElement;
  }
  const docScroll = typeof document !== "undefined" ? document.scrollingElement : null;
  if (docScroll && !list.some((x) => x.el === docScroll) && (docScroll.scrollTop > 0 || docScroll.scrollLeft > 0)) {
    list.push({ el: docScroll, top: docScroll.scrollTop, left: docScroll.scrollLeft });
  }
  return list;
}

function restoreScrollAncestors(saved) {
  if (!Array.isArray(saved) || !saved.length) return;
  for (const item of saved) {
    if (!item || !item.el || !item.el.isConnected) continue;
    if (item.top > 0 && item.el.scrollTop !== item.top) {
      item.el.scrollTop = item.top;
    }
    if (item.left > 0 && item.el.scrollLeft !== item.left) {
      item.el.scrollLeft = item.left;
    }
  }
}

function clearViewportScrollCushion(hostEl) {
  if (!hostEl) return;
  if (typeof hostEl._bm8CleanupScrollCushion === "function") {
    try {
      hostEl._bm8CleanupScrollCushion();
    } catch (_) {}
    hostEl._bm8CleanupScrollCushion = null;
  }
  if (hostEl.style) {
    hostEl.style.removeProperty("--bm8-anchor-min-h");
  }
}

function applyViewportScrollCushion(hostEl, savedScroll, naturalHostH) {
  if (!hostEl || !Array.isArray(savedScroll) || !savedScroll.length) return;
  const primary = savedScroll.find(
    (s) => s && s.el && s.el.isConnected && s.top > 16 && s.el.clientHeight > 80
  );
  if (!primary) return;
  const scroller = primary.el;
  const targetTop = primary.top;
  const maxScrollNow = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (targetTop <= maxScrollNow + 1) return;

  const shortfall = Math.ceil(targetTop - maxScrollNow);
  const cushionedMinH = Math.max(0, Math.round(naturalHostH + shortfall));
  hostEl.classList.add("bm8-anchor-stage");
  hostEl.style.setProperty("--bm8-anchor-min-h", `${cushionedMinH}px`);

  let activeShortfall = shortfall;
  let baselineTop = targetTop;
  const onUserScrollUp = () => {
    if (!hostEl.isConnected || !scroller.isConnected) {
      cleanup();
      return;
    }
    const curTop = scroller.scrollTop;
    if (curTop < baselineTop - 6) {
      const deltaUp = baselineTop - curTop;
      baselineTop = curTop;
      activeShortfall = Math.max(0, activeShortfall - deltaUp);
      if (activeShortfall <= 2) {
        cleanup();
      } else {
        hostEl.style.setProperty("--bm8-anchor-min-h", `${Math.round(naturalHostH + activeShortfall)}px`);
      }
    }
  };
  const cleanup = () => {
    scroller.removeEventListener("scroll", onUserScrollUp);
    if (hostEl.style) hostEl.style.removeProperty("--bm8-anchor-min-h");
    if (hostEl._bm8CleanupScrollCushion === cleanup) {
      hostEl._bm8CleanupScrollCushion = null;
    }
  };
  scroller.addEventListener("scroll", onUserScrollUp, { passive: true });
  hostEl._bm8CleanupScrollCushion = cleanup;
}

function withPreservedScroll(hostEl, mutateFn, opts = {}) {
  if (!hostEl) {
    return mutateFn && mutateFn();
  }
  const savedScroll = captureScrollAncestors(hostEl);
  const prevMinH = hostEl.style.minHeight;
  const prevH = hostEl.offsetHeight;
  clearViewportScrollCushion(hostEl);
  if (prevH > 24) {
    hostEl.style.minHeight = `${prevH}px`;
  }
  let res;
  try {
    res = mutateFn && mutateFn();
  } finally {
    hostEl.style.minHeight = prevMinH;
    if (opts.anchorScroll !== false) {
      const naturalH = hostEl.offsetHeight;
      applyViewportScrollCushion(hostEl, savedScroll, naturalH);
    }
    restoreScrollAncestors(savedScroll);
  }
  return res;
}

function inkPageSwap(hostEl, renderNext, opts = {}) {
  if (!hostEl) {
    renderNext && renderNext();
    return;
  }
  const tier = getTier(hostEl);
  if (tier === "off") {
    withPreservedScroll(hostEl, renderNext);
    return;
  }
  const rootEl = hostEl.closest ? hostEl.closest(".bm7-root") : null;
  if (!rootEl) {
    withPreservedScroll(hostEl, renderNext);
    return;
  }

  // 轻巧档（lite）：复用低显存轻量淡入微滑，不克隆整页图层
  if (tier === "lite") {
    withPreservedScroll(hostEl, renderNext);
    const nextChild = hostEl.firstElementChild;
    if (nextChild) {
      nextChild.classList.remove("bm8-soft-swap");
      void nextChild.offsetWidth;
      nextChild.classList.add("bm8-soft-swap");
      setTimeout(() => nextChild.classList.remove("bm8-soft-swap"), 240);
    }
    return;
  }

  const isRoxy = rootEl.dataset.bm7Theme === "roxy";
  const dir = opts.dir === -1 ? -1 : 1;

  // 捕获旧面板快照（剥离嵌套转场层并把破框封面收入裁切盒内，彻底杜绝 -20px 顶边残片与 20px 错位双影）
  let ghost = null;
  const prevChild = hostEl.firstElementChild;
  if (prevChild && prevChild.offsetHeight > 24) {
    try {
      ghost = prevChild.cloneNode(true);
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.remove("is-entering", "bm8-ink-in", "bm8-soft-swap");
      ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      ghost.querySelectorAll(".bm8-swap-stage, .bm8-ink-flourish, .bm8-reader-crease").forEach((n) => n.remove());
      ghost.querySelectorAll(".bm7-hero-plate").forEach((p) => {
        p.style.marginTop = "12px";
        p.style.transform = "none";
      });
    } catch (_) {
      ghost = null;
    }
  }

  withPreservedScroll(hostEl, renderNext);

  const nextChild = hostEl.firstElementChild;
  if (!nextChild) return;

  nextChild.querySelectorAll(":scope > .bm8-swap-stage").forEach((n) => n.remove());
  const nextPos = getComputedStyle(nextChild).position;
  if (nextPos === "static") nextChild.style.position = "relative";

  if (isRoxy) {
    // 洛琪希手记专属：现代阅读器/纸质手账不透明整页平移滑阅 + 柔和书脊折影
    const mainTarget = nextChild.querySelector(":scope > .bm7-hero-main") || nextChild;
    mainTarget.classList.remove("bm8-journal-under-in", "bm8-journal-under-back");
    void mainTarget.offsetWidth;
    mainTarget.classList.add(dir < 0 ? "bm8-journal-under-back" : "bm8-journal-under-in");
    setTimeout(() => {
      mainTarget.classList.remove("bm8-journal-under-in", "bm8-journal-under-back");
    }, 390);

    if (ghost) {
      const stageWrap = h("div.bm8-swap-stage.is-journal", { attr: { "aria-hidden": "true" } });
      ghost.classList.add("bm8-journal-sheet");
      if (dir < 0) ghost.classList.add("is-back");
      stageWrap.appendChild(ghost);
      nextChild.appendChild(stageWrap);
      setTimeout(() => {
        if (stageWrap.parentNode) stageWrap.remove();
      }, 380);
    }
    return;
  }

  // 其他开启动态效果的外观：修复后的严格内裁切不透明轻掀卡片 + 右下留白星芒
  const mainTarget = nextChild.querySelector(":scope > .bm7-hero-main") || nextChild;
  mainTarget.classList.remove("bm8-ink-in");
  void mainTarget.offsetWidth;
  mainTarget.classList.add("bm8-ink-in");
  setTimeout(() => mainTarget.classList.remove("bm8-ink-in"), 420);

  if (ghost) {
    const stageWrap = h("div.bm8-swap-stage.is-leaf", { attr: { "aria-hidden": "true" } });
    ghost.classList.add("bm8-leaf");
    if (dir < 0) ghost.classList.add("is-back");
    stageWrap.appendChild(ghost);
    nextChild.appendChild(stageWrap);
    setTimeout(() => {
      if (stageWrap.parentNode) stageWrap.remove();
    }, 410);
  }
  spawnInkFlourish(nextChild, { compact: opts.compact, dir });
}

/* =========================================================================
 * 2B. 多尺度分层切换动效引擎：
 *     1) animateWorkspaceGlide : 顶层六大馆藏切换（干净顺滑的方向性横向层叠滑移）
 *     2) paperSlipSwap         : 中小面板子标签切换（写过字的便签稿纸轻斜滑落、后方新页自然浮现 + 高度平滑跟进）
 *     3) scrollUnrollMorph     : 逐页⇄平铺与内联展开（画卷顺滑滚下铺开、反向柔和卷起 + 连贯高度形变）
 * ========================================================================= */

function animateWorkspaceGlide(paneEl, dir = 1) {
  if (!paneEl) return;
  const tier = getTier(paneEl);
  paneEl.classList.remove("bm8-ws-glide-next", "bm8-ws-glide-prev", "bm8-ws-glide-lite");
  if (tier === "off") return;
  void paneEl.offsetWidth;
  const cls = tier === "lite" ? "bm8-ws-glide-lite" : dir < 0 ? "bm8-ws-glide-prev" : "bm8-ws-glide-next";
  paneEl.classList.add(cls);
  if (paneEl._bm8WsTid) clearTimeout(paneEl._bm8WsTid);
  paneEl._bm8WsTid = setTimeout(() => {
    paneEl.classList.remove("bm8-ws-glide-next", "bm8-ws-glide-prev", "bm8-ws-glide-lite");
  }, tier === "lite" ? 220 : 320);
}

function paperSlipSwap(hostEl, renderNext, opts = {}) {
  if (!hostEl) {
    renderNext && renderNext();
    return;
  }
  const tier = getTier(hostEl);
  if (tier === "off") {
    withPreservedScroll(hostEl, renderNext);
    return;
  }

  const dir = opts.dir === -1 ? -1 : 1;
  if (hostEl._bm8SlipTid) {
    clearTimeout(hostEl._bm8SlipTid);
    hostEl._bm8SlipTid = 0;
  }
  hostEl.querySelectorAll(":scope > .bm8-memo-slip-sheet").forEach((n) => n.remove());
  hostEl.style.height = "";
  hostEl.style.overflow = "";
  hostEl.style.transition = "";

  const savedScroll = captureScrollAncestors(hostEl);
  const prevH = hostEl.offsetHeight;

  // 轻巧档（lite）：轻量淡入微滑 + 柔和高度插值 + 滚动位置锁定（低显存零克隆）
  if (tier === "lite") {
    clearViewportScrollCushion(hostEl);
    if (prevH > 24) hostEl.style.minHeight = `${prevH}px`;
    try {
      renderNext();
    } finally {
      hostEl.style.minHeight = "";
    }
    const naturalH = hostEl.offsetHeight;
    if (opts.anchorScroll !== false) {
      applyViewportScrollCushion(hostEl, savedScroll, naturalH);
    }
    const nextH = hostEl.offsetHeight;
    hostEl.classList.remove("bm8-paper-lite-in");
    void hostEl.offsetWidth;
    hostEl.classList.add("bm8-paper-lite-in");
    if (prevH > 20 && nextH > 20 && Math.abs(nextH - prevH) > 4 && !opts.skipHeight) {
      hostEl.style.height = `${prevH}px`;
      if (!opts.allowOverflow) hostEl.style.overflow = "hidden";
      void hostEl.offsetWidth;
      restoreScrollAncestors(savedScroll);
      hostEl.style.transition = "height 210ms cubic-bezier(0.22, 1, 0.36, 1)";
      hostEl.style.height = `${nextH}px`;
    } else {
      restoreScrollAncestors(savedScroll);
    }
    hostEl._bm8SlipTid = setTimeout(() => {
      hostEl.classList.remove("bm8-paper-lite-in");
      hostEl.style.height = "";
      hostEl.style.overflow = "";
      hostEl.style.transition = "";
      restoreScrollAncestors(savedScroll);
      hostEl._bm8SlipTid = 0;
    }, 230);
    return;
  }

  // 丰富档（full）：克隆宿主自身以 100% 保留 Grid / Flex / Gap / Padding 布局，杜绝子元素错排与边缘截断
  let memoSheet = null;
  if (hostEl.childElementCount > 0 && prevH > 24 && !opts.noGhost) {
    try {
      const clsList = [dir < 0 ? "is-reverse" : "", opts.frameless ? "is-frameless" : ""]
        .filter(Boolean)
        .join(" ");
      memoSheet = h("div.bm8-memo-slip-sheet", {
        cls: clsList,
        attr: { "aria-hidden": "true" }
      });
      const hostClone = hostEl.cloneNode(true);
      hostClone.removeAttribute("id");
      hostClone.classList.remove("bm8-paper-lite-in", "bm8-paper-under-reveal", "bm8-anchor-stage");
      hostClone.style.removeProperty("--bm8-anchor-min-h");
      hostClone.style.height = "auto";
      hostClone.style.minHeight = "0";
      hostClone.style.maxHeight = "none";
      hostClone.style.overflow = "visible";
      hostClone.style.transition = "none";
      hostClone.style.animation = "none";
      hostClone.style.position = "static";
      hostClone.style.margin = "0";
      hostClone.style.width = "100%";
      hostClone.style.boxSizing = "border-box";
      hostClone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      hostClone.querySelectorAll(".bm8-memo-slip-sheet").forEach((n) => n.remove());
      hostClone.querySelectorAll(".bm8-paper-under-reveal, .is-frameless-in, .is-frameless-in-rev").forEach((n) => {
        n.classList.remove("bm8-paper-under-reveal", "is-frameless-in", "is-frameless-in-rev");
      });
      memoSheet.appendChild(hostClone);
    } catch (_) {
      memoSheet = null;
    }
  }

  clearViewportScrollCushion(hostEl);
  if (prevH > 24) hostEl.style.minHeight = `${prevH}px`;
  try {
    renderNext();
  } finally {
    hostEl.style.minHeight = "";
  }
  const naturalH = hostEl.offsetHeight;
  if (opts.anchorScroll !== false) {
    applyViewportScrollCushion(hostEl, savedScroll, naturalH);
  }
  const nextH = hostEl.offsetHeight;

  const pos = getComputedStyle(hostEl).position;
  if (pos === "static") hostEl.style.position = "relative";

  const revealedChildren = [];
  Array.from(hostEl.children).forEach((ch) => {
    if (ch === memoSheet) return;
    ch.classList.remove("bm8-paper-under-reveal");
    let hadBaseAnim = false;
    try {
      const baseAnim = getComputedStyle(ch).animationName;
      hadBaseAnim = Boolean(baseAnim && baseAnim !== "none");
    } catch (_) {}
    void ch.offsetWidth;
    ch.classList.add("bm8-paper-under-reveal");
    if (opts.frameless) {
      ch.classList.add(dir < 0 ? "is-frameless-in-rev" : "is-frameless-in");
    }
    revealedChildren.push({ el: ch, hadBaseAnim });
  });

  if (memoSheet) {
    hostEl.appendChild(memoSheet);
  }

  if (prevH > 20 && nextH > 20 && Math.abs(nextH - prevH) > 4 && !opts.skipHeight) {
    hostEl.style.height = `${prevH}px`;
    if (!opts.allowOverflow) hostEl.style.overflow = "clip";
    void hostEl.offsetWidth;
    restoreScrollAncestors(savedScroll);
    hostEl.style.transition = "height 300ms cubic-bezier(0.22, 1, 0.36, 1)";
    hostEl.style.height = `${nextH}px`;
  } else {
    // 高度基本不变时绝不强加 overflow: clip，保护扇形叠卡、阴影与悬浮徽章完整无损
    restoreScrollAncestors(savedScroll);
  }

  hostEl._bm8SlipTid = setTimeout(() => {
    if (memoSheet && memoSheet.parentNode) memoSheet.remove();
    revealedChildren.forEach(({ el, hadBaseAnim }) => {
      if (hadBaseAnim && el.style) el.style.animation = "none";
      el.classList.remove("bm8-paper-under-reveal", "is-frameless-in", "is-frameless-in-rev");
    });
    hostEl.style.height = "";
    hostEl.style.overflow = "";
    hostEl.style.transition = "";
    restoreScrollAncestors(savedScroll);
    hostEl._bm8SlipTid = 0;
  }, 330);
}

function scrollUnrollMorph(hostEl, renderNext, opts = {}) {
  if (!hostEl) {
    renderNext && renderNext();
    return;
  }
  const tier = getTier(hostEl);
  if (tier === "off") {
    withPreservedScroll(hostEl, renderNext);
    return;
  }

  if (hostEl._bm8ScrollTid) {
    clearTimeout(hostEl._bm8ScrollTid);
    hostEl._bm8ScrollTid = 0;
  }
  hostEl.querySelectorAll(":scope > .bm8-scroll-roller").forEach((n) => n.remove());
  hostEl.style.height = "";
  hostEl.style.overflow = "";
  hostEl.style.transition = "";

  const savedScroll = captureScrollAncestors(hostEl);
  const fromH = Math.max(0, hostEl.offsetHeight);
  if (fromH > 24) hostEl.style.minHeight = `${fromH}px`;
  try {
    renderNext();
  } finally {
    hostEl.style.minHeight = "";
  }
  const toH = Math.max(0, hostEl.offsetHeight);

  if (Math.abs(toH - fromH) < 4) {
    restoreScrollAncestors(savedScroll);
    hostEl.classList.remove("bm8-paper-lite-in");
    void hostEl.offsetWidth;
    hostEl.classList.add("bm8-paper-lite-in");
    hostEl._bm8ScrollTid = setTimeout(() => hostEl.classList.remove("bm8-paper-lite-in"), 240);
    return;
  }

  const expanding = typeof opts.expanding === "boolean" ? opts.expanding : toH > fromH;
  const dur = tier === "lite" ? 260 : 380;
  const pos = getComputedStyle(hostEl).position;
  if (pos === "static") hostEl.style.position = "relative";

  let roller = null;
  if (tier === "full") {
    roller = h("div.bm8-scroll-roller", {
      cls: expanding ? "is-unrolling" : "is-rolling-up",
      attr: { "aria-hidden": "true" }
    });
    hostEl.appendChild(roller);
    const items = hostEl.querySelectorAll(".bm8-lens-slide, .bm8-drill-item");
    items.forEach((el, idx) => {
      el.style.setProperty("--bm8-stagger", `${Math.min(idx * 32, 140)}ms`);
      el.classList.add("bm8-scroll-item-morph");
    });
  }

  hostEl.style.height = `${fromH}px`;
  hostEl.style.overflow = "hidden";
  void hostEl.offsetWidth;
  restoreScrollAncestors(savedScroll);
  hostEl.style.transition = `height ${dur}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  hostEl.style.height = `${toH}px`;

  hostEl._bm8ScrollTid = setTimeout(() => {
    if (roller && roller.parentNode) roller.remove();
    hostEl.querySelectorAll(".bm8-scroll-item-morph").forEach((el) => {
      el.classList.remove("bm8-scroll-item-morph");
      el.style.removeProperty("--bm8-stagger");
    });
    hostEl.style.height = "";
    hostEl.style.overflow = "";
    hostEl.style.transition = "";
    hostEl._bm8ScrollTid = 0;
  }, dur + 25);
}

/* =========================================================================
 * 3. 统一「看番记录」多维透镜面板（最近看番 / 在看进度 / 想看清单 / 我的口味）
 * ========================================================================= */

function fmtDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function itemTitle(it) {
  return (it && (it.name || it.title)) || "未命名动画";
}

function itemCover(it, ctx) {
  if (!it) return "";
  if (ctx && typeof ctx.getCover === "function") return ctx.getCover(it) || "";
  return it.cover || "";
}

function itemBgmScore(it) {
  if (!it) return 0;
  const v = it.preciseScore ?? it.publicScore ?? it.bangumiScore;
  return v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : 0;
}

function itemUpdatedAt(it) {
  if (!it) return 0;
  return Number(it.updatedAt) || (it.file && it.file.stat && Number(it.file.stat.mtime)) || 0;
}

function extractItemTags(it) {
  if (!it || !it.tags) return [];
  const rawList = Array.isArray(it.tags) ? it.tags.join(",") : String(it.tags);
  const noise = /^(?:anime|bangumi|\d{4}(?:年(?:\d{1,2}月)?)?|\d{1,2}月(?:新番)?|TV|TVA|OVA|OAD|WEB|剧场版|动画|日本|日本动画|未分类|未确定)$/i;
  const out = [];
  for (const tok of rawList.split(/[,，;；/|\s#\[\]"']+/)) {
    const t = tok.trim();
    if (!t || t.length > 14 || noise.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function estimateTotalEpisodes(it) {
  const total = parseInt(it.totalEpisodes, 10) || 0;
  const watched = Number(it.watchedEpisodes) || 0;
  if (total > 0) return Math.max(total, watched);
  return Math.max(12, watched);
}

/** 构建明确提示“点击将离开当前页面”的跨页跳转按钮（遵守跨页跳转心理预期契约） */
function createPageJumpLink(labelText, jumpHint, onClick, extraCls = "") {
  return h(
    "button.bm8-jump-link",
    {
      cls: extraCls,
      attr: {
        type: "button",
        title: jumpHint || `离开当前页，${labelText}`
      },
      on: { click: onClick }
    },
    [h("span", { text: labelText }), icon("arrowUpRight", 13)]
  );
}

/**
 * 卡片内联作品明细抽屉（点击数据图形原地展开，附明确跨页跳转尾链）
 */
function createInlineDrillController(ctx) {
  const host = h("div.bm8-drill-host");
  let activeKey = "";

  const close = (clearSelectionCb) => {
    if (!activeKey) return;
    activeKey = "";
    if (typeof clearSelectionCb === "function") clearSelectionCb();
    scrollUnrollMorph(host, () => clear(host), { expanding: false });
  };

  const toggle = (key, spec, syncSelectionCb) => {
    if (activeKey === key) {
      close(syncSelectionCb);
      return false;
    }
    const wasOpen = Boolean(activeKey);
    activeKey = key;
    if (typeof syncSelectionCb === "function") syncSelectionCb(key);

    const renderBody = () => {
      clear(host);
      const list = (spec.items || []).slice(0, 6);
      const tray = h("div.bm8-drill-tray", [
        h("div.bm8-drill-head", [
          h("span.bm8-drill-title", { text: spec.title || "匹配作品" }),
          iconButton("close", "收起明细", () => close(syncSelectionCb), "bm8-drill-close")
        ]),
        list.length
          ? h(
              "div.bm8-drill-grid",
              list.map((it) => {
                const title = itemTitle(it);
                const metaText = typeof spec.formatMeta === "function" ? spec.formatMeta(it) : it.state || "";
                return h(
                  "button.bm8-drill-item",
                  {
                    attr: { type: "button", title: `查看《${title}》笔记详情` },
                    on: {
                      click: () => (ctx.openDetail ? ctx.openDetail(it) : ctx.onFocusSelect && ctx.onFocusSelect(it))
                    }
                  },
                  [
                    coverEl(itemCover(it, ctx), title, "bm8-drill-thumb"),
                    h("span.bm8-drill-main", [
                      h("span.bm8-drill-name", { text: title }),
                      metaText ? h("span.bm8-drill-meta.bm7-num", { text: metaText }) : null
                    ])
                  ]
                );
              })
            )
          : h("div.bm8-drill-empty", { text: spec.emptyText || "该分组下暂无作品记录。" }),
        spec.jumpLabel && typeof spec.onJump === "function"
          ? h("div.bm8-drill-foot", [
              spec.totalCount > list.length
                ? h("span.bm8-drill-more-note.bm7-num", { text: `当前展示前 ${list.length} / 共 ${spec.totalCount} 部` })
                : h("span.bm8-drill-more-note", { text: "点击上方条目可直接打开对应笔记" }),
              createPageJumpLink(spec.jumpLabel, spec.jumpHint, spec.onJump)
            ])
          : null
      ]);
      host.appendChild(tray);
    };

    if (wasOpen) {
      paperSlipSwap(host, renderBody, { dir: 1 });
    } else {
      scrollUnrollMorph(host, renderBody, { expanding: true });
    }
    return true;
  };

  return { host, toggle, close, getActiveKey: () => activeKey };
}

/** Lens 1：最近看番（84 天可点选热力节奏 + 连看天数 + 近期常看快跳） */
function buildRecentWatchLens(items, events, ctx) {
  const counts = new Map();
  const dayItemsMap = new Map();
  const itemByKey = new Map();
  for (const it of items) {
    const k = String(it.key || it.filePath || it.id || itemTitle(it));
    itemByKey.set(k, it);
    itemByKey.set(itemTitle(it), it);
  }

  const pushDayItem = (day, it) => {
    if (!day || !it) return;
    let arr = dayItemsMap.get(day);
    if (!arr) {
      arr = [];
      dayItemsMap.set(day, arr);
    }
    if (!arr.includes(it)) arr.push(it);
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const ev of events || []) {
    const rawTs = ev && (ev._d || ev.ts);
    if (!rawTs) continue;
    const d = rawTs instanceof Date ? rawTs : new Date(rawTs);
    if (Number.isNaN(d.getTime())) continue;
    const key = fmtDayKey(d);
    let weight = 1;
    if (ev.type === "episode" && Number.isFinite(Number(ev.epTo)) && Number.isFinite(Number(ev.epFrom))) {
      weight = Math.max(1, Math.min(24, Number(ev.epTo) - Number(ev.epFrom) + 1));
    } else if (ev.delta) {
      weight = Math.max(1, Number(ev.delta) || 1);
    }
    counts.set(key, (counts.get(key) || 0) + weight);
    const matched = ev.item || itemByKey.get(String(ev.itemKey || ev.title || ""));
    if (matched) pushDayItem(key, matched);
  }

  for (const it of items) {
    const ts = itemUpdatedAt(it);
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const key = fmtDayKey(d);
    pushDayItem(key, it);
    if (counts.size === 0) {
      counts.set(key, (counts.get(key) || 0) + Math.max(1, Math.min(3, Number(it.watchedEpisodes) || 1)));
    }
  }

  const weeks = 12;
  const dowMon0 = (now.getDay() + 6) % 7; // 周一=0 .. 周日=6
  const start = new Date(now);
  start.setDate(now.getDate() - ((weeks - 1) * 7 + dowMon0));

  const cells = [];
  let totalActs = 0;
  let activeDays = 0;
  let peakCount = 0;
  let peakDate = "";
  let curStreak = 0;
  let bestStreak = 0;
  const monthLabels = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + r);
      const isFuture = d.getTime() > now.getTime();
      const key = fmtDayKey(d);
      const val = isFuture ? 0 : counts.get(key) || 0;
      if (!isFuture) {
        totalActs += val;
        if (val > 0) {
          activeDays++;
          curStreak++;
          if (curStreak > bestStreak) bestStreak = curStreak;
          if (val >= peakCount) {
            peakCount = val;
            peakDate = key;
          }
        } else {
          curStreak = 0;
        }
      }
      if (r === 0) {
        const m = d.getMonth() + 1;
        if (m !== lastMonth) {
          monthLabels.push({ col: w + 1, text: `${m}月` });
          lastMonth = m;
        }
      }
      cells.push({ key, val, isFuture, w, r });
    }
  }

  const defaultReadout = peakCount > 0 ? `最高单日：${peakDate}（看完 ${peakCount} 集 · 点击方格看明细）` : "点击任意方格可查看当日看番记录";
  const readout = h("span.bm8-heat-readout.bm7-num", { text: defaultReadout });

  const monthsRow = h("div.bm8-heat-months");
  for (const ml of monthLabels) {
    monthsRow.appendChild(
      h("span.bm8-heat-month", {
        text: ml.text,
        style: { gridColumnStart: String(ml.col) }
      })
    );
  }

  const drill = createInlineDrillController(ctx);
  const cellNodes = new Map();
  const syncCellSel = (selKey = "") => {
    cellNodes.forEach((node, k) => node.classList.toggle("is-selected", k === selKey));
    if (!selKey) readout.textContent = defaultReadout;
  };

  const grid = h("div.bm8-heat-grid");
  const levelOf = (v) => (v <= 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : v <= 5 ? 3 : 4);
  for (const cell of cells) {
    const lv = levelOf(cell.val);
    const label = cell.isFuture ? `${cell.key}（未来日期）` : cell.val > 0 ? `${cell.key} · 看完 ${cell.val} 集` : `${cell.key} · 当日无看番记录`;
    const sq = h(cell.isFuture ? "span.bm8-heat-cell" : "button.bm8-heat-cell", {
      cls: cell.isFuture ? "is-future" : `lv-${lv} is-clickable`,
      attr: cell.isFuture
        ? { title: label, "aria-label": label }
        : { type: "button", title: `${label}（点击展开当日作品）`, "aria-label": label },
      on: cell.isFuture
        ? {}
        : {
            mouseenter: () => {
              readout.textContent = label;
            },
            mouseleave: () => {
              if (!drill.getActiveKey()) readout.textContent = defaultReadout;
            },
            click: () => {
              const dayList = dayItemsMap.get(cell.key) || [];
              readout.textContent = label;
              drill.toggle(
                cell.key,
                {
                  title: `${cell.key} · ${cell.val > 0 ? `记录 ${cell.val} 集` : "无推进记录"}`,
                  items: dayList,
                  totalCount: dayList.length,
                  emptyText: cell.val > 0 ? `当日共看完 ${cell.val} 集（未关联具体单集时间戳，可在下方近期常看快速打开）。` : "这一天没有留下看番推进记录。",
                  formatMeta: (it) => {
                    const tot = parseInt(it.totalEpisodes, 10) || 0;
                    return tot ? `已看 ${Number(it.watchedEpisodes) || 0}/${tot} 集` : `已看 ${Number(it.watchedEpisodes) || 0} 集`;
                  }
                },
                syncCellSel
              );
            }
          }
    });
    if (!cell.isFuture) cellNodes.set(cell.key, sq);
    grid.appendChild(sq);
  }

  const recentTitles = items
    .filter((it) => (it.state === "在看" || it.state === "已看") && (itemUpdatedAt(it) || Number(it.watchedEpisodes) > 0))
    .slice()
    .sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a))
    .slice(0, 4);

  return h("div.bm8-lens-card", [
    h("div.bm8-kpi-strip", [
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "近 12 周观看" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${num(totalActs)} 集` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "看番活跃" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${activeDays} 天` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "最长连看" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${bestStreak} 天` })
      ])
    ]),
    h("div.bm8-heat-wrap", [
      monthsRow,
      h("div.bm8-heat-body", [
        h("div.bm8-heat-dows", [
          h("span", { text: "一" }),
          h("span", { text: "三" }),
          h("span", { text: "五" }),
          h("span", { text: "日" })
        ]),
        grid
      ]),
      h("div.bm8-heat-foot", [
        readout,
        h("span.bm8-heat-legend", [
          h("span", { text: "少" }),
          h("i.bm8-heat-cell.lv-0"),
          h("i.bm8-heat-cell.lv-1"),
          h("i.bm8-heat-cell.lv-2"),
          h("i.bm8-heat-cell.lv-3"),
          h("i.bm8-heat-cell.lv-4"),
          h("span", { text: "多" })
        ])
      ])
    ]),
    drill.host,
    recentTitles.length
      ? h("div.bm8-sub-foot", [
          h("span.bm8-sub-label", { text: "近期常看：" }),
          h(
            "div.bm8-inline-chips",
            recentTitles.map((it) => {
              const title = itemTitle(it);
              const tot = parseInt(it.totalEpisodes, 10) || 0;
              return h(
                "button.bm8-mini-chip",
                {
                  attr: { type: "button", title: `在上方焦点舞台查看《${title}》` },
                  on: { click: () => (ctx.onFocusSelect ? ctx.onFocusSelect(it) : ctx.openDetail && ctx.openDetail(it)) }
                },
                [
                  h("span.bm8-mini-chip-title", { text: title }),
                  h("span.bm8-mini-chip-meta.bm7-num", {
                    text: tot ? `${Number(it.watchedEpisodes) || 0}/${tot}` : `${Number(it.watchedEpisodes) || 0}集`
                  })
                ]
              );
            })
          )
        ])
      : null
  ]);
}

/** Lens 2：在看进度（完成度、剩余集数与预计补完时长） */
function buildWatchingProgressLens(items, ctx) {
  const watching = items.filter((it) => it.state === "在看");
  if (!watching.length) {
    return h("div.bm8-lens-card", [
      h("div.bm7-empty", [
        h("span", { text: "当前没有标为「在看」的动画。从想看清单挑一部开看，这里会自动算好进度与剩余时长。" }),
        ctx.jumpToLibrary
          ? createPageJumpLink("前往全部番剧挑一部", "离开当前页，前往「全部番剧」查看想看清单", () => ctx.jumpToLibrary({ state: "想看" }))
          : null
      ])
    ]);
  }

  let watchedSum = 0;
  let totalSum = 0;
  let remainEps = 0;
  for (const it of watching) {
    const w = Math.max(0, Number(it.watchedEpisodes) || 0);
    const t = estimateTotalEpisodes(it);
    watchedSum += w;
    totalSum += t;
    remainEps += Math.max(0, t - w);
  }
  const overallPct = totalSum > 0 ? Math.min(100, Math.round((watchedSum / totalSum) * 100)) : 0;
  const remainHours = Math.round(remainEps * 0.4 * 10) / 10;

  const ranked = watching
    .slice()
    .sort((a, b) => {
      const ra = (Number(a.watchedEpisodes) || 0) / estimateTotalEpisodes(a);
      const rb = (Number(b.watchedEpisodes) || 0) / estimateTotalEpisodes(b);
      if (Math.abs(rb - ra) > 0.04) return rb - ra;
      return itemUpdatedAt(b) - itemUpdatedAt(a);
    })
    .slice(0, 6);

  return h("div.bm8-lens-card", [
    h("div.bm8-kpi-strip", [
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "正在追更" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${watching.length} 部` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: `总体进度 · ${overallPct}%` }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${watchedSum}/${totalSum} 集` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "剩余待看" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `约 ${remainHours} 小时` })
      ])
    ]),
    h(
      "div.bm8-watch-grid",
      ranked.map((it) => {
        const title = itemTitle(it);
        const w = Math.max(0, Number(it.watchedEpisodes) || 0);
        const rawTotal = parseInt(it.totalEpisodes, 10) || 0;
        const estT = estimateTotalEpisodes(it);
        const pct = Math.min(100, Math.round((w / estT) * 100));
        const left = rawTotal > 0 ? Math.max(0, rawTotal - w) : null;
        return h(
          "button.bm8-watch-row",
          {
            attr: { type: "button", title: `点击在上方焦点舞台查看《${title}》` },
            on: { click: () => (ctx.onFocusSelect ? ctx.onFocusSelect(it) : ctx.openDetail && ctx.openDetail(it)) }
          },
          [
            coverEl(itemCover(it, ctx), title, "bm8-watch-thumb"),
            h("div.bm8-watch-main", [
              h("div.bm8-watch-top", [
                h("span.bm8-watch-title", { text: title }),
                h("span.bm8-watch-frac.bm7-num", {
                  text: rawTotal > 0 ? `${w}/${rawTotal}` : `${w} 集`
                })
              ]),
              h("span.bm7-progress.bm8-watch-bar", [
                h("span.bm7-progress-fill", { style: { width: `${pct}%` } })
              ]),
              h("span.bm8-watch-hint", {
                text:
                  left === 0
                    ? "已追平总集数，可标记看完"
                    : left !== null && left <= 3
                    ? `还差最后 ${left} 集收官`
                    : left !== null
                    ? `还剩 ${left} 集 · 约 ${(left * 0.4).toFixed(1)} 小时`
                    : "连载集数待定"
              })
            ])
          ]
        );
      })
    ),
    watching.length > 6 && ctx.jumpToLibrary
      ? h("div.bm8-sub-foot.is-end", [
          createPageJumpLink(
            `前往全部番剧看全部 ${watching.length} 部`,
            "离开当前页，前往「全部番剧」筛选全部在看作品",
            () => ctx.jumpToLibrary({ state: "在看" })
          )
        ])
      : null
  ]);
}

/** Lens 3：想看清单（可点击篇幅分段条与图例 + 高分推荐） */
function buildPlannedBacklogLens(items, ctx) {
  const planned = items.filter((it) => it.state === "想看");
  if (!planned.length) {
    return h("div.bm8-lens-card", [
      h("div.bm7-empty", [
        h("span", { text: "「想看」清单还是空的。遇到感兴趣的新番或老番先记进来，闲下来就不怕剧荒啦。" }),
        ctx.addNew ? button("搜索添加动画", { icon: "plus", onClick: () => ctx.addNew() }) : null
      ])
    ]);
  }

  let totalEps = 0;
  const bucketLists = { b1: [], b2: [], b3: [], b4: [] };

  for (const it of planned) {
    const t = parseInt(it.totalEpisodes, 10) || 0;
    totalEps += t > 0 ? t : 12;
    if (t <= 0) bucketLists.b4.push(it);
    else if (t <= 13) bucketLists.b1.push(it);
    else if (t <= 26) bucketLists.b2.push(it);
    else bucketLists.b3.push(it);
  }
  const estHours = Math.round(totalEps * 0.4);
  const estDays = Math.max(1, Math.ceil(totalEps / 2));

  const buckets = [
    { id: "b1", label: "单季短篇 (≤13集)", list: bucketLists.b1, cls: "is-b1" },
    { id: "b2", label: "半年番 (14-26集)", list: bucketLists.b2, cls: "is-b2" },
    { id: "b3", label: "长篇大作 (27集+)", list: bucketLists.b3, cls: "is-b3" },
    { id: "b4", label: "集数未定", list: bucketLists.b4, cls: "is-b4" }
  ].filter((b) => b.list.length > 0);

  const drill = createInlineDrillController(ctx);
  const segEls = new Map();
  const legEls = new Map();
  const syncBucketSel = (selKey = "") => {
    segEls.forEach((el, k) => el.classList.toggle("is-selected", k === selKey));
    legEls.forEach((el, k) => el.classList.toggle("is-selected", k === selKey));
  };

  const onSelectBucket = (b) => {
    const sorted = b.list.slice().sort((x, y) => itemBgmScore(y) - itemBgmScore(x));
    drill.toggle(
      b.id,
      {
        title: `${b.label} · 共 ${b.list.length} 部想看`,
        items: sorted,
        totalCount: b.list.length,
        formatMeta: (it) => {
          const t = parseInt(it.totalEpisodes, 10) || 0;
          const sc = itemBgmScore(it);
          return [t > 0 ? `共 ${t} 集` : "集数待定", sc > 0 ? `★${sc.toFixed(1)}` : ""].filter(Boolean).join(" · ");
        },
        jumpLabel: ctx.jumpToLibrary ? "前往全部番剧查看想看" : "",
        jumpHint: "离开当前页，前往「全部番剧」筛选想看作品",
        onJump: ctx.jumpToLibrary ? () => ctx.jumpToLibrary({ state: "想看" }) : null
      },
      syncBucketSel
    );
  };

  const topPicks = planned
    .slice()
    .sort((a, b) => itemBgmScore(b) - itemBgmScore(a))
    .slice(0, 4);

  return h("div.bm8-lens-card", [
    h("div.bm8-kpi-strip", [
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: `想看储备 · 约${num(totalEps)}集` }),
        h("strong.bm8-kpi-val.bm7-num", { text: `${planned.length} 部` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "预计消化时长" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `约 ${num(estHours)} 小时` })
      ]),
      h("div.bm8-kpi", [
        h("span.bm8-kpi-label", { text: "每天看 2 集" }),
        h("strong.bm8-kpi-val.bm7-num", { text: `约 ${num(estDays)} 天` })
      ])
    ]),
    h("div.bm8-stack-section", [
      h(
        "div.bm8-stack-bar",
        buckets.map((b) => {
          const seg = h("button.bm8-stack-seg", {
            cls: b.cls,
            style: { flexGrow: String(b.list.length) },
            attr: { type: "button", title: `${b.label}：${b.list.length} 部（点击展开明细）`, "aria-label": `${b.label} ${b.list.length} 部` },
            on: { click: () => onSelectBucket(b) }
          });
          segEls.set(b.id, seg);
          return seg;
        })
      ),
      h(
        "div.bm8-stack-legend",
        buckets.map((b) => {
          const leg = h(
            "button.bm8-stack-item",
            {
              attr: { type: "button", title: `点击查看「${b.label}」作品列表` },
              on: { click: () => onSelectBucket(b) }
            },
            [
              h("i.bm8-stack-dot", { cls: b.cls }),
              h("span", { text: `${b.label} ` }),
              h("strong.bm7-num", { text: `${b.list.length}` })
            ]
          );
          legEls.set(b.id, leg);
          return leg;
        })
      )
    ]),
    drill.host,
    h("div.bm8-sub-foot", [
      h("span.bm8-sub-label", { text: "高分待看：" }),
      h(
        "div.bm8-inline-chips",
        topPicks.map((it) => {
          const title = itemTitle(it);
          const sc = itemBgmScore(it);
          return h(
            "button.bm8-mini-chip",
            {
              attr: { type: "button", title: `打开《${title}》笔记详情` },
              on: { click: () => ctx.openDetail && ctx.openDetail(it) }
            },
            [
              h("span.bm8-mini-chip-title", { text: title }),
              sc > 0 ? h("span.bm8-mini-chip-score.bm7-num", { text: sc.toFixed(1) }) : null
            ]
          );
        })
      ),
      ctx.jumpToLibrary
        ? createPageJumpLink("前往全部番剧", "离开当前页，前往「全部番剧」查看全部想看作品", () => ctx.jumpToLibrary({ state: "想看" }), "bm8-ml-auto")
        : null
    ])
  ]);
}

/** Lens 4：我的口味（可点选评分柱 + 常看标签 / 制作公司 / 完结月份便签切换与内联展开） */
function buildTasteProfileLens(items, ctx, subTabState) {
  const scored = items.filter((it) => it.personalScore != null && it.personalScore !== "" && Number.isFinite(Number(it.personalScore)) && Number(it.personalScore) > 0);
  const bgmScored = items.filter((it) => itemBgmScore(it) > 0);
  const myAvg = scored.length ? scored.reduce((s, it) => s + Number(it.personalScore), 0) / scored.length : 0;
  const bgmAvg = bgmScored.length ? bgmScored.reduce((s, it) => s + itemBgmScore(it), 0) / bgmScored.length : 0;

  const maxPersonal = scored.reduce((m, it) => Math.max(m, Number(it.personalScore) || 0), 0);
  const isFiveStarScale = maxPersonal > 0 && maxPersonal <= 5;
  const scoreBuckets = isFiveStarScale
    ? [
        { id: "sc-5", label: "5分", list: scored.filter((i) => Number(i.personalScore) >= 4.5) },
        { id: "sc-4", label: "4分", list: scored.filter((i) => Number(i.personalScore) >= 3.5 && Number(i.personalScore) < 4.5) },
        { id: "sc-3", label: "3分", list: scored.filter((i) => Number(i.personalScore) >= 2.5 && Number(i.personalScore) < 3.5) },
        { id: "sc-2", label: "≤2分", list: scored.filter((i) => Number(i.personalScore) < 2.5) }
      ]
    : [
        { id: "sc-9", label: "9-10", list: scored.filter((i) => Number(i.personalScore) >= 8.5) },
        { id: "sc-8", label: "8分", list: scored.filter((i) => Number(i.personalScore) >= 7.5 && Number(i.personalScore) < 8.5) },
        { id: "sc-7", label: "7分", list: scored.filter((i) => Number(i.personalScore) >= 6.5 && Number(i.personalScore) < 7.5) },
        { id: "sc-6", label: "≤6分", list: scored.filter((i) => Number(i.personalScore) < 6.5) }
      ];
  const maxBucket = Math.max(1, ...scoreBuckets.map((b) => b.list.length));

  // 标签统计（携带匹配作品列表）
  const tagMap = new Map();
  for (const it of items) {
    for (const t of extractItemTags(it)) {
      let arr = tagMap.get(t);
      if (!arr) {
        arr = [];
        tagMap.set(t, arr);
      }
      arr.push(it);
    }
  }
  const topTags = Array.from(tagMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  // 动画公司统计（携带匹配作品列表）
  const studioMap = new Map();
  for (const it of items) {
    const raw = String(it.studio || "").trim();
    if (!raw || raw === "未知" || raw === "未填写" || raw === "-") continue;
    const primary = raw.split(/[\/、,，×]/)[0].trim();
    if (!primary) continue;
    const rec = studioMap.get(primary) || { list: [], scoreSum: 0, scoreCnt: 0 };
    rec.list.push(it);
    if (it.personalScore != null && it.personalScore !== "" && Number(it.personalScore) > 0) {
      rec.scoreSum += Number(it.personalScore);
      rec.scoreCnt += 1;
    }
    studioMap.set(primary, rec);
  }
  const topStudios = Array.from(studioMap.entries())
    .sort((a, b) => b[1].list.length - a[1].list.length)
    .slice(0, 4);
  const maxStudioCnt = Math.max(1, ...topStudios.map(([, v]) => v.list.length));

  // 近 12 个月完结月份柱（携带当月完结作品列表）
  const monthBuckets = [];
  const now = new Date();
  const completed = items.filter((it) => it.state === "已看");
  const monthItemsMap = new Map();
  for (const it of completed) {
    const ts = it.completedAt || itemUpdatedAt(it);
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let arr = monthItemsMap.get(mk);
    if (!arr) {
      arr = [];
      monthItemsMap.set(mk, arr);
    }
    arr.push(it);
  }
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mNum = d.getMonth() + 1;
    const mk = `${d.getFullYear()}-${String(mNum).padStart(2, "0")}`;
    const list = monthItemsMap.get(mk) || [];
    monthBuckets.push({
      key: mk,
      numText: String(mNum),
      count: list.length,
      list
    });
  }
  const maxMonthCnt = Math.max(1, ...monthBuckets.map((m) => m.count));

  const drill = createInlineDrillController(ctx);
  const selectableNodes = new Map();
  const syncTasteSel = (selKey = "") => {
    selectableNodes.forEach((node, k) => node.classList.toggle("is-selected", k === selKey));
  };

  const subBody = h("div.bm8-taste-subbody");
  const subBtns = new Map();
  const subOrder = ["tags", "studios", "months"];

  const paintSub = () => {
    clear(subBody);
    // 清理旧子面板节点引用，保留评分柱引用
    Array.from(selectableNodes.keys()).forEach((k) => {
      if (!k.startsWith("sc-")) selectableNodes.delete(k);
    });
    const cur = subTabState.tab || "tags";
    subBtns.forEach((btn, k) => btn.classList.toggle("is-active", k === cur));

    if (cur === "tags") {
      if (!topTags.length) {
        subBody.appendChild(h("div.bm8-muted-note", { text: "笔记里还没有动画标签，同步 Bangumi 详情后会自动汇总常看题材。" }));
      } else {
        subBody.appendChild(
          h(
            "div.bm8-tag-cloud",
            topTags.map(([tag, list]) => {
              const selKey = `tag:${tag}`;
              const pill = h(
                "button.bm8-tag-pill",
                {
                  cls: drill.getActiveKey() === selKey ? "is-selected" : "",
                  attr: { type: "button", title: `点击在下方展开「${tag}」作品预览（共 ${list.length} 部）` },
                  on: {
                    click: () => {
                      drill.toggle(
                        selKey,
                        {
                          title: `常看标签「${tag}」 · 共 ${list.length} 部`,
                          items: list.slice().sort((a, b) => (Number(b.personalScore) || itemBgmScore(b)) - (Number(a.personalScore) || itemBgmScore(a))),
                          totalCount: list.length,
                          formatMeta: (it) => {
                            const ps = Number(it.personalScore) || 0;
                            return [it.state || "", ps > 0 ? `我的评分 ${ps}` : ""].filter(Boolean).join(" · ");
                          },
                          jumpLabel: ctx.jumpToLibrary ? `前往全部番剧筛选「${tag}」` : "",
                          jumpHint: `离开当前页，前往「全部番剧」按标签「${tag}」筛选`,
                          onJump: ctx.jumpToLibrary ? () => ctx.jumpToLibrary({ tag }) : null
                        },
                        syncTasteSel
                      );
                    }
                  }
                },
                [h("span", { text: tag }), h("span.bm8-tag-cnt.bm7-num", { text: String(list.length) })]
              );
              selectableNodes.set(selKey, pill);
              return pill;
            })
          )
        );
      }
    } else if (cur === "studios") {
      if (!topStudios.length) {
        subBody.appendChild(h("div.bm8-muted-note", { text: "暂未识别到动画制作公司记录。" }));
      } else {
        subBody.appendChild(
          h(
            "div.bm8-studio-list",
            topStudios.map(([name, info]) => {
              const selKey = `studio:${name}`;
              const row = h(
                "button.bm8-studio-row",
                {
                  cls: drill.getActiveKey() === selKey ? "is-selected" : "",
                  attr: { type: "button", title: `点击在下方展开「${name}」作品明细（共 ${info.list.length} 部）` },
                  on: {
                    click: () => {
                      drill.toggle(
                        selKey,
                        {
                          title: `制作公司「${name}」 · 共 ${info.list.length} 部`,
                          items: info.list,
                          totalCount: info.list.length,
                          formatMeta: (it) => {
                            const ps = Number(it.personalScore) || 0;
                            return [it.state || "", ps > 0 ? `★${ps}` : ""].filter(Boolean).join(" · ");
                          },
                          jumpLabel: ctx.jumpToLibrary ? `前往全部番剧检索「${name}」` : "",
                          jumpHint: `离开当前页，前往「全部番剧」搜索制作公司「${name}」`,
                          onJump: ctx.jumpToLibrary ? () => ctx.jumpToLibrary({ q: name }) : null
                        },
                        syncTasteSel
                      );
                    }
                  }
                },
                [
                  h("span.bm8-studio-name", { text: name }),
                  h("span.bm8-studio-bar-track", [
                    h("span.bm8-studio-bar-fill", {
                      style: { width: `${Math.max(10, Math.round((info.list.length / maxStudioCnt) * 100))}%` }
                    })
                  ]),
                  h("span.bm8-studio-meta.bm7-num", {
                    text: info.scoreCnt > 0 ? `${info.list.length}部 · ★${(info.scoreSum / info.scoreCnt).toFixed(1)}` : `${info.list.length}部`
                  })
                ]
              );
              selectableNodes.set(selKey, row);
              return row;
            })
          )
        );
      }
    } else {
      subBody.appendChild(
        h(
          "div.bm8-months-chart",
          monthBuckets.map((m) => {
            const selKey = `month:${m.key}`;
            const col = h(
              "button.bm8-month-col",
              {
                cls: [m.count > 0 ? "is-has" : "", drill.getActiveKey() === selKey ? "is-selected" : ""].filter(Boolean).join(" "),
                attr: {
                  type: "button",
                  title: `${m.key}：看完 ${m.count} 部（点击展开当月完结作品）`,
                  "aria-label": `${m.key} 看完 ${m.count} 部`
                },
                on: {
                  click: () => {
                    drill.toggle(
                      selKey,
                      {
                        title: `${m.key} 完结/看完 · 共 ${m.count} 部`,
                        items: m.list,
                        totalCount: m.count,
                        emptyText: `${m.key} 暂无标记看完的番剧记录。`,
                        formatMeta: (it) => {
                          const ps = Number(it.personalScore) || 0;
                          return ps > 0 ? `个人评分 ${ps}` : "已看完";
                        },
                        jumpLabel: m.count > 0 && ctx.jumpToLibrary ? "前往全部番剧查看已看" : "",
                        jumpHint: "离开当前页，前往「全部番剧」筛选已看作品",
                        onJump: m.count > 0 && ctx.jumpToLibrary ? () => ctx.jumpToLibrary({ state: "已看" }) : null
                      },
                      syncTasteSel
                    );
                  }
                }
              },
              [
                h("span.bm8-month-val.bm7-num", { text: m.count > 0 ? String(m.count) : "" }),
                h("span.bm8-month-bar-wrap", [
                  h("span.bm8-month-bar", {
                    cls: m.count > 0 ? "is-has" : "",
                    style: { height: `${m.count > 0 ? Math.max(16, Math.round((m.count / maxMonthCnt) * 100)) : 6}%` }
                  })
                ]),
                h("span.bm8-month-lbl.bm7-num", [
                  h("span", { text: m.numText }),
                  h("span.bm8-month-unit", { text: "月" })
                ])
              ]
            );
            selectableNodes.set(selKey, col);
            return col;
          })
        )
      );
    }
  };

  const subDefs = [
    { key: "tags", label: "常看标签" },
    { key: "studios", label: "制作公司" },
    { key: "months", label: "完结月份" }
  ];
  const subSeg = h(
    "div.bm7-seg.is-small.is-scroll.bm8-taste-tabs",
    subDefs.map((d) => {
      const b = h(
        "button.bm7-seg-btn",
        {
          cls: (subTabState.tab || "tags") === d.key ? "is-active" : "",
          attr: { type: "button" },
          on: {
            click: () => {
              const prevKey = subTabState.tab || "tags";
              if (prevKey === d.key) return;
              const dir = subOrder.indexOf(d.key) >= subOrder.indexOf(prevKey) ? 1 : -1;
              subTabState.tab = d.key;
              subBtns.forEach((btn, k) => btn.classList.toggle("is-active", k === d.key));
              paperSlipSwap(subBody, () => paintSub(), { dir });
            }
          }
        },
        [h("span", { text: d.label })]
      );
      subBtns.set(d.key, b);
      return b;
    })
  );

  paintSub();

  return h("div.bm8-lens-card", [
    h("div.bm8-taste-top", [
      h("div.bm8-kpi-strip.is-compact", [
        h("div.bm8-kpi", [
          h("span.bm8-kpi-label", [
            h("span", { text: "个人均分" }),
            isFiveStarScale ? h("span.bm8-kpi-scale-note", { text: " · 5分制" }) : null
          ]),
          h("strong.bm8-kpi-val.bm7-num", { text: scored.length ? `${myAvg.toFixed(1)}（${scored.length}部）` : "暂未打分" })
        ]),
        h("div.bm8-kpi", [
          h("span.bm8-kpi-label", { text: "Bangumi 均分" }),
          h("strong.bm8-kpi-val.bm7-num", { text: bgmScored.length ? bgmAvg.toFixed(1) : "—" })
        ])
      ]),
      h(
        "div.bm8-score-bars",
        scoreBuckets.map((b) => {
          const col = h(
            "button.bm8-score-col",
            {
              cls: b.list.length > 0 ? "is-has" : "",
              attr: {
                type: "button",
                title: `个人评分 ${b.label}：${b.list.length} 部（点击展开对应作品）`,
                "aria-label": `个人评分 ${b.label} 共 ${b.list.length} 部`
              },
              on: {
                click: () => {
                  const sorted = b.list.slice().sort((x, y) => Number(y.personalScore) - Number(x.personalScore));
                  drill.toggle(
                    b.id,
                    {
                      title: `个人评分 ${b.label} · 共 ${b.list.length} 部`,
                      items: sorted,
                      totalCount: b.list.length,
                      emptyText: `还没有打出「${b.label}」的作品。`,
                      formatMeta: (it) => `我的评分 ${it.personalScore}${itemBgmScore(it) > 0 ? ` · BGM ${itemBgmScore(it).toFixed(1)}` : ""}`,
                      jumpLabel: b.list.length > 0 && ctx.jumpToLibrary ? "前往全部番剧按评分浏览" : "",
                      jumpHint: "离开当前页，前往「全部番剧」浏览片库",
                      onJump: b.list.length > 0 && ctx.jumpToLibrary ? () => ctx.jumpToLibrary({}) : null
                    },
                    syncTasteSel
                  );
                }
              }
            },
            [
              h("span.bm8-score-cnt.bm7-num", { text: b.list.length > 0 ? String(b.list.length) : "" }),
              h("span.bm8-score-bar-wrap", [
                h("span.bm8-score-bar", {
                  style: { height: `${b.list.length > 0 ? Math.max(18, Math.round((b.list.length / maxBucket) * 100)) : 8}%` }
                })
              ]),
              h("span.bm8-score-lbl.bm7-num", { text: b.label })
            ]
          );
          selectableNodes.set(b.id, col);
          return col;
        })
      )
    ]),
    h("div.bm8-taste-toolbar", [
      subSeg,
      ctx.openStats
        ? h(
            "button.bm8-drawer-link",
            {
              attr: { type: "button", title: "在当前页展开完整制作公司、年份与标签统计抽屉（不离开本页）" },
              on: { click: () => ctx.openStats() }
            },
            [icon("barChart", 13), h("span", { text: "完整排行与年份筛选" })]
          )
        : null
    ]),
    subBody,
    drill.host
  ]);
}

function filterLensItems(rawList) {
  const valid = (Array.isArray(rawList) ? rawList : []).filter(Boolean);
  const real = valid.filter((it) => !it.isSamplePreviewItem);
  return real.length > 0 ? real : valid;
}

function renderWatchLensDeck(host, ctx = {}) {
  clear(host);
  let curItems = filterLensItems(typeof ctx.getItems === "function" ? ctx.getItems() : ctx.items || []);
  let curEvents = typeof ctx.getEvents === "function" ? ctx.getEvents() : ctx.events || [];

  const state = {
    mode: ctx.lensMode === "grid" ? "grid" : "slide",
    page: Math.max(0, Math.min(3, Number(ctx.lensPage) || 0)),
    tasteSubTab: "tags"
  };

  const LENSES = [
    { id: "recent", label: "最近看番", icon: "calendar" },
    { id: "watching", label: "在看进度", icon: "play" },
    { id: "planned", label: "想看清单", icon: "bookmark" },
    { id: "taste", label: "我的口味", icon: "star" }
  ];

  const section = h("section.bm7-panel.bm8-lens", {
    attr: { "data-lens-mode": state.mode, tabindex: "0", "aria-label": "看番记录" },
    style: { "--bm8-page": String(state.page) }
  });

  const subtitleEl = h("span.bm8-lens-sub.bm7-num");

  const tabBtns = [];
  const tabSeg = h(
    "div.bm7-seg.is-scroll.bm8-lens-tabs",
    LENSES.map((l, idx) => {
      const btn = h(
        "button.bm7-seg-btn",
        {
          cls: idx === state.page ? "is-active" : "",
          attr: { type: "button", "data-lens-idx": String(idx) },
          on: { click: () => goToPage(idx) }
        },
        [icon(l.icon, 14), h("span", { text: l.label })]
      );
      tabBtns.push(btn);
      return btn;
    })
  );

  const prevBtn = iconButton("chevronLeft", "上一页", () => goToPage((state.page + 3) % 4, -1), "bm8-lens-arrow");
  const nextBtn = iconButton("chevronRight", "下一页", () => goToPage((state.page + 1) % 4, 1), "bm8-lens-arrow");
  const navArrows = h("div.bm8-lens-arrows", [prevBtn, nextBtn]);

  const modeBtns = new Map();
  const modeSeg = h(
    "div.bm7-seg.is-small.bm8-lens-mode",
    [
      { key: "slide", label: "逐页" },
      { key: "grid", label: "平铺" }
    ].map((m) => {
      const b = h(
        "button.bm7-seg-btn",
        {
          cls: state.mode === m.key ? "is-active" : "",
          attr: { type: "button", title: m.key === "slide" ? "收卷为单页便签浏览" : "如画卷般向下展开四块数据总览" },
          on: { click: () => setMode(m.key) }
        },
        [h("span", { text: m.label })]
      );
      modeBtns.set(m.key, b);
      return b;
    })
  );

  const viewport = h("div.bm8-lens-viewport");
  const track = h("div.bm8-lens-track");
  viewport.appendChild(track);

  const navRow = h("div.bm8-lens-nav-row", [tabSeg, navArrows]);

  const subTabProxy = {
    get tab() {
      return state.tasteSubTab;
    },
    set tab(v) {
      state.tasteSubTab = v;
    }
  };

  const buildSingleLens = (idx) => {
    if (idx === 0) return buildRecentWatchLens(curItems, curEvents, ctx);
    if (idx === 1) return buildWatchingProgressLens(curItems, ctx);
    if (idx === 2) return buildPlannedBacklogLens(curItems, ctx);
    return buildTasteProfileLens(curItems, ctx, subTabProxy);
  };

  const syncSubtitle = () => {
    const wCnt = curItems.filter((i) => i.state === "在看").length;
    const cCnt = curItems.filter((i) => i.state === "已看").length;
    const pCnt = curItems.filter((i) => i.state === "想看").length;
    subtitleEl.textContent = `共 ${curItems.length} 部 · 在看 ${wCnt} · 已看 ${cCnt} · 想看 ${pCnt}`;
  };

  const syncControls = () => {
    section.setAttribute("data-lens-mode", state.mode);
    section.style.setProperty("--bm8-page", String(state.page));
    tabBtns.forEach((b, i) => b.classList.toggle("is-active", i === state.page));
    modeBtns.forEach((b, k) => b.classList.toggle("is-active", k === state.mode));
    navRow.style.display = state.mode === "grid" ? "none" : "";
  };

  const renderTrackContent = () => {
    syncSubtitle();
    clear(track);
    if (state.mode === "grid") {
      LENSES.forEach((lens, idx) => {
        track.appendChild(
          h("div.bm8-lens-slide", { attr: { "data-slide-idx": String(idx) } }, [
            h("div.bm8-grid-head", [icon(lens.icon, 14), h("strong", { text: lens.label })]),
            buildSingleLens(idx)
          ])
        );
      });
    } else {
      const activeIdx = state.page;
      track.appendChild(
        h("div.bm8-lens-slide.is-single", { attr: { "data-slide-idx": String(activeIdx) } }, [
          buildSingleLens(activeIdx)
        ])
      );
    }
  };

  function goToPage(idx, explicitDir) {
    const next = Math.max(0, Math.min(3, idx));
    if (next === state.page && state.mode === "slide") return;
    const dir = explicitDir != null ? explicitDir : next >= state.page ? 1 : -1;
    const wasGrid = state.mode === "grid";
    state.page = next;
    state.mode = "slide";
    syncControls();
    ctx.onLensPageChange && ctx.onLensPageChange(state.page);
    if (wasGrid) {
      scrollUnrollMorph(viewport, renderTrackContent, { expanding: false });
    } else {
      paperSlipSwap(viewport, renderTrackContent, { dir });
    }
  }

  function setMode(mode) {
    const next = mode === "grid" ? "grid" : "slide";
    if (next === state.mode) return;
    state.mode = next;
    syncControls();
    ctx.onLensModeChange && ctx.onLensModeChange(state.mode);
    scrollUnrollMorph(viewport, renderTrackContent, { expanding: next === "grid" });
  }

  section.addEventListener("keydown", (e) => {
    if (state.mode !== "slide") return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goToPage((state.page + 1) % 4, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goToPage((state.page + 3) % 4, -1);
    }
  });

  let touchStartX = null;
  let touchStartY = null;
  viewport.addEventListener(
    "pointerdown",
    (e) => {
      if (state.mode !== "slide" || e.pointerType === "mouse") return;
      touchStartX = e.clientX;
      touchStartY = e.clientY;
    },
    { passive: true }
  );
  viewport.addEventListener(
    "pointerup",
    (e) => {
      if (touchStartX == null || state.mode !== "slide") return;
      const dx = e.clientX - touchStartX;
      const dy = e.clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0 && state.page < 3) goToPage(state.page + 1, 1);
        else if (dx > 0 && state.page > 0) goToPage(state.page - 1, -1);
      }
    },
    { passive: true }
  );

  renderTrackContent();
  syncControls();

  section.appendChild(
    h("div.bm8-lens-header", [
      h("div.bm8-lens-head-top", [
        h("div.bm8-lens-title-wrap", [
          h("span.bm7-badge-icon", [icon("trend", 15)]),
          h("div.bm8-lens-titles", [h("h3.bm7-sec-title", { text: "看番记录" }), subtitleEl])
        ]),
        modeSeg
      ]),
      navRow
    ])
  );
  section.appendChild(viewport);
  host.appendChild(section);

  return {
    el: section,
    update(nextItems, nextEvents) {
      curItems = filterLensItems(nextItems);
      curEvents = nextEvents || [];
      renderTrackContent();
    }
  };
}

/* =========================================================================
 * 4. 配套样式（严格保证全部字号 >= 12px、明暗对比清晰、零内部纵向滚动条）
 * ========================================================================= */

const MOTION_AND_LENS_CSS = String.raw`
/* -------- CSS @property 注册：让 --bm7-ambient 环境主色真正丝滑插值过渡，零跳变 -------- */
@property --bm7-ambient {
  syntax: "<color>";
  inherits: true;
  initial-value: #4c62b6;
}
@property --bm7-ambient-2 {
  syntax: "<color>";
  inherits: true;
  initial-value: #8c6db8;
}
@property --bm7-ambient-3 {
  syntax: "<color>";
  inherits: true;
  initial-value: #4fa8c9;
}
.bm7-root, .bm7-hero {
  transition: --bm7-ambient .64s cubic-bezier(.22,1,.36,1), --bm7-ambient-2 .64s cubic-bezier(.22,1,.36,1), --bm7-ambient-3 .64s cubic-bezier(.22,1,.36,1);
}

/* 双缓冲柔光底图：不销毁 DOM 节点、不重置 bm7-drift 动画相位 */
.bm7-decor-glow-img.is-a,
.bm7-decor-glow-img.is-b {
  opacity: 0;
  transition: opacity .88s cubic-bezier(.22,1,.36,1);
}
.bm7-decor-glow-img.is-shown {
  opacity: .56;
}
.theme-dark .bm7-decor-glow-img.is-shown {
  opacity: .48;
}

/* -------- 封面柔光（glow）：追光池 + 光标呼吸视差 + 磨砂边缘折射 + 封面微倾 -------- */
.bm8-glow-pool {
  position: absolute;
  left: var(--bm8-mx, 36%);
  top: var(--bm8-my, 24%);
  width: 680px;
  height: 680px;
  margin-left: -340px;
  margin-top: -340px;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--bm7-ambient) 56%, transparent) 0%,
    color-mix(in srgb, var(--bm7-ambient-2) 32%, transparent) 40%,
    transparent 74%
  );
  filter: blur(52px);
  opacity: .68;
  will-change: left, top, scale, opacity;
}
.theme-dark .bm8-glow-pool {
  opacity: .62;
}
.bm7-root[data-bm7-theme="glow"].is-bm8-pointer .bm8-glow-pool {
  opacity: .92;
}
.bm7-root[data-bm7-motion="on"] .bm8-glow-pool {
  animation: bm8-pool-breathe 4.6s ease-in-out infinite alternate;
}
.bm7-root[data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb1 {
  transform: translate3d(calc(var(--bm7-px, 0) * 74px), calc(var(--bm7-py, 0) * 56px), 0);
}
.bm7-root[data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb2 {
  transform: translate3d(calc(var(--bm7-px, 0) * -82px), calc(var(--bm7-py, 0) * 60px), 0);
}
.bm7-root[data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb3 {
  transform: translate3d(calc(var(--bm7-px, 0) * 60px), calc(var(--bm7-py, 0) * -54px), 0);
}
.bm7-root[data-bm7-motion="on"][data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb1 {
  animation: bm8-orb-pulse 5.6s ease-in-out infinite alternate;
}
.bm7-root[data-bm7-motion="on"][data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb2 {
  animation: bm8-orb-pulse 7.2s ease-in-out 1.2s infinite alternate-reverse;
}
.bm7-root[data-bm7-motion="on"][data-bm7-theme="glow"] .bm7-decor-glow-orb.is-orb3 {
  animation: bm8-orb-pulse 8.0s ease-in-out 2.2s infinite alternate;
}

/* 磨砂玻璃边缘折射高光（仅在封面柔光「丰富」档显现，z-index: 1 确保绝不穿透上沿破框动画封面） */
.bm8-rim-light {
  display: none;
}
.bm7-root[data-bm7-theme="glow"][data-bm7-motion="on"]:not([data-bm7-motion-tier="lite"]) .bm8-rim-light {
  display: block;
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1.5px;
  pointer-events: none;
  z-index: 1;
  opacity: calc(var(--bm8-rim-a, 0) * 0.96);
  transition: opacity .20s ease;
  background: radial-gradient(
    280px circle at var(--bm8-rim-x, 50%) var(--bm8-rim-y, 0%),
    color-mix(in srgb, var(--bm7-ambient) 76%, #ffffff) 0%,
    color-mix(in srgb, var(--bm7-ambient-2) 42%, transparent) 50%,
    transparent 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
}
.bm7-hero, .bm7-panel, .bm8-lens, .bm7-feed {
  position: relative;
}

/* 焦点封面微倾与柔光斜掠光泽（轻巧档暂停 3D 倾斜以减负） */
.bm7-root[data-bm7-theme="glow"][data-bm7-motion="on"]:not([data-bm7-motion-tier="lite"]) .bm7-hero-cover.bm8-tilt {
  transform: perspective(680px) rotateX(var(--bm8-tx, 0deg)) rotateY(var(--bm8-ty, 0deg));
  transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .24s ease;
  will-change: transform;
}
.bm8-glare {
  display: none;
}
.bm7-root[data-bm7-theme="glow"][data-bm7-motion="on"]:not([data-bm7-motion-tier="lite"]) .bm7-hero-cover .bm8-glare {
  display: block;
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(
    150px circle at var(--bm8-gx, 32%) var(--bm8-gy, 24%),
    rgb(255 255 255 / .28) 0%,
    transparent 70%
  );
  opacity: 0;
  transition: opacity .25s ease;
}
.bm7-root[data-bm7-theme="glow"].is-bm8-pointer .bm7-hero-cover .bm8-glare {
  opacity: 1;
}

/* -------- 多尺度分层动效体系 -------- */
/* 1) 顶层大视图切换：干净顺滑的横向层叠滑移 */
.bm8-ws-glide-next {
  animation: bm8-ws-in-next .28s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-ws-glide-prev {
  animation: bm8-ws-in-prev .28s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-ws-glide-lite {
  animation: bm8-soft-fade .18s ease both;
}
@keyframes bm8-ws-in-next {
  from { opacity: 0; transform: translate3d(18px, 0, 0); }
  to { opacity: 1; transform: none; }
}
@keyframes bm8-ws-in-prev {
  from { opacity: 0; transform: translate3d(-18px, 0, 0); }
  to { opacity: 1; transform: none; }
}

/* 2) 中小面板内部切换：便签稿纸轻斜滑落 + 下层新页清透显影 */
.bm8-memo-slip-sheet {
  position: absolute !important;
  inset: 0 !important;
  z-index: 6;
  pointer-events: none !important;
  overflow: hidden !important;
  border-radius: 10px;
  background: var(--bm7-panel-bg, var(--bm7-surface)) !important;
  border-top: 1px solid color-mix(in srgb, var(--bm7-accent) 22%, var(--bm7-line));
  box-shadow: 0 12px 26px -14px rgb(20 18 14 / .22), 0 1px 0 rgb(255 255 255 / .18) inset !important;
  transform-origin: 18% 0%;
  animation: bm8-memo-slip-out .29s cubic-bezier(.32, .06, .24, 1) forwards;
}
.bm8-memo-slip-sheet.is-frameless {
  border: none !important;
  box-shadow: none !important;
  border-radius: 0;
  background: transparent !important;
  overflow: visible !important;
  transform-origin: 50% 50%;
  animation: bm8-frameless-out .10s cubic-bezier(.4, 0, 1, 1) forwards;
}
.bm8-memo-slip-sheet.is-frameless.is-reverse {
  transform-origin: 50% 50%;
  animation-name: bm8-frameless-out-rev;
}
.bm8-memo-slip-sheet:not(.is-frameless).is-reverse {
  transform-origin: 82% 0%;
  animation-name: bm8-memo-slip-out-rev;
}
.bm8-paper-under-reveal {
  animation: bm8-paper-under-in .28s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-paper-under-reveal.is-frameless-in {
  animation: bm8-frameless-in .21s cubic-bezier(.22, 1, .36, 1) .07s both;
}
.bm8-paper-under-reveal.is-frameless-in-rev {
  animation: bm8-frameless-in-rev .21s cubic-bezier(.22, 1, .36, 1) .07s both;
}
.bm8-paper-lite-in {
  animation: bm8-soft-fade .20s cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes bm8-frameless-out {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(-8px, 0, 0); }
}
@keyframes bm8-frameless-out-rev {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(8px, 0, 0); }
}
@keyframes bm8-frameless-in {
  from { opacity: 0; transform: translate3d(8px, 0, 0); }
  to { opacity: 1; transform: none; }
}
@keyframes bm8-frameless-in-rev {
  from { opacity: 0; transform: translate3d(-8px, 0, 0); }
  to { opacity: 1; transform: none; }
}
@keyframes bm8-memo-slip-out {
  0% { opacity: 1; transform: translate3d(0, 0, 0) rotateZ(0deg); }
  32% { opacity: .88; transform: translate3d(-5px, 6px, 0) rotateZ(-0.8deg); }
  100% { opacity: 0; transform: translate3d(-16px, 22px, 0) rotateZ(-1.8deg); }
}
@keyframes bm8-memo-slip-out-rev {
  0% { opacity: 1; transform: translate3d(0, 0, 0) rotateZ(0deg); }
  32% { opacity: .88; transform: translate3d(5px, 6px, 0) rotateZ(0.8deg); }
  100% { opacity: 0; transform: translate3d(16px, 22px, 0) rotateZ(1.8deg); }
}
@keyframes bm8-paper-under-in {
  from { opacity: .72; transform: translate3d(0, 4px, 0); }
  to { opacity: 1; transform: none; }
}

/* 3) 逐页 ⇄ 平铺与内联展开：画卷滚轴顺滑铺展 / 柔和卷起 */
.bm8-scroll-roller {
  position: absolute;
  left: 0;
  right: 0;
  height: 16px;
  pointer-events: none;
  z-index: 7;
  border-top: 1.5px solid color-mix(in srgb, var(--bm7-accent) 44%, var(--bm7-line));
  background: linear-gradient(180deg, color-mix(in srgb, var(--bm7-ink) 10%, transparent) 0%, transparent 100%);
}
.bm8-scroll-roller.is-unrolling {
  top: 0;
  animation: bm8-roller-down .42s cubic-bezier(.22, 1, .36, 1) forwards;
}
.bm8-scroll-roller.is-rolling-up {
  bottom: 0;
  animation: bm8-roller-up .40s cubic-bezier(.22, 1, .36, 1) forwards;
}
.bm8-scroll-item-morph {
  animation: bm8-scroll-card-unfurl .36s cubic-bezier(.22, 1, .36, 1) var(--bm8-stagger, 0ms) both;
}
@keyframes bm8-roller-down {
  0% { transform: translateY(24px); opacity: .92; }
  80% { opacity: .65; }
  100% { transform: translateY(420px); opacity: 0; }
}
@keyframes bm8-roller-up {
  0% { transform: translateY(0); opacity: .88; }
  100% { transform: translateY(-180px); opacity: 0; }
}
@keyframes bm8-scroll-card-unfurl {
  from { opacity: 0; transform: translateY(-8px) scale(.99); }
  to { opacity: 1; transform: none; }
}

/* -------- 翻页转场双通道：洛琪希手记平实阅读器滑页 vs 其他动态外观内裁切轻掀页 -------- */
.bm8-swap-stage {
  position: absolute !important;
  inset: 0 !important;
  overflow: hidden !important;
  border-radius: inherit !important;
  pointer-events: none !important;
  z-index: 8;
}

/* 洛琪希手记：现代阅读器/纸质手账不透明整页滑移 + 柔和书脊折影（零双影叠字、零顶边残片） */
.bm8-journal-sheet {
  position: absolute !important;
  inset: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  border: 1px solid var(--bm7-line) !important;
  border-radius: inherit !important;
  background-color: var(--bm7-bg, #f3ecdd) !important;
  background-image: linear-gradient(90deg, var(--bm7-panel-bg) 0%, var(--bm7-panel-bg) 94%, color-mix(in srgb, var(--bm7-panel-bg) 88%, #cbb998) 100%) !important;
  box-shadow: 12px 0 28px -8px rgb(42 32 16 / .24) !important;
  pointer-events: none !important;
  will-change: transform;
  animation: bm8-journal-glide .35s cubic-bezier(.32, .08, .24, 1) forwards;
}
.theme-dark .bm8-journal-sheet {
  background-image: linear-gradient(90deg, var(--bm7-panel-bg) 0%, var(--bm7-panel-bg) 94%, color-mix(in srgb, var(--bm7-panel-bg) 82%, #090c16) 100%) !important;
  box-shadow: 14px 0 30px -8px rgb(0 0 0 / .52) !important;
}
.bm8-journal-sheet.is-back {
  background-image: linear-gradient(270deg, var(--bm7-panel-bg) 0%, var(--bm7-panel-bg) 94%, color-mix(in srgb, var(--bm7-panel-bg) 88%, #cbb998) 100%) !important;
  box-shadow: -12px 0 28px -8px rgb(42 32 16 / .24) !important;
  animation-name: bm8-journal-glide-back;
}
.theme-dark .bm8-journal-sheet.is-back {
  background-image: linear-gradient(270deg, var(--bm7-panel-bg) 0%, var(--bm7-panel-bg) 94%, color-mix(in srgb, var(--bm7-panel-bg) 82%, #090c16) 100%) !important;
  box-shadow: -14px 0 30px -8px rgb(0 0 0 / .52) !important;
}
.bm8-journal-under-in {
  animation: bm8-journal-settle-in .35s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-journal-under-back {
  animation: bm8-journal-settle-back .35s cubic-bezier(.22, 1, .36, 1) both;
}

/* 洛琪希手记「看番记录」分页时的轻量书脊折影扫掠 */
.bm8-reader-crease {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  overflow: hidden;
  border-radius: inherit;
}
.bm8-reader-crease::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 64px;
  background: linear-gradient(90deg, transparent 0%, rgb(68 52 28 / .09) 48%, transparent 100%);
  animation: bm8-crease-sweep .34s cubic-bezier(.22, 1, .36, 1) forwards;
}
.theme-dark .bm8-reader-crease::after {
  background: linear-gradient(90deg, transparent 0%, rgb(150 170 245 / .11) 48%, transparent 100%);
}
.bm8-reader-crease.is-back::after {
  animation-direction: reverse;
}

/* 其他开启动态效果的外观：修复后的严格内裁切不透明轻掀卡片 + 右下留白星芒 */
.bm8-leaf {
  position: absolute !important;
  inset: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  z-index: 6;
  pointer-events: none !important;
  border: 1px solid var(--bm7-line) !important;
  border-radius: inherit !important;
  background-color: var(--bm7-bg, #202024) !important;
  background-image: linear-gradient(135deg, var(--bm7-surface) 0%, var(--bm7-surface-2) 100%) !important;
  transform-origin: 0% 24%;
  animation: bm8-page-lift .38s cubic-bezier(.32, .08, .24, 1) forwards;
  box-shadow: 14px 10px 28px -12px rgb(0 0 0 / .28) !important;
}
.bm8-leaf.is-back {
  transform-origin: 100% 24%;
  animation-name: bm8-page-lift-back;
  box-shadow: -14px 10px 28px -12px rgb(0 0 0 / .28) !important;
}
.bm8-ink-in {
  animation: bm8-clean-reveal .36s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-soft-swap {
  animation: bm8-soft-fade .22s cubic-bezier(.22, 1, .36, 1) both;
}
.bm8-ink-flourish {
  position: absolute;
  right: 16px;
  bottom: 8px;
  width: 156px;
  height: 24px;
  left: auto;
  top: auto;
  pointer-events: none;
  overflow: visible;
  z-index: 5;
}
.bm8-nib-trace {
  position: absolute;
  left: 0;
  right: 18px;
  bottom: 2px;
  height: 12px;
  fill: none;
  stroke: color-mix(in srgb, var(--bm7-accent) 62%, #c99b49);
  stroke-width: 1.15;
  stroke-linecap: round;
  opacity: .68;
}
.bm8-nib-trace path {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: bm8-nib-draw .48s cubic-bezier(.22, 1, .36, 1) forwards;
}
.bm8-ink-star {
  position: absolute;
  width: 12px;
  height: 12px;
  fill: color-mix(in srgb, var(--bm7-accent) 78%, #7cc4ff);
  opacity: 0;
  animation: bm8-star-pop .52s cubic-bezier(.22, 1, .36, 1) forwards;
}
.bm8-ink-star.is-s1 { right: 4px; bottom: 6px; animation-delay: .05s; }
.bm8-ink-star.is-s2 { right: 20px; bottom: 12px; width: 8.5px; height: 8.5px; fill: var(--bm7-gold, #c99b52); animation-delay: .12s; }
.bm8-ink-flourish.is-compact { width: 120px; height: 18px; right: 12px; bottom: 4px; }
.bm8-ink-flourish.is-compact .bm8-nib-trace { height: 9px; opacity: .52; }

@keyframes bm8-pool-breathe {
  0% { scale: 0.88; opacity: .54; }
  100% { scale: 1.16; opacity: .88; }
}
@keyframes bm8-orb-pulse {
  0% { scale: 0.90; opacity: .36; }
  100% { scale: 1.14; opacity: .68; }
}
@keyframes bm8-journal-glide {
  0% { transform: translate3d(0, 0, 0); opacity: 1; }
  82% { opacity: 1; }
  100% { transform: translate3d(-103%, 0, 0); opacity: 0; }
}
@keyframes bm8-journal-glide-back {
  0% { transform: translate3d(0, 0, 0); opacity: 1; }
  82% { opacity: 1; }
  100% { transform: translate3d(103%, 0, 0); opacity: 0; }
}
@keyframes bm8-journal-settle-in {
  from { transform: translate3d(14px, 0, 0); }
  to { transform: none; }
}
@keyframes bm8-journal-settle-back {
  from { transform: translate3d(-14px, 0, 0); }
  to { transform: none; }
}
@keyframes bm8-crease-sweep {
  from { transform: translate3d(-64px, 0, 0); opacity: .95; }
  to { transform: translate3d(680px, 0, 0); opacity: 0; }
}
@keyframes bm8-page-lift {
  0% { opacity: 1; transform: translate3d(0, 0, 0) rotateZ(0deg); }
  72% { opacity: .96; }
  100% { opacity: 0; transform: translate3d(-102%, -8px, 0) rotateZ(-1.4deg); }
}
@keyframes bm8-page-lift-back {
  0% { opacity: 1; transform: translate3d(0, 0, 0) rotateZ(0deg); }
  72% { opacity: .96; }
  100% { opacity: 0; transform: translate3d(102%, -8px, 0) rotateZ(1.4deg); }
}
@keyframes bm8-clean-reveal {
  from { transform: translate3d(10px, 2px, 0); }
  to { transform: none; }
}
@keyframes bm8-nib-draw {
  0% { stroke-dashoffset: 1; opacity: .82; }
  75% { stroke-dashoffset: 0; opacity: .68; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes bm8-star-pop {
  0% { opacity: 0; transform: scale(.35) rotate(-25deg); }
  45% { opacity: .88; transform: scale(1.08) rotate(8deg); }
  100% { opacity: 0; transform: scale(.75) translateY(-5px) rotate(22deg); }
}
@keyframes bm8-soft-fade {
  from { opacity: .55; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

/* -------- 统一「看番记录」多维透镜面板（零内部纵向滚动条，全字号 >= 12px，组件级容器查询） -------- */
.bm8-lens {
  container-type: inline-size;
  container-name: bm8lens;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  outline: none;
}
.bm8-lens .bm7-sec-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 750;
  letter-spacing: .01em;
  color: var(--bm7-ink);
  line-height: 1.25;
}
.bm8-lens:focus-visible {
  box-shadow: 0 0 0 2px var(--bm7-accent), var(--bm7-shadow);
}
.bm8-lens-header {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.bm8-lens-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  min-width: 0;
}
.bm8-lens-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bm8-lens-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bm8-lens-sub {
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1.35;
}
.bm8-lens-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.bm8-lens-tabs {
  min-width: 0;
  max-width: 100%;
}
.bm8-lens-arrows {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.bm7-root .bm8-lens-arrow {
  width: 28px !important;
  height: 28px !important;
  border-radius: 8px !important;
}

/* 逐页便签视口 vs 四宫格画卷平铺模式 */
.bm8-lens-viewport {
  position: relative;
  overflow: clip;
  width: 100%;
  min-width: 0;
}
.bm8-lens[data-lens-mode="slide"] .bm8-lens-track {
  display: block;
  width: 100%;
  min-width: 0;
}
.bm8-lens[data-lens-mode="slide"] .bm8-lens-slide {
  width: 100%;
  min-width: 0;
  padding: 1px 2px;
  box-sizing: border-box;
}
.bm8-grid-head {
  display: none;
}
.bm8-lens[data-lens-mode="grid"] .bm8-lens-track {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  transform: none !important;
}
@container bm8lens (max-width: 680px) {
  .bm8-lens[data-lens-mode="grid"] .bm8-lens-track {
    grid-template-columns: minmax(0, 1fr);
  }
}
.bm8-lens[data-lens-mode="grid"] .bm8-lens-slide {
  width: 100%;
  min-width: 0;
  padding: 12px 13px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bm7-surface-2) 64%, transparent);
  border: 1px solid color-mix(in srgb, var(--bm7-line) 72%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bm8-lens[data-lens-mode="grid"] .bm8-grid-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--bm7-ink);
}

.bm8-lens-card {
  container-type: inline-size;
  container-name: bm8card;
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
}
.bm8-kpi-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
.bm8-kpi-strip.is-compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  flex: 1 1 220px;
}
@container bm8card (max-width: 440px) {
  .bm8-kpi-strip {
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
  }
  .bm8-kpi-strip.is-compact {
    grid-template-columns: minmax(0, 1fr);
    flex: 1 1 100%;
    gap: 5px;
  }
  .bm8-kpi {
    flex-direction: row !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px;
    padding: 6px 10px !important;
  }
}
.bm8-kpi {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bm7-ink) 4.2%, transparent);
  min-width: 0;
}
.bm8-kpi-label {
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bm8-kpi-val {
  font-size: 14px;
  font-weight: 750;
  color: var(--bm7-ink);
  line-height: 1.35;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.bm8-lens[data-lens-mode="grid"] .bm8-kpi-strip,
.bm8-lens[data-lens-mode="grid"] .bm8-kpi-strip.is-compact {
  grid-template-columns: minmax(0, 1fr);
  gap: 5px;
  flex: 1 1 100%;
}
.bm8-lens[data-lens-mode="grid"] .bm8-kpi {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
}
.bm8-lens[data-lens-mode="grid"] .bm8-kpi-val {
  font-size: 13px;
}
.bm8-lens[data-lens-mode="grid"] .bm8-heat-grid {
  grid-template-rows: repeat(7, 11px);
  gap: 2.5px;
}
.bm8-lens[data-lens-mode="grid"] .bm8-studio-row {
  grid-template-columns: minmax(68px, 102px) minmax(0, 1fr) auto;
  gap: 7px;
}

/* Lens 1: 12 周热力图 */
.bm8-heat-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.bm8-heat-months {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  padding-left: 24px;
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1.2;
}
.bm8-heat-month {
  white-space: nowrap;
}
.bm8-heat-body {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 4px;
  align-items: stretch;
}
.bm8-heat-dows {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1;
  padding: 1px 0;
}
.bm8-heat-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: repeat(7, 13px);
  grid-auto-flow: column;
  gap: 4px;
  min-width: 0;
}
.bm8-heat-cell,
.bm7-root button.bm8-heat-cell {
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 3.5px !important;
  background: color-mix(in srgb, var(--bm7-ink) 8%, transparent) !important;
  transition: transform .12s ease, background .18s ease, outline .14s ease;
}
.bm7-root button.bm8-heat-cell.is-clickable {
  cursor: pointer;
}
.bm8-heat-grid .bm8-heat-cell.is-clickable:hover {
  transform: scale(1.18);
}
.bm8-heat-grid .bm8-heat-cell.is-selected {
  outline: 2px solid var(--bm7-accent) !important;
  outline-offset: 1px;
  transform: scale(1.12);
}
.bm8-heat-cell.is-future { opacity: .28; }
.bm8-heat-cell.lv-1, .bm7-root button.bm8-heat-cell.lv-1 { background: color-mix(in srgb, var(--bm7-accent) 28%, var(--bm7-surface-2)) !important; }
.bm8-heat-cell.lv-2, .bm7-root button.bm8-heat-cell.lv-2 { background: color-mix(in srgb, var(--bm7-accent) 50%, var(--bm7-surface-2)) !important; }
.bm8-heat-cell.lv-3, .bm7-root button.bm8-heat-cell.lv-3 { background: color-mix(in srgb, var(--bm7-accent) 74%, var(--bm7-surface-2)) !important; }
.bm8-heat-cell.lv-4, .bm7-root button.bm8-heat-cell.lv-4 { background: var(--bm7-accent) !important; }
.bm8-heat-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--bm7-ink-3);
}
.bm8-heat-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.bm8-heat-legend .bm8-heat-cell {
  width: 11px;
  height: 11px;
}

/* 通用底部快跳胶囊 */
.bm8-sub-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  min-width: 0;
}
.bm8-sub-foot.is-end {
  justify-content: flex-end;
}
.bm8-sub-label {
  font-size: 12px;
  color: var(--bm7-ink-3);
  flex-shrink: 0;
}
.bm8-inline-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.bm7-root .bm8-mini-chip {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 27px !important;
  padding: 0 10px !important;
  border-radius: 999px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-line) 85%, transparent) !important;
  background: color-mix(in srgb, var(--bm7-surface) 76%, transparent) !important;
  color: var(--bm7-ink) !important;
  font-size: 12px !important;
  cursor: pointer;
  box-shadow: none !important;
  min-width: 0;
}
.bm7-root .bm8-mini-chip:hover {
  border-color: color-mix(in srgb, var(--bm7-accent) 48%, var(--bm7-line)) !important;
  color: var(--bm7-accent) !important;
}
.bm8-mini-chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.bm8-mini-chip-meta {
  font-size: 12px;
  color: var(--bm7-ink-3);
  flex-shrink: 0;
}
.bm8-mini-chip-score {
  font-size: 12px;
  font-weight: 700;
  color: var(--bm7-gold);
  flex-shrink: 0;
}
.bm8-ml-auto {
  margin-left: auto;
}

/* Lens 2: 在看进度网格 */
.bm8-watch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
@container bm8card (max-width: 520px) {
  .bm8-watch-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.bm8-lens[data-lens-mode="grid"] .bm8-watch-grid {
  grid-template-columns: minmax(0, 1fr);
}
.bm7-root .bm8-watch-row {
  display: grid !important;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 10px !important;
  height: auto !important;
  border-radius: 10px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-line) 70%, transparent) !important;
  background: color-mix(in srgb, var(--bm7-surface) 72%, transparent) !important;
  color: var(--bm7-ink) !important;
  text-align: left !important;
  cursor: pointer;
  box-shadow: none !important;
  min-width: 0;
  white-space: normal !important;
}
.bm7-root .bm8-watch-row:hover {
  border-color: color-mix(in srgb, var(--bm7-accent) 45%, var(--bm7-line)) !important;
  background: var(--bm7-surface-3) !important;
}
.bm8-watch-thumb {
  width: 36px;
  height: 48px;
  border-radius: 6px;
}
.bm8-watch-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.bm8-watch-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.bm8-watch-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--bm7-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.bm8-watch-frac {
  font-size: 12px;
  font-weight: 700;
  color: var(--bm7-accent);
  flex-shrink: 0;
}
.bm8-watch-bar {
  margin-top: 2px;
  height: 5px;
}
.bm8-watch-hint {
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1.3;
}

/* Lens 3: 想看清单可交互篇幅条与图例 */
.bm8-stack-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.bm8-stack-bar {
  display: flex;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
  background: color-mix(in srgb, var(--bm7-ink) 8%, transparent);
}
.bm7-root button.bm8-stack-seg {
  height: 100% !important;
  min-height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  cursor: pointer;
  transition: filter .15s ease, transform .15s ease;
}
.bm7-root button.bm8-stack-seg:hover {
  filter: brightness(1.12);
}
.bm7-root button.bm8-stack-seg.is-selected {
  box-shadow: inset 0 0 0 2px var(--bm7-surface), inset 0 0 0 3.5px var(--bm7-ink) !important;
}
.bm8-stack-seg.is-b1, .bm7-root button.bm8-stack-seg.is-b1, .bm8-stack-dot.is-b1 { background: var(--bm7-accent) !important; }
.bm8-stack-seg.is-b2, .bm7-root button.bm8-stack-seg.is-b2, .bm8-stack-dot.is-b2 { background: color-mix(in srgb, var(--bm7-accent) 62%, var(--bm7-ok)) !important; }
.bm8-stack-seg.is-b3, .bm7-root button.bm8-stack-seg.is-b3, .bm8-stack-dot.is-b3 { background: var(--bm7-gold) !important; }
.bm8-stack-seg.is-b4, .bm7-root button.bm8-stack-seg.is-b4, .bm8-stack-dot.is-b4 { background: color-mix(in srgb, var(--bm7-ink) 28%, transparent) !important; }
.bm8-stack-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 8px;
  font-size: 12px;
  color: var(--bm7-ink-2);
}
.bm7-root button.bm8-stack-item {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  height: 26px !important;
  padding: 0 8px !important;
  border-radius: 999px !important;
  border: 1px solid transparent !important;
  background: color-mix(in srgb, var(--bm7-ink) 4%, transparent) !important;
  color: var(--bm7-ink-2) !important;
  font-size: 12px !important;
  cursor: pointer;
  box-shadow: none !important;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.bm7-root button.bm8-stack-item:hover {
  background: color-mix(in srgb, var(--bm7-accent) 12%, transparent) !important;
  color: var(--bm7-ink) !important;
}
.bm7-root button.bm8-stack-item.is-selected {
  background: var(--bm7-accent-soft) !important;
  border-color: color-mix(in srgb, var(--bm7-accent) 42%, transparent) !important;
  color: var(--bm7-accent) !important;
}
.bm8-stack-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

/* Lens 4: 我的口味（可交互评分柱 + 标签云 / 动画公司 / 完结月份 + 窄侧栏容器自适应） */
.bm8-taste-top {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.bm8-score-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bm7-ink) 4.2%, transparent);
  flex: 1 1 168px;
  min-height: 58px;
  min-width: 0;
}
.bm7-root button.bm8-score-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 3px;
  height: auto !important;
  min-height: 50px !important;
  padding: 3px 2px !important;
  border: 1px solid transparent !important;
  border-radius: 8px !important;
  background: transparent !important;
  box-shadow: none !important;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.bm7-root button.bm8-score-col:hover {
  background: color-mix(in srgb, var(--bm7-accent) 10%, transparent) !important;
}
.bm7-root button.bm8-score-col.is-selected {
  background: var(--bm7-accent-soft) !important;
  border-color: color-mix(in srgb, var(--bm7-accent) 38%, transparent) !important;
}
.bm8-score-cnt {
  font-size: 12px;
  line-height: 1;
  color: var(--bm7-ink-3);
  min-height: 12px;
}
.bm7-root button.bm8-score-col.is-selected .bm8-score-cnt,
.bm7-root button.bm8-score-col.is-selected .bm8-score-lbl {
  color: var(--bm7-accent);
  font-weight: 700;
}
.bm8-score-bar-wrap {
  width: 100%;
  height: 24px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bm8-score-bar {
  width: 100%;
  max-width: 22px;
  border-radius: 4px 4px 2px 2px;
  background: color-mix(in srgb, var(--bm7-accent) 78%, var(--bm7-gold));
  transition: height .28s ease, background .16s ease;
}
.bm7-root button.bm8-score-col.is-selected .bm8-score-bar {
  background: var(--bm7-accent);
}
.bm8-score-lbl {
  font-size: 12px;
  color: var(--bm7-ink-3);
  line-height: 1.1;
  white-space: nowrap;
}
.bm8-taste-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 8px;
  min-width: 0;
  max-width: 100%;
}
.bm8-taste-tabs {
  min-width: 0;
  max-width: 100%;
}
@container bm8card (max-width: 390px) {
  .bm8-taste-tabs .bm7-seg-btn {
    padding: 0 8px !important;
  }
  .bm8-kpi-scale-note {
    display: none;
  }
}
.bm8-taste-subbody {
  position: relative;
  min-height: 68px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.bm8-muted-note {
  font-size: 12.5px;
  color: var(--bm7-ink-3);
  padding: 8px 2px;
}
.bm8-tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bm7-root .bm8-tag-pill {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  height: 27px !important;
  padding: 0 10px !important;
  border-radius: 999px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-accent) 22%, transparent) !important;
  background: var(--bm7-accent-soft) !important;
  color: var(--bm7-accent) !important;
  font-size: 12px !important;
  font-weight: 600;
  cursor: pointer;
  box-shadow: none !important;
  max-width: 100%;
}
.bm7-root .bm8-tag-pill:hover {
  background: color-mix(in srgb, var(--bm7-accent) 22%, transparent) !important;
}
.bm7-root .bm8-tag-pill.is-selected {
  background: var(--bm7-accent) !important;
  color: var(--bm7-accent-ink) !important;
  border-color: var(--bm7-accent) !important;
}
.bm8-tag-cnt {
  font-size: 12px;
  opacity: .78;
}
.bm8-studio-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bm7-root .bm8-studio-row {
  display: grid !important;
  grid-template-columns: minmax(76px, 136px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 28px !important;
  padding: 0 8px !important;
  border-radius: 8px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  color: var(--bm7-ink) !important;
  font-size: 12.5px !important;
  cursor: pointer;
  box-shadow: none !important;
  text-align: left !important;
  min-width: 0;
}
.bm7-root .bm8-studio-row:hover {
  background: var(--bm7-surface-3) !important;
}
.bm7-root .bm8-studio-row.is-selected {
  background: var(--bm7-accent-soft) !important;
  border-color: color-mix(in srgb, var(--bm7-accent) 36%, transparent) !important;
  color: var(--bm7-accent) !important;
}
.bm8-studio-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  min-width: 0;
}
.bm8-studio-bar-track {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bm7-ink) 8%, transparent);
  overflow: hidden;
  min-width: 24px;
}
.bm8-studio-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--bm7-accent);
}
.bm8-studio-meta {
  font-size: 12px;
  color: var(--bm7-ink-2);
  white-space: nowrap;
}
.bm8-months-chart {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 3px;
  align-items: end;
  padding: 4px 0 0;
  min-height: 78px;
  min-width: 0;
}
.bm7-root button.bm8-month-col {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 3px;
  min-width: 0;
  height: auto !important;
  min-height: 68px !important;
  padding: 3px 1px !important;
  border: 1px solid transparent !important;
  border-radius: 7px !important;
  background: transparent !important;
  box-shadow: none !important;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.bm7-root button.bm8-month-col:hover {
  background: color-mix(in srgb, var(--bm7-accent) 10%, transparent) !important;
}
.bm7-root button.bm8-month-col.is-selected {
  background: var(--bm7-accent-soft) !important;
  border-color: color-mix(in srgb, var(--bm7-accent) 38%, transparent) !important;
}
.bm8-month-val {
  font-size: 12px;
  color: var(--bm7-ink-2);
  min-height: 14px;
  line-height: 1.1;
}
.bm8-month-bar-wrap {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bm8-month-bar {
  width: 100%;
  max-width: 14px;
  border-radius: 4px 4px 2px 2px;
  background: color-mix(in srgb, var(--bm7-ink) 12%, transparent);
}
.bm8-month-bar.is-has {
  background: var(--bm7-accent);
}
.bm8-month-lbl {
  font-size: 12px;
  color: var(--bm7-ink-3);
  white-space: nowrap;
  line-height: 1.1;
}
.bm7-root button.bm8-month-col.is-selected .bm8-month-lbl,
.bm7-root button.bm8-month-col.is-selected .bm8-month-val {
  color: var(--bm7-accent);
  font-weight: 700;
}
/* 卡片变窄时隐藏“月”字只显示纯数字 12 / 1..11，彻底杜绝 12 列文字拥挤重叠 */
@container bm8card (max-width: 450px) {
  .bm8-month-unit {
    display: none;
  }
  .bm8-months-chart {
    gap: 2px;
  }
}
@container bm8card (max-width: 265px) {
  .bm7-root button.bm8-month-col:nth-child(odd) .bm8-month-lbl {
    visibility: hidden;
  }
}

/* -------- 内联数据明细展开盘 + 跨页跳转预期按钮契约 -------- */
.bm8-drill-host {
  min-width: 0;
}
.bm8-drill-host:empty {
  display: none;
}
.bm8-drill-tray {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid color-mix(in srgb, var(--bm7-accent) 30%, var(--bm7-line));
  background: color-mix(in srgb, var(--bm7-surface) 86%, var(--bm7-accent-soft));
  min-width: 0;
}
.bm8-drill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.bm8-drill-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--bm7-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm7-root .bm8-drill-close {
  width: 24px !important;
  height: 24px !important;
  flex-shrink: 0;
}
.bm8-drill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}
@container bm8card (max-width: 420px) {
  .bm8-drill-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.bm7-root button.bm8-drill-item {
  display: grid !important;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  height: auto !important;
  min-height: 40px !important;
  padding: 5px 8px !important;
  border-radius: 8px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-line) 72%, transparent) !important;
  background: var(--bm7-surface) !important;
  color: var(--bm7-ink) !important;
  text-align: left !important;
  box-shadow: none !important;
  cursor: pointer;
  min-width: 0;
  white-space: normal !important;
}
.bm7-root button.bm8-drill-item:hover {
  border-color: color-mix(in srgb, var(--bm7-accent) 45%, var(--bm7-line)) !important;
  background: var(--bm7-surface-3) !important;
}
.bm8-drill-thumb {
  width: 28px;
  height: 38px;
  border-radius: 5px;
}
.bm8-drill-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bm8-drill-name {
  font-size: 12px;
  font-weight: 650;
  color: var(--bm7-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm8-drill-meta {
  font-size: 12px;
  color: var(--bm7-ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm8-drill-empty {
  font-size: 12px;
  color: var(--bm7-ink-2);
  padding: 4px 2px;
  line-height: 1.45;
}
.bm8-drill-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding-top: 4px;
  border-top: 1px dashed color-mix(in srgb, var(--bm7-line) 80%, transparent);
}
.bm8-drill-more-note {
  font-size: 12px;
  color: var(--bm7-ink-3);
}

/* 明确心理预期的跨页跳转胶囊 vs 页内抽屉按钮 */
.bm7-root button.bm8-jump-link {
  display: inline-flex !important;
  align-items: center;
  gap: 4px;
  height: 26px !important;
  padding: 0 9px !important;
  border-radius: 999px !important;
  border: 1px solid color-mix(in srgb, var(--bm7-accent) 32%, transparent) !important;
  background: color-mix(in srgb, var(--bm7-accent) 10%, transparent) !important;
  color: var(--bm7-accent) !important;
  font-size: 12px !important;
  font-weight: 650;
  cursor: pointer;
  box-shadow: none !important;
  white-space: nowrap;
  transition: background .15s ease, transform .15s ease, border-color .15s ease;
}
.bm7-root button.bm8-jump-link:hover {
  background: var(--bm7-accent) !important;
  color: var(--bm7-accent-ink) !important;
  border-color: var(--bm7-accent) !important;
}
.bm7-root button.bm8-jump-link svg {
  transition: transform .15s ease;
}
.bm7-root button.bm8-jump-link:hover svg {
  transform: translate(1.5px, -1.5px);
}
.bm7-root button.bm8-drawer-link {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  height: 26px !important;
  padding: 0 8px !important;
  border-radius: 7px !important;
  border: 1px dashed color-mix(in srgb, var(--bm7-line) 95%, transparent) !important;
  background: transparent !important;
  color: var(--bm7-ink-2) !important;
  font-size: 12px !important;
  font-weight: 600;
  cursor: pointer;
  box-shadow: none !important;
  white-space: nowrap;
}
.bm7-root button.bm8-drawer-link:hover {
  color: var(--bm7-accent) !important;
  border-color: color-mix(in srgb, var(--bm7-accent) 45%, var(--bm7-line)) !important;
  background: var(--bm7-accent-soft) !important;
}

/* 面板切换视口锚点呼吸垫：防止高列表切往紧凑视图时滚动条被强制钳制跳回页首 */
.bm8-anchor-stage {
  min-height: var(--bm8-anchor-min-h, 0px);
}

/* 修复关联提示圆圈内 tag 图标光学居中 */
.bm7-notice-icon svg {
  margin: 0 !important;
  display: block !important;
}
`;

module.exports = {
  attachCoverGlowMotion,
  captureScrollAncestors,
  restoreScrollAncestors,
  withPreservedScroll,
  inkPageSwap,
  paperSlipSwap,
  scrollUnrollMorph,
  animateWorkspaceGlide,
  createPageJumpLink,
  spawnInkFlourish,
  renderWatchLensDeck,
  MOTION_AND_LENS_CSS
};
