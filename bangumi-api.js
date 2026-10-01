const HEADERS = {
    "Content-Type":
        "text/html; charset=utf-8",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91 Safari/537.36",
    "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/html;q=0.8",
    "Accept-Language":
        "zh-CN,zh;q=0.9,en;q=0.8"
};

async function requestHtml(url) {
    const html = await request({
        url,
        method: "GET",
        cache: "no-cache",
        headers: HEADERS
    });

    return html || "";
}

function parseHtml(html) {
    return new DOMParser().parseFromString(
        html || "<html></html>",
        "text/html"
    );
}

function cleanText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanFileName(value) {
    return cleanText(value)
        .replace(/[\*"\\\/<>:\|?]/g, " ")
        .trim();
}

function getSubjectId(url) {
    const match =
        String(url || "").match(
            /\/subject\/(\d+)/i
        );

    return match ? match[1] : "";
}

function getNetabaUrl(url) {
    const subjectId =
        getSubjectId(url);

    return subjectId
        ? "https://netaba.re/subject/" +
          subjectId
        : "";
}

async function searchBangumi(keyword) {
    const searchUrl =
        "https://bgm.tv/subject_search/" +
        encodeURIComponent(
            String(keyword || "").trim()
        ) +
        "?cat=2";

    const html =
        await requestHtml(searchUrl);

    if (!html) {
        return [];
    }

    const doc = parseHtml(html);
    const list =
        doc.querySelector(
            "#browserItemList"
        );

    if (!list) {
        return [];
    }

    const results = [];

    for (
        const item of
        list.querySelectorAll("li.item")
    ) {
        const titleLink =
            item.querySelector("h3 a");

        const typeIcon =
            item.querySelector("h3 span");

        const info =
            item.querySelector(".info.tip");

        if (!titleLink) {
            continue;
        }

        if (
            typeIcon &&
            !String(
                typeIcon.className || ""
            ).includes(
                "subject_type_2"
            )
        ) {
            continue;
        }

        const href =
            titleLink.getAttribute("href");

        if (!href) {
            continue;
        }

        results.push({
            title:
                cleanText(
                    titleLink.textContent
                ),
            description:
                cleanText(
                    info
                        ? info.textContent
                        : ""
                ),
            url:
                href.startsWith("http")
                    ? href
                    : "https://bgm.tv" + href
        });
    }

    return results;
}

function extractField(
    text,
    patterns,
    defaultValue = "未知"
) {
    for (const pattern of patterns) {
        const match =
            String(text || "").match(
                pattern
            );

        if (match && match[1]) {
            return cleanText(match[1])
                .replace(/\n/g, "")
                .replace(/\r/g, "");
        }
    }

    return defaultValue;
}

function detectAdaptationType(
    doc
) {
    const allTags = [];

    const tagSection =
        doc.querySelector(
            "h2.subtitle"
        );

    if (
        tagSection &&
        tagSection.textContent.includes(
            "标注为"
        )
    ) {
        const container =
            tagSection.nextElementSibling;

        if (container) {
            for (
                const tag of
                container.querySelectorAll(
                    "a.l.meta, a.l"
                )
            ) {
                const span =
                    tag.querySelector("span");

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
        "小说改编": [
            "轻小说改",
            "轻改",
            "小说改",
            "小说改编"
        ],
        "漫画改编": [
            "漫画改",
            "漫画改编"
        ],
        "游戏改编": [
            "游戏改",
            "游戏改编"
        ],
        "原创动画": [
            "原创"
        ]
    };

    for (
        const [category, words]
        of Object.entries(keywords)
    ) {
        for (const word of words) {
            if (
                allTags.some((tag) =>
                    tag.includes(word)
                )
            ) {
                return category;
            }
        }
    }

    for (
        const item of
        doc.querySelectorAll(
            "#infobox > li"
        )
    ) {
        const text =
            cleanText(item.textContent);

        if (
            !text.includes("原作") &&
            !text.includes("原案")
        ) {
            continue;
        }

        if (
            text.includes("漫画")
        ) {
            return "漫画改编";
        }

        if (
            text.includes("小说") ||
            text.includes("ノベル") ||
            text.includes("ライトノベル")
        ) {
            return "小说改编";
        }

        if (
            text.includes("游戏") ||
            text.includes("ゲーム")
        ) {
            return "游戏改编";
        }
    }

    return "其它";
}

async function getAnimeDetail(url) {
    const html =
        await requestHtml(url);

    if (!html) {
        return null;
    }

    const doc = parseHtml(html);
    const header =
        doc.querySelector(
            "#headerSubject"
        );

    if (
        header &&
        header.getAttribute("typeof") !==
            "v:Movie"
    ) {
        return null;
    }

    const keywords =
        doc.querySelector(
            "meta[name='keywords']"
        );

    const keywordText =
        keywords
            ? keywords.getAttribute("content") || ""
            : "";

    const keywordParts =
        keywordText.split(",");

    const cn =
        cleanFileName(
            keywordParts[0] || ""
        );

    const jp =
        cleanFileName(
            keywordParts[1] || ""
        );

    const type =
        cleanText(
            doc.querySelector(
                "small.grey"
            )?.textContent
        );

    const rating =
        cleanText(
            doc.querySelector(
                "span[property='v:average']"
            )?.textContent
        ) || "未知";

    let poster =
        doc.querySelector(
            "div[align='center'] > a"
        )?.href || "";

    poster = String(poster)
        .replace("app://", "http://")
        .trim();

    if (!poster.startsWith("http")) {
        poster = "";
    }

    const infobox =
        [...doc.querySelectorAll(
            "#infobox > li"
        )]
            .map((item) =>
                item.innerText
            )
            .join("\n");

    const episode =
        extractField(
            infobox,
            [
                /话数:\s*(\d+)/,
                /话数：\s*(\d+)/
            ],
            "0"
        );

    const director =
        extractField(
            infobox,
            [
                /导演:\s*([^\n]+)/,
                /导演：\s*([^\n]+)/
            ]
        );

    const maker =
        extractField(
            infobox,
            [
                /动画制作:\s*([^\n]+)/,
                /动画制作：\s*([^\n]+)/
            ]
        );

    const music =
        extractField(
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
    } else if (type === "剧场版") {
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

    const date =
        extractField(
            infobox,
            datePattern
        );

    return {
        url,
        subjectId: getSubjectId(url),
        CN: cn || jp || "未知作品",
        JP: jp || "未知",
        fileName: cn || jp || "未知作品",
        type,
        rating,
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

module.exports = {
    requestHtml,
    parseHtml,
    searchBangumi,
    getAnimeDetail,
    getSubjectId,
    getNetabaUrl,
    cleanText,
    cleanFileName
};
