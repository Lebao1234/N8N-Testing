# Kịch bản kiểm thử luồng đăng bài

Bài mẫu cho 4 nền tảng: [publish-sample-posts.json](publish-sample-posts.json) (jd_id `sample-0001`). Muốn test với Sheet thật thì dán 4 dòng này vào tab `Posts`.

## (a) DRY_RUN (bản v5: đặt `dry_run = true` trong `[0] Config`, duyệt dòng sang Approved, chờ lần quét 5 phút)

```bash
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=jdAutoPostV20001
```

Kết quả thực tế: execution `success`, 4/4 dòng `Dry Run`:
- **LinkedIn**: `POST https://api.linkedin.com/rest/posts (Linkedin-Version 202604 …)` + nội dung 503 ký tự.
- **Threads**: `POST https://graph.threads.com/v1.0/me/threads (media_type=TEXT)` → chờ 30s → `threads_publish`; 199 ký tự (emoji tính theo byte).
- **Facebook Page**: `POST https://graph.facebook.com/v25.0/<page>/feed`.
- **Facebook Groups**: "KHÔNG gọi API" → hướng dẫn đăng tay.

Không có lời gọi API đăng thật nào. Với Sheet thật: đặt 4 dòng `Approved` → chạy khung **6 · Đăng bài** (Run manually với `manual_mode = publish`, hoặc chờ lịch 5 phút khi workflow active) → các dòng thành `Dry Run`, `publish_log` có log như trên.

## (b) Đăng thật 1 bài mỗi nền tảng (tài khoản/Page test)

Điều kiện: đã làm README-publish mục 3; `dry_run = false`; chỉ bật một nền tảng mỗi lần.

| Bước | Mong đợi |
|---|---|
| Đổi `sample-0001\|linkedin` → `Approved`, gọi webhook `{"post_key":"sample-0001\|linkedin"}` | `Published`, `platform_post_id = urn:li:share:…`, `post_url` mở được |
| Tương tự `\|threads` | `Published`, có `permalink` |
| Tương tự `\|facebook_page` | `Published`, `post_url = https://www.facebook.com/<pageid_postid>` |
| `\|facebook_groups` | `Manual - Waiting` + tin Telegram; đổi `Manual - Confirmed` → lần chạy sau `Published (manual)` |
| Sau khi đủ 4 | Tab JD: `sample-0001` = `Published` (nếu thiếu 1 = `Partially Published`) |

## (c) Cố ý làm hỏng token

1. Sửa credential `Threads access token`, thêm ký tự `x` vào cuối token.
2. Đặt dòng Threads `Approved`, chạy khung 6 · Đăng bài (`manual_mode = publish`).
3. Mong đợi: dòng Threads `Failed`, `error_message` bắt đầu bằng `HTTP 401` (hoặc 400 OAuthException) + "Token hết hạn hoặc thiếu quyền… Không thử lại", **không** có token trong thông báo; Telegram nhận ❌. Các dòng LinkedIn/Facebook cùng lượt vẫn đăng bình thường (lỗi một nền tảng không chặn nền tảng khác).
4. Khôi phục token.

## (d) Chạy lại cùng dòng — không đăng trùng

1. Sau (b), dòng LinkedIn đã `Published` và có `platform_post_id`.
2. Đổi lại `Approved` (giả lập bấm nhầm) → chạy khung 6 · Đăng bài (`manual_mode = publish`).
3. Mong đợi: route `already_posted` → status `Published`, `publish_log` = "Bỏ qua: dòng đã có platform_post_id (chống đăng trùng)". Không có bài mới trên LinkedIn.
4. Gọi webhook 2 lần cách nhau vài giây với cùng `post_key`: lần 1 claim `Publishing`; lần 2 không thấy dòng `Approved` nên không làm gì. (Claim không phải khoá nguyên tử: hai lần gọi trong cùng một giây vẫn có thể cùng đọc thấy `Approved`. Vì vậy chỉ dùng webhook để test tay.)

## (e) Không đăng bài chưa duyệt

Để dòng ở `Draft`/`Needs Review`, chạy khung 6 · Đăng bài (`manual_mode = publish`) → `Pick due posts` trả 0 item → workflow dừng, không có thay đổi.
