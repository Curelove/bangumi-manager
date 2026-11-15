const { requestUrl } = require("obsidian");

const GAME_DATA_SOURCES = [
  { id: "mixed", label: "聚合多源", shortLabel: "多源" },
  { id: "bangumi", label: "Bangumi", shortLabel: "BGM" },
  { id: "vndb", label: "VNDB", shortLabel: "VNDB" },
  { id: "steam", label: "Steam", shortLabel: "Steam" },
  { id: "ymgal", label: "月幕 Galgame", shortLabel: "月幕" }
];

let ymgalTokenCache = {
  token: "",
  expiresAt: 0
};

function cleanStr(val) {
  return String(val || "").replace(/\s+/g, " ").trim();
}

function stripHtmlTags(raw) {
  return String(raw || "")
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[\/?(?:b|i|u|s|quote|spoiler|code|raw)\]/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeMatchTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\s\-_~～:：·・!！?？《》〈〉「」『』【】()（）\[\]]+/g, "");
}

function withTimeout(promise, ms = 5500, label = "timeout") {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function requestJsonSafe(options, timeoutMs = 5500) {
  const resp = await withTimeout(
    requestUrl(Object.assign({ throw: false }, options)),
    timeoutMs,
    "request_timeout"
  );
  if (!resp || resp.status < 200 || resp.status >= 300) {
    throw new Error(`HTTP_${resp ? resp.status : 0}`);
  }
  if (resp.json && typeof resp.json === "object") {
    return resp.json;
  }
  return resp.text ? JSON.parse(resp.text) : null;
}

function extractDeveloperFromBgmInfobox(infobox) {
  if (!Array.isArray(infobox)) return "";
  const devKeys = ["开发", "开发商", "制作", "游戏开发商", "Developer", "发行", "品牌"];
  for (const key of devKeys) {
    const row = infobox.find((r) => r && cleanStr(r.key) === key);
    if (!row || !row.value) continue;
    if (typeof row.value === "string") return cleanStr(row.value);
    if (Array.isArray(row.value)) {
      const vals = row.value.map((v) => cleanStr(v && (v.v || v.k || v))).filter(Boolean);
      if (vals.length) return vals.join(" / ");
    }
  }
  return "";
}

function extractPlatformsFromBgmInfobox(infobox) {
  if (!Array.isArray(infobox)) return "";
  const row = infobox.find((r) => r && /^(?:平台|Platform)$/i.test(cleanStr(r.key)));
  if (!row || !row.value) return "";
  if (typeof row.value === "string") return cleanStr(row.value);
  if (Array.isArray(row.value)) {
    return row.value.map((v) => cleanStr(v && (v.v || v))).filter(Boolean).join(" / ");
  }
  return "";
}

async function searchBangumiGameSource(keyword) {
  const kw = cleanStr(keyword);
  if (!kw) return [];
  try {
    const data = await requestJsonSafe(
      {
        url: "https://api.bgm.tv/v0/search/subjects?limit=14",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)"
        },
        body: JSON.stringify({
          keyword: kw,
          filter: { type: [4] }
        })
      },
      5500
    );
    const list = Array.isArray(data && data.data) ? data.data : [];
    if (list.length > 0) {
      return list.map((item) => {
        const sid = String(item.id || "");
        const cover =
          (item.images && (item.images.large || item.images.common || item.images.medium)) || "";
        const tags = Array.isArray(item.tags)
          ? item.tags.slice(0, 8).map((t) => cleanStr(t && t.name)).filter(Boolean)
          : [];
        const scoreNum = item.rating && Number.isFinite(Number(item.rating.score)) && Number(item.rating.score) > 0
          ? Number(item.rating.score).toFixed(1)
          : "";
        return {
          id: `bgm:${sid}`,
          source: "bangumi",
          sourceLabel: "Bangumi",
          subjectId: sid,
          title: cleanStr(item.name_cn || item.name),
          originalTitle: cleanStr(item.name),
          coverUrl: String(cover).replace(/^http:\/\//i, "https://"),
          score: scoreNum,
          releaseDate: cleanStr(item.date),
          developer: extractDeveloperFromBgmInfobox(item.infobox),
          platformHint: extractPlatformsFromBgmInfobox(item.infobox),
          tags,
          summary: stripHtmlTags(item.summary || "").slice(0, 260),
          sourceUrl: sid ? `https://bgm.tv/subject/${sid}` : ""
        };
      });
    }
  } catch (_) {}

  // Fallback to bgm.tv HTML search (?cat=4) when api.bgm.tv is unreachable without proxy
  const htmlResp = await withTimeout(
    requestUrl({
      url: `https://bgm.tv/subject_search/${encodeURIComponent(kw)}?cat=4`,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Accept": "text/html"
      },
      throw: false
    }),
    5500,
    "bgm_html_timeout"
  );
  if (!htmlResp || !htmlResp.text) return [];
  const doc = new DOMParser().parseFromString(htmlResp.text, "text/html");
  const out = [];
  for (const li of doc.querySelectorAll("#browserItemList > li.item")) {
    const link = li.querySelector("h3 > a.l");
    if (!link) continue;
    const href = String(link.getAttribute("href") || "");
    const sidMatch = href.match(/\/subject\/(\d+)/);
    const sid = sidMatch ? sidMatch[1] : "";
    const title = cleanStr(link.textContent);
    const smallGrey = cleanStr(li.querySelector("h3 > small.grey")?.textContent || "");
    const infoTip = cleanStr(li.querySelector("p.info.tip")?.textContent || "");
    const score = cleanStr(li.querySelector("small.fade")?.textContent || "");
    let imgSrc = String(li.querySelector("img.cover")?.getAttribute("src") || "");
    if (imgSrc.startsWith("//")) imgSrc = "https:" + imgSrc;
    imgSrc = imgSrc.replace(/\/r\/\d+\//, "/").replace(/\/pic\/cover\/[csgm]\//, "/pic/cover/l/");
    out.push({
      id: `bgm:${sid || title}`,
      source: "bangumi",
      sourceLabel: "Bangumi",
      subjectId: sid,
      title,
      originalTitle: smallGrey || title,
      coverUrl: imgSrc,
      score,
      releaseDate: (infoTip.match(/(\d{4}[-年]\d{1,2}(?:[-月]\d{1,2}日?)?)/) || [])[1] || "",
      developer: infoTip.split("/").slice(1, 3).map(cleanStr).filter(Boolean).join(" / "),
      platformHint: "",
      tags: [],
      summary: infoTip,
      sourceUrl: sid ? `https://bgm.tv/subject/${sid}` : ""
    });
    if (out.length >= 12) break;
  }
  return out;
}

async function searchVndbGameSource(keyword) {
  const kw = cleanStr(keyword);
  if (!kw) return [];
  const data = await requestJsonSafe(
    {
      url: "https://api.vndb.org/kana/vn",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        filters: ["search", "=", kw],
        fields: "id, title, alttitle, titles.title, titles.lang, image.url, rating, released, description, developers.name, developers.original, tags.name, tags.rating",
        results: 12
      })
    },
    5500
  );
  const results = Array.isArray(data && data.results) ? data.results : [];
  return results.map((vn) => {
    const titles = Array.isArray(vn.titles) ? vn.titles : [];
    const zhHans = titles.find((t) => t && t.lang === "zh-Hans" && t.title);
    const zhHant = titles.find((t) => t && t.lang === "zh-Hant" && t.title);
    const jaTitle = titles.find((t) => t && t.lang === "ja" && t.title);
    const bestCn = cleanStr((zhHans && zhHans.title) || (zhHant && zhHant.title) || vn.alttitle || vn.title);
    const orig = cleanStr((jaTitle && jaTitle.title) || vn.alttitle || vn.title);
    const devs = Array.isArray(vn.developers)
      ? vn.developers.map((d) => cleanStr((d && (d.original || d.name)) || "")).filter(Boolean)
      : [];
    const tags = Array.isArray(vn.tags)
      ? vn.tags
          .filter((t) => t && t.name && (Number(t.rating) || 0) >= 1.6)
          .slice(0, 8)
          .map((t) => cleanStr(t.name))
      : [];
    const score = Number.isFinite(Number(vn.rating)) && Number(vn.rating) > 0
      ? (Number(vn.rating) / 10).toFixed(1)
      : "";
    return {
      id: `vndb:${vn.id}`,
      source: "vndb",
      sourceLabel: "VNDB",
      vndbId: String(vn.id || ""),
      subjectId: "",
      title: bestCn || orig,
      originalTitle: orig,
      coverUrl: cleanStr(vn.image && vn.image.url),
      score,
      releaseDate: cleanStr(vn.released),
      developer: devs.join(" / "),
      platformHint: "Galgame",
      tags,
      summary: stripHtmlTags(vn.description || "").slice(0, 260),
      sourceUrl: vn.id ? `https://vndb.org/${vn.id}` : ""
    };
  });
}

async function searchSteamGameSource(keyword) {
  const kw = cleanStr(keyword);
  if (!kw) return [];
  const data = await requestJsonSafe(
    {
      url: `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(kw)}&l=schinese&cc=CN`,
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
      }
    },
    5500
  );
  const items = Array.isArray(data && data.items) ? data.items : [];
  return items.slice(0, 12).map((item) => {
    const appId = String(item.id || "");
    const portraitCover = appId
      ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`
      : "";
    const headerCover = appId
      ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
      : cleanStr(item.tiny_image);
    const metascore = Number(item.metascore);
    const score = Number.isFinite(metascore) && metascore > 0 ? (metascore / 10).toFixed(1) : "";
    return {
      id: `steam:${appId}`,
      source: "steam",
      sourceLabel: "Steam",
      steamAppId: appId,
      subjectId: "",
      title: cleanStr(item.name),
      originalTitle: cleanStr(item.name),
      coverUrl: portraitCover || headerCover || cleanStr(item.tiny_image),
      altLandscapeCoverUrl: headerCover,
      fallbackCoverUrl: headerCover || cleanStr(item.tiny_image),
      score,
      releaseDate: "",
      developer: "",
      platformHint: "Steam",
      tags: ["Steam"],
      summary: appId ? `Steam AppID: ${appId}` : "",
      sourceUrl: appId ? `https://store.steampowered.com/app/${appId}/` : "",
      steamLaunchUri: appId ? `steam://rungameid/${appId}` : ""
    };
  });
}

async function getYmgalAccessToken() {
  if (ymgalTokenCache.token && Date.now() < ymgalTokenCache.expiresAt - 30000) {
    return ymgalTokenCache.token;
  }
  const tokenData = await requestJsonSafe(
    {
      url: "https://www.ymgal.games/oauth/token?grant_type=client_credentials&client_id=ymgal&client_secret=luna0327&scope=public",
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    },
    5000
  );
  const accessToken = cleanStr(tokenData && tokenData.access_token);
  if (!accessToken) {
    throw new Error("ymgal_token_failed");
  }
  const expiresSec = Number(tokenData && tokenData.expires_in) || 3600;
  ymgalTokenCache = {
    token: accessToken,
    expiresAt: Date.now() + expiresSec * 1000
  };
  return accessToken;
}

async function searchYmgalGameSource(keyword) {
  const kw = cleanStr(keyword);
  if (!kw) return [];
  const token = await getYmgalAccessToken();
  const data = await requestJsonSafe(
    {
      url: `https://www.ymgal.games/open/archive/search-game?mode=list&keyword=${encodeURIComponent(kw)}&pageNum=1&pageSize=12`,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "version": "1",
        "Accept": "application/json;charset=utf-8"
      }
    },
    5500
  );
  const pageList = (data && data.data && Array.isArray(data.data.result)) ? data.data.result : [];
  return pageList.map((item) => {
    const gid = String(item.gid || item.id || "");
    const tags = Array.isArray(item.tags)
      ? item.tags.slice(0, 8).map((t) => cleanStr(typeof t === "string" ? t : (t && t.name))).filter(Boolean)
      : [];
    return {
      id: `ymgal:${gid}`,
      source: "ymgal",
      sourceLabel: "月幕",
      ymgalId: gid,
      subjectId: "",
      title: cleanStr(item.chineseName || item.name),
      originalTitle: cleanStr(item.name || item.chineseName),
      coverUrl: cleanStr(item.mainImg).replace(/^http:\/\//i, "https://"),
      score: "",
      releaseDate: cleanStr(item.releaseDate),
      developer: cleanStr(item.orgName || item.developer),
      platformHint: "Galgame",
      tags,
      summary: stripHtmlTags(item.introduction || item.haveChinese ? (item.haveChinese ? "含中文版" : "") : ""),
      sourceUrl: gid ? `https://www.ymgal.games/GA${gid}` : ""
    };
  });
}

async function enrichGameCandidateDetail(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate;
  const copy = Object.assign({}, candidate);
  try {
    if (copy.source === "bangumi" && copy.subjectId && (!copy.developer || !copy.tags || copy.tags.length === 0)) {
      const d = await requestJsonSafe(
        {
          url: `https://api.bgm.tv/v0/subjects/${encodeURIComponent(copy.subjectId)}`,
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "Curelove/bangumi-manager (https://github.com/Curelove/bangumi-manager)"
          }
        },
        5000
      );
      if (d) {
        copy.developer = copy.developer || extractDeveloperFromBgmInfobox(d.infobox);
        copy.releaseDate = copy.releaseDate || cleanStr(d.date);
        if ((!copy.tags || !copy.tags.length) && Array.isArray(d.tags)) {
          copy.tags = d.tags.slice(0, 8).map((t) => cleanStr(t && t.name)).filter(Boolean);
        }
        if (!copy.score && d.rating && d.rating.score) {
          copy.score = Number(d.rating.score).toFixed(1);
        }
      }
    } else if (copy.source === "steam" && copy.steamAppId && !copy.developer) {
      const appId = copy.steamAppId;
      const d = await requestJsonSafe(
        {
          url: `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=schinese`,
          method: "GET",
          headers: { "Accept": "application/json" }
        },
        5000
      );
      const entry = d && d[appId] && d[appId].success ? d[appId].data : null;
      if (entry) {
        if (Array.isArray(entry.developers) && entry.developers.length) {
          copy.developer = entry.developers.map(cleanStr).filter(Boolean).join(" / ");
        }
        if (entry.release_date && entry.release_date.date) {
          copy.releaseDate = cleanStr(entry.release_date.date);
        }
        if (Array.isArray(entry.genres) && entry.genres.length) {
          copy.tags = entry.genres.map((g) => cleanStr(g && g.description)).filter(Boolean);
        }
        if (entry.short_description) {
          copy.summary = stripHtmlTags(entry.short_description).slice(0, 260);
        }
        if (entry.header_image) {
          copy.altLandscapeCoverUrl = cleanStr(entry.header_image);
        }
      }
    } else if (copy.source === "ymgal" && copy.ymgalId && !copy.developer) {
      const token = await getYmgalAccessToken();
      const d = await requestJsonSafe(
        {
          url: `https://www.ymgal.games/open/archive?gid=${encodeURIComponent(copy.ymgalId)}`,
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "version": "1",
            "Accept": "application/json;charset=utf-8"
          }
        },
        5000
      );
      const game = d && d.data && d.data.game ? d.data.game : null;
      if (game) {
        copy.releaseDate = copy.releaseDate || cleanStr(game.releaseDate);
        if (d.data.orgMap && game.developerId && d.data.orgMap[game.developerId]) {
          const org = d.data.orgMap[game.developerId];
          copy.developer = cleanStr(org.chineseName || org.name);
        }
      }
    }
  } catch (_) {}
  return copy;
}

function scoreCandidateRelevance(candidate, normKw) {
  if (!normKw) return 0;
  const normTitle = normalizeMatchTitle(candidate.title);
  const normOrig = normalizeMatchTitle(candidate.originalTitle);
  if (normTitle === normKw || (normOrig && normOrig === normKw)) return 100;
  if (normTitle.startsWith(normKw) || (normOrig && normOrig.startsWith(normKw))) return 75;
  if (normTitle.includes(normKw) || (normOrig && normOrig.includes(normKw))) return 50;
  return 10;
}

async function searchGamesAcrossSources(keyword, sourceId = "mixed") {
  const kw = cleanStr(keyword);
  if (!kw) {
    return { candidates: [], sourceStatuses: [] };
  }
  const normKw = normalizeMatchTitle(kw);
  const normalizedSource = String(sourceId || "mixed").toLowerCase();

  const runners = {
    bangumi: { label: "Bangumi", fn: () => searchBangumiGameSource(kw) },
    vndb: { label: "VNDB", fn: () => searchVndbGameSource(kw) },
    steam: { label: "Steam", fn: () => searchSteamGameSource(kw) },
    ymgal: { label: "月幕", fn: () => searchYmgalGameSource(kw) }
  };

  const targetKeys =
    normalizedSource === "mixed" || !runners[normalizedSource]
      ? ["bangumi", "ymgal", "steam", "vndb"]
      : [normalizedSource];

  const settled = await Promise.allSettled(
    targetKeys.map(async (key) => {
      const list = await runners[key].fn();
      return { key, label: runners[key].label, list: Array.isArray(list) ? list : [] };
    })
  );

  const sourceStatuses = [];
  const merged = [];

  settled.forEach((entry, idx) => {
    const key = targetKeys[idx];
    const label = runners[key].label;
    if (entry.status === "fulfilled") {
      const count = entry.value.list.length;
      sourceStatuses.push({ source: key, label, ok: true, count });
      entry.value.list.forEach((item, orderIdx) => {
        merged.push(
          Object.assign({}, item, {
            _relevance: scoreCandidateRelevance(item, normKw),
            _sourceOrder: idx,
            _itemOrder: orderIdx
          })
        );
      });
    } else {
      sourceStatuses.push({
        source: key,
        label,
        ok: false,
        count: 0,
        error: String((entry.reason && entry.reason.message) || "连接超时")
      });
    }
  });

  merged.sort((a, b) => {
    if (b._relevance !== a._relevance) return b._relevance - a._relevance;
    if (a._itemOrder !== b._itemOrder) return a._itemOrder - b._itemOrder;
    return a._sourceOrder - b._sourceOrder;
  });

  return {
    candidates: merged,
    sourceStatuses
  };
}

module.exports = {
  GAME_DATA_SOURCES,
  searchGamesAcrossSources,
  enrichGameCandidateDetail,
  normalizeMatchTitle
};
