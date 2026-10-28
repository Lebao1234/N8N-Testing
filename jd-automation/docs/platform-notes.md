# Ghi chú nền tảng đăng bài (B0)

> Ngày tra cứu: **2026-10-28**. Nguồn là tài liệu chính thức, link ở cuối mỗi mục. API thay đổi thường xuyên, nên kiểm tra lại trước khi bật đăng thật.
> Chỗ nào **khác với giả định trong yêu cầu** được đánh dấu ⚠.

## LinkedIn (Posts API + Images API)

| Hạng mục | Giá trị |
|---|---|
| Endpoint đăng | `POST https://api.linkedin.com/rest/posts`, trả `201` kèm ID bài ở header `x-restli-id` (`urn:li:share:…` hoặc `urn:li:ugcPost:…`) |
| Header bắt buộc | `Linkedin-Version: YYYYMM`, `X-Restli-Protocol-Version: 2.0.0` |
| Phiên bản | Tài liệu đang ở `li-lms-2026-10`. ⚠ Bản **202511 ngừng hỗ trợ ngày 2026-11-16**. Node LinkedIn của n8n 2.45.4 gửi `LinkedIn-Version: 202604` (đã kiểm tra trong mã nguồn container) |
| Đính ảnh | `POST /rest/images?action=initializeUpload` với `owner` = URN người/tổ chức → nhận `uploadUrl` + `urn:li:image:…` → `PUT` file lên `uploadUrl` → đặt vào `content.media.id`. Định dạng JPG/GIF/PNG, dưới 36.152.320 pixel. Node LinkedIn của n8n tự làm cả 3 bước |
| Quyền | Bài cá nhân: `w_member_social` (sản phẩm "Share on LinkedIn", tự cấp). Trang công ty: `w_organization_social` (sản phẩm Community Management API, **phải xin duyệt**) + vai trò ADMINISTRATOR/CONTENT_ADMIN trên trang |
| Giới hạn ký tự | Tài liệu Posts API không ghi con số; lỗi `FIELD_LENGTH_TOO_LONG` khi quá dài. Workflow giữ ngưỡng **3000** như yêu cầu |
| Token | OAuth 2.0, token truy cập khoảng 60 ngày; refresh token theo chương trình chỉ có với một số đối tác được duyệt. Thực tế phải đăng nhập lại credential trong n8n trước khi hết hạn (workflow `jd-06-token-health` cảnh báo trước) |
| Lỗi | 401 thiếu/hết hạn token · 403 thiếu quyền · 429 vượt rate limit · 5xx thử lại |
| Link bài | `https://www.linkedin.com/feed/update/<urn>/` |

Nguồn: [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api).

## Threads (Threads API)

| Hạng mục | Giá trị |
|---|---|
| Host | ⚠ `https://graph.threads.com/v1.0` (tài liệu hiện tại dùng `.com`; nhiều hướng dẫn cũ ghi `graph.threads.net`) |
| Bước 1 | `POST /{threads-user-id}/threads` với `media_type=TEXT\|IMAGE\|VIDEO`, `text`, `image_url` (bắt buộc khi IMAGE) → nhận container `id` |
| Bước 2 | Chờ **trung bình 30 giây** cho container xử lý xong |
| Bước 3 | `POST /{threads-user-id}/threads_publish?creation_id=<id>` → nhận media `id`; lấy link bằng `GET /{media-id}?fields=permalink` |
| Giới hạn ký tự | **500**; ⚠ emoji được tính theo **số byte UTF-8** (workflow đã tính đúng cách này ở `[One] Precheck`) |
| Ảnh | Phải là **URL công khai** để Threads tự tải về. JPEG/PNG, tối đa 8 MB, rộng 320–1440px, tỉ lệ tối đa 10:1. Poster 1024x1536 hợp lệ |
| Rate limit | 250 bài/24 giờ cho mỗi profile |
| Quyền | `threads_basic` + `threads_content_publish`. Chưa có Advanced Access thì chỉ đăng được cho tài khoản **Threads tester** của app |
| Token | Đổi sang long-lived token (`GET /access_token?grant_type=th_exchange_token`), **hạn 60 ngày**. Làm mới bằng `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=…` khi token **đã ít nhất 24 giờ tuổi và chưa hết hạn**; mỗi lần làm mới tính lại 60 ngày. Tài liệu không nói token mới có đổi giá trị không, nên workflow luôn ghi đè credential bằng giá trị trả về |

**Link ảnh từ Drive:** `webViewLink` là trang HTML, Threads **không** dùng được. Link `https://drive.google.com/uc?export=download&id=…` chỉ hoạt động khi file được share công khai, và Google có thể chèn trang cảnh báo hoặc giới hạn lượt tải. Vì vậy không bảo đảm chạy ổn định. Workflow có 3 chế độ (`threads_image_mode`):
- `text_only` (mặc định, an toàn): đăng chữ, không ảnh.
- `drive_public`: share poster "Anyone with link" ngay lúc đăng, rồi dùng link `uc?export=download`. Dễ nhất nhưng làm poster công khai và có thể lỗi.
- `url_template`: tự host ảnh (ví dụ bucket R2/S3 công khai hoặc CDN), điền mẫu `https://cdn.example.com/posters/{file_id}.png`. **Khuyến nghị** nếu cần ảnh trên Threads.

Nguồn: [Threads posts](https://developers.facebook.com/docs/threads/posts), [Long-lived tokens](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens).

## Facebook Page (Graph API)

| Hạng mục | Giá trị |
|---|---|
| Phiên bản | Tài liệu hiện tại ví dụ **v26.0**. Node Facebook Graph của n8n 2.45.4 liệt kê đến v25.0; workflow gọi qua HTTP Request với `facebook_graph_version = v25.0` (vẫn được hỗ trợ), đổi trong `jd-config` khi cần |
| Đăng ảnh | `POST /{page-id}/photos`: `source` (multipart, file) hoặc `url`, `caption` (⚠ `message` đã deprecated cho photos), `published=true` → trả `{id, post_id}` |
| Đăng chữ | `POST /{page-id}/feed` với `message` |
| Quyền | `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`; người cấp quyền phải làm được tác vụ `CREATE_CONTENT` trên Page |
| Token | **Page access token**. Lấy từ long-lived user token qua `GET /me/accounts`, khi đó Page token không có ngày hết hạn (vẫn mất hiệu lực nếu đổi mật khẩu, gỡ quyền hoặc rời vai trò admin) |
| Chế độ app | App ở **Development**: chỉ người có vai trò trong app (admin/developer/tester) đăng được lên Page họ quản lý. Muốn **Live** cho người khác dùng: cần **App Review** cho `pages_manage_posts` + xác minh doanh nghiệp |
| Link bài | `https://www.facebook.com/<post_id>` |

Nguồn: [Page Photos reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/).

## Facebook Groups — KHÔNG có API

- Meta thông báo ngừng Groups API trong Graph API v19.0 (23/01/2024), **gỡ khỏi mọi phiên bản từ 22/04/2024**, gồm cả quyền `publish_to_groups`.
- Workflow **không** gọi API nào cho Groups. Bài vào trạng thái `Manual - Waiting` và được gửi (nếu bật Telegram) cho người phụ trách đăng tay. Người đó đổi status thành `Manual - Confirmed` thì hệ thống ghi `Published (manual)`.
- Không dùng browser automation, scraping hay tài khoản cá nhân để tự đăng.

Nguồn: [Graph API v19.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/), [Thông báo v19](https://developers.facebook.com/blog/post/2024/01/23/introducing-facebook-graph-and-marketing-api-v19/).

## Tóm tắt khác biệt so với giả định ban đầu

1. Host Threads là `graph.threads.com`, không phải `graph.threads.net`.
2. Threads tính emoji theo byte UTF-8 khi đếm giới hạn 500.
3. LinkedIn 202511 sắp ngừng (16/11/2026); node n8n đang dùng 202604 nên không bị ảnh hưởng.
4. Facebook photos dùng `caption`, không dùng `message`.
5. Graph API mới nhất v26.0, nhưng node n8n chỉ có đến v25.0 nên workflow dùng HTTP Request với version cấu hình được.
