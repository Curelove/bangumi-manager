const {
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    Modal
} = require("obsidian");

const fs = require("fs");
const path = require("path");

globalThis.__BangumiManagerModal =
    Modal;

globalThis.__BangumiManagerNotice =
    Notice;

let openSingleAnimeImport;
let openBatchAnimeImport;

const DEFAULT_SETTINGS = {
    mode: "lazy",
    noteRootFolder:
        "馆藏/追番广场/番剧数据卡片",
    coverFolder:
        "附件/Bangumi Images",
    listFilePath:
        "馆藏/追番广场/追番列表（本地）",
    baseFilePath:
        "馆藏/追番广场/动画库.base",
    localAnimeRoot:
        "D:/ACG/Obsidian ACG",
    checkIntervalSeconds: 60,
    checkOnStartup: true,
    checkOnSave: true,
    seasonViewMode: "none",
    showManagerRibbon: false
};

const VIDEO_EXTENSIONS = [
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".m4v"
];

const WATCH_STATES = [
    "已看",
    "在看",
    "想看",
    "抛弃"
];

class BangumiManagerPlugin extends Plugin {
    async onload() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        try {
            const vaultBasePath =
                this.app.vault.adapter
                    .getBasePath();

            const pluginDirectory =
                path.resolve(
                    vaultBasePath,
                    ".obsidian",
                    "plugins",
                    "bangumi-manager"
                );

            const importManagerPath =
                path.resolve(
                    pluginDirectory,
                    "import-manager.js"
                );

            const importManager =
                require(
                    importManagerPath
                );

            if (
                typeof importManager
                    .openSingleAnimeImport !==
                "function"
            ) {
                throw new Error(
                    "import-manager.js 中没有找到 openSingleAnimeImport"
                );
            }

            openSingleAnimeImport =
                importManager
                    .openSingleAnimeImport;
        } catch (error) {
            console.error(
                "无法加载单个动画导入模块:",
                error
            );

            openSingleAnimeImport =
                async () => {
                    new Notice(
                        "单个动画导入模块加载失败：" +
                        error.message,
                        10000
                    );

                    console.error(
                        "单个动画导入模块详细错误:",
                        error
                    );
                };
        }

        try {
            const vaultBasePath =
                this.app.vault.adapter
                    .getBasePath();

            const pluginDirectory =
                path.resolve(
                    vaultBasePath,
                    ".obsidian",
                    "plugins",
                    "bangumi-manager"
                );

            const batchManagerPath =
                path.resolve(
                    pluginDirectory,
                    "batch-import-manager.js"
                );

            const batchManager =
                require(
                    batchManagerPath
                );

            if (
                typeof batchManager
                    .openBatchAnimeImport !==
                "function"
            ) {
                throw new Error(
                    "batch-import-manager.js 中没有找到 openBatchAnimeImport"
                );
            }

            openBatchAnimeImport =
                batchManager
                    .openBatchAnimeImport;
        } catch (error) {
            console.error(
                "无法加载批量导入模块:",
                error
            );

            openBatchAnimeImport =
                async () => {
                    new Notice(
                        "批量导入模块加载失败：" +
                        error.message,
                        10000
                    );

                    console.error(
                        "批量导入模块详细错误:",
                        error
                    );
                };
        }
        this.addSettingTab(
            new BangumiManagerSettingTab(
                this.app,
                this
            )
        );

        this.addCommand({
            id: "initialize-missing-files",
            name: "Bangumi管理器：初始化缺失文件",
            callback: async () => {
                await this.initializeMissingFiles();
            }
        });

        this.addCommand({
            id: "check-all-local-status",
            name: "Bangumi管理器：立即检查全部本地状态",
            callback: async () => {
                await this.checkAllLocalStatus(true);
            }
        });

        this.addCommand({
            id: "generate-season-views",
            name: "Bangumi管理器：补齐季度视图",
            callback: async () => {
                await this.generateSeasonViews(true);
            }
        });

                this.addCommand({
            id: "import-single-anime",
            name: "Bangumi管理器：导入单个动画",
            callback: async () => {
                await openSingleAnimeImport(
                    this.app,
                    this
                );
            }
        });

        this.addCommand({
            id: "import-batch-anime",
            name: "Bangumi管理器：批量导入动画",
            callback: async () => {
                await openBatchAnimeImport(
                    this.app,
                    this
                );
            }
        });

        this.addCommand({
            id: "select-season-views-to-remove",
            name: "Bangumi管理器：选择季度视图清理",
            callback: async () => {
                await this.openSeasonViewCleanup();
            }
        });

        this.addCommand({
            id: "clean-completed-season-views",
            name: "Bangumi管理器：清理已完成季度视图",
            callback: async () => {
                await this.cleanCompletedSeasonViews(true);
            }
        });

        this.addCommand({
            id: "batch-change-watch-status",
            name: "Bangumi管理器：批量修改观看状态",
            callback: async () => {
                await this.openBatchStatusManager();
            }
        });

        this.registerEvent(
            this.app.vault.on(
                "modify",
                (file) => {
                    if (
                        !this.settings.checkOnSave ||
                        !this.isTargetNote(file)
                    ) {
                        return;
                    }

                    clearTimeout(
                        this.saveCheckTimer
                    );

                    this.saveCheckTimer =
                        setTimeout(
                            async () => {
                                try {
                                    await this.checkOneLocalStatus(
                                        file
                                    );
                                } catch (error) {
                                    console.error(
                                        "保存后检查本地状态失败:",
                                        error
                                    );
                                }
                            },
                            1200
                        );
                }
            )
        );

        if (this.settings.checkOnStartup) {
            setTimeout(
                async () => {
                    await this.checkAllLocalStatus(false);
                },
                5000
            );
        }

        this.refreshManagerRibbon();
        this.startStatusTimer();
    }

    onunload() {
        this.stopStatusTimer();
        clearTimeout(this.saveCheckTimer);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.startStatusTimer();
    }

    startStatusTimer() {
        this.stopStatusTimer();

        const seconds = Math.max(
            10,
            Number(
                this.settings.checkIntervalSeconds
            ) || 60
        );

        this.statusTimer = window.setInterval(
            async () => {
                await this.checkAllLocalStatus(false);
            },
            seconds * 1000
        );
    }

    stopStatusTimer() {
        if (this.statusTimer) {
            window.clearInterval(
                this.statusTimer
            );

            this.statusTimer = null;
        }
    }

    refreshManagerRibbon() {
        if (this.managerRibbon) {
            this.managerRibbon.remove();
            this.managerRibbon = null;
        }

        if (!this.settings.showManagerRibbon) {
            return;
        }

        this.managerRibbon =
            this.addRibbonIcon(
                "library",
                "Bangumi 追番管理器",
                () => {
                    new ManagerRibbonModal(
                        this.app,
                        this
                    ).open();
                }
            );
    }

    isTargetNote(file) {
        return Boolean(
            file &&
            file.extension === "md" &&
            file.path.startsWith(
                this.settings.noteRootFolder + "/"
            )
        );
    }

    getCurrentSeasonName() {
        const now = new Date();
        const year =
            String(now.getFullYear());

        const month =
            now.getMonth() + 1;

        if (
            month === 12 ||
            month === 1 ||
            month === 2
        ) {
            return year + "年01月新番";
        }

        if (
            month === 3 ||
            month === 4 ||
            month === 5
        ) {
            return year + "年04月新番";
        }

        if (
            month === 6 ||
            month === 7 ||
            month === 8
        ) {
            return year + "年07月新番";
        }

        return year + "年10月新番";
    }

    async initializeMissingFiles() {
        await this.ensureVaultFolder(
            this.settings.noteRootFolder
        );

        await this.ensureVaultFolder(
            this.settings.coverFolder
        );

        await this.createListFileIfMissing();
        await this.createBaseFileIfMissing();

        new Notice(
            "已按当前路径设置完成初始化检查。已有文件不会覆盖。",
            6000
        );
    }

    async ensureVaultFolder(folderPath) {
        if (!folderPath) {
            return;
        }

        if (
            this.app.vault.getAbstractFileByPath(
                folderPath
            )
        ) {
            return;
        }

        try {
            await this.app.vault.createFolder(
                folderPath
            );
        } catch (error) {
            if (
                !this.app.vault.getAbstractFileByPath(
                    folderPath
                )
            ) {
                throw error;
            }
        }
    }

    async createListFileIfMissing() {
        const filePath =
            this.settings.listFilePath.endsWith(
                ".md"
            )
                ? this.settings.listFilePath
                : this.settings.listFilePath + ".md";

        if (
            this.app.vault.getAbstractFileByPath(
                filePath
            )
        ) {
            return;
        }

        const folderPath =
            filePath.substring(
                0,
                filePath.lastIndexOf("/")
            );

        await this.ensureVaultFolder(folderPath);

        const content =
`# 追番列表 - 在看

此页面由 Bangumi 追番管理器创建。

插件会在后台自动检查本地视频数量。
需要立即更新时，请在插件设置中点击“立即检查全部本地状态”。

\`\`\`dataview
TABLE
  中文名 AS "中文名",
  开播季度 AS "开播季度",
  本地更新状态 AS "本地更新状态"
FROM "${this.settings.noteRootFolder}"
WHERE tags = "bangumi" AND 观看状态 = "在看"
SORT 开播年份 DESC, 开播季度 DESC, 中文名 ASC
\`\`\`
`;

        await this.app.vault.create(
            filePath,
            content
        );
    }

    async createBaseFileIfMissing() {
        const filePath =
            this.settings.baseFilePath;

        if (
            this.app.vault.getAbstractFileByPath(
                filePath
            )
        ) {
            return;
        }

        const folderPath =
            filePath.substring(
                0,
                filePath.lastIndexOf("/")
            );

        await this.ensureVaultFolder(folderPath);

        const content =
`filters:
  and:
    - file.tags.contains("bangumi")
views:
  - type: cards
    name: 全部动画
    order:
      - file.name
      - 观看状态
      - BGM评分
    cardSize: 180
    image: note.cover
    imageAspectRatio: 1
`;

        await this.app.vault.create(
            filePath,
            content
        );
    }

    async checkAllLocalStatus(showNotice) {
        const files =
            this.app.vault.getMarkdownFiles();

        let checked = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (const file of files) {
            if (!this.isTargetNote(file)) {
                continue;
            }

            checked += 1;

            try {
                const result =
                    await this.checkOneLocalStatus(
                        file
                    );

                if (result === "updated") {
                    updated += 1;
                } else {
                    skipped += 1;
                }
            } catch (error) {
                failed += 1;

                console.error(
                    "本地状态检查失败:",
                    file.path,
                    error
                );
            }
        }

        if (showNotice) {
            new Notice(
                "本地状态检查完成：检查 " +
                checked +
                " 篇，更新 " +
                updated +
                " 篇，跳过 " +
                skipped +
                " 篇，失败 " +
                failed +
                " 篇",
                8000
            );
        }
    }

    async checkOneLocalStatus(file) {
        const content =
            await this.app.vault.read(file);

        const frontmatter =
            parseFrontmatter(content);

        if (!frontmatter) {
            return "skipped";
        }

        const tags =
            String(
                frontmatter.fields.tags || ""
            );

        if (!tags.includes("bangumi")) {
            return "skipped";
        }

        const downloadPath =
            cleanValue(
                frontmatter.fields.下载路径
            );

        const watchedEpisodes =
            extractWatchedEpisodes(content);

        const result =
            inspectLocalFolder(
                downloadPath,
                watchedEpisodes
            );

        const newContent =
            updateFolderLine(
                updateFrontmatterField(
                    content,
                    "本地更新状态",
                    getLocalStatusText(result)
                ),
                result
            );

        if (newContent === content) {
            return "skipped";
        }

        await this.app.vault.modify(
            file,
            newContent
        );

        return "updated";
    }

    async generateSeasonViews(showNotice) {
        const baseFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.baseFilePath
            );

        if (!baseFile) {
            await this.createBaseFileIfMissing();
        }

        const actualBaseFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.baseFilePath
            );

        if (!actualBaseFile) {
            return;
        }

        const seasons =
            await this.collectSeasonNames();

        let seasonList = [...seasons];

        if (
            this.settings.seasonViewMode ===
            "current"
        ) {
            const currentSeason =
                this.getCurrentSeasonName();

            seasonList =
                seasonList.filter(
                    (name) => {
                        return name === currentSeason;
                    }
                );
        }

        let baseContent =
            await this.app.vault.read(
                actualBaseFile
            );

        let addedCount = 0;

        for (const seasonName of seasonList) {
            if (
                hasBaseView(
                    baseContent,
                    seasonName
                )
            ) {
                continue;
            }

            baseContent =
                appendSeasonView(
                    baseContent,
                    seasonName
                );

            addedCount += 1;
        }

        if (addedCount > 0) {
            await this.app.vault.modify(
                actualBaseFile,
                baseContent
            );
        }

        if (showNotice) {
            new Notice(
                addedCount > 0
                    ? "已新增 " +
                      addedCount +
                      " 个季度视图。"
                    : "没有需要新增的季度视图。",
                6000
            );
        }
    }

    async collectSeasonNames() {
        const seasons = new Set();

        for (
            const file of
            this.app.vault.getMarkdownFiles()
        ) {
            if (!this.isTargetNote(file)) {
                continue;
            }

            const content =
                await this.app.vault.read(file);

            const frontmatter =
                parseFrontmatter(content);

            if (!frontmatter) {
                continue;
            }

            const tags =
                String(
                    frontmatter.fields.tags || ""
                );

            if (!tags.includes("bangumi")) {
                continue;
            }

            const year =
                cleanValue(
                    frontmatter.fields.开播年份
                );

            const season =
                cleanValue(
                    frontmatter.fields.开播季度
                );

            if (
                /^\d{4}$/.test(year) &&
                /^\d{2}月新番$/.test(season)
            ) {
                seasons.add(
                    year + "年" + season
                );
            }
        }

        return seasons;
    }

    async readBaseViewNames() {
        const baseFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.baseFilePath
            );

        if (!baseFile) {
            return [];
        }

        const content =
            await this.app.vault.read(baseFile);

        return extractBaseViewNames(content);
    }

    async openSeasonViewCleanup() {
        const viewNames =
            await this.readBaseViewNames();

        const removable =
            viewNames.filter(
                (name) => name !== "全部动画"
            );

        if (removable.length === 0) {
            new Notice(
                "动画库中没有可清理的季度视图。",
                5000
            );
            return;
        }

        new SeasonViewSelectModal(
            this.app,
            removable,
            async (selected) => {
                await this.removeSeasonViews(
                    selected,
                    true
                );
            }
        ).open();
    }

    async removeSeasonViews(
        selectedNames,
        showNotice
    ) {
        const baseFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.baseFilePath
            );

        if (!baseFile) {
            new Notice(
                "动画库文件不存在，请先执行初始化缺失文件。",
                6000
            );
            return;
        }

        const content =
            await this.app.vault.read(baseFile);

        const result =
            removeBaseViews(
                content,
                (name) => {
                    return selectedNames.includes(
                        name
                    );
                }
            );

        if (result.removedCount === 0) {
            new Notice(
                "没有删除任何视图。",
                5000
            );
            return;
        }

        await this.app.vault.modify(
            baseFile,
            result.content
        );

        if (showNotice) {
            new Notice(
                "已删除 " +
                result.removedCount +
                " 个季度视图。“全部动画”未受影响。",
                6000
            );
        }
    }

    async cleanCompletedSeasonViews(showNotice) {
        const baseFile =
            this.app.vault.getAbstractFileByPath(
                this.settings.baseFilePath
            );

        if (!baseFile) {
            new Notice(
                "动画库文件不存在，请先执行初始化缺失文件。",
                6000
            );
            return;
        }

        const completionMap =
            await this.getSeasonCompletionMap();

        const existingViewNames =
            await this.readBaseViewNames();

        const names =
            [...completionMap.entries()]
                .filter(([name, complete]) => {
                    return (
                        complete &&
                        existingViewNames.includes(
                            name
                        )
                    );
                })
                .map(([name]) => name);

        if (names.length === 0) {
            new Notice(
                "没有符合安全清理条件的季度视图。",
                6000
            );
            return;
        }

        new SeasonViewConfirmModal(
            this.app,
            names,
            async () => {
                await this.removeSeasonViews(
                    names,
                    showNotice
                );
            }
        ).open();
    }

    async getSeasonCompletionMap() {
        const result = new Map();

        for (
            const file of
            this.app.vault.getMarkdownFiles()
        ) {
            if (!this.isTargetNote(file)) {
                continue;
            }

            const content =
                await this.app.vault.read(file);

            const frontmatter =
                parseFrontmatter(content);

            if (!frontmatter) {
                continue;
            }

            const tags =
                String(
                    frontmatter.fields.tags || ""
                );

            if (!tags.includes("bangumi")) {
                continue;
            }

            const year =
                cleanValue(
                    frontmatter.fields.开播年份
                );

            const season =
                cleanValue(
                    frontmatter.fields.开播季度
                );

            const seasonName =
                year + "年" + season;

            if (
                !/^\d{4}年\d{2}月新番$/.test(
                    seasonName
                )
            ) {
                continue;
            }

            const watchState =
                cleanValue(
                    frontmatter.fields.观看状态
                );

            let complete = false;

            if (watchState === "已看") {
                complete = true;
            } else {
                const totalEpisodes =
                    Number(
                        cleanValue(
                            frontmatter.fields.总集数
                        )
                    );

                const watchedEpisodes =
                    extractWatchedEpisodes(
                        content
                    );

                const localInfo =
                    inspectLocalFolder(
                        cleanValue(
                            frontmatter.fields.下载路径
                        ),
                        watchedEpisodes
                    );

                complete =
                    totalEpisodes > 0 &&
                    watchedEpisodes >=
                        totalEpisodes &&
                    !localInfo.error &&
                    localInfo.fileCount >=
                        totalEpisodes;
            }

            if (!result.has(seasonName)) {
                result.set(
                    seasonName,
                    complete
                );
            } else if (!complete) {
                result.set(
                    seasonName,
                    false
                );
            }
        }

        return result;
    } 
    
    async openBatchStatusManager() {
        const items =
            await this.collectAnimeItems();

        if (items.length === 0) {
            new Notice(
                "没有找到带有 bangumi 标签的动画笔记。",
                6000
            );
            return;
        }

        new BatchStatusModal(
            this.app,
            items,
            async (status, files) => {
                await this.batchChangeWatchStatus(
                    status,
                    files,
                    true
                );
            }
        ).open();
    }

    async collectAnimeItems() {
        const result = [];

        for (
            const file of
            this.app.vault.getMarkdownFiles()
        ) {
            if (!this.isTargetNote(file)) {
                continue;
            }

            const content =
                await this.app.vault.read(file);

            const frontmatter =
                parseFrontmatter(content);

            if (!frontmatter) {
                continue;
            }

            const tags =
                String(
                    frontmatter.fields.tags || ""
                );

            if (!tags.includes("bangumi")) {
                continue;
            }

            result.push({
                file,
                name:
                    cleanValue(
                        frontmatter.fields.中文名
                    ) || file.basename,
                state:
                    cleanValue(
                        frontmatter.fields.观看状态
                    ) || "未设置",
                season:
                    cleanValue(
                        frontmatter.fields.开播年份
                    ) +
                    "年" +
                    cleanValue(
                        frontmatter.fields.开播季度
                    )
            });
        }

        return result.sort(
            (a, b) => {
                return a.name.localeCompare(
                    b.name,
                    "zh-CN"
                );
            }
        );
    }

    async batchChangeWatchStatus(
        status,
        files,
        showNotice
    ) {
        let updated = 0;
        let skipped = 0;

        for (const file of files) {
            const content =
                await this.app.vault.read(file);

            const newContent =
                updateFrontmatterField(
                    content,
                    "观看状态",
                    status
                );

            if (newContent === content) {
                skipped += 1;
                continue;
            }

            await this.app.vault.modify(
                file,
                newContent
            );

            updated += 1;
        }

        if (showNotice) {
            new Notice(
                "观看状态修改完成：更新 " +
                updated +
                " 篇，跳过 " +
                skipped +
                " 篇。",
                7000
            );
        }
    }
}

class SeasonViewSelectModal extends Modal {
    constructor(app, names, onSubmit) {
        super(app);
        this.names = names;
        this.onSubmit = onSubmit;
        this.selected = new Set();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl(
            "h2",
            {
                text: "选择要清理的季度视图"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "勾选后一次删除。这里只删除动画库 Base 中的季度视图，不删除动画笔记、本地视频或本地文件夹；“全部动画”不会被删除。"
            }
        );

        const controls =
            contentEl.createDiv();

        const selectAll =
            controls.createEl(
                "button",
                {
                    text: "全选"
                }
            );

        const clearAll =
            controls.createEl(
                "button",
                {
                    text: "清空"
                }
            );

        selectAll.style.marginRight =
            "8px";

        const list =
            contentEl.createDiv();

        list.style.maxHeight =
            "360px";
        list.style.overflowY =
            "auto";
        list.style.marginTop =
            "12px";

        for (const name of this.names) {
            const row =
                list.createDiv();

            row.style.margin =
                "6px 0";

            const checkbox =
                row.createEl(
                    "input"
                );

            checkbox.type = "checkbox";
            checkbox.dataset.name =
                name;

            checkbox.onchange = () => {
                if (checkbox.checked) {
                    this.selected.add(name);
                } else {
                    this.selected.delete(name);
                }
            };

            row.createEl(
                "span",
                {
                    text: " " + name
                }
            );
        }

        selectAll.onclick = () => {
            list.querySelectorAll(
                "input[type=checkbox]"
            ).forEach((checkbox) => {
                checkbox.checked = true;
                this.selected.add(
                    checkbox.dataset.name
                );
            });
        };

        clearAll.onclick = () => {
            list.querySelectorAll(
                "input[type=checkbox]"
            ).forEach((checkbox) => {
                checkbox.checked = false;
            });

            this.selected.clear();
        };

        const submit =
            contentEl.createEl(
                "button",
                {
                    text: "删除已选视图"
                }
            );

        submit.style.marginTop =
            "14px";

        submit.onclick = async () => {
            if (this.selected.size === 0) {
                new Notice(
                    "请先勾选要清理的季度视图。",
                    5000
                );
                return;
            }

            const selected =
                [...this.selected];

            this.close();
            await this.onSubmit(selected);
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class SeasonViewConfirmModal extends Modal {
    constructor(app, names, onConfirm) {
        super(app);
        this.names = names;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl(
            "h2",
            {
                text: "确认清理已完成季度"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "以下季度将只删除动画库 Base 中的季度视图，不会删除动画笔记、本地视频或本地文件夹："
            }
        );

        const list =
            contentEl.createEl("ul");

        for (const name of this.names) {
            list.createEl(
                "li",
                {
                    text: name
                }
            );
        }

        contentEl.createEl(
            "p",
            {
                text:
                    "状态为“已看”的动画会视为已完成；总集数未知、路径不存在或仍有未完成动画的其他动画不会作为完成依据。"
            }
        );

        const button =
            contentEl.createEl(
                "button",
                {
                    text: "确认清理"
                }
            );

        button.onclick = async () => {
            this.close();
            await this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class BatchStatusModal extends Modal {
    constructor(app, items, onSubmit) {
        super(app);
        this.items = items;
        this.onSubmit = onSubmit;
        this.selected = new Set();
        this.filteredItems = items;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl(
            "h2",
            {
                text: "批量修改观看状态"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "先选择“将观看状态改为”的目标状态，再勾选多部动画。执行后只修改观看状态，不重建笔记。"
            }
        );

        const statusLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "将观看状态改为："
                }
            );

        statusLabel.style.marginBottom =
            "4px";

        const status =
            contentEl.createEl("select");

        for (const value of WATCH_STATES) {
            status.createEl(
                "option",
                {
                    text: value,
                    value
                }
            );
        }

        const filterLabel =
            contentEl.createEl(
                "p",
                {
                    text:
                        "下面的筛选只影响列表显示，不会立即修改动画。"
                }
            );

        filterLabel.style.marginTop =
            "12px";
        filterLabel.style.marginBottom =
            "4px";

        const filterRow =
            contentEl.createDiv();

        filterRow.style.marginTop =
            "10px";

        const stateFilter =
            filterRow.createEl("select");

        [
            "全部观看状态",
            ...WATCH_STATES
        ].forEach((value) => {
            stateFilter.createEl(
                "option",
                {
                    text: value,
                    value
                }
            );
        });

        const seasonFilter =
            filterRow.createEl("select");

        const seasons = [
            "全部季度",
            ...new Set(
                this.items
                    .map((item) => item.season)
                    .filter(
                        (season) => {
                            return (
                                season &&
                                season !== "年"
                            );
                        }
                    )
            )
        ];

        seasons.forEach((value) => {
            seasonFilter.createEl(
                "option",
                {
                    text: value,
                    value
                }
            );
        });

        const controls =
            contentEl.createDiv();

        controls.style.marginTop =
            "10px";

        const selectAll =
            controls.createEl(
                "button",
                {
                    text: "全选当前结果"
                }
            );

        const clearAll =
            controls.createEl(
                "button",
                {
                    text: "清空选择"
                }
            );

        selectAll.style.marginRight =
            "8px";

        const list =
            contentEl.createDiv();

        list.style.maxHeight =
            "380px";
        list.style.overflowY =
            "auto";
        list.style.marginTop =
            "10px";

        const render = () => {
            list.empty();

            this.filteredItems =
                this.items.filter(
                    (item) => {
                        const stateOk =
                            stateFilter.value ===
                                "全部观看状态" ||
                            item.state ===
                                stateFilter.value;

                        const seasonOk =
                            seasonFilter.value ===
                                "全部季度" ||
                            item.season ===
                                seasonFilter.value;

                        return stateOk && seasonOk;
                    }
                );

            for (
                const item of
                this.filteredItems
            ) {
                const row =
                    list.createDiv();

                row.style.margin =
                    "5px 0";

                const checkbox =
                    row.createEl("input");

                checkbox.type =
                    "checkbox";

                checkbox.checked =
                    this.selected.has(
                        item.file.path
                    );

                checkbox.onchange = () => {
                    if (checkbox.checked) {
                        this.selected.add(
                            item.file.path
                        );
                    } else {
                        this.selected.delete(
                            item.file.path
                        );
                    }
                };

                row.createEl(
                    "span",
                    {
                        text:
                            " " +
                            item.name +
                            " [" +
                            item.state +
                            "] " +
                            item.season
                    }
                );
            }
        };

        stateFilter.onchange = render;
        seasonFilter.onchange = render;

        selectAll.onclick = () => {
            for (
                const item of
                this.filteredItems
            ) {
                this.selected.add(
                    item.file.path
                );
            }

            render();
        };

        clearAll.onclick = () => {
            this.selected.clear();
            render();
        };

        render();

        const submit =
            contentEl.createEl(
                "button",
                {
                    text: "执行修改"
                }
            );

        submit.style.marginTop =
            "14px";

        submit.onclick = async () => {
            if (this.selected.size === 0) {
                new Notice(
                    "请先选择动画。",
                    5000
                );
                return;
            }

            const selectedFiles =
                this.items
                    .filter((item) => {
                        return this.selected.has(
                            item.file.path
                        );
                    })
                    .map((item) => item.file);

            this.close();
            await this.onSubmit(
                status.value,
                selectedFiles
            );
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ManagerRibbonModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const {
            contentEl
        } = this;

        contentEl.empty();

        contentEl.createEl(
            "h2",
            {
                text: "Bangumi 追番管理器"
            }
        );

        contentEl.createEl(
            "p",
            {
                text:
                    "请选择要执行的操作。"
            }
        );

        this.addButton(
            contentEl,
            "导入单个动画",
            async () => {
                if (
                    typeof openSingleAnimeImport !==
                    "function"
                ) {
                    new Notice(
                        "单个动画导入模块尚未正确加载。",
                        8000
                    );
                    return;
                }

                this.close();

                await openSingleAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );

        this.addButton(
            contentEl,
            "批量导入动画",
            async () => {
                this.close();

                await openBatchAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );

        this.addButton(
            contentEl,
            "立即检查本地状态",
            async () => {
                this.close();

                await this.plugin
                    .checkAllLocalStatus(
                        true
                    );
            }
        );

        this.addButton(
            contentEl,
            "生成当前季度视图",
            async () => {
                this.close();

                await this.plugin
                    .runTemporarySeasonMode(
                        "current"
                    );
            }
        );

        this.addButton(
            contentEl,
            "选择季度视图清理",
            async () => {
                this.close();

                await this.plugin
                    .openSeasonViewCleanup();
            }
        );

        this.addButton(
            contentEl,
            "安全清理已完成季度视图",
            async () => {
                this.close();

                await this.plugin
                    .cleanCompletedSeasonViews(
                        true
                    );
            }
        );

        this.addButton(
            contentEl,
            "批量修改观看状态",
            async () => {
                this.close();

                await this.plugin
                    .openBatchStatusManager();
            }
        );
    }

    addButton(
        container,
        text,
        callback
    ) {
        const button =
            container.createEl(
                "button",
                {
                    text
                }
            );

        button.style.display =
            "block";

        button.style.width =
            "100%";

        button.style.margin =
            "8px 0";

        button.onclick = callback;
    }

    onClose() {
        this.contentEl.empty();
    }
}

class BangumiManagerSettingTab
    extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const container =
            this.containerEl;

        container.empty();

        container.createEl(
            "h2",
            {
                text: "Bangumi 追番管理器"
            }
        );

        if (
            this.plugin.settings.mode ===
            "lazy"
        ) {
            this.displayLazyMode(container);
        } else {
            this.displayProfessionalMode(
                container
            );
        }
    }

    displayLazyMode(container) {
        container.createEl(
            "p",
            {
                text:
                    "安装后先点击“初始化缺失文件”。之后插件会自动检查本地视频；需要时可在这里手动刷新。"
            }
        );

        new Setting(container)
            .setName("使用模式")
            .setDesc(
                "懒人模式隐藏不常用的高级路径设置。"
            )
            .addDropdown((dropdown) => {
                dropdown.addOptions({
                    lazy: "懒人模式",
                    professional: "专业模式"
                });

                dropdown.setValue("lazy");

                dropdown.onChange(async (value) => {
                    this.plugin.settings.mode =
                        value;

                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        this.addPathSetting(
            container,
            "动画笔记目录",
            "noteRootFolder",
            "动画笔记保存位置。修改后请点击“初始化缺失文件”。"
        );

        new Setting(container)
            .setName("本地动画根目录")
            .setDesc(
                "用于新功能默认路径提示，不会移动已有视频。"
            )
            .addText((text) => {
                text.setValue(
                    this.plugin.settings.localAnimeRoot
                );

                text.onChange(async (value) => {
                    this.plugin.settings.localAnimeRoot =
                        value.trim();

                    await this.plugin.saveSettings();
                });
            });

        this.addCheckSettings(container);

        this.addSeasonSettings(container);

        container.createEl(
            "h3",
            {
                text: "快速操作"
            }
        );

        new Setting(container)
            .setName("显示左侧管理按钮")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "打开后，Obsidian 左侧会显示一个 Bangumi 管理按钮，可从该按钮中选择相关命令执行。"
                    : "打开后，在 Obsidian 左侧显示统一管理入口，不为每个功能单独增加图标。"
            )
            .addToggle((toggle) => {
                toggle.setValue(
                    Boolean(
                        this.plugin.settings
                            .showManagerRibbon
                    )
                );

                toggle.onChange(async (value) => {
                    this.plugin.settings
                        .showManagerRibbon =
                        value;

                    await this.plugin.saveSettings();
                    this.plugin.refreshManagerRibbon();
                });
            });

        this.addLazyActions(container);
    }

    displayProfessionalMode(container) {
        container.createEl(
            "p",
            {
                text:
                    "专业模式允许调整仓库路径、检查策略和季度视图行为。修改路径后请点击“初始化缺失文件”。"
            }
        );

        new Setting(container)
            .setName("使用模式")
            .setDesc(
                "切换模式不会删除文件、笔记或动画库视图。"
            )
            .addDropdown((dropdown) => {
                dropdown.addOptions({
                    lazy: "懒人模式",
                    professional: "专业模式"
                });

                dropdown.setValue("professional");

                dropdown.onChange(async (value) => {
                    this.plugin.settings.mode =
                        value;

                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        this.addPathSetting(
            container,
            "动画笔记目录",
            "noteRootFolder",
            "扫描和管理 Bangumi 动画笔记的仓库目录。"
        );

        this.addPathSetting(
            container,
            "封面目录",
            "coverFolder",
            "本地封面保存目录。"
        );

        this.addPathSetting(
            container,
            "追番列表文件",
            "listFilePath",
            "追番列表 Markdown 文件路径。"
        );

        this.addPathSetting(
            container,
            "动画库文件",
            "baseFilePath",
            "动画库 Base 文件路径。"
        );

        new Setting(container)
            .setName("本地动画根目录")
            .setDesc(
                "用于默认路径提示，不会移动已有视频。"
            )
            .addText((text) => {
                text.setValue(
                    this.plugin.settings.localAnimeRoot
                );

                text.onChange(async (value) => {
                    this.plugin.settings.localAnimeRoot =
                        value.trim();

                    await this.plugin.saveSettings();
                });
            });

        this.addCheckSettings(container);
        this.addSeasonSettings(container);

        new Setting(container)
            .setName("显示左侧管理按钮")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "打开后，Obsidian 左侧会显示一个 Bangumi 管理按钮，可从该按钮中选择相关命令执行。"
                    : "打开后，在 Obsidian 左侧显示统一管理入口，不为每个功能单独增加图标。"
            )
            .addToggle((toggle) => {
                toggle.setValue(
                    Boolean(
                        this.plugin.settings
                            .showManagerRibbon
                    )
                );

                toggle.onChange(async (value) => {
                    this.plugin.settings
                        .showManagerRibbon =
                        value;

                    await this.plugin.saveSettings();
                    this.plugin.refreshManagerRibbon();
                });
            });

        container.createEl(
            "h3",
            {
                text: "快速操作"
            }
        );

        this.addProfessionalActions(container);
    }

    addCheckSettings(container) {
        new Setting(container)
            .setName("后台检查间隔")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "插件通常会自动检查；这里可以调整自动检查间隔。"
                    : "插件启动后、保存目标笔记后以及按照此间隔自动检查本地视频。"
            )
            .addText((text) => {
                text.setValue(
                    String(
                        this.plugin.settings
                            .checkIntervalSeconds
                    )
                );

                text.onChange(async (value) => {
                    this.plugin.settings
                        .checkIntervalSeconds =
                        Math.max(
                            10,
                            Number(value) || 60
                        );

                    await this.plugin.saveSettings();
                });
            });

        new Setting(container)
            .setName("启动时自动检查")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "打开 Obsidian 后自动检查一次。"
                    : "插件加载约 5 秒后检查全部目标笔记。"
            )
            .addToggle((toggle) => {
                toggle.setValue(
                    this.plugin.settings
                        .checkOnStartup
                );

                toggle.onChange(async (value) => {
                    this.plugin.settings
                        .checkOnStartup =
                        value;

                    await this.plugin.saveSettings();
                });
            });

        new Setting(container)
            .setName("保存笔记时自动检查")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "保存动画笔记后自动更新本地状态。"
                    : "修改目标目录中的动画笔记后，延迟约 1 秒检查该笔记。"
            )
            .addToggle((toggle) => {
                toggle.setValue(
                    this.plugin.settings.checkOnSave
                );

                toggle.onChange(async (value) => {
                    this.plugin.settings.checkOnSave =
                        value;

                    await this.plugin.saveSettings();
                });
            });
    }

    addSeasonSettings(container) {
        new Setting(container)
            .setName("季度视图策略")
            .setDesc(
                this.plugin.settings.mode ===
                    "lazy"
                    ? "默认不自动增加季度视图；需要时点击“生成当前季度视图”。"
                    : "只新增视图，不删除已有视图；“全部动画”始终保留。"
            )
            .addDropdown((dropdown) => {
                dropdown.addOptions({
                    none: "不自动创建",
                    current: "只自动创建当前季度",
                    all: "自动创建全部缺失季度"
                });

                dropdown.setValue(
                    this.plugin.settings.seasonViewMode ||
                    "none"
                );

                dropdown.onChange(async (value) => {
                    this.plugin.settings.seasonViewMode =
                        value;

                    await this.plugin.saveSettings();
                });
            });
    }

    addLazyActions(container) {
        this.addAction(
            container,
            "导入单个动画",
            "搜索 Bangumi，选择动画后自动创建笔记和本地封面。",
            async () => {
                await openSingleAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );
        this.addAction(
            container,
            "批量导入动画",
            "选择 Bangumi 用户列表后批量创建动画笔记；已有笔记可以自动跳过。",
            async () => {
                await openBatchAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );
        this.addAction(
            container,
            "初始化缺失文件",
            "按上方设置创建缺少的动画笔记目录、封面目录、追番列表文件和动画库文件；已有文件不会覆盖。",
            async () => {
                await this.plugin.initializeMissingFiles();
            }
        );

        this.addAction(
            container,
            "立即检查全部本地状态",
            "插件通常会自动检查；点击此处可以立即重新扫描全部动画的本地视频目录。",
            async () => {
                await this.plugin.checkAllLocalStatus(true);
            }
        );

        this.addAction(
            container,
            "生成当前季度视图",
            "只新增当前季度视图，不删除旧季度视图。",
            async () => {
                await this.runTemporarySeasonMode(
                    "current"
                );
            }
        );

        this.addAction(
            container,
            "选择季度视图清理",
            "勾选多个季度后一次删除；“全部动画”不会被删除。",
            async () => {
                await this.plugin.openSeasonViewCleanup();
            }
        );

        this.addAction(
            container,
            "安全清理已完成季度视图",
            "只删除动画库中的季度视图，不删除动画笔记、本地视频或本地文件夹；“已看”动画可直接视为完成，其他动画需要总集数、观看进度和本地视频均已完成。",
            async () => {
                await this.plugin.cleanCompletedSeasonViews(
                    true
                );
            }
        );

        this.addAction(
            container,
            "批量修改观看状态",
            "从动画列表中勾选多部动画后一次修改。",
            async () => {
                await this.plugin.openBatchStatusManager();
            }
        );
    }

    addProfessionalActions(container) {
        this.addAction(
            container,
            "导入单个动画",
            "搜索 Bangumi 并创建动画笔记；封面保存目录和本地动画根目录使用上方设置。",
            async () => {
                await openSingleAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );
        this.addAction(
            container,
            "批量导入动画",
            "从 Bangumi 用户的“已看”“想看”或“在看”列表读取作品，按当前路径设置创建笔记，并记录成功、跳过和失败结果。",
            async () => {
                await openBatchAnimeImport(
                    this.app,
                    this.plugin
                );
            }
        );
        this.addAction(
            container,
            "初始化缺失文件",
            "按当前路径设置创建缺少的目录、追番列表文件和动画库 Base 文件；已有文件不会覆盖。",
            async () => {
                await this.plugin.initializeMissingFiles();
            }
        );

        this.addAction(
            container,
            "立即检查全部本地状态",
            "立即扫描全部目标笔记，将视频数量与已观看集数比较，并写入本地更新状态。",
            async () => {
                await this.plugin.checkAllLocalStatus(true);
            }
        );

        this.addAction(
            container,
            "补齐全部缺失季度视图",
            "读取所有动画笔记，只新增缺失的季度视图，不删除已有视图。",
            async () => {
                const old =
                    this.plugin.settings.seasonViewMode;

                this.plugin.settings.seasonViewMode =
                    "all";

                await this.plugin.generateSeasonViews(
                    true
                );

                this.plugin.settings.seasonViewMode =
                    old;
            }
        );

        this.addAction(
            container,
            "生成当前季度视图",
            "按照电脑当前日期判断季度，只新增当前季度视图。",
            async () => {
                await this.runTemporarySeasonMode(
                    "current"
                );
            }
        );

        this.addAction(
            container,
            "选择季度视图清理",
            "以复选框选择季度视图后批量删除；不会删除“全部动画”。",
            async () => {
                await this.plugin.openSeasonViewCleanup();
            }
        );

        this.addAction(
            container,
            "安全清理已完成季度",
            "仅删除动画库 Base 中的季度视图，不删除动画笔记、本地视频或本地文件夹；状态为“已看”的动画直接视为完成，其他动画必须满足总集数已知、观看进度达标且本地视频数量达标。",
            async () => {
                await this.plugin.cleanCompletedSeasonViews(
                    true
                );
            }
        );

        this.addAction(
            container,
            "批量修改观看状态",
            "按状态和季度筛选动画，勾选后批量修改，不重建笔记。",
            async () => {
                await this.plugin.openBatchStatusManager();
            }
        );
    }

    addAction(
        container,
        name,
        description,
        callback
    ) {
        new Setting(container)
            .setName(name)
            .setDesc(description)
            .addButton((button) => {
                button.setButtonText("执行");
                button.onClick(callback);
            });
    }

    addPathSetting(
        container,
        name,
        key,
        description
    ) {
        new Setting(container)
            .setName(name)
            .setDesc(description)
            .addText((text) => {
                text.setValue(
                    this.plugin.settings[key]
                );

                text.onChange(async (value) => {
                    this.plugin.settings[key] =
                        value.trim();

                    await this.plugin.saveSettings();
                });
            });
    }

    async runTemporarySeasonMode(mode) {
        const old =
            this.plugin.settings.seasonViewMode;

        this.plugin.settings.seasonViewMode =
            mode;

        await this.plugin.generateSeasonViews(
            true
        );

        this.plugin.settings.seasonViewMode =
            old;
    }
}

function cleanValue(value) {
    return String(value || "")
        .replace(/`/g, "")
        .replace(/^["']|["']$/g, "")
        .trim();
}

function parseFrontmatter(content) {
    const match =
        String(content || "").match(
            /^---\r?\n([\s\S]*?)\r?\n---/
        );

    if (!match) {
        return null;
    }

    const fields = {};

    for (
        const line of
        match[1].split(/\r?\n/)
    ) {
        const index = line.indexOf(":");

        if (index < 0) {
            continue;
        }

        const key =
            line.slice(0, index).trim();

        let value =
            line.slice(index + 1).trim();

        if (
            value.length >= 2 &&
            (
                (
                    value.startsWith("\"") &&
                    value.endsWith("\"")
                ) ||
                (
                    value.startsWith("'") &&
                    value.endsWith("'")
                )
            )
        ) {
            value = value.slice(1, -1);
        }

        fields[key] = value;
    }

    return {
        full: match[0],
        body: match[1],
        fields
    };
}

function extractWatchedEpisodes(content) {
    const patterns = [
        /\*\*已观看集数\s*：\s*\*\*\s*(\d+(?:\.\d+)?)/,
        /\*\*已观看集数\s*:\s*\*\*\s*(\d+(?:\.\d+)?)/,
        /\*\*已观看集数\*\*\s*：\s*(\d+(?:\.\d+)?)/,
        /\*\*已观看集数\*\*\s*:\s*(\d+(?:\.\d+)?)/
    ];

    for (const pattern of patterns) {
        const match =
            String(content || "").match(
                pattern
            );

        if (match) {
            return Number(match[1]) || 0;
        }
    }

    return 0;
}

function inspectLocalFolder(
    downloadPath,
    watchedEpisodes
) {
    if (
        !downloadPath ||
        downloadPath === "无"
    ) {
        return {
            error: "无下载路径",
            downloadPath: "",
            fileCount: 0,
            newCount: 0
        };
    }

    if (!fs.existsSync(downloadPath)) {
        return {
            error: "文件夹不存在",
            downloadPath,
            fileCount: 0,
            newCount: 0
        };
    }

    const entries =
        fs.readdirSync(
            downloadPath,
            {
                withFileTypes: true
            }
        );

    const fileCount =
        entries.filter((entry) => {
            if (!entry.isFile()) {
                return false;
            }

            return VIDEO_EXTENSIONS.includes(
                path.extname(
                    entry.name
                ).toLowerCase()
            );
        }).length;

    return {
        error: null,
        downloadPath,
        fileCount,
        newCount: Math.max(
            0,
            fileCount - watchedEpisodes
        )
    };
}

function getLocalStatusText(result) {
    if (
        result.error === "无下载路径"
    ) {
        return "未设置下载路径";
    }

    if (
        result.error === "文件夹不存在"
    ) {
        return "文件夹不存在";
    }

    if (result.error) {
        return "检测失败";
    }

    if (result.newCount > 0) {
        return "已更新 " +
            result.newCount +
            " 集";
    }

    return "已同步";
}

function updateFrontmatterField(
    content,
    fieldName,
    fieldValue
) {
    const parsed =
        parseFrontmatter(content);

    if (!parsed) {
        return content;
    }

    const escapedName =
        fieldName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

    const fieldLine =
        fieldName +
        ': "' +
        String(fieldValue || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"") +
        '"';

    const pattern =
        new RegExp(
            "^" +
            escapedName +
            "\\s*:.*$",
            "m"
        );

    const newBody =
        pattern.test(parsed.body)
            ? parsed.body.replace(
                pattern,
                fieldLine
            )
            : parsed.body +
              "\n" +
              fieldLine;

    return content.replace(
        parsed.full,
        "---\n" +
        newBody +
        "\n---"
    );
}

function updateFolderLine(
    content,
    result
) {
    let folderLine;

    if (
        result.downloadPath &&
        !result.error
    ) {
        const normalized =
            result.downloadPath.replace(
                /\\/g,
                "/"
            );

        folderLine =
            "**本地文件夹**： " +
            "[打开本地动画文件夹](file:///" +
            encodeURI(normalized) +
            ")";
    } else {
        folderLine =
            "**本地文件夹**： 未设置";
    }

    const existing =
        /^\*\*本地文件夹\*\*：.*$/m;

    if (existing.test(content)) {
        return content.replace(
            existing,
            folderLine
        );
    }

    const watched =
        /^(\*\*已观看集数[^\n]*\n)/m;

    if (watched.test(content)) {
        return content.replace(
            watched,
            "$1" +
            folderLine +
            "\n"
        );
    }

    return content.trimEnd() +
        "\n\n" +
        folderLine +
        "\n";
}

function extractBaseViewNames(content) {
    const names = [];
    const lines =
        String(content || "")
            .split(/\r?\n/);

    let block = [];

    const flush = () => {
        if (!block.length) {
            return;
        }

        const text = block.join("\n");
        const match =
            text.match(
                /^\s*name:\s*(.+?)\s*$/m
            );

        if (match) {
            names.push(match[1].trim());
        }

        block = [];
    };

    for (const line of lines) {
        if (
            /^\s{2}-\s+type:\s+/.test(line)
        ) {
            flush();
            block = [line];
        } else if (block.length) {
            block.push(line);
        }
    }

    flush();

    return [...new Set(names)];
}

function removeBaseViews(
    content,
    shouldRemove
) {
    const lines =
        String(content || "")
            .split(/\r?\n/);

    const header = [];
    const blocks = [];
    let block = [];

    const flush = () => {
        if (block.length) {
            blocks.push(block.join("\n"));
            block = [];
        }
    };

    for (const line of lines) {
        if (
            /^\s{2}-\s+type:\s+/.test(line)
        ) {
            flush();
            block = [line];
        } else if (block.length) {
            block.push(line);
        } else {
            header.push(line);
        }
    }

    flush();

    const kept = [];
    let removedCount = 0;

    for (const current of blocks) {
        const match =
            current.match(
                /^\s*name:\s*(.+?)\s*$/m
            );

        const name =
            match ? match[1].trim() : "";

        if (
            name !== "全部动画" &&
            shouldRemove(name)
        ) {
            removedCount += 1;
        } else {
            kept.push(current);
        }
    }

    const newContent =
        header.join("\n") +
        (
            kept.length
                ? "\n" + kept.join("\n")
                : ""
        );

    return {
        content:
            newContent.trimEnd() + "\n",
        removedCount
    };
}

function hasBaseView(
    content,
    viewName
) {
    return extractBaseViewNames(content)
        .includes(viewName);
}

function appendSeasonView(
    content,
    seasonName
) {
    const match =
        seasonName.match(
            /^(\d{4})年(\d{2}月新番)$/
        );

    if (!match) {
        return content;
    }

    const block =
`  - type: cards
    name: ${seasonName}
    filters:
      and:
        - 开播年份 == "${match[1]}"
        - 开播季度 == "${match[2]}"
    groupBy:
      property: 本地更新状态
      direction: ASC
    order:
      - file.name
      - BGM评分
      - 制作公司
    image: note.cover
    imageAspectRatio: 1
    cardSize: 180
`;

    return content.trimEnd() +
        "\n" +
        block;
}

module.exports =
    BangumiManagerPlugin;
