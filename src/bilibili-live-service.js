const { Notice, requestUrl } = require("obsidian");
const {
  isMobileEnv,
  isDesktopNodeAvailable,
  isTabletEnv,
  isIosEnv,
  openExternalSchemeWithFallback,
  tryRequireNode
} = require("./platform-env.js");

const DEFAULT_BILIBILI_LIVE_ROOMS = [
  {
    roomId: "33989",
    uid: "63231",
    name: "泛式",
    note: "新番导视 · 动画杂谈",
    avatar: "",
    notifyEnabled: true
  },
  {
    roomId: "42062",
    uid: "730732",
    name: "瓶子君152",
    note: "动画锐评 · 直播互动",
    avatar: "",
    notifyEnabled: true
  }
];

const BILI_LIVE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://live.bilibili.com/"
};

function parseRoomIdInput(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text) return "";
  const urlMatch = text.match(/live\.bilibili\.com\/(?:blanc\/|h5\/)?(\d+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  const digits = text.match(/^\d+$/) ? text : (text.match(/(\d{2,12})/) || [])[1] || "";
  return digits ? String(digits).trim() : "";
}

function getLiveRoomWebUrl(roomId) {
  const clean = parseRoomIdInput(roomId);
  return clean ? `https://live.bilibili.com/${clean}` : "https://live.bilibili.com/";
}

function getLiveRoomAppSchemes(roomId, preferHd = false) {
  const clean = parseRoomIdInput(roomId);
  if (!clean) return [];
  const std = `bilibili://live/${clean}`;
  const hd = `bilibilihd://live/${clean}`;
  if (isIosEnv()) {
    return [std];
  }
  return preferHd ? [hd, std] : [std];
}

function normalizeMobileLiveOpenMode(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "ask" || v === "app_hd" || v === "web" || v === "auto") return v;
  return "auto";
}

let _activeLiveFallbackNotice = null;

function dismissActiveLiveFallbackNotice() {
  if (_activeLiveFallbackNotice) {
    try {
      _activeLiveFallbackNotice.hide();
    } catch (_) {}
    _activeLiveFallbackNotice = null;
  }
}

function showInteractiveLiveFallbackNotice({ cleanRoomId, webUrl, preferHd, hasStandardAppFallback }) {
  dismissActiveLiveFallbackNotice();
  if (typeof document === "undefined") {
    const fallbackNotice = new Notice("未能自动跳转客户端，可在直播区设置切换网页版打开", 5200);
    _activeLiveFallbackNotice = fallbackNotice;
    return () => dismissActiveLiveFallbackNotice();
  }
  const frag = document.createDocumentFragment();
  const wrap = document.createElement("div");
  wrap.className = "bm7-live-fallback-notice";
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;max-width:300px;";

  const textEl = document.createElement("div");
  textEl.style.cssText = "font-size:13px;line-height:1.45;";
  textEl.textContent = preferHd
    ? "正在等待系统打开哔哩哔哩 HD；若未安装或已取消跳转，可手动切换："
    : "正在等待系统打开哔哩哔哩；若未安装或已取消跳转，可手动改用网页版：";
  wrap.appendChild(textEl);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;gap:7px;align-items:center;";

  let noticeRef = null;
  const closeThis = () => {
    if (noticeRef) {
      try {
        noticeRef.hide();
      } catch (_) {}
      if (_activeLiveFallbackNotice === noticeRef) {
        _activeLiveFallbackNotice = null;
      }
      noticeRef = null;
    }
  };

  if (hasStandardAppFallback && cleanRoomId) {
    const stdBtn = document.createElement("button");
    stdBtn.type = "button";
    stdBtn.textContent = "改用普通 B 站";
    stdBtn.style.cssText =
      "padding:5px 11px;min-height:30px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.2;" +
      "border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);cursor:pointer;box-shadow:none;";
    stdBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeThis();
      openLiveRoomByTarget(cleanRoomId, "app", webUrl);
    });
    actions.appendChild(stdBtn);
  }

  const webBtn = document.createElement("button");
  webBtn.type = "button";
  webBtn.textContent = "用网页版打开";
  webBtn.style.cssText =
    "padding:5px 12px;min-height:30px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.2;" +
    "border:none;background:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer;box-shadow:none;";
  webBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeThis();
    openExternalUrlSafely(webUrl);
  });
  actions.appendChild(webBtn);

  wrap.appendChild(actions);
  frag.appendChild(wrap);
  noticeRef = new Notice(frag, 9000);
  _activeLiveFallbackNotice = noticeRef;
  return closeThis;
}

function openLiveRoomByTarget(roomId, target = "auto", webFallbackUrl = "") {
  const clean = parseRoomIdInput(roomId);
  const webUrl = webFallbackUrl || getLiveRoomWebUrl(clean);
  if (!clean) {
    return openExternalUrlSafely(webUrl);
  }
  if (!isMobileEnv() || target === "web") {
    return openExternalUrlSafely(webUrl);
  }
  const preferHd = target === "app_hd" || (target === "auto" && isTabletEnv() && !isIosEnv());
  const schemes = target === "app" ? getLiveRoomAppSchemes(clean, false) : getLiveRoomAppSchemes(clean, preferHd);
  openExternalSchemeWithFallback(schemes, webUrl, {
    stepDelayMs: 1550,
    autoOpenFallbackWeb: false,
    autoChainSchemes: false,
    watchAfterFallbackMs: 22000,
    onFallback: (_url, helpers) =>
      showInteractiveLiveFallbackNotice({
        cleanRoomId: clean,
        webUrl,
        preferHd,
        hasStandardAppFallback: Boolean(preferHd && helpers && helpers.remainingSchemes && helpers.remainingSchemes.length > 0)
      })
  });
  return true;
}

function openExternalUrlSafely(url) {
  if (!url) return false;
  try {
    if (isDesktopNodeAvailable()) {
      const electronMod = tryRequireNode("electron");
      if (electronMod && electronMod.shell && typeof electronMod.shell.openExternal === "function") {
        electronMod.shell.openExternal(url);
        return true;
      }
    }
  } catch (_) {}
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (_) {
    return false;
  }
}

function formatLiveStatusLabel(liveStatus) {
  const num = Number(liveStatus) || 0;
  if (num === 1) return "直播中";
  if (num === 2) return "轮播中";
  return "未开播";
}

function ensureBilibiliLiveSettings(plugin) {
  if (!plugin || !plugin.settings) {
    return {
      rooms: [],
      monitorEnabled: true,
      systemNotifyEnabled: !isMobileEnv(),
      mobileOpenMode: "auto",
      pollIntervalSec: 120,
      notifiedSessionMap: {}
    };
  }
  const s = plugin.settings;
  if (!s.bilibiliLiveInitialized) {
    if (!Array.isArray(s.bilibiliLiveRooms)) {
      s.bilibiliLiveRooms = [];
    }
    s.bilibiliLiveInitialized = true;
  }
  if (!Array.isArray(s.bilibiliLiveRooms)) {
    s.bilibiliLiveRooms = [];
  }
  if (typeof s.bilibiliLiveMonitorEnabled !== "boolean") {
    s.bilibiliLiveMonitorEnabled = true;
  }
  if (typeof s.bilibiliLiveSystemNotifyEnabled !== "boolean") {
    s.bilibiliLiveSystemNotifyEnabled = !isMobileEnv();
  }
  s.bilibiliLiveMobileOpenMode = normalizeMobileLiveOpenMode(s.bilibiliLiveMobileOpenMode);
  const interval = Number(s.bilibiliLivePollIntervalSec);
  if (!Number.isFinite(interval) || interval < 45) {
    s.bilibiliLivePollIntervalSec = 120;
  }
  if (!s.bilibiliLiveNotifiedSessions || typeof s.bilibiliLiveNotifiedSessions !== "object") {
    s.bilibiliLiveNotifiedSessions = {};
  }
  return {
    rooms: s.bilibiliLiveRooms,
    monitorEnabled: s.bilibiliLiveMonitorEnabled,
    systemNotifyEnabled: s.bilibiliLiveSystemNotifyEnabled && !isMobileEnv(),
    mobileOpenMode: s.bilibiliLiveMobileOpenMode,
    pollIntervalSec: s.bilibiliLivePollIntervalSec,
    notifiedSessionMap: s.bilibiliLiveNotifiedSessions
  };
}

async function fetchBiliJson(url, timeoutMs = 6000) {
  const timerPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), timeoutMs)
  );
  const reqPromise = requestUrl({
    url,
    method: "GET",
    headers: BILI_LIVE_HEADERS,
    throw: false
  });
  const resp = await Promise.race([reqPromise, timerPromise]);
  if (!resp || resp.status < 200 || resp.status >= 300) {
    return null;
  }
  if (resp.json && typeof resp.json === "object") {
    return resp.json;
  }
  return resp.text ? JSON.parse(resp.text) : null;
}

async function resolveBilibiliRoomMeta(roomIdOrUrl) {
  const parsedId = parseRoomIdInput(roomIdOrUrl);
  if (!parsedId) {
    throw new Error("请输入有效的 B 站直播间房间号或直播间链接");
  }
  const infoJson = await fetchBiliJson(
    `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(parsedId)}`,
    7000
  );
  if (!infoJson || Number(infoJson.code) !== 0 || !infoJson.data) {
    const msg = (infoJson && infoJson.message) ? infoJson.message : "未找到该直播间";
    throw new Error(`查询直播间失败：${msg}`);
  }
  const d = infoJson.data;
  const canonicalRoomId = String(d.room_id || parsedId);
  const shortId = d.short_id ? String(d.short_id) : "";
  const uid = d.uid ? String(d.uid) : "";
  let uname = "";
  let face = "";

  if (uid) {
    try {
      const masterJson = await fetchBiliJson(
        `https://api.live.bilibili.com/live_user/v1/Master/info?uid=${encodeURIComponent(uid)}`,
        5500
      );
      if (masterJson && Number(masterJson.code) === 0 && masterJson.data && masterJson.data.info) {
        uname = String(masterJson.data.info.uname || "").trim();
        face = String(masterJson.data.info.face || "").trim();
      }
    } catch (_) {}
  }

  if (face && face.startsWith("http://")) {
    face = "https://" + face.slice(7);
  }
  const cover = String(d.user_cover || d.keyframe || "").replace(/^http:\/\//i, "https://");
  const keyframe = String(d.keyframe || "").replace(/^http:\/\//i, "https://");

  return {
    roomId: canonicalRoomId,
    shortId,
    uid,
    name: uname || `主播 ${canonicalRoomId}`,
    avatar: face,
    liveStatus: Number(d.live_status) || 0,
    statusLabel: formatLiveStatusLabel(d.live_status),
    title: String(d.title || "").trim(),
    areaName: String(d.area_name || d.parent_area_name || "").trim(),
    online: Number(d.online) || 0,
    liveTime: String(d.live_time || "").trim(),
    cover,
    keyframe,
    updatedAt: Date.now()
  };
}

function sendWindowsSystemNotification({ title, body, icon, roomUrl, tag }) {
  const cleanTitle = String(title || "直播开播提醒").trim();
  const cleanBody = String(body || "").trim();

  if (!isMobileEnv() && typeof window !== "undefined" && "Notification" in window) {
    try {
      const fireWebNotification = () => {
        const notif = new window.Notification(cleanTitle, {
          body: cleanBody,
          icon: icon || undefined,
          tag: tag || undefined,
          silent: false
        });
        notif.onclick = () => {
          if (roomUrl) {
            openExternalUrlSafely(roomUrl);
          }
          try {
            notif.close();
          } catch (_) {}
        };
        return true;
      };

      if (window.Notification.permission === "granted") {
        if (fireWebNotification()) return "system";
      } else if (options.allowPermissionPrompt && window.Notification.permission !== "denied") {
        window.Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            fireWebNotification();
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  if (!isMobileEnv() && isDesktopNodeAvailable()) {
    try {
      const electronMod = tryRequireNode("electron");
      const RemoteNotification =
        (electronMod && electronMod.Notification) ||
        (electronMod && electronMod.remote && electronMod.remote.Notification);
      if (typeof RemoteNotification === "function") {
        const n = new RemoteNotification({
          title: cleanTitle,
          body: cleanBody
        });
        n.on("click", () => {
          if (roomUrl) openExternalUrlSafely(roomUrl);
        });
        n.show();
        return "electron";
      }
    } catch (_) {}
  }

  new Notice(`${cleanTitle}\n${cleanBody}`, 7000);
  return "obsidian_notice";
}

function getRuntimeStore(plugin) {
  if (!plugin._biliLiveServiceState) {
    plugin._biliLiveServiceState = {
      statusByRoomId: new Map(),
      listeners: new Set(),
      timerId: null,
      refreshing: false,
      lastRefreshedAt: 0
    };
  }
  return plugin._biliLiveServiceState;
}

function notifyLiveListeners(plugin) {
  const store = getRuntimeStore(plugin);
  const snapshot = getLiveRoomsWithStatus(plugin);
  for (const fn of store.listeners) {
    try {
      fn(snapshot);
    } catch (_) {}
  }
}

function subscribeBilibiliLiveUpdates(plugin, listener) {
  if (typeof listener !== "function") return () => {};
  const store = getRuntimeStore(plugin);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getLiveRoomsWithStatus(plugin) {
  const cfg = ensureBilibiliLiveSettings(plugin);
  const store = getRuntimeStore(plugin);
  return cfg.rooms.map((room) => {
    const rid = String(room.roomId || "").trim();
    const rt = store.statusByRoomId.get(rid) || {};
    const liveStatus = Number(rt.liveStatus !== undefined ? rt.liveStatus : 0) || 0;
    return {
      roomId: rid,
      uid: String(room.uid || rt.uid || "").trim(),
      name: String(room.name || rt.name || `房间 ${rid}`).trim(),
      note: String(room.note || "").trim(),
      avatar: String(rt.avatar || room.avatar || "").trim(),
      notifyEnabled: room.notifyEnabled !== false,
      liveStatus,
      statusLabel: formatLiveStatusLabel(liveStatus),
      title: String(rt.title || "").trim(),
      areaName: String(rt.areaName || "").trim(),
      online: Number(rt.online) || 0,
      liveTime: String(rt.liveTime || "").trim(),
      cover: String(rt.cover || "").trim(),
      keyframe: String(rt.keyframe || "").trim(),
      webUrl: getLiveRoomWebUrl(rid),
      updatedAt: rt.updatedAt || 0
    };
  });
}

async function refreshBilibiliLiveRooms(plugin, options = {}) {
  if (!plugin || !plugin.settings) return [];
  const store = getRuntimeStore(plugin);
  if (store.refreshing) {
    return getLiveRoomsWithStatus(plugin);
  }
  store.refreshing = true;
  const allowNotify = options.allowNotify !== false;

  try {
    const cfg = ensureBilibiliLiveSettings(plugin);
    const rooms = cfg.rooms;
    if (!rooms.length) {
      store.lastRefreshedAt = Date.now();
      notifyLiveListeners(plugin);
      return [];
    }

    let settingsDirty = false;

    // 1. Resolve any room missing uid first
    for (const room of rooms) {
      if (!room.uid && room.roomId) {
        try {
          const resolved = await resolveBilibiliRoomMeta(room.roomId);
          room.roomId = resolved.roomId;
          room.uid = resolved.uid;
          if (!room.name || room.name.startsWith("主播 ") || room.name.startsWith("房间 ")) {
            room.name = resolved.name;
          }
          if (resolved.avatar) {
            room.avatar = resolved.avatar;
          }
          store.statusByRoomId.set(String(room.roomId), resolved);
          settingsDirty = true;
        } catch (_) {}
      }
    }

    // 2. Batch query all rooms that have uid in a single HTTP request
    const uidList = rooms
      .map((r) => String(r.uid || "").trim())
      .filter(Boolean);

    if (uidList.length > 0) {
      const query = uidList.map((u) => `uids[]=${encodeURIComponent(u)}`).join("&");
      try {
        const batchJson = await fetchBiliJson(
          `https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?${query}`,
          7500
        );
        if (batchJson && Number(batchJson.code) === 0 && batchJson.data && typeof batchJson.data === "object") {
          for (const room of rooms) {
            const uid = String(room.uid || "").trim();
            const entry = uid ? batchJson.data[uid] : null;
            if (!entry) continue;
            const canonicalRoomId = String(entry.room_id || room.roomId);
            const face = String(entry.face || room.avatar || "").replace(/^http:\/\//i, "https://");
            const uname = String(entry.uname || room.name || "").trim();
            if (face && room.avatar !== face) {
              room.avatar = face;
              settingsDirty = true;
            }
            if (uname && (!room.name || room.name.startsWith("主播 ") || room.name.startsWith("房间 "))) {
              room.name = uname;
              settingsDirty = true;
            }
            const prevStatus = store.statusByRoomId.get(canonicalRoomId);
            const nextStatus = {
              roomId: canonicalRoomId,
              shortId: entry.short_id ? String(entry.short_id) : "",
              uid,
              name: room.name || uname,
              avatar: face,
              liveStatus: Number(entry.live_status) || 0,
              statusLabel: formatLiveStatusLabel(entry.live_status),
              title: String(entry.title || "").trim(),
              areaName: String(entry.area_v2_name || entry.area_name || "").trim(),
              online: Number(entry.online) || 0,
              liveTime: String(entry.live_time || "").trim(),
              cover: String(entry.cover_from_user || entry.keyframe || "").replace(/^http:\/\//i, "https://"),
              keyframe: String(entry.keyframe || "").replace(/^http:\/\//i, "https://"),
              updatedAt: Date.now()
            };
            store.statusByRoomId.set(canonicalRoomId, nextStatus);

            // Check live start notification condition
            if (
              allowNotify &&
              cfg.monitorEnabled &&
              room.notifyEnabled !== false &&
              nextStatus.liveStatus === 1
            ) {
              const sessionKey =
                nextStatus.liveTime && nextStatus.liveTime !== "0000-00-00 00:00:00" && nextStatus.liveTime !== "0"
                  ? `${canonicalRoomId}@${nextStatus.liveTime}`
                  : `${canonicalRoomId}@live`;
              const lastKey = cfg.notifiedSessionMap[canonicalRoomId] || "";
              const transitionedToLive = !prevStatus || prevStatus.liveStatus !== 1 || lastKey !== sessionKey;
              if (transitionedToLive && lastKey !== sessionKey) {
                cfg.notifiedSessionMap[canonicalRoomId] = sessionKey;
                settingsDirty = true;
                if (cfg.systemNotifyEnabled && !isMobileEnv()) {
                  sendWindowsSystemNotification({
                    title: `${nextStatus.name} 正在直播`,
                    body: [nextStatus.title, nextStatus.areaName].filter(Boolean).join(" · ") || "点击前往 B 站直播间观看",
                    icon: nextStatus.avatar || undefined,
                    roomUrl: getLiveRoomWebUrl(canonicalRoomId),
                    tag: `bangumi-bili-live-${canonicalRoomId}`
                  });
                } else {
                  new Notice(`${nextStatus.name} 正在直播：${nextStatus.title || "点击直播间卡片进入"}`, 6000);
                }
              }
            }
          }
        }
      } catch (_) {}
    }

    if (settingsDirty && typeof plugin.saveSettings === "function") {
      try {
        await plugin.saveSettings();
      } catch (_) {}
    }

    store.lastRefreshedAt = Date.now();
    notifyLiveListeners(plugin);
    return getLiveRoomsWithStatus(plugin);
  } finally {
    store.refreshing = false;
  }
}

async function addBilibiliLiveRoom(plugin, rawInput, customNote = "") {
  const cfg = ensureBilibiliLiveSettings(plugin);
  const meta = await resolveBilibiliRoomMeta(rawInput);
  const exists = cfg.rooms.find(
    (r) => String(r.roomId) === String(meta.roomId) || (meta.shortId && String(r.roomId) === String(meta.shortId))
  );
  if (exists) {
    exists.uid = meta.uid || exists.uid;
    exists.name = meta.name || exists.name;
    exists.avatar = meta.avatar || exists.avatar;
    if (customNote) exists.note = String(customNote).trim();
  } else {
    cfg.rooms.push({
      roomId: meta.roomId,
      uid: meta.uid,
      name: meta.name,
      note: String(customNote || meta.areaName || "").trim(),
      avatar: meta.avatar,
      notifyEnabled: true
    });
  }
  const store = getRuntimeStore(plugin);
  store.statusByRoomId.set(String(meta.roomId), meta);
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  if (cfg.monitorEnabled) {
    startBilibiliLiveMonitor(plugin);
  }
  notifyLiveListeners(plugin);
  return meta;
}

async function removeBilibiliLiveRoom(plugin, roomId) {
  const cfg = ensureBilibiliLiveSettings(plugin);
  const target = String(roomId || "").trim();
  const next = cfg.rooms.filter((r) => String(r.roomId) !== target);
  plugin.settings.bilibiliLiveRooms = next;
  const store = getRuntimeStore(plugin);
  store.statusByRoomId.delete(target);
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  notifyLiveListeners(plugin);
  return getLiveRoomsWithStatus(plugin);
}

async function restoreDefaultBilibiliLiveRooms(plugin) {
  const cfg = ensureBilibiliLiveSettings(plugin);
  for (const preset of DEFAULT_BILIBILI_LIVE_ROOMS) {
    if (!cfg.rooms.some((r) => String(r.roomId) === preset.roomId)) {
      cfg.rooms.push({ ...preset });
    }
  }
  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }
  if (cfg.monitorEnabled && cfg.rooms.length > 0) {
    startBilibiliLiveMonitor(plugin);
  }
  return refreshBilibiliLiveRooms(plugin, { allowNotify: false });
}

function startBilibiliLiveMonitor(plugin) {
  if (!plugin || !plugin.settings) return;
  stopBilibiliLiveMonitor(plugin);
  const cfg = ensureBilibiliLiveSettings(plugin);
  if (!Array.isArray(cfg.rooms) || cfg.rooms.length === 0) return;
  // Always perform one gentle initial status fetch when user has followed rooms
  setTimeout(() => {
    if (!plugin._biliLiveUnloaded) {
      refreshBilibiliLiveRooms(plugin, { allowNotify: cfg.monitorEnabled }).catch(() => {});
    }
  }, 1800);

  if (!cfg.monitorEnabled) return;
  const store = getRuntimeStore(plugin);
  const intervalMs = Math.max(45, Number(cfg.pollIntervalSec) || 120) * 1000;
  store.timerId = setInterval(() => {
    if (plugin._biliLiveUnloaded) {
      stopBilibiliLiveMonitor(plugin);
      return;
    }
    if (!plugin.settings.bilibiliLiveMonitorEnabled) return;
    refreshBilibiliLiveRooms(plugin, { allowNotify: true }).catch(() => {});
  }, intervalMs);
}

function stopBilibiliLiveMonitor(plugin) {
  if (!plugin || !plugin._biliLiveServiceState) return;
  if (plugin._biliLiveServiceState.timerId) {
    clearInterval(plugin._biliLiveServiceState.timerId);
    plugin._biliLiveServiceState.timerId = null;
  }
}

function triggerTestLiveNotification(plugin) {
  const rooms = getLiveRoomsWithStatus(plugin);
  const sample = rooms[0] || DEFAULT_BILIBILI_LIVE_ROOMS[0];
  return sendWindowsSystemNotification({
    title: `${sample.name} 开播提醒（通知测试）`,
    body: sample.title || "新番杂谈直播已开始 · 点击即可在浏览器打开直播间",
    icon: sample.avatar || undefined,
    roomUrl: getLiveRoomWebUrl(sample.roomId),
    tag: "bangumi-bili-live-test",
    allowPermissionPrompt: true
  });
}

module.exports = {
  DEFAULT_BILIBILI_LIVE_ROOMS,
  parseRoomIdInput,
  getLiveRoomWebUrl,
  getLiveRoomAppSchemes,
  normalizeMobileLiveOpenMode,
  openLiveRoomByTarget,
  openExternalUrlSafely,
  formatLiveStatusLabel,
  ensureBilibiliLiveSettings,
  resolveBilibiliRoomMeta,
  sendWindowsSystemNotification,
  subscribeBilibiliLiveUpdates,
  getLiveRoomsWithStatus,
  refreshBilibiliLiveRooms,
  addBilibiliLiveRoom,
  removeBilibiliLiveRoom,
  restoreDefaultBilibiliLiveRooms,
  startBilibiliLiveMonitor,
  stopBilibiliLiveMonitor,
  triggerTestLiveNotification
};
