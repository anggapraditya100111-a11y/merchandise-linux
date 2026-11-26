#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if (( $# != 1 )); then
  echo 'Pakai: sudo bash staging-ubuntu.sh /path/ke/backup.merchbackup' >&2
  exit 2
fi
if (( EUID != 0 )); then
  echo 'Jalankan melalui sudo agar backup dan Docker lokal dapat dibaca.' >&2
  exit 2
fi
backup_file="$(realpath -e -- "$1")"
[[ -f "$backup_file" && -r "$backup_file" && "$backup_file" == *.merchbackup ]] || { echo 'Pilih file .merchbackup yang dapat dibaca.' >&2; exit 2; }
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
app_version="$(tr -d '[:space:]' < "$source_root/VERSION.txt")"
[[ "$app_version" == 2.0.0 ]] || { echo 'Gunakan paket kandidat AXINDO Store 2.0.0.' >&2; exit 2; }
docker_local=(docker --host unix:///var/run/docker.sock)
docker_version="$("${docker_local[@]}" version --format '{{.Server.Version}}')"
docker_major="${docker_version%%.*}"
if ! [[ "$docker_major" =~ ^[0-9]+$ ]] || (( docker_major < 28 )); then
  echo 'Staging ini membutuhkan Docker Engine 28 atau lebih baru untuk pembatasan port localhost. Tidak ada perubahan yang dibuat.' >&2
  exit 2
fi
container=axindo-store-staging
storage=axindo-store-staging-data
image="axindo-store-staging:$app_version"
exec 9>/run/lock/axindo-store-staging.lock
flock -n 9 || { echo 'Persistensi staging sedang disiapkan pada terminal lain.' >&2; exit 2; }
if "${docker_local[@]}" container inspect "$container" >/dev/null 2>&1 || "${docker_local[@]}" volume inspect "$storage" >/dev/null 2>&1; then
  echo 'Staging sudah ada. Volume lama tidak akan ditimpa.' >&2
  exit 2
fi

settings_dir="$(mktemp -d)"
run_id="$(openssl rand -hex 12)"
cleanup() {
  local status=$?
  if (( status != 0 )) && [[ "$("${docker_local[@]}" volume inspect --format '{{index .Labels "axindo.staging.run"}}' "$storage" 2>/dev/null || true)" == "$run_id" ]]; then
    if [[ "$("${docker_local[@]}" container inspect --format '{{index .Config.Labels "axindo.staging.run"}}' "$container" 2>/dev/null || true)" == "$run_id" ]]; then
      "${docker_local[@]}" container rm -f "$container" >/dev/null || true
    fi
    "${docker_local[@]}" volume rm "$storage" >/dev/null || true
  fi
  rm -f -- "$settings_dir/runtime.env" "$settings_dir/restore.env"
  rmdir -- "$settings_dir"
  return "$status"
}
trap cleanup EXIT
staging_password="Stage$(openssl rand -hex 14)"
staging_secret="$(openssl rand -hex 32)"
printf '%s\n' \
  "APP_SECRET=$staging_secret" 'AXINDO_STORE_STAGING=1' 'ACCESS_HANDOFF_ENABLED=false' \
  'COOKIE_SECURE=false' 'TRUST_PROXY=false' 'DATA_DIR=/app/staging/data' \
  'UPLOAD_DIR=/app/staging/uploads' 'BACKUP_DIR=/app/staging/backups' 'RESTORE_TMP_DIR=/app/staging/restore' \
  'INITIAL_ADMIN_USERNAME=staging' 'TZ=Asia/Jakarta' > "$settings_dir/runtime.env"
cp -- "$settings_dir/runtime.env" "$settings_dir/restore.env"
printf 'INITIAL_ADMIN_PASSWORD=%s\n' "$staging_password" >> "$settings_dir/restore.env"

echo 'Membangun image staging terpisah…'
"${docker_local[@]}" build --tag "$image" "$source_root"
"${docker_local[@]}" volume create --label axindo.scope=staging --label "axindo.staging.run=$run_id" "$storage" >/dev/null
mount=(--mount "type=volume,source=$storage,target=/app/staging")
"${docker_local[@]}" run --rm --network none --user 0 "${mount[@]}" --entrypoint sh "$image" -c 'chmod 700 /app/staging && chown 1000:1000 /app/staging'
echo 'Memulihkan dan menyamarkan salinan backup…'
"${docker_local[@]}" run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$settings_dir/restore.env" "${mount[@]}" "$image" node src/staging-restore.js < "$backup_file"

"${docker_local[@]}" run -d --name "$container" --label axindo.scope=staging --label "axindo.staging.run=$run_id" --cap-drop ALL --security-opt no-new-privileges \
  --publish 127.0.0.1:18092:8092 --env-file "$settings_dir/runtime.env" "${mount[@]}" "$image" >/dev/null
for (( attempt=1; attempt<=25; attempt++ )); do
  if health="$(curl -fsS --max-time 3 http://127.0.0.1:18092/api/health 2>/dev/null)" && [[ "$health" == *'"version":"2.0.0"'* ]]; then
    printf '%s\n' "$health" 'Admin: http://127.0.0.1:18092/admin' 'Username: staging' "Password staging: $staging_password"
    exit 0
  fi
  sleep 1
done
echo 'Health check staging belum lulus. Staging percobaan ini akan dibersihkan.' >&2
"${docker_local[@]}" logs --tail 20 "$container" >&2 || true
exit 1
