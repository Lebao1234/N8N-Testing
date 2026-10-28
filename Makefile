# n8n local — Makefile
# Windows: chạy trong Git Bash (cài make: `winget install ezwinports.make` hoặc `choco install make`)
SHELL := bash
.SHELLFLAGS := -ec
.ONESHELL:
.DEFAULT_GOAL := help
export MSYS_NO_PATHCONV := 1

COMPOSE    := docker compose
COMPOSE_AI := docker compose --profile ai-local
S ?= n8n

.PHONY: help env up up-ai down restart logs ps backup export import models reset shell

help: ## Hiển thị danh sách lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

env: ## Tạo .env từ .env.example và tự sinh secret (chỉ khi chưa có .env)
	@if [ -f .env ]; then echo ".env đã tồn tại — bỏ qua"; exit 0; fi
	cp .env.example .env
	key=$$(openssl rand -hex 32); pw=$$(openssl rand -base64 24 | tr -d '/+=')
	sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$$key|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$pw|" .env
	echo "✅ Đã tạo .env với N8N_ENCRYPTION_KEY và POSTGRES_PASSWORD ngẫu nhiên"

up: ## Chạy postgres + qdrant + n8n
	$(COMPOSE) up -d
	@echo "👉 n8n: http://localhost:5678  |  Qdrant: http://localhost:6333/dashboard"

up-ai: ## Chạy kèm Ollama (profile ai-local)
	$(COMPOSE_AI) up -d
	@echo "👉 Ollama: http://localhost:11434 (từ n8n dùng http://ollama:11434). Pull model: make models"

down: ## Dừng toàn bộ (giữ nguyên volume)
	$(COMPOSE_AI) down

restart: ## Restart service (mặc định n8n, đổi bằng S=postgres)
	$(COMPOSE_AI) restart $(S)

logs: ## Xem log (mặc định n8n, S=all để xem tất cả)
	@if [ "$(S)" = "all" ]; then $(COMPOSE_AI) logs -f --tail=200; else $(COMPOSE_AI) logs -f --tail=200 $(S); fi

ps: ## Trạng thái container
	$(COMPOSE_AI) ps

backup: ## pg_dump database ra backups/
	./scripts/backup.sh

export: ## Export workflow -> workflows/exported, credential (mã hoá) -> backups/credentials
	./scripts/export-workflows.sh

import: ## Import credential mẫu + workflow (DIR=... để chỉ định thư mục)
	./scripts/import-workflows.sh $(DIR)

models: ## Pull model Ollama (mặc định OLLAMA_MODELS trong .env)
	./scripts/pull-ollama-models.sh $(M)

reset: ## XOÁ TOÀN BỘ volume (workflow, credential, DB, vector, model)
	@echo "⚠️  Lệnh này xoá VĨNH VIỄN volume: n8n_data, postgres_data, qdrant_data, ollama_data"
	read -r -p "Gõ 'yes' để xác nhận: " ans
	if [ "$$ans" != "yes" ]; then echo "Đã huỷ."; exit 1; fi
	$(COMPOSE_AI) down -v --remove-orphans
	echo "✅ Đã reset. Chạy 'make up' để khởi tạo lại."

shell: ## Mở shell trong container (mặc định n8n, S=postgres ...)
	$(COMPOSE_AI) exec $(S) sh
