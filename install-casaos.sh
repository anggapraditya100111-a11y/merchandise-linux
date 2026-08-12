#!/usr/bin/env bash
set -euo pipefail

package_base_url="https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main"
package_name="ainet-merchandise-latest.tar.gz"
install_root="/DATA/AppData/ainet-merchandise"
app_directory="$install_root/app"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan installer dengan sudo:"
  echo "curl -fsSL $package_base_url/install-casaos.sh | sudo bash"
  exit 1
fi

for command_name in curl tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Perintah '$command_name' belum tersedia pada server."
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker dan plugin Docker Compose belum tersedia. Pastikan CasaOS sudah terpasang dengan benar."
  exit 1
fi

if [ -e "$app_directory" ]; then
  if [ -f "$app_directory/VERSION.txt" ] && [ -x "$app_directory/update.sh" ]; then
    echo "AINET Merchandise sudah terpasang. Untuk memperbarui aplikasi, jalankan:"
    echo "sudo /DATA/AppData/ainet-merchandise/app/update.sh"
    exit 0
  fi
  echo "Lokasi instalasi sudah ada tetapi bukan instalasi AINET Merchandise yang lengkap: $app_directory"
  echo "Pindahkan folder tersebut terlebih dahulu agar data yang ada tidak tertimpa."
  exit 1
fi

mkdir -p "$install_root"
staging_directory="$(mktemp -d /tmp/ainet-merchandise-install.XXXXXX)"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT

echo "Mengunduh paket AINET Merchandise..."
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
for required_file in Dockerfile docker-compose.yml install.sh update.sh VERSION.txt; do
  if [ ! -f "$staging_directory/source/$required_file" ]; then
    echo "Paket instalasi tidak lengkap: $required_file tidak ditemukan."
    exit 1
  fi
done

mv "$staging_directory/source" "$app_directory"
package_hash="$(awk 'NR == 1 { print $1 }' "$staging_directory/$package_name.sha256")"
printf '%s\n' "$package_hash" > "$app_directory/.package-sha256"
chmod 600 "$app_directory/.package-sha256"
chmod +x "$app_directory/install.sh" "$app_directory/update.sh" "$app_directory/install-casaos.sh"

cd "$app_directory"
./install.sh
