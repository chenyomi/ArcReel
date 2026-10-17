const { loadSite, loadProducts, formatPhone, digits } = require("../../utils/catalog");

Page({
  data: { site: {}, products: [], phone1: "", phone2: "" },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const [site, products] = await Promise.all([loadSite(), loadProducts()]);
      this.setData({
        site,
        products: products.slice(0, 4),
        phone1: formatPhone(site.phone1),
        phone2: formatPhone(site.phone2),
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  open(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  call(event) {
    wx.makePhoneCall({ phoneNumber: digits(event.currentTarget.dataset.phone) });
  },
});
