const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"));
const DB_PATH = path.join(DATA_DIR, "merchandise.sqlite");

let database;

function ensureDirectories() {
  for (const directory of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function jakartaDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function getDatabase() {
  if (database) return database;
  ensureDirectories();
  database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return database;
}

function closeDatabase() {
  if (!database) return;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
    database = undefined;
  }
}

function initDatabase() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price >= 0),
      variant_label TEXT,
      variants_json TEXT NOT NULL DEFAULT '[]',
      image_filename TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_sequence (
      day TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      pop_id TEXT,
      pop_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      total INTEGER NOT NULL,
      pdf_token TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_label TEXT,
      variant_value TEXT,
      image_filename TEXT,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);

  const timestamp = nowIso();
  const adminCount = db.prepare("SELECT COUNT(*) AS total FROM admins").get().total;
  if (!adminCount) {
    const username = String(process.env.INITIAL_ADMIN_USERNAME || "admin").trim();
    const configuredPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "").trim();
    const password = configuredPassword || `Admin-${crypto.randomBytes(8).toString("hex")}Aa1`;
    db.prepare("INSERT INTO admins (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id("adm"), username, bcrypt.hashSync(password, 12), timestamp, timestamp);
    if (!configuredPassword) {
      console.log("============================================================");
      console.log("KREDENSIAL ADMIN AWAL AINET MERCHANDISE");
      console.log(`Username: ${username}`);
      console.log(`Password: ${password}`);
      console.log("Simpan password ini. Informasi hanya ditampilkan sekali.");
      console.log("============================================================");
    }
  }

  const popCount = db.prepare("SELECT COUNT(*) AS total FROM pops").get().total;
  if (!popCount) {
    const insert = db.prepare("INSERT INTO pops (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)");
    for (const name of ["Kantor Pusat", "PoP Jakarta", "PoP Bandung", "PoP Surabaya", "PoP Medan"]) {
      insert.run(id("pop"), name, timestamp, timestamp);
    }
  }

  const productCount = db.prepare("SELECT COUNT(*) AS total FROM products").get().total;
  if (!productCount) {
    const insert = db.prepare(`
      INSERT INTO products
        (id, sku, name, description, category, price, variant_label, variants_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const samples = [
      ["AIN-TS-001", "Kaos AINET Essential", "Kaos cotton combed untuk kegiatan internal dan lapangan.", "Kaos", 95000, "Ukuran", ["S", "M", "L", "XL", "XXL"]],
      ["AIN-SH-001", "Kemeja Lapangan AINET", "Kemeja kerja lengan panjang dengan bahan ringan.", "Baju", 185000, "Ukuran", ["S", "M", "L", "XL", "XXL"]],
      ["AIN-MUG-001", "Mug AINET", "Mug keramik untuk meja kerja dan ruang rapat.", "Aksesori", 45000, null, []],
      ["AIN-SHOE-001", "Sepatu Kerja Lapangan", "Sepatu kerja ringan untuk mobilitas teknisi.", "Sepatu", 325000, "Nomor sepatu", ["38", "39", "40", "41", "42", "43", "44"]],
    ];
    for (const sample of samples) {
      insert.run(id("prd"), ...sample.slice(0, 6), JSON.stringify(sample[6]), timestamp, timestamp);
    }
  }

  const setting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  setting.run("app_name", process.env.APP_NAME || "AINET Merchandise");
  setting.run("company_name", process.env.COMPANY_NAME || "PT Axindo Infinitas Network");
  return db;
}

function parseVariants(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function productRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    variantLabel: row.variant_label || null,
    variants: parseVariants(row.variants_json),
    imageUrl: row.image_filename ? `/uploads/${encodeURIComponent(row.image_filename)}` : null,
    imageFilename: row.image_filename || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProducts({ activeOnly = false } = {}) {
  const sql = `SELECT * FROM products${activeOnly ? " WHERE active = 1" : ""} ORDER BY active DESC, category, name`;
  return getDatabase().prepare(sql).all().map(productRow);
}

function getProduct(productId) {
  const row = getDatabase().prepare("SELECT * FROM products WHERE id = ?").get(productId);
  return row ? productRow(row) : null;
}

function saveProduct(input, productId = null) {
  const db = getDatabase();
  const timestamp = nowIso();
  const variants = Array.from(new Set((input.variants || []).map((value) => String(value).trim()).filter(Boolean)));
  const variantLabel = variants.length ? String(input.variantLabel || "Ukuran").trim() : null;
  if (productId) {
    const current = getProduct(productId);
    if (!current) return null;
    const imageFilename = input.imageFilename === undefined ? current.imageFilename : input.imageFilename;
    db.prepare(`
      UPDATE products SET sku = ?, name = ?, description = ?, category = ?, price = ?, variant_label = ?,
        variants_json = ?, image_filename = ?, active = ?, updated_at = ? WHERE id = ?
    `).run(input.sku, input.name, input.description, input.category, input.price, variantLabel,
      JSON.stringify(variants), imageFilename || null, input.active === false ? 0 : 1, timestamp, productId);
    return getProduct(productId);
  }
  const newId = id("prd");
  db.prepare(`
    INSERT INTO products
      (id, sku, name, description, category, price, variant_label, variants_json, image_filename, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(newId, input.sku, input.name, input.description, input.category, input.price, variantLabel,
    JSON.stringify(variants), input.imageFilename || null, timestamp, timestamp);
  return getProduct(newId);
}

function deactivateProduct(productId) {
  return getDatabase().prepare("UPDATE products SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), productId).changes > 0;
}

function listPops({ activeOnly = false } = {}) {
  const rows = getDatabase().prepare(`SELECT * FROM pops${activeOnly ? " WHERE active = 1" : ""} ORDER BY active DESC, name`).all();
  return rows.map((row) => ({ id: row.id, name: row.name, active: Boolean(row.active) }));
}

function addPop(name) {
  const timestamp = nowIso();
  const popId = id("pop");
  getDatabase().prepare("INSERT INTO pops (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)")
    .run(popId, name, timestamp, timestamp);
  return { id: popId, name, active: true };
}

function deactivatePop(popId) {
  return getDatabase().prepare("UPDATE pops SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), popId).changes > 0;
}

function getSettings() {
  const values = Object.fromEntries(getDatabase().prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
  return {
    appName: values.app_name || "AINET Merchandise",
    companyName: values.company_name || "PT Axindo Infinitas Network",
  };
}

function createOrder(input) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const pop = db.prepare("SELECT * FROM pops WHERE id = ? AND active = 1").get(input.popId);
    if (!pop) throw new Error("PoP tidak valid atau sudah tidak aktif.");

    const items = input.items.map((requested) => {
      const row = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(requested.productId);
      if (!row) throw new Error("Salah satu barang tidak tersedia.");
      const product = productRow(row);
      const variant = String(requested.variant || "").trim();
      if (product.variants.length && !product.variants.includes(variant)) {
        throw new Error(`Pilihan ${product.variantLabel || "varian"} untuk ${product.name} tidak valid.`);
      }
      if (!product.variants.length && variant) throw new Error(`${product.name} tidak memiliki pilihan ukuran/varian.`);
      const quantity = Number(requested.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Jumlah barang harus 1 sampai 99.");
      return { product, variant: variant || null, quantity, subtotal: product.price * quantity };
    });
    if (!items.length) throw new Error("Keranjang pesanan masih kosong.");
    if (items.length > 50) throw new Error("Terlalu banyak jenis barang dalam satu pesanan.");

    const day = jakartaDay();
    db.prepare(`
      INSERT INTO order_sequence (day, last_number) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET last_number = last_number + 1
    `).run(day);
    const sequence = db.prepare("SELECT last_number FROM order_sequence WHERE day = ?").get(day).last_number;
    const orderNumber = `MER-${day}-${String(sequence).padStart(4, "0")}`;
    const orderId = id("ord");
    const pdfToken = crypto.randomBytes(24).toString("hex");
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO orders (id, order_number, customer_name, pop_id, pop_name, whatsapp, total, pdf_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, orderNumber, input.customerName, pop.id, pop.name, input.whatsapp, total, pdfToken, createdAt);
    const insertItem = db.prepare(`
      INSERT INTO order_items
        (id, order_id, product_id, sku, product_name, variant_label, variant_value, image_filename, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(id("itm"), orderId, item.product.id, item.product.sku, item.product.name,
        item.product.variantLabel, item.variant, item.product.imageFilename, item.product.price, item.quantity, item.subtotal);
    }
    db.exec("COMMIT");
    return getOrderByNumber(orderNumber, { includeToken: true });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function orderItems(orderId) {
  return getDatabase().prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid").all(orderId).map((row) => ({
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    productName: row.product_name,
    variantLabel: row.variant_label || null,
    variant: row.variant_value || null,
    imageUrl: row.image_filename ? `/uploads/${encodeURIComponent(row.image_filename)}` : null,
    imageFilename: row.image_filename || null,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
    subtotal: Number(row.subtotal),
  }));
}

function orderRow(row, includeToken = false) {
  const result = {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    popId: row.pop_id,
    popName: row.pop_name,
    whatsapp: row.whatsapp,
    total: Number(row.total),
    createdAt: row.created_at,
    items: orderItems(row.id),
  };
  if (includeToken) result.pdfToken = row.pdf_token;
  return result;
}

function getOrderByNumber(orderNumber, { includeToken = false } = {}) {
  const row = getDatabase().prepare("SELECT * FROM orders WHERE order_number = ?").get(orderNumber);
  return row ? orderRow(row, includeToken) : null;
}

function listOrders() {
  return getDatabase().prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map((row) => orderRow(row));
}

function verifyPdfToken(orderNumber, token) {
  const row = getDatabase().prepare("SELECT pdf_token FROM orders WHERE order_number = ?").get(orderNumber);
  if (!row || !token) return false;
  const expected = Buffer.from(row.pdf_token);
  const supplied = Buffer.from(String(token));
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function findAdmin(username) {
  return getDatabase().prepare("SELECT * FROM admins WHERE username = ? COLLATE NOCASE").get(username);
}

function updateAdminPassword(adminId, passwordHash) {
  getDatabase().prepare("UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, nowIso(), adminId);
}

function createDatabaseBackup(destination) {
  getDatabase().exec("PRAGMA wal_checkpoint(FULL)");
  fs.copyFileSync(DB_PATH, destination);
}

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  BACKUP_DIR,
  DB_PATH,
  initDatabase,
  getDatabase,
  closeDatabase,
  createDatabaseBackup,
  listProducts,
  getProduct,
  saveProduct,
  deactivateProduct,
  listPops,
  addPop,
  deactivatePop,
  getSettings,
  createOrder,
  getOrderByNumber,
  listOrders,
  verifyPdfToken,
  findAdmin,
  updateAdminPassword,
};
