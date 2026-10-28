# n8n local — môi trường test automation & AI Agent

> ⚠️ **Chỉ dành cho máy local (dev/test).** Không dùng production: chạy http, cookie không secure, không có reverse proxy/TLS, không có backup tự động hay giới hạn tài nguyên.

Stack (pin version):

| Service | Image | Port (chỉ 127.0.0.1) | Ghi chú |
|---|---|---|---|
| n8n | `docker.n8n.io/n8nio/n8n:2.45.4` | 5678 | DB = Postgres, task runners bật |
| PostgreSQL | `postgres:16.15-alpine` | 15432 | DB của n8n |
| Qdrant | `qdrant/qdrant:v1.20.0` | 6333 / 6334 | Vector DB cho RAG |
| Ollama *(profile `ai-local`)* | `ollama/ollama:0.40.11` | 11434 | LLM local: `llama3.2`, `nomic-embed-text` |
| n8n-mcp | `npx n8n-mcp@2.99.2` | — | MCP server giúp Claude Code tra cứu node & quản lý workflow |

```
n8n-local/
├── docker-compose.yml        # stack
├── .env.example              # mẫu biến môi trường (copy -> .env)
├── Makefile                  # lệnh tắt
├── CLAUDE.md                 # quy tắc cho trợ lý AI
├── .mcp.json                 # cấu hình n8n-mcp cho Claude Code
├── scripts/                  # backup / export / import / pull model
├── workflows/
│   ├── examples/             # workflow mẫu (00 → 04)
│   ├── exported/             # kết quả `make export` (commit vào git)
│   └── credentials-templates/# credential Ollama/Qdrant (không chứa secret)
├── local-files/              # mount vào /files trong n8n
└── backups/                  # pg_dump + credential đã mã hoá (gitignored)
```

## 1. Yêu cầu

- **Docker Desktop** (Windows dùng backend WSL2) — Compose v2.
- **RAM ≥ 8 GB** cho n8n + Postgres + Qdrant; **≥ 16 GB** nếu chạy Ollama (`llama3.2` 3B cần ~3–4 GB RAM).
- Ổ đĩa trống ~10 GB (image + model).
- **Git Bash** (Windows) hoặc terminal bash (macOS/Linux) để chạy `scripts/*.sh`.
- **make** — Windows: `winget install ezwinports.make` (hoặc `choco install make`), rồi chạy `make` trong Git Bash.
  Không có make thì chạy thẳng lệnh tương ứng (xem bảng ở mục 4).
- **Node.js ≥ 18** (để `npx n8n-mcp`) và **Claude Code** nếu dùng trợ lý AI.

## 2. Khởi động nhanh

```bash
cd n8n-local

# 1) Tạo .env
make env                      # copy .env.example -> .env và tự sinh N8N_ENCRYPTION_KEY + POSTGRES_PASSWORD
#   hoặc làm tay:
#   cp .env.example .env
#   openssl rand -hex 32                      -> dán vào N8N_ENCRYPTION_KEY
#   openssl rand -base64 24 | tr -d '/+='     -> dán vào POSTGRES_PASSWORD

# 2) Chạy stack
make up
make ps                       # đợi n8n, postgres, qdrant đều "healthy"

# 3) Mở http://localhost:5678 -> tạo owner account (email/password local)

# 4) Import credential mẫu + workflow mẫu
make import

# 5) Tạo API key cho n8n-mcp:
#    Settings -> n8n API -> Create an API key -> copy, dán vào N8N_API_KEY trong .env

# 6) Bật LLM local và tải model
make up-ai
make models                   # pull llama3.2 + nomic-embed-text (~2.3 GB)
```

> 💾 **Lưu `N8N_ENCRYPTION_KEY` vào password manager.** Mất/đổi key = mất toàn bộ credential.

## 3. Kiểm tra

```bash
# Webhook mẫu (cần bật workflow trước: mở "[dev] webhook-hello" -> Publish / Active)
curl -X POST http://localhost:5678/webhook/hello \
  -H "Content-Type: application/json" -d '{"name":"Lan"}'
# => {"message":"Xin chào Lan! n8n local đã chạy.","receivedAt":"...+07:00","echo":{"name":"Lan"}}

# Hoặc chế độ test: mở workflow, bấm "Execute workflow", rồi gọi /webhook-test/hello

# Dữ liệu bền vững: restart rồi kiểm tra workflow còn nguyên
make restart && make ps
docker compose exec n8n n8n list:workflow
```

**AI Agent mẫu:** mở `[dev] ai-agent-basic` → bấm **Open chat** → hỏi
*"Mật ong còn hàng không? Mua 3 chai hết bao nhiêu tiền, quy ra USD?"*.
Agent sẽ gọi `tra_cuu_san_pham` (sub-workflow), `calculator` và `ty_gia` (HTTP Request Tool).

**RAG mẫu:** mở `[dev] rag-qdrant-ollama` → chạy nhánh **Run Ingest** một lần → **Open chat** → hỏi
*"Đơn 300k ship về Đà Nẵng mất bao nhiêu?"*. Xem dữ liệu vector ở http://localhost:6333/dashboard.

### Workflow mẫu

| File | Tên trong n8n | Nội dung |
|---|---|---|
| `00-error-handler.json` | `[dev] error-handler` | Error Trigger dùng chung; các workflow khác trỏ `errorWorkflow` về đây |
| `01-webhook-hello.json` | `[dev] webhook-hello` | Webhook POST `/hello` → Set → Respond JSON |
| `02-ai-agent-basic.json` | `[dev] ai-agent-basic` | Chat Trigger → AI Agent + Ollama + Window Buffer Memory + Calculator + HTTP Request Tool + Workflow Tool |
| `03-subworkflow-tra-cuu-san-pham.json` | `[dev] sub-tra-cuu-san-pham` | Sub-workflow được Agent gọi |
| `04-rag-qdrant-ollama.json` | `[dev] rag-qdrant-ollama` | Ingest vào Qdrant + Agent hỏi đáp RAG |

**Đổi model sang OpenAI/Anthropic/Gemini:** điền `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` vào `.env`
→ `make import` (script tự tạo credential *OpenAI (from .env)*… trong n8n, key không bị ghi vào repo)
→ trong workflow thay node *Ollama Chat Model* bằng *OpenAI Chat Model* / *Anthropic Chat Model* / *Google Gemini Chat Model* và nối vào cổng **Chat Model** của AI Agent.

## 4. Lệnh

| `make` | Không có make (Git Bash) | Mô tả |
|---|---|---|
| `make up` | `docker compose up -d` | Chạy postgres + qdrant + n8n |
| `make up-ai` | `docker compose --profile ai-local up -d` | Chạy kèm Ollama |
| `make down` | `docker compose --profile ai-local down` | Dừng (giữ dữ liệu) |
| `make restart [S=svc]` | `docker compose restart n8n` | Restart service |
| `make logs [S=svc\|all]` | `docker compose logs -f n8n` | Xem log |
| `make ps` | `docker compose --profile ai-local ps` | Trạng thái |
| `make backup` | `./scripts/backup.sh` | `pg_dump` → `backups/n8n-db-<timestamp>.sql.gz` (giữ 10 bản) |
| `make export` | `./scripts/export-workflows.sh` | Workflow → `workflows/exported/`, credential (mã hoá) → `backups/credentials/` |
| `make import [DIR=...]` | `./scripts/import-workflows.sh [dir]` | Import credential mẫu + `workflows/examples` + `workflows/exported` |
| `make models [M="a b"]` | `./scripts/pull-ollama-models.sh [model]` | Pull model Ollama |
| `make reset` | `docker compose --profile ai-local down -v` | **Xoá toàn bộ volume** (hỏi xác nhận) |
| `make shell [S=svc]` | `docker compose exec n8n sh` | Shell trong container |

**Restore DB từ backup:**
```bash
gunzip -c backups/n8n-db-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T postgres psql -U n8n -d n8n
make restart
```
(Dùng đúng `N8N_ENCRYPTION_KEY` cũ thì credential mới giải mã được.)

**Export credential dạng plaintext** (chỉ khi cần migrate, xoá ngay sau đó): `DECRYPTED=1 ./scripts/export-workflows.sh`.

**Quy trình git:** sửa workflow trong UI (hoặc nhờ AI) → `make export` → `git add workflows/exported && git commit`.
Máy khác: `git pull` → `make import`.

## 5. Kết nối trợ lý AI (Claude Code + n8n-mcp)

`.mcp.json` khai báo MCP server `n8n-mcp` (chạy bằng `npx`, `MCP_MODE=stdio`, `LOG_LEVEL=error`,
`N8N_API_URL=http://localhost:5678`). `N8N_API_KEY` được đọc từ **biến môi trường của shell** chạy Claude Code
(Claude Code không tự đọc `.env`).

```powershell
# PowerShell (Windows) — phiên hiện tại
$env:N8N_API_KEY = "<api key tạo ở bước 5>"
# hoặc lưu vĩnh viễn cho user (mở terminal mới sau khi chạy):
setx N8N_API_KEY "<api key>"

cd n8n-local
claude                # Claude Code hỏi cho phép dùng MCP server của project -> chọn Allow
# trong Claude Code: /mcp  -> kiểm tra n8n-mcp "connected"
```

```bash
# Git Bash / macOS / Linux
export N8N_API_KEY="$(grep ^N8N_API_KEY= .env | cut -d= -f2-)"
claude
```

> macOS/Linux: trong `.mcp.json` đổi `"command": "cmd", "args": ["/c", "npx", ...]` thành
> `"command": "npx", "args": ["-y", "n8n-mcp@2.99.2"]`.
>
> Thay cho npx có thể chạy bằng Docker: `"command": "docker", "args": ["run", "-i", "--rm", "--init", "-e", "MCP_MODE=stdio", "-e", "LOG_LEVEL=error", "-e", "DISABLE_CONSOLE_OUTPUT=true", "-e", "N8N_API_URL=http://host.docker.internal:5678", "-e", "N8N_API_KEY", "ghcr.io/czlonkowski/n8n-mcp:latest"]` (nên pin tag cụ thể).

Claude Code tự đọc `CLAUDE.md` — trợ lý sẽ tra node bằng n8n-mcp, validate, tạo workflow **inactive**,
đặt tên `[dev] ...`, dùng Credentials, gắn error workflow và nhắc chạy `make export`.

### 3 prompt mẫu

1. **Agent chăm sóc khách hàng (RAG)**
   > Tạo workflow `[dev] cskh-faq-agent`: Chat Trigger → AI Agent dùng Ollama `llama3.2`, Window Buffer Memory 8 lượt, tool tìm kiếm Qdrant collection `kb_demo` (embeddings `nomic-embed-text`). System prompt tiếng Việt: chỉ trả lời dựa trên kho kiến thức, không có thì đề nghị gọi hotline. Dùng credential có sẵn, validate rồi tạo ở trạng thái inactive và giải thích từng node.

2. **Agent tổng hợp tin tức theo lịch**
   > Tạo workflow `[dev] tom-tat-tin-cong-nghe`: Schedule Trigger 8h sáng mỗi ngày (giờ VN) → đọc RSS `https://vnexpress.net/rss/so-hoa.rss` → lấy 10 tin mới nhất → AI Agent (Ollama) tóm tắt mỗi tin 2 câu tiếng Việt → ghi file Markdown vào `/files/tin-tuc/<ngày>.md`. Có xử lý lỗi bằng error workflow `exErrorHandler01`. Tra cứu node bằng n8n-mcp trước, không đoán tham số.

3. **Agent phân loại email/ticket qua webhook**
   > Tạo workflow `[dev] phan-loai-ticket`: Webhook POST `/ticket` nhận `{subject, body, email}` → AI Agent với Structured Output Parser trả JSON `{category: "billing"|"ky_thuat"|"khac", priority: 1-3, tom_tat}` → Switch theo category → Respond to Webhook trả kết quả. Dùng Ollama, có nhánh xử lý lỗi khi model trả JSON sai. Sau khi tạo, nhắc tôi chạy `make export`.

## 6. Xử lý lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ports are not available` / `bind: address already in use` / `access permissions` | Port 5678/15432/6333/11434 bị app khác chiếm hoặc nằm trong dải Windows reserve (Hyper-V) | Xem tiến trình: `netstat -ano \| findstr :5678`; xem dải bị reserve: `netsh int ipv4 show excludedportrange protocol=tcp`. Đổi `POSTGRES_HOST_PORT` / `QDRANT_HOST_PORT` / `OLLAMA_HOST_PORT` trong `.env`. Port n8n đổi ở `docker-compose.yml` **và** `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `.mcp.json` |
| Webhook trả 404 `not registered` | Workflow chưa Publish/Active (URL `/webhook/...`) hoặc chưa bấm *Execute workflow* (URL `/webhook-test/...`) | Bật workflow, hoặc dùng URL test đúng lúc editor đang chờ. Kiểm tra đúng method (POST) và path |
| Webhook từ dịch vụ bên ngoài (GitHub, Telegram…) không tới | `localhost` không truy cập được từ internet | Dùng tunnel tạm (`cloudflared tunnel --url http://localhost:5678`, ngrok) và đặt `WEBHOOK_URL` = URL tunnel, rồi `make restart` |
| Ollama: `ECONNREFUSED 127.0.0.1:11434` | Dùng `localhost` trong credential — trong container `localhost` là chính n8n | Base URL credential phải là **`http://ollama:11434`**. Đảm bảo đã `make up-ai`. Ollama cài trên máy host thì dùng `http://host.docker.internal:11434` |
| Ollama: `model "llama3.2" not found` | Chưa pull model | `make models` (kiểm tra: `docker compose exec ollama ollama list`) |
| Agent trả lời chậm / không gọi tool | Model 3B trên CPU yếu về tool calling | Bật GPU (bỏ comment khối `deploy` trong compose), dùng model lớn hơn (`qwen2.5:7b`, `llama3.1:8b`) hoặc chuyển sang OpenAI/Anthropic |
| `Credentials could not be decrypted` / mất credential | `N8N_ENCRYPTION_KEY` bị đổi so với lúc tạo credential | Khôi phục key cũ trong `.env` rồi `make restart`. Nếu mất key: xoá và tạo lại credential (hoặc `make reset` + `make import`) |
| `Mismatching encryption keys` khi n8n khởi động | Key trong `.env` khác key đã lưu trong volume `n8n_data` | Như trên — dùng lại key cũ, hoặc `make reset` nếu chấp nhận mất dữ liệu |
| n8n-mcp không kết nối / `401 Unauthorized` | Chưa set `N8N_API_KEY` trong shell, hoặc key bị xoá | `echo $env:N8N_API_KEY` (PowerShell), tạo key mới trong UI, mở lại Claude Code, kiểm tra `/mcp` |
| Script báo `GetFileAttributesEx E:\tmp ...` hoặc path lạ | Git Bash tự đổi path `/xxx` | Scripts đã đặt `MSYS_NO_PATHCONV=1`; chạy script qua `make` hoặc trong Git Bash, không chạy trong cmd |
| `$'\r': command not found` khi chạy script | File `.sh` bị đổi sang CRLF | `git config core.autocrlf input` rồi checkout lại (`.gitattributes` đã ép LF), hoặc `sed -i 's/\r$//' scripts/*.sh` |
| Node Read/Write File báo không có quyền | `N8N_RESTRICT_FILE_ACCESS_TO=/files` | Chỉ đọc/ghi trong `/files/...` (tương ứng `./local-files/` trên host) |
| Log có cảnh báo `Postgres 16 is outside the supported range` | n8n 2.4x khuyến nghị Postgres 17+ | Không ảnh hưởng khi chạy local. Muốn hết cảnh báo: đổi image sang `postgres:17-alpine` **trước khi** tạo dữ liệu (hoặc dump/restore) |

## 7. Lưu ý bảo mật

- Mọi port chỉ bind `127.0.0.1` — máy khác trong LAN không truy cập được.
- `.env`, `backups/`, `local-files/*` nằm trong `.gitignore`. Không commit credential export dạng decrypted.
- Workflow JSON trong git không chứa secret (chỉ tham chiếu credential theo id).
- Cấu hình này **không dành cho production**: muốn deploy thật cần HTTPS (reverse proxy), `N8N_SECURE_COOKIE=true`, backup định kỳ, queue mode/worker, giới hạn tài nguyên, quản lý secret đúng chuẩn.
