const Modal =
    globalThis.__BangumiManagerModal;

const Notice =
    globalThis.__BangumiManagerNotice;

if (!Modal || !Notice) {
    throw new Error(
        "主插件没有传入 Modal 或 Notice。"
    );
}

const fs = require("fs");
const path = require("path");

const bangumiApi =
    require(
        path.join(
            __dirname,
            "bangumi-api.js"
        )
    );

const noteManager =
    require(
        path.join(
            __dirname,
            "note-manager.js"
        )
    );

const WATCH_STATES = [
    "已看",
    "在看",
    "想看",
    "抛弃"
];

async function openSingleAnimeImport(
    app,
    plugin
) {
    new SingleAnimeImportModal(
        app,
        plugin
    ).open();
}

class SingleAnimeImportModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.results = [];
        this.selectedInfo = null;
    }

    onOpen() {
        const {
            contentEl
        } = this;

        contentEl.empty();

        this.modalEl.style.width =
            "min(760px, 90vw)";

        this.modalEl.style.maxWidth =
            "90vw";

        this.modalEl.style.maxHeight =
            "90vh";

        this.modalEl.style.overflowY =
            "auto";

        contentEl.style.width =
            "100%";

        contentEl.style.boxSizing =
            "border-box";

        contentEl.createEl(
            "h2",
            {
                text: "导入单个动画"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "输入动画名称，搜索后选择正确的 Bangumi 作品。"
            }
        );

        const hint =
            contentEl.querySelector(
                "p"
            );

        if (hint) {
            hint.style.whiteSpace =
                "normal";

            hint.style.overflowWrap =
                "anywhere";

            hint.style.lineHeight =
                "1.5";
        }

        const keywordInput =
            contentEl.createEl("input");

        keywordInput.type = "text";
        keywordInput.placeholder =
            "例如：古诺希亚";
        keywordInput.style.width =
            "100%";

        const searchButton =
            contentEl.createEl(
                "button",
                {
                    text: "搜索 Bangumi"
                }
            );

        searchButton.style.marginTop =
            "10px";

        const resultList =
            contentEl.createDiv();

        resultList.style.maxHeight =
            "42vh";

        resultList.style.overflowY =
            "auto";

        resultList.style.overflowX =
            "hidden";

        resultList.style.marginTop =
            "12px";

        resultList.style.paddingRight =
            "4px";

        resultList.style.boxSizing =
            "border-box";

        const detailArea =
            contentEl.createDiv();

        detailArea.style.marginTop =
            "14px";

        const search = async () => {
            const keyword =
                keywordInput.value.trim();

            if (!keyword) {
                new Notice(
                    "请先输入动画名称。",
                    5000
                );
                return;
            }

            searchButton.disabled =
                true;

            searchButton.textContent =
                "正在搜索……";

            resultList.empty();
            detailArea.empty();

            try {
                this.results =
                    await bangumiApi.searchBangumi(
                        keyword
                    );

                if (
                    this.results.length === 0
                ) {
                    resultList.createEl(
                        "p",
                        {
                            text:
                                "没有找到动画结果。"
                        }
                    );
                    return;
                }

                for (
                    const result of
                    this.results
                ) {
                    const button =
                        resultList.createEl(
                            "button"
                        );

                    button.style.display =
                        "block";

                    button.style.width =
                        "100%";

                    button.style.height =
                        "auto";

                    button.style.minHeight =
                        "38px";

                    button.style.boxSizing =
                        "border-box";

                    button.style.padding =
                        "8px 12px";

                    button.style.textAlign =
                        "left";

                    button.style.margin =
                        "6px 0";

                    button.style.whiteSpace =
                        "normal";

                    button.style.overflow =
                        "visible";

                    button.style.overflowWrap =
                        "anywhere";

                    button.style.wordBreak =
                        "break-word";

                    button.style.lineHeight =
                        "1.45";

                    button.textContent =
                        result.title +
                        (
                            result.description
                                ? "  " +
                                  result.description
                                : ""
                        );

                    button.onclick =
                        async () => {
                            await this.selectResult(
                                result,
                                detailArea
                            );
                        };
                }
            } catch (error) {
                console.error(
                    "Bangumi 搜索失败:",
                    error
                );

                resultList.createEl(
                    "p",
                    {
                        text:
                            "搜索失败，请检查网络连接或 Bangumi 访问状态。"
                    }
                );
            } finally {
                searchButton.disabled =
                    false;

                searchButton.textContent =
                    "搜索 Bangumi";
            }
        };

        searchButton.onclick =
            search;

        keywordInput.onkeydown =
            (event) => {
                if (
                    event.key === "Enter"
                ) {
                    search();
                }
            };
    }

    async selectResult(
        result,
        detailArea
    ) {
        detailArea.empty();

        detailArea.createEl(
            "p",
            {
                text:
                    "正在读取动画资料……"
            }
        );

        try {
            const info =
                await bangumiApi.getAnimeDetail(
                    result.url
                );

            if (!info) {
                detailArea.empty();

                detailArea.createEl(
                    "p",
                    {
                        text:
                            "无法读取该作品的动画资料。"
                    }
                );

                return;
            }

            this.selectedInfo =
                info;

            this.renderDetail(
                detailArea,
                info
            );
        } catch (error) {
            console.error(
                "读取动画详情失败:",
                error
            );

            detailArea.empty();

            detailArea.createEl(
                "p",
                {
                    text:
                        "读取动画详情失败，请稍后重试。"
                }
            );
        }
    }

    renderDetail(
        detailArea,
        info
    ) {
        detailArea.empty();

        detailArea.createEl(
            "h3",
            {
                text:
                    "已选择：《" +
                    info.CN +
                    "》"
            }
        );

        detailArea.createEl(
            "p",
            {
                text:
                    "日文名：" +
                    info.JP +
                    "\n" +
                    "类型：" +
                    info.type +
                    "\n" +
                    "总集数：" +
                    info.episode +
                    "\n" +
                    "开播日期：" +
                    info.date +
                    "\n" +
                    "BGM评分：" +
                    info.rating
            }
        );

        const stateLabel =
            detailArea.createEl(
                "p",
                {
                    text:
                        "观看状态："
                }
            );

        stateLabel.style.marginBottom =
            "4px";

        const stateSelect =
            detailArea.createEl(
                "select"
            );

        for (
            const state of
            WATCH_STATES
        ) {
            stateSelect.createEl(
                "option",
                {
                    text: state,
                    value: state
                }
            );
        }

        const folderLabel =
            detailArea.createEl(
                "label"
            );

        folderLabel.style.display =
            "block";

        folderLabel.style.marginTop =
            "12px";

        const folderCheckbox =
            folderLabel.createEl(
                "input"
            );

        folderCheckbox.type =
            "checkbox";

        folderCheckbox.checked =
            true;

        folderLabel.appendText(
            " 创建本地动画文件夹"
        );

        const pathPreview =
            detailArea.createEl(
                "p"
            );

        pathPreview.style.marginTop =
            "8px";

        pathPreview.style.color =
            "var(--text-muted)";

        const updatePreview = () => {
            const seasonInfo =
                noteManager.getSeasonInfo(
                    info.date
                );

            const folderName =
                noteManager.getSafeFileName(
                    info.CN ||
                    info.JP
                );

            const base =
                String(
                    this.plugin.settings
                        .localAnimeRoot ||
                    ""
                ).replace(
                    /[\\/]+$/,
                    ""
                );

            if (
                !folderCheckbox.checked ||
                !base ||
                !seasonInfo.year ||
                seasonInfo.season ===
                    "未知季度"
            ) {
                pathPreview.textContent =
                    "本次不创建本地动画文件夹。";
                return;
            }

            pathPreview.textContent =
                "预计路径：" +
                base +
                "/" +
                seasonInfo.year +
                "/" +
                seasonInfo.season +
                "/" +
                folderName;
        };

        folderCheckbox.onchange =
            updatePreview;

        updatePreview();

        const createButton =
            detailArea.createEl(
                "button",
                {
                    text: "创建动画笔记"
                }
            );

        createButton.style.marginTop =
            "14px";

        createButton.onclick =
            async () => {
                createButton.disabled =
                    true;

                createButton.textContent =
                    "正在创建……";

                try {
                    await this.createNote(
                        info,
                        stateSelect.value,
                        folderCheckbox.checked
                    );
                } catch (error) {
                    console.error(
                        "创建动画笔记失败:",
                        error
                    );

                    new Notice(
                        "创建失败：" +
                        error.message,
                        8000
                    );

                    createButton.disabled =
                        false;

                    createButton.textContent =
                        "创建动画笔记";
                }
            };
    }

    async createNote(
        info,
        watchState,
        shouldCreateFolder
    ) {
        const seasonInfo =
            noteManager.getSeasonInfo(
                info.date
            );

        info.state =
            watchState;

        info.recordDate =
            getTodayString();

        info.year =
            seasonInfo.year;

        info.season =
            seasonInfo.season;

        info.cover =
            await noteManager.saveCoverLocally(
                this.app,
                this.plugin.settings
                    .coverFolder,
                info.subjectId,
                info.Poster
            );

        if (!info.cover) {
            throw new Error(
                "没有可用的封面地址，无法创建笔记。"
            );
        }

        let downloadPath =
            "无";

        if (shouldCreateFolder) {
            downloadPath =
                createDownloadFolder(
                    this.plugin.settings,
                    info
                );
        }

        const result =
            await noteManager.createAnimeNote(
                this.app,
                this.plugin.settings,
                info,
                {
                    watchedEpisodes: "0",
                    watchUrl: "",
                    personalSummary: "",
                    downloadPath
                }
            );

        if (!result.created) {
            new Notice(
                "同名动画笔记已经存在，未覆盖原笔记。",
                7000
            );

            this.close();
            return;
        }

        new Notice(
            "已创建动画笔记：" +
            result.filePath,
            8000
        );

        this.close();

        const file =
            this.app.vault.getAbstractFileByPath(
                result.filePath
            );

        if (file) {
            const leaf =
                this.app.workspace.getLeaf(
                    true
                );

            await leaf.openFile(file);
        }
    }
}

function getTodayString() {
    const now = new Date();

    return String(
        now.getFullYear()
    ) +
        String(
            now.getMonth() + 1
        ).padStart(2, "0") +
        String(
            now.getDate()
        ).padStart(2, "0");
}

function createDownloadFolder(
    settings,
    info
) {
    const root =
        String(
            settings.localAnimeRoot || ""
        ).trim();

    if (
        !root ||
        !info.year ||
        !info.season ||
        info.season === "未知季度"
    ) {
        return "无";
    }

    const folderName =
        noteManager.getSafeFileName(
            info.CN ||
            info.JP ||
            info.fileName
        );

    const folderPath =
        path.join(
            root,
            info.year,
            info.season,
            folderName
        );

    try {
        fs.mkdirSync(
            folderPath,
            {
                recursive: true
            }
        );

        return folderPath.replace(
            /\\/g,
            "/"
        );
    } catch (error) {
        throw new Error(
            "创建本地动画文件夹失败：" +
            error.message
        );
    }
}

module.exports = {
    openSingleAnimeImport
};
