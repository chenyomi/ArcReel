const { loadCategories, callAdmin } = require("../../utils/catalog");

Page({
  data: { categories: [], draft: "", notice: "" },

  onShow() {
    this.reload();
  },

  async reload() {
    this.setData({ categories: await loadCategories(), notice: "" });
  },

  onName(event) {
    const categories = this.data.categories.slice();
    categories[event.currentTarget.dataset.index].name = event.detail.value;
    this.setData({ categories });
  },

  onDraft(event) {
    this.setData({ draft: event.detail.value });
  },

  async save(event) {
    const category = this.data.categories[event.currentTarget.dataset.index];
    try {
      await callAdmin("saveCategory", { category: { id: category.id, name: category.name } });
      this.setData({ notice: "已保存" });
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },

  async remove(event) {
    const category = this.data.categories[event.currentTarget.dataset.index];
    try {
      await callAdmin("deleteCategory", { id: category.id });
      await this.reload();
      this.setData({ notice: "已删除" });
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },

  async move(event) {
    const index = Number(event.currentTarget.dataset.index);
    const next = index + Number(event.currentTarget.dataset.step);
    if (next < 0 || next >= this.data.categories.length) return;
    const categories = this.data.categories.slice();
    [categories[index], categories[next]] = [categories[next], categories[index]];
    await callAdmin("reorderCategories", { ids: categories.map((item) => item.id) });
    this.setData({ categories });
  },

  async add() {
    try {
      await callAdmin("saveCategory", { category: { name: this.data.draft } });
      this.setData({ draft: "" });
      await this.reload();
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },
});
