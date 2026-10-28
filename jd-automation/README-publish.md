# `[dev] jd-tuyen-dung-da-nen-tang` — bản gọn (v5)

Một workflow, **24 node chính + 2 node AI phụ**, chia 6 khung. Gồm tạo bài, poster, lưu Sheet, đăng 4 nền tảng và bắt lỗi.

| | |
|---|---|
| Workflow | `[dev] jd-tuyen-dung-da-nen-tang`, id `jdAutoPostV20001` |
| File nguồn | `jd-automation.v5.json`, sinh bởi `node jd-automation/build-lean.mjs` |
| Prompt / schema | Sửa các file trong `prompts/` và `schemas/`; build sẽ tự ghép thành `prompts/all-in-one.system.md`, `schemas/all-in-one.schema.json` |
| Backup | `backup/…v2-before-v4…json`, `backup/…v4-before-v5…json` (bản đầy đủ 127 node) |
| Thông tin API nền tảng | [docs/platform-notes.md](docs/platform-notes.md) |

## 1. Luồng

```text
[0] JD Form ──┐
[0] Every 5 minutes ─┼─▶ [0] Config ─▶ [0] Route ─┬─ form ───▶ [1] Add JD Row ─▶ [1] AI Analyze & Write
[0] Error Trigger ──┘                             │             ─▶ [2] Generate Image ─▶ [2] Overlay Text ─▶ [2] Upload to Drive
                                                  │             ─▶ [3] Check & Build Rows ─▶ [3] Save Posts ─▶ [3] Set JD Result
                                                  │             (lỗi ở bước [2] → nhảy thẳng sang [3], bài vẫn được lưu)
                                                  ├─ publish ─▶ [4] Read Posts ─▶ [4] Prepare Posts ─▶ [4] Download Poster ─▶ [4] Route by Platform
                                                  │             ─▶ LinkedIn | Threads Create→Publish | Facebook Photo | Facebook Text ─▶ [4] Save Result
                                                  └─ error ───▶ [5] Set JD Error
```

| Khung | Node | Việc chính |
|---|---|---|
| 0 Trigger & cấu hình | 5 | 3 trigger cùng vào **một** `[0] Config`, rồi `[0] Route` rẽ nhánh |
| 1 Tạo bài | 2 + 2 phụ | **Một** lần gọi Claude trả về: phân tích JD + 4 bài + prompt ảnh/màu poster |
| 2 Poster | 3 | Ảnh OpenAI → chèn chữ tiếng Việt → Drive (private). Lỗi thì bỏ qua poster |
| 3 Kiểm tra & lưu | 3 | Kiểm tra 4 bài; upsert tab Posts (`Draft`/`Needs Review`); JD `Done`/`Needs Review` |
| 4 Đăng bài | 10 | `[4] Prepare Posts` quyết định mọi thứ (xem mục 3), mỗi nền tảng 1 node đăng, `[4] Save Result` ghi kết quả |
| 5 Lỗi | 1 | JD → `Error` + lý do + tên node lỗi |

## 2. Cấu hình — node `[0] Config`

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `spreadsheet_id`, `drive_folder_id` | `REPLACE_WITH_…` | ID Sheet và thư mục Drive |
| `dry_run` | **`true`** | `true` = không gọi API đăng; dòng chuyển `Dry Run` và log nội dung vào `publish_log` |
| `enable_linkedin` / `_threads` / `_facebook_page` / `_facebook_groups` | `true` | Tắt nền tảng nào thì dòng của nó giữ nguyên `Approved` |
| `linkedin_person_id` | `REPLACE_…` | ID trong `urn:li:person:<id>` |
| `facebook_page_id`, `facebook_graph_version` | `REPLACE_…`, `v25.0` | |
| `threads_user_id` | `me` | |
| `min_gap_minutes` | 60 | Khoảng cách tối thiểu giữa 2 bài cùng nền tảng (mỗi lần chạy tối đa 1 bài/nền tảng) |
| `image_model`, `overlay_font` | `gpt-image-1`, Arial Bold | |

## 3. Quy tắc đăng bài (`[4] Prepare Posts`)

| Dòng Posts | Kết quả |
|---|---|
| `Draft`, `Needs Review`, … | Không đụng tới (chỉ `Approved` mới được đăng) |
| `Approved` nhưng `scheduled_at` ở tương lai | Đợi lần chạy sau |
| `Approved` và đã có `platform_post_id` | `Published`, **không đăng lại** |
| Rỗng hoặc vượt giới hạn (LinkedIn 3000, Threads 500 với emoji tính theo byte) | `Failed` + lý do |
| Facebook Groups | `Manual - Waiting` (không có API). Đăng tay xong thì đổi thành `Manual - Confirmed` → lần chạy sau ghi `Published (manual)` |
| `dry_run = true` | `Dry Run` + log nội dung |
| Còn lại | Đăng thật. Thành công → `Published` + `platform_post_id`, `post_url`. Lỗi → `Failed` + lý do (đã che token) |

Threads đăng **dạng chữ** (Threads cần ảnh có URL công khai, mà poster đang private). LinkedIn và Facebook Page đăng kèm poster nếu có.

## 4. Đã lược bỏ so với bản đầy đủ (v4)

Chống gửi trùng form, viết lại bài lỗi tự động (bài lỗi để `Needs Review` cho người duyệt sửa), logo, bật/tắt overlay, cột `step`, claim `Publishing`, tự thử lại khi gặp 429/5xx (lỗi ghi `Failed`, sửa xong thì đổi lại `Approved`), kiểm tra/làm mới token tự động, thông báo Telegram, cập nhật trạng thái JD `Published`, ảnh trên Threads. Muốn lấy lại tính năng nào thì xem `backup/…v4-before-v5…json` hoặc `build-single.mjs`.

## 5. Việc cần làm để chạy

1. **Key AI**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` trong `.env` → `./scripts/import-workflows.sh workflows/credentials-templates`.
2. **Google**: credential Sheets (bạn đã có `Google Sheets account 2`) + Drive OAuth2, gán vào các node Sheets/Drive.
3. **Sheet**: tạo theo [docs/sheets-template.md](docs/sheets-template.md); điền ID vào `[0] Config`.
4. **Nền tảng** (chi tiết API: [docs/platform-notes.md](docs/platform-notes.md)):
   - **LinkedIn**: linkedin.com/developers/apps → tạo app → Products: *Share on LinkedIn* + *Sign In with LinkedIn (OpenID Connect)* → Redirect URL `http://localhost:5678/rest/oauth2-credential/callback` → n8n credential **LinkedIn OAuth2 API** → Connect. Lấy `linkedin_person_id`: chọn tên của bạn ở trường *Person* của `[4] Post LinkedIn` để xem ID, rồi đặt lại biểu thức. Token hết hạn sau khoảng 60 ngày: bấm Connect lại.
   - **Threads**: developers.facebook.com/apps → use case *Threads API* → quyền `threads_basic`, `threads_content_publish` → thêm tài khoản của bạn làm *Threads Tester* → lấy token rồi đổi sang long-lived (`GET https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret=…&access_token=…`, chạy trong terminal của bạn) → n8n credential **Query Auth** (Name `access_token`, Value = token). Token 60 ngày; làm mới bằng `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=…` rồi cập nhật credential.
   - **Facebook Page**: app Meta với `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` → Graph API Explorer lấy user token → đổi long-lived → `GET /me/accounts` lấy Page token (không hết hạn) + Page ID → n8n credential **Facebook Graph API**. App ở chế độ Development chỉ đăng được lên Page của admin/tester; muốn Live cần App Review.
   - Gán credential cho `[4] Post LinkedIn`, `[4] Threads Create/Publish`, `[4] Post Facebook Photo/Text`.
5. **Test**: để `dry_run = true` → bật workflow (Active) → gửi form với `test-data/jd-01-day-du.md` → duyệt vài dòng sang `Approved` → sau ≤ 5 phút các dòng thành `Dry Run` kèm log.
6. Ổn định rồi mới đổi `dry_run = false`.

⚠ `[0] Error Trigger` chỉ ghi lỗi khi workflow **đang active**.
⚠ Import lại sẽ ghi đè cấu hình đã sửa trong UI; hãy export trước (`./scripts/export-workflows.sh`).

## 6. Import / cập nhật

```bash
node jd-automation/build-lean.mjs
export MSYS_NO_PATHCONV=1
docker compose cp jd-automation/jd-automation.v5.json n8n:/tmp/v5.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/v5.json
docker compose restart n8n
./scripts/export-workflows.sh
```
