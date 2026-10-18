/**
 * dashboard-3d-helper.js
 * 
 * 辅助模块：动效开关、虚拟化行列计算、趋势数据健壮清洗、总览抽屉与作用域样式
 */

const DEFAULT_MOTION_SETTINGS = {
  ripple: true,        // 选中波纹
  idleWave: false,     // 闲置起伏 (默认关闭以便 1.5s 快速休眠至 0 FPS)
  parallax: true,      // 指针视差
  inertia: true,       // 拖拽惯性
  transition: true     // 详情过渡
};

/**
 * 获取动效配置（尊重 prefers-reduced-motion 与现有设置）
 */
function getMotionSettings(plugin) {
  const prefersReduced = typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const saved = plugin?.settings?.dashboard3dMotion || {};
  const current = Object.assign({}, DEFAULT_MOTION_SETTINGS, saved);

  if (prefersReduced) {
    current.ripple = false;
    current.idleWave = false;
    current.parallax = false;
    current.transition = false;
  }
  return current;
}

/**
 * 保存动效配置到 plugin.settings.dashboard3dMotion
 */
async function saveMotionSettings(plugin, settings) {
  if (!plugin) return;
  if (!plugin.settings) plugin.settings = {};
  plugin.settings.dashboard3dMotion = Object.assign({}, settings);
  if (typeof plugin.saveSettings === "function") {
    try {
      await plugin.saveSettings();
    } catch (e) {
      console.warn("保存 3D 动效设置失败:", e);
    }
  }
}

/**
 * 虚拟化排与卡片窗口计算（解决超过 48 部限制，限制同时渲染对象数）
 * 
 * @param {number} totalCount 全量筛选后的动画总数
 * @param {number} cols 列数
 * @param {number} centerRow 当前中心/目标排索引 (0 ~ rowCount-1)
 * @param {number} maxCards 当前性能档允许的最大卡片数 (18, 36, 48)
 */
function calculateVisibleRowWindow(totalCount, cols, centerRow, maxCards) {
  if (totalCount <= 0) {
    return { rowCount: 1, startRow: 0, endRow: 0, startIndex: 0, endIndex: 0 };
  }

  const rowCount = Math.max(1, Math.ceil(totalCount / cols));
  const safeCenter = Math.max(0, Math.min(rowCount - 1, centerRow));

  if (totalCount <= maxCards) {
    return {
      rowCount,
      startRow: 0,
      endRow: rowCount - 1,
      startIndex: 0,
      endIndex: totalCount - 1
    };
  }

  const windowRows = Math.max(2, Math.floor(maxCards / cols));
  const half = Math.floor(windowRows / 2);
  let startRow = Math.max(0, safeCenter - half);
  let endRow = Math.min(rowCount - 1, startRow + windowRows - 1);

  if (endRow - startRow + 1 < windowRows) {
    startRow = Math.max(0, endRow - windowRows + 1);
  }

  const startIndex = startRow * cols;
  const endIndex = Math.min(totalCount - 1, (endRow + 1) * cols - 1);

  return {
    rowCount,
    startRow,
    endRow,
    startIndex,
    endIndex
  };
}

/**
 * 对 Netaba 趋势数据做健壮性清洗（防止单点除以0、空点、缺失属性导致崩溃）
 */
function sanitizeTrendData(rawNormData) {
  if (!rawNormData) return null;
  const copy = Object.assign({}, rawNormData);

  const sanitizePoints = (pts) => {
    if (!Array.isArray(pts) || pts.length === 0) return [];
    return pts.filter(p => p && typeof p.score === "number" && !isNaN(p.score));
  };

  copy.allPoints = sanitizePoints(copy.allPoints);
  copy.airingPoints = sanitizePoints(copy.airingPoints);

  if (copy.allPoints.length === 0) {
    return null;
  }

  // 单点处理：避免 tMax === tMin 导致除以 0
  const fixMinMax = (pts, existingMinMax) => {
    let min = 5;
    let max = 8;
    if (pts.length === 1) {
      const s = pts[0].score;
      min = Math.max(1, s - 0.5);
      max = Math.min(10, s + 0.5);
    } else if (existingMinMax && typeof existingMinMax.min === "number") {
      min = existingMinMax.min;
      max = existingMinMax.max;
    }
    if (max <= min) max = min + 1;
    return { min, max };
  };

  copy.allMinMax = fixMinMax(copy.allPoints, copy.allMinMax);
  copy.airingMinMax = fixMinMax(copy.airingPoints.length > 0 ? copy.airingPoints : copy.allPoints, copy.airingMinMax);

  // 保证 3D 归一化点安全无 NaN
  const safeGenerate3D = (pts, minMax) => {
    if (!pts.length) return [];
    const t0 = pts[0].timestamp || 0;
    const t1 = pts[pts.length - 1].timestamp || t0;
    const tRange = t1 - t0 || 86400000; // 至少1天，防止除以0
    const sRange = minMax.max - minMax.min || 1;

    return pts.map(p => {
      const nx = pts.length === 1 ? 0.5 : (p.timestamp - t0) / tRange;
      const ny = (p.score - minMax.min) / sRange;
      return [isNaN(nx) ? 0.5 : nx, isNaN(ny) ? 0.5 : ny, 0];
    });
  };

  copy.points3DAll = safeGenerate3D(copy.allPoints, copy.allMinMax);
  copy.points3DAiring = safeGenerate3D(
    copy.airingPoints.length > 0 ? copy.airingPoints : copy.allPoints,
    copy.airingMinMax
  );

  return copy;
}

/**
 * 注入 scoped 到 .bangumi-3d-root 的样式
 */
function inject3DScopedStyles() {
  const styleId = "bangumi-3d-scoped-overrides";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .bangumi-3d-root {
      font-size: 14px;
    }
    /* 按钮与触控区域必须 >= 32px 高度，字号 13-16px */
    .bangumi-3d-root .bangumi-3d-btn {
      min-height: 32px;
      padding: 6px 14px;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-sizing: border-box;
      touch-action: manipulation;
    }
    .bangumi-3d-root .bangumi-3d-select {
      min-height: 32px;
      height: 32px;
      font-size: 13px;
      padding: 4px 10px;
      box-sizing: border-box;
    }
    .bangumi-3d-root .bangumi-perf-btn {
      min-height: 28px;
      font-size: 12px;
      padding: 4px 10px;
    }
    .bangumi-3d-root .hud-action-btn,
    .bangumi-3d-root .hud-close-btn {
      min-height: 34px;
      font-size: 13px;
      padding: 6px 14px;
      box-sizing: border-box;
      touch-action: manipulation;
    }
    .bangumi-3d-root .hud-sub {
      font-size: 13px;
      line-height: 1.5;
    }
    .bangumi-3d-root .hud-ep-label {
      font-size: 14px;
    }
    /* 响应式 HUD 面板：窄视口时滚动，限制最大宽度不遮挡中心卡片 */
    .bangumi-3d-root .bangumi-3d-hud-panel {
      width: 420px;
      max-width: min(420px, calc(100% - 32px));
      max-height: calc(100% - 80px);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    @media (max-width: 768px) {
      .bangumi-3d-root .bangumi-3d-toolbar {
        flex-wrap: wrap;
        top: 8px;
        left: 8px;
        right: 8px;
        gap: 6px;
      }
      .bangumi-3d-root .toolbar-section-left,
      .bangumi-3d-root .toolbar-section-right {
        flex-wrap: wrap;
        gap: 4px;
      }
      .bangumi-3d-root .bangumi-3d-title-badge {
        display: none;
      }
      .bangumi-3d-root .bangumi-3d-hud-panel {
        width: calc(100% - 24px);
        right: 12px;
        top: 86px;
        max-height: calc(100% - 100px);
        box-shadow: 0 10px 28px rgba(0,0,0,0.4);
      }
    }
    .bangumi-3d-root.is-narrow .bangumi-3d-toolbar {
      flex-wrap: wrap;
      top: 8px;
      left: 8px;
      right: 8px;
      gap: 6px;
    }
    .bangumi-3d-root.is-narrow .toolbar-section-left,
    .bangumi-3d-root.is-narrow .toolbar-section-right {
      flex-wrap: wrap;
      gap: 4px;
    }
    .bangumi-3d-root.is-narrow .bangumi-3d-title-badge {
      display: none;
    }
    .bangumi-3d-root.is-narrow .bangumi-3d-hud-panel {
      width: calc(100% - 24px);
      right: 12px;
      top: 86px;
      max-height: calc(100% - 100px);
      box-shadow: 0 10px 28px rgba(0,0,0,0.4);
    }

    /* 总览抽屉 (Overview Drawer) */
    .bangumi-3d-overview-drawer {
      position: absolute;
      inset: 0;
      background: rgba(18, 20, 24, 0.88);
      backdrop-filter: blur(12px);
      z-index: 45;
      display: flex;
      flex-direction: column;
      animation: drawerFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      color: var(--rl-text, #f0ede6);
    }
    @keyframes drawerFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .overview-drawer-header {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--rl-border, rgba(255,255,255,0.12));
      gap: 12px;
      flex-wrap: wrap;
    }
    .overview-drawer-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .overview-drawer-search {
      flex: 1;
      max-width: 320px;
      min-height: 32px;
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid var(--rl-border, rgba(255,255,255,0.2));
      background: var(--rl-surface, #1e2229);
      color: var(--rl-text, #f0ede6);
      font-size: 13px;
    }
    .overview-drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 16px;
      align-content: start;
    }
    .overview-card-item {
      background: var(--rl-surface, rgba(255,255,255,0.06));
      border: 1px solid var(--rl-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .overview-card-item:hover {
      transform: translateY(-3px);
      border-color: var(--rl-accent, #d49b35);
      box-shadow: 0 8px 20px rgba(0,0,0,0.3);
    }
    .overview-card-poster {
      width: 100%;
      aspect-ratio: 2.32 / 3.28;
      object-fit: cover;
      background: #252a33;
      display: block;
    }
    .overview-card-meta {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .overview-card-name {
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--rl-text, #f0ede6);
    }
    .overview-card-badges {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--rl-text-muted, #9aa0a6);
    }

    /* 动效设置弹窗 */
    .bangumi-3d-motion-modal {
      position: absolute;
      top: 56px;
      right: 20px;
      width: 290px;
      background: var(--rl-surface, #1e2229);
      border: 1px solid var(--rl-border, rgba(255,255,255,0.18));
      box-shadow: 0 16px 36px rgba(0,0,0,0.4);
      border-radius: 8px;
      padding: 16px;
      z-index: 40;
      backdrop-filter: blur(16px);
      animation: modalFadeIn 0.18s ease;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .motion-modal-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 12px;
      color: var(--rl-accent, #d49b35);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .motion-setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 13px;
    }
    .motion-setting-row:last-child {
      border-bottom: none;
    }
    .motion-toggle-input {
      cursor: pointer;
      width: 16px;
      height: 16px;
    }
  `;
  document.head.appendChild(style);
}

module.exports = {
  DEFAULT_MOTION_SETTINGS,
  getMotionSettings,
  saveMotionSettings,
  calculateVisibleRowWindow,
  sanitizeTrendData,
  inject3DScopedStyles
};
