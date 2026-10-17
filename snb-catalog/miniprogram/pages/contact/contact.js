const { loadSite, formatPhone, digits } = require("../../utils/catalog");

Page({
  data: { site: {}, phone1: "", phone2: "", canNav: false },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const site = await loadSite();
      this.setData({
        site,
        phone1: formatPhone(site.phone1),
        phone2: formatPhone(site.phone2),
        canNav: site.latitude != null && site.longitude != null,
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  call(event) {
    wx.makePhoneCall({ phoneNumber: digits(event.currentTarget.dataset.phone) });
  },

  openMap() {
    const site = this.data.site;
    wx.openLocation({
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      name: site.company,
      address: site.address,
      scale: 16,
    });
  },
});
