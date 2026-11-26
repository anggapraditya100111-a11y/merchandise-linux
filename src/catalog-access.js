const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { InputError } = require("./inventory");

const COOKIE = "axindo_catalog";
const LIFETIME = 24 * 60 * 60 * 1000;
const read = (key) => db.getDatabase().prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
function config() {
  return { enabled: read("catalog_gate") === "1", showQuantity: read("catalog_show_quantity") !== "0" };
}

function sign(value, key) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function secureCookie(req) {
  return Boolean(req.secure || process.env.COOKIE_SECURE === "true");
}

function issue(req, res, key) {
  const exp = String(Date.now() + LIFETIME);
  res.cookie(COOKIE, `${exp}.${sign(exp, key).toString("base64url")}`, { path: "/", maxAge: LIFETIME, sameSite: "strict", httpOnly: true, secure: secureCookie(req) });
}

function valid(token) {
  if (typeof token !== "string" || !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [exp, signature] = token.split(".");
  const key = read("catalog_key");
  if (!key || Number(exp) <= Date.now()) return false;
  const actual = Buffer.from(signature, "base64url");
  return actual.length === 32 && crypto.timingSafeEqual(actual, sign(exp, key));
}

async function unlock(req, res) {
  const phrase = req.body?.keyword;
  const hash = read("catalog_keyword");
  const key = read("catalog_key");
  if (typeof phrase !== "string" || Buffer.byteLength(phrase) > 72 || !key || !hash || !await bcrypt.compare(phrase, hash) || key !== read("catalog_key")) return false;
  issue(req, res, key);
  return true;
}

async function save({ enabled, keyword, showQuantity }) {
  if (typeof enabled !== "boolean" || typeof showQuantity !== "boolean" || (keyword != null && typeof keyword !== "string")) throw new InputError("Pengaturan akses katalog tidak valid.");
  const phrase = keyword || "";
  if (phrase && (phrase.length < 12 || Buffer.byteLength(phrase) > 72 || phrase !== phrase.trim())) throw new InputError("Kata kunci minimal 12 karakter, maksimal 72 byte, tanpa spasi di awal/akhir.");
  const hash = phrase ? await bcrypt.hash(phrase, 12) : null;
  const database = db.getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (enabled && !hash && !read("catalog_keyword")) throw new InputError("Isi kata kunci sebelum mengaktifkan akses terbatas.");
    const current = config();
    const write = database.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    if (hash) write.run("catalog_keyword", hash);
    if (hash || current.enabled !== enabled) write.run("catalog_key", crypto.randomBytes(32).toString("hex"));
    write.run("catalog_gate", enabled ? "1" : "0");
    write.run("catalog_show_quantity", showQuantity ? "1" : "0");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return config();
}

module.exports = { COOKIE, config, valid, unlock, save };
