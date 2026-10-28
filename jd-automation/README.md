# Tự động đăng tuyển dụng đa nền tảng (n8n + Claude + OpenAI)

Workflow: **`[dev] jd-tuyen-dung-da-nen-tang`** (id `jdAutoPostV20001`).

Người dùng điền form JD → Claude phân tích JD → viết 4 bài (LinkedIn, Threads, Facebook Groups, Facebook Page) → chọn nội dung + phong cách poster → OpenAI tạo ảnh nền → n8n chèn chữ tiếng Việt chính xác lên poster → upload Google Drive (public link) → kiểm tra chất lượng (tối đa 1 lần viết lại) → lưu Google Sheets.

## Cấu trúc thư mục

```
jd-automation/
├── jd-automation.v2.json        # workflow để import (SINH TỰ ĐỘNG, đừng sửa tay)
├── build-workflow.mjs           # script sinh workflow từ prompts/ + schemas/
├── prompts/                     # system prompt từng agent/chain (nguồn sự thật cho prompt)
├── schemas/                     # JSON schema của các Structured Output Parser
├── sheets-template.md           # cột của tab JD và Posts
├── test-data/                   # 2 JD mẫu + kết quả mong đợi
└── original/my-workflow.original.json   # bản sao workflow gốc "My workflow" (giữ nguyên)
```

Sửa prompt/schema → chạy `node jd-automation/build-workflow.mjs` → import lại (mục 3).

## 1. Chạy stack

Mở **Git Bash** tại `D:\n8n-local`:

```bash
docker compose up -d              # hoặc: make up
docker compose ps                 # n8n phải "healthy"
```

Thay đổi Docker đã áp dụng cho dự án này:

- `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` — ảnh poster lưu ra đĩa, không giữ trong RAM.
- `N8N_STORAGE_PATH=/data/n8n-storage` bind mount `./data/n8n-storage` → nằm trên ổ D (`D:\n8n-local\data\n8n-storage`).
- Image đã pin version (`n8n 2.45.4`), `GENERIC_TIMEZONE/TZ=Asia/Ho_Chi_Minh`, `WEBHOOK_URL`, `restart: unless-stopped`, `N8N_ENCRYPTION_KEY` lấy cố định từ `.env`.
- Postgres và `n8n_data` **vẫn là named volume** (cố ý): chuyển sang thư mục Windows sẽ làm mất dữ liệu hiện có và Postgres chạy trên NTFS bind mount hay lỗi quyền/chậm.

## 2. Secret và credential

Mọi secret nằm trong `.env` (đã gitignore), **không** nằm trong workflow JSON.

| Credential trong n8n | Cách tạo | Dùng ở node |
|---|---|---|
| `Anthropic (from .env)` — id `anthropicLocal01` | Điền `ANTHROPIC_API_KEY` trong `.env` → chạy `./scripts/import-workflows.sh workflows/credentials-templates` | Mọi node *Claude Chat Model / … Model / Image Prompt* |
| `OpenAI (from .env)` — id `openAiLocal00001` | Điền `OPENAI_API_KEY` → như trên | `Generate Image`, `Generate Image With Logo` |
| Google Sheets OAuth2 | UI: *Credentials → New → Google Sheets OAuth2 API*, dán `GOOGLE_OAUTH_CLIENT_ID/SECRET` từ `.env`, bấm **Sign in with Google** | 7 node Google Sheets |
| Google Drive OAuth2 | Tương tự, loại *Google Drive OAuth2 API* | `Upload to Drive`, `Share Anyone With Link` |
| Basic Auth — `Unnamed credential` (id `CLtFsk0dNV90Z52V`, có sẵn) | Đã có; nên đổi tên + đặt user/password trong UI | `JD Input Form` |

Google Cloud Console: tạo OAuth Client loại *Web application*, Redirect URI `http://localhost:5678/rest/oauth2-credential/callback`, bật **Google Sheets API** và **Google Drive API**. Nếu app ở chế độ *Testing* thì thêm email của bạn vào *Test users*.

> Credential Google không được tạo tự động từ `.env` vì mỗi lần import lại sẽ ghi đè và xoá token OAuth.

Sau khi tạo credential Google, mở workflow → mỗi node Google báo đỏ → chọn credential vừa tạo (n8n tự gán nếu chỉ có 1 credential cùng loại).

## 3. Import workflow

```bash
export MSYS_NO_PATHCONV=1
docker compose cp jd-automation/jd-automation.v2.json n8n:/tmp/jd-automation.v2.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/jd-automation.v2.json
./scripts/export-workflows.sh     # = make export, lưu bản export vào workflows/exported/
```

Import theo id nên chạy lại sẽ **ghi đè** workflow `jdAutoPostV20001` (mất các chỉnh sửa trong UI — nếu đã sửa trong UI thì chạy export trước). Workflow gốc `My workflow` không bị đụng tới.

## 4. Cấu hình bắt buộc trong workflow

1. **Google Sheets**: tạo file theo [sheets-template.md](sheets-template.md). Lấy ID từ URL `https://docs.google.com/spreadsheets/d/<ID>/edit`.
2. **Thư mục Drive**: tạo thư mục chứa poster, lấy ID từ URL `https://drive.google.com/drive/folders/<ID>`.
3. Mở node **`Config`** → điền `spreadsheet_id`, `drive_folder_id`.
4. Mở node **`Error Config`** (nhánh lỗi) → điền **cùng** `spreadsheet_id`.
5. (Tùy chọn) Logo: đặt file PNG tại `D:\n8n-local\local-files\jd-automation\logo.png` (trong container: `/files/jd-automation/logo.png`). Không có logo → nhánh `Generate Image`.
6. (Tùy chọn) `Config.enable_text_overlay` = `false` để tắt bước chèn chữ (mặc định bật).
7. Settings → **Error Workflow** đã trỏ về chính workflow này (`jdAutoPostV20001`) — kiểm tra lại sau khi import.

Model: Claude `claude-sonnet-5-5` ở tất cả node Claude (workflow gốc chưa cấu hình model nào); ảnh dùng `gpt-image-1` (đổi ở `Config.image_model`).

## 5. Test bằng JD mẫu

Error Trigger chỉ chạy với execution **production**, nên test theo cách sau:

1. Bật workflow (toggle **Active/Publish**) sau khi đã cấu hình xong mục 4.
2. Mở node `JD Input Form` → tab **Production URL** → mở URL trong trình duyệt, đăng nhập Basic Auth.
3. Dán nội dung từ [test-data/jd-01-day-du.md](test-data/jd-01-day-du.md) → Submit.
4. Theo dõi: tab JD `New → Processing → Done`; tab Posts thêm 4 dòng; mở `poster_url` ở cửa sổ ẩn danh.
5. Lặp lại với [test-data/jd-02-thieu-luong-lien-he.md](test-data/jd-02-thieu-luong-lien-he.md) → không bài nào có lương, cột `warnings` có cảnh báo.
6. Test lỗi: làm theo mục *Kịch bản lỗi* trong [test-data/expected-results.md](test-data/expected-results.md).

Chạy thử từng phần trong editor (Test workflow) vẫn được, nhưng nhánh `Error Trigger` sẽ **không** chạy với execution thủ công.

## 6. Luồng xử lý và chống lỗi

- **Retry**: mọi node gọi Claude/OpenAI/Google có *Retry On Fail* 3 lần, cách 5 giây.
- **Output Parser**: mọi output LLM đi qua *Structured Output Parser* với **Auto-Fix Format** bật (dùng chính model Claude của chain đó để sửa JSON).
- **Chống bịa**: system prompt cấm bịa; `Check Posts Quality` đánh trượt bài có số tiền không xuất hiện trong JD, có lương khi JD không nêu, thiếu liên hệ có trong JD, còn placeholder, vượt giới hạn ký tự, hoặc không phải tiếng Việt có dấu. Hashtag được tự chuẩn hoá/cắt theo giới hạn.
- **Viết lại tối đa 1 lần**: bài lỗi → `Prepare Rewrite` → `Rewrite Failed Post` → kiểm tra lại; vẫn lỗi → `Set Validation Failed` kèm lý do.
- **Poster tiếng Việt**: ảnh AI chỉ là nền **không có chữ**; node `Overlay Poster Text` (Edit Image / GraphicsMagick, font Arial Bold có sẵn trong image n8n) vẽ tên công ty, vị trí, lương, 3 điểm nổi bật, liên hệ ở dải tối phía dưới → luôn đúng dấu.
- **Nhánh lỗi**: `Error Trigger` → tìm dòng JD có `status = Processing` **và** `execution_id` khớp execution lỗi → `status = Error`, `error_message = <lỗi> | Node lỗi: <tên node>`.

## 7. Lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Node Google báo `Credentials not found` | Chưa tạo/gán credential Google (mục 2) |
| `The resource you are requesting could not be found` ở Sheets | Sai `spreadsheet_id`, hoặc thiếu tab `JD`/`Posts`, hoặc sai tên cột dòng 1 |
| `File not found` ở Upload to Drive | Sai `drive_folder_id` hoặc tài khoản OAuth không có quyền thư mục |
| `access_denied` khi Sign in with Google | Chưa thêm email vào *Test users* của OAuth consent screen |
| Claude báo `model not found` | Tài khoản Anthropic không có model `claude-sonnet-5-5` → đổi model trong các node Claude |
| OpenAI `must be verified to use gpt-image-1` | Cần xác minh tổ chức trên platform.openai.com, hoặc đổi `Config.image_model` |
| `The selected font is not available` ở Overlay | Đổi `Config.overlay_font` sang font có trong `docker compose exec n8n ls /usr/share/fonts/truetype/msttcorefonts` |
| Trạng thái kẹt ở `Processing` | Workflow chưa active hoặc chưa đặt Error Workflow; execution thủ công không kích hoạt Error Trigger |
| Status `Validation Failed` | Xem `error_message` — liệt kê lỗi cụ thể theo từng nền tảng |
| n8n-mcp báo `SSRF protection: Localhost access is blocked` | n8n-mcp mặc định chặn localhost. Nếu chấp nhận, thêm `"WEBHOOK_SECURITY_MODE": "moderate"` vào `env` của `n8n-mcp` trong `.mcp.json` (chỉ mở localhost, vẫn chặn IP private khác) → khởi động lại Claude Code |
| n8n-mcp / API trả `401 Unauthorized` | API key hết hạn hoặc bị xoá: tạo key mới ở *Settings → n8n API*, cập nhật `.env` và biến môi trường của shell chạy Claude Code |
