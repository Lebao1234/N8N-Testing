#!/usr/bin/env bash
# Import credentials mẫu + workflow JSON vào n8n.
#
# Dùng:
#   ./scripts/import-workflows.sh                       # import examples + exported
#   ./scripts/import-workflows.sh workflows/exported    # chỉ import 1 thư mục
#
# Thứ tự:
#   1. workflows/credentials-templates/*.json  (Ollama, Qdrant — không chứa secret)
#   2. Credential OpenAI/Anthropic/Gemini sinh tạm từ .env (nếu có key) — không ghi ra repo
#   3. Workflow: workflows/examples -> workflows/exported (bản export mới hơn ghi đè cùng id)
set -euo pipefail
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

TMP="/tmp/n8n-import"
if [ "$#" -gt 0 ]; then DIRS=("$@"); else DIRS=("workflows/examples" "workflows/exported"); fi

if ! docker compose ps --status running --services | grep -qx n8n; then
  echo "❌ Service n8n chưa chạy. Chạy: make up"; exit 1
fi

docker compose exec -T n8n sh -c "rm -rf $TMP && mkdir -p $TMP/creds"

# ---------- 1 + 2. Credentials ----------
LOCAL_TMP=".tmp/import-$$"   # trong repo (gitignored): tránh lỗi path /tmp của Git Bash + docker.exe
mkdir -p "$LOCAL_TMP"
trap 'rm -rf "$LOCAL_TMP"' EXIT

cp workflows/credentials-templates/*.json "$LOCAL_TMP/" 2>/dev/null || true

make_cred() { # id name type json-data
  printf '{"id":"%s","name":"%s","type":"%s","data":%s}\n' "$1" "$2" "$3" "$4" > "$LOCAL_TMP/$1.json"
  echo "  + credential từ .env: $2"
}
[ -n "${OPENAI_API_KEY:-}" ]    && make_cred "openAiLocal00001" "OpenAI (from .env)" "openAiApi" "{\"apiKey\":\"$OPENAI_API_KEY\"}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && make_cred "anthropicLocal01" "Anthropic (from .env)" "anthropicApi" "{\"apiKey\":\"$ANTHROPIC_API_KEY\"}"
[ -n "${GEMINI_API_KEY:-}" ]    && make_cred "geminiLocal00001" "Gemini (from .env)" "googlePalmApi" "{\"host\":\"https://generativelanguage.googleapis.com\",\"apiKey\":\"$GEMINI_API_KEY\"}"

if ls "$LOCAL_TMP"/*.json >/dev/null 2>&1; then
  echo "▶ Import credentials"
  docker compose cp "$LOCAL_TMP/." "n8n:$TMP/creds/" >/dev/null
  docker compose exec -T n8n n8n import:credentials --separate --input="$TMP/creds/"
fi

# ---------- 3. Workflows ----------
for dir in "${DIRS[@]}"; do
  if ! ls "$dir"/*.json >/dev/null 2>&1; then
    echo "… bỏ qua $dir (không có file .json)"; continue
  fi
  name="$(basename "$dir")"
  echo "▶ Import workflows từ $dir"
  docker compose exec -T n8n mkdir -p "$TMP/$name"
  docker compose cp "$dir/." "n8n:$TMP/$name/" >/dev/null
  docker compose exec -T n8n sh -c "rm -f $TMP/$name/.gitkeep"
  docker compose exec -T n8n n8n import:workflow --separate --input="$TMP/$name/"
done

docker compose exec -T n8n rm -rf "$TMP"
echo "✅ Import xong. Mở http://localhost:5678 để kiểm tra (workflow import ở trạng thái inactive)."
