// Sinh MỘT workflow duy nhất "[dev] jd-tuyen-dung-da-nen-tang" (id jdAutoPostV20001):
// tạo bài + đăng bài + kiểm tra token + bắt lỗi, chia khung sticky theo từng giai đoạn.
// Chạy: node jd-automation/build-single.mjs  → jd-automation/jd-automation.v4.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').trim();
const prompt = (name) => read(`prompts/${name}.system.md`);
const schema = (name) => read(`schemas/${name}.schema.json`);
const SHARED_WRITER_RULES = read('prompts/_shared-writer-rules.md');
const SAMPLES = JSON.parse(read('test-data/publish-sample-posts.json'));

const WORKFLOW_ID = 'jdAutoPostV20001';
const WORKFLOW_NAME = '[dev] jd-tuyen-dung-da-nen-tang';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const RETRY2 = { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 };
const CRED = {
  basicAuth: { httpBasicAuth: { id: 'CLtFsk0dNV90Z52V', name: 'Unnamed credential' } },
  anthropic: { anthropicApi: { id: 'anthropicLocal01', name: 'Anthropic (from .env)' } },
  openAi: { openAiApi: { id: 'openAiLocal00001', name: 'OpenAI (from .env)' } },
};
const NOW_VN = "$now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss')";
const CFG = "$('[0 Setup] Config').first().json";
const IS_TEST = `(${CFG}.entry === 'manual' && ${CFG}.manual_mode === 'test_dry_run')`;

const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const body = (fn, replacements = {}) => {
  const s = fn.toString();
  let code = s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n/, '').replace(/^ {2}/gm, '').trimEnd();
  for (const [k, v] of Object.entries(replacements)) code = code.split(k).join(v);
  return code;
};

// ---------- Khung (section) và vị trí ----------
// Mỗi section có gốc toạ độ; node đặt theo lưới (cột, hàng). Sticky tự bao quanh các node của section.
const SECTIONS = {
  '0 Setup': { origin: [0, 0], color: 7, title: '0 · Cấu hình & điều hướng', info: '**Input:** Form JD · lịch 5 phút · webhook · lịch 08:00 · Error Trigger · chạy tay.\n**Output:** item + toàn bộ cấu hình; `Route by entry` rẽ sang khung tương ứng.\n**Sửa cấu hình DUY NHẤT ở node `[0 Setup] Config`** (Sheet, Drive, DRY_RUN, ID Page/LinkedIn, `manual_mode`).' },
  '1 Prepare': { origin: [1000, 0], color: 5, title: '1 · Nhận JD & chống trùng', info: '**Input:** 5 trường form. **Output:** `job = {jd_id, form, config, execution_id…}`; dòng JD `Processing`.\nTrùng nội dung (content_hash) với JD đang chạy/đã xong → ghi `Duplicate` và dừng.\n**Lỗi thường gặp:** sai `spreadsheet_id`, thiếu cột `content_hash`.' },
  '2 Analyze': { origin: [3000, 0], color: 4, title: '2 · Phân tích JD (Claude)', info: '**Input:** `job.form`. **Output:** `job.analysis` (15 trường).\n**Lỗi thường gặp:** credential Anthropic, model không tồn tại.' },
  '3 Write': { origin: [3900, 0], color: 6, title: '3 · Viết 4 bài (song song)', info: '**Input:** `job.analysis`. **Output:** `job.posts.{linkedin,threads,facebook_groups,facebook_page}`.\nBatch Size 4 → 4 lời gọi Claude chạy song song. Parser tự sửa JSON bằng Haiku.\n**Lỗi thường gặp:** 429 Anthropic → giảm Batch Size.' },
  '4 Poster': { origin: [1000, 1000], color: 2, title: '4 · Tạo poster (lỗi mềm)', info: '**Input:** `job`. **Output:** `job.poster = {file_id, url, shared, error}`.\nMọi lỗi ảnh/overlay/Drive → `Job without poster`: bài vẫn được lưu. Poster mặc định private.\n**Lỗi thường gặp:** OpenAI chưa xác minh tổ chức; sai `drive_folder_id`.' },
  '5 Validate': { origin: [1000, 2050], color: 5, title: '5 · Kiểm tra & lưu bài', info: '**Input:** `job.posts`. **Output:** `job.validation`; upsert 4 dòng Posts theo `post_key` (đạt → Draft, lỗi → Needs Review).\n**Lỗi thường gặp:** tab Posts thiếu cột `post_key`.' },
  '5b Rewrite': { origin: [2800, 2050], color: 3, title: '5b · Viết lại bài lỗi (tối đa 1 lần)', info: 'Chỉ chạy khi có bài lỗi ở lần kiểm tra đầu. Viết lại → kiểm tra lại → upsert lại cùng `post_key`.' },
  '5c Finish': { origin: [5000, 2050], color: 4, title: '5c · Hoàn tất JD', info: 'JD → `Done` hoặc `Needs Review` (+ lý do, cảnh báo, poster). Báo người duyệt qua Telegram nếu bật.' },
  '6 Publish': { origin: [1000, 2900], color: 6, title: '6 · Đăng bài đa nền tảng', info: '**Input:** dòng Posts `Approved` (hoặc `Manual - Confirmed`), nền tảng bật, tới `scheduled_at`. **Output:** cập nhật từng dòng theo `post_key`; JD → Published / Partially Published.\nClaim `Publishing` trước khi đăng; có `platform_post_id` thì bỏ qua. `dry_run = true` → chỉ ghi log. Facebook Groups luôn đăng tay.\n429/5xx → hẹn lại có backoff; 401/403 → Failed + cảnh báo.' },
  '7 Token': { origin: [1000, 4900], color: 2, title: '7 · Kiểm tra token (08:00 hằng ngày)', info: 'Kiểm tra token LinkedIn/Threads/Facebook Page, cảnh báo trước hạn (tab Tokens), tự làm mới token Threads và ghi vào credential qua n8n API.' },
  '8 Error': { origin: [4200, 4900], color: 3, title: '8 · Bắt lỗi (Error Trigger)', info: 'Workflow tự làm Error Workflow của chính nó. Lỗi → JD `Error` (theo `execution_id`) hoặc Posts `Publishing` → `Failed`; báo Telegram (đã che token).\nChỉ chạy với execution production (workflow phải active).' },
};
const GRID_X = 230;
const GRID_Y = 170;
const at = (section, col, row) => [SECTIONS[section].origin[0] + col * GRID_X, SECTIONS[section].origin[1] + 120 + row * GRID_Y];

// ---------- Bộ dựng ----------
const nodes = [];
const connections = {};
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  if (nodes.some((n) => n.name === name)) throw new Error(`Trùng tên node: ${name}`);
  nodes.push({ parameters, type, typeVersion, position, id: uuid(name), name, ...extra });
  return name;
};
const link = (from, to, outputIndex = 0, type = 'main') => {
  connections[from] ??= {};
  connections[from][type] ??= [];
  while (connections[from][type].length <= outputIndex) connections[from][type].push([]);
  connections[from][type][outputIndex].push({ node: to, type, index: 0 });
};
const chain = (...names) => names.slice(1).forEach((n, i) => link(names[i], n));

const setNode = (name, pos, fields, includeOtherFields = false, extra = {}) => node(name, 'n8n-nodes-base.set', 3.4, pos, {
  assignments: {
    assignments: Object.entries(fields).map(([fname, v]) => {
      const [value, type] = Array.isArray(v) ? v : [v, 'string'];
      return { id: uuid(`${name}:${fname}`), name: fname, value, type };
    }),
  },
  includeOtherFields,
  options: {},
}, extra);
const codeNode = (name, pos, fn, why, replacements, extra = {}) =>
  node(name, 'n8n-nodes-base.code', 2, pos, { jsCode: body(fn, replacements) }, { notes: `Why Code: ${why}`, ...extra });
const cond = (seed, leftValue, operator = { type: 'boolean', operation: 'true', singleValue: true }, rightValue = '') =>
  ({ id: uuid(seed), leftValue, rightValue, operator });
const ifNode = (name, pos, conditions, extra = {}) => node(name, 'n8n-nodes-base.if', 2.2, pos, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: (Array.isArray(conditions) ? conditions : [conditions]),
    combinator: 'and',
  },
  looseTypeValidation: true,
  options: {},
}, extra);
const isTrue = (name, pos, leftValue, extra) => ifNode(name, pos, cond(`${name}:c`, leftValue), extra);
const equals = (name, pos, leftValue, rightValue, extra) => ifNode(name, pos, cond(`${name}:c`, leftValue, { type: 'string', operation: 'equals' }, rightValue), extra);
const claude = (name, pos, model, temperature) => node(name, '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, pos, {
  model: { __rl: true, mode: 'id', value: model },
  options: { temperature, maxTokensToSample: 4096 },
}, { credentials: CRED.anthropic });
const parser = (name, pos, schemaName) => node(name, '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, pos, {
  schemaType: 'manual', inputSchema: schema(schemaName), autoFix: true,
});
const llmChain = ({ name, pos, systemMessage, text, schemaName, model, temperature, modelName, parserName, fixModelName, batchSize }) => {
  node(name, '@n8n/n8n-nodes-langchain.chainLlm', 1.9, pos, {
    promptType: 'define',
    text,
    hasOutputParser: true,
    messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: systemMessage }] },
    ...(batchSize ? { batching: { batchSize, delayBetweenBatches: 0 } } : {}),
  }, RETRY2);
  claude(modelName, [pos[0] - 110, pos[1] + 200], model, temperature);
  parser(parserName, [pos[0] + 110, pos[1] + 200], schemaName);
  link(modelName, name, 0, 'ai_languageModel');
  link(parserName, name, 0, 'ai_outputParser');
  if (fixModelName) {
    claude(fixModelName, [pos[0] + 110, pos[1] + 380], HAIKU, 0);
    link(fixModelName, parserName, 0, 'ai_languageModel');
  } else {
    link(modelName, parserName, 0, 'ai_languageModel');
  }
};
const colSchema = (ids) => ids.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
const DOC = { __rl: true, mode: 'id', value: `={{ ${CFG}.spreadsheet_id }}` };
const tab = (t) => ({ __rl: true, mode: 'name', value: t, cachedResultName: t });
const sheetWrite = (operation, sheetTab, values, matchingColumns = []) => ({
  operation, documentId: DOC, sheetName: tab(sheetTab),
  columns: { mappingMode: 'defineBelow', value: values, matchingColumns, schema: colSchema(Object.keys(values)), attemptToConvertTypes: false, convertFieldsToString: true },
  options: {},
});
const sheetRead = (sheetTab, filters = []) => ({
  operation: 'read', documentId: DOC, sheetName: tab(sheetTab),
  ...(filters.length ? { filtersUI: { values: filters }, combineFilters: 'AND' } : {}),
  options: {},
});
const sheets = (name, pos, params, extra = {}) => node(name, 'n8n-nodes-base.googleSheets', 4.7, pos, params, { ...RETRY2, ...extra });
const telegram = (name, pos, textExpr) => node(name, 'n8n-nodes-base.telegram', 1.2, pos, {
  chatId: `={{ ${CFG}.telegram_chat_id }}`, text: textExpr, additionalFields: { appendAttribution: false },
}, { onError: 'continueRegularOutput' });
const notifyEnabled = (name, pos, extraCond) => ifNode(name, pos, [
  cond(`${name}:tg`, `={{ ${CFG}.notify_channel }}`, { type: 'string', operation: 'equals' }, 'telegram'),
  ...(extraCond ? [cond(`${name}:x`, extraCond)] : []),
]);

// =====================================================================
// 0 · Setup — trigger → Config (nguồn cấu hình duy nhất) → Route by entry
// =====================================================================
node('[0 Setup] JD form', 'n8n-nodes-base.formTrigger', 2.6, at('0 Setup', 0, 0), {
  authentication: 'basicAuth',
  formTitle: 'Thông Tin JD Công Việc',
  formDescription:
    'Vui lòng điền đầy đủ thông tin tuyển dụng bên dưới để hệ thống tiếp nhận và xử lý.\n\n' +
    '• Tên Công Ty: tên đầy đủ của doanh nghiệp tuyển dụng\n' +
    '• Vị Trí: chức danh cần tuyển (ví dụ: Nhân viên Marketing)\n' +
    '• Chi Tiết JD: mô tả công việc, yêu cầu ứng viên, quyền lợi\n' +
    '• Mức Lương: ghi khoảng cụ thể (ví dụ: 15-25 triệu) hoặc "Thỏa thuận"\n' +
    '• Liên Hệ: số điện thoại hoặc email nhận hồ sơ\n\n' +
    'Các trường có dấu * là bắt buộc. Thông tin của bạn sẽ được bảo mật và chỉ dùng cho mục đích tuyển dụng.',
  formFields: {
    values: [
      { fieldLabel: 'Tên Công Ty', requiredField: true },
      { fieldLabel: 'Vị Trí', requiredField: true },
      { fieldLabel: 'Chi Tiết JD', fieldType: 'textarea', requiredField: true },
      { fieldLabel: 'Mức Lương' },
      { fieldLabel: 'Liên Hệ', requiredField: true },
    ],
  },
  options: {
    respondWithOptions: {
      values: {
        respondWith: 'text',
        formSubmittedText: '=Đã nhận JD. Mã theo dõi: exec-{{ $execution.id }} (cột execution_id trong tab JD). Hệ thống cần khoảng 2–4 phút để tạo bài và poster; bài sẽ ở trạng thái Draft chờ duyệt.',
      },
    },
  },
}, { webhookId: uuid('single-jd-form-webhook'), credentials: CRED.basicAuth });
node('[0 Setup] Every 5 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, at('0 Setup', 0, 1), { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } });
node('[0 Setup] Webhook publish one', 'n8n-nodes-base.webhook', 2.1, at('0 Setup', 0, 2), {
  httpMethod: 'POST', path: 'jd-publish-one', authentication: 'basicAuth', responseMode: 'onReceived', options: {},
}, { webhookId: uuid('single-publish-one-webhook'), credentials: CRED.basicAuth });
node('[0 Setup] Every day 08:00', 'n8n-nodes-base.scheduleTrigger', 1.2, at('0 Setup', 0, 3), { rule: { interval: [{ field: 'days', triggerAtHour: 8 }] } });
node('[0 Setup] Error Trigger', 'n8n-nodes-base.errorTrigger', 1, at('0 Setup', 0, 4), {});
node('[0 Setup] Run manually', 'n8n-nodes-base.manualTrigger', 1, at('0 Setup', 0, 5), {});

setNode('[0 Setup] Config', at('0 Setup', 1.3, 2.5), {
  // Nguồn kích hoạt (không sửa)
  entry: "={{ $('[0 Setup] JD form').isExecuted ? 'form' : ($('[0 Setup] Every 5 minutes').isExecuted || $('[0 Setup] Webhook publish one').isExecuted) ? 'publish' : $('[0 Setup] Every day 08:00').isExecuted ? 'token' : $('[0 Setup] Error Trigger').isExecuted ? 'error' : 'manual' }}",
  // Chạy tay làm gì: test_dry_run (4 bài mẫu, không đụng Sheet) | publish | token
  manual_mode: 'test_dry_run',
  only_post_key: "={{ $json.body?.post_key ?? '' }}",
  // --- Tạo bài / poster ---
  spreadsheet_id: 'REPLACE_WITH_SPREADSHEET_ID',
  drive_folder_id: 'REPLACE_WITH_DRIVE_FOLDER_ID',
  logo_path: '/files/jd-automation/logo.png',
  enable_text_overlay: [true, 'boolean'],
  image_model: 'gpt-image-1',
  overlay_font: '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf',
  poster_share_mode: 'private',
  n8n_base_url: 'http://localhost:5678',
  // --- Thông báo ---
  notify_channel: 'none',
  telegram_chat_id: '',
  // --- Đăng bài ---
  dry_run: [true, 'boolean'],
  enable_linkedin: [true, 'boolean'],
  enable_threads: [true, 'boolean'],
  enable_facebook_page: [true, 'boolean'],
  enable_facebook_groups: [true, 'boolean'],
  linkedin_person_id: 'REPLACE_WITH_LINKEDIN_PERSON_ID',
  facebook_page_id: 'REPLACE_WITH_FACEBOOK_PAGE_ID',
  facebook_graph_version: 'v25.0',
  threads_api_base: 'https://graph.threads.com/v1.0',
  threads_user_id: 'me',
  threads_image_mode: 'text_only',
  threads_image_url_template: '',
  threads_wait_seconds: [30, 'number'],
  facebook_group_links: '',
  min_gap_minutes_linkedin: [120, 'number'],
  min_gap_minutes_threads: [60, 'number'],
  min_gap_minutes_facebook_page: [120, 'number'],
  random_wait_max_seconds: [20, 'number'],
  max_publish_retries: [2, 'number'],
  retry_backoff_minutes: [15, 'number'],
  // --- Token ---
  token_warn_days: [7, 'number'],
  threads_refresh_before_days: [15, 'number'],
  threads_credential_id: 'REPLACE_WITH_THREADS_CREDENTIAL_ID',
  n8n_internal_url: 'http://localhost:5678',
}, true);
const ENTRIES = ['form', 'publish', 'test_dry_run', 'token', 'error'];
node('[0 Setup] Route by entry', 'n8n-nodes-base.switch', 3.2, at('0 Setup', 2.6, 2.5), {
  rules: {
    values: ENTRIES.map((key) => ({
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [cond(`entry:${key}`, "={{ $json.entry === 'manual' ? $json.manual_mode : $json.entry }}", { type: 'string', operation: 'equals' }, key)],
        combinator: 'and',
      },
      renameOutput: true,
      outputKey: key,
    })),
  },
  options: {},
});
for (const t of ['[0 Setup] JD form', '[0 Setup] Every 5 minutes', '[0 Setup] Webhook publish one', '[0 Setup] Every day 08:00', '[0 Setup] Error Trigger', '[0 Setup] Run manually']) {
  link(t, '[0 Setup] Config');
}
link('[0 Setup] Config', '[0 Setup] Route by entry');

// =====================================================================
// 1 · Prepare — job, chống trùng, ghi dòng JD
// =====================================================================
node('[1 Prepare] Generate JD ID', 'n8n-nodes-base.crypto', 2, at('1 Prepare', 0, 2), { action: 'generate', dataPropertyName: 'jd_id', encodingType: 'uuid' });
node('[1 Prepare] Hash JD content', 'n8n-nodes-base.crypto', 2, at('1 Prepare', 1, 2), {
  action: 'hash', type: 'SHA256', binaryData: false, encoding: 'hex', dataPropertyName: 'content_hash',
  value: "={{ [$json['Tên Công Ty'], $json['Vị Trí'], $json['Chi Tiết JD']].join('|').toLowerCase().replace(/\\s+/g, ' ').trim() }}",
});
codeNode('[1 Prepare] Build job', at('1 Prepare', 2, 2), function () {
  // Tạo object job: mọi bước sau chỉ đọc/ghi job (hợp đồng dữ liệu cố định).
  const FORM_KEYS = ['Tên Công Ty', 'Vị Trí', 'Chi Tiết JD', 'Mức Lương', 'Liên Hệ', 'submittedAt', 'formMode', 'jd_id', 'content_hash', 'entry', 'manual_mode', 'only_post_key'];
  const d = $input.first().json;
  const config = Object.fromEntries(Object.entries(d).filter(([k]) => !FORM_KEYS.includes(k)));
  const base = String(config.n8n_base_url || '').replace(/\/$/, '');
  return [{
    json: {
      job: {
        jd_id: d.jd_id,
        content_hash: d.content_hash,
        execution_id: `exec-${$execution.id}`,
        execution_url: `${base}/workflow/${$workflow.id}/executions/${$execution.id}`,
        form: {
          company: String(d['Tên Công Ty'] || '').trim(),
          position: String(d['Vị Trí'] || '').trim(),
          jd_detail: String(d['Chi Tiết JD'] || '').trim(),
          salary: String(d['Mức Lương'] || '').trim(),
          contact: String(d['Liên Hệ'] || '').trim(),
        },
        config,
      },
    },
  }];
}, 'tách form và cấu hình thành object job lồng nhau.');
sheets('[1 Prepare] Find same JD', at('1 Prepare', 3, 2), sheetRead('JD', [{ lookupColumn: 'content_hash', lookupValue: '={{ $json.job.content_hash }}' }]), { alwaysOutputData: true });
const ACTIVE = "['Processing', 'Done', 'Needs Review', 'Published', 'Partially Published']";
isTrue('[1 Prepare] Is duplicate?', at('1 Prepare', 4, 2), `={{ $input.all().some(r => ${ACTIVE}.includes(r.json.status)) }}`, { executeOnce: true });
const BJ = "$('[1 Prepare] Build job').first().json.job";
sheets('[1 Prepare] Log duplicate', at('1 Prepare', 5, 0.8), sheetWrite('append', 'JD', {
  jd_id: `={{ ${BJ}.jd_id }}`,
  created_at: `={{ ${NOW_VN} }}`,
  company: `={{ ${BJ}.form.company }}`,
  position: `={{ ${BJ}.form.position }}`,
  status: 'Duplicate',
  step: 'stopped',
  error_message: `={{ 'Trùng nội dung với jd_id ' + ($('[1 Prepare] Find same JD').all().find(r => ${ACTIVE}.includes(r.json.status))?.json.jd_id ?? '?') + ' — không xử lý lại. Muốn chạy lại: đổi status dòng cũ thành Error.' }}`,
  execution_id: `={{ ${BJ}.execution_id }}`,
  execution_url: `={{ ${BJ}.execution_url }}`,
  content_hash: `={{ ${BJ}.content_hash }}`,
}));
setNode('[1 Prepare] Restore job', at('1 Prepare', 5, 3), { job: [`={{ ${BJ} }}`, 'object'] });
sheets('[1 Prepare] Add JD row', at('1 Prepare', 6, 1), sheetWrite('append', 'JD', {
  jd_id: '={{ $json.job.jd_id }}',
  created_at: `={{ ${NOW_VN} }}`,
  company: '={{ $json.job.form.company }}',
  position: '={{ $json.job.form.position }}',
  jd_detail: '={{ $json.job.form.jd_detail }}',
  salary: '={{ $json.job.form.salary }}',
  contact: '={{ $json.job.form.contact }}',
  status: 'Processing',
  step: 'analyze',
  error_message: '',
  poster_url: '',
  warnings: '',
  execution_id: '={{ $json.job.execution_id }}',
  execution_url: '={{ $json.job.execution_url }}',
  content_hash: '={{ $json.job.content_hash }}',
}));
link('[0 Setup] Route by entry', '[1 Prepare] Generate JD ID', 0);
chain('[1 Prepare] Generate JD ID', '[1 Prepare] Hash JD content', '[1 Prepare] Build job', '[1 Prepare] Find same JD', '[1 Prepare] Is duplicate?');
link('[1 Prepare] Is duplicate?', '[1 Prepare] Log duplicate', 0);
link('[1 Prepare] Is duplicate?', '[1 Prepare] Restore job', 1);
// Nhánh phụ ghi Sheet đặt PHÍA TRÊN nhánh chính → chạy trước (executionOrder v1)
link('[1 Prepare] Restore job', '[1 Prepare] Add JD row');

const markStep = (name, pos, step, extra = {}) => sheets(name, pos, sheetWrite('update', 'JD', { jd_id: '={{ $json.job.jd_id }}', step, ...extra }, ['jd_id']));

// =====================================================================
// 2 · Analyze
// =====================================================================
llmChain({
  name: '[2 Analyze] Analyze JD', pos: at('2 Analyze', 0, 2),
  systemMessage: prompt('jd-analyzer'),
  text: '=Tên Công Ty: {{ $json.job.form.company }}\nVị Trí: {{ $json.job.form.position }}\nMức Lương (form): {{ $json.job.form.salary || "(để trống)" }}\nLiên Hệ (form): {{ $json.job.form.contact || "(để trống)" }}\nChi Tiết JD:\n{{ $json.job.form.jd_detail }}',
  schemaName: 'jd-analysis', model: SONNET, temperature: 0.2,
  modelName: '[2 Analyze] Model · Claude Sonnet', parserName: '[2 Analyze] Parser · JD analysis', fixModelName: '[2 Analyze] Model · Fix JSON (Haiku)',
});
setNode('[2 Analyze] Job + analysis', at('2 Analyze', 1.5, 2), {
  job: ["={{ { ...$('[1 Prepare] Restore job').first().json.job, analysis: $json.output } }}", 'object'],
});
markStep('[2 Analyze] Mark step write', at('2 Analyze', 2.6, 0.8), 'write', { warnings: "={{ ($json.job.analysis.canh_bao_thieu_thong_tin || []).join('; ') }}" });
link('[1 Prepare] Restore job', '[2 Analyze] Analyze JD');
link('[2 Analyze] Analyze JD', '[2 Analyze] Job + analysis');

// =====================================================================
// 3 · Write — 4 bài song song (Batch Size 4)
// =====================================================================
const PLATFORMS = {
  linkedin: { label: 'LinkedIn', system: `${prompt('linkedin-writer')}\n\n${SHARED_WRITER_RULES}` },
  threads: { label: 'Threads', system: `${prompt('threads-writer')}\n\n${SHARED_WRITER_RULES}` },
  facebook_groups: { label: 'Facebook Groups', system: `${prompt('facebook-groups-writer')}\n\n${SHARED_WRITER_RULES}` },
  facebook_page: { label: 'Facebook Page', system: `${prompt('facebook-page-writer')}\n\n${SHARED_WRITER_RULES}` },
};
function codeBuildTasks() {
  // Tạo 1 item cho mỗi bài cần viết: 4 bài (lần đầu) hoặc chỉ các bài lỗi (viết lại).
  const job = $input.first().json.job;
  const P = __PLATFORMS__;
  const REWRITE = __REWRITE__;
  const v = job.validation;
  const rewrite = !!(v && !v.valid);
  const keys = rewrite ? Object.keys(v.errors) : Object.keys(P);
  const analysis = JSON.stringify(job.analysis);
  return keys.map((k) => {
    const lines = [
      `Hãy viết bài đăng tuyển dụng cho nền tảng ${P[k].label}.`,
      `Tên công ty: ${job.form.company}`,
      `Dữ liệu JD đã phân tích (JSON): ${analysis}`,
    ];
    if (rewrite) {
      lines.push('', 'Ghi chú sửa lỗi:', ...v.errors[k].map((e) => `- ${e}`), '', 'Bài cần viết lại:', job.posts[k].full_text || job.posts[k].post_text);
    }
    return { json: { platform: k, system_prompt: rewrite ? `${P[k].system}\n\n${REWRITE}` : P[k].system, user_prompt: lines.join('\n') } };
  });
}
function codeMergePosts() {
  // Ghép kết quả LLM (theo thứ tự item) vào job.posts; giữ nguyên bài không cần viết lại.
  const job = $('__JOB_NODE__').first().json.job;
  const tasks = $('__TASK_NODE__').all();
  const posts = { ...(job.posts || {}) };
  $input.all().forEach((item, i) => {
    posts[tasks[i].json.platform] = item.json.output;
  });
  return [{ json: { job: { ...job, posts } } }];
}
const TASK_REPL = { __PLATFORMS__: JSON.stringify(PLATFORMS), __REWRITE__: JSON.stringify(prompt('post-rewriter')) };
codeNode('[3 Write] Build platform tasks', at('3 Write', 0, 2), codeBuildTasks, 'số item thay đổi theo chế độ viết mới/viết lại, mỗi item mang system prompt riêng.', TASK_REPL);
llmChain({
  name: '[3 Write] Generate posts', pos: at('3 Write', 1, 2),
  systemMessage: '={{ $json.system_prompt }}', text: '={{ $json.user_prompt }}',
  schemaName: 'platform-post', model: SONNET, temperature: 0.7, batchSize: 4,
  modelName: '[3 Write] Model · Claude Sonnet', parserName: '[3 Write] Parser · Platform post', fixModelName: '[3 Write] Model · Fix JSON (Haiku)',
});
codeNode('[3 Write] Job + posts', at('3 Write', 2.2, 2), codeMergePosts, 'ghép N kết quả LLM với N task theo chỉ số item.',
  { __JOB_NODE__: '[2 Analyze] Job + analysis', __TASK_NODE__: '[3 Write] Build platform tasks' });
markStep('[3 Write] Mark step poster', at('3 Write', 3.2, 0.8), 'poster');
link('[2 Analyze] Job + analysis', '[2 Analyze] Mark step write');
link('[2 Analyze] Job + analysis', '[3 Write] Build platform tasks');
chain('[3 Write] Build platform tasks', '[3 Write] Generate posts', '[3 Write] Job + posts');
link('[3 Write] Job + posts', '[3 Write] Mark step poster');

// =====================================================================
// 4 · Poster (lỗi mềm)
// =====================================================================
const PCTX = "$('[4 Poster] Select visual style').first().json";
const cut = (expr, n) => `(s => s.length <= ${n} ? s : s.slice(0, ${n}).replace(/\\s+\\S*$/, '') + '…')(String(${expr} || '').trim())`;
const notStated = (expr) => `/^\\s*(không nêu|khong neu)?\\s*$/i.test(${expr} ?? '')`;
setNode('[4 Poster] Select content', at('4 Poster', 0, 2), {
  poster_position: `={{ ${cut('$json.job.analysis.job_title_chuan || $json.job.form.position', 40)} }}`,
  poster_company: `={{ ${cut("$json.job.form.company.replace(/^công ty\\s+((cổ phần|tnhh)(\\s+mtv)?\\s+)?/iu, '').toUpperCase()", 26)} }}`,
  poster_salary: `={{ ${notStated('$json.job.analysis.muc_luong_chuan_hoa')} ? ' ' : ${cut("'Lương: ' + $json.job.analysis.muc_luong_chuan_hoa", 40)} }}`,
  poster_highlights: `={{ ($json.job.analysis.diem_hap_dan || []).slice(0, 3).map(h => '• ' + ${cut('h', 45)}).join('\\n') || ' ' }}`,
  poster_contact: `={{ ${notStated('$json.job.analysis.thong_tin_lien_he')} ? ' ' : ${cut("'Liên hệ: ' + $json.job.analysis.thong_tin_lien_he", 52)} }}`,
}, true);
const STYLE_MAP = {
  'Công nghệ thông tin': { style: 'modern minimalist tech, clean geometric shapes, subtle circuit and data-flow motifs, soft glow', palette: '#0B1F3A navy, #2F80ED electric blue, #56CCF2 cyan, white', panel: '#0B1F3A26', accent: '#56CCF2' },
  'F&B': { style: 'warm and cozy, natural daylight, appetizing food and cafe ambience, soft bokeh', palette: '#3E2723 espresso brown, #F2994A warm orange, #F2C94C honey, cream', panel: '#3E272326', accent: '#F2C94C' },
  'Tài chính - Ngân hàng': { style: 'luxurious and trustworthy, elegant architecture, marble and gold accents, refined lighting', palette: '#0A1A2F deep navy, #C9A227 gold, #E5E5E5 silver, white', panel: '#0A1A2F26', accent: '#C9A227' },
  'Bán lẻ': { style: 'vibrant and friendly retail store scene, colorful shelves, energetic', palette: '#4A148C purple, #FF4081 pink, #FFD54F yellow, white', panel: '#4A148C26', accent: '#FFD54F' },
  'Sản xuất': { style: 'industrial and solid, modern factory, safety gear, strong perspective', palette: '#263238 charcoal, #FF6F00 safety orange, #90A4AE steel, white', panel: '#26323826', accent: '#FF9800' },
  'Giáo dục': { style: 'bright and inspiring, books, classroom light, hopeful mood', palette: '#1B3A4B teal navy, #27AE60 green, #F2C94C yellow, white', panel: '#1B3A4B26', accent: '#F2C94C' },
  'Y tế': { style: 'clean and caring, bright clinic, soft light, calm', palette: '#0D3B66 medical blue, #2EC4B6 teal, #E0FBFC mint, white', panel: '#0D3B6626', accent: '#2EC4B6' },
  'Marketing - Truyền thông': { style: 'bold creative, dynamic shapes, studio lighting, trendy', palette: '#1A1A2E midnight, #E94560 coral red, #F9ED69 lemon, white', panel: '#1A1A2E26', accent: '#F9ED69' },
  Logistics: { style: 'dynamic movement, trucks and warehouse, motion lines, efficient', palette: '#102A43 navy, #F0B429 amber, #9FB3C8 grey blue, white', panel: '#102A4326', accent: '#F0B429' },
  'Bất động sản': { style: 'premium modern architecture, skyline at golden hour', palette: '#1C2833 graphite, #B9975B champagne gold, #D5D8DC light grey, white', panel: '#1C283326', accent: '#B9975B' },
};
const DEFAULT_STYLE = { style: 'clean corporate, modern office, professional and friendly', palette: '#13293D dark blue, #1B98E0 blue, #E8F1F2 off-white, white', panel: '#13293D26', accent: '#1B98E0' };
setNode('[4 Poster] Select visual style', at('4 Poster', 1, 2), {
  industry: '={{ $json.job.analysis.nganh_nghe }}',
  visual: [`={{ (${JSON.stringify(STYLE_MAP).replaceAll('}}', '} }')})[$json.job.analysis.nganh_nghe] ?? ${JSON.stringify(DEFAULT_STYLE)} }}`, 'object'],
}, true);
llmChain({
  name: '[4 Poster] Build image prompt', pos: at('4 Poster', 2, 2),
  systemMessage: prompt('image-prompt-builder'),
  text: '=Create the background prompt for a recruitment poster.\nIndustry (Vietnamese): {{ $json.industry }}\nJob title (meaning only, DO NOT render as text): {{ $json.poster_position }}\nKey skills (meaning only): {{ ($json.job.analysis.ky_nang_chinh || []).slice(0, 5).join(", ") }}\nVisual style: {{ $json.visual.style }}\nPalette: {{ $json.visual.palette }}\nCanvas: 1024x1536 portrait. Bottom 40% must be a calm dark area for overlay text; top-left corner clear for a logo.',
  schemaName: 'image-prompt', model: HAIKU, temperature: 0.7,
  modelName: '[4 Poster] Model · Claude Haiku', parserName: '[4 Poster] Parser · Image prompt',
});
node('[4 Poster] Read logo file', 'n8n-nodes-base.readWriteFile', 1.1, at('4 Poster', 3, 2), {
  operation: 'read', fileSelector: `={{ ${PCTX}.job.config.logo_path }}`, options: {},
}, { alwaysOutputData: true, onError: 'continueRegularOutput' });
isTrue('[4 Poster] Has logo?', at('4 Poster', 4, 2), '={{ Boolean($binary?.data) }}');
codeNode('[4 Poster] Attach logo', at('4 Poster', 5, 1), function () {
  // Gộp prompt ảnh với binary logo, đổi tên binary thành "logo" cho OpenAI Edit Image.
  const promptOut = $('[4 Poster] Build image prompt').first().json.output;
  return $input.all().map((item) => ({
    json: {
      image_prompt: `${promptOut.image_prompt}\nUse the provided image as the company logo: place it small, unchanged and undistorted, in the top-left reserved zone. Do not add any text, letters or numbers anywhere. Avoid: ${promptOut.negative_notes}`,
    },
    binary: { logo: item.binary.data },
  }));
}, 'ghép JSON prompt với binary logo và đổi tên binary property.');
node('[4 Poster] Generate image with logo', '@n8n/n8n-nodes-langchain.openAi', 2.3, at('4 Poster', 6, 1), {
  resource: 'image', operation: 'edit',
  modelId: { __rl: true, mode: 'id', value: `={{ ${PCTX}.job.config.image_model }}` },
  prompt: '={{ $json.image_prompt }}',
  images: { values: [{ binaryPropertyName: 'logo' }] },
  size: '1024x1536', quality: 'high', options: {},
}, { ...RETRY2, onError: 'continueErrorOutput', credentials: CRED.openAi });
node('[4 Poster] Generate image', '@n8n/n8n-nodes-langchain.openAi', 2.3, at('4 Poster', 6, 3), {
  resource: 'image', operation: 'generate',
  modelId: { __rl: true, mode: 'id', value: `={{ ${PCTX}.job.config.image_model }}` },
  prompt: "={{ $('[4 Poster] Build image prompt').first().json.output.image_prompt }}\nAvoid: {{ $('[4 Poster] Build image prompt').first().json.output.negative_notes }}",
  options: { size: '1024x1536', quality: 'high' },
}, { ...RETRY2, onError: 'continueErrorOutput', credentials: CRED.openAi });
isTrue('[4 Poster] Overlay enabled?', at('4 Poster', 7, 2), `={{ ${PCTX}.job.config.enable_text_overlay }}`);
const FONT = `={{ ${PCTX}.job.config.overlay_font }}`;
const textStep = (text, fontSize, fontColor, positionY, lineLength) => ({
  operation: 'text', text, fontSize, fontColor, positionX: 72, positionY, horizontalAlignment: 'left', verticalAlignment: 'top', lineLength, font: FONT,
});
node('[4 Poster] Overlay Vietnamese text', 'n8n-nodes-base.editImage', 1.1, at('4 Poster', 8, 1), {
  operation: 'multiStep',
  dataPropertyName: 'data',
  operations: {
    operations: [
      { operation: 'draw', primitive: 'rectangle', color: `={{ ${PCTX}.visual.panel }}`, startPositionX: 0, startPositionY: 940, endPositionX: 1024, endPositionY: 1536 },
      { operation: 'draw', primitive: 'rectangle', color: `={{ ${PCTX}.visual.accent }}`, startPositionX: 72, startPositionY: 948, endPositionX: 232, endPositionY: 954 },
      textStep(`={{ ${PCTX}.poster_company }} TUYỂN DỤNG`, 34, `={{ ${PCTX}.visual.accent }}`, 1000, 48),
      textStep(`={{ ${PCTX}.poster_position }}`, 62, '#FFFFFF', 1065, 24),
      textStep(`={{ ${PCTX}.poster_salary }}`, 44, `={{ ${PCTX}.visual.accent }}`, 1230, 36),
      textStep(`={{ ${PCTX}.poster_highlights }}`, 30, '#FFFFFF', 1300, 52),
      textStep(`={{ ${PCTX}.poster_contact }}`, 32, '#FFFFFF', 1465, 52),
    ],
  },
  options: { format: 'png', fileName: `=poster-{{ ${PCTX}.job.jd_id }}.png` },
}, { onError: 'continueErrorOutput' });
node('[4 Poster] Upload to Drive', 'n8n-nodes-base.googleDrive', 3, at('4 Poster', 9, 2), {
  inputDataFieldName: 'data',
  name: `=poster-{{ ${PCTX}.job.jd_id }}.png`,
  driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
  folderId: { __rl: true, mode: 'id', value: `={{ ${PCTX}.job.config.drive_folder_id }}` },
  options: { simplifyOutput: false },
}, { ...RETRY2, onError: 'continueErrorOutput' });
equals('[4 Poster] Share publicly?', at('4 Poster', 10, 2), `={{ ${PCTX}.job.config.poster_share_mode }}`, 'anyone');
node('[4 Poster] Share anyone with link', 'n8n-nodes-base.googleDrive', 3, at('4 Poster', 11, 1), {
  operation: 'share',
  fileId: { __rl: true, mode: 'id', value: '={{ $json.id }}' },
  permissionsUi: { permissionsValues: { role: 'reader', type: 'anyone' } },
  options: {},
}, { ...RETRY2, onError: 'continueRegularOutput' });
const UP = "$('[4 Poster] Upload to Drive').first().json";
setNode('[4 Poster] Job + poster', at('4 Poster', 12, 2), {
  job: [`={{ { ...${PCTX}.job, poster: { file_id: ${UP}.id, url: ${UP}.webViewLink ?? '', shared: ${PCTX}.job.config.poster_share_mode === 'anyone', error: '' } } }}`, 'object'],
}, false, { executeOnce: true });
setNode('[4 Poster] Job without poster', at('4 Poster', 12, 4), {
  job: [`={{ { ...${PCTX}.job, poster: { file_id: '', url: '', shared: false, error: $prevNode.name + ': ' + String($json.error?.message ?? $json.error ?? 'lỗi không rõ').slice(0, 300) } } }}`, 'object'],
}, false, { executeOnce: true });
link('[3 Write] Job + posts', '[4 Poster] Select content');
chain('[4 Poster] Select content', '[4 Poster] Select visual style', '[4 Poster] Build image prompt', '[4 Poster] Read logo file', '[4 Poster] Has logo?');
link('[4 Poster] Has logo?', '[4 Poster] Attach logo', 0);
link('[4 Poster] Has logo?', '[4 Poster] Generate image', 1);
link('[4 Poster] Attach logo', '[4 Poster] Generate image with logo');
link('[4 Poster] Generate image with logo', '[4 Poster] Overlay enabled?', 0);
link('[4 Poster] Generate image with logo', '[4 Poster] Job without poster', 1);
link('[4 Poster] Generate image', '[4 Poster] Overlay enabled?', 0);
link('[4 Poster] Generate image', '[4 Poster] Job without poster', 1);
link('[4 Poster] Overlay enabled?', '[4 Poster] Overlay Vietnamese text', 0);
link('[4 Poster] Overlay enabled?', '[4 Poster] Upload to Drive', 1);
link('[4 Poster] Overlay Vietnamese text', '[4 Poster] Upload to Drive', 0);
link('[4 Poster] Overlay Vietnamese text', '[4 Poster] Job without poster', 1);
link('[4 Poster] Upload to Drive', '[4 Poster] Share publicly?', 0);
link('[4 Poster] Upload to Drive', '[4 Poster] Job without poster', 1);
link('[4 Poster] Share publicly?', '[4 Poster] Share anyone with link', 0);
link('[4 Poster] Share publicly?', '[4 Poster] Job + poster', 1);
link('[4 Poster] Share anyone with link', '[4 Poster] Job + poster');

// =====================================================================
// 5 · Validate & save  (+ 5b Rewrite, 5c Finish)
// =====================================================================
function codeCheckPosts() {
  // Kiểm tra 4 bài trong job.posts; chỉ đọc input.
  const job = $input.first().json.job;
  const a = job.analysis || {};
  const form = job.form;
  const attempt = (job.validation?.attempt ?? -1) + 1;
  const RULES = {
    linkedin: { label: 'LinkedIn', maxChars: 3000, minTags: 3, maxTags: 5 },
    threads: { label: 'Threads', maxChars: 500, minTags: 0, maxTags: 2 },
    facebook_groups: { label: 'Facebook Groups', maxChars: 2000, minTags: 0, maxTags: 4 },
    facebook_page: { label: 'Facebook Page', maxChars: 2500, minTags: 3, maxTags: 5 },
  };
  const notStated = (v) => /^\s*(không nêu|khong neu)?\s*$/i.test(v ?? '');
  const normTag = (t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, '');
  const sourceText = [form.jd_detail, form.salary, form.contact].join(' \n ');
  const sourceNumbers = new Set((sourceText.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/[.,]/g, '')));
  const contactRaw = notStated(a.thong_tin_lien_he) ? (form.contact || '') : a.thong_tin_lien_he;
  const contactTokens = [
    ...(contactRaw.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map((s) => s.toLowerCase()),
    ...(contactRaw.match(/(?:https?:\/\/|www\.)\S+/g) || []).map((s) => s.toLowerCase()),
    ...(contactRaw.match(/\+?\d[\d .-]{7,}\d/g) || []).map((s) => s.replace(/\D/g, '')),
  ];
  // Đơn vị tiền rõ ràng (bỏ "k" để không bắt nhầm "5k follower")
  const MONEY = /(\d+(?:[.,]\d+)?)\s*(?:-|–|đến|tới)?\s*(?:\d+(?:[.,]\d+)?)?\s*(triệu|tr\b|củ|nghìn|ngàn|usd|\$|vnđ|vnd|đồng)/gi;
  // Chỉ bắt placeholder rõ ràng, không bắt "[HN]", "[Tuyển gấp]"
  const PLACEHOLDER = /\{\{[^}]*\}\}|\[(?:tên|ten|link|name|số điện thoại|sđt|sdt|email|công ty|cong ty|vị trí|vi tri|địa chỉ|dia chi|mức lương|muc luong)[^\]\n]{0,30}\]|\bX{3,}\b|<(?:tên|link|name|email|số điện thoại)[^>\n]{0,30}>/i;
  const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;
  // "lương ... <số>" khi JD không nêu lương, bỏ qua "lương tháng 13/14"
  const mentionsSalaryNumber = (t) => [...t.matchAll(/lương([^\n\d]{0,25})(\d[\d.,]*)/gi)].some((m) => !/tháng\s*$/i.test(m[1]));

  const errors = {};
  const posts = {};
  for (const [key, rule] of Object.entries(RULES)) {
    const p = (job.posts || {})[key] || {};
    const errs = [];
    const text = String(p.post_text || '').trim();
    const inText = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
    let tags = [...new Set((p.hashtags || []).map(normTag).filter((t) => t.length > 1))];
    if (tags.length + inText.size < rule.minTags) tags = [...new Set([...tags, ...(a.tu_khoa_hashtag || []).map(normTag)])];
    tags = tags.filter((t) => !inText.has(t.toLowerCase())).slice(0, Math.max(0, rule.maxTags - inText.size));
    const full = tags.length ? `${text}\n\n${tags.join(' ')}` : text;

    if (!text) errs.push('Bài rỗng');
    if (full.length > rule.maxChars) errs.push(`Vượt giới hạn ${rule.maxChars} ký tự (hiện ${full.length})`);
    const ph = full.match(PLACEHOLDER);
    if (ph) errs.push(`Còn placeholder: "${ph[0]}"`);
    if (contactTokens.length) {
      const lower = full.toLowerCase();
      const digits = full.replace(/\D/g, '');
      if (!contactTokens.some((t) => (/^\d+$/.test(t) ? digits.includes(t) : lower.includes(t)))) errs.push(`Thiếu thông tin liên hệ có trong JD (${contactRaw})`);
    }
    for (const m of full.matchAll(MONEY)) {
      const nums = (m[0].match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/[.,]/g, ''));
      if (nums.some((n) => !sourceNumbers.has(n))) errs.push(`Có số tiền không có trong JD: "${m[0].trim()}"`);
    }
    if (notStated(a.muc_luong_chuan_hoa) && mentionsSalaryNumber(full)) errs.push('JD không nêu lương nhưng bài có con số lương');
    const letters = (full.match(/\p{L}/gu) || []).length;
    if (letters && (full.match(VI_CHARS) || []).length / letters < 0.03) errs.push('Có vẻ không phải tiếng Việt có dấu');

    if (errs.length) errors[key] = errs;
    posts[key] = { post_text: text, hashtags: tags, cta: p.cta || '', full_text: full };
  }
  const error_summary = Object.entries(errors).map(([k, e]) => `${RULES[k].label}: ${e.join('; ')}`).join(' || ');
  return [{ json: { job: { ...job, posts, validation: { valid: Object.keys(errors).length === 0, attempt, errors, error_summary } } } }];
}
function codeBuildRows() {
  // 4 dòng tab Posts, khoá post_key = jd_id|platform để upsert (chạy lại không tạo dòng trùng).
  const job = $input.first().json.job;
  const LABELS = { linkedin: 'LinkedIn', threads: 'Threads', facebook_groups: 'Facebook Groups', facebook_page: 'Facebook Page' };
  const createdAt = $now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss');
  return Object.entries(LABELS).map(([key, label]) => {
    const p = job.posts[key];
    const errs = job.validation.errors[key];
    return {
      json: {
        post_key: `${job.jd_id}|${key}`,
        jd_id: job.jd_id,
        platform: label,
        post_text: p.full_text,
        hashtags: p.hashtags.join(' '),
        poster_url: job.poster?.url || '',
        poster_file_id: job.poster?.file_id || '',
        status: errs ? 'Needs Review' : 'Draft',
        error_message: errs ? errs.join('; ') : '',
        created_at: createdAt,
        retry_count: 0,
      },
    };
  });
}
const POST_COLS = ['post_key', 'jd_id', 'platform', 'post_text', 'hashtags', 'poster_url', 'poster_file_id', 'status', 'error_message', 'created_at', 'retry_count'];
const upsertPosts = (name, pos) => sheets(name, pos, sheetWrite('appendOrUpdate', 'Posts', Object.fromEntries(POST_COLS.map((c) => [c, `={{ $json.${c} }}`])), ['post_key']));

markStep('[5 Validate] Mark step validate', at('5 Validate', 1, 0.8), 'validate', { poster_url: "={{ $json.job.poster?.url ?? '' }}" });
codeNode('[5 Validate] Check posts quality', at('5 Validate', 0, 2), codeCheckPosts, 'nhiều quy tắc regex (lương, liên hệ, placeholder, dấu tiếng Việt) trên 4 bài.');
codeNode('[5 Validate] Build post rows', at('5 Validate', 1, 2), codeBuildRows, 'ánh xạ object 4 nền tảng thành 4 dòng có post_key.');
upsertPosts('[5 Validate] Upsert post rows', at('5 Validate', 2, 2));
setNode('[5 Validate] Job + validation', at('5 Validate', 3, 2), {
  job: ["={{ $('[5 Validate] Check posts quality').first().json.job }}", 'object'],
}, false, { executeOnce: true });
ifNode('[5 Validate] Needs rewrite?', at('5 Validate', 4, 2), [
  cond('rw:valid', '={{ $json.job.validation.valid }}', { type: 'boolean', operation: 'false', singleValue: true }),
  cond('rw:attempt', '={{ $json.job.validation.attempt }}', { type: 'number', operation: 'lt' }, 1),
]);
link('[4 Poster] Job + poster', '[5 Validate] Check posts quality');
link('[4 Poster] Job without poster', '[5 Validate] Check posts quality');
link('[5 Validate] Check posts quality', '[5 Validate] Mark step validate');
chain('[5 Validate] Check posts quality', '[5 Validate] Build post rows', '[5 Validate] Upsert post rows', '[5 Validate] Job + validation', '[5 Validate] Needs rewrite?');

// 5b · Rewrite (thẳng hàng, không vòng ngược)
codeNode('[5b Rewrite] Build rewrite tasks', at('5b Rewrite', 0, 2), codeBuildTasks, 'chỉ tạo item cho các bài bị lỗi, kèm ghi chú sửa lỗi.', TASK_REPL);
llmChain({
  name: '[5b Rewrite] Rewrite failed posts', pos: at('5b Rewrite', 1, 2),
  systemMessage: '={{ $json.system_prompt }}', text: '={{ $json.user_prompt }}',
  schemaName: 'platform-post', model: SONNET, temperature: 0.4, batchSize: 4,
  modelName: '[5b Rewrite] Model · Claude Sonnet', parserName: '[5b Rewrite] Parser · Platform post', fixModelName: '[5b Rewrite] Model · Fix JSON (Haiku)',
});
codeNode('[5b Rewrite] Job + rewritten posts', at('5b Rewrite', 2.2, 2), codeMergePosts, 'ghép bài viết lại vào đúng nền tảng theo chỉ số item.',
  { __JOB_NODE__: '[5 Validate] Job + validation', __TASK_NODE__: '[5b Rewrite] Build rewrite tasks' });
codeNode('[5b Rewrite] Check posts again', at('5b Rewrite', 3.2, 2), codeCheckPosts, 'cùng bộ quy tắc kiểm tra như bước 5.');
codeNode('[5b Rewrite] Build post rows', at('5b Rewrite', 4.2, 2), codeBuildRows, 'ánh xạ 4 bài thành 4 dòng có post_key.');
upsertPosts('[5b Rewrite] Upsert post rows', at('5b Rewrite', 5.2, 2));
setNode('[5b Rewrite] Job after rewrite', at('5b Rewrite', 6.2, 2), {
  job: ["={{ $('[5b Rewrite] Check posts again').first().json.job }}", 'object'],
}, false, { executeOnce: true });
link('[5 Validate] Needs rewrite?', '[5b Rewrite] Build rewrite tasks', 0);
chain('[5b Rewrite] Build rewrite tasks', '[5b Rewrite] Rewrite failed posts', '[5b Rewrite] Job + rewritten posts', '[5b Rewrite] Check posts again',
  '[5b Rewrite] Build post rows', '[5b Rewrite] Upsert post rows', '[5b Rewrite] Job after rewrite');

// 5c · Finish
node('[5c Finish] Final job', 'n8n-nodes-base.noOp', 1, at('5c Finish', 0, 2), {});
sheets('[5c Finish] Set JD result', at('5c Finish', 1, 1), sheetWrite('update', 'JD', {
  jd_id: '={{ $json.job.jd_id }}',
  status: "={{ $json.job.validation.valid ? 'Done' : 'Needs Review' }}",
  step: 'finished',
  poster_url: "={{ $json.job.poster?.url ?? '' }}",
  warnings: "={{ ($json.job.analysis.canh_bao_thieu_thong_tin || []).join('; ') }}",
  error_message: "={{ [$json.job.validation.error_summary, $json.job.poster?.error].filter(Boolean).join(' || ') }}",
}, ['jd_id']));
notifyEnabled('[5c Finish] Notify reviewer?', at('5c Finish', 1, 3));
telegram('[5c Finish] Notify reviewer', at('5c Finish', 2, 3),
  "=🆕 JD \"{{ $json.job.form.position }}\" – {{ $json.job.form.company }}\n4 bài đã lưu tab Posts ({{ $json.job.validation.valid ? 'Draft, chờ duyệt' : 'có bài Needs Review' }}).\nĐổi status sang Approved để đăng.\nPoster: {{ $json.job.poster?.url || '(không có: ' + ($json.job.poster?.error || 'tắt') + ')' }}\njd_id: {{ $json.job.jd_id }}");
link('[5 Validate] Needs rewrite?', '[5c Finish] Final job', 1);
link('[5b Rewrite] Job after rewrite', '[5c Finish] Final job');
link('[5c Finish] Final job', '[5c Finish] Set JD result');
link('[5c Finish] Final job', '[5c Finish] Notify reviewer?');
link('[5c Finish] Notify reviewer?', '[5c Finish] Notify reviewer', 0);

// =====================================================================
// 6 · Publish — đọc Posts / bài mẫu test → chọn → claim → đăng từng dòng → ghi kết quả → JD
// =====================================================================
const PRE = "$('[6 Publish] Precheck').first().json";
sheets('[6 Publish] Read posts', at('6 Publish', 0, 1), sheetRead('Posts'), { alwaysOutputData: true, executeOnce: true });
codeNode('[6 Publish] Sample approved posts', at('6 Publish', 0, 3), function () {
  // Chế độ test_dry_run: 4 bài mẫu (test-data/publish-sample-posts.json), không đọc/ghi Google Sheets.
  const SAMPLES = __SAMPLES__;
  return SAMPLES.map((row) => ({ json: row }));
}, 'nhúng dữ liệu mẫu cho chế độ test.', { __SAMPLES__: JSON.stringify(SAMPLES) });
codeNode('[6 Publish] Pick due posts', at('6 Publish', 1, 2), function () {
  // Chọn dòng được phép đăng: Approved (hoặc Manual - Confirmed), nền tảng bật, tới giờ hẹn,
  // khoảng cách tối thiểu giữa 2 bài cùng nền tảng; tối đa 1 bài/nền tảng/lần chạy (trừ DRY_RUN).
  const cfg = $('[0 Setup] Config').first().json;
  const isTrue = (v) => v === true || String(v) === 'true';
  const testMode = cfg.entry === 'manual' && cfg.manual_mode === 'test_dry_run';
  const dryRun = testMode || isTrue(cfg.dry_run);
  const zone = 'Asia/Ho_Chi_Minh';
  const parse = (s) => {
    if (!s) return null;
    const d = DateTime.fromSQL(String(s), { zone });
    return d.isValid ? d : DateTime.fromISO(String(s), { zone });
  };
  const now = DateTime.now().setZone(zone);
  const rows = $input.all().map((i) => i.json).filter((r) => r.post_key);
  const ENABLED = { LinkedIn: cfg.enable_linkedin, Threads: cfg.enable_threads, 'Facebook Page': cfg.enable_facebook_page, 'Facebook Groups': cfg.enable_facebook_groups };
  const GAP = { LinkedIn: cfg.min_gap_minutes_linkedin, Threads: cfg.min_gap_minutes_threads, 'Facebook Page': cfg.min_gap_minutes_facebook_page, 'Facebook Groups': 0 };
  const last = {};
  for (const r of rows) {
    const p = parse(r.published_at);
    if (p?.isValid && r.status === 'Published' && (!last[r.platform] || p > last[r.platform])) last[r.platform] = p;
  }
  const taken = new Set();
  const out = [];
  const candidates = rows
    .filter((r) => r.status === 'Approved' || r.status === 'Manual - Confirmed')
    .filter((r) => !cfg.only_post_key || r.post_key === cfg.only_post_key)
    .filter((r) => testMode || isTrue(ENABLED[r.platform]))
    .filter((r) => { const s = parse(r.scheduled_at); return !s || !s.isValid || s <= now; })
    .sort((a, b) => String(a.scheduled_at || a.created_at).localeCompare(String(b.scheduled_at || b.created_at)));
  for (const r of candidates) {
    let action;
    if (r.status === 'Manual - Confirmed') action = 'confirm_manual';
    else if (r.platform_post_id) action = 'already_posted';
    else if (r.platform === 'Facebook Groups') action = 'manual_handoff';
    else {
      if (!dryRun) {
        if (taken.has(r.platform)) continue;
        const gap = Number(GAP[r.platform] || 0);
        if (last[r.platform] && now.diff(last[r.platform], 'minutes').minutes < gap) continue;
        taken.add(r.platform);
      }
      action = 'publish';
    }
    out.push({ json: { ...r, action } });
  }
  return out;
}, 'lọc nhiều điều kiện (trạng thái, giờ hẹn, khoảng cách theo nền tảng) trên toàn bộ dòng.');
isTrue('[6 Publish] Write to Sheet? (claim)', at('6 Publish', 2, 2), `={{ !${IS_TEST} }}`);
sheets('[6 Publish] Claim posts', at('6 Publish', 3, 1), sheetWrite('update', 'Posts', {
  post_key: '={{ $json.post_key }}', status: 'Publishing', execution_id: "={{ 'exec-' + $execution.id }}",
}, ['post_key']));
node('[6 Publish] One at a time', 'n8n-nodes-base.splitInBatches', 3, at('6 Publish', 4, 2), { batchSize: 1, options: {} });
setNode('[6 Publish] Build request', at('6 Publish', 5, 3), {
  request: [`={{ { post: $('[6 Publish] Pick due posts').item.json, config: { ...${CFG}, dry_run: ${IS_TEST} ? true : ${CFG}.dry_run } } }}`, 'object'],
});
node('[6 Publish] Random wait', 'n8n-nodes-base.wait', 1.1, at('6 Publish', 6, 3), {
  resume: 'timeInterval',
  amount: '={{ $json.request.config.dry_run ? 1 : Math.max(1, Math.floor(Math.random() * Number($json.request.config.random_wait_max_seconds || 1))) }}',
  unit: 'seconds',
}, { webhookId: uuid('single-publish-random-wait') });
codeNode('[6 Publish] Precheck', at('6 Publish', 7, 3), function () {
  // Kiểm tra độ dài theo tài liệu từng nền tảng và chọn nhánh xử lý.
  const { post, config } = $input.first().json.request;
  const LIMIT = { LinkedIn: 3000, Threads: 500, 'Facebook Page': 63206, 'Facebook Groups': 63206 };
  const ROUTE = { LinkedIn: 'linkedin', Threads: 'threads', 'Facebook Page': 'facebook_page', 'Facebook Groups': 'facebook_groups' };
  const text = String(post.post_text || '').trim();
  // Threads tính emoji theo số byte UTF-8 (tài liệu Threads API)
  const enc = new TextEncoder();
  const threadsLength = (s) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? enc.encode(ch).length : 1), 0);
  const length = post.platform === 'Threads' ? threadsLength(text) : [...text].length;
  const isTrue = (v) => v === true || String(v) === 'true';
  let route = ROUTE[post.platform];
  let reason = '';
  if (!route) { route = 'invalid'; reason = `Nền tảng không hỗ trợ: ${post.platform}`; }
  else if (post.action === 'confirm_manual') route = 'confirm_manual';
  else if (post.action === 'already_posted') route = 'already_posted';
  else if (!text) { route = 'invalid'; reason = 'Bài rỗng'; }
  else if (length > LIMIT[post.platform]) { route = 'invalid'; reason = `Vượt giới hạn ${LIMIT[post.platform]} ký tự của ${post.platform} (hiện ${length})`; }
  else if (isTrue(config.dry_run)) route = 'dry_run';
  const needsPosterBinary = ['linkedin', 'facebook_page'].includes(route) && !!post.poster_file_id;
  return [{ json: { post, config, text, length, route, reason, needs_poster_binary: needsPosterBinary } }];
}, 'đếm độ dài theo quy tắc riêng của Threads (emoji theo byte) và chọn route.');
isTrue('[6 Publish] Needs poster file?', at('6 Publish', 8, 3), '={{ $json.needs_poster_binary }}');
node('[6 Publish] Download poster', 'n8n-nodes-base.googleDrive', 3, at('6 Publish', 9, 2), {
  operation: 'download', fileId: { __rl: true, mode: 'id', value: `={{ ${PRE}.post.poster_file_id }}` }, options: {},
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
const ROUTES = ['dry_run', 'linkedin', 'threads', 'facebook_page', 'facebook_groups', 'confirm_manual', 'already_posted', 'invalid'];
node('[6 Publish] Route by platform', 'n8n-nodes-base.switch', 3.2, at('6 Publish', 10, 3), {
  rules: {
    values: ROUTES.map((key) => ({
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [cond(`route:${key}`, `={{ ${PRE}.route }}`, { type: 'string', operation: 'equals' }, key)],
        combinator: 'and',
      },
      renameOutput: true,
      outputKey: key,
    })),
  },
  options: {},
});
const NOW = `={{ ${NOW_VN} }}`;
const result = (name, pos, f) => setNode(name, pos, {
  post_key: `={{ ${PRE}.post.post_key }}`,
  platform: `={{ ${PRE}.post.platform }}`,
  status: f.status,
  platform_post_id: f.platform_post_id ?? `={{ ${PRE}.post.platform_post_id || '' }}`,
  post_url: f.post_url ?? `={{ ${PRE}.post.post_url || '' }}`,
  published_at: f.published_at ?? `={{ ${PRE}.post.published_at || '' }}`,
  error_message: f.error_message ?? '',
  retry_count: [`={{ Number(${PRE}.post.retry_count || 0) }}`, 'number'],
  scheduled_at: `={{ ${PRE}.post.scheduled_at || '' }}`,
  publish_log: f.publish_log ?? '',
  alert: [f.alert ?? false, 'boolean'],
  alert_text: f.alert_text ?? '',
}, false, { executeOnce: true });

// dry_run
codeNode('[6 Publish] Dry run log', at('6 Publish', 11, 0), function () {
  // Không gọi API: ghi lại chính xác các lời gọi SẼ thực hiện + nội dung bài.
  const { post, config, text, length } = $('[6 Publish] Precheck').first().json;
  const hasPoster = !!post.poster_file_id;
  const mode = config.threads_image_mode;
  const img = mode === 'text_only' || !hasPoster ? 'TEXT' : 'IMAGE';
  const steps = {
    LinkedIn: [
      hasPoster ? `POST https://api.linkedin.com/rest/images?action=initializeUpload (owner urn:li:person:${config.linkedin_person_id}) → PUT ảnh poster` : 'Không có poster → bài chỉ có chữ',
      `POST https://api.linkedin.com/rest/posts (Linkedin-Version 202604, author urn:li:person:${config.linkedin_person_id}, visibility PUBLIC)`,
    ],
    Threads: [
      `POST ${config.threads_api_base}/${config.threads_user_id}/threads (media_type=${img}${img === 'IMAGE' ? `, image_url theo chế độ ${mode}` : ''})`,
      `Chờ ${config.threads_wait_seconds}s để Threads xử lý container`,
      `POST ${config.threads_api_base}/${config.threads_user_id}/threads_publish (creation_id=<id container>)`,
    ],
    'Facebook Page': [
      hasPoster
        ? `POST https://graph.facebook.com/${config.facebook_graph_version}/${config.facebook_page_id}/photos (multipart source=poster, caption=nội dung)`
        : `POST https://graph.facebook.com/${config.facebook_graph_version}/${config.facebook_page_id}/feed (message=nội dung)`,
    ],
    'Facebook Groups': [
      'KHÔNG gọi API (Meta đã gỡ Groups API từ 22/04/2024).',
      `Gửi bài + poster + link nhóm tới người phụ trách qua: ${config.notify_channel === 'telegram' ? 'Telegram' : '(chưa cấu hình kênh — chỉ ghi Sheet)'}`,
      'Trạng thái sẽ là "Manual - Waiting"; người phụ trách đổi sang "Manual - Confirmed" sau khi đăng tay.',
    ],
  }[post.platform] || ['(không rõ nền tảng)'];
  const log = [
    `[DRY_RUN] ${post.platform} · ${post.post_key} · ${$now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss')}`,
    `Độ dài: ${length} ký tự · Poster: ${post.poster_url || '(không có)'}`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '--- Nội dung sẽ đăng ---',
    text,
  ].join('\n');
  const result = {
    post_key: post.post_key, platform: post.platform, status: 'Dry Run',
    platform_post_id: '', post_url: '', published_at: '', error_message: '',
    retry_count: Number(post.retry_count || 0), scheduled_at: post.scheduled_at || '',
    publish_log: log, alert: false, alert_text: '',
  };
  return [{ json: result }];
}, 'dựng log nhiều dòng mô tả lời gọi API theo từng nền tảng mà không gọi API thật.');

// LinkedIn
node('[6 Publish] LinkedIn create post', 'n8n-nodes-base.linkedIn', 1, at('6 Publish', 11, 1), {
  postAs: 'person',
  person: `={{ ${PRE}.config.linkedin_person_id }}`,
  text: `={{ ${PRE}.text }}`,
  shareMediaCategory: "={{ $binary?.data ? 'IMAGE' : 'NONE' }}",
  binaryPropertyName: 'data',
  additionalFields: { visibility: 'PUBLIC' },
}, { onError: 'continueErrorOutput' });
result('[6 Publish] Result · LinkedIn', at('6 Publish', 12, 1), {
  status: 'Published',
  platform_post_id: '={{ $json.urn }}',
  post_url: "={{ 'https://www.linkedin.com/feed/update/' + $json.urn + '/' }}",
  published_at: NOW,
  publish_log: '={{ "LinkedIn OK: " + $json.urn }}',
});

// Threads
const THREADS = (path) => `={{ ${PRE}.config.threads_api_base }}/{{ ${PRE}.config.threads_user_id }}/${path}`;
const threadsHttp = (name, pos, url, jsonQuery) => node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
  method: 'POST', url,
  authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
  sendQuery: true, specifyQuery: 'json', jsonQuery,
  options: {},
}, { onError: 'continueErrorOutput' });
setNode('[6 Publish] Threads image URL', at('6 Publish', 11, 2), {
  image_url: `={{ (c => { const id = ${PRE}.post.poster_file_id; if (!id || c.threads_image_mode === 'text_only') return ''; if (c.threads_image_mode === 'url_template') return String(c.threads_image_url_template || '').replace('{file_id}', id); return 'https://drive.google.com/uc?export=download&id=' + id; })(${PRE}.config) }}`,
  needs_share: [`={{ ${PRE}.config.threads_image_mode === 'drive_public' && !!${PRE}.post.poster_file_id }}`, 'boolean'],
});
isTrue('[6 Publish] Share poster for Threads?', at('6 Publish', 12, 2), '={{ $json.needs_share }}');
node('[6 Publish] Share poster (Threads)', 'n8n-nodes-base.googleDrive', 3, at('6 Publish', 13, 2.6), {
  operation: 'share',
  fileId: { __rl: true, mode: 'id', value: `={{ ${PRE}.post.poster_file_id }}` },
  permissionsUi: { permissionsValues: { role: 'reader', type: 'anyone' } },
  options: {},
}, { onError: 'continueRegularOutput' });
const IMG = "$('[6 Publish] Threads image URL').first().json.image_url";
threadsHttp('[6 Publish] Threads create container', at('6 Publish', 14, 2), THREADS('threads'),
  `={{ JSON.stringify(${IMG} ? { media_type: 'IMAGE', image_url: ${IMG}, text: ${PRE}.text } : { media_type: 'TEXT', text: ${PRE}.text }) }}`);
node('[6 Publish] Threads wait for processing', 'n8n-nodes-base.wait', 1.1, at('6 Publish', 15, 2), {
  resume: 'timeInterval', amount: `={{ Number(${PRE}.config.threads_wait_seconds || 30) }}`, unit: 'seconds',
}, { webhookId: uuid('single-threads-wait') });
threadsHttp('[6 Publish] Threads publish', at('6 Publish', 16, 2), THREADS('threads_publish'),
  "={{ JSON.stringify({ creation_id: $('[6 Publish] Threads create container').first().json.id }) }}");
node('[6 Publish] Threads get permalink', 'n8n-nodes-base.httpRequest', 4.2, at('6 Publish', 17, 2), {
  method: 'GET',
  url: `={{ ${PRE}.config.threads_api_base }}/{{ $json.id }}`,
  authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
  sendQuery: true, specifyQuery: 'keypair', queryParameters: { parameters: [{ name: 'fields', value: 'id,permalink' }] },
  options: {},
}, { onError: 'continueRegularOutput' });
result('[6 Publish] Result · Threads', at('6 Publish', 18, 2), {
  status: 'Published',
  platform_post_id: "={{ $('[6 Publish] Threads publish').first().json.id }}",
  post_url: "={{ $json.permalink ?? '' }}",
  published_at: NOW,
  publish_log: `={{ 'Threads OK (' + (${IMG} ? 'IMAGE' : 'TEXT') + '): ' + $('[6 Publish] Threads publish').first().json.id }}`,
});

// Facebook Page
const FB = (edge) => `=https://graph.facebook.com/{{ ${PRE}.config.facebook_graph_version }}/{{ ${PRE}.config.facebook_page_id }}/${edge}`;
isTrue('[6 Publish] Facebook has image?', at('6 Publish', 11, 3.4), '={{ Boolean($binary?.data) }}');
node('[6 Publish] Facebook post photo', 'n8n-nodes-base.httpRequest', 4.2, at('6 Publish', 12, 3.2), {
  method: 'POST', url: FB('photos'),
  authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
  sendBody: true, contentType: 'multipart-form-data',
  bodyParameters: {
    parameters: [
      { parameterType: 'formBinaryData', name: 'source', inputDataFieldName: 'data' },
      { name: 'caption', value: `={{ ${PRE}.text }}` },
      { name: 'published', value: 'true' },
    ],
  },
  options: {},
}, { onError: 'continueErrorOutput' });
node('[6 Publish] Facebook post text', 'n8n-nodes-base.httpRequest', 4.2, at('6 Publish', 12, 4), {
  method: 'POST', url: FB('feed'),
  authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
  sendBody: true, contentType: 'form-urlencoded',
  bodyParameters: { parameters: [{ name: 'message', value: `={{ ${PRE}.text }}` }] },
  options: {},
}, { onError: 'continueErrorOutput' });
result('[6 Publish] Result · Facebook Page', at('6 Publish', 13, 3.6), {
  status: 'Published',
  platform_post_id: '={{ $json.post_id ?? $json.id }}',
  post_url: "={{ 'https://www.facebook.com/' + ($json.post_id ?? $json.id) }}",
  published_at: NOW,
  publish_log: '={{ "Facebook Page OK: " + ($json.post_id ?? $json.id) }}',
});

// Facebook Groups + các route không gọi API
result('[6 Publish] Groups manual handoff', at('6 Publish', 11, 4.8), {
  status: 'Manual - Waiting',
  publish_log: `={{ 'Chờ đăng tay vào các nhóm:\\n' + (${PRE}.config.facebook_group_links || '(chưa cấu hình facebook_group_links)') + '\\nPoster: ' + (${PRE}.post.poster_url || '(không có)') }}`,
  alert: true,
  alert_text: `={{ '📝 Cần ĐĂNG TAY Facebook Groups (' + ${PRE}.post.post_key + ')\\nNhóm: ' + (${PRE}.config.facebook_group_links || '(chưa cấu hình)') + '\\nPoster: ' + (${PRE}.post.poster_url || '(không có)') + '\\n\\nNội dung:\\n' + ${PRE}.text + '\\n\\nĐăng xong: đổi status dòng này trong tab Posts thành "Manual - Confirmed" (có thể dán link bài vào post_url).' }}`,
});
result('[6 Publish] Result · Manual confirmed', at('6 Publish', 11, 5.8), {
  status: 'Published (manual)',
  published_at: `={{ ${PRE}.post.published_at || ${NOW_VN} }}`,
  publish_log: 'Người phụ trách xác nhận đã đăng tay',
});
result('[6 Publish] Result · Already posted', at('6 Publish', 11, 6.8), {
  status: 'Published',
  publish_log: 'Bỏ qua: dòng đã có platform_post_id (chống đăng trùng)',
});
result('[6 Publish] Result · Invalid', at('6 Publish', 11, 7.8), {
  status: 'Failed',
  error_message: `={{ ${PRE}.reason }}`,
  alert: true,
  alert_text: `={{ '❌ Không đăng ' + ${PRE}.post.platform + ' (' + ${PRE}.post.post_key + '): ' + ${PRE}.reason }}`,
});

codeNode('[6 Publish] Classify API error', at('6 Publish', 15, 4.5), function () {
  // 429/409/5xx/mạng → hẹn lại có backoff (status Approved + scheduled_at); 401/403/4xx → Failed + cảnh báo; che token.
  const { post, config } = $('[6 Publish] Precheck').first().json;
  const raw = $input.first().json;
  const err = raw.error ?? raw;
  const msg = typeof err === 'string' ? err : (err.message || JSON.stringify(err));
  const desc = typeof err === 'object' ? (err.description || '') : '';
  const code = Number(err.httpCode || err.status || err.statusCode || (`${msg} ${desc}`.match(/\b([45]\d\d)\b/) || [])[1] || 0);
  const sanitize = (s) => String(s)
    .replace(/(access_token|token|key|secret|password|client_secret)=([^&\s"']+)/gi, '$1=***')
    .replace(/Bearer\s+[\w.~+/-]+=*/gi, 'Bearer ***')
    .slice(0, 500);
  const reason = sanitize(desc ? `${msg} — ${desc}` : msg);
  const authError = code === 401 || code === 403 || /credential|permission|oauth/i.test(msg);
  const retryable = !authError && (code === 429 || code === 409 || code >= 500 || code === 0);
  const retryCount = Number(post.retry_count || 0);
  const max = Number(config.max_publish_retries ?? 2);
  const base = { post_key: post.post_key, platform: post.platform, platform_post_id: '', post_url: '', published_at: '', publish_log: '' };
  if (retryable && retryCount < max) {
    const minutes = Number(config.retry_backoff_minutes || 15) * 2 ** retryCount;
    const retry = {
      ...base, status: 'Approved', retry_count: retryCount + 1,
      scheduled_at: $now.setZone('Asia/Ho_Chi_Minh').plus({ minutes }).toFormat('yyyy-MM-dd HH:mm:ss'),
      error_message: `Lỗi tạm thời (HTTP ${code || 'mạng'}), sẽ thử lại lần ${retryCount + 1}/${max} sau ${minutes} phút: ${reason}`,
      alert: false, alert_text: '',
    };
    return [{ json: retry }];
  }
  const hint = authError
    ? 'Token hết hạn hoặc thiếu quyền — kiểm tra credential và quyền của app. Không thử lại.'
    : (retryable ? `Đã thử lại ${retryCount}/${max} lần.` : 'Lỗi dữ liệu/cấu hình — không thử lại.');
  const failed = {
    ...base, status: 'Failed', retry_count: retryCount, scheduled_at: post.scheduled_at || '',
    error_message: `HTTP ${code || '?'}: ${reason}. ${hint}`,
    alert: true, alert_text: `❌ Đăng ${post.platform} thất bại (${post.post_key}) — HTTP ${code || '?'}. ${hint}`,
  };
  return [{ json: failed }];
}, 'phân loại mã lỗi HTTP từ nhiều node khác nhau và tính lịch thử lại có backoff.');

notifyEnabled('[6 Publish] Alert needed?', at('6 Publish', 19, 3), '={{ $json.alert === true }}');
telegram('[6 Publish] Send alert', at('6 Publish', 20, 2), '={{ $json.alert_text }}');
codeNode('[6 Publish] Collect result', at('6 Publish', 21, 3), function () {
  // Lấy lại item kết quả chuẩn (bỏ output của Telegram nếu có).
  const r = $('[6 Publish] Alert needed?').first().json;
  return [{ json: r }];
}, 'khôi phục item kết quả sau nhánh gửi Telegram.');
isTrue('[6 Publish] Write to Sheet? (result)', at('6 Publish', 22, 3), `={{ !${IS_TEST} }}`);
const RESULT_COLS = ['post_key', 'status', 'platform_post_id', 'post_url', 'published_at', 'error_message', 'retry_count', 'scheduled_at', 'publish_log'];
sheets('[6 Publish] Save result', at('6 Publish', 23, 2), sheetWrite('update', 'Posts', Object.fromEntries(RESULT_COLS.map((c) => [c, `={{ $json.${c} }}`])), ['post_key']));

// Sau vòng lặp
isTrue('[6 Publish] Write to Sheet? (JD)', at('6 Publish', 5, 0.6), `={{ !${IS_TEST} }}`);
sheets('[6 Publish] Read posts after', at('6 Publish', 6, 0), sheetRead('Posts'), { alwaysOutputData: true, executeOnce: true });
codeNode('[6 Publish] Compute JD status', at('6 Publish', 7, 0), function () {
  // JD = Published khi mọi nền tảng đã đăng; Partially Published khi mới đăng một phần.
  const touched = new Set($('[6 Publish] Pick due posts').all().map((i) => i.json.jd_id));
  const rows = $input.all().map((i) => i.json).filter((r) => touched.has(r.jd_id));
  const DONE = ['Published', 'Published (manual)'];
  const byJd = {};
  for (const r of rows) (byJd[r.jd_id] ??= []).push(r);
  return Object.entries(byJd).flatMap(([jd_id, list]) => {
    const done = list.filter((r) => DONE.includes(r.status)).length;
    if (!done) return [];
    return [{ json: { jd_id, status: done === list.length ? 'Published' : 'Partially Published', step: `publish ${done}/${list.length}` } }];
  });
}, 'gom nhóm dòng Posts theo jd_id để tính trạng thái tổng hợp.');
sheets('[6 Publish] Update JD status', at('6 Publish', 8, 0), sheetWrite('update', 'JD', {
  jd_id: '={{ $json.jd_id }}', status: '={{ $json.status }}', step: '={{ $json.step }}',
}, ['jd_id']));
codeNode('[6 Publish] Test summary', at('6 Publish', 6, 1.1), function () {
  // Báo cáo chế độ test_dry_run: trạng thái + log của từng nền tảng.
  const results = $input.all().map((i) => i.json);
  const summary = { total: results.length, statuses: results.map((r) => `${r.platform}: ${r.status}`), logs: results.map((r) => r.publish_log) };
  return [{ json: summary }];
}, 'gộp kết quả vòng lặp thành 1 báo cáo.');

link('[0 Setup] Route by entry', '[6 Publish] Read posts', 1);
link('[0 Setup] Route by entry', '[6 Publish] Sample approved posts', 2);
link('[6 Publish] Read posts', '[6 Publish] Pick due posts');
link('[6 Publish] Sample approved posts', '[6 Publish] Pick due posts');
link('[6 Publish] Pick due posts', '[6 Publish] Write to Sheet? (claim)');
link('[6 Publish] Write to Sheet? (claim)', '[6 Publish] Claim posts', 0);
link('[6 Publish] Write to Sheet? (claim)', '[6 Publish] One at a time', 1);
link('[6 Publish] Claim posts', '[6 Publish] One at a time');
link('[6 Publish] One at a time', '[6 Publish] Write to Sheet? (JD)', 0);
link('[6 Publish] One at a time', '[6 Publish] Build request', 1);
chain('[6 Publish] Build request', '[6 Publish] Random wait', '[6 Publish] Precheck', '[6 Publish] Needs poster file?');
link('[6 Publish] Needs poster file?', '[6 Publish] Download poster', 0);
link('[6 Publish] Needs poster file?', '[6 Publish] Route by platform', 1);
link('[6 Publish] Download poster', '[6 Publish] Route by platform');
const OUTS = {
  dry_run: '[6 Publish] Dry run log', linkedin: '[6 Publish] LinkedIn create post', threads: '[6 Publish] Threads image URL',
  facebook_page: '[6 Publish] Facebook has image?', facebook_groups: '[6 Publish] Groups manual handoff',
  confirm_manual: '[6 Publish] Result · Manual confirmed', already_posted: '[6 Publish] Result · Already posted', invalid: '[6 Publish] Result · Invalid',
};
ROUTES.forEach((r, i) => link('[6 Publish] Route by platform', OUTS[r], i));
link('[6 Publish] LinkedIn create post', '[6 Publish] Result · LinkedIn', 0);
link('[6 Publish] LinkedIn create post', '[6 Publish] Classify API error', 1);
link('[6 Publish] Threads image URL', '[6 Publish] Share poster for Threads?');
link('[6 Publish] Share poster for Threads?', '[6 Publish] Share poster (Threads)', 0);
link('[6 Publish] Share poster for Threads?', '[6 Publish] Threads create container', 1);
link('[6 Publish] Share poster (Threads)', '[6 Publish] Threads create container');
link('[6 Publish] Threads create container', '[6 Publish] Threads wait for processing', 0);
link('[6 Publish] Threads create container', '[6 Publish] Classify API error', 1);
link('[6 Publish] Threads wait for processing', '[6 Publish] Threads publish');
link('[6 Publish] Threads publish', '[6 Publish] Threads get permalink', 0);
link('[6 Publish] Threads publish', '[6 Publish] Classify API error', 1);
link('[6 Publish] Threads get permalink', '[6 Publish] Result · Threads');
link('[6 Publish] Facebook has image?', '[6 Publish] Facebook post photo', 0);
link('[6 Publish] Facebook has image?', '[6 Publish] Facebook post text', 1);
link('[6 Publish] Facebook post photo', '[6 Publish] Result · Facebook Page', 0);
link('[6 Publish] Facebook post photo', '[6 Publish] Classify API error', 1);
link('[6 Publish] Facebook post text', '[6 Publish] Result · Facebook Page', 0);
link('[6 Publish] Facebook post text', '[6 Publish] Classify API error', 1);
for (const n of ['[6 Publish] Dry run log', '[6 Publish] Result · LinkedIn', '[6 Publish] Result · Threads', '[6 Publish] Result · Facebook Page',
  '[6 Publish] Groups manual handoff', '[6 Publish] Result · Manual confirmed', '[6 Publish] Result · Already posted', '[6 Publish] Result · Invalid',
  '[6 Publish] Classify API error']) {
  link(n, '[6 Publish] Alert needed?');
}
link('[6 Publish] Alert needed?', '[6 Publish] Send alert', 0);
link('[6 Publish] Alert needed?', '[6 Publish] Collect result', 1);
link('[6 Publish] Send alert', '[6 Publish] Collect result');
link('[6 Publish] Collect result', '[6 Publish] Write to Sheet? (result)');
link('[6 Publish] Write to Sheet? (result)', '[6 Publish] Save result', 0);
link('[6 Publish] Write to Sheet? (result)', '[6 Publish] One at a time', 1);
link('[6 Publish] Save result', '[6 Publish] One at a time');
link('[6 Publish] Write to Sheet? (JD)', '[6 Publish] Read posts after', 0);
link('[6 Publish] Write to Sheet? (JD)', '[6 Publish] Test summary', 1);
chain('[6 Publish] Read posts after', '[6 Publish] Compute JD status', '[6 Publish] Update JD status');

// =====================================================================
// 7 · Token
// =====================================================================
sheets('[7 Token] Read token dates', at('7 Token', 0, 2), sheetRead('Tokens'), { alwaysOutputData: true, executeOnce: true, onError: 'continueRegularOutput' });
const check = (name, pos, url, auth) => node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
  method: 'GET', url, ...auth, options: { response: { response: { fullResponse: true, neverError: true } } },
}, { onError: 'continueRegularOutput', executeOnce: true, alwaysOutputData: true });
check('[7 Token] Check LinkedIn', at('7 Token', 1, 2), 'https://api.linkedin.com/v2/userinfo', { authentication: 'predefinedCredentialType', nodeCredentialType: 'linkedInOAuth2Api' });
check('[7 Token] Check Threads', at('7 Token', 2, 2), `={{ ${CFG}.threads_api_base }}/me?fields=id,username`, { authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth' });
check('[7 Token] Check Facebook Page', at('7 Token', 3, 2), `=https://graph.facebook.com/{{ ${CFG}.facebook_graph_version }}/{{ ${CFG}.facebook_page_id }}?fields=id,name`, { authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi' });
codeNode('[7 Token] Build report', at('7 Token', 4, 2), function () {
  // Tổng hợp kết quả kiểm tra token + ngày hết hạn (tab Tokens) thành danh sách cảnh báo.
  const cfg = $('[0 Setup] Config').first().json;
  const zone = 'Asia/Ho_Chi_Minh';
  const now = DateTime.now().setZone(zone);
  const isTrue = (v) => v === true || String(v) === 'true';
  const tokens = $('[7 Token] Read token dates').all().map((i) => i.json).filter((r) => r.platform);
  const checks = {
    LinkedIn: [$('[7 Token] Check LinkedIn').first().json, cfg.enable_linkedin],
    Threads: [$('[7 Token] Check Threads').first().json, cfg.enable_threads],
    'Facebook Page': [$('[7 Token] Check Facebook Page').first().json, cfg.enable_facebook_page],
  };
  const alerts = [];
  let threadsDaysLeft = null;
  let threadsOk = false;
  for (const [platform, [res, enabled]] of Object.entries(checks)) {
    if (!isTrue(enabled)) continue;
    const code = res.statusCode ?? (res.error ? 0 : 200);
    if (code === 200 && platform === 'Threads') threadsOk = true;
    if (code !== 200) alerts.push(`❌ ${platform}: kiểm tra token thất bại (HTTP ${code || 'lỗi/thiếu credential'}).`);
    const row = tokens.find((t) => t.platform === platform);
    if (row?.expires_at) {
      let exp = DateTime.fromSQL(String(row.expires_at), { zone });
      if (!exp.isValid) exp = DateTime.fromISO(String(row.expires_at), { zone });
      if (exp.isValid) {
        const days = Math.floor(exp.diff(now, 'days').days);
        if (platform === 'Threads') threadsDaysLeft = days;
        if (days <= Number(cfg.token_warn_days || 7)) alerts.push(`⚠️ ${platform}: token hết hạn sau ${days} ngày (${row.expires_at}).`);
      }
    } else if (platform !== 'Facebook Page') {
      alerts.push(`ℹ️ ${platform}: chưa có expires_at trong tab Tokens — không cảnh báo trước được.`);
    }
  }
  const refreshThreads = isTrue(cfg.enable_threads) && threadsOk && threadsDaysLeft !== null && threadsDaysLeft <= Number(cfg.threads_refresh_before_days || 15);
  return [{ json: { alerts, alert_text: alerts.join('\n'), has_alerts: alerts.length > 0, refresh_threads: refreshThreads, threads_days_left: threadsDaysLeft } }];
}, 'gộp 3 kết quả kiểm tra và ngày hết hạn để quyết định cảnh báo/làm mới.');
isTrue('[7 Token] Refresh Threads?', at('7 Token', 5, 1), '={{ $json.refresh_threads }}');
node('[7 Token] Refresh Threads token', 'n8n-nodes-base.httpRequest', 4.2, at('7 Token', 6, 0.5), {
  method: 'GET', url: 'https://graph.threads.com/refresh_access_token',
  authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
  sendQuery: true, specifyQuery: 'keypair', queryParameters: { parameters: [{ name: 'grant_type', value: 'th_refresh_token' }] },
  options: {},
}, { onError: 'continueErrorOutput' });
node('[7 Token] Save Threads token to n8n', 'n8n-nodes-base.httpRequest', 4.2, at('7 Token', 7, 0.5), {
  method: 'PATCH',
  url: `={{ ${CFG}.n8n_internal_url }}/api/v1/credentials/{{ ${CFG}.threads_credential_id }}`,
  authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendBody: true, specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ data: { name: 'access_token', value: $json.access_token } }) }}",
  options: {},
}, { onError: 'continueErrorOutput' });
sheets('[7 Token] Record Threads expiry', at('7 Token', 8, 0.5), sheetWrite('appendOrUpdate', 'Tokens', {
  platform: 'Threads',
  expires_at: "={{ $now.setZone('Asia/Ho_Chi_Minh').plus({ seconds: Number($('[7 Token] Refresh Threads token').first().json.expires_in || 0) }).toFormat('yyyy-MM-dd HH:mm:ss') }}",
  last_refreshed: `={{ ${NOW_VN} }}`,
  note: 'Tự làm mới bởi [7 Token]',
}, ['platform']));
setNode('[7 Token] Refresh failed', at('7 Token', 8, 1.6), {
  alert_text: "={{ '❌ Làm mới token Threads thất bại ở ' + $prevNode.name + ': ' + String($json.error?.message ?? $json.error ?? '').replace(/access_token=[^&\\s]+/gi, 'access_token=***').slice(0, 300) + '. Làm mới thủ công theo README.' }}",
  has_alerts: [true, 'boolean'],
});
notifyEnabled('[7 Token] Any alerts?', at('7 Token', 5, 3), '={{ $json.has_alerts }}');
telegram('[7 Token] Send alerts', at('7 Token', 6, 3), '=🔑 Kiểm tra token đăng bài\n{{ $json.alert_text }}');
link('[0 Setup] Route by entry', '[7 Token] Read token dates', 3);
chain('[7 Token] Read token dates', '[7 Token] Check LinkedIn', '[7 Token] Check Threads', '[7 Token] Check Facebook Page', '[7 Token] Build report');
link('[7 Token] Build report', '[7 Token] Refresh Threads?');
link('[7 Token] Build report', '[7 Token] Any alerts?');
link('[7 Token] Refresh Threads?', '[7 Token] Refresh Threads token', 0);
link('[7 Token] Refresh Threads token', '[7 Token] Save Threads token to n8n', 0);
link('[7 Token] Refresh Threads token', '[7 Token] Refresh failed', 1);
link('[7 Token] Save Threads token to n8n', '[7 Token] Record Threads expiry', 0);
link('[7 Token] Save Threads token to n8n', '[7 Token] Refresh failed', 1);
link('[7 Token] Refresh failed', '[7 Token] Any alerts?');
link('[7 Token] Any alerts?', '[7 Token] Send alerts', 0);

// =====================================================================
// 8 · Error
// =====================================================================
setNode('[8 Error] Sanitize error', at('8 Error', 0, 2), {
  error_text: "={{ String($json.execution?.error?.message ?? 'Lỗi không xác định').replace(/(access_token|token|key|secret|password|client_secret)=([^&\\s\"']+)/gi, '$1=***').replace(/Bearer\\s+[\\w.~+\\/-]+=*/gi, 'Bearer ***').slice(0, 500) }}",
  failed_node: "={{ $json.execution?.lastNodeExecuted ?? 'không rõ' }}",
  exec_ref: "={{ 'exec-' + ($json.execution?.id ?? 'none') }}",
  execution_url: "={{ $json.execution?.url ?? '' }}",
}, true);
const S = "$('[8 Error] Sanitize error').first().json";
sheets('[8 Error] Find JD by execution', at('8 Error', 1, 1), sheetRead('JD', [{ lookupColumn: 'execution_id', lookupValue: '={{ $json.exec_ref }}' }]));
sheets('[8 Error] Mark JD error', at('8 Error', 2, 1), sheetWrite('update', 'JD', {
  jd_id: '={{ $json.jd_id }}', status: 'Error',
  error_message: `={{ ${S}.error_text + ' | Node lỗi: ' + ${S}.failed_node }}`,
}, ['jd_id']));
sheets('[8 Error] Find publishing posts', at('8 Error', 1, 2.5), sheetRead('Posts', [
  { lookupColumn: 'execution_id', lookupValue: '={{ $json.exec_ref }}' },
  { lookupColumn: 'status', lookupValue: 'Publishing' },
]));
sheets('[8 Error] Mark posts failed', at('8 Error', 2, 2.5), sheetWrite('update', 'Posts', {
  post_key: '={{ $json.post_key }}', status: 'Failed',
  error_message: `={{ 'Workflow lỗi: ' + ${S}.error_text + ' | Node lỗi: ' + ${S}.failed_node }}`,
}, ['post_key']));
notifyEnabled('[8 Error] Should notify?', at('8 Error', 1, 4));
telegram('[8 Error] Notify via Telegram', at('8 Error', 2, 4),
  '=🚨 [dev] jd-tuyen-dung-da-nen-tang lỗi\nNode: {{ $json.failed_node }}\nLý do: {{ $json.error_text }}\n{{ $json.execution_url }}');
link('[0 Setup] Route by entry', '[8 Error] Sanitize error', 4);
link('[8 Error] Sanitize error', '[8 Error] Find JD by execution');
link('[8 Error] Sanitize error', '[8 Error] Find publishing posts');
link('[8 Error] Sanitize error', '[8 Error] Should notify?');
link('[8 Error] Find JD by execution', '[8 Error] Mark JD error');
link('[8 Error] Find publishing posts', '[8 Error] Mark posts failed');
link('[8 Error] Should notify?', '[8 Error] Notify via Telegram', 0);

// ---------- Sticky tự bao quanh node của từng section ----------
const NODE_W = 120;
const NODE_H = 110;
const stickies = [];
for (const [key, s] of Object.entries(SECTIONS)) {
  const members = nodes.filter((n) => n.name.startsWith(`[${key}]`));
  if (!members.length) continue;
  const xs = members.map((n) => n.position[0]);
  const ys = members.map((n) => n.position[1]);
  const x = Math.min(...xs) - 60;
  const y = Math.min(...ys) - 170;
  const width = Math.max(...xs) + NODE_W + 60 - x;
  const height = Math.max(...ys) + NODE_H + 80 - y;
  stickies.push({
    parameters: { content: `## ${s.title}\n${s.info}`, height, width, color: s.color },
    type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [x, y], id: uuid(`sticky:${key}`), name: `Khung ${s.title}`,
  });
}

const workflow = {
  id: WORKFLOW_ID,
  name: WORKFLOW_NAME,
  active: false,
  nodes: [...stickies, ...nodes],
  connections,
  settings: {
    executionOrder: 'v1',
    errorWorkflow: WORKFLOW_ID,
    timezone: 'Asia/Ho_Chi_Minh',
    saveManualExecutions: true,
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};
const out = join(ROOT, 'jd-automation.v4.json');
writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Đã ghi ${out}: ${nodes.length} node + ${stickies.length} khung sticky`);
