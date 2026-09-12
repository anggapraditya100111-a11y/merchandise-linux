#!/usr/bin/env bash
set -euo pipefail

package_base_url="https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main"
package_name="ainet-merchandise-latest.tar.gz"
app_directory="/opt/axindo-merchandise"
data_root="/var/lib/axindo-merchandise"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan installer dengan sudo:"
  echo "curl -fsSL $package_base_url/install-ubuntu.sh | sudo bash"
  exit 1
fi

for command_name in curl tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Perintah '$command_name' belum tersedia pada Ubuntu Server."
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine dan Docker Compose Plugin belum tersedia."
  exit 1
fi

if [ -e "$app_directory" ]; then
  if [ -f "$app_directory/VERSION.txt" ] && [ -x "$app_directory/update.sh" ]; then
    echo "AXINDO Merchandise sudah terpasang. Untuk memperbarui aplikasi, jalankan:"
    echo "sudo $app_directory/update.sh"
    exit 0
  fi
  echo "Lokasi instalasi sudah ada tetapi bukan instalasi AXINDO Merchandise yang lengkap: $app_directory"
  echo "Pindahkan folder tersebut terlebih dahulu agar data yang ada tidak tertimpa."
  exit 1
fi

staging_directory="$(mktemp -d /tmp/axindo-merchandise-install.XXXXXX)"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT

echo "Mengunduh paket AXINDO Merchandise..."
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 600 \
  "$package_base_url/$package_name.sha256" -o "$staging_directory/$package_name.sha256"
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 600 \
  "$package_base_url/$package_name" -o "$staging_directory/$package_name"

echo "Memeriksa integritas paket..."
(
  cd "$staging_directory"
  sha256sum --check "$package_name.sha256"
)

mkdir -p "$staging_directory/source"
tar -xzf "$staging_directory/$package_name" -C "$staging_directory/source"
for required_file in Dockerfile docker-compose.yml install.sh install-ubuntu.sh update.sh VERSION.txt; do
  if [ ! -f "$staging_directory/source/$required_file" ]; then
    echo "Paket instalasi tidak lengkap: $required_file tidak ditemukan."
    exit 1
  fi
done

mkdir -p "$(dirname "$app_directory")"
mv "$staging_directory/source" "$app_directory"
package_hash="$(awk 'NR == 1 { print $1 }' "$staging_directory/$package_name.sha256")"
printf '%s\n' "$package_hash" > "$app_directory/.package-sha256"
chmod 600 "$app_directory/.package-sha256"
chmod +x "$app_directory/install.sh" "$app_directory/install-casaos.sh" "$app_directory/install-ubuntu.sh" "$app_directory/update.sh"

cd "$app_directory"
AINET_DATA_ROOT="$data_root" AINET_COOKIE_SECURE=false ./install.sh

echo ""
echo "Lokasi source: $app_directory"
echo "Lokasi data: $data_root"
echo "Domain publik: https://katalog.axindo.my.id"
echo "Update berikutnya: sudo $app_directory/update.sh"
