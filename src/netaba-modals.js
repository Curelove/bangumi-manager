module.exports = function createNetabaModals({
  Modal,
  Notice,
  bangumiApi
}) {

  var NetabaNoteManagerModal = class extends Modal {
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
  
      this.modalEl.style.width = "min(760px, 90vw)";
      this.modalEl.style.maxWidth = "90vw";
      this.modalEl.style.maxHeight = "90vh";
      this.modalEl.style.overflowY = "auto";
  
      contentEl.createEl(
        "h2",
        {
          text: "批量管理 Netaba 评分图"
        }
      );
  
      contentEl.createEl(
        "p",
        {
          text: "\u53EF\u4EE5\u4E3A\u6CA1\u6709 Netaba \u8BC4\u5206\u56FE\u7684\u52A8\u753B\u7B14\u8BB0\u521B\u5EFA\u8BC4\u5206\u56FE\uFF0C\u4E5F\u53EF\u4EE5\u5220\u9664\u5DF2\u6709\u8BC4\u5206\u56FE\u3002\u5DF2\u6709\u8BC4\u5206\u56FE\u4E0D\u4F1A\u88AB\u91CD\u590D\u521B\u5EFA\uFF0C\u52A8\u753B\u4FE1\u606F\u3001\u4E2A\u4EBA\u603B\u7ED3\u548C\u5176\u4ED6\u7B14\u8BB0\u5185\u5BB9\u4E0D\u4F1A\u88AB\u4FEE\u6539\u3002"
        }
      );
  
      const actionLabel = contentEl.createEl(
        "p",
        {
          text: "\u64CD\u4F5C\uFF1A"
        }
      );
      actionLabel.style.marginBottom = "4px";
  
      const actionSelect = contentEl.createEl("select");
  
      actionSelect.createEl(
        "option",
        {
          text: "创建评分图",
          value: "add"
        }
      );
  
      actionSelect.createEl(
        "option",
        {
          text: "删除评分图",
          value: "delete"
        }
      );
  
      const controls = contentEl.createDiv();
      controls.style.marginTop = "12px";
  
      const selectAll = controls.createEl(
        "button",
        {
          text: "全选当前结果"
        }
      );
  
      const clearAll = controls.createEl(
        "button",
        {
          text: "清空选择"
        }
      );
  
      clearAll.style.marginLeft = "8px";
  
      const list = contentEl.createDiv();
      list.style.maxHeight = "380px";
      list.style.overflowY = "auto";
      list.style.marginTop = "12px";
      list.style.border = "1px solid var(--background-modifier-border)";
      list.style.padding = "8px";
  
      const render = () => {
        list.empty();
  
        for (const item of this.filteredItems) {
          const row = list.createDiv();
          row.style.margin = "6px 0";
  
          const checkbox = row.createEl("input");
          checkbox.type = "checkbox";
          checkbox.checked = this.selected.has(
            item.file.path
          );
  
          checkbox.onchange = () => {
            if (checkbox.checked) {
              this.selected.add(item.file.path);
            } else {
              this.selected.delete(item.file.path);
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
  
      selectAll.onclick = () => {
        for (const item of this.filteredItems) {
          this.selected.add(item.file.path);
        }
        render();
      };
  
      clearAll.onclick = () => {
        this.selected.clear();
        render();
      };
  
      render();
  
      const submit = contentEl.createEl(
        "button",
        {
          text: "执行处理"
        }
      );
      submit.style.marginTop = "14px";
  
      submit.onclick = async () => {
        if (this.selected.size === 0) {
          new Notice(
            "请先选择至少一篇动画笔记。",
            5e3
          );
          return;
        }
  
        const selectedFiles = this.items
          .filter((item) => {
            return this.selected.has(item.file.path);
          })
          .map((item) => item.file);
  
        if (actionSelect.value === "delete") {
          const confirmed = window.confirm(
            "\u786E\u5B9A\u8981\u5220\u9664\u6240\u9009\u7B14\u8BB0\u4E2D\u7684 Netaba \u8BC4\u5206\u56FE\u5417\uFF1F\n\n\u52A8\u753B\u4FE1\u606F\u3001\u4E2A\u4EBA\u603B\u7ED3\u548C\u5176\u4ED6\u5185\u5BB9\u4E0D\u4F1A\u88AB\u5220\u9664\u3002"
          );
  
          if (!confirmed) {
            return;
          }
        }
  
        if (actionSelect.value === "add") {
          const confirmed = window.confirm(
            "\u5C06\u4E3A\u6CA1\u6709 Netaba \u8BC4\u5206\u56FE\u7684\u7B14\u8BB0\u6DFB\u52A0\u8BC4\u5206\u56FE\u3002\u5DF2\u6709\u8BC4\u5206\u56FE\u4E0D\u4F1A\u91CD\u590D\u6DFB\u52A0\u3002\u662F\u5426\u7EE7\u7EED\uFF1F"
          );
  
          if (!confirmed) {
            return;
          }
        }
  
        this.close();
        await this.onSubmit(
          actionSelect.value,
          selectedFiles
        );
      };
    }
  
    onClose() {
      this.contentEl.empty();
    }
  };
  
  

  var NetabaPageSelectModal = class extends Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
    }
  
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
  
      this.modalEl.style.width = "min(520px, 90vw)";
      this.modalEl.style.maxWidth = "90vw";
  
      contentEl.createEl(
        "h2",
        {
          text: "切换 Netaba 页面"
        }
      );
  
      contentEl.createEl(
        "p",
        {
          text: "选择后可以应用到当前笔记，也可以保存为以后新建笔记的默认页面。"
        }
      );
  
      const pageSelect = contentEl.createEl("select");
      pageSelect.style.width = "100%";
      pageSelect.style.boxSizing = "border-box";
  
      pageSelect.createEl(
        "option",
        {
          text: "当前动画页面",
          value: "subject"
        }
      );
      pageSelect.createEl(
        "option",
        {
          text: "当季动画",
          value: "season"
        }
      );
      pageSelect.createEl(
        "option",
        {
          text: "评分趋势",
          value: "trending"
        }
      );
      pageSelect.createEl(
        "option",
        {
          text: "历史分布",
          value: "history"
        }
      );
      pageSelect.createEl(
        "option",
        {
          text: "个人评分",
          value: "user"
        }
      );
      pageSelect.createEl(
        "option",
        {
          text: "动画对比",
          value: "compare"
        }
      );
  
      pageSelect.value =
        this.plugin.settings.netabaDefaultPage || "subject";
  
      const saveButton = contentEl.createEl(
        "button",
        {
          text: "保存为新建笔记的默认页面"
        }
      );
      saveButton.style.marginTop = "14px";
  
      const applyButton = contentEl.createEl(
        "button",
        {
          text: "应用到当前打开的动画笔记"
        }
      );
      applyButton.style.marginTop = "8px";
  
      const browserButton = contentEl.createEl(
        "button",
        {
          text: "在浏览器打开当前选择的页面"
        }
      );
      browserButton.style.marginTop = "8px";
  
      saveButton.onclick = async () => {
        const page = pageSelect.value;
  
        if (
          page === "user" &&
          !/^\d+$/.test(
            String(this.plugin.settings.netabaUserId || "").trim()
          )
        ) {
          new Notice(
            "请先在插件设置中填写正确的 Bangumi 用户编号。",
            5000
          );
          return;
        }
  
        if (
          page === "compare" &&
          !this.plugin.settings.netabaCompareUrl
        ) {
          new Notice(
            "请先在插件设置中搜索并选择一部对比动画。",
            5000
          );
          return;
        }
  
        this.plugin.settings.netabaDefaultPage = page;
        await this.plugin.saveSettings();
  
        new Notice(
          "已保存 Netaba 默认页面。",
          4000
        );
      };
  
      applyButton.onclick = async () => {
        await this.plugin.applyNetabaPageToActiveNote(
          pageSelect.value
        );
      };
  
      browserButton.onclick = async () => {
        await this.plugin.openNetabaPageInBrowser(
          pageSelect.value
        );
      };
    }
  
    onClose() {
      this.contentEl.empty();
    }
  };
  
  

  var NetabaCompareSelectModal = class extends Modal {
    constructor(app, plugin, onSelected) {
      super(app);
      this.plugin = plugin;
      this.onSelected = onSelected;
      this.results = [];
    }
  
    onOpen() {
      const { contentEl } = this;
      contentEl.empty();
  
      this.modalEl.style.width = "min(720px, 90vw)";
      this.modalEl.style.maxWidth = "90vw";
      this.modalEl.style.maxHeight = "90vh";
      this.modalEl.style.overflowY = "auto";
  
      contentEl.createEl(
        "h2",
        {
          text: "选择 Netaba 对比动画"
        }
      );
  
      contentEl.createEl(
        "p",
        {
          text: "输入动画名称，搜索后选择一部动画作为实验功能中的对比对象。"
        }
      );
  
      const keywordInput = contentEl.createEl("input");
      keywordInput.type = "text";
      keywordInput.placeholder = "例如：葬送的芙莉莲";
      keywordInput.style.width = "100%";
      keywordInput.style.boxSizing = "border-box";
  
      const searchButton = contentEl.createEl(
        "button",
        {
          text: "搜索动画"
        }
      );
      searchButton.style.marginTop = "10px";
  
      const resultList = contentEl.createDiv();
      resultList.style.marginTop = "12px";
      resultList.style.maxHeight = "45vh";
      resultList.style.overflowY = "auto";
  
      const detailArea = contentEl.createDiv();
      detailArea.style.marginTop = "14px";
  
      const search = async () => {
        const keyword = keywordInput.value.trim();
  
        if (!keyword) {
          new Notice(
            "请先输入动画名称。",
            5000
          );
          return;
        }
  
        searchButton.disabled = true;
        searchButton.textContent = "正在搜索……";
        resultList.empty();
        detailArea.empty();
  
        try {
          this.results = await bangumiApi.searchBangumi(keyword);
  
          if (this.results.length === 0) {
            resultList.createEl(
              "p",
              {
                text: "没有找到动画结果，请尝试其他名称。"
              }
            );
            return;
          }
  
          for (const result of this.results) {
            const resultButton = resultList.createEl("button");
  
            resultButton.style.display = "block";
            resultButton.style.width = "100%";
            resultButton.style.height = "auto";
            resultButton.style.minHeight = "38px";
            resultButton.style.boxSizing = "border-box";
            resultButton.style.padding = "8px 12px";
            resultButton.style.margin = "6px 0";
            resultButton.style.textAlign = "left";
            resultButton.style.whiteSpace = "normal";
            resultButton.style.overflowWrap = "anywhere";
            resultButton.style.wordBreak = "break-word";
            resultButton.style.lineHeight = "1.45";
  
            resultButton.textContent =
              result.title +
              (result.description ? "  " + result.description : "");
  
            resultButton.onclick = async () => {
              await this.selectResult(result, detailArea);
            };
          }
        } catch (error) {
          console.error(
            "搜索 Netaba 对比动画失败:",
            error
          );
  
          resultList.createEl(
            "p",
            {
              text: "搜索失败，请检查网络连接或 Bangumi 访问状态。"
            }
          );
        } finally {
          searchButton.disabled = false;
          searchButton.textContent = "搜索动画";
        }
      };
  
      searchButton.onclick = search;
  
      keywordInput.onkeydown = (event) => {
        if (event.key === "Enter") {
          search();
        }
      };
    }
  
    async selectResult(result, detailArea) {
      detailArea.empty();
  
      detailArea.createEl(
        "p",
        {
          text: "正在读取动画信息……"
        }
      );
  
      try {
        const info = await bangumiApi.getAnimeDetail(result.url);
  
        if (!info || !info.subjectId) {
          detailArea.empty();
          detailArea.createEl(
            "p",
            {
              text: "无法读取这部动画的信息。"
            }
          );
          return;
        }
  
        detailArea.empty();
  
        detailArea.createEl(
          "h3",
          {
            text: "已选择：《" + (info.CN || result.title) + "》"
          }
        );
  
        detailArea.createEl(
          "p",
          {
            text:
              "日文名：" + (info.JP || "未知") +
              "\n开播日期：" + (info.date || "未知") +
              "\nBGM评分：" + (info.rating || "未知")
          }
        );
  
        const selectButton = detailArea.createEl(
          "button",
          {
            text: "保存此动画"
          }
        );
  
        selectButton.style.marginTop = "10px";
  
        selectButton.onclick = async () => {
          selectButton.disabled = true;
          selectButton.textContent = "正在保存……";
  
          this.plugin.settings.netabaCompareUrl = result.url;
          this.plugin.settings.netabaCompareTitle =
            info.CN || info.JP || result.title;
  
          await this.plugin.saveSettings();
  
          new Notice(
            "已保存对比动画：" +
            this.plugin.settings.netabaCompareTitle,
            5000
          );
  
          this.close();
  
          if (this.onSelected) {
            this.onSelected();
          }
        };
      } catch (error) {
        console.error(
          "读取对比动画信息失败:",
          error
        );
  
        detailArea.empty();
  
        detailArea.createEl(
          "p",
          {
            text: "读取动画信息失败，请稍后重试。"
          }
        );
      }
    }
  
    onClose() {
      this.contentEl.empty();
    }
  };
  
  

  return {
    NetabaNoteManagerModal,
    NetabaPageSelectModal,
    NetabaCompareSelectModal
  };
};
