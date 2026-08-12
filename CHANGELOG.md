# Changelog

## 1.0.0 — 2026-08-12

- Katalog publik tanpa login dan tanpa pembayaran.
- Keranjang dengan pilihan ukuran baju, nomor sepatu, atau varian lain langsung per barang.
- Pendataan nama pemesan, asal PoP, dan nomor WhatsApp.
- Nomor order otomatis serta popup konfirmasi setelah order tersimpan.
- PDF order lengkap dengan gambar, ukuran/nomor, jumlah, harga, dan total nominal.
- Panel admin untuk pesanan, barang, gambar, varian, PoP, rekap CSV, dan password.
- Backup dan restore lengkap untuk SQLite beserta seluruh gambar produk.
- Restore aman untuk volume Docker: isi volume ditukar melalui area rollback internal tanpa me-rename folder mount.
- Installer dan updater CasaOS/Linux dengan backup sebelum update, Git tanpa prompt interaktif, health check, dan rollback image.
- Installer satu perintah dari GitHub melalui `install-casaos.sh` dan perintah update absolut tanpa perlu berpindah folder.
