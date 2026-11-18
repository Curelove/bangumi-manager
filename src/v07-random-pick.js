/**
 * v0.7 视觉层 · 随机抽选（「随机看一集」/「随机玩一部」共用）
 * ---------------------------------------------------------------
 * 仪式感设计：三张封面扇形叠放 → 点击「抽一部」后前排卡片快速翻阅候选封面并逐渐减速 →
 * 停在结果上、轻微回弹并亮起一圈柔光 → 右侧展开结果说明与直达按钮。
 * 关闭动态效果（或系统减少动态）时，直接给出结果，不播放翻阅动画。
 *
 * cfg = {
 *   title, kind: "anime"|"game",
 *   items,                       // 全部条目
 *   scopes: [{ id, label, hint, filter(items) -> candidates, weight?(item) -> number }],
 *   scope,                       // 初始范围 id
 *   onScopeChange(id),
 *   getCover(item), getTitle(item), getKey(item),
 *   describe(item) -> { headline, reason, chips?: string[] },
 *   actions(item) -> [{ label, icon, variant, onClick, hidden }],
 *   emptyText
 * }
 */
const { h, clear, icon, coverEl, segmented, button, motionEnabled, wait, emptyState, applyAmbient } = require("./v07-core.js");

function weightedPick(list, weightFn, avoidKey, getKey) {
  if (!list.length) return null;
  const pool = list.length > 1 && avoidKey ? list.filter((x) => getKey(x) !== avoidKey) : list;
  const weights = pool.map((x) => Math.max(0.0001, weightFn ? Number(weightFn(x)) || 0.0001 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function shuffled(list, n) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function renderRandomPicker(host, cfg) {
  clear(host);
  const state = {
    scope: cfg.scope || (cfg.scopes[0] && cfg.scopes[0].id),
    result: null,
    lastKey: null,
    busy: false
  };
  const getKey = cfg.getKey || ((x) => x.id || x.title);
  const getTitle = cfg.getTitle || ((x) => x.title || x.name);

  const root = h("div.bm7-pick", { dataset: { kind: cfg.kind || "anime" } });
  const scopeBar = h("div.bm7-pick-scopes");
  const stage = h("div.bm7-pick-stage");
  const deck = h("div.bm7-pick-deck");
  const info = h("div.bm7-pick-info");
  stage.append(deck, info);
  root.append(scopeBar, stage);
  host.appendChild(root);

  const currentScope = () => cfg.scopes.find((s) => s.id === state.scope) || cfg.scopes[0];
  const candidates = () => {
    const sc = currentScope();
    try {
      return sc ? sc.filter(cfg.items || []) : [];
    } catch (_) {
      return [];
    }
  };

  const seg = segmented(
    cfg.scopes.map((s) => ({ value: s.id, label: s.label, title: s.hint || "" })),
    state.scope,
    (v) => {
      if (v === state.scope || state.busy) return;
      const prevIdx = cfg.scopes.findIndex((s) => s.id === state.scope);
      const nextIdx = cfg.scopes.findIndex((s) => s.id === v);
      const dir = nextIdx >= prevIdx ? 1 : -1;
      state.scope = v;
      state.result = null;
      cfg.onScopeChange && cfg.onScopeChange(v);
      const list = candidates();
      root.classList.remove("has-result");
      // 左侧三张扇形叠卡保持原位零裁切：先轻拢再舒展换牌，右侧文案独立便签滑页，彻底杜绝牌堆边缘被面板截断或闪白
      const animateDeck = motionEnabled(root);
      if (animateDeck) {
        if (deck._shuffleTid) clearTimeout(deck._shuffleTid);
        deck.classList.add("is-scope-shift");
        deck._shuffleTid = setTimeout(() => {
          updateIdleDeckCovers(list);
          requestAnimationFrame(() => {
            deck.classList.remove("is-scope-shift");
          });
          deck._shuffleTid = 0;
        }, 90);
      } else {
        updateIdleDeckCovers(list);
      }
      try {
        const { paperSlipSwap } = require("./v08-motion-and-lens.js");
        paperSlipSwap(info, () => paintIdleInfo(list), {
          dir,
          frameless: true,
          skipHeight: true,
          allowOverflow: true,
          celStageHost: stage
        });
      } catch (_) {
        paintIdleInfo(list);
      }
    },
    "is-small is-scroll"
  );
  scopeBar.appendChild(seg);

  // —— 牌堆 ——
  const back2 = h("div.bm7-pick-card.is-back2");
  const back1 = h("div.bm7-pick-card.is-back1");
  const front = h("div.bm7-pick-card.is-front");
  const halo = h("div.bm7-pick-halo");
  deck.append(halo, back2, back1, front);

  const setCardCover = (card, item, smoothSwap = false) => {
    if (!item) {
      card._coverUrl = "";
      clear(card);
      card.appendChild(h("div.bm7-pick-blank", [icon(cfg.kind === "game" ? "gamepad" : "dice", 26)]));
      return;
    }
    const nextUrl = String((cfg.getCover ? cfg.getCover(item) : item.cover) || "");
    const title = getTitle(item);
    if (smoothSwap && nextUrl && card._coverUrl === nextUrl && card.firstElementChild) {
      return;
    }
    if (smoothSwap && nextUrl && card.firstElementChild) {
      const pre = new Image();
      let swapped = false;
      const commit = () => {
        if (swapped || card._pendingUrl !== nextUrl) return;
        swapped = true;
        card._coverUrl = nextUrl;
        clear(card);
        card.appendChild(coverEl(nextUrl, title));
      };
      card._pendingUrl = nextUrl;
      pre.onload = commit;
      pre.onerror = commit;
      pre.src = nextUrl;
      if (pre.complete) commit();
      return;
    }
    card._pendingUrl = nextUrl;
    card._coverUrl = nextUrl;
    clear(card);
    card.appendChild(coverEl(nextUrl, title));
  };

  function updateIdleDeckCovers(list) {
    const preview = shuffled(list, 3);
    setCardCover(back2, preview[2] || preview[0] || null, true);
    setCardCover(back1, preview[1] || preview[0] || null, true);
    setCardCover(front, null, false);
  }

  function paintIdleInfo(list) {
    clear(info);
    const sc = currentScope();
    if (!list.length) {
      info.appendChild(emptyState(cfg.emptyText || "这个范围里暂时没有可抽的作品，换个范围试试。"));
      return;
    }
    info.append(
      h("div.bm7-pick-idle", [
        h("p.bm7-pick-lead", { text: cfg.kind === "game" ? "不知道玩什么的时候，交给运气。" : "不知道看什么的时候，交给运气。" }),
        h("p.bm7-pick-count", [h("span.bm7-num", { text: String(list.length) }), ` 部候选 · ${sc && sc.hint ? sc.hint : sc ? sc.label : ""}`]),
        button(cfg.kind === "game" ? "抽一部" : "抽一集", { icon: "shuffle", variant: "primary", cls: "bm7-pick-go", onClick: draw })
      ])
    );
  }

  function paintIdle() {
    const list = candidates();
    root.classList.remove("has-result");
    updateIdleDeckCovers(list);
    paintIdleInfo(list);
  }

  async function draw() {
    if (state.busy) return;
    const list = candidates();
    if (!list.length) return;
    const sc = currentScope();
    const winner = weightedPick(list, sc && sc.weight, state.lastKey, getKey);
    if (!winner) return;
    state.busy = true;
    root.classList.add("is-drawing");
    root.classList.remove("has-result");
    clear(info);
    info.appendChild(h("div.bm7-pick-rolling", { text: "正在翻找…" }));

    if (motionEnabled(root)) {
      const reel = shuffled(list.filter((x) => x !== winner), Math.min(9, Math.max(3, list.length - 1)));
      const delays = [55, 60, 66, 74, 86, 102, 124, 152, 190, 240];
      for (let i = 0; i < reel.length; i++) {
        setCardCover(front, reel[i]);
        front.classList.remove("is-flip");
        void front.offsetWidth;
        front.classList.add("is-flip");
        await wait(delays[Math.min(i, delays.length - 1)]);
      }
    }
    setCardCover(front, winner);
    front.classList.remove("is-flip");
    void front.offsetWidth;
    front.classList.add("is-land");
    root.classList.remove("is-drawing");
    root.classList.add("has-result");
    applyAmbient(root, cfg.getCover ? cfg.getCover(winner) : winner.cover, getTitle(winner));
    state.result = winner;
    state.lastKey = getKey(winner);
    state.busy = false;
    paintResult(winner);
    setTimeout(() => front.classList.remove("is-land"), 700);
  }

  function paintResult(item) {
    clear(info);
    const d = cfg.describe ? cfg.describe(item) : { headline: "", reason: "" };
    const acts = (cfg.actions ? cfg.actions(item) : []).filter((a) => a && !a.hidden);
    info.append(
      h("div.bm7-pick-result", [
        h("div.bm7-pick-kicker", { text: d.headline || "抽中了" }),
        h("h4.bm7-pick-title", { text: getTitle(item) }),
        d.reason ? h("p.bm7-pick-reason", { text: d.reason }) : null,
        d.chips && d.chips.length ? h("div.bm7-chips", d.chips.map((c) => h("span.bm7-chip", { text: c }))) : null,
        h("div.bm7-pick-actions", [
          ...acts.map((a) => button(a.label, { icon: a.icon, variant: a.variant || "", onClick: () => a.onClick(item) })),
          button("换一个", { icon: "refresh", variant: "ghost", onClick: draw })
        ])
      ])
    );
  }

  paintIdle();
  return {
    draw,
    setItems(items) {
      cfg.items = items;
      if (!state.busy) paintIdle();
    }
  };
}

module.exports = { renderRandomPicker, weightedPick };
