const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const db = require("./db");
const auth = require("./auth");
const { renderOrderPdf } = require("./pdf");
const { createFullBackup, restoreFullBackup } = require("./backup");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const RESTORE_TMP_DIR = path.resolve(process.env.RESTORE_TMP_DIR || path.join(ROOT, "restore-tmp"));
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION.txt"), "utf8").trim();
const PORT = Number(process.env.PORT || 8092);

for (const directory of [db.UPLOAD_DIR, db.BACKUP_DIR, RESTORE_TMP_DIR]) fs.mkdirSync(directory, { recursive: true });
db.initDatabase();

const app = express();
if (String(process.env.TRUST_PROXY || "false") === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      // CasaOS commonly exposes apps over plain HTTP on a local IP address.
      // Helmet enables this directive by default, which makes browsers rewrite
      // /styles.css and /app.js to HTTPS even when no HTTPS listener exists.
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());
app.use("/uploads", express.static(db.UPLOAD_DIR, { immutable: false, maxAge: "1h", dotfiles: "deny" }));
app.get("/theme.css", (_req, res) => {
  const settings = db.getSettings();
  res.type("text/css").set("Cache-Control", "no-store").send(`:root{--blue:${settings.primaryColor};--blue2:${settings.secondaryColor};--orange:${settings.accentColor}}`);
});
app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: 0 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });

const imageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, db.UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    callback(null, `${crypto.randomUUID()}${extensions[file.mimetype] || ""}`);
  },
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
const restoreUpload = multer({
  dest: RESTORE_TMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
});

function text(value, min, max, label) {
  const result = String(value || "").trim();
  if (result.length < min || result.length > max) throw new Error(`${label} harus ${min}-${max} karakter.`);
  return result;
}

function price(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 1_000_000_000) throw new Error("Harga tidak valid.");
  return result;
}

function whatsapp(value) {
  const result = String(value || "").trim();
  const digits = result.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) throw new Error("Nomor WhatsApp harus berisi 9-15 digit.");
  return result.startsWith("+") ? `+${digits}` : digits;
}

function variants(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function hexColor(value, label) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(result)) throw new Error(`${label} tidak valid.`);
  return result;
}

function categoryName(value) {
  const requested = text(value, 2, 60, "Kategori");
  const category = db.findCategoryByName(requested);
  if (!category) throw new Error("Kategori tidak tersedia.");
  return category.name;
}

function productInput(req) {
  return {
    sku: text(req.body.sku, 2, 40, "SKU"),
    name: text(req.body.name, 2, 120, "Nama barang"),
    description: String(req.body.description || "").trim().slice(0, 500),
    category: categoryName(req.body.category),
    price: price(req.body.price),
    variantLabel: String(req.body.variantLabel || "").trim().slice(0, 60),
    variants: variants(req.body.variants),
    imageFilenames: (req.files || []).map((file) => file.filename),
    removeImageIds: stringList(req.body.removeImageIds),
    active: String(req.body.active || "true") !== "false",
  };
}

function errorResponse(res, error, fallback = "Permintaan tidak dapat diproses.") {
  const message = error instanceof Error ? error.message : fallback;
  const known = /harus|maksimal|tidak valid|tidak tersedia|sudah|kosong|dikenali|integritas|path|PoP|barang|kategori|gambar|warna|catatan|UNIQUE/i.test(message);
  return res.status(known ? 400 : 500).json({ error: known ? message : fallback });
}

app.get("/api/health", (_req, res) => {
  try {
    const dbResult = db.getDatabase().prepare("SELECT 1 AS ok").get();
    res.json({ status: dbResult.ok === 1 ? "ok" : "error", version: VERSION, service: "ainet-merchandise" });
  } catch {
    res.status(503).json({ status: "error", version: VERSION });
  }
});

app.get("/api/catalog", (_req, res) => {
  res.json({ products: db.listProducts({ activeOnly: true }), pops: db.listPops({ activeOnly: true }), settings: db.getSettings() });
});
app.get("/api/settings", (_req, res) => res.json({ settings: db.getSettings() }));

app.post("/api/orders", orderLimiter, auth.rejectCrossSite, (req, res) => {
  try {
    const customerName = text(req.body.customerName, 2, 100, "Nama pemesan");
    const popId = text(req.body.popId, 4, 100, "PoP");
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const note = String(req.body.note || "").trim();
    if (note.length > 500) throw new Error("Catatan maksimal 500 karakter.");
    const order = db.createOrder({ customerName, popId, whatsapp: whatsapp(req.body.whatsapp), note, items });
    res.status(201).json({
      order,
      message: "Selanjutnya Anda dapat melakukan konfirmasi ke admin untuk pemesanan.",
      pdfUrl: `/api/orders/${encodeURIComponent(order.orderNumber)}/pdf?token=${encodeURIComponent(order.pdfToken)}`,
    });
  } catch (error) {
    errorResponse(res, error, "Pesanan gagal disimpan.");
  }
});

app.get("/api/orders/:number/pdf", (req, res) => {
  const admin = auth.verifyToken(req.cookies?.[auth.COOKIE_NAME]);
  if (!admin && !db.verifyPdfToken(req.params.number, req.query.token)) return res.status(403).json({ error: "Tautan PDF tidak valid." });
  const order = db.getOrderByNumber(req.params.number);
  if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
  renderOrderPdf(res, order, db.getSettings());
});

app.post("/api/admin/session", loginLimiter, auth.rejectCrossSite, (req, res) => {
  const admin = auth.authenticate(req.body.username, req.body.password);
  if (!admin) return res.status(401).json({ error: "Username atau password salah." });
  res.cookie(auth.COOKIE_NAME, auth.issueToken(admin), auth.cookieOptions());
  res.json({ admin: { username: admin.username } });
});

app.get("/api/admin/session", (req, res) => {
  const admin = auth.verifyToken(req.cookies?.[auth.COOKIE_NAME]);
  if (!admin) return res.status(401).json({ error: "Belum login." });
  res.json({ admin: { username: admin.username } });
});

app.delete("/api/admin/session", auth.rejectCrossSite, (_req, res) => {
  res.clearCookie(auth.COOKIE_NAME, { ...auth.cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

app.get("/api/admin/orders", auth.requireAdmin, (_req, res) => res.json({ orders: db.listOrders() }));
app.get("/api/admin/products", auth.requireAdmin, (_req, res) => res.json({ products: db.listProducts() }));
app.get("/api/admin/pops", auth.requireAdmin, (_req, res) => res.json({ pops: db.listPops() }));
app.get("/api/admin/categories", auth.requireAdmin, (_req, res) => res.json({ categories: db.listCategories() }));
app.get("/api/admin/settings", auth.requireAdmin, (_req, res) => res.json({ settings: db.getSettings() }));

app.post("/api/admin/products", auth.requireAdmin, auth.rejectCrossSite, imageUpload.array("images", 5), (req, res) => {
  try {
    res.status(201).json({ product: db.saveProduct(productInput(req)) });
  } catch (error) {
    for (const file of req.files || []) fs.rmSync(file.path, { force: true });
    errorResponse(res, error, "Barang gagal ditambahkan.");
  }
});

app.put("/api/admin/products/:id", auth.requireAdmin, auth.rejectCrossSite, imageUpload.array("images", 5), (req, res) => {
  try {
    const current = db.getProduct(req.params.id);
    if (!current) return res.status(404).json({ error: "Barang tidak ditemukan." });
    res.json({ product: db.saveProduct(productInput(req), req.params.id) });
  } catch (error) {
    for (const file of req.files || []) fs.rmSync(file.path, { force: true });
    errorResponse(res, error, "Barang gagal diperbarui.");
  }
});

app.delete("/api/admin/products/:id", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  if (!db.deactivateProduct(req.params.id)) return res.status(404).json({ error: "Barang tidak ditemukan." });
  res.status(204).end();
});

app.post("/api/admin/pops", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    res.status(201).json({ pop: db.addPop(text(req.body.name, 2, 100, "Nama PoP")) });
  } catch (error) {
    errorResponse(res, error, "PoP gagal ditambahkan.");
  }
});

app.put("/api/admin/pops/:id", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    const pop = db.updatePop(req.params.id, text(req.body.name, 2, 100, "Nama PoP"));
    if (!pop) return res.status(404).json({ error: "PoP tidak ditemukan." });
    res.json({ pop });
  } catch (error) {
    errorResponse(res, error, "PoP gagal diperbarui.");
  }
});

app.delete("/api/admin/pops/:id", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  if (!db.deactivatePop(req.params.id)) return res.status(404).json({ error: "PoP tidak ditemukan." });
  res.status(204).end();
});

app.post("/api/admin/categories", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    res.status(201).json({ category: db.addCategory(text(req.body.name, 2, 60, "Nama kategori")) });
  } catch (error) {
    errorResponse(res, error, "Kategori gagal ditambahkan.");
  }
});

app.put("/api/admin/categories/:id", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    const category = db.updateCategory(req.params.id, text(req.body.name, 2, 60, "Nama kategori"));
    if (!category) return res.status(404).json({ error: "Kategori tidak ditemukan." });
    res.json({ category });
  } catch (error) {
    errorResponse(res, error, "Kategori gagal diperbarui.");
  }
});

app.delete("/api/admin/categories/:id", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    if (!db.deleteCategory(req.params.id)) return res.status(404).json({ error: "Kategori tidak ditemukan." });
    res.status(204).end();
  } catch (error) {
    errorResponse(res, error, "Kategori gagal dihapus.");
  }
});

app.put("/api/admin/settings", auth.requireAdmin, auth.rejectCrossSite, imageUpload.single("logo"), (req, res) => {
  try {
    const input = {
      appName: text(req.body.appName, 2, 80, "Nama aplikasi"),
      companyName: text(req.body.companyName, 2, 120, "Nama perusahaan"),
      primaryColor: hexColor(req.body.primaryColor, "Warna utama"),
      secondaryColor: hexColor(req.body.secondaryColor, "Warna sekunder"),
      accentColor: hexColor(req.body.accentColor, "Warna aksen"),
    };
    if (req.file) input.logoFilename = req.file.filename;
    else if (String(req.body.removeLogo || "false") === "true") input.logoFilename = null;
    res.json({ settings: db.updateSettings(input) });
  } catch (error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    errorResponse(res, error, "Pengaturan gagal disimpan.");
  }
});

app.post("/api/admin/password", auth.requireAdmin, auth.rejectCrossSite, (req, res) => {
  try {
    const current = db.findAdmin(req.admin.username);
    if (!current || !bcrypt.compareSync(String(req.body.currentPassword || ""), current.password_hash)) {
      return res.status(400).json({ error: "Password saat ini salah." });
    }
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return res.status(400).json({ error: "Password baru minimal 12 karakter dan harus berisi huruf besar, huruf kecil, serta angka." });
    }
    db.updateAdminPassword(current.id, bcrypt.hashSync(newPassword, 12));
    res.json({ message: "Password admin berhasil diubah." });
  } catch (error) {
    errorResponse(res, error, "Password gagal diubah.");
  }
});

app.post("/api/admin/backup", auth.requireAdmin, auth.rejectCrossSite, async (_req, res) => {
  try {
    const backup = await createFullBackup();
    res.download(backup.path, backup.filename);
  } catch (error) {
    errorResponse(res, error, "Backup gagal dibuat.");
  }
});

app.post("/api/admin/restore", auth.requireAdmin, auth.rejectCrossSite, restoreUpload.single("backup"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Pilih file .merchbackup terlebih dahulu." });
  try {
    const result = await restoreFullBackup(req.file.path);
    res.json({ message: "Restore selesai. Data database dan gambar telah dipulihkan.", result });
  } catch (error) {
    errorResponse(res, error, "Restore gagal; data lama tetap dipertahankan.");
  }
});

app.get("/admin", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint tidak ditemukan." });
  res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Ukuran file terlalu besar." : "Upload file tidak valid." });
  console.error(error);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AINET Merchandise v${VERSION} aktif pada port ${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { app, server };
