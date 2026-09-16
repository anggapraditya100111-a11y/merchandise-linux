const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const installer = fs.readFileSync(path.join(root, "install-casaos.sh"), "utf8");
const ubuntuInstaller = fs.readFileSync(path.join(root, "install-ubuntu.sh"), "utf8");
const updater = fs.readFileSync(path.join(root, "update.sh"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
const catalogScript = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const adminScript = fs.readFileSync(path.join(root, "public", "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");

test("installer dan updater memakai jalur paket raw GitHub", () => {
  for (const script of [installer, ubuntuInstaller, updater]) {
    assert.match(script, /raw\.githubusercontent\.com/);
    assert.match(script, /sha256sum --check/);
    assert.doesNotMatch(script, /git clone|git fetch|git pull/);
    assert.doesNotMatch(script, /https:\/\/github\.com/);
  }
});

test("updater mempertahankan backup, health check, dan rollback", () => {
  assert.match(updater, /src\/cli\.js backup/);
  assert.match(updater, /api\/health/);
  assert.match(updater, /source-rollback/);
  assert.match(updater, /old_image_id/);
  assert.match(updater, /TRUST_PROXY=false/);
  assert.match(updater, /TRUST_PROXY=true/);
});

test("form order menyimpan referensi sebelum request asynchronous", () => {
  assert.match(catalogScript, /const formElement = event\.currentTarget;/);
  assert.match(catalogScript, /formElement\.reset\(\);/);
  assert.doesNotMatch(catalogScript, /event\.currentTarget\.reset\(\);/);
});

test("form password menyimpan referensi dan menyediakan kontrol tampilkan password", () => {
  assert.match(adminScript, /const formElement = event\.currentTarget;/);
  assert.match(adminScript, /formElement\.reset\(\);/);
  assert.doesNotMatch(adminScript, /event\.currentTarget\.reset\(\);/);
  assert.match(adminHtml, /data-toggle-password/);
  assert.match(adminHtml, /minlength="8"/);
});

test("konfigurasi CasaOS mempercayai reverse proxy secara default", () => {
  assert.match(compose, /TRUST_PROXY: "\$\{TRUST_PROXY:-true\}"/);
});

test("deployment Ubuntu dan AXINDO Access tersedia", () => {
  assert.match(ubuntuInstaller, /\/opt\/axindo-merchandise/);
  assert.match(ubuntuInstaller, /\/var\/lib\/axindo-merchandise/);
  assert.match(compose, /host\.docker\.internal:host-gateway/);
  assert.match(server, /\.well-known\/axindo-access\.json/);
  assert.match(server, /api\/public\/axindo-access\.json/);
  assert.match(server, /audience: "merchandise"/);
  assert.match(server, /AXINDO - MERCHANDISE - SUPER ADMIN/);
  assert.match(adminScript, /axindo-access-handoff/);
  assert.match(adminScript, /Date\.now\(\) - active\.closedAt < 1500/);
  assert.match(adminScript, /local-password-card.*authSource === "ACCESS"/);
  assert.match(catalogScript, /merchandise-handoff:/);
  assert.match(catalogScript, /window\.name === channel/);
  assert.match(server, /same-origin-allow-popups/);
  assert.match(server, /req\.admin\.authSource === "ACCESS"/);
});

test("deskripsi multiline dan status pesanan tersedia di katalog serta admin", () => {
  assert.match(catalogScript, /class="product-description"/);
  assert.match(styles, /\.product-description\{white-space:pre-line\}/);
  assert.match(adminHtml, /data-order-status="PROCESSING"/);
  assert.match(adminHtml, /data-order-status="DONE"/);
  assert.match(adminScript, /data-order-status-change="DONE"/);
  assert.match(server, /api\/admin\/orders\/:number\/status/);
});

test("Work Order vendor merekap order terpilih dan menyediakan PDF", () => {
  assert.match(adminHtml, /data-order-status="WORK_ORDERS"/);
  assert.match(adminHtml, /id="create-work-order"/);
  assert.match(adminScript, /selectedOrderNumbers/);
  assert.match(adminScript, /aggregateWorkOrderItems/);
  assert.match(server, /api\/admin\/work-orders/);
  assert.match(server, /renderWorkOrderPdf/);
});
