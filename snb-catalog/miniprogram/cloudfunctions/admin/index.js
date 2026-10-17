const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const CATEGORIES = ["新款", "TPR新底", "飞织", "童鞋", "TPR底", "阿甘底", "板鞋", "气垫底", "TPR童鞋", "板鞋童鞋", "气垫底童鞋"];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const admins = String(process.env.ADMIN_OPENIDS || "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (event.action === "whoami") return { openid: OPENID, admin: admins.includes(OPENID) };
  if (!admins.includes(OPENID)) return { error: "没有权限" };

  try {
    if (event.action === "listProducts") return await listProducts();
    if (event.action === "seed") return await seed();
    if (event.action === "saveProduct") return await saveProduct(event.product || {});
    if (event.action === "deleteProduct") return await deleteProduct(event.id);
    if (event.action === "saveCategory") return await saveCategory(event.category || {});
    if (event.action === "deleteCategory") return await deleteCategory(event.id);
    if (event.action === "reorderCategories") return await reorderCategories(event.ids || []);
    if (event.action === "saveSite") return await saveSite(event.site || {});
    if (event.action === "deleteFiles") return await deleteFiles(event.fileIDs || []);
    return { error: "没有这个操作" };
  } catch (error) {
    return { error: error.message || "没有保存" };
  }
};

async function listProducts() {
  const result = await db.collection("products").limit(100).get();
  return { products: result.data };
}

async function seed() {
  const existing = await db.collection("categories").count();
  if (existing.total === 0) {
    for (let index = 0; index < CATEGORIES.length; index += 1) {
      await db.collection("categories").add({ data: { name: CATEGORIES[index], sort: index } });
    }
  }
  let hasSite = true;
  try {
    await db.collection("site").doc("main").get();
  } catch (error) {
    hasSite = false;
  }
  if (!hasSite) {
    await db.collection("site").doc("main").set({
      data: {
        company: "台州市新弹力鞋业有限公司",
        tagline: "出口型企业",
        phone1: "131-1687-8508",
        phone2: "139-5841-0856",
        wechat: "",
        address: "浙江省台州市温岭市五兴路与流庆路交叉口东北120米",
        latitude: null,
        longitude: null,
        about: "台州市新弹力鞋业有限公司，厂在温岭，工贸一体，做出口。\n款按鞋底和批次分，货号就是厂里的批次号。",
        heroFileID: "",
      },
    });
  }
  return { ok: true };
}

async function saveProduct(input) {
  const code = clean(input.code, 40);
  const categoryId = String(input.categoryId || "");
  if (!code) throw new Error("填写货号");
  const category = await db.collection("categories").doc(categoryId).get();
  const price = clean(input.price, 20);
  if (price && !/^\d+(\.\d{1,2})?$/.test(price)) throw new Error("价格只填数字，空着就是询价");
  const images = (Array.isArray(input.images) ? input.images : [])
    .map((fileID) => String(fileID || ""))
    .filter((fileID) => fileID.startsWith("cloud://"))
    .map((fileID) => ({ fileID }));
  const data = {
    code,
    categoryId,
    category: category.data.name,
    price,
    sole: clean(input.sole, 40),
    upper: clean(input.upper, 40),
    sizes: clean(input.sizes, 40),
    pack: clean(input.pack, 40),
    moq: clean(input.moq, 40),
    note: clean(input.note, 500),
    published: input.published !== false,
    images,
    updatedAt: db.serverDate(),
  };
  if (input.id) {
    await db.collection("products").doc(String(input.id)).update({ data });
    return { id: String(input.id) };
  }
  const created = await db.collection("products").add({ data: { ...data, createdAt: db.serverDate() } });
  return { id: created._id };
}

async function deleteProduct(id) {
  const doc = await db.collection("products").doc(String(id)).get();
  await deleteFiles((doc.data.images || []).map((image) => image.fileID));
  await db.collection("products").doc(String(id)).remove();
  return { ok: true };
}

async function saveCategory(input) {
  const name = clean(input.name, 20);
  if (!name) throw new Error("填写分类名");
  if (input.id) {
    await db.collection("categories").doc(String(input.id)).update({ data: { name } });
    const products = await db.collection("products").where({ categoryId: String(input.id) }).limit(100).get();
    await Promise.all(
      products.data.map((product) => db.collection("products").doc(product._id).update({ data: { category: name } })),
    );
    return { id: String(input.id) };
  }
  const count = await db.collection("categories").count();
  const created = await db.collection("categories").add({ data: { name, sort: count.total } });
  return { id: created._id };
}

async function deleteCategory(id) {
  const used = await db.collection("products").where({ categoryId: String(id) }).count();
  if (used.total > 0) throw new Error("这个分类下还有款");
  await db.collection("categories").doc(String(id)).remove();
  return { ok: true };
}

async function reorderCategories(ids) {
  for (let index = 0; index < ids.length; index += 1) {
    await db.collection("categories").doc(String(ids[index])).update({ data: { sort: index } });
  }
  return { ok: true };
}

async function saveSite(input) {
  const latitude = input.latitude === "" || input.latitude == null ? null : Number(input.latitude);
  const longitude = input.longitude === "" || input.longitude == null ? null : Number(input.longitude);
  if (latitude != null && !Number.isFinite(latitude)) throw new Error("纬度不对");
  if (longitude != null && !Number.isFinite(longitude)) throw new Error("经度不对");
  const heroFileID = String(input.heroFileID || "");
  await db.collection("site").doc("main").set({
    data: {
      company: clean(input.company, 80) || "台州市新弹力鞋业有限公司",
      tagline: clean(input.tagline, 40),
      phone1: clean(input.phone1, 30),
      phone2: clean(input.phone2, 30),
      wechat: clean(input.wechat, 40),
      address: clean(input.address, 120),
      latitude,
      longitude,
      about: clean(input.about, 2000),
      heroFileID: heroFileID.startsWith("cloud://") ? heroFileID : "",
    },
  });
  return { ok: true };
}

async function deleteFiles(fileIDs) {
  const fileList = (Array.isArray(fileIDs) ? fileIDs : []).map(String).filter((fileID) => fileID.startsWith("cloud://"));
  if (fileList.length > 0) await cloud.deleteFile({ fileList });
  return { ok: true };
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}
