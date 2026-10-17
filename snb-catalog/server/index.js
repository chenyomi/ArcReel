import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { passwordOk, readUser, signToken } from "./auth.js";
import { openDatabase } from "./db.js";

loadEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const PUBLIC_BASE = (process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const UPLOADS = path.join(DATA, "uploads");
const ADMIN_ROOT = path.join(ROOT, "public", "admin");
const PREVIEW_ROOT = path.join(ROOT, "public", "preview");

if (!process.env.ADMIN_PASSWORD) {
  console.error("缺少 ADMIN_PASSWORD。复制 .env.example 为 .env 后填写。");
  process.exit(1);
}

fs.mkdirSync(UPLOADS, { recursive: true });
const db = openDatabase(path.join(DATA, "snb.db"));

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const ALLOWED_ORIGINS = new Set([
  "https://admin.chenyomi.top",
  "https://api.chenyomi.top",
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

const server = http.createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    await route(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    sendJson(res, status, { error: status === 500 ? "服务器出错" : error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SNB catalog http://${HOST}:${PORT}`);
});

async function route(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && pathname === "/login") {
    const body = await readJson(req);
    if (!passwordOk(body.password)) fail(401, "密码不对");
    sendJson(res, 200, { token: signToken() });
    return;
  }
  if (req.method === "GET" && pathname === "/categories") {
    sendJson(res, 200, { categories: listCategories() });
    return;
  }
  if (req.method === "POST" && pathname === "/categories") {
    requireAuth(req);
    const body = await readJson(req);
    const name = clean(body.name, 20);
    if (!name) fail(400, "填写分类名");
    const sort = Number(db.prepare("SELECT COALESCE(MAX(sort), -1) AS n FROM categories").get().n) + 1;
    try {
      const result = db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)").run(name, sort);
      sendJson(res, 201, { category: categoryById(result.lastInsertRowid) });
    } catch {
      fail(400, "已有这个分类");
    }
    return;
  }
  if (req.method === "PUT" && pathname === "/categories/order") {
    requireAuth(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    const update = db.prepare("UPDATE categories SET sort = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index, id));
    sendJson(res, 200, { categories: listCategories() });
    return;
  }

  const categoryMatch = pathname.match(/^\/categories\/(\d+)$/);
  if (categoryMatch && req.method === "PATCH") {
    requireAuth(req);
    const body = await readJson(req);
    const name = clean(body.name, 20);
    if (!name) fail(400, "填写分类名");
    db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, Number(categoryMatch[1]));
    sendJson(res, 200, { category: categoryById(categoryMatch[1]) });
    return;
  }
  if (categoryMatch && req.method === "DELETE") {
    requireAuth(req);
    const id = Number(categoryMatch[1]);
    const used = db.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?").get(id).n;
    if (Number(used) > 0) fail(400, "这个分类下还有款");
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/products") {
    sendJson(res, 200, { products: listProducts(url, isAuthed(req)) });
    return;
  }
  if (req.method === "POST" && pathname === "/products") {
    requireAuth(req);
    const body = await readJson(req);
    const created = insertProduct(body);
    sendJson(res, 201, { product: productById(created, true) });
    return;
  }

  const imageMatch = pathname.match(/^\/products\/(\d+)\/images\/(\d+)$/);
  if (imageMatch && req.method === "DELETE") {
    requireAuth(req);
    deleteImage(Number(imageMatch[1]), Number(imageMatch[2]));
    sendJson(res, 200, { product: productById(imageMatch[1], true) });
    return;
  }

  const imagesMatch = pathname.match(/^\/products\/(\d+)\/images$/);
  if (imagesMatch && req.method === "POST") {
    requireAuth(req);
    const productId = Number(imagesMatch[1]);
    if (!productById(productId, true)) fail(404, "没有这一款");
    const file = await saveUpload(req);
    const sort = Number(
      db.prepare("SELECT COALESCE(MAX(sort), -1) AS n FROM product_images WHERE product_id = ?").get(productId).n,
    ) + 1;
    db.prepare("INSERT INTO product_images (product_id, file, sort) VALUES (?, ?, ?)").run(productId, file, sort);
    sendJson(res, 201, { product: productById(productId, true) });
    return;
  }

  const productMatch = pathname.match(/^\/products\/(\d+)$/);
  if (productMatch && req.method === "GET") {
    const authed = isAuthed(req);
    const product = productById(productMatch[1], authed);
    if (!product) fail(404, "没有这一款");
    sendJson(res, 200, { product });
    return;
  }
  if (productMatch && req.method === "PATCH") {
    requireAuth(req);
    updateProduct(Number(productMatch[1]), await readJson(req));
    sendJson(res, 200, { product: productById(productMatch[1], true) });
    return;
  }
  if (productMatch && req.method === "DELETE") {
    requireAuth(req);
    deleteProduct(Number(productMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/site") {
    sendJson(res, 200, { site: publicSite() });
    return;
  }
  if (req.method === "PUT" && pathname === "/site") {
    requireAuth(req);
    updateSite(await readJson(req));
    sendJson(res, 200, { site: publicSite() });
    return;
  }
  if (req.method === "POST" && pathname === "/site/hero") {
    requireAuth(req);
    const previous = db.prepare("SELECT hero_image FROM site WHERE id = 1").get().hero_image;
    const file = await saveUpload(req);
    db.prepare("UPDATE site SET hero_image = ? WHERE id = 1").run(file);
    removeUpload(previous);
    sendJson(res, 200, { site: publicSite() });
    return;
  }
  if (req.method === "DELETE" && pathname === "/site/hero") {
    requireAuth(req);
    const previous = db.prepare("SELECT hero_image FROM site WHERE id = 1").get().hero_image;
    db.prepare("UPDATE site SET hero_image = '' WHERE id = 1").run();
    removeUpload(previous);
    sendJson(res, 200, { site: publicSite() });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/uploads/")) {
    serveUpload(res, pathname.slice("/uploads/".length));
    return;
  }
  if (req.method === "GET" && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    serveStatic(res, ADMIN_ROOT, pathname.replace(/^\/admin\/?/, ""));
    return;
  }
  if (req.method === "GET" && (pathname === "/preview" || pathname.startsWith("/preview/"))) {
    serveStatic(res, PREVIEW_ROOT, pathname.replace(/^\/preview\/?/, ""));
    return;
  }
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(302, { Location: "/preview/" });
    res.end();
    return;
  }
  fail(404, "没有这个地址");
}

function listCategories() {
  return db
    .prepare("SELECT id, name, sort FROM categories ORDER BY sort ASC, id ASC")
    .all()
    .map((row) => ({ id: row.id, name: row.name, sort: row.sort }));
}

function categoryById(id) {
  const row = db.prepare("SELECT id, name, sort FROM categories WHERE id = ?").get(Number(id));
  if (!row) fail(404, "没有这个分类");
  return { id: row.id, name: row.name, sort: row.sort };
}

function listProducts(url, authed) {
  const category = url.searchParams.get("category");
  const query = (url.searchParams.get("q") || "").trim().replace(/[%_]/g, "");
  const newest = url.searchParams.get("order") === "new";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 80), 1), 80);
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE (? IS NULL OR p.category_id = ?)
         AND (? = 1 OR p.published = 1)
         AND (? = '' OR p.code LIKE ?)
       ORDER BY ${newest ? "p.created_at DESC, p.id DESC" : "p.sort DESC, p.id DESC"}
       LIMIT ?`,
    )
    .all(
      category ? Number(category) : null,
      category ? Number(category) : null,
      authed ? 1 : 0,
      query,
      `%${query}%`,
      limit,
    );
  return rows.map((row) => withImages(row));
}

function productById(id, authed) {
  const row = db
    .prepare(
      `SELECT p.*, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`,
    )
    .get(Number(id));
  if (!row || (!authed && row.published !== 1)) return null;
  return withImages(row);
}

function withImages(row) {
  const images = db
    .prepare("SELECT id, file FROM product_images WHERE product_id = ? ORDER BY sort ASC, id ASC")
    .all(row.id)
    .map((image) => ({ id: image.id, url: `${PUBLIC_BASE}/uploads/${image.file}` }));
  return {
    id: row.id,
    code: row.code,
    categoryId: row.category_id,
    category: row.category_name,
    price: row.price || null,
    sole: row.sole,
    upper: row.upper_material,
    sizes: row.sizes,
    pack: row.pack,
    moq: row.moq,
    note: row.note,
    published: row.published === 1,
    createdAt: row.created_at,
    images,
  };
}

function insertProduct(body) {
  const fields = productFields(body);
  const sort = Number(db.prepare("SELECT COALESCE(MAX(sort), 0) AS n FROM products").get().n) + 1;
  const result = db
    .prepare(
      `INSERT INTO products (
        code, category_id, price, sole, upper_material, sizes, pack, moq, note, published, sort, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.code,
      fields.categoryId,
      fields.price,
      fields.sole,
      fields.upper,
      fields.sizes,
      fields.pack,
      fields.moq,
      fields.note,
      fields.published,
      sort,
      new Date().toISOString(),
    );
  return result.lastInsertRowid;
}

function updateProduct(id, body) {
  if (!productById(id, true)) fail(404, "没有这一款");
  const fields = productFields(body);
  db.prepare(
    `UPDATE products SET
      code = ?, category_id = ?, price = ?, sole = ?, upper_material = ?,
      sizes = ?, pack = ?, moq = ?, note = ?, published = ?
     WHERE id = ?`,
  ).run(
    fields.code,
    fields.categoryId,
    fields.price,
    fields.sole,
    fields.upper,
    fields.sizes,
    fields.pack,
    fields.moq,
    fields.note,
    fields.published,
    id,
  );
}

function productFields(body) {
  const code = clean(body.code, 40);
  const categoryId = Number(body.categoryId);
  if (!code) fail(400, "填写货号");
  if (!db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) fail(400, "选一个分类");
  const price = clean(body.price, 20);
  if (price && !/^\d+(\.\d{1,2})?$/.test(price)) fail(400, "价格只填数字，空着就是询价");
  return {
    code,
    categoryId,
    price,
    sole: clean(body.sole, 40),
    upper: clean(body.upper, 40),
    sizes: clean(body.sizes, 40),
    pack: clean(body.pack, 40),
    moq: clean(body.moq, 40),
    note: clean(body.note, 500),
    published: body.published === false ? 0 : 1,
  };
}

function deleteProduct(id) {
  const images = db.prepare("SELECT file FROM product_images WHERE product_id = ?").all(id);
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  for (const image of images) removeUpload(image.file);
}

function deleteImage(productId, imageId) {
  const row = db.prepare("SELECT file FROM product_images WHERE id = ? AND product_id = ?").get(imageId, productId);
  if (!row) fail(404, "没有这张图");
  db.prepare("DELETE FROM product_images WHERE id = ?").run(imageId);
  removeUpload(row.file);
}

function publicSite() {
  const row = db.prepare("SELECT * FROM site WHERE id = 1").get();
  return {
    company: row.company,
    tagline: row.tagline,
    phone1: row.phone1,
    phone2: row.phone2,
    wechat: row.wechat,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    about: row.about,
    heroImage: row.hero_image ? `${PUBLIC_BASE}/uploads/${row.hero_image}` : "",
  };
}

function updateSite(body) {
  const latitude = body.latitude === "" || body.latitude == null ? null : Number(body.latitude);
  const longitude = body.longitude === "" || body.longitude == null ? null : Number(body.longitude);
  if (latitude != null && !Number.isFinite(latitude)) fail(400, "纬度不对");
  if (longitude != null && !Number.isFinite(longitude)) fail(400, "经度不对");
  db.prepare(
    `UPDATE site SET
      company = ?, tagline = ?, phone1 = ?, phone2 = ?, wechat = ?,
      address = ?, latitude = ?, longitude = ?, about = ?
     WHERE id = 1`,
  ).run(
    clean(body.company, 80) || "台州市新弹力鞋业有限公司",
    clean(body.tagline, 40),
    clean(body.phone1, 30),
    clean(body.phone2, 30),
    clean(body.wechat, 40),
    clean(body.address, 120),
    latitude,
    longitude,
    clean(body.about, 2000),
  );
}

async function saveUpload(req) {
  const type = req.headers["content-type"] || "";
  const parts = parseMultipart(await readRaw(req, 12 * 1024 * 1024), type);
  const file = parts.find((part) => part.filename && part.body.length > 0);
  if (!file) fail(400, "选择一张图片");
  const ext = sniff(file.body);
  if (!ext) fail(400, "只收 jpg、png、webp");
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(UPLOADS, name), file.body);
  return name;
}

function removeUpload(name) {
  if (!name) return;
  const file = safeUpload(name);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

function serveUpload(res, name) {
  const file = safeUpload(name);
  if (!file || !fs.existsSync(file)) fail(404, "没有这张图");
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": STATIC_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=2592000",
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, root, rel) {
  const cleanRel = rel.split("?")[0] || "index.html";
  const file = path.resolve(root, cleanRel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(root, "index.html");
    if (!fs.existsSync(index)) fail(404, "没有这个页面");
    sendFile(res, index);
    return;
  }
  sendFile(res, file);
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": STATIC_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function safeUpload(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  const file = path.resolve(UPLOADS, name);
  return file.startsWith(UPLOADS + path.sep) ? file : null;
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

function parseMultipart(buf, contentType) {
  const matched = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!matched) fail(400, "不是上传");
  const boundary = Buffer.from(`--${(matched[1] || matched[2]).trim()}`);
  const parts = [];
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    let part = buf.subarray(start + boundary.length, next);
    if (part.subarray(0, 2).equals(Buffer.from("\r\n"))) part = part.subarray(2);
    if (part.length >= 2 && part.subarray(-2).equals(Buffer.from("\r\n"))) part = part.subarray(0, -2);
    const sep = part.indexOf(Buffer.from("\r\n\r\n"));
    if (sep !== -1) {
      const header = part.subarray(0, sep).toString("utf8");
      parts.push({
        filename: /filename="([^"]*)"/.exec(header)?.[1] || "",
        body: part.subarray(sep + 4),
      });
    }
    start = next;
  }
  return parts;
}

function isAuthed(req) {
  return Boolean(readUser(req.headers.authorization));
}

function requireAuth(req) {
  if (!isAuthed(req)) fail(401, "请先登录");
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function readJson(req) {
  return readRaw(req, 1024 * 1024).then((buf) => {
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      fail(400, "内容不是 JSON");
    }
  });
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "内容太大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
