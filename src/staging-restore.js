const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { restoreFullBackup } = require("./backup");

function anonymize(database, adminHash) {
  const timestamp = new Date().toISOString();
  database.exec("PRAGMA secure_delete=ON; BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM admins");
    database.prepare("INSERT INTO admins (id,username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(crypto.randomUUID(), "staging", adminHash, timestamp, timestamp);
    database.exec(`
      UPDATE orders SET customer_name='Pemesan uji ' || order_number,
        whatsapp='620000000000', note='', pdf_token=lower(hex(randomblob(24)));
      UPDATE work_orders SET vendor_name='Vendor uji', note='';
      UPDATE inventory_movements SET actor='Petugas uji', reference='', note='';
      DELETE FROM settings WHERE key IN ('catalog_keyword','catalog_key','catalog_gate');
    `);
    const set = database.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    set.run("app_name", "AXINDO Store – Staging");
    set.run("admin_whatsapp", "");
    set.run("public_base_url", "http://127.0.0.1:18092");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  database.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
}

async function importIsolated(input, { adminPassword, root }) {
  const resolvedRoot = path.resolve(root);
  const expected = ["data", "uploads", "backups", "restore"].map((subdir) => path.join(resolvedRoot, subdir));
  if (resolvedRoot === "/" || [db.DATA_DIR, db.UPLOAD_DIR, db.BACKUP_DIR, process.env.RESTORE_TMP_DIR].some((dir, index) => dir !== expected[index])) {
    throw new Error("Folder staging terisolasi tidak cocok. Restore dibatalkan.");
  }
  if (!/^[A-Za-z0-9]{16,72}$/.test(adminPassword || "")) throw new Error("Password staging tidak valid.");
  if (fs.existsSync(db.DB_PATH)) throw new Error("Database staging sudah ada; restore ulang tidak diizinkan.");
  await fsp.mkdir(expected[3], { recursive: true, mode: 0o700 });
  const inputDir = await fsp.mkdtemp(path.join(expected[3], "input-"));
  const file = path.join(inputDir, "snapshot.merchbackup");
  try {
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) return done(new Error("Paket backup melebihi batas 1 GB."));
      done(null, chunk);
    } });
    await pipeline(input, limit, fs.createWriteStream(file, { flags: "wx", mode: 0o600 }));
    const result = await restoreFullBackup(file);
    const database = db.getDatabase();
    anonymize(database, await bcrypt.hash(adminPassword, 12));
    const tables = ["products", "orders", "order_items", "work_orders", "work_order_orders", "product_images"];
    const counts = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
    return { sourceVersion: result.appVersion, counts };
  } finally {
    db.closeDatabase();
    await fsp.rm(inputDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    if (process.env.AXINDO_STORE_STAGING !== "1" || process.env.ACCESS_HANDOFF_ENABLED !== "false") throw new Error("Mode staging terisolasi belum disiapkan.");
    const result = await importIsolated(process.stdin, { root: "/app/staging", adminPassword: process.env.INITIAL_ADMIN_PASSWORD });
    console.log(JSON.stringify(result));
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { importIsolated };
