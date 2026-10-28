#!/usr/bin/env bash
# Backup database Postgres của n8n ra backups/n8n-db-<timestamp>.sql.gz
# Dùng: ./scripts/backup.sh   (hoặc make backup)
# Restore: gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
set -euo pipefail
export MSYS_NO_PATHCONV=1   # tránh Git Bash trên Windows tự đổi path /xxx

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "❌ Chưa có .env (cp .env.example .env)"; exit 1; }
set -a; . ./.env; set +a

BACKUP_DIR="backups"
KEEP="${BACKUP_KEEP:-10}"   # giữ lại N bản mới nhất
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/n8n-db-${TS}.sql.gz"
mkdir -p "$BACKUP_DIR"

if ! docker compose ps --status running --services | grep -qx postgres; then
  echo "❌ Service postgres chưa chạy. Chạy: make up"; exit 1
fi

echo "▶ pg_dump ${POSTGRES_DB} -> ${OUT}"
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
  | gzip > "$OUT"

# Kiểm tra file không rỗng
if [ ! -s "$OUT" ] || [ "$(gzip -dc "$OUT" | head -c 100 | wc -c)" -lt 10 ]; then
  echo "❌ Backup rỗng hoặc lỗi"; rm -f "$OUT"; exit 1
fi

# Xoay vòng: chỉ giữ $KEEP bản gần nhất
ls -1t "$BACKUP_DIR"/n8n-db-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "✅ Backup xong: $OUT ($(du -h "$OUT" | cut -f1))"
echo "   Lưu ý: credential trong DB được mã hoá bằng N8N_ENCRYPTION_KEY — hãy giữ key cùng bản backup."
