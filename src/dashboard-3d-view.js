/**
 * dashboard-3d-view.js
 * 
 * Bangumi Manager 第六期 3D 全息动画档案空间（第三轮核心重构版）
 * 
 * 核心架构规范：
 * 1. 严格场景三级分组：
 *    - corridorShellGroup: 固定背景空间（深色哑光中轴底座、两侧浅色空间面、远景墙体、细发光灯带），不随档案行滚动。
 *    - archiveWallGroup: 档案墙卡片、嵌入式槽位、导向底座与编号标记，随 railOffset 沿 Z 轴整体运动。
 *    - focusStageGroup: 焦点抽出卡片、三维 Netaba 评分趋势舞台、局部琥珀光源，支持独立打量旋转。
 * 2. 严格 Z 层物理分离与防闪烁体系（背板 -0.08 -> 状态脊 -0.015 -> 四边框 0.025 -> 全幅封面 0.105 -> 保护层 0.155，层间距 >= 0.04）。
 * 3. 海报永远不透明 (transparent: false, depthWrite: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2)。
 * 4. 三层可见策略（前景当前行完整显示、中景相邻行缩小微暗、远景缩小衰减），绝不把海报设为透明。
 * 5. 全独立二阶弹簧系统（damp），相机平滑跟踪与打量阻尼。
 * 6. 顶栏快速模糊搜索、排数/条目计数器、行导航按钮与四向键盘无缝漫游。
 * 7. 克制精准的 Netaba 三维全息评分舞台（细金属框 + 深色亚克力面 + 0x59c7e8 青蓝曲线 + 0xe0ab57 评分基准面）。
 * 8. 真实三档画质分级与 1.5 秒静止休眠 (0 FPS)。
 */

const THREE = require("three");
const netabaTrendService = require("./netaba-trend-service.js");
const { inspectLocalFolder, openLocalPathSafely } = require("./note-utils.js");
const {
  DEFAULT_MOTION_SETTINGS,
  getMotionSettings,
  saveMotionSettings,
  calculateVisibleRowWindow,
  sanitizeTrendData,
  inject3DScopedStyles
} = require("./dashboard-3d-helper.js");

// 卡片与空间物理基准尺寸
const CARD_W = 2.32;
const CARD_H = 3.28;

const FLOOR_Y = -0.12;
const SLOT_BASE_Y = 0.06;
const CARD_BASE_Y = 2.02; // 卡片底端在 2.02 - 1.64 = 0.38，距槽位与地面 >= 0.26，满足 >= 0.15 悬空规范

const COL_SPACING = 3.25;
const ROW_SPACING = 4.55;
const MAX_COLS = 6;
const BASE_Z = -2.0;

// 严格 Z 层中心坐标（层间距严格 >= 0.04）
const Z_BACKPLATE = -0.08;
const Z_SPINE = -0.015;
const Z_FRAME = 0.025;
const Z_POSTER = 0.105;
const Z_GLASS = 0.155;

// 状态色标
const STATUS_COLORS = {
  "在看": 0x31a6ff,
  "已看": 0x4dbd7a,
  "想看": 0xe0aa45,
  "抛弃": 0x9a6972,
  "未设置": 0x7e8793
};

// 二阶弹簧阻尼方程（帧率无关）
function damp(s, target, rate, dt) {
  const delta = s.value - target;
  const impulse = s.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  s.value = target + (delta + impulse * dt) * decay;
  s.velocity = (s.velocity - rate * impulse * dt) * decay;
}

// 高斯钟形函数
function bell(x, width) {
  return Math.exp(-0.5 * Math.pow(x / width, 2));
}

// 闲置低频微幅呼吸波
function idleWave(col, row, time) {
  return (
    0.022 * Math.sin((time * Math.PI * 2) / 6.0 + row * 0.45 - col * 0.55) +
    0.010 * Math.sin((time * Math.PI * 2) / 9.5 - row * 0.35 + col * 0.40)
  );
}

class Dashboard3DSpace {
  constructor(container, plugin, options = {}) {
    this.container = container;
    this.plugin = plugin;
    this.app = plugin?.app;
    this.options = options;
    this.allItems = options.items || [];
    this.currentFilteredItems = []; // 全量筛选结果，绝不 slice 截断
    this.displayedItems = [];
    this.filterMode = options.filterMode || "watching";

    // 注入 scoped 到 .bangumi-3d-root 的样式增强
    if (typeof document !== "undefined") {
      inject3DScopedStyles();
    }

    // 动效独立开关配置
    this.motionSettings = getMotionSettings(this.plugin);

    // 主题模式: "light" (浅色空间) | "dark" (深空暗色)
    this.themeMode = options.themeMode || "light";

    // 性能分级配置: "low" | "medium" | "high"
    this.perfMode = options.perfMode || plugin?.settings?.dashboard3dPerfMode || "medium";

    // 交互状态机: "array" (档案墙阵列漫游态) | "focus" (焦点卡片 + 3D 趋势舞台 + HUD 检视态)
    this.spaceState = "array";

    // 生命周期与循环
    this.isDestroyed = false;
    this.isSleeping = false;
    this.rafId = null;
    this.lastTime = 0;
    this.idleTime = 0;
    this.clock = 0;
    this.interactionAge = 0;
    this.activeTimeouts = new Set();

    // 档案墙滑动控制 (正偏移向前推进，取值范围 [0, (rowCount-1)*ROW_SPACING])
    this.railOffset = { value: 0, velocity: 0 };
    this.targetRailOffset = 0;
    this.cols = 6;
    this.rowCount = 1;

    // 记忆焦点进入前阵列位置（返回阵列时平滑恢复该位置，绝不跳到首行）
    this.savedArrayRailOffset = 0;
    this.savedArrayZoom = 1.0;

    // 焦点选择与卡片打量
    this.selectedIndex = -1;
    this.focusAnim = { value: 0, velocity: 0 };
    this.targetFocusAnim = 0;

    this.cardRotation = { value: 0, velocity: 0 };
    this.targetCardRotation = 0;
    this.cardTilt = { value: 0, velocity: 0 };
    this.targetCardTilt = 0;

    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // 指针悬停微幅视差 (有明确上限，离开平滑归位)
    this.parallaxX = { value: 0, velocity: 0 };
    this.parallaxY = { value: 0, velocity: 0 };
    this.targetParallaxX = 0;
    this.targetParallaxY = 0;

    // 低 FOV (15°) 相机二阶阻尼系统
    this.cameraPosX = { value: -16.8, velocity: 0 };
    this.cameraPosY = { value: 9.6, velocity: 0 };
    this.cameraPosZ = { value: 24.5, velocity: 0 };

    this.cameraAimX = { value: 0, velocity: 0 };
    this.cameraAimY = { value: 1.65, velocity: 0 };
    this.cameraAimZ = { value: -3.2, velocity: 0 };

    this.cameraZoom = { value: 1.0, velocity: 0 };
    this.targetZoom = 1.0;

    // 核心场景分组（规范要求）
    this.corridorShellGroup = new THREE.Group();
    this.archiveWallGroup = new THREE.Group();
    this.focusStageGroup = new THREE.Group();
    this.trendStageGroup = new THREE.Group(); // focusStageGroup 内部的三维趋势舞台

    this.cardMeshes = [];
    this.cardDataMap = new Map();
    this.wavePulses = [];
    this.currentRenderWindow = { startRow: -1, endRow: -1 };

    // 三维 Netaba 评分趋势舞台（递增版本号保护）
    this.trendRequestId = 0;
    this.trendGrow = { value: 0, velocity: 0 };
    this.trendStreamers = [];
    this.trendCurve = null;

    // 性能监测与环境反射贴图
    this.recentDts = [];
    this.currentEnvTexture = null;

    // 纹理缓存
    this.textureCache = new Map();

    // 初始化渲染架构
    this.initDom();
    this.initThree();
    this.filterAndBuildCards();
    this.bindEvents();
    this.onResize();
    this.startLoop();
  }

  safeSetTimeout(fn, ms) {
    if (this.isDestroyed) return null;
    const tid = setTimeout(() => {
      this.activeTimeouts.delete(tid);
      if (!this.isDestroyed) fn();
    }, ms);
    this.activeTimeouts.add(tid);
    return tid;
  }

  // ==========================================
  // DOM 与顶栏控制体系
  // ==========================================
  initDom() {
    if (typeof this.container.empty === "function") {
      this.container.empty();
    } else {
      this.container.innerHTML = "";
    }

    const rootCls = `bangumi-3d-root ${this.themeMode === "dark" ? "theme-dark-space" : ""}`;
    if (typeof this.container.createDiv === "function") {
      this.rootEl = this.container.createDiv({ cls: rootCls });
    } else {
      this.rootEl = document.createElement("div");
      this.rootEl.className = rootCls;
      this.container.appendChild(this.rootEl);
    }

    this.rootEl.style.position = "relative";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    this.rootEl.style.minHeight = "660px";
    this.rootEl.style.overflow = "hidden";
    this.rootEl.style.userSelect = "none";

    // 1. 顶栏控制条
    this.topToolbar = this.createElSafe(this.rootEl, "div", "bangumi-3d-toolbar");

    // 左侧：返回、总览、标牌、筛选下拉、搜索查找与行导航
    const leftSection = this.createElSafe(this.topToolbar, "div", "toolbar-section-left");
    const backBtn = this.createElSafe(leftSection, "button", "bangumi-3d-btn", "🔲 返回 2D 仪表盘");
    backBtn.onclick = () => {
      if (this.onExit3D) this.onExit3D();
    };

    const overviewBtn = this.createElSafe(leftSection, "button", "bangumi-3d-btn", "📋 档案总览");
    overviewBtn.title = "打开全量动画封面索引";
    overviewBtn.onclick = () => this.openOverviewDrawer();

    const titleBadge = this.createElSafe(leftSection, "span", "bangumi-3d-title-badge");
    titleBadge.innerHTML = "BANGUMI ARCHIVE · 3D 动画档案空间";

    const filterSelect = this.createElSafe(leftSection, "select", "bangumi-3d-select");
    const optWatching = this.createElSafe(filterSelect, "option", "", "正在追番");
    optWatching.value = "watching";
    const optAll = this.createElSafe(filterSelect, "option", "", "全部动画");
    optAll.value = "all";
    filterSelect.value = this.filterMode;
    filterSelect.onchange = () => {
      this.filterMode = filterSelect.value;
      this.targetRailOffset = 0;
      this.railOffset.value = 0;
      this.archiveWallGroup.position.z = 0;
      this.trendRequestId++;
      this.filterAndBuildCards();
      this.wakeUp();
    };

    // 快速搜索输入框与模糊匹配候选下拉
    this.initSearchUi(leftSection);

    // 档案墙排导航计数与上下排切换按钮 (正向位移，向摄像机推移)
    this.initRailNavUi(leftSection);

    // 右侧：动效设置、主题切换、性能分级、视角复位
    const rightSection = this.createElSafe(this.topToolbar, "div", "toolbar-section-right");

    const motionBtn = this.createElSafe(rightSection, "button", "bangumi-3d-btn", "✨ 动效");
    motionBtn.title = "设置 3D 动画与视差开关";
    motionBtn.onclick = () => this.toggleMotionSettingsModal();

    this.themeBtn = this.createElSafe(
      rightSection,
      "button",
      "bangumi-3d-btn",
      this.themeMode === "light" ? "☀️ 浅色空间" : "🌙 深空暗色"
    );
    this.themeBtn.onclick = () => this.toggleTheme();

    const perfGroup = this.createElSafe(rightSection, "div", "bangumi-3d-perf-group");
    const perfOptions = [
      { key: "low", label: "节能" },
      { key: "medium", label: "均衡" },
      { key: "high", label: "极致" }
    ];
    this.perfButtons = {};
    for (const opt of perfOptions) {
      const pBtn = this.createElSafe(
        perfGroup,
        "button",
        `bangumi-perf-btn ${this.perfMode === opt.key ? "is-active" : ""}`,
        opt.label
      );
      pBtn.onclick = () => this.setPerformanceMode(opt.key);
      this.perfButtons[opt.key] = pBtn;
    }

    const resetBtn = this.createElSafe(rightSection, "button", "bangumi-3d-btn", "🎯 视角复位");
    resetBtn.onclick = () => this.resetCamera();

    // 2. 视口 Canvas 挂载点
    this.viewportEl = this.createElSafe(this.rootEl, "div", "bangumi-3d-viewport");
    this.viewportEl.style.width = "100%";
    this.viewportEl.style.height = "100%";
    this.viewportEl.style.cursor = "grab";

    // 3. 2D HUD 空间映射层
    this.hudLayer = this.createElSafe(this.rootEl, "div", "bangumi-3d-hud-layer");
    this.hudLayer.style.position = "absolute";
    this.hudLayer.style.inset = "0";
    this.hudLayer.style.pointerEvents = "none";
    this.hudLayer.style.zIndex = "10";

    // 4. 休眠与性能状态指示微标
    this.statusPill = this.createElSafe(this.rootEl, "div", "bangumi-3d-status-pill");
    this.updateStatusPill();
  }

  initSearchUi(parent) {
    const searchWrap = this.createElSafe(parent, "div", "bangumi-3d-search-wrap");
    searchWrap.style.position = "relative";
    searchWrap.style.display = "inline-flex";
    searchWrap.style.alignItems = "center";

    this.searchInput = this.createElSafe(searchWrap, "input", "bangumi-3d-select");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "查找动画";
    this.searchInput.style.width = "130px";
    this.searchInput.style.paddingLeft = "8px";

    // 下拉候选列表 (基于全量 currentFilteredItems，最多 12 条)
    this.searchDrop = this.createElSafe(searchWrap, "div", "bangumi-search-dropdown");
    this.searchDrop.style.position = "absolute";
    this.searchDrop.style.top = "100%";
    this.searchDrop.style.left = "0";
    this.searchDrop.style.width = "240px";
    this.searchDrop.style.maxHeight = "280px";
    this.searchDrop.style.overflowY = "auto";
    this.searchDrop.style.background = "var(--rl-surface, #1e2229)";
    this.searchDrop.style.border = "1px solid var(--rl-border, rgba(255,255,255,0.15))";
    this.searchDrop.style.borderRadius = "4px";
    this.searchDrop.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
    this.searchDrop.style.display = "none";
    this.searchDrop.style.zIndex = "35";
    this.searchDrop.style.marginTop = "4px";

    this.searchInput.oninput = () => {
      const q = (this.searchInput.value || "").trim().toLowerCase();
      if (!q) {
        this.searchDrop.style.display = "none";
        this.searchDrop.innerHTML = "";
        return;
      }

      const matches = [];
      const dataset = this.currentFilteredItems.length > 0 ? this.currentFilteredItems : this.displayedItems;
      for (let i = 0; i < dataset.length; i++) {
        const item = dataset[i];
        const matchName = item.name && item.name.toLowerCase().includes(q);
        const matchJp = item.japaneseName && item.japaneseName.toLowerCase().includes(q);
        const matchId = item.subjectId && String(item.subjectId).includes(q);
        if (matchName || matchJp || matchId) {
          matches.push({ item, index: i });
          if (matches.length >= 12) break;
        }
      }

      this.searchDrop.innerHTML = "";
      if (matches.length === 0) {
        const emptyItem = this.createElSafe(this.searchDrop, "div", "", "无匹配动画");
        emptyItem.style.padding = "6px 10px";
        emptyItem.style.fontSize = "11px";
        emptyItem.style.color = "var(--rl-text-muted, #8a909a)";
        this.searchDrop.style.display = "block";
        return;
      }

      for (const m of matches) {
        const rowItem = this.createElSafe(this.searchDrop, "div", "bangumi-search-item");
        rowItem.style.padding = "6px 10px";
        rowItem.style.fontSize = "12px";
        rowItem.style.cursor = "pointer";
        rowItem.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
        rowItem.style.color = "var(--rl-text, #f0ede6)";
        rowItem.textContent = m.item.name;

        rowItem.onmouseenter = () => {
          rowItem.style.background = "var(--rl-surface-hover, rgba(255,255,255,0.1))";
        };
        rowItem.onmouseleave = () => {
          rowItem.style.background = "transparent";
        };

        rowItem.onclick = () => {
          this.searchInput.value = "";
          this.searchDrop.style.display = "none";
          this.searchDrop.innerHTML = "";

          // 计算目标行并平滑推移整个 archiveWallGroup
          const cardRow = Math.floor(m.index / this.cols);
          const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
          this.targetRailOffset = Math.min(maxRailOffset, Math.max(0, cardRow * ROW_SPACING));
          this.ensureCardsForCurrentView();
          this.wakeUp();
          this.updateNavCountUi();

          this.safeSetTimeout(() => {
            if (!this.isDestroyed) {
              this.selectCard(m.index);
            }
          }, 350);
        };
      }
      this.searchDrop.style.display = "block";
    };

    if (typeof document !== "undefined") {
      this.boundDocPointerDown = (e) => {
        if (!searchWrap.contains(e.target)) {
          this.searchDrop.style.display = "none";
        }
      };
      document.addEventListener("pointerdown", this.boundDocPointerDown);
    }
  }

  initRailNavUi(parent) {
    this.navCountBadge = this.createElSafe(parent, "span", "bangumi-3d-btn");
    this.navCountBadge.style.pointerEvents = "none";
    this.navCountBadge.style.fontSize = "12px";
    this.navCountBadge.style.fontWeight = "600";
    this.navCountBadge.textContent = "1/1 排 · 0 部";

    const prevBtn = this.createElSafe(parent, "button", "bangumi-3d-btn", "▲");
    prevBtn.title = "上一排档案 (更靠近眼前首排)";
    prevBtn.onclick = () => {
      this.targetRailOffset = Math.max(0, this.targetRailOffset - ROW_SPACING);
      this.ensureCardsForCurrentView();
      this.wakeUp();
      this.updateNavCountUi();
    };

    const nextBtn = this.createElSafe(parent, "button", "bangumi-3d-btn", "▼");
    nextBtn.title = "下一排档案 (推进后面排数)";
    nextBtn.onclick = () => {
      const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
      this.targetRailOffset = Math.min(maxRailOffset, this.targetRailOffset + ROW_SPACING);
      this.ensureCardsForCurrentView();
      this.wakeUp();
      this.updateNavCountUi();
    };
  }

  updateNavCountUi() {
    if (!this.navCountBadge) return;
    const curRow = Math.min(
      this.rowCount - 1,
      Math.max(0, Math.round(this.targetRailOffset / ROW_SPACING))
    );
    const total = this.currentFilteredItems.length;
    this.navCountBadge.textContent = `第 ${curRow + 1}/${this.rowCount} 排 · 共 ${total} 部`;
  }

  createElSafe(parent, tag, cls = "", text = "") {
    if (typeof parent.createEl === "function") {
      return parent.createEl(tag, { cls, text });
    }
    if (tag === "div" && typeof parent.createDiv === "function") {
      return parent.createDiv(cls);
    }
    if (tag === "span" && typeof parent.createSpan === "function") {
      return parent.createSpan({ cls, text });
    }
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  updateStatusPill() {
    if (!this.statusPill) return;
    const modeText = this.perfMode === "low" ? "节能模式" : this.perfMode === "high" ? "极致画质" : "均衡模式";
    const stateText = this.spaceState === "focus" ? "焦点全息档案" : "档案墙阵列";
    let statusText = "🟢 实时渲染";
    if (this.isSleeping) {
      statusText = "💤 静止休眠 (0 FPS)";
    } else if (this.motionSettings && this.motionSettings.idleWave) {
      statusText = "🟢 闲置起伏渲染";
    }
    this.statusPill.textContent = `${stateText} · ${modeText} · ${statusText}`;
    this.statusPill.className = `bangumi-3d-status-pill ${this.isSleeping ? "is-sleeping" : "is-active"}`;
  }

  toggleTheme() {
    this.themeMode = this.themeMode === "light" ? "dark" : "light";
    this.themeBtn.textContent = this.themeMode === "light" ? "☀️ 浅色空间" : "🌙 深空暗色";
    const bgColor = this.themeMode === "light" ? 0xe9edf0 : 0x111419;

    if (this.themeMode === "dark") {
      this.rootEl.classList.add("theme-dark-space");
      if (this.corridorFloorCenter) this.corridorFloorCenter.material.color.set(0x181b22);
      if (this.corridorFloorSideL) this.corridorFloorSideL.material.color.set(0x14161b);
      if (this.corridorFloorSideR) this.corridorFloorSideR.material.color.set(0x14161b);
      if (this.backWallMesh) this.backWallMesh.material.color.set(0x111317);
    } else {
      this.rootEl.classList.remove("theme-dark-space");
      if (this.corridorFloorCenter) this.corridorFloorCenter.material.color.set(0xdce2ea);
      if (this.corridorFloorSideL) this.corridorFloorSideL.material.color.set(0xe6ebf2);
      if (this.corridorFloorSideR) this.corridorFloorSideR.material.color.set(0xe6ebf2);
      if (this.backWallMesh) this.backWallMesh.material.color.set(0xd0d6e0);
    }

    if (this.scene) {
      this.scene.background.set(bgColor);
      if (this.scene.fog) this.scene.fog.color.set(bgColor);
    }
    this.wakeUp();
  }

  setPerformanceMode(mode) {
    const prevSelected = this.selectedIndex;
    const prevTargetRail = this.targetRailOffset;
    this.perfMode = mode;
    if (this.plugin?.settings) {
      this.plugin.settings.dashboard3dPerfMode = mode;
      if (typeof this.plugin.saveSettings === "function") {
        this.plugin.saveSettings();
      }
    }

    for (const [key, btn] of Object.entries(this.perfButtons)) {
      if (key === mode) btn.classList.add("is-active");
      else btn.classList.remove("is-active");
    }

    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    if (this.renderer) {
      if (mode === "low") {
        this.renderer.setPixelRatio(1.0);
        this.renderer.shadowMap.enabled = false;
        if (this.warmMainLight) this.warmMainLight.castShadow = false;
      } else if (mode === "medium") {
        this.renderer.setPixelRatio(Math.min(dpr, 1.5));
        this.renderer.shadowMap.enabled = false;
        if (this.warmMainLight) this.warmMainLight.castShadow = false;
      } else {
        this.renderer.setPixelRatio(Math.min(dpr, 2.0));
        this.renderer.shadowMap.enabled = true;
        if (this.warmMainLight) this.warmMainLight.castShadow = true;
      }
    }

    this.setupEnvironment();
    this.targetRailOffset = prevTargetRail;
    this.filterAndBuildCards();
    if (prevSelected >= 0 && this.spaceState === "focus") {
      this.selectCard(prevSelected);
    }
    this.wakeUp();
    this.updateStatusPill();
  }

  // ==========================================
  // Three.js 场景构建、低 FOV (15°) 相机与三层光照
  // ==========================================
  initThree() {
    const w = this.viewportEl.clientWidth || 960;
    const h = this.viewportEl.clientHeight || 660;

    // 1. WebGL 渲染器
    if (this.options?.mockRenderer) {
      this.renderer = this.options.mockRenderer;
    } else {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
      });
    }

    this.renderer.setSize(w, h);
    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
    this.renderer.setPixelRatio(
      this.perfMode === "low" ? 1.0 : this.perfMode === "high" ? Math.min(dpr, 2.0) : Math.min(dpr, 1.5)
    );
    this.renderer.shadowMap.enabled = this.perfMode === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    if (this.renderer.domElement && this.viewportEl.appendChild) {
      this.viewportEl.appendChild(this.renderer.domElement);
    }

    // 2. 场景与轻雾
    this.scene = new THREE.Scene();
    const bgColor = this.themeMode === "light" ? 0xe9edf0 : 0x111419;
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.Fog(bgColor, 35, 130);

    // 3. 低 FOV (15°) 工业透视相机 (规范要求)
    this.camera = new THREE.PerspectiveCamera(15, w / h, 0.1, 180);
    this.camera.position.set(this.cameraPosX.value, this.cameraPosY.value, this.cameraPosZ.value);
    this.camera.lookAt(this.cameraAimX.value, this.cameraAimY.value, this.cameraAimZ.value);

    // 4. 三层光照体系 (规范要求)
    // 环境底光 (充足且柔和，防止重阴影死黑)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x788598, 0.52);
    this.scene.add(this.hemiLight);

    // 暖主光：强度 1.25，柔和阴影，光心与阴影相机随视角视线动态聚焦
    this.warmMainLight = new THREE.DirectionalLight(0xfffbf2, 1.25);
    this.warmMainLight.position.set(-15, 24, 16);
    this.warmMainLight.castShadow = this.perfMode === "high";
    if (this.warmMainLight.castShadow) {
      this.warmMainLight.shadow.mapSize.set(1024, 1024);
      this.warmMainLight.shadow.camera.left = -55;
      this.warmMainLight.shadow.camera.right = 55;
      this.warmMainLight.shadow.camera.top = 55;
      this.warmMainLight.shadow.camera.bottom = -55;
      this.warmMainLight.shadow.camera.near = 0.5;
      this.warmMainLight.shadow.camera.far = 120;
      this.warmMainLight.shadow.bias = -0.0005;
      this.warmMainLight.shadow.radius = 2.0;
    }
    this.scene.add(this.warmMainLight);
    this.scene.add(this.warmMainLight.target);

    // 冷轮廓光：(10, 8, -14)，强度约 0.32
    this.coolRimLight = new THREE.DirectionalLight(0x5b9bd5, 0.32);
    this.coolRimLight.position.set(10, 8, -14);
    this.scene.add(this.coolRimLight);

    // 焦点琥珀光：PointLight，初始强度 0，只在 focus 状态淡入照亮焦点边缘与趋势舞台
    this.focusAmberLight = new THREE.PointLight(0xd49b35, 0.0, 30);
    this.focusAmberLight.position.set(-4, 6, 6);
    this.focusStageGroup.add(this.focusAmberLight);
    this.focusStageGroup.add(this.trendStageGroup);

    // 5. 构筑固定背景空间 (corridorShellGroup)
    this.buildCorridorShell();

    // 6. 挂载三大规范分组
    this.scene.add(this.corridorShellGroup);
    this.scene.add(this.archiveWallGroup);
    this.scene.add(this.focusStageGroup);

    this.setupEnvironment();

    // 7. 射线拾取器
    this.raycaster = new THREE.Raycaster();
    this.mouseCoord = new THREE.Vector2(-100, -100);
  }

  // 构筑固定背景空间（corridorShellGroup）：不随档案行滚动，完全去除遮挡视线的柱子与横梁
  buildCorridorShell() {
    while (this.corridorShellGroup.children.length > 0) {
      const o = this.corridorShellGroup.children[0];
      this.corridorShellGroup.remove(o);
      this.disposeObject3D(o);
    }

    // 1. 中心档案墙底座 (宽 18, 纵深 140)
    const centerFloorGeo = new THREE.PlaneGeometry(18, 140);
    const centerFloorMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xdce2ea : 0x181b22,
      roughness: 0.90,
      metalness: 0.10
    });
    this.corridorFloorCenter = new THREE.Mesh(centerFloorGeo, centerFloorMat);
    this.corridorFloorCenter.rotation.x = -Math.PI / 2;
    this.corridorFloorCenter.position.set(0, FLOOR_Y, -35);
    this.corridorFloorCenter.receiveShadow = this.perfMode !== "low";
    this.corridorShellGroup.add(this.corridorFloorCenter);

    // 2. 两侧浅色粗糙空间面
    const sideFloorGeo = new THREE.PlaneGeometry(45, 140);
    const sideFloorMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xe6ebf2 : 0x14161b,
      roughness: 0.88,
      metalness: 0.05
    });
    this.corridorFloorSideL = new THREE.Mesh(sideFloorGeo, sideFloorMat);
    this.corridorFloorSideL.rotation.x = -Math.PI / 2;
    this.corridorFloorSideL.position.set(-31.5, FLOOR_Y - 0.002, -35);
    this.corridorFloorSideL.receiveShadow = this.perfMode !== "low";
    this.corridorShellGroup.add(this.corridorFloorSideL);

    this.corridorFloorSideR = new THREE.Mesh(sideFloorGeo, sideFloorMat);
    this.corridorFloorSideR.rotation.x = -Math.PI / 2;
    this.corridorFloorSideR.position.set(31.5, FLOOR_Y - 0.002, -35);
    this.corridorFloorSideR.receiveShadow = this.perfMode !== "low";
    this.corridorShellGroup.add(this.corridorFloorSideR);

    // 3. 远景低对比墙体 (z = -55, 纵深终点，不随轨道滚动)
    const backWallGeo = new THREE.BoxGeometry(64, 28, 2);
    const backWallMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xd0d6e0 : 0x111317,
      roughness: 0.92,
      metalness: 0.08
    });
    this.backWallMesh = new THREE.Mesh(backWallGeo, backWallMat);
    this.backWallMesh.position.set(0, 11, -55);
    this.backWallMesh.receiveShadow = this.perfMode !== "low";
    this.corridorShellGroup.add(this.backWallMesh);

    // 4. 远处一条窄发光灯带 (z = -53.8, y = 2.4)
    const lightBarGeo = new THREE.BoxGeometry(32, 0.10, 0.08);
    const lightBarMat = new THREE.MeshBasicMaterial({ color: 0x59c7e8 });
    const lightBarMesh = new THREE.Mesh(lightBarGeo, lightBarMat);
    lightBarMesh.position.set(0, 2.4, -53.8);
    this.corridorShellGroup.add(lightBarMesh);
  }

  // Studio/Room 参数化环境贴图生成 (只用于 PMREM 反射，绝不加入可见场景)
  setupEnvironment() {
    if (this.perfMode === "high" && this.renderer && THREE.PMREMGenerator) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();

        const studioScene = new THREE.Scene();
        studioScene.background = new THREE.Color(0x181b20);

        // Studio 参数化环境几何：后墙、顶面、左右墙
        const wallMat = new THREE.MeshBasicMaterial({ color: 0x222730 });
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), wallMat);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0, 25, 0);
        studioScene.add(ceiling);

        const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), wallMat);
        leftWall.rotation.y = Math.PI / 2;
        leftWall.position.set(-30, 15, 0);
        studioScene.add(leftWall);

        const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), wallMat);
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(30, 15, 0);
        studioScene.add(rightWall);

        // 两个大面积软光板
        const softPanelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const softPanelA = new THREE.Mesh(new THREE.PlaneGeometry(24, 18), softPanelMat);
        softPanelA.position.set(-15, 20, 15);
        softPanelA.lookAt(0, 0, 0);
        studioScene.add(softPanelA);

        const coolPanelMat = new THREE.MeshBasicMaterial({ color: 0x88bbff });
        const softPanelB = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), coolPanelMat);
        softPanelB.position.set(16, 12, -15);
        softPanelB.lookAt(0, 0, 0);
        studioScene.add(softPanelB);

        const envTex = pmrem.fromScene(studioScene).texture;
        this.scene.environment = envTex;

        if (this.currentEnvTexture) this.currentEnvTexture.dispose();
        this.currentEnvTexture = envTex;

        // 彻底释放临时 Studio 场景几何与材质
        this.disposeObject3D(studioScene);
        pmrem.dispose();
      } catch (e) {
        if (this.scene) this.scene.environment = null;
      }
    } else {
      if (this.currentEnvTexture) {
        this.currentEnvTexture.dispose();
        this.currentEnvTexture = null;
      }
      if (this.scene) this.scene.environment = null;
    }
  }

  // ==========================================
  // 档案墙阵列构建与虚拟化可见窗口 (全量保留，绝不 slice 截断)
  // ==========================================
  filterAndBuildCards() {
    if (this.filterMode === "watching") {
      this.currentFilteredItems = this.allItems.filter((it) => it.state === "在看");
      if (this.currentFilteredItems.length === 0) {
        this.currentFilteredItems = this.allItems.slice();
      }
    } else {
      this.currentFilteredItems = this.allItems.slice();
    }

    const count = this.currentFilteredItems.length;
    this.cols = Math.min(MAX_COLS, Math.max(3, Math.ceil(Math.sqrt(Math.max(count, 1) * 1.3))));
    this.rowCount = Math.max(1, Math.ceil(count / this.cols));
    this.currentRenderWindow = { startRow: -1, endRow: -1 };

    this.ensureCardsForCurrentView();

    this.selectedIndex = -1;
    this.spaceState = "array";
    this.closeTrendStage();
    this.clearHud();
    this.updateNavCountUi();
  }

  ensureCardsForCurrentView() {
    const count = this.currentFilteredItems.length;
    if (count === 0) {
      while (this.archiveWallGroup.children.length > 0) {
        const obj = this.archiveWallGroup.children[0];
        this.archiveWallGroup.remove(obj);
        this.disposeObject3D(obj);
      }
      this.cardMeshes = [];
      this.cardDataMap.clear();
      this.displayedItems = [];
      return;
    }

    const maxCards = this.perfMode === "low" ? 18 : this.perfMode === "medium" ? 36 : 48;
    const centerRow = Math.min(
      this.rowCount - 1,
      Math.max(0, Math.round(this.targetRailOffset / ROW_SPACING))
    );

    const win = calculateVisibleRowWindow(count, this.cols, centerRow, maxCards);

    // 若当前渲染窗口已精确对齐，无需重复重建
    if (
      this.currentRenderWindow.startRow === win.startRow &&
      this.currentRenderWindow.endRow === win.endRow
    ) {
      return;
    }

    this.currentRenderWindow = { startRow: win.startRow, endRow: win.endRow };

    while (this.archiveWallGroup.children.length > 0) {
      const obj = this.archiveWallGroup.children[0];
      this.archiveWallGroup.remove(obj);
      this.disposeObject3D(obj);
    }
    this.cardMeshes = [];
    this.cardDataMap.clear();

    const offsetX = -((this.cols - 1) * COL_SPACING) / 2;

    // 导轨槽位公用材质
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x1f242d,
      roughness: 0.70,
      metalness: 0.40
    });
    const slotRailMat = new THREE.MeshStandardMaterial({
      color: 0x3d4554,
      roughness: 0.35,
      metalness: 0.80
    });

    // 渲染各排低矮导轨承托
    for (let r = 0; r < this.rowCount; r++) {
      const rowZ = BASE_Z - r * ROW_SPACING;
      const railGeo = new THREE.BoxGeometry(this.cols * COL_SPACING + 1.2, 0.04, 0.45);
      const rowRail = new THREE.Mesh(railGeo, slotRailMat);
      rowRail.position.set(0, SLOT_BASE_Y, rowZ);
      rowRail.receiveShadow = this.perfMode !== "low";
      this.archiveWallGroup.add(rowRail);
    }

    // 仅在当前可见排窗口内实例化卡片对象（保证各档性能对象上限）
    this.displayedItems = [];
    for (let idx = win.startIndex; idx <= win.endIndex; idx++) {
      const item = this.currentFilteredItems[idx];
      if (!item) continue;
      this.displayedItems.push(item);

      const col = idx % this.cols;
      const row = Math.floor(idx / this.cols);
      const posX = offsetX + col * COL_SPACING;
      const posZ = BASE_Z - row * ROW_SPACING;

      // 1. 卡片嵌入式槽位底座 (挂入 archiveWallGroup)
      const slotBox = new THREE.Mesh(new THREE.BoxGeometry(CARD_W + 0.12, 0.06, 0.35), slotMat);
      slotBox.position.set(posX, SLOT_BASE_Y + 0.03, posZ);
      slotBox.receiveShadow = this.perfMode !== "low";
      this.archiveWallGroup.add(slotBox);

      // 2. 卡片模型组 (挂入 archiveWallGroup)
      const cardGroup = this.createArchiveCard(item, idx);
      cardGroup.position.set(posX, CARD_BASE_Y, posZ);
      cardGroup.rotation.x = -0.06;
      cardGroup.rotation.y = 0.16;
      this.archiveWallGroup.add(cardGroup);

      const uData = cardGroup.userData;
      const cardData = {
        item,
        index: idx,
        col,
        row,
        basePos: new THREE.Vector3(posX, CARD_BASE_Y, posZ),
        group: cardGroup,
        hitTarget: uData.hitTarget,
        posterMesh: uData.posterMesh,
        posterMat: uData.posterMat,
        frameMat: uData.frameMat,
        spineMat: uData.spineMat,
        backMat: uData.backMat,
        glassMesh: uData.glassMesh,

        // 独立二阶物理弹簧系统
        positionX: { value: posX, velocity: 0 },
        positionY: { value: CARD_BASE_Y, velocity: 0 },
        positionZ: { value: posZ, velocity: 0 },
        rotationX: { value: -0.06, velocity: 0 },
        rotationY: { value: 0.16, velocity: 0 },
        scale: { value: 1.0, velocity: 0 },
        opacity: { value: 1.0, velocity: 0 },
        brightness: { value: 1.0, velocity: 0 }
      };

      this.cardMeshes.push(uData.hitTarget);
      this.cardDataMap.set(uData.hitTarget, cardData);
    }
  }

  // ==========================================
  // 参数化卡片构建（严格 Z 层分离与防闪烁体系）
  // ==========================================
  createArchiveCard(item, index) {
    const cardGroup = new THREE.Group();

    // 1. 不透明背板: 中心 z = -0.08, renderOrder = 1, transparent = false
    const backplateGeo = new THREE.BoxGeometry(CARD_W, CARD_H, 0.05);
    const backplateMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0x1f232b : 0x181b22,
      metalness: 0.35,
      roughness: 0.60,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    const backplateMesh = new THREE.Mesh(backplateGeo, backplateMat);
    backplateMesh.position.set(0, 0, Z_BACKPLATE);
    backplateMesh.renderOrder = 1;
    backplateMesh.castShadow = this.perfMode !== "low";
    backplateMesh.receiveShadow = this.perfMode !== "low";
    cardGroup.add(backplateMesh);

    // 背面信息铭牌: z = Z_BACKPLATE - 0.026 = -0.106, rotation.y = Math.PI
    const backCanvasMat = new THREE.MeshBasicMaterial({
      map: this.generateBackPlateTexture(item),
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    const backNameplateGeo = new THREE.PlaneGeometry(CARD_W - 0.24, CARD_H - 0.24);
    const backNameplateMesh = new THREE.Mesh(backNameplateGeo, backCanvasMat);
    backNameplateMesh.position.set(0, 0, Z_BACKPLATE - 0.026);
    backNameplateMesh.rotation.y = Math.PI;
    backNameplateMesh.renderOrder = 1;
    cardGroup.add(backNameplateMesh);

    // 2. 不透明状态侧脊: 中心 z = -0.015, renderOrder = 2, transparent = false
    const spineColor = STATUS_COLORS[item.state] || STATUS_COLORS["未设置"];
    const spineGeo = new THREE.BoxGeometry(0.06, CARD_H - 0.16, 0.16);
    const spineMat = new THREE.MeshStandardMaterial({
      color: spineColor,
      roughness: 0.28,
      metalness: 0.65,
      emissive: spineColor,
      emissiveIntensity: 0.25,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    const spineMesh = new THREE.Mesh(spineGeo, spineMat);
    spineMesh.position.set(CARD_W / 2 - 0.02, 0, Z_SPINE);
    spineMesh.renderOrder = 2;
    cardGroup.add(spineMesh);

    // 3. 不透明四边框: 中心 z = 0.025, renderOrder = 3, transparent = false (绝不遮挡封面)
    const frameMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xc8ccd2 : 0x3d4450,
      metalness: 0.82,
      roughness: 0.24,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });

    const hBarGeo = new THREE.BoxGeometry(CARD_W, 0.07, 0.05);
    const topBar = new THREE.Mesh(hBarGeo, frameMat);
    topBar.position.set(0, CARD_H / 2 - 0.035, Z_FRAME);
    topBar.renderOrder = 3;
    cardGroup.add(topBar);

    const btmBar = new THREE.Mesh(hBarGeo, frameMat);
    btmBar.position.set(0, -CARD_H / 2 + 0.035, Z_FRAME);
    btmBar.renderOrder = 3;
    cardGroup.add(btmBar);

    const vBarGeo = new THREE.BoxGeometry(0.07, CARD_H - 0.14, 0.05);
    const leftBar = new THREE.Mesh(vBarGeo, frameMat);
    leftBar.position.set(-CARD_W / 2 + 0.035, 0, Z_FRAME);
    leftBar.renderOrder = 3;
    cardGroup.add(leftBar);

    const rightBar = new THREE.Mesh(vBarGeo, frameMat);
    rightBar.position.set(CARD_W / 2 - 0.035, 0, Z_FRAME);
    rightBar.renderOrder = 3;
    cardGroup.add(rightBar);

    // 4. 正面全幅动画封面海报 (第一视觉主体，中心 z = 0.105, renderOrder = 10, 永远不透明，深度写入开启)
    const posterGeo = new THREE.PlaneGeometry(CARD_W - 0.14, CARD_H - 0.14);
    const posterMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.05,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const posterMesh = new THREE.Mesh(posterGeo, posterMat);
    posterMesh.position.set(0, 0, Z_POSTER);
    posterMesh.renderOrder = 10;
    posterMesh.receiveShadow = this.perfMode !== "low";
    cardGroup.add(posterMesh);

    this.loadCoverTexture(item, posterMat);

    // 5. 可选透明保护层: 中心 z = 0.155 (仅在 medium/high 下启用，opacity <= 0.07, depthWrite = false, depthTest = true, side = FrontSide)
    let glassMesh = null;
    if (this.perfMode !== "low") {
      const glassGeo = new THREE.PlaneGeometry(CARD_W - 0.14, CARD_H - 0.14);
      const glassMat = new THREE.MeshPhysicalMaterial({
        transparent: true,
        opacity: 0.065,
        roughness: 0.12,
        metalness: 0.05,
        clearcoat: 0.5,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide
      });
      glassMesh = new THREE.Mesh(glassGeo, glassMat);
      glassMesh.position.set(0, 0, Z_GLASS);
      glassMesh.renderOrder = 20;
      cardGroup.add(glassMesh);
    }

    // 6. 不可见命中体 (射线拾取碰撞盒)
    const hitGeo = new THREE.BoxGeometry(CARD_W + 0.12, CARD_H + 0.12, 0.32);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(0, 0, 0.05);
    cardGroup.add(hitMesh);

    cardGroup.userData = {
      item,
      index,
      hitTarget: hitMesh,
      posterMesh,
      posterMat,
      frameMat,
      spineMat,
      backMat: backplateMat,
      glassMesh
    };

    return cardGroup;
  }

  // 严格三层可见策略与亮度控制（海报永远保持 opaque，通过颜色亮度退隐）
  applyCardVisibility(cardData, brightness) {
    const b = Math.max(0.2, Math.min(1.0, brightness));
    if (cardData.posterMat) {
      cardData.posterMat.transparent = false;
      cardData.posterMat.depthWrite = true;
      cardData.posterMat.color.setRGB(b, b, b);
    }
    if (cardData.frameMat) {
      cardData.frameMat.transparent = false;
      const fb = b * 0.85;
      cardData.frameMat.color.setRGB(fb, fb, fb);
    }
  }

  // 恢复所有卡片材质默认状态 (消除泄漏)
  resetAllCardsState() {
    for (const cData of this.cardDataMap.values()) {
      if (cData.posterMat) {
        cData.posterMat.transparent = false;
        cData.posterMat.depthWrite = true;
        cData.posterMat.opacity = 1.0;
        cData.posterMat.visible = true;
        cData.posterMat.color.setRGB(1.0, 1.0, 1.0);
      }
      if (cData.frameMat) {
        cData.frameMat.transparent = false;
        cData.frameMat.depthWrite = true;
        cData.frameMat.opacity = 1.0;
      }
      if (cData.spineMat) {
        cData.spineMat.transparent = false;
        cData.spineMat.depthWrite = true;
        cData.spineMat.opacity = 1.0;
      }
      if (cData.backMat) {
        cData.backMat.transparent = false;
        cData.backMat.depthWrite = true;
        cData.backMat.opacity = 1.0;
      }
    }
  }

  // 纹理异步加载与高质感纯净不透明占位
  async loadCoverTexture(item, targetMaterial) {
    let coverUrl = null;
    if (item.cover && this.plugin?.getCoverResourceUrl) {
      try {
        coverUrl = this.plugin.getCoverResourceUrl(item.cover, item.file?.path);
      } catch (e) {}
    }

    if (coverUrl) {
      if (this.textureCache.has(coverUrl)) {
        targetMaterial.map = this.textureCache.get(coverUrl);
        targetMaterial.needsUpdate = true;
        this.wakeUp();
        return;
      }

      try {
        const loader = new THREE.TextureLoader();
        loader.load(
          coverUrl,
          (tex) => {
            if (this.isDestroyed || !targetMaterial) return;
            if ("colorSpace" in tex) {
              tex.colorSpace = THREE.SRGBColorSpace;
            } else if ("encoding" in tex) {
              tex.encoding = 3001;
            }
            if (this.renderer?.capabilities?.getMaxAnisotropy) {
              tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
            }

            // 保留原图比例适配 (居中裁切/填充，防止拉伸失真)
            if (tex.image && tex.image.width && tex.image.height) {
              const targetAspect = (CARD_W - 0.14) / (CARD_H - 0.14);
              const imgAspect = tex.image.width / tex.image.height;
              if (Math.abs(imgAspect - targetAspect) > 0.04) {
                if (imgAspect > targetAspect) {
                  const scale = targetAspect / imgAspect;
                  tex.repeat.set(scale, 1.0);
                  tex.offset.set((1.0 - scale) / 2, 0);
                } else {
                  const scale = imgAspect / targetAspect;
                  tex.repeat.set(1.0, scale);
                  tex.offset.set(0, (1.0 - scale) / 2);
                }
              }
            }

            this.textureCache.set(coverUrl, tex);
            targetMaterial.map = tex;
            targetMaterial.transparent = false;
            targetMaterial.depthWrite = true;
            targetMaterial.needsUpdate = true;
            this.wakeUp();
          },
          undefined,
          () => {
            this.applyPlaceholderTexture(item, targetMaterial);
          }
        );
        return;
      } catch (e) {}
    }

    this.applyPlaceholderTexture(item, targetMaterial);
  }

  applyPlaceholderTexture(item, targetMaterial) {
    const placeholderTex = this.generatePlaceholderTexture(item);
    targetMaterial.map = placeholderTex;
    targetMaterial.needsUpdate = true;
    this.wakeUp();
  }

  generatePlaceholderTexture(item) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 724;
    const ctx = canvas.getContext("2d");

    // 高质感深蓝深灰微渐变 (100% 不透明)
    const grad = ctx.createLinearGradient(0, 0, 512, 724);
    grad.addColorStop(0, "#222731");
    grad.addColorStop(1, "#14171d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 724);

    // 科技细网纹
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 32; x < 512; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 724);
      ctx.stroke();
    }
    for (let y = 32; y < 724; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // 眉标
    ctx.fillStyle = "#59c7e8";
    ctx.font = "bold 18px monospace";
    ctx.fillText("BANGUMI ARCHIVE", 40, 68);

    // 动画名称
    ctx.fillStyle = "#f5f6f8";
    ctx.font = "bold 34px sans-serif";
    const name = item.name || "未命名动画";
    const lines = [];
    if (name.length > 10) {
      lines.push(name.slice(0, 9));
      lines.push(name.length > 18 ? name.slice(9, 17) + "…" : name.slice(9));
    } else {
      lines.push(name);
    }
    lines.forEach((l, i) => ctx.fillText(l, 40, 160 + i * 46));

    // 年份与季度
    ctx.fillStyle = "#9ba3af";
    ctx.font = "20px sans-serif";
    ctx.fillText(`${item.year || "----"} · ${item.season || "SEASON"}`, 40, 280);

    // 状态徽章
    const stateColorHex = item.state === "已看" ? "#4dbd7a" : item.state === "想看" ? "#e0aa45" : "#31a6ff";
    ctx.fillStyle = stateColorHex;
    ctx.fillRect(40, 320, 96, 30);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(item.state || "在看", 58, 340);

    // 底部条形码装饰
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    for (let b = 0; b < 36; b++) {
      const bw = b % 3 === 0 ? 4 : b % 2 === 0 ? 2 : 3;
      ctx.fillRect(40 + b * 12, 630, bw, 40);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    return tex;
  }

  generateBackPlateTexture(item) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 680;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#e8e5dc";
    ctx.fillRect(0, 0, 480, 680);

    ctx.fillStyle = "#1e2229";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(item.name ? item.name.slice(0, 14) : "动画档案", 32, 54);

    ctx.fillStyle = "#636872";
    ctx.font = "16px sans-serif";
    ctx.fillText(item.japaneseName ? item.japaneseName.slice(0, 20) : "Original Title", 32, 86);

    ctx.strokeStyle = "#c4c0b6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, 108);
    ctx.lineTo(448, 108);
    ctx.stroke();

    const watched = Number(item.watchedEpisodes) || 0;
    const total = Number(item.totalEpisodes) || 12;
    const ratio = Math.min(1.0, Math.max(0, total > 0 ? watched / total : 0));

    ctx.fillStyle = "#2c313a";
    ctx.font = "bold 16px monospace";
    ctx.fillText(`AIRING: ${item.year || "----"} / ${item.season || "SEASON"}`, 32, 148);
    ctx.fillText(`EPISODES: ${watched} / ${total > 0 ? total : "?"} (${Math.round(ratio * 100)}%)`, 32, 184);

    ctx.fillStyle = "#d1cdbf";
    ctx.fillRect(32, 200, 416, 10);
    ctx.fillStyle = "#31a6ff";
    ctx.fillRect(32, 200, 416 * ratio, 10);

    ctx.fillStyle = "#e0ab57";
    const pScore = Number(item.personalScore);
    const bScore = Number(item.bangumiScore);
    const hasPersonal = !isNaN(pScore) && item.personalScore !== null && item.personalScore !== undefined;
    const hasBgm = !isNaN(bScore) && item.bangumiScore !== null && item.bangumiScore !== undefined;
    const scoreVal = hasPersonal ? pScore.toFixed(1) : (hasBgm ? bScore.toFixed(1) : "—.—");
    ctx.fillText(scoreVal, 32, 280);

    ctx.fillStyle = "#636872";
    ctx.font = "14px monospace";
    ctx.fillText(hasPersonal ? "★ PERSONAL RATING" : "★ BANGUMI SCORE", 130, 274);

    ctx.fillStyle = "#8a8f99";
    ctx.font = "12px monospace";
    ctx.fillText(`SUBJECT ID: #${item.subjectId || "N/A"}`, 32, 330);

    ctx.fillStyle = "#7a7f88";
    for (let b = 0; b < 32; b++) {
      const bw = b % 4 === 0 ? 4 : b % 2 === 0 ? 1 : 2;
      ctx.fillRect(32 + b * 13, 580, bw, 36);
    }
    ctx.fillText("BANGUMI ARCHIVE SPECIMEN · PARAMETRIC", 32, 638);

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    return tex;
  }

  // ==========================================
  // 事件交互与滚轮滑动 (视差、正向推移、清理路径)
  // ==========================================
  bindEvents() {
    const el = this.viewportEl;
    if (!el || typeof el.addEventListener !== "function") return;

    this.boundPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mouseCoord.set(x, y);

      // 轻微指针视差 (有明确上限，离开平滑归位)
      if (this.motionSettings && this.motionSettings.parallax && this.spaceState === "array") {
        this.targetParallaxX = Math.max(-0.04, Math.min(0.04, x * 0.035));
        this.targetParallaxY = Math.max(-0.02, Math.min(0.02, y * 0.020));
      } else {
        this.targetParallaxX = 0;
        this.targetParallaxY = 0;
      }

      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        // 打量旋转幅度 (rotation.y: [-0.48, 0.48], rotation.x: [-0.12, 0.12])
        this.targetCardRotation += dx * 0.012;
        this.targetCardRotation = Math.max(-0.48, Math.min(0.48, this.targetCardRotation));

        this.targetCardTilt += dy * 0.006;
        this.targetCardTilt = Math.max(-0.12, Math.min(0.12, this.targetCardTilt));

        this.wakeUp();
      }

      this.wakeUp();
    };
    el.addEventListener("pointermove", this.boundPointerMove);

    this.boundPointerLeave = () => {
      this.targetParallaxX = 0;
      this.targetParallaxY = 0;
      this.wakeUp();
    };
    el.addEventListener("pointerleave", this.boundPointerLeave);

    this.boundPointerDown = (e) => {
      this.wakeUp();
      if (e.button === 0) {
        this.raycaster.setFromCamera(this.mouseCoord, this.camera);
        const intersects = this.raycaster.intersectObjects(this.cardMeshes);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const data = this.cardDataMap.get(hitMesh);
          if (data) {
            if (this.selectedIndex === data.index) {
              this.isDragging = true;
              this.dragStartX = e.clientX;
              this.dragStartY = e.clientY;
              el.style.cursor = "grabbing";
            } else {
              this.selectCard(data.index);
            }
          }
        } else {
          if (this.spaceState === "focus") {
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            el.style.cursor = "grabbing";
          }
        }
      }
    };
    el.addEventListener("pointerdown", this.boundPointerDown);

    if (typeof window !== "undefined") {
      this.boundPointerUp = () => {
        if (this.isDragging) {
          this.isDragging = false;
          el.style.cursor = "grab";
          this.wakeUp();
        }
      };
      window.addEventListener("pointerup", this.boundPointerUp);

      // 滚轮滑动：在 array 状态通过正向位移推进或拉回档案墙
      this.boundWheel = (e) => {
        e.preventDefault();
        this.wakeUp();
        if (this.spaceState === "array") {
          const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
          const step = Math.sign(e.deltaY) * (ROW_SPACING * 0.85);
          this.targetRailOffset = Math.max(0, Math.min(maxRailOffset, this.targetRailOffset + step));
          this.ensureCardsForCurrentView();
          this.updateNavCountUi();
        } else {
          this.targetZoom += e.deltaY * 0.0012;
          this.targetZoom = Math.max(0.8, Math.min(1.5, this.targetZoom));
        }
      };
      el.addEventListener("wheel", this.boundWheel, { passive: false });

      // 键盘导航 (Esc 退出，四向键漫游切换)
      this.keyHandler = (e) => {
        if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
        if (e.key === "Escape") {
          if (this.spaceState === "focus") {
            this.deselectCard();
          }
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          const total = this.currentFilteredItems.length;
          if (total === 0) return;
          e.preventDefault();

          if (this.spaceState === "focus") {
            const curIdx = this.selectedIndex >= 0 ? this.selectedIndex : 0;
            const curCol = curIdx % this.cols;
            const curRow = Math.floor(curIdx / this.cols);

            let nextIdx = curIdx;
            if (e.key === "ArrowLeft") {
              if (curCol > 0) nextIdx = curIdx - 1;
            } else if (e.key === "ArrowRight") {
              if (curCol < this.cols - 1 && curIdx + 1 < total) nextIdx = curIdx + 1;
            } else if (e.key === "ArrowUp") {
              if (curRow > 0) nextIdx = curIdx - this.cols;
            } else if (e.key === "ArrowDown") {
              if (curIdx + this.cols < total) nextIdx = curIdx + this.cols;
            }

            if (nextIdx !== curIdx) {
              this.selectCard(nextIdx);
            }
          } else {
            // array 状态键盘上下排切换 (Down 推进深入，Up 返回眼前首排)
            const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
            if (e.key === "ArrowUp") {
              this.targetRailOffset = Math.max(0, this.targetRailOffset - ROW_SPACING);
            } else if (e.key === "ArrowDown") {
              this.targetRailOffset = Math.min(maxRailOffset, this.targetRailOffset + ROW_SPACING);
            }
            this.ensureCardsForCurrentView();
            this.wakeUp();
            this.updateNavCountUi();
          }
        }
      };
      window.addEventListener("keydown", this.keyHandler);

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          this.onResize();
          this.wakeUp();
        });
        this.resizeObserver.observe(this.viewportEl);
      }

      this.visHandler = () => {
        if (document.hidden) {
          this.isSleeping = true;
          this.updateStatusPill();
        } else {
          this.wakeUp();
        }
      };
      document.addEventListener("visibilitychange", this.visHandler);
    }
  }

  onResize() {
    if (!this.viewportEl || this.isDestroyed || !this.camera || !this.renderer) return;
    const w = this.viewportEl.clientWidth;
    const h = this.viewportEl.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.rootEl && this.rootEl.classList) {
      if (w < 640) {
        if (typeof this.rootEl.classList.add === "function") this.rootEl.classList.add("is-narrow");
      } else {
        if (typeof this.rootEl.classList.remove === "function") this.rootEl.classList.remove("is-narrow");
      }
    }
  }

  wakeUp() {
    this.idleTime = 0;
    this.interactionAge = 0;
    if (this.isSleeping) {
      this.isSleeping = false;
      this.updateStatusPill();
      this.startLoop();
    }
  }

  // ==========================================
  // 状态机流转：selectCard & deselectCard
  // ==========================================
  selectCard(index) {
    const total = this.currentFilteredItems.length;
    if (index < 0 || index >= total) return;

    // 记录进入焦点前阵列状态 (返回时恢复，不跳回首排)
    if (this.spaceState === "array") {
      this.savedArrayRailOffset = this.targetRailOffset;
      this.savedArrayZoom = this.targetZoom;
    }

    this.selectedIndex = index;
    this.spaceState = "focus";
    this.targetFocusAnim = 1.0;

    this.targetCardRotation = 0;
    this.cardRotation.value = 0;
    this.cardRotation.velocity = 0;
    this.targetCardTilt = 0;
    this.cardTilt.value = 0;
    this.cardTilt.velocity = 0;

    // 1. 将目标卡片排推进到可视焦点平准线
    const cardRow = Math.floor(index / this.cols);
    const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
    this.targetRailOffset = Math.min(maxRailOffset, Math.max(0, cardRow * ROW_SPACING));
    this.ensureCardsForCurrentView();
    this.updateNavCountUi();

    // 在当前可见网格中查找该卡片
    let data = null;
    for (const cData of this.cardDataMap.values()) {
      if (cData.index === index) {
        data = cData;
        break;
      }
    }

    if (!data) return;

    if (this.motionSettings && this.motionSettings.ripple) {
      this.wavePulses.push({
        col: data.col,
        row: data.row,
        time: this.clock
      });
    }

    // 恢复所有卡片默认物理材质状态
    this.resetAllCardsState();

    // 2. 依次发生：焦点抽出、琥珀光点亮、趋势舞台生长、HUD 淡入
    this.openTrendStage(data.item, data);
    this.renderHud(data.item);

    this.updateStatusPill();
    this.wakeUp();
  }

  deselectCard() {
    this.selectedIndex = -1;
    this.spaceState = "array";
    this.targetFocusAnim = 0.0;
    this.targetCardRotation = 0;
    this.targetCardTilt = 0;

    // 恢复进入焦点前保存的阵列行位移与缩放，绝不跳到首行
    this.targetRailOffset = this.savedArrayRailOffset;
    this.targetZoom = this.savedArrayZoom;
    this.ensureCardsForCurrentView();
    this.updateNavCountUi();

    this.resetAllCardsState();
    this.closeTrendStage();
    this.clearHud();
    this.updateStatusPill();
    this.wakeUp();
  }

  resetCamera() {
    this.targetZoom = 1.0;
    this.cameraZoom.value = 1.0;
    this.targetCardRotation = 0;
    this.targetCardTilt = 0;
    this.targetRailOffset = 0;
    this.savedArrayRailOffset = 0;
    this.savedArrayZoom = 1.0;
    this.ensureCardsForCurrentView();
    this.updateNavCountUi();
    this.wakeUp();
  }

  // ==========================================
  // 全量 2D 封面总览抽屉 (Overview Drawer)
  // ==========================================
  openOverviewDrawer() {
    if (this.overviewDrawerEl) {
      this.closeOverviewDrawer();
      return;
    }
    this.closeMotionSettingsModal();
    if (this.searchDrop) this.searchDrop.style.display = "none";

    const drawer = this.createElSafe(this.rootEl, "div", "bangumi-3d-overview-drawer");
    this.overviewDrawerEl = drawer;

    const header = this.createElSafe(drawer, "div", "overview-drawer-header");
    const title = this.createElSafe(header, "div", "overview-drawer-title");
    title.innerHTML = `<span>📋 档案总览 (${this.currentFilteredItems.length} 部)</span>`;

    const searchInput = this.createElSafe(header, "input", "overview-drawer-search");
    searchInput.type = "text";
    searchInput.placeholder = "搜索全量档案作品...";

    const closeBtn = this.createElSafe(header, "button", "bangumi-3d-btn", "✕ 关闭总览");
    closeBtn.onclick = () => this.closeOverviewDrawer();

    const body = this.createElSafe(drawer, "div", "overview-drawer-body");

    const renderList = (filterText = "") => {
      body.innerHTML = "";
      const query = filterText.trim().toLowerCase();
      const allItems = this.currentFilteredItems;

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        if (query) {
          const matchName = item.name && item.name.toLowerCase().includes(query);
          const matchJp = item.japaneseName && item.japaneseName.toLowerCase().includes(query);
          const matchId = item.subjectId && String(item.subjectId).includes(query);
          if (!matchName && !matchJp && !matchId) continue;
        }

        const cardItem = this.createElSafe(body, "div", "overview-card-item");
        cardItem.title = `${item.name || "未命名"} (第 ${i + 1} 部 / 行 ${Math.floor(i / this.cols) + 1})`;

        let coverSrc = "";
        if (item.cover && this.plugin?.getCoverResourceUrl) {
          try {
            coverSrc = this.plugin.getCoverResourceUrl(item.cover);
          } catch (e) {
            coverSrc = "";
          }
        }

        const placeholder = this.createElSafe(cardItem, "div", "overview-card-poster is-placeholder");
        placeholder.style.display = coverSrc ? "none" : "flex";
        placeholder.style.alignItems = "center";
        placeholder.style.justifyContent = "center";
        placeholder.style.padding = "8px";
        placeholder.style.textAlign = "center";
        placeholder.style.fontSize = "11px";
        placeholder.style.color = "var(--rl-text-muted, #9aa0a6)";
        placeholder.style.background = "linear-gradient(135deg, #232730 0%, #171920 100%)";
        placeholder.textContent = item.name ? (item.name.length > 10 ? item.name.slice(0, 10) + "…" : item.name) : "动画档案";

        if (coverSrc) {
          const img = this.createElSafe(cardItem, "img", "overview-card-poster");
          img.src = coverSrc;
          img.onerror = () => {
            img.style.display = "none";
            placeholder.style.display = "flex";
          };
        }

        const meta = this.createElSafe(cardItem, "div", "overview-card-meta");
        this.createElSafe(meta, "div", "overview-card-name", item.name || "未命名");
        const badges = this.createElSafe(meta, "div", "overview-card-badges");
        this.createElSafe(badges, "span", "", item.collectionStatus || item.state || "在看");
        const scoreVal = item.personalScore || item.bangumiScore || "-";
        this.createElSafe(badges, "span", "", `★ ${scoreVal}`);

        cardItem.onclick = () => {
          this.closeOverviewDrawer();
          const targetIndex = i;
          const cardRow = Math.floor(targetIndex / this.cols);
          const maxRailOffset = Math.max(0, (this.rowCount - 1) * ROW_SPACING);
          this.targetRailOffset = Math.min(maxRailOffset, Math.max(0, cardRow * ROW_SPACING));
          this.savedArrayRailOffset = this.targetRailOffset;
          this.ensureCardsForCurrentView();
          this.updateNavCountUi();
          this.safeSetTimeout(() => {
            if (!this.isDestroyed) {
              this.selectCard(targetIndex);
            }
          }, 320);
          this.wakeUp();
        };
      }
    };

    renderList();

    searchInput.oninput = () => {
      renderList(searchInput.value);
    };

    this.wakeUp();
  }

  closeOverviewDrawer() {
    if (this.overviewDrawerEl) {
      if (this.overviewDrawerEl.parentElement) {
        this.overviewDrawerEl.parentElement.removeChild(this.overviewDrawerEl);
      }
      this.overviewDrawerEl = null;
      this.wakeUp();
    }
  }

  // ==========================================
  // 3D 动效偏好设置弹窗 (Motion Settings Modal)
  // ==========================================
  toggleMotionSettingsModal() {
    if (this.motionModalEl) {
      this.closeMotionSettingsModal();
      return;
    }
    this.closeOverviewDrawer();
    if (this.searchDrop) this.searchDrop.style.display = "none";

    const modal = this.createElSafe(this.rootEl, "div", "bangumi-3d-motion-modal");
    this.motionModalEl = modal;

    const title = this.createElSafe(modal, "div", "motion-modal-title");
    title.innerHTML = "<span>3D 动效偏好设置</span>";
    const closeBtn = this.createElSafe(title, "button", "bangumi-3d-btn", "✕");
    closeBtn.style.minHeight = "24px";
    closeBtn.style.padding = "2px 8px";
    closeBtn.onclick = () => this.closeMotionSettingsModal();

    const options = [
      { key: "ripple", label: "选中卡片波纹" },
      { key: "idleWave", label: "闲置起伏 (关闭可在 1.5s 快速休眠)" },
      { key: "parallax", label: "鼠标悬停指针视差" },
      { key: "inertia", label: "拖拽旋转惯性" },
      { key: "transition", label: "镜头与详情过渡动画" }
    ];

    for (const opt of options) {
      const row = this.createElSafe(modal, "div", "motion-setting-row");
      const label = this.createElSafe(row, "label", "", opt.label);
      label.style.cursor = "pointer";
      label.style.flex = "1";

      const chk = this.createElSafe(row, "input", "motion-toggle-input");
      chk.type = "checkbox";
      chk.checked = !!this.motionSettings[opt.key];

      chk.onchange = async () => {
        this.motionSettings[opt.key] = chk.checked;
        await saveMotionSettings(this.plugin, this.motionSettings);
        this.updateStatusPill();
        this.wakeUp();
      };
      label.onclick = () => {
        chk.checked = !chk.checked;
        chk.onchange();
      };
    }
    this.wakeUp();
  }

  closeMotionSettingsModal() {
    if (this.motionModalEl) {
      if (this.motionModalEl.parentElement) {
        this.motionModalEl.parentElement.removeChild(this.motionModalEl);
      }
      this.motionModalEl = null;
      this.wakeUp();
    }
  }

  // ==========================================
  // 三维全息 Netaba 评分趋势舞台 (focusStageGroup)
  // 严格跟随当前焦点卡片的世界位置，禁止混用局部 basePos
  // ==========================================
  async openTrendStage(item, cardData) {
    this.closeTrendStage();

    // 焦点抽出卡片的目标世界坐标
    const focusWorldX = cardData.basePos.x - 1.45;
    const focusWorldY = CARD_BASE_Y + 0.95;
    const focusWorldZ = cardData.basePos.z + this.targetRailOffset + 1.2;

    // 舞台严格对齐到焦点卡片右后侧世界空间
    const stageWidth = 6.4;
    const stageDepth = 3.0;
    this.trendStageGroup.position.set(focusWorldX + 3.8, 0.22, focusWorldZ - 0.45);
    this.trendStageGroup.rotation.set(0, 0, 0);

    // 1. 细金属边框 + 深色亚克力薄面 (绝不使用厚重大灰盒)
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x242830,
      metalness: 0.82,
      roughness: 0.28
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x12151b,
      metalness: 0.35,
      roughness: 0.30,
      transparent: true,
      opacity: 0.82
    });

    const stagePlate = new THREE.Mesh(new THREE.BoxGeometry(stageWidth, 0.04, stageDepth), baseMat);
    this.trendStageGroup.add(stagePlate);

    const edgeThickness = 0.04;
    const edgeH = 0.05;
    for (const [ox, oz, sx, sz] of [
      [0, -stageDepth / 2, stageWidth, edgeThickness],
      [0, stageDepth / 2, stageWidth, edgeThickness],
      [-stageWidth / 2, 0, edgeThickness, stageDepth],
      [stageWidth / 2, 0, edgeThickness, stageDepth]
    ]) {
      const eMesh = new THREE.Mesh(new THREE.BoxGeometry(sx, edgeH, sz), frameMat);
      eMesh.position.set(ox, 0.005, oz);
      this.trendStageGroup.add(eMesh);
    }

    // 4 条横向细参考线
    const gridLines = [];
    for (let g = 0; g < 4; g++) {
      const gz = -stageDepth / 2 + (g + 0.5) * (stageDepth / 4);
      gridLines.push(new THREE.Vector3(-stageWidth / 2 + 0.1, 0.03, gz), new THREE.Vector3(stageWidth / 2 - 0.1, 0.03, gz));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridLines);
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x3d4452,
      transparent: true,
      opacity: 0.55
    });
    this.trendStageGroup.add(new THREE.LineSegments(gridGeo, gridMat));

    this.trendGrow.value = 0;
    this.trendGrow.velocity = 0;

    this.trendRequestId = (this.trendRequestId || 0) + 1;
    const currentReqId = this.trendRequestId;

    if (!item.subjectId) {
      if (this.hudTrendBox) {
        this.hudTrendBox.innerHTML = "";
        this.createElSafe(this.hudTrendBox, "div", "bangumi-trend-empty", "暂无关联 Bangumi 条目 ID。");
      }
      this.wakeUp();
      return;
    }

    if (netabaTrendService?.fetchSubjectTrendData) {
      try {
        const raw = await netabaTrendService.fetchSubjectTrendData(this.app, item.subjectId);
        if (this.isDestroyed || this.trendRequestId !== currentReqId) return;

        const norm = netabaTrendService.normalizeTrendData(raw, item.personalScore);
        const safeNorm = sanitizeTrendData(norm);
        if (this.isDestroyed || this.trendRequestId !== currentReqId) return;

        if (safeNorm && safeNorm.allPoints && safeNorm.allPoints.length > 0) {
          this.build3DTrendElements(safeNorm, stageWidth, stageDepth);
          this.renderNativeTrendSvgSafe(safeNorm);
        } else {
          if (this.hudTrendBox) {
            this.hudTrendBox.innerHTML = "";
            this.createElSafe(this.hudTrendBox, "div", "bangumi-trend-empty", "暂无历史趋势评分数据。");
          }
        }
      } catch (e) {
        if (this.isDestroyed || this.trendRequestId !== currentReqId) return;
        if (this.hudTrendBox) {
          this.hudTrendBox.innerHTML = "";
          this.createElSafe(
            this.hudTrendBox,
            "div",
            "bangumi-trend-empty",
            `读取 Netaba 评分趋势失败: ${e.message || "网络或接口超时"}`
          );
        }
      }
    }

    this.wakeUp();
  }

  build3DTrendElements(normData, width = 6.4, depth = 3.0) {
    if (!normData?.airingPoints || normData.airingPoints.length === 0) return;

    const points = normData.airingPoints;
    const minMax = normData.airingMinMax || { min: 5, max: 9.5 };
    const tMin = points[0].timestamp;
    const tMax = points[points.length - 1].timestamp;
    const tSpan = Math.max(86400000, tMax - tMin); // 至少 1 天，防除以 0
    const sMin = minMax.min;
    const sMax = minMax.max;
    const sSpan = Math.max(0.1, sMax - sMin);
    const maxHeight = 2.05;
    const baseY = 0.03;

    // 单个打分点安全显示 (单点发光立柱，避免 CatmullRom 报错)
    if (points.length === 1) {
      const p = points[0];
      const scoreRatio = (p.score - sMin) / sSpan;
      const py = baseY + scoreRatio * maxHeight;
      const colGeo = new THREE.CylinderGeometry(0.04, 0.04, py - baseY, 8);
      const colMat = new THREE.MeshStandardMaterial({
        color: 0x59c7e8,
        emissive: 0x59c7e8,
        emissiveIntensity: 0.35,
        roughness: 0.3,
        metalness: 0.5
      });
      const colMesh = new THREE.Mesh(colGeo, colMat);
      colMesh.position.set(0, (py + baseY) / 2, 0);
      this.trendStageGroup.add(colMesh);
      return;
    }

    const lineVectors = [];
    const ribbonVerts = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const timeRatio = (p.timestamp - tMin) / tSpan;
      const scoreRatio = (p.score - sMin) / sSpan;

      const px = -width / 2 + 0.15 + timeRatio * (width - 0.3);
      const py = baseY + scoreRatio * maxHeight;
      const pz = 0;

      lineVectors.push(new THREE.Vector3(px, py, pz));

      if (i > 0) {
        const prev = lineVectors[i - 1];
        ribbonVerts.push(prev.x, prev.y, pz, prev.x, baseY, pz, px, py, pz);
        ribbonVerts.push(px, py, pz, prev.x, baseY, pz, px, baseY, pz);
      }
    }

    // 1. 青蓝色立体评分曲线 (color = 0x59c7e8, emissiveIntensity <= 0.35)
    if (this.perfMode === "low") {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(lineVectors);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x59c7e8, linewidth: 2 });
      this.trendStageGroup.add(new THREE.Line(lineGeo, lineMat));
    } else {
      const curve = new THREE.CatmullRomCurve3(lineVectors, false, "centripetal");
      this.trendCurve = curve;
      const radius = this.perfMode === "high" ? 0.030 : 0.024;
      const segments = this.perfMode === "high" ? 8 : 6;
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(20, points.length * 3), radius, segments, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x59c7e8,
        emissive: 0x59c7e8,
        emissiveIntensity: 0.32,
        roughness: 0.25,
        metalness: 0.4
      });
      this.trendStageGroup.add(new THREE.Mesh(tubeGeo, tubeMat));

      // 极致画质：最多 3 个小流光点
      if (this.perfMode === "high") {
        this.trendStreamers = [];
        const sphereGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let s = 0; s < 3; s++) {
          const sMesh = new THREE.Mesh(sphereGeo, sphereMat);
          this.trendStageGroup.add(sMesh);
          this.trendStreamers.push({
            mesh: sMesh,
            offset: s * 0.33
          });
        }
      }
    }

    // 2. 半透明发光 Ribbon 能量带 (opacity <= 0.12)
    if (ribbonVerts.length > 0) {
      const ribbonGeo = new THREE.BufferGeometry();
      ribbonGeo.setAttribute("position", new THREE.Float32BufferAttribute(ribbonVerts, 3));
      const ribbonMat = new THREE.MeshBasicMaterial({
        color: 0x59c7e8,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.trendStageGroup.add(new THREE.Mesh(ribbonGeo, ribbonMat));
    }

    // 3. “我的评分”立体基准面 (color = 0xe0ab57)
    if (normData.personalScore !== null && normData.personalScore >= sMin && normData.personalScore <= sMax) {
      const pRatio = (normData.personalScore - sMin) / sSpan;
      const py = baseY + pRatio * maxHeight;

      const planeGeo = new THREE.PlaneGeometry(width, depth);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0xe0ab57,
        transparent: true,
        opacity: 0.10,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);
      planeMesh.rotation.x = -Math.PI / 2;
      planeMesh.position.set(0, py, 0);
      this.trendStageGroup.add(planeMesh);

      const bPoints = [
        new THREE.Vector3(-width / 2, py, -depth / 2),
        new THREE.Vector3(width / 2, py, -depth / 2),
        new THREE.Vector3(width / 2, py, depth / 2),
        new THREE.Vector3(-width / 2, py, depth / 2),
        new THREE.Vector3(-width / 2, py, -depth / 2)
      ];
      const bGeo = new THREE.BufferGeometry().setFromPoints(bPoints);
      const bMat = new THREE.LineBasicMaterial({ color: 0xe0ab57, linewidth: 2 });
      this.trendStageGroup.add(new THREE.Line(bGeo, bMat));
    }

    // 4. 分集首播日垂直标尺细柱
    if (normData.eps && normData.eps.length > 0) {
      const pillarPts = [];
      const epsSample = normData.eps.length > 24 ? this.sampleArray(normData.eps, 24) : normData.eps;
      for (const ep of epsSample) {
        if (!ep.timestamp || ep.timestamp < tMin || ep.timestamp > tMax) continue;
        const ex = -width / 2 + 0.15 + ((ep.timestamp - tMin) / tSpan) * (width - 0.3);
        pillarPts.push(new THREE.Vector3(ex, baseY, 0), new THREE.Vector3(ex, baseY + 0.75, 0));
      }
      if (pillarPts.length > 0) {
        const pGeo = new THREE.BufferGeometry().setFromPoints(pillarPts);
        const pMat = new THREE.LineSegments(
          pGeo,
          new THREE.LineBasicMaterial({ color: 0x8a9ba8, transparent: true, opacity: 0.35 })
        );
        this.trendStageGroup.add(pMat);
      }
    }
  }

  sampleArray(arr, max) {
    if (arr.length <= max) return arr;
    const step = (arr.length - 1) / (max - 1);
    const result = [];
    for (let i = 0; i < max; i++) {
      result.push(arr[Math.round(i * step)]);
    }
    return result;
  }

  closeTrendStage() {
    this.trendCurve = null;
    this.trendStreamers = [];
    if (this.trendStageGroup) {
      while (this.trendStageGroup.children.length > 0) {
        const o = this.trendStageGroup.children[0];
        this.trendStageGroup.remove(o);
        this.disposeObject3D(o);
      }
    }
  }

  // ==========================================
  // 右侧详情 HUD 渲染 (保持类名契约)
  // ==========================================
  renderHud(item) {
    this.clearHud();
    const panel = this.createElSafe(this.hudLayer, "div", "bangumi-3d-hud-panel");

    const eyebrow = this.createElSafe(panel, "div", "hud-eyebrow");
    eyebrow.textContent = `BANGUMI ARCHIVE FILE · #${item.subjectId || "N/A"}`;

    const titleEl = this.createElSafe(panel, "h2", "hud-title");
    titleEl.textContent = `《${item.name}》`;

    const subEl = this.createElSafe(panel, "div", "hud-sub");
    subEl.textContent = `${item.japaneseName || ""} · ${item.year || "未知"} ${item.season || ""}`;

    const scoreRow = this.createElSafe(panel, "div", "hud-score-row");
    if (item.personalScore !== null && item.personalScore !== undefined) {
      this.createElSafe(scoreRow, "span", "hud-pill is-personal", `我的评分 ★ ${Number(item.personalScore).toFixed(1)}`);
    }
    if (item.bangumiScore !== null && item.bangumiScore !== undefined) {
      this.createElSafe(scoreRow, "span", "hud-pill is-bgm", `BGM均分 ${Number(item.bangumiScore).toFixed(1)}`);
    }
    this.createElSafe(scoreRow, "span", "hud-pill is-state", item.state || "在看");

    const progressRow = this.createElSafe(panel, "div", "hud-progress-row");
    const watchedNum = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    this.createElSafe(
      progressRow,
      "span",
      "hud-ep-label",
      `追番进度：${watchedNum} / ${totalNum > 0 ? totalNum : "?"} 话`
    );

    const btnInc = this.createElSafe(progressRow, "button", "hud-action-btn", "已看 +1 话");
    btnInc.onclick = async () => {
      if (btnInc.disabled) return;
      btnInc.disabled = true;
      const originalText = btnInc.textContent;
      btnInc.textContent = "更新中...";

      try {
        const next = watchedNum + 1;
        let success = false;
        if (this.plugin?.quickUpdateAnimeNote) {
          success = await this.plugin.quickUpdateAnimeNote(item, { watchedEpisodes: next });
        }
        if (success) {
          item.watchedEpisodes = next;
          this.renderHud(item);
          this.wakeUp();
        } else {
          btnInc.textContent = "更新失败";
          this.safeSetTimeout(() => {
            if (!this.isDestroyed && btnInc.parentElement) {
              btnInc.textContent = originalText;
              btnInc.disabled = false;
            }
          }, 1200);
        }
      } catch (err) {
        btnInc.textContent = "更新失败";
        this.safeSetTimeout(() => {
          if (!this.isDestroyed && btnInc.parentElement) {
            btnInc.textContent = originalText;
            btnInc.disabled = false;
          }
        }, 1200);
      }
    };

    if (item.downloadPath && item.downloadPath !== "无" && typeof inspectLocalFolder === "function") {
      try {
        const localInfo = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
        if (localInfo && !localInfo.error && localInfo.fileCount > 0) {
          const localBar = this.createElSafe(panel, "div", "hud-local-bar");
          if (localInfo.nextEpisodeFile) {
            const nextEp = localInfo.nextEpisodeNumber || watchedNum + 1;
            const playBtn = this.createElSafe(localBar, "button", "hud-action-btn is-primary", `▶ 播放第 ${nextEp} 话`);
            playBtn.onclick = async () => {
              if (typeof openLocalPathSafely === "function") {
                await openLocalPathSafely(localInfo.nextEpisodeFile);
              }
            };
          }
          const openFolderBtn = this.createElSafe(localBar, "button", "hud-action-btn", "📂 打开本地目录");
          openFolderBtn.onclick = async () => {
            if (typeof openLocalPathSafely === "function") {
              await openLocalPathSafely(item.downloadPath);
            }
          };
        }
      } catch (e) {}
    }

    this.hudTrendBox = this.createElSafe(panel, "div", "hud-trend-box");
    if (!item.subjectId) {
      this.createElSafe(this.hudTrendBox, "div", "bangumi-trend-empty", "暂无关联 Bangumi 条目 ID。");
    } else {
      this.createElSafe(this.hudTrendBox, "div", "bangumi-trend-empty", "历史趋势数据载入中…");
    }

    const footerActions = this.createElSafe(panel, "div", "hud-footer-actions");
    if (item.file && this.app?.workspace?.openLinkText) {
      const noteBtn = this.createElSafe(footerActions, "button", "hud-action-btn is-primary", "📝 打开动画笔记");
      noteBtn.onclick = () => this.app.workspace.openLinkText(item.file.path, "", false);
    }

    const closeBtn = this.createElSafe(panel, "button", "hud-close-btn", "← 返回海报阵列 (Esc)");
    closeBtn.onclick = () => this.deselectCard();
  }

  renderNativeTrendSvgSafe(normData) {
    if (!this.hudTrendBox || !normData || !netabaTrendService?.renderNativeTrendSvg) return;
    this.hudTrendBox.innerHTML = "";
    try {
      netabaTrendService.renderNativeTrendSvg(this.hudTrendBox, normData);
    } catch (e) {
      this.createElSafe(this.hudTrendBox, "div", "bangumi-trend-empty", "趋势图渲染异常。");
    }
  }

  clearHud() {
    this.hudTrendBox = null;
    if (this.hudLayer) {
      if (typeof this.hudLayer.empty === "function") {
        this.hudLayer.empty();
      } else {
        this.hudLayer.innerHTML = "";
      }
    }
  }

  // ==========================================
  // ==========================================
  // 主渲染循环与二阶物理阻尼
  // ==========================================
  startLoop() {
    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.lastTime = typeof performance !== "undefined" ? performance.now() : Date.now();

    const loop = (time) => {
      if (this.isDestroyed) return;

      // 页面后台或视图隐藏时停止渲染
      if (typeof document !== "undefined" && document.hidden) {
        this.isSleeping = true;
        this.updateStatusPill();
        this.rafId = null;
        return;
      }

      const now = time || (typeof performance !== "undefined" ? performance.now() : Date.now());
      const dt = Math.min((now - this.lastTime) / 1000, 0.08);
      this.lastTime = now;

      const isMoving = this.updatePhysics(dt, now / 1000);

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }

      // 掉帧自动降级机制
      this.recentDts.push(dt);
      if (this.recentDts.length > 60) {
        this.recentDts.shift();
        const avgDt = this.recentDts.reduce((a, b) => a + b, 0) / this.recentDts.length;
        if (avgDt > 0.042 && this.perfMode !== "low") {
          console.warn("3D 档案空间检测到帧率较低，自动降级至更流畅画质档位");
          this.setPerformanceMode(this.perfMode === "high" ? "medium" : "low");
          this.recentDts = [];
        }
      }

      // 静止 1.5 秒自动休眠至 0 FPS（若开启闲置起伏，则允许持续渲染并明确显示状态）
      if (!isMoving && !this.isDragging) {
        this.idleTime += dt;
        if (this.idleTime >= 1.5 && (!this.motionSettings || !this.motionSettings.idleWave)) {
          this.isSleeping = true;
          this.updateStatusPill();
          this.rafId = null;
          return;
        }
      } else {
        this.idleTime = 0;
      }

      if (typeof requestAnimationFrame === "function") {
        this.rafId = requestAnimationFrame(loop);
      }
    };

    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(loop);
    }
  }

  updatePhysics(dt, clockTime) {
    this.clock = clockTime;
    this.interactionAge += dt;
    let hasMotion = false;

    const transitionRate = (this.motionSettings && this.motionSettings.transition === false) ? 999 : 7.0;
    const railRate = (this.motionSettings && this.motionSettings.transition === false) ? 999 : 6.5;
    const rotRate = (this.motionSettings && this.motionSettings.inertia === false) ? 999 : 9.0;
    const cardDampRate = (this.motionSettings && this.motionSettings.transition === false) ? 999 : 7.5;

    // 1. 档案墙整体滑动阻尼 (整个 archiveWallGroup 沿 Z 轴移动)
    damp(this.railOffset, this.targetRailOffset, railRate, dt);
    this.archiveWallGroup.position.z = this.railOffset.value;
    if (Math.abs(this.railOffset.value - this.targetRailOffset) > 0.005 || Math.abs(this.railOffset.velocity) > 0.005) {
      hasMotion = true;
    }

    // 2. 焦点与动画阶段过渡
    damp(this.focusAnim, this.targetFocusAnim, transitionRate, dt);
    if (Math.abs(this.focusAnim.value - this.targetFocusAnim) > 0.005) {
      hasMotion = true;
    }

    // 焦点琥珀光平滑淡入淡出
    if (this.focusAmberLight) {
      this.focusAmberLight.intensity = this.focusAnim.value * 0.65;
    }

    // 指针视差阻尼计算 (平滑归位)
    damp(this.parallaxX, this.targetParallaxX, 6.0, dt);
    damp(this.parallaxY, this.targetParallaxY, 6.0, dt);
    if (Math.abs(this.parallaxX.value - this.targetParallaxX) > 0.001 || Math.abs(this.parallaxY.value - this.targetParallaxY) > 0.001) {
      hasMotion = true;
    }

    // 3. 焦点状态下相机位置与瞄准点计算 (规范要求：由实际卡片绝对位置动态计算，绝不写死单一绝对坐标)
    let targetCamX = -16.8;
    let targetCamY = 9.6;
    let targetCamZ = 24.5;
    let targetAimX = 0;
    let targetAimY = 1.65;
    let targetAimZ = -3.2;

    const isFocusState = this.spaceState === "focus" && this.selectedIndex >= 0 && this.selectedIndex < this.cardMeshes.length;

    if (isFocusState) {
      const focusData = this.cardDataMap.get(this.cardMeshes[this.selectedIndex]);
      if (focusData) {
        // focusPosition 为卡片抽出的世界坐标
        const fPos = new THREE.Vector3(
          focusData.basePos.x - 1.45,
          focusData.basePos.y + 0.95,
          focusData.basePos.z + this.railOffset.value + 1.2
        );
        // 规范目标瞄准点：focusPosition + (1.85, 0.55, -0.25)
        targetAimX = fPos.x + 1.85;
        targetAimY = fPos.y + 0.55;
        targetAimZ = fPos.z - 0.25;

        // 规范目标相机位置：focusPosition + (-12.6, 7.0, 18.4)
        targetCamX = fPos.x - 12.6;
        targetCamY = fPos.y + 7.0;
        targetCamZ = fPos.z + 18.4;

        if (this.focusAmberLight) {
          this.focusAmberLight.position.set(fPos.x - 2.5, fPos.y + 4.0, fPos.z + 4.5);
        }
      }
    } else {
      // array 阵列态：叠加轻微指针视差与微幅呼吸
      const breatheZ = (this.interactionAge < 6.0 && this.motionSettings && this.motionSettings.idleWave)
        ? Math.sin(clockTime * 0.8) * 0.25
        : 0;
      targetCamX += this.parallaxX.value * 2.5;
      targetCamY += this.parallaxY.value * 2.0;
      targetCamZ = 24.5 + breatheZ;

      targetAimX += this.parallaxX.value * 1.5;
      targetAimY += this.parallaxY.value * 1.0;
    }

    // 相机位置与瞄准点二阶 damp 更新 (规范要求)
    damp(this.cameraPosX, targetCamX, transitionRate, dt);
    damp(this.cameraPosY, targetCamY, transitionRate, dt);
    damp(this.cameraPosZ, targetCamZ, transitionRate, dt);
    this.camera.position.set(this.cameraPosX.value, this.cameraPosY.value, this.cameraPosZ.value);

    damp(this.cameraAimX, targetAimX, transitionRate, dt);
    damp(this.cameraAimY, targetAimY, transitionRate, dt);
    damp(this.cameraAimZ, targetAimZ, transitionRate, dt);
    this.camera.lookAt(this.cameraAimX.value, this.cameraAimY.value, this.cameraAimZ.value);

    if (this.warmMainLight) {
      if (this.warmMainLight.target) {
        this.warmMainLight.target.position.set(this.cameraAimX.value, this.cameraAimY.value, this.cameraAimZ.value);
        this.warmMainLight.target.updateMatrixWorld();
      }
      this.warmMainLight.position.set(this.cameraAimX.value - 15, this.cameraAimY.value + 24, this.cameraAimZ.value + 16);
    }

    if (
      Math.abs(this.cameraPosX.value - targetCamX) > 0.005 ||
      Math.abs(this.cameraPosY.value - targetCamY) > 0.005 ||
      Math.abs(this.cameraPosZ.value - targetCamZ) > 0.005 ||
      Math.abs(this.cameraAimX.value - targetAimX) > 0.005 ||
      Math.abs(this.cameraAimY.value - targetAimY) > 0.005 ||
      Math.abs(this.cameraAimZ.value - targetAimZ) > 0.005
    ) {
      hasMotion = true;
    }

    // 4. 滚轮缩放阻尼
    damp(this.cameraZoom, this.targetZoom, transitionRate, dt);
    if (Math.abs(this.cameraZoom.value - this.targetZoom) > 0.005) {
      this.camera.zoom = this.cameraZoom.value;
      this.camera.updateProjectionMatrix();
      hasMotion = true;
    }

    // 5. 焦点卡片打量旋转与倾斜阻尼
    damp(this.cardRotation, this.targetCardRotation, rotRate, dt);
    damp(this.cardTilt, this.targetCardTilt, rotRate, dt);
    if (Math.abs(this.cardRotation.value - this.targetCardRotation) > 0.005 || Math.abs(this.cardRotation.velocity) > 0.01) {
      hasMotion = true;
    }
    if (Math.abs(this.cardTilt.value - this.targetCardTilt) > 0.005 || Math.abs(this.cardTilt.velocity) > 0.01) {
      hasMotion = true;
    }

    // 6. 趋势舞台生长与流光点 (交互 6 秒后停止以进入休眠)
    damp(this.trendGrow, 1.0, transitionRate, dt);
    if (Math.abs(this.trendGrow.value - 1.0) > 0.005) {
      this.trendStageGroup.scale.set(1.0, Math.max(0.01, this.trendGrow.value), 1.0);
      hasMotion = true;
    }

    if (this.trendStreamers.length > 0 && this.trendCurve && this.interactionAge < 6.0) {
      const speed = 0.35;
      for (const st of this.trendStreamers) {
        const t = ((clockTime * speed + st.offset) % 1.0 + 1.0) % 1.0;
        const pt = this.trendCurve.getPointAt(t);
        if (pt) st.mesh.position.copy(pt);
      }
      hasMotion = true;
    }

    // 7. 每张卡片全独立物理弹簧阻尼状态更新 (正向 targetRailOffset，以屏幕目标行实际投影为准)
    const targetRow = Math.min(
      this.rowCount - 1,
      Math.max(0, Math.round(this.targetRailOffset / ROW_SPACING))
    );

    let focusCol = 0;
    if (isFocusState) {
      const focusData = this.cardDataMap.get(this.cardMeshes[this.selectedIndex]);
      if (focusData) focusCol = focusData.col;
    }

    for (let i = 0; i < this.cardMeshes.length; i++) {
      const hitMesh = this.cardMeshes[i];
      const data = this.cardDataMap.get(hitMesh);
      if (!data) continue;

      let waveH = 0;

      // 波纹扩散 (受 ripple 开关控制)
      if (!this.motionSettings || this.motionSettings.ripple) {
        for (let pIdx = this.wavePulses.length - 1; pIdx >= 0; pIdx--) {
          const pulse = this.wavePulses[pIdx];
          const age = clockTime - pulse.time;
          if (age > 2.0) {
            this.wavePulses.splice(pIdx, 1);
            continue;
          }
          const dist = Math.hypot(data.col - pulse.col, data.row - pulse.row);
          waveH += 0.85 * bell(dist - age * 4.5, 1.0) * Math.exp(-age * 1.6);
          hasMotion = true;
        }
      }

      // 闲置起伏 (受 idleWave 开关控制)
      if (this.motionSettings && this.motionSettings.idleWave && !isFocusState) {
        waveH += idleWave(data.col, data.row, clockTime);
        hasMotion = true;
      } else if (this.perfMode === "high" && !isFocusState && this.interactionAge < 6.0 && (!this.motionSettings || this.motionSettings.ripple)) {
        waveH += idleWave(data.col, data.row, clockTime);
        hasMotion = true;
      }

      // 三层可见策略参数计算（行距差）
      const rowDiff = Math.abs(data.row - targetRow);

      let targetPosX = data.basePos.x;
      let targetPosY = CARD_BASE_Y;
      let targetPosZ = data.basePos.z; // 相对于 archiveWallGroup 局部坐标
      let targetRotX = -0.06;
      let targetRotY = 0.16;
      let targetScaleVal = 1.0;
      let targetBrightness = 1.0;

      if (isFocusState) {
        if (data.index === this.selectedIndex) {
          // 焦点卡片：移至左侧三分之一，上浮 0.95，尺寸放大 1.08，前移抽出 1.2
          targetPosX = data.basePos.x - 1.45;
          targetPosY = CARD_BASE_Y + 0.95;
          targetPosZ = data.basePos.z + 1.2;
          targetRotX = this.cardTilt.value;
          targetRotY = this.cardRotation.value;
          targetScaleVal = 1.08;
          targetBrightness = 1.0;
        } else {
          // 非焦点卡片：后退 -2.6，侧移 0.85，缩放至 0.82，亮度降低退隐
          const deltaCol = data.col - focusCol;
          const pushX = deltaCol < 0 ? -0.85 : 0.85;
          targetPosX = data.basePos.x + pushX;
          targetPosY = CARD_BASE_Y + Math.max(0, waveH);
          targetPosZ = data.basePos.z - 2.6;
          targetRotX = -0.06;
          targetRotY = 0.16;
          targetScaleVal = 0.82;
          targetBrightness = 0.50;
        }
      } else {
        // array 阵列态：三层可见策略
        if (rowDiff === 0) {
          // 前景：当前行 (最多 6 张)，最大尺寸，最高亮度与对比度
          targetScaleVal = 1.0;
          targetBrightness = 1.0;
        } else if (rowDiff <= 2) {
          // 中景：相邻 1~2 行，缩小封面，仍可辨认颜色与标题
          targetScaleVal = Math.max(0.85, 1.0 - rowDiff * 0.08);
          targetBrightness = Math.max(0.55, 1.0 - rowDiff * 0.22);
        } else {
          // 远景：更远档案，窄书脊，深度雾化退隐
          targetScaleVal = 0.72;
          targetBrightness = 0.35;
        }
        targetPosY = CARD_BASE_Y + Math.max(0, waveH);
      }

      // 通过独立 damp 更新弹簧物理状态
      damp(data.positionX, targetPosX, cardDampRate, dt);
      damp(data.positionY, targetPosY, cardDampRate, dt);
      damp(data.positionZ, targetPosZ, cardDampRate, dt);
      damp(data.rotationX, targetRotX, cardDampRate, dt);
      damp(data.rotationY, targetRotY, cardDampRate, dt);
      damp(data.scale, targetScaleVal, cardDampRate, dt);
      damp(data.brightness, targetBrightness, cardDampRate, dt);

      // 将物理计算结果写入 Group
      data.group.position.set(data.positionX.value, data.positionY.value, data.positionZ.value);
      data.group.rotation.set(data.rotationX.value, data.rotationY.value, 0);
      data.group.scale.set(data.scale.value, data.scale.value, data.scale.value);

      this.applyCardVisibility(data, data.brightness.value);

      if (Math.abs(data.positionX.value - targetPosX) > 0.005) hasMotion = true;
      if (Math.abs(data.positionY.value - targetPosY) > 0.005) hasMotion = true;
      if (Math.abs(data.positionZ.value - targetPosZ) > 0.005) hasMotion = true;
      if (Math.abs(data.scale.value - targetScaleVal) > 0.005) hasMotion = true;
      if (Math.abs(data.brightness.value - targetBrightness) > 0.01) hasMotion = true;
    }

    return hasMotion;
  }

  // ==========================================
  // 显存与事件彻底释放 (Destroy)
  // ==========================================
  disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
  }

  destroy() {
    this.isDestroyed = true;
    this.trendRequestId = (this.trendRequestId || 0) + 1;

    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // 清理所有待触发定时器
    for (const tid of this.activeTimeouts) {
      clearTimeout(tid);
    }
    this.activeTimeouts.clear();

    // 关闭抽屉与弹窗
    this.closeOverviewDrawer();
    this.closeMotionSettingsModal();

    // 移除视口元素监听
    if (this.viewportEl) {
      if (this.boundPointerMove) this.viewportEl.removeEventListener("pointermove", this.boundPointerMove);
      if (this.boundPointerLeave) this.viewportEl.removeEventListener("pointerleave", this.boundPointerLeave);
      if (this.boundPointerDown) this.viewportEl.removeEventListener("pointerdown", this.boundPointerDown);
      if (this.boundWheel) this.viewportEl.removeEventListener("wheel", this.boundWheel);
    }

    // 移除 window 监听
    if (typeof window !== "undefined") {
      if (this.boundPointerUp) window.removeEventListener("pointerup", this.boundPointerUp);
      if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    }

    // 移除 document 监听
    if (typeof document !== "undefined") {
      if (this.boundDocPointerDown) document.removeEventListener("pointerdown", this.boundDocPointerDown);
      if (this.visHandler) document.removeEventListener("visibilitychange", this.visHandler);
    }

    // 释放 ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 释放环境贴图
    if (this.currentEnvTexture) {
      this.currentEnvTexture.dispose();
      this.currentEnvTexture = null;
    }

    // 释放所有已缓存纹理
    for (const tex of this.textureCache.values()) {
      if (tex && typeof tex.dispose === "function") tex.dispose();
    }
    this.textureCache.clear();

    // 彻底释放 Three.js 场景对象树
    if (this.scene) {
      this.disposeObject3D(this.scene);
    }

    // 释放渲染器与 DOM 节点
    if (this.renderer) {
      if (typeof this.renderer.dispose === "function") this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
    }

    if (this.container) {
      if (typeof this.container.empty === "function") {
        this.container.empty();
      } else {
        this.container.innerHTML = "";
      }
    }
  }
}

module.exports = {
  Dashboard3DSpace
};
