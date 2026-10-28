# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dự án này là môi trường **n8n self-hosted chạy local** (Docker Compose) để dev/test automation và AI Agent.
Đây **không phải** source code của n8n — không có build/lint/test; "code" ở đây là JSON workflow,
`docker-compose.yml`, `Makefile` và `scripts/*.sh`. Chỉ dùng cho local (http, port bind 127.0.0.1), không production.
Trợ lý AI tương tác với n8n qua MCP server **n8n-mcp** (khai báo trong `.mcp.json`).

## Môi trường

| Thành phần | Từ máy host | Từ bên trong n8n (container) |
|---|---|---|
| n8n editor / API | http://localhost:5678 | http://localhost:5678 |
| Ollama | http://localhost:11434 | **http://ollama:11434** |
| Qdrant | http://localhost:6333 | **http://qdrant:6333** |
| Postgres | localhost:15432 (`POSTGRES_HOST_PORT`) | postgres:5432 |
| Dịch vụ chạy trên host | — | http://host.docker.internal:<port> |
| File | `./local-files/` | `/files/` (chỉ được đọc/ghi trong thư mục này) |

Credential có sẵn sau `make import` (tham chiếu theo id, KHÔNG tạo lại):
- `ollamaLocal00001` — Ollama local (`ollamaApi`)
- `qdrantLocal00001` — Qdrant local (`qdrantApi`)
- `openAiLocal00001`, `anthropicLocal01`, `geminiLocal00001` — chỉ có nếu người dùng điền key trong `.env`

Workflow xử lý lỗi dùng chung: `exErrorHandler01` (`[dev] error-handler`).

## Quy tắc bắt buộc

1. **Tra cứu trước, không đoán.** Trước khi dựng workflow, LUÔN dùng tool của n8n-mcp
   (`search_nodes`, `get_node`/`get_node_essentials`, `search_templates`, …) để lấy đúng
   tên node (`type`), `typeVersion` và tên parameter. Không được đoán tên node hoặc parameter
   từ trí nhớ. Nếu tool không tìm thấy, báo lại cho người dùng thay vì bịa.
2. **Validate trước khi deploy.** Chạy `validate_node` cho từng node đã cấu hình và
   `validate_workflow` cho cả workflow; sửa hết lỗi (error) trước khi gọi
   `n8n_create_workflow` / `n8n_update_*`. Sau khi tạo, chạy `n8n_validate_workflow` theo id.
3. **Luôn tạo ở trạng thái inactive.** Không tự activate/publish workflow; người dùng sẽ tự
   bật sau khi test.
4. **Đặt tên theo quy ước** `[env] tên-chức-năng`, chữ thường, gạch nối.
   `env` ∈ `dev` | `test` | `staging`. Ví dụ: `[dev] tong-hop-don-hang-hang-ngay`.
   Tên node mô tả hành động ("Fetch Orders", "Build Report"); tên tool của AI Agent viết
   `snake_case` (ví dụ `tra_cuu_san_pham`).
5. **Không bao giờ ghi secret vào JSON workflow.** Không đặt API key, token, password trong
   parameter, header, URL hay Code node. Luôn dùng **Credentials** của n8n (tham chiếu bằng
   `credentials: { <type>: { id, name } }`). Nếu credential chưa tồn tại, hướng dẫn người dùng
   tạo trong UI hoặc thêm key vào `.env` rồi `make import`.
6. **Xử lý lỗi.** Mỗi workflow phải có ít nhất một trong các cách sau:
   - `settings.errorWorkflow = "exErrorHandler01"` (mặc định nên dùng), hoặc
   - node **Error Trigger** riêng, hoặc
   - cấu hình `onError: "continueErrorOutput"` + nhánh xử lý lỗi cho node gọi API bên ngoài.
7. **Sau khi tạo/sửa workflow**, chạy `make export` để lưu JSON vào `workflows/exported/`
   (để commit git). Không sửa tay file trong `workflows/exported/` rồi coi đó là nguồn sự thật
   — nguồn sự thật là n8n, file JSON là bản export.
8. **Giải thích ngắn gọn bằng tiếng Việt** từng node sau khi tạo: tên node → vai trò (1 dòng).
   Nên thêm 1 Sticky Note trong workflow tóm tắt mục đích và cách test.

## Quy ước kỹ thuật

- URL nội bộ trong container dùng tên service (`ollama`, `qdrant`, `postgres`), không dùng `localhost`.
- AI Agent: ưu tiên node `@n8n/n8n-nodes-langchain.agent` (Tools Agent); model mặc định
  Ollama `llama3.2:latest`, embeddings `nomic-embed-text:latest` (768 chiều).
- Mỗi tool của Agent phải có mô tả (`description`/`toolDescription`) rõ ràng bằng tiếng Việt,
  nói rõ input/output. Dùng `$fromAI()` cho tham số do model điền.
- System prompt viết tiếng Việt, nêu rõ: vai trò, danh sách tool, khi nào phải gọi tool, cấm bịa số liệu.
- Timezone: `Asia/Ho_Chi_Minh`. Dùng `$now.setZone('Asia/Ho_Chi_Minh')` khi cần.
- Đọc/ghi file chỉ trong `/files/...`.
- Webhook test: `http://localhost:5678/webhook-test/<path>`; production: `/webhook/<path>`.
- Settings mặc định của workflow mới: `{ "executionOrder": "v1", "errorWorkflow": "exErrorHandler01" }`.

## Kiến trúc & luồng dữ liệu

- **Stack** (`docker-compose.yml`, project name `n8n-local`): `postgres` (DB của n8n) → `qdrant` → `n8n`
  (`depends_on` healthy). `ollama` chỉ chạy với profile `ai-local` — lệnh `docker compose` không kèm
  `--profile ai-local` sẽ không thấy service này (Makefile đã dùng `COMPOSE_AI` cho down/ps/logs/restart).
- **Nguồn sự thật là DB Postgres trong n8n**, không phải file JSON. Scripts dùng CLI `n8n` *bên trong container*
  (`docker compose exec n8n n8n export:workflow|import:workflow|import:credentials`), copy qua `docker compose cp`.
- `make import` thứ tự: `workflows/credentials-templates/` → credential sinh từ key cloud trong `.env`
  (id cố định `openAiLocal00001`…) → `workflows/examples/` → `workflows/exported/`. Import theo **id**, nên bản
  exported ghi đè bản example cùng id (examples có id `exErrorHandler01`, `exHelloWebhook01`, `exAiAgentBasic01`,
  `exSubTraCuuSP001`, `exRagQdrantOll01`). Workflow import vào luôn inactive.
- `make export` **xoá hết** `workflows/exported/*.json` rồi ghi lại — workflow đã xoá trong n8n sẽ biến mất khỏi git.
  Credential export (mã hoá) vào `backups/credentials/` (gitignored).
- Workflow mẫu `02-ai-agent-basic` gọi sub-workflow `exSubTraCuuSP001` qua Workflow Tool; `04-rag` dùng Qdrant +
  `nomic-embed-text`. Khi sửa sub-workflow, giữ nguyên id và input schema.

## Lệnh hữu ích

Chạy trong **Git Bash** (Windows) — scripts cần bash và `MSYS_NO_PATHCONV=1` (Makefile/scripts đã set).

```bash
make up / make up-ai     # chạy stack (kèm Ollama)
make ps / make logs      # trạng thái / log n8n (S=postgres|qdrant|ollama|all)
make export              # export workflow -> workflows/exported/
make import [DIR=...]    # import credential mẫu + workflow
make models [M="a b"]    # pull model Ollama
make backup              # pg_dump -> backups/ (giữ 10 bản)
docker compose exec n8n n8n list:workflow     # kiểm tra nhanh workflow trong DB
curl -X POST http://localhost:5678/webhook/hello -H "Content-Type: application/json" -d '{"name":"Lan"}'
```

Kiểm tra API/MCP: Swagger tại http://localhost:5678/api/v1/docs; trong Claude Code chạy `/mcp`.
`N8N_API_KEY` phải có trong **biến môi trường của shell** chạy Claude Code (Claude Code không đọc `.env`).

## Không được làm nếu người dùng chưa yêu cầu rõ

- Đổi `N8N_ENCRYPTION_KEY` trong `.env` → mọi credential không giải mã được (`Mismatching encryption keys`).
- `make reset` / `docker compose down -v` → xoá vĩnh viễn toàn bộ volume (workflow, DB, vector, model).
- `DECRYPTED=1 ./scripts/export-workflows.sh` → credential plaintext ra đĩa.
- Đổi port n8n 5678: phải sửa đồng thời `docker-compose.yml` (ports, `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`) và `.mcp.json`.
- Đổi image Postgres sang major khác khi đã có dữ liệu (cần dump/restore).
