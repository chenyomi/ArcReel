App({
  onLaunch() {
    if (!wx.cloud) return;
    wx.cloud.init({ traceUser: true });
  },
});
