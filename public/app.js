// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  lastScan: null,
  selectedRuleIds: new Set(),
  levelDistribution: {},
  rulesTotal: 0,
  batchPlan: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  state.levelDistribution = payload.levelDistribution || {};
  state.rulesTotal = payload.rulesTotal || 0;
  renderRuleFilters();
  renderLevelDistribution();
  renderRules();
  renderScanRuleOptions();
  closeBatchPreview();
  renderBatchBar();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
  renderScanFileOptions();
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;

  const scanLevel = el('scan-level');
  const scanLevelCurrent = scanLevel.value;
  scanLevel.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(scanLevelCurrent)) scanLevel.value = scanLevelCurrent;

  const batchLevel = el('batch-level');
  const batchLevelCurrent = batchLevel.value;
  batchLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(batchLevelCurrent)) batchLevel.value = batchLevelCurrent;
}

// 全部规则按级别的分布，与批量预演里的"改完之后"对数用
function renderLevelDistribution() {
  const text = state.levels
    .map((item) => `${item} ${state.levelDistribution[item] || 0} 条`)
    .join('　');
  el('rule-level-dist').textContent = `级别分布（全部规则）：${text}，共 ${state.rulesTotal} 条`;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

function renderScanRuleOptions() {
  const select = el('scan-rule');
  const current = select.value;
  select.innerHTML = '<option value="">全部规则</option>'
    + state.rules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join('');
  if (state.rules.some((item) => item.id === current)) select.value = current;
}

function renderScanFileOptions() {
  const select = el('scan-file');
  const current = select.value;
  select.innerHTML = '<option value="">全部文件</option>'
    + state.files.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('');
  if (state.files.some((item) => item.id === current)) select.value = current;
}

function renderRules() {
  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="check-col"><input type="checkbox" class="rule-select" data-id="${escapeHtml(item.id)}"${state.selectedRuleIds.has(item.id) ? ' checked' : ''}></td>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
  const listedIds = state.rules.map((item) => item.id);
  const selectedListed = listedIds.filter((id) => state.selectedRuleIds.has(id));
  const selectAll = el('rule-select-all');
  selectAll.checked = listedIds.length > 0 && selectedListed.length === listedIds.length;
  selectAll.indeterminate = selectedListed.length > 0 && selectedListed.length < listedIds.length;
}

// 批量操作条：选中至少一条才出现，清空选择时把预演也收起来
function renderBatchBar() {
  const count = state.selectedRuleIds.size;
  el('batch-bar').classList.toggle('hidden', count === 0);
  el('batch-count').textContent = `已选 ${count} 条`;
  if (count === 0) closeBatchPreview();
}

function closeBatchPreview() {
  state.batchPlan = null;
  const box = el('batch-preview');
  box.classList.add('hidden');
  box.innerHTML = '';
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

function levelTag(level) {
  return `<span class="tag ${levelClass(level)}">${escapeHtml(level)}</span>`;
}

// 级别分布的前后对照：提示 3 → 5 条　警告 4 → 2 条　…
function levelTransitionText(before, after) {
  return state.levels
    .map((item) => `${item} ${before[item] || 0} → ${after[item] || 0} 条`)
    .join('　');
}

// 预演：把选中的规则与目标级别交给服务端算一遍，页面只负责照实展示
async function previewBatch() {
  clearNotice();
  clearFieldMarks();
  try {
    const plan = await request('/api/rules/batch-level/preview', {
      method: 'POST',
      body: JSON.stringify({ ruleIds: Array.from(state.selectedRuleIds), level: el('batch-level').value }),
    });
    state.batchPlan = plan;
    renderBatchPreview(plan);
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

function renderBatchPreview(plan) {
  const rows = [];
  plan.changes.forEach((change) => {
    rows.push(`<tr>
      <td class="mono">${escapeHtml(change.code)}</td>
      <td>${escapeHtml(change.name)}</td>
      <td>${levelTag(change.from)}</td>
      <td>${levelTag(change.to)}</td>
      <td>按新约定调整</td>
    </tr>`);
  });
  plan.skipped.forEach((item) => {
    rows.push(`<tr class="skip-row">
      <td class="mono">${escapeHtml(item.code || '—')}</td>
      <td>${escapeHtml(item.name || item.id)}</td>
      <td>${item.from ? levelTag(item.from) : '—'}</td>
      <td>—</td>
      <td>${escapeHtml(item.reason)}</td>
    </tr>`);
  });

  const impactLines = [];
  impactLines.push(`这一批里启用 ${plan.enabledCount} 条、停用 ${plan.disabledCount} 条。`);
  if (plan.lastScan) {
    impactLines.push(`上一轮结果（扫描时刻 ${formatTime(plan.lastScan.scannedAt)}）里有 ${plan.lastScan.hitsToRelevel} 条命中会跟着换级别，命中按级别：${levelTransitionText(plan.lastScan.byLevelBefore, plan.lastScan.byLevelAfter)}。`);
    if (plan.lastScan.recheck.length) {
      const items = plan.lastScan.recheck
        .map((hit) => `<li><span class="mono">${escapeHtml(hit.code)} ${escapeHtml(hit.path)}:${hit.lineNo}</span> ${escapeHtml(hit.lineText)}</li>`)
        .join('');
      impactLines.push(`有 ${plan.lastScan.recheck.length} 条已忽略的命中需要重新确认：<ul class="recheck-list">${items}</ul>`);
    } else {
      impactLines.push('没有已忽略的命中受影响。');
    }
  } else {
    impactLines.push('还没有上一轮扫描结果，没有命中会跟着换级别。');
  }

  const rulesTotal = Object.values(plan.rulesByLevel.after).reduce((sum, num) => sum + num, 0);
  el('batch-preview').innerHTML = `
    <h3>预演：一共 ${plan.total} 条，目标级别 ${levelTag(plan.targetLevel)}　实际要改 ${plan.changes.length} 条、跳过 ${plan.skipped.length} 条</h3>
    <div class="table-wrap">
      <table class="grid preview-grid">
        <thead><tr><th>编码</th><th>名称</th><th>当前级别</th><th>改为</th><th>说明</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    <p class="preview-line">改完后全部规则按级别：${levelTransitionText(plan.rulesByLevel.before, plan.rulesByLevel.after)}（共 ${rulesTotal} 条）</p>
    <div class="preview-block">
      <h4>连带影响</h4>
      ${impactLines.map((line) => `<p class="preview-line">${line}</p>`).join('')}
    </div>
    <div class="form-actions">
      <button type="button" id="batch-confirm"${plan.changes.length ? '' : ' disabled'}>确认执行</button>
      <button type="button" id="batch-cancel" class="ghost">取消</button>
    </div>`;
  el('batch-preview').classList.remove('hidden');
}

// 执行：服务端在最新数据上重新算一遍再落盘，返回的明细与预演同构
async function confirmBatch() {
  const plan = state.batchPlan;
  if (!plan) return;
  clearNotice();
  clearFieldMarks();
  try {
    const result = await request('/api/rules/batch-level', {
      method: 'POST',
      body: JSON.stringify({ ruleIds: Array.from(state.selectedRuleIds), level: plan.targetLevel }),
    });
    const breakdown = result.skippedBreakdown || { disabled: 0, sameLevel: 0, missing: 0 };
    notify(`批量改级别完成：改了 ${result.changes.length} 条；跳过 ${result.skipped.length} 条（停用 ${breakdown.disabled} 条、已是目标级别 ${breakdown.sameLevel} 条、不存在 ${breakdown.missing} 条）`, 'ok');
    state.selectedRuleIds.clear();
    closeBatchPreview();
    renderBatchBar();
    await loadRules();
    await loadLastScan();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍，把概要与命中清单都画出来
async function runScan() {
  clearNotice();
  const body = {
    ruleId: el('scan-rule').value,
    fileId: el('scan-file').value,
    level: el('scan-level').value,
  };
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 页面打开时把上一轮扫描结果拉回来，还没扫过就保持默认提示
async function loadLastScan() {
  const payload = await request('/api/scan/last');
  state.lastScan = payload.scan || null;
  if (state.lastScan) renderScan(state.lastScan);
}

function hitStateTag(stateValue) {
  if (stateValue === '已忽略') return '<span class="tag st-ignored">已忽略</span>';
  if (stateValue === '待重新确认') return '<span class="tag st-recheck">待重新确认</span>';
  return '正常';
}

function hitActions(hit) {
  if (hit.state === '已忽略') {
    return `<button type="button" class="link" data-hit-id="${escapeHtml(hit.id)}" data-hit-state="正常">取消忽略</button>`;
  }
  if (hit.state === '待重新确认') {
    return `<button type="button" class="link" data-hit-id="${escapeHtml(hit.id)}" data-hit-state="已忽略">确认忽略</button>
      <button type="button" class="link" data-hit-id="${escapeHtml(hit.id)}" data-hit-state="正常">取消忽略</button>`;
  }
  return `<button type="button" class="link" data-hit-id="${escapeHtml(hit.id)}" data-hit-state="已忽略">忽略</button>`;
}

function renderScan(result) {
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.warning) {
    warningBox.textContent = result.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  const summaryBox = el('scan-summary');
  const levelText = Object.keys(result.summary.byLevel)
    .map((key) => `${key} ${result.summary.byLevel[key]} 条`)
    .join('　');
  const stateText = [
    result.summary.ignored ? `已忽略 ${result.summary.ignored} 条` : '',
    result.summary.recheck ? `待重新确认 ${result.summary.recheck} 条` : '',
  ].filter(Boolean).join('　');
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>　${escapeHtml(levelText)}${stateText ? `　${escapeHtml(stateText)}` : ''}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => {
    const rowClass = hit.state === '已忽略' ? 'hit-ignored' : (hit.state === '待重新确认' ? 'hit-recheck' : '');
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
      <td>${hitStateTag(hit.state)}</td>
      <td class="actions">${hitActions(hit)}</td>
    </tr>`;
  }).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.id === 'batch-confirm') {
    await confirmBatch();
    return;
  }

  if (node.id === 'batch-cancel') {
    closeBatchPreview();
    return;
  }

  if (node.dataset.hitId && node.dataset.hitState) {
    clearNotice();
    try {
      const scan = await request(`/api/scan/last/hits/${encodeURIComponent(node.dataset.hitId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: node.dataset.hitState }),
      });
      state.lastScan = scan;
      renderScan(scan);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 勾选框单独走 change 委托：全选只管当前列出来的这些，逐条勾选按 id 记
document.addEventListener('change', (event) => {
  const node = event.target;
  if (node.id === 'rule-select-all') {
    state.rules.forEach((item) => {
      if (node.checked) state.selectedRuleIds.add(item.id);
      else state.selectedRuleIds.delete(item.id);
    });
    renderRules();
    renderBatchBar();
    return;
  }
  if (node.classList && node.classList.contains('rule-select')) {
    if (node.checked) state.selectedRuleIds.add(node.dataset.id);
    else state.selectedRuleIds.delete(node.dataset.id);
    renderRules();
    renderBatchBar();
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('batch-preview-btn').addEventListener('click', previewBatch);
el('batch-clear').addEventListener('click', () => {
  state.selectedRuleIds.clear();
  renderRules();
  renderBatchBar();
});
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则与文件都拉一遍，扫描的范围下拉依赖这两份清单；再把上一轮扫描结果补回来
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadLastScan)
  .catch((err) => notify(err.message, 'error'));
