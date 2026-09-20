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
  lastScanScope: null,
  ruleCount: 0,
  ruleDistribution: null,
  selectedRuleIds: new Set(),
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
  state.ruleCount = payload.ruleCount || 0;
  state.ruleDistribution = payload.distribution || null;
  renderRuleFilters();
  renderRules();
  renderRuleDistribution();
  renderScanRuleOptions();
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
  // 筛选后清单可能不含某些已勾选项，把失效的勾选项清掉
  const visibleIds = new Set(state.rules.map((item) => item.id));
  Array.from(state.selectedRuleIds).forEach((id) => {
    if (!visibleIds.has(id)) state.selectedRuleIds.delete(id);
  });

  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="col-check"><input type="checkbox" class="rule-select" data-rule-select="${escapeHtml(item.id)}"${state.selectedRuleIds.has(item.id) ? ' checked' : ''}></td>
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
  syncSelectAll();
  updateBatchButton();
}

// 全量规则的按级别分布，与筛选无关，批量改完之后这里要和预演完全一致
function renderRuleDistribution() {
  const box = el('rule-distribution');
  const dist = state.ruleDistribution;
  if (!dist) {
    box.textContent = '';
    return;
  }
  const text = Object.keys(dist).map((key) => `${key} ${dist[key]} 条`).join('　');
  box.innerHTML = `共 ${state.ruleCount} 条规则　${escapeHtml(text)}`;
}

function syncSelectAll() {
  const selectAll = el('rule-select-all');
  const total = state.rules.length;
  const picked = state.rules.filter((item) => state.selectedRuleIds.has(item.id)).length;
  selectAll.checked = total > 0 && picked === total;
  selectAll.indeterminate = picked > 0 && picked < total;
}

function updateBatchButton() {
  const btn = el('rule-batch-level');
  const count = state.selectedRuleIds.size;
  btn.textContent = count > 0 ? `批量改级别（已选 ${count} 条）` : '批量改级别';
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
    state.lastScanScope = body;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
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
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>
    <div class="summary-line">其中已忽略 ${result.summary.ignored} 条（待重新确认 ${result.summary.reconfirm} 条）；总数与按级别分布仍按全部命中统计</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => {
    let badge = '';
    let actions = '';
    if (hit.ignored) {
      badge = hit.needsReconfirm
        ? ' <span class="tag tag-reconfirm">待重新确认</span>'
        : ' <span class="tag tag-ignored">已忽略</span>';
      actions = hit.needsReconfirm
        ? `<button type="button" class="link" data-ignore-confirm="${escapeHtml(hit.ignoreId)}">重新确认</button>
           <button type="button" class="link danger" data-ignore-cancel="${escapeHtml(hit.ignoreId)}">取消忽略</button>`
        : `<button type="button" class="link danger" data-ignore-cancel="${escapeHtml(hit.ignoreId)}">取消忽略</button>`;
    } else {
      actions = `<button type="button" class="link" data-hit-ignore="${escapeHtml(hit.ruleId)}|${escapeHtml(hit.fileId)}|${hit.lineNo}">忽略</button>`;
    }
    return `<tr${hit.ignored ? ' class="row-ignored"' : ''}>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span>${badge}</td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
}

// 按级别把分布拼成“提示 a 条　警告 b 条　错误 c 条”
function levelDistText(byLevel) {
  return Object.keys(byLevel).map((key) => `${key} ${byLevel[key]} 条`).join('　');
}

// ── 批量改级别 ──────────────────────────────────────────────
function openBatchModal() {
  clearNotice();
  if (state.selectedRuleIds.size === 0) {
    notify('请先勾选要改级别的规则', 'error');
    return;
  }
  const select = el('batch-level');
  select.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  el('batch-selected-count').textContent = `已勾选 ${state.selectedRuleIds.size} 条规则`;
  el('batch-error').classList.add('hidden');
  el('batch-preview-box').classList.add('hidden');
  el('batch-preview-box').innerHTML = '';
  el('batch-apply').disabled = true;
  state.batchPlan = null;
  el('batch-modal').classList.remove('hidden');
  generateBatchPreview();
}

function closeBatchModal() {
  el('batch-modal').classList.add('hidden');
  state.batchPlan = null;
}

async function generateBatchPreview() {
  const errorBox = el('batch-error');
  errorBox.classList.add('hidden');
  const payload = {
    ruleIds: Array.from(state.selectedRuleIds),
    level: el('batch-level').value,
  };
  // 只有扫过一轮时才把范围带给服务端，预演里才能算出命中的连带影响
  if (state.lastScanScope) payload.scope = state.lastScanScope;
  try {
    const plan = await request('/api/rules/batch-level/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.batchPlan = plan;
    renderBatchPreview(plan);
  } catch (err) {
    state.batchPlan = null;
    el('batch-apply').disabled = true;
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  }
}

function renderBatchPreview(plan) {
  const box = el('batch-preview-box');
  const callouts = [];
  if (plan.duplicated > 0) {
    callouts.push(`<p class="plan-callout">勾选的规则里有 ${plan.duplicated} 个重复编号，已去重，按 ${plan.total} 条计算。</p>`);
  }
  if (plan.disabledCount > 0) {
    const codes = plan.items.filter((item) => item.disabled).map((item) => item.code).join('、');
    callouts.push(`<p class="plan-callout">其中 <strong>${plan.disabledCount} 条当前是停用状态</strong>（${escapeHtml(codes)}）：停用规则不参与比对，这一批照样会改它们的级别并计入分布，但不会影响上一轮命中。</p>`);
  }
  if (plan.unchangedCount > 0) {
    const codes = plan.items.filter((item) => !item.changed).map((item) => item.code).join('、');
    callouts.push(`<p class="plan-callout">其中 <strong>${plan.unchangedCount} 条当前已经是“${escapeHtml(plan.targetLevel)}”</strong>（${escapeHtml(codes)}）：执行时不会改动，更新时间也不变，仅在此列明，不会被悄悄跳过。</p>`);
  }

  const rows = plan.items.map((item) => {
    const tags = [];
    if (item.disabled) tags.push('<span class="tag tag-muted">停用</span>');
    if (!item.changed) tags.push('<span class="tag tag-muted">级别不变</span>');
    return `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.fromLevel)}">${escapeHtml(item.fromLevel)}</span></td>
      <td class="plan-arrow">→</td>
      <td><span class="tag ${levelClass(item.toLevel)}">${escapeHtml(item.toLevel)}</span></td>
      <td>${tags.join(' ') || '—'}</td>
    </tr>`;
  }).join('');

  let impactHtml = '';
  if (plan.hits) {
    const h = plan.hits;
    const scopeNotes = [];
    if (h.scope.level) {
      scopeNotes.push(`范围按级别“${escapeHtml(h.scope.level)}”过滤：改级别后会有 ${h.leftFilterCount} 条离开当前范围、${h.joinedFilterCount} 条进入当前范围。`);
    }
    impactHtml = `
      <h4>连带影响 · 上一轮结果</h4>
      <p>这一批里当前启用的规则 <strong>${plan.enabledCount}</strong> 条；上一轮命中里将有 <strong>${h.affectedCount} 条</strong>跟着换级别（停用规则不产生命中，不计在内）。</p>
      <p>命中总数 ${h.before.total} 条 → ${h.after.total} 条；按级别：${escapeHtml(levelDistText(h.before.byLevel))} → ${escapeHtml(levelDistText(h.after.byLevel))}。匹配写法没变，命中条数一处不差，只换级别。</p>
      ${scopeNotes.map((note) => `<p class="plan-callout">${note}</p>`).join('')}`;
  } else {
    impactHtml = '<h4>连带影响 · 上一轮结果</h4><p class="plan-muted">还没有扫过，暂不预演命中影响；执行后到命中清单点“按规则扫一遍”即可查看。</p>';
  }

  const reconfirmRows = plan.reconfirms.length === 0
    ? '<p class="plan-muted">没有需要重新确认的忽略条目。</p>'
    : `<p>以下 <strong>${plan.reconfirms.length} 条</strong>被忽略的命中，因为规则级别变化需要重新确认：</p>
       <table class="grid plan-table"><thead><tr><th>规则编码</th><th>文件</th><th>行号</th><th>那一行的内容</th><th>忽略时级别</th><th></th><th>新级别</th></tr></thead>
       <tbody>${plan.reconfirms.map((item) => `<tr>
         <td class="mono">${escapeHtml(item.code)}</td>
         <td class="mono">${escapeHtml(item.path)}</td>
         <td class="mono">${item.lineNo}</td>
         <td class="mono line-cell">${escapeHtml(item.lineText)}</td>
         <td><span class="tag ${levelClass(item.fromLevel)}">${escapeHtml(item.fromLevel)}</span></td>
         <td class="plan-arrow">→</td>
         <td><span class="tag ${levelClass(item.toLevel)}">${escapeHtml(item.toLevel)}</span></td>
       </tr>`).join('')}</tbody></table>
       <p class="plan-muted">执行后这些条目会在命中清单里标成“待重新确认”，可逐条重新确认或取消忽略。</p>`;

  box.innerHTML = `
    ${callouts.join('')}
    <h4>这一批共 ${plan.total} 条，逐条变化如下</h4>
    <div class="plan-scroll"><table class="grid plan-table">
      <thead><tr><th>编码</th><th>名称</th><th>当前级别</th><th></th><th>改成</th><th>说明</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <h4>执行后规则级别分布（全量规则）</h4>
    <p>共 ${Object.values(plan.ruleDistribution.before).reduce((a, b) => a + b, 0)} 条规则：${escapeHtml(levelDistText(plan.ruleDistribution.before))} → ${escapeHtml(levelDistText(plan.ruleDistribution.after))}</p>
    ${impactHtml}
    <h4>被忽略条目的重新确认</h4>
    ${reconfirmRows}`;
  box.classList.remove('hidden');

  // 一条都不会变时不允许执行，但上面的预演已经把原因写明，不是悄悄跳过
  el('batch-apply').disabled = plan.changedCount === 0;
  if (plan.changedCount === 0) {
    box.insertAdjacentHTML('beforeend', '<p class="plan-callout">这一批没有级别会发生变化的规则，无需执行。</p>');
  }
}

async function applyBatch() {
  const plan = state.batchPlan;
  if (!plan) return;
  const payload = { ruleIds: plan.items.map((item) => item.ruleId), level: plan.targetLevel };
  if (state.lastScanScope) payload.scope = state.lastScanScope;
  try {
    const result = await request('/api/rules/batch-level', { method: 'POST', body: JSON.stringify(payload) });
    closeBatchModal();
    state.selectedRuleIds.clear();
    await loadRules();
    const notes = [`已改 ${result.changedCount} 条`];
    if (result.unchangedCount > 0) notes.push(`${result.unchangedCount} 条本就是该级别未改动`);
    if (result.disabledCount > 0) notes.push(`含停用 ${result.disabledCount} 条`);
    notify(`${notes.join('，')}。规则级别分布：${levelDistText(state.ruleDistribution)}`, 'ok');
    if (state.lastScanScope) {
      await rescanWithLastScope();
    } else {
      notify(`${notes.join('，')}。可到命中清单扫一遍查看命中变化。`, 'ok');
    }
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 执行后用和上一轮完全相同的范围重扫，页面上的分布以服务端重算结果为准
async function rescanWithLastScope() {
  if (!state.lastScanScope) return;
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(state.lastScanScope) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 忽略、重新确认、取消忽略之后都按原范围重扫，忽略徽标与汇总保持最新
async function rescanQuietly() {
  if (!state.lastScanScope) return;
  await rescanWithLastScope();
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

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
      state.selectedRuleIds.delete(node.dataset.ruleDelete);
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
    return;
  }

  if (node.dataset.hitIgnore) {
    clearNotice();
    const [ruleId, fileId, lineNo] = node.dataset.hitIgnore.split('|');
    try {
      await request('/api/ignores', {
        method: 'POST',
        body: JSON.stringify({ ruleId, fileId, lineNo: Number(lineNo) }),
      });
      notify('已忽略这条命中；规则以后改了级别会提示重新确认', 'ok');
      await rescanQuietly();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.ignoreConfirm) {
    clearNotice();
    try {
      await request(`/api/ignores/${encodeURIComponent(node.dataset.ignoreConfirm)}/reconfirm`, { method: 'POST' });
      notify('已按规则当前级别重新确认', 'ok');
      await rescanQuietly();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.ignoreCancel) {
    clearNotice();
    if (!window.confirm('确定取消忽略，让这条命中重新出现在清单里吗？')) return;
    try {
      await request(`/api/ignores/${encodeURIComponent(node.dataset.ignoreCancel)}`, { method: 'DELETE' });
      notify('已取消忽略', 'ok');
      await rescanQuietly();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 复选框不是按钮，单独用 change 委托；选择集合放在 state 里，列表重绘后按集合回填
document.addEventListener('change', (event) => {
  const rowBox = event.target.closest('input.rule-select');
  if (rowBox) {
    const id = rowBox.dataset.ruleSelect;
    if (rowBox.checked) state.selectedRuleIds.add(id);
    else state.selectedRuleIds.delete(id);
    syncSelectAll();
    updateBatchButton();
    return;
  }
  if (event.target.id === 'rule-select-all') {
    const checked = event.target.checked;
    state.rules.forEach((item) => {
      if (checked) state.selectedRuleIds.add(item.id);
      else state.selectedRuleIds.delete(item.id);
    });
    renderRules();
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
el('rule-batch-level').addEventListener('click', openBatchModal);
el('batch-close').addEventListener('click', closeBatchModal);
el('batch-cancel').addEventListener('click', closeBatchModal);
el('batch-preview').addEventListener('click', generateBatchPreview);
el('batch-level').addEventListener('change', generateBatchPreview);
el('batch-apply').addEventListener('click', applyBatch);
el('batch-modal').addEventListener('click', (event) => {
  if (event.target.id === 'batch-modal') closeBatchModal();
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

// 页面打开时先把规则与文件都拉一遍，扫描的范围下拉依赖这两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .catch((err) => notify(err.message, 'error'));
