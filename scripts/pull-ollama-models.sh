#!/usr/bin/env bash
# Pull model cho Ollama (cần profile ai-local đang chạy: make up-ai)
# Dùng: ./scripts/pull-ollama-models.sh [model ...]
# Mặc định lấy từ OLLAMA_MODELS trong .env, fallback "llama3.2 nomic-embed-text"
set -euo pipefail
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

if [ "$#" -gt 0 ]; then MODELS="$*"; else MODELS="${OLLAMA_MODELS:-llama3.2 nomic-embed-text}"; fi

if ! docker compose --profile ai-local ps --status running --services | grep -qx ollama; then
  echo "❌ Ollama chưa chạy. Chạy: make up-ai"; exit 1
fi

for m in $MODELS; do
  echo "▶ ollama pull $m"
  docker compose --profile ai-local exec -T ollama ollama pull "$m"
done

echo "✅ Model hiện có:"
docker compose --profile ai-local exec -T ollama ollama list
