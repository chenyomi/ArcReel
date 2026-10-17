const { loadAllProducts } = require("../../utils/catalog");

Page({
  data: { products: [] },

  onShow() {
    loadAllProducts()
      .then((products) => this.setData({ products }))
      .catch((error) => wx.showToast({ title: error.message, icon: "none" }));
  },

  create() {
    wx.navigateTo({ url: "/pages/admin/edit" });
  },

  open(event) {
    wx.navigateTo({ url: `/pages/admin/edit?id=${event.currentTarget.dataset.id}` });
  },
});
