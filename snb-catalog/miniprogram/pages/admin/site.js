const { loadSite, callAdmin } = require("../../utils/catalog");

Page({
  data: {
    company: "",
    tagline: "",
    phone1: "",
    phone2: "",
    wechat: "",
    address: "",
    latitude: "",
    longitude: "",
    about: "",
    heroFileID: "",
    previousHero: "",
    notice: "",
  },

  onShow() {
    loadSite().then((site) => {
      this.setData({
        company: site.company,
        tagline: site.tagline,
        phone1: site.phone1,
        phone2: site.phone2,
        wechat: site.wechat,
        address: site.address,
        latitude: site.latitude == null ? "" : String(site.latitude),
        longitude: site.longitude == null ? "" : String(site.longitude),
        about: site.about,
        heroFileID: site.heroImage,
        previousHero: site.heroImage,
      });
    });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.key]: event.detail.value });
  },

  async chooseHero() {
    let chosen;
    try {
      chosen = wx.chooseMedia
      ? await wx.chooseMedia({ count: 1, mediaType: ["image"], sizeType: ["compressed"] })
      : await new Promise((resolve, reject) => {
          wx.chooseImage({
            count: 1,
            sizeType: ["compressed"],
            success: (result) => resolve({ tempFiles: [{ tempFilePath: result.tempFilePaths[0] }] }),
            fail: reject,
          });
        });
    const file = chosen.tempFiles[0];
    const ext = (file.tempFilePath.match(/\.\w+$/) || [".jpg"])[0];
    const uploaded = await wx.cloud.uploadFile({
      cloudPath: `site/hero-${Date.now()}${ext}`,
      filePath: file.tempFilePath,
    });
    this.setData({ heroFileID: uploaded.fileID });
    } catch (error) {
      if (error && String(error.errMsg || "").includes("cancel")) return;
      this.setData({ notice: (error && (error.errMsg || error.message)) || "没有选到图" });
    }
  },

  async save() {
    try {
      await callAdmin("saveSite", {
        site: {
          company: this.data.company,
          tagline: this.data.tagline,
          phone1: this.data.phone1,
          phone2: this.data.phone2,
          wechat: this.data.wechat,
          address: this.data.address,
          latitude: this.data.latitude,
          longitude: this.data.longitude,
          about: this.data.about,
          heroFileID: this.data.heroFileID,
        },
      });
      if (this.data.previousHero && this.data.previousHero !== this.data.heroFileID) {
        await callAdmin("deleteFiles", { fileIDs: [this.data.previousHero] });
      }
      this.setData({ previousHero: this.data.heroFileID, notice: "已保存" });
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },
});
