/**
 * v0.7 视觉层 · 历史动态与节奏图（番剧 / 游戏共用）
 * ---------------------------------------------------------------
 * 统一事件格式（由主线数据层记录；首日可用 deriveAnimeEventsFromItems 从现有手札回填）：
 *   {
 *     id, ts,                 // ts: ISO 字符串或毫秒时间戳
 *     type,                   // 番剧：episode | complete | rate | review | start | drop | plan
 *                             // 游戏：play | finish | rate | note | add
 *     key,                    // 作品唯一键（subjectId / 笔记路径 / 游戏 id）
 *     title, cover,
 *     epFrom, epTo,           // episode：本次推进的集数区间（单集时 epFrom===epTo）
 *     score,                  // rate
 *     text,                   // review / note 摘要
 *     minutes                 // play：本次游玩分钟数
 *   }
 */
const {
  h,
  clear,
  icon,
  coverEl,
  segmented,
  toDate,
  startOfDay,
  startOfWeek,
  startOfMonth,
  dayKey,
  formatDayLabel,
  formatClock,
  formatMinutes,
  WEEKDAY_CN,
  DAY_MS,
  emptyState
} = require("./v07-core.js");

/* ============================== 事件元信息 ============================== */

const ANIME_TYPES = {
  episode: { label: "看集", icon: "play", tone: "accent" },
  complete: { label: "看完", icon: "flag", tone: "ok" },
  rate: { label: "评分", icon: "star", tone: "gold" },
  review: { label: "手札", icon: "pen", tone: "ink" },
  start: { label: "开始看", icon: "sparkle", tone: "accent" },
  plan: { label: "想看", icon: "plus", tone: "muted" },
  drop: { label: "搁置", icon: "minus", tone: "muted" }
};

const GAME_TYPES = {
  play: { label: "游玩", icon: "gamepad", tone: "accent" },
  finish: { label: "通关", icon: "flag", tone: "ok" },
  rate: { label: "评分", icon: "star", tone: "gold" },
  note: { label: "手札", icon: "pen", tone: "ink" },
  add: { label: "收录", icon: "plus", tone: "muted" }
};

function eventWeight(ev, unit) {
  if (unit === "minutes") return Math.max(0, Number(ev.minutes) || 0);
  if (ev.type === "episode") {
    const a = Number(ev.epFrom);
    const b = Number(ev.epTo);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return b - a + 1;
    return 1;
  }
  return 0;
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((e) => Object.assign({}, e, { _d: toDate(e.ts) }))
    .filter((e) => e._d && !Number.isNaN(e._d.getTime()))
    .sort((a, b) => b._d - a._d);
}

/* ============================== 统计 ============================== */

function computeRhythm(events, unit = "episodes", now = new Date()) {
  const list = normalizeEvents(events);
  const byDay = new Map();
  const weekday = new Array(7).fill(0);
  const hours = new Array(24).fill(0);
  let hasClock = false;
  const today0 = startOfDay(now);
  const week0 = startOfWeek(now);
  const month0 = startOfMonth(now);
  let week = 0;
  let month = 0;
  let lastWeek = 0;
  const lastWeek0 = new Date(week0.getTime() - 7 * DAY_MS);

  for (const ev of list) {
    const w = eventWeight(ev, unit);
    if (w <= 0) continue;
    const k = dayKey(ev._d);
    byDay.set(k, (byDay.get(k) || 0) + w);
    weekday[ev._d.getDay()] += w;
    if (ev._d.getHours() || ev._d.getMinutes()) {
      hours[ev._d.getHours()] += w;
      hasClock = true;
    }
    if (ev._d >= week0) week += w;
    else if (ev._d >= lastWeek0) lastWeek += w;
    if (ev._d >= month0) month += w;
  }

  // 连续天数：从今天（若今天尚无记录则从昨天）向前数
  let streak = 0;
  let cursor = new Date(today0);
  if (!byDay.get(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
  while (byDay.get(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  // 最常见的时段
  let favDay = -1;
  let favDayVal = 0;
  weekday.forEach((v, i) => {
    if (v > favDayVal) {
      favDayVal = v;
      favDay = i;
    }
  });
  const periods = [
    { name: "深夜", hours: [23, 0, 1, 2, 3, 4] },
    { name: "早上", hours: [5, 6, 7, 8, 9, 10] },
    { name: "中午", hours: [11, 12, 13] },
    { name: "下午", hours: [14, 15, 16, 17] },
    { name: "晚上", hours: [18, 19, 20, 21, 22] }
  ];
  let favPeriod = "";
  let favPeriodVal = 0;
  if (hasClock) {
    for (const p of periods) {
      const v = p.hours.reduce((s, hh) => s + hours[hh], 0);
      if (v > favPeriodVal) {
        favPeriodVal = v;
        favPeriod = p.name;
      }
    }
  }

  return {
    byDay,
    weekday,
    hours,
    hasClock,
    week,
    lastWeek,
    month,
    streak,
    favDay: favDay >= 0 ? WEEKDAY_CN[favDay] : "",
    favPeriod,
    activeDays: byDay.size,
    total: Array.from(byDay.values()).reduce((a, b) => a + b, 0)
  };
}

function formatAmount(v, unit) {
  if (unit === "minutes") return formatMinutes(v, true);
  return `${Math.round(v)} 集`;
}

/* ============================== 节奏图 ============================== */

/**
 * renderRhythm(host, events, { unit: "episodes"|"minutes", weeks: 26, title })
 * 包含：四个摘要数、近 N 周热力格、星期分布、一天 24 小时分布
 */
function renderRhythm(host, events, opts = {}) {
  clear(host);
  const unit = opts.unit || "episodes";
  const now = opts.now || new Date();
  const r = computeRhythm(events, unit, now);
  const weeks = opts.weeks || 26;

  const wrap = h("div.bm7-rhythm");

  // —— 摘要 ——
  const trend = r.lastWeek > 0 ? Math.round(((r.week - r.lastWeek) / r.lastWeek) * 100) : null;
  const stats = h("div.bm7-rhythm-stats", [
    stat("本周", formatAmount(r.week, unit), trend === null ? "" : trend >= 0 ? `比上周多 ${trend}%` : `比上周少 ${-trend}%`),
    stat("本月", formatAmount(r.month, unit), `${monthActiveDays(r.byDay, now)} 天有记录`),
    stat("连续", `${r.streak} 天`, r.streak > 0 ? "保持得不错" : "今天还没有记录"),
    stat(
      "最常在",
      r.favDay ? `${r.favDay}${r.favPeriod ? r.favPeriod : ""}` : "—",
      r.favDay ? (unit === "minutes" ? "最常玩游戏的时间" : "最常看番的时间") : "记录多一些就能看出规律"
    )
  ]);
  wrap.appendChild(stats);

  // —— 热力格与可点击明细条 ——
  const end = startOfDay(now);
  const firstWeekStart = new Date(startOfWeek(end).getTime() - (weeks - 1) * 7 * DAY_MS);
  const values = Array.from(r.byDay.values()).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : 0);
  const thresholds = [q(0.25), q(0.5), q(0.8)];
  const level = (v) => (v <= 0 ? 0 : v <= thresholds[0] ? 1 : v <= thresholds[1] ? 2 : v <= thresholds[2] ? 3 : 4);

  const normalizedList = normalizeEvents(events);
  const activeSel = { kind: "", key: "" };
  const detailSlot = h("div.bm8-rhythm-pick-slot");

  const syncSelectionClasses = () => {
    wrap.querySelectorAll("[data-rpick]").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.rpick === `${activeSel.kind}:${activeSel.key}`);
    });
  };

  const showRhythmPick = (kind, key, headline, matchedEvents) => {
    const token = `${kind}:${key}`;
    if (activeSel.kind && `${activeSel.kind}:${activeSel.key}` === token) {
      activeSel.kind = "";
      activeSel.key = "";
      syncSelectionClasses();
      clear(detailSlot);
      return;
    }
    activeSel.kind = kind;
    activeSel.key = String(key);
    syncSelectionClasses();
    clear(detailSlot);

    const uniqueTitles = [];
    const seen = new Set();
    for (const ev of matchedEvents) {
      const t = ev.title || "未命名";
      const k = ev.key || t;
      if (seen.has(k)) continue;
      seen.add(k);
      uniqueTitles.push(ev);
    }

    detailSlot.appendChild(
      h("div.bm8-inline-FocusTray", [
        h("div.bm8-inline-tray-head", [
          h("span.bm8-inline-tray-title", { text: headline }),
          h("button.bm8-inline-tray-close", {
            attr: { type: "button", title: "收起明细" },
            on: {
              click: () => {
                activeSel.kind = "";
                activeSel.key = "";
                syncSelectionClasses();
                clear(detailSlot);
              }
            }
          }, [icon("close", 12)])
        ]),
        uniqueTitles.length
          ? h(
              "div.bm8-inline-tray-chips",
              uniqueTitles.slice(0, 8).map((ev) =>
                h(
                  opts.onOpen ? "button.bm8-inline-work-chip" : "span.bm8-inline-work-chip",
                  Object.assign(
                    { text: `《${ev.title || "未命名"}》` },
                    opts.onOpen
                      ? {
                          attr: { type: "button", title: `打开《${ev.title || ""}》` },
                          on: { click: () => opts.onOpen(ev) }
                        }
                      : {}
                  )
                )
              )
            )
          : h("div.bm8-inline-tray-empty", { text: "该时间段暂无具体条目记录。" })
      ])
    );
  };

  const heat = h("div.bm7-heat", { style: { "--bm7-weeks": String(weeks) } });
  const months = h("div.bm7-heat-months");
  const grid = h("div.bm7-heat-grid", { attr: { role: "group", "aria-label": `近 ${weeks} 周记录热力图（点击格子可查看当日明细）` } });
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const colStart = new Date(firstWeekStart.getTime() + w * 7 * DAY_MS);
    const m = colStart.getMonth();
    months.appendChild(h("span.bm7-heat-month", { text: m !== lastMonth && colStart.getDate() <= 7 ? `${m + 1}月` : "" }));
    if (colStart.getDate() <= 7) lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart.getTime() + d * DAY_MS);
      if (day > end) {
        grid.appendChild(h("span.bm7-heat-cell.is-future"));
        continue;
      }
      const dk = dayKey(day);
      const v = r.byDay.get(dk) || 0;
      const label = `${day.getMonth() + 1}月${day.getDate()}日 ${WEEKDAY_CN[day.getDay()]} · ${v > 0 ? formatAmount(v, unit) : "没有记录"}`;
      grid.appendChild(
        h("span.bm7-heat-cell.is-interactive", {
          dataset: { lv: level(v), rpick: `day:${dk}` },
          attr: { role: "button", tabindex: v > 0 ? "0" : "-1" },
          cls: dk === dayKey(end) ? "is-today" : "",
          title: v > 0 ? `${label}（点击查看当日作品）` : label,
          on: {
            click: () => {
              const matched = normalizedList.filter((ev) => dayKey(ev._d) === dk);
              showRhythmPick("day", dk, label, matched);
            },
            keydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const matched = normalizedList.filter((ev) => dayKey(ev._d) === dk);
                showRhythmPick("day", dk, label, matched);
              }
            }
          }
        })
      );
    }
  }
  const legend = h("div.bm7-heat-legend", [
    h("span", { text: "少" }),
    ...[0, 1, 2, 3, 4].map((lv) => h("span.bm7-heat-cell", { dataset: { lv } })),
    h("span", { text: "多" })
  ]);
  heat.append(
    h("div.bm7-heat-body", [
      h("div.bm7-heat-days", ["", "一", "", "三", "", "五", "", "日"].map((t) => h("span", { text: t }))),
      h("div.bm7-heat-scroll", [h("div.bm7-heat-inner", [months, grid])])
    ]),
    legend
  );
  wrap.appendChild(heat);

  // —— 星期与时段（均可点击查看对应分布作品） ——
  const dist = h("div.bm7-dist");
  const wkMax = Math.max(1, ...r.weekday);
  const order = [1, 2, 3, 4, 5, 6, 0];
  dist.appendChild(
    h("div.bm7-dist-week", [
      h("div.bm7-dist-label", { text: "一周里（点击柱条看明细）" }),
      h(
        "div.bm7-dist-bars",
        order.map((i) => {
          const amtText = formatAmount(r.weekday[i], unit);
          return h(
            "button.bm7-dist-bar.is-interactive",
            {
              attr: { type: "button", title: `${WEEKDAY_CN[i]} · ${amtText}（点击查看常看作品）` },
              dataset: { rpick: `wk:${i}` },
              on: {
                click: () => {
                  const matched = normalizedList.filter((ev) => ev._d.getDay() === i && eventWeight(ev, unit) > 0);
                  showRhythmPick("wk", i, `${WEEKDAY_CN[i]}累计 ${amtText}`, matched);
                }
              }
            },
            [
              h("span.bm7-dist-fill", {
                style: { height: `${Math.max(6, (r.weekday[i] / wkMax) * 100)}%` },
                cls: r.weekday[i] === wkMax && r.weekday[i] > 0 ? "is-max" : ""
              }),
              h("span.bm7-dist-tick", { text: WEEKDAY_CN[i].slice(1) })
            ]
          );
        })
      )
    ])
  );
  if (r.hasClock) {
    const hrMax = Math.max(1, ...r.hours);
    dist.appendChild(
      h("div.bm7-dist-day", [
        h("div.bm7-dist-label", { text: "一天里（点击时段看明细）" }),
        h(
          "div.bm7-dist-hours",
          r.hours.map((v, i) => {
            const amtText = formatAmount(v, unit);
            return h("button.bm7-dist-hour.is-interactive", {
              attr: { type: "button", title: `${i}:00–${i + 1}:00 · ${amtText}` },
              dataset: { rpick: `hr:${i}` },
              style: { "--a": (v / hrMax).toFixed(3) },
              on: {
                click: () => {
                  const matched = normalizedList.filter(
                    (ev) => (ev._d.getHours() || ev._d.getMinutes()) && ev._d.getHours() === i && eventWeight(ev, unit) > 0
                  );
                  showRhythmPick("hr", i, `${i}:00–${i + 1}:00 累计 ${amtText}`, matched);
                }
              }
            });
          })
        ),
        h("div.bm7-dist-hour-ticks", ["0点", "6点", "12点", "18点", "24点"].map((t) => h("span", { text: t })))
      ])
    );
  }
  wrap.append(dist, detailSlot);
  host.appendChild(wrap);
  return r;
}

function stat(label, value, hint) {
  return h("div.bm7-stat", [h("span.bm7-stat-label", { text: label }), h("span.bm7-stat-value", { text: value }), hint ? h("span.bm7-stat-hint", { text: hint }) : null]);
}

function monthActiveDays(byDay, now) {
  const m0 = startOfMonth(now);
  let n = 0;
  for (const k of byDay.keys()) {
    const d = toDate(k);
    if (d && d >= m0) n += 1;
  }
  return n;
}

/* ============================== 动态时间线 ============================== */

/**
 * renderFeed(host, events, {
 *   kind: "anime"|"game", limit, onOpen(event), getCover(event)
 * })
 */
function renderFeed(host, events, opts = {}) {
  clear(host);
  const kind = opts.kind || "anime";
  const types = kind === "game" ? GAME_TYPES : ANIME_TYPES;
  const all = normalizeEvents(events);
  const state = { filter: "all", expanded: false };
  const filters = [{ value: "all", label: "全部" }].concat(
    (kind === "game" ? ["play", "finish", "note"] : ["episode", "complete", "rate", "review"]).map((t) => ({ value: t, label: types[t].label }))
  );

  const wrap = h("div.bm7-feed");
  const feedSheet = h("div.bm8-feed-sheet", { style: { display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" } });
  const bar = segmented(filters, state.filter, (v) => {
    if (v === state.filter) return;
    const prevIdx = filters.findIndex((f) => f.value === state.filter);
    const nextIdx = filters.findIndex((f) => f.value === v);
    const dir = nextIdx >= prevIdx ? 1 : -1;
    state.filter = v;
    state.expanded = false;
    try {
      const { paperSlipSwap } = require("./v08-motion-and-lens.js");
      paperSlipSwap(feedSheet, () => paint(), { dir });
    } catch (_) {
      paint();
    }
  }, "is-small is-scroll");
  const list = h("div.bm7-feed-list");
  const more = h("div.bm7-feed-more");
  feedSheet.append(list, more);
  wrap.append(h("div.bm7-feed-filter", [bar]), feedSheet);
  host.appendChild(wrap);

  const describe = (ev) => {
    const t = h("span.bm7-feed-title", { text: `《${ev.title || "未命名"}》` });
    switch (ev.type) {
      case "episode": {
        const a = Number(ev.epFrom), b = Number(ev.epTo);
        const ep = Number.isFinite(a) && Number.isFinite(b) && b > a ? `第 ${a}–${b} 集` : `第 ${Number.isFinite(b) ? b : a} 集`;
        return ["看了", t, ep];
      }
      case "complete": return ["看完了", t];
      case "rate": return ["给", t, `打了 ${Number(ev.score).toFixed(1).replace(/\.0$/, "")} 分`];
      case "review": return ["为", t, "写了手札"];
      case "start": return ["开始看", t];
      case "plan": return ["把", t, "加入想看"];
      case "drop": return ["暂时搁置了", t];
      case "play": return ["玩了", t, formatMinutes(ev.minutes, true)];
      case "finish": return ["通关了", t];
      case "note": return ["为", t, "写了手札"];
      case "add": return ["收录了", t];
      default: return [t];
    }
  };

  const paint = () => {
    clear(list);
    clear(more);
    const filtered = state.filter === "all" ? all : all.filter((e) => e.type === state.filter);
    if (!filtered.length) {
      list.appendChild(emptyState(kind === "game" ? "还没有游玩记录。启动游戏或手动补录后会出现在这里。" : "还没有看番记录。推进集数、评分或写手札后会自动出现在这里。"));
      return;
    }
    const limit = state.expanded ? filtered.length : opts.limit || 30;
    let lastDay = "";
    let group = null;
    // 同一天同一作品的连续看集合并为一条（第 3–5 集）
    const merged = [];
    for (const ev of filtered.slice(0, limit * 2)) {
      const prev = merged[merged.length - 1];
      if (
        prev && ev.type === "episode" && prev.type === "episode" && prev.key && prev.key === ev.key &&
        dayKey(prev._d) === dayKey(ev._d) && Number(ev.epTo) + 1 >= Number(prev.epFrom)
      ) {
        prev.epFrom = Math.min(Number(prev.epFrom), Number(ev.epFrom));
        continue;
      }
      if (prev && ev.type === "play" && prev.type === "play" && prev.key && prev.key === ev.key && dayKey(prev._d) === dayKey(ev._d)) {
        prev.minutes = (Number(prev.minutes) || 0) + (Number(ev.minutes) || 0);
        prev._count = (prev._count || 1) + 1;
        continue;
      }
      merged.push(Object.assign({}, ev));
    }
    for (const ev of merged.slice(0, limit)) {
      const k = dayKey(ev._d);
      if (k !== lastDay) {
        lastDay = k;
        group = h("div.bm7-feed-day", [h("div.bm7-feed-date", { text: formatDayLabel(ev._d) })]);
        list.appendChild(group);
      }
      const meta = types[ev.type] || { label: "", icon: "sparkle", tone: "muted" };
      const row = h(
        "button.bm7-feed-item",
        {
          attr: { type: "button" },
          dataset: { tone: meta.tone },
          on: { click: () => opts.onOpen && opts.onOpen(ev) }
        },
        [
          h("span.bm7-feed-dot", [icon(meta.icon, 12)]),
          coverEl(opts.getCover ? opts.getCover(ev) : ev.cover, ev.title, "bm7-feed-cover"),
          h("span.bm7-feed-text", [
            h("span.bm7-feed-line", describe(ev)),
            ev.text && (ev.type === "review" || ev.type === "note") ? h("span.bm7-feed-quote", { text: ev.text }) : null,
            h("span.bm7-feed-meta", [
              formatClock(ev._d) ? h("span", { text: formatClock(ev._d) }) : null,
              h("span", { text: meta.label }),
              ev._count > 1 ? h("span", { text: `${ev._count} 次` }) : null
            ])
          ])
        ]
      );
      group.appendChild(row);
    }
    if (filtered.length > limit) {
      more.appendChild(
        h("button.bm7-link", {
          attr: { type: "button" },
          text: `查看更早的 ${filtered.length - limit} 条`,
          on: {
            click: () => {
              state.expanded = true;
              try {
                const { scrollUnrollMorph } = require("./v08-motion-and-lens.js");
                scrollUnrollMorph(feedSheet, () => paint());
              } catch (_) {
                paint();
              }
            }
          }
        })
      );
    }
  };
  paint();
  return { repaint: paint };
}

/* ============================== 首日回填 ============================== */

/**
 * 从现有番剧笔记推导初始足迹（不写回任何文件）：
 *  - 手札（review.date / timestamp）→ review 事件
 *  - 已看完且有评分 → rate 事件（时间取笔记修改时间）
 *  - 在看作品 → 以笔记修改时间生成一条 episode 事件（看到第 N 集）
 * 主线数据层上线真实事件日志后，传入真实 events 即可，本函数只作兜底。
 */
function deriveAnimeEventsFromItems(items, getCover) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const key = it.subjectId ? String(it.subjectId) : it.file && it.file.path;
    const cover = getCover ? getCover(it) : it.cover;
    const mtime =
      it.file && it.file.stat && it.file.stat.mtime
        ? it.file.stat.mtime
        : it.isSamplePreviewItem
          ? Date.now() - 3600 * 1000
          : null;
    for (const rv of Array.isArray(it.reviews) ? it.reviews : []) {
      const d = toDate(rv.date || rv.createdAt || rv.updatedAt || rv.timestamp);
      const rvBody = String(rv.text || rv.content || "").replace(/\s+/g, " ").trim();
      if (!d || !rvBody) continue;
      out.push({ id: `rv-${key}-${rv.id || out.length}`, ts: d.getTime(), type: "review", key, title: it.name, cover, text: rvBody.slice(0, 80) });
    }
    if (!mtime) continue;
    const watched = Number(it.watchedEpisodes) || 0;
    if (it.state === "在看" && watched > 0) {
      out.push({ id: `ep-${key}`, ts: mtime, type: "episode", key, title: it.name, cover, epFrom: watched, epTo: watched });
    } else if (it.state === "已看") {
      out.push({ id: `cp-${key}`, ts: mtime, type: "complete", key, title: it.name, cover });
      if (it.personalScore !== null && it.personalScore !== undefined && Number.isFinite(Number(it.personalScore))) {
        out.push({ id: `rt-${key}`, ts: mtime - 1000, type: "rate", key, title: it.name, cover, score: Number(it.personalScore) });
      }
    }
  }
  return out;
}

/** 游戏：从 playSessions / lastPlayedAt / playNotes 推导事件 */
function deriveGameEvents(games, getCover) {
  const out = [];
  for (const g of Array.isArray(games) ? games : []) {
    const cover = getCover ? getCover(g) : g.coverUrl;
    for (const s of Array.isArray(g.playSessions) ? g.playSessions : []) {
      const mins = s.minutes !== undefined && s.minutes !== null
        ? Number(s.minutes)
        : Math.round((Number(s.durationHours) || 0) * 60);
      out.push({ id: `gs-${g.id}-${s.id || s.start || s.startedAt}`, ts: s.start || s.startedAt || s.endedAt || s.date, type: "play", key: g.id, title: g.title, cover, minutes: Math.max(0, mins || 0) });
    }
    for (const n of Array.isArray(g.playNotes) ? g.playNotes : []) {
      const d = toDate(n.createdAt || n.time || n.timeLabel);
      if (d) out.push({ id: `gn-${g.id}-${n.id || d.getTime()}`, ts: d.getTime(), type: "note", key: g.id, title: g.title, cover, text: String(n.text || "").slice(0, 80) });
    }
    if (g.status === "通关" || g.status === "全成就") {
      const finTs = g.lastPlayedAt || g.createdAt;
      if (finTs) out.push({ id: `gf-${g.id}`, ts: finTs, type: "finish", key: g.id, title: g.title, cover });
    }
    if (g.createdAt) out.push({ id: `ga-${g.id}`, ts: g.createdAt, type: "add", key: g.id, title: g.title, cover });
  }
  return out;
}

module.exports = {
  ANIME_TYPES,
  GAME_TYPES,
  computeRhythm,
  renderRhythm,
  renderFeed,
  normalizeEvents,
  deriveAnimeEventsFromItems,
  deriveGameEvents
};
