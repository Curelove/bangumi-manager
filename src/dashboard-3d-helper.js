import * as THREE from "three";
const { getCachedAtelierPrototype } = require("./atelier-3d-pack-service");

let _sharedPaperBumpTex = null;
function getSharedPaperBumpTexture() {
  if (_sharedPaperBumpTex) return _sharedPaperBumpTex;
  if (typeof document === "undefined") return null;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const imgData = ctx.createImageData(size, size);
  const d = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h1 = (((x * 73856093) ^ (y * 19349663) ^ 17) >>> 0) % 255;
      const h2 = (((Math.floor(x / 2) * 83492791) ^ (Math.floor(y / 2) * 297121507)) >>> 0) % 255;
      const v = Math.round(h1 * 0.55 + h2 * 0.45);
      const idx = (y * size + x) * 4;
      d[idx] = v;
      d[idx + 1] = v;
      d[idx + 2] = v;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  tex.userData = { sharedPrototype: true };
  _sharedPaperBumpTex = tex;
  return tex;
}

const _miteredGeomCache = new Map();
/**
 * 构建零角落重叠的一体流形 45° 斜拼画框 / 45° 斜切白芯装裱卡窗几何体
 * 彻底根除原 4 条 BoxGeometry 在四个角落 100% 空间共面导致的运动像素抖动
 */
function getMiteredFrameGeometry(outerW, outerH, innerW, innerH, zBack, zFront, innerChamfer = 0) {
  const key = [outerW, outerH, innerW, innerH, zBack, zFront, innerChamfer]
    .map((n) => Number(n).toFixed(4))
    .join("|");
  if (_miteredGeomCache.has(key)) return _miteredGeomCache.get(key);

  const ox = outerW * 0.5;
  const oy = outerH * 0.5;
  const ix0 = innerW * 0.5;
  const iy0 = innerH * 0.5;
  const ixF = ix0 + innerChamfer;
  const iyF = iy0 + innerChamfer;

  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ];
  const outerF = signs.map(([sx, sy]) => [sx * ox, sy * oy, zFront]);
  const outerB = signs.map(([sx, sy]) => [sx * ox, sy * oy, zBack]);
  const innerF = signs.map(([sx, sy]) => [sx * ixF, sy * iyF, zFront]);
  const innerB = signs.map(([sx, sy]) => [sx * ix0, sy * iy0, zBack]);

  const positions = [];
  const uvs = [];
  const outerIndices = [];
  const chamferIndices = [];
  let vertCursor = 0;

  const pushQuad = (p0, p1, p2, p3, targetIdxArr) => {
    const base = vertCursor;
    for (const p of [p0, p1, p2, p3]) {
      positions.push(p[0], p[1], p[2]);
      uvs.push(p[0] * 0.45 + 0.5, p[1] * 0.35 + 0.5);
    }
    targetIdxArr.push(base, base + 1, base + 2, base, base + 2, base + 3);
    vertCursor += 4;
  };

  for (let i = 0; i < 4; i++) {
    const ni = (i + 1) % 4;
    // 正面 45° 斜拼面
    pushQuad(outerF[i], outerF[ni], innerF[ni], innerF[i], outerIndices);
    // 背面 45° 斜拼面
    pushQuad(innerB[i], innerB[ni], outerB[ni], outerB[i], outerIndices);
    // 外周侧壁
    pushQuad(outerB[i], outerB[ni], outerF[ni], outerF[i], outerIndices);
    // 内窗 45° 斜切壁（可赋独立白芯材质槽）
    pushQuad(innerF[i], innerF[ni], innerB[ni], innerB[i], chamferIndices);
  }

  const allIndices = [...outerIndices, ...chamferIndices];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(allIndices);
  geom.clearGroups();
  geom.addGroup(0, outerIndices.length, 0);
  geom.addGroup(outerIndices.length, chamferIndices.length, 1);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  geom.userData = { sharedPrototype: true };

  _miteredGeomCache.set(key, geom);
  return geom;
}

const DEFAULT_MOTION_SETTINGS = Object.freeze({
  intro: true,
  Selection: true,
  hover: true,
  transition: true,
  breath: true,
  breathing: true
});

const SERIF_FONT_STACK =
  '"Source Han Serif SC", "Source Han Serif CN", "Noto Serif SC", "Noto Serif CJK SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const SANS_FONT_STACK =
  '"Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const MONO_FONT_STACK =
  '"JetBrains Mono", "Cascadia Mono", "Consolas", monospace';

const DEFAULT_LANE_CONFIGS = Object.freeze([
  {
    id: "lane-watching",
    name: "正在追番",
    badge: "追 · WATCHING",
    accent: "#8c6239",
    sourceType: "state",
    sourceValue: "在看",
    sortBy: "progressDesc",
    visible: true,
    plaqueNote: "正在连载跟进 · 实时进度"
  },
  {
    id: "lane-completed",
    name: "已看典藏",
    badge: "藏 · COMPLETED",
    accent: "#4a6b5d",
    sourceType: "state",
    sourceValue: "已看",
    sortBy: "scoreDesc",
    visible: true,
    plaqueNote: "完结归档 · 馆藏正编"
  },
  {
    id: "lane-plan",
    name: "想看计划",
    badge: "候 · PLAN",
    accent: "#526682",
    sourceType: "state",
    sourceValue: "想看",
    sortBy: "bgmDesc",
    visible: true,
    plaqueNote: "待看备忘 · 候选片单"
  },
  {
    id: "lane-dropped",
    name: "抛弃归档",
    badge: "封 · DROPPED",
    accent: "#7a6560",
    sourceType: "state",
    sourceValue: "抛弃",
    sortBy: "yearDesc",
    visible: true,
    plaqueNote: "中止观看 · 封存记录"
  }
]);

function cloneDefaultLaneConfigs() {
  return DEFAULT_LANE_CONFIGS.map((lane) => Object.assign({}, lane));
}

function normalizeLaneConfigs(rawList) {
  if (!Array.isArray(rawList) || !rawList.length) {
    return cloneDefaultLaneConfigs();
  }
  const normalized = rawList
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, idx) => {
      const fallback = DEFAULT_LANE_CONFIGS[idx % DEFAULT_LANE_CONFIGS.length];
      return {
        id: String(entry.id || `lane-custom-${idx + 1}`),
        name: String(entry.name || fallback.name).trim() || fallback.name,
        badge: String(entry.badge || `轨 0${idx + 1}`).trim() || `轨 0${idx + 1}`,
        accent: String(entry.accent || fallback.accent).trim() || fallback.accent,
        sourceType: [
          "state",
          "scoreRange",
          "year",
          "tag",
          "studio",
          "manual",
          "unarchived"
        ].includes(entry.sourceType)
          ? entry.sourceType
          : "state",
        sourceValue:
          entry.sourceValue !== undefined && entry.sourceValue !== null
            ? String(entry.sourceValue).trim()
            : fallback.sourceValue,
        sortBy: [
          "scoreDesc",
          "bgmDesc",
          "yearDesc",
          "nameAsc",
          "progressDesc"
        ].includes(entry.sortBy)
          ? entry.sortBy
          : "scoreDesc",
        visible: entry.visible !== false,
        plaqueNote:
          entry.plaqueNote !== undefined && entry.plaqueNote !== null
            ? String(entry.plaqueNote).trim()
            : fallback.plaqueNote
      };
    });

  if (!normalized.some((lane) => lane.visible)) {
    if (normalized[0]) normalized[0].visible = true;
  }

  return normalized.length ? normalized : cloneDefaultLaneConfigs();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function getMotionSettings(plugin) {
  const saved = plugin?.settings?.dashboard3dMotion || {};
  return Object.assign({}, DEFAULT_MOTION_SETTINGS, saved);
}

async function saveMotionSettings(plugin, nextSettings = {}) {
  if (!plugin) return getMotionSettings(null);
  plugin.settings = plugin.settings || {};
  plugin.settings.dashboard3dMotion = Object.assign(
    {},
    DEFAULT_MOTION_SETTINGS,
    plugin.settings.dashboard3dMotion || {},
    nextSettings
  );

  if (typeof plugin.saveSettings === "function") {
    await plugin.saveSettings();
  }

  return plugin.settings.dashboard3dMotion;
}

function calculateVisibleRowWindow(scrollPosition, spacing, radius = 8) {
  const safeSpacing = Number(spacing) > 0 ? Number(spacing) : 1;
  const centerRow = Math.round((Number(scrollPosition) || 0) / safeSpacing);
  const half = Math.max(1, Math.floor(radius));

  return {
    centerRow,
    startRow: centerRow - half,
    endRow: centerRow + half,
    totalRows: half * 2 + 1
  };
}

function sanitizeTrendData(rawData) {
  if (!rawData || typeof rawData !== "object") return null;

  const clean = (points) => {
    if (!Array.isArray(points)) return [];

    return points
      .filter((point) => {
        if (!point) return false;
        const rawTs = point.timestamp ?? point.ts;
        return Number.isFinite(Number(rawTs)) && Number.isFinite(Number(point.score));
      })
      .map((point) => {
        const tsNum = Number(point.timestamp ?? point.ts);
        return {
          ...point,
          timestamp: tsNum,
          ts: tsNum,
          score: Number(point.score)
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const result = Object.assign({}, rawData);
  result.allPoints = clean(rawData.allPoints);
  result.airingPoints = clean(rawData.airingPoints);
  result.eps = Array.isArray(rawData.eps) ? rawData.eps.filter(Boolean) : [];

  if (!result.allPoints.length) return null;

  const range = (points, existing) => {
    if (
      existing &&
      Number.isFinite(existing.min) &&
      Number.isFinite(existing.max) &&
      existing.max > existing.min
    ) {
      return { min: Number(existing.min), max: Number(existing.max) };
    }

    const values = (points.length ? points : result.allPoints)
      .map((point) => point.score);

    const min = Math.max(1, Math.min(...values) - 0.5);
    const max = Math.min(10, Math.max(...values) + 0.5);

    return { min, max: max > min ? max : min + 1 };
  };

  result.allMinMax = range(result.allPoints, rawData.allMinMax);
  result.airingMinMax = range(result.airingPoints, rawData.airingMinMax);

  return result;
}

function getInkPigmentHex(rawHex) {
  try {
    const color = new THREE.Color(rawHex || "#b88a68");
    const hsl = {};
    color.getHSL(hsl);
    color.setHSL(
      hsl.h,
      clamp(hsl.s * 1.18, 0.34, 0.58),
      clamp(hsl.l * 0.72, 0.42, 0.58)
    );
    return "#" + color.getHexString();
  } catch (e) {
    return "#9b7247";
  }
}

class CoverPaletteExtractor {
  constructor() {
    this.cache = new Map();
  }

  async extract(url) {
    const fallback = "#d9c6b4";
    if (!url) return fallback;
    if (this.cache.has(url)) return this.cache.get(url);
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return fallback;
    }

    try {
      const image = new Image();
      image.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;

      const context = canvas.getContext("2d", {
        willReadFrequently: true
      });

      if (!context) return fallback;

      context.drawImage(image, 0, 0, 32, 32);

      const pixels = context.getImageData(0, 0, 32, 32).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let total = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        if (alpha < 100 || max < 24 || min > 242) continue;

        const saturationBoost = (max - min) / 255;
        const weight = 0.25 + saturationBoost * 1.65;
        red += r * weight;
        green += g * weight;
        blue += b * weight;
        total += weight;
      }

      const color = new THREE.Color(
        total ? red / total / 255 : 0.82,
        total ? green / total / 255 : 0.76,
        total ? blue / total / 255 : 0.7
      );

      const hsl = {};
      color.getHSL(hsl);
      color.setHSL(
        hsl.h,
        clamp(hsl.s, 0.30, 0.52),
        clamp(hsl.l, 0.66, 0.80)
      );

      const result = "#" + color.getHexString();
      this.cache.set(url, result);
      return result;
    } catch (error) {
      this.cache.set(url, fallback);
      return fallback;
    }
  }

  clear() {
    this.cache.clear();
  }
}

class AtelierAudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.enabled = false;
    this.ambientTimer = null;
    this.nodes = new Set();
    this.chordIndex = 0;
    this.ambientIntervalMs = 7600;
    this.lowpassCutoffHz = 680;
    this.voicings = [
      [174.61, 220.00, 261.63, 329.63], // Fmaj7 暖调
      [146.83, 220.00, 261.63, 293.66], // Dm7 柔和
      [116.54, 174.61, 220.00, 261.63], // Bbmaj7 低沉温润
      [130.81, 196.00, 246.94, 293.66]  // Cmaj9 静谧开阔
    ];
  }

  ensureContext() {
    if (this.context) return true;
    if (typeof window === "undefined") return false;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;

    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;

      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.025;
      this.compressor.release.value = 0.35;

      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      return true;
    } catch (error) {
      this.context = null;
      this.master = null;
      this.compressor = null;
      return false;
    }
  }

  async resume() {
    if (!this.ensureContext()) return false;

    try {
      if (this.context.state !== "running") {
        await this.context.resume();
      }

      if (this.master) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(0.0001, now);
        this.master.gain.exponentialRampToValueAtTime(0.22, now + 0.24);
      }

      return this.context.state === "running";
    } catch (error) {
      return false;
    }
  }

  async setEnabled(enabled, userGesture = false) {
    this.enabled = Boolean(enabled);

    if (!this.enabled) {
      this.stopAmbient();
      if (this.context && this.context.state === "running") {
        try {
          await this.context.suspend();
        } catch (error) {
          // 忽略挂起异常
        }
      }
      return false;
    }

    const running = await this.resume();

    if (!running) {
      this.enabled = false;
      return false;
    }

    if (userGesture) this.cue("wake");
    this.startAmbient();
    return true;
  }

  startAmbient() {
    if (!this.enabled || !this.context || this.ambientTimer) return;

    this.playAmbientChord();

    this.ambientTimer = window.setInterval(() => {
      this.playAmbientChord();
    }, this.ambientIntervalMs);
  }

  stopAmbient() {
    if (this.ambientTimer) {
      window.clearInterval(this.ambientTimer);
      this.ambientTimer = null;
    }
  }

  makeVoice(frequency, start, end, volume, pan) {
    if (!this.context || !this.master) return;

    const primary = this.context.createOscillator();
    const subWarmth = this.context.createOscillator();
    const subGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const stereo = this.context.createStereoPanner
      ? this.context.createStereoPanner()
      : null;

    // 温暖室内低中频声学结构：基频正弦波 + 低八度柔和三角波共鸣，彻底移除原 2.005 倍高频泛音
    primary.type = "sine";
    subWarmth.type = "triangle";
    primary.frequency.value = frequency;
    subWarmth.frequency.value = frequency * 0.5;
    subWarmth.detune.value = pan * 4;
    subGain.gain.value = 0.26;

    filter.type = "lowpass";
    filter.frequency.value = 680;
    filter.Q.value = 0.35;

    const attackEnd = Math.min(end - 0.4, start + 1.65);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    primary.connect(filter);
    subWarmth.connect(subGain);
    subGain.connect(filter);
    filter.connect(gain);

    if (stereo) {
      stereo.pan.value = pan;
      gain.connect(stereo);
      stereo.connect(this.master);
    } else {
      gain.connect(this.master);
    }

    primary.start(start);
    subWarmth.start(start);
    primary.stop(end);
    subWarmth.stop(end);

    this.nodes.add(primary);
    this.nodes.add(subWarmth);

    primary.addEventListener("ended", () => {
      this.nodes.delete(primary);
      this.nodes.delete(subWarmth);
    }, { once: true });
  }

  playAmbientChord() {
    if (!this.enabled || !this.context || !this.master) return;

    // 温暖中低音区四声部室内和弦（音域 Bb2 116.5Hz ~ E4 329.6Hz，绝不触及刺耳高音区）
    const chords = [
      [174.61, 220.00, 261.63, 329.63], // Fmaj7 暖调
      [146.83, 220.00, 261.63, 293.66], // Dm7 柔和
      [116.54, 174.61, 220.00, 293.66], // Bbmaj7 沉静
      [130.81, 196.00, 246.94, 293.66]  // Cmaj9 呼吸
    ];

    const notes = chords[this.chordIndex % chords.length];
    this.chordIndex += 1;

    const start = this.context.currentTime + 0.04;
    const duration = 6.8;

    notes.forEach((frequency, index) => {
      const noteStart = start + index * 0.42;
      const noteEnd = noteStart + duration;
      const pan = ((index % 2 === 0 ? -1 : 1) * (0.14 + index * 0.05));
      this.makeVoice(
        frequency,
        noteStart,
        noteEnd,
        0.022,
        clamp(pan, -0.35, 0.35)
      );
    });
  }

  cue(type) {
    if (!this.enabled || !this.context || !this.master) return;

    const now = this.context.currentTime + 0.005;

    const tone = (frequency, delay, duration, volume, direction, cutoff = 760, wave = "sine") => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();

      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, now + delay);

      if (direction > 0) {
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 1.18,
          now + delay + duration
        );
      } else if (direction < 0) {
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 0.78,
          now + delay + duration
        );
      }

      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      filter.Q.value = 0.4;

      const attack = Math.min(0.028, duration * 0.3);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(
        volume,
        now + delay + attack
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + delay + duration
      );

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      oscillator.start(now + delay);
      oscillator.stop(now + delay + duration + 0.02);

      this.nodes.add(oscillator);
      oscillator.addEventListener("ended", () => {
        this.nodes.delete(oscillator);
      }, { once: true });
    };

    if (type === "wake") {
      // 室内空间轻柔唤醒：G3 -> D4 低中频暖五度
      tone(196.00, 0, 0.24, 0.065, 0, 720, "sine");
      tone(293.66, 0.08, 0.32, 0.052, 0, 820, "triangle");
    } else if (type === "tick") {
      // 纸卡检阅微擦声：短促温暖木质轻触
      tone(185.00, 0, 0.042, 0.036, -1, 520, "triangle");
    } else if (type === "open") {
      // 封套提拉抽出声：A3 -> C#4 温润上行木质共鸣
      tone(220.00, 0, 0.20, 0.058, 1, 740, "triangle");
      tone(277.18, 0.07, 0.26, 0.048, 0, 840, "sine");
    } else if (type === "sheet") {
      // 随附笔记纸页抽出声：纸张轻滑展开
      tone(246.94, 0, 0.16, 0.048, 1, 760, "sine");
      tone(329.63, 0.055, 0.20, 0.042, 0, 860, "triangle");
    } else if (type === "sheet-close") {
      // 随附笔记纸页收回声：柔和收拢入袋
      tone(311.13, 0, 0.14, 0.042, -1, 680, "sine");
      tone(220.00, 0.045, 0.18, 0.038, -1, 600, "triangle");
    } else if (type === "confirm") {
      // 印章/评分落定声：中音区温润双点
      tone(261.63, 0, 0.09, 0.052, 0, 820, "triangle");
      tone(329.63, 0.065, 0.14, 0.044, 0, 880, "sine");
    } else if (type === "back") {
      // 档案归位落槽声：B3 -> E3 沉稳下行收束
      tone(246.94, 0, 0.18, 0.055, -1, 660, "triangle");
      tone(164.81, 0.065, 0.24, 0.048, -1, 560, "sine");
    }
  }

  fadeOutAndSuspend() {
    if (!this.context || !this.master) return;

    const now = this.context.currentTime;
    const value = Math.max(0.0001, this.master.gain.value);

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(value, now);
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    window.setTimeout(() => {
      if (this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 230);
  }

  destroy() {
    this.stopAmbient();

    for (const node of this.nodes) {
      try {
        node.stop();
      } catch (error) {
        // 节点可能已经结束。
      }
    }

    this.nodes.clear();

    if (this.context) {
      this.context.close().catch(() => {});
    }

    this.context = null;
    this.master = null;
    this.compressor = null;
    this.enabled = false;
  }
}

class RollingNumber {
  constructor(element, value = 0) {
    this.element = element;
    this.value = Number(value) || 0;
    this.timer = null;
    this.render(this.value, false);
  }

  set(value) {
    const next = Math.max(0, Number(value) || 0);
    if (next === this.value) return;
    this.value = next;
    this.render(next, true);
  }

  render(value, animate) {
    if (!this.element) return;

    this.element.textContent = String(value).padStart(2, "0");
    this.element.classList.toggle("is-rolling", Boolean(animate));

    if (this.timer) window.clearTimeout(this.timer);

    if (animate) {
      this.timer = window.setTimeout(() => {
        this.element?.classList.remove("is-rolling");
        this.timer = null;
      }, 460);
    }
  }

  destroy() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

class ScrubTitle {
  constructor(element) {
    this.element = element;
    this.lastAt = 0;
    this.timer = null;
    this.pendingText = "";
  }

  set(text) {
    if (!this.element) return;

    const next = String(text || "");
    const now = Date.now();
    const rapid = now - this.lastAt < 240;

    this.lastAt = now;
    this.pendingText = next;

    if (this.timer) window.clearTimeout(this.timer);

    if (!rapid) {
      this.element.textContent = next;
      this.element.classList.remove("is-scrubbing");
      return;
    }

    this.element.textContent = "";
    this.element.classList.add("is-scrubbing");

    this.timer = window.setTimeout(() => {
      if (this.element) {
        this.element.textContent = this.pendingText;
        this.element.classList.remove("is-scrubbing");
      }
      this.timer = null;
    }, 260);
  }

  destroy() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

function makeCanvasTexture(width, height, draw, renderScale = 1) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * renderScale);
  canvas.height = Math.round(height * renderScale);

  const context = canvas.getContext("2d");
  if (!context) return null;

  if (renderScale !== 1) {
    context.scale(renderScale, renderScale);
  }
  draw(context, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function tokenizeMixedTitle(rawText) {
  const text = String(rawText || "未命名档案").trim() || "未命名档案";
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/[A-Za-z0-9._+-]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9._+-]/.test(text[j])) j += 1;
      tokens.push(text.slice(i, j));
      i = j;
    } else if (/\s/.test(ch)) {
      tokens.push(" ");
      while (i < text.length && /\s/.test(text[i])) i += 1;
    } else {
      tokens.push(ch);
      i += 1;
    }
  }
  return tokens;
}

function wrapTokensToLines(context, tokens, maxWidth) {
  const lines = [];
  let current = "";

  for (const token of tokens) {
    if (token === " " && !current) continue;
    const candidate = current + token;
    if (context.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current.trimEnd());
      current = token === " " ? "" : token;
    }
  }

  if (current.trim()) {
    lines.push(current.trimEnd());
  }

  return lines;
}

function fitTitleLines(
  context,
  rawTitle,
  maxWidth,
  fontFamily = SERIF_FONT_STACK,
  options = {}
) {
  const text = String(rawTitle || "未命名档案").trim() || "未命名档案";
  const tokens = tokenizeMixedTitle(text);
  const candidateSizes = options.candidateSizes || [52, 46, 40, 35, 31, 27];
  const weight = options.fontWeight || 700;
  const allowThreeLinesSize = options.threeLineSize || 0;

  for (const fontSize of candidateSizes) {
    context.font = `${weight} ${fontSize}px ${fontFamily}`;
    const lines = wrapTokensToLines(context, tokens, maxWidth);
    if (lines.length <= 2) {
      return { fontSize, lines };
    }
  }

  if (allowThreeLinesSize > 0) {
    context.font = `${weight} ${allowThreeLinesSize}px ${fontFamily}`;
    const threeLines = wrapTokensToLines(context, tokens, maxWidth);
    if (threeLines.length <= 3) {
      return { fontSize: allowThreeLinesSize, lines: threeLines };
    }
    const first = threeLines[0] || "";
    const second = threeLines[1] || "";
    const rest = threeLines.slice(2).join("");
    const tail = rest.slice(-6);
    let head = rest.slice(0, Math.max(4, rest.length - 6));
    while (
      head.length > 2 &&
      context.measureText(`${head}…${tail}`).width > maxWidth
    ) {
      head = head.slice(0, -1);
    }
    return {
      fontSize: allowThreeLinesSize,
      lines: [first, second, `${head}…${tail}`]
    };
  }

  // 超长标题兜底：两行排版，第二行保留首部与区分性尾部（如 OVA / 续 / 完 / 第2季）
  const minSize = options.minSize || 26;
  context.font = `${weight} ${minSize}px ${fontFamily}`;
  const allLines = wrapTokensToLines(context, tokens, maxWidth);
  const firstLine = allLines[0] || text.slice(0, 14);
  const remainingText = allLines.slice(1).join("");
  const tailKeep = remainingText.slice(-7);
  let headPart = remainingText.slice(0, Math.max(4, remainingText.length - 7));

  while (
    headPart.length > 2 &&
    context.measureText(`${headPart}…${tailKeep}`).width > maxWidth
  ) {
    headPart = headPart.slice(0, -1);
  }

  return {
    fontSize: minSize,
    lines: [firstLine, `${headPart}…${tailKeep}`]
  };
}

function drawTitleTexture(item, slotType) {
  const isDivider = slotType === "divider";
  // 严格按实体纸签几何宽高比（2.115 : 1.242 ≈ 1.703 / 隔板 1.89）1:1 绘制，彻底消除汉字横向挤压发虚
  const texHeight = isDivider ? 540 : 600;

  return makeCanvasTexture(1024, texHeight, (context, width, height) => {
    const accent = item.laneAccent || "#9b7247";

    if (isDivider) {
      // 诚实空轨 / 章节隔板铭牌：高对比宣纸卡头，无白雾遮挡
      context.fillStyle = "#e6dccb";
      context.fillRect(0, 0, width, height);

      context.fillStyle = accent;
      context.fillRect(0, 0, width, 26);
      context.fillRect(34, 58, 16, height - 116);

      context.strokeStyle = "rgba(20, 22, 18, 0.48)";
      context.lineWidth = 4;
      context.strokeRect(18, 28, width - 36, height - 48);

      const badgeText = String(item.laneBadge || "ARCHIVE TRACK").toUpperCase();
      context.fillStyle = accent;
      context.fillRect(68, 66, Math.min(460, badgeText.length * 24 + 40), 54);
      context.fillStyle = "#fdfbf7";
      context.font = `700 28px ${MONO_FONT_STACK}`;
      context.fillText(badgeText, 86, 103);

      const mainLabel = String(item.dividerLabel || item.laneLabel || "档案分栏");
      const fitted = fitTitleLines(context, mainLabel, width - 128, SERIF_FONT_STACK, {
        candidateSizes: [68, 60, 52, 46, 40],
        fontWeight: 800,
        minSize: 38
      });
      context.fillStyle = "#0f110e";
      const dSize = Math.min(68, fitted.fontSize);
      context.font = `800 ${dSize}px ${SERIF_FONT_STACK}`;
      fitted.lines.forEach((line, idx) => {
        context.fillText(line, 68, 228 + idx * 76);
      });

      const subNote = String(
        item.plaqueNote ||
        (item.isEmptyLane
          ? "当前轨道暂无收录动画 · 保持诚实空轨陈列"
          : "CONTINUED ARCHIVE LOOP · 循环分栏界标")
      );
      context.fillStyle = "#2c2924";
      context.font = `700 32px ${SANS_FONT_STACK}`;
      context.fillText(subNote.slice(0, 32), 68, height - 66);
      return;
    }

    // 真实动画档案标题签（1024×600 等比高清和纸签，大字高对比清晰排版）
    context.fillStyle = "#f4f0e8";
    context.fillRect(0, 0, width, height);

    context.fillStyle = accent;
    context.fillRect(0, 0, 16, height);

    context.strokeStyle = "rgba(24, 26, 22, 0.24)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 5);
    context.lineTo(width, 5);
    context.moveTo(0, height - 9);
    context.lineTo(width, height - 9);
    context.stroke();

    const rightReserve = item.curatedBadge ? 258 : 44;
    const fitted = fitTitleLines(
      context,
      item.name || "未命名档案",
      width - 44 - rightReserve,
      SERIF_FONT_STACK,
      {
        candidateSizes: [72, 64, 56, 50, 46],
        fontWeight: 800,
        threeLineSize: 42,
        minSize: 40
      }
    );

    if (item.curatedBadge) {
      const pillW = 224;
      const pillH = 52;
      const pillX = width - pillW - 26;
      const pillY = 34;
      context.fillStyle = accent;
      context.fillRect(pillX, pillY, pillW, pillH);
      context.fillStyle = "#fdfbf7";
      context.font = `700 24px ${SANS_FONT_STACK}`;
      context.fillText(
        `★ ${item.curatedScoreText || "高分"} · ${item.curatedBadge}`.slice(0, 14),
        pillX + 14,
        pillY + 35
      );
    }

    context.fillStyle = "#111310";
    context.strokeStyle = "rgba(17, 19, 16, 0.22)";
    context.lineJoin = "round";
    context.lineWidth = 0.9;
    context.font = `800 ${fitted.fontSize}px ${SERIF_FONT_STACK}`;

    let lastTitleBaseline = 132;
    if (fitted.lines.length === 1) {
      lastTitleBaseline = 136;
      context.strokeText(fitted.lines[0], 42, lastTitleBaseline);
      context.fillText(fitted.lines[0], 42, lastTitleBaseline);
    } else if (fitted.lines.length === 2) {
      const lineStep = Math.round(fitted.fontSize * 1.24);
      const base0 = 108;
      lastTitleBaseline = base0 + lineStep;
      context.strokeText(fitted.lines[0], 42, base0);
      context.fillText(fitted.lines[0], 42, base0);
      context.strokeText(fitted.lines[1], 42, lastTitleBaseline);
      context.fillText(fitted.lines[1], 42, lastTitleBaseline);
    } else {
      const lineStep = Math.round(fitted.fontSize * 1.24);
      fitted.lines.forEach((ln, idx) => {
        const by = 92 + idx * lineStep;
        lastTitleBaseline = by;
        context.strokeText(ln, 42, by);
        context.fillText(ln, 42, by);
      });
    }

    const jpOrMeta = String(
      item.japaneseName || `${item.year || ""} ${item.season || ""}`.trim() || "ATELIER CEL ARCHIVE"
    );
    const metaY = Math.min(height - 156, lastTitleBaseline + (fitted.lines.length === 1 ? 88 : 74));
    context.fillStyle = "#524c44";
    context.font = `600 32px ${SANS_FONT_STACK}`;
    context.fillText(jpOrMeta.slice(0, 29), 42, metaY);

    context.strokeStyle = "rgba(24, 26, 22, 0.16)";
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(42, height - 114);
    context.lineTo(width - 32, height - 114);
    context.stroke();

    const codeStr = "BGM-" + String(item.subjectId || "000").slice(-3).padStart(3, "0");
    const stateStr = item.state || "未归档";
    const scoreVal = Number(item.personalScore ?? item.bangumiScore ?? item.preciseScore);
    const scoreStr = Number.isFinite(scoreVal) && scoreVal > 0 ? `★ ${scoreVal.toFixed(1)}` : "未评分";

    context.fillStyle = "#181a16";
    context.font = `700 33px ${MONO_FONT_STACK}`;
    context.fillText(`${codeStr}  ·  ${stateStr}  ·  ${scoreStr}`, 42, height - 46);
  }, 1.5);
}

function drawBackTexture(item) {
  return makeCanvasTexture(768, 1024, (context, width, height) => {
    context.fillStyle = "#f2efe9";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(24,26,22,.28)";
    context.lineWidth = 4;
    context.strokeRect(20, 20, width - 40, height - 40);

    context.fillStyle = "#181a16";
    const fitted = fitTitleLines(context, item.name || "未命名档案", width - 108, SERIF_FONT_STACK);
    context.font = `700 ${Math.min(44, fitted.fontSize)}px ${SERIF_FONT_STACK}`;
    fitted.lines.forEach((line, idx) => {
      context.fillText(line, 54, 96 + idx * 52);
    });

    const metaLines = [
      "档案编号  BGM-" + String(item.subjectId || "000").slice(-3).padStart(3, "0"),
      "日文原名  " + (item.japaneseName || "未记载"),
      "制作监督  " + (item.director || "未记载"),
      "制作公司  " + (item.studio || "未记载"),
      "开播档期  " + (`${item.year || "未知"} ${item.season || ""}`.trim()),
      "当前状态  " + (item.state || "未设置")
    ];

    context.fillStyle = "#3b3832";
    context.font = `600 30px ${SANS_FONT_STACK}`;

    metaLines.forEach((line, index) => {
      context.fillText(String(line || "").slice(0, 26), 54, 240 + index * 58);
    });

    context.strokeStyle = "rgba(24,26,22,.3)";
    context.lineWidth = 2;

    for (let x = 54; x < width - 44; x += 19) {
      context.beginPath();
      context.moveTo(x, height - 118);
      context.lineTo(x, height - 54);
      context.stroke();
    }
  });
}

function drawNoteSheetMeshTexture(item) {
  return makeCanvasTexture(512, 720, (context, width, height) => {
    context.fillStyle = "#faf6ee";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(155, 114, 71, 0.42)";
    context.lineWidth = 3;
    context.strokeRect(14, 14, width - 28, height - 28);

    // 装订孔与原画尺标
    context.fillStyle = "#d8cfc2";
    [96, width / 2, width - 96].forEach((x) => {
      context.beginPath();
      context.arc(x, 38, 9, 0, Math.PI * 2);
      context.fill();
    });

    context.fillStyle = "#8c6239";
    context.font = `700 20px ${MONO_FONT_STACK}`;
    context.fillText("ATELIER CEL · MANUSCRIPT SHEET", 36, 86);

    context.fillStyle = "#181a16";
    context.font = `700 28px ${SERIF_FONT_STACK}`;
    context.fillText(String(item.name || "动画档案笔记").slice(0, 14), 36, 132);

    context.strokeStyle = "rgba(155, 114, 71, 0.22)";
    context.lineWidth = 2;
    for (let y = 176; y < height - 48; y += 38) {
      context.beginPath();
      context.moveTo(34, y);
      context.lineTo(width - 34, y);
      context.stroke();
    }
  });
}

function drawInkWashTexture(rawHex) {
  const pigmentHex = getInkPigmentHex(rawHex);
  const baseColor = new THREE.Color(pigmentHex);
  const r = Math.round(baseColor.r * 255);
  const g = Math.round(baseColor.g * 255);
  const b = Math.round(baseColor.b * 255);

  return makeCanvasTexture(512, 512, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;

    // 多朵柔和重叠的水彩/淡墨宣纸渗透云团，无硬边几何轮廓线
    const clouds = [
      { ox: 0, oy: 0, rx: 205, ry: 188, alpha: 0.22, seed: 0.5 },
      { ox: -34, oy: -22, rx: 162, ry: 148, alpha: 0.16, seed: 1.9 },
      { ox: 38, oy: 26, rx: 154, ry: 142, alpha: 0.15, seed: 3.3 },
      { ox: -18, oy: 34, rx: 132, ry: 124, alpha: 0.14, seed: 4.7 }
    ];

    clouds.forEach((cloud) => {
      context.save();
      const px = cx + cloud.ox;
      const py = cy + cloud.oy;
      context.beginPath();
      const steps = 72;
      for (let i = 0; i <= steps; i += 1) {
        const theta = (i / steps) * Math.PI * 2;
        const wave =
          1 +
          0.08 * Math.sin(theta * 2 + cloud.seed) +
          0.05 * Math.cos(theta * 3 - cloud.seed * 0.8) +
          0.03 * Math.sin(theta * 5 + cloud.seed * 1.4);
        const x = px + Math.cos(theta) * cloud.rx * wave;
        const y = py + Math.sin(theta) * cloud.ry * wave;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();

      const maxR = Math.max(cloud.rx, cloud.ry) * 1.12;
      const grad = context.createRadialGradient(px, py, maxR * 0.08, px, py, maxR);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${cloud.alpha})`);
      grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(cloud.alpha * 0.72).toFixed(3)})`);
      grad.addColorStop(0.84, `rgba(${r}, ${g}, ${b}, ${(cloud.alpha * 0.28).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      context.fillStyle = grad;
      context.fill();
      context.restore();
    });
  });
}

function drawTierPlaqueTexture(tierIndex = 0) {
  const tiers = [
    { code: "STEP IV · 7.0–7.9", label: "7.0+ 甄选阶", accent: "#7b6248" },
    { code: "STEP III · 8.0–8.4", label: "8.0+ 佳作阶", accent: "#8f6838" },
    { code: "STEP II · 8.5–8.9", label: "8.5+ 典藏阶", accent: "#a6762e" },
    { code: "STEP I · 9.0–10.0", label: "9.0+ 冠冕阶", accent: "#c28824" }
  ];
  const info = tiers[clamp(tierIndex, 0, 3)] || tiers[0];

  return makeCanvasTexture(512, 136, (context, width, height) => {
    context.fillStyle = "#f7f1e4";
    context.fillRect(0, 0, width, height);

    context.fillStyle = info.accent;
    context.fillRect(0, 0, 18, height);
    context.fillRect(width - 8, 0, 8, height);

    context.strokeStyle = "rgba(143, 104, 56, 0.55)";
    context.lineWidth = 4;
    context.strokeRect(10, 8, width - 20, height - 16);

    context.fillStyle = info.accent;
    context.font = `700 22px ${MONO_FONT_STACK}`;
    context.fillText(info.code, 36, 44);

    context.fillStyle = "#181a16";
    context.font = `900 40px ${SERIF_FONT_STACK}`;
    context.fillText(`★ ${info.label}`, 34, 102);
  });
}

function drawTrackSignpostTexture(info = {}) {
  const lane = Number(info.lane) || 0;
  const name = String(info.name || `轨道 ${lane + 1}`).trim() || `轨道 ${lane + 1}`;
  const badge = String(info.badge || `TRACK 0${lane + 1}`).trim().toUpperCase();
  const accent = String(info.accent || "#9b7247");
  const totalCount = Math.max(0, Number(info.totalCount) || 0);
  const cursorIndex = totalCount > 0 ? clamp(Number(info.cursorIndex) || 1, 1, totalCount) : 0;
  const isActive = Boolean(info.isActive);

  return makeCanvasTexture(768, 240, (context, width, height) => {
    // 温润和纸铭牌底纹（当前焦点轨微亮暖象牙，其余轨素雅棉麻色）
    context.fillStyle = isActive ? "#fbf7ee" : "#efe9dc";
    context.fillRect(0, 0, width, height);

    // 左侧轨道专属漆印色带 + 右侧细黄铜边线
    context.fillStyle = accent;
    context.fillRect(0, 0, 22, height);
    context.fillStyle = isActive ? accent : "rgba(155, 114, 71, 0.55)";
    context.fillRect(width - 8, 0, 8, height);

    // 内层精致装裱双细线
    context.strokeStyle = isActive ? "rgba(155, 114, 71, 0.65)" : "rgba(113, 107, 97, 0.35)";
    context.lineWidth = 3;
    context.strokeRect(30, 12, width - 48, height - 24);

    // 顶部三枚原画定位尺微孔（呼应白昼原画室装帧母题）
    context.fillStyle = "rgba(155, 114, 71, 0.24)";
    [width * 0.36, width * 0.5, width * 0.64].forEach((hx) => {
      context.beginPath();
      context.arc(hx, 26, 4.5, 0, Math.PI * 2);
      context.fill();
    });

    // 顶部眉标与激活指示
    const trackNo = String(lane + 1).padStart(2, "0");
    context.fillStyle = accent;
    context.font = `700 21px ${MONO_FONT_STACK}`;
    context.fillText(`TRACK ${trackNo} · ${badge.slice(0, 22)}`, 46, 62);

    const statusTag = isActive ? "● 当前轨道" : "↗ 点击切轨";
    context.font = `700 20px ${SANS_FONT_STACK}`;
    const tagW = context.measureText(statusTag).width + 24;
    if (isActive) {
      context.fillStyle = accent;
      context.fillRect(width - 28 - tagW, 38, tagW, 32);
      context.fillStyle = "#fffdf8";
    } else {
      context.fillStyle = "rgba(24, 26, 22, 0.06)";
      context.fillRect(width - 28 - tagW, 38, tagW, 32);
      context.fillStyle = "#6c655a";
    }
    context.fillText(statusTag, width - 16 - tagW, 61);

    // 右下馆藏游标计数铭牌（如 03 / 28 部）
    const counterMain = totalCount > 0
      ? `${String(cursorIndex).padStart(2, "0")} / ${String(totalCount).padStart(2, "0")}`
      : "00";
    const counterUnit = totalCount > 0 ? `共 ${totalCount} 部` : "暂无条目";
    const counterBoxW = 204;
    const counterBoxX = width - 28 - counterBoxW;

    context.fillStyle = isActive ? "rgba(155, 114, 71, 0.13)" : "rgba(24, 26, 22, 0.05)";
    context.fillRect(counterBoxX, 88, counterBoxW, 124);
    context.strokeStyle = isActive ? accent : "rgba(155, 114, 71, 0.34)";
    context.lineWidth = 2;
    context.strokeRect(counterBoxX, 88, counterBoxW, 124);

    context.fillStyle = "#181a16";
    context.font = `800 38px ${MONO_FONT_STACK}`;
    const cmWidth = context.measureText(counterMain).width;
    context.fillText(counterMain, counterBoxX + (counterBoxW - cmWidth) * 0.5, 146);

    context.fillStyle = isActive ? accent : "#5e584e";
    context.font = `700 22px ${SANS_FONT_STACK}`;
    const cuWidth = context.measureText(counterUnit).width;
    context.fillText(counterUnit, counterBoxX + (counterBoxW - cuWidth) * 0.5, 188);

    // 主标题（左侧留足安全宽度，超长自定义轨道名自动字号收敛，绝不越界重叠）
    const titleMaxWidth = counterBoxX - 64;
    const candidateSizes = [54, 48, 42, 36, 31, 27];
    let chosenSize = 27;
    for (const sz of candidateSizes) {
      context.font = `900 ${sz}px ${SERIF_FONT_STACK}`;
      if (context.measureText(name).width <= titleMaxWidth) {
        chosenSize = sz;
        break;
      }
    }
    context.font = `900 ${chosenSize}px ${SERIF_FONT_STACK}`;
    let displayTitle = name;
    while (displayTitle.length > 2 && context.measureText(displayTitle).width > titleMaxWidth) {
      displayTitle = `${displayTitle.slice(0, -2)}…`;
    }
    context.fillStyle = "#141612";
    context.fillText(displayTitle, 46, 152);

    // 底部辅助说明线
    const subHint = String(
      info.plaqueNote ||
      (totalCount > 0 ? `馆藏序列 · 滚轮翻阅本轨` : "诚实空轨 · 待收录新番")
    );
    context.fillStyle = "#625c52";
    context.font = `600 22px ${SANS_FONT_STACK}`;
    let shortHint = subHint;
    while (shortHint.length > 4 && context.measureText(shortHint).width > titleMaxWidth) {
      shortHint = `${shortHint.slice(0, -2)}…`;
    }
    context.fillText(shortHint, 46, 196);
  }, 2);
}

function makeSignpostRenderKey(info = {}) {
  return [
    Number(info.lane) || 0,
    String(info.name || ""),
    String(info.badge || ""),
    String(info.accent || ""),
    String(info.plaqueNote || ""),
    Number(info.totalCount) || 0,
    Number(info.cursorIndex) || 0,
    Boolean(info.isActive) ? 1 : 0
  ].join("|");
}

function buildTrackSignpost(info = {}) {
  const outerGroup = new THREE.Group();
  const plaqueGroup = new THREE.Group();
  outerGroup.add(plaqueGroup);

  const width = 2.44;
  const height = 0.76;
  const paperBump = getSharedPaperBumpTexture();

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: info.isActive ? 0xfaf5ea : 0xede6d8,
    roughness: 0.84,
    metalness: 0.02,
    bumpMap: paperBump,
    bumpScale: 0.003
  });

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: info.isActive ? 0xc9963b : 0xb59562,
    roughness: 0.36,
    metalness: 0.4,
    emissive: 0x5c411c,
    emissiveIntensity: info.isActive ? 0.08 : 0.03
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(info.accent || "#9b7247"),
    roughness: 0.55,
    metalness: 0.14
  });

  const boardMesh = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.06, height - 0.06, 0.056),
    paperMaterial
  );
  plaqueGroup.add(boardMesh);

  const bezelGeom = getMiteredFrameGeometry(
    width,
    height,
    width - 0.09,
    height - 0.09,
    -0.032,
    0.042,
    0.012
  );
  const bezelMesh = new THREE.Mesh(bezelGeom, [frameMaterial, frameMaterial]);
  plaqueGroup.add(bezelMesh);

  const sealMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.064, height - 0.08, 0.074),
    accentMaterial
  );
  sealMesh.position.set(-width * 0.5 + 0.062, 0, 0.008);
  plaqueGroup.add(sealMesh);

  const stemMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.34, 12),
    frameMaterial
  );
  stemMesh.position.set(0, -height * 0.5 - 0.16, -0.005);
  plaqueGroup.add(stemMesh);

  const baseFootMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.032, 0.12),
    frameMaterial
  );
  baseFootMesh.position.set(0, -height * 0.5 - 0.33, -0.005);
  plaqueGroup.add(baseFootMesh);

  const faceMaterial = new THREE.MeshBasicMaterial({
    map: drawTrackSignpostTexture(info),
    transparent: false,
    toneMapped: false
  });
  const faceMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.1, height - 0.1),
    faceMaterial
  );
  faceMesh.position.set(0, 0, 0.033);
  plaqueGroup.add(faceMesh);

  const renderKey = makeSignpostRenderKey(info);
  outerGroup.userData = {
    isTrackSignpost: true,
    lane: Number(info.lane) || 0,
    plaqueGroup,
    boardMesh,
    bezelMesh,
    sealMesh,
    stemMesh,
    baseFootMesh,
    faceMesh,
    paperMaterial,
    frameMaterial,
    accentMaterial,
    faceMaterial,
    fadeMaterials: [paperMaterial, frameMaterial, accentMaterial, faceMaterial],
    renderKey
  };

  return outerGroup;
}

function updateTrackSignpost(group, info = {}) {
  const data = group?.userData;
  if (!data || !data.isTrackSignpost) return;
  data.lane = Number(info.lane) || 0;
  const nextKey = makeSignpostRenderKey(info);
  if (data.renderKey === nextKey) return;
  data.renderKey = nextKey;

  if (data.faceMaterial) {
    if (data.faceMaterial.map) disposeTexture(data.faceMaterial.map);
    data.faceMaterial.map = drawTrackSignpostTexture(info);
    data.faceMaterial.needsUpdate = true;
  }
  if (data.accentMaterial?.color) {
    data.accentMaterial.color.set(info.accent || "#9b7247");
  }
  if (data.paperMaterial?.color) {
    data.paperMaterial.color.setHex(info.isActive ? 0xfaf5ea : 0xede6d8);
  }
  if (data.frameMaterial) {
    data.frameMaterial.color.setHex(info.isActive ? 0xc9963b : 0xb59562);
    data.frameMaterial.emissiveIntensity = info.isActive ? 0.08 : 0.03;
  }
}

function disposeTexture(texture) {
  if (texture?.dispose) texture.dispose();
}

function buildCelFolio(item = {}, options = {}) {
  const slotType = options.slotType || item.slotType || "anime";
  const requestedStyle = String(options.modelStyle || "standard");
  const hdProto =
    requestedStyle === "hd_cel_folio" || requestedStyle === "hd_collector_box"
      ? getCachedAtelierPrototype(requestedStyle)
      : null;
  const activeStyle = hdProto ? requestedStyle : "standard";
  const isCollectorBox = activeStyle === "hd_collector_box";

  const outerGroup = new THREE.Group();
  const folioTiltGroup = new THREE.Group();
  outerGroup.add(folioTiltGroup);

  const width = Number(options.width) || 2.28;
  const fullHeight = Number(options.height) || 3.22;
  const scaleX = width / 2.28;
  const scaleYFull = fullHeight / 3.22;
  const blankHeight = 0.44;
  const dividerHeight = 1.24;

  const paperBump = getSharedPaperBumpTexture();

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: slotType === "blank" ? 0xeae3d9 : 0xf4f0e8,
    roughness: 0.86,
    metalness: 0.01,
    bumpMap: paperBump,
    bumpScale: 0.004
  });

  const matCoreMaterial = new THREE.MeshStandardMaterial({
    color: 0xfbf8f1,
    roughness: 0.76,
    metalness: 0.0
  });

  const valleyMaterial = new THREE.MeshStandardMaterial({
    color: 0xddd4ca,
    roughness: 0.76,
    metalness: 0.03,
    bumpMap: paperBump,
    bumpScale: 0.005
  });

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xd5a85b,
    roughness: 0.36,
    metalness: 0.42,
    emissive: 0x6a4e24,
    emissiveIntensity: 0.05
  });

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: 0xae8b4e,
    roughness: 0.28,
    metalness: 0.78
  });

  const sharedData = options.sharedSourceGroup?.userData || null;

  // 高清晰度海报层（严格独立平面 z = +0.064，与前后各层留足 >= 0.010 净空间隙）
  const posterMaterial = new THREE.MeshStandardMaterial({
    map: sharedData?.posterMaterial?.map || null,
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.01
  });

  // 赛璐珞清漆护膜层：极轻微透明光泽，depthWrite: false + polygonOffset 彻底杜绝深度抢占
  const coverMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.045,
    roughness: 0.22,
    metalness: 0.0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });

  const parts = [];
  const addPart = (name, object, depth) => {
    object.position.z = depth;
    object.userData.assemblyPart = name;
    folioTiltGroup.add(object);
    parts.push(object);
    return object;
  };

  let carrier;
  let substrate;
  let frame;
  let fasteners;
  let titleSpine;

  const artHeight = fullHeight * 0.58;
  const labelHeight = fullHeight - artHeight;
  const artCenterY = fullHeight / 2 - artHeight / 2 - 0.07;
  const labelCenterY = -fullHeight / 2 + labelHeight / 2 + 0.02;
  const artCenterX = isCollectorBox ? 0.018 * scaleX : 0;

  if (hdProto) {
    // ==================== 典藏精装扩展包模式（共享 GPU BufferGeometry 原型） ====================
    const roleGroups = {
      carrier: new THREE.Group(),
      substrate: new THREE.Group(),
      "cel-frame": new THREE.Group(),
      cover: new THREE.Group(),
      fasteners: new THREE.Group()
    };

    for (const partSpec of hdProto.parts) {
      const targetGroup = roleGroups[partSpec.assemblyRole] || roleGroups.substrate;
      for (const sp of partSpec.subPrimitives) {
        const ms = sp.matSpec;
        let mat;
        if (partSpec.assemblyRole === "substrate" && ms.name.includes("OatLinen")) {
          mat = valleyMaterial;
        } else if (partSpec.assemblyRole === "carrier" && ms.name.includes("CottonPaper")) {
          mat = paperMaterial;
        } else {
          mat = new THREE.MeshStandardMaterial({
            color: ms.colorHex,
            roughness: ms.roughness,
            metalness: ms.metalness,
            emissive: ms.emissiveHex || 0x000000,
            emissiveIntensity: ms.emissiveIntensity || 0,
            normalMap: ms.normalMap || null,
            normalScale: new THREE.Vector2(ms.normalScale || 0.25, ms.normalScale || 0.25)
          });
        }
        const mesh = new THREE.Mesh(sp.geometry, mat);
        mesh.scale.set(scaleX, scaleYFull, 1);
        targetGroup.add(mesh);
      }
    }

    carrier = addPart("carrier", roleGroups.carrier, 0);
    substrate = addPart("substrate", roleGroups.substrate, 0);
    frame = addPart("cel-frame", roleGroups["cel-frame"], 0);
    fasteners = addPart("fasteners", roleGroups.fasteners, 0);
    titleSpine = addPart("cover", roleGroups.cover, 0);
  } else {
    // ==================== 标准内置轻量工艺版（零体积膨胀 · 根治四角重叠与共面） ====================
    const carrierGroup = new THREE.Group();
    // 底板主体：z ∈ [-0.184, -0.068]
    const carrierBoard = new THREE.Mesh(
      new THREE.BoxGeometry(width, fullHeight, 0.116),
      paperMaterial
    );
    carrierBoard.position.z = -0.126;
    carrierGroup.add(carrierBoard);

    // 顶部外露赛璐珞原画三孔定位卡头（Top 3-Hole Studio Tap Header，避免与正面边框重叠）
    const tapGroup = new THREE.Group();
    const tapW = width * 0.76;
    const tapH = 0.135 * scaleYFull;
    const tapY = fullHeight * 0.5 + tapH * 0.5 + 0.004;
    const tapPlate = new THREE.Mesh(
      new THREE.BoxGeometry(tapW, tapH, 0.048),
      paperMaterial
    );
    tapPlate.position.set(0, tapY, -0.098);
    tapGroup.add(tapPlate);

    const tapCollar = new THREE.Mesh(
      new THREE.BoxGeometry(tapW + 0.016, 0.014, 0.054),
      frameMaterial
    );
    tapCollar.position.set(0, tapY + tapH * 0.5 + 0.008, -0.098);
    tapGroup.add(tapCollar);

    const holeDarkMat = new THREE.MeshBasicMaterial({ color: 0x3b3731 });
    [-0.56 * scaleX, 0, 0.56 * scaleX].forEach((hx, idx) => {
      const holeW = idx === 1 ? 0.058 : 0.14;
      const holeH = idx === 1 ? 0.058 : 0.044;
      const holeInlay = new THREE.Mesh(new THREE.BoxGeometry(holeW, holeH, 0.054), holeDarkMat);
      holeInlay.position.set(hx, tapY, -0.098);
      tapGroup.add(holeInlay);
    });
    carrierGroup.userData.tapGroup = tapGroup;
    carrierGroup.add(tapGroup);
    carrier = addPart("carrier", carrierGroup, 0);

    // 内衬卡槽与两侧内凹折页：底衬 z ∈ [-0.056, +0.012]（与底板留出 0.012 物理净空，绝不共面！）
    const substrateGroup = new THREE.Group();
    const subBase = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.06, fullHeight - 0.06, 0.068),
      valleyMaterial
    );
    subBase.position.z = -0.022;
    substrateGroup.add(subBase);

    // 左右折页严格收拢在 z ∈ [+0.016, +0.050]，绝不生硬穿透上层海报与金属框！
    [-1, 1].forEach((sx) => {
      const gusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, fullHeight - 0.18, 0.034),
        valleyMaterial
      );
      gusset.position.set(sx * (width / 2 - 0.054), -0.03, 0.033);
      substrateGroup.add(gusset);
    });
    substrate = addPart("substrate", substrateGroup, 0);

    // 一体式 45° 斜切白芯装裱卡窗 + 一体流形 45° 斜拼香槟金画框（四角零重叠！）
    frame = new THREE.Group();
    const matBevelGeom = getMiteredFrameGeometry(
      width - 0.09,
      artHeight + 0.01,
      width - 0.22,
      artHeight - 0.12,
      0.074,
      0.092,
      0.022
    );
    const matBevelMesh = new THREE.Mesh(matBevelGeom, [paperMaterial, matCoreMaterial]);
    matBevelMesh.position.set(0, artCenterY, 0);
    frame.add(matBevelMesh);

    const outerFrameGeom = getMiteredFrameGeometry(
      width - 0.04,
      artHeight + 0.054,
      width - 0.12,
      artHeight - 0.024,
      0.098,
      0.114,
      0.004
    );
    const outerFrameMesh = new THREE.Mesh(outerFrameGeom, [frameMaterial, brassMaterial]);
    outerFrameMesh.position.set(0, artCenterY, 0);
    frame.add(outerFrameMesh);
    addPart("cel-frame", frame, 0);

    // 四角护角五金与车削子母螺钉：z ∈ [+0.126, +0.168]
    fasteners = new THREE.Group();
    [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ].forEach(([sx, sy]) => {
      const fastener = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.038, 0.034, 16),
        brassMaterial
      );
      fastener.rotation.x = Math.PI / 2;
      fastener.position.set(
        sx * (width / 2 - 0.11),
        sy * (fullHeight / 2 - 0.11),
        0.146
      );
      fasteners.add(fastener);
    });
    addPart("fasteners", fasteners, 0);

    titleSpine = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.44, 0.034, 0.022),
      frameMaterial
    );
    titleSpine.position.set(0, fullHeight / 2 - 0.026, 0.132);
    titleSpine.userData.assemblyPart = "cover";
    folioTiltGroup.add(titleSpine);
  }

  // 可抽出的原画随附笔记纸页三维实体层（z = +0.055，位于内衬 +0.050 与海报 +0.064 正中间净空带）
  const noteSheetTexture =
    slotType === "anime"
      ? sharedData?.noteSheetMaterial?.map || drawNoteSheetMeshTexture(item)
      : null;
  const noteSheetMaterial = new THREE.MeshBasicMaterial({
    map: noteSheetTexture,
    color: 0xffffff,
    side: THREE.DoubleSide
  });
  const noteSheetMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.88, fullHeight * 0.86),
    noteSheetMaterial
  );
  noteSheetMesh.position.set(0, 0, 0.055);
  noteSheetMesh.visible = false;
  noteSheetMesh.userData.assemblyPart = "substrate";
  folioTiltGroup.add(noteSheetMesh);

  const poster = addPart(
    "poster-core",
    new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.19, artHeight - 0.1),
      posterMaterial
    ),
    0.064
  );
  poster.position.set(artCenterX, artCenterY, 0.064);

  const cover = addPart(
    "cover",
    new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.15, artHeight - 0.06),
      coverMaterial
    ),
    0.12
  );
  cover.position.set(artCenterX, artCenterY, 0.12);
  cover.renderOrder = 2;

  const labelTexture =
    slotType === "blank"
      ? null
      : sharedData?.labelMaterial?.map || drawTitleTexture(item, slotType);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture,
    color: 0xffffff
  });

  const label = addPart(
    "label",
    new THREE.Mesh(
      new THREE.PlaneGeometry(width - (isCollectorBox ? 0.18 : 0.165), labelHeight - 0.11),
      labelMaterial
    ),
    0.096
  );
  label.position.set(artCenterX, labelCenterY, 0.096);

  const backTexture =
    slotType === "blank"
      ? null
      : sharedData?.backMaterial?.map || drawBackTexture(item);
  const backMaterial = new THREE.MeshBasicMaterial({
    map: backTexture,
    side: THREE.BackSide
  });

  const backLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.2, fullHeight - 0.2),
    backMaterial
  );
  backLabel.rotation.y = Math.PI;
  backLabel.position.z = isCollectorBox ? -0.264 : -0.194;
  backLabel.userData.assemblyPart = "substrate";
  folioTiltGroup.add(backLabel);

  const blankGuide = new THREE.Group();
  const guideMaterial = new THREE.LineBasicMaterial({
    color: 0x6f685d,
    transparent: true,
    opacity: 0.68
  });

  const guidePoints = [];
  for (let x = -width * 0.4; x <= width * 0.4; x += 0.08) {
    guidePoints.push(x, -blankHeight / 2 + 0.08, 0.08);
    guidePoints.push(x, -blankHeight / 2 + 0.18, 0.08);
  }

  const guideGeometry = new THREE.BufferGeometry();
  guideGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(guidePoints, 3)
  );
  blankGuide.add(new THREE.LineSegments(guideGeometry, guideMaterial));

  [-width * 0.32, 0, width * 0.32].forEach((x) => {
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12),
      new THREE.MeshBasicMaterial({ color: 0x6f685d })
    );
    hole.rotation.x = Math.PI / 2;
    hole.position.set(x, 0.04, 0.075);
    blankGuide.add(hole);
  });

  blankGuide.position.z = 0.09;
  folioTiltGroup.add(blankGuide);

  const setSlotType = (nextType) => {
    const blank = nextType === "blank";
    const divider = nextType === "divider";
    const anime = nextType === "anime";

    outerGroup.userData.slotType = nextType;

    const slotScaleY = blank
      ? blankHeight / fullHeight
      : divider
        ? dividerHeight / fullHeight
        : 1;

    carrier.scale.y = slotScaleY;
    substrate.scale.y = slotScaleY;
    if (carrier.userData?.tapGroup) {
      carrier.userData.tapGroup.visible = anime;
    }

    paperMaterial.color.setHex(blank ? 0xe8e0d5 : divider ? 0xe9e0d2 : 0xf4f0e8);

    // 仅真实动画封套显示海报窗与金属外框；章节/空轨隔板显示为低矮清晰的检索铭牌
    poster.visible = anime;
    cover.visible = anime;
    frame.visible = anime;
    fasteners.visible = anime;
    backLabel.visible = anime;
    if (titleSpine) titleSpine.visible = anime;

    label.visible = !blank;
    if (divider) {
      label.position.set(0, 0, 0.088);
      label.scale.set(1, (dividerHeight - 0.12) / (labelHeight - 0.11), 1);
    } else {
      label.position.set(artCenterX, labelCenterY, 0.096);
      label.scale.set(1, 1, 1);
    }

    blankGuide.visible = blank;
    if (!anime) {
      noteSheetMesh.visible = false;
    }
  };

  outerGroup.userData = {
    parts,
    modelStyle: activeStyle,
    folioTiltGroup,
    carrier,
    substrate,
    poster,
    cover,
    label,
    frame,
    fasteners,
    backLabel,
    titleSpine,
    blankGuide,
    noteSheetMesh,
    noteSheetMaterial,
    paperMaterial,
    matCoreMaterial,
    valleyMaterial,
    frameMaterial,
    brassMaterial,
    posterMaterial,
    coverMaterial,
    labelMaterial,
    backMaterial,
    setSlotType,
    slotType,
    itemId: item.file?.path || item.subjectId || item.name || ""
  };

  folioTiltGroup.rotation.x = -0.2;
  setSlotType(slotType, item);

  return outerGroup;
}

function updateCelFolio(group, item = {}, options = {}) {
  const data = group?.userData;
  if (!data) return;

  const nextSlotType = options.slotType || item.slotType || "anime";
  data.slotType = nextSlotType;
  data.itemId = item.file?.path || item.subjectId || item.name || "";

  if (typeof data.setSlotType === "function") {
    data.setSlotType(nextSlotType, item);
  }

  const updateMatMap = (mat, newMap) => {
    if (!mat) return;
    if (mat.map) disposeTexture(mat.map);
    mat.map = newMap;
    mat.needsUpdate = true;
  };
  const isBlank = nextSlotType === "blank";
  const isAnime = nextSlotType === "anime";
  updateMatMap(data.labelMaterial, isBlank ? null : drawTitleTexture(item, nextSlotType));
  updateMatMap(data.backMaterial, isAnime ? drawBackTexture(item) : null);
  updateMatMap(data.noteSheetMaterial, isAnime ? drawNoteSheetMeshTexture(item) : null);
}

function inject3DScopedStyles() {
  if (typeof document === "undefined") return;

  const css = `.bangumi-3d-root{--cel-paper:#f2efe9;--cel-paper-deep:#eae5e1;--cel-ink:#181a16;--cel-muted:#716b61;--cel-line:#c6beb2;--cel-accent:#9b7247;--cel-aura-color:#d9c6b4;--cel-ink-pigment:#9b7247;position:relative;width:100%;height:100%;min-height:620px;overflow:hidden;background:var(--cel-paper-deep);color:var(--cel-ink);font-family:var(--font-interface)}.bangumi-3d-root[data-lens-mode="highscore"]{--cel-paper-deep:#ece4d7;--cel-accent:#b07d35}.bangumi-3d-root button{box-shadow:none!important;border-radius:0;height:auto;font-family:inherit;outline:none}.scene-atmosphere{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at 51% 70%,color-mix(in srgb,var(--cel-aura-color) 36%,transparent),transparent 52%),radial-gradient(ellipse at 92% 38%,color-mix(in srgb,var(--cel-aura-color) 16%,transparent),transparent 56%),linear-gradient(124deg,#f2efe9 0%,var(--cel-paper-deep) 62%,color-mix(in srgb,var(--cel-aura-color) 15%,var(--cel-paper-deep)) 100%)}.atelier-ink-bloom{position:absolute;left:29%;top:48%;width:540px;height:540px;margin-left:-270px;margin-top:-270px;z-index:1;pointer-events:none;opacity:0;transform:scale(.62) rotate(-6deg);transition:opacity .48s cubic-bezier(.16,1,.3,1),transform .68s cubic-bezier(.16,1,.3,1);background:radial-gradient(circle at 46% 48%,color-mix(in srgb,var(--cel-ink-pigment) 34%,transparent) 0%,color-mix(in srgb,var(--cel-ink-pigment) 20%,transparent) 38%,color-mix(in srgb,var(--cel-ink-pigment) 8%,transparent) 62%,transparent 76%),radial-gradient(ellipse at 62% 38%,color-mix(in srgb,var(--cel-ink-pigment) 22%,transparent) 0%,transparent 58%),radial-gradient(ellipse at 36% 64%,color-mix(in srgb,var(--cel-ink-pigment) 18%,transparent) 0%,transparent 54%);filter:blur(10px)}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-ink-bloom,.bangumi-3d-root[data-space-state="detail"] .atelier-ink-bloom{opacity:.92;transform:scale(1.06) rotate(0deg)}.bangumi-3d-root[data-reduced-motion="true"] .atelier-ink-bloom{transition:none;transform:scale(1)}.atelier-viewport{position:absolute;inset:0;z-index:2;overflow:hidden;pointer-events:auto}.atelier-viewport canvas{display:block;width:100%;height:100%}.atelier-ui{position:absolute;inset:0;z-index:10;pointer-events:none!important}.atelier-top,.atelier-bottom{position:absolute;pointer-events:none}.atelier-top>*,.atelier-bottom>*{pointer-events:auto}.atelier-top{top:clamp(18px,2.6vw,36px);left:clamp(24px,4vw,64px);right:clamp(24px,4vw,64px);display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.atelier-curation-banner{position:absolute;top:clamp(68px,8.5vh,94px);left:clamp(24px,4vw,64px);z-index:11;display:none;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 14px;background:rgba(244,239,229,.92);border:1px solid rgba(176,125,53,.38);border-left:3px solid var(--cel-accent);backdrop-filter:blur(8px);pointer-events:auto}.bangumi-3d-root[data-lens-mode="highscore"] .atelier-curation-banner{display:flex}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-curation-banner,.bangumi-3d-root[data-space-state="detail"] .atelier-curation-banner,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-curation-banner{opacity:0;pointer-events:none}.atelier-curation-eyebrow{font-size:11px;font-weight:700;color:var(--cel-accent);letter-spacing:1px;margin-right:4px}.bangumi-3d-root button.atelier-curation-pill{padding:3px 9px;border:1px solid rgba(176,125,53,.28);background:rgba(255,252,245,.75);color:var(--cel-ink);font-size:11px;cursor:pointer;transition:all .15s}.bangumi-3d-root button.atelier-curation-pill.is-active,.bangumi-3d-root button.atelier-curation-pill:hover{background:var(--cel-accent);color:#fff;border-color:var(--cel-accent)}.atelier-bottom{left:clamp(24px,4vw,64px);right:clamp(24px,4vw,64px);bottom:clamp(20px,3vw,40px);display:flex;align-items:flex-end;justify-content:space-between;gap:24px;transition:opacity .25s ease}.atelier-hover{position:absolute;left:clamp(24px,4vw,64px);bottom:clamp(144px,17vh,194px);z-index:12;max-width:min(310px,27vw);padding:7px 12px;border:1px solid rgba(198,190,178,.55);border-left:3px solid var(--cel-accent);background:rgba(242,239,233,.95);box-shadow:0 8px 24px rgba(24,26,22,.07);color:var(--cel-ink);font-size:12px;line-height:1.42;letter-spacing:.35px;opacity:0;pointer-events:none!important;transform:translateY(6px);transition:opacity .18s,transform .18s}.atelier-hover.is-visible{opacity:1;transform:translateY(0)}.atelier-detail{position:absolute;top:clamp(64px,7.5vh,84px);right:clamp(24px,4vw,56px);z-index:12;width:min(476px,calc(100% - 48px));max-height:calc(100% - 78px);padding:16px 22px;background:rgba(244,241,234,.96);backdrop-filter:blur(12px);border:1px solid var(--cel-line);box-shadow:0 18px 44px rgba(24,26,22,.08);overflow:auto;opacity:0;pointer-events:none;transform:translateX(16px);transition:opacity .28s,transform .28s}.atelier-detail.is-visible{opacity:1;pointer-events:auto;transform:translateX(0)}.atelier-folio-sheet-hint{margin-top:6px;padding:5px 10px;background:rgba(155,114,71,.09);border-left:2px solid var(--cel-accent);font-size:11px;color:#544e45;display:flex;align-items:center;justify-content:space-between;gap:8px}.atelier-note-sheet{position:absolute;top:clamp(76px,10vh,108px);left:clamp(310px,28vw,470px);z-index:16;width:min(460px,calc(100% - 80px));max-height:calc(100% - 104px);display:flex;flex-direction:column;background:#faf6ee;border:1px solid #bba98e;border-top:4px solid var(--cel-accent);box-shadow:0 24px 56px rgba(24,26,22,.16),-8px 0 24px rgba(155,114,71,.08);opacity:0;pointer-events:none;transform:translate3d(-44px,14px,0) rotate(-1.5deg) scale(.95);transform-origin:left center;transition:opacity .26s cubic-bezier(.16,1,.3,1),transform .32s cubic-bezier(.16,1,.3,1)}.atelier-note-sheet.is-open{opacity:1;pointer-events:auto;transform:translate3d(0,0,0) rotate(0deg) scale(1)}.atelier-note-sheet-holes{display:flex;justify-content:space-around;padding:8px 36px 4px;border-bottom:1px dashed rgba(155,114,71,.3);background:#f3ede0}.atelier-note-hole{width:10px;height:10px;border-radius:50%;background:#dfd7c8;border:1px solid rgba(24,26,22,.18)}.atelier-note-sheet-header{padding:14px 20px 12px;border-bottom:1px solid rgba(24,26,22,.14);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;background:#faf6ee}.atelier-note-sheet-title{font-size:18px;font-weight:700;line-height:1.3;margin:4px 0 2px;font-family:${SERIF_FONT_STACK}}.atelier-note-sheet-body{flex:1;min-height:220px;max-height:calc(80vh - 160px);overflow-y:auto;padding:16px 20px 22px;font-size:13px;line-height:1.75;color:#22241f;background:repeating-linear-gradient(180deg,#faf6ee 0px,#faf6ee 27px,rgba(155,114,71,.11) 28px);overscroll-behavior:contain}.atelier-note-section{margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(198,190,178,.5)}.atelier-note-section h3{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;color:var(--cel-accent);text-transform:uppercase}.atelier-note-kv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;font-size:12px}.atelier-note-kv{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted rgba(198,190,178,.6);padding:2px 0}.atelier-note-kv span:first-child{color:var(--cel-muted)}.atelier-note-paragraph{margin:6px 0;white-space:pre-wrap;word-break:break-word}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="entering-detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="entering-detail"] .atelier-hover,.bangumi-3d-root[data-space-state="detail"] .atelier-hover,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-hover{opacity:0!important;pointer-events:none!important}.atelier-boot{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#f2efe9;transition:opacity .56s cubic-bezier(.22,1,.36,1),transform .56s cubic-bezier(.22,1,.36,1);will-change:opacity,transform}.atelier-boot.is-hidden{opacity:0;pointer-events:none;transform:scale(1.015)}.atelier-modal,.atelier-viewer{position:absolute;inset:0;z-index:30;overflow:auto;padding:clamp(32px,5vw,60px) clamp(24px,5vw,64px);background:rgba(242,239,233,.97);backdrop-filter:blur(12px);pointer-events:auto}.atelier-mark{font-size:13px;font-weight:700;letter-spacing:1px}.atelier-mark small,.atelier-meta{display:block;margin-top:5px;color:var(--cel-muted);font-size:10px;font-weight:500;letter-spacing:1px}.atelier-actions,.atelier-row,.atelier-detail-actions,.atelier-segmented,.atelier-bottom-right,.atelier-counter-numbers{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bangumi-3d-root button.atelier-btn,.bangumi-3d-root button.atelier-text-action,.bangumi-3d-root button.atelier-back-lead{min-height:28px;padding:3px 6px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--cel-ink);cursor:pointer;font-size:12px;letter-spacing:.55px}.bangumi-3d-root button.atelier-btn:hover,.bangumi-3d-root button.atelier-btn.is-active,.bangumi-3d-root button.atelier-text-action:hover,.bangumi-3d-root button.atelier-back-lead:hover{border-bottom-color:var(--cel-accent);color:var(--cel-accent);background:rgba(155,114,71,.08)}.atelier-title{max-width:min(560px,45vw);font-size:clamp(19px,1.9vw,26px);font-weight:650;line-height:1.24;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}.atelier-title.is-scrubbing{min-width:240px;height:28px;color:transparent;background:var(--cel-ink)}.atelier-number{display:inline-block;min-width:42px;font-size:42px;font-weight:600;font-variant-numeric:tabular-nums;line-height:.85}.atelier-number.is-rolling{animation:atelier-roll .46s ease}@keyframes atelier-roll{from{opacity:0;transform:translateY(13px)}to{opacity:1;transform:none}}.atelier-lane-eyebrow,.atelier-counter-sep,.atelier-total{color:var(--cel-muted);font-size:11px;font-weight:600;letter-spacing:1px}.atelier-counter-sep,.atelier-total{font-size:20px;font-weight:500;letter-spacing:0}.atelier-counter-box,.atelier-bottom-right{padding:8px 14px;background:rgba(242,239,233,.9);backdrop-filter:blur(8px);border:1px solid rgba(198,190,178,.5)}.atelier-callout-box{display:flex;flex-direction:column;gap:5px;max-width:540px;padding:8px 14px;background:rgba(242,239,233,.9);backdrop-filter:blur(8px);border:1px solid rgba(198,190,178,.5)}.atelier-callout-line{width:min(280px,100%);height:1px;margin:3px 0 5px;background:var(--cel-line)}.file-ticks{display:flex;align-items:center;gap:4px;height:18px}.file-tick{width:2px;height:9px;background:var(--cel-line);transition:height .2s,background .2s}.file-tick.is-active{height:18px;background:var(--cel-ink)}.atelier-detail h1{margin:5px 0 6px;font-size:21px;font-weight:700;line-height:1.26;word-break:break-word;font-family:${SERIF_FONT_STACK}}.atelier-detail-rule{width:100%;height:2px;margin:9px 0 10px;background:var(--cel-ink)}.atelier-tabs{display:flex;gap:18px;margin:10px 0 10px;border-bottom:1px solid var(--cel-line)}.bangumi-3d-root button.atelier-tab{position:relative;margin:0;padding:6px 2px 7px;border:0;background:transparent;color:#8c8579;cursor:pointer;font-size:13px}.bangumi-3d-root button.atelier-tab.is-active{color:var(--cel-ink);font-weight:700}.bangumi-3d-root button.atelier-tab.is-active::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;background:var(--cel-ink);content:""}.atelier-sheet{font-size:13px;line-height:1.65}.atelier-data-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:8px 0}.atelier-data-label{margin-bottom:3px;color:var(--cel-muted);font-size:10px;letter-spacing:1px}.atelier-data-value{font-size:13.5px;line-height:1.4;font-variant-numeric:tabular-nums}.bangumi-3d-root button.atelier-primary-action{min-height:34px;padding:0 14px;border:0;background:#252820;color:#f0eee5;cursor:pointer;font-size:12px}.atelier-detail-actions{margin-top:10px;padding-top:10px;border-top:1px solid var(--cel-line)}.atelier-segmented{gap:4px;padding:3px 4px;background:rgba(24,26,22,.05);flex-wrap:nowrap}.bangumi-3d-root button.atelier-segment{padding:4px 7px;border:0;border-bottom:2px solid transparent;background:transparent;color:#5c574f;cursor:pointer;font-size:11.5px;white-space:nowrap}.bangumi-3d-root button.atelier-segment:hover{background:#e2dccf;color:#181a16}.bangumi-3d-root button.atelier-segment.is-active{border-bottom-color:var(--cel-accent);background:#ded7ce;color:#181a16;font-weight:700}.bangumi-3d-root button.atelier-segment.is-active::before{margin-right:3px;color:var(--cel-accent);content:"▪"}.atelier-score-ruler{display:flex;gap:3px;margin-top:5px;flex-wrap:wrap}.bangumi-3d-root button.atelier-score-pip{width:23px;height:23px;padding:0;border:1px solid var(--cel-line);background:#f2efe9;color:#5c574f;cursor:pointer;font-size:11px}.bangumi-3d-root button.atelier-score-pip:hover{border-color:var(--cel-ink);background:#e2dccf;color:#181a16}.bangumi-3d-root button.atelier-score-pip.is-active{border-color:#181a16;background:#181a16;color:#f2efe9}.atelier-modal-panel{max-width:780px;margin:0 auto}.atelier-modal h2{margin-bottom:18px;font-size:21px}.atelier-setting{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:13px 0;border-bottom:1px solid var(--cel-line)}.atelier-lane-editor{margin-top:20px;padding-top:16px;border-top:2px solid var(--cel-ink)}.atelier-lane-editor-list{display:flex;flex-direction:column;gap:10px;margin:12px 0}.atelier-lane-config-row{display:grid;grid-template-columns:28px minmax(110px,1.2fr) minmax(85px,.9fr) minmax(95px,1fr) minmax(110px,1.2fr) minmax(105px,1fr) auto;gap:8px;align-items:center;padding:10px 12px;background:rgba(255,252,246,.78);border:1px solid var(--cel-line);border-left:4px solid var(--cel-accent)}.atelier-lane-config-row.is-hidden-lane{opacity:.55}.atelier-lane-config-row input,.atelier-lane-config-row select{width:100%;padding:4px 7px;border:1px solid var(--cel-line);background:#faf7f0;color:var(--cel-ink);font-size:12px;border-radius:0}.atelier-viewer-canvas{position:absolute;inset:0}.atelier-viewer-canvas canvas{display:block;width:100%;height:100%}.atelier-viewer-ui{position:relative;z-index:1;display:flex;justify-content:space-between;pointer-events:none}.atelier-viewer-ui>*{pointer-events:auto}.atelier-viewer-tools{position:absolute;bottom:48px;left:50%;display:flex;align-items:center;gap:16px;transform:translateX(-50%)}.atelier-search-results{display:flex;flex-direction:column;max-height:390px;margin:18px 0;overflow:auto;border-top:1px solid var(--cel-line)}.bangumi-3d-root button.atelier-search-result{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 4px;border:0;border-bottom:1px solid var(--cel-line);background:transparent;color:var(--cel-ink);cursor:pointer;text-align:left}.bangumi-3d-root button.atelier-search-result:hover{color:var(--cel-accent)}.atelier-empty{padding:20px 0;color:var(--cel-muted)}.atelier-trend-host{min-height:190px}.atelier-trend-host .bangumi-trend-component.is-atelier{margin:2px 0 6px;padding:10px 12px;border-radius:4px;background:#faf6ee;border:1px solid #d5cab8;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}.atelier-trend-host .bangumi-trend-header{margin-bottom:8px;gap:8px}.atelier-trend-host .bangumi-trend-score-badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(143,104,61,.14);color:#7a5328;border:1px solid rgba(143,104,61,.35);font-variant-numeric:tabular-nums}.atelier-trend-host .bangumi-trend-personal-badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(176,125,53,.16);color:#8c5d19;border:1px solid rgba(176,125,53,.38);font-variant-numeric:tabular-nums}.atelier-trend-host .bangumi-trend-toggle-group{background:#efe9dd;border:1px solid #cfc3af;border-radius:4px;padding:2px}.atelier-trend-host button.bangumi-trend-btn{font-size:12px;font-weight:600;padding:2px 9px;border-radius:3px;color:#665f54}.atelier-trend-host button.bangumi-trend-btn.is-active{background:#8f683d;color:#fffdf9}.atelier-trend-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:8px;padding:6px 8px;border-radius:4px;background:#f3ede1;border:1px solid #dfd5c5}.atelier-trend-stat-cell{display:flex;flex-direction:column;gap:2px;min-width:0}.atelier-trend-stat-label{font-size:10.5px;color:#6f685d;font-weight:600}.atelier-trend-stat-val{font-size:13px;font-weight:700;color:#181a16;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.atelier-trend-stat-val.is-up{color:#2f6f4e}.atelier-trend-stat-val.is-down{color:#a94438}.atelier-trend-host .bangumi-trend-tooltip{background:rgba(250,246,238,.97)!important;border:1px solid #b8966c!important;box-shadow:0 6px 18px rgba(24,26,22,.14)!important;padding:8px 10px!important;border-radius:4px!important;color:#181a16!important;font-size:12px!important;line-height:1.45!important;min-width:136px}.atelier-trend-host .trend-tip-date{font-size:11px;color:#6f685d;font-weight:600;margin-bottom:2px}.atelier-trend-host .trend-tip-score .score-num{font-size:15px;font-weight:700;color:#8f683d}.atelier-trend-host .trend-tip-meta,.atelier-trend-host .trend-tip-ep{font-size:11.5px;color:#3b3832;margin-top:2px}.boot-center{display:flex;flex-direction:column;align-items:center;width:min(380px,82vw);text-align:center}.boot-pegbar{display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:9px;padding:0 4px;opacity:.68}.boot-peg-hole{width:6px;height:6px;border-radius:50%;border:1px solid rgba(24,26,22,.32);background:rgba(24,26,22,.05)}.boot-peg-slot{width:20px;height:5px;border-radius:999px;border:1px solid rgba(155,114,71,.48);background:rgba(155,114,71,.1)}.boot-rule-track{position:relative;width:100%;height:1px;background-color:rgba(24,26,22,.14);background-image:repeating-linear-gradient(90deg,rgba(24,26,22,.24) 0px,rgba(24,26,22,.24) 1px,transparent 1px,transparent 19px);transform:scaleX(0);transform-origin:center center;animation:boot-track-in .38s cubic-bezier(.22,1,.36,1) forwards;will-change:transform,opacity}.boot-rule{width:100%;height:1.5px;background:var(--cel-ink);transform:scaleX(.03);transform-origin:left center;transition:transform .16s cubic-bezier(.22,1,.36,1);will-change:transform}.boot-title{margin-top:18px;font-size:12px;font-weight:600;letter-spacing:2.2px;color:var(--cel-ink);opacity:0;transform:translateY(4px);animation:boot-in .52s .08s cubic-bezier(.22,1,.36,1) forwards}.boot-telemetry{margin-top:7px;font-family:var(--font-monospace,"JetBrains Mono",Consolas,monospace);font-size:10px;font-variant-numeric:tabular-nums;letter-spacing:1.6px;color:var(--cel-muted);opacity:0;transform:translateY(4px);animation:boot-in .52s .16s cubic-bezier(.22,1,.36,1) forwards}.boot-skip{position:absolute;top:clamp(22px,4vw,62px);right:clamp(24px,4vw,70px)}@keyframes boot-track-in{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}@keyframes boot-in{to{opacity:1;transform:translateY(0)}}@media(max-width:900px){.atelier-top{left:20px;right:20px;top:20px}.atelier-bottom{left:20px;right:20px;bottom:20px}.atelier-actions{max-width:65%;justify-content:flex-end}.atelier-detail{top:auto;right:20px;bottom:24px;left:20px;width:auto;max-height:52%;padding:16px 18px}.atelier-note-sheet{left:20px;right:20px;width:auto;top:64px;max-height:60%}.atelier-data-grid{grid-template-columns:1fr;gap:10px}.atelier-title{max-width:50vw}.atelier-lane-config-row{grid-template-columns:1fr 1fr}}`;

  const extraMobileAndPackCss = `
.atelier-viewport,.atelier-viewer-canvas{touch-action:none;-webkit-user-select:none;user-select:none}
.atelier-sample-banner{position:absolute;top:clamp(66px,8vh,92px);right:clamp(24px,4vw,64px);z-index:13;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 12px;background:rgba(250,245,235,.94);border:1px solid rgba(155,114,71,.42);border-left:3px solid var(--cel-accent);backdrop-filter:blur(8px);pointer-events:auto;font-size:11.5px;color:var(--cel-ink);box-shadow:0 8px 22px rgba(24,26,22,.07)}
.bangumi-3d-root[data-space-state="entering-detail"] .atelier-sample-banner,.bangumi-3d-root[data-space-state="detail"] .atelier-sample-banner{opacity:0;pointer-events:none}
.atelier-pack-section{margin:6px 0 18px;padding:14px 16px;background:rgba(255,252,246,.82);border:1px solid var(--cel-line);border-left:4px solid var(--cel-accent)}
.atelier-pack-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.atelier-pack-title{font-size:13.5px;font-weight:700;letter-spacing:.4px;color:var(--cel-ink)}
.atelier-pack-sub{margin-top:3px;font-size:11.5px;color:var(--cel-muted);line-height:1.45}
.atelier-pack-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.atelier-pack-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font-size:11px;font-weight:600;background:rgba(155,114,71,.12);color:var(--cel-accent);border:1px solid rgba(155,114,71,.3)}
.atelier-pack-badge.is-installed{background:rgba(47,111,78,.11);color:#255b3f;border-color:rgba(47,111,78,.32)}
.atelier-style-picker-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:100%}
.bangumi-3d-root button.atelier-style-card{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:6px;padding:11px 12px;width:100%;min-width:0;height:auto!important;white-space:normal!important;overflow-wrap:break-word;word-break:break-word;overflow:hidden;box-sizing:border-box;text-align:left;background:#faf7f0;border:1px solid var(--cel-line);color:var(--cel-ink);cursor:pointer;transition:border-color .16s,background .16s,transform .16s}
.bangumi-3d-root button.atelier-style-card:hover{border-color:var(--cel-accent);background:#f5efe3}
.bangumi-3d-root button.atelier-style-card.is-active{border:1.5px solid var(--cel-accent);background:#efe6d5;box-shadow:inset 0 0 0 1px rgba(155,114,71,.22)}
.bangumi-3d-root button.atelier-style-card.is-locked{opacity:.76}
.atelier-style-card-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;width:100%;min-width:0;gap:6px;font-size:12.5px;font-weight:700;white-space:normal!important;text-align:left}
.atelier-style-card-head>span:first-child{min-width:0;white-space:normal!important;overflow-wrap:break-word;word-break:break-word}
.atelier-style-card-tag{font-size:10px;padding:1px 6px;background:rgba(24,26,22,.07);color:var(--cel-muted);font-weight:600;white-space:nowrap;flex-shrink:0}
.atelier-style-card.is-active .atelier-style-card-tag{background:var(--cel-accent);color:#fff}
.atelier-style-card-desc{width:100%;min-width:0;font-size:11px;line-height:1.48;color:var(--cel-muted);white-space:normal!important;overflow-wrap:break-word;word-break:break-word;text-align:left}
.atelier-subview-switch{display:inline-flex;align-items:center;gap:2px;padding:2px 3px;background:rgba(242,239,233,.88);border:1px solid rgba(198,190,178,.72);backdrop-filter:blur(8px)}
.bangumi-3d-root[data-lens-mode="highscore"] .atelier-subview-switch{display:none!important}
.bangumi-3d-root button.atelier-subview-btn{min-height:24px;padding:2px 9px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--cel-muted);font-size:11.5px;font-weight:600;letter-spacing:.35px;cursor:pointer;white-space:nowrap;transition:all .16s ease}
.bangumi-3d-root button.atelier-subview-btn:hover{color:var(--cel-ink);background:rgba(155,114,71,.08)}
.bangumi-3d-root button.atelier-subview-btn.is-active{color:var(--cel-ink);font-weight:700;background:rgba(155,114,71,.16);border-bottom-color:var(--cel-accent)}
@media(max-width:860px){
  .atelier-style-picker-grid{grid-template-columns:1fr}
}
@media(max-width:680px){
  .bangumi-3d-root{min-height:480px}
  .atelier-top{left:12px;right:12px;top:10px;gap:8px;flex-direction:column;align-items:stretch}
  .atelier-actions{max-width:100%;justify-content:flex-start;gap:6px;overflow-x:auto;flex-wrap:nowrap;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  .atelier-actions::-webkit-scrollbar{display:none}
  .bangumi-3d-root button.atelier-btn{white-space:nowrap;font-size:11.5px;padding:4px 7px;background:rgba(242,239,233,.86);border:1px solid rgba(198,190,178,.45)}
  .atelier-curation-banner,.atelier-sample-banner{left:12px;right:12px;top:76px;padding:5px 10px}
  .atelier-bottom{left:12px;right:12px;bottom:10px;gap:8px;flex-direction:column;align-items:stretch}
  .atelier-callout-box{max-width:100%;padding:6px 10px}
  .atelier-title{max-width:100%;font-size:16px;-webkit-line-clamp:1}
  .atelier-bottom-right{justify-content:space-between;padding:6px 10px}
  .atelier-number{font-size:28px;min-width:28px}
  .atelier-hover{display:none!important}
  .atelier-detail{top:auto;left:8px;right:8px;bottom:8px;width:auto;max-height:64%;padding:14px 15px;border-top:3px solid var(--cel-accent);transform:translateY(18px)}
  .atelier-detail.is-visible{transform:translateY(0)}
  .atelier-note-sheet{left:8px;right:8px;top:46px;bottom:12px;width:auto;max-height:none}
  .atelier-modal,.atelier-viewer{padding:18px 14px}
  .atelier-style-picker-grid{grid-template-columns:1fr}
  .atelier-setting{flex-direction:column;align-items:flex-start;gap:8px}
  .atelier-viewer-tools{bottom:18px;width:calc(100% - 24px);justify-content:center;flex-wrap:wrap;gap:8px}
}
/* 移动端全屏沉浸式 3D 原画展厅（自动虚拟 90° 横屏 + 手动切竖屏 + 键盘安全态） */
.bangumi-3d-wrapper.is-mobile-3d-fullscreen{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;min-height:0!important;z-index:9990!important;overflow:hidden!important;background:#eae5e1!important}
body.bangumi-3d-mobile-active .modal-container{z-index:10050!important}
body.bangumi-3d-mobile-active .notice-container{z-index:10080!important}
.atelier-top-pinned{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;pointer-events:auto}
.bangumi-3d-root.is-mobile-3d button.atelier-orient-btn{min-height:30px;padding:4px 9px;border-radius:6px;border:1px solid rgba(155,114,71,.48);background:rgba(250,246,238,.94);color:var(--cel-ink);font-size:11.5px;font-weight:600;white-space:nowrap}
.bangumi-3d-root.is-mobile-3d button.atelier-exit-btn{min-height:30px;padding:4px 10px;border-radius:6px;border:1px solid #8f683d;background:#8f683d;color:#fffdf9!important;font-size:11.5px;font-weight:700;white-space:nowrap}
.bangumi-3d-root.is-mobile-3d button.atelier-exit-btn:hover{background:#78552f;color:#fffdf9!important;border-bottom-color:#78552f}
.bangumi-3d-root.is-mobile-3d .atelier-modal{padding:max(34px,env(safe-area-inset-top)) 14px max(24px,env(safe-area-inset-bottom))}
.bangumi-3d-root.is-mobile-3d .atelier-modal h2{margin:0 0 12px;font-size:17px}
/* 虚拟 90° 顺时针横屏态：覆盖窄屏 media query，发挥 ~840×390 横屏宽画幅（物理顶栏/挖孔安全区映射至逻辑左缘，手势条安全区映射至逻辑右缘） */
.bangumi-3d-root.is-virtual-landscape{min-height:0!important}
.bangumi-3d-root.is-virtual-landscape .atelier-top{top:10px!important;left:max(34px,env(safe-area-inset-top))!important;right:max(18px,env(safe-area-inset-bottom))!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;flex-wrap:nowrap!important}
.bangumi-3d-root.is-virtual-landscape .atelier-mark{flex-shrink:0;font-size:12.5px;letter-spacing:.6px;white-space:nowrap;padding:4px 8px;background:rgba(242,239,233,.86);border:1px solid rgba(198,190,178,.5);border-radius:6px}
.bangumi-3d-root.is-virtual-landscape .atelier-mark small{display:none!important}
.bangumi-3d-root.is-virtual-landscape .atelier-actions{flex:1 1 auto;min-width:0;max-width:none!important;justify-content:flex-start!important;gap:5px!important;overflow-x:auto!important;flex-wrap:nowrap!important;padding:0!important;-webkit-overflow-scrolling:touch}
.bangumi-3d-root.is-virtual-landscape .atelier-actions::-webkit-scrollbar{display:none}
.bangumi-3d-root.is-virtual-landscape .atelier-subview-switch{flex-shrink:0;border-radius:6px}
.bangumi-3d-root.is-virtual-landscape button.atelier-subview-btn{min-height:26px;padding:2px 8px;font-size:11px}
.bangumi-3d-root.is-virtual-landscape button.atelier-btn:not(.atelier-exit-btn):not(.atelier-orient-btn){min-height:28px;padding:3px 8px;border-radius:6px;font-size:11px;background:rgba(246,242,234,.9);border:1px solid rgba(198,190,178,.58);white-space:nowrap;flex-shrink:0}
.bangumi-3d-root.is-virtual-landscape .atelier-curation-banner,.bangumi-3d-root.is-virtual-landscape .atelier-sample-banner{top:48px!important;left:max(34px,env(safe-area-inset-top))!important;right:max(18px,env(safe-area-inset-bottom))!important;flex-wrap:nowrap!important;overflow-x:auto!important;padding:4px 10px!important;gap:6px!important}
.bangumi-3d-root.is-virtual-landscape .atelier-curation-banner::-webkit-scrollbar{display:none}
.bangumi-3d-root.is-virtual-landscape button.atelier-curation-pill{white-space:nowrap;flex-shrink:0}
.bangumi-3d-root.is-virtual-landscape .atelier-bottom{left:max(34px,env(safe-area-inset-top))!important;right:max(18px,env(safe-area-inset-bottom))!important;bottom:8px!important;flex-direction:row!important;align-items:flex-end!important;justify-content:space-between!important;gap:8px!important}
.bangumi-3d-root.is-virtual-landscape .atelier-counter-box{padding:4px 9px!important;border-radius:6px;flex-shrink:0;display:flex;align-items:center;gap:8px}
.bangumi-3d-root.is-virtual-landscape .atelier-counter-box .atelier-row{gap:5px;flex-wrap:nowrap}
.bangumi-3d-root.is-virtual-landscape .atelier-lane-eyebrow{font-size:10px;white-space:nowrap}
.bangumi-3d-root.is-virtual-landscape .atelier-number{font-size:20px!important;min-width:22px!important}
.bangumi-3d-root.is-virtual-landscape .atelier-counter-sep,.bangumi-3d-root.is-virtual-landscape .atelier-total{font-size:13px!important}
.bangumi-3d-root.is-virtual-landscape .atelier-callout-box{flex:1 1 auto;min-width:0;max-width:420px!important;padding:5px 10px!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;border-radius:6px}
.bangumi-3d-root.is-virtual-landscape .atelier-callout-line{display:none!important}
.bangumi-3d-root.is-virtual-landscape .atelier-meta{display:none!important}
.bangumi-3d-root.is-virtual-landscape .atelier-title{flex:1 1 auto;min-width:0;font-size:13.5px!important;line-height:1.25;max-width:none!important;-webkit-line-clamp:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bangumi-3d-root.is-virtual-landscape .atelier-callout-box button[data-action="read-detail"]{flex-shrink:0!important;padding:3px 10px!important;background:#8f683d!important;color:#fffdf9!important;border-color:#8f683d!important;font-weight:700!important}
.bangumi-3d-root.is-virtual-landscape .atelier-bottom-right{padding:4px 8px!important;gap:5px!important;border-radius:6px;flex-shrink:0;justify-content:flex-end!important}
.bangumi-3d-root.is-virtual-landscape .atelier-bottom-right button[data-action="replay-boot"]{display:none!important}
.bangumi-3d-root.is-virtual-landscape .file-ticks{height:14px;gap:3px}
.bangumi-3d-root.is-virtual-landscape .atelier-hover{display:none!important}
.bangumi-3d-root.is-virtual-landscape .atelier-detail{top:48px!important;right:max(18px,env(safe-area-inset-bottom))!important;bottom:10px!important;left:auto!important;width:min(410px,50%)!important;max-height:calc(100% - 58px)!important;padding:12px 15px!important;border:1px solid var(--cel-line);border-top:2px solid var(--cel-accent);transform:translateX(16px)}
.bangumi-3d-root.is-virtual-landscape .atelier-detail.is-visible{transform:translateX(0)}
.bangumi-3d-root.is-virtual-landscape .atelier-detail h1{font-size:16.5px;margin:2px 0 4px}
.bangumi-3d-root.is-virtual-landscape .atelier-data-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px 12px!important}
.bangumi-3d-root.is-virtual-landscape .atelier-note-sheet{top:48px!important;bottom:10px!important;left:max(34px,env(safe-area-inset-top))!important;right:auto!important;width:min(420px,52%)!important;max-height:calc(100% - 58px)!important}
.bangumi-3d-root.is-virtual-landscape .boot-skip{top:14px!important;right:max(18px,env(safe-area-inset-bottom))!important}
.bangumi-3d-root.is-virtual-landscape .atelier-viewer{padding:14px max(18px,env(safe-area-inset-bottom)) 14px max(34px,env(safe-area-inset-top))!important}
.bangumi-3d-root.is-virtual-landscape .atelier-viewer-tools{bottom:14px!important;width:auto!important}
/* 移动端竖屏覆盖态（用户主动点击「切竖屏」或搜索/设置安全态） */
.bangumi-3d-root.is-mobile-portrait{width:100%!important;height:100%!important;min-height:0!important}
.bangumi-3d-root.is-mobile-portrait .atelier-top{top:max(34px,env(safe-area-inset-top))!important;left:12px!important;right:12px!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:6px!important}
.bangumi-3d-root.is-mobile-portrait .atelier-mark{order:1;font-size:13px}
.bangumi-3d-root.is-mobile-portrait .atelier-mark small{display:none!important}
.bangumi-3d-root.is-mobile-portrait .atelier-top-pinned{order:2;margin-left:auto}
.bangumi-3d-root.is-mobile-portrait .atelier-actions{order:3;flex-basis:100%;max-width:100%!important;gap:5px!important}
.bangumi-3d-root.is-mobile-portrait .atelier-bottom{bottom:max(16px,env(safe-area-inset-bottom))!important;left:12px!important;right:12px!important;gap:6px!important}
.bangumi-3d-root.is-mobile-portrait .atelier-curation-banner,.bangumi-3d-root.is-mobile-portrait .atelier-sample-banner{top:calc(max(34px,env(safe-area-inset-top)) + 78px)!important}
.bangumi-3d-root.is-mobile-portrait .atelier-detail{bottom:max(12px,env(safe-area-inset-bottom))!important;max-height:60%!important}
.bangumi-3d-root.is-mobile-portrait .boot-skip{top:max(34px,env(safe-area-inset-top))!important;right:14px!important}`;

  let style = document.getElementById("atelier-cel-style");

  if (!style) {
    style = document.createElement("style");
    style.id = "atelier-cel-style";
    document.head.appendChild(style);
  }

  style.textContent = css + extraMobileAndPackCss;
}

module.exports = {
  DEFAULT_MOTION_SETTINGS,
  DEFAULT_LANE_CONFIGS,
  cloneDefaultLaneConfigs,
  normalizeLaneConfigs,
  getInkPigmentHex,
  drawInkWashTexture,
  getMotionSettings,
  saveMotionSettings,
  calculateVisibleRowWindow,
  sanitizeTrendData,
  inject3DScopedStyles,
  CoverPaletteExtractor,
  AtelierAudioEngine,
  RollingNumber,
  ScrubTitle,
  buildCelFolio,
  updateCelFolio,
  drawTierPlaqueTexture,
  drawTrackSignpostTexture,
  buildTrackSignpost,
  updateTrackSignpost,
  smooth,
  clamp,
  disposeTexture
};
