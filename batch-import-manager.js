const Modal =
    globalThis.__BangumiManagerModal;

const Notice =
    globalThis.__BangumiManagerNotice;

if (!Modal || !Notice) {
    throw new Error(
        "主插件没有传入 Modal 或 Notice。"
    );
}

const path =
    require("path");

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

const LIST_TYPES = {
    collect: {
        name: "已看",
        path: "collect",
        state: "已看",
        statusFile: "批量导入状态_已看.md"
    },
    wish: {
        name: "想看",
        path: "wish",
        state: "想看",
        statusFile: "批量导入状态_想看.md"
    },
    doing: {
        name: "在看",
        path: "do",
        state: "在看",
        statusFile: "批量导入状态_在看.md"
    }
};

const DEFAULT_DELAY =
    1200;

async function openBatchAnimeImport(
    app,
    plugin
) {
    new BatchAnimeImportModal(
        app,
        plugin
    ).open();
}

class BatchAnimeImportModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.running = false;
        this.stopRequested = false;
        this.status = null;
        this.statusFilePath = "";
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
                text: "批量导入动画"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "从 Bangumi 用户列表读取动画，自动创建笔记。已有笔记可选择跳过。"
            }
        );

        const userLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "Bangumi 用户 ID："
                }
            );

        userLabel.style.marginBottom =
            "4px";

        const userInput =
            contentEl.createEl("input");

        userInput.type =
            "text";

        userInput.value =
            String(
                this.plugin.settings
                    .bangumiUserId || ""
            );

        userInput.placeholder =
            "例如：890645";

        userInput.style.width =
            "100%";

        const listLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "要导入的列表："
                }
            );

        listLabel.style.marginBottom =
            "4px";

        const listSelect =
            contentEl.createEl(
                "select"
            );

        for (
            const [key, config]
            of Object.entries(LIST_TYPES)
        ) {
            listSelect.createEl(
                "option",
                {
                    text: config.name,
                    value: key
                }
            );
        }

        const stateLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "新建笔记的观看状态："
                }
            );

        stateLabel.style.marginBottom =
            "4px";

        const stateSelect =
            contentEl.createEl(
                "select"
            );

        for (
            const state of [
                "已看",
                "在看",
                "想看",
                "抛弃"
            ]
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
            contentEl.createEl(
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
            Boolean(
                this.plugin.settings
                    .batchCreateDownloadFolder
            );

        folderLabel.appendText(
            " 创建本地动画文件夹"
        );

        const skipLabel =
            contentEl.createEl(
                "label"
            );

        skipLabel.style.display =
            "block";

        skipLabel.style.marginTop =
            "8px";

        const skipCheckbox =
            skipLabel.createEl(
                "input"
            );

        skipCheckbox.type =
            "checkbox";

        skipCheckbox.checked =
            true;

        skipLabel.appendText(
            " 跳过已经存在的动画笔记"
        );

        const speedLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "每部动画之间暂停 1.2 秒，避免连续请求过快。"
                }
            );

        speedLabel.style.marginTop =
            "12px";

        const progress =
            contentEl.createEl(
                "pre"
            );

        progress.style.whiteSpace =
            "pre-wrap";

        progress.style.wordBreak =
            "break-word";

        progress.style.maxHeight =
            "260px";

        progress.style.overflowY =
            "auto";

        progress.style.padding =
            "10px";

        progress.style.background =
            "var(--background-secondary)";

        progress.textContent =
            "等待开始。";

        const startButton =
            contentEl.createEl(
                "button",
                {
                    text: "开始批量导入"
                }
            );

        startButton.style.marginTop =
            "12px";

        const stopButton =
            contentEl.createEl(
                "button",
                {
                    text: "停止后续导入"
                }
            );

        stopButton.style.marginTop =
            "12px";

        stopButton.style.marginLeft =
            "8px";

        stopButton.disabled =
            true;

        listSelect.onchange =
            () => {
                const config =
                    LIST_TYPES[
                        listSelect.value
                    ];

                stateSelect.value =
                    config.state;
            };

        startButton.onclick =
            async () => {
                const userId =
                    userInput.value.trim();

                if (!userId) {
                    new Notice(
                        "请先填写 Bangumi 用户 ID。",
                        6000
                    );
                    return;
                }

                if (
                    !/^\d+$/.test(userId)
                ) {
                    new Notice(
                        "Bangumi 用户 ID 只能填写数字。",
                        6000
                    );
                    return;
                }

                if (this.running) {
                    return;
                }

                this.running =
                    true;

                this.stopRequested =
                    false;

                startButton.disabled =
                    true;

                stopButton.disabled =
                    false;

                userInput.disabled =
                    true;

                listSelect.disabled =
                    true;

                stateSelect.disabled =
                    true;

                folderCheckbox.disabled =
                    true;

                skipCheckbox.disabled =
                    true;

                this.plugin.settings
                    .bangumiUserId =
                    userId;

                this.plugin.settings
                    .batchCreateDownloadFolder =
                    folderCheckbox.checked;

                await this.plugin.saveSettings();

                try {
                    await this.runImport(
                        userId,
                        listSelect.value,
                        stateSelect.value,
                        folderCheckbox.checked,
                        skipCheckbox.checked,
                        progress
                    );
                } finally {
                    this.running =
                        false;

                    startButton.disabled =
                        false;

                    stopButton.disabled =
                        true;

                    userInput.disabled =
                        false;

                    listSelect.disabled =
                        false;

                    stateSelect.disabled =
                        false;

                    folderCheckbox.disabled =
                        false;

                    skipCheckbox.disabled =
                        false;
                }
            };

        stopButton.onclick =
            () => {
                this.stopRequested =
                    true;

                progress.textContent +=
                    "\n已请求停止，当前动画处理完成后停止。";

                stopButton.disabled =
                    true;
            };
    }

    async runImport(
        userId,
        listKey,
        targetState,
        createFolder,
        skipExisting,
        progress
    ) {
        const listConfig =
            LIST_TYPES[listKey];

        const status = {
            isRunning: true,
            userId,
            listName: listConfig.name,
            totalPages: 0,
            totalItems: 0,
            processedItems: 0,
            createdNotes: 0,
            skippedNotes: 0,
            failedItems: 0,
            currentPage: 0,
            currentItem: "",
            failedList: [],
            recentLogs: [],
            startTime: Date.now()
        };

        this.status =
            status;

        this.statusFilePath =
            this.plugin.settings
                .noteRootFolder +
            "/" +
            listConfig.statusFile;

        try {
            this.writeProgress(
                progress,
                "正在读取 Bangumi 列表……"
            );

            const items =
                await this.fetchAllCollectionPages(
                    userId,
                    listConfig.path,
                    status,
                    progress
                );

            if (
                !items.length
            ) {
                this.writeProgress(
                    progress,
                    "没有找到可导入的动画。"
                );
                return;
            }

            status.totalItems =
                items.length;

            this.writeProgress(
                progress,
                "共找到 " +
                items.length +
                " 部动画，开始导入……"
            );

            await this.updateStatusFile(
                status
            );

            for (
                let index = 0;
                index < items.length;
                index += 1
            ) {
                if (
                    this.stopRequested
                ) {
                    this.addLog(
                        status,
                        "用户停止了后续导入。"
                    );
                    break;
                }

                const item =
                    items[index];

                const current =
                    index + 1;

                status.currentItem =
                    item.title_cn ||
                    item.title_jp ||
                    "未命名作品";

                this.writeProgress(
                    progress,
                    "[" +
                    current +
                    "/" +
                    items.length +
                    "] 正在处理：" +
                    status.currentItem
                );

                try {
                    const result =
                        await this.importOne(
                            item,
                            targetState,
                            createFolder,
                            skipExisting,
                            status
                        );

                    status.processedItems =
                        current;

                    if (result === "created") {
                        status.createdNotes += 1;
                    } else if (
                        result === "skipped"
                    ) {
                        status.skippedNotes += 1;
                    }

                    await this.updateStatusFile(
                        status
                    );
                } catch (error) {
                    status.processedItems =
                        current;

                    status.failedItems += 1;

                    status.failedList.push({
                        title:
                            status.currentItem,
                        url: item.link,
                        reason:
                            error.message
                    });

                    this.addLog(
                        status,
                        "处理失败：" +
                        status.currentItem +
                        "；" +
                        error.message
                    );

                    await this.updateStatusFile(
                        status
                    );
                }

                if (
                    index < items.length - 1 &&
                    !this.stopRequested
                ) {
                    await delay(
                        DEFAULT_DELAY
                    );
                }
            }

            status.isRunning =
                false;

            await this.updateStatusFile(
                status
            );

            this.writeProgress(
                progress,
                this.createSummary(
                    status
                )
            );

            new Notice(
                this.createSummary(status),
                10000
            );
        } catch (error) {
            status.isRunning =
                false;

            status.failedItems += 1;

            this.addLog(
                status,
                "批量导入失败：" +
                error.message
            );

            await this.updateStatusFile(
                status
            );

            this.writeProgress(
                progress,
                "批量导入失败：" +
                error.message
            );

            new Notice(
                "批量导入失败：" +
                error.message,
                10000
            );
        }
    }

    async fetchAllCollectionPages(
        userId,
        listPath,
        status,
        progress
    ) {
        const items = [];
        let page = 1;

        while (true) {
            if (
                this.stopRequested
            ) {
                break;
            }

            const url =
                "https://bgm.tv/anime/list/" +
                userId +
                "/" +
                listPath +
                (
                    page === 1
                        ? ""
                        : "?page=" + page
                );

            status.currentPage =
                page;

            this.writeProgress(
                progress,
                "正在读取第 " +
                page +
                " 页……"
            );

            const html =
                await bangumiApi.requestHtml(
                    url
                );

            const doc =
                bangumiApi.parseHtml(
                    html
                );

            const pageItems =
                this.parseCollectionPage(
                    doc
                );

            if (
                pageItems.length === 0
            ) {
                break;
            }

            items.push(
                ...pageItems
            );

            status.totalPages =
                page;

            await this.updateStatusFile(
                status
            );

            if (
                !this.hasNextPage(
                    doc,
                    page
                )
            ) {
                break;
            }

            page += 1;
            await delay(1200);
        }

        return items;
    }

    parseCollectionPage(doc) {
        const result = [];

        const entries =
            doc.querySelectorAll(
                "ul#browserItemList > li.item"
            );

        for (
            const entry of
            entries
        ) {
            const titleLink =
                entry.querySelector(
                    "h3 > a.l"
                );

            const cover =
                entry.querySelector(
                    "img.cover"
                );

            if (!titleLink) {
                continue;
            }

            const href =
                titleLink.getAttribute(
                    "href"
                );

            if (!href) {
                continue;
            }

            const jpElement =
                entry.querySelector(
                    "h3 > small.grey"
                );

            result.push({
                title_cn:
                    bangumiApi.cleanFileName(
                        titleLink.textContent
                    ),
                title_jp:
                    bangumiApi.cleanFileName(
                        jpElement
                            ? jpElement.textContent
                            : ""
                    ),
                link:
                    href.startsWith("http")
                        ? href
                        : "https://bgm.tv" +
                          href,
                cover:
                    cover
                        ? normalizeImageUrl(
                            cover.getAttribute(
                                "src"
                            )
                        )
                        : ""
            });
        }

        return result;
    }

    hasNextPage(doc, page) {
        const pagination =
            doc.querySelector(
                "div#multipage"
            );

        if (!pagination) {
            return false;
        }

        const links =
            pagination.querySelectorAll(
                "a.p"
            );

        for (
            const link of
            links
        ) {
            const href =
                link.getAttribute(
                    "href"
                ) || "";

            const match =
                href.match(
                    /page=(\d+)/
                );

            if (
                match &&
                Number(match[1]) >
                    page
            ) {
                return true;
            }
        }

        return false;
    }

    async importOne(
        item,
        targetState,
        createFolder,
        skipExisting,
        status
    ) {
        const info =
            await bangumiApi.getAnimeDetail(
                item.link
            );

        if (!info) {
            throw new Error(
                "无法读取动画详情"
            );
        }

        const seasonInfo =
            noteManager.getSeasonInfo(
                info.date
            );

        info.state =
            targetState;

        info.recordDate =
            getTodayString();

        info.year =
            seasonInfo.year;

        info.season =
            seasonInfo.season;

        info.url =
            item.link;

        info.fileName =
            info.CN ||
            info.JP ||
            item.title_cn ||
            item.title_jp ||
            "未知作品";

        info.cover =
            await noteManager.saveCoverLocally(
                this.app,
                this.plugin.settings
                    .coverFolder,
                info.subjectId,
                info.Poster ||
                item.cover
            );

        if (!info.cover) {
            throw new Error(
                "没有可用封面"
            );
        }

        let downloadPath =
            "无";

        if (
            createFolder &&
            info.year &&
            info.season !==
                "未知季度"
        ) {
            downloadPath =
                this.createDownloadFolder(
                    info
                );
        }

        const notePath =
            this.getExpectedNotePath(
                info
            );

        if (
            skipExisting &&
            this.app.vault
                .getAbstractFileByPath(
                    notePath
                )
        ) {
            this.addLog(
                status,
                "跳过已有笔记：" +
                notePath
            );

            return "skipped";
        }

        const created =
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

        if (!created.created) {
            return "skipped";
        }

        this.addLog(
            status,
            "已创建：" +
            created.filePath
        );

        return "created";
    }

    getExpectedNotePath(info) {
        const folder =
            noteManager.getNoteFolder(
                this.plugin.settings
                    .noteRootFolder,
                info
            );

        const fileName =
            noteManager.getSafeFileName(
                info.fileName ||
                info.CN ||
                info.JP ||
                "未知作品"
            );

        return (
            folder +
            "/" +
            fileName +
            ".md"
        );
    }

    createDownloadFolder(info) {
        const root =
            String(
                this.plugin.settings
                    .localAnimeRoot ||
                ""
            ).trim();

        if (
            !root ||
            !info.year ||
            !info.season
        ) {
            return "无";
        }

        const folderName =
            noteManager.getSafeFileName(
                info.fileName ||
                info.CN ||
                info.JP
            );

        const folderPath =
            path.join(
                root,
                info.year,
                info.season,
                folderName
            );

        const fs =
            require("fs");

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
    }

    writeProgress(
        element,
        message
    ) {
        element.textContent =
            message;
    }

    addLog(
        status,
        message
    ) {
        const now =
            new Date();

        const time =
            now.toLocaleTimeString(
                "zh-CN",
                {
                    hour12: false
                }
            );

        const entry =
            "[" +
            time +
            "] " +
            message;

        status.recentLogs.push(
            entry
        );

        if (
            status.recentLogs.length >
            50
        ) {
            status.recentLogs =
                status.recentLogs.slice(
                    -50
                );
        }

        console.log(
            "[Bangumi批量导入]",
            message
        );
    }

    async updateStatusFile(status) {
        const folder =
            this.plugin.settings
                .noteRootFolder;

        await noteManager.ensureVaultFolder(
            this.app,
            folder
        );

        const filePath =
            this.statusFilePath;

        const content =
            this.buildStatusContent(
                status
            );

        const existing =
            this.app.vault
                .getAbstractFileByPath(
                    filePath
                );

        if (existing) {
            await this.app.vault.modify(
                existing,
                content
            );
        } else {
            await this.app.vault.create(
                filePath,
                content
            );
        }
    }

    buildStatusContent(status) {
        const percent =
            status.totalItems > 0
                ? Math.round(
                    status.processedItems /
                    status.totalItems *
                    100
                )
                : 0;

        let content =
            "# Bangumi 批量导入状态\n\n";

        content +=
            "列表：" +
            status.listName +
            "\n\n";

        content +=
            "用户 ID：" +
            status.userId +
            "\n\n";

        content +=
            "状态：" +
            (
                status.isRunning
                    ? "进行中"
                    : "已完成"
            ) +
            "\n\n";

        content +=
            "进度：" +
            status.processedItems +
            "/" +
            status.totalItems +
            "（" +
            percent +
            "%）\n\n";

        content +=
            "- 页面数：" +
            status.totalPages +
            "\n";

        content +=
            "- 成功创建：" +
            status.createdNotes +
            "\n";

        content +=
            "- 跳过已有：" +
            status.skippedNotes +
            "\n";

        content +=
            "- 失败数量：" +
            status.failedItems +
            "\n";

        if (
            status.currentItem
        ) {
            content +=
                "- 当前作品：" +
                status.currentItem +
                "\n";
        }

        content +=
            "\n## 失败列表\n\n";

        if (
            status.failedList.length === 0
        ) {
            content +=
                "暂无失败项目。\n";
        } else {
            for (
                const item of
                status.failedList
            ) {
                content +=
                    "- " +
                    item.title +
                    "\n" +
                    "  - 链接：" +
                    item.url +
                    "\n" +
                    "  - 原因：" +
                    item.reason +
                    "\n";
            }
        }

        content +=
            "\n## 最近日志\n\n";

        content +=
            status.recentLogs.join(
                "\n"
            );

        content += "\n";

        return content;
    }

    createSummary(status) {
        const duration =
            Math.round(
                (Date.now() -
                    status.startTime) /
                1000
            );

        const minutes =
            Math.floor(
                duration / 60
            );

        const seconds =
            duration % 60;

        return (
            "批量导入完成：" +
            "成功 " +
            status.createdNotes +
            " 部，" +
            "跳过 " +
            status.skippedNotes +
            " 部，" +
            "失败 " +
            status.failedItems +
            " 部。" +
            "耗时 " +
            minutes +
            " 分 " +
            seconds +
            " 秒。"
        );
    }

    onClose() {
        if (
            this.running
        ) {
            this.stopRequested =
                true;
        }

        this.contentEl.empty();
    }
}

function normalizeImageUrl(url) {
    const value =
        String(url || "").trim();

    if (
        value.startsWith("//")
    ) {
        return "https:" + value;
    }

    if (
        value.startsWith("http")
    ) {
        return value;
    }

    return value
        ? "https://bgm.tv" + value
        : "";
}

function getTodayString() {
    const now =
        new Date();

    return (
        String(
            now.getFullYear()
        ) +
        String(
            now.getMonth() + 1
        ).padStart(2, "0") +
        String(
            now.getDate()
        ).padStart(2, "0")
    );
}

function delay(ms) {
    return new Promise(
        (resolve) => {
            setTimeout(
                resolve,
                ms
            );
        }
    );
}

module.exports = {
    openBatchAnimeImport
};
