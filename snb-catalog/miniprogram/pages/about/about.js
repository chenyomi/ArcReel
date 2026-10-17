const { loadSite } = require("../../utils/catalog");

Page({
  data: { site: {} },

  onShow() {
    loadSite()
      .then((site) => this.setData({ site }))
      .catch((error) => wx.showToast({ title: error.message, icon: "none" }));
  },

  manage() {
    wx.navigateTo({ url: "/pages/admin/index" });
  },
});
