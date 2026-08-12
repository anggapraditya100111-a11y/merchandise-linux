const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
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

  const orderResponse = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ customerName: "Budi Santoso", popId: catalog.pops[0].id, whatsapp: "081234567890", items: [{ productId: shirt.id, variant: shirt.variants[0], quantity: 2 }] }),
  });
  assert.equal(orderResponse.status, 201);
  const orderData = await orderResponse.json();
  assert.match(orderData.order.orderNumber, /^MER-\d{8}-\d{4}$/);
  assert.equal(orderData.order.items[0].variant, shirt.variants[0]);
  assert.equal(orderData.order.total, shirt.price * 2);
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
