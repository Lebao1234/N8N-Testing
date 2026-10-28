# Mẫu Google Sheets — bản gọn (v5)

Tạo một file Google Sheets có **2 tab**: `JD` và `Posts`. Dòng 1 là tiêu đề cột, viết chính xác như dưới (dán vào ô A1, các cột cách nhau bằng tab):

- `JD`: `jd_id	created_at	company	position	jd_detail	salary	contact	status	error_message	poster_url	warnings`
- `Posts`: `post_key	jd_id	platform	post_text	hashtags	poster_url	poster_file_id	status	error_message	created_at	retry_count	scheduled_at	published_at	platform_post_id	post_url	publish_log	approved_by`

## Tab `JD`

| Cột | Ý nghĩa |
|---|---|
| `jd_id` | `jd-<execution id>`, cũng là mã hiện trên trang cảm ơn của form |
| `status` | `Processing` → `Done` \| `Needs Review` \| `Error` |
| `error_message` | Lỗi kiểm duyệt từng bài, lỗi poster, hoặc lỗi workflow + tên node |
| `poster_url` | Link Drive của poster (private) |
| `warnings` | Cảnh báo thiếu thông tin (ví dụ "JD không nêu mức lương") |

## Tab `Posts` (mỗi JD 4 dòng, khoá `post_key = <jd_id>|<linkedin|threads|facebook_groups|facebook_page>`)

| Cột | Ai ghi | Ý nghĩa |
|---|---|---|
| `post_text`, `hashtags` | Workflow | Bài cuối cùng; người duyệt **được sửa** trước khi đổi sang Approved |
| `status` | Workflow / **người duyệt** | `Draft`/`Needs Review` → (người duyệt) `Approved` → `Published` \| `Failed` \| `Dry Run` \| `Manual - Waiting` → (đăng tay xong) `Manual - Confirmed` → `Published (manual)` |
| `scheduled_at` | Người duyệt (tuỳ chọn) | `yyyy-MM-dd HH:mm` giờ VN; trống = đăng ở lần quét kế tiếp |
| `approved_by` | Người duyệt (tuỳ chọn) | Để truy vết |
| `platform_post_id`, `post_url`, `published_at` | Workflow | Có `platform_post_id` thì không bao giờ đăng lại |
| `error_message` | Workflow | Lý do `Needs Review` hoặc lỗi đăng bài (đã che token) |
| `publish_log` | Workflow | Log DRY_RUN |
| `poster_url`, `poster_file_id`, `created_at`, `retry_count` | Workflow | |

Đăng lại một dòng `Failed` hoặc `Dry Run`: sửa nguyên nhân rồi đổi status về `Approved`.
