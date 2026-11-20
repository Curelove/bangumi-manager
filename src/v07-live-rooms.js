/**
 * v0.7 视觉层 · 关注直播间
 * ---------------------------------------------------------------
 * 只负责界面；数据由主线数据层提供（批量接口 get_status_info_by_uids、轮询、去重通知）。
 *
 * provider = {
 *   getRooms() -> Room[],
 *   getSettings() -> { monitor: boolean, notify: boolean, lastCheckedAt?: number },
 *   refresh() -> Promise<Room[]>,
 *   addRoom(input: string) -> Promise<{ ok: boolean, error?: string }>,
 *   removeRoom(roomId) -> Promise<void>,
 *   setSetting(key: "monitor"|"notify", value: boolean) -> Promise<void>,
 *   openRoom(room) -> void,
 *   subscribe?(fn) -> unsubscribe     // 轮询到新状态时通知界面重绘（可选）
 * }
 * Room = { roomId, uid, name, face, status: 0|1|2, title, online, areaName, keyframe, liveTime, url }
 *   status：0 未开播 · 1 直播中 · 2 轮播中
 */
const { Notice } = require("obsidian");
const { h, clear, icon, button, iconButton, toggleRow, segmented, popover, formatCount, formatRelative, toDate, platformInfo, emptyState } = require("./v07-core.js");
const { isTabletEnv, isIosEnv } = require("./platform-env.js");

const STATUS = {
  1: { label: "直播中", cls: "is-live" },
  2: { label: "轮播中", cls: "is-round" },
  0: { label: "未开播", cls: "is-off" }
};

/** 从「33989」「live.bilibili.com/33989」「https://live.bilibili.com/h5/33989?x」中解析房间号 */
function parseRoomInput(input) {
  const s = String(input || "").trim();
  const m = s.match(/live\.bilibili\.com\/(?:h5\/|blanc\/)?(\d{1,12})/i) || s.match(/^(\d{1,12})$/);
  return m ? m[1] : null;
}

function renderLiveRooms(host, provider, opts = {}) {
  clear(host);
  const { desktop } = platformInfo();
  const state = { editing: false, adding: false, refreshing: false, error: "" };
  const root = h("div.bm7-live");
  const head = h("div.bm7-live-summary");
  const list = h("div.bm7-live-list");
  const foot = h("div.bm7-live-foot");
  root.append(head, list, foot);
  host.appendChild(root);

  const sortRooms = (rooms) =>
    rooms.slice().sort((a, b) => {
      const ra = a.status === 1 ? 0 : a.status === 2 ? 1 : 2;
      const rb = b.status === 1 ? 0 : b.status === 2 ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return (Number(b.online) || 0) - (Number(a.online) || 0);
    });

  const copyRoomId = async (room) => {
    const idText = String((room && room.roomId) || "").trim();
    if (!idText) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(idText);
        new Notice(`已复制直播间号 ${idText}`);
        return;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = idText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      new Notice(`已复制直播间号 ${idText}`);
    } catch (_) {
      new Notice(`直播间号：${idText}`);
    }
  };

  const openMobileRoomSheet = (room) => {
    const existing = document.querySelector(".bm7-live-sheet-overlay");
    if (existing) existing.remove();
    const isTablet = isTabletEnv();
    const isIos = isIosEnv();

    const overlay = h("div.bm7-live-sheet-overlay", {
      attr: { role: "dialog", "aria-modal": "true", "aria-label": "选择直播间打开方式" }
    });
    const closeSheet = () => {
      overlay.classList.remove("is-open");
      setTimeout(() => overlay.remove(), 170);
    };
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeSheet();
    });

    const mkAction = (title, sub, onPick, highlight = false) =>
      h(
        "button.bm7-live-sheet-btn",
        {
          cls: highlight ? "is-highlight" : "",
          attr: { type: "button" },
          on: {
            click: () => {
              closeSheet();
              onPick();
            }
          }
        },
        [
          h("span.bm7-live-sheet-btn-main", { text: title }),
          sub ? h("span.bm7-live-sheet-btn-sub", { text: sub }) : null
        ]
      );

    const actions = [
      mkAction(
        "在哔哩哔哩打开",
        isIos ? "唤起官方客户端" : "优先直达客户端，未安装自动转网页",
        () => provider.openRoom(room, "app"),
        !isTablet || isIos
      )
    ];
    if (!isIos) {
      actions.push(
        mkAction(
          isTablet ? "在哔哩哔哩 HD 打开（平板推荐）" : "在哔哩哔哩 HD 打开",
          "优先唤起哔哩哔哩 HD，未安装自动回落标准版或网页",
          () => provider.openRoom(room, "app_hd"),
          isTablet
        )
      );
    }
    actions.push(
      mkAction("在浏览器打开网页版", `live.bilibili.com/${room.roomId || ""}`, () => provider.openRoom(room, "web")),
      mkAction("复制房间号", `房间 ${room.roomId || ""}`, () => copyRoomId(room))
    );

    const sheet = h("div.bm7-live-sheet", [
      h("div.bm7-live-sheet-grab"),
      h("div.bm7-live-sheet-head", [
        h("div.bm7-live-sheet-title", { text: room.name || `直播间 ${room.roomId || ""}` }),
        h("div.bm7-live-sheet-sub", { text: room.title || `房间号 ${room.roomId || ""}` })
      ]),
      h("div.bm7-live-sheet-actions", actions),
      h("button.bm7-live-sheet-cancel", {
        attr: { type: "button" },
        text: "取消",
        on: { click: closeSheet }
      })
    ]);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-open"));
  };

  const handleRoomActivate = (room) => {
    if (state.editing) return;
    if (!desktop) {
      const s = provider.getSettings ? provider.getSettings() : {};
      if (s.mobileOpenMode === "ask") {
        openMobileRoomSheet(room);
        return;
      }
    }
    provider.openRoom(room);
  };

  const paint = () => {
    const rooms = sortRooms(provider.getRooms() || []);
    const settings = provider.getSettings ? provider.getSettings() : {};
    const liveN = rooms.filter((r) => r.status === 1).length;

    clear(head);
    head.append(
      h("span.bm7-live-count", { cls: liveN ? "has-live" : "" }, [
        h("span.bm7-live-pulse"),
        liveN ? `${liveN} 个直播间正在直播` : rooms.length ? "关注的直播间都还没开播" : "还没有关注直播间"
      ]),
      h("span.bm7-live-tools", [
        iconButton("refresh", "刷新状态", async () => {
          if (state.refreshing) return;
          state.refreshing = true;
          root.classList.add("is-refreshing");
          try {
            await provider.refresh();
          } catch (_) {}
          state.refreshing = false;
          root.classList.remove("is-refreshing");
          paint();
        }, "bm7-live-refresh"),
        iconButton("gear", "开播监测与通知", (e) => openSettings(e.currentTarget)),
        iconButton(state.editing ? "check" : "pen", state.editing ? "完成" : "管理直播间", () => {
          state.editing = !state.editing;
          paint();
        })
      ])
    );

    clear(list);
    if (!rooms.length) {
      const quickChips = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", marginTop: "6px" } }, [
        button("+ 泛式 · 33989", {
          variant: "ghost",
          onClick: async () => {
            await provider.addRoom("33989");
            paint();
          }
        }),
        button("+ 瓶子君152 · 42062", {
          variant: "ghost",
          onClick: async () => {
            await provider.addRoom("42062");
            paint();
          }
        })
      ]);
      const emptyBox = emptyState("输入 B 站房间号或直播间链接即可关注开播状态。");
      emptyBox.appendChild(quickChips);
      list.appendChild(emptyBox);
    }
    for (const room of rooms) {
      const st = STATUS[room.status] || STATUS[0];
      const row = h(
        "div.bm7-live-room",
        {
          cls: `${st.cls} ${state.editing ? "is-editing" : ""}`,
          attr: { role: "button", tabindex: "0", "aria-label": `${room.name} ${st.label}` },
          on: {
            click: () => handleRoomActivate(room),
            keydown: (e) => {
              if (e.key === "Enter") handleRoomActivate(room);
            }
          }
        },
        [
          h("span.bm7-live-avatar", [
            room.face ? h("img", { attr: { src: room.face, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }) : h("span.bm7-live-avatar-fb", { text: String(room.name || "?").slice(0, 1) })
          ]),
          h("span.bm7-live-main", [
            h("span.bm7-live-line1", [
              h("span.bm7-live-name", { text: room.name || `直播间 ${room.roomId}` }),
              h("span.bm7-live-badge", { cls: st.cls }, [room.status === 1 ? h("i.bm7-live-dot") : null, st.label])
            ]),
            h("span.bm7-live-title", { text: room.title || (room.status === 0 ? "暂未开播" : "") }),
            h("span.bm7-live-meta", [
              room.status === 1 && room.online ? h("span", { text: `人气 ${formatCount(room.online)}` }) : null,
              room.areaName ? h("span", { text: room.areaName }) : null,
              room.status === 1 && room.liveTime ? h("span", { text: `${formatRelative(toDate(room.liveTime))}开播` }) : null,
              h("span.bm7-live-id", { text: `房间 ${room.roomId}` })
            ])
          ]),
          room.status === 1 && room.keyframe && opts.showKeyframe !== false
            ? h("span.bm7-live-thumb", [h("img", { attr: { src: room.keyframe, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } })])
            : null,
          state.editing
            ? iconButton("close", `取消关注 ${room.name}`, async () => {
                await provider.removeRoom(room.roomId);
                paint();
              }, "bm7-live-remove")
            : h("span.bm7-live-go", [icon("chevronRight", 16)])
        ]
      );
      list.appendChild(row);
    }

    clear(foot);
    if (state.editing || !rooms.length) {
      const input = h("input.bm7-input", { attr: { type: "text", placeholder: "房间号或直播间链接", inputmode: "url", "aria-label": "添加直播间" } });
      const err = h("span.bm7-live-error", { text: state.error });
      const add = async () => {
        const id = parseRoomInput(input.value);
        if (!id) {
          state.error = "没认出房间号，请输入数字或 live.bilibili.com 链接";
          err.textContent = state.error;
          return;
        }
        state.error = "";
        err.textContent = "正在添加…";
        const res = await provider.addRoom(id);
        if (res && res.ok === false) {
          state.error = res.error || "添加失败，请稍后再试";
          err.textContent = state.error;
          return;
        }
        input.value = "";
        paint();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") add();
      });
      foot.append(h("div.bm7-live-add", [input, button("关注", { icon: "plus", variant: "primary", onClick: add })]), err);
    } else {
      const last = settings.lastCheckedAt ? `${formatRelative(toDate(settings.lastCheckedAt))}更新` : "";
      const mobileModeLabel = !desktop
        ? settings.mobileOpenMode === "ask"
          ? " · 点击选打开方式"
          : settings.mobileOpenMode === "web"
          ? " · 网页打开"
          : settings.mobileOpenMode === "app_hd"
          ? " · 优先 B站 HD"
          : isTabletEnv() && !isIosEnv()
          ? " · 优先 B站 HD"
          : " · 优先唤起客户端"
        : "";
      foot.append(
        h("span.bm7-live-note", [
          settings.monitor ? h("span.bm7-live-monitor-on", [icon("broadcast", 13), "开播监测中"]) : h("span", { text: "开播监测已关闭" }),
          last ? h("span", { text: ` · ${last}` }) : null,
          mobileModeLabel ? h("span", { text: mobileModeLabel }) : null
        ])
      );
    }
  };

  const openSettings = (anchor) => {
    popover(anchor, (box, close) => {
      const s = provider.getSettings ? provider.getSettings() : {};
      box.append(
        h("div.bm7-pop-title", { text: desktop ? "开播监测" : "直播间设置" }),
        toggleRow({
          label: "开播监测",
          hint: "每 2 分钟在后台查询一次关注的直播间",
          checked: s.monitor,
          onChange: async (v) => {
            await provider.setSetting("monitor", v);
            paint();
          }
        })
      );
      if (desktop) {
        box.append(
          toggleRow({
            label: "Windows 系统通知",
            hint: "主播开播时在屏幕右下角提醒，点通知直达直播间；同一场直播只提醒一次",
            checked: s.notify,
            disabled: !s.monitor,
            disabledHint: "需要先打开开播监测",
            onChange: async (v) => {
              await provider.setSetting("notify", v);
            }
          })
        );
      } else {
        const isTablet = isTabletEnv();
        const isIos = isIosEnv();
        const modeHint = h("div.bm7-toggle-hint");
        const modeSegHost = h("div.bm7-live-mode-seg");
        const updateModeHint = (modeVal) => {
          if (modeVal === "ask") {
            modeHint.textContent = "每次点击直播间时弹出底部菜单，自选哔哩哔哩、HD 版、网页或复制房间号";
          } else if (modeVal === "web") {
            modeHint.textContent = "直接通过手机浏览器打开网页版直播间";
          } else if (modeVal === "app_hd") {
            modeHint.textContent = "优先唤起哔哩哔哩 HD 客户端，未安装或取消跳转时可在提示中一键转标准客户端或网页版";
          } else {
            modeHint.textContent =
              isTablet && !isIos
                ? "平板自动优先唤起哔哩哔哩 HD，未安装或取消跳转时可在提示中一键切标准客户端或网页版"
                : "优先直接唤起哔哩哔哩客户端，首次授权不误弹浏览器，未安装时可一键转网页版";
          }
        };
        const modeOptions = [
          { value: "auto", label: "优先客户端" },
          { value: "ask", label: "每次询问" },
          { value: "web", label: "网页版" }
        ];
        if (!isIos && !isTablet) {
          modeOptions.splice(1, 0, { value: "app_hd", label: "B站 HD" });
        }
        const curMode = s.mobileOpenMode || "auto";
        updateModeHint(curMode);
        const paintSeg = (val) => {
          clear(modeSegHost);
          modeSegHost.appendChild(
            segmented(
              modeOptions,
              val,
              async (nextVal) => {
                await provider.setSetting("mobileOpenMode", nextVal);
                updateModeHint(nextVal);
                paintSeg(nextVal);
                paint();
              },
              "is-small"
            )
          );
        };
        paintSeg(curMode);
        box.append(
          h("div.bm7-live-mode-box", [
            h("div.bm7-toggle-label", { text: "点击直播间打开方式" }),
            modeSegHost,
            modeHint
          ]),
          h("p.bm7-pop-note", { text: "手机端不支持系统后台弹窗通知，打开档案馆时会显示最新开播状态。" })
        );
      }
    }, { width: desktop ? 300 : 320, alignRight: true });
  };

  paint();
  let unsub = null;
  if (typeof provider.subscribe === "function") unsub = provider.subscribe(() => root.isConnected && paint());
  return {
    repaint: paint,
    destroy() {
      if (typeof unsub === "function") unsub();
    }
  };
}

module.exports = { renderLiveRooms, parseRoomInput };
