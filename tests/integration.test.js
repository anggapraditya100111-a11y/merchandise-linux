const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
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

test("migrasi database lama menambahkan galeri, kategori, pengaturan, catatan, dan status pesanan", { timeout: 15_000 }, async (context) => {
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
    INSERT INTO orders VALUES ('ord_legacy', 'MER-20260101-0001', 'Pemesan Lama', NULL, 'PoP Lama', '628123456789', 10000, 'legacy-token', '2026-01-01T00:00:00.000Z');
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
  assert.ok(migrated.prepare("PRAGMA table_info(orders)").all().some((column) => column.name === "status"));
  assert.ok(migrated.prepare("PRAGMA table_info(orders)").all().some((column) => column.name === "completed_at"));
  assert.deepEqual({ ...migrated.prepare("SELECT status, completed_at FROM orders WHERE id = 'ord_legacy'").get() }, { status: "PROCESSING", completed_at: null });
  assert.equal(migrated.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'work_orders'").get().total, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'work_order_items'").get().total, 1);
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
  assert.equal(orderData.order.status, "PROCESSING");
  assert.equal(orderData.order.completedAt, null);
  assert.match(orderData.message, /konfirmasi ke admin/i);
  assert.match(orderData.publicPdfUrl, /^https:\/\/katalog\.axindo\.my\.id\/api\/orders\//);
  assert.equal(orderData.whatsappUrl, null);

  const pdfResponse = await fetch(`${base}${orderData.pdfUrl}`);
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get("content-type"), /application\/pdf/);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");

  const loginResponse = await fetch(`${base}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.10" },
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

  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
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

  const originalImageUrls = createdProduct.images.map((image) => image.url);
  const reorderForm = new FormData();
  reorderForm.set("sku", createdProduct.sku);
  reorderForm.set("name", createdProduct.name);
  reorderForm.set("description", createdProduct.description);
  reorderForm.set("category", createdProduct.category);
  reorderForm.set("price", String(createdProduct.price));
  reorderForm.set("variantLabel", createdProduct.variantLabel);
  reorderForm.set("variants", createdProduct.variants.join(", "));
  reorderForm.set("active", "true");
  reorderForm.set("removeImageIds", "[]");
  reorderForm.set("imageOrder", JSON.stringify(createdProduct.images.toReversed().map((image) => `existing:${image.id}`)));
  const reorderResponse = await fetch(`${base}/api/admin/products/${createdProduct.id}`, {
    method: "PUT", headers: { cookie, "sec-fetch-site": "same-origin" }, body: reorderForm,
  });
  assert.equal(reorderResponse.status, 200, await reorderResponse.clone().text());
  const reorderedProduct = (await reorderResponse.json()).product;
  assert.deepEqual(reorderedProduct.images.map((image) => image.url), originalImageUrls.toReversed());

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
  settingsForm.set("heroEyebrow", "Katalog Tim Pengujian");
  settingsForm.set("heroTitle", "Merchandise untuk seluruh penguji.");
  settingsForm.set("heroDescription", "Pilih perlengkapan pengujian langsung dari katalog.");
  settingsForm.set("adminWhatsapp", "081234567890");
  settingsForm.set("publicBaseUrl", "https://katalog.axindo.my.id/");
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
  assert.equal(savedSettings.heroTitle, "Merchandise untuk seluruh penguji.");
  assert.equal(savedSettings.adminWhatsapp, "6281234567890");
  assert.equal(savedSettings.publicBaseUrl, "https://katalog.axindo.my.id");
  assert.ok(savedSettings.logoUrl);
  const themeResponse = await fetch(`${base}/theme.css`);
  assert.match(await themeResponse.text(), /--blue:#123456/);

  const updatedCatalog = await fetch(`${base}/api/catalog`).then((response) => response.json());
  assert.equal(updatedCatalog.products.find((product) => product.id === createdProduct.id).images.length, 5);
  assert.equal(updatedCatalog.settings.appName, "Katalog Merchandise Tes");

  const whatsappOrderResponse = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ customerName: "Siti Aminah", popId: catalog.pops[0].id, whatsapp: "081298765432", items: [{ productId: shirt.id, variant: shirt.variants[0], quantity: 1 }] }),
  });
  assert.equal(whatsappOrderResponse.status, 201);
  const whatsappOrder = await whatsappOrderResponse.json();
  assert.match(whatsappOrder.whatsappUrl, /^https:\/\/wa\.me\/6281234567890\?text=/);
  assert.match(decodeURIComponent(whatsappOrder.whatsappUrl), /PDF order: https:\/\/katalog\.axindo\.my\.id\/api\/orders\//);

  const adminOrdersResponse = await fetch(`${base}/api/admin/orders`, { headers: { cookie } });
  assert.equal(adminOrdersResponse.status, 200);
  assert.equal((await adminOrdersResponse.json()).orders.length, 2);

  const invalidStatusResponse = await fetch(`${base}/api/admin/orders/${encodeURIComponent(whatsappOrder.order.orderNumber)}/status`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ status: "UNKNOWN" }),
  });
  assert.equal(invalidStatusResponse.status, 400);

  const createWorkOrderResponse = await fetch(`${base}/api/admin/work-orders`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({
      vendorName: "CV Vendor Pengujian",
      note: "Selesaikan sesuai spesifikasi barang.",
      orderNumbers: [orderData.order.orderNumber, whatsappOrder.order.orderNumber],
    }),
  });
  assert.equal(createWorkOrderResponse.status, 201, await createWorkOrderResponse.clone().text());
  const createdWorkOrder = (await createWorkOrderResponse.json()).workOrder;
  assert.match(createdWorkOrder.workOrderNumber, /^WO-\d{8}-\d{4}$/);
  assert.equal(createdWorkOrder.vendorName, "CV Vendor Pengujian");
  assert.equal(createdWorkOrder.orders.length, 2);
  assert.equal(createdWorkOrder.items.length, 1);
  assert.equal(createdWorkOrder.items[0].quantity, 3);
  assert.equal(createdWorkOrder.status, "VENDOR_PROCESSING");

  const duplicateWorkOrderResponse = await fetch(`${base}/api/admin/work-orders`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ vendorName: "Vendor Lain", orderNumbers: [orderData.order.orderNumber] }),
  });
  assert.equal(duplicateWorkOrderResponse.status, 400);

  const linkedOrderDeleteResponse = await fetch(`${base}/api/admin/orders/${encodeURIComponent(orderData.order.orderNumber)}`, {
    method: "DELETE", headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  assert.equal(linkedOrderDeleteResponse.status, 400);

  const workOrderPdfResponse = await fetch(`${base}/api/admin/work-orders/${encodeURIComponent(createdWorkOrder.workOrderNumber)}/pdf`, { headers: { cookie } });
  assert.equal(workOrderPdfResponse.status, 200);
  assert.match(workOrderPdfResponse.headers.get("content-type"), /application\/pdf/);
  assert.equal(Buffer.from(await workOrderPdfResponse.arrayBuffer()).subarray(0, 4).toString(), "%PDF");

  const completeWorkOrderResponse = await fetch(`${base}/api/admin/work-orders/${encodeURIComponent(createdWorkOrder.workOrderNumber)}/status`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ status: "DONE" }),
  });
  assert.equal(completeWorkOrderResponse.status, 200);
  const completedWorkOrder = (await completeWorkOrderResponse.json()).workOrder;
  assert.equal(completedWorkOrder.status, "DONE");
  assert.ok(completedWorkOrder.completedAt);
  assert.ok(completedWorkOrder.orders.every((order) => order.status === "DONE"));

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
  const restoredOrders = (await ordersAfterRestore.json()).orders;
  assert.equal(restoredOrders.length, 2);
  assert.equal(restoredOrders.find((order) => order.orderNumber === whatsappOrder.order.orderNumber).status, "DONE");
  const workOrdersAfterRestore = await fetch(`${base}/api/admin/work-orders`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(workOrdersAfterRestore.workOrders.length, 1);
  assert.equal(workOrdersAfterRestore.workOrders[0].status, "DONE");

  const reopenWorkOrderResponse = await fetch(`${base}/api/admin/work-orders/${encodeURIComponent(createdWorkOrder.workOrderNumber)}/status`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ status: "VENDOR_PROCESSING" }),
  });
  assert.equal(reopenWorkOrderResponse.status, 200);
  assert.ok((await reopenWorkOrderResponse.json()).workOrder.orders.every((order) => order.status === "PROCESSING"));

  const cancelWorkOrderResponse = await fetch(`${base}/api/admin/work-orders/${encodeURIComponent(createdWorkOrder.workOrderNumber)}`, {
    method: "DELETE", headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  assert.equal(cancelWorkOrderResponse.status, 204);
  assert.equal((await fetch(`${base}/api/admin/work-orders`, { headers: { cookie } }).then((response) => response.json())).workOrders.length, 0);

  const invalidPasswordResponse = await fetch(`${base}/api/admin/password`, {
    method: "POST", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ currentPassword: "AdminPassword123", newPassword: "Password!23" }),
  });
  assert.equal(invalidPasswordResponse.status, 400);
  const passwordResponse = await fetch(`${base}/api/admin/password`, {
    method: "POST", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ currentPassword: "AdminPassword123", newPassword: "Admin2026" }),
  });
  assert.equal(passwordResponse.status, 200);
  const oldLoginResponse = await fetch(`${base}/api/admin/session`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ username: "admin", password: "AdminPassword123" }),
  });
  assert.equal(oldLoginResponse.status, 401);
  const newLoginResponse = await fetch(`${base}/api/admin/session`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.12" },
    body: JSON.stringify({ username: "admin", password: "Admin2026" }),
  });
  assert.equal(newLoginResponse.status, 200);

  const deleteOrderResponse = await fetch(`${base}/api/admin/orders/${encodeURIComponent(whatsappOrder.order.orderNumber)}`, {
    method: "DELETE", headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  assert.equal(deleteOrderResponse.status, 204);
  const finalOrders = await fetch(`${base}/api/admin/orders`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(finalOrders.orders.length, 1);
  assert.doesNotMatch(stderr, /ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
});

test("manifest dan login admin terhubung ke AXINDO Access", { timeout: 20_000 }, async (context) => {
  const accessServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    assert.equal(req.url, "/api/auth/handoff/exchange");
    assert.equal(req.headers["x-axindo-handoff"], "1");
    assert.equal(body.audience, "merchandise");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      audience: "merchandise",
      returnOrigin: "https://katalog.axindo.my.id",
      identity: { subject: "user-123", username: "angga", name: "Angga Praditya", email: "angga@axindo.my.id" },
      groups: body.code.startsWith("z") ? ["AXINDO - MERCHANDISE - USER"] : ["AXINDO - MERCHANDISE - SUPER ADMIN"],
    }));
  });
  await new Promise((resolve) => accessServer.listen(0, "127.0.0.1", resolve));
  const accessPort = accessServer.address().port;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ainet-merch-access-"));
  const port = 20500 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: path.join(root, "data"), UPLOAD_DIR: path.join(root, "uploads"),
      BACKUP_DIR: path.join(root, "backups"), RESTORE_TMP_DIR: path.join(root, "restore"),
      APP_SECRET: "access-test-secret-with-more-than-sixty-four-characters-1234567890",
      INITIAL_ADMIN_PASSWORD: "AdminPassword123", COOKIE_SECURE: "false", NODE_NO_WARNINGS: "1",
      ACCESS_HANDOFF_ENABLED: "true", ACCESS_PORTAL_URL: "https://akses.axindo.my.id",
      ACCESS_PORTAL_INTERNAL_URL: `http://127.0.0.1:${accessPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await new Promise((resolve) => accessServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const manifestResponse = await fetch(`${base}/.well-known/axindo-access.json`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.id, "merchandise");
  assert.equal(manifest.url, "https://katalog.axindo.my.id");
  assert.ok(manifest.roles.some((role) => role.code === "SUPER_ADMIN" && role.group === "AXINDO - MERCHANDISE - SUPER ADMIN"));
  assert.ok(manifest.roles.some((role) => role.code === "USER" && role.group === "AXINDO - MERCHANDISE - USER"));

  const compatibilityManifestResponse = await fetch(`${base}/api/public/axindo-access.json`);
  assert.equal(compatibilityManifestResponse.status, 200);
  assert.deepEqual(await compatibilityManifestResponse.json(), manifest);

  const config = await fetch(`${base}/api/public/config`).then((response) => response.json());
  assert.equal(config.auth.accessHandoffReady, true);
  assert.match(config.auth.accessPortalPopupUrl, /\/handoff\?handoff=merchandise$/);

  const code = Buffer.alloc(32, 1).toString("base64url");
  const verifier = Buffer.alloc(32, 2).toString("base64url");
  const loginResponse = await fetch(`${base}/api/auth/access/complete`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ code, verifier }),
  });
  assert.equal(loginResponse.status, 200, stderr);
  const login = await loginResponse.json();
  assert.equal(login.admin.authSource, "ACCESS");
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
  const session = await fetch(`${base}/api/admin/session`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(session.admin.email, "angga@axindo.my.id");
  const orders = await fetch(`${base}/api/admin/orders`, { headers: { cookie } });
  assert.equal(orders.status, 200);
  const password = await fetch(`${base}/api/admin/password`, {
    method: "POST", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ currentPassword: "unused", newPassword: "Admin2026" }),
  });
  assert.equal(password.status, 403);
  assert.match((await password.json()).error, /AXINDO ID/);

  const logoutResponse = await fetch(`${base}/api/admin/session`, {
    method: "DELETE", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ scope: "axindo" }),
  });
  assert.equal(logoutResponse.status, 200);
  const logout = await logoutResponse.json();
  const logoutUrl = new URL(logout.redirectUrl);
  assert.equal(logout.scope, "axindo");
  assert.equal(logoutUrl.origin, "https://akses.axindo.my.id");
  assert.equal(logoutUrl.pathname, "/logout");
  assert.equal(new URL(logoutUrl.searchParams.get("return_to")).href, "https://katalog.axindo.my.id/admin?logout=axindo");

  const rejected = await fetch(`${base}/api/auth/access/complete`, {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ code: "z".repeat(43), verifier }),
  });
  assert.equal(rejected.status, 403);
  assert.match((await rejected.json()).error, /tidak memiliki role Super Admin/);
});
