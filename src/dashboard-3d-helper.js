const THREE = require("three");

const DEFAULT_MOTION_SETTINGS = Object.freeze({
  intro: true,
  Selection: true,
  hover: true,
  transition: true,
  breath: true,
  breathing: true
});

const SERIF_FONT_STACK =
  '"Source Han Serif SC", "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", "SimSun", "FangSong", "Microsoft YaHei", serif';
const SANS_FONT_STACK =
  '"Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
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
    plaqueNote: "案头连载跟进 · 实时进度"
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

function makeCanvasTexture(width, height, draw) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  draw(context, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
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

function fitTitleLines(context, rawTitle, maxWidth, fontFamily = SERIF_FONT_STACK) {
  const text = String(rawTitle || "未命名档案").trim() || "未命名档案";
  const tokens = tokenizeMixedTitle(text);
  const candidateSizes = [52, 46, 40, 35, 31, 27];

  for (const fontSize of candidateSizes) {
    context.font = `700 ${fontSize}px ${fontFamily}`;
    const lines = wrapTokensToLines(context, tokens, maxWidth);
    if (lines.length <= 2) {
      return { fontSize, lines };
    }
  }

  // 超长标题兜底：使用 26px 两行排版，第二行保留首部与区分性尾部（如 OVA / 续 / 完 / 第2季）
  const minSize = 26;
  context.font = `700 ${minSize}px ${fontFamily}`;
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
  return makeCanvasTexture(1024, 360, (context, width, height) => {
    const accent = item.laneAccent || "#9b7247";

    if (slotType === "divider") {
      // 诚实空轨 / 章节隔板铭牌：高对比宣纸卡头，无白雾遮挡
      context.fillStyle = "#e6dccb";
      context.fillRect(0, 0, width, height);

      context.fillStyle = accent;
      context.fillRect(0, 0, width, 20);
      context.fillRect(32, 42, 14, height - 84);

      context.strokeStyle = "rgba(20, 22, 18, 0.48)";
      context.lineWidth = 4;
      context.strokeRect(16, 20, width - 32, height - 36);

      const badgeText = String(item.laneBadge || "ARCHIVE TRACK").toUpperCase();
      context.fillStyle = accent;
      context.fillRect(64, 46, Math.min(420, badgeText.length * 22 + 36), 44);
      context.fillStyle = "#fdfbf7";
      context.font = `700 25px ${MONO_FONT_STACK}`;
      context.fillText(badgeText, 80, 77);

      const mainLabel = String(item.dividerLabel || item.laneLabel || "档案分栏");
      const fitted = fitTitleLines(context, mainLabel, width - 120, SERIF_FONT_STACK);
      context.fillStyle = "#0f110e";
      const dSize = Math.min(54, fitted.fontSize + 4);
      context.font = `900 ${dSize}px ${SERIF_FONT_STACK}`;
      fitted.lines.forEach((line, idx) => {
        context.fillText(line, 64, 166 + idx * 58);
      });

      const subNote = String(
        item.plaqueNote ||
        (item.isEmptyLane
          ? "当前轨道暂无收录动画 · 保持诚实空轨陈列"
          : "CONTINUED ARCHIVE LOOP · 循环分栏界标")
      );
      context.fillStyle = "#2c2924";
      context.font = `700 28px ${SANS_FONT_STACK}`;
      context.fillText(subNote.slice(0, 34), 64, height - 48);
      return;
    }

    // 真实动画档案标题签（1024×360 高清纸签，支持两行自适应与策展徽章）
    context.fillStyle = "#f4f0e8";
    context.fillRect(0, 0, width, height);

    context.fillStyle = accent;
    context.fillRect(0, 0, 12, height);

    context.strokeStyle = "rgba(24, 26, 22, 0.25)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 4);
    context.lineTo(width, 4);
    context.moveTo(0, height - 8);
    context.lineTo(width, height - 8);
    context.stroke();

    const rightReserve = item.curatedBadge ? 250 : 48;
    const fitted = fitTitleLines(
      context,
      item.name || "未命名档案",
      width - 44 - rightReserve,
      SERIF_FONT_STACK
    );

    if (item.curatedBadge) {
      const pillW = 216;
      const pillH = 44;
      const pillX = width - pillW - 28;
      const pillY = 26;
      context.fillStyle = accent;
      context.fillRect(pillX, pillY, pillW, pillH);
      context.fillStyle = "#fdfbf7";
      context.font = `700 22px ${SANS_FONT_STACK}`;
      context.fillText(
        `★ ${item.curatedScoreText || "高分"} · ${item.curatedBadge}`.slice(0, 14),
        pillX + 14,
        pillY + 30
      );
    }

    context.fillStyle = "#141612";
    context.font = `700 ${fitted.fontSize}px ${SERIF_FONT_STACK}`;
    if (fitted.lines.length === 1) {
      context.fillText(fitted.lines[0], 38, 92);
    } else {
      const lineStep = Math.round(fitted.fontSize * 1.18);
      context.fillText(fitted.lines[0], 38, 74);
      context.fillText(fitted.lines[1], 38, 74 + lineStep);
    }

    const jpOrMeta = String(
      item.japaneseName || `${item.year || ""} ${item.season || ""}`.trim() || "ATELIER CEL ARCHIVE"
    );
    const metaY = fitted.lines.length > 1 ? 222 : 168;
    context.fillStyle = "#5c564e";
    context.font = `500 27px ${SANS_FONT_STACK}`;
    context.fillText(jpOrMeta.slice(0, 32), 38, metaY);

    context.strokeStyle = "rgba(24, 26, 22, 0.14)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(38, height - 82);
    context.lineTo(width - 32, height - 82);
    context.stroke();

    const codeStr = "BGM-" + String(item.subjectId || "000").slice(-3).padStart(3, "0");
    const stateStr = item.state || "未归档";
    const scoreVal = Number(item.personalScore ?? item.bangumiScore ?? item.preciseScore);
    const scoreStr = Number.isFinite(scoreVal) && scoreVal > 0 ? `★ ${scoreVal.toFixed(1)}` : "未评分";

    context.fillStyle = "#181a16";
    context.font = `700 26px ${MONO_FONT_STACK}`;
    context.fillText(`${codeStr}  ·  ${stateStr}  ·  ${scoreStr}`, 38, height - 34);
  });
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

function disposeTexture(texture) {
  if (texture?.dispose) texture.dispose();
}

function buildCelFolio(item = {}, options = {}) {
  const slotType = options.slotType || item.slotType || "anime";
  const outerGroup = new THREE.Group();
  const folioTiltGroup = new THREE.Group();
  outerGroup.add(folioTiltGroup);

  const width = Number(options.width) || 2.28;
  const fullHeight = Number(options.height) || 3.22;
  const blankHeight = 0.44;
  const dividerHeight = 1.24;

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: slotType === "blank" ? 0xeae3d9 : 0xf4f0e8,
    roughness: 0.88,
    metalness: 0.01
  });

  const valleyMaterial = new THREE.MeshStandardMaterial({
    color: 0xddd4ca,
    roughness: 0.74,
    metalness: 0.05
  });

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xd5a85b,
    roughness: 0.36,
    metalness: 0.34,
    emissive: 0x6a4e24,
    emissiveIntensity: 0.06
  });

  const brassMaterial = new THREE.MeshStandardMaterial({
    color: 0xae8b4e,
    roughness: 0.3,
    metalness: 0.78
  });

  const sharedData = options.sharedSourceGroup?.userData || null;

  // 高清晰度海报层：不再蒙半透明白雾，不再与 cover 重复贴同一张图导致视差重影
  const posterMaterial = new THREE.MeshStandardMaterial({
    map: sharedData?.posterMaterial?.map || null,
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.01
  });

  // 赛璐珞清漆护膜层：仅保留极轻微透明光泽，绝不重复挂载封面贴图
  const coverMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.05,
    roughness: 0.22,
    metalness: 0.0,
    depthWrite: false
  });

  const parts = [];
  const addPart = (name, object, depth) => {
    object.position.z = depth;
    object.userData.assemblyPart = name;
    folioTiltGroup.add(object);
    parts.push(object);
    return object;
  };

  const carrier = addPart(
    "carrier",
    new THREE.Mesh(
      new THREE.BoxGeometry(width, fullHeight, 0.12),
      paperMaterial
    ),
    -0.12
  );

  const substrate = addPart(
    "substrate",
    new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.08, fullHeight - 0.08, 0.06),
      valleyMaterial
    ),
    -0.03
  );

  // 可抽出的原画随附笔记纸页三维实体层（位于基板与画芯之间，抽出时向右上滑出）
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
  noteSheetMesh.position.set(0, 0, 0.018);
  noteSheetMesh.visible = false;
  noteSheetMesh.userData.assemblyPart = "substrate";
  folioTiltGroup.add(noteSheetMesh);

  const artHeight = fullHeight * 0.58;
  const labelHeight = fullHeight - artHeight;
  const artCenterY = fullHeight / 2 - artHeight / 2 - 0.07;
  const labelCenterY = -fullHeight / 2 + labelHeight / 2 + 0.02;

  const poster = addPart(
    "poster-core",
    new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.18, artHeight - 0.1),
      posterMaterial
    ),
    0.065
  );

  poster.position.y = artCenterY;

  const cover = addPart(
    "cover",
    new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.14, artHeight - 0.06),
      coverMaterial
    ),
    0.115
  );

  cover.position.y = artCenterY;

  const labelTexture =
    slotType === "blank"
      ? null
      : sharedData?.labelMaterial?.map || drawTitleTexture(item, slotType);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture,
    color: 0xffffff
  });

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.16, labelHeight - 0.1),
    labelMaterial
  );

  label.position.set(0, labelCenterY, 0.095);
  label.userData.assemblyPart = "cover";
  folioTiltGroup.add(label);

  const frame = new THREE.Group();
  const thickness = 0.05;
  const frameWidth = width - 0.05;
  const frameHeight = artHeight + 0.04;

  [
    [0, artCenterY + frameHeight / 2 - thickness / 2, frameWidth, thickness],
    [0, artCenterY - frameHeight / 2 + thickness / 2, frameWidth, thickness],
    [-frameWidth / 2 + thickness / 2, artCenterY, thickness, frameHeight],
    [frameWidth / 2 - thickness / 2, artCenterY, thickness, frameHeight]
  ].forEach(([x, y, w, h]) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.045),
      frameMaterial
    );
    bar.position.set(x, y, 0);
    frame.add(bar);
  });

  const leftGusset = new THREE.Mesh(
    new THREE.BoxGeometry(0.095, fullHeight - 0.14, 0.11),
    valleyMaterial
  );

  leftGusset.position.x = -width / 2 + 0.06;
  frame.add(leftGusset);

  const rightGusset = new THREE.Mesh(
    new THREE.BoxGeometry(0.095, fullHeight - 0.14, 0.11),
    valleyMaterial
  );

  rightGusset.position.x = width / 2 - 0.06;
  frame.add(rightGusset);

  addPart("cel-frame", frame, 0.105);

  const fasteners = new THREE.Group();

  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ].forEach(([x, y]) => {
    const fastener = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12),
      brassMaterial
    );

    fastener.rotation.x = Math.PI / 2;
    fastener.position.set(
      x * (width / 2 - 0.12),
      y * (fullHeight / 2 - 0.12),
      0
    );

    fasteners.add(fastener);
  });

  addPart("fasteners", fasteners, 0.19);

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
  backLabel.position.z = -0.19;
  backLabel.userData.assemblyPart = "substrate";
  folioTiltGroup.add(backLabel);

  const titleSpine = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.18, 0.09, 0.065),
    paperMaterial
  );

  titleSpine.position.set(0, fullHeight / 2 - 0.105, 0.165);
  titleSpine.userData.assemblyPart = "cover";
  folioTiltGroup.add(titleSpine);

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

  const setSlotType = (nextType, nextItem = item) => {
    const blank = nextType === "blank";
    const divider = nextType === "divider";
    const anime = nextType === "anime";

    outerGroup.userData.slotType = nextType;

    const scaleY = blank
      ? blankHeight / fullHeight
      : divider
        ? dividerHeight / fullHeight
        : 1;

    carrier.scale.y = scaleY;
    substrate.scale.y = scaleY;

    carrier.material.color.setHex(blank ? 0xe8e0d5 : divider ? 0xe9e0d2 : 0xf4f0e8);

    // 仅真实动画封套显示海报窗与金属外框；章节/空轨隔板显示为低矮清晰的检索铭牌
    poster.visible = anime;
    cover.visible = anime;
    frame.visible = anime;
    fasteners.visible = anime;
    backLabel.visible = anime;
    titleSpine.visible = anime;

    label.visible = !blank;
    if (divider) {
      label.position.set(0, 0, 0.085);
      label.scale.set(1, (dividerHeight - 0.12) / (labelHeight - 0.1), 1);
    } else {
      label.position.set(0, labelCenterY, 0.095);
      label.scale.set(1, 1, 1);
    }

    blankGuide.visible = blank;
    if (!anime) {
      noteSheetMesh.visible = false;
    }
  };

  outerGroup.userData = {
    parts,
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

  const css = `.bangumi-3d-root{--cel-paper:#f2efe9;--cel-paper-deep:#eae5e1;--cel-ink:#181a16;--cel-muted:#716b61;--cel-line:#c6beb2;--cel-accent:#9b7247;--cel-aura-color:#d9c6b4;--cel-ink-pigment:#9b7247;position:relative;width:100%;height:100%;min-height:620px;overflow:hidden;background:var(--cel-paper-deep);color:var(--cel-ink);font-family:var(--font-interface)}.bangumi-3d-root[data-lens-mode="highscore"]{--cel-paper-deep:#ece4d7;--cel-accent:#b07d35}.bangumi-3d-root button{box-shadow:none!important;border-radius:0;height:auto;font-family:inherit;outline:none}.scene-atmosphere{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at 51% 70%,color-mix(in srgb,var(--cel-aura-color) 36%,transparent),transparent 52%),radial-gradient(ellipse at 92% 38%,color-mix(in srgb,var(--cel-aura-color) 16%,transparent),transparent 56%),linear-gradient(124deg,#f2efe9 0%,var(--cel-paper-deep) 62%,color-mix(in srgb,var(--cel-aura-color) 15%,var(--cel-paper-deep)) 100%)}.atelier-ink-bloom{position:absolute;left:29%;top:48%;width:540px;height:540px;margin-left:-270px;margin-top:-270px;z-index:1;pointer-events:none;opacity:0;transform:scale(.62) rotate(-6deg);transition:opacity .48s cubic-bezier(.16,1,.3,1),transform .68s cubic-bezier(.16,1,.3,1);background:radial-gradient(circle at 46% 48%,color-mix(in srgb,var(--cel-ink-pigment) 34%,transparent) 0%,color-mix(in srgb,var(--cel-ink-pigment) 20%,transparent) 38%,color-mix(in srgb,var(--cel-ink-pigment) 8%,transparent) 62%,transparent 76%),radial-gradient(ellipse at 62% 38%,color-mix(in srgb,var(--cel-ink-pigment) 22%,transparent) 0%,transparent 58%),radial-gradient(ellipse at 36% 64%,color-mix(in srgb,var(--cel-ink-pigment) 18%,transparent) 0%,transparent 54%);filter:blur(10px)}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-ink-bloom,.bangumi-3d-root[data-space-state="detail"] .atelier-ink-bloom{opacity:.92;transform:scale(1.06) rotate(0deg)}.bangumi-3d-root[data-reduced-motion="true"] .atelier-ink-bloom{transition:none;transform:scale(1)}.atelier-viewport{position:absolute;inset:0;z-index:2;overflow:hidden;pointer-events:auto}.atelier-viewport canvas{display:block;width:100%;height:100%}.atelier-ui{position:absolute;inset:0;z-index:10;pointer-events:none!important}.atelier-top,.atelier-bottom{position:absolute;pointer-events:none}.atelier-top>*,.atelier-bottom>*{pointer-events:auto}.atelier-top{top:clamp(18px,2.6vw,36px);left:clamp(24px,4vw,64px);right:clamp(24px,4vw,64px);display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.atelier-curation-banner{position:absolute;top:clamp(68px,8.5vh,94px);left:clamp(24px,4vw,64px);z-index:11;display:none;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 14px;background:rgba(244,239,229,.92);border:1px solid rgba(176,125,53,.38);border-left:3px solid var(--cel-accent);backdrop-filter:blur(8px);pointer-events:auto}.bangumi-3d-root[data-lens-mode="highscore"] .atelier-curation-banner{display:flex}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-curation-banner,.bangumi-3d-root[data-space-state="detail"] .atelier-curation-banner,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-curation-banner{opacity:0;pointer-events:none}.atelier-curation-eyebrow{font-size:11px;font-weight:700;color:var(--cel-accent);letter-spacing:1px;margin-right:4px}.bangumi-3d-root button.atelier-curation-pill{padding:3px 9px;border:1px solid rgba(176,125,53,.28);background:rgba(255,252,245,.75);color:var(--cel-ink);font-size:11px;cursor:pointer;transition:all .15s}.bangumi-3d-root button.atelier-curation-pill.is-active,.bangumi-3d-root button.atelier-curation-pill:hover{background:var(--cel-accent);color:#fff;border-color:var(--cel-accent)}.atelier-bottom{left:clamp(24px,4vw,64px);right:clamp(24px,4vw,64px);bottom:clamp(20px,3vw,40px);display:flex;align-items:flex-end;justify-content:space-between;gap:24px;transition:opacity .25s ease}.atelier-hover{position:absolute;left:clamp(24px,4vw,64px);bottom:clamp(144px,17vh,194px);z-index:12;max-width:min(310px,27vw);padding:7px 12px;border:1px solid rgba(198,190,178,.55);border-left:3px solid var(--cel-accent);background:rgba(242,239,233,.95);box-shadow:0 8px 24px rgba(24,26,22,.07);color:var(--cel-ink);font-size:12px;line-height:1.42;letter-spacing:.35px;opacity:0;pointer-events:none!important;transform:translateY(6px);transition:opacity .18s,transform .18s}.atelier-hover.is-visible{opacity:1;transform:translateY(0)}.atelier-detail{position:absolute;top:clamp(64px,7.5vh,84px);right:clamp(24px,4vw,56px);z-index:12;width:min(476px,calc(100% - 48px));max-height:calc(100% - 78px);padding:16px 22px;background:rgba(244,241,234,.96);backdrop-filter:blur(12px);border:1px solid var(--cel-line);box-shadow:0 18px 44px rgba(24,26,22,.08);overflow:auto;opacity:0;pointer-events:none;transform:translateX(16px);transition:opacity .28s,transform .28s}.atelier-detail.is-visible{opacity:1;pointer-events:auto;transform:translateX(0)}.atelier-folio-sheet-hint{margin-top:6px;padding:5px 10px;background:rgba(155,114,71,.09);border-left:2px solid var(--cel-accent);font-size:11px;color:#544e45;display:flex;align-items:center;justify-content:space-between;gap:8px}.atelier-note-sheet{position:absolute;top:clamp(76px,10vh,108px);left:clamp(310px,28vw,470px);z-index:16;width:min(460px,calc(100% - 80px));max-height:calc(100% - 104px);display:flex;flex-direction:column;background:#faf6ee;border:1px solid #bba98e;border-top:4px solid var(--cel-accent);box-shadow:0 24px 56px rgba(24,26,22,.16),-8px 0 24px rgba(155,114,71,.08);opacity:0;pointer-events:none;transform:translate3d(-44px,14px,0) rotate(-1.5deg) scale(.95);transform-origin:left center;transition:opacity .26s cubic-bezier(.16,1,.3,1),transform .32s cubic-bezier(.16,1,.3,1)}.atelier-note-sheet.is-open{opacity:1;pointer-events:auto;transform:translate3d(0,0,0) rotate(0deg) scale(1)}.atelier-note-sheet-holes{display:flex;justify-content:space-around;padding:8px 36px 4px;border-bottom:1px dashed rgba(155,114,71,.3);background:#f3ede0}.atelier-note-hole{width:10px;height:10px;border-radius:50%;background:#dfd7c8;border:1px solid rgba(24,26,22,.18)}.atelier-note-sheet-header{padding:14px 20px 12px;border-bottom:1px solid rgba(24,26,22,.14);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;background:#faf6ee}.atelier-note-sheet-title{font-size:18px;font-weight:700;line-height:1.3;margin:4px 0 2px;font-family:${SERIF_FONT_STACK}}.atelier-note-sheet-body{flex:1;min-height:220px;max-height:calc(80vh - 160px);overflow-y:auto;padding:16px 20px 22px;font-size:13px;line-height:1.75;color:#22241f;background:repeating-linear-gradient(180deg,#faf6ee 0px,#faf6ee 27px,rgba(155,114,71,.11) 28px);overscroll-behavior:contain}.atelier-note-section{margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(198,190,178,.5)}.atelier-note-section h3{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;color:var(--cel-accent);text-transform:uppercase}.atelier-note-kv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;font-size:12px}.atelier-note-kv{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted rgba(198,190,178,.6);padding:2px 0}.atelier-note-kv span:first-child{color:var(--cel-muted)}.atelier-note-paragraph{margin:6px 0;white-space:pre-wrap;word-break:break-word}.bangumi-3d-root[data-space-state="entering-detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-bottom,.bangumi-3d-root[data-space-state="entering-detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-bottom>*,.bangumi-3d-root[data-space-state="entering-detail"] .atelier-hover,.bangumi-3d-root[data-space-state="detail"] .atelier-hover,.bangumi-3d-root[data-space-state="leaving-detail"] .atelier-hover{opacity:0!important;pointer-events:none!important}.atelier-boot{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#f2efe9;transition:opacity .55s}.atelier-boot.is-hidden{opacity:0;pointer-events:none}.atelier-modal,.atelier-viewer{position:absolute;inset:0;z-index:30;overflow:auto;padding:clamp(32px,5vw,60px) clamp(24px,5vw,64px);background:rgba(242,239,233,.97);backdrop-filter:blur(12px);pointer-events:auto}.atelier-mark{font-size:13px;font-weight:700;letter-spacing:1px}.atelier-mark small,.atelier-meta{display:block;margin-top:5px;color:var(--cel-muted);font-size:10px;font-weight:500;letter-spacing:1px}.atelier-actions,.atelier-row,.atelier-detail-actions,.atelier-segmented,.atelier-bottom-right,.atelier-counter-numbers{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bangumi-3d-root button.atelier-btn,.bangumi-3d-root button.atelier-text-action,.bangumi-3d-root button.atelier-back-lead{min-height:28px;padding:3px 6px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--cel-ink);cursor:pointer;font-size:12px;letter-spacing:.55px}.bangumi-3d-root button.atelier-btn:hover,.bangumi-3d-root button.atelier-btn.is-active,.bangumi-3d-root button.atelier-text-action:hover,.bangumi-3d-root button.atelier-back-lead:hover{border-bottom-color:var(--cel-accent);color:var(--cel-accent);background:rgba(155,114,71,.08)}.atelier-title{max-width:min(560px,45vw);font-size:clamp(19px,1.9vw,26px);font-weight:650;line-height:1.24;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}.atelier-title.is-scrubbing{min-width:240px;height:28px;color:transparent;background:var(--cel-ink)}.atelier-number{display:inline-block;min-width:42px;font-size:42px;font-weight:600;font-variant-numeric:tabular-nums;line-height:.85}.atelier-number.is-rolling{animation:atelier-roll .46s ease}@keyframes atelier-roll{from{opacity:0;transform:translateY(13px)}to{opacity:1;transform:none}}.atelier-lane-eyebrow,.atelier-counter-sep,.atelier-total{color:var(--cel-muted);font-size:11px;font-weight:600;letter-spacing:1px}.atelier-counter-sep,.atelier-total{font-size:20px;font-weight:500;letter-spacing:0}.atelier-counter-box,.atelier-bottom-right{padding:8px 14px;background:rgba(242,239,233,.9);backdrop-filter:blur(8px);border:1px solid rgba(198,190,178,.5)}.atelier-callout-box{display:flex;flex-direction:column;gap:5px;max-width:540px;padding:8px 14px;background:rgba(242,239,233,.9);backdrop-filter:blur(8px);border:1px solid rgba(198,190,178,.5)}.atelier-callout-line{width:min(280px,100%);height:1px;margin:3px 0 5px;background:var(--cel-line)}.file-ticks{display:flex;align-items:center;gap:4px;height:18px}.file-tick{width:2px;height:9px;background:var(--cel-line);transition:height .2s,background .2s}.file-tick.is-active{height:18px;background:var(--cel-ink)}.atelier-detail h1{margin:5px 0 6px;font-size:21px;font-weight:700;line-height:1.26;word-break:break-word;font-family:${SERIF_FONT_STACK}}.atelier-detail-rule{width:100%;height:2px;margin:9px 0 10px;background:var(--cel-ink)}.atelier-tabs{display:flex;gap:18px;margin:10px 0 10px;border-bottom:1px solid var(--cel-line)}.bangumi-3d-root button.atelier-tab{position:relative;margin:0;padding:6px 2px 7px;border:0;background:transparent;color:#8c8579;cursor:pointer;font-size:13px}.bangumi-3d-root button.atelier-tab.is-active{color:var(--cel-ink);font-weight:700}.bangumi-3d-root button.atelier-tab.is-active::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;background:var(--cel-ink);content:""}.atelier-sheet{font-size:13px;line-height:1.65}.atelier-data-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:8px 0}.atelier-data-label{margin-bottom:3px;color:var(--cel-muted);font-size:10px;letter-spacing:1px}.atelier-data-value{font-size:13.5px;line-height:1.4;font-variant-numeric:tabular-nums}.bangumi-3d-root button.atelier-primary-action{min-height:34px;padding:0 14px;border:0;background:#252820;color:#f0eee5;cursor:pointer;font-size:12px}.atelier-detail-actions{margin-top:10px;padding-top:10px;border-top:1px solid var(--cel-line)}.atelier-segmented{gap:4px;padding:3px 4px;background:rgba(24,26,22,.05);flex-wrap:nowrap}.bangumi-3d-root button.atelier-segment{padding:4px 7px;border:0;border-bottom:2px solid transparent;background:transparent;color:#5c574f;cursor:pointer;font-size:11.5px;white-space:nowrap}.bangumi-3d-root button.atelier-segment:hover{background:#e2dccf;color:#181a16}.bangumi-3d-root button.atelier-segment.is-active{border-bottom-color:var(--cel-accent);background:#ded7ce;color:#181a16;font-weight:700}.bangumi-3d-root button.atelier-segment.is-active::before{margin-right:3px;color:var(--cel-accent);content:"▪"}.atelier-score-ruler{display:flex;gap:3px;margin-top:5px;flex-wrap:wrap}.bangumi-3d-root button.atelier-score-pip{width:23px;height:23px;padding:0;border:1px solid var(--cel-line);background:#f2efe9;color:#5c574f;cursor:pointer;font-size:11px}.bangumi-3d-root button.atelier-score-pip:hover{border-color:var(--cel-ink);background:#e2dccf;color:#181a16}.bangumi-3d-root button.atelier-score-pip.is-active{border-color:#181a16;background:#181a16;color:#f2efe9}.atelier-modal-panel{max-width:780px;margin:0 auto}.atelier-modal h2{margin-bottom:18px;font-size:21px}.atelier-setting{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:13px 0;border-bottom:1px solid var(--cel-line)}.atelier-lane-editor{margin-top:20px;padding-top:16px;border-top:2px solid var(--cel-ink)}.atelier-lane-editor-list{display:flex;flex-direction:column;gap:10px;margin:12px 0}.atelier-lane-config-row{display:grid;grid-template-columns:28px minmax(110px,1.2fr) minmax(85px,.9fr) minmax(95px,1fr) minmax(110px,1.2fr) minmax(105px,1fr) auto;gap:8px;align-items:center;padding:10px 12px;background:rgba(255,252,246,.78);border:1px solid var(--cel-line);border-left:4px solid var(--cel-accent)}.atelier-lane-config-row.is-hidden-lane{opacity:.55}.atelier-lane-config-row input,.atelier-lane-config-row select{width:100%;padding:4px 7px;border:1px solid var(--cel-line);background:#faf7f0;color:var(--cel-ink);font-size:12px;border-radius:0}.atelier-viewer-canvas{position:absolute;inset:0}.atelier-viewer-canvas canvas{display:block;width:100%;height:100%}.atelier-viewer-ui{position:relative;z-index:1;display:flex;justify-content:space-between;pointer-events:none}.atelier-viewer-ui>*{pointer-events:auto}.atelier-viewer-tools{position:absolute;bottom:48px;left:50%;display:flex;align-items:center;gap:16px;transform:translateX(-50%)}.atelier-search-results{display:flex;flex-direction:column;max-height:390px;margin:18px 0;overflow:auto;border-top:1px solid var(--cel-line)}.bangumi-3d-root button.atelier-search-result{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 4px;border:0;border-bottom:1px solid var(--cel-line);background:transparent;color:var(--cel-ink);cursor:pointer;text-align:left}.bangumi-3d-root button.atelier-search-result:hover{color:var(--cel-accent)}.atelier-empty{padding:20px 0;color:var(--cel-muted)}.atelier-trend-host{min-height:190px}.atelier-trend-host .bangumi-trend-component.is-atelier{margin:2px 0 6px;padding:10px 12px;border-radius:4px;background:#faf6ee;border:1px solid #d5cab8;box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}.atelier-trend-host .bangumi-trend-header{margin-bottom:8px;gap:8px}.atelier-trend-host .bangumi-trend-score-badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(143,104,61,.14);color:#7a5328;border:1px solid rgba(143,104,61,.35);font-variant-numeric:tabular-nums}.atelier-trend-host .bangumi-trend-personal-badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(176,125,53,.16);color:#8c5d19;border:1px solid rgba(176,125,53,.38);font-variant-numeric:tabular-nums}.atelier-trend-host .bangumi-trend-toggle-group{background:#efe9dd;border:1px solid #cfc3af;border-radius:4px;padding:2px}.atelier-trend-host button.bangumi-trend-btn{font-size:12px;font-weight:600;padding:2px 9px;border-radius:3px;color:#665f54}.atelier-trend-host button.bangumi-trend-btn.is-active{background:#8f683d;color:#fffdf9}.atelier-trend-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:8px;padding:6px 8px;border-radius:4px;background:#f3ede1;border:1px solid #dfd5c5}.atelier-trend-stat-cell{display:flex;flex-direction:column;gap:2px;min-width:0}.atelier-trend-stat-label{font-size:10.5px;color:#6f685d;font-weight:600}.atelier-trend-stat-val{font-size:13px;font-weight:700;color:#181a16;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.atelier-trend-stat-val.is-up{color:#2f6f4e}.atelier-trend-stat-val.is-down{color:#a94438}.atelier-trend-host .bangumi-trend-tooltip{background:rgba(250,246,238,.97)!important;border:1px solid #b8966c!important;box-shadow:0 6px 18px rgba(24,26,22,.14)!important;padding:8px 10px!important;border-radius:4px!important;color:#181a16!important;font-size:12px!important;line-height:1.45!important;min-width:136px}.atelier-trend-host .trend-tip-date{font-size:11px;color:#6f685d;font-weight:600;margin-bottom:2px}.atelier-trend-host .trend-tip-score .score-num{font-size:15px;font-weight:700;color:#8f683d}.atelier-trend-host .trend-tip-meta,.atelier-trend-host .trend-tip-ep{font-size:11.5px;color:#3b3832;margin-top:2px}.boot-center{text-align:center}.boot-rule{width:0;height:1px;background:var(--cel-ink);animation:boot-rule 1.2s ease forwards}.boot-title{margin-top:18px;font-size:12px;letter-spacing:2px;opacity:0;animation:boot-in .65s .32s forwards}.boot-skip{position:absolute;top:clamp(22px,4vw,62px);right:clamp(24px,4vw,70px)}@keyframes boot-rule{to{width:360px}}@keyframes boot-in{to{opacity:1}}@media(max-width:900px){.atelier-top{left:20px;right:20px;top:20px}.atelier-bottom{left:20px;right:20px;bottom:20px}.atelier-actions{max-width:65%;justify-content:flex-end}.atelier-detail{top:auto;right:20px;bottom:24px;left:20px;width:auto;max-height:52%;padding:16px 18px}.atelier-note-sheet{left:20px;right:20px;width:auto;top:64px;max-height:60%}.atelier-data-grid{grid-template-columns:1fr;gap:10px}.atelier-title{max-width:50vw}.atelier-lane-config-row{grid-template-columns:1fr 1fr}}`;

  let style = document.getElementById("atelier-cel-style");

  if (!style) {
    style = document.createElement("style");
    style.id = "atelier-cel-style";
    document.head.appendChild(style);
  }

  style.textContent = css;
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
  smooth,
  clamp,
  disposeTexture
};
