/**
 * v0.7 视觉层 · 个人片单与智能筛选（原「收藏展柜与自定义分区」）
 * ---------------------------------------------------------------
 * 精选片单：手动挑片、拖动排序（数据沿用 settings.customCollectionSections）
 * 智能筛选：按标签 / 季度 / 评分 / 状态自动聚合（数据沿用 settings.customQuerySections）
 *
 * provider = {
 *   getPlaylists() -> [{ id, title, desc, items: AnimeItem[] }],
 *   getFilters()   -> [{ id, title, rules: { tag, watchStatus, minMyScore, minBgmScore, year, season }, items: AnimeItem[], total }],
 *   getTagCoverage() -> { total, missing },
 *   backfillTags(onProgress(done, total)) -> Promise<{ updated, failed }>,
 *   createPlaylist(), editPlaylist(pl), managePlaylist(pl), deletePlaylist(pl),
 *   reorderPlaylist(pl, orderedKeys) -> Promise,
 *   createFilter(), editFilter(f), deleteFilter(f), openFilterResults(f),
 *   openItem(item), getCover(item), getKey(item)
 * }
 */
const { h, clear, icon, coverEl, segmented, button, iconButton, emptyState, popover } = require("./v07-core.js");

function describeRules(rules = {}) {
  const chips = [];
  if (rules.tag) chips.push({ k: "tag", text: `标签：${String(rules.tag).replace(/^#/, "")}` });
  if (rules.watchStatus && rules.watchStatus !== "all" && rules.watchStatus !== "全部") chips.push({ k: "state", text: rules.watchStatus });
  if (Number(rules.minMyScore) > 0) chips.push({ k: "score", text: `我的评分 ≥ ${rules.minMyScore}` });
  if (Number(rules.minBgmScore) > 0) chips.push({ k: "score", text: `Bangumi ≥ ${rules.minBgmScore}` });
  if (rules.year) chips.push({ k: "time", text: `${rules.year} 年` });
  if (rules.season) chips.push({ k: "time", text: String(rules.season).replace(/^0/, "") });
  if (!chips.length) chips.push({ k: "all", text: "全部作品" });
  return chips;
}

function renderLists(host, provider, opts = {}) {
  clear(host);
  const state = { tab: opts.tab || "playlists", openId: null, backfill: null };
  const getKey = provider.getKey || ((it) => (it.file && it.file.path) || it.subjectId || it.name);
  const getCover = provider.getCover || ((it) => it.cover);

  const root = h("section.bm7-lists");
  const head = h("header.bm7-lists-head");
  const notice = h("div.bm7-lists-notice-slot");
  const body = h("div.bm7-lists-body");
  root.append(head, notice, body);
  host.appendChild(root);

  const paintHead = () => {
    clear(head);
    const pls = provider.getPlaylists() || [];
    const fls = provider.getFilters() || [];
    head.append(
      h("div.bm7-lists-titles", [h("h3.bm7-section-title", { text: "个人片单与智能筛选" }), h("span.bm7-section-sub", { text: "自己挑的片单，和按条件自动整理的作品集" })]),
      h("div.bm7-lists-bar", [
        segmented(
          [
            { value: "playlists", label: "精选片单", count: pls.length, icon: "list" },
            { value: "filters", label: "智能筛选", count: fls.length, icon: "filter" }
          ],
          state.tab,
          (v) => {
            if (v === state.tab) return;
            const dir = v === "filters" ? 1 : -1;
            state.tab = v;
            state.openId = null;
            paintHead();
            try {
              const { paperSlipSwap } = require("./v08-motion-and-lens.js");
              paperSlipSwap(body, () => paintBody(), { dir, frameless: true, allowOverflow: true });
            } catch (_) {
              paintBody();
            }
          }
        ),
        state.tab === "playlists"
          ? button("新建片单", { icon: "plus", onClick: () => provider.createPlaylist() })
          : button("新建筛选", { icon: "plus", onClick: () => provider.createFilter() })
      ])
    );
  };

  const paintNotice = () => {
    clear(notice);
    const cov = provider.getTagCoverage ? provider.getTagCoverage() : null;
    if (state.backfill) {
      const { done, total, finished, updated, failed } = state.backfill;
      const pct = total ? Math.round((done / total) * 100) : 0;
      notice.appendChild(
        h("div.bm7-lists-notice", { cls: finished ? "is-done" : "is-running" }, [
          h("span.bm7-notice-icon", [icon(finished ? "check" : "tag", 15)]),
          h("div.bm7-notice-text", [
            h("strong", { text: finished ? "标签补全完成" : `正在补全 Bangumi 标签 ${done} / ${total}` }),
            h("span", {
              text: finished
                ? `更新了 ${updated} 篇笔记${failed ? `，${failed} 篇暂时没取到，可稍后重试` : ""}。评分与手札没有改动。`
                : "只写入笔记的 tags 字段，不会改动评分与手札。"
            }),
            finished ? null : h("span.bm7-progress", [h("span.bm7-progress-fill", { style: { width: `${pct}%` } })])
          ]),
          finished ? iconButton("close", "关闭提示", () => { state.backfill = null; paintNotice(); }) : null
        ])
      );
      return;
    }
    if (cov && cov.missing > 0) {
      notice.appendChild(
        h("div.bm7-lists-notice", [
          h("span.bm7-notice-icon", [icon("tag", 15)]),
          h("div.bm7-notice-text", [
            h("strong", { text: `${cov.missing} 部作品还没有 Bangumi 标签` }),
            h("span", { text: "按「百合」「原创」这类标签筛选时会漏掉它们。补全只写入 tags，不会改动评分与手札。" })
          ]),
          button("补全已有笔记 Bangumi 标签", {
            variant: "primary",
            onClick: async () => {
              state.backfill = { done: 0, total: cov.missing, finished: false };
              paintNotice();
              let res = { updated: 0, failed: 0 };
              try {
                res = (await provider.backfillTags((done, total) => {
                  state.backfill = Object.assign({}, state.backfill, { done, total });
                  const fill = notice.querySelector(".bm7-progress-fill");
                  const strong = notice.querySelector(".bm7-notice-text strong");
                  if (fill) fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
                  if (strong) strong.textContent = `正在补全 Bangumi 标签 ${done} / ${total}`;
                })) || res;
              } catch (_) {}
              state.backfill = Object.assign({}, state.backfill, { finished: true, updated: res.updated || 0, failed: res.failed || 0 });
              paintNotice();
              paintHead();
              paintBody();
            }
          })
        ])
      );
    }
  };

  const playlistCard = (pl) => {
    const items = pl.items || [];
    const open = state.openId === pl.id;
    const stack = h("div.bm7-pl-stack", { dataset: { n: Math.min(items.length, 4) } });
    if (!items.length) stack.appendChild(h("div.bm7-pl-stack-empty", [icon("list", 22)]));
    items.slice(0, 4).forEach((it, i) => {
      stack.appendChild(h("div.bm7-pl-stack-item", { style: { "--i": String(i) } }, [coverEl(getCover(it), it.name)]));
    });
    const card = h(
      "article.bm7-pl-card",
      {
        cls: open ? "is-open" : "",
        attr: { tabindex: "0", role: "button", "aria-expanded": open ? "true" : "false" },
        on: {
          click: () => {
            state.openId = open ? null : pl.id;
            try {
              const { scrollUnrollMorph } = require("./v08-motion-and-lens.js");
              scrollUnrollMorph(body, () => paintBody());
            } catch (_) {
              paintBody();
            }
          },
          keydown: (e) => {
            if (e.key === "Enter") {
              state.openId = open ? null : pl.id;
              try {
                const { scrollUnrollMorph } = require("./v08-motion-and-lens.js");
                scrollUnrollMorph(body, () => paintBody());
              } catch (_) {
                paintBody();
              }
            }
          }
        }
      },
      [
        stack,
        h("div.bm7-pl-meta", [
          h("h4.bm7-pl-title", { text: pl.title || "未命名片单" }),
          h("span.bm7-pl-count", { text: `${items.length} 部` }),
          pl.desc ? h("p.bm7-pl-desc", { text: pl.desc }) : null
        ]),
        iconButton("more", "片单操作", (e) => {
          popover(e.currentTarget, (box, close) => {
            box.append(
              menuItem("pen", "重命名与说明", () => { close(); provider.editPlaylist(pl); }),
              menuItem("list", "添加或移除作品", () => { close(); provider.managePlaylist(pl); }),
              menuItem("close", "删除片单", () => { close(); provider.deletePlaylist(pl); }, "is-danger")
            );
          }, { width: 220, alignRight: true });
        }, "bm7-pl-more")
      ]
    );
    return card;
  };

  const playlistDetail = (pl) => {
    const items = (pl.items || []).slice();
    const box = h("div.bm7-pl-detail");
    const strip = h("ol.bm7-pl-strip");
    const tip = h("span.bm7-pl-tip", { text: "拖动封面调整顺序；触屏可用左右箭头。" });
    let dragKey = null;
    const commit = async () => {
      await provider.reorderPlaylist(pl, items.map(getKey));
      tip.textContent = "顺序已保存";
      setTimeout(() => tip.isConnected && (tip.textContent = "拖动封面调整顺序；触屏可用左右箭头。"), 1600);
    };
    const paintStrip = () => {
      clear(strip);
      items.forEach((it, idx) => {
        const li = h(
          "li.bm7-pl-entry",
          {
            attr: { draggable: "true" },
            dataset: { key: getKey(it) },
            on: {
              dragstart: (e) => {
                dragKey = getKey(it);
                li.classList.add("is-dragging");
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = "move";
                  try { e.dataTransfer.setData("text/plain", dragKey); } catch (_) {}
                }
              },
              dragend: () => {
                li.classList.remove("is-dragging");
                strip.querySelectorAll(".is-over").forEach((x) => x.classList.remove("is-over"));
              },
              dragover: (e) => {
                if (!dragKey || dragKey === getKey(it)) return;
                e.preventDefault();
                li.classList.add("is-over");
              },
              dragleave: () => li.classList.remove("is-over"),
              drop: (e) => {
                e.preventDefault();
                const from = items.findIndex((x) => getKey(x) === dragKey);
                const to = items.findIndex((x) => getKey(x) === getKey(it));
                dragKey = null;
                if (from < 0 || to < 0 || from === to) return;
                const [m] = items.splice(from, 1);
                items.splice(to, 0, m);
                paintStrip();
                commit();
              }
            }
          },
          [
            h("span.bm7-pl-rank", { text: String(idx + 1) }),
            h("button.bm7-pl-cover-btn", { attr: { type: "button", title: `打开《${it.name}》笔记` }, on: { click: () => provider.openItem(it) } }, [coverEl(getCover(it), it.name)]),
            h("span.bm7-pl-entry-title", { text: it.name }),
            h("span.bm7-pl-move", [
              iconButton("chevronLeft", "往前移", () => {
                if (idx === 0) return;
                [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
                paintStrip();
                commit();
              }),
              iconButton("chevronRight", "往后移", () => {
                if (idx === items.length - 1) return;
                [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
                paintStrip();
                commit();
              })
            ])
          ]
        );
        strip.appendChild(li);
      });
    };
    paintStrip();
    box.append(
      h("div.bm7-pl-detail-head", [
        h("strong", { text: pl.title }),
        tip,
        h("span.bm7-grow"),
        button("添加或移除作品", { icon: "plus", onClick: () => provider.managePlaylist(pl) })
      ]),
      items.length ? strip : emptyState("这个片单还是空的。")
    );
    return box;
  };

  const filterCard = (f) => {
    const items = f.items || [];
    const total = f.total !== undefined ? f.total : items.length;
    return h("article.bm7-fl-card", [
      h("div.bm7-fl-top", [
        h("div.bm7-fl-titles", [h("h4.bm7-fl-title", { text: f.title || "未命名筛选" }), h("div.bm7-chips", describeRules(f.rules).map((c) => h("span.bm7-chip", { dataset: { k: c.k }, text: c.text })))]),
        h("div.bm7-fl-count", [h("span.bm7-num", { text: String(total) }), h("span", { text: "部" })])
      ]),
      items.length
        ? h(
            "div.bm7-fl-strip",
            items.slice(0, 8).map((it) =>
              h("button.bm7-fl-cover", { attr: { type: "button", title: it.name }, on: { click: () => provider.openItem(it) } }, [coverEl(getCover(it), it.name)])
            )
          )
        : h("div.bm7-fl-none", { text: "当前没有符合条件的作品" }),
      h("div.bm7-fl-actions", [
        button(`前往全部番剧查看 (${total} 部)`, {
          icon: "arrowUpRight",
          variant: "ghost",
          title: `离开当前页，前往「全部番剧」查看全部 ${total} 部符合条件的作品`,
          onClick: () => provider.openFilterResults(f)
        }),
        h("span.bm7-grow"),
        iconButton("pen", "编辑条件", () => provider.editFilter(f)),
        iconButton("close", "删除筛选", () => provider.deleteFilter(f))
      ])
    ]);
  };

  const paintBody = () => {
    clear(body);
    if (state.tab === "playlists") {
      const pls = provider.getPlaylists() || [];
      if (!pls.length) {
        body.appendChild(emptyState("把想反复回味、或想推荐给朋友的作品放进片单，顺序由你决定。", button("新建第一个片单", { icon: "plus", variant: "primary", onClick: () => provider.createPlaylist() })));
        return;
      }
      const grid = h("div.bm7-pl-grid");
      for (const pl of pls) {
        grid.appendChild(playlistCard(pl));
        if (state.openId === pl.id) grid.appendChild(playlistDetail(pl));
      }
      body.appendChild(grid);
    } else {
      const fls = provider.getFilters() || [];
      if (!fls.length) {
        body.appendChild(emptyState("例如「评分 8 分以上的百合」「2024 年 10 月新番」，条件满足的作品会自动出现在这里。", button("新建第一个筛选", { icon: "plus", variant: "primary", onClick: () => provider.createFilter() })));
        return;
      }
      body.appendChild(h("div.bm7-fl-grid", fls.map(filterCard)));
    }
  };

  paintHead();
  paintNotice();
  paintBody();
  return {
    repaint() {
      paintHead();
      paintNotice();
      paintBody();
    }
  };
}

function menuItem(ic, label, onClick, cls = "") {
  return h("button.bm7-menu-item", { cls, attr: { type: "button" }, on: { click: onClick } }, [icon(ic, 14), h("span", { text: label })]);
}

module.exports = { renderLists, describeRules, menuItem };
