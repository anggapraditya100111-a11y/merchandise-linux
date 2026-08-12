#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker dan plugin Docker Compose harus tersedia."
  exit 1
fi

if [ ! -d .git ]; then
  echo "Folder aplikasi bukan hasil clone GitHub. Instal ulang dari repository publik agar update otomatis tersedia."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Ada perubahan source lokal. Simpan perubahan tersebut sebelum melakukan update."
  exit 1
fi

current_branch="$(git branch --show-current)"
if [ -z "$current_branch" ]; then
  echo "Branch Git tidak terdeteksi. Gunakan branch main."
  exit 1
fi

echo "Membuat backup lengkap sebelum update..."
docker compose exec -T ainet-merchandise node src/cli.js backup

old_commit="$(git rev-parse HEAD)"
rollback_tag="ainet-merchandise:rollback-${old_commit:0:12}"
if docker image inspect ainet-merchandise:1.0.0 >/dev/null 2>&1; then
  docker image tag ainet-merchandise:1.0.0 "$rollback_tag"
fi

export GIT_TERMINAL_PROMPT=0
remote_url="$(git remote get-url origin)"
case "$remote_url" in
  git@*|ssh://*) export GIT_SSH_COMMAND="ssh -oBatchMode=yes" ;;
esac

echo "Mengambil versi terbaru dari GitHub..."
if ! git fetch --prune origin "$current_branch"; then
  echo "GitHub tidak dapat diakses tanpa interaksi."
  echo "Untuk repository publik gunakan URL HTTPS; untuk repository privat gunakan SSH deploy key read-only."
  exit 1
fi
git merge --ff-only "origin/$current_branch"

if ! docker compose build; then
  echo "Build versi baru gagal. Container versi lama tetap berjalan."
  exit 1
fi
docker compose up -d --force-recreate

app_port="$(sed -n 's/^APP_PORT=//p' .env 2>/dev/null | tail -n 1)"
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
  echo "Versi baru tidak sehat. Mengaktifkan kembali image sebelumnya..."
  if docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    docker image tag "$rollback_tag" ainet-merchandise:1.0.0
    docker compose up -d --force-recreate --no-build
    echo "Layanan telah dikembalikan ke image sebelumnya. Source update dipertahankan untuk pemeriksaan."
  else
    echo "Image rollback tidak tersedia. Periksa log sebelum tindakan lanjutan."
  fi
  exit 1
fi

docker image rm "$rollback_tag" >/dev/null 2>&1 || true
echo "Update selesai."
curl --fail --silent "http://127.0.0.1:$app_port/api/health"
echo
