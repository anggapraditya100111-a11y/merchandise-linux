#!/usr/bin/env bash
set -euo pipefail

repository_url="https://github.com/anggapraditya100111-a11y/merchandise-linux.git"
install_root="/DATA/AppData/ainet-merchandise"
app_directory="$install_root/app"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan installer dengan sudo:"
  echo "curl -fsSL https://raw.githubusercontent.com/anggapraditya100111-a11y/merchandise-linux/main/install-casaos.sh | sudo bash"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git belum tersedia. Instal Git terlebih dahulu: sudo apt update && sudo apt install -y git"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker dan plugin Docker Compose belum tersedia. Pastikan CasaOS sudah terpasang dengan benar."
  exit 1
fi

if [ -e "$app_directory" ]; then
  if [ -d "$app_directory/.git" ]; then
    echo "AINET Merchandise sudah terpasang. Untuk memperbarui aplikasi, jalankan:"
    echo "sudo /DATA/AppData/ainet-merchandise/app/update.sh"
    exit 0
  fi
  echo "Lokasi instalasi sudah ada tetapi bukan clone GitHub: $app_directory"
  echo "Pindahkan folder tersebut terlebih dahulu agar data yang ada tidak tertimpa."
  exit 1
fi

mkdir -p "$install_root"
staging_directory="$(mktemp -d /tmp/ainet-merchandise-install.XXXXXX)"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT

export GIT_TERMINAL_PROMPT=0
echo "Mengunduh AINET Merchandise dari GitHub..."
git clone --depth 1 --branch main "$repository_url" "$staging_directory/app"
mv "$staging_directory/app" "$app_directory"
chmod +x "$app_directory/install.sh" "$app_directory/update.sh" "$app_directory/install-casaos.sh"

cd "$app_directory"
./install.sh
