#!/usr/bin/env bash
# Export toàn bộ workflow -> workflows/exported/<id>.json (commit vào git)
# Export credentials (ĐÃ MÃ HOÁ) -> backups/credentials/ (không commit)
#
# Dùng:
#   ./scripts/export-workflows.sh              # mặc định
#   DECRYPTED=1 ./scripts/export-workflows.sh  # export credential dạng plaintext (NGUY HIỂM, chỉ để migrate)
set -euo pipefail
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

WF_DIR="workflows/exported"
CRED_DIR="backups/credentials"
TMP="/tmp/n8n-export"

if ! docker compose ps --status running --services | grep -qx n8n; then
  echo "❌ Service n8n chưa chạy. Chạy: make up"; exit 1
fi

docker compose exec -T n8n sh -c "rm -rf $TMP && mkdir -p $TMP/workflows $TMP/credentials"

echo "▶ Export workflows"
# --backup = --all --pretty --separate (mỗi workflow 1 file <id>.json)
docker compose exec -T n8n n8n export:workflow --backup --output="$TMP/workflows/"

echo "▶ Export credentials"
if [ "${DECRYPTED:-0}" = "1" ]; then
  echo "⚠️  DECRYPTED=1: credential sẽ ở dạng PLAINTEXT. Không commit, xoá ngay sau khi dùng!"
  docker compose exec -T n8n n8n export:credentials --backup --decrypted --output="$TMP/credentials/"
  CRED_DIR="backups/credentials-decrypted"
else
  docker compose exec -T n8n n8n export:credentials --backup --output="$TMP/credentials/"
fi

# Đồng bộ ra host: xoá file cũ để workflow đã xoá trong n8n cũng biến mất khỏi git
mkdir -p "$WF_DIR" "$CRED_DIR"
find "$WF_DIR" -maxdepth 1 -name '*.json' -delete
find "$CRED_DIR" -maxdepth 1 -name '*.json' -delete
docker compose cp "n8n:$TMP/workflows/." "$WF_DIR/" >/dev/null
docker compose cp "n8n:$TMP/credentials/." "$CRED_DIR/" >/dev/null
docker compose exec -T n8n rm -rf "$TMP"

WF_COUNT=$(find "$WF_DIR" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')
CRED_COUNT=$(find "$CRED_DIR" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')
echo "✅ $WF_COUNT workflow -> $WF_DIR/"
echo "✅ $CRED_COUNT credential -> $CRED_DIR/ (gitignored)"
