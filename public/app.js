(() => {
  const state = { products: [], pops: [], cart: [], category: "Semua", variants: {}, slides: {}, settings: null };
  const rupiah = (value) => `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const productIcon = (category) => category.toLowerCase().includes("sepatu") ? "👟" : category.toLowerCase().includes("mug") || category.toLowerCase().includes("akses") ? "☕" : "👕";

  function imageList(product) {
    if (Array.isArray(product.images) && product.images.length) return product.images.map((image) => ({ url: image.url }));
    return product.imageUrl ? [{ url: product.imageUrl }] : [];
  }

  function compactVisual(product) {
    const image = imageList(product)[0];
    return `<span class="thumb">${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(product.name || product.productName)}" loading="lazy">` : `<span class="placeholder">${productIcon(product.category || product.productName || "")}</span>`}</span>`;
  }

  function productGallery(product) {
    const images = imageList(product);
    if (!images.length) return `<div class="product-image"><span class="placeholder">${productIcon(product.category)}<small>${escapeHtml(state.settings?.appName || "AINET")}</small></span></div>`;
    const current = Math.min(state.slides[product.id] || 0, images.length - 1);
    state.slides[product.id] = current;
    return `<div class="product-gallery" data-gallery="${escapeHtml(product.id)}">
      <div class="product-slides">${images.map((image, index) => `<img class="${index === current ? "active" : ""}" src="${escapeHtml(image.url)}" alt="${escapeHtml(product.name)} — foto ${index + 1}" loading="lazy">`).join("")}</div>
      ${images.length > 1 ? `<button class="gallery-arrow previous" type="button" data-slide="-1" data-product="${escapeHtml(product.id)}" aria-label="Foto sebelumnya">‹</button><button class="gallery-arrow next" type="button" data-slide="1" data-product="${escapeHtml(product.id)}" aria-label="Foto berikutnya">›</button><div class="gallery-dots">${images.map((_, index) => `<button type="button" class="${index === current ? "active" : ""}" data-slide-index="${index}" data-product="${escapeHtml(product.id)}" aria-label="Lihat foto ${index + 1}"></button>`).join("")}</div>` : ""}
    </div>`;
  }

  function applySettings(settings) {
    state.settings = settings;
    document.title = settings.appName;
    document.querySelectorAll("[data-app-name]").forEach((target) => { target.textContent = settings.appName; });
    el("footer-company").textContent = `Internal order catalog · ${settings.companyName}`;
    const initials = settings.appName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "AI";
    document.querySelectorAll("[data-brand-mark]").forEach((target) => {
      target.classList.toggle("has-logo", Boolean(settings.logoUrl));
      target.innerHTML = settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="Logo ${escapeHtml(settings.appName)}">` : escapeHtml(initials);
    });
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
        ${productGallery(product)}
        <div class="product-copy"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><strong>${rupiah(product.price)}</strong></div>
        <div class="product-controls">
          ${product.variants.length ? `<label><span>${escapeHtml(product.variantLabel || "Ukuran/varian")}</span><select data-variant="${product.id}">${options}</select></label>` : `<span class="muted">Tanpa ukuran</span>`}
          <button type="button" class="button primary" data-add="${product.id}">+ Tambah</button>
        </div>
      </article>`;
    }).join("") || `<div class="loading-card">Belum ada barang pada kategori ini.</div>`;
  }

  function setSlide(productId, nextIndex) {
    const product = state.products.find((item) => item.id === productId);
    const count = imageList(product || {}).length;
    if (!count) return;
    const current = state.slides[productId] || 0;
    const index = ((nextIndex(current) % count) + count) % count;
    state.slides[productId] = index;
    const gallery = document.querySelector(`[data-gallery="${productId}"]`);
    if (!gallery) return;
    gallery.querySelectorAll(".product-slides img").forEach((image, imageIndex) => image.classList.toggle("active", imageIndex === index));
    gallery.querySelectorAll(".gallery-dots button").forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === index));
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
      ${compactVisual(item.product)}
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
      applySettings(data.settings);
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
    el("success-customer").innerHTML = `<div><span>${escapeHtml(order.customerName)}</span><small>${escapeHtml(order.popName)} · ${escapeHtml(order.whatsapp)}</small>${order.note ? `<small class="receipt-note">Catatan: ${escapeHtml(order.note)}</small>` : ""}</div><strong>${rupiah(order.total)}</strong>`;
    el("success-items").innerHTML = order.items.map((item) => `<div class="receipt-item">${compactVisual({ name: item.productName, category: item.productName, imageUrl: item.imageUrl })}<div><strong>${escapeHtml(item.productName)}</strong><small>${item.variant ? `${escapeHtml(item.variantLabel || "Ukuran/nomor")}: ${escapeHtml(item.variant)}` : "Tanpa ukuran"} · ${item.quantity} pcs</small></div><span>${rupiah(item.subtotal)}</span></div>`).join("");
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
          note: form.get("note"),
          items: state.cart.map((item) => ({ productId: item.product.id, variant: item.variant, quantity: item.quantity })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Pesanan gagal disimpan.");
      state.cart = [];
      renderCart();
      event.currentTarget.reset();
      el("note-count").textContent = "0/500";
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
    const indexButton = event.target.closest("[data-slide-index]");
    if (indexButton) return setSlide(indexButton.dataset.product, () => Number(indexButton.dataset.slideIndex));
    const slideButton = event.target.closest("[data-slide]");
    if (slideButton) return setSlide(slideButton.dataset.product, (current) => current + Number(slideButton.dataset.slide));
    const addButton = event.target.closest("[data-add]");
    if (addButton) addToCart(addButton.dataset.add);
  });
  el("cart-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-qty]");
    if (button) changeQuantity(button.dataset.key, Number(button.dataset.qty));
  });
  el("order-form").elements.note.addEventListener("input", (event) => { el("note-count").textContent = `${event.target.value.length}/500`; });
  el("order-form").addEventListener("submit", submitOrder);
  el("close-success").addEventListener("click", closeSuccess);
  el("finish-order").addEventListener("click", closeSuccess);
  el("success-backdrop").addEventListener("click", (event) => { if (event.target === el("success-backdrop")) closeSuccess(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSuccess(); });
  renderCart();
  loadCatalog();
})();
