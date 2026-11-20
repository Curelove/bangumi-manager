import * as THREE from "three";
const { Notice } = require("obsidian");
const netabaTrendService = require("./netaba-trend-service.js");
const multiSiteRatingService = require("./multisite-rating-service.js");
const { inspectLocalFolder, openLocalPathSafely, parseFrontmatter, parseNoteReviewsSection } = require("./note-utils.js");
const reviewStudioService = require("./review-studio-service.js");
const { isMobileEnv, isDesktopNodeAvailable } = require("./platform-env.js");
const {
  STYLE_CATALOG,
  checkAtelierHdPackStatus,
  downloadAtelierHdPack,
  removeAtelierHdPack,
  preloadAtelierHdPrototypes,
  getCachedAtelierPrototype
} = require("./atelier-3d-pack-service.js");
const {
  buildSamplePreviewItems,
  isSamplePreviewActive,
  setSamplePreviewActive
} = require("./onboarding-sample-service.js");
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
  drawTierPlaqueTexture,
  buildTrackSignpost,
  updateTrackSignpost,
  clamp,
  smooth,
  disposeTexture
} = require("./dashboard-3d-helper.js");

const POOL_ROWS = 17;
const HALF_ROWS = 8;
const COLUMN_SPACING = 3.24;
const CORRIDOR_COL_SPACING = 3.24;
const CORRIDOR_ROW_SPACING = 1.24;
const EASEL_COL_SPACING = 3.38;
const ROW_SPACING = 0.92;
const INSPECTION_LIFT = 4.05;
const ARRAY_CAMERA = new THREE.Vector3(36.0, 27.5, 79.0);
const ARRAY_AIM = new THREE.Vector3(0, 0.86, -0.2);
const CORRIDOR_CAMERA_OFFSET = new THREE.Vector3(36.0, 27.5, 79.0);
const CORRIDOR_AIM_BASE = new THREE.Vector3(0, 0.86, -0.2);
const EASEL_CAMERA_OFFSET = new THREE.Vector3(0.0, 8.2, 114.0);
const EASEL_AIM_BASE = new THREE.Vector3(0, -0.32, 0);
const HIGHSCORE_CAMERA = new THREE.Vector3(24.0, 16.0, 62.0);
const HIGHSCORE_AIM = new THREE.Vector3(0, 1.12, 0);
const HIGHSCORE_LANE_TERRACES = [0, 0, 0, 0];
const DETAIL_DISTANCE = 68;
const BASE_VALLEY = new THREE.Color("#ddd4ca");
const CURATED_PEAK_VALLEY = new THREE.Color("#e8dec8");

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
  const personal = Number(item?.personalScore);
  if (Number.isFinite(personal) && personal > 0) return personal;

  const publicScores = [
    item?.preciseScore,
    item?.publicScore,
    item?.bangumiScore
  ]
    .map(Number)
    .filter((score) => Number.isFinite(score) && score > 0);

  return publicScores.length ? Math.max(...publicScores) : 0;
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
    let initialItems = Array.isArray(options.items) ? options.items.slice() : [];
    if (initialItems.length === 0 && isSamplePreviewActive(plugin)) {
      initialItems = buildSamplePreviewItems();
    }
    this.items = initialItems;
    this.isSamplePreviewSession = this.items.some((it) => Boolean(it?.isSamplePreviewItem));

    this.isDestroyed = false;
    this.isMobileDevice = isMobileEnv();
    this.userPortraitOverride = false;
    this.keyboardPausedLandscape = false;
    this.isVirtualLandscape = false;
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
        statusSubView: "corridor",
        customLanes: null
      },
      savedAtelier
    );
    this.settings.customLanes = normalizeLaneConfigs(this.settings.customLanes);
    this.settings.statusSubView = this.settings.statusSubView === "easel" ? "easel" : "corridor";

    this.motion = getMotionSettings(plugin);
    this.paletteExtractor = new CoverPaletteExtractor();
    this.audio = new AtelierAudioEngine();

    this.lensMode = "status";
    this.statusSubView = this.settings.statusSubView;
    this.easelBlend = spring(this.statusSubView === "easel" ? 1 : 0);
    this.lensFade = spring(1);
    this.lensTransition = null;
    this.activeLaneConfigs = [];
    this.laneNames = [];
    this.lanes = [];
    this.laneCount = 4;
    this.multiLaneItemIds = new Set();
    this.signposts = [];
    this.hoveredSignpost = null;

    this.focusLane = 0;
    this.focusRow = 0;
    this.laneSelections = [0, 0, 0, 0];
    this.laneFocusSprings = [];
    this.laneXSprings = [];
    this.laneRails = [];
    this.laneRidgeRows = [];
    this.rail = spring(0);
    this.ridgeRow = spring(0);
    this.ridgeLane = spring(0);
    this.detailProgress = spring(0);
    const initCam = this.statusSubView === "easel" ? EASEL_CAMERA_OFFSET : CORRIDOR_CAMERA_OFFSET;
    const initAim = this.statusSubView === "easel" ? EASEL_AIM_BASE : CORRIDOR_AIM_BASE;
    this.cameraPosition = {
      x: spring(initCam.x),
      y: spring(initCam.y),
      z: spring(initCam.z)
    };
    this.cameraAim = {
      x: spring(initAim.x),
      y: spring(initAim.y),
      z: spring(initAim.z)
    };

    this.paletteColor = new THREE.Color("#d9c6b4");
    this.targetPalette = new THREE.Color("#d9c6b4");
    this.currentPaletteHex = "#d9c6b4";

    this.hydrationQueue = [];
    this.hydrationTotal = 0;
    this.hydrationDone = 0;
    this.hydrationComplete = false;
    this.hydrationRafId = null;
    this.shadersCompiled = false;

    // 第一阶段（Frame 0）：零阻塞即时挂载 DOM 外壳与合成器光学序幕，随后启动分帧流式建档
    inject3DScopedStyles();
    this.makeLanes();
    this.initDom();
    this.syncMobileOrientationLayout();
    this.initThree();
    if (this.webglUnavailable) {
      return;
    }
    this.playBoot(false);
    this.bindEvents();
    this.applyQuality();
    const shouldAsyncHydrate =
      this.bootMode !== "none" &&
      !this.settings.reducedMotion &&
      typeof requestAnimationFrame === "function";
    const initialRenderedStyle = this.getModelStyle();
    this.buildPool({ asyncHydrate: shouldAsyncHydrate });
    this.selectCurrent(false);
    this.wake();

    // 异步预热本地精装扩展包 GLB 几何原型：若用户已启用精装模式但首帧尚未进内存，解析完成后无感热切换
    preloadAtelierHdPrototypes(this.plugin)
      .then(() => {
        if (this.isDestroyed) return;
        const resolvedStyle = this.getModelStyle();
        if (resolvedStyle !== initialRenderedStyle) {
          this.rebuildAllFolioModels();
        }
      })
      .catch(() => {});
  }

  getModelStyle() {
    const raw = String(this.plugin?.settings?.atelier3DModelStyle || "standard");
    if (raw === "hd_cel_folio" || raw === "hd_collector_box") {
      return getCachedAtelierPrototype(raw) ? raw : "standard";
    }
    return "standard";
  }

  rebuildAllFolioModels() {
    if (this.isDestroyed || this.webglUnavailable) return;
    this.flushHydrationNow();
    this.buildPool({ asyncHydrate: false });
    if (this.detailFolio && this.detailFolio.item) {
      const prevDetail = this.detailFolio;
      const savedLift = prevDetail.lift.value;
      const savedAngle = prevDetail.angle.value;
      const savedQuality = prevDetail.quality.value;
      const savedPos = prevDetail.group.position.clone();
      const matchedSource = this.cards.find(
        (c) => c.lane === prevDetail.lane && c.logicalRow === prevDetail.logicalRow
      ) || null;
      prevDetail.group.parent?.remove(prevDetail.group);
      this.disposeObject(prevDetail.group);
      this.detailFolio = null;
      this.createDetailFolio(prevDetail.item, matchedSource);
      if (this.detailFolio) {
        this.detailFolio.lift.value = savedLift;
        this.detailFolio.angle.value = savedAngle;
        this.detailFolio.quality.value = savedQuality;
        this.detailFolio.group.position.copy(savedPos);
        this.detailFolio.group.rotation.y = savedAngle;
      }
    }
    this.selectCurrent(false);
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
          const tierBadge =
            s >= 9.0
              ? "冠冕阶"
              : s >= 8.5
                ? "典藏阶"
                : s >= 8.0
                  ? "佳作阶"
                  : "甄选阶";
          return Object.assign({}, item, {
            curatedBadge: tierBadge,
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

      // 维度 2：口碑佳作（评分 >= 7.8 的高口碑代表作，按综合评分降序以保证四级展阶严格单调递降）
      const lane2 = claim(
        (item) => effectiveScore(item) >= 7.8,
        "scoreDesc",
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

      // 维度 4：新近高誉（2020 年以来开播的近作佳片 >= 7.4，按评分阶梯降序陈列）
      const lane4 = claim(
        (item) => (Number(item.year) || 0) >= 2020 && effectiveScore(item) >= 7.4,
        "scoreDesc",
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

    this.syncLaneSprings(false);
  }

  computeTargetCorridorLaneX(lane, focusLane = this.focusLane) {
    const centerOffset = (this.laneCount - 1) / 2;
    const base = (lane - centerOffset) * CORRIDOR_COL_SPACING;
    const d = lane - focusLane;
    if (d === 0) return base;
    const dir = Math.sign(d);
    const ad = Math.abs(d);
    return base + dir * 0.28 * Math.exp(-Math.max(0, ad - 1) * 0.75);
  }

  computeTargetEaselLaneX(lane) {
    const centerOffset = (this.laneCount - 1) / 2;
    return (lane - centerOffset) * EASEL_COL_SPACING;
  }

  computeTargetHighscoreLaneX(lane, focusLane = this.focusLane) {
    const d = lane - focusLane;
    if (d === 0) return 0;
    const ad = Math.abs(d);
    return Math.sign(d) * (3.35 * Math.tanh(ad * 1.45) + 1.45 * ad);
  }

  computeTargetLaneX(lane, focusLane = this.focusLane) {
    if (this.lensMode === "highscore") {
      return this.computeTargetHighscoreLaneX(lane, focusLane);
    }
    return this.statusSubView === "easel"
      ? this.computeTargetEaselLaneX(lane, focusLane)
      : this.computeTargetCorridorLaneX(lane, focusLane);
  }

  getEaselRotationY(lane) {
    const centerOffset = (this.laneCount - 1) / 2;
    const norm = centerOffset > 0 ? (lane - centerOffset) / centerOffset : 0;
    return clamp(-norm * 0.085, -0.12, 0.12);
  }

  syncLaneSprings(resetValues = false) {
    if (!Array.isArray(this.laneFocusSprings)) this.laneFocusSprings = [];
    if (!Array.isArray(this.laneXSprings)) this.laneXSprings = [];
    if (!Array.isArray(this.laneRails)) this.laneRails = [];
    if (!Array.isArray(this.laneRidgeRows)) this.laneRidgeRows = [];

    for (let i = 0; i < this.laneCount; i += 1) {
      const isAct = i === this.focusLane ? 1 : 0;
      const selRow = this.laneSelections[i] || 0;
      const targetX = this.computeTargetLaneX(i, this.focusLane);
      if (!this.laneFocusSprings[i] || resetValues) {
        this.laneFocusSprings[i] = spring(isAct);
      }
      if (!this.laneXSprings[i] || resetValues) {
        this.laneXSprings[i] = spring(targetX);
      }
      if (!this.laneRails[i] || resetValues) {
        this.laneRails[i] = spring(selRow * ROW_SPACING);
      }
      if (!this.laneRidgeRows[i] || resetValues) {
        this.laneRidgeRows[i] = spring(selRow);
      }
    }
    this.laneFocusSprings.length = this.laneCount;
    this.laneXSprings.length = this.laneCount;
    this.laneRails.length = this.laneCount;
    this.laneRidgeRows.length = this.laneCount;
    if (resetValues) {
      this.ridgeLane.value = this.focusLane;
      this.ridgeLane.velocity = 0;
      this.focusRow = this.laneSelections[this.focusLane] || 0;
      this.rail.value = this.focusRow * ROW_SPACING;
      this.rail.velocity = 0;
      this.ridgeRow.value = this.focusRow;
      this.ridgeRow.velocity = 0;
    }
  }

  syncRailToActiveLane() {
    const activeRail = this.laneRails?.[this.focusLane];
    const activeRidge = this.laneRidgeRows?.[this.focusLane];
    if (activeRail && this.lensMode !== "highscore") {
      this.rail.value = activeRail.value;
      this.rail.velocity = activeRail.velocity;
    }
    if (activeRidge && this.lensMode !== "highscore") {
      this.ridgeRow.value = activeRidge.value;
      this.ridgeRow.velocity = activeRidge.velocity;
    }
  }

  getLaneFocusValue(lane) {
    return this.laneFocusSprings?.[lane]?.value ?? (lane === this.focusLane ? 1 : 0);
  }

  getLaneXValue(lane) {
    return this.laneXSprings?.[lane]?.value ?? this.computeTargetLaneX(lane, this.focusLane);
  }

  getLaneRailValue(lane) {
    return this.laneRails?.[lane]?.value ?? this.rail.value;
  }

  getLaneRidgeRowValue(lane) {
    return this.laneRidgeRows?.[lane]?.value ?? this.ridgeRow.value;
  }

  getLanePoolCenter(lane) {
    if (this.lensMode === "highscore") {
      return Math.round(this.rail.value / ROW_SPACING);
    }
    return Math.round(this.getLaneRailValue(lane) / ROW_SPACING);
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
    this.root.dataset.statusSubView = this.statusSubView || "corridor";
    this.root.dataset.reducedMotion = String(Boolean(this.settings.reducedMotion));

    this.atmosphere = this.el(this.root, "div", "scene-atmosphere");
    this.inkBloomElement = this.el(this.root, "div", "atelier-ink-bloom");
    this.viewport = this.el(this.root, "div", "atelier-viewport");
    this.viewport.id = "viewport";
    this.ui = this.el(this.root, "div", "atelier-ui");

    const top = this.el(this.ui, "div", "atelier-top");
    top.dataset.ui = "top-bar";

    const brand = this.el(top, "div", "atelier-mark", "3D 原画展厅");
    this.brandSubElement = this.el(
      brand,
      "small",
      "",
      `番剧档案馆 · 馆藏 ${this.items.length} 部`
    );

    const topActions = this.el(top, "div", "atelier-actions");
    this.subViewGroup = this.el(topActions, "div", "atelier-subview-switch");
    this.subViewGroup.dataset.ui = "status-subview-switch";
    this.corridorSubBtn = this.action(
      this.subViewGroup,
      "subview-corridor",
      "开架回廊",
      () => this.setStatusSubView("corridor"),
      "atelier-subview-btn"
    );
    this.easelSubBtn = this.action(
      this.subViewGroup,
      "subview-easel",
      "折屏展架",
      () => this.setStatusSubView("easel"),
      "atelier-subview-btn"
    );
    this.lensButton = this.action(
      topActions,
      "lens",
      this.isMobileDevice ? "✦ 高分" : "✦ 高分精选",
      () => this.toggleLensMode()
    );
    this.searchButton = this.action(
      topActions,
      "search",
      this.isMobileDevice ? "⌕ 检索" : "⌕ 档案检索 [/]",
      () => this.openSearch()
    );
    this.audioButton = this.action(
      topActions,
      "audio",
      this.isMobileDevice ? "♪ 静音" : "♪ 环境音景 · 已静音",
      () => this.toggleAudio()
    );
    this.settingsButton = this.action(
      topActions,
      "settings",
      this.isMobileDevice ? "◷ 设置" : "◷ 空间设置",
      () => this.openSettings()
    );
    if (this.isMobileDevice) {
      this.topPinned = this.el(top, "div", "atelier-top-pinned");
      this.orientButton = this.action(
        this.topPinned,
        "toggle-orientation",
        "↻ 切竖屏",
        () => this.toggleMobileOrientation(),
        "atelier-btn atelier-orient-btn"
      );
      this.exitButton = this.action(
        this.topPinned,
        "exit",
        "← 返回档案馆",
        () => this.onExit3D?.(),
        "atelier-btn atelier-exit-btn"
      );
    } else {
      this.orientButton = null;
      this.exitButton = this.action(topActions, "exit", "← 返回档案馆", () => this.onExit3D?.());
    }

    this.curationBanner = this.el(this.ui, "div", "atelier-curation-banner");
    this.curationBanner.dataset.ui = "curation-banner";

    if (this.isSamplePreviewSession) {
      this.sampleBanner = this.el(this.ui, "div", "atelier-sample-banner");
      this.sampleBanner.dataset.ui = "sample-preview-banner";
      this.el(
        this.sampleBanner,
        "span",
        "",
        "✦ 示例样片预览中（3 部虚拟档案，不占用也不修改笔记库）"
      );
      this.action(
        this.sampleBanner,
        "exit-sample-3d",
        "退出示例并返回开馆台 ↗",
        () => {
          setSamplePreviewActive(this.plugin, false);
          if (typeof this.onExit3D === "function") {
            this.onExit3D();
          }
        },
        "atelier-text-action"
      );
    }

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

  setStatusSubView(mode) {
    const next = mode === "easel" ? "easel" : "corridor";
    if (this.lensMode !== "status") {
      this.statusSubView = next;
      this.settings.statusSubView = next;
      this.root.dataset.statusSubView = next;
      this.saveSettings().catch(() => {});
      this.toggleLensMode();
      return;
    }
    if (this.statusSubView === next) return;

    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();
      this.spaceState = "array";
      this.root.dataset.spaceState = "array";
      this.detailElement?.classList.remove("is-visible");
    }

    this.statusSubView = next;
    this.settings.statusSubView = next;
    this.root.dataset.statusSubView = next;
    this.hoveredCard = null;
    this.hoveredSignpost = null;
    this.hoverElement?.classList.remove("is-visible");
    this.saveSettings().catch(() => {});
    this.updateToolbar();
    this.audio.cue("tick");
    this.wake();
  }

  renderCurationBanner() {
    if (!this.curationBanner) return;
    this.curationBanner.empty();
    this.el(this.curationBanner, "span", "atelier-curation-eyebrow", "✦ 高分策展四柱");

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
        if (idx === this.focusLane) return;

        if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
          this.closeNoteSheet(true);
          this.queueDetailOutgoing();
          this.spaceState = "array";
          this.root.dataset.spaceState = "array";
          this.detailElement.classList.remove("is-visible");
        }

        this.focusLane = idx;
        this.focusRow = this.laneSelections[idx] || 0;
        this.syncRailToActiveLane();

        this.ensureFocusRowInPoolWindow();
        this.selectCurrent(true);

        this.audio.cue("tick");
        this.wake();
      };
    });
  }

  initThree() {
    const width = this.viewport.clientWidth || 960;
    const height = this.viewport.clientHeight || 640;

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
    } catch (_) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: false,
          alpha: true
        });
      } catch (webglErr) {
        this.webglUnavailable = true;
        this.spaceState = "array";
        if (this.bootElement) this.bootElement.style.display = "none";
        if (this.ui) {
          this.ui.style.opacity = "1";
          this.ui.style.pointerEvents = "auto";
        }
        const fallbackNotice = document.createElement("div");
        fallbackNotice.className = "atelier-webgl-fallback";
        fallbackNotice.style.cssText =
          "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#5c4b3b;font-size:13px;";
        fallbackNotice.textContent = "当前窗口环境暂未启用 WebGL 硬件加速，可点击右上角「← 返回档案馆」切换回番剧档案馆。";
        this.viewport.appendChild(fallbackNotice);
        return;
      }
    }

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.viewport.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog("#eae5e1", 72, 168);

    // 兼容开架回廊与折屏展架远摄景深范围，配合动态近裁剪面彻底消除薄层共面闪烁
    this.camera = new THREE.PerspectiveCamera(4.6, width / height, 16, 265);
    const startShot = this.getStatusCameraShot();
    this.camera.position.copy(startShot.position);
    this.camera.lookAt(startShot.aim);
    this.cameraPosition.x.value = startShot.position.x;
    this.cameraPosition.y.value = startShot.position.y;
    this.cameraPosition.z.value = startShot.position.z;
    this.cameraAim.x.value = startShot.aim.x;
    this.cameraAim.y.value = startShot.aim.y;
    this.cameraAim.z.value = startShot.aim.z;

    this.scene.add(new THREE.HemisphereLight(0xfffdf8, 0xded7ce, 2.2));

    const key = new THREE.DirectionalLight(0xfffbf3, 2.05);
    key.position.set(-16, 28, 24);
    this.scene.add(key);

    this.archiveGroup = new THREE.Group();
    this.scene.add(this.archiveGroup);

    this.signpostGroup = new THREE.Group();
    this.archiveGroup.add(this.signpostGroup);

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

    this.buildSignposts();
    this.addRegistrationLines();
    this.pointer = new THREE.Vector2(-10, -10);
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  getSignpostInfo(lane) {
    const laneList = this.lanes[lane] || [];
    const cfg = this.activeLaneConfigs[lane] || {};
    const selRow = lane === this.focusLane ? this.focusRow : (this.laneSelections[lane] || 0);
    let activeIdx = 0;
    if (laneList.length > 0) {
      if (laneList.length < 8) {
        const start = -Math.floor((laneList.length - 1) / 2);
        activeIdx = clamp(selRow - start, 0, laneList.length - 1) + 1;
      } else {
        const w = wrap(selRow, laneList.length + 1);
        activeIdx = (w >= laneList.length ? 0 : w) + 1;
      }
    }
    const rawBadge = String(cfg.badge || `TRACK 0${lane + 1}`).split("·")[0].trim();
    return {
      lane,
      name: this.laneNames[lane] || `轨道 0${lane + 1}`,
      badge: rawBadge,
      accent: cfg.accent || "#9b7247",
      plaqueNote: cfg.plaqueNote || "",
      totalCount: laneList.length,
      cursorIndex: activeIdx,
      countLabel: `共 ${laneList.length} 部`,
      cursorLabel: laneList.length
        ? `${String(activeIdx).padStart(2, "0")} / ${String(laneList.length).padStart(2, "0")}`
        : "EMPTY",
      isActive: lane === this.focusLane
    };
  }

  buildSignposts() {
    if (!this.signpostGroup) return;
    if (Array.isArray(this.signposts)) {
      this.signposts.forEach((sp) => {
        sp.group?.parent?.remove(sp.group);
        this.disposeObject(sp.group);
      });
    }
    this.signposts = [];
    this.hoveredSignpost = null;

    if (this.lensMode === "highscore") {
      this.signpostGroup.visible = false;
      return;
    }

    this.signpostGroup.visible = true;
    for (let lane = 0; lane < this.laneCount; lane += 1) {
      const info = this.getSignpostInfo(lane);
      const group = buildTrackSignpost(info);
      group.renderOrder = 10;
      const fadeMats = [];
      group.traverse((node) => {
        const list = Array.isArray(node.material) ? node.material : [node.material];
        list.filter(Boolean).forEach((m) => {
          m.transparent = true;
          if (m.userData.__spBaseOpacity === undefined) {
            m.userData.__spBaseOpacity = typeof m.opacity === "number" ? m.opacity : 1;
          }
          fadeMats.push(m);
        });
      });
      this.signpostGroup.add(group);
      this.signposts.push({
        lane,
        group,
        fadeMats,
        hover: spring(0)
      });
    }
    this.updateSignposts(0.016);
  }

  updateSignposts(dt) {
    if (!this.signpostGroup) return;
    if (this.lensMode === "highscore") {
      this.signpostGroup.visible = false;
      return;
    }
    const fade = this.lensFade?.value ?? 1;
    const detailDim = 1 - clamp(this.detailProgress?.value ?? 0, 0, 1) * 0.72;
    this.signpostGroup.visible = fade > 0.02;
    if (!this.signpostGroup.visible) return;

    const reduced = this.settings.reducedMotion || this.motion.transition === false;
    const easelMix = clamp(this.easelBlend?.value ?? 0, 0, 1);

    this.signposts.forEach((sp) => {
      const lane = sp.lane;
      const info = this.getSignpostInfo(lane);
      updateTrackSignpost(sp.group, info);

      const isHovered = this.spaceState === "array" && this.hoveredSignpost === sp;
      damp(sp.hover, isHovered ? 0.14 : 0, reduced ? 35 : 10, dt);

      const focusVal = clamp(this.getLaneFocusValue(lane), 0, 1);
      const x = this.getLaneXValue(lane);
      const corridorY = 2.66 + focusVal * 0.14;
      const easelY = 2.74 + focusVal * 0.08;
      const y = THREE.MathUtils.lerp(corridorY, easelY, easelMix) + sp.hover.value;
      const z = THREE.MathUtils.lerp(0.14 + focusVal * 0.18, 0.86 + focusVal * 0.16, easelMix);
      const baseScale = THREE.MathUtils.lerp(0.86, 0.94, easelMix) + focusVal * 0.05 + (isHovered ? 0.025 : 0);

      sp.group.position.set(x, y, z);
      sp.group.scale.setScalar(baseScale);
      sp.group.rotation.y = THREE.MathUtils.lerp(0.24, this.getEaselRotationY(lane), easelMix);
      sp.group.rotation.x = THREE.MathUtils.lerp(-0.12, -0.04, easelMix);

      const rawPresence = THREE.MathUtils.lerp(
        0.78 + focusVal * 0.22,
        0.96 + focusVal * 0.04,
        easelMix
      );
      const presence = rawPresence * fade * detailDim;
      sp.fadeMats.forEach((m) => {
        const baseOp = m.userData.__spBaseOpacity ?? 1;
        m.opacity = clamp(baseOp * presence, 0, 1);
      });
    });
  }

  signpostFromObject(object) {
    if (!Array.isArray(this.signposts) || !this.signposts.length) return null;
    let node = object;
    while (node) {
      const hit = this.signposts.find((entry) => entry.group === node);
      if (hit) return hit;
      node = node.parent;
    }
    return null;
  }

  focusTrackBySignpost(laneIndex, diag = null) {
    if (laneIndex < 0 || laneIndex >= this.laneCount) return;

    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();
      this.spaceState = "array";
      this.root.dataset.spaceState = "array";
      this.detailElement?.classList.remove("is-visible");
    }

    if (diag) {
      diag.hitType = "track-signpost";
      diag.actionTaken = `switch-lane:${laneIndex}:${this.laneNames[laneIndex] || ""}`;
    }

    this.focusLane = laneIndex;
    this.focusRow = this.calcNavRow(laneIndex, this.laneSelections[laneIndex] || 0, 0);
    this.laneSelections[laneIndex] = this.focusRow;
    this.syncRailToActiveLane();
    this.ensureFocusRowInPoolWindow();
    this.selectCurrent(true);
    this.audio.cue("tick");
    this.wake();
  }

  laneX(lane) {
    return this.getLaneXValue(lane);
  }

  getHighscoreTerraceY() {
    return 0;
  }

  getScoreNormalized(item) {
    if (!item || item.slotType !== "anime") return 0;

    const score = effectiveScore(item);
    if (!score) return 0;

    return clamp((score - 7.0) / 2.2, 0, 1);
  }

  getScoreTier(item) {
    if (!item || item.slotType !== "anime") return 0;

    const score = effectiveScore(item);

    if (score >= 9.0) return 3;
    if (score >= 8.5) return 2;
    if (score >= 8.0) return 1;
    return 0;
  }

  getScoreTierElevation(item) {
    const tier = this.getScoreTier(item);

    // 四级策展展阶（同一等级高度严格对齐，级差 0.58，既直观拉开等级秩序，又防止顶部卡片碰撞顶栏横幅）：
    // 7.0-7.9 甄选阶 (-0.12)
    // 8.0-8.4 佳作阶 ( 0.46)
    // 8.5-8.9 典藏阶 ( 1.04)
    // 9.0+    冠冕阶 ( 1.62)
    return [-0.12, 0.46, 1.04, 1.62][tier] ?? -0.12;
  }

  getScoreRidgeElevation(item) {
    if (this.lensMode !== "highscore" || !item) return 0;
    if (item.slotType === "blank") return -0.18;
    if (item.slotType === "divider") return -0.12;

    return this.getScoreTierElevation(item);
  }

  getScoreTiltOffset(item) {
    if (this.lensMode !== "highscore" || item?.slotType !== "anime") return 0;

    const tier = this.getScoreTier(item);
    return [0.0, 0.025, 0.05, 0.075][tier] ?? 0;
  }

  getHighscoreVisualRowSpacing() {
    // 逻辑 ROW_SPACING (0.92) 继续用于对象池，高分视觉行距放大到 1.68 让同屏只聚焦 3~5 张核心原画
    return 1.68;
  }

  getHighscoreLaneFocusWeight(lane) {
    if (this.lensMode !== "highscore") return 1;

    const focusVal = clamp(this.getLaneFocusValue(lane), 0, 1);
    return 0.14 + 0.86 * smooth(focusVal);
  }

  getHighscoreLaneX(lane) {
    return this.getLaneXValue(lane);
  }

  getHighscoreCardZ(logicalRow) {
    const visualRow = this.rail.value / ROW_SPACING;

    if (this.lensMode !== "highscore") {
      return -(logicalRow * ROW_SPACING) + this.rail.value;
    }

    return -(logicalRow - visualRow) * this.getHighscoreVisualRowSpacing();
  }

  getHighscoreCameraShot() {
    const laneAzimuths = [-20, -7, 7, 20];
    const laneElevations = [15.4, 16.2, 16.0, 16.8];
    const laneRadii = [65.8, 64.5, 64.5, 66.0];

    const idx = clamp(this.focusLane, 0, laneAzimuths.length - 1);
    const azimuth = laneAzimuths[idx];
    const baseCamY = laneElevations[idx];
    const baseRadius = laneRadii[idx];

    const angle = THREE.MathUtils.degToRad(azimuth);
    const rowVelocity = clamp(
      Math.abs(this.rail.velocity) / ROW_SPACING,
      0,
      1.4
    );

    const radius = baseRadius + rowVelocity * 1.25;
    const aimY = 1.12;
    const cameraY = baseCamY + rowVelocity * 0.2;

    return {
      position: new THREE.Vector3(
        Math.sin(angle) * radius,
        cameraY,
        Math.cos(angle) * radius
      ),
      aim: new THREE.Vector3(0, aimY, 0)
    };
  }

  getStatusCameraShot() {
    const aspect = this.camera?.aspect || 1.6;
    const narrowMix = clamp((1.25 - aspect) / 0.72, 0, 1);

    const corridorFocusX = this.computeTargetCorridorLaneX(this.focusLane, this.focusLane);
    const corridorExtraPan =
      Math.sign(corridorFocusX) * Math.max(0, Math.abs(corridorFocusX) - 4.9) * 0.76;
    const corridorPanFactor = THREE.MathUtils.lerp(0.24, 0.88, narrowMix);
    const corridorPanX = corridorFocusX * corridorPanFactor + corridorExtraPan * (1 - narrowMix * 0.65);

    const corridorPos = new THREE.Vector3(
      CORRIDOR_CAMERA_OFFSET.x * (1 - narrowMix * 0.35) + corridorPanX,
      CORRIDOR_CAMERA_OFFSET.y,
      CORRIDOR_CAMERA_OFFSET.z + narrowMix * 12
    );
    const corridorAim = new THREE.Vector3(
      CORRIDOR_AIM_BASE.x + corridorPanX,
      CORRIDOR_AIM_BASE.y,
      CORRIDOR_AIM_BASE.z
    );

    const easelFocusX = this.computeTargetEaselLaneX(this.focusLane, this.focusLane);
    const easelExtraPan =
      Math.sign(easelFocusX) * Math.max(0, Math.abs(easelFocusX) - 5.25) * 0.78;
    const easelPanFactor = THREE.MathUtils.lerp(0.14, 0.9, narrowMix);
    const easelPanX = easelFocusX * easelPanFactor + easelExtraPan * (1 - narrowMix * 0.65);

    const easelPos = new THREE.Vector3(
      EASEL_CAMERA_OFFSET.x + easelPanX,
      EASEL_CAMERA_OFFSET.y,
      EASEL_CAMERA_OFFSET.z + narrowMix * 10
    );
    const easelAim = new THREE.Vector3(
      EASEL_AIM_BASE.x + easelPanX,
      EASEL_AIM_BASE.y,
      EASEL_AIM_BASE.z
    );

    if (this.statusSubView === "easel") {
      return { position: easelPos, aim: easelAim };
    }
    return { position: corridorPos, aim: corridorAim };
  }

  computeStatusCardPose(lane, logicalRow, item, options = {}) {
    const blank = item?.slotType === "blank";
    const divider = item?.slotType === "divider";
    const liftVal = options.liftVal ?? 0;
    const hoverVal = options.hoverVal ?? 0;
    const ripple = options.ripple ?? 0;
    const angleVal = options.angleVal ?? 0;
    const easelMix = clamp(this.easelBlend?.value ?? (this.statusSubView === "easel" ? 1 : 0), 0, 1);

    const laneFocus = clamp(this.getLaneFocusValue(lane), 0, 1);
    const laneRail = this.getLaneRailValue(lane);
    const laneRidgeRow = this.getLaneRidgeRowValue(lane);
    const laneVisualRow = laneRail / ROW_SPACING;
    const dRow = logicalRow - laneRidgeRow;
    const rowDelta = logicalRow - laneVisualRow;
    const x = this.getLaneXValue(lane);

    const corridorRidge = blank
      ? 0
      : (divider ? 0.18 : 0.42) * bell(dRow, 2.5) * (0.28 + 0.72 * laneFocus);

    const apertureWeight = blank ? 0 : laneFocus * bell(dRow + 1.18, 0.76);
    const apertureY = -0.26 * apertureWeight;
    const apertureZ = -0.34 * CORRIDOR_ROW_SPACING * apertureWeight;

    const corridorY = -0.36 + liftVal * 0.72 + hoverVal + corridorRidge + apertureY + ripple;
    const corridorZ =
      -rowDelta * CORRIDOR_ROW_SPACING +
      (lane % 2) * 0.22 +
      apertureZ +
      laneFocus * 0.22;
    const corridorScale = 0.92 + laneFocus * 0.04;
    const corridorTiltX = -0.20 - apertureWeight * 0.05;
    const corridorRotY = angleVal;

    const corridorDist = Math.abs(rowDelta);
    const corridorReveal = smooth(clamp((6.8 - corridorDist) / 3.2, 0, 1));
    const corridorFarBlur = smooth(clamp((corridorDist - 1.35) / 3.8, 0, 1));
    const corridorPresence = 0.86 + laneFocus * 0.14;

    // 折屏展架：适度放大约 25%（0.70–0.725），同屏主显前 2 排半，解除非选中列柔焦与半透明遮罩
    let easelY;
    let easelZ;
    if (rowDelta >= 0) {
      easelY = 0.60 - rowDelta * 2.46 + liftVal * 0.14 + hoverVal * 0.42 + ripple * 0.22;
      easelZ = 0.46 - rowDelta * 0.24 + laneFocus * 0.22;
    } else {
      easelY = 0.60 - rowDelta * 1.25 + liftVal * 0.14;
      easelZ = 0.46 + rowDelta * 0.85 + laneFocus * 0.22;
    }
    const easelScale = (divider ? 0.62 : 0.70) + laneFocus * 0.025;
    const easelTiltX = -0.072;
    const easelRotY = this.getEaselRotationY(lane) + angleVal;

    let easelReveal = 0;
    if (!blank) {
      const topVis = smooth(clamp((rowDelta + 0.52) / 0.46, 0, 1));
      const bottomVis = smooth(clamp((2.75 - rowDelta) / 0.65, 0, 1));
      easelReveal = topVis * bottomVis;
    }
    const easelFarBlur = clamp(Math.max(0, rowDelta - 2.15) * 0.35, 0, 0.35);
    const easelPresence = 1.0;

    return {
      x,
      y: THREE.MathUtils.lerp(corridorY, easelY, easelMix),
      z: THREE.MathUtils.lerp(corridorZ, easelZ, easelMix),
      scale: THREE.MathUtils.lerp(corridorScale, easelScale, easelMix),
      tiltX: THREE.MathUtils.lerp(corridorTiltX, easelTiltX, easelMix),
      rotationY: THREE.MathUtils.lerp(corridorRotY, easelRotY, easelMix),
      reveal: THREE.MathUtils.lerp(corridorReveal, easelReveal, easelMix),
      farBlur: THREE.MathUtils.lerp(corridorFarBlur, easelFarBlur, easelMix),
      presence: THREE.MathUtils.lerp(corridorPresence, easelPresence, easelMix)
    };
  }

  addRegistrationLines() {
    if (this.registrationLines) {
      this.archiveGroup.remove(this.registrationLines);
      this.disposeObject(this.registrationLines);
      this.registrationLines = null;
    }
    if (this.easelRackLines) {
      this.archiveGroup.remove(this.easelRackLines);
      this.disposeObject(this.easelRackLines);
      this.easelRackLines = null;
    }

    const points = [];
    const tierHeights = [-0.12, 0.46, 1.04, 1.62];

    if (this.lensMode === "highscore") {
      const halfZ = 7.2;
      const halfX = 1.54;
      const rulerX = -1.96;
      const stepZ = this.getHighscoreVisualRowSpacing();

      // 中央主展廊的底部纵向导轨
      points.push(-halfX, -0.22, -halfZ, -halfX, -0.22, halfZ);
      points.push(halfX, -0.22, -halfZ, halfX, -0.22, halfZ);
      points.push(0, -0.23, -halfZ, 0, -0.23, halfZ);

      // 四级评分展阶线：在 Z = 0（屏幕中央焦点平面）及前后相邻行绘制展阶台面框线与两侧标尺刻度
      tierHeights.forEach((y) => {
        points.push(-halfX, y, -halfZ, -halfX, y, halfZ);
        points.push(halfX, y, -halfZ, halfX, y, halfZ);

        // Z = 0 焦点平面的横向展阶基准线与左右对称评级尺刻度（确保无论左斜视还是右斜视均在焦点卡旁清晰可见）
        points.push(-halfX, y, 0, halfX, y, 0);
        points.push(rulerX - 0.32, y, 0, -halfX, y, 0);
        points.push(halfX, y, 0, -rulerX + 0.32, y, 0);

        // 前后相邻行 (Z = ±stepZ) 的辅助标尺刻度
        points.push(rulerX - 0.18, y, -stepZ, rulerX + 0.12, y, -stepZ);
        points.push(rulerX - 0.18, y, stepZ, rulerX + 0.12, y, stepZ);
      });

      // 位于 Z = 0 的左右双侧垂直评分标尺立柱及底座横梁
      points.push(rulerX, -0.22, 0, rulerX, 1.86, 0);
      points.push(-rulerX, -0.22, 0, -rulerX, 1.86, 0);
      points.push(rulerX, -0.22, -stepZ, rulerX, 1.76, -stepZ);
      points.push(rulerX, -0.22, stepZ, rulerX, 1.76, stepZ);
      points.push(rulerX - 0.36, -0.22, 0, -rulerX + 0.36, -0.22, 0);

      // 远近行定位刻度
      for (let row = -4; row <= 4; row += 1) {
        const z = row * stepZ;
        points.push(-halfX - 0.14, -0.22, z, -halfX + 0.14, -0.22, z);
        points.push(halfX - 0.14, -0.22, z, halfX + 0.14, -0.22, z);
      }
    } else {
      const halfWidth = Math.max(
        9,
        (this.laneCount * CORRIDOR_COL_SPACING) / 2 + 2.6
      );
      const centerOffset = (this.laneCount - 1) / 2;

      for (let lane = 0; lane < this.laneCount; lane += 1) {
        const x = (lane - centerOffset) * CORRIDOR_COL_SPACING;
        points.push(x, -0.52, -22, x, -0.52, 22);
      }

      for (let row = -18; row <= 18; row += 1) {
        const z = row * CORRIDOR_ROW_SPACING;
        points.push(-halfWidth, -0.52, z, halfWidth, -0.52, z);
      }

      // 折屏展架专属后景托线：严格置于所有卡片背后的背景层 (Z = -0.96)，绝不横穿任何封面
      const rackPoints = [];
      const rackZ = -0.96;
      for (let lane = 0; lane < this.laneCount; lane += 1) {
        const rx = (lane - centerOffset) * EASEL_COL_SPACING;
        const hw = 0.90;
        rackPoints.push(rx - hw, -4.65, rackZ, rx - hw, 2.24, rackZ);
        rackPoints.push(rx + hw, -4.65, rackZ, rx + hw, 2.24, rackZ);
        rackPoints.push(rx - hw - 0.14, -0.58, rackZ, rx + hw + 0.14, -0.58, rackZ);
        rackPoints.push(rx - hw - 0.14, -3.04, rackZ, rx + hw + 0.14, -3.04, rackZ);
      }
      const rackGeo = new THREE.BufferGeometry();
      rackGeo.setAttribute("position", new THREE.Float32BufferAttribute(rackPoints, 3));
      const rackMat = new THREE.LineBasicMaterial({
        color: 0xb99b6b,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false
      });
      this.easelRackLines = new THREE.LineSegments(rackGeo, rackMat);
      this.easelRackLines.renderOrder = -2;
      this.archiveGroup.add(this.easelRackLines);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3)
    );

    const dashUniforms = {
      uDashOffset: { value: 0 }
    };

    const lineMaterial = new THREE.LineDashedMaterial({
      color: this.lensMode === "highscore" ? 0xb59663 : 0xc6beb2,
      transparent: true,
      opacity: this.lensMode === "highscore" ? 0.36 : 0.22,
      dashSize: this.lensMode === "highscore" ? 0.24 : 0.22,
      gapSize: this.lensMode === "highscore" ? 0.88 : 0.82,
      scale: 1
    });

    lineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uDashOffset = dashUniforms.uDashOffset;
      shader.fragmentShader = `uniform float uDashOffset;\n${shader.fragmentShader}`.replace(
        "mod( vLineDistance, totalSize )",
        "mod( vLineDistance + uDashOffset, totalSize )"
      );
    };

    this.registrationLines = new THREE.LineSegments(geometry, lineMaterial);
    this.registrationLines.computeLineDistances();
    this.registrationLines.userData.baseOpacity = lineMaterial.opacity;
    this.registrationLines.userData.phase = this.lensMode === "highscore" ? 0.42 : 0;
    this.registrationLines.userData.dashUniforms = dashUniforms;

    // 高分精选态：在中央焦点平面 (Z = 0) 左侧标尺立柱旁挂载四级实体评级铭牌，让“高度代表分数”一目了然
    if (this.lensMode === "highscore") {
      const tierPlaques = [];
      const plaqueGeo = new THREE.PlaneGeometry(1.12, 0.298);
      tierHeights.forEach((y, tierIdx) => {
        const tex = drawTierPlaqueTexture(tierIdx);
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.82,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(plaqueGeo, mat);
        mesh.position.set(-2.62, y + 0.04, 0);
        mesh.rotation.x = -0.14;
        this.registrationLines.add(mesh);
        tierPlaques.push({ mesh, mat, tierIdx, baseY: y + 0.04 });
      });
      this.registrationLines.userData.tierPlaques = tierPlaques;
    }

    this.archiveGroup.add(this.registrationLines);
  }

  updateRegistrationLines() {
    const lines = this.registrationLines;
    const material = lines?.material;
    if (!lines || !material) return;

    const reduced = this.settings.reducedMotion;
    const activeRail = this.lensMode === "highscore" ? this.rail : (this.laneRails?.[this.focusLane] || this.rail);
    const scrollEnergy = clamp(
      Math.abs(activeRail.velocity) / ROW_SPACING,
      0,
      2
    );

    const timeFlow = reduced ? 0 : this.clock * 0.38;
    const scrollFlow = activeRail.value * 0.26;
    const offsetValue = -timeFlow - scrollFlow - (lines.userData.phase ?? 0);

    if (lines.userData.dashUniforms?.uDashOffset) {
      lines.userData.dashUniforms.uDashOffset.value = offsetValue;
    }
    material.dashOffset = offsetValue;

    const fade = this.lensFade?.value ?? 1;
    const easelMix = this.lensMode === "highscore" ? 0 : clamp(this.easelBlend?.value ?? 0, 0, 1);
    const baseOpacity = lines.userData.baseOpacity ?? (this.lensMode === "highscore" ? 0.36 : 0.22);

    // 切向折屏展架时，回廊地面流动白虚线随镜头平滑下沉并淡出至完全消失，绝不横穿正面封面
    const corridorLineFade =
      this.lensMode === "highscore"
        ? 1
        : Math.pow(clamp(1 - easelMix * 1.48, 0, 1), 1.75);
    lines.visible = corridorLineFade > 0.004 && fade > 0.01;
    material.opacity = (baseOpacity + scrollEnergy * 0.06) * fade * corridorLineFade;

    if (this.easelRackLines?.material) {
      const rackFade = smooth(clamp((easelMix - 0.18) / 0.82, 0, 1));
      this.easelRackLines.visible = rackFade > 0.005 && fade > 0.02;
      this.easelRackLines.material.opacity = 0.20 * rackFade * fade;
    }

    // 高分模式下同步高亮当前选中作品对应的评分展阶标尺铭牌
    const tierPlaques = lines.userData.tierPlaques;
    if (Array.isArray(tierPlaques)) {
      const activeTier =
        this.selectedCard?.item?.slotType === "anime"
          ? this.getScoreTier(this.selectedCard.item)
          : -1;
      tierPlaques.forEach((entry) => {
        const isCurrentTier = entry.tierIdx === activeTier;
        entry.mat.opacity = (isCurrentTier ? 0.98 : 0.62) * fade;
        const s = isCurrentTier ? 1.08 : 0.96;
        entry.mesh.scale.setScalar(s);
      });
    }

    // 让基准尺随档案阵列产生轻微视差，并在折屏切换途中自然退向地平面后下方
    lines.position.y = -easelMix * 1.85;
    lines.position.z = Math.sin(activeRail.value * 0.16) * 0.065 - easelMix * 4.2;
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const mobileTouch =
      isMobileEnv() ||
      (typeof window !== "undefined" &&
        window.innerWidth <= 768 &&
        Number(navigator?.maxTouchPoints || 0) > 0);
    if (mobileTouch) {
      // 移动端高刷顺滑省电档：限制 DPR <= 1.65 并关闭重度实时阴影贴图，保障 60/120Hz 触控跟手不发热
      this.renderer.setPixelRatio(this.settings.highQuality ? Math.min(1.65, dpr) : 1);
      this.renderer.shadowMap.enabled = false;
    } else {
      // 桌面端高画质档：启用 2.0x–2.5x 超采样抗锯齿（SSAA），显著提升缩略海报、导视牌与汉字笔画锐度
      const desktopTargetDpr = this.settings.highQuality
        ? Math.min(2.5, Math.max(dpr * 1.35, 2.0))
        : Math.min(1.25, dpr);
      this.renderer.setPixelRatio(desktopTargetDpr);
      this.renderer.shadowMap.enabled = Boolean(this.settings.highQuality);
    }
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

  installFolioOptics(group) {
    const data = group?.userData;
    if (!data) return;

    const material = data.posterMaterial;
    if (material && !data.opticalUniforms) {
      const uniforms = {
        uOpticalBlur: { value: 0 },
        uOpticalAlpha: { value: 1 }
      };

      // 不透明优先（Opaque-First）：前景与焦点卡片保持 transparent=false 留在不透明 Z-Buffer 渲染队列，彻底根除半透明中心点排序闪烁
      material.transparent = false;
      material.depthWrite = true;
      material.customProgramCacheKey = () => "atelier-poster-optics-v2";

      material.onBeforeCompile = (shader) => {
        shader.uniforms.uOpticalBlur = uniforms.uOpticalBlur;
        shader.uniforms.uOpticalAlpha = uniforms.uOpticalAlpha;

        shader.fragmentShader = `
          uniform float uOpticalBlur;
          uniform float uOpticalAlpha;
        ${shader.fragmentShader}`;

        const decodeTexel = shader.fragmentShader.includes("mapTexelToLinear")
          ? "sampledDiffuseColor = mapTexelToLinear(sampledDiffuseColor);"
          : "";

        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `
          #ifdef USE_MAP
            vec2 stepA = vec2(0.86, 0.50) * uOpticalBlur;
            vec2 stepB = vec2(-0.50, 0.86) * uOpticalBlur;

            vec4 sampledDiffuseColor =
              texture2D(map, vMapUv) * 0.24 +
              texture2D(map, vMapUv + stepA) * 0.12 +
              texture2D(map, vMapUv - stepA) * 0.12 +
              texture2D(map, vMapUv + stepB) * 0.12 +
              texture2D(map, vMapUv - stepB) * 0.12 +
              texture2D(map, vMapUv + stepA * 1.95) * 0.07 +
              texture2D(map, vMapUv - stepA * 1.95) * 0.07 +
              texture2D(map, vMapUv + stepB * 1.95) * 0.07 +
              texture2D(map, vMapUv - stepB * 1.95) * 0.07;

            ${decodeTexel}
            diffuseColor *= sampledDiffuseColor;
          #endif
          diffuseColor.a *= uOpticalAlpha;
          `
        );
      };

      material.needsUpdate = true;
      data.opticalUniforms = uniforms;
    }

    const fadeMaterials = new Set();
    group.traverse((node) => {
      const list = Array.isArray(node.material) ? node.material : [node.material];
      list.filter(Boolean).forEach((entry) => {
        if (!entry.userData) entry.userData = {};
        if (entry.userData.__baseTransparent === undefined) {
          entry.userData.__baseTransparent = Boolean(entry === data.coverMaterial || entry.transparent);
          entry.userData.__baseOpacity = typeof entry.opacity === "number" ? entry.opacity : 1;
        }
        fadeMaterials.add(entry);
      });
    });

    data.opticalFadeMaterials = Array.from(fadeMaterials);
  }

  updateFolioOptics(card, reveal, motionBlur, presence = 1, explicitFarBlur = null) {
    const data = card?.group?.userData;
    if (!data) return;

    const transitionAlpha = this.lensFade?.value ?? 1;
    const normalizedPresence = clamp(presence, 0, 1);
    const alpha = clamp(
      reveal * normalizedPresence * transitionAlpha,
      0,
      1
    );

    const isOpaqueNow = alpha >= 0.994;
    const shouldWriteDepth = isOpaqueNow || alpha > 0.78;

    if (data.opticalUniforms) {
      const farBlur = explicitFarBlur !== null
        ? clamp(explicitFarBlur, 0, 1)
        : 1 - reveal;
      const recessBlur = 1 - normalizedPresence;

      const textureBlur = this.settings.highQuality
        ? clamp(
          farBlur * 0.0085 + recessBlur * 0.0082 + motionBlur * 0.0056,
          0,
          0.018
        )
        : 0;

      data.opticalUniforms.uOpticalBlur.value = textureBlur;
      data.opticalUniforms.uOpticalAlpha.value = isOpaqueNow ? 1 : alpha;
    }

    if (data.posterMaterial) {
      const easelMix = this.lensMode === "highscore" ? 0 : clamp(this.easelBlend?.value ?? 0, 0, 1);
      const qualityBoost = clamp(0.94 + easelMix * 0.045 + (card.quality?.value || 0) * 0.08, 0.94, 1.0);
      const brightness = qualityBoost * (0.74 + normalizedPresence * 0.26);
      data.posterMaterial.color.setScalar(brightness);
    }

    data.opticalFadeMaterials?.forEach((material) => {
      if (material === data.coverMaterial) {
        material.transparent = true;
        material.depthWrite = false;
        material.opacity = (data.coverBaseOpacity ?? 0.045) * alpha;
        return;
      }

      const nativelyTransparent = Boolean(material.userData?.__baseTransparent);
      const baseOp = material.userData?.__baseOpacity ?? 1;

      if (nativelyTransparent) {
        material.transparent = true;
        material.opacity = baseOp * alpha;
        return;
      }

      const needTransparent = !isOpaqueNow;
      if (Boolean(material.transparent) !== needTransparent) {
        material.transparent = needTransparent;
        material.needsUpdate = true;
      }
      material.depthWrite = shouldWriteDepth;
      material.opacity = isOpaqueNow ? 1 : alpha;
    });

    card.group.visible = alpha > 0.012;
  }

  createSinglePoolCard(lane, slotRow) {
    const item = this.laneItem(lane, slotRow);
    const card = {
      lane,
      slotRow,
      logicalRow: slotRow,
      item,
      itemId: itemId(item),
      renderKey: this.cardRenderKey(lane, slotRow, item),
      group: buildCelFolio(item, { slotType: item.slotType, modelStyle: this.getModelStyle() }),
      lift: spring(0),
      angle: spring(0),
      quality: spring(0),
      hover: spring(0),
      valley: BASE_VALLEY.clone(),
      targetValley: BASE_VALLEY.clone()
    };

    this.installFolioOptics(card.group);
    this.cards.push(card);
    this.archiveGroup.add(card.group);
    this.loadCover(card);
    return card;
  }

  compileSceneShaders() {
    if (this.shadersCompiled || !this.renderer || !this.scene || !this.camera) return;
    try {
      if (typeof this.renderer.compile === "function") {
        this.renderer.compile(this.scene, this.camera);
      }
      this.shadersCompiled = true;
    } catch (_) {
      this.shadersCompiled = true;
    }
  }

  updateBootTelemetryUI(progressOverride = null) {
    const total = this.hydrationTotal || POOL_ROWS * this.laneCount || 68;
    const done = Math.min(total, this.hydrationDone || this.cards.length || 0);
    const ratio =
      progressOverride !== null
        ? clamp(progressOverride, 0.03, 1)
        : total > 0
        ? clamp(done / total, 0.03, 1)
        : 1;

    if (this.bootRuleElement) {
      this.bootRuleElement.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
    if (this.bootTelemetryElement) {
      const doneStr = String(done).padStart(2, "0");
      const totalStr = String(total).padStart(2, "0");
      this.bootTelemetryElement.textContent =
        done >= total && this.shadersCompiled
          ? `OPTICAL STAGE READY · ${totalStr} / ${totalStr} CEL FOLIOS`
          : `HYDRATING CEL FOLIOS · ${doneStr} / ${totalStr}`;
    }
  }

  stepHydration = () => {
    this.hydrationRafId = null;
    if (this.isDestroyed) return;

    const sliceStart = performance.now();
    const budgetMs = 6.5;
    let processedInSlice = 0;

    while (this.hydrationQueue.length > 0) {
      const slot = this.hydrationQueue.shift();
      this.createSinglePoolCard(slot.lane, slot.slotRow);
      this.hydrationDone += 1;
      processedInSlice += 1;

      if (
        processedInSlice >= 3 &&
        (processedInSlice >= 8 || performance.now() - sliceStart >= budgetMs)
      ) {
        break;
      }
    }

    this.updateBootTelemetryUI();
    this.wake();

    if (this.hydrationQueue.length > 0) {
      this.hydrationRafId = requestAnimationFrame(this.stepHydration);
    } else {
      this.hydrationComplete = true;
      this.remapPool(true, false);
      this.compileSceneShaders();
      this.selectCurrent(false);
      this.updateBootTelemetryUI(1);
      this.wake();
    }
  };

  flushHydrationNow() {
    if (this.hydrationRafId) {
      cancelAnimationFrame(this.hydrationRafId);
      this.hydrationRafId = null;
    }
    while (this.hydrationQueue && this.hydrationQueue.length > 0) {
      const slot = this.hydrationQueue.shift();
      this.createSinglePoolCard(slot.lane, slot.slotRow);
      this.hydrationDone += 1;
    }
    if (!this.hydrationComplete) {
      this.hydrationComplete = true;
      this.remapPool(true, false);
      this.compileSceneShaders();
      this.updateBootTelemetryUI(1);
    }
  }

  buildPool(options = {}) {
    const asyncHydrate = Boolean(options && options.asyncHydrate);
    if (this.hydrationRafId) {
      cancelAnimationFrame(this.hydrationRafId);
      this.hydrationRafId = null;
    }

    this.cards.forEach((card) => {
      card.group?.parent?.remove(card.group);
      this.disposeObject(card.group);
    });
    this.cards = [];
    this.shadersCompiled = false;

    const slots = [];
    for (let slotRow = -HALF_ROWS; slotRow <= HALF_ROWS; slotRow += 1) {
      for (let lane = 0; lane < this.laneCount; lane += 1) {
        slots.push({ lane, slotRow });
      }
    }
    // 按离中心焦点的距离由近及远排序，确保第 0 帧优先建档中心焦点槽位
    slots.sort((a, b) => Math.abs(a.slotRow) - Math.abs(b.slotRow) || a.lane - b.lane);

    this.hydrationQueue = slots;
    this.hydrationTotal = slots.length;
    this.hydrationDone = 0;
    this.hydrationComplete = false;

    if (!asyncHydrate) {
      this.flushHydrationNow();
      return;
    }

    // 第 0 帧仅同步构建中心焦点的前 4 个槽位（耗时 < 2ms），其余 64 个封套交由 rAF 分帧流式建档
    const initialSyncCount = Math.min(this.laneCount, this.hydrationQueue.length);
    for (let i = 0; i < initialSyncCount; i += 1) {
      const slot = this.hydrationQueue.shift();
      this.createSinglePoolCard(slot.lane, slot.slotRow);
      this.hydrationDone += 1;
    }

    this.updateBootTelemetryUI();
    if (this.hydrationQueue.length > 0) {
      this.hydrationRafId = requestAnimationFrame(this.stepHydration);
    } else {
      this.flushHydrationNow();
    }
  }

  rebuildPoolAndLines() {
    this.flushHydrationNow();
    const prevCount = this.cards.length ? Math.round(this.cards.length / POOL_ROWS) : 0;
    this.makeLanes();
    this.syncLaneSprings(true);
    this.buildSignposts();
    this.addRegistrationLines();
    if (prevCount !== this.laneCount) {
      this.buildPool({ asyncHydrate: false });
    } else {
      this.remapPool(true, true);
    }
    this.hoveredCard = null;
    this.hoveredSignpost = null;
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
      card.group = buildCelFolio(item, { slotType: item.slotType, modelStyle: this.getModelStyle() });
      this.archiveGroup.add(card.group);
    } else {
      updateCelFolio(card.group, item, { slotType: item.slotType });
    }
    this.installFolioOptics(card.group);
    this.loadCover(card);
  }

  remapPool(force = false, forceVisual = false) {
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
        const center = this.getLanePoolCenter(card.lane);
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
      const center = this.getLanePoolCenter(card.lane);

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
    const center = this.getLanePoolCenter(card.lane);
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

    const activeLaneRail = this.laneRails?.[this.focusLane];
    if (activeLaneRail) {
      if (targetRail - activeLaneRail.value > maxLagDist) {
        activeLaneRail.value = targetRail - maxLagDist;
      } else if (activeLaneRail.value - targetRail > maxLagDist) {
        activeLaneRail.value = targetRail + maxLagDist;
      }
    }

    const centerKey =
      this.lensMode === "highscore"
        ? String(Math.round(this.rail.value / ROW_SPACING))
        : (this.laneRails || []).map((_, i) => this.getLanePoolCenter(i)).join(",");
    this.lastPoolCenter = centerKey;
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
      texture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
      this.textureCache.set(url, texture);
      apply(texture);
    });
  }

  mapClientToViewportLocal(clientX, clientY) {
    if (!this.viewport) return null;
    const r = this.viewport.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (this.isVirtualLandscape) {
      // 90° clockwise CSS rotation: local +X maps to screen +Y, local +Y maps to screen -X
      return {
        x: clientY - r.top,
        y: r.right - clientX,
        width: r.height,
        height: r.width
      };
    }
    return {
      x: clientX - r.left,
      y: clientY - r.top,
      width: r.width,
      height: r.height
    };
  }

  mapClientDeltaToLocal(dx, dy) {
    if (this.isVirtualLandscape) {
      return { dx: dy, dy: -dx };
    }
    return { dx, dy };
  }

  syncMobileOrientationLayout() {
    if (!this.root || this.isDestroyed) return;
    const vw = window.innerWidth || document.documentElement?.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement?.clientHeight || 640;
    const isPhysicalPortrait = vh > vw;
    const shouldVirtualLandscape =
      Boolean(this.isMobileDevice) &&
      isPhysicalPortrait &&
      !this.userPortraitOverride &&
      !this.keyboardPausedLandscape;

    this.isVirtualLandscape = shouldVirtualLandscape;
    this.root.classList.toggle("is-mobile-3d", Boolean(this.isMobileDevice));
    this.root.classList.toggle("is-virtual-landscape", shouldVirtualLandscape);
    this.root.classList.toggle("is-mobile-portrait", Boolean(this.isMobileDevice) && !shouldVirtualLandscape);
    this.root.dataset.virtualLandscape = shouldVirtualLandscape ? "true" : "false";

    if (shouldVirtualLandscape) {
      this.root.style.position = "fixed";
      this.root.style.left = "50%";
      this.root.style.top = "50%";
      this.root.style.width = `${vh}px`;
      this.root.style.height = `${vw}px`;
      this.root.style.minHeight = "0px";
      this.root.style.transform = "translate(-50%, -50%) rotate(90deg)";
      this.root.style.transformOrigin = "center center";
    } else {
      this.root.style.position = "";
      this.root.style.left = "";
      this.root.style.top = "";
      this.root.style.width = "";
      this.root.style.height = "";
      this.root.style.minHeight = this.isMobileDevice ? "0px" : "";
      this.root.style.transform = "";
      this.root.style.transformOrigin = "";
    }

    if (this.orientButton) {
      if (!isPhysicalPortrait) {
        this.orientButton.style.display = "none";
      } else {
        this.orientButton.style.display = "";
        this.orientButton.textContent = shouldVirtualLandscape ? "↻ 切竖屏" : "↻ 切横屏";
        this.orientButton.title = shouldVirtualLandscape
          ? "临时切换为竖屏浏览"
          : "切换为全屏横屏观展";
      }
    }

    if (this.camera && this.renderer) {
      this.resize();
    }
    if (this.activeViewer && typeof this.activeViewer.onResize === "function") {
      this.activeViewer.onResize();
    }
  }

  toggleMobileOrientation() {
    if (!this.isMobileDevice) return;
    this.userPortraitOverride = !this.userPortraitOverride;
    this.keyboardPausedLandscape = false;
    this.syncMobileOrientationLayout();
    this.audio.cue("tick");
    this.wake();
  }

  handleResize() {
    this.syncMobileOrientationLayout();
    this.wake();
  }

  bindEvents() {
    this.updatePointer = (e) => {
      const pt = this.mapClientToViewportLocal(e.clientX, e.clientY);
      if (!pt || !pt.width || !pt.height) return false;
      this.pointer.x = (pt.x / pt.width) * 2 - 1;
      this.pointer.y = -(pt.y / pt.height) * 2 + 1;
      return true;
    };

    this.onPointerMove = (event) => {
      if (!this.updatePointer(event)) return;

      if (this.pointerDown && this.spaceState === "detail" && this.detailFolio) {
        const mapped = this.mapClientDeltaToLocal(
          event.clientX - this.dragStartX,
          event.clientY - (this.dragStartY ?? event.clientY)
        );
        if (Math.abs(mapped.dx) > 2) {
          this.dragStartX = event.clientX;
          this.dragStartY = event.clientY;
          this.dragVelocity = mapped.dx * 0.0065;
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
      this.hoveredSignpost = null;
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

      if (this.spaceState === "detail" && (this.pointerMoved || totalMoved >= 8)) {
        this.targetDetailAngle = clamp(this.targetDetailAngle + this.dragVelocity * 0.14, -0.85, 0.85);
      } else if (!this.pointerMoved && totalMoved < (event.pointerType === "touch" ? 11 : 6)) {
        const nowTs = performance.now();
        if (!this._lastTapHandledAt || nowTs - this._lastTapHandledAt > 260) {
          this._lastTapHandledAt = nowTs;
          this.handleClick(event);
        }
      }

      this.wake();
    };

    // 移动端与触控屏手势引擎：支持单指上下拨动原画架、左右横滑切换轨道、详情态旋转封套、双指捏合进出详情与轻点聚焦
    this._touchGesture = null;
    this.onTouchStart = (event) => {
      if (
        event.target?.closest?.(
          ".atelier-note-sheet, .atelier-detail, .atelier-modal, .atelier-viewer, .atelier-top > *, .atelier-bottom > *, .atelier-sample-banner, .atelier-curation-banner"
        )
      ) {
        this._touchGesture = null;
        return;
      }
      const touches = event.touches;
      if (!touches || touches.length === 0) return;

      if (touches.length >= 2) {
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        this._touchGesture = {
          mode: "pinch",
          startDist: Math.max(10, Math.hypot(dx, dy)),
          pinchTriggered: false,
          swiped: true
        };
        this.pointerMoved = true;
        return;
      }

      const t = touches[0];
      this._touchGesture = {
        mode: "pan",
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        accumX: 0,
        accumY: 0,
        swiped: false
      };
      this.wake();
    };

    this.onTouchMove = (event) => {
      const g = this._touchGesture;
      if (!g) return;
      const touches = event.touches;
      if (!touches || touches.length === 0) return;

      if (touches.length >= 2) {
        if (event.cancelable) event.preventDefault();
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        if (g.mode !== "pinch") {
          g.mode = "pinch";
          g.startDist = Math.max(10, dist);
          g.pinchTriggered = false;
        }
        g.swiped = true;
        this.pointerMoved = true;
        if (!g.pinchTriggered && g.startDist > 0) {
          const ratio = dist / g.startDist;
          if (ratio > 1.22 && this.spaceState === "array") {
            g.pinchTriggered = true;
            this.enterDetail();
          } else if (ratio < 0.8 && (this.spaceState === "detail" || this.spaceState === "entering-detail")) {
            g.pinchTriggered = true;
            this.leaveDetail();
          }
        }
        return;
      }

      const t = touches[0];
      const totalDist = Math.hypot(t.clientX - g.startX, t.clientY - g.startY);
      if (totalDist >= 11) {
        g.swiped = true;
        this.pointerMoved = true;
      }

      if (this.spaceState === "detail" && this.detailFolio) {
        if (event.cancelable) event.preventDefault();
        const mapped = this.mapClientDeltaToLocal(t.clientX - g.lastX, t.clientY - g.lastY);
        g.lastX = t.clientX;
        g.lastY = t.clientY;
        if (Math.abs(mapped.dx) > 1.5) {
          this.dragVelocity = mapped.dx * 0.007;
          this.targetDetailAngle = clamp(this.targetDetailAngle + this.dragVelocity, -0.85, 0.85);
          this.wake();
        }
        return;
      }

      if (this.spaceState === "boot") {
        this.finishBoot();
      }

      if (this.spaceState === "array") {
        if (event.cancelable) event.preventDefault();
        const mapped = this.mapClientDeltaToLocal(t.clientX - g.lastX, t.clientY - g.lastY);
        const dx = mapped.dx;
        const dy = mapped.dy;
        g.lastX = t.clientX;
        g.lastY = t.clientY;
        g.accumX += dx;
        g.accumY += dy;

        if (Math.abs(dy) >= Math.abs(dx) * 0.75) {
          this.rail.velocity = clamp(this.rail.velocity - dy * 0.068, -7.5, 7.5);
          if (this.laneRails?.[this.focusLane]) {
            this.laneRails[this.focusLane].velocity = clamp(
              this.laneRails[this.focusLane].velocity - dy * 0.068,
              -7.5,
              7.5
            );
          }
          this.wake();
        }

        if (Math.abs(g.accumY) >= 36 && Math.abs(g.accumY) >= Math.abs(g.accumX) * 0.8) {
          const rowStep = g.accumY < 0 ? 1 : -1;
          g.accumY -= g.accumY < 0 ? -36 : 36;
          g.accumX *= 0.25;
          this.move(0, rowStep);
        } else if (Math.abs(g.accumX) >= 64 && Math.abs(g.accumX) > Math.abs(g.accumY) * 1.2) {
          const laneStep = g.accumX < 0 ? 1 : -1;
          g.accumX = 0;
          g.accumY *= 0.25;
          this.move(laneStep, 0);
        }
      }
    };

    this.onTouchEnd = (event) => {
      const g = this._touchGesture;
      if (!g) return;
      if (event.touches && event.touches.length > 0) return;
      this._touchGesture = null;

      if (!g.swiped && g.mode === "pan") {
        const changed = event.changedTouches && event.changedTouches[0];
        if (changed) {
          const nowTs = performance.now();
          if (!this._lastTapHandledAt || nowTs - this._lastTapHandledAt > 260) {
            this._lastTapHandledAt = nowTs;
            this.handleClick({
              clientX: changed.clientX,
              clientY: changed.clientY,
              target: event.target
            });
          }
        }
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
      if (this.isMobileDevice) {
        this.syncMobileOrientationLayout();
      } else {
        this.resize();
      }
      this.wake();
    };

    this.viewport.addEventListener("pointermove", this.onPointerMove);
    this.viewport.addEventListener("pointerleave", this.onPointerLeave);
    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    this.viewport.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.viewport.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.viewport.addEventListener("touchend", this.onTouchEnd, { passive: true });
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.container);
  }

  updateHover() {
    if (this.spaceState !== "array") {
      this.hoveredCard = null;
      this.hoveredSignpost = null;
      this.viewport.style.cursor = "default";
      this.hoverElement?.classList.remove("is-visible");
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.lensMode === "status" && this.signpostGroup?.visible && this.signposts?.length) {
      const spHit = this.raycaster.intersectObjects(
        this.signposts.map((s) => s.group),
        true
      )[0];
      const sp = spHit ? this.signpostFromObject(spHit.object) : null;
      if (sp) {
        this.hoveredSignpost = sp;
        this.hoveredCard = null;
        this.viewport.style.cursor = "pointer";
        const count = (this.lanes[sp.lane] || []).length;
        this.hoverElement.textContent =
          `▶ 点击切换至此轨道 ｜ ${this.laneNames[sp.lane] || `轨道 0${sp.lane + 1}`} · 共 ${count} 部`;
        this.hoverElement.classList.add("is-visible");
        return;
      }
    }
    this.hoveredSignpost = null;

    const visibleAnimeGroups = this.cards
      .filter(
        (c) =>
          c.group.visible &&
          c.item.slotType === "anime" &&
          (this.lensMode !== "highscore" || c.lane === this.focusLane)
      )
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

      if (this.lensMode === "status" && this.signpostGroup?.visible && this.signposts?.length) {
        const spHit = this.raycaster.intersectObjects(
          this.signposts.map((s) => s.group),
          true
        )[0];
        const sp = spHit ? this.signpostFromObject(spHit.object) : null;
        if (sp) {
          this.focusTrackBySignpost(sp.lane, diag);
          return;
        }
      }

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
        .filter(
          (card) =>
            card.group.visible &&
            card.item.slotType === "anime" &&
            (this.lensMode !== "highscore" || card.lane === this.focusLane)
        )
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

    if (this.lensMode === "status" && this.signpostGroup?.visible && this.signposts?.length) {
      const spHit = this.raycaster.intersectObjects(
        this.signposts.map((s) => s.group),
        true
      )[0];
      const sp = spHit ? this.signpostFromObject(spHit.object) : null;
      if (sp) {
        this.focusTrackBySignpost(sp.lane, diag);
        return;
      }
    }

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

    if (this.lensMode === "highscore" && card.lane !== this.focusLane) {
      if (diag) {
        diag.hitType = "recessed-lane-card";
        diag.actionTaken = `switch-curation-lane:${card.lane}`;
      }
      this.focusLane = card.lane;
      this.focusRow = this.laneSelections[card.lane] || 0;
      this.ensureFocusRowInPoolWindow();
      this.selectCurrent(true);
      this.audio.cue("tick");
      this.wake();
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
    this.syncRailToActiveLane();
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
      sharedSourceGroup: sourceCard?.group,
      modelStyle: this.getModelStyle()
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
    this.installFolioOptics(group);

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
      texture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
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
    if (!this.hydrationComplete) this.flushHydrationNow();
    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();

      this.focusLane = wrap(this.focusLane + laneDelta, this.laneCount);
      this.focusRow = laneDelta
        ? this.calcNavRow(this.focusLane, this.laneSelections[this.focusLane] || 0, 0)
        : this.calcNavRow(this.focusLane, this.focusRow, rowDelta);

      this.laneSelections[this.focusLane] = this.focusRow;
      if (laneDelta) this.syncRailToActiveLane();
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
    if (laneDelta) this.syncRailToActiveLane();

    if (Math.abs(this.focusRow) > 2048) this.rebaseCoordinates();

    this.ensureFocusRowInPoolWindow();
    this.selectCurrent(true);
    this.audio.cue("tick");
    this.wake();
  }

  rebaseCoordinates() {
    const lane = this.focusLane;
    const shift = Math.trunc(this.focusRow / 1024) * 1024;
    if (!shift) return;

    this.focusRow -= shift;
    this.rail.value -= shift * ROW_SPACING;
    if (this.laneRails?.[lane]) this.laneRails[lane].value -= shift * ROW_SPACING;
    if (this.laneRidgeRows?.[lane]) this.laneRidgeRows[lane].value -= shift;
    this.laneSelections[lane] = (this.laneSelections[lane] || 0) - shift;
    this.cards.forEach((card) => {
      if (card.lane === lane) card.logicalRow -= shift;
    });
    if (this.detailFolio && this.detailFolio.lane === lane) this.detailFolio.logicalRow -= shift;
    this.outgoingCards.forEach((entry) => {
      if (entry.lane === lane) entry.logicalRow -= shift;
    });
    this.pulses.forEach((pulse) => {
      if (pulse.lane === lane) pulse.row -= shift;
    });
  }

  enterDetail() {
    if (!this.hydrationComplete) this.flushHydrationNow();
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

    // 提取 # 观片手记与评价 或 # 个人总结 段落，以及结构化观片手札列表
    const summaryIdx = body.search(/^#\s*(?:观片手记与评价|个人总结)/m);
    let userNotesRaw = "";
    if (summaryIdx >= 0) {
      userNotesRaw = body.slice(summaryIdx).replace(/^#\s*(?:观片手记与评价|个人总结)\s*/m, "");
    }

    const structuredReviews = rawMarkdown
      ? parseNoteReviewsSection(rawMarkdown)
      : Array.isArray(item?.reviews)
      ? item.reviews
      : [];

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
      userParagraphs: cleanedParagraphs,
      reviews: structuredReviews
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
      `原画手稿页 · BGM-${String(item.subjectId || "000").slice(-3).padStart(3, "0")}`
    );
    this.el(headerLeft, "div", "atelier-note-sheet-title", `《${item.name || "未命名档案"}》`);
    this.el(headerLeft, "div", "atelier-meta", item.japaneseName || `${item.year || ""} ${item.season || ""}`);

    const headerRight = this.el(header, "div", "atelier-row");
    this.action(
      headerRight,
      "open-review-studio-sheet",
      "观片手札工作台",
      () => {
        reviewStudioService.openAnimeReviewStudioModal(this.plugin, item, {
          onUpdated: () => {
            this.renderNoteSheet(item);
          }
        });
      },
      "atelier-text-action"
    );
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

      // 01 作品信息与观看进度
      const sec1 = this.el(body, "section", "atelier-note-section");
      this.el(sec1, "h3", "", "01 · 作品详情与观看记录 / CATALOGUE RECORD");
      const kvGrid = this.el(sec1, "div", "atelier-note-kv-grid");

      const rawBgm = Number(item.preciseScore ?? item.publicScore ?? item.bangumiScore);
      const bgmStr = Number.isFinite(rawBgm) && rawBgm > 0 ? rawBgm.toFixed(1) : "未记录";
      const rawUserBgm = Number(item.bangumiScore);
      const userBgmStr = Number.isFinite(rawUserBgm) && rawUserBgm > 0 ? rawUserBgm.toFixed(1) : "未评分";
      const personalStr = item.personalScore == null ? "未评分" : Number(item.personalScore).toFixed(1);

      const basePairs = [
        ["观看状态", item.state || "未设置"],
        ["观看进度", `${Number(item.watchedEpisodes) || 0} / ${item.totalEpisodes || "?"} 话`],
        ["个人评分", personalStr],
        ["你在 BGM 上的评分", userBgmStr],
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

      // 02 观片手记与评价（支持结构化手札气泡、时间戳播放器空降与一键复制）
      const sec2 = this.el(body, "section", "atelier-note-section");
      this.el(sec2, "h3", "", "02 · 观片手记与评价 / PERSONAL MANUSCRIPT");
      if (Array.isArray(parsed.reviews) && parsed.reviews.length > 0) {
        parsed.reviews.forEach((rv) => {
          const bubble = this.el(sec2, "div", "atelier-note-paragraph");
          bubble.style.padding = "8px 10px";
          bubble.style.marginBottom = "8px";
          bubble.style.borderRadius = "7px";
          bubble.style.borderLeft = rv.isPlaceholder ? "3px solid #c67420" : "3px solid #8f683d";
          bubble.style.background = "rgba(143, 104, 61, 0.08)";

          const metaRow = this.el(bubble, "div", "atelier-row");
          metaRow.style.justifyContent = "space-between";
          metaRow.style.marginBottom = "4px";
          const headText = `【${rv.scope || "全剧"}${rv.timestamp ? " · " + rv.timestamp : ""} · ${
            rv.isPlaceholder ? "待补完锚点" : rv.typeLabel || rv.type || "吐槽"
          }】`;
          const badgeBtn = this.el(metaRow, "button", "atelier-text-action", rv.timestamp || rv.episode ? `▶ ${headText}` : headText);
          badgeBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (rv.timestamp || rv.episode) {
              await reviewStudioService.launchVideoAtEpisodeAndTimestamp(this.plugin, item, {
                episode: rv.episode || Number(item.watchedEpisodes) || 1,
                timestamp: rv.timestamp || ""
              });
            }
          };

          const copyBtn = this.el(metaRow, "button", "atelier-text-action", "复制");
          copyBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const txt = reviewStudioService.formatSingleReviewCopyText(rv, false);
            if (txt && navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(txt);
            }
          };

          this.el(
            bubble,
            "div",
            "",
            rv.isPlaceholder
              ? "已打下看番时间点占位锚点，点击上方「观片手札工作台」可补齐正文感想。"
              : rv.text || (rv.images?.length ? `[附 ${rv.images.length} 张截图]` : "")
          );
        });
      } else if (parsed.userParagraphs.length > 0) {
        parsed.userParagraphs.forEach((para) => {
          this.el(sec2, "p", "atelier-note-paragraph", para);
        });
      } else {
        this.el(
          sec2,
          "p",
          "atelier-note-paragraph",
          `当前笔记《${item.name}》尚未填写观片手札或长评。您可点击右上角「观片手札工作台」随时记录单集吐槽、打下时间点占位或粘贴截图。`
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
      this.isMobileDevice ? "← 返回档案阵列" : "← 返回档案阵列 [ESC]",
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
    const pref3d = multiSiteRatingService.getPreferredDisplayRating(this.plugin, item);
    const rawBgm = Number(item.preciseScore ?? item.publicScore ?? item.bangumiScore);
    const bgm = Number.isFinite(rawBgm) && rawBgm > 0 ? rawBgm.toFixed(1) : "未记录";
    const prefLabel =
      pref3d && pref3d.rawScore !== null && pref3d.sourceId !== "bangumi"
        ? `${pref3d.siteLabel} ${pref3d.compactNumber}`
        : `BGM 评分 ${bgm}`;
    const rawUserBgm = Number(item.bangumiScore);
    const userBgmPart = Number.isFinite(rawUserBgm) && rawUserBgm > 0 ? ` ／ 你在 BGM 的评分 ${rawUserBgm.toFixed(1)}` : "";
    const scoreLine = this.el(scoreCell, "div", "atelier-data-value", `个人 ${personal}${userBgmPart} ／ ${prefLabel}`);
    if (pref3d && pref3d.tooltip) scoreLine.title = pref3d.tooltip;

    const ruler = this.el(scoreCell, "div", "atelier-score-ruler");
    for (let score = 1; score <= 10; score += 1) {
      const button = this.el(ruler, "button", "atelier-score-pip", String(score));
      if (Math.round(Number(item.personalScore)) === score) button.classList.add("is-active");

      button.onclick = async () => {
        if (item.isSamplePreviewItem) {
          item.personalScore = score;
          this.audio.cue("confirm");
          new Notice("示例样片预览：已临时体验打分（收录真实动画后将自动保存至本地笔记）");
          this.renderDetail(item);
          return;
        }
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
      const increment = this.isVirtualLandscape
        ? (event.clientY > rect.top + rect.height / 2 ? 1 : -1)
        : (event.clientX > rect.left + rect.width / 2 ? 1 : -1);
      const next = Math.max(0, Number(item.watchedEpisodes || 0) + increment);

      if (item.isSamplePreviewItem) {
        item.watchedEpisodes = next;
        drawProgress();
        this.audio.cue("confirm");
        new Notice("示例样片预览：已临时体验追番进度更新");
        return;
      }

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
        if (item.isSamplePreviewItem) {
          item.state = state;
          this.audio.cue("confirm");
          new Notice(`示例样片预览：已临时切换为「${state}」`);
          this.renderDetail(item);
          return;
        }
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
      if (isDesktopNodeAvailable() && item.downloadPath && item.downloadPath !== "无") {
        localInfo = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
      }
    } catch (error) {
      localInfo = null;
    }

    const primary = this.el(
      actions,
      "button",
      "atelier-primary-action",
      item.isSamplePreviewItem
        ? "退出示例并收录真实动画"
        : localInfo?.nextEpisodeFile
          ? `▶ 播放第 ${localInfo.nextEpisodeNumber || Number(item.watchedEpisodes || 0) + 1} 话`
          : "打开动画笔记 ↗"
    );

    primary.onclick = async () => {
      if (item.isSamplePreviewItem) {
        setSamplePreviewActive(this.plugin, false);
        if (typeof this.onExit3D === "function") this.onExit3D();
        return;
      }
      if (localInfo?.nextEpisodeFile) {
        const nextEp = localInfo.nextEpisodeNumber || Number(item.watchedEpisodes || 0) + 1;
        await reviewStudioService.launchVideoAtEpisodeAndTimestamp(this.plugin, item, {
          episode: nextEp,
          timestamp: ""
        });
      } else if (item.file?.path) {
        const targetPath = item.file.path;
        if (this.isMobileDevice && typeof this.onExit3D === "function") {
          this.onExit3D();
        }
        this.app?.workspace?.openLinkText(targetPath, "", false);
      }
    };

    const reviewCount = Array.isArray(item.reviews) ? item.reviews.length : 0;
    const reviewBtn = this.el(
      actions,
      "button",
      "atelier-text-action",
      reviewCount > 0 ? `观片手札 (${reviewCount})` : "观片手札"
    );
    reviewBtn.dataset.ui = "open-reviews-studio";
    reviewBtn.onclick = () => {
      if (item.isSamplePreviewItem) {
        this.openNoteSheet();
        return;
      }
      reviewStudioService.openAnimeReviewStudioModal(this.plugin, item, {
        onUpdated: () => {
          this.renderDetail(item);
          if (this.noteSheetState === "open" || this.noteSheetState === "extracting") {
            this.renderNoteSheet(item);
          }
        }
      });
    };

    const viewer = this.el(actions, "button", "atelier-text-action", "360° 装帧预览 ↗");
    viewer.onclick = () => {
      this.activeViewer = new ModelViewer(this, item);
      this.activeViewer.open();
    };

    if (isDesktopNodeAvailable() && !item.isSamplePreviewItem && item.downloadPath && item.downloadPath !== "无") {
      const folder = this.el(actions, "button", "atelier-text-action", "打开本地目录 ↗");
      folder.onclick = () => openLocalPathSafely(item.downloadPath);
    }
  }

  updateToolbar() {
    if (this.lensButton) {
      const isHigh = this.lensMode === "highscore";
      this.lensButton.textContent = this.isMobileDevice
        ? (isHigh ? "◫ 收藏轨" : "✦ 高分")
        : (isHigh ? "◫ 状态与收藏轨" : "✦ 高分精选");
      this.lensButton.dataset.lensMode = this.lensMode;
      this.lensButton.classList.toggle("is-active", isHigh);
    }

    if (this.corridorSubBtn) {
      this.corridorSubBtn.classList.toggle("is-active", this.statusSubView !== "easel");
    }
    if (this.easelSubBtn) {
      this.easelSubBtn.classList.toggle("is-active", this.statusSubView === "easel");
    }

    if (this.brandSubElement) {
      const subLabel = this.statusSubView === "easel" ? "折屏展架" : "开架回廊";
      this.brandSubElement.textContent =
        this.lensMode === "highscore"
          ? `高分精选展陈 · 馆藏 ${this.items.length} 部`
          : `${subLabel} · 馆藏 ${this.items.length} 部 · 分栏 ${this.laneCount} 组`;
    }

    const active = Boolean(this.settings.audio && this.audio.context?.state === "running");

    this.audioButton.textContent = this.isMobileDevice
      ? (active ? "● ♪ 音景" : "♪ 静音")
      : (active
        ? "● ♪ 环境音景 · 播放中"
        : this.settings.audio
          ? "◐ ♪ 环境音景 · 点击唤醒"
          : "♪ 环境音景 · 已静音");

    this.audioButton.dataset.audioState = active ? "on" : "off";
    this.audioButton.classList.toggle("is-active", active);
  }

  toggleLensMode() {
    if (this.lensTransition) return;

    if (this.spaceState === "detail" || this.spaceState === "entering-detail") {
      this.closeNoteSheet(true);
      this.queueDetailOutgoing();
      this.spaceState = "array";
      this.root.dataset.spaceState = "array";
      this.detailElement.classList.remove("is-visible");
    }

    this.lensTransition = {
      phase: "conceal",
      targetMode: this.lensMode === "highscore" ? "status" : "highscore"
    };

    this.audio.cue("tick");
    this.wake();
  }

  updateLensTransition(dt) {
    const transition = this.lensTransition;
    if (!transition) return;

    const reduced = this.settings.reducedMotion;
    const rate = reduced ? 35 : 6.8;

    if (transition.phase === "conceal") {
      damp(this.lensFade, 0, rate, dt);

      if (this.lensFade.value < 0.025) {
        this.lensMode = transition.targetMode;
        this.root.dataset.lensMode = this.lensMode;

        this.focusLane = 0;
        this.focusRow = 0;
        this.rail.value = 0;
        this.rail.velocity = 0;
        this.ridgeRow.value = 0;
        this.ridgeRow.velocity = 0;
        this.ridgeLane.value = 0;
        this.ridgeLane.velocity = 0;

        this.rebuildPoolAndLines();
        this.updateToolbar();

        transition.phase = "reveal";
      }

      return;
    }

    damp(this.lensFade, 1, rate, dt);

    if (this.lensFade.value > 0.995) {
      this.lensFade.value = 1;
      this.lensFade.velocity = 0;
      this.lensTransition = null;
    }
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
    if (this.isMobileDevice) {
      this.keyboardPausedLandscape = true;
      this.syncMobileOrientationLayout();
    }

    this.modal = this.el(this.root, "section", "atelier-modal");
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.closeModal();
    };
    const panel = this.el(this.modal, "div", "atelier-modal-panel");

    const headerRow = this.el(panel, "div", "atelier-row");
    headerRow.style.justifyContent = "space-between";
    this.el(headerRow, "h2", "", "空间设置与分栏管理");
    this.action(headerRow, "close-settings", this.isMobileDevice ? "✕ 关闭" : "关闭设置 [ESC]", () => this.closeModal());

    // 实体档案装帧风格 & 双风格精装模型扩展包管理卡片（首帧同步渲染防闪白，随后异步校验磁盘状态）
    const packBox = this.el(panel, "div", "atelier-pack-section");
    packBox.dataset.ui = "atelier-hd-pack-section";
    const drawPackSectionDom = (status) => {
      if (this.isDestroyed || !packBox.isConnected) return;
      packBox.empty();

      const head = this.el(packBox, "div", "atelier-pack-header");
      const headLeft = this.el(head, "div", "");
      this.el(headLeft, "div", "atelier-pack-title", "实体档案装帧风格 · 典藏精装模型扩展包");
      this.el(
        headLeft,
        "div",
        "atelier-pack-sub",
        "支持内置轻量原画夹与两款 Blender 精雕装帧外观实时热切换；扩展包按需下载，不增加插件主包体积。"
      );

      const headRight = this.el(head, "div", "atelier-pack-actions");
      const badge = this.el(
        headRight,
        "span",
        `atelier-pack-badge${status.installed ? " is-installed" : ""}`,
        status.installed ? `✓ 扩展包已就绪 (${status.sizeLabel})` : `未下载扩展包 (${status.sizeLabel})`
      );
      badge.dataset.packInstalled = String(status.installed);

      if (!status.installed) {
        const dlBtn = this.action(
          headRight,
          "download-hd-pack",
          "⬇ 一键下载精装扩展包",
          async () => {
            dlBtn.disabled = true;
            dlBtn.textContent = "下载中…";
            try {
              await downloadAtelierHdPack(this.plugin, {
                onProgress: ({ step, total }) => {
                  dlBtn.textContent = `下载中 (${step}/${total})…`;
                }
              });
              if (!this.plugin.settings.atelier3DModelStyle || this.plugin.settings.atelier3DModelStyle === "standard") {
                this.plugin.settings.atelier3DModelStyle = "hd_cel_folio";
                await this.plugin.saveSettings();
              }
              this.rebuildAllFolioModels();
              this.audio.cue("confirm");
              await renderPackSection();
            } catch (err) {
              new Notice(`扩展包下载失败：${err?.message || "请检查网络后重试"}`);
              dlBtn.disabled = false;
              dlBtn.textContent = "⬇ 重试下载扩展包";
            }
          },
          "atelier-primary-action"
        );
      } else {
        this.action(
          headRight,
          "remove-hd-pack",
          "清理扩展包缓存",
          async () => {
            await removeAtelierHdPack(this.plugin);
            this.rebuildAllFolioModels();
            await renderPackSection();
          },
          "atelier-text-action"
        );
      }

      const styleGrid = this.el(packBox, "div", "atelier-style-picker-grid");
      const currentStyle = this.getModelStyle();

      STYLE_CATALOG.forEach((entry) => {
        const isLocked = entry.requiresPack && !status.installed;
        const isActive = currentStyle === entry.id;
        const cardBtn = this.el(
          styleGrid,
          "button",
          `atelier-style-card${isActive ? " is-active" : ""}${isLocked ? " is-locked" : ""}`
        );
        cardBtn.dataset.styleId = entry.id;

        const cHead = this.el(cardBtn, "div", "atelier-style-card-head");
        this.el(cHead, "span", "", entry.shortLabel);
        this.el(
          cHead,
          "span",
          "atelier-style-card-tag",
          isActive ? "当前使用" : isLocked ? "需扩展包" : entry.requiresPack ? "精装扩展" : "内置"
        );
        this.el(cardBtn, "div", "atelier-style-card-desc", entry.desc);

        cardBtn.onclick = async () => {
          if (isLocked) {
            try {
              cardBtn.disabled = true;
              await downloadAtelierHdPack(this.plugin);
              this.plugin.settings.atelier3DModelStyle = entry.id;
              await this.plugin.saveSettings();
              await preloadAtelierHdPrototypes(this.plugin);
              this.rebuildAllFolioModels();
              this.audio.cue("confirm");
              await renderPackSection();
            } catch (err) {
              cardBtn.disabled = false;
              new Notice(`扩展包下载失败：${err?.message || "网络超时"}`);
            }
            return;
          }
          if (this.plugin.settings.atelier3DModelStyle === entry.id && this.getModelStyle() === entry.id) {
            return;
          }
          this.plugin.settings.atelier3DModelStyle = entry.id;
          await this.plugin.saveSettings();
          if (entry.requiresPack) {
            await preloadAtelierHdPrototypes(this.plugin);
          }
          this.rebuildAllFolioModels();
          this.audio.cue("confirm");
          await renderPackSection();
        };
      });
    };

    const initialPackInstalled = Boolean(
      this._cachedPackStatus?.installed ||
      (getCachedAtelierPrototype("hd_cel_folio") && getCachedAtelierPrototype("hd_collector_box"))
    );
    drawPackSectionDom(
      this._cachedPackStatus || {
        installed: initialPackInstalled,
        sizeLabel: initialPackInstalled ? "427 KB" : "约 428 KB"
      }
    );

    const renderPackSection = async () => {
      if (this.isDestroyed || !packBox.isConnected) return;
      const status = await checkAtelierHdPackStatus(this.plugin);
      this._cachedPackStatus = status;
      drawPackSectionDom(status);
    };
    renderPackSection().catch(() => {});

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
        this.lensFade = spring(1);
        this.lensTransition = null;
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
          ["bgmDesc", "BGM 评分 ↓"],
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
    if (this.isMobileDevice && this.keyboardPausedLandscape) {
      this.keyboardPausedLandscape = false;
      this.syncMobileOrientationLayout();
    }
    this.wake();
  }

  openSearch() {
    if (this.modal) this.closeModal();
    if (this.isMobileDevice) {
      this.keyboardPausedLandscape = true;
      this.syncMobileOrientationLayout();
    }

    this.modal = this.el(this.root, "section", "atelier-modal");
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.closeModal();
    };
    const panel = this.el(this.modal, "div", "atelier-modal-panel");

    const headerRow = this.el(panel, "div", "atelier-row");
    headerRow.style.justifyContent = "space-between";
    this.el(headerRow, "h2", "", "档案检索 / ARCHIVE SEARCH");
    this.action(headerRow, "close-search", this.isMobileDevice ? "✕ 关闭" : "关闭检索 [ESC]", () => this.closeModal());

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
            if (this.laneRails?.[this.focusLane]) {
              this.laneRails[this.focusLane].value = this.focusRow * ROW_SPACING;
              this.laneRails[this.focusLane].velocity = 0;
            }
            if (this.laneRidgeRows?.[this.focusLane]) {
              this.laneRidgeRows[this.focusLane].value = this.focusRow;
              this.laneRidgeRows[this.focusLane].velocity = 0;
            }
            this.syncLaneSprings(false);

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
    this.bootRuleElement = null;
    this.bootTelemetryElement = null;
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
    if (this.archiveGroup && !this.settings.reducedMotion) {
      this.archiveGroup.position.z = this.bootMode === "full" ? -14 : -11.5;
    }

    this.bootElement = this.el(this.root, "section", "atelier-boot");

    const center = this.el(this.bootElement, "div", "boot-center");
    const pegBar = this.el(center, "div", "boot-pegbar");
    this.el(pegBar, "span", "boot-peg-hole");
    this.el(pegBar, "span", "boot-peg-slot");
    this.el(pegBar, "span", "boot-peg-hole");

    const ruleTrack = this.el(center, "div", "boot-rule-track");
    this.bootRuleElement = this.el(ruleTrack, "div", "boot-rule");

    this.el(
      center,
      "div",
      "boot-title",
      this.bootMode === "full"
        ? `3D 原画展厅 · 已收录动画 ${this.items.length} 部`
        : "3D 原画展厅 · 展陈就绪"
    );

    const totalSlots = this.hydrationTotal || POOL_ROWS * this.laneCount || 68;
    const initDone = this.hydrationComplete ? totalSlots : this.hydrationDone || 0;
    this.bootTelemetryElement = this.el(
      center,
      "div",
      "boot-telemetry",
      `HYDRATING CEL FOLIOS · ${String(initDone).padStart(2, "0")} / ${String(totalSlots).padStart(2, "0")}`
    );

    const skip = this.action(
      this.bootElement,
      "skip-boot",
      "跳过序幕 ↗",
      () => this.finishBoot()
    );

    skip.className = "atelier-btn boot-skip";
    this.wake();
  }

  finishBoot() {
    if (this.bootDone) return;

    this.flushHydrationNow();
    this.bootDone = true;
    this.spaceState = "array";
    this.root.dataset.spaceState = "array";
    if (this.bootRuleElement) {
      this.bootRuleElement.style.transform = "scaleX(1)";
    }
    this.bootElement?.classList.add("is-hidden");

    this.ui.style.transition = "opacity .48s cubic-bezier(.22,1,.36,1)";
    this.ui.style.opacity = "1";
    this.ui.style.pointerEvents = "none";

    if (this.settings.reducedMotion) {
      this.archiveGroup.position.z = 0;
    } else if (Math.abs(this.archiveGroup.position.z) < 1.2) {
      // 确保揭幕瞬间三维封套阵列始终带有优雅的景深推进阻尼收束感
      this.archiveGroup.position.z = -4.8;
    }

    this.schedule(() => {
      this.bootElement?.remove();
      this.bootElement = null;
      this.bootRuleElement = null;
      this.bootTelemetryElement = null;
      this.ui.style.transition = "opacity .45s ease";
      this.ui.style.opacity = "1";
      this.ui.style.pointerEvents = "none";
      this.selectCurrent(true);
      this.wake();
    }, 560, this.bootTimers);

    this.wake();
  }

  updateBoot(now) {
    if (this.spaceState !== "boot" || !this.archiveGroup) return;

    const elapsed = (now - this.bootStartedAt) / 1000;
    const full = this.bootMode === "full";
    const duration = full ? 3.2 : 1.35;

    const total = this.hydrationTotal || POOL_ROWS * this.laneCount || 68;
    const done = this.hydrationComplete ? total : this.hydrationDone || this.cards.length || 0;
    const hydrationProgress = total > 0 ? clamp(done / total, 0.04, 1) : 1;
    const timeProgress = clamp(elapsed / Math.max(0.45, duration * 0.82), 0.04, 1);
    const combinedProgress = this.hydrationComplete
      ? Math.max(hydrationProgress * 0.65, timeProgress)
      : Math.min(0.94, hydrationProgress * 0.85 + timeProgress * 0.15);

    if (this.bootRuleElement) {
      this.bootRuleElement.style.transform = `scaleX(${combinedProgress.toFixed(4)})`;
    }
    if (this.bootTelemetryElement) {
      const displayCount = this.hydrationComplete
        ? Math.min(total, Math.max(done, Math.round(combinedProgress * total)))
        : done;
      const doneStr = String(displayCount).padStart(2, "0");
      const totalStr = String(total).padStart(2, "0");
      this.bootTelemetryElement.textContent =
        combinedProgress >= 0.99 && this.hydrationComplete
          ? `OPTICAL STAGE READY · ${totalStr} / ${totalStr} CEL FOLIOS`
          : `HYDRATING CEL FOLIOS · ${doneStr} / ${totalStr}`;
    }

    if (full) {
      if (elapsed < 0.7) {
        this.archiveGroup.position.z = -14;
      } else if (elapsed < 2.6) {
        this.archiveGroup.position.z = -14 * (1 - smooth((elapsed - 0.7) / 1.9));
      } else {
        this.archiveGroup.position.z = 0;
      }
    } else if (elapsed < 0.25) {
      this.archiveGroup.position.z = -11.5;
    } else if (elapsed < 1.25) {
      this.archiveGroup.position.z = -11.5 * (1 - smooth((elapsed - 0.25) / 1.0));
    } else {
      this.archiveGroup.position.z = 0;
    }

    if (this.hydrationComplete && elapsed >= duration) {
      this.finishBoot();
    }
  }

  getSlotTargetPose(entry) {
    const card = entry?.sourceCard;

    if (card && card.group) {
      return {
        position: card.group.position,
        scale: card.group.scale.x || 1,
        rotationY: card.group.rotation.y,
        tiltX: card.group.userData?.folioTiltGroup?.rotation?.x ?? -0.2,
        quality: card.quality.value,
        valley: card.valley
      };
    }

    const lane = entry?.lane ?? 0;
    const logicalRow = entry?.logicalRow ?? 0;
    const item = entry?.item || this.laneItem(lane, logicalRow);
    const isFocused = lane === this.focusLane && logicalRow === this.focusRow;

    if (this.lensMode === "highscore") {
      const laneWeight = this.getHighscoreLaneFocusWeight(lane);
      const x = this.getHighscoreLaneX(lane);
      const y =
        this.getScoreRidgeElevation(item) +
        (1 - laneWeight) * -1.05 +
        (isFocused ? 0.24 : 0);

      const z = this.getHighscoreCardZ(logicalRow);

      return {
        position: new THREE.Vector3(x, y, z),
        scale: 0.82 + laneWeight * 0.18,
        rotationY: 0,
        tiltX: -0.2 + this.getScoreTiltOffset(item),
        quality: isFocused ? 0.46 : this.getScoreNormalized(item) * 0.12,
        valley: BASE_VALLEY
      };
    }

    const pose = this.computeStatusCardPose(lane, logicalRow, item, {
      liftVal: isFocused ? 0.62 : 0
    });

    return {
      position: new THREE.Vector3(pose.x, pose.y, pose.z),
      scale: pose.scale,
      rotationY: pose.rotationY,
      tiltX: pose.tiltX,
      quality: isFocused ? 0.35 : 0,
      valley: BASE_VALLEY
    };
  }

  updateCards(dt) {
    const reduced = this.settings.reducedMotion || this.motion.transition === false;
    const rate = reduced ? 35 : 5.4;
    const laneRate = reduced ? 35 : 5.8;

    damp(this.easelBlend, this.statusSubView === "easel" ? 1 : 0, laneRate, dt);
    damp(this.rail, this.focusRow * ROW_SPACING, reduced ? 35 : 4.8, dt);
    damp(this.ridgeRow, this.focusRow, reduced ? 35 : 5.5, dt);
    damp(this.ridgeLane, this.focusLane, laneRate, dt);

    for (let l = 0; l < this.laneCount; l += 1) {
      if (this.laneFocusSprings[l]) {
        damp(this.laneFocusSprings[l], l === this.focusLane ? 1 : 0, laneRate, dt);
      }
      if (this.laneXSprings[l]) {
        damp(this.laneXSprings[l], this.computeTargetLaneX(l, this.focusLane), laneRate, dt);
      }
      const laneTargetRow = l === this.focusLane ? this.focusRow : (this.laneSelections[l] || 0);
      if (this.laneRails[l]) {
        damp(this.laneRails[l], laneTargetRow * ROW_SPACING, reduced ? 35 : 4.8, dt);
      }
      if (this.laneRidgeRows[l]) {
        damp(this.laneRidgeRows[l], laneTargetRow, reduced ? 35 : 5.5, dt);
      }
    }

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

    const centerKey =
      this.lensMode === "highscore"
        ? String(Math.round(this.rail.value / ROW_SPACING))
        : (this.laneRails || []).map((_, i) => this.getLanePoolCenter(i)).join(",");

    if (
      this.hydrationComplete &&
      (this.lastPoolCenter === undefined || centerKey !== this.lastPoolCenter)
    ) {
      this.lastPoolCenter = centerKey;
      this.remapPool(false, false);
    }

    this.updateSignposts(dt);

    this.paletteColor.lerp(this.targetPalette, clamp(dt * 3.5, 0, 1));

    const isHighscore = this.lensMode === "highscore";
    const visibleRow = this.rail.value / ROW_SPACING;
    const railSpeed = clamp(
      Math.abs(this.rail.velocity) / ROW_SPACING,
      0,
      1.6
    );

    this.cards.forEach((card) => {
      const blank = card.item.slotType === "blank";
      const divider = card.item.slotType === "divider";
      const active = card === this.selectedCard;

      const laneWeight = isHighscore
        ? this.getHighscoreLaneFocusWeight(card.lane)
        : 1;

      const scoreNorm = isHighscore
        ? this.getScoreNormalized(card.item)
        : 0;

      const scoreElevation = isHighscore
        ? this.getScoreRidgeElevation(card.item)
        : 0;

      const scoreTiltX = isHighscore
        ? this.getScoreTiltOffset(card.item)
        : 0;

      let ripple = 0;
      let colorWeight = active ? 0.55 : 0.1;

      if (!isHighscore) {
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
          colorWeight = Math.max(
            colorWeight,
            clamp(Math.abs(packet) * 1.4, 0, 0.65)
          );
        });
      } else {
        colorWeight = active ? 0.56 : 0.1 + scoreNorm * 0.16;
      }

      const targetHover =
        this.spaceState === "array" && card === this.hoveredCard
          ? (isHighscore ? 0.14 : 0.24)
          : 0;

      damp(card.hover, targetHover, reduced ? 35 : 9, dt);

      if (isHighscore) {
        damp(card.lift, active ? 0.24 : 0, rate, dt);
        damp(
          card.quality,
          active ? 0.46 : scoreNorm * 0.12,
          rate,
          dt
        );
        damp(card.angle, 0, rate, dt);
      } else if (!active) {
        damp(card.lift, 0, rate, dt);
        damp(card.quality, 0, rate, dt);
        damp(card.angle, 0, rate, dt);
      } else {
        damp(card.lift, 0.62, rate, dt);
        damp(card.quality, 0.35, rate, dt);
        damp(card.angle, 0, rate, dt);
      }

      const baseValleyColor =
        isHighscore && scoreNorm > 0.45
          ? CURATED_PEAK_VALLEY
          : BASE_VALLEY;

      card.targetValley.copy(baseValleyColor).lerp(
        this.paletteColor,
        clamp(colorWeight, 0, 0.8)
      );

      card.valley.lerp(
        card.targetValley,
        clamp(dt * 4.5, 0, 1)
      );

      let x;
      let y;
      let z;
      let targetScale;

      if (isHighscore) {
        const rowDistance = Math.abs(card.logicalRow - visibleRow);
        const isCurrentLane = laneWeight > 0.86;

        x = this.getHighscoreLaneX(card.lane);

        const recessY = (1 - laneWeight) * -1.05;

        y = scoreElevation + recessY + card.lift.value + card.hover.value;

        z = this.getHighscoreCardZ(card.logicalRow);

        targetScale = 0.82 + laneWeight * 0.18;

        // 高分模式在屏幕可视边缘（第 1.4 行至第 3.65 行）呈现平滑渐隐，且从第 0.35 行起即开始产生可见景深柔焦
        const visibleReveal = smooth(
          clamp((3.65 - rowDistance) / 2.25, 0, 1)
        );
        const farBlur = smooth(
          clamp((rowDistance - 0.35) / 2.35, 0, 1)
        );

        const motionBlur = reduced
          ? 0
          : clamp(railSpeed * 0.58, 0, 1);

        const presence = isCurrentLane ? 1 : laneWeight;

        card.group.position.set(x, y, z);
        card.group.scale.setScalar(targetScale);
        card.group.userData.folioTiltGroup.rotation.x = -0.2 + scoreTiltX;
        card.group.rotation.y = 0;

        this.applyAppearance(
          card.group,
          card.quality.value,
          card.valley,
          card
        );

        this.updateFolioOptics(
          card,
          visibleReveal,
          motionBlur,
          presence,
          farBlur
        );
      } else {
        const pose = this.computeStatusCardPose(card.lane, card.logicalRow, card.item, {
          liftVal: card.lift.value,
          hoverVal: card.hover.value,
          ripple,
          angleVal: card.angle.value
        });

        card.group.position.set(pose.x, pose.y, pose.z);
        card.group.scale.setScalar(pose.scale);
        card.group.userData.folioTiltGroup.rotation.x = pose.tiltX;
        card.group.rotation.y = pose.rotationY;

        this.applyAppearance(
          card.group,
          card.quality.value,
          card.valley,
          card
        );

        const laneRailVel = this.laneRails?.[card.lane]?.velocity ?? this.rail.velocity;
        const laneRailSpeed = clamp(Math.abs(laneRailVel) / ROW_SPACING, 0, 1.6);
        const motionBlur = reduced
          ? 0
          : clamp(laneRailSpeed * 0.48, 0, 1);

        this.updateFolioOptics(
          card,
          pose.reveal,
          motionBlur,
          pose.presence,
          pose.farBlur
        );
      }

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
          (
            card.item.slotType === "anime" &&
            card.itemId === entry.itemId &&
            card.lane === entry.lane &&
            card.logicalRow === entry.logicalRow
          )
      );

      if (hiddenByActiveDetail || hiddenByOutgoing) {
        card.group.visible = false;
      }
    });

    this.pulses = this.pulses.filter(
      (pulse) => this.clock - pulse.time < 2.6
    );
  }

  updateDetailAndOutgoing(dt) {
    const reduced = this.settings.reducedMotion || this.motion.transition === false;
    this.updateDetailFolio(dt, reduced);
    this.updateOutgoing(dt, reduced);
  }

  updateRecorder(dt) {
    // 预留记录员帧同步钩子
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
      sourceCard.group.scale.setScalar(slotPose.scale ?? 1);
      sourceCard.group.rotation.y = slotPose.rotationY ?? 0;
      if (sourceCard.group.userData?.folioTiltGroup) {
        sourceCard.group.userData.folioTiltGroup.rotation.x = slotPose.tiltX;
      }
      this.applyAppearance(sourceCard.group, sourceCard.quality.value, sourceCard.valley, sourceCard);
      this.updateFolioOptics(sourceCard, 1, 0);
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

      if (this.detailProgress.value > 0.46) {
        this.detailElement.classList.add("is-visible");
      }

      if (detail.lift.value > INSPECTION_LIFT - 0.28 && this.detailProgress.value > 0.78) {
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
    const liftRatio = clamp(detail.lift.value / INSPECTION_LIFT, 0, 1);
    detail.group.scale.setScalar(THREE.MathUtils.lerp(slotPose.scale ?? 1, 1, liftRatio));
    detail.group.rotation.y = THREE.MathUtils.lerp(slotPose.rotationY ?? 0, detail.angle.value, liftRatio);
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
            sourceCard.group.scale.setScalar(slotPose.scale ?? 1);
            sourceCard.group.rotation.y = slotPose.rotationY ?? 0;
            if (sourceCard.group.userData?.folioTiltGroup) {
              sourceCard.group.userData.folioTiltGroup.rotation.x = slotPose.tiltX;
            }
            this.applyAppearance(sourceCard.group, sourceCard.quality.value, sourceCard.valley, sourceCard);
            this.updateFolioOptics(sourceCard, 1, 0);
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
      const liftRatio = clamp(outgoing.lift.value / INSPECTION_LIFT, 0, 1);
      outgoing.group.scale.setScalar(THREE.MathUtils.lerp(slotPose.scale ?? 1, 1, liftRatio));
      outgoing.group.rotation.y = THREE.MathUtils.lerp(slotPose.rotationY ?? 0, outgoing.angle.value, liftRatio);
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

  applyAppearance(group, quality, valley, card = null) {
    const data = group.userData;
    if (!data) return;

    const easelMix = this.lensMode === "highscore" ? 0 : clamp(this.easelBlend?.value ?? 0, 0, 1);

    // 赛璐珞清漆护膜保持极低透明度，折屏正面光线下进一步收敛反光，杜绝海报泛白发灰
    if (data.cover?.material) {
      const baseCoverOpacity = 0.045 * (1 - clamp(quality, 0, 1)) * (1 - easelMix * 0.65);
      data.coverBaseOpacity = baseCoverOpacity;
      data.cover.material.opacity = baseCoverOpacity;
    }

    // 阵列态保持清晰显色，折屏正面陈列与详情态提升至通透明度
    if (data.poster?.material) {
      const basePosterScalar = 0.94 + easelMix * 0.04;
      data.poster.material.color.setScalar(clamp(basePosterScalar + quality * 0.08, 0.94, 1.0));
    }

    if (data.substrate?.material) {
      data.substrate.material.color.copy(valley);
    }
    if (data.valleyMaterial?.color) {
      data.valleyMaterial.color.copy(valley);
    }

    const isHigh = this.lensMode === "highscore";
    if (this.registrationLines?.material?.color) {
      this.registrationLines.material.color.setHex(isHigh ? 0xb59663 : 0xc6beb2);
      this.registrationLines.userData.baseOpacity = isHigh ? 0.32 : 0.22;
    }
    const scoreNorm = isHigh && card ? this.getScoreNormalized(card.item) : 0;
    const frameTint = isHigh ? (scoreNorm >= 0.65 ? "#c88d28" : "#c9963b") : "#d5a85b";
    const brassMix = isHigh ? clamp(0.5 + scoreNorm * 0.28, 0.48, 0.78) : 0.48;
    if (data.modelStyle !== "hd_collector_box" && data.frameMaterial?.color) {
      data.frameMaterial.color.copy(valley).lerp(new THREE.Color(frameTint), brassMix);
    }
    data.frame?.children?.forEach((part) => {
      if (data.modelStyle !== "hd_collector_box" && part.material?.color) {
        part.material.color.copy(valley).lerp(new THREE.Color(frameTint), brassMix);
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

    const isHighscore = this.lensMode === "highscore";
    const stageShot = isHighscore
      ? this.getHighscoreCameraShot()
      : this.getStatusCameraShot();

    const aim = stageShot.aim.clone();
    const position = stageShot.position.clone();

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

    // 与 laneXSprings / laneFocusSprings / easelBlend 共享完全一致的单级阻尼速率 (5.8)，彻底消除双重阻尼相位差引起的回弹抽搐
    const rate = this.settings.reducedMotion
      ? 35
      : this.spaceState === "leaving-detail"
        ? 8.4
        : 5.8;

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

    // 随相机推拉动态贴紧近裁剪面（[4.5, 52]），适配回廊与折屏展架距离并保持最高浮点 Z-Buffer 深度分辨率
    const camDistToAim = Math.hypot(
      this.camera.position.x - this.cameraAim.x.value,
      this.camera.position.y - this.cameraAim.y.value,
      this.camera.position.z - this.cameraAim.z.value
    );
    const idealNear = clamp(camDistToAim - 38, 4.5, 52);
    if (Math.abs(this.camera.near - idealNear) > 0.6) {
      this.camera.near = idealNear;
      this.camera.updateProjectionMatrix();
    }

    // 连续平滑插值雾效距离，彻底消除阶跃白闪并兼顾开架回廊与折屏展架的远距通透度
    const p = clamp(this.detailProgress.value, 0, 1);

    if (isHighscore) {
      this.scene.fog.near = THREE.MathUtils.lerp(44, 56, p);
      this.scene.fog.far = THREE.MathUtils.lerp(92, 128, p);
    } else {
      const easelMix = clamp(this.easelBlend?.value ?? 0, 0, 1);
      const baseNear = THREE.MathUtils.lerp(72, 142, easelMix);
      const baseFar = THREE.MathUtils.lerp(148, 236, easelMix);
      this.scene.fog.near = THREE.MathUtils.lerp(baseNear, 58, p);
      this.scene.fog.far = THREE.MathUtils.lerp(baseFar, 134, p);
    }
  }

  hasMotion() {
    if (this.lensTransition) return true;
    if (this.lensFade && Math.abs(this.lensFade.velocity) > 0.001) return true;
    if (!this.settings.reducedMotion && this.registrationLines?.visible) return true;
    if (!this.hydrationComplete) return true;
    if (this.spaceState === "boot" || this.spaceState === "entering-detail" || this.spaceState === "leaving-detail") return true;
    if (this.noteSheetState === "extracting" || this.noteSheetState === "retracting") return true;
    if (this.outgoingCards.length || this.pulses.length || this.pointerDown) return true;
    if (Math.abs(this.archiveGroup.position.z) > 0.001) return true;

    const stageShot =
      this.lensMode === "highscore"
        ? this.getHighscoreCameraShot()
        : this.getStatusCameraShot();
    const targetCam = stageShot.position;
    const targetAim = stageShot.aim;

    if (
      this.spaceState === "array" &&
      (
        Math.abs(this.cameraPosition.x.value - targetCam.x) > 0.01 ||
        Math.abs(this.cameraPosition.y.value - targetCam.y) > 0.01 ||
        Math.abs(this.cameraPosition.z.value - targetCam.z) > 0.01 ||
        Math.abs(this.cameraAim.x.value - targetAim.x) > 0.01 ||
        Math.abs(this.cameraAim.y.value - targetAim.y) > 0.01 ||
        Math.abs(this.cameraAim.z.value - targetAim.z) > 0.01
      )
    ) {
      return true;
    }

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
      this.easelBlend,
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
      this.cameraPosition.z,
      ...(this.laneFocusSprings || []),
      ...(this.laneXSprings || []),
      ...(this.laneRails || []),
      ...(this.laneRidgeRows || [])
    ].filter(Boolean);

    return states.some((state) => Math.abs(state.velocity) > 0.001) ||
      (this.signposts || []).some((s) => Math.abs(s.hover.velocity) > 0.001) ||
      this.cards.some((card) =>
        Math.abs(card.lift.velocity) > 0.001 ||
        Math.abs(card.angle.velocity) > 0.001 ||
        Math.abs(card.hover.velocity) > 0.001 ||
        Math.abs(card.quality.velocity) > 0.001
      );
  }

  tick = (time) => {
    if (this.isDestroyed || this.webglUnavailable || !this.renderer || !this.camera || document.hidden) {
      this.rafId = null;
      return;
    }

    const now = Number(time) || performance.now();
    const dt = clamp((now - this.lastFrame) / 1000, 0.001, 0.05);

    this.lastFrame = now;
    this.clock += dt;

    this.updateBoot(now);
    this.updateLensTransition(dt);
    this.updateCards(dt);
    this.updateDetailAndOutgoing(dt);
    this.updateRecorder(dt);
    this.updateCamera(dt);
    this.updateRegistrationLines();
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
    if (this.isDestroyed || this.webglUnavailable || !this.renderer || this.rafId) return;
    this.sleepAt = 0;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stopLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.hydrationRafId) cancelAnimationFrame(this.hydrationRafId);
    this.hydrationRafId = null;
  }

  resize() {
    if (this.webglUnavailable || !this.camera || !this.renderer) return;
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
      if (
        node.geometry &&
        !node.geometry.userData?.sharedPrototype &&
        !geometries.has(node.geometry)
      ) {
        geometries.add(node.geometry);
        node.geometry.dispose();
      }

      const list = Array.isArray(node.material) ? node.material : [node.material];

      list.filter(Boolean).forEach((material) => {
        if (!materials.has(material)) {
          materials.add(material);
          if (
            material.map &&
            !material.map.userData?.sharedPrototype &&
            !this.isSharedTexture(material.map)
          ) {
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
    this.viewport.removeEventListener("touchstart", this.onTouchStart);
    this.viewport.removeEventListener("touchmove", this.onTouchMove);
    this.viewport.removeEventListener("touchend", this.onTouchEnd);
    this.viewport.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("bangumi-3d-mobile-active");
    }

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
    this.space.stopLoop();
    this.root = this.space.el(this.space.root, "section", "atelier-viewer");
    const host = this.space.el(this.root, "div", "atelier-viewer-canvas");
    const header = this.space.el(this.root, "div", "atelier-viewer-ui");

    this.space.el(header, "div", "atelier-mark", `360° 装帧预览 ／ 《${this.item.name || "未命名档案"}》`);
    this.space.action(header, "close-viewer", "关闭预览", () => this.close());

    const tools = this.space.el(this.root, "div", "atelier-viewer-tools");
    this.space.action(tools, "explode", "＋ 拆解装帧", () => { this.targetExplode = 1; });
    this.space.action(tools, "rebuild", "− 一键重组", () => { this.targetExplode = 0; });

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.root.clientWidth || 800, this.root.clientHeight || 600);
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1.5, 1.5, 28);
    this.camDist = 7.4;
    this.tiltX = 0;
    this.camera.position.set(0, 0.04, this.camDist);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d1c5, 2.15));

    const light = new THREE.DirectionalLight(0xffffff, 2.45);
    light.position.set(4, 5, 6);
    this.scene.add(light);

    this.model = buildCelFolio(this.item, {
      modelStyle: this.space.getModelStyle()
    });
    if (this.model.userData?.folioTiltGroup) {
      this.model.userData.folioTiltGroup.rotation.x = -0.05;
    }
    this.space.loadDetailCover({ item: this.item, group: this.model });

    this.model.userData.parts.forEach((part) => {
      part.userData.baseZ = part.position.z;
    });

    this.scene.add(this.model);

    this.activePointers = new Map();
    this.lastPinchDist = 0;

    this.onDown = (event) => {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activePointers.size === 2) {
        this.dragging = false;
        const pts = Array.from(this.activePointers.values());
        this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        return;
      }
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    };

    this.onMove = (event) => {
      if (this.activePointers.has(event.pointerId)) {
        this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.lastPinchDist > 8) {
          const delta = (this.lastPinchDist - dist) * 0.022;
          this.camDist = clamp(this.camDist + delta, 4.2, 11.5);
          this.camera.position.z = this.camDist;
        }
        this.lastPinchDist = dist;
        return;
      }
      if (!this.dragging) return;
      const mapped = typeof this.space?.mapClientDeltaToLocal === "function"
        ? this.space.mapClientDeltaToLocal(
            event.clientX - this.lastX,
            event.clientY - (this.lastY ?? event.clientY)
          )
        : {
            dx: event.clientX - this.lastX,
            dy: event.clientY - (this.lastY ?? event.clientY)
          };
      this.angle += mapped.dx * 0.008;
      this.tiltX = clamp(this.tiltX + mapped.dy * 0.004, -0.45, 0.45);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    };

    this.onUp = (event) => {
      if (event && event.pointerId !== undefined) {
        this.activePointers.delete(event.pointerId);
      } else {
        this.activePointers.clear();
      }
      if (this.activePointers.size < 2) {
        this.lastPinchDist = 0;
      }
      if (this.activePointers.size === 0) {
        this.dragging = false;
      }
    };

    this.onWheel = (event) => {
      event.preventDefault();
      this.camDist = clamp(this.camDist + (event.deltaY > 0 ? 0.5 : -0.5), 4.2, 11.5);
      this.camera.position.z = this.camDist;
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
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("resize", this.onResize);

    this.onResize();
    this.render();
  }

  render = () => {
    if (!this.root) return;
    if (typeof document !== "undefined" && document.hidden) {
      this.rafId = requestAnimationFrame(this.render);
      return;
    }

    this.explode += (this.targetExplode - this.explode) * 0.1;
    this.model.rotation.y = this.angle;
    this.model.rotation.x = this.tiltX || 0;

    this.model.userData.parts.forEach((part, index) => {
      const offsets = {
        carrier: -0.68,
        substrate: -0.34,
        "poster-core": 0,
        "cel-frame": 0.36,
        label: 0.56,
        cover: 0.74,
        fasteners: 0.94
      };

      const offset = offsets[part.userData.assemblyPart] ?? (index - 2.5) * 0.3;
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
    this.root.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("resize", this.onResize);

    this.space.disposeObject(this.scene);
    this.renderer.dispose();
    this.root.remove();
    this.root = null;
    if (this.space && !this.space.isDestroyed && (typeof document === "undefined" || !document.hidden)) {
      this.space.wake();
    }

    this.root = null;

    if (this.space.activeViewer === this) {
      this.space.activeViewer = null;
    }
  }
}

module.exports = {
  Dashboard3DSpace
};
