// Sinh workflow TEST "[test] jd-ollama-dry-run" từ jd-automation.v5.json để chạy thử luồng nghiệp vụ
// khi CHƯA có key Claude / Google:
//  - Form → JD mẫu (test-data/jd-01-day-du.md), chạy bằng Manual Trigger
//  - Claude → Ollama llama3.2 (local)
//  - Mọi node Google Sheets → Set "giả lập": xuất ra đúng dữ liệu SẼ ghi vào Sheet
//  - Sau khi lưu bài: tự coi 4 bài là Approved rồi chạy khung Đăng bài ở DRY_RUN
// Workflow chính v5 KHÔNG bị thay đổi.
// Chạy: node jd-automation/tools/make-ollama-test.mjs → jd-automation/test-data/jd-ollama-test.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const w = JSON.parse(readFileSync(join(ROOT, 'jd-automation.v5.json'), 'utf8'));
const byName = (n) => w.nodes.find((x) => x.name === n);
const rename = (from, to) => {
  byName(from).name = to;
  if (w.connections[from]) { w.connections[to] = w.connections[from]; delete w.connections[from]; }
  for (const outs of Object.values(w.connections)) for (const arr of Object.values(outs)) for (const o of arr) for (const c of o) if (c.node === from) c.node = to;
};
const removeNode = (n) => {
  w.nodes = w.nodes.filter((x) => x.name !== n);
  delete w.connections[n];
  for (const outs of Object.values(w.connections)) for (const arr of Object.values(outs)) for (let i = 0; i < arr.length; i++) arr[i] = arr[i].filter((c) => c.node !== n);
};
const link = (from, to) => {
  w.connections[from] ??= { main: [[]] };
  w.connections[from].main[0].push({ node: to, type: 'main', index: 0 });
};

// 1) Form → Manual Trigger + JD mẫu
const form = byName('[0] JD Form');
const pos = form.position;
removeNode('[0] JD Form');
w.nodes.push({ parameters: {}, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [pos[0] - 200, pos[1]], id: 'b0000000-0000-4000-8000-000000000001', name: '[T] Run test' });
w.nodes.push({
  parameters: {
    assignments: {
      assignments: [
        ['Tên Công Ty', 'Công ty Cổ phần Công nghệ Sao Mai'],
        ['Vị Trí', 'Lập trình viên Backend (Java)'],
        ['Mức Lương', '25 - 35 triệu'],
        ['Liên Hệ', 'tuyendung@saomai-tech.vn - 0912 345 678 (Ms. Hằng)'],
        ['Chi Tiết JD', readFileSync(join(ROOT, 'test-data/jd-01-day-du.md'), 'utf8').split('```')[1].trim()],
      ].map(([name, value], i) => ({ id: `b0000000-0000-4000-8000-00000000010${i}`, name, value, type: 'string' })),
    },
    options: {},
  },
  type: 'n8n-nodes-base.set', typeVersion: 3.4, position: pos, id: 'b0000000-0000-4000-8000-000000000002', name: '[T] Sample JD',
});
link('[T] Run test', '[T] Sample JD');
link('[T] Sample JD', '[0] Config');
const cfg = byName('[0] Config').parameters.assignments.assignments;
cfg.find((a) => a.name === 'entry').value = 'form';
cfg.find((a) => a.name === 'dry_run').value = true;

// 2) Claude → Ollama
const model = byName('[1] Claude Sonnet');
Object.assign(model, {
  type: '@n8n/n8n-nodes-langchain.lmChatOllama', typeVersion: 1,
  parameters: { model: 'llama3.2:latest', options: { temperature: 0.3, numCtx: 16384, numPredict: 6000, format: 'json' } },
  credentials: { ollamaApi: { id: 'ollamaLocal00001', name: 'Ollama local' } },
});
rename('[1] Claude Sonnet', '[T] Ollama llama3.2');
const ai = byName('[1] AI Analyze & Write');
delete ai.retryOnFail; delete ai.maxTries;

// 3) Google Sheets ghi → Set giả lập (xuất đúng giá trị sẽ ghi)
for (const n of w.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets' && x.parameters.columns)) {
  const values = n.parameters.columns.value;
  n.type = 'n8n-nodes-base.set';
  n.typeVersion = 3.4;
  n.parameters = {
    assignments: { assignments: Object.entries(values).map(([name, value], i) => ({ id: `${n.id.slice(0, 30)}${String(i).padStart(6, '0')}`, name, value: String(value), type: 'string' })) },
    options: {},
  };
  delete n.retryOnFail; delete n.maxTries; delete n.waitBetweenTries;
  n.notes = 'GIẢ LẬP Google Sheets: hiển thị dữ liệu sẽ ghi';
}
// 4) Read Posts → lấy 4 bài vừa lưu, coi như người duyệt đã Approved
const read = byName('[4] Read Posts');
Object.assign(read, {
  type: 'n8n-nodes-base.code', typeVersion: 2,
  parameters: { jsCode: "// GIẢ LẬP: 4 bài vừa lưu, coi như đã được duyệt\nreturn $('[3] Check & Build Rows').all().map((i) => ({ json: { ...i.json, status: 'Approved' } }));" },
  notes: 'Why Code: giả lập đọc tab Posts sau khi người duyệt đổi sang Approved',
});
delete read.retryOnFail; delete read.maxTries; delete read.alwaysOutputData;
link('[3] Set JD Result', '[4] Read Posts');

w.id = 'jdTestOllama0001';
w.name = '[test] jd-ollama-dry-run';
delete w.settings.errorWorkflow;
writeFileSync(join(ROOT, 'test-data/jd-ollama-test.json'), JSON.stringify(w, null, 2) + '\n');
console.log('Đã ghi test-data/jd-ollama-test.json:', w.nodes.length, 'node');
