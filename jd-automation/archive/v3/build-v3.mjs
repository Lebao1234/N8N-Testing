// Sinh bộ workflow v3 (tách sub-workflow) + luồng đăng bài v1 từ prompts/, schemas/, test-data/.
// Chạy: node jd-automation/v3/build-v3.mjs   → ghi vào jd-automation/v3/workflows/
// Bản v2 (jd-automation/jd-automation.v2.json) KHÔNG bị đụng tới.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'workflows');
mkdirSync(OUT, { recursive: true });
const read = (p) => readFileSync(join(ROOT, p), 'utf8').trim();
const prompt = (name) => read(`prompts/${name}.system.md`);
const schema = (name) => read(`schemas/${name}.schema.json`);
const SHARED_WRITER_RULES = read('prompts/_shared-writer-rules.md');

// ---------- ID workflow (16 ký tự, cố định để Execute Workflow tham chiếu) ----------
const ID = {
  config: 'jd3Config0000000',
  main: 'jd3Main000000000',
  analyze: 'jd3Analyze000000',
  write: 'jd3WritePosts000',
  poster: 'jd3Poster0000000',
  validate: 'jd3ValidateSave0',
  publish: 'jd3Publish000000',
  publishOne: 'jd3PublishOne000',
  token: 'jd3TokenHealth00',
  error: 'jd3ErrorHandler0',
  test: 'jd3TestPublish00',
};
const NAME = {
  config: '[dev] jd-config',
  main: '[dev] jd-00-main',
  analyze: '[dev] jd-01-analyze',
  write: '[dev] jd-02-write-posts',
  poster: '[dev] jd-03-poster',
  validate: '[dev] jd-04-validate-save',
  publish: '[dev] jd-05-publish',
  publishOne: '[dev] jd-05a-publish-one',
  token: '[dev] jd-06-token-health',
  error: '[dev] jd-99-error-handler',
  test: '[test] jd-publish-dry-run',
};

const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const RETRY2 = { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 };
const CRED = {
  basicAuth: { httpBasicAuth: { id: 'CLtFsk0dNV90Z52V', name: 'Unnamed credential' } },
  anthropic: { anthropicApi: { id: 'anthropicLocal01', name: 'Anthropic (from .env)' } },
  openAi: { openAiApi: { id: 'openAiLocal00001', name: 'OpenAI (from .env)' } },
};
const NOW_VN = "$now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss')";

const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
// Lấy phần thân của một hàm JS làm jsCode cho Code node (tránh phải escape chuỗi)
const body = (fn, replacements = {}) => {
  const s = fn.toString();
  let code = s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n/, '').replace(/^ {2}/gm, '').trimEnd();
  for (const [k, v] of Object.entries(replacements)) code = code.replace(k, () => v);
  return code;
};

// ---------- Bộ dựng workflow ----------
function createWorkflow(key, settingsExtra = {}) {
  const nodes = [];
  const connections = {};
  const api = {
    node(name, type, typeVersion, position, parameters, extra = {}) {
      nodes.push({ parameters, type, typeVersion, position, id: uuid(`${key}:${name}`), name, ...extra });
      return name;
    },
    link(from, to, outputIndex = 0, type = 'main') {
      connections[from] ??= {};
      connections[from][type] ??= [];
      while (connections[from][type].length <= outputIndex) connections[from][type].push([]);
      connections[from][type][outputIndex].push({ node: to, type, index: 0 });
    },
    chain(...names) { names.slice(1).forEach((n, i) => api.link(names[i], n)); },
    sticky(name, position, width, height, content, color = 7) {
      api.node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
    },
    toJSON() {
      const settings = { executionOrder: 'v1', timezone: 'Asia/Ho_Chi_Minh', saveManualExecutions: true, ...settingsExtra };
      if (key !== 'error' && !('errorWorkflow' in settingsExtra)) settings.errorWorkflow = ID.error;
      return { id: ID[key], name: NAME[key], active: false, nodes, connections, settings, pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [] };
    },
  };
  return api;
}

// ---------- Node dựng sẵn ----------
const trigger = (w, name, pos) => w.node(name, 'n8n-nodes-base.executeWorkflowTrigger', 1.3, pos, { inputSource: 'passthrough' });
const execWf = (w, name, pos, target, mode = 'once', extra = {}) => w.node(name, 'n8n-nodes-base.executeWorkflow', 1.4, pos, {
  workflowId: { __rl: true, mode: 'list', value: ID[target], cachedResultName: NAME[target] },
  workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
  mode,
  options: { waitForSubWorkflow: true },
}, extra);
const setNode = (w, name, pos, fields, includeOtherFields = false, extra = {}) => w.node(name, 'n8n-nodes-base.set', 3.4, pos, {
  assignments: {
    assignments: Object.entries(fields).map(([fname, v]) => {
      const [value, type] = Array.isArray(v) ? v : [v, 'string'];
      return { id: uuid(`${name}:${fname}`), name: fname, value, type };
    }),
  },
  includeOtherFields,
  options: {},
}, extra);
const codeNode = (w, name, pos, fn, why, replacements, extra = {}) =>
  w.node(name, 'n8n-nodes-base.code', 2, pos, { jsCode: body(fn, replacements) }, { notes: `Why Code: ${why}`, ...extra });
const ifNode = (w, name, pos, leftValue, extra = {}, operator = { type: 'boolean', operation: 'true', singleValue: true }, rightValue = '') =>
  w.node(name, 'n8n-nodes-base.if', 2.2, pos, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: uuid(`${name}:cond`), leftValue, rightValue, operator }],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  }, extra);
const claude = (w, name, pos, model, temperature) => w.node(name, '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, pos, {
  model: { __rl: true, mode: 'id', value: model },
  options: { temperature, maxTokensToSample: 4096 },
}, { credentials: CRED.anthropic });
const parser = (w, name, pos, schemaName) => w.node(name, '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, pos, {
  schemaType: 'manual', inputSchema: schema(schemaName), autoFix: true,
});
// Basic LLM Chain + model chính + parser (auto-fix bằng model Haiku rẻ hơn)
const llmChain = (w, { name, pos, systemMessage, text, schemaName, model, temperature, fixModelName, modelName, parserName, batchSize }) => {
  w.node(name, '@n8n/n8n-nodes-langchain.chainLlm', 1.9, pos, {
    promptType: 'define',
    text,
    hasOutputParser: true,
    messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: systemMessage }] },
    ...(batchSize ? { batching: { batchSize, delayBetweenBatches: 0 } } : {}),
  }, RETRY2);
  claude(w, modelName, [pos[0] - 120, pos[1] + 220], model, temperature);
  parser(w, parserName, [pos[0] + 100, pos[1] + 220], schemaName);
  w.link(modelName, name, 0, 'ai_languageModel');
  w.link(parserName, name, 0, 'ai_outputParser');
  if (fixModelName) {
    claude(w, fixModelName, [pos[0] + 100, pos[1] + 420], HAIKU, 0);
    w.link(fixModelName, parserName, 0, 'ai_languageModel');
  } else {
    w.link(modelName, parserName, 0, 'ai_languageModel');
  }
};

// ---------- Google Sheets ----------
const colSchema = (ids) => ids.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
const docRef = (expr) => ({ __rl: true, mode: 'id', value: `={{ ${expr} }}` });
const tabRef = (tab) => ({ __rl: true, mode: 'name', value: tab, cachedResultName: tab });
const sheetWrite = (operation, docExpr, tab, values, matchingColumns = []) => ({
  operation,
  documentId: docRef(docExpr),
  sheetName: tabRef(tab),
  columns: { mappingMode: 'defineBelow', value: values, matchingColumns, schema: colSchema(Object.keys(values)), attemptToConvertTypes: false, convertFieldsToString: true },
  options: {},
});
const sheetRead = (docExpr, tab, filters = []) => ({
  operation: 'read',
  documentId: docRef(docExpr),
  sheetName: tabRef(tab),
  ...(filters.length ? { filtersUI: { values: filters }, combineFilters: 'AND' } : {}),
  options: {},
});
const sheets = (w, name, pos, params, extra = {}) => w.node(name, 'n8n-nodes-base.googleSheets', 4.7, pos, params, { ...RETRY2, ...extra });

// ---------- Telegram ----------
const telegram = (w, name, pos, chatIdExpr, textExpr) => w.node(name, 'n8n-nodes-base.telegram', 1.2, pos, {
  chatId: `={{ ${chatIdExpr} }}`,
  text: textExpr,
  additionalFields: { appendAttribution: false },
}, { onError: 'continueRegularOutput' });

const write = (key, w) => {
  const file = {
    config: 'jd-config.v3.json', main: '00-main.v3.json', analyze: '01-analyze.v3.json', write: '02-write-posts.v3.json',
    poster: '03-poster.v3.json', validate: '04-validate-save.v3.json', publish: '05-jd-publish.v1.json',
    publishOne: '05a-publish-one.v1.json', token: '06-token-health.v1.json', error: '99-error-handler.v3.json',
    test: 'test-publish-dry-run.v1.json',
  }[key];
  writeFileSync(join(OUT, file), JSON.stringify(w.toJSON(), null, 2) + '\n');
  return file;
};
const built = [];

// =====================================================================
// jd-config — nguồn cấu hình DUY NHẤT (A-09). Trả lại dữ liệu đầu vào + config.
// =====================================================================
{
  const w = createWorkflow('config');
  trigger(w, '[Config] When called', [0, 300]);
  setNode(w, '[Config] Return config', [240, 300], {
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
  w.link('[Config] When called', '[Config] Return config');
  w.sticky('[Config] Ghi chú', [-60, 40], 560, 220,
    '## jd-config\n**Input:** bất kỳ item nào. **Output:** item đó + toàn bộ khoá cấu hình.\nĐây là nơi DUY NHẤT sửa cấu hình (Sheet, Drive, DRY_RUN, ID Page/LinkedIn…).\n**Lỗi thường gặp:** quên thay `REPLACE_WITH_…`.');
  built.push(write('config', w));
}

// =====================================================================
// 01 Analyze
// =====================================================================
{
  const w = createWorkflow('analyze');
  trigger(w, '[Analyze] When called', [0, 300]);
  llmChain(w, {
    name: '[Analyze] Analyze JD', pos: [260, 300],
    systemMessage: prompt('jd-analyzer'),
    text: '=Tên Công Ty: {{ $json.job.form.company }}\nVị Trí: {{ $json.job.form.position }}\nMức Lương (form): {{ $json.job.form.salary || "(để trống)" }}\nLiên Hệ (form): {{ $json.job.form.contact || "(để trống)" }}\nChi Tiết JD:\n{{ $json.job.form.jd_detail }}',
    schemaName: 'jd-analysis', model: SONNET, temperature: 0.2,
    modelName: '[Analyze] Model · Claude Sonnet', parserName: '[Analyze] Parser · JD analysis', fixModelName: '[Analyze] Model · Fix JSON (Haiku)',
  });
  setNode(w, '[Analyze] Return job', [560, 300], {
    job: ["={{ { ...$('[Analyze] When called').first().json.job, analysis: $json.output } }}", 'object'],
  });
  w.chain('[Analyze] When called', '[Analyze] Analyze JD', '[Analyze] Return job');
  w.sticky('[Analyze] Ghi chú', [-60, 40], 760, 220,
    '## 01 · Analyze\n**Input:** `job.form`. **Output:** `job.analysis` (15 field, schema jd-analysis).\n**Lỗi thường gặp:** sai/thiếu credential Anthropic; model không tồn tại.');
  built.push(write('analyze', w));
}

// =====================================================================
// 02 Write posts — 4 bài chạy SONG SONG bằng batching; cũng dùng để viết lại bài lỗi
// =====================================================================
{
  const w = createWorkflow('write');
  const PLATFORMS = {
    linkedin: { label: 'LinkedIn', system: `${prompt('linkedin-writer')}\n\n${SHARED_WRITER_RULES}` },
    threads: { label: 'Threads', system: `${prompt('threads-writer')}\n\n${SHARED_WRITER_RULES}` },
    facebook_groups: { label: 'Facebook Groups', system: `${prompt('facebook-groups-writer')}\n\n${SHARED_WRITER_RULES}` },
    facebook_page: { label: 'Facebook Page', system: `${prompt('facebook-page-writer')}\n\n${SHARED_WRITER_RULES}` },
  };
  trigger(w, '[Write] When called', [0, 300]);
  codeNode(w, '[Write] Build platform tasks', [240, 300], function () {
    // Tạo 1 item cho mỗi nền tảng cần viết (4 bài) hoặc chỉ các bài lỗi khi job.validation báo không hợp lệ.
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
  }, 'số item thay đổi theo chế độ viết mới/viết lại và mỗi item mang system prompt riêng của nền tảng.', {
    __PLATFORMS__: JSON.stringify(PLATFORMS),
    __REWRITE__: JSON.stringify(prompt('post-rewriter')),
  });
  llmChain(w, {
    name: '[Write] Generate post', pos: [500, 300],
    systemMessage: '={{ $json.system_prompt }}',
    text: '={{ $json.user_prompt }}',
    schemaName: 'platform-post', model: SONNET, temperature: 0.7, batchSize: 4,
    modelName: '[Write] Model · Claude Sonnet', parserName: '[Write] Parser · Platform post', fixModelName: '[Write] Model · Fix JSON (Haiku)',
  });
  codeNode(w, '[Write] Return job', [800, 300], function () {
    // Ghép kết quả theo thứ tự item với danh sách task, giữ nguyên các bài không cần viết lại.
    const job = $('[Write] When called').first().json.job;
    const tasks = $('[Write] Build platform tasks').all();
    const posts = { ...(job.posts || {}) };
    $input.all().forEach((item, i) => {
      posts[tasks[i].json.platform] = item.json.output;
    });
    return [{ json: { job: { ...job, posts } } }];
  }, 'ghép N kết quả LLM với N task theo chỉ số item.');
  w.chain('[Write] When called', '[Write] Build platform tasks', '[Write] Generate post', '[Write] Return job');
  w.sticky('[Write] Ghi chú', [-60, 40], 1000, 220,
    '## 02 · Write posts\n**Input:** `job.analysis` (+ `job.validation`, `job.posts` khi viết lại). **Output:** `job.posts.{linkedin,threads,facebook_groups,facebook_page}`.\n4 bài chạy song song (Batch Size 4). Viết lại chỉ các bài có trong `job.validation.errors`.\n**Lỗi thường gặp:** JSON hỏng → parser tự sửa bằng Haiku; 429 từ Anthropic → giảm Batch Size.');
  built.push(write('write', w));
}

// =====================================================================
// 03 Poster — lỗi mềm: luôn trả job, có job.poster.error thay vì làm hỏng cả job (A-02)
// =====================================================================
{
  const w = createWorkflow('poster');
  const CTX = "$('[Poster] Select visual style').first().json";
  const cut = (expr, n) => `(s => s.length <= ${n} ? s : s.slice(0, ${n}).replace(/\\s+\\S*$/, '') + '…')(String(${expr} || '').trim())`;
  const notStated = (expr) => `/^\\s*(không nêu|khong neu)?\\s*$/i.test(${expr} ?? '')`;
  trigger(w, '[Poster] When called', [0, 300]);
  setNode(w, '[Poster] Select content', [220, 300], {
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
  setNode(w, '[Poster] Select visual style', [440, 300], {
    industry: '={{ $json.job.analysis.nganh_nghe }}',
    visual: [`={{ (${JSON.stringify(STYLE_MAP).replaceAll('}}', '} }')})[$json.job.analysis.nganh_nghe] ?? ${JSON.stringify(DEFAULT_STYLE)} }}`, 'object'],
  }, true);
  llmChain(w, {
    name: '[Poster] Build image prompt', pos: [680, 300],
    systemMessage: prompt('image-prompt-builder'),
    text: '=Create the background prompt for a recruitment poster.\nIndustry (Vietnamese): {{ $json.industry }}\nJob title (meaning only, DO NOT render as text): {{ $json.poster_position }}\nKey skills (meaning only): {{ ($json.job.analysis.ky_nang_chinh || []).slice(0, 5).join(", ") }}\nVisual style: {{ $json.visual.style }}\nPalette: {{ $json.visual.palette }}\nCanvas: 1024x1536 portrait. Bottom 40% must be a calm dark area for overlay text; top-left corner clear for a logo.',
    schemaName: 'image-prompt', model: HAIKU, temperature: 0.7,
    modelName: '[Poster] Model · Claude Haiku', parserName: '[Poster] Parser · Image prompt',
  });
  w.node('[Poster] Read logo file', 'n8n-nodes-base.readWriteFile', 1.1, [940, 300], {
    operation: 'read', fileSelector: `={{ ${CTX}.job.config.logo_path }}`, options: {},
  }, { alwaysOutputData: true, onError: 'continueRegularOutput' });
  ifNode(w, '[Poster] Has logo?', [1160, 300], '={{ Boolean($binary?.data) }}');
  codeNode(w, '[Poster] Attach logo', [1380, 160], function () {
    // Gộp prompt ảnh với binary logo, đổi tên binary thành "logo" cho OpenAI Edit Image.
    const promptOut = $('[Poster] Build image prompt').first().json.output;
    return $input.all().map((item) => ({
      json: {
        image_prompt: `${promptOut.image_prompt}\nUse the provided image as the company logo: place it small, unchanged and undistorted, in the top-left reserved zone. Do not add any text, letters or numbers anywhere. Avoid: ${promptOut.negative_notes}`,
      },
      binary: { logo: item.binary.data },
    }));
  }, 'ghép JSON prompt với binary logo và đổi tên binary property trong cùng item.');
  w.node('[Poster] Generate image with logo', '@n8n/n8n-nodes-langchain.openAi', 2.3, [1600, 160], {
    resource: 'image', operation: 'edit',
    modelId: { __rl: true, mode: 'id', value: `={{ ${CTX}.job.config.image_model }}` },
    prompt: '={{ $json.image_prompt }}',
    images: { values: [{ binaryPropertyName: 'logo' }] },
    size: '1024x1536', quality: 'high', options: {},
  }, { ...RETRY2, onError: 'continueErrorOutput', credentials: CRED.openAi });
  w.node('[Poster] Generate image', '@n8n/n8n-nodes-langchain.openAi', 2.3, [1600, 420], {
    resource: 'image', operation: 'generate',
    modelId: { __rl: true, mode: 'id', value: `={{ ${CTX}.job.config.image_model }}` },
    prompt: "={{ $('[Poster] Build image prompt').first().json.output.image_prompt }}\nAvoid: {{ $('[Poster] Build image prompt').first().json.output.negative_notes }}",
    options: { size: '1024x1536', quality: 'high' },
  }, { ...RETRY2, onError: 'continueErrorOutput', credentials: CRED.openAi });
  ifNode(w, '[Poster] Overlay enabled?', [1840, 300], `={{ ${CTX}.job.config.enable_text_overlay }}`);
  const FONT = `={{ ${CTX}.job.config.overlay_font }}`;
  const textStep = (text, fontSize, fontColor, positionY, lineLength) => ({
    operation: 'text', text, fontSize, fontColor, positionX: 72, positionY, horizontalAlignment: 'left', verticalAlignment: 'top', lineLength, font: FONT,
  });
  w.node('[Poster] Overlay Vietnamese text', 'n8n-nodes-base.editImage', 1.1, [2060, 160], {
    operation: 'multiStep',
    dataPropertyName: 'data',
    operations: {
      operations: [
        { operation: 'draw', primitive: 'rectangle', color: `={{ ${CTX}.visual.panel }}`, startPositionX: 0, startPositionY: 940, endPositionX: 1024, endPositionY: 1536 },
        { operation: 'draw', primitive: 'rectangle', color: `={{ ${CTX}.visual.accent }}`, startPositionX: 72, startPositionY: 948, endPositionX: 232, endPositionY: 954 },
        textStep(`={{ ${CTX}.poster_company }} TUYỂN DỤNG`, 34, `={{ ${CTX}.visual.accent }}`, 1000, 48),
        textStep(`={{ ${CTX}.poster_position }}`, 62, '#FFFFFF', 1065, 24),
        textStep(`={{ ${CTX}.poster_salary }}`, 44, `={{ ${CTX}.visual.accent }}`, 1230, 36),
        textStep(`={{ ${CTX}.poster_highlights }}`, 30, '#FFFFFF', 1300, 52),
        textStep(`={{ ${CTX}.poster_contact }}`, 32, '#FFFFFF', 1465, 52),
      ],
    },
    options: { format: 'png', fileName: `=poster-{{ ${CTX}.job.jd_id }}.png` },
  }, { onError: 'continueErrorOutput' });
  w.node('[Poster] Upload to Drive', 'n8n-nodes-base.googleDrive', 3, [2300, 300], {
    inputDataFieldName: 'data',
    name: `=poster-{{ ${CTX}.job.jd_id }}.png`,
    driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
    folderId: { __rl: true, mode: 'id', value: `={{ ${CTX}.job.config.drive_folder_id }}` },
    options: { simplifyOutput: false },
  }, { ...RETRY2, onError: 'continueErrorOutput' });
  ifNode(w, '[Poster] Share publicly?', [2520, 300], `={{ ${CTX}.job.config.poster_share_mode }}`, {},
    { type: 'string', operation: 'equals' }, 'anyone');
  w.node('[Poster] Share anyone with link', 'n8n-nodes-base.googleDrive', 3, [2740, 200], {
    operation: 'share',
    fileId: { __rl: true, mode: 'id', value: '={{ $json.id }}' },
    permissionsUi: { permissionsValues: { role: 'reader', type: 'anyone' } },
    options: {},
  }, { ...RETRY2, onError: 'continueRegularOutput' });
  const UP = "$('[Poster] Upload to Drive').first().json";
  setNode(w, '[Poster] Return job', [2980, 300], {
    job: [`={{ { ...${CTX}.job, poster: { file_id: ${UP}.id, url: ${UP}.webViewLink ?? '', shared: ${CTX}.job.config.poster_share_mode === 'anyone', error: '' } } }}`, 'object'],
  }, false, { executeOnce: true });
  setNode(w, '[Poster] Return job without poster', [2980, 560], {
    job: [`={{ { ...${CTX}.job, poster: { file_id: '', url: '', shared: false, error: $prevNode.name + ': ' + String($json.error?.message ?? $json.error ?? 'lỗi không rõ').slice(0, 300) } } }}`, 'object'],
  }, false, { executeOnce: true });

  w.chain('[Poster] When called', '[Poster] Select content', '[Poster] Select visual style', '[Poster] Build image prompt', '[Poster] Read logo file', '[Poster] Has logo?');
  w.link('[Poster] Has logo?', '[Poster] Attach logo', 0);
  w.link('[Poster] Has logo?', '[Poster] Generate image', 1);
  w.link('[Poster] Attach logo', '[Poster] Generate image with logo');
  w.link('[Poster] Generate image with logo', '[Poster] Overlay enabled?', 0);
  w.link('[Poster] Generate image with logo', '[Poster] Return job without poster', 1);
  w.link('[Poster] Generate image', '[Poster] Overlay enabled?', 0);
  w.link('[Poster] Generate image', '[Poster] Return job without poster', 1);
  w.link('[Poster] Overlay enabled?', '[Poster] Overlay Vietnamese text', 0);
  w.link('[Poster] Overlay enabled?', '[Poster] Upload to Drive', 1);
  w.link('[Poster] Overlay Vietnamese text', '[Poster] Upload to Drive', 0);
  w.link('[Poster] Overlay Vietnamese text', '[Poster] Return job without poster', 1);
  w.link('[Poster] Upload to Drive', '[Poster] Share publicly?', 0);
  w.link('[Poster] Upload to Drive', '[Poster] Return job without poster', 1);
  w.link('[Poster] Share publicly?', '[Poster] Share anyone with link', 0);
  w.link('[Poster] Share publicly?', '[Poster] Return job', 1);
  w.link('[Poster] Share anyone with link', '[Poster] Return job');
  w.sticky('[Poster] Ghi chú', [-60, 0], 1100, 200,
    '## 03 · Poster (lỗi mềm)\n**Input:** `job.analysis`, `job.form`, `job.config`. **Output:** `job.poster = {file_id, url, shared, error}`.\nMọi lỗi ảnh/overlay/Drive đi vào `Return job without poster` → bài vẫn được lưu. Mặc định poster **private** (`poster_share_mode`).\n**Lỗi thường gặp:** OpenAI chưa xác minh tổ chức; sai `drive_folder_id`; font không tồn tại.');
  built.push(write('poster', w));
}

// =====================================================================
// 04 Validate & save — kiểm tra + UPSERT 4 dòng Posts theo post_key (A-03, A-04)
// =====================================================================
{
  const w = createWorkflow('validate');
  trigger(w, '[Validate] When called', [0, 300]);
  codeNode(w, '[Validate] Check posts quality', [240, 300], function () {
    // Kiểm tra 4 bài trong job.posts; chỉ đọc input (không tham chiếu node khác).
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
    // Đơn vị tiền rõ ràng (đã bỏ "k" để tránh bắt nhầm "5k follower")
    const MONEY = /(\d+(?:[.,]\d+)?)\s*(?:-|–|đến|tới)?\s*(?:\d+(?:[.,]\d+)?)?\s*(triệu|tr\b|củ|nghìn|ngàn|usd|\$|vnđ|vnd|đồng)/gi;
    // Chỉ bắt placeholder rõ ràng, không bắt "[HN]", "[Tuyển gấp]"
    const PLACEHOLDER = /\{\{[^}]*\}\}|\[(?:tên|ten|link|name|số điện thoại|sđt|sdt|email|công ty|cong ty|vị trí|vi tri|địa chỉ|dia chi|mức lương|muc luong)[^\]\n]{0,30}\]|\bX{3,}\b|<(?:tên|link|name|email|số điện thoại)[^>\n]{0,30}>/i;
    const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;
    // "lương ... <số>" khi JD không nêu lương, nhưng bỏ qua "lương tháng 13/14"
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
  }, 'nhiều quy tắc regex (lương, liên hệ, placeholder, tỉ lệ dấu tiếng Việt) áp lên 4 bài cùng lúc.');
  codeNode(w, '[Validate] Build post rows', [480, 300], function () {
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
  }, 'ánh xạ object 4 nền tảng thành 4 dòng có post_key.');
  const POST_COLS = ['post_key', 'jd_id', 'platform', 'post_text', 'hashtags', 'poster_url', 'poster_file_id', 'status', 'error_message', 'created_at', 'retry_count'];
  sheets(w, '[Validate] Upsert post rows', [720, 300], sheetWrite('appendOrUpdate',
    "$('[Validate] Check posts quality').first().json.job.config.spreadsheet_id", 'Posts',
    Object.fromEntries(POST_COLS.map((c) => [c, `={{ $json.${c} }}`])), ['post_key']));
  setNode(w, '[Validate] Return job', [960, 300], {
    job: ["={{ $('[Validate] Check posts quality').first().json.job }}", 'object'],
  }, false, { executeOnce: true });
  w.chain('[Validate] When called', '[Validate] Check posts quality', '[Validate] Build post rows', '[Validate] Upsert post rows', '[Validate] Return job');
  w.sticky('[Validate] Ghi chú', [-60, 40], 1160, 220,
    '## 04 · Validate & save\n**Input:** `job.posts`, `job.poster`. **Output:** `job.validation = {valid, attempt, errors, error_summary}`.\nLUÔN lưu 4 bài (upsert theo `post_key`): bài đạt → `Draft`, bài lỗi → `Needs Review` + lý do ở `error_message`.\n**Lỗi thường gặp:** tab `Posts` thiếu cột `post_key`.');
  built.push(write('validate', w));
}

// =====================================================================
// 00 Main — orchestrator mỏng
// =====================================================================
{
  const w = createWorkflow('main');
  const JOB = '$json.job';
  const DOC = `${JOB}.config.spreadsheet_id`;
  w.node('[Prepare] Receive JD form', 'n8n-nodes-base.formTrigger', 2.6, [0, 400], {
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
  }, { webhookId: uuid('v3-jd-form-webhook'), credentials: CRED.basicAuth });
  w.node('[Prepare] Generate JD ID', 'n8n-nodes-base.crypto', 2, [220, 400], { action: 'generate', dataPropertyName: 'jd_id', encodingType: 'uuid' });
  w.node('[Prepare] Hash JD content', 'n8n-nodes-base.crypto', 2, [440, 400], {
    action: 'hash', type: 'SHA256', binaryData: false, encoding: 'hex', dataPropertyName: 'content_hash',
    value: "={{ [$json['Tên Công Ty'], $json['Vị Trí'], $json['Chi Tiết JD']].join('|').toLowerCase().replace(/\\s+/g, ' ').trim() }}",
  });
  execWf(w, '[Prepare] Load config', [660, 400], 'config');
  codeNode(w, '[Prepare] Build job', [880, 400], function () {
    // Tạo object job chuẩn: mọi sub-workflow chỉ đọc/ghi job, không tham chiếu node xa.
    const FORM_KEYS = ['Tên Công Ty', 'Vị Trí', 'Chi Tiết JD', 'Mức Lương', 'Liên Hệ', 'submittedAt', 'formMode', 'jd_id', 'content_hash'];
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
  }, 'tách form và cấu hình thành object job lồng nhau (hợp đồng dữ liệu giữa các workflow).');
  sheets(w, '[Prepare] Find same JD', [1100, 400], sheetRead(DOC, 'JD', [{ lookupColumn: 'content_hash', lookupValue: `={{ ${JOB}.content_hash }}` }]), { alwaysOutputData: true });
  const ACTIVE = "['Processing', 'Done', 'Needs Review', 'Published', 'Partially Published']";
  ifNode(w, '[Prepare] Is duplicate?', [1320, 400], `={{ $input.all().some(r => ${ACTIVE}.includes(r.json.status)) }}`, { executeOnce: true });
  const BJ = "$('[Prepare] Build job').first().json.job";
  sheets(w, '[Prepare] Log duplicate', [1540, 220], sheetWrite('append', `${BJ}.config.spreadsheet_id`, 'JD', {
    jd_id: `={{ ${BJ}.jd_id }}`,
    created_at: `={{ ${NOW_VN} }}`,
    company: `={{ ${BJ}.form.company }}`,
    position: `={{ ${BJ}.form.position }}`,
    status: 'Duplicate',
    step: 'stopped',
    error_message: `={{ 'Trùng nội dung với jd_id ' + ($('[Prepare] Find same JD').all().find(r => ${ACTIVE}.includes(r.json.status))?.json.jd_id ?? '?') + ' — không xử lý lại. Muốn chạy lại: đổi status dòng cũ thành Error.' }}`,
    execution_id: `={{ ${BJ}.execution_id }}`,
    execution_url: `={{ ${BJ}.execution_url }}`,
    content_hash: `={{ ${BJ}.content_hash }}`,
  }));
  setNode(w, '[Prepare] Restore job', [1540, 500], { job: [`={{ ${BJ} }}`, 'object'] });
  // Nhánh phụ (nằm TRÊN) chạy trước theo executionOrder v1: ghi trạng thái, rồi nhánh chính chạy sub-workflow.
  sheets(w, '[Prepare] Add JD row', [1760, 340], sheetWrite('append', DOC, 'JD', {
    jd_id: `={{ ${JOB}.jd_id }}`,
    created_at: `={{ ${NOW_VN} }}`,
    company: `={{ ${JOB}.form.company }}`,
    position: `={{ ${JOB}.form.position }}`,
    jd_detail: `={{ ${JOB}.form.jd_detail }}`,
    salary: `={{ ${JOB}.form.salary }}`,
    contact: `={{ ${JOB}.form.contact }}`,
    status: 'Processing',
    step: 'analyze',
    error_message: '',
    poster_url: '',
    warnings: '',
    execution_id: `={{ ${JOB}.execution_id }}`,
    execution_url: `={{ ${JOB}.execution_url }}`,
    content_hash: `={{ ${JOB}.content_hash }}`,
  }));
  const markStep = (name, pos, step, extra = {}) => sheets(w, name, pos, sheetWrite('update', DOC, 'JD', { jd_id: `={{ ${JOB}.jd_id }}`, step, ...extra }, ['jd_id']));
  execWf(w, '[Main] Run 01 Analyze', [1760, 560], 'analyze');
  markStep('[Main] Mark step write', [1980, 340], 'write', { warnings: `={{ (${JOB}.analysis.canh_bao_thieu_thong_tin || []).join('; ') }}` });
  execWf(w, '[Main] Run 02 Write posts', [1980, 560], 'write');
  markStep('[Main] Mark step poster', [2200, 340], 'poster');
  execWf(w, '[Main] Run 03 Poster', [2200, 560], 'poster');
  markStep('[Main] Mark step validate', [2420, 340], 'validate', { poster_url: `={{ ${JOB}.poster?.url ?? '' }}` });
  execWf(w, '[Main] Run 04 Validate & save', [2420, 560], 'validate');
  w.node('[Main] Needs rewrite?', 'n8n-nodes-base.if', 2.2, [2640, 560], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        { id: uuid('rw1'), leftValue: `={{ ${JOB}.validation.valid }}`, rightValue: '', operator: { type: 'boolean', operation: 'false', singleValue: true } },
        { id: uuid('rw2'), leftValue: `={{ ${JOB}.validation.attempt }}`, rightValue: 1, operator: { type: 'number', operation: 'lt' } },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  });
  execWf(w, '[Main] Run 02 Rewrite failed posts', [2860, 460], 'write');
  execWf(w, '[Main] Run 04 Validate again', [3080, 460], 'validate');
  w.node('[Main] Final job', 'n8n-nodes-base.noOp', 1, [3300, 560], {});
  sheets(w, '[Main] Set JD result', [3520, 460], sheetWrite('update', DOC, 'JD', {
    jd_id: `={{ ${JOB}.jd_id }}`,
    status: `={{ ${JOB}.validation.valid ? 'Done' : 'Needs Review' }}`,
    step: 'finished',
    poster_url: `={{ ${JOB}.poster?.url ?? '' }}`,
    warnings: `={{ (${JOB}.analysis.canh_bao_thieu_thong_tin || []).join('; ') }}`,
    error_message: `={{ [${JOB}.validation.error_summary, ${JOB}.poster?.error].filter(Boolean).join(' || ') }}`,
  }, ['jd_id']));
  ifNode(w, '[Main] Notify reviewer?', [3520, 680], `={{ ${JOB}.config.notify_channel }}`, {}, { type: 'string', operation: 'equals' }, 'telegram');
  telegram(w, '[Main] Notify reviewer', [3740, 680], `${JOB}.config.telegram_chat_id`,
    `=🆕 JD "{{ ${JOB}.form.position }}" – {{ ${JOB}.form.company }}\n4 bài đã lưu tab Posts ({{ ${JOB}.validation.valid ? 'Draft, chờ duyệt' : 'có bài Needs Review' }}).\nĐổi status sang Approved để đăng.\nPoster: {{ ${JOB}.poster?.url || '(không có: ' + (${JOB}.poster?.error || 'tắt') + ')' }}\njd_id: {{ ${JOB}.jd_id }}`);

  w.chain('[Prepare] Receive JD form', '[Prepare] Generate JD ID', '[Prepare] Hash JD content', '[Prepare] Load config', '[Prepare] Build job', '[Prepare] Find same JD', '[Prepare] Is duplicate?');
  w.link('[Prepare] Is duplicate?', '[Prepare] Log duplicate', 0);
  w.link('[Prepare] Is duplicate?', '[Prepare] Restore job', 1);
  w.link('[Prepare] Restore job', '[Prepare] Add JD row');
  w.link('[Prepare] Restore job', '[Main] Run 01 Analyze');
  w.link('[Main] Run 01 Analyze', '[Main] Mark step write');
  w.link('[Main] Run 01 Analyze', '[Main] Run 02 Write posts');
  w.link('[Main] Run 02 Write posts', '[Main] Mark step poster');
  w.link('[Main] Run 02 Write posts', '[Main] Run 03 Poster');
  w.link('[Main] Run 03 Poster', '[Main] Mark step validate');
  w.link('[Main] Run 03 Poster', '[Main] Run 04 Validate & save');
  w.link('[Main] Run 04 Validate & save', '[Main] Needs rewrite?');
  w.link('[Main] Needs rewrite?', '[Main] Run 02 Rewrite failed posts', 0);
  w.link('[Main] Needs rewrite?', '[Main] Final job', 1);
  w.chain('[Main] Run 02 Rewrite failed posts', '[Main] Run 04 Validate again', '[Main] Final job');
  w.link('[Main] Final job', '[Main] Set JD result');
  w.link('[Main] Final job', '[Main] Notify reviewer?');
  w.link('[Main] Notify reviewer?', '[Main] Notify reviewer', 0);
  w.sticky('[Main] Tổng quan', [-60, 40], 1200, 280,
    '## 00 · Main (orchestrator)\n**Input:** form JD. **Output:** dòng JD (`Done` | `Needs Review` | `Duplicate`), 4 dòng Posts (upsert `post_key`).\nLuồng: chuẩn bị `job` → 01 Analyze → 02 Write (song song) → 03 Poster (lỗi mềm) → 04 Validate & save → viết lại tối đa 1 lần.\nNút `Mark step …` nằm phía trên chạy trước nhánh chính (executionOrder v1) để cột `step` cho biết job đang ở đâu.\n**Lỗi thường gặp:** chưa cấu hình `jd-config`; credential Google/Anthropic; lỗi bất kỳ → `jd-99-error-handler` ghi `Error`.');
  built.push(write('main', w));
}

// =====================================================================
// 99 Error handler — Error Workflow chung cho mọi workflow jd-*
// =====================================================================
{
  const w = createWorkflow('error');
  const TOP = JSON.stringify([ID.main, ID.publish, ID.token]);
  const PUB = JSON.stringify([ID.publish]);
  w.node('[Error] Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [0, 300], {});
  execWf(w, '[Error] Load config', [220, 300], 'config');
  setNode(w, '[Error] Sanitize error', [440, 300], {
    error_text: "={{ String($json.execution?.error?.message ?? 'Lỗi không xác định').replace(/(access_token|token|key|secret|password|client_secret)=([^&\\s\"']+)/gi, '$1=***').replace(/Bearer\\s+[\\w.~+\\/-]+=*/gi, 'Bearer ***').slice(0, 500) }}",
    failed_node: "={{ $json.execution?.lastNodeExecuted ?? 'không rõ' }}",
    exec_ref: "={{ 'exec-' + ($json.execution?.id ?? 'none') }}",
    execution_url: "={{ $json.execution?.url ?? '' }}",
    workflow_name: "={{ $json.workflow?.name ?? '' }}",
    is_publish: [`={{ ${PUB}.includes($json.workflow?.id) }}`, 'boolean'],
    is_top_level: [`={{ ${TOP}.includes($json.workflow?.id) }}`, 'boolean'],
  }, true);
  ifNode(w, '[Error] Is publish workflow?', [660, 200], '={{ $json.is_publish }}');
  sheets(w, '[Error] Find publishing posts', [880, 100], sheetRead('$json.spreadsheet_id', 'Posts', [
    { lookupColumn: 'execution_id', lookupValue: '={{ $json.exec_ref }}' },
    { lookupColumn: 'status', lookupValue: 'Publishing' },
  ]));
  const S = "$('[Error] Sanitize error').first().json";
  sheets(w, '[Error] Mark posts failed', [1100, 100], sheetWrite('update', `${S}.spreadsheet_id`, 'Posts', {
    post_key: '={{ $json.post_key }}',
    status: 'Failed',
    error_message: `={{ 'Workflow lỗi: ' + ${S}.error_text + ' | Node lỗi: ' + ${S}.failed_node }}`,
  }, ['post_key']));
  sheets(w, '[Error] Find JD by execution', [880, 300], sheetRead('$json.spreadsheet_id', 'JD', [
    { lookupColumn: 'execution_id', lookupValue: '={{ $json.exec_ref }}' },
  ]));
  sheets(w, '[Error] Mark JD error', [1100, 300], sheetWrite('update', `${S}.spreadsheet_id`, 'JD', {
    jd_id: '={{ $json.jd_id }}',
    status: 'Error',
    error_message: `={{ ${S}.error_text + ' | Node lỗi: ' + ${S}.failed_node }}`,
  }, ['jd_id']));
  w.node('[Error] Should notify?', 'n8n-nodes-base.if', 2.2, [660, 500], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        { id: uuid('en1'), leftValue: '={{ $json.is_top_level }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
        { id: uuid('en2'), leftValue: '={{ $json.notify_channel }}', rightValue: 'telegram', operator: { type: 'string', operation: 'equals' } },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  });
  telegram(w, '[Error] Notify via Telegram', [880, 500], '$json.telegram_chat_id',
    '=🚨 {{ $json.workflow_name }} lỗi\nNode: {{ $json.failed_node }}\nLý do: {{ $json.error_text }}\n{{ $json.execution_url }}');
  w.chain('[Error] Error Trigger', '[Error] Load config', '[Error] Sanitize error');
  w.link('[Error] Sanitize error', '[Error] Is publish workflow?');
  w.link('[Error] Sanitize error', '[Error] Should notify?');
  w.link('[Error] Is publish workflow?', '[Error] Find publishing posts', 0);
  w.link('[Error] Is publish workflow?', '[Error] Find JD by execution', 1);
  w.link('[Error] Find publishing posts', '[Error] Mark posts failed');
  w.link('[Error] Find JD by execution', '[Error] Mark JD error');
  w.link('[Error] Should notify?', '[Error] Notify via Telegram', 0);
  w.sticky('[Error] Ghi chú', [-60, -60], 1300, 140,
    '## 99 · Error handler (dùng chung)\n**Input:** execution lỗi (production). **Output:** JD → `Error` (lọc CHỈ theo `execution_id`) hoặc Posts `Publishing` → `Failed`; báo Telegram (đã che token).\nLưu ý: chỉ chạy với execution production — test tay trong editor không kích hoạt.');
  built.push(write('error', w));
}

// =====================================================================
// 05a Publish one — đăng 1 dòng Posts; trả về kết quả chuẩn, KHÔNG ghi Sheet
// =====================================================================
{
  const w = createWorkflow('publishOne');
  const CTX = "$('[One] Precheck').first().json";
  trigger(w, '[One] When called', [0, 400]);
  codeNode(w, '[One] Precheck', [220, 400], function () {
    // Kiểm tra giới hạn ký tự theo tài liệu từng nền tảng và chọn nhánh xử lý.
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
  }, 'kiểm tra độ dài theo quy tắc riêng của Threads (emoji tính theo byte) và chọn route.');
  ifNode(w, '[One] Needs poster file?', [440, 400], '={{ $json.needs_poster_binary }}');
  w.node('[One] Download poster', 'n8n-nodes-base.googleDrive', 3, [660, 300], {
    operation: 'download',
    fileId: { __rl: true, mode: 'id', value: `={{ ${CTX}.post.poster_file_id }}` },
    options: {},
  }, { onError: 'continueRegularOutput', alwaysOutputData: true });
  const route = (key) => ({
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: uuid(`route:${key}`), leftValue: `={{ ${CTX}.route }}`, rightValue: key, operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey: key,
  });
  const ROUTES = ['dry_run', 'linkedin', 'threads', 'facebook_page', 'facebook_groups', 'confirm_manual', 'already_posted', 'invalid'];
  w.node('[One] Route by platform', 'n8n-nodes-base.switch', 3.2, [880, 400], {
    rules: { values: ROUTES.map(route) },
    options: {},
  });

  // Kết quả chuẩn mà 05-publish ghi lại vào Sheet
  const result = (name, pos, f) => setNode(w, name, pos, {
    post_key: `={{ ${CTX}.post.post_key }}`,
    platform: `={{ ${CTX}.post.platform }}`,
    status: f.status,
    platform_post_id: f.platform_post_id ?? `={{ ${CTX}.post.platform_post_id || '' }}`,
    post_url: f.post_url ?? `={{ ${CTX}.post.post_url || '' }}`,
    published_at: f.published_at ?? `={{ ${CTX}.post.published_at || '' }}`,
    error_message: f.error_message ?? '',
    retry_count: [`={{ Number(${CTX}.post.retry_count || 0) }}`, 'number'],
    scheduled_at: `={{ ${CTX}.post.scheduled_at || '' }}`,
    publish_log: f.publish_log ?? '',
    alert: [f.alert ?? false, 'boolean'],
    alert_text: f.alert_text ?? '',
  }, false, { executeOnce: true });
  const NOW = `={{ ${NOW_VN} }}`;

  // --- DRY_RUN ---
  codeNode(w, '[One] Dry run log', [1160, 0], function () {
    // Không gọi API: ghi lại chính xác các lời gọi SẼ thực hiện + nội dung bài.
    const { post, config, text, length } = $('[One] Precheck').first().json;
    const hasPoster = !!post.poster_file_id;
    const steps = {
      LinkedIn: [
        hasPoster ? `POST https://api.linkedin.com/rest/images?action=initializeUpload (owner urn:li:person:${config.linkedin_person_id}) → PUT ảnh poster` : 'Không có poster → bài chỉ có chữ',
        `POST https://api.linkedin.com/rest/posts (Linkedin-Version 202604, author urn:li:person:${config.linkedin_person_id}, visibility PUBLIC)`,
      ],
      Threads: (() => {
        const mode = config.threads_image_mode;
        const img = mode === 'text_only' || !hasPoster ? 'TEXT' : 'IMAGE';
        const threadSteps = [
          `POST ${config.threads_api_base}/${config.threads_user_id}/threads (media_type=${img}${img === 'IMAGE' ? `, image_url theo chế độ ${mode}` : ''})`,
          `Chờ ${config.threads_wait_seconds}s để Threads xử lý container`,
          `POST ${config.threads_api_base}/${config.threads_user_id}/threads_publish (creation_id=<id container>)`,
        ];
        return threadSteps;
      })(),
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

  // --- LinkedIn (node gốc n8n: Images API + Posts API, LinkedIn-Version 202604) ---
  w.node('[One] LinkedIn create post', 'n8n-nodes-base.linkedIn', 1, [1160, 160], {
    postAs: 'person',
    person: `={{ ${CTX}.config.linkedin_person_id }}`,
    text: `={{ ${CTX}.text }}`,
    shareMediaCategory: "={{ $binary?.data ? 'IMAGE' : 'NONE' }}",
    binaryPropertyName: 'data',
    additionalFields: { visibility: 'PUBLIC' },
  }, { onError: 'continueErrorOutput' });
  result('[One] Result · LinkedIn', [1400, 160], {
    status: 'Published',
    platform_post_id: '={{ $json.urn }}',
    post_url: "={{ 'https://www.linkedin.com/feed/update/' + $json.urn + '/' }}",
    published_at: NOW,
    publish_log: '={{ "LinkedIn OK: " + $json.urn }}',
  });

  // --- Threads (HTTP: tạo container → chờ → publish) ---
  const THREADS = (path) => `={{ ${CTX}.config.threads_api_base }}/{{ ${CTX}.config.threads_user_id }}/${path}`;
  const threadsHttp = (name, pos, method, url, jsonQuery, extra = {}) => w.node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method, url,
    authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
    sendQuery: true, specifyQuery: 'json', jsonQuery,
    options: {},
  }, extra);
  setNode(w, '[One] Threads image URL', [1160, 360], {
    image_url: `={{ (c => { const id = ${CTX}.post.poster_file_id; if (!id || c.threads_image_mode === 'text_only') return ''; if (c.threads_image_mode === 'url_template') return String(c.threads_image_url_template || '').replace('{file_id}', id); return 'https://drive.google.com/uc?export=download&id=' + id; })(${CTX}.config) }}`,
    needs_share: [`={{ ${CTX}.config.threads_image_mode === 'drive_public' && !!${CTX}.post.poster_file_id }}`, 'boolean'],
  });
  ifNode(w, '[One] Share poster for Threads?', [1380, 360], '={{ $json.needs_share }}');
  w.node('[One] Share poster (Threads)', 'n8n-nodes-base.googleDrive', 3, [1600, 300], {
    operation: 'share',
    fileId: { __rl: true, mode: 'id', value: `={{ ${CTX}.post.poster_file_id }}` },
    permissionsUi: { permissionsValues: { role: 'reader', type: 'anyone' } },
    options: {},
  }, { onError: 'continueRegularOutput' });
  const IMG = "$('[One] Threads image URL').first().json.image_url";
  threadsHttp('[One] Threads create container', [1820, 360], 'POST', THREADS('threads'),
    `={{ JSON.stringify(${IMG} ? { media_type: 'IMAGE', image_url: ${IMG}, text: ${CTX}.text } : { media_type: 'TEXT', text: ${CTX}.text }) }}`,
    { onError: 'continueErrorOutput' });
  w.node('[One] Threads wait for processing', 'n8n-nodes-base.wait', 1.1, [2040, 360], {
    resume: 'timeInterval', amount: `={{ Number(${CTX}.config.threads_wait_seconds || 30) }}`, unit: 'seconds',
  }, { webhookId: uuid('threads-wait') });
  threadsHttp('[One] Threads publish', [2260, 360], 'POST', THREADS('threads_publish'),
    "={{ JSON.stringify({ creation_id: $('[One] Threads create container').first().json.id }) }}",
    { onError: 'continueErrorOutput' });
  w.node('[One] Threads get permalink', 'n8n-nodes-base.httpRequest', 4.2, [2480, 360], {
    method: 'GET',
    url: `={{ ${CTX}.config.threads_api_base }}/{{ $json.id }}`,
    authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
    sendQuery: true, specifyQuery: 'keypair', queryParameters: { parameters: [{ name: 'fields', value: 'id,permalink' }] },
    options: {},
  }, { onError: 'continueRegularOutput' });
  result('[One] Result · Threads', [2700, 360], {
    status: 'Published',
    platform_post_id: "={{ $('[One] Threads publish').first().json.id }}",
    post_url: "={{ $json.permalink ?? '' }}",
    published_at: NOW,
    publish_log: `={{ 'Threads OK (' + (${IMG} ? 'IMAGE' : 'TEXT') + '): ' + $('[One] Threads publish').first().json.id }}`,
  });

  // --- Facebook Page (Graph API, Page access token trong credential facebookGraphApi) ---
  const FB = (edge) => `=https://graph.facebook.com/{{ ${CTX}.config.facebook_graph_version }}/{{ ${CTX}.config.facebook_page_id }}/${edge}`;
  ifNode(w, '[One] Facebook has image?', [1160, 600], '={{ Boolean($binary?.data) }}');
  w.node('[One] Facebook post photo', 'n8n-nodes-base.httpRequest', 4.2, [1380, 540], {
    method: 'POST', url: FB('photos'),
    authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
    sendBody: true, contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        { parameterType: 'formBinaryData', name: 'source', inputDataFieldName: 'data' },
        { name: 'caption', value: `={{ ${CTX}.text }}` },
        { name: 'published', value: 'true' },
      ],
    },
    options: {},
  }, { onError: 'continueErrorOutput' });
  w.node('[One] Facebook post text', 'n8n-nodes-base.httpRequest', 4.2, [1380, 700], {
    method: 'POST', url: FB('feed'),
    authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi',
    sendBody: true, contentType: 'form-urlencoded',
    bodyParameters: { parameters: [{ name: 'message', value: `={{ ${CTX}.text }}` }] },
    options: {},
  }, { onError: 'continueErrorOutput' });
  result('[One] Result · Facebook Page', [1620, 600], {
    status: 'Published',
    platform_post_id: '={{ $json.post_id ?? $json.id }}',
    post_url: "={{ 'https://www.facebook.com/' + ($json.post_id ?? $json.id) }}",
    published_at: NOW,
    publish_log: '={{ "Facebook Page OK: " + ($json.post_id ?? $json.id) }}',
  });

  // --- Facebook Groups: KHÔNG có API → bàn giao đăng tay ---
  result('[One] Groups manual handoff', [1160, 820], {
    status: 'Manual - Waiting',
    publish_log: `={{ 'Chờ đăng tay vào các nhóm:\\n' + (${CTX}.config.facebook_group_links || '(chưa cấu hình facebook_group_links)') + '\\nPoster: ' + (${CTX}.post.poster_url || '(không có)') }}`,
    alert: true,
    alert_text: `={{ '📝 Cần ĐĂNG TAY Facebook Groups (' + ${CTX}.post.post_key + ')\\nNhóm: ' + (${CTX}.config.facebook_group_links || '(chưa cấu hình)') + '\\nPoster: ' + (${CTX}.post.poster_url || '(không có)') + '\\n\\nNội dung:\\n' + ${CTX}.text + '\\n\\nĐăng xong: đổi status dòng này trong tab Posts thành "Manual - Confirmed" (có thể dán link bài vào post_url).' }}`,
  });
  result('[One] Result · Manual confirmed', [1160, 960], {
    status: 'Published (manual)',
    published_at: `={{ ${CTX}.post.published_at || ${NOW_VN} }}`,
    publish_log: 'Người phụ trách xác nhận đã đăng tay',
  });
  result('[One] Result · Already posted', [1160, 1100], {
    status: 'Published',
    publish_log: 'Bỏ qua: dòng đã có platform_post_id (chống đăng trùng)',
  });
  result('[One] Result · Invalid', [1160, 1240], {
    status: 'Failed',
    error_message: `={{ ${CTX}.reason }}`,
    alert: true,
    alert_text: `={{ '❌ Không đăng ' + ${CTX}.post.platform + ' (' + ${CTX}.post.post_key + '): ' + ${CTX}.reason }}`,
  });

  // --- Phân loại lỗi API: 429/5xx/mạng → hẹn lại (backoff); 401/403/4xx → Failed + cảnh báo ---
  codeNode(w, '[One] Classify API error', [2000, 800], function () {
    // Phân loại lỗi để quyết định thử lại có backoff hay dừng hẳn; che token trong thông báo.
    const { post, config } = $('[One] Precheck').first().json;
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
      return [{
        json: {
          ...base, status: 'Approved', retry_count: retryCount + 1,
          scheduled_at: $now.setZone('Asia/Ho_Chi_Minh').plus({ minutes }).toFormat('yyyy-MM-dd HH:mm:ss'),
          error_message: `Lỗi tạm thời (HTTP ${code || 'mạng'}), sẽ thử lại lần ${retryCount + 1}/${max} sau ${minutes} phút: ${reason}`,
          alert: false, alert_text: '',
        },
      }];
    }
    const hint = authError
      ? 'Token hết hạn hoặc thiếu quyền — kiểm tra credential và quyền của app. Không thử lại.'
      : (retryable ? `Đã thử lại ${retryCount}/${max} lần.` : 'Lỗi dữ liệu/cấu hình — không thử lại.');
    return [{
      json: {
        ...base, status: 'Failed', retry_count: retryCount, scheduled_at: post.scheduled_at || '',
        error_message: `HTTP ${code || '?'}: ${reason}. ${hint}`,
        alert: true, alert_text: `❌ Đăng ${post.platform} thất bại (${post.post_key}) — HTTP ${code || '?'}. ${hint}`,
      },
    }];
  }, 'phân loại mã lỗi HTTP từ nhiều node khác nhau và tính lịch thử lại có backoff.');

  ifNode(w, '[One] Alert needed?', [2960, 600], `={{ $json.alert === true && ${CTX}.config.notify_channel === 'telegram' }}`);
  telegram(w, '[One] Send alert', [3180, 500], `${CTX}.config.telegram_chat_id`, '={{ $json.alert_text }}');
  codeNode(w, '[One] Return result', [3400, 600], function () {
    // Trả về kết quả chuẩn (bỏ output của Telegram nếu có).
    return [{ json: $('[One] Alert needed?').first().json }];
  }, 'khôi phục item kết quả sau nhánh gửi Telegram.');

  w.chain('[One] When called', '[One] Precheck', '[One] Needs poster file?');
  w.link('[One] Needs poster file?', '[One] Download poster', 0);
  w.link('[One] Needs poster file?', '[One] Route by platform', 1);
  w.link('[One] Download poster', '[One] Route by platform');
  const OUTS = {
    dry_run: '[One] Dry run log', linkedin: '[One] LinkedIn create post', threads: '[One] Threads image URL',
    facebook_page: '[One] Facebook has image?', facebook_groups: '[One] Groups manual handoff',
    confirm_manual: '[One] Result · Manual confirmed', already_posted: '[One] Result · Already posted', invalid: '[One] Result · Invalid',
  };
  ROUTES.forEach((r, i) => w.link('[One] Route by platform', OUTS[r], i));
  w.link('[One] LinkedIn create post', '[One] Result · LinkedIn', 0);
  w.link('[One] LinkedIn create post', '[One] Classify API error', 1);
  w.link('[One] Threads image URL', '[One] Share poster for Threads?');
  w.link('[One] Share poster for Threads?', '[One] Share poster (Threads)', 0);
  w.link('[One] Share poster for Threads?', '[One] Threads create container', 1);
  w.link('[One] Share poster (Threads)', '[One] Threads create container');
  w.link('[One] Threads create container', '[One] Threads wait for processing', 0);
  w.link('[One] Threads create container', '[One] Classify API error', 1);
  w.link('[One] Threads wait for processing', '[One] Threads publish');
  w.link('[One] Threads publish', '[One] Threads get permalink', 0);
  w.link('[One] Threads publish', '[One] Classify API error', 1);
  w.link('[One] Threads get permalink', '[One] Result · Threads');
  w.link('[One] Facebook has image?', '[One] Facebook post photo', 0);
  w.link('[One] Facebook has image?', '[One] Facebook post text', 1);
  w.link('[One] Facebook post photo', '[One] Result · Facebook Page', 0);
  w.link('[One] Facebook post photo', '[One] Classify API error', 1);
  w.link('[One] Facebook post text', '[One] Result · Facebook Page', 0);
  w.link('[One] Facebook post text', '[One] Classify API error', 1);
  for (const n of ['[One] Dry run log', '[One] Result · LinkedIn', '[One] Result · Threads', '[One] Result · Facebook Page',
    '[One] Groups manual handoff', '[One] Result · Manual confirmed', '[One] Result · Already posted', '[One] Result · Invalid', '[One] Classify API error']) {
    w.link(n, '[One] Alert needed?');
  }
  w.link('[One] Alert needed?', '[One] Send alert', 0);
  w.link('[One] Alert needed?', '[One] Return result', 1);
  w.link('[One] Send alert', '[One] Return result');
  w.sticky('[One] Ghi chú', [-60, 100], 1200, 220,
    '## 05a · Publish one\n**Input:** `request = {post (1 dòng Posts + action), config}`. **Output:** `{post_key, status, platform_post_id, post_url, published_at, error_message, retry_count, scheduled_at, publish_log}`.\nKhông ghi Sheet (05-publish ghi). DRY_RUN → chỉ log. Facebook Groups → luôn đăng tay, không gọi API.\n**Lỗi thường gặp:** 401/403 token hết hạn/thiếu quyền → Failed + cảnh báo; 429/5xx → hẹn lại có backoff.');
  built.push(write('publishOne', w));
}

// =====================================================================
// 05 Publish — poll dòng Approved, claim, đăng từng dòng, cập nhật JD
// =====================================================================
{
  const w = createWorkflow('publish');
  const CFG = "$('[Publish] Load config').first().json";
  w.node('[Publish] Every 5 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 200], { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } });
  w.node('[Publish] Run manually', 'n8n-nodes-base.manualTrigger', 1, [0, 400], {});
  w.node('[Publish] Webhook publish one', 'n8n-nodes-base.webhook', 2.1, [0, 600], {
    httpMethod: 'POST', path: 'jd-publish-one', authentication: 'basicAuth', responseMode: 'onReceived', options: {},
  }, { webhookId: uuid('v3-publish-one-webhook'), credentials: CRED.basicAuth });
  setNode(w, '[Publish] Capture request', [240, 400], {
    only_post_key: "={{ $json.body?.post_key ?? '' }}",
    run_started_at: `={{ ${NOW_VN} }}`,
  });
  execWf(w, '[Publish] Load config', [460, 400], 'config');
  sheets(w, '[Publish] Read posts', [680, 400], sheetRead('$json.spreadsheet_id', 'Posts'), { alwaysOutputData: true, executeOnce: true });
  codeNode(w, '[Publish] Pick due posts', [900, 400], function () {
    // Chọn dòng được phép đăng: Approved (hoặc Manual - Confirmed), nền tảng đang bật, tới giờ hẹn,
    // tôn trọng khoảng cách tối thiểu giữa 2 bài cùng nền tảng; tối đa 1 bài/nền tảng/lần chạy.
    const cfg = $('[Publish] Load config').first().json;
    const isTrue = (v) => v === true || String(v) === 'true';
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
      .filter((r) => isTrue(ENABLED[r.platform]))
      .filter((r) => { const s = parse(r.scheduled_at); return !s || !s.isValid || s <= now; })
      .sort((a, b) => String(a.scheduled_at || a.created_at).localeCompare(String(b.scheduled_at || b.created_at)));
    for (const r of candidates) {
      let action;
      if (r.status === 'Manual - Confirmed') action = 'confirm_manual';
      else if (r.platform_post_id) action = 'already_posted';
      else if (r.platform === 'Facebook Groups') action = 'manual_handoff';
      else {
        if (!isTrue(cfg.dry_run)) {
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
  }, 'lọc nhiều điều kiện (trạng thái, giờ hẹn, khoảng cách tối thiểu theo nền tảng) trên toàn bộ dòng.');
  sheets(w, '[Publish] Claim posts', [1120, 400], sheetWrite('update', `${CFG}.spreadsheet_id`, 'Posts', {
    post_key: '={{ $json.post_key }}',
    status: 'Publishing',
    execution_id: "={{ 'exec-' + $execution.id }}",
  }, ['post_key']));
  w.node('[Publish] One at a time', 'n8n-nodes-base.splitInBatches', 3, [1340, 400], { batchSize: 1, options: {} });
  setNode(w, '[Publish] Build request', [1560, 520], {
    request: [`={{ { post: $('[Publish] Pick due posts').item.json, config: ${CFG} } }}`, 'object'],
  });
  w.node('[Publish] Random wait', 'n8n-nodes-base.wait', 1.1, [1780, 520], {
    resume: 'timeInterval',
    amount: '={{ $json.request.config.dry_run ? 1 : Math.max(1, Math.floor(Math.random() * Number($json.request.config.random_wait_max_seconds || 1))) }}',
    unit: 'seconds',
  }, { webhookId: uuid('publish-random-wait') });
  execWf(w, '[Publish] Run publish one', [2000, 520], 'publishOne', 'each', { onError: 'continueErrorOutput' });
  setNode(w, '[Publish] Crash result', [2220, 680], {
    post_key: "={{ $('[Publish] Build request').item.json.request.post.post_key }}",
    status: 'Failed',
    error_message: "={{ 'Sub-workflow publish-one lỗi: ' + String($json.error?.message ?? $json.error ?? 'không rõ').slice(0, 300) }}",
    retry_count: ["={{ Number($('[Publish] Build request').item.json.request.post.retry_count || 0) }}", 'number'],
    scheduled_at: "={{ $('[Publish] Build request').item.json.request.post.scheduled_at || '' }}",
    platform_post_id: '', post_url: '', published_at: '', publish_log: '',
  });
  const RESULT_COLS = ['post_key', 'status', 'platform_post_id', 'post_url', 'published_at', 'error_message', 'retry_count', 'scheduled_at', 'publish_log'];
  sheets(w, '[Publish] Save result', [2440, 520], sheetWrite('update', `${CFG}.spreadsheet_id`, 'Posts',
    Object.fromEntries(RESULT_COLS.map((c) => [c, `={{ $json.${c} }}`])), ['post_key']));
  sheets(w, '[Publish] Read posts after', [1560, 260], sheetRead(`${CFG}.spreadsheet_id`, 'Posts'), { alwaysOutputData: true, executeOnce: true });
  codeNode(w, '[Publish] Compute JD status', [1780, 260], function () {
    // JD = Published khi mọi nền tảng đã đăng; Partially Published khi mới đăng một phần.
    const touched = new Set($('[Publish] Pick due posts').all().map((i) => i.json.jd_id));
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
  sheets(w, '[Publish] Update JD status', [2000, 260], sheetWrite('update', `${CFG}.spreadsheet_id`, 'JD', {
    jd_id: '={{ $json.jd_id }}', status: '={{ $json.status }}', step: '={{ $json.step }}',
  }, ['jd_id']));

  w.link('[Publish] Every 5 minutes', '[Publish] Capture request');
  w.link('[Publish] Run manually', '[Publish] Capture request');
  w.link('[Publish] Webhook publish one', '[Publish] Capture request');
  w.chain('[Publish] Capture request', '[Publish] Load config', '[Publish] Read posts', '[Publish] Pick due posts', '[Publish] Claim posts', '[Publish] One at a time');
  w.link('[Publish] One at a time', '[Publish] Read posts after', 0);
  w.link('[Publish] One at a time', '[Publish] Build request', 1);
  w.chain('[Publish] Build request', '[Publish] Random wait', '[Publish] Run publish one');
  w.link('[Publish] Run publish one', '[Publish] Save result', 0);
  w.link('[Publish] Run publish one', '[Publish] Crash result', 1);
  w.link('[Publish] Crash result', '[Publish] Save result');
  w.link('[Publish] Save result', '[Publish] One at a time');
  w.chain('[Publish] Read posts after', '[Publish] Compute JD status', '[Publish] Update JD status');
  w.sticky('[Publish] Ghi chú', [-60, -60], 1300, 220,
    '## 05 · Publish (poll 5 phút)\n**Input:** tab Posts. Chỉ dòng `Approved` (hoặc `Manual - Confirmed`) + nền tảng bật + tới `scheduled_at`. **Output:** cập nhật từng dòng theo `post_key`, JD → `Published`/`Partially Published`.\nChống trùng: claim `Publishing` trước khi đăng; dòng đã có `platform_post_id` bị bỏ qua. `dry_run=true` (mặc định) → không gọi API.\n**Lỗi thường gặp:** thiếu cột mới trong tab Posts; credential nền tảng chưa gán.');
  built.push(write('publish', w));
}

// =====================================================================
// 06 Token health — kiểm tra token mỗi ngày, tự làm mới token Threads
// =====================================================================
{
  const w = createWorkflow('token', { saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false });
  const CFG = "$('[Token] Load config').first().json";
  w.node('[Token] Every day 08:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 200], { rule: { interval: [{ field: 'days', triggerAtHour: 8 }] } });
  w.node('[Token] Run manually', 'n8n-nodes-base.manualTrigger', 1, [0, 400], {});
  execWf(w, '[Token] Load config', [220, 300], 'config');
  sheets(w, '[Token] Read token dates', [440, 300], sheetRead('$json.spreadsheet_id', 'Tokens'), { alwaysOutputData: true, executeOnce: true, onError: 'continueRegularOutput' });
  const check = (name, pos, url, auth) => w.node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'GET', url, ...auth,
    options: { response: { response: { fullResponse: true, neverError: true } } },
  }, { onError: 'continueRegularOutput', executeOnce: true, alwaysOutputData: true });
  check('[Token] Check LinkedIn', [660, 300], 'https://api.linkedin.com/v2/userinfo', { authentication: 'predefinedCredentialType', nodeCredentialType: 'linkedInOAuth2Api' });
  check('[Token] Check Threads', [880, 300], `={{ ${CFG}.threads_api_base }}/me?fields=id,username`, { authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth' });
  check('[Token] Check Facebook Page', [1100, 300], `=https://graph.facebook.com/{{ ${CFG}.facebook_graph_version }}/{{ ${CFG}.facebook_page_id }}?fields=id,name`, { authentication: 'predefinedCredentialType', nodeCredentialType: 'facebookGraphApi' });
  codeNode(w, '[Token] Build report', [1320, 300], function () {
    // Tổng hợp kết quả kiểm tra token + ngày hết hạn (tab Tokens) thành danh sách cảnh báo.
    const cfg = $('[Token] Load config').first().json;
    const zone = 'Asia/Ho_Chi_Minh';
    const now = DateTime.now().setZone(zone);
    const isTrue = (v) => v === true || String(v) === 'true';
    const tokens = $('[Token] Read token dates').all().map((i) => i.json).filter((r) => r.platform);
    const checks = {
      LinkedIn: [$('[Token] Check LinkedIn').first().json, cfg.enable_linkedin],
      Threads: [$('[Token] Check Threads').first().json, cfg.enable_threads],
      'Facebook Page': [$('[Token] Check Facebook Page').first().json, cfg.enable_facebook_page],
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
  ifNode(w, '[Token] Refresh Threads?', [1540, 200], '={{ $json.refresh_threads }}');
  w.node('[Token] Refresh Threads token', 'n8n-nodes-base.httpRequest', 4.2, [1760, 100], {
    method: 'GET', url: 'https://graph.threads.com/refresh_access_token',
    authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth',
    sendQuery: true, specifyQuery: 'keypair', queryParameters: { parameters: [{ name: 'grant_type', value: 'th_refresh_token' }] },
    options: {},
  }, { onError: 'continueErrorOutput' });
  w.node('[Token] Save Threads token to n8n', 'n8n-nodes-base.httpRequest', 4.2, [1980, 100], {
    method: 'PATCH',
    url: `={{ ${CFG}.n8n_internal_url }}/api/v1/credentials/{{ ${CFG}.threads_credential_id }}`,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ data: { name: 'access_token', value: $json.access_token } }) }}",
    options: {},
  }, { onError: 'continueErrorOutput' });
  sheets(w, '[Token] Record Threads expiry', [2200, 100], sheetWrite('appendOrUpdate', `${CFG}.spreadsheet_id`, 'Tokens', {
    platform: 'Threads',
    expires_at: "={{ $now.setZone('Asia/Ho_Chi_Minh').plus({ seconds: Number($('[Token] Refresh Threads token').first().json.expires_in || 0) }).toFormat('yyyy-MM-dd HH:mm:ss') }}",
    last_refreshed: `={{ ${NOW_VN} }}`,
    note: 'Tự làm mới bởi jd-06-token-health',
  }, ['platform']));
  setNode(w, '[Token] Refresh failed', [2200, 260], {
    alert_text: "={{ '❌ Làm mới token Threads thất bại ở ' + $prevNode.name + ': ' + String($json.error?.message ?? $json.error ?? '').replace(/access_token=[^&\\s]+/gi, 'access_token=***').slice(0, 300) + '. Làm mới thủ công theo README-publish.' }}",
    has_alerts: [true, 'boolean'],
  });
  ifNode(w, '[Token] Any alerts?', [1540, 420], `={{ $json.has_alerts && ${CFG}.notify_channel === 'telegram' }}`);
  telegram(w, '[Token] Send alerts', [1760, 420], `${CFG}.telegram_chat_id`, '=🔑 Kiểm tra token đăng bài\n{{ $json.alert_text }}');
  w.link('[Token] Every day 08:00', '[Token] Load config');
  w.link('[Token] Run manually', '[Token] Load config');
  w.chain('[Token] Load config', '[Token] Read token dates', '[Token] Check LinkedIn', '[Token] Check Threads', '[Token] Check Facebook Page', '[Token] Build report');
  w.link('[Token] Build report', '[Token] Refresh Threads?');
  w.link('[Token] Build report', '[Token] Any alerts?');
  w.link('[Token] Refresh Threads?', '[Token] Refresh Threads token', 0);
  w.link('[Token] Refresh Threads token', '[Token] Save Threads token to n8n', 0);
  w.link('[Token] Refresh Threads token', '[Token] Refresh failed', 1);
  w.link('[Token] Save Threads token to n8n', '[Token] Record Threads expiry', 0);
  w.link('[Token] Save Threads token to n8n', '[Token] Refresh failed', 1);
  w.link('[Token] Refresh failed', '[Token] Any alerts?');
  w.link('[Token] Any alerts?', '[Token] Send alerts', 0);
  w.sticky('[Token] Ghi chú', [-60, -100], 1300, 180,
    '## 06 · Token health (08:00 hằng ngày)\nKiểm tra token LinkedIn/Threads/Facebook Page, cảnh báo trước khi hết hạn (tab `Tokens`), tự làm mới token Threads (≥ 24h tuổi, chưa hết hạn) và ghi token mới vào credential qua n8n API.\nWorkflow KHÔNG lưu dữ liệu execution để token mới không nằm trong log.');
  built.push(write('token', w));
}

// =====================================================================
// [test] DRY_RUN: chạy 4 bài mẫu qua 05a-publish-one, không cần Google Sheets
// =====================================================================
{
  const w = createWorkflow('test');
  const SAMPLES = JSON.parse(read('test-data/publish-sample-posts.json'));
  w.node('[Test] Run manually', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {});
  execWf(w, '[Test] Load config', [220, 300], 'config');
  codeNode(w, '[Test] Sample approved posts', [440, 300], function () {
    // 4 bài mẫu (test-data/publish-sample-posts.json), ÉP dry_run = true để không bao giờ gọi API thật.
    const cfg = { ...$input.first().json, dry_run: true, enable_linkedin: true, enable_threads: true, enable_facebook_page: true, enable_facebook_groups: true };
    const SAMPLES = __SAMPLES__;
    return SAMPLES.map((p) => ({ json: { request: { post: { ...p, action: p.platform === 'Facebook Groups' ? 'manual_handoff' : 'publish' }, config: cfg } } }));
  }, 'nhúng dữ liệu mẫu và ép DRY_RUN.', { __SAMPLES__: JSON.stringify(SAMPLES) });
  execWf(w, '[Test] Run publish one', [660, 300], 'publishOne', 'each');
  codeNode(w, '[Test] Summarize', [880, 300], function () {
    // Tóm tắt kết quả DRY_RUN cho 4 nền tảng.
    const results = $input.all().map((i) => i.json);
    return [{ json: { total: results.length, statuses: results.map((r) => `${r.platform}: ${r.status}`), logs: results.map((r) => r.publish_log) } }];
  }, 'gộp 4 kết quả thành 1 báo cáo.');
  w.chain('[Test] Run manually', '[Test] Load config', '[Test] Sample approved posts', '[Test] Run publish one', '[Test] Summarize');
  w.sticky('[Test] Ghi chú', [-60, 40], 1000, 200,
    '## [test] DRY_RUN đăng bài\nChạy 4 bài mẫu qua `jd-05a-publish-one` với `dry_run` bị ép = true. Không đọc/ghi Google Sheets, không gọi API đăng.\nChạy: nút Test workflow, hoặc `docker compose exec n8n n8n execute --id=jd3TestPublish00`.');
  built.push(write('test', w));
}

console.log(`Đã ghi ${built.length} workflow vào ${OUT}:\n- ${built.join('\n- ')}`);
