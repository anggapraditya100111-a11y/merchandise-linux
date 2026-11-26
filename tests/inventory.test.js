const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const check = async (response, status) => {
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "store-inventory-"));
  const port = 20401 + Math.floor(Math.random() * 1000);
  const uploads = path.join(root, "uploads");
  await fs.mkdir(uploads);
  await fs.writeFile(path.join(uploads, "test.png"), "asset_fixture");
  const child = spawn(process.execPath, ["src/server.js"], { cwd: path.join(__dirname, ".."), env: {
    ...process.env, PORT: String(port), INITIAL_ADMIN_USERNAME: "admin", INITIAL_ADMIN_PASSWORD: "TestPassword123",
    DATA_DIR: path.join(root, "data"), UPLOAD_DIR: uploads, BACKUP_DIR: path.join(root, "backup"),
    RESTORE_TMP_DIR: path.join(root, "restore"), APP_SECRET: "local-fixture-secret-no-production-value", COOKIE_SECURE: "false",
  }, stdio: ["ignore", "ignore", "pipe"] });
  let errors = "";
  child.stderr.setEncoding("utf8").on("data", (data) => { errors += data; });
  const exit = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await exit; }
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = (url, method = "GET", body, cookie) => fetch(base + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) } });
  let ready = false;
  for (let i = 0; i < 65 && child.exitCode === null; i++) {
    try { if ((await call("/api/health")).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, errors);
  const login = await call("/api/admin/session", "POST", { username: "admin", password: "TestPassword123" });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const admin = (url, method, body) => call("/api/admin" + url, method, body, cookie);
  const catalog = await check(await call("/api/catalog"), 200);
  return { call, admin, catalog };
}

test("checkout atomik, PO vendor bertahap, opname, reservasi, HPP dan serah terima", { timeout: 30000 }, async (t) => {
  const { call, admin, catalog } = await fixture(t);
  const product = catalog.products.find((p) => p.variants.length);
  const save = (data) => admin(`/inventory/products/${product.id}/variant`, "PUT", data);
  const legacyBody = { customerName: "PoP Lama", popId: catalog.pops[0].id, whatsapp: "08123456789" };
  const legacy = await check(await call("/api/orders", "POST", { ...legacyBody, items: [{ productId: product.id, variant: product.variants[0], quantity: 1 }] }), 201);
  const { variant } = await check(await save({ sku: "KAOS-HITAM-M", color: "Hitam", size: "M", price: 30000, cost: 0, allowPo: true, minimum: 1 }), 200);
  const other = (await check(await save({ sku: "KAOS-HITAM-L", color: "Hitam", size: "L", price: 35000, cost: 0, allowPo: false }), 200)).variant;
  const receipt = (quantity, cost, reference, workOrder) => admin("/inventory/movements", "POST", {
    variantId: variant.id, kind: "RECEIPT", quantity, cost, reference, supplier: "Vendor Tes", eventOn: "2026-11-26", workOrder,
  });
  const count = (quantity, expectedPhysical) => admin("/inventory/movements", "POST", { variantId: variant.id, kind: "COUNT", quantity, expectedPhysical, note: "Hitung fisik gudang" });
  await check(await receipt(2, 10000, "AWAL"), 201);
  assert.ok(!(await check(await call("/api/catalog"), 200)).products.find((p) => p.id === product.id).stockOptions);
  await check(await admin(`/inventory/products/${product.id}/enable`, "POST", {}), 200);
  const publicProduct = (await check(await call("/api/catalog"), 200)).products.find((p) => p.id === product.id);
  assert.equal(publicProduct.stockOptions.find((item) => item.id === variant.id).available, 2);
  assert.equal(publicProduct.stockOptions.find((item) => item.id === other.id).allowPo, false);
  assert.ok(!publicProduct.stockOptions.some((item) => "cost" in item));
  const line = (quantity, expectedPo, variantId = variant.id) => ({ productId: product.id, variantId, quantity, expectedPo, expectedPrice: 30000 });
  const order = (items, name = "Pemesan Tes") => call("/api/orders", "POST", { ...legacyBody, customerName: name, items });
  await check(await order([line(1, 1, other.id)]), 400);
  await check(await order([line(1, 0), line(1, 0)]), 400);
  const race = await Promise.all([order([line(3, 1)], "Pemesan Satu"), order([line(3, 1)], "Pemesan Dua")]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 400]);
  const first = (await check(race.find((r) => r.status === 201), 201)).order;
  assert.deepEqual([first.items[0].stock.initialReady, first.items[0].stock.initialPo], [2, 1]);
  const quote = await check(await call("/api/catalog/quote", "POST", { items: [line(2)] }), 200);
  assert.deepEqual(quote.items, [{ price: 30000, ready: 0, po: 2 }]);
  const second = (await check(await order([line(2, 2)], "Pemesan Berikutnya"), 201)).order;
  const fulfill = (order, quantity, action = "DELIVER") => admin(`/inventory/orders/${order.orderNumber}/items/${order.items[0].id}`, "POST", { action, quantity, note: "Pengujian gudang" });
  await check(await count(1, 2), 400);
  await check(await count(3, 0), 400);
  await check(await admin(`/orders/${first.orderNumber}/status`, "PATCH", { status: "DONE" }), 400);
  await check(await fulfill(first, 1), 200);
  const work = (await check(await admin("/work-orders", "POST", { vendorName: "Vendor Tes", orderNumbers: [first.orderNumber, second.orderNumber] }), 201)).workOrder;
  assert.equal(work.items[0].quantity, 3);
  await check(await admin("/work-orders", "POST", { vendorName: "Vendor Tes", orderNumbers: [first.orderNumber] }), 400);
  await check(await admin(`/work-orders/${work.workOrderNumber}/status`, "PATCH", { status: "DONE" }), 400);
  await check(await receipt(4, 20000, "MELEBIHI", work.workOrderNumber), 400);
  const partial = (await check(await receipt(1, 20000, "NOTA-1", work.workOrderNumber), 201)).variant;
  assert.equal(partial.cost, 15000);
  const status = async () => (await check(await admin("/work-orders"), 200)).workOrders.find((w) => w.id === work.id);
  assert.equal((await status()).inventory[0].received, 1);
  assert.equal((await status()).status, "VENDOR_PROCESSING");
  const adminOrders = async () => (await check(await admin("/orders"), 200)).orders;
  const afterPartial = await adminOrders();
  assert.deepEqual(afterPartial.find((order) => order.id === first.id).items.map((item) => [item.stock.ready, item.stock.po]), [[2, 0]]);
  assert.equal(afterPartial.find((order) => order.id === second.id).items[0].stock.po, 2);
  await check(await receipt(2, 25000, "NOTA-2", work.workOrderNumber), 201);
  assert.equal((await status()).status, "DONE");
  assert.equal((await adminOrders()).find((order) => order.id === first.id).status, "PROCESSING");
  await check(await fulfill(first, 3), 400);
  assert.equal((await check(await fulfill(first, 2), 200)).order.status, "DONE");
  assert.equal((await check(await fulfill(second, 2, "CANCEL"), 200)).order.items[0].stock.cancelled, 2);
  await check(await admin(`/orders/${second.orderNumber}`, "DELETE"), 400);
  const report = await check(await admin("/inventory"), 200);
  const balance = report.variants.find((v) => v.id === variant.id);
  assert.deepEqual([balance.physical, balance.reserved, balance.pending, balance.cost], [2, 0, 0, 20000]);
  assert.deepEqual(report.accounting, { sales: 90000, cost: 50000 });
  assert.ok(report.movements.some((move) => move.reference === "NOTA-2" && move.event_on === "2026-11-26"));
  await check(await count(1, 2), 201);
  const old = (await adminOrders()).find((order) => order.id === legacy.order.id);
  assert.equal(old.items[0].stock, null);
  assert.equal(old.status, "PROCESSING");
  const pdf = await call(`/api/orders/${first.orderNumber}/pdf?token=${first.pdfToken}`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
});

test("kata kunci melindungi API dan foto, kompatibel dengan admin dan mencabut sesi lama", { timeout: 20000 }, async (t) => {
  const { call, admin, catalog } = await fixture(t);
  assert.equal((await call("/uploads/test.png")).status, 200);
  await check(await call("/api/admin/catalog-access", "PUT", { enabled: true, keyword: "kata kunci contoh", showQuantity: true }), 401);
  await check(await admin("/catalog-access", "PUT", { enabled: true, keyword: "", showQuantity: true }), 400);
  const config = await check(await admin("/catalog-access", "PUT", { enabled: true, keyword: "kata kunci pertama", showQuantity: false }), 200);
  assert.deepEqual(config, { enabled: true, showQuantity: false });
  for (const route of ["/api/catalog", "/api/settings", "/uploads/test.png"]) {
    const response = await call(route);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await check(response, 401)).code, "CATALOG_LOCKED");
  }
  await check(await call("/api/catalog/quote", "POST", { items: [{ productId: catalog.products[0].id, quantity: 1 }] }), 401);
  await check(await call("/api/orders", "POST", {}), 401);
  await check(await call("/api/catalog/unlock", "POST", { keyword: "kata kunci salah" }), 401);
  const unlock = await call("/api/catalog/unlock", "POST", { keyword: "kata kunci pertama" });
  assert.equal(unlock.status, 200);
  assert.match(unlock.headers.get("set-cookie"), /HttpOnly.*SameSite=Strict/);
  const cookie = unlock.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/api/catalog", "GET", undefined, cookie)).status, 200);
  assert.equal(await (await call("/uploads/test.png", "GET", undefined, cookie)).text(), "asset_fixture");
  assert.equal((await admin("/inventory")).status, 200);
  assert.equal((await call("/api/admin/inventory", "GET", undefined, cookie)).status, 401);
  assert.equal((await call("/.well-known/axindo-access.json")).status, 200);
  await check(await admin("/catalog-access", "PUT", { enabled: true, keyword: "kata kunci kedua", showQuantity: false }), 200);
  assert.equal((await call("/api/catalog", "GET", undefined, cookie)).status, 401);
  assert.equal((await call("/uploads/test.png", "GET", undefined, cookie)).status, 401);
  await check(await admin("/catalog-access", "PUT", { enabled: false, showQuantity: true }), 200);
  assert.equal((await call("/api/catalog")).status, 200);
});
