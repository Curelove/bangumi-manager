/**
 * v0.8 视觉层 · 番剧首屏（单屏收敛构图 + 三场景焦点舞台 + 暗室惊喜式统计画像抽屉）
 * ---------------------------------------------------------------
 * 宽屏（容器 ≥ 1080px）：
 *   ┌──────── 焦点舞台（继续看 · 刚下载 · 当季番） ────────┐┌─ 关注直播间 ─┐
 *   │ 破框封面 · 集数刻度 · 诚实主按钮 · 随手记一句 · 胶片轨 ││              │
 *   └──────────────────────────────────────────────────────┘├─ 看番动态 ──┤
 *   ┌────────────── 洛琪希的批注（仅手记主题） ────────────┐│  (时间线，   │
 *   └──────────────────────────────────────────────────────┘│   自身滚动)  │
 *   ┌── 随机看一集 ──┐┌──────── 看番节奏（含画像入口） ────┐│              │
 *   └────────────────┘└────────────────────────────────────┘│              │
 *   ┌──────────── 个人片单与智能筛选 ──────────────────────┐│              │
 *   └──────────────────────────────────────────────────────┘└──────────────┘
 */
const {
  h,
  clear,
  icon,
  coverEl,
  segmented,
  button,
  iconButton,
  popover,
  closeAllPopovers,
  panel,
  emptyState,
  applyAmbient,
  platformInfo,
  formatRelative,
  toDate,
  WEEKDAY_CN,
  motionEnabled
} = require("./v07-core.js");
const { applyTheme, setGlowBackdrop } = require("./v07-themes.js");
const { renderRoxyHandbookCard } = require("./v07-roxy-art.js");
const { mountRoxyPanelRig } = require("./v08-roxy-live-rig.js");
const { renderFeed, normalizeEvents } = require("./v07-history.js");
const { renderRandomPicker } = require("./v07-random-pick.js");
const { renderLiveRooms } = require("./v07-live-rooms.js");
const { renderLists, menuItem } = require("./v07-lists.js");
const {
  inkPageSwap,
  paperSlipSwap,
  scrollUnrollMorph,
  createPageJumpLink,
  renderWatchLensDeck
} = require("./v08-motion-and-lens.js");

function bgmScore(it) {
  const v = it.preciseScore ?? it.publicScore ?? it.bangumiScore;
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}

function myScore(it) {
  const v = it.personalScore;
  return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

function epInfo(item, local) {
  const total = parseInt(item.totalEpisodes, 10) || 0;
  const watched = Number(item.watchedEpisodes) || 0;
  const localMax =
    local && Number(local.maxLocalEpisode)
      ? Number(local.maxLocalEpisode)
      : local && local.nextEpisodeFile
      ? watched + Math.max(1, Number(local.newCount) || 1)
      : 0;
  const next = total && watched >= total ? null : watched + 1;
  return { total, watched, localMax, next, hasLocalNext: Boolean(local && local.nextEpisodeFile) };
}

function normalizeSeasonMonth(rawSeason) {
  const s = String(rawSeason || "").trim();
  if (!s) return "";
  if (/10|秋/.test(s)) return "10";
  if (/0?7|夏/.test(s)) return "07";
  if (/0?4|春/.test(s)) return "04";
  if (/0?1|冬/.test(s)) return "01";
  return "";
}

function seasonDisplayLabel(year, sm) {
  const map = { "01": "1 月冬季档", "04": "4 月春季档", "07": "7 月夏季档", "10": "10 月秋季档" };
  if (!year) return "近期番季";
  return `${year} 年 ${map[sm] || (sm ? `${Number(sm)} 月档` : "番季")}`;
}

/** 集数刻度：已看实心 · 下一集描边微呼吸 · 本地已下载未看带绿点 */
function episodeStrip(info) {
  const { total, watched, localMax, next } = info;
  if (total > 40) {
    const wrap = h("div.bm7-ep-bar", { attr: { role: "img", "aria-label": `已看 ${watched} / ${total} 集` } }, [
      h("span.bm7-ep-bar-local", { style: { width: `${Math.min(100, (localMax / total) * 100)}%` } }),
      h("span.bm7-ep-bar-fill", { style: { width: `${Math.min(100, (watched / total) * 100)}%` } })
    ]);
    for (let i = 5; i < total; i += 5) {
      wrap.appendChild(h("span.bm7-ep-bar-tick", { style: { left: `${(i / total) * 100}%` } }));
    }
    return wrap;
  }
  const count = total || Math.max(watched + 3, localMax, 12);
  const strip = h("div.bm7-ep-strip", {
    attr: { role: "img", "aria-label": total ? `已看 ${watched} / ${total} 集` : `已看 ${watched} 集` }
  });
  for (let i = 1; i <= count; i++) {
    const cls = [
      i <= watched ? "is-watched" : "",
      i === next ? "is-next" : "",
      i > watched && i <= localMax ? "is-local" : ""
    ].join(" ");
    strip.appendChild(
      h("span.bm7-ep", {
        cls,
        text: String(i),
        title: i <= watched ? `第 ${i} 集 · 已看` : i <= localMax ? `第 ${i} 集 · 本地已下载` : `第 ${i} 集`
      })
    );
  }
  if (!total) strip.appendChild(h("span.bm7-ep.is-more", { text: "…", title: "总集数待定" }));
  return strip;
}

/* ============================== 暗室惊喜式 · 看番统计画像抽屉 ============================== */

function collectCleanTagsForInsights(item) {
  const raw = String((item && item.tags) || "");
  if (!raw) return [];
  const blacklist = /^(?:bangumi|\d{4}(?:年(?:\d{1,2}月)?)?|\d{1,2}月(?:新番)?|TV|TVA|OVA|OAD|WEB|剧场版|动画|日本|日本动画|未分类|未确定)$/i;
  const out = [];
  for (const tok of raw.split(/[,，;；/|\s#\[\]"']+/)) {
    const clean = tok.trim();
    if (!clean || clean.length > 14 || blacklist.test(clean)) continue;
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

function openAnimeInsightsDrawer(hostRoot, ctx, initialTab = "personal") {
  closeAllPopovers();
  const docBody = document.body;
  docBody.querySelectorAll(":scope > .bm7-drawer").forEach((x) => x.remove());

  const themeAttr =
    (hostRoot && hostRoot.getAttribute && hostRoot.getAttribute("data-bm7-theme")) ||
    (ctx && ctx.appearance && ctx.appearance.theme) ||
    "follow";
  const motionAttr =
    (hostRoot && hostRoot.getAttribute && hostRoot.getAttribute("data-bm7-motion")) ||
    (ctx && ctx.appearance && ctx.appearance.motion === false ? "off" : "on");
  const motionTierAttr =
    (hostRoot && hostRoot.getAttribute && hostRoot.getAttribute("data-bm7-motion-tier")) ||
    (motionAttr === "off" ? "off" : "full");

  const drawer = h("div.bm7-root.bm7-drawer", {
    attr: {
      role: "dialog",
      "aria-label": "看番档案详情",
      "data-bm7-theme": themeAttr,
      "data-bm7-motion": motionAttr,
      "data-bm7-motion-tier": motionTierAttr
    }
  });
  const sheet = h("div.bm7-drawer-sheet");
  const close = () => {
    drawer.classList.add("is-leaving");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => drawer.remove(), 200);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  drawer.append(h("div.bm7-drawer-scrim", { on: { click: close } }), sheet);
  sheet.appendChild(iconButton("close", "关闭统计抽屉", close, "bm7-drawer-close"));

  const body = h("div.bm7-drawer-body");
  sheet.appendChild(body);

  const rawDrawerItems = (Array.isArray(ctx && ctx.items) ? ctx.items : []).filter(Boolean);
  const realDrawerItems = rawDrawerItems.filter((it) => !it.isSamplePreviewItem);
  const items = realDrawerItems.length > 0 ? realDrawerItems : rawDrawerItems;
  const events = normalizeEvents(
    ctx && typeof ctx.getEvents === "function" ? ctx.getEvents() : (ctx && ctx.events) || []
  );
  const actions = (ctx && ctx.actions) || {};

  const jumpToCatalog = (query, statusFilter) => {
    close();
    if (typeof actions.openCatalog === "function") {
      actions.openCatalog(query, statusFilter);
    }
  };

  const state = { tab: initialTab === "works" ? "works" : "personal", selectedStateKey: "" };
  const wrap = h("div.bm7-ins");
  const contentBox = h("div.bm7-ins-content", { style: { display: "flex", flexDirection: "column", gap: "18px" } });

  const tabBar = segmented(
    [
      { value: "personal", label: "我的总览", icon: "user" },
      { value: "works", label: "全部筛选与分布", icon: "compass" }
    ],
    state.tab,
    (nextTab) => {
      if (nextTab === state.tab) return;
      const dir = nextTab === "works" ? 1 : -1;
      state.tab = nextTab;
      paperSlipSwap(contentBox, () => paintTab(), { dir });
    }
  );

  wrap.append(
    h("header.bm7-ins-head", [
      h("h3.bm7-ins-title", { text: "看番档案详情" }),
      h("p.bm7-ins-sub", { text: "点击状态分段条可原地展开作品预览；带 ↗ 标记的筛选项将离开当前页，前往「全部番剧」查看结果。" }),
      tabBar
    ]),
    contentBox
  );
  body.appendChild(wrap);

  const paintPersonal = () => {
    const totalCount = items.length;
    const watchingCount = items.filter((x) => x.state === "在看").length;
    const completedCount = items.filter((x) => x.state === "已看").length;
    const plannedCount = items.filter((x) => x.state === "想看").length;
    const droppedCount = items.filter((x) => x.state === "抛弃").length;

    const watchedEps = items.reduce((s, x) => s + (Number(x.watchedEpisodes) || 0), 0);
    const hours = Math.round(watchedEps * 0.4 * 10) / 10;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const myScored = items.filter((x) => myScore(x) !== null);
    const myAvg = myScored.length
      ? myScored.reduce((s, x) => s + myScore(x), 0) / myScored.length
      : null;

    const bothScored = myScored.filter((x) => bgmScore(x) !== null);
    const avgDelta = bothScored.length
      ? bothScored.reduce((s, x) => s + (myScore(x) - bgmScore(x)), 0) / bothScored.length
      : null;

    const totalReviews = items.reduce((s, x) => s + (Array.isArray(x.reviews) ? x.reviews.length : 0), 0);
    const reviewedWorks = items.filter((x) => Array.isArray(x.reviews) && x.reviews.length > 0).length;

    // 活跃星期与时段
    const wdCounts = [0, 0, 0, 0, 0, 0, 0];
    const slotCounts = { 深夜: 0, 上午: 0, 下午: 0, 晚间: 0 };
    let timedCount = 0;
    for (const ev of events) {
      if (!ev._d) continue;
      wdCounts[ev._d.getDay()] += 1;
      const hr = ev._d.getHours();
      const mn = ev._d.getMinutes();
      if (hr !== 0 || mn !== 0) {
        timedCount += 1;
        if (hr < 6) slotCounts.深夜 += 1;
        else if (hr < 12) slotCounts.上午 += 1;
        else if (hr < 18) slotCounts.下午 += 1;
        else slotCounts.晚间 += 1;
      }
    }
    const bestWdIdx = wdCounts.indexOf(Math.max(...wdCounts));
    const bestSlot = Object.entries(slotCounts).sort((a, b) => b[1] - a[1])[0];

    const kpis = h("div.bm7-ins-kpis", [
      h("div.bm7-stat", [
        h("span.bm7-stat-label", { text: "累计观看" }),
        h("span.bm7-stat-value", { text: `${watchedEps} 集` }),
        h("span.bm7-stat-hint", { text: `折合约 ${hours} 小时` })
      ]),
      h("div.bm7-stat", [
        h("span.bm7-stat-label", { text: "完结率" }),
        h("span.bm7-stat-value", { text: `${completionRate}%` }),
        h("span.bm7-stat-hint", { text: `看完 ${completedCount} / 共 ${totalCount} 部` })
      ]),
      h("div.bm7-stat", [
        h("span.bm7-stat-label", { text: "我的均分" }),
        h("span.bm7-stat-value", { text: myAvg !== null ? myAvg.toFixed(2) : "—" }),
        h("span.bm7-stat-hint", {
          text:
            avgDelta !== null
              ? `较 Bangumi 均分 ${avgDelta >= 0 ? `+${avgDelta.toFixed(2)}` : avgDelta.toFixed(2)}`
              : `已打分 ${myScored.length} 部`
        })
      ]),
      h("div.bm7-stat", [
        h("span.bm7-stat-label", { text: "观片手札" }),
        h("span.bm7-stat-value", { text: `${totalReviews} 条` }),
        h("span.bm7-stat-hint", { text: `覆盖 ${reviewedWorks} 部作品` })
      ])
    ]);

    const stateDefs = [
      { key: "在看", label: "在看", count: watchingCount, color: "var(--bm7-accent)" },
      { key: "已看", label: "已看", count: completedCount, color: "var(--bm7-ok)" },
      { key: "想看", label: "想看", count: plannedCount, color: "var(--bm7-gold)" },
      { key: "抛弃", label: "搁置", count: droppedCount, color: "var(--bm7-ink-3)" }
    ];

    const statePreviewSlot = h("div.bm8-ins-state-slot");
    const renderStatePreview = () => {
      clear(statePreviewSlot);
      const curDef = stateDefs.find((d) => d.key === state.selectedStateKey);
      if (!curDef) return;
      const matched = items.filter((it) => it.state === curDef.key);
      statePreviewSlot.appendChild(
        h("div.bm8-inline-FocusTray", [
          h("div.bm8-inline-tray-head", [
            h("span.bm8-inline-tray-title", { text: `${curDef.label} · 共 ${matched.length} 部` }),
            h("button.bm8-inline-tray-close", {
              attr: { type: "button", title: "收起预览" },
              on: {
                click: () => {
                  state.selectedStateKey = "";
                  syncStateSelection();
                  scrollUnrollMorph(stateSec, () => renderStatePreview());
                }
              }
            }, [icon("close", 12)])
          ]),
          matched.length
            ? h(
                "div.bm8-inline-tray-chips",
                matched.slice(0, 8).map((it) =>
                  h("button.bm8-inline-work-chip", {
                    attr: { type: "button", title: `打开《${it.name}》笔记` },
                    text: `《${it.name}》`,
                    on: {
                      click: () => {
                        close();
                        actions.openNote && actions.openNote(it);
                      }
                    }
                  })
                )
              )
            : h("div.bm8-inline-tray-empty", { text: `当前没有「${curDef.label}」状态的作品。` }),
          h("div.bm8-inline-tray-foot", [
            createPageJumpLink(
              `前往全部番剧查看全部 ${curDef.count} 部`,
              () => jumpToCatalog("", curDef.key),
              { hint: `离开当前页并关闭抽屉，前往「全部番剧」筛选「${curDef.label}」` }
            )
          ])
        ])
      );
    };

    const toggleStatePreview = (key) => {
      state.selectedStateKey = state.selectedStateKey === key ? "" : key;
      syncStateSelection();
      scrollUnrollMorph(stateSec, () => renderStatePreview());
    };

    const stateSec = h("section.bm7-ins-sec", [
      h("div.bm7-ins-sec-head", [
        h("h4.bm7-ins-sec-title", { text: "收藏状态构成" }),
        h("span.bm7-ins-sec-hint", { text: "点击分段条或胶囊原地预览作品" })
      ]),
      totalCount > 0
        ? h(
            "div.bm7-ins-state-bar",
            stateDefs
              .filter((s) => s.count > 0)
              .map((s) =>
                h("button.bm7-ins-state-seg.is-interactive", {
                  attr: { type: "button", title: `${s.label} ${s.count} 部（点击展开作品预览）` },
                  dataset: { stateKey: s.key },
                  style: { width: `${Math.max(4, (s.count / totalCount) * 100)}%`, background: s.color },
                  on: { click: () => toggleStatePreview(s.key) }
                })
              )
          )
        : null,
      h(
        "div.bm7-ins-state-pills",
        stateDefs.map((s) =>
          h(
            "button.bm7-ins-pill",
            {
              attr: { type: "button", title: `点击预览「${s.label}」作品` },
              dataset: { stateKey: s.key },
              on: { click: () => toggleStatePreview(s.key) }
            },
            [h("span", { text: s.label }), h("span.bm7-ins-pill-count", { text: `${s.count} 部` })]
          )
        )
      ),
      statePreviewSlot
    ]);

    function syncStateSelection() {
      stateSec.querySelectorAll("[data-state-key]").forEach((el) => {
        el.classList.toggle("is-selected", el.dataset.stateKey === state.selectedStateKey);
      });
    }
    syncStateSelection();
    renderStatePreview();

    const habitLine =
      events.length > 0
        ? `${WEEKDAY_CN[bestWdIdx]}记录最多${timedCount > 0 && bestSlot ? ` · 常在${bestSlot[0]}看番` : ""}`
        : "记录看番进度或手札后，会自动汇总常看时段";

    const topFavorites = [...myScored]
      .sort((a, b) => myScore(b) - myScore(a) || (bgmScore(b) || 0) - (bgmScore(a) || 0))
      .slice(0, 6);

    const favSec = h("section.bm7-ins-sec", [
      h("div.bm7-ins-sec-head", [
        h("h4.bm7-ins-sec-title", { text: "个人高分偏爱" }),
        h("span.bm7-ins-sec-hint", { text: habitLine })
      ]),
      topFavorites.length
        ? h(
            "div.bm7-ins-bars",
            topFavorites.map((it) => {
              const ms = myScore(it);
              const bs = bgmScore(it);
              const diff = bs !== null ? ms - bs : null;
              return h(
                "button.bm7-ins-row",
                {
                  attr: { type: "button", title: `打开《${it.name}》笔记` },
                  on: {
                    click: () => {
                      close();
                      actions.openNote && actions.openNote(it);
                    }
                  }
                },
                [
                  h("span.bm7-ins-row-name", { text: it.name }),
                  h("span.bm7-ins-row-track", [
                    h("span.bm7-ins-row-fill", { style: { width: `${Math.min(100, ms * 10)}%` } })
                  ]),
                  h("span.bm7-ins-row-val", {
                    text:
                      diff !== null && Math.abs(diff) >= 0.4
                        ? `${ms.toFixed(1)} (${diff > 0 ? "+" : ""}${diff.toFixed(1)})`
                        : `${ms.toFixed(1)} 分`
                  })
                ]
              );
            })
          )
        : emptyState("给看过的作品打分后，这里会列出你最偏爱的高分佳作。")
    ]);

    contentBox.append(kpis, stateSec, favSec);
  };

  const paintWorks = () => {
    // 1. 常看动画公司 Top 10
    const studioMap = new Map();
    for (const it of items) {
      const raw = String(it.studio || "").trim();
      if (!raw || raw === "未知" || raw === "未填写") continue;
      for (const part of raw.split(/[,，、/]+/)) {
        const name = part.trim();
        if (!name) continue;
        const rec = studioMap.get(name) || { name, count: 0, scoreSum: 0, scoreN: 0 };
        rec.count += 1;
        const sc = myScore(it) ?? bgmScore(it);
        if (sc !== null) {
          rec.scoreSum += sc;
          rec.scoreN += 1;
        }
        studioMap.set(name, rec);
      }
    }
    const topStudios = Array.from(studioMap.values())
      .sort((a, b) => b.count - a.count || b.scoreSum / Math.max(1, b.scoreN) - a.scoreSum / Math.max(1, a.scoreN))
      .slice(0, 8);
    const maxStudio = Math.max(1, ...(topStudios.map((s) => s.count)));

    const studioSec = h("section.bm7-ins-sec", [
      h("div.bm7-ins-sec-head", [
        h("h4.bm7-ins-sec-title", { text: "常看动画公司" }),
        h("span.bm7-ins-sec-hint", { text: "点击前往「全部番剧」按制作公司筛选 ↗" })
      ]),
      topStudios.length
        ? h(
            "div.bm7-ins-bars",
            topStudios.map((st) =>
              h(
                "button.bm7-ins-row",
                {
                  attr: { type: "button", title: `离开当前页，前往「全部番剧」筛选「${st.name}」制作的动画` },
                  on: { click: () => jumpToCatalog(st.name, "all") }
                },
                [
                  h("span.bm7-ins-row-name", { text: st.name }),
                  h("span.bm7-ins-row-track", [
                    h("span.bm7-ins-row-fill", { style: { width: `${Math.max(8, (st.count / maxStudio) * 100)}%` } })
                  ]),
                  h("span.bm7-ins-row-val", [
                    `${st.count} 部${st.scoreN ? ` · ★${(st.scoreSum / st.scoreN).toFixed(1)}` : ""} `,
                    icon("arrowUpRight", 11)
                  ])
                ]
              )
            )
          )
        : emptyState("笔记中包含动画制作公司信息后，会自动统计常看厂牌。")
    ]);

    // 2. 年份与档期分布
    const yearMap = new Map();
    const seasonCounts = { "01": 0, "04": 0, "07": 0, "10": 0 };
    for (const it of items) {
      const y = String(it.year || "").match(/\d{4}/);
      if (y) yearMap.set(y[0], (yearMap.get(y[0]) || 0) + 1);
      const sm = normalizeSeasonMonth(it.season);
      if (sm && seasonCounts[sm] !== undefined) seasonCounts[sm] += 1;
    }
    const topYears = Array.from(yearMap.entries())
      .sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))
      .slice(0, 7);
    const maxYear = Math.max(1, ...topYears.map((x) => x[1]));

    const yearSec = h("section.bm7-ins-sec", [
      h("div.bm7-ins-sec-head", [
        h("h4.bm7-ins-sec-title", { text: "开播年份与季度档期" }),
        h("span.bm7-ins-sec-hint", { text: "点击前往「全部番剧」筛选对应档期 ↗" })
      ]),
      h("div.bm7-ins-state-pills", [
        ...[
          { sm: "01", label: "1月冬季档", q: "1月" },
          { sm: "04", label: "4月春季档", q: "4月" },
          { sm: "07", label: "7月夏季档", q: "7月" },
          { sm: "10", label: "10月秋季档", q: "10月" }
        ].map((sd) =>
          h(
            "button.bm7-ins-pill",
            {
              attr: { type: "button", title: `离开当前页，前往「全部番剧」筛选「${sd.label}」` },
              on: { click: () => jumpToCatalog(sd.q, "all") }
            },
            [
              h("span", { text: sd.label }),
              h("span.bm7-ins-pill-count", { text: `${seasonCounts[sd.sm]} 部` }),
              icon("arrowUpRight", 11)
            ]
          )
        )
      ]),
      topYears.length
        ? h(
            "div.bm7-ins-bars",
            topYears.map(([yr, cnt]) =>
              h(
                "button.bm7-ins-row",
                {
                  attr: { type: "button", title: `离开当前页，前往「全部番剧」筛选 ${yr} 年开播的动画` },
                  on: { click: () => jumpToCatalog(yr, "all") }
                },
                [
                  h("span.bm7-ins-row-name", { text: `${yr} 年` }),
                  h("span.bm7-ins-row-track", [
                    h("span.bm7-ins-row-fill", { style: { width: `${Math.max(8, (cnt / maxYear) * 100)}%` } })
                  ]),
                  h("span.bm7-ins-row-val", [`${cnt} 部 `, icon("arrowUpRight", 11)])
                ]
              )
            )
          )
        : null
    ]);

    // 3. 载体与改编来源 + 高频题材标签云
    const tagMap = new Map();
    const adaptCounts = { 原创: 0, 漫改: 0, 轻改: 0, 游戏改: 0 };
    const formatCounts = new Map();
    for (const it of items) {
      const fmt = String(it.animeType || "").trim();
      if (fmt && fmt !== "未知") formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1);
      const tlist = collectCleanTagsForInsights(it);
      const joined = tlist.join(" ");
      if (/原创/.test(joined)) adaptCounts.原创 += 1;
      if (/漫改|漫画改/.test(joined)) adaptCounts.漫改 += 1;
      if (/轻改|轻小说改|小说改/.test(joined)) adaptCounts.轻改 += 1;
      if (/游戏改|GAL改/i.test(joined)) adaptCounts.游戏改 += 1;
      for (const tg of tlist) {
        if (/^(?:原创|漫改|漫画改|轻改|轻小说改|小说改|游戏改|GAL改)$/i.test(tg)) continue;
        tagMap.set(tg, (tagMap.get(tg) || 0) + 1);
      }
    }
    const topTags = Array.from(tagMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24);

    const metaPills = [
      ...Array.from(formatCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => ({ label: k, count: v, query: k })),
      ...Object.entries(adaptCounts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ label: k, count: v, query: k }))
    ];

    const tagSec = h("section.bm7-ins-sec", [
      h("div.bm7-ins-sec-head", [
        h("h4.bm7-ins-sec-title", { text: "题材标签与改编类型" }),
        h("span.bm7-ins-sec-hint", { text: "点击任意标签前往「全部番剧」筛选 ↗" })
      ]),
      metaPills.length
        ? h(
            "div.bm7-ins-state-pills",
            metaPills.map((mp) =>
              h(
                "button.bm7-ins-pill",
                {
                  attr: { type: "button", title: `离开当前页，前往「全部番剧」筛选「${mp.label}」` },
                  on: { click: () => jumpToCatalog(mp.query, "all") }
                },
                [
                  h("span", { text: mp.label }),
                  h("span.bm7-ins-pill-count", { text: String(mp.count) }),
                  icon("arrowUpRight", 11)
                ]
              )
            )
          )
        : null,
      topTags.length
        ? h(
            "div.bm7-ins-tags",
            topTags.map(([tg, cnt]) =>
              h(
                "button.bm7-ins-pill",
                {
                  attr: { type: "button", title: `离开当前页，前往「全部番剧」筛选带有「${tg}」标签的作品` },
                  on: { click: () => jumpToCatalog(tg, "all") }
                },
                [
                  h("span", { text: tg }),
                  h("span.bm7-ins-pill-count", { text: String(cnt) }),
                  icon("arrowUpRight", 11)
                ]
              )
            )
          )
        : emptyState("同步 Bangumi 标签后，这里会生成可点击筛选的题材标签云。")
    ]);

    contentBox.append(studioSec, yearSec, tagSec);
  };

  const paintTab = () => {
    clear(contentBox);
    if (state.tab === "works") paintWorks();
    else paintPersonal();
  };
  paintTab();

  docBody.appendChild(drawer);
  document.addEventListener("keydown", onKey, true);
  return { close };
}

/* ============================== 番剧首屏主渲染 ============================== */

function renderAnimeStage(host, ctx) {
  clear(host);
  const { desktop } = platformInfo();
  let items = Array.isArray(ctx.items) ? ctx.items : [];
  let events = normalizeEvents(typeof ctx.getEvents === "function" ? ctx.getEvents() : ctx.events || []);
  const getCover = ctx.getCover || ((it) => it.cover);
  const getKey = ctx.getKey || ((it) => (it.subjectId ? String(it.subjectId) : (it.file && it.file.path) || it.name));
  const getLocal = (it) => (desktop && ctx.getLocal ? ctx.getLocal(it) : null);
  const getWatchUrl = ctx.getWatchUrl || ((it) => it.watchUrl || "");
  const getBgmUrl =
    ctx.getBgmUrl ||
    ((it) => (it && it.bgmUrl) || (it && it.subjectId ? `https://bgm.tv/subject/${it.subjectId}` : ""));
  const classifyWatch =
    ctx.classifyWatch ||
    ((it) => {
      const u = String(getWatchUrl(it) || "").trim();
      if (!u) return { kind: "none", label: "", url: "" };
      if (/bgm\.tv\/subject\/|bangumi\.tv\/subject\/|chii\.in\/subject\//i.test(u)) {
        return { kind: "bangumi_info", label: "Bangumi 详情", url: u };
      }
      if (/bilibili\.com|b23\.tv/i.test(u)) {
        return { kind: "streaming", siteLabel: "B站", label: "去B站看", url: u };
      }
      return { kind: "streaming", siteLabel: "", label: "打开播放页", url: u };
    });
  const actions = ctx.actions || {};
  const themeRoot = ctx.themeRoot || host.closest(".curator-desk-root") || host;
  applyTheme(themeRoot, ctx.appearance);
  const appearance = ctx.appearance || {};

  // 最近活动时间：事件优先，其次笔记修改时间
  const lastActive = new Map();
  const activity = (it) => lastActive.get(getKey(it)) || (it.file && it.file.stat && it.file.stat.mtime) || 0;

  let watchingPool = [];
  let downloadedPool = [];
  let seasonalPool = [];
  let targetSeasonYear = "";
  let targetSeasonMonth = "";

  const spotByScene = { watching: 0, downloaded: 0, seasonal: 0 };
  const currentHeroKeyByScene = { watching: null, downloaded: null, seasonal: null };
  let quipOpenForKey = null;
  let mutationSeq = 0;

  const sceneDefs = [
    {
      value: "watching",
      label: "继续看",
      count: 0,
      pool: [],
      emptyTitle: "现在没有正在看的番",
      emptySub:
        "可以在下方「随机看一集」里从想看列表中抽一部开看，或切换到「当季番」看看最近收录的作品。"
    },
    {
      value: "downloaded",
      label: "刚下载",
      count: 0,
      pool: [],
      emptyTitle: desktop ? "本地文件夹还没有待看的新集数" : "移动端暂不扫描电脑本地目录",
      emptySub: desktop
        ? "为追更中的作品绑定本地番剧目录或开启 RSS 自动追更后，下好的新集数会自动出现在这里。"
        : "在电脑端绑定本地番剧目录后，这里会自动列出刚下载好还没看的剧集。"
    },
    {
      value: "seasonal",
      label: "当季番",
      count: 0,
      pool: [],
      seasonHint: "",
      emptyTitle: "还没有当季开播的收藏作品",
      emptySub: "在顶栏导入或搜索添加本季新番后，这里会按开播档期集中呈现。"
    }
  ];

  const recomputePools = (preserveHeroKey = true) => {
    lastActive.clear();
    for (const ev of events) if (ev.key && !lastActive.has(ev.key)) lastActive.set(ev.key, ev._d.getTime());

    watchingPool = items.filter((it) => it.state === "在看").sort((a, b) => activity(b) - activity(a));

    downloadedPool = items
      .filter((it) => {
        if (it.state === "已看" || it.state === "抛弃") return false;
        const loc = getLocal(it);
        if (!loc) return false;
        const w = Number(it.watchedEpisodes) || 0;
        return Boolean(loc.nextEpisodeFile || (Number(loc.newCount) || 0) > 0 || (Number(loc.maxLocalEpisode) || 0) > w);
      })
      .sort((a, b) => {
        const la = getLocal(a);
        const lb = getLocal(b);
        const na = (la && Number(la.newCount)) || 0;
        const nb = (lb && Number(lb.newCount)) || 0;
        return nb - na || activity(b) - activity(a);
      });

    const curSeason = ctx.currentSeasonInfo || { year: new Date().getFullYear(), seasonMonth: "10" };
    targetSeasonYear = String(curSeason.year);
    targetSeasonMonth = String(curSeason.seasonMonth || "10").padStart(2, "0");
    seasonalPool = items.filter(
      (it) => String(it.year || "") === targetSeasonYear && normalizeSeasonMonth(it.season) === targetSeasonMonth
    );
    if (!seasonalPool.length) {
      const bucketMap = new Map();
      for (const it of items) {
        const yr = String(it.year || "").match(/^\d{4}$/);
        if (!yr) continue;
        const sm = normalizeSeasonMonth(it.season) || "00";
        const bKey = `${yr[0]}-${sm}`;
        if (!bucketMap.has(bKey)) bucketMap.set(bKey, []);
        bucketMap.get(bKey).push(it);
      }
      const latestKey = Array.from(bucketMap.keys()).sort((a, b) => b.localeCompare(a))[0];
      if (latestKey) {
        const [ly, lsm] = latestKey.split("-");
        targetSeasonYear = ly;
        targetSeasonMonth = lsm === "00" ? "" : lsm;
        seasonalPool = bucketMap.get(latestKey) || [];
      }
    }
    seasonalPool = [...seasonalPool].sort((a, b) => {
      const wa = a.state === "在看" ? 2 : a.state === "想看" ? 1 : 0;
      const wb = b.state === "在看" ? 2 : b.state === "想看" ? 1 : 0;
      return wb - wa || activity(b) - activity(a);
    });

    sceneDefs[0].count = watchingPool.length;
    sceneDefs[0].pool = watchingPool;
    sceneDefs[0].emptyTitle = items.length ? "现在没有正在看的番" : "还没有登记动画";
    sceneDefs[0].emptySub = items.length
      ? "可以在下方「随机看一集」里从想看列表中抽一部开看，或切换到「当季番」看看最近收录的作品。"
      : "添加第一部动画后，这里会展示正在追看的进度、本地剧集和随手吐槽。";

    sceneDefs[1].count = downloadedPool.length;
    sceneDefs[1].pool = downloadedPool;

    sceneDefs[2].count = seasonalPool.length;
    sceneDefs[2].pool = seasonalPool;
    sceneDefs[2].seasonHint = seasonDisplayLabel(targetSeasonYear, targetSeasonMonth);

    for (const sc of sceneDefs) {
      const p = sc.pool;
      if (!p.length) {
        spotByScene[sc.value] = 0;
        currentHeroKeyByScene[sc.value] = null;
        continue;
      }
      const pinned = preserveHeroKey ? currentHeroKeyByScene[sc.value] : null;
      if (pinned) {
        const foundIdx = p.findIndex((x) => getKey(x) === pinned);
        if (foundIdx >= 0) {
          spotByScene[sc.value] = foundIdx;
          continue;
        }
      }
      spotByScene[sc.value] = Math.max(0, Math.min(spotByScene[sc.value] || 0, p.length - 1));
    }
  };

  recomputePools(false);

  let activeScene = sceneDefs.some((s) => s.value === ctx.heroScene) ? ctx.heroScene : "watching";
  const initialDef = sceneDefs.find((s) => s.value === activeScene);
  if (initialDef && initialDef.pool.length === 0) {
    const nonEmpty = sceneDefs.find((s) => s.pool.length > 0);
    if (nonEmpty) activeScene = nonEmpty.value;
  }

  const stage = h("div.bm7-stage");
  const grid = h("div.bm7-stage-grid");
  stage.appendChild(grid);
  host.appendChild(stage);

  /* ---------------- 1. 焦点舞台：继续看 · 刚下载 · 当季番 ---------------- */
  const heroArea = h("section.bm7-area-hero");
  grid.appendChild(heroArea);

  let applyItemMutation = () => {};

  const openRatingPopover = (anchorBtn, item, onUpdated) => {
    const cur = myScore(item);
    popover(
      anchorBtn,
      (box, close) => {
        const valSpan = h("span.bm7-rate-val", { text: cur !== null ? `${cur.toFixed(1)} 分` : "未打分" });
        const wrap = h("div.bm7-rate-box", [
          h("div.bm7-rate-head", [
            h("span.bm7-pop-title", { style: { padding: "0" }, text: "我的评分（1–10 分）" }),
            valSpan
          ]),
          h(
            "div.bm7-rate-stars",
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
              h("button.bm7-rate-chip", {
                cls: cur !== null && Math.round(cur) === n ? "is-active" : "",
                attr: { type: "button" },
                text: String(n),
                on: {
                  mouseenter: () => {
                    valSpan.textContent = `${n}.0 分`;
                  },
                  mouseleave: () => {
                    valSpan.textContent = cur !== null ? `${cur.toFixed(1)} 分` : "未打分";
                  },
                  click: async () => {
                    close();
                    const seqBefore = mutationSeq;
                    if (actions.setScore) await actions.setScore(item, n);
                    item.personalScore = n;
                    if (mutationSeq === seqBefore) applyItemMutation(item, { score: n });
                    else if (onUpdated) onUpdated();
                  }
                }
              })
            )
          ),
          cur !== null
            ? menuItem("close", "清除我的评分", async () => {
                close();
                const seqBefore = mutationSeq;
                if (actions.setScore) await actions.setScore(item, "");
                item.personalScore = null;
                if (mutationSeq === seqBefore) applyItemMutation(item, { score: null });
                else if (onUpdated) onUpdated();
              })
            : null
        ]);
        box.appendChild(wrap);
      },
      { width: 258, alignRight: true }
    );
  };

  const openHeroMoreMenu = (anchorBtn, item, info, bgmUrl, watchMeta, onUpdated) => {
    popover(
      anchorBtn,
      (box, close) => {
        box.appendChild(h("div.bm7-pop-title", { text: `《${item.name}》操作` }));

        if (info.watched > 0 && actions.stepBack) {
          box.appendChild(
            menuItem("undo", `撤回一集进度（回到第 ${info.watched - 1} 集）`, async () => {
              close();
              const seqBefore = mutationSeq;
              const before = Number(item.watchedEpisodes) || 0;
              await actions.stepBack(item);
              if ((Number(item.watchedEpisodes) || 0) === before) {
                item.watchedEpisodes = Math.max(0, before - 1);
              }
              if (mutationSeq === seqBefore) applyItemMutation(item, { watchedEpisodes: item.watchedEpisodes });
              else if (onUpdated) onUpdated();
            })
          );
        }

        if (actions.openReviews) {
          box.appendChild(
            menuItem("pen", "打开完整观片手札（支持截图与长评）", () => {
              close();
              actions.openReviews(item);
            })
          );
        }

        if (desktop && item.downloadPath && item.downloadPath !== "无" && actions.openFolder) {
          box.appendChild(
            menuItem("folder", "打开本地番剧文件夹", () => {
              close();
              actions.openFolder(item);
            })
          );
        }

        if (item.subjectId && actions.openTrend) {
          box.appendChild(
            menuItem("trend", "查看 Bangumi 评分走势", () => {
              close();
              actions.openTrend(item);
            })
          );
        }

        if (actions.openRelations) {
          box.appendChild(
            menuItem("wand", "关联角色、画集与游戏", () => {
              close();
              actions.openRelations(item);
            })
          );
        }

        if (bgmUrl && actions.openWeb) {
          box.appendChild(
            menuItem("link", "查看 Bangumi 条目详情", () => {
              close();
              actions.openWeb(item, bgmUrl);
            })
          );
        }

        if (watchMeta && watchMeta.kind === "streaming" && watchMeta.url && actions.openWeb) {
          box.appendChild(
            menuItem("play", watchMeta.siteLabel ? `打开 ${watchMeta.siteLabel} 播放页` : "打开在线播放页", () => {
              close();
              actions.openWeb(item, watchMeta.url);
            })
          );
        }

        if (actions.openNote) {
          box.appendChild(
            menuItem("note", "打开 Markdown 笔记", () => {
              close();
              actions.openNote(item);
            })
          );
        }

        if (actions.setState) {
          box.appendChild(h("div.bm7-pop-title", { style: { marginTop: "6px" }, text: "切换状态" }));
          [
            { state: "在看", label: "设为在看" },
            { state: "已看", label: "标为已看" },
            { state: "想看", label: "移入想看" },
            { state: "抛弃", label: "移入搁置" }
          ]
            .filter((st) => st.state !== item.state)
            .forEach((st) => {
              box.appendChild(
                menuItem("check", st.label, async () => {
                  close();
                  const seqBefore = mutationSeq;
                  await actions.setState(item, st.state);
                  item.state = st.state;
                  if (mutationSeq === seqBefore) applyItemMutation(item, { state: st.state });
                  else if (onUpdated) onUpdated();
                })
              );
            });
        }
      },
      { width: 268, alignRight: true }
    );
  };

  const buildSceneTabs = () =>
    segmented(
      sceneDefs.map((s) => ({
        value: s.value,
        label: s.label,
        count: s.count
      })),
      activeScene,
      (nextVal) => {
        if (nextVal === activeScene) return;
        const prevIdx = sceneDefs.findIndex((s) => s.value === activeScene);
        const nextIdx = sceneDefs.findIndex((s) => s.value === nextVal);
        const dir = nextIdx >= prevIdx ? 1 : -1;
        activeScene = nextVal;
        quipOpenForKey = null;
        if (typeof ctx.onHeroSceneChange === "function") ctx.onHeroSceneChange(nextVal);
        paintHero({ animate: true, transition: "ink", dir });
      },
      "is-small bm7-hero-tabs"
    );

  const syncPlateBadges = (plateEl, pScore, pubScore) => {
    let myBadge = plateEl.querySelector(":scope > .bm7-hero-myscore");
    if (pScore !== null) {
      if (!myBadge) {
        myBadge = h("span.bm7-hero-myscore");
        plateEl.appendChild(myBadge);
      }
      myBadge.title = `我的评分 ${pScore.toFixed(1)}`;
      myBadge.textContent = `★ ${pScore.toFixed(1)}`;
    } else if (myBadge) {
      myBadge.remove();
    }

    let pubBadge = plateEl.querySelector(":scope > .bm7-hero-score");
    if (pubScore !== null) {
      if (!pubBadge) {
        pubBadge = h("span.bm7-hero-score", { title: "Bangumi 评分" });
        plateEl.appendChild(pubBadge);
      }
      pubBadge.textContent = pubScore.toFixed(1);
    } else if (pubBadge) {
      pubBadge.remove();
    }
  };

  const buildOrUpdateRail = (existingRail, curDef, pool, spotIdx) => {
    const rail = existingRail || h("nav.bm7-hero-rail");
    rail.setAttribute("aria-label", `${curDef.label}列表`);

    const reusableByKey = new Map();
    if (existingRail) {
      existingRail.querySelectorAll(":scope > button.bm7-rail-item[data-rail-key]").forEach((btn) => {
        reusableByKey.set(btn.dataset.railKey, btn);
      });
      existingRail.querySelectorAll(":scope > button.bm7-rail-more").forEach((btn) => btn.remove());
    }

    const visibleSlice = pool.slice(0, 10);
    const usedNodes = new Set();

    visibleSlice.forEach((it, idx) => {
      const rKey = getKey(it);
      const w = Number(it.watchedEpisodes) || 0;
      const t = parseInt(it.totalEpisodes, 10) || 0;
      const isAct = idx === spotIdx;
      let btn = reusableByKey.get(rKey);

      if (!btn) {
        btn = h(
          "button.bm7-rail-item",
          {
            attr: {
              type: "button",
              "data-rail-key": rKey
            }
          },
          [coverEl(getCover(it), it.name)]
        );
        btn.addEventListener("click", () => {
          const targetIdx = Number(btn._railIdx) || 0;
          if (targetIdx === spotByScene[activeScene]) return;
          const dir = targetIdx >= (spotByScene[activeScene] || 0) ? 1 : -1;
          spotByScene[activeScene] = targetIdx;
          if (btn._railItem) currentHeroKeyByScene[activeScene] = getKey(btn._railItem);
          quipOpenForKey = null;
          paintHero({ animate: true, transition: "ink", dir });
        });
      }

      btn._railIdx = idx;
      btn._railItem = it;
      btn.classList.toggle("is-active", isAct);
      btn.title = `${it.name} · 已看 ${w} 集`;
      btn.setAttribute("aria-current", isAct ? "true" : "false");

      let prog = btn.querySelector(":scope > .bm7-rail-prog");
      if (t > 0) {
        const pct = `${Math.min(100, (w / t) * 100)}%`;
        if (!prog) {
          prog = h("span.bm7-rail-prog", [h("span", { style: { width: pct } })]);
          btn.appendChild(prog);
        } else if (prog.firstElementChild) {
          prog.firstElementChild.style.width = pct;
        }
      } else if (prog) {
        prog.remove();
      }

      usedNodes.add(btn);
      rail.appendChild(btn);
    });

    reusableByKey.forEach((btn) => {
      if (!usedNodes.has(btn)) btn.remove();
    });

    if (pool.length > 10) {
      rail.appendChild(
        h("button.bm7-rail-more", {
          attr: { type: "button", title: "离开当前页，前往「全部番剧」查看完整列表" },
          text: `+${pool.length - 10} ↗`,
          on: {
            click: () =>
              actions.openCatalog &&
              actions.openCatalog("", activeScene === "watching" ? "在看" : "all")
          }
        })
      );
    }
    return rail;
  };

  const paintHero = (rawOpts) => {
    const opts =
      typeof rawOpts === "boolean"
        ? rawOpts
          ? { animate: true }
          : { inPlace: true }
        : rawOpts || {};

    const renderHeroDom = (allowInPlace) => {
      const curDef = sceneDefs.find((s) => s.value === activeScene) || sceneDefs[0];
      const pool = curDef.pool || [];

      if (!pool.length) {
        clear(heroArea);
        heroArea.appendChild(
          h("div.bm7-hero.is-empty", [
            h("div.bm7-hero-empty", [
              h("div.bm7-hero-head", { style: { width: "100%" } }, [
                buildSceneTabs(),
                curDef.seasonHint ? h("span.bm7-kicker-dim", { text: curDef.seasonHint }) : null
              ]),
              h("h2.bm7-hero-title", { text: curDef.emptyTitle }),
              h("p.bm7-hero-sub", {
                style: { whiteSpace: "normal", lineHeight: "1.55" },
                text: curDef.emptySub
              }),
              h("div.bm7-hero-actions", [
                items.length
                  ? button("前往全部番剧", {
                      icon: "arrowUpRight",
                      variant: "primary",
                      title: "离开当前页，前往「全部番剧」查看所有收录作品",
                      onClick: () => actions.openCatalog && actions.openCatalog("", "all")
                    })
                  : null
              ])
            ])
          ])
        );
        if (themeRoot._bm8GlowMotion) themeRoot._bm8GlowMotion.refresh();
        return;
      }

      const spotIdx = Math.min(spotByScene[activeScene] || 0, pool.length - 1);
      spotByScene[activeScene] = spotIdx;
      const item = pool[spotIdx] || pool[0];
      const key = getKey(item);
      currentHeroKeyByScene[activeScene] = key;
      const local = getLocal(item);
      const info = epInfo(item, local);
      const coverUrl = getCover(item);
      const bgmUrl = getBgmUrl(item);
      const watchMeta = classifyWatch(item);

      const curThemeAttr = themeRoot.getAttribute("data-bm7-theme");
      if ((curThemeAttr === "glow" || curThemeAttr === "follow") && themeRoot._bm8LastGlowCover !== coverUrl) {
        themeRoot._bm8LastGlowCover = coverUrl;
        setGlowBackdrop(themeRoot, coverUrl, item.name);
      }

      const metaBits = [
        activeScene !== "watching" && item.state ? (item.state === "抛弃" ? "搁置" : item.state) : "",
        item.year ? `${item.year}${item.season ? ` · ${String(item.season).replace(/新番$/, "")}` : ""}` : "",
        item.studio ? String(item.studio).split(/[,，、/]/)[0].trim() : "",
        item.animeType || ""
      ].filter(Boolean);

      const pubScore = bgmScore(item);
      const pScore = myScore(item);
      const reviewsList = Array.isArray(item.reviews) ? item.reviews : [];
      const lastReview = reviewsList.length ? reviewsList[reviewsList.length - 1] : null;
      const lastAt = activity(item);

      // 100% 诚实按钮标签（最多 2 个直露文字按钮，严禁将 Bangumi 条目页标为“去网页看第 X 集”）
      const buildMarkNextBtn = (isPrimary) =>
        button(`看完第 ${info.next} 集`, {
          icon: "check",
          variant: isPrimary ? "primary" : "",
          onClick: async (e) => {
            const btnEl = e.currentTarget;
            if (btnEl) btnEl.disabled = true;
            const seqBefore = mutationSeq;
            const before = Number(item.watchedEpisodes) || 0;
            try {
              if (actions.markNext) await actions.markNext(item);
              if ((Number(item.watchedEpisodes) || 0) === before) item.watchedEpisodes = before + 1;
            } finally {
              if (mutationSeq === seqBefore) {
                applyItemMutation(item, { watchedEpisodes: item.watchedEpisodes });
              }
            }
          }
        });

      let primaryBtn = null;
      let secondaryBtn = null;

      if (info.next && info.hasLocalNext && actions.play) {
        primaryBtn = button(`播放第 ${info.next} 集`, {
          icon: "play",
          variant: "primary",
          onClick: () => actions.play(item, local, info.next)
        });
        secondaryBtn = buildMarkNextBtn(false);
      } else if (info.next && watchMeta.kind === "streaming" && watchMeta.url && actions.openWeb) {
        const streamLabel = watchMeta.siteLabel
          ? `去${watchMeta.siteLabel}看第 ${info.next} 集`
          : `打开播放页 · 第 ${info.next} 集`;
        primaryBtn = button(streamLabel, {
          icon: "play",
          variant: "primary",
          onClick: () => actions.openWeb(item, watchMeta.url)
        });
        secondaryBtn = buildMarkNextBtn(false);
      } else if (info.next) {
        primaryBtn = buildMarkNextBtn(true);
        secondaryBtn = button("打开笔记", {
          icon: "note",
          onClick: () => actions.openNote && actions.openNote(item)
        });
      } else {
        primaryBtn = button("观片手札", {
          icon: "pen",
          variant: "primary",
          onClick: () => (actions.openReviews ? actions.openReviews(item) : actions.openNote && actions.openNote(item))
        });
        secondaryBtn = button("打开笔记", {
          icon: "note",
          onClick: () => actions.openNote && actions.openNote(item)
        });
      }

      // 4 枚单色 1.75px 线性图标工具簇（随手记一句 · 打分 · 下载与追更 · 更多）
      const isQuipOpen = quipOpenForKey === key;
      const quipToggleBtn = iconButton(
        "pen",
        "随手记一句本集观感（写入观片手札）",
        () => {
          quipOpenForKey = quipOpenForKey === key ? null : key;
          paintHero({ inPlace: true });
        },
        isQuipOpen ? "is-active" : ""
      );

      const rateBtn = iconButton(
        "star",
        pScore !== null ? `我的评分 ${pScore.toFixed(1)} 分（点击修改）` : "给这部作品打分",
        (e) => openRatingPopover(e.currentTarget, item, () => paintHero({ inPlace: true })),
        pScore !== null ? "is-active" : ""
      );

      const dlBtn = desktop && actions.openDownload
        ? iconButton(
            "download",
            local && local.newCount > 0 ? `下载与自动追更（本地待看 ${local.newCount} 集）` : "下载与自动追更",
            () => actions.openDownload(item, () => applyItemMutation(item, {}))
          )
        : null;

      const moreBtn = iconButton("more", "更多操作", (e) =>
        openHeroMoreMenu(e.currentTarget, item, info, bgmUrl, watchMeta, () => paintHero({ inPlace: true }))
      );

      // 舞台内嵌「随手记一句」展开条
      let quipBar = null;
      if (isQuipOpen) {
        const targetEp = Math.max(1, info.watched || 1);
        const qInput = h("input.bm7-input", {
          attr: {
            type: "text",
            placeholder: `记一句第 ${targetEp} 集槽点或名场面（开头可带 14:22 时间点，回车保存）…`
          }
        });
        const submitQuip = async () => {
          const val = qInput.value.trim();
          if (!val) return;
          qInput.disabled = true;
          const seqBefore = mutationSeq;
          try {
            if (actions.addQuickQuip) await actions.addQuickQuip(item, targetEp, val);
            quipOpenForKey = null;
          } finally {
            if (mutationSeq === seqBefore) applyItemMutation(item, { reviewsUpdated: true });
            else paintHero({ inPlace: true });
          }
        };
        qInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            submitQuip();
          } else if (e.key === "Escape") {
            quipOpenForKey = null;
            paintHero({ inPlace: true });
          }
        });
        quipBar = h("div.bm7-hero-quip", [
          h("span.bm7-hero-quip-ep", { text: `第 ${targetEp} 集` }),
          qInput,
          button("记入", { variant: "primary", onClick: submitQuip }),
          actions.openReviews
            ? button("图文工作台", {
                variant: "ghost",
                title: "粘贴动画截图、写短评或长评",
                onClick: () => actions.openReviews(item)
              })
            : null
        ]);
        setTimeout(() => qInput.isConnected && qInput.focus(), 20);
      }

      const headSubText =
        activeScene === "seasonal" && curDef.seasonHint
          ? `${curDef.seasonHint} · 第 ${spotIdx + 1} / ${pool.length} 部`
          : pool.length > 1
          ? `第 ${spotIdx + 1} / ${pool.length} 部`
          : "";

      const infoCol = h("div.bm7-hero-info", [
        h("div.bm7-hero-head", [
          buildSceneTabs(),
          headSubText ? h("span.bm7-kicker-dim", { text: headSubText }) : null
        ]),
        h("h2.bm7-hero-title", { text: item.name, title: item.name }),
        item.japaneseName && item.japaneseName !== item.name
          ? h("p.bm7-hero-sub", { text: item.japaneseName })
          : null,
        metaBits.length ? h("div.bm7-chips", metaBits.map((m) => h("span.bm7-chip.is-glass", { text: m }))) : null,
        h("div.bm7-hero-progress", [
          h("div.bm7-hero-progress-text", [
            h("span.bm7-num.bm7-hero-ep", { text: String(info.watched) }),
            h("span", { text: info.total ? ` / ${info.total} 集` : " 集" }),
            info.localMax > info.watched
              ? h("span.bm7-hero-local", [icon("folder", 13), `本地已备至第 ${info.localMax} 集`])
              : null,
            !info.next ? h("span.bm7-hero-local", [icon("flag", 13), "已看完最后一集"]) : null
          ]),
          episodeStrip(info)
        ]),
        h("div.bm7-hero-actions", [
          primaryBtn,
          secondaryBtn,
          h("div.bm7-hero-tools", [quipToggleBtn, rateBtn, dlBtn, moreBtn])
        ]),
        quipBar,
        h("div.bm7-hero-foot", [
          lastAt ? h("span", [icon("clock", 13), `上次更新 ${formatRelative(toDate(lastAt))}`]) : null,
          lastReview && (lastReview.text || lastReview.content)
            ? h("span.bm7-hero-quote", {
                text: `「${String(lastReview.text || lastReview.content).replace(/\s+/g, " ").trim().slice(0, 52)}」`,
                title: String(lastReview.text || lastReview.content).trim()
              })
            : null
        ])
      ]);

      // 原地零闪烁快速更新路径（同场景同番剧推进集数/撤回/打分/记一句时，不销毁封面、背景图与氛围色）
      const existingHero = heroArea.querySelector(":scope > .bm7-hero:not(.is-empty)");
      if (
        allowInPlace &&
        existingHero &&
        existingHero.dataset.heroKey === key &&
        existingHero.dataset.heroScene === activeScene
      ) {
        const existingMain = existingHero.querySelector(":scope > .bm7-hero-main");
        const existingPlate = existingMain && existingMain.querySelector(":scope > .bm7-hero-plate");
        const existingInfo = existingMain && existingMain.querySelector(":scope > .bm7-hero-info");
        if (existingMain && existingPlate && existingInfo) {
          existingPlate._heroItem = item;
          syncPlateBadges(existingPlate, pScore, pubScore);
          existingMain.replaceChild(infoCol, existingInfo);

          const existingRail = existingHero.querySelector(":scope > nav.bm7-hero-rail");
          if (pool.length > 1) {
            const nextRail = buildOrUpdateRail(existingRail, curDef, pool, spotIdx);
            if (!existingRail) existingHero.appendChild(nextRail);
          } else if (existingRail) {
            existingRail.remove();
          }
          return;
        }
      }

      clear(heroArea);
      const enterCls = opts.animate && motionEnabled(host) && opts.transition !== "ink" ? "is-entering" : "";
      const hero = h("div.bm7-hero", {
        cls: enterCls,
        attr: { "data-hero-key": key, "data-hero-scene": activeScene }
      });
      applyAmbient(hero, coverUrl, item.name);
      hero.appendChild(h("div.bm7-hero-backdrop", coverUrl ? { style: { backgroundImage: `url("${coverUrl}")` } } : {}));
      hero.appendChild(h("div.bm7-hero-shade"));

      const plate = h("div.bm7-hero-plate.bm7-hero-cover", [coverEl(coverUrl, item.name)]);
      plate._heroItem = item;
      syncPlateBadges(plate, pScore, pubScore);
      plate.addEventListener("click", () => actions.openNote && actions.openNote(plate._heroItem));

      const main = h("div.bm7-hero-main", [plate, infoCol]);
      hero.appendChild(main);

      if (pool.length > 1) {
        hero.appendChild(buildOrUpdateRail(null, curDef, pool, spotIdx));
      }
      heroArea.appendChild(hero);
      if (themeRoot._bm8GlowMotion) themeRoot._bm8GlowMotion.refresh();
    };

    if (opts.transition === "ink" && motionEnabled(host)) {
      inkPageSwap(heroArea, () => renderHeroDom(false), { dir: opts.dir || 1 });
    } else {
      renderHeroDom(Boolean(opts.inPlace));
    }
  };
  paintHero({ animate: false, inPlace: false });

  /* ---------------- 2. 洛琪希手记专属批注卡（仅手记主题渲染） ---------------- */
  const roxyArea = h("div.bm7-area-roxy");
  grid.appendChild(roxyArea);
  let roxyNoteCtrl = null;
  if (themeRoot.getAttribute("data-bm7-theme") === "roxy" && appearance.roxyArt !== false) {
    roxyNoteCtrl = renderRoxyHandbookCard(roxyArea, {
      items,
      localNewCount: downloadedPool.length,
      collapsed: Boolean(appearance.roxyNoteCollapsed),
      onCollapseChange: (collapsed) => {
        appearance.roxyNoteCollapsed = collapsed;
        if (typeof ctx.onAppearancePatch === "function") {
          ctx.onAppearancePatch({ roxyNoteCollapsed: collapsed });
        }
      }
    });
  }

  /* ---------------- 3. 随机看一集 ---------------- */
  const pickPanel = panel("bm7-area-pick", { title: "随机看一集", sub: "在限定范围里抽一部" });
  grid.appendChild(pickPanel);
  const notDropped = (it) => it.state !== "抛弃";
  renderRandomPicker(pickPanel._body, {
    kind: "anime",
    items,
    scope: ctx.pickScope || "queue",
    onScopeChange: ctx.onPickScopeChange,
    getCover,
    getKey,
    getTitle: (it) => it.name,
    scopes: [
      {
        id: "queue",
        label: "在看和想看",
        hint: "在看与想看，本地有片源的更容易抽中",
        filter: (list) => list.filter((it) => (it.state === "在看" || it.state === "想看") && notDropped(it)),
        weight: (it) => (getLocal(it) && getLocal(it).nextEpisodeFile ? 3 : 1) * (it.state === "在看" ? 1.4 : 1)
      },
      {
        id: "local",
        label: "本地有片源",
        hint: "本地已下载、还没看的下一集",
        filter: (list) => list.filter((it) => notDropped(it) && getLocal(it) && getLocal(it).nextEpisodeFile)
      },
      {
        id: "rewatch",
        label: "高分重温",
        hint: "看完且我的评分 8 分以上，随机重温一集",
        filter: (list) => list.filter((it) => it.state === "已看" && Number(it.personalScore) >= 8),
        weight: (it) => Math.max(1, Number(it.personalScore) - 7)
      },
      { id: "all", label: "全部", hint: "全部收藏（不含搁置）", filter: (list) => list.filter(notDropped) }
    ],
    describe: (it) => {
      const local = getLocal(it);
      const info = epInfo(it, local);
      const rewatch = it.state === "已看";
      const ep = rewatch ? Math.max(1, Math.ceil(Math.random() * (info.total || info.watched || 12))) : info.next || 1;
      it.__bm7PickEp = ep;
      const reasons = [];
      if (it.state === "在看") reasons.push(`在看 · 已看 ${info.watched}${info.total ? ` / ${info.total}` : ""} 集`);
      if (it.state === "想看") reasons.push("想看列表里的作品");
      if (rewatch) reasons.push(`我的评分 ${Number(it.personalScore).toFixed(1)} · 重温一集`);
      if (local && local.nextEpisodeFile) reasons.push(`本地已有第 ${info.next} 集`);
      return {
        headline: rewatch ? `重温第 ${ep} 集` : it.state === "想看" ? "从第 1 集开始" : `下一集是第 ${ep} 集`,
        reason: reasons.join(" · "),
        chips: [it.year, it.studio && String(it.studio).split(/[,，、/]/)[0]].filter(Boolean)
      };
    },
    actions: (it) => {
      const local = getLocal(it);
      const wm = classifyWatch(it);
      const bgm = getBgmUrl(it);
      const hasLocalPlay = Boolean(local && local.nextEpisodeFile && actions.play && it.state !== "已看");
      const hasStream = wm && wm.kind === "streaming" && wm.url;
      return [
        {
          label: "播放",
          icon: "play",
          variant: "primary",
          hidden: !hasLocalPlay,
          onClick: () => actions.play(it, local, it.__bm7PickEp || undefined)
        },
        {
          label: wm && wm.siteLabel ? `去${wm.siteLabel}看` : "打开播放页",
          icon: "play",
          variant: hasLocalPlay ? "" : "primary",
          hidden: !hasStream,
          onClick: () => actions.openWeb && actions.openWeb(it, wm.url)
        },
        {
          label: "打开笔记",
          icon: "note",
          variant: !hasLocalPlay && !hasStream ? "primary" : "",
          onClick: () => actions.openNote && actions.openNote(it)
        },
        {
          label: "Bangumi 详情",
          icon: "link",
          hidden: !bgm || hasStream,
          onClick: () => actions.openWeb && actions.openWeb(it, bgm)
        }
      ];
    },
    emptyText: "这个范围里暂时没有作品。试试「全部」，或先把几部番标记为想看。"
  });

  /* ---------------- 4. 看番记录（最近看番 · 在看进度 · 想看清单 · 我的口味，支持逐页/平铺切换） ---------------- */
  const focusItemInHeroOrOpen = (targetItem) => {
    if (!targetItem) return;
    const tKey = getKey(targetItem);
    const searchOrder = [activeScene, "watching", "downloaded", "seasonal"];
    const seen = new Set();
    for (const sc of searchOrder) {
      if (seen.has(sc)) continue;
      seen.add(sc);
      const def = sceneDefs.find((d) => d.value === sc);
      if (!def || !Array.isArray(def.pool)) continue;
      const idx = def.pool.findIndex((x) => getKey(x) === tKey);
      if (idx >= 0) {
        activeScene = sc;
        spotByScene[sc] = idx;
        currentHeroKeyByScene[sc] = tKey;
        quipOpenForKey = null;
        if (typeof ctx.onHeroSceneChange === "function") ctx.onHeroSceneChange(sc);
        paintHero({ animate: true, transition: "ink", dir: 1 });
        try {
          if (heroArea.getBoundingClientRect().top < -36) {
            heroArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        } catch (_e) {}
        return;
      }
    }
    if (actions.openNote) actions.openNote(targetItem);
  };

  const rhythmArea = h("div.bm7-area-rhythm");
  grid.appendChild(rhythmArea);
  const lensCtrl = renderWatchLensDeck(rhythmArea, {
    getItems: () => items,
    getEvents: () => events,
    getCover,
    lensMode: ctx.lensMode,
    onLensModeChange: ctx.onLensModeChange,
    lensPage: ctx.lensPage,
    onLensPageChange: ctx.onLensPageChange,
    addNew: ctx.addNew,
    openDetail: (it) => actions.openNote && actions.openNote(it),
    onFocusSelect: (it) => focusItemInHeroOrOpen(it),
    jumpToLibrary: ({ state, tag, q } = {}) => {
      if (typeof actions.openCatalog === "function") {
        actions.openCatalog(tag || q || "", state || "all");
      }
    },
    openStats: () => openAnimeInsightsDrawer(themeRoot, ctx, "works")
  });

  /* ---------------- 5. 侧栏：关注直播间 + 看番动态 + 洛琪希物理双平面扒边交互小人 ---------------- */
  const side = h("aside.bm7-area-side");
  grid.appendChild(side);
  if (ctx.live) {
    const livePanel = panel("bm7-panel-live", { title: "关注直播间" });
    side.appendChild(livePanel);
    renderLiveRooms(livePanel._body, ctx.live);
  }
  const feedPanel = panel("bm7-panel-feed", { title: "看番动态" });
  side.appendChild(feedPanel);
  const feedScroll = h("div.bm7-feed-scroll");
  feedPanel._body.appendChild(feedScroll);

  if (themeRoot && themeRoot._roxyRigCtrl && typeof themeRoot._roxyRigCtrl.destroy === "function") {
    try {
      themeRoot._roxyRigCtrl.destroy();
    } catch (_) {}
    themeRoot._roxyRigCtrl = null;
  }
  if (host && host._roxyRigCtrl && typeof host._roxyRigCtrl.destroy === "function") {
    try {
      host._roxyRigCtrl.destroy();
    } catch (_) {}
    host._roxyRigCtrl = null;
  }
  let roxyPanelRigCtrl = null;
  if (themeRoot.getAttribute("data-bm7-theme") === "roxy" && appearance.roxyArt !== false) {
    const topSidePanel = side.firstElementChild;
    if (topSidePanel) {
      roxyPanelRigCtrl = mountRoxyPanelRig(topSidePanel, {
        hatOn: Boolean(appearance.roxyHat),
        gazeOn: appearance.roxyGaze !== false,
        motionOn: appearance.motion !== false && appearance.motionLevel !== "off",
        onToggleHat: (nextHat) => {
          appearance.roxyHat = Boolean(nextHat);
          if (typeof ctx.onAppearancePatch === "function") {
            ctx.onAppearancePatch({ roxyHat: Boolean(nextHat) });
          }
        }
      });
      themeRoot._roxyRigCtrl = roxyPanelRigCtrl;
      host._roxyRigCtrl = roxyPanelRigCtrl;
    }
  }

  const paintFeedTimeline = () => {
    renderFeed(feedScroll, events, {
      kind: "anime",
      limit: 40,
      onOpen: (ev) => {
        const it = items.find((x) => getKey(x) === ev.key);
        if (it && actions.openNote) actions.openNote(it);
      }
    });
  };
  paintFeedTimeline();

  /* ---------------- 6. 个人片单与智能筛选 ---------------- */
  if (ctx.lists) {
    const listsArea = h("div.bm7-area-lists");
    grid.appendChild(listsArea);
    renderLists(listsArea, ctx.lists);
  }

  if (themeRoot._bm8GlowMotion && typeof themeRoot._bm8GlowMotion.refresh === "function") {
    themeRoot._bm8GlowMotion.refresh();
  }

  applyItemMutation = (_mutatedItem, _updates = {}) => {
    mutationSeq += 1;
    events = normalizeEvents(typeof ctx.getEvents === "function" ? ctx.getEvents() : ctx.events || []);
    recomputePools(true);
    paintHero({ inPlace: true });
    if (roxyNoteCtrl && typeof roxyNoteCtrl.updateNotes === "function") {
      roxyNoteCtrl.updateNotes(items, downloadedPool.length);
    }
    if (lensCtrl && typeof lensCtrl.update === "function") {
      lensCtrl.update(items, events);
    }
    paintFeedTimeline();
    if (themeRoot._bm8GlowMotion && typeof themeRoot._bm8GlowMotion.refresh === "function") {
      themeRoot._bm8GlowMotion.refresh();
    }
  };

  const controller = {
    el: stage,
    applyItemMutation,
    openInsights: (tab) => openAnimeInsightsDrawer(themeRoot, ctx, tab),
    refresh(next) {
      if (next && Array.isArray(next.items)) items = next.items;
      return renderAnimeStage(host, Object.assign({}, ctx, next || {}));
    }
  };
  host._bm7StageController = controller;
  return controller;
}

module.exports = {
  renderAnimeStage,
  openAnimeInsightsDrawer,
  epInfo,
  episodeStrip
};
