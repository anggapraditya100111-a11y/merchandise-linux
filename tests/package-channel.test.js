const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const installer = fs.readFileSync(path.join(root, "install-casaos.sh"), "utf8");
const updater = fs.readFileSync(path.join(root, "update.sh"), "utf8");

test("installer dan updater memakai jalur paket raw GitHub", () => {
  for (const script of [installer, updater]) {
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
});
