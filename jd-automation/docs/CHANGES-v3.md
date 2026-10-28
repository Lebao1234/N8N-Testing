# Thay đổi v2 → v3 (áp dụng đề xuất trong REVIEW.md)

- Ngày thực hiện: 2026-10-28.
- Bản v2 `[dev] jd-tuyen-dung-da-nen-tang` (`jdAutoPostV20001`) và file `jd-automation.v2.json` **giữ nguyên**.
- Bản v3 nằm ở `jd-automation/v3/workflows/`, sinh bởi `v3/build-v3.mjs`.

## Đề xuất → nơi đã sửa

| # (A4) | Vấn đề | Đã làm | Node / workflow |
|---|---|---|---|
| 1 | A-01 credential/ID | **Không tự làm được** (cần key/OAuth của bạn). Mọi ID gom về 1 chỗ; hướng dẫn trong README-publish mục 3 | `[Config] Return config` |
| 2 | A-03 Validation Failed mất bài | Luôn upsert 4 bài: đạt → `Draft`, lỗi → `Needs Review` + lý do; JD → `Needs Review` | `[Validate] Build post rows`, `[Validate] Upsert post rows`, `[Main] Set JD result` |
| 3 | A-10, A-11, A-12, A-17 | Regex placeholder chỉ bắt mẫu rõ ràng; bỏ "lương tháng 13" và đơn vị `k`; cắt chữ poster theo từ + "…"; loại hashtag trùng. Đã test bằng dữ liệu giả | `[Validate] Check posts quality`, `[Poster] Select content` |
| 4 | A-07 retry mù | LLM/ảnh/Drive/Sheets: `maxTries 2`. Ghi Posts là upsert (retry không tạo trùng). Đăng bài: không dùng retry của n8n; tự phân loại 429/5xx (hẹn lại) và 401/403 (dừng) | toàn bộ v3, `[One] Classify API error` |
| 5 | A-02 poster lỗi làm mất bài | Mọi node ảnh/overlay/Drive dùng error output → `Return job without poster`; bài vẫn được lưu, lỗi ghi vào `error_message` của JD | `jd-03-poster` |
| 6 | A-04, A-16 idempotency, quan sát | `post_key = jd_id\|platform` + `appendOrUpdate`; `content_hash` chặn gửi trùng form (`Duplicate`); cột `step`, `execution_url` | `[Prepare] Hash JD content`, `[Prepare] Is duplicate?`, `[Main] Mark step …` |
| 7 | A-06, A-09 xử lý lỗi, cấu hình | `jd-99-error-handler` dùng chung; lọc JD **chỉ theo `execution_id`**; xử lý cả Posts `Publishing`; che token; cấu hình một nguồn `jd-config` | `jd-99-error-handler`, `jd-config` |
| 8 | A-08 poster công khai | Mặc định `poster_share_mode = private`; LinkedIn/Facebook tải file trực tiếp; Threads chọn `text_only`/`drive_public`/`url_template` | `[Poster] Share publicly?`, `[One] Download poster`, `[One] Threads image URL` |
| 9 | A-05, A-13, A-14, A-15, A-19 cấu trúc | Tách 00–04; object `job` làm hợp đồng dữ liệu; tên `[Nhóm] Động từ…`; sticky Input/Output/Lỗi; 4 bài **song song** (`batchSize 4`), 1 chain thay 4 chain + chain rewrite; Haiku cho prompt ảnh và sửa JSON; Agent → Basic LLM Chain; bỏ vòng nối ngược; workflow test DRY_RUN | `jd-00…04`, `[Write] Generate post` |
| — | A-18 form | Trang cảm ơn hiển thị mã `exec-<id>` để tra trong tab JD | `[Prepare] Receive JD form` |

## Số liệu sau khi tách

| | v2 | v3 (tạo bài) |
|---|---|---|
| Số workflow | 1 | 7 (main, config, 01–04, error) |
| Node chức năng | 50 | 25 + 3 + 7 + 8 + 19 + 6 + 11 (không tính sticky) |
| Tham chiếu xa `$('…')` | 79, qua 25 node | Mỗi workflow chỉ đọc xa trigger hoặc 1 node ngữ cảnh. Còn lại: `[Prepare] Build job`/`Find same JD` trong Main, `Select visual style`/`Upload to Drive` trong Poster |
| Lần gọi Claude/JD | 6 (tuần tự) | 6 (4 bài song song; prompt ảnh dùng Haiku) |

## Không đổi

- Prompt trong `prompts/`, schema trong `schemas/`, logic overlay chữ tiếng Việt, ID credential (`CLtFsk0dNV90Z52V`, `anthropicLocal01`, `openAiLocal00001`).
- docker-compose: không cần thay đổi cho v3 và luồng đăng bài (gọi API ra ngoài, không cần webhook công khai).

## Đã kích hoạt (publish) trong n8n — ĐÃ GỠ ở v4 (xem bên dưới)

`jd-config`, `jd-01…04`, `jd-05a-publish-one`, `jd-99-error-handler`. Đây là các workflow không có trigger bên ngoài; n8n 2.x bắt buộc publish sub-workflow mới gọi được. **Chưa bật** `jd-00-main`, `jd-05-publish`, `jd-06-token-health`, nên bạn tự bật sau khi cấu hình và test.

---

# v4 (2026-10-28) — gộp lại thành MỘT workflow theo yêu cầu

- Toàn bộ v3 (tạo bài 00–04, đăng bài 05/05a, token 06, error 99, config, test) gộp vào **`[dev] jd-tuyen-dung-da-nen-tang`** (`jdAutoPostV20001`), file `jd-automation.v4.json`, sinh bởi `build-single.mjs`.
- Mỗi giai đoạn là một **khung sticky** đánh số `0 Setup … 8 Error`; tên node có tiền tố khung (`[3 Write] …`). Kích thước khung tự tính theo node bên trong.
- 6 trigger dùng chung **một** node `[0 Setup] Config`; `[0 Setup] Route by entry` rẽ nhánh theo nguồn chạy. Nút chạy tay chọn việc bằng `manual_mode` (`test_dry_run` | `publish` | `token`).
- Viết lại bài (5b) dựng thẳng hàng, không có cạnh nối ngược. Bước kiểm tra lại dùng cùng mã với bước 5.
- Error Workflow trỏ về chính nó (khung 8).
- Giữ nguyên mọi cải tiến của v3: `job` object, upsert `post_key`, chống trùng `content_hash`, poster lỗi mềm/private, viết song song, phân loại lỗi đăng bài, DRY_RUN.
- Trong n8n: 11 workflow v3 đã **unpublish + Archived** (khôi phục được trong UI). Bản v2 trước khi ghi đè được backup ở `backup/jdAutoPostV20001.v2-before-v4-2026-10-28.json`. Thư mục `v3/` chuyển vào `archive/v3/`.
- Kiểm chứng: validator n8n-mcp 0 lỗi (127 node, 157 connection); `n8n execute --id=jdAutoPostV20001` (test_dry_run) → 4/4 `Dry Run`, không node Google Sheets nào chạy.

---

# v5 (2026-10-28) — bản gọn theo phương án B

- Cùng workflow `[dev] jd-tuyen-dung-da-nen-tang` (`jdAutoPostV20001`), file `jd-automation.v5.json`, sinh bởi `build-lean.mjs`: **24 node chính + 2 node AI** (v4: 127).
- Phân tích JD + 4 bài + prompt poster gộp vào **1 lần gọi Claude** (prompt/schema gộp được sinh từ các file gốc).
- Đăng bài không cần vòng lặp: `[4] Prepare Posts` quyết định nhánh cho từng dòng, mỗi nền tảng 1 node đăng, `[4] Save Result` ghi kết quả bằng biểu thức.
- Lược bỏ: chống gửi trùng form, viết lại tự động, logo, claim Publishing, thử lại 429/5xx, token health, Telegram, trạng thái JD Published, ảnh trên Threads (xem README-publish mục 4).
- Kiểm chứng: validator 0 lỗi (26 node, 34 connection); Code node `[3] Check & Build Rows` và `[4] Prepare Posts` chạy thử với dữ liệu giả trong container (Luxon thật): bắt lương bịa, poster lỗi vẫn lưu bài, giãn cách theo nền tảng, emoji Threads tính theo byte, không đăng lại dòng có `platform_post_id`. **Chưa chạy end-to-end** (thiếu credential Google/AI).
- Bản v4 đầy đủ được backup ở `backup/jdAutoPostV20001.v4-before-v5-2026-10-28.json`.
