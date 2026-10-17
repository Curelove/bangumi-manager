/**
 * netaba-trend-service.js
 * 
 * 第五期：Netaba 历史趋势数据获取、归一化、双层缓存与原生轻量矢量趋势图组件。
 * 同时为第六期（RhineLabUI 3D 交互式空间）提供标准化的三维曲线数据管道。
 */

const fs = require("fs");
const path = require("path");

// 内存运行时缓存：Map<subjectId, { timestamp: number, data: any }>
const memoryCache = new Map();
const MEMORY_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时

/**
 * 确保目录存在
 */
function ensureDirSync(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (e) {
    // 忽略目录创建错误
  }
}

/**
 * 获取 Vault 插件本地持久化缓存路径
 */
function getDiskCachePath(app, subjectId) {
  try {
    if (!app || !app.vault || !app.vault.adapter) return null;
    let basePath = "";
    if (typeof app.vault.adapter.getBasePath === "function") {
      basePath = app.vault.adapter.getBasePath();
    }
    if (!basePath) return null;
    const cacheDir = path.join(basePath, ".obsidian", "plugins", "bangumi-manager", ".cache", "netaba");
    ensureDirSync(cacheDir);
    return path.join(cacheDir, `${subjectId}.json`);
  } catch (e) {
    return null;
  }
}

/**
 * 从本地磁盘缓存读取
 */
function readDiskCache(app, subjectId) {
  const filePath = getDiskCachePath(app, subjectId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    return json;
  } catch (e) {
    return null;
  }
}

/**
 * 写入本地磁盘缓存
 */
function writeDiskCache(app, subjectId, data) {
  const filePath = getDiskCachePath(app, subjectId);
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
  } catch (e) {
    // 写入失败静默跳过
  }
}

/**
 * 通用 HTTP GET 请求（优先使用 Obsidian requestUrl，回退使用 https）
 */
async function requestNetabaApi(url) {
  // 1. 尝试使用 Obsidian 全局 requestUrl
  try {
    if (typeof window !== "undefined" && typeof window.requestUrl === "function") {
      const resp = await window.requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "ObsidianBangumiManager/0.3.x (https://github.com)"
        }
      });
      if (resp.status === 200) {
        return typeof resp.json === "object" ? resp.json : JSON.parse(resp.text);
      }
    }
  } catch (e) {
    console.warn("Obsidian requestUrl 请求 Netaba 失败，尝试 https 回退:", e);
  }

  // 2. 回退使用 Node.js 原生 https
  return new Promise((resolve, reject) => {
    const https = require("https");
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ObsidianBangumiManager"
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Netaba HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

/**
 * 获取动画趋势原始数据（内存 + 磁盘 + 网络）
 */
async function fetchSubjectTrendData(app, subjectId, forceRefresh = false) {
  if (!subjectId) return null;
  const sid = String(subjectId);

  // 1. 内存缓存有效且非强制刷新
  if (!forceRefresh && memoryCache.has(sid)) {
    const cached = memoryCache.get(sid);
    if (Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
      return cached.data;
    }
  }

  // 2. 磁盘持久化缓存
  if (!forceRefresh) {
    const diskData = readDiskCache(app, sid);
    if (diskData && diskData.subject && diskData.history) {
      memoryCache.set(sid, { timestamp: Date.now(), data: diskData });
      return diskData;
    }
  }

  // 3. 网络请求
  const url = `https://api.netaba.re/subject/${sid}`;
  try {
    const rawData = await requestNetabaApi(url);
    if (rawData && rawData.subject) {
      memoryCache.set(sid, { timestamp: Date.now(), data: rawData });
      writeDiskCache(app, sid, rawData);
      return rawData;
    }
  } catch (error) {
    console.error(`获取 Netaba 动画 (id=${sid}) 趋势失败:`, error);
    // 网络失败时尝试回退读取旧磁盘缓存
    const fallbackDisk = readDiskCache(app, sid);
    if (fallbackDisk) return fallbackDisk;
    throw error;
  }
  return null;
}

/**
 * 格式化 ISO 日期为 YYYY-MM-DD
 */
function formatDate(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch (e) {
    return String(isoStr).slice(0, 10);
  }
}

/**
 * 数据归一化处理（供 2D 趋势图与第 6 期 3D 空间三维发光曲线使用）
 * 
 * @param {object} rawData 从 Netaba 获取的原始 JSON ({ subject, history })
 * @param {number|null} personalScore 用户的个人评分（可为 null）
 * @returns {object} 标准化后的趋势数据模型
 */
function normalizeTrendData(rawData, personalScore = null) {
  if (!rawData || !rawData.subject || !Array.isArray(rawData.history)) {
    return null;
  }

  const { subject, history } = rawData;
  const name = subject.name_cn || subject.name || "未知动画";
  const japaneseName = subject.name || "";
  const currentScore = typeof subject.score === "number" ? subject.score : null;
  const currentRank = typeof subject.rank === "number" ? subject.rank : null;

  // 1. 首播时间与完结播出时间
  const airDate = subject.air_date ? new Date(subject.air_date) : null;
  const airTimestamp = airDate && !isNaN(airDate.getTime()) ? airDate.getTime() : null;

  // 2. 分集播出节点
  const epsList = Array.isArray(subject.eps) ? subject.eps : [];
  const normalizedEps = epsList
    .filter(ep => ep.airdate && ep.airdate !== "0000-00-00")
    .map(ep => {
      const epDate = new Date(ep.airdate);
      const ts = !isNaN(epDate.getTime()) ? epDate.getTime() : null;
      return {
        id: ep.id,
        sort: ep.sort,
        name: ep.name_cn || ep.name || `第 ${ep.sort} 话`,
        airdate: ep.airdate,
        formattedDate: formatDate(ep.airdate),
        timestamp: ts
      };
    })
    .sort((a, b) => a.sort - b.sort);

  // 最后一集开播时间戳
  let lastEpTimestamp = null;
  if (normalizedEps.length > 0) {
    const lastValid = normalizedEps[normalizedEps.length - 1];
    if (lastValid && lastValid.timestamp) {
      lastEpTimestamp = lastValid.timestamp;
    }
  }

  // 3. 历史打点数据清洗与按时间正序排序
  const validPoints = [];
  for (const item of history) {
    if (!item.recordedAt) continue;
    const itemDate = new Date(item.recordedAt);
    const ts = itemDate.getTime();
    if (isNaN(ts)) continue;

    // 分数存在且大于 0
    const scoreVal = typeof item.score === "number" && item.score > 0 ? Number(item.score.toFixed(3)) : null;
    const totalVotes = item.rating && typeof item.rating.total === "number" ? item.rating.total : 0;
    const rankVal = typeof item.rank === "number" ? item.rank : null;

    validPoints.push({
      recordedAt: item.recordedAt,
      formattedDate: formatDate(item.recordedAt),
      timestamp: ts,
      score: scoreVal,
      rank: rankVal,
      totalVotes: totalVotes,
      collect: item.collect || null
    });
  }

  validPoints.sort((a, b) => a.timestamp - b.timestamp);

  // 仅保留出分后的点
  const scoredPoints = validPoints.filter(p => p.score !== null);

  // 4. 计算“播出期间黄金窗口”
  // 范围：从开播前 7 天（若无首播则取第一个出分点），到最后一集播出后 35 天（稳定期）
  let windowStartTs = airTimestamp ? airTimestamp - 7 * 86400000 : (scoredPoints.length ? scoredPoints[0].timestamp : 0);
  let windowEndTs = lastEpTimestamp ? lastEpTimestamp + 35 * 86400000 : (airTimestamp ? airTimestamp + 100 * 86400000 : Infinity);

  let airingPoints = scoredPoints.filter(p => p.timestamp >= windowStartTs && p.timestamp <= windowEndTs);
  if (airingPoints.length < 5) {
    // 若播出期间点太少（如提前完结或老番），使用全周期点
    airingPoints = scoredPoints;
  }

  // 5. 计算分数极值（供坐标映射）
  const calculateMinMax = (pts) => {
    if (!pts.length) return { min: 5, max: 8 };
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p.score < min) min = p.score;
      if (p.score > max) max = p.score;
    }
    if (personalScore !== null && !isNaN(personalScore)) {
      if (personalScore < min) min = personalScore;
      if (personalScore > max) max = personalScore;
    }
    // 上下留 0.3 的 padding 边距
    min = Math.max(1, Math.floor((min - 0.25) * 2) / 2);
    max = Math.min(10, Math.ceil((max + 0.25) * 2) / 2);
    if (max - min < 1) {
      min = Math.max(1, min - 0.5);
      max = Math.min(10, max + 0.5);
    }
    return { min, max };
  };

  const allMinMax = calculateMinMax(scoredPoints);
  const airingMinMax = calculateMinMax(airingPoints);

  // 6. 为每个点计算匹配的当前已播出最新分集
  const attachEpInfo = (pts) => {
    return pts.map(p => {
      let currentEp = null;
      for (let i = normalizedEps.length - 1; i >= 0; i--) {
        if (normalizedEps[i].timestamp && p.timestamp >= normalizedEps[i].timestamp) {
          currentEp = normalizedEps[i];
          break;
        }
      }
      return {
        ...p,
        ep: currentEp
      };
    });
  };

  const richAllPoints = attachEpInfo(scoredPoints);
  const richAiringPoints = attachEpInfo(airingPoints);

  // 7. 为第 6 期 3D 空间预留的标准归一化三维点坐标生成器
  const generate3DPoints = (pts, minMax) => {
    if (!pts.length) return [];
    const t0 = pts[0].timestamp;
    const t1 = pts[pts.length - 1].timestamp;
    const tRange = t1 - t0 || 1;
    const sRange = minMax.max - minMax.min || 1;

    return pts.map(p => {
      const nx = (p.timestamp - t0) / tRange; // 0 ~ 1 (时间轴)
      const ny = (p.score - minMax.min) / sRange; // 0 ~ 1 (分数高低)
      const nz = 0; // 预留深度基准
      return [nx, ny, nz];
    });
  };

  return {
    subjectId: subject.id || null,
    name,
    japaneseName,
    currentScore,
    currentRank,
    airDate: airDate ? formatDate(airDate.toISOString()) : "",
    airTimestamp,
    eps: normalizedEps,
    personalScore: typeof personalScore === "number" ? personalScore : null,
    // 两个周期的点集
    allPoints: richAllPoints,
    airingPoints: richAiringPoints,
    allMinMax,
    airingMinMax,
    // 3D 接口预留
    points3DAll: generate3DPoints(richAllPoints, allMinMax),
    points3DAiring: generate3DPoints(richAiringPoints, airingMinMax)
  };
}

/**
 * 绘制原生轻量矢量 SVG 趋势图组件
 * 零外部依赖、响应式、支持深浅色主题自适应、Tooltip 悬停交互与双模式切换
 * 
 * @param {HTMLElement} container 挂载容器
 * @param {object} normData 归一化后的趋势数据
 * @param {object} options 配置选项
 */
function renderNativeTrendSvg(container, normData, options = {}) {
  container.empty();
  if (!normData || !normData.allPoints || normData.allPoints.length === 0) {
    container.createDiv({
      cls: "bangumi-trend-empty",
      text: "暂无该动画的历史评分数据（可能尚未开播或暂无足够打分样本）。"
    });
    return;
  }

  // 初始模式：默认为“播出期间”，若点数较少则自动切换为“全部周期”
  let currentMode = (normData.airingPoints.length >= 8 && !options.defaultFull) ? "airing" : "all";

  const wrapper = container.createDiv("bangumi-trend-component");

  // 顶栏控制区：标题徽章 + 模式切换 Toggle
  const header = wrapper.createDiv("bangumi-trend-header");
  const headerLeft = header.createDiv("bangumi-trend-header-left");
  
  if (normData.currentScore !== null) {
    const curBadge = headerLeft.createSpan({
      cls: "bangumi-trend-score-badge",
      text: `BGM 实时 ${normData.currentScore.toFixed(2)}`
    });
    if (normData.currentRank) {
      curBadge.title = `Bangumi 排名第 ${normData.currentRank} 名`;
    }
  }

  if (normData.personalScore !== null) {
    headerLeft.createSpan({
      cls: "bangumi-trend-personal-badge",
      text: `我的评分 ★ ${normData.personalScore.toFixed(1)}`
    });
  }

  const toggleGroup = header.createDiv("bangumi-trend-toggle-group");
  const btnAiring = toggleGroup.createEl("button", {
    cls: `bangumi-trend-btn ${currentMode === "airing" ? "is-active" : ""}`,
    text: "播出期间"
  });
  const btnAll = toggleGroup.createEl("button", {
    cls: `bangumi-trend-btn ${currentMode === "all" ? "is-active" : ""}`,
    text: "全周期"
  });

  // 主图表画布容器（具备相对定位以承载 Tooltip）
  const chartBox = wrapper.createDiv("bangumi-trend-chart-box");
  chartBox.style.position = "relative";
  chartBox.style.width = "100%";
  chartBox.style.userSelect = "none";

  // 交互式悬停 Tooltip 浮层
  const tooltip = chartBox.createDiv("bangumi-trend-tooltip");
  tooltip.style.display = "none";
  tooltip.style.position = "absolute";
  tooltip.style.pointerEvents = "none";
  tooltip.style.zIndex = "10";

  // 渲染 SVG 核心函数
  function redrawChart() {
    chartBox.querySelectorAll("svg").forEach(el => el.remove());
    tooltip.style.display = "none";

    const points = currentMode === "airing" ? normData.airingPoints : normData.allPoints;
    const minMax = currentMode === "airing" ? normData.airingMinMax : normData.allMinMax;

    if (!points || points.length === 0) {
      chartBox.createDiv({ cls: "bangumi-trend-empty", text: "该区间内暂无评分数据" });
      return;
    }

    const width = 680;
    const height = 260;
    const padding = { top: 25, right: 35, bottom: 35, left: 45 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const tMin = points[0].timestamp;
    const tMax = points[points.length - 1].timestamp;
    const tSpan = Math.max(1, tMax - tMin);
    const sMin = minMax.min;
    const sMax = minMax.max;
    const sSpan = Math.max(0.1, sMax - sMin);

    const getX = (ts) => padding.left + ((ts - tMin) / tSpan) * innerW;
    const getY = (val) => padding.top + innerH - ((val - sMin) / sSpan) * innerH;

    // 创建 SVG 根节点
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "bangumi-trend-svg");
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
    svg.style.overflow = "visible";

    // 渐变定义
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const gradientId = "trend-grad-" + Math.random().toString(36).slice(2, 9);
    defs.innerHTML = `
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--interactive-accent, #3b82f6)" stop-opacity="0.32" />
        <stop offset="100%" stop-color="var(--interactive-accent, #3b82f6)" stop-opacity="0.0" />
      </linearGradient>
    `;
    svg.appendChild(defs);

    // 1. 背景水平网格线与 Y 轴刻度
    const yGridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    yGridGroup.setAttribute("class", "trend-grid-lines");
    const step = (sMax - sMin) > 4 ? 1 : 0.5;
    for (let s = Math.ceil(sMin); s <= Math.floor(sMax); s += step) {
      const yPos = getY(s);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", padding.left);
      line.setAttribute("y1", yPos);
      line.setAttribute("x2", width - padding.right);
      line.setAttribute("y2", yPos);
      line.setAttribute("stroke", "var(--background-modifier-border, rgba(128,128,128,0.2))");
      line.setAttribute("stroke-dasharray", "3,3");
      yGridGroup.appendChild(line);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", padding.left - 8);
      text.setAttribute("y", yPos + 4);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "11");
      text.setAttribute("fill", "var(--text-muted, #888)");
      text.textContent = s.toFixed(1);
      yGridGroup.appendChild(text);
    }
    svg.appendChild(yGridGroup);

    // 2. “我的评分”横向基准虚线
    if (normData.personalScore !== null && normData.personalScore >= sMin && normData.personalScore <= sMax) {
      const py = getY(normData.personalScore);
      const pLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      pLine.setAttribute("x1", padding.left);
      pLine.setAttribute("y1", py);
      pLine.setAttribute("x2", width - padding.right);
      pLine.setAttribute("y2", py);
      pLine.setAttribute("stroke", "var(--text-accent, #e5a00d)");
      pLine.setAttribute("stroke-width", "1.5");
      pLine.setAttribute("stroke-dasharray", "5,4");
      svg.appendChild(pLine);

      const pLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pLabel.setAttribute("x", width - padding.right + 4);
      pLabel.setAttribute("y", py + 3);
      pLabel.setAttribute("font-size", "10");
      pLabel.setAttribute("font-weight", "600");
      pLabel.setAttribute("fill", "var(--text-accent, #e5a00d)");
      pLabel.textContent = `我的: ${normData.personalScore.toFixed(1)}`;
      svg.appendChild(pLabel);
    }

    // 3. X 轴时间刻度（均匀采样 4~5 个时间标签）
    const xGridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const numLabels = 5;
    for (let i = 0; i < numLabels; i++) {
      const ratio = i / (numLabels - 1);
      const ptIndex = Math.min(points.length - 1, Math.round(ratio * (points.length - 1)));
      const p = points[ptIndex];
      const xPos = getX(p.timestamp);

      const tText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tText.setAttribute("x", xPos);
      tText.setAttribute("y", height - 12);
      tText.setAttribute("text-anchor", "middle");
      tText.setAttribute("font-size", "10");
      tText.setAttribute("fill", "var(--text-muted, #888)");
      tText.textContent = p.formattedDate.slice(5); // MM-DD
      xGridGroup.appendChild(tText);
    }
    svg.appendChild(xGridGroup);

    // 4. 计算三次贝塞尔平滑路径 (Catmull-Rom 或三次贝塞尔拟合)
    const coords = points.map(p => ({ x: getX(p.timestamp), y: getY(p.score) }));
    let pathD = "";
    if (coords.length > 0) {
      pathD = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
      for (let i = 0; i < coords.length - 1; i++) {
        const p0 = coords[i === 0 ? 0 : i - 1];
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        pathD += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      }
    }

    // 面积阴影填充
    if (pathD) {
      const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;
      const areaPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      areaPath.setAttribute("d", areaD);
      areaPath.setAttribute("fill", `url(#${gradientId})`);
      svg.appendChild(areaPath);

      // 主折线
      const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      linePath.setAttribute("d", pathD);
      linePath.setAttribute("fill", "none");
      linePath.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
      linePath.setAttribute("stroke-width", "2.4");
      linePath.setAttribute("stroke-linecap", "round");
      linePath.setAttribute("stroke-linejoin", "round");
      svg.appendChild(linePath);
    }

    // 5. 分集首播节点标尺（eps markers）
    const epMarkerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    epMarkerGroup.setAttribute("class", "trend-ep-markers");
    for (const ep of normData.eps) {
      if (!ep.timestamp || ep.timestamp < tMin || ep.timestamp > tMax) continue;
      const ex = getX(ep.timestamp);

      // 垂直小刻度虚线
      const epLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      epLine.setAttribute("x1", ex);
      epLine.setAttribute("y1", padding.top + innerH - 6);
      epLine.setAttribute("x2", ex);
      epLine.setAttribute("y2", padding.top + innerH);
      epLine.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
      epLine.setAttribute("stroke-width", "1.5");
      epMarkerGroup.appendChild(epLine);

      // 标记文字（例如 "1", "3", "12"）
      if (ep.sort === 1 || ep.sort === normData.eps.length || ep.sort % 3 === 0) {
        const epText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        epText.setAttribute("x", ex);
        epText.setAttribute("y", padding.top + innerH + 12);
        epText.setAttribute("text-anchor", "middle");
        epText.setAttribute("font-size", "9");
        epText.setAttribute("font-weight", "600");
        epText.setAttribute("fill", "var(--interactive-accent, #3b82f6)");
        epText.textContent = `E${ep.sort}`;
        epMarkerGroup.appendChild(epText);
      }
    }
    svg.appendChild(epMarkerGroup);

    // 6. 交互悬停辅助元素：十字垂直线与高亮圆点
    const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
    crosshair.setAttribute("y1", padding.top);
    crosshair.setAttribute("y2", padding.top + innerH);
    crosshair.setAttribute("stroke", "var(--text-accent, #3b82f6)");
    crosshair.setAttribute("stroke-width", "1.2");
    crosshair.setAttribute("stroke-dasharray", "4,3");
    crosshair.style.display = "none";
    svg.appendChild(crosshair);

    const activeDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    activeDot.setAttribute("r", "4.5");
    activeDot.setAttribute("fill", "var(--background-primary, #fff)");
    activeDot.setAttribute("stroke", "var(--interactive-accent, #3b82f6)");
    activeDot.setAttribute("stroke-width", "2.5");
    activeDot.style.display = "none";
    svg.appendChild(activeDot);

    // 7. 交互透明遮罩层监听光标移动
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    overlay.setAttribute("x", padding.left);
    overlay.setAttribute("y", padding.top);
    overlay.setAttribute("width", innerW);
    overlay.setAttribute("height", innerH);
    overlay.setAttribute("fill", "transparent");
    overlay.style.cursor = "crosshair";

    overlay.onpointermove = (e) => {
      const rect = svg.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      // 逆映射到 SVG 坐标
      const svgX = (clientX / rect.width) * width;
      if (svgX < padding.left || svgX > width - padding.right) {
        crosshair.style.display = "none";
        activeDot.style.display = "none";
        tooltip.style.display = "none";
        return;
      }

      // 二分查找或最近点查找
      let closestPt = points[0];
      let minDiff = Infinity;
      for (const p of points) {
        const px = getX(p.timestamp);
        const diff = Math.abs(px - svgX);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = p;
        }
      }

      const cx = getX(closestPt.timestamp);
      const cy = getY(closestPt.score);

      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.style.display = "block";

      activeDot.setAttribute("cx", cx);
      activeDot.setAttribute("cy", cy);
      activeDot.style.display = "block";

      // 更新 Tooltip 内容与定位
      tooltip.empty();
      tooltip.style.display = "block";

      const tDate = tooltip.createDiv("trend-tip-date");
      tDate.textContent = closestPt.formattedDate;

      const tScore = tooltip.createDiv("trend-tip-score");
      tScore.innerHTML = `<span class="score-num">${closestPt.score.toFixed(2)}</span> <span class="score-label">分</span>`;

      if (closestPt.rank) {
        const tRank = tooltip.createDiv("trend-tip-meta");
        tRank.textContent = `全站排名: 第 ${closestPt.rank} 位`;
      }
      if (closestPt.totalVotes) {
        const tVotes = tooltip.createDiv("trend-tip-meta");
        tVotes.textContent = `评分人数: ${closestPt.totalVotes} 人`;
      }
      if (closestPt.ep) {
        const tEp = tooltip.createDiv("trend-tip-ep");
        tEp.textContent = `当时已播: 第 ${closestPt.ep.sort} 话`;
      }

      // 计算 Tooltip 相对 chartBox 的像素坐标
      const scaleX = rect.width / width;
      const scaleY = rect.height / height;
      const pixelX = cx * scaleX;
      const pixelY = cy * scaleY;

      // 防贴边翻转
      const isRight = pixelX > rect.width * 0.65;
      tooltip.style.left = isRight ? `${pixelX - 145}px` : `${pixelX + 15}px`;
      tooltip.style.top = `${Math.max(10, pixelY - 45)}px`;
    };

    overlay.onpointerleave = () => {
      crosshair.style.display = "none";
      activeDot.style.display = "none";
      tooltip.style.display = "none";
    };

    svg.appendChild(overlay);
    chartBox.appendChild(svg);
  }

  // 绑定模式切换点击事件
  btnAiring.onclick = () => {
    if (currentMode === "airing") return;
    currentMode = "airing";
    btnAiring.classList.add("is-active");
    btnAll.classList.remove("is-active");
    redrawChart();
  };

  btnAll.onclick = () => {
    if (currentMode === "all") return;
    currentMode = "all";
    btnAll.classList.add("is-active");
    btnAiring.classList.remove("is-active");
    redrawChart();
  };

  // 首次绘制
  redrawChart();
}

/**
 * Netaba 评分趋势独立弹窗（NetabaTrendModal）
 */
function createNetabaTrendModalClass({ Modal, Notice }) {
  return class NetabaTrendModal extends Modal {
    constructor(app, plugin, item) {
      super(app);
      this.plugin = plugin;
      this.item = item;
    }

    async onOpen() {
      const { contentEl } = this;
      contentEl.empty();
      this.modalEl.style.width = "min(760px, 92vw)";
      this.modalEl.style.maxWidth = "92vw";
      this.modalEl.style.padding = "20px 24px";

      const header = contentEl.createDiv("bangumi-trend-modal-title");
      header.createEl("h2", { text: `《${this.item.name}》评分历史趋势` });
      
      const sub = contentEl.createDiv("bangumi-trend-modal-sub");
      sub.style.color = "var(--text-muted)";
      sub.style.fontSize = "13px";
      sub.style.marginBottom = "14px";
      sub.textContent = `${this.item.japaneseName || ""} · 数据来源于 Netaba.re 时间序列归档`;

      const chartContainer = contentEl.createDiv("bangumi-trend-modal-body");
      chartContainer.style.minHeight = "280px";
      chartContainer.style.display = "flex";
      chartContainer.style.alignItems = "center";
      chartContainer.style.justifyContent = "center";
      chartContainer.createDiv({ text: "正在从 Netaba 获取时间序列数据……", cls: "bangumi-trend-loading" });

      try {
        const rawData = await fetchSubjectTrendData(this.app, this.item.subjectId);
        chartContainer.empty();
        chartContainer.style.display = "block";
        const normData = normalizeTrendData(rawData, this.item.personalScore);
        renderNativeTrendSvg(chartContainer, normData, { defaultFull: false });
      } catch (err) {
        chartContainer.empty();
        chartContainer.createDiv({
          cls: "bangumi-trend-error",
          text: `读取 Netaba 评分趋势失败: ${err.message || "网络或接口超时"}`
        });
      }

      // 底部操作链接
      const footer = contentEl.createDiv("bangumi-trend-modal-footer");
      footer.style.marginTop = "16px";
      footer.style.display = "flex";
      footer.style.justifyContent = "space-between";
      footer.style.alignItems = "center";

      const leftLinks = footer.createDiv();
      if (this.item.subjectId) {
        const netabaLink = leftLinks.createEl("a", {
          text: "🌐 打开 Netaba 页面",
          href: `https://netaba.re/subject/${this.item.subjectId}`
        });
        netabaLink.style.marginRight = "14px";
        netabaLink.style.fontSize = "12px";

        const bgmLink = leftLinks.createEl("a", {
          text: "📺 打开 Bangumi 原站",
          href: `https://bgm.tv/subject/${this.item.subjectId}`
        });
        bgmLink.style.fontSize = "12px";
      }

      const closeBtn = footer.createEl("button", { text: "关闭" });
      closeBtn.onclick = () => this.close();
    }

    onClose() {
      this.contentEl.empty();
    }
  };
}

module.exports = {
  fetchSubjectTrendData,
  normalizeTrendData,
  renderNativeTrendSvg,
  createNetabaTrendModalClass
};
