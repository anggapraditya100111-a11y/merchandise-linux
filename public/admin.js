(() => {
  const state = { admin: null, orders: [], products: [], pops: [], categories: [], settings: null, config: null, tab: "orders", editingProduct: null, productImages: [] };
  let draggedImageKey = null;
  let popupLogin = null;
  const el = (id) => document.getElementById(id);
  const rupiah = (value) => `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
  const dateTime = (value) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const icon = (category) => category.toLowerCase().includes("sepatu") ? "👟" : category.toLowerCase().includes("akses") || category.toLowerCase().includes("mug") ? "☕" : "👕";

  function visual(item, compact = false) {
    const imageUrl = item.images?.[0]?.url || item.imageUrl;
    const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || item.productName)}" loading="lazy">` : `<span class="placeholder">${icon(item.category || item.productName || "")}${compact ? "" : `<small>${escapeHtml(state.settings?.appName || "AINET")}</small>`}</span>`;
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

  function applySettings(settings, refreshTheme = false) {
    state.settings = settings;
    document.title = `Admin · ${settings.appName}`;
    document.querySelectorAll("[data-app-name]").forEach((target) => { target.textContent = settings.appName; });
    const initials = settings.appName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "AI";
    document.querySelectorAll("[data-brand-mark]").forEach((target) => {
      target.classList.toggle("has-logo", Boolean(settings.logoUrl));
      target.innerHTML = settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="Logo ${escapeHtml(settings.appName)}">` : escapeHtml(initials);
    });
    const form = el("settings-form");
    for (const field of ["appName", "companyName", "heroEyebrow", "heroTitle", "heroDescription", "adminWhatsapp", "publicBaseUrl", "primaryColor", "secondaryColor", "accentColor"]) form.elements[field].value = settings[field] || "";
    form.elements.removeLogo.checked = false;
    el("remove-logo-field").classList.toggle("hidden", !settings.logoUrl);
    el("logo-preview").classList.toggle("has-image", Boolean(settings.logoUrl));
    el("logo-preview").innerHTML = settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="Logo saat ini">` : escapeHtml(initials);
    if (refreshTheme) document.querySelector('link[href^="/theme.css"]').href = `/theme.css?v=${Date.now()}`;
  }

  function showLogin(error = "") {
    state.admin = null;
    el("admin-view").classList.add("hidden");
    el("login-view").classList.remove("hidden");
    el("login-error").textContent = error;
    el("login-error").classList.toggle("hidden", !error);
    const ready = Boolean(state.config?.auth?.accessHandoffReady);
    el("access-login").disabled = !ready;
    el("access-login-status").textContent = ready
      ? `Login aman melalui ${new URL(state.config.auth.accessPortalUrl).hostname}.`
      : "Koneksi AXINDO Access pada server belum aktif. Gunakan login admin lokal.";
    el("local-login-toggle").open = !ready;
  }

  function showAdmin(admin) {
    state.admin = admin;
    el("login-view").classList.add("hidden");
    el("admin-view").classList.remove("hidden");
    const displayName = admin.name || admin.username;
    el("admin-name").textContent = displayName;
    el("admin-initial").textContent = displayName.slice(0, 1).toUpperCase();
    el("admin-auth-source").textContent = admin.authSource === "ACCESS" ? "AXINDO ID · Super Admin" : "Admin lokal";
    el("local-password-card").classList.toggle("hidden", admin.authSource === "ACCESS");
  }

  function randomPopupChannel() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return `merch_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function randomPopupVerifier() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  }

  async function popupCodeChallenge(verifier) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  }

  function accessHandoffStorageKey(channel) {
    return `merchandise-handoff:${channel}`;
  }

  async function completeRedirectedAccessHandoff() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (params.get("access_handoff") !== "1") return false;
    const channel = String(params.get("channel") || "");
    const code = String(params.get("code") || "");
    const verifier = sessionStorage.getItem(accessHandoffStorageKey(channel)) || "";
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    if (!/^merch_[a-f0-9]{48}$/.test(channel) || !/^[a-zA-Z0-9_-]{40,200}$/.test(code) || !/^[a-zA-Z0-9_-]{43,128}$/.test(verifier)) {
      throw new Error("Kode login dari AXINDO Access tidak valid atau sudah kedaluwarsa.");
    }
    await api("/api/auth/access/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier }) });
    sessionStorage.removeItem(accessHandoffStorageKey(channel));
    if (window.name === channel) {
      window.close();
      window.setTimeout(() => window.location.replace("/admin"), 250);
    }
    return true;
  }

  async function finishPopupLogin(success, error = "") {
    const active = popupLogin;
    if (!active) return;
    popupLogin = null;
    window.clearInterval(active.monitor);
    sessionStorage.removeItem(accessHandoffStorageKey(active.channel));
    if (active.window && !active.window.closed) active.window.close();
    el("access-login").disabled = !state.config?.auth?.accessHandoffReady;
    if (!success) return showLogin(error || "Login AXINDO ID belum berhasil.");
    const data = await api("/api/admin/session");
    showAdmin(data.admin);
    await loadAll();
    message("Login AXINDO ID berhasil.");
  }

  async function startAccessPopupLogin() {
    const access = state.config?.auth;
    if (!access?.accessHandoffReady) return showLogin("Koneksi AXINDO Access pada server belum aktif.");
    if (popupLogin?.window && !popupLogin.window.closed) return popupLogin.window.focus();
    const channel = randomPopupChannel();
    const verifier = randomPopupVerifier();
    sessionStorage.setItem(accessHandoffStorageKey(channel), verifier);
    const width = Math.min(470, Math.max(360, window.screen.availWidth - 24));
    const height = Math.min(760, Math.max(600, window.screen.availHeight - 48));
    const popup = window.open("about:blank", channel, `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`);
    if (!popup) {
      sessionStorage.removeItem(accessHandoffStorageKey(channel));
      return showLogin("Popup diblokir browser. Izinkan popup untuk katalog lalu coba kembali.");
    }
    popupLogin = {
      window: popup,
      channel,
      verifier,
      stage: "preparing",
      accessOrigin: access.accessPortalOrigin,
      monitor: window.setInterval(() => {
        const active = popupLogin;
        if (!active || !popup.closed) {
          if (active) active.closedAt = 0;
          return;
        }
        if (active.stage === "exchange") return;
        if (!active.closedAt) return void (active.closedAt = Date.now());
        if (Date.now() - active.closedAt < 1500 || active.checkingSession) return;
        active.checkingSession = true;
        api("/api/admin/session").then(() => finishPopupLogin(true)).catch(() => finishPopupLogin(false, "Popup login ditutup sebelum proses selesai."));
      }, 250),
    };
    el("access-login").disabled = true;
    el("access-login-status").textContent = "Membuka AXINDO Access…";
    popup.focus();
    try {
      const accessUrl = new URL(access.accessPortalPopupUrl);
      accessUrl.searchParams.set("handoff", "merchandise");
      accessUrl.searchParams.set("channel", channel);
      accessUrl.searchParams.set("return_origin", window.location.origin);
      accessUrl.searchParams.set("code_challenge", await popupCodeChallenge(verifier));
      if (!popupLogin || popup.closed) return;
      popupLogin.stage = "access";
      popup.location.replace(accessUrl.href);
      el("access-login-status").textContent = "Menunggu login dari AXINDO Access…";
    } catch {
      finishPopupLogin(false, "Popup AXINDO Access tidak dapat dibuka.");
    }
  }

  function handlePopupLoginMessage(event) {
    const active = popupLogin;
    if (!active || event.source !== active.window || event.data?.channel !== active.channel) return;
    if (active.stage !== "access" || event.origin !== active.accessOrigin || event.data?.type !== "axindo-access-handoff") return;
    if (event.data.status !== "success") return finishPopupLogin(false, event.data.message || "Login AXINDO Access gagal.");
    if (!/^[a-zA-Z0-9_-]{40,200}$/.test(String(event.data.code || ""))) return finishPopupLogin(false, "Kode AXINDO Access tidak valid.");
    active.stage = "exchange";
    el("access-login-status").textContent = "Membuat sesi admin…";
    api("/api/auth/access/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: event.data.code, verifier: active.verifier }),
    }).then(() => finishPopupLogin(true)).catch((error) => finishPopupLogin(false, error.message));
  }

  async function loadAll() {
    const [orders, products, pops, categories, settings] = await Promise.all([
      api("/api/admin/orders"), api("/api/admin/products"), api("/api/admin/pops"), api("/api/admin/categories"), api("/api/admin/settings"),
    ]);
    state.orders = orders.orders;
    state.products = products.products;
    state.pops = pops.pops;
    state.categories = categories.categories;
    applySettings(settings.settings);
    renderAll();
  }

  function renderOrders() {
    const query = el("order-search").value.trim().toLowerCase();
    const orders = state.orders.filter((order) => !query || [order.orderNumber, order.customerName, order.popName, order.whatsapp, order.note].some((value) => String(value || "").toLowerCase().includes(query)));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const month = today.slice(0, 7);
    el("metric-orders").textContent = state.orders.length;
    el("metric-today").textContent = state.orders.filter((order) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(order.createdAt)) === today).length;
    el("metric-month").textContent = rupiah(state.orders.filter((order) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date(order.createdAt)).replace("/", "-") === month).reduce((sum, order) => sum + order.total, 0));
    el("orders-body").innerHTML = orders.map((order) => `<tr>
      <td><b>${escapeHtml(order.orderNumber)}</b></td><td>${escapeHtml(dateTime(order.createdAt))}</td>
      <td><strong>${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.whatsapp)}</small></td><td>${escapeHtml(order.popName)}</td>
      <td>${order.items.map((item) => `<small>${escapeHtml(item.productName)}${item.variant ? ` · ${escapeHtml(item.variantLabel || "Ukuran")}: ${escapeHtml(item.variant)}` : ""} × ${item.quantity}</small>`).join("")}</td>
      <td><b>${rupiah(order.total)}</b></td><td><span class="table-actions"><button class="table-action" data-order="${order.orderNumber}">Detail</button><button class="table-action danger-text" data-delete-order="${order.orderNumber}">Hapus</button></span></td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty-table">Belum ada pesanan.</td></tr>`;
  }

  function renderProducts() {
    el("active-products").textContent = `${state.products.filter((product) => product.active).length} barang aktif`;
    el("admin-products").innerHTML = state.products.map((product) => `<article class="admin-product${product.active ? "" : " inactive"}">
      ${visual(product)}<div class="admin-product-copy"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><strong>${rupiah(product.price)}</strong><small>SKU: ${escapeHtml(product.sku)}</small><small>${product.images.length} foto · ${product.variants.length ? `${escapeHtml(product.variantLabel)}: ${product.variants.map(escapeHtml).join(", ")}` : "Tanpa ukuran/varian"}</small></div>
      <div class="row-actions"><button data-edit-product="${product.id}">Edit</button>${product.active ? `<button data-delete-product="${product.id}">Nonaktifkan</button>` : "<span></span>"}</div>
    </article>`).join("");
  }

  function renderPops() {
    el("pop-list").innerHTML = state.pops.map((pop) => `<div class="pop-row${pop.active ? "" : " inactive"}"><strong>${escapeHtml(pop.name)}</strong><span>${pop.active ? "Aktif" : "Nonaktif"}</span><div class="inline-actions"><button data-edit-pop="${pop.id}">Edit</button>${pop.active ? `<button data-delete-pop="${pop.id}">Nonaktifkan</button>` : ""}</div></div>`).join("");
  }

  function renderCategories() {
    el("category-list").innerHTML = state.categories.map((category) => {
      const used = state.products.filter((product) => product.category.toLowerCase() === category.name.toLowerCase()).length;
      return `<div class="pop-row"><strong>${escapeHtml(category.name)}</strong><span>${used} barang</span><div class="inline-actions"><button data-edit-category="${category.id}">Edit</button><button data-delete-category="${category.id}">Hapus</button></div></div>`;
    }).join("") || `<div class="empty-table">Belum ada kategori.</div>`;
  }

  function renderCategoryOptions(selected = "") {
    const select = el("product-form").elements.category;
    select.innerHTML = state.categories.map((category) => `<option value="${escapeHtml(category.name)}"${category.name === selected ? " selected" : ""}>${escapeHtml(category.name)}</option>`).join("");
  }

  function renderAll() {
    renderOrders();
    renderProducts();
    renderPops();
    renderCategories();
    renderCategoryOptions(state.editingProduct?.category || "");
  }

  function switchTab(tab) {
    state.tab = tab;
    const titles = { orders: "Daftar pesanan", products: "Pengelolaan barang", settings: "Pengaturan aplikasi", maintenance: "Pemeliharaan data" };
    document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
    el(`${tab}-tab`).classList.remove("hidden");
    el("page-title").textContent = titles[tab];
  }

  function switchSettingsSection(section) {
    document.querySelectorAll("[data-settings-section]").forEach((button) => button.classList.toggle("active", button.dataset.settingsSection === section));
    document.querySelectorAll(".settings-section").forEach((panel) => panel.classList.add("hidden"));
    el(`${section}-settings`).classList.remove("hidden");
  }

  function clearStagedProductImages() {
    for (const image of state.productImages) if (image.type === "new") URL.revokeObjectURL(image.url);
    state.productImages = [];
  }

  function renderProductImages() {
    el("product-image-list").innerHTML = state.productImages.map((image, index) => `<article class="product-image-thumb" draggable="true" data-image-key="${escapeHtml(image.key)}"><img src="${escapeHtml(image.url)}" alt="Foto ${index + 1}"><span>${index === 0 ? "Utama" : index + 1}</span><button type="button" data-remove-product-image="${escapeHtml(image.key)}" aria-label="Hapus foto">×</button><small>⋮⋮ Seret</small></article>`).join("") || `<div class="image-upload-empty">Belum ada foto.</div>`;
    el("image-limit-help").textContent = `${state.productImages.length}/5 foto. Setelah upload, seret thumbnail untuk mengatur urutannya. Foto pertama menjadi foto utama.`;
    el("image-limit-help").classList.toggle("error-text", state.productImages.length > 5);
  }

  function addProductImage() {
    const picker = el("product-image-picker");
    const file = picker.files[0];
    if (!file) return message("Pilih file foto terlebih dahulu.", "error");
    if (state.productImages.length >= 5) return message("Foto barang maksimal 5.", "error");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return message("Foto harus berformat JPG, PNG, atau WebP.", "error");
    if (file.size > 5 * 1024 * 1024) return message("Ukuran setiap foto maksimal 5 MB.", "error");
    state.productImages.push({ key: `new-${Date.now()}-${Math.random()}`, type: "new", file, url: URL.createObjectURL(file) });
    picker.value = "";
    renderProductImages();
  }

  function openProduct(product = null) {
    clearStagedProductImages();
    state.editingProduct = product;
    const form = el("product-form");
    form.reset();
    el("product-modal-title").textContent = product ? "Edit barang" : "Tambah barang";
    el("active-field").classList.toggle("hidden", !product);
    renderCategoryOptions(product?.category || "");
    if (product) {
      for (const field of ["id", "sku", "name", "description", "category", "price", "variantLabel"]) form.elements[field].value = product[field] ?? "";
      form.elements.variants.value = product.variants.join(", ");
      form.elements.active.checked = product.active;
    }
    state.productImages = (product?.images || []).map((image) => ({ key: `existing-${image.id}`, type: "existing", id: image.id, url: image.url }));
    renderProductImages();
    el("product-modal").classList.remove("hidden");
  }

  function closeModal(id) { el(id).classList.add("hidden"); }

  function showOrder(order) {
    el("order-modal-title").textContent = order.orderNumber;
    el("order-detail").innerHTML = `<div class="order-info"><div><span>Nama pemesan</span><strong>${escapeHtml(order.customerName)}</strong></div><div><span>Asal PoP</span><strong>${escapeHtml(order.popName)}</strong></div><div><span>WhatsApp</span><strong>${escapeHtml(order.whatsapp)}</strong></div><div><span>Tanggal order</span><strong>${escapeHtml(dateTime(order.createdAt))}</strong></div>${order.note ? `<div class="order-note"><span>Catatan</span><strong>${escapeHtml(order.note)}</strong></div>` : ""}</div>
      <div>${order.items.map((item) => `<div class="order-item-detail">${visual(item, true)}<div><strong>${escapeHtml(item.productName)}</strong><small>${item.variant ? `${escapeHtml(item.variantLabel || "Ukuran")}: ${escapeHtml(item.variant)}` : "Tanpa ukuran"} · ${item.quantity} pcs × ${rupiah(item.unitPrice)}</small></div><b>${rupiah(item.subtotal)}</b></div>`).join("")}</div>
      <div class="order-total-detail"><span>Total nominal</span><strong>${rupiah(order.total)}</strong></div><div class="modal-actions"><button class="button danger" type="button" data-delete-order="${escapeHtml(order.orderNumber)}">Hapus pesanan</button><a class="button primary order-download" href="/api/orders/${encodeURIComponent(order.orderNumber)}/pdf">↓ Download PDF</a></div>`;
    el("order-modal").classList.remove("hidden");
  }

  function exportCsv() {
    const rows = [["Nomor Order", "Tanggal", "Nama", "WhatsApp", "PoP", "Catatan", "Barang", "Total"], ...state.orders.map((order) => [order.orderNumber, dateTime(order.createdAt), order.customerName, order.whatsapp, order.popName, order.note, order.items.map((item) => `${item.productName}${item.variant ? ` (${item.variantLabel}: ${item.variant})` : ""} x${item.quantity}`).join("; "), order.total])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `rekap-order-merchandise-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  function startPopEdit(pop = null) {
    const form = el("pop-form");
    form.reset();
    form.elements.id.value = pop?.id || "";
    form.elements.name.value = pop?.name || "";
    el("pop-form-title").textContent = pop ? "Edit PoP" : "Tambah PoP";
    el("pop-submit").textContent = pop ? "Simpan perubahan" : "+ Tambahkan PoP";
    el("cancel-pop-edit").classList.toggle("hidden", !pop);
  }

  function startCategoryEdit(category = null) {
    const form = el("category-form");
    form.reset();
    form.elements.id.value = category?.id || "";
    form.elements.name.value = category?.name || "";
    el("category-form-title").textContent = category ? "Edit kategori" : "Tambah kategori";
    el("category-submit").textContent = category ? "Simpan perubahan" : "+ Tambahkan kategori";
    el("cancel-category-edit").classList.toggle("hidden", !category);
  }

  el("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api("/api/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
      showAdmin(data.admin); await loadAll();
    } catch (error) { showLogin(error.message); }
  });
  el("access-login").addEventListener("click", startAccessPopupLogin);
  window.addEventListener("message", handlePopupLoginMessage);
  el("logout").addEventListener("click", async () => { await api("/api/admin/session", { method: "DELETE" }).catch(() => {}); showLogin(); });
  document.querySelector(".sidebar nav").addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (button) switchTab(button.dataset.tab); });
  document.querySelector(".settings-subnav").addEventListener("click", (event) => { const button = event.target.closest("[data-settings-section]"); if (button) switchSettingsSection(button.dataset.settingsSection); });
  el("order-search").addEventListener("input", renderOrders);
  el("export-orders").addEventListener("click", exportCsv);
  async function removeOrder(orderNumber) {
    const order = state.orders.find((item) => item.orderNumber === orderNumber);
    if (!order || !confirm(`Hapus pesanan ${orderNumber} atas nama ${order.customerName}? Data yang dihapus tidak dapat dikembalikan kecuali melalui backup.`)) return;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(orderNumber)}`, { method: "DELETE" });
      closeModal("order-modal");
      message(`Pesanan ${orderNumber} berhasil dihapus.`);
      await loadAll();
    } catch (error) { message(error.message, "error"); }
  }
  el("orders-body").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-order]");
    if (remove) return removeOrder(remove.dataset.deleteOrder);
    const button = event.target.closest("[data-order]");
    if (button) showOrder(state.orders.find((order) => order.orderNumber === button.dataset.order));
  });
  el("order-detail").addEventListener("click", (event) => { const button = event.target.closest("[data-delete-order]"); if (button) removeOrder(button.dataset.deleteOrder); });
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
    const category = event.target.value.toLowerCase();
    if (["kaos", "baju", "kemeja"].some((keyword) => category.includes(keyword))) { form.elements.variantLabel.value = "Ukuran"; if (!form.elements.variants.value) form.elements.variants.value = "S, M, L, XL, XXL"; }
    else if (category.includes("sepatu")) { form.elements.variantLabel.value = "Nomor sepatu"; if (!form.elements.variants.value) form.elements.variants.value = "38, 39, 40, 41, 42, 43, 44"; }
  });
  el("add-product-image").addEventListener("click", addProductImage);
  el("product-image-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-product-image]");
    if (!button) return;
    const index = state.productImages.findIndex((image) => image.key === button.dataset.removeProductImage);
    if (index < 0) return;
    const [removed] = state.productImages.splice(index, 1);
    if (removed.type === "new") URL.revokeObjectURL(removed.url);
    renderProductImages();
  });
  el("product-image-list").addEventListener("dragstart", (event) => {
    const item = event.target.closest("[data-image-key]");
    if (!item) return;
    draggedImageKey = item.dataset.imageKey;
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  el("product-image-list").addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; });
  el("product-image-list").addEventListener("drop", (event) => {
    event.preventDefault();
    const target = event.target.closest("[data-image-key]");
    if (!target || !draggedImageKey || target.dataset.imageKey === draggedImageKey) return;
    const from = state.productImages.findIndex((image) => image.key === draggedImageKey);
    const to = state.productImages.findIndex((image) => image.key === target.dataset.imageKey);
    if (from < 0 || to < 0) return;
    const [moved] = state.productImages.splice(from, 1);
    state.productImages.splice(to, 0, moved);
    renderProductImages();
  });
  el("product-image-list").addEventListener("dragend", () => { draggedImageKey = null; renderProductImages(); });
  el("product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.productImages.length > 5) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const keptIds = new Set(state.productImages.filter((image) => image.type === "existing").map((image) => image.id));
    const removedIds = (state.editingProduct?.images || []).filter((image) => !keptIds.has(image.id)).map((image) => image.id);
    const imageOrder = [];
    let newIndex = 0;
    for (const image of state.productImages) {
      if (image.type === "existing") imageOrder.push(`existing:${image.id}`);
      else { form.append("images", image.file, image.file.name); imageOrder.push(`new:${newIndex}`); newIndex += 1; }
    }
    form.set("removeImageIds", JSON.stringify(removedIds));
    form.set("imageOrder", JSON.stringify(imageOrder));
    if (state.editingProduct) form.set("active", String(formElement.elements.active.checked));
    try {
      await api(state.editingProduct ? `/api/admin/products/${state.editingProduct.id}` : "/api/admin/products", { method: state.editingProduct ? "PUT" : "POST", body: form });
      closeModal("product-modal"); message(state.editingProduct ? "Barang berhasil diperbarui." : "Barang berhasil ditambahkan."); state.editingProduct = null; clearStagedProductImages(); await loadAll();
    } catch (error) { message(error.message, "error"); }
  });
  el("pop-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const id = form.get("id");
    try { await api(id ? `/api/admin/pops/${id}` : "/api/admin/pops", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) }); startPopEdit(); message(id ? "PoP berhasil diperbarui." : "PoP berhasil ditambahkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("cancel-pop-edit").addEventListener("click", () => startPopEdit());
  el("pop-list").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-pop]");
    if (edit) return startPopEdit(state.pops.find((pop) => pop.id === edit.dataset.editPop));
    const button = event.target.closest("[data-delete-pop]"); if (!button || !confirm("Nonaktifkan PoP ini dari pilihan pemesan?")) return;
    try { await api(`/api/admin/pops/${button.dataset.deletePop}`, { method: "DELETE" }); message("PoP berhasil dinonaktifkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("category-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const id = form.get("id");
    try { await api(id ? `/api/admin/categories/${id}` : "/api/admin/categories", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) }); startCategoryEdit(); message(id ? "Kategori berhasil diperbarui." : "Kategori berhasil ditambahkan."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("cancel-category-edit").addEventListener("click", () => startCategoryEdit());
  el("category-list").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-category]");
    if (edit) return startCategoryEdit(state.categories.find((category) => category.id === edit.dataset.editCategory));
    const button = event.target.closest("[data-delete-category]"); if (!button || !confirm("Hapus kategori ini? Kategori yang masih digunakan barang tidak dapat dihapus.")) return;
    try { await api(`/api/admin/categories/${button.dataset.deleteCategory}`, { method: "DELETE" }); message("Kategori berhasil dihapus."); await loadAll(); } catch (error) { message(error.message, "error"); }
  });
  el("settings-form").elements.logo.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return applySettings(state.settings);
    el("logo-preview").classList.add("has-image");
    el("logo-preview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pratinjau logo">`;
  });
  el("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("removeLogo", String(formElement.elements.removeLogo.checked));
    try { const data = await api("/api/admin/settings", { method: "PUT", body: form }); applySettings(data.settings, true); message("Pengaturan aplikasi berhasil disimpan."); } catch (error) { message(error.message, "error"); }
  });
  el("create-backup").addEventListener("click", async () => {
    const button = el("create-backup"); button.disabled = true; button.textContent = "Menyiapkan backup…";
    try { const blob = await api("/api/admin/backup", { method: "POST" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `ainet-merchandise-${new Date().toISOString().slice(0,10)}.merchbackup`; link.click(); URL.revokeObjectURL(url); message("Backup berhasil dibuat dan diunduh."); } catch (error) { message(error.message, "error"); } finally { button.disabled = false; button.textContent = "↓ Buat & download backup"; }
  });
  el("restore-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!confirm("Restore akan mengganti data saat ini. Backup rollback otomatis akan dibuat. Lanjutkan?")) return;
    const formElement = event.currentTarget; const form = new FormData(formElement); const button = formElement.querySelector("button"); button.disabled = true; button.textContent = "Memulihkan data…";
    try { const data = await api("/api/admin/restore", { method: "POST", body: form }); message(data.message); formElement.reset(); await loadAll(); } catch (error) { message(error.message, "error"); } finally { button.disabled = false; button.textContent = "Restore data"; }
  });
  el("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get("newPassword") !== form.get("confirmPassword")) return message("Konfirmasi password baru tidak sama.", "error");
    try { const data = await api("/api/admin/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); message(data.message); formElement.reset(); } catch (error) { message(error.message, "error"); }
  });
  el("password-form").addEventListener("click", (event) => {
    const button = event.target.closest("[data-toggle-password]");
    if (!button) return;
    const input = button.parentElement.querySelector("input");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "👁" : "🙈";
    button.setAttribute("aria-label", showing ? "Tampilkan password" : "Sembunyikan password");
  });
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-close-modal]"); if (button) closeModal(button.dataset.closeModal); if (event.target.classList.contains("modal-backdrop")) event.target.classList.add("hidden"); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.classList.add("hidden")); });

  (async () => {
    try { const publicSettings = await api("/api/settings"); applySettings(publicSettings.settings); } catch {}
    try { state.config = await api("/api/public/config"); } catch { state.config = { auth: { accessHandoffReady: false } }; }
    try { await completeRedirectedAccessHandoff(); } catch (error) { showLogin(error.message); return; }
    try { const data = await api("/api/admin/session"); showAdmin(data.admin); await loadAll(); } catch { showLogin(); }
  })();
})();
