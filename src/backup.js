const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const archiver = require("archiver");
const unzipper = require("unzipper");
const {
  DATA_DIR,
  UPLOAD_DIR,
  BACKUP_DIR,
  DB_PATH,
  createDatabaseBackup,
  closeDatabase,
  initDatabase,
} = require("./db");

const RESTORE_TMP_DIR = path.resolve(process.env.RESTORE_TMP_DIR || path.join(__dirname, "..", "restore-tmp"));
const FORMAT = "ainet-merchandise-backup";

function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function createFullBackup() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  await fsp.mkdir(RESTORE_TMP_DIR, { recursive: true });
  const jobDir = await fsp.mkdtemp(path.join(RESTORE_TMP_DIR, "backup-"));
  const dbCopy = path.join(jobDir, "merchandise.sqlite");
  const filename = `merchandise-${stamp()}.merchbackup`;
  const target = path.join(BACKUP_DIR, filename);
  try {
    createDatabaseBackup(dbCopy);
    const manifest = {
      format: FORMAT,
      version: 1,
      appVersion: fs.readFileSync(path.join(__dirname, "..", "VERSION.txt"), "utf8").trim(),
      createdAt: new Date().toISOString(),
      database: "database/merchandise.sqlite",
      uploads: "uploads/",
    };
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target, { mode: 0o600 });
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
      archive.file(dbCopy, { name: "database/merchandise.sqlite" });
      if (fs.existsSync(UPLOAD_DIR)) archive.directory(UPLOAD_DIR, "uploads", (entry) => entry.name.startsWith(".") ? false : entry);
      archive.finalize();
    });
    return { filename, path: target };
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}

function safeEntryPath(root, entryPath) {
  const normalized = entryPath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error("Paket backup berisi path yang tidak aman.");
  }
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Paket backup berisi path di luar area restore.");
  return target;
}

async function extractSafely(zipPath, destination) {
  const directory = await unzipper.Open.file(zipPath);
  let total = 0;
  for (const entry of directory.files) {
    if (entry.type === "SymbolicLink") throw new Error("Paket backup tidak boleh berisi symbolic link.");
    total += Number(entry.uncompressedSize || 0);
    if (total > 1024 * 1024 * 1024) throw new Error("Ukuran paket backup melebihi batas 1 GB.");
    const target = safeEntryPath(destination, entry.path);
    if (entry.type === "Directory") {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(target, { mode: 0o600 }));
  }
}

async function moveDirectoryContents(source, destination, { exclude = [] } = {}) {
  await fsp.mkdir(destination, { recursive: true });
  const names = await fsp.readdir(source).catch(() => []);
  for (const name of names) {
    if (exclude.includes(name)) continue;
    await fsp.rename(path.join(source, name), path.join(destination, name));
  }
}

async function copyDirectoryContents(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const names = await fsp.readdir(source).catch(() => []);
  for (const name of names) {
    await fsp.cp(path.join(source, name), path.join(destination, name), { recursive: true, force: true, errorOnExist: false });
  }
}

async function restoreFullBackup(zipPath) {
  await fsp.mkdir(RESTORE_TMP_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const restoreId = crypto.randomUUID();
  const staging = path.join(RESTORE_TMP_DIR, `restore-${restoreId}`);
  const uploadRollbackName = `.restore-rollback-${restoreId}`;
  const uploadRollback = path.join(UPLOAD_DIR, uploadRollbackName);
  const databaseRollback = path.join(DATA_DIR, `.restore-rollback-${restoreId}.sqlite`);
  let uploadsSwapped = false;
  let databaseSwapped = false;
  try {
    await fsp.mkdir(staging, { recursive: true });
    await extractSafely(zipPath, staging);
    const manifestPath = path.join(staging, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("Manifest backup tidak ditemukan.");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (manifest.format !== FORMAT || Number(manifest.version) !== 1) throw new Error("Format backup tidak dikenali.");
    const stagedDb = safeEntryPath(staging, String(manifest.database || ""));
    if (!fs.existsSync(stagedDb) || (await fsp.stat(stagedDb)).size < 1024) throw new Error("Database di dalam backup tidak valid.");
    const probe = require("node:sqlite").DatabaseSync;
    const validationDb = new probe(stagedDb, { readOnly: true });
    const integrity = validationDb.prepare("PRAGMA quick_check").get();
    validationDb.close();
    if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("Pemeriksaan integritas database backup gagal.");

    closeDatabase();
    if (fs.existsSync(DB_PATH)) await fsp.copyFile(DB_PATH, databaseRollback);
    await fsp.copyFile(stagedDb, DB_PATH);
    databaseSwapped = true;

    await fsp.mkdir(uploadRollback, { recursive: true });
    await moveDirectoryContents(UPLOAD_DIR, uploadRollback, { exclude: [uploadRollbackName] });
    uploadsSwapped = true;
    const stagedUploads = path.join(staging, "uploads");
    if (fs.existsSync(stagedUploads)) await copyDirectoryContents(stagedUploads, UPLOAD_DIR);

    initDatabase();
    await fsp.rm(uploadRollback, { recursive: true, force: true });
    await fsp.rm(databaseRollback, { force: true });
    return { restoredAt: new Date().toISOString(), appVersion: manifest.appVersion || "unknown" };
  } catch (error) {
    closeDatabase();
    if (uploadsSwapped) {
      const current = (await fsp.readdir(UPLOAD_DIR).catch(() => [])).filter((name) => name !== uploadRollbackName);
      for (const name of current) await fsp.rm(path.join(UPLOAD_DIR, name), { recursive: true, force: true });
      await moveDirectoryContents(uploadRollback, UPLOAD_DIR);
      await fsp.rm(uploadRollback, { recursive: true, force: true });
    }
    if (databaseSwapped && fs.existsSync(databaseRollback)) await fsp.copyFile(databaseRollback, DB_PATH);
    await fsp.rm(databaseRollback, { force: true });
    initDatabase();
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

module.exports = { createFullBackup, restoreFullBackup, safeEntryPath };
