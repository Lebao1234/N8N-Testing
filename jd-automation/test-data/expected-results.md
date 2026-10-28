# Kết quả mong đợi

Nội dung bài do AI viết nên mỗi lần chạy khác nhau; dưới đây là các điều kiện **phải** thỏa.

## JD 01 — đầy đủ thông tin (`jd-01-day-du.md`)

**Tab `JD`**
- Có 1 dòng mới, `status` đi theo `New` → `Processing` → `Done`.
- `poster_url` dạng `https://drive.google.com/file/d/<id>/view...`, mở ở cửa sổ ẩn danh vẫn xem được (đã share "Anyone with the link – Viewer").
- `warnings` rỗng hoặc chỉ có cảnh báo nhỏ (không có cảnh báo về lương/liên hệ).
- `error_message` rỗng.

**Kết quả phân tích (`JD Analyzer` → output)**
- `muc_luong_chuan_hoa` chứa "25 - 35 triệu" (không đổi số).
- `thong_tin_lien_he` chứa `tuyendung@saomai-tech.vn` và `0912 345 678`.
- `nganh_nghe` = "Công nghệ thông tin" → `Visual Style Selector` chọn phong cách "modern minimalist tech", palette navy/xanh.
- `diem_hap_dan` ≤ 3 ý.

**Tab `Posts`** — đúng 4 dòng cùng `jd_id`, `status = Draft`:

| platform | Điều kiện |
|---|---|
| LinkedIn | ≤ 3000 ký tự, có gạch đầu dòng Yêu cầu/Quyền lợi, 3-5 hashtag, có email hoặc SĐT |
| Threads | ≤ 500 ký tự kể cả hashtag, 0-2 hashtag, có email hoặc SĐT |
| Facebook Groups | Dòng đầu viết HOA có "TUYỂN", có emoji, nhắc liên hệ qua email/SĐT trong JD |
| Facebook Page | Giọng thương hiệu, CTA rõ, 3-5 hashtag |

- Không bài nào có con số tiền khác 25/35 (hoặc các số có trong JD như 10 triệu đào tạo).
- Bốn câu mở đầu khác nhau.

**Poster** (1024x1536): phần trên là hình minh họa, dải tối phía dưới có chữ tiếng Việt đúng dấu:
`CÔNG NGHỆ SAO MAI TUYỂN DỤNG` (bỏ tiền tố "Công ty Cổ phần/TNHH", tối đa 26 ký tự), vị trí, `Lương: 25 - 35 triệu VNĐ/tháng`, 3 gạch đầu dòng, `Liên hệ: ...`.

## JD 02 — thiếu lương và liên hệ (`jd-02-thieu-luong-lien-he.md`)

**Kết quả phân tích**
- `muc_luong_chuan_hoa` = "Không nêu".
- `thong_tin_lien_he` = "Không nêu" (chuỗi "Không có" không phải kênh liên hệ).
- `canh_bao_thieu_thong_tin` có ít nhất: thiếu mức lương, thiếu thông tin liên hệ.
- `nganh_nghe` = "F&B" → phong cách ấm áp (nâu/cam).

**Tab `JD`**
- `status` = `Done` (hoặc `Validation Failed` nếu AI vẫn vi phạm sau 1 lần viết lại — khi đó `error_message` nêu rõ lý do theo từng nền tảng).
- `warnings` chứa "JD không nêu mức lương" và cảnh báo về liên hệ.

**Tab `Posts`** (nếu Done)
- KHÔNG bài nào có con số lương (validator đánh trượt mọi cụm "lương … <số>" và số tiền không có trong JD).
- Không có email/SĐT bịa; bài mời "inbox/bình luận".

**Poster**: không có dòng lương; dòng liên hệ để trống.

## Kịch bản lỗi (Error Trigger)

1. Trong node `Config`, đổi `drive_folder_id` thành `sai-id-thu-muc` (hoặc tạm xoá credential OpenAI trên node `Generate Image`).
2. Gửi form với JD 01 (workflow phải đang **active**, dùng URL production).
3. Mong đợi: node `Upload to Drive` lỗi sau 3 lần thử → execution "Error" → nhánh `Error Trigger` chạy → dòng JD tương ứng có `status = Error`, `error_message` = "<thông điệp lỗi> | Node lỗi: Upload to Drive".
