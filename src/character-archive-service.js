const { requestUrl, Notice, Modal } = require("obsidian");
const noteManager = require("./note-manager.js");
const roxyMascotService = require("./roxy-mascot-service.js");

const BGM_USER_AGENT = "BangumiManagerObsidianPlugin/1.3 (https://github.com/bangumi-manager)";

/**
 * 带有快速超时保护的 requestUrl 封装，避免外部站点网络阻塞导致角色搜索或收录界面长时间挂起
 */
async function requestUrlWithTimeout(options, timeoutMs = 2400) {
  let timer = null;
  try {
    return await Promise.race([
      requestUrl(options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 内置高频角色与《无职转生》角色履历索引（当 Bangumi 搜索接口网络超时或受限时提供无缝兜底）
 */
const BUILTIN_CHARACTER_CANDIDATES = [
  {
    id: "21021",
    name: "洛琪希·米格路迪亚",
    nameJp: "ロキシー・ミグルディア",
    gender: "女",
    birthday: "498年",
    cv: "小原好美",
    hairColor: "蓝发",
    eyeColor: "蓝瞳",
    appearances: ["无职转生 ～到了异世界就拿出真本事～", "无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: ["魔族", "魔法师", "萝莉", "合法萝莉", "蓝发", "蓝瞳", "三股辫", "呆毛", "帽娘", "教师", "师傅", "天然呆", "温柔", "勤勉"],
    avatar: "https://lain.bgm.tv/pic/crt/l/38/64/21021_crt_34224.jpg",
    infoTip: "性别：女 · 生日：498年 · CV：小原好美",
    summary: "米格路德族的水圣级魔术师。外表看似年幼少女，实则为人认真务实、礼貌温柔，是鲁迪乌斯的启蒙魔术恩师。"
  },
  {
    id: "21021",
    name: "洛琪希·米格路迪亚·格雷拉特",
    nameJp: "ロキシー・ミグルディア・グレイラット",
    gender: "女",
    birthday: "498年",
    cv: "小原好美",
    hairColor: "蓝发",
    eyeColor: "蓝瞳",
    appearances: ["无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: ["魔族", "魔法师", "水王级魔术师", "人妻", "蓝发", "蓝瞳", "三股辫", "帽娘", "教师", "师傅"],
    avatar: "https://lain.bgm.tv/pic/crt/l/38/64/21021_crt_34224.jpg",
    infoTip: "性别：女 · 称号：水王级魔术师 · CV：小原好美",
    summary: "迷宫篇后与鲁迪乌斯成婚的全名形态，拉诺亚魔法大学教头。"
  },
  {
    id: "88440",
    name: "希露菲叶特",
    nameJp: "シルフィエット",
    gender: "女",
    birthday: "499年",
    cv: "茅野爱衣",
    hairColor: "白发",
    eyeColor: "绿瞳",
    appearances: ["无职转生 ～到了异世界就拿出真本事～", "无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: ["精灵", "长耳", "青梅竹马", "白发", "绿瞳", "无咏唱魔术", "温柔", "人妻"],
    avatar: "",
    infoTip: "性别：女 · CV：茅野爱衣 · 代表作：《无职转生》",
    summary: "鲁迪乌斯在布耶纳村的青梅竹马，拥有精灵血统，擅长无咏唱治愈与风魔术。"
  },
  {
    id: "88441",
    name: "艾莉丝·伯雷亚斯·格雷拉特",
    nameJp: "エリス・ボレアス・グレイラット",
    gender: "女",
    birthday: "496年",
    cv: "加隈亚衣",
    hairColor: "红发",
    eyeColor: "红瞳",
    appearances: ["无职转生 ～到了异世界就拿出真本事～"],
    moePoints: ["大小姐", "傲娇", "红发", "剑士", "剑王", "元气"],
    avatar: "",
    infoTip: "性别：女 · CV：加隈亚衣 · 代表作：《无职转生》",
    summary: "阿斯拉王国上级贵族伯雷亚斯家的大小姐，剑神流剑王级剑士。"
  },
  {
    id: "78993",
    name: "芙莉莲",
    nameJp: "フリーレン",
    gender: "女",
    birthday: "",
    cv: "种崎敦美",
    hairColor: "白发",
    eyeColor: "绿瞳",
    appearances: ["葬送的芙莉莲"],
    moePoints: ["精灵", "长耳", "魔法使", "双马尾", "白发", "绿瞳", "反差萌", "收集癖", "赖床"],
    avatar: "",
    infoTip: "性别：女 · CV：种崎敦美 · 代表作：《葬送的芙莉莲》",
    summary: "曾与勇者辛美尔一行讨伐魔王的精灵魔法使，爱好收集各种稀奇古怪的民间魔法。"
  }
];

/**
 * 清理 HTML 实体与多余空白
 */
function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * 移除参考角标及脚本样式
 */
function stripReferenceAndNoiseHtml(html) {
  return String(html || "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/**
 * 将 HTML 转为纯文本
 */
function htmlToPlainText(html) {
  const cleaned = stripReferenceAndNoiseHtml(html)
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(cleaned)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从输入文本中识别 Bangumi 角色 ID（支持纯数字 ID 或 bgm.tv/character/21021 URL）
 */
function extractBgmCharacterId(input) {
  const raw = String(input || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/\/character\/(\d+)/i);
  return match ? match[1] : "";
}

/**
 * 标准化角色姓名用于多维查重比对
 * 忽略中点符号（· / ・ / • / ‧）、空白与括号附加说明
 */
function normalizeCharacterNameForCompare(name) {
  return String(name || "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/[·・•‧.\-_~\s\u3000]+/g, "")
    .trim()
    .toLowerCase();
}

/**
 * 提取复合译名的主干前缀（如「洛琪希·米格路迪亚·格雷拉特」->「洛琪希·米格路迪亚」与「洛琪希」）
 */
function extractCharacterNameStems(name) {
  const raw = String(name || "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .trim();
  if (!raw) return [];
  const parts = raw
    .split(/[·・•‧]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stems = new Set();
  const fullNorm = normalizeCharacterNameForCompare(raw);
  if (fullNorm.length >= 2) stems.add(fullNorm);
  if (parts.length >= 2) {
    const firstTwo = normalizeCharacterNameForCompare(parts.slice(0, 2).join(""));
    if (firstTwo.length >= 3) stems.add(firstTwo);
  }
  if (parts.length >= 1 && parts[0].length >= 2) {
    stems.add(normalizeCharacterNameForCompare(parts[0]));
  }
  return Array.from(stems);
}

/**
 * 判断两个角色档案是否指向同一角色或高度相似角色
 * 比对维度：
 * 1. Bangumi characterId 完全一致
 * 2. 标准化中文名或日文原名完全一致
 * 3. 全名与简名包含关系（如「洛琪希·米格路迪亚」与「洛琪希·米格路迪亚·格雷拉特」）或别名命中
 */
function areCharactersSimilar(charA, charB) {
  if (!charA || !charB) return { similar: false, reason: "" };

  const bgmA = String(charA.bgmId || "").trim();
  const bgmB = String(charB.bgmId || "").trim();
  if (bgmA && bgmB && bgmA === bgmB) {
    return { similar: true, reason: `Bangumi 角色 ID 相同 (#${bgmA})` };
  }

  const normCnA = normalizeCharacterNameForCompare(charA.name);
  const normCnB = normalizeCharacterNameForCompare(charB.name);
  if (normCnA && normCnB && normCnA === normCnB) {
    return { similar: true, reason: "角色中文名相同" };
  }

  const normJpA = normalizeCharacterNameForCompare(charA.nameJp);
  const normJpB = normalizeCharacterNameForCompare(charB.nameJp);
  if (normJpA && normJpB && normJpA.length >= 2 && normJpA === normJpB) {
    return { similar: true, reason: `角色原名相同 (${charB.nameJp || charA.nameJp})` };
  }

  // 检查全名包含关系（例如「洛琪希·米格路迪亚」与「洛琪希·米格路迪亚·格雷拉特」）
  if (normCnA.length >= 4 && normCnB.length >= 4) {
    if (normCnA.includes(normCnB) || normCnB.includes(normCnA)) {
      return { similar: true, reason: "姓名存在全名与简名包含关系" };
    }
  }

  // 检查两段式译名主干或日文原名包含关系
  const partsA = String(charA.name || "")
    .split(/[·・•‧]+/)
    .map((s) => normalizeCharacterNameForCompare(s))
    .filter(Boolean);
  const partsB = String(charB.name || "")
    .split(/[·・•‧]+/)
    .map((s) => normalizeCharacterNameForCompare(s))
    .filter(Boolean);
  if (partsA.length >= 2 && partsB.length >= 2 && partsA[0] === partsB[0] && partsA[1] === partsB[1]) {
    return { similar: true, reason: "角色主名与姓氏相同" };
  }

  if (normJpA.length >= 4 && normJpB.length >= 4 && (normJpA.includes(normJpB) || normJpB.includes(normJpA))) {
    return { similar: true, reason: "日文原名高度重合" };
  }

  // 检查别名集合交叉命中
  const allNamesA = new Set(
    [charA.name, charA.nameJp, ...(charA.aliases || [])]
      .map((s) => normalizeCharacterNameForCompare(s))
      .filter((s) => s.length >= 3)
  );
  const allNamesB = new Set(
    [charB.name, charB.nameJp, ...(charB.aliases || [])]
      .map((s) => normalizeCharacterNameForCompare(s))
      .filter((s) => s.length >= 3)
  );
  for (const na of allNamesA) {
    if (allNamesB.has(na)) {
      return { similar: true, reason: "角色姓名或别名重合" };
    }
  }

  return { similar: false, reason: "" };
}

/**
 * 在当前角色典藏列表中查找与候选角色重复或高度相似的既有角色
 */
function findSimilarCharactersInCollection(candidate, collection = [], excludeId = "") {
  const matches = [];
  for (const item of Array.isArray(collection) ? collection : []) {
    if (!item) continue;
    if (excludeId && item.id === excludeId) continue;
    const check = areCharactersSimilar(candidate, item);
    if (check.similar) {
      matches.push({ existing: item, reason: check.reason });
    }
  }
  return matches;
}

/**
 * 智能合并两个角色档案（将 incoming 的新数据合并至 target，保留完整萌点、别名与最高评分）
 */
function mergeCharacterRecords(target, incoming) {
  const mergedAliases = Array.from(
    new Set(
      [
        ...(target.aliases || []),
        ...(incoming.aliases || []),
        target.name !== incoming.name ? incoming.name : "",
        target.nameJp && incoming.nameJp && target.nameJp !== incoming.nameJp ? incoming.nameJp : ""
      ]
        .map((s) => String(s || "").trim())
        .filter((s) => s && s !== target.name)
    )
  ).slice(0, 14);

  const mergedMoePoints = Array.from(
    new Set([...(target.moePoints || []), ...(incoming.moePoints || [])].map((s) => String(s || "").trim()).filter(Boolean))
  );

  const mergedHeimu = Array.from(
    new Set([...(target.heimuMoePoints || []), ...(incoming.heimuMoePoints || [])].map((s) => String(s || "").trim()).filter(Boolean))
  );

  const mergedAppearances = Array.from(
    new Set([...(target.appearances || []), ...(incoming.appearances || [])].map((s) => String(s || "").trim()).filter(Boolean))
  ).slice(0, 8);

  // 优先保留信息更完整或用户最新确认的名称
  const preferName =
    incoming.name && incoming.name.length >= (target.name || "").length
      ? incoming.name
      : target.name || incoming.name;

  return {
    ...target,
    bgmId: target.bgmId || incoming.bgmId || "",
    bgmUrl: target.bgmUrl || incoming.bgmUrl || "",
    moegirlUrl: incoming.moegirlUrl || target.moegirlUrl || "",
    name: preferName,
    nameJp: target.nameJp || incoming.nameJp || "",
    aliases: mergedAliases.filter((a) => a !== preferName),
    gender: target.gender || incoming.gender || "",
    birthday: target.birthday || incoming.birthday || "",
    constellation: target.constellation || incoming.constellation || "",
    height: target.height || incoming.height || "",
    bloodType: target.bloodType || incoming.bloodType || "",
    bwh: target.bwh || incoming.bwh || "",
    hairColor: incoming.hairColor || target.hairColor || "",
    eyeColor: incoming.eyeColor || target.eyeColor || "",
    cv: target.cv || incoming.cv || "",
    appearances: mergedAppearances,
    moePoints: mergedMoePoints,
    heimuMoePoints: mergedHeimu,
    avatar: incoming.avatar || target.avatar || "",
    localAvatar: target.localAvatar || incoming.localAvatar || "",
    summary:
      (incoming.summary && incoming.summary.length > (target.summary || "").length
        ? incoming.summary
        : target.summary) || "",
    favoriteScore: Math.max(Number(target.favoriteScore) || 9.0, Number(incoming.favoriteScore) || 9.0),
    personalComment: incoming.personalComment || target.personalComment || "",
    notePath: target.notePath || incoming.notePath || "",
    moegirlSyncStatus:
      target.moegirlSyncStatus === "ok" || incoming.moegirlSyncStatus === "ok" ? "ok" : "fallback"
  };
}

/**
 * 扫描画廊中已存在的重复/相似角色分组（用于一键去重合并清理）
 */
function detectDuplicateCharacterGroups(collection = []) {
  const list = Array.isArray(collection) ? collection : [];
  const visited = new Set();
  const groups = [];

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || visited.has(a.id || i)) continue;
    const group = [a];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b || visited.has(b.id || j)) continue;
      if (areCharactersSimilar(a, b).similar) {
        group.push(b);
        visited.add(b.id || j);
      }
    }
    if (group.length > 1) {
      visited.add(a.id || i);
      groups.push(group);
    }
  }
  return groups;
}

/**
 * 搜索 Bangumi 角色
 * 优先调用 Bangumi v0 Search API，失败或无结果时回退解析网页搜索
 */
async function searchBangumiCharacters(keyword) {
  const q = String(keyword || "").trim();
  if (!q) return [];

  const directId = extractBgmCharacterId(q);
  if (directId) {
    try {
      const detail = await fetchBangumiCharacterDetail(directId);
      if (detail) {
        return [
          {
            id: String(detail.bgmId),
            name: detail.nameCn || detail.nameJp,
            nameJp: detail.nameJp || "",
            avatar: detail.avatar || "",
            summary: detail.summary || "",
            infoTip: [detail.gender, detail.birthday, detail.cv].filter(Boolean).join(" · ")
          }
        ];
      }
    } catch (e) {}
  }

  // 1. 尝试 Bangumi v0 API 搜索角色
  try {
    const resp = await requestUrlWithTimeout({
      url: "https://api.bgm.tv/v0/search/characters?limit=16",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": BGM_USER_AGENT
      },
      body: JSON.stringify({
        keyword: q
      }),
      throw: false
    }, 2200);

    if (resp && resp.status >= 200 && resp.status < 300 && resp.json && Array.isArray(resp.json.data)) {
      const list = resp.json.data.map((item) => {
        let nameCn = "";
        let gender = "";
        let birthday = "";
        if (Array.isArray(item.infobox)) {
          for (const row of item.infobox) {
            if (!row || !row.key) continue;
            const valStr = typeof row.value === "string"
              ? row.value
              : Array.isArray(row.value)
                ? row.value.map((v) => v.v || "").filter(Boolean).join(" / ")
                : "";
            if (row.key === "简体中文名" && !nameCn) nameCn = valStr.trim();
            if (row.key === "性别" && !gender) gender = valStr.trim();
            if (row.key === "生日" && !birthday) birthday = valStr.trim();
          }
        }
        const avatar =
          item.images?.large ||
          item.images?.medium ||
          item.images?.grid ||
          "";
        const gMap = { male: "男", female: "女" };
        const topGender = item.gender ? gMap[String(item.gender).toLowerCase()] || String(item.gender) : "";
        const finalGender = gender || topGender;
        const topBirth =
          item.birth_mon && item.birth_day ? `${item.birth_mon}月${item.birth_day}日` : "";
        const finalBirth = birthday || topBirth;

        return {
          id: String(item.id),
          name: nameCn || item.name || "",
          nameJp: item.name || "",
          avatar: avatar.startsWith("//") ? "https:" + avatar : avatar,
          summary: String(item.summary || "").replace(/\s+/g, " ").trim().slice(0, 90),
          infoTip: [finalGender ? `性别：${finalGender}` : "", finalBirth ? `生日：${finalBirth}` : ""]
            .filter(Boolean)
            .join(" · ")
        };
      });
      if (list.length > 0) return list;
    }
  } catch (err) {
    console.warn("[BangumiManager] v0 character search fallback:", err);
  }

  // 2. 网页搜索回退：https://bgm.tv/mono_search/{keyword}?cat=crt
  try {
    const searchUrl = `https://bgm.tv/mono_search/${encodeURIComponent(q)}?cat=crt`;
    const resp = await requestUrlWithTimeout({
      url: searchUrl,
      method: "GET",
      headers: {
        "User-Agent": BGM_USER_AGENT,
        "Cookie": "chii_searchDateLine=" + Math.floor(Date.now() / 1000)
      },
      throw: false
    }, 2200);
    const html = resp?.text || "";
    const results = [];
    const blockRegex = /<div class="light_odd[\s\S]*?<a href="\/character\/(\d+)"[^>]*class="l"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?=<div class="light_odd|<div class="section_line|$)/gi;
    let m;
    while ((m = blockRegex.exec(html)) !== null) {
      const id = m[1];
      const rawTitle = htmlToPlainText(m[2]);
      const block = m[0];
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
      let avatar = imgMatch ? imgMatch[1].trim() : "";
      if (avatar.startsWith("//")) avatar = "https:" + avatar;
      avatar = avatar.replace(/\/g\/|\/s\/|\/m\//, "/l/");
      const tipMatch = block.match(/<div class="prsn_info"[^>]*>([\s\S]*?)<\/div>/i);
      const infoTip = tipMatch ? htmlToPlainText(tipMatch[1]) : "";
      const parts = rawTitle.split("/").map((s) => s.trim()).filter(Boolean);
      results.push({
        id,
        name: parts[parts.length - 1] || rawTitle,
        nameJp: parts[0] || rawTitle,
        avatar,
        summary: "",
        infoTip
      });
    }
    if (results.length > 0) return results;
  } catch (err) {
    console.warn("[BangumiManager] HTML character search failed:", err);
  }

  // 3. 内置高频角色索引兜底（当外部网络不可达时依然返回匹配角色卡片）
  const qNorm = normalizeCharacterNameForCompare(q);
  const builtinMatches = BUILTIN_CHARACTER_CANDIDATES.filter((c) => {
    const nCn = normalizeCharacterNameForCompare(c.name);
    const nJp = normalizeCharacterNameForCompare(c.nameJp);
    return (
      nCn.includes(qNorm) ||
      qNorm.includes(nCn) ||
      (nJp && (nJp.includes(qNorm) || qNorm.includes(nJp))) ||
      String(c.id) === q
    );
  });
  return builtinMatches;
}

/**
 * 解析 Bangumi 角色详情（API + HTML infobox 双重提取 + 声优与出演作品）
 */
async function fetchBangumiCharacterDetail(characterId) {
  const id = extractBgmCharacterId(characterId);
  if (!id) throw new Error("无效的 Bangumi 角色 ID");

  const result = {
    bgmId: String(id),
    bgmUrl: `https://bgm.tv/character/${id}`,
    nameCn: "",
    nameJp: "",
    aliases: [],
    gender: "",
    birthday: "",
    bloodType: "",
    height: "",
    weight: "",
    bwh: "",
    cv: "",
    appearances: [],
    avatar: "",
    summary: ""
  };

  try {
    const resp = await requestUrlWithTimeout({
      url: `https://api.bgm.tv/v0/characters/${id}`,
      method: "GET",
      headers: { "User-Agent": BGM_USER_AGENT },
      throw: false
    }, 2000);
    if (resp && resp.status >= 200 && resp.status < 300 && resp.json) {
      const data = resp.json;
      result.nameJp = String(data.name || "").trim();
      result.summary = String(data.summary || "").trim();
      const img = data.images?.large || data.images?.medium || "";
      if (img) {
        result.avatar = img.startsWith("//") ? "https:" + img : img;
      }
      if (data.gender) {
        const gMap = { male: "男", female: "女" };
        result.gender = gMap[String(data.gender).toLowerCase()] || String(data.gender);
      }
      if (data.birth_mon && data.birth_day) {
        result.birthday = `${data.birth_mon}月${data.birth_day}日`;
      }
      if (Array.isArray(data.infobox)) {
        for (const item of data.infobox) {
          if (!item || !item.key) continue;
          const k = String(item.key).trim();
          const values = [];
          if (typeof item.value === "string") {
            values.push(item.value.trim());
          } else if (Array.isArray(item.value)) {
            for (const sub of item.value) {
              if (sub && sub.v) values.push(String(sub.v).trim());
            }
          }
          const joined = values.filter(Boolean).join(" / ");
          if (!joined) continue;
          if (k === "简体中文名") result.nameCn = joined;
          else if (k === "别名") result.aliases.push(...values.filter(Boolean));
          else if (k === "性别" && !result.gender) result.gender = joined;
          else if (k === "生日" && !result.birthday) result.birthday = joined;
          else if (k === "血型") result.bloodType = joined;
          else if (k === "身高") result.height = joined;
          else if (k === "体重") result.weight = joined;
          else if (k === "BWH" || k === "三围") result.bwh = joined;
        }
      }
    }
  } catch (err) {
    console.warn("[BangumiManager] v0 character detail error:", err);
  }

  try {
    const [personsResp, subjectsResp] = await Promise.all([
      requestUrlWithTimeout({
        url: `https://api.bgm.tv/v0/characters/${id}/persons`,
        method: "GET",
        headers: { "User-Agent": BGM_USER_AGENT },
        throw: false
      }, 1800).catch(() => null),
      requestUrlWithTimeout({
        url: `https://api.bgm.tv/v0/characters/${id}/subjects`,
        method: "GET",
        headers: { "User-Agent": BGM_USER_AGENT },
        throw: false
      }, 1800).catch(() => null)
    ]);

    if (personsResp?.json && Array.isArray(personsResp.json)) {
      const cvs = [];
      for (const p of personsResp.json) {
        if (p?.name && !cvs.includes(p.name)) {
          cvs.push(p.name);
        }
      }
      if (cvs.length > 0) {
        result.cv = cvs.slice(0, 3).join(" / ");
      }
    }

    if (subjectsResp?.json && Array.isArray(subjectsResp.json)) {
      const apps = [];
      for (const s of subjectsResp.json) {
        const title = s.name_cn || s.name || "";
        if (title && !apps.includes(title)) {
          apps.push(title);
        }
      }
      result.appearances = apps.slice(0, 6);
    }
  } catch (err) {
    console.warn("[BangumiManager] character persons/subjects fetch error:", err);
  }

  if (!result.nameCn && !result.nameJp) {
    try {
      const htmlResp = await requestUrlWithTimeout({
        url: `https://bgm.tv/character/${id}`,
        method: "GET",
        headers: { "User-Agent": BGM_USER_AGENT },
        throw: false
      }, 2000);
      const html = htmlResp?.text || "";
      if (html) {
        parseBangumiCharacterHtml(html, result);
      }
    } catch (err) {
      console.warn("[BangumiManager] character HTML fallback error:", err);
    }
  }

  const builtin = BUILTIN_CHARACTER_CANDIDATES.find((c) => String(c.id) === String(id));
  if (builtin) {
    if (!result.nameCn) result.nameCn = builtin.name;
    if (!result.nameJp) result.nameJp = builtin.nameJp;
    if (!result.gender) result.gender = builtin.gender;
    if (!result.birthday) result.birthday = builtin.birthday;
    if (!result.cv) result.cv = builtin.cv;
    if (!result.appearances || result.appearances.length === 0) result.appearances = builtin.appearances || [];
    if (!result.avatar) result.avatar = builtin.avatar || "";
    if (!result.summary) result.summary = builtin.summary || "";
  }

  if (!result.nameCn) {
    result.nameCn = result.nameJp || `角色 #${id}`;
  }
  result.aliases = Array.from(new Set(result.aliases.filter(Boolean)));
  return result;
}

/**
 * 解析 Bangumi 角色页 HTML
 */
function parseBangumiCharacterHtml(html, target = {}) {
  const h1Match = html.match(/<h1 class="nameSingle">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  if (h1Match && !target.nameJp) {
    target.nameJp = htmlToPlainText(h1Match[1]);
  }
  const coverMatch = html.match(/<img[^>]+src="([^"]+)"[^>]*class="cover"/i) ||
    html.match(/<a[^>]+href="([^"]+)"[^>]*class="cover"/i);
  if (coverMatch && !target.avatar) {
    let url = coverMatch[1].trim();
    if (url.startsWith("//")) url = "https:" + url;
    target.avatar = url;
  }
  const detailMatch = html.match(/<div class="detail">([\s\S]*?)<\/div>/i);
  if (detailMatch && !target.summary) {
    target.summary = htmlToPlainText(detailMatch[1]);
  }

  const infoboxMatch = html.match(/<ul id="infobox"[^>]*>([\s\S]*?)<\/ul>/i);
  if (infoboxMatch) {
    const liRegex = /<li[^>]*>\s*<span class="tip">\s*([^:<：]+)\s*[:：]\s*<\/span>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = liRegex.exec(infoboxMatch[1])) !== null) {
      const key = htmlToPlainText(m[1]);
      const val = htmlToPlainText(m[2]);
      if (!key || !val) continue;
      if (key === "简体中文名" && !target.nameCn) target.nameCn = val;
      else if (key === "别名") {
        target.aliases = target.aliases || [];
        target.aliases.push(val);
      } else if (key === "性别" && !target.gender) target.gender = val;
      else if (key === "生日" && !target.birthday) target.birthday = val;
      else if (key === "血型" && !target.bloodType) target.bloodType = val;
      else if (key === "身高" && !target.height) target.height = val;
      else if (key === "体重" && !target.weight) target.weight = val;
      else if ((key === "BWH" || key === "三围") && !target.bwh) target.bwh = val;
    }
  }
  return target;
}

/**
 * 解析萌娘百科角色资料栏 HTML
 */
function parseMoegirlInfoboxHtml(html) {
  const parsed = {
    found: false,
    moePoints: [],
    heimuMoePoints: [],
    hairColor: "",
    eyeColor: "",
    cv: "",
    realName: "",
    nicknames: [],
    birthday: "",
    constellation: "",
    height: "",
    group: "",
    imageUrl: ""
  };

  const rawHtml = String(html || "");
  if (!rawHtml) return parsed;

  let scopeHtml = rawHtml;
  const infoboxStart = rawHtml.search(/class="[^"]*\b(?:moe-infobox|infobox)\b[^"]*"/i);
  if (infoboxStart >= 0) {
    scopeHtml = rawHtml.slice(infoboxStart, infoboxStart + 65000);
  }

  const imgMatch =
    scopeHtml.match(/class="[^"]*infobox-image[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
    scopeHtml.match(/<img[^>]+src="(https?:\/\/img\.moegirl\.org\.cn\/[^"]+)"/i);
  if (imgMatch && imgMatch[1]) {
    let imgUrl = imgMatch[1].trim();
    if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
    parsed.imageUrl = imgUrl;
  }

  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(scopeHtml)) !== null) {
    const rowHtml = trMatch[1];
    const cellMatch =
      rowHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i) ||
      rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!cellMatch) continue;

    const label = htmlToPlainText(cellMatch[1]).replace(/[:：\s]/g, "");
    const valueHtml = stripReferenceAndNoiseHtml(cellMatch[2]);
    if (!label || !valueHtml) continue;

    if (label.includes("萌点")) {
      parsed.found = true;
      const moeSet = new Set();
      const heimuSet = new Set();

      const heimuRegex = /<span\b[^>]*class="[^"]*\bheimu\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
      let hm;
      while ((hm = heimuRegex.exec(valueHtml)) !== null) {
        const inner = hm[1];
        const aInHeimu = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
        let am;
        let hasA = false;
        while ((am = aInHeimu.exec(inner)) !== null) {
          const t = htmlToPlainText(am[1]).trim();
          if (t) {
            hasA = true;
            heimuSet.add(t);
          }
        }
        if (!hasA) {
          const plainH = htmlToPlainText(inner).trim();
          if (plainH) heimuSet.add(plainH);
        }
      }

      const aRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
      let aMatch;
      while ((aMatch = aRegex.exec(valueHtml)) !== null) {
        const tagText = htmlToPlainText(aMatch[1])
          .replace(/^[\[【(（]|[\]】)）]$/g, "")
          .trim();
        if (
          tagText &&
          tagText.length <= 18 &&
          !/^\d+$/.test(tagText) &&
          !tagText.includes("编辑") &&
          !tagText.includes("查")
        ) {
          moeSet.add(tagText);
        }
      }

      const strippedNoAnchors = valueHtml
        .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "、")
        .replace(/<span\b[^>]*class="[^"]*\bheimu\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "、");
      const plainPieces = htmlToPlainText(strippedNoAnchors)
        .replace(/（[^）]*）|\([^)]*\)/g, "、")
        .split(/[、，,\/；;|]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 1 && s.length <= 12 && !/^\d+$/.test(s));
      for (const piece of plainPieces) {
        moeSet.add(piece);
      }

      parsed.moePoints = Array.from(moeSet);
      parsed.heimuMoePoints = Array.from(heimuSet);
      continue;
    }

    const plainVal = htmlToPlainText(valueHtml);
    if (!plainVal) continue;

    if (label === "发色" || label === "头发颜色") {
      parsed.found = true;
      parsed.hairColor = extractCleanTraitText(valueHtml, plainVal);
    } else if (label === "瞳色" || label === "眼睛颜色") {
      parsed.found = true;
      parsed.eyeColor = extractCleanTraitText(valueHtml, plainVal);
    } else if (label === "本名" || label === "全名") {
      parsed.found = true;
      parsed.realName = plainVal;
    } else if (label === "别号" || label === "别名" || label === "昵称" || label === "称号") {
      parsed.found = true;
      const nicks = plainVal
        .split(/[、，,\/；;\n]+/)
        .map((s) => s.replace(/（[^）]*）|\([^)]*\)/g, "").trim())
        .filter(Boolean);
      parsed.nicknames.push(...nicks);
    } else if (label === "声优" || label === "配音" || label === "CV") {
      parsed.found = true;
      parsed.cv = plainVal;
    } else if (label === "生日" || label === "出生日期") {
      parsed.found = true;
      parsed.birthday = plainVal;
    } else if (label === "星座") {
      parsed.found = true;
      parsed.constellation = plainVal;
    } else if (label === "身高") {
      parsed.found = true;
      parsed.height = plainVal;
    } else if (label === "所属团体" || label === "出身地区") {
      parsed.found = true;
      if (!parsed.group) parsed.group = plainVal;
    }
  }

  parsed.nicknames = Array.from(new Set(parsed.nicknames)).slice(0, 8);
  return parsed;
}

function extractCleanTraitText(valueHtml, fallbackPlain) {
  const anchors = [];
  const aRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(valueHtml)) !== null) {
    const t = htmlToPlainText(m[1]).trim();
    if (t && t.length <= 10) anchors.push(t);
  }
  if (anchors.length > 0) {
    return Array.from(new Set(anchors)).join(" / ");
  }
  return String(fallbackPlain || "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .trim();
}

/**
 * 从萌娘百科抓取角色萌点与人设数据
 */
async function fetchMoegirlCharacterData(candidateNames = []) {
  const names = Array.from(
    new Set(
      (Array.isArray(candidateNames) ? candidateNames : [candidateNames])
        .map((n) => String(n || "").trim())
        .filter(Boolean)
    )
  );

  const expandedNames = [...names];
  for (const n of names) {
    if (n.includes("·")) {
      const firstPart = n.split("·")[0].trim();
      if (firstPart.length >= 2 && !expandedNames.includes(firstPart)) {
        expandedNames.push(firstPart);
      }
    }
  }

  for (const name of expandedNames) {
    const encoded = encodeURIComponent(name);
    const moegirlPageUrl = `https://mzh.moegirl.org.cn/${encoded}`;

    const apiEndpoints = [
      `https://mzh.moegirl.org.cn/api.php?action=parse&page=${encoded}&prop=text&redirects=1&format=json`,
      `https://zh.moegirl.org.cn/api.php?action=parse&page=${encoded}&prop=text&redirects=1&format=json`
    ];

    for (const apiUrl of apiEndpoints) {
      try {
        const resp = await requestUrlWithTimeout({
          url: apiUrl,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json,text/plain,*/*"
          },
          throw: false
        }, 2000);
        const htmlText = resp?.json?.parse?.text?.["*"] || "";
        if (htmlText) {
          const parsed = parseMoegirlInfoboxHtml(htmlText);
          if (parsed.found || parsed.moePoints.length > 0) {
            return {
              ...parsed,
              matchedName: resp?.json?.parse?.title || name,
              moegirlUrl: `https://mzh.moegirl.org.cn/${encodeURIComponent(resp?.json?.parse?.title || name)}`,
              status: "ok"
            };
          }
        }
      } catch (err) {}
    }

    const directUrls = [
      `https://mzh.moegirl.org.cn/${encoded}`,
      `https://zh.moegirl.org.cn/${encoded}`
    ];
    for (const pageUrl of directUrls) {
      try {
        const resp = await requestUrlWithTimeout({
          url: pageUrl,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9"
          },
          throw: false
        }, 2000);
        if (resp && resp.status >= 200 && resp.status < 300 && resp.text) {
          const parsed = parseMoegirlInfoboxHtml(resp.text);
          if (parsed.found || parsed.moePoints.length > 0) {
            return {
              ...parsed,
              matchedName: name,
              moegirlUrl: moegirlPageUrl,
              status: "ok"
            };
          }
        }
      } catch (err) {}
    }
  }

  const primaryName = names[0] || "";
  return {
    found: false,
    moePoints: [],
    heimuMoePoints: [],
    hairColor: "",
    eyeColor: "",
    cv: "",
    realName: "",
    nicknames: [],
    birthday: "",
    constellation: "",
    height: "",
    group: "",
    imageUrl: "",
    matchedName: primaryName,
    moegirlUrl: primaryName
      ? `https://mzh.moegirl.org.cn/${encodeURIComponent(primaryName)}`
      : "https://mzh.moegirl.org.cn/",
    status: "fallback"
  };
}

/**
 * 合并 Bangumi 与 萌娘百科 双源数据为统一角色档案结构
 */
async function fetchDualSourceCharacterProfile(bgmIdOrInput, manualNameHint = "") {
  const bgmId = extractBgmCharacterId(bgmIdOrInput);
  let bgmData = null;
  if (bgmId) {
    bgmData = await fetchBangumiCharacterDetail(bgmId);
  }

  const candidateNames = [
    manualNameHint,
    bgmData?.nameCn,
    ...(bgmData?.aliases || []),
    bgmData?.nameJp
  ].filter(Boolean);

  const moeData = await fetchMoegirlCharacterData(candidateNames);

  const primaryName =
    bgmData?.nameCn ||
    moeData?.realName ||
    manualNameHint ||
    bgmData?.nameJp ||
    "未命名角色";

  // 若名称匹配洛琪希且网络因离线未能返回萌点，提供内置完整萌点兜底
  const isRoxyHint =
    /洛琪希|ロキシー|roxy/i.test(primaryName) ||
    /洛琪希|ロキシー|roxy/i.test(manualNameHint) ||
    String(bgmId) === "21021";
  const fallbackRoxy = isRoxyHint ? createPresetRoxyCharacterRecord() : null;

  const mergedAliases = Array.from(
    new Set(
      [
        ...(bgmData?.aliases || []),
        ...(moeData?.nicknames || []),
        ...(fallbackRoxy?.aliases || [])
      ].filter(Boolean)
    )
  ).slice(0, 10);

  const finalMoePoints = Array.from(
    new Set(
      (moeData?.moePoints && moeData.moePoints.length > 0
        ? moeData.moePoints
        : fallbackRoxy?.moePoints || [])
    )
  );

  return {
    id: bgmData?.bgmId ? `bgm-${bgmData.bgmId}` : `char-${Date.now()}`,
    bgmId: bgmData?.bgmId || fallbackRoxy?.bgmId || "",
    bgmUrl:
      bgmData?.bgmUrl ||
      (bgmId ? `https://bgm.tv/character/${bgmId}` : fallbackRoxy?.bgmUrl || ""),
    moegirlUrl:
      moeData?.moegirlUrl ||
      fallbackRoxy?.moegirlUrl ||
      `https://mzh.moegirl.org.cn/${encodeURIComponent(primaryName)}`,
    name: primaryName,
    nameJp: bgmData?.nameJp || moeData?.realName || fallbackRoxy?.nameJp || "",
    aliases: mergedAliases,
    gender: bgmData?.gender || fallbackRoxy?.gender || "",
    birthday: bgmData?.birthday || moeData?.birthday || fallbackRoxy?.birthday || "",
    constellation: moeData?.constellation || "",
    height: bgmData?.height || moeData?.height || fallbackRoxy?.height || "",
    bloodType: bgmData?.bloodType || "",
    bwh: bgmData?.bwh || "",
    hairColor: moeData?.hairColor || fallbackRoxy?.hairColor || "",
    eyeColor: moeData?.eyeColor || fallbackRoxy?.eyeColor || "",
    cv: bgmData?.cv || moeData?.cv || fallbackRoxy?.cv || "",
    appearances:
      bgmData?.appearances && bgmData.appearances.length > 0
        ? bgmData.appearances
        : fallbackRoxy?.appearances || [],
    moePoints: finalMoePoints,
    heimuMoePoints: Array.from(new Set(moeData?.heimuMoePoints || [])),
    avatar: bgmData?.avatar || moeData?.imageUrl || fallbackRoxy?.avatar || "",
    localAvatar: "",
    summary: bgmData?.summary || fallbackRoxy?.summary || "",
    favoriteScore: fallbackRoxy ? 10.0 : 9.0,
    personalComment: fallbackRoxy?.personalComment || "",
    notePath: "",
    moegirlSyncStatus:
      moeData?.status === "ok" || finalMoePoints.length > 0 ? "ok" : "fallback",
    createdAt: new Date().toISOString().slice(0, 10)
  };
}

/**
 * 保存角色立绘到本地 Vault 封面目录（附件/Bangumi Images/bangumi-cover-char-{id}.jpg）
 */
async function saveCharacterAvatarLocally(app, coverFolder, charId, remoteUrl) {
  const folder = String(coverFolder || "附件/Bangumi Images")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const cleanId = String(charId || "").replace(/^char-|^bgm-/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!app || !folder || !cleanId) {
    return "";
  }
  const cleanKey = `char-${cleanId}`;

  // 若是洛琪希 (21021) 且本地已存在插件内置立绘 roxy_explain.png，优先在远程超时前准备或兜底写入本地附件目录
  const tryCopyLocalRoxyPortraitToVault = async () => {
    try {
      const fs = require("fs");
      const path = require("path");
      const vaultBase =
        app.vault?.adapter && typeof app.vault.adapter.getBasePath === "function"
          ? app.vault.adapter.getBasePath()
          : "";
      if (!vaultBase) return "";
      const roxySrc = path.join(vaultBase, ".obsidian", "plugins", "bangumi-manager", "assets", "roxy", "roxy_explain.png");
      if (!fs.existsSync(roxySrc)) return "";
      await noteManager.ensureVaultFolder(app, folder);
      const targetRel = `${folder}/bangumi-cover-char-21021.png`;
      const targetAbs = path.join(vaultBase, ...targetRel.split("/"));
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.copyFileSync(roxySrc, targetAbs);
      const buf = fs.readFileSync(roxySrc);
      if (app.vault?.adapter?.writeBinary) {
        await app.vault.adapter.writeBinary(targetRel, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)).catch(() => {});
      }
      return targetRel;
    } catch (_) {
      return "";
    }
  };

  if (remoteUrl && /^https?:\/\//i.test(remoteUrl)) {
    try {
      let timer = null;
      const saved = await Promise.race([
        noteManager.saveCoverLocally(app, folder, cleanKey, remoteUrl),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(""), 2200);
        })
      ]);
      if (timer) clearTimeout(timer);
      if (saved && saved !== remoteUrl && !/^https?:\/\//i.test(saved)) {
        return saved;
      }
    } catch (err) {
      console.warn("[BangumiManager] saveCharacterAvatarLocally fallback:", err);
    }
  }

  if (cleanId === "21021") {
    const localRoxy = await tryCopyLocalRoxyPortraitToVault();
    if (localRoxy) return localRoxy;
  }
  return "";
}

/**
 * 解析角色在本地附件目录中的已缓存立绘路径或远程 URL，并在缺失本地文件时后台自动持久化缓存
 */
function resolveCharacterAvatarSrc(plugin, charItem, onCachedCallback = null) {
  if (!charItem) return "";
  const app = plugin?.app;
  const folder = String(plugin?.settings?.coverFolder || "附件/Bangumi Images")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  // 1. 优先检查已记录的 localAvatar
  if (charItem.localAvatar && app?.vault) {
    const file = app.vault.getAbstractFileByPath(charItem.localAvatar);
    if (file && typeof app.vault.getResourcePath === "function") {
      return app.vault.getResourcePath(file);
    }
    if (app.vault.adapter && typeof app.vault.adapter.getResourcePath === "function") {
      return app.vault.adapter.getResourcePath(charItem.localAvatar);
    }
  }

  // 2. 检查本地封面目录下是否已存在 bangumi-cover-char-{id}.{ext}
  const rawId = String(charItem.bgmId || charItem.id || "")
    .replace(/^char-|^bgm-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  if (rawId && app?.vault) {
    const exts = ["jpg", "png", "webp", "jpeg", "gif", "avif"];
    for (const ext of exts) {
      const candidatePath = `${folder}/bangumi-cover-char-${rawId}.${ext}`;
      const file = app.vault.getAbstractFileByPath(candidatePath);
      if (file && typeof app.vault.getResourcePath === "function") {
        charItem.localAvatar = file.path;
        return app.vault.getResourcePath(file);
      }
    }
  }

  // 3. 若角色为洛琪希 (21021)，且插件目录中已安装高清立绘 roxy_explain.png，直接复用并异步落盘至附件目录
  const isRoxyChar =
    rawId === "21021" ||
    /洛琪希|ロキシー|roxy/i.test(String(charItem.name || "")) ||
    /洛琪希|ロキシー|roxy/i.test(String(charItem.nameJp || ""));
  if (isRoxyChar && plugin && typeof roxyMascotService?.resolveRoxyAssetUrl === "function") {
    const roxyAssetUrl = roxyMascotService.resolveRoxyAssetUrl(plugin, "roxy_explain.png");
    if (roxyAssetUrl) {
      if (!charItem._cachingAvatar && app?.vault) {
        charItem._cachingAvatar = true;
        saveCharacterAvatarLocally(app, folder, "21021", charItem.avatar || "")
          .then((savedPath) => {
            charItem._cachingAvatar = false;
            if (savedPath) charItem.localAvatar = savedPath;
          })
          .catch(() => {
            charItem._cachingAvatar = false;
          });
      }
      return roxyAssetUrl;
    }
  }

  // 4. 若存在远程头像但尚未缓存至本地，异步触发一次本地缓存并持久化
  const remoteUrl = String(charItem.avatar || "").trim();
  if (remoteUrl && /^https?:\/\//i.test(remoteUrl) && rawId && app?.vault && !charItem._cachingAvatar) {
    charItem._cachingAvatar = true;
    saveCharacterAvatarLocally(app, folder, rawId, remoteUrl)
      .then(async (savedPath) => {
        charItem._cachingAvatar = false;
        if (savedPath && savedPath !== remoteUrl) {
          charItem.localAvatar = savedPath;
          await plugin.saveSettings().catch(() => {});
          if (typeof onCachedCallback === "function") {
            const f = app.vault.getAbstractFileByPath(savedPath);
            if (f) onCachedCallback(app.vault.getResourcePath(f));
          }
        }
      })
      .catch(() => {
        charItem._cachingAvatar = false;
      });
  }

  return remoteUrl;
}

/**
 * 查找角色关联的本地 Markdown 笔记文件（检查 charRecord.notePath 与默认角色笔记路径）
 */
function resolveCharacterNoteFile(plugin, charRecord) {
  if (!plugin?.app?.vault || !charRecord) return null;
  if (charRecord.notePath) {
    const direct = plugin.app.vault.getAbstractFileByPath(charRecord.notePath);
    if (direct) return direct;
  }
  const folder = String(
    plugin.settings?.characterNoteFolder ||
      (plugin.settings?.noteRootFolder ? `${plugin.settings.noteRootFolder}/角色典藏` : "动画笔记/角色典藏")
  ).replace(/[\\/]+$/, "");
  const safeName = noteManager.getSafeFileName(charRecord.name || charRecord.nameJp || "");
  if (!safeName) return null;
  return plugin.app.vault.getAbstractFileByPath(`${folder}/${safeName}.md`) || null;
}

/**
 * 生成或更新角色典藏 Markdown 笔记（保存在 动画笔记/角色典藏/{角色名}.md）
 */
async function createOrUpdateCharacterMarkdownNote(plugin, charRecord) {
  const folder = String(
    plugin.settings.characterNoteFolder ||
      (plugin.settings.noteRootFolder ? `${plugin.settings.noteRootFolder}/角色典藏` : "动画笔记/角色典藏")
  ).replace(/[\\/]+$/, "");

  await noteManager.ensureVaultFolder(plugin.app, folder);
  const safeName = noteManager.getSafeFileName(charRecord.name || charRecord.nameJp || "未命名角色");
  const filePath = `${folder}/${safeName}.md`;

  const avatarDisplay = charRecord.localAvatar || charRecord.avatar || "";
  const moeTagsYaml = (charRecord.moePoints || [])
    .map((t) => `  - "${String(t).replace(/"/g, '\\"')}"`)
    .join("\n");

  const lines = [
    "---",
    `角色中文名: "${String(charRecord.name || "").replace(/"/g, '\\"')}"`,
    `角色原名: "${String(charRecord.nameJp || "").replace(/"/g, '\\"')}"`,
    `个人喜爱度评分: "${charRecord.favoriteScore ?? ""}"`,
    `发色: "${String(charRecord.hairColor || "未知").replace(/"/g, '\\"')}"`,
    `瞳色: "${String(charRecord.eyeColor || "未知").replace(/"/g, '\\"')}"`,
    `声优: "${String(charRecord.cv || "未知").replace(/"/g, '\\"')}"`,
    `生日: "${String(charRecord.birthday || "未知").replace(/"/g, '\\"')}"`,
    `代表作品: "${String((charRecord.appearances || []).join(" / ") || "未知").replace(/"/g, '\\"')}"`,
    `Bangumi角色页: "${String(charRecord.bgmUrl || "")}"`,
    `萌娘百科: "${String(charRecord.moegirlUrl || "")}"`,
    `收录日期: "${String(charRecord.createdAt || new Date().toISOString().slice(0, 10))}"`
  ];

  if (moeTagsYaml) {
    lines.push("萌点:");
    lines.push(moeTagsYaml);
  } else {
    lines.push("萌点: []");
  }
  lines.push("---", "");

  lines.push(`# ${charRecord.name}${charRecord.nameJp ? `（${charRecord.nameJp}）` : ""}`, "");

  if (avatarDisplay) {
    if (/^https?:\/\//i.test(avatarDisplay)) {
      lines.push(`<img src="${avatarDisplay}" alt="${charRecord.name}" style="max-width:220px;border-radius:10px;" />`, "");
    } else {
      lines.push(`![[${avatarDisplay}|220]]`, "");
    }
  }

  lines.push("## 角色档案与外观属性", "");
  lines.push("| 属性 | 内容 |", "| :--- | :--- |");
  lines.push(`| **个人喜爱度** | ★ **${Number(charRecord.favoriteScore || 0).toFixed(1)}** / 10 |`);
  if (charRecord.aliases?.length) lines.push(`| **别名 / 称号** | ${charRecord.aliases.join("、")} |`);
  if (charRecord.gender) lines.push(`| **性别** | ${charRecord.gender} |`);
  if (charRecord.birthday) lines.push(`| **生日** | ${charRecord.birthday}${charRecord.constellation ? `（${charRecord.constellation}）` : ""} |`);
  if (charRecord.height) lines.push(`| **身高** | ${charRecord.height} |`);
  if (charRecord.hairColor) lines.push(`| **发色** | ${charRecord.hairColor} |`);
  if (charRecord.eyeColor) lines.push(`| **瞳色** | ${charRecord.eyeColor} |`);
  if (charRecord.cv) lines.push(`| **声优 (CV)** | ${charRecord.cv} |`);
  if (charRecord.appearances?.length) lines.push(`| **出演动画** | ${charRecord.appearances.join(" / ")} |`);
  lines.push(
    `| **外部百科** | [Bangumi 角色页](${charRecord.bgmUrl || "https://bgm.tv"}) · [萌娘百科词条](${charRecord.moegirlUrl || "https://mzh.moegirl.org.cn"}) |`,
    ""
  );

  lines.push("## 萌娘百科萌点标签", "");
  if (Array.isArray(charRecord.moePoints) && charRecord.moePoints.length > 0) {
    lines.push(charRecord.moePoints.map((t) => `\`${t}\``).join(" · "), "");
  } else {
    lines.push("> 暂未录入萌点标签，可在番剧档案馆「角色典藏阁」中添加或同步。", "");
  }

  if (charRecord.summary) {
    lines.push("## 角色简介", "", charRecord.summary, "");
  }

  lines.push("## 心动寄语与手记", "");
  lines.push(charRecord.personalComment || "<!-- 在此记录对该角色的喜爱点、名场面或印象手记 -->", "");

  const content = lines.join("\n");
  const existing = plugin.app.vault.getAbstractFileByPath(filePath);
  if (existing) {
    await plugin.app.vault.modify(existing, content);
  } else {
    await plugin.app.vault.create(filePath, content);
  }

  charRecord.notePath = filePath;
  return filePath;
}

/**
 * 计算用户的「最喜爱的角色属性 / 萌点偏好排行」
 */
function computeMoeAttributeRanking(characterList = []) {
  const bucketMap = new Map();

  const addTrait = (rawLabel, category, charItem) => {
    const clean = String(rawLabel || "")
      .replace(/^[\[【(（]|[\]】)）]$/g, "")
      .trim();
    if (!clean || clean === "未知" || clean.length > 18) return;

    const key = `${category}::${clean}`;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        label: clean,
        category,
        count: 0,
        scoreSum: 0,
        weightedScore: 0,
        characters: []
      });
    }
    const entry = bucketMap.get(key);
    if (entry.characters.some((c) => c.id === charItem.id)) return;

    const favScore = Number.isFinite(Number(charItem.favoriteScore))
      ? Math.max(1, Math.min(10, Number(charItem.favoriteScore)))
      : 8.5;

    entry.count += 1;
    entry.scoreSum += favScore;
    entry.weightedScore += favScore * (1 + Math.max(0, favScore - 7.5) * 0.28);
    entry.characters.push({
      id: charItem.id,
      name: charItem.name,
      score: favScore,
      avatar: charItem.localAvatar || charItem.avatar || ""
    });
  };

  for (const ch of characterList) {
    if (!ch) continue;
    if (Array.isArray(ch.moePoints)) {
      for (const mp of ch.moePoints) {
        addTrait(mp, "moe", ch);
      }
    }
    if (ch.hairColor) {
      ch.hairColor
        .split(/[\/、，,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((h) => {
          const label = h.endsWith("发") || h.includes("色") ? h : `${h}发`;
          addTrait(label, "hair", ch);
        });
    }
    if (ch.eyeColor) {
      ch.eyeColor
        .split(/[\/、，,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((e) => {
          const label = e.endsWith("瞳") || e.includes("眼") || e.includes("色") ? e : `${e}瞳`;
          addTrait(label, "eye", ch);
        });
    }
    if (ch.cv) {
      ch.cv
        .split(/[\/、，,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((cvName) => {
          addTrait(cvName, "cv", ch);
        });
    }
  }

  const allEntries = Array.from(bucketMap.values()).map((item) => ({
    ...item,
    avgScore: item.count > 0 ? item.scoreSum / item.count : 0,
    weightedScore: Math.round(item.weightedScore * 10) / 10
  }));

  allEntries.sort((a, b) => {
    if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
    if (b.count !== a.count) return b.count - a.count;
    return b.avgScore - a.avgScore;
  });

  return allEntries;
}

/**
 * 预置洛琪希·米格路迪亚完整角色档案
 */
function createPresetRoxyCharacterRecord() {
  return {
    id: "bgm-21021",
    bgmId: "21021",
    bgmUrl: "https://bgm.tv/character/21021",
    moegirlUrl: "https://mzh.moegirl.org.cn/%E6%B4%9B%E7%90%AA%E5%B8%8C%C2%B7%E7%B1%B3%E6%A0%BC%E8%B7%AF%E8%BF%AA%E4%BA%9A",
    name: "洛琪希·米格路迪亚",
    nameJp: "ロキシー・ミグルディア",
    aliases: ["Roxy Migurdia", "洛琪希·米格路迪亚·格雷拉特", "水圣级魔术师", "鲁迪的师傅"],
    gender: "女",
    birthday: "498年",
    constellation: "",
    height: "150cm",
    bloodType: "",
    bwh: "",
    hairColor: "蓝发",
    eyeColor: "蓝瞳",
    cv: "小原好美",
    appearances: ["无职转生 ～到了异世界就拿出真本事～", "无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: [
      "魔族",
      "魔法师",
      "萝莉",
      "合法萝莉",
      "蓝发",
      "蓝瞳",
      "三股辫",
      "呆毛",
      "帽娘",
      "教师",
      "师傅",
      "天然呆",
      "温柔",
      "勤勉"
    ],
    heimuMoePoints: [],
    avatar: "https://lain.bgm.tv/pic/crt/l/38/64/21021_crt_34224.jpg",
    localAvatar: "",
    summary: "米格路德族的水圣级魔术师。外表看似年幼少女，实则为人认真务实、礼貌温柔。作为鲁迪乌斯的启蒙魔术老师，带他走出了前世的阴霾与家门。",
    favoriteScore: 10.0,
    personalComment: "认真做笔记、一步一个脚印钻研魔导学的老师最棒了！",
    notePath: "",
    moegirlSyncStatus: "ok",
    createdAt: new Date().toISOString().slice(0, 10)
  };
}

/**
 * 弹出「角色重复/相似查重确认」高审美对话框
 * 提供「合并更新至既有角色」、「仍作为新角色添加」、「取消」三个选项
 */
function openDuplicateCharacterConfirmModal(plugin, matchInfo, incomingDraft, callbacks = {}) {
  const existingChar = matchInfo.existing;
  const reason = matchInfo.reason || "角色姓名高度相似";

  class DuplicateCharacterConfirmModal extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-char-dupe-modal");

      const header = contentEl.createDiv("curator-dl-header");
      header.createDiv({
        cls: "curator-dl-kicker",
        text: "CHARACTER ARCHIVE DEDUPLICATION · 角色典藏查重提醒"
      });
      header.createEl("h3", {
        cls: "curator-dl-title",
        text: "✦ 检测到馆藏中已存在相似角色"
      });

      const promptBox = contentEl.createDiv("curator-rss-check-prompt");
      promptBox.createDiv({
        cls: "curator-rss-check-prompt-q",
        text: `馆藏中已存在相似角色「${existingChar.name}」${existingChar.nameJp ? `（${existingChar.nameJp}）` : ""}，是否将新数据合并更新至既有角色，还是仍然作为独立角色重复添加？`
      });
      promptBox.createDiv({
        cls: "curator-rss-inline-hint",
        text: `匹配依据：${reason} · 选择「合并更新」将自动融合双方的萌点标签、别名、出演作品与立绘档案。`
      });

      const compareGrid = contentEl.createDiv("curator-char-dupe-compare-grid");

      const renderMiniCol = (tagLabel, ch) => {
        const col = compareGrid.createDiv("curator-char-dupe-col");
        col.createDiv({ cls: "curator-char-dupe-col-tag", text: tagLabel });
        const nameLine = col.createDiv("curator-char-dupe-col-name");
        nameLine.setText(ch.name || "未命名");
        if (ch.nameJp) {
          col.createDiv({ cls: "curator-char-dupe-col-jp", text: ch.nameJp });
        }
        col.createDiv({
          cls: "curator-char-dupe-col-meta curator-mono",
          text: `喜爱度 ★${Number(ch.favoriteScore || 9.0).toFixed(1)} · 萌点 ${(ch.moePoints || []).length} 项`
        });
      };

      renderMiniCol("🏛️ 馆藏既有角色档案", existingChar);
      renderMiniCol("✨ 本次待收录角色数据", incomingDraft);

      const footer = contentEl.createDiv("curator-rss-check-footer curator-char-dupe-footer");

      const mergeBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-primary",
        text: "✦ 合并更新至既有角色"
      });
      mergeBtn.dataset.dupeAction = "merge";
      mergeBtn.onclick = async (e) => {
        e.preventDefault();
        this.close();
        if (typeof callbacks.onMerge === "function") {
          await callbacks.onMerge(existingChar, incomingDraft);
        }
      };

      const addNewBtn = footer.createEl("button", {
        cls: "curator-dl-btn",
        text: "＋ 仍作为新角色添加"
      });
      addNewBtn.dataset.dupeAction = "add-new";
      addNewBtn.onclick = async (e) => {
        e.preventDefault();
        this.close();
        if (typeof callbacks.onAddAsNew === "function") {
          await callbacks.onAddAsNew(incomingDraft);
        }
      };

      const cancelBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-subtle",
        text: "取消"
      });
      cancelBtn.dataset.dupeAction = "cancel";
      cancelBtn.onclick = (e) => {
        e.preventDefault();
        this.close();
        if (typeof callbacks.onCancel === "function") {
          callbacks.onCancel();
        }
      };
    }
  }

  const modal = new DuplicateCharacterConfirmModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 弹出分级角色删除确认弹窗
 * - 若尚未生成关联 Markdown 角色笔记：轻量确认后直接从画廊移除并伴随退场动效
 * - 若已在仓库中生成关联 Markdown 角色笔记：明确提示将一并移除画廊档案与对应角色笔记（移至回收站），并提供「仅从画廊移除（保留笔记）」选项
 */
function openCharacterDeleteConfirmModal(plugin, charRecord, cardEl, onAfterDeleted) {
  const noteFile = resolveCharacterNoteFile(plugin, charRecord);

  const performRemoval = async (deleteMarkdownNote) => {
    if (deleteMarkdownNote && noteFile && plugin?.app?.vault) {
      try {
        await plugin.app.vault.trash(noteFile, true);
      } catch (err) {
        console.warn("[BangumiManager] 清理关联角色笔记失败:", err);
      }
    }

    const finalizeDataRemoval = async () => {
      plugin.settings.characterCollection = (plugin.settings.characterCollection || []).filter(
        (item) => item.id !== charRecord.id
      );
      if (plugin.__characterArchiveUiState && plugin.__characterArchiveUiState.editingCharId === charRecord.id) {
        plugin.__characterArchiveUiState.editingCharId = null;
      }
      await plugin.saveSettings();
      if (Notice) {
        new Notice(
          deleteMarkdownNote && noteFile
            ? `已移除角色「${charRecord.name}」并将关联笔记《${noteFile.name}》移至回收站。`
            : `已从角色典藏画廊中移除「${charRecord.name}」。`
        );
      }
      if (typeof onAfterDeleted === "function") {
        onAfterDeleted();
      }
      await plugin.refreshOpenDashboardViews();
    };

    if (cardEl && cardEl.isConnected) {
      cardEl.classList.add("is-card-removing");
      setTimeout(() => {
        finalizeDataRemoval();
      }, 240);
    } else {
      await finalizeDataRemoval();
    }
  };

  class CharacterDeleteConfirmModal extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-char-delete-modal");

      const header = contentEl.createDiv("curator-dl-header");
      header.createDiv({
        cls: "curator-dl-kicker",
        text: "CHARACTER ARCHIVE REMOVAL · 角色档案移除确认"
      });
      header.createEl("h3", {
        cls: "curator-dl-title",
        text: noteFile ? `🗑️ 移除角色「${charRecord.name}」与关联笔记` : `🗑️ 移除角色「${charRecord.name}」`
      });

      const promptBox = contentEl.createDiv("curator-rss-check-prompt");
      if (noteFile) {
        promptBox.createDiv({
          cls: "curator-rss-check-prompt-q",
          text: `该角色已生成关联的角色笔记《${noteFile.name}》，确认删除将一并移除画廊档案与对应的角色笔记（移至回收站），是否继续？`
        });
        promptBox.createDiv({
          cls: "curator-rss-inline-hint",
          text: `笔记路径：${noteFile.path}`
        });
      } else {
        promptBox.createDiv({
          cls: "curator-rss-check-prompt-q",
          text: `确认从角色典藏画廊中移除「${charRecord.name}」吗？`
        });
        promptBox.createDiv({
          cls: "curator-rss-inline-hint",
          text: "该角色当前尚未生成独立的 Markdown 角色笔记，移除后仅清理画廊典藏记录。"
        });
      }

      const footer = contentEl.createDiv("curator-rss-check-footer curator-char-delete-footer");

      if (noteFile) {
        const delBothBtn = footer.createEl("button", {
          cls: "curator-dl-btn is-primary is-danger-btn",
          text: "🗑️ 一并移除档案与角色笔记"
        });
        delBothBtn.dataset.deleteAction = "delete-both";
        delBothBtn.onclick = async (e) => {
          e.preventDefault();
          this.close();
          await performRemoval(true);
        };

        const delRecordOnlyBtn = footer.createEl("button", {
          cls: "curator-dl-btn",
          text: "仅从画廊移除（保留笔记）"
        });
        delRecordOnlyBtn.dataset.deleteAction = "delete-record-only";
        delRecordOnlyBtn.onclick = async (e) => {
          e.preventDefault();
          this.close();
          await performRemoval(false);
        };
      } else {
        const confirmBtn = footer.createEl("button", {
          cls: "curator-dl-btn is-primary is-danger-btn",
          text: "🗑️ 确认移除"
        });
        confirmBtn.dataset.deleteAction = "confirm";
        confirmBtn.onclick = async (e) => {
          e.preventDefault();
          this.close();
          await performRemoval(false);
        };
      }

      const cancelBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-subtle",
        text: "取消"
      });
      cancelBtn.dataset.deleteAction = "cancel";
      cancelBtn.onclick = (e) => {
        e.preventDefault();
        this.close();
      };
    }
  }

  const modal = new CharacterDeleteConfirmModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 一键清理并合并画廊中所有既有重复/相似角色
 */
async function mergeAllDuplicateCharactersInGallery(plugin, onRefresh) {
  const list = Array.isArray(plugin.settings.characterCollection)
    ? [...plugin.settings.characterCollection]
    : [];
  const groups = detectDuplicateCharacterGroups(list);
  if (groups.length === 0) {
    if (Notice) new Notice("当前角色典藏画廊中未发现重复或相似角色。");
    return 0;
  }

  const removeIds = new Set();
  let mergedCount = 0;

  for (const group of groups) {
    let primary = group[0];
    for (let i = 1; i < group.length; i++) {
      const secondary = group[i];
      primary = mergeCharacterRecords(primary, secondary);
      removeIds.add(secondary.id);
      mergedCount += 1;
    }
    const idx = list.findIndex((c) => c.id === primary.id);
    if (idx >= 0) {
      list[idx] = primary;
    }
  }

  plugin.settings.characterCollection = list.filter((c) => !removeIds.has(c.id));
  await plugin.saveSettings();
  if (Notice) {
    new Notice(`✨ 已智能合并 ${groups.length} 组相似角色，清理了 ${mergedCount} 张重复角色卡片！`);
  }
  if (typeof onRefresh === "function") {
    onRefresh();
  }
  await plugin.refreshOpenDashboardViews();
  return mergedCount;
}

/**
 * 渲染「角色典藏与萌点偏好排行」工作台视图（或年鉴内嵌模块）
 */
function renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems = [], options = {}) {
  container.empty();
  container.addClass("curator-character-archive-root");

  if (!plugin.__characterArchiveUiState) {
    plugin.__characterArchiveUiState = {
      activeTraitFilter: null,
      rankCategory: "all",
      rankSortMode: "weighted",
      gallerySortMode: "score-desc",
      searchQuery: "",
      showAddDrawer: false,
      editingCharId: null
    };
  }
  const uiState = plugin.__characterArchiveUiState;

  if (!Array.isArray(plugin.settings.characterCollection)) {
    plugin.settings.characterCollection = [];
  }
  const characters = plugin.settings.characterCollection;

  const vaultAnimeByTitle = new Map();
  for (const anime of vaultAnimeItems || []) {
    if (anime.title) vaultAnimeByTitle.set(String(anime.title).trim().toLowerCase(), anime);
    if (anime.originalTitle) vaultAnimeByTitle.set(String(anime.originalTitle).trim().toLowerCase(), anime);
    if (anime.name) vaultAnimeByTitle.set(String(anime.name).trim().toLowerCase(), anime);
  }

  // 顶部栏：典藏统计 + 搜索 + 收录新角色按钮
  const headerBar = container.createDiv("curator-char-header-bar");
  const titleSide = headerBar.createDiv("curator-char-header-left");
  titleSide.createSpan({
    cls: "curator-char-header-title",
    text: options.compactAlmanacMode
      ? "👑 角色典藏与萌娘百科萌点偏好洞察"
      : "👑 角色典藏阁 · 角色履历与萌娘百科萌点偏好洞察"
  });
  titleSide.createSpan({
    cls: "curator-char-header-sub curator-mono",
    text: `已典藏 ${characters.length} 位角色 · 汇聚 Bangumi 角色履历与萌娘百科萌点档案`
  });

  const actionSide = headerBar.createDiv("curator-char-header-actions");
  if (!options.compactAlmanacMode) {
    const searchInput = actionSide.createEl("input", {
      type: "search",
      cls: "curator-input curator-char-search-input",
      placeholder: "筛选已藏角色 / 萌点 / 声优 / 出演作品…"
    });
    searchInput.value = uiState.searchQuery || "";
    searchInput.oninput = () => {
      uiState.searchQuery = searchInput.value;
      renderGalleryOnly();
    };
  }

  const addCharBtn = actionSide.createEl("button", {
    cls: `curator-btn ${uiState.showAddDrawer ? "is-active" : "is-primary"}`,
    text: uiState.showAddDrawer ? "▴ 收起角色收录台" : "＋ 搜索 / 录入喜爱角色"
  });
  addCharBtn.onclick = (e) => {
    e.preventDefault();
    uiState.showAddDrawer = !uiState.showAddDrawer;
    renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options);
  };

  // 角色寻访与档案收录台抽屉
  if (uiState.showAddDrawer) {
    renderCharacterAddDrawer(plugin, container, vaultAnimeItems, options);
  }

  // 空状态引导
  if (characters.length === 0) {
    const emptyBox = container.createDiv("curator-char-empty-box");
    emptyBox.createDiv({
      cls: "curator-char-empty-title",
      text: "尚未收录喜爱的动画角色"
    });
    emptyBox.createDiv({
      cls: "curator-char-empty-desc",
      text: "点击上方「＋ 搜索 / 录入喜爱角色」，输入角色名或 Bangumi 角色页链接，即可自动寻访角色立绘、声优、出演作品，并同步萌娘百科「萌点 / 发色 / 瞳色」生成专属角色属性偏好排行！"
    });
    const quickRow = emptyBox.createDiv("curator-char-empty-actions");
    const presetRoxyBtn = quickRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "✦ 一键收录示例：洛琪希·米格路迪亚（10.0分）"
    });
    presetRoxyBtn.onclick = async (e) => {
      e.preventDefault();
      const roxy = createPresetRoxyCharacterRecord();
      roxy.localAvatar = await saveCharacterAvatarLocally(
        plugin.app,
        plugin.settings.coverFolder,
        roxy.bgmId,
        roxy.avatar
      );
      plugin.settings.characterCollection.push(roxy);
      await plugin.saveSettings();
      if (Notice) new Notice("已将「洛琪希·米格路迪亚」收入角色典藏阁！");
      renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options);
      await plugin.refreshOpenDashboardViews();
    };

    const openSearchBtn = quickRow.createEl("button", {
      cls: "curator-btn",
      text: "🔍 搜索其他角色"
    });
    openSearchBtn.onclick = (e) => {
      e.preventDefault();
      uiState.showAddDrawer = true;
      renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options);
    };
    return;
  }

  // 第一部分：最喜爱的角色属性 / 萌点偏好排行榜面板
  const allRankedTraits = computeMoeAttributeRanking(characters);
  renderMoePreferenceRankingSection(
    plugin,
    container,
    allRankedTraits,
    uiState,
    options,
    () => renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options)
  );

  // 第二部分：角色典藏画廊
  const galleryHost = container.createDiv("curator-char-gallery-host");
  const renderGalleryOnly = () => {
    renderCharacterGallerySection(
      plugin,
      galleryHost,
      characters,
      vaultAnimeByTitle,
      uiState,
      options,
      () => renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options)
    );
  };
  renderGalleryOnly();
}

/**
 * 渲染「🔭 角色寻访与档案收录台」
 */
function renderCharacterAddDrawer(plugin, container, vaultAnimeItems, options) {
  const drawer = container.createDiv("curator-char-add-drawer");
  const head = drawer.createDiv("curator-char-add-head");
  head.createDiv({
    cls: "curator-char-add-title",
    text: "🔭 角色寻访与档案收录台"
  });
  head.createDiv({
    cls: "curator-char-add-sub",
    text: "输入角色中文名、日文原名或 Bangumi 角色链接（如 https://bgm.tv/character/21021），即可寻访角色履历并同步萌娘百科萌点档案"
  });

  const searchBar = drawer.createDiv("curator-char-add-searchbar");
  const kwInput = searchBar.createEl("input", {
    type: "text",
    cls: "curator-input curator-char-kw-input",
    placeholder: "输入角色名称（如：洛琪希 / 芙莉莲 / 千束 / 21021）…"
  });
  const searchBtn = searchBar.createEl("button", {
    cls: "curator-btn is-primary",
    text: "🔍 搜索 Bangumi 角色"
  });
  const manualBtn = searchBar.createEl("button", {
    cls: "curator-btn",
    text: "✦ 按名称直接收录"
  });

  const resultsArea = drawer.createDiv("curator-char-search-results");
  const previewArea = drawer.createDiv("curator-char-preview-area");

  // 持久化保存（合并或新增）角色的统一落盘助手
  const commitSaveCharacterRecord = async (finalRecord, mergeTargetChar = null, shouldCreateNote = true) => {
    if (finalRecord.avatar) {
      const savedAvatar = await saveCharacterAvatarLocally(
        plugin.app,
        plugin.settings.coverFolder,
        finalRecord.bgmId || finalRecord.id,
        finalRecord.avatar
      );
      if (savedAvatar) {
        finalRecord.localAvatar = savedAvatar;
      }
    }

    const list = Array.isArray(plugin.settings.characterCollection)
      ? plugin.settings.characterCollection
      : [];

    let savedRecord = finalRecord;
    if (mergeTargetChar) {
      savedRecord = mergeCharacterRecords(mergeTargetChar, finalRecord);
      if (finalRecord.localAvatar) savedRecord.localAvatar = finalRecord.localAvatar;
      const idx = list.findIndex((c) => c.id === mergeTargetChar.id);
      if (idx >= 0) {
        list[idx] = savedRecord;
      } else {
        list.unshift(savedRecord);
      }
    } else {
      // 确保作为独立新角色添加时拥有唯一 ID
      if (list.some((c) => c.id === savedRecord.id)) {
        savedRecord = {
          ...savedRecord,
          id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        };
      }
      list.unshift(savedRecord);
    }

    if (shouldCreateNote || savedRecord.notePath) {
      await createOrUpdateCharacterMarkdownNote(plugin, savedRecord);
    }

    plugin.settings.characterCollection = list;
    await plugin.saveSettings();

    if (plugin.__characterArchiveUiState) {
      plugin.__characterArchiveUiState.showAddDrawer = false;
    }
    if (Notice) {
      new Notice(
        mergeTargetChar
          ? `已将新数据合并更新至角色「${savedRecord.name}」！`
          : `已将《${savedRecord.name}》收入角色典藏阁！`
      );
    }
    renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options);
    await plugin.refreshOpenDashboardViews();
  };

  const openDraftEditor = (profileDraft, forceNewMode = false) => {
    previewArea.empty();
    const editorCard = previewArea.createDiv("curator-char-draft-editor");
    editorCard.createDiv({
      cls: "curator-char-draft-heading",
      text: `✦ 确认角色档案与萌点标签：《${profileDraft.name}》`
    });

    // 若画廊中已存在相似角色，在编辑器顶部展示温和提示条
    const existingMatches = findSimilarCharactersInCollection(
      profileDraft,
      plugin.settings.characterCollection || []
    );
    if (existingMatches.length > 0 && !forceNewMode) {
      const warnBar = editorCard.createDiv("curator-char-dupe-inline-banner");
      warnBar.createSpan({
        text: `⚠️ 馆藏中已存在相似角色「${existingMatches[0].existing.name}」（${existingMatches[0].reason}）。点击下方保存时可选择合并更新或独立添加。`
      });
    }

    const formGrid = editorCard.createDiv("curator-char-draft-grid");
    const posterCol = formGrid.createDiv("curator-char-draft-poster");
    const draftAvaSrc = resolveCharacterAvatarSrc(plugin, profileDraft);
    if (draftAvaSrc) {
      const img = posterCol.createEl("img", {
        attr: { src: draftAvaSrc, alt: profileDraft.name }
      });
      img.src = draftAvaSrc;
      img.alt = profileDraft.name;
      img.onerror = () => {
        img.remove();
        posterCol.setText("👤");
      };
    } else {
      posterCol.setText("👤");
    }

    const fieldsCol = formGrid.createDiv("curator-char-draft-fields");

    const row1 = fieldsCol.createDiv("curator-char-draft-row");
    const nameInput = createLabeledInput(row1, "角色中文名", profileDraft.name || "");
    const jpInput = createLabeledInput(row1, "原名 / 日文名", profileDraft.nameJp || "");
    const scoreInput = createLabeledInput(
      row1,
      "个人喜爱度 (1-10)",
      String(profileDraft.favoriteScore ?? 9.5),
      "number"
    );
    scoreInput.min = "1";
    scoreInput.max = "10";
    scoreInput.step = "0.1";

    const row2 = fieldsCol.createDiv("curator-char-draft-row");
    const hairInput = createLabeledInput(row2, "发色（萌娘百科）", profileDraft.hairColor || "");
    const eyeInput = createLabeledInput(row2, "瞳色（萌娘百科）", profileDraft.eyeColor || "");
    const cvInput = createLabeledInput(row2, "声优 (CV)", profileDraft.cv || "");
    const bdayInput = createLabeledInput(row2, "生日", profileDraft.birthday || "");

    const row3 = fieldsCol.createDiv("curator-char-draft-row");
    const appInput = createLabeledInput(
      row3,
      "代表出演作品（以 / 分隔）",
      (profileDraft.appearances || []).join(" / ")
    );
    const avatarInput = createLabeledInput(row3, "立绘图片 URL", profileDraft.avatar || "");

    const moeRow = fieldsCol.createDiv("curator-char-draft-moe-wrap");
    const moeStatusText =
      profileDraft.moegirlSyncStatus === "ok"
        ? `✓ 已同步 ${profileDraft.moePoints.length} 个萌点`
        : "可手动补充或点击右侧按钮同步萌娘百科";
    const moeHeader = moeRow.createDiv("curator-char-draft-moe-head");
    moeHeader.createSpan({
      cls: "curator-char-draft-label",
      text: `萌点标签（顿号或逗号分隔 · ${moeStatusText}）`
    });

    const moeQuickLinks = moeHeader.createDiv("curator-char-draft-moe-links");
    const openMoeBtn = moeQuickLinks.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "↗ 打开萌娘百科词条"
    });
    openMoeBtn.onclick = (ev) => {
      ev.preventDefault();
      const targetName = nameInput.value.trim() || profileDraft.name;
      window.open(`https://mzh.moegirl.org.cn/${encodeURIComponent(targetName)}`, "_blank");
    };

    const retryMoeBtn = moeQuickLinks.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "🔄 重新同步萌娘百科"
    });

    const moeInput = moeRow.createEl("textarea", {
      cls: "curator-textarea curator-char-moe-textarea",
      placeholder: "例如：魔法师、萝莉、蓝发、蓝瞳、呆毛、帽娘、傲娇、天然呆…"
    });
    moeInput.rows = 2;
    moeInput.value = (profileDraft.moePoints || []).join("、");

    retryMoeBtn.onclick = async (ev) => {
      ev.preventDefault();
      retryMoeBtn.disabled = true;
      retryMoeBtn.textContent = "正在同步萌娘百科…";
      try {
        const moeRes = await fetchMoegirlCharacterData([
          nameInput.value.trim(),
          jpInput.value.trim()
        ]);
        if (moeRes.moePoints.length > 0) {
          const merged = Array.from(
            new Set([
              ...moeInput.value.split(/[、，,\/；;|]+/).map((s) => s.trim()).filter(Boolean),
              ...moeRes.moePoints
            ])
          );
          moeInput.value = merged.join("、");
        }
        if (moeRes.hairColor && !hairInput.value.trim()) hairInput.value = moeRes.hairColor;
        if (moeRes.eyeColor && !eyeInput.value.trim()) eyeInput.value = moeRes.eyeColor;
        if (moeRes.cv && !cvInput.value.trim()) cvInput.value = moeRes.cv;
        if (moeRes.birthday && !bdayInput.value.trim()) bdayInput.value = moeRes.birthday;
        if (Notice) {
          new Notice(
            moeRes.moePoints.length > 0
              ? `已从萌娘百科同步 ${moeRes.moePoints.length} 个萌点！`
              : "萌娘百科暂未返回萌点，可直接手动输入标签。"
          );
        }
      } finally {
        retryMoeBtn.disabled = false;
        retryMoeBtn.textContent = "🔄 重新同步萌娘百科";
      }
    };

    const commentRow = fieldsCol.createDiv("curator-char-draft-moe-wrap");
    commentRow.createDiv({
      cls: "curator-char-draft-label",
      text: "心动寄语 / 角色印象短评（可选）"
    });
    const commentInput = commentRow.createEl("input", {
      type: "text",
      cls: "curator-input",
      placeholder: "写下一句对这位角色的心动理由或名场面印象…"
    });
    commentInput.value = profileDraft.personalComment || "";

    const submitRow = editorCard.createDiv("curator-char-draft-actions");
    const autoCreateNoteCheckLabel = submitRow.createEl("label", {
      cls: "curator-rs-enter-toggle"
    });
    const autoNoteCheckbox = autoCreateNoteCheckLabel.createEl("input", {
      type: "checkbox"
    });
    autoNoteCheckbox.checked = true;
    autoCreateNoteCheckLabel.createSpan({
      text: "同时生成角色典藏 Markdown 笔记"
    });

    const saveBtn = submitRow.createEl("button", {
      cls: "curator-btn is-primary",
      text: "✦ 收入角色典藏阁"
    });
    saveBtn.onclick = async (ev) => {
      ev.preventDefault();
      saveBtn.disabled = true;
      saveBtn.textContent = "正在保存…";
      try {
        const finalName = nameInput.value.trim() || profileDraft.name || "未命名角色";
        const finalMoePoints = Array.from(
          new Set(
            moeInput.value
              .split(/[、，,\/；;|\n]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          )
        );
        const favNum = Number(scoreInput.value);
        const finalRecord = {
          ...profileDraft,
          name: finalName,
          nameJp: jpInput.value.trim(),
          favoriteScore: Number.isFinite(favNum)
            ? Math.max(1, Math.min(10, Math.round(favNum * 10) / 10))
            : 9.0,
          hairColor: hairInput.value.trim(),
          eyeColor: eyeInput.value.trim(),
          cv: cvInput.value.trim(),
          birthday: bdayInput.value.trim(),
          appearances: appInput.value
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean),
          avatar: avatarInput.value.trim(),
          moePoints: finalMoePoints,
          personalComment: commentInput.value.trim(),
          moegirlUrl: `https://mzh.moegirl.org.cn/${encodeURIComponent(finalName)}`
        };

        // 执行多维查重检测
        const dupes = findSimilarCharactersInCollection(
          finalRecord,
          plugin.settings.characterCollection || []
        );
        if (dupes.length > 0 && !forceNewMode) {
          saveBtn.disabled = false;
          saveBtn.textContent = "✦ 收入角色典藏阁";
          openDuplicateCharacterConfirmModal(plugin, dupes[0], finalRecord, {
            onMerge: async (existingChar, incoming) => {
              await commitSaveCharacterRecord(incoming, existingChar, autoNoteCheckbox.checked);
            },
            onAddAsNew: async (incoming) => {
              await commitSaveCharacterRecord(incoming, null, autoNoteCheckbox.checked);
            }
          });
          return;
        }

        await commitSaveCharacterRecord(finalRecord, null, autoNoteCheckbox.checked);
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = "✦ 收入角色典藏阁";
        if (Notice) new Notice(`保存角色失败：${err.message}`);
      }
    };
  };

  // 处理点击「+ 收录」或「✦ 按名称直接收录」时的预查重与编辑器开启流
  const handleCandidatePickWithDupeCheck = async (draft) => {
    const dupes = findSimilarCharactersInCollection(
      draft,
      plugin.settings.characterCollection || []
    );
    if (dupes.length > 0) {
      openDuplicateCharacterConfirmModal(plugin, dupes[0], draft, {
        onMerge: async (existingChar, incoming) => {
          await commitSaveCharacterRecord(incoming, existingChar, true);
        },
        onAddAsNew: async (incoming) => {
          openDraftEditor(incoming, true);
        },
        onCancel: () => {}
      });
    } else {
      openDraftEditor(draft, false);
    }
  };

  const runSearch = async () => {
    const q = kwInput.value.trim();
    if (!q) {
      if (Notice) new Notice("请输入角色名称或 Bangumi 角色 ID");
      return;
    }
    searchBtn.disabled = true;
    searchBtn.textContent = "正在搜索…";
    resultsArea.empty();
    previewArea.empty();
    try {
      const list = await searchBangumiCharacters(q);
      if (list.length === 0) {
        resultsArea.createDiv({
          cls: "curator-rs-empty",
          text: "未在 Bangumi 检索到同名角色，可点击右侧「✦ 按名称直接收录」。"
        });
        return;
      }
      const grid = resultsArea.createDiv("curator-char-search-grid");
      for (const item of list) {
        const similarInVault = findSimilarCharactersInCollection(
          { bgmId: item.id, name: item.name, nameJp: item.nameJp },
          plugin.settings.characterCollection || []
        );
        const card = grid.createDiv(
          `curator-char-search-card ${similarInVault.length > 0 ? "is-already-collected" : ""}`
        );

        const ava = card.createDiv("curator-char-search-ava");
        const candAvaSrc = resolveCharacterAvatarSrc(plugin, {
          bgmId: item.id,
          avatar: item.avatar
        });
        if (candAvaSrc) {
          const img = ava.createEl("img", {
            attr: { src: candAvaSrc, alt: item.name }
          });
          img.src = candAvaSrc;
          img.alt = item.name;
          img.loading = "lazy";
          img.onerror = () => {
            img.remove();
            ava.setText((item.name || "角").slice(0, 1));
          };
        } else {
          ava.setText((item.name || "角").slice(0, 1));
        }

        const meta = card.createDiv("curator-char-search-meta");
        const nameRow = meta.createDiv("curator-char-search-name-row");
        nameRow.createSpan({
          cls: "curator-char-search-name",
          text: item.name
        });
        if (similarInVault.length > 0) {
          nameRow.createSpan({
            cls: "curator-char-search-dupe-tag",
            text: "已在馆藏"
          });
        }
        if (item.nameJp && item.nameJp !== item.name) {
          meta.createDiv({ cls: "curator-char-search-jp", text: item.nameJp });
        }
        const subTip = [item.infoTip, item.summary].filter(Boolean).join(" · ");
        if (subTip) {
          meta.createDiv({
            cls: "curator-char-search-tip",
            text: subTip
          });
        }

        const pickBtn = card.createEl("button", {
          cls: "curator-dl-mini-btn is-accent curator-char-pick-btn",
          text: "+ 收录"
        });
        pickBtn.title = `收录「${item.name}」并同步萌娘百科萌点档案`;
        pickBtn.onclick = async (ev) => {
          ev.preventDefault();
          pickBtn.disabled = true;
          pickBtn.textContent = "寻访中…";
          try {
            const draft = await fetchDualSourceCharacterProfile(item.id, item.name);
            await handleCandidatePickWithDupeCheck(draft);
          } finally {
            pickBtn.disabled = false;
            pickBtn.textContent = "+ 收录";
          }
        };
      }
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "🔍 搜索 Bangumi 角色";
    }
  };

  searchBtn.onclick = (e) => {
    e.preventDefault();
    runSearch();
  };
  kwInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  };
  manualBtn.onclick = async (e) => {
    e.preventDefault();
    const nameHint = kwInput.value.trim() || "新角色";
    manualBtn.disabled = true;
    manualBtn.textContent = "寻访档案中…";
    try {
      const draft = await fetchDualSourceCharacterProfile("", nameHint);
      await handleCandidatePickWithDupeCheck(draft);
    } finally {
      manualBtn.disabled = false;
      manualBtn.textContent = "✦ 按名称直接收录";
    }
  };
}

function createLabeledInput(parent, labelText, initialValue, type = "text") {
  const wrap = parent.createDiv("curator-char-field-item");
  wrap.createSpan({ cls: "curator-char-draft-label", text: labelText });
  const input = wrap.createEl("input", {
    type,
    cls: "curator-input"
  });
  input.value = initialValue;
  return input;
}

/**
 * 渲染「最喜爱的角色属性 / 萌点偏好排行榜」
 */
function renderMoePreferenceRankingSection(plugin, container, allRankedTraits, uiState, options, onRefresh) {
  const rankSection = container.createDiv("curator-char-rank-section");
  const rankHead = rankSection.createDiv("curator-char-rank-head");

  const titleWrap = rankHead.createDiv("curator-char-rank-title-wrap");
  titleWrap.createSpan({
    cls: "curator-char-rank-title",
    text: "🏆 最喜爱的角色属性与萌点偏好排行"
  });
  titleWrap.createSpan({
    cls: "curator-char-rank-subtitle",
    text: "点击任意萌点或外观标签即可筛选下方角色画廊"
  });

  const controlsWrap = rankHead.createDiv("curator-char-rank-controls");
  const catTabs = [
    { id: "all", label: "全部属性" },
    { id: "moe", label: "✦ 萌点特征" },
    { id: "appearance", label: "🎨 发色 & 瞳色" },
    { id: "cv", label: "🎙️ 声优 (CV)" }
  ];
  catTabs.forEach((tab) => {
    const btn = controlsWrap.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.rankCategory === tab.id ? "is-active" : ""}`,
      text: tab.label
    });
    btn.onclick = (e) => {
      e.preventDefault();
      uiState.rankCategory = tab.id;
      onRefresh();
    };
  });

  const sortToggle = controlsWrap.createEl("button", {
    cls: "curator-dl-mini-btn",
    text: uiState.rankSortMode === "weighted" ? "排序：喜爱度加权 ▾" : "排序：出现频次 ▾"
  });
  sortToggle.onclick = (e) => {
    e.preventDefault();
    uiState.rankSortMode = uiState.rankSortMode === "weighted" ? "count" : "weighted";
    onRefresh();
  };

  if (uiState.activeTraitFilter) {
    const clearBtn = controlsWrap.createEl("button", {
      cls: "curator-dl-mini-btn is-accent",
      text: `✕ 清除筛选：${uiState.activeTraitFilter.label}`
    });
    clearBtn.onclick = (e) => {
      e.preventDefault();
      uiState.activeTraitFilter = null;
      onRefresh();
    };
  }

  let filteredTraits = allRankedTraits.filter((t) => {
    if (uiState.rankCategory === "moe") return t.category === "moe";
    if (uiState.rankCategory === "appearance") return t.category === "hair" || t.category === "eye";
    if (uiState.rankCategory === "cv") return t.category === "cv";
    return true;
  });

  if (uiState.rankSortMode === "count") {
    filteredTraits = [...filteredTraits].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.avgScore - a.avgScore;
    });
  }

  if (filteredTraits.length === 0) {
    rankSection.createDiv({
      cls: "curator-rs-empty",
      text: "当前分类下暂无属性数据。"
    });
    return;
  }

  const maxMetric = Math.max(
    1,
    ...filteredTraits.map((t) => (uiState.rankSortMode === "weighted" ? t.weightedScore : t.count))
  );

  const topList = filteredTraits.slice(0, options.compactAlmanacMode ? 6 : 10);
  const restPills = filteredTraits.slice(options.compactAlmanacMode ? 6 : 10, 36);

  const barsGrid = rankSection.createDiv("curator-char-rank-bars-grid");
  topList.forEach((trait, idx) => {
    const isSelected = uiState.activeTraitFilter && uiState.activeTraitFilter.key === trait.key;
    const barCard = barsGrid.createDiv(
      `curator-char-rank-bar-card ${isSelected ? "is-selected" : ""}`
    );
    barCard.onclick = (e) => {
      e.preventDefault();
      if (isSelected) {
        uiState.activeTraitFilter = null;
      } else {
        uiState.activeTraitFilter = {
          key: trait.key,
          label: trait.label,
          category: trait.category
        };
      }
      onRefresh();
    };

    const topRow = barCard.createDiv("curator-char-rank-bar-top");
    const leftLabel = topRow.createDiv("curator-char-rank-bar-label");
    leftLabel.createSpan({
      cls: `curator-char-rank-idx ${idx < 3 ? "is-top3" : ""} curator-mono`,
      text: `#${idx + 1}`
    });
    const catBadgeMap = {
      moe: "萌点",
      hair: "发色",
      eye: "瞳色",
      cv: "CV"
    };
    leftLabel.createSpan({
      cls: `curator-char-trait-cat is-${trait.category}`,
      text: catBadgeMap[trait.category] || "属性"
    });
    leftLabel.createSpan({
      cls: "curator-char-trait-name",
      text: trait.label
    });

    topRow.createSpan({
      cls: "curator-char-trait-metrics curator-mono",
      text: `${trait.count} 位 · 均分 ★${trait.avgScore.toFixed(1)}`
    });

    const track = barCard.createDiv("curator-char-rank-track");
    const fill = track.createDiv(`curator-char-rank-fill is-${trait.category}`);
    const metricVal = uiState.rankSortMode === "weighted" ? trait.weightedScore : trait.count;
    fill.style.width = `${Math.max(8, Math.round((metricVal / maxMetric) * 100))}%`;

    const charNamesRow = barCard.createDiv("curator-char-rank-avatars-row");
    trait.characters.slice(0, 4).forEach((c) => {
      charNamesRow.createSpan({
        cls: "curator-char-mini-chip",
        text: `${c.name} (${c.score.toFixed(1)})`
      });
    });
  });

  if (restPills.length > 0) {
    const cloudWrap = rankSection.createDiv("curator-char-moe-cloud");
    cloudWrap.createSpan({
      cls: "curator-char-cloud-label",
      text: "更多萌点与属性："
    });
    restPills.forEach((trait) => {
      const isSelected = uiState.activeTraitFilter && uiState.activeTraitFilter.key === trait.key;
      const pill = cloudWrap.createEl("button", {
        cls: `curator-char-cloud-pill ${isSelected ? "is-selected" : ""}`,
        text: `${trait.label} (${trait.count})`
      });
      pill.title = `平均喜爱度 ★${trait.avgScore.toFixed(1)} · 包含角色：${trait.characters.map((c) => c.name).join("、")}`;
      pill.onclick = (e) => {
        e.preventDefault();
        uiState.activeTraitFilter = isSelected
          ? null
          : { key: trait.key, label: trait.label, category: trait.category };
        onRefresh();
      };
    });
  }
}

/**
 * 渲染角色典藏卡片画廊
 */
function renderCharacterGallerySection(
  plugin,
  galleryHost,
  characters,
  vaultAnimeByTitle,
  uiState,
  options,
  onFullRefresh
) {
  galleryHost.empty();

  const bar = galleryHost.createDiv("curator-char-gallery-toolbar");
  const filtered = characters.filter((ch) => {
    if (uiState.activeTraitFilter) {
      const tf = uiState.activeTraitFilter;
      if (tf.category === "moe" && !(ch.moePoints || []).includes(tf.label)) return false;
      if (tf.category === "hair" && !String(ch.hairColor || "").includes(tf.label.replace(/发$/, ""))) return false;
      if (tf.category === "eye" && !String(ch.eyeColor || "").includes(tf.label.replace(/瞳$/, ""))) return false;
      if (tf.category === "cv" && !String(ch.cv || "").includes(tf.label)) return false;
    }
    const q = String(uiState.searchQuery || "").trim().toLowerCase();
    if (q) {
      const hay = [
        ch.name,
        ch.nameJp,
        ...(ch.aliases || []),
        ...(ch.moePoints || []),
        ch.hairColor,
        ch.eyeColor,
        ch.cv,
        ...(ch.appearances || []),
        ch.personalComment
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (uiState.gallerySortMode === "score-desc") {
      return (Number(b.favoriteScore) || 0) - (Number(a.favoriteScore) || 0);
    }
    if (uiState.gallerySortMode === "name-asc") {
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
    }
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  bar.createSpan({
    cls: "curator-char-gallery-count curator-mono",
    text: uiState.activeTraitFilter
      ? `筛选属性「${uiState.activeTraitFilter.label}」：共 ${filtered.length} 位角色`
      : `角色典藏画廊（共 ${filtered.length} 位）`
  });

  const sortWrap = bar.createDiv("curator-char-gallery-sort");

  // 检测既有重复/相似角色并提供一键合并清理按钮
  const dupeGroups = detectDuplicateCharacterGroups(characters);
  if (dupeGroups.length > 0) {
    const cleanDupeBtn = sortWrap.createEl("button", {
      cls: "curator-dl-mini-btn is-accent curator-char-dedupe-btn",
      text: `✨ 发现 ${dupeGroups.length} 组重复角色 · 一键合并清理`
    });
    cleanDupeBtn.title = `检测到馆藏中存在重复或相似译名的角色（如：${dupeGroups.map((g) => g.map((x) => x.name).join(" / ")).join("；")}），点击一键智能合并萌点并清理重复卡片`;
    cleanDupeBtn.onclick = async (e) => {
      e.preventDefault();
      await mergeAllDuplicateCharactersInGallery(plugin, onFullRefresh);
    };
  }

  [
    { id: "score-desc", label: "★ 喜爱度最高" },
    { id: "date-desc", label: "🕒 最近收录" },
    { id: "name-asc", label: "🔤 姓名排序" }
  ].forEach((mode) => {
    const b = sortWrap.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.gallerySortMode === mode.id ? "is-active" : ""}`,
      text: mode.label
    });
    b.onclick = (e) => {
      e.preventDefault();
      uiState.gallerySortMode = mode.id;
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        characters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };
  });

  const displayList = options.compactAlmanacMode ? filtered.slice(0, 6) : filtered;
  const grid = galleryHost.createDiv("curator-char-cards-grid");

  displayList.forEach((ch) => {
    const card = grid.createDiv("curator-char-card");
    card.dataset.charId = ch.id;
    const topFlex = card.createDiv("curator-char-card-top");

    const avatarBox = topFlex.createDiv("curator-char-card-avatar");
    const avaSrc = resolveCharacterAvatarSrc(plugin, ch, (newLocalResourceUrl) => {
      const existingImg = avatarBox.querySelector("img");
      if (existingImg && existingImg.isConnected) {
        existingImg.src = newLocalResourceUrl;
      }
    });
    if (avaSrc) {
      const img = avatarBox.createEl("img", {
        attr: { src: avaSrc, alt: ch.name }
      });
      img.src = avaSrc;
      img.alt = ch.name;
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        avatarBox.createSpan({
          cls: "curator-char-avatar-fallback",
          text: (ch.name || "角").slice(0, 1)
        });
      };
    } else {
      avatarBox.createSpan({
        cls: "curator-char-avatar-fallback",
        text: (ch.name || "角").slice(0, 1)
      });
    }

    const scoreBadge = avatarBox.createDiv("curator-char-score-badge curator-mono");
    scoreBadge.setText(`★ ${Number(ch.favoriteScore || 0).toFixed(1)}`);
    scoreBadge.title = "点击修改个人喜爱度评分 (1-10)";
    scoreBadge.onclick = async (ev) => {
      ev.preventDefault();
      uiState.editingCharId = uiState.editingCharId === ch.id ? null : ch.id;
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        characters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };

    const infoBox = topFlex.createDiv("curator-char-card-info");
    const nameRow = infoBox.createDiv("curator-char-card-namerow");
    const nameTitleWrap = nameRow.createDiv("curator-char-card-name-group");
    nameTitleWrap.createSpan({ cls: "curator-char-card-name", text: ch.name });
    if (ch.nameJp && ch.nameJp !== ch.name) {
      nameTitleWrap.createSpan({ cls: "curator-char-card-jp", text: ch.nameJp });
    }

    // 右上角克制直观的快速移除按钮
    const topRemoveBtn = nameRow.createEl("button", {
      cls: "curator-char-top-remove-btn",
      text: "×"
    });
    topRemoveBtn.title = `从典藏画廊中移除「${ch.name}」`;
    topRemoveBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterDeleteConfirmModal(plugin, ch, card, onFullRefresh);
    };

    // 外观与基础属性胶囊行
    const traitsRow = infoBox.createDiv("curator-char-card-traits");
    if (ch.hairColor) {
      traitsRow.createSpan({ cls: "curator-char-attr-chip is-hair", text: `🎨 ${ch.hairColor}` });
    }
    if (ch.eyeColor) {
      traitsRow.createSpan({ cls: "curator-char-attr-chip is-eye", text: `👁️ ${ch.eyeColor}` });
    }
    if (ch.cv) {
      traitsRow.createSpan({ cls: "curator-char-attr-chip is-cv", text: `🎙️ ${ch.cv}` });
    }
    if (ch.birthday) {
      traitsRow.createSpan({ cls: "curator-char-attr-chip", text: `🎂 ${ch.birthday}` });
    }

    // 出演作品行
    if (Array.isArray(ch.appearances) && ch.appearances.length > 0) {
      const appRow = infoBox.createDiv("curator-char-card-appearances");
      ch.appearances.slice(0, 2).forEach((appTitle) => {
        const matchedAnime = vaultAnimeByTitle.get(String(appTitle).trim().toLowerCase());
        const appChip = appRow.createEl(matchedAnime ? "button" : "span", {
          cls: `curator-char-anime-chip ${matchedAnime ? "is-in-vault" : ""}`,
          text: `🎬 《${appTitle}》`
        });
        if (matchedAnime?.file) {
          appChip.title = "点击打开馆藏中的该部动画笔记";
          appChip.onclick = async (ev) => {
            ev.preventDefault();
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(matchedAnime.file);
          };
        }
      });
    }

    // 萌娘百科萌点标签区
    const moeWrap = card.createDiv("curator-char-card-moepoints");
    if (Array.isArray(ch.moePoints) && ch.moePoints.length > 0) {
      ch.moePoints.forEach((mp) => {
        const isActive =
          uiState.activeTraitFilter &&
          uiState.activeTraitFilter.category === "moe" &&
          uiState.activeTraitFilter.label === mp;
        const tagBtn = moeWrap.createEl("button", {
          cls: `curator-char-moe-tag ${isActive ? "is-active" : ""}`,
          text: mp
        });
        tagBtn.title = `点击筛选所有带有「${mp}」萌点的角色`;
        tagBtn.onclick = (ev) => {
          ev.preventDefault();
          uiState.activeTraitFilter = isActive
            ? null
            : { key: `moe::${mp}`, label: mp, category: "moe" };
          onFullRefresh();
        };
      });
    } else {
      moeWrap.createSpan({
        cls: "curator-char-moe-empty",
        text: "暂无萌点标签 · 点击下方「✎ 评分/萌点」补充"
      });
    }

    if (ch.personalComment) {
      card.createDiv({
        cls: "curator-char-card-comment",
        text: `“${ch.personalComment}”`
      });
    }

    // 内联快速编辑区
    if (uiState.editingCharId === ch.id) {
      const editBox = card.createDiv("curator-char-inline-edit");
      const scoreEditRow = editBox.createDiv("curator-char-inline-row");
      scoreEditRow.createSpan({ text: "喜爱度评分 (1-10)：" });
      const sInput = scoreEditRow.createEl("input", {
        type: "number",
        cls: "curator-input curator-char-score-input"
      });
      sInput.min = "1";
      sInput.max = "10";
      sInput.step = "0.1";
      sInput.value = String(ch.favoriteScore ?? 9.0);

      const hairEditInput = scoreEditRow.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "发色（如：蓝发）"
      });
      hairEditInput.value = ch.hairColor || "";

      const eyeEditInput = scoreEditRow.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "瞳色（如：蓝瞳）"
      });
      eyeEditInput.value = ch.eyeColor || "";

      const moeEditInput = editBox.createEl("textarea", {
        cls: "curator-textarea curator-char-moe-textarea",
        placeholder: "萌点标签（以顿号或逗号分隔）"
      });
      moeEditInput.rows = 2;
      moeEditInput.value = (ch.moePoints || []).join("、");

      const cmtEditInput = editBox.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "心动寄语 / 印象短评…"
      });
      cmtEditInput.value = ch.personalComment || "";

      const editBtns = editBox.createDiv("curator-char-inline-btns");
      const syncMoeBtn = editBtns.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🔄 同步萌娘百科"
      });
      syncMoeBtn.onclick = async (ev) => {
        ev.preventDefault();
        syncMoeBtn.disabled = true;
        syncMoeBtn.textContent = "同步中…";
        try {
          const moeRes = await fetchMoegirlCharacterData([ch.name, ch.nameJp, ...(ch.aliases || [])]);
          if (moeRes.moePoints.length > 0) {
            const combined = Array.from(
              new Set([
                ...moeEditInput.value.split(/[、，,\/；;|]+/).map((s) => s.trim()).filter(Boolean),
                ...moeRes.moePoints
              ])
            );
            moeEditInput.value = combined.join("、");
          }
          if (moeRes.hairColor && !hairEditInput.value.trim()) hairEditInput.value = moeRes.hairColor;
          if (moeRes.eyeColor && !eyeEditInput.value.trim()) eyeEditInput.value = moeRes.eyeColor;
        } finally {
          syncMoeBtn.disabled = false;
          syncMoeBtn.textContent = "🔄 同步萌娘百科";
        }
      };

      const saveEditBtn = editBtns.createEl("button", {
        cls: "curator-dl-mini-btn is-accent",
        text: "✓ 保存修改"
      });
      saveEditBtn.onclick = async (ev) => {
        ev.preventDefault();
        const num = Number(sInput.value);
        ch.favoriteScore = Number.isFinite(num)
          ? Math.max(1, Math.min(10, Math.round(num * 10) / 10))
          : 9.0;
        ch.hairColor = hairEditInput.value.trim();
        ch.eyeColor = eyeEditInput.value.trim();
        ch.moePoints = Array.from(
          new Set(
            moeEditInput.value
              .split(/[、，,\/；;|\n]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          )
        );
        ch.personalComment = cmtEditInput.value.trim();
        if (resolveCharacterNoteFile(plugin, ch)) {
          await createOrUpdateCharacterMarkdownNote(plugin, ch);
        }
        uiState.editingCharId = null;
        await plugin.saveSettings();
        onFullRefresh();
        await plugin.refreshOpenDashboardViews();
      };
    }

    // 底部操作条：编辑萌点/评分、角色 Markdown 笔记、萌娘百科、Bangumi 角色页、独立移除按钮
    const footRow = card.createDiv("curator-char-card-footer");
    const editBtn = footRow.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.editingCharId === ch.id ? "is-active" : ""}`,
      text: "✎ 评分/萌点"
    });
    editBtn.onclick = (ev) => {
      ev.preventDefault();
      uiState.editingCharId = uiState.editingCharId === ch.id ? null : ch.id;
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        characters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };

    const existingNoteFile = resolveCharacterNoteFile(plugin, ch);
    const noteBtn = footRow.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: existingNoteFile ? "📄 打开角色笔记" : "📄 生成角色笔记"
    });
    noteBtn.onclick = async (ev) => {
      ev.preventDefault();
      const notePath = await createOrUpdateCharacterMarkdownNote(plugin, ch);
      await plugin.saveSettings();
      const file = plugin.app.vault.getAbstractFileByPath(notePath);
      if (file) {
        const leaf = plugin.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      }
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        characters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };

    const moeLinkBtn = footRow.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "↗ 萌娘百科"
    });
    moeLinkBtn.onclick = (ev) => {
      ev.preventDefault();
      const url = ch.moegirlUrl || `https://mzh.moegirl.org.cn/${encodeURIComponent(ch.name)}`;
      window.open(url, "_blank");
    };

    if (ch.bgmUrl) {
      const bgmBtn = footRow.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "↗ BGM"
      });
      bgmBtn.title = "打开 Bangumi 角色页";
      bgmBtn.onclick = (ev) => {
        ev.preventDefault();
        window.open(ch.bgmUrl, "_blank");
      };
    }

    // 显眼、克制的独立删除/移除按钮（支持分级确认是否一并清理关联角色笔记）
    const deleteCharBtn = footRow.createEl("button", {
      cls: "curator-dl-mini-btn curator-char-remove-btn",
      text: "🗑️ 移除"
    });
    deleteCharBtn.dataset.charAction = "delete";
    deleteCharBtn.title = existingNoteFile
      ? `移除角色「${ch.name}」（可选择一并清理关联角色笔记《${existingNoteFile.name}》）`
      : `从画廊中移除角色「${ch.name}」`;
    deleteCharBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterDeleteConfirmModal(plugin, ch, card, onFullRefresh);
    };
  });
}

module.exports = {
  searchBangumiCharacters,
  fetchBangumiCharacterDetail,
  parseBangumiCharacterHtml,
  parseMoegirlInfoboxHtml,
  fetchMoegirlCharacterData,
  fetchDualSourceCharacterProfile,
  normalizeCharacterNameForCompare,
  areCharactersSimilar,
  findSimilarCharactersInCollection,
  mergeCharacterRecords,
  detectDuplicateCharacterGroups,
  mergeAllDuplicateCharactersInGallery,
  openDuplicateCharacterConfirmModal,
  openCharacterDeleteConfirmModal,
  resolveCharacterNoteFile,
  resolveCharacterAvatarSrc,
  saveCharacterAvatarLocally,
  createOrUpdateCharacterMarkdownNote,
  computeMoeAttributeRanking,
  createPresetRoxyCharacterRecord,
  renderCharacterArchiveWorkspace
};
