const THREE = require("three");
const netabaTrendService = require("./netaba-trend-service.js");
const { inspectLocalFolder, openLocalPathSafely, parseFrontmatter } = require("./note-utils.js");
const {
  cloneDefaultLaneConfigs,
  normalizeLaneConfigs,
  getInkPigmentHex,
  drawInkWashTexture,
  getMotionSettings,
  sanitizeTrendData,
  inject3DScopedStyles,
  CoverPaletteExtractor,
  AtelierAudioEngine,
  RollingNumber,
  ScrubTitle,
  buildCelFolio,
  updateCelFolio,
  clamp,
  smooth,
  disposeTexture
} = require("./dashboard-3d-helper.js");

const POOL_ROWS = 17;
const HALF_ROWS = 8;
const COLUMN_SPACING = 2.68;
const ROW_SPACING = 0.92;
const INSPECTION_LIFT = 4.05;
const ARRAY_CAMERA = new THREE.Vector3(59.7, 37.1, 63.9);
const ARRAY_AIM = new THREE.Vector3(-0.35, 1.15, -0.45);
const DETAIL_DISTANCE = 68;
const BASE_VALLEY = new THREE.Color("#ddd4ca");

function spring(value = 0) {
  return { value, velocity: 0 };
}

function damp(state, target, rate, dt) {
  const delta = state.value - target;
  const impulse = state.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  state.value = target + (delta + impulse * dt) * decay;
  state.velocity = (state.velocity - rate * impulse * dt) * decay;
}

function wrap(value, count) {
  return count ? ((value % count) + count) % count : 0;
}

function bell(value, width) {
  return Math.exp(-0.5 * Math.pow(value / width, 2));
}

function itemId(item) {
  return item?.file?.path || String(item?.subjectId || item?.name || "");
}

function effectiveScore(item) {
  const p = Number(item?.personalScore);
  if (Number.isFinite(p) && p > 0) return p;
  const b = Number(item?.bangumiScore ?? item?.preciseScore);
  return Number.isFinite(b) && b > 0 ? b : 0;
}

function decorateDom(element) {
  if (!element || element.__atelierDecorated) return element;
  element.__atelierDecorated = true;

  if (!element.empty) {
    element.empty = () => {
      while (element.firstChild) element.removeChild(element.firstChild);
      return element;
    };
  }

  if (!element.createEl) {
    element.createEl = (tag, options = {}, callback) => {
      const child = document.createElement(tag);
      const data = typeof options === "string" ? { cls: options } : options || {};

      if (data.cls) child.className = Array.isArray(data.cls) ? data.cls.join(" ") : String(data.cls);
      if (data.text !== undefined) child.textContent = String(data.text);
      if (data.href !== undefined) child.href = data.href;
      if (data.type !== undefined) child.type = data.type;
      if (data.value !== undefined) child.value = data.value;
      if (data.title !== undefined) child.title = data.title;

      if (data.attr) {
        Object.entries(data.attr).forEach(([key, value]) => {
          if (value !== undefined && value !== null) child.setAttribute(key, String(value));
        });
      }

      decorateDom(child);
      element.appendChild(child);
      if (typeof callback === "function") callback(child);
      return child;
    };
  }

  if (!element.createDiv) {
    element.createDiv = (options = {}, callback) => element.createEl("div", options, callback);
  }

  if (!element.createSpan) {
    element.createSpan = (options = {}, callback) => element.createEl("span", options, callback);
  }

  return element;
}

class Dashboard3DSpace {
  constructor(container, plugin, options = {}) {
    this.container = container;
    this.plugin = plugin;
    this.app = plugin?.app;
    this.options = options;
    this.items = Array.isArray(options.items) ? options.items.slice() : [];

    this.isDestroyed = false;
    this.spaceState = "boot";
    this.noteSheetState = "closed"; // "closed" | "pending" | "extracting" | "open" | "retracting"
    this.noteSheetProgress = spring(0);
    this.lastSheetToggleAt = 0;
    this.noteSheetRequestId = 0;
    this.lastClickDiagnostic = null;

    this.clock = 0;
    this.lastFrame = 0;
    this.rafId = null;
    this.sleepAt = 0;
    this.timers = new Set();
    this.bootTimers = new Set();
    this.textureCache = new Map();
    this.cards = [];
    this.pulses = [];
    this.outgoingCards = [];
    this.detailFolio = null;
    this.inkHaloMesh = null;
    this.hoveredCard = null;
    this.modal = null;
    this.activeViewer = null;
    this.trendRequestId = 0;
    this.pointerDown = false;
    this.pointerMoved = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragVelocity = 0;
    this.targetDetailAngle = 0;
    this.audioGestureHandled = false;

    const savedAtelier = plugin?.settings?.dashboard3dAtelier || {};
    this.settings = Object.assign(
      {
        bootMode: "calm",
        audio: false,
        highQuality: true,
        reducedMotion: false,
        customLanes: null
      },
      savedAtelier
    );
    this.settings.customLanes = normalizeLaneConfigs(this.settings.customLanes);

    this.motion = getMotionSettings(plugin);
    this.paletteExtractor = new CoverPaletteExtractor();
    this.audio = new AtelierAudioEngine();

    this.lensMode = "status";
    this.activeLaneConfigs = [];
    this.laneNames = [];
    this.lanes = [];
    this.laneCount = 4;
    this.multiLaneItemIds = new Set();

    this.focusLane = 0;
    this.focusRow = 0;
    this.laneSelections = [0, 0, 0, 0];
    this.rail = spring(0);
    this.ridgeRow = spring(0);
    this.ridgeLane = spring(0);
    this.detailProgress = spring(0);
    this.cameraPosition = {
      x: spring(ARRAY_CAMERA.x),
      y: spring(ARRAY_CAMERA.y),
      z: spring(ARRAY_CAMERA.z)
    };
    this.cameraAim = {
      x: spring(ARRAY_AIM.x),
      y: spring(ARRAY_AIM.y),
      z: spring(ARRAY_AIM.z)
    };

    this.paletteColor = new THREE.Color("#d9c6b4");
    this.targetPalette = new THREE.Color("#d9c6b4");
    this.currentPaletteHex = "#d9c6b4";

    inject3DScopedStyles();
    this.makeLanes();
    this.initDom();
    this.initThree();
    this.buildPool();
    this.bindEvents();
    this.applyQuality();
    this.selectCurrent(false);
    this.playBoot(false);
    this.wake();
  }

  schedule(fn, delay, bucket = this.timers) {
    const timer = window.setTimeout(() => {
      bucket.delete(timer);
      if (!this.isDestroyed) fn();
    }, delay);

    bucket.add(timer);
    return timer;
  }

  clearTimers(bucket) {
    bucket.forEach((timer) => window.clearTimeout(timer));
    bucket.clear();
  }

  async saveSettings() {
    this.plugin.settings = this.plugin.settings || {};
    this.plugin.settings.dashboard3dAtelier = Object.assign({}, this.settings, {
      customLanes: normalizeLaneConfigs(this.settings.customLanes)
    });

    if (typeof this.plugin.saveSettings === "function") {
      await this.plugin.saveSettings();
    }
  }

  sortLaneItems(list, sortBy) {
    const copy = list.slice();
    if (sortBy === "bgmDesc") {
      return copy.sort((a, b) => (Number(b.bangumiScore ?? b.preciseScore) || 0) - (Number(a.bangumiScore ?? a.preciseScore) || 0));
    }
    if (sortBy === "yearDesc") {
      return copy.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || effectiveScore(b) - effectiveScore(a));
    }
    if (sortBy === "nameAsc") {
      return copy.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"));
    }
    if (sortBy === "progressDesc") {
      return copy.sort((a, b) => (Number(b.watchedEpisodes) || 0) - (Number(a.watchedEpisodes) || 0) || effectiveScore(b) - effectiveScore(a));
    }
    return copy.sort((a, b) => effectiveScore(b) - effectiveScore(a));
  }

  filterByLaneConfig(all, cfg) {
    const type = cfg.sourceType || "state";
    const val = String(cfg.sourceValue || "").trim();

    if (type === "state") {
      return all.filter((item) => (item.state || "未设置") === (val || "在看"));
    }
    if (type === "scoreRange") {
      const parts = val.split(/[-~～,，\s]+/).map(Number).filter(Number.isFinite);
      const min = parts.length >= 1 ? parts[0] : 8.0;
      const max = parts.length >= 2 ? parts[1] : 10.0;
      return all.filter((item) => {
        const s = effectiveScore(item);
        return s >= min && s <= max;
      });
    }
    if (type === "year") {
      return all.filter((item) => String(item.year || "").includes(val));
    }
    if (type === "tag") {
      const needle = val.toLowerCase();
      return all.filter((item) => {
        const tags = Array.isArray(item.tags) ? item.tags.join(",") : String(item.tags || "");
        return needle && tags.toLowerCase().includes(needle);
      });
    }
    if (type === "studio") {
      const needle = val.toLowerCase();
      return all.filter((item) => needle && String(item.studio || "").toLowerCase().includes(needle));
    }
    if (type === "manual") {
      const tokens = val.split(/[,，;；\n]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (!tokens.length) return [];
      return all.filter((item) =>
        tokens.some(
          (tok) =>
            String(item.name || "").toLowerCase().includes(tok) ||
            String(item.subjectId || "").toLowerCase() === tok
        )
      );
    }
    if (type === "unarchived") {
      return all.filter((item) => !item.state || !["在看", "已看", "想看", "抛弃"].includes(item.state));
    }
    return [];
  }

  makeLanes() {
    const all = this.items.slice();
    this.multiLaneItemIds = new Set();

    if (this.lensMode === "highscore") {
      // 独立高分精选策展模式：按可解释的四重典藏维度组织，不重复、不按取模均分
      const usedIds = new Set();
      const claim = (predicate, sortBy, badge, accent, name, plaqueNote) => {
        const matched = this.sortLaneItems(
          all.filter((item) => {
            const id = itemId(item);
            if (usedIds.has(id)) return false;
            return predicate(item);
          }),
          sortBy
        ).map((item) => {
          usedIds.add(itemId(item));
          const s = effectiveScore(item);
          return Object.assign({}, item, {
            curatedBadge: badge.split("·")[0].trim(),
            curatedScoreText: s > 0 ? s.toFixed(1) : "精选",
            laneAccent: accent,
            laneBadge: badge
          });
        });
        return {
          config: { name, badge, accent, plaqueNote, visible: true },
          items: matched
        };
      };

      // 维度 1：殿堂神作（评分 >= 8.3，若馆藏中 >=8.3 不足则取 >= 8.0 的最高冠冕之作）
      const hasVeryHigh = all.some((i) => effectiveScore(i) >= 8.3);
      const tier1Threshold = hasVeryHigh ? 8.3 : 8.05;
      const lane1 = claim(
        (item) => effectiveScore(item) >= tier1Threshold,
        "scoreDesc",
        "殿堂 · MASTERPIECE",
        "#b07d35",
        "殿堂神作 · 冠冕典藏",
        `综合评分 ≥ ${tier1Threshold.toFixed(1)} 的镇馆神作`
      );

      // 维度 2：口碑佳作（评分 >= 7.8 的高口碑代表作）
      const lane2 = claim(
        (item) => effectiveScore(item) >= 7.8,
        "bgmDesc",
        "口碑 · ACCLAIMED",
        "#8c583a",
        "口碑高分 · 公认佳作",
        "Bangumi 高分口碑代表作（7.8+）"
      );

      // 维度 3：私享偏爱（已看/在看中的高分作品或个人评分高于公允分的沧海遗珠）
      const lane3 = claim(
        (item) =>
          (Number(item.personalScore) >= 7.5) ||
          ((item.state === "已看" || item.state === "在看") && effectiveScore(item) >= 7.2),
        "scoreDesc",
        "私享 · CHERISHED",
        "#46695a",
        "私享典藏 · 已看挚爱",
        "已看完结与个人偏爱的高评价馆藏"
      );

      // 维度 4：新近高誉（2020 年以来开播的近作佳片 >= 7.4）
      const lane4 = claim(
        (item) => (Number(item.year) || 0) >= 2020 && effectiveScore(item) >= 7.4,
        "yearDesc",
        "新锐 · MODERN HIGH",
        "#4b607f",
        "新近高誉 · 近作甄选",
        "2020 年以来开播的现代高誉佳作"
      );

      const curatedLanes = [lane1, lane2, lane3, lane4];
      this.activeLaneConfigs = curatedLanes.map((l) => l.config);
      this.laneNames = this.activeLaneConfigs.map((c) => c.name);
      this.lanes = curatedLanes.map((l) => l.items);
      this.laneCount = this.lanes.length;
    } else {
      // 状态与用户自定义收藏轨道模式：严格按轨道来源规则筛选，空轨绝不克隆其他状态作品
      const configs = normalizeLaneConfigs(this.settings.customLanes).filter((c) => c.visible !== false);
      this.activeLaneConfigs = configs;
      this.laneNames = configs.map((c) => c.name);

      const seenCount = new Map();
      this.lanes = configs.map((cfg) => {
        const filtered = this.sortLaneItems(this.filterByLaneConfig(all, cfg), cfg.sortBy);
        return filtered.map((item) => {
          const id = itemId(item);
          seenCount.set(id, (seenCount.get(id) || 0) + 1);
          return Object.assign({}, item, {
            laneAccent: cfg.accent,
            laneBadge: cfg.badge,
            curatedBadge: null
          });
        });
      });

      seenCount.forEach((count, id) => {
        if (count > 1) this.multiLaneItemIds.add(id);
      });
      this.laneCount = Math.max(1, this.lanes.length);
    }

    while (this.laneSelections.length < this.laneCount) {
      this.laneSelections.push(0);
    }
    this.laneSelections.length = this.laneCount;

    if (this.focusLane >= this.laneCount) {
      this.focusLane = 0;
    }

    if (String(this.options.filterMode || "").toLowerCase() === "watching" && this.lanes[0]?.length) {
      this.focusLane = 0;
    } else if (!this.lanes[this.focusLane]?.length) {
      const firstNonEmpty = this.lanes.findIndex((lane) => lane.length > 0);
      this.focusLane = firstNonEmpty >= 0 ? firstNonEmpty : 0;
    }
  }

  el(parent, tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    decorateDom(element);
    parent?.appendChild(element);
    return element;
  }

  action(parent, name, text, handler, className = "atelier-btn") {
    const button = this.el(parent, "button", className, text);
    button.dataset.action = name;
    button.onclick = handler;
    return button;
  }

  initDom() {
    decorateDom(this.container).empty();

    this.root = this.el(this.container, "div", "bangumi-3d-root");
    this.root.dataset.spaceState = "boot";
    this.root.dataset.lensMode = this.lensMode;
    this.root.dataset.reducedMotion = String(Boolean(this.settings.reducedMotion));

    this.atmosphere = this.el(this.root, "div", "scene-atmosphere");
    this.inkBloomElement = this.el(this.root, "div", "atelier-ink-bloom");
    this.viewport = this.el(this.root, "div", "atelier-viewport");
    this.viewport.id = "viewport";
    this.ui = this.el(this.root, "div", "atelier-ui");

    const top = this.el(this.ui, "div", "atelier-top");
    top.dataset.ui = "top-bar";

    const brand = this.el(top, "div", "atelier-mark", "白昼原画室 · ATELIER CEL");
    this.brandSubElement = this.el(
      brand,
      "small",
      "",
      `BANGUMI ORIGINAL CEL ARCHIVE · 馆藏 ${this.items.length} 部`
    );

    const topActions = this.el(top, "div", "atelier-actions");
    this.lensButton = this.action(topActions, "lens", "✦ 高分精选", () => this.toggleLensMode());
    this.searchButton = this.action(topActions, "search", "⌕ 档案检索 [/]", () => this.openSearch());
    this.audioButton = this.action(topActions, "audio", "♪ 环境音景 · 已静音", () => this.toggleAudio());
    this.settingsButton = this.action(topActions, "settings", "◷ 空间设置", () => this.openSettings());
    this.exitButton = this.action(topActions, "exit", "↖ 返回仪表盘", () => this.onExit3D?.());

    this.curationBanner = this.el(this.ui, "div", "atelier-curation-banner");
    this.curationBanner.dataset.ui = "curation-banner";

    const bottom = this.el(this.ui, "div", "atelier-bottom");
    bottom.dataset.ui = "bottom-bar";

    const counter = this.el(bottom, "div", "atelier-counter-box");
    const laneControl = this.el(counter, "div", "atelier-row");
    this.action(laneControl, "lane-prev", "←", () => this.move(-1, 0));
    this.laneElement = this.el(laneControl, "span", "atelier-lane-eyebrow", "");
    this.action(laneControl, "lane-next", "→", () => this.move(1, 0));

    const numberRow = this.el(counter, "div", "atelier-counter-numbers");
    this.numberElement = this.el(numberRow, "span", "atelier-number", "01");
    this.rollingNumber = new RollingNumber(this.numberElement, 1);
    this.el(numberRow, "span", "atelier-counter-sep", " / ");
    this.totalElement = this.el(numberRow, "span", "atelier-total", "00");

    const callout = this.el(bottom, "div", "atelier-callout-box");
    this.focusMeta = this.el(callout, "div", "atelier-meta", "");
    this.titleElement = this.el(callout, "div", "atelier-title", "档案阵列");
    this.titleScrub = new ScrubTitle(this.titleElement);
    this.el(callout, "div", "atelier-callout-line");
    this.readButton = this.action(callout, "read-detail", "读取档案 →", () => this.enterDetail());

    const bottomRight = this.el(bottom, "div", "atelier-bottom-right");
    this.ticks = this.el(bottomRight, "div", "file-ticks");
    this.action(bottomRight, "row-prev", "↑", () => this.move(0, -1));
    this.action(bottomRight, "row-next", "↓", () => this.move(0, 1));
    this.action(bottomRight, "replay-boot", "重播序幕 ↻", () => this.playBoot(true));

    this.hoverElement = this.el(this.ui, "div", "atelier-hover");
    this.hoverElement.dataset.ui = "hover-label";

    this.detailElement = this.el(this.ui, "aside", "atelier-detail");
    this.detailElement.dataset.ui = "detail-panel";

    this.noteSheetElement = this.el(this.ui, "article", "atelier-note-sheet");
    this.noteSheetElement.dataset.ui = "note-sheet";

    this.renderCurationBanner();
    this.updateToolbar();
  }

  renderCurationBanner() {
    if (!this.curationBanner) return;
    this.curationBanner.empty();
    this.el(this.curationBanner, "span", "atelier-curation-eyebrow", "✦ 高分策展四柱 ／ CURATED HALL");

    this.activeLaneConfigs.forEach((cfg, idx) => {
      const count = (this.lanes[idx] || []).length;
      const pill = this.el(
        this.curationBanner,
        "button",
        "atelier-curation-pill",
        `${cfg.badge.split("·")[0].trim()} · ${cfg.name.split("·")[0].trim()} (${count})`
      );
      pill.dataset.laneIndex = String(idx);
      if (idx === this.focusLane) pill.classList.add("is-active");
      pill.onclick = () => {
        const delta = idx - this.focusLane;
        if (delta !== 0) this.move(delta, 0);
        this.renderCurationBanner();
      };
    });
  }

  initThree() {
    const width = this.viewport.clientWidth || 960;
    const height = this.viewport.clientHeight || 640;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.viewport.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog("#eae5e1", 68, 138);

    this.camera = new THREE.PerspectiveCamera(4.6, width / height, 0.1, 240);
    this.camera.position.copy(ARRAY_CAMERA);
    this.camera.lookAt(ARRAY_AIM);

    this.scene.add(new THREE.HemisphereLight(0xfffdf8, 0xded7ce, 2.2));

    const key = new THREE.DirectionalLight(0xfffbf3, 2.05);
    key.position.set(-16, 28, 24);
    this.scene.add(key);

    this.archiveGroup = new THREE.Group();
    this.scene.add(this.archiveGroup);

    // 详情态 3D 墨水/水彩晕染背光环（随档案抽出在封套背后扩散）
    const inkGeo = new THREE.PlaneGeometry(6.8, 6.8);
    const inkMat = new THREE.MeshBasicMaterial({
      map: drawInkWashTexture(this.currentPaletteHex),
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    this.inkHaloMesh = new THREE.Mesh(inkGeo, inkMat);
    this.inkHaloMesh.visible = false;
    this.archiveGroup.add(this.inkHaloMesh);

    this.addRegistrationLines();
    this.pointer = new THREE.Vector2(-10, -10);
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  laneX(lane) {
    const centerOffset = (this.laneCount - 1) / 2;
    return (lane - centerOffset) * COLUMN_SPACING;
  }

  addRegistrationLines() {
    if (this.registrationLines) {
      this.archiveGroup.remove(this.registrationLines);
      this.disposeObject(this.registrationLines);
      this.registrationLines = null;
    }

    const points = [];
    const halfWidth = Math.max(8, (this.laneCount * COLUMN_SPACING) / 2 + 2.4);

    for (let lane = 0; lane < this.laneCount; lane += 1) {
      const x = this.laneX(lane);
      points.push(x, -0.15, -21, x, -0.15, 21);
    }

    for (let row = -24; row <= 24; row += 1) {
      const z = row * ROW_SPACING;
      points.push(-halfWidth, -0.15, z, halfWidth, -0.15, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));

    this.registrationLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xc6beb2,
        transparent: true,
        opacity: 0.22
      })
    );
    this.archiveGroup.add(this.registrationLines);
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.settings.highQuality ? Math.min(1.75, dpr) : 1);
    this.renderer.shadowMap.enabled = Boolean(this.settings.highQuality);
    this.resize();
  }

  laneItem(lane, logicalRow) {
    const source = this.lanes[lane] || [];
    const cfg = this.activeLaneConfigs[lane] || {};
    const count = source.length;
    const laneMeta = {
      laneLabel: this.laneNames[lane] || `轨道 ${lane + 1}`,
      laneBadge: cfg.badge || `TRACK 0${lane + 1}`,
      laneAccent: cfg.accent || "#9b7247",
      plaqueNote: cfg.plaqueNote || ""
    };

    if (!count) {
      if (logicalRow === 0) {
        return Object.assign({}, laneMeta, {
          slotType: "divider",
          isEmptyLane: true,
          dividerLabel: `${laneMeta.laneLabel} · 暂无条目`,
          name: `${laneMeta.laneLabel}（空轨）`
        });
      }
      return Object.assign({}, laneMeta, {
        slotType: "blank",
        name: "空白定位卡"
      });
    }

    if (count < 8) {
      const start = -Math.floor((count - 1) / 2);
      const end = start + count - 1;

      if (logicalRow >= start && logicalRow <= end) {
        return Object.assign({}, laneMeta, source[logicalRow - start], {
          slotType: "anime"
        });
      }

      if (logicalRow === start - 1 || logicalRow === end + 1) {
        return Object.assign({}, laneMeta, {
          slotType: "divider",
          isEmptyLane: false,
          dividerLabel: `${laneMeta.laneLabel} · 共 ${count} 部`,
          name: "章节隔板"
        });
      }

      return Object.assign({}, laneMeta, {
        slotType: "blank",
        name: "空白定位卡"
      });
    }

    const period = count + 1;
    const index = wrap(logicalRow, period);

    if (index === count) {
      return Object.assign({}, laneMeta, {
        slotType: "divider",
        isEmptyLane: false,
        dividerLabel: `${laneMeta.laneLabel} · 共 ${count} 部`,
        name: "章节隔板"
      });
    }

    return Object.assign({}, laneMeta, source[index], { slotType: "anime" });
  }

  isCardLocked(card) {
    if (!card) return false;
    if (this.detailFolio?.sourceCard === card) return true;
    return this.outgoingCards.some((entry) => entry.sourceCard === card);
  }

  cardRenderKey(lane, logicalRow, item) {
    if (!item) return `${lane}:${logicalRow}:null`;
    if (item.slotType === "blank") return `${lane}:blank`;
    if (item.slotType === "divider") {
      return `${lane}:divider:${item.dividerLabel || ""}:${item.laneBadge || ""}:${item.plaqueNote || ""}`;
    }
    return `${lane}:anime:${itemId(item)}:${item.laneBadge || ""}:${item.curatedBadge || ""}:${item.personalScore ?? ""}:${item.watchedEpisodes ?? ""}:${item.state || ""}:${this.multiLaneItemIds.has(itemId(item)) ? 1 : 0}`;
  }

  buildPool() {
    this.cards.forEach((card) => {
      card.group?.parent?.remove(card.group);
      this.disposeObject(card.group);
    });
    this.cards = [];

    for (let slotRow = -HALF_ROWS; slotRow <= HALF_ROWS; slotRow += 1) {
      for (let lane = 0; lane < this.laneCount; lane += 1) {
        const item = this.laneItem(lane, slotRow);
        const card = {
          lane,
          slotRow,
          logicalRow: slotRow,
          item,
          itemId: itemId(item),
          renderKey: this.cardRenderKey(lane, slotRow, item),
          group: buildCelFolio(item, { slotType: item.slotType }),
          lift: spring(0),
          angle: spring(0),
          quality: spring(0),
          hover: spring(0),
          valley: BASE_VALLEY.clone(),
          targetValley: BASE_VALLEY.clone()
        };

        this.cards.push(card);
        this.archiveGroup.add(card.group);
        this.loadCover(card);
      }
    }

    this.remapPool(true, false);
  }

  rebuildPoolAndLines() {
    const prevCount = this.cards.length ? Math.round(this.cards.length / POOL_ROWS) : 0;
    this.makeLanes();
    this.addRegistrationLines();
    if (prevCount !== this.laneCount) {
      this.buildPool();
    } else {
      this.remapPool(true, true);
    }
    this.hoveredCard = null;
    this.hoverElement?.classList.remove("is-visible");
    this.renderCurationBanner();
    this.selectCurrent(true);
    this.wake();
  }

  replaceCardModel(card, item, forceVisual = false) {
    const nextKey = this.cardRenderKey(card.lane, card.logicalRow, item);
    card.item = item;
    card.itemId = itemId(item);
    if (!forceVisual && card.group && card.renderKey === nextKey) {
      return;
    }
    card.renderKey = nextKey;
    if (!card.group) {
      card.group = buildCelFolio(item, { slotType: item.slotType });
      this.archiveGroup.add(card.group);
    } else {
      updateCelFolio(card.group, item, { slotType: item.slotType });
    }
    this.loadCover(card);
  }

  remapPool(force = false, forceVisual = false) {
    const center = Math.round(this.rail.value / ROW_SPACING);

    const lockedRowsByLane = new Map();
    this.cards.forEach((card) => {
      if (this.isCardLocked(card)) {
        if (!lockedRowsByLane.has(card.lane)) lockedRowsByLane.set(card.lane, new Set());
        lockedRowsByLane.get(card.lane).add(card.logicalRow);
      }
    });

    if (force) {
      this.cards.forEach((card) => {
        if (this.isCardLocked(card)) return;
        let logicalRow = card.logicalRow;
        const d = logicalRow - center;
        if (Math.abs(d) > HALF_ROWS) {
          const offset = ((d + HALF_ROWS) % POOL_ROWS + POOL_ROWS) % POOL_ROWS - HALF_ROWS;
          logicalRow = center + offset;
        }
        const lockedSet = lockedRowsByLane.get(card.lane);
        if (lockedSet && lockedSet.has(logicalRow) && logicalRow !== card.logicalRow) {
          return;
        }
        card.logicalRow = logicalRow;
        const item = this.laneItem(card.lane, card.logicalRow);
        this.replaceCardModel(card, item, forceVisual);
      });
      return;
    }

    this.cards.forEach((card) => {
      if (this.isCardLocked(card)) return;

      let nextRow = card.logicalRow;
      let changed = false;
      while (nextRow < center - HALF_ROWS) {
        nextRow += POOL_ROWS;
        changed = true;
      }
      while (nextRow > center + HALF_ROWS) {
        nextRow -= POOL_ROWS;
        changed = true;
      }

      if (changed) {
        const lockedSet = lockedRowsByLane.get(card.lane);
        if (lockedSet && lockedSet.has(nextRow)) {
          return;
        }
        card.logicalRow = nextRow;
        const item = this.laneItem(card.lane, card.logicalRow);
        this.replaceCardModel(card, item, false);
      }
    });
  }

  remapSingleCardIfOutOfWindow(card) {
    if (!card || this.isCardLocked(card)) return;
    const center = Math.round(this.rail.value / ROW_SPACING);
    let nextRow = card.logicalRow;
    let changed = false;
    while (nextRow < center - HALF_ROWS) {
      nextRow += POOL_ROWS;
      changed = true;
    }
    while (nextRow > center + HALF_ROWS) {
      nextRow -= POOL_ROWS;
      changed = true;
    }
    if (!changed) return;

    const occupied = this.cards.some(
      (other) => other !== card && other.lane === card.lane && other.logicalRow === nextRow
    );
    if (occupied) return;

    card.logicalRow = nextRow;
    const item = this.laneItem(card.lane, card.logicalRow);
    this.replaceCardModel(card, item, false);
  }

  ensureFocusRowInPoolWindow() {
    const maxLagRows = HALF_ROWS - 2;
    const targetRail = this.focusRow * ROW_SPACING;
    const maxLagDist = maxLagRows * ROW_SPACING;
    if (targetRail - this.rail.value > maxLagDist) {
      this.rail.value = targetRail - maxLagDist;
    } else if (this.rail.value - targetRail > maxLagDist) {
      this.rail.value = targetRail + maxLagDist;
    }

    const center = Math.round(this.rail.value / ROW_SPACING);
    this.lastPoolCenter = center;
    this.remapPool(false, false);

    if (!this.currentCard()) {
      const candidates = this.cards.filter(
        (c) => c.lane === this.focusLane && !this.isCardLocked(c)
      );
      if (candidates.length > 0) {
        candidates.sort(
          (a, b) => Math.abs(b.logicalRow - this.focusRow) - Math.abs(a.logicalRow - this.focusRow)
        );
        const chosen = candidates[0];
        chosen.logicalRow = this.focusRow;
        const item = this.laneItem(chosen.lane, chosen.logicalRow);
        this.replaceCardModel(chosen, item, false);
      }
    }
  }

  loadCover(card) {
    const data = card.group?.userData;

    if (card.item.slotType !== "anime") {
      if (data?.poster?.material?.map) {
        data.poster.material.map = null;
        data.poster.material.needsUpdate = true;
      }
      return;
    }

    let url = "";

    try {
      url = this.plugin.getCoverResourceUrl(card.item.cover, card.item.file?.path || "");
    } catch (error) {
      url = "";
    }

    if (!url) {
      if (data?.poster?.material?.map) {
        data.poster.material.map = null;
        data.poster.material.needsUpdate = true;
      }
      return;
    }

    const currentItemId = card.itemId;

    const apply = (texture) => {
      if (this.isDestroyed || !card.group?.userData) return;
      if (card.itemId !== currentItemId) return;
      const d = card.group.userData;

      // 仅在 poster 层挂载高清封面贴图，不在 cover 层重复挂载，彻底消除双层视差重影与白雾
      if (d.poster?.material) {
        d.poster.material.map = texture;
        d.poster.material.needsUpdate = true;
      }

      if (this.selectedCard === card) {
        this.paletteExtractor.extract(url).then((hex) => {
          if (!this.isDestroyed && this.selectedCard === card) this.setPalette(hex);
        });
      }
    };

    if (this.textureCache.has(url)) {
      apply(this.textureCache.get(url));
      return;
    }

    new THREE.TextureLoader().load(url, (texture) => {
      if (this.isDestroyed) {
        texture.dispose();
        return;
      }

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.textureCache.set(url, texture);
      apply(texture);
    });
  }

  bindEvents() {
    this.updatePointer = (e) => {
      const r = this.viewport.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      return true;
    };

    this.onPointerMove = (event) => {
      if (!this.updatePointer(event)) return;

      if (this.pointerDown && this.spaceState === "detail" && this.detailFolio) {
        const delta = event.clientX - this.dragStartX;
        if (Math.abs(delta) > 2) {
          this.dragStartX = event.clientX;
          this.dragVelocity = delta * 0.0065;
          this.targetDetailAngle = clamp(this.targetDetailAngle + this.dragVelocity, -0.85, 0.85);
          this.pointerMoved = true;
          this.wake();
          return;
        }
      }

      this.updateHover();
      this.wake();
    };

    this.onPointerLeave = () => {
      this.hoveredCard = null;
      this.hoverElement?.classList.remove("is-visible");
      this.viewport.style.cursor = "default";
    };

    this.onPointerDown = async (event) => {
      this.updatePointer(event);
      this.pointerDown = true;
      this.pointerMoved = false;
      this.pointerDownX = event.clientX;
      this.pointerDownY = event.clientY;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;

      if (this.settings.audio && !this.audioGestureHandled) {
        this.audioGestureHandled = true;
        await this.audio.setEnabled(true, true);
        this.updateToolbar();
      }

      this.wake();
    };

    this.onPointerUp = (event) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.updatePointer(event);

      const totalMoved = Math.hypot(
        event.clientX - (this.pointerDownX ?? this.dragStartX),
        event.clientY - (this.pointerDownY ?? this.dragStartY)
      );

      if (this.spaceState === "detail" && (this.pointerMoved || totalMoved >= 6)) {
        this.targetDetailAngle = clamp(this.targetDetailAngle + this.dragVelocity * 0.14, -0.85, 0.85);
      } else if (!this.pointerMoved && totalMoved < 6) {
        this.handleClick(event);
      }

      this.wake();
    };

    this.onWheel = (event) => {
      // 当鼠标位于笔记纸页、详情面板或模态窗内部时，优先滚动容器内容，不拦截原生滚轮
      if (
        event.target?.closest?.(
          ".atelier-note-sheet, .atelier-detail, .atelier-modal, .atelier-viewer"
        )
      ) {
        return;
      }
      event.preventDefault();
      if (this.spaceState === "array") this.move(0, event.deltaY > 0 ? 1 : -1);
    };

    this.onKeyDown = async (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // Esc 严格优先级：360° 查看器 -> 设置或检索模态 -> 笔记纸页 -> 详情封套归位
        if (this.activeViewer) return this.activeViewer.close();
        if (this.modal) return this.closeModal();
        if (this.noteSheetState !== "closed") return this.closeNoteSheet();
        if (this.spaceState === "detail" || this.spaceState === "entering-detail") return this.leaveDetail();
        return;
      }

      const tag = event.target?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (this.settings.audio && !this.audioGestureHandled) {
        this.audioGestureHandled = true;
        await this.audio.setEnabled(true, true);
        this.updateToolbar();
      }

      if (event.key === "/") {
        event.preventDefault();
        return this.openSearch();
      }

      if (event.key === "Enter") {
        event.preventDefault();
        return this.enterDetail();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        return this.move(-1, 0);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        return this.move(1, 0);
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        return this.move(0, -1);
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        return this.move(0, 1);
      }
    };

    this.onVisibility = () => {
      if (document.hidden) {
        this.audio.fadeOutAndSuspend();
        this.stopLoop();
      } else {
        this.wake();
      }
    };

    this.onResize = () => {
      this.resize();
      this.wake();
    };

    this.viewport.addEventListener("pointermove", this.onPointerMove);
    this.viewport.addEventListener("pointerleave", this.onPointerLeave);
    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.container);
  }

  updateHover() {
    if (this.spaceState !== "array") {
      this.hoveredCard = null;
      this.viewport.style.cursor = "default";
      this.hoverElement?.classList.remove("is-visible");
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);

    const visibleAnimeGroups = this.cards
      .filter((c) => c.group.visible && c.item.slotType === "anime")
      .map((c) => c.group);

    const hit = this.raycaster.intersectObjects(
      visibleAnimeGroups,
      true
    )[0];

    const card = hit ? this.cardFromObject(hit.object) : null;

    if (!card || card.item.slotType !== "anime") {
      this.hoveredCard = null;
      this.viewport.style.cursor = "default";
      this.hoverElement.classList.remove("is-visible");
      return;
    }

    this.hoveredCard = card;
    this.viewport.style.cursor = "pointer";

    const item = card.item;
    const progress = item.totalEpisodes
      ? `${Number(item.watchedEpisodes) || 0}/${item.totalEpisodes}话`
      : `${Number(item.watchedEpisodes) || 0}话`;

    this.hoverElement.textContent =
      `▶ 点击拆阅详情 ｜ BGM-${String(item.subjectId || "000").slice(-3).padStart(3, "0")} · ${item.state || "未设置"} (${progress}) · 《${item.name}》`;

    this.hoverElement.classList.add("is-visible");
  }

  cardFromObject(object) {
    let node = object;

    while (node) {
      const card = this.cards.find((entry) => entry.group === node);
      if (card) return card;
      node = node.parent;
    }

    return null;
  }

  cardSnapshot(card) {
    return {
      item: card.item,
      itemId: itemId(card.item),
      lane: card.lane,
      logicalRow: card.logicalRow,
      position: card.group.position.clone(),
      valley: card.valley.clone(),
      targetValley: card.targetValley.clone(),
      visualHeight: card.group.position.y,
      sourceCard: card
    };
  }

  calcNavRow(lane, baseRow, delta) {
    const list = this.lanes[lane] || [];
    const count = list.length;
    if (!count) return 0;
    if (count < 8) {
      const start = -Math.floor((count - 1) / 2);
      const end = start + count - 1;
      let next = baseRow + delta;
      if (next > end) next = start;
      else if (next < start) next = end;
      return next;
    }
    let next = baseRow + delta;
    if (wrap(next, count + 1) === count) {
      next += (delta >= 0 ? 1 : -1);
    }
    return next;
  }

  handleClick(event) {
    this.updatePointer(event);
    const elAtPoint = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)
      : event.target;

    const diag = {
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      elementFromPointTag: elAtPoint?.tagName || null,
      elementFromPointClass: elAtPoint?.className || "",
      eventTargetTag: event.target?.tagName || null,
      spaceStateBefore: this.spaceState,
      noteSheetStateBefore: this.noteSheetState,
      hitType: "none",
      actionTaken: "none"
    };
    this.lastClickDiagnostic = diag;

    if (this.spaceState === "array" || this.spaceState === "leaving-detail") {
      this.pickDirect(diag);
      return;
    }

    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      // 1. 若点击落在详情态实际可见的 UI 控件区域（详情面板、已打开的笔记纸页、顶栏按钮、模态窗、360查看器），不触发归位
      if (
        event.target?.closest?.(
          ".atelier-detail, .atelier-note-sheet.is-open, .atelier-top > *, .atelier-modal, .atelier-viewer"
        )
      ) {
        diag.hitType = "ui-control";
        diag.actionTaken = "preserve-state";
        return;
      }

      this.raycaster.setFromCamera(this.pointer, this.camera);

      // 2. 检测是否点击了当前正在检视的档案封套本体
      const hitDetail = this.detailFolio
        ? this.raycaster.intersectObject(this.detailFolio.group, true)
        : [];

      if (hitDetail.length > 0) {
        diag.hitType = "active-detail-folio";
        diag.actionTaken = this.onClickActiveFolio();
        return;
      }

      // 3. 检测是否点击了背景中另一张真实动画档案（slotType === "anime"）
      const visibleCardGroups = this.cards
        .filter((card) => card.group.visible && card.item.slotType === "anime")
        .map((card) => card.group);

      const hitCard = this.raycaster.intersectObjects(visibleCardGroups, true)[0];
      const targetCard = hitCard ? this.cardFromObject(hitCard.object) : null;

      if (
        targetCard &&
        targetCard.item.slotType === "anime" &&
        (targetCard !== this.detailFolio?.sourceCard || itemId(targetCard.item) !== this.detailFolio?.itemId)
      ) {
        diag.hitType = "background-anime-card";
        diag.actionTaken = `switch-detail:${targetCard.item.name}`;

        this.closeNoteSheet(true);
        this.queueDetailOutgoing();
        this.activeDetailSnapshot = this.cardSnapshot(targetCard);

        this.focusLane = targetCard.lane;
        this.focusRow = targetCard.logicalRow;
        this.laneSelections[targetCard.lane] = targetCard.logicalRow;
        this.selectedCard = targetCard;
        this.selectedItem = targetCard.item;

        this.createDetailFolio(this.selectedCard.item, this.selectedCard);
        this.selectCurrent(false);
        this.pulses.push({
          lane: this.focusLane,
          row: this.focusRow,
          time: this.clock,
          strength: 0.24
        });
        this.spaceState = "entering-detail";
        this.root.dataset.spaceState = "entering-detail";
        this.renderDetail(this.detailFolio.item);
        this.audio.cue("open");
        this.wake();
        return;
      }

      // 4. 若笔记纸页处于打开或抽出中，点击纸页外的画布空白处优先优雅收回纸页，保持详情态
      if (this.noteSheetState === "open" || this.noteSheetState === "extracting") {
        diag.hitType = "canvas-outside-notesheet";
        diag.actionTaken = "retract-notesheet-keep-detail";
        this.closeNoteSheet();
        return;
      }

      // 5. 其他任何三维画布区域（背景、空轨、定位线、低矮空白定位卡、章节隔板、非 UI 空白处）一律触发归位
      diag.hitType = "canvas-blank";
      diag.actionTaken = "leave-detail";
      this.leaveDetail();
    }
  }

  onClickActiveFolio() {
    const now = performance.now();
    if (now - this.lastSheetToggleAt < 220) {
      return "debounced-folio-click";
    }
    this.lastSheetToggleAt = now;

    if (this.spaceState === "entering-detail") {
      // 升起过程中再次点击当前封套：记录预约请求，到位后自动抽出笔记纸页，绝不中途硬切穿模
      this.noteSheetState = "pending";
      this.updateFolioSheetHint();
      this.audio.cue("tick");
      this.wake();
      return "queued-pending-notesheet";
    }

    if (this.spaceState === "detail") {
      if (this.noteSheetState === "open" || this.noteSheetState === "extracting") {
        this.closeNoteSheet();
        return "retract-notesheet";
      }
      this.openNoteSheet();
      return "extract-notesheet";
    }

    return "noop";
  }

  pickDirect(diag = null) {
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 若正在归位途中用户再次点击正在下降的 detailFolio，直接平滑恢复升起
    if (this.spaceState === "leaving-detail" && this.detailFolio) {
      const hitReturning = this.raycaster.intersectObject(this.detailFolio.group, true);
      if (hitReturning.length > 0) {
        if (diag) {
          diag.hitType = "returning-detail-folio";
          diag.actionTaken = `resume-detail:${this.detailFolio.item.name}`;
        }
        this.detailFolio.returnPhase = null;
        this.detailFolio.phase = "active";
        this.enterDetail();
        return;
      }
    }

    const visibleAnimeGroups = this.cards
      .filter((c) => c.group.visible && c.item.slotType === "anime")
      .map((c) => c.group);

    const hit = this.raycaster.intersectObjects(
      visibleAnimeGroups,
      true
    )[0];

    const card = hit ? this.cardFromObject(hit.object) : null;
    if (!card || card.item.slotType !== "anime") {
      if (diag) {
        diag.hitType = "array-blank";
        diag.actionTaken = "noop";
      }
      return;
    }

    if (diag) {
      diag.hitType = "array-anime-card";
      diag.actionTaken = `enter-detail:${card.item.name}`;
    }

    this.activeDetailSnapshot = this.cardSnapshot(card);
    this.focusLane = card.lane;
    this.focusRow = card.logicalRow;
    this.laneSelections[card.lane] = card.logicalRow;
    this.selectedCard = card;
    this.selectedItem = card.item;

    this.createDetailFolio(
      this.selectedCard.item,
      this.selectedCard
    );

    this.selectCurrent(false);
    this.pulses.push({
      lane: this.focusLane,
      row: this.focusRow,
      time: this.clock,
      strength: 0.28
    });
    this.enterDetail();
  }

  currentCard() {
    return this.cards.find((card) => (
      card.lane === this.focusLane &&
      card.logicalRow === this.focusRow
    )) || null;
  }

  selectCurrent(withPulse = true) {
    const card = this.currentCard();
    const item = card ? card.item : this.laneItem(this.focusLane, this.focusRow);
    if (!item) return;

    if (card) {
      this.selectedCard = card;
    }
    this.selectedItem = item;

    const lane = this.lanes[this.focusLane] || [];
    const cfg = this.activeLaneConfigs[this.focusLane] || {};
    let index = 0;
    if (lane.length) {
      if (lane.length < 8) {
        const start = -Math.floor((lane.length - 1) / 2);
        index = clamp(this.focusRow - start, 0, lane.length - 1);
      } else {
        index = wrap(this.focusRow, lane.length + 1);
        if (index >= lane.length) index = 0;
      }
    }

    const isEmptyLane = lane.length === 0;
    this.titleScrub.set(
      isEmptyLane
        ? `《${this.laneNames[this.focusLane]} · 暂无条目》`
        : `《${item.name || "暂无档案"}》`
    );

    const multiNote = !isEmptyLane && this.multiLaneItemIds.has(itemId(item))
      ? " · 策展共现"
      : "";

    this.focusMeta.textContent = isEmptyLane
      ? `${cfg.badge || "LANE EMPTY"} · ${this.laneNames[this.focusLane]} · ${cfg.plaqueNote || "当前轨道下暂无收录动画"}`
      : `FILE BGM-${String(item.subjectId || "000").slice(-3).padStart(3, "0")} · ${item.state || this.laneNames[this.focusLane]} · ${item.year || "年份未记"} ${item.season || ""}${multiNote}`;

    this.laneElement.textContent =
      `LANE ${String(this.focusLane + 1).padStart(2, "0")} / ${String(this.laneCount).padStart(2, "0")} · ${this.laneNames[this.focusLane]}`;

    this.rollingNumber.set(isEmptyLane ? 0 : index + 1);
    this.totalElement.textContent = String(lane.length).padStart(2, "0");
    this.renderTicks(lane.length, index);
    this.renderCurationBanner();

    if (withPulse && item.slotType === "anime") {
      this.pulses.push({
        lane: this.focusLane,
        row: this.focusRow,
        time: this.clock,
        strength: 0.45
      });
    }

    if (card && card.item.slotType === "anime") {
      this.setCardPalette(card);
    } else if (item.cover) {
      let url = "";
      try {
        url = this.plugin.getCoverResourceUrl(item.cover, item.file?.path || "");
      } catch (error) {
        url = "";
      }
      if (url) {
        this.paletteExtractor.extract(url).then((hex) => {
          if (!this.isDestroyed && this.selectedItem === item) this.setPalette(hex);
        });
      }
    }
  }

  renderTicks(total, active) {
    this.ticks.empty();
    const count = clamp(total || 1, 1, 18);

    for (let index = 0; index < count; index += 1) {
      const tick = this.el(this.ticks, "span", "file-tick");
      if (index === active % count) tick.classList.add("is-active");
    }
  }

  setCardPalette(card) {
    if (card.item.slotType !== "anime") return;

    let url = "";

    try {
      url = this.plugin.getCoverResourceUrl(card.item.cover, card.item.file?.path || "");
    } catch (error) {
      url = "";
    }

    if (!url) return;

    this.paletteExtractor.extract(url).then((hex) => {
      if (!this.isDestroyed && (this.selectedCard === card || this.detailFolio?.itemId === card.itemId)) {
        this.setPalette(hex);
      }
    });
  }

  setPalette(hex) {
    this.currentPaletteHex = hex || "#d9c6b4";
    this.targetPalette.set(this.currentPaletteHex);
    const pigmentHex = getInkPigmentHex(this.currentPaletteHex);
    this.root.style.setProperty("--cel-aura-color", this.currentPaletteHex);
    this.root.style.setProperty("--cel-ink-pigment", pigmentHex);

    if (this.inkHaloMesh?.material) {
      if (this.inkHaloMesh.material.map) {
        disposeTexture(this.inkHaloMesh.material.map);
      }
      this.inkHaloMesh.material.map = drawInkWashTexture(this.currentPaletteHex);
      this.inkHaloMesh.material.needsUpdate = true;
    }
  }

  createDetailFolioFromSnapshot(snapshot) {
    if (!snapshot) return;
    this.activeDetailSnapshot = snapshot;
    this.createDetailFolio(snapshot.item, snapshot.sourceCard);
  }

  createDetailFolio(item, sourceCard) {
    if (this.detailFolio && this.detailFolio.sourceCard === sourceCard && this.detailFolio.itemId === itemId(item)) {
      this.detailFolio.phase = "active";
      this.detailFolio.returnPhase = null;
      return;
    }

    const existing = this.outgoingCards.find(
      (entry) =>
        entry.sourceCard === sourceCard ||
        (entry.itemId === itemId(item) &&
          entry.lane === sourceCard?.lane &&
          entry.logicalRow === sourceCard?.logicalRow)
    );

    if (existing) {
      if (this.detailFolio) {
        this.queueDetailOutgoing();
      }
      this.outgoingCards = this.outgoingCards.filter((entry) => entry !== existing);
      this.detailFolio = existing;
      if (sourceCard) {
        this.detailFolio.sourceCard = sourceCard;
        if (sourceCard.group) sourceCard.group.visible = false;
      }
      this.detailFolio.phase = "active";
      this.detailFolio.returnPhase = null;
      this.targetDetailAngle = this.detailFolio.angle.value;
      return;
    }

    if (this.detailFolio) {
      this.queueDetailOutgoing();
    }

    const group = buildCelFolio(item, {
      slotType: "anime",
      sharedSourceGroup: sourceCard?.group
    });
    const useSnapshot = this.activeDetailSnapshot && this.activeDetailSnapshot.itemId === itemId(item);
    const start = sourceCard?.group?.position
      ? sourceCard.group.position.clone()
      : (useSnapshot && this.activeDetailSnapshot.position
          ? this.activeDetailSnapshot.position.clone()
          : new THREE.Vector3());

    group.position.copy(start);
    group.userData.folioTiltGroup.rotation.x =
      sourceCard?.group?.userData?.folioTiltGroup?.rotation?.x ?? -0.2;
    this.archiveGroup.add(group);

    // 明确区分：slotPos 为源池卡实时阵列槽位位置，lift 仅代表相对槽位的额外升起量（从 0 起步，归位至 0 交接）
    const detail = {
      item,
      itemId: itemId(item),
      group,
      sourceCard: sourceCard || null,
      lane: sourceCard?.lane ?? (useSnapshot ? this.activeDetailSnapshot.lane : this.focusLane),
      logicalRow: sourceCard?.logicalRow ?? (useSnapshot ? this.activeDetailSnapshot.logicalRow : this.focusRow),
      slotPos: start.clone(),
      sourcePosition: start.clone(),
      lift: spring(0),
      holdLift: INSPECTION_LIFT,
      angle: spring(sourceCard?.angle?.value || 0),
      quality: spring(sourceCard ? sourceCard.quality.value : 0.35),
      valley: sourceCard?.valley
        ? sourceCard.valley.clone()
        : (useSnapshot && this.activeDetailSnapshot.valley
            ? this.activeDetailSnapshot.valley.clone()
            : BASE_VALLEY.clone()),
      targetValley: sourceCard?.targetValley
        ? sourceCard.targetValley.clone()
        : (useSnapshot && this.activeDetailSnapshot.targetValley
            ? this.activeDetailSnapshot.targetValley.clone()
            : BASE_VALLEY.clone()),
      phase: "active",
      returnPhase: null
    };

    if (sourceCard?.group) {
      sourceCard.group.visible = false;
    }

    this.detailFolio = detail;
    this.targetDetailAngle = 0;
    this.loadDetailCover(detail);
  }

  loadDetailCover(detail) {
    let url = "";

    try {
      url = this.plugin.getCoverResourceUrl(detail.item.cover, detail.item.file?.path || "");
    } catch (error) {
      url = "";
    }

    if (!url) return;

    const apply = (texture) => {
      const data = detail.group?.userData;
      if (data?.poster?.material) {
        data.poster.material.map = texture;
        data.poster.material.needsUpdate = true;
      }
      // 同步确保源池卡也持有同一张封面贴图，消除归位交接瞬间任何贴图切换可能
      const srcData = detail.sourceCard?.group?.userData;
      if (srcData?.poster?.material && detail.sourceCard.itemId === detail.itemId) {
        srcData.poster.material.map = texture;
        srcData.poster.material.needsUpdate = true;
      }
      this.paletteExtractor.extract(url).then((hex) => {
        if (!this.isDestroyed && this.detailFolio === detail) {
          this.setPalette(hex);
        }
      });
    };

    if (this.textureCache.has(url)) {
      apply(this.textureCache.get(url));
      return;
    }

    new THREE.TextureLoader().load(url, (texture) => {
      if (this.isDestroyed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.textureCache.set(url, texture);
      apply(texture);
    });
  }

  queueDetailOutgoing() {
    if (!this.detailFolio) return;

    const noteSheetMesh = this.detailFolio.group?.userData?.noteSheetMesh;
    if (noteSheetMesh) {
      noteSheetMesh.visible = false;
      noteSheetMesh.position.set(0, 0, 0.018);
      noteSheetMesh.rotation.z = 0;
    }

    this.detailFolio.holdLift = this.detailFolio.lift.value;
    this.detailFolio.phase =
      Math.abs(this.detailFolio.angle.value) > 0.012 ? "align" : "lower";
    this.outgoingCards.push(this.detailFolio);
    this.detailFolio = null;
  }

  move(laneDelta, rowDelta) {
    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();

      this.focusLane = wrap(this.focusLane + laneDelta, this.laneCount);
      this.focusRow = laneDelta
        ? this.calcNavRow(this.focusLane, this.laneSelections[this.focusLane] || 0, 0)
        : this.calcNavRow(this.focusLane, this.focusRow, rowDelta);

      this.laneSelections[this.focusLane] = this.focusRow;
      if (Math.abs(this.focusRow) > 2048) this.rebaseCoordinates();

      // 不暴力瞬移 rail.value，不强制全池重建贴图；仅确保目标槽位位于池窗口内并保持轨道平滑阻尼
      this.ensureFocusRowInPoolWindow();
      this.selectCurrent(false);
      this.pulses.push({
        lane: this.focusLane,
        row: this.focusRow,
        time: this.clock,
        strength: 0.24
      });

      if (this.selectedCard && this.selectedCard.item.slotType === "anime") {
        this.createDetailFolio(this.selectedCard.item, this.selectedCard);
        this.spaceState = "array";
        this.enterDetail();
      } else {
        this.spaceState = "array";
        this.root.dataset.spaceState = "array";
        this.detailElement.classList.remove("is-visible");
      }
      return;
    }

    this.focusLane = wrap(this.focusLane + laneDelta, this.laneCount);
    this.focusRow = laneDelta
      ? this.calcNavRow(this.focusLane, this.laneSelections[this.focusLane] || 0, 0)
      : this.calcNavRow(this.focusLane, this.focusRow, rowDelta);
    this.laneSelections[this.focusLane] = this.focusRow;

    if (Math.abs(this.focusRow) > 2048) this.rebaseCoordinates();

    this.ensureFocusRowInPoolWindow();
    this.selectCurrent(true);
    this.audio.cue("tick");
    this.wake();
  }

  rebaseCoordinates() {
    const shift = Math.trunc(this.focusRow / 1024) * 1024;
    if (!shift) return;

    this.focusRow -= shift;
    this.rail.value -= shift * ROW_SPACING;
    this.cards.forEach((card) => { card.logicalRow -= shift; });
    if (this.detailFolio) this.detailFolio.logicalRow -= shift;
    this.outgoingCards.forEach((entry) => { entry.logicalRow -= shift; });
    this.laneSelections = this.laneSelections.map((row) => row - shift);
    this.pulses.forEach((pulse) => { pulse.row -= shift; });
  }

  enterDetail() {
    if (!this.detailFolio) {
      if (!this.selectedCard || this.selectedCard.item.slotType !== "anime") return;
      this.createDetailFolio(this.selectedCard.item, this.selectedCard);
    }

    if (this.spaceState === "detail" || this.spaceState === "entering-detail") return;

    this.detailFolio.returnPhase = null;
    this.detailFolio.phase = "active";
    this.hoveredCard = null;
    this.hoverElement?.classList.remove("is-visible");
    this.viewport.style.cursor = "default";
    this.noteSheetState = "closed";
    this.noteSheetProgress.value = 0;
    this.noteSheetProgress.velocity = 0;
    this.noteSheetElement?.classList.remove("is-open");

    this.spaceState = "entering-detail";
    this.root.dataset.spaceState = "entering-detail";
    this.renderDetail(this.detailFolio.item);
    this.audio.cue("open");
    this.wake();
  }

  leaveDetail() {
    if (!["detail", "entering-detail"].includes(this.spaceState)) return;

    this.closeNoteSheet(true);
    this.hoveredCard = null;
    this.hoverElement?.classList.remove("is-visible");
    this.viewport.style.cursor = "default";
    this.spaceState = "leaving-detail";
    this.root.dataset.spaceState = "leaving-detail";
    this.detailElement.classList.remove("is-visible");
    this.targetDetailAngle = 0;
    if (this.detailFolio) {
      this.detailFolio.holdLift = this.detailFolio.lift.value;
      this.detailFolio.returnPhase =
        Math.abs(this.detailFolio.angle.value) > 0.012 ? "align" : "lower";
    }
    this.audio.cue("back");
    this.wake();
  }

  openNoteSheet() {
    if (!this.detailFolio || !["detail", "entering-detail"].includes(this.spaceState)) return;

    if (this.spaceState === "entering-detail") {
      this.noteSheetState = "pending";
      this.updateFolioSheetHint();
      return;
    }

    this.noteSheetState = "extracting";
    this.root.dataset.noteSheet = "open";
    this.renderNoteSheet(this.detailFolio.item);
    this.noteSheetElement.classList.add("is-open");
    this.updateFolioSheetHint();
    this.audio.cue("sheet");
    this.wake();
  }

  closeNoteSheet(immediate = false) {
    if (this.noteSheetState === "closed") return;

    this.noteSheetElement?.classList.remove("is-open");
    this.root.dataset.noteSheet = "closed";

    if (immediate) {
      this.noteSheetState = "closed";
      this.noteSheetProgress.value = 0;
      this.noteSheetProgress.velocity = 0;
      const mesh = this.detailFolio?.group?.userData?.noteSheetMesh;
      if (mesh) {
        mesh.visible = false;
        mesh.position.set(0, 0, 0.018);
        mesh.rotation.z = 0;
      }
      this.updateFolioSheetHint();
      return;
    }

    this.noteSheetState = "retracting";
    this.updateFolioSheetHint();
    this.audio.cue("sheet-close");
    this.wake();
  }

  updateFolioSheetHint() {
    if (!this.folioSheetHintText) return;
    if (this.noteSheetState === "pending") {
      this.folioSheetHintText.textContent = "✦ 已预约抽出随附笔记纸页 · 封套升起到位后立即展开…";
    } else if (this.noteSheetState === "open" || this.noteSheetState === "extracting") {
      this.folioSheetHintText.textContent = "✦ 随附笔记纸页已抽出 · 再次点击左侧封套或按 [ESC] 收回";
    } else {
      this.folioSheetHintText.textContent = "✦ 再次点击左侧原画封套本体，可从袋中抽出随附动画笔记纸页";
    }
  }

  parseReadableNoteSections(rawMarkdown, item) {
    const content = String(rawMarkdown || "");
    const parsedFm = parseFrontmatter(content);
    const body = parsedFm ? content.slice(parsedFm.full.length).trim() : content.trim();

    const tablePairs = [];
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const cleanLine = line.replace(/^>\s*/, "").trim();
      const rowMatch = cleanLine.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
      if (rowMatch) {
        const k = rowMatch[1].replace(/\*\*/g, "").trim();
        let v = rowMatch[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
        if (/^\d+\.\d{2,}$/.test(v)) {
          v = Number(v).toFixed(1);
        }
        if (k && v && k !== "项目" && !k.startsWith(":---") && !k.startsWith("---")) {
          tablePairs.push([k, v]);
        }
      }
    }

    // 提取 # 个人总结 或非模板正文段落
    const summaryIdx = body.search(/^#\s*个人总结/m);
    let userNotesRaw = "";
    if (summaryIdx >= 0) {
      userNotesRaw = body.slice(summaryIdx).replace(/^#\s*个人总结\s*/m, "");
    }

    const cleanedParagraphs = userNotesRaw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<div[\s\S]*?<\/div>/gi, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return {
      fields: parsedFm?.fields || {},
      tablePairs,
      userParagraphs: cleanedParagraphs
    };
  }

  renderNoteSheet(item) {
    if (!this.noteSheetElement) return;
    this.noteSheetElement.empty();

    const holes = this.el(this.noteSheetElement, "div", "atelier-note-sheet-holes");
    for (let i = 0; i < 4; i += 1) {
      this.el(holes, "span", "atelier-note-hole");
    }

    const header = this.el(this.noteSheetElement, "div", "atelier-note-sheet-header");
    const headerLeft = this.el(header, "div", "");
    this.el(
      headerLeft,
      "div",
      "atelier-meta",
      `MANUSCRIPT SHEET · BGM-${String(item.subjectId || "000").slice(-3).padStart(3, "0")} · 随附原画笔记纸页`
    );
    this.el(headerLeft, "div", "atelier-note-sheet-title", `《${item.name || "未命名档案"}》`);
    this.el(headerLeft, "div", "atelier-meta", item.japaneseName || `${item.year || ""} ${item.season || ""}`);

    const headerRight = this.el(header, "div", "atelier-row");
    this.action(
      headerRight,
      "open-obsidian-note",
      "打开完整笔记 ↗",
      () => {
        if (item.file?.path) {
          this.app?.workspace?.openLinkText(item.file.path, "", false);
        }
      },
      "atelier-text-action"
    );
    this.action(
      headerRight,
      "close-note-sheet",
      "收回纸页 [ESC]",
      () => this.closeNoteSheet(),
      "atelier-btn"
    );

    const body = this.el(this.noteSheetElement, "div", "atelier-note-sheet-body");
    body.dataset.ui = "note-sheet-body";
    this.noteSheetBody = body;

    const drawContent = (parsed) => {
      body.empty();

      // 01 核心编目与观看进度
      const sec1 = this.el(body, "section", "atelier-note-section");
      this.el(sec1, "h3", "", "01 · 档案编目与观看记录 / CATALOGUE RECORD");
      const kvGrid = this.el(sec1, "div", "atelier-note-kv-grid");

      const rawBgm = Number(item.bangumiScore ?? item.preciseScore);
      const bgmStr = Number.isFinite(rawBgm) && rawBgm > 0 ? rawBgm.toFixed(1) : "未记录";
      const personalStr = item.personalScore == null ? "未评分" : Number(item.personalScore).toFixed(1);

      const basePairs = [
        ["观看状态", item.state || "未设置"],
        ["观看进度", `${Number(item.watchedEpisodes) || 0} / ${item.totalEpisodes || "?"} 话`],
        ["个人评分", personalStr],
        ["BGM 评分", bgmStr],
        ["改编类型", item.animeType || parsed.fields["改编类型"] || "未记载"],
        ["开播档期", `${item.year || parsed.fields["开播年份"] || "未知"} ${item.season || parsed.fields["开播季度"] || ""}`.trim()],
        ["制作公司", item.studio || parsed.fields["制作公司"] || "未记载"],
        ["制作监督", item.director || parsed.fields["监督"] || "未记载"],
        ["音乐担当", parsed.fields["音乐"] || "未记载"],
        ["记录日期", parsed.fields["记录日期"] || "未记载"]
      ];

      basePairs.forEach(([k, v]) => {
        const row = this.el(kvGrid, "div", "atelier-note-kv");
        this.el(row, "span", "", k);
        this.el(row, "span", "", v);
      });

      // 02 个人总结与随附札记
      const sec2 = this.el(body, "section", "atelier-note-section");
      this.el(sec2, "h3", "", "02 · 个人总结与观片手记 / PERSONAL MANUSCRIPT");
      if (parsed.userParagraphs.length > 0) {
        parsed.userParagraphs.forEach((para) => {
          this.el(sec2, "p", "atelier-note-paragraph", para);
        });
      } else {
        this.el(
          sec2,
          "p",
          "atelier-note-paragraph",
          `当前笔记《${item.name}》尚未填写长篇个人总结段落。您可点击右上角「打开完整笔记 ↗」在 Obsidian 编辑器中随时撰写观后感与分集短评。`
        );
      }

      // 03 笔记内嵌信息表与档案详情（确保长内容纸页可顺畅滚动检阅）
      const sec3 = this.el(body, "section", "atelier-note-section");
      this.el(sec3, "h3", "", "03 · 笔记原始信息表摘录 / ARCHIVAL TABLE");
      if (parsed.tablePairs.length > 0) {
        const tableGrid = this.el(sec3, "div", "atelier-note-kv-grid");
        parsed.tablePairs.forEach(([k, v]) => {
          const row = this.el(tableGrid, "div", "atelier-note-kv");
          this.el(row, "span", "", k);
          this.el(row, "span", "", v);
        });
      } else {
        this.el(sec3, "p", "atelier-note-paragraph", "未检测到额外的 Markdown 信息表行。");
      }

      // 04 馆藏路径与外部索引
      const sec4 = this.el(body, "section", "atelier-note-section");
      this.el(sec4, "h3", "", "04 · 馆藏源文件路径与索引 / SOURCE & LINKS");
      this.el(sec4, "p", "atelier-note-paragraph", `笔记路径：${item.file?.path || "未关联本地文件"}`);
      this.el(sec4, "p", "atelier-note-paragraph", `本地媒体目录：${item.downloadPath || "未设置"}`);
      this.el(sec4, "p", "atelier-note-paragraph", `Bangumi 条目：https://bgm.tv/subject/${item.subjectId || ""}`);
      this.el(sec4, "p", "atelier-note-paragraph", `Netaba 趋势：https://netaba.re/subject/${item.subjectId || ""}`);
    };

    // 先同步渲染基础数据，保证抽纸零延迟，随后异步补充笔记正文
    drawContent(this.parseReadableNoteSections("", item));

    const reqId = ++this.noteSheetRequestId;
    if (item.file && typeof this.app?.vault?.cachedRead === "function") {
      this.app.vault.cachedRead(item.file)
        .then((raw) => {
          if (this.isDestroyed || reqId !== this.noteSheetRequestId) return;
          drawContent(this.parseReadableNoteSections(raw, item));
        })
        .catch(() => {});
    }
  }

  renderDetail(item) {
    this.detailElement.empty();

    const back = this.action(
      this.detailElement,
      "detail-back",
      "← 返回档案阵列 [ESC]",
      () => this.leaveDetail(),
      "atelier-back-lead"
    );

    back.dataset.ui = "detail-back";

    const multiBadge = this.multiLaneItemIds.has(itemId(item))
      ? " ／ 策展多轨收录"
      : "";

    this.el(
      this.detailElement,
      "div",
      "atelier-meta",
      `FILE BGM-${String(item.subjectId || "000").slice(-3).padStart(3, "0")} ／ ${item.state || "未设置"}${multiBadge}`
    );

    this.el(this.detailElement, "h1", "", `《${item.name || "未命名档案"}》`);
    this.el(this.detailElement, "div", "atelier-meta", `${item.japaneseName || ""} · ${item.year || "未知"} ${item.season || ""}`);

    const hintBox = this.el(this.detailElement, "div", "atelier-folio-sheet-hint");
    this.folioSheetHintText = this.el(hintBox, "span", "", "");
    this.action(
      hintBox,
      "toggle-note-sheet",
      "抽阅笔记纸页 ▤",
      () => this.onClickActiveFolio(),
      "atelier-text-action"
    );
    this.updateFolioSheetHint();

    this.el(this.detailElement, "div", "atelier-detail-rule");

    const grid = this.el(this.detailElement, "div", "atelier-data-grid");

    const scoreCell = this.detailCell(grid, "评分对照 / RATING");
    const personal = item.personalScore == null ? "未评分" : Number(item.personalScore).toFixed(1);
    const rawBgm = Number(item.bangumiScore ?? item.preciseScore);
    const bgm = Number.isFinite(rawBgm) && rawBgm > 0 ? rawBgm.toFixed(1) : "未记录";
    this.el(scoreCell, "div", "atelier-data-value", `个人 ${personal} ／ BGM ${bgm}`);

    const ruler = this.el(scoreCell, "div", "atelier-score-ruler");
    for (let score = 1; score <= 10; score += 1) {
      const button = this.el(ruler, "button", "atelier-score-pip", String(score));
      if (Math.round(Number(item.personalScore)) === score) button.classList.add("is-active");

      button.onclick = async () => {
        if (await this.plugin.quickUpdateAnimeNote(item, { score })) {
          item.personalScore = score;
          this.audio.cue("confirm");
          this.renderDetail(item);
        }
      };
    }

    const progressCell = this.detailCell(grid, "追番进度 / PROGRESS");
    const progress = this.el(progressCell, "div", "atelier-data-value", "");
    const drawProgress = () => {
      progress.textContent = `−  ${Number(item.watchedEpisodes) || 0} / ${item.totalEpisodes || "?"} 话  +`;
    };

    drawProgress();
    progress.style.cursor = "pointer";

    progress.onclick = async (event) => {
      const rect = progress.getBoundingClientRect();
      const increment = event.clientX > rect.left + rect.width / 2 ? 1 : -1;
      const next = Math.max(0, Number(item.watchedEpisodes || 0) + increment);

      if (await this.plugin.quickUpdateAnimeNote(item, { watchedEpisodes: next })) {
        item.watchedEpisodes = next;
        drawProgress();
        this.audio.cue("confirm");
      }
    };

    const stateCell = this.detailCell(grid, "归档状态 / STATUS");
    const states = this.el(stateCell, "div", "atelier-segmented");

    ["在看", "已看", "想看", "抛弃"].forEach((state) => {
      const button = this.el(states, "button", "atelier-segment", state);
      if ((item.state || "在看") === state) button.classList.add("is-active");

      button.onclick = async () => {
        if (await this.plugin.quickUpdateAnimeNote(item, { state })) {
          item.state = state;
          this.audio.cue("confirm");
          this.renderDetail(item);
        }
      };
    });

    const studioCell = this.detailCell(grid, "制作信息 / STUDIO");
    this.el(studioCell, "div", "atelier-data-value", `${item.studio || "未记载"} ／ ${item.director || "未记载"}`);

    const tabs = this.el(this.detailElement, "div", "atelier-tabs");
    const sheet = this.el(this.detailElement, "div", "atelier-sheet");

    [
      ["overview", "01 档案概览"],
      ["trend", "02 评分趋势"],
      ["record", "03 制作与馆藏"]
    ].forEach(([name, label]) => {
      const tab = this.el(tabs, "button", "atelier-tab", label);
      tab.dataset.tab = name;
      tab.onclick = () => this.renderTab(name, item, sheet, tabs);
    });

    this.renderTab("overview", item, sheet, tabs);
  }

  detailCell(parent, label) {
    const cell = this.el(parent, "div");
    this.el(cell, "div", "atelier-data-label", label);
    return cell;
  }

  renderTab(name, item, sheet, tabs) {
    sheet.empty();

    Array.from(tabs.children).forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    });

    if (name === "overview") {
      this.el(sheet, "p", "", `改编类型：${item.animeType || "未记载"}`);
      const rawTags = Array.isArray(item.tags)
        ? item.tags
        : String(item.tags || "").split(/[,，、\s]+/).filter(Boolean);
      const uniqueTags = Array.from(new Set(rawTags.map((t) => String(t).trim()).filter(Boolean)));
      this.el(sheet, "p", "", `标签：${uniqueTags.length ? uniqueTags.join(" / ") : "未记载"}`);
      this.renderDetailActions(sheet, item);
      return;
    }

    if (name === "record") {
      this.el(sheet, "p", "", `本地状态：${item.localUpdateStatus || "未记载"}`);
      this.el(sheet, "p", "", `下载路径：${item.downloadPath || "未设置"}`);
      this.renderDetailActions(sheet, item);
      return;
    }

    const host = decorateDom(this.el(sheet, "div", "atelier-trend-host"));
    host.createDiv({ cls: "atelier-empty", text: "正在读取 Netaba 评分趋势……" });
    this.renderDetailActions(sheet, item);

    if (!item.subjectId) {
      host.empty().createDiv({ cls: "atelier-empty", text: "该档案未关联有效 Bangumi 编号。" });
      return;
    }

    const request = ++this.trendRequestId;

    netabaTrendService.fetchSubjectTrendData(this.app, item.subjectId)
      .then((raw) => {
        if (this.isDestroyed || request !== this.trendRequestId) return;

        const data = sanitizeTrendData(
          netabaTrendService.normalizeTrendData(raw, item.personalScore)
        );

        host.empty();

        if (!data) {
          host.createDiv({ cls: "atelier-empty", text: "暂无历史趋势评分数据。" });
          return;
        }

        netabaTrendService.renderNativeTrendSvg(host, data, {
          variant: "atelier",
          compact: true
        });
        if (this.detailElement && this.detailElement.scrollHeight > this.detailElement.clientHeight) {
          this.detailElement.scrollTo({
            top: Math.max(0, this.detailElement.scrollHeight - this.detailElement.clientHeight),
            behavior: "smooth"
          });
        }
      })
      .catch((error) => {
        if (this.isDestroyed || request !== this.trendRequestId) return;
        host.empty().createDiv({
          cls: "atelier-empty",
          text: `趋势读取失败：${error.message || "网络或接口超时"}`
        });
      });
  }

  renderDetailActions(sheet, item) {
    const actions = this.el(sheet, "div", "atelier-detail-actions");
    let localInfo = null;

    try {
      if (item.downloadPath && item.downloadPath !== "无") {
        localInfo = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
      }
    } catch (error) {
      localInfo = null;
    }

    const primary = this.el(
      actions,
      "button",
      "atelier-primary-action",
      localInfo?.nextEpisodeFile
        ? `▶ 播放第 ${localInfo.nextEpisodeNumber || Number(item.watchedEpisodes || 0) + 1} 话`
        : "打开动画笔记 ↗"
    );

    primary.onclick = () => {
      if (localInfo?.nextEpisodeFile) {
        openLocalPathSafely(localInfo.nextEpisodeFile);
      } else if (item.file?.path) {
        this.app?.workspace?.openLinkText(item.file.path, "", false);
      }
    };

    const viewer = this.el(actions, "button", "atelier-text-action", "360° 装帧检视 ↗");
    viewer.onclick = () => {
      this.activeViewer = new ModelViewer(this, item);
      this.activeViewer.open();
    };

    if (item.downloadPath && item.downloadPath !== "无") {
      const folder = this.el(actions, "button", "atelier-text-action", "打开本地目录 ↗");
      folder.onclick = () => openLocalPathSafely(item.downloadPath);
    }
  }

  updateToolbar() {
    if (this.lensButton) {
      const isHigh = this.lensMode === "highscore";
      this.lensButton.textContent = isHigh ? "◫ 状态与收藏轨" : "✦ 高分精选";
      this.lensButton.dataset.lensMode = this.lensMode;
      this.lensButton.classList.toggle("is-active", isHigh);
    }

    if (this.brandSubElement) {
      this.brandSubElement.textContent =
        this.lensMode === "highscore"
          ? `HIGH-SCORE CURATED HALL · 四柱高分策展 · 馆藏 ${this.items.length} 部`
          : `BANGUMI ORIGINAL CEL ARCHIVE · 馆藏 ${this.items.length} 部 · 活动轨道 ${this.laneCount} 条`;
    }

    const active = Boolean(this.settings.audio && this.audio.context?.state === "running");

    this.audioButton.textContent = active
      ? "● ♪ 环境音景 · 播放中"
      : this.settings.audio
        ? "◐ ♪ 环境音景 · 点击唤醒"
        : "♪ 环境音景 · 已静音";

    this.audioButton.dataset.audioState = active ? "on" : "off";
    this.audioButton.classList.toggle("is-active", active);
  }

  toggleLensMode() {
    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();
      this.spaceState = "array";
      this.root.dataset.spaceState = "array";
      this.detailElement.classList.remove("is-visible");
    }

    this.lensMode = this.lensMode === "highscore" ? "status" : "highscore";
    this.root.dataset.lensMode = this.lensMode;
    this.focusLane = 0;
    this.focusRow = 0;
    this.rail.value = 0;
    this.rail.velocity = 0;
    this.rebuildPoolAndLines();
    this.updateToolbar();
    this.audio.cue("tick");
    this.wake();
  }

  async toggleAudio() {
    this.settings.audio = !this.settings.audio;
    await this.saveSettings();
    await this.audio.setEnabled(this.settings.audio, true);
    this.audioGestureHandled = true;
    this.updateToolbar();
  }

  segmented(parent, values, current, onChange) {
    const group = this.el(parent, "div", "atelier-segmented");

    values.forEach(([value, label]) => {
      const button = this.el(group, "button", "atelier-segment", label);
      if (value === current) button.classList.add("is-active");

      button.onclick = async () => {
        await onChange(value);
        Array.from(group.children).forEach((child) => {
          child.classList.toggle("is-active", child === button);
        });
      };
    });

    return group;
  }

  openSettings() {
    if (this.modal) this.closeModal();

    this.modal = this.el(this.root, "section", "atelier-modal");
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.closeModal();
    };
    const panel = this.el(this.modal, "div", "atelier-modal-panel");

    const headerRow = this.el(panel, "div", "atelier-row");
    headerRow.style.justifyContent = "space-between";
    this.el(headerRow, "h2", "", "空间设置与轨道编目 / ATELIER PREFERENCES");
    this.action(headerRow, "close-settings", "关闭设置 [ESC]", () => this.closeModal());

    const addRow = (label, content) => {
      const row = this.el(panel, "div", "atelier-setting");
      this.el(row, "span", "", label);
      row.appendChild(content);
    };

    addRow("启动序幕", this.segmented(panel, [
      ["calm", "舒缓转场"],
      ["full", "完整序幕"],
      ["none", "直接进入"]
    ], this.settings.bootMode, async (value) => {
      this.settings.bootMode = value;
      await this.saveSettings();
    }));

    addRow("渲染质感", this.segmented(panel, [
      [true, "高画质"],
      [false, "轻盈流畅"]
    ], this.settings.highQuality, async (value) => {
      this.settings.highQuality = value;
      await this.saveSettings();
      this.applyQuality();
    }));

    addRow("动效偏好", this.segmented(panel, [
      [false, "完整原画呼吸"],
      [true, "减弱动态效果"]
    ], this.settings.reducedMotion, async (value) => {
      this.settings.reducedMotion = value;
      this.root.dataset.reducedMotion = String(Boolean(value));
      await this.saveSettings();
    }));

    addRow("环境音景", this.segmented(panel, [
      [true, "开启音景"],
      [false, "保持静音"]
    ], Boolean(this.settings.audio), async (value) => {
      this.settings.audio = value;
      await this.saveSettings();
      await this.audio.setEnabled(value, true);
      this.audioGestureHandled = true;
      this.updateToolbar();
    }));

    // 用户自定义收藏轨道编目器
    const laneSection = this.el(panel, "div", "atelier-lane-editor");
    const laneHeader = this.el(laneSection, "div", "atelier-row");
    laneHeader.style.justifyContent = "space-between";
    this.el(laneHeader, "strong", "", "收藏轨道配置（可改名、隐藏默认轨、新增自定义规则轨道）");

    const laneHeaderActions = this.el(laneHeader, "div", "atelier-row");
    const listHost = this.el(laneSection, "div", "atelier-lane-editor-list");

    const applyLaneChanges = async () => {
      this.settings.customLanes = normalizeLaneConfigs(this.settings.customLanes);
      await this.saveSettings();
      if (this.lensMode !== "status") {
        this.lensMode = "status";
        this.root.dataset.lensMode = "status";
      }
      this.rebuildPoolAndLines();
      this.updateToolbar();
    };

    const renderLaneRows = () => {
      listHost.empty();
      const lanes = normalizeLaneConfigs(this.settings.customLanes);
      this.settings.customLanes = lanes;

      lanes.forEach((lane, idx) => {
        const row = this.el(listHost, "div", "atelier-lane-config-row");
        if (!lane.visible) row.classList.add("is-hidden-lane");
        row.style.borderLeftColor = lane.accent || "#9b7247";

        const visBtn = this.action(
          row,
          `toggle-lane-visible-${idx}`,
          lane.visible ? "●" : "○",
          async () => {
            const visibleCount = lanes.filter((l) => l.visible).length;
            if (lane.visible && visibleCount <= 1) return;
            lane.visible = !lane.visible;
            await applyLaneChanges();
            renderLaneRows();
          }
        );
        visBtn.title = lane.visible ? "点击隐藏该轨道" : "点击显示该轨道";

        const nameInput = this.el(row, "input");
        nameInput.value = lane.name;
        nameInput.placeholder = "轨道名称";
        nameInput.dataset.laneField = "name";
        nameInput.onchange = async () => {
          lane.name = nameInput.value.trim() || lane.name;
          await applyLaneChanges();
        };

        const badgeInput = this.el(row, "input");
        badgeInput.value = lane.badge;
        badgeInput.placeholder = "印章标识";
        badgeInput.dataset.laneField = "badge";
        badgeInput.onchange = async () => {
          lane.badge = badgeInput.value.trim() || lane.badge;
          await applyLaneChanges();
        };

        const typeSelect = this.el(row, "select");
        typeSelect.dataset.laneField = "sourceType";
        [
          ["state", "按观看状态"],
          ["scoreRange", "按评分范围"],
          ["year", "按开播年份"],
          ["tag", "按标签包含"],
          ["studio", "按制作公司"],
          ["manual", "手动精选"],
          ["unarchived", "未归档条目"]
        ].forEach(([val, text]) => {
          const opt = this.el(typeSelect, "option", "", text);
          opt.value = val;
          if (lane.sourceType === val) opt.selected = true;
        });
        typeSelect.onchange = async () => {
          lane.sourceType = typeSelect.value;
          if (lane.sourceType === "state" && !["在看", "已看", "想看", "抛弃"].includes(lane.sourceValue)) {
            lane.sourceValue = "已看";
          } else if (lane.sourceType === "scoreRange" && !lane.sourceValue.includes("-")) {
            lane.sourceValue = "8.0-10";
          } else if (lane.sourceType === "year" && !/^\d{4}$/.test(lane.sourceValue)) {
            lane.sourceValue = "2025";
          }
          await applyLaneChanges();
          renderLaneRows();
        };

        const valInput = this.el(row, "input");
        valInput.value = lane.sourceValue;
        valInput.placeholder =
          lane.sourceType === "state"
            ? "在看 / 已看 / 想看 / 抛弃"
            : lane.sourceType === "scoreRange"
              ? "如 8.0-10"
              : lane.sourceType === "year"
                ? "如 2025"
                : "关键词或标题";
        valInput.dataset.laneField = "sourceValue";
        valInput.onchange = async () => {
          lane.sourceValue = valInput.value.trim();
          await applyLaneChanges();
        };

        const sortSelect = this.el(row, "select");
        sortSelect.dataset.laneField = "sortBy";
        [
          ["scoreDesc", "综合评分 ↓"],
          ["bgmDesc", "BGM评分 ↓"],
          ["yearDesc", "开播年份 ↓"],
          ["progressDesc", "观看进度 ↓"],
          ["nameAsc", "标题排序 ↑"]
        ].forEach(([val, text]) => {
          const opt = this.el(sortSelect, "option", "", text);
          opt.value = val;
          if (lane.sortBy === val) opt.selected = true;
        });
        sortSelect.onchange = async () => {
          lane.sortBy = sortSelect.value;
          await applyLaneChanges();
        };

        const delBtn = this.action(
          row,
          `remove-lane-${idx}`,
          lanes.length > 1 ? "✕" : "·",
          async () => {
            if (lanes.length <= 1) return;
            this.settings.customLanes.splice(idx, 1);
            await applyLaneChanges();
            renderLaneRows();
          }
        );
        delBtn.title = "移除该轨道";
      });
    };

    this.action(
      laneHeaderActions,
      "add-custom-lane",
      "＋ 新增收藏轨道",
      async () => {
        const palettes = ["#9b5d3b", "#3d6b66", "#5e5482", "#8a6d3b", "#4f6680"];
        const nextIdx = this.settings.customLanes.length + 1;
        this.settings.customLanes.push({
          id: `lane-custom-${Date.now()}`,
          name: `精选特辑 · 0${nextIdx}`,
          badge: `辑 · PICK 0${nextIdx}`,
          accent: palettes[nextIdx % palettes.length],
          sourceType: "scoreRange",
          sourceValue: "8.0-10",
          sortBy: "scoreDesc",
          visible: true,
          plaqueNote: "自定义评分段策展收录"
        });
        await applyLaneChanges();
        renderLaneRows();
      }
    );

    this.action(
      laneHeaderActions,
      "reset-custom-lanes",
      "↺ 恢复默认四轨",
      async () => {
        this.settings.customLanes = cloneDefaultLaneConfigs();
        await applyLaneChanges();
        renderLaneRows();
      }
    );

    renderLaneRows();

    const footerActions = this.el(panel, "div", "atelier-row");
    footerActions.style.marginTop = "16px";
    this.action(footerActions, "replay-boot", "重播序幕 ↻", () => {
      this.closeModal();
      this.playBoot(true);
    });
  }

  closeModal() {
    this.modal?.remove();
    this.modal = null;
    this.wake();
  }

  openSearch() {
    if (this.modal) this.closeModal();

    this.modal = this.el(this.root, "section", "atelier-modal");
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.closeModal();
    };
    const panel = this.el(this.modal, "div", "atelier-modal-panel");

    const headerRow = this.el(panel, "div", "atelier-row");
    headerRow.style.justifyContent = "space-between";
    this.el(headerRow, "h2", "", "档案检索 / ARCHIVE SEARCH");
    this.action(headerRow, "close-search", "关闭检索 [ESC]", () => this.closeModal());

    const input = this.el(panel, "input", "");
    input.type = "search";
    input.placeholder = "输入中文名、日文名或 Bangumi 编号";
    input.style.width = "100%";

    const results = this.el(panel, "div", "atelier-search-results");

    const render = () => {
      results.empty();
      const query = String(input.value || "").trim().toLowerCase();

      this.items
        .filter((item) => !query || [
          item.name,
          item.japaneseName,
          item.subjectId
        ].some((value) => String(value || "").toLowerCase().includes(query)))
        .slice(0, 40)
        .forEach((item) => {
          const row = this.el(results, "button", "atelier-search-result");
          this.el(row, "span", "", item.name || "未命名档案");
          this.el(row, "span", "atelier-meta", item.state || "未设置");

          row.onclick = () => {
            const lane = this.lanes.findIndex((entries) => (
              entries.some((entry) => itemId(entry) === itemId(item))
            ));

            this.focusLane = lane >= 0 ? lane : 0;
            const laneList = this.lanes[this.focusLane] || [];
            let itemIdx = laneList.findIndex((entry) => itemId(entry) === itemId(item));
            if (itemIdx < 0) itemIdx = 0;

            if (laneList.length < 8) {
              const start = -Math.floor((laneList.length - 1) / 2);
              this.focusRow = start + itemIdx;
            } else {
              this.focusRow = itemIdx;
            }

            this.laneSelections[this.focusLane] = this.focusRow;
            this.rail.value = this.focusRow * ROW_SPACING;
            this.rail.velocity = 0;

            this.closeModal();
            this.remapPool(true);
            this.selectCurrent(true);
            if (this.selectedCard && this.selectedCard.item.slotType === "anime") {
              this.createDetailFolio(this.selectedCard.item, this.selectedCard);
              this.enterDetail();
            }
          };
        });
    };

    input.oninput = render;
    render();
    this.schedule(() => input.focus(), 30);
  }

  playBoot(replay) {
    this.clearTimers(this.bootTimers);
    this.bootElement?.remove();
    this.bootElement = null;
    this.bootMode = this.settings.bootMode;
    this.bootStartedAt = performance.now();
    this.bootDone = false;

    if (this.bootMode === "none" && !replay) {
      this.spaceState = "array";
      this.root.dataset.spaceState = "array";
      this.ui.style.opacity = "0";
      this.viewport.style.opacity = "0";

      this.schedule(() => {
        this.ui.style.transition = "opacity .3s ease";
        this.viewport.style.transition = "opacity .3s ease";
        this.ui.style.opacity = "1";
        this.viewport.style.opacity = "1";
      }, 16, this.bootTimers);

      return;
    }

    this.spaceState = "boot";
    this.root.dataset.spaceState = "boot";
    this.ui.style.opacity = "0";

    this.bootElement = this.el(this.root, "section", "atelier-boot");

    const center = this.el(this.bootElement, "div", "boot-center");
    this.el(center, "div", "boot-rule");
    this.el(
      center,
      "div",
      "boot-title",
      this.bootMode === "full"
        ? `白昼原画室 · 已收录动画档案 ${this.items.length} 部`
        : "ATELIER CEL / 原画分镜台就位"
    );

    const skip = this.action(
      this.bootElement,
      "skip-boot",
      "跳过序幕 ↗",
      () => this.finishBoot()
    );

    skip.className = "atelier-btn boot-skip";
  }

  finishBoot() {
    if (this.bootDone) return;

    this.bootDone = true;
    this.spaceState = "array";
    this.root.dataset.spaceState = "array";
    this.bootElement?.classList.add("is-hidden");

    this.ui.style.transition = "opacity .45s ease";
    this.ui.style.opacity = "1";
    this.ui.style.pointerEvents = "none";

    if (this.settings.reducedMotion) {
      this.archiveGroup.position.z = 0;
    }

    this.schedule(() => {
      this.bootElement?.remove();
      this.bootElement = null;
      this.ui.style.transition = "opacity .45s ease";
      this.ui.style.opacity = "1";
      this.ui.style.pointerEvents = "none";
      this.selectCurrent(true);
      this.wake();
    }, 520, this.bootTimers);

    this.wake();
  }

  updateBoot(now) {
    if (this.spaceState !== "boot") return;

    const elapsed = (now - this.bootStartedAt) / 1000;
    const full = this.bootMode === "full";
    const duration = full ? 6.8 : 3.2;

    if (full) {
      if (elapsed < 1.6) {
        this.archiveGroup.position.z = -14;
      } else if (elapsed < 3.2) {
        this.archiveGroup.position.z = -14 * (1 - smooth((elapsed - 1.6) / 1.6));
      } else {
        this.archiveGroup.position.z = 0;
      }
    } else if (elapsed < 0.6) {
      this.archiveGroup.position.z = -12;
    } else if (elapsed < 2.2) {
      this.archiveGroup.position.z = -12 * (1 - smooth((elapsed - 0.6) / 1.6));
    } else {
      this.archiveGroup.position.z = 0;
    }

    if (elapsed >= duration) this.finishBoot();
  }

  getSlotTargetPose(entry) {
    const card = entry?.sourceCard;
    if (card && card.group) {
      return {
        position: card.group.position,
        rotationY: card.group.rotation.y,
        tiltX: card.group.userData?.folioTiltGroup?.rotation?.x ?? -0.2,
        quality: card.quality.value,
        valley: card.valley
      };
    }

    const lane = entry?.lane ?? 0;
    const logicalRow = entry?.logicalRow ?? 0;
    const curatedBoost = this.lensMode === "highscore" ? 0.16 : 0;
    const isFocused = lane === this.focusLane && logicalRow === this.focusRow;
    const dRow = logicalRow - this.ridgeRow.value;
    const dLane = lane - this.ridgeLane.value;
    const ridge = (0.72 + curatedBoost) * bell(dRow, 2.8) * (0.3 + 0.7 * bell(dLane, 1.15));
    let apertureY = 0;
    let apertureZ = 0;

    if (Math.abs(dLane) < 0.8 && dRow < -0.1 && dRow > -2.3) {
      apertureY = -0.28 * bell(dRow + 1.3, 0.8);
      apertureZ = -0.32 * ROW_SPACING * bell(dRow + 1.3, 0.8);
    }

    const stagger = (lane % 2) * 0.28;
    const x = this.laneX(lane);
    const y = (isFocused ? 0.62 + curatedBoost : 0) + ridge + apertureY;
    const z = -(logicalRow * ROW_SPACING) + this.rail.value + stagger + apertureZ;

    return {
      position: new THREE.Vector3(x, y, z),
      rotationY: 0,
      tiltX: -0.2,
      quality: isFocused ? 0.35 : 0,
      valley: BASE_VALLEY
    };
  }

  updateCards(dt) {
    const reduced = this.settings.reducedMotion || this.motion.transition === false;
    const rate = reduced ? 35 : 5.4;

    damp(this.rail, this.focusRow * ROW_SPACING, reduced ? 35 : 4.6, dt);
    damp(this.ridgeRow, this.focusRow, reduced ? 35 : 5.5, dt);
    damp(this.ridgeLane, this.focusLane, reduced ? 35 : 5.5, dt);

    if (this.archiveGroup.position.z !== 0) {
      this.archiveGroup.position.z = THREE.MathUtils.damp(
        this.archiveGroup.position.z,
        0,
        reduced ? 35 : 7.5,
        dt
      );
      if (Math.abs(this.archiveGroup.position.z) < 0.001) {
        this.archiveGroup.position.z = 0;
      }
    }

    const center = Math.round(this.rail.value / ROW_SPACING);

    if (this.lastPoolCenter === undefined || center !== this.lastPoolCenter) {
      this.lastPoolCenter = center;
      this.remapPool(false, false);
    }

    this.paletteColor.lerp(this.targetPalette, clamp(dt * 3.5, 0, 1));
    const curatedBoost = this.lensMode === "highscore" ? 0.16 : 0;

    this.cards.forEach((card) => {
      const blank = card.item.slotType === "blank";
      const divider = card.item.slotType === "divider";
      const active = card === this.selectedCard;
      const dRow = card.logicalRow - this.ridgeRow.value;
      const dLane = card.lane - this.ridgeLane.value;

      const ridge = blank
        ? 0
        : (divider ? 0.25 : 0.72 + curatedBoost) * bell(dRow, 2.8) * (0.3 + 0.7 * bell(dLane, 1.15));

      let apertureY = 0;
      let apertureZ = 0;

      if (!blank && Math.abs(dLane) < 0.8 && dRow < -0.1 && dRow > -2.3) {
        apertureY = -0.28 * bell(dRow + 1.3, 0.8);
        apertureZ = -0.32 * ROW_SPACING * bell(dRow + 1.3, 0.8);
      }

      let ripple = 0;
      let colorWeight = active ? 0.55 : 0.1;

      this.pulses.forEach((pulse) => {
        const age = this.clock - pulse.time;
        if (age < 0 || age > 2.6) return;

        const distance = Math.hypot(
          card.logicalRow - pulse.row,
          (card.lane - pulse.lane) * 1.8
        );

        const ring = distance - age * 6.5;
        const packet =
          0.46 *
          smooth(age / 0.16) *
          Math.exp(-age * 1.15) *
          Math.cos(ring * 0.65) *
          bell(ring, 3) *
          pulse.strength;

        ripple += packet;
        colorWeight = Math.max(colorWeight, clamp(Math.abs(packet) * 1.4, 0, 0.65));
      });

      const targetHover = this.spaceState === "array" && card === this.hoveredCard ? 0.24 : 0;
      damp(card.hover, targetHover, reduced ? 35 : 9, dt);

      // 无论当前处于 array 还是 detail/leaving-detail，始终同步更新选中槽位在阵列中的基准高度与品质，
      // 确保隐藏的 sourceCard 实时持有归位交接所需的准确目标姿态
      if (!active) {
        damp(card.lift, 0, rate, dt);
        damp(card.quality, 0, rate, dt);
        damp(card.angle, 0, rate, dt);
      } else {
        damp(card.lift, 0.62 + curatedBoost, rate, dt);
        damp(card.quality, 0.35, rate, dt);
        damp(card.angle, 0, rate, dt);
      }

      card.targetValley.copy(BASE_VALLEY).lerp(
        this.paletteColor,
        clamp(colorWeight, 0, 0.8)
      );

      card.valley.lerp(card.targetValley, clamp(dt * 4.5, 0, 1));

      const stagger = (card.lane % 2) * 0.28;
      const z = -(card.logicalRow * ROW_SPACING) + this.rail.value + stagger + apertureZ;

      const hiddenByActiveDetail =
        this.detailFolio?.sourceCard === card ||
        Boolean(
          this.detailFolio &&
          card.item.slotType === "anime" &&
          card.itemId === this.detailFolio.itemId &&
          card.lane === this.detailFolio.lane &&
          card.logicalRow === this.detailFolio.logicalRow
        );

      const hiddenByOutgoing = this.outgoingCards.some(
        (entry) =>
          entry.sourceCard === card ||
          (card.item.slotType === "anime" &&
            card.itemId === entry.itemId &&
            card.lane === entry.lane &&
            card.logicalRow === entry.logicalRow)
      );

      card.group.visible = !(hiddenByActiveDetail || hiddenByOutgoing);

      card.group.position.set(
        this.laneX(card.lane),
        card.lift.value + card.hover.value + ridge + apertureY + ripple,
        z
      );

      card.group.userData.folioTiltGroup.rotation.x = -0.2;
      card.group.rotation.y = card.angle.value;
      this.applyAppearance(card.group, card.quality.value, card.valley);
    });

    this.updateDetailFolio(dt, reduced);
    this.updateOutgoing(dt, reduced);
    this.pulses = this.pulses.filter((pulse) => this.clock - pulse.time < 2.6);
  }

  completeDetailReturn(detail, slotPose) {
    const sourceCard = detail.sourceCard;
    if (sourceCard?.group) {
      sourceCard.angle.value = 0;
      sourceCard.angle.velocity = 0;
      sourceCard.quality.value = slotPose.quality;
      sourceCard.quality.velocity = 0;
      sourceCard.valley.copy(slotPose.valley);
      sourceCard.group.position.copy(slotPose.position);
      sourceCard.group.rotation.y = 0;
      if (sourceCard.group.userData?.folioTiltGroup) {
        sourceCard.group.userData.folioTiltGroup.rotation.x = slotPose.tiltX;
      }
      this.applyAppearance(sourceCard.group, sourceCard.quality.value, sourceCard.valley);
      sourceCard.group.visible = true;
    }

    detail.group.parent?.remove(detail.group);
    this.disposeObject(detail.group);

    if (this.inkHaloMesh) this.inkHaloMesh.visible = false;
    this.detailFolio = null;
    this.spaceState = "array";
    this.root.dataset.spaceState = "array";

    if (sourceCard) {
      this.remapSingleCardIfOutOfWindow(sourceCard);
    }
  }

  updateDetailFolio(dt, reduced) {
    const detail = this.detailFolio;
    if (!detail) {
      if (this.inkHaloMesh) this.inkHaloMesh.visible = false;
      return;
    }

    const rate = reduced ? 35 : 5.4;
    const angleRate = reduced ? 35 : 7.2;
    const slotPose = this.getSlotTargetPose(detail);
    detail.slotPos.copy(slotPose.position);
    detail.sourcePosition.copy(slotPose.position);

    if (this.spaceState === "entering-detail") {
      detail.returnPhase = null;
      damp(detail.lift, INSPECTION_LIFT, rate, dt);
      damp(detail.quality, 1, rate, dt);
      damp(detail.angle, this.targetDetailAngle, angleRate, dt);
      detail.valley.lerp(slotPose.valley, clamp(dt * 6, 0, 1));

      if (detail.lift.value > INSPECTION_LIFT - 0.22 && this.detailProgress.value > 0.84) {
        this.spaceState = "detail";
        this.root.dataset.spaceState = "detail";
        this.detailElement.classList.add("is-visible");

        // 若升起途中用户已第二次点击预约抽出笔记纸页，到位后立即安全展开
        if (this.noteSheetState === "pending") {
          this.openNoteSheet();
        }
      }
    } else if (this.spaceState === "detail") {
      detail.returnPhase = null;
      damp(detail.lift, INSPECTION_LIFT, rate, dt);
      damp(detail.quality, 1, rate, dt);
      damp(detail.angle, this.targetDetailAngle, angleRate, dt);
      detail.valley.lerp(slotPose.valley, clamp(dt * 6, 0, 1));
    } else if (this.spaceState === "leaving-detail") {
      if (!detail.returnPhase) {
        detail.holdLift = detail.lift.value;
        detail.returnPhase = Math.abs(detail.angle.value) > 0.012 ? "align" : "lower";
      }

      if (detail.returnPhase === "align") {
        // 1. 旋转后的封套先在当前详情高度平滑回正，未回正前绝不提前下降
        this.targetDetailAngle = 0;
        damp(detail.angle, 0, reduced ? 35 : 11.5, dt);
        damp(detail.lift, detail.holdLift ?? INSPECTION_LIFT, rate, dt);
        damp(detail.quality, 1, rate, dt);
        detail.valley.lerp(slotPose.valley, clamp(dt * 6, 0, 1));

        if (Math.abs(detail.angle.value) <= 0.012) {
          detail.angle.value = 0;
          detail.angle.velocity = 0;
          detail.returnPhase = "lower";
        }
      }

      if (detail.returnPhase === "lower") {
        // 2. 回正后向目标槽位连续下降（lift -> 0），与隐藏的 sourceCard 完全重合后同帧无痕交接
        this.targetDetailAngle = 0;
        damp(detail.angle, 0, reduced ? 35 : 16, dt);
        const seatBoost = detail.lift.value < 0.22 ? 1.32 : 1.0;
        const lowerRate = (reduced ? 35 : 4.8) * seatBoost;
        damp(detail.lift, 0, lowerRate, dt);
        damp(detail.quality, slotPose.quality, lowerRate, dt);
        detail.valley.lerp(slotPose.valley, clamp(dt * 10, 0, 1));

        if (Math.abs(detail.lift.value) < 0.003 && Math.abs(detail.angle.value) < 0.003) {
          this.completeDetailReturn(detail, slotPose);
          return;
        }
      }
    }

    // 更新随附笔记纸页的三维抽出与收回动画
    const sheetTarget =
      this.noteSheetState === "extracting" || this.noteSheetState === "open" ? 1 : 0;
    damp(this.noteSheetProgress, sheetTarget, reduced ? 35 : 8.5, dt);

    if (this.noteSheetState === "extracting" && this.noteSheetProgress.value > 0.94) {
      this.noteSheetState = "open";
      this.updateFolioSheetHint();
    } else if (this.noteSheetState === "retracting" && this.noteSheetProgress.value < 0.04) {
      this.noteSheetState = "closed";
      this.noteSheetProgress.value = 0;
      this.updateFolioSheetHint();
    }

    const sheetMesh = detail.group.userData?.noteSheetMesh;
    if (sheetMesh) {
      const sp = clamp(this.noteSheetProgress.value, 0, 1);
      sheetMesh.visible = sp > 0.015;
      sheetMesh.position.set(sp * 1.32, sp * 0.24, 0.018);
      sheetMesh.rotation.z = -sp * 0.055;
    }

    detail.group.position.set(
      detail.slotPos.x,
      detail.slotPos.y + detail.lift.value,
      detail.slotPos.z
    );
    detail.group.rotation.y = detail.angle.value;
    const liftRatio = clamp(detail.lift.value / INSPECTION_LIFT, 0, 1);
    detail.group.userData.folioTiltGroup.rotation.x = THREE.MathUtils.lerp(
      slotPose.tiltX,
      -0.03,
      liftRatio
    );

    // 更新 3D 墨水扩散光环位置与透明度
    if (this.inkHaloMesh) {
      const haloProgress = clamp(this.detailProgress.value, 0, 1);
      this.inkHaloMesh.visible = haloProgress > 0.02;
      this.inkHaloMesh.position.set(
        detail.group.position.x + 0.15,
        detail.group.position.y - 0.1,
        detail.group.position.z - 0.38
      );
      const haloScale = reduced ? 0.92 : 0.62 + haloProgress * 0.36;
      this.inkHaloMesh.scale.set(haloScale, haloScale, 1);
      this.inkHaloMesh.material.opacity = haloProgress * 0.56;
    }

    this.applyAppearance(detail.group, detail.quality.value, detail.valley);
  }

  updateOutgoing(dt, reduced) {
    const rate = reduced ? 35 : 5.4;
    const releasedCards = [];

    this.outgoingCards = this.outgoingCards.filter((outgoing) => {
      const slotPose = this.getSlotTargetPose(outgoing);
      if (!outgoing.slotPos) outgoing.slotPos = slotPose.position.clone();
      outgoing.slotPos.copy(slotPose.position);
      if (outgoing.sourcePosition) outgoing.sourcePosition.copy(slotPose.position);

      if (outgoing.phase === "align") {
        damp(outgoing.angle, 0, reduced ? 35 : 11.5, dt);
        damp(outgoing.lift, outgoing.holdLift ?? INSPECTION_LIFT, rate, dt);
        damp(outgoing.quality, 1, rate, dt);
        outgoing.valley.lerp(slotPose.valley, clamp(dt * 6, 0, 1));

        if (Math.abs(outgoing.angle.value) <= 0.012) {
          outgoing.angle.value = 0;
          outgoing.angle.velocity = 0;
          outgoing.phase = "lower";
        }
      }

      if (outgoing.phase === "lower") {
        damp(outgoing.angle, 0, reduced ? 35 : 16, dt);
        const seatBoost = outgoing.lift.value < 0.22 ? 1.32 : 1.0;
        const lowerRate = (reduced ? 35 : 5.2) * seatBoost;
        damp(outgoing.lift, 0, lowerRate, dt);
        damp(outgoing.quality, slotPose.quality, lowerRate, dt);
        outgoing.valley.lerp(slotPose.valley, clamp(dt * 10, 0, 1));

        if (Math.abs(outgoing.lift.value) < 0.003 && Math.abs(outgoing.angle.value) < 0.003) {
          const sourceCard = outgoing.sourceCard;
          if (sourceCard?.group) {
            sourceCard.angle.value = 0;
            sourceCard.angle.velocity = 0;
            sourceCard.quality.value = slotPose.quality;
            sourceCard.quality.velocity = 0;
            sourceCard.valley.copy(slotPose.valley);
            sourceCard.group.position.copy(slotPose.position);
            sourceCard.group.rotation.y = 0;
            if (sourceCard.group.userData?.folioTiltGroup) {
              sourceCard.group.userData.folioTiltGroup.rotation.x = slotPose.tiltX;
            }
            this.applyAppearance(sourceCard.group, sourceCard.quality.value, sourceCard.valley);
            sourceCard.group.visible = true;
            releasedCards.push(sourceCard);
          }
          outgoing.group.parent?.remove(outgoing.group);
          this.disposeObject(outgoing.group);
          return false;
        }
      }

      outgoing.group.position.set(
        outgoing.slotPos.x,
        outgoing.slotPos.y + outgoing.lift.value,
        outgoing.slotPos.z
      );
      outgoing.group.rotation.y = outgoing.angle.value;
      const liftRatio = clamp(outgoing.lift.value / INSPECTION_LIFT, 0, 1);
      outgoing.group.userData.folioTiltGroup.rotation.x = THREE.MathUtils.lerp(
        slotPose.tiltX,
        -0.03,
        liftRatio
      );
      this.applyAppearance(outgoing.group, outgoing.quality.value, outgoing.valley);
      return true;
    });

    if (releasedCards.length > 0) {
      releasedCards.forEach((card) => this.remapSingleCardIfOutOfWindow(card));
    }
  }

  applyAppearance(group, quality, valley) {
    const data = group.userData;
    if (!data) return;

    // 赛璐珞清漆护膜保持极低透明度（0.05 -> 0），绝不遮挡海报或造成白雾发灰
    if (data.cover?.material) {
      data.cover.material.opacity = 0.05 * (1 - quality);
    }

    // 阵列态保持 0.94 的清晰显色，详情态提升至 1.0 完整明度
    if (data.poster?.material) {
      data.poster.material.color.setScalar(0.94 + quality * 0.06);
    }

    if (data.substrate?.material) {
      data.substrate.material.color.copy(valley);
    }

    const frameTint = this.lensMode === "highscore" ? "#c9963b" : "#d5a85b";
    data.frame?.children?.forEach((part) => {
      if (part.material?.color) {
        part.material.color.copy(valley).lerp(new THREE.Color(frameTint), 0.48);
      }
    });
  }

  updateCamera(dt) {
    const detail = this.detailFolio;
    const isEnteringOrDetail =
      this.spaceState === "entering-detail" ||
      this.spaceState === "detail" ||
      (this.spaceState === "leaving-detail" && detail?.returnPhase === "align");

    const progressRate = this.settings.reducedMotion
      ? 35
      : this.spaceState === "leaving-detail"
        ? 7.2
        : 4.8;

    damp(
      this.detailProgress,
      isEnteringOrDetail ? 1 : 0,
      progressRate,
      dt
    );

    const aim = ARRAY_AIM.clone();
    const position = ARRAY_CAMERA.clone();

    if (detail) {
      const slotPose = this.getSlotTargetPose(detail);
      const anchorX = slotPose.position.x + this.archiveGroup.position.x;
      const anchorY = slotPose.position.y + INSPECTION_LIFT + this.archiveGroup.position.y;
      const anchorZ = slotPose.position.z + this.archiveGroup.position.z;

      const detailAim = new THREE.Vector3(
        anchorX + 1.9,
        anchorY + 0.55,
        anchorZ
      );

      const horizontal = DETAIL_DISTANCE * Math.cos(THREE.MathUtils.degToRad(14));
      const detailCamera = new THREE.Vector3(
        detailAim.x + horizontal * Math.sin(THREE.MathUtils.degToRad(18)),
        detailAim.y + DETAIL_DISTANCE * Math.sin(THREE.MathUtils.degToRad(14)),
        detailAim.z + horizontal * Math.cos(THREE.MathUtils.degToRad(18))
      );

      if (!this.lastDetailAim) this.lastDetailAim = new THREE.Vector3();
      if (!this.lastDetailCamera) this.lastDetailCamera = new THREE.Vector3();
      this.lastDetailAim.copy(detailAim);
      this.lastDetailCamera.copy(detailCamera);
    }

    if (this.lastDetailAim && this.lastDetailCamera && this.detailProgress.value > 0.0001) {
      aim.lerp(this.lastDetailAim, this.detailProgress.value);
      position.lerp(this.lastDetailCamera, this.detailProgress.value);
    }

    const rate = this.settings.reducedMotion
      ? 35
      : this.spaceState === "leaving-detail"
        ? 8.4
        : 4.8;

    damp(this.cameraAim.x, aim.x, rate, dt);
    damp(this.cameraAim.y, aim.y, rate, dt);
    damp(this.cameraAim.z, aim.z, rate, dt);
    damp(this.cameraPosition.x, position.x, rate, dt);
    damp(this.cameraPosition.y, position.y, rate, dt);
    damp(this.cameraPosition.z, position.z, rate, dt);

    this.camera.position.set(
      this.cameraPosition.x.value,
      this.cameraPosition.y.value,
      this.cameraPosition.z.value
    );

    this.camera.lookAt(
      this.cameraAim.x.value,
      this.cameraAim.y.value,
      this.cameraAim.z.value
    );

    // 连续平滑插值雾效距离，彻底消除原本 detailProgress > 0.3 阶跃跳变造成的全屏白闪
    const p = clamp(this.detailProgress.value, 0, 1);
    this.scene.fog.near = THREE.MathUtils.lerp(68, 58, p);
    this.scene.fog.far = THREE.MathUtils.lerp(138, 132, p);
  }

  hasMotion() {
    if (this.spaceState === "boot" || this.spaceState === "entering-detail" || this.spaceState === "leaving-detail") return true;
    if (this.noteSheetState === "extracting" || this.noteSheetState === "retracting") return true;
    if (this.outgoingCards.length || this.pulses.length || this.pointerDown) return true;
    if (Math.abs(this.archiveGroup.position.z) > 0.001) return true;

    if (this.detailFolio) {
      if (
        Math.abs(this.detailFolio.lift.velocity) > 0.001 ||
        Math.abs(this.detailFolio.angle.velocity) > 0.001 ||
        Math.abs(this.detailFolio.quality.velocity) > 0.001 ||
        Math.abs(this.detailFolio.angle.value - this.targetDetailAngle) > 0.001 ||
        Math.abs(this.dragVelocity) > 0.0001 ||
        Math.abs(this.noteSheetProgress.velocity) > 0.001
      ) {
        return true;
      }
    }

    if (this.outgoingCards.some((entry) =>
      Math.abs(entry.lift.velocity) > 0.001 ||
      Math.abs(entry.angle.velocity) > 0.001 ||
      Math.abs(entry.quality.velocity) > 0.001
    )) {
      return true;
    }

    const states = [
      this.rail,
      this.ridgeRow,
      this.ridgeLane,
      this.detailProgress,
      this.noteSheetProgress,
      this.cameraAim.x,
      this.cameraAim.y,
      this.cameraAim.z,
      this.cameraPosition.x,
      this.cameraPosition.y,
      this.cameraPosition.z
    ];

    return states.some((state) => Math.abs(state.velocity) > 0.001) ||
      this.cards.some((card) =>
        Math.abs(card.lift.velocity) > 0.001 ||
        Math.abs(card.angle.velocity) > 0.001 ||
        Math.abs(card.hover.velocity) > 0.001 ||
        Math.abs(card.quality.velocity) > 0.001
      );
  }

  tick = (time) => {
    if (this.isDestroyed || document.hidden) {
      this.rafId = null;
      return;
    }

    const now = Number(time) || performance.now();
    const dt = clamp((now - this.lastFrame) / 1000, 0.001, 0.05);

    this.lastFrame = now;
    this.clock += dt;

    this.updateBoot(now);
    this.updateCards(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    if (!this.hasMotion()) {
      if (!this.sleepAt) this.sleepAt = now;

      if (now - this.sleepAt > 1500) {
        this.rafId = null;
        return;
      }
    } else {
      this.sleepAt = null;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  wake() {
    if (this.isDestroyed || this.rafId) return;
    this.sleepAt = 0;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stopLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  resize() {
    const width = this.viewport.clientWidth || 1;
    const height = this.viewport.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  isSharedTexture(texture) {
    if (!texture) return false;
    for (const cached of this.textureCache.values()) {
      if (cached === texture) return true;
    }
    if (Array.isArray(this.cards)) {
      for (const card of this.cards) {
        const d = card.group?.userData;
        if (!d) continue;
        if (
          d.posterMaterial?.map === texture ||
          d.labelMaterial?.map === texture ||
          d.backMaterial?.map === texture ||
          d.noteSheetMaterial?.map === texture
        ) {
          return true;
        }
      }
    }
    return false;
  }

  disposeObject(object) {
    const materials = new Set();
    const geometries = new Set();

    object?.traverse((node) => {
      if (node.geometry && !geometries.has(node.geometry)) {
        geometries.add(node.geometry);
        node.geometry.dispose();
      }

      const list = Array.isArray(node.material) ? node.material : [node.material];

      list.filter(Boolean).forEach((material) => {
        if (!materials.has(material)) {
          materials.add(material);
          if (material.map && !this.isSharedTexture(material.map)) {
            material.map.dispose();
          }
          material.dispose();
        }
      });
    });
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.stopLoop();
    this.clearTimers(this.bootTimers);
    this.clearTimers(this.timers);
    this.activeViewer?.close();
    this.closeModal();
    this.closeNoteSheet(true);
    this.titleScrub?.destroy();
    this.rollingNumber?.destroy();
    this.audio.destroy();
    this.resizeObserver?.disconnect();

    this.viewport.removeEventListener("pointermove", this.onPointerMove);
    this.viewport.removeEventListener("pointerleave", this.onPointerLeave);
    this.viewport.removeEventListener("pointerdown", this.onPointerDown);
    this.viewport.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);

    this.textureCache.forEach((texture) => texture.dispose());
    this.textureCache.clear();
    this.cards = [];

    this.detailFolio?.group.parent?.remove(this.detailFolio.group);
    this.disposeObject(this.detailFolio?.group);

    this.outgoingCards.forEach((entry) => {
      entry.group.parent?.remove(entry.group);
      this.disposeObject(entry.group);
    });

    this.disposeObject(this.scene);
    this.renderer.dispose();
    this.container.empty();
  }
}

class ModelViewer {
  constructor(space, item) {
    this.space = space;
    this.item = item;
    this.rafId = null;
    this.angle = 0;
    this.targetExplode = 0;
    this.explode = 0;
    this.dragging = false;
  }

  open() {
    this.root = this.space.el(this.space.root, "section", "atelier-viewer");
    const host = this.space.el(this.root, "div", "atelier-viewer-canvas");
    const header = this.space.el(this.root, "div", "atelier-viewer-ui");

    this.space.el(header, "div", "atelier-mark", `360° 装帧检视 ／ 《${this.item.name || "未命名档案"}》`);
    this.space.action(header, "close-viewer", "关闭检视", () => this.close());

    const tools = this.space.el(this.root, "div", "atelier-viewer-tools");
    this.space.action(tools, "explode", "＋ 拆解装帧", () => { this.targetExplode = 1; });
    this.space.action(tools, "rebuild", "− 一键重组", () => { this.targetExplode = 0; });

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.root.clientWidth || 800, this.root.clientHeight || 600);
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1.5, 0.1, 50);
    this.camera.position.set(0, 0.35, 8);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d1c5, 2.1));

    const light = new THREE.DirectionalLight(0xffffff, 2.5);
    light.position.set(4, 5, 6);
    this.scene.add(light);

    this.model = buildCelFolio(this.item, { width: 3.1, height: 4.45 });
    this.space.loadDetailCover({ item: this.item, group: this.model });

    this.model.userData.parts.forEach((part) => {
      part.userData.baseZ = part.position.z;
    });

    this.scene.add(this.model);

    this.onDown = (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
    };

    this.onMove = (event) => {
      if (!this.dragging) return;
      this.angle += (event.clientX - this.lastX) * 0.008;
      this.lastX = event.clientX;
    };

    this.onUp = () => {
      this.dragging = false;
    };

    this.onResize = () => {
      const width = this.root?.clientWidth || 1;
      const height = this.root?.clientHeight || 1;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    };

    this.root.addEventListener("pointerdown", this.onDown);
    this.root.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("resize", this.onResize);

    this.render();
  }

  render = () => {
    if (!this.root) return;

    this.explode += (this.targetExplode - this.explode) * 0.1;
    this.model.rotation.y = this.angle;

    this.model.userData.parts.forEach((part, index) => {
      const offsets = {
        carrier: -1.2,
        substrate: -0.6,
        "poster-core": 0,
        "cel-frame": 0.6,
        cover: 1.2,
        fasteners: 1.8
      };

      const offset = offsets[part.userData.assemblyPart] ?? (index - 2.5) * 0.45;
      part.position.z = part.userData.baseZ + offset * this.explode;
    });

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.render);
  };

  close() {
    if (!this.root) return;

    cancelAnimationFrame(this.rafId);
    this.root.removeEventListener("pointerdown", this.onDown);
    this.root.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("resize", this.onResize);

    this.space.disposeObject(this.scene);
    this.renderer.dispose();
    this.root.remove();

    this.root = null;

    if (this.space.activeViewer === this) {
      this.space.activeViewer = null;
    }
  }
}

module.exports = {
  Dashboard3DSpace
};
