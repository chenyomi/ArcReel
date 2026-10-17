const { loadProducts } = require("../../utils/catalog");

Page({
  data: { products: [] },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const products = await loadProducts();
      this.setData({ products: products.slice(0, 40) });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  open(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },
});
