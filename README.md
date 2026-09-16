# AXINDO Merchandise untuk Ubuntu Server dan CasaOS

Aplikasi katalog internal untuk pemesanan merchandise pegawai PoP. Pemesan tidak perlu login dan tidak melakukan pembayaran di website. Aplikasi hanya menghitung nominal serta mencatat order untuk admin kantor pusat.

## Fitur

- Katalog publik tanpa login.
- Keranjang belanja tanpa sistem pembayaran.
- Nama pemesan, asal PoP, nomor WhatsApp, dan catatan opsional maksimal 500 karakter.
- Pilihan ukuran baju, nomor sepatu, atau varian lain langsung pada setiap barang.
- Popup setelah order berhasil dengan pesan konfirmasi, nomor order otomatis, tombol PDF, dan tombol WhatsApp admin.
- Download PDF order lengkap dengan gambar barang, ukuran/nomor, jumlah, harga, dan total nominal.
- Panel admin untuk pesanan, status On proses/Selesai, Work Order vendor, barang, galeri maksimal 5 foto, varian, kategori, dan daftar PoP.
- Work Order dibuat dari order yang dipilih, menjumlahkan barang serta varian yang sama, dan dapat diunduh sebagai PDF vendor.
- Foto barang ditambahkan satu per satu sebagai thumbnail dan dapat disusun ulang dengan drag-and-drop.
- Pengaturan nama aplikasi, teks header katalog, nama perusahaan, logo, warna, WhatsApp admin pusat, serta domain publik.
- Slider gambar dan popup galeri besar dengan navigasi foto untuk setiap produk di katalog.
- Setelah order berhasil, browser membuka WhatsApp admin dengan ringkasan dan tautan PDF publik yang sudah terisi.
- Ubah password admin lokal dengan tombol mata; akun yang masuk melalui AXINDO ID mengelola password di AXINDO Access.
- Panel admin dapat masuk melalui AXINDO ID; login lokal tetap tersedia sebagai akses darurat.
- Manifest role untuk Web Akses: Super Admin serta Pegawai/Pemesan.
- Pesanan selesai dipindahkan ke tab tersendiri, dapat dibuka kembali, dihapus, dan diekspor ke CSV beserta statusnya.
- Backup/restore lengkap untuk database SQLite dan seluruh gambar.
- Mendukung `amd64` dan `arm64` melalui Docker.

## Port dan lokasi data

- Web: `8092`
- Source Ubuntu: `/opt/axindo-merchandise`
- Data Ubuntu: `/var/lib/axindo-merchandise`
- Source CasaOS: `/DATA/AppData/ainet-merchandise/app`
- Data CasaOS: `/DATA/AppData/ainet-merchandise`

Port 8092 dipilih agar tidak berbenturan dengan aplikasi Kas Kecil yang menggunakan port 8090.

## Instalasi satu perintah di Ubuntu Server

Docker Engine dan Docker Compose Plugin harus sudah tersedia. Jalankan:

```bash
curl -fsSL https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main/install-ubuntu.sh | sudo bash
```

Installer memverifikasi paket dengan SHA-256, menaruh source di `/opt/axindo-merchandise`, menaruh database/gambar/backup di `/var/lib/axindo-merchandise`, membangun container, dan menjalankan health check. Cookie aman HTTPS sengaja belum diaktifkan agar backup CasaOS dapat dipulihkan melalui IP lokal sebelum domain dialihkan.

## Instalasi satu perintah di CasaOS

Masuk ke terminal/SSH CasaOS, kemudian jalankan satu perintah berikut:

```bash
curl -fsSL https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main/install-casaos.sh | sudo bash
```

Installer akan:

1. mengunduh paket melalui `raw.githubusercontent.com` tanpa `git clone` dan tanpa meminta username;
2. menyimpan source di `/DATA/AppData/ainet-merchandise/app`;
3. membuat secret aplikasi dan password admin acak;
4. membuat folder data persisten dengan hak akses yang sesuai;
5. membangun dan menjalankan container;
6. menunggu health check berhasil;
7. menampilkan alamat aplikasi serta kredensial admin satu kali.

Buka `http://IP-CASAOS:8092`. Katalog berada di halaman utama dan panel admin berada di `http://IP-CASAOS:8092/admin`.

## Instalasi melalui Custom Install CasaOS

Setelah image `ghcr.io/anggapraditya100111-a11y/ainet-merchandise:latest` tersedia publik:

1. buka **App Store → Custom Install** di CasaOS;
2. impor isi `docker-compose.casaos.yml`;
3. pasang aplikasi dan buka port 8092;
4. lihat log container satu kali untuk mendapatkan password admin awal:

```bash
docker logs ainet-merchandise 2>&1 | sed -n '/KREDENSIAL ADMIN AWAL/,/====/p'
```

Secret aplikasi dibuat otomatis di volume database bila tidak diisi dari environment. Password admin acak hanya dicetak saat database pertama kali dibuat.

## Memperbarui aplikasi

Ubuntu Server:

```bash
sudo /opt/axindo-merchandise/update.sh
```

CasaOS:

```bash
sudo /DATA/AppData/ainet-merchandise/app/update.sh
```

Updater melakukan langkah berikut:

1. memeriksa checksum paket terbaru;
2. membuat backup lengkap sebelum update;
3. mengunduh paket melalui `raw.githubusercontent.com` tanpa Git, username, atau token;
4. memverifikasi SHA-256 sebelum mengekstrak paket;
5. membangun image baru sebelum menukar source aktif;
6. menjalankan image baru dan menunggu health check;
7. mengaktifkan kembali source dan image lama jika versi baru tidak sehat.

Jalur instalasi dan update tidak mengakses `github.com`. Hal ini menghindari timeout port 443 yang dapat terjadi pada sebagian jaringan, selama `raw.githubusercontent.com` tetap dapat dijangkau.

## Backup dan restore

Masuk ke **Admin → Pemeliharaan** untuk membuat paket `.merchbackup` atau memulihkannya.

Paket backup berisi:

- database SQLite;
- seluruh gambar produk;
- manifest format dan versi aplikasi.

Restore memvalidasi format ZIP, mencegah path traversal, memeriksa integritas SQLite, dan menyediakan rollback otomatis. Folder volume `/app/uploads` serta `/app/data` tidak pernah di-rename. Aplikasi hanya menukar isi di dalam volume sehingga tidak terkena error `resource busy`/lintas volume yang pernah terjadi pada aplikasi sebelumnya.

`.env`, database, gambar, backup, dan area restore tidak disimpan ke GitHub.

## AXINDO Access

Manifest aplikasi tersedia di:

```text
https://katalog.axindo.my.id/.well-known/axindo-access.json
```

Jika reverse proxy atau Cloudflare memblokir jalur `/.well-known`, gunakan endpoint kompatibel:

```text
https://katalog.axindo.my.id/api/public/axindo-access.json
```

| Role | Grup Authentik |
|---|---|
| Super Admin | `AXINDO - MERCHANDISE - SUPER ADMIN` |
| Pegawai / Pemesan | `AXINDO - MERCHANDISE - USER` |

Katalog utama tetap publik tanpa login. Role Pegawai/Pemesan menentukan apakah kartu katalog tampil di **Aplikasi Saya**. Panel `/admin` memakai tombol **Masuk dengan AXINDO ID** dan hanya menerima grup Super Admin. Login admin lokal tetap tersedia sebagai akses darurat.

Pertukaran sesi backend menggunakan `http://host.docker.internal:8096` pada host Ubuntu yang sama. Browser selalu memakai `https://akses.axindo.my.id`.

## Domain publik, WhatsApp, reverse proxy, dan HTTPS

Masuk ke **Admin → Pengaturan → Identitas & tampilan**, lalu isi:

- **WhatsApp admin pusat**, misalnya `081234567890`;
- **Domain publik katalog**, misalnya `https://katalog.axindo.my.id`.

Browser biasa tidak diizinkan melampirkan file PDF langsung ke WhatsApp tanpa WhatsApp Business API. Karena itu aplikasi mengisikan pesan WhatsApp beserta tautan PDF order publik secara otomatis. Admin dapat membuka atau mengunduh PDF dari tautan tersebut.

`TRUST_PROXY=true` sudah menjadi konfigurasi bawaan untuk CasaOS dan updater akan memigrasikan nilai lama `false`. Jika aplikasi diakses melalui domain HTTPS, aktifkan cookie aman di `.env`:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
```

Lalu terapkan:

```bash
docker compose up -d --force-recreate
```

Pada instalasi Ubuntu, `TRUST_PROXY=true` sudah aktif secara bawaan. Setelah Cloudflare Tunnel `katalog.axindo.my.id` diarahkan ke `http://IP-APPSERVER:8092` dan akses HTTPS berhasil, aktifkan cookie aman:

```bash
sudo sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/axindo-merchandise/.env
cd /opt/axindo-merchandise
sudo docker compose --env-file .env up -d --force-recreate
```

## Perintah pemeliharaan

```bash
docker compose ps
docker compose logs -f ainet-merchandise
docker compose restart ainet-merchandise
curl http://127.0.0.1:8092/api/health
```

## Pengembangan dan verifikasi

Memerlukan Node.js 24:

```bash
npm ci
npm run verify
docker compose config --quiet
docker build -t ainet-merchandise:test .
```

Test otomatis memeriksa katalog, deskripsi multiline, kategori, galeri lima foto dan urutannya, pengaturan identitas/domain/WhatsApp, status order, Work Order dan PDF vendor, pengalihan WhatsApp, login reverse proxy, ubah password, hapus order, backup, restore, serta perlindungan path paket backup.

## Rilis image

Push tag versi untuk membangun image multi-arsitektur melalui GitHub Actions:

```bash
git tag v1.5.4
git push origin v1.5.4
```

Workflow menerbitkan `ghcr.io/anggapraditya100111-a11y/ainet-merchandise:latest`. Pastikan package GHCR diatur menjadi **Public** sebelum menggunakan `docker-compose.casaos.yml`.

## Lisensi

[MIT](LICENSE)
