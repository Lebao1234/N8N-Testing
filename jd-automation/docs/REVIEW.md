# Review workflow `[dev] jd-tuyen-dung-da-nen-tang` (jdAutoPostV20001)

> Ngày review: 2026-10-28 · Phạm vi: chỉ đọc, không sửa gì · Nguồn: `jd-automation/jd-automation.v2.json`, đã đối chiếu với bản trong DB n8n (giống nhau).
> Lưu ý minh bạch: workflow này do chính trợ lý AI dựng ở phiên trước, nên đọc review với tinh thần phản biện.

## Tóm tắt trong 10 dòng

1. **Chưa chạy được**: 9 node AI/ảnh (7 Claude model + 2 OpenAI) trỏ tới credential chưa tồn tại (`anthropicLocal01`, `openAiLocal00001`), 9 node Google chưa gán credential, `Config` còn `REPLACE_WITH_…`. Chưa từng có lần chạy thật nào.
2. **Lỗi lớn nhất về thiết kế**: lưu bài nằm **sau** bước poster. `Generate Image`, `Upload to Drive` hay `Share Anyone With Link` lỗi là cả job thành `Error`, 4 bài đã viết (đã tốn 5–6 lần gọi Claude) **không được lưu** vào Posts.
3. Nhánh `Set Validation Failed` cũng **không lưu bài**: người dùng chỉ thấy lý do, không có bài để sửa tay.
4. Luồng khó đọc chủ yếu vì **79 tham chiếu xa `$('…')` trong 25 node**: `Generate JD ID` bị đọc 16 lần, `JD Analyzer` 15, `Config` 15. Item `$json` gần như không mang dữ liệu nghiệp vụ qua các nhóm.
5. **Không idempotent**: gửi lại form tạo JD mới. `Append to Posts` dùng append và có retry 3 lần, có thể ghi trùng. Chưa có khoá `jd_id + platform`; Phần B (đăng bài) cần khoá này.
6. **Xử lý lỗi**: Error Workflow đã gán đúng (trỏ về chính nó), nhưng chỉ chạy với execution production. Retry 3 lần áp cho mọi lỗi, kể cả 400/401, nên gọi ảnh có thể tốn gấp 3. `spreadsheet_id` bị lặp ở `Config` và `Error Config`.
7. **Poster công khai "Anyone with link"** chứa email/SĐT. `poster_url` là link xem Drive, không phải ảnh trực tiếp, nên **không dùng được cho Threads** ở Phần B.
8. **Điểm mạnh**: prompt chống bịa tốt, mọi output LLM có schema + auto-fix, overlay chữ tiếng Việt đúng dấu, vòng rewrite có giới hạn (`Can Retry?`), không có secret trong JSON.
9. **Nên làm trước (an toàn, không đổi cấu trúc)**: (a) gắn credential + ID thật; (b) lưu bài ngay cả khi `Validation Failed`; (c) cho bước poster lỗi mềm (error output) để bài vẫn được lưu; (d) đổi `Append to Posts` sang upsert theo `post_key = jd_id|platform`.
10. **Làm sau (rủi ro cao)**: tách sub-workflow và đổi tên node theo quy ước `[Nhóm] Động từ…`. Làm trong bản **v3 mới**, giữ v2 chạy song song đến khi test xong.

Tài liệu kèm theo: [node-inventory.md](node-inventory.md) (bảng 50 node, số lần gọi API, data contract), [flow-current.mermaid](flow-current.mermaid) (chi tiết), [flow-current-overview.mermaid](flow-current-overview.mermaid) (tổng quan).

---

## A2. Chấm điểm (1 = kém, 5 = tốt)

| Tiêu chí | Điểm | Lý do và bằng chứng |
|---|---|---|
| Khả năng đọc | **3** | Tên node mô tả hành động, không còn tên mặc định, có 7 sticky theo nhóm + Overview. Nhưng luồng là một hàng dài khoảng 7.400px, có vòng ngược `Merge Rewritten Posts → Check Posts Quality`, node phụ đặt tên không đồng nhất (`Claude Chat Model`, `Image Prompt` so với `LinkedIn Model`), và `LinkedIn Model` (vị trí 1480,520) nằm ngoài mọi sticky. |
| Tính module | **2** | Ranh giới nhóm rõ về mặt hình ảnh, nhưng mọi nhóm sau nhóm 1 đều đọc xa `Generate JD ID`/`JD Analyzer`/`Config`, nên không tách nhóm nào ra được mà không viết lại expression. Nhóm 6 (poster) và nhóm 3 là ứng viên tách dễ nhất. |
| Data contract | **2** | Có `Config` tập trung (tốt) nhưng bị nhân bản ở `Error Config`. Chỉ `Check Posts Quality` tạo một object chuẩn; trước đó dữ liệu "trôi" qua tham chiếu xa: `Poster Content Selector` và `JD Analyzer` bỏ qua `$json`, `Share Anyone With Link` làm mất `webViewLink`. |
| Xử lý lỗi | **3** | `settings.errorWorkflow = jdAutoPostV20001` + `Error Trigger` → `Find Processing JD` lọc `execution_id` (chính xác). 18 node có Retry. Vòng rewrite có giới hạn (`attempt < 1`). Tuy vậy: không node nào có error output (ngoài `Read Logo File`), poster lỗi làm mất bài, retry không phân biệt mã lỗi, `Set Processing` lỗi thì dòng kẹt ở `New`. |
| Idempotency | **2** | `jd_id` xuyên suốt (sinh ở `Generate JD ID`, ghi ở cả JD và Posts). Nhưng không có chống gửi trùng form, `Append to Posts` không upsert, và không có khoá dòng Posts. |
| Bảo mật | **3** | Không có secret trong JSON (đã quét), credential tham chiếu theo id, form có Basic Auth. Trừ điểm vì: poster public kèm SĐT/email (`Share Anyone With Link`, type `anyone`); credential Basic Auth tên `Unnamed credential` cần kiểm tra đã đặt user/password chưa; form chạy qua http (chỉ chấp nhận được trên localhost). |
| Chi phí và hiệu năng | **3** | 6 lần gọi Claude + 1 ảnh cho mỗi JD là hợp lý. Nhưng 4 Writer chạy tuần tự (chủ ý để bài sau tránh lặp bài trước) nên thời gian khoảng gấp 4. Mọi node dùng `claude-sonnet-5-5`, kể cả việc nhẹ như Threads và Image Prompt. Phân tích JSON được gửi lại 6–10 lần ở dạng pretty-print. Ảnh `quality: high` có retry 3 lần. |
| Chất lượng prompt | **4** | Prompt tách file, quy tắc chống bịa rõ ("Không nêu", `canh_bao_thieu_thong_tin`), mỗi nền tảng có giọng và giới hạn riêng, `Check Posts Quality` kiểm tra hậu kiểm thực sự. Trừ điểm: schema `platform-post` không có `maxLength`/`maxItems`; prompt yêu cầu "≤ 60 ký tự" cho `diem_hap_dan` nhưng poster cắt còn 45. |
| Khả năng quan sát | **3** | Sheet có `status`, `error_message` (kèm tên node lỗi), `warnings`, `execution_id`. Nhưng `Processing` kéo dài suốt khoảng 90% thời gian chạy, không biết đang ở bước nào; không có link tới execution; bài lỗi validate không được lưu. |
| Khả năng kiểm thử | **2** | Có `test-data/` (2 JD + kết quả mong đợi). Nhưng không có pinData, không chạy riêng từng nhóm được (phụ thuộc tham chiếu xa), nhánh lỗi chỉ test được ở production, và script test logic Code node chỉ nằm trong thư mục tạm, không được đưa vào repo. |

**Điểm trung bình: 2,7 / 5**

---

## A3. Danh sách vấn đề (sắp theo mức độ)

| Mã | Mức | Node liên quan | Bằng chứng | Hậu quả | Cách sửa đề xuất | Công |
|---|---|---|---|---|---|---|
| A-01 | **Critical** | 7 node Claude model, `Generate Image`, `Generate Image With Logo`, 9 node Google, `Config`, `Error Config` | Credential `anthropicLocal01`, `openAiLocal00001` không có trong DB (chỉ có `CLtFsk0dNV90Z52V`). 9 node `googleSheets`/`googleDrive` không có `credentials`. `spreadsheet_id = REPLACE_WITH_SPREADSHEET_ID` | Workflow không chạy được bước nào sau `Config` | Điền key vào `.env` + import credential; tạo OAuth Google; điền ID thật | S |
| A-02 | **Critical** | `Generate Image`, `Generate Image With Logo`, `Upload to Drive`, `Share Anyone With Link` → `Check Posts Quality` → `Append to Posts` | Thứ tự: Writer → poster → validate → lưu. Không node poster nào có `onError` (chỉ `Read Logo File`) | Một lỗi ảnh/Drive (content policy, hết quota, sai folder) làm JD = `Error`, mất 4 bài đã viết, tốn 5–6 lần gọi Claude vô ích | Cho nhóm poster `onError: continueErrorOutput`, gộp lại với `poster_url` rỗng + `poster_error`; hoặc lưu bài (Draft) trước rồi mới tạo poster và cập nhật `poster_url` sau | M |
| A-03 | Major | `Set Validation Failed` | Chỉ update tab JD (`status`, `error_message`, `poster_url`, `warnings`); không có nhánh ghi Posts | Bài viết lại 2 lần vẫn lỗi thì mất hẳn; người duyệt không có gì để sửa tay | Thêm nhánh ghi 4 dòng Posts với `status = Needs Review` + lý do theo từng bài | S |
| A-04 | Major | `JD Input Form`, `Add JD Row`, `Append to Posts` | Không có kiểm tra trùng; `Append to Posts` dùng `operation: append` + `retryOnFail` 3 lần | Gửi lại form tạo JD và 4 bài mới; retry sau timeout có thể ghi trùng dòng Posts. Phần B dễ đăng trùng | Thêm cột `post_key = jd_id|platform`, dùng `appendOrUpdate` theo `post_key`; tuỳ chọn hash nội dung JD để cảnh báo gửi trùng | S–M |
| A-05 | Major | 25 node, xem "Ma trận tham chiếu xa" trong [node-inventory.md](node-inventory.md) | 79 tham chiếu `$('…')`; `Check Posts Quality` đọc xa 7 node; `Overlay Poster Text` 15 lần | Đổi tên/tách node là vỡ; khó đọc vì dữ liệu "nhảy cóc"; không test riêng nhóm được | Tại mỗi ranh giới, tạo 1 node "context" (Set) gom field cần thiết vào `$json` theo hợp đồng cố định (`job.{jd_id, form, config, analysis, posts, poster}`) | M |
| A-06 | Major | `Error Trigger`, `Find Processing JD` | Error Workflow chỉ chạy với execution production. `Find Processing JD` lọc `status = Processing` | Test thủ công không bao giờ đánh dấu Error. Nếu `Set Processing` lỗi, dòng kẹt ở `New` mãi | Tách `99-Error-Handler` riêng; lọc chỉ theo `execution_id` (bỏ điều kiện status); ghi thêm link execution | S |
| A-07 | Major | `Generate Image`, `Generate Image With Logo`, `Append to Posts`, mọi node có retry | `retryOnFail: true, maxTries: 3` cho mọi mã lỗi | Lỗi 400/401/content-policy vẫn gọi lại 3 lần (chi phí ảnh gấp 3); append có thể trùng | Ảnh: `maxTries 2` + error output. Ghi Sheet: dùng upsert (A-04). Phân loại 4xx thì không retry | S |
| A-08 | Major | `Share Anyone With Link`, `Check Posts Quality` | `permissionsUi: {role: reader, type: anyone}`; `poster_url = webViewLink` | Poster có SĐT/email công khai vĩnh viễn; `webViewLink` là trang HTML, Threads/LinkedIn không đọc được như ảnh | Bỏ share công khai mặc định; ở Phần B upload binary trực tiếp lên LinkedIn/Facebook, riêng Threads dùng nơi host ảnh có URL trực tiếp và có thời hạn | M |
| A-09 | Major | `Config`, `Error Config` | `spreadsheet_id` khai báo 2 nơi | Sửa một nơi quên nơi kia thì nhánh lỗi ghi sai file hoặc im lặng | Một nguồn cấu hình duy nhất (sub-workflow "Load Config" hoặc n8n Variables nếu bản quyền cho phép) | S |
| A-10 | Minor | `Check Posts Quality` | Regex placeholder `\[[^\]\n]{1,40}\]` | Bài hợp lệ có "[HN]", "[Tuyển gấp]" bị đánh trượt, gây rewrite thừa | Chỉ bắt placeholder rõ ràng: `{{…}}`, `[Tên…]`, `[Link…]`, `[Số…]`, `XXX` | S |
| A-11 | Minor | `Check Posts Quality` | `/lương[^\n]{0,25}\d/` khi JD không nêu lương; đơn vị `k\b` trong regex tiền | "lương tháng 13", "5k follower" bị coi là bịa lương | Bỏ qua khi số đứng sau "tháng"; bỏ đơn vị `k` hoặc yêu cầu ngữ cảnh lương | S |
| A-12 | Minor | `Poster Content Selector`, `JD Analysis Parser` | `poster_position.slice(0,40)`, highlight `.slice(0,45)` trong khi prompt cho phép 60 ký tự | Chữ trên poster có thể bị cắt giữa từ | Cắt theo ranh giới từ + "…", hoặc yêu cầu analyzer trả bản ngắn riêng cho poster | S |
| A-13 | Minor | 4 Writer, 7 model | Writer nối tiếp; mọi model `claude-sonnet-5-5`; `JSON.stringify(…, null, 2)` lặp lại | Chậm khoảng gấp 4 ở nhóm 4; chi phí token cao hơn cần thiết | Chạy song song 4 Writer (bỏ "bài trước", đặt cấu trúc khác nhau trong prompt); dùng model nhỏ hơn cho Threads/Image Prompt/auto-fix | M |
| A-14 | Minor | `Merge Rewritten Posts`, `LinkedIn Model`, node phụ | Vòng ngược; node ngoài sticky; tên node phụ không theo quy ước | Khó đọc, dễ hiểu nhầm luồng | Đổi bố cục (vòng rewrite nằm trong sub-workflow), đặt tên theo quy ước A4 | S |
| A-15 | Minor | Toàn workflow | Không có `pinData`; logic Code không có test trong repo | Phải chạy cả luồng (tốn API) để thử một nhóm | Thêm pinData mẫu cho `JD Input Form`; đưa script test Code node vào `jd-automation/tests/` | M |
| A-16 | Minor | `Set Processing`…`Set Done` | Chỉ có 5 trạng thái; không có link execution | Không biết job đang kẹt ở bước nào | Thêm cột `step` + `execution_url`, cập nhật ở đầu mỗi nhóm (tốn thêm 4–5 lần ghi Sheets) | S |
| A-17 | Minor | `Check Posts Quality` | Hashtag được nối vào `full_text` mà không loại trùng với hashtag có sẵn trong `post_text` | Bài có thể lặp hashtag | Loại hashtag đã xuất hiện trong `post_text` trước khi nối | S |
| A-18 | Minor | `JD Input Form` | `options: {}` → phản hồi mặc định ngay khi submit | Người gửi không nhận `jd_id` hay cách theo dõi | Trang hoàn tất hiển thị `jd_id` + hướng dẫn xem Sheet | S |
| A-19 | Minor | `JD Analyzer` | AI Agent không có tool | Thêm overhead agent, không có lợi ích | Có thể đổi sang Basic LLM Chain (yêu cầu ban đầu chỉ định Agent, nên giữ nếu muốn) | S |

---

## A4. Đề xuất cấu trúc lại (CHỈ ĐỀ XUẤT)

### Tách workflow

Item truyền giữa các workflow là một object `job` cố định, thay cho tham chiếu xa:

```text
job = { jd_id, execution_id, form{company, position, jd_detail, salary, contact},
        config{…}, analysis{15 field}, posts{linkedin, threads, facebook_groups, facebook_page},
        poster{url, file_id, direct_url, error}, validation{valid, errors, attempt} }
```

| Workflow | Đầu vào | Đầu ra | Thành phần (từ node hiện có) | Chuyển giao |
|---|---|---|---|---|
| **00-Main** (orchestrator) | Form | Ghi trạng thái cuối | `JD Input Form`, `Generate JD ID`, `Add JD Row`, `Set Processing`, 5 node *Execute Workflow*, `Set Done` / `Set Validation Failed` | Gọi 01 → 02 → 03 (lỗi mềm) → 04; vòng rewrite: 04 trả invalid và `attempt = 0` thì gọi 02 ở chế độ rewrite rồi gọi lại 04 |
| **01-Analyze** | `job.form` | `job.analysis` | `JD Analyzer` + model + parser | Execute Workflow Trigger (khai báo field) |
| **02-Write-Posts** | `job.form`, `job.analysis`, `feedback?` | `job.posts` | 4 Writer (+ `Rewrite Failed Post` khi có `feedback`) | Như trên |
| **03-Poster** | `job.form`, `job.analysis`, `job.config` | `job.poster` (có `error` thay vì throw) | Nhóm 5 + nhóm 6 | Main gọi với "continue on fail" |
| **04-Validate-Save** | `job` | `job.validation`; ghi Posts (upsert `post_key`) | `Check Posts Quality`, `Build Rows`, `Append to Posts` | Như trên |
| **05-Publish** (Phần B) | Dòng Posts `Approved` | Kết quả đăng | Mới | Google Sheets Trigger / Manual |
| **99-Error-Handler** | Error Trigger | Dòng JD = `Error` | `Error Trigger`, `Find Processing JD`, `Set Error` | Đặt làm `errorWorkflow` cho 00–05 |

`Config` chỉ nằm ở một nơi (00-Main truyền vào `job.config`; 99 đọc từ cùng một nguồn).

### Quy ước đặt tên

- Node chính: `[Nhóm] Động từ + đối tượng`, ví dụ `[Prepare] Receive JD form`, `[Analyze] Analyze JD`, `[Write] Generate LinkedIn post`, `[Poster] Overlay Vietnamese text`, `[Save] Upsert post rows`.
- Node phụ: `[Write] Model · LinkedIn`, `[Write] Parser · LinkedIn`.
- Mỗi nhóm/workflow có sticky ghi 3 mục: **Input** / **Output** / **Lỗi thường gặp**.
- ⚠ Xung đột với yêu cầu trước ("giữ nguyên tên node"). Đổi tên sẽ phải viết lại 79 tham chiếu xa; chỉ nên làm cùng lúc với việc tách sub-workflow.

### Thứ tự thay đổi đề xuất

| # | Thay đổi | Giải quyết | Rủi ro phá luồng |
|---|---|---|---|
| 1 | Gắn credential, điền `spreadsheet_id`/`drive_folder_id`, đặt user/password Basic Auth | A-01 | **An toàn** (chỉ cấu hình) |
| 2 | Lưu bài với `status = Needs Review` ở nhánh `Set Validation Failed` | A-03 | **An toàn** (chỉ thêm node ở nhánh false) |
| 3 | Sửa regex trong `Check Posts Quality` + cắt chữ theo từ + loại hashtag trùng | A-10, A-11, A-12, A-17 | **An toàn** (logic cục bộ, có test được) |
| 4 | Chính sách retry: ảnh `maxTries 2`, bỏ retry ở node append | A-07 | **An toàn** |
| 5 | Poster lỗi mềm (error output → `poster_error`) | A-02 | **Rủi ro thấp**: đổi nguồn `poster_url` trong `Check Posts Quality` |
| 6 | Cột `post_key` + upsert; cột `step`, `execution_url` | A-04, A-16 | **Rủi ro trung bình**: phải thêm cột vào Sheet thật; dòng cũ không có `post_key` |
| 7 | `99-Error-Handler` riêng, lọc theo `execution_id`, cấu hình một nguồn | A-06, A-09 | **Rủi ro trung bình**: đổi `settings.errorWorkflow` |
| 8 | Bỏ share "Anyone with link", đổi cách lấy ảnh cho Phần B | A-08 | **Rủi ro trung bình**: ảnh hưởng Phần B |
| 9 | Tách 00–04 + đổi tên node + chạy Writer song song | A-05, A-13, A-14, A-15 | **Rủi ro cao**: viết lại toàn bộ expression; làm ở bản v3 với id mới, giữ v2 đến khi test end-to-end đạt |
