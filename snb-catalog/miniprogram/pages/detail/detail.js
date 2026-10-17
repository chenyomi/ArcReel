const { loadProduct, loadSite, formatPhone, digits } = require("../../utils/catalog");

Page({
  data: { product: null, site: {}, specs: [], shot: 0, phone1: "" },

  onLoad(query) {
    this.id = query.id;
    this.load();
  },

  async load() {
    try {
      const [item, site] = await Promise.all([loadProduct(this.id), loadSite()]);
      const specs = [
        ["鞋底", item.sole],
        ["面料", item.upper],
        ["码段", item.sizes],
        ["装箱", item.pack],
        ["起订", item.moq],
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => ({ label, value }));
      wx.setNavigationBarTitle({ title: item.code });
      this.setData({
        product: item,
        site,
        specs,
        phone1: formatPhone(site.phone1),
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  onShot(event) {
    this.setData({ shot: event.detail.current });
  },

  pick(event) {
    this.setData({ shot: Number(event.currentTarget.dataset.index) });
  },

  preview(event) {
    wx.previewImage({
      current: event.currentTarget.dataset.src,
      urls: this.data.product.images.map((image) => image.url),
    });
  },

  call(event) {
    wx.makePhoneCall({ phoneNumber: digits(event.currentTarget.dataset.phone) });
  },

  copy() {
    const value = this.data.site.wechat || this.data.site.phone2;
    wx.setClipboardData({ data: String(value || "") });
  },

  onShareAppMessage() {
    const product = this.data.product;
    return {
      title: product ? product.code : "新弹力鞋业",
      path: `/pages/detail/detail?id=${this.id}`,
    };
  },
});
