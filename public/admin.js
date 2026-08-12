(() => {
  const state = { admin: null, orders: [], products: [], pops: [], tab: "orders", editingProduct: null };
  const el = (id) => document.getElementById(id);
  const rupiah = (value) => `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
  const dateTime = (value) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const icon = (category) => category.toLowerCase().includes("sepatu") ? "👟" : category.toLowerCase().includes("akses") || category.toLowerCase().includes("mug") ? "☕" : "👕";

  function visual(item, compact = false) {
    const image = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || item.productName)}" loading="lazy">` : `<span class="placeholder">${icon(item.category || item.productName || "")}${compact ? "" : "<small>AINET</small>"}</span>`;
    return compact ? `<span class="thumb">${image}</span>` : `<div class="product-image">${image}</div>`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    const data = response.status === 204 ? null : contentType.includes("application/json") ? await response.json() : await response.blob();
    if (!response.ok) {
      if (response.status === 401 && url !== "/api/admin/session") showLogin();
      throw new Error(data?.error || "Permintaan gagal diproses.");
    }
    return data;
  }

  function message(text, type = "success") {
    const target = el("admin-message");
    target.textContent = text;
    target.className = `alert ${type}`;
    target.classList.toggle("hidden", !text);
    if (text) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLogin(error = "") {
    state.admin = null;
    el("admin-view").classList.add("hidden");
    el("login-view").classList.remove("hidden");
    el("login-error").textContent = error;
    el("login-error").classList.toggle("hidden", !error);
  }

  function showAdmin(admin) {
    state.admin = admin;
    el("login-view").classList.add("hidden");
    el("admin-view").classList.remove("hidden");
    el("admin-name").textContent = admin.username;
    el("admin-initial").textContent = admin.username.slice(0, 1).toUpperCase();
  }

  async function loadAll() {
    const [orders, products, pops] = await Promise.all([
      api("/api/admin/orders"), api("/api/admin/products"), api("/api/admin/pops"),
    ]);
    state.orders = orders.orders;
    state.products = products.products;
    state.pops = pops.pops;
    renderAll();
  }

  function renderOrders() {
    const query = el("order-search").value.trim().toLowerCase();
    const orders = state.orders.filter((order) => !query || [order.orderNumber, order.customerName, order.popName, order.whatsapp].some((value) => value.toLowerCase().includes(query)));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const month = today.slice(0, 7);
    el("metric-orders").textContent = state.orders.length;
    el("metric-today").textContent = state.orders.filter((order) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(order.createdAt)) === today).length;
    el("metric-month").textContent = rupiah(state.orders.filter((order) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date(order.createdAt)).replace("/", "-") === month).reduce((sum, order) => sum + order.total, 0));
    el("orders-body").innerHTML = orders.map((order) => `<tr>
      <td><b>${escapeHtml(order.orderNumber)}</b></td><td>${escapeHtml(dateTime(order.createdAt))}</td>
      <td><strong>${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.whatsapp)}</small></td><td>${escapeHtml(order.popName)}</td>
      <td>${order.items.map((item) => `<small>${escapeHtml(item.productName)}${item.variant ? ` · ${escapeHtml(item.variantLabel || "Ukuran")}: ${escapeHtml(item.variant)}` : ""} × ${item.quantity}</small>`).join("")}</td>
      <td><b>${rupiah(order.total)}</b></td><td><button class="table-action" data-order="${order.orderNumber}">Detail</button></td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty-table">Belum ada pesanan.</td></tr>`;
  }

  function renderProducts() {
    el("active-products").textContent = `${state.products.filter((product) => product.active).length} barang aktif`;
    el("admin-products").innerHTML = state.products.map((product) => `<article class="admin-product${product.active ? "" : " inactive"}">
      ${visual(product)}<div class="admin-product-copy"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><strong>${rupiah(product.price)}</strong><small>SKU: ${escapeHtml(product.sku)}</small><small>${product.variants.length ? `${escapeHtml(product.variantLabel)}: ${product.variants.map(escapeHtml).join(", ")}` : "Tanpa ukuran/varian"}</small></div>
      <div class="row-actions"><button data-edit-product="${product.id}">Edit</button>${product.active ? `<button data-delete-product="${product.id}">Nonaktifkan</button>` : "<span></span>"}</div>
    </article>`).join("");
  }

  function renderPops() {
    el("pop-list").innerHTML = state.pops.map((pop) => `<div class="pop-row${pop.active ? "" : " inactive"}"><strong>${escapeHtml(pop.name)}</strong><span>${pop.active ? "Aktif" : "Nonaktif"}</span>${pop.active ? `<button data-delete-pop="${pop.id}">Nonaktifkan</button>` : "<span></span>"}</div>`).join("");
  }

  function renderAll() { renderOrders(); renderProducts(); renderPops(); }

  function switchTab(tab) {
    state.tab = tab;
    const titles = { orders: "Daftar pesanan", products: "Pengelolaan barang", pops: "Pengelolaan PoP", maintenance: "Pemeliharaan data" };
    document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
    el(`${tab}-tab`).classList.remove("hidden");
    el("page-title").textContent = titles[tab];
  }

  function openProduct(product = null) {
    state.editingProduct = product;
    const form = el("product-form");
    form.reset();
    el("product-modal-title").textContent = product ? "Edit barang" : "Tambah barang";
    el("active-field").classList.toggle("hidden", !product);
    if (product) {
      for (const field of ["id", "sku", "name", "description", "category", "price", "variantLabel"]) form.elements[field].value = product[field] ?? "";
      form.elements.variants.value = product.variants.join(", ");
      form.elements.active.checked = product.active;
    }
    el("product-modal").classList.remove("hidden");
  }

  function closeModal(id) { el(id).classList.add("hidden"); }

  function showOrder(order) {
    el("order-modal-title").textContent = order.orderNumber;
    el("order-detail").innerHTML = `<div class="order-info"><div><span>Nama pemesan</span><strong>${escapeHtml(order.customerName)}</strong></div><div><span>Asal PoP</span><strong>${escapeHtml(order.popName)}</strong></div><div><span>WhatsApp</span><strong>${escapeHtml(order.whatsapp)}</strong></div><div><span>Tanggal order</span><strong>${escapeHtml(dateTime(order.createdAt))}</strong></div></div>
      <div>${order.items.map((item) => `<div class="order-item-detail">${visual(item, true)}<div><strong>${escapeHtml(item.productName)}</strong><small>${item.variant ? `${escapeHtml(item.variantLabel || "Ukuran")}: ${escapeHtml(item.variant)}` : "Tanpa ukuran"} · ${item.quantity} pcs × ${rupiah(item.unitPrice)}</small></div><b>${rupiah(item.subtotal)}</b></div>`).join("")}</div>
      <div class="order-total-detail"><span>Total nominal</span><strong>${rupiah(order.total)}</strong></div><a class="button primary order-download" href="/api/orders/${encodeURIComponent(order.orderNumber)}/pdf">↓ Download PDF</a>`;
    el("order-modal").classList.remove("hidden");
  }

  function exportCsv() {
    const rows = [["Nomor Order", "Tanggal", "Nama", "WhatsApp", "PoP", "Barang", "Total"], ...state.orders.map((order) => [order.orderNumber, dateTime(order.createdAt), order.customerName, order.whatsapp, order.popName, order.items.map((item) => `${item.productName}${item.variant ? ` (${item.variantLabel}: ${item.variant})` : ""} x${item.quantity}`).join("; "), order.total])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `rekap-order-merchandise-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  el("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api("/api/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
      showAdmin(data.admin); await loadAll();
    } catch (error) { showLogin(error.message); }
  });
  el("logout").addEventListener("click", async () => { await api("/api/admin/session", { method: "DELETE" }).catch(() => {}); showLogin(); });
  document.querySelector(".sidebar nav").addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (button) switchTab(button.dataset.tab); });
  el("order-search").addEventListener("input", renderOrders);
  el("export-orders").addEventListener("click", exportCsv);
  el("orders-body").addEventListener("click", (event) => { const button = event.target.closest("[data-order]"); if (button) showOrder(state.orders.find((order) => order.orderNumber === button.dataset.order)); });
  el("add-product").addEventListener("click", () => openProduct());
  el("admin-products").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-product]");
    if (edit) return openProduct(state.products.find((product) => product.id === edit.dataset.editProduct));
    const remove = event.target.closest("[data-delete-product]");
    if (!remove || !confirm("Nonaktifkan barang ini dari katalog?")) return;
    try { await api(`/api/admin/products/${remove.dataset.deleteProduct}`, { method: "DELETE" }); message("Barang berhasil dinonaktifkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("product-form").elements.category.addEventListener("change", (event) => {
    const form = el("product-form");
    if (["Kaos", "Baju"].includes(event.target.value)) { form.elements.variantLabel.value = "Ukuran"; if (!form.elements.variants.value) form.elements.variants.value = "S, M, L, XL, XXL"; }
    else if (event.target.value === "Sepatu") { form.elements.variantLabel.value = "Nomor sepatu"; if (!form.elements.variants.value) form.elements.variants.value = "38, 39, 40, 41, 42, 43, 44"; }
    else { form.elements.variantLabel.value = ""; form.elements.variants.value = ""; }
  });
  el("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (state.editingProduct) form.set("active", String(event.currentTarget.elements.active.checked));
    try {
      await api(state.editingProduct ? `/api/admin/products/${state.editingProduct.id}` : "/api/admin/products", { method: state.editingProduct ? "PUT" : "POST", body: form });
      closeModal("product-modal"); message(state.editingProduct ? "Barang berhasil diperbarui." : "Barang berhasil ditambahkan."); await loadAll();
    } catch (error) { message(error.message, "error"); }
  });
  el("pop-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api("/api/admin/pops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); event.currentTarget.reset(); message("PoP berhasil ditambahkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("pop-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-pop]"); if (!button || !confirm("Nonaktifkan PoP ini dari pilihan pemesan?")) return;
    try { await api(`/api/admin/pops/${button.dataset.deletePop}`, { method: "DELETE" }); message("PoP berhasil dinonaktifkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("create-backup").addEventListener("click", async () => {
    const button = el("create-backup"); button.disabled = true; button.textContent = "Menyiapkan backup…";
    try { const blob = await api("/api/admin/backup", { method: "POST" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `ainet-merchandise-${new Date().toISOString().slice(0,10)}.merchbackup`; link.click(); URL.revokeObjectURL(url); message("Backup berhasil dibuat dan diunduh."); } catch (error) { message(error.message, "error"); } finally { button.disabled = false; button.textContent = "↓ Buat & download backup"; }
  });
  el("restore-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!confirm("Restore akan mengganti data saat ini. Backup rollback otomatis akan dibuat. Lanjutkan?")) return;
    const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "Memulihkan data…";
    try { const data = await api("/api/admin/restore", { method: "POST", body: form }); message(data.message); event.currentTarget.reset(); await loadAll(); } catch (error) { message(error.message, "error"); } finally { button.disabled = false; button.textContent = "Restore data"; }
  });
  el("password-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const data = await api("/api/admin/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); message(data.message); event.currentTarget.reset(); } catch (error) { message(error.message, "error"); }
  });
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-close-modal]"); if (button) closeModal(button.dataset.closeModal); if (event.target.classList.contains("modal-backdrop")) event.target.classList.add("hidden"); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.classList.add("hidden")); });

  (async () => {
    try { const data = await api("/api/admin/session"); showAdmin(data.admin); await loadAll(); } catch { showLogin(); }
  })();
})();
