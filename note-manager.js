const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif"
];

function cleanValue(value) {
    return String(value || "")
        .trim();
}

function escapeYamlValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\r?\n/g, " ");
}

function addYamlField(
    lines,
    key,
    value
) {
    const finalValue =
        value === undefined ||
        value === null ||
        value === ""
            ? "未知"
            : value;

    lines.push(
        key +
        ': "' +
        escapeYamlValue(finalValue) +
        '"'
    );
}

function getImageExtension(url) {
    try {
        const pathname =
            new URL(url).pathname;

        const match =
            pathname.match(
                /\.([a-zA-Z0-9]{2,5})$/
            );

        if (match) {
            const extension =
                match[1].toLowerCase();

            if (
                IMAGE_EXTENSIONS.includes(
                    extension
                )
            ) {
                return extension === "jpeg"
                    ? "jpg"
                    : extension;
            }
        }
    } catch (error) {
        console.warn(
            "无法识别封面扩展名:",
            error
        );
    }

    return "jpg";
}

async function ensureVaultFolder(
    app,
    folderPath
) {
    if (!folderPath) {
        return;
    }

    if (
        app.vault.getAbstractFileByPath(
            folderPath
        )
    ) {
        return;
    }

    const parts =
        folderPath.split("/");

    let current = "";

    for (const part of parts) {
        if (!part) {
            continue;
        }

        current = current
            ? current + "/" + part
            : part;

        if (
            app.vault.getAbstractFileByPath(
                current
            )
        ) {
            continue;
        }

        try {
            await app.vault.createFolder(
                current
            );
        } catch (error) {
            if (
                !app.vault
                    .getAbstractFileByPath(
                        current
                    )
            ) {
                throw error;
            }
        }
    }
}

async function saveCoverLocally(
    app,
    coverFolder,
    subjectId,
    remoteUrl
) {
    if (
        !coverFolder ||
        !subjectId ||
        !remoteUrl
    ) {
        return remoteUrl || "";
    }

    await ensureVaultFolder(
        app,
        coverFolder
    );

    const extension =
        getImageExtension(remoteUrl);

    const localPath =
        coverFolder +
        "/bangumi-cover-" +
        subjectId +
        "." +
        extension;

    if (
        await app.vault.adapter.exists(
            localPath
        )
    ) {
        return localPath;
    }

    const response =
        await requestUrl({
            url: remoteUrl,
            method: "GET",
            throw: true
        });

    await app.vault.adapter.writeBinary(
        localPath,
        response.arrayBuffer
    );

    return localPath;
}

function getSeasonInfo(dateText) {
    const value =
        String(dateText || "");

    const match =
        value.match(
            /(\d{4})年(\d{1,2})月/
        );

    if (!match) {
        return {
            year: "",
            season: "未知季度"
        };
    }

    const year = match[1];
    const month =
        Number(match[2]);

    let season;

    if (
        month === 12 ||
        month === 1 ||
        month === 2
    ) {
        season = "01月新番";
    } else if (
        month === 3 ||
        month === 4 ||
        month === 5
    ) {
        season = "04月新番";
    } else if (
        month === 6 ||
        month === 7 ||
        month === 8
    ) {
        season = "07月新番";
    } else {
        season = "10月新番";
    }

    return {
        year:
            month === 12
                ? String(
                    Number(year) + 1
                )
                : year,
        season
    };
}

function getSafeFileName(name) {
    return String(name || "")
        .replace(/[\*"\\\/<>:\|?]/g, " ")
        .trim() || "未知作品";
}

function buildNoteContent(
    info,
    options
) {
    const watchedEpisodes =
        options.watchedEpisodes || "0";

    const watchUrl =
        options.watchUrl || "";

    const personalSummary =
        options.personalSummary || "";

    const downloadPath =
        options.downloadPath || "无";

    const yaml = [];

    yaml.push("---");

    addYamlField(
        yaml,
        "中文名",
        info.CN
    );

    addYamlField(
        yaml,
        "日文名",
        info.JP
    );

    addYamlField(
        yaml,
        "cover",
        info.cover
    );

    addYamlField(
        yaml,
        "改编类型",
        info.catego
    );

    addYamlField(
        yaml,
        "总集数",
        info.episode
    );

    addYamlField(
        yaml,
        "观看状态",
        info.state
    );

    addYamlField(
        yaml,
        "制作公司",
        info.AnimeMake
    );

    addYamlField(
        yaml,
        "监督",
        info.director
    );

    addYamlField(
        yaml,
        "音乐",
        info.music
    );

    addYamlField(
        yaml,
        "开播年份",
        info.year
    );

    addYamlField(
        yaml,
        "开播季度",
        info.season
    );

    addYamlField(
        yaml,
        "记录日期",
        info.recordDate
    );

    addYamlField(
        yaml,
        "BGM链接",
        info.url
    );

    addYamlField(
        yaml,
        "BGM评分",
        info.rating
    );

    addYamlField(
        yaml,
        "下载路径",
        downloadPath
    );

    if (info.netaba) {
        addYamlField(
            yaml,
            "Netaba链接",
            info.netaba
        );
    }

    addYamlField(
        yaml,
        "tags",
        "bangumi"
    );

    yaml.push("---");
    yaml.push("");

    yaml.push(
        "**已观看集数**： " +
        watchedEpisodes
    );

    yaml.push(
        "**观看网址**： " +
        watchUrl
    );

    yaml.push("");
    yaml.push("# 动画信息");

    yaml.push(
        "> [!bookinfo|noicon]+ **" +
        (info.CN || "未知作品") +
        "**"
    );

    yaml.push(
        "> ![[" +
        info.cover +
        "]]"
    );

    yaml.push(">");
    yaml.push(
        "| 项目 | 内容 |"
    );
    yaml.push(
        "|:------|:------------------------------------------|"
    );
    yaml.push(
        "| 中文名 | " +
        (info.CN || "未知") +
        " |"
    );
    yaml.push(
        "| 日文名 | " +
        (info.JP || "未知") +
        " |"
    );
    yaml.push(
        "| 开播日期 | " +
        (info.date || "未知") +
        " |"
    );
    yaml.push(
        "| 改编类型 | " +
        (info.catego || "未知") +
        " |"
    );
    yaml.push(
        "| 动画集数 | " +
        (info.type || "") +
        " 共 " +
        (info.episode || "0") +
        " 话 |"
    );
    yaml.push(
        "| 制作公司 | " +
        (info.AnimeMake || "未知") +
        " |"
    );
    yaml.push(
        "| 制作监督 | " +
        (info.director || "未知") +
        " |"
    );
    yaml.push(
        "| 音乐 | " +
        (info.music || "未知") +
        " |"
    );
    yaml.push(
        "| 观看状态 | " +
        (info.state || "未知") +
        " |"
    );
    yaml.push(
        "| 记录日期 | " +
        info.recordDate +
        " |"
    );
    yaml.push(
        "| BGM 地址 | [" +
        (info.CN || "链接") +
        "](" +
        info.url +
        ") |"
    );
    yaml.push(
        "| BGM 评分 | " +
        (info.rating || "未知") +
        " |"
    );

    if (info.netaba) {
        yaml.push(
            "| Netaba 评分趋势 | [查看变化](" +
            info.netaba +
            ") |"
        );
    }

    if (
        downloadPath &&
        downloadPath !== "无"
    ) {
        yaml.push(
            "| 下载路径 | `" +
            downloadPath +
            "` |"
        );
    }

    yaml.push("");
    yaml.push("---");
    yaml.push("");

    if (info.netaba) {
        yaml.push(
            "<!-- Netaba评分趋势图 -->"
        );
        yaml.push(
            '<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">'
        );
        yaml.push(
            '<iframe src="' +
            info.netaba +
            '" style="width:100%;height:600px;border:0;"></iframe>'
        );
        yaml.push("</div>");
        yaml.push("");
    }

    yaml.push("# 个人总结");
    yaml.push("");

    yaml.push(
        personalSummary ||
        "<!-- 在这里写下您对这部动画的感想和评价 -->"
    );

    yaml.push("");

    return yaml.join("\n");
}

function getNoteFolder(
    rootFolder,
    info
) {
    if (
        info.year &&
        info.season &&
        info.season !== "未知季度"
    ) {
        return (
            rootFolder +
            "/" +
            info.year +
            "/" +
            info.season
        );
    }

    return rootFolder;
}

async function createAnimeNote(
    app,
    settings,
    info,
    options = {}
) {
    const noteFolder =
        getNoteFolder(
            settings.noteRootFolder,
            info
        );

    await ensureVaultFolder(
        app,
        noteFolder
    );

    const fileName =
        getSafeFileName(
            info.fileName ||
            info.CN ||
            info.JP
        );

    const filePath =
        noteFolder +
        "/" +
        fileName +
        ".md";

    if (
        app.vault.getAbstractFileByPath(
            filePath
        )
    ) {
        return {
            created: false,
            filePath
        };
    }

    const content =
        buildNoteContent(
            info,
            options
        );

    const file =
        await app.vault.create(
            filePath,
            content
        );

    return {
        created: true,
        filePath: file.path,
        file
    };
}

module.exports = {
    ensureVaultFolder,
    saveCoverLocally,
    getSeasonInfo,
    getSafeFileName,
    buildNoteContent,
    getNoteFolder,
    createAnimeNote
};
