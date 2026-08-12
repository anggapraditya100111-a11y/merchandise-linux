const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { safeEntryPath } = require("../src/backup");

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server berhenti dengan kode ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server tidak siap dalam batas waktu.");
}

test("path restore menolak traversal dan path absolut", () => {
  const root = path.resolve(os.tmpdir(), "ainet-safe-root");
  assert.throws(() => safeEntryPath(root, "../secret"), /tidak aman|di luar/);
  assert.throws(() => safeEntryPath(root, "/etc/passwd"), /tidak aman|di luar/);
  assert.equal(safeEntryPath(root, "uploads/product.jpg"), path.join(root, "uploads/product.jpg"));
});

test("migrasi database lama menambahkan galeri, kategori, pengaturan, dan catatan", { timeout: 15_000 }, async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ainet-merch-migration-"));
  const dataDir = path.join(root, "data");
  const uploadDir = path.join(root, "uploads");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, "legacy.png"), Buffer.from("legacy-image"));
  const dbPath = path.join(dataDir, "merchandise.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE products (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, price INTEGER NOT NULL,
      variant_label TEXT, variants_json TEXT NOT NULL DEFAULT '[]', image_filename TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL,
      pop_id TEXT, pop_name TEXT NOT NULL, whatsapp TEXT NOT NULL, total INTEGER NOT NULL,
      pdf_token TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO products VALUES ('prd_legacy', 'LEGACY-001', 'Barang Lama', 'Data sebelum update', 'Kategori Lama', 10000, NULL, '[]', 'legacy.png', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  const port = 19501 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: uploadDir,
      BACKUP_DIR: path.join(root, "backups"), RESTORE_TMP_DIR: path.join(root, "restore"),
      APP_SECRET: "migration-test-secret-with-more-than-sixty-four-characters-1234567890",
      INITIAL_ADMIN_PASSWORD: "AdminPassword123", NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);
  const catalog = await fetch(`${base}/api/catalog`).then((response) => response.json());
  const migratedProduct = catalog.products.find((product) => product.id === "prd_legacy");
  assert.equal(migratedProduct.images.length, 1);
  assert.equal(migratedProduct.images[0].url, "/uploads/legacy.png");
  assert.ok(catalog.settings.primaryColor);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));

  const migrated = new DatabaseSync(dbPath, { readOnly: true });
  assert.ok(migrated.prepare("PRAGMA table_info(orders)").all().some((column) => column.name === "note"));
  assert.equal(migrated.prepare("SELECT COUNT(*) AS total FROM categories WHERE name = 'Kategori Lama'").get().total, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS total FROM product_images WHERE product_id = 'prd_legacy'").get().total, 1);
  migrated.close();
});

test("alur katalog, order, PDF, admin, backup dan restore", { timeout: 30_000 }, async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ainet-merch-test-"));
  const port = 19000 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: path.join(root, "data"),
      UPLOAD_DIR: path.join(root, "uploads"),
      BACKUP_DIR: path.join(root, "backups"),
      RESTORE_TMP_DIR: path.join(root, "restore"),
      APP_SECRET: "integration-test-secret-with-more-than-sixty-four-characters-1234567890",
      INITIAL_ADMIN_USERNAME: "admin",
      INITIAL_ADMIN_PASSWORD: "AdminPassword123",
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  context.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const pageResponse = await fetch(`${base}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type"), /text\/html/);
  assert.doesNotMatch(pageResponse.headers.get("content-security-policy") || "", /upgrade-insecure-requests/);

  const styleResponse = await fetch(`${base}/styles.css`);
  assert.equal(styleResponse.status, 200);
  assert.match(styleResponse.headers.get("content-type"), /text\/css/);

  const scriptResponse = await fetch(`${base}/app.js`);
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get("content-type"), /javascript/);

  const catalogResponse = await fetch(`${base}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.ok(catalog.products.length >= 4);
  assert.ok(catalog.pops.length >= 1);
  const shirt = catalog.products.find((product) => product.variants.length);

  const invalidOrder = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ customerName: "Budi", popId: catalog.pops[0].id, whatsapp: "081234567890", items: [{ productId: shirt.id, variant: "TIDAK-ADA", quantity: 1 }] }),
  });
  assert.equal(invalidOrder.status, 400);

  const longNoteOrder = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ customerName: "Budi", popId: catalog.pops[0].id, whatsapp: "081234567890", note: "x".repeat(501), items: [{ productId: shirt.id, variant: shirt.variants[0], quantity: 1 }] }),
  });
  assert.equal(longNoteOrder.status, 400);

  const orderResponse = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ customerName: "Budi Santoso", popId: catalog.pops[0].id, whatsapp: "081234567890", note: "Mohon dikirim bersama perlengkapan PoP.", items: [{ productId: shirt.id, variant: shirt.variants[0], quantity: 2 }] }),
  });
  assert.equal(orderResponse.status, 201);
  const orderData = await orderResponse.json();
  assert.match(orderData.order.orderNumber, /^MER-\d{8}-\d{4}$/);
  assert.equal(orderData.order.items[0].variant, shirt.variants[0]);
  assert.equal(orderData.order.total, shirt.price * 2);
  assert.equal(orderData.order.note, "Mohon dikirim bersama perlengkapan PoP.");
  assert.match(orderData.message, /konfirmasi ke admin/i);

  const pdfResponse = await fetch(`${base}${orderData.pdfUrl}`);
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get("content-type"), /application\/pdf/);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");

  const loginResponse = await fetch(`${base}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username: "admin", password: "AdminPassword123" }),
  });
  assert.equal(loginResponse.status, 200, stderr);
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];

  const categoriesResponse = await fetch(`${base}/api/admin/categories`, { headers: { cookie } });
  assert.equal(categoriesResponse.status, 200);
  assert.ok((await categoriesResponse.json()).categories.some((category) => category.name === "Kaos"));

  const categoryCreateResponse = await fetch(`${base}/api/admin/categories`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "Perlengkapan Tes" }),
  });
  assert.equal(categoryCreateResponse.status, 201);
  const createdCategory = (await categoryCreateResponse.json()).category;

  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPx8AAAAASUVORK5CYII=", "base64");
  const productForm = new FormData();
  productForm.set("sku", "AIN-TEST-005");
  productForm.set("name", "Produk Galeri Tes");
  productForm.set("description", "Produk untuk menguji galeri lima foto.");
  productForm.set("category", createdCategory.name);
  productForm.set("price", "125000");
  productForm.set("variantLabel", "Ukuran");
  productForm.set("variants", "S, M, L");
  for (let index = 1; index <= 5; index += 1) productForm.append("images", new Blob([imageBytes], { type: "image/png" }), `foto-${index}.png`);
  const productCreateResponse = await fetch(`${base}/api/admin/products`, {
    method: "POST",
    headers: { cookie, "sec-fetch-site": "same-origin" },
    body: productForm,
  });
  assert.equal(productCreateResponse.status, 201, await productCreateResponse.clone().text());
  const createdProduct = (await productCreateResponse.json()).product;
  assert.equal(createdProduct.images.length, 5);
  assert.equal(createdProduct.imageUrl, createdProduct.images[0].url);

  const renameUsedCategory = await fetch(`${base}/api/admin/categories/${createdCategory.id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "Perlengkapan Tes Baru" }),
  });
  assert.equal(renameUsedCategory.status, 200);
  assert.equal((await fetch(`${base}/api/admin/products`, { headers: { cookie } }).then((response) => response.json())).products.find((product) => product.id === createdProduct.id).category, "Perlengkapan Tes Baru");

  const deleteUsedCategory = await fetch(`${base}/api/admin/categories/${createdCategory.id}`, {
    method: "DELETE",
    headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  assert.equal(deleteUsedCategory.status, 400);

  const unusedCategoryResponse = await fetch(`${base}/api/admin/categories`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "Kategori Sementara" }),
  });
  const unusedCategory = (await unusedCategoryResponse.json()).category;
  const renameCategoryResponse = await fetch(`${base}/api/admin/categories/${unusedCategory.id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "Kategori Sementara Baru" }),
  });
  assert.equal(renameCategoryResponse.status, 200);
  const deleteCategoryResponse = await fetch(`${base}/api/admin/categories/${unusedCategory.id}`, {
    method: "DELETE",
    headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  assert.equal(deleteCategoryResponse.status, 204);

  const newPopResponse = await fetch(`${base}/api/admin/pops`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "PoP Tes" }),
  });
  const newPop = (await newPopResponse.json()).pop;
  const editPopResponse = await fetch(`${base}/api/admin/pops/${newPop.id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ name: "PoP Tes Diperbarui" }),
  });
  assert.equal(editPopResponse.status, 200);
  assert.equal((await editPopResponse.json()).pop.name, "PoP Tes Diperbarui");

  const settingsForm = new FormData();
  settingsForm.set("appName", "Katalog Merchandise Tes");
  settingsForm.set("companyName", "PT Pengujian Katalog");
  settingsForm.set("primaryColor", "#123456");
  settingsForm.set("secondaryColor", "#234567");
  settingsForm.set("accentColor", "#abcdef");
  settingsForm.set("logo", new Blob([imageBytes], { type: "image/png" }), "logo.png");
  const settingsResponse = await fetch(`${base}/api/admin/settings`, {
    method: "PUT",
    headers: { cookie, "sec-fetch-site": "same-origin" },
    body: settingsForm,
  });
  assert.equal(settingsResponse.status, 200);
  const savedSettings = (await settingsResponse.json()).settings;
  assert.equal(savedSettings.appName, "Katalog Merchandise Tes");
  assert.equal(savedSettings.primaryColor, "#123456");
  assert.ok(savedSettings.logoUrl);
  const themeResponse = await fetch(`${base}/theme.css`);
  assert.match(await themeResponse.text(), /--blue:#123456/);

  const updatedCatalog = await fetch(`${base}/api/catalog`).then((response) => response.json());
  assert.equal(updatedCatalog.products.find((product) => product.id === createdProduct.id).images.length, 5);
  assert.equal(updatedCatalog.settings.appName, "Katalog Merchandise Tes");

  const adminOrdersResponse = await fetch(`${base}/api/admin/orders`, { headers: { cookie } });
  assert.equal(adminOrdersResponse.status, 200);
  assert.equal((await adminOrdersResponse.json()).orders.length, 1);

  const backupResponse = await fetch(`${base}/api/admin/backup`, { method: "POST", headers: { cookie, "sec-fetch-site": "same-origin" } });
  assert.equal(backupResponse.status, 200);
  const backup = await backupResponse.blob();
  assert.ok(backup.size > 1000);

  const restoreForm = new FormData();
  restoreForm.append("backup", backup, "integration.merchbackup");
  const restoreResponse = await fetch(`${base}/api/admin/restore`, { method: "POST", headers: { cookie, "sec-fetch-site": "same-origin" }, body: restoreForm });
  assert.equal(restoreResponse.status, 200, await restoreResponse.text());
  const ordersAfterRestore = await fetch(`${base}/api/admin/orders`, { headers: { cookie } });
  assert.equal(ordersAfterRestore.status, 200);
  assert.equal((await ordersAfterRestore.json()).orders.length, 1);
});
