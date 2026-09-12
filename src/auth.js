const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { DATA_DIR, findAdmin } = require("./db");

const COOKIE_NAME = "ainet_merch_admin";

function secret() {
  const configured = String(process.env.APP_SECRET || "").trim();
  if (configured) return Buffer.from(configured);
  const secretPath = path.join(DATA_DIR, ".app-secret");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(secretPath, "utf8").trim());
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function issueToken(admin) {
  const payload = Buffer.from(JSON.stringify({
    id: admin.id,
    username: admin.username,
    name: admin.name || admin.username,
    email: admin.email || "",
    authSource: admin.authSource || "LOCAL",
    role: "SUPER_ADMIN",
    exp: Date.now() + (12 * 60 * 60 * 1000),
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.id || !decoded.username || Number(decoded.exp) < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: String(process.env.COOKIE_SECURE || "false") === "true",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  };
}

function authenticate(username, password) {
  const admin = findAdmin(String(username || "").trim());
  if (!admin || !bcrypt.compareSync(String(password || ""), admin.password_hash)) return null;
  return {
    id: admin.id,
    username: admin.username,
    name: admin.username,
    email: "",
    authSource: "LOCAL",
    role: "SUPER_ADMIN",
  };
}

function requireAdmin(req, res, next) {
  const admin = verifyToken(req.cookies?.[COOKIE_NAME]);
  if (!admin) return res.status(401).json({ error: "Sesi admin tidak valid. Silakan login kembali." });
  req.admin = admin;
  next();
}

function rejectCrossSite(req, res, next) {
  const fetchSite = String(req.get("sec-fetch-site") || "");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return res.status(403).json({ error: "Permintaan lintas situs ditolak." });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  issueToken,
  verifyToken,
  cookieOptions,
  authenticate,
  requireAdmin,
  rejectCrossSite,
};
