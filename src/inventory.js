const { randomUUID } = require("node:crypto");
class InputError extends Error {}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_products (
      product_id TEXT PRIMARY KEY REFERENCES products(id), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS inventory_variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      label TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL, size TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price >= 0), cost INTEGER NOT NULL CHECK(cost >= 0),
      physical INTEGER NOT NULL DEFAULT 0 CHECK(physical >= 0), minimum INTEGER NOT NULL CHECK(minimum >= 0),
      allow_po INTEGER NOT NULL CHECK(allow_po IN (0,1)), eta TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
      UNIQUE(product_id, label)
    );
    CREATE TABLE IF NOT EXISTS inventory_lines (
      item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE RESTRICT,
      variant_id TEXT NOT NULL REFERENCES inventory_variants(id), initial_ready INTEGER NOT NULL CHECK(initial_ready >= 0),
      reserved INTEGER NOT NULL CHECK(reserved >= 0), delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered >= 0),
      cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled >= 0), delivered_cost INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS inventory_lines_variant ON inventory_lines(variant_id);
    CREATE TABLE IF NOT EXISTS inventory_work_lines (
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_lines(item_id), qty INTEGER NOT NULL CHECK(qty > 0),
      PRIMARY KEY(work_order_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES inventory_variants(id), kind TEXT NOT NULL,
      qty INTEGER NOT NULL, before_qty INTEGER NOT NULL, after_qty INTEGER NOT NULL, unit_cost INTEGER NOT NULL,
      actor TEXT NOT NULL, reference TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, event_on TEXT NOT NULL DEFAULT '',
      work_order_id TEXT REFERENCES work_orders(id)
    );
  `);
}

const transaction = (db, action) => {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
};
const clean = (value, max) => {
  const result = String(value ?? "").trim();
  if (result.length > max) throw new InputError(`Isian maksimal ${max} karakter.`);
  return result;
};
function number(value, min = 0, max = 1_000_000) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new InputError("Isi angka yang valid.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new InputError(`Masukkan angka bulat antara ${min} dan ${max}.`);
  return n;
}
const enabled = (db, product) => db.prepare("SELECT enabled FROM inventory_products WHERE product_id = ?").get(product)?.enabled === 1;
const variantSQL = `SELECT v.*, p.name AS product_name, p.active AS product_active, COALESCE(ip.enabled, 0) AS managed,
  COALESCE((SELECT SUM(reserved) FROM inventory_lines WHERE variant_id = v.id), 0) AS reserved,
  COALESCE((SELECT SUM(i.quantity - l.reserved - l.delivered - l.cancelled) FROM inventory_lines l JOIN order_items i ON i.id=l.item_id WHERE l.variant_id=v.id),0) AS pending
  FROM inventory_variants v JOIN products p ON p.id=v.product_id LEFT JOIN inventory_products ip ON ip.product_id=v.product_id`;
const allVariants = (db) => db.prepare(`${variantSQL} ORDER BY p.name, v.label`).all();
const variant = (db, id) => db.prepare(`${variantSQL} WHERE v.id=?`).get(id);
const available = (v) => v.physical - v.reserved;

function saveVariant(db, productId, input) {
  return transaction(db, () => {
    if (!db.prepare("SELECT 1 FROM products WHERE id=?").get(productId)) throw new InputError("Produk tidak ditemukan.");
    const current = input.id ? variant(db, String(input.id)) : null;
    if (input.id && (!current || current.product_id !== productId)) throw new InputError("Varian tidak ditemukan.");
    const sku = clean(input.sku, 60);
    const color = clean(input.color, 40), size = clean(input.size, 40);
    const label = clean(input.label, 100) || [color, size].filter(Boolean).join(" / ") || "Standar";
    const price = number(input.price, 0, 1_000_000_000), minimum = number(input.minimum ?? 0);
    const cost = number(input.cost ?? 0, 0, 1_000_000_000);
    const active = input.active !== false ? 1 : 0;
    if (!sku) throw new InputError("SKU wajib diisi.");
    if (current && !active && (current.reserved || current.pending || current.physical)) throw new InputError("Varian masih memiliki stok atau pesanan aktif.");
    if (current && !active && enabled(db, productId) && !db.prepare("SELECT 1 FROM inventory_variants WHERE product_id=? AND id<>? AND active=1").get(productId, current.id)) throw new InputError("Produk dengan stok aktif harus memiliki minimal satu varian aktif.");
    if (current && current.physical && current.cost !== cost) throw new InputError("Ubah harga perolehan stok melalui Barang Masuk.");
    const eta = clean(input.eta, 120);
    const resultId = current?.id || randomUUID();
    try {
      db.prepare(`INSERT INTO inventory_variants (id,product_id,sku,label,color,size,price,cost,minimum,allow_po,eta,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,label=excluded.label,color=excluded.color,
        size=excluded.size,price=excluded.price,cost=excluded.cost,minimum=excluded.minimum,allow_po=excluded.allow_po,eta=excluded.eta,active=excluded.active`)
        .run(resultId, productId, sku, label, color, size, price, cost, minimum, input.allowPo ? 1 : 0, eta, active);
    } catch (error) {
      if (/UNIQUE constraint/.test(error.message)) throw new InputError("SKU atau nama varian sudah digunakan.");
      throw error;
    }
    return variant(db, resultId);
  });
}

function enableProduct(db, productId) {
  return transaction(db, () => {
    if (!db.prepare("SELECT 1 FROM inventory_variants WHERE product_id=? AND active=1").get(productId)) throw new InputError("Buat minimal satu varian aktif terlebih dahulu.");
    db.prepare("INSERT INTO inventory_products (product_id, enabled) VALUES (?,1) ON CONFLICT(product_id) DO UPDATE SET enabled=1").run(productId);
  });
}

function publicProducts(db, products, showQuantity) {
  const variants = allVariants(db).filter((v) => v.active && v.managed);
  const byProduct = new Map();
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push({ id: v.id, label: v.label, price: v.price, color: v.color, size: v.size, available: showQuantity ? available(v) : null, inStock: available(v) > 0, low: available(v) > 0 && available(v) <= v.minimum, allowPo: Boolean(v.allow_po), eta: v.eta });
  }
  return products.map((product) => {
    const options = byProduct.get(product.id);
    return options ? { ...product, price: Math.min(...options.map((v) => v.price)), variantLabel: "Warna / ukuran", variants: options.map((v) => v.label), stockOptions: options, showQuantity } : product;
  });
}

// Caller owns the checkout transaction. The in-memory tally covers repeat SKU lines in one checkout.
function resolve(db, productId, requested, quantity, tally) {
  if (!enabled(db, productId)) return null;
  const v = requested.variantId ? variant(db, String(requested.variantId)) : db.prepare(`${variantSQL} WHERE v.product_id=? AND v.label=?`).get(productId, String(requested.variant || ""));
  if (!v || !v.active || v.product_id !== productId) throw new InputError("Pilih varian barang yang valid.");
  if (tally.has(v.id)) throw new InputError("Gabungkan jumlah untuk varian yang sama dalam satu baris.");
  const ready = Math.min(quantity, available(v));
  tally.add(v.id);
  if (quantity > ready && !v.allow_po) throw new InputError(`Stok ${v.sku} tidak mencukupi dan PO tidak tersedia.`);
  return { id: v.id, price: v.price, sku: v.sku, label: v.label, ready };
}

function addLine(db, itemId, stock) {
  db.prepare("INSERT INTO inventory_lines (item_id,variant_id,initial_ready,reserved) VALUES (?,?,?,?)").run(itemId, stock.id, stock.ready, stock.ready);
}

function lineInfo(db, itemId, quantity) {
  const row = db.prepare("SELECT * FROM inventory_lines WHERE item_id=?").get(itemId);
  if (!row) return null;
  const history = db.prepare(`SELECT w.work_order_number,w.status FROM inventory_work_lines l JOIN work_orders w ON w.id=l.work_order_id
    WHERE l.item_id=? ORDER BY w.created_at DESC`).all(itemId);
  const vendor = history.filter((w) => w.status === "VENDOR_PROCESSING").map((w) => w.work_order_number);
  return { variantId: row.variant_id, initialReady: row.initial_ready, initialPo: quantity - row.initial_ready, ready: row.reserved, po: quantity - row.reserved - row.delivered - row.cancelled, delivered: row.delivered, cancelled: row.cancelled, vendor, workOrders: history.map((w) => w.work_order_number) };
}

function movement(db, v, kind, qty, unitCost, actor, reference, note, workOrderId = null, eventOn = "") {
  db.prepare(`INSERT INTO inventory_movements (variant_id,kind,qty,before_qty,after_qty,unit_cost,actor,reference,note,created_at,work_order_id,event_on)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id, kind, qty, v.physical, v.physical + qty, unitCost, actor, reference, note, new Date().toISOString(), workOrderId, eventOn);
}

function allocate(db, variantId) {
  let free = available(variant(db, variantId));
  const waiting = db.prepare(`SELECT l.item_id, i.quantity-l.reserved-l.delivered-l.cancelled AS remaining FROM inventory_lines l
    JOIN order_items i ON i.id=l.item_id JOIN orders o ON o.id=i.order_id WHERE l.variant_id=? AND remaining>0
    ORDER BY o.created_at, o.order_number, i.rowid`).all(variantId);
  for (const row of waiting) {
    if (!free) break;
    const take = Math.min(free, row.remaining);
    db.prepare("UPDATE inventory_lines SET reserved=reserved+? WHERE item_id=?").run(take, row.item_id);
    free -= take;
  }
}

function vendorTotals(db, workOrderId) {
  return db.prepare(`SELECT l.variant_id AS variantId, v.sku AS sku, SUM(a.qty) AS target,
    COALESCE((SELECT SUM(m.qty) FROM inventory_movements m WHERE m.work_order_id=a.work_order_id AND m.variant_id=l.variant_id AND m.kind='RECEIPT'),0) AS received
    FROM inventory_work_lines a JOIN inventory_lines l ON l.item_id=a.item_id JOIN inventory_variants v ON v.id=l.variant_id WHERE a.work_order_id=? GROUP BY l.variant_id`).all(workOrderId);
}

function adjust(db, input, actor) {
  return transaction(db, () => {
    const v = variant(db, String(input.variantId));
    if (!v || !v.active) throw new InputError("Varian tidak aktif atau tidak ditemukan.");
    const note = clean(input.note, 500), reference = clean(input.reference, 160);
    const eventOn = clean(input.eventOn, 10);
    if (eventOn) {
      const parsed = new Date(`${eventOn}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventOn) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== eventOn) throw new InputError("Tanggal pencatatan tidak valid.");
    }
    let workOrder = null, qty, unitCost = v.cost, nextCost = v.cost;
    if (input.kind === "RECEIPT") {
      qty = number(input.quantity, 1);
      number(v.physical + qty);
      unitCost = number(input.cost, 0, 1_000_000_000);
      const supplier = clean(input.supplier, 120);
      if (!supplier || !reference) throw new InputError("Isi supplier dan nomor nota/referensi.");
      if (input.workOrder) {
        const workOrderNumber = clean(input.workOrder, 80);
        workOrder = db.prepare("SELECT * FROM work_orders WHERE work_order_number=? AND status='VENDOR_PROCESSING'").get(workOrderNumber);
        const target = workOrder && vendorTotals(db, workOrder.id).find((row) => row.variantId === v.id);
        if (!target || qty > target.target - target.received) throw new InputError("Penerimaan melebihi sisa Work Order atau variannya tidak sesuai.");
      }
      nextCost = Math.round((v.cost * v.physical + unitCost * qty) / (v.physical + qty));
      movement(db, v, "RECEIPT", qty, unitCost, actor, reference, `${supplier}${note ? ` · ${note}` : ""}`, workOrder?.id, eventOn);
    } else if (input.kind === "COUNT") {
      const physical = number(input.quantity);
      if (!note) throw new InputError("Isi alasan atau keterangan opname.");
      if (number(input.expectedPhysical) !== v.physical) throw new InputError("Stok telah berubah sejak formulir dibuka. Muat ulang sebelum opname.");
      if (physical < v.reserved) throw new InputError(`Hasil opname di bawah ${v.reserved} unit yang sudah dipesan. Selesaikan selisih reservasi dahulu.`);
      qty = physical - v.physical;
      movement(db, v, "COUNT", qty, unitCost, actor, reference, note, null, eventOn);
    } else throw new InputError("Jenis mutasi tidak valid.");
    db.prepare("UPDATE inventory_variants SET physical=physical+?,cost=? WHERE id=?").run(qty, nextCost, v.id);
    if (qty > 0) allocate(db, v.id);
    if (workOrder && vendorTotals(db, workOrder.id).every((row) => row.received === row.target)) {
      db.prepare("UPDATE work_orders SET status='DONE',completed_at=? WHERE id=?").run(new Date().toISOString(), workOrder.id);
    }
    return variant(db, v.id);
  });
}

function fulfill(db, orderNumber, itemId, input, actor) {
  return transaction(db, () => {
    const row = db.prepare(`SELECT l.*,i.quantity,o.id AS order_id FROM inventory_lines l JOIN order_items i ON i.id=l.item_id
      JOIN orders o ON o.id=i.order_id WHERE o.order_number=? AND l.item_id=?`).get(orderNumber, itemId);
    if (!row) throw new InputError("Item pesanan tidak ditemukan.");
    const v = variant(db, row.variant_id), qty = number(input.quantity, 1, 99);
    const note = clean(input.note, 500);
    if (input.action === "DELIVER") {
      if (qty > row.reserved) throw new InputError("Jumlah serah terima melebihi stok Ready yang direservasi.");
      db.prepare("UPDATE inventory_lines SET reserved=reserved-?,delivered=delivered+?,delivered_cost=delivered_cost+? WHERE item_id=?").run(qty, qty, v.cost * qty, itemId);
      db.prepare("UPDATE inventory_variants SET physical=physical-? WHERE id=?").run(qty, v.id);
      movement(db, v, "DELIVER", -qty, v.cost, actor, orderNumber, note);
    } else if (input.action === "CANCEL") {
      const pending = row.quantity - row.reserved - row.delivered - row.cancelled;
      if (!note) throw new InputError("Isi alasan pembatalan.");
      if (qty > row.reserved + pending) throw new InputError("Jumlah pembatalan melebihi sisa pesanan.");
      if (pending && lineInfo(db, itemId, row.quantity).vendor.length) throw new InputError("PO masih terhubung dengan Work Order aktif. Selesaikan atau batalkan Work Order dahulu.");
      const release = Math.max(0, qty - pending);
      db.prepare("UPDATE inventory_lines SET reserved=reserved-?,cancelled=cancelled+? WHERE item_id=?").run(release, qty, itemId);
      movement(db, v, "CANCEL", 0, v.cost, actor, orderNumber, `${qty} unit · ${note}`);
      allocate(db, v.id);
    } else throw new InputError("Aksi pesanan tidak valid.");
    const pending = db.prepare(`SELECT 1 FROM order_items i JOIN inventory_lines l ON l.item_id=i.id
      WHERE i.order_id=? AND i.quantity>l.delivered+l.cancelled`).get(row.order_id);
    const legacy = db.prepare("SELECT 1 FROM order_items i LEFT JOIN inventory_lines l ON l.item_id=i.id WHERE i.order_id=? AND l.item_id IS NULL").get(row.order_id);
    if (!pending && !legacy) db.prepare("UPDATE orders SET status='DONE',completed_at=? WHERE id=?").run(new Date().toISOString(), row.order_id);
  });
}

function report(db) {
  const variants = allVariants(db);
  const accounting = db.prepare(`SELECT COALESCE(SUM(l.delivered * i.unit_price),0) AS sales, COALESCE(SUM(l.delivered_cost),0) AS cost
    FROM inventory_lines l JOIN order_items i ON i.id=l.item_id`).get();
  return { variants, accounting, movements: db.prepare(`SELECT m.*,v.sku,w.work_order_number FROM inventory_movements m JOIN inventory_variants v ON v.id=m.variant_id
    LEFT JOIN work_orders w ON w.id=m.work_order_id ORDER BY m.id DESC LIMIT 250`).all() };
}

module.exports = { InputError, init, enabled, saveVariant, enableProduct, publicProducts, resolve, addLine, lineInfo, adjust, fulfill, report, vendorTotals };
