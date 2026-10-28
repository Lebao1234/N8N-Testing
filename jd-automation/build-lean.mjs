// Bản GỌN (phương án B): MỘT workflow "[dev] jd-tuyen-dung-da-nen-tang" (id jdAutoPostV20001), ~24 node chính.
// Chạy: node jd-automation/build-lean.mjs  → jd-automation/jd-automation.v5.json
// Sinh kèm prompts/all-in-one.system.md và schemas/all-in-one.schema.json (ghép từ các file prompt/schema gốc).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').trim();
const prompt = (name) => read(`prompts/${name}.system.md`);
const schemaObj = (name) => JSON.parse(read(`schemas/${name}.schema.json`));

const WORKFLOW_ID = 'jdAutoPostV20001';
const WORKFLOW_NAME = '[dev] jd-tuyen-dung-da-nen-tang';
const CRED = {
  basicAuth: { httpBasicAuth: { id: 'CLtFsk0dNV90Z52V', name: 'Unnamed credential' } },
  anthropic: { anthropicApi: { id: 'anthropicLocal01', name: 'Anthropic (from .env)' } },
  openAi: { openAiApi: { id: 'openAiLocal00001', name: 'OpenAI (from .env)' } },
};
const RETRY2 = { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 };
const NOW_VN = "$now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss')";
const CFG = "$('[0] Config').first().json";
const AI = "$('[1] AI Analyze & Write').first().json.output";

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

// ---------- Prompt + schema gộp (1 lần gọi Claude) ----------
const SYSTEM_PROMPT = [
  '# NHIỆM VỤ',
  'Bạn nhận một JD tuyển dụng và trả về MỘT đối tượng JSON gồm 3 phần: `analysis` (phân tích JD), `posts` (4 bài đăng) và `poster` (prompt ảnh nền). Làm theo đúng các quy tắc từng phần dưới đây.',
  '',
  '# PHẦN 1 — analysis',
  prompt('jd-analyzer'),
  '',
  '# PHẦN 2 — posts (4 bài phải KHÁC nhau về cấu trúc và giọng; lương/liên hệ nhất quán với analysis)',
  '## posts.linkedin', prompt('linkedin-writer'),
  '## posts.threads', prompt('threads-writer'),
  '## posts.facebook_groups', prompt('facebook-groups-writer'),
  '## posts.facebook_page', prompt('facebook-page-writer'),
  read('prompts/_shared-writer-rules.md'),
  '',
  '# PHẦN 3 — poster',
  prompt('image-prompt-builder'),
  '- Choose the visual style from the industry: tech = modern minimalist (navy/cyan), F&B = warm and cozy (brown/orange), finance = luxurious (navy/gold), retail = vibrant, manufacturing = industrial, education = bright, healthcare = clean (blue/teal), marketing = bold creative, logistics = dynamic, real estate = premium; otherwise clean corporate.',
  '- `accent_color`: a bright hex color (#RRGGBB) from that palette, readable on a dark background. `panel_color`: a very dark hex color (#RRGGBB) from that palette for the text band.',
].join('\n');
const post = schemaObj('platform-post');
const SCHEMA = {
  type: 'object',
  properties: {
    analysis: schemaObj('jd-analysis'),
    posts: {
      type: 'object',
      properties: { linkedin: post, threads: post, facebook_groups: post, facebook_page: post },
      required: ['linkedin', 'threads', 'facebook_groups', 'facebook_page'],
    },
    poster: {
      type: 'object',
      properties: {
        image_prompt: { type: 'string' },
        negative_notes: { type: 'string' },
        accent_color: { type: 'string' },
        panel_color: { type: 'string' },
      },
      required: ['image_prompt', 'negative_notes', 'accent_color', 'panel_color'],
    },
  },
  required: ['analysis', 'posts', 'poster'],
};
writeFileSync(join(ROOT, 'prompts/all-in-one.system.md'), `<!-- SINH TỰ ĐỘNG bởi build-lean.mjs từ các file prompt khác — đừng sửa tay -->\n${SYSTEM_PROMPT}\n`);
writeFileSync(join(ROOT, 'schemas/all-in-one.schema.json'), JSON.stringify(SCHEMA, null, 2) + '\n');

// ---------- Bộ dựng ----------
const SECTIONS = {
  0: { origin: [0, 0], color: 7, title: '0 · Trigger & cấu hình', info: 'Form JD · lịch 5 phút · Error Trigger → `[0] Config` (sửa cấu hình DUY NHẤT ở đây) → `[0] Route` rẽ nhánh.' },
  1: { origin: [800, 0], color: 5, title: '1 · Tạo bài (1 lần gọi Claude)', info: '**In:** form. **Out:** `analysis` + 4 bài + prompt poster. JD → `Processing`.\n**Lỗi:** credential Anthropic, model không tồn tại.' },
  2: { origin: [1500, 0], color: 2, title: '2 · Poster (lỗi thì bỏ qua poster)', info: 'Ảnh nền OpenAI → chèn chữ tiếng Việt → Drive (private).\nLỗi ở bất kỳ bước nào → sang bước 3, bài vẫn được lưu.' },
  3: { origin: [2300, 0], color: 6, title: '3 · Kiểm tra & lưu', info: '4 dòng Posts (upsert theo `post_key`): đạt → `Draft`, lỗi → `Needs Review` + lý do. JD → `Done`/`Needs Review`.' },
  4: { origin: [800, 700], color: 4, title: '4 · Đăng bài (chỉ dòng Approved)', info: '`[4] Prepare Posts` lọc dòng Approved/tới giờ/chưa có `platform_post_id`, kiểm tra độ dài, DRY_RUN, Facebook Groups → đăng tay.\nMỗi nền tảng 1 node đăng; lỗi ghi `Failed` + lý do (đã che token) vào cùng dòng.' },
  5: { origin: [0, 700], color: 3, title: '5 · Lỗi', info: 'Lỗi bất kỳ (workflow phải active) → JD `Error` + tên node lỗi.' },
};
const nodes = [];
const connections = {};
const at = (s, col, row) => [SECTIONS[s].origin[0] + col * 230, SECTIONS[s].origin[1] + 120 + row * 180];
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, type, typeVersion, position, id: uuid(name), name, ...extra });
  return name;
};
const link = (from, to, outputIndex = 0, type = 'main') => {
  connections[from] ??= {};
  connections[from][type] ??= [];
  while (connections[from][type].length <= outputIndex) connections[from][type].push([]);
  connections[from][type][outputIndex].push({ node: to, type, index: 0 });
};
const setNode = (name, pos, fields, includeOtherFields, extra = {}) => node(name, 'n8n-nodes-base.set', 3.4, pos, {
  assignments: {
    assignments: Object.entries(fields).map(([fname, v]) => {
      const [value, type] = Array.isArray(v) ? v : [v, 'string'];
      return { id: uuid(`${name}:${fname}`), name: fname, value, type };
    }),
  },
  includeOtherFields,
  options: {},
}, extra);
const code = (name, pos, fn, why, extra = {}) => node(name, 'n8n-nodes-base.code', 2, pos, { jsCode: body(fn) }, { notes: `Why Code: ${why}`, ...extra });
const colSchema = (ids) => ids.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
const DOC = { __rl: true, mode: 'id', value: `={{ ${CFG}.spreadsheet_id }}` };
const tab = (t) => ({ __rl: true, mode: 'name', value: t, cachedResultName: t });
const sheetWrite = (operation, sheetTab, values, matchingColumns = []) => ({
  operation, documentId: DOC, sheetName: tab(sheetTab),
  columns: { mappingMode: 'defineBelow', value: values, matchingColumns, schema: colSchema(Object.keys(values)), attemptToConvertTypes: false, convertFieldsToString: true },
  options: {},
});
const sheets = (name, pos, params, extra = {}) => node(name, 'n8n-nodes-base.googleSheets', 4.7, pos, params, { ...RETRY2, ...extra });
const route = (key, leftValue) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: uuid(`route:${key}:${leftValue}`), leftValue, rightValue: key, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: key,
});

// =====================================================================
// 0 · Trigger & cấu hình
// =====================================================================
node('[0] JD Form', 'n8n-nodes-base.formTrigger', 2.6, at(0, 0, 0), {
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
      values: { respondWith: 'text', formSubmittedText: '=Đã nhận JD. Mã theo dõi: jd-{{ $execution.id }} (cột jd_id trong tab JD). Bài và poster sẽ có sau khoảng 2–3 phút ở trạng thái Draft.' },
    },
  },
}, { webhookId: uuid('lean-jd-form'), credentials: CRED.basicAuth });
node('[0] Every 5 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, at(0, 0, 1), { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } });
node('[0] Error Trigger', 'n8n-nodes-base.errorTrigger', 1, at(0, 0, 2), {});
setNode('[0] Config', at(0, 1, 1), {
  entry: "={{ $('[0] JD Form').isExecuted ? 'form' : $('[0] Error Trigger').isExecuted ? 'error' : 'publish' }}",
  spreadsheet_id: 'REPLACE_WITH_SPREADSHEET_ID',
  drive_folder_id: 'REPLACE_WITH_DRIVE_FOLDER_ID',
  image_model: 'gpt-image-1',
  overlay_font: '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf',
  dry_run: [true, 'boolean'],
  enable_linkedin: [true, 'boolean'],
  enable_threads: [true, 'boolean'],
  enable_facebook_page: [true, 'boolean'],
  enable_facebook_groups: [true, 'boolean'],
  linkedin_person_id: 'REPLACE_WITH_LINKEDIN_PERSON_ID',
  facebook_page_id: 'REPLACE_WITH_FACEBOOK_PAGE_ID',
  facebook_graph_version: 'v25.0',
  threads_user_id: 'me',
  min_gap_minutes: [60, 'number'],
}, true);
node('[0] Route', 'n8n-nodes-base.switch', 3.2, at(0, 2, 1), {
  rules: { values: ['form', 'publish', 'error'].map((k) => route(k, '={{ $json.entry }}')) },
  options: {},
});
for (const t of ['[0] JD Form', '[0] Every 5 minutes', '[0] Error Trigger']) link(t, '[0] Config');
link('[0] Config', '[0] Route');

// =====================================================================
// 1 · Tạo bài
// =====================================================================
sheets('[1] Add JD Row', at(1, 0, 0), sheetWrite('append', 'JD', {
  jd_id: "={{ 'jd-' + $execution.id }}",
  created_at: `={{ ${NOW_VN} }}`,
  company: "={{ $json['Tên Công Ty'] }}",
  position: "={{ $json['Vị Trí'] }}",
  jd_detail: "={{ $json['Chi Tiết JD'] }}",
  salary: "={{ $json['Mức Lương'] }}",
  contact: "={{ $json['Liên Hệ'] }}",
  status: 'Processing',
  error_message: '', poster_url: '', warnings: '',
}));
const F = (k) => `$('[0] Config').first().json['${k}']`;
node('[1] AI Analyze & Write', '@n8n/n8n-nodes-langchain.chainLlm', 1.9, at(1, 1, 0), {
  promptType: 'define',
  text: `=Tên Công Ty: {{ ${F('Tên Công Ty')} }}\nVị Trí: {{ ${F('Vị Trí')} }}\nMức Lương (form): {{ ${F('Mức Lương')} || "(để trống)" }}\nLiên Hệ (form): {{ ${F('Liên Hệ')} || "(để trống)" }}\nChi Tiết JD:\n{{ ${F('Chi Tiết JD')} }}`,
  hasOutputParser: true,
  messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: SYSTEM_PROMPT }] },
}, RETRY2);
node('[1] Claude Sonnet', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, at(1, 0.6, 1), {
  model: { __rl: true, mode: 'id', value: 'claude-sonnet-5-5' },
  options: { temperature: 0.5, maxTokensToSample: 8192 },
}, { credentials: CRED.anthropic });
node('[1] Output Parser', '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, at(1, 1.6, 1), {
  schemaType: 'manual', inputSchema: JSON.stringify(SCHEMA, null, 2), autoFix: true,
});
link('[0] Route', '[1] Add JD Row', 0);
link('[1] Add JD Row', '[1] AI Analyze & Write');
link('[1] Claude Sonnet', '[1] AI Analyze & Write', 0, 'ai_languageModel');
link('[1] Claude Sonnet', '[1] Output Parser', 0, 'ai_languageModel');
link('[1] Output Parser', '[1] AI Analyze & Write', 0, 'ai_outputParser');

// =====================================================================
// 2 · Poster
// =====================================================================
const cut = (expr, n) => `(s => s.length <= ${n} ? s : s.slice(0, ${n}).replace(/\\s+\\S*$/, '') + '…')(String(${expr} || '').trim())`;
const notStated = (expr) => `/^\\s*(không nêu|khong neu)?\\s*$/i.test(${expr} ?? '')`;
const hex = (expr, fallback) => `(/^#[0-9a-f]{6}$/i.test(${expr} ?? '') ? ${expr} : '${fallback}')`;
node('[2] Generate Image', '@n8n/n8n-nodes-langchain.openAi', 2.3, at(2, 0, 0), {
  resource: 'image', operation: 'generate',
  modelId: { __rl: true, mode: 'id', value: `={{ ${CFG}.image_model }}` },
  prompt: `={{ ${AI}.poster.image_prompt }}\nNo text, letters or numbers. Avoid: {{ ${AI}.poster.negative_notes }}`,
  options: { size: '1024x1536', quality: 'high' },
}, { ...RETRY2, onError: 'continueErrorOutput', credentials: CRED.openAi });
const A = `${AI}.analysis`;
const textStep = (text, fontSize, fontColor, positionY, lineLength) => ({
  operation: 'text', text, fontSize, fontColor, positionX: 72, positionY, horizontalAlignment: 'left', verticalAlignment: 'top', lineLength, font: `={{ ${CFG}.overlay_font }}`,
});
const ACCENT = `={{ ${hex(`${AI}.poster.accent_color`, '#56CCF2')} }}`;
node('[2] Overlay Text', 'n8n-nodes-base.editImage', 1.1, at(2, 1, 0), {
  operation: 'multiStep',
  dataPropertyName: 'data',
  operations: {
    operations: [
      { operation: 'draw', primitive: 'rectangle', color: `={{ ${hex(`${AI}.poster.panel_color`, '#13293D')} + '26' }}`, startPositionX: 0, startPositionY: 940, endPositionX: 1024, endPositionY: 1536 },
      { operation: 'draw', primitive: 'rectangle', color: ACCENT, startPositionX: 72, startPositionY: 948, endPositionX: 232, endPositionY: 954 },
      textStep(`={{ ${cut(`${F('Tên Công Ty')}.replace(/^công ty\\s+((cổ phần|tnhh)(\\s+mtv)?\\s+)?/iu, '').toUpperCase()`, 26)} }} TUYỂN DỤNG`, 34, ACCENT, 1000, 48),
      textStep(`={{ ${cut(`${A}.job_title_chuan || ${F('Vị Trí')}`, 40)} }}`, 62, '#FFFFFF', 1065, 24),
      textStep(`={{ ${notStated(`${A}.muc_luong_chuan_hoa`)} ? ' ' : ${cut(`'Lương: ' + ${A}.muc_luong_chuan_hoa`, 40)} }}`, 44, ACCENT, 1230, 36),
      textStep(`={{ (${A}.diem_hap_dan || []).slice(0, 3).map(h => '• ' + ${cut('h', 45)}).join('\\n') || ' ' }}`, 30, '#FFFFFF', 1300, 52),
      textStep(`={{ ${notStated(`${A}.thong_tin_lien_he`)} ? ' ' : ${cut(`'Liên hệ: ' + ${A}.thong_tin_lien_he`, 52)} }}`, 32, '#FFFFFF', 1465, 52),
    ],
  },
  options: { format: 'png' },
}, { onError: 'continueErrorOutput' });
node('[2] Upload to Drive', 'n8n-nodes-base.googleDrive', 3, at(2, 2, 0), {
  inputDataFieldName: 'data',
  name: "=poster-jd-{{ $execution.id }}.png",
  driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
  folderId: { __rl: true, mode: 'id', value: `={{ ${CFG}.drive_folder_id }}` },
  options: { simplifyOutput: false },
}, { ...RETRY2, onError: 'continueErrorOutput' });
link('[1] AI Analyze & Write', '[2] Generate Image');
link('[2] Generate Image', '[2] Overlay Text', 0);
link('[2] Overlay Text', '[2] Upload to Drive', 0);

// =====================================================================
// 3 · Kiểm tra & lưu
// =====================================================================
code('[3] Check & Build Rows', at(3, 0, 0), function () {
  // Kiểm tra 4 bài theo quy tắc, tạo 4 dòng Posts (post_key = jd_id|platform) + kết quả cho dòng JD.
  const cfg = $('[0] Config').first().json;
  const out = $('[1] AI Analyze & Write').first().json.output;
  const a = out.analysis || {};
  const jdId = `jd-${$execution.id}`;
  // Poster: chỉ có khi Upload thành công; lỗi ở bước 2 thì ghi lý do
  const input = $input.first().json;
  const poster = input.id && input.webViewLink !== undefined
    ? { file_id: input.id, url: input.webViewLink || '', error: '' }
    : { file_id: '', url: '', error: `Poster lỗi: ${String(input.error?.message ?? input.error ?? 'không rõ').slice(0, 200)}` };

  const form = { detail: cfg['Chi Tiết JD'] || '', salary: cfg['Mức Lương'] || '', contact: cfg['Liên Hệ'] || '' };
  const RULES = {
    linkedin: { label: 'LinkedIn', max: 3000, minTags: 3, maxTags: 5 },
    threads: { label: 'Threads', max: 500, minTags: 0, maxTags: 2 },
    facebook_groups: { label: 'Facebook Groups', max: 2000, minTags: 0, maxTags: 4 },
    facebook_page: { label: 'Facebook Page', max: 2500, minTags: 3, maxTags: 5 },
  };
  const notStated = (v) => /^\s*(không nêu|khong neu)?\s*$/i.test(v ?? '');
  const normTag = (t) => '#' + String(t).replace(/^#+/, '').replace(/\s+/g, '');
  const sourceNumbers = new Set(([form.detail, form.salary, form.contact].join(' ').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/[.,]/g, '')));
  const contactRaw = notStated(a.thong_tin_lien_he) ? form.contact : a.thong_tin_lien_he;
  const contactTokens = [
    ...(contactRaw.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map((s) => s.toLowerCase()),
    ...(contactRaw.match(/(?:https?:\/\/|www\.)\S+/g) || []).map((s) => s.toLowerCase()),
    ...(contactRaw.match(/\+?\d[\d .-]{7,}\d/g) || []).map((s) => s.replace(/\D/g, '')),
  ];
  const MONEY = /(\d+(?:[.,]\d+)?)\s*(?:-|–|đến|tới)?\s*(?:\d+(?:[.,]\d+)?)?\s*(triệu|tr\b|củ|nghìn|ngàn|usd|\$|vnđ|vnd|đồng)/gi;
  const PLACEHOLDER = /\{\{[^}]*\}\}|\[(?:tên|ten|link|name|số điện thoại|sđt|sdt|email|công ty|vị trí|địa chỉ|mức lương)[^\]\n]{0,30}\]|\bX{3,}\b/i;
  const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

  const createdAt = $now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss');
  const summary = [];
  const rows = Object.entries(RULES).map(([key, r]) => {
    const p = (out.posts || {})[key] || {};
    const text = String(p.post_text || '').trim();
    const inText = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
    let tags = [...new Set((p.hashtags || []).map(normTag).filter((t) => t.length > 1))];
    if (tags.length + inText.size < r.minTags) tags = [...new Set([...tags, ...(a.tu_khoa_hashtag || []).map(normTag)])];
    tags = tags.filter((t) => !inText.has(t.toLowerCase())).slice(0, Math.max(0, r.maxTags - inText.size));
    const full = tags.length ? `${text}\n\n${tags.join(' ')}` : text;
    const errs = [];
    if (!text) errs.push('Bài rỗng');
    if (full.length > r.max) errs.push(`Vượt ${r.max} ký tự (${full.length})`);
    const ph = full.match(PLACEHOLDER);
    if (ph) errs.push(`Còn placeholder "${ph[0]}"`);
    if (contactTokens.length) {
      const lower = full.toLowerCase();
      const digits = full.replace(/\D/g, '');
      if (!contactTokens.some((t) => (/^\d+$/.test(t) ? digits.includes(t) : lower.includes(t)))) errs.push('Thiếu thông tin liên hệ có trong JD');
    }
    for (const m of full.matchAll(MONEY)) {
      if ((m[0].match(/\d+(?:[.,]\d+)?/g) || []).some((n) => !sourceNumbers.has(n.replace(/[.,]/g, '')))) errs.push(`Số tiền không có trong JD: "${m[0].trim()}"`);
    }
    if (notStated(a.muc_luong_chuan_hoa) && [...full.matchAll(/lương([^\n\d]{0,25})(\d[\d.,]*)/gi)].some((m) => !/tháng\s*$/i.test(m[1]))) errs.push('JD không nêu lương nhưng bài có số lương');
    const letters = (full.match(/\p{L}/gu) || []).length;
    if (letters && (full.match(VI) || []).length / letters < 0.03) errs.push('Không phải tiếng Việt có dấu');
    if (errs.length) summary.push(`${r.label}: ${errs.join('; ')}`);
    return {
      post_key: `${jdId}|${key}`, jd_id: jdId, platform: r.label, post_text: full, hashtags: tags.join(' '),
      poster_url: poster.url, poster_file_id: poster.file_id,
      status: errs.length ? 'Needs Review' : 'Draft', error_message: errs.join('; '), created_at: createdAt, retry_count: 0,
    };
  });
  const jd = {
    jd_status: summary.length ? 'Needs Review' : 'Done',
    jd_error: [summary.join(' || '), poster.error].filter(Boolean).join(' || '),
    jd_warnings: (a.canh_bao_thieu_thong_tin || []).join('; '),
  };
  return rows.map((r) => ({ json: { ...r, ...jd } }));
}, 'nhiều quy tắc regex (lương, liên hệ, placeholder, dấu tiếng Việt) trên 4 bài và tạo 4 dòng.');
const POST_COLS = ['post_key', 'jd_id', 'platform', 'post_text', 'hashtags', 'poster_url', 'poster_file_id', 'status', 'error_message', 'created_at', 'retry_count'];
sheets('[3] Save Posts', at(3, 1, 0), sheetWrite('appendOrUpdate', 'Posts', Object.fromEntries(POST_COLS.map((c) => [c, `={{ $json.${c} }}`])), ['post_key']));
const ROW = "$('[3] Check & Build Rows').first().json";
sheets('[3] Set JD Result', at(3, 2, 0), sheetWrite('update', 'JD', {
  jd_id: `={{ ${ROW}.jd_id }}`, status: `={{ ${ROW}.jd_status }}`, poster_url: `={{ ${ROW}.poster_url }}`,
  warnings: `={{ ${ROW}.jd_warnings }}`, error_message: `={{ ${ROW}.jd_error }}`,
}, ['jd_id']), { executeOnce: true });
link('[2] Upload to Drive', '[3] Check & Build Rows', 0);
for (const n of ['[2] Generate Image', '[2] Overlay Text', '[2] Upload to Drive']) link(n, '[3] Check & Build Rows', 1);
link('[3] Check & Build Rows', '[3] Save Posts');
link('[3] Save Posts', '[3] Set JD Result');

// =====================================================================
// 4 · Đăng bài
// =====================================================================
sheets('[4] Read Posts', at(4, 0, 1), { operation: 'read', documentId: DOC, sheetName: tab('Posts'), options: {} }, { alwaysOutputData: true, executeOnce: true });
code('[4] Prepare Posts', at(4, 1, 1), function () {
  // Chọn dòng được đăng và quyết định nhánh (route) cho từng dòng; dòng không cần gọi API được kết luận luôn ở đây.
  const cfg = $('[0] Config').first().json;
  const isTrue = (v) => v === true || String(v) === 'true';
  const zone = 'Asia/Ho_Chi_Minh';
  const parse = (s) => { if (!s) return null; const d = DateTime.fromSQL(String(s), { zone }); return d.isValid ? d : DateTime.fromISO(String(s), { zone }); };
  const now = DateTime.now().setZone(zone);
  const rows = $input.all().map((i) => i.json).filter((r) => r.post_key);
  const ENABLED = { LinkedIn: cfg.enable_linkedin, Threads: cfg.enable_threads, 'Facebook Page': cfg.enable_facebook_page, 'Facebook Groups': cfg.enable_facebook_groups };
  const LIMIT = { LinkedIn: 3000, Threads: 500, 'Facebook Page': 63206, 'Facebook Groups': 63206 };
  // Threads tính emoji theo số byte UTF-8
  const enc = new TextEncoder();
  const len = (s, platform) => (platform === 'Threads'
    ? [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? enc.encode(ch).length : 1), 0)
    : [...s].length);
  const last = {};
  for (const r of rows) { const p = parse(r.published_at); if (p?.isValid && r.status === 'Published' && (!last[r.platform] || p > last[r.platform])) last[r.platform] = p; }
  const taken = new Set();
  const out = [];
  const due = rows
    .filter((r) => (r.status === 'Approved' || r.status === 'Manual - Confirmed') && isTrue(ENABLED[r.platform]))
    .filter((r) => { const s = parse(r.scheduled_at); return !s || !s.isValid || s <= now; });
  for (const r of due) {
    const text = String(r.post_text || '').trim();
    const done = (status, note, log = '') => out.push({ json: { ...r, text, route: 'done', result_status: status, note, log } });
    if (r.status === 'Manual - Confirmed') { done('Published (manual)', 'Đã xác nhận đăng tay'); continue; }
    if (r.platform_post_id) { done('Published', 'Bỏ qua: đã có platform_post_id (chống đăng trùng)'); continue; }
    if (!text || len(text, r.platform) > LIMIT[r.platform]) { done('Failed', `Bài rỗng hoặc vượt ${LIMIT[r.platform]} ký tự (${len(text, r.platform)})`); continue; }
    if (r.platform === 'Facebook Groups') { done('Manual - Waiting', 'Facebook Groups không có API: đăng tay rồi đổi status thành "Manual - Confirmed"'); continue; }
    if (isTrue(cfg.dry_run)) {
      done('Dry Run', '', `[DRY_RUN ${now.toFormat('yyyy-MM-dd HH:mm')}] ${r.platform}: sẽ đăng ${len(text, r.platform)} ký tự${r.poster_file_id ? ' + poster' : ''}. Nội dung:\n${text}`);
      continue;
    }
    // Tối đa 1 bài/nền tảng mỗi lần chạy và cách bài trước ít nhất min_gap_minutes
    if (taken.has(r.platform) || (last[r.platform] && now.diff(last[r.platform], 'minutes').minutes < Number(cfg.min_gap_minutes || 0))) continue;
    taken.add(r.platform);
    const route = r.platform === 'LinkedIn' ? 'linkedin' : r.platform === 'Threads' ? 'threads' : (r.poster_file_id ? 'facebook_photo' : 'facebook_text');
    out.push({ json: { ...r, text, route, result_status: '', note: '', log: '' } });
  }
  return out;
}, 'lọc dòng theo trạng thái/giờ hẹn/khoảng cách và kết luận sẵn các dòng không cần gọi API.');
node('[4] Download Poster', 'n8n-nodes-base.googleDrive', 3, at(4, 2, 1), {
  operation: 'download', fileId: { __rl: true, mode: 'id', value: "={{ ['linkedin', 'facebook_photo'].includes($json.route) ? $json.poster_file_id : '' }}" }, options: {},
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
const P = "$('[4] Prepare Posts').item.json";
node('[4] Route by Platform', 'n8n-nodes-base.switch', 3.2, at(4, 3, 1), {
  rules: { values: ['done', 'linkedin', 'threads', 'facebook_photo', 'facebook_text'].map((k) => route(k, `={{ ${P}.route }}`)) },
  options: {},
});
node('[4] Post LinkedIn', 'n8n-nodes-base.linkedIn', 1, at(4, 4, 0), {
  postAs: 'person',
  person: `={{ ${CFG}.linkedin_person_id }}`,
  text: `={{ ${P}.text }}`,
  shareMediaCategory: "={{ $binary?.data ? 'IMAGE' : 'NONE' }}",
  binaryPropertyName: 'data',
  additionalFields: { visibility: 'PUBLIC' },
}, { onError: 'continueRegularOutput' });
const THREADS = (path) => `=https://graph.threads.com/v1.0/{{ ${CFG}.threads_user_id }}/${path}`;
node('[4] Threads Create', 'n8n-nodes-base.httpRequest', 4.2, at(4, 4, 1), {
  method: 'POST', url: THREADS('threads'),
  authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
  sendQuery: true, specifyQuery: 'json', jsonQuery: `={{ JSON.stringify({ media_type: 'TEXT', text: ${P}.text }) }}`,
  options: {},
}, { onError: 'continueErrorOutput' });
node('[4] Threads Publish', 'n8n-nodes-base.httpRequest', 4.2, at(4, 5, 1), {
  method: 'POST', url: THREADS('threads_publish'),
  authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
  sendQuery: true, specifyQuery: 'json', jsonQuery: '={{ JSON.stringify({ creation_id: $json.id }) }}',
  options: {},
}, { onError: 'continueRegularOutput' });
const FB = (edge) => `=https://graph.facebook.com/{{ ${CFG}.facebook_graph_version }}/{{ ${CFG}.facebook_page_id }}/${edge}`;
node('[4] Post Facebook Photo', 'n8n-nodes-base.httpRequest', 4.2, at(4, 4, 2), {
  method: 'POST', url: FB('photos'),
  authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
  sendBody: true, contentType: 'multipart-form-data',
  bodyParameters: { parameters: [
    { parameterType: 'formBinaryData', name: 'source', inputDataFieldName: 'data' },
    { name: 'caption', value: `={{ ${P}.text }}` },
  ] },
  options: {},
}, { onError: 'continueRegularOutput' });
node('[4] Post Facebook Text', 'n8n-nodes-base.httpRequest', 4.2, at(4, 4, 3), {
  method: 'POST', url: FB('feed'),
  authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
  sendBody: true, contentType: 'form-urlencoded',
  bodyParameters: { parameters: [{ name: 'message', value: `={{ ${P}.text }}` }] },
  options: {},
}, { onError: 'continueRegularOutput' });
const ERR = "String($json.error?.message ?? $json.error ?? '').replace(/(access_token|token|secret)=([^&\\s\"']+)/gi, '$1=***').replace(/Bearer\\s+\\S+/gi, 'Bearer ***').slice(0, 400)";
const DONE = `${P}.route === 'done'`;
sheets('[4] Save Result', at(4, 6, 1), sheetWrite('update', 'Posts', {
  post_key: `={{ ${P}.post_key }}`,
  status: `={{ ${DONE} ? ${P}.result_status : ($json.error ? 'Failed' : 'Published') }}`,
  platform_post_id: `={{ ${DONE} || $json.error ? (${P}.platform_post_id || '') : ($json.urn ?? $json.post_id ?? $json.id ?? '') }}`,
  post_url: `={{ ${DONE} || $json.error ? (${P}.post_url || '') : $json.urn ? 'https://www.linkedin.com/feed/update/' + $json.urn + '/' : $json.post_id ? 'https://www.facebook.com/' + $json.post_id : '' }}`,
  published_at: `={{ (${DONE} ? ['Published (manual)'].includes(${P}.result_status) : !$json.error) ? ${NOW_VN} : (${P}.published_at || '') }}`,
  error_message: `={{ ${DONE} ? ${P}.note : ($json.error ? 'Lỗi: ' + ${ERR} : '') }}`,
  publish_log: `={{ ${P}.log }}`,
}, ['post_key']));
link('[0] Route', '[4] Read Posts', 1);
link('[4] Read Posts', '[4] Prepare Posts');
link('[4] Prepare Posts', '[4] Download Poster');
link('[4] Download Poster', '[4] Route by Platform');
link('[4] Route by Platform', '[4] Save Result', 0);
link('[4] Route by Platform', '[4] Post LinkedIn', 1);
link('[4] Route by Platform', '[4] Threads Create', 2);
link('[4] Route by Platform', '[4] Post Facebook Photo', 3);
link('[4] Route by Platform', '[4] Post Facebook Text', 4);
link('[4] Threads Create', '[4] Threads Publish', 0);
link('[4] Threads Create', '[4] Save Result', 1);
for (const n of ['[4] Post LinkedIn', '[4] Threads Publish', '[4] Post Facebook Photo', '[4] Post Facebook Text']) link(n, '[4] Save Result');

// =====================================================================
// 5 · Lỗi
// =====================================================================
sheets('[5] Set JD Error', at(5, 0, 1), sheetWrite('update', 'JD', {
  jd_id: "={{ 'jd-' + $json.execution.id }}",
  status: 'Error',
  error_message: `={{ String($json.execution.error?.message ?? 'Lỗi không rõ').replace(/(access_token|token|secret)=([^&\\s"']+)/gi, '$1=***').slice(0, 400) + ' | Node lỗi: ' + $json.execution.lastNodeExecuted }}`,
}, ['jd_id']));
link('[0] Route', '[5] Set JD Error', 2);

// ---------- Sticky tự bao quanh ----------
const stickies = Object.entries(SECTIONS).map(([k, s]) => {
  const m = nodes.filter((n) => n.name.startsWith(`[${k}]`));
  const xs = m.map((n) => n.position[0]);
  const ys = m.map((n) => n.position[1]);
  const x = Math.min(...xs) - 60;
  const y = Math.min(...ys) - 170;
  return {
    parameters: { content: `## ${s.title}\n${s.info}`, width: Math.max(...xs) + 180 - x, height: Math.max(...ys) + 190 - y, color: s.color },
    type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [x, y], id: uuid(`sticky:${k}`), name: `Khung ${s.title}`,
  };
});

const workflow = {
  id: WORKFLOW_ID, name: WORKFLOW_NAME, active: false,
  nodes: [...stickies, ...nodes], connections,
  settings: { executionOrder: 'v1', errorWorkflow: WORKFLOW_ID, timezone: 'Asia/Ho_Chi_Minh', saveManualExecutions: true },
  pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [],
};
writeFileSync(join(ROOT, 'jd-automation.v5.json'), JSON.stringify(workflow, null, 2) + '\n');
const main = nodes.filter((n) => !/lmChat|outputParser/.test(n.type)).length;
console.log(`Đã ghi jd-automation.v5.json: ${main} node chính + ${nodes.length - main} node AI phụ + ${stickies.length} khung`);
