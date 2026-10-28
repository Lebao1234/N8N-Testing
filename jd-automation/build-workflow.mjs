// Sinh jd-automation.v2.json từ prompts/ và schemas/ (nguồn duy nhất cho system prompt + schema).
// Chạy: node jd-automation/build-workflow.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').trim();
const prompt = (name) => read(`prompts/${name}.system.md`);
const schema = (name) => read(`schemas/${name}.schema.json`);
const SHARED_WRITER_RULES = read('prompts/_shared-writer-rules.md');

// ---------- Hằng số ----------
const WORKFLOW_ID = 'jdAutoPostV20001';
const WORKFLOW_NAME = '[dev] jd-tuyen-dung-da-nen-tang';
const CLAUDE_MODEL = 'claude-sonnet-5-5';
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
const CRED = {
  basicAuth: { httpBasicAuth: { id: 'CLtFsk0dNV90Z52V', name: 'Unnamed credential' } },
  anthropic: { anthropicApi: { id: 'anthropicLocal01', name: 'Anthropic (from .env)' } },
  openAi: { openAiApi: { id: 'openAiLocal00001', name: 'OpenAI (from .env)' } },
};

// id node ổn định giữa các lần build (để diff git gọn)
const uuid = (seed) => {
  const h = createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const nodes = [];
const connections = {};
const node = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, type, typeVersion, position, id: uuid(name), name, ...extra });
};
const link = (from, to, type = 'main', outputIndex = 0) => {
  connections[from] ??= {};
  connections[from][type] ??= [];
  while (connections[from][type].length <= outputIndex) connections[from][type].push([]);
  connections[from][type][outputIndex].push({ node: to, type, index: 0 });
};
const chain = (...names) => names.slice(1).forEach((n, i) => link(names[i], n));
const sticky = (name, position, width, height, color, content) =>
  node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });

// ---------- Biểu thức dùng lại ----------
const FORM = "$('Generate JD ID').first().json";
const JD_ID = `${FORM}.jd_id`;
const ANALYSIS = "$('JD Analyzer').first().json.output";
const CFG = "$('Config').first().json";
const NOW_VN = "$now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss')";

const sheetDoc = (cfgExpr) => ({ __rl: true, mode: 'id', value: `={{ ${cfgExpr}.spreadsheet_id }}` });
const sheetTab = (tab) => ({ __rl: true, mode: 'name', value: tab, cachedResultName: tab });
const colSchema = (ids) =>
  ids.map((id) => ({
    id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true,
  }));
const JD_COLUMNS = ['jd_id', 'created_at', 'company', 'position', 'jd_detail', 'salary', 'contact', 'status',
  'error_message', 'poster_url', 'warnings', 'execution_id'];
const POSTS_COLUMNS = ['jd_id', 'platform', 'post_text', 'hashtags', 'poster_url', 'status', 'created_at'];
const sheetColumns = (value, matchingColumns = []) => ({
  mappingMode: 'defineBelow', value, matchingColumns, schema: colSchema(JD_COLUMNS),
  attemptToConvertTypes: false, convertFieldsToString: true,
});
const updateJd = (cfgExpr, value) => ({
  operation: 'update',
  documentId: sheetDoc(cfgExpr),
  sheetName: sheetTab('JD'),
  columns: sheetColumns(value, ['jd_id']),
  options: {},
});

const claudeModel = (name, position, temperature) =>
  node(name, '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, position, {
    model: { __rl: true, mode: 'id', value: CLAUDE_MODEL },
    options: { temperature, maxTokensToSample: 4096 },
  }, { credentials: CRED.anthropic });

const parser = (name, position, schemaName) =>
  node(name, '@n8n/n8n-nodes-langchain.outputParserStructured', 1.3, position, {
    schemaType: 'manual', inputSchema: schema(schemaName), autoFix: true,
  });

// Basic LLM Chain + Claude model + Structured Output Parser (auto-fix dùng chính model đó)
const llmChain = ({ name, modelName, parserName, position, systemPrompt, text, schemaName, temperature }) => {
  node(name, '@n8n/n8n-nodes-langchain.chainLlm', 1.9, position, {
    promptType: 'define',
    text,
    hasOutputParser: true,
    messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: systemPrompt }] },
  }, RETRY);
  claudeModel(modelName, [position[0] - 80, position[1] + 220], temperature);
  parser(parserName, [position[0] + 140, position[1] + 220], schemaName);
  link(modelName, name, 'ai_languageModel');
  link(modelName, parserName, 'ai_languageModel');
  link(parserName, name, 'ai_outputParser');
};

// ===================================================================
// Nhóm 1 - Prepare job description
// ===================================================================
node('JD Input Form', 'n8n-nodes-base.formTrigger', 2.6, [0, 300], {
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
  options: {},
}, { webhookId: uuid('jd-input-form-webhook'), credentials: CRED.basicAuth });

node('Config', 'n8n-nodes-base.set', 3.4, [220, 300], {
  assignments: {
    assignments: [
      { id: uuid('cfg1'), name: 'spreadsheet_id', value: 'REPLACE_WITH_SPREADSHEET_ID', type: 'string' },
      { id: uuid('cfg2'), name: 'drive_folder_id', value: 'REPLACE_WITH_DRIVE_FOLDER_ID', type: 'string' },
      { id: uuid('cfg3'), name: 'logo_path', value: '/files/jd-automation/logo.png', type: 'string' },
      { id: uuid('cfg4'), name: 'enable_text_overlay', value: true, type: 'boolean' },
      { id: uuid('cfg5'), name: 'image_model', value: 'gpt-image-1', type: 'string' },
      { id: uuid('cfg6'), name: 'overlay_font', value: '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf', type: 'string' },
    ],
  },
  includeOtherFields: true,
  options: {},
});

node('Generate JD ID', 'n8n-nodes-base.crypto', 2, [440, 300], {
  action: 'generate',
  dataPropertyName: 'jd_id',
  encodingType: 'uuid',
});

node('Add JD Row', 'n8n-nodes-base.googleSheets', 4.7, [660, 300], {
  operation: 'append',
  documentId: sheetDoc(CFG),
  sheetName: sheetTab('JD'),
  columns: sheetColumns({
    jd_id: '={{ $json.jd_id }}',
    created_at: `={{ ${NOW_VN} }}`,
    company: "={{ $json['Tên Công Ty'] }}",
    position: "={{ $json['Vị Trí'] }}",
    jd_detail: "={{ $json['Chi Tiết JD'] }}",
    salary: "={{ $json['Mức Lương'] }}",
    contact: "={{ $json['Liên Hệ'] }}",
    status: 'New',
    error_message: '',
    poster_url: '',
    warnings: '',
    execution_id: '=exec-{{ $execution.id }}',
  }),
  options: {},
}, RETRY);

node('Set Processing', 'n8n-nodes-base.googleSheets', 4.7, [880, 300],
  updateJd(CFG, { jd_id: `={{ ${JD_ID} }}`, status: 'Processing' }), RETRY);

chain('JD Input Form', 'Config', 'Generate JD ID', 'Add JD Row', 'Set Processing');

// ===================================================================
// Nhóm 2 - Flag failed job (Error Trigger trong chính workflow này)
// ===================================================================
node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [0, 900], {});
node('Error Config', 'n8n-nodes-base.set', 3.4, [220, 900], {
  assignments: {
    assignments: [
      { id: uuid('ecfg1'), name: 'spreadsheet_id', value: 'REPLACE_WITH_SPREADSHEET_ID', type: 'string' },
    ],
  },
  includeOtherFields: true,
  options: {},
});
node('Find Processing JD', 'n8n-nodes-base.googleSheets', 4.7, [440, 900], {
  operation: 'read',
  documentId: sheetDoc("$('Error Config').first().json"),
  sheetName: sheetTab('JD'),
  filtersUI: {
    values: [
      { lookupColumn: 'status', lookupValue: 'Processing' },
      { lookupColumn: 'execution_id', lookupValue: "=exec-{{ $('Error Trigger').first().json.execution.id }}" },
    ],
  },
  combineFilters: 'AND',
  options: {},
}, RETRY);
node('Set Error', 'n8n-nodes-base.googleSheets', 4.7, [660, 900],
  updateJd("$('Error Config').first().json", {
    jd_id: '={{ $json.jd_id }}',
    status: 'Error',
    error_message:
      "={{ $('Error Trigger').first().json.execution.error?.message ?? 'Lỗi không xác định' }} | Node lỗi: {{ $('Error Trigger').first().json.execution.lastNodeExecuted ?? 'không rõ' }}",
  }), RETRY);
chain('Error Trigger', 'Error Config', 'Find Processing JD', 'Set Error');

// ===================================================================
// Nhóm 3 - Analyze job description
// ===================================================================
node('JD Analyzer', '@n8n/n8n-nodes-langchain.agent', 3.1, [1180, 300], {
  promptType: 'define',
  text:
    `=Tên Công Ty: {{ ${FORM}['Tên Công Ty'] }}\n` +
    `Vị Trí: {{ ${FORM}['Vị Trí'] }}\n` +
    `Mức Lương (form): {{ ${FORM}['Mức Lương'] || '(để trống)' }}\n` +
    `Liên Hệ (form): {{ ${FORM}['Liên Hệ'] || '(để trống)' }}\n` +
    `Chi Tiết JD:\n{{ ${FORM}['Chi Tiết JD'] }}`,
  hasOutputParser: true,
  options: { systemMessage: prompt('jd-analyzer'), maxIterations: 3 },
}, RETRY);
claudeModel('Claude Chat Model', [1100, 520], 0.2);
parser('JD Analysis Parser', [1320, 520], 'jd-analysis');
link('Claude Chat Model', 'JD Analyzer', 'ai_languageModel');
link('Claude Chat Model', 'JD Analysis Parser', 'ai_languageModel');
link('JD Analysis Parser', 'JD Analyzer', 'ai_outputParser');
link('Set Processing', 'JD Analyzer');

// ===================================================================
// Nhóm 4 - Write platform posts
// ===================================================================
const PLATFORMS = [
  { key: 'linkedin', label: 'LinkedIn', writer: 'LinkedIn Writer', model: 'LinkedIn Model', parser: 'LinkedIn Parser', file: 'linkedin-writer', temp: 0.6 },
  { key: 'threads', label: 'Threads', writer: 'Threads Writer', model: 'Threads Model', parser: 'Threads Parser', file: 'threads-writer', temp: 0.8 },
  { key: 'facebook_groups', label: 'Facebook Groups', writer: 'Facebook Groups Writer', model: 'Facebook Groups Model', parser: 'Facebook Groups Parser', file: 'facebook-groups-writer', temp: 0.8 },
  { key: 'facebook_page', label: 'Facebook Page', writer: 'Facebook Page Writer', model: 'Facebook Page Model', parser: 'Facebook Page Parser', file: 'facebook-page-writer', temp: 0.7 },
];
PLATFORMS.forEach((p, i) => {
  const previous = PLATFORMS.slice(0, i)
    .map((q) => `--- ${q.label} ---\n{{ $('${q.writer}').first().json.output.post_text.slice(0, 400) }}`)
    .join('\n');
  llmChain({
    name: p.writer, modelName: p.model, parserName: p.parser,
    position: [1560 + i * 420, 300],
    systemPrompt: `${prompt(p.file)}\n\n${SHARED_WRITER_RULES}`,
    schemaName: 'platform-post',
    temperature: p.temp,
    text:
      `=Hãy viết bài đăng tuyển dụng cho nền tảng ${p.label}.\n\n` +
      `Tên công ty: {{ ${FORM}['Tên Công Ty'] }}\n` +
      `Dữ liệu JD đã phân tích (JSON):\n{{ JSON.stringify(${ANALYSIS}, null, 2) }}` +
      (previous ? `\n\nCác bài đã viết cho nền tảng khác (KHÔNG lặp lại câu mở đầu, cấu trúc hay câu chữ):\n${previous}` : ''),
  });
});
chain('JD Analyzer', ...PLATFORMS.map((p) => p.writer));

// ===================================================================
// Nhóm 5 - Plan poster
// ===================================================================
const NOT_STATED = (expr) => `/^\\s*(không nêu|khong neu)?\\s*$/i.test(${expr} ?? '')`;
node('Poster Content Selector', 'n8n-nodes-base.set', 3.4, [3300, 300], {
  assignments: {
    assignments: [
      { id: uuid('pcs1'), name: 'jd_id', value: `={{ ${JD_ID} }}`, type: 'string' },
      { id: uuid('pcs2'), name: 'poster_position', value: `={{ (${ANALYSIS}.job_title_chuan || ${FORM}['Vị Trí']).trim().slice(0, 40) }}`, type: 'string' },
      { id: uuid('pcs3'), name: 'poster_company', value: `={{ ${FORM}['Tên Công Ty'].trim().replace(/^công ty\\s+((cổ phần|tnhh)(\\s+mtv)?\\s+)?/iu, '').toUpperCase().slice(0, 26) }}`, type: 'string' },
      { id: uuid('pcs4'), name: 'poster_salary', value: `={{ ${NOT_STATED(`${ANALYSIS}.muc_luong_chuan_hoa`)} ? ' ' : ('Lương: ' + ${ANALYSIS}.muc_luong_chuan_hoa).slice(0, 40) }}`, type: 'string' },
      { id: uuid('pcs5'), name: 'poster_highlights', value: `={{ (${ANALYSIS}.diem_hap_dan || []).slice(0, 3).map(h => '• ' + h.trim().slice(0, 45)).join('\\n') || ' ' }}`, type: 'string' },
      { id: uuid('pcs6'), name: 'poster_contact', value: `={{ ${NOT_STATED(`${ANALYSIS}.thong_tin_lien_he`)} ? ' ' : ('Liên hệ: ' + ${ANALYSIS}.thong_tin_lien_he).slice(0, 60) }}`, type: 'string' },
    ],
  },
  options: {},
});

// Bảng ánh xạ ngành -> phong cách. Màu panel dùng quy ước GraphicsMagick #RRGGBBOO (OO = độ trong suốt, 00 = đặc).
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
node('Visual Style Selector', 'n8n-nodes-base.set', 3.4, [3520, 300], {
  assignments: {
    assignments: [
      { id: uuid('vss1'), name: 'industry', value: `={{ ${ANALYSIS}.nganh_nghe }}`, type: 'string' },
      {
        id: uuid('vss2'), name: 'visual',
        // tách "}}" để không đóng expression n8n giữa chừng
        value: `={{ (${JSON.stringify(STYLE_MAP).replaceAll('}}', '} }')})[${ANALYSIS}.nganh_nghe] ?? ${JSON.stringify(DEFAULT_STYLE)} }}`,
        type: 'object',
      },
    ],
  },
  includeOtherFields: true,
  options: {},
});

llmChain({
  name: 'Image Prompt Builder', modelName: 'Image Prompt', parserName: 'Image Prompt Parser',
  position: [3760, 300],
  systemPrompt: prompt('image-prompt-builder'),
  schemaName: 'image-prompt',
  temperature: 0.7,
  text:
    '=Create the background prompt for a recruitment poster.\n' +
    'Industry (Vietnamese): {{ $json.industry }}\n' +
    'Job title (Vietnamese, for meaning only, DO NOT render as text): {{ $json.poster_position }}\n' +
    `Key skills (meaning only): {{ (${ANALYSIS}.ky_nang_chinh || []).slice(0, 5).join(', ') }}\n` +
    'Visual style: {{ $json.visual.style }}\n' +
    'Palette: {{ $json.visual.palette }}\n' +
    'Canvas: 1024x1536 portrait. Bottom 40% must be a calm dark area for overlay text; top-left corner clear for a logo.',
});
chain('Facebook Page Writer', 'Poster Content Selector', 'Visual Style Selector', 'Image Prompt Builder');

// ===================================================================
// Nhóm 6 - Create poster
// ===================================================================
node('Read Logo File', 'n8n-nodes-base.readWriteFile', 1.1, [4060, 300], {
  operation: 'read',
  fileSelector: `={{ ${CFG}.logo_path }}`,
  options: {},
}, { alwaysOutputData: true, onError: 'continueRegularOutput' });

node('Has Logo', 'n8n-nodes-base.if', 2.2, [4280, 300], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{
      id: uuid('haslogo'),
      leftValue: '={{ Boolean($binary?.data) }}',
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  looseTypeValidation: true,
  options: {},
});

node('Attach Logo', 'n8n-nodes-base.code', 2, [4500, 200], {
  jsCode: `// Gộp prompt ảnh (JSON) với binary logo và đổi tên binary thành "logo" cho node Edit Image của OpenAI.
const promptOut = $('Image Prompt Builder').first().json.output;
return $input.all().map((item) => ({
  json: {
    image_prompt: promptOut.image_prompt +
      '\\nUse the provided image as the company logo: place it small, unchanged and undistorted, in the top-left reserved zone. ' +
      'Do not add any text, letters or numbers anywhere. Avoid: ' + promptOut.negative_notes,
  },
  binary: { logo: item.binary.data },
}));`,
}, { notes: 'Why Code: cần ghép JSON prompt với binary logo và đổi tên binary property trong cùng một item.' });

node('Generate Image With Logo', '@n8n/n8n-nodes-langchain.openAi', 2.3, [4720, 200], {
  resource: 'image',
  operation: 'edit',
  modelId: { __rl: true, mode: 'id', value: `={{ ${CFG}.image_model }}` },
  prompt: '={{ $json.image_prompt }}',
  images: { values: [{ binaryPropertyName: 'logo' }] },
  size: '1024x1536',
  quality: 'high',
  options: {},
}, { ...RETRY, credentials: CRED.openAi });

node('Generate Image', '@n8n/n8n-nodes-langchain.openAi', 2.3, [4720, 420], {
  resource: 'image',
  operation: 'generate',
  modelId: { __rl: true, mode: 'id', value: `={{ ${CFG}.image_model }}` },
  prompt: "={{ $('Image Prompt Builder').first().json.output.image_prompt }}\nAvoid: {{ $('Image Prompt Builder').first().json.output.negative_notes }}",
  options: { size: '1024x1536', quality: 'high' },
}, { ...RETRY, credentials: CRED.openAi });

node('Text Overlay Enabled?', 'n8n-nodes-base.if', 2.2, [4960, 300], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{
      id: uuid('overlay'),
      leftValue: `={{ ${CFG}.enable_text_overlay }}`,
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  looseTypeValidation: true,
  options: {},
});

const PC = "$('Poster Content Selector').first().json";
const VS = "$('Visual Style Selector').first().json.visual";
const FONT = `={{ ${CFG}.overlay_font }}`;
const textStep = (text, fontSize, fontColor, positionY, lineLength) => ({
  operation: 'text', text, fontSize, fontColor, positionX: 72, positionY,
  horizontalAlignment: 'left', verticalAlignment: 'top', lineLength, font: FONT,
});
node('Overlay Poster Text', 'n8n-nodes-base.editImage', 1.1, [5180, 200], {
  operation: 'multiStep',
  dataPropertyName: 'data',
  operations: {
    operations: [
      { operation: 'draw', primitive: 'rectangle', color: `={{ ${VS}.panel }}`, startPositionX: 0, startPositionY: 940, endPositionX: 1024, endPositionY: 1536 },
      { operation: 'draw', primitive: 'rectangle', color: `={{ ${VS}.accent }}`, startPositionX: 72, startPositionY: 948, endPositionX: 232, endPositionY: 954 },
      textStep(`={{ ${PC}.poster_company }} TUYỂN DỤNG`, 34, `={{ ${VS}.accent }}`, 1000, 48),
      textStep(`={{ ${PC}.poster_position }}`, 62, '#FFFFFF', 1065, 24),
      textStep(`={{ ${PC}.poster_salary }}`, 44, `={{ ${VS}.accent }}`, 1230, 36),
      textStep(`={{ ${PC}.poster_highlights }}`, 30, '#FFFFFF', 1300, 52),
      textStep(`={{ ${PC}.poster_contact }}`, 32, '#FFFFFF', 1465, 52),
    ],
  },
  options: { format: 'png', fileName: `=poster-{{ ${JD_ID} }}.png` },
});

node('Upload to Drive', 'n8n-nodes-base.googleDrive', 3, [5420, 300], {
  inputDataFieldName: 'data',
  name: `=poster-{{ ${JD_ID} }}.png`,
  driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
  folderId: { __rl: true, mode: 'id', value: `={{ ${CFG}.drive_folder_id }}` },
  options: { simplifyOutput: false },
}, RETRY);

node('Share Anyone With Link', 'n8n-nodes-base.googleDrive', 3, [5640, 300], {
  operation: 'share',
  fileId: { __rl: true, mode: 'id', value: '={{ $json.id }}' },
  permissionsUi: { permissionsValues: { role: 'reader', type: 'anyone' } },
  options: {},
}, RETRY);

chain('Image Prompt Builder', 'Read Logo File', 'Has Logo');
link('Has Logo', 'Attach Logo', 'main', 0);
link('Has Logo', 'Generate Image', 'main', 1);
link('Attach Logo', 'Generate Image With Logo');
link('Generate Image With Logo', 'Text Overlay Enabled?');
link('Generate Image', 'Text Overlay Enabled?');
link('Text Overlay Enabled?', 'Overlay Poster Text', 'main', 0);
link('Text Overlay Enabled?', 'Upload to Drive', 'main', 1);
link('Overlay Poster Text', 'Upload to Drive');
link('Upload to Drive', 'Share Anyone With Link');

// ===================================================================
// Nhóm 7 - Validate and save
// ===================================================================
node('Check Posts Quality', 'n8n-nodes-base.code', 2, [5900, 300], {
  jsCode: `// Kiểm tra chất lượng 4 bài; lần 2 (sau khi viết lại) nhận posts từ "Merge Rewritten Posts".
const a = $('JD Analyzer').first().json.output;
const form = $('Generate JD ID').first().json;
const upload = $('Upload to Drive').first().json;
const incoming = $input.first().json;
const attempt = incoming.attempt ?? 0;
const posts = incoming.posts ?? {
  linkedin: $('LinkedIn Writer').first().json.output,
  threads: $('Threads Writer').first().json.output,
  facebook_groups: $('Facebook Groups Writer').first().json.output,
  facebook_page: $('Facebook Page Writer').first().json.output,
};

const RULES = {
  linkedin: { label: 'LinkedIn', maxChars: 3000, minTags: 3, maxTags: 5 },
  threads: { label: 'Threads', maxChars: 500, minTags: 0, maxTags: 2 },
  facebook_groups: { label: 'Facebook Groups', maxChars: 2000, minTags: 0, maxTags: 4 },
  facebook_page: { label: 'Facebook Page', maxChars: 2500, minTags: 3, maxTags: 5 },
};
const notStated = (v) => /^\\s*(không nêu|khong neu)?\\s*$/i.test(v ?? '');
const normTag = (t) => '#' + String(t).replace(/^#+/, '').replace(/\\s+/g, '');
const sourceText = [form['Chi Tiết JD'], form['Mức Lương'], form['Liên Hệ']].join(' \\n ');
const sourceNumbers = new Set((sourceText.match(/\\d+(?:[.,]\\d+)?/g) || []).map((n) => n.replace(/[.,]/g, '')));

// Token liên hệ: email, url, số điện thoại (chỉ giữ chữ số)
const contactRaw = notStated(a.thong_tin_lien_he) ? (form['Liên Hệ'] || '') : a.thong_tin_lien_he;
const contactTokens = [
  ...(contactRaw.match(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/g) || []).map((s) => s.toLowerCase()),
  ...(contactRaw.match(/(?:https?:\\/\\/|www\\.)\\S+/g) || []).map((s) => s.toLowerCase()),
  ...(contactRaw.match(/\\+?\\d[\\d .-]{7,}\\d/g) || []).map((s) => s.replace(/\\D/g, '')),
];
const MONEY = /(\\d+(?:[.,]\\d+)?)\\s*(?:-|–|đến|tới)?\\s*(?:\\d+(?:[.,]\\d+)?)?\\s*(triệu|tr\\b|củ|nghìn|ngàn|k\\b|usd|\\$|vnđ|vnd|đồng)/gi;
const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

const errors = {};
const finalPosts = {};
for (const [key, rule] of Object.entries(RULES)) {
  const p = posts[key] || {};
  const errs = [];
  const text = String(p.post_text || '').trim();

  // Hashtag: chuẩn hoá và cắt theo giới hạn (sửa tự động, không đánh trượt)
  let tags = [...new Set((p.hashtags || []).map(normTag).filter((t) => t.length > 1))];
  if (tags.length < rule.minTags) {
    tags = [...new Set([...tags, ...(a.tu_khoa_hashtag || []).map(normTag)])];
  }
  tags = tags.slice(0, rule.maxTags);
  const full = tags.length ? text + '\\n\\n' + tags.join(' ') : text;

  if (!text) errs.push('Bài rỗng');
  if (full.length > rule.maxChars) errs.push(\`Vượt giới hạn \${rule.maxChars} ký tự (hiện \${full.length})\`);
  const ph = full.match(/\\{\\{[^}]*\\}\\}|\\[[^\\]\\n]{1,40}\\]|\\bXXX+\\b|<[A-ZÀ-Ỹa-zà-ỹ _]{2,30}>/);
  if (ph) errs.push(\`Còn placeholder: "\${ph[0]}"\`);
  if (contactTokens.length) {
    const lower = full.toLowerCase();
    const digits = full.replace(/\\D/g, '');
    const ok = contactTokens.some((t) => /^\\d+$/.test(t) ? digits.includes(t) : lower.includes(t));
    if (!ok) errs.push('Thiếu thông tin liên hệ có trong JD (' + contactRaw + ')');
  }
  for (const m of full.matchAll(MONEY)) {
    const nums = (m[0].match(/\\d+(?:[.,]\\d+)?/g) || []).map((n) => n.replace(/[.,]/g, ''));
    const bad = nums.filter((n) => !sourceNumbers.has(n));
    if (bad.length) errs.push(\`Có số tiền không có trong JD: "\${m[0].trim()}"\`);
  }
  if (notStated(a.muc_luong_chuan_hoa) && /lương[^\\n]{0,25}\\d/i.test(full)) {
    errs.push('JD không nêu lương nhưng bài có con số lương');
  }
  const letters = (full.match(/\\p{L}/gu) || []).length;
  const viRatio = letters ? (full.match(VI_CHARS) || []).length / letters : 0;
  if (letters && viRatio < 0.03) errs.push('Có vẻ không phải tiếng Việt có dấu');

  if (errs.length) errors[key] = errs;
  finalPosts[key] = { post_text: text, hashtags: tags, cta: p.cta || '', full_text: full };
}

const fileId = upload.id;
const summary = Object.entries(errors)
  .map(([k, e]) => \`\${RULES[k].label}: \${e.join('; ')}\`)
  .join(' || ');
return [{
  json: {
    jd_id: form.jd_id,
    attempt,
    valid: Object.keys(errors).length === 0,
    errors,
    error_summary: summary,
    posts: finalPosts,
    warnings: (a.canh_bao_thieu_thong_tin || []).join('; '),
    poster_url: upload.webViewLink || (fileId ? \`https://drive.google.com/file/d/\${fileId}/view\` : ''),
    poster_direct_url: fileId ? \`https://drive.google.com/uc?export=view&id=\${fileId}\` : '',
  },
}];`,
}, { notes: 'Why Code: nhiều quy tắc kiểm tra (regex lương/liên hệ/placeholder/tỉ lệ dấu tiếng Việt) trên 4 bài cùng lúc.' });

node('All Posts Valid', 'n8n-nodes-base.if', 2.2, [6120, 300], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: uuid('allvalid'),
      leftValue: '={{ $json.valid }}',
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
});

node('Build Rows', 'n8n-nodes-base.code', 2, [6360, 200], {
  jsCode: `// Tách 1 item (4 bài) thành 4 dòng cho tab Posts.
const d = $input.first().json;
const LABELS = { linkedin: 'LinkedIn', threads: 'Threads', facebook_groups: 'Facebook Groups', facebook_page: 'Facebook Page' };
const createdAt = $now.setZone('Asia/Ho_Chi_Minh').toFormat('yyyy-MM-dd HH:mm:ss');
return Object.entries(LABELS).map(([key, label]) => ({
  json: {
    jd_id: d.jd_id,
    platform: label,
    post_text: d.posts[key].full_text,
    hashtags: d.posts[key].hashtags.join(' '),
    poster_url: d.poster_url,
    status: 'Draft',
    created_at: createdAt,
  },
}));`,
}, { notes: 'Why Code: ánh xạ object 4 nền tảng thành 4 item có nhãn platform trong một bước.' });

node('Append to Posts', 'n8n-nodes-base.googleSheets', 4.7, [6580, 200], {
  operation: 'append',
  documentId: sheetDoc(CFG),
  sheetName: sheetTab('Posts'),
  columns: {
    mappingMode: 'defineBelow',
    value: Object.fromEntries(POSTS_COLUMNS.map((c) => [c, `={{ $json.${c} }}`])),
    matchingColumns: [],
    schema: colSchema(POSTS_COLUMNS),
    attemptToConvertTypes: false,
    convertFieldsToString: true,
  },
  options: {},
}, RETRY);

const CHECK = "$('Check Posts Quality').last().json";
node('Set Done', 'n8n-nodes-base.googleSheets', 4.7, [6800, 200],
  updateJd(CFG, {
    jd_id: `={{ ${CHECK}.jd_id }}`,
    status: 'Done',
    error_message: '',
    poster_url: `={{ ${CHECK}.poster_url }}`,
    warnings: `={{ ${CHECK}.warnings }}`,
  }), { ...RETRY, executeOnce: true });

node('Can Retry?', 'n8n-nodes-base.if', 2.2, [6360, 440], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: uuid('canretry'),
      leftValue: '={{ $json.attempt }}',
      rightValue: 1,
      operator: { type: 'number', operation: 'lt' },
    }],
    combinator: 'and',
  },
  options: {},
});

node('Prepare Rewrite', 'n8n-nodes-base.code', 2, [6580, 440], {
  jsCode: `// Tạo 1 item cho mỗi bài bị lỗi để chain "Rewrite Failed Post" viết lại (tối đa 1 lần).
const d = $input.first().json;
const LIMITS = { linkedin: 'LinkedIn, tối đa 3000 ký tự, 3-5 hashtag', threads: 'Threads, tối đa 500 ký tự kể cả hashtag, 0-2 hashtag', facebook_groups: 'Facebook Groups, tối đa 1500 ký tự, 2-4 hashtag', facebook_page: 'Facebook Page, tối đa 2000 ký tự, 3-5 hashtag' };
return Object.entries(d.errors).map(([platform, errs]) => ({
  json: {
    platform,
    platform_rules: LIMITS[platform],
    errors: errs.join('\\n- '),
    original: d.posts[platform].post_text,
    hashtags: d.posts[platform].hashtags.join(' '),
  },
}));`,
}, { notes: 'Why Code: sinh số item động theo danh sách bài lỗi.' });

llmChain({
  name: 'Rewrite Failed Post', modelName: 'Rewrite Model', parserName: 'Rewrite Parser',
  position: [6820, 440],
  systemPrompt: `${prompt('post-rewriter')}\n\n${SHARED_WRITER_RULES}`,
  schemaName: 'platform-post',
  temperature: 0.4,
  text:
    '=Nền tảng: {{ $json.platform_rules }}\n\n' +
    'Ghi chú sửa lỗi:\n- {{ $json.errors }}\n\n' +
    'Bài gốc:\n{{ $json.original }}\n\nHashtag gốc: {{ $json.hashtags }}\n\n' +
    `Dữ liệu JD đã phân tích (JSON):\n{{ JSON.stringify(${ANALYSIS}, null, 2) }}`,
});

node('Merge Rewritten Posts', 'n8n-nodes-base.code', 2, [7120, 440], {
  jsCode: `// Thay các bài lỗi bằng bản viết lại rồi gửi về "Check Posts Quality" để kiểm tra lần cuối.
const first = $('Check Posts Quality').first().json;
const posts = JSON.parse(JSON.stringify(first.posts));
const plan = $('Prepare Rewrite').all();
$input.all().forEach((item, i) => {
  posts[plan[i].json.platform] = item.json.output;
});
return [{ json: { attempt: first.attempt + 1, posts } }];`,
}, { notes: 'Why Code: ghép kết quả viết lại theo thứ tự item với danh sách nền tảng bị lỗi.' });

node('Set Validation Failed', 'n8n-nodes-base.googleSheets', 4.7, [6580, 660],
  updateJd(CFG, {
    jd_id: '={{ $json.jd_id }}',
    status: 'Validation Failed',
    error_message: '={{ $json.error_summary }}',
    poster_url: '={{ $json.poster_url }}',
    warnings: '={{ $json.warnings }}',
  }), RETRY);

link('Share Anyone With Link', 'Check Posts Quality');
link('Check Posts Quality', 'All Posts Valid');
link('All Posts Valid', 'Build Rows', 'main', 0);
link('All Posts Valid', 'Can Retry?', 'main', 1);
chain('Build Rows', 'Append to Posts', 'Set Done');
link('Can Retry?', 'Prepare Rewrite', 'main', 0);
link('Can Retry?', 'Set Validation Failed', 'main', 1);
chain('Prepare Rewrite', 'Rewrite Failed Post', 'Merge Rewritten Posts', 'Check Posts Quality');

// ===================================================================
// Sticky notes (tên nhóm)
// ===================================================================
sticky('Overview', [-420, 40], 380, 560, 7,
  '## [dev] JD → bài đăng đa nền tảng\n' +
  'Form JD → Claude phân tích → 4 bài (LinkedIn, Threads, FB Groups, FB Page) → poster (OpenAI + overlay chữ tiếng Việt) → kiểm tra → Google Sheets.\n\n' +
  '**Cần cấu hình:** node `Config` + `Error Config` (spreadsheet_id, drive_folder_id), credential Anthropic/OpenAI/Google, logo tại `local-files/jd-automation/logo.png` (tùy chọn).\n\n' +
  '**Test:** kích hoạt workflow → mở URL production của form → dán JD trong `jd-automation/test-data/`.\n' +
  'Settings > Error Workflow đã trỏ về chính workflow này.');
sticky('Nhóm 1 - Prepare job description', [-40, 180], 1040, 300, 5, '## Prepare job description');
sticky('Nhóm 2 - Flag failed job', [-40, 780], 860, 300, 3, '## Flag failed job\nChỉ chạy khi workflow đang **active** và một execution production bị lỗi.');
sticky('Nhóm 3 - Analyze job description', [1060, 180], 420, 520, 4, '## Analyze job description');
sticky('Nhóm 4 - Write platform posts', [1500, 180], 1720, 520, 6, '## Write platform posts');
sticky('Nhóm 5 - Plan poster', [3240, 180], 760, 520, 2, '## Plan poster');
sticky('Nhóm 6 - Create poster', [4020, 80], 1800, 520, 4, '## Create poster\nOverlay chữ bật/tắt bằng `Config.enable_text_overlay`.');
sticky('Nhóm 7 - Validate and save', [5860, 80], 1500, 780, 5, '## Validate and save\nTối đa 1 lần viết lại bài lỗi.');

const workflow = {
  id: WORKFLOW_ID,
  name: WORKFLOW_NAME,
  active: false,
  nodes,
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

const out = join(ROOT, 'jd-automation.v2.json');
writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Đã ghi ${out} (${nodes.length} node)`);
