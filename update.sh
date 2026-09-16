#!/usr/bin/env bash
set -euo pipefail

app_directory="$(cd "$(dirname "$0")" && pwd)"
install_root="$(dirname "$app_directory")"
package_base_url="https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main"
package_name="ainet-merchandise-latest.tar.gz"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cache_bust="$(date -u +%s)"

case "$app_directory" in
  ""|"/"|"/DATA"|"/DATA/"|"/DATA/AppData"|"/DATA/AppData/"|"/opt"|"/opt/")
    echo "Lokasi aplikasi tidak aman: '$app_directory'."
    exit 1
    ;;
esac

for command_name in curl tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Perintah '$command_name' belum tersedia pada server."
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker dan plugin Docker Compose harus tersedia."
  exit 1
fi

if [ ! -f "$app_directory/.env" ]; then
  echo "Konfigurasi .env tidak ditemukan. Update dibatalkan agar konfigurasi aplikasi tidak hilang."
  exit 1
fi

staging_directory="$(mktemp -d /tmp/ainet-merchandise-update.XXXXXX)"
rollback_directory="$install_root/axindo-merchandise-source-rollback-$timestamp"
failed_source_directory="$install_root/axindo-merchandise-source-gagal-$timestamp"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT

echo "Memeriksa versi terbaru..."
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 120 \
  "$package_base_url/$package_name.sha256?v=$cache_bust" -o "$staging_directory/$package_name.sha256"
package_hash="$(awk 'NR == 1 { print $1 }' "$staging_directory/$package_name.sha256")"
if [ -z "$package_hash" ]; then
  echo "Checksum paket terbaru tidak valid."
  exit 1
fi

installed_hash="$(sed -n '1p' "$app_directory/.package-sha256" 2>/dev/null || true)"
installed_version="$(tr -d '[:space:]' < "$app_directory/VERSION.txt" 2>/dev/null || true)"
running_version="$(docker exec ainet-merchandise sh -c 'tr -d "[:space:]" < /app/VERSION.txt' 2>/dev/null || true)"
if [ "$installed_hash" = "$package_hash" ]; then
  if [ -n "$installed_version" ] && [ "$running_version" = "$installed_version" ]; then
    echo "AINET Merchandise sudah menggunakan versi terbaru."
    exit 0
  fi
  echo "Source versi $installed_version sudah terbaru, tetapi container masih versi ${running_version:-tidak-terdeteksi}."
  echo "Updater akan membangun ulang image dan container tanpa cache."
fi

echo "Mengunduh paket pembaruan..."
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 600 \
  "$package_base_url/$package_name?v=$cache_bust" -o "$staging_directory/$package_name"
(
  cd "$staging_directory"
  sha256sum --check "$package_name.sha256"
)

mkdir -p "$staging_directory/source"
tar -xzf "$staging_directory/$package_name" -C "$staging_directory/source"
new_source="$staging_directory/source"
for required_file in Dockerfile docker-compose.yml install.sh install-ubuntu.sh update.sh VERSION.txt; do
  if [ ! -f "$new_source/$required_file" ]; then
    echo "Paket pembaruan tidak lengkap: $required_file tidak ditemukan."
    exit 1
  fi
done
expected_version="$(tr -d '[:space:]' < "$new_source/VERSION.txt")"
if ! [[ "$expected_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Versi paket pembaruan tidak valid: '$expected_version'."
  exit 1
fi

if ! docker compose -f "$app_directory/docker-compose.yml" --env-file "$app_directory/.env" ps --status running --services | grep -qx 'ainet-merchandise'; then
  echo "Container ainet-merchandise tidak sedang berjalan. Update dibatalkan agar backup dapat dibuat dengan aman."
  exit 1
fi

echo "Membuat backup lengkap sebelum update..."
docker compose -f "$app_directory/docker-compose.yml" --env-file "$app_directory/.env" \
  exec -T ainet-merchandise node src/cli.js backup

old_image_id="$(docker inspect ainet-merchandise --format '{{.Image}}' 2>/dev/null || true)"
old_image_ref="$(docker inspect ainet-merchandise --format '{{.Config.Image}}' 2>/dev/null || true)"
rollback_image_ref="ainet-merchandise:rollback-$timestamp"
if [ -n "$old_image_id" ]; then
  docker image tag "$old_image_id" "$rollback_image_ref"
fi

echo "Membangun versi terbaru..."
new_image_ref="ainet-merchandise:$expected_version"
build_ok=false
if docker buildx version >/dev/null 2>&1; then
  if tar -C "$new_source" -cf - . \
    | docker buildx build --load --provenance=false --no-cache --tag "$new_image_ref" -; then
    build_ok=true
  fi
else
  if tar -C "$new_source" -cf - . \
    | DOCKER_BUILDKIT=0 docker build --no-cache --tag "$new_image_ref" -; then
    build_ok=true
  fi
fi
if [ "$build_ok" != true ]; then
  echo "Build versi baru gagal. Source dan container lama tetap digunakan."
  exit 1
fi
built_version="$(docker run --rm --entrypoint sh "$new_image_ref" -c 'tr -d "[:space:]" < /app/VERSION.txt' 2>/dev/null || true)"
if [ "$built_version" != "$expected_version" ]; then
  echo "Image hasil build berisi versi ${built_version:-tidak-terdeteksi}, bukan $expected_version."
  if [ -n "$old_image_ref" ] && docker image inspect "$rollback_image_ref" >/dev/null 2>&1; then
    docker image tag "$rollback_image_ref" "$old_image_ref"
  fi
  echo "Update dihentikan sebelum source atau container aktif diubah."
  exit 1
fi

mkdir "$rollback_directory"
while IFS= read -r -d '' item; do
  if [ "$(basename "$item")" = ".env" ]; then
    continue
  fi
  mv "$item" "$rollback_directory/"
done < <(find "$app_directory" -mindepth 1 -maxdepth 1 -print0)

while IFS= read -r -d '' item; do
  mv "$item" "$app_directory/"
done < <(find "$new_source" -mindepth 1 -maxdepth 1 -print0)
printf '%s\n' "$package_hash" > "$app_directory/.package-sha256"
chmod 600 "$app_directory/.package-sha256"
chmod +x "$app_directory/install.sh" "$app_directory/update.sh" "$app_directory/install-casaos.sh" "$app_directory/install-ubuntu.sh"

cd "$app_directory"
if grep -qx 'TRUST_PROXY=false' .env; then
  sed -i 's/^TRUST_PROXY=false$/TRUST_PROXY=true/' .env
  echo "Konfigurasi reverse proxy diaktifkan untuk mencegah kegagalan login admin."
elif ! grep -q '^TRUST_PROXY=' .env; then
  printf '\nTRUST_PROXY=true\n' >> .env
fi
start_failed=false
if ! docker compose --env-file .env up -d --force-recreate --no-build; then
  start_failed=true
fi

app_port="$(sed -n 's/^APP_PORT=//p' .env | tail -n 1)"
app_port="${app_port:-8092}"
healthy=false
health_payload=""
if [ "$start_failed" = false ]; then
  for _attempt in $(seq 1 30); do
    if health_payload="$(curl --fail --silent "http://127.0.0.1:$app_port/api/health" 2>/dev/null)"; then
      container_version="$(docker compose --env-file .env exec -T ainet-merchandise sh -c 'tr -d "[:space:]" < /app/VERSION.txt' 2>/dev/null || true)"
      if [ "$container_version" = "$expected_version" ] \
        && printf '%s' "$health_payload" | grep -Eq '"version"[[:space:]]*:[[:space:]]*"'"$expected_version"'"'; then
        healthy=true
        break
      fi
    fi
    sleep 2
  done
fi

if [ "$healthy" != true ]; then
  echo "Versi baru tidak sehat atau container tidak menjalankan versi $expected_version."
  if [ -n "$health_payload" ]; then
    echo "Respons health terakhir: $health_payload"
  fi
  echo "Mengembalikan source dan image sebelumnya..."
  mkdir "$failed_source_directory"
  while IFS= read -r -d '' item; do
    if [ "$(basename "$item")" = ".env" ]; then
      continue
    fi
    mv "$item" "$failed_source_directory/"
  done < <(find "$app_directory" -mindepth 1 -maxdepth 1 -print0)
  while IFS= read -r -d '' item; do
    mv "$item" "$app_directory/"
  done < <(find "$rollback_directory" -mindepth 1 -maxdepth 1 -print0)
  rmdir "$rollback_directory"
  if [ -n "$old_image_ref" ] && docker image inspect "$rollback_image_ref" >/dev/null 2>&1; then
    docker image tag "$rollback_image_ref" "$old_image_ref"
  fi
  cd "$app_directory"
  docker compose --env-file .env up -d --force-recreate --no-build
  echo "Rollback selesai. Source versi gagal disimpan di: $failed_source_directory"
  exit 1
fi

rm -rf -- "$rollback_directory"
docker image rm "$rollback_image_ref" >/dev/null 2>&1 || true
echo "Update selesai. Versi aktif:"
curl --fail --silent "http://127.0.0.1:$app_port/api/health"
echo
