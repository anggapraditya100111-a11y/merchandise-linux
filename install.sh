#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan installer sebagai root: sudo ./install.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker tidak ditemukan. Instal Docker Engine atau CasaOS terlebih dahulu."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Plugin Docker Compose tidak ditemukan."
  exit 1
fi

created_env=false
if [ ! -f .env ]; then
  if command -v openssl >/dev/null 2>&1; then
    app_secret="$(openssl rand -hex 48)"
    admin_password="Admin$(openssl rand -hex 8)Aa1"
  else
    app_secret="$(od -An -N48 -tx1 /dev/urandom | tr -d ' \n')"
    admin_password="Admin$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')Aa1"
  fi
  cp .env.example .env
  sed -i "s/GANTI_DENGAN_RANDOM_SECRET_MINIMAL_64_KARAKTER/$app_secret/" .env
  sed -i "s/GantiPasswordAdmin123/$admin_password/" .env
  if [ -n "${AINET_DATA_ROOT:-}" ]; then
    sed -i "s|^DATA_ROOT=.*|DATA_ROOT=$AINET_DATA_ROOT|" .env
  fi
  if [ -n "${AINET_COOKIE_SECURE:-}" ]; then
    sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=$AINET_COOKIE_SECURE|" .env
  fi
  chmod 600 .env
  created_env=true
fi

data_root="$(sed -n 's/^DATA_ROOT=//p' .env | tail -n 1)"
data_root="${data_root:-/var/lib/axindo-merchandise}"
case "$data_root" in
  ""|"/"|"/DATA"|"/DATA/"|"/DATA/AppData"|"/DATA/AppData/"|"/var"|"/var/"|"/var/lib"|"/var/lib/")
    echo "DATA_ROOT tidak aman: '$data_root'. Gunakan folder khusus aplikasi."
    exit 1
    ;;
esac

mkdir -p "$data_root/database" "$data_root/uploads" "$data_root/backups" "$data_root/restore-tmp"
chown -R 1000:1000 "$data_root/database" "$data_root/uploads" "$data_root/backups" "$data_root/restore-tmp"

docker compose up -d --build

app_port="$(sed -n 's/^APP_PORT=//p' .env | tail -n 1)"
app_port="${app_port:-8092}"
healthy=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$app_port/api/health" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [ "$healthy" != true ]; then
  echo "Container aktif tetapi pemeriksaan kesehatan belum berhasil."
  echo "Periksa log: docker compose logs --tail=100 ainet-merchandise"
  exit 1
fi

if [ "$created_env" = true ]; then
  echo ""
  echo "Kredensial admin awal:"
  echo "Username: admin"
  echo "Password: $admin_password"
  echo "Simpan password ini, lalu ubah melalui menu Pemeliharaan."
fi
echo ""
echo "AINET Merchandise aktif di http://IP-SERVER:$app_port"
echo "Status: docker compose ps"
echo "Log: docker compose logs -f ainet-merchandise"
