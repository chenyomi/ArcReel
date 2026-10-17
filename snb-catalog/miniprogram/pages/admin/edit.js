const { loadCategories, loadAllProducts, callAdmin } = require("../../utils/catalog");

Page({
  data: {
    id: "",
    code: "",
    categories: [],
    categoryIndex: 0,
    price: "",
    sole: "",
    upper: "",
    sizes: "",
    pack: "",
    moq: "",
    note: "",
    published: true,
    images: [],
    removed: [],
    notice: "",
  },

  onLoad(query) {
    this.productId = query.id || "";
    this.fill();
  },

  async fill() {
    const categories = await loadCategories();
    const data = { categories };
    if (this.productId) {
      const products = await loadAllProducts();
      const product = products.find((item) => item.id === this.productId);
      if (!product) {
        this.setData({ notice: "没有这一款" });
        return;
      }
      const categoryIndex = Math.max(categories.findIndex((item) => item.id === product.categoryId), 0);
      Object.assign(data, {
        id: product.id,
        code: product.code,
        categoryIndex,
        price: product.price || "",
        sole: product.sole,
        upper: product.upper,
        sizes: product.sizes,
        pack: product.pack,
        moq: product.moq,
        note: product.note,
        published: product.published,
        images: product.images,
      });
    }
    this.setData(data);
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.key]: event.detail.value });
  },

  onCategory(event) {
    this.setData({ categoryIndex: Number(event.detail.value) });
  },

  onPublished(event) {
    this.setData({ published: (event.detail.value || []).includes("1") });
  },

  async addImages() {
    let chosen;
    try {
      chosen = wx.chooseMedia
      ? await wx.chooseMedia({ count: 9, mediaType: ["image"], sizeType: ["compressed"] })
      : await new Promise((resolve, reject) => {
          wx.chooseImage({
            count: 9,
            sizeType: ["compressed"],
            success: (result) => resolve({ tempFiles: result.tempFilePaths.map((path) => ({ tempFilePath: path })) }),
            fail: reject,
          });
        });
    const images = this.data.images.slice();
    for (const file of chosen.tempFiles) {
      const ext = (file.tempFilePath.match(/\.\w+$/) || [".jpg"])[0];
      const uploaded = await wx.cloud.uploadFile({
        cloudPath: `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
        filePath: file.tempFilePath,
      });
      images.push({ fileID: uploaded.fileID, url: uploaded.fileID });
    }
    this.setData({ images });
    } catch (error) {
      if (error && String(error.errMsg || "").includes("cancel")) return;
      this.setData({ notice: (error && (error.errMsg || error.message)) || "没有选到图" });
    }
  },

  removeImage(event) {
    const images = this.data.images.slice();
    const [removed] = images.splice(event.currentTarget.dataset.index, 1);
    this.setData({ images, removed: this.data.removed.concat(removed.fileID) });
  },

  async save() {
    const category = this.data.categories[this.data.categoryIndex];
    if (!category) {
      this.setData({ notice: "先写入分类" });
      return;
    }
    try {
      const saved = await callAdmin("saveProduct", {
        product: {
          id: this.data.id,
          code: this.data.code,
          categoryId: category.id,
          price: this.data.price,
          sole: this.data.sole,
          upper: this.data.upper,
          sizes: this.data.sizes,
          pack: this.data.pack,
          moq: this.data.moq,
          note: this.data.note,
          published: this.data.published,
          images: this.data.images.map((image) => image.fileID),
        },
      });
      if (this.data.removed.length) await callAdmin("deleteFiles", { fileIDs: this.data.removed });
      this.setData({ id: saved.id, removed: [], notice: "已保存" });
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },

  async remove() {
    const confirmed = await new Promise((resolve) => {
      wx.showModal({ title: "删除这款和它的图片？", success: (result) => resolve(result.confirm) });
    });
    if (!confirmed) return;
    await callAdmin("deleteProduct", { id: this.data.id });
    wx.navigateBack();
  },
});
