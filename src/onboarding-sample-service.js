/**
 * 新用户「润物细无声」渐进式开馆体验与零污染虚拟样片服务
 * ------------------------------------------------------------------
 * 设计原则：
 *   1. 绝不弹出遮挡视线的全屏强制教程弹窗或机械步骤气泡；
 *   2. 当真实馆藏为 0 部时，提供一张温润清爽的「开馆便签」，给新用户三条最顺手的自然起点：
 *        ① 直接在线搜一部喜欢的动画立即建档
 *        ② 填入 Bangumi 用户名/数字 ID 一键同步历史片单
 *        ③ 一键开启「3 部示例样片预览」（纯内存虚拟数据，绝不写入笔记库，可同时体验 2D 案头与 3D 原画档案室！）
 *   3. 一旦用户收录了哪怕 1 部真实动画，所有空馆引导自动静默退场，老用户 100% 零打扰。
 */

function makeSampleSvgDataUri({ title, jpTitle, year, studio, accent, bgTop, bgBottom, motif }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 840" width="600" height="840">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stop-color="${bgTop}"/>
        <stop offset="100%" stop-color="${bgBottom}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="840" fill="url(#bg)"/>
    <rect x="26" y="26" width="548" height="788" fill="none" stroke="${accent}" stroke-width="2.5" stroke-opacity="0.65"/>
    <rect x="38" y="38" width="524" height="764" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.28"/>
    <circle cx="460" cy="210" r="138" fill="${accent}" fill-opacity="0.18"/>
    <circle cx="460" cy="210" r="96" fill="none" stroke="${accent}" stroke-width="1.6" stroke-opacity="0.55"/>
    <path d="M72 520 L528 520" stroke="${accent}" stroke-width="1.5" stroke-opacity="0.5"/>
    <text x="68" y="102" fill="${accent}" font-family="Georgia, serif" font-size="20" font-weight="700" letter-spacing="4">SAMPLE CEL ARCHIVE · ${year}</text>
    <text x="68" y="290" fill="#ffffff" fill-opacity="0.14" font-family="Georgia, serif" font-size="146" font-weight="900">${motif}</text>
    <text x="68" y="592" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="800">${title}</text>
    <text x="68" y="640" fill="#f3ede2" fill-opacity="0.82" font-family="sans-serif" font-size="22">${jpTitle}</text>
    <text x="68" y="756" fill="${accent}" font-family="monospace" font-size="20" font-weight="700">${studio}  //  PREVIEW ONLY</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildSamplePreviewItems() {
  const rawSamples = [
    {
      subjectId: "400602",
      name: "葬送的芙莉莲",
      originalName: "葬送のフリーレン",
      state: "在看",
      year: 2023,
      releaseDate: "2023-09-29",
      seasonQuarter: "10月新番",
      studio: "MADHOUSE",
      director: "斋藤圭一郎",
      WatchedEpisodes: 24,
      totalEpisodes: 28,
      personalScore: 9.5,
      bangumiScore: 8.59,
      publicScore: 8.6,
      preciseScore: 8.59,
      ratingCount: 48200,
      rank: 26,
      tags: ["奇幻", "冒险", "公路片", "治愈", "MADHOUSE"],
      summary: "打倒魔王后的勇者一行人迎来了和平的岁月。精灵魔法使芙莉莲在昔日同伴欣梅尔逝世后，为了真正“了解人类”而重新踏上追寻灵魂与记忆的旅途。",
      cover: makeSampleSvgDataUri({
        title: "葬送的芙莉莲",
        jpTitle: "葬送のフリーレン",
        year: "2023",
        studio: "MADHOUSE",
        accent: "#d6b26e",
        bgTop: "#243b4a",
        bgBottom: "#142029",
        motif: "01"
      }),
      episodeReviews: [
        {
          ep: 1,
          timecode: "21:14",
          text: "（示例手札）流星雨再临的那一刻，五十年时光的重量突然落了下来，分镜留白太克制了。",
          createdAt: "2026-10-01 21:30"
        },
        {
          ep: 10,
          timecode: "18:42",
          text: "（示例手札）师徒两代人的魔力压制揭示，配乐切入瞬间鸡皮疙瘩起来了！",
          createdAt: "2026-10-08 22:15"
        }
      ],
      trendHistory: [
        { date: "2023-10", score: 8.42, rank: 45, count: 12000 },
        { date: "2023-12", score: 8.54, rank: 31, count: 29000 },
        { date: "2024-03", score: 8.59, rank: 26, count: 48200 }
      ]
    },
    {
      subjectId: "328609",
      name: "孤独摇滚！",
      originalName: "ぼっち・ざ・ろっく！",
      state: "已看",
      year: 2022,
      releaseDate: "2022-10-08",
      seasonQuarter: "10月新番",
      studio: "CloverWorks",
      director: "斋藤圭一郎",
      WatchedEpisodes: 12,
      totalEpisodes: 12,
      personalScore: 9.2,
      bangumiScore: 8.41,
      publicScore: 8.4,
      preciseScore: 8.41,
      ratingCount: 53600,
      rank: 52,
      tags: ["音乐", "乐队", "日常", "青春", "演出神回"],
      summary: "极度社恐却苦练吉他的少女后藤一里，偶遇寻找吉他手的伊地知虹夏，由此加入“结束乐队”，在下北泽的 Livehouse 里奏响笨拙却滚烫的青春之声。",
      cover: makeSampleSvgDataUri({
        title: "孤独摇滚！",
        jpTitle: "ぼっち・ざ・ろっく！",
        year: "2022",
        studio: "CLOVERWORKS",
        accent: "#f08ca8",
        bgTop: "#3d233c",
        bgBottom: "#1c1324",
        motif: "02"
      }),
      episodeReviews: [
        {
          ep: 8,
          timecode: "17:05",
          text: "（示例手札）雨夜演出的即兴前奏直接把整部番的气魂立住了！",
          createdAt: "2026-09-18 23:10"
        }
      ],
      trendHistory: [
        { date: "2022-10", score: 8.05, rank: 140, count: 9500 },
        { date: "2022-12", score: 8.44, rank: 48, count: 44000 },
        { date: "2023-06", score: 8.41, rank: 52, count: 53600 }
      ]
    },
    {
      subjectId: "253",
      name: "星际牛仔",
      originalName: "カウボーイビバップ",
      state: "已看",
      year: 1998,
      releaseDate: "1998-04-03",
      seasonQuarter: "04月新番",
      studio: "SUNRISE",
      director: "渡边信一郎",
      WatchedEpisodes: 26,
      totalEpisodes: 26,
      personalScore: 10.0,
      bangumiScore: 9.11,
      publicScore: 9.1,
      preciseScore: 9.11,
      ratingCount: 38900,
      rank: 1,
      tags: ["科幻", "爵士乐", "太空歌剧", "渡边信一郎", "菅野洋子"],
      summary: "2071 年的太阳系，赏金猎人史派克与杰特驾驶飞船 Bebop 号在星际间漂泊，在布鲁斯与爵士乐的律动中与各自的过去狭路相逢。",
      cover: makeSampleSvgDataUri({
        title: "星际牛仔",
        jpTitle: "COWBOY BEBOP",
        year: "1998",
        studio: "SUNRISE",
        accent: "#e29a4c",
        bgTop: "#3a251d",
        bgBottom: "#171214",
        motif: "03"
      }),
      episodeReviews: [
        {
          ep: 5,
          timecode: "19:50",
          text: "（示例手札）教堂花窗坠落配 Green Bird，赛璐珞时代永恒的巅峰记忆。",
          createdAt: "2026-08-12 20:45"
        }
      ],
      trendHistory: [
        { date: "2016-01", score: 9.09, rank: 2, count: 15000 },
        { date: "2020-01", score: 9.10, rank: 1, count: 27000 },
        { date: "2024-01", score: 9.11, rank: 1, count: 38900 }
      ]
    }
  ];

  return rawSamples.map((s) => ({
    ...s,
    japaneseName: s.originalName || "",
    watchedEpisodes: Number(s.WatchedEpisodes ?? s.watchedEpisodes ?? 0),
    WatchedEpisodes: Number(s.WatchedEpisodes ?? s.watchedEpisodes ?? 0),
    season: s.seasonQuarter || "",
    animeType: "TV 动画",
    reviews: (s.episodeReviews || []).map((rv) => ({
      scope: rv.ep ? `第 ${rv.ep} 话` : "全剧",
      episode: rv.ep || 1,
      timestamp: rv.timecode || "",
      typeLabel: "演出手札",
      text: rv.text || "",
      createdAt: rv.createdAt || ""
    })),
    isSamplePreviewItem: true,
    slotType: "anime",
    file: null,
    filePath: `__sample_preview__/${s.subjectId}.md`,
    coverUrl: s.cover,
    localUpdateStatus: "示例预览条目（收录真实动画后自动退出）",
    localEpisodeCount: 0
  }));
}

function isSamplePreviewActive(plugin) {
  return Boolean(plugin && plugin._samplePreviewModeActive);
}

function setSamplePreviewActive(plugin, active) {
  if (!plugin) return;
  plugin._samplePreviewModeActive = Boolean(active);
}

module.exports = {
  buildSamplePreviewItems,
  isSamplePreviewActive,
  setSamplePreviewActive
};
