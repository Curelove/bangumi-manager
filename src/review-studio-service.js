const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const noteUtils = require("./note-utils.js");
const roxyMascotService = require("./roxy-mascot-service.js");

let electronShell = null;
try {
  electronShell = require("electron").shell;
} catch (e) {}

/**
 * 支持的本地视频播放器预设定义
 */
const VIDEO_PLAYER_PRESETS = {
  auto: {
    id: "auto",
    label: "智能自动探测（优先 PotPlayer / 弹弹play）",
    supportsCliSeek: true
  },
  potplayer: {
    id: "potplayer",
    label: "PotPlayer（支持 /seek=HH:MM:SS 精准空降画面）",
    supportsCliSeek: true
  },
  dandanplay: {
    id: "dandanplay",
    label: "弹弹play（直接拉起对应集数 + 自动复制时间码）",
    supportsCliSeek: false
  },
  mpv: {
    id: "mpv",
    label: "MPV Player（支持 --start=MM:SS 精准空降）",
    supportsCliSeek: true
  },
  vlc: {
    id: "vlc",
    label: "VLC Media Player（支持 --start-time=秒 精准空降）",
    supportsCliSeek: true
  },
  mpc: {
    id: "mpc",
    label: "MPC-HC / MPC-BE（支持 /startpos 精准空降）",
    supportsCliSeek: true
  },
  system: {
    id: "system",
    label: "系统默认播放器（仅打开对应集数视频）",
    supportsCliSeek: false
  }
};

/**
 * 展开 Windows 环境变量（如 %APPDATA%、%LOCALAPPDATA%、%PROGRAMFILES% 等）
 */
function expandWindowsEnvVars(rawPath) {
  let s = String(rawPath || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!s) return "";
  s = s.replace(/%([^%]+)%/g, (_, varName) => {
    const key = String(varName || "").trim();
    return process.env[key] || process.env[key.toUpperCase()] || `%${key}%`;
  });
  return s;
}

/**
 * 解析可执行文件路径或 Windows .lnk 快捷方式真实目标路径
 * - 优先使用 Electron 的 shell.readShortcutLink(lnkPath).target
 * - 回退使用 PowerShell WScript.Shell 解析快捷方式
 */
function resolveExecutableOrShortcutPath(rawPath) {
  const expanded = expandWindowsEnvVars(rawPath);
  if (!expanded) return "";

  try {
    if (!fs.existsSync(expanded)) {
      return "";
    }
  } catch (e) {
    return "";
  }

  if (/\.lnk$/i.test(expanded)) {
    // 1. 优先尝试 Electron 原生 readShortcutLink
    if (electronShell && typeof electronShell.readShortcutLink === "function") {
      try {
        const parsed = electronShell.readShortcutLink(expanded);
        if (parsed && parsed.target && fs.existsSync(parsed.target)) {
          return path.normalize(parsed.target);
        }
      } catch (e) {}
    }

    // 2. 回退使用 PowerShell WScript.Shell 读取 .lnk TargetPath
    if (process.platform === "win32") {
      try {
        const safeLnk = expanded.replace(/'/g, "''");
        const out = execSync(
          `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${safeLnk}').TargetPath"`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1800 }
        ).trim();
        if (out && fs.existsSync(out)) {
          return path.normalize(out);
        }
      } catch (e) {}
    }
    return "";
  }

  return path.normalize(expanded);
}

/**
 * 根据可执行文件名推断播放器类型
 */
function inferPlayerKindFromExe(exePath) {
  const base = path.basename(String(exePath || "")).toLowerCase();
  if (base.includes("potplayer")) return "potplayer";
  if (base.includes("dandanplay") || base.includes("弹弹play")) return "dandanplay";
  if (base === "mpv.exe" || base.includes("mpv")) return "mpv";
  if (base.includes("vlc")) return "vlc";
  if (base.includes("mpc-hc") || base.includes("mpc-be") || base.includes("mplayerc")) return "mpc";
  return "custom";
}

/**
 * 自动探测本机已安装的各类主流本地视频播放器（支持直接路径、环境变量、开始菜单 .lnk 快捷方式与注册表）
 */
function detectInstalledVideoPlayers(plugin) {
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
  const userProfile = process.env.USERPROFILE || "";

  const playerCandidates = {
    potplayer: [
      "C:/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe",
      "C:/Program Files/DAUM/PotPlayer/PotPlayer64.exe",
      "C:/Program Files/DAUM/PotPlayer/PotPlayerMini.exe",
      "C:/Program Files/DAUM/PotPlayer/PotPlayer.exe",
      "C:/Program Files (x86)/DAUM/PotPlayer/PotPlayerMini.exe",
      "C:/Program Files (x86)/DAUM/PotPlayer/PotPlayerMini64.exe",
      "D:/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe",
      "D:/Program Files (x86)/DAUM/PotPlayer/PotPlayerMini.exe",
      "D:/PotPlayer/PotPlayerMini64.exe",
      "D:/PotPlayer/PotPlayerMini.exe",
      path.join(programData, "Microsoft/Windows/Start Menu/Programs/PotPlayer/PotPlayer 64 bit.lnk"),
      path.join(programData, "Microsoft/Windows/Start Menu/Programs/PotPlayer/PotPlayer.lnk"),
      path.join(appData, "Microsoft/Windows/Start Menu/Programs/PotPlayer/PotPlayer 64 bit.lnk"),
      path.join(appData, "Microsoft/Windows/Start Menu/Programs/PotPlayer/PotPlayer.lnk")
    ],
    dandanplay: [
      path.join(appData, "弹弹play/dandanplay.exe"),
      path.join(localAppData, "弹弹play/dandanplay.exe"),
      path.join(localAppData, "Programs/弹弹play/dandanplay.exe"),
      "C:/Program Files/弹弹play/dandanplay.exe",
      "C:/Program Files (x86)/弹弹play/dandanplay.exe",
      "D:/Program Files/弹弹play/dandanplay.exe",
      "D:/弹弹play/dandanplay.exe",
      "D:/ACG/弹弹play/dandanplay.exe",
      "C:/dandanplay/dandanplay.exe",
      "D:/dandanplay/dandanplay.exe",
      path.join(appData, "Microsoft/Windows/Start Menu/Programs/弹弹play.lnk"),
      path.join(appData, "Microsoft/Windows/Start Menu/Programs/弹弹play/弹弹play.lnk"),
      path.join(programData, "Microsoft/Windows/Start Menu/Programs/弹弹play/弹弹play.lnk"),
      path.join(programData, "Microsoft/Windows/Start Menu/Programs/弹弹play.lnk")
    ],
    mpv: [
      "C:/Program Files/mpv/mpv.exe",
      "D:/Program Files/mpv/mpv.exe",
      "D:/mpv/mpv.exe",
      path.join(localAppData, "Programs/mpv/mpv.exe"),
      path.join(userProfile, "scoop/apps/mpv/current/mpv.exe"),
      "C:/ProgramData/chocolatey/bin/mpv.exe",
      path.join(appData, "Microsoft/Windows/Start Menu/Programs/mpv.lnk")
    ],
    vlc: [
      "C:/Program Files/VideoLAN/VLC/vlc.exe",
      "C:/Program Files (x86)/VideoLAN/VLC/vlc.exe",
      "D:/Program Files/VideoLAN/VLC/vlc.exe",
      path.join(programData, "Microsoft/Windows/Start Menu/Programs/VideoLAN/VLC media player.lnk")
    ],
    mpc: [
      "C:/Program Files/MPC-HC/mpc-hc64.exe",
      "C:/Program Files (x86)/MPC-HC/mpc-hc.exe",
      "C:/Program Files/MPC-BE x64/mpc-be64.exe",
      "C:/Program Files/MPC-BE/mpc-be64.exe",
      "D:/Program Files/MPC-HC/mpc-hc64.exe",
      "D:/Program Files/MPC-BE x64/mpc-be64.exe"
    ]
  };

  const detected = {};
  for (const [kind, list] of Object.entries(playerCandidates)) {
    let foundExe = "";
    let sourceCandidate = "";
    for (const cand of list) {
      const resolved = resolveExecutableOrShortcutPath(cand);
      if (resolved) {
        foundExe = resolved;
        sourceCandidate = cand;
        break;
      }
    }
    detected[kind] = {
      kind,
      installed: Boolean(foundExe),
      exePath: foundExe,
      sourceCandidate
    };
  }

  // 注册表兜底探测 PotPlayer 与 弹弹play
  if (!detected.potplayer.installed && process.platform === "win32") {
    try {
      const regOut = execSync(
        'reg query "HKCU\\Software\\DAUM\\PotPlayer64" /v ProgramPath',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1200 }
      );
      const m = regOut.match(/([A-Za-z]:\\[^\r\n"]+\.exe)/i);
      if (m && m[1] && fs.existsSync(m[1])) {
        detected.potplayer = {
          kind: "potplayer",
          installed: true,
          exePath: path.normalize(m[1]),
          sourceCandidate: "HKCU\\Software\\DAUM\\PotPlayer64"
        };
      }
    } catch (e) {}
  }

  if (!detected.dandanplay.installed && process.platform === "win32") {
    try {
      const regOut = execSync(
        'reg query "HKCU\\Software\\Classes\\dandanplay\\shell\\open\\command" /ve',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1200 }
      );
      const m = regOut.match(/([A-Za-z]:\\[^\r\n"]*dandanplay\.exe)/i);
      if (m && m[1] && fs.existsSync(m[1])) {
        detected.dandanplay = {
          kind: "dandanplay",
          installed: true,
          exePath: path.normalize(m[1]),
          sourceCandidate: "HKCU\\Software\\Classes\\dandanplay"
        };
      }
    } catch (e) {}
  }

  // 解析用户当前配置与自定义路径
  const preferredMode = String(plugin?.settings?.localVideoPlayerMode || "auto").trim() || "auto";
  const customRawPath = String(plugin?.settings?.localVideoPlayerCustomPath || "").trim();
  const resolvedCustomExe = customRawPath ? resolveExecutableOrShortcutPath(customRawPath) : "";

  let activeKind = "system";
  let activeExePath = "";
  let activeLabel = "系统默认播放器";

  if (resolvedCustomExe) {
    const inferred =
      preferredMode !== "auto" && preferredMode !== "system"
        ? preferredMode
        : inferPlayerKindFromExe(resolvedCustomExe);
    activeKind = inferred;
    activeExePath = resolvedCustomExe;
    activeLabel =
      VIDEO_PLAYER_PRESETS[inferred]?.label?.split("（")[0] || path.basename(resolvedCustomExe);
  } else if (preferredMode === "system") {
    activeKind = "system";
    activeExePath = "";
    activeLabel = "系统默认播放器";
  } else if (preferredMode !== "auto" && detected[preferredMode]?.installed) {
    activeKind = preferredMode;
    activeExePath = detected[preferredMode].exePath;
    activeLabel = VIDEO_PLAYER_PRESETS[preferredMode]?.label?.split("（")[0] || preferredMode;
  } else {
    // auto 优先级：PotPlayer (支持精准空降) -> 弹弹play -> MPV -> VLC -> MPC -> 系统默认
    const priorityOrder = ["potplayer", "dandanplay", "mpv", "vlc", "mpc"];
    for (const k of priorityOrder) {
      if (detected[k]?.installed) {
        activeKind = k;
        activeExePath = detected[k].exePath;
        activeLabel = VIDEO_PLAYER_PRESETS[k]?.label?.split("（")[0] || k;
        break;
      }
    }
  }

  return {
    preferredMode,
    customRawPath,
    resolvedCustomExe,
    activeKind,
    activeExePath,
    activeLabel,
    supportsCliSeek: Boolean(VIDEO_PLAYER_PRESETS[activeKind]?.supportsCliSeek && activeExePath),
    detected
  };
}

/**
 * 在动画本地文件夹中查找指定集数对应的视频文件
 */
function findLocalEpisodeVideoFile(item, targetEpisode = null) {
  const rawPath = String(item?.downloadPath || "").trim();
  if (!rawPath || rawPath === "无") {
    return { found: false, reason: "no_download_path", videoFile: null, localResult: null };
  }
  const localResult = noteUtils.inspectLocalFolder(rawPath, item?.watchedEpisodes);
  if (!localResult || localResult.error || !Array.isArray(localResult.videoFiles) || localResult.videoFiles.length === 0) {
    return {
      found: false,
      reason: localResult?.error || "no_video_files",
      videoFile: null,
      localResult
    };
  }

  const epNum = targetEpisode !== null && targetEpisode !== undefined ? Number(targetEpisode) : null;
  if (epNum !== null && Number.isFinite(epNum) && epNum > 0) {
    const exact = localResult.videoFiles.find((vf) => Number(vf.episode) === epNum);
    if (exact) {
      return { found: true, episode: epNum, videoFile: exact.path, fileName: exact.name, localResult };
    }
    // 若文件夹内只有一个视频文件（如剧场版或单集 OVA）且请求 EP01
    if (localResult.videoFiles.length === 1 && epNum === 1) {
      const single = localResult.videoFiles[0];
      return { found: true, episode: 1, videoFile: single.path, fileName: single.name, localResult };
    }
    return {
      found: false,
      reason: "episode_not_found",
      requestedEpisode: epNum,
      videoFile: null,
      localResult
    };
  }

  // 未指定具体集数时，优先返回待看的下一话或第一话
  const fallbackPath = localResult.nextEpisodeFile || localResult.videoFiles[0]?.path;
  const fallbackEp = localResult.nextEpisodeNumber || localResult.videoFiles[0]?.episode || 1;
  return {
    found: Boolean(fallbackPath),
    episode: fallbackEp,
    videoFile: fallbackPath,
    fileName: fallbackPath ? path.basename(fallbackPath) : "",
    localResult
  };
}

/**
 * 调用本地视频播放器打开对应集数并（若带有时间戳）空降到指定画面
 */
async function launchVideoAtEpisodeAndTimestamp(plugin, item, options = {}) {
  const NoticeClass = globalThis.__BangumiManagerNotice;
  const episode = options.episode ?? null;
  const rawTimestamp = String(options.timestamp || "").trim();
  const normTs = noteUtils.normalizeTimestampInput(rawTimestamp);
  const seconds = normTs ? noteUtils.parseTimestampToSeconds(normTs) : null;

  const matchRes = findLocalEpisodeVideoFile(item, episode);
  if (!matchRes.found || !matchRes.videoFile) {
    // 温和降级：复制时间码到剪贴板并给出友善轻提示，绝不报错打扰
    if (normTs && typeof navigator !== "undefined" && navigator.clipboard) {
      const copyPayload = episode ? `EP${String(episode).padStart(2, "0")} ${normTs}` : normTs;
      await navigator.clipboard.writeText(copyPayload).catch(() => {});
    }
    if (NoticeClass) {
      const epText = episode ? `第 ${String(episode).padStart(2, "0")} 话` : "对应剧集";
      if (normTs) {
        new NoticeClass(
          `⏱️ 本地暂未找到《${item?.name || "作品"}》${epText}视频文件，已将时间码 ${normTs} 复制到剪贴板。`,
          4500
        );
      } else {
        new NoticeClass(`📁 本地目录暂未找到《${item?.name || "作品"}》${epText}视频文件。`, 4000);
      }
    }
    return { ok: false, fallbackCopied: Boolean(normTs), matchRes };
  }

  const playerInfo = detectInstalledVideoPlayers(plugin);
  const videoPath = path.normalize(matchRes.videoFile);
  const epLabel = matchRes.episode ? `第 ${String(matchRes.episode).padStart(2, "0")} 话` : "视频";

  // 系统默认播放器或未探测到专用播放器
  if (!playerInfo.activeExePath || playerInfo.activeKind === "system") {
    if (normTs && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(normTs).catch(() => {});
    }
    await noteUtils.openLocalPathSafely(videoPath);
    if (NoticeClass) {
      new NoticeClass(
        normTs
          ? `🎬 已打开《${item?.name}》${epLabel}（时间码 ${normTs} 已复制到剪贴板）。`
          : `🎬 已打开《${item?.name}》${epLabel}。`,
        4500
      );
    }
    return { ok: true, player: "system", videoPath, timestamp: normTs };
  }

  const exePath = playerInfo.activeExePath;
  const kind = playerInfo.activeKind;
  let cliArgs = [videoPath];
  let seekedViaCli = false;

  if (seconds !== null && seconds > 0) {
    const hhmmss = noteUtils.formatSecondsToTimestamp(seconds, true);
    if (kind === "potplayer") {
      cliArgs = [videoPath, `/seek=${hhmmss}`];
      seekedViaCli = true;
    } else if (kind === "mpv") {
      cliArgs = [`--start=${hhmmss}`, videoPath];
      seekedViaCli = true;
    } else if (kind === "vlc") {
      cliArgs = [`--start-time=${Math.floor(seconds)}`, videoPath];
      seekedViaCli = true;
    } else if (kind === "mpc") {
      cliArgs = [videoPath, "/startpos", hhmmss];
      seekedViaCli = true;
    } else {
      // 弹弹play (dandanplay.exe) 或其他自定义播放器：命令行传入视频路径直接拉起对应集数，并自动将时间戳写入剪贴板
      cliArgs = [videoPath];
      seekedViaCli = false;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(normTs).catch(() => {});
      }
    }
  }

  try {
    const child = spawn(exePath, cliArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();

    if (NoticeClass) {
      if (normTs && seekedViaCli) {
        new NoticeClass(
          `🎬 已通过 ${playerInfo.activeLabel} 空降《${item?.name}》${epLabel} [${normTs}]！`,
          4200
        );
      } else if (normTs && !seekedViaCli) {
        new NoticeClass(
          `🎬 已通过 ${playerInfo.activeLabel} 拉起《${item?.name}》${epLabel}！时间码 ${normTs} 已复制到剪贴板，可在播放器内快速定位。`,
          5200
        );
      } else {
        new NoticeClass(
          `🎬 已通过 ${playerInfo.activeLabel} 播放《${item?.name}》${epLabel}。`,
          3800
        );
      }
    }

    roxyMascotService.emitRoxyEvent(plugin, {
      type: "player:seek_launch",
      state: "success",
      category: "画面空降",
      priority: roxyMascotService.PRIORITY.NORMAL,
      dedupeKey: `seek:${item?.name}:${matchRes.episode}:${normTs}`,
      message: normTs
        ? `已经帮您用 ${playerInfo.activeLabel} 打开《${item?.name}》${epLabel}${seekedViaCli ? ` 并直接定位到 ${normTs} 的画面了` : `，时间码 ${normTs} 也帮您备在剪贴板里了`}哦。`
        : `已经帮您用 ${playerInfo.activeLabel} 打开《${item?.name}》${epLabel}了。`
    });

    return {
      ok: true,
      player: kind,
      playerLabel: playerInfo.activeLabel,
      exePath,
      videoPath,
      timestamp: normTs,
      seekedViaCli
    };
  } catch (err) {
    // 异常兜底：降级调用系统默认方式打开
    await noteUtils.openLocalPathSafely(videoPath);
    return { ok: true, player: "system_fallback", videoPath, timestamp: normTs, error: err.message };
  }
}

/**
 * 获取独立的「观片手札图片目录」配置路径（绝不与 coverFolder 混用）
 */
function getReviewImageFolderPath(plugin) {
  const raw = String(plugin?.settings?.reviewImageFolder || "附件/观片手札图片")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return raw || "附件/观片手札图片";
}

/**
 * 将粘贴或拖入的手札图片保存到独立的 reviewImageFolder 目录中，并返回 Vault 相对路径
 */
async function saveReviewImageFileToVault(plugin, item, fileOrBlob, scopeCode = "EP") {
  if (!plugin || !plugin.app || !plugin.app.vault || !fileOrBlob) {
    throw new Error("无效的图片数据");
  }

  const folderPath = getReviewImageFolderPath(plugin);
  await plugin.ensureVaultFolder(folderPath);

  let ext = "png";
  const mime = String(fileOrBlob.type || "").toLowerCase();
  const origName = String(fileOrBlob.name || "").trim();
  if (origName && origName.includes(".")) {
    ext = origName.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  } else if (mime.includes("jpeg") || mime.includes("jpg")) {
    ext = "jpg";
  } else if (mime.includes("webp")) {
    ext = "webp";
  } else if (mime.includes("gif")) {
    ext = "gif";
  }

  const subjToken = item?.subjectId
    ? `bgm${item.subjectId}`
    : String(item?.name || "anime")
        .replace(/[\\/:*?"<>|\s]/g, "_")
        .slice(0, 18);
  const scopeToken = String(scopeCode || "ep")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "ep";
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const fileName = `${subjToken}_${scopeToken}_${Date.now()}_${randSuffix}.${ext}`;
  const vaultRelPath = `${folderPath}/${fileName}`;

  const arrayBuffer = await fileOrBlob.arrayBuffer();
  await plugin.app.vault.createBinary(vaultRelPath, arrayBuffer);

  return {
    path: vaultRelPath,
    fileName,
    resourceUrl: plugin.getCoverResourceUrl(vaultRelPath, item?.file?.path || "")
  };
}

/**
 * 将动画的手札数组持久化保存到对应 .md 笔记，并同步刷新所有打开的 2D/3D 档案馆视图与手札弹窗
 */
async function saveAnimeReviewsToNote(plugin, item, nextReviews, reasonText = "") {
  if (!plugin || !item || !item.file) return false;
  const normalizedList = (Array.isArray(nextReviews) ? nextReviews : []).map((r, i) =>
    noteUtils.normalizeReviewEntry(r, i)
  );

  try {
    const file = item.file;
    const rawContent = await plugin.app.vault.read(file);
    const updatedContent = noteUtils.updateNoteReviewsSection(rawContent, normalizedList);

    if (updatedContent !== rawContent) {
      if (!plugin.isPluginWritingNote) {
        plugin.isPluginWritingNote = new Set();
      }
      plugin.isPluginWritingNote.add(file.path);
      try {
        await plugin.app.vault.modify(file, updatedContent);
      } finally {
        setTimeout(() => {
          if (plugin.isPluginWritingNote) {
            plugin.isPluginWritingNote.delete(file.path);
          }
        }, 1200);
      }
    }

    item.reviews = normalizedList;

    // 同步内存态与打开的二维/三维视图
    await plugin.applyQuickUpdateToOpenDashboards(item, { reviewsUpdated: true });

    if (reasonText) {
      roxyMascotService.emitRoxyEvent(plugin, {
        type: "review:saved",
        state: "success",
        category: "观片手札",
        priority: roxyMascotService.PRIORITY.NORMAL,
        dedupeKey: `review:${item.name}:${normalizedList.length}:${Date.now()}`,
        message: reasonText
      });
    }
    return true;
  } catch (err) {
    console.error("[BangumiReviewStudio] 写入观片手札失败:", err);
    if (globalThis.__BangumiManagerNotice) {
      new globalThis.__BangumiManagerNotice(`保存观片手札失败：${err.message}`);
    }
    return false;
  }
}

/**
 * 格式化单条手札的复制文本：
 * - mode === "plain": 纯正文（方便直接粘贴到弹幕或单集评论框）
 * - mode === "header": 带【第03话 · 14:22 · 吐槽】抬头与标题格式
 */
function formatSingleReviewCopyText(review, mode = "plain", animeName = "") {
  const rev = noteUtils.normalizeReviewEntry(review, 0);
  const bodyText = rev.text || (rev.isPlaceholder ? "（待补完时间点手札）" : "");
  const isPlain =
    mode === "plain" ||
    mode === false ||
    (mode && typeof mode === "object" && mode.includeHeader === false);
  if (isPlain) {
    return bodyText || `${rev.scopeDisplay}${rev.timestamp ? ` ${rev.timestamp}` : ""}`;
  }
  const headParts = [rev.scopeDisplay];
  if (rev.timestamp) headParts.push(rev.timestamp);
  headParts.push(rev.typeLabel);
  const prefix = `【${headParts.join(" · ")}】`;
  const titlePart = rev.title ? `${rev.title}\n` : "";
  return `${prefix}${titlePart}${bodyText}`.trim();
}

/**
 * 汇总格式化整部动画的全部手札（适配 Bangumi 完结吐槽箱 / 社交平台分享）
 */
function formatBatchReviewsCopyText(item, reviews) {
  const list = (Array.isArray(reviews) ? reviews : []).map((r, i) =>
    noteUtils.normalizeReviewEntry(r, i)
  );
  const validList = list.filter((r) => !r.isPlaceholder || r.timestamp);
  if (validList.length === 0) return "";

  const titleStr = typeof item === "string" ? item : item?.name || "动画";
  const headerLines = [`《${titleStr}》观片手札汇总`];
  if (item?.personalScore !== null && item?.personalScore !== undefined) {
    headerLines[0] += `（个人评分：★ ${Number(item.personalScore).toFixed(1)}）`;
  }
  headerLines.push("────────────────────");

  for (const rev of validList) {
    const tagParts = [rev.scopeDisplay];
    if (rev.timestamp) tagParts.push(rev.timestamp);
    tagParts.push(rev.typeLabel);
    const titleSuffix = rev.title ? ` ${rev.title}` : "";
    headerLines.push(`▸ [${tagParts.join(" · ")}]${titleSuffix}`);
    if (rev.text) {
      headerLines.push(rev.text);
    } else if (rev.isPlaceholder) {
      headerLines.push("（时间点书签锚点）");
    }
    headerLines.push("");
  }

  return headerLines.join("\n").trim();
}

/**
 * 打开全屏大图预览 Lightbox
 */
function openReviewImageLightbox(resourceUrl, caption = "") {
  if (!resourceUrl || typeof document === "undefined") return;
  const existing = document.querySelector(".curator-review-lightbox-backdrop");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "curator-review-lightbox-backdrop";

  const box = document.createElement("div");
  box.className = "curator-review-lightbox-box";

  const img = document.createElement("img");
  img.className = "curator-review-lightbox-img";
  img.src = resourceUrl;
  img.alt = caption || "手札配图预览";
  box.appendChild(img);

  if (caption) {
    const cap = document.createElement("div");
    cap.className = "curator-review-lightbox-caption";
    cap.textContent = caption;
    box.appendChild(cap);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "curator-review-lightbox-close";
  closeBtn.textContent = "× 关闭预览";
  closeBtn.onclick = () => backdrop.remove();
  box.appendChild(closeBtn);

  backdrop.appendChild(box);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.appendChild(backdrop);
}

/**
 * 打开「观片手札工作台（Review Studio Modal）」：
 * - 支持看番暂停期极速秒记（自动聚焦、智能识别 1234 -> 12:34、正文前缀时间码提取、一键打时间点空占位）
 * - 支持同集多条吐槽/短评/长评、Ctrl+V 粘贴截图到独立目录、自由指定手札封面图
 * - 支持无图纯文字 / 有封面图文相映 / 时间点占位书签 三态严丝合缝排版（绝无空白缺口）
 * - 支持点击时间戳徽章直接调用 PotPlayer / 弹弹play 空降对应集数画面
 * - 支持单条编辑、删除、拖拽排序 (⋮⋮) 与 ↑/↓ 移位、纯正文复制与带抬头复制、汇总复制及与 .md 笔记实时双向同步
 */
function openAnimeReviewStudioModal(plugin, item, options = {}) {
  const ModalClass = globalThis.__BangumiManagerModal;
  const NoticeClass = globalThis.__BangumiManagerNotice;
  if (!ModalClass || !item) return null;

  class AnimeReviewStudioModal extends ModalClass {
    constructor(app) {
      super(app);
      this.plugin = plugin;
      this.item = item;
      this.onChanged = options.onChanged || options.onUpdated || null;

      // 默认锁定当前观看集数（若已看 0 话则默认 EP01）与「吐槽」体裁
      const curWatched = Math.max(1, Number(item.watchedEpisodes) || 1);
      this.composerType = options.initialType || "quip";
      this.composerScopeMode = options.initialScopeMode || "single"; // "single" | "range" | "all"
      this.composerEpStart = options.initialEpisode || curWatched;
      this.composerEpEnd = Math.min(
        Number(item.totalEpisodes) || this.composerEpStart + 2,
        this.composerEpStart + 2
      );
      this.composerTimestamp = options.initialTimestamp || "";
      this.composerTitle = "";
      this.composerText = "";
      this.composerImages = []; // [{ path, isCover, resourceUrl }]

      this.filterType = "all"; // "all" | "quip" | "short" | "long" | "placeholder"
      this.sortMode = "custom"; // "custom" | "chronological"
      this.editingReviewId = options.autoEditReviewId || null;
    }

    async onOpen() {
      this.modalEl.addClass("curator-review-studio-modal-shell");
      this.modalEl.style.width = "min(920px, 94vw)";
      this.modalEl.style.maxWidth = "94vw";
      this.plugin._activeReviewStudioModal = this;

      await this.reloadReviewsFromNote();
      this.render();
    }

    onClose() {
      if (this.plugin._activeReviewStudioModal === this) {
        this.plugin._activeReviewStudioModal = null;
      }
      this.contentEl.empty();
    }

    async reloadReviewsFromNote() {
      if (this.item?.file) {
        try {
          const content = await this.plugin.app.vault.read(this.item.file);
          this.item.reviews = noteUtils.parseNoteReviewsSection(content);
        } catch (e) {}
      }
      if (!Array.isArray(this.item.reviews)) {
        this.item.reviews = [];
      }
    }

    getCurrentScopeCode() {
      if (this.composerScopeMode === "all") {
        return "全剧";
      }
      if (this.composerScopeMode === "range") {
        let a = Math.max(1, parseInt(this.composerEpStart, 10) || 1);
        let b = Math.max(a, parseInt(this.composerEpEnd, 10) || a);
        return a === b
          ? `EP${String(a).padStart(2, "0")}`
          : `EP${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
      }
      const ep = Math.max(1, parseInt(this.composerEpStart, 10) || 1);
      return `EP${String(ep).padStart(2, "0")}`;
    }

    async handlePasteOrFiles(fileList, targetImagesArray, onAfterAdd) {
      const files = Array.from(fileList || []).filter(
        (f) => f && String(f.type || "").startsWith("image/")
      );
      if (files.length === 0) return false;

      const scopeCode = this.getCurrentScopeCode();
      for (const file of files) {
        try {
          const saved = await saveReviewImageFileToVault(this.plugin, this.item, file, scopeCode);
          const hasCoverAlready = targetImagesArray.some((im) => im.isCover);
          targetImagesArray.push({
            path: saved.path,
            isCover: !hasCoverAlready,
            resourceUrl: saved.resourceUrl
          });
        } catch (err) {
          if (NoticeClass) {
            new NoticeClass(`保存手札截图失败：${err.message}`);
          }
        }
      }
      if (typeof onAfterAdd === "function") {
        onAfterAdd();
      }
      if (NoticeClass) {
        new NoticeClass(
          `🖼️ 已将 ${files.length} 张截图存入独立手札图库（${getReviewImageFolderPath(this.plugin)}）`,
          3200
        );
      }
      return true;
    }

    async submitComposer(forceBookmarkPlaceholder = false) {
      const allowTimestamp = this.composerScopeMode === "single";
      let finalTs = allowTimestamp ? noteUtils.normalizeTimestampInput(this.composerTimestamp) : "";
      let finalBody = String(this.composerText || "").trim();

      // 若在单集模式下时间框未填，自动尝试从正文开头识别时间码（支持仅敲入 "1234"/"451" 或 "451 这段绝了"）
      if (allowTimestamp && !finalTs && finalBody) {
        const extracted = noteUtils.extractLeadingTimestampFromText(finalBody);
        if (extracted.timestamp) {
          finalTs = extracted.timestamp;
          finalBody = extracted.cleanText;
        }
      }

      if (forceBookmarkPlaceholder && !finalTs && this.composerImages.length === 0 && !finalBody) {
        if (NoticeClass) {
          new NoticeClass("⏱️ 打时间点占位锚点时，请至少输入一个时间码（如 1422）或粘贴一张截图。");
        }
        return;
      }

      if (!forceBookmarkPlaceholder && !finalBody && !finalTs && this.composerImages.length === 0) {
        if (NoticeClass) {
          new NoticeClass("请输入吐槽/评价内容，或填入时间码（如 14:22）打下时间点占位锚点。");
        }
        return;
      }

      const scopeCode = this.getCurrentScopeCode();
      const todayStr = new Date().toISOString().slice(0, 10);
      const coverItem = this.composerImages.find((im) => im.isCover) || this.composerImages[0];

      const newEntry = noteUtils.normalizeReviewEntry(
        {
          type: this.composerType,
          scopeCode,
          timestamp: finalTs,
          title: this.composerType === "quip" ? "" : this.composerTitle.trim(),
          date: todayStr,
          text: forceBookmarkPlaceholder ? "" : finalBody,
          images: this.composerImages.map((im) => ({
            path: im.path,
            isCover: coverItem ? im.path === coverItem.path : false,
            noCover: !coverItem
          })),
          coverImage: coverItem ? coverItem.path : ""
        },
        (this.item.reviews || []).length
      );

      const nextReviews = [...(this.item.reviews || []), newEntry];
      const msg = newEntry.isPlaceholder
        ? `已经为您在《${this.item.name}》${newEntry.scopeDisplay}${newEntry.timestamp ? ` [${newEntry.timestamp}]` : ""} 打下了待补完手札锚点，看完这集随时回来补写吧。`
        : `已经帮您把《${this.item.name}》${newEntry.scopeDisplay}的${newEntry.typeLabel}记入动画笔记了。`;

      await saveAnimeReviewsToNote(this.plugin, this.item, nextReviews, msg);

      // 重置输入区但保持当前集数与体裁锁定，方便继续看番暂停秒记
      this.composerTimestamp = "";
      this.composerTitle = "";
      this.composerText = "";
      this.composerImages = [];

      if (typeof this.onChanged === "function") {
        this.onChanged(this.item);
      }
      this.render({ focusComposerText: true });
    }

    render(renderOpts = {}) {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-review-studio");

      const reviews = Array.isArray(this.item.reviews) ? this.item.reviews : [];
      const placeholderCount = reviews.filter((r) => r.isPlaceholder).length;
      const quipCount = reviews.filter((r) => r.type === "quip" && !r.isPlaceholder).length;
      const shortCount = reviews.filter((r) => r.type === "short" && !r.isPlaceholder).length;
      const longCount = reviews.filter((r) => r.type === "long" && !r.isPlaceholder).length;

      const playerInfo = detectInstalledVideoPlayers(this.plugin);
      const localRes =
        this.item.downloadPath && this.item.downloadPath !== "无"
          ? noteUtils.inspectLocalFolder(this.item.downloadPath, this.item.watchedEpisodes)
          : null;

      // ==================== 1. 顶部档案抬头栏 ====================
      const header = contentEl.createDiv("curator-rs-header");
      const headerLeft = header.createDiv("curator-rs-header-left");

      const coverBox = headerLeft.createDiv("curator-rs-cover-box");
      const coverUrl = this.item.file
        ? this.plugin.getCoverResourceUrl(this.item.cover, this.item.file.path)
        : "";
      if (coverUrl) {
        const img = coverBox.createEl("img", { cls: "curator-rs-cover-img" });
        img.src = coverUrl;
        img.alt = this.item.name;
      } else {
        coverBox.setText("🎬");
      }

      const titleCol = headerLeft.createDiv("curator-rs-title-col");
      titleCol.createDiv({
        cls: "curator-rs-kicker",
        text: "观片手札工作台"
      });
      titleCol.createEl("h2", {
        cls: "curator-rs-title",
        text: `《${this.item.name}》`
      });

      const metaSub = titleCol.createDiv("curator-rs-meta-sub");
      metaSub.createSpan({
        cls: `curator-state-pill is-${this.item.state || "未设置"}`,
        text: this.item.state || "未设置"
      });
      metaSub.createSpan({
        cls: "curator-rs-meta-chip curator-mono",
        text: `进度：${Number(this.item.watchedEpisodes) || 0} / ${this.item.totalEpisodes || "?"} 话`
      });
      if (localRes && !localRes.error && localRes.fileCount > 0) {
        metaSub.createSpan({
          cls: "curator-rs-meta-chip is-local-ready",
          text: `📁 本地已备 ${localRes.fileCount} 集 · 空降播放器：${playerInfo.activeLabel}`
        });
      } else {
        metaSub.createSpan({
          cls: "curator-rs-meta-chip",
          text: `空降播放器：${playerInfo.activeLabel}`
        });
      }

      const headerActions = header.createDiv("curator-rs-header-actions");
      const copyAllBtn = headerActions.createEl("button", {
        cls: "curator-dl-btn is-accent",
        text: "📋 汇总复制全部手札"
      });
      copyAllBtn.title = "将当前所有吐槽、短评与长评按集数与体裁排版后一键复制，方便粘贴至 Bangumi 或社交平台";
      copyAllBtn.onclick = async () => {
        const formatted = formatBatchReviewsCopyText(this.item, reviews);
        if (!formatted) {
          if (NoticeClass) new NoticeClass("当前暂无可复制的手札内容。");
          return;
        }
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(formatted).catch(() => {});
        }
        if (NoticeClass) {
          new NoticeClass(`📋 已汇总复制《${this.item.name}》全部 ${reviews.length} 条观片手札！`);
        }
      };

      const openNoteBtn = headerActions.createEl("button", {
        cls: "curator-dl-btn",
        text: "✎ 打开 Markdown 笔记 ↗"
      });
      openNoteBtn.onclick = async () => {
        if (this.item.file) {
          this.close();
          const leaf = this.plugin.app.workspace.getLeaf(true);
          await leaf.openFile(this.item.file);
        }
      };

      // ==================== 2. 看番暂停期“极速秒记”与图文创作台 ====================
      const composer = contentEl.createDiv("curator-rs-composer");

      const compTopBar = composer.createDiv("curator-rs-composer-topbar");

      // 体裁切换（吐槽 / 短评 / 长评）
      const typeGroup = compTopBar.createDiv("curator-rs-seg-group");
      [
        { id: "quip", label: "💬 吐槽", desc: "看番途中的即时反应、单集槽点或名场面感叹（支持回车秒发）" },
        { id: "short", label: "✒️ 短评", desc: "三集定律小结、篇章观感或精炼总评" },
        { id: "long", label: "📜 长评", desc: "深度人物考据、分集长文或完结剧评" }
      ].forEach((t) => {
        const btn = typeGroup.createEl("button", {
          cls: `curator-rs-seg-btn ${this.composerType === t.id ? "is-active" : ""}`,
          text: t.label
        });
        btn.title = t.desc;
        btn.onclick = (e) => {
          e.preventDefault();
          this.composerType = t.id;
          this.render({ focusComposerText: true });
        };
      });

      // 剧集范围选择（单集微步进 / 多集区间 / 全剧总评）
      const scopeGroup = compTopBar.createDiv("curator-rs-scope-bar");
      [
        { id: "single", label: "单集" },
        { id: "range", label: "多集区间" },
        { id: "all", label: "全剧总评" }
      ].forEach((sm) => {
        const sBtn = scopeGroup.createEl("button", {
          cls: `curator-rs-scope-mode-btn ${this.composerScopeMode === sm.id ? "is-active" : ""}`,
          text: sm.label
        });
        sBtn.onclick = (e) => {
          e.preventDefault();
          this.composerScopeMode = sm.id;
          this.render({ focusComposerText: true });
        };
      });

      if (this.composerScopeMode === "single") {
        const epStepper = scopeGroup.createDiv("curator-rs-ep-stepper");
        const decEp = epStepper.createEl("button", { cls: "curator-rs-ep-step-btn", text: "−" });
        const epInput = epStepper.createEl("input", {
          type: "number",
          cls: "curator-rs-ep-input curator-mono",
          value: String(this.composerEpStart)
        });
        epInput.min = "1";
        epInput.title = "绑定集数（如第 3 话）";
        const epUnit = epStepper.createSpan({ cls: "curator-rs-ep-unit", text: "话" });
        const incEp = epStepper.createEl("button", { cls: "curator-rs-ep-step-btn", text: "+" });

        decEp.onclick = (e) => {
          e.preventDefault();
          this.composerEpStart = Math.max(1, (parseInt(this.composerEpStart, 10) || 1) - 1);
          epInput.value = String(this.composerEpStart);
        };
        incEp.onclick = (e) => {
          e.preventDefault();
          this.composerEpStart = (parseInt(this.composerEpStart, 10) || 1) + 1;
          epInput.value = String(this.composerEpStart);
        };
        epInput.oninput = () => {
          this.composerEpStart = Math.max(1, parseInt(epInput.value, 10) || 1);
        };
      } else if (this.composerScopeMode === "range") {
        const rangeBox = scopeGroup.createDiv("curator-rs-range-box");
        rangeBox.createSpan({ text: "EP" });
        const startInp = rangeBox.createEl("input", {
          type: "number",
          cls: "curator-rs-ep-input curator-mono",
          value: String(this.composerEpStart)
        });
        rangeBox.createSpan({ text: "至 EP" });
        const endInp = rangeBox.createEl("input", {
          type: "number",
          cls: "curator-rs-ep-input curator-mono",
          value: String(this.composerEpEnd)
        });
        startInp.oninput = () => {
          this.composerEpStart = Math.max(1, parseInt(startInp.value, 10) || 1);
        };
        endInp.oninput = () => {
          this.composerEpEnd = Math.max(1, parseInt(endInp.value, 10) || 1);
        };
      }

      // 智能时间点输入框（仅在「单集」模式下显示；多集区间与全剧总评不绑定单集时间点）
      if (this.composerScopeMode === "single") {
        const tsWrap = compTopBar.createDiv("curator-rs-ts-wrap");
        tsWrap.createSpan({ cls: "curator-rs-ts-icon", text: "⏱️" });
        const tsInput = tsWrap.createEl("input", {
          type: "text",
          cls: "curator-rs-ts-input curator-mono",
          placeholder: "时间点 如 1422 / 451 / 14:22",
          value: this.composerTimestamp
        });
        tsInput.title = "输入 1422 自动转为 14:22，输入 451 自动转为 04:51；正文留空直接提交即可生成时间点占位锚点";
        tsInput.oninput = () => {
          this.composerTimestamp = tsInput.value;
        };
        tsInput.onblur = () => {
          const norm = noteUtils.normalizeTimestampInput(tsInput.value);
          if (norm) {
            this.composerTimestamp = norm;
            tsInput.value = norm;
          }
        };
        tsInput.onkeydown = async (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const norm = noteUtils.normalizeTimestampInput(tsInput.value);
            if (norm) {
              this.composerTimestamp = norm;
              tsInput.value = norm;
            }
            await this.submitComposer(!this.composerText.trim());
          }
        };
      }

      // 短评 / 长评标题栏（去掉末尾多余的“· 可选”）
      if (this.composerType !== "quip") {
        const titleInput = composer.createEl("input", {
          type: "text",
          cls: "curator-rs-title-input",
          placeholder:
            this.composerType === "long"
              ? "长评标题（例如：在漫长的旅途中学会与过去和解）"
              : "短评小标题（例如：三集定律小记）",
          value: this.composerTitle
        });
        titleInput.oninput = () => {
          this.composerTitle = titleInput.value;
        };
      }

      const enterToSubmit = this.plugin.settings.reviewEnterToSubmit !== false;

      // 主文本输入框（明确说明“单独输入时间点”或“开头输入时间点+空格+正文”的提取规则）
      const textWrap = composer.createDiv("curator-rs-textarea-wrap");
      const textarea = textWrap.createEl("textarea", {
        cls: `curator-rs-textarea is-${this.composerType}`,
        placeholder:
          this.composerScopeMode === "single"
            ? "在此输入内容（时间点识别规则：单独只输入时间点如「1422」「451」可生成待补完占位；或在最开头输入「时间点 + 空格 + 吐槽正文」如「451 这段作画绝了」「14:22 分镜神了」自动提取时间码；支持 Ctrl+V 直接粘贴截图）..."
            : "在此撰写观片感想（支持多段落排版与 Ctrl+V 直接粘贴动画截图）..."
      });
      textarea.value = this.composerText;
      textarea.rows = this.composerType === "long" ? 5 : this.composerType === "short" ? 3 : 2;
      textarea.oninput = () => {
        this.composerText = textarea.value;
      };

      textarea.onkeydown = async (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          await this.submitComposer(false);
          return;
        }
        // 当开启「回车键直发」时，单按 Enter（不按 Shift）直接极速提交（Shift+Enter 换行）
        if (
          this.plugin.settings.reviewEnterToSubmit !== false &&
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.isComposing
        ) {
          e.preventDefault();
          await this.submitComposer(false);
        }
      };

      // 监听粘贴与拖拽图片
      const bindPasteAndDrop = (targetEl) => {
        targetEl.addEventListener("paste", async (e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          const imgFiles = [];
          for (const it of items) {
            if (it.kind === "file" && it.type.startsWith("image/")) {
              const f = it.getAsFile();
              if (f) imgFiles.push(f);
            }
          }
          if (imgFiles.length > 0) {
            e.preventDefault();
            await this.handlePasteOrFiles(imgFiles, this.composerImages, () => {
              this.render({ focusComposerText: true });
            });
          }
        });

        targetEl.addEventListener("dragover", (e) => {
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            composer.classList.add("is-drag-over");
          }
        });
        targetEl.addEventListener("dragleave", () => {
          composer.classList.remove("is-drag-over");
        });
        targetEl.addEventListener("drop", async (e) => {
          composer.classList.remove("is-drag-over");
          if (e.dataTransfer?.files?.length) {
            const hasImg = Array.from(e.dataTransfer.files).some((f) =>
              String(f.type || "").startsWith("image/")
            );
            if (hasImg) {
              e.preventDefault();
              await this.handlePasteOrFiles(e.dataTransfer.files, this.composerImages, () => {
                this.render({ focusComposerText: true });
              });
            }
          }
        });
      };
      bindPasteAndDrop(composer);

      // 已粘贴/待上传的手札配图预览条（支持一键切换哪张图作为「★ 手札封面」）
      if (this.composerImages.length > 0) {
        const stagedStrip = composer.createDiv("curator-rs-staged-images");
        this.composerImages.forEach((im, idx) => {
          const thumbCard = stagedStrip.createDiv(
            `curator-rs-staged-thumb ${im.isCover ? "is-cover" : ""}`
          );
          const resolvedSrc = im.resourceUrl || this.plugin.getCoverResourceUrl(im.path, this.item.file?.path || "");
          const imgEl = thumbCard.createEl("img", {
            attr: { src: resolvedSrc, alt: im.path || "手札配图" }
          });
          imgEl.src = resolvedSrc;
          imgEl.alt = im.path || "手札配图";
          imgEl.onerror = () => {
            imgEl.style.display = "none";
          };
          imgEl.onclick = () => openReviewImageLightbox(imgEl.src, im.path);

          const actionsOverlay = thumbCard.createDiv("curator-rs-staged-actions");
          const coverBtn = actionsOverlay.createEl("button", {
            cls: `curator-rs-cover-toggle ${im.isCover ? "is-active" : ""}`,
            text: im.isCover ? "★ 封面" : "设为封面"
          });
          coverBtn.title = im.isCover
            ? "当前图片已设为该条手札的展示封面（点击可取消封面）"
            : "将此截图指定为该条手札的封面图";
          coverBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (im.isCover) {
              im.isCover = false;
            } else {
              this.composerImages.forEach((other) => {
                other.isCover = false;
              });
              im.isCover = true;
            }
            this.render({ focusComposerText: true });
          };

          const delImgBtn = actionsOverlay.createEl("button", {
            cls: "curator-rs-staged-del",
            text: "×"
          });
          delImgBtn.title = "移除此配图";
          delImgBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasCover = im.isCover;
            this.composerImages.splice(idx, 1);
            if (wasCover && this.composerImages.length > 0) {
              this.composerImages[0].isCover = true;
            }
            this.render({ focusComposerText: true });
          };
        });
      }

      // 创作台底部操作栏
      const compFooter = composer.createDiv("curator-rs-composer-footer");
      const compLeftTools = compFooter.createDiv("curator-rs-composer-tools");

      const fileInput = compLeftTools.createEl("input", {
        type: "file",
        attr: { accept: "image/*", multiple: "multiple" }
      });
      fileInput.style.display = "none";
      fileInput.onchange = async () => {
        if (fileInput.files?.length) {
          await this.handlePasteOrFiles(fileInput.files, this.composerImages, () => {
            this.render({ focusComposerText: true });
          });
        }
      };

      const addImgBtn = compLeftTools.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🖼️ 选择截图"
      });
      addImgBtn.title = `点击选择本地图片文件（也支持直接在输入框内按 Ctrl+V 粘贴剪贴板截图，自动保存至「${getReviewImageFolderPath(this.plugin)}」）`;
      addImgBtn.onclick = (e) => {
        e.preventDefault();
        fileInput.click();
      };

      // 「回车键直发」开关（Checkbox / Toggle，默认开启并持久化记住偏好）
      const enterToggleLabel = compLeftTools.createEl("label", {
        cls: `curator-rs-enter-toggle ${enterToSubmit ? "is-checked" : ""}`
      });
      enterToggleLabel.title =
        "开启时按 Enter 直接提交（Shift+Enter 换行）；关闭时按 Enter 为普通分段换行，通过 Ctrl+Enter 或右侧按钮提交";
      const enterCheckbox = enterToggleLabel.createEl("input", {
        type: "checkbox"
      });
      enterCheckbox.checked = enterToSubmit;
      enterToggleLabel.createSpan({
        cls: "curator-rs-enter-toggle-text",
        text: "回车键直发"
      });

      const hintSpan = compLeftTools.createSpan({
        cls: "curator-rs-composer-hint",
        text: enterToSubmit
          ? "💡 Ctrl+V 直接粘贴截图 · 开头「时间点+空格+正文」自动提取 · Shift+Enter 换行"
          : "💡 Ctrl+V 直接粘贴截图 · 开头「时间点+空格+正文」自动提取 · Enter 换行 · Ctrl+Enter 提交"
      });

      enterCheckbox.onchange = async () => {
        const nextVal = Boolean(enterCheckbox.checked);
        this.plugin.settings.reviewEnterToSubmit = nextVal;
        enterToggleLabel.classList.toggle("is-checked", nextVal);
        hintSpan.textContent = nextVal
          ? "💡 Ctrl+V 直接粘贴截图 · 开头「时间点+空格+正文」自动提取 · Shift+Enter 换行"
          : "💡 Ctrl+V 直接粘贴截图 · 开头「时间点+空格+正文」自动提取 · Enter 换行 · Ctrl+Enter 提交";
        await this.plugin.saveSettings();
      };

      const submitBtn = compFooter.createEl("button", {
        cls: "curator-dl-btn is-primary",
        text: "✦ 记入手札并同步笔记"
      });
      submitBtn.onclick = async (e) => {
        e.preventDefault();
        await this.submitComposer(false);
      };

      // ==================== 3. 手札筛选与排序工具栏 ====================
      const filterBar = contentEl.createDiv("curator-rs-filter-bar");
      const filterPills = filterBar.createDiv("curator-rs-filter-pills");
      const filterDefs = [
        { id: "all", label: `全部手札 (${reviews.length})` },
        { id: "quip", label: `💬 吐槽 (${quipCount})` },
        { id: "short", label: `✒️ 短评 (${shortCount})` },
        { id: "long", label: `📜 长评 (${longCount})` }
      ];
      if (placeholderCount > 0) {
        filterDefs.push({
          id: "placeholder",
          label: `⏱️ 待补完时间点 (${placeholderCount})`,
          isHighlight: true
        });
      }

      filterDefs.forEach((fd) => {
        const pill = filterPills.createEl("button", {
          cls: `curator-rs-filter-pill ${this.filterType === fd.id ? "is-active" : ""} ${
            fd.isHighlight ? "is-placeholder-pill" : ""
          }`,
          text: fd.label
        });
        pill.onclick = () => {
          this.filterType = fd.id;
          this.render();
        };
      });

      const sortRight = filterBar.createDiv("curator-rs-sort-right");
      const sortBtn = sortRight.createEl("button", {
        cls: "curator-dl-mini-btn",
        text:
          this.sortMode === "custom"
            ? "排序：⋮⋮ 自定义顺序（可拖拽调序）"
            : "排序：🎬 按集数与时间点先后"
      });
      sortBtn.onclick = () => {
        this.sortMode = this.sortMode === "custom" ? "chronological" : "custom";
        this.render();
      };

      // ==================== 4. 观片手札气泡卡片列表 ====================
      const listContainer = contentEl.createDiv("curator-rs-list");

      let displayReviews = reviews.map((rev, originalIndex) => ({ rev, originalIndex }));
      if (this.filterType === "placeholder") {
        displayReviews = displayReviews.filter((x) => x.rev.isPlaceholder);
      } else if (this.filterType !== "all") {
        displayReviews = displayReviews.filter(
          (x) => x.rev.type === this.filterType && !x.rev.isPlaceholder
        );
      }

      if (this.sortMode === "chronological") {
        displayReviews.sort((a, b) => {
          const epA = a.rev.scopeType === "all" ? 99999 : a.rev.epStart || 0;
          const epB = b.rev.scopeType === "all" ? 99999 : b.rev.epStart || 0;
          if (epA !== epB) return epA - epB;
          const tsA = a.rev.timestampSeconds ?? 999999;
          const tsB = b.rev.timestampSeconds ?? 999999;
          if (tsA !== tsB) return tsA - tsB;
          return a.originalIndex - b.originalIndex;
        });
      }

      if (displayReviews.length === 0) {
        const emptyBox = listContainer.createDiv("curator-rs-empty");
        emptyBox.createDiv({
          cls: "curator-rs-empty-title",
          text:
            reviews.length === 0
              ? `《${this.item.name}》暂未记录任何吐槽、短评或长评手札`
              : "当前筛选条件下暂无匹配的手札卡片"
        });
        emptyBox.createDiv({
          cls: "curator-rs-empty-sub",
          text: "看番途中可随时在上方输入时间点（如 1422）打下占位书签、粘贴名场面截图，或撰写单集吐槽与全剧长评。"
        });
      } else {
        displayReviews.forEach(({ rev, originalIndex }, visualIdx) => {
          this.renderReviewBubbleCard(listContainer, rev, originalIndex, reviews, visualIdx);
        });
      }

      if (renderOpts.focusComposerText !== false && !this.editingReviewId) {
        setTimeout(() => {
          if (textarea && textarea.isConnected) {
            textarea.focus();
          }
        }, 40);
      }
    }

    renderReviewBubbleCard(parent, rev, indexInAll, allReviews, visualIdx = 0) {
      const hasImages = Array.isArray(rev.images) && rev.images.length > 0;
      const coverPath = rev.coverImage || (hasImages ? rev.images[0].path : "");
      const coverUrl = coverPath
        ? this.plugin.getCoverResourceUrl(coverPath, this.item.file?.path || "")
        : "";

      // 三态严丝合缝自适应布局类名（杜绝任何“无封面空白框”）
      let layoutClass = "is-pure-text";
      if (rev.isPlaceholder) {
        layoutClass = coverUrl ? "is-placeholder-with-capture" : "is-placeholder-bookmark";
      } else if (coverUrl) {
        layoutClass = "is-with-cover";
      }

      const card = parent.createDiv(
        `curator-review-card is-type-${rev.type} ${layoutClass}`
      );
      card.style.setProperty("--card-idx", String(visualIdx));
      card.dataset.reviewIndex = String(indexInAll);
      card.dataset.reviewType = rev.type;
      card.dataset.reviewScope = rev.scopeCode;

      // 拖拽排序绑定
      card.setAttribute("draggable", this.editingReviewId === rev.id ? "false" : "true");
      card.ondragstart = (e) => {
        if (this.editingReviewId) return;
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/review-index", String(indexInAll));
        card.addClass("is-dragging");
      };
      card.ondragend = () => {
        card.removeClass("is-dragging");
        parent.querySelectorAll(".curator-review-card").forEach((el) => {
          el.removeClass("is-drag-over");
        });
      };
      card.ondragover = (e) => {
        if (e.dataTransfer?.types?.includes("text/review-index")) {
          e.preventDefault();
          e.stopPropagation();
          card.addClass("is-drag-over");
        }
      };
      card.ondragleave = () => {
        card.removeClass("is-drag-over");
      };
      card.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.removeClass("is-drag-over");
        const fromStr = e.dataTransfer.getData("text/review-index");
        const fromIdx = parseInt(fromStr, 10);
        const toIdx = indexInAll;
        if (!isNaN(fromIdx) && fromIdx !== toIdx && fromIdx >= 0 && fromIdx < allReviews.length) {
          const next = [...allReviews];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          this.sortMode = "custom";
          await saveAnimeReviewsToNote(
            this.plugin,
            this.item,
            next,
            `已经帮您调整了《${this.item.name}》手札卡片的排列顺序，并同步更新到动画笔记中了。`
          );
          if (typeof this.onChanged === "function") this.onChanged(this.item);
          this.render({ focusComposerText: false });
        }
      };

      // 若当前卡片处于原地编辑态
      if (this.editingReviewId === rev.id) {
        this.renderInlineCardEditor(card, rev, indexInAll, allReviews);
        return;
      }

      // 卡片顶栏：拖拽手柄 + 体裁印章 + 剧集与时间戳空降胶囊 + 标题/日期 + 右侧独立工具栏
      const cardTop = card.createDiv("curator-rc-header");
      const leftBadges = cardTop.createDiv("curator-rc-badges");

      const dragHandle = leftBadges.createSpan({
        cls: "curator-rc-drag-handle",
        text: "⋮⋮"
      });
      dragHandle.title = "按住上下拖拽可调整手札顺序";

      const typeBadge = leftBadges.createSpan({
        cls: `curator-rc-type-badge is-${rev.type}`,
        text: rev.type === "quip" ? "💬 吐槽" : rev.type === "long" ? "📜 长评" : "✒️ 短评"
      });

      // 点击集数/时间戳徽章一键调用本地播放器空降画面！
      const canSeekEpisode = rev.scopeType !== "all" && rev.epStart != null;
      const jumpText = rev.timestamp
        ? `▶ ${rev.scopeDisplay} · ${rev.timestamp}`
        : canSeekEpisode
        ? `▶ ${rev.scopeDisplay}`
        : `📘 ${rev.scopeDisplay}`;

      const scopeJumpBtn = leftBadges.createEl("button", {
        cls: `curator-rc-scope-btn curator-mono ${rev.timestamp ? "has-timestamp" : ""} ${
          canSeekEpisode ? "is-playable" : ""
        }`,
        text: jumpText
      });
      scopeJumpBtn.dataset.reviewAction = "seek-video";
      scopeJumpBtn.title = rev.timestamp
        ? `点击调用本地视频播放器打开《${this.item.name}》${rev.scopeDisplay}并空降到 ${rev.timestamp}`
        : canSeekEpisode
        ? `点击调用本地视频播放器打开《${this.item.name}》${rev.scopeDisplay}`
        : "全剧总评";

      scopeJumpBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (canSeekEpisode || rev.timestamp) {
          await launchVideoAtEpisodeAndTimestamp(this.plugin, this.item, {
            episode: rev.epStart,
            timestamp: rev.timestamp
          });
        }
      };

      if (rev.isPlaceholder) {
        leftBadges.createSpan({
          cls: "curator-rc-placeholder-tag",
          text: "⏱️ 待补完锚点"
        });
      }

      if (rev.title) {
        leftBadges.createSpan({
          cls: "curator-rc-title-inline",
          text: rev.title
        });
      }

      if (rev.date) {
        leftBadges.createSpan({
          cls: "curator-rc-date curator-mono",
          text: rev.date
        });
      }

      // 右侧单条独立操作栏（↑ / ↓ / 纯正文复制 / 带抬头复制 / 编辑 / 删除）
      const rightActions = cardTop.createDiv("curator-rc-actions");

      const moveUpBtn = rightActions.createEl("button", {
        cls: "curator-rc-icon-btn",
        text: "↑"
      });
      moveUpBtn.disabled = indexInAll === 0;
      moveUpBtn.title = "上移此条手札";
      moveUpBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (indexInAll > 0) {
          const next = [...allReviews];
          [next[indexInAll - 1], next[indexInAll]] = [next[indexInAll], next[indexInAll - 1]];
          await saveAnimeReviewsToNote(this.plugin, this.item, next);
          if (typeof this.onChanged === "function") this.onChanged(this.item);
          this.render({ focusComposerText: false });
        }
      };

      const moveDownBtn = rightActions.createEl("button", {
        cls: "curator-rc-icon-btn",
        text: "↓"
      });
      moveDownBtn.disabled = indexInAll === allReviews.length - 1;
      moveDownBtn.title = "下移此条手札";
      moveDownBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (indexInAll < allReviews.length - 1) {
          const next = [...allReviews];
          [next[indexInAll + 1], next[indexInAll]] = [next[indexInAll], next[indexInAll + 1]];
          await saveAnimeReviewsToNote(this.plugin, this.item, next);
          if (typeof this.onChanged === "function") this.onChanged(this.item);
          this.render({ focusComposerText: false });
        }
      };

      // 一体延展式「📋 复制 | ☑ 含抬头」胶囊组件（支持全局同步勾选与波浪涟漪动效）
      const isWithHeader = Boolean(this.plugin.settings.reviewCopyWithHeader);
      const copyCombo = rightActions.createDiv(
        `curator-rc-copy-combo ${isWithHeader ? "is-with-header" : ""}`
      );

      const copyMainBtn = copyCombo.createEl("button", {
        cls: "curator-rc-copy-main-btn",
        text: "📋 复制"
      });
      copyMainBtn.dataset.reviewAction = "copy-review";
      copyMainBtn.title = "点击复制此条手札（根据右侧「含抬头」勾选状态自动决定复制纯正文或带集数时间点抬头格式）";
      copyMainBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const useHeader = Boolean(this.plugin.settings.reviewCopyWithHeader);
        const txt = formatSingleReviewCopyText(rev, useHeader ? "header" : "plain", this.item.name);
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(txt).catch(() => {});
        }
        copyCombo.classList.remove("is-copied-pulse");
        void copyCombo.offsetWidth;
        copyCombo.classList.add("is-copied-pulse");
        if (NoticeClass) {
          new NoticeClass(
            useHeader
              ? `🏷️ 已复制带【${rev.scopeDisplay}${rev.timestamp ? ` · ${rev.timestamp}` : ""} · ${rev.typeLabel}】抬头的手札内容！`
              : "📋 已复制手札纯正文！"
          );
        }
      };

      const copyWingBtn = copyCombo.createEl("button", {
        cls: "curator-rc-copy-wing"
      });
      copyWingBtn.dataset.reviewAction = "toggle-copy-header";
      copyWingBtn.title = `勾选后点击左侧「复制」将附带【${rev.scopeDisplay}${rev.timestamp ? ` · ${rev.timestamp}` : ""} · ${rev.typeLabel}】抬头（一处勾选，全局手札卡片实时同步）`;
      const checkBoxSpan = copyWingBtn.createSpan("curator-rc-copy-wing-check");
      checkBoxSpan.innerHTML = `<svg class="curator-rc-check-svg" viewBox="0 0 14 14" width="11" height="11" fill="none" xmlns="http://www.w3.org/2000/svg"><path class="curator-rc-check-path" d="M2.4 7.2L5.5 10.3L11.6 3.7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      copyWingBtn.createSpan({
        cls: "curator-rc-copy-wing-text",
        text: "含抬头"
      });

      copyWingBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextVal = !Boolean(this.plugin.settings.reviewCopyWithHeader);
        this.plugin.settings.reviewCopyWithHeader = nextVal;
        await this.plugin.saveSettings();

        // 实时波浪同步当前工作台内所有卡片的「含抬头」勾选状态（利用 --card-idx 阶梯延迟）
        this.contentEl.querySelectorAll(".curator-rc-copy-combo").forEach((el) => {
          el.classList.toggle("is-with-header", nextVal);
          el.classList.remove("is-wave-syncing");
          void el.offsetWidth;
          el.classList.add("is-wave-syncing");
        });
      };

      const editBtn = rightActions.createEl("button", {
        cls: "curator-rc-action-btn",
        text: rev.isPlaceholder ? "✎ 补写" : "✎ 编辑"
      });
      editBtn.dataset.reviewAction = "edit";
      editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.editingReviewId = rev.id;
        this.render({ focusComposerText: false });
      };

      const delBtn = rightActions.createEl("button", {
        cls: "curator-rc-action-btn is-danger",
        text: "🗑️"
      });
      delBtn.dataset.reviewAction = "delete";
      delBtn.title = "删除此条手札";
      delBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = allReviews.filter((_, idx) => idx !== indexInAll);
        await saveAnimeReviewsToNote(
          this.plugin,
          this.item,
          next,
          `已从《${this.item.name}》的笔记中移除了那条${rev.typeLabel}手札。`
        );
        if (typeof this.onChanged === "function") this.onChanged(this.item);
        this.render({ focusComposerText: false });
      };

      // ==================== 卡片主体（严格遵循三态无空缺美学） ====================
      if (rev.isPlaceholder) {
        // 形态 1：时间点占位锚点态（待补完）—— 点击即可原地输入补写！
        const placeholderBody = card.createDiv("curator-rc-placeholder-body");
        if (coverUrl) {
          const capBox = placeholderBody.createDiv("curator-rc-capture-thumb");
          const img = capBox.createEl("img", {
            attr: { src: coverUrl, alt: "名场面抓拍" }
          });
          img.src = coverUrl;
          img.alt = "名场面抓拍";
          img.onerror = () => {
            capBox.remove();
          };
          img.onclick = (e) => {
            e.stopPropagation();
            openReviewImageLightbox(coverUrl, `${this.item.name} · ${rev.scopeDisplay} ${rev.timestamp}`);
          };
        }
        const quickFillWrap = placeholderBody.createDiv("curator-rc-quickfill-wrap");
        const quickInput = quickFillWrap.createEl("input", {
          type: "text",
          cls: "curator-rc-quickfill-input",
          placeholder: `⏱️ ${rev.scopeDisplay}${rev.timestamp ? ` · ${rev.timestamp}` : ""} 待记手札 —— 点击此处直接补充刚才的吐槽（回车即存，支持 Ctrl+V 贴图）...`
        });
        const quickSaveBtn = quickFillWrap.createEl("button", {
          cls: "curator-dl-mini-btn is-primary",
          text: "补完保存"
        });

        const commitQuickFill = async () => {
          const val = quickInput.value.trim();
          if (!val) {
            this.editingReviewId = rev.id;
            this.render({ focusComposerText: false });
            return;
          }
          const next = [...allReviews];
          next[indexInAll] = noteUtils.normalizeReviewEntry(
            {
              ...rev,
              text: val,
              isPlaceholder: false
            },
            indexInAll
          );
          await saveAnimeReviewsToNote(
            this.plugin,
            this.item,
            next,
            `已经帮您把《${this.item.name}》${rev.scopeDisplay} ${rev.timestamp} 的时间点占位补完为正式手札了！`
          );
          if (typeof this.onChanged === "function") this.onChanged(this.item);
          this.render({ focusComposerText: false });
        };

        quickInput.onkeydown = async (e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            await commitQuickFill();
          }
        };
        quickInput.addEventListener("paste", async (e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          const imgFiles = [];
          for (const it of items) {
            if (it.kind === "file" && it.type.startsWith("image/")) {
              const f = it.getAsFile();
              if (f) imgFiles.push(f);
            }
          }
          if (imgFiles.length > 0) {
            e.preventDefault();
            const currentImgs = Array.isArray(rev.images) ? [...rev.images] : [];
            await this.handlePasteOrFiles(imgFiles, currentImgs, async () => {
              const next = [...allReviews];
              next[indexInAll] = noteUtils.normalizeReviewEntry(
                {
                  ...rev,
                  images: currentImgs,
                  coverImage: currentImgs.find((im) => im.isCover)?.path || currentImgs[0]?.path || ""
                },
                indexInAll
              );
              await saveAnimeReviewsToNote(this.plugin, this.item, next);
              this.render({ focusComposerText: false });
            });
          }
        });
        quickSaveBtn.onclick = async (e) => {
          e.preventDefault();
          await commitQuickFill();
        };
        return;
      }

      if (coverUrl) {
        // 形态 2：有封面图/配图的手札（图文相映布局，支持点击放大与多图封面一键切换）
        const mediaBody = card.createDiv("curator-rc-illustrated-body");
        const coverFrame = mediaBody.createDiv("curator-rc-cover-frame");
        const heroAlt = rev.title || rev.scopeDisplay || "手札封面";
        const heroImg = coverFrame.createEl("img", {
          cls: "curator-rc-cover-img",
          attr: { src: coverUrl, alt: heroAlt }
        });
        heroImg.src = coverUrl;
        heroImg.alt = heroAlt;
        heroImg.onerror = () => {
          coverFrame.remove();
        };
        heroImg.onclick = () =>
          openReviewImageLightbox(coverUrl, `${this.item.name} · ${rev.scopeDisplay} ${rev.timestamp || ""}`);

        coverFrame.createSpan({
          cls: "curator-rc-cover-badge",
          text: rev.images.length > 1 ? `★ 封面 · 共 ${rev.images.length} 图` : "★ 手札封面"
        });

        const textCol = mediaBody.createDiv("curator-rc-text-col");
        this.renderFormattedReviewParagraphs(textCol, rev);

        // 若包含多张配图，展示微缩胶片条并支持一键点击切换为封面
        if (rev.images.length > 1) {
          const galleryRow = textCol.createDiv("curator-rc-subgallery");
          rev.images.forEach((im) => {
            const subUrl = this.plugin.getCoverResourceUrl(im.path, this.item.file?.path || "");
            const isCurrentCover = im.path === coverPath;
            const subItem = galleryRow.createDiv(
              `curator-rc-subthumb ${isCurrentCover ? "is-active-cover" : ""}`
            );
            const sImg = subItem.createEl("img", {
              attr: { src: subUrl, alt: im.path || "配图" }
            });
            sImg.src = subUrl;
            sImg.alt = im.path || "配图";
            sImg.onerror = () => {
              subItem.remove();
            };
            sImg.onclick = () => openReviewImageLightbox(subUrl, im.path);

            if (!isCurrentCover) {
              const setCoverBtn = subItem.createEl("button", {
                cls: "curator-rc-subthumb-setcover",
                text: "★ 设为封面"
              });
              setCoverBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = [...allReviews];
                const updatedImgs = rev.images.map((x) => ({
                  ...x,
                  isCover: x.path === im.path,
                  noCover: false
                }));
                next[indexInAll] = noteUtils.normalizeReviewEntry(
                  {
                    ...rev,
                    images: updatedImgs,
                    coverImage: im.path
                  },
                  indexInAll
                );
                await saveAnimeReviewsToNote(this.plugin, this.item, next);
                if (typeof this.onChanged === "function") this.onChanged(this.item);
                this.render({ focusComposerText: false });
              };
            }
          });
        }
      } else {
        // 形态 3：无图纯文字手札（完整自洽的纯文本排版，绝无空白占位框）
        const pureBody = card.createDiv("curator-rc-pure-body");
        this.renderFormattedReviewParagraphs(pureBody, rev);
      }
    }

    renderFormattedReviewParagraphs(container, rev) {
      const paragraphs = String(rev.text || "")
        .split(/\r?\n/)
        .map((l) => l.trim());

      const isLongText = rev.type === "long" && rev.text.length > 260;
      const textBox = container.createDiv(
        `curator-rc-text-content ${isLongText && !rev._expanded ? "is-clamped-long" : ""}`
      );

      for (const p of paragraphs) {
        if (!p) continue;
        textBox.createEl("p", { cls: "curator-rc-para", text: p });
      }

      if (isLongText) {
        const expandBtn = container.createEl("button", {
          cls: "curator-rc-expand-btn",
          text: rev._expanded ? "收起长评全文 ▴" : "展开阅读长评全文 ▾"
        });
        expandBtn.onclick = (e) => {
          e.preventDefault();
          rev._expanded = !rev._expanded;
          textBox.classList.toggle("is-clamped-long", !rev._expanded);
          expandBtn.textContent = rev._expanded ? "收起长评全文 ▴" : "展开阅读长评全文 ▾";
        };
      }
    }

    renderInlineCardEditor(card, rev, indexInAll, allReviews) {
      card.addClass("is-editing");
      const editWrap = card.createDiv("curator-rc-editor");

      let editType = rev.type;
      let editScopeCode = rev.scopeCode;
      let editTs = rev.timestamp || "";
      let editTitle = rev.title || "";
      let editText = rev.text || "";
      let editImages = (rev.images || []).map((im) => ({
        path: im.path,
        isCover: rev.coverImage ? im.path === rev.coverImage : Boolean(im.isCover),
        resourceUrl: this.plugin.getCoverResourceUrl(im.path, this.item.file?.path || "")
      }));

      const row1 = editWrap.createDiv("curator-rc-edit-row");
      const typeSelect = row1.createEl("select", { cls: "curator-sort-select" });
      [
        { val: "quip", text: "💬 吐槽" },
        { val: "short", text: "✒️ 短评" },
        { val: "long", text: "📜 长评" }
      ].forEach((o) => {
        const opt = typeSelect.createEl("option", { value: o.val, text: o.text });
        if (o.val === editType) opt.selected = true;
      });
      typeSelect.onchange = () => {
        editType = typeSelect.value;
      };

      const scopeInp = row1.createEl("input", {
        type: "text",
        cls: "curator-rs-ts-input curator-mono",
        value: editScopeCode,
        placeholder: "EP03 / EP01-03 / 全剧"
      });
      scopeInp.style.width = "120px";
      scopeInp.title = "可填单集（如 EP03）、多集区间（如 EP04-06）或 全剧";
      scopeInp.oninput = () => {
        editScopeCode = scopeInp.value.trim() || "全剧";
      };

      const tsInp = row1.createEl("input", {
        type: "text",
        cls: "curator-rs-ts-input curator-mono",
        value: editTs,
        placeholder: "时间点 如 14:22"
      });
      tsInp.style.width = "120px";
      tsInp.onblur = () => {
        const norm = noteUtils.normalizeTimestampInput(tsInp.value);
        if (norm) {
          editTs = norm;
          tsInp.value = norm;
        } else {
          editTs = tsInp.value.trim();
        }
      };

      const titleInp = row1.createEl("input", {
        type: "text",
        cls: "curator-rs-title-input",
        value: editTitle,
        placeholder: "可选小标题"
      });
      titleInp.style.flex = "1";
      titleInp.oninput = () => {
        editTitle = titleInp.value;
      };

      const textArea = editWrap.createEl("textarea", {
        cls: "curator-rs-textarea",
        value: editText,
        placeholder: "在此输入或修改手札内容（支持直接 Ctrl+V 粘贴截图）..."
      });
      textArea.value = editText;
      textArea.rows = editType === "long" ? 6 : 3;
      textArea.oninput = () => {
        editText = textArea.value;
      };

      // 编辑态配图管理区
      const imgsMount = editWrap.createDiv("curator-rs-staged-images");
      const renderEditImages = () => {
        imgsMount.empty();
        if (editImages.length === 0) {
          imgsMount.style.display = "none";
          return;
        }
        imgsMount.style.display = "flex";
        editImages.forEach((im, i) => {
          const thumb = imgsMount.createDiv(`curator-rs-staged-thumb ${im.isCover ? "is-cover" : ""}`);
          const editImgEl = thumb.createEl("img", {
            attr: { src: im.resourceUrl || "", alt: im.path || "配图" }
          });
          editImgEl.src = im.resourceUrl || "";
          editImgEl.alt = im.path || "配图";
          editImgEl.onerror = () => {
            editImgEl.style.display = "none";
          };
          const act = thumb.createDiv("curator-rs-staged-actions");
          const cBtn = act.createEl("button", {
            cls: `curator-rs-cover-toggle ${im.isCover ? "is-active" : ""}`,
            text: im.isCover ? "★ 封面" : "设为封面"
          });
          cBtn.onclick = (e) => {
            e.preventDefault();
            if (im.isCover) {
              im.isCover = false;
            } else {
              editImages.forEach((x) => (x.isCover = false));
              im.isCover = true;
            }
            renderEditImages();
          };
          const dBtn = act.createEl("button", { cls: "curator-rs-staged-del", text: "×" });
          dBtn.onclick = (e) => {
            e.preventDefault();
            editImages.splice(i, 1);
            renderEditImages();
          };
        });
      };
      renderEditImages();

      textArea.addEventListener("paste", async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const imgFiles = [];
        for (const it of items) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) imgFiles.push(f);
          }
        }
        if (imgFiles.length > 0) {
          e.preventDefault();
          await this.handlePasteOrFiles(imgFiles, editImages, () => renderEditImages());
        }
      });

      const foot = editWrap.createDiv("curator-rc-edit-footer");
      const cancelBtn = foot.createEl("button", { cls: "curator-dl-mini-btn", text: "取消" });
      cancelBtn.onclick = () => {
        this.editingReviewId = null;
        this.render({ focusComposerText: false });
      };

      const saveBtn = foot.createEl("button", { cls: "curator-dl-btn is-primary", text: "保存修改" });
      saveBtn.onclick = async () => {
        const normTs = noteUtils.normalizeTimestampInput(tsInp.value);
        const coverObj = editImages.find((x) => x.isCover);
        const updatedEntry = noteUtils.normalizeReviewEntry(
          {
            ...rev,
            type: editType,
            scopeCode: editScopeCode,
            timestamp: normTs,
            title: editTitle.trim(),
            text: editText.trim(),
            images: editImages.map((x) => ({
              path: x.path,
              isCover: coverObj ? x.path === coverObj.path : false,
              noCover: !coverObj
            })),
            coverImage: coverObj ? coverObj.path : ""
          },
          indexInAll
        );

        const next = [...allReviews];
        next[indexInAll] = updatedEntry;
        this.editingReviewId = null;
        await saveAnimeReviewsToNote(
          this.plugin,
          this.item,
          next,
          `已经帮您更新了《${this.item.name}》${updatedEntry.scopeDisplay}的${updatedEntry.typeLabel}手札。`
        );
        if (typeof this.onChanged === "function") this.onChanged(this.item);
        this.render({ focusComposerText: false });
      };

      setTimeout(() => textArea.focus(), 30);
    }
  }

  const modal = new AnimeReviewStudioModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 观片手札工作台、卡片微气泡与 Obsidian 笔记内原生 Callout 强化样式
 */
function getReviewStudioStyles() {
  return [
    /* 1. 案头卡片与画廊/索引中的微手札气泡入口 */
    ".curator-desk-review-strip{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 8px;margin-top:2px;border-radius:6px;background:color-mix(in srgb, #3b6998 7%, var(--background-secondary));border:1px solid color-mix(in srgb, #3b6998 24%, var(--background-modifier-border));font-size:11px;cursor:pointer;transition:all .14s ease;}",
    ".curator-desk-review-strip:hover{border-color:#8f683d;background:color-mix(in srgb, #8f683d 12%, var(--background-secondary));}",
    ".curator-desk-review-strip.is-empty{border-style:dashed;background:transparent;opacity:0.82;}",
    ".curator-desk-review-strip.is-empty:hover{opacity:1;border-style:solid;}",
    ".curator-desk-review-snippet{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-normal);display:flex;align-items:center;gap:5px;}",
    ".curator-desk-review-tag{font-size:10px;font-weight:700;padding:0 5px;border-radius:3px;background:rgba(59,105,152,0.15);color:#2b5d8f;flex-shrink:0;}",
    ".curator-desk-review-tag.is-placeholder{background:rgba(198,116,32,0.18);color:#b35c0e;}",
    ".curator-desk-review-count{font-size:10.5px;font-weight:700;color:#8f683d;flex-shrink:0;}",
    ".curator-gallery-quiet-link.is-review-link{color:#3b6998;font-weight:600;}",
    ".curator-gallery-quiet-link.is-review-link.has-reviews{color:#8f683d;}",

    /* 2. 观片手札工作台弹窗主体 */
    ".curator-review-studio{display:flex;flex-direction:column;gap:12px;color:var(--text-normal);}",
    ".curator-rs-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--background-modifier-border);}",
    ".curator-rs-header-left{display:flex;align-items:center;gap:12px;min-width:0;flex:1;}",
    ".curator-rs-cover-box{width:46px;height:64px;border-radius:6px;overflow:hidden;flex-shrink:0;border:1px solid var(--background-modifier-border);background:var(--background-secondary);display:flex;align-items:center;justify-content:center;}",
    ".curator-rs-cover-img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-rs-title-col{display:flex;flex-direction:column;gap:3px;min-width:0;}",
    ".curator-rs-kicker{font-size:9.5px;font-weight:700;letter-spacing:0.12em;color:#8f683d;text-transform:uppercase;}",
    ".curator-rs-title{margin:0;font-size:1.15em;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".curator-rs-meta-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);}",
    ".curator-rs-meta-chip{padding:1px 7px;border-radius:4px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);}",
    ".curator-rs-meta-chip.is-local-ready{background:rgba(58,125,92,0.12);border-color:rgba(58,125,92,0.32);color:#2c6b49;font-weight:600;}",
    ".curator-rs-header-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",

    /* 3. 看番暂停期极速秒记创作台 */
    ".curator-rs-composer{display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:10px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 72%, #f7f0e4 28%);transition:border-color .15s ease,box-shadow .15s ease;}",
    ".curator-rs-composer.is-drag-over{border:2px dashed #8f683d;box-shadow:0 0 0 4px rgba(143,104,61,0.15);}",
    ".curator-rs-composer-topbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-rs-seg-group,.curator-rs-scope-bar{display:inline-flex;align-items:center;gap:3px;padding:2px;border-radius:7px;background:var(--background-primary);border:1px solid var(--background-modifier-border);flex-wrap:wrap;}",
    ".curator-rs-seg-btn,.curator-rs-scope-mode-btn{cursor:pointer;padding:3px 9px;font-size:11.5px;font-weight:600;border-radius:5px;border:none;background:transparent;color:var(--text-muted);transition:all .12s ease;}",
    ".curator-rs-seg-btn.is-active,.curator-rs-scope-mode-btn.is-active{background:#8f683d;color:#fffdf9;}",
    ".curator-rs-ep-stepper,.curator-rs-range-box{display:inline-flex;align-items:center;gap:3px;padding:0 4px;font-size:11.5px;font-weight:600;}",
    ".curator-rs-ep-step-btn{cursor:pointer;width:20px;height:20px;padding:0;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);display:inline-flex;align-items:center;justify-content:center;font-weight:700;}",
    ".curator-rs-ep-step-btn:hover{border-color:#8f683d;background:#8f683d;color:#fff;}",
    ".curator-rs-ep-input{width:44px !important;height:22px !important;padding:0 4px !important;text-align:center;font-size:12px !important;font-weight:700;border-radius:4px !important;border:1px solid var(--background-modifier-border) !important;}",
    ".curator-rs-ts-wrap{display:inline-flex;align-items:center;gap:5px;margin-left:auto;flex-wrap:wrap;}",
    ".curator-rs-ts-icon{font-size:12px;}",
    ".curator-rs-ts-input{width:168px !important;height:26px !important;padding:2px 8px !important;font-size:11.5px !important;border-radius:6px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-primary) !important;}",
    ".curator-rs-bookmark-btn{cursor:pointer;height:26px;padding:0 9px;font-size:11px;font-weight:600;border-radius:6px;border:1px dashed rgba(198,116,32,0.65);background:rgba(198,116,32,0.1);color:#b35c0e;transition:all .14s ease;}",
    ".curator-rs-bookmark-btn:hover{background:#b35c0e;color:#fffdf9;border-style:solid;}",
    ".curator-rs-title-input{width:100%;padding:5px 10px !important;font-size:12px !important;border-radius:6px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-primary) !important;}",
    ".curator-rs-textarea{width:100%;padding:8px 10px !important;font-size:12.5px !important;line-height:1.5 !important;border-radius:7px !important;border:1px solid var(--background-modifier-border) !important;background:var(--background-primary) !important;resize:vertical;}",
    ".curator-rs-textarea:focus{border-color:#8f683d !important;box-shadow:0 0 0 2px rgba(143,104,61,0.16) !important;}",
    ".curator-rs-staged-images{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0;}",
    ".curator-rs-staged-thumb{position:relative;width:116px;height:66px;border-radius:6px;overflow:hidden;border:1.5px solid var(--background-modifier-border);background:#1a1a1a;}",
    ".curator-rs-staged-thumb.is-cover{border:2px solid #c6933b;box-shadow:0 2px 8px rgba(198,147,59,0.28);}",
    ".curator-rs-staged-thumb img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;}",
    ".curator-rs-staged-actions{position:absolute;inset:auto 0 0 0;display:flex;align-items:center;justify-content:space-between;padding:2px 4px;background:linear-gradient(transparent,rgba(15,12,10,0.86));}",
    ".curator-rs-cover-toggle{cursor:pointer;padding:1px 5px;font-size:9.5px;font-weight:700;border-radius:3px;border:none;background:rgba(255,255,255,0.2);color:#fff;}",
    ".curator-rs-cover-toggle.is-active{background:#c6933b;color:#fffdf9;}",
    ".curator-rs-staged-del{cursor:pointer;width:16px;height:16px;padding:0;border-radius:50%;border:none;background:rgba(220,53,69,0.85);color:#fff;font-size:11px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}",
    ".curator-rs-composer-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
    ".curator-rs-composer-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".curator-rs-composer-hint{font-size:11px;color:var(--text-muted);}",

    /* 4. 筛选栏与三态手札气泡流 */
    ".curator-rs-filter-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
    ".curator-rs-filter-pills{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
    ".curator-rs-filter-pill{cursor:pointer;padding:3px 10px;font-size:11.5px;border-radius:999px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-muted);transition:all .14s ease;}",
    ".curator-rs-filter-pill.is-active{background:#8f683d;border-color:#8f683d;color:#fffdf9;font-weight:600;}",
    ".curator-rs-filter-pill.is-placeholder-pill{border-color:rgba(198,116,32,0.55);color:#b35c0e;background:rgba(198,116,32,0.08);}",
    ".curator-rs-filter-pill.is-placeholder-pill.is-active{background:#b35c0e;border-color:#b35c0e;color:#fffdf9;}",
    ".curator-rs-list{display:flex;flex-direction:column;gap:9px;max-height:48vh;overflow-y:auto;padding-right:4px;}",
    ".curator-review-card{display:flex;flex-direction:column;gap:7px;padding:10px 12px;border-radius:9px;border:1px solid color-mix(in srgb, #9e784b 24%, var(--background-modifier-border));background:var(--background-primary);transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease;}",
    ".curator-review-card:hover{border-color:rgba(143,104,61,0.52);box-shadow:0 4px 12px rgba(42,32,22,0.07);}",
    ".curator-review-card.is-type-quip{border-left:3.5px solid #3b6998;}",
    ".curator-review-card.is-type-short{border-left:3.5px solid #8f683d;}",
    ".curator-review-card.is-type-long{border-left:3.5px solid #9e4238;background:color-mix(in srgb, var(--background-primary) 94%, #f7efe2 6%);}",
    ".curator-review-card.is-placeholder-bookmark,.curator-review-card.is-placeholder-with-capture{border:1.5px dashed rgba(198,116,32,0.58);border-left:3.5px solid #d4822a;background:color-mix(in srgb, #d4822a 5%, var(--background-primary));}",
    ".curator-review-card.is-dragging{opacity:0.45;}",
    ".curator-review-card.is-drag-over{border-color:#8f683d;box-shadow:0 0 0 2px rgba(143,104,61,0.28);}",
    ".curator-rc-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}",
    ".curator-rc-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}",
    ".curator-rc-drag-handle{cursor:grab;color:var(--text-faint);font-weight:700;padding:0 3px;user-select:none;}",
    ".curator-rc-type-badge{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:4px;}",
    ".curator-rc-type-badge.is-quip{background:rgba(59,105,152,0.14);color:#2b5d8f;}",
    ".curator-rc-type-badge.is-short{background:rgba(143,104,61,0.15);color:#8f683d;}",
    ".curator-rc-type-badge.is-long{background:rgba(158,66,56,0.15);color:#9e4238;}",
    ".curator-rc-scope-btn{cursor:pointer;padding:1px 8px;font-size:11px;font-weight:700;border-radius:5px;border:1px solid rgba(59,105,152,0.34);background:rgba(59,105,152,0.09);color:#2b5d8f;transition:all .14s ease;}",
    ".curator-rc-scope-btn.has-timestamp{background:rgba(43,114,185,0.15);border-color:rgba(43,114,185,0.45);color:#1f5d9c;}",
    ".curator-rc-scope-btn.is-playable:hover{background:#2b72b9;border-color:#2b72b9;color:#fffdf9;transform:translateY(-1px);}",
    ".curator-rc-placeholder-tag{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(212,130,42,0.18);color:#b35c0e;}",
    ".curator-rc-title-inline{font-size:12.5px;font-weight:700;color:var(--text-normal);}",
    ".curator-rc-date{font-size:10.5px;color:var(--text-faint);}",
    ".curator-rc-actions{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-rc-icon-btn,.curator-rc-action-btn{cursor:pointer;padding:1px 6px;font-size:10.5px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);transition:all .12s ease;}",
    ".curator-rc-icon-btn:hover,.curator-rc-action-btn:hover{border-color:#8f683d;color:#8f683d;}",
    ".curator-rc-action-btn.is-sub{border-style:dashed;}",
    ".curator-rc-action-btn.is-danger:hover{border-color:#eb5757;color:#eb5757;}",
    /* 一体延展式「复制 + 含抬头」胶囊组件 & 全局阶梯波浪同步动效 */
    ".curator-rc-copy-combo{display:inline-flex;align-items:stretch;border-radius:6px;border:1px solid color-mix(in srgb, #8f683d 34%, var(--background-modifier-border));background:var(--background-secondary);overflow:hidden;transition:border-color 180ms ease, box-shadow 220ms ease, transform 200ms cubic-bezier(0.34,1.56,0.64,1);}",
    ".curator-rc-copy-combo:hover{border-color:#8f683d;}",
    ".curator-rc-copy-combo.is-with-header{border-color:rgba(143,104,61,0.68);box-shadow:0 1px 6px rgba(143,104,61,0.16);}",
    ".curator-rc-copy-combo.is-wave-syncing{animation:curatorCopyComboWaveSync 320ms cubic-bezier(0.34,1.56,0.64,1) calc(var(--card-idx, 0) * 30ms) both;}",
    ".curator-rc-copy-combo.is-copied-pulse{border-color:#3a7d5c;box-shadow:0 0 0 2px rgba(58,125,92,0.22);}",
    "@keyframes curatorCopyComboWaveSync{0%{transform:scale(1);}45%{transform:scale(1.06);box-shadow:0 0 10px rgba(198,147,59,0.38);}100%{transform:scale(1);}}",
    ".curator-rc-copy-main-btn{cursor:pointer;display:inline-flex;align-items:center;gap:3px;padding:1.5px 7px;font-size:10.5px;font-weight:600;border:none;background:transparent;color:var(--text-normal);transition:background-color 140ms ease, color 140ms ease;}",
    ".curator-rc-copy-main-btn:hover{background:color-mix(in srgb, #8f683d 14%, var(--background-primary));color:#8f683d;}",
    ".curator-rc-copy-wing{cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:1.5px 7px 1.5px 6px;font-size:10px;font-weight:600;border:none;border-left:1px solid color-mix(in srgb, #8f683d 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 75%, transparent);color:var(--text-muted);transition:background-color 180ms ease, color 180ms ease;transition-delay:calc(var(--card-idx, 0) * 30ms);}",
    ".curator-rc-copy-wing:hover{color:var(--text-normal);background:color-mix(in srgb, #8f683d 10%, var(--background-primary));}",
    ".curator-rc-copy-combo.is-with-header .curator-rc-copy-wing{background:color-mix(in srgb, #8f683d 16%, var(--background-primary));color:#7a5429;}",
    ".curator-rc-copy-wing-check{width:12px;height:12px;border-radius:3px;border:1px solid color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:var(--background-primary);display:inline-flex;align-items:center;justify-content:center;transition:background-color 180ms ease, border-color 180ms ease, transform 200ms cubic-bezier(0.34,1.56,0.64,1);transition-delay:calc(var(--card-idx, 0) * 30ms);}",
    ".curator-rc-copy-combo.is-with-header .curator-rc-copy-wing-check{background:#8f683d;border-color:#8f683d;transform:scale(1.05);}",
    ".curator-rc-check-svg{width:9px;height:9px;display:block;color:#fffdf9;}",
    ".curator-rc-check-path{stroke-dasharray:18;stroke-dashoffset:18;transition:stroke-dashoffset 200ms cubic-bezier(0.22,1,0.36,1);transition-delay:calc(var(--card-idx, 0) * 30ms);}",
    ".curator-rc-copy-combo.is-with-header .curator-rc-check-path{stroke-dashoffset:0;}",

    /* 三态自适应内容体（1. 占位锚点态 / 2. 有封面图文相映态 / 3. 无图纯文字态） */
    ".curator-rc-placeholder-body{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".curator-rc-capture-thumb{width:128px;height:72px;border-radius:6px;overflow:hidden;border:1px solid rgba(198,116,32,0.45);flex-shrink:0;cursor:zoom-in;}",
    ".curator-rc-capture-thumb img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-rc-quickfill-wrap{display:flex;align-items:center;gap:6px;flex:1 1 260px;}",
    ".curator-rc-quickfill-input{flex:1;padding:5px 10px !important;font-size:12px !important;border-radius:6px !important;border:1px dashed rgba(198,116,32,0.55) !important;background:var(--background-primary) !important;}",
    ".curator-rc-quickfill-input:focus{border-style:solid !important;border-color:#b35c0e !important;}",
    ".curator-rc-illustrated-body{display:flex;align-items:flex-start;gap:12px;}",
    ".curator-rc-cover-frame{position:relative;flex:0 0 168px;width:168px;aspect-ratio:16/9;border-radius:7px;overflow:hidden;border:1px solid color-mix(in srgb, #8f683d 35%, var(--background-modifier-border));background:#181512;cursor:zoom-in;box-shadow:0 3px 10px rgba(24,18,12,0.12);}",
    ".curator-rc-cover-img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease;}",
    ".curator-rc-cover-frame:hover .curator-rc-cover-img{transform:scale(1.04);}",
    ".curator-rc-cover-badge{position:absolute;bottom:4px;right:4px;padding:1px 6px;font-size:9.5px;font-weight:700;border-radius:3px;background:rgba(24,18,12,0.82);color:#f7e6c4;pointer-events:none;}",
    ".curator-rc-text-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}",
    ".curator-rc-pure-body{padding:2px 2px 0;}",
    ".curator-rc-text-content{display:flex;flex-direction:column;gap:5px;font-size:12.8px;line-height:1.58;color:var(--text-normal);word-break:break-word;}",
    ".curator-rc-text-content.is-clamped-long{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}",
    ".curator-rc-para{margin:0;}",
    ".curator-rc-expand-btn{align-self:flex-start;cursor:pointer;padding:2px 8px;font-size:11px;font-weight:600;border:none;background:transparent;color:#8f683d;}",
    ".curator-rc-subgallery{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}",
    ".curator-rc-subthumb{position:relative;width:76px;height:44px;border-radius:4px;overflow:hidden;border:1px solid var(--background-modifier-border);cursor:zoom-in;}",
    ".curator-rc-subthumb.is-active-cover{border:1.5px solid #c6933b;}",
    ".curator-rc-subthumb img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".curator-rc-subthumb-setcover{position:absolute;inset:auto 0 0 0;cursor:pointer;padding:1px 2px;font-size:8.5px;border:none;background:rgba(18,14,10,0.82);color:#f7e6c4;opacity:0;transition:opacity .12s ease;}",
    ".curator-rc-subthumb:hover .curator-rc-subthumb-setcover{opacity:1;}",
    ".curator-rc-editor{display:flex;flex-direction:column;gap:8px;}",
    ".curator-rc-edit-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".curator-rc-edit-footer{display:flex;justify-content:flex-end;gap:6px;}",
    ".curator-rs-empty{padding:24px 16px;text-align:center;border-radius:8px;border:1px dashed var(--background-modifier-border);background:var(--background-primary);}",
    ".curator-rs-empty-title{font-size:13px;font-weight:700;margin-bottom:4px;}",
    ".curator-rs-empty-sub{font-size:11.5px;color:var(--text-muted);}",

    /* 5. 全屏图片预览 Lightbox */
    ".curator-review-lightbox-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(14,12,10,0.85);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);}",
    ".curator-review-lightbox-box{position:relative;max-width:90vw;max-height:88vh;display:flex;flex-direction:column;align-items:center;gap:10px;}",
    ".curator-review-lightbox-img{max-width:88vw;max-height:80vh;object-fit:contain;border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.18);}",
    ".curator-review-lightbox-caption{color:#f5ede0;font-size:12.5px;font-weight:600;}",
    ".curator-review-lightbox-close{cursor:pointer;padding:5px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.3);background:rgba(30,24,18,0.85);color:#fff;font-size:12px;font-weight:600;}",
    ".curator-rs-enter-toggle{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));background:var(--background-primary);color:var(--text-muted);font-size:11.5px;font-weight:600;cursor:pointer;user-select:none;transition:all .14s ease;}",
    ".curator-rs-enter-toggle:hover{border-color:#8f683d;color:var(--text-normal);}",
    ".curator-rs-enter-toggle.is-checked{border-color:rgba(143,104,61,0.55);background:color-mix(in srgb, #8f683d 12%, var(--background-primary));color:#7a552c;}",
    ".curator-rs-enter-toggle input[type=checkbox]{margin:0;width:13px;height:13px;accent-color:#8f683d;cursor:pointer;}",

    /* 6. 双轨主工作台（案头追番席 ⇄ 馆藏编目总览）切换器与平滑过渡动画 */
    ".curator-unified-workspace{margin-bottom:20px;border-radius:12px;border:1px solid color-mix(in srgb, #9e784b 28%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-secondary) 64%, #f7f2e9 36%);padding:12px 16px 16px;box-shadow:0 4px 16px rgba(42,32,22,0.04);}",
    ".curator-workspace-mode-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:10px;margin-bottom:12px;border-bottom:1px solid color-mix(in srgb, #9e784b 22%, var(--background-modifier-border));}",
    ".curator-workspace-switcher{position:relative;display:inline-flex;align-items:center;padding:3px;border-radius:9px;background:color-mix(in srgb, var(--background-primary) 92%, #efe6d5 8%);border:1px solid color-mix(in srgb, #8f683d 32%, var(--background-modifier-border));gap:4px;}",
    ".curator-workspace-mode-tab{position:relative;z-index:1;cursor:pointer;display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:7px;border:none;background:transparent;color:var(--text-muted);font-size:13px;font-weight:650;transition:color .2s ease,background-color .2s ease,transform .16s ease;}",
    ".curator-workspace-mode-tab:hover{color:var(--text-normal);}",
    ".curator-workspace-mode-tab.is-active{background:linear-gradient(135deg,#8f683d,#ab7e4b);color:#fffdf9;box-shadow:0 2px 8px rgba(143,104,61,0.26);}",
    ".curator-workspace-mode-count{font-size:11px;padding:1px 6px;border-radius:999px;background:rgba(143,104,61,0.14);color:#8f683d;font-weight:700;}",
    ".curator-workspace-mode-tab.is-active .curator-workspace-mode-count{background:rgba(255,255,255,0.22);color:#fffdf9;}",
    ".curator-workspace-context-ribbon{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;}",
    ".curator-workspace-quick-jump{cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px dashed color-mix(in srgb, #8f683d 48%, var(--background-modifier-border));background:color-mix(in srgb, var(--background-primary) 86%, #f6efe3 14%);color:#8f683d;font-size:11.5px;font-weight:600;transition:all .15s ease;}",
    ".curator-workspace-quick-jump:hover{border-style:solid;background:#8f683d;color:#fffdf9;}",
    ".curator-workspace-stage{position:relative;transition:height 260ms cubic-bezier(0.22, 1, 0.36, 1);}",
    ".curator-workspace-stage.is-animating-desk{animation:curatorWorkspaceSlideDesk 260ms cubic-bezier(0.22, 1, 0.36, 1);}",
    ".curator-workspace-stage.is-animating-catalog{animation:curatorWorkspaceSlideCatalog 260ms cubic-bezier(0.22, 1, 0.36, 1);}",
    "@keyframes curatorWorkspaceSlideDesk{0%{opacity:0.35;transform:translate3d(-12px,0,0);}100%{opacity:1;transform:translate3d(0,0,0);}}",
    "@keyframes curatorWorkspaceSlideCatalog{0%{opacity:0.35;transform:translate3d(12px,0,0);}100%{opacity:1;transform:translate3d(0,0,0);}}",
    ".curator-unified-workspace .curator-mount-active-desk{margin-bottom:0;padding:0;border:none;background:transparent;}",
    ".curator-unified-workspace .curator-mount-catalog{margin-bottom:0;}",

    /* 7.三维档案室随附纸页中的手札气泡卡片 */
    ".atelier-review-bubbles-list{display:flex;flex-direction:column;gap:8px;margin-top:8px;}",
    ".atelier-review-bubble{padding:8px 10px;border-radius:7px;border:1px solid rgba(143,104,61,0.3);border-left:3px solid #3b6998;background:rgba(255,252,245,0.75);display:flex;flex-direction:column;gap:4px;}",
    ".atelier-review-bubble.is-short{border-left-color:#8f683d;}",
    ".atelier-review-bubble.is-long{border-left-color:#9e4238;}",
    ".atelier-review-bubble.is-placeholder{border-style:dashed;border-left-color:#d4822a;}",
    ".atelier-review-bubble-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;font-size:11px;font-weight:700;color:#5a432b;}",
    ".atelier-review-bubble-text{font-size:12px;line-height:1.5;color:#2c2218;white-space:pre-wrap;}"
  ].join("\n");
}

module.exports = {
  VIDEO_PLAYER_PRESETS,
  expandWindowsEnvVars,
  resolveExecutableOrShortcutPath,
  detectInstalledVideoPlayers,
  findLocalEpisodeVideoFile,
  launchVideoAtEpisodeAndTimestamp,
  getReviewImageFolderPath,
  saveReviewImageFileToVault,
  saveAnimeReviewsToNote,
  formatSingleReviewCopyText,
  formatBatchReviewsCopyText,
  openReviewImageLightbox,
  openAnimeReviewStudioModal,
  getReviewStudioStyles
};
