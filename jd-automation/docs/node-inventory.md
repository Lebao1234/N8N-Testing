# Kiểm kê node — `[dev] jd-tuyen-dung-da-nen-tang`

- Workflow id: `jdAutoPostV20001` — nguồn: `jd-automation/jd-automation.v2.json`. Đã đối chiếu bản trong DB n8n (export ngày 2026-10-28): cùng node, connection và settings. Khác biệt duy nhất là n8n bỏ đi các tham số có giá trị mặc định khi lưu, không có chỉnh sửa nào từ UI.
- `settings.errorWorkflow = jdAutoPostV20001` (trỏ về chính nó), `executionOrder = v1`, `timezone = Asia/Ho_Chi_Minh`. Workflow **chưa active**.
- Lưu ý tên gọi: tên thật trong n8n là `[dev] jd-tuyen-dung-da-nen-tang` (không phải "JD -> tài đăng đa nền tảng"). Node viết lại tên là `Rewrite Failed Post` (không phải "Rewrite Posts").

## 1. Số lượng

| Hạng mục | Số |
|---|---|
| Tổng node trong JSON | **58** |
| Sticky note | 8 (Overview + 7 nhóm) |
| Node chức năng | **50** |
| Trong đó node phụ AI (model + parser) | 14 (7 Claude model + 7 Structured Output Parser) |
| Trigger | 2 (`JD Input Form`, `Error Trigger`) |
| Code node | 5 (`Attach Logo`, `Check Posts Quality`, `Build Rows`, `Prepare Rewrite`, `Merge Rewritten Posts`) |
| Node có Retry On Fail | 18 (đều 3 lần, cách 5s) |
| Node có Continue On Fail / error output | 1 (`Read Logo File` = continueRegularOutput) |
| Connection | 58, gồm 1 cạnh vòng ngược `Merge Rewritten Posts → Check Posts Quality` |

| Nhóm | Node chính | Node phụ | Tổng |
|---|---|---|---|
| 1 Prepare job description | 5 | 0 | 5 |
| 2 Flag failed job | 4 | 0 | 4 |
| 3 Analyze job description | 1 | 2 | 3 |
| 4 Write platform posts | 4 | 8 | 12 |
| 5 Plan poster | 3 | 2 | 5 |
| 6 Create poster | 9 | 0 | 9 |
| 7 Validate and save | 10 | 2 | 12 |
| **Cộng** | **36** | **14** | **50** |

> Nhóm 1 đã gồm `JD Input Form`, nhóm 2 đã gồm `Error Trigger`.

## 2. Số lần gọi ra ngoài cho 1 JD

| Loại gọi | Chạy bình thường (pass ngay) | Có rewrite, k bài lỗi (1 ≤ k ≤ 4), rồi pass | Có rewrite, vẫn fail |
|---|---|---|---|
| Claude (LLM) | **6**: `JD Analyzer` 1¹ + 4 Writer + `Image Prompt Builder` 1 | **6 + k** (`Rewrite Failed Post` × k) | 6 + k |
| Claude auto-fix parser² | 0 (chỉ khi JSON hỏng: tối đa +1 mỗi chain) | 0..(6 + k) | 0..(6 + k) |
| OpenAI Images | 1 (`Generate Image` hoặc `Generate Image With Logo`) | 1 | 1 |
| Google Sheets | 4: `Add JD Row`, `Set Processing`, `Append to Posts`, `Set Done` | 4 | 3: `Add JD Row`, `Set Processing`, `Set Validation Failed` |
| Google Drive | 2: `Upload to Drive`, `Share Anyone With Link` | 2 | 2 |
| **Tổng gọi API ngoài** | **13** | **13 + k** (tối đa 17) | **12 + k** (tối đa 16) |
| Nhánh lỗi (nếu xảy ra) | +2 Sheets (`Find Processing JD`, `Set Error`) | | |

¹ AI Agent không có tool, thường 1 lượt gọi model.
² Auto-fix của Structured Output Parser gọi lại cùng model khi parse thất bại.
Trường hợp xấu nhất: mọi node gọi API đều có `maxTries: 3`, nên số lần gọi có thể nhân tối đa 3 (kể cả với lỗi không thể retry như 400/401).

## 3. Bảng node

Cột "Lỗi" = hành vi khi node lỗi (`stop` = dừng cả execution và kích hoạt Error Workflow).

| # | Tên node | Loại | Nhóm | Đầu vào chính | Đầu ra chính | Credential | Retry | Lỗi |
|---|---|---|---|---|---|---|---|---|
| 1 | JD Input Form | `formTrigger` v2.6 | 1 Prepare | Người dùng submit form | 5 field form: `Tên Công Ty`, `Vị Trí`, `Chi Tiết JD`, `Mức Lương`, `Liên Hệ` (+`submittedAt`) | httpBasicAuth (`CLtFsk0dNV90Z52V`) | — | stop |
| 2 | Config | `set` v3.4 | 1 Prepare | Item form | Form + 6 field cấu hình (`spreadsheet_id`, `drive_folder_id`, `logo_path`, `enable_text_overlay`, `image_model`, `overlay_font`) | — | — | stop |
| 3 | Generate JD ID | `crypto` v2 | 1 Prepare | Item Config | Thêm `jd_id` (uuid v4) | — | — | stop |
| 4 | Add JD Row | `googleSheets` v4.7 | 1 Prepare | Form + `jd_id` | Dòng tab JD (đổi tên: `company`, `position`…, status `New`, `execution_id`) | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |
| 5 | Set Processing | `googleSheets` v4.7 | 1 Prepare | `jd_id` (tham chiếu xa) | Dòng JD sau update (status `Processing`) | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |
| 6 | Error Trigger | `errorTrigger` v1 | 2 Flag failed | Execution lỗi (production) | `execution.{id,error,lastNodeExecuted}`, `workflow` | — | — | stop |
| 7 | Error Config | `set` v3.4 | 2 Flag failed | Item Error Trigger | + `spreadsheet_id` (bản sao thứ 2) | — | — | stop |
| 8 | Find Processing JD | `googleSheets` v4.7 | 2 Flag failed | `status=Processing` AND `execution_id=exec-<id>` | 0..n dòng JD | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |
| 9 | Set Error | `googleSheets` v4.7 | 2 Flag failed | Dòng JD | status `Error`, `error_message` = lỗi + node lỗi | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |
| 10 | JD Analyzer | `lc.agent` v3.1 | 3 Analyze | Bỏ qua `$json`; đọc 5 field form qua `$('Generate JD ID')` | `output` = 15 field (schema jd-analysis) | — | 3× / 5s | stop |
| 11 | Claude Chat Model | `lc.lmChatAnthropic` v1.6 | 3 Analyze (sub) | — | ai_languageModel → JD Analyzer + JD Analysis Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 12 | JD Analysis Parser | `lc.outputParserStructured` v1.3 | 3 Analyze (sub) | Text LLM | JSON theo `jd-analysis.schema.json`, auto-fix | — | — | stop |
| 13 | LinkedIn Writer | `lc.chainLlm` v1.9 | 4 Write | Phân tích + tên công ty (tham chiếu xa) | `output` = {post_text, hashtags[], cta} | — | 3× / 5s | stop |
| 14 | LinkedIn Model | `lc.lmChatAnthropic` v1.6 | 4 Write (sub) | — | ai_languageModel → LinkedIn Writer + LinkedIn Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 15 | LinkedIn Parser | `lc.outputParserStructured` v1.3 | 4 Write (sub) | Text LLM | JSON theo `platform-post.schema.json`, auto-fix | — | — | stop |
| 16 | Threads Writer | `lc.chainLlm` v1.9 | 4 Write | Như trên + 400 ký tự đầu bài LinkedIn | `output` (thay toàn bộ item) | — | 3× / 5s | stop |
| 17 | Threads Model | `lc.lmChatAnthropic` v1.6 | 4 Write (sub) | — | ai_languageModel → Threads Writer + Threads Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 18 | Threads Parser | `lc.outputParserStructured` v1.3 | 4 Write (sub) | Text LLM | JSON theo `platform-post.schema.json`, auto-fix | — | — | stop |
| 19 | Facebook Groups Writer | `lc.chainLlm` v1.9 | 4 Write | Như trên + LinkedIn, Threads | `output` | — | 3× / 5s | stop |
| 20 | Facebook Groups Model | `lc.lmChatAnthropic` v1.6 | 4 Write (sub) | — | ai_languageModel → Facebook Groups Writer + Facebook Groups Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 21 | Facebook Groups Parser | `lc.outputParserStructured` v1.3 | 4 Write (sub) | Text LLM | JSON theo `platform-post.schema.json`, auto-fix | — | — | stop |
| 22 | Facebook Page Writer | `lc.chainLlm` v1.9 | 4 Write | Như trên + 3 bài trước | `output` | — | 3× / 5s | stop |
| 23 | Facebook Page Model | `lc.lmChatAnthropic` v1.6 | 4 Write (sub) | — | ai_languageModel → Facebook Page Writer + Facebook Page Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 24 | Facebook Page Parser | `lc.outputParserStructured` v1.3 | 4 Write (sub) | Text LLM | JSON theo `platform-post.schema.json`, auto-fix | — | — | stop |
| 25 | Poster Content Selector | `set` v3.4 | 5 Plan poster | Bỏ qua `$json` (bài FB Page); đọc Analyzer + form | `jd_id`, `poster_position|company|salary|highlights|contact` (bỏ field cũ) | — | — | stop |
| 26 | Visual Style Selector | `set` v3.4 | 5 Plan poster | Item poster_* | + `industry`, `visual{style,palette,panel,accent}` | — | — | stop |
| 27 | Image Prompt Builder | `lc.chainLlm` v1.9 | 5 Plan poster | industry, poster_position, visual + kỹ năng (xa) | `output` = {image_prompt, negative_notes, layout_notes} (mất poster_*) | — | 3× / 5s | stop |
| 28 | Image Prompt | `lc.lmChatAnthropic` v1.6 | 5 Plan poster (sub) | — | ai_languageModel → Image Prompt Builder + Image Prompt Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 29 | Image Prompt Parser | `lc.outputParserStructured` v1.3 | 5 Plan poster (sub) | Text LLM | JSON theo `image-prompt.schema.json`, auto-fix | — | — | stop |
| 30 | Read Logo File | `readWriteFile` v1.1 | 6 Create poster | `Config.logo_path` | Binary `data` hoặc item lỗi (continueRegularOutput) | — | — | continueRegularOutput |
| 31 | Has Logo | `if` v2.2 | 6 Create poster | Item đọc file | true: có binary `data`; false: không | — | — | stop |
| 32 | Attach Logo | `code` v2 | 6 Create poster | Binary logo | `image_prompt` + binary `logo` | — | — | stop |
| 33 | Generate Image With Logo | `lc.openAi` v2.3 | 6 Create poster | Prompt + binary `logo` | Binary `data` (PNG 1024x1536) | openAiApi (`openAiLocal00001`) | 3× / 5s | stop |
| 34 | Generate Image | `lc.openAi` v2.3 | 6 Create poster | Prompt (xa từ Image Prompt Builder) | Binary `data` | openAiApi (`openAiLocal00001`) | 3× / 5s | stop |
| 35 | Text Overlay Enabled? | `if` v2.2 | 6 Create poster | Binary ảnh | true → Overlay; false → Upload | — | — | stop |
| 36 | Overlay Poster Text | `editImage` v1.1 | 6 Create poster | Binary `data`; chữ/màu đọc xa từ 4 node | Binary `data` đã chèn chữ | — | — | stop |
| 37 | Upload to Drive | `googleDrive` v3 | 6 Create poster | Binary `data` | Metadata file Drive (`id`, `webViewLink`…) — mất mọi field trước | **chưa gán** (googleDriveOAuth2Api) | 3× / 5s | stop |
| 38 | Share Anyone With Link | `googleDrive` v3 | 6 Create poster | `$json.id` | Permission (`id`, `type`, `role`) — mất `webViewLink` | **chưa gán** (googleDriveOAuth2Api) | 3× / 5s | stop |
| 39 | Check Posts Quality | `code` v2 | 7 Validate | Lần 1: bỏ qua input, đọc xa 7 node; lần 2: `posts` từ Merge | Hợp đồng chuẩn: `jd_id, attempt, valid, errors, error_summary, posts, warnings, poster_url, poster_direct_url` | — | — | stop |
| 40 | All Posts Valid | `if` v2.2 | 7 Validate | `valid` | true / false | — | — | stop |
| 41 | Build Rows | `code` v2 | 7 Validate | Hợp đồng chuẩn | 4 item dòng Posts | — | — | stop |
| 42 | Append to Posts | `googleSheets` v4.7 | 7 Validate | 4 item | 4 dòng tab Posts (status `Draft`) | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |
| 43 | Set Done | `googleSheets` v4.7 | 7 Validate | Đọc xa `Check Posts Quality`.last() | JD status `Done`, `poster_url`, `warnings` (executeOnce) | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop, executeOnce |
| 44 | Can Retry? | `if` v2.2 | 7 Validate | `attempt` | true nếu `attempt < 1` | — | — | stop |
| 45 | Prepare Rewrite | `code` v2 | 7 Validate | Hợp đồng chuẩn | 1 item/bài lỗi: `platform, platform_rules, errors, original, hashtags` | — | — | stop |
| 46 | Rewrite Failed Post | `lc.chainLlm` v1.9 | 7 Validate | Item bài lỗi + phân tích (xa) | `output` = {post_text, hashtags, cta} | — | 3× / 5s | stop |
| 47 | Rewrite Model | `lc.lmChatAnthropic` v1.6 | 7 Validate (sub) | — | ai_languageModel → Rewrite Failed Post + Rewrite Parser | anthropicApi (`anthropicLocal01`) | — | stop |
| 48 | Rewrite Parser | `lc.outputParserStructured` v1.3 | 7 Validate (sub) | Text LLM | JSON theo `platform-post.schema.json`, auto-fix | — | — | stop |
| 49 | Merge Rewritten Posts | `code` v2 | 7 Validate | Kết quả rewrite + xa `Check Posts Quality`, `Prepare Rewrite` | `{attempt: 1, posts}` → quay lại Check Posts Quality | — | — | stop |
| 50 | Set Validation Failed | `googleSheets` v4.7 | 7 Validate | Hợp đồng chuẩn | JD status `Validation Failed`, `error_message` (KHÔNG lưu bài) | **chưa gán** (googleSheetsOAuth2Api) | 3× / 5s | stop |

## 4. Data contract tại ranh giới giữa các nhóm

Quy ước: **vào** = field node đầu nhóm thực sự dùng; **ra** = field item đầu ra của node cuối nhóm; **xa** = đọc bằng `$('Tên node')…` thay vì `$json`.

| Ranh giới | Vào | Ra | Thêm / mất / đổi tên | Đọc xa (dễ vỡ) |
|---|---|---|---|---|
| Form → **1 Prepare** | 5 field form tiếng Việt có dấu cách (`Tên Công Ty`…) | Dòng sheet từ `Set Processing` | Thêm 6 field cấu hình (`Config`) và `jd_id` (`Generate JD ID`). `Add JD Row` **đổi tên** sang `company`, `position`, `jd_detail`, `salary`, `contact`, thêm `status`, `execution_id`. | `Set Processing` đọc `jd_id` từ `Generate JD ID`; `Add JD Row` đọc `Config` |
| **1 → 3 Analyze** | `JD Analyzer` **bỏ qua `$json`** (dòng sheet) | `output` = 15 field (`job_title_chuan`… `canh_bao_thieu_thong_tin`) | Mất toàn bộ field form + config trên item | `JD Analyzer` đọc 5 lần `$('Generate JD ID')` |
| **3 → 4 Write** | Không dùng `$json` | `Facebook Page Writer.output` = `{post_text, hashtags, cta}` | Mỗi Writer **thay** item bằng `output` của nó; 3 bài trước chỉ còn qua tham chiếu xa | Mỗi Writer đọc `JD Analyzer` + `Generate JD ID`; Writer thứ n đọc thêm n−1 Writer trước |
| **4 → 5 Plan poster** | `Poster Content Selector` **bỏ qua `$json`** (bài FB Page) | `Image Prompt Builder.output` = `{image_prompt, negative_notes, layout_notes}` | Thêm `poster_*` (đổi tên từ `job_title_chuan` → `poster_position`, `muc_luong_chuan_hoa` → `poster_salary` có tiền tố "Lương: ", `thong_tin_lien_he` → `poster_contact`), `industry`, `visual`; rồi **mất hết** ở `Image Prompt Builder` | 9 tham chiếu `JD Analyzer`/`Generate JD ID` trong `Poster Content Selector` |
| **5 → 6 Create poster** | `Read Logo File` dùng `Config.logo_path` (xa), không dùng `$json` | `Share Anyone With Link` = permission `{id, type, role}` | Item mang binary `data` qua 4–5 node; `Upload to Drive` thay JSON bằng metadata file; `Share…` **làm mất `webViewLink`** | `Overlay Poster Text` đọc xa 15 lần (4 node); `Generate Image` đọc xa `Image Prompt Builder` |
| **6 → 7 Validate** | Lần 1: `Check Posts Quality` **bỏ qua input**; lần 2: dùng `posts` từ `Merge Rewritten Posts` | Hợp đồng chuẩn duy nhất của workflow: `jd_id, attempt, valid, errors, error_summary, posts{4}, warnings, poster_url, poster_direct_url` | `poster_url` lấy từ `Upload to Drive.webViewLink`; hashtag được chuẩn hoá và cắt; thêm `full_text` | Đọc xa 7 node (`JD Analyzer`, `Generate JD ID`, `Upload to Drive`, 4 Writer) |
| 7 nội bộ | | | `Build Rows` tách 4 item; `Set Done` đọc lại `Check Posts Quality.last()` | `Merge Rewritten Posts` ghép theo **chỉ số item** với `Prepare Rewrite` |
| Error Trigger → **2 Flag failed** | `execution.id`, `execution.error.message`, `execution.lastNodeExecuted` | Dòng JD đã update | Thêm `spreadsheet_id` (bản sao riêng trong `Error Config`) | `Set Error` đọc `Error Trigger` 2 lần |

### Ma trận tham chiếu xa (node được đọc ← số lần)

| Node nguồn | Bị đọc xa | Ghi chú |
|---|---|---|
| `Generate JD ID` | **16** | Thực chất là "kho" dữ liệu form + jd_id |
| `JD Analyzer` | **15** | Kết quả phân tích dùng ở 4 nhóm sau |
| `Config` | **15** | 5 lần riêng trong `Overlay Poster Text` (font) |
| `Poster Content Selector` | 5 | Chỉ trong `Overlay Poster Text` |
| `LinkedIn Writer` / `Threads Writer` / `Facebook Groups Writer` / `Facebook Page Writer` | 4 / 3 / 2 / 1 | Writer sau + `Check Posts Quality` |
| `Visual Style Selector` | 4 | `Overlay Poster Text` |
| `Check Posts Quality` | 4 | `Set Done` (3), `Merge Rewritten Posts` (1) |
| `Image Prompt Builder` | 3 | `Attach Logo`, `Generate Image` |
| `Error Trigger` / `Error Config` | 3 / 2 | Nhánh lỗi |
| `Upload to Drive`, `Prepare Rewrite` | 1 / 1 | |

Tổng: **~79 tham chiếu xa** trong 25 node. Đổi tên bất kỳ node nguồn nào ở trên, hoặc tách nhóm ra sub-workflow, sẽ làm vỡ các expression này: n8n chỉ tự đổi tên tham chiếu khi rename trong UI, không đổi khi sửa JSON hay tách workflow.
