/**
 * v0.7 视觉层 · 游戏典藏
 * ---------------------------------------------------------------
 * 构成：
 *   1) 首屏：继续玩（焦点）| 随机玩一部 + 时长概览 | 游玩动态（侧栏）
 *   2) 全部游戏：搜索 · 状态 · 排序 · 分组（不分组 / 按开发商 / 我的分组）· 封面比例
 *      网格为「等高行」排版：同一行卡片高度一致，每张卡按自己的封面比例占宽 —
 *      默认全部 2:3 时就是整齐的标准网格；横版封面只会更宽，不会打乱行高。
 *   3) 单游戏详情与统计（视图内抽屉）：总时长、今日/本周/本月、次数、首次/最近、
 *      近 14 天 / 近 12 周分布、游玩记录、手动补录时长
 *   4) 多数据源词条搜索组件（聚合多源 / Bangumi / VNDB / Steam / 月幕 YMGal）
 *
 * 游戏字段（在现有 gameCollection 记录上扩展，全部可选）：
 *   coverAspect: "2:3" | "3:4" | "1:1" | "16:9" | "460:215" | "1.25"   // 缺省跟随全局默认
 *   coverFit:    "cover"（裁切铺满，默认）| "contain"（完整展示 + 同图柔光衬底）
 *   coverFocusY: 0–100                                                  // 裁切时的上下焦点，默认 30
 *   playSessions: [{ id, start: ISO, minutes, source: "auto"|"manual"|"timer", note }]
 * 设置字段：
 *   gameUi: { defaultAspect: "2:3", sort, groupMode, status }
 *   gameGroups: [{ id, name, gameIds: [] }]          // 组内顺序即数组顺序
 *
 * ctx = {
 *   games, appearance, themeRoot, settings: { gameUi, gameGroups },
 *   getCover(game),
 *   actions: {
 *     launch(game), canLaunch(game) -> bool,        // 桌面端 .exe / 模拟器 / steam://
 *     openJournal(game), openNote(game), editMeta(game), addGame(),
 *     saveGame(game) -> Promise, saveSettings(patch) -> Promise,
 *     addManualSession(game, { start, minutes, note }) -> Promise,
 *     removeSession(game, sessionId) -> Promise,
 *     timer?: { running(game) -> startTs|null, start(game), stop(game) -> Promise }
 *   },
 *   searchGames?(source, keyword) -> Promise<SourceResult[]>   // 见 renderGameSourceSearch
 * }
 */
const {
  h, clear, icon, coverEl, segmented, toggleRow, button, iconButton, panel, popover, closeAllPopovers, emptyState, applyAmbient,
  platformInfo, toDate, startOfDay, startOfWeek, startOfMonth, dayKey, formatMinutes, formatShortDate, formatRelative,
  formatDayLabel, formatClock, WEEKDAY_CN, DAY_MS, clamp
} = require("./v07-core.js");
const { applyTheme } = require("./v07-themes.js");
const { renderFeed, deriveGameEvents } = require("./v07-history.js");
const { renderRandomPicker } = require("./v07-random-pick.js");
const { menuItem } = require("./v07-lists.js");
const { paperSlipSwap, withPreservedScroll } = require("./v08-motion-and-lens.js");

const ASPECT_PRESETS = [
  { id: "2:3", label: "2:3", hint: "竖版盒封" },
  { id: "3:4", label: "3:4", hint: "竖版" },
  { id: "1:1", label: "1:1", hint: "方形" },
  { id: "16:9", label: "16:9", hint: "横版宣传图" },
  { id: "460:215", label: "Steam 横封", hint: "460×215" }
];
const STATUS_ORDER = ["在玩", "通关", "全成就", "想玩", "搁置"];
const SORTS = [
  { value: "recent", label: "最近游玩" },
  { value: "hours", label: "总时长" },
  { value: "score", label: "我的评分" },
  { value: "added", label: "收录时间" },
  { value: "title", label: "名称" }
];

function aspectValue(raw, fallback = 2 / 3) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw);
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[:/xX×]\s*(\d+(?:\.\d+)?)$/);
  if (m) return clamp(Number(m[1]) / Number(m[2]), 0.4, 2.6);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? clamp(n, 0.4, 2.6) : fallback;
}

function devGroupName(g) {
  const d = String(g.developer || "").split(/[\/、,，&]| x /)[0].trim();
  return d || "未填写开发商";
}

/* ============================== 时长统计 ============================== */

function sessionsOf(g) {
  return (Array.isArray(g.playSessions) ? g.playSessions : [])
    .map((s) => {
      let rawMin = 0;
      if (Number.isFinite(Number(s.durationSeconds)) && Number(s.durationSeconds) > 0) {
        rawMin = Math.max(1, Math.round(Number(s.durationSeconds) / 60));
      } else if (s.minutes !== undefined && s.minutes !== null && Number.isFinite(Number(s.minutes))) {
        rawMin = Number(s.minutes);
      } else {
        rawMin = Math.round((Number(s.durationHours) || 0) * 60);
      }
      return Object.assign({}, s, {
        _d: toDate(s.start || s.startedAt || s.endedAt || s.date),
        minutes: Math.max(0, rawMin || 0),
        source: s.source || s.mode || "auto"
      });
    })
    .filter((s) => s._d)
    .sort((a, b) => b._d - a._d);
}

function gameStats(g, now = new Date(), liveSession = null) {
  const ss = sessionsOf(g);
  const sum = ss.reduce((a, s) => a + s.minutes, 0);
  const legacyMin =
    g && g.legacyPlayMinutes !== undefined && g.legacyPlayMinutes !== null
      ? Math.max(0, Math.round(Number(g.legacyPlayMinutes) || 0))
      : Math.max(0, Math.round((Number(g.playHours) || 0) * 60) - sum);
  // 剔除旧版 0.02h 舍入产生的 1~2 分钟伪差值
  const untracked = legacyMin > 2 ? legacyMin : 0;
  const liveMinutes = liveSession
    ? Math.max(0, Math.round((Number(liveSession.elapsedSeconds) || 0) / 60))
    : 0;
  const baseTotal = sum + untracked;
  const total = baseTotal + liveMinutes;
  const t0 = startOfDay(now), w0 = startOfWeek(now), m0 = startOfMonth(now);
  let today = liveMinutes, week = liveMinutes, month = liveMinutes;
  for (const s of ss) {
    if (s._d >= t0) today += s.minutes;
    if (s._d >= w0) week += s.minutes;
    if (s._d >= m0) month += s.minutes;
  }
  const last = liveSession
    ? new Date()
    : ([ss[0] && ss[0]._d, toDate(g.lastPlayedAt)].filter(Boolean).sort((a, b) => b - a)[0] || null);
  const first = ss.length ? ss[ss.length - 1]._d : (liveSession ? new Date(liveSession.startedAtMs || Date.now()) : null);
  return {
    sessions: ss,
    total,
    logged: sum,
    untracked,
    today,
    week,
    month,
    count: ss.length,
    first,
    last,
    avg: ss.length ? sum / ss.length : 0,
    isLive: Boolean(liveSession),
    liveMinutes,
    liveSession
  };
}

function gameDisplayScore(g) {
  const v = g && (g.score ?? g.personalScore ?? g.publicScore);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sortGames(list, sort) {
  const a = list.slice();
  const lastTs = (g) => {
    const s = gameStats(g);
    return s.last ? s.last.getTime() : 0;
  };
  switch (sort) {
    case "hours": return a.sort((x, y) => gameStats(y).total - gameStats(x).total);
    case "score": return a.sort((x, y) => gameDisplayScore(y) - gameDisplayScore(x));
    case "added": return a.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
    case "title": return a.sort((x, y) => String(x.title).localeCompare(String(y.title), "zh-CN"));
    default: return a.sort((x, y) => lastTs(y) - lastTs(x));
  }
}

/* ============================== 封面卡片 ============================== */

function gameCover(game, ctx, defaultAspect) {
  const ar = aspectValue(game.coverAspect, aspectValue(defaultAspect));
  const fit = game.coverFit === "contain" ? "contain" : "cover";
  const url = ctx.getCover ? ctx.getCover(game) : game.coverUrl;
  const frame = h("div.bm7-gcover", { cls: `is-${fit}`, style: { "--ar": ar.toFixed(4), "--fy": `${clamp(Number(game.coverFocusY ?? 30), 0, 100)}%` } });
  if (url && fit === "contain") frame.appendChild(h("div.bm7-gcover-bg", { style: { backgroundImage: `url("${url}")` } }));
  frame.appendChild(coverEl(url, game.title, "bm7-gcover-img"));
  return { frame, ar };
}

function renderGameCard(game, ctx, opts) {
  const liveSes = ctx.playtimeTracker && typeof ctx.playtimeTracker.getLiveSession === "function"
    ? ctx.playtimeTracker.getLiveSession(game.id)
    : null;
  const st = gameStats(game, new Date(), liveSes);
  const { frame, ar } = gameCover(game, ctx, opts.defaultAspect);
  const canLaunch = Boolean(ctx.actions.canLaunch && ctx.actions.canLaunch(game));
  const card = h("article.bm7-gcard", {
    style: { "--ar": ar.toFixed(4) },
    dataset: { id: game.id },
    attr: { tabindex: "0" },
    on: {
      click: () => opts.onOpen(game),
      keydown: (e) => e.key === "Enter" && opts.onOpen(game)
    }
  });
  const status = game.status || "在玩";
  if (st.isLive) {
    frame.appendChild(
      h("span.bm7-gcard-status.is-live", [
        h("span.bm7-glive-dot"),
        h("span", { text: st.liveMinutes > 0 ? `游玩中 · ${formatMinutes(st.liveMinutes, true)}` : "游玩中" })
      ])
    );
  } else {
    frame.appendChild(h("span.bm7-gcard-status", { dataset: { st: status }, text: status }));
  }
  const overlay = h("div.bm7-gcard-overlay", [
    canLaunch ? button("启动", { icon: "play", variant: "primary", onClick: () => ctx.actions.launch(game) }) : null,
    button("详情", { icon: "clock", onClick: () => opts.onOpen(game) })
  ]);
  frame.appendChild(overlay);
  card.append(
    frame,
    h("div.bm7-gcard-body", [
      h("div.bm7-gcard-title", { text: game.title, title: game.title }),
      h("div.bm7-gcard-meta", [
        h("span", { text: st.total ? formatMinutes(st.total, true) : "未游玩" }),
        game.developer ? h("span.bm7-gcard-dev", { text: devGroupName(game) }) : null,
        gameDisplayScore(game) ? h("span.bm7-gcard-score", { text: `★${gameDisplayScore(game).toFixed(1)}` }) : null
      ])
    ]),
    iconButton("more", "更多操作", (e) => opts.onMenu(game, e.currentTarget), "bm7-gcard-more")
  );
  if (ctx.actions && typeof ctx.actions.bindRelationMenu === "function") {
    ctx.actions.bindRelationMenu(card, game);
  }
  if (opts.reorder) {
    card.classList.add("is-reorder");
    card.draggable = true;
    card.appendChild(h("span.bm7-gcard-grip", [icon("grip", 14)]));
    card.appendChild(
      h("div.bm7-gcard-order", [
        iconButton("chevronLeft", "往前移", () => opts.onMove(game, -1)),
        iconButton("chevronRight", "往后移", () => opts.onMove(game, 1))
      ])
    );
  }
  return card;
}

/* ============================== 封面比例编辑 ============================== */

function openCoverEditor(anchor, game, ctx, defaultAspect, onDone) {
  const draft = { coverAspect: game.coverAspect || "", coverFit: game.coverFit || "cover", coverFocusY: game.coverFocusY ?? 30 };
  popover(anchor, (box, close) => {
    const preview = h("div.bm7-ce-preview");
    const slider = h("input.bm7-range", { attr: { type: "range", min: "0.5", max: "2.2", step: "0.01", "aria-label": "自定义比例" } });
    const focus = h("input.bm7-range", { attr: { type: "range", min: "0", max: "100", step: "1", "aria-label": "上下焦点" } });
    const focusRow = h("label.bm7-ce-row", [h("span", { text: "裁切位置" }), focus, h("span.bm7-ce-val", { text: "" })]);
    const chips = h("div.bm7-ce-chips");
    const paint = () => {
      clear(preview);
      const tmp = Object.assign({}, game, draft);
      preview.appendChild(gameCover(tmp, ctx, defaultAspect).frame);
      const ar = aspectValue(draft.coverAspect, aspectValue(defaultAspect));
      slider.value = String(ar.toFixed(2));
      focus.value = String(draft.coverFocusY);
      focusRow.style.display = draft.coverFit === "cover" ? "" : "none";
      focusRow.querySelector(".bm7-ce-val").textContent = `${draft.coverFocusY}%`;
      clear(chips);
      const cur = draft.coverAspect || "";
      [{ id: "", label: `跟随默认（${defaultAspect}）` }].concat(ASPECT_PRESETS).forEach((p) => {
        chips.appendChild(
          h("button.bm7-ce-chip", {
            cls: cur === p.id ? "is-active" : "",
            attr: { type: "button", title: p.hint || "" },
            text: p.label,
            on: { click: () => { draft.coverAspect = p.id; paint(); } }
          })
        );
      });
      if (cur && !ASPECT_PRESETS.some((p) => p.id === cur)) chips.appendChild(h("span.bm7-ce-chip.is-active", { text: `自定义 ${Number(cur).toFixed(2)}` }));
    };
    slider.addEventListener("input", () => { draft.coverAspect = String(Number(slider.value).toFixed(2)); paint(); });
    focus.addEventListener("input", () => { draft.coverFocusY = Number(focus.value); paint(); });
    const fitSeg = segmented(
      [{ value: "cover", label: "裁切铺满" }, { value: "contain", label: "完整展示" }],
      draft.coverFit,
      (v) => { draft.coverFit = v; paint(); },
      "is-small"
    );
    box.append(
      h("div.bm7-pop-title", { text: `封面比例 ·《${game.title}》` }),
      h("div.bm7-ce", [
        preview,
        h("div.bm7-ce-controls", [
          chips,
          h("label.bm7-ce-row", [h("span", { text: "微调" }), slider]),
          h("div.bm7-ce-row", [h("span", { text: "填充方式" }), fitSeg]),
          focusRow,
          h("p.bm7-ce-hint", { text: "裁切铺满：以封面填满卡片；完整展示：保留整张封面，空白处用同一张图的柔光衬底。" })
        ])
      ]),
      h("div.bm7-ce-actions", [
        button("恢复默认", { icon: "reset", variant: "ghost", onClick: async () => {
          delete game.coverAspect; delete game.coverFit; delete game.coverFocusY;
          await ctx.actions.saveGame(game); close(); onDone();
        } }),
        h("span.bm7-grow"),
        button("完成", { variant: "primary", onClick: async () => {
          if (draft.coverAspect) game.coverAspect = draft.coverAspect; else delete game.coverAspect;
          game.coverFit = draft.coverFit;
          game.coverFocusY = draft.coverFocusY;
          await ctx.actions.saveGame(game); close(); onDone();
        } })
      ])
    );
    paint();
  }, { width: 420, alignRight: true, cls: "bm7-pop-cover" });
}

/* ============================== 详情与统计抽屉 ============================== */

function renderGameStatsPanel(container, game, ctx, onChange, closeDrawer) {
  clear(container);
  const liveSes = ctx.playtimeTracker && typeof ctx.playtimeTracker.getLiveSession === "function"
    ? ctx.playtimeTracker.getLiveSession(game.id)
    : null;
  const st = gameStats(game, new Date(), liveSes);
  const url = ctx.getCover ? ctx.getCover(game) : game.coverUrl;
  const state = { period: "week", chart: "days", showAllSessions: false };
  const root = h("div.bm7-gs");
  applyAmbient(root, url, game.title);

  // —— 头部 ——
  const head = h("header.bm7-gs-head", [
    h("div.bm7-gs-backdrop", url ? { style: { backgroundImage: `url("${url}")` } } : {}),
    h("div.bm7-gs-head-main", [
      h("div.bm7-gs-cover", [gameCover(game, ctx, "2:3").frame]),
      h("div.bm7-gs-titles", [
        h("div.bm7-kicker", [
          h("span", { text: game.status || "在玩" }),
          game.developer ? h("span.bm7-kicker-dim", { text: game.developer }) : null,
          st.isLive
            ? h("span.bm7-glive-pill", [
                h("span.bm7-glive-dot"),
                h("span", { text: st.liveMinutes > 0 ? `游玩中 · 已同步 ${formatMinutes(st.liveMinutes, true)}` : "游玩中" })
              ])
            : null
        ]),
        h("h2.bm7-gs-title", { text: game.title }),
        h("div.bm7-gs-total", [h("span.bm7-gs-total-label", { text: "总时长" }), h("span.bm7-gs-total-val", { text: formatMinutes(st.total) })]),
        h("div.bm7-gs-actions", [
          ctx.actions.canLaunch && ctx.actions.canLaunch(game) ? button("启动游戏", { icon: "play", variant: "primary", onClick: () => ctx.actions.launch(game) }) : null,
          timerButton(game, ctx, () => renderGameStatsPanel(container, game, ctx, onChange, closeDrawer)),
          button("手札", {
            icon: "pen",
            onClick: () => {
              if (typeof closeDrawer === "function") closeDrawer(true);
              if (ctx.actions.openJournal) ctx.actions.openJournal(game);
            }
          })
        ])
      ])
    ])
  ]);

  const liveBanner = st.isLive && liveSes
    ? h("div.bm7-gs-live-banner", [
        h("span.bm7-glive-dot"),
        h("span", {
          text: `正在游玩中 · 自 ${formatClock(new Date(liveSes.startedAtMs)) || "刚刚"} 起已同步 ${
            st.liveMinutes > 0 ? formatMinutes(st.liveMinutes, true) : "不足 1 分钟"
          }，退出游戏后将自动保存为正式记录。`
        })
      ])
    : null;

  // —— 概览 ——
  const periodVal = h("span.bm7-gs-period-val");
  const paintPeriod = () => { periodVal.textContent = formatMinutes(st[state.period]); };
  const overview = h("section.bm7-gs-overview", [
    h("div.bm7-gs-period", [
      segmented([{ value: "today", label: "今日" }, { value: "week", label: "本周" }, { value: "month", label: "本月" }], state.period, (v) => { state.period = v; paintPeriod(); }, "is-small"),
      periodVal
    ]),
    h("div.bm7-gs-tiles", [
      tile("游玩次数", st.count ? `${st.count} 次` : "—"),
      tile("平均每次", st.count ? formatMinutes(st.avg, true) : "—"),
      tile("首次游玩", st.first ? formatShortDate(st.first) : "—"),
      tile("最近游玩", st.isLive ? "正在游玩" : (st.last ? formatShortDate(st.last) : "—"), st.isLive ? "时长实时同步中" : (st.last ? formatRelative(st.last) : ""))
    ])
  ]);
  paintPeriod();

  // —— 分布图 ——
  const chartBox = h("div.bm7-gs-chart");
  const paintChart = () => {
    clear(chartBox);
    const now = new Date();
    const buckets = [];
    if (state.chart === "days") {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(startOfDay(now).getTime() - i * DAY_MS);
        buckets.push({ key: dayKey(d), label: i === 0 ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`, sub: WEEKDAY_CN[d.getDay()], v: 0, from: d, to: new Date(d.getTime() + DAY_MS) });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(startOfWeek(now).getTime() - i * 7 * DAY_MS);
        buckets.push({ label: i === 0 ? "本周" : `${d.getMonth() + 1}/${d.getDate()}`, sub: "", v: 0, from: d, to: new Date(d.getTime() + 7 * DAY_MS) });
      }
    }
    for (const s of st.sessions) for (const b of buckets) if (s._d >= b.from && s._d < b.to) b.v += s.minutes;
    if (st.liveMinutes > 0 && buckets.length > 0) buckets[buckets.length - 1].v += st.liveMinutes;
    const max = Math.max(30, ...buckets.map((b) => b.v));
    const bars = h("div.bm7-gs-bars", { style: { "--n": String(buckets.length) } });
    buckets.forEach((b, i) => {
      bars.appendChild(
        h("div.bm7-gs-bar", { title: `${b.label} · ${b.v ? formatMinutes(b.v) : "没有游玩"}`, cls: i === buckets.length - 1 ? "is-now" : "" }, [
          h("span.bm7-gs-bar-val", { text: b.v ? formatMinutes(b.v, true) : "" }),
          h("span.bm7-gs-bar-fill", { style: { height: `${b.v ? Math.max(4, (b.v / max) * 100) : 0}%` } }),
          h("span.bm7-gs-bar-label", { text: b.label })
        ])
      );
    });
    chartBox.appendChild(bars);
  };
  const chartSec = h("section.bm7-gs-sec", [
    h("div.bm7-gs-sec-head", [
      h("h4", { text: "时长分布" }),
      segmented([{ value: "days", label: "近 14 天" }, { value: "weeks", label: "近 12 周" }], state.chart, (v) => { state.chart = v; paintChart(); }, "is-small")
    ]),
    chartBox
  ]);
  paintChart();

  // —— 记录与补录 ——
  const listSec = h("section.bm7-gs-sec", [h("div.bm7-gs-sec-head", [h("h4", { text: "游玩记录" }), h("span.bm7-gs-sec-sub", { text: st.untracked > 2 ? `另有 ${formatMinutes(st.untracked, true)} 来自早期累计，没有逐次明细` : "" })])]);
  const list = h("ol.bm7-gs-sessions");
  const moreHost = h("div");
  const paintSessionList = () => {
    clear(list);
    clear(moreHost);
    if (!st.sessions.length) {
      list.appendChild(emptyState("还没有逐次记录。启动游戏会自动记时；在别处玩的，可以在下面补录。"));
      return;
    }
    const visible = state.showAllSessions ? st.sessions : st.sessions.slice(0, 10);
    visible.forEach((s) => {
      const srcLabel =
        s.source === "manual"
          ? "手动补录"
          : s.source === "timer"
            ? "手动计时"
            : s.source === "watcher" || s.source === "watcher_recovered"
              ? "离线记录"
              : "自动记录";
      let delControl = h("span");
      if (ctx.actions.removeSession && s.id) {
        let armed = false;
        let armTid = null;
        delControl = iconButton("close", "删除这条游玩记录", async () => {
          if (!armed) {
            armed = true;
            delControl.classList.add("is-armed");
            delControl.textContent = "确认删除";
            armTid = setTimeout(() => {
              armed = false;
              if (delControl.isConnected) {
                delControl.classList.remove("is-armed");
                clear(delControl);
                delControl.appendChild(icon("close", 15));
              }
            }, 3200);
            return;
          }
          if (armTid) clearTimeout(armTid);
          await ctx.actions.removeSession(game, s.id);
          renderGameStatsPanel(container, game, ctx, onChange, closeDrawer);
          onChange && onChange();
        }, "bm7-gs-session-del");
      }
      list.appendChild(
        h("li.bm7-gs-session", [
          h("span.bm7-gs-session-date", [h("strong", { text: formatDayLabel(s._d) }), formatClock(s._d) ? h("span", { text: formatClock(s._d) }) : null]),
          h("span.bm7-gs-session-len", { text: formatMinutes(s.minutes, true) }),
          h("span.bm7-gs-session-src", { dataset: { src: s.source || "auto" }, text: srcLabel }),
          s.note ? h("span.bm7-gs-session-note", { text: s.note, title: s.note }) : h("span"),
          delControl
        ])
      );
    });
    if (st.sessions.length > 10) {
      moreHost.appendChild(
        button(state.showAllSessions ? "收起记录" : `查看全部 ${st.sessions.length} 条记录`, {
          variant: "ghost",
          cls: "bm7-gs-more-btn",
          onClick: () => {
            state.showAllSessions = !state.showAllSessions;
            paintSessionList();
          }
        })
      );
    }
  };
  paintSessionList();
  listSec.append(list, moreHost);

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const dateIn = h("input.bm7-input", { attr: { type: "date", value: todayStr, max: todayStr, "aria-label": "日期" } });
  const hIn = h("input.bm7-input.bm7-input-num", { attr: { type: "number", min: "0", max: "99", step: "1", placeholder: "0", inputmode: "numeric", "aria-label": "小时" } });
  const mIn = h("input.bm7-input.bm7-input-num", { attr: { type: "number", min: "0", max: "59", step: "5", placeholder: "0", inputmode: "numeric", "aria-label": "分钟" } });
  const noteIn = h("input.bm7-input", { attr: { type: "text", placeholder: "备注（可选），如：Switch 上玩的 / 通关前的存档", "aria-label": "备注" } });
  const msg = h("span.bm7-gs-form-msg");
  const addSec = h("section.bm7-gs-sec.bm7-gs-add", [
    h("div.bm7-gs-sec-head", [h("h4", { text: "手动补录时长" }), h("span.bm7-gs-sec-sub", { text: "以前玩过、或在主机和手机上玩的" })]),
    h("div.bm7-gs-form", [
      h("label.bm7-gs-field", [h("span", { text: "日期" }), dateIn]),
      h("label.bm7-gs-field.is-num", [h("span", { text: "小时" }), hIn]),
      h("label.bm7-gs-field.is-num", [h("span", { text: "分钟" }), mIn]),
      h("label.bm7-gs-field.is-wide", [h("span", { text: "备注" }), noteIn]),
      button("补录", {
        icon: "plus",
        variant: "primary",
        onClick: async () => {
          const minutes = (Number(hIn.value) || 0) * 60 + (Number(mIn.value) || 0);
          if (minutes <= 0) { msg.textContent = "请填写时长"; return; }
          const d = toDate(dateIn.value) || new Date();
          d.setHours(20, 0, 0, 0);
          await ctx.actions.addManualSession(game, { start: d.toISOString(), minutes, note: noteIn.value.trim() });
          renderGameStatsPanel(container, game, ctx, onChange, closeDrawer);
          onChange && onChange();
        }
      })
    ]),
    msg
  ]);

  root.append(...[head, liveBanner, overview, chartSec, listSec, addSec].filter(Boolean));
  container.appendChild(root);
}

function tile(label, value, hint) {
  return h("div.bm7-stat", [h("span.bm7-stat-label", { text: label }), h("span.bm7-stat-value", { text: value }), hint ? h("span.bm7-stat-hint", { text: hint }) : null]);
}

function timerButton(game, ctx, rerender) {
  const t = ctx.actions.timer;
  if (!t) return null;
  const startTs = t.running(game);
  if (startTs) {
    return button(`计时中 · 结束并记入（${formatMinutes((Date.now() - startTs) / 60000, true)}）`, { icon: "timer", cls: "is-timing", onClick: async () => { await t.stop(game); rerender(); } });
  }
  return button("开始计时", { icon: "timer", title: "在主机、手机或 Steam 上玩时，用它记录时长", onClick: () => { t.start(game); rerender(); } });
}

/** 视图内抽屉：宽屏右侧滑出，窄屏为底部整页 */
function openGameStatsPanel(game, ctx, hostRoot, onChange) {
  const host = document.body;
  host.querySelectorAll(":scope > .bm7-drawer").forEach((x) => {
    if (typeof x._bm7Close === "function") x._bm7Close(true);
    else x.remove();
  });
  const themeAttr = (hostRoot && hostRoot.getAttribute && hostRoot.getAttribute("data-bm7-theme")) || (ctx.appearance && ctx.appearance.theme) || "follow";
  const motionAttr = (hostRoot && hostRoot.getAttribute && hostRoot.getAttribute("data-bm7-motion")) || (ctx.appearance && ctx.appearance.motion === false ? "off" : "on");
  const drawer = h("div.bm7-root.bm7-drawer", {
    attr: {
      role: "dialog",
      "aria-label": `${game.title} 详情与统计`,
      "data-bm7-theme": themeAttr,
      "data-bm7-motion": motionAttr
    }
  });
  const sheet = h("div.bm7-drawer-sheet");
  const close = (immediate = false) => {
    document.removeEventListener("keydown", onKey, true);
    if (immediate) {
      drawer.remove();
      return;
    }
    drawer.classList.add("is-leaving");
    setTimeout(() => drawer.remove(), 200);
  };
  drawer._bm7Close = close;
  const onKey = (e) => e.key === "Escape" && close();
  drawer.append(h("div.bm7-drawer-scrim", { on: { click: () => close(false) } }), sheet);
  sheet.appendChild(iconButton("close", "关闭", () => close(false), "bm7-drawer-close"));
  const body = h("div.bm7-drawer-body");
  sheet.appendChild(body);
  renderGameStatsPanel(body, game, ctx, onChange, close);
  host.appendChild(drawer);
  document.addEventListener("keydown", onKey, true);
  return { close };
}

/* ============================== 多数据源词条搜索 ============================== */

const SOURCES = [
  { value: "all", label: "聚合多源" },
  { value: "bangumi", label: "Bangumi" },
  { value: "vndb", label: "VNDB" },
  { value: "steam", label: "Steam" },
  { value: "ymgal", label: "月幕 YMGal" }
];
const SOURCE_NAME = { bangumi: "Bangumi", vndb: "VNDB", steam: "Steam", ymgal: "月幕" };

/**
 * opts = { initialQuery, source, search(source, q) -> Promise<[{ source, status: "ok"|"timeout"|"error"|"empty", items: Cand[] }]>,
 *          onPickFull(cand), onPickCover(cand), foldOnPick?: boolean }
 * Cand = { source, id, title, subtitle, cover, developer, year, score, url }
 */
function renderGameSourceSearch(host, opts) {
  clear(host);
  const state = {
    source: opts.source || "all",
    q: opts.initialQuery || "",
    seq: 0,
    allItems: [],
    pickedIndex: -1,
    pickedKind: "",
    pickSeq: 0,
    folded: false
  };
  const input = h("input.bm7-input.bm7-gsrc-input", { attr: { type: "search", placeholder: "输入游戏名称，例如：千恋＊万花", "aria-label": "搜索游戏词条" } });
  input.value = state.q;
  const statusLine = h("div.bm7-gsrc-status");
  const results = h("div.bm7-gsrc-results");
  const foldControlHost = h("div.bm7-gsrc-fold-host");

  const paintResults = () => {
    clear(results);
    clear(foldControlHost);
    const all = state.allItems || [];
    if (!all.length) {
      results.classList.remove("is-folded");
      results.appendChild(emptyState("没有找到匹配的词条，换个写法或切换数据源试试。"));
      return;
    }

    const canFold = opts.foldOnPick !== false && state.pickedIndex >= 0 && all.length > 1;
    const isFolded = canFold && state.folded;
    results.classList.toggle("is-folded", isFolded);

    if (canFold && !isFolded) {
      const pickedItem = all[state.pickedIndex];
      results.appendChild(
        h("div.bm7-gsrc-collapse-bar", [
          h("span", { text: `当前已套用《${pickedItem.title}》 · 共 ${all.length} 条候选` }),
          button("收起其余候选 ▴", {
            variant: "ghost",
            onClick: () => {
              state.folded = true;
              paintResults();
            }
          })
        ])
      );
    }

    all.forEach((c, idx) => {
      const isPicked = idx === state.pickedIndex;
      const pickedLabel = state.pickedKind === "cover" ? "已用封面" : "已套用";
      results.appendChild(
        h("article.bm7-gsrc-card", { cls: isPicked ? "is-picked" : "" }, [
          h("div.bm7-gsrc-cover", [coverEl(c.cover, c.title)]),
          h("div.bm7-gsrc-info", [
            h("div.bm7-gsrc-title", { text: c.title, title: c.title }),
            c.subtitle ? h("div.bm7-gsrc-sub", { text: c.subtitle }) : null,
            h("div.bm7-gsrc-meta", [
              h("span.bm7-gsrc-src", { dataset: { src: c.source }, text: SOURCE_NAME[c.source] || c.source }),
              c.developer ? h("span", { text: c.developer }) : null,
              c.year ? h("span", { text: String(c.year) }) : null,
              c.score ? h("span", { text: `★${Number(c.score).toFixed(1)}` }) : null,
              isPicked ? h("span.bm7-gsrc-picked-tag", { text: `✓ ${pickedLabel}` }) : null
            ]),
            h("div.bm7-gsrc-actions", [
              button(isPicked && state.pickedKind === "full" ? "已套用词条" : "套用词条", {
                variant: "primary",
                onClick: async () => {
                  const myPickSeq = ++state.pickSeq;
                  state.pickedIndex = idx;
                  state.pickedKind = "full";
                  state.folded = all.length > 1 && opts.foldOnPick !== false;
                  paintResults();
                  if (opts.onPickFull) await opts.onPickFull(c, myPickSeq);
                }
              }),
              button(isPicked && state.pickedKind === "cover" ? "已选用封面" : "只用封面", {
                onClick: async () => {
                  const myPickSeq = ++state.pickSeq;
                  state.pickedIndex = idx;
                  state.pickedKind = "cover";
                  state.folded = all.length > 1 && opts.foldOnPick !== false;
                  paintResults();
                  if (opts.onPickCover) await opts.onPickCover(c, myPickSeq);
                }
              })
            ])
          ])
        ])
      );
    });

    if (isFolded) {
      const restCount = all.length - 1;
      const handleBtn = h(
        "button.bm7-gsrc-stack-handle",
        {
          attr: { type: "button" },
          on: {
            click: () => {
              state.folded = false;
              paintResults();
            }
          }
        },
        [
          h("span", { text: `其余 ${restCount} 条候选已收纳` }),
          h("span.bm7-gsrc-stack-handle-action", { text: "展开重选 ▾" })
        ]
      );
      foldControlHost.appendChild(handleBtn);
    }
  };

  const run = async () => {
    const q = input.value.trim();
    if (!q) return;
    const seq = ++state.seq;
    state.allItems = [];
    state.pickedIndex = -1;
    state.pickedKind = "";
    state.folded = false;
    clear(results);
    clear(foldControlHost);
    clear(statusLine);
    const targets = state.source === "all" ? ["bangumi", "vndb", "steam", "ymgal"] : [state.source];
    targets.forEach((s) => statusLine.appendChild(h("span.bm7-gsrc-pill.is-loading", { dataset: { src: s }, text: `${SOURCE_NAME[s]} 搜索中` })));
    let res = [];
    try { res = (await opts.search(state.source, q)) || []; } catch (_) { res = []; }
    if (seq !== state.seq) return;
    clear(statusLine);
    const all = [];
    for (const r of res) {
      const n = (r.items || []).length;
      const text = r.status === "timeout" ? `${SOURCE_NAME[r.source]} 超时` : r.status === "error" ? `${SOURCE_NAME[r.source]} 暂不可用` : `${SOURCE_NAME[r.source]} ${n} 条`;
      statusLine.appendChild(h("span.bm7-gsrc-pill", { cls: `is-${r.status || "ok"}`, dataset: { src: r.source }, text }));
      all.push(...(r.items || []));
    }
    // 同名置顶
    const norm = (s) => String(s || "").toLowerCase().replace(/[\s~～\-—:：!！*＊・·]/g, "");
    const nq = norm(q);
    all.sort((a, b) => (norm(b.title) === nq) - (norm(a.title) === nq));
    state.allItems = all;
    paintResults();
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && run());
  host.appendChild(
    h("div.bm7-gsrc", [
      h("div.bm7-gsrc-bar", [input, button("搜索", { icon: "eye", variant: "primary", onClick: run })]),
      segmented(SOURCES, state.source, (v) => { state.source = v; if (input.value.trim()) run(); }, "is-small is-scroll"),
      statusLine,
      results,
      foldControlHost
    ])
  );
  if (state.q) run();
  return { run };
}

/* ============================== 首屏 + 全部游戏 ============================== */

function renderGameStage(host, ctx) {
  clear(host);
  const { desktop } = platformInfo();
  const games = Array.isArray(ctx.games) ? ctx.games : [];
  const themeRoot = ctx.themeRoot || host.closest(".curator-desk-root") || host;
  applyTheme(themeRoot, ctx.appearance);
  const settings = ctx.settings || {};
  const ui = Object.assign({ defaultAspect: "2:3", sort: "recent", groupMode: "none", status: "all" }, settings.gameUi || {});
  let groups = Array.isArray(settings.gameGroups) ? settings.gameGroups.map((g) => Object.assign({}, g, { gameIds: (g.gameIds || []).slice() })) : [];
  const local = { q: String(ctx.initialSearchQuery || ""), reorderGroup: null };
  const saveUi = (patch) => { Object.assign(ui, patch); ctx.actions.saveSettings && ctx.actions.saveSettings({ gameUi: Object.assign({}, ui) }); };
  const saveGroups = () => ctx.actions.saveSettings && ctx.actions.saveSettings({ gameGroups: groups.map((g) => Object.assign({}, g)) });
  const openStats = (g) => openGameStatsPanel(g, ctx, themeRoot, () => repaintAll());

  const stage = h("div.bm7-stage.bm7-game-stage");
  host.appendChild(stage);

  const repaintAll = () =>
    withPreservedScroll(host, () =>
      renderGameStage(host, Object.assign({}, ctx, { settings: Object.assign({}, settings, { gameUi: ui, gameGroups: groups }) }))
    );

  /* —— 首屏 —— */
  const liveMap =
    ctx.playtimeTracker && typeof ctx.playtimeTracker.getAllLiveSessions === "function"
      ? ctx.playtimeTracker.getAllLiveSessions()
      : new Map();
  const getLive = (g) => (g && liveMap && liveMap.get(g.id)) || null;

  const top = h("div.bm7-stage-grid.bm7-game-grid");
  stage.appendChild(top);
  const byRecent = sortGames(games, "recent");
  const liveFirst = games.find((g) => g && liveMap.has(g.id)) || null;
  const current = liveFirst || byRecent.find((g) => gameStats(g).last) || byRecent[0];

  const heroArea = h("section.bm7-area-hero");
  top.appendChild(heroArea);
  if (!current) {
    heroArea.appendChild(h("div.bm7-hero.is-empty", [h("div.bm7-hero-empty", [
      h("div.bm7-kicker", { text: "继续玩" }),
      h("h2.bm7-hero-title", { text: "游戏典藏还是空的" }),
      h("p.bm7-hero-sub", { text: "收录游戏后，这里会显示最近在玩的作品、游玩时长与启动按钮。" }),
      button("添加游戏", { icon: "plus", variant: "primary", onClick: () => ctx.actions.addGame && ctx.actions.addGame() })
    ])]));
  } else {
    const curLive = getLive(current);
    const st = gameStats(current, new Date(), curLive);
    const url = ctx.getCover ? ctx.getCover(current) : current.coverUrl;
    const hero = h("div.bm7-hero.bm7-ghero");
    applyAmbient(hero, url, current.title);
    hero.append(h("div.bm7-hero-backdrop", url ? { style: { backgroundImage: `url("${url}")` } } : {}), h("div.bm7-hero-shade"));
    const plate = h("div.bm7-hero-plate.bm7-ghero-plate", [gameCover(current, ctx, ui.defaultAspect).frame]);
    plate.style.setProperty("--ar", String(aspectValue(current.coverAspect, aspectValue(ui.defaultAspect))));
    plate.addEventListener("click", () => openStats(current));
    const canLaunch = Boolean(ctx.actions.canLaunch && ctx.actions.canLaunch(current));
    hero.appendChild(
      h("div.bm7-hero-main", [
        plate,
        h("div.bm7-hero-info", [
          h("div.bm7-kicker", [
            h("span", { text: st.isLive ? "正在游玩" : "继续玩" }),
            current.developer ? h("span.bm7-kicker-dim", { text: current.developer }) : null,
            st.isLive
              ? h("span.bm7-glive-pill", [
                  h("span.bm7-glive-dot"),
                  h("span", { text: st.liveMinutes > 0 ? `已同步 ${formatMinutes(st.liveMinutes, true)}` : "已检测到运行中" })
                ])
              : null
          ]),
          h("h2.bm7-hero-title", { text: current.title }),
          current.currentProgress ? h("p.bm7-hero-sub", { text: `进度：${current.currentProgress}` }) : null,
          h("div.bm7-ghero-figs", [
            fig("总时长", formatMinutes(st.total, true)),
            fig("本周", formatMinutes(st.week, true)),
            fig("上次游玩", st.isLive ? "进行中" : (st.last ? formatRelative(st.last) : "—")),
            fig("游玩次数", st.count ? `${st.count} 次` : "—")
          ]),
          h("div.bm7-hero-actions", [
            canLaunch ? button(desktop && current.launchMode === "emulator" ? "用模拟器启动" : "启动游戏", { icon: "play", variant: "primary", onClick: () => ctx.actions.launch(current) }) : null,
            timerButton(current, ctx, repaintAll),
            button("详情与统计", { icon: "clock", variant: canLaunch ? "" : "primary", onClick: () => openStats(current) }),
            iconButton("pen", "手札", () => ctx.actions.openJournal && ctx.actions.openJournal(current))
          ])
        ])
      ])
    );
    const others = byRecent.filter((g) => g !== current).slice(0, 6);
    if (others.length) {
      hero.appendChild(
        h("nav.bm7-hero-rail", { attr: { "aria-label": "最近玩过" } }, others.map((g) =>
          h("button.bm7-rail-item", { attr: { type: "button", title: g.title }, on: { click: () => openStats(g) } }, [coverEl(ctx.getCover ? ctx.getCover(g) : g.coverUrl, g.title)])
        ))
      );
    }
    heroArea.appendChild(hero);
  }

  // 随机玩一部
  const pickPanel = panel("bm7-area-pick", { title: "随机玩一部", sub: "游戏荒的时候试试" });
  top.appendChild(pickPanel);
  const daysSince = (g) => { const s = gameStats(g); return s.last ? (Date.now() - s.last.getTime()) / DAY_MS : 9999; };
  renderRandomPicker(pickPanel._body, {
    kind: "game",
    items: games,
    getCover: (g) => (ctx.getCover ? ctx.getCover(g) : g.coverUrl),
    getKey: (g) => g.id,
    getTitle: (g) => g.title,
    scopes: [
      { id: "backlog", label: "想玩和搁置", hint: "还没开始或玩到一半放下的", filter: (l) => l.filter((g) => g.status === "想玩" || g.status === "搁置") },
      { id: "playing", label: "在玩", hint: "正在推进的", filter: (l) => l.filter((g) => (g.status || "在玩") === "在玩") },
      { id: "dusty", label: "好久没玩", hint: "超过 30 天没碰过", filter: (l) => l.filter((g) => daysSince(g) > 30 && g.status !== "通关" && g.status !== "全成就"), weight: (g) => Math.min(6, daysSince(g) / 30) },
      { id: "all", label: "全部", hint: "全部收录", filter: (l) => l }
    ],
    describe: (g) => {
      const s = gameStats(g);
      return {
        headline: g.status === "想玩" ? "就从这部开始" : "就玩这部",
        reason: [s.total ? `已玩 ${formatMinutes(s.total, true)}` : "还没有开始玩", s.last ? `上次是 ${formatRelative(s.last)}` : "", g.currentProgress ? `进度：${g.currentProgress}` : ""].filter(Boolean).join(" · "),
        chips: [g.status || "在玩", g.developer].filter(Boolean)
      };
    },
    actions: (g) => [
      { label: "启动", icon: "play", variant: "primary", hidden: !(ctx.actions.canLaunch && ctx.actions.canLaunch(g)), onClick: () => ctx.actions.launch(g) },
      { label: "详情", icon: "clock", onClick: () => openStats(g) }
    ],
    emptyText: "这个范围里没有游戏，换个范围试试。"
  });

  // 时长概览
  const sumPanel = panel("bm7-area-rhythm", { title: "时长概览" });
  top.appendChild(sumPanel);
  const tot = games.reduce((acc, g) => { const s = gameStats(g, new Date(), getLive(g)); acc.total += s.total; acc.today += s.today; acc.week += s.week; acc.month += s.month; return acc; }, { total: 0, today: 0, week: 0, month: 0 });
  const per = { mode: "week" };
  const perVal = h("span.bm7-stat-value");
  const perPaint = () => { perVal.textContent = formatMinutes(per.mode === "week" ? tot.week : tot.month, true); };
  perPaint();
  sumPanel._body.appendChild(
    h("div.bm7-gsum", [
      tile("收录游戏", `${games.length} 部`, `${games.filter((g) => (g.status || "在玩") === "在玩").length} 部在玩`),
      tile("总时长", formatMinutes(tot.total, true)),
      tile("今日", formatMinutes(tot.today, true)),
      h("div.bm7-stat", [
        h("span.bm7-stat-label", [segmented([{ value: "week", label: "本周" }, { value: "month", label: "本月" }], per.mode, (v) => { per.mode = v; perPaint(); }, "is-small is-mini")]),
        perVal
      ])
    ])
  );
  sumPanel._body.appendChild(weekStrip(games, liveMap));

  // 侧栏：游玩动态
  const side = h("aside.bm7-area-side");
  top.appendChild(side);
  const feedPanel = panel("bm7-panel-feed", { title: "游玩动态" });
  side.appendChild(feedPanel);
  const feedScroll = h("div.bm7-feed-scroll");
  feedPanel._body.appendChild(feedScroll);
  renderFeed(feedScroll, typeof ctx.getEvents === "function" ? ctx.getEvents() : deriveGameEvents(games, ctx.getCover), {
    kind: "game",
    limit: 40,
    onOpen: (ev) => { const g = games.find((x) => x.id === ev.key); if (g) openStats(g); }
  });

  /* —— 全部游戏 —— */
  const lib = h("section.bm7-glib");
  stage.appendChild(lib);
  const toolbar = h("div.bm7-glib-toolbar");
  const gridHost = h("div.bm7-glib-body");
  const counts = STATUS_ORDER.reduce((m, s) => { m[s] = games.filter((g) => (g.status || "在玩") === s).length; return m; }, {});
  const search = h("input.bm7-input.bm7-glib-search", { attr: { type: "search", placeholder: "搜索名称、开发商、进度", "aria-label": "搜索游戏" } });
  search.value = local.q;
  search.addEventListener("input", () => { local.q = search.value; paintGrid(); });
  const sortSel = h("select.bm7-input.bm7-select", { attr: { "aria-label": "排序" } }, SORTS.map((s) => h("option", { attr: { value: s.value }, text: `按${s.label}` })));
  sortSel.value = ui.sort;
  sortSel.addEventListener("change", () => { saveUi({ sort: sortSel.value }); paintGrid({ animate: true }); });

  const hasCapsule = Boolean(desktop && ctx.capsule && ctx.capsule.supported);
  const capState = hasCapsule ? ctx.capsule.getSettings() : null;
  const hasTracker = Boolean(desktop && ctx.playtimeTracker && ctx.playtimeTracker.desktop);
  const trackerStatus = hasTracker ? ctx.playtimeTracker.getStatus() : null;
  lib.append(
    h("header.bm7-glib-head", [
      h("div.bm7-lists-titles", [h("h3.bm7-section-title", { text: "全部游戏" }), h("span.bm7-section-sub", { text: `共 ${games.length} 部 · 卡片比例默认 ${ui.defaultAspect}` })]),
      h("div.bm7-lists-bar", [
        hasTracker
          ? button(trackerStatus && trackerStatus.running ? "离线记录 · 运行中" : "离线记录", {
              icon: "clock",
              cls: trackerStatus && trackerStatus.running ? "is-tracker-on" : "",
              title: "配置脱离 Obsidian 的轻量后台游玩时长记录、开机自启与手动同步",
              onClick: (e) => openPlaytimeTrackerPopover(e.currentTarget)
            })
          : null,
        hasCapsule
          ? button(capState && capState.enabled ? "侧边手札 · 已开启" : "侧边手札", {
              icon: "bookmark",
              title: "配置游戏运行时的屏幕侧边半透明胶囊与全屏手札浮窗",
              onClick: (e) => openCapsuleQuickSettings(e.currentTarget)
            })
          : null,
        button("封面比例", { icon: "crop", onClick: (e) => openGlobalAspect(e.currentTarget) }),
        button("添加游戏", { icon: "plus", variant: "primary", onClick: () => ctx.actions.addGame && ctx.actions.addGame() })
      ])
    ]),
    toolbar,
    gridHost
  );
  const grpOpts = [{ value: "none", label: "不分组" }, { value: "developer", label: "按开发商" }, { value: "custom", label: "我的分组" }];
  const statusSegOpts = [{ value: "all", label: "全部", count: games.length }].concat(STATUS_ORDER.map((s) => ({ value: s, label: s, count: counts[s] })));
  toolbar.append(
    h("div.bm7-glib-row", [
      search,
      sortSel,
      segmented(grpOpts, ui.groupMode, (v) => {
        const i0 = grpOpts.findIndex((o) => o.value === ui.groupMode);
        const i1 = grpOpts.findIndex((o) => o.value === v);
        saveUi({ groupMode: v });
        local.reorderGroup = null;
        paintGrid({ animate: true, dir: i1 >= i0 ? 1 : -1 });
      }, "is-small")
    ]),
    segmented(
      statusSegOpts,
      ui.status,
      (v) => {
        const i0 = statusSegOpts.findIndex((o) => o.value === ui.status);
        const i1 = statusSegOpts.findIndex((o) => o.value === v);
        saveUi({ status: v });
        paintGrid({ animate: true, dir: i1 >= i0 ? 1 : -1 });
      },
      "is-small is-scroll"
    )
  );

  const filtered = () => {
    const q = local.q.trim().toLowerCase();
    return sortGames(games, ui.sort).filter((g) => {
      if (ui.status !== "all" && (g.status || "在玩") !== ui.status) return false;
      if (!q) return true;
      return [g.title, g.developer, g.currentProgress].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  };

  const cardOpts = (extra = {}) => Object.assign({ defaultAspect: ui.defaultAspect, onOpen: openStats, onMenu: openCardMenu }, extra);
  const justified = (list, extra) => {
    const row = h("div.bm7-gjust");
    list.forEach((g) => row.appendChild(renderGameCard(g, ctx, cardOpts(extra ? extra(g) : {}))));
    row.appendChild(h("span.bm7-gjust-filler"));
    return row;
  };

  function paintGrid(opts) {
    const runPaint = () => {
      clear(gridHost);
      const list = filtered();
      if (!list.length) {
        gridHost.appendChild(emptyState(games.length ? "没有符合条件的游戏。" : "还没有收录游戏。", games.length ? null : button("添加游戏", { icon: "plus", variant: "primary", onClick: () => ctx.actions.addGame && ctx.actions.addGame() })));
        return;
      }
      if (ui.groupMode === "none") {
        gridHost.appendChild(justified(list));
        return;
      }
      if (ui.groupMode === "developer") {
        const map = new Map();
        list.forEach((g) => { const k = devGroupName(g); if (!map.has(k)) map.set(k, []); map.get(k).push(g); });
        const keys = Array.from(map.keys()).sort((a, b) => (a === "未填写开发商") - (b === "未填写开发商") || map.get(b).length - map.get(a).length || a.localeCompare(b, "zh-CN"));
        keys.forEach((k) => gridHost.appendChild(groupSection(k, map.get(k), { auto: true })));
        return;
      }
      // 我的分组
      const inList = new Set(list.map((g) => g.id));
      const used = new Set();
      groups.forEach((gr) => {
        const members = gr.gameIds.map((id) => games.find((g) => g.id === id)).filter((g) => g && inList.has(g.id));
        members.forEach((g) => used.add(g.id));
        gridHost.appendChild(groupSection(gr.name, members, { group: gr }));
      });
      const rest = list.filter((g) => !used.has(g.id));
      if (rest.length) gridHost.appendChild(groupSection("未分组", rest, { auto: true, muted: true }));
      gridHost.appendChild(
        h("button.bm7-gnewgroup", { attr: { type: "button" }, on: { click: () => newGroup() } }, [icon("plus", 15), h("span", { text: "新建分组" })])
      );
    };
    if (opts && opts.animate && gridHost.childElementCount > 0) {
      paperSlipSwap(gridHost, runPaint, { dir: opts.dir === -1 ? -1 : 1, small: true, frameless: true });
    } else {
      withPreservedScroll(gridHost, runPaint);
    }
  }

  function groupSection(name, members, o) {
    const sec = h("section.bm7-ggroup", { cls: o.muted ? "is-muted" : "" });
    const gr = o.group;
    const reorder = gr && local.reorderGroup === gr.id;
    sec.appendChild(
      h("header.bm7-ggroup-head", [
        h("h4.bm7-ggroup-title", { text: name }),
        h("span.bm7-ggroup-count", { text: `${members.length}` }),
        h("span.bm7-grow"),
        gr ? button(reorder ? "完成排序" : "调整顺序", { icon: reorder ? "check" : "grip", variant: reorder ? "primary" : "ghost", onClick: () => { local.reorderGroup = reorder ? null : gr.id; paintGrid(); } }) : null,
        gr ? iconButton("more", "分组操作", (e) => popover(e.currentTarget, (box, close) => box.append(
          menuItem("pen", "重命名", () => { close(); renameGroup(gr); }),
          menuItem("close", "删除分组（游戏不会被删除）", () => { close(); groups = groups.filter((x) => x !== gr); saveGroups(); paintGrid(); }, "is-danger")
        ), { width: 240, alignRight: true })) : null
      ])
    );
    if (!members.length) {
      sec.appendChild(h("div.bm7-ggroup-empty", { text: "这个分组还没有游戏。在游戏卡片的「⋯」里选择「加入分组」。" }));
      return sec;
    }
    const row = justified(members, () => (reorder ? { reorder: true, onMove: (g, d) => moveInGroup(gr, g.id, d) } : {}));
    if (reorder) bindDragReorder(row, gr);
    sec.appendChild(row);
    return sec;
  }

  function moveInGroup(gr, id, delta) {
    const i = gr.gameIds.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= gr.gameIds.length) return;
    [gr.gameIds[i], gr.gameIds[j]] = [gr.gameIds[j], gr.gameIds[i]];
    saveGroups();
    paintGrid();
  }

  function bindDragReorder(row, gr) {
    let dragId = null;
    row.querySelectorAll(".bm7-gcard").forEach((card) => {
      card.addEventListener("dragstart", (e) => { dragId = card.dataset.id; card.classList.add("is-dragging"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("dragend", () => { card.classList.remove("is-dragging"); row.querySelectorAll(".is-over").forEach((x) => x.classList.remove("is-over")); });
      card.addEventListener("dragover", (e) => { if (dragId && dragId !== card.dataset.id) { e.preventDefault(); card.classList.add("is-over"); } });
      card.addEventListener("dragleave", () => card.classList.remove("is-over"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = gr.gameIds.indexOf(dragId);
        const to = gr.gameIds.indexOf(card.dataset.id);
        dragId = null;
        if (from < 0 || to < 0 || from === to) return;
        const [m] = gr.gameIds.splice(from, 1);
        gr.gameIds.splice(to, 0, m);
        saveGroups();
        paintGrid();
      });
    });
  }

  function promptName(anchor, title, initial, onOk) {
    popover(anchor || toolbar, (box, close) => {
      const inp = h("input.bm7-input", { attr: { type: "text", placeholder: "分组名称，例如：柚子社 · 本篇与 FD" } });
      inp.value = initial || "";
      const ok = () => { const v = inp.value.trim(); if (!v) return; close(); onOk(v); };
      inp.addEventListener("keydown", (e) => e.key === "Enter" && ok());
      box.append(h("div.bm7-pop-title", { text: title }), inp, h("div.bm7-ce-actions", [h("span.bm7-grow"), button("确定", { variant: "primary", onClick: ok })]));
      setTimeout(() => inp.focus(), 30);
    }, { width: 300 });
  }
  function newGroup(anchor, thenAdd) {
    promptName(anchor || gridHost.querySelector(".bm7-gnewgroup"), "新建分组", "", (name) => {
      const gr = { id: `grp-${Date.now().toString(36)}`, name, gameIds: thenAdd ? [thenAdd.id] : [] };
      groups.push(gr);
      saveGroups();
      if (thenAdd) saveUi({ groupMode: "custom" });
      paintGrid();
    });
  }
  function renameGroup(gr) {
    promptName(gridHost.querySelector(".bm7-ggroup-head"), "重命名分组", gr.name, (name) => { gr.name = name; saveGroups(); paintGrid(); });
  }

  function openCardMenu(g, anchor) {
    popover(anchor, (box, close) => {
      box.append(
        ...[
          menuItem("clock", "详情与统计", () => { close(); openStats(g); }),
          menuItem("crop", "封面比例与填充", () => { close(); openCoverEditor(anchor, g, ctx, ui.defaultAspect, paintGrid); }),
          menuItem("pen", "手札", () => { close(); ctx.actions.openJournal && ctx.actions.openJournal(g); }),
          menuItem("note", "修改封面与信息", () => { close(); ctx.actions.editMeta && ctx.actions.editMeta(g); }),
          ctx.actions.openRelations ? menuItem("link", "关联其他典藏", () => { close(); ctx.actions.openRelations(g); }) : null
        ].filter(Boolean)
      );
      box.appendChild(h("div.bm7-pop-title", { text: "加入分组" }));
      groups.forEach((gr) => {
        const inG = gr.gameIds.includes(g.id);
        box.appendChild(menuItem(inG ? "check" : "folder", gr.name, () => {
          if (inG) gr.gameIds = gr.gameIds.filter((x) => x !== g.id); else gr.gameIds.push(g.id);
          saveGroups(); close(); paintGrid();
        }, inG ? "is-checked" : ""));
      });
      box.appendChild(menuItem("plus", "新建分组并加入", () => { close(); newGroup(anchor, g); }));
      if (ctx.actions.removeGame) {
        let armed = false;
        const delBtn = menuItem("close", "移出游戏典藏", async () => {
          if (!armed) {
            armed = true;
            const labelEl = delBtn.querySelector("span");
            if (labelEl) labelEl.textContent = "再点一次确认移出";
            return;
          }
          close();
          await ctx.actions.removeGame(g);
        }, "is-danger");
        box.appendChild(delBtn);
      }
    }, { width: 240, alignRight: true });
  }

  function openPlaytimeTrackerPopover(anchor) {
    if (!hasTracker) return;
    popover(anchor, (box, close) => {
      const renderPopBody = () => {
        clear(box);
        const cfg = Object.assign({}, ctx.playtimeTracker.getSettings());
        const st = ctx.playtimeTracker.getStatus();
        const isWin = Boolean(st && st.supported);
        const liveArr = Array.isArray(st && st.activeGames) ? st.activeGames : [];

        const statusHeadText = !isWin
          ? "当前系统支持在 Obsidian 开启期间自动记录时长"
          : st.running
            ? `后台守卫运行中 · 约 ${st.workingSetMB || 4} MB 内存 · 0 显存`
            : st.installed
              ? "后台守卫已停用（随时可一键重新开启）"
              : "后台守卫未启用（默认关闭）";

        const statusSubParts = [];
        if (isWin && st.running) {
          statusSubParts.push(`PID ${st.pid}`);
          statusSubParts.push(`正在监测 ${st.trackedGameCount} 款已绑定游戏`);
          statusSubParts.push(st.autoStartRegistered ? "开机自启已开启" : "未设开机自启");
        } else if (isWin) {
          statusSubParts.push(`已识别 ${st.trackedGameCount} 款绑定了路径的游戏`);
        }
        if (st.lastSyncAtMs) {
          statusSubParts.push(`上次同步 ${formatClock(new Date(st.lastSyncAtMs))}`);
        }

        const statusCard = h("div.bm7-tracker-status", [
          h("div.bm7-tracker-status-head", [
            h("span.bm7-tracker-dot", { cls: st && st.running ? "is-on" : "" }),
            h("span", { text: statusHeadText })
          ]),
          statusSubParts.length ? h("div.bm7-tracker-status-sub", { text: statusSubParts.join(" · ") }) : null,
          liveArr.length
            ? h(
                "div.bm7-tracker-live-list",
                liveArr.map((ag) =>
                  h("div", {
                    text: `游玩中：《${ag.title || "已收录游戏"}》已同步 ${
                      ag.elapsedMinutes > 0 ? formatMinutes(ag.elapsedMinutes, true) : "不足 1 分钟"
                    }`
                  })
                )
              )
            : null
        ]);

        const msgLine = h("p.bm7-ce-hint", { style: { display: "none", color: "var(--bm7-live)" } });
        const showErr = (t) => {
          msgLine.textContent = t;
          msgLine.style.display = t ? "" : "none";
        };

        box.append(
          ...[
            h("div.bm7-pop-title", { text: "游玩时长自动记录与离线守卫" }),
            statusCard,
            toggleRow({
              label: "自动记录外部启动的游戏",
              hint: "与侧边手札独立：即使关掉侧边浮窗，在 Obsidian 开启期间也能自动记时长",
              checked: cfg.autoTrackExternalGames !== false,
              onChange: async (v) => {
                await ctx.playtimeTracker.updateSettings({ autoTrackExternalGames: v });
                renderPopBody();
              }
            }),
            isWin
              ? toggleRow({
                  label: "脱离 Obsidian 后台守卫（Windows）",
                  hint: "关闭 Obsidian 期间照常记录，玩到一半或玩完打开即同步；无窗口、0 显存、仅占约 3–8 MB 内存",
                  checked: Boolean(cfg.backgroundWatcherEnabled || (st && st.running)),
                  onChange: async (v) => {
                    showErr("");
                    const { opResult } = await ctx.playtimeTracker.updateSettings({
                      backgroundWatcherEnabled: v,
                      autoStartWithWindows: v ? cfg.autoStartWithWindows : false
                    });
                    if (opResult && !opResult.ok && opResult.error) {
                      showErr(opResult.error);
                    }
                    renderPopBody();
                  }
                })
              : null,
            isWin && (cfg.backgroundWatcherEnabled || (st && st.running))
              ? toggleRow({
                  label: "随 Windows 开机自动启动",
                  hint: "写入当前用户启动项（免管理员），重启电脑未开 Obsidian 也能记录；关闭即清理启动项",
                  checked: Boolean(st && st.autoStartRegistered),
                  onChange: async (v) => {
                    showErr("");
                    const { opResult } = await ctx.playtimeTracker.updateSettings({
                      backgroundWatcherEnabled: true,
                      autoStartWithWindows: v
                    });
                    if (opResult && !opResult.ok && opResult.error) {
                      showErr(opResult.error);
                    }
                    renderPopBody();
                  }
                })
              : null,
            msgLine,
            h("p.bm7-ce-hint", {
              text: "支持同时追踪多款游戏、自动排除睡眠休眠时间与 15 秒启动器交接防抖；可在单个游戏的「修改封面与信息」里查看或补充监测进程名。"
            }),
            h("div.bm7-ce-actions", [
              button("立即同步", {
                icon: "refresh",
                variant: "primary",
                onClick: async () => {
                  const res = await ctx.playtimeTracker.syncNow();
                  if (!res || !res.syncedCount) {
                    showErr("");
                  }
                  renderPopBody();
                }
              }),
              isWin && (st.running || st.installed || st.autoStartRegistered)
                ? button("停用并清理", {
                    variant: "ghost",
                    onClick: async () => {
                      await ctx.playtimeTracker.uninstallWatcher();
                      renderPopBody();
                    }
                  })
                : null,
              h("span.bm7-grow"),
              button("完成", { onClick: () => close() })
            ])
          ].filter(Boolean)
        );
      };
      renderPopBody();
    }, { width: 410, alignRight: true });
  }

  function openCapsuleQuickSettings(anchor) {
    if (!hasCapsule) return;
    popover(anchor, (box, close) => {
      const cfg = Object.assign({}, ctx.capsule.getSettings());
      const opVal = h("span.bm7-section-sub", {
        style: { minWidth: "48px", textAlign: "right", fontWeight: "600" },
        text: cfg.idleOpacity === 0 ? "全透明" : `${cfg.idleOpacity}%`
      });
      const opRange = h("input.bm7-range", {
        attr: { type: "range", min: "0", max: "100", step: "1", value: String(cfg.idleOpacity) },
        style: { flex: "1" },
        on: {
          input: () => {
            cfg.idleOpacity = Number(opRange.value) || 0;
            opVal.textContent = cfg.idleOpacity === 0 ? "全透明" : `${cfg.idleOpacity}%`;
            ctx.capsule.updateSettings({ idleOpacity: cfg.idleOpacity }, { promptTaskbar: false });
          }
        }
      });

      const mgVal = h("span.bm7-section-sub", {
        style: { minWidth: "48px", textAlign: "right", fontWeight: "600" },
        text: `${cfg.edgeMargin}px`
      });
      const mgRange = h("input.bm7-range", {
        attr: { type: "range", min: "0", max: "28", step: "1", value: String(cfg.edgeMargin) },
        style: { flex: "1" },
        on: {
          input: () => {
            cfg.edgeMargin = Number(mgRange.value) || 0;
            mgVal.textContent = `${cfg.edgeMargin}px`;
            ctx.capsule.updateSettings({ edgeMargin: cfg.edgeMargin }, { promptTaskbar: false });
          }
        }
      });

      const swVal = h("span.bm7-section-sub", {
        style: { minWidth: "48px", textAlign: "right", fontWeight: "600" },
        text: `${cfg.stripWidth ?? 6}px`
      });
      const swRange = h("input.bm7-range", {
        attr: { type: "range", min: "4", max: "14", step: "1", value: String(cfg.stripWidth ?? 6) },
        style: { flex: "1" },
        on: {
          input: () => {
            cfg.stripWidth = Number(swRange.value) || 6;
            swVal.textContent = `${cfg.stripWidth}px`;
            ctx.capsule.updateSettings({ stripWidth: cfg.stripWidth }, { promptTaskbar: false });
          }
        }
      });

      const shVal = h("span.bm7-section-sub", {
        style: { minWidth: "48px", textAlign: "right", fontWeight: "600" },
        text: `${cfg.stripHeight ?? 84}px`
      });
      const shRange = h("input.bm7-range", {
        attr: { type: "range", min: "52", max: "148", step: "4", value: String(cfg.stripHeight ?? 84) },
        style: { flex: "1" },
        on: {
          input: () => {
            cfg.stripHeight = Number(shRange.value) || 84;
            shVal.textContent = `${cfg.stripHeight}px`;
            ctx.capsule.updateSettings({ stripHeight: cfg.stripHeight }, { promptTaskbar: false });
          }
        }
      });

      const rowLabelStyle = { fontSize: "12.5px", whiteSpace: "nowrap", flexShrink: "0", minWidth: "78px" };

      box.append(
        h("div.bm7-pop-title", { text: "游戏侧边手札胶囊（桌面端）" }),
        toggleRow({
          label: "游戏运行时启用侧边手札",
          hint: "仅控制屏幕旁侧浮窗，关闭后不会影响游戏游玩时长的自动记录",
          checked: cfg.enabled,
          onChange: async (v) => {
            cfg.enabled = v;
            await ctx.capsule.updateSettings({ enabled: v });
            repaintAll();
          }
        }),
        h("label.bm7-ce-row", { style: { marginTop: "6px", gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "窄条不透明度" }),
          opRange,
          opVal
        ]),
        h("label.bm7-ce-row", { style: { gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "距屏幕边缘" }),
          mgRange,
          mgVal
        ]),
        h("label.bm7-ce-row", { style: { gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "窄条粗细" }),
          swRange,
          swVal
        ]),
        h("label.bm7-ce-row", { style: { gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "窄条高度" }),
          shRange,
          shVal
        ]),
        h("div.bm7-ce-row", { style: { justifyContent: "space-between", marginTop: "4px", gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "默认附着侧" }),
          segmented(
            [
              { value: "left", label: "左侧" },
              { value: "right", label: "右侧" }
            ],
            cfg.dockSide,
            (side) => {
              cfg.dockSide = side;
              ctx.capsule.updateSettings({ dockSide: side }, { promptTaskbar: false });
            },
            "is-small"
          )
        ]),
        h("div.bm7-ce-row", { style: { justifyContent: "space-between", marginTop: "4px", gap: "10px" } }, [
          h("span", { style: rowLabelStyle, text: "全屏任务栏" }),
          segmented(
            [
              { value: "auto_hide", label: "打字时收起", title: "在全屏游戏内点击手札输入框打字时，临时自动收起底部任务栏，收起手札即还原" },
              { value: "keep_system", label: "系统默认", title: "不修改任何系统任务栏设置" }
            ],
            cfg.taskbarPolicy === "auto_hide" ? "auto_hide" : "keep_system",
            (pol) => {
              cfg.taskbarPolicy = pol;
              ctx.capsule.updateSettings({ taskbarPolicy: pol }, { promptTaskbar: false });
            },
            "is-small"
          )
        ]),
        h("p.bm7-ce-hint", {
          text: "窄条样式会自动跟随当前「番剧档案馆」外观主题，支持按住胶囊或浮窗顶栏跨多显示器拖拽磁吸。"
        }),
        h("div.bm7-ce-actions", [
          button("预览侧边胶囊", {
            icon: "eye",
            variant: "primary",
            onClick: () => {
              close();
              ctx.capsule.preview(current || games[0] || null);
            }
          }),
          h("span.bm7-grow"),
          button("完成", { onClick: () => close() })
        ])
      );
    }, { width: 396, alignRight: true });
  }

  function openGlobalAspect(anchor) {
    popover(anchor, (box, close) => {
      const custom = games.filter((g) => g.coverAspect || g.coverFit === "contain" || g.coverFocusY !== undefined).length;
      box.append(
        h("div.bm7-pop-title", { text: "全部卡片的默认封面比例" }),
        h("div.bm7-ce-chips", ASPECT_PRESETS.map((p) => h("button.bm7-ce-chip", {
          cls: ui.defaultAspect === p.id ? "is-active" : "",
          attr: { type: "button", title: p.hint },
          text: p.label,
          on: { click: () => { saveUi({ defaultAspect: p.id }); close(); repaintAll(); } }
        }))),
        h("p.bm7-ce-hint", { text: "单个游戏可在卡片「⋯ → 封面比例与填充」里单独设置；没有单独设置的游戏会跟随这里。" }),
        h("div.bm7-ce-actions", [
          button(custom ? `全部恢复默认比例（${custom} 部有单独设置）` : "全部恢复默认比例", {
            icon: "reset",
            disabled: !custom,
            onClick: async () => {
              for (const g of games) {
                if (g.coverAspect || g.coverFit || g.coverFocusY !== undefined) {
                  delete g.coverAspect; delete g.coverFit; delete g.coverFocusY;
                  await ctx.actions.saveGame(g);
                }
              }
              close();
              repaintAll();
            }
          })
        ])
      );
    }, { width: 340, alignRight: true });
  }

  paintGrid();

  // 若当前有游戏正在游玩中，每 30 秒温和刷新实时累计分钟数（元素卸载即自动停表）
  if (host._bm7LiveTickTimer) {
    clearInterval(host._bm7LiveTickTimer);
    host._bm7LiveTickTimer = null;
  }
  if (liveMap.size > 0) {
    host._bm7LiveTickTimer = setInterval(() => {
      if (!stage.isConnected) {
        clearInterval(host._bm7LiveTickTimer);
        host._bm7LiveTickTimer = null;
        return;
      }
      repaintAll();
    }, 30000);
  }

  return { el: stage, repaint: repaintAll };
}

function fig(label, value) {
  return h("div.bm7-ghero-fig", [h("span.bm7-ghero-fig-label", { text: label }), h("span.bm7-ghero-fig-val", { text: value })]);
}

/** 近 7 天全部游戏时长条 */
function weekStrip(games, liveMap = null) {
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfDay(now).getTime() - i * DAY_MS);
    days.push({ d, v: 0 });
  }
  for (const g of games) {
    for (const s of sessionsOf(g)) {
      for (const x of days) if (dayKey(s._d) === dayKey(x.d)) x.v += s.minutes;
    }
    const lv = liveMap && g && liveMap.get(g.id);
    if (lv && lv.elapsedSeconds > 0 && days.length > 0) {
      days[days.length - 1].v += Math.max(0, Math.round(lv.elapsedSeconds / 60));
    }
  }
  const max = Math.max(30, ...days.map((x) => x.v));
  return h("div.bm7-gweek", [
    h("div.bm7-dist-label", { text: "近 7 天" }),
    h("div.bm7-dist-bars", days.map((x, i) => h("div.bm7-dist-bar", { title: `${x.d.getMonth() + 1}月${x.d.getDate()}日 · ${x.v ? formatMinutes(x.v) : "没有游玩"}` }, [
      h("span.bm7-dist-fill", { cls: i === 6 ? "is-max" : "", style: { height: `${x.v ? Math.max(5, (x.v / max) * 100) : 3}%` } }),
      h("span.bm7-dist-tick", { text: i === 6 ? "今" : WEEKDAY_CN[x.d.getDay()].slice(1) })
    ])))
  ]);
}

module.exports = {
  renderGameStage,
  renderGameCard,
  renderGameStatsPanel,
  openGameStatsPanel,
  openCoverEditor,
  renderGameSourceSearch,
  gameStats,
  aspectValue,
  ASPECT_PRESETS
};
