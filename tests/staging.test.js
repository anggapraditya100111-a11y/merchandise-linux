const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const candidate = path.join(__dirname, "..");
const source = process.env.AXINDO_STAGING_LEGACY_SOURCE || candidate;
const productionPassword = "FixtureOriginal98765";
const stagingPassword = "FixtureStaging12893";
const isolated = (root) => ({
  DATA_DIR: path.join(root, "data"), UPLOAD_DIR: path.join(root, "uploads"), BACKUP_DIR: path.join(root, "backups"),
  RESTORE_TMP_DIR: path.join(root, "restore"), NODE_PATH: path.join(candidate, "node_modules"),
});
function node(cwd, extra, script, input) {
  return execFileSync(process.execPath, ["-e", script], { cwd, env: { ...process.env, ...extra, NODE_NO_WARNINGS: "1" }, input, timeout: 12000, encoding: "utf8" });
}

test("restore staging menjaga relasi dan foto, tanpa memakai ulang akun, sesi, atau kontak produksi", { timeout: 22000 }, async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "axindo-store-staging-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = isolated(path.join(root, "original"));
  const stageRoot = path.join(root, "staging");
  const stage = isolated(stageRoot);
  const sourceVersion = (await fs.readFile(path.join(source, "VERSION.txt"), "utf8")).trim();
  const sample = JSON.parse(node(source, { ...original, INITIAL_ADMIN_USERNAME: "admin", INITIAL_ADMIN_PASSWORD: productionPassword }, `
    const fs = require("node:fs");
    const db = require("./src/db");
    const { createFullBackup } = require("./src/backup");
    (async () => {
      db.initDatabase();
      db.updateSettings({ adminWhatsapp: "628123123123", publicBaseUrl: "https://example.test" });
      const product = db.listProducts().find((p) => p.variants.length);
      const stamp = new Date().toISOString();
      const photo = "fixture-photo.png";
      db.getDatabase().prepare("INSERT INTO product_images (id,product_id,filename,position,created_at) VALUES (?,?,?,?,?)")
        .run("fixture-img", product.id, photo, 0, stamp);
      fs.writeFileSync(db.UPLOAD_DIR + "/" + photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ5cAAAAASUVORK5CYII=", "base64"));
      const make = (name) => db.createOrder({ customerName: name, popId: db.listPops()[0].id, whatsapp: "628122222222",
        note: "Catatan asli privat", items: [{ productId: product.id, variant: product.variants[0], quantity: 2 }] });
      const archived = make("Nama asli arsip");
      const active = make("Nama asli aktif");
      const work = db.createWorkOrder({ vendorName: "Nama vendor privat", note: "Dokumen privat", orderNumbers: [archived.orderNumber] });
      db.updateWorkOrderStatus(work.workOrderNumber, "DONE");
      const put = db.getDatabase().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
      for (const name of ["catalog_keyword","catalog_key","catalog_gate"]) put.run(name,"1");
      const snapshot = await createFullBackup();
      console.log(JSON.stringify({ snapshot: snapshot.path, archived: archived.orderNumber, pdfToken: archived.pdfToken, active: active.orderNumber, work: work.workOrderNumber, photo }));
      db.closeDatabase();
    })().catch((error) => { console.error(error); process.exitCode=1; });`));
  const bytes = await fs.readFile(sample.snapshot);
  const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
  const initial = hash(bytes);
  const imported = JSON.parse(node(candidate, { ...stage, STAGE_ROOT: stageRoot, STAGE_PASSWORD: stagingPassword }, `
    const { importIsolated } = require("./src/staging-restore");
    importIsolated(process.stdin, { root: process.env.STAGE_ROOT, adminPassword: process.env.STAGE_PASSWORD })
      .then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode=1; });`, bytes));
  assert.equal(imported.sourceVersion, sourceVersion);
  assert.deepEqual(imported.counts, { products: 4, orders: 2, order_items: 2, work_orders: 1, work_order_orders: 1, product_images: 1 });
  assert.equal(hash(await fs.readFile(sample.snapshot)), initial);
  assert.deepEqual(await fs.readFile(path.join(stage.UPLOAD_DIR, sample.photo)), await fs.readFile(path.join(original.UPLOAD_DIR, sample.photo)));
  const result = JSON.parse(node(candidate, { ...stage, ARCHIVED: sample.archived, ACTIVE: sample.active, PDF_TOKEN: sample.pdfToken, WORK: sample.work,
    STAGE_PASSWORD: stagingPassword, ORIGINAL_PASSWORD: productionPassword }, `
    const db = require("./src/db"), auth = require("./src/auth");
    const inventory = require("./src/inventory");
    const catalog = require("./src/catalog-access");
    db.initDatabase();
    const archived = db.getOrderByNumber(process.env.ARCHIVED);
    const active = db.getOrderByNumber(process.env.ACTIVE);
    const work = db.getWorkOrderByNumber(process.env.WORK);
    const product = db.getProduct(active.items[0].productId);
    const sale = db.createOrder({ customerName:"Tes pesanan lama", popId:db.listPops()[0].id, whatsapp:"620000000000",
      items:[{ productId: product.id, variant: product.variants[0], quantity:1 }] });
    console.log(JSON.stringify({ archived, active, work, sale, settings: db.getSettings(), gate: catalog.config().enabled,
      oldTokenAccepted: db.verifyPdfToken(archived.orderNumber, process.env.PDF_TOKEN),
      oldAdminAccepted: Boolean(auth.authenticate("admin",process.env.ORIGINAL_PASSWORD)),
      stagingAdminAccepted: Boolean(auth.authenticate("staging",process.env.STAGE_PASSWORD)),
      inventoryCount: inventory.report(db.getDatabase()).variants.length,
      violations: db.getDatabase().prepare("PRAGMA foreign_key_check").all() }));
    db.closeDatabase();`));
  assert.deepEqual([result.archived.status, result.active.status, result.work.status], ["DONE", "PROCESSING", "DONE"]);
  assert.equal(result.archived.workOrder.workOrderNumber, sample.work);
  assert.equal(result.work.orders[0].orderNumber, sample.archived);
  assert.equal(result.work.vendorName, "Vendor uji");
  assert.equal(result.work.note, "");
  assert.equal(result.sale.items[0].stock, null);
  assert.equal(result.inventoryCount, 0);
  assert.equal(result.settings.adminWhatsapp, "");
  assert.equal(result.settings.publicBaseUrl, "http://127.0.0.1:18092");
  assert.equal(result.archived.customerName, `Pemesan uji ${sample.archived}`);
  assert.equal(result.archived.note, "");
  assert.equal(result.archived.whatsapp, "620000000000");
  assert.deepEqual([result.gate, result.oldAdminAccepted, result.oldTokenAccepted, result.stagingAdminAccepted], [false, false, false, true]);
  assert.deepEqual(result.violations, []);
});
