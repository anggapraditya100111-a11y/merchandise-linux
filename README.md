# AINET Merchandise untuk CasaOS dan Linux

Aplikasi katalog internal untuk pemesanan merchandise pegawai PoP. Pemesan tidak perlu login dan tidak melakukan pembayaran di website. Aplikasi hanya menghitung nominal serta mencatat order untuk admin kantor pusat.

## Fitur

- Katalog publik tanpa login.
- Keranjang belanja tanpa sistem pembayaran.
- Nama pemesan, asal PoP, dan nomor WhatsApp.
- Pilihan ukuran baju, nomor sepatu, atau varian lain langsung pada setiap barang.
- Popup setelah order berhasil dengan pesan konfirmasi dan nomor order otomatis.
- Download PDF order lengkap dengan gambar barang, ukuran/nomor, jumlah, harga, dan total nominal.
- Panel admin untuk pesanan, barang, gambar, varian, dan daftar PoP.
- Rekap order CSV; tidak ada status pesanan.
- Backup/restore lengkap untuk database SQLite dan seluruh gambar.
- Mendukung `amd64` dan `arm64` melalui Docker.

## Port dan lokasi data

- Web: `8092`
- Database: `/DATA/AppData/ainet-merchandise/database`
- Gambar: `/DATA/AppData/ainet-merchandise/uploads`
- Backup: `/DATA/AppData/ainet-merchandise/backups`
- Area restore: `/DATA/AppData/ainet-merchandise/restore-tmp`

Port 8092 dipilih agar tidak berbenturan dengan aplikasi Kas Kecil yang menggunakan port 8090.

## Instalasi satu perintah di CasaOS

Masuk ke terminal/SSH CasaOS, kemudian jalankan satu perintah berikut:

```bash
curl -fsSL https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main/install-casaos.sh | sudo bash
```

Installer akan:

1. mengunduh source dari repository GitHub publik tanpa meminta username;
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

```bash
sudo /DATA/AppData/ainet-merchandise/app/update.sh
```

Updater melakukan langkah berikut:

1. menolak update bila source lokal berubah;
2. membuat backup lengkap sebelum update;
3. mengambil update GitHub tanpa prompt username/password interaktif;
4. hanya menerima update fast-forward;
5. membangun dan menjalankan image baru;
6. menunggu health check;
7. mengaktifkan kembali image lama jika versi baru tidak sehat.

Repository publik menggunakan URL HTTPS sehingga `git fetch` dan `git pull` tidak meminta username GitHub. Untuk source privat, gunakan SSH deploy key read-only; jangan menaruh token di URL remote.

## Backup dan restore

Masuk ke **Admin → Pemeliharaan** untuk membuat paket `.merchbackup` atau memulihkannya.

Paket backup berisi:

- database SQLite;
- seluruh gambar produk;
- manifest format dan versi aplikasi.

Restore memvalidasi format ZIP, mencegah path traversal, memeriksa integritas SQLite, dan menyediakan rollback otomatis. Folder volume `/app/uploads` serta `/app/data` tidak pernah di-rename. Aplikasi hanya menukar isi di dalam volume sehingga tidak terkena error `resource busy`/lintas volume yang pernah terjadi pada aplikasi sebelumnya.

`.env`, database, gambar, backup, dan area restore tidak disimpan ke GitHub.

## Reverse proxy dan HTTPS

Jika aplikasi diakses melalui domain HTTPS, ubah `.env`:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
```

Lalu terapkan:

```bash
docker compose up -d --force-recreate
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

Test otomatis memeriksa katalog, validasi ukuran, pembuatan order, PDF, login admin, backup, restore, dan perlindungan path paket backup.

## Rilis image

Push tag versi untuk membangun image multi-arsitektur melalui GitHub Actions:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Workflow menerbitkan `ghcr.io/anggapraditya100111-a11y/ainet-merchandise:latest`. Pastikan package GHCR diatur menjadi **Public** sebelum menggunakan `docker-compose.casaos.yml`.

## Lisensi

[MIT](LICENSE)
