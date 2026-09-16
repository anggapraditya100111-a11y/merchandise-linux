# Changelog

## 1.5.3 — 2026-09-16

- Bandingkan versi source lokal dengan versi yang benar-benar berjalan di dalam container sebelum menyatakan aplikasi sudah terbaru.
- Paksa rebuild tanpa cache ketika checksum paket sudah terbaru tetapi container masih menjalankan source versi lama.
- Tangani pembaruan updater yang mengganti dirinya sendiri di tengah proses tanpa meloloskan container lama pada pembaruan berikutnya.

## 1.5.2 — 2026-09-16

- Paksa build update tanpa cache agar source lama tidak dapat tertanam kembali ke image dengan tag versi baru.
- Verifikasi versi di dalam container dan respons health terhadap `VERSION.txt` sebelum update dinyatakan berhasil.
- Jalankan rollback otomatis jika container sehat tetapi masih menjalankan versi aplikasi yang lama.

## 1.5.1 — 2026-09-16

- Tambahkan cache-busting pada updater dan installer agar checksum serta paket terbaru tidak tertahan cache `raw.githubusercontent.com`.
- Pastikan checksum dan arsip rilis selalu diambil dari generasi URL yang sama sehingga verifikasi SHA-256 tetap konsisten.

## 1.5.0 — 2026-09-16

- Tambahkan tab **Work Order** pada menu Pesanan.
- Admin dapat memilih beberapa order On proses lalu membuat satu Work Order untuk vendor.
- Barang dengan SKU dan varian yang sama dijumlahkan otomatis menjadi total kebutuhan per item.
- Cegah satu pesanan masuk ke lebih dari satu Work Order dan lindungi order terkait dari penghapusan langsung.
- Tambahkan nomor WO otomatis, nama vendor, catatan, order sumber, status Diproses vendor/Selesai, serta PDF vendor.
- Menyelesaikan atau membuka kembali Work Order otomatis menyelaraskan status seluruh order sumber.
- Work Order dan seluruh relasinya ikut tersimpan dalam backup/restore tanpa mengubah data pesanan lama.

## 1.4.0 — 2026-09-16

- Pertahankan baris baru pada deskripsi produk agar daftar dengan strip tetap tersusun vertikal di katalog.
- Tambahkan status pesanan **On proses** dan **Selesai** beserta waktu penyelesaian.
- Pisahkan daftar admin menjadi tab On proses dan Selesai dengan jumlah order pada masing-masing tab.
- Tambahkan tombol Tandai selesai serta Buka kembali pada daftar dan detail pesanan.
- Tambahkan status dan waktu selesai pada rekap CSV.
- Migrasikan seluruh pesanan versi lama secara aman ke status On proses dan pertahankan status dalam backup/restore.

## 1.3.2 — 2026-09-12

- Pertahankan hubungan aman antara halaman admin Katalog dan popup AXINDO Access dengan `same-origin-allow-popups`.
- Tutup popup secara mandiri setelah fallback handoff berhasil pada browser yang memutus `window.opener`.
- Tegaskan bahwa sesi admin dari AXINDO ID tidak dapat mengubah password admin lokal, baik di tampilan maupun API.

## 1.3.1 — 2026-09-12

- Tambahkan endpoint manifest kompatibel `/api/public/axindo-access.json` untuk jaringan yang memblokir jalur `/.well-known`.
- Pertahankan endpoint manifest standar agar integrasi yang sudah berjalan tetap kompatibel.

## 1.3.0 — 2026-09-12

- Tambahkan installer khusus Ubuntu Server dengan source di `/opt/axindo-merchandise` dan data persisten di `/var/lib/axindo-merchandise`.
- Tambahkan manifest resmi `/.well-known/axindo-access.json` dengan role Super Admin dan Pegawai/Pemesan.
- Panel admin kini dapat login melalui AXINDO ID memakai handoff AXINDO Access, PKCE, kode satu kali, dan pertukaran backend-ke-backend.
- Tambahkan fallback Safari iPhone saat `window.opener` hilang serta perlindungan race condition ketika popup tertutup.
- Pertahankan login admin lokal sebagai akses darurat; password AXINDO ID tetap dikelola di AXINDO Access.
- Tambahkan koneksi internal Docker ke AXINDO Access melalui `host.docker.internal:8096` tanpa melewati Cloudflare Tunnel.
- Pertahankan katalog publik tanpa login dan kompatibilitas backup/restore data CasaOS.

## 1.2.0 — 2026-08-13

- Foto produk pada form tambah/edit kini diunggah satu per satu, langsung menjadi thumbnail, dan dapat disusun ulang dengan drag-and-drop hingga lima foto.
- Gambar katalog dapat dibuka dalam popup galeri besar dengan tombol sebelumnya/berikutnya, thumbnail, keyboard, dan gestur geser pada layar sentuh.
- Teks label, judul, dan deskripsi header katalog dapat diubah melalui Pengaturan.
- Pengaturan baru untuk nomor WhatsApp admin pusat dan domain publik katalog.
- Setelah pesanan berhasil, aplikasi membuka WhatsApp admin dengan ringkasan order dan tautan PDF publik; tombol WhatsApp tetap tersedia pada popup sukses.
- Informasi tanpa pembayaran di formulir order kini menampilkan nomor WhatsApp admin.
- Daftar dan detail pesanan memiliki tombol hapus dengan konfirmasi.
- Ubah password dilengkapi tombol mata, konfirmasi password, aturan minimal 8 karakter, serta hanya huruf dan angka.
- Memperbaiki error palsu setelah password berhasil diubah akibat referensi form asynchronous.
- Reverse proxy dipercaya secara default pada CasaOS dan updater memigrasikan `TRUST_PROXY=false` untuk mencegah kegagalan login/rate-limit di balik domain publik.
- Test integrasi ditambah untuk urutan foto, domain/WhatsApp, PDF publik, login reverse proxy, ubah password, dan hapus pesanan.

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
