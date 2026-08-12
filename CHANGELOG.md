# Changelog

## 1.0.1 — 2026-08-12

- Instalasi tidak lagi memakai `git clone` ke `github.com`, sehingga tetap berjalan ketika koneksi port 443 ke domain tersebut timeout.
- Installer dan updater mengunduh paket terverifikasi melalui `raw.githubusercontent.com`.
- Setiap paket diperiksa menggunakan SHA-256 sebelum diekstrak atau dijalankan.
- Update tidak memerlukan Git, username, token, maupun deploy key.
- Update tetap membuat backup lengkap, membangun image sebelum menukar source, melakukan health check, serta memulihkan source dan image lama ketika gagal.

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
