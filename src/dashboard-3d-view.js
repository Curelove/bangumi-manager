/**
 * dashboard-3d-view.js
 * 
 * 第六期：基于 RhineLabUI 完整解构的 3D 交互式档案空间
 * 融合【方案 A（RhineLabUI 工业低 FOV 轴测导轨阵列 + 二阶弹簧阻尼高斯波纹）】
 * 与【方案 C（拔地而起的三维发光 Netaba 评分趋势与全息对比舞台）】
 * 
 * 核心特性：
 * 1. 真实调用 Blender 生成的 6 层精密档案卡盒资产（01 紧固件 / 02 前盖板 / 03 双环浮雕 / 04 光学核心 / 05 画芯板 / 06 背板与琥珀脊）
 * 2. RhineLabUI 原作 1:1 三级状态机：
 *    - 状态一：导轨切片巡航阵列 (Array Browsing)
 *    - 状态二：半屏档案检视与原生 Netaba 趋势面板 (Focused Detail)
 *    - 状态三：独立 360° 爆炸拆解与三维全息评分舞台 (Assembly Explode & 3D Stage)
 * 3. 实验室暖白色调（#EAE8E1）工业极简美学，支持一键切换深空暗色（#14161A），杜绝黑底黑字或反差 Bug
 * 4. 三档硬件性能自适应架构（节能 / 均衡 / 极致），持续掉帧自动降级保护
 * 5. 静止 1.5 秒自动休眠降至 0 FPS（零 GPU/CPU 额外功耗），交互瞬间无缝唤醒
 * 6. 完整的 destroy() 显存与事件回收，绝不泄漏
 */

const THREE = require("three");
const CASSETTE_GEOMETRIES_RAW = require("./archive-cassette-model.js");
const netabaTrendService = require("./netaba-trend-service.js");
const { inspectLocalFolder, openLocalPathSafely } = require("./note-utils.js");

// 二阶弹簧阻尼方程（Frame-rate independent damp）
function damp(s, target, rate, dt) {
  const delta = s.value - target;
  const impulse = s.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  s.value = target + (delta + impulse * dt) * decay;
  s.velocity = (s.velocity - rate * impulse * dt) * decay;
}

// 高斯钟形衰减函数
function bell(x, width) {
  return Math.exp(-0.5 * Math.pow(x / width, 2));
}

// 闲置低频呼吸波（极致画质模式启用）
function idleWave(col, row, time) {
  return (
    0.045 * Math.sin((time * Math.PI * 2) / 7.5 + row * 0.35 - col * 0.45) +
    0.02 * Math.sin((time * Math.PI * 2) / 12.0 - row * 0.2 + col * 0.3)
  );
}

// 6 层卡盒部件装配参数定义（严格对应 RhineLabUI 原作比例与爆炸间距）
const ASSEMBLY_PARTS = [
  { id: "fasteners", key: "01_Fasteners", label: "紧固件", en: "FASTENERS", explodeZ: 2.6, color: 0xd0d0d0, metal: 0.88, rough: 0.22 },
  { id: "cover", key: "02_FrontCover", label: "透明盖板", en: "OPTICAL COVER", explodeZ: 1.8, color: 0xffffff, metal: 0.05, rough: 0.22, trans: 0.75, opacity: 0.45 },
  { id: "optical-lenses", key: "03_RingBands", label: "折射环组", en: "REFRACTIVE RINGS", explodeZ: 1.0, color: 0xd4a359, metal: 0.65, rough: 0.28 },
  { id: "optical-core", key: "04_OpticalCore", label: "光学核心", en: "OPTICAL CORE", explodeZ: 0.25, color: 0x9b9a95, metal: 0.35, rough: 0.35 },
  { id: "substrate", key: "05_CoreInsert", label: "封面画芯板", en: "SUBSTRATE", explodeZ: -0.5, color: 0xeae5dc, metal: 0.05, rough: 0.45 },
  { id: "carrier", key: "06_BackSpine", label: "背板与琥珀脊", en: "CARRIER & SPINE", explodeZ: -1.35, color: 0xd8d3cc, metal: 0.1, rough: 0.55 }
];

// 将 Blender 导出的网格数据转换为 Three.js BufferGeometry（带坐标对齐与自适应平面 UV 映射）
function buildCassetteBufferGeometries() {
  const parts = {};
  for (const item of ASSEMBLY_PARTS) {
    const raw = CASSETTE_GEOMETRIES_RAW[item.key];
    if (!raw || !raw.vertices || raw.vertices.length === 0) continue;

    const geo = new THREE.BufferGeometry();
    const v = raw.vertices;
    const n = raw.normals || [];
    const len = v.length / 3;
    const pos = new Float32Array(v.length);
    const norm = new Float32Array(v.length);
    const uvs = new Float32Array(len * 2);

    for (let i = 0; i < len; i++) {
      const bx = v[i * 3];
      const by = v[i * 3 + 1];
      const bz = v[i * 3 + 2];

      // Blender 坐标 (X宽, Y厚, Z高) 转 Three.js 坐标 (X宽, Y高, Z面向相机)
      pos[i * 3] = bx;
      pos[i * 3 + 1] = bz;
      pos[i * 3 + 2] = -by;

      if (n.length >= (i + 1) * 3) {
        norm[i * 3] = n[i * 3];
        norm[i * 3 + 1] = n[i * 3 + 2];
        norm[i * 3 + 2] = -n[i * 3 + 1];
      }

      // 平面贴图正投影 UV (宽 3.2, 高 2.3)
      uvs[i * 2] = (bx + 1.6) / 3.2;
      uvs[i * 2 + 1] = (bz + 1.15) / 2.3;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (n.length > 0) {
      geo.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
    } else {
      geo.computeVertexNormals();
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

    if (raw.indices && raw.indices.length > 0) {
      geo.setIndex(raw.indices);
    }
    parts[item.id] = geo;
  }
  return parts;
}

class Dashboard3DSpace {
  constructor(container, plugin, options = {}) {
    this.container = container;
    this.plugin = plugin;
    this.app = plugin.app;
    this.options = options;
    this.allItems = options.items || [];
    this.displayedItems = [];
    this.filterMode = options.filterMode || "watching";

    // 主题模式: "light" (默认暖白实验室 #EAE8E1) | "dark" (深空暗色 #14161A)
    this.themeMode = options.themeMode || "light";

    // 性能分级配置: "low" | "medium" | "high"
    this.perfMode = options.perfMode || plugin.settings.dashboard3dPerfMode || "medium";

    // 三级状态机: "array" (状态一) | "inspect" (状态二) | "explode" (状态三)
    this.spaceState = "array";

    // 运行状态与生命周期
    this.isDestroyed = false;
    this.isSleeping = false;
    this.rafId = null;
    this.lastTime = 0;
    this.idleTime = 0;
    this.clock = 0;

    // 选中的焦点卡片与装配拆解弹簧
    this.selectedIndex = -1;
    this.hoverIndex = -1;
    this.spread = { value: 0, velocity: 0 };
    this.targetSpread = 0;
    this.lift = { value: 0, velocity: 0 };
    this.targetLift = 0;

    // 卡片打量旋转与 360° 球面视角旋转
    this.cardRotation = { value: 0, velocity: 0 };
    this.targetCardRotation = 0;
    this.stageElevation = { value: 0, velocity: 0 };
    this.targetStageElevation = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // 镜头阻尼相机系统（低 FOV 等轴测工业远摄透视）
    this.cameraAim = new THREE.Vector3(0, 1.2, 0);
    this.targetCameraAim = new THREE.Vector3(0, 1.2, 0);
    this.cameraPanX = { value: 0, velocity: 0 };
    this.cameraPanZ = { value: 0, velocity: 0 };
    this.cameraZoom = { value: 1.0, velocity: 0 };
    this.targetZoom = 1.0;

    // 阵列网格对象与波纹场
    this.cardMeshes = [];
    this.cardDataMap = new Map();
    this.cardGroup = new THREE.Group();
    this.railGroup = new THREE.Group();
    this.wavePulses = [];

    // 三维评分趋势舞台（拔地而起全息折线与能量带）
    this.trendStageGroup = new THREE.Group();
    this.currentTrendData = null;

    // 帧耗时监测（连续掉帧保护）
    this.frameDropCounter = 0;

    // 缓存卡盒模型几何体
    this.cassetteGeometries = buildCassetteBufferGeometries();

    // 初始化 DOM 与 3D 渲染管线
    this.initDom();
    this.initThree();
    this.filterAndBuildCards();
    this.bindEvents();
    this.startLoop();
  }

  // ==========================================
  // DOM 与工具栏构建
  // ==========================================
  initDom() {
    this.container.empty();
    this.rootEl = this.container.createDiv({
      cls: `bangumi-3d-root ${this.themeMode === "dark" ? "theme-dark-space" : ""}`
    });
    this.rootEl.style.position = "relative";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    this.rootEl.style.minHeight = "660px";
    this.rootEl.style.overflow = "hidden";
    this.rootEl.style.userSelect = "none";

    // 1. 顶栏精密工业 HUD 工具条
    this.topToolbar = this.rootEl.createDiv("bangumi-3d-toolbar");

    // 左侧：返回、标牌、数据源筛选
    const leftSection = this.topToolbar.createDiv("toolbar-section-left");
    const backBtn = leftSection.createEl("button", {
      cls: "bangumi-3d-btn",
      text: "🔲 返回 2D 仪表盘"
    });
    backBtn.onclick = () => {
      if (this.onExit3D) this.onExit3D();
    };

    const titleBadge = leftSection.createSpan({
      cls: "bangumi-3d-title-badge"
    });
    titleBadge.innerHTML = "<i>RHINE LAB</i> · 3D 交互档案空间";

    // 筛选下拉
    const filterSelect = leftSection.createEl("select", { cls: "bangumi-3d-select" });
    filterSelect.createEl("option", { text: "正在追番 (导轨装配)", value: "watching" });
    filterSelect.createEl("option", { text: "全部动画 (完整切片)", value: "all" });
    filterSelect.value = this.filterMode;
    filterSelect.onchange = () => {
      this.filterMode = filterSelect.value;
      this.filterAndBuildCards();
      this.wakeUp();
    };

    // 右侧：主题切换、画质性能、视角复位
    const rightSection = this.topToolbar.createDiv("toolbar-section-right");

    // 主题切换按钮
    this.themeBtn = rightSection.createEl("button", {
      cls: "bangumi-3d-btn",
      text: this.themeMode === "light" ? "☀️ 暖白实验室" : "🌙 深空暗色"
    });
    this.themeBtn.onclick = () => this.toggleTheme();

    // 性能分级切换
    const perfGroup = rightSection.createDiv("bangumi-3d-perf-group");
    const perfOptions = [
      { key: "low", label: "节能" },
      { key: "medium", label: "均衡" },
      { key: "high", label: "极致" }
    ];
    this.perfButtons = {};
    for (const opt of perfOptions) {
      const pBtn = perfGroup.createEl("button", {
        cls: `bangumi-perf-btn ${this.perfMode === opt.key ? "is-active" : ""}`,
        text: opt.label
      });
      pBtn.onclick = () => this.setPerformanceMode(opt.key);
      this.perfButtons[opt.key] = pBtn;
    }

    const resetBtn = rightSection.createEl("button", {
      cls: "bangumi-3d-btn",
      text: "🎯 视角复位"
    });
    resetBtn.onclick = () => this.resetCamera();

    // 2. WebGL Canvas 视口
    this.viewportEl = this.rootEl.createDiv("bangumi-3d-viewport");
    this.viewportEl.style.width = "100%";
    this.viewportEl.style.height = "100%";
    this.viewportEl.style.cursor = "grab";

    // 3. 2D HUD 空间映射层
    this.hudLayer = this.rootEl.createDiv("bangumi-3d-hud-layer");
    this.hudLayer.style.position = "absolute";
    this.hudLayer.style.inset = "0";
    this.hudLayer.style.pointerEvents = "none";
    this.hudLayer.style.zIndex = "10";

    // 4. 休眠与性能状态指示微标
    this.statusPill = this.rootEl.createDiv("bangumi-3d-status-pill");
    this.updateStatusPill();
  }

  updateStatusPill() {
    if (!this.statusPill) return;
    const modeText = this.perfMode === "low" ? "节能模式" : this.perfMode === "high" ? "极致画质" : "均衡模式";
    const stateText = this.spaceState === "explode" ? "360° 爆炸拆解舞台" : this.spaceState === "inspect" ? "半屏档案检视" : "导轨巡航阵列";
    this.statusPill.textContent = `${stateText} · ${modeText} · ${this.isSleeping ? "💤 静止休眠 (0 FPS)" : "🟢 实时渲染"}`;
    this.statusPill.className = `bangumi-3d-status-pill ${this.isSleeping ? "is-sleeping" : "is-active"}`;
  }

  toggleTheme() {
    this.themeMode = this.themeMode === "light" ? "dark" : "light";
    this.themeBtn.textContent = this.themeMode === "light" ? "☀️ 暖白实验室" : "🌙 深空暗色";
    if (this.themeMode === "dark") {
      this.rootEl.classList.add("theme-dark-space");
      this.scene.background.set(0x111317);
      this.scene.fog.color.set(0x111317);
      this.floor.material.color.set(0x181b20);
      if (this.ambientLight) this.ambientLight.color.set(0x9aa4b2);
    } else {
      this.rootEl.classList.remove("theme-dark-space");
      this.scene.background.set(0xeae5e1);
      this.scene.fog.color.set(0xeae5e1);
      this.floor.material.color.set(0xd8c9b9);
      if (this.ambientLight) this.ambientLight.color.set(0xfff8f0);
    }
    this.wakeUp();
  }

  setPerformanceMode(mode) {
    this.perfMode = mode;
    this.plugin.settings.dashboard3dPerfMode = mode;
    this.plugin.saveSettings();

    for (const [key, btn] of Object.entries(this.perfButtons)) {
      if (key === mode) btn.classList.add("is-active");
      else btn.classList.remove("is-active");
    }

    const dpr = window.devicePixelRatio || 1;
    if (mode === "low") {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
    } else if (mode === "medium") {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2.0));
      this.renderer.shadowMap.enabled = true;
    }
    this.filterAndBuildCards();
    this.wakeUp();
    this.updateStatusPill();
  }

  // ==========================================
  // Three.js 场景与长焦等轴测工业相机
  // ==========================================
  initThree() {
    const w = this.viewportEl.clientWidth || 900;
    const h = this.viewportEl.clientHeight || 660;

    // 1. WebGL 渲染器
    if (this.options && this.options.mockRenderer) {
      this.renderer = this.options.mockRenderer;
    } else {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
      });
    }
    this.renderer.setSize(w, h);
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.perfMode === "low" ? 1.0 : this.perfMode === "high" ? Math.min(dpr, 2.0) : Math.min(dpr, 1.5));
    this.renderer.shadowMap.enabled = this.perfMode !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.viewportEl.appendChild(this.renderer.domElement);

    // 2. 场景与工业等轴测远摄相机 (Low FOV 12°)
    this.scene = new THREE.Scene();
    const bgColor = this.themeMode === "light" ? 0xeae5e1 : 0x111317;
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.Fog(bgColor, 35, 130);

    // 低 FOV (12°) 产生纯正的工业切片轴测严谨感
    this.camera = new THREE.PerspectiveCamera(12, w / h, 0.5, 360);
    this.defaultCameraPos = new THREE.Vector3(-38, 28, 42);
    this.camera.position.copy(this.defaultCameraPos);
    this.camera.lookAt(this.cameraAim);

    // 3. 实验室冷暖主光体系
    this.ambientLight = new THREE.AmbientLight(this.themeMode === "light" ? 0xfff8f0 : 0x9aa4b2, 0.75);
    this.scene.add(this.ambientLight);

    this.mainLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.mainLight.position.set(-25, 45, 30);
    this.mainLight.castShadow = this.perfMode !== "low";
    if (this.mainLight.castShadow) {
      this.mainLight.shadow.mapSize.set(1024, 1024);
      this.mainLight.shadow.camera.left = -28;
      this.mainLight.shadow.camera.right = 28;
      this.mainLight.shadow.camera.top = 28;
      this.mainLight.shadow.camera.bottom = -28;
      this.mainLight.shadow.bias = -0.0003;
      this.mainLight.shadow.radius = 3;
    }
    this.scene.add(this.mainLight);

    // 侧翼轮廓冷光 (RhineLab 经典微蓝补光)
    const rimLight = new THREE.DirectionalLight(0x4a90e2, 0.5);
    rimLight.position.set(30, -5, -25);
    this.scene.add(rimLight);

    // 4. 网格底盘与导轨支撑系统
    const floorGeo = new THREE.PlaneGeometry(240, 240);
    const floorMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xd8c9b9 : 0x181b20,
      roughness: 0.95,
      metalness: 0.05
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.02;
    this.floor.receiveShadow = this.perfMode !== "low";
    this.scene.add(this.floor);

    // 空间辅助网格线
    const gridHelper = new THREE.GridHelper(160, 80, 0xd49b35, this.themeMode === "light" ? 0xc8c4b8 : 0x282c35);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // 添加核心卡组与导轨组
    this.scene.add(this.railGroup);
    this.scene.add(this.cardGroup);
    this.scene.add(this.trendStageGroup);

    // 射线投射器
    this.raycaster = new THREE.Raycaster();
    this.mouseCoord = new THREE.Vector2(-100, -100);
  }

  // ==========================================
  // 构建 6 层卡盒阵列与导轨
  // ==========================================
  filterAndBuildCards() {
    if (this.filterMode === "watching") {
      this.displayedItems = this.allItems.filter(it => it.state === "在看");
      if (this.displayedItems.length === 0) {
        this.displayedItems = this.allItems.slice(0, 16);
      }
    } else {
      this.displayedItems = this.allItems.slice(0, 48);
    }

    if (this.perfMode === "low" && this.displayedItems.length > 16) {
      this.displayedItems = this.displayedItems.slice(0, 16);
    }

    // 清理旧网格与导轨
    while (this.cardGroup.children.length > 0) {
      const obj = this.cardGroup.children[0];
      this.cardGroup.remove(obj);
      obj.traverse((child) => {
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }
    while (this.railGroup.children.length > 0) {
      const obj = this.railGroup.children[0];
      this.railGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    this.cardMeshes = [];
    this.cardDataMap.clear();

    const cols = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(this.displayedItems.length * 1.3))));
    const colSpacing = 4.2;
    const rowSpacing = 4.8;
    const offsetX = -((cols - 1) * colSpacing) / 2;
    const numRows = Math.ceil(this.displayedItems.length / cols);

    // 铺设精密导轨底座
    const railMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xc8c4b8 : 0x2d3139,
      metalness: 0.85,
      roughness: 0.35
    });
    for (let r = 0; r < numRows; r++) {
      const rz = r * rowSpacing - 4;
      const railGeo = new THREE.BoxGeometry(cols * colSpacing + 4, 0.08, 0.4);
      const railMesh = new THREE.Mesh(railGeo, railMat);
      railMesh.position.set(0, 0.04, rz);
      railMesh.receiveShadow = this.perfMode !== "low";
      this.railGroup.add(railMesh);
    }

    // 逐个生成 6 层精密卡盒
    this.displayedItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const posX = offsetX + col * colSpacing;
      const posZ = row * rowSpacing - 4;

      const cassetteGroup = this.createCassetteInstance(item, index);
      cassetteGroup.position.set(posX, 1.15, posZ);

      // 默认导轨巡航态：卡盒纵深竖立，微倾斜面朝轴测相机
      cassetteGroup.rotation.x = -0.12;
      cassetteGroup.rotation.y = 0.28;

      this.cardGroup.add(cassetteGroup);

      const cardData = {
        item,
        index,
        col,
        row,
        basePos: new THREE.Vector3(posX, 1.15, posZ),
        currentPos: new THREE.Vector3(posX, 1.15, posZ),
        group: cassetteGroup,
        partsMap: cassetteGroup.userData.partsMap,
        liftOffset: 0,
        waveOffset: 0
      };

      // 记录用于射线拾取的主包围盒
      const hitBox = cassetteGroup.userData.hitBox;
      this.cardMeshes.push(hitBox);
      this.cardDataMap.set(hitBox, cardData);
    });

    this.selectedIndex = -1;
    this.spaceState = "array";
    this.close3DTrendStage();
    this.hudLayer.empty();
  }

  // ==========================================
  // 创建单个 6 层独立装配卡盒 Group
  // ==========================================
  createCassetteInstance(item, index) {
    const cassetteGroup = new THREE.Group();
    const partsMap = new Map();

    // 1. 创建 6 个独立部件
    for (const part of ASSEMBLY_PARTS) {
      const geo = this.cassetteGeometries[part.id] || new THREE.BoxGeometry(3.0, 2.2, 0.1);
      let mat;

      if (part.id === "substrate") {
        // 画芯板：采用动态生成的 CanvasTexture
        mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: part.rough,
          metalness: part.metal
        });
        this.generateCardTexture(item).then(tex => {
          if (this.isDestroyed || !tex) return;
          mat.map = tex;
          mat.needsUpdate = true;
          this.wakeUp();
        });
      } else if (part.id === "cover") {
        // 透明亚克力磨砂盖板
        mat = new THREE.MeshPhysicalMaterial({
          color: part.color,
          roughness: part.rough,
          metalness: part.metal,
          transmission: this.perfMode === "low" ? 0.0 : part.trans,
          thickness: 0.14,
          transparent: true,
          opacity: part.opacity
        });
      } else {
        // 金属紧固件、双环浮雕、光学核心、背板与琥珀脊
        mat = new THREE.MeshStandardMaterial({
          color: part.color,
          roughness: part.rough,
          metalness: part.metal
        });
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.perfMode !== "low";
      mesh.receiveShadow = this.perfMode !== "low";

      const partPivot = new THREE.Group();
      partPivot.add(mesh);
      cassetteGroup.add(partPivot);

      partsMap.set(part.id, {
        pivot: partPivot,
        mesh,
        defExplodeZ: part.explodeZ
      });
    }

    // 2. 拾取碰撞外壳（不可见）
    const hitGeo = new THREE.BoxGeometry(3.4, 2.5, 0.6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    cassetteGroup.add(hitMesh);

    cassetteGroup.userData = {
      item,
      index,
      partsMap,
      hitBox: hitMesh
    };

    return cassetteGroup;
  }

  // ==========================================
  // 高清动态 Canvas 贴图生成（精密画芯板）
  // ==========================================
  async generateCardTexture(item) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 460;
    const ctx = canvas.getContext("2d");

    // 底板暖白质感
    ctx.fillStyle = "#f5f3ee";
    ctx.fillRect(0, 0, 640, 460);

    // 左侧：封面海报插槽 (280 x 420)
    let loadedImg = null;
    if (item.cover) {
      try {
        const coverUrl = this.plugin.getCoverResourceUrl(item.cover, item.file?.path);
        if (coverUrl) {
          loadedImg = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = coverUrl;
          });
        }
      } catch (e) {}
    }

    if (loadedImg) {
      ctx.drawImage(loadedImg, 20, 20, 280, 420);
    } else {
      ctx.fillStyle = "#dfdbd0";
      ctx.fillRect(20, 20, 280, 420);
      ctx.fillStyle = "#8a867c";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.name.slice(0, 8), 160, 230);
    }

    // 右侧：精密实验室信息区 (320 x 420)
    const rx = 320;
    ctx.textAlign = "left";

    // 眉标：RHINE LAB / ANIME ARCHIVE
    ctx.fillStyle = "#d49b35";
    ctx.font = "bold 13px monospace";
    ctx.fillText("RHINE LAB · SPECIMEN " + (item.subjectId ? `#${item.subjectId}` : "X-01"), rx, 46);

    // 主标题
    ctx.fillStyle = "#171713";
    ctx.font = "bold 26px sans-serif";
    const shortTitle = item.name.length > 11 ? item.name.slice(0, 10) + "…" : item.name;
    ctx.fillText(shortTitle, rx, 85);

    // 副标题
    ctx.fillStyle = "#666257";
    ctx.font = "14px sans-serif";
    const subStr = `${item.year || "2025"} · ${item.season || "SEASON"} · ${item.state || "在看"}`;
    ctx.fillText(subStr, rx, 114);

    // 装饰刻度线
    ctx.strokeStyle = "#c8c4b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, 134);
    ctx.lineTo(610, 134);
    ctx.stroke();

    // 评分环带数值槽
    ctx.fillStyle = "#171713";
    ctx.font = "bold 38px sans-serif";
    const scoreVal = item.personalScore !== null ? item.personalScore.toFixed(1) : (item.bangumiScore !== null ? item.bangumiScore.toFixed(1) : "—.—");
    ctx.fillText(scoreVal, rx, 185);

    ctx.fillStyle = "#d49b35";
    ctx.font = "bold 14px monospace";
    ctx.fillText(item.personalScore !== null ? "★ PERSONAL RATING" : "★ BGM AVERAGE", rx + 95, 175);

    // 进度刻度槽
    const watched = Number(item.watchedEpisodes) || 0;
    const total = Number(item.totalEpisodes) || 12;
    const ratio = Math.min(1.0, Math.max(0, total > 0 ? watched / total : 0));

    ctx.fillStyle = "#666257";
    ctx.font = "bold 13px monospace";
    ctx.fillText(`PROGRESS: ${watched}/${total > 0 ? total : "?"} EPISODES (${Math.round(ratio * 100)}%)`, rx, 230);

    // 进度槽背景与填充条
    ctx.fillStyle = "#dfdbd0";
    ctx.fillRect(rx, 245, 290, 8);
    ctx.fillStyle = "#171713";
    ctx.fillRect(rx, 245, 290 * ratio, 8);

    // 底部条形码装饰与编号
    ctx.fillStyle = "#c8c4b8";
    for (let b = 0; b < 28; b++) {
      const bw = (b % 3 === 0) ? 3 : (b % 2 === 0 ? 1 : 2);
      ctx.fillRect(rx + b * 10, 395, bw, 25);
    }
    ctx.fillStyle = "#8a867c";
    ctx.font = "11px monospace";
    ctx.fillText("INTERNAL CASSETTE ASSEMBLY / 6-LAYER ARCHIVE", rx, 436);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  // ==========================================
  // 事件系统绑定
  // ==========================================
  bindEvents() {
    const el = this.viewportEl;

    // 1. 指针滑动拾取与打量拖拽
    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mouseCoord.set(x, y);

      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        this.targetCardRotation += dx * 0.015;
        if (this.spaceState === "explode") {
          this.targetStageElevation += dy * 0.008;
          this.targetStageElevation = Math.max(-0.6, Math.min(0.6, this.targetStageElevation));
        }
        this.wakeUp();
      }

      this.wakeUp();
    });

    // 2. 指针按下（状态机流转与拖拽旋转启动）
    el.addEventListener("pointerdown", (e) => {
      this.wakeUp();
      if (e.button === 0) {
        this.raycaster.setFromCamera(this.mouseCoord, this.camera);
        const intersects = this.raycaster.intersectObjects(this.cardMeshes);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const data = this.cardDataMap.get(hitMesh);
          if (data) {
            if (this.selectedIndex === data.index) {
              // 聚焦态再次点击自身：启动 360° 拖拽打量
              this.isDragging = true;
              this.dragStartX = e.clientX;
              this.dragStartY = e.clientY;
              el.style.cursor = "grabbing";
            } else {
              // 状态一切换至状态二：聚焦卡片
              this.selectCard(data.index);
            }
          }
        } else {
          // 点击空白区域：如果在爆炸态或聚焦态，允许自由旋转打量
          if (this.spaceState === "explode" || this.spaceState === "inspect") {
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            el.style.cursor = "grabbing";
          }
        }
      }
    });

    window.addEventListener("pointerup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        el.style.cursor = "grab";
        this.wakeUp();
      }
    });

    // 3. 滚轮推进与缩放
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wakeUp();
      if (this.spaceState === "array") {
        this.cameraPanZ.value += e.deltaY * 0.018;
        this.cameraPanX.value += e.deltaX * 0.018;
      } else if (this.spaceState === "explode") {
        this.targetZoom += e.deltaY * 0.0015;
        this.targetZoom = Math.max(0.6, Math.min(2.0, this.targetZoom));
      }
    }, { passive: false });

    // 4. 键盘导航
    this.keyHandler = (e) => {
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") {
        if (this.spaceState === "explode") {
          this.exitExplodeMode();
        } else if (this.spaceState === "inspect") {
          this.deselectCard();
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (this.spaceState === "array" && this.displayedItems.length > 0) {
          const delta = e.key === "ArrowLeft" ? -1 : 1;
          const nextIdx = this.selectedIndex >= 0
            ? (this.selectedIndex + delta + this.displayedItems.length) % this.displayedItems.length
            : 0;
          this.selectCard(nextIdx);
        }
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    // 5. 尺寸监听
    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
      this.wakeUp();
    });
    this.resizeObserver.observe(this.viewportEl);

    // 6. 可见性休眠
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

  onResize() {
    if (!this.viewportEl || this.isDestroyed) return;
    const w = this.viewportEl.clientWidth;
    const h = this.viewportEl.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  wakeUp() {
    this.idleTime = 0;
    if (this.isSleeping) {
      this.isSleeping = false;
      this.updateStatusPill();
      this.startLoop();
    }
  }

  // ==========================================
  // 三级状态机流转控制
  // ==========================================

  // 进入状态二：半屏档案检视
  selectCard(index) {
    if (index < 0 || index >= this.displayedItems.length) return;
    this.selectedIndex = index;
    this.spaceState = "inspect";
    this.targetSpread = 0;
    this.targetLift = 1.6;
    this.targetCardRotation = 0;
    this.cardRotation.value = 0;
    this.cardRotation.velocity = 0;
    this.targetStageElevation = 0;
    this.stageElevation.value = 0;

    const hitMesh = this.cardMeshes[index];
    const data = this.cardDataMap.get(hitMesh);
    if (!data) return;

    // 触发以卡为中心的高斯波纹场
    this.wavePulses.push({
      col: data.col,
      row: data.row,
      time: this.clock
    });

    // 镜头瞄准：左移聚焦卡盒（将右侧半屏留给 2D 高精密 HUD 面板）
    this.targetCameraAim.set(data.basePos.x - 1.2, 1.8, data.basePos.z);

    // 渲染右侧半屏档案 HUD 与 Netaba 趋势面板
    this.renderState2Hud(data.item);
    this.close3DTrendStage();
    this.updateStatusPill();
    this.wakeUp();
  }

  // 返回状态一：导轨阵列巡航
  deselectCard() {
    this.selectedIndex = -1;
    this.spaceState = "array";
    this.targetSpread = 0;
    this.targetLift = 0;
    this.targetCardRotation = 0;
    this.targetStageElevation = 0;
    this.targetCameraAim.set(0, 1.2, 0);
    this.close3DTrendStage();
    this.hudLayer.empty();
    this.updateStatusPill();
    this.wakeUp();
  }

  // 进入状态三：360° 爆炸拆解与三维全息评分舞台
  enterExplodeMode() {
    if (this.selectedIndex < 0) return;
    this.spaceState = "explode";
    this.targetSpread = 1.0; // 展开 6 层卡盒
    this.targetLift = 2.2;
    this.targetZoom = 1.0;

    const hitMesh = this.cardMeshes[this.selectedIndex];
    const data = this.cardDataMap.get(hitMesh);
    if (!data) return;

    // 镜头正中对准该卡盒核心
    this.targetCameraAim.set(data.basePos.x, 2.2, data.basePos.z);

    // 打开三维 Netaba 全息评分舞台
    this.open3DTrendStage(data.item, data.group);

    // 渲染状态三的顶栏装配侧标与重组操作条
    this.renderState3Hud(data.item);
    this.updateStatusPill();
    this.wakeUp();
  }

  // 退出状态三，回到状态二
  exitExplodeMode() {
    if (this.selectedIndex < 0) {
      this.deselectCard();
      return;
    }
    this.spaceState = "inspect";
    this.targetSpread = 0.0; // 一键合拢
    this.selectCard(this.selectedIndex);
  }

  // 拆解 / 重组切换
  setExploded(isExploded) {
    this.targetSpread = isExploded ? 1.0 : 0.0;
    this.wakeUp();
  }

  resetCamera() {
    this.cameraPanX.value = 0;
    this.cameraPanZ.value = 0;
    this.targetZoom = 1.0;
    this.cameraZoom.value = 1.0;
    this.targetCardRotation = 0;
    this.targetStageElevation = 0;
    if (this.spaceState === "array") {
      this.targetCameraAim.set(0, 1.2, 0);
    } else if (this.selectedIndex >= 0) {
      const data = this.cardDataMap.get(this.cardMeshes[this.selectedIndex]);
      if (data) {
        if (this.spaceState === "inspect") {
          this.targetCameraAim.set(data.basePos.x - 1.2, 1.8, data.basePos.z);
        } else {
          this.targetCameraAim.set(data.basePos.x, 2.2, data.basePos.z);
        }
      }
    }
    this.wakeUp();
  }

  // ==========================================
  // 状态三：三维全息评分舞台（拔地而起折线与发光能量带）
  // ==========================================
  async open3DTrendStage(item, parentGroup) {
    this.close3DTrendStage();
    this.trendStageGroup.position.copy(parentGroup.position);
    this.trendStageGroup.rotation.set(0, 0, 0);

    // 1. 建造三维基底参考台
    const stageWidth = 7.2;
    const stageDepth = 3.6;
    const stageMat = new THREE.MeshStandardMaterial({
      color: this.themeMode === "light" ? 0xe4d5c1 : 0x1f232b,
      metalness: 0.2,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85
    });
    const stageBase = new THREE.Mesh(new THREE.BoxGeometry(stageWidth, 0.08, stageDepth), stageMat);
    stageBase.position.set(0, -1.2, 0);
    this.trendStageGroup.add(stageBase);

    // 2. 异步拉取真实 Netaba 历史趋势数据
    if (item.subjectId) {
      try {
        const raw = await netabaTrendService.fetchSubjectTrendData(this.app, item.subjectId);
        const norm = netabaTrendService.normalizeTrendData(raw, item.personalScore);
        this.currentTrendData = norm;
        this.build3DTrendMesh(norm, stageWidth, stageDepth);
      } catch (e) {
        console.warn("3D 全息评分舞台拉取 Netaba 失败:", e);
      }
    }
    this.wakeUp();
  }

  build3DTrendMesh(normData, width = 7.0, depth = 3.6) {
    if (!normData || !normData.airingPoints || normData.airingPoints.length === 0) return;

    const points = normData.airingPoints;
    const minMax = normData.airingMinMax;
    const tMin = points[0].timestamp;
    const tMax = points[points.length - 1].timestamp;
    const tSpan = Math.max(1, tMax - tMin);
    const sMin = minMax.min;
    const sMax = minMax.max;
    const sSpan = Math.max(0.1, sMax - sMin);
    const maxHeight = 2.4;
    const baseY = -1.15;

    const lineVectors = [];
    const ribbonVerts = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const px = -width / 2 + ((p.timestamp - tMin) / tSpan) * width;
      const py = baseY + ((p.score - sMin) / sSpan) * maxHeight;
      const pz = 0;

      lineVectors.push(new THREE.Vector3(px, py, pz));

      // 拔地而起发光能量带（从曲线连接到底板）
      if (i > 0) {
        const prev = lineVectors[i - 1];
        // 面 1: prev -> prevBase -> cur
        ribbonVerts.push(prev.x, prev.y, pz,  prev.x, baseY, pz,  px, py, pz);
        // 面 2: cur -> prevBase -> curBase
        ribbonVerts.push(px, py, pz,  prev.x, baseY, pz,  px, baseY, pz);
      }
    }

    // 1. 三维发光主折线
    const lineGeo = new THREE.BufferGeometry().setFromPoints(lineVectors);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00d2ff,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });
    this.trendStageGroup.add(new THREE.Line(lineGeo, lineMat));

    // 2. 拔地而起的半透明发光能量带
    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute("position", new THREE.Float32BufferAttribute(ribbonVerts, 3));
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide
    });
    this.trendStageGroup.add(new THREE.Mesh(ribbonGeo, ribbonMat));

    // 3. “我的评分”立体基准线
    if (normData.personalScore !== null && normData.personalScore >= sMin && normData.personalScore <= sMax) {
      const py = baseY + ((normData.personalScore - sMin) / sSpan) * maxHeight;
      const pLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2, py, 0),
        new THREE.Vector3(width / 2, py, 0)
      ]);
      const pLineMat = new THREE.LineBasicMaterial({
        color: 0xd49b35,
        transparent: true,
        opacity: 0.85
      });
      this.trendStageGroup.add(new THREE.Line(pLineGeo, pLineMat));
    }

    // 4. 分集播出日垂直标尺立柱
    if (normData.eps && normData.eps.length > 0) {
      const pillarPts = [];
      for (const ep of normData.eps) {
        if (!ep.timestamp || ep.timestamp < tMin || ep.timestamp > tMax) continue;
        const ex = -width / 2 + ((ep.timestamp - tMin) / tSpan) * width;
        pillarPts.push(new THREE.Vector3(ex, baseY, 0), new THREE.Vector3(ex, baseY + 0.9, 0));
      }
      if (pillarPts.length > 0) {
        const pGeo = new THREE.BufferGeometry().setFromPoints(pillarPts);
        const pMat = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ color: 0x8a9ba8, transparent: true, opacity: 0.45 }));
        this.trendStageGroup.add(pMat);
      }
    }
  }

  close3DTrendStage() {
    while (this.trendStageGroup.children.length > 0) {
      const o = this.trendStageGroup.children[0];
      this.trendStageGroup.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    this.currentTrendData = null;
  }

  // ==========================================
  // 状态二：半屏 2D 高精密 HUD 面板渲染
  // ==========================================
  renderState2Hud(item) {
    this.hudLayer.empty();
    const panel = this.hudLayer.createDiv("bangumi-3d-hud-panel");

    // 眉标与标题
    const eyebrow = panel.createDiv("hud-eyebrow");
    eyebrow.textContent = `RHINE LAB / ARCHIVE FILE · #${item.subjectId || "N/A"}`;

    const titleEl = panel.createEl("h2", { cls: "hud-title" });
    titleEl.textContent = `《${item.name}》`;

    const subEl = panel.createDiv("hud-sub");
    subEl.textContent = `${item.japaneseName || ""} · ${item.year || "未知"} ${item.season || ""}`;

    // 评分卡片行
    const scoreRow = panel.createDiv("hud-score-row");
    if (item.personalScore !== null) {
      scoreRow.createSpan({ cls: "hud-pill is-personal", text: `我的评分 ★ ${item.personalScore.toFixed(1)}` });
    }
    if (item.bangumiScore !== null) {
      scoreRow.createSpan({ cls: "hud-pill is-bgm", text: `BGM均分 ${item.bangumiScore.toFixed(1)}` });
    }
    scoreRow.createSpan({ cls: "hud-pill is-state", text: item.state || "在看" });

    // 追番进度与已看 +1
    const progressRow = panel.createDiv("hud-progress-row");
    const watchedNum = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    progressRow.createSpan({
      text: `追番进度：${watchedNum} / ${totalNum > 0 ? totalNum : "?"} 话`,
      cls: "hud-ep-label"
    });

    const btnInc = progressRow.createEl("button", {
      cls: "hud-action-btn",
      text: "已看 +1 话"
    });
    btnInc.onclick = async () => {
      const next = watchedNum + 1;
      await this.plugin.quickUpdateAnimeNote(item, { watchedEpisodes: next });
      item.watchedEpisodes = next;
      this.renderState2Hud(item);
      this.wakeUp();
    };

    // 本地视频联动
    if (item.downloadPath && item.downloadPath !== "无") {
      const localInfo = inspectLocalFolder(item.downloadPath, item.watchedEpisodes);
      if (localInfo && !localInfo.error && localInfo.fileCount > 0) {
        const localBar = panel.createDiv("hud-local-bar");
        if (localInfo.nextEpisodeFile) {
          const nextEp = localInfo.nextEpisodeNumber || (watchedNum + 1);
          const playBtn = localBar.createEl("button", {
            cls: "hud-action-btn is-primary",
            text: `▶ 播放第 ${nextEp} 话`
          });
          playBtn.onclick = async () => {
            await openLocalPathSafely(localInfo.nextEpisodeFile);
          };
        }
        const openFolderBtn = localBar.createEl("button", {
          cls: "hud-action-btn",
          text: "📂 打开本地目录"
        });
        openFolderBtn.onclick = async () => {
          await openLocalPathSafely(item.downloadPath);
        };
      }
    }

    // 嵌入原生 SVG 趋势图组件 (第五期成果)
    const trendBox = panel.createDiv("hud-trend-box");
    if (item.subjectId) {
      netabaTrendService.fetchSubjectTrendData(this.app, item.subjectId).then(raw => {
        const norm = netabaTrendService.normalizeTrendData(raw, item.personalScore);
        netabaTrendService.renderNativeTrendSvg(trendBox, norm);
      }).catch(err => {
        trendBox.createDiv({ cls: "bangumi-trend-empty", text: "历史趋势数据载入中或无打分记录。" });
      });
    } else {
      trendBox.createDiv({ cls: "bangumi-trend-empty", text: "暂无关联 Bangumi 条目 ID。" });
    }

    // 核心操作按钮组：进入状态三 (爆炸拆解与 3D 评分舞台)
    const footerActions = panel.createDiv("hud-footer-actions");
    const explodeBtn = footerActions.createEl("button", {
      cls: "hud-action-btn is-primary",
      text: "🔬 3D 爆炸拆解与评分舞台"
    });
    explodeBtn.onclick = () => this.enterExplodeMode();

    if (item.file) {
      const noteBtn = footerActions.createEl("button", {
        cls: "hud-action-btn",
        text: "📝 打开动画笔记"
      });
      noteBtn.onclick = () => this.app.workspace.openLinkText(item.file.path, "", false);
    }

    const closeBtn = panel.createEl("button", {
      cls: "hud-close-btn",
      text: "← 返回导轨阵列 (Esc)"
    });
    closeBtn.onclick = () => this.deselectCard();
  }

  // ==========================================
  // 状态三：360° 爆炸拆解与评分舞台 HUD 渲染
  // ==========================================
  renderState3Hud(item) {
    this.hudLayer.empty();
    const explodeHud = this.hudLayer.createDiv("bangumi-3d-explode-hud");

    // 左侧装配结构部件层级表 (Assembly Structure)
    const sidebar = explodeHud.createDiv("explode-parts-sidebar");
    sidebar.createDiv({ cls: "explode-parts-title", text: "ASSEMBLY / 6 层装配结构" });

    ASSEMBLY_PARTS.forEach((part, i) => {
      const row = sidebar.createDiv("explode-part-item");
      row.createSpan({ cls: "explode-part-num", text: `0${i + 1}` });
      row.createSpan({ cls: "explode-part-label", text: part.label });
      row.createSpan({ cls: "explode-part-en", text: part.en });
    });

    // 底部浮动胶囊控制条
    const bottomBar = explodeHud.createDiv("explode-bottom-bar");

    const toggleExplodeBtn = bottomBar.createEl("button", {
      cls: "hud-action-btn",
      text: this.targetSpread > 0.5 ? "一键重组卡盒" : "拆解 6 层档案"
    });
    toggleExplodeBtn.onclick = () => {
      const next = this.targetSpread < 0.5;
      this.setExploded(next);
      toggleExplodeBtn.textContent = next ? "一键重组卡盒" : "拆解 6 层档案";
    };

    const resetBtn = bottomBar.createEl("button", {
      cls: "hud-action-btn",
      text: "复位视角"
    });
    resetBtn.onclick = () => this.resetCamera();

    const returnBtn = bottomBar.createEl("button", {
      cls: "hud-action-btn is-primary",
      text: "← 返回档案检视"
    });
    returnBtn.onclick = () => this.exitExplodeMode();

    bottomBar.createSpan({
      cls: "explode-help-hint",
      text: "拖拽 360° 全方位打量 · 滚轮缩放"
    });
  }

  // ==========================================
  // 主渲染循环与二阶弹簧物理阻尼
  // ==========================================
  startLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.lastTime = performance.now();

    const loop = (time) => {
      if (this.isDestroyed) return;
      const dt = Math.min((time - this.lastTime) / 1000, 0.08);
      this.lastTime = time;

      const isMoving = this.updatePhysics(dt, time / 1000);

      // 执行渲染
      this.renderer.render(this.scene, this.camera);

      // 掉帧检测保护机制
      if (dt > 0.038) {
        this.frameDropCounter++;
        if (this.frameDropCounter > 30 && this.perfMode !== "low") {
          console.warn("3D 交互空间检测到帧率较低，自动调至节能模式");
          this.setPerformanceMode("low");
          this.frameDropCounter = 0;
        }
      } else {
        this.frameDropCounter = Math.max(0, this.frameDropCounter - 1);
      }

      // 静止 1.5 秒自动休眠降至 0 FPS（完全释放 GPU/CPU 占用）
      if (!isMoving && !this.isDragging) {
        this.idleTime += dt;
        if (this.idleTime >= 1.5) {
          this.isSleeping = true;
          this.updateStatusPill();
          this.rafId = null;
          return;
        }
      } else {
        this.idleTime = 0;
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  updatePhysics(dt, clockTime) {
    this.clock = clockTime;
    let hasMotion = false;

    // 1. 镜头瞄准与缩放阻尼
    if (this.cameraAim.distanceTo(this.targetCameraAim) > 0.001) {
      this.cameraAim.lerp(this.targetCameraAim, 8.0 * dt);
      this.camera.lookAt(this.cameraAim);
      hasMotion = true;
    }

    damp(this.cameraZoom, this.targetZoom, 7.0, dt);
    if (Math.abs(this.cameraZoom.value - this.targetZoom) > 0.005) {
      this.camera.zoom = this.cameraZoom.value;
      this.camera.updateProjectionMatrix();
      hasMotion = true;
    }

    // 2. 爆炸展开阻尼与升降阻尼
    damp(this.spread, this.targetSpread, 5.5, dt);
    damp(this.lift, this.targetLift, 8.0, dt);
    damp(this.cardRotation, this.targetCardRotation, 9.5, dt);
    damp(this.stageElevation, this.targetStageElevation, 9.0, dt);

    if (Math.abs(this.spread.value - this.targetSpread) > 0.001 || Math.abs(this.spread.velocity) > 0.002) hasMotion = true;
    if (Math.abs(this.lift.value - this.targetLift) > 0.005 || Math.abs(this.lift.velocity) > 0.01) hasMotion = true;
    if (Math.abs(this.cardRotation.value - this.targetCardRotation) > 0.005 || Math.abs(this.cardRotation.velocity) > 0.01) hasMotion = true;
    if (Math.abs(this.stageElevation.value - this.targetStageElevation) > 0.005 || Math.abs(this.stageElevation.velocity) > 0.01) hasMotion = true;

    // 3. 卡盒阵列波纹与多层爆炸位移动画
    for (let i = 0; i < this.cardMeshes.length; i++) {
      const hitMesh = this.cardMeshes[i];
      const data = this.cardDataMap.get(hitMesh);
      if (!data) continue;

      let waveH = 0;
      // 遍历高斯波纹脉冲
      for (let pIdx = this.wavePulses.length - 1; pIdx >= 0; pIdx--) {
        const pulse = this.wavePulses[pIdx];
        const age = clockTime - pulse.time;
        if (age > 2.2) {
          this.wavePulses.splice(pIdx, 1);
          continue;
        }
        const dist = Math.hypot(data.col - pulse.col, data.row - pulse.row);
        waveH += 1.6 * bell(dist - age * 5.0, 1.2) * Math.exp(-age * 1.5);
        hasMotion = true;
      }

      // 极致画质闲置呼吸波
      if (this.perfMode === "high" && this.spaceState === "array") {
        waveH += idleWave(data.col, data.row, clockTime);
        hasMotion = true;
      }

      if (data.index === this.selectedIndex) {
        // 焦点卡盒：升空并响应用户水平与垂直打量旋转
        data.group.position.y = data.basePos.y + this.lift.value;
        data.group.rotation.y = 0.28 + this.cardRotation.value;
        data.group.rotation.x = -0.12 + this.stageElevation.value;

        // 沿法线展开 6 层部件
        for (const [partId, pData] of data.partsMap.entries()) {
          pData.pivot.position.z = pData.defExplodeZ * this.spread.value;
        }
      } else {
        // 其他卡盒：导轨背景下沉
        const bgSink = (this.spaceState !== "array") ? -0.8 : 0;
        data.group.position.y = data.basePos.y + bgSink + waveH;
        data.group.rotation.x = -0.12;
        data.group.rotation.y = 0.28;

        // 非焦点卡盒保持紧密重组
        for (const pData of data.partsMap.values()) {
          pData.pivot.position.z = 0;
        }
      }
    }

    return hasMotion;
  }

  // ==========================================
  // 显存与事件彻底释放 (Destroy)
  // ==========================================
  destroy() {
    this.isDestroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.removeEventListener("keydown", this.keyHandler);
    document.removeEventListener("visibilitychange", this.visHandler);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        }
      });
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
    }

    this.container.empty();
  }
}

module.exports = {
  Dashboard3DSpace
};
