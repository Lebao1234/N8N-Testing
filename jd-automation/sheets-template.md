# Mẫu Google Sheets cho workflow `[dev] jd-tuyen-dung-da-nen-tang`

Tạo **một** file Google Sheets có 2 tab, tên tab đúng chính tả: `JD` và `Posts`.
Dòng 1 của mỗi tab là tiêu đề cột, viết **chính xác** như bảng dưới (chữ thường, có dấu gạch dưới).
Thứ tự cột không bắt buộc, nhưng nên giữ như dưới cho dễ đọc.

Copy nhanh dòng tiêu đề (dán vào ô A1, tab-separated):

- Tab `JD`:
  `jd_id	created_at	company	position	jd_detail	salary	contact	status	error_message	poster_url	warnings	execution_id`
- Tab `Posts`:
  `jd_id	platform	post_text	hashtags	poster_url	status	created_at`

## Tab `JD` — mỗi JD một dòng

| Cột | Ghi bởi node | Ý nghĩa |
|---|---|---|
| `jd_id` | Add JD Row | UUID sinh bởi node `Generate JD ID`; khoá để update dòng |
| `created_at` | Add JD Row | Thời điểm gửi form, `yyyy-MM-dd HH:mm:ss` giờ Việt Nam |
| `company` | Add JD Row | Tên Công Ty (form) |
| `position` | Add JD Row | Vị Trí (form) |
| `jd_detail` | Add JD Row | Chi Tiết JD (form) |
| `salary` | Add JD Row | Mức Lương (form, có thể trống) |
| `contact` | Add JD Row | Liên Hệ (form) |
| `status` | Add JD Row → Set Processing → Set Done / Set Validation Failed / Set Error | `New` → `Processing` → `Done` \| `Validation Failed` \| `Error` |
| `error_message` | Set Error / Set Validation Failed | Lý do lỗi (kèm tên node lỗi) hoặc danh sách lỗi kiểm duyệt theo từng nền tảng |
| `poster_url` | Set Done / Set Validation Failed | Link Google Drive công khai (`webViewLink`) của poster |
| `warnings` | Set Done / Set Validation Failed | Cảnh báo thiếu thông tin do AI phát hiện, ví dụ `JD không nêu mức lương` |
| `execution_id` | Add JD Row | `exec-<id>` của lần chạy n8n; nhánh lỗi dùng để tìm đúng dòng cần đánh dấu `Error` |

## Tab `Posts` — mỗi JD thành công tạo đúng 4 dòng

| Cột | Ý nghĩa |
|---|---|
| `jd_id` | Liên kết về tab `JD` |
| `platform` | `LinkedIn` \| `Threads` \| `Facebook Groups` \| `Facebook Page` |
| `post_text` | Nội dung bài cuối cùng (đã nối hashtag ở cuối) |
| `hashtags` | Danh sách hashtag cách nhau bởi dấu cách |
| `poster_url` | Link poster công khai (giống tab JD) |
| `status` | Luôn là `Draft` — người dùng tự duyệt rồi đăng |
| `created_at` | Thời điểm ghi, giờ Việt Nam |

## Lưu ý

- Định dạng cột `jd_detail` và `post_text` nên bật **Wrap text** để dễ đọc.
- Không đổi tên tab/cột sau khi đã chạy; nếu đổi phải sửa node Google Sheets tương ứng.
- Cột `execution_id` có tiền tố `exec-` để Sheets không tự đổi thành số (lọc theo chuỗi mới chính xác).
