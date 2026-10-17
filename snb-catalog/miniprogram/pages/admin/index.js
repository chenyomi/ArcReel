const { callAdmin } = require("../../utils/catalog");

Page({
  data: { loading: true, admin: false, openid: "", notice: "" },

  onShow() {
    this.check();
  },

  async check() {
    try {
      const me = await callAdmin("whoami");
      this.setData({ loading: false, admin: me.admin, openid: me.openid });
    } catch (error) {
      this.setData({ loading: false, notice: error.message });
    }
  },

  copy() {
    wx.setClipboardData({ data: this.data.openid });
  },

  go(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url });
  },

  async seed() {
    try {
      await callAdmin("seed");
      this.setData({ notice: "已写入。分类和电话可以再改。" });
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },
});
