const { requestUrl } = require("obsidian");

var HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/html;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
};
async function requestHtml(url) {
  const response = await requestUrl({
    url,
    method: "GET",
    cache: "no-cache",
    headers: HEADERS
  });

  return response.text || "";
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
  const searchUrl = "https://bgm.tv/subject_search/" + encodeURIComponent(
    String(keyword || "").trim()
  ) + "?cat=2";
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
function detectAdaptationType(doc) {
  const allTags = [];
  const tagSection = doc.querySelector(
    "h2.subtitle"
  );
  if (tagSection && tagSection.textContent.includes(
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
  const html = await requestHtml(url);
  if (!html) {
    return null;
  }
  const doc = parseHtml(html);
  const header = doc.querySelector(
    "#headerSubject"
  );
  if (header && header.getAttribute("typeof") !== "v:Movie") {
    return null;
  }
  const keywords = doc.querySelector(
    "meta[name='keywords']"
  );
  const keywordText = keywords ? keywords.getAttribute("content") || "" : "";
  const keywordParts = keywordText.split(",");
  const cn = cleanFileName(
    keywordParts[0] || ""
  );
  const jp = cleanFileName(
    keywordParts[1] || ""
  );
  const type = cleanText(
    doc.querySelector(
      "small.grey"
    )?.textContent
  );
  const rating = cleanText(
    doc.querySelector(
      "span[property='v:average']"
    )?.textContent
  ) || "\u672A\u77E5";
  let poster = doc.querySelector(
    "div[align='center'] > a"
  )?.href || "";
  poster = String(poster).replace("app://", "http://").trim();
  if (!poster.startsWith("http")) {
    poster = "";
  }
  const infobox = [...doc.querySelectorAll(
    "#infobox > li"
  )].map(
    (item) => item.innerText
  ).join("\n");
  const episode = extractField(
    infobox,
    [
      /话数:\s*(\d+)/,
      /话数：\s*(\d+)/
    ],
    "0"
  );
  const director = extractField(
    infobox,
    [
      /导演:\s*([^\n]+)/,
      /导演：\s*([^\n]+)/
    ]
  );
  const maker = extractField(
    infobox,
    [
      /动画制作:\s*([^\n]+)/,
      /动画制作：\s*([^\n]+)/
    ]
  );
  const music = extractField(
    infobox,
    [
      /音乐:\s*([^\n]+)/,
      /音乐：\s*([^\n]+)/
    ]
  );
  let datePattern;
  if (type === "OVA") {
    datePattern = [
      /发售日:\s*([^\n]+)/,
      /发售日：\s*([^\n]+)/
    ];
  } else if (type === "\u5267\u573A\u7248") {
    datePattern = [
      /上映年度:\s*([^\n]+)/,
      /上映年度：\s*([^\n]+)/
    ];
  } else {
    datePattern = [
      /放送开始:\s*([^\n]+)/,
      /放送开始：\s*([^\n]+)/
    ];
  }
  const date = extractField(
    infobox,
    datePattern
  );

  return {
    url,
    subjectId: getSubjectId(url),
    CN: cn || jp || "\u672A\u77E5\u4F5C\u54C1",
    JP: jp || "\u672A\u77E5",
    fileName: cn || jp || "\u672A\u77E5\u4F5C\u54C1",
    type,
    rating,
    preciseRating: calculatePreciseRating(doc),
    Poster: poster,
    episode,
    director,
    AnimeMake: maker,
    music,
    date,
    catego: detectAdaptationType(doc),
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
  cleanFileName
};
