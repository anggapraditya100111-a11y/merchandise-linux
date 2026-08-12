# Changelog

## 1.1.1 — 2026-08-12

- Memperbaiki error `Cannot read properties of null (reading 'reset')` setelah order berhasil disimpan.
- Form pemesan kini di-reset menggunakan referensi yang disimpan sebelum request asynchronous, sehingga popup nomor order dan tombol download PDF dapat muncul normal.
- Ditambahkan tes regresi agar referensi `event.currentTarget` tidak digunakan lagi setelah proses asynchronous.

## 1.1.0 — 2026-08-12

- Menu admin baru **Pengaturan** dengan submenu identitas dan tampilan aplikasi, Data PoP, serta Kategori.
- Nama aplikasi, nama perusahaan, logo, warna utama, warna sekunder, dan warna aksen dapat diubah dari panel admin.
- Kategori dapat ditambah, diedit, dan dihapus; kategori yang masih dipakai barang dilindungi dari penghapusan.
- Data PoP dipindahkan ke Pengaturan dan nama PoP kini dapat diedit.
- Setiap barang mendukung maksimal lima foto, termasuk pengelolaan foto lama ketika barang diedit.
- Foto produk ditampilkan sebagai slider pada kartu katalog.
- Form pemesan memiliki catatan opsional maksimal 500 karakter; catatan tersimpan di admin, rekap CSV, popup, dan PDF order.
- Migrasi database otomatis menjaga kompatibilitas data, gambar, order, serta backup dari versi sebelumnya.
- Cache aset publik dinonaktifkan agar tampilan terbaru langsung termuat setelah update CasaOS.

## 1.0.2 — 2026-08-12

- Tampilan katalog dan panel admin kembali termuat saat CasaOS diakses melalui HTTP/IP lokal.
- Content Security Policy tidak lagi memaksa aset CSS dan JavaScript internal menggunakan HTTPS ketika layanan hanya menyediakan HTTP.
- Ditambahkan pengujian otomatis untuk memastikan HTML, CSS, dan JavaScript publik dapat dimuat dan aturan tersebut tidak muncul kembali.

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
