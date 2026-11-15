const { requestUrl } = require("obsidian");

var HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/html;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
};
var BGM_API_HEADERS = {
  "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)",
  "Accept": "application/json"
};

async function requestWithLogicalTimeout(reqOptions, timeoutMs = 6500) {
  let timer = null;
  const p = requestUrl(reqOptions);
  p.catch(() => {});
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("REQUEST_TIMEOUT_" + timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function requestHtmlRaw(url, timeoutMs = 6500) {
  const response = await requestWithLogicalTimeout({
    url,
    method: "GET",
    cache: "no-cache",
    headers: HEADERS
  }, timeoutMs);
  return (response && response.text) || "";
}

async function requestHtml(url) {
  try {
    const html = await requestHtmlRaw(url, 6500);
    if (html) return html;
  } catch (err) {
    if (String(url || "").startsWith("https://bgm.tv/")) {
      const mirrorUrl = "https://bangumi.tv/" + String(url).slice("https://bgm.tv/".length);
      try {
        const mirrorHtml = await requestHtmlRaw(mirrorUrl, 6500);
        if (mirrorHtml) return mirrorHtml;
      } catch (_) {}
    }
    throw err;
  }
  return "";
}

async function fetchBgmV0SubjectJson(subjectId, timeoutMs = 6000) {
  const id = String(subjectId || "").trim();
  if (!/^\d+$/.test(id)) return null;
  try {
    const resp = await requestWithLogicalTimeout({
      url: "https://api.bgm.tv/v0/subjects/" + encodeURIComponent(id),
      method: "GET",
      headers: BGM_API_HEADERS,
      throw: false
    }, timeoutMs);
    if (resp && resp.status >= 200 && resp.status < 300) {
      const data = resp.json || (resp.text ? JSON.parse(resp.text) : null);
      if (data && typeof data === "object" && data.id) {
        return data;
      }
    }
  } catch (_) {}
  return null;
}

function calculatePreciseRatingFromCounts(countsObj, declaredTotal) {
  if (!countsObj || typeof countsObj !== "object") return null;
  let weightedTotal = 0;
  let calcVotes = 0;
  for (let s = 1; s <= 10; s += 1) {
    const c = Number(countsObj[s] ?? countsObj[String(s)] ?? 0);
    if (Number.isFinite(c) && c > 0) {
      weightedTotal += s * c;
      calcVotes += c;
    }
  }
  const totalVotes = Number.isFinite(Number(declaredTotal)) && Number(declaredTotal) > 0
    ? Number(declaredTotal)
    : calcVotes;
  if (!Number.isFinite(totalVotes) || totalVotes <= 1 || weightedTotal <= 0) {
    return null;
  }
  return weightedTotal / totalVotes;
}

function readInfoboxValueFromV0(infobox, candidateKeys, fallback = "\u672A\u77E5") {
  if (!Array.isArray(infobox)) return fallback;
  for (const key of candidateKeys) {
    const entry = infobox.find((item) => item && cleanText(item.key) === key);
    if (!entry || entry.value == null) continue;
    if (Array.isArray(entry.value)) {
      const joined = entry.value
        .map((v) => (v && typeof v === "object" ? cleanText(v.v || v.k || "") : cleanText(v)))
        .filter(Boolean)
        .join(" / ");
      if (joined) return joined;
    } else {
      const text = cleanText(entry.value);
      if (text) return text;
    }
  }
  return fallback;
}

function detectAdaptationFromTagsAndInfobox(tagNames, infobox) {
  const list = Array.isArray(tagNames) ? tagNames.map((x) => String(x || "")) : [];
  const rules = [
    ["\u5C0F\u8BF4\u6539\u7F16", ["\u8F7B\u5C0F\u8BF4\u6539", "\u8F7B\u6539", "\u5C0F\u8BF4\u6539", "\u5C0F\u8BF4\u6539\u7F16"]],
    ["\u6F2B\u753B\u6539\u7F16", ["\u6F2B\u753B\u6539", "\u6F2B\u753B\u6539\u7F16"]],
    ["\u6E38\u620F\u6539\u7F16", ["\u6E38\u620F\u6539", "\u6E38\u620F\u6539\u7F16"]],
    ["\u539F\u521B\u52A8\u753B", ["\u539F\u521B"]]
  ];
  for (const [cat, words] of rules) {
    if (words.some((w) => list.some((t) => t.includes(w)))) return cat;
  }
  const rawOrigin = readInfoboxValueFromV0(infobox, ["\u539F\u4F5C", "\u539F\u6848"], "");
  if (rawOrigin) {
    if (rawOrigin.includes("\u6F2B\u753B")) return "\u6F2B\u753B\u6539\u7F16";
    if (rawOrigin.includes("\u5C0F\u8BF4") || rawOrigin.includes("\u30CE\u30D9\u30EB")) return "\u5C0F\u8BF4\u6539\u7F16";
    if (rawOrigin.includes("\u6E38\u620F") || rawOrigin.includes("\u30B2\u30FC\u30E0")) return "\u6E38\u620F\u6539\u7F16";
  }
  return "\u5176\u5B83";
}
function parseHtml(html) {
  return new DOMParser().parseFromString(
    html || "<html></html>",
    "text/html"
  );
}
function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function cleanFileName(value) {
  return cleanText(value).replace(/[\*"\\\/<>:\|?]/g, " ").trim();
}
function getSubjectId(url) {
  const match = String(url || "").match(
    /\/subject\/(\d+)/i
  );
  return match ? match[1] : "";
}
function getNetabaUrl(url) {
  const subjectId = getSubjectId(url);
  return subjectId ? "https://netaba.re/subject/" + subjectId : "";
}
async function searchBangumi(keyword) {
  const cleanKw = String(keyword || "").trim();
  if (!cleanKw) return [];

  // Tier 1: Official Bangumi v0 Search API (fast, cookie-free, immune to chii_searchDateLine redirect on Desktop & Mobile)
  try {
    const resp = await requestWithLogicalTimeout({
      url: "https://api.bgm.tv/v0/search/subjects?limit=15",
      method: "POST",
      headers: Object.assign({}, BGM_API_HEADERS, {
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        keyword: cleanKw,
        filter: { type: [2] }
      }),
      throw: false
    }, 6000);
    if (resp && resp.status >= 200 && resp.status < 300) {
      const json = resp.json || (resp.text ? JSON.parse(resp.text) : null);
      const listData = Array.isArray(json && json.data) ? json.data : [];
      if (listData.length > 0) {
        return listData
          .filter((item) => item && item.id)
          .map((item) => {
            const cn = cleanText(item.name_cn || "");
            const jp = cleanText(item.name || "");
            const title = cn || jp || ("Subject " + item.id);
            const descParts = [];
            if (cn && jp && cn !== jp) descParts.push(jp);
            if (item.date) descParts.push(cleanText(item.date) + " 开播");
            if (item.rating && Number.isFinite(Number(item.rating.score)) && Number(item.rating.score) > 0) {
              descParts.push("BGM " + Number(item.rating.score).toFixed(1));
            }
            return {
              title,
              description: descParts.join(" / "),
              url: "https://bgm.tv/subject/" + item.id
            };
          });
      }
    }
  } catch (_) {}

  // Tier 2: Bangumi legacy JSON search API
  try {
    const legacyResp = await requestWithLogicalTimeout({
      url: "https://api.bgm.tv/search/subject/" + encodeURIComponent(cleanKw) + "?type=2&responseGroup=small",
      method: "GET",
      headers: BGM_API_HEADERS,
      throw: false
    }, 5500);
    if (legacyResp && legacyResp.status >= 200 && legacyResp.status < 300) {
      const legacyJson = legacyResp.json || (legacyResp.text ? JSON.parse(legacyResp.text) : null);
      const legacyList = Array.isArray(legacyJson && legacyJson.list) ? legacyJson.list : [];
      if (legacyList.length > 0) {
        return legacyList
          .filter((item) => item && item.id)
          .map((item) => {
            const cn = cleanText(item.name_cn || "");
            const jp = cleanText(item.name || "");
            return {
              title: cn || jp || ("Subject " + item.id),
              description: [cn && jp && cn !== jp ? jp : "", item.air_date ? cleanText(item.air_date) + " 开播" : ""].filter(Boolean).join(" / "),
              url: "https://bgm.tv/subject/" + item.id
            };
          });
      }
    }
  } catch (_) {}

  // Tier 3: HTML search fallback (bgm.tv -> bangumi.tv)
  const searchUrl = "https://bgm.tv/subject_search/" + encodeURIComponent(cleanKw) + "?cat=2";
  const html = await requestHtml(searchUrl);
  if (!html) {
    return [];
  }
  const doc = parseHtml(html);
  const list = doc.querySelector(
    "#browserItemList"
  );
  if (!list) {
    return [];
  }
  const results = [];
  for (const item of list.querySelectorAll("li.item")) {
    const titleLink = item.querySelector("h3 a");
    const typeIcon = item.querySelector("h3 span");
    const info = item.querySelector(".info.tip");
    if (!titleLink) {
      continue;
    }
    if (typeIcon && !String(
      typeIcon.className || ""
    ).includes(
      "subject_type_2"
    )) {
      continue;
    }
    const href = titleLink.getAttribute("href");
    if (!href) {
      continue;
    }
    results.push({
      title: cleanText(
        titleLink.textContent
      ),
      description: cleanText(
        info ? info.textContent : ""
      ),
      url: href.startsWith("http") ? href : "https://bgm.tv" + href
    });
  }
  return results;
}
function extractField(text, patterns, defaultValue = "\u672A\u77E5") {
  for (const pattern of patterns) {
    const match = String(text || "").match(
      pattern
    );
    if (match && match[1]) {
      return cleanText(match[1]).replace(/\n/g, "").replace(/\r/g, "");
    }
  }
  return defaultValue;
}
function extractRawSubjectTagsFromDoc(doc) {
  const rawTags = [];
  if (!doc) return rawTags;
  const subtitles = doc.querySelectorAll("h2.subtitle");
  let tagSection = null;
  for (const h2 of subtitles) {
    if (String(h2.textContent || "").includes("标注为")) {
      tagSection = h2;
      break;
    }
  }
  if (!tagSection) {
    tagSection = doc.querySelector(".subject_tag_section");
  }
  const container =
    tagSection && tagSection.classList && tagSection.classList.contains("subject_tag_section")
      ? tagSection
      : (tagSection ? tagSection.nextElementSibling : doc.querySelector(".subject_tag_section"));
  if (!container) return rawTags;
  for (const tag of container.querySelectorAll("a.l.meta, a.l")) {
    const span = tag.querySelector("span");
    const small = tag.querySelector("small");
    const name = cleanText(span ? span.textContent : tag.textContent);
    const count = small ? Number(String(small.textContent || "").replace(/[^\d]/g, "")) || 0 : 0;
    if (name) {
      rawTags.push({ name, count });
    }
  }
  return rawTags;
}

const IGNORED_SUBJECT_TAG_RE = /^(?:TV|TVA|OVA|OAD|WEB|ONA|MOVIE|SP|剧场版|动画|日本|日本动画|日漫|国产|国漫|欧美|美国|bangumi|已看|在看|想看|抛弃|搁置|补番|待看|弃番|未看|打卡|未确定)$/i;
const DATE_LIKE_TAG_RE = /^(?:\d{2,4}年?(?:[-./年]?\d{1,2}月?(?:新番)?)?|\d{1,2}月(?:新番)?|\d{4}[Qq]\d|20\d{2}s?)$/i;

function cleanSubjectGenreTags(rawEntries, maxCount = 10) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return [];
  const normalizedList = rawEntries.map((entry) => {
    if (typeof entry === "string") {
      return { name: entry, count: 10 };
    }
    return {
      name: String((entry && entry.name) || ""),
      count: Number(entry && entry.count) || 0
    };
  });
  const topCount = normalizedList.reduce((m, item) => (item.count > m ? item.count : m), 0);
  const minCountThreshold = topCount >= 50 ? 5 : topCount >= 20 ? 3 : 0;

  const result = [];
  const seenLower = new Set(["bangumi"]);
  for (const item of normalizedList) {
    if (minCountThreshold > 0 && item.count > 0 && item.count < minCountThreshold && result.length >= 4) {
      continue;
    }
    let cleaned = cleanText(item.name)
      .replace(/^[#\s]+/, "")
      .replace(/["'`\[\]{}()<>\\|,;:!?/]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!cleaned || cleaned.length > 20) continue;
    if (/^\d+$/.test(cleaned)) continue;
    if (DATE_LIKE_TAG_RE.test(cleaned)) continue;
    if (IGNORED_SUBJECT_TAG_RE.test(cleaned)) continue;
    const lower = cleaned.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    result.push(cleaned);
    if (result.length >= maxCount) break;
  }
  return result;
}

function extractSubjectGenreTagsFromDoc(doc, maxCount = 10) {
  return cleanSubjectGenreTags(extractRawSubjectTagsFromDoc(doc), maxCount);
}

function detectAdaptationType(doc) {
  const allTags = extractRawSubjectTagsFromDoc(doc).map((item) => item.name);
  const tagSection = null;
  if (false && String(tagSection || "").includes(
    "\u6807\u6CE8\u4E3A"
  )) {
    const container = tagSection.nextElementSibling;
    if (container) {
      for (const tag of container.querySelectorAll(
        "a.l.meta, a.l"
      )) {
        const span = tag.querySelector("span");
        if (span) {
          allTags.push(
            cleanText(
              span.textContent
            )
          );
        }
      }
    }
  }
  const keywords = {
    "\u5C0F\u8BF4\u6539\u7F16": [
      "\u8F7B\u5C0F\u8BF4\u6539",
      "\u8F7B\u6539",
      "\u5C0F\u8BF4\u6539",
      "\u5C0F\u8BF4\u6539\u7F16"
    ],
    "\u6F2B\u753B\u6539\u7F16": [
      "\u6F2B\u753B\u6539",
      "\u6F2B\u753B\u6539\u7F16"
    ],
    "\u6E38\u620F\u6539\u7F16": [
      "\u6E38\u620F\u6539",
      "\u6E38\u620F\u6539\u7F16"
    ],
    "\u539F\u521B\u52A8\u753B": [
      "\u539F\u521B"
    ]
  };
  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (allTags.some(
        (tag) => tag.includes(word)
      )) {
        return category;
      }
    }
  }
  for (const item of doc.querySelectorAll(
    "#infobox > li"
  )) {
    const text = cleanText(item.textContent);
    if (!text.includes("\u539F\u4F5C") && !text.includes("\u539F\u6848")) {
      continue;
    }
    if (text.includes("\u6F2B\u753B")) {
      return "\u6F2B\u753B\u6539\u7F16";
    }
    if (text.includes("\u5C0F\u8BF4") || text.includes("\u30CE\u30D9\u30EB") || text.includes("\u30E9\u30A4\u30C8\u30CE\u30D9\u30EB")) {
      return "\u5C0F\u8BF4\u6539\u7F16";
    }
    if (text.includes("\u6E38\u620F") || text.includes("\u30B2\u30FC\u30E0")) {
      return "\u6E38\u620F\u6539\u7F16";
    }
  }
  return "\u5176\u5B83";
}
function calculatePreciseRating(doc) {
  if (!doc) {
    return null;
  }

  const voteElement = doc.querySelector(
    "span[property='v:votes']"
  );

  const voteText = cleanText(
    voteElement ? voteElement.textContent : ""
  );

  const declaredVotes = Number(
    voteText.replace(/[^\d]/g, "")
  );

  const counts = {};

  for (const item of doc.querySelectorAll(
    ".horizontalChart li"
  )) {
    const labelElement = item.querySelector(
      ".label"
    );

    const countElement = item.querySelector(
      ".count"
    );

    const score = Number(
      cleanText(
        labelElement ? labelElement.textContent : ""
      )
    );

    const countText = cleanText(
      countElement ? countElement.textContent : ""
    );

    const count = Number(
      countText.replace(/[^\d]/g, "")
    );

    if (
      Number.isInteger(score) &&
      score >= 1 &&
      score <= 10 &&
      Number.isFinite(count) &&
      count >= 0
    ) {
      counts[score] = count;
    }
  }

  const calculatedVotes = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0
  );

  const totalVotes =
    Number.isFinite(declaredVotes) &&
    declaredVotes > 0
      ? declaredVotes
      : calculatedVotes;

  if (!Number.isFinite(totalVotes) || totalVotes <= 1) {
    return null;
  }

  let weightedTotal = 0;

  for (let score = 1; score <= 10; score += 1) {
    weightedTotal += score * (counts[score] || 0);
  }

  if (!Number.isFinite(weightedTotal) || weightedTotal <= 0) {
    return null;
  }

  return weightedTotal / totalVotes;
}
async function getAnimeDetail(url) {
  const subjectId = getSubjectId(url);
  const [htmlOutcome, v0Data] = await Promise.all([
    requestHtml(url).catch(() => ""),
    fetchBgmV0SubjectJson(subjectId, 6000)
  ]);

  const html = htmlOutcome || "";
  let htmlInfo = null;
  if (html) {
    const doc = parseHtml(html);
    const header = doc.querySelector("#headerSubject");
    if (!header || header.getAttribute("typeof") === "v:Movie") {
      const keywords = doc.querySelector("meta[name='keywords']");
      const keywordText = keywords ? keywords.getAttribute("content") || "" : "";
      const keywordParts = keywordText.split(",");
      const cn = cleanFileName(keywordParts[0] || "");
      const jp = cleanFileName(keywordParts[1] || "");
      const type = cleanText(doc.querySelector("small.grey")?.textContent);
      const rating = cleanText(doc.querySelector("span[property='v:average']")?.textContent) || "\u672A\u77E5";
      let poster = doc.querySelector("div[align='center'] > a")?.href || "";
      poster = String(poster).replace("app://", "http://").trim();
      if (!poster.startsWith("http")) poster = "";
      const infobox = [...doc.querySelectorAll("#infobox > li")].map((item) => item.innerText).join("\n");
      const episode = extractField(infobox, [/话数:\s*(\d+)/, /话数：\s*(\d+)/], "0");
      const director = extractField(infobox, [/导演:\s*([^\n]+)/, /导演：\s*([^\n]+)/]);
      const maker = extractField(infobox, [/动画制作:\s*([^\n]+)/, /动画制作：\s*([^\n]+)/]);
      const music = extractField(infobox, [/音乐:\s*([^\n]+)/, /音乐：\s*([^\n]+)/]);
      let datePattern;
      if (type === "OVA") {
        datePattern = [/发售日:\s*([^\n]+)/, /发售日：\s*([^\n]+)/];
      } else if (type === "\u5267\u573A\u7248") {
        datePattern = [/上映年度:\s*([^\n]+)/, /上映年度：\s*([^\n]+)/];
      } else {
        datePattern = [/放送开始:\s*([^\n]+)/, /放送开始：\s*([^\n]+)/];
      }
      const date = extractField(infobox, datePattern);
      htmlInfo = {
        cn,
        jp,
        type,
        rating,
        preciseRating: calculatePreciseRating(doc),
        poster,
        episode,
        director,
        maker,
        music,
        date,
        catego: detectAdaptationType(doc),
        tags: extractSubjectGenreTagsFromDoc(doc, 10)
      };
    }
  }

  if (!htmlInfo && !v0Data) {
    return null;
  }

  const v0Cn = v0Data ? cleanFileName(v0Data.name_cn || readInfoboxValueFromV0(v0Data.infobox, ["\u4E2D\u6587\u540D"], "")) : "";
  const v0Jp = v0Data ? cleanFileName(v0Data.name || "") : "";
  const v0Type = v0Data ? cleanText(v0Data.platform || "") : "";
  const v0Score = v0Data && v0Data.rating && Number.isFinite(Number(v0Data.rating.score)) && Number(v0Data.rating.score) > 0
    ? String(v0Data.rating.score)
    : "\u672A\u77E5";
  const v0Precise = v0Data && v0Data.rating
    ? calculatePreciseRatingFromCounts(v0Data.rating.count, v0Data.rating.total)
    : null;
  const v0PosterLarge = v0Data && v0Data.images ? String(v0Data.images.large || v0Data.images.common || v0Data.images.medium || "").trim() : "";
  const v0PosterCommon = v0Data && v0Data.images ? String(v0Data.images.common || v0Data.images.medium || "").trim() : "";
  const v0Eps = v0Data ? String(Number(v0Data.eps || v0Data.total_episodes || 0) || readInfoboxValueFromV0(v0Data.infobox, ["\u8BDD\u6570"], "0").replace(/[^\d]/g, "") || "0") : "0";
  const v0Director = v0Data ? readInfoboxValueFromV0(v0Data.infobox, ["\u5BFC\u6F14", "\u603B\u5BFC\u6F14"]) : "\u672A\u77E5";
  const v0Maker = v0Data ? readInfoboxValueFromV0(v0Data.infobox, ["\u52A8\u753B\u5236\u4F5C", "\u88FD\u4F5C", "\u5236\u4F5C"]) : "\u672A\u77E5";
  const v0Music = v0Data ? readInfoboxValueFromV0(v0Data.infobox, ["\u97F3\u4E50", "\u97F3\u4E50\u5236\u4F5C"]) : "\u672A\u77E5";
  const v0Date = v0Data
    ? (cleanText(v0Data.date || "") || readInfoboxValueFromV0(v0Data.infobox, ["\u653E\u9001\u5F00\u59CB", "\u53D1\u552E\u65E5", "\u4E0A\u6620\u5E74\u5EA6"]))
    : "\u672A\u77E5";

  const v0RawTags = [];
  if (v0Data && Array.isArray(v0Data.tags)) {
    for (const t of v0Data.tags) {
      if (t && t.name) v0RawTags.push({ name: t.name, count: Number(t.count) || 0 });
    }
  }
  if (v0Data && Array.isArray(v0Data.meta_tags)) {
    for (const mt of v0Data.meta_tags) {
      if (mt) v0RawTags.push({ name: String(mt), count: 50 });
    }
  }
  const v0Tags = cleanSubjectGenreTags(v0RawTags, 10);
  const v0Catego = v0Data
    ? detectAdaptationFromTagsAndInfobox(v0RawTags.map((x) => x.name), v0Data.infobox)
    : "\u5176\u5B83";

  const pickValid = (primary, secondary, def = "\u672A\u77E5") => {
    if (primary && primary !== "\u672A\u77E5" && primary !== "0") return primary;
    if (secondary && secondary !== "\u672A\u77E5" && secondary !== "0") return secondary;
    return primary || secondary || def;
  };

  const finalCn = (htmlInfo && htmlInfo.cn) || v0Cn || (htmlInfo && htmlInfo.jp) || v0Jp || "\u672A\u77E5\u4F5C\u54C1";
  const finalJp = (htmlInfo && htmlInfo.jp) || v0Jp || "\u672A\u77E5";
  const finalPoster = v0PosterLarge || (htmlInfo && htmlInfo.poster) || "";
  const finalPosterFallback = (htmlInfo && htmlInfo.poster && htmlInfo.poster !== finalPoster)
    ? htmlInfo.poster
    : v0PosterCommon;

  return {
    url,
    subjectId,
    CN: finalCn,
    JP: finalJp,
    fileName: finalCn,
    type: (htmlInfo && htmlInfo.type) || v0Type,
    rating: pickValid(htmlInfo && htmlInfo.rating, v0Score, "\u672A\u77E5"),
    preciseRating: (htmlInfo && htmlInfo.preciseRating != null) ? htmlInfo.preciseRating : v0Precise,
    Poster: finalPoster,
    PosterFallback: finalPosterFallback,
    episode: pickValid(htmlInfo && htmlInfo.episode, v0Eps, "0"),
    director: pickValid(htmlInfo && htmlInfo.director, v0Director, "\u672A\u77E5"),
    AnimeMake: pickValid(htmlInfo && htmlInfo.maker, v0Maker, "\u672A\u77E5"),
    music: pickValid(htmlInfo && htmlInfo.music, v0Music, "\u672A\u77E5"),
    date: pickValid(htmlInfo && htmlInfo.date, v0Date, "\u672A\u77E5"),
    catego: (htmlInfo && htmlInfo.catego && htmlInfo.catego !== "\u5176\u5B83") ? htmlInfo.catego : v0Catego,
    tags: (htmlInfo && Array.isArray(htmlInfo.tags) && htmlInfo.tags.length > 0) ? htmlInfo.tags : v0Tags,
    netaba: getNetabaUrl(url)
  };
}

async function getUserRatingForSubject(
  userId,
  subjectId
) {
  const paths = [
    "collect",
    "do",
    "wish",
    "dropped"
  ];

  for (const listPath of paths) {
    let page = 1;

    while (page <= 100) {
      const url =
        "https://bgm.tv/anime/list/" +
        userId +
        "/" +
        listPath +
        (page === 1
          ? ""
          : "?page=" + page);

      const html = await requestHtml(url);
      const doc = parseHtml(html);
      const entries = doc.querySelectorAll(
        "ul#browserItemList > li.item"
      );

      if (!entries.length) {
        break;
      }

      for (const entry of entries) {
        const titleLink = entry.querySelector(
          "h3 > a.l"
        );

        if (!titleLink) {
          continue;
        }

        const href = titleLink.getAttribute(
          "href"
        );

        if (
          getSubjectId(href) !==
          String(subjectId)
        ) {
          continue;
        }

        const ratingElement =
          entry.querySelector(
            "span.starlight"
          );

        const ratingClass = ratingElement
          ? String(
              ratingElement.className || ""
            )
          : "";

        const ratingMatch =
          ratingClass.match(
            /(?:^|\s)stars(\d+)(?:\s|$)/
          );

        return ratingMatch
          ? Number(ratingMatch[1])
          : null;
      }

      const pagination = doc.querySelector(
        "div#multipage"
      );

      const hasNextPage =
        pagination &&
        [...pagination.querySelectorAll("a.p")]
          .some((link) => {
            const href =
              link.getAttribute("href") || "";
            const match =
              href.match(/page=(\d+)/);

            return (
              match &&
              Number(match[1]) > page
            );
          });

      if (!hasNextPage) {
        break;
      }

      page += 1;
    }
  }

  return null;
}
async function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRatingFromEntry(entry) {
  const ratingElement = entry.querySelector(
    "span.starlight"
  );

  const ratingClass = ratingElement
    ? String(ratingElement.className || "")
    : "";

  const ratingMatch = ratingClass.match(
    /(?:^|\s)stars(\d+)(?:\s|$)/
  );

  return ratingMatch
    ? Number(ratingMatch[1])
    : null;
}

async function getUserRatingsForSubjects(
  userId,
  subjectIds,
  options = {}
) {
  const pageIntervalMs = Math.min(
    500,
    Math.max(
      350,
      Number(options.pageIntervalMs) || 400
    )
  );

  const shouldStop =
    typeof options.shouldStop === "function"
      ? options.shouldStop
      : () => false;

  const waitIfPaused =
    typeof options.waitIfPaused === "function"
      ? options.waitIfPaused
      : async () => {};

  const onProgress =
    typeof options.onProgress === "function"
      ? options.onProgress
      : () => {};

  const targetIds = new Set(
    (subjectIds || []).map((value) => {
      return String(value);
    })
  );

  const ratings = new Map();

  if (!targetIds.size || !/^\d+$/.test(
    String(userId || "")
  )) {
    return ratings;
  }

  const paths = [
    "collect",
    "do",
    "wish",
    "dropped"
  ];

  for (const listPath of paths) {
    await waitIfPaused();

    if (shouldStop()) {
      return ratings;
    }

    let page = 1;

    while (page <= 100) {
      await waitIfPaused();

      if (shouldStop()) {
        return ratings;
      }

      const url =
        "https://bgm.tv/anime/list/" +
        userId +
        "/" +
        listPath +
        (page === 1
          ? ""
          : "?page=" + page);

      const html = await requestHtml(url);
      const doc = parseHtml(html);
      const entries = doc.querySelectorAll(
        "ul#browserItemList > li.item"
      );

      if (!entries.length) {
        break;
      }

      for (const entry of entries) {
        const titleLink = entry.querySelector(
          "h3 > a.l"
        );

        const subjectId = getSubjectId(
          titleLink
            ? titleLink.getAttribute("href")
            : ""
        );

        if (
          !subjectId ||
          !targetIds.has(subjectId)
        ) {
          continue;
        }

        ratings.set(
          subjectId,
          getRatingFromEntry(entry)
        );
      }

      onProgress({
        path: listPath,
        page,
        found: ratings.size,
        total: targetIds.size
      });

      if (ratings.size >= targetIds.size) {
        return ratings;
      }

      const pagination = doc.querySelector(
        "div#multipage"
      );

      const hasNextPage =
        pagination &&
        [...pagination.querySelectorAll("a.p")]
          .some((link) => {
            const href =
              link.getAttribute("href") || "";

            const match = href.match(
              /page=(\d+)/
            );

            return match &&
              Number(match[1]) > page;
          });

      if (!hasNextPage) {
        break;
      }

      page += 1;
      await delay(pageIntervalMs);
    }
  }

  return ratings;
}

async function getPublicRatingForSubject(subjectId) {
  const id = String(subjectId || "").trim();

  if (!/^\d+$/.test(id)) {
    return null;
  }

  const v0 = await fetchBgmV0SubjectJson(id, 5500);
  if (v0 && v0.rating && Number.isFinite(Number(v0.rating.score)) && Number(v0.rating.score) > 0) {
    return Number(v0.rating.score);
  }

  const html = await requestHtml(
    "https://bgm.tv/subject/" + id
  );

  if (!html) {
    return null;
  }

  const doc = parseHtml(html);

  const value = cleanText(
    doc.querySelector(
      "span[property='v:average']"
    )?.textContent
  );

  const score = Number(value);

  return Number.isFinite(score)
    ? score
    : null;
}

async function getPublicRatingsForSubjects(
  subjectIds,
  delayMs
) {
  const ratings = new Map();
  const uniqueIds = [
    ...new Set(
      (subjectIds || []).map((value) => {
        return String(value);
      })
    )
  ].filter((value) => /^\d+$/.test(value));

  for (
    let index = 0;
    index < uniqueIds.length;
    index += 1
  ) {
    const subjectId = uniqueIds[index];

    try {
      const score =
        await getPublicRatingForSubject(
          subjectId
        );

      if (score !== null) {
        ratings.set(subjectId, score);
      }
    } catch (error) {
      console.error(
        "读取 BGM 公共评分失败:",
        subjectId,
        error
      );
    }

    if (index < uniqueIds.length - 1) {
      await delay(
        Math.max(
          200,
          Number(delayMs) || 450
        )
      );
    }
  }

  return ratings;
}

async function getPreciseRatingForSubject(subjectId) {
  const id = String(subjectId || "").trim();

  if (!/^\d+$/.test(id)) {
    return null;
  }

  const v0 = await fetchBgmV0SubjectJson(id, 5500);
  if (v0 && v0.rating) {
    const precise = calculatePreciseRatingFromCounts(v0.rating.count, v0.rating.total);
    if (precise !== null) return precise;
  }

  const html = await requestHtml(
    "https://bgm.tv/subject/" + id
  );

  if (!html) {
    return null;
  }

  const doc = parseHtml(html);

  return calculatePreciseRating(doc);
}

async function getPreciseRatingsForSubjects(
  subjectIds,
  delayMs
) {
  const ratings = new Map();

  const uniqueIds = [
    ...new Set(
      (subjectIds || []).map((value) => {
        return String(value);
      })
    )
  ].filter((value) => /^\d+$/.test(value));

  for (
    let index = 0;
    index < uniqueIds.length;
    index += 1
  ) {
    const subjectId = uniqueIds[index];

    try {
      const score =
        await getPreciseRatingForSubject(
          subjectId
        );

      if (score !== null) {
        ratings.set(subjectId, score);
      }
    } catch (error) {
      console.error(
        "读取 BGM 精确评分失败:",
        subjectId,
        error
      );
    }

    if (index < uniqueIds.length - 1) {
      await delay(
        Math.max(
          200,
          Number(delayMs) || 450
        )
      );
    }
  }

  return ratings;
}
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  return Math.min(
    max,
    Math.max(
      min,
      Number.isFinite(parsed)
        ? parsed
        : fallback
    )
  );
}

function readPublicScoreFromDoc(doc) {
  const value = cleanText(
    doc.querySelector(
      "span[property='v:average']"
    )?.textContent
  );

  const score = Number(value);

  return Number.isFinite(score) &&
    score > 0 &&
    score <= 10
    ? score
    : null;
}

function readVotesFromDoc(doc) {
  const value = cleanText(
    doc.querySelector(
      "span[property='v:votes']"
    )?.textContent
  );

  const votes = Number(
    value.replace(/[^\d]/g, "")
  );

  return Number.isFinite(votes) && votes >= 0
    ? votes
    : null;
}

function createLaunchGate(intervalMs) {
  let queue = Promise.resolve();
  let nextLaunchAt = 0;

  return async () => {
    const scheduled = queue.then(async () => {
      const waitMs = Math.max(
        0,
        nextLaunchAt - Date.now()
      );

      if (waitMs > 0) {
        await delay(waitMs);
      }

      const launchedAt = Date.now();
      nextLaunchAt = launchedAt + intervalMs;

      return launchedAt;
    });

    queue = scheduled.catch(() => {});
    return await scheduled;
  };
}

async function requestHtmlWithTimeout(url, timeoutMs) {
  let timeoutId = null;
  const requestPromise = requestHtml(url);

  // A requestUrl call cannot be reliably aborted. Keep its rejection handled
  // after the logical timeout so a late failure never becomes unhandled.
  requestPromise.catch(() => {});

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        timedOut: true,
        html: ""
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      requestPromise.then((html) => {
        return {
          timedOut: false,
          html: html || ""
        };
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function getScoreDetailsForSubjects(
  subjectIds,
  options = {}
) {
  const uniqueIds = [
    ...new Set(
      (subjectIds || []).map((value) => {
        return String(value);
      })
    )
  ].filter((value) => /^\d+$/.test(value));

  const concurrency = clampNumber(
    options.concurrency,
    1,
    4,
    3
  );

  const intervalMs = clampNumber(
    options.intervalMs,
    200,
    1000,
    300
  );

  const timeoutMs = clampNumber(
    options.timeoutMs,
    3000,
    60000,
    15000
  );

  const retryCount = clampNumber(
    options.retryCount,
    0,
    2,
    2
  );

  const needPrecise =
    options.needPrecise === true;

  const shouldStop =
    typeof options.shouldStop === "function"
      ? options.shouldStop
      : () => false;

  const waitIfPaused =
    typeof options.waitIfPaused === "function"
      ? options.waitIfPaused
      : async () => {};

  const onProgress =
    typeof options.onProgress === "function"
      ? options.onProgress
      : () => {};

  const launch = createLaunchGate(intervalMs);
  const results = new Map();
  const stats = {
    requested: uniqueIds.length,
    launched: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    retried: 0,
    stopped: false,
    maxConcurrent: 0,
    minLaunchGapMs: null
  };

  let nextIndex = 0;
  let activeRequests = 0;
  let lastLaunchAt = 0;

  async function fetchOne(subjectId) {
    const record = {
      subjectId,
      publicScore: null,
      preciseScore: null,
      votes: null,
      noData: false,
      error: "",
      timedOut: false,
      attempts: 0
    };

    for (
      let attempt = 0;
      attempt <= retryCount;
      attempt += 1
    ) {
      await waitIfPaused();

      if (shouldStop()) {
        stats.stopped = true;
        record.error = "已停止";
        return record;
      }

      if (attempt > 0) {
        stats.retried += 1;
        await delay(attempt === 1 ? 1000 : 2000);

        await waitIfPaused();

        if (shouldStop()) {
          stats.stopped = true;
          record.error = "已停止";
          return record;
        }
      }

      const launchedAt = await launch();

      await waitIfPaused();

      if (shouldStop()) {
        stats.stopped = true;
        record.error = "已停止";
        return record;
      }

      if (lastLaunchAt > 0) {
        const gap = launchedAt - lastLaunchAt;

        stats.minLaunchGapMs =
          stats.minLaunchGapMs === null
            ? gap
            : Math.min(stats.minLaunchGapMs, gap);
      }

      lastLaunchAt = launchedAt;
      activeRequests += 1;
      stats.launched += 1;
      stats.maxConcurrent = Math.max(
        stats.maxConcurrent,
        activeRequests
      );

      onProgress({
        type: "launched",
        subjectId,
        attempt: attempt + 1,
        stats: Object.assign({}, stats)
      });

      let response;

      try {
        response = await requestHtmlWithTimeout(
          "https://bgm.tv/subject/" + subjectId,
          timeoutMs
        );
      } catch (error) {
        response = {
          timedOut: false,
          html: "",
          error: error && error.message
            ? error.message
            : String(error)
        };
      } finally {
        activeRequests = Math.max(
          0,
          activeRequests - 1
        );
      }

      record.attempts = attempt + 1;

      if (response.timedOut) {
        stats.timedOut += 1;
        record.timedOut = true;
        record.error =
          "请求超时（" + timeoutMs + " ms）";
      } else if (response.error) {
        record.error = response.error;
      } else if (!response.html) {
        record.error = "没有返回页面内容";
      } else {
        const doc = parseHtml(response.html);

        record.publicScore =
          readPublicScoreFromDoc(doc);

        record.votes = readVotesFromDoc(doc);

        record.preciseScore = needPrecise
          ? calculatePreciseRating(doc)
          : null;

        record.noData =
          record.publicScore === null &&
          record.votes === null &&
          (!needPrecise ||
            record.preciseScore === null);

        record.error = "";
        return record;
      }

      if (attempt === retryCount) {
        stats.failed += 1;
      }
    }

    return record;
  }

  async function worker() {
    while (true) {
      await waitIfPaused();

      if (shouldStop()) {
        stats.stopped = true;
        return;
      }

      const index = nextIndex;
      nextIndex += 1;

      if (index >= uniqueIds.length) {
        return;
      }

      const subjectId = uniqueIds[index];
      const record = await fetchOne(subjectId);

      results.set(subjectId, record);
      stats.completed += 1;

      onProgress({
        type: "completed",
        subjectId,
        record,
        stats: Object.assign({}, stats)
      });
    }
  }

  const workers = [];

  for (
    let index = 0;
    index < Math.min(concurrency, uniqueIds.length);
    index += 1
  ) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return {
    results,
    stats
  };
}
async function getSubjectTags(subjectId) {
  const cleanId = String(subjectId || "").trim();
  if (!cleanId) {
    return { tags: [], date: "" };
  }
  try {
    const resp = await requestUrl({
      url: "https://api.bgm.tv/v0/subjects/" + encodeURIComponent(cleanId),
      method: "GET",
      headers: {
        "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)",
        "Accept": "application/json"
      },
      throw: false
    });
    if (resp && resp.status >= 200 && resp.status < 300) {
      const data = resp.json || (resp.text ? JSON.parse(resp.text) : null);
      if (data && typeof data === "object") {
        const rawList = [];
        if (Array.isArray(data.tags)) {
          for (const t of data.tags) {
            if (t && t.name) {
              rawList.push({ name: t.name, count: Number(t.count) || 0 });
            }
          }
        }
        if (Array.isArray(data.meta_tags)) {
          for (const mt of data.meta_tags) {
            if (mt) {
              rawList.push({ name: String(mt), count: 50 });
            }
          }
        }
        const cleaned = cleanSubjectGenreTags(rawList, 10);
        if (cleaned.length > 0 || data.date) {
          return {
            tags: cleaned,
            date: String(data.date || "").trim()
          };
        }
      }
    }
  } catch (_) {}

  try {
    const html = await requestHtml("https://bgm.tv/subject/" + encodeURIComponent(cleanId));
    if (html) {
      const doc = parseHtml(html);
      const cleaned = extractSubjectGenreTagsFromDoc(doc, 10);
      const infobox = [...doc.querySelectorAll("#infobox > li")].map((item) => item.innerText).join("\n");
      const date = extractField(
        infobox,
        [/放送开始:\s*([^\n]+)/, /放送开始：\s*([^\n]+)/, /发售日:\s*([^\n]+)/, /上映年度:\s*([^\n]+)/],
        ""
      );
      return { tags: cleaned, date };
    }
  } catch (_) {}

  return { tags: [], date: "" };
}

async function getSubjectTagsBatch(subjectIds, options = {}) {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(subjectIds) ? subjectIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  const concurrency = Math.max(1, Math.min(6, Number(options.concurrency) || 4));
  const delayMs = Math.max(0, Number(options.delayMs) || 140);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : () => false;

  const results = new Map();
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      if (shouldCancel()) return;
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= uniqueIds.length) return;
      const sid = uniqueIds[idx];
      const res = await getSubjectTags(sid);
      results.set(sid, res);
      completed += 1;
      onProgress({
        subjectId: sid,
        result: res,
        completed,
        total: uniqueIds.length
      });
      if (delayMs > 0 && nextIndex < uniqueIds.length) {
        await delay(delayMs);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, uniqueIds.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

module.exports = {
  requestHtml,
  parseHtml,
  searchBangumi,
  getAnimeDetail,
  getUserRatingForSubject,
  getUserRatingsForSubjects,
  getPublicRatingForSubject,
  getPublicRatingsForSubjects,
  getPreciseRatingForSubject,
  getPreciseRatingsForSubjects,
  getScoreDetailsForSubjects,
  getSubjectId,
  getNetabaUrl,
  cleanText,
  cleanFileName,
  cleanSubjectGenreTags,
  extractSubjectGenreTagsFromDoc,
  getSubjectTags,
  getSubjectTagsBatch
};
