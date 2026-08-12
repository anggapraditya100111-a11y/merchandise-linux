const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { UPLOAD_DIR } = require("./db");

function rupiah(value) {
  return `Rp${new Intl.NumberFormat("id-ID").format(value)}`;
}

function dateTime(value) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

function safeImage(filename) {
  if (!filename) return null;
  const target = path.resolve(UPLOAD_DIR, filename);
  if (!target.startsWith(`${UPLOAD_DIR}${path.sep}`) || !fs.existsSync(target)) return null;
  return target;
}

function renderOrderPdf(res, order, settings) {
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: `Order ${order.orderNumber}` } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="order-${order.orderNumber}.pdf"`);
  doc.pipe(res);

  const primaryColor = settings.primaryColor || "#0a3f8d";
  doc.rect(0, 0, 595.28, 128).fill(primaryColor);
  const logoPath = safeImage(settings.logoFilename);
  let brandX = 42;
  if (logoPath) {
    try {
      doc.image(logoPath, 42, 31, { fit: [52, 52], align: "center", valign: "center" });
      brandX = 108;
    } catch {}
  }
  doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text(settings.appName, brandX, 38, { width: 220 });
  doc.fontSize(9).font("Helvetica").fillColor("#c9dbf5").text(settings.companyName.toUpperCase(), brandX, 68, { width: 220, characterSpacing: 1.2 });
  doc.fontSize(10).fillColor("#ffffff").text("BUKTI PEMESANAN MERCHANDISE", 340, 43, { width: 213, align: "right" });
  doc.fontSize(16).font("Helvetica-Bold").text(order.orderNumber, 330, 65, { width: 223, align: "right" });

  doc.fillColor("#102039").font("Helvetica-Bold").fontSize(13).text("Data pemesan", 42, 154);
  const details = [
    ["Nama", order.customerName],
    ["Asal PoP", order.popName],
    ["Nomor WhatsApp", order.whatsapp],
    ["Tanggal order", dateTime(order.createdAt)],
  ];
  let y = 180;
  for (const [label, value] of details) {
    doc.font("Helvetica").fontSize(9).fillColor("#657289").text(label, 42, y, { width: 105 });
    doc.font("Helvetica-Bold").fillColor("#102039").text(String(value), 150, y, { width: 402 });
    y += 20;
  }

  if (order.note) {
    const noteHeight = Math.min(76, doc.heightOfString(order.note, { width: 402 }));
    doc.font("Helvetica").fontSize(9).fillColor("#657289").text("Catatan", 42, y, { width: 105 });
    doc.font("Helvetica").fillColor("#102039").text(order.note, 150, y, { width: 402, height: noteHeight, ellipsis: true });
    y += Math.max(22, noteHeight + 6);
  }

  y += 15;
  doc.font("Helvetica-Bold").fontSize(13).text("Rincian barang", 42, y);
  y += 25;

  for (const item of order.items) {
    if (y > 685) {
      doc.addPage();
      y = 48;
    }
    doc.roundedRect(42, y, 511, 78, 5).fillAndStroke("#f3f6fa", "#dfe5ee");
    const imagePath = safeImage(item.imageFilename);
    if (imagePath) {
      try {
        doc.image(imagePath, 52, y + 10, { fit: [58, 58], align: "center", valign: "center" });
      } catch {
        doc.roundedRect(52, y + 10, 58, 58, 4).fill("#eaf1fb");
      }
    } else {
      doc.roundedRect(52, y + 10, 58, 58, 4).fill("#eaf1fb");
      doc.fillColor("#0a3f8d").font("Helvetica-Bold").fontSize(8).text("AINET", 52, y + 35, { width: 58, align: "center" });
    }
    doc.fillColor("#102039").font("Helvetica-Bold").fontSize(11).text(item.productName, 122, y + 12, { width: 260 });
    doc.fillColor("#657289").font("Helvetica").fontSize(9).text(`SKU: ${item.sku}`, 122, y + 31);
    const variant = item.variant ? `${item.variantLabel || "Ukuran/nomor"}: ${item.variant}` : "Tanpa ukuran/varian";
    doc.text(`${variant}  ·  ${item.quantity} pcs × ${rupiah(item.unitPrice)}`, 122, y + 48, { width: 295 });
    doc.fillColor("#102039").font("Helvetica-Bold").fontSize(11).text(rupiah(item.subtotal), 410, y + 30, { width: 130, align: "right" });
    y += 90;
  }

  if (y > 710) {
    doc.addPage();
    y = 50;
  }
  doc.moveTo(350, y + 7).lineTo(553, y + 7).strokeColor("#dfe5ee").stroke();
  doc.fillColor("#657289").font("Helvetica").fontSize(10).text("Total nominal", 350, y + 22);
  doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(18).text(rupiah(order.total), 400, y + 17, { width: 153, align: "right" });
  doc.fillColor("#657289").font("Helvetica").fontSize(8.5)
    .text("Dokumen ini adalah bukti pencatatan order dan bukan bukti pembayaran. Silakan konfirmasi kepada admin kantor pusat.", 42, 760, { width: 511, align: "center" });
  doc.end();
}

module.exports = { renderOrderPdf };
