/**
 * v0.7 视觉层 · 共享内核
 * ---------------------------------------------------------------
 * - 纯原生 DOM 构建（不依赖 Obsidian 的 createDiv/createEl，便于在沙箱与插件内共用）
 * - 时间 / 时长 / 人数格式化
 * - 封面环境色提取（失败时回退到按标题哈希的稳定色相）
 * - 动效开关判定、小型交互控件（分段选择、开关、弹出层）
 * - 极简线性图标（currentColor 描边）
 *
 * 跨端约束：本文件零 Node 依赖；平台判断统一走 ./platform-env.js 的 isMobileEnv()。
 */
const { isMobileEnv } = require("./platform-env.js");

/* ============================== DOM ============================== */

/**
 * h("div.bm7-card.is-x", { text, attr, style, on, dataset, title, html }, [children])
 */
function h(sel, props, children) {
  const parts = String(sel || "div").split(".");
  const el = document.createElement(parts[0] || "div");
  if (parts.length > 1) el.className = parts.slice(1).filter(Boolean).join(" ");
  if (Array.isArray(props) || typeof props === "string" || props instanceof Node) {
    children = props;
    props = null;
  }
  if (props) {
    if (props.cls) el.className = [el.className, props.cls].filter(Boolean).join(" ");
    if (props.text !== undefined && props.text !== null) el.textContent = String(props.text);
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.title) el.title = props.title;
    if (props.attr) {
      for (const [k, v] of Object.entries(props.attr)) {
        if (v === false || v === null || v === undefined) continue;
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (props.dataset) {
      for (const [k, v] of Object.entries(props.dataset)) {
        if (v !== undefined && v !== null) el.dataset[k] = String(v);
      }
    }
    if (props.style) {
      for (const [k, v] of Object.entries(props.style)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else el.style[k] = v;
      }
    }
    if (props.on) {
      for (const [evt, fn] of Object.entries(props.on)) {
        if (typeof fn === "function") el.addEventListener(evt, fn);
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  if (children === undefined || children === null || children === false) return;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

function clear(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

function svgEl(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(markup).trim();
  return tpl.content.firstElementChild;
}

/* ============================== 图标 ============================== */

const ICON_PATHS = {
  play: '<path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  shuffle: '<path d="M4 7h3.5c4 0 5 10 9 10H20"/><path d="M4 17h3.5c1.6 0 2.7-1.6 3.6-3.6"/><path d="M13 9.6c.9-1.6 2-2.6 3.5-2.6H20"/><path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h6M9 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  pen: '<path d="M15.5 4.5 19.5 8.5 9 19H5v-4z"/><path d="m13.5 6.5 4 4"/>',
  flag: '<path d="M6 21V4M6 4.5h10l-2 3.5 2 3.5H6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 18.6a9.3 9.3 0 0 1 0-13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  grip: '<circle cx="9" cy="7" r="1.1" fill="currentColor"/><circle cx="15" cy="7" r="1.1" fill="currentColor"/><circle cx="9" cy="12" r="1.1" fill="currentColor"/><circle cx="15" cy="12" r="1.1" fill="currentColor"/><circle cx="9" cy="17" r="1.1" fill="currentColor"/><circle cx="15" cy="17" r="1.1" fill="currentColor"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  filter: '<path d="M4.5 6h15M7.5 12h9M10.5 18h3"/>',
  tag: '<path d="M4.8 12.2V5.2a.7.7 0 0 1 .7-.7h7l6.9 6.9a1.4 1.4 0 0 1 0 2l-5.7 5.7a1.4 1.4 0 0 1-2 0z"/><circle cx="8.8" cy="8.8" r="1.25"/>',
  bookmark: '<path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-3.8L5.5 19.5v-14a1 1 0 0 1 1-1z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/>',
  sparkle: '<path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5z"/>',
  gamepad: '<path d="M7.5 8h9a4 4 0 0 1 3.9 4.8l-.7 3.4a2.4 2.4 0 0 1-4.1 1.1L14 15.5h-4l-1.6 1.8a2.4 2.4 0 0 1-4.1-1.1l-.7-3.4A4 4 0 0 1 7.5 8z"/><path d="M8.5 10.8v3M7 12.3h3"/><circle cx="15.5" cy="11.5" r=".9" fill="currentColor"/><circle cx="17" cy="13.3" r=".9" fill="currentColor"/>',
  timer: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.2 1.6M10 3.5h4"/>',
  crop: '<path d="M7 3.5V17h13.5"/><path d="M3.5 7H17v13.5"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M5 5v4h4"/>',
  undo: '<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M5 5v4h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  wand: '<path d="m4.5 19.5 10-10"/><path d="M17 3.5v3M15.5 5h3M19.5 9v2M18.5 10h2M13 2.8v1.6M12.2 3.6h1.6"/>',
  tv: '<rect x="3.5" y="6.5" width="17" height="12" rx="2.5"/><path d="m8.5 3.5 3.5 3 3.5-3M9.5 21h5"/>',
  bookOpen: '<path d="M3.5 6.2A2.2 2.2 0 0 1 5.7 4h4.1a2.7 2.7 0 0 1 2.2 1.2A2.7 2.7 0 0 1 14.2 4h4.1a2.2 2.2 0 0 1 2.2 2.2v11.6a1.2 1.2 0 0 1-1.2 1.2h-4.8a2.5 2.5 0 0 0-2.5 1.5 2.5 2.5 0 0 0-2.5-1.5H4.7a1.2 1.2 0 0 1-1.2-1.2z"/><path d="M12 5.4v14.2"/>',
  grid: '<rect x="4" y="4" width="6.8" height="6.8" rx="1.6"/><rect x="13.2" y="4" width="6.8" height="6.8" rx="1.6"/><rect x="4" y="13.2" width="6.8" height="6.8" rx="1.6"/><rect x="13.2" y="13.2" width="6.8" height="6.8" rx="1.6"/>',
  crown: '<path d="m4 17.5 1.6-9.5 4.6 3.8L12 6.5l1.8 5.3 4.6-3.8L20 17.5z"/><path d="M4.5 20h15"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="8.8" cy="9.5" r="1.6"/><path d="m20.5 15.8-4.6-4.4a1.4 1.4 0 0 0-2 0L6.5 19.5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3M9 20.5h6"/>',
  cube: '<path d="M12 3.2 20 7.7v8.6l-8 4.5-8-4.5V7.7z"/><path d="M12 12 20 7.7M12 12v8.8M12 12 4 7.7"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.4a2.1 2.1 0 0 0 1.6-3.5 1.8 1.8 0 0 1 1.4-3h1.6A3.5 3.5 0 0 0 20.5 10 7.5 7.5 0 0 0 12 3.5z"/><circle cx="8.2" cy="10" r="1" fill="currentColor"/><circle cx="11.5" cy="7.6" r="1" fill="currentColor"/><circle cx="15.3" cy="9.2" r="1" fill="currentColor"/><circle cx="8" cy="14" r="1" fill="currentColor"/>',
  layout: '<rect x="3.8" y="4.5" width="16.4" height="15" rx="2.4"/><path d="M3.8 9.5h16.4M9.5 9.5v10"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4.5 17.5v1.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-1.2"/>',
  trend: '<path d="m4 16.5 5.2-5.2 3.6 3.6L19.5 8"/><path d="M15 8h4.5v4.5"/>',
  message: '<path d="M5.5 5h13A2 2 0 0 1 20.5 7v8.5a2 2 0 0 1-2 2H10l-4.5 3v-3H5.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 13.2h5"/>',
  barChart: '<path d="M5 19.5v-6M10 19.5V8.5M15 19.5v-9M20 19.5V5"/>',
  building: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 10.5h3.5A1.5 1.5 0 0 1 20 12v8M3.5 20h17"/><path d="M8.2 8h3.6M8.2 11.5h3.6M8.2 15h3.6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
  swap: '<path d="M7 8h13m-3-3 3 3-3 3M17 16H4m3-3-3 3 3 3"/>',
  trash: '<path d="M5 7h14M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M7 7l.8 11.5a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5L17 7"/>',
  external: '<path d="M14 4.5h5.5V10M19.2 4.8 11 13"/><path d="M19 13.8v4.2a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6.5A1.5 1.5 0 0 1 6 5h4.2"/>',
  feather: '<path d="M19.4 4.6a4.8 4.8 0 0 0-6.8 0L5.5 11.7V18.5h6.8l7.1-7.1a4.8 4.8 0 0 0 0-6.8z"/><path d="M4 20 15.5 8.5M11 14h5.5"/>',
  alert: '<path d="M12 4.2 20.6 19a1.2 1.2 0 0 1-1 1.8H4.4a1.2 1.2 0 0 1-1-1.8z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
  magnet: '<path d="M6 5v6a6 6 0 0 0 12 0V5"/><path d="M4.5 5h4M15.5 5h4M6 8.5h3M15 8.5h3"/>',
  cloud: '<path d="M7.2 18.5h9.8a4.2 4.2 0 0 0 .6-8.3A5.8 5.8 0 0 0 6.4 8.7 4.6 4.6 0 0 0 7.2 18.5z"/>',
  package: '<path d="M12 3.3 20 7.6v8.8l-8 4.3-8-4.3V7.6z"/><path d="m4 7.6 8 4.3 8-4.3M12 11.9v8.8M8 5.5l8 4.3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5V5.5A1.5 1.5 0 0 1 4.5 4H13a1.5 1.5 0 0 1 1.5 1.5v1"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5 19.5a7 7 0 0 1 14 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  rss: '<circle cx="6.2" cy="17.8" r="1.4" fill="currentColor" stroke="none"/><path d="M4.8 11.2a8 8 0 0 1 8 8"/><path d="M4.8 5.2a14 14 0 0 1 14 14"/>',
  file: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/>',
  sparkles: '<path d="M10.5 4c.5 3.6 1.8 4.9 5.5 5.5-3.7.6-5 1.9-5.5 5.5-.5-3.6-1.8-4.9-5.5-5.5 3.7-.6 5-1.9 5.5-5.5z"/><path d="M17.5 13.5c.3 1.8.9 2.4 2.7 2.7-1.8.3-2.4.9-2.7 2.7-.3-1.8-.9-2.4-2.7-2.7 1.8-.3 2.4-.9 2.7-2.7z"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  pause: '<rect x="6.5" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.7" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" stroke="none"/>',
  volume: '<path d="M11 5.5 6.8 9H4.2a.7.7 0 0 0-.7.7v4.6a.7.7 0 0 0 .7.7h2.6L11 18.5z"/><path d="M14.8 9.2a4.2 4.2 0 0 1 0 5.6M17.6 6.8a7.6 7.6 0 0 1 0 10.4"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2M11 8.5v5M8.5 11h5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2M8.5 11h5"/>',
  ruler: '<rect x="3.5" y="7.5" width="17" height="9" rx="1.8"/><path d="M7 7.5v3.2M10.5 7.5v2M14 7.5v3.2M17.5 7.5v2"/>',
  heart: '<path d="M12 19.5s-7-4.4-7-9.6A4.1 4.1 0 0 1 9.2 5.8c1.3 0 2.2.6 2.8 1.5.6-.9 1.5-1.5 2.8-1.5A4.1 4.1 0 0 1 19 9.9c0 5.2-7 9.6-7 9.6z"/>'
};

function iconMarkup(name, size = 16, extraCls = "") {
  const body = ICON_PATHS[name] || ICON_PATHS.sparkle;
  return `<svg class="bm7-ico ${extraCls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function icon(name, size = 16, extraCls = "") {
  return svgEl(iconMarkup(name, size, extraCls));
}

function setBtnIconLabel(el, iconName, labelText, size = 15) {
  if (!el) return el;
  clear(el);
  if (iconName) el.appendChild(icon(iconName, size));
  if (labelText !== undefined && labelText !== null && labelText !== "") {
    const sp = document.createElement("span");
    sp.textContent = String(labelText);
    el.appendChild(sp);
  }
  return el;
}

/* ============================== 时间与格式 ============================== */

const DAY_MS = 86400000;
const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (!v) return null;
  const s = String(v).trim();
  // 兼容 2026-11-13 / 2026/11/13 / 2026.11.13 / 2026年11月13日 [hh:mm]
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 以周一为一周起点 */
function startOfWeek(d) {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}

function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function dayKey(d) {
  const x = toDate(d);
  if (!x) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

function formatDayLabel(d, now = new Date()) {
  const x = toDate(d);
  if (!x) return "";
  const diff = Math.round((startOfDay(now) - startOfDay(x)) / DAY_MS);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  const base = `${x.getMonth() + 1}月${x.getDate()}日`;
  const yearPrefix = x.getFullYear() !== now.getFullYear() ? `${x.getFullYear()}年` : "";
  return `${yearPrefix}${base} ${WEEKDAY_CN[x.getDay()]}`;
}

function formatClock(d) {
  const x = toDate(d);
  if (!x) return "";
  if (x.getHours() === 0 && x.getMinutes() === 0) return "";
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}

function formatShortDate(d) {
  const x = toDate(d);
  if (!x) return "—";
  return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
}

function formatRelative(d, now = new Date()) {
  const x = toDate(d);
  if (!x) return "";
  const sec = Math.round((now - x) / 1000);
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** 分钟 → “12小时44分钟” / “45分钟” / “0分钟” */
function formatMinutes(min, compact = false) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (compact) {
    if (hh <= 0) return `${mm}分`;
    return mm ? `${hh}时${mm}分` : `${hh}小时`;
  }
  if (hh <= 0) return `${mm} 分钟`;
  return mm ? `${hh} 小时 ${mm} 分` : `${hh} 小时`;
}

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(v);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* ============================== 动效 ============================== */

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_) {
    return false;
  }
}

/** 返回当前节点所处的动效档位："full"（丰富）| "lite"（轻巧）| "off"（关闭） */
function motionTier(fromEl) {
  const root =
    (fromEl && fromEl.closest ? fromEl.closest("[data-bm7-motion-tier], [data-bm7-motion]") : null) ||
    (typeof document !== "undefined" ? document.querySelector(".bm7-root[data-bm7-motion-tier], .bm7-root[data-bm7-motion]") : null);
  if (root) {
    const tier = root.getAttribute("data-bm7-motion-tier");
    if (tier === "off" || tier === "lite" || tier === "full") return tier;
    const flag = root.getAttribute("data-bm7-motion");
    if (flag === "off") return "off";
    if (flag === "on") return "full";
  }
  if (prefersReducedMotion()) return "off";
  return "full";
}

/** 由根节点 data-bm7-motion 与系统偏好共同决定是否播放动效 */
function motionEnabled(fromEl) {
  return motionTier(fromEl) !== "off";
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ============================== 颜色 ============================== */

function hashHue(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

const ambientCache = new Map();

/**
 * 读取封面平均色（降采样到 20×20，按饱和度加权，避免灰白背景主导）。
 * 跨域被拒或解码失败时 resolve(null)，调用方回退到 hashHue。
 */
function extractAmbientColor(url) {
  if (!url) return Promise.resolve(null);
  if (ambientCache.has(url)) return ambientCache.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 20;
        c.height = 20;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 20, 20);
        const data = g.getImageData(0, 0, 20, 20).data;
        let r = 0, gg = 0, b = 0, wsum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i], G = data[i + 1], B = data[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const lum = (mx + mn) / 510;
          const w = 0.15 + sat * 1.6 + (lum > 0.12 && lum < 0.9 ? 0.4 : 0);
          r += R * w; gg += G * w; b += B * w; wsum += w;
        }
        if (!wsum) return done(null);
        done([Math.round(r / wsum), Math.round(gg / wsum), Math.round(b / wsum)]);
      } catch (_) {
        done(null);
      }
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    img.src = url;
  });
  ambientCache.set(url, job);
  return job;
}

const ambientPaletteCache = new Map();

/**
 * 提取封面三层渐变环境色（主高饱和调、上沿暖/亮辅调、下沿深色氛围调），供「封面柔光」多层交叉漫射使用。
 */
const resolvedAmbientPalettes = new Map();

function extractAmbientPalette(url) {
  if (!url) return Promise.resolve(null);
  if (ambientPaletteCache.has(url)) return ambientPaletteCache.get(url);
  const job = new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      if (v) resolvedAmbientPalettes.set(url, v);
      resolve(v);
    };
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 24, 24);
        const data = g.getImageData(0, 0, 24, 24).data;
        let r1 = 0, g1 = 0, b1 = 0, w1 = 0;
        let r2 = 0, g2 = 0, b2 = 0, w2 = 0;
        let r3 = 0, g3 = 0, b3 = 0, w3 = 0;
        for (let py = 0; py < 24; py++) {
          for (let px = 0; px < 24; px++) {
            const idx = (py * 24 + px) * 4;
            const R = data[idx], G = data[idx + 1], B = data[idx + 2];
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            const sat = mx === 0 ? 0 : (mx - mn) / mx;
            const lum = (mx + mn) / 510;
            const baseW = 0.12 + sat * 1.85 + (lum > 0.12 && lum < 0.88 ? 0.35 : 0);
            r1 += R * baseW; g1 += G * baseW; b1 += B * baseW; w1 += baseW;
            if (py < 12) {
              const topW = baseW * (1 + sat * 0.6);
              r2 += R * topW; g2 += G * topW; b2 += B * topW; w2 += topW;
            } else {
              const botW = baseW * (1 + (1 - Math.abs(lum - 0.45)) * 0.5);
              r3 += R * botW; g3 += G * botW; b3 += B * botW; w3 += botW;
            }
          }
        }
        if (!w1) return done(null);
        const clampCh = (v) => Math.max(28, Math.min(232, Math.round(v)));
        const c1 = [clampCh(r1 / w1), clampCh(g1 / w1), clampCh(b1 / w1)];
        const c2 = w2 ? [clampCh(r2 / w2), clampCh(g2 / w2), clampCh(b2 / w2)] : c1;
        const c3 = w3 ? [clampCh(r3 / w3), clampCh(g3 / w3), clampCh(b3 / w3)] : c1;
        done({ primary: c1, secondary: c2, tertiary: c3 });
      } catch (_) {
        done(null);
      }
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    img.src = url;
  });
  ambientPaletteCache.set(url, job);
  return job;
}

/** 把环境色写入元素的 --bm7-ambient / --bm7-ambient-rgb / --bm7-ambient-2 / --bm7-ambient-3（消除二次色相跳变） */
async function applyAmbient(el, url, fallbackKey) {
  if (!el) return;
  const seq = (el._bm7AmbSeq || 0) + 1;
  el._bm7AmbSeq = seq;
  const targetKey = `${url || ""}::${fallbackKey || ""}`;
  if (el._bm7AmbAppliedKey === targetKey && el._bm7HasAmbient) return;

  const writeFallback = () => {
    const hue = hashHue(fallbackKey || url);
    const hue2 = (hue + 38) % 360;
    const hue3 = (hue + 318) % 360;
    el.style.setProperty("--bm7-ambient", `hsl(${hue} 48% 54%)`);
    el.style.setProperty("--bm7-ambient-2", `hsl(${hue2} 44% 58%)`);
    el.style.setProperty("--bm7-ambient-3", `hsl(${hue3} 38% 46%)`);
    el.style.setProperty("--bm7-ambient-rgb", "");
    el._bm7HasAmbient = true;
    el._bm7AmbAppliedKey = targetKey;
  };

  const writePalette = (pal) => {
    const [r, g, b] = pal.primary;
    const [r2, g2, b2] = pal.secondary;
    const [r3, g3, b3] = pal.tertiary;
    el.style.setProperty("--bm7-ambient", `rgb(${r} ${g} ${b})`);
    el.style.setProperty("--bm7-ambient-2", `rgb(${r2} ${g2} ${b2})`);
    el.style.setProperty("--bm7-ambient-3", `rgb(${r3} ${g3} ${b3})`);
    el.style.setProperty("--bm7-ambient-rgb", `${r}, ${g}, ${b}`);
    el._bm7HasAmbient = true;
    el._bm7AmbAppliedKey = targetKey;
  };

  if (url && resolvedAmbientPalettes.has(url)) {
    writePalette(resolvedAmbientPalettes.get(url));
    return;
  }
  if (!url) {
    writeFallback();
    return;
  }
  // 首次尚未设置过环境色时才先铺柔和底色；已有环境色时保持当前色直接平滑过渡到新封面主色，杜绝先跳 hashHue 再跳真色的二次跳变
  if (!el._bm7HasAmbient) {
    writeFallback();
  }
  const pal = await extractAmbientPalette(url);
  if (el._bm7AmbSeq !== seq || el.isConnected === false) return;
  if (pal) {
    writePalette(pal);
  } else {
    writeFallback();
  }
}

/* ============================== 封面 ============================== */

/**
 * 统一封面节点：有图时 <img>，无图时按标题生成柔和色块与首字。
 */
function coverEl(url, title, cls = "") {
  const box = h("div.bm7-cover", { cls });
  if (url) {
    const img = h("img", { attr: { src: url, alt: title || "", loading: "lazy", decoding: "async", draggable: "false" } });
    img.addEventListener("error", () => {
      img.remove();
      box.appendChild(coverFallback(title));
    });
    box.appendChild(img);
  } else {
    box.appendChild(coverFallback(title));
  }
  return box;
}

function coverFallback(title) {
  const hue = hashHue(title);
  return h("div.bm7-cover-fallback", {
    style: { "--bm7-fb-hue": String(hue) },
    text: String(title || "?").replace(/^[《「【\s]+/, "").slice(0, 1)
  });
}

/* ============================== 小控件 ============================== */

/**
 * 分段选择器
 * options: [{ value, label, count?, title? }]
 */
function segmented(options, value, onChange, extraCls = "") {
  const wrap = h("div.bm7-seg", { cls: extraCls, attr: { role: "tablist" } });
  const render = (cur) => {
    clear(wrap);
    for (const opt of options) {
      const btn = h(
        "button.bm7-seg-btn",
        {
          cls: opt.value === cur ? "is-active" : "",
          title: opt.title || "",
          attr: { type: "button", role: "tab", "aria-selected": opt.value === cur ? "true" : "false" },
          on: {
            click: (e) => {
              e.preventDefault();
              if (opt.value === cur) return;
              render(opt.value);
              onChange && onChange(opt.value);
            }
          }
        },
        [
          opt.icon ? icon(opt.icon, 14) : null,
          h("span", { text: opt.label }),
          opt.count !== undefined && opt.count !== null ? h("span.bm7-seg-count", { text: String(opt.count) }) : null
        ]
      );
      wrap.appendChild(btn);
    }
  };
  render(value);
  wrap.setValue = render;
  return wrap;
}

/** 开关（带文字），disabled 时整行置灰并显示原因 */
function toggleRow({ label, hint, checked, disabled, disabledHint, onChange }) {
  const id = `bm7-sw-${Math.random().toString(36).slice(2, 8)}`;
  const input = h("input", { attr: { type: "checkbox", id, role: "switch" } });
  input.checked = Boolean(checked);
  input.disabled = Boolean(disabled);
  input.addEventListener("change", () => onChange && onChange(input.checked));
  return h("label.bm7-toggle", { cls: disabled ? "is-disabled" : "", attr: { for: id } }, [
    h("span.bm7-toggle-text", [
      h("span.bm7-toggle-label", { text: label }),
      hint || (disabled && disabledHint) ? h("span.bm7-toggle-hint", { text: disabled && disabledHint ? disabledHint : hint }) : null
    ]),
    input,
    h("span.bm7-toggle-track", [h("span.bm7-toggle-thumb")])
  ]);
}

function button(label, opts = {}) {
  const b = h("button.bm7-btn", {
    cls: [opts.variant ? `is-${opts.variant}` : "", opts.cls || ""].join(" "),
    title: opts.title || "",
    attr: { type: "button", "aria-label": opts.ariaLabel || (label ? null : opts.title) },
    on: {
      click: (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onClick && opts.onClick(e);
      }
    }
  }, [opts.icon ? icon(opts.icon, opts.iconSize || 15) : null, label ? h("span", { text: label }) : null]);
  if (opts.disabled) b.disabled = true;
  return b;
}

function iconButton(name, title, onClick, cls = "") {
  return button("", { icon: name, title, onClick, cls: `is-icon ${cls}` });
}

function ensurePopoverPortal(sourceRoot) {
  let portal = document.getElementById("bm7-portal-host");
  if (!portal) {
    portal = document.createElement("div");
    portal.id = "bm7-portal-host";
    portal.className = "bm7-root bm7-portal-host";
    document.body.appendChild(portal);
  }
  const theme = (sourceRoot && sourceRoot.getAttribute("data-bm7-theme")) || "follow";
  const motion = (sourceRoot && sourceRoot.getAttribute("data-bm7-motion")) || "on";
  const tier = (sourceRoot && sourceRoot.getAttribute("data-bm7-motion-tier")) || (motion === "off" ? "off" : "full");
  portal.setAttribute("data-bm7-theme", theme);
  portal.setAttribute("data-bm7-motion", motion);
  portal.setAttribute("data-bm7-motion-tier", tier);
  if (sourceRoot && sourceRoot.style) {
    const amb = sourceRoot.style.getPropertyValue("--bm7-ambient");
    if (amb) portal.style.setProperty("--bm7-ambient", amb);
  }
  return portal;
}

/**
 * 轻量弹出层：通过 body 级 Portal 逃逸 container-type 包含块，桌面端锚定按钮下方，窄屏/移动端贴合视口底部抽屉。
 * 返回 { el, close }
 */
function popover(anchor, buildContent, opts = {}) {
  closeAllPopovers();
  const sourceRoot = (anchor && anchor.closest && anchor.closest(".bm7-root")) || null;
  const portal = ensurePopoverPortal(sourceRoot);
  const pop = h("div.bm7-pop", { cls: opts.cls || "", attr: { role: "dialog" } });
  const inner = h("div.bm7-pop-inner");
  pop.appendChild(inner);
  const close = () => {
    pop.classList.add("is-leaving");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => pop.remove(), 140);
    opts.onClose && opts.onClose();
  };
  pop._bm7Close = close;
  buildContent(inner, close);
  portal.appendChild(pop);

  const vw = Math.max(280, window.innerWidth || document.documentElement.clientWidth || 390);
  const vh = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 844);
  const hostWidth = sourceRoot ? sourceRoot.getBoundingClientRect().width : vw;
  const narrow = vw < 560 || hostWidth < 520 || isMobileEnv();
  if (narrow) {
    pop.classList.add("is-sheet");
    const sheetBar = h("div.bm7-sheet-bar", [
      h("span.bm7-sheet-grab", { attr: { "aria-hidden": "true" } }),
      opts.title ? h("span.bm7-sheet-title", { text: opts.title }) : null,
      h(
        "button.bm7-sheet-close",
        {
          attr: { type: "button", "aria-label": "关闭" },
          on: {
            click: (e) => {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }
        },
        [icon("close", 16)]
      )
    ]);
    pop.insertBefore(sheetBar, inner);
  } else if (anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(opts.width || 320, vw - 16);
    pop.style.width = `${pw}px`;
    let left = r.left + (opts.alignRight ? r.width - pw : 0);
    left = clamp(left, 8, vw - pw - 8);
    pop.style.left = `${left}px`;
    const popRect = pop.getBoundingClientRect();
    const estH = Math.min(popRect.height || 260, vh - 24);
    const spaceBelow = vh - r.bottom - 10;
    const top =
      spaceBelow >= Math.min(estH, 220) || r.top < estH
        ? clamp(r.bottom + 6, 8, Math.max(8, vh - estH - 8))
        : Math.max(8, r.top - estH - 6);
    pop.style.top = `${top}px`;
  }
  const onDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !(anchor && anchor.contains(e.target))) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return { el: pop, close };
}

function closeAllPopovers() {
  document.querySelectorAll(".bm7-pop").forEach((p) => {
    if (typeof p._bm7Close === "function") p._bm7Close();
    else p.remove();
  });
}

/** 面板外壳：统一的标题行 + 主体 */
function panel(cls, { title, sub, actions } = {}) {
  const el = h("section.bm7-panel", { cls });
  if (title) {
    const head = h("header.bm7-panel-head", [
      h("div.bm7-panel-titles", [h("h3.bm7-panel-title", { text: title }), sub ? h("span.bm7-panel-sub", { text: sub }) : null]),
      actions ? h("div.bm7-panel-actions", actions) : null
    ]);
    el.appendChild(head);
  }
  const body = h("div.bm7-panel-body");
  el.appendChild(body);
  el._body = body;
  return el;
}

function emptyState(text, actionEl) {
  return h("div.bm7-empty", [h("span.bm7-empty-text", { text }), actionEl || null]);
}

/** 平台信息（只读） */
function platformInfo() {
  const mobile = isMobileEnv();
  return { mobile, desktop: !mobile };
}

module.exports = {
  h,
  clear,
  svgEl,
  icon,
  iconMarkup,
  setBtnIconLabel,
  ICON_PATHS,
  DAY_MS,
  WEEKDAY_CN,
  toDate,
  startOfDay,
  startOfWeek,
  startOfMonth,
  dayKey,
  sameDay,
  formatDayLabel,
  formatClock,
  formatShortDate,
  formatRelative,
  formatMinutes,
  formatCount,
  clamp,
  prefersReducedMotion,
  motionTier,
  motionEnabled,
  wait,
  hashHue,
  extractAmbientColor,
  extractAmbientPalette,
  applyAmbient,
  coverEl,
  segmented,
  toggleRow,
  button,
  iconButton,
  popover,
  closeAllPopovers,
  panel,
  emptyState,
  platformInfo
};
