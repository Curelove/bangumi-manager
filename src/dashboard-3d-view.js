/**
 * dashboard-3d-view.js
 * 
 * 第六期：基于 RhineLabUI 解构的 3D 交互式档案空间
 * 融合【方案 A（RhineLabUI 工业低 FOV 等轴测卡槽矩阵 + 二阶弹簧阻尼高斯波纹）】
 * 与【方案 C（拔地而起的三维发光 Netaba 评分趋势与对比舞台）】
 * 并具备【三档硬件性能分级架构】与【静止 1.5 秒自动休眠降至 0 FPS】
 */

const THREE = require("three");
const netabaTrendService = require("./netaba-trend-service.js");
const { inspectLocalFolder, openLocalPathSafely } = require("./note-utils.js");

// 二阶弹簧阻尼物理方程（Frame-rate independent）
function damp(s, target, rate, dt) {
  const delta = s.value - target;
  const impulse = s.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  s.value = target + (delta + impulse * dt) * decay;
  s.velocity = (s.velocity - rate * impulse * dt) * decay;
}

// 钟形高斯衰减函数
function bell(x, width) {
  return Math.exp(-0.5 * Math.pow(x / width, 2));
}

// 平滑插值
function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (10 + t * (-15 + 6 * t));
}

// 闲置低频呼吸波
function idleWave(col, row, time) {
  return (
    0.065 * Math.sin((time * Math.PI * 2) / 8 + row * 0.32 - col * 0.45) +
    0.025 * Math.sin((time * Math.PI * 2) / 13 - row * 0.18 + col * 0.3)
  );
}

class Dashboard3DSpace {
  constructor(container, plugin, options = {}) {
    this.container = container;
    this.plugin = plugin;
    this.app = plugin.app;
    this.options = options;
    this.allItems = options.items || [];
    this.displayedItems = [];
    this.filterMode = options.filterMode || "watching"; // "watching" | "collection" | "all"
    
    // 性能分级配置: "low" | "medium" | "high"
    this.perfMode = options.perfMode || plugin.settings.dashboard3dPerfMode || "medium";

    // 运行状态与生命周期
    this.isDestroyed = false;
    this.isSleeping = false;
    this.rafId = null;
    this.lastTime = 0;
    this.idleTime = 0;
    this.clock = 0;

    // 选中的焦点卡片与升降状态
    this.selectedIndex = -1;
    this.hoverIndex = -1;
    this.lift = { value: 0, velocity: 0 };
    this.cardRotation = { value: 0, velocity: 0 };
    this.targetCardRotation = 0;
    this.isDraggingCard = false;
    this.dragStartX = 0;

    // 镜头阻尼相机系统（低 FOV 等轴测工业透视）
    this.cameraAim = new THREE.Vector3(0, 0, 0);
    this.targetCameraAim = new THREE.Vector3(0, 0, 0);
    this.cameraPanX = { value: 0, velocity: 0 };
    this.cameraPanZ = { value: 0, velocity: 0 };
    this.cameraZoom = { value: 1, velocity: 0 };
    this.targetZoom = 1;

    // 阵列与波纹场
    this.cardMeshes = [];
    this.cardDataMap = new Map();
    this.cardGroup = new THREE.Group();
    this.wavePulses = []; // 交互涟漪中心 [{ col, row, time }]

    // 三维评分趋势舞台对象
    this.trendStageGroup = new THREE.Group();
    this.trendStageVisible = false;
    this.trendStageAnim = { value: 0, velocity: 0 };
    this.currentTrendData = null;
    this.compareItem = null;
    this.compareTrendData = null;

    // 帧耗时监测（连续掉帧保护）
    this.frameDropCounter = 0;

    // 初始化 DOM 与 3D 渲染管线
    this.initDom();
    this.initThree();
    this.filterAndBuildCards();
    this.bindEvents();
    this.startLoop();
  }

  initDom() {
    this.container.empty();
    this.rootEl = this.container.createDiv("bangumi-3d-root");
    this.rootEl.style.position = "relative";
    this.rootEl.style.width = "100%";
    this.rootEl.style.height = "100%";
    this.rootEl.style.minHeight = "640px";
    this.rootEl.style.overflow = "hidden";
    this.rootEl.style.backgroundColor = "var(--background-secondary, #14161a)";
    this.rootEl.style.userSelect = "none";

    // 1. 顶栏科技 HUD 工具条
    this.topToolbar = this.rootEl.createDiv("bangumi-3d-toolbar");
    
    // 顶栏左侧：标题与模态切换
    const leftSection = this.topToolbar.createDiv("toolbar-section-left");
    const backBtn = leftSection.createEl("button", {
      cls: "bangumi-3d-btn is-mode-switch",
      text: "🔲 返回 2D 仪表盘"
    });
    backBtn.onclick = () => {
      if (this.onExit3D) this.onExit3D();
    };

    const titleBadge = leftSection.createSpan({
      cls: "bangumi-3d-title-badge",
      text: "🧊 RHINE ARCHIVE · 3D 空间"
    });

    // 数据源切换下拉
    const filterSelect = leftSection.createEl("select", { cls: "bangumi-3d-select" });
    filterSelect.createEl("option", { text: "正在追番", value: "watching" });
    filterSelect.createEl("option", { text: "全部动画", value: "all" });
    filterSelect.value = this.filterMode;
    filterSelect.onchange = () => {
      this.filterMode = filterSelect.value;
      this.filterAndBuildCards();
      this.wakeUp();
    };

    // 顶栏右侧：画质性能模式切换 + 快捷帮助
    const rightSection = this.topToolbar.createDiv("toolbar-section-right");
    
    // 性能模式切换按钮组
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

    // 2. WebGL Canvas 挂载容器
    this.viewportEl = this.rootEl.createDiv("bangumi-3d-viewport");
    this.viewportEl.style.width = "100%";
    this.viewportEl.style.height = "100%";
    this.viewportEl.style.cursor = "grab";

    // 3. 2D HUD 空间映射层（覆盖在 3D 之上）
    this.hudLayer = this.rootEl.createDiv("bangumi-3d-hud-layer");
    this.hudLayer.style.position = "absolute";
    this.hudLayer.style.top = "0";
    this.hudLayer.style.left = "0";
    this.hudLayer.style.width = "100%";
    this.hudLayer.style.height = "100%";
    this.hudLayer.style.pointerEvents = "none";
    this.hudLayer.style.zIndex = "5";

    // 4. 休眠与性能状态指示微标（右下角微弱显示）
    this.statusPill = this.rootEl.createDiv("bangumi-3d-status-pill");
    this.updateStatusPill();
  }

  updateStatusPill() {
    if (!this.statusPill) return;
    const modeText = this.perfMode === "low" ? "节能模式" : this.perfMode === "high" ? "极致画质" : "均衡模式";
    this.statusPill.textContent = `${modeText} · ${this.isSleeping ? "💤 静止休眠 (0 FPS)" : "🟢 活跃渲染"}`;
    this.statusPill.className = `bangumi-3d-status-pill ${this.isSleeping ? "is-sleeping" : "is-active"}`;
  }

  setPerformanceMode(mode) {
    this.perfMode = mode;
    this.plugin.settings.dashboard3dPerfMode = mode;
    this.plugin.saveSettings();

    for (const [key, btn] of Object.entries(this.perfButtons)) {
      if (key === mode) btn.classList.add("is-active");
      else btn.classList.remove("is-active");
    }

    // 根据画质配置更新渲染参数
    const dpr = window.devicePixelRatio || 1;
    if (mode === "low") {
      this.renderer.setPixelRatio(1.0);
      if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = false;
    } else if (mode === "medium") {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2.0));
      if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = true;
    }
    this.filterAndBuildCards();
    this.wakeUp();
    this.updateStatusPill();
  }

  initThree() {
    const w = this.viewportEl.clientWidth || 800;
    const h = this.viewportEl.clientHeight || 600;

    // 1. 渲染器
    if (this.options && this.options.mockRenderer) {
      this.renderer = this.options.mockRenderer;
    } else {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
      });
    }
    this.renderer.setSize(w, h);
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.perfMode === "low" ? 1.0 : this.perfMode === "high" ? Math.min(dpr, 2.0) : Math.min(dpr, 1.5));
    this.renderer.shadowMap.enabled = this.perfMode !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.viewportEl.appendChild(this.renderer.domElement);

    // 2. 场景与长焦等轴测工业相机 (Low FOV 12°)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(
      document.body.classList.contains("theme-light") ? 0xebedf0 : 0x111317
    );
    this.scene.fog = new THREE.Fog(
      this.scene.background.getHex(),
      40,
      120
    );

    // 相机放置于斜 45 度远摄轴测位（低 FOV 产生工业严谨感）
    this.camera = new THREE.PerspectiveCamera(12, w / h, 0.5, 300);
    this.defaultCameraPos = new THREE.Vector3(-42, 38, 48);
    this.camera.position.copy(this.defaultCameraPos);
    this.camera.lookAt(0, 0, 0);

    // 3. 灯光体系 (冷暖对比、主光 + 柔和环境光)
    this.ambientLight = new THREE.AmbientLight(0xdbe3ed, 0.7);
    this.scene.add(this.ambientLight);

    this.mainLight = new THREE.DirectionalLight(0xffffff, 1.3);
    this.mainLight.position.set(-20, 45, 30);
    this.mainLight.castShadow = this.perfMode !== "low";
    if (this.mainLight.castShadow) {
      this.mainLight.shadow.mapSize.set(1024, 1024);
      this.mainLight.shadow.camera.left = -25;
      this.mainLight.shadow.camera.right = 25;
      this.mainLight.shadow.camera.top = 25;
      this.mainLight.shadow.camera.bottom = -25;
      this.mainLight.shadow.bias = -0.0005;
    }
    this.scene.add(this.mainLight);

    // 辅助发光补光（工业科技感微蓝光）
    const fillLight = new THREE.DirectionalLight(0x3b82f6, 0.4);
    fillLight.position.set(25, -10, -20);
    this.scene.add(fillLight);

    // 4. 空间网格底盘 (Grid Stage Floor)
    const floorGeo = new THREE.PlaneGeometry(160, 160);
    const floorMat = new THREE.MeshStandardMaterial({
      color: document.body.classList.contains("theme-light") ? 0xdfe3e8 : 0x0d0f12,
      roughness: 0.85,
      metalness: 0.1
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.05;
    this.floor.receiveShadow = this.perfMode !== "low";
    this.scene.add(this.floor);

    // 空间网格线 (Grid Helper)
    const gridHelper = new THREE.GridHelper(120, 60, 0x3b82f6, 0x22272e);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // 添加核心组
    this.scene.add(this.cardGroup);
    this.scene.add(this.trendStageGroup);

    // 射线投射器（用于鼠标点选）
    this.raycaster = new THREE.Raycaster();
    this.mouseCoord = new THREE.Vector2(-100, -100);
  }

  filterAndBuildCards() {
    // 筛选当前需要呈现的卡片
    if (this.filterMode === "watching") {
      this.displayedItems = this.allItems.filter(it => it.state === "在看");
      if (this.displayedItems.length === 0) {
        this.displayedItems = this.allItems.slice(0, 18);
      }
    } else {
      this.displayedItems = this.allItems.slice(0, 48); // 限制上限保证性能
    }

    if (this.perfMode === "low" && this.displayedItems.length > 20) {
      this.displayedItems = this.displayedItems.slice(0, 20);
    }

    // 清理旧网格
    while (this.cardGroup.children.length > 0) {
      const obj = this.cardGroup.children[0];
      this.cardGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }
    this.cardMeshes = [];
    this.cardDataMap.clear();

    const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(this.displayedItems.length * 1.5))));
    const colSpacing = 3.6;
    const rowSpacing = 4.8;
    const offsetX = -((cols - 1) * colSpacing) / 2;

    // 预备共享材质与几何体
    const cardGeo = new THREE.BoxGeometry(2.4, 3.4, 0.18);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x20242b,
      metalness: 0.25,
      roughness: 0.4
    });

    this.displayedItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const posX = offsetX + col * colSpacing;
      const posZ = row * rowSpacing - 6;

      const cardPivot = new THREE.Group();
      cardPivot.position.set(posX, 0, posZ);

      // 创建卡片网格
      const mesh = new THREE.Mesh(cardGeo, baseMat.clone());
      mesh.position.y = 1.7; // 使底边贴地
      mesh.castShadow = this.perfMode !== "low";
      mesh.receiveShadow = this.perfMode !== "low";

      // 异步绘制封面与微标贴图
      this.createCardTexture(item).then(tex => {
        if (this.isDestroyed || !tex) return;
        const frontMat = new THREE.MeshStandardMaterial({
          map: tex,
          metalness: 0.15,
          roughness: 0.35
        });
        // 0: right, 1: left, 2: top, 3: bottom, 4: front (+Z), 5: back (-Z)
        mesh.material = [
          baseMat, baseMat, baseMat, baseMat,
          frontMat,
          baseMat
        ];
        this.wakeUp();
      });

      cardPivot.add(mesh);
      this.cardGroup.add(cardPivot);

      const cardData = {
        item,
        index,
        col,
        row,
        basePos: new THREE.Vector3(posX, 0, posZ),
        currentPos: new THREE.Vector3(posX, 0, posZ),
        mesh,
        pivot: cardPivot,
        liftOffset: 0,
        waveOffset: 0
      };

      this.cardMeshes.push(mesh);
      this.cardDataMap.set(mesh, cardData);
    });

    this.selectedIndex = -1;
    this.closeTrendStage();
  }

  async createCardTexture(item) {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 510;
    const ctx = canvas.getContext("2d");

    // 1. 绘制底色背景
    ctx.fillStyle = "#16191f";
    ctx.fillRect(0, 0, 360, 510);

    // 2. 尝试载入并绘制封面图
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
      ctx.drawImage(loadedImg, 0, 0, 360, 430);
    } else {
      // 占位色块与文字
      ctx.fillStyle = "#262b34";
      ctx.fillRect(0, 0, 360, 430);
      ctx.fillStyle = "#707a8a";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.name.slice(0, 10), 180, 220);
    }

    // 3. 底部信息槽 (工业精密编号与中文名)
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 430, 360, 80);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "left";
    const shortTitle = item.name.length > 13 ? item.name.slice(0, 12) + "…" : item.name;
    ctx.fillText(shortTitle, 16, 465);

    ctx.fillStyle = "#8a96a6";
    ctx.font = "14px monospace";
    const metaStr = `${item.year || "2025"} · ${item.watchedEpisodes || 0}/${item.totalEpisodes || "?"}话`;
    ctx.fillText(metaStr, 16, 492);

    // 4. 左上角状态徽章
    const stateColors = {
      "已看": "#28a745",
      "在看": "#007bff",
      "想看": "#ff9900",
      "抛弃": "#6c757d",
      "未设置": "#555555"
    };
    ctx.fillStyle = stateColors[item.state] || "#007bff";
    ctx.beginPath();
    ctx.roundRect(14, 14, 60, 26, 6);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(item.state || "未设置", 44, 32);

    // 5. 右上角评分微标
    if (item.personalScore !== null || item.bangumiScore !== null) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.beginPath();
      ctx.roundRect(260, 14, 86, 26, 6);
      ctx.fill();
      ctx.fillStyle = item.personalScore !== null ? "#ffc107" : "#3b82f6";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      const sText = item.personalScore !== null ? `★ ${item.personalScore.toFixed(1)}` : `BGM ${item.bangumiScore.toFixed(1)}`;
      ctx.fillText(sText, 303, 32);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  bindEvents() {
    const el = this.viewportEl;

    // 1. 鼠标悬停拾取与光标位置
    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mouseCoord.set(x, y);

      if (this.isDraggingCard && this.selectedIndex >= 0) {
        const dx = e.clientX - this.dragStartX;
        this.targetCardRotation += dx * 0.012;
        this.dragStartX = e.clientX;
        this.wakeUp();
      }

      this.wakeUp();
    });

    // 2. 点击拾取卡片或聚焦检视
    el.addEventListener("pointerdown", (e) => {
      this.wakeUp();
      if (e.button === 0) {
        // 检测是否在点击聚焦卡片
        this.raycaster.setFromCamera(this.mouseCoord, this.camera);
        const intersects = this.raycaster.intersectObjects(this.cardMeshes);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const data = this.cardDataMap.get(hitMesh);
          if (data) {
            if (this.selectedIndex === data.index) {
              // 再次点击聚焦卡片：开启拖拽旋转打量
              this.isDraggingCard = true;
              this.dragStartX = e.clientX;
              el.style.cursor = "grabbing";
            } else {
              this.selectCard(data.index);
            }
          }
        } else {
          // 点击空白区域：若聚焦中则收起返回
          if (this.selectedIndex >= 0 && !this.isDraggingCard) {
            this.deselectCard();
          }
        }
      }
    });

    window.addEventListener("pointerup", () => {
      if (this.isDraggingCard) {
        this.isDraggingCard = false;
        el.style.cursor = "grab";
        this.wakeUp();
      }
    });

    // 3. 滚轮平移缩放 (相机微移与推拉)
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wakeUp();
      if (this.selectedIndex < 0) {
        // 阵列态：滚轮在 Z 轴上前后推拉或左右平移
        this.cameraPanZ.value += e.deltaY * 0.015;
        this.cameraPanX.value += e.deltaX * 0.015;
      }
    }, { passive: false });

    // 4. 键盘快速交互（/ 检索，Esc 返回，左右切换）
    this.keyHandler = (e) => {
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") {
        if (this.selectedIndex >= 0) this.deselectCard();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (this.displayedItems.length > 0) {
          const delta = e.key === "ArrowLeft" ? -1 : 1;
          const nextIdx = this.selectedIndex >= 0
            ? (this.selectedIndex + delta + this.displayedItems.length) % this.displayedItems.length
            : 0;
          this.selectCard(nextIdx);
        }
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    // 5. 窗口 Resize 响应
    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
      this.wakeUp();
    });
    this.resizeObserver.observe(this.viewportEl);

    // 6. 页面可见性 (后台自动切休眠)
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

  selectCard(index) {
    if (index < 0 || index >= this.displayedItems.length) return;
    this.selectedIndex = index;
    this.targetCardRotation = 0;
    this.cardRotation.value = 0;
    this.cardRotation.velocity = 0;

    const targetMesh = this.cardMeshes[index];
    const data = this.cardDataMap.get(targetMesh);
    if (!data) return;

    // 触发以该卡为中心的高斯波纹脉冲
    this.wavePulses.push({
      col: data.col,
      row: data.row,
      time: this.clock
    });

    // 镜头平滑聚焦至该卡片
    this.targetCameraAim.set(data.basePos.x, 2.5, data.basePos.z);

    // 打开三维评分趋势舞台（方案 C 融合）
    this.openTrendStage(data.item, data.basePos);
    this.renderSelectedHud(data.item);
    this.wakeUp();
  }

  deselectCard() {
    this.selectedIndex = -1;
    this.targetCardRotation = 0;
    this.targetCameraAim.set(0, 0, 0);
    this.closeTrendStage();
    this.hudLayer.empty();
    this.wakeUp();
  }

  resetCamera() {
    this.cameraPanX.value = 0;
    this.cameraPanZ.value = 0;
    this.targetZoom = 1;
    this.cameraZoom.value = 1;
    this.targetCameraAim.set(0, 0, 0);
    if (this.selectedIndex >= 0) {
      this.deselectCard();
    }
    this.wakeUp();
  }

  // ==========================================
  // 三维评分趋势舞台核心（融合方案 C）
  // ==========================================
  async openTrendStage(item, basePos) {
    this.trendStageVisible = true;
    this.currentTrendData = null;
    this.compareTrendData = null;
    this.trendStageGroup.position.set(basePos.x + 4.2, 0, basePos.z);

    // 清理前置舞台对象
    while (this.trendStageGroup.children.length > 0) {
      const o = this.trendStageGroup.children[0];
      this.trendStageGroup.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }

    // 1. 建造三维坐标网格台面 (Trend Stage Grid Base)
    const stageWidth = 7.5;
    const stageDepth = 4.2;
    const stageBaseGeo = new THREE.BoxGeometry(stageWidth, 0.1, stageDepth);
    const stageBaseMat = new THREE.MeshStandardMaterial({
      color: 0x181c24,
      metalness: 0.35,
      roughness: 0.3,
      transparent: true,
      opacity: 0.92
    });
    const stageBase = new THREE.Mesh(stageBaseGeo, stageBaseMat);
    stageBase.position.set(stageWidth / 2 - 1.0, 0.05, 0);
    this.trendStageGroup.add(stageBase);

    // 网格线
    const gridMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35 });
    const gridPoints = [];
    for (let i = 0; i <= 6; i++) {
      const gx = -1.0 + (i / 6) * stageWidth;
      gridPoints.push(new THREE.Vector3(gx, 0.12, -stageDepth / 2), new THREE.Vector3(gx, 0.12, stageDepth / 2));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const gridLine = new THREE.LineSegments(gridGeo, gridMat);
    this.trendStageGroup.add(gridLine);

    // 2. 异步拉取真实 Netaba 历史趋势数据
    if (item.subjectId) {
      try {
        const rawData = await netabaTrendService.fetchSubjectTrendData(this.app, item.subjectId);
        const normData = netabaTrendService.normalizeTrendData(rawData, item.personalScore);
        this.currentTrendData = normData;
        this.build3DTrendCurves(normData, 0x00d2ff, 0.0);
      } catch (err) {
        console.warn("3D 空间获取 Netaba 趋势失败:", err);
      }
    }

    this.wakeUp();
  }

  build3DTrendCurves(normData, colorHex = 0x00d2ff, depthZ = 0.0) {
    if (!normData || !normData.airingPoints || normData.airingPoints.length === 0) return;

    const points = normData.airingPoints;
    const minMax = normData.airingMinMax;
    const width = 6.8;
    const maxHeight = 2.8;

    const tMin = points[0].timestamp;
    const tMax = points[points.length - 1].timestamp;
    const tSpan = Math.max(1, tMax - tMin);
    const sMin = minMax.min;
    const sMax = minMax.max;
    const sSpan = Math.max(0.1, sMax - sMin);

    const curveVectors = [];
    const ribbonVectors = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const px = -0.8 + ((p.timestamp - tMin) / tSpan) * width;
      const py = 0.15 + ((p.score - sMin) / sSpan) * maxHeight;
      const pz = depthZ;

      const vec = new THREE.Vector3(px, py, pz);
      curveVectors.push(vec);

      // 发光面积能量带（从曲线连接到底盘）
      ribbonVectors.push(new THREE.Vector3(px, py, pz));
      ribbonVectors.push(new THREE.Vector3(px, 0.12, pz));
    }

    // 1. 三维发光主折线
    const curveGeo = new THREE.BufferGeometry().setFromPoints(curveVectors);
    const curveMat = new THREE.LineBasicMaterial({
      color: colorHex,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });
    const mainLine = new THREE.Line(curveGeo, curveMat);
    this.trendStageGroup.add(mainLine);

    // 2. 拔地而起的半透明发光能量带
    const ribbonGeo = new THREE.BufferGeometry();
    const ribbonVerts = [];
    for (let i = 0; i < curveVectors.length - 1; i++) {
      const p1 = curveVectors[i];
      const p2 = curveVectors[i + 1];
      // 三角面 1: (p1, p1底, p2)
      ribbonVerts.push(p1.x, p1.y, p1.z,  p1.x, 0.12, p1.z,  p2.x, p2.y, p2.z);
      // 三角面 2: (p2, p1底, p2底)
      ribbonVerts.push(p2.x, p2.y, p2.z,  p1.x, 0.12, p1.z,  p2.x, 0.12, p2.z);
    }
    ribbonGeo.setAttribute("position", new THREE.Float32BufferAttribute(ribbonVerts, 3));
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    this.trendStageGroup.add(ribbonMesh);

    // 3. “我的评分”立体基准线面
    if (normData.personalScore !== null && normData.personalScore >= sMin && normData.personalScore <= sMax) {
      const py = 0.15 + ((normData.personalScore - sMin) / sSpan) * maxHeight;
      const pLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.8, py, -1.2),
        new THREE.Vector3(-0.8 + width, py, -1.2),
        new THREE.Vector3(-0.8 + width, py, 1.2),
        new THREE.Vector3(-0.8, py, 1.2),
        new THREE.Vector3(-0.8, py, -1.2)
      ]);
      const pLineMat = new THREE.LineBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.75
      });
      const pLine = new THREE.Line(pLineGeo, pLineMat);
      this.trendStageGroup.add(pLine);
    }

    // 4. 分集播出日垂直标尺柱
    if (normData.eps && normData.eps.length > 0) {
      const pillarMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5 });
      const pillarPts = [];
      for (const ep of normData.eps) {
        if (!ep.timestamp || ep.timestamp < tMin || ep.timestamp > tMax) continue;
        const ex = -0.8 + ((ep.timestamp - tMin) / tSpan) * width;
        pillarPts.push(new THREE.Vector3(ex, 0.12, depthZ), new THREE.Vector3(ex, 1.2, depthZ));
      }
      if (pillarPts.length > 0) {
        const pillarGeo = new THREE.BufferGeometry().setFromPoints(pillarPts);
        const pillars = new THREE.LineSegments(pillarGeo, pillarMat);
        this.trendStageGroup.add(pillars);
      }
    }
  }

  closeTrendStage() {
    this.trendStageVisible = false;
    while (this.trendStageGroup.children.length > 0) {
      const o = this.trendStageGroup.children[0];
      this.trendStageGroup.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
  }

  // ==========================================
  // 2D HUD 空间映射层
  // ==========================================
  renderSelectedHud(item) {
    this.hudLayer.empty();
    const panel = this.hudLayer.createDiv("bangumi-3d-hud-panel");

    // 标题与基本元数据
    const titleEl = panel.createDiv("hud-title");
    titleEl.textContent = `《${item.name}》`;

    const subEl = panel.createDiv("hud-sub");
    subEl.textContent = `${item.japaneseName || ""} · ${item.year || "未知"} ${item.season || ""}`;

    // 评分卡片
    const scoreRow = panel.createDiv("hud-score-row");
    if (item.personalScore !== null) {
      scoreRow.createSpan({ cls: "hud-pill is-personal", text: `我的评分 ★ ${item.personalScore.toFixed(1)}` });
    }
    if (item.bangumiScore !== null) {
      scoreRow.createSpan({ cls: "hud-pill is-bgm", text: `BGM均分 ${item.bangumiScore.toFixed(1)}` });
    }
    scoreRow.createSpan({ cls: "hud-pill is-state", text: item.state || "在看" });

    // 追番进度微操作
    const progressRow = panel.createDiv("hud-progress-row");
    const watchedNum = Number(item.watchedEpisodes) || 0;
    const totalNum = Number(item.totalEpisodes) || 0;
    progressRow.createSpan({ text: `进度：${watchedNum}/${totalNum > 0 ? totalNum : "?"} 话`, cls: "hud-ep-label" });

    const btnInc = progressRow.createEl("button", { cls: "hud-action-btn", text: "已看 +1 话" });
    btnInc.onclick = async () => {
      const next = watchedNum + 1;
      await this.plugin.quickUpdateAnimeNote(item, { watchedEpisodes: next });
      item.watchedEpisodes = next;
      this.renderSelectedHud(item);
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
            cls: "hud-action-btn is-play",
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

    // 底部关闭按钮
    const closeBtn = panel.createEl("button", { cls: "hud-close-btn", text: "收起检视 (Esc)" });
    closeBtn.onclick = () => this.deselectCard();
  }

  // ==========================================
  // 主渲染帧循环与物理阻尼
  // ==========================================
  startLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.lastTime = performance.now();

    const loop = (time) => {
      if (this.isDestroyed) return;
      const dt = Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;

      const hasMovement = this.updatePhysics(dt, time / 1000);

      // 渲染场景
      this.renderer.render(this.scene, this.camera);

      // 掉帧监测
      if (dt > 0.038) { // >38ms (约低于 26fps)
        this.frameDropCounter++;
        if (this.frameDropCounter > 30 && this.perfMode !== "low") {
          console.warn("3D 空间检测到持续掉帧，自动调至节能模式");
          this.setPerformanceMode("low");
          this.frameDropCounter = 0;
        }
      } else {
        this.frameDropCounter = Math.max(0, this.frameDropCounter - 1);
      }

      // 静止自动休眠判断 (Idle Sleep)
      if (!hasMovement && !this.isDraggingCard) {
        this.idleTime += dt;
        if (this.idleTime >= 1.5) {
          this.isSleeping = true;
          this.updateStatusPill();
          this.rafId = null;
          return; // 暂停 rAF 循环，进入 0 FPS 零 GPU 占用
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
    let isMoving = false;

    // 1. 相机瞄准点阻尼
    const camAimDelta = this.cameraAim.distanceTo(this.targetCameraAim);
    if (camAimDelta > 0.001) {
      this.cameraAim.lerp(this.targetCameraAim, 7.5 * dt);
      this.camera.lookAt(this.cameraAim);
      isMoving = true;
    }

    // 2. 选中的卡片升起 (Lift & Clearance) 与旋转阻尼
    const targetLift = this.selectedIndex >= 0 ? 3.8 : 0;
    damp(this.lift, targetLift, 9.0, dt);
    damp(this.cardRotation, this.targetCardRotation, 11.0, dt);

    if (Math.abs(this.lift.value - targetLift) > 0.005 || Math.abs(this.lift.velocity) > 0.01) isMoving = true;
    if (Math.abs(this.cardRotation.value - this.targetCardRotation) > 0.005 || Math.abs(this.cardRotation.velocity) > 0.01) isMoving = true;

    // 3. 卡片阵列高斯波纹与闲置呼吸场
    for (let i = 0; i < this.cardMeshes.length; i++) {
      const mesh = this.cardMeshes[i];
      const data = this.cardDataMap.get(mesh);
      if (!data) continue;

      let waveHeight = 0;
      // 计算所有交互涟漪脉冲
      for (let pIdx = this.wavePulses.length - 1; pIdx >= 0; pIdx--) {
        const pulse = this.wavePulses[pIdx];
        const age = clockTime - pulse.time;
        if (age > 2.5) {
          this.wavePulses.splice(pIdx, 1);
          continue;
        }
        const dist = Math.hypot(data.col - pulse.col, data.row - pulse.row);
        waveHeight += 1.8 * bell(dist - age * 5.5, 1.4) * Math.exp(-age * 1.6);
        isMoving = true;
      }

      // 闲置低频呼吸波（高画质模式开启）
      if (this.perfMode === "high" && this.selectedIndex < 0) {
        waveHeight += idleWave(data.col, data.row, clockTime);
        isMoving = true;
      }

      if (data.index === this.selectedIndex) {
        // 焦点卡片：垂直升空并跟随旋转
        data.pivot.position.y = this.lift.value;
        data.pivot.rotation.y = this.cardRotation.value;
      } else {
        // 周围卡片：退居背景微下沉 + 波纹起伏
        const bgSink = this.selectedIndex >= 0 ? -0.4 : 0;
        data.pivot.position.y = bgSink + waveHeight;
        data.pivot.rotation.y = 0;
      }
    }

    return isMoving;
  }

  // ==========================================
  // 彻底销毁与显存安全释放
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

    // 递归释放所有几何体与材质纹理
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
