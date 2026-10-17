const { loadCategories, loadProducts } = require("../../utils/catalog");

Page({
  data: { rail: [], products: [], shown: [], current: "all", query: "" },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const [categories, products] = await Promise.all([loadCategories(), loadProducts()]);
      const rail = [{ id: "all", name: "全部" }, ...categories];
      this.setData({ rail, products });
      this.apply();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  pick(event) {
    this.setData({ current: event.currentTarget.dataset.id });
    this.apply();
  },

  onQuery(event) {
    this.setData({ query: event.detail.value });
    this.apply();
  },

  apply() {
    const query = this.data.query.trim().toLowerCase();
    const shown = this.data.products.filter((product) => {
      const inCategory = this.data.current === "all" || product.categoryId === this.data.current;
      return inCategory && (!query || product.code.toLowerCase().includes(query));
    });
    this.setData({ shown });
  },

  open(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },
});
