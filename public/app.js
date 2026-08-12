(() => {
  const state = { products: [], pops: [], cart: [], category: "Semua", variants: {} };
  const rupiah = (value) => `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const productIcon = (category) => category.toLowerCase().includes("sepatu") ? "👟" : category.toLowerCase().includes("mug") || category.toLowerCase().includes("akses") ? "☕" : "👕";

  function visual(product, compact = false) {
    const image = product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">` : `<span class="placeholder">${productIcon(product.category)}<small>AINET</small></span>`;
    return compact ? `<span class="thumb">${image}</span>` : `<div class="product-image">${image}</div>`;
  }

  function showError(id, message) {
    const target = el(id);
    target.textContent = message;
    target.classList.toggle("hidden", !message);
  }

  function renderTabs() {
    const categories = ["Semua", ...new Set(state.products.map((product) => product.category))];
    el("category-tabs").innerHTML = categories.map((category) => `<button type="button" data-category="${escapeHtml(category)}" class="${category === state.category ? "active" : ""}">${escapeHtml(category)}</button>`).join("");
  }

  function renderProducts() {
    const products = state.category === "Semua" ? state.products : state.products.filter((product) => product.category === state.category);
    el("product-grid").innerHTML = products.map((product) => {
      const selected = state.variants[product.id] || product.variants[0] || "";
      const options = product.variants.map((variant) => `<option${variant === selected ? " selected" : ""}>${escapeHtml(variant)}</option>`).join("");
      return `<article class="product-card">
        ${visual(product)}
        <div class="product-copy"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><strong>${rupiah(product.price)}</strong></div>
        <div class="product-controls">
          ${product.variants.length ? `<label><span>${escapeHtml(product.variantLabel || "Ukuran/varian")}</span><select data-variant="${product.id}">${options}</select></label>` : `<span class="muted">Tanpa ukuran</span>`}
          <button type="button" class="button primary" data-add="${product.id}">+ Tambah</button>
        </div>
      </article>`;
    }).join("") || `<div class="loading-card">Belum ada barang pada kategori ini.</div>`;
  }

  function totals() {
    return {
      count: state.cart.reduce((sum, item) => sum + item.quantity, 0),
      total: state.cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0),
    };
  }

  function renderCart() {
    const summary = totals();
    el("cart-badge").textContent = summary.count;
    el("cart-count").textContent = `${summary.count} barang`;
    el("cart-total").textContent = rupiah(summary.total);
    el("submit-order").disabled = !state.cart.length;
    el("empty-cart").classList.toggle("hidden", Boolean(state.cart.length));
    el("cart-list").innerHTML = state.cart.map((item) => `<div class="cart-item">
      ${visual(item.product, true)}
      <div class="cart-copy"><strong>${escapeHtml(item.product.name)}</strong><small>${item.variant ? `${escapeHtml(item.product.variantLabel)}: ${escapeHtml(item.variant)}` : "Tanpa ukuran"}</small><span>${rupiah(item.product.price * item.quantity)}</span></div>
      <div class="qty"><button type="button" data-qty="-1" data-key="${escapeHtml(item.key)}">${item.quantity === 1 ? "×" : "−"}</button><b>${item.quantity}</b><button type="button" data-qty="1" data-key="${escapeHtml(item.key)}">+</button></div>
    </div>`).join("");
  }

  function addToCart(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const variant = state.variants[product.id] || product.variants[0] || "";
    const key = `${product.id}:${variant}`;
    const existing = state.cart.find((item) => item.key === key);
    if (existing) existing.quantity += 1;
    else state.cart.push({ key, product, variant, quantity: 1 });
    renderCart();
    showError("order-error", "");
  }

  function changeQuantity(key, change) {
    const item = state.cart.find((cartItem) => cartItem.key === key);
    if (!item) return;
    item.quantity += change;
    state.cart = state.cart.filter((cartItem) => cartItem.quantity > 0);
    renderCart();
  }

  async function loadCatalog() {
    try {
      const response = await fetch("/api/catalog");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Katalog gagal dimuat.");
      state.products = data.products;
      state.pops = data.pops;
      state.variants = Object.fromEntries(data.products.map((product) => [product.id, product.variants[0] || ""]));
      el("product-count").textContent = `${data.products.length} barang tersedia`;
      el("pop-select").innerHTML = `<option value="">Pilih PoP</option>${data.pops.map((pop) => `<option value="${pop.id}">${escapeHtml(pop.name)}</option>`).join("")}`;
      renderTabs();
      renderProducts();
    } catch (error) {
      showError("catalog-error", error.message || "Katalog gagal dimuat.");
      el("product-grid").innerHTML = "";
    }
  }

  function showSuccess(data) {
    const { order } = data;
    el("success-number").textContent = order.orderNumber;
    el("success-customer").innerHTML = `<div><span>${escapeHtml(order.customerName)}</span><small>${escapeHtml(order.popName)} · ${escapeHtml(order.whatsapp)}</small></div><strong>${rupiah(order.total)}</strong>`;
    el("success-items").innerHTML = order.items.map((item) => `<div class="receipt-item">${visual({ name: item.productName, category: item.productName, imageUrl: item.imageUrl }, true)}<div><strong>${escapeHtml(item.productName)}</strong><small>${item.variant ? `${escapeHtml(item.variantLabel || "Ukuran/nomor")}: ${escapeHtml(item.variant)}` : "Tanpa ukuran"} · ${item.quantity} pcs</small></div><span>${rupiah(item.subtotal)}</span></div>`).join("");
    el("download-pdf").href = data.pdfUrl;
    el("success-backdrop").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!state.cart.length) return showError("order-error", "Pilih minimal satu barang sebelum mengirim pesanan.");
    const button = el("submit-order");
    const form = new FormData(event.currentTarget);
    button.disabled = true;
    button.textContent = "Menyimpan…";
    showError("order-error", "");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: form.get("customerName"),
          popId: form.get("popId"),
          whatsapp: form.get("whatsapp"),
          items: state.cart.map((item) => ({ productId: item.product.id, variant: item.variant, quantity: item.quantity })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Pesanan gagal disimpan.");
      state.cart = [];
      renderCart();
      event.currentTarget.reset();
      showSuccess(data);
    } catch (error) {
      showError("order-error", error.message || "Pesanan gagal disimpan.");
    } finally {
      button.textContent = "Kirim pesanan →";
      button.disabled = !state.cart.length;
    }
  }

  function closeSuccess() {
    el("success-backdrop").classList.add("hidden");
    document.body.style.overflow = "";
  }

  el("category-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    renderTabs();
    renderProducts();
  });
  el("product-grid").addEventListener("change", (event) => {
    if (event.target.matches("[data-variant]")) state.variants[event.target.dataset.variant] = event.target.value;
  });
  el("product-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (button) addToCart(button.dataset.add);
  });
  el("cart-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-qty]");
    if (button) changeQuantity(button.dataset.key, Number(button.dataset.qty));
  });
  el("order-form").addEventListener("submit", submitOrder);
  el("close-success").addEventListener("click", closeSuccess);
  el("finish-order").addEventListener("click", closeSuccess);
  el("success-backdrop").addEventListener("click", (event) => { if (event.target === el("success-backdrop")) closeSuccess(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSuccess(); });
  renderCart();
  loadCatalog();
})();
