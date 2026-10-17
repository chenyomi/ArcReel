function database() {
  return wx.cloud.database();
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatPhone(value) {
  const raw = digits(value);
  if (raw.length === 11) return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
  return value || "";
}

function mapSite(doc) {
  if (!doc) {
    return {
      company: "",
      tagline: "",
      phone1: "",
      phone2: "",
      wechat: "",
      address: "",
      latitude: null,
      longitude: null,
      about: "",
      heroImage: "",
    };
  }
  return {
    company: doc.company || "",
    tagline: doc.tagline || "",
    phone1: doc.phone1 || "",
    phone2: doc.phone2 || "",
    wechat: doc.wechat || "",
    address: doc.address || "",
    latitude: doc.latitude == null ? null : doc.latitude,
    longitude: doc.longitude == null ? null : doc.longitude,
    about: doc.about || "",
    heroImage: doc.heroFileID || "",
  };
}

function mapProduct(doc) {
  const images = (doc.images || []).map((image) => ({
    id: image.fileID,
    url: image.fileID,
    fileID: image.fileID,
  }));
  return {
    id: doc._id,
    code: doc.code || "",
    categoryId: doc.categoryId || "",
    category: doc.category || "",
    price: doc.price || null,
    sole: doc.sole || "",
    upper: doc.upper || "",
    sizes: doc.sizes || "",
    pack: doc.pack || "",
    moq: doc.moq || "",
    note: doc.note || "",
    published: doc.published !== false,
    createdAt: doc.createdAt || 0,
    images,
  };
}

function time(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function loadSite() {
  try {
    const result = await database().collection("site").doc("main").get();
    return mapSite(result.data);
  } catch (error) {
    return mapSite(null);
  }
}

async function loadCategories() {
  const result = await database().collection("categories").limit(50).get();
  return result.data
    .map((item) => ({ id: item._id, name: item.name, sort: item.sort || 0 }))
    .sort((a, b) => a.sort - b.sort);
}

async function loadProducts() {
  const result = await database().collection("products").where({ published: true }).limit(100).get();
  return result.data.map(mapProduct).sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

async function loadAllProducts() {
  const result = await callAdmin("listProducts");
  return (result.products || []).map(mapProduct).sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

async function loadProduct(id) {
  const result = await database().collection("products").doc(id).get();
  const product = mapProduct(result.data);
  if (!product.published) {
    const me = await callAdmin("whoami");
    if (!me.admin) throw new Error("没有这一款");
  }
  return product;
}

function callAdmin(action, payload = {}) {
  return wx.cloud.callFunction({ name: "admin", data: { action, ...payload } }).then((result) => {
    const body = result.result || {};
    if (body.error) throw new Error(body.error);
    return body;
  });
}

module.exports = {
  digits,
  formatPhone,
  loadSite,
  loadCategories,
  loadProducts,
  loadAllProducts,
  loadProduct,
  callAdmin,
};
