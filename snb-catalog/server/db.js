import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CATEGORIES = [
  "新款",
  "TPR新底",
  "飞织",
  "童鞋",
  "TPR底",
  "阿甘底",
  "板鞋",
  "气垫底",
  "TPR童鞋",
  "板鞋童鞋",
  "气垫底童鞋",
];

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      price TEXT NOT NULL DEFAULT '',
      sole TEXT NOT NULL DEFAULT '',
      upper_material TEXT NOT NULL DEFAULT '',
      sizes TEXT NOT NULL DEFAULT '',
      pack TEXT NOT NULL DEFAULT '',
      moq TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      published INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      file TEXT NOT NULL,
      sort INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company TEXT NOT NULL,
      tagline TEXT NOT NULL,
      phone1 TEXT NOT NULL,
      phone2 TEXT NOT NULL,
      wechat TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      about TEXT NOT NULL,
      hero_image TEXT NOT NULL DEFAULT ''
    );
  `);
  seed(db);
  return db;
}

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (Number(count) === 0) {
    const insert = db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)");
    CATEGORIES.forEach((name, index) => insert.run(name, index));
  }
  const site = db.prepare("SELECT id FROM site WHERE id = 1").get();
  if (!site) {
    db.prepare(`
      INSERT INTO site (
        id, company, tagline, phone1, phone2, wechat, address, latitude, longitude, about, hero_image
      ) VALUES (1, ?, ?, ?, ?, '', ?, NULL, NULL, ?, '')
    `).run(
      "台州市新弹力鞋业有限公司",
      "出口型企业",
      "131-1687-8508",
      "139-5841-0856",
      "浙江省台州市温岭市五兴路与流庆路交叉口东北120米",
      "台州市新弹力鞋业有限公司，厂在温岭，工贸一体，做出口。\n款按鞋底和批次分，货号就是厂里的批次号。",
    );
  }
}
