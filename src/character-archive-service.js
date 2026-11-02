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
    id: "46465",
    name: "洛琪希·米格路迪亚",
    nameJp: "ロキシー・ミグルディア",
    gender: "女",
    birthday: "498年",
    cv: "小原好美",
    hairColor: "蓝发",
    eyeColor: "蓝瞳",
    appearances: ["无职转生 ～到了异世界就拿出真本事～", "无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: ["魔族", "魔法师", "萝莉", "合法萝莉", "蓝发", "蓝瞳", "三股辫", "呆毛", "帽娘", "教师", "师傅", "天然呆", "温柔", "勤勉"],
    avatar: "https://lain.bgm.tv/pic/crt/l/c1/30/46465_crt_144I9.jpg",
    infoTip: "性别：女 · 生日：498年 · CV：小原好美",
    summary: "米格路德族的水圣级魔术师。外表看似年幼少女，实则为人认真务实、礼貌温柔，是鲁迪乌斯的启蒙魔术恩师。"
  },
  {
    id: "46465",
    name: "洛琪希·米格路迪亚·格雷拉特",
    nameJp: "ロキシー・ミグルディア・グレイラット",
    gender: "女",
    birthday: "498年",
    cv: "小原好美",
    hairColor: "蓝发",
    eyeColor: "蓝瞳",
    appearances: ["无职转生 II ～到了异世界就拿出真本事～"],
    moePoints: ["魔族", "魔法师", "水王级魔术师", "人妻", "蓝发", "蓝瞳", "三股辫", "帽娘", "教师", "师傅"],
    avatar: "https://lain.bgm.tv/pic/crt/l/c1/30/46465_crt_144I9.jpg",
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
 * 移除参考角标、Ruby 注音假名隐藏括号及脚本样式
 */
function stripReferenceAndNoiseHtml(html) {
  return String(html || "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, "")
    .replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, "")
    .replace(/<s\b[^>]*>[\s\S]*?<\/s>/gi, "")
    .replace(/<span\b[^>]*class="[^"]*\btemplate-ruby-hidden\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
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

  const isRoxyName = (c) =>
    /洛琪希|ロキシー|roxy/i.test(String(c?.name || "")) ||
    /洛琪希|ロキシー|roxy/i.test(String(c?.nameJp || ""));
  if (isRoxyName(charA) !== isRoxyName(charB)) {
    return { similar: false, reason: "" };
  }

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
    hasCustomAvatar: Boolean(target.hasCustomAvatar || incoming.hasCustomAvatar),
    portraitFrame: incoming.portraitFrame || target.portraitFrame || undefined,
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
 * 常用角色单名、简中译名、别名与昵称扩展映射表
 * 解决 Bangumi 主词条名为假名/日文汉字（如「緒山まひろ」「後藤ひとり」）时搜索单名「真寻」或昵称无法命中的问题
 */
const CHARACTER_SEARCH_ALIAS_MAP = {
  "真寻": ["绪山真寻", "緒山まひろ", "八坂真寻"],
  "绪山真寻": ["緒山まひろ", "绪山真寻"],
  "美波里": ["绪山美波里", "緒山みはり"],
  "枫": ["穗月枫", "穂月かえで", "梓川枫"],
  "桃": ["穗月桃", "穂月もみじ", "千代田桃"],
  "朝日": ["樱花朝日", "桜花あさひ"],
  "美代": ["室崎美代", "室崎みよ"],
  "那由多": ["十河那由多", "十河なゆた"],
  "后藤独": ["后藤一里", "後藤ひとり"],
  "波奇": ["后藤一里", "後藤ひとり"],
  "波奇酱": ["后藤一里", "後藤ひとり"],
  "一里": ["后藤一里", "後藤ひとり"],
  "虹夏": ["伊地知虹夏"],
  "凉": ["山田凉", "山田リョウ"],
  "郁代": ["喜多郁代"],
  "喜多": ["喜多郁代"],
  "祥子": ["丰川祥子", "豊川祥子"],
  "大祥老师": ["丰川祥子", "豊川祥子"],
  "小祥": ["丰川祥子", "豊川祥子"],
  "睦": ["若叶睦", "若葉睦"],
  "小睦": ["若叶睦", "若葉睦"],
  "初华": ["三角初华", "三角初華"],
  "海铃": ["八幡海铃", "八幡海鈴"],
  "喵梦": ["祐天寺若麦", "祐天寺にゃむ"],
  "若麦": ["祐天寺若麦", "祐天寺にゃむ"],
  "灯": ["高松灯", "高松燈"],
  "爱音": ["千早爱音", "千早愛音"],
  "素世": ["长崎素世", "長崎そよ"],
  "爽世": ["长崎素世", "長崎そよ"],
  "立希": ["椎名立希"],
  "乐奈": ["要乐奈", "要楽奈"],
  "安达": ["安达樱", "安達桜", "安达垣爱姬"],
  "安达樱": ["安達桜", "安达樱"],
  "岛村": ["岛村抱月", "島村抱月"],
  "抱月": ["岛村抱月", "島村抱月"],
  "玲奈子": ["甘织玲奈子", "甘織れな子"],
  "真唯": ["王塚真唯"],
  "紫阳花": ["濑名紫阳花", "瀬名紫陽花"],
  "纱月": ["琴纱月", "琴紗月"],
  "香穗": ["小柳香穗", "小柳香穂"],
  "千束": ["锦木千束", "錦木千束"],
  "泷奈": ["井之上泷奈", "井ノ上たきな"],
  "洛琪希": ["洛琪希·米格路迪亚", "ロキシー・ミグルディア"],
  "希露菲": ["希露菲叶特", "シルフィエット"],
  "艾莉丝": ["艾莉丝·伯雷亚斯·格雷拉特", "エリス・ボレアス・グレイラット"],
  "鲁迪": ["鲁迪乌斯·格雷拉特", "ルーデウス・グレイラット"],
  "爱蜜莉雅": ["爱蜜莉雅", "エミリア"],
  "艾米莉亚": ["爱蜜莉雅", "エミリア"],
  "emt": ["爱蜜莉雅", "エミリア"],
  "雷姆": ["雷姆", "レム"],
  "拉姆": ["拉姆", "ラム"],
  "碧翠丝": ["碧翠丝", "ベアトリス"],
  "贝蒂": ["碧翠丝", "ベアトリス"],
  "芙莉莲": ["芙莉莲", "フリーレン"],
  "费伦": ["费伦", "フェルン"],
  "菲伦": ["费伦", "フェルン"],
  "修塔尔克": ["修塔尔克", "シュタルク"],
  "辛美尔": ["辛美尔", "ヒンメル"],
  "欣梅尔": ["辛美尔", "ヒンメル"],
  "亚丝娜": ["结城明日奈", "結城明日奈"],
  "桐人": ["桐谷和人", "桐ヶ谷和人"],
  "炮姐": ["御坂美琴"],
  "美琴": ["御坂美琴"],
  "狂三": ["时崎狂三"],
  "雪乃": ["雪之下雪乃"],
  "结衣": ["由比滨结衣"],
  "一色": ["一色彩羽"],
  "诗羽": ["霞之丘诗羽"],
  "英梨梨": ["泽村·斯潘塞·英梨梨"],
  "麻衣": ["樱岛麻衣", "桜島麻衣"],
  "真昼": ["椎名真昼", "伊波真昼"],
  "有希": ["周防有希", "长门有希"],
  "艾莉": ["艾莉莎·米哈伊罗夫娜·九条"],
  "玛夏": ["玛利亚·米哈伊罗夫娜·九条"],
  "佳奈": ["有马佳奈"],
  "露比": ["星野露比"],
  "阿夸": ["星野爱久爱海"],
  "辉夜": ["四宫辉夜"],
  "千花": ["藤原千花"],
  "早坂": ["早坂爱"],
  "红莉栖": ["牧濑红莉栖", "牧瀬紅莉栖"],
  "助手": ["牧濑红莉栖", "牧瀬紅莉栖"],
  "真由理": ["椎名真由理", "椎名まゆり"]
};

/**
 * 解析并扩展角色搜索关键词：
 * 结合内置别名/单名映射表与萌娘百科全文搜索 API（如「真寻」→「绪山真寻」），补全完整角色名供 Bangumi 并发检索
 */
async function resolveExpandedCharacterSearchQueries(rawQuery) {
  const q = String(rawQuery || "").trim();
  if (!q) return [];
  const qLower = q.toLowerCase();
  const expanded = [];
  const pushUnique = (val) => {
    const clean = String(val || "")
      .replace(/（[^）]*）|\([^)]*\)/g, "")
      .trim();
    if (
      clean &&
      clean.length >= 2 &&
      clean.length <= 24 &&
      !expanded.includes(clean) &&
      !/(?:列表|模板|用语|歌曲|音乐|专辑|单曲|消歧义|登场角色|章节)$/.test(clean)
    ) {
      expanded.push(clean);
    }
  };

  pushUnique(q);

  if (CHARACTER_SEARCH_ALIAS_MAP[q]) {
    CHARACTER_SEARCH_ALIAS_MAP[q].forEach(pushUnique);
  }
  if (CHARACTER_SEARCH_ALIAS_MAP[qLower]) {
    CHARACTER_SEARCH_ALIAS_MAP[qLower].forEach(pushUnique);
  }

  for (const [aliasKey, targets] of Object.entries(CHARACTER_SEARCH_ALIAS_MAP)) {
    if (aliasKey.length >= 2 && (aliasKey.includes(q) || targets.some((t) => t.includes(q)))) {
      targets.forEach(pushUnique);
    }
  }

  // 若输入的是短单名或昵称且尚未扩展出足够候选，通过萌娘百科全文搜索快速反查含该名/别名的角色全名
  if (expanded.length <= 2 && q.length >= 1 && q.length <= 8) {
    try {
      const cleanUa = getCleanBrowserUserAgent();
      const srUrl = `https://moegirl.uk/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json`;
      const srResp = await requestUrlWithTimeout(
        {
          url: srUrl,
          method: "GET",
          headers: {
            "User-Agent": cleanUa,
            "Accept": "application/json,text/plain,*/*"
          },
          throw: false
        },
        2200
      );
      const searchItems = srResp?.json?.query?.search;
      if (Array.isArray(searchItems)) {
        for (const item of searchItems) {
          if (item && item.title && item.title !== q) {
            pushUnique(item.title);
          }
        }
      }
    } catch (_) {}
  }

  return expanded.slice(0, 4);
}

/**
 * 搜索 Bangumi 角色
 * 支持按单名（如「真寻」→「绪山真寻」）、简体中文名、日文原名、别名与昵称多维并发检索与相关性重排
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
            aliases: detail.aliases || [],
            avatar: detail.avatar || "",
            summary: detail.summary || "",
            infoTip: [detail.gender, detail.birthday, detail.cv].filter(Boolean).join(" · ")
          }
        ];
      }
    } catch (e) {}
  }

  const expandedQueries = await resolveExpandedCharacterSearchQueries(q);
  const queryNorms = expandedQueries.map((s) => normalizeCharacterNameForCompare(s)).filter(Boolean);
  const qNorm = normalizeCharacterNameForCompare(q);

  const parseV0CharacterItem = (item) => {
    let nameCn = "";
    let gender = "";
    let birthday = "";
    const aliases = [];
    if (Array.isArray(item.infobox)) {
      for (const row of item.infobox) {
        if (!row || !row.key) continue;
        const rawVals =
          typeof row.value === "string"
            ? [row.value]
            : Array.isArray(row.value)
            ? row.value.map((v) => (typeof v === "string" ? v : v?.v || "")).filter(Boolean)
            : [];
        const valStr = rawVals.join(" / ").trim();
        if (row.key === "简体中文名" && !nameCn && valStr) nameCn = rawVals[0].trim();
        if (
          (row.key === "别名" ||
            row.key === "昵称" ||
            row.key === "称呼" ||
            row.key === "其他名称" ||
            row.key === "罗马音" ||
            row.key === "纯假名") &&
          rawVals.length > 0
        ) {
          for (const rv of rawVals) {
            const cleanAlias = String(rv || "").trim();
            if (cleanAlias && !aliases.includes(cleanAlias)) aliases.push(cleanAlias);
          }
        }
        if (row.key === "性别" && !gender && valStr) gender = valStr;
        if (row.key === "生日" && !birthday && valStr) birthday = valStr;
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

    const aliasHint =
      aliases.length > 0
        ? aliases
            .filter((a) => a !== nameCn && a !== item.name)
            .slice(0, 2)
            .join(" / ")
        : "";

    return {
      id: String(item.id),
      name: nameCn || item.name || "",
      nameJp: item.name || "",
      aliases,
      avatar: avatar.startsWith("//") ? "https:" + avatar : avatar,
      summary: String(item.summary || "").replace(/\s+/g, " ").trim().slice(0, 90),
      infoTip: [
        finalGender ? `性别：${finalGender}` : "",
        finalBirth ? `生日：${finalBirth}` : "",
        aliasHint ? `别名：${aliasHint}` : ""
      ]
        .filter(Boolean)
        .join(" · ")
    };
  };

  const scoreCandidate = (cand, queryIdx, itemIdx) => {
    const nCn = normalizeCharacterNameForCompare(cand.name);
    const nJp = normalizeCharacterNameForCompare(cand.nameJp);
    const nAliases = (cand.aliases || []).map((a) => normalizeCharacterNameForCompare(a)).filter(Boolean);
    const allNorms = [nCn, nJp, ...nAliases].filter(Boolean);

    let score = Math.max(0, 120 - queryIdx * 18 - itemIdx * 4);
    if (cand.avatar) score += 35;
    if (cand.summary) score += 15;

    // 1. 与用户原始输入词直接比对
    if (qNorm) {
      if (nCn === qNorm || nJp === qNorm || nAliases.includes(qNorm)) {
        score += 1200;
      } else if (
        nCn.endsWith(qNorm) ||
        nCn.startsWith(qNorm) ||
        nAliases.some((a) => a.endsWith(qNorm) || a.startsWith(qNorm))
      ) {
        score += 860;
      } else if (nCn.includes(qNorm) || nAliases.some((a) => a.includes(qNorm))) {
        score += 560;
      } else if (nJp.includes(qNorm)) {
        score += 320;
      }
    }

    // 2. 与扩展出的全名/原名（如「真寻」扩展出的「绪山真寻」「緒山まひろ」）比对
    for (let i = 1; i < queryNorms.length; i++) {
      const expNorm = queryNorms[i];
      if (!expNorm) continue;
      if (allNorms.includes(expNorm)) {
        score += Math.max(450, 920 - i * 80);
        break;
      }
    }

    return score;
  };

  // 1. 并发调用 Bangumi v0 API 检索原始词与扩展全名词
  try {
    const searchPromises = expandedQueries.map((kw, qIdx) =>
      requestUrlWithTimeout(
        {
          url: `https://api.bgm.tv/v0/search/characters?limit=${qIdx === 0 ? 16 : 8}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": BGM_USER_AGENT
          },
          body: JSON.stringify({ keyword: kw }),
          throw: false
        },
        5000
      )
        .then((resp) => ({ qIdx, data: resp?.json?.data }))
        .catch(() => ({ qIdx, data: null }))
    );

    const responses = await Promise.all(searchPromises);
    const mergedMap = new Map();

    for (const { qIdx, data } of responses) {
      if (!Array.isArray(data)) continue;
      data.forEach((rawItem, itemIdx) => {
        if (!rawItem || !rawItem.id) return;
        const parsed = parseV0CharacterItem(rawItem);
        const sc = scoreCandidate(parsed, qIdx, itemIdx);
        const existing = mergedMap.get(parsed.id);
        if (!existing || sc > existing.score) {
          mergedMap.set(parsed.id, { item: parsed, score: sc });
        }
      });
    }

    if (mergedMap.size > 0) {
      return Array.from(mergedMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((entry) => entry.item);
    }
  } catch (err) {
    console.warn("[BangumiManager] v0 character search fallback:", err);
  }

  // 2. 网页搜索回退：https://bgm.tv/mono_search/{keyword}?cat=crt
  try {
    const htmlQueries = expandedQueries.slice(0, 2);
    const htmlResults = [];
    const seenIds = new Set();
    for (const kw of htmlQueries) {
      const searchUrl = `https://bgm.tv/mono_search/${encodeURIComponent(kw)}?cat=crt`;
      const resp = await requestUrlWithTimeout(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            "User-Agent": BGM_USER_AGENT,
            "Cookie": "chii_searchDateLine=" + Math.floor(Date.now() / 1000)
          },
          throw: false
        },
        4500
      );
      const html = resp?.text || "";
      const blockRegex = /<div class="light_odd[\s\S]*?<a href="\/character\/(\d+)"[^>]*class="l"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?=<div class="light_odd|<div class="section_line|$)/gi;
      let m;
      while ((m = blockRegex.exec(html)) !== null) {
        const id = m[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const rawTitle = htmlToPlainText(m[2]);
        const block = m[0];
        const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
        let avatar = imgMatch ? imgMatch[1].trim() : "";
        if (avatar.startsWith("//")) avatar = "https:" + avatar;
        avatar = avatar.replace(/\/g\/|\/s\/|\/m\//, "/l/");
        const tipMatch = block.match(/<div class="prsn_info"[^>]*>([\s\S]*?)<\/div>/i);
        const infoTip = tipMatch ? htmlToPlainText(tipMatch[1]) : "";
        const parts = rawTitle.split("/").map((s) => s.trim()).filter(Boolean);
        htmlResults.push({
          id,
          name: parts[parts.length - 1] || rawTitle,
          nameJp: parts[0] || rawTitle,
          aliases: [],
          avatar,
          summary: "",
          infoTip
        });
      }
    }
    if (htmlResults.length > 0) return htmlResults;
  } catch (err) {
    console.warn("[BangumiManager] HTML character search failed:", err);
  }

  // 3. 内置高频角色索引兜底（当外部网络不可达时依然返回匹配角色卡片）
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
    }, 4500);
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
  const builtinMatchesFetchedName =
    builtin &&
    ((!result.nameCn && !result.nameJp) ||
      normalizeCharacterNameForCompare(result.nameCn || "") === normalizeCharacterNameForCompare(builtin.name) ||
      normalizeCharacterNameForCompare(result.nameJp || "") === normalizeCharacterNameForCompare(builtin.nameJp));
  if (builtinMatchesFetchedName) {
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
 * 从萌娘百科 HTML 中提取所有资料栏键值对行（兼容新版 div.moe-infobox.infobox3 弹性盒布局、经典 table/tr/th/td 布局与 Portable Infobox）
 */
function extractMoegirlInfoboxRows(rawHtml) {
  const rows = [];
  const seenKeys = new Set();
  const pushRow = (labelHtml, valueHtml) => {
    const label = htmlToPlainText(labelHtml).replace(/[:：\s]/g, "");
    if (!label || label.length > 16 || !valueHtml) return;
    if (label === "基本资料" || label === "亲属或相关人" || label === "相关人物" || label === "角色信息") return;
    const dedupeKey = `${label}::${valueHtml.slice(0, 120)}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    rows.push({ label, valueHtml });
  };

  // 1. 优先使用浏览器原生 DOMParser 精确遍历 DOM 树（完全免疫嵌套 div 标签干扰）
  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");
      const containers = Array.from(
        doc.querySelectorAll(".moe-infobox, .infobox3, .infotemplatebox, table.infobox, .portable-infobox")
      );
      const roots = containers.length > 0 ? containers : [doc.body].filter(Boolean);

      for (const root of roots) {
        // 1A. 经典 <tr><th>Label</th><td>Value</td></tr>
        const trList = root.querySelectorAll("tr");
        for (const tr of trList) {
          const cells = Array.from(tr.children).filter(
            (el) => el.tagName === "TH" || el.tagName === "TD"
          );
          if (cells.length >= 2) {
            pushRow(cells[0].innerHTML, cells[1].innerHTML);
          }
        }

        // 1B. 新版萌娘百科 div.moe-infobox.infobox3 Flexbox 行（<div style="display: flex..."><div ...><span>标签</span></div><div ...>内容</div></div>）
        const divList = root.querySelectorAll("div");
        for (const div of divList) {
          if (
            div.classList.contains("Tabs") ||
            div.classList.contains("TabLabel") ||
            div.classList.contains("TabContent")
          ) {
            continue;
          }
          const children = Array.from(div.children);
          if (children.length === 2 && children[0].tagName === "DIV" && children[1].tagName === "DIV") {
            const firstChild = children[0];
            const secondChild = children[1];
            if (
              firstChild.classList.contains("TabLabel") ||
              secondChild.classList.contains("TabContent") ||
              firstChild.querySelector(".TabLabelText, img")
            ) {
              continue;
            }
            const inlineStyle = (div.getAttribute("style") || "").toLowerCase();
            const firstStyle = (firstChild.getAttribute("style") || "").toLowerCase();
            const isFlexRow =
              inlineStyle.includes("display: flex") ||
              inlineStyle.includes("display:flex") ||
              firstStyle.includes("flex:");
            const labelCandidate = (firstChild.textContent || "").replace(/[:：\s]/g, "");
            if (isFlexRow || (labelCandidate.length >= 2 && labelCandidate.length <= 8)) {
              pushRow(firstChild.innerHTML, secondChild.innerHTML);
            }
          }
        }

        // 1C. Portable Infobox (.pi-item.pi-data)
        const piItems = root.querySelectorAll(".pi-item.pi-data");
        for (const item of piItems) {
          const lEl = item.querySelector(".pi-data-label");
          const vEl = item.querySelector(".pi-data-value");
          if (lEl && vEl) {
            pushRow(lEl.innerHTML, vEl.innerHTML);
          }
        }
      }
    } catch (domErr) {
      // ignore and fall through to regex parser
    }
  }

  // 2. 正则与结构切分双保险解析（支持无 DOMParser 的 Node 环境及任意 HTML 片段）
  let scopeHtml = rawHtml;
  const primaryBoxIdx = rawHtml.search(
    /class="[^"]*\b(?:moe-infobox|infobox3|infotemplatebox|portable-infobox)\b[^"]*"/i
  );
  const infoboxStart =
    primaryBoxIdx >= 0
      ? primaryBoxIdx
      : rawHtml.search(/<table\b[^>]*class="[^"]*\binfobox\b[^"]*"/i);
  if (infoboxStart >= 0) {
    scopeHtml = rawHtml.slice(infoboxStart, infoboxStart + 120000);
  }

  // 2A. 匹配 <tr> 行
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(scopeHtml)) !== null) {
    const rowHtml = trMatch[1];
    const cellMatch =
      rowHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i) ||
      rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (cellMatch) {
      pushRow(cellMatch[1], cellMatch[2]);
    }
  }

  // 2B. 匹配新版 infobox3 的 <div style="display: flex..."> 行
  const flexBlocks = scopeHtml.split(/<div\b[^>]*style="[^"]*display\s*:\s*flex[^"]*"[^>]*>/i);
  for (let i = 1; i < flexBlocks.length; i++) {
    const seg = flexBlocks[i];
    // 第一个子 div 是 label（如 <div style="...flex: 0 0 5em..."><span>萌点</span></div>），紧跟第二个子 div 是 value
    const cellPairMatch = seg.match(
      /^\s*(?:<div\b[^>]*>)?\s*(?:<span\b[^>]*>)?\s*([^<]{1,16}?)\s*(?:<\/span>)?\s*<\/div>\s*<div\b[^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>|<div\b[^>]*style="[^"]*margin\s*:\s*3px\s+0|$)/i
    );
    if (cellPairMatch) {
      pushRow(cellPairMatch[1], cellPairMatch[2]);
    }
  }

  return rows;
}

/**
 * 解析萌娘百科角色资料栏 HTML（全面兼容新版 div.moe-infobox.infobox3 与传统 table.infobox）
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
    translatedName: "",
    nicknames: [],
    birthday: "",
    constellation: "",
    height: "",
    weight: "",
    bwh: "",
    bloodType: "",
    group: "",
    imageUrl: ""
  };

  const rawHtml = String(html || "");
  if (!rawHtml) return parsed;

  let scopeHtml = rawHtml;
  const primaryBoxIdx = rawHtml.search(
    /class="[^"]*\b(?:moe-infobox|infobox3|infotemplatebox|portable-infobox)\b[^"]*"/i
  );
  const infoboxStart =
    primaryBoxIdx >= 0
      ? primaryBoxIdx
      : rawHtml.search(/<table\b[^>]*class="[^"]*\binfobox\b[^"]*"/i);
  if (infoboxStart >= 0) {
    scopeHtml = rawHtml.slice(infoboxStart, infoboxStart + 120000);
  }

  // 提取立绘图片（支持新版 storage.moegirl.org.cn、传统 img.moegirl.org.cn 与 moegirl.uk 相对路径 /images/...）
  const imgMatch =
    scopeHtml.match(/class="[^"]*TabContentText\s+selected[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
    scopeHtml.match(/class="[^"]*TabContentText[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
    scopeHtml.match(/class="[^"]*infobox-image[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
    scopeHtml.match(/<img[^>]+src="((?:https?:\/\/(?:storage|img)\.moegirl\.org\.cn|\/images)\/[^"]+)"/i);
  if (imgMatch && imgMatch[1]) {
    let imgUrl = decodeHtmlEntities(imgMatch[1].trim());
    if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
    else if (imgUrl.startsWith("/")) imgUrl = "https://moegirl.uk" + imgUrl;
    parsed.imageUrl = imgUrl;
  }

  const rows = extractMoegirlInfoboxRows(rawHtml);
  for (const row of rows) {
    const label = row.label;
    const valueHtml = stripReferenceAndNoiseHtml(row.valueHtml);
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
          !tagText.includes("查") &&
          !tagText.includes("页面不存在")
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

      parsed.moePoints = Array.from(new Set([...parsed.moePoints, ...moeSet]));
      parsed.heimuMoePoints = Array.from(new Set([...parsed.heimuMoePoints, ...heimuSet]));
      continue;
    }

    const plainVal = htmlToPlainText(valueHtml);
    if (!plainVal) continue;

    if (label === "发色" || label === "头发颜色" || label === "发色/瞳色") {
      parsed.found = true;
      parsed.hairColor = extractCleanTraitText(valueHtml, plainVal).replace(/髮/g, "发");
    } else if (label === "瞳色" || label === "眼睛颜色") {
      parsed.found = true;
      parsed.eyeColor = extractCleanTraitText(valueHtml, plainVal);
    } else if (label === "本名" || label === "全名" || label === "原名") {
      parsed.found = true;
      // 提取括号内的罗马音或英文名放入 nicknames，保留干净的日文/原名主干
      const romajiMatches = plainVal.match(/[（(]([^）)]+)[）)]/g);
      if (romajiMatches) {
        for (const rm of romajiMatches) {
          const inner = rm.slice(1, -1).trim();
          if (inner && inner.length >= 2) parsed.nicknames.push(inner);
        }
      }
      const cleanReal = plainVal
        .split(/\s*\/\s*/)[0]
        .replace(/[（(][^）)]*[）)]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      parsed.realName = cleanReal || plainVal;
    } else if (label === "译名" || label === "中文名" || label === "简体中文名") {
      parsed.found = true;
      const transParts = plainVal
        .replace(/（[^）]*）|\([^)]*\)/g, "")
        .split(/[、，,\/；;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (transParts.length > 0) {
        parsed.translatedName = transParts[0];
        if (transParts.length > 1) {
          parsed.nicknames.push(...transParts.slice(1));
        }
      }
    } else if (label === "别号" || label === "别名" || label === "昵称" || label === "称号") {
      parsed.found = true;
      const nicks = plainVal
        .replace(/（[^）]*）|\([^)]*\)/g, "")
        .split(/[、，,\/；;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      parsed.nicknames.push(...nicks);
    } else if (label === "声优" || label === "配音" || label === "CV") {
      parsed.found = true;
      const cvParts = plainVal
        .replace(/（[^）]*）|\([^)]*\)/g, "")
        .split(/\s*\/\s*|[、，,；;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      parsed.cv = Array.from(new Set(cvParts)).join(" / ") || plainVal;
    } else if (label === "生日" || label === "出生日期") {
      parsed.found = true;
      parsed.birthday = extractCleanTraitText(valueHtml, plainVal).replace(/^Category:/i, "");
    } else if (label === "血型") {
      parsed.found = true;
      parsed.bloodType = extractCleanTraitText(valueHtml, plainVal).replace(/^Category:/i, "");
    } else if (label === "星座") {
      parsed.found = true;
      parsed.constellation = extractCleanTraitText(valueHtml, plainVal).replace(/^Category:/i, "");
    } else if (label === "身高") {
      parsed.found = true;
      parsed.height = plainVal;
    } else if (label === "体重") {
      parsed.found = true;
      parsed.weight = plainVal;
    } else if (label === "三围" || label === "BWH") {
      parsed.found = true;
      parsed.bwh = plainVal;
    } else if (label === "所属团体" || label === "出身地区") {
      parsed.found = true;
      if (!parsed.group) parsed.group = plainVal;
    }
  }

  parsed.nicknames = Array.from(new Set(parsed.nicknames)).slice(0, 10);
  return parsed;
}

function extractCleanTraitText(valueHtml, fallbackPlain) {
  const anchors = [];
  const aRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(valueHtml)) !== null) {
    const t = htmlToPlainText(m[1]).replace(/^Category:/i, "").trim();
    if (t && t.length <= 12) anchors.push(t);
  }
  if (anchors.length > 0) {
    return Array.from(new Set(anchors)).join(" / ");
  }
  return String(fallbackPlain || "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .trim();
}

/**
 * 扩展候选角色名称列表（处理复合译名主干、去除日文名中间空格等）
 */
function expandMoegirlCandidateNames(candidateNames = []) {
  const rawList = (Array.isArray(candidateNames) ? candidateNames : [candidateNames])
    .map((n) => String(n || "").trim())
    .filter(Boolean);

  const expanded = [];
  const shortStems = [];
  const normalizeEntry = (val) => {
    const clean = String(val || "")
      .replace(/^(?:https?:\/\/)?(?:(?:mobile|mzh|zh)\.)?moegirl\.(?:org\.cn|uk)\/(?:zh-cn\/)?/i, "")
      .trim();
    if (!clean) return "";
    let decoded = clean;
    try {
      if (/%[0-9A-Fa-f]{2}/.test(clean)) {
        decoded = decodeURIComponent(clean);
      }
    } catch (_) {}
    return decoded.trim();
  };

  const addUnique = (val, toShortList = false) => {
    const decoded = normalizeEntry(val);
    if (!decoded) return;
    if (toShortList) {
      if (!expanded.includes(decoded) && !shortStems.includes(decoded)) {
        shortStems.push(decoded);
      }
    } else if (!expanded.includes(decoded)) {
      expanded.push(decoded);
    }
  };

  for (const n of rawList) {
    addUnique(n, false);
    // Bangumi 的日文角色名常带空格（如「甘織 れな子」），而萌娘百科词条名通常无空格（「甘織れな子」）
    const noSpace = n.replace(/[\s\u3000]+/g, "");
    if (noSpace.length >= 2 && noSpace !== n) {
      addUnique(noSpace, false);
    }
    if (/[·・•‧]/.test(n)) {
      const parts = n.split(/[·・•‧]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        addUnique(parts.slice(0, 2).join("·"), false);
      }
      if (parts[0] && parts[0].length >= 2) {
        addUnique(parts[0], true);
      }
    }
  }

  for (const s of shortStems) {
    if (!expanded.includes(s)) expanded.push(s);
  }
  return expanded;
}

/**
 * 从萌娘百科消歧义页（如「艾米莉亚」「雷姆」「拉姆」）中智能提取候选角色词条名
 * 结合 Bangumi 出演作品列表（appearances）加权匹配最准确的目标词条（如「爱蜜莉雅」「雷姆(Re:从零开始的异世界生活)」）
 */
function extractDisambiguationCandidates(rawHtml, appearances = [], candidateNames = []) {
  const html = String(rawHtml || "");
  if (!html) return [];

  const normText = (s) =>
    String(s || "")
      .replace(/[：:·・•‧\-_~\s\u3000《》〈〉「」『』()（）]+/g, "")
      .toLowerCase();

  const appStems = [];
  for (const app of Array.isArray(appearances) ? appearances : []) {
    const full = normText(app);
    if (full.length >= 2) appStems.push(full);
    const shortPart = normText(String(app || "").split(/[～~／/－\-—\s]+/)[0]);
    if (shortPart.length >= 2 && !appStems.includes(shortPart)) {
      appStems.push(shortPart);
    }
  }

  const candNorms = new Set(
    (Array.isArray(candidateNames) ? candidateNames : [])
      .map((c) => normText(c))
      .filter((c) => c.length >= 2)
  );

  const scoredMap = new Map();
  const addCandidate = (title, score) => {
    const cleanTitle = decodeHtmlEntities(title)
      .replace(/（页面不存在）|\(页面不存在\)/g, "")
      .trim();
    if (!cleanTitle || cleanTitle.length > 48) return;
    if (/^(?:Category|Template|Help|File|Special|Talk|User|萌娘百科|模块|分类|模板):/i.test(cleanTitle)) return;
    const prev = scoredMap.get(cleanTitle);
    if (prev === undefined || score > prev) {
      scoredMap.set(cleanTitle, score);
    }
  };

  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  let liIdx = 0;
  while ((m = liRegex.exec(html)) !== null) {
    const liHtml = m[1];
    if (/toclevel-|cite_note/i.test(m[0])) continue;
    const plainLi = htmlToPlainText(liHtml);
    if (!plainLi) continue;

    const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let am;
    let firstValidTitle = "";
    let isBoldLink = false;
    while ((am = aRegex.exec(liHtml)) !== null) {
      const attrs = am[1] || "";
      const inner = am[2] || "";
      if (/\bclass="[^"]*\bnew\b/i.test(attrs) || /redlink=1|action=edit/i.test(attrs)) {
        continue;
      }
      const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
      const href = hrefMatch ? hrefMatch[1] : "";
      if (!href || href.startsWith("#") || /^https?:\/\//i.test(href)) continue;
      const titleMatch = attrs.match(/\btitle="([^"]+)"/i);
      const candTitle = titleMatch ? titleMatch[1] : htmlToPlainText(inner);
      if (!candTitle || candTitle.includes("页面不存在")) continue;
      if (/^(?:Category|Template|Help|File|Special|Talk|萌娘百科):/i.test(candTitle)) continue;

      firstValidTitle = candTitle;
      const beforeIdx = am.index;
      const prefix = liHtml.slice(Math.max(0, beforeIdx - 24), beforeIdx);
      isBoldLink = /<(?:b|strong)\b[^>]*>\s*$/i.test(prefix);
      break;
    }

    if (!firstValidTitle) continue;
    liIdx += 1;

    let score = 10 + Math.max(0, 10 - liIdx);
    if (isBoldLink) score += 15;
    if (/登场角色|主角|主人公|登场人物|角色/.test(plainLi)) score += 25;
    if (plainLi.includes("《") && plainLi.includes("》")) score += 15;

    const normLi = normText(plainLi);
    const normTitle = normText(firstValidTitle);
    for (const stem of appStems) {
      if (normLi.includes(stem) || normTitle.includes(stem)) {
        score += 120;
        break;
      }
    }
    if (candNorms.has(normTitle)) {
      score += 60;
    }
    if (/代言人|歌曲|音乐|专辑|单曲|实况主|UP主|武器|道具/.test(plainLi)) {
      score -= 25;
    }

    addCandidate(firstValidTitle, score);
  }

  return Array.from(scoredMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);
}

/**
 * 严格判定响应是否为真实的 Cloudflare 人机验证拦截页（零误检：排除普通 404/消歧义页/JSON 响应/超时）
 */
function isCloudflareChallengeHtml(status, rawText) {
  const code = Number(status || 0);
  if (code !== 403 && code !== 503 && code !== 429) return false;
  const text = String(rawText || "");
  if (!text || text.trim().startsWith("{")) return false;
  const hasCfChallengeMarker =
    text.includes("/cdn-cgi/challenge-platform/") ||
    text.includes("cf-browser-verification") ||
    text.includes("window._cf_chl_opt") ||
    text.includes("cf-turnstile") ||
    text.includes("challenges.cloudflare.com/turnstile") ||
    text.includes('id="challenge-stage"') ||
    text.includes('id="cf-challenge-running"');
  const hasChallengeTitle =
    /<title>\s*(?:Just a moment|请稍候|Attention Required|安全检查)/i.test(text);
  return Boolean(hasCfChallengeMarker && (hasChallengeTitle || /cloudflare/i.test(text)));
}

/**
 * 获取与当前 Obsidian Electron 内核真实 Chromium 版本严格一致的纯净浏览器 User-Agent
 * 关键修复：严禁硬编码旧版 Chrome/126.0.0.0！因为 Cloudflare Turnstile 会在跨域 iframe 中比对
 * HTTP User-Agent 与 Sec-CH-UA (navigator.userAgentData) 的 Chromium 主版本号，一旦不一致就会在点击验证后无限循环刷新！
 */
function getCleanBrowserUserAgent() {
  const rawUa =
    typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  return rawUa
    .replace(/\s*obsidian\/[^\s]+/gi, "")
    .replace(/\s*Electron\/[^\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 同步设置 Electron persist:moegirl 会话分区的默认 User-Agent，确保主框架与 Turnstile 跨域子 iframe 完全一致
 */
function ensureMoegirlPartitionUserAgent() {
  const cleanUa = getCleanBrowserUserAgent();
  try {
    const electron = require("electron");
    const remote = electron?.remote || (() => {
      try {
        return require("@electron/remote");
      } catch (_) {
        return null;
      }
    })();
    const ses = remote?.session?.fromPartition?.("persist:moegirl");
    if (ses && typeof ses.setUserAgent === "function") {
      ses.setUserAgent(cleanUa);
    }
  } catch (_) {}
  return cleanUa;
}

/**
 * 通过 Obsidian 桌面端内置 Electron Chromium (<webview>) 渲染并提取萌娘百科 DOM
 * 仅当 moegirl.uk/api.php 接口本身不可达时作为后备使用
 */
async function fetchMoegirlViaElectronDom(candidateNames = [], timeoutMs = 7500) {
  if (typeof document === "undefined" || !document.body || !candidateNames.length) {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    let webview = null;
    let checkTimer = null;
    let overallTimer = null;
    let detectedChallenge = false;

    const cleanup = () => {
      if (checkTimer) {
        clearTimeout(checkTimer);
        checkTimer = null;
      }
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      if (webview) {
        try {
          webview.remove();
        } catch (_) {}
        webview = null;
      }
    };

    const finish = (res) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    overallTimer = setTimeout(() => {
      finish(detectedChallenge ? { found: false, moePoints: [], cfChallengeDetected: true } : null);
    }, timeoutMs);

    try {
      const cleanUa = ensureMoegirlPartitionUserAgent();
      webview = document.createElement("webview");
      webview.setAttribute("partition", "persist:moegirl");
      webview.setAttribute("useragent", cleanUa);
      webview.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:960px;height:760px;opacity:0;pointer-events:none;z-index:-9999;";

      let currentIdx = 0;
      let triedInPageApi = false;
      const loadCandidateAt = (idx) => {
        if (settled || !webview) return;
        if (idx >= candidateNames.length) {
          finish(detectedChallenge ? { found: false, moePoints: [], cfChallengeDetected: true } : null);
          return;
        }
        currentIdx = idx;
        const targetUrl = `https://moegirl.uk/${encodeURIComponent(candidateNames[idx])}`;
        try {
          webview.src = targetUrl;
        } catch (err) {
          finish(null);
        }
      };

      const checkDomAndExtract = async () => {
        if (settled || !webview || typeof webview.executeJavaScript !== "function") return;
        try {
          const namesJson = JSON.stringify(candidateNames);
          const probe = await webview.executeJavaScript(`
            (function() {
              const title = document.title || "";
              const hasChallengeDom = Boolean(
                document.querySelector("#challenge-stage, #cf-challenge-running, .cf-turnstile, iframe[src*='challenges.cloudflare.com']") ||
                window._cf_chl_opt
              );
              const isChallenge =
                hasChallengeDom &&
                (title.includes("Just a moment") || title.includes("请稍候") || title.includes("Attention Required") || hasChallengeDom);
              if (isChallenge) {
                return { status: "challenge", title };
              }
              const infobox = document.querySelector(".moe-infobox, .infobox3, .infotemplatebox, table.infobox");
              if (infobox) {
                return {
                  status: "found",
                  html: infobox.outerHTML,
                  url: location.href,
                  pageTitle: title.replace(/\\s*[-_]\\s*萌娘百科.*$/, "").trim()
                };
              }
              const noArticle = Boolean(
                document.querySelector(".noarticletext, .mw-warning-with-logexcerpt") ||
                (document.body && document.body.innerText && document.body.innerText.includes("目前还没有与上述标题相同的页面"))
              );
              const isReady = document.readyState === "complete" || document.readyState === "interactive";
              return { status: noArticle ? "not_found" : (isReady ? "ready_no_infobox" : "loading"), title };
            })();
          `);

          if (!probe || settled) return;

          if (probe.status === "challenge") {
            detectedChallenge = true;
            finish({ found: false, moePoints: [], cfChallengeDetected: true });
            return;
          }

          if (probe.status === "found" && probe.html) {
            const parsed = parseMoegirlInfoboxHtml(probe.html);
            if (parsed.found || parsed.moePoints.length > 0) {
              finish({
                ...parsed,
                matchedName: probe.pageTitle || candidateNames[currentIdx] || candidateNames[0],
                moegirlUrl:
                  probe.url ||
                  `https://moegirl.uk/${encodeURIComponent(candidateNames[currentIdx] || candidateNames[0])}`,
                status: "ok",
                cfChallengeDetected: false
              });
              return;
            }
          }

          if ((probe.status === "not_found" || probe.status === "ready_no_infobox") && !triedInPageApi) {
            triedInPageApi = true;
            const inOriginResult = await webview.executeJavaScript(`
              (async function() {
                const cands = ${namesJson};
                for (const name of cands) {
                  try {
                    const r = await fetch("/api.php?action=parse&page=" + encodeURIComponent(name) + "&prop=text&redirects=1&variant=zh-cn&format=json", {
                      credentials: "include",
                      headers: { "X-Requested-With": "XMLHttpRequest" }
                    });
                    if (r.ok) {
                      const j = await r.json();
                      const html = j && j.parse && j.parse.text && j.parse.text["*"];
                      if (html && (html.includes("moe-infobox") || html.includes("infobox3") || html.includes("infotemplatebox") || html.includes("萌点"))) {
                        return { html, matchedName: (j.parse && j.parse.title) || name };
                      }
                    }
                  } catch (e) {}
                }
                return null;
              })();
            `).catch(() => null);

            if (inOriginResult && inOriginResult.html) {
              const parsed = parseMoegirlInfoboxHtml(inOriginResult.html);
              if (parsed.found || parsed.moePoints.length > 0) {
                finish({
                  ...parsed,
                  matchedName: inOriginResult.matchedName,
                  moegirlUrl: `https://moegirl.uk/${encodeURIComponent(inOriginResult.matchedName)}`,
                  status: "ok",
                  cfChallengeDetected: false
                });
                return;
              }
            }

            if (probe.status === "not_found" && currentIdx + 1 < candidateNames.length) {
              loadCandidateAt(currentIdx + 1);
            }
          }
        } catch (_) {}
      };

      webview.addEventListener("did-stop-loading", () => {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = setTimeout(checkDomAndExtract, 350);
      });

      document.body.appendChild(webview);
      loadCandidateAt(0);
    } catch (e) {
      finish(null);
    }
  });
}

/**
 * 弹出内置「萌娘百科网页实时提取与验证器」窗口
 * 双核架构：
 * 1. 顶部内置「API 免验证极速通道」：通过未受 Cloudflare 拦截的 moegirl.uk/api.php 自动检索词条、消歧义页与近似前缀词条（如「槻木沙」→「槻木汐」），无需点击人机验证即可一键提取；
 * 2. 下方内置「原生同源 UA 实景视图」：彻底修复因硬编码旧版 Chrome/126 UA 与 Sec-CH-UA 版本冲突、以及 700ms 轮询注入干扰导致的 Cloudflare Turnstile 点击后无限循环回弹问题。
 */
function openMoegirlBrowserExtractModal(plugin, initialName, onExtracted, options = {}) {
  const rawInput = String(initialName || "").trim() || "洛琪希·米格路迪亚";
  const extractPageTitleFromUrlOrName = (val) => {
    const s = String(val || "").trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        const titleParam = u.searchParams.get("title") || u.searchParams.get("page");
        if (titleParam) return decodeURIComponent(titleParam);
        const seg = u.pathname.replace(/^\/+|\/+$/g, "");
        return seg ? decodeURIComponent(seg) : s;
      } catch (_) {
        return s;
      }
    }
    return s;
  };
  const cleanName = extractPageTitleFromUrlOrName(rawInput);
  const targetUrl = /^https?:\/\//i.test(rawInput)
    ? rawInput
    : `https://moegirl.uk/${encodeURIComponent(cleanName)}`;

  class MoegirlBrowserExtractModal extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-moegirl-browser-modal");
      contentEl.style.width = "min(880px, 92vw)";

      const header = contentEl.createDiv("curator-dl-header");
      header.createDiv({
        cls: "curator-dl-kicker",
        text: "MOEGIRL WIKI LIVE EXTRACTOR · 萌娘百科实时寻访与免验证直通器"
      });
      const titleEl = header.createEl("h3", {
        cls: "curator-dl-title",
        text: `🌐 萌娘百科词条寻访与提取：《${cleanName}》`
      });

      const statusBanner = contentEl.createDiv("curator-rss-check-prompt");
      statusBanner.style.marginBottom = "10px";
      const statusText = statusBanner.createDiv({
        cls: "curator-rss-check-prompt-q",
        text: "⚡ 正在通过萌娘百科 API 免验证通道检索角色资料栏（div.moe-infobox）与相近词条…"
      });
      statusBanner.createDiv({
        cls: "curator-rss-inline-hint",
        text: "提示：上方「API 免验证直通车」可直接穿透 Cloudflare 提取萌点；若角色名有同音/错别字（如「槻木沙」→「槻木汐」），点击下方候选词条即可一键提取。"
      });

      // 免验证候选词条直通车容器
      const fastTrackBar = contentEl.createDiv("curator-moegirl-fasttrack-bar");
      fastTrackBar.style.cssText =
        "display:none;margin-bottom:10px;padding:10px 12px;border-radius:8px;background:rgba(122,162,247,0.12);border:1px solid rgba(122,162,247,0.35);align-items:center;gap:8px;flex-wrap:wrap;";

      const bar = contentEl.createDiv("curator-char-add-searchbar");
      bar.style.marginBottom = "10px";
      const urlInput = bar.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "输入角色名（如 槻木汐 / 爱蜜莉雅）或 moegirl.uk 链接…"
      });
      urlInput.value = cleanName;

      const goBtn = bar.createEl("button", {
        cls: "curator-btn",
        text: "🔍 检索 / 跳转词条"
      });
      const extractNowBtn = bar.createEl("button", {
        cls: "curator-btn is-primary",
        text: "✦ 立即提取当前页面萌点"
      });
      const extBrowserBtn = bar.createEl("button", {
        cls: "curator-btn",
        text: "🌍 系统浏览器打开"
      });
      extBrowserBtn.title = "在系统默认浏览器中打开该词条（您也可以直接复制网页上的萌点或 HTML 粘贴回插件）";

      const webviewWrap = contentEl.createDiv();
      webviewWrap.style.cssText =
        "width:100%;height:480px;border:1px solid var(--background-modifier-border);border-radius:10px;overflow:hidden;background:var(--background-primary);position:relative;";

      const cleanUa = ensureMoegirlPartitionUserAgent();
      const webview = document.createElement("webview");
      webview.setAttribute("partition", "persist:moegirl");
      webview.setAttribute("useragent", cleanUa);
      webview.style.cssText = "width:100%;height:100%;border:0;";
      webview.src = targetUrl;
      webviewWrap.appendChild(webview);

      this._webview = webview;
      this._autoExtracted = false;

      const finishWithParsedData = (parsed, matchedTitle, finalUrl) => {
        if (this._autoExtracted) return;
        this._autoExtracted = true;
        statusText.setText(
          `✓ 已成功提取《${matchedTitle}》角色资料栏！共 ${parsed.moePoints.length} 个萌点${parsed.hairColor ? ` · 发色：${parsed.hairColor}` : ""}${parsed.eyeColor ? ` · 瞳色：${parsed.eyeColor}` : ""}`
        );
        if (typeof onExtracted === "function") {
          onExtracted({
            ...parsed,
            matchedName: matchedTitle,
            moegirlUrl: finalUrl || `https://moegirl.uk/${encodeURIComponent(matchedTitle)}`,
            status: "ok",
            cfChallengeDetected: false
          });
        }
        if (Notice) {
          new Notice(`✓ 已从萌娘百科《${matchedTitle}》提取 ${parsed.moePoints.length} 个萌点与角色属性！`);
        }
        this.close();
      };

      // 核心通道 1：通过免 Cloudflare 验证的 moegirl.uk/api.php 直接解析或列出近似候选词条
      const tryApiDirectOrSuggest = async (queryOrUrl) => {
        const kw = extractPageTitleFromUrlOrName(queryOrUrl);
        if (!kw) return;
        titleEl.setText(`🌐 萌娘百科词条寻访与提取：《${kw}》`);
        statusText.setText(`⚡ 正在通过 API 免验证通道检索《${kw}》…`);

        try {
          const directRes = await fetchMoegirlCharacterData([kw], {
            appearances: options.appearances || [],
            disableElectronDom: true
          });
          if (directRes && (directRes.found || (directRes.moePoints && directRes.moePoints.length > 0))) {
            finishWithParsedData(
              directRes,
              directRes.matchedName || kw,
              directRes.moegirlUrl || `https://moegirl.uk/${encodeURIComponent(directRes.matchedName || kw)}`
            );
            return;
          }

          // 若未直接自动命中，搜索相近前缀/全文候选词条供用户一键点击提取（免过网页 Cloudflare 验证）
          const suggestions = await searchMoegirlCandidateTitlesViaApi(kw);
          if (suggestions.length > 0 && fastTrackBar.isConnected) {
            fastTrackBar.empty();
            fastTrackBar.style.display = "flex";
            const labelSpan = fastTrackBar.createSpan({
              text: `✨ 免验证近似词条直通车（未找到「${kw}」，点击下列词条可直接提取萌点，无需下方网页验证）：`
            });
            labelSpan.style.cssText = "font-size:12px;font-weight:600;color:var(--text-normal);";
            for (const candTitle of suggestions) {
              const chip = fastTrackBar.createEl("button", {
                cls: "curator-dl-mini-btn is-accent",
                text: `✦ 提取《${candTitle}》`
              });
              chip.onclick = async (ev) => {
                ev.preventDefault();
                chip.disabled = true;
                chip.textContent = `正在提取《${candTitle}》…`;
                const res = await fetchMoegirlCharacterData([candTitle], {
                  appearances: options.appearances || [],
                  disableElectronDom: true
                });
                if (res && (res.found || (res.moePoints && res.moePoints.length > 0))) {
                  finishWithParsedData(
                    res,
                    res.matchedName || candTitle,
                    res.moegirlUrl || `https://moegirl.uk/${encodeURIComponent(candTitle)}`
                  );
                } else {
                  chip.disabled = false;
                  chip.textContent = `✦ 提取《${candTitle}》`;
                  urlInput.value = candTitle;
                  webview.src = `https://moegirl.uk/${encodeURIComponent(candTitle)}`;
                }
              };
            }
            statusText.setText(
              `💡 萌娘百科中暂无《${kw}》词条，但为您找到了近似词条（如上方蓝色按钮），点击即可免验证直接提取！`
            );
          }
        } catch (_) {}
      };

      // 核心通道 2：当 webview 页面加载完成时提取 DOM（重要：检测到 Cloudflare 验证页时绝不轮询注入脚本，避免干扰 Turnstile 导致循环刷新）
      const tryExtractFromWebview = async (isManualClick = false) => {
        if (!this._webview || typeof this._webview.executeJavaScript !== "function") return;
        try {
          const data = await this._webview.executeJavaScript(`
            (function() {
              const title = document.title || "";
              const isChallenge = Boolean(
                document.querySelector("#challenge-stage, #cf-challenge-running, .cf-turnstile, iframe[src*='challenges.cloudflare.com']") ||
                window._cf_chl_opt ||
                title.includes("Just a moment") ||
                title.includes("请稍候")
              );
              if (isChallenge) {
                return { isChallenge: true, url: location.href, readyState: document.readyState, title };
              }
              const infobox = document.querySelector(".moe-infobox, .infobox3, .infotemplatebox, table.infobox");
              return {
                isChallenge: false,
                hasInfobox: Boolean(infobox),
                html: infobox ? infobox.outerHTML : (document.body ? document.body.innerHTML : ""),
                url: location.href,
                readyState: document.readyState,
                title: title.replace(/\\s*[-_]\\s*萌娘百科.*$/, "").trim()
              };
            })();
          `);
          if (!data) return;
          if (data.isChallenge) {
            if (fastTrackBar.style.display === "none") {
              statusText.setText(
                "🛡️ 下方网页触发了 Cloudflare 验证（建议优先使用上方搜索栏检索准确角色名走 API 免验证直通车，或在下方点击验证框等待自动跳转）…"
              );
            }
            return;
          }
          if (!data.html) return;
          const parsed = parseMoegirlInfoboxHtml(data.html);
          if (parsed.found || parsed.moePoints.length > 0) {
            this._autoExtracted = false;
            finishWithParsedData(parsed, data.title || cleanName, data.url || targetUrl);
          } else if (data.readyState === "complete") {
            if (fastTrackBar.style.display === "none") {
              statusText.setText(
                "📖 页面已加载（当前可能为同名消歧义页或词条不存在），可在上方输入框修改角色名点击「🔍 检索 / 跳转词条」或点击网页内的具体词条链接。"
              );
            }
            if (isManualClick && Notice) {
              new Notice("当前页面暂未检测到角色资料栏 (.moe-infobox)，请确认角色名称或点击上方候选词条。");
            }
          }
        } catch (err) {
          if (isManualClick && Notice) {
            new Notice("页面仍在加载中，请稍候再试。");
          }
        }
      };

      const triggerSearchOrNavigate = () => {
        const raw = urlInput.value.trim();
        if (!raw) return;
        this._autoExtracted = false;
        fastTrackBar.style.display = "none";
        const pageTitle = extractPageTitleFromUrlOrName(raw);
        const nextUrl = /^https?:\/\//i.test(raw)
          ? raw
          : `https://moegirl.uk/${encodeURIComponent(pageTitle)}`;
        webview.src = nextUrl;
        tryApiDirectOrSuggest(pageTitle);
      };

      goBtn.onclick = (e) => {
        e.preventDefault();
        triggerSearchOrNavigate();
      };
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          triggerSearchOrNavigate();
        }
      });

      extractNowBtn.onclick = async (e) => {
        e.preventDefault();
        await tryApiDirectOrSuggest(urlInput.value.trim() || cleanName);
        if (!this._autoExtracted) {
          tryExtractFromWebview(true);
        }
      };

      extBrowserBtn.onclick = (e) => {
        e.preventDefault();
        const raw = urlInput.value.trim() || cleanName;
        const pageTitle = extractPageTitleFromUrlOrName(raw);
        const openUrl = /^https?:\/\//i.test(raw)
          ? raw
          : `https://moegirl.uk/${encodeURIComponent(pageTitle)}`;
        window.open(openUrl, "_blank");
      };

      webview.addEventListener("did-navigate", (ev) => {
        if (ev && ev.url && !ev.url.includes("__cf_chl")) {
          const navTitle = extractPageTitleFromUrlOrName(ev.url);
          if (navTitle && navTitle !== "moegirl.uk") {
            urlInput.value = navTitle;
          }
        }
      });

      // 仅在加载停止时延迟检查一次，绝不在 Cloudflare 验证页开启高频定时器注入脚本
      webview.addEventListener("did-stop-loading", () => {
        if (this._checkTimeout) clearTimeout(this._checkTimeout);
        this._checkTimeout = setTimeout(() => {
          tryExtractFromWebview(false);
        }, 650);
      });

      // 打开弹窗时立即启动 API 免验证通道检索
      tryApiDirectOrSuggest(cleanName);
    }

    onClose() {
      if (this._checkTimeout) {
        clearTimeout(this._checkTimeout);
        this._checkTimeout = null;
      }
      if (this._webview) {
        try {
          this._webview.remove();
        } catch (_) {}
        this._webview = null;
      }
      this.contentEl.empty();
    }
  }

  const modal = new MoegirlBrowserExtractModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 通过免 Cloudflare 验证的 moegirl.uk/api.php 搜索候选词条标题（支持前缀容错，如「槻木沙」自动检索「槻木」→「槻木汐」）
 */
async function searchMoegirlCandidateTitlesViaApi(rawKeyword) {
  const kw = String(rawKeyword || "").trim();
  if (!kw) return [];
  const cleanUa = getCleanBrowserUserAgent();
  const queryPrefixes = [kw];
  // 若用户输入了 3~5 字角色名但末字有同音错字（如「槻木沙」→「槻木汐」），自动加入去掉末字的姓氏前缀检索
  if (kw.length >= 3) {
    const stem = kw.slice(0, kw.length - 1).trim();
    if (stem.length >= 2 && !queryPrefixes.includes(stem)) {
      queryPrefixes.push(stem);
    }
  }
  if (kw.length >= 4) {
    const stem2 = kw.slice(0, 2).trim();
    if (stem2.length >= 2 && !queryPrefixes.includes(stem2)) {
      queryPrefixes.push(stem2);
    }
  }

  const results = [];
  const addResult = (t) => {
    const clean = String(t || "").trim();
    if (
      clean &&
      !results.includes(clean) &&
      !/(?:歌曲|音乐|专辑|单曲|列表|模板|用语|漫画|小说|动画|消歧义)\)?$/.test(clean)
    ) {
      results.push(clean);
    }
  };

  for (const q of queryPrefixes) {
    try {
      const osUrl = `https://moegirl.uk/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=8&namespace=0&format=json`;
      const osResp = await requestUrlWithTimeout(
        {
          url: osUrl,
          method: "GET",
          headers: {
            "User-Agent": cleanUa,
            "Accept": "application/json,text/plain,*/*"
          },
          throw: false
        },
        4500
      );
      if (Array.isArray(osResp?.json) && Array.isArray(osResp.json[1])) {
        for (const t of osResp.json[1]) {
          addResult(t);
        }
      }
      if (results.length > 0) break;
    } catch (_) {}
  }

  // 若 OpenSearch 前缀未命中，补充调用 MediaWiki list=search 全文检索
  if (results.length === 0) {
    try {
      const srUrl = `https://moegirl.uk/api.php?action=query&list=search&srsearch=${encodeURIComponent(kw)}&srlimit=5&format=json`;
      const srResp = await requestUrlWithTimeout(
        {
          url: srUrl,
          method: "GET",
          headers: {
            "User-Agent": cleanUa,
            "Accept": "application/json,text/plain,*/*"
          },
          throw: false
        },
        4500
      );
      const searchItems = srResp?.json?.query?.search;
      if (Array.isArray(searchItems)) {
        for (const item of searchItems) {
          if (item && item.title) addResult(item.title);
        }
      }
    } catch (_) {}
  }

  return results.slice(0, 6);
}

/**
 * 从萌娘百科抓取角色萌点与人设数据
 * 多级容错架构：
 * 1. 优先调用免 Cloudflare 验证的 moegirl.uk/api.php (variant=zh-cn) 高速解析词条 HTML（兼容 div.moe-infobox.infobox3 / div.infotemplatebox / table.infobox）；
 * 2. 若命中同名消歧义页（如「艾米莉亚」「雷姆」「拉姆」），自动结合出演作品名解析消歧义候选词条并二次抓取；
 * 3. 若候选译名均未直接命中，调用 moegirl.uk OpenSearch（含同音末字容错前缀，如「槻木沙」→「槻木汐」）检索相似词条标题；
 * 4. 仅当 moegirl.uk/api.php 本身未响应或被拦截时才回退 Electron DOM，彻底杜绝因词条名不存在而去加载 HTML 页误触发 Cloudflare 弹窗。
 */
async function fetchMoegirlCharacterData(candidateNames = [], options = {}) {
  const expandedNames = expandMoegirlCandidateNames(candidateNames);
  const primaryName = expandedNames[0] || "";
  const appearances = Array.isArray(options.appearances) ? options.appearances : [];
  const cleanUa = getCleanBrowserUserAgent();

  let cfChallengeDetected = false;
  let apiRespondedOk = false;
  const visitedPages = new Set();
  const queue = [...expandedNames];

  const apiHosts = [
    { base: "https://moegirl.uk", api: "https://moegirl.uk/api.php" },
    { base: "https://zh.moegirl.org.cn", api: "https://zh.moegirl.org.cn/api.php" }
  ];

  const tryParsePageOnHost = async (hostObj, pageTitle) => {
    const encoded = encodeURIComponent(pageTitle);
    const apiUrl = `${hostObj.api}?action=parse&page=${encoded}&prop=text&redirects=1&variant=zh-cn&format=json`;
    try {
      const resp = await requestUrlWithTimeout(
        {
          url: apiUrl,
          method: "GET",
          headers: {
            "User-Agent": cleanUa,
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9"
          },
          throw: false
        },
        4800
      );
      if (resp && isCloudflareChallengeHtml(resp.status, resp.text)) {
        if (hostObj.base.includes("moegirl.uk")) {
          cfChallengeDetected = true;
        }
        return { type: "cf_challenge" };
      }
      if (resp && resp.status >= 200 && resp.status < 300 && resp.json) {
        if (hostObj.base.includes("moegirl.uk")) {
          apiRespondedOk = true;
          cfChallengeDetected = false;
        }
      }
      const htmlText = resp?.json?.parse?.text?.["*"] || "";
      if (!htmlText) {
        return { type: "missing" };
      }
      const parsed = parseMoegirlInfoboxHtml(htmlText);
      const matchedTitle = resp?.json?.parse?.title || parsed.translatedName || pageTitle;
      if (parsed.found || parsed.moePoints.length > 0) {
        return {
          type: "found",
          data: {
            ...parsed,
            matchedName: matchedTitle,
            moegirlUrl: `${hostObj.base}/${encodeURIComponent(matchedTitle)}`,
            status: "ok",
            cfChallengeDetected: false
          }
        };
      }
      const disambigList = extractDisambiguationCandidates(htmlText, appearances, expandedNames);
      return {
        type: "disambig",
        disambigList
      };
    } catch (err) {
      return { type: "error" };
    }
  };

  // 第一阶段：使用 moegirl.uk MediaWiki Parse API 解析候选名，并自动穿透同名消歧义页
  let parseAttempts = 0;
  while (queue.length > 0 && parseAttempts < 7) {
    const currentName = queue.shift();
    if (!currentName || visitedPages.has(currentName)) continue;
    visitedPages.add(currentName);
    parseAttempts += 1;

    const ukRes = await tryParsePageOnHost(apiHosts[0], currentName);
    if (ukRes.type === "found") {
      return ukRes.data;
    }
    if (ukRes.type === "disambig" && Array.isArray(ukRes.disambigList) && ukRes.disambigList.length > 0) {
      const topDisambig = ukRes.disambigList.filter((d) => !visitedPages.has(d)).slice(0, 3);
      queue.unshift(...topDisambig);
      continue;
    }

    // 若 moegirl.uk 网络异常或被拦截，回退尝试 zh.moegirl.org.cn/api.php
    if (ukRes.type === "error" || ukRes.type === "cf_challenge") {
      const zhRes = await tryParsePageOnHost(apiHosts[1], currentName);
      if (zhRes.type === "found") {
        return zhRes.data;
      }
      if (zhRes.type === "disambig" && Array.isArray(zhRes.disambigList) && zhRes.disambigList.length > 0) {
        const topDisambig = zhRes.disambigList.filter((d) => !visitedPages.has(d)).slice(0, 2);
        queue.unshift(...topDisambig);
      }
    }
  }

  // 第二阶段：若直接词条名均未命中，调用 moegirl.uk OpenSearch（支持末字同音容错，如「槻木沙」→「槻木汐」）搜索相近词条标题
  if (primaryName && !cfChallengeDetected) {
    try {
      const osTitles = (await searchMoegirlCandidateTitlesViaApi(primaryName)).filter(
        (t) => t && !visitedPages.has(t)
      );
      for (const candTitle of osTitles.slice(0, 3)) {
        visitedPages.add(candTitle);
        const ukRes = await tryParsePageOnHost(apiHosts[0], candTitle);
        if (ukRes.type === "found") {
          return ukRes.data;
        }
        if (ukRes.type === "disambig" && Array.isArray(ukRes.disambigList) && ukRes.disambigList.length > 0) {
          for (const dTitle of ukRes.disambigList.slice(0, 2)) {
            if (visitedPages.has(dTitle)) continue;
            visitedPages.add(dTitle);
            const dRes = await tryParsePageOnHost(apiHosts[0], dTitle);
            if (dRes.type === "found") {
              return dRes.data;
            }
          }
        }
      }
    } catch (_) {}
  }

  // 第三阶段：仅当 moegirl.uk/api.php 接口本身未能正常响应（!apiRespondedOk）时，才启用 Electron (<webview>) 兜底
  // （避免当词条本身不存在时去请求 HTML 网页而白白撞上 HTML 路由的 Cloudflare Turnstile）
  if (options.disableElectronDom !== true && !apiRespondedOk && expandedNames.length > 0) {
    try {
      const domRes = await fetchMoegirlViaElectronDom(expandedNames, options.timeoutMs || 6500);
      if (domRes && (domRes.found || (domRes.moePoints && domRes.moePoints.length > 0))) {
        return domRes;
      }
      if (domRes && domRes.cfChallengeDetected) {
        cfChallengeDetected = true;
      }
    } catch (err) {
      console.warn("[BangumiManager] Electron DOM moegirl fetch fallback:", err);
    }
  }

  return {
    found: false,
    moePoints: [],
    heimuMoePoints: [],
    hairColor: "",
    eyeColor: "",
    cv: "",
    realName: "",
    translatedName: "",
    nicknames: [],
    birthday: "",
    constellation: "",
    height: "",
    weight: "",
    bwh: "",
    bloodType: "",
    group: "",
    imageUrl: "",
    matchedName: primaryName,
    moegirlUrl: primaryName
      ? `https://moegirl.uk/${encodeURIComponent(primaryName)}`
      : "https://moegirl.uk/",
    status: "fallback",
    cfChallengeDetected
  };
}

/**
 * 合并 Bangumi 与 萌娘百科 双源数据为统一角色档案结构
 */
async function fetchDualSourceCharacterProfile(bgmIdOrInput, manualNameHint = "", options = {}) {
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

  const moeData = await fetchMoegirlCharacterData(candidateNames, {
    ...options,
    appearances: bgmData?.appearances || options.appearances || []
  });

  const cleanMatchedMoeTitle =
    moeData?.found && moeData?.matchedName
      ? String(moeData.matchedName).replace(/\s*[（(][^）)]+[）)]\s*$/, "").trim()
      : "";
  const primaryName =
    bgmData?.nameCn ||
    moeData?.translatedName ||
    cleanMatchedMoeTitle ||
    manualNameHint ||
    moeData?.realName ||
    bgmData?.nameJp ||
    "未命名角色";

  // 若名称匹配洛琪希且网络因离线未能返回萌点，提供内置完整萌点兜底（严禁仅凭旧错误 ID 21021 误判其他角色）
  const isRoxyHint =
    /洛琪希|ロキシー|roxy/i.test(primaryName) ||
    /洛琪希|ロキシー|roxy/i.test(manualNameHint) ||
    (String(bgmId) === "46465" && !bgmData?.nameCn && !bgmData?.nameJp);
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
      `https://moegirl.uk/${encodeURIComponent(primaryName)}`,
    name: primaryName,
    nameJp: bgmData?.nameJp || moeData?.realName || fallbackRoxy?.nameJp || "",
    aliases: mergedAliases,
    gender: bgmData?.gender || fallbackRoxy?.gender || "",
    birthday: bgmData?.birthday || moeData?.birthday || fallbackRoxy?.birthday || "",
    constellation: moeData?.constellation || "",
    height: bgmData?.height || moeData?.height || fallbackRoxy?.height || "",
    bloodType: bgmData?.bloodType || moeData?.bloodType || "",
    bwh: bgmData?.bwh || moeData?.bwh || "",
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
    cfChallengeDetected: Boolean(moeData?.cfChallengeDetected && finalMoePoints.length === 0),
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

  // 若是洛琪希 (46465) 且本地已存在插件内置立绘 roxy_explain.png，优先在远程超时前准备或兜底写入本地附件目录
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
      const targetRel = `${folder}/bangumi-cover-char-46465.png`;
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

  if (cleanId === "46465") {
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

  const isRoxyChar =
    /洛琪希|ロキシー|roxy/i.test(String(charItem.name || "")) ||
    /洛琪希|ロキシー|roxy/i.test(String(charItem.nameJp || ""));

  // 1. 优先检查已记录的 localAvatar（若非洛琪希却误绑了历史遗留的 21021.png 则自动忽略）
  if (
    charItem.localAvatar &&
    app?.vault &&
    !(!isRoxyChar && /bangumi-cover-char-21021\.png$/i.test(String(charItem.localAvatar)))
  ) {
    const file = app.vault.getAbstractFileByPath(charItem.localAvatar);
    if (file && typeof app.vault.getResourcePath === "function") {
      return app.vault.getResourcePath(file);
    }
    if (app.vault.adapter && typeof app.vault.adapter.getResourcePath === "function") {
      return app.vault.adapter.getResourcePath(charItem.localAvatar);
    }
  }

  // 2. 检查本地封面目录下是否已存在 bangumi-cover-char-{id}.{ext}（若用户已手动指定自定义远程图则跳过旧默认缓存）
  const rawId = String(charItem.bgmId || charItem.id || "")
    .replace(/^char-|^bgm-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  if (rawId && app?.vault && !charItem.hasCustomAvatar) {
    const exts = ["jpg", "png", "webp", "jpeg", "gif", "avif"];
    for (const ext of exts) {
      if (rawId === "21021" && ext === "png" && !isRoxyChar) continue;
      const candidatePath = `${folder}/bangumi-cover-char-${rawId}.${ext}`;
      const file = app.vault.getAbstractFileByPath(candidatePath);
      if (file && typeof app.vault.getResourcePath === "function") {
        charItem.localAvatar = file.path;
        return app.vault.getResourcePath(file);
      }
    }
  }

  // 3. 若角色确认为洛琪希，且未设置自定义图片、插件目录中已安装高清立绘 roxy_explain.png，直接复用并异步落盘至附件目录
  if (isRoxyChar && !charItem.hasCustomAvatar && plugin && typeof roxyMascotService?.resolveRoxyAssetUrl === "function") {
    const roxyAssetUrl = roxyMascotService.resolveRoxyAssetUrl(plugin, "roxy_explain.png");
    if (roxyAssetUrl) {
      if (!charItem._cachingAvatar && app?.vault) {
        charItem._cachingAvatar = true;
        saveCharacterAvatarLocally(app, folder, "46465", charItem.avatar || "")
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
 * 解析角色典藏 Markdown 笔记目录（默认与动画笔记目录 noteRootFolder 同级并列，如「角色典藏」或「ACG/角色典藏」）
 */
function resolveCharacterNoteFolder(plugin) {
  const rootFolder = String(plugin?.settings?.noteRootFolder ?? "动画笔记")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  let siblingDefault = "角色典藏";
  if (rootFolder && rootFolder.includes("/")) {
    const parentDir = rootFolder.slice(0, rootFolder.lastIndexOf("/"));
    siblingDefault = `${parentDir}/角色典藏`;
  }

  const configured = String(plugin?.settings?.characterNoteFolder || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (configured) {
    // 若用户未手动锁定且仍为旧版历史默认值「动画笔记/角色典藏」，自动修正为与动画笔记同级目录
    const legacyInsideRoot = rootFolder ? `${rootFolder}/角色典藏` : "动画笔记/角色典藏";
    if (
      !plugin?.settings?.characterNoteFolderManuallySet &&
      (configured === "动画笔记/角色典藏" || configured === legacyInsideRoot)
    ) {
      return siblingDefault;
    }
    return configured;
  }

  return siblingDefault;
}

/**
 * 判断某个文件或路径是否属于「角色典藏 Markdown 笔记」（避免被普通动画笔记扫描器误处理）
 */
function isCharacterNotePath(plugin, fileOrPath) {
  const rawPath = typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path;
  if (!rawPath) return false;
  const normPath = String(rawPath).replace(/\\/g, "/").replace(/^\/+/, "");
  const charFolder = resolveCharacterNoteFolder(plugin);
  if (charFolder && (normPath === charFolder || normPath.startsWith(`${charFolder}/`))) {
    return true;
  }
  const rootFolder = String(plugin?.settings?.noteRootFolder ?? "动画笔记")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const legacyFolder = rootFolder ? `${rootFolder}/角色典藏` : "动画笔记/角色典藏";
  if (normPath.startsWith(`${legacyFolder}/`) || normPath.startsWith("动画笔记/角色典藏/")) {
    return true;
  }
  const collection = plugin?.settings?.characterCollection;
  if (Array.isArray(collection)) {
    if (collection.some((c) => c && String(c.notePath || "").replace(/\\/g, "/") === normPath)) {
      return true;
    }
  }
  return false;
}

/**
 * 查找角色关联的本地 Markdown 笔记文件（检查 charRecord.notePath、当前角色典藏目录及历史目录）
 */
function resolveCharacterNoteFile(plugin, charRecord) {
  if (!plugin?.app?.vault || !charRecord) return null;
  if (charRecord.notePath) {
    const direct = plugin.app.vault.getAbstractFileByPath(charRecord.notePath);
    if (direct) return direct;
  }
  const folder = resolveCharacterNoteFolder(plugin);
  const candidateNames = Array.from(
    new Set(
      [charRecord.name, charRecord.nameJp, ...(charRecord.aliases || [])]
        .map((n) => noteManager.getSafeFileName(n || ""))
        .filter(Boolean)
    )
  );
  const rootFolder = String(plugin?.settings?.noteRootFolder ?? "动画笔记")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const legacyFolders = Array.from(
    new Set([
      folder,
      rootFolder ? `${rootFolder}/角色典藏` : "动画笔记/角色典藏",
      "动画笔记/角色典藏"
    ])
  );

  for (const dir of legacyFolders) {
    for (const safeName of candidateNames) {
      const found = plugin.app.vault.getAbstractFileByPath(`${dir}/${safeName}.md`);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 解析角色典藏 Markdown 笔记内容（同时支持 YAML Frontmatter 与正文表格/章节提取）
 */
function parseCharacterNoteMarkdown(content) {
  const text = String(content || "");
  if (!text.trim()) return null;

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fmBlock = fmMatch ? fmMatch[1] : "";
  const body = fmMatch ? text.slice(fmMatch[0].length) : text;

  const isCharNote =
    /(?:^|\n)\s*角色中文名\s*:/.test(fmBlock) ||
    /(?:^|\n)\s*个人喜爱度评分\s*:/.test(fmBlock) ||
    /(?:^|\n)\s*Bangumi角色页\s*:/.test(fmBlock) ||
    /##\s*角色档案与外观属性/.test(body);
  if (!isCharNote) return null;

  const readFmScalar = (key) => {
    const re = new RegExp(`(?:^|\\r?\\n)[^\\S\\r\\n]*${key}[^\\S\\r\\n]*:[^\\S\\r\\n]*(.*)`, "m");
    const m = fmBlock.match(re);
    if (!m) return undefined;
    let val = m[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    return val.trim();
  };

  // 解析 YAML 中的 萌点 列表
  let fmMoePoints = undefined;
  const moeBlockMatch = fmBlock.match(/(?:^|\r?\n)[^\S\r\n]*萌点[^\S\r\n]*:[^\S\r\n]*(\[[^\S\r\n]*\])?((?:\r?\n[^\S\r\n]*-[^\S\r\n]*.*)*)/);
  if (moeBlockMatch) {
    if (moeBlockMatch[1]) {
      fmMoePoints = [];
    } else if (moeBlockMatch[2]) {
      fmMoePoints = [];
      const itemLines = moeBlockMatch[2].split(/\r?\n/);
      for (const line of itemLines) {
        const im = line.match(/^\s*-\s*(.+)$/);
        if (im) {
          let v = im[1].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1).replace(/\\"/g, '"');
          }
          if (v) fmMoePoints.push(v);
        }
      }
    } else {
      const inlineMoe = readFmScalar("萌点");
      if (inlineMoe && inlineMoe !== "[]") {
        fmMoePoints = inlineMoe
          .replace(/^\[|\]$/g, "")
          .split(/[、，,\/；;|]+/)
          .map((s) => s.replace(/^["']|["']$/g, "").trim())
          .filter(Boolean);
      }
    }
  }

  // 解析正文表格中的喜爱度与属性
  let bodyFavoriteScore = undefined;
  const bodyScoreMatch = body.match(/\|\s*\*\*个人喜爱度\*\*\s*\|\s*[^|0-9]*([0-9]+(?:\.[0-9]+)?)/);
  if (bodyScoreMatch) {
    const n = Number(bodyScoreMatch[1]);
    if (Number.isFinite(n)) bodyFavoriteScore = Math.max(1, Math.min(10, Math.round(n * 10) / 10));
  }

  let fmFavoriteScore = undefined;
  const rawFmScore = readFmScalar("个人喜爱度评分");
  if (rawFmScore !== undefined && rawFmScore !== "") {
    const n = Number(rawFmScore);
    if (Number.isFinite(n)) fmFavoriteScore = Math.max(1, Math.min(10, Math.round(n * 10) / 10));
  }

  // 解析正文 ## 萌娘百科萌点标签 区块中的反引号标签
  let bodyMoePoints = undefined;
  const moeSecMatch = body.match(/##\s*萌娘百科萌点标签\s*\r?\n+([\s\S]*?)(?=\r?\n##\s+|\s*$)/);
  if (moeSecMatch) {
    const secText = moeSecMatch[1].trim();
    const tickMatches = [...secText.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (tickMatches.length > 0) {
      bodyMoePoints = tickMatches;
    }
  }

  // 解析正文 ## 心动寄语与手记
  let personalComment = undefined;
  const commentSecMatch = body.match(/##\s*心动寄语与手记\s*\r?\n+([\s\S]*?)(?=\r?\n##\s+|\s*$)/);
  if (commentSecMatch) {
    const cleanedComment = commentSecMatch[1]
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\*\*已观看集数\*\*：\s*\d+\s*$/gm, "")
      .trim();
    personalComment = cleanedComment;
  }

  const cleanField = (v) => (v && v !== "未知" ? v : "");

  const appearancesRaw = cleanField(readFmScalar("代表作品"));
  const appearances = appearancesRaw
    ? appearancesRaw
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  let heightVal = readFmScalar("身高") !== undefined ? cleanField(readFmScalar("身高")) : undefined;
  if (!heightVal) {
    const bodyHeightMatch = body.match(/\|\s*\*\*身高\*\*\s*\|\s*([^|\r\n]+)\s*\|/);
    if (bodyHeightMatch && bodyHeightMatch[1].trim()) {
      heightVal = cleanField(bodyHeightMatch[1].trim());
    }
  }

  return {
    name: readFmScalar("角色中文名") || undefined,
    nameJp: readFmScalar("角色原名") || undefined,
    fmFavoriteScore,
    bodyFavoriteScore,
    height: heightVal,
    hairColor: readFmScalar("发色") !== undefined ? cleanField(readFmScalar("发色")) : undefined,
    eyeColor: readFmScalar("瞳色") !== undefined ? cleanField(readFmScalar("瞳色")) : undefined,
    cv: readFmScalar("声优") !== undefined ? cleanField(readFmScalar("声优")) : undefined,
    birthday: readFmScalar("生日") !== undefined ? cleanField(readFmScalar("生日")) : undefined,
    appearances,
    bgmUrl: readFmScalar("Bangumi角色页") || undefined,
    moegirlUrl: readFmScalar("萌娘百科") || undefined,
    createdAt: readFmScalar("收录日期") || undefined,
    fmMoePoints,
    bodyMoePoints,
    personalComment,
    hasStrayWatchedEpisodes: /^\*\*已观看集数\*\*：\s*\d+\s*$/m.test(text)
  };
}

/**
 * 将角色典藏 Markdown 笔记中的用户修改反向同步到 plugin.settings.characterCollection（防止被看板覆盖）
 */
async function syncCharacterNoteToCollection(plugin, file, options = {}) {
  if (!plugin?.app?.vault || !file) return false;
  if (plugin.isPluginWritingNote instanceof Set && plugin.isPluginWritingNote.has(file.path)) {
    return false;
  }

  let rawContent = "";
  try {
    rawContent = await plugin.app.vault.read(file);
  } catch (e) {
    return false;
  }

  const parsed = parseCharacterNoteMarkdown(rawContent);
  if (!parsed) return false;

  if (!Array.isArray(plugin.settings.characterCollection)) {
    plugin.settings.characterCollection = [];
  }
  const list = plugin.settings.characterCollection;

  const fileBaseName = String(file.basename || "").trim();
  let target = list.find((c) => c && String(c.notePath || "").replace(/\\/g, "/") === String(file.path).replace(/\\/g, "/"));

  if (!target && parsed.bgmUrl) {
    target = list.find((c) => c && c.bgmUrl && c.bgmUrl === parsed.bgmUrl);
  }
  if (!target) {
    target = list.find((c) =>
      Boolean(
        areCharactersSimilar(c, {
          name: parsed.name || fileBaseName,
          nameJp: parsed.nameJp || ""
        })?.similar
      )
    );
  }

  let changed = false;

  if (!target) {
    // 若笔记存在于角色典藏目录但尚未在画廊列表中，自动纳管至 characterCollection
    const bgmIdMatch = String(parsed.bgmUrl || "").match(/\/character\/(\d+)/);
    const bgmId = bgmIdMatch ? bgmIdMatch[1] : "";
    const finalScore = parsed.fmFavoriteScore ?? parsed.bodyFavoriteScore ?? 9.0;
    const finalMoe = parsed.fmMoePoints ?? parsed.bodyMoePoints ?? [];
    target = {
      id: bgmId ? `bgm-${bgmId}` : `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bgmId,
      bgmUrl: parsed.bgmUrl || "",
      moegirlUrl:
        parsed.moegirlUrl ||
        `https://moegirl.uk/${encodeURIComponent(parsed.name || fileBaseName)}`,
      name: parsed.name || fileBaseName,
      nameJp: parsed.nameJp || "",
      aliases: [],
      gender: "",
      birthday: parsed.birthday || "",
      constellation: "",
      height: parsed.height || "",
      bloodType: "",
      bwh: "",
      hairColor: parsed.hairColor || "",
      eyeColor: parsed.eyeColor || "",
      cv: parsed.cv || "",
      appearances: parsed.appearances || [],
      moePoints: finalMoe,
      heimuMoePoints: [],
      avatar: "",
      localAvatar: "",
      summary: "",
      favoriteScore: finalScore,
      personalComment: parsed.personalComment || "",
      notePath: file.path,
      createdAt: parsed.createdAt || new Date().toISOString().slice(0, 10)
    };
    list.push(target);
    changed = true;
  } else {
    if (target.notePath !== file.path) {
      target.notePath = file.path;
      changed = true;
    }

    // 智能判定喜爱度评分：若用户在 YAML 或正文表格任一处修改了分数（与内存中的 target.favoriteScore 不同），以用户修改值为准
    const currentScore = Number.isFinite(Number(target.favoriteScore))
      ? Math.round(Number(target.favoriteScore) * 10) / 10
      : 9.0;
    let nextScore = currentScore;
    if (parsed.fmFavoriteScore !== undefined && parsed.fmFavoriteScore !== currentScore) {
      nextScore = parsed.fmFavoriteScore;
    } else if (parsed.bodyFavoriteScore !== undefined && parsed.bodyFavoriteScore !== currentScore) {
      nextScore = parsed.bodyFavoriteScore;
    } else if (parsed.fmFavoriteScore !== undefined) {
      nextScore = parsed.fmFavoriteScore;
    }
    if (nextScore !== currentScore) {
      target.favoriteScore = nextScore;
      changed = true;
    }

    if (parsed.name && parsed.name !== target.name) {
      target.name = parsed.name;
      changed = true;
    }
    if (parsed.nameJp !== undefined && parsed.nameJp !== (target.nameJp || "")) {
      target.nameJp = parsed.nameJp;
      changed = true;
    }
    if (parsed.height !== undefined && parsed.height && parsed.height !== (target.height || "")) {
      target.height = parsed.height;
      changed = true;
    }
    if (parsed.hairColor !== undefined && parsed.hairColor !== (target.hairColor || "")) {
      target.hairColor = parsed.hairColor;
      changed = true;
    }
    if (parsed.eyeColor !== undefined && parsed.eyeColor !== (target.eyeColor || "")) {
      target.eyeColor = parsed.eyeColor;
      changed = true;
    }
    if (parsed.cv !== undefined && parsed.cv !== (target.cv || "")) {
      target.cv = parsed.cv;
      changed = true;
    }
    if (parsed.birthday !== undefined && parsed.birthday !== (target.birthday || "")) {
      target.birthday = parsed.birthday;
      changed = true;
    }
    if (parsed.appearances !== undefined) {
      const prevApp = (target.appearances || []).join(" / ");
      const nextApp = parsed.appearances.join(" / ");
      if (prevApp !== nextApp) {
        target.appearances = parsed.appearances;
        changed = true;
      }
    }

    // 萌点同步：支持用户在 YAML 萌点列表或正文反引号标签中增删改
    const currentMoeStr = (target.moePoints || []).join("||");
    let nextMoe = target.moePoints || [];
    if (parsed.fmMoePoints !== undefined && parsed.fmMoePoints.join("||") !== currentMoeStr) {
      nextMoe = parsed.fmMoePoints;
    } else if (parsed.bodyMoePoints !== undefined && parsed.bodyMoePoints.join("||") !== currentMoeStr) {
      nextMoe = parsed.bodyMoePoints;
    } else if (parsed.fmMoePoints !== undefined) {
      nextMoe = parsed.fmMoePoints;
    }
    if (nextMoe.join("||") !== currentMoeStr) {
      target.moePoints = nextMoe;
      changed = true;
    }

    if (parsed.personalComment !== undefined && parsed.personalComment !== (target.personalComment || "")) {
      target.personalComment = parsed.personalComment;
      changed = true;
    }
  }

  // 检查是否需要修正笔记内部的「YAML 评分 ↔ 正文表格评分」一致性，或清理历史误注入的「**已观看集数**： 0」
  let fixedContent = rawContent;
  if (parsed.hasStrayWatchedEpisodes) {
    fixedContent = fixedContent.replace(/\r?\n\*\*已观看集数\*\*：\s*\d+[^\S\r\n]*(?:\r?\n)?/g, "\n");
  }
  const desiredScoreStr = Number(target.favoriteScore || 0).toFixed(1);
  if (
    parsed.fmFavoriteScore !== undefined &&
    parsed.bodyFavoriteScore !== undefined &&
    parsed.fmFavoriteScore !== parsed.bodyFavoriteScore
  ) {
    fixedContent = fixedContent.replace(
      /(^\s*个人喜爱度评分\s*:\s*).*/m,
      `$1"${target.favoriteScore}"`
    );
    fixedContent = fixedContent.replace(
      /(\|\s*\*\*个人喜爱度\*\*\s*\|\s*★\s*\*\*)[0-9]+(?:\.[0-9]+)?(\*\*\s*\/\s*10\s*\|)/,
      `$1${desiredScoreStr}$2`
    );
  } else if (parsed.fmFavoriteScore !== undefined && parsed.bodyFavoriteScore !== undefined) {
    // 即使分值相等，也确保正文表格保留最新一位小数展示
    fixedContent = fixedContent.replace(
      /(\|\s*\*\*个人喜爱度\*\*\s*\|\s*★\s*\*\*)[0-9]+(?:\.[0-9]+)?(\*\*\s*\/\s*10\s*\|)/,
      `$1${desiredScoreStr}$2`
    );
  }

  if (fixedContent !== rawContent) {
    if (!(plugin.isPluginWritingNote instanceof Set)) {
      plugin.isPluginWritingNote = new Set();
    }
    plugin.isPluginWritingNote.add(file.path);
    try {
      await plugin.app.vault.modify(file, fixedContent);
    } catch (e) {
      // ignore modify error
    } finally {
      setTimeout(() => {
        if (plugin.isPluginWritingNote instanceof Set) {
          plugin.isPluginWritingNote.delete(file.path);
        }
      }, 400);
    }
  }

  if (changed && !options.skipSave) {
    await plugin.saveSettings();
  }
  return changed;
}

/**
 * 启动或打开角色典藏阁时：
 * 1. 自动迁移旧版「动画笔记/角色典藏」下的角色笔记至与动画笔记并列的同级目录（如「角色典藏」）；
 * 2. 扫描所有角色笔记并将用户在 Markdown 中修改的评分/萌点/手记同步回角色典藏库。
 */
async function reconcileCharacterCollectionWithNotes(plugin) {
  if (!plugin?.app?.vault) return false;
  let anyChanged = false;

  const targetFolder = resolveCharacterNoteFolder(plugin);
  const rootFolder = String(plugin?.settings?.noteRootFolder ?? "动画笔记")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const legacyFolders = Array.from(
    new Set([
      rootFolder ? `${rootFolder}/角色典藏` : "动画笔记/角色典藏",
      "动画笔记/角色典藏"
    ])
  ).filter((f) => f && f !== targetFolder);

  const allMdFiles = plugin.app.vault.getMarkdownFiles ? plugin.app.vault.getMarkdownFiles() : [];

  // 1. 若用户未手动将角色典藏目录设在 legacyFolder，自动将旧目录下的角色笔记迁移至新同级目录
  if (!plugin.settings?.characterNoteFolderManuallySet) {
    for (const legacyDir of legacyFolders) {
      const legacyFiles = allMdFiles.filter((f) => f.path.startsWith(`${legacyDir}/`));
      if (legacyFiles.length > 0) {
        await noteManager.ensureVaultFolder(plugin.app, targetFolder);
        for (const lf of legacyFiles) {
          const newPath = `${targetFolder}/${lf.name}`;
          const existingAtNew = plugin.app.vault.getAbstractFileByPath(newPath);
          try {
            if (!existingAtNew) {
              await plugin.app.fileManager.renameFile(lf, newPath);
            }
            for (const c of plugin.settings.characterCollection || []) {
              if (c && c.notePath === lf.path) {
                c.notePath = newPath;
                anyChanged = true;
              }
            }
          } catch (e) {
            console.warn("[Bangumi Manager] 迁移旧版角色典藏笔记失败:", e);
          }
        }
        // 若旧目录已空，尝试清理空的「动画笔记/角色典藏」目录
        try {
          const oldFolderObj = plugin.app.vault.getAbstractFileByPath(legacyDir);
          if (oldFolderObj && Array.isArray(oldFolderObj.children) && oldFolderObj.children.length === 0) {
            await plugin.app.vault.delete(oldFolderObj);
          }
        } catch (e) {
          // ignore cleanup error
        }
      }
    }
  }

  // 2. 扫描当前角色笔记目录与已关联 notePath 的全部笔记，反向同步至 characterCollection
  const updatedMdFiles = plugin.app.vault.getMarkdownFiles ? plugin.app.vault.getMarkdownFiles() : [];
  const candidateFiles = new Map();
  for (const f of updatedMdFiles) {
    if (isCharacterNotePath(plugin, f)) {
      candidateFiles.set(f.path, f);
    }
  }
  for (const c of plugin.settings.characterCollection || []) {
    const rf = resolveCharacterNoteFile(plugin, c);
    if (rf) candidateFiles.set(rf.path, rf);
  }

  for (const f of candidateFiles.values()) {
    const didChange = await syncCharacterNoteToCollection(plugin, f, { skipSave: true });
    if (didChange) anyChanged = true;
  }

  if (anyChanged) {
    await plugin.saveSettings();
  }
  return anyChanged;
}

/**
 * 生成或更新角色典藏 Markdown 笔记（默认保存在与动画笔记目录并列的 角色典藏/{角色名}.md）
 */
async function createOrUpdateCharacterMarkdownNote(plugin, charRecord) {
  const folder = resolveCharacterNoteFolder(plugin);

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
    `身高: "${String(charRecord.height || "未知").replace(/"/g, '\\"')}"`,
    `发色: "${String(charRecord.hairColor || "未知").replace(/"/g, '\\"')}"`,
    `瞳色: "${String(charRecord.eyeColor || "未知").replace(/"/g, '\\"')}"`,
    `声优: "${String(charRecord.cv || "未知").replace(/"/g, '\\"')}"`,
    `生日: "${String(charRecord.birthday || "未知").replace(/"/g, '\\"')}"`,
    `代表作品: "${String((charRecord.appearances || []).join(" / ") || "未知").replace(/"/g, '\\"')}"`,
    `Bangumi角色页: "${String(charRecord.bgmUrl || "")}"`,
    `萌娘百科: "${String(charRecord.moegirlUrl || `https://moegirl.uk/${encodeURIComponent(charRecord.name || "")}`)}"`,
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
    `| **外部百科** | [Bangumi 角色页](${charRecord.bgmUrl || "https://bgm.tv"}) · [萌娘百科词条](${charRecord.moegirlUrl || `https://mobile.moegirl.org.cn/${encodeURIComponent(charRecord.name || "")}`}) |`,
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
  if (!(plugin.isPluginWritingNote instanceof Set)) {
    plugin.isPluginWritingNote = new Set();
  }
  plugin.isPluginWritingNote.add(filePath);
  try {
    if (existing) {
      await plugin.app.vault.modify(existing, content);
    } else {
      await plugin.app.vault.create(filePath, content);
    }
  } finally {
    setTimeout(() => {
      if (plugin.isPluginWritingNote instanceof Set) {
        plugin.isPluginWritingNote.delete(filePath);
      }
    }, 400);
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
        .replace(/髮/g, "发")
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
    id: "bgm-46465",
    bgmId: "46465",
    bgmUrl: "https://bgm.tv/character/46465",
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
    avatar: "https://lain.bgm.tv/pic/crt/l/c1/30/46465_crt_144I9.jpg",
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
 * 常见动画角色身高内置速查表（当百科词条未单独填写或旧馆藏缺失身高时提供精准默认参考）
 */
const BUILTIN_CHARACTER_HEIGHT_MAP = {
  "洛琪希": 150,
  "洛琪希·米格路迪亚": 150,
  "ロキシー・ミグルディア": 150,
  "爱蜜莉雅": 164,
  "艾米莉亚": 164,
  "エミリア": 164,
  "雷姆": 154,
  "レム": 154,
  "拉姆": 154,
  "ラム": 154,
  "碧翠丝": 140,
  "ベアトリス": 140,
  "芙莉莲": 160,
  "フリーレン": 160,
  "费伦": 168,
  "フェルン": 168,
  "修塔尔克": 178,
  "シュタルク": 178,
  "锦木千束": 162,
  "錦木千束": 162,
  "井之上泷奈": 160,
  "井ノ上たきな": 160,
  "后藤一里": 156,
  "後藤ひとり": 156,
  "喜多郁代": 158,
  "山田凉": 163,
  "山田リョウ": 163,
  "伊地知虹夏": 154,
  "鲁迪乌斯": 175,
  "希露菲叶特": 165,
  "艾莉丝": 170,
  "亚丝娜": 168,
  "结城明日奈": 168,
  "御坂美琴": 161,
  "阿尔托莉雅": 154,
  "椎名真昼": 156,
  "樱岛麻衣": 165,
  "牧濑红莉栖": 160,
  "薇尔莉特": 161,
  "雪之下雪乃": 165,
  "由比滨结衣": 157,
  "一色彩羽": 155,
  "加藤惠": 160,
  "霞之丘诗羽": 168,
  "泽村·斯潘塞·英梨梨": 158,
  "中野一花": 159,
  "中野二乃": 159,
  "中野三玖": 159,
  "中野四叶": 159,
  "中野五月": 159,
  "轻井泽惠": 154,
  "堀北铃音": 156,
  "甘织玲奈子": 158,
  "甘織れな子": 158,
  "王塚真唯": 168,
  "濑名紫阳花": 160,
  "琴纱月": 165,
  "小柳香穗": 152
};

/**
 * 获取角色立绘的取景与等身校准配置（带合理默认值，默认聚焦偏上 14% 以确保长立绘优先呈现人物头部）
 */
function getCharacterPortraitFrame(charItem) {
  const raw = (charItem && typeof charItem.portraitFrame === "object" && charItem.portraitFrame) || {};
  const clamp = (val, min, max, def) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const isV2 = raw.calibVersion === 2;
  const rawBgMode = String(raw.removeSolidBg || "auto").toLowerCase();
  const removeSolidBg = rawBgMode === "on" || rawBgMode === "off" ? rawBgMode : "auto";
  return {
    calibVersion: 2,
    fitMode: raw.fitMode === "contain" ? "contain" : "cover",
    cropX: clamp(raw.cropX, 0, 100, 50),
    cropY: clamp(raw.cropY, 0, 100, 14),
    cropScale: clamp(raw.cropScale, 0.35, 3.2, 1.0),
    heightScale: isV2 ? clamp(raw.heightScale, 0.35, 2.6, 1.0) : 1.0,
    footOffsetPx: isV2 ? clamp(raw.footOffsetPx, -180, 180, 0) : 0,
    standPanX: isV2 ? clamp(raw.standPanX, 0, 100, 50) : 50,
    removeSolidBg
  };
}

// 内存级纯色背景抠图结果缓存（key: `${src}::${mode}::${tol}` -> dataUrl | "SKIP"）
const _characterBgRemovedDataUrlCache = new Map();

/**
 * 零外部依赖 · 边缘种子漫水填充抠图（Edge-Seeded BFS Flood-Fill Chroma-Key）
 * 专门针对人设图常见的纯白 (#ffffff)、浅灰 (#d5d6d8，如槻木汐人设图)、米白等纯色背景：
 * 1. 仅从图片外围四边像素向内做 4-连通漫水填充（BFS），遇到角色轮廓线立即停止，100% 保护角色内部的白衬衫、眼白、高光与浅色服装；
 * 2. 对前景与背景交界处的 1px 边缘像素做平滑 Alpha 羽化与去溢色，消除锯齿白边；
 * 3. 若原图本身已是透明 PNG 或四角为复杂风景插画（非纯色底），在 auto 模式下自动保持原图不误伤。
 */
function removeCharacterSolidBackgroundViaCanvas(imgEl, options = {}) {
  if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight || typeof document === "undefined") {
    return null;
  }
  const mode = options.mode || "auto"; // "auto" | "on" | "off"
  if (mode === "off") return null;

  const rawSrc = String(imgEl.dataset?.origSrc || imgEl.getAttribute("src") || imgEl.src || "");
  if (!rawSrc) return null;
  const tol = Number(options.tolerance) || (mode === "on" ? 42 : 34);
  const cacheKey = `${rawSrc}::${mode}::${tol}`;
  if (_characterBgRemovedDataUrlCache.has(cacheKey)) {
    const cached = _characterBgRemovedDataUrlCache.get(cacheKey);
    return cached === "SKIP" ? null : cached;
  }

  try {
    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    const maxDim = 680;
    const scale = Math.min(1, maxDim / Math.max(natW, natH));
    const w = Math.max(24, Math.round(natW * scale));
    const h = Math.max(24, Math.round(natH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(imgEl, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const getRgba = (x, y) => {
      const idx = (y * w + x) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    };

    // 1. 检查外围四角是否已经是透明背景（用户自己导入的透明 PNG）
    const cornerCoords = [
      [1, 1],
      [w - 2, 1],
      [1, Math.min(h - 2, Math.round(h * 0.25))],
      [w - 2, Math.min(h - 2, Math.round(h * 0.25))]
    ];
    let transparentCorners = 0;
    for (const [cx, cy] of cornerCoords) {
      if (getRgba(cx, cy)[3] < 40) transparentCorners++;
    }
    if (transparentCorners >= 2) {
      _characterBgRemovedDataUrlCache.set(cacheKey, "SKIP");
      return null;
    }

    // 2. 采样上边缘与左右边缘上半部分的像素，聚类估算背景主色 (bgR, bgG, bgB)
    const borderSamples = [];
    const stepX = Math.max(2, Math.floor(w / 14));
    const stepY = Math.max(2, Math.floor(h / 18));
    for (let x = 1; x < w - 1; x += stepX) {
      borderSamples.push(getRgba(x, 1));
    }
    for (let y = 1; y < Math.floor(h * 0.82); y += stepY) {
      borderSamples.push(getRgba(1, y));
      borderSamples.push(getRgba(w - 2, y));
    }

    // 寻找拥有最多相近邻居的外围样本作为背景基准色
    let bestSample = borderSamples[0] || [255, 255, 255, 255];
    let bestInliers = 0;
    for (let i = 0; i < borderSamples.length; i++) {
      const s = borderSamples[i];
      if (s[3] < 180) continue;
      let inliers = 0;
      for (let j = 0; j < borderSamples.length; j++) {
        const t = borderSamples[j];
        const dist = Math.hypot(s[0] - t[0], s[1] - t[1], s[2] - t[2]);
        if (dist <= 22) inliers++;
      }
      if (inliers > bestInliers) {
        bestInliers = inliers;
        bestSample = s;
      }
    }

    const inlierRatio = borderSamples.length > 0 ? bestInliers / borderSamples.length : 0;
    // 在 auto 模式下，要求外围至少 42% 的边缘是一致的纯色底，避免把复杂风景背景抠碎
    if (mode === "auto" && inlierRatio < 0.42) {
      _characterBgRemovedDataUrlCache.set(cacheKey, "SKIP");
      return null;
    }

    // 计算内点均值作为精确背景色
    let sumR = 0,
      sumG = 0,
      sumB = 0,
      cnt = 0;
    for (const t of borderSamples) {
      if (Math.hypot(bestSample[0] - t[0], bestSample[1] - t[1], bestSample[2] - t[2]) <= 22) {
        sumR += t[0];
        sumG += t[1];
        sumB += t[2];
        cnt++;
      }
    }
    const bgR = cnt > 0 ? Math.round(sumR / cnt) : bestSample[0];
    const bgG = cnt > 0 ? Math.round(sumG / cnt) : bestSample[1];
    const bgB = cnt > 0 ? Math.round(sumB / cnt) : bestSample[2];

    // 3. 从四条外边界注入漫水填充种子（Edge-Seeded BFS）
    const totalPixels = w * h;
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let qHead = 0;
    let qTail = 0;

    const colorDistToBg = (idx4) => {
      const dr = data[idx4] - bgR;
      const dg = data[idx4 + 1] - bgG;
      const db = data[idx4 + 2] - bgB;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    const tryEnqueueSeed = (x, y) => {
      const pIdx = y * w + x;
      if (visited[pIdx]) return;
      const idx4 = pIdx * 4;
      if (colorDistToBg(idx4) <= tol) {
        visited[pIdx] = 1;
        queue[qTail++] = pIdx;
      }
    };

    for (let x = 0; x < w; x++) {
      tryEnqueueSeed(x, 0);
      tryEnqueueSeed(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      tryEnqueueSeed(0, y);
      tryEnqueueSeed(w - 1, y);
    }

    const stepTol = mode === "on" ? 26 : 20;
    while (qHead < qTail) {
      const curr = queue[qHead++];
      const cx = curr % w;
      const cy = (curr - cx) / w;
      const cIdx4 = curr * 4;
      const cr = data[cIdx4];
      const cg = data[cIdx4 + 1];
      const cb = data[cIdx4 + 2];

      // 4-连通邻居检查
      const neighbors = [];
      if (cx > 0) neighbors.push(curr - 1);
      if (cx < w - 1) neighbors.push(curr + 1);
      if (cy > 0) neighbors.push(curr - w);
      if (cy < h - 1) neighbors.push(curr + w);

      for (let i = 0; i < neighbors.length; i++) {
        const nIdx = neighbors[i];
        if (visited[nIdx]) continue;
        const nIdx4 = nIdx * 4;
        const distBg = colorDistToBg(nIdx4);
        if (distBg <= tol) {
          const stepDiff = Math.max(
            Math.abs(data[nIdx4] - cr),
            Math.abs(data[nIdx4 + 1] - cg),
            Math.abs(data[nIdx4 + 2] - cb)
          );
          if (stepDiff <= stepTol) {
            visited[nIdx] = 1;
            queue[qTail++] = nIdx;
          }
        }
      }
    }

    // 若漫水填充消除的像素少于总面积的 4%，说明并非纯色背景立绘
    if (qTail < totalPixels * 0.04) {
      _characterBgRemovedDataUrlCache.set(cacheKey, "SKIP");
      return null;
    }

    // 4. 应用背景透明化与交界边缘 1px 柔化抗锯齿羽化
    const featherLimit = tol * 1.55;
    for (let p = 0; p < totalPixels; p++) {
      const idx4 = p * 4;
      if (visited[p] === 1) {
        data[idx4 + 3] = 0;
        continue;
      }
      const x = p % w;
      const y = (p - x) / w;
      const touchesBg =
        (x > 0 && visited[p - 1] === 1) ||
        (x < w - 1 && visited[p + 1] === 1) ||
        (y > 0 && visited[p - w] === 1) ||
        (y < h - 1 && visited[p + w] === 1);
      if (touchesBg) {
        const distBg = colorDistToBg(idx4);
        if (distBg < featherLimit) {
          const ratio = Math.max(0.12, Math.min(1, (distBg - tol * 0.35) / (featherLimit - tol * 0.35)));
          data[idx4 + 3] = Math.round(data[idx4 + 3] * ratio);
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const outDataUrl = canvas.toDataURL("image/png");
    if (_characterBgRemovedDataUrlCache.size > 80) {
      const firstKey = _characterBgRemovedDataUrlCache.keys().next().value;
      _characterBgRemovedDataUrlCache.delete(firstKey);
    }
    _characterBgRemovedDataUrlCache.set(cacheKey, outDataUrl);
    return outDataUrl;
  } catch (err) {
    return null;
  }
}

/**
 * 智能扫描角色立绘图片的上下有效像素边界（自动识别透明像素或纯白/纯色背景留白）
 * 返回 { topRatio, bottomRatio, heightScale, footOffsetPx }，使角色头顶恰好对齐目标身高线、脚底恰好踩在 0cm 基准线
 */
function detectImageVerticalSubjectBounds(imgEl, targetPx = 280) {
  const fallback = { topRatio: 0, bottomRatio: 1, heightScale: 1.0, footOffsetPx: 0 };
  if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight || typeof document === "undefined") {
    return fallback;
  }
  try {
    const sampleW = 96;
    const sampleH = 192;
    const canvas = document.createElement("canvas");
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.drawImage(imgEl, 0, 0, sampleW, sampleH);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

    const getPixel = (x, y) => {
      const idx = (y * sampleW + x) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    };
    const corners = [
      getPixel(1, 1),
      getPixel(sampleW - 2, 1),
      getPixel(1, sampleH - 2),
      getPixel(sampleW - 2, sampleH - 2)
    ];
    const bgR = corners[0][0];
    const bgG = corners[0][1];
    const bgB = corners[0][2];

    const isForegroundPixel = (r, g, b, a) => {
      if (a < 24) return false;
      if (r > 246 && g > 246 && b > 246) return false;
      const diffCorner = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      if (corners[0][3] > 200 && diffCorner < 32) return false;
      return true;
    };

    let topRow = 0;
    let bottomRow = sampleH - 1;

    for (let y = 0; y < sampleH; y++) {
      let fgCount = 0;
      for (let x = 2; x < sampleW - 2; x++) {
        const idx = (y * sampleW + x) * 4;
        if (isForegroundPixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) {
          fgCount++;
        }
      }
      if (fgCount >= 2) {
        topRow = y;
        break;
      }
    }

    for (let y = sampleH - 1; y >= topRow; y--) {
      let fgCount = 0;
      for (let x = 2; x < sampleW - 2; x++) {
        const idx = (y * sampleW + x) * 4;
        if (isForegroundPixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])) {
          fgCount++;
        }
      }
      if (fgCount >= 2) {
        bottomRow = y;
        break;
      }
    }

    const topRatio = Math.max(0, Math.min(0.45, topRow / sampleH));
    const bottomRatio = Math.max(0.55, Math.min(1.0, (bottomRow + 1) / sampleH));
    const span = Math.max(0.35, bottomRatio - topRatio);
    const heightScale = Math.max(0.5, Math.min(2.4, Math.round((1 / span) * 100) / 100));
    const footOffsetPx = Math.max(
      -160,
      Math.min(160, -Math.round((1 - bottomRatio) * targetPx * heightScale))
    );
    return { topRatio, bottomRatio, heightScale, footOffsetPx };
  } catch (_) {
    return fallback;
  }
}

/**
 * 将角色取景参数（位置、缩放、完整适应/聚焦取景）无内部裁切地应用到卡片或预览区的 <img> 与容器上
 * 核心修复：
 * 严禁在 transform: scale(...) 时继续使用 width: 100%; height: 100%; object-fit: cover！
 * 因为 CSS 的 object-fit: cover 会先把 <img> 自身的位图硬裁切成小框，再把这个已经被砍掉头脚的残缺矩形缩小（导致缩小到 50% 时人物依然没有头和脚）。
 * 正确做法：让 <img> 元素始终保持原图真实长宽比（完整保留 100% 原始像素），仅靠外层容器 overflow: hidden 搭配 translate + scale 实现无损取景与缩放！
 */
function applyCharacterPortraitFrameToImg(imgEl, containerEl, charItem) {
  if (!imgEl) return;
  const frame = getCharacterPortraitFrame(charItem);
  if (containerEl) {
    containerEl.toggleClass("is-fit-contain", frame.fitMode === "contain");
    containerEl.toggleClass("is-fit-cover", frame.fitMode !== "contain");
  }

  const applyUnclippedLayout = () => {
    const f = getCharacterPortraitFrame(charItem);
    const natW = imgEl.naturalWidth || 0;
    const natH = imgEl.naturalHeight || 0;
    if (natW > 0 && natH > 0 && charItem && typeof charItem === "object") {
      charItem._naturalAspect = natW / natH;
      charItem._naturalWidth = natW;
      charItem._naturalHeight = natH;
    }

    const imgAspect =
      natW > 0 && natH > 0
        ? natW / natH
        : Number(charItem?._naturalAspect) > 0
        ? Number(charItem._naturalAspect)
        : 0.56;

    // 统一采用标准典藏肖像画框纵横比 (76:106 ≈ 172:240 ≈ 0.71698)，确保「交互式取景视窗」「档案卡片预览」与「真实角色卡片」三端取景 100% 像素级一致
    const CANONICAL_PORTRAIT_ASPECT = 76 / 106;
    const isStandardPortraitBox =
      !containerEl ||
      containerEl.classList?.contains("curator-char-card-avatar") ||
      containerEl.classList?.contains("curator-studio-mini-ava") ||
      containerEl.classList?.contains("curator-studio-viewport-box");
    const boxW = !isStandardPortraitBox && containerEl && containerEl.clientWidth > 10 ? containerEl.clientWidth : 76;
    const boxH = !isStandardPortraitBox && containerEl && containerEl.clientHeight > 10 ? containerEl.clientHeight : 106;
    const boxAspect = isStandardPortraitBox ? CANONICAL_PORTRAIT_ASPECT : boxW / Math.max(1, boxH);

    // 重要修复：严禁在 Flex 容器 (.curator-char-card-avatar) 内对 <img> 设置 width: auto！
    // 在 Chromium Flexbox 中，当 imgAspect >= boxAspect（如丰川祥子 1397×1785, aspect=0.783 > 0.717）时，
    // height: 100%; width: auto 会导致主轴宽度回退为原图物理像素宽度 (1397px)，致使真实卡片与预览图被放大十余倍只剩腰部！
    // 统一使用显式百分比 width 与 height，完全杜绝 Flexbox 主轴尺寸坍缩或暴涨。
    imgEl.style.setProperty("object-fit", "fill", "important");
    imgEl.style.setProperty("object-position", "center center", "important");
    imgEl.style.setProperty("max-width", "none", "important");
    imgEl.style.setProperty("max-height", "none", "important");
    imgEl.style.setProperty("min-width", "0", "important");
    imgEl.style.setProperty("min-height", "0", "important");
    imgEl.style.setProperty("flex-shrink", "0", "important");
    imgEl.style.transformOrigin = "50% 50%";

    if (f.fitMode === "contain") {
      // 全身完整容纳模式 (Contain)：在 100% 倍率下完整显示整张原图（绝不截断头脚），支持自由平移与缩放
      if (imgAspect < boxAspect) {
        const wPct = Math.round((imgAspect / boxAspect) * 10000) / 100;
        imgEl.style.setProperty("width", `${wPct}%`, "important");
        imgEl.style.setProperty("height", "100%", "important");
      } else {
        const hPct = Math.round((boxAspect / imgAspect) * 10000) / 100;
        imgEl.style.setProperty("width", "100%", "important");
        imgEl.style.setProperty("height", `${hPct}%`, "important");
      }
      const shiftX = Math.round((50 - f.cropX) * 0.65 * 10) / 10;
      const shiftY = Math.round((50 - f.cropY) * 0.65 * 10) / 10;
      imgEl.style.transform =
        f.cropScale !== 1 || shiftX !== 0 || shiftY !== 0
          ? `translate(${shiftX}%, ${shiftY}%) scale(${f.cropScale})`
          : "none";
      return;
    }

    // 智能填充取景模式 (Cover)：<img> 通过显式百分比保持完整未裁切原图比例！
    if (imgAspect < boxAspect) {
      // 竖长立绘：宽度撑满容器 100%，高度按原图比例显式设定百分比 (>100%)
      const relH = Math.max(1.0, boxAspect / Math.max(0.08, imgAspect));
      const hPct = Math.round(relH * 10000) / 100;
      imgEl.style.setProperty("width", "100%", "important");
      imgEl.style.setProperty("height", `${hPct}%`, "important");

      const baseMaxPanY = (1 - 1 / relH) * 50;
      const zoomDampY =
        f.cropScale < 1
          ? Math.max(0.22, Math.min(1, (relH * f.cropScale - 0.85) / Math.max(0.15, relH - 0.85)))
          : 1 + (f.cropScale - 1) * 0.35;
      const maxPanYPct = Math.max(14, baseMaxPanY * zoomDampY);
      const maxPanXPct = f.cropScale > 1 ? ((f.cropScale - 1) / (2 * f.cropScale)) * 100 + 18 : 26;

      const txPct = Math.round(((50 - f.cropX) / 50) * maxPanXPct * 100) / 100;
      const tyPct = Math.round(((50 - f.cropY) / 50) * maxPanYPct * 100) / 100;
      imgEl.style.transform = `translate(${txPct}%, ${tyPct}%) scale(${f.cropScale})`;
    } else {
      // 较宽立绘（如丰川祥子 1397×1785）：高度撑满容器 100%，宽度按原图比例显式设定百分比 (>100%)，严禁使用 width: auto！
      const relW = Math.max(1.0, imgAspect / Math.max(0.08, boxAspect));
      const wPct = Math.round(relW * 10000) / 100;
      imgEl.style.setProperty("width", `${wPct}%`, "important");
      imgEl.style.setProperty("height", "100%", "important");

      const baseMaxPanX = (1 - 1 / relW) * 50;
      const zoomDampX =
        f.cropScale < 1
          ? Math.max(0.22, Math.min(1, (relW * f.cropScale - 0.85) / Math.max(0.15, relW - 0.85)))
          : 1 + (f.cropScale - 1) * 0.35;
      const maxPanXPct = Math.max(14, baseMaxPanX * zoomDampX);
      const maxPanYPct = f.cropScale > 1 ? ((f.cropScale - 1) / (2 * f.cropScale)) * 100 + 18 : 26;

      const txPct = Math.round(((50 - f.cropX) / 50) * maxPanXPct * 100) / 100;
      const tyPct = Math.round(((50 - f.cropY) / 50) * maxPanYPct * 100) / 100;
      imgEl.style.transform = `translate(${txPct}%, ${tyPct}%) scale(${f.cropScale})`;
    }
  };

  imgEl.__bgmLatestApplyLayout = applyUnclippedLayout;
  applyUnclippedLayout();

  if (!imgEl.__bgmFrameLoadBound) {
    imgEl.__bgmFrameLoadBound = true;
    imgEl.addEventListener("load", () => {
      if (typeof imgEl.__bgmLatestApplyLayout === "function") {
        imgEl.__bgmLatestApplyLayout();
      }
    });
  }
}

/**
 * 解析角色的数值身高（单位 cm），支持 "164cm"、"约150cm"、"1.58m"、内置角色速查表及特征估算兜底
 */
function parseCharacterHeightCm(charItem) {
  if (!charItem) return { cm: 158, isEstimated: true, displayLabel: "≈158cm" };
  const rawStr = String(charItem.height || "").trim();
  if (rawStr) {
    // 优先匹配米制（如 1.58m / 1.64米）
    const meterMatch = rawStr.match(/\b([12]\.\d{1,2})\s*(?:m|米)\b/i);
    if (meterMatch) {
      const cmFromM = Math.round(Number(meterMatch[1]) * 100);
      if (cmFromM >= 30 && cmFromM <= 260) {
        return { cm: cmFromM, isEstimated: false, displayLabel: `${cmFromM}cm` };
      }
    }
    // 匹配厘米数值（如 164cm / 150 cm / 约158厘米 / 164）
    const cmMatch = rawStr.match(/(\d{2,3}(?:\.\d)?)\s*(?:cm|厘米|公分)?/i);
    if (cmMatch) {
      const val = Math.round(Number(cmMatch[1]) * 10) / 10;
      if (val >= 30 && val <= 260) {
        return { cm: val, isEstimated: false, displayLabel: `${val}cm` };
      }
    }
  }

  // 检查内置常见角色真实身高表
  const candidates = [
    charItem.name,
    charItem.nameJp,
    String(charItem.name || "").split(/[·・•‧\s]+/)[0],
    ...(charItem.aliases || [])
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  for (const key of candidates) {
    if (BUILTIN_CHARACTER_HEIGHT_MAP[key]) {
      const knownCm = BUILTIN_CHARACTER_HEIGHT_MAP[key];
      return { cm: knownCm, isEstimated: false, displayLabel: `${knownCm}cm` };
    }
  }

  // 根据萌点或性别温和估算（标记为 isEstimated 供用户直观识别与校准）
  const moeJoin = (charItem.moePoints || []).join(" ");
  if (/萝莉|合法萝莉|幼女|娇小/.test(moeJoin)) {
    return { cm: 146, isEstimated: true, displayLabel: "≈146cm" };
  }
  if (/高个女|御姐|长腿|高挑/.test(moeJoin)) {
    return { cm: 168, isEstimated: true, displayLabel: "≈168cm" };
  }
  if (/男|少年|青年/.test(String(charItem.gender || ""))) {
    return { cm: 173, isEstimated: true, displayLabel: "≈173cm" };
  }
  return { cm: 158, isEstimated: true, displayLabel: "≈158cm" };
}

/**
 * 将用户上传或粘贴的图片二进制数据保存为该角色的自定义本地立绘
 */
async function saveCustomCharacterImageFromBuffer(plugin, charItem, arrayBuffer, extHint = "png") {
  const app = plugin?.app;
  if (!app?.vault || !arrayBuffer) return "";
  const folder = String(plugin?.settings?.coverFolder || "附件/Bangumi Images")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  await noteManager.ensureVaultFolder(app, folder);

  const rawId = String(charItem?.bgmId || charItem?.id || Date.now())
    .replace(/^char-|^bgm-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanExt = String(extHint || "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "png";
  const fileName = `bangumi-cover-char-${rawId}-custom-${Date.now()}.${cleanExt}`;
  const targetPath = `${folder}/${fileName}`;

  const existing = app.vault.getAbstractFileByPath(targetPath);
  if (existing && typeof app.vault.modifyBinary === "function") {
    await app.vault.modifyBinary(existing, arrayBuffer);
  } else if (typeof app.vault.createBinary === "function") {
    await app.vault.createBinary(targetPath, arrayBuffer);
  } else if (app.vault.adapter && typeof app.vault.adapter.writeBinary === "function") {
    await app.vault.adapter.writeBinary(targetPath, arrayBuffer);
  }
  return targetPath;
}

/**
 * 从远程 URL 或 Vault 内部路径保存/绑定角色自定义图片
 */
async function saveCustomCharacterImageFromUrlOrPath(plugin, charItem, inputUrlOrPath) {
  const app = plugin?.app;
  const cleanInput = String(inputUrlOrPath || "").trim();
  if (!cleanInput || !app?.vault) return { localAvatar: "", avatar: "" };

  // 1. 若输入为 Vault 内部已存在的图片路径
  const normVaultPath = cleanInput.replace(/\\/g, "/").replace(/^\/+/, "");
  const vaultFile = app.vault.getAbstractFileByPath(normVaultPath);
  if (vaultFile) {
    return { localAvatar: vaultFile.path, avatar: charItem.avatar || "" };
  }

  // 2. 若输入为远程 HTTP(S) 图片链接，尝试下载并写入自定义本地立绘文件
  if (/^https?:\/\//i.test(cleanInput)) {
    try {
      const resp = await requestBufferWithHostFallback(cleanInput, 10000);
      if (resp && resp.buffer && resp.buffer.byteLength > 200) {
        const urlExtMatch = cleanInput.split("?")[0].match(/\.(png|jpe?g|webp|gif|avif)$/i);
        const ext = urlExtMatch ? urlExtMatch[1].toLowerCase() : "jpg";
        const savedPath = await saveCustomCharacterImageFromBuffer(plugin, charItem, resp.buffer, ext);
        if (savedPath) {
          return { localAvatar: savedPath, avatar: cleanInput };
        }
      }
    } catch (e) {
      console.warn("[BangumiManager] 下载自定义角色图片回退为远程直连:", e);
    }
    return { localAvatar: "", avatar: cleanInput };
  }

  return { localAvatar: "", avatar: cleanInput };
}

/**
 * 弹出「🖼️ 角色立绘取景、换图与等身标尺校准工坊」模态框
 * 支持：
 * 1. 鼠标拖拽平移焦点 (cropX/cropY)、滚轮无级缩放 (cropScale)
 * 2. 切换「智能填充裁切 (Cover)」与「全身完整容纳 (Contain，彻底解决超长立绘截断头部/全身问题)」
 * 3. 一键预设对焦（头部黄金对焦 / 面部特写 / 全身完整呈现 / 重置）
 * 4. 更换为自定义角色图片（本地文件上传、Ctrl+V 剪贴板粘贴、拖拽图片、输入 URL/仓库路径、一键获取萌娘百科全身立绘）
 * 5. 等身标尺与脚底基准校准（直接拖拽立绘对齐 0cm 脚底线与头顶目标身高线）
 */
function openCharacterPortraitStudioModal(plugin, charRecord, onAfterSaved, initialTab = "frame") {
  if (!plugin?.app || !charRecord) return null;

  const initFrame = getCharacterPortraitFrame(charRecord);
  const parsedHeightInfo = parseCharacterHeightCm(charRecord);

  const draftState = {
    activeTab: initialTab === "height" ? "height" : "frame",
    fitMode: initFrame.fitMode,
    cropX: initFrame.cropX,
    cropY: initFrame.cropY,
    cropScale: initFrame.cropScale,
    heightScale: initFrame.heightScale,
    footOffsetPx: initFrame.footOffsetPx,
    standPanX: initFrame.standPanX,
    removeSolidBg: initFrame.removeSolidBg || "auto",
    heightCm: parsedHeightInfo.cm,
    heightRawText: charRecord.height || `${parsedHeightInfo.cm}cm`,
    localAvatar: charRecord.localAvatar || "",
    avatar: charRecord.avatar || "",
    hasCustomAvatar: Boolean(charRecord.hasCustomAvatar)
  };

  class CharacterPortraitStudioModal extends Modal {
    onOpen() {
      const { contentEl, modalEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-portrait-studio-modal");
      if (modalEl) {
        modalEl.addClass("curator-portrait-studio-shell");
      }

      const header = contentEl.createDiv("curator-dl-header curator-studio-header");
      const titleLeft = header.createDiv("curator-studio-header-left");
      titleLeft.createDiv({
        cls: "curator-dl-kicker",
        text: "PORTRAIT FRAMING & HEIGHT CALIBRATION STUDIO · 角色立绘取景与等身工坊"
      });
      titleLeft.createEl("h3", {
        cls: "curator-dl-title",
        text: `🖼️ 《${charRecord.name || "角色"}》立绘取景、换图与等身校准`
      });

      const tabSwitchBar = header.createDiv("curator-studio-tab-bar");
      const tabFrameBtn = tabSwitchBar.createEl("button", {
        cls: `curator-dl-mini-btn ${draftState.activeTab === "frame" ? "is-active" : ""}`,
        text: "🎞️ 画框取景与换图"
      });
      const tabHeightBtn = tabSwitchBar.createEl("button", {
        cls: `curator-dl-mini-btn ${draftState.activeTab === "height" ? "is-active" : ""}`,
        text: "📏 等身标尺与脚底校准"
      });

      const bodyWrap = contentEl.createDiv("curator-studio-body");

      // 解析当前草稿状态下的可渲染图片地址
      const getDraftImgSrc = () => {
        const tempItem = {
          ...charRecord,
          localAvatar: draftState.localAvatar,
          avatar: draftState.avatar,
          hasCustomAvatar: draftState.hasCustomAvatar
        };
        return resolveCharacterAvatarSrc(plugin, tempItem) || draftState.avatar || "";
      };

      // 粘贴图片事件监听（支持在模态框内直接按 Ctrl+V 粘贴截图或复制的图片）
      this._pasteHandler = async (ev) => {
        const items = ev.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type && item.type.startsWith("image/")) {
            ev.preventDefault();
            const blob = item.getAsFile();
            if (!blob) continue;
            const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
            const buf = await blob.arrayBuffer();
            const savedPath = await saveCustomCharacterImageFromBuffer(plugin, charRecord, buf, ext);
            if (savedPath) {
              draftState.localAvatar = savedPath;
              draftState.hasCustomAvatar = true;
              if (Notice) new Notice("✨ 已从剪贴板粘贴并应用自定义角色立绘！");
              renderActiveTabContent();
            }
            return;
          }
        }
      };
      window.addEventListener("paste", this._pasteHandler);

      const renderActiveTabContent = () => {
        bodyWrap.empty();
        tabFrameBtn.toggleClass("is-active", draftState.activeTab === "frame");
        tabHeightBtn.toggleClass("is-active", draftState.activeTab === "height");

        if (draftState.activeTab === "frame") {
          renderFramingAndCustomImageTab(bodyWrap);
        } else {
          renderHeightCalibrationTab(bodyWrap);
        }
      };

      tabFrameBtn.onclick = (e) => {
        e.preventDefault();
        draftState.activeTab = "frame";
        renderActiveTabContent();
      };
      tabHeightBtn.onclick = (e) => {
        e.preventDefault();
        draftState.activeTab = "height";
        renderActiveTabContent();
      };

      // ==================== Tab 1：画框取景与自定义换图 ====================
      const renderFramingAndCustomImageTab = (host) => {
        const splitGrid = host.createDiv("curator-studio-grid");
        const stageCol = splitGrid.createDiv("curator-studio-stage-col");
        const ctrlCol = splitGrid.createDiv("curator-studio-ctrl-col");

        stageCol.createDiv({
          cls: "curator-studio-stage-caption",
          text: "💡 鼠标按住立绘可直接拖拽选定位置，滚动滚轮可缩放大小；支持直接拖拽图片文件或按 Ctrl+V 粘贴换图"
        });

        const previewPair = stageCol.createDiv("curator-studio-preview-pair");

        // 左侧：大尺寸交互取景器（模拟卡片/画报立绘窗）
        const mainViewportWrap = previewPair.createDiv("curator-studio-viewport-wrap");
        mainViewportWrap.createDiv({
          cls: "curator-studio-sub-label",
          text: "📐 交互式取景视窗（拖拽平移 / 滚轮缩放）"
        });
        const viewportBox = mainViewportWrap.createDiv("curator-studio-viewport");
        const viewImg = viewportBox.createEl("img", {
          cls: "curator-studio-viewport-img",
          attr: { alt: charRecord.name || "角色立绘" }
        });
        const crosshair = viewportBox.createDiv("curator-studio-crosshair");
        const modeBadge = viewportBox.createDiv("curator-studio-mode-badge curator-mono");

        // 右侧：实际档案卡片头像实时同步预览 + 原图完整全览对比窗
        const miniCardWrap = previewPair.createDiv("curator-studio-minicard-wrap");
        miniCardWrap.createDiv({
          cls: "curator-studio-sub-label",
          text: "📇 档案卡片预览"
        });
        const miniCard = miniCardWrap.createDiv("curator-studio-minicard");
        const miniAvatarBox = miniCard.createDiv("curator-char-card-avatar curator-studio-mini-ava");
        const miniImg = miniAvatarBox.createEl("img", {
          attr: { alt: charRecord.name || "角色" }
        });
        const miniBadge = miniAvatarBox.createDiv("curator-char-score-badge curator-mono");
        miniBadge.setText(`★ ${Number(charRecord.favoriteScore || 9.5).toFixed(1)}`);
        const miniMeta = miniCard.createDiv("curator-studio-mini-meta");
        miniMeta.createDiv({ cls: "curator-studio-mini-name", text: charRecord.name || "未命名角色" });
        miniMeta.createDiv({
          cls: "curator-studio-mini-sub curator-mono",
          text: `${draftState.heightCm}cm · ${charRecord.cv || "CV"}`
        });

        // 新增：100% 完整原图无裁切全览框（让用户导入或调整人设图时始终能看清整张原图的完整大小与头脚边界）
        const fullOrigBar = stageCol.createDiv("curator-studio-orig-full-bar");
        const fullOrigThumbBox = fullOrigBar.createDiv("curator-studio-orig-thumb-box");
        const fullOrigImg = fullOrigThumbBox.createEl("img", {
          cls: "curator-studio-orig-thumb-img",
          attr: { alt: "原图完整全览" }
        });
        const fullOrigInfo = fullOrigBar.createDiv("curator-studio-orig-info");
        fullOrigInfo.createDiv({
          cls: "curator-studio-orig-title",
          text: "🔍 导入原图完整全览（100% 无裁切原貌参考）"
        });
        const fullOrigDimText = fullOrigInfo.createDiv({
          cls: "curator-studio-orig-dims curator-mono",
          text: "正在读取原图尺寸…"
        });
        const fullOrigQuickBtns = fullOrigInfo.createDiv("curator-studio-orig-quick-btns");
        const quickFullBodyBtn = fullOrigQuickBtns.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🧍 卡片显示完整全身"
        });
        const quickHeadFocusBtn = fullOrigQuickBtns.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🎯 卡片聚焦头部半身"
        });

        let xSlider = null;
        let ySlider = null;
        let scaleSlider = null;
        let xValSpan = null;
        let yValSpan = null;
        let scaleValSpan = null;
        let coverModeBtn = null;
        let containModeBtn = null;

        fullOrigImg.onload = () => {
          const nw = fullOrigImg.naturalWidth || 0;
          const nh = fullOrigImg.naturalHeight || 0;
          if (nw > 0 && nh > 0) {
            charRecord._naturalAspect = nw / nh;
            const ratioStr = (nh / nw).toFixed(2);
            const shapeTag =
              nh / nw >= 1.75
                ? "超长全身人设立绘"
                : nh / nw >= 1.25
                ? "标准竖向立绘"
                : "方形/横向画幅";
            fullOrigDimText.setText(`原图分辨率：${nw} × ${nh} px（高宽比 ${ratioStr}:1 · ${shapeTag}）`);
          }
        };

        const syncFrameVisuals = (withSpring = false) => {
          const src = getDraftImgSrc();
          if (src && viewImg.getAttribute("src") !== src) {
            viewImg.src = src;
            miniImg.src = src;
            fullOrigImg.src = src;
          }
          if (withSpring) {
            viewImg.addClass("is-spring-animating");
            miniImg.addClass("is-spring-animating");
            setTimeout(() => {
              viewImg.removeClass("is-spring-animating");
              miniImg.removeClass("is-spring-animating");
            }, 340);
          }
          const tempChar = {
            _naturalAspect:
              (viewImg.naturalWidth && viewImg.naturalHeight
                ? viewImg.naturalWidth / viewImg.naturalHeight
                : charRecord._naturalAspect) || 0.56,
            portraitFrame: {
              fitMode: draftState.fitMode,
              cropX: draftState.cropX,
              cropY: draftState.cropY,
              cropScale: draftState.cropScale
            }
          };
          applyCharacterPortraitFrameToImg(viewImg, viewportBox, tempChar);
          applyCharacterPortraitFrameToImg(miniImg, miniAvatarBox, tempChar);

          if (coverModeBtn) coverModeBtn.toggleClass("is-active", draftState.fitMode === "cover");
          if (containModeBtn) containModeBtn.toggleClass("is-active", draftState.fitMode === "contain");

          modeBadge.setText(
            draftState.fitMode === "contain"
              ? `全身完整容纳 (Contain) · ${Math.round(draftState.cropScale * 100)}%`
              : `无损取景 (Cover) · X:${Math.round(draftState.cropX)}% Y:${Math.round(draftState.cropY)}% · ${Math.round(draftState.cropScale * 100)}%`
          );
          crosshair.style.left = `${draftState.cropX}%`;
          crosshair.style.top = `${draftState.cropY}%`;
          crosshair.style.opacity = draftState.fitMode === "contain" ? "0.25" : "0.85";

          if (xSlider) xSlider.value = String(Math.round(draftState.cropX));
          if (ySlider) ySlider.value = String(Math.round(draftState.cropY));
          if (scaleSlider) scaleSlider.value = String(Math.round(draftState.cropScale * 100));
          if (xValSpan) xValSpan.setText(`${Math.round(draftState.cropX)}%`);
          if (yValSpan) yValSpan.setText(`${Math.round(draftState.cropY)}%`);
          if (scaleValSpan) scaleValSpan.setText(`${Math.round(draftState.cropScale * 100)}%`);
        };

        quickFullBodyBtn.onclick = (e) => {
          e.preventDefault();
          draftState.fitMode = "contain";
          draftState.cropX = 50;
          draftState.cropY = 50;
          draftState.cropScale = 1.0;
          syncFrameVisuals(true);
        };
        quickHeadFocusBtn.onclick = (e) => {
          e.preventDefault();
          draftState.fitMode = "cover";
          draftState.cropX = 50;
          draftState.cropY = 12;
          draftState.cropScale = 1.05;
          syncFrameVisuals(true);
        };

        // 鼠标拖拽平移取景框
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startCropX = 50;
        let startCropY = 14;

        viewportBox.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          isDragging = true;
          startX = ev.clientX;
          startY = ev.clientY;
          startCropX = draftState.cropX;
          startCropY = draftState.cropY;
          viewportBox.addClass("is-dragging");
          try {
            viewportBox.setPointerCapture(ev.pointerId);
          } catch (_) {}
        });

        viewportBox.addEventListener("pointermove", (ev) => {
          if (!isDragging) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const sensitivity = 0.35 / Math.max(0.6, draftState.cropScale);
          draftState.cropX = Math.max(0, Math.min(100, Math.round((startCropX - dx * sensitivity) * 10) / 10));
          draftState.cropY = Math.max(0, Math.min(100, Math.round((startCropY - dy * sensitivity) * 10) / 10));
          syncFrameVisuals(false);
        });

        const endDrag = () => {
          if (!isDragging) return;
          isDragging = false;
          viewportBox.removeClass("is-dragging");
        };
        viewportBox.addEventListener("pointerup", endDrag);
        viewportBox.addEventListener("pointercancel", endDrag);

        // 鼠标滚轮缩放
        viewportBox.addEventListener(
          "wheel",
          (ev) => {
            ev.preventDefault();
            const delta = ev.deltaY < 0 ? 0.08 : -0.08;
            draftState.cropScale = Math.max(
              0.35,
              Math.min(3.2, Math.round((draftState.cropScale + delta) * 100) / 100)
            );
            syncFrameVisuals(false);
          },
          { passive: false }
        );

        // 拖拽外部图片文件进入取景框直接换图
        viewportBox.addEventListener("dragover", (ev) => {
          ev.preventDefault();
          viewportBox.addClass("is-drop-hover");
        });
        viewportBox.addEventListener("dragleave", () => {
          viewportBox.removeClass("is-drop-hover");
        });
        viewportBox.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          viewportBox.removeClass("is-drop-hover");
          const file = ev.dataTransfer?.files?.[0];
          if (file && file.type.startsWith("image/")) {
            const ext = (file.name.split(".").pop() || "png").toLowerCase();
            const buf = await file.arrayBuffer();
            const savedPath = await saveCustomCharacterImageFromBuffer(plugin, charRecord, buf, ext);
            if (savedPath) {
              draftState.localAvatar = savedPath;
              draftState.hasCustomAvatar = true;
              if (Notice) new Notice(`✨ 已替换角色立绘为《${file.name}》！`);
              syncFrameVisuals(true);
            }
          }
        });

        // 右侧控制面板：1. 呈现模式切换 (Cover vs Contain)
        const modeSec = ctrlCol.createDiv("curator-studio-panel-sec");
        modeSec.createDiv({ cls: "curator-studio-sec-title", text: "1. 立绘呈现模式（适配超长图/全身图）" });
        const modeBtnGroup = modeSec.createDiv("curator-studio-mode-btns");

        coverModeBtn = modeBtnGroup.createEl("button", {
          cls: `curator-dl-mini-btn ${draftState.fitMode === "cover" ? "is-active" : ""}`,
          text: "🖼️ 智能填充取景 (Cover · 聚焦头部/半身且支持无损缩放)"
        });
        containModeBtn = modeBtnGroup.createEl("button", {
          cls: `curator-dl-mini-btn ${draftState.fitMode === "contain" ? "is-active" : ""}`,
          text: "🧍 全图完整呈现 (Contain · 100% 完整展示全身立绘)"
        });

        coverModeBtn.onclick = (e) => {
          e.preventDefault();
          draftState.fitMode = "cover";
          coverModeBtn.addClass("is-active");
          containModeBtn.removeClass("is-active");
          syncFrameVisuals(true);
        };
        containModeBtn.onclick = (e) => {
          e.preventDefault();
          draftState.fitMode = "contain";
          containModeBtn.addClass("is-active");
          coverModeBtn.removeClass("is-active");
          syncFrameVisuals(true);
        };

        // 2. 一键焦点预设与精确滑块
        const focusSec = ctrlCol.createDiv("curator-studio-panel-sec");
        focusSec.createDiv({ cls: "curator-studio-sec-title", text: "2. 快速对焦预设与精细滑块" });
        const presetRow = focusSec.createDiv("curator-studio-preset-row");

        const presets = [
          { label: "🎯 头部黄金对焦", fitMode: "cover", cropX: 50, cropY: 14, cropScale: 1.0 },
          { label: "✨ 面部特写", fitMode: "cover", cropX: 50, cropY: 10, cropScale: 1.45 },
          { label: "🧍 全身完整呈现", fitMode: "contain", cropX: 50, cropY: 50, cropScale: 1.0 },
          { label: "↺ 重置", fitMode: "cover", cropX: 50, cropY: 14, cropScale: 1.0 }
        ];
        presets.forEach((p) => {
          const pb = presetRow.createEl("button", {
            cls: "curator-dl-mini-btn",
            text: p.label
          });
          pb.onclick = (e) => {
            e.preventDefault();
            draftState.fitMode = p.fitMode;
            draftState.cropX = p.cropX;
            draftState.cropY = p.cropY;
            draftState.cropScale = p.cropScale;
            coverModeBtn.toggleClass("is-active", draftState.fitMode === "cover");
            containModeBtn.toggleClass("is-active", draftState.fitMode === "contain");
            syncFrameVisuals(true);
          };
        });

        const buildSliderRow = (parent, label, min, max, step, initVal, unit, onInput) => {
          const row = parent.createDiv("curator-studio-slider-row");
          const top = row.createDiv("curator-studio-slider-top");
          top.createSpan({ text: label });
          const valSpan = top.createSpan({ cls: "curator-mono", text: `${initVal}${unit}` });
          const slider = row.createEl("input", {
            type: "range",
            cls: "curator-studio-range"
          });
          slider.min = String(min);
          slider.max = String(max);
          slider.step = String(step);
          slider.value = String(initVal);
          slider.oninput = () => {
            onInput(Number(slider.value));
          };
          return { slider, valSpan };
        };

        const yRow = buildSliderRow(
          focusSec,
          "垂直选定位置 Y（0% 顶部头部 ↔ 100% 底部脚尖）",
          0,
          100,
          1,
          Math.round(draftState.cropY),
          "%",
          (val) => {
            draftState.cropY = val;
            syncFrameVisuals(false);
          }
        );
        ySlider = yRow.slider;
        yValSpan = yRow.valSpan;

        const xRow = buildSliderRow(
          focusSec,
          "水平选定位置 X（0% 左侧 ↔ 100% 右侧）",
          0,
          100,
          1,
          Math.round(draftState.cropX),
          "%",
          (val) => {
            draftState.cropX = val;
            syncFrameVisuals(false);
          }
        );
        xSlider = xRow.slider;
        xValSpan = xRow.valSpan;

        const scRow = buildSliderRow(
          focusSec,
          "画面缩放倍率（35% 广角看全图 ↔ 320% 放大特写）",
          35,
          320,
          5,
          Math.round(draftState.cropScale * 100),
          "%",
          (val) => {
            draftState.cropScale = Math.round(val) / 100;
            syncFrameVisuals(false);
          }
        );
        scaleSlider = scRow.slider;
        scaleValSpan = scRow.valSpan;

        // 3. 更换自定义角色图片
        const customImgSec = ctrlCol.createDiv("curator-studio-panel-sec");
        customImgSec.createDiv({
          cls: "curator-studio-sec-title",
          text: "3. 更换角色图片（支持本地图片 / 剪贴板粘贴 / 萌娘全身立绘 / URL）"
        });

        const uploadBtnRow = customImgSec.createDiv("curator-studio-upload-btns");
        const hiddenFileInput = customImgSec.createEl("input", {
          type: "file",
          attr: { accept: "image/*", style: "display:none;" }
        });

        const pickLocalBtn = uploadBtnRow.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "📁 选择本地图片文件…"
        });
        pickLocalBtn.onclick = (e) => {
          e.preventDefault();
          hiddenFileInput.click();
        };

        hiddenFileInput.onchange = async () => {
          const file = hiddenFileInput.files?.[0];
          if (!file) return;
          const ext = (file.name.split(".").pop() || "png").toLowerCase();
          const buf = await file.arrayBuffer();
          const savedPath = await saveCustomCharacterImageFromBuffer(plugin, charRecord, buf, ext);
          if (savedPath) {
            draftState.localAvatar = savedPath;
            draftState.hasCustomAvatar = true;
            if (Notice) new Notice(`✨ 已导入自定义角色图片《${file.name}》！`);
            syncFrameVisuals(true);
          }
        };

        const fetchMoeFullImgBtn = uploadBtnRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🌐 获取萌娘百科全身立绘"
        });
        fetchMoeFullImgBtn.title = "从萌娘百科词条自动提取高清全身/封面立绘并同步角色身高";
        fetchMoeFullImgBtn.onclick = async (e) => {
          e.preventDefault();
          fetchMoeFullImgBtn.disabled = true;
          fetchMoeFullImgBtn.textContent = "获取中…";
          try {
            const moeRes = await fetchMoegirlCharacterData(
              [charRecord.name, charRecord.nameJp, ...(charRecord.aliases || [])],
              { appearances: charRecord.appearances || [] }
            );
            if (moeRes.height) {
              draftState.heightRawText = moeRes.height;
              const parsedH = parseCharacterHeightCm({ height: moeRes.height });
              if (!parsedH.isEstimated) draftState.heightCm = parsedH.cm;
            }
            if (moeRes.imageUrl) {
              const savedInfo = await saveCustomCharacterImageFromUrlOrPath(
                plugin,
                charRecord,
                moeRes.imageUrl
              );
              draftState.localAvatar = savedInfo.localAvatar;
              draftState.avatar = savedInfo.avatar || moeRes.imageUrl;
              draftState.hasCustomAvatar = true;
              if (Notice) new Notice("✨ 已切换为萌娘百科角色立绘！");
              syncFrameVisuals(true);
            } else if (Notice) {
              new Notice("未在萌娘百科资料栏中找到独立图片链接，可使用本地文件或粘贴换图。");
            }
          } finally {
            fetchMoeFullImgBtn.disabled = false;
            fetchMoeFullImgBtn.textContent = "🌐 获取萌娘百科全身立绘";
          }
        };

        const urlInputRow = customImgSec.createDiv("curator-studio-url-row");
        const customUrlInput = urlInputRow.createEl("input", {
          type: "text",
          cls: "curator-input",
          placeholder: "输入图片 URL (https://...) 或仓库内路径 (如 附件/xxx.png)…"
        });
        customUrlInput.value = draftState.localAvatar || draftState.avatar || "";
        const applyUrlBtn = urlInputRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "应用图片"
        });
        applyUrlBtn.onclick = async (e) => {
          e.preventDefault();
          const val = customUrlInput.value.trim();
          if (!val) return;
          applyUrlBtn.disabled = true;
          applyUrlBtn.textContent = "加载中…";
          try {
            const res = await saveCustomCharacterImageFromUrlOrPath(plugin, charRecord, val);
            draftState.localAvatar = res.localAvatar;
            draftState.avatar = res.avatar || val;
            draftState.hasCustomAvatar = true;
            syncFrameVisuals(true);
            if (Notice) new Notice("✨ 已应用新的角色图片！");
          } finally {
            applyUrlBtn.disabled = false;
            applyUrlBtn.textContent = "应用图片";
          }
        };

        syncFrameVisuals(false);
      };

      // ==================== Tab 2：等身标尺与脚底基准校准 ====================
      const renderHeightCalibrationTab = (host) => {
        const splitGrid = host.createDiv("curator-studio-grid");
        const stageCol = splitGrid.createDiv("curator-studio-stage-col");
        const ctrlCol = splitGrid.createDiv("curator-studio-ctrl-col");

        stageCol.createDiv({
          cls: "curator-studio-stage-caption",
          text: "📏 在下方等身标尺台中直接上下拖拽立绘或滚轮缩放，使人物脚底踩在「0 cm 基准线」、头顶对齐「目标身高线」（与画廊等身标尺架 1:1 完全同步）"
        });

        const allMaxCm = Math.max(
          185,
          Number(draftState.heightCm) || 158,
          ...(plugin.settings?.characterCollection || []).map((c) => parseCharacterHeightCm(c).cm)
        );
        const maxScaleCm = Math.min(260, Math.max(200, Math.ceil((allMaxCm + 15) / 20) * 20));
        const stageHeightPx = 380;
        const pxPerCm = stageHeightPx / maxScaleCm;

        const rulerStage = stageCol.createDiv("curator-studio-height-stage");
        const yAxis = rulerStage.createDiv("curator-height-y-axis is-studio-axis");
        const canvasArea = rulerStage.createDiv("curator-studio-height-canvas");

        for (let cm = 0; cm <= maxScaleCm; cm += 20) {
          const bottomPct = (cm / maxScaleCm) * 100;
          const tick = yAxis.createDiv("curator-height-y-tick curator-mono");
          tick.style.bottom = `${bottomPct}%`;
          tick.setText(`${cm}cm`);

          const line = canvasArea.createDiv(
            `curator-height-grid-line ${cm === 0 ? "is-baseline" : "is-major"}`
          );
          line.style.bottom = `${bottomPct}%`;
        }

        // 目标身高顶线
        const targetHeadLine = canvasArea.createDiv("curator-studio-target-headline");
        const targetHeadTag = targetHeadLine.createSpan({
          cls: "curator-studio-target-headtag curator-mono"
        });

        // 角色等身立绘容器（高度严格等于 cm * pxPerCm，图片以高度 100% 驱动，绝不因宽度挤压而产生顶部假留白）
        const figureWrap = canvasArea.createDiv("curator-studio-figure-box");
        const origDraftSrc = getDraftImgSrc();
        const figImg = figureWrap.createEl("img", {
          cls: "curator-studio-figure-img",
          attr: { src: origDraftSrc, alt: charRecord.name || "角色" }
        });
        figImg.dataset.origSrc = origDraftSrc;

        let hScaleSlider = null;
        let footSlider = null;
        let hScaleSpan = null;
        let footSpan = null;

        const applyStudioBgMode = () => {
          const globalAuto = plugin.settings?.characterLineupAutoRemoveBg !== false;
          const effMode =
            draftState.removeSolidBg === "on"
              ? "on"
              : draftState.removeSolidBg === "off"
              ? "off"
              : globalAuto
              ? "auto"
              : "off";
          if (effMode === "off") {
            if (figImg.dataset.origSrc && figImg.src !== figImg.dataset.origSrc) {
              figImg.src = figImg.dataset.origSrc;
            }
            figureWrap.removeClass("is-bg-removed");
            return;
          }
          const cutoutUrl = removeCharacterSolidBackgroundViaCanvas(figImg, { mode: effMode });
          if (cutoutUrl && figImg.src !== cutoutUrl) {
            figImg.dataset.isCutoutApplied = "1";
            figImg.src = cutoutUrl;
            figureWrap.addClass("is-bg-removed");
          } else if (!cutoutUrl) {
            figureWrap.removeClass("is-bg-removed");
          }
        };

        const syncHeightCalibrationVisuals = () => {
          const cm = Math.max(30, Math.min(260, Number(draftState.heightCm) || 158));
          const targetPx = Math.max(40, Math.round(cm * pxPerCm));
          const bottomPct = Math.min(99, (cm / maxScaleCm) * 100);
          targetHeadLine.style.bottom = `${bottomPct}%`;
          targetHeadTag.setText(`✦ 头顶目标身高线：${cm} cm`);

          const aspect =
            figImg.naturalWidth && figImg.naturalHeight
              ? figImg.naturalWidth / figImg.naturalHeight
              : charRecord._naturalAspect || 0.62;
          const boxWidth = Math.max(128, Math.min(250, Math.round(targetPx * aspect) + 8));
          figureWrap.style.height = `${targetPx}px`;
          figureWrap.style.width = `${boxWidth}px`;

          const panX = Math.round((draftState.standPanX - 50) * 1.1);
          figImg.style.transformOrigin = "50% 100%";
          figImg.style.transform = `translate(${panX}px, ${-draftState.footOffsetPx}px) scale(${draftState.heightScale})`;

          if (hScaleSlider) hScaleSlider.value = String(Math.round(draftState.heightScale * 100));
          if (footSlider) footSlider.value = String(Math.round(draftState.footOffsetPx));
          if (hScaleSpan) hScaleSpan.setText(`${Math.round(draftState.heightScale * 100)}%`);
          if (footSpan) footSpan.setText(`${Math.round(draftState.footOffsetPx)} px`);
        };

        figImg.onload = () => {
          if (figImg.naturalWidth && figImg.naturalHeight) {
            charRecord._naturalAspect = figImg.naturalWidth / figImg.naturalHeight;
          }
          if (figImg.dataset.isCutoutApplied !== "1") {
            applyStudioBgMode();
          }
          delete figImg.dataset.isCutoutApplied;
          syncHeightCalibrationVisuals();
        };

        // 支持直接在标尺台中上下拖拽立绘调整基准点、滚轮缩放立绘大小
        let draggingFig = false;
        let dragStartY = 0;
        let dragStartX = 0;
        let startFootOffset = 0;
        let startPanX = 50;

        canvasArea.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          draggingFig = true;
          dragStartY = ev.clientY;
          dragStartX = ev.clientX;
          startFootOffset = draftState.footOffsetPx;
          startPanX = draftState.standPanX;
          canvasArea.addClass("is-dragging");
          try {
            canvasArea.setPointerCapture(ev.pointerId);
          } catch (_) {}
        });

        canvasArea.addEventListener("pointermove", (ev) => {
          if (!draggingFig) return;
          const dy = dragStartY - ev.clientY; // 向上拖为正偏移
          const dx = ev.clientX - dragStartX;
          draftState.footOffsetPx = Math.max(-180, Math.min(180, Math.round(startFootOffset + dy)));
          draftState.standPanX = Math.max(0, Math.min(100, Math.round(startPanX + dx * 0.35)));
          syncHeightCalibrationVisuals();
        });

        const stopFigDrag = () => {
          draggingFig = false;
          canvasArea.removeClass("is-dragging");
        };
        canvasArea.addEventListener("pointerup", stopFigDrag);
        canvasArea.addEventListener("pointercancel", stopFigDrag);

        canvasArea.addEventListener(
          "wheel",
          (ev) => {
            ev.preventDefault();
            const delta = ev.deltaY < 0 ? 0.05 : -0.05;
            draftState.heightScale = Math.max(
              0.35,
              Math.min(2.6, Math.round((draftState.heightScale + delta) * 100) / 100)
            );
            syncHeightCalibrationVisuals();
          },
          { passive: false }
        );

        const heightSec = ctrlCol.createDiv("curator-studio-panel-sec");
        heightSec.createDiv({ cls: "curator-studio-sec-title", text: "1. 角色真实身高设定 (cm)" });
        const hInputRow = heightSec.createDiv("curator-studio-url-row");
        const cmInput = hInputRow.createEl("input", {
          type: "number",
          cls: "curator-input curator-mono",
          placeholder: "如 164"
        });
        cmInput.min = "30";
        cmInput.max = "260";
        cmInput.step = "0.5";
        cmInput.value = String(draftState.heightCm);
        cmInput.oninput = () => {
          const n = Number(cmInput.value);
          if (Number.isFinite(n) && n >= 30 && n <= 260) {
            draftState.heightCm = n;
            draftState.heightRawText = `${n}cm`;
            syncHeightCalibrationVisuals();
          }
        };

        const syncHBtn = hInputRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "🔄 同步百科身高"
        });
        syncHBtn.onclick = async (e) => {
          e.preventDefault();
          syncHBtn.disabled = true;
          syncHBtn.textContent = "查询中…";
          try {
            const moeRes = await fetchMoegirlCharacterData(
              [charRecord.name, charRecord.nameJp, ...(charRecord.aliases || [])],
              { appearances: charRecord.appearances || [] }
            );
            if (moeRes.height) {
              const p = parseCharacterHeightCm({ height: moeRes.height });
              draftState.heightCm = p.cm;
              draftState.heightRawText = moeRes.height;
              cmInput.value = String(p.cm);
              syncHeightCalibrationVisuals();
              if (Notice) new Notice(`✨ 已从萌娘百科读取身高：${moeRes.height}`);
            } else if (Notice) {
              new Notice("百科词条未单独标注身高数字，可手动输入。");
            }
          } finally {
            syncHBtn.disabled = false;
            syncHBtn.textContent = "🔄 同步百科身高";
          }
        };

        const calibSec = ctrlCol.createDiv("curator-studio-panel-sec");
        calibSec.createDiv({
          cls: "curator-studio-sec-title",
          text: "2. 等身比例与脚底基准点微调（适配留白/半身立绘）"
        });

        const buildCalibSlider = (label, min, max, step, initVal, unit, onChange) => {
          const row = calibSec.createDiv("curator-studio-slider-row");
          const top = row.createDiv("curator-studio-slider-top");
          top.createSpan({ text: label });
          const valSpan = top.createSpan({ cls: "curator-mono", text: `${initVal}${unit}` });
          const slider = row.createEl("input", {
            type: "range",
            cls: "curator-studio-range"
          });
          slider.min = String(min);
          slider.max = String(max);
          slider.step = String(step);
          slider.value = String(initVal);
          slider.oninput = () => {
            onChange(Number(slider.value));
          };
          return { slider, valSpan };
        };

        const hs = buildCalibSlider(
          "等身立绘缩放比例（补偿图片上下留白或半身构图）",
          35,
          260,
          2,
          Math.round(draftState.heightScale * 100),
          "%",
          (val) => {
            draftState.heightScale = Math.round(val) / 100;
            syncHeightCalibrationVisuals();
          }
        );
        hScaleSlider = hs.slider;
        hScaleSpan = hs.valSpan;

        const fo = buildCalibSlider(
          "脚底基准线高度偏移（0cm 地面踩线微调 / 半身像上移对齐头顶）",
          -180,
          180,
          1,
          Math.round(draftState.footOffsetPx),
          " px",
          (val) => {
            draftState.footOffsetPx = Math.round(val);
            syncHeightCalibrationVisuals();
          }
        );
        footSlider = fo.slider;
        footSpan = fo.valSpan;

        const quickCalibRow = calibSec.createDiv("curator-studio-preset-row");
        const autoTrimBtn = quickCalibRow.createEl("button", {
          cls: "curator-dl-mini-btn is-accent",
          text: "✨ 智能消除图片留白对齐头脚"
        });
        autoTrimBtn.title = "自动扫描立绘上下透明/纯白边缘，使人物头顶对齐目标身高线、脚底踩在 0cm 线";
        autoTrimBtn.onclick = (e) => {
          e.preventDefault();
          const cm = Math.max(30, Math.min(260, Number(draftState.heightCm) || 158));
          const targetPx = Math.max(40, Math.round(cm * pxPerCm));
          const bounds = detectImageVerticalSubjectBounds(figImg, targetPx);
          draftState.heightScale = bounds.heightScale;
          draftState.footOffsetPx = bounds.footOffsetPx;
          draftState.standPanX = 50;
          syncHeightCalibrationVisuals();
          if (Notice) {
            new Notice(
              `✨ 已自动识别有效人物边界（比例 ${Math.round(bounds.heightScale * 100)}% · 偏移 ${bounds.footOffsetPx}px）`
            );
          }
        };

        const resetCalibBtn = quickCalibRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "↺ 恢复标准全身基准 (100% · 0px)"
        });
        resetCalibBtn.onclick = (e) => {
          e.preventDefault();
          draftState.heightScale = 1.0;
          draftState.footOffsetPx = 0;
          draftState.standPanX = 50;
          syncHeightCalibrationVisuals();
        };

        const halfBodyAlignBtn = quickCalibRow.createEl("button", {
          cls: "curator-dl-mini-btn",
          text: "👤 半身像头顶对齐预设"
        });
        halfBodyAlignBtn.onclick = (e) => {
          e.preventDefault();
          draftState.heightScale = 0.72;
          draftState.footOffsetPx = 56;
          syncHeightCalibrationVisuals();
        };

        // 3. 等身标尺纯色背景智能抠除（可选开关，支持透明 PNG 导入与纯色底自动漫水填充抠图）
        const bgSec = ctrlCol.createDiv("curator-studio-panel-sec");
        bgSec.createDiv({
          cls: "curator-studio-sec-title",
          text: "3. 等身标尺架纯色背景去除（适配白底 / 灰底人设图）"
        });
        const bgModeRow = bgSec.createDiv("curator-studio-preset-row");
        const bgModes = [
          { id: "auto", label: "🪄 自动识别纯色底（推荐）", desc: "跟随标尺架全局去底开关，自动去除白底/灰底并保护角色内部颜色" },
          { id: "on", label: "✨ 强制去除背景", desc: "即使标尺架全局关闭，也对该角色立绘执行边缘漫水去背景" },
          { id: "off", label: "🖼️ 保持原图背景", desc: "对该角色保留原始背景不抠图" }
        ];
        const bgModeBtns = [];
        bgModes.forEach((bm) => {
          const btn = bgModeRow.createEl("button", {
            cls: `curator-dl-mini-btn ${draftState.removeSolidBg === bm.id ? "is-active" : ""}`,
            text: bm.label
          });
          btn.title = bm.desc;
          btn.onclick = (e) => {
            e.preventDefault();
            draftState.removeSolidBg = bm.id;
            bgModeBtns.forEach((x) => x.btn.toggleClass("is-active", x.id === bm.id));
            if (figImg.dataset.origSrc && figImg.src !== figImg.dataset.origSrc) {
              figImg.src = figImg.dataset.origSrc;
            } else {
              applyStudioBgMode();
            }
          };
          bgModeBtns.push({ id: bm.id, btn });
        });

        applyStudioBgMode();
        syncHeightCalibrationVisuals();
      };

      renderActiveTabContent();

      const footer = contentEl.createDiv("curator-rss-check-footer curator-studio-footer");
      const saveBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-primary",
        text: "✦ 保存立绘取景与身高校准"
      });
      saveBtn.onclick = async (e) => {
        e.preventDefault();
        charRecord.portraitFrame = {
          calibVersion: 2,
          fitMode: draftState.fitMode,
          cropX: draftState.cropX,
          cropY: draftState.cropY,
          cropScale: draftState.cropScale,
          heightScale: draftState.heightScale,
          footOffsetPx: draftState.footOffsetPx,
          standPanX: draftState.standPanX,
          removeSolidBg: draftState.removeSolidBg || "auto"
        };
        if (draftState.heightCm && Number.isFinite(Number(draftState.heightCm))) {
          charRecord.height = `${draftState.heightCm}cm`;
        }
        if (draftState.localAvatar) {
          charRecord.localAvatar = draftState.localAvatar;
        }
        if (draftState.avatar) {
          charRecord.avatar = draftState.avatar;
        }
        if (draftState.hasCustomAvatar) {
          charRecord.hasCustomAvatar = true;
        }

        // 若该角色已在馆藏列表中，同步写入并更新关联 Markdown 笔记
        const inList = (plugin.settings?.characterCollection || []).some(
          (c) => c && c.id === charRecord.id
        );
        if (inList) {
          if (resolveCharacterNoteFile(plugin, charRecord)) {
            await createOrUpdateCharacterMarkdownNote(plugin, charRecord);
          }
          await plugin.saveSettings();
        }
        this.close();
        if (Notice) {
          new Notice(`✨ 已更新《${charRecord.name}》的立绘取景与等身标尺参数！`);
        }
        if (typeof onAfterSaved === "function") {
          onAfterSaved(charRecord);
        }
        if (inList && typeof plugin.refreshOpenDashboardViews === "function") {
          await plugin.refreshOpenDashboardViews();
        }
      };

      const cancelBtn = footer.createEl("button", {
        cls: "curator-dl-btn is-subtle",
        text: "取消"
      });
      cancelBtn.onclick = (e) => {
        e.preventDefault();
        this.close();
      };
    }

    onClose() {
      if (this._pasteHandler) {
        window.removeEventListener("paste", this._pasteHandler);
        this._pasteHandler = null;
      }
      this.contentEl.empty();
    }
  }

  const modal = new CharacterPortraitStudioModal(plugin.app);
  modal.open();
  return modal;
}

/**
 * 弹出「👑 角色典藏详览档案卡」模态框（在画报照片墙或等身标尺陈列架中点击角色时打开）
 */
function openCharacterDetailModal(plugin, charRecord, vaultAnimeByTitle, onFullRefresh) {
  if (!plugin?.app || !charRecord) return null;

  class CharacterDetailModal extends Modal {
    onOpen() {
      const { contentEl, modalEl } = this;
      contentEl.empty();
      contentEl.addClass("curator-char-detail-modal");
      if (modalEl) {
        modalEl.addClass("curator-char-detail-shell");
      }

      const renderDetailContent = () => {
        contentEl.empty();
        const heightInfo = parseCharacterHeightCm(charRecord);

        const topLayout = contentEl.createDiv("curator-char-detail-layout");
        const posterCol = topLayout.createDiv("curator-char-detail-poster-col");
        const posterFrame = posterCol.createDiv("curator-char-detail-poster");

        const avaSrc = resolveCharacterAvatarSrc(plugin, charRecord);
        if (avaSrc) {
          const img = posterFrame.createEl("img", {
            attr: { src: avaSrc, alt: charRecord.name }
          });
          applyCharacterPortraitFrameToImg(img, posterFrame, charRecord);
        } else {
          posterFrame.createSpan({
            cls: "curator-char-avatar-fallback",
            text: (charRecord.name || "角").slice(0, 1)
          });
        }

        const posterOverlayBtn = posterFrame.createEl("button", {
          cls: "curator-char-poster-edit-pill",
          text: "🖼️ 调整取景 / 更换图片 / 校准身高"
        });
        posterOverlayBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openCharacterPortraitStudioModal(plugin, charRecord, () => {
            renderDetailContent();
            if (typeof onFullRefresh === "function") onFullRefresh();
          });
        };

        const infoCol = topLayout.createDiv("curator-char-detail-info-col");
        const headRow = infoCol.createDiv("curator-char-detail-head");
        const titleGroup = headRow.createDiv("curator-char-detail-title-group");
        titleGroup.createEl("h3", {
          cls: "curator-char-detail-name",
          text: charRecord.name || "未命名角色"
        });
        if (charRecord.nameJp && charRecord.nameJp !== charRecord.name) {
          titleGroup.createSpan({
            cls: "curator-char-detail-jp",
            text: charRecord.nameJp
          });
        }
        headRow.createSpan({
          cls: "curator-char-detail-score curator-mono",
          text: `★ ${Number(charRecord.favoriteScore || 9.0).toFixed(1)}`
        });

        const attrGrid = infoCol.createDiv("curator-char-detail-attrs");
        const addAttrItem = (label, value) => {
          if (!value) return;
          const cell = attrGrid.createDiv("curator-char-detail-attr-cell");
          cell.createSpan({ cls: "curator-char-detail-attr-k", text: label });
          cell.createSpan({ cls: "curator-char-detail-attr-v", text: value });
        };

        addAttrItem("📐 身高", charRecord.height || heightInfo.displayLabel);
        addAttrItem("🎨 发色", charRecord.hairColor);
        addAttrItem("👁️ 瞳色", charRecord.eyeColor);
        addAttrItem("🎙️ 声优 (CV)", charRecord.cv);
        addAttrItem("🎂 生日", charRecord.birthday);
        if (Array.isArray(charRecord.aliases) && charRecord.aliases.length > 0) {
          addAttrItem("🏷️ 别号", charRecord.aliases.slice(0, 4).join("、"));
        }

        if (Array.isArray(charRecord.appearances) && charRecord.appearances.length > 0) {
          const appBlock = infoCol.createDiv("curator-char-detail-block");
          appBlock.createDiv({ cls: "curator-char-detail-block-title", text: "🎬 代表出演作品" });
          const appRow = appBlock.createDiv("curator-char-card-appearances");
          charRecord.appearances.forEach((appTitle) => {
            const matchedAnime = vaultAnimeByTitle?.get(String(appTitle).trim().toLowerCase());
            const appChip = appRow.createEl(matchedAnime ? "button" : "span", {
              cls: `curator-char-anime-chip ${matchedAnime ? "is-in-vault" : ""}`,
              text: `🎬 《${appTitle}》`
            });
            if (matchedAnime?.file) {
              appChip.title = "点击打开馆藏中的该部动画笔记";
              appChip.onclick = async (ev) => {
                ev.preventDefault();
                this.close();
                const leaf = plugin.app.workspace.getLeaf(true);
                await leaf.openFile(matchedAnime.file);
              };
            }
          });
        }

        const moeBlock = infoCol.createDiv("curator-char-detail-block");
        moeBlock.createDiv({ cls: "curator-char-detail-block-title", text: "✦ 萌娘百科萌点标签" });
        const moeWrap = moeBlock.createDiv("curator-char-card-moepoints");
        if (Array.isArray(charRecord.moePoints) && charRecord.moePoints.length > 0) {
          charRecord.moePoints.forEach((mp) => {
            const tagBtn = moeWrap.createEl("button", {
              cls: "curator-char-moe-tag",
              text: mp
            });
            tagBtn.title = `点击筛选所有带有「${mp}」萌点的角色`;
            tagBtn.onclick = (ev) => {
              ev.preventDefault();
              if (plugin.__characterArchiveUiState) {
                plugin.__characterArchiveUiState.activeTraitFilter = {
                  key: `moe::${mp}`,
                  label: mp,
                  category: "moe"
                };
              }
              this.close();
              if (typeof onFullRefresh === "function") onFullRefresh();
            };
          });
        } else {
          moeWrap.createSpan({ cls: "curator-char-moe-empty", text: "暂未录入萌点标签" });
        }

        if (charRecord.personalComment) {
          infoCol.createDiv({
            cls: "curator-char-card-comment",
            text: `“${charRecord.personalComment}”`
          });
        }
        if (charRecord.summary) {
          const sumBox = infoCol.createDiv("curator-char-detail-summary");
          sumBox.setText(charRecord.summary);
        }

        const footer = contentEl.createDiv("curator-rss-check-footer curator-char-detail-footer");
        const studioBtn = footer.createEl("button", {
          cls: "curator-dl-btn is-primary",
          text: "🖼️ 立绘取景 / 换图 / 身高校准"
        });
        studioBtn.onclick = (e) => {
          e.preventDefault();
          openCharacterPortraitStudioModal(plugin, charRecord, () => {
            renderDetailContent();
            if (typeof onFullRefresh === "function") onFullRefresh();
          });
        };

        const existingNote = resolveCharacterNoteFile(plugin, charRecord);
        const noteBtn = footer.createEl("button", {
          cls: "curator-dl-btn",
          text: existingNote ? "📄 打开角色笔记" : "📄 生成角色笔记"
        });
        noteBtn.onclick = async (e) => {
          e.preventDefault();
          let file = resolveCharacterNoteFile(plugin, charRecord);
          if (file) {
            await syncCharacterNoteToCollection(plugin, file);
          } else {
            const p = await createOrUpdateCharacterMarkdownNote(plugin, charRecord);
            await plugin.saveSettings();
            file = plugin.app.vault.getAbstractFileByPath(p);
          }
          this.close();
          if (file) {
            const leaf = plugin.app.workspace.getLeaf(true);
            await leaf.openFile(file);
          }
          if (typeof onFullRefresh === "function") onFullRefresh();
        };

        const moeBtn = footer.createEl("button", {
          cls: "curator-dl-btn",
          text: "↗ 萌娘百科"
        });
        moeBtn.onclick = (e) => {
          e.preventDefault();
          const url =
            charRecord.moegirlUrl && charRecord.moegirlUrl.includes("moegirl.uk")
              ? charRecord.moegirlUrl
              : `https://moegirl.uk/${encodeURIComponent(charRecord.name)}`;
          window.open(url, "_blank");
        };

        const closeBtn = footer.createEl("button", {
          cls: "curator-dl-btn is-subtle",
          text: "关闭"
        });
        closeBtn.onclick = (e) => {
          e.preventDefault();
          this.close();
        };
      };

      renderDetailContent();
    }
  }

  const modal = new CharacterDetailModal(plugin.app);
  modal.open();
  return modal;
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
      galleryViewMode: "cards",
      selectedHeightCharId: null,
      rulerRefCm: 160,
      searchQuery: "",
      showAddDrawer: false,
      editingCharId: null
    };
  }
  const uiState = plugin.__characterArchiveUiState;
  if (!uiState.galleryViewMode) uiState.galleryViewMode = "cards";

  if (!Array.isArray(plugin.settings.characterCollection)) {
    plugin.settings.characterCollection = [];
  }
  const characters = plugin.settings.characterCollection;

  // 每次进入或刷新角色典藏工作台时，异步核对一次本地角色 Markdown 笔记与内存典藏库（以笔记最新修改为准）
  if (!plugin.__isReconcilingCharacterNotes) {
    plugin.__isReconcilingCharacterNotes = true;
    reconcileCharacterCollectionWithNotes(plugin)
      .then((didChange) => {
        plugin.__isReconcilingCharacterNotes = false;
        if (didChange && container.isConnected) {
          renderCharacterArchiveWorkspace(plugin, container, vaultAnimeItems, options);
        }
      })
      .catch(() => {
        plugin.__isReconcilingCharacterNotes = false;
      });
  }

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
    if (finalRecord.avatar && !finalRecord.localAvatar) {
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
      if (finalRecord.portraitFrame) savedRecord.portraitFrame = finalRecord.portraitFrame;
      if (finalRecord.hasCustomAvatar) savedRecord.hasCustomAvatar = true;
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
    const posterCol = formGrid.createDiv("curator-char-draft-poster is-clickable-portrait");
    posterCol.title = "点击调整立绘选定位置/缩放，或更换自定义图片";
    const renderDraftPoster = () => {
      posterCol.empty();
      const draftAvaSrc = resolveCharacterAvatarSrc(plugin, profileDraft) || profileDraft.avatar || "";
      if (draftAvaSrc) {
        const img = posterCol.createEl("img", {
          attr: { src: draftAvaSrc, alt: profileDraft.name }
        });
        img.src = draftAvaSrc;
        img.alt = profileDraft.name;
        applyCharacterPortraitFrameToImg(img, posterCol, profileDraft);
        img.onerror = () => {
          img.remove();
          posterCol.setText("👤");
        };
      } else {
        posterCol.setText("👤");
      }
      posterCol.createDiv({
        cls: "curator-char-avatar-hover-pill",
        text: "🖼️ 取景/换图"
      });
    };
    renderDraftPoster();

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
    const heightInput = createLabeledInput(row2, "身高 (cm)", profileDraft.height || "");
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

    posterCol.onclick = (ev) => {
      ev.preventDefault();
      profileDraft.name = nameInput.value.trim() || profileDraft.name;
      profileDraft.height = heightInput.value.trim() || profileDraft.height;
      profileDraft.avatar = avatarInput.value.trim() || profileDraft.avatar;
      openCharacterPortraitStudioModal(plugin, profileDraft, (updatedDraft) => {
        if (updatedDraft.height) heightInput.value = updatedDraft.height;
        if (updatedDraft.avatar) avatarInput.value = updatedDraft.avatar;
        renderDraftPoster();
      });
    };

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
      const url =
        profileDraft.moegirlUrl && profileDraft.moegirlUrl.includes("moegirl.uk")
          ? profileDraft.moegirlUrl
          : `https://moegirl.uk/${encodeURIComponent(targetName)}`;
      window.open(url, "_blank");
    };

    const webExtractMoeBtn = moeQuickLinks.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "🌐 网页提取萌点"
    });
    webExtractMoeBtn.title = "在内置萌娘百科视图或粘贴 HTML 源码一键解析该角色的萌点、发色、瞳色与声优";

    const retryMoeBtn = moeQuickLinks.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "🔄 重新同步萌娘百科"
    });

    const moeInput = moeRow.createEl("textarea", {
      cls: "curator-textarea curator-char-moe-textarea",
      placeholder: "例如：魔法师、萝莉、蓝发、蓝瞳、呆毛、帽娘…（也支持直接粘贴萌娘百科 <div class=\"moe-infobox\"> HTML 源码自动提取）"
    });
    moeInput.rows = 2;
    moeInput.value = (profileDraft.moePoints || []).join("、");

    const applyParsedMoegirlToDraftInputs = (moeRes) => {
      if (!moeRes) return;
      if (Array.isArray(moeRes.moePoints) && moeRes.moePoints.length > 0) {
        const existingTags = moeInput.value
          .split(/[、，,\/；;|]+/)
          .map((s) => s.trim())
          .filter((s) => s && !s.includes("<") && !s.includes(">"));
        const merged = Array.from(new Set([...existingTags, ...moeRes.moePoints]));
        moeInput.value = merged.join("、");
      }
      if (moeRes.height && !heightInput.value.trim()) heightInput.value = moeRes.height;
      if (moeRes.hairColor && !hairInput.value.trim()) hairInput.value = moeRes.hairColor;
      if (moeRes.eyeColor && !eyeInput.value.trim()) eyeInput.value = moeRes.eyeColor;
      if (moeRes.cv && !cvInput.value.trim()) cvInput.value = moeRes.cv;
      if (moeRes.birthday && !bdayInput.value.trim()) bdayInput.value = moeRes.birthday;
      if (moeRes.imageUrl && !avatarInput.value.trim()) {
        avatarInput.value = moeRes.imageUrl;
        profileDraft.avatar = moeRes.imageUrl;
        renderDraftPoster();
      }
      if (moeRes.moegirlUrl) profileDraft.moegirlUrl = moeRes.moegirlUrl;
      if (moeRes.translatedName && (!nameInput.value.trim() || nameInput.value.trim() === "新角色")) {
        nameInput.value = moeRes.translatedName;
      }
      if (moeRes.realName && !jpInput.value.trim()) {
        jpInput.value = moeRes.realName;
      }
    };

    // 若自动同步过程中真实检测到 Cloudflare 人机验证且尚未拿到萌点，自动弹出人机验证窗口（零误检）
    if (profileDraft.cfChallengeDetected && (!profileDraft.moePoints || profileDraft.moePoints.length === 0)) {
      const targetName = nameInput.value.trim() || jpInput.value.trim() || profileDraft.name;
      openMoegirlBrowserExtractModal(
        plugin,
        targetName,
        (parsed) => {
          applyParsedMoegirlToDraftInputs(parsed);
        },
        { reason: "cloudflare" }
      );
    }

    // 支持直接将萌娘百科 <div class="moe-infobox"> outerHTML 粘贴进萌点输入框自动解析
    moeInput.addEventListener("input", () => {
      const val = moeInput.value;
      if (val.includes("<div") || val.includes("<table") || val.includes("moe-infobox")) {
        const parsed = parseMoegirlInfoboxHtml(val);
        if (parsed.moePoints.length > 0 || parsed.hairColor || parsed.eyeColor) {
          moeInput.value = "";
          applyParsedMoegirlToDraftInputs(parsed);
          if (Notice) {
            new Notice(`✨ 已从粘贴的萌娘百科 HTML 中自动解析出 ${parsed.moePoints.length} 个萌点及角色属性！`);
          }
        }
      }
    });

    webExtractMoeBtn.onclick = (ev) => {
      ev.preventDefault();
      const targetName = nameInput.value.trim() || jpInput.value.trim() || profileDraft.name;
      openMoegirlBrowserExtractModal(plugin, targetName, (parsed) => {
        applyParsedMoegirlToDraftInputs(parsed);
      });
    };

    retryMoeBtn.onclick = async (ev) => {
      ev.preventDefault();
      retryMoeBtn.disabled = true;
      retryMoeBtn.textContent = "正在同步萌娘百科…";
      try {
        const currentApps = appInput.value
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
        const moeRes = await fetchMoegirlCharacterData(
          [nameInput.value.trim(), jpInput.value.trim(), ...(profileDraft.aliases || [])],
          { appearances: currentApps }
        );
        applyParsedMoegirlToDraftInputs(moeRes);
        if (moeRes.moePoints.length > 0) {
          if (Notice) {
            new Notice(`已从萌娘百科同步 ${moeRes.moePoints.length} 个萌点！`);
          }
        } else if (moeRes.cfChallengeDetected) {
          const targetName = nameInput.value.trim() || jpInput.value.trim() || profileDraft.name;
          openMoegirlBrowserExtractModal(
            plugin,
            targetName,
            (parsed) => {
              applyParsedMoegirlToDraftInputs(parsed);
            },
            { reason: "cloudflare" }
          );
        } else if (Notice) {
          new Notice("未自动检索到同名角色资料栏，可点击「🌐 网页提取萌点」查找词条一键提取。");
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
        let rawMoeText = moeInput.value;
        if (rawMoeText.includes("<div") || rawMoeText.includes("<table") || rawMoeText.includes("moe-infobox")) {
          const parsedInline = parseMoegirlInfoboxHtml(rawMoeText);
          if (parsedInline.moePoints.length > 0) {
            rawMoeText = parsedInline.moePoints.join("、");
          }
        }
        const finalMoePoints = Array.from(
          new Set(
            rawMoeText
              .split(/[、，,\/；;|\n]+/)
              .map((s) => s.trim())
              .filter((s) => s && !s.includes("<") && !s.includes(">"))
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
          height: heightInput.value.trim() || profileDraft.height || "",
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
          moegirlUrl:
            profileDraft.moegirlUrl && profileDraft.moegirlUrl.includes("moegirl.uk")
              ? profileDraft.moegirlUrl
              : `https://moegirl.uk/${encodeURIComponent(finalName)}`
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
          name: item.name,
          nameJp: item.nameJp,
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
    if (uiState.gallerySortMode === "height-desc") {
      const ha = parseCharacterHeightCm(a).cm;
      const hb = parseCharacterHeightCm(b).cm;
      if (hb !== ha) return hb - ha;
      return (Number(b.favoriteScore) || 0) - (Number(a.favoriteScore) || 0);
    }
    if (uiState.gallerySortMode === "height-asc") {
      const ha = parseCharacterHeightCm(a).cm;
      const hb = parseCharacterHeightCm(b).cm;
      if (ha !== hb) return ha - hb;
      return (Number(b.favoriteScore) || 0) - (Number(a.favoriteScore) || 0);
    }
    if (uiState.gallerySortMode === "score-desc") {
      return (Number(b.favoriteScore) || 0) - (Number(a.favoriteScore) || 0);
    }
    if (uiState.gallerySortMode === "name-asc") {
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
    }
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  const leftBarGroup = bar.createDiv("curator-char-gallery-toolbar-left");
  leftBarGroup.createSpan({
    cls: "curator-char-gallery-count curator-mono",
    text: uiState.activeTraitFilter
      ? `筛选属性「${uiState.activeTraitFilter.label}」：共 ${filtered.length} 位角色`
      : `角色典藏画廊（共 ${filtered.length} 位）`
  });

  // 画廊呈现模式切换器（档案卡片 / 等身标尺陈列架 / 画报照片墙）
  const viewSwitcher = leftBarGroup.createDiv("curator-char-view-switcher");
  [
    { id: "cards", label: "📇 档案卡片", title: "经典角色履历与萌点档案卡片视图" },
    { id: "height-lineup", label: "📏 等身标尺架", title: "按角色真实身高比例并列陈列对比，支持标尺参考线、脚底基准校准与身高排序" },
    { id: "photo-wall", label: "🖼️ 画报照片墙", title: "Aves 风格自适应画报照片墙，隐藏冗余文字，点击角色查看典藏详情" }
  ].forEach((vm) => {
    const vBtn = viewSwitcher.createEl("button", {
      cls: `curator-char-view-btn ${uiState.galleryViewMode === vm.id ? "is-active" : ""}`,
      text: vm.label
    });
    vBtn.title = vm.title;
    vBtn.onclick = (e) => {
      e.preventDefault();
      uiState.galleryViewMode = vm.id;
      if (vm.id === "height-lineup" && !uiState.selectedHeightCharId && filtered.length > 0) {
        uiState.selectedHeightCharId = filtered[0].id;
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
    { id: "score-desc", label: "★ 喜爱度" },
    { id: "height-desc", label: "📐 身高↓" },
    { id: "height-asc", label: "📐 身高↑" },
    { id: "date-desc", label: "🕒 最近收录" },
    { id: "name-asc", label: "🔤 姓名" }
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

  const displayList = options.compactAlmanacMode ? filtered.slice(0, 8) : filtered;

  // 分流渲染：等身标尺陈列架 vs 画报照片墙 vs 经典档案卡片
  if (uiState.galleryViewMode === "height-lineup") {
    renderCharacterHeightLineupStage(
      plugin,
      galleryHost,
      displayList,
      characters,
      vaultAnimeByTitle,
      uiState,
      options,
      onFullRefresh
    );
    return;
  }

  if (uiState.galleryViewMode === "photo-wall") {
    renderCharacterPhotoWallStage(
      plugin,
      galleryHost,
      displayList,
      characters,
      vaultAnimeByTitle,
      uiState,
      options,
      onFullRefresh
    );
    return;
  }

  const grid = galleryHost.createDiv("curator-char-cards-grid");

  displayList.forEach((ch) => {
    const card = grid.createDiv("curator-char-card");
    card.dataset.charId = ch.id;
    const topFlex = card.createDiv("curator-char-card-top");

    const avatarBox = topFlex.createDiv("curator-char-card-avatar is-clickable-portrait");
    avatarBox.title = "点击调整立绘选定位置、缩放模式或更换自定义角色图片";
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
      applyCharacterPortraitFrameToImg(img, avatarBox, ch);
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

    const lensHint = avatarBox.createDiv({
      cls: "curator-char-avatar-hover-pill",
      text: "🖼️ 取景/换图"
    });
    lensHint.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterPortraitStudioModal(plugin, ch, () => {
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          characters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      });
    };

    avatarBox.onclick = (ev) => {
      if (ev.target && ev.target.closest(".curator-char-score-badge")) return;
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterPortraitStudioModal(plugin, ch, () => {
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          characters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      });
    };

    const scoreBadge = avatarBox.createDiv("curator-char-score-badge curator-mono");
    scoreBadge.setText(`★ ${Number(ch.favoriteScore || 0).toFixed(1)}`);
    scoreBadge.title = "点击修改个人喜爱度评分 (1-10)";
    scoreBadge.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
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
    const parsedH = parseCharacterHeightCm(ch);
    if (ch.height || !parsedH.isEstimated) {
      const hChip = traitsRow.createSpan({
        cls: "curator-char-attr-chip is-height curator-mono",
        text: `📐 ${ch.height || parsedH.displayLabel}`
      });
      hChip.title = "点击打开等身标尺与身高校准工坊";
      hChip.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openCharacterPortraitStudioModal(
          plugin,
          ch,
          () => {
            renderCharacterGallerySection(
              plugin,
              galleryHost,
              characters,
              vaultAnimeByTitle,
              uiState,
              options,
              onFullRefresh
            );
          },
          "height"
        );
      };
    }
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

      const heightEditInput = scoreEditRow.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "身高（如：164cm）"
      });
      heightEditInput.value = ch.height || "";

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
        placeholder: "萌点标签（以顿号或逗号分隔，也支持直接粘贴萌娘百科 <div class=\"moe-infobox\"> HTML 源码自动提取）"
      });
      moeEditInput.rows = 2;
      moeEditInput.value = (ch.moePoints || []).join("、");

      const applyInlineParsedMoe = (moeRes) => {
        if (!moeRes) return;
        if (Array.isArray(moeRes.moePoints) && moeRes.moePoints.length > 0) {
          const existingTags = moeEditInput.value
            .split(/[、，,\/；;|]+/)
            .map((s) => s.trim())
            .filter((s) => s && !s.includes("<") && !s.includes(">"));
          const combined = Array.from(new Set([...existingTags, ...moeRes.moePoints]));
          moeEditInput.value = combined.join("、");
        }
        if (moeRes.height && !heightEditInput.value.trim()) heightEditInput.value = moeRes.height;
        if (moeRes.hairColor && !hairEditInput.value.trim()) hairEditInput.value = moeRes.hairColor;
        if (moeRes.eyeColor && !eyeEditInput.value.trim()) eyeEditInput.value = moeRes.eyeColor;
      };

      moeEditInput.addEventListener("input", () => {
        const val = moeEditInput.value;
        if (val.includes("<div") || val.includes("<table") || val.includes("moe-infobox")) {
          const parsed = parseMoegirlInfoboxHtml(val);
          if (parsed.moePoints.length > 0 || parsed.hairColor || parsed.eyeColor) {
            moeEditInput.value = "";
            applyInlineParsedMoe(parsed);
            if (Notice) {
              new Notice(`✨ 已从粘贴的 HTML 中提取 ${parsed.moePoints.length} 个萌点！`);
            }
          }
        }
      });

      const cmtEditInput = editBox.createEl("input", {
        type: "text",
        cls: "curator-input",
        placeholder: "心动寄语 / 印象短评…"
      });
      cmtEditInput.value = ch.personalComment || "";

      const editBtns = editBox.createDiv("curator-char-inline-btns");
      const webExtractInlineBtn = editBtns.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🌐 网页提取"
      });
      webExtractInlineBtn.title = "打开内置萌娘百科视图或粘贴 HTML 一键提取萌点";
      webExtractInlineBtn.onclick = (ev) => {
        ev.preventDefault();
        openMoegirlBrowserExtractModal(plugin, ch.name || ch.nameJp, (parsed) => {
          applyInlineParsedMoe(parsed);
        });
      };

      const syncMoeBtn = editBtns.createEl("button", {
        cls: "curator-dl-mini-btn",
        text: "🔄 同步萌娘百科"
      });
      syncMoeBtn.onclick = async (ev) => {
        ev.preventDefault();
        syncMoeBtn.disabled = true;
        syncMoeBtn.textContent = "同步中…";
        try {
          const moeRes = await fetchMoegirlCharacterData(
            [ch.name, ch.nameJp, ...(ch.aliases || [])],
            { appearances: ch.appearances || [] }
          );
          applyInlineParsedMoe(moeRes);
          if (moeRes.moePoints.length > 0) {
            if (moeRes.moegirlUrl) ch.moegirlUrl = moeRes.moegirlUrl;
            if (Notice) {
              new Notice(`已同步 ${moeRes.moePoints.length} 个萌点！`);
            }
          } else if (moeRes.cfChallengeDetected) {
            openMoegirlBrowserExtractModal(
              plugin,
              ch.name || ch.nameJp,
              (parsed) => {
                applyInlineParsedMoe(parsed);
                if (parsed.moegirlUrl) ch.moegirlUrl = parsed.moegirlUrl;
              },
              { reason: "cloudflare" }
            );
          } else if (Notice) {
            new Notice("自动请求未返回萌点，可点击左侧「🌐 网页提取」一键提取。");
          }
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
        if (heightEditInput.value.trim()) {
          ch.height = heightEditInput.value.trim();
        }
        ch.hairColor = hairEditInput.value.trim();
        ch.eyeColor = eyeEditInput.value.trim();
        let rawMoeText = moeEditInput.value;
        if (rawMoeText.includes("<div") || rawMoeText.includes("<table") || rawMoeText.includes("moe-infobox")) {
          const parsedInline = parseMoegirlInfoboxHtml(rawMoeText);
          if (parsedInline.moePoints.length > 0) {
            rawMoeText = parsedInline.moePoints.join("、");
          }
        }
        ch.moePoints = Array.from(
          new Set(
            rawMoeText
              .split(/[、，,\/；;|\n]+/)
              .map((s) => s.trim())
              .filter((s) => s && !s.includes("<") && !s.includes(">"))
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

    // 底部操作条：取景/换图、编辑萌点/评分、角色 Markdown 笔记、萌娘百科、Bangumi 角色页、独立移除按钮
    const footRow = card.createDiv("curator-char-card-footer");
    const frameBtn = footRow.createEl("button", {
      cls: "curator-dl-mini-btn",
      text: "🖼️ 取景/换图"
    });
    frameBtn.title = "调整角色立绘选定位置、缩放模式、身高标尺校准或更换自定义图片";
    frameBtn.onclick = (ev) => {
      ev.preventDefault();
      openCharacterPortraitStudioModal(plugin, ch, () => {
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          characters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      });
    };

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
      let file = resolveCharacterNoteFile(plugin, ch);
      if (file) {
        // 笔记已存在时，先将用户在 Markdown 笔记中的最新评分与属性同步回角色典藏库，绝不反向覆盖笔记！
        await syncCharacterNoteToCollection(plugin, file);
      } else {
        const notePath = await createOrUpdateCharacterMarkdownNote(plugin, ch);
        await plugin.saveSettings();
        file = plugin.app.vault.getAbstractFileByPath(notePath);
      }
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
      const url =
        ch.moegirlUrl && ch.moegirlUrl.includes("moegirl.uk")
          ? ch.moegirlUrl
          : `https://moegirl.uk/${encodeURIComponent(ch.name)}`;
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

/**
 * 渲染「📏 等身标尺陈列架（Height Lineup Stage）」
 * 灵感源自「编年魔导书脊陈列架」，按角色真实身高（cm）在统一 0 cm 地平基准线上并列展示角色立绘，
 * 左侧配备厘米标尺刻度线、可拖拽水平身高对比参考线，顶部配备角色身高对比洞察与选中角色实时校准尺。
 */
function renderCharacterHeightLineupStage(
  plugin,
  galleryHost,
  displayList,
  allCharacters,
  vaultAnimeByTitle,
  uiState,
  options,
  onFullRefresh
) {
  const wrap = galleryHost.createDiv("curator-char-height-lineup-wrap");

  if (displayList.length === 0) {
    wrap.createDiv({
      cls: "curator-rs-empty",
      text: "当前筛选条件下暂无角色。"
    });
    return;
  }

  // 确保存在一个默认选中的校准角色
  if (
    !uiState.selectedHeightCharId ||
    !displayList.some((c) => c.id === uiState.selectedHeightCharId)
  ) {
    uiState.selectedHeightCharId = displayList[0].id;
  }
  const selectedChar =
    displayList.find((c) => c.id === uiState.selectedHeightCharId) || displayList[0];

  // 计算身高统计指标
  const heightRecords = displayList.map((ch) => ({
    char: ch,
    info: parseCharacterHeightCm(ch)
  }));
  const sortedByH = [...heightRecords].sort((a, b) => b.info.cm - a.info.cm);
  const tallest = sortedByH[0];
  const shortest = sortedByH[sortedByH.length - 1];
  const avgCm =
    Math.round(
      (heightRecords.reduce((acc, r) => acc + r.info.cm, 0) / heightRecords.length) * 10
    ) / 10;
  const maxDiffCm = Math.round((tallest.info.cm - shortest.info.cm) * 10) / 10;

  // 顶部统计与标尺校准工具栏
  const calibBar = wrap.createDiv("curator-height-calibrator-bar");
  const summaryRow = calibBar.createDiv("curator-height-summary-row");

  const statsLeft = summaryRow.createDiv("curator-height-stats-pills");
  statsLeft.createSpan({
    cls: "curator-height-stat-pill is-gold curator-mono",
    text: `👑 最高：${tallest.char.name} (${tallest.info.displayLabel})`
  });
  statsLeft.createSpan({
    cls: "curator-height-stat-pill curator-mono",
    text: `🌱 最娇小：${shortest.char.name} (${shortest.info.displayLabel})`
  });
  statsLeft.createSpan({
    cls: "curator-height-stat-pill curator-mono",
    text: `📐 最大身高差：${maxDiffCm} cm · 平均 ${avgCm} cm`
  });

  const toolsRight = summaryRow.createDiv("curator-height-tools-right");

  // 参考标尺线滑块
  const refCtrl = toolsRight.createDiv("curator-height-ref-ctrl");
  refCtrl.createSpan({ cls: "curator-height-ref-label", text: "✦ 标尺参考线：" });
  const refValBadge = refCtrl.createSpan({
    cls: "curator-height-ref-val curator-mono",
    text: `${uiState.rulerRefCm || 160} cm`
  });
  const refSlider = refCtrl.createEl("input", {
    type: "range",
    cls: "curator-studio-range curator-height-ref-slider"
  });
  refSlider.min = "100";
  refSlider.max = "200";
  refSlider.step = "1";
  refSlider.value = String(uiState.rulerRefCm || 160);

  // 1) 等身标尺架全局可选功能：智能去除纯色背景（0KB 边缘种子漫水填充，支持透明 PNG 导入）
  const isAutoRemoveBgOn = plugin.settings?.characterLineupAutoRemoveBg !== false;
  const toggleAutoBgBtn = toolsRight.createEl("button", {
    cls: `curator-dl-mini-btn ${isAutoRemoveBgOn ? "is-active" : ""}`,
    text: isAutoRemoveBgOn ? "🪄 自动去纯色底：开启" : "🪄 自动去纯色底：关闭"
  });
  toggleAutoBgBtn.title =
    "自动抠除人设图外围纯白/浅灰等纯色背景（仅从四角边缘向内漫水填充，100% 保护人物内部白衬衫与眼白，同时原生支持透明背景 PNG）";
  toggleAutoBgBtn.onclick = async (e) => {
    e.preventDefault();
    plugin.settings.characterLineupAutoRemoveBg = !isAutoRemoveBgOn;
    await plugin.saveSettings();
    renderCharacterGallerySection(
      plugin,
      galleryHost,
      allCharacters,
      vaultAnimeByTitle,
      uiState,
      options,
      onFullRefresh
    );
  };

  // 2) 一键补全馆藏角色真实身高按钮
  const syncAllHeightsBtn = toolsRight.createEl("button", {
    cls: "curator-dl-mini-btn is-accent",
    text: "🔄 自动补全馆藏角色身高"
  });
  syncAllHeightsBtn.title = "从内置档案与萌娘百科自动查询并补全尚未填写身高的馆藏角色";
  syncAllHeightsBtn.onclick = async (e) => {
    e.preventDefault();
    syncAllHeightsBtn.disabled = true;
    syncAllHeightsBtn.textContent = "正在补全身高…";
    let updatedCount = 0;
    try {
      for (const ch of allCharacters) {
        if (ch.height && /\d/.test(ch.height)) continue;
        // 1. 先查内置速查表
        const builtIn = parseCharacterHeightCm(ch);
        if (!builtIn.isEstimated) {
          ch.height = `${builtIn.cm}cm`;
          updatedCount += 1;
          continue;
        }
        // 2. 再查萌娘百科
        try {
          const moeRes = await fetchMoegirlCharacterData(
            [ch.name, ch.nameJp, ...(ch.aliases || [])],
            { appearances: ch.appearances || [] }
          );
          if (moeRes && moeRes.height && /\d/.test(moeRes.height)) {
            const p = parseCharacterHeightCm({ height: moeRes.height });
            ch.height = `${p.cm}cm`;
            updatedCount += 1;
          }
        } catch (_) {}
      }
      if (updatedCount > 0) {
        await plugin.saveSettings();
        if (Notice) new Notice(`✨ 已自动补全 ${updatedCount} 位角色的真实身高数据！`);
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          allCharacters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      } else if (Notice) {
        new Notice("当前馆藏角色均已具备身高数据，或可在下方选中角色直接输入身高。");
      }
    } finally {
      if (syncAllHeightsBtn.isConnected) {
        syncAllHeightsBtn.disabled = false;
        syncAllHeightsBtn.textContent = "🔄 自动补全馆藏角色身高";
      }
    }
  };

  // 选中角色的实时内联校准条（身高 cm / 缩放比例 / 脚底基准偏移 / 详情与换图）
  const activeCalibStrip = calibBar.createDiv("curator-height-active-strip");
  const selFrame = getCharacterPortraitFrame(selectedChar);
  const selHeightInfo = parseCharacterHeightCm(selectedChar);

  const selTitleBox = activeCalibStrip.createDiv("curator-height-sel-title");
  selTitleBox.createSpan({
    cls: "curator-height-sel-tag",
    text: "🎯 当前选中校准"
  });
  selTitleBox.createSpan({
    cls: "curator-height-sel-name",
    text: selectedChar.name
  });

  const selControls = activeCalibStrip.createDiv("curator-height-sel-controls");

  // 1) 身高数值微调
  const cmGroup = selControls.createDiv("curator-height-ctrl-group");
  cmGroup.createSpan({ cls: "curator-height-ctrl-k", text: "真实身高" });
  const cmInput = cmGroup.createEl("input", {
    type: "number",
    cls: "curator-input curator-height-cm-input curator-mono"
  });
  cmInput.min = "30";
  cmInput.max = "260";
  cmInput.step = "0.5";
  cmInput.value = String(selHeightInfo.cm);
  cmGroup.createSpan({ cls: "curator-mono", text: "cm" });

  // 2) 立绘缩放比例滑块
  const scaleGroup = selControls.createDiv("curator-height-ctrl-group");
  scaleGroup.createSpan({ cls: "curator-height-ctrl-k", text: "图片比例" });
  const scaleSlider = scaleGroup.createEl("input", {
    type: "range",
    cls: "curator-studio-range curator-height-mini-slider"
  });
  scaleSlider.min = "35";
  scaleSlider.max = "260";
  scaleSlider.step = "2";
  scaleSlider.value = String(Math.round(selFrame.heightScale * 100));
  const scaleValLabel = scaleGroup.createSpan({
    cls: "curator-height-ctrl-v curator-mono",
    text: `${Math.round(selFrame.heightScale * 100)}%`
  });

  // 3) 脚底基准偏移滑块
  const offsetGroup = selControls.createDiv("curator-height-ctrl-group");
  offsetGroup.createSpan({ cls: "curator-height-ctrl-k", text: "基准点偏移" });
  const offsetSlider = offsetGroup.createEl("input", {
    type: "range",
    cls: "curator-studio-range curator-height-mini-slider"
  });
  offsetSlider.min = "-180";
  offsetSlider.max = "180";
  offsetSlider.step = "1";
  offsetSlider.value = String(Math.round(selFrame.footOffsetPx));
  const offsetValLabel = offsetGroup.createSpan({
    cls: "curator-height-ctrl-v curator-mono",
    text: `${Math.round(selFrame.footOffsetPx)}px`
  });

  const actionGroup = activeCalibStrip.createDiv("curator-height-sel-actions");
  const getBgModeLabel = (m) =>
    m === "on" ? "🪄 去底：强制开启" : m === "off" ? "🖼️ 去底：保持原图" : "🪄 去底：自动";
  const charBgModeBtn = actionGroup.createEl("button", {
    cls: `curator-dl-mini-btn ${selFrame.removeSolidBg === "on" ? "is-active" : ""}`,
    text: getBgModeLabel(selFrame.removeSolidBg)
  });
  charBgModeBtn.title = "单独切换当前选中角色在等身标尺架上的背景抠除策略（自动识别 / 强制抠除 / 保持原图背景）";
  charBgModeBtn.onclick = async (e) => {
    e.preventDefault();
    const currF = getCharacterPortraitFrame(selectedChar);
    const nextOrder = { auto: "on", on: "off", off: "auto" };
    currF.removeSolidBg = nextOrder[currF.removeSolidBg] || "auto";
    selectedChar.portraitFrame = currF;
    await plugin.saveSettings();
    renderCharacterGallerySection(
      plugin,
      galleryHost,
      allCharacters,
      vaultAnimeByTitle,
      uiState,
      options,
      onFullRefresh
    );
  };

  const autoFitSelBtn = actionGroup.createEl("button", {
    cls: "curator-dl-mini-btn",
    text: "✨ 智能消除留白"
  });
  autoFitSelBtn.title = "自动检测立绘图片上下透明或白底留白，使人物头顶对齐身高线、脚底踩在 0cm 线";

  const resetSelBtn = actionGroup.createEl("button", {
    cls: "curator-dl-mini-btn",
    text: "↺ 重置基准"
  });
  const openStudioBtn = actionGroup.createEl("button", {
    cls: "curator-dl-mini-btn",
    text: "🖼️ 换图/精调"
  });
  const openDetailBtn = actionGroup.createEl("button", {
    cls: "curator-dl-mini-btn is-accent",
    text: "👑 角色档案"
  });

  openStudioBtn.onclick = (e) => {
    e.preventDefault();
    openCharacterPortraitStudioModal(
      plugin,
      selectedChar,
      () => {
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          allCharacters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      },
      "height"
    );
  };
  openDetailBtn.onclick = (e) => {
    e.preventDefault();
    openCharacterDetailModal(plugin, selectedChar, vaultAnimeByTitle, onFullRefresh);
  };

  // ==================== 核心舞台：等身标尺陈列架 ====================
  const maxCharCm = Math.max(
    185,
    ...allCharacters.map((c) => parseCharacterHeightCm(c).cm),
    ...heightRecords.map((r) => r.info.cm)
  );
  const maxScaleCm = Math.min(260, Math.max(200, Math.ceil((maxCharCm + 15) / 20) * 20));
  const stagePlotHeightPx = 380; // 0cm ~ maxScaleCm 对应的垂直像素高度（与模态框校准台 100% 一致）
  const pxPerCm = stagePlotHeightPx / maxScaleCm;

  const stage = wrap.createDiv("curator-char-height-stage");
  const yAxis = stage.createDiv("curator-height-y-axis");
  const plotViewport = stage.createDiv("curator-height-plot-viewport");
  const gridOverlay = plotViewport.createDiv("curator-height-grid-overlay");

  for (let cm = 0; cm <= maxScaleCm; cm += 10) {
    const bottomPct = (cm / maxScaleCm) * 100;
    const isMajor = cm % 20 === 0;
    if (isMajor) {
      const tick = yAxis.createDiv("curator-height-y-tick curator-mono");
      tick.style.bottom = `${bottomPct}%`;
      tick.setText(`${cm}cm`);
    } else {
      const minorTick = yAxis.createDiv("curator-height-y-tick-minor");
      minorTick.style.bottom = `${bottomPct}%`;
    }

    const line = gridOverlay.createDiv(
      `curator-height-grid-line ${cm === 0 ? "is-baseline" : isMajor ? "is-major" : "is-minor"}`
    );
    line.style.bottom = `${bottomPct}%`;
  }

  // 可交互拖拽的水平身高参考标尺线
  const refLine = plotViewport.createDiv("curator-height-ref-line");
  const refLineTag = refLine.createSpan({
    cls: "curator-height-ref-line-tag curator-mono"
  });
  const updateRefLinePosition = (cmVal) => {
    const clamped = Math.max(60, Math.min(maxScaleCm, Math.round(cmVal)));
    uiState.rulerRefCm = clamped;
    const pct = (clamped / maxScaleCm) * 100;
    refLine.style.bottom = `${pct}%`;
    refLineTag.setText(`✦ 标尺参考线：${clamped} cm（可上下拖拽比对）`);
    refValBadge.setText(`${clamped} cm`);
    refSlider.value = String(Math.max(100, Math.min(200, clamped)));
  };
  updateRefLinePosition(uiState.rulerRefCm || 160);

  refSlider.oninput = () => {
    updateRefLinePosition(Number(refSlider.value));
  };

  // 支持鼠标直接上下拖拽参考标尺线
  let draggingRefLine = false;
  refLine.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    draggingRefLine = true;
    refLine.addClass("is-dragging");
    try {
      refLine.setPointerCapture(ev.pointerId);
    } catch (_) {}
  });
  refLine.addEventListener("pointermove", (ev) => {
    if (!draggingRefLine) return;
    const rect = gridOverlay.getBoundingClientRect();
    if (!rect.height) return;
    const relFromBottom = rect.bottom - ev.clientY;
    const ratio = Math.max(0.2, Math.min(1, relFromBottom / rect.height));
    updateRefLinePosition(Math.round(ratio * maxScaleCm));
  });
  const stopRefLineDrag = () => {
    draggingRefLine = false;
    refLine.removeClass("is-dragging");
  };
  refLine.addEventListener("pointerup", stopRefLineDrag);
  refLine.addEventListener("pointercancel", stopRefLineDrag);

  // 角色并列立绘轨道
  const figuresTrack = plotViewport.createDiv("curator-height-figures-track");

  let selectedColRefs = null;
  let saveDebounceTimer = null;
  const scheduleSaveCharCalibration = (charObj) => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      if (resolveCharacterNoteFile(plugin, charObj)) {
        await createOrUpdateCharacterMarkdownNote(plugin, charObj);
      }
      await plugin.saveSettings();
    }, 320);
  };

  heightRecords.forEach(({ char: ch, info: hInfo }, idx) => {
    const isSelected = ch.id === selectedChar.id;

    const col = figuresTrack.createDiv(
      `curator-height-figure-col ${isSelected ? "is-selected" : ""}`
    );
    col.dataset.charId = ch.id;
    col.style.setProperty("--stagger-idx", String(idx));

    const figureStageBox = col.createDiv("curator-height-figure-stagebox");
    figureStageBox.style.height = `${stagePlotHeightPx}px`;

    // 头顶真实身高刻度游标线
    const headMarker = figureStageBox.createDiv("curator-height-head-marker");
    const headBadge = headMarker.createSpan({
      cls: `curator-height-head-badge curator-mono ${hInfo.isEstimated ? "is-estimated" : ""}`
    });

    // 等身立绘容盒（高度严格等于 cm * pxPerCm，图片以 height: 100%; width: auto 驱动，绝不因宽度挤压而产生顶部透明假留白）
    const standBox = figureStageBox.createDiv("curator-height-stand-box");
    const avaSrc = resolveCharacterAvatarSrc(plugin, ch, (newUrl) => {
      const existingImg = standBox.querySelector("img");
      if (existingImg && existingImg.isConnected) {
        existingImg.dataset.origSrc = newUrl;
        existingImg.src = newUrl;
      }
    });

    let figImg = null;
    if (avaSrc) {
      figImg = standBox.createEl("img", {
        cls: "curator-height-stand-img",
        attr: { src: avaSrc, alt: ch.name }
      });
      figImg.dataset.origSrc = avaSrc;
      figImg.loading = "lazy";
    } else {
      standBox.createSpan({
        cls: "curator-char-avatar-fallback",
        text: (ch.name || "角").slice(0, 1)
      });
    }

    const applyColVisuals = () => {
      const currH = parseCharacterHeightCm(ch);
      const currFrame = getCharacterPortraitFrame(ch);
      const targetPx = Math.max(40, Math.round(currH.cm * pxPerCm));
      const bottomPct = Math.min(99, (currH.cm / maxScaleCm) * 100);

      headMarker.style.bottom = `${bottomPct}%`;
      headBadge.setText(`${currH.displayLabel}`);
      headBadge.title = currH.isEstimated
        ? "当前为根据特征估算的参考身高，可在上方输入真实身高或点击自动补全"
        : `${ch.name} 身高：${currH.cm} cm`;

      const aspect =
        figImg && figImg.naturalWidth && figImg.naturalHeight
          ? figImg.naturalWidth / figImg.naturalHeight
          : ch._naturalAspect || 0.62;
      const colWidth = Math.max(128, Math.min(250, Math.round(targetPx * aspect) + 8));
      col.style.width = `${colWidth}px`;
      col.style.flex = `0 0 ${colWidth}px`;

      standBox.style.height = `${targetPx}px`;
      if (figImg) {
        const panX = Math.round((currFrame.standPanX - 50) * 1.1);
        figImg.style.transformOrigin = "50% 100%";
        figImg.style.transform = `translate(${panX}px, ${-currFrame.footOffsetPx}px) scale(${currFrame.heightScale})`;
      }
    };
    if (figImg) {
      figImg.onload = () => {
        if (figImg.naturalWidth && figImg.naturalHeight) {
          ch._naturalAspect = figImg.naturalWidth / figImg.naturalHeight;
        }
        if (figImg.dataset.isCutoutApplied !== "1") {
          const currFrame = getCharacterPortraitFrame(ch);
          const effBgMode =
            currFrame.removeSolidBg === "on"
              ? "on"
              : currFrame.removeSolidBg === "off"
              ? "off"
              : isAutoRemoveBgOn
              ? "auto"
              : "off";
          if (effBgMode !== "off") {
            const cutoutUrl = removeCharacterSolidBackgroundViaCanvas(figImg, { mode: effBgMode });
            if (cutoutUrl && figImg.src !== cutoutUrl) {
              figImg.dataset.isCutoutApplied = "1";
              figImg.src = cutoutUrl;
              standBox.addClass("is-bg-removed");
              return;
            }
          }
          standBox.removeClass("is-bg-removed");
        }
        delete figImg.dataset.isCutoutApplied;
        applyColVisuals();
      };
    }
    applyColVisuals();

    if (isSelected) {
      selectedColRefs = {
        char: ch,
        figImg,
        applyColVisuals,
        pedestalSubSpan: null
      };
    }

    // 支持在立绘列上直接按住拖拽校准脚底基准点、滚轮调整立绘缩放、单击选中、双击打开角色档案
    let pointerDownMoved = false;
    let draggingCol = false;
    let startClientY = 0;
    let startClientX = 0;
    let initFootOffset = 0;
    let initPanX = 50;

    figureStageBox.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      pointerDownMoved = false;
      draggingCol = true;
      startClientY = ev.clientY;
      startClientX = ev.clientX;
      const f = getCharacterPortraitFrame(ch);
      initFootOffset = f.footOffsetPx;
      initPanX = f.standPanX;
      col.addClass("is-calibrating");
      try {
        figureStageBox.setPointerCapture(ev.pointerId);
      } catch (_) {}
    });

    figureStageBox.addEventListener("pointermove", (ev) => {
      if (!draggingCol) return;
      const dy = startClientY - ev.clientY;
      const dx = ev.clientX - startClientX;
      if (Math.abs(dy) > 3 || Math.abs(dx) > 3) {
        pointerDownMoved = true;
      }
      if (!pointerDownMoved) return;
      const f = getCharacterPortraitFrame(ch);
      f.footOffsetPx = Math.max(-180, Math.min(180, Math.round(initFootOffset + dy)));
      f.standPanX = Math.max(0, Math.min(100, Math.round(initPanX + dx * 0.4)));
      ch.portraitFrame = f;
      applyColVisuals();
      if (ch.id === selectedChar.id) {
        offsetSlider.value = String(f.footOffsetPx);
        offsetValLabel.setText(`${f.footOffsetPx}px`);
      }
    });

    const finishColPointer = () => {
      if (!draggingCol) return;
      draggingCol = false;
      col.removeClass("is-calibrating");
      if (pointerDownMoved) {
        scheduleSaveCharCalibration(ch);
        if (ch.id !== selectedChar.id) {
          uiState.selectedHeightCharId = ch.id;
          renderCharacterGallerySection(
            plugin,
            galleryHost,
            allCharacters,
            vaultAnimeByTitle,
            uiState,
            options,
            onFullRefresh
          );
        }
      } else {
        if (uiState.selectedHeightCharId !== ch.id) {
          uiState.selectedHeightCharId = ch.id;
          renderCharacterGallerySection(
            plugin,
            galleryHost,
            allCharacters,
            vaultAnimeByTitle,
            uiState,
            options,
            onFullRefresh
          );
        } else {
          openCharacterDetailModal(plugin, ch, vaultAnimeByTitle, onFullRefresh);
        }
      }
    };
    figureStageBox.addEventListener("pointerup", finishColPointer);
    figureStageBox.addEventListener("pointercancel", () => {
      draggingCol = false;
      col.removeClass("is-calibrating");
    });

    // 鼠标滚轮直接微调当前指向角色的等身缩放比例
    figureStageBox.addEventListener(
      "wheel",
      (ev) => {
        if (!isSelected && !ev.altKey && !ev.ctrlKey) return;
        ev.preventDefault();
        const f = getCharacterPortraitFrame(ch);
        const delta = ev.deltaY < 0 ? 0.04 : -0.04;
        f.heightScale = Math.max(
          0.35,
          Math.min(2.6, Math.round((f.heightScale + delta) * 100) / 100)
        );
        ch.portraitFrame = f;
        applyColVisuals();
        if (ch.id === selectedChar.id) {
          scaleSlider.value = String(Math.round(f.heightScale * 100));
          scaleValLabel.setText(`${Math.round(f.heightScale * 100)}%`);
        }
        scheduleSaveCharCalibration(ch);
      },
      { passive: false }
    );

    // 底部基座铭牌
    const pedestal = col.createDiv("curator-height-pedestal");
    const nameSpan = pedestal.createDiv({
      cls: "curator-height-pedestal-name",
      text: ch.name
    });
    nameSpan.title = `点击查看《${ch.name}》完整角色典藏档案`;
    const subSpan = pedestal.createDiv({
      cls: "curator-height-pedestal-meta curator-mono",
      text: `${hInfo.displayLabel} · ★${Number(ch.favoriteScore || 9.0).toFixed(1)}`
    });
    if (isSelected && selectedColRefs) {
      selectedColRefs.pedestalSubSpan = subSpan;
    }

    pedestal.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterDetailModal(plugin, ch, vaultAnimeByTitle, onFullRefresh);
    };
  });

  // 绑定顶部校准条控件与当前选中角色列的实时联动
  if (selectedColRefs) {
    cmInput.oninput = () => {
      const val = Number(cmInput.value);
      if (Number.isFinite(val) && val >= 30 && val <= 260) {
        selectedChar.height = `${val}cm`;
        selectedColRefs.applyColVisuals();
        if (selectedColRefs.pedestalSubSpan) {
          selectedColRefs.pedestalSubSpan.setText(
            `${val}cm · ★${Number(selectedChar.favoriteScore || 9.0).toFixed(1)}`
          );
        }
        scheduleSaveCharCalibration(selectedChar);
      }
    };

    scaleSlider.oninput = () => {
      const pct = Number(scaleSlider.value);
      const f = getCharacterPortraitFrame(selectedChar);
      f.heightScale = Math.round(pct) / 100;
      selectedChar.portraitFrame = f;
      scaleValLabel.setText(`${Math.round(pct)}%`);
      selectedColRefs.applyColVisuals();
      scheduleSaveCharCalibration(selectedChar);
    };

    offsetSlider.oninput = () => {
      const px = Number(offsetSlider.value);
      const f = getCharacterPortraitFrame(selectedChar);
      f.footOffsetPx = Math.round(px);
      selectedChar.portraitFrame = f;
      offsetValLabel.setText(`${Math.round(px)}px`);
      selectedColRefs.applyColVisuals();
      scheduleSaveCharCalibration(selectedChar);
    };

    autoFitSelBtn.onclick = (e) => {
      e.preventDefault();
      const currH = parseCharacterHeightCm(selectedChar);
      const targetPx = Math.max(40, Math.round(currH.cm * pxPerCm));
      const bounds = detectImageVerticalSubjectBounds(selectedColRefs.figImg, targetPx);
      const f = getCharacterPortraitFrame(selectedChar);
      f.heightScale = bounds.heightScale;
      f.footOffsetPx = bounds.footOffsetPx;
      f.standPanX = 50;
      selectedChar.portraitFrame = f;
      scaleSlider.value = String(Math.round(f.heightScale * 100));
      scaleValLabel.setText(`${Math.round(f.heightScale * 100)}%`);
      offsetSlider.value = String(f.footOffsetPx);
      offsetValLabel.setText(`${f.footOffsetPx}px`);
      selectedColRefs.applyColVisuals();
      scheduleSaveCharCalibration(selectedChar);
      if (Notice) {
        new Notice(
          `✨ 已为《${selectedChar.name}》智能消除图片上下留白（比例 ${Math.round(f.heightScale * 100)}% · 偏移 ${f.footOffsetPx}px）`
        );
      }
    };

    resetSelBtn.onclick = (e) => {
      e.preventDefault();
      const f = getCharacterPortraitFrame(selectedChar);
      f.heightScale = 1.0;
      f.footOffsetPx = 0;
      f.standPanX = 50;
      selectedChar.portraitFrame = f;
      scaleSlider.value = "100";
      scaleValLabel.setText("100%");
      offsetSlider.value = "0";
      offsetValLabel.setText("0px");
      selectedColRefs.applyColVisuals();
      scheduleSaveCharCalibration(selectedChar);
    };
  }

  wrap.createDiv({
    cls: "curator-height-stage-footnote",
    text: "💡 提示：单击任意角色即可选中并在上方快速调整其「真实身高 / 图片比例 / 基准点偏移」或点击「✨ 智能消除留白」；直接在立绘上按住上下拖拽也可实时对齐 0cm 地面基准线，再次点击已选中角色或底部铭牌可打开完整角色典藏档案。"
  });
}

/**
 * 渲染「🖼️ 画报照片墙（Aves 相册风格 · 等高自适应完整无裁切拼图墙）」
 * 根据每张角色图片的真实宽高比动态分配磁贴宽度，100% 完整呈现整张原图（绝不截断头部或脚部），
 * 并支持行高密度切换（紧凑 / 标准 / 舒展）与超长画墙折叠/展开。
 */
function renderCharacterPhotoWallStage(
  plugin,
  galleryHost,
  displayList,
  allCharacters,
  vaultAnimeByTitle,
  uiState,
  options,
  onFullRefresh
) {
  const wallWrap = galleryHost.createDiv("curator-char-photowall-wrap");
  if (displayList.length === 0) {
    wallWrap.createDiv({
      cls: "curator-rs-empty",
      text: "当前筛选条件下暂无角色。"
    });
    return;
  }

  if (!uiState.photoWallRowHeight) uiState.photoWallRowHeight = 240;
  if (uiState.photoWallCaptionMode === undefined) uiState.photoWallCaptionMode = "hover";
  if (uiState.photoWallExpanded === undefined) uiState.photoWallExpanded = false;

  // 照片墙顶部轻量控制栏（行高密度 + 铭牌显示方式 + 展开/收起）
  const wallBar = wallWrap.createDiv("curator-photowall-toolbar");
  const hintLeft = wallBar.createDiv("curator-photowall-hint");
  hintLeft.createSpan({
    text: "🖼️ Aves 自适应完整画报墙 · 按原图真实宽高比完整拼贴呈现，点击任意角色查看典藏档案"
  });

  const ctrlRight = wallBar.createDiv("curator-photowall-ctrls");
  [
    { h: 185, label: "📏 紧凑" },
    { h: 240, label: "🖼️ 标准" },
    { h: 310, label: "✨ 舒展" }
  ].forEach((preset) => {
    const b = ctrlRight.createEl("button", {
      cls: `curator-dl-mini-btn ${uiState.photoWallRowHeight === preset.h ? "is-active" : ""}`,
      text: preset.label
    });
    b.onclick = (e) => {
      e.preventDefault();
      uiState.photoWallRowHeight = preset.h;
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        allCharacters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };
  });

  const capToggleBtn = ctrlRight.createEl("button", {
    cls: `curator-dl-mini-btn ${uiState.photoWallCaptionMode === "always" ? "is-active" : ""}`,
    text: uiState.photoWallCaptionMode === "hover" ? "🏷️ 铭牌：悬停浮现" : "📌 铭牌：常驻显示"
  });
  capToggleBtn.onclick = (e) => {
    e.preventDefault();
    uiState.photoWallCaptionMode = uiState.photoWallCaptionMode === "hover" ? "always" : "hover";
    renderCharacterGallerySection(
      plugin,
      galleryHost,
      allCharacters,
      vaultAnimeByTitle,
      uiState,
      options,
      onFullRefresh
    );
  };

  const shouldEnableCollapse = !options.compactAlmanacMode && displayList.length > 6;
  const collapseContainer = wallWrap.createDiv(
    `curator-photowall-collapse-box ${shouldEnableCollapse && !uiState.photoWallExpanded ? "is-collapsed" : ""}`
  );

  const masonry = collapseContainer.createDiv(
    `curator-char-photowall-grid ${uiState.photoWallCaptionMode === "hover" ? "is-hover-plaque" : "is-always-plaque"}`
  );

  const rowH = Number(uiState.photoWallRowHeight) || 240;

  displayList.forEach((ch, idx) => {
    const tile = masonry.createDiv("curator-char-photowall-tile");
    tile.dataset.charId = ch.id;
    tile.style.setProperty("--stagger-idx", String(idx));

    const applyTileAspectLayout = (aspectRatio) => {
      const clampedAspect = Math.max(0.32, Math.min(2.4, Number(aspectRatio) || 0.68));
      const baseWidth = Math.round(rowH * clampedAspect);
      tile.style.height = `${rowH}px`;
      tile.style.flex = `${Math.round(clampedAspect * 100)} 1 ${baseWidth}px`;
      tile.style.maxWidth = `${Math.round(baseWidth * 1.48)}px`;
    };

    // 先以缓存宽高比或默认立绘宽高比初始化，图片加载完成后立即按真实宽高比无损排布
    applyTileAspectLayout(ch._naturalAspect || 0.66);

    const imgWrap = tile.createDiv("curator-char-photowall-imgwrap");
    const avaSrc = resolveCharacterAvatarSrc(plugin, ch, (newUrl) => {
      const existingImg = imgWrap.querySelector("img");
      if (existingImg && existingImg.isConnected) existingImg.src = newUrl;
    });

    if (avaSrc) {
      const img = imgWrap.createEl("img", {
        cls: "curator-char-photowall-img",
        attr: { src: avaSrc, alt: ch.name }
      });
      img.loading = "lazy";
      const updateFromNaturalSize = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const realAspect = img.naturalWidth / img.naturalHeight;
          ch._naturalAspect = realAspect;
          applyTileAspectLayout(realAspect);
        }
      };
      if (img.complete && img.naturalWidth > 0) {
        updateFromNaturalSize();
      } else {
        img.onload = updateFromNaturalSize;
      }
    } else {
      imgWrap.createSpan({
        cls: "curator-char-avatar-fallback",
        text: (ch.name || "角").slice(0, 1)
      });
    }

    // 右上角轻量评分徽章与快速换图/取景按钮
    const topBar = tile.createDiv("curator-char-photowall-topbar");
    topBar.createSpan({
      cls: "curator-char-photowall-score curator-mono",
      text: `★ ${Number(ch.favoriteScore || 9.0).toFixed(1)}`
    });

    const cropQuickBtn = topBar.createEl("button", {
      cls: "curator-char-photowall-cropbtn",
      text: "🖼️"
    });
    cropQuickBtn.title = "更换自定义角色图片或调整档案卡片取景";
    cropQuickBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCharacterPortraitStudioModal(plugin, ch, () => {
        renderCharacterGallerySection(
          plugin,
          galleryHost,
          allCharacters,
          vaultAnimeByTitle,
          uiState,
          options,
          onFullRefresh
        );
      });
    };

    // 底部克制优雅的浮层铭牌（仅展示角色名、身高与前 3 个核心萌点）
    const plaque = tile.createDiv("curator-char-photowall-plaque");
    const hInfo = parseCharacterHeightCm(ch);
    const titleLine = plaque.createDiv("curator-char-photowall-titleline");
    titleLine.createSpan({ cls: "curator-char-photowall-name", text: ch.name });
    titleLine.createSpan({
      cls: "curator-char-photowall-height curator-mono",
      text: ch.height || hInfo.displayLabel
    });

    if (Array.isArray(ch.moePoints) && ch.moePoints.length > 0) {
      plaque.createDiv({
        cls: "curator-char-photowall-moes",
        text: ch.moePoints.slice(0, 4).join(" · ")
      });
    }

    tile.onclick = (ev) => {
      ev.preventDefault();
      openCharacterDetailModal(plugin, ch, vaultAnimeByTitle, onFullRefresh);
    };
  });

  if (shouldEnableCollapse) {
    const expandBar = wallWrap.createDiv("curator-photowall-expand-bar");
    const expandBtn = expandBar.createEl("button", {
      cls: "curator-dl-mini-btn is-accent",
      text: uiState.photoWallExpanded
        ? "▴ 收起为紧凑画报墙预览"
        : `▾ 展开全部画报照片墙（共 ${displayList.length} 位角色）`
    });
    expandBtn.onclick = (e) => {
      e.preventDefault();
      uiState.photoWallExpanded = !uiState.photoWallExpanded;
      renderCharacterGallerySection(
        plugin,
        galleryHost,
        allCharacters,
        vaultAnimeByTitle,
        uiState,
        options,
        onFullRefresh
      );
    };
  }
}

module.exports = {
  searchBangumiCharacters,
  fetchBangumiCharacterDetail,
  parseBangumiCharacterHtml,
  parseMoegirlInfoboxHtml,
  fetchMoegirlCharacterData,
  fetchDualSourceCharacterProfile,
  openMoegirlBrowserExtractModal,
  normalizeCharacterNameForCompare,
  areCharactersSimilar,
  findSimilarCharactersInCollection,
  mergeCharacterRecords,
  detectDuplicateCharacterGroups,
  mergeAllDuplicateCharactersInGallery,
  openDuplicateCharacterConfirmModal,
  openCharacterDeleteConfirmModal,
  resolveCharacterNoteFolder,
  isCharacterNotePath,
  resolveCharacterNoteFile,
  parseCharacterNoteMarkdown,
  syncCharacterNoteToCollection,
  reconcileCharacterCollectionWithNotes,
  resolveCharacterAvatarSrc,
  saveCharacterAvatarLocally,
  createOrUpdateCharacterMarkdownNote,
  computeMoeAttributeRanking,
  createPresetRoxyCharacterRecord,
  getCharacterPortraitFrame,
  applyCharacterPortraitFrameToImg,
  removeCharacterSolidBackgroundViaCanvas,
  parseCharacterHeightCm,
  openCharacterPortraitStudioModal,
  openCharacterDetailModal,
  renderCharacterArchiveWorkspace
};
